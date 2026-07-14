/* ==============================
   デバッグログ
   ============================== */
const _recentLogs = [];
const _RECENT_LOG_MAX = 50;

function _pushRecentLog(level, data) {
  _recentLogs.push({ level, time: new Date().toISOString(), ...data });
  if (_recentLogs.length > _RECENT_LOG_MAX) _recentLogs.shift();
}

function getRecentLogs() { return [..._recentLogs]; }

function _redactCrashLogData(data) {
  const safe = { ...(data || {}) };
  ['path', 'filePath', 'filename', 'fileName', 'targetPath', 'currentPath', 'currentPagePath', 'currentDbPath'].forEach((key) => {
    if (key in safe) safe[key] = '[redacted]';
  });
  return safe;
}

function _sendLog(level, data) {
  try {
    const safeData = _redactCrashLogData(data);
    _pushRecentLog(level, safeData);
    const payload = JSON.stringify({
      level,
      time: new Date().toISOString(),
      view: state?.view || '',
      ...safeData
    });
    if (window.MeldexBetaFeedback?.recordLog) {
      window.MeldexBetaFeedback.recordLog(level, JSON.parse(payload));
    }
    if (window.MeldexBetaFeedback && !window.MeldexBetaFeedback.isCrashReportEnabled()) return;
    if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) return;
    navigator.sendBeacon(API_BASE + '/debug-log',
      new Blob([payload], { type: 'text/plain' }));
  } catch {}
}

window.addEventListener('error', (e) => {
  _sendLog('error', {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    stack: e.error?.stack || ''
  });
});

window.addEventListener('unhandledrejection', (e) => {
  _sendLog('error', {
    message: e.reason?.message || String(e.reason),
    stack: e.reason?.stack || ''
  });
});

/* ==============================
   状態管理
   ============================== */
// API_BASE は meldex-core.js で定義済み

/* ==============================
   file_id キャッシュ（同期参照専用、APIコール禁止）
   ============================== */
const _fileIdCache = {};  // { path: file_id }
const _pathCache = {};    // { file_id: path }
const FILE_ID_MAP_KEY = 'meldex-file-id-map';
let _storedFileIdMapCache = null;

