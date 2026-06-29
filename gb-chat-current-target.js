/* Chat target resolution: unqualified chat follows the currently open item. */
const _CHAT_TARGET_DB_VIEW_TYPES = new Set(['database', 'db', 'pivot', 'gallery', 'kanban', 'timeline', 'tasks', 'shifts', 'chart', 'graph', 'form']);

function _chatStatePath(key) {
  return (typeof state !== 'undefined' && state) ? String(state[key] || '') : '';
}

function _chatCurrentSmartDbPath() {
  try {
    const current = (typeof state !== 'undefined' && state) ? state.currentSmartDb : null;
    return String(current?._filePath || current?.path || current?.id || '');
  } catch {
    return '';
  }
}

function _chatTabPath(tab, ...keys) {
  if (tab?.path) return String(tab.path || '');
  const tabState = tab?.state || {};
  for (const key of keys) {
    if (tabState[key]) return String(tabState[key] || '');
  }
  return '';
}

function _chatCurrentTargetFromTab(tab) {
  const rawType = String(tab?.type || '');
  const type = rawType === 'database' ? 'pivot' : rawType;
  if (type === 'folder') return { path: _chatTabPath(tab, 'folderPath') || (typeof _folderPath !== 'undefined' ? _folderPath : ''), kind: 'folder' };
  if (type === 'entity') return { path: _chatTabPath(tab, 'entityPath') || _chatStatePath('currentEntityPath'), kind: 'file' };
  if (type === 'page') return { path: _chatTabPath(tab, 'pagePath') || _chatStatePath('currentPagePath'), kind: 'file' };
  if (type === 'board') return { path: _chatTabPath(tab, 'boardPath') || _chatStatePath('currentBoardPath'), kind: 'file' };
  if (type === 'scriptnote') return { path: _chatTabPath(tab, 'scenarioPath', 'scriptnotePath'), kind: 'file' };
  if (type === 'smart-db') return { path: _chatTabPath(tab, 'smartDbPath', 'dbPath') || _chatCurrentSmartDbPath() || _chatStatePath('currentDbPath'), kind: 'file' };
  if (_CHAT_TARGET_DB_VIEW_TYPES.has(type) || _CHAT_TARGET_DB_VIEW_TYPES.has(rawType)) {
    return { path: _chatTabPath(tab, 'dbPath') || _chatStatePath('currentDbPath'), kind: 'folder' };
  }
  if (type === 'media' || type === 'html') return { path: _chatTabPath(tab, 'mediaPath', 'pagePath') || _chatStatePath('currentPagePath'), kind: 'file' };
  if (type === 'csv') return { path: _chatTabPath(tab, 'csvPath') || (typeof _csvPath !== 'undefined' ? _csvPath : ''), kind: 'file' };
  if (type === 'calendar') {
    const calendarPath = _chatTabPath(tab, 'calendarPath', 'dbPath') || _chatStatePath('currentDbPath');
    return { path: calendarPath || 'calendar:panel', kind: calendarPath ? 'folder' : 'panel' };
  }
  return { path: '', kind: '' };
}

