  const force = !!(payload.force_overwrite || payload.forceOverwrite);
  const createOnly = !!(payload.create_only || payload.createOnly);
  let revision = payload.transport_revision || payload.transportRevision
    || payload.if_match_transport_revision || payload.if_match_etag || payload.ifMatchEtag || '';

  if (revision && coordinator?.revisionTokenForWrite) {
    payload.if_match_etag = coordinator.revisionTokenForWrite(revision);
    return payload;
  }
  if (revision || force || createOnly) return payload;

  // revision無しの旧呼び出し元を、保存直前に取得した「最新revision」で
  // 延命してはいけない。古い本文へ最新revisionを付け直すと、読込後に別端末で
  // 更新された内容をCASに成功させて上書きしてしまう。ここで許可する自動補完は、
  // 保存先が存在しないことを確認できた時の create_only だけとする。
  try {
    const separator = String(path).includes('?') ? '&' : '?';
    const current = await apiFetch(`${path}${separator}metadata_only=1`, { silentError: true });
    coordinator?.bindDocumentIdentity?.(
      new URLSearchParams(String(path).split('?')[1] || '').get('path') || '',
      current,
    );
    const error = new Error('既存ファイルの保存には、読込時のrevisionが必要です');
    error.status = 428;
    error.meldexCode = 'precondition_required';
    error.meldexDetail = {
      code: 'precondition_required',
      path: new URLSearchParams(String(path).split('?')[1] || '').get('path') || '',
      current_etag: current?.etag || '',
      current_transport_revision: current?.transport_revision || null,
    };
    throw error;
  } catch (error) {
    if (error?.status === 404 && !(payload.skip_if_missing || payload.skipIfMissing)) {
      payload.create_only = true;
      return payload;
    }
    if (error?.status === 404 && (payload.skip_if_missing || payload.skipIfMissing)) return payload;
    throw error;
  }
}

let _gbAppUiConfigWriteTail = Promise.resolve();
const _gbAppPendingValueWrites = new Map();
const _gbAppValueWriteTails = new Map();
let _gbAppValueAccount = window.MeldexDropboxAuth?.getSession?.()?.accountId || '';
window.addEventListener?.('meldex:dropbox-auth-session-changed', event => {
  const account = String(event.detail?.accountId || '');
  if (account !== _gbAppValueAccount) _gbAppPendingValueWrites.clear();
  _gbAppValueAccount = account;
});
window.addEventListener?.('meldex:mode-changed', () => _gbAppPendingValueWrites.clear());

async function _gbAppPutValueConfirmed(path, body, options) {
  const key = String(path);
  const previous = _gbAppValueWriteTails.get(key);
  const pending = Promise.resolve(previous).catch(() => {}).then(async () => {
    const send = payload => apiFetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      ...(options || {}), body: JSON.stringify(payload), silentError: true });
    const uncertain = _gbAppPendingValueWrites.get(key);
    if (uncertain) {
      // 結果の分からなかった前回の保存を、同じ操作IDで送り直す。サーバーは反映済みの操作IDには記録した結果を返すので、
      // 4xx（版の食い違い等）で断られた時は「前回の保存は反映されていない」と確定する。その記録を捨てて今回の保存へ進む。
      // 捨てないと、その行の以後の保存・取り消し・やり直しが古い版の送り直しで断られ続ける（M-014 不具合33・36）。
      // 5xx・通信断の時は、まだ結果が分からないので従来どおり止める。
      let result = null;
      try { result = await send(uncertain); }
      catch (error) {
        const stillUnknown = error?.isTimeout || error?.name === 'AbortError' || Number(error?.status) >= 500
          || (error?.name === 'TypeError' && /fetch|network|load/i.test(error.message || ''));
        if (stillUnknown) throw error;
        result = null;
      }
      _gbAppPendingValueWrites.delete(key);
      if (result) {
        // 失敗と表示した保存が、この送り直しで入った。黙って入れずに知らせ、表示を読み直させる（2026-11-21 ユーザー決定）。
        try {
          window.dispatchEvent(new CustomEvent('meldex:value-write-replayed', { detail: { path: key, body: uncertain, result } }));
        } catch {}
        if (typeof showStatus === 'function') showStatus('前に失敗した保存を反映しました');
      }
      const canonical = value => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
      const withoutId = value => JSON.stringify(canonical(Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'operation_id'))));
      if (result && withoutId(body) === withoutId(uncertain)) return result;
      // Only an ordinary candidate patch may follow its own confirmed patch.
      // Whole-body edits and structural changes retain their original baseline.
      const baseKey = ['baseRevision', 'base_revision', 'entryRevision', 'revision'].find(k => body[k] != null);
      const oldBase = ['baseRevision', 'base_revision', 'entryRevision', 'revision'].find(k => uncertain[k] != null);
      if (body.property && body.candidate_index != null && !body.new_property && !('new_body' in body)
          && !uncertain._delete && !uncertain.new_property && !('new_body' in uncertain)
          && baseKey && oldBase && body[baseKey] === uncertain[oldBase] && result?.revision != null) {
        body = { ...body, [baseKey]: result.revision };
      }
    }
    const payload = { ...body, operation_id: body.operation_id || crypto.randomUUID() };
    try { return await send(payload); }
    catch (error) {
      const unknown = error?.isTimeout || error?.name === 'AbortError' || Number(error?.status) >= 500
        || (error?.name === 'TypeError' && /fetch|network|load/i.test(error.message || ''));
      if (!unknown) throw error;
      _gbAppPendingValueWrites.set(key, payload);
      const result = await send(payload);
      _gbAppPendingValueWrites.delete(key);
      return result;
    }
  });
  _gbAppValueWriteTails.set(key, pending);
  try { return await pending; }
  finally { if (_gbAppValueWriteTails.get(key) === pending) _gbAppValueWriteTails.delete(key); }
}