function _normalizeStoredFileIdMap(map) {
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

function _readLatestStoredFileIdMap() {
  return _normalizeStoredFileIdMap(_readStorageJson(FILE_ID_MAP_KEY, {}));
}

function _storedFileIdMap() {
  if (_storedFileIdMapCache) return _storedFileIdMapCache;
  _storedFileIdMapCache = _readLatestStoredFileIdMap();
  return _storedFileIdMapCache;
}

function _rememberFileId(path, fileId) {
  const previousId = _fileIdCache[path];
  if (previousId && previousId !== fileId && _pathCache[previousId] === path) delete _pathCache[previousId];
  _fileIdCache[path] = fileId;
  _pathCache[fileId] = path;
}

function _registerFileIds(items) {
  const entries = Array.isArray(items)
    ? items.map(item => [item?.path, item?.file_id || item?.fileId])
    : Object.entries(items || {});
  if (!entries.length) return 0;
  const validEntries = entries.filter(([path, fileId]) => !!(path && fileId));
  if (!validEntries.length) return 0;
  const hadStoredCache = _storedFileIdMapCache != null;
  let map = _storedFileIdMap();
  let changed = false;
  let registered = 0;
  for (const [path, fileId] of validEntries) {
    _rememberFileId(path, fileId);
    registered += 1;
    if (map[path] !== fileId) changed = true;
  }
  if (changed) {
    // 別ウィンドウが追加したキーを古いセッションキャッシュで消さないよう、
    // 変更バッチの書き込み直前にだけ最新値を再読込する。初回バッチは
    // _storedFileIdMap() の1回をそのまま使うため、I/Oは最大1 read + 1 write。
    if (hadStoredCache) map = _readLatestStoredFileIdMap();
    let persistedChanged = false;
    for (const [path, fileId] of validEntries) {
      if (map[path] === fileId) continue;
      map[path] = fileId;
      persistedChanged = true;
    }
    _storedFileIdMapCache = map;
    if (persistedChanged) {
      try { localStorage.setItem(FILE_ID_MAP_KEY, JSON.stringify(map)); } catch {}
    }
  }
  return registered;
}

function _registerFileId(path, fileId) {
  if (!path || !fileId) return;
  if (_fileIdCache[path] === fileId && _pathCache[fileId] === path) return;
  _registerFileIds([{ path, file_id: fileId }]);
}

function _pathToFileId(path) {
  if (!path) return '';
  if (_fileIdCache[path]) return _fileIdCache[path];
  const fileId = _storedFileIdMap()[path] || '';
  if (fileId) _rememberFileId(path, fileId);
  return fileId;
}

function _fileIdToPath(fileId) {
  return _pathCache[fileId] || '';
}

function _syncStoredFileIdMapFromStorageEvent(event) {
  if (!event || event.key !== FILE_ID_MAP_KEY) return;
  let next = {};
  try { next = _normalizeStoredFileIdMap(event.newValue ? JSON.parse(event.newValue) : {}); } catch {}
  const previous = _storedFileIdMapCache || {};
  Object.entries(previous).forEach(([path, fileId]) => {
    if (Object.prototype.hasOwnProperty.call(next, path)) return;
    if (_fileIdCache[path] === fileId) delete _fileIdCache[path];
    if (_pathCache[fileId] === path) delete _pathCache[fileId];
  });
  _storedFileIdMapCache = next;
  Object.entries(next).forEach(([path, fileId]) => {
    if (path && fileId) _rememberFileId(path, fileId);
  });
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', _syncStoredFileIdMapFromStorageEvent);
}

function _readStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function _readStorageArray(key) {
  const parsed = _readStorageJson(key, []);
  return Array.isArray(parsed) ? parsed : [];
}

function _writeStorageJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function addLongPressHandler(element, handler, options = {}) {
  if (!element || typeof handler !== 'function') return () => {};
  const requestedDelayMs = Number.isFinite(options.duration) ? options.duration : options.delayMs;
  const requestedMoveTolerance = Number.isFinite(options.moveThreshold) ? options.moveThreshold : options.moveTolerance;
  const delayMs = Number.isFinite(requestedDelayMs) ? Math.max(20, requestedDelayMs) : 520;
  const moveTolerance = Number.isFinite(requestedMoveTolerance) ? Math.max(2, requestedMoveTolerance) : 10;
  let timer = null;
  let suppressTimer = null;
  let startX = 0;
  let startY = 0;
  let pointerId = null;
  let fired = false;
  let suppressNextActivation = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pointerId = null;
    fired = false;
  };
  const clearSuppression = () => {
    if (suppressTimer) clearTimeout(suppressTimer);
    suppressTimer = null;
    suppressNextActivation = false;
  };
  const scheduleSuppressionReset = () => {
    if (suppressTimer) clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => {
      suppressTimer = null;
      suppressNextActivation = false;
    }, 700);
  };
  const consumeSuppressedActivation = (event) => {
    if (!suppressNextActivation) return false;
    event.preventDefault();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    else event.stopPropagation();
    fired = false;
    clearSuppression();
    return true;
  };
  const createLongPressEvent = (event) => ({
    clientX: startX,
    clientY: startY,
    target: event.target || element,
    currentTarget: element,
    pointerType: event.pointerType || 'touch',
    pointerId: event.pointerId,
    originalEvent: event,
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    stopImmediatePropagation: () => {
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      else event.stopPropagation();
    },
  });

  const cancelIfMoved = (event) => {
    if (pointerId == null || event.pointerId !== pointerId) return;
    if (Math.abs(event.clientX - startX) > moveTolerance || Math.abs(event.clientY - startY) > moveTolerance) clear();
  };

  const onDown = (event) => {
    if (event.pointerType === 'mouse' && options.mouse !== true) return;
    if (event.button != null && event.button !== 0) return;
    clear();
    clearSuppression();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      suppressNextActivation = true;
      try {
        event.preventDefault();
        event.stopPropagation();
        element.setPointerCapture?.(event.pointerId);
      } catch {}
      handler(createLongPressEvent(event));
    }, delayMs);
  };

  const onUp = (event) => {
    if (pointerId == null || event.pointerId !== pointerId) return;
    const shouldSuppressClick = fired || suppressNextActivation;
    clear();
    if (shouldSuppressClick) {
      suppressNextActivation = true;
      scheduleSuppressionReset();
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onClick = (event) => {
    consumeSuppressedActivation(event);
  };
  const onContextMenu = (event) => {
    if (!consumeSuppressedActivation(event)) clear();
  };

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', cancelIfMoved);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', clear);
  element.addEventListener('pointerleave', clear);
  element.addEventListener('lostpointercapture', clear);
  element.addEventListener('click', onClick, true);
  element.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('scroll', clear, true);

  return () => {
    clear();
    clearSuppression();
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointermove', cancelIfMoved);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', clear);
    element.removeEventListener('pointerleave', clear);
    element.removeEventListener('lostpointercapture', clear);
    element.removeEventListener('click', onClick, true);
    element.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('scroll', clear, true);
  };
}
window.addLongPressHandler = addLongPressHandler;

function _collectPathsNeedingFileIdMigration() {
  const allPaths = new Set();
  const prefixes = ['dbViewConfig:', 'validationRules:', 'entityTemplates:',
                    'gb-cal-mode-', 'gb-cal-date-', 'fv-panel-cfg:'];
  const allKeys = [];
  for (let i = 0; i < localStorage.length; i++) allKeys.push(localStorage.key(i));
  for (const key of allKeys) {
    if (!key) continue;
    for (const prefix of prefixes) {
      if (key.startsWith(prefix)) {
        const path = key.substring(prefix.length);
        if (path && path.length > 1 && !path.match(/^[0-9a-f]{16}$/)) allPaths.add(path);
      }
    }
  }
  const _collectPaths = (items) => {
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      if (item.path) allPaths.add(item.path);
      if (item.children) _collectPaths(item.children);
    });
  };
  _collectPaths(_readStorageArray('meldex-favorites'));
  _collectPaths(_readStorageArray(RECENT_KEY));
  try { JSON.parse(localStorage.getItem('outliner-expanded') || '[]').forEach(p => { if (p && !p.match(/^[0-9a-f]{16}$/)) allPaths.add(p); }); } catch {}
  for (const key of ['outliner-sort', 'outliner-manual-order', 'outliner-locked-items', 'outliner-node-colors']) {
    try { Object.keys(JSON.parse(localStorage.getItem(key) || '{}')).forEach(p => { if (p && !p.match(/^[0-9a-f]{16}$/)) allPaths.add(p); }); } catch {}
  }
  const wf = localStorage.getItem('outliner-work-folder');
  if (wf) allPaths.add(wf);
  const mcp = localStorage.getItem('main-calendar-path');
  if (mcp) allPaths.add(mcp);
  const lastView = _readStorageJson('lastView', null);
  ['path', 'dbPath', 'entityPath'].forEach(key => { if (lastView?.[key]) allPaths.add(lastView[key]); });
  return { allPaths, wf, mcp, prefixes };
}

