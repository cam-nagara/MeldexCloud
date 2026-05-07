(function() {
  'use strict';

  const STORAGE_KEY = 'gb:last-chat-session';
  let _suspendCount = 0;
  let _restorePending = false;

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function _save(next) {
    try {
      const prev = _load() || {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...prev,
        ...next,
        savedAt: Date.now(),
      }));
    } catch {}
  }

  function _currentSavedPath() {
    if (typeof _chatState === 'undefined' || !_chatState?.sessionId) return '';
    if (typeof _chatSavedPathForSession === 'function') return _chatSavedPathForSession(_chatState.sessionId);
    return '_chat/llm/' + _chatState.sessionId + '.md';
  }

  function _currentSourceFolder() {
    return (typeof _chatState !== 'undefined' && _chatState) ? String(_chatState.sourceFolder || '') : '';
  }

  async function _withSuspendedRestoreAsync(fn) {
    _suspendCount++;
    try {
      return await fn();
    } finally {
      _suspendCount = Math.max(0, _suspendCount - 1);
    }
  }

  function isRestoreSuspended() {
    return _suspendCount > 0 || _restorePending;
  }

  function restoreOnOpen() {
    if (isRestoreSuspended()) return false;
    const meta = _load();
    if (!meta?.mode) return false;
    _restorePending = true;
    _suspendCount++;
    Promise.resolve().then(async () => {
      if (meta.mode === 'history') {
        if (typeof switchChatMode === 'function') switchChatMode('history');
        return;
      }
      if (meta.mode === 'team') {
        if (typeof _setChatSourceFolder === 'function') await _setChatSourceFolder(meta.sourceFolder || '', { skipSave: true });
        if (typeof switchChatMode === 'function') switchChatMode('team');
        if (typeof loadTeamRooms === 'function') await loadTeamRooms();
        if (meta.roomPath && Array.isArray(_teamRoomsCache) && _teamRoomsCache.some(room => room.path === meta.roomPath) && typeof selectTeamRoom === 'function') {
          await selectTeamRoom(meta.roomPath);
        }
        return;
      }
      if (typeof switchChatMode === 'function') switchChatMode('llm');
      if (meta.savedPath && typeof openSavedChat === 'function') {
        await openSavedChat(meta.savedPath, '', meta.sourceFolder || '');
        return;
      }
      if (meta.targetPath && typeof openFileChat === 'function') {
        await openFileChat(meta.targetPath);
      }
    }).finally(() => {
      _restorePending = false;
      _suspendCount = Math.max(0, _suspendCount - 1);
    });
    return true;
  }

  function _patch(name, wrap) {
    const original = window[name];
    if (typeof original !== 'function' || original.__gbChatRestorePatched) return;
    const patched = wrap(original);
    patched.__gbChatRestorePatched = true;
    window[name] = patched;
  }

  _patch('openSavedChat', (original) => async function(path) {
    const result = await _withSuspendedRestoreAsync(() => original.apply(this, arguments));
    if (!isRestoreSuspended()) {
      _save({
        mode: 'llm',
        savedPath: path || _currentSavedPath(),
        targetPath: typeof _chatState !== 'undefined' ? (_chatState.targetPath || '') : '',
        sourceFolder: _currentSourceFolder(),
      });
    }
    return result;
  });

  _patch('openFileChat', (original) => async function(targetPath) {
    const result = await _withSuspendedRestoreAsync(() => original.apply(this, arguments));
    if (!isRestoreSuspended()) {
      _save({
        mode: 'llm',
        savedPath: _currentSavedPath(),
        targetPath: targetPath || (typeof _chatState !== 'undefined' ? (_chatState.targetPath || '') : ''),
        sourceFolder: _currentSourceFolder(),
      });
    }
    return result;
  });

  _patch('chatAutoSave', (original) => async function() {
    const result = await original.apply(this, arguments);
    _save({
      mode: 'llm',
      savedPath: _currentSavedPath(),
      targetPath: typeof _chatState !== 'undefined' ? (_chatState.targetPath || '') : '',
      sourceFolder: _currentSourceFolder(),
    });
    return result;
  });

  _patch('chatClear', (original) => function() {
    const result = original.apply(this, arguments);
    _save({ mode: 'llm', savedPath: '', targetPath: '', sourceFolder: _currentSourceFolder() });
    return result;
  });

  _patch('selectTeamRoom', (original) => async function(roomPath) {
    const result = await original.apply(this, arguments);
    if (!isRestoreSuspended()) _save({ mode: 'team', roomPath: roomPath || '', sourceFolder: _currentSourceFolder() });
    return result;
  });

  _patch('switchChatMode', (original) => function(mode) {
    const result = original.apply(this, arguments);
    if (isRestoreSuspended()) return result;
    if (mode === 'history') {
      _save({ mode: 'history', sourceFolder: _currentSourceFolder() });
    } else if (mode === 'team' && (typeof _teamCurrentRoom === 'undefined' || !_teamCurrentRoom)) {
      _save({ mode: 'team', roomPath: '', sourceFolder: _currentSourceFolder() });
    } else if (mode === 'llm') {
      _save({
        mode: 'llm',
        savedPath: _currentSavedPath(),
        targetPath: typeof _chatState !== 'undefined' ? (_chatState.targetPath || '') : '',
        sourceFolder: _currentSourceFolder(),
      });
    }
    return result;
  });

  window.GBChatRestore = {
    restoreOnOpen,
    isRestoreSuspended,
  };
})();