async function apiPut(path, body, options = {}) {
  const guardedBody = await _gbAppPrepareFullFileWrite(path, body);
  if (String(path).split('?')[0].replace(/^\/api/, '') === '/value') {
    const notify = phase => { if (typeof _gbAppNotifyEntityValuesChanged === 'function') _gbAppNotifyEntityValuesChanged(path, phase, guardedBody); };
    notify('pending');
    let result;
    try { result = await _gbAppPutValueConfirmed(path, guardedBody, options); }
    catch (error) { setTimeout(() => notify('failed'), 0); throw error; }
    _scheduleLinkDictionaryRefreshForMutation(path);
    notify('saved');
    return result;
  }
  const requestOptions = {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(guardedBody),
    ...(options || {}),
  };
  const send = () => apiFetch(path, requestOptions);
  // Whole settings snapshots must commit in user request order. A failed
  // snapshot rejects its own caller without poisoning subsequent saves.
  let result;
  if (String(path).split('?')[0].replace(/^\/api/, '') === '/ui-config') {
    const pending = _gbAppUiConfigWriteTail.catch(() => {}).then(send);
    _gbAppUiConfigWriteTail = pending;
    result = await pending;
  } else result = await send();
  _scheduleLinkDictionaryRefreshForMutation(path);
  window.MeldexChatManagementSheet?.notifyMutation?.(path, body);
  return result;
}

function _scheduleLinkDictionaryRefreshForMutation(path) {
  const pathname = String(path || '').split('?')[0];
  if (![
    '/value', '/entity/create', '/entity/rename',
    '/outliner/delete', '/outliner/delete-batch', '/outliner/rename',
  ].includes(pathname)) return;
  if (typeof MeldexAutoLink !== 'undefined' && typeof MeldexAutoLink.scheduleReload === 'function') {
    MeldexAutoLink.scheduleReload(3000);
  }
}

// 同じトピックを表示している別の面（サブパネルのトピックなど）へ、値の保存を知らせる（2026-11-21）。
// pending=保存の前（表の手元の値は反映済み）・saved=保存の後・failed=保存の失敗（表は元に戻る）。
function _gbAppNotifyEntityValuesChanged(path, phase, body) {
  try {
    if (String(path || '').split('?')[0].replace(/^\/api/, '') !== '/value') return;
    const entityPath = new URLSearchParams(String(path).split('?')[1] || '').get('path')
      || (body && typeof body === 'object' ? (body.entry_path || body.folder_path || '') : '');
    if (entityPath) window.dispatchEvent(new CustomEvent('meldex:entity-values-changed', { detail: { path: entityPath, phase } }));
  } catch {}
}

async function apiPost(path, body, options = {}) {
  // 開いているシナリオの表示名は、本文と同じCAS保存キューで確定する。
  // 別のタイトル書込とautosaveを並走させると、自分の変更が409になる。
  if (String(path || '').split('?')[0] === '/outliner/rename' && body?.title_only === true
      && ['scriptnote', 'scenario'].includes(body?.type) && window.MeldexScriptNoteTitleSave) {
    const saved = await window.MeldexScriptNoteTitleSave(body, options?.scriptnoteEditor);
    if (saved) {
      _scheduleLinkDictionaryRefreshForMutation(path);
      return saved;
    }
  }
  let stableCopyKey = '';
  if (['/outliner/duplicate', '/outliner/save-as'].includes(String(path || ''))
      && body && typeof body === 'object' && !body.operation_id) {
    const prepared = window.MeldexStableCopyOperationIds?.prepare?.(path, body)
      || { body: { ...body, operation_id: crypto.randomUUID() }, key: '' };
    body = prepared.body; stableCopyKey = prepared.key;
  }
  if (typeof _gbAppNotifyEntityValuesChanged === 'function') _gbAppNotifyEntityValuesChanged(path, 'pending', body);
  let result;
  try {
    result = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(options || {}),
    });
  } catch (error) {
    if (typeof _gbAppNotifyEntityValuesChanged === 'function') setTimeout(() => _gbAppNotifyEntityValuesChanged(path, 'failed', body), 0);
    throw error;
  }
  window.MeldexStableCopyOperationIds?.complete(stableCopyKey);
  window.MeldexChatManagementSheet?.notifyMutation?.(path, body);
  _scheduleLinkDictionaryRefreshForMutation(path);
  if (typeof _gbAppNotifyEntityValuesChanged === 'function') _gbAppNotifyEntityValuesChanged(path, 'saved', body);
  return result;
}

/* ==============================
   初期化
   ============================== */
// 認証トークン管理
// 旧認証変数（互換性のため残す — 他モジュールが参照）
let _authToken = '';
let _authUser = null;