// file_id マイグレーション: 旧パスキーを file_id キーに一括変換（初回のみ）
async function _migratePathsToFileIds() {
  const { allPaths, wf, mcp, prefixes } = _collectPathsNeedingFileIdMigration();

  if (localStorage.getItem('_file-id-migrated') && allPaths.size === 0) return;
  if (allPaths.size === 0) { localStorage.setItem('_file-id-migrated', '1'); return; }

  // 2. サーバーに一括解決
  let idMap;
  try {
    idMap = await apiPost('/file-ids', { paths: [...allPaths] });
  } catch (e) {
    console.warn('[Meldex] file_id migration failed:', e);
    return; // 失敗時は次回再試行
  }

  // 3. プレフィックス付きキーを変換
  for (const prefix of prefixes) {
    for (const [path, fileId] of Object.entries(idMap)) {
      if (!fileId) continue;
      const oldKey = prefix + path;
      const val = localStorage.getItem(oldKey);
      if (val) {
        localStorage.setItem(prefix + fileId, val);
        localStorage.removeItem(oldKey);
      }
    }
  }

  // 4. favorites に file_id 付与
  const _addFileIds = (items) => {
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      if (item.path && idMap[item.path] && !item.file_id) item.file_id = idMap[item.path];
      if (item.children) _addFileIds(item.children);
    });
  };
  try {
    const favs = JSON.parse(localStorage.getItem('meldex-favorites') || '[]');
    _addFileIds(favs);
    localStorage.setItem('meldex-favorites', JSON.stringify(favs));
  } catch {}

  // 5. recent に file_id 付与
  try {
    const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    _addFileIds(recent);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {}

  // 6. lastView に file_id 付与
  try {
    const lv = JSON.parse(localStorage.getItem('lastView') || 'null');
    const lastPath = lv?.path || lv?.dbPath || lv?.entityPath || '';
    if (lv && lastPath && idMap[lastPath]) { lv.file_id = idMap[lastPath]; localStorage.setItem('lastView', JSON.stringify(lv)); }
  } catch {}

  // 7. オブジェクトキーを変換（sort, manual-order, locked, colors）
  for (const key of ['outliner-sort', 'outliner-manual-order', 'outliner-locked-items', 'outliner-node-colors']) {
    try {
      const obj = JSON.parse(localStorage.getItem(key) || '{}');
      let changed = false;
      for (const [path, fileId] of Object.entries(idMap)) {
        if (!fileId || !(path in obj)) continue;
        obj[fileId] = obj[path];
        delete obj[path];
        changed = true;
      }
      if (changed) localStorage.setItem(key, JSON.stringify(obj));
    } catch {}
  }

  // 8. expanded 配列のパスを変換
  try {
    let expanded = JSON.parse(localStorage.getItem('outliner-expanded') || '[]');
    let changed = false;
    expanded = expanded.map(p => {
      if (idMap[p]) { changed = true; return idMap[p]; }
      return p;
    });
    if (changed) localStorage.setItem('outliner-expanded', JSON.stringify(expanded));
  } catch {}

  // 9. work-folder, main-calendar-path
  if (wf && idMap[wf]) localStorage.setItem('outliner-work-folder-id', idMap[wf]);
  if (mcp && idMap[mcp]) localStorage.setItem('main-calendar-id', idMap[mcp]);

  // キャッシュにも登録
  _registerFileIds(idMap);

  localStorage.setItem('_file-id-migrated', '1');
  _refreshOutlinerStorageViewsAfterMigration();
  console.log('[Meldex] file_id migration completed:', Object.values(idMap).filter(Boolean).length, 'paths resolved');
}

function _refreshOutlinerStorageViewsAfterMigration() {
  try { if (typeof renderFavorites === 'function') renderFavorites(); } catch (e) { console.warn('renderFavorites failed after file_id migration', e); }
  try { if (typeof updateRecentItems === 'function') updateRecentItems(); } catch (e) { console.warn('updateRecentItems failed after file_id migration', e); }
}

// エクスプローラー履歴（戻る/進む — Phase 1 でエクスプローラー経由のオープンに限定）
const _legacyNavHistory = [];
let _legacyNavIndex = -1;
let navNavigating = false; // 戻る/進む操作中フラグ

// 最近使用したファイル
const RECENT_MAX = 8;
const RECENT_KEY = 'meldex-recent';

function addRecent(label, path, type) {
  let recent = _readStorageArray(RECENT_KEY);
  recent = recent.filter(r => r.path !== path);
  const fid = _pathToFileId(path);
  recent.unshift({label, path, type, time: Date.now(), ...(fid ? { file_id: fid } : {})});
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  if (typeof updateRecentItems === 'function') updateRecentItems();
}

function _mapRenamedPath(path, oldPath, newPath) {
  const current = String(path || '');
  if (!current || !oldPath || !newPath) return current;
  if (current === oldPath) return newPath;
  const oldPrefix = oldPath + '/';
  if (current.startsWith(oldPrefix)) return newPath + current.substring(oldPath.length);
  return current;
}

