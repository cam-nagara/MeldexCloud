/* Chat target resolution: reference target is optional and independent from chat storage. */
const _CHAT_TARGET_DB_VIEW_TYPES = new Set(['database', 'db', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'tasks', 'shifts', 'chart', 'graph', 'form']);
const _CHAT_TARGET_MODES = new Set(['follow-main', 'manual', 'detached']);

function _chatRuntimeState() {
  return typeof _chatState === 'undefined' ? null : _chatState;
}

function _chatStatePath(key) {
  return (typeof state !== 'undefined' && state) ? String(state[key] || '') : '';
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
      if (info?.activeTab) {
        const target = _chatCurrentTargetFromTab(info.activeTab);
        return { path: _chatNormalizePath(target.path), kind: target.kind || '', resolved: true };
      }
    }
  } catch {}

  try {
    if (typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function' && typeof GBLayout !== 'undefined') {
      const activeTab = GBTabs.getActiveTab(GBLayout.activePane);
      if (activeTab) {
        const target = _chatCurrentTargetFromTab(activeTab);
        return { path: _chatNormalizePath(target.path), kind: target.kind || '', resolved: true };
      }
    }
  } catch {}

  const view = _chatStatePath('view');
  if (view === 'folder' && typeof _folderPath !== 'undefined' && _folderPath) return { path: _chatNormalizePath(_folderPath), kind: 'folder', resolved: true };
  if (view === 'board' && _chatStatePath('currentBoardPath')) return { path: _chatNormalizePath(_chatStatePath('currentBoardPath')), kind: 'file', resolved: true };
  if ((view === 'page' || view === 'media' || view === 'html') && _chatStatePath('currentPagePath')) return { path: _chatNormalizePath(_chatStatePath('currentPagePath')), kind: 'file', resolved: true };
  if (view === 'entity' && _chatStatePath('currentEntityPath')) return { path: _chatNormalizePath(_chatStatePath('currentEntityPath')), kind: 'file', resolved: true };
  if (_CHAT_TARGET_DB_VIEW_TYPES.has(view) && _chatStatePath('currentDbPath')) return { path: _chatNormalizePath(_chatStatePath('currentDbPath')), kind: 'folder', resolved: true };
  if (_chatStatePath('currentPagePath')) return { path: _chatNormalizePath(_chatStatePath('currentPagePath')), kind: 'file', resolved: true };
  if (_chatStatePath('currentDbPath')) return { path: _chatNormalizePath(_chatStatePath('currentDbPath')), kind: 'folder', resolved: true };
  if (_chatStatePath('currentBoardPath')) return { path: _chatNormalizePath(_chatStatePath('currentBoardPath')), kind: 'file', resolved: true };
  if (typeof _folderPath !== 'undefined' && _folderPath) return { path: _chatNormalizePath(_folderPath), kind: 'folder', resolved: true };
  return { path: '', kind: '', resolved: false };
}

function _chatTargetFromViewObject(view) {
  if (!view || typeof view !== 'object') return { path: '', kind: '' };
  const type = String(view.type || '');
  if (type === 'folder') return { path: view.path || '', kind: 'folder' };
  if (type === 'entity') return { path: view.entityPath || view.path || '', kind: 'file' };
  if (type === 'pivot' || type === 'database') return { path: view.dbPath || view.path || '', kind: 'folder' };
  if (type === 'board' || type === 'page' || type === 'scriptnote' || type === 'scenario' || type === 'media' || type === 'html' || type === 'csv') {
    return { path: view.path || view.boardPath || view.pagePath || view.scenarioPath || view.scriptnotePath || view.csvPath || '', kind: 'file' };
  }
  return { path: view.path || '', kind: view.path ? 'file' : '' };
}

function _chatCurrentTargetMode() {
  const mode = String(_chatRuntimeState()?.currentTargetMode || '');
  return _CHAT_TARGET_MODES.has(mode) ? mode : 'follow-main';
}

function _chatSetCurrentTargetMode(mode) {
  const next = _CHAT_TARGET_MODES.has(String(mode || '')) ? String(mode) : 'follow-main';
  _chatState.currentTargetMode = next;
  return next;
}