function _chatCurrentOpenTarget() {
  try {
    if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.getCurrentOpenTargetInfo === 'function') {
      const paneId = (typeof GBLayout !== 'undefined' && GBLayout) ? (GBLayout.activePane || '') : '';
      const info = GBPaneBridge.getCurrentOpenTargetInfo(paneId);
      const target = _chatCurrentTargetFromTab(info?.activeTab);
      if (target.path) return { path: _chatNormalizePath(target.path), kind: target.kind || '' };
    }
  } catch {}

  try {
    if (typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function' && typeof GBLayout !== 'undefined') {
      const target = _chatCurrentTargetFromTab(GBTabs.getActiveTab(GBLayout.activePane));
      if (target.path) return { path: _chatNormalizePath(target.path), kind: target.kind || '' };
    }
  } catch {}

  const view = _chatStatePath('view');
  if (view === 'folder' && typeof _folderPath !== 'undefined' && _folderPath) return { path: _chatNormalizePath(_folderPath), kind: 'folder' };
  if (view === 'board' && _chatStatePath('currentBoardPath')) return { path: _chatNormalizePath(_chatStatePath('currentBoardPath')), kind: 'file' };
  if ((view === 'page' || view === 'media' || view === 'html') && _chatStatePath('currentPagePath')) return { path: _chatNormalizePath(_chatStatePath('currentPagePath')), kind: 'file' };
  if (view === 'entity' && _chatStatePath('currentEntityPath')) return { path: _chatNormalizePath(_chatStatePath('currentEntityPath')), kind: 'file' };
  if (_CHAT_TARGET_DB_VIEW_TYPES.has(view) && _chatStatePath('currentDbPath')) return { path: _chatNormalizePath(_chatStatePath('currentDbPath')), kind: 'folder' };
  if (_chatStatePath('currentPagePath')) return { path: _chatNormalizePath(_chatStatePath('currentPagePath')), kind: 'file' };
  if (_chatStatePath('currentDbPath')) return { path: _chatNormalizePath(_chatStatePath('currentDbPath')), kind: 'folder' };
  if (_chatStatePath('currentBoardPath')) return { path: _chatNormalizePath(_chatStatePath('currentBoardPath')), kind: 'file' };
  if (typeof _folderPath !== 'undefined' && _folderPath) return { path: _chatNormalizePath(_folderPath), kind: 'folder' };
  return { path: '', kind: '' };
}

function _chatTargetFromViewObject(view) {
  if (!view || typeof view !== 'object') return { path: '', kind: '' };
  const type = String(view.type || '');
  if (type === 'folder') return { path: view.path || '', kind: 'folder' };
  if (type === 'entity') return { path: view.entityPath || view.path || '', kind: 'file' };
  if (type === 'pivot' || type === 'database') return { path: view.dbPath || view.path || '', kind: 'folder' };
  if (type === 'board' || type === 'page' || type === 'scriptnote' || type === 'scenario' || type === 'media' || type === 'html' || type === 'csv' || type === 'smart-db') {
    return { path: view.path || view.boardPath || view.pagePath || view.scenarioPath || view.scriptnotePath || view.smartDbPath || view.csvPath || '', kind: 'file' };
  }
  return { path: view.path || '', kind: view.path ? 'file' : '' };
}

function _chatAdoptSourceForTargetPath(path, options = {}) {
  const clean = _chatNormalizePath(path);
  if (!clean || typeof _chatSourceOptions !== 'function' || typeof _chatApplySourceContextValue !== 'function') return;
  const current = typeof _chatTargetSelectorValue === 'function' ? _chatTargetSelectorValue() : '';
  const optionsList = _chatSourceOptions();
  let best = null;
  let bestLength = -1;
  optionsList.forEach(option => {
    const root = _chatNormalizePath(option?.path || option?.value || '');
    if (!root) return;
    if (clean === root || clean.startsWith(root + '/')) {
      if (root.length > bestLength) {
        best = option;
        bestLength = root.length;
      }
    }
  });
  if (!best) return;
  const next = best.kind === 'workspace' ? _chatWorkspaceOptionValue(best.workspaceId || '') : (best.path || best.value || '');
  if (next && next !== current) {
    _chatApplySourceContextValue(next, { reason: options.reason || 'current-target', syncWorkspace: options.syncWorkspace !== false });
  }
}

let _chatDeferredSourceAdoptSeq = 0;

function _chatDeferSourceAdoption(path, options = {}) {
  const clean = _chatNormalizePath(path);
  const seq = ++_chatDeferredSourceAdoptSeq;
  const run = () => {
    if (seq !== _chatDeferredSourceAdoptSeq) return;
    if (_chatState.currentTargetPath !== clean) return;
    _chatAdoptSourceForTargetPath(clean, options);
  };
  if (typeof requestAnimationFrame === 'function' && document.visibilityState !== 'hidden') {
    requestAnimationFrame(() => setTimeout(run, 0));
    return;
  }
  setTimeout(run, 0);
}

