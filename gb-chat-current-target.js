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

function _chatEffectiveTargetPath(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options || {}, 'targetPath')) return String(options.targetPath || '');
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