function _chatTargetSnapshot() {
  const chatState = _chatRuntimeState();
  return {
    mode: _chatCurrentTargetMode(),
    path: String(chatState?.currentTargetPath || ''),
    kind: String(chatState?.currentTargetKind || ''),
  };
}

function _chatPersistTargetSnapshot() {
  try {
    if (window.GBChatRestore?.saveTargetState) window.GBChatRestore.saveTargetState(_chatTargetSnapshot());
  } catch {
    // 復元用メタデータの保存失敗は、現在のチャット操作を止めない。
  }
}

function _chatTargetUpdateMode(options = {}) {
  const reason = String(options.reason || '');
  const currentMode = _chatCurrentTargetMode();
  if (options.mode && _CHAT_TARGET_MODES.has(String(options.mode))) return String(options.mode);
  if (reason === 'chat-target-picker' || reason === 'open-file-chat' || reason === 'create-file-chat' || reason === 'open-saved-chat') {
    return 'manual';
  }
  if (reason === 'tree-click') {
    if (currentMode === 'manual' && !options.force) return '';
    return 'follow-main';
  }
  if (reason === 'last-view') {
    if (currentMode !== 'follow-main' && !options.force) return '';
    return 'follow-main';
  }
  return currentMode;
}

function _chatSetCurrentTargetPath(path, kind = '', options = {}) {
  const chatState = _chatRuntimeState();
  if (!chatState) return '';
  const clean = _chatNormalizePath(path);
  const nextKind = clean ? String(kind || '') : '';
  const nextMode = _chatTargetUpdateMode(options);
  if (!nextMode) return String(chatState.currentTargetPath || '');
  chatState.currentTargetPath = clean;
  chatState.currentTargetKind = nextKind;
  _chatSetCurrentTargetMode(nextMode);
  if (nextMode === 'manual') {
    chatState.targetPath = clean;
    chatState.lastImplicitTargetPath = '';
  }
  _chatRefreshCurrentTargetDisplay();
  _chatPersistTargetSnapshot();
  return clean;
}

function _chatSetCurrentTargetFromView(view, options = {}) {
  const target = _chatTargetFromViewObject(view);
  if (!target.path) return '';
  return _chatSetCurrentTargetPath(target.path, target.kind, options);
}

function _chatEffectiveTargetPath(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options || {}, 'targetPath')) return String(options.targetPath || '');
  const mode = _chatCurrentTargetMode();
  if (mode === 'detached') return '';
  if (mode === 'manual') return String(_chatState.currentTargetPath || _chatState.targetPath || '');
  const currentTarget = _chatCurrentOpenTarget();
  return currentTarget.resolved ? currentTarget.path : (currentTarget.path || String(_chatState.currentTargetPath || ''));
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
  const target = _chatNormalizePath(targetPath || '');
  const storedTarget = _chatNormalizePath(_chatState.currentTargetPath || '');
  const kind = target && target === storedTarget
    ? String(_chatState.currentTargetKind || '')
    : (target && target === currentTarget.path ? currentTarget.kind : '');
  return _chatParentFolderForTarget(target, kind);
}

function _chatCurrentTargetLabel() {
  return _chatEffectiveTargetPath();
}

function _chatRefreshCurrentTargetDisplay() {
  if (typeof _showChatTargetBadge === 'function') _showChatTargetBadge(_chatCurrentTargetLabel());
}

function _chatFollowCurrentOpenTarget(options = {}) {
  const chatState = _chatRuntimeState();
  if (!chatState) return _chatTargetSnapshot();
  if (_chatCurrentTargetMode() !== 'follow-main') return _chatTargetSnapshot();
  const target = _chatCurrentOpenTarget();
  if (target.resolved) {
    chatState.currentTargetPath = target.path || '';
    chatState.currentTargetKind = target.path ? String(target.kind || '') : '';
  }
  chatState.targetPath = '';
  _chatRefreshCurrentTargetDisplay();
  if (options.persist !== false) _chatPersistTargetSnapshot();
  return _chatTargetSnapshot();
}

