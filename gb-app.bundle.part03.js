      navNavigating = false;
      return;
    }
    _finishPaneHistoryNavigation(navState, nextIndex, entry);
  }).catch((error) => {
    navNavigating = false;
    if (typeof showStatus === 'function') showStatus('画面遷移前の保存に失敗しました: ' + (error?.message || error), true);
  });
  return true;
}

// ナビゲーション履歴の戻る/進む
function navBack(paneId) {
  const railState = typeof GBPanelSet !== 'undefined' && typeof GBPanelSet.rightRailNavigationState === 'function'
    ? GBPanelSet.rightRailNavigationState(paneId)
    : null;
  if (railState) return GBPanelSet.navigateRightRail(paneId, -1);
  const navState = _getNavState(paneId);
  if (navState.index <= 0) return false;
  const nextIndex = navState.index - 1;
  const entry = navState.history[nextIndex];
  if (!entry) return false;
  try {
    return _continuePaneHistoryAfterFlush(
      navState, nextIndex, entry, _applyNavEntryToBoundTab(navState, entry),
    );
  } catch (e) {
    navNavigating = false;
    throw e;
  }
}
function navForward(paneId) {
  const railState = typeof GBPanelSet !== 'undefined' && typeof GBPanelSet.rightRailNavigationState === 'function'
    ? GBPanelSet.rightRailNavigationState(paneId)
    : null;
  if (railState) return GBPanelSet.navigateRightRail(paneId, 1);
  const navState = _getNavState(paneId);
  if (navState.index < 0 || navState.index >= navState.history.length - 1) return false;
  const nextIndex = navState.index + 1;
  const entry = navState.history[nextIndex];
  if (!entry) return false;
  try {
    return _continuePaneHistoryAfterFlush(
      navState, nextIndex, entry, _applyNavEntryToBoundTab(navState, entry),
    );
  } catch (e) {
    navNavigating = false;
    throw e;
  }
}

