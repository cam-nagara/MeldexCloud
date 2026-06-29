  if (fileId) return 'db:' + fileId;
  if (dbPath) return 'db:' + String(dbPath).replace(/\\/g, '/');
  return (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
}
function _refreshDbViewConfigAfterHistory(dbPath) {
  if (!dbPath || state.currentDbPath !== dbPath) return;
  const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : undefined;
  if (typeof selectDatabase === 'function') {
    Promise.resolve(selectDatabase(dbPath, ctx, {
      silent: true,
      skipRecent: true,
      skipNavPush: true,
      skipSaveLastView: true,
      skipAutoVersion: true,
    })).catch(() => {});
  } else if (typeof renderPivot === 'function') {
    renderPivot(ctx);
  }
}
function captureDbViewConfigHistory(dbPath) {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return null;
  return captureLocalStorageSettings([getDbViewConfigStorageKey(dbPath)]);
}
function pushDbViewConfigHistory(dbPath, label, beforeSnapshot, afterSnapshot, detail, onRestore) {
  if (!beforeSnapshot || !afterSnapshot || typeof historyPush !== 'function'
    || typeof restoreLocalStorageSettings !== 'function'
    || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return false;
  const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, afterSnapshot);
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(snapshots.before);
    afterKey = JSON.stringify(snapshots.after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  const refresh = typeof onRestore === 'function'
    ? onRestore
    : () => _refreshDbViewConfigAfterHistory(dbPath);
  const restoreViewConfigSnapshot = (snapshot) => {
    const restored = restoreLocalStorageSettings(snapshot);
    if (!restored) return false;
    const finish = () => refresh(snapshot.keys || [], snapshot);
    if (typeof _persistDbViewConfigToBackend === 'function') {
      return _persistDbViewConfigToBackend(dbPath, getDbViewConfig(dbPath), { immediate: true })
        .finally(finish);
    }
    return finish();
  };
  historyPush(
    label || 'シート表示設定',
    () => restoreViewConfigSnapshot(snapshots.before),
    () => restoreViewConfigSnapshot(snapshots.after),
    _dbViewConfigHistoryScope(dbPath),
    detail || ''
  );
  return true;
}
function withDbViewConfigHistory(dbPath, label, mutator, detail, onRestore) {
  const before = captureDbViewConfigHistory(dbPath);
  const result = typeof mutator === 'function' ? mutator() : undefined;
  const after = captureDbViewConfigHistory(dbPath);
  pushDbViewConfigHistory(dbPath, label, before, after, detail, onRestore);
  return result;
}
function saveDbViewConfig(dbPath, cfg, options = {}) {
  const key = getDbViewConfigStorageKey(dbPath);
  const label = options.historyLabel || options.label || '';
  const before = (label && options.skipHistory !== true) ? captureDbViewConfigHistory(dbPath) : null;
  localStorage.setItem(key, JSON.stringify(cfg || {}));
  if (options.skipBackend !== true) {
    _persistDbViewConfigToBackend(dbPath, cfg || {}, { immediate: options.flushBackend === true });
  }
  if (label && options.skipHistory !== true) {
    pushDbViewConfigHistory(
      dbPath,
      label,
      before,
      captureDbViewConfigHistory(dbPath),
      options.historyDetail || options.detail || '',
      options.onRestore
    );
  }
}
function _getCurrentDbViewIndexFromConfig(cfg, options = {}) {
  const views = Array.isArray(cfg?.savedViews) ? cfg.savedViews : [];
  if (views.length === 0) return -1;
  const ctxIdx = Number.isInteger(options?.ctx?.currentViewIdx) ? options.ctx.currentViewIdx : null;
  const optIdx = Number.isInteger(options?.currentViewIdx) ? options.currentViewIdx : null;
  const rawIdx = ctxIdx != null ? ctxIdx : (optIdx != null ? optIdx : (Number.isInteger(cfg.currentViewIdx) ? cfg.currentViewIdx : 0));
  return rawIdx >= 0 && rawIdx < views.length ? rawIdx : 0;
}
function _getCurrentDbViewConfigEntryFromConfig(cfg, options = {}) {
  const views = Array.isArray(cfg?.savedViews) ? cfg.savedViews : [];
  const idx = _getCurrentDbViewIndexFromConfig(cfg, options);
  if (idx < 0) return null;
  return views[idx] || null;
}
function getCurrentDbViewConfigEntry(dbPath, options = {}) {
  return _getCurrentDbViewConfigEntryFromConfig(getDbViewConfig(dbPath), options);
}
function getCurrentViewMode(dbPath, options = {}) {
  return getCurrentDbViewConfigEntry(dbPath, options)?.viewMode || 'pivot';
}
function getCurrentDbViewTypeSpecific(dbPath, type, options = {}) {
  const bucket = getCurrentDbViewConfigEntry(dbPath, options)?.typeSpecific?.[type];
  return _isDbViewPlainObject(bucket) ? bucket : null;
}
function _saveCurrentDbViewField(dbPath, label, detail, options, mutator) {
  const c = getDbViewConfig(dbPath);
  const v = _getCurrentDbViewConfigEntryFromConfig(c, options);
  if (!v || typeof mutator !== 'function') return false;
  mutator(v, c);
  saveDbViewConfig(dbPath, c, {
    historyLabel: label || '',
    historyDetail: detail || '',
    skipHistory: options?.skipHistory === true || !label,
  });
  return true;
}
function setCurrentDbViewTypeSpecific(dbPath, type, value, options = {}) {
  const label = options.historyLabel || options.label || '';
  return _saveCurrentDbViewField(dbPath, label, options.detail || '', options, (v) => {
    if (!_isDbViewPlainObject(v.typeSpecific)) v.typeSpecific = {};
    v.typeSpecific[type] = _isDbViewPlainObject(value) ? value : {};
  });
}
// 非表示カラム
function getHiddenCols(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.hiddenCols || []; }
function setHiddenCols(dbPath, cols, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 表示列', options.detail || '', options, (v) => { v.hiddenCols = cols; });
}
// ピン留めカラム
function getPinnedCols(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.pinnedCols || []; }
function setPinnedCols(dbPath, cols, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 固定列', options.detail || '', options, (v) => { v.pinnedCols = cols; });
}
// カウントタイプ
function getCountTypes(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.countTypes || {}; }
function setCountType(dbPath, prop, type, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 集計タイプ', options.detail || prop || '', options, (v) => {
    if (!v.countTypes || typeof v.countTypes !== 'object' || Array.isArray(v.countTypes)) v.countTypes = {};
    v.countTypes[prop] = type;
  });
}
// カラム幅
function getColWidths(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.colWidths || {}; }
function setColWidthPersist(dbPath, prop, w, options = {}) {
  const label = options.historyLabel || options.label || '';
  _saveCurrentDbViewField(dbPath, label, options.detail || prop || '', options, (v) => {
    if (!v.colWidths || typeof v.colWidths !== 'object' || Array.isArray(v.colWidths)) v.colWidths = {};
    v.colWidths[prop] = w;
  });
}
// 条件付き書式ON/OFF
function getConditionalFormat(dbPath, options = {}) { return !!getCurrentDbViewConfigEntry(dbPath, options)?.conditionalFormat; }
function setConditionalFormat(dbPath, on, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 条件付き書式', options.detail || (on ? '有効' : '無効'), options, (v) => { v.conditionalFormat = !!on; });
}
// 集計行
function getShowFooter(dbPath, options = {}) { return !!getCurrentDbViewConfigEntry(dbPath, options)?.showFooter; }
function setShowFooter(dbPath, on, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 集計行', options.detail || (on ? '表示' : '非表示'), options, (v) => { v.showFooter = !!on; });
}
// エントリ名列固定
function getEntityColumnPinned(dbPath, options = {}) {
  const view = getCurrentDbViewConfigEntry(dbPath, options);
  return view ? view.entityColumnPinned !== false : true;
}
function setEntityColumnPinned(dbPath, on, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: エントリ名列固定', options.detail || (on ? '固定' : '解除'), options, (v) => { v.entityColumnPinned = on !== false; });
}
// ステータス機能ON/OFF（既定OFF。OFF時は候補値追加・ステータスドット・一括編集ステータスを非表示）
function getStatusEnabled(dbPath) { return getDbViewConfig(dbPath).statusEnabled === true; }
function setStatusEnabled(dbPath, on, options = {}) {
  const c = getDbViewConfig(dbPath);
  c.statusEnabled = !!on;
  saveDbViewConfig(dbPath, c, { historyLabel: options.label || 'シート表示: ステータス機能', historyDetail: options.detail || (on ? 'オン' : 'オフ'), skipHistory: options.skipHistory === true });
}
// サムネサイズ
function getThumbnailSize(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.thumbnailSize || 'small'; }
function setThumbnailSize(dbPath, size, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: サムネイル', options.detail || size || '', options, (v) => { v.thumbnailSize = size; });
}
// カラム順序
function getColOrder(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.colOrder || null; }
function setColOrder(dbPath, order, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 列順序', options.detail || '', options, (v) => { v.colOrder = order; });
}
// 並び替え
function getDbSortConfig(dbPath, options = {}) {
  const sc = getCurrentDbViewConfigEntry(dbPath, options)?.sortConfig;
  return sc && typeof sc === 'object' && sc.key ? sc : null;
}
function setDbSortConfig(dbPath, sortConfig, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 並び替え', options.detail || '', options, (v) => {
    if (sortConfig == null) delete v.sortConfig;
    else v.sortConfig = _cloneDbViewValue(sortConfig, null);
  });
}
// マニュアル行順序
function getDbManualOrder(dbPath, options = {}) {
  const order = getCurrentDbViewConfigEntry(dbPath, options)?.manualOrder;
  return Array.isArray(order) ? order : null;
}
function setDbManualOrder(dbPath, order, sortConfig, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || '', options.detail || '', options, (v) => {
    if (Array.isArray(order)) v.manualOrder = [...order];
    else delete v.manualOrder;
    if (sortConfig !== undefined) {
      if (sortConfig == null) delete v.sortConfig;
      else v.sortConfig = _cloneDbViewValue(sortConfig, null);
    }
  });
}
// 複数条件フィルタ
function getAdvancedFilters(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.advancedFilters || []; }
function setAdvancedFilters(dbPath, filters, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 複数条件フィルタ', options.detail || '', options, (v) => { v.advancedFilters = filters; });
}

