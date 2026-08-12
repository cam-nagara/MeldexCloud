/* Cloud scheduler row restore backed by the provider root and the existing file Version API. */
(function () {
  'use strict';

  const STORES = Object.freeze({
    'calendar-event': 'events', todo: 'tasks', attendance: 'time', shift: 'shifts',
    'weekly-template': 'schedule-templates',
  });
  const SPECIAL_DOMAINS = Object.freeze(['reverse-sync', 'external-sync-import']);
  const DOMAINS = Object.freeze([...Object.keys(STORES), ...SPECIAL_DOMAINS]);
  const REVERSE_SYNC_PATH = '_calendar/google_tasks_auth.json';
  const pathFor = store => `_calendar/${store}.json`;
  const clone = value => structuredClone(value);
  const fail = (message, status) => { const error = new Error(message); error.status = status; throw error; };

  function parseRows(text) {
    let rows;
    try { rows = JSON.parse(String(text || '[]')); } catch { fail('Cloudカレンダー保存形式が不正です', 409); }
    if (!Array.isArray(rows)) fail('Cloudカレンダー保存形式が不正です', 409);
    return rows;
  }

  function projection(row, fields) {
    if (row == null || !fields) return clone(row);
    return Object.fromEntries(fields.filter(key => Object.prototype.hasOwnProperty.call(row, key)).map(key => [key, clone(row[key])]));
  }

  async function rootIdentity(provider) {
    const info = await provider?.getWorkspaceInfo?.();
    const path = String(info?.path || provider?.getVaultPath?.() || '').trim();
    if (!provider || !info?.connected || !path) fail('Cloudの保存先ルートを確認できません', 409);
    const providerName = provider.constructor?.name || '';
    let accountId = '';
    let namespaceId = '';
    if (providerName === 'DropboxStorageProvider') {
      const namespace = await window.MeldexDropboxAuth?.getNamespaceContext?.(false);
      accountId = String(namespace?.accountId || '');
      namespaceId = String(namespace?.rootNamespaceId || namespace?.homeNamespaceId || '');
      if (!accountId || !namespaceId) fail('Dropboxのアカウントと保存先ルートを確認できません', 409);
    }
    return JSON.stringify({ provider: providerName, path, namespace: String(info.namespaceKind || ''), accountId, namespaceId });
  }

  async function create(options = {}) {
    const provider = options.provider;
    const workspaceId = String(options.workspaceId || '');
    const actor = String(options.actor || '');
    const role = String(options.role || 'viewer');
    const systemStorage = options.systemStorage || window.MeldexSystemStorage;
    const versionApi = options.versionApi || window.MeldexFileVersionProviderOps;
    if (!workspaceId) fail('workspaceを確認できません', 409);
    if (!DOMAINS.length || typeof versionApi.save !== 'function' || typeof versionApi.read !== 'function') {
      fail('Cloudの既存バージョン履歴を利用できません', 503);
    }
    const boundRoot = await rootIdentity(provider);
    const assertBound = async () => {
      if (await rootIdentity(provider) !== boundRoot) fail('復元中にCloudの保存先が切り替わりました', 409);
    };
    const readPath = async path => {
      await assertBound();
      if (typeof provider.readBytesFresh === 'function') {
        const fresh = await provider.readBytesFresh(path);
        if (!fresh?.revision || !fresh.bytes) fail('Cloudファイルを厳密に読み込めません', 409);
        return { path, text: new TextDecoder().decode(fresh.bytes), revision: String(fresh.revision) };
      }
      const before = await provider.getMetadata(path);
      const file = await provider.downloadAsFile(path);
      const after = await provider.getMetadata(path);
      const revision = value => String(value?.revision || value?.rev || value?.etag || '');
      if (!revision(before) || revision(before) !== revision(after)) fail('Cloudファイルの読込中に内容が変わりました', 409);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (provider.constructor?.name === 'BrowserStorageProvider') {
        const contentRevision = await systemStorage.computeRevision(Array.from(bytes));
        if (contentRevision !== revision(after)) fail('端末内ファイルの読込内容を検証できません', 409);
      }
      return { path, text: new TextDecoder().decode(bytes), revision: revision(after) };
    };
    const read = store => readPath(pathFor(store));
    const write = async (file, rows) => {
      await assertBound();
      if (!file.revision || typeof provider.uploadBytesConditional !== 'function') fail('厳密な競合検出を利用できません', 503);
      await provider.uploadBytesConditional(file.path, new TextEncoder().encode(JSON.stringify(rows, null, 2)), file.revision);
    };
    const specs = (domain, targets) => {
      if (!DOMAINS.includes(domain)) fail(`${domain} のCloud行復元には対応していません`, 422);
      const prefix = `${workspaceId}/`;
      return targets.map(target => {
        const normalized = String(target || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
        if (domain === 'reverse-sync') {
          if (normalized !== `${workspaceId}/google-tasks-task-links`) fail('reverse-sync のledger対象が不正です', 422);
          return { target: normalized, kind: 'ledger', path: REVERSE_SYNC_PATH };
        }
        let store = STORES[domain];
        let scoped = normalized;
        if (!store) {
          [store, ...scoped] = normalized.split('/');
          scoped = scoped.join('/');
          if (domain !== 'external-sync-import' || !['events', 'tasks'].includes(store)) fail(`${domain} の保存先が不正です`, 422);
        }
        if (!scoped.startsWith(prefix) || !scoped.slice(prefix.length)) fail('別workspaceの復元対象は指定できません', 403);
        return { target: normalized, kind: 'row', store, id: scoped.slice(prefix.length) };
      });
    };
    const allowed = (domain, store, row) => {
      if (!row || role === 'owner' || role === 'admin') return;
      const members = Array.isArray(row.members) ? row.members.map(String) : [];
      if (row.user === actor || row.creator === actor || row.assignee === actor || members.includes(actor)) return;
      fail('この復元対象を変更する権限がありません', 403);
    };
    const assertOwned = (domain, store, row) => {
      if (!row || domain === 'attendance' || domain === 'shift' || domain === 'weekly-template') return;
      const source = String(store === 'events' ? (row.calendar_source || 'local') : (row.task_source || 'local'));
      if (domain === 'calendar-event' && !['', 'local'].includes(source)) fail('予定のsourceが復元領域の外へ変わりました', 409);
      if (domain === 'todo' && !['', 'local'].includes(source)) fail('ToDoのsourceが復元領域の外へ変わりました', 409);
      if (domain === 'external-sync-import') {
        const derived = new Set(['', 'local', 'attendance', 'shift', 'shift-break', 'production-task']);
        if (derived.has(source)) fail('外部取込行のsourceが復元領域の外へ変わりました', 409);
      }
    };
    const belongs = (domain, store, row) => {
      if (!row) return false;
      if (domain === 'attendance' || domain === 'shift' || domain === 'weekly-template') return true;
      const source = String(store === 'events' ? (row.calendar_source || 'local') : (row.task_source || 'local'));
      if (domain === 'calendar-event' || domain === 'todo') return ['', 'local'].includes(source);
      if (domain === 'external-sync-import') return !['', 'local', 'attendance', 'shift', 'shift-break', 'production-task'].includes(source);
      return false;
    };
    const storesFor = domain => domain === 'external-sync-import' ? ['events', 'tasks']
      : domain === 'reverse-sync' ? [] : [STORES[domain]];
    const targetsForRows = (domain, store, rows) => (Array.isArray(rows) ? rows : [])
      .filter(row => belongs(domain, store, row))
      .map(row => domain === 'external-sync-import' ? `${store}/${workspaceId}/${row.id}` : `${workspaceId}/${row.id}`);
    const secretFreeLedger = text => {
      let payload;
      try { payload = JSON.parse(String(text || '{}')); } catch { fail('外部同期ledgerが破損しています', 409); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('外部同期ledgerが破損しています', 409);
      const secrets = new Set(['access_token', 'refresh_token', 'client_secret', 'id_token', 'code_verifier']);
      const pending = [payload];
      while (pending.length) {
        const value = pending.pop();
        for (const [key, child] of Object.entries(value)) {
          if (secrets.has(key) && String(child || '')) fail('秘密情報を含む旧同期ledgerはVersionへ保存できません', 409);
          if (child && typeof child === 'object') pending.push(child);
        }
      }
      return payload;
    };
    const rowRevision = async (domain, spec) => {
      if (spec.kind === 'ledger') {
        const payload = secretFreeLedger((await readPath(spec.path)).text);
        return systemStorage.computeRevision({ task_links: clone(payload.task_links || []) });
      }
      const file = await read(spec.store);
      const row = parseRows(file.text).find(item => String(item?.id || '') === spec.id) || null;
      assertOwned(domain, spec.store, row); allowed(domain, spec.store, row);
      return systemStorage.computeRevision({ store: spec.store, id: spec.id, row: projection(row) });
    };
    const attendanceDays = (...values) => {
      const result = new Map();
      values.filter(Boolean).forEach(item => {
        const day = String(item.timestamp || '').slice(0, 10);
        const parts = day.split('-').map(Number);
        if (!day || !item.user || parts.length !== 3) return;
        const previous = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 1)).toISOString().slice(0, 10);
        for (const candidate of [day, previous]) result.set(`${item.user}\u0000${candidate}`, { user: item.user, day: candidate });
      });
      return result;
    };
    const assertDerivedOwnership = async (domain, row, previous) => {
      if (!['attendance', 'shift'].includes(domain)) return;
      const events = parseRows((await read('events')).text);
      if (domain === 'attendance') {
        for (const { user, day } of attendanceDays(row, previous).values()) {
          const existing = events.find(item => item.id === `attendance:${user}:${day}`);
          if (existing && existing.calendar_source !== 'attendance') fail('勤怠由来予定IDが通常予定と衝突しています', 409);
        }
        return;
      }
      const ids = [row?.id, previous?.id].filter(Boolean).map(id => `shift:${id}`);
      for (const event of events) {
        const main = ids.find(id => event.id === id);
        const child = ids.find(id => String(event.id || '').startsWith(`${id}:break:`));
        if ((main && event.calendar_source !== 'shift') || (child && event.calendar_source !== 'shift-break')) {
          fail('シフト由来予定IDが通常予定と衝突しています', 409);
        }
      }
    };
    const DERIVED_FIELDS = Object.freeze(['id', 'title', 'start', 'end', 'all_day', 'color', 'description', 'location', 'url', 'recurrence', 'external_id', 'calendar_source', 'user', 'creator', 'calendar_id', 'alert_minutes']);
    const derivedProjection = value => projection(value, DERIVED_FIELDS);
    const canonicalShiftProjections = (row, existing) => {
      if (!row) return [];
      const eventId = `shift:${row.id}`;
      const startTime = String(row.start_time || '');
      const endTime = String(row.end_time || startTime);
      const allDay = row.type === 'work' && row.start_time ? 0 : 1;
      const parts = String(row.date || '').split('-').map(Number);
      const nextDay = () => parts.length === 3
        ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1)).toISOString().slice(0, 10) : String(row.date || '');
      const endDay = startTime && endTime && endTime <= startTime ? nextDay() : String(row.date || '');
      const label = { work: '勤務', off: '休み', holiday: '祝日' }[row.type] || row.type || 'シフト';
      const common = { external_id: String(row.id), user: row.user || 'anonymous', creator: row.user || 'anonymous',
        calendar_id: existing?.calendar_id || '', alert_minutes: -1, location: '', url: '', recurrence: '' };
      const result = [derivedProjection({ ...common, id: eventId, title: `シフト ${row.user || 'anonymous'}: ${label}`,
        start: allDay ? row.date : `${row.date}T${startTime}`, end: allDay ? row.date : `${endDay}T${endTime || startTime}`,
        all_day: allDay, color: '#d19a66', description: row.note || '', calendar_source: 'shift' })];
      if (allDay) return result;
      const breaks = String(row.note || '').split(/\r?\n/).map(line => /^\s*休憩\s*(\d+)\s*:\s*([0-2]\d:[0-5]\d)\s*-\s*([0-2]\d:[0-5]\d)\s*$/.exec(line)).filter(Boolean);
      breaks.forEach((match, offset) => {
        if (match[2].slice(0, 2) > '23' || match[3].slice(0, 2) > '23') return;
        result.push(derivedProjection({ ...common, id: `${eventId}:break:${offset + 1}`,
          title: `休憩 ${row.user || 'anonymous'}: 休憩${match[1]}`, start: `${row.date}T${match[2]}`,
          end: `${match[3] <= match[2] ? nextDay() : row.date}T${match[3]}`, all_day: 0,
          color: 'var(--cal-shift-break-bg, #6a9ad1)', description: row.note || '', calendar_source: 'shift-break' }));
      });
      return result;
    };
    const verifyDerived = async (domain, row, previous) => {
      if (!['attendance', 'shift'].includes(domain)) return;
      const eventFile = await read('events');
      const events = parseRows(eventFile.text);
      if (domain === 'shift') {
        const ids = [row?.id, previous?.id].filter(Boolean).map(id => `shift:${id}`);
        const owned = events.filter(event => ids.some(id => event.id === id || String(event.id || '').startsWith(`${id}:break:`)));
        owned.forEach(event => {
          if ((String(event.id).includes(':break:') && event.calendar_source !== 'shift-break')
            || (!String(event.id).includes(':break:') && event.calendar_source !== 'shift')) fail('シフト由来予定IDが通常予定と衝突しています', 409);
        });
        const existing = events.find(event => event.id === `shift:${row?.id}`) || null;
        const actual = owned.map(derivedProjection).sort((a, b) => a.id.localeCompare(b.id));
        const expected = canonicalShiftProjections(row, existing).sort((a, b) => a.id.localeCompare(b.id));
        if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('checkpoint後にシフト由来予定が変更されました', 409);
        return;
      }
      const attendance = window.MeldexCloudAttendanceSync;
      const times = parseRows((await read('time')).text);
      for (const { user, day } of attendanceDays(row, previous).values()) {
        const id = `attendance:${user}:${day}`;
        const existing = events.find(event => event.id === id) || null;
        if (existing && existing.calendar_source !== 'attendance') fail('勤怠由来予定IDが通常予定と衝突しています', 409);
        const expected = attendance.deriveEvent(times, user, day, existing);
        if (JSON.stringify(existing ? derivedProjection(existing) : null) !== JSON.stringify(expected ? derivedProjection(expected) : null)) {
          fail('checkpoint後に勤怠由来予定が変更されました', 409);
        }
      }
    };
    const syncDerived = async (domain, row, previous) => {
      if (domain === 'shift') {
        const eventFile = await read('events');
        const events = parseRows(eventFile.text);
        const ids = [row?.id, previous?.id].filter(Boolean).map(id => `shift:${id}`);
        for (const event of events) {
          const main = ids.find(id => event.id === id);
          const child = ids.find(id => String(event.id || '').startsWith(`${id}:break:`));
          if ((main && event.calendar_source !== 'shift') || (child && event.calendar_source !== 'shift-break')) {
            fail('シフト由来予定IDが通常予定と衝突しています', 409);
          }
        }
        if (!row) {
          await write(eventFile, events.filter(event => !ids.some(id => event.id === id || String(event.id || '').startsWith(`${id}:break:`))));
          return;
        }
        const eventId = `shift:${row.id}`;
        const index = events.findIndex(event => event.id === eventId);
        const existing = index >= 0 ? events[index] : null;
        const startTime = String(row.start_time || '');
        const endTime = String(row.end_time || startTime);
        const allDay = row.type === 'work' && row.start_time ? 0 : 1;
        const parts = String(row.date || '').split('-').map(Number);
        const overnight = startTime && endTime && endTime <= startTime;
        const endDay = overnight && parts.length === 3
          ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1)).toISOString().slice(0, 10) : String(row.date || '');
        const label = { work: '勤務', off: '休み', holiday: '祝日' }[row.type] || row.type || 'シフト';
        const desired = {
          ...(existing || {}), id: eventId, title: `シフト ${row.user || 'anonymous'}: ${label}`,
          start: allDay ? row.date : `${row.date}T${startTime}`,
          end: allDay ? row.date : `${endDay}T${endTime || startTime}`,
          all_day: allDay, color: '#d19a66', description: row.note || '', location: '', url: '', recurrence: '',
          external_id: String(row.id), calendar_source: 'shift', user: row.user || 'anonymous', creator: row.user || 'anonymous',
          calendar_id: existing?.calendar_id || '', alert_minutes: -1,
          created: row.created || existing?.created || new Date().toISOString(), modified: new Date().toISOString(),
        };
        const regenerated = events.filter(event => event.id !== eventId && !String(event.id || '').startsWith(`${eventId}:break:`));
        regenerated.push(desired);
        if (!allDay) {
          const breaks = String(row.note || '').split(/\r?\n/).map(line => /^\s*休憩\s*(\d+)\s*:\s*([0-2]\d:[0-5]\d)\s*-\s*([0-2]\d:[0-5]\d)\s*$/.exec(line)).filter(Boolean);
          breaks.forEach((match, offset) => {
            if (match[2].slice(0, 2) > '23' || match[3].slice(0, 2) > '23') return;
            const breakOvernight = match[3] <= match[2];
            const breakEndDay = breakOvernight && parts.length === 3
              ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1)).toISOString().slice(0, 10) : String(row.date || '');
            regenerated.push({
              id: `${eventId}:break:${offset + 1}`, title: `休憩 ${row.user || 'anonymous'}: 休憩${match[1]}`,
              start: `${row.date}T${match[2]}`, end: `${breakEndDay}T${match[3]}`, all_day: 0,
              color: 'var(--cal-shift-break-bg, #6a9ad1)', description: row.note || '', location: '', url: '', recurrence: '',
              external_id: String(row.id), calendar_source: 'shift-break', user: row.user || 'anonymous', creator: row.user || 'anonymous',
              calendar_id: existing?.calendar_id || '', alert_minutes: -1, created: new Date().toISOString(), modified: new Date().toISOString(),
            });
          });
        }
        await write(eventFile, regenerated);
      }
      if (domain === 'attendance') {
        const attendance = window.MeldexCloudAttendanceSync;
        if (!attendance?.deriveEvent) fail('勤怠由来予定を再生成できません', 503);
        const affected = attendanceDays(row, previous);
        if (!affected.size) return;
        const [timeFile, eventFile] = await Promise.all([read('time'), read('events')]);
        const times = parseRows(timeFile.text);
        const events = parseRows(eventFile.text);
        for (const { user, day } of affected.values()) {
          const id = `attendance:${user}:${day}`;
          const index = events.findIndex(item => item.id === id);
          if (index >= 0 && events[index].calendar_source !== 'attendance') fail('勤怠由来予定IDが通常予定と衝突しています', 409);
          const derived = attendance.deriveEvent(times, user, day, index >= 0 ? events[index] : null);
          if (!derived) { if (index >= 0) events.splice(index, 1); continue; }
          if (index >= 0) events[index] = { ...events[index], ...derived }; else events.push(derived);
        }
        await write(eventFile, events);
      }
    };
    return Object.freeze({
      domains: DOMAINS, identity: boundRoot,
      scope: workspaceId === 'cloud-local-workspace' || provider.constructor?.name === 'BrowserStorageProvider'
        ? 'device-local' : 'joined-workspace',
      async captureDomain(domain) {
        if (domain === 'reverse-sync') {
          const file = await readPath(REVERSE_SYNC_PATH);
          secretFreeLedger(file.text);
          return { targets: [`${workspaceId}/google-tasks-task-links`], revisions: { [REVERSE_SYNC_PATH]: file.revision } };
        }
        const targets = [];
        const revisions = {};
        for (const store of storesFor(domain)) {
          const file = await read(store);
          revisions[file.path] = file.revision;
          const rows = parseRows(file.text);
          for (const row of rows.filter(item => belongs(domain, store, item))) {
            allowed(domain, store, row);
            targets.push(...targetsForRows(domain, store, [row]));
          }
        }
        return { targets: [...new Set(targets)].sort(), revisions };
      },
      async enumerateTargets(domain) {
        return (await this.captureDomain(domain)).targets;
      },
      async createVersion(domain, targets, label, capture = null) {
        const rows = specs(domain, targets);
        const captured = capture || await this.captureDomain(domain);
        if (JSON.stringify(captured.targets) !== JSON.stringify([...targets].sort())) fail('Version対象の行集合が変わりました', 409);
        const references = [];
        const versionSpecs = domain === 'reverse-sync' ? [{ kind: 'ledger', path: REVERSE_SYNC_PATH }]
          : storesFor(domain).map(store => ({ kind: 'row', store }));
        for (const spec of versionSpecs) {
          await assertBound();
          const path = spec.path || pathFor(spec.store);
          const currentFile = await readPath(path);
          if (spec.kind === 'ledger') secretFreeLedger(currentFile.text);
          if (currentFile.revision !== captured.revisions[path]) fail('Version保存前にCloudファイルが変わりました', 409);
          const saved = await versionApi.save(provider, path, { label, auto: false, expectedRevision: captured.revisions[path] });
          references.push({ store: spec.store || '', path, versionId: String(saved.version || ''),
            providerRootIdentity: boundRoot, workspaceId, actor, role });
        }
        const savedTargets = [];
        for (const reference of references) {
          const saved = await versionApi.read(provider, reference.path, reference.versionId);
          if (domain === 'reverse-sync') { secretFreeLedger(saved.content); savedTargets.push(`${workspaceId}/google-tasks-task-links`); continue; }
          const savedRows = parseRows(saved.content);
          for (const row of savedRows.filter(item => belongs(domain, reference.store, item))) {
            allowed(domain, reference.store, row);
            savedTargets.push(...targetsForRows(domain, reference.store, [row]));
          }
        }
        if (JSON.stringify([...new Set(savedTargets)].sort()) !== JSON.stringify([...targets].sort())) fail('Version内容と復元対象が一致しません', 409);
        return { references, targets: clone(targets), itemCount: targets.length };
      },
      async targetRevisions(domain, targets) {
        const rows = specs(domain, targets);
        return Object.fromEntries(await Promise.all(rows.map(async spec => [spec.target, await rowRevision(domain, spec)])));
      },
      async derivedRevision(domain) {
        if (!['attendance', 'shift'].includes(domain)) return '';
        const events = parseRows((await read('events')).text).filter(event => domain === 'attendance'
          ? event.calendar_source === 'attendance' : ['shift', 'shift-break'].includes(event.calendar_source));
        return systemStorage.computeRevision(events.map(derivedProjection).sort((a, b) => String(a.id).localeCompare(String(b.id))));
      },
      async restoreTarget(domain, version, targets, target, expectedRevision, options = {}) {
        if (!targets.includes(target)) fail('復元対象がVersion IDと一致しません', 422);
        const spec = specs(domain, [target])[0];
        const reference = version?.references?.find(item => spec.kind === 'ledger' ? item.path === spec.path : item.store === spec.store && item.path === pathFor(spec.store));
        if (!reference?.versionId) fail('Version IDが復元対象と一致しません', 422);
        if (reference.providerRootIdentity !== boundRoot || reference.workspaceId !== workspaceId
          || reference.actor !== actor || reference.role !== role) fail('Version IDの復元境界が現在のrequestと一致しません', 409);
        if (spec.kind === 'ledger') {
          const [currentFile, saved] = await Promise.all([readPath(spec.path), versionApi.read(provider, reference.path, reference.versionId)]);
          const current = secretFreeLedger(currentFile.text);
          const source = secretFreeLedger(saved.content);
          if (JSON.stringify(version.targets || []) !== JSON.stringify([`${workspaceId}/google-tasks-task-links`])) fail('Version内容とledger対象が一致しません', 409);
          const observed = await systemStorage.computeRevision({ task_links: clone(current.task_links || []) });
          const desired = await systemStorage.computeRevision({ task_links: clone(source.task_links || []) });
          if (observed === desired) return { restored: (source.task_links || []).length, resumed: true };
          if (options.verifyOnly) fail('checkpoint後に復元済みledgerが変更されました', 409);
          if (observed !== expectedRevision) fail('復元対象の確認後に現在の状態が変わりました', 409);
          await provider.uploadBytesConditional(spec.path, new TextEncoder().encode(JSON.stringify({ ...current, task_links: clone(source.task_links || []) }, null, 2)), currentFile.revision);
          return { restored: (source.task_links || []).length };
        }
        const [file, saved] = await Promise.all([read(spec.store), versionApi.read(provider, reference.path, reference.versionId)]);
        const currentRows = parseRows(file.text);
        const savedRows = parseRows(saved.content);
        const expectedVersionTargets = (version.targets || []).filter(item => domain !== 'external-sync-import' || String(item).startsWith(`${spec.store}/`)).sort();
        const actualVersionTargets = [...new Set(targetsForRows(domain, spec.store, savedRows))].sort();
        if (JSON.stringify(actualVersionTargets) !== JSON.stringify(expectedVersionTargets)) fail('Version内容と復元対象が一致しません', 409);
        const index = currentRows.findIndex(item => String(item?.id || '') === spec.id);
        const current = index < 0 ? null : currentRows[index];
        const source = savedRows.find(item => String(item?.id || '') === spec.id) || null;
        assertOwned(domain, spec.store, current); assertOwned(domain, spec.store, source);
        allowed(domain, spec.store, current); allowed(domain, spec.store, source);
        const desired = source == null ? null : { ...(current || {}), ...source };
        const observed = await systemStorage.computeRevision({ store: spec.store, id: spec.id, row: projection(current) });
        const desiredRevision = await systemStorage.computeRevision({ store: spec.store, id: spec.id, row: projection(desired) });
        if (observed === desiredRevision) {
          if (options.verifyOnly) {
            await verifyDerived(domain, desired, current);
            return { restored: source == null ? 0 : 1, resumed: true, verified: true };
          }
          await assertDerivedOwnership(domain, desired, current);
          await syncDerived(domain, desired, current);
          return { restored: source == null ? 0 : 1, resumed: true };
        }
        if (options.verifyOnly) fail('checkpoint後に復元済み行が変更されました', 409);
        if (observed !== expectedRevision) fail('復元対象の確認後に現在の状態が変わりました', 409);
        await assertDerivedOwnership(domain, desired, current);
        if (source == null && index >= 0) currentRows.splice(index, 1);
        else if (index >= 0) currentRows[index] = desired;
        else if (source != null) currentRows.push(desired);
        const externalIds = new Set();
        for (const row of currentRows) {
          const sourceKind = String(row.calendar_source || row.task_source || '');
          const externalId = String(row.external_id || '');
          if (!externalId || sourceKind === 'shift' || sourceKind === 'shift-break') continue;
          const key = `${sourceKind}\u0000${externalId}`;
          if (externalIds.has(key)) fail('外部IDが重複するため復元できません', 409);
          externalIds.add(key);
        }
        await write(file, currentRows);
        await syncDerived(domain, desired, current);
        return { restored: source == null ? 0 : 1 };
      },
    });
  }

  window.MeldexSchedulerRowRestoreCloudAdapter = Object.freeze({ DOMAINS, create });
})();