function showPaneNavHistoryDropdown(e, paneId, direction) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.nav-history-dropdown').forEach(el => el.remove());
  const navState = _getNavState(paneId);
  const items = [];
  if (direction === 'back') {
    for (let i = navState.index - 1; i >= Math.max(0, navState.index - 15); i--) items.push({ index: i, entry: navState.history[i] });
  } else {
    for (let i = navState.index + 1; i <= Math.min(navState.history.length - 1, navState.index + 15); i++) items.push({ index: i, entry: navState.history[i] });
  }
  if (items.length === 0) return;

  const dd = document.createElement('div');
  dd.className = 'ab-dropdown nav-history-dropdown';
  dd.setAttribute('role', 'menu');
  dd.setAttribute('aria-label', direction === 'back' ? '戻る履歴' : '進む履歴');
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:220px;max-width:360px;max-height:400px;overflow-y:auto;';
  items.forEach(({ index, entry }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ab-dropdown-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = entry.label || entry.path?.split('/').pop() || '(不明)';
    item.title = entry.path || '';
    item.addEventListener('click', async () => {
      try {
        const applied = await _applyNavEntryToBoundTab(navState, entry);
        if (!applied) return;
        _finishPaneHistoryNavigation(navState, index, entry);
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

let _pointerNavTargetId = null;

function _pointerNavigationTargetId(target) {
  const fixedRightDock = target?.closest?.('.gb-dock-fixed-right[data-panelset-id]');
  if (fixedRightDock?.dataset?.panelsetId) return fixedRightDock.dataset.panelsetId;
  return target?.closest?.('.gb-pane')?.dataset?.paneId || null;
}

function _handlePointerNavigationButtons(e) {
  if (e.button !== 3 && e.button !== 4) return;
  const paneId = _pointerNavTargetId || _pointerNavigationTargetId(e.target) || undefined;
  _pointerNavTargetId = null;
  // 以前フォーカスしていた入力欄ではなく、実際にサイドボタンを押した場所で判定する。
  // 入力後に表や本文へマウスを移しても activeElement は入力欄のまま残るため、旧判定では
  // 戻る/進むが永続的に無効になっていた。入力要素そのものの上で押した時だけ保護する。
  const editableTarget = e.target?.closest?.('input, textarea, select, [contenteditable="true"]');
  if (editableTarget) return;
  if (e.button === 3) {
    if (navBack(paneId)) e.preventDefault();
  } else if (e.button === 4) {
    if (navForward(paneId)) e.preventDefault();
  }
}

window.addEventListener('mousedown', (e) => {
  if (e.button === 3 || e.button === 4) {
    _pointerNavTargetId = _pointerNavigationTargetId(e.target);
    e.preventDefault();
  }
}, true);
window.addEventListener('mouseup', _handlePointerNavigationButtons, true);
window.addEventListener('pointercancel', () => { _pointerNavTargetId = null; }, true);

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
  rememberRailAppFile(obj);
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
const GB_APP_API_FETCH_MAX_TIMEOUT_MS = 330000;
// OSのフォルダ／ファイル選択は利用者の操作を待つため、通常APIの15秒上限を使わない。
// サーバー側の待機上限（フォルダ120秒、ファイル300秒）より少し長くして、正常な
// 選択結果をフロント側が先に破棄しない。パスだけを入力する検証POSTも同じendpointを
// 使うが、長い上限は実際の処理時間を延ばさず、応答が止まった場合だけ作用する。
const GB_APP_API_FETCH_NATIVE_DIALOG_TIMEOUTS = new Map([
  ['/pick-folder', 135000],
  ['/add-outliner-root', 135000],
  ['/dropbox-link/pick-workspace-folder', 135000],
  ['/workspaces/pick-folder', 135000],
  ['/standalone/pick-folder', 135000],
  ['/save-file-dialog', 315000],
  ['/open-file-dialog', 315000],
  ['/settings-transfer/export', 315000],
]);
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
  const nativeDialogTimeout = GB_APP_API_FETCH_NATIVE_DIALOG_TIMEOUTS.get(pathname);
  if (nativeDialogTimeout) return nativeDialogTimeout;
  // Cloud reads may include a large sheet and bounded Dropbox retry waits.
  if (window.MeldexRuntimeAdapter?.getMode?.() === 'dropbox'
      && ['/pivot', '/db-metadata', '/value', '/browse', '/check-type'].includes(pathname)) return 120000;
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
    return (url.pathname === '/browse' || (url.pathname === '/pivot' && url.searchParams.get('tree_only') === 'true'))
      ? _gbAppApiFetchCanonicalGetPath(path) : '';
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
  if (cacheKey.startsWith('/pivot?') && payload?.tree_only !== true) return;
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

// Leave HTTP/1 connection slots for saves and the newly opened document.
// Startup/background reads must not queue a user mutation behind all six
// browser connections. Do not cancel these reads or change their results.
let _gbAppRegularRequests = 0;
const _gbAppRegularRequestQueue = [];
function _gbAppApiFetchAcquireLane(path, opts) {
  const endpoint = String(path || '').split('?', 1)[0].replace(/^\/api/, '');
  const backgroundWrite = ['/beta/consent', '/beta/feedback-template', '/staff-registry/upsert', '/debugger/flush'].includes(endpoint);
  const visibleRead = opts?.background !== true && (opts?.foreground === true || ['/file', '/browse', '/outliner-roots'].includes(endpoint));
  const regular = (_gbAppApiFetchMethod(opts) === 'GET' && !visibleRead) || backgroundWrite;
  const signal = opts?.signal;
  const abortError = () => Object.assign(new Error('リクエストが中断されました'), {name:'AbortError'});
  if (signal?.aborted) return Promise.reject(abortError());
  if (!regular) return Promise.resolve(() => {});
  return new Promise((resolve, reject) => {
    const entry = {
      start() {
        signal?.removeEventListener('abort', entry.abort);
        _gbAppRegularRequests++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          _gbAppRegularRequests--;
          _gbAppRegularRequestQueue.shift()?.start();
        });
      },
      abort() {
        const index = _gbAppRegularRequestQueue.indexOf(entry);
        if (index < 0) return;
        _gbAppRegularRequestQueue.splice(index, 1);
        signal?.removeEventListener('abort', entry.abort);
        reject(abortError());
      },
    };
    if (_gbAppRegularRequests < 3) entry.start();
    else {
      _gbAppRegularRequestQueue.push(entry);
      signal?.addEventListener('abort', entry.abort, {once:true});
    }
  });
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
    let releaseLane;
    try {
      releaseLane = await _gbAppApiFetchAcquireLane(path, opts);
      let requestOpts = opts;
      let retriedAfterMutation = false;
      while (true) {
        const requestedTimeout = Number(requestOpts?.timeoutMs);
        const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
          ? Math.min(requestedTimeout, GB_APP_API_FETCH_MAX_TIMEOUT_MS)
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
    } finally {
      releaseLane?.();
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
      const result = await send(uncertain);
      _gbAppPendingValueWrites.delete(key);
      const canonical = value => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
      const withoutId = value => JSON.stringify(canonical(Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'operation_id'))));
      if (withoutId(body) === withoutId(uncertain)) return result;
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
    const result = await _gbAppPutValueConfirmed(path, guardedBody, options);
    _scheduleLinkDictionaryRefreshForMutation(path);
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

async function apiPost(path, body, options = {}) {
  let stableCopyKey = '';
  if (['/outliner/duplicate', '/outliner/save-as'].includes(String(path || ''))
      && body && typeof body === 'object' && !body.operation_id) {
    const prepared = window.MeldexStableCopyOperationIds?.prepare?.(path, body)
      || { body: { ...body, operation_id: crypto.randomUUID() }, key: '' };
    body = prepared.body; stableCopyKey = prepared.key;
  }
  const result = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(options || {}),
  });
  window.MeldexStableCopyOperationIds?.complete(stableCopyKey);
  _scheduleLinkDictionaryRefreshForMutation(path);
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