function _apiLockJsonBody(opts) {
  const raw = opts?.body;
  if (!raw) return {};
  if (raw instanceof FormData) {
    const body = {};
    for (const [key, value] of raw.entries()) {
      if (typeof value === 'string' && body[key] === undefined) body[key] = value;
    }
    return body;
  }
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  if (raw && typeof raw === 'object' && !(raw instanceof FormData)) return raw;
  return {};
}

function _apiLockPathDir(path) {
  const text = String(path || '').replace(/\\/g, '/');
  const index = text.lastIndexOf('/');
  return index > 0 ? text.slice(0, index) : '';
}

function _apiLockRenameExtension(path) {
  const text = String(path || '').replace(/\\/g, '/');
  const name = text.slice(text.lastIndexOf('/') + 1);
  if (!name || name.endsWith('.')) return '';
  const visibleName = name.replace(/^\.+/, '');
  const dotIndex = visibleName.indexOf('.');
  return dotIndex >= 0 ? visibleName.slice(dotIndex) : '';
}

function _apiLockAddPath(paths, value) {
  const text = String(value || '').trim();
  if (text) paths.push(text);
}

function _apiLockWriteCandidatePaths(path, opts) {
  const method = String(opts?.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return [];
  let url;
  try { url = new URL(String(path || ''), window.location.origin); } catch { return []; }
  const route = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  if (route === '/file-lock' || route.startsWith('/file-lock/') || route === '/active-lock' || route.startsWith('/active-lock/')) return [];
  const body = _apiLockJsonBody(opts);
  const query = url.searchParams;
  const paths = [];
  const addQuery = (key) => _apiLockAddPath(paths, query.get(key));
  const addBody = (key) => _apiLockAddPath(paths, body?.[key]);
  const addBoth = (key) => { addQuery(key); addBody(key); };

  if (route === '/file' || route === '/value' || route === '/db-metadata' || route === '/replace') {
    addBoth('path');
    addBody('entry_path');
    addBody('folder_path');
  } else if (route === '/replace-batch') {
    (Array.isArray(body?.targets) ? body.targets : []).forEach(item => _apiLockAddPath(paths, item?.path));
  } else if (route === '/upload-file' || route === '/upload-files') {
    addBoth('path');
    addBody('dir');
  } else if (route === '/outliner/add') {
    addBody('parent');
  } else if (route === '/outliner/delete') {
    addBody('path');
  } else if (route === '/outliner/duplicate') {
    const srcPath = String(body?.path || '').trim();
    if (srcPath) _apiLockAddPath(paths, _apiLockPathDir(srcPath));
  } else if (route === '/outliner/save-as') {
    addBody('path');
    addBody('dest_folder');
  } else if (route === '/outliner/delete-batch') {
    (Array.isArray(body?.items) ? body.items : []).forEach(item => _apiLockAddPath(paths, item?.path));
  } else if (route === '/outliner/move') {
    addBody('path');
    addBody('dest_folder');
  } else if (route === '/outliner/rename') {
    addBody('old_path');
    const oldPath = String(body?.old_path || '');
    const newName = String(body?.new_name || '').trim();
    if (oldPath && newName && !window.GBPathUtils?.isDisplayTitleRename?.(route, body)) {
      const destinationBase = (_apiLockPathDir(oldPath) ? _apiLockPathDir(oldPath) + '/' : '') + newName;
      _apiLockAddPath(paths, destinationBase);
      const extension = _apiLockRenameExtension(oldPath);
      if (extension) _apiLockAddPath(paths, destinationBase + extension);
    }
  } else if (route === '/entity/create') {
    addBody('parent_path');
  } else if (route === '/entity/rename') {
    addBody('path');
    const oldPath = String(body?.path || '');
    const newName = String(body?.new_name || '').trim();
    if (oldPath && newName) _apiLockAddPath(paths, (_apiLockPathDir(oldPath) ? _apiLockPathDir(oldPath) + '/' : '') + newName);
  } else if (route === '/annotations' || route === '/annotations/restore' || route === '/annotations/orphan-by-target') {
    addBody('target_path');
  } else if (route === '/entity/auto-name') {
    addBody('db_path');
    addBody('entry_path');
    addBody('path');
  } else if (route === '/folder-links/add' || route === '/folder-links/remove') {
    addBody('folder_path');
    addBody('file_path');
  } else if (route === '/import-csv' || route === '/import-xlsx') {
    addBody('csv_path');
    addBody('xlsx_path');
    addBody('db_path');
  } else if (route === '/public-form/submit') {
    addBody('db_path');
  } else if (route.startsWith('/calendar-db/events') || route.startsWith('/calendar-db/sync') || route.startsWith('/calendar-db/ical') || route.startsWith('/calendar-db/caldav')) {
    addBoth('db_path');
  } else if (route === '/version/restore' || route === '/version/restore-db' || route === '/version/restore-folder' || route === '/version/delete-folder' || route === '/version/delete-db') {
    addBody('path');
  }

  return [...new Set(paths)];
}

function _apiLockBlockIfNeeded(path, opts) {
  if (typeof isItemLocked !== 'function') return false;
  const lockedPath = _apiLockWriteCandidatePaths(path, opts).find(p => {
    try { return isItemLocked(p); } catch { return false; }
  });
  if (!lockedPath) return false;
  const reason = typeof getItemLockReason === 'function' ? getItemLockReason(lockedPath) : '';
  const message = reason
    ? `編集ロック中のため編集できません（理由: ${reason}）`
    : '編集ロック中のため編集できません';
  if (typeof showStatus === 'function') showStatus(message, true);
  throw new Error(message);
}

function _apiUsesTransientActiveLock(path) {
  let route = '';
  try { route = new URL(String(path || ''), window.location.origin).pathname.replace(/^\/api(?=\/|$)/, '') || '/'; }
  catch { return false; }
  return new Set([
    '/upload-file', '/upload-files', '/outliner/add', '/outliner/rename', '/outliner/delete',
    '/outliner/delete-batch', '/outliner/restore', '/outliner/duplicate',
    '/outliner/save-as', '/outliner/move', '/trash/restore', '/replace', '/replace-batch',
  ]).has(route);
}

// apiFetchをオーバーライドしてユーザー名を付加
const _origApiFetch = apiFetch;
apiFetch = async function(path, opts) {
  opts = opts || {};
  const lockCandidatePaths = _apiLockWriteCandidatePaths(path, opts);
  _apiLockBlockIfNeeded(path, opts);
  const activeLocks = window.MeldexActiveLocks;
  const transientLease = _apiUsesTransientActiveLock(path) && activeLocks?.acquireMutationLocks
    ? await activeLocks.acquireMutationLocks(lockCandidatePaths)
    : null;
  const deferredCreateUnlock = String(opts.method || 'GET').toUpperCase() === 'POST'
    && String(path || '').split('?')[0].replace(/^\/api(?=\/|$)/, '') === '/outliner/add';
  let mutationSucceeded = false;
  try {
    if (activeLocks?.beforeApiFetch) {
      opts = await activeLocks.beforeApiFetch(path, opts, { candidatePaths: lockCandidatePaths });
    }
    // 表示名と安定IDを自動付与（監査ログ・版履歴の編集者帰属用）
    const user = getUsername();
    const actorId = window.MeldexProfileIdentity?.getStableActorId?.() || '';
    const requestMethod = String(opts.method || 'GET').toUpperCase();
    const mutationRequest = requestMethod !== 'GET' && requestMethod !== 'HEAD';
    const identityParams = [];
    if (user && user !== 'anonymous' && !/[?&]_user=/.test(path)) identityParams.push('_user=' + encodeURIComponent(user));
    if (mutationRequest && actorId && !/[?&]_actor_id=/.test(path)) identityParams.push('_actor_id=' + encodeURIComponent(actorId));
    if (mutationRequest && !/[?&]_actor_kind=/.test(path)) identityParams.push('_actor_kind=human');
    if (identityParams.length) path += (path.includes('?') ? '&' : '?') + identityParams.join('&');
    const result = await _origApiFetch(path, opts);
    mutationSucceeded = true;
    if (result?.history_sync_pending) {
      if (typeof showStatus === 'function') showStatus('本文は保存しました。変更履歴は接続回復後に同期します', true);
    } else if (result?.history_recorded === false) {
      if (typeof showStatus === 'function') showStatus('本文は保存しましたが、変更履歴を記録できませんでした', true);
    }
    return result;
  } finally {
    const release = transientLease?.release?.();
    if (deferredCreateUnlock && mutationSucceeded) {
      // The new item is durable. Show it while the short-lived parent lease
      // is released; the lock store waits for that release before reacquiring.
      void Promise.resolve(release).catch(error => console.warn('新規追加後のロック解除に失敗:', error));
    } else await release;
  }
};

// チームプロフィール同期（起動時に型付き管理領域へ自分を登録。source folderは変更しない）
// フォルダ別ロールを保持（DB列ロック等で参照）
let _myTeamRole = 'editor';  // デフォルト（ソースフォルダ未設定時）
const _myTeamRoles = {};     // { folderPath: role }

async function _syncMyTeamProfile() {
  try { await window.MeldexDropboxProfileSync?.resolveStartupProfile?.(); } catch {}
  const name = getUsername();
  if (!name || name === 'anonymous') return;
  const avatar = localStorage.getItem('meldex-avatar') || '';
  const teamPayload = (extra) => window.MeldexDropboxProfileSync?.teamSyncPayload?.({ name, avatar, ...(extra || {}) }) || { name, avatar, ...(extra || {}) };
  const syncFolderProfile = async (folder) => {
    // Profile registration is best effort at startup. A read-only/virtual root
    // must not interrupt startup or prevent reading its existing role.
    try {
      await apiPost('/team/sync', teamPayload(folder ? { folder } : undefined), { silentError: true });
    } catch (error) {
      console.warn('[team-profile] 起動時のプロフィール同期を保留しました:', error);
    }
    try {
      const members = await apiFetch('/team' + (folder ? '?folder=' + encodeURIComponent(folder) : ''), { silentError: true });
      const me = members.find(member => member.name === name);
      return me ? me.role || 'editor' : undefined;
    } catch (error) {
      console.warn('[team-profile] チーム情報を読み込めませんでした:', error);
      return undefined;
    }
  };
  const syncWorkspaceProfiles = async () => {
    try {
      const workspaces = typeof window.MeldexWorkspaces?.load === 'function'
        ? await window.MeldexWorkspaces.load({ force: true })
        : [];
      for (const workspace of workspaces || []) {
        if (!workspace?.id) continue;
        try {
          await apiPost('/workspaces/' + encodeURIComponent(workspace.id) + '/sync-profile', teamPayload({ workspace_id: workspace.id }), { silentError: true });
        } catch (error) {
          console.warn('[team-profile] ワークスペースのプロフィール同期を保留しました:', error);
        }
      }
      await window.MeldexWorkspaces?.load?.({ force: true });
    } catch {}
  };
  // 全ソースフォルダに対応する管理レコードへ同期
  try {
    const roots = await apiFetch('/outliner-roots').catch(() => []);
    const visibleRoots = roots.filter(r => r.visible && r.path);
    if (visibleRoots.length === 0) {
      // ソースフォルダなし → デフォルトvaultに対応する管理レコードへ同期
      const role = await syncFolderProfile();
      if (role) _myTeamRole = role;
      await syncWorkspaceProfiles();
      return;
    }
    for (const root of visibleRoots) {
      const role = await syncFolderProfile(root.path);
      if (role) _myTeamRoles[root.path] = role;
    }
    // デフォルトロール = 最初の可視ソースフォルダのロール
    const firstRole = _myTeamRoles[visibleRoots[0].path];
    if (firstRole) _myTeamRole = firstRole;
    await syncWorkspaceProfiles();
  } catch {}
}

let _startupSplashHidden = false;
function _notifyStartupReady() {
  if (typeof apiPost !== 'function') return;
  void apiPost('/startup-ready', {}, { silentError: true }).catch(() => {});
}

function _hideStartupSplash() {
  if (_startupSplashHidden) return;
  _startupSplashHidden = true;
  _notifyStartupReady();
  const splash = document.getElementById('gb-splash');
  if (!splash) return;
  splash.style.pointerEvents = 'none';
  splash.style.transition = 'opacity 0.3s';
  splash.style.opacity = '0';
  setTimeout(() => splash.remove(), 300);
}

function _withStartupTimeout(label, promise, timeoutMs, fallbackValue) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  if (!timeout) return Promise.resolve(promise);
  const startedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[Meldex] startup timeout: ${label} (${timeout}ms)`);
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('startup.timeout.' + label, startedAt, { timeoutMs: timeout });
      }
      if (typeof _sendLog === 'function') {
        _sendLog('warn', { message: `[startup-timeout] ${label}`, timeoutMs: timeout });
      }
      resolve(fallbackValue);
    }, timeout);
    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('startup.ready.' + label, startedAt, { timeoutMs: timeout });
      }
      resolve(value);
    }).catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('startup.error.' + label, startedAt, {
          timeoutMs: timeout,
          error: error?.message || String(error),
        });
      }
      reject(error);
    });
  });
}

function _runStartupBackground(label, promise, onReady) {
  Promise.resolve(promise)
    .then((value) => {
      if (typeof onReady === 'function') onReady(value);
      return value;
    })
    .catch((error) => {
      console.warn(`[Meldex] startup background task failed: ${label}`, error);
      if (typeof _sendLog === 'function') {
        _sendLog('warn', {
          message: `[startup-bg-failed] ${label}: ${error?.message || error}`,
          stack: error?.stack || '',
        });
      }
      return null;
    });
}

function _refreshOutlinerAfterStartupReady() {
  try {
    const outlinerOptions = {
      coalesce: true,
      skipIfRecentlyLoaded: true,
      reason: 'startup-ready',
    };
    if (typeof refreshOutliner === 'function') return refreshOutliner(outlinerOptions);
    const refreshJobs = [];
    if (typeof loadOutliner === 'function') refreshJobs.push(Promise.resolve().then(() => loadOutliner(outlinerOptions)));
    if (typeof renderFavorites === 'function') refreshJobs.push(Promise.resolve().then(() => renderFavorites()));
    if (typeof renderHomeFolderTree === 'function') refreshJobs.push(Promise.resolve().then(() => renderHomeFolderTree()));
    return Promise.allSettled(refreshJobs);
  } catch (error) {
    console.warn('[Meldex] startup outliner refresh failed:', error);
    return Promise.resolve(null);
  }
}

function _highlightLastOutlinerNodeAfterStartup() {
  setTimeout(() => {
    const last = _readLastViewFromStorage();
    if (!last) return;
    const p = last.path || last.dbPath || last.entityPath || '';
    if (p) highlightOutlinerNode(p);
  }, 500);
}

function _readLastViewFromStorage() {
  try {
    return JSON.parse(localStorage.getItem('lastView') || 'null');
  } catch {
    localStorage.removeItem('lastView');
    return null;
  }
}

async function _openCloudStartupHome(homeRes, isUrlOpen, onboardingShown) {
  // Explicit links keep their target; Desktop keeps its saved workspace.
  if (_isDesktopStartupLaunch() || isUrlOpen || onboardingShown || !homeRes?.exists || !homeRes.path) return false;
  // ホームから始めるのは Cloud（この端末内・Dropbox の保存先）だけ。本体のサーバーを普通のブラウザで
  // 開いた時は、デスクトップ版と同じく前回のタブを復元する（ここでホームを開くと、復元中のシートのタブが
  // 「ホームフォルダ」に置き換わり、タブ名と本文が食い違ったまま表が描かれなかった。2026-11-22 探索）。
  const runtime = typeof window !== 'undefined' ? window.MeldexRuntimeAdapter : null;
  if (!runtime?.isBrowserDataMode?.()) return false;
  const label = typeof HOME_FOLDER_DISPLAY_LABEL !== 'undefined' ? HOME_FOLDER_DISPLAY_LABEL : 'ホームフォルダ';
  await openFolder(label, homeRes.path, {
    fromExplorer: true,
    skipAutoAppLayout: true,
    skipSaveLastView: true,
  });
  return true;
}

function _repairStartupDatabaseViewTabs() {
  try {
    if (!state.currentDbPath || typeof _renderDbViewTabsSafely !== 'function') return;
    const tabs = document.getElementById('db-view-tabs') || document.querySelector('.db-view-tabs');
    if (!tabs) return;
    if (tabs.querySelector('[data-e2e-id^="db-view-add-"]')) return;
    _renderDbViewTabsSafely(typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  } catch {}
}

function _scheduleStartupDatabaseViewTabsRepair() {
  [0, 80, 250].forEach(delay => setTimeout(_repairStartupDatabaseViewTabs, delay));
}

async function _restoreStartupBoardView(label, path, opts) {
  const openOpts = opts || {};
  const boardLabel = label || String(path || '').split(/[\\/]/).pop() || '';
  if (typeof GBPaneBridge !== 'undefined'
    && GBPaneBridge?.initialized
    && typeof GBLayout !== 'undefined'
    && typeof GBTabs !== 'undefined'
    && typeof navPush === 'function') {
    state.view = 'board';
    state.currentBoardPath = path;
    navPush({ type: 'board', label: boardLabel, path });
    if (typeof GBPaneBridge.refreshPaneAfterTabSwitch === 'function') {
      GBPaneBridge.refreshPaneAfterTabSwitch(GBLayout.activePane, { force: true });
    }
    if (!openOpts.skipSaveLastView) saveLastView({ type: 'board', label: boardLabel, path });
    if (!openOpts.skipRecent && typeof addRecent === 'function') addRecent(boardLabel, path, 'board');
    if (!openOpts.skipHighlight && typeof highlightOutlinerNode === 'function') highlightOutlinerNode(path);
    if (!openOpts.skipAutoVersion && typeof startAutoVersion === 'function') startAutoVersion(path, 'file');
    return true;
  }
  const opened = typeof openBoard === 'function' ? await openBoard(boardLabel, path, openOpts) : false;
  return opened !== false;
}

// 特定フォルダ内のパスに対するロールを取得
function getMyRoleForPath(filePath) {
  if (!filePath) return _myTeamRole;
  const normFile = String(filePath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  let matchedRole = '';
  let matchedLength = -1;
  for (const [folder, role] of Object.entries(_myTeamRoles)) {
    const norm = String(folder || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (!norm) continue;
    if ((normFile === norm || normFile.startsWith(norm + '/')) && norm.length > matchedLength) {
      matchedRole = role;
      matchedLength = norm.length;
    }
  }
  return matchedRole || _myTeamRole;
}

// doLogin / ログイン画面は廃止（チーム方式に移行）

// localStorage移行（旧CrossFolio → Meldex、一度だけ実行）
(function migrateLocalStorage() {
  if (localStorage.getItem('gb:migrated')) return;
  const migrations = {
    'crossfolio-auth-token': 'meldex-auth-token',
    'crossfolio-user': 'meldex-user',
    'crossfolio-recent': 'meldex-recent',
    'crossfolio-theme-vars': 'meldex-theme-vars',
    'crossfolio-favorites': 'meldex-favorites',
    'cf-cal-start-day': 'gb-cal-start-day',
  };
  for (const [oldKey, newKey] of Object.entries(migrations)) {
    const val = localStorage.getItem(oldKey);
    if (val !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, val);
    }
  }
  // cf-cal-mode-*, cf-cal-date-* のプレフィックス移行
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('cf-cal-')) {
      const newKey = key.replace('cf-cal-', 'gb-cal-');
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, localStorage.getItem(key));
      }
    }
  }
  localStorage.setItem('gb:migrated', '1');
  if (typeof _refreshOutlinerStorageViewsAfterMigration === 'function') {
    _refreshOutlinerStorageViewsAfterMigration();
  }
})();

// 起動時に正本「スタッフ管理シート」へ自分の行を fill-only 登録する
// （ユーザーアカウント一元管理 計画書 Phase 2、§5.6）。行が既に存在するなら
// 一切上書きしない（管理者がシートで編集した値は同期に負けない契約）。
// 正本シート自体が未設定の場合はここで無ダイアログ自動作成される
// （計画書§5.1「起動時同期」が自動作成のトリガーの一つ）。
async function _primeStaffRegistrySelfUpsert() {
  if (!window.MeldexUserRegistry) return;
  const me = typeof getUsername === 'function' ? String(getUsername() || '').trim() : '';
  if (!me || me === 'anonymous') return;
  try {
    await window.MeldexUserRegistry.upsertStaff({ user: me, display: me }, { fillOnly: true, silentError: true });
  } catch (e) {
    // ソースフォルダ未設定・オフライン等では起動処理を止めない。
    console.warn('[staff-registry] 起動時のプロフィール登録を保留しました:', e);
  }
}

async function init() {
  const initStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  // チームプロフィール同期は権限情報の更新用途。起動表示は待たず、裏で完了させる。
  _runStartupBackground('team-profile-sync', _syncMyTeamProfile());
  _runStartupBackground('staff-registry-self-upsert', _primeStaffRegistrySelfUpsert());

  try {
    const initialFetchStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
    const [vault, roots, homeRes] = await Promise.all([
      _withStartupTimeout('vault', apiFetch('/vault'), 5000, { path: '', name: '' }),
      _withStartupTimeout('outliner-roots', apiFetch('/outliner-roots').catch(() => []), 5000, []),
      _withStartupTimeout('home-folder', apiFetch('/home-folder').catch(() => ({ exists: false })), 5000, { exists: false }),
    ]);
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('startup.initial-fetches', initialFetchStartedAt, {
        rootsCount: Array.isArray(roots) ? roots.length : 0,
        hasHome: !!homeRes?.exists,
      });
    }
    state.vaultPath = vault.path;
    window.MeldexRegisteredSourceRoots = Array.isArray(roots)
      ? roots.filter(root => root?.path).map(root => ({ ...root }))
      : [];
    try {
      if (homeRes?.path && typeof _homeFolderPath !== 'undefined') _homeFolderPath = homeRes.path;
    } catch (e) {}

    const hasRoots = roots.length > 0 && roots.some(r => r.visible);
    const hasHome = homeRes.exists;
    const onboardingShown = !!window.MeldexOnboarding?.handleStartupState?.({
      vaultPath: vault.path || '',
      hasRoots,
      hasHome,
      homePath: homeRes?.path || '',
    });
    if (!vault.path && !hasRoots && !hasHome) {
      // ソースフォルダもルートもホームもない場合はウェルカム画面
      // ただしサイドバーは表示したまま（設定ボタンにアクセスできるように）
      showView('welcome');
    }

    // ホームフォルダの版間共有: 起動時の共有警告・引き継ぎ提案チェック。
    // オンボーディングウィザードが出る場合はダイアログの重なりを避けて後回しにする
    // （設定画面を開いた時に loadHomeFolderSharingStatusForSettings() 経由で再チェックされる）。
    if (!onboardingShown && window.MeldexHomeFolderSharing?.loadHomeFolderSharingStatusForSettings) {
      _runStartupBackground(
        'home-folder-sharing-check',
        window.MeldexHomeFolderSharing.loadHomeFolderSharingStatusForSettings()
      );
    }

    document.getElementById('sb-work').textContent = vault.path ? ('ソースフォルダ: ' + vault.name) : '';
    document.getElementById('current-title').textContent = '';

    // file_id マイグレーションは初回のみだが、起動表示を止めないよう背景化する。
    const rawMigrationPromise = _migratePathsToFileIds();
    const migrationPromise = _withStartupTimeout('file-id-migration', rawMigrationPromise, 5000, null);

    // 廃止された非表示機能の localStorage を一度だけ除去
    if (!localStorage.getItem('_folder-hidden-removed')) {
      localStorage.removeItem('folder-files-hidden');
      localStorage.setItem('_folder-hidden-removed', '1');
    }

    // フォルダツリーとビュー復元を並行実行
    const outlinerStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
    const outlinerPromise = Promise.resolve(loadOutliner()).finally(() => {
      if (typeof _logPerfEvent === 'function') _logPerfEvent('startup.loadOutliner.promise', outlinerStartedAt);
    });
    const linkDictPromise = loadLinkDict();

    // URLパラメータによる初期表示（新しいタブ/ウィンドウで開く用）
    let restored = onboardingShown;
    let openedCloudStartupHome = false;
    const restoredByPaneLayout = _paneLayoutRestoredFromStorage();
    const urlParams = new URLSearchParams(window.location.search);
    const openType = urlParams.get('open');
    const openPath = urlParams.get('path');
    const openLabel = urlParams.get('label') || (openPath ? openPath.split('/').pop() : '');
    const isUrlOpen = !!(openType && openPath);
    if (isUrlOpen && _isCloudPhase1UnsupportedOpenType(openType)) {
      _showCloudPhase1UnsupportedOpen(openType);
      restored = true;
    } else if (isUrlOpen) {
      const _urlOpenOpts = { skipAutoAppLayout: true, skipSaveLastView: true };
      // URLパラメータ経由の場合、lastViewを上書きしないフラグを設定
      const previousSkipLastView = window._skipLastViewSave;
      window._skipLastViewSave = true;
      try {
        if (openType === 'page') { openPage(openLabel, openPath, _urlOpenOpts); restored = true; }
        else if (openType === 'board') { restored = await _restoreStartupBoardView(openLabel, openPath, _urlOpenOpts); }
        else if (openType === 'form-app') { restored = (await openFormApp(openPath, openLabel, _urlOpenOpts)) !== false; }
        else if (openType === 'map') { restored = (await openMapApp(openPath, openLabel, _urlOpenOpts)) !== false; }
        else if (openType === 'entity') { selectEntity(openPath, _urlOpenOpts); restored = true; }
        else if (openType === 'pivot' || openType === 'database') { await selectDatabase(openPath, null, _urlOpenOpts); restored = true; }
        else if (openType === 'media' || openType === 'image' || openType === 'video' || openType === 'audio') {
          const mt = urlParams.get('mediaType') || (openType === 'media' ? 'image' : openType);
          openMedia(openLabel, openPath, mt, _urlOpenOpts);
          restored = true;
        }
        else if (openType === 'document') {
          if (typeof openViewer === 'function') {
            const viewerUrl = /\.pdf(?:[?#]|$)/i.test(openPath)
              ? '/viewer?pdf=' + encodeURIComponent(openPath)
              : '/viewer?file=' + encodeURIComponent(openPath);
            openViewer(viewerUrl, _urlOpenOpts);
            restored = true;
          }
        }
        else if (openType === 'html') { openHtmlFile(openLabel, openPath, _urlOpenOpts); restored = true; }
        else if (openType === 'csv') { if (typeof openCsvFile === 'function') { openCsvFile(openLabel, openPath, _urlOpenOpts); restored = true; } }
        else if (openType === 'folder') { openFolder(openLabel, openPath, _urlOpenOpts); restored = true; }
        else if (openType === 'calendar') { await openCalendarFile(openLabel, openPath, _urlOpenOpts); restored = true; }
        else if (openType === 'chat') {
          if (typeof openSavedChat === 'function') {
            await openSavedChat(openPath);
            restored = true;
          }
        }
        else if (openType === 'scriptnote' || openType === 'scenario') {
          if (typeof openScenarioInScriptNote === 'function') {
            openScenarioInScriptNote(openPath, openLabel, _urlOpenOpts);
            restored = true;
          }
        }
      } finally {
        window._skipLastViewSave = previousSkipLastView;
      }
    }

    // Cloud starts at Home even when an older document/layout is remembered.
    // Keep saved tabs and unsaved drafts available for explicit recovery.
    if (!restored) {
      openedCloudStartupHome = await _openCloudStartupHome(homeRes, isUrlOpen, onboardingShown);
      restored = openedCloudStartupHome;
    }

    // v5.0 ペイン配置が復元済みなら、旧 lastView 復元でアクティブペインを上書きしない。
    if (!restored && restoredByPaneLayout) restored = true;

    // 前回のビューを即座に復元（URLパラメータがなかった場合）
    if (!restored) {
      const restoreStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
      try {
        let last = _readLastViewFromStorage();
        if (last && _isCloudPhase1UnsupportedOpenType(last.type)) {
          localStorage.removeItem('lastView');
          _showCloudPhase1UnsupportedOpen(last.type);
          last = null;
        }
        const _expOpts = { fromExplorer: true, skipAutoAppLayout: true };
        if (last) {
          if (last.type === 'pivot' && last.dbPath) { await selectDatabase(last.dbPath, null, _expOpts); restored = true; }
          else if (last.type === 'entity' && last.entityPath) { selectEntity(last.entityPath, _expOpts); restored = true; }
          else if (last.type === 'page' && last.path) { openPage(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'board' && last.path) { restored = await _restoreStartupBoardView(last.label || '', last.path, _expOpts); }
          else if (last.type === 'form-app' && last.path) { restored = (await openFormApp(last.path, last.label || '', _expOpts)) !== false; }
          else if (last.type === 'map' && last.path) { restored = (await openMapApp(last.path, last.label || '', _expOpts)) !== false; }
          else if (last.type === 'media' && last.path) { openMedia(last.label || '', last.path, last.mediaType || 'image', _expOpts); restored = true; }
          else if (last.type === 'html' && last.path) { openHtmlFile(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'csv' && last.path) { if (typeof openCsvFile === 'function') { openCsvFile(last.label || '', last.path, _expOpts); restored = true; } }
          else if (last.type === 'scriptnote' && last.path && typeof openScenarioInScriptNote === 'function') { openScenarioInScriptNote(last.path, last.label || '', _expOpts); restored = true; }
          else if (last.type === 'folder' && last.path) { openFolder(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'calendar' && last.path) { await openCalendarFile(last.label || '', last.path, _expOpts); restored = true; }
        }
      } catch (e) {}
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('startup.restore-last-view', restoreStartedAt, { restored });
      }
    } // if (!restored) from URL params

    if (!restored && !_isDesktopStartupLaunch()) {
      const startupFolder = _startupFolderCandidate(roots, homeRes, vault);
      if (startupFolder?.path) {
        const _startupOpts = { fromExplorer: true, skipAutoAppLayout: true };
        await openFolder(startupFolder.label || _pathTailLabel(startupFolder.path, 'フォルダ'), startupFolder.path, _startupOpts);
        restored = true;
      }
    }

    // v5.0 ペインシステムがタブを復元している場合は welcome にフォールバックしない。
    // lastView ベースの復元が hit しなくても、ペイン配置が残っていれば画面は埋まっている。
    if (!restored) {
      const _paneHasTabs = _paneLayoutHasAnyTabs();
      if (!_paneHasTabs) showView('welcome');
    }

    // 起動後の重い補助処理は背景で継続し、表示を先に返す。
    _scheduleStartupDatabaseViewTabsRepair();
    _hideStartupSplash();
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('startup.visible', initStartedAt, { restored });
    }
    _runStartupBackground('file-id-migration-finalize', rawMigrationPromise.then(() => _migratePathsToFileIds()), () => {
      if (state.currentDbPath && typeof _refreshDbViewConfigAfterHistory === 'function') {
        _refreshDbViewConfigAfterHistory(state.currentDbPath);
      }
    });