const APP_PATH_REF_KEYS = [
  'path', 'dbPath', 'smartDbPath', 'scenarioPath', 'scriptnotePath', 'boardPath',
  'pagePath', 'entityPath', 'folderPath', 'mediaPath', 'csvPath', 'versionPath',
  'calendarFile',
];

function _normalizeAppPathForCompare(path) {
  return String(path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function _isSameOrChildPath(path, parentPath) {
  const current = _normalizeAppPathForCompare(path);
  const parent = _normalizeAppPathForCompare(parentPath);
  return !!current && !!parent && (current === parent || current.startsWith(parent + '/'));
}

function _matchesDeletedPaths(path, deletedPaths) {
  return deletedPaths.some(deletedPath => _isSameOrChildPath(path, deletedPath));
}

function _appPathRefs(entry) {
  if (!entry || typeof entry !== 'object') return [];
  return APP_PATH_REF_KEYS
    .map(key => entry[key])
    .filter(value => typeof value === 'string' && value.trim());
}

function _entryMatchesDeletedPaths(entry, deletedPaths) {
  return _appPathRefs(entry).some(path => _matchesDeletedPaths(path, deletedPaths));
}

const DELETED_PATH_FALLBACK_AVOID_TAB_TYPES = new Set(['outliner', 'preview', 'detail', 'chat', 'annotation', 'history', 'search', 'timer', 'version']);

function _deletedPathTabTarget(tab) {
  return _appPathRefs(tab)[0] || _appPathRefs(tab?.state)[0] || '';
}

function _isRemainingContentTabAfterDeletion(tab, deletedPaths) {
  if (!tab || DELETED_PATH_FALLBACK_AVOID_TAB_TYPES.has(tab.type)) return false;
  if (_entryMatchesDeletedPaths(tab, deletedPaths) || _entryMatchesDeletedPaths(tab.state, deletedPaths)) return false;
  const targetPath = _deletedPathTabTarget(tab);
  return !!targetPath;
}

function _findRemainingContentTabAfterDeletion(deletedPaths) {
  if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function' || !GBLayout.root) return null;
  const panes = GBLayout.getAllPanes(GBLayout.root).slice().sort((a, b) => {
    if (a.id === GBLayout.activePane) return -1;
    if (b.id === GBLayout.activePane) return 1;
    return 0;
  });
  for (const pane of panes) {
    const activeTab = pane.tabs?.[pane.activeTabIndex];
    if (_isRemainingContentTabAfterDeletion(activeTab, deletedPaths)) {
      return { paneId: pane.id, tabId: activeTab.id };
    }
  }
  for (const pane of panes) {
    for (const tab of pane.tabs || []) {
      if (_isRemainingContentTabAfterDeletion(tab, deletedPaths)) {
        return { paneId: pane.id, tabId: tab.id };
      }
    }
  }
  return null;
}

function _cancelDeletedPathAutosaves(deletedPaths) {
  const pageContent = document.getElementById('page-content');
  if (pageContent?.dataset?.path && _matchesDeletedPaths(pageContent.dataset.path, deletedPaths) && window._noteAutoSaveTimer) {
    clearTimeout(window._noteAutoSaveTimer);
    window._noteAutoSaveTimer = null;
  }
  const freeText = document.getElementById('entity-freetext');
  if (freeText?.dataset?.entityPath && _matchesDeletedPaths(freeText.dataset.entityPath, deletedPaths) && window._ftAutoSaveTimer) {
    clearTimeout(window._ftAutoSaveTimer);
    window._ftAutoSaveTimer = null;
  }
  if (typeof bd !== 'undefined' && bd?.path && _matchesDeletedPaths(bd.path, deletedPaths)) {
    if (window._bdTimer) {
      clearTimeout(window._bdTimer);
      window._bdTimer = null;
    }
    bd.dirty = false;
    bd.path = '';
  }
}

function _clearDeletedLegacyViewHosts(deletedPaths) {
  let cleared = false;
  document.querySelectorAll('[data-gb-legacy-path]').forEach(host => {
    if (!host?.dataset?.gbLegacyPath || !_matchesDeletedPaths(host.dataset.gbLegacyPath, deletedPaths)) return;
    host.dataset.gbLegacyPath = '';
    host.dataset.gbLegacyView = '';
    cleared = true;
  });
  return cleared;
}

function _updatePathRefs(entry, keys, oldPath, newPath) {
  if (!entry) return false;
  let changed = false;
  keys.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(entry, key)) return;
    const mapped = _mapRenamedPath(entry[key], oldPath, newPath);
    if (mapped !== entry[key]) {
      entry[key] = mapped;
      changed = true;
    }
  });
  return changed;
}

function _readFileIdMap(options) {
  if (options?.fresh === true) {
    _storedFileIdMapCache = _readLatestStoredFileIdMap();
    return _storedFileIdMapCache;
  }
  return _storedFileIdMap();
}

function _rewriteStoredFileIdMapForRename(oldPath, newPath, fileId) {
  const map = _readFileIdMap({ fresh: true });
  let changed = false;
  Object.keys(map).forEach(path => {
    if (!_isSameOrChildPath(path, oldPath)) return;
    const mapped = _mapRenamedPath(path, oldPath, newPath);
    const existingId = map[path];
    delete map[path];
    map[mapped] = (path === oldPath && fileId) ? fileId : existingId;
    changed = true;
  });
  if (fileId && map[newPath] !== fileId) {
    map[newPath] = fileId;
    changed = true;
  }
  if (changed) _writeStorageJson(FILE_ID_MAP_KEY, map);
}

