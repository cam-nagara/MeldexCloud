/* Chat target resolution: reference target is optional and independent from chat storage. */
const _CHAT_TARGET_DB_VIEW_TYPES = new Set(['database', 'db', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'tasks', 'shifts', 'chart', 'graph', 'form']);
const _CHAT_TARGET_MODES = new Set(['follow-main', 'manual', 'detached']);

// Capture at creation time. Existing/manual room titles never follow tab changes.
function _chatNewRoomBaseName(now = new Date()) {
  let path = '';
  try {
    const paneId = typeof GBPaneDefaultLayout !== 'undefined'
      ? GBPaneDefaultLayout.resolveMainPaneId({ contentOnly: true, allowLocked: true }) : '';
    if (paneId && typeof GBTabs !== 'undefined') {
      const tab = GBTabs.getActiveTab(paneId);
      path = _chatCurrentTargetFromTab(tab).path;
    } else if (typeof GBLayout === 'undefined') {
      path = _chatCurrentOpenTarget().path;
    }
  } catch {}
  const filename = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || '無題';
  const safeName = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || '無題';
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  return safeName + ' ' + date;
}

function _chatUniqueNewRoomName(base, rooms) {
  const names = new Set((rooms || []).map(room => room.name));
  let name = base;
  for (let i = 2; names.has(name); i++) name = base + ' (' + i + ')';
  return name;
}

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

function _chatTargetKind(path, kind = '', type = '') {
  if (/\.mel-sheet$/i.test(String(path || ''))) return 'file';
  if (type === 'database') return 'folder';
  return kind;
}