function _chatSetCurrentTargetPath(path, kind = '', options = {}) {
  const clean = _chatNormalizePath(path);
  const nextKind = clean ? String(kind || '') : '';
  const changed = _chatState.currentTargetPath !== clean || _chatState.currentTargetKind !== nextKind;
  _chatState.currentTargetPath = clean;
  _chatState.currentTargetKind = nextKind;
  if (clean && options.adoptSource !== false && (changed || options.forceAdoptSource)) {
    if (options.deferAdoptSource) _chatDeferSourceAdoption(clean, options);
    else _chatAdoptSourceForTargetPath(clean, options);
  }
  _chatRefreshCurrentTargetDisplay();
  return clean;
}

function _chatSetCurrentTargetFromView(view, options = {}) {
  const target = _chatTargetFromViewObject(view);
  if (!target.path) return '';
  return _chatSetCurrentTargetPath(target.path, target.kind, options);
}

function _chatEffectiveTargetPath(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options || {}, 'targetPath')) return String(options.targetPath || '');
  if (_chatState.currentTargetPath) return String(_chatState.currentTargetPath || '');
  if (_chatState.targetPath) return String(_chatState.targetPath || '');
  return _chatCurrentOpenTarget().path || '';
}

function _chatIsPseudoTargetPath(path) {
  const clean = _chatNormalizePath(path);
  return /^[a-z][a-z0-9_-]*:/i.test(clean) && !/^[a-zA-Z]:\//.test(clean);
}

function _chatParentFolderForTarget(path, kind = '') {
  const clean = _chatNormalizePath(path);
  if (!clean || _chatIsPseudoTargetPath(clean)) return '';
  if (kind === 'folder') return clean;
  const leaf = clean.split('/').pop() || '';
  const looksFile = kind === 'file' || /\.[^./]+$/.test(leaf);
  if (!looksFile) return clean;
  const index = clean.lastIndexOf('/');
  return index > 0 ? clean.slice(0, index) : '';
}

function _chatEffectiveWorkFolder(targetPath = '', options = {}) {
  if (Object.prototype.hasOwnProperty.call(options || {}, 'workFolder')) return String(options.workFolder || '');
  if (Object.prototype.hasOwnProperty.call(options || {}, 'work_folder')) return String(options.work_folder || '');
  const currentTarget = _chatCurrentOpenTarget();
  const target = _chatNormalizePath(targetPath || currentTarget.path || '');
  const kind = target && target === currentTarget.path ? currentTarget.kind : '';
  return _chatParentFolderForTarget(target, kind);
}

function _chatCurrentTargetLabel() {
  const path = _chatEffectiveTargetPath();
  if (path) return path;
  const source = typeof _chatSourceFolderValue === 'function' ? _chatSourceFolderValue() : '';
  if (source) return source;
  const workspaceId = typeof _chatWorkspaceIdValue === 'function' ? _chatWorkspaceIdValue() : '';
  if (!workspaceId) return '';
  if (typeof _chatSourceOptions === 'function') {
    const workspace = _chatSourceOptions().find(item => item?.kind === 'workspace' && String(item.workspaceId || '') === workspaceId);
    if (workspace?.path) return workspace.path;
  }
  return 'ワークスペース: ' + workspaceId;
}

function _chatRefreshCurrentTargetDisplay() {
  if (typeof _showChatTargetBadge === 'function') _showChatTargetBadge(_chatCurrentTargetLabel());
}

window.MeldexChatCurrentTarget = {
  setPath: _chatSetCurrentTargetPath,
  setFromView: _chatSetCurrentTargetFromView,
  refresh: _chatRefreshCurrentTargetDisplay,
};
