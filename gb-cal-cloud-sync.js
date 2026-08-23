/* ==============================
   gb-cal-cloud-sync.js: Cloud（Dropboxモード）向け Google/Microsoft Calendar 同期エンジン

   Cloud外部カレンダー連携 Phase 5・案A（app/docs/production-management-ux-improvement-plan-2026-08-04.md §6.5）。
   Desktop側 meldex_api_calendar_sync.part01.part01.py / part02.py の
   フィールドマッピング・対応付け・重複防止ロジックを仕様の正とし、ブラウザ完結
   （サーバー無し）版として同一挙動になるよう移植する。

   認証: gb-cal-oauth-browser.js のPKCE+ポップアップ共通フローを使う（Google/Microsoft
   共通）。認証状態・トークン・差分同期用の状態（syncToken/deltaLink）は、接続中の
   Dropboxワークスペース内 `_calendar/` フォルダへ保存する（gb-data-access-dropbox-expanded
   の calendar store と同じ置き場。ワークスペース単位で保存されリロード後も維持される）。

   このファイルは __MeldexPwaDataAccessExtensions ハンドラとして
   `/cal/sync/status` `/cal/sync/google/pull` `/cal/sync/google/push`
   `/cal/sync/microsoft/pull` `/cal/sync/microsoft/push` を横取りする。
   Meldex.html 側で gb-data-access-dropbox-expanded.js より前に読み込むことで、
   同ファイルの「Cloud BETAでは無効です」catch-all より先にこのハンドラが応答する
   （gb-staff-registry-cloud-twin.js と同じ配線パターン。
   gb-data-access-dropbox-expanded.part01.js / part02.js は他レーンの成果があるため
   直接編集しない）。

   認証コード交換・トークン更新（`/cal/sync/google/auth` 等）はこのハンドラでは
   扱わない。ポップアップはユーザー操作（クリック）から同期的に開く必要があるため、
   gb-tool-calendar-sync.js のCloud専用ボタン処理が window.MeldexCalCloudSync の
   authorizeGoogle/authorizeMicrosoft を直接呼び出す（fetch経由の非同期チェーンを
   挟むとポップアップブロッカーに阻まれるリスクがあるため）。

   秘密情報はログ出力しない。トークンをURLへ載せない。
   ============================== */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const { NOT_HANDLED, _joinPath, _requirePwaProvider, _directoryHandle, _readJsonSafe } = internals;

  const CAL_DIR = '_calendar';
  const EVENTS_PATH = _joinPath(CAL_DIR, 'events.json');
  const GOOGLE_AUTH_PATH = _joinPath(CAL_DIR, 'google_calendar_auth.json');
  const MICROSOFT_AUTH_PATH = _joinPath(CAL_DIR, 'microsoft_calendar_auth.json');
  const TOKEN_EARLY_REFRESH_MS = 60 * 1000;

  function _oauth() {
    const api = window.MeldexCalOAuthBrowser;
    if (!api) throw new Error('gb-cal-oauth-browser.js が読み込まれていません');
    return api;
  }

  function _httpError(message, status, code) {
    const err = new Error(message);
    err.status = status || 500;
    if (code) err.code = code;
    return err;
  }

  function _randomId(prefix) {
    const rand = (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2)) + Date.now().toString(36);
    return `${prefix || 'ev'}-${rand}`;
  }

  function _nowIso() {
    return new Date().toISOString();
  }

  function _syncAccessBody(body) {
    if (!window.MeldexRuntimeAdapter?.getWorkspaceState) return body || {};
    const state = window.MeldexRuntimeAdapter.getWorkspaceState() || {};
    const role = String(state.access || state.role || '').toLowerCase();
    const admin = state.isOwner === true || role === 'owner' || role === 'admin';
    let actor = '';
    try { actor = String(typeof getUsername === 'function' ? getUsername() : '').trim(); } catch {}
    if (!actor) {
      try { actor = String(JSON.parse(localStorage.getItem('meldex-user') || '{}').name || '').trim(); } catch {}
    }
    const requested = String(body?.user || '').trim();
    if (!admin) throw _httpError('外部カレンダーを同期できるのは管理者のみです', 403, 'CALENDAR_SYNC_ADMIN_REQUIRED');
    return { ...(body || {}), user: requested || actor };
  }

  function _assertSharedAuthAdmin() {
    if (!window.MeldexRuntimeAdapter?.getWorkspaceState) return;
    const state = window.MeldexRuntimeAdapter.getWorkspaceState() || {};
    const role = String(state.access || state.role || '').toLowerCase();
    if (state.isOwner !== true && role !== 'owner' && role !== 'admin') {
      throw _httpError('共有カレンダー連携を設定できるのは管理者のみです', 403, 'CALENDAR_SYNC_ADMIN_REQUIRED');
    }
  }

  async function _stableProviderEventKey(localId) {
    const text = String(localId || 'event');
    if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return 'meld' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    let output = '';
    for (let seed = 0; seed < 8; seed += 1) {
      let hash = (2166136261 ^ seed) >>> 0;
      for (const char of text) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
      output += hash.toString(16).padStart(8, '0');
    }
    return 'meld' + output;
  }

  // ============================================================
  // ストレージ（_calendar/ 配下のJSON。既存の calendar store と同じ置き場）
  // ============================================================

  // コミット前レビュー指摘 #10: client_secret・access_token・refresh_token は
  // gb-cal-oauth-store.js（IndexedDB。gb-llm-keys-store.js の local-device モードと
  // 同じ保護水準）へ保存し、Dropbox上の平文JSONには残さない。client_id・tenant・
  // sync_state 等の非秘匿な接続メタデータだけを従来どおりDropbox JSONへ置く（複数端末での
  // 接続状態表示・差分同期の継続に必要なため）。
  function _tokenKeyForPath(path) {
    if (path === GOOGLE_AUTH_PATH) return 'google';
    if (path === MICROSOFT_AUTH_PATH) return 'microsoft';
    return 'cal-cloud-sync:' + String(path || '');
  }

  function _oauthSecretStoreError(cause) {
    const error = _httpError('OAuth秘密情報の端末保護ストアを利用できません', 503, 'OAUTH_SECRET_STORE_UNAVAILABLE');
    if (cause) error.cause = cause;
    return error;
  }

  function _requireOAuthSecretStore() {
    const store = window.MeldexCalOAuthTokenStore;
    if (store) return store;
    if (window.MeldexRuntimeAdapter?.getWorkspaceState) throw _oauthSecretStoreError();
    return null;
  }

  function _sameSecretValues(expected, actual) {
    return Object.keys(expected || {}).every(field => String(actual?.[field] || '') === String(expected[field] || ''));
  }

  async function _readAuth(provider, path) {
    const stored = (await _readJsonSafe(provider, path, null)) || null;
    const store = _requireOAuthSecretStore();
    if (!store) return stored; // 明示的な旧ローカル実行環境だけは従来形式を読み取る
    const tokenKey = _tokenKeyForPath(path);
    const legacySecrets = store.extractSecretFields(stored || {});
    let secrets;
    try {
      secrets = await store.getSecrets(tokenKey);
      if (store.hasAnySecretValue(legacySecrets)) {
        const saved = await store.setSecrets(tokenKey, legacySecrets);
        const confirmed = await store.getSecrets(tokenKey);
        if (saved?.ok === false || !_sameSecretValues(legacySecrets, confirmed)) throw new Error('OAuth secret store verification failed');
        await _directoryHandle(provider, CAL_DIR, true);
        await provider.writeJson(path, store.stripSecretFields(stored));
        const scrubbed = (await _readJsonSafe(provider, path, null)) || {};
        if (store.hasAnySecretValue(store.extractSecretFields(scrubbed))) throw new Error('Dropbox OAuth secret scrub verification failed');
        secrets = confirmed;
      }
    } catch (error) {
      throw _oauthSecretStoreError(error);
    }
    if (!stored && !store.hasAnySecretValue(secrets)) return null;
    return { ...store.stripSecretFields(stored || {}), ...(secrets || {}) };
  }

  async function _writeAuth(provider, path, payload) {
    const store = _requireOAuthSecretStore();
    let metadata = payload;
    if (store) {
      const tokenKey = _tokenKeyForPath(path);
      const secrets = store.extractSecretFields(payload);
      if (Object.keys(secrets).length) {
        try {
          const saved = await store.setSecrets(tokenKey, secrets);
          const confirmed = await store.getSecrets(tokenKey);
          if (saved?.ok === false || !_sameSecretValues(secrets, confirmed)) throw new Error('OAuth secret store verification failed');
        } catch (error) {
          throw _oauthSecretStoreError(error);
        }
      }
      metadata = store.stripSecretFields(payload);
    }
    await _directoryHandle(provider, CAL_DIR, true);
    await provider.writeJson(path, metadata);
  }

  async function _readEvents(provider) {
    const data = await _readJsonSafe(provider, EVENTS_PATH, []);
    return Array.isArray(data) ? data : [];
  }

  async function _writeEvents(provider, rows) {
    await _directoryHandle(provider, CAL_DIR, true);
    await provider.writeJson(EVENTS_PATH, Array.isArray(rows) ? rows : []);
  }

  function _findExternalRow(rows, source, externalId, user) {
    if (!externalId) return null;
    const candidates = rows.filter((row) => (
      String(row.external_id || '') === externalId
      && String(row.calendar_source || '') === source
      && (!user || row.user === user || !row.user)
    ));
    if (!candidates.length) return null;
    return candidates.find((row) => row.user === user) || candidates[0];
  }

  function _isLocalUnsent(row, user) {
    if (row.external_id) return false;
    if (row.calendar_source && row.calendar_source !== 'local') return false;
    return !user || row.user === user;
  }

  // ============================================================
  // 日時・全日イベントの変換（Desktop側 _google_all_day_end_to_local /
  // _local_all_day_end_to_google と同じ意味論。VEVENTのDTENDは排他的終了日のため、
  // Meldex内部の「最終日を含む終了日」表現との間で相互変換する）
  // ============================================================

  function _dateOnly(value) {
    return String(value || '').slice(0, 10);
  }

  function _addDaysToDateStr(dateStr, days) {
    const parts = _dateOnly(dateStr).split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateStr;
    const utc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    utc.setUTCDate(utc.getUTCDate() + days);
    return utc.toISOString().slice(0, 10);
  }

  function _googleAllDayEndToLocal(startIso, endIso) {
    if (!endIso) return startIso;
    const startDay = _dateOnly(startIso);
    const endDay = _dateOnly(endIso);
    if (endDay > startDay) return _addDaysToDateStr(endDay, -1);
    return endIso;
  }

  function _localAllDayEndToGoogle(startIso, endIso) {
    const base = endIso || startIso;
    const startDay = _dateOnly(startIso);
    let endDay = _dateOnly(base);
    if (endDay < startDay) endDay = startDay;
    return _addDaysToDateStr(endDay, 1);
  }

  function _withSeconds(value) {
    // UI保存値は分精度（YYYY-MM-DDTHH:MM）のことがあるため、RFC3339が要求する秒を補う
    const text = String(value || '');
    return text.length === 16 ? text + ':00' : text;
  }

  // ============================================================
  // Google Calendar
  // ============================================================

  const GOOGLE_API_BASE = 'https://www.googleapis.com/calendar/v3';

  async function _googleAccessToken(provider) {
    const auth = await _readAuth(provider, GOOGLE_AUTH_PATH);
    if (!auth?.refresh_token) throw _httpError('Google Calendar未接続', 400, 'not_connected');
    if (auth.access_token && Number(auth.expires_at || 0) > Date.now() + TOKEN_EARLY_REFRESH_MS) return auth;
    try {
      const refreshed = await _oauth().google.refreshToken({
        refreshToken: auth.refresh_token, clientId: auth.client_id, clientSecret: auth.client_secret,
      });
      const next = {
        ...auth,
        access_token: refreshed.access_token,
        expires_at: Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000,
        refresh_token: refreshed.refresh_token || auth.refresh_token,
      };
      await _writeAuth(provider, GOOGLE_AUTH_PATH, next);
      return next;
    } catch {
      // refresh_tokenごと失効している（取り消し・期限切れ）ため、次回 /cal/sync/status で
      // connected:false に戻し、同期モーダルにログインフォームが再表示されるようにする
      // （再認証導線。access_token/refresh_tokenのみ破棄しclient_id/secretは残して手間を減らす）。
      await _writeAuth(provider, GOOGLE_AUTH_PATH, { ...auth, access_token: '', refresh_token: '', expires_at: 0 }).catch(() => {});
      throw _httpError('Googleの認証が失効しました。もう一度ログインしてください', 400, 'reauth_required');
    }
  }

  async function _googleEventsPage(accessToken, query, pageToken) {
    const url = new URL(GOOGLE_API_BASE + '/calendars/primary/events');
    Object.entries(query || {}).forEach(([key, value]) => { if (value != null) url.searchParams.set(key, value); });
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url.toString(), { headers: { Authorization: 'Bearer ' + accessToken } });
    if (response.status === 410) return { items: [], nextPageToken: '', nextSyncToken: '', expired: true };
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw _httpError(detail?.error?.message || `Google APIエラー(${response.status})`, response.status);
    }
    const data = await response.json();
    return { items: data.items || [], nextPageToken: data.nextPageToken || '', nextSyncToken: data.nextSyncToken || '', expired: false };
  }

  async function _googleEventsAll(accessToken, query) {
    const events = [];
    let pageToken = '';
    let nextSyncToken = '';
    for (;;) {
      const page = await _googleEventsPage(accessToken, query, pageToken);
      if (page.expired) return { events: [], nextSyncToken: '', expired: true };
      events.push(...page.items);
      nextSyncToken = page.nextSyncToken || nextSyncToken;
      pageToken = page.nextPageToken;
      if (!pageToken) return { events, nextSyncToken, expired: false };
    }
  }

  function _applyGoogleEvent(rows, ev, user, now) {
    const extId = ev.id || '';
    if (!extId) return 'skipped';
    const start = ev.start?.dateTime || ev.start?.date || '';
    const end = ev.end?.dateTime || ev.end?.date || '';
    const allDay = !!ev.start?.date;
    const endValue = allDay ? _googleAllDayEndToLocal(start, end) : end;
    const existing = _findExternalRow(rows, 'google', extId, user);
    if (existing) {
      Object.assign(existing, {
        title: ev.summary || '', start, end: endValue, all_day: allDay,
        description: ev.description || '', location: ev.location || '',
        user: existing.user || user || 'anonymous', creator: existing.creator || user || 'anonymous',
        modified: now,
      });
      return 'updated';
    }
    rows.push({
      id: _randomId('gcal'), title: ev.summary || '', start, end: endValue, all_day: allDay,
      description: ev.description || '', location: ev.location || '',
      external_id: extId, calendar_source: 'google',
      user: user || 'anonymous', creator: user || 'anonymous', members: [],
      created: now, modified: now,
    });
    return 'imported';
  }

  function _applyGoogleCancellation(rows, ev, user) {
    const extId = ev.id || '';
    if (!extId) return rows;
    const existing = _findExternalRow(rows, 'google', extId, user);
    if (!existing) return rows;
    return rows.filter((row) => row !== existing);
  }

  async function _googlePullFull(provider, user) {
    const auth = await _googleAccessToken(provider);
    const timeMin = new Date(Date.now() - 30 * 86400000).toISOString();
    const timeMax = new Date(Date.now() + 90 * 86400000).toISOString();
    const { events } = await _googleEventsAll(auth.access_token, {
      timeMin, timeMax, maxResults: 250, singleEvents: true, orderBy: 'startTime',
    });
    const rows = await _readEvents(provider);
    const now = _nowIso();
    let imported = 0; let updated = 0;
    events.forEach((ev) => {
      const action = _applyGoogleEvent(rows, ev, user, now);
      if (action === 'imported') imported += 1; else if (action === 'updated') updated += 1;
    });
    await _writeEvents(provider, rows);
    return { ok: true, imported, updated, total: events.length };
  }

  async function _googlePullIncremental(provider, user) {
    const auth = await _googleAccessToken(provider);
    const state = auth.sync_state || {};
    let { events, nextSyncToken, expired } = await _googleEventsAll(auth.access_token, {
      maxResults: 250, singleEvents: true, syncToken: state.sync_token || undefined, showDeleted: state.sync_token ? true : undefined,
    });
    let fallbackFull = false;
    if (expired) {
      fallbackFull = true;
      ({ events, nextSyncToken } = await _googleEventsAll(auth.access_token, { maxResults: 250, singleEvents: true }));
    }
    const rows = await _readEvents(provider);
    const now = _nowIso();
    let imported = 0; let updated = 0; let deleted = 0;
    let current = rows;
    events.forEach((ev) => {
      if (ev.status === 'cancelled') {
        const before = current.length;
        current = _applyGoogleCancellation(current, ev, user);
        if (current.length < before) deleted += 1;
      } else {
        const action = _applyGoogleEvent(current, ev, user, now);
        if (action === 'imported') imported += 1; else if (action === 'updated') updated += 1;
      }
    });
    await _writeEvents(provider, current);
    if (nextSyncToken) {
      await _writeAuth(provider, GOOGLE_AUTH_PATH, { ...auth, sync_state: { sync_token: nextSyncToken, updated_at: now } });
    }
    return { ok: true, imported, updated, deleted, total: events.length, incremental: true, fallback_full: fallbackFull };
  }

  async function _googlePull(provider, body) {
    const user = String(body?.user || '').trim();
    if (body?.incremental) return _googlePullIncremental(provider, user);
    return _googlePullFull(provider, user);
  }

  async function _googlePush(provider, body) {
    const user = String(body?.user || '').trim();
    const auth = await _googleAccessToken(provider);
    const rows = await _readEvents(provider);
    let pushed = 0;
    const errors = [];
    const now = _nowIso();
    for (const row of rows) {
      if (!_isLocalUnsent(row, user)) continue;
      try {
        const providerId = await _stableProviderEventKey(row.id);
        const eventBody = { id: providerId, summary: row.title || '', description: row.description || '', location: row.location || '' };
        if (row.all_day) {
          eventBody.start = { date: _dateOnly(row.start) };
          eventBody.end = { date: _localAllDayEndToGoogle(row.start, row.end || row.start) };
        } else {
          eventBody.start = { dateTime: _withSeconds(row.start), timeZone: 'Asia/Tokyo' };
          eventBody.end = { dateTime: _withSeconds(row.end || row.start), timeZone: 'Asia/Tokyo' };
        }
        const response = await fetch(GOOGLE_API_BASE + '/calendars/primary/events', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + auth.access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody),
        });
        if (!response.ok && response.status !== 409) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error?.message || `HTTP ${response.status}`);
        }
        const result = response.status === 409 ? { id: providerId } : await response.json();
        row.external_id = result.id || providerId;
        row.calendar_source = 'google';
        row.modified = now;
        pushed += 1;
      } catch (err) {
        errors.push({ id: row.id, title: row.title, error: err?.message || String(err) });
      }
    }
    await _writeEvents(provider, rows);
    return { ok: !errors.length, pushed, failed: errors.length, errors };
  }

  // ============================================================
  // Microsoft Calendar（Graph API）
  // ============================================================

  const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

  async function _microsoftAccessToken(provider) {
    const auth = await _readAuth(provider, MICROSOFT_AUTH_PATH);
    if (!auth?.refresh_token) throw _httpError('Microsoft Calendar未接続', 400, 'not_connected');
    if (auth.access_token && Number(auth.expires_at || 0) > Date.now() + TOKEN_EARLY_REFRESH_MS) return auth;
    try {
      const refreshed = await _oauth().microsoft.refreshToken({
        refreshToken: auth.refresh_token, clientId: auth.client_id, tenant: auth.tenant,
      });
      const next = {
        ...auth,
        access_token: refreshed.access_token,
        expires_at: Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000,
        refresh_token: refreshed.refresh_token || auth.refresh_token,
      };
      await _writeAuth(provider, MICROSOFT_AUTH_PATH, next);
      return next;
    } catch {
      // Google側と同じ理由でrefresh_tokenごと破棄し、再認証導線（ログインフォーム再表示）につなげる。
      await _writeAuth(provider, MICROSOFT_AUTH_PATH, { ...auth, access_token: '', refresh_token: '', expires_at: 0 }).catch(() => {});
      throw _httpError('Microsoftの認証が失効しました。もう一度ログインしてください', 400, 'reauth_required');
    }
  }

  async function _graphJson(method, pathOrUrl, accessToken, body) {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : GRAPH_BASE + pathOrUrl;
    const headers = { Authorization: 'Bearer ' + accessToken, Prefer: 'outlook.timezone="Asia/Tokyo", outlook.body-content-type="text"' };
    const init = { method, headers };
    if (body != null) { init.body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const response = await fetch(url, init);
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw _httpError(detail?.error?.message || `Microsoft Graphエラー(${response.status})`, response.status);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  async function _graphDelta(url, accessToken) {
    const headers = { Authorization: 'Bearer ' + accessToken, Prefer: 'outlook.timezone="Asia/Tokyo", odata.track-changes' };
    const response = await fetch(url, { headers });
    if (response.status === 410) return { data: {}, expired: true };
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw _httpError(detail?.error?.message || `Microsoft Graphエラー(${response.status})`, response.status);
    }
    return { data: await response.json(), expired: false };
  }

  async function _microsoftDeltaEvents(accessToken, deltaLink) {
    const events = [];
    let url = deltaLink;
    if (!url) {
      const start = new Date(Date.now() - 30 * 86400000).toISOString();
      const end = new Date(Date.now() + 365 * 86400000).toISOString();
      url = `${GRAPH_BASE}/me/calendarView/delta?${new URLSearchParams({ startDateTime: start, endDateTime: end })}`;
    }
    let nextDeltaLink = '';
    while (url) {
      const { data, expired } = await _graphDelta(url, accessToken);
      if (expired) return { events: [], nextDeltaLink: '', expired: true };
      events.push(...(data.value || []));
      nextDeltaLink = data['@odata.deltaLink'] || nextDeltaLink;
      url = data['@odata.nextLink'] || '';
    }
    return { events, nextDeltaLink, expired: false };
  }

  function _mcalEventTime(info, allDay) {
    const value = info?.dateTime || '';
    if (!value) return '';
    return allDay ? value.slice(0, 10) : value.slice(0, 19);
  }

  function _applyMicrosoftEvent(rows, ev, user, now) {
    const extId = ev.id || '';
    if (!extId) return 'skipped';
    const allDay = !!ev.isAllDay;
    const start = _mcalEventTime(ev.start, allDay);
    let end = _mcalEventTime(ev.end, allDay);
    if (allDay) end = _googleAllDayEndToLocal(start, end);
    const location = ev.location?.displayName || '';
    const existing = _findExternalRow(rows, 'microsoft', extId, user);
    if (existing) {
      Object.assign(existing, {
        title: ev.subject || '', start, end, all_day: allDay,
        description: ev.body?.content || '', location, url: ev.webLink || '', color: '#0078d4',
        user: existing.user || user || 'anonymous', creator: existing.creator || user || 'anonymous',
        modified: now,
      });
      return 'updated';
    }
    rows.push({
      id: _randomId('mcal'), title: ev.subject || '', start, end, all_day: allDay,
      description: ev.body?.content || '', location, url: ev.webLink || '', color: '#0078d4',
      external_id: extId, calendar_source: 'microsoft',
      user: user || 'anonymous', creator: user || 'anonymous', members: [],
      created: now, modified: now,
    });
    return 'imported';
  }

  function _applyMicrosoftRemoval(rows, ev, user) {
    const extId = ev.id || '';
    if (!extId) return rows;
    const existing = _findExternalRow(rows, 'microsoft', extId, user);
    if (!existing) return rows;
    return rows.filter((row) => row !== existing);
  }

  async function _microsoftPullFull(provider, user) {
    const auth = await _microsoftAccessToken(provider);
    const start = new Date(Date.now() - 30 * 86400000).toISOString();
    const end = new Date(Date.now() + 90 * 86400000).toISOString();
    const query = new URLSearchParams({ startDateTime: start, endDateTime: end, $top: '500', $orderby: 'start/dateTime' });
    let url = `/me/calendar/calendarView?${query}`;
    const events = [];
    while (url) {
      const data = await _graphJson('GET', url, auth.access_token);
      events.push(...(data.value || []));
      url = data['@odata.nextLink'] || '';
    }
    const rows = await _readEvents(provider);
    const now = _nowIso();
    let imported = 0; let updated = 0;
    events.forEach((ev) => {
      const action = _applyMicrosoftEvent(rows, ev, user, now);
      if (action === 'imported') imported += 1; else if (action === 'updated') updated += 1;
    });
    await _writeEvents(provider, rows);
    return { ok: true, imported, updated, total: events.length };
  }

  async function _microsoftPullIncremental(provider, user) {
    const auth = await _microsoftAccessToken(provider);
    const state = auth.sync_state || {};
    let { events, nextDeltaLink, expired } = await _microsoftDeltaEvents(auth.access_token, state.delta_link || '');
    let fallbackFull = false;
    if (expired) {
      fallbackFull = true;
      ({ events, nextDeltaLink } = await _microsoftDeltaEvents(auth.access_token, ''));
    }
    const rows = await _readEvents(provider);
    const now = _nowIso();
    let imported = 0; let updated = 0; let deleted = 0;
    let current = rows;
    events.forEach((ev) => {
      if (ev['@removed']) {
        const before = current.length;
        current = _applyMicrosoftRemoval(current, ev, user);
        if (current.length < before) deleted += 1;
      } else {
        const action = _applyMicrosoftEvent(current, ev, user, now);
        if (action === 'imported') imported += 1; else if (action === 'updated') updated += 1;
      }
    });
    await _writeEvents(provider, current);
    if (nextDeltaLink) {
      await _writeAuth(provider, MICROSOFT_AUTH_PATH, { ...auth, sync_state: { delta_link: nextDeltaLink, updated_at: now } });
    }
    return { ok: true, imported, updated, deleted, total: events.length, incremental: true, fallback_full: fallbackFull };
  }

  async function _microsoftPull(provider, body) {
    const user = String(body?.user || '').trim();
    if (body?.incremental) return _microsoftPullIncremental(provider, user);
    return _microsoftPullFull(provider, user);
  }

  function _microsoftEventBody(row) {
    const start = row.start || new Date().toISOString().slice(0, 16);
    const end = row.end || start;
    const body = {
      subject: row.title || '無題',
      body: { contentType: 'text', content: row.description || '' },
      location: { displayName: row.location || '' },
      isAllDay: !!row.all_day,
    };
    if (row.all_day) {
      const startDate = _dateOnly(start);
      const endDate = _localAllDayEndToGoogle(startDate, _dateOnly(end || start));
      body.start = { dateTime: startDate + 'T00:00:00', timeZone: 'Asia/Tokyo' };
      body.end = { dateTime: endDate + 'T00:00:00', timeZone: 'Asia/Tokyo' };
    } else {
      body.start = { dateTime: start.slice(0, 19), timeZone: 'Asia/Tokyo' };
      body.end = { dateTime: (end || start).slice(0, 19), timeZone: 'Asia/Tokyo' };
    }
    return body;
  }

  async function _microsoftPush(provider, body) {
    const user = String(body?.user || '').trim();
    const auth = await _microsoftAccessToken(provider);
    const rows = await _readEvents(provider);
    let pushed = 0;
    const errors = [];
    const now = _nowIso();
    for (const row of rows) {
      if (!_isLocalUnsent(row, user) || !row.start) continue;
      try {
        const eventBody = _microsoftEventBody(row);
        eventBody.transactionId = await _stableProviderEventKey(row.id);
        const result = await _graphJson('POST', '/me/events', auth.access_token, eventBody);
        if (!result.id) continue;
        row.external_id = result.id;
        row.calendar_source = 'microsoft';
        row.color = '#0078d4';
        row.url = result.webLink || '';
        row.modified = now;
        pushed += 1;
      } catch (error) {
        errors.push({ id: row.id, title: row.title, error: error?.message || String(error) });
      }
    }
    await _writeEvents(provider, rows);
    return { ok: errors.length === 0, pushed, failed: errors.length, errors };
  }

  // ============================================================
  // ステータス・ハンドラ登録
  // ============================================================

  async function _statusPayload(provider) {
    // Google ToDoは gb-cal-cloud-tasks.js（Phase 5・案A残り項目）が実装する。
    // 読み込み順に依存させないよう任意結合にし、未読込時は「利用不可」を返す。
    const googleTasksStatus = window.MeldexCalCloudTasks?._internal?.statusPayload;
    const [google, microsoft, googleTasks] = await Promise.all([
      _readAuth(provider, GOOGLE_AUTH_PATH),
      _readAuth(provider, MICROSOFT_AUTH_PATH),
      typeof googleTasksStatus === 'function' ? googleTasksStatus(provider) : Promise.resolve({ available: false, connected: false }),
    ]);
    return {
      google: { available: true, connected: !!google?.refresh_token },
      googleTasks,
      microsoft: { available: true, connected: !!microsoft?.refresh_token, tenant: microsoft?.tenant || 'common' },
      ical: { available: true, connected: false, supports_url_auth: false },
    };
  }

  function _withCalendarLease(provider, operation) {
    const lease = window.MeldexCloudCalendarLease;
    if (lease?.withLease) return lease.withLease(provider, context => operation(context?.guardProvider?.(provider) || provider));
    if (window.MeldexRuntimeAdapter?.getWorkspaceState) {
      throw _httpError('共有カレンダーの更新ロックを利用できません', 503, 'CALENDAR_LOCK_UNAVAILABLE');
    }
    return operation(provider);
  }

  async function _calCloudSyncHandler({ method, body, pathname }) {
    if (pathname === '/cal/sync/status' && method === 'GET') {
      return _statusPayload(await _requirePwaProvider('read'));
    }
    if (pathname === '/cal/sync/google/pull' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const accessBody = _syncAccessBody(body);
      return _withCalendarLease(provider, leasedProvider => _googlePull(leasedProvider, accessBody));
    }
    if (pathname === '/cal/sync/google/push' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const accessBody = _syncAccessBody(body);
      return _withCalendarLease(provider, leasedProvider => _googlePush(leasedProvider, accessBody));
    }
    if (pathname === '/cal/sync/microsoft/pull' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const accessBody = _syncAccessBody(body);
      return _withCalendarLease(provider, leasedProvider => _microsoftPull(leasedProvider, accessBody));
    }
    if (pathname === '/cal/sync/microsoft/push' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const accessBody = _syncAccessBody(body);
      return _withCalendarLease(provider, leasedProvider => _microsoftPush(leasedProvider, accessBody));
    }
    return NOT_HANDLED;
  }
  handlers.push(_calCloudSyncHandler);

  // ============================================================
  // 認証（UI直接呼び出し用。ポップアップをクリックハンドラから同期的に開けるよう
  // apiPost経由の間接呼び出しにはしない）
  // ============================================================

  async function authorizeGoogle({ clientId, clientSecret, popup }) {
    _assertSharedAuthAdmin();
    const id = String(clientId || '').trim();
    const secret = String(clientSecret || '').trim();
    const { token } = await _oauth().google.authorize({ clientId: id, clientSecret: secret, popup });
    const provider = await _requirePwaProvider('readwrite');
    const existing = await _readAuth(provider, GOOGLE_AUTH_PATH);
    await _writeAuth(provider, GOOGLE_AUTH_PATH, {
      client_id: id,
      client_secret: secret,
      access_token: token.access_token,
      refresh_token: token.refresh_token || existing?.refresh_token || '',
      expires_at: Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000,
      scope: token.scope || '',
      sync_state: existing?.sync_state || null,
      connected_at: _nowIso(),
    });
    return { ok: true, message: 'Google Calendar認証成功' };
  }

  async function authorizeMicrosoft({ clientId, tenant, popup }) {
    _assertSharedAuthAdmin();
    const id = String(clientId || '').trim();
    const tenantValue = String(tenant || 'common').trim() || 'common';
    const { token } = await _oauth().microsoft.authorize({ clientId: id, tenant: tenantValue, popup });
    const provider = await _requirePwaProvider('readwrite');
    const existing = await _readAuth(provider, MICROSOFT_AUTH_PATH);
    await _writeAuth(provider, MICROSOFT_AUTH_PATH, {
      client_id: id,
      tenant: tenantValue,
      access_token: token.access_token,
      refresh_token: token.refresh_token || existing?.refresh_token || '',
      expires_at: Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000,
      scope: token.scope || '',
      sync_state: existing?.sync_state || null,
      connected_at: _nowIso(),
    });
    return { ok: true, message: 'Microsoft Calendar認証成功' };
  }

  window.MeldexCalCloudSync = {
    EVENTS_PATH,
    GOOGLE_AUTH_PATH,
    MICROSOFT_AUTH_PATH,
    authorizeGoogle,
    authorizeMicrosoft,
    // テスト・診断用に内部関数も公開する（gb-tool-calendar-sync.js からは通常
    // apiPost('/cal/sync/...') 経由でハンドラを叩くため、直接呼ぶのは認証時のみ）。
    _internal: {
      statusPayload: _statusPayload,
      googlePull: _googlePull,
      googlePush: _googlePush,
      microsoftPull: _microsoftPull,
      microsoftPush: _microsoftPush,
      googleAccessToken: _googleAccessToken,
      readAuth: _readAuth,
      writeAuth: _writeAuth,
      readEvents: _readEvents,
      writeEvents: _writeEvents,
      googleAllDayEndToLocal: _googleAllDayEndToLocal,
      localAllDayEndToGoogle: _localAllDayEndToGoogle,
    },
  };
})();