const _DEFAULT_STATUS_LIST = [
  { name: '案',     color: '#ce9178' },
  { name: '採用',   color: '#6fa8dc' },
  { name: 'ボツ',   color: '#969696' },
  { name: '掲載済み', color: '#6a9955' },
];
// DB単位のカスタムステータス取得
function getStatusList(dbPath) {
  if (dbPath) {
    const cfg = getDbViewConfig(dbPath);
    if (cfg.statusList && cfg.statusList.length > 0) return cfg.statusList;
  }
  return _DEFAULT_STATUS_LIST;
}
function setStatusList(dbPath, list) {
  const cfg = getDbViewConfig(dbPath);
  cfg.statusList = list;
  saveDbViewConfig(dbPath, cfg, { historyLabel: 'シート表示: ステータス一覧' });
}
function _getStatusColor(statusName, dbPath) {
  const list = getStatusList(dbPath);
  const found = list.find(s => s.name === statusName);
  if (found) return found.color;
  // 後方互換フォールバック
  if (STATUS_MAP[statusName]) return STATUS_MAP[statusName].color;
  return list.length > 0 ? list[0].color : '#ce9178';
}
// 後方互換: 旧コードが STATUS_MAP/STATUS_LIST を参照する場合のフォールバック
const STATUS_MAP = {
  '掲載済み': { cls: 'st-published', color: '#6a9955' },
  '採用':     { cls: 'st-adopted',   color: '#6fa8dc' },
  '案':       { cls: 'st-draft',     color: '#ce9178' },
  'ボツ':     { cls: 'st-rejected',  color: '#969696' },
};
const STATUS_LIST = ['案', '採用', 'ボツ', '掲載済み'];

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

