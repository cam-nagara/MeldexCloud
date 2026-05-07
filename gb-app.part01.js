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

function _sendLog(level, data) {
  try {
    _pushRecentLog(level, data);
    const payload = JSON.stringify({
      level,
      time: new Date().toISOString(),
      view: state?.view || '',
      path: state?.currentPagePath || state?.currentDbPath || '',
      ...data
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

function _registerFileId(path, fileId) {
  if (path && fileId) {
    _fileIdCache[path] = fileId;
    _pathCache[fileId] = path;
  }
}

function _pathToFileId(path) {
  return _fileIdCache[path] || '';
}

function _fileIdToPath(fileId) {
  return _pathCache[fileId] || '';
}

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
  _collectPaths(JSON.parse(localStorage.getItem('meldex-favorites') || '[]'));
  _collectPaths(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'));
  try { JSON.parse(localStorage.getItem('outliner-expanded') || '[]').forEach(p => { if (p && !p.match(/^[0-9a-f]{16}$/)) allPaths.add(p); }); } catch {}
  for (const key of ['outliner-sort', 'outliner-manual-order', 'outliner-locked-items', 'outliner-node-colors']) {
    try { Object.keys(JSON.parse(localStorage.getItem(key) || '{}')).forEach(p => { if (p && !p.match(/^[0-9a-f]{16}$/)) allPaths.add(p); }); } catch {}
  }
  const wf = localStorage.getItem('outliner-work-folder');
  if (wf) allPaths.add(wf);
  const mcp = localStorage.getItem('main-calendar-path');
  if (mcp) allPaths.add(mcp);
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
    if (lv && lv.path && idMap[lv.path]) { lv.file_id = idMap[lv.path]; localStorage.setItem('lastView', JSON.stringify(lv)); }
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
  for (const [path, fileId] of Object.entries(idMap)) {
    if (fileId) _registerFileId(path, fileId);
  }

  localStorage.setItem('_file-id-migrated', '1');
  console.log('[Meldex] file_id migration completed:', Object.values(idMap).filter(Boolean).length, 'paths resolved');
}

// エクスプローラー履歴（戻る/進む — Phase 1 でエクスプローラー経由のオープンに限定）
const _legacyNavHistory = [];
let _legacyNavIndex = -1;
let navNavigating = false; // 戻る/進む操作中フラグ

// 最近使用したファイル
const RECENT_MAX = 8;
const RECENT_KEY = 'meldex-recent';

function addRecent(label, path, type) {
  let recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
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

function renameAppPathReferences(oldPath, newPath, opts) {
  if (!oldPath || !newPath || oldPath === newPath) return;
  const options = opts || {};
  const exactLabel = Object.prototype.hasOwnProperty.call(options, 'label') ? options.label : null;
  const preResolvedId = options.fileId || _pathToFileId(newPath) || _pathToFileId(oldPath) || '';
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
  let recentChanged = false;
  let layoutChanged = false;
  let legacyTabsChanged = false;

  try {
    const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
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
  if (state.currentSmartDb?._filePath) {
    state.currentSmartDb._filePath = _mapRenamedPath(state.currentSmartDb._filePath, oldPath, newPath);
  }

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
    board: 'currentBoardPath',
  }[state.view] || null;

  Object.keys(_fileIdCache).forEach(cachedPath => {
    if (!_matchesDeletedPaths(cachedPath, deletedPaths)) return;
    const fid = _fileIdCache[cachedPath];
    delete _fileIdCache[cachedPath];
    if (fid && _pathCache[fid] === cachedPath) delete _pathCache[fid];
  });

  try {
    const recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
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
  if (state.currentSmartDb?._filePath && _matchesDeletedPaths(state.currentSmartDb._filePath, deletedPaths)) {
    state.currentSmartDb = null;
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
    };
  }
  if (!Array.isArray(pane.navHistory)) pane.navHistory = [];
  if (!Number.isInteger(pane.navIndex)) pane.navIndex = pane.navHistory.length ? pane.navHistory.length - 1 : -1;
  if (pane.navIndex >= pane.navHistory.length) pane.navIndex = pane.navHistory.length - 1;
  return {
    kind: 'pane',
    paneId: resolvedPaneId,
    history: pane.navHistory,
    get index() { return pane.navIndex; },
    set index(v) { pane.navIndex = v; },
  };
}

function _refreshPaneNavUi(paneId) {
  if (typeof GBLayout !== 'undefined' && typeof GBLayout.updatePaneNavButtons === 'function') {
    if (paneId) GBLayout.updatePaneNavButtons(paneId);
    else {
      const allPanes = typeof GBLayout.getAllPanes === 'function' ? GBLayout.getAllPanes(GBLayout.root) : [];
      allPanes.forEach(pane => GBLayout.updatePaneNavButtons(pane.id));
    }
  }
}

function _persistPaneNavState(navState) {
  if (navState?.kind === 'pane' && typeof GBLayout !== 'undefined' && typeof GBLayout.saveLayout === 'function') {
    GBLayout.saveLayout();
  }
}

// ナビゲーション履歴記録 + パネルタブ自動更新の起点
// gb-app.js の wrap1 と gb-pane-bridge.js の wrap2 でラップされる
function navPush(entry, paneId) {
  if (navNavigating) return;
  if (!entry || !entry.type) return;
  const navState = _getNavState(paneId);
  const top = navState.history[navState.index];
  if (top && top.type === entry.type && top.path === entry.path) return;
  navState.history.splice(navState.index + 1);
  navState.history.push(entry);
  if (navState.history.length > 50) {
    navState.history.shift();
  }
  navState.index = navState.history.length - 1;
  _refreshPaneNavUi(navState.paneId);
  _persistPaneNavState(navState);
}

function _forcedNavPush(entry, paneId) {
  if (!entry || !entry.type) return;
  const navState = _getNavState(paneId);
  navState.history.splice(navState.index + 1);
  navState.history.push(entry);
  if (navState.history.length > 50) navState.history.shift();
  navState.index = navState.history.length - 1;
  _refreshPaneNavUi(navState.paneId);
  _persistPaneNavState(navState);
}

function _getDbViewScrollContainer(ctx, viewMode) {
  const mode = ['calendar', 'tasks', 'shifts'].includes(viewMode) ? 'timeline' : (viewMode || 'pivot');
  const selectors = {
    pivot: '.pivot-view',
    gallery: '.gallery-view',
    kanban: '.kanban-view',
    timeline: '.timeline-view',
    chart: '.chart-view',
    graph: '.graph-view',
    form: '.form-view',
  };
  const selector = selectors[mode] || '.pivot-view';
  return (typeof _paneEl === 'function' ? _paneEl(ctx, selector) : null) || document.querySelector(selector);
}

function _navPushWithViewState(ctx, entityName) {
  ctx = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = ctx?.dbPath || state.currentDbPath;
  if (!dbPath) return;
  const cfg = getDbViewConfig(dbPath);
  const viewMode = getCurrentViewMode(dbPath);
  const container = _getDbViewScrollContainer(ctx, viewMode);
  _forcedNavPush({
    type: 'pivot',
    path: dbPath,
    label: dbPath.split('/').pop() || dbPath,
    viewIdx: cfg.currentViewIdx,
    scrollState: {
      scrollLeft: container?.scrollLeft || 0,
      scrollTop: container?.scrollTop || 0,
      focusedEntity: entityName || null,
    },
  }, ctx?.paneId);
}

function navOpen(entry, opts) {
  if (!entry) return;
  const o = opts || undefined;
  if (entry.type === 'page') return openPage(entry.label, entry.path, o);
  if (entry.type === 'csv') return (typeof openCsvFile === 'function') ? openCsvFile(entry.label, entry.path, o) : openPage(entry.label, entry.path, o);
  if (entry.type === 'board') return openBoard(entry.label, entry.path, o);
  if (entry.type === 'entity') return selectEntity(entry.path, o);
  if (entry.type === 'pivot' || entry.type === 'database' || ['gallery', 'kanban', 'timeline', 'chart', 'graph'].includes(entry.type)) {
    if (entry.calendarFile && entry.type === 'timeline' && typeof openCalendarFile === 'function') return openCalendarFile(entry.label, entry.path, o);
    return selectDatabase(entry.path, null, {
      ...(o || {}),
      restoreViewIdx: entry.viewIdx,
      restoreScrollState: entry.scrollState,
    });
  }
  if (entry.type === 'scriptnote' && typeof openScenarioInScriptNote === 'function') return openScenarioInScriptNote(entry.path, entry.label, o);
  if (entry.type === 'media' || entry.type === 'image' || entry.type === 'video' || entry.type === 'audio') return openMedia(entry.label, entry.path, entry.mediaType || (entry.type === 'media' ? 'image' : entry.type), o);
  if (entry.type === 'html') {
    if (entry.urlExternal && typeof openViewer === 'function') return openViewer(entry.path);
    return openHtmlFile(entry.label, entry.path, o);
  }
  if (entry.type === 'folder') return openFolder(entry.label, entry.path, o);
  if (entry.type === 'calendar') return openCalendarFile(entry.label, entry.path, o);
  if (entry.type === 'smart-db' && typeof openSmartDbFile === 'function') return openSmartDbFile(entry.label, entry.path, o);
}
function _withNavFlag(result) {
  if (result && typeof result.then === 'function') {
    return result.finally(() => { navNavigating = false; });
  }
  navNavigating = false;
  return result;
}

// Phase 1: ブラウザ履歴 API（pushState/popstate/back/forward）の利用を廃止
// 戻る/進むは Alt+←/→ ショートカット、マウス戻る/進むボタン、
// 各パネルのタブバー上の履歴ボタンから呼ぶ
let state = {
  vaultPath: null,
  currentDbPath: null,   // 現在選択中のDBフォルダパス
  currentEntityPath: null, // 現在選択中のエントリパス
  currentPagePath: null, // 現在選択中のページパス
  currentBoardPath: null, // 現在選択中のボードパス
  currentSmartDb: null, // 現在選択中のスマートDB定義
  smartDbData: null, // スマートDBのAPIレスポンス
  pivotData: null,
  filter: 'disabled', // 'disabled' | 'all' | 'adopted' | 'nobotsu'
  view: 'pivot', // 'pivot' | 'entity' | 'page'
};

/* ==============================
   タブシステム
   ============================== */
const _tabs = []; // {id, label, type, path, icon}
let _activeTabId = null;
let _tabIdCounter = 0;

function _tabIcon(type) {
  if (typeof uiTypeIconName === 'function') {
    const shared = uiTypeIconName(type);
    if (shared) return shared;
  }
  const icons = {pivot:'db',gallery:'db',kanban:'db',timeline:'db',media:'galleryThumbnails',html:'globe'};
  return icons[type] || 'page';
}

function addTab(label, type, path) {
  // 同じパス+タイプのタブがあればそちらをアクティブに
  const existing = _tabs.find(t => t.path === path && t.type === type);
  if (existing) { activateTab(existing.id); return existing.id; }
  const id = 'tab-' + (++_tabIdCounter);
  _tabs.push({ id, label: label || '(無題)', type, path, icon: _tabIcon(type) });
  renderTabs();
  activateTab(id);
  return id;
}

function activateTab(tabId) {
  const tab = _tabs.find(t => t.id === tabId);
  if (!tab) return;
  _activeTabId = tabId;
  renderTabs();
  // タブの内容を表示
  navNavigating = true;
  _withNavFlag(navOpen({ type: tab.type, label: tab.label, path: tab.path }));
}

function closeTab(tabId) {
  const idx = _tabs.findIndex(t => t.id === tabId);
  if (idx < 0) return;
  _tabs.splice(idx, 1);
  if (_activeTabId === tabId) {
    // 隣のタブをアクティブに
    if (_tabs.length > 0) {
      const newIdx = Math.min(idx, _tabs.length - 1);
      activateTab(_tabs[newIdx].id);
    } else {
      _activeTabId = null;
      showView('welcome');
    }
  }
  renderTabs();
}

function renderTabs() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  _tabs.forEach((tab, i) => {
    const el = document.createElement('div');
    el.className = 'tab-item' + (tab.id === _activeTabId ? ' active' : '');
    el.dataset.tabIdx = i;
    el.addEventListener('click', (e) => { if (!e.target.closest('.tab-close')) activateTab(tab.id); });
    el.onpointerdown = (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } };
    const iconSvg = typeof lucide === 'function' ? lucide(tab.icon, 14) : '';
    el.innerHTML = `${iconSvg}<span class="tab-label">${esc(tab.label)}</span><span class="tab-close" data-action="closeTab('${tab.id}')">${lucide('x', 12)}</span>`;

    // D&D: タブ順序入替+ウィンドウ分離
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-tab-idx', String(i));
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); _clearTabDragIndicators(); });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      _clearTabDragIndicators();
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) el.classList.add('drag-over-left');
      else el.classList.add('drag-over-right');
    });
    el.addEventListener('dragleave', () => { el.classList.remove('drag-over-left', 'drag-over-right'); });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      _clearTabDragIndicators();
      const fromIdx = parseInt(e.dataTransfer.getData('application/x-tab-idx'));
      if (isNaN(fromIdx) || fromIdx === i) return;
      const rect = el.getBoundingClientRect();
      const insertBefore = e.clientX < rect.left + rect.width / 2;
      const moved = _tabs.splice(fromIdx, 1)[0];
      let toIdx = insertBefore ? i : i + 1;
      if (fromIdx < i) toIdx--;
      _tabs.splice(toIdx, 0, moved);
      renderTabs();
    });

    bar.appendChild(el);
  });
}

