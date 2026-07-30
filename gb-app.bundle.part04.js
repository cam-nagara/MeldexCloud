    if (!_apiFetchObservedGetEndpoints.has(endpoint)) return null;
    return {
      endpoint,
      label: 'api' + endpoint,
      targetLabel: _perfTargetLabelFromPath(path),
    };
  } catch {
    return null;
  }
}

const _apiFetchInFlightGets = new Map();
const GB_APP_API_FETCH_BROWSE_CACHE_TTL_MS = 2500;
const GB_APP_API_FETCH_BROWSE_CACHE_MAX_ENTRIES = 80;
const GB_APP_API_FETCH_TIMEOUT_MS = 15000; // fetch()がハングし続け、フォルダツリー等が無限ロードになるのを防ぐ上限
// シート系エンドポイント（セル値・列メタデータ）の保存先 per-sheet SQLite は Dropbox
// 同期フォルダ上にあり、書き込みロック待ちが最大 busy_timeout=30秒 かかり得る。既定15秒
// だとサーバー処理中でもフロントが先に abort して「保存に失敗しました」の偽エラーになる
// ため、これらは 30秒 を上回る既定タイムアウトにする（明示 timeoutMs があればそちら優先）。
const GB_APP_API_FETCH_SHEET_TIMEOUT_MS = 35000;
const GB_APP_API_FETCH_SHEET_ENDPOINTS = new Set(['/value', '/db-metadata']);
function _gbAppApiFetchDefaultTimeout(path) {
  const pathname = String(path || '').split('?')[0];
  return GB_APP_API_FETCH_SHEET_ENDPOINTS.has(pathname)
    ? GB_APP_API_FETCH_SHEET_TIMEOUT_MS
    : GB_APP_API_FETCH_TIMEOUT_MS;
}
const _gbAppApiFetchBrowseCache = new Map();
let _gbAppApiFetchCacheGeneration = 0;

function _gbAppApiFetchMethod(opts) {
  return String(opts?.method || 'GET').toUpperCase();
}

function _gbAppApiFetchClonePayload(payload) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(payload); } catch {}
  }
  try { return JSON.parse(JSON.stringify(payload)); } catch { return payload; }
}

function _gbAppApiFetchCanonicalGetPath(path) {
  try {
    const url = new URL(String(path || ''), 'http://meldex.local');
    const params = [...url.searchParams.entries()]
      .sort(([ak, av], [bk, bv]) => (ak + '=' + av).localeCompare(bk + '=' + bv));
    const query = params.map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
    return url.pathname + (query ? '?' + query : '');
  } catch {
    return String(path || '');
  }
}

function _apiFetchInFlightKey(path, opts) {
  if (_gbAppApiFetchMethod(opts) !== 'GET' || opts?.body != null || opts?.signal) return '';
  const nonBenignKeys = Object.keys(opts || {}).filter(key => !['method', 'silentError', 'skipBrowseCache'].includes(key));
  if (nonBenignKeys.length > 0) return '';
  return _gbAppApiFetchCanonicalGetPath(path)
    + '|silent=' + (opts?.silentError === true ? '1' : '0')
    + '|skipBrowseCache=' + (opts?.skipBrowseCache === true ? '1' : '0');
}

function _gbAppApiFetchBrowseCacheKey(path, opts) {
  if (_gbAppApiFetchMethod(opts) !== 'GET' || opts?.body != null || opts?.skipBrowseCache === true || opts?.cache === 'reload') return '';
  try {
    const url = new URL(String(path || ''), 'http://meldex.local');
    return url.pathname === '/browse' ? _gbAppApiFetchCanonicalGetPath(path) : '';
  } catch {
    return '';
  }
}

function _gbAppApiFetchInvalidateReadCaches() {
  _gbAppApiFetchCacheGeneration += 1;
  _gbAppApiFetchBrowseCache.clear();
  _apiFetchInFlightGets.clear();
  if (typeof _clearBrowseItemResolvedTypeCache === 'function') _clearBrowseItemResolvedTypeCache();
}

function _gbAppApiFetchRememberBrowse(cacheKey, payload) {
  _gbAppApiFetchBrowseCache.set(cacheKey, {
    at: Date.now(),
    payload: _gbAppApiFetchClonePayload(payload),
  });
  while (_gbAppApiFetchBrowseCache.size > GB_APP_API_FETCH_BROWSE_CACHE_MAX_ENTRIES) {
    const oldestKey = _gbAppApiFetchBrowseCache.keys().next().value;
    if (!oldestKey) break;
    _gbAppApiFetchBrowseCache.delete(oldestKey);
  }
}