function _apiFetchInFlightKey(path, opts) {
  const method = String(opts?.method || 'GET').toUpperCase();
  if (method !== 'GET') return '';
  const nonBenignKeys = Object.keys(opts || {}).filter(key => key !== 'silentError');
  if (nonBenignKeys.length > 0) return '';
  try {
    const url = new URL(String(path || ''), 'http://meldex.local');
    const endpoint = url.pathname || '';
    if (!_apiFetchObservedGetEndpoints.has(endpoint)) return '';
    return endpoint + '?' + url.searchParams.toString();
  } catch {
    return '';
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
      message: `[perf] ${label}: ${durationMs}ms`,
      perf: true,
      label,
      durationMs,
      ...(detail || {}),
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

async function apiFetch(path, opts) {
  const inFlightKey = _apiFetchInFlightKey(path, opts);
  if (inFlightKey && _apiFetchInFlightGets.has(inFlightKey)) {
    return _apiFetchInFlightGets.get(inFlightKey);
  }
  const perfInfo = _apiFetchPerfInfo(path);
  const perfStartedAt = perfInfo ? _perfNowMs() : 0;
  const requestPromise = (async () => {
    try {
      const res = await fetch(API_BASE + path, opts);
      if (perfInfo) {
        _logPerfEvent(perfInfo.label + '.fetch', perfStartedAt, {
          ...perfInfo,
          status: res.status,
          contentLength: res.headers?.get?.('content-length') || '',
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
        });
      }
      if (backendPerf && data && typeof data === 'object') {
        try {
          Object.defineProperty(data, '_backendPerf', {
            value: backendPerf,
            configurable: true,
          });
        } catch {}
      }
      window.MeldexSaveSafety?.reportApiSuccess?.(path, opts);
      if (perfInfo) _logPerfEvent(perfInfo.label, perfStartedAt, { ...perfInfo, backendPerf });
      return data;
    } catch (e) {
      if (perfInfo) {
        _logPerfEvent(perfInfo.label + '.error', perfStartedAt, {
          ...perfInfo,
          error: e?.message || String(e),
        });
      }
      if (!opts?.silentError) window.MeldexDiagnostics?.captureApiError?.(path, opts, e);
      if (!opts?.silentError && !window.MeldexSaveSafety?.reportApiError?.(path, opts, e)) {
        const text = window.MeldexErrorMessages?.toStatusText?.(e, { path }) || e.message;
        showStatus('エラー: ' + text, true);
      }
      throw e;
    }
  })();
  if (inFlightKey) {
    _apiFetchInFlightGets.set(inFlightKey, requestPromise);
    requestPromise.then(
      () => _apiFetchInFlightGets.delete(inFlightKey),
      () => _apiFetchInFlightGets.delete(inFlightKey),
    );
  }
  return requestPromise;
}

async function apiPut(path, body) {
  return apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
    if (oldPath && newName) _apiLockAddPath(paths, (_apiLockPathDir(oldPath) ? _apiLockPathDir(oldPath) + '/' : '') + newName);
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

// apiFetchをオーバーライドしてユーザー名を付加
const _origApiFetch = apiFetch;
apiFetch = async function(path, opts) {
  opts = opts || {};
  const lockCandidatePaths = _apiLockWriteCandidatePaths(path, opts);
  _apiLockBlockIfNeeded(path, opts);
  if (window.MeldexActiveLocks?.beforeApiFetch) {
    opts = await window.MeldexActiveLocks.beforeApiFetch(path, opts, { candidatePaths: lockCandidatePaths });
  }
  // _user パラメータを自動付与（監査ログ・modified_by 用）
  const user = getUsername();
  if (user && user !== 'anonymous') {
    const sep = path.includes('?') ? '&' : '?';
    path += sep + '_user=' + encodeURIComponent(user);
  }
  return _origApiFetch(path, opts);
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
function _hideStartupSplash() {
  if (_startupSplashHidden) return;
  _startupSplashHidden = true;
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
