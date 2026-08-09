/* ==============================
   gb-cal-cloud-tasks.js: Cloud（Dropboxモード）向け Google ToDo（Google Tasks API）同期エンジン

   Cloud外部カレンダー連携 Phase 5・案A（app/docs/production-management-ux-improvement-plan-2026-08-04.md §6.5）の
   残り項目。Desktop側 meldex_api_google_tasks.py の対応付け・重複防止・完了状態の
   同期方向ロジックを仕様の正とし、ブラウザ完結（サーバー無し）版として同一挙動になる
   よう移植する。gb-cal-cloud-sync.js と同じ設計パターンに厳密に合わせる。

   認証: gb-cal-oauth-browser.js のPKCE+ポップアップ共通フロー（Google Calendarと共通）を
   使うが、トークンはカレンダー接続とは完全に独立して保存する（スコープが異なるため。
   Client ID/Secretも別入力・別トークンファイル）。gb-cal-oauth-browser.js の
   authorizeGoogle は Client ID/Secret 双方が必須のため、CloudのGoogle ToDoも
   Desktop版（Client IDのみ）とは異なりSecret入力を必須にする
   （gb-cal-oauth-browser.js は他レーンの契約のため変更しない）。

   このファイルは __MeldexPwaDataAccessExtensions ハンドラとして
   `/cal/sync/google/tasks/sync` を横取りする。Meldex.html 側で
   gb-data-access-dropbox-expanded.js より前に読み込むことで、同ファイルの
   「Cloud BETAでは無効です」catch-all より先にこのハンドラが応答する
   （gb-cal-cloud-sync.js と同じ配線パターン）。

   ローカルのToDo本体は /cal/tasks CRUD（gb-data-access-dropbox-expanded.part01.js の
   _calendarList/_calendarCreate/_calendarUpdate/_calendarDelete）が管理する
   _calendar/tasks.json をそのまま読み書きする（同期専用の別ストアは持たない。
   ToDoリストUIが見ているデータと完全に同じ行を同期対象にするため）。

   ローカル削除のGoogleへの反映について: Desktop版はSQLiteの削除トリガーで
   cal_task_sync_deletions テーブルへ記録するが、Cloud版は _calendarDelete
   （他レーンの成果物のため直接編集しない）にフックできない。代わりに、
   直前の同期で作成した「同期済みID対応表」（google_tasks_auth.json の
   task_links）と現在の _calendar/tasks.json を突き合わせ、対応表にあった
   idがローカルから消えていれば「ローカルで削除された」とみなしてGoogle側を
   削除する（差分スナップショット方式）。

   スコープ不足時の再認証: 保存済みトークンのscopeに'tasks'が含まれない場合
   （例: 何らかの理由で別スコープのトークンが混入した場合）は、アクセストークン・
   リフレッシュトークンを破棄して再ログインを促す（reauth_requiredと同じ導線）。

   秘密情報はログ出力しない。トークンをURLへ載せない。
   ============================== */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const { NOT_HANDLED, _joinPath, _requirePwaProvider, _directoryHandle, _readJsonSafe } = internals;

  const CAL_DIR = '_calendar';
  const TASKS_PATH = _joinPath(CAL_DIR, 'tasks.json');
  const GOOGLE_TASKS_AUTH_PATH = _joinPath(CAL_DIR, 'google_tasks_auth.json');
  const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
  const GOOGLE_TASKS_LIST_TITLE = 'Meldex';
  const GOOGLE_TASKS_SOURCE = 'google_tasks';
  const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';
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
    return `${prefix || 'task'}-${rand}`;
  }

  function _nowIso() {
    return new Date().toISOString();
  }

  // ============================================================
  // ストレージ（_calendar/ 配下のJSON。tasks.json は /cal/tasks CRUD と共有）
  // ============================================================

  // コミット前レビュー指摘 #10: gb-cal-cloud-sync.js と同じ理由・同じ仕組みで、
  // client_secret・access_token・refresh_token は gb-cal-oauth-store.js
  // （IndexedDB。gb-llm-keys-store.js の local-device モードと同じ保護水準）へ保存し、
  // Dropbox上の平文JSONには残さない。
  function _tokenKeyForPath(path) {
    if (path === GOOGLE_TASKS_AUTH_PATH) return 'google-tasks';
    return 'cal-cloud-tasks:' + String(path || '');
  }

  async function _readAuth(provider, path) {
    const stored = (await _readJsonSafe(provider, path, null)) || null;
    const store = window.MeldexCalOAuthTokenStore;
    if (!store) return stored; // トークンストア未読込時は安全側フォールバックとして旧挙動を維持
    const tokenKey = _tokenKeyForPath(path);
    let secrets = await store.getSecrets(tokenKey).catch(() => null);
    if (!secrets) {
      // 読み替え互換: 旧位置（Dropbox平文JSON）に秘密フィールドが残っていれば、
      // 新位置（IndexedDB）へ一度だけ移してから旧位置の平文フィールドを削除する。
      const legacySecrets = store.extractSecretFields(stored || {});
      if (store.hasAnySecretValue(legacySecrets)) {
        await store.setSecrets(tokenKey, legacySecrets).catch(() => {});
        secrets = legacySecrets;
        if (stored) {
          await _directoryHandle(provider, CAL_DIR, true);
          await provider.writeJson(path, store.stripSecretFields(stored)).catch(() => {});
        }
      }
    }
    if (!stored && !store.hasAnySecretValue(secrets)) return null;
    return { ...store.stripSecretFields(stored || {}), ...(secrets || {}) };
  }

  async function _writeAuth(provider, path, payload) {
    const store = window.MeldexCalOAuthTokenStore;
    let metadata = payload;
    if (store) {
      const tokenKey = _tokenKeyForPath(path);
      const secrets = store.extractSecretFields(payload);
      if (Object.keys(secrets).length) await store.setSecrets(tokenKey, secrets);
      metadata = store.stripSecretFields(payload);
    }
    await _directoryHandle(provider, CAL_DIR, true);
    await provider.writeJson(path, metadata);
  }

  async function _readTasks(provider) {
    const data = await _readJsonSafe(provider, TASKS_PATH, []);
    return Array.isArray(data) ? data : [];
  }

  async function _writeTasks(provider, rows) {
    await _directoryHandle(provider, CAL_DIR, true);
    await provider.writeJson(TASKS_PATH, Array.isArray(rows) ? rows : []);
  }

  function _findExternalTaskRow(rows, externalId, user) {
    if (!externalId) return null;
    const candidates = rows.filter((row) => (
      String(row.external_id || '') === externalId
      && String(row.task_source || '') === GOOGLE_TASKS_SOURCE
      && (!user || row.user === user || !row.user)
    ));
    if (!candidates.length) return null;
    return candidates.find((row) => row.user === user) || candidates[0];
  }

  function _relevantLocalRows(rows, user) {
    return rows.filter((row) => {
      const source = String(row.task_source || '');
      const sourceOk = !source || source === 'local' || source === GOOGLE_TASKS_SOURCE;
      const userOk = !user || row.user === user;
      return sourceOk && userOk;
    });
  }

  // ============================================================
  // 日時・ステータス・本文の変換（Desktop側 _google_tasks_to_local_iso /
  // _google_tasks_external_is_newer / _google_tasks_local_needs_push /
  // _google_tasks_status_to_meldex / _google_tasks_body_from_task と同じ意味論）
  // ============================================================

  function _pad2(n) { return String(n).padStart(2, '0'); }

  function _localIsoSeconds(date) {
    return `${date.getFullYear()}-${_pad2(date.getMonth() + 1)}-${_pad2(date.getDate())}`
      + `T${_pad2(date.getHours())}:${_pad2(date.getMinutes())}:${_pad2(date.getSeconds())}`;
  }

  function _tasksToLocalIso(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw.slice(0, 19);
    return _localIsoSeconds(date);
  }

  function _tasksDt(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function _tasksExternalIsNewer(row, remoteUpdatedIso) {
    const remote = _tasksDt(remoteUpdatedIso);
    const local = _tasksDt(row?.modified);
    if (!remote) return true;
    if (!local) return true;
    return remote.getTime() > local.getTime();
  }

  function _tasksLocalNeedsPush(row) {
    if (!String(row?.external_id || '').trim()) return true;
    const local = _tasksDt(row?.modified);
    const synced = _tasksDt(row?.last_synced);
    if (!synced) return true;
    if (!local) return false;
    return local.getTime() > synced.getTime();
  }

  function _tasksDueToDate(value) {
    const raw = String(value || '').trim();
    return raw.length >= 10 ? raw.slice(0, 10) : '';
  }

  function _tasksStatusToMeldex(remoteStatus, localStatus) {
    if (String(remoteStatus || '') === 'completed') return 'done';
    const local = String(localStatus || '');
    if (['backlog', 'todo', 'in_progress', 'review', 'done'].includes(local)) return local;
    return 'todo';
  }

  function _tasksBodyFromRow(row, { includeClear } = {}) {
    const body = {
      title: String(row?.title || '無題'),
      notes: String(row?.description || ''),
      status: String(row?.status || '') === 'done' ? 'completed' : 'needsAction',
    };
    const due = String(row?.due_date || '').trim().slice(0, 10);
    if (due) body.due = due + 'T00:00:00.000Z';
    else if (includeClear) body.due = null;
    return body;
  }

  // ============================================================
  // Google Tasks API（fetch直叩き。gb-cal-cloud-sync.js の _graphJson/_googleEventsPage と同じ形）
  // ============================================================

  function _tasksQuote(value) { return encodeURIComponent(String(value || '')); }

  function _tasksRemotePath(tasklistId, taskId) {
    const base = '/lists/' + _tasksQuote(tasklistId) + '/tasks';
    return taskId ? base + '/' + _tasksQuote(taskId) : base;
  }

  async function _tasksApiJson(accessToken, method, pathOrUrl, body, options = {}) {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : TASKS_API_BASE + pathOrUrl;
    const headers = { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' };
    const init = { method, headers };
    if (body !== undefined) { init.body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const response = await fetch(url, init);
    if (options.allow404 && response.status === 404) return { missing: true };
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw _httpError(detail?.error?.message || `Google Tasks APIエラー(${response.status})`, response.status);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  async function _tasksPagedItems(accessToken, path) {
    const items = [];
    let pageToken = '';
    for (;;) {
      const sep = path.includes('?') ? '&' : '?';
      const pagePath = path + (pageToken ? sep + 'pageToken=' + encodeURIComponent(pageToken) : '');
      const data = await _tasksApiJson(accessToken, 'GET', pagePath);
      items.push(...(data.items || []));
      pageToken = data.nextPageToken || '';
      if (!pageToken) return items;
    }
  }

  async function _tasksRemoteItems(accessToken, tasklistId) {
    const query = 'showCompleted=true&showDeleted=true&showHidden=true&maxResults=100';
    return _tasksPagedItems(accessToken, _tasksRemotePath(tasklistId) + '?' + query);
  }

  // ============================================================
  // 認証・トークン更新・スコープ確認
  // ============================================================

  async function _googleTasksAccessToken(provider) {
    const auth = await _readAuth(provider, GOOGLE_TASKS_AUTH_PATH);
    if (!auth?.refresh_token) throw _httpError('Google ToDo未接続', 400, 'not_connected');
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
        scope: refreshed.scope || auth.scope || '',
      };
      await _writeAuth(provider, GOOGLE_TASKS_AUTH_PATH, next);
      return next;
    } catch {
      // gb-cal-cloud-sync.js の _googleAccessToken と同じ理由でrefresh_tokenごと破棄し、
      // 次回 /cal/sync/status で connected:false に戻して再認証導線（ログインフォーム
      // 再表示）につなげる。
      await _writeAuth(provider, GOOGLE_TASKS_AUTH_PATH, { ...auth, access_token: '', refresh_token: '', expires_at: 0 }).catch(() => {});
      throw _httpError('Google ToDoの認証が失効しました。もう一度ログインしてください', 400, 'reauth_required');
    }
  }

  async function _requireTasksScope(provider, auth) {
    const scope = String(auth?.scope || '');
    if (scope && !scope.includes('tasks')) {
      // この接続はtasksスコープを含まないトークンで保存されている（再認証導線）。
      // access/refresh_tokenを破棄し、次回のstatusで未接続に戻す。
      await _writeAuth(provider, GOOGLE_TASKS_AUTH_PATH, { ...auth, access_token: '', refresh_token: '', expires_at: 0 }).catch(() => {});
      throw _httpError('この接続にはGoogle ToDoの権限が含まれていません。もう一度ログインしてください', 400, 'insufficient_scope');
    }
  }

  async function _googleTasksEnsureList(provider, auth) {
    if (auth.tasklist_id) return auth.tasklist_id;
    const lists = await _tasksPagedItems(auth.access_token, '/users/@me/lists?maxResults=100');
    const existing = lists.find((item) => item.title === GOOGLE_TASKS_LIST_TITLE && item.id);
    if (existing) {
      await _writeAuth(provider, GOOGLE_TASKS_AUTH_PATH, { ...auth, tasklist_id: existing.id, tasklist_title: GOOGLE_TASKS_LIST_TITLE });
      return existing.id;
    }
    const created = await _tasksApiJson(auth.access_token, 'POST', '/users/@me/lists', { title: GOOGLE_TASKS_LIST_TITLE });
    if (!created.id) throw _httpError('Google ToDoリストを作成できませんでした', 502);
    await _writeAuth(provider, GOOGLE_TASKS_AUTH_PATH, { ...auth, tasklist_id: created.id, tasklist_title: GOOGLE_TASKS_LIST_TITLE });
    return created.id;
  }

  // ============================================================
  // pull（Google → ローカル）
  // ============================================================

  function _applyRemoteTask(rows, remote, user, now) {
    const extId = String(remote?.id || '').trim();
    if (!extId) return 'skipped';
    const existing = _findExternalTaskRow(rows, extId, user);
    const remoteUpdated = _tasksToLocalIso(remote.updated) || now;
    if (remote.deleted) {
      if (existing && _tasksExternalIsNewer(existing, remoteUpdated)) {
        rows.splice(rows.indexOf(existing), 1);
        return 'deleted';
      }
      return 'skipped';
    }
    const title = String(remote.title || '無題');
    const description = String(remote.notes || '');
    const dueDate = _tasksDueToDate(remote.due || '');
    if (existing) {
      if (!_tasksExternalIsNewer(existing, remoteUpdated)) return 'skipped';
      Object.assign(existing, {
        title, description, due_date: dueDate,
        status: _tasksStatusToMeldex(remote.status, existing.status),
        external_id: extId, task_source: GOOGLE_TASKS_SOURCE,
        last_synced: remoteUpdated, modified: remoteUpdated,
      });
      return 'updated';
    }
    rows.push({
      id: _randomId('gtask'), title, description,
      status: _tasksStatusToMeldex(remote.status, ''),
      priority: 'medium', due_date: dueDate,
      assignee: '', labels: [], parent_id: '',
      estimated_hours: 0, actual_hours: 0, related_path: '', sort_order: 0,
      user: user || 'anonymous', creator: user || 'anonymous',
      external_id: extId, task_source: GOOGLE_TASKS_SOURCE,
      last_synced: remoteUpdated, created: remoteUpdated, modified: remoteUpdated,
    });
    return 'imported';
  }

  async function _pullGoogleTasks(rows, auth, tasklistId, user, now) {
    const items = await _tasksRemoteItems(auth.access_token, tasklistId);
    let imported = 0; let updated = 0; let deleted = 0; let skipped = 0;
    items.forEach((remote) => {
      const action = _applyRemoteTask(rows, remote, user, now);
      if (action === 'imported') imported += 1;
      else if (action === 'updated') updated += 1;
      else if (action === 'deleted') deleted += 1;
      else skipped += 1;
    });
    return { imported, updated, deleted, skipped, total: items.length };
  }

  // ============================================================
  // push（ローカル → Google）。削除の反映は取得より先に行う
  // （Desktop側 _sync_google_tasks と同じ順序。逆順だと、ローカルで削除済みの
  //   タスクがGoogle側にまだ残っている状態のまま取得され、再インポートされて
  //   一時的に復活してしまう）
  // ============================================================

  function _linksFromRows(rows, user) {
    return rows
      .filter((row) => String(row.task_source || '') === GOOGLE_TASKS_SOURCE && row.external_id)
      .filter((row) => !user || row.user === user)
      .map((row) => ({ id: row.id, external_id: row.external_id, user: row.user || '' }));
  }

  function _mergeLinks(previousLinks, currentUserLinks, user) {
    const others = user ? previousLinks.filter((link) => link.user !== user) : [];
    return [...others, ...currentUserLinks];
  }

  async function _pushDeletedLocal(auth, tasklistId, rows, user) {
    const previousLinks = Array.isArray(auth.task_links) ? auth.task_links : [];
    const relevant = user ? previousLinks.filter((link) => link.user === user) : previousLinks;
    const currentIds = new Set(rows.map((row) => row.id));
    let deleted = 0;
    for (const link of relevant) {
      if (currentIds.has(link.id) || !link.external_id) continue;
      await _tasksApiJson(auth.access_token, 'DELETE', _tasksRemotePath(tasklistId, link.external_id), undefined, { allow404: true });
      deleted += 1;
    }
    return deleted;
  }

  async function _pushLocalTasks(auth, tasklistId, rows, user, now) {
    const result = { pushed: 0, updated: 0, skipped: 0 };
    for (const row of _relevantLocalRows(rows, user)) {
      const externalId = String(row.external_id || '').trim();
      if (externalId && !_tasksLocalNeedsPush(row)) { result.skipped += 1; continue; }
      let response;
      if (externalId) {
        response = await _tasksApiJson(auth.access_token, 'PATCH', _tasksRemotePath(tasklistId, externalId), _tasksBodyFromRow(row, { includeClear: true }), { allow404: true });
        if (response.missing) {
          response = await _tasksApiJson(auth.access_token, 'POST', _tasksRemotePath(tasklistId), _tasksBodyFromRow(row));
          result.pushed += 1;
        } else {
          result.updated += 1;
        }
      } else {
        response = await _tasksApiJson(auth.access_token, 'POST', _tasksRemotePath(tasklistId), _tasksBodyFromRow(row));
        result.pushed += 1;
      }
      const remoteId = response.id || externalId;
      const synced = _tasksToLocalIso(response.updated) || now;
      row.external_id = remoteId;
      row.task_source = GOOGLE_TASKS_SOURCE;
      row.last_synced = synced;
      row.modified = synced;
    }
    return result;
  }

  // ============================================================
  // 同期オーケストレーション
  // ============================================================

  async function _syncGoogleTasks(provider, body) {
    const user = String(body?.user || '').trim();
    const auth0 = await _googleTasksAccessToken(provider);
    await _requireTasksScope(provider, auth0);
    const tasklistId = await _googleTasksEnsureList(provider, auth0);
    const auth = (await _readAuth(provider, GOOGLE_TASKS_AUTH_PATH)) || auth0;
    const rows = await _readTasks(provider);
    const now = _nowIso();

    const deletedRemote = await _pushDeletedLocal(auth, tasklistId, rows, user);
    const pull = await _pullGoogleTasks(rows, auth, tasklistId, user, now);
    const push = await _pushLocalTasks(auth, tasklistId, rows, user, now);

    await _writeTasks(provider, rows);

    const currentUserLinks = _linksFromRows(rows, user);
    const previousLinks = Array.isArray(auth.task_links) ? auth.task_links : [];
    await _writeAuth(provider, GOOGLE_TASKS_AUTH_PATH, { ...auth, task_links: _mergeLinks(previousLinks, currentUserLinks, user) });

    return {
      ok: true,
      tasklist_id: tasklistId,
      pull,
      push,
      deleted_remote: deletedRemote,
      imported: pull.imported,
      updated: pull.updated + push.updated,
      pushed: push.pushed,
      deleted: pull.deleted,
      skipped: pull.skipped + push.skipped,
      total: pull.total,
    };
  }

  // ============================================================
  // ステータス・ハンドラ登録
  // ============================================================

  async function _statusPayload(provider) {
    const auth = await _readAuth(provider, GOOGLE_TASKS_AUTH_PATH);
    return {
      available: true,
      connected: !!auth?.refresh_token,
      listTitle: auth?.tasklist_title || GOOGLE_TASKS_LIST_TITLE,
    };
  }

  async function _calCloudTasksHandler({ method, body, pathname }) {
    if (pathname === '/cal/sync/google/tasks/sync' && method === 'POST') {
      return _syncGoogleTasks(await _requirePwaProvider('readwrite'), body || {});
    }
    return NOT_HANDLED;
  }
  handlers.push(_calCloudTasksHandler);

  // ============================================================
  // 認証（UI直接呼び出し用。gb-cal-cloud-sync.js の authorizeGoogle/authorizeMicrosoft と
  // 同じ理由でポップアップをクリックハンドラから同期的に開けるよう、apiPost経由の
  // 間接呼び出しにはしない）
  // ============================================================

  async function authorizeGoogleTasks({ clientId, clientSecret, popup }) {
    const id = String(clientId || '').trim();
    const secret = String(clientSecret || '').trim();
    const { token } = await _oauth().google.authorize({ clientId: id, clientSecret: secret, scope: GOOGLE_TASKS_SCOPE, popup });
    const provider = await _requirePwaProvider('readwrite');
    const existing = await _readAuth(provider, GOOGLE_TASKS_AUTH_PATH);
    await _writeAuth(provider, GOOGLE_TASKS_AUTH_PATH, {
      client_id: id,
      client_secret: secret,
      access_token: token.access_token,
      refresh_token: token.refresh_token || existing?.refresh_token || '',
      expires_at: Date.now() + Math.max(60, Number(token.expires_in || 3600)) * 1000,
      scope: token.scope || '',
      tasklist_id: existing?.tasklist_id || '',
      tasklist_title: existing?.tasklist_title || GOOGLE_TASKS_LIST_TITLE,
      task_links: existing?.task_links || [],
      connected_at: _nowIso(),
    });
    return { ok: true, message: 'Google ToDo認証成功' };
  }

  window.MeldexCalCloudTasks = {
    TASKS_PATH,
    GOOGLE_TASKS_AUTH_PATH,
    GOOGLE_TASKS_SCOPE,
    authorizeGoogleTasks,
    // テスト・診断用に内部関数も公開する（gb-cal-cloud-sync.js の _internal と同じ方針）。
    _internal: {
      statusPayload: _statusPayload,
      syncGoogleTasks: _syncGoogleTasks,
      readAuth: _readAuth,
      writeAuth: _writeAuth,
      readTasks: _readTasks,
      writeTasks: _writeTasks,
    },
  };
})();
