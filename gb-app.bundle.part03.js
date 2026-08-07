      } catch (e) {
        navNavigating = false;
        throw e;
      }
      _refreshPaneNavUi(navState.paneId);
      _persistPaneNavState(navState);
      closeDropdown(false);
    });
    dd.appendChild(item);
  });
  const anchor = e.currentTarget || e.target?.closest?.('button') || e.target;
  const rect = anchor.getBoundingClientRect();
  document.body.appendChild(dd);
  if (typeof positionPopup === 'function') positionPopup(dd, rect, { prefer: 'bottom', gap: 2 });
  else {
    const z = _getZoom();
    dd.style.left = (rect.left / z) + 'px';
    dd.style.top = (rect.bottom / z + 2) + 'px';
    clampPopupToViewport(dd);
  }
  const firstItem = dd.querySelector('.ab-dropdown-item');
  let dropdownClosed = false;
  function closeDropdown(restoreFocus) {
    if (dropdownClosed) return;
    dropdownClosed = true;
    dd.remove();
    document.removeEventListener('pointerdown', closeOnPointer, true);
    document.removeEventListener('keydown', closeOnKey, true);
    if (restoreFocus && anchor?.focus) anchor.focus();
  }
  function closeOnPointer(ev) {
    if (!dd.contains(ev.target)) closeDropdown(false);
  }
  function closeOnKey(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeDropdown(true);
      return;
    }
    const menuItems = [...dd.querySelectorAll('.ab-dropdown-item')];
    const current = menuItems.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' && menuItems.length) {
      ev.preventDefault();
      menuItems[(current + 1 + menuItems.length) % menuItems.length].focus();
    } else if (ev.key === 'ArrowUp' && menuItems.length) {
      ev.preventDefault();
      menuItems[(current - 1 + menuItems.length) % menuItems.length].focus();
    } else if (ev.key === 'Home' && menuItems.length) {
      ev.preventDefault();
      menuItems[0].focus();
    } else if (ev.key === 'End' && menuItems.length) {
      ev.preventDefault();
      menuItems[menuItems.length - 1].focus();
    }
  }
  setTimeout(() => {
    if (dropdownClosed || !dd.isConnected) return;
    document.addEventListener('pointerdown', closeOnPointer, true);
    document.addEventListener('keydown', closeOnKey, true);
  }, 0);
  firstItem?.focus();
}

function showNavHistoryDropdown(e, direction) {
  return showPaneNavHistoryDropdown(e, null, direction);
}

function updateNavBreadcrumb() {}

let _pointerNavPaneId = null;

function _handlePointerNavigationButtons(e) {
  if (e.button !== 3 && e.button !== 4) return;
  const ae = document.activeElement;
  if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
  const paneId = _pointerNavPaneId || e.target?.closest?.('.gb-pane')?.dataset?.paneId || undefined;
  _pointerNavPaneId = null;
  if (e.button === 3) {
    if (navBack(paneId)) e.preventDefault();
  } else if (e.button === 4) {
    if (navForward(paneId)) e.preventDefault();
  }
}

window.addEventListener('mousedown', (e) => {
  if (e.button === 3 || e.button === 4) {
    _pointerNavPaneId = e.target?.closest?.('.gb-pane')?.dataset?.paneId || null;
    e.preventDefault();
  }
}, true);
window.addEventListener('mouseup', _handlePointerNavigationButtons, true);
window.addEventListener('pointercancel', () => { _pointerNavPaneId = null; }, true);

// esc() は meldex-core.js で定義済み
function saveLastView(obj) {
  try {
    if (typeof _chatSetCurrentTargetFromView === 'function') _chatSetCurrentTargetFromView(obj, { reason: 'last-view', deferAdoptSource: true });
  } catch {}
  // 単一タブポップアウト窓では元ウィンドウの lastView を汚染しないよう常にスキップ
  if (window._skipLastViewSave || window._gbSingleWindow) return;
  // file_id を付与
  const filePath = obj?.path || obj?.dbPath || obj?.entityPath || '';
  if (obj && filePath && !obj.file_id) {
    const fid = _pathToFileId(filePath);
    if (fid) obj.file_id = fid;
  }
  localStorage.setItem('lastView', JSON.stringify(obj));
}

function _isCloudPhase1UnsupportedOpenType(type) {
  return !!window.MeldexCloudBootstrap?.isPhase1UnsupportedType?.(type);
}

function _showCloudPhase1UnsupportedOpen(type) {
  if (window.MeldexCloudBootstrap?.showPhase1Unsupported) return window.MeldexCloudBootstrap.showPhase1Unsupported(type);
  showStatus('ブラウザ版Meldexではまだ未対応のビューです', true);
  return false;
}