function _chatCurrentTargetFromTab(tab) {
  const rawType = String(tab?.type || '');
  const type = rawType === 'database' ? 'pivot' : rawType;
  if (type === 'folder') return { path: _chatTabPath(tab, 'folderPath') || (typeof _folderPath !== 'undefined' ? _folderPath : ''), kind: 'folder' };
  if (type === 'entity') return { path: _chatTabPath(tab, 'entityPath') || _chatStatePath('currentEntityPath'), kind: 'file' };
  if (type === 'page') return { path: _chatTabPath(tab, 'pagePath') || _chatStatePath('currentPagePath'), kind: 'file' };
  if (type === 'board') return { path: _chatTabPath(tab, 'boardPath') || _chatStatePath('currentBoardPath'), kind: 'file' };
  if (type === 'scriptnote') return { path: _chatTabPath(tab, 'scenarioPath', 'scriptnotePath'), kind: 'file' };
  if (type === 'form-app') return { path: _chatTabPath(tab, 'formPath'), kind: 'file' };
  if (_CHAT_TARGET_DB_VIEW_TYPES.has(type) || _CHAT_TARGET_DB_VIEW_TYPES.has(rawType)) {
    const path = _chatTabPath(tab, 'dbPath') || _chatStatePath('currentDbPath');
    return { path, kind: _chatTargetKind(path, 'folder') };
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
  // Chat/tree sidebars may own focus while the main content remains unchanged.
  let mainPaneId = '';
  try { mainPaneId = GBPaneDefaultLayout.resolveMainPaneId({ contentOnly: true, allowLocked: true }); } catch {}
  try {
    if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.getCurrentOpenTargetInfo === 'function') {
      const paneId = mainPaneId || ((typeof GBLayout !== 'undefined' && GBLayout) ? (GBLayout.activePane || '') : '');
      const info = GBPaneBridge.getCurrentOpenTargetInfo(paneId);
      if (info?.activeTab) {
        const target = _chatCurrentTargetFromTab(info.activeTab);
        return { path: _chatNormalizePath(target.path), kind: target.kind || '', resolved: true };
      }
    }
  } catch {}

  try {
    if (typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function' && typeof GBLayout !== 'undefined') {
      const activeTab = GBTabs.getActiveTab(mainPaneId || GBLayout.activePane);
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
  if (_CHAT_TARGET_DB_VIEW_TYPES.has(view) && _chatStatePath('currentDbPath')) return { path: _chatNormalizePath(_chatStatePath('currentDbPath')), kind: _chatTargetKind(_chatStatePath('currentDbPath'), 'folder'), resolved: true };
  if (_chatStatePath('currentPagePath')) return { path: _chatNormalizePath(_chatStatePath('currentPagePath')), kind: 'file', resolved: true };
  if (_chatStatePath('currentDbPath')) return { path: _chatNormalizePath(_chatStatePath('currentDbPath')), kind: _chatTargetKind(_chatStatePath('currentDbPath'), 'folder'), resolved: true };
  if (_chatStatePath('currentBoardPath')) return { path: _chatNormalizePath(_chatStatePath('currentBoardPath')), kind: 'file', resolved: true };
  if (typeof _folderPath !== 'undefined' && _folderPath) return { path: _chatNormalizePath(_folderPath), kind: 'folder', resolved: true };
  return { path: '', kind: '', resolved: false };
}

function _chatTargetFromViewObject(view) {
  if (!view || typeof view !== 'object') return { path: '', kind: '' };
  const type = String(view.type || '');
  if (type === 'folder') return { path: view.path || '', kind: 'folder' };
  if (type === 'entity') return { path: view.entityPath || view.path || '', kind: 'file' };
  if (_CHAT_TARGET_DB_VIEW_TYPES.has(type)) {
    const path = view.dbPath || view.path || '';
    return { path, kind: _chatTargetKind(path, 'folder') };
  }
  if (type === 'board' || type === 'page' || type === 'scriptnote' || type === 'scenario' || type === 'form-app' || type === 'media' || type === 'html' || type === 'csv') {
    return { path: view.path || view.boardPath || view.pagePath || view.scenarioPath || view.scriptnotePath || view.formPath || view.csvPath || '', kind: 'file' };
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
    targets: _chatEffectiveTargets(),
    started: _chatTargetHasStarted(),
  };
}

function _chatTargetHasStarted() {
  const chatState = _chatRuntimeState();
  return !!chatState?.targetStarted || (chatState?.messages || []).some(message => message.role === 'user');
}

function _chatTargetKey(path) {
  let value = _chatNormalizePath(path);
  if (value && !/^(?:[a-z]:\/|\/|[a-z][a-z0-9_-]*:)/i.test(value)) {
    const root = typeof _chatSourceFolderValue === 'function' ? _chatSourceFolderValue() : _chatStatePath('vaultPath');
    if (root) value = _chatNormalizePath(root) + '/' + value;
  }
  return /^[a-z]:\//i.test(value) ? value.toLowerCase() : value;
}

function _chatEffectiveTargets(options = {}) {
  const primary = _chatEffectiveTargetPath(options);
  const supplied = Array.isArray(options.targets) ? options.targets : (_chatRuntimeState()?.additionalTargets || []);
  const primaryKind = supplied.find(item => _chatTargetKey(item?.path) === _chatTargetKey(primary))?.kind || _chatRuntimeState()?.currentTargetKind || '';
  const targets = primary ? [{ path: primary, kind: primaryKind }] : [];
  const seen = new Set(targets.map(item => _chatTargetKey(item.path)));
  for (const item of supplied) {
    const path = _chatNormalizePath(item?.path || '');
    if (!path || seen.has(_chatTargetKey(path))) continue;
    seen.add(_chatTargetKey(path));
    targets.push({ path, kind: String(item.kind || '') });
  }
  return targets;
}

function _chatFreezeCurrentTarget() {
  const path = _chatEffectiveTargetPath();
  _chatState.currentTargetPath = path;
  _chatState.targetPath = path;
  _chatState.targetStarted = true;
  _chatSetCurrentTargetMode(path || _chatEffectiveTargets().length ? 'manual' : 'detached');
  _chatPersistTargetSnapshot();
  return _chatTargetSnapshot();
}

function _chatResetTargetForNewSession() {
  _chatState.targetStarted = false;
  _chatState.additionalTargets = [];
  _chatState.currentTargetPath = '';
  _chatState.currentTargetKind = '';
  _chatState.targetPath = '';
  _chatSetCurrentTargetMode('follow-main');
  _chatFollowCurrentOpenTarget();
}

function _chatRestoreSessionTargets(frontmatter = {}) {
  let targets = Array.isArray(frontmatter.targets) ? frontmatter.targets : [];
  const path = String(frontmatter.targetPath || targets[0]?.path || '');
  // /chat/load resolves targetId after rename. Do not retain its old path as
  // an extra target: another file may now occupy that old path.
  if (frontmatter.targetId && path && targets.length) targets = [{ ...targets[0], path }, ...targets.slice(1)];
  return _chatRestoreTargetSnapshot({ mode: path || targets.length ? 'manual' : 'detached', path,
    kind: targets.find(item => _chatTargetKey(item.path) === _chatTargetKey(path))?.kind || '',
    targets, started: (_chatState.messages || []).some(message => message.role === 'user') });
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
    return _chatTargetHasStarted() || reason === 'open-saved-chat' ? 'manual' : 'follow-main';
  }
  if (reason === 'tree-click' || reason === 'tree-select' || reason === 'tree-activate') {
    if (_chatTargetHasStarted() && !options.force) return '';
    return 'follow-main';
  }
  if (reason === 'last-view') {
    if ((_chatTargetHasStarted() || currentMode === 'detached') && !options.force) return '';
    return 'follow-main';
  }
  return currentMode;
}

function _chatSetCurrentTargetPath(path, kind = '', options = {}) {
  const chatState = _chatRuntimeState();
  if (!chatState) return '';
  const clean = _chatNormalizePath(path);
  const nextKind = clean ? _chatTargetKind(clean, String(kind || '')) : '';
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
  if (_chatState.currentTargetPath) return String(_chatState.currentTargetPath);
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

let _chatTargetDisplayGeneration = 0;
const _chatTargetDisplayNames = new Map();
async function _chatDisplayTargetPaths(targets) {
  const roots = await window.GBFolderPicker.loadRoots();
  const listings = new Map();
  return Promise.all(targets.map(async target => {
    const key = _chatTargetKey(target.path);
    const root = roots.filter(item => key === _chatTargetKey(item.path) || key.startsWith(_chatTargetKey(item.path) + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (!root || _chatIsPseudoTargetPath(target.path)) return target.path;
    const physical = _chatTargetKey(root.path) === key ? root.path : root.path + '/' + key.slice(_chatTargetKey(root.path).length + 1);
    const segments = physical.slice(root.path.length).split('/').filter(Boolean);
    const labels = [root.name];
    let parent = root.path;
    for (const segment of segments) {
      const query = '/browse?' + new URLSearchParams({ path: parent, root: root.path, all_files: '1' });
      if (!listings.has(query)) listings.set(query, apiFetch(query, { skipBrowseCache: true }));
      const payload = await listings.get(query);
      const path = parent + '/' + segment;
      const row = (Array.isArray(payload) ? payload : payload.items || []).find(item => _chatTargetKey(item.path) === _chatTargetKey(path));
      labels.push(row?.name || segment);
      parent = row?.path || path;
    }
    const display = labels.join('/');
    _chatTargetDisplayNames.set(key, display);
    return display;
  }));
}

function _chatRenderTargetLabels(label, targets) {
  const generation = ++_chatTargetDisplayGeneration;
  const render = paths => { label.textContent = paths.join('\n'); label.title = paths.join('\n'); };
  render(targets.map(item => _chatTargetDisplayNames.get(_chatTargetKey(item.path)) || '対象の表示名を確認中…'));
  if (!window.GBFolderPicker?.loadRoots) return;
  _chatDisplayTargetPaths(targets).then(paths => {
    if (generation === _chatTargetDisplayGeneration && label.isConnected !== false) render(paths);
  }).catch(() => {
    if (generation === _chatTargetDisplayGeneration) render(targets.map(item => _chatTargetDisplayNames.get(_chatTargetKey(item.path)) || '対象の表示名を取得できません'));
  });
}

function _chatFollowCurrentOpenTarget(options = {}) {
  const chatState = _chatRuntimeState();
  if (!chatState) return _chatTargetSnapshot();
  if (_chatTargetHasStarted() || _chatCurrentTargetMode() === 'detached') return _chatTargetSnapshot();
  _chatSetCurrentTargetMode('follow-main');
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
      const paneId = arguments[0];
      const refresh = () => {
        try {
          if (typeof GBPaneDefaultLayout !== 'undefined' && paneId !== GBPaneDefaultLayout.resolveMainPaneId({ contentOnly: true, allowLocked: true })) return;
        } catch {}
        _chatFollowCurrentOpenTarget();
      };
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
  _chatState.additionalTargets = [];
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
  const roomMessages = _chatState.messages;
  const roomId = _chatState.sessionId;
  let selection = null;
  try {
    selection = await window.GBFolderPicker.pickFolder({
      title: 'チャットの対象を追加',
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
  if (_chatState.messages !== roomMessages || _chatState.sessionId !== roomId || _chatState.streaming) {
    if (typeof showStatus === 'function') showStatus('チャットの状態が変わったため、対象の追加を中止しました', true);
    return null;
  }
  const kind = _chatTargetKind(selection.path, selection.kind || 'folder', selection.type || '');
  // Explicit additions never replace a room's original target or its write scope.
  if (!_chatEffectiveTargetPath() && !_chatTargetHasStarted()) {
    _chatSetCurrentTargetPath(selection.path, kind, { reason: 'chat-target-picker', mode: 'manual' });
  } else if (!_chatEffectiveTargets().some(item => _chatTargetKey(item.path) === _chatTargetKey(selection.path))) {
    _chatState.additionalTargets = [...(_chatState.additionalTargets || []), { path: selection.path, kind }];
  }
  _chatRefreshCurrentTargetDisplay();
  _chatPersistTargetSnapshot();
  return selection;
}

function _chatRestoreTargetSnapshot(snapshot) {
  const started = !!snapshot?.started || (_chatState.messages || []).some(message => message.role === 'user');
  let mode = _CHAT_TARGET_MODES.has(String(snapshot?.mode || '')) ? String(snapshot.mode) : 'follow-main';
  if (started && mode === 'follow-main') mode = 'manual';
  const savedPath = _chatNormalizePath(snapshot?.path || '');
  const currentTarget = mode === 'follow-main' ? _chatCurrentOpenTarget() : { path: '', kind: '' };
  const path = mode === 'follow-main' && currentTarget.resolved ? currentTarget.path : savedPath;
  _chatState.currentTargetPath = mode === 'detached' ? '' : path;
  _chatState.currentTargetKind = path
    ? String(mode === 'follow-main' && currentTarget.resolved ? currentTarget.kind || '' : snapshot?.kind || '')
    : '';
  _chatState.additionalTargets = (Array.isArray(snapshot?.targets) ? snapshot.targets : [])
    .filter(item => item?.path && _chatTargetKey(item.path) !== _chatTargetKey(path))
    .map(item => ({ path: _chatNormalizePath(item.path), kind: String(item.kind || '') }));
  _chatState.targetStarted = started;
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