function _clearTabDragIndicators() {
  document.querySelectorAll('.tab-item.drag-over-left,.tab-item.drag-over-right').forEach(el => {
    el.classList.remove('drag-over-left', 'drag-over-right');
  });
}

// Meldex内部タブとして開く
function _openInNewTab(label, path, type) {
  const id = 'tab-' + (++_tabIdCounter);
  _tabs.push({ id, label: label || '(無題)', type: type || 'page', path: path || '', icon: _tabIcon(type || 'page') });
  _activeTabId = id;
  renderTabs();
  // コンテンツを開く
  _addingTab = true;
  navOpen({ type: type || 'page', label, path });
  _addingTab = false;
}

// タブバーへのフォルダツリーD&Dドロップ
(function() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.addEventListener('dragover', (e) => {
    // Meldexノードまたはタブ移動のみ受け入れ
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    // ドロップ位置のインジケーター表示
    _clearTabDragIndicators();
    const tabEls = [...bar.querySelectorAll('.tab-item')];
    for (const tabEl of tabEls) {
      const rect = tabEl.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) {
        tabEl.classList.add('drag-over-left');
        return;
      } else if (e.clientX < rect.right) {
        tabEl.classList.add('drag-over-right');
        return;
      }
    }
    // 全タブの右側
    if (tabEls.length > 0) tabEls[tabEls.length - 1].classList.add('drag-over-right');
  });
  bar.addEventListener('dragleave', (e) => {
    if (!bar.contains(e.relatedTarget)) _clearTabDragIndicators();
  });
  bar.addEventListener('drop', (e) => {
    e.preventDefault();
    _clearTabDragIndicators();
    // タブ移動の場合はスキップ（renderTabs内のdropで処理済み）
    if (e.dataTransfer.getData('application/x-tab-idx')) return;
    // Meldexノードのドロップ
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    try {
      const { name, path, type } = JSON.parse(cfData);
      const openType = type === 'database' ? 'pivot' : (type || 'page');
      // 挿入位置を決定
      const tabEls = [...bar.querySelectorAll('.tab-item')];
      let insertIdx = _tabs.length;
      for (let i = 0; i < tabEls.length; i++) {
        const rect = tabEls[i].getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) { insertIdx = i; break; }
      }
      const id = 'tab-' + (++_tabIdCounter);
      const newTab = { id, label: name || '(無題)', type: openType, path: path || '', icon: _tabIcon(openType) };
      _tabs.splice(insertIdx, 0, newTab);
      _activeTabId = id;
      renderTabs();
      _addingTab = true;
      navOpen({ type: openType, label: name, path });
      _addingTab = false;
    } catch {}
  });
})();

// タブ右クリックメニュー（＋長押しでも同メニュー）
function _handleTabBarContextmenu(e) {
  const tabEl = e.target.closest('.tab-item');
  if (!tabEl) return;
  e.preventDefault();
  const idx = parseInt(tabEl.dataset.tabIdx);
  const tab = _tabs[idx];
  if (!tab) return;

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  { const z = _getZoom(); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
  function addMI(label, fn) {
    const mi = document.createElement('div');
    mi.textContent = label;
    mi.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
    mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; };
    mi.onmouseleave = () => { mi.style.background = ''; };
    mi.addEventListener('click', () => { menu.remove(); fn(); });
    menu.appendChild(mi);
  }
  addMI('新しいウィンドウで開く', () => {
    const openType = tab.type === 'database' ? 'pivot' : (tab.type || 'page');
    const url = '/?open=' + encodeURIComponent(openType) + '&path=' + encodeURIComponent(tab.path || '') + '&label=' + encodeURIComponent(tab.label || '');
    _open_app_window_js(url);
    closeTab(tab.id);
  });