function _pathTailLabel(path, fallback) {
  const raw = String(path || '').replace(/[\\/]+$/, '');
  if (!raw) return fallback || '';
  return raw.split(/[\\/]/).filter(Boolean).pop() || fallback || raw;
}

function _startupFolderCandidate(roots, homeRes, vault) {
  if (homeRes?.exists && homeRes.path) {
    try {
      if (typeof _homeFolderPath !== 'undefined') _homeFolderPath = homeRes.path;
    } catch (e) {}
    return { label: (typeof HOME_FOLDER_DISPLAY_LABEL !== 'undefined' ? HOME_FOLDER_DISPLAY_LABEL : 'ホームフォルダ'), path: homeRes.path };
  }
  const root = Array.isArray(roots)
    ? roots.find(r => r && r.path && r.visible !== false)
    : null;
  if (root) return { label: root.name || _pathTailLabel(root.path, 'フォルダ'), path: root.path };
  if (vault?.path) {
    return { label: vault.name || _pathTailLabel(vault.path, 'フォルダ'), path: vault.path };
  }
  return null;
}

function _isDesktopStartupLaunch() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('desktop') === '1' || document.documentElement?.dataset?.desktopLaunch === '1';
  } catch {
    return false;
  }
}

function _paneLayoutHasAnyTabs() {
  try {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function' || !GBLayout.root) return false;
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    return panes.some(p => Array.isArray(p?.tabs) && p.tabs.length > 0);
  } catch {
    return false;
  }
}

const STARTUP_LAYOUT_UTILITY_TAB_TYPES = new Set([
  'outliner',
  'detail',
  'preview',
  'chat',
  'calendar',
  'timer',
  'history',
  'annotation',
  'sticky',
  'search',
  'version',
]);

function _paneLayoutHasContentTabs() {
  try {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function' || !GBLayout.root) return false;
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    return panes.some(pane => {
      if (typeof GBLayout.isPaneVisible === 'function' && !GBLayout.isPaneVisible(pane?.id)) return false;
      return (pane?.tabs || []).some(tab => !STARTUP_LAYOUT_UTILITY_TAB_TYPES.has(tab?.type));
    });
  } catch {
    return false;
  }
}

function _paneLayoutRestoredFromStorage() {
  return !!(typeof GBLayout !== 'undefined' && GBLayout.layoutLoadedFromStorage && _paneLayoutHasContentTabs());
}

/* ==============================
   API呼び出し
   ============================== */
function _perfNowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

function _perfElapsedMs(startedAt) {
  return Math.max(0, Math.round(_perfNowMs() - startedAt));
}

function _perfTargetLabelFromPath(path) {
  try {
    const url = new URL(String(path || ''), 'http://meldex.local');
    const rawPath = url.searchParams.get('path') || '';
    if (!rawPath) return '';
    return rawPath.split(/[\\/]/).filter(Boolean).pop() || rawPath;
  } catch {
    return '';
  }
}

const _apiFetchObservedGetEndpoints = new Set([
  '/outliner-roots',
  '/db-metadata',
  '/pivot',
  '/browse',
  '/check-type',
  '/file',
  '/file-meta',
  '/smart-db',
  '/global-index',
]);

function _apiFetchPerfInfo(path) {
  try {
    const url = new URL(String(path || ''), 'http://meldex.local');
    const endpoint = url.pathname || '';
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
// 共有設定（プロフィール等）の読み書きも Dropbox 同期フォルダ上のファイルを触るため、
// 同じ理由で15秒では足りずに「通信に失敗しました」の偽エラーになることがある
// （実機で、プロフィール統合の直後に発生。処理自体は成功していた）。
const GB_APP_API_FETCH_SHEET_ENDPOINTS = new Set(['/value', '/db-metadata', '/dropbox-link/settings-file']);
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

function _gbAppIsFullFileWrite(path, body) {
  const pathname = String(path || '').split('?', 1)[0].replace(/^\/api/, '');
  return pathname === '/file' && body && typeof body === 'object'
    && (Object.prototype.hasOwnProperty.call(body, 'content')
      || Object.prototype.hasOwnProperty.call(body, 'content_base64'));
}

async function _gbAppPrepareFullFileWrite(path, body) {
  const payload = { ...(body || {}) };
  if (!_gbAppIsFullFileWrite(path, payload)) return payload;
  const coordinator = window.MeldexDocumentSaveCoordinator;
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

async function apiPut(path, body, options = {}) {
  const guardedBody = await _gbAppPrepareFullFileWrite(path, body);
  return apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(guardedBody),
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
  // 全ソースフォルダに対応する管理レコードへ同期
  try {
    const roots = await apiFetch('/outliner-roots').catch(() => []);
    const visibleRoots = roots.filter(r => r.visible && r.path);
    if (visibleRoots.length === 0) {
      // ソースフォルダなし → デフォルトvaultに対応する管理レコードへ同期
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