function _chatInstallTabActivationHook() {
  try {
    if (typeof GBTabs === 'undefined' || typeof GBTabs.activateTab !== 'function') return;
    const original = GBTabs.activateTab;
    if (original.__gbChatTargetPatched) return;
    const patched = function() {
      const result = original.apply(this, arguments);
      const refresh = () => _chatFollowCurrentOpenTarget();
      if (result && typeof result.then === 'function') result.then(refresh, refresh);
      else Promise.resolve().then(refresh);
      return result;
    };
    patched.__gbChatTargetPatched = true;
    GBTabs.activateTab = patched;
  } catch {
    // タブ機構がまだ初期化されていない場合も、従来の選択イベントによる追従を維持する。
  }
}

function _chatClearCurrentTarget() {
  if (_chatState.streaming) {
    if (typeof showStatus === 'function') showStatus('応答生成中は対象を変更できません', true);
    return false;
  }
  _chatState.currentTargetPath = '';
  _chatState.currentTargetKind = '';
  _chatState.targetPath = '';
  _chatState.lastImplicitTargetPath = '';
  _chatSetCurrentTargetMode('detached');
  _chatRefreshCurrentTargetDisplay();
  _chatPersistTargetSnapshot();
  return true;
}

async function _chatPickCurrentTarget() {
  if (_chatState.streaming) {
    if (typeof showStatus === 'function') showStatus('応答生成中は対象を変更できません', true);
    return null;
  }
  if (!window.GBFolderPicker?.pickFolder) {
    if (typeof showStatus === 'function') showStatus('対象一覧を読み込めませんでした', true);
    return null;
  }
  const currentPath = _chatEffectiveTargetPath();
  let selection = null;
  try {
    selection = await window.GBFolderPicker.pickFolder({
      title: 'チャットの対象を選択',
      selectFiles: true,
      includeHome: true,
      includeSources: true,
      includeWorkspaces: true,
      initialPath: currentPath,
      revealPath: currentPath,
    });
  } catch (error) {
    if (typeof showStatus === 'function') showStatus('対象の選択に失敗しました: ' + (error?.message || error), true);
    return null;
  }
  if (!selection?.path) return null;
  _chatSetCurrentTargetPath(selection.path, selection.kind || 'folder', {
    reason: 'chat-target-picker',
    mode: 'manual',
  });
  return selection;
}

function _chatRestoreTargetSnapshot(snapshot) {
  const mode = _CHAT_TARGET_MODES.has(String(snapshot?.mode || '')) ? String(snapshot.mode) : 'follow-main';
  const savedPath = _chatNormalizePath(snapshot?.path || '');
  const currentTarget = mode === 'follow-main' ? _chatCurrentOpenTarget() : { path: '', kind: '' };
  const path = mode === 'follow-main' && currentTarget.resolved ? currentTarget.path : savedPath;
  _chatState.currentTargetPath = mode === 'detached' ? '' : path;
  _chatState.currentTargetKind = path
    ? String(mode === 'follow-main' && currentTarget.resolved ? currentTarget.kind || '' : snapshot?.kind || '')
    : '';
  _chatSetCurrentTargetMode(mode);
  if (mode === 'manual') _chatState.targetPath = path;
  else _chatState.targetPath = '';
  if (mode === 'detached') {
    _chatState.targetPath = '';
    _chatState.lastImplicitTargetPath = '';
  }
  _chatRefreshCurrentTargetDisplay();
  return _chatTargetSnapshot();
}

window.chatClearCurrentTarget = _chatClearCurrentTarget;
window.chatPickCurrentTarget = _chatPickCurrentTarget;
window.MeldexChatCurrentTarget = {
  setPath: _chatSetCurrentTargetPath,
  setFromView: _chatSetCurrentTargetFromView,
  clear: _chatClearCurrentTarget,
  pick: _chatPickCurrentTarget,
  followMain: _chatFollowCurrentOpenTarget,
  refresh: _chatRefreshCurrentTargetDisplay,
  snapshot: _chatTargetSnapshot,
  restore: _chatRestoreTargetSnapshot,
};

_chatInstallTabActivationHook();