function _purgeStoredFileIdMapForDeletedPaths(deletedPaths) {
  const map = _readFileIdMap({ fresh: true });
  let changed = false;
  Object.keys(map).forEach(path => {
    if (!_matchesDeletedPaths(path, deletedPaths)) return;
    delete map[path];
    changed = true;
  });
  if (changed) _writeStorageJson(FILE_ID_MAP_KEY, map);
}

function _rewriteStoredPathSettingForRename(pathKey, idKey, oldPath, newPath, fileId) {
  const current = localStorage.getItem(pathKey);
  if (!current || !_isSameOrChildPath(current, oldPath)) return;
  const mapped = _mapRenamedPath(current, oldPath, newPath);
  localStorage.setItem(pathKey, mapped);
  const mappedId = (current === oldPath && fileId) ? fileId : _pathToFileId(mapped);
  if (mappedId) localStorage.setItem(idKey, mappedId);
  else localStorage.removeItem(idKey);
}

function _purgeStoredPathSettingForDeletedPaths(pathKey, idKey, deletedPaths) {
  const current = localStorage.getItem(pathKey);
  if (!current || !_matchesDeletedPaths(current, deletedPaths)) return;
  localStorage.removeItem(pathKey);
  localStorage.removeItem(idKey);
}

const PUBLISH_CONFIG_STORAGE_PREFIX = 'gb:publish:';

function _rewritePublishStorageForRename(oldPath, newPath) {
  try {
    const updates = [];
    const removals = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PUBLISH_CONFIG_STORAGE_PREFIX)) continue;
      const storedPath = key.substring(PUBLISH_CONFIG_STORAGE_PREFIX.length);
      if (!_isSameOrChildPath(storedPath, oldPath)) continue;
      const mappedPath = _mapRenamedPath(storedPath, oldPath, newPath);
      if (!mappedPath || mappedPath === storedPath) continue;
      updates.push({ key: PUBLISH_CONFIG_STORAGE_PREFIX + mappedPath, value: localStorage.getItem(key) });
      removals.push(key);
    }
    updates.forEach(item => {
      if (item.value != null) localStorage.setItem(item.key, item.value);
    });
    removals.forEach(key => localStorage.removeItem(key));
  } catch {}
}

function _purgePublishStorageForDeletedPaths(deletedPaths) {
  try {
    const removals = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PUBLISH_CONFIG_STORAGE_PREFIX)) continue;
      const storedPath = key.substring(PUBLISH_CONFIG_STORAGE_PREFIX.length);
      if (_matchesDeletedPaths(storedPath, deletedPaths)) removals.push(key);
    }
    removals.forEach(key => localStorage.removeItem(key));
  } catch {}
}

function _refreshRenamedCurrentDatabase(previousDbPath, nextDbPath) {
  if (!previousDbPath || previousDbPath === nextDbPath || typeof selectDatabase !== 'function') return;
  const dbViews = new Set(['pivot', 'database', 'gallery', 'kanban', 'timeline', 'calendar', 'tasks', 'shifts', 'chart', 'graph', 'form']);
  if (!dbViews.has(state.view)) return;
  const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : undefined;
  Promise.resolve(selectDatabase(nextDbPath, ctx, {
    silent: true,
    skipRecent: true,
    skipNavPush: true,
    skipSaveLastView: true,
    skipAutoVersion: true,
  })).catch(() => {});
}

function _mapRenamedSmartDbId(id, oldPath, newPath) {
  const current = String(id || '');
  if (!current) return current;
  if (current.startsWith('file:')) {
    return 'file:' + _mapRenamedPath(current.slice('file:'.length), oldPath, newPath);
  }
  return _mapRenamedPath(current, oldPath, newPath);
}

function _smartDbIdPath(id) {
  const current = String(id || '');
  return current.startsWith('file:') ? current.slice('file:'.length) : current;
}

function _renameRuntimePathReferences(oldPath, newPath) {
  if (typeof _csvPath !== 'undefined' && _csvPath) {
    _csvPath = _mapRenamedPath(_csvPath, oldPath, newPath);
  }
  if (typeof _folderPath !== 'undefined' && _folderPath) {
    _folderPath = _mapRenamedPath(_folderPath, oldPath, newPath);
  }
  if (typeof bd !== 'undefined' && bd) {
    if (bd.path) bd.path = _mapRenamedPath(bd.path, oldPath, newPath);
    if (bd._loadedBoardPath) bd._loadedBoardPath = _mapRenamedPath(bd._loadedBoardPath, oldPath, newPath);
  }
  if (state.currentSmartDb) {
    if (state.currentSmartDb._filePath) {
      state.currentSmartDb._filePath = _mapRenamedPath(state.currentSmartDb._filePath, oldPath, newPath);
    }
    if (state.currentSmartDb.id) {
      state.currentSmartDb.id = _mapRenamedSmartDbId(state.currentSmartDb.id, oldPath, newPath);
    }
  }
}

