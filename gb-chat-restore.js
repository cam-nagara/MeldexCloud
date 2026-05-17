(function() {
  'use strict';

  const STORAGE_KEY = 'gb:last-chat-session';
  let _suspendCount = 0;
  let _restorePending = false;
  let _restoreGeneration = 0;
  let _restoreApplying = false;

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

  function _saveCurrentLlmRestore() {
    const savedPath = _currentSavedPath();
    if (!savedPath) return;
    _save({
      mode: 'llm',
      savedPath,
      targetPath: typeof _chatState !== 'undefined' ? (_chatState.targetPath || '') : '',
      sourceFolder: _currentSourceFolder(),
    });
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

  function _restoreIsCurrent(token) {
    return _restorePending && token === _restoreGeneration;
  }

  async function _runRestoreStep(token, fn) {
    if (!_restoreIsCurrent(token) || typeof fn !== 'function') return false;
    _restoreApplying = true;
    let result;
    try {
      result = fn();
    } finally {
      _restoreApplying = false;
    }
    try {
      await result;
    } catch {
      return false;
    }
    return _restoreIsCurrent(token);
  }

  function _restoreGuard() {
    if (!_restorePending || !_restoreApplying) return null;
    const token = _restoreGeneration;
    return () => _restoreIsCurrent(token);
  }

  function _cancelRestoreForUserAction() {
    if (!_restorePending || _restoreApplying) return;
    _restoreGeneration++;
    _restorePending = false;
  }

  function _runRestoreInternal(fn) {
    const previous = _restoreApplying;
    _restoreApplying = true;
    try {
      return typeof fn === 'function' ? fn() : undefined;
    } finally {
      _restoreApplying = previous;
    }
  }

  function _sameRestorePath(a, b) {
    const clean = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
    return !!clean(a) && clean(a) === clean(b);
  }

  function _savedPathWasRestored(savedPath) {
    if (!savedPath || typeof _chatState === 'undefined' || !_chatState?.sessionId) return false;
    return _sameRestorePath(_currentSavedPath(), savedPath);
  }

  function restoreOnOpen() {
    if (isRestoreSuspended()) return false;
    const meta = _load();
    if (!meta?.mode) return false;
    const token = ++_restoreGeneration;
    _restorePending = true;
    _suspendCount++;
    Promise.resolve().then(async () => {
      if (meta.mode === 'history') {
        await _runRestoreStep(token, () => {
          if (typeof switchChatMode === 'function') switchChatMode('history');
        });
        return;
      }
      if (meta.mode === 'team') {
        if (!await _runRestoreStep(token, async () => {
          if (typeof _setChatSourceFolder === 'function') await _setChatSourceFolder(meta.sourceFolder || '', { skipSave: true });
        })) return;
        if (!await _runRestoreStep(token, () => {
          if (typeof switchChatMode === 'function') switchChatMode('team');
        })) return;
        if (!await _runRestoreStep(token, async () => {
          if (typeof loadTeamRooms === 'function') await loadTeamRooms();
        })) return;
        if (meta.roomPath && Array.isArray(_teamRoomsCache) && _teamRoomsCache.some(room => room.path === meta.roomPath) && typeof selectTeamRoom === 'function') {
          await _runRestoreStep(token, () => selectTeamRoom(meta.roomPath));
        }
        return;
      }
      if (!await _runRestoreStep(token, () => {
        if (typeof switchChatMode === 'function') switchChatMode('llm');
      })) return;
      if (meta.savedPath && typeof openSavedChat === 'function') {
        if (!await _runRestoreStep(token, () => openSavedChat(meta.savedPath, '', meta.sourceFolder || ''))) return;
        if (_savedPathWasRestored(meta.savedPath)) return;
      }
      if (meta.targetPath && typeof openFileChat === 'function') {
        await _runRestoreStep(token, () => openFileChat(meta.targetPath));
      }
    }).catch(() => {}).finally(() => {
      if (_restoreGeneration === token) _restorePending = false;
      _suspendCount = Math.max(0, _suspendCount - 1);
      _restoreApplying = false;
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
    _cancelRestoreForUserAction();
    const result = await _withSuspendedRestoreAsync(() => original.apply(this, arguments));
    if (!isRestoreSuspended()) {
      _saveCurrentLlmRestore();
    }
    return result;
  });

  _patch('openFileChat', (original) => async function(targetPath) {
    _cancelRestoreForUserAction();
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
    if (result !== false) _saveCurrentLlmRestore();
    return result;
  });

  _patch('chatClear', (original) => function() {
    _cancelRestoreForUserAction();
    const result = original.apply(this, arguments);
    _save({ mode: 'llm', savedPath: '', targetPath: '', sourceFolder: _currentSourceFolder() });
    return result;
  });

  _patch('selectTeamRoom', (original) => async function(roomPath) {
    _cancelRestoreForUserAction();
    const result = await original.apply(this, arguments);
    if (!isRestoreSuspended()) _save({ mode: 'team', roomPath: roomPath || '', sourceFolder: _currentSourceFolder() });
    return result;
  });

  _patch('switchChatMode', (original) => function(mode) {
    _cancelRestoreForUserAction();
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
    restoreGuard: _restoreGuard,
    runInternal: _runRestoreInternal,
  };
})();
