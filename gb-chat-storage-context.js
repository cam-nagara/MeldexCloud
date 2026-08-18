/* gb-chat-storage-context.js: AI chat storage scope independent from the optional reference target. */
(function(global) {
  'use strict';

  let _initializing = null;

  function _currentWorkspaceId() {
    return typeof _chatWorkspaceIdValue === 'function'
      ? String(_chatWorkspaceIdValue() || '')
      : String(global._chatState?.workspaceId || '');
  }

  function _currentSourceFolder() {
    return typeof _chatSourceFolderValue === 'function'
      ? String(_chatSourceFolderValue() || '')
      : String(global._chatState?.sourceFolder || '');
  }

  function _sourceOptions() {
    return typeof _chatSourceOptions === 'function' ? (_chatSourceOptions() || []) : [];
  }

  function _workspaceRoot(workspaceId) {
    const id = String(workspaceId || '');
    if (!id) return '';
    const option = _sourceOptions().find(item => item?.kind === 'workspace' && String(item.workspaceId || '') === id);
    return String(option?.path || '');
  }

  function _homeOption() {
    return _sourceOptions().find(item => item?.kind === 'home' && String(item.path || item.value || '').trim()) || null;
  }

  function _applyHomeOption(option) {
    const path = String(option?.path || option?.value || '').trim();
    if (!path) return '';
    if (typeof _chatApplySourceContextValue === 'function') {
      _chatApplySourceContextValue(path, { reason: 'ai-chat-storage', syncWorkspace: false });
    } else if (global._chatState) {
      global._chatState.workspaceId = '';
      global._chatState.sourceFolder = path;
    }
    return path;
  }

  async function _ensureDefaultStorageScope() {
    if (_currentWorkspaceId() || _currentSourceFolder()) return true;
    const cachedHome = _homeOption();
    if (cachedHome) return !!_applyHomeOption(cachedHome);

    if (!_initializing) {
      _initializing = Promise.resolve().then(async () => {
        if (typeof _initChatSourceFolderSelector === 'function') {
          try {
            await _initChatSourceFolderSelector();
          } catch (error) {
            console.warn('[ChatStorage] 保存先一覧の初期化に失敗しました', error);
          }
        }
        if (_currentWorkspaceId() || _currentSourceFolder()) return true;
        const loadedHome = _homeOption();
        if (loadedHome) return !!_applyHomeOption(loadedHome);
        if (typeof apiFetch === 'function') {
          try {
            const payload = await apiFetch('/home-folder');
            const path = String(payload?.path || '').trim();
            if (path) return !!_applyHomeOption({ path, value: path });
          } catch (error) {
            console.warn('[ChatStorage] ホームフォルダの取得に失敗しました', error);
          }
        }
        return false;
      }).finally(() => {
        _initializing = null;
      });
    }
    return _initializing;
  }

  function _context(workspaceId, sourceFolder) {
    const workspace = String(workspaceId || '');
    const source = workspace ? '' : String(sourceFolder || '');
    return {
      workspaceId: workspace,
      sourceFolder: source,
      rootPath: workspace ? _workspaceRoot(workspace) : source,
      scopeKey: workspace ? 'workspace:' + workspace : (source ? 'source:' + source.replace(/\\/g, '/').toLowerCase() : ''),
    };
  }

  async function resolveForAi(options = {}) {
    const hasWorkspace = Object.prototype.hasOwnProperty.call(options || {}, 'workspaceId');
    const hasSource = Object.prototype.hasOwnProperty.call(options || {}, 'sourceFolder');
    let workspaceId = hasWorkspace ? String(options.workspaceId || '') : (hasSource ? '' : _currentWorkspaceId());
    let sourceFolder = hasSource ? String(options.sourceFolder || '') : (workspaceId ? '' : _currentSourceFolder());
    if (workspaceId || sourceFolder) return _context(workspaceId, sourceFolder);

    await _ensureDefaultStorageScope();
    workspaceId = _currentWorkspaceId();
    sourceFolder = workspaceId ? '' : _currentSourceFolder();
    return _context(workspaceId, sourceFolder);
  }

  async function requireForAi(options = {}) {
    const context = await resolveForAi(options);
    if (context.workspaceId || context.sourceFolder) return context;
    if (typeof showStatus === 'function') {
      showStatus('AIチャットの保存先を準備できませんでした。ホームフォルダ設定を確認してください', true);
    }
    return null;
  }

  global.GBChatStorageContext = {
    resolveForAi,
    requireForAi,
  };
})(window);