function renameAppPathReferences(oldPath, newPath, opts) {
  if (!oldPath || !newPath || oldPath === newPath) return;
  const options = opts || {};
  const exactLabel = Object.prototype.hasOwnProperty.call(options, 'label') ? options.label : null;
  const preResolvedId = options.fileId || _pathToFileId(newPath) || _pathToFileId(oldPath) || '';
  const previousDbPath = state.currentDbPath || '';
  if (_fileIdCache[oldPath]) {
    const oldFid = _fileIdCache[oldPath];
    delete _fileIdCache[oldPath];
    _fileIdCache[newPath] = oldFid;
    _pathCache[oldFid] = newPath;
  }
  if (options.fileId) {
    _fileIdCache[newPath] = options.fileId;
    _pathCache[options.fileId] = newPath;
  }
  const oldPrefix = oldPath + '/';
  const newPrefix = newPath + '/';
  Object.keys(_fileIdCache).forEach(cachedPath => {
    if (cachedPath === oldPath || !cachedPath.startsWith(oldPrefix)) return;
    const remapped = newPrefix + cachedPath.substring(oldPrefix.length);
    const fid = _fileIdCache[cachedPath];
    delete _fileIdCache[cachedPath];
    _fileIdCache[remapped] = fid;
    if (fid) _pathCache[fid] = remapped;
  });
  const fileId = preResolvedId || _pathToFileId(newPath) || '';
  _rewriteStoredFileIdMapForRename(oldPath, newPath, fileId);
  _rewriteStoredPathSettingForRename('outliner-work-folder', 'outliner-work-folder-id', oldPath, newPath, fileId);
  _rewriteStoredPathSettingForRename('main-calendar-path', 'main-calendar-id', oldPath, newPath, fileId);
  _rewritePublishStorageForRename(oldPath, newPath);
  let recentChanged = false;
  let layoutChanged = false;
  let legacyTabsChanged = false;

  try {
    const recent = _readStorageArray(RECENT_KEY);
    recent.forEach(entry => {
      if (_updatePathRefs(entry, APP_PATH_REF_KEYS, oldPath, newPath)) recentChanged = true;
      if (entry.path === newPath && exactLabel != null) {
        entry.label = exactLabel;
        recentChanged = true;
      }
      if (entry.path === newPath && fileId) {
        entry.file_id = fileId;
        recentChanged = true;
      }
    });
    if (recentChanged) {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
      if (typeof updateRecentItems === 'function') updateRecentItems();
    }
  } catch {}

  try {
    const lastView = JSON.parse(localStorage.getItem('lastView') || 'null');
    if (lastView && _updatePathRefs(lastView, APP_PATH_REF_KEYS, oldPath, newPath)) {
      if (lastView.path === newPath && exactLabel != null) lastView.label = exactLabel;
      if (lastView.path === newPath && fileId) lastView.file_id = fileId;
      localStorage.setItem('lastView', JSON.stringify(lastView));
    }
  } catch {}

  _tabs.forEach(tab => {
    const wasExact = tab.path === oldPath;
    const mapped = _mapRenamedPath(tab.path, oldPath, newPath);
    if (mapped !== tab.path) {
      tab.path = mapped;
      legacyTabsChanged = true;
    }
    if (wasExact && exactLabel != null && tab.label !== exactLabel) {
      tab.label = exactLabel;
      legacyTabsChanged = true;
    }
  });

  _legacyNavHistory.forEach(entry => {
    if (_updatePathRefs(entry, APP_PATH_REF_KEYS, oldPath, newPath)) layoutChanged = true;
    if (entry.path === newPath && exactLabel != null) entry.label = exactLabel;
  });

  if (typeof GBLayout !== 'undefined' && typeof GBLayout.getAllPanes === 'function' && GBLayout.root) {
    GBLayout.getAllPanes(GBLayout.root).forEach(pane => {
      (pane.tabs || []).forEach(tab => {
        const wasExact = tab.path === oldPath;
        const mapped = _mapRenamedPath(tab.path, oldPath, newPath);
        if (mapped !== tab.path) {
          tab.path = mapped;
          layoutChanged = true;
        }
        if (wasExact && exactLabel != null && tab.label !== exactLabel) {
          tab.label = exactLabel;
          layoutChanged = true;
        }
        if (tab.state && typeof tab.state === 'object') {
          if (_updatePathRefs(tab.state, APP_PATH_REF_KEYS, oldPath, newPath)) {
            layoutChanged = true;
          }
        }
      });
      if (Array.isArray(pane.navHistory)) {
        pane.navHistory.forEach(entry => {
          if (_updatePathRefs(entry, APP_PATH_REF_KEYS, oldPath, newPath)) layoutChanged = true;
          if (entry.path === newPath && exactLabel != null) entry.label = exactLabel;
        });
      }
    });
  }

  if (typeof forEachComponent === 'function') {
    forEachComponent(component => {
      if (!component?.state || typeof component.state !== 'object') return;
      _updatePathRefs(component.state, APP_PATH_REF_KEYS, oldPath, newPath);
    });
  }

  ['currentDbPath', 'currentEntityPath', 'currentPagePath', 'currentBoardPath'].forEach(key => {
    state[key] = _mapRenamedPath(state[key], oldPath, newPath);
  });
  _renameRuntimePathReferences(oldPath, newPath);

  const pageContent = document.getElementById('page-content');
  if (pageContent?.dataset?.path) {
    pageContent.dataset.path = _mapRenamedPath(pageContent.dataset.path, oldPath, newPath);
  }

  if (typeof _sn2Editors !== 'undefined' && _sn2Editors) {
    Object.keys(_sn2Editors).forEach(path => {
      const mapped = _mapRenamedPath(path, oldPath, newPath);
      if (mapped === path) return;
      const editor = _sn2Editors[path];
      delete _sn2Editors[path];
      if (editor) editor._path = mapped;
      _sn2Editors[mapped] = editor;
    });
  }

  if (legacyTabsChanged) renderTabs();
  if (layoutChanged && typeof GBLayout !== 'undefined') {
    if (typeof GBLayout.render === 'function') GBLayout.render();
    if (typeof GBLayout.saveLayout === 'function') GBLayout.saveLayout();
  }
  _refreshRenamedCurrentDatabase(previousDbPath, state.currentDbPath);
}