function _apiFetchBackendPerf(res) {
  try {
    const raw = res?.headers?.get?.('x-meldex-perf') || '';
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function _logPerfEvent(label, startedAt, detail) {
  try {
    const durationMs = _perfElapsedMs(startedAt);
    const payload = {
      ...(detail || {}),
      message: `[perf] ${label}: ${durationMs}ms`,
      perf: true,
      label,
      durationMs,
    };
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info('[Meldex perf] ' + payload.message, payload);
    }
    if (typeof _sendLog === 'function') _sendLog('info', payload);
    return payload;
  } catch {
    return null;
  }
}

function _gbAppApiFetchIsAbortError(e) {
  return !!e && (e.name === 'AbortError' || e.code === 20);
}

// 呼び出し元のsignalを尊重しつつ、一定時間で自動中断するfetchラッパー。
// タイムアウトで中断した場合はisTimeout=trueを付与し、呼び出し元キャンセルと区別できるようにする。
async function _gbAppApiFetchDoFetch(url, requestOpts, timeoutMs) {
  const controller = new AbortController();
  const externalSignal = requestOpts?.signal || null;
  const fetchOpts = { ...(requestOpts || {}) };
  delete fetchOpts.timeoutMs;
  let timedOut = false;
  let onExternalAbort = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      // 理由付きabortはfetchが通常Errorを投げるため、呼び出し元キャンセルを
      // 通信障害と誤判定しないよう内部signalは標準AbortErrorへ正規化する。
      controller.abort();
    } else {
      onExternalAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(url, { ...fetchOpts, signal: controller.signal });
  } catch (e) {
    if (_gbAppApiFetchIsAbortError(e) && timedOut) {
      const timeoutErr = new Error(`HTTPリクエストがタイムアウトしました(${Math.round(timeoutMs / 1000)}秒): ${url}`);
      timeoutErr.name = 'AbortError';
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal && onExternalAbort) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

async function apiFetch(path, opts) {
  const method = _gbAppApiFetchMethod(opts);
  const browseCacheKey = _gbAppApiFetchBrowseCacheKey(path, opts);
  const cacheGeneration = _gbAppApiFetchCacheGeneration;
  if (browseCacheKey) {
    const cached = _gbAppApiFetchBrowseCache.get(browseCacheKey);
    if (cached && Date.now() - cached.at < GB_APP_API_FETCH_BROWSE_CACHE_TTL_MS) {
      return _gbAppApiFetchClonePayload(cached.payload);
    }
    _gbAppApiFetchBrowseCache.delete(browseCacheKey);
  }
  const inFlightKey = _apiFetchInFlightKey(path, opts);
  if (inFlightKey && _apiFetchInFlightGets.has(inFlightKey)) {
    return _gbAppApiFetchClonePayload(await _apiFetchInFlightGets.get(inFlightKey));
  }
  const perfInfo = _apiFetchPerfInfo(path);
  const perfStartedAt = perfInfo ? _perfNowMs() : 0;
  const requestPromise = (async () => {
    try {
      let requestOpts = opts;
      let retriedAfterMutation = false;
      while (true) {
        const requestedTimeout = Number(requestOpts?.timeoutMs);
        const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
          ? Math.min(requestedTimeout, 300000)
          : _gbAppApiFetchDefaultTimeout(path);
        const res = await _gbAppApiFetchDoFetch(API_BASE + path, requestOpts, timeoutMs);
        if (perfInfo) {
          _logPerfEvent(perfInfo.label + '.fetch', perfStartedAt, {
            ...perfInfo,
            status: res.status,
            contentLength: res.headers?.get?.('content-length') || '',
            retriedAfterMutation,
          });
        }
        const backendPerf = _apiFetchBackendPerf(res);
        if (!res.ok) {
          let detail = res.statusText || '';
          let payload = null;
          try {
            payload = await res.clone().json();
            const rawDetail = payload?.error || payload?.detail || detail;
            detail = rawDetail && typeof rawDetail === 'object'
              ? (rawDetail.message || rawDetail.code || detail)
              : rawDetail;
          } catch {}
          const error = new Error(`HTTP ${res.status}: ${detail}`);
          error.status = res.status;
          error.payload = payload;
          error.userMessage = window.MeldexErrorMessages?.toStatusText?.(error, { path }) || error.message;
          throw (window.MeldexSaveSafety?.enrichError?.(error, payload, res.status) || error);
        }
        const jsonStartedAt = perfInfo ? _perfNowMs() : 0;
        const data = await res.json();
        if (perfInfo) {
          _logPerfEvent(perfInfo.label + '.json', jsonStartedAt, {
            ...perfInfo,
            backendPerf,
            retriedAfterMutation,
          });
        }
        // GET開始後に作成・保存・移動等が完了した場合、開始時点の古い一覧を
        // 呼び出し元へ返さない。アプリ内キャッシュを迂回して1回だけ取り直す。
        if (browseCacheKey && !retriedAfterMutation && cacheGeneration !== _gbAppApiFetchCacheGeneration) {
          retriedAfterMutation = true;
          requestOpts = { ...(opts || {}), skipBrowseCache: true, cache: 'reload' };
          continue;
        }
        if (backendPerf && data && typeof data === 'object') {
          try {
            Object.defineProperty(data, '_backendPerf', {
              value: backendPerf,
              configurable: true,
            });
          } catch {}
        }
        window.MeldexSaveSafety?.reportApiSuccess?.(path, requestOpts);
        if (method !== 'GET') {
          _gbAppApiFetchInvalidateReadCaches();
        } else if (browseCacheKey && cacheGeneration === _gbAppApiFetchCacheGeneration) {
          _gbAppApiFetchRememberBrowse(browseCacheKey, data);
        }
        if (perfInfo) _logPerfEvent(perfInfo.label, perfStartedAt, { ...perfInfo, backendPerf, retriedAfterMutation });
        return data;
      }
    } catch (e) {
      if (perfInfo) {
        _logPerfEvent(perfInfo.label + '.error', perfStartedAt, {
          ...perfInfo,
          error: e?.message || String(e),
        });
      }
      const quietReadAbort = method === 'GET' && _gbAppApiFetchIsAbortError(e);
      if (!opts?.silentError && !quietReadAbort) {
        window.MeldexDiagnostics?.captureApiError?.(path, opts, e);
      }
      if (!opts?.silentError && !window.MeldexSaveSafety?.reportApiError?.(path, opts, e)) {
        if (quietReadAbort) {
          // GET中断/タイムアウトはエラートースト表示せず、コンソールログのみに留める（呼び出し元は再試行等で処理する）
          try { console.warn('[apiFetch] aborted:', path, e.message); } catch {}
        } else {
          const text = window.MeldexErrorMessages?.toStatusText?.(e, { path }) || e.message;
          showStatus('エラー: ' + text, true);
        }
      }
      throw e;
    }
  })();
  if (inFlightKey) {
    _apiFetchInFlightGets.set(inFlightKey, requestPromise);
    requestPromise.then(
      () => { if (_apiFetchInFlightGets.get(inFlightKey) === requestPromise) _apiFetchInFlightGets.delete(inFlightKey); },
      () => { if (_apiFetchInFlightGets.get(inFlightKey) === requestPromise) _apiFetchInFlightGets.delete(inFlightKey); },
    );
  }
  return _gbAppApiFetchClonePayload(await requestPromise);
}

async function apiPut(path, body, options = {}) {
  return apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(options || {}),
  });
}

