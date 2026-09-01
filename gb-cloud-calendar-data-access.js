/* Shared calendar history engine and browser-local active /cal/* adapter. */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const { NOT_HANDLED } = internals;
  const STORE_KEY = 'meldex-cloud-calendar-store-v1';
  const LEASE_KEY = 'meldex-cloud-calendar-lease-v1';
  const LEASE_DURATION_MS = 5000;
  const LEASE_HEARTBEAT_MS = 1000;
  const HISTORY_LIMIT = 30;
  const STORE_NAMES = Object.freeze({ event: 'events', todo: 'tasks', shift: 'shifts' });
  let localQueue = Promise.resolve();

  function httpError(status, message, code) {
    const error = new Error(message);
    error.status = status;
    error.code = code || `HTTP_${status}`;
    return error;
  }

  function stableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  async function revision(value) {
    const bytes = new TextEncoder().encode(stableJson(value ?? null));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function createHistoryEngine(options) {
    const names = options.names || STORE_NAMES;
    const fail = (message, status, code) => { throw options.error(message, status, code); };
    const context = async (kind, itemId) => {
      const storeName = names[kind];
      if (!storeName) fail('履歴対象の種類が不正です', 400, 'CALENDAR_HISTORY_KIND_INVALID');
      const rows = await options.read(storeName);
      const current = rows.find(row => String(row?.id) === String(itemId)) || null;
      const allVersions = await options.read(options.historyStore);
      const versions = allVersions.filter(row => row?.itemKind === kind && String(row?.itemId) === String(itemId));
      const authorizationSnapshot = current || versions.find(row => row?.snapshot)?.snapshot || null;
      if (!authorizationSnapshot) fail('対象が見つかりません', 404, 'CALENDAR_HISTORY_TARGET_NOT_FOUND');
      if (!(await options.canAccess(kind, authorizationSnapshot))) {
        fail('この項目の履歴を操作する権限がありません', 403, 'CALENDAR_HISTORY_FORBIDDEN');
      }
      return { storeName, rows, current, allVersions, versions };
    };
    const verified = async (ctx, versionId) => {
      const saved = ctx.versions.find(row => String(row?.versionId) === String(versionId));
      if (!saved) fail('指定した版がありません', 404, 'CALENDAR_HISTORY_VERSION_NOT_FOUND');
      if (await revision(saved.snapshot ?? null) !== String(saved.sourceRevision || '')) {
        fail('保存版の整合性を確認できません', 409, 'CALENDAR_HISTORY_TAMPERED');
      }
      return saved;
    };
    const capture = async (kind, itemId, snapshot, label) => {
      const all = await options.read(options.historyStore);
      const sourceRevision = await revision(snapshot);
      const matching = all.filter(row => row?.itemKind === kind && String(row?.itemId) === String(itemId));
      if (matching[0]?.sourceRevision === sourceRevision) return matching[0].versionId;
      const record = {
        versionId: randomId('calv'), itemKind: kind, itemId: String(itemId), sourceRevision,
        snapshot: clone(snapshot), label: String(label || '変更前'), actor: options.actor(), createdAt: new Date().toISOString(),
      };
      const others = all.filter(row => row?.itemKind !== kind || String(row?.itemId) !== String(itemId));
      await options.write(options.historyStore, [record, ...matching.slice(0, options.limit - 1), ...others]);
      return record.versionId;
    };
    const compensated = async (storeNames, operation) => {
      const uniqueNames = [...new Set(storeNames)];
      const checkpoints = new Map();
      for (const name of uniqueNames) checkpoints.set(name, await options.read(name));
      try { return await operation(); }
      catch (error) {
        try {
          for (const name of uniqueNames) await options.write(name, checkpoints.get(name));
        } catch (rollbackError) {
          const result = options.error(
            `カレンダー更新の失敗後に復旧できません。元のエラー: ${error?.message || error}; 復元エラー: ${rollbackError?.message || rollbackError}`,
            503, 'CALENDAR_COMPENSATION_FAILED',
          );
          result.cause = rollbackError;
          throw result;
        }
        throw error;
      }
    };
    return Object.freeze({
      revision,
      capture,
      compensated,
      async list(kind, itemId) {
        const ctx = await context(kind, itemId);
        return {
          itemKind: kind, itemId: String(itemId), currentRevision: await revision(ctx.current),
          versions: ctx.versions.map(({ snapshot, ...row }) => ({ ...row, deleted: snapshot == null })),
        };
      },
      async compare(kind, itemId, versionId) {
        const ctx = await context(kind, itemId); const saved = await verified(ctx, versionId);
        if (saved.snapshot && !(await options.canAccess(kind, saved.snapshot))) {
          fail('この保存版を表示する権限がありません', 403, 'CALENDAR_HISTORY_VERSION_FORBIDDEN');
        }
        const keys = [...new Set([...Object.keys(saved.snapshot || {}), ...Object.keys(ctx.current || {})])].sort();
        return {
          itemKind: kind, itemId: String(itemId), versionId: saved.versionId,
          currentRevision: await revision(ctx.current), version: clone(saved.snapshot), current: clone(ctx.current),
          changes: keys.filter(key => stableJson(saved.snapshot?.[key]) !== stableJson(ctx.current?.[key])).map(field => ({
            field, versionValue: saved.snapshot?.[field], currentValue: ctx.current?.[field],
          })),
        };
      },
      async restore(kind, itemId, versionId, expectedRevision, apply) {
        const ctx = await context(kind, itemId); const saved = await verified(ctx, versionId);
        if (saved.snapshot && !(await options.canAccess(kind, saved.snapshot))) {
          fail('この保存版を復元する権限がありません', 403, 'CALENDAR_HISTORY_VERSION_FORBIDDEN');
        }
        if (await revision(ctx.current) !== String(expectedRevision || '')) {
          fail('表示後に項目が変更されたため復元を中止しました', 409, 'CALENDAR_HISTORY_REVISION_CONFLICT');
        }
        const desired = clone(saved.snapshot);
        if (desired && String(desired.id || '') !== String(itemId)) {
          fail('保存版の対象IDが一致しません', 409, 'CALENDAR_HISTORY_ID_MISMATCH');
        }
        return compensated(options.compensationStores(kind, ctx.storeName), async () => {
          await capture(kind, itemId, ctx.current, '復元前');
          await apply({ ...ctx, desired });
          return { ok: true, itemKind: kind, itemId: String(itemId), item: desired,
            revision: await revision(desired), reload: { itemKind: kind, itemId: String(itemId) } };
        });
      },
    });
  }

  function emptyDocument() {
    return {
      schemaVersion: 1,
      stores: { calendars: [], events: [], tasks: [], time: [], shifts: [], 'schedule-templates': [] },
      versions: [],
      calendarVisibility: {},
    };
  }

  function readDocument() {
    let parsed;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      parsed = raw ? JSON.parse(raw) : emptyDocument();
    } catch {
      throw httpError(409, '保存されているカレンダーの整合性を確認できません', 'CALENDAR_STORE_TAMPERED');
    }
    if (!parsed || parsed.schemaVersion !== 1 || !parsed.stores || !Array.isArray(parsed.versions)) {
      throw httpError(409, '保存されているカレンダーの形式が不正です', 'CALENDAR_STORE_INVALID');
    }
    for (const name of Object.keys(emptyDocument().stores)) {
      if (!Array.isArray(parsed.stores[name])) parsed.stores[name] = [];
    }
    if (!parsed.calendarVisibility || typeof parsed.calendarVisibility !== 'object' || Array.isArray(parsed.calendarVisibility)) {
      parsed.calendarVisibility = {};
    }
    let colorMigrated = false;
    parsed.stores.events = parsed.stores.events.map(row => {
      if (Object.prototype.hasOwnProperty.call(row || {}, 'color_override')) return row;
      colorMigrated = true;
      const normalized = normalizedEventColor(parsed, row);
      delete normalized.uses_calendar_color;
      return normalized;
    });
    if (colorMigrated) writeDocument(parsed);
    return parsed;
  }

  function calendarVisibilityKey(calendarId) {
    return [activeWorkspaceId(), actor(), String(calendarId || '')].map(encodeURIComponent).join('|');
  }

  function calendarWithVisibility(doc, row) {
    const result = clone(row);
    const saved = doc.calendarVisibility?.[calendarVisibilityKey(row?.id)];
    result.visible = saved == null ? 1 : (saved ? 1 : 0);
    return result;
  }

  function setCalendarVisibility(doc, calendarId, visible) {
    if (!doc.calendarVisibility || typeof doc.calendarVisibility !== 'object') doc.calendarVisibility = {};
    doc.calendarVisibility[calendarVisibilityKey(calendarId)] = visible ? 1 : 0;
  }

  function writeDocument(documentValue) {
    const serialized = JSON.stringify(documentValue);
    try {
      localStorage.setItem(STORE_KEY, serialized);
      if (localStorage.getItem(STORE_KEY) !== serialized) throw new Error('write verification failed');
    } catch {
      throw httpError(507, 'カレンダーを端末へ保存できません。空き容量とブラウザの保存許可を確認してください', 'CALENDAR_STORAGE_FAILED');
    }
  }

  function actor() {
    try {
      if (typeof getUsername === 'function') return String(getUsername() || 'anonymous').trim() || 'anonymous';
      return String(JSON.parse(localStorage.getItem('meldex-user') || '{}').name || 'anonymous').trim() || 'anonymous';
    } catch {
      return 'anonymous';
    }
  }

  function role() {
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    return { access: String(state.access || state.role || '').toLowerCase(), isOwner: state.isOwner === true };
  }

  function isAdmin() {
    const current = role();
    return current.isOwner || ['admin', 'owner'].includes(current.access);
  }

  function activeWorkspaceId() {
    return String(window.MeldexWorkspaces?.getActiveId?.() || 'cloud-local-workspace');
  }

  function activeMemberId(user, explicit = '') {
    if (String(explicit || '').trim()) return String(explicit).trim();
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    const members = state.members || state.workspace?.members || [];
    const member = Array.isArray(members)
      ? members.find(item => String(item?.name || item?.user || '') === String(user || '')) : null;
    return String(member?.id || member?.member_id || (activeWorkspaceId() && user ? `${activeWorkspaceId()}::${user}` : ''));
  }

  function rowInActiveWorkspace(row) {
    const value = String(row?.workspace_id || '');
    return !value || value === activeWorkspaceId();
  }

  function assertWritable() {
    if (role().access === 'viewer' || document.body?.dataset?.cloudReadonly === '1') {
      throw httpError(403, '閲覧専用モードではカレンダーを変更できません', 'CALENDAR_READ_ONLY');
    }
  }

  function randomId(prefix) {
    if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return `${prefix}_` + [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function canOwn(row, fields) {
    return isAdmin() || fields.some(field => String(row?.[field] || '') === actor());
  }

  function eventMembers(row) {
    let members = row?.members;
    try { if (typeof members === 'string') members = JSON.parse(members); } catch { members = []; }
    return Array.isArray(members) ? members.map(String) : [];
  }

  function canAccessCalendar(row) {
    return canOwn(row, ['user']) || eventMembers(row).includes(actor());
  }

  function canEditEvent(doc, row) {
    if (canOwn(row, ['user', 'creator']) || eventMembers(row).includes(actor())) return true;
    const calendar = doc.stores.calendars.find(item => String(item.id) === String(row?.calendar_id || ''));
    return !!calendar && (canOwn(calendar, ['user']) || (calendar.edit_role === 'editor' && role().access === 'editor'));
  }

  function calendarForEvent(doc, row) {
    return doc.stores.calendars.find(item => String(item.id) === String(row?.calendar_id || '')) || null;
  }

  function isGeneratedEvent(row) {
    return ['attendance', 'shift', 'shift-break', 'production-task'].includes(String(row?.calendar_source || ''))
      || String(row?.id || '').startsWith('shift:') || String(row?.id || '').startsWith('att:');
  }

  function normalizedEventColor(doc, value) {
    const row = clone(value || {});
    const calendar = calendarForEvent(doc, row);
    const legacyColor = String(row.color || '').trim();
    let override;
    if (Object.prototype.hasOwnProperty.call(row, 'color_override')) {
      override = String(row.color_override || '').trim();
    } else {
      const generated = ['attendance', 'shift', 'shift-break', 'production-task'].includes(String(row.calendar_source || ''));
      const calendarColor = String(calendar?.color || '').trim();
      override = !generated && legacyColor && (!calendarColor || legacyColor !== calendarColor) ? legacyColor : '';
    }
    row.color_override = override || null;
    row.uses_calendar_color = !override;
    row.color = override || String(calendar?.color || '').trim() || legacyColor || '#569cd6';
    return row;
  }

  function normalizeEventColorForWrite(doc, row, previous = null) {
    const output = row;
    const hasOverride = Object.prototype.hasOwnProperty.call(output, 'color_override');
    if (hasOverride) {
      const override = String(output.color_override || '').trim();
      output.color_override = override || null;
      return output;
    }
    if (!Object.prototype.hasOwnProperty.call(output, 'color')) {
      if (previous && Object.prototype.hasOwnProperty.call(previous, 'color_override')) {
        output.color_override = previous.color_override;
      } else if (!previous) {
        output.color_override = null;
      }
      return output;
    }
    const calendar = calendarForEvent(doc, { ...previous, ...output });
    const incoming = String(output.color || '').trim();
    const calendarColor = String(calendar?.color || '').trim();
    output.color_override = !incoming || (calendarColor && incoming === calendarColor) ? null : incoming;
    return output;
  }

  async function matchesExpectedRevision(doc, kind, row, expected) {
    if (!expected) return true;
    if (expected === await revision(row)) return true;
    return kind === 'event' && expected === await revision(normalizedEventColor(doc, row));
  }

  function canAccess(doc, kind, row) {
    if (!row) return false;
    if (!rowInActiveWorkspace(row)) return false;
    if (kind === 'event') return canEditEvent(doc, row);
    if (kind === 'todo') return canOwn(row, ['user', 'assignee']);
    if (kind === 'shift') return canOwn(row, ['user']);
    return false;
  }

  function assertOwner(body, fields, message, code) {
    if (!isAdmin() && fields.some(field => body?.[field] && String(body[field]) !== actor())) {
      throw httpError(403, message, code);
    }
  }

  function assertOwnerUnchanged(previous, body, fields, message, code) {
    if (!isAdmin() && fields.some(field => Object.prototype.hasOwnProperty.call(body || {}, field)
      && String(body[field] || '') !== String(previous?.[field] || ''))) {
      throw httpError(403, message, code);
    }
  }

  function historyId() {
    return randomId('calv');
  }

  async function captureVersion(doc, kind, itemId, snapshot, label) {
    const sourceRevision = await revision(snapshot);
    const matching = doc.versions.filter(row => row.itemKind === kind && String(row.itemId) === String(itemId));
    if (matching[0]?.sourceRevision === sourceRevision) return matching[0].versionId;
    const record = {
      versionId: historyId(), itemKind: kind, itemId: String(itemId), sourceRevision,
      snapshot: clone(snapshot), label: String(label || '変更前'), actor: actor(), createdAt: new Date().toISOString(),
    };
    const retained = matching.slice(0, HISTORY_LIMIT - 1);
    const others = doc.versions.filter(row => row.itemKind !== kind || String(row.itemId) !== String(itemId));
    doc.versions = [record, ...retained, ...others];
    return record.versionId;
  }

  async function verifiedVersion(doc, kind, itemId, versionId) {
    const saved = doc.versions.find(row => row.itemKind === kind
      && String(row.itemId) === String(itemId) && String(row.versionId) === String(versionId));
    if (!saved) throw httpError(404, '指定した版がありません', 'CALENDAR_HISTORY_VERSION_NOT_FOUND');
    if (await revision(saved.snapshot ?? null) !== String(saved.sourceRevision || '')) {
      throw httpError(409, '保存版の整合性を確認できません', 'CALENDAR_HISTORY_TAMPERED');
    }
    return saved;
  }

  function historyContext(doc, kind, itemId) {
    const storeName = STORE_NAMES[kind];
    if (!storeName) throw httpError(400, '履歴対象の種類が不正です', 'CALENDAR_HISTORY_KIND_INVALID');
    const current = doc.stores[storeName].find(row => String(row.id) === String(itemId)) || null;
    const versions = doc.versions.filter(row => row.itemKind === kind && String(row.itemId) === String(itemId));
    const authorizationSnapshot = current || versions.find(row => row.snapshot)?.snapshot || null;
    if (!authorizationSnapshot) throw httpError(404, '対象が見つかりません', 'CALENDAR_HISTORY_TARGET_NOT_FOUND');
    if (!canAccess(doc, kind, authorizationSnapshot)) {
      throw httpError(403, 'この項目の履歴を操作する権限がありません', 'CALENDAR_HISTORY_FORBIDDEN');
    }
    return { storeName, current, versions };
  }

  function syncShiftEvent(doc, shift, itemId = '') {
    const prefix = `shift:${shift?.id || itemId}`;
    doc.stores.events = doc.stores.events.filter(row => !(String(row.id) === prefix
      || String(row.id).startsWith(prefix + ':break:')));
    if (!shift) return;
    const workspaceId = String(shift.workspace_id || '');
    const memberId = String(shift.member_id || '');
    let calendar = doc.stores.calendars.find(row => row.source === 'shift'
      && String(row.user || '') === String(shift.user || '')
      && String(row.workspace_id || '') === workspaceId
      && String(row.member_id || '') === memberId);
    if (!calendar) {
      const now = new Date().toISOString();
      calendar = {
        id: randomId('shift-cal'), name: `シフト: ${shift.user || ''}`.trim(), color: '#d19a66',
        user: shift.user || actor(), source: 'shift', visible: 1, sort_order: 0,
        folder: workspaceId || 'シフトカレンダー', edit_role: 'admin', workspace_id: workspaceId,
        member_id: memberId, created: now, modified: now,
      };
      doc.stores.calendars.push(calendar);
    }
    doc.stores.events.push({
      id: prefix, title: `勤務 ${shift.user || ''}`.trim(),
      start: `${shift.date}T${shift.start_time || '00:00'}:00`,
      end: `${shift.date}T${shift.end_time || shift.start_time || '00:00'}:00`,
      all_day: false, color: calendar.color, color_override: null, calendar_source: 'shift',
      user: shift.user || actor(), creator: shift.user || actor(), calendar_id: calendar.id,
      workspace_id: workspaceId, member_id: memberId, shift_id: shift.id,
      modified: shift.modified || new Date().toISOString(),
    });
  }

  function readStorageLease() {
    const raw = localStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    try {
      const lease = JSON.parse(raw);
      if (!lease || typeof lease.token !== 'string' || !Number.isFinite(Number(lease.expiresAt))) {
        throw new Error('invalid lease');
      }
      return lease;
    } catch {
      throw httpError(409, 'カレンダー更新ロックの整合性を確認できません', 'CALENDAR_LEASE_TAMPERED');
    }
  }

  function verifyStorageLease(token, renew = false) {
    const now = Date.now();
    const current = readStorageLease();
    if (current?.token !== token || Number(current.expiresAt) <= now) {
      throw httpError(409, '別の画面がカレンダー更新ロックを引き継ぎました', 'CALENDAR_LEASE_LOST');
    }
    if (renew) {
      const renewed = { token, expiresAt: now + LEASE_DURATION_MS };
      try { localStorage.setItem(LEASE_KEY, JSON.stringify(renewed)); }
      catch {
        throw httpError(507, 'カレンダー更新ロックを保存できません', 'CALENDAR_LOCK_STORAGE_FAILED');
      }
      const verified = readStorageLease();
      if (verified?.token !== token || Number(verified.expiresAt) !== renewed.expiresAt) {
        throw httpError(409, '別の画面がカレンダー更新ロックを引き継ぎました', 'CALENDAR_LEASE_LOST');
      }
    }
  }

  async function withStorageLease(operation) {
    if (navigator?.locks?.request) {
      return navigator.locks.request('meldex-browser-calendar-write', { mode: 'exclusive' }, () => operation(null));
    }
    const token = randomId('lease');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const now = Date.now();
      const current = readStorageLease();
      if (!current || Number(current.expiresAt || 0) <= now) {
        // Give other contexts that observed the same expired lease a chance to
        // publish their claim. Only the final visible claimant may enter.
        await new Promise(resolve => setTimeout(resolve, 0));
        const latest = readStorageLease();
        if (latest && Number(latest.expiresAt || 0) > Date.now()) continue;
        try {
          localStorage.setItem(LEASE_KEY, JSON.stringify({ token, expiresAt: Date.now() + LEASE_DURATION_MS }));
        } catch {
          throw httpError(507, 'カレンダー更新ロックを保存できません', 'CALENDAR_LOCK_STORAGE_FAILED');
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        if (readStorageLease()?.token === token) {
          let heartbeatError = null;
          const heartbeat = setInterval(() => {
            try { verifyStorageLease(token, true); }
            catch (error) { heartbeatError = error; clearInterval(heartbeat); }
          }, LEASE_HEARTBEAT_MS);
          const lease = {
            verify() {
              if (heartbeatError) throw heartbeatError;
              verifyStorageLease(token, false);
            },
            heartbeat() {
              if (heartbeatError) throw heartbeatError;
              verifyStorageLease(token, true);
            },
          };
          try { return await operation(lease); }
          finally {
            clearInterval(heartbeat);
            try {
              if (readStorageLease()?.token === token) localStorage.removeItem(LEASE_KEY);
            } catch {}
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw httpError(409, '別の画面がカレンダーを更新中です', 'CALENDAR_LEASE_CONFLICT');
  }

  async function mutate(operation) {
    const execute = async lease => {
      assertWritable();
      const doc = readDocument();
      const result = await operation(doc);
      // The document was read before asynchronous hashing/history work. A
      // successor lease must fence this stale snapshot out before full replace.
      if (lease) lease.heartbeat();
      writeDocument(doc);
      if (lease) lease.verify();
      return result;
    };
    const queued = localQueue.then(() => withStorageLease(execute), () => withStorageLease(execute));
    localQueue = queued.catch(() => undefined);
    return queued;
  }

  function filterRows(doc, name, url) {
    const rows = doc.stores[name];
    const requestedUser = url.searchParams.get('user') || '';
    if (!isAdmin() && requestedUser && requestedUser !== actor()) {
      throw httpError(403, '他のメンバーのカレンダーデータは参照できません', 'CALENDAR_READ_FORBIDDEN');
    }
    const start = url.searchParams.get('start') || url.searchParams.get('date_from') || '';
    const end = url.searchParams.get('end') || url.searchParams.get('date_to') || '';
    return rows.filter(row => {
      if (!rowInActiveWorkspace(row)) return false;
      if (!isAdmin()) {
        const accessible = name === 'events' ? canEditEvent(doc, row)
          : (name === 'calendars' ? canAccessCalendar(row) : canOwn(row, ['user', 'assignee']));
        if (!accessible) return false;
      } else if (requestedUser && requestedUser !== actor()) {
        const visible = name === 'events'
          ? [row.user, row.creator, ...eventMembers(row)].map(String).includes(requestedUser)
          : [row.user, row.assignee].map(String).includes(requestedUser);
        if (!visible) return false;
      }
      const value = String(row.start || row.date || row.due_date || row.timestamp || '');
      return (!start || value >= start) && (!end || value <= end);
    }).map(row => name === 'events' ? normalizedEventColor(doc, row)
      : (name === 'calendars' ? calendarWithVisibility(doc, row) : clone(row)));
  }

  async function createItem(doc, kind, body) {
    const storeName = STORE_NAMES[kind];
    const now = new Date().toISOString();
    const id = String(body?.id || randomId(kind));
    if (doc.stores[storeName].some(row => String(row.id) === id)) {
      throw httpError(409, '同じIDのデータが既に存在します', 'CALENDAR_ID_CONFLICT');
    }
    const row = { id, created: now, modified: now, ...clone(body || {}) };
    delete row.expectedRevision;
    if (kind === 'event') {
      if (isGeneratedEvent(row)) {
        throw httpError(409, '自動生成されたシフト予定は元データから変更してください', 'GENERATED_EVENT_READONLY');
      }
      row.title = row.title || '無題'; row.user = row.user || row.creator || actor(); row.creator = row.creator || row.user;
      const calendar = calendarForEvent(doc, row);
      row.workspace_id = String(calendar?.workspace_id || row.workspace_id || activeWorkspaceId());
      row.member_id = String(calendar?.member_id || row.member_id || '');
      assertOwner(row, ['user', 'creator'], '他のメンバー名義の予定は作成できません', 'EVENT_USER_MISMATCH');
      normalizeEventColorForWrite(doc, row);
    } else if (kind === 'todo') {
      row.title = row.title || '無題'; row.status = row.status || 'todo'; row.priority = row.priority || 'medium'; row.user = row.user || actor();
      assertOwner(row, ['user'], '他のメンバー名義のToDoは作成できません', 'TASK_USER_MISMATCH');
    } else {
      row.user = row.user || actor();
      row.workspace_id = String(row.workspace_id || activeWorkspaceId());
      row.member_id = activeMemberId(row.user, row.member_id);
      assertOwner(row, ['user'], '他のメンバー名義のシフトは作成できません', 'SHIFT_USER_MISMATCH');
    }
    await captureVersion(doc, kind, id, null, '作成前');
    doc.stores[storeName].push(row);
    if (kind === 'shift') syncShiftEvent(doc, row);
    return { ok: true, id, revision: await revision(row) };
  }

  async function updateItem(doc, kind, itemId, body) {
    const storeName = STORE_NAMES[kind];
    const index = doc.stores[storeName].findIndex(row => String(row.id) === String(itemId));
    if (index < 0) throw httpError(404, '対象が見つかりません', 'CALENDAR_ROW_NOT_FOUND');
    const previous = doc.stores[storeName][index];
    if (!canAccess(doc, kind, previous)) throw httpError(403, 'この項目を編集する権限がありません', 'CALENDAR_EDIT_FORBIDDEN');
    const expected = String(body?.expectedRevision || body?._calendar_expected_revision || '');
    if (!(await matchesExpectedRevision(doc, kind, previous, expected))) {
      throw httpError(409, '表示後に項目が変更されたため保存を中止しました', 'CALENDAR_REVISION_CONFLICT');
    }
    if (kind === 'event' && (isGeneratedEvent(previous) || isGeneratedEvent({ id: itemId, ...(body || {}) }))) {
      throw httpError(409, '自動生成されたシフト予定は元データから変更してください', 'GENERATED_EVENT_READONLY');
    }
    const patch = clone(body || {}); delete patch.expectedRevision; delete patch._calendar_expected_revision;
    if (kind === 'event') {
      assertOwnerUnchanged(previous, patch, ['user', 'creator'], '予定の所有者は変更できません', 'EVENT_USER_MISMATCH');
      normalizeEventColorForWrite(doc, patch, previous);
    }
    if (kind === 'todo') assertOwnerUnchanged(previous, patch, ['user'], 'ToDoの所有者は変更できません', 'TASK_USER_MISMATCH');
    if (kind === 'shift') assertOwnerUnchanged(previous, patch, ['user'], 'シフトの担当者は変更できません', 'SHIFT_USER_MISMATCH');
    await captureVersion(doc, kind, itemId, previous, '更新前');
    const next = { ...previous, ...patch, id: previous.id, modified: new Date().toISOString() };
    if (kind === 'event') {
      const calendar = calendarForEvent(doc, next);
      next.workspace_id = String(calendar?.workspace_id || next.workspace_id || activeWorkspaceId());
      next.member_id = String(calendar?.member_id || next.member_id || '');
    } else if (kind === 'shift') {
      next.workspace_id = String(next.workspace_id || activeWorkspaceId());
      next.member_id = activeMemberId(next.user, next.member_id);
    }
    doc.stores[storeName][index] = next;
    if (kind === 'shift') syncShiftEvent(doc, next);
    return { ok: true, revision: await revision(next) };
  }

  async function deleteItem(doc, kind, itemId, body) {
    const storeName = STORE_NAMES[kind];
    const index = doc.stores[storeName].findIndex(row => String(row.id) === String(itemId));
    if (index < 0) throw httpError(404, '対象が見つかりません', 'CALENDAR_ROW_NOT_FOUND');
    const previous = doc.stores[storeName][index];
    if (!canAccess(doc, kind, previous)) throw httpError(403, 'この項目を削除する権限がありません', 'CALENDAR_DELETE_FORBIDDEN');
    if (kind === 'event' && isGeneratedEvent(previous)) {
      throw httpError(409, '自動生成された予定は元データから変更してください', 'GENERATED_EVENT_READONLY');
    }
    const expected = String(body?.expectedRevision || body?._calendar_expected_revision || '');
    if (!(await matchesExpectedRevision(doc, kind, previous, expected))) {
      throw httpError(409, '表示後に項目が変更されたため削除を中止しました', 'CALENDAR_REVISION_CONFLICT');
    }
    await captureVersion(doc, kind, itemId, previous, '削除前');
    doc.stores[storeName].splice(index, 1);
    if (kind === 'shift') syncShiftEvent(doc, null, itemId);
    return { ok: true, revision: await revision(null) };
  }

  async function listHistory(doc, kind, itemId) {
    const context = historyContext(doc, kind, itemId);
    return {
      itemKind: kind, itemId: String(itemId), currentRevision: await revision(context.current),
      versions: context.versions.map(({ snapshot, ...row }) => ({ ...row, deleted: snapshot == null })),
    };
  }

  async function compareHistory(doc, kind, itemId, versionId) {
    const context = historyContext(doc, kind, itemId);
    const saved = await verifiedVersion(doc, kind, itemId, versionId);
    if (saved.snapshot && !canAccess(doc, kind, saved.snapshot)) {
      throw httpError(403, 'この保存版を表示する権限がありません', 'CALENDAR_HISTORY_VERSION_FORBIDDEN');
    }
    const keys = [...new Set([...Object.keys(saved.snapshot || {}), ...Object.keys(context.current || {})])].sort();
    return {
      itemKind: kind, itemId: String(itemId), versionId: saved.versionId,
      currentRevision: await revision(context.current), version: clone(saved.snapshot), current: clone(context.current),
      changes: keys.filter(key => stableJson(saved.snapshot?.[key]) !== stableJson(context.current?.[key])).map(field => ({
        field, versionValue: saved.snapshot?.[field], currentValue: context.current?.[field],
      })),
    };
  }

  async function restoreHistory(doc, kind, itemId, versionId, expectedRevision) {
    const context = historyContext(doc, kind, itemId);
    const saved = await verifiedVersion(doc, kind, itemId, versionId);
    if (saved.snapshot && !canAccess(doc, kind, saved.snapshot)) {
      throw httpError(403, 'この保存版を復元する権限がありません', 'CALENDAR_HISTORY_VERSION_FORBIDDEN');
    }
    if (await revision(context.current) !== String(expectedRevision || '')) {
      throw httpError(409, '表示後に項目が変更されたため復元を中止しました', 'CALENDAR_HISTORY_REVISION_CONFLICT');
    }
    const desired = clone(saved.snapshot);
    if (desired && String(desired.id || '') !== String(itemId)) {
      throw httpError(409, '保存版の対象IDが一致しません', 'CALENDAR_HISTORY_ID_MISMATCH');
    }
    await captureVersion(doc, kind, itemId, context.current, '復元前');
    doc.stores[context.storeName] = doc.stores[context.storeName].filter(row => String(row.id) !== String(itemId));
    if (desired) {
      if (kind === 'event') normalizeEventColorForWrite(doc, desired);
      doc.stores[context.storeName].push(desired);
    }
    if (kind === 'shift') syncShiftEvent(doc, desired);
    return {
      ok: true, itemKind: kind, itemId: String(itemId), item: desired,
      revision: await revision(desired), reload: { itemKind: kind, itemId: String(itemId) },
    };
  }

  async function handle({ method, body, url, pathname }) {
    if (!window.MeldexRuntimeAdapter?.isBrowserMode?.()) return NOT_HANDLED;
    if (pathname === '/cal/sync/status' && method === 'GET') {
      return { enabled: true, configured: false, ical: false, google: false, microsoft: false, caldav: false };
    }
    if (pathname === '/cal/alerts' && method === 'GET') return [];
    const historyRoute = pathname.match(/^\/cal\/history\/(event|todo|shift)\/([^/]+)(?:\/([^/]+)(\/restore)?)?$/);
    if (historyRoute) {
      const kind = historyRoute[1]; const itemId = decodeURIComponent(historyRoute[2]);
      const versionId = historyRoute[3] ? decodeURIComponent(historyRoute[3]) : '';
      if (method === 'GET' && !versionId) return listHistory(readDocument(), kind, itemId);
      if (method === 'GET' && versionId && !historyRoute[4]) return compareHistory(readDocument(), kind, itemId, versionId);
      if (method === 'POST' && versionId && historyRoute[4]) {
        return mutate(doc => restoreHistory(doc, kind, itemId, versionId, String(body?.expectedRevision || '')));
      }
      return NOT_HANDLED;
    }
    const route = pathname.match(/^\/cal\/(calendars|events|tasks|time|shifts|schedule-templates)(?:\/([^/]+))?$/);
    if (!route) return NOT_HANDLED;
    const name = route[1]; const itemId = route[2] ? decodeURIComponent(route[2]) : '';
    const kind = Object.keys(STORE_NAMES).find(key => STORE_NAMES[key] === name);
    if (method === 'GET' && !itemId) return filterRows(readDocument(), name, url);
    if (method === 'GET' && itemId) {
      const doc = readDocument(); const row = doc.stores[name].find(item => String(item.id) === itemId);
      if (!row || (kind && !canAccess(doc, kind, row))) throw httpError(row ? 403 : 404, row ? 'この項目を参照する権限がありません' : '対象が見つかりません', row ? 'CALENDAR_READ_FORBIDDEN' : 'CALENDAR_ROW_NOT_FOUND');
      return name === 'events' ? normalizedEventColor(doc, row)
        : (name === 'calendars' ? calendarWithVisibility(doc, row) : clone(row));
    }
    if (name === 'calendars' && method === 'PUT' && itemId && Object.prototype.hasOwnProperty.call(body || {}, 'visible')) {
      return mutate(doc => {
        const row = doc.stores.calendars.find(item => String(item.id) === itemId);
        if (!row || !canAccessCalendar(row)) throw httpError(row ? 403 : 404, row ? 'このカレンダーを変更する権限がありません' : '対象が見つかりません', row ? 'CALENDAR_EDIT_FORBIDDEN' : 'CALENDAR_ROW_NOT_FOUND');
        setCalendarVisibility(doc, itemId, Number(body.visible) !== 0);
        return { ok: true };
      });
    }
    if (!kind) return NOT_HANDLED;
    if (method === 'POST' && !itemId) return mutate(doc => createItem(doc, kind, body));
    if (method === 'PUT' && itemId) return mutate(doc => updateItem(doc, kind, itemId, body));
    if (method === 'DELETE' && itemId) return mutate(doc => deleteItem(doc, kind, itemId, body));
    return NOT_HANDLED;
  }

  handle.__meldexBrowserCalendar = true;
  if (typeof window.MeldexRuntimeAdapter?.isBrowserMode === 'function') handlers.unshift(handle);
  window.MeldexCloudCalendarDataAccess = Object.freeze({ createHistoryEngine, revision, stableJson });
  window.MeldexBrowserCalendarStore = Object.freeze({ STORE_KEY, LEASE_KEY, HISTORY_LIMIT, revision });
})();