function purgeAppPathReferences(paths) {
  const deletedPaths = (Array.isArray(paths) ? paths : [paths])
    .map(path => String(path || '').trim())
    .filter(Boolean);
  if (!deletedPaths.length) return;
  let recentChanged = false;
  let layoutChanged = false;
  let legacyTabsChanged = false;
  let clearedCurrentView = false;
  _cancelDeletedPathAutosaves(deletedPaths);
  const activePathKey = {
    pivot: 'currentDbPath',
    gallery: 'currentDbPath',
    kanban: 'currentDbPath',
    timeline: 'currentDbPath',
    calendar: 'currentDbPath',
    tasks: 'currentDbPath',
    shifts: 'currentDbPath',
    chart: 'currentDbPath',
    graph: 'currentDbPath',
    entity: 'currentEntityPath',
    page: 'currentPagePath',
    media: 'currentPagePath',
    board: 'currentBoardPath',
  }[state.view] || null;

  Object.keys(_fileIdCache).forEach(cachedPath => {
    if (!_matchesDeletedPaths(cachedPath, deletedPaths)) return;
    const fid = _fileIdCache[cachedPath];
    delete _fileIdCache[cachedPath];
    if (fid && _pathCache[fid] === cachedPath) delete _pathCache[fid];
  });
  _purgeStoredFileIdMapForDeletedPaths(deletedPaths);
  _purgeStoredPathSettingForDeletedPaths('outliner-work-folder', 'outliner-work-folder-id', deletedPaths);
  _purgeStoredPathSettingForDeletedPaths('main-calendar-path', 'main-calendar-id', deletedPaths);
  _purgePublishStorageForDeletedPaths(deletedPaths);

  try {
    const recent = _readStorageArray(RECENT_KEY);
    const nextRecent = recent.filter(entry => {
      return !_entryMatchesDeletedPaths(entry, deletedPaths);
    });
    if (nextRecent.length !== recent.length) {
      localStorage.setItem(RECENT_KEY, JSON.stringify(nextRecent));
      recentChanged = true;
    }
  } catch {}

  try {
    const lastView = JSON.parse(localStorage.getItem('lastView') || 'null');
    if (lastView) {
      if (_entryMatchesDeletedPaths(lastView, deletedPaths)) {
        localStorage.removeItem('lastView');
      }
    }
  } catch {}

  for (let i = _tabs.length - 1; i >= 0; i -= 1) {
    const tab = _tabs[i];
    if (!_entryMatchesDeletedPaths(tab, deletedPaths)) continue;
    if (_activeTabId === tab.id) _activeTabId = null;
    _tabs.splice(i, 1);
    legacyTabsChanged = true;
  }
  if (!_activeTabId && _tabs.length > 0) {
    _activeTabId = _tabs[0].id;
    legacyTabsChanged = true;
  }

  for (let i = _legacyNavHistory.length - 1; i >= 0; i -= 1) {
    const entry = _legacyNavHistory[i];
    if (_entryMatchesDeletedPaths(entry, deletedPaths)) {
      _legacyNavHistory.splice(i, 1);
      if (_legacyNavIndex >= i) _legacyNavIndex = Math.max(-1, _legacyNavIndex - 1);
    }
  }

  const tabsToClose = [];
  if (typeof GBLayout !== 'undefined' && typeof GBLayout.getAllPanes === 'function' && GBLayout.root) {
    GBLayout.getAllPanes(GBLayout.root).forEach(pane => {
      (pane.tabs || []).forEach(tab => {
        if (_entryMatchesDeletedPaths(tab, deletedPaths) || _entryMatchesDeletedPaths(tab.state, deletedPaths)) {
          tabsToClose.push({ paneId: pane.id, tabId: tab.id });
        }
      });
      if (Array.isArray(pane.navHistory)) {
        const prevLen = pane.navHistory.length;
        pane.navHistory = pane.navHistory.filter(entry => !_entryMatchesDeletedPaths(entry, deletedPaths));
        if (pane.navHistory.length !== prevLen) {
          pane.navIndex = pane.navHistory.length ? Math.min(pane.navIndex, pane.navHistory.length - 1) : -1;
          layoutChanged = true;
        }
      }
    });
  }
  tabsToClose.forEach(({ paneId, tabId }) => {
    if (typeof GBTabs !== 'undefined' && typeof GBTabs.closeTab === 'function') {
      GBTabs.closeTab(paneId, tabId);
    }
  });

  ['currentDbPath', 'currentEntityPath', 'currentPagePath', 'currentBoardPath'].forEach(key => {
    if (_matchesDeletedPaths(state[key], deletedPaths)) {
      state[key] = null;
      if (key === activePathKey) clearedCurrentView = true;
    }
  });
  const smartDbRuntimePath = state.currentSmartDb?._filePath || _smartDbIdPath(state.currentSmartDb?.id);
  if (smartDbRuntimePath && _matchesDeletedPaths(smartDbRuntimePath, deletedPaths)) {
    state.currentSmartDb = null;
    state.smartDbData = null;
    if (state.view === 'smart-db') clearedCurrentView = true;
  }
  if (!state.currentDbPath) {
    state.pivotData = null;
    state.dbMetadata = null;
  }
  if (_clearDeletedLegacyViewHosts(deletedPaths)) {
    clearedCurrentView = true;
  }

  const pageContent = document.getElementById('page-content');
  if (pageContent?.dataset?.path && _matchesDeletedPaths(pageContent.dataset.path, deletedPaths)) {
    pageContent.dataset.path = '';
    pageContent.contentEditable = 'false';
    pageContent.dataset.loadFailed = '1';
    clearedCurrentView = true;
  }
  const freeText = document.getElementById('entity-freetext');
  if (freeText?.dataset?.entityPath && _matchesDeletedPaths(freeText.dataset.entityPath, deletedPaths)) {
    freeText.dataset.entityPath = '';
    freeText.contentEditable = 'false';
    clearedCurrentView = true;
  }

  if (typeof _csvPath !== 'undefined' && _matchesDeletedPaths(_csvPath, deletedPaths)) {
    if (typeof _csvAutoSaveTimer !== 'undefined' && _csvAutoSaveTimer) {
      clearTimeout(_csvAutoSaveTimer);
      _csvAutoSaveTimer = null;
    }
    if (typeof _csvDirty !== 'undefined') _csvDirty = false;
    _csvPath = '';
    clearedCurrentView = true;
  }

  if (typeof _folderPath !== 'undefined' && _matchesDeletedPaths(_folderPath, deletedPaths)) {
    _folderPath = '';
    if (typeof _folderItems !== 'undefined') _folderItems = [];
    if (typeof _folderSelected !== 'undefined') _folderSelected = null;
    if (typeof _folderSelectedItems !== 'undefined') _folderSelectedItems = [];
    if (state.view === 'folder') clearedCurrentView = true;
  }

  const htmlIframe = document.getElementById('html-iframe');
  if (htmlIframe) {
    const src = htmlIframe.getAttribute('src') || '';
    const decodedSrc = (() => {
      try { return decodeURIComponent(src); } catch { return src; }
    })();
    if (deletedPaths.some(path => decodedSrc.includes(path))) {
      htmlIframe.removeAttribute('src');
      if (state.view === 'html' || state.view === 'media') clearedCurrentView = true;
    }
  }

  const mediaContent = document.getElementById('media-content');
  if (state.view === 'media' && _matchesDeletedPaths(state.currentPagePath, deletedPaths)) {
    if (mediaContent) mediaContent.replaceChildren();
    clearedCurrentView = true;
  }

  if (typeof _sn2Editors !== 'undefined' && _sn2Editors) {
    Object.keys(_sn2Editors).forEach(path => {
      if (!_matchesDeletedPaths(path, deletedPaths)) return;
      const editor = _sn2Editors[path];
      if (editor?._saveTimer) {
        clearTimeout(editor._saveTimer);
        editor._saveTimer = null;
      }
      if (editor) {
        editor._dirty = false;
        editor._path = '';
      }
      delete _sn2Editors[path];
    });
  }

  if (legacyTabsChanged) renderTabs();
  if (recentChanged && typeof updateRecentItems === 'function') updateRecentItems();
  if (layoutChanged && typeof GBLayout !== 'undefined' && typeof GBLayout.saveLayout === 'function') {
    GBLayout.saveLayout();
  }

  if (clearedCurrentView) {
    const fallbackLayoutTab = _findRemainingContentTabAfterDeletion(deletedPaths);
    if (fallbackLayoutTab && typeof GBTabs !== 'undefined' && typeof GBTabs.activateTab === 'function') {
      GBTabs.activateTab(fallbackLayoutTab.paneId, fallbackLayoutTab.tabId);
      return;
    }
    const fallbackTab = _tabs.find(tab => tab.id === _activeTabId) || _tabs[0];
    if (fallbackTab) activateTab(fallbackTab.id);
    else showView('welcome');
  }
}

function _resolveNavHistoryPaneId(paneId) {
  if (typeof GBLayout === 'undefined' || !GBLayout.root) return null;
  return paneId || GBLayout.activePane || GBLayout.findFirstPane?.(GBLayout.root)?.id || null;
}

function _getNavState(paneId) {
  const resolvedPaneId = _resolveNavHistoryPaneId(paneId);
  if (!resolvedPaneId || typeof GBLayout === 'undefined' || !GBLayout.root) {
    return {
      kind: 'legacy',
      paneId: null,
      history: _legacyNavHistory,
      get index() { return _legacyNavIndex; },
      set index(v) { _legacyNavIndex = v; },
    };
  }
  const pane = GBLayout.findNode?.(GBLayout.root, resolvedPaneId)?.node || null;
  if (!pane) {
    return {
      kind: 'legacy',
      paneId: null,
      history: _legacyNavHistory,
      get index() { return _legacyNavIndex; },
      set index(v) { _legacyNavIndex = v; },