async function apiPost(path, body, options = {}) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(options || {}),
  });
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
  } else if (route === '/upload-file') {
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
    if (oldPath && newName) {
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
  } else if (route === '/version/restore' || route === '/version/restore-db' || route === '/version/restore-folder' || route === '/version/delete-folder') {
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
    '/upload-file', '/outliner/add', '/outliner/rename', '/outliner/delete',
    '/outliner/delete-batch', '/outliner/restore', '/outliner/duplicate',
    '/outliner/save-as', '/outliner/move', '/trash/restore',
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
  try {
    if (activeLocks?.beforeApiFetch) {
      opts = await activeLocks.beforeApiFetch(path, opts, { candidatePaths: lockCandidatePaths });
    }
    // _user パラメータを自動付与（監査ログ・modified_by 用）
    const user = getUsername();
    if (user && user !== 'anonymous') {
      const sep = path.includes('?') ? '&' : '?';
      path += sep + '_user=' + encodeURIComponent(user);
    }
    return await _origApiFetch(path, opts);
  } finally {
    await transientLease?.release?.();
  }
};

// チームプロフィール同期（起動時に全ソースフォルダの _Meldex_team.json に自分を登録）
// フォルダ別ロールを保持（DB列ロック等で参照）
let _myTeamRole = 'editor';  // デフォルト（ソースフォルダ未設定時）
const _myTeamRoles = {};     // { folderPath: role }

async function _syncMyTeamProfile() {
  try { await window.MeldexDropboxProfileSync?.resolveStartupProfile?.(); } catch {}
  const name = getUsername();
  if (!name || name === 'anonymous') return;
  const avatar = localStorage.getItem('meldex-avatar') || '';
  const teamPayload = (extra) => window.MeldexDropboxProfileSync?.teamSyncPayload?.({ name, avatar, ...(extra || {}) }) || { name, avatar, ...(extra || {}) };
  const syncWorkspaceProfiles = async () => {
    try {
      const workspaces = typeof window.MeldexWorkspaces?.load === 'function'
        ? await window.MeldexWorkspaces.load({ force: true })
        : [];
      for (const workspace of workspaces || []) {
        if (!workspace?.id) continue;
        await apiPost('/workspaces/' + encodeURIComponent(workspace.id) + '/sync-profile', teamPayload({ workspace_id: workspace.id }));
      }
      await window.MeldexWorkspaces?.load?.({ force: true });
    } catch {}
  };
  // 全ソースフォルダに同期
  try {
    const roots = await apiFetch('/outliner-roots').catch(() => []);
    const visibleRoots = roots.filter(r => r.visible && r.path);
    if (visibleRoots.length === 0) {
      // ソースフォルダなし → デフォルトvaultに同期
      try {
        await apiPost('/team/sync', teamPayload());
        const members = await apiFetch('/team');
        const me = members.find(m => m.name === name);
        if (me) _myTeamRole = me.role || 'editor';
      } catch {}
      await syncWorkspaceProfiles();
      return;
    }
    for (const root of visibleRoots) {
      try {
        await apiPost('/team/sync', teamPayload({ folder: root.path }));
        const members = await apiFetch('/team?folder=' + encodeURIComponent(root.path));
        const me = members.find(m => m.name === name);
        if (me) _myTeamRoles[root.path] = me.role || 'editor';
      } catch {}
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
    await window.MeldexUserRegistry.upsertStaff({ user: me, display: me }, { fillOnly: true });
  } catch (e) {
    // ソースフォルダ未設定・オフライン等では起動処理を止めない。
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
    if (hasHome && !window.MeldexRuntimeAdapter?.isDropboxMode?.()) {
      window.MeldexSampleInstaller?.schedulePostSetupPrompt?.({
        trigger: 'desktop-home-ready',
        homePath: homeRes?.path || '',
      });
    }
    if (!vault.path && !hasRoots && !hasHome) {
      // ソースフォルダもルートもホームもない場合はウェルカム画面
      // ただしサイドバーは表示したまま（設定ボタンにアクセスできるように）
      showView('welcome');
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
    if (typeof removeLegacyDashboardStorageOnce === 'function') removeLegacyDashboardStorageOnce();

    // フォルダツリーとビュー復元を並行実行
    const outlinerStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
    const outlinerPromise = Promise.resolve(loadOutliner()).finally(() => {
      if (typeof _logPerfEvent === 'function') _logPerfEvent('startup.loadOutliner.promise', outlinerStartedAt);
    });
    const linkDictPromise = loadLinkDict();

    // URLパラメータによる初期表示（新しいタブ/ウィンドウで開く用）
    let restored = onboardingShown;
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
        else if (openType === 'smart-db') {
          if (typeof openSmartDbFile === 'function') {
            openSmartDbFile(openLabel, openPath, _urlOpenOpts);
            restored = true;
          }
        }
      } finally {
        window._skipLastViewSave = previousSkipLastView;
      }
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
          else if (last.type === 'media' && last.path) { openMedia(last.label || '', last.path, last.mediaType || 'image', _expOpts); restored = true; }
          else if (last.type === 'html' && last.path) { openHtmlFile(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'csv' && last.path) { if (typeof openCsvFile === 'function') { openCsvFile(last.label || '', last.path, _expOpts); restored = true; } }
          else if (last.type === 'scriptnote' && last.path && typeof openScenarioInScriptNote === 'function') { openScenarioInScriptNote(last.path, last.label || '', _expOpts); restored = true; }
          else if (last.type === 'folder' && last.path) { openFolder(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'calendar' && last.path) { await openCalendarFile(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'smart-db' && last.path && last.path.startsWith('file:') === false && typeof openSmartDbFile === 'function') { openSmartDbFile(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'smart-db' && last.smartDbId) { selectSmartDb(last.smartDbId, null, _expOpts); restored = true; }
        }
      } catch (e) {}
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('startup.restore-last-view', restoreStartedAt, { restored });
      }
    } // if (!restored) from URL params

    // 初回起動: lastView もURLパラメータも無く、過去にクイックスタートを開いた履歴が無ければ
