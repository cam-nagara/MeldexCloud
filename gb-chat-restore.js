/* Chat panel session restore v2: mode, history view, target and room-per-storage-scope. */
(function() {
  'use strict';

  const STORAGE_KEY = 'gb:last-chat-session';
  const VALID_MODES = new Set(['team', 'llm', 'history']);
  const VALID_TARGET_MODES = new Set(['follow-main', 'manual', 'detached']);
  let _suspendCount = 0;
  let _restorePending = false;
  let _restoreGeneration = 0;
  let _restoreApplying = false;
  let _llmContentRestored = false;

  function _cleanPath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function _emptyMeta() {
    return {
      version: 2,
      mode: '',
      historyView: 'saved',
      ai: { savedPath: '' },
      storage: { workspaceId: '', sourceFolder: '' },
      target: { mode: 'follow-main', path: '', kind: '' },
      rooms: {},
      savedAt: 0,
    };
  }

  function _scopeKey(storage) {
    const workspaceId = String(storage?.workspaceId || '');
    if (workspaceId) return 'workspace:' + workspaceId;
    const sourceFolder = _cleanPath(storage?.sourceFolder || '').toLowerCase();
    return sourceFolder ? 'source:' + sourceFolder : '';
  }

  function _normalizeMeta(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    if (Number(parsed.version || 0) >= 2) {
      const base = _emptyMeta();
      return {
        ...base,
        ...parsed,
        version: 2,
        mode: VALID_MODES.has(String(parsed.mode || '')) ? String(parsed.mode) : '',
        historyView: parsed.historyView === 'cli' ? 'cli' : 'saved',
        ai: { ...base.ai, ...(parsed.ai || {}) },
        storage: { ...base.storage, ...(parsed.storage || {}) },
        target: { ...base.target, ...(parsed.target || {}) },
        rooms: parsed.rooms && typeof parsed.rooms === 'object' ? { ...parsed.rooms } : {},
      };
    }

    const sourceFolder = String(parsed.sourceFolder || '');
    const targetPath = String(parsed.targetPath || '');
    const storage = { workspaceId: '', sourceFolder };
    const rooms = {};
    const scope = _scopeKey(storage);
    if (scope && parsed.roomPath) rooms[scope] = String(parsed.roomPath);
    return {
      ..._emptyMeta(),
      mode: VALID_MODES.has(String(parsed.mode || '')) ? String(parsed.mode) : '',
      historyView: parsed.historyView === 'cli' ? 'cli' : 'saved',
      ai: { savedPath: String(parsed.savedPath || '') },
      storage,
      target: {
        mode: targetPath ? 'manual' : 'follow-main',
        path: targetPath,
        kind: '',
      },
      rooms,
      savedAt: Number(parsed.savedAt || 0),
    };
  }

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? _normalizeMeta(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function _save(patch = {}) {
    try {
      const prev = _load() || _emptyMeta();
      const next = {
        ...prev,
        ...patch,
        version: 2,
        ai: { ...prev.ai, ...(patch.ai || {}) },
        storage: { ...prev.storage, ...(patch.storage || {}) },
        target: { ...prev.target, ...(patch.target || {}) },
        rooms: patch.rooms ? { ...prev.rooms, ...patch.rooms } : { ...prev.rooms },
        savedAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    } catch {
      return null;
    }
  }

  function _currentSavedPath() {
    if (typeof _chatState === 'undefined' || !_chatState?.sessionId) return '';
    if (typeof _chatSavedPathForSession === 'function') return _chatSavedPathForSession(_chatState.sessionId);
    return '_chat/llm/' + _chatState.sessionId + '.md';
  }

  function _currentStorage() {
    return {
      workspaceId: typeof _chatWorkspaceIdValue === 'function'
        ? String(_chatWorkspaceIdValue() || '')
        : (typeof _chatState !== 'undefined' ? String(_chatState?.workspaceId || '') : ''),
      sourceFolder: typeof _chatSourceFolderValue === 'function'
        ? String(_chatSourceFolderValue() || '')
        : (typeof _chatState !== 'undefined' ? String(_chatState?.sourceFolder || '') : ''),
    };
  }

  function _currentTarget() {
    if (window.MeldexChatCurrentTarget?.snapshot) {
      return window.MeldexChatCurrentTarget.snapshot();
    }
    const path = typeof _chatState !== 'undefined' ? String(_chatState?.targetPath || '') : '';
    return { mode: path ? 'manual' : 'follow-main', path, kind: '' };
  }

  function _currentHistoryView() {
    try {
      return localStorage.getItem('chat-history-view') === 'cli' ? 'cli' : 'saved';
    } catch {
      return 'saved';
    }
  }

  function _saveMode(mode) {
    const normalized = VALID_MODES.has(String(mode || '')) ? String(mode) : 'team';
    return _save({
      mode: normalized,
      historyView: _currentHistoryView(),
      ai: { savedPath: normalized === 'llm' ? _currentSavedPath() : (_load()?.ai?.savedPath || '') },
      storage: _currentStorage(),
      target: _currentTarget(),
    });
  }

  function _saveCurrentLlmRestore() {
    return _save({
      mode: 'llm',
      ai: { savedPath: _currentSavedPath() },
      storage: _currentStorage(),
      target: _currentTarget(),
    });
  }

  function _saveRoom(roomPath) {
    const storage = _currentStorage();
    const scope = _scopeKey(storage);
    const rooms = scope ? { [scope]: String(roomPath || '') } : {};
    return _save({ mode: 'team', storage, rooms, target: _currentTarget() });
  }

  function saveTargetState(snapshot) {
    if (_restorePending && !_restoreApplying) _cancelRestoreForUserAction();
    const rawMode = String(snapshot?.mode || '');
    const mode = VALID_TARGET_MODES.has(rawMode) ? rawMode : 'follow-main';
    return _save({
      target: {
        mode,
        path: mode === 'detached' ? '' : _cleanPath(snapshot?.path || ''),
        kind: mode === 'detached' ? '' : String(snapshot?.kind || ''),
      },
    });
  }

  function saveStorageState() {
    return _save({ storage: _currentStorage() });
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

  function _savedPathWasRestored(savedPath) {
    return !!savedPath && _cleanPath(_currentSavedPath()) === _cleanPath(savedPath);
  }

  function _sourceValue(storage) {
    const workspaceId = String(storage?.workspaceId || '');
    return workspaceId ? 'workspace:' + workspaceId : String(storage?.sourceFolder || '');
  }

  function _roomForCurrentScope(meta) {
    return String(meta?.rooms?.[_scopeKey(_currentStorage())] || '');
  }

  function _roomExists(roomPath) {
    return !!roomPath && Array.isArray(_teamRoomsCache)
      && _teamRoomsCache.some(room => String(room?.path || '') === roomPath);
  }

  async function _restoreTeam(token, meta) {
    if (!await _runRestoreStep(token, () => switchChatMode('team'))) return;
    if (!await _runRestoreStep(token, () => typeof loadTeamRooms === 'function' ? loadTeamRooms() : undefined)) return;
    const roomPath = _roomForCurrentScope(meta);
    if (_roomExists(roomPath) && typeof selectTeamRoom === 'function') {
      await _runRestoreStep(token, () => selectTeamRoom(roomPath));
      return;
    }
    if (roomPath) _saveRoom('');
    if (typeof _clearTeamRoomSelection === 'function') {
      await _runRestoreStep(token, () => _clearTeamRoomSelection());
    }
  }

  async function _restoreLlm(token, meta) {
    if (!await _runRestoreStep(token, () => switchChatMode('llm'))) return;
    if (_llmContentRestored) return;
    const savedPath = String(meta?.ai?.savedPath || '');
    if (savedPath && typeof openSavedChat === 'function') {
      if (!await _runRestoreStep(token, () => openSavedChat(savedPath, '', _currentStorage().sourceFolder))) return;
      if (window.MeldexChatCurrentTarget?.restore) {
        if (!await _runRestoreStep(token, () => window.MeldexChatCurrentTarget.restore(meta.target))) return;
      }
    }
    _llmContentRestored = !savedPath || _savedPathWasRestored(savedPath);
  }

  function restoreOnOpen() {
    if (_restorePending) return true;
    if (isRestoreSuspended()) return false;
    const meta = _load();
    if (!meta?.mode || typeof switchChatMode !== 'function') return false;
    const token = ++_restoreGeneration;
    _restorePending = true;
    _suspendCount++;
    Promise.resolve().then(async () => {
      const sourceValue = _sourceValue(meta.storage);
      const currentSourceValue = _sourceValue(_currentStorage());
      if (sourceValue && sourceValue !== currentSourceValue && typeof _setChatSourceFolder === 'function') {
        if (!await _runRestoreStep(token, () => _setChatSourceFolder(sourceValue, { skipSave: true }))) return;
      }
      if (window.MeldexChatCurrentTarget?.restore) {
        if (!await _runRestoreStep(token, () => window.MeldexChatCurrentTarget.restore(meta.target))) return;
      }
      if (meta.mode === 'history') {
        if (!await _runRestoreStep(token, () => switchChatMode('history'))) return;
        if (typeof switchChatHistoryView === 'function') {
          await _runRestoreStep(token, () => switchChatHistoryView(meta.historyView));
        }
        return;
      }
      if (meta.mode === 'team') {
        await _restoreTeam(token, meta);
        return;
      }
      await _restoreLlm(token, meta);
    }).catch(error => {
      console.warn('[ChatRestore] チャット状態の復元に失敗しました', error);
    }).finally(() => {
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

  _patch('openSavedChat', original => async function() {
    _cancelRestoreForUserAction();
    const result = await _withSuspendedRestoreAsync(() => original.apply(this, arguments));
    if (!isRestoreSuspended()) _saveCurrentLlmRestore();
    return result;
  });

  _patch('openFileChat', original => async function() {
    _cancelRestoreForUserAction();
    const result = await _withSuspendedRestoreAsync(() => original.apply(this, arguments));
    if (!isRestoreSuspended()) _saveCurrentLlmRestore();
    return result;
  });

  _patch('chatAutoSave', original => async function() {
    const result = await original.apply(this, arguments);
    if (result !== false) _saveCurrentLlmRestore();
    return result;
  });

  _patch('chatClear', original => function() {
    _cancelRestoreForUserAction();
    const result = original.apply(this, arguments);
    _save({ mode: 'llm', ai: { savedPath: '' }, storage: _currentStorage(), target: _currentTarget() });
    return result;
  });

  _patch('_setChatSourceFolder', original => async function() {
    _cancelRestoreForUserAction();
    const result = await original.apply(this, arguments);
    if (result !== false && !isRestoreSuspended()) saveStorageState();
    return result;
  });

  _patch('selectTeamRoom', original => async function(roomPath) {
    _cancelRestoreForUserAction();
    const result = await original.apply(this, arguments);
    if (!isRestoreSuspended()) _saveRoom(roomPath);
    return result;
  });

  _patch('switchChatMode', original => function(mode) {
    _cancelRestoreForUserAction();
    const result = original.apply(this, arguments);
    if (!isRestoreSuspended()) _saveMode(mode === 'cli' ? 'history' : mode);
    return result;
  });

  _patch('switchChatHistoryView', original => function(view) {
    _cancelRestoreForUserAction();
    const result = original.apply(this, arguments);
    if (!isRestoreSuspended()) _save({ mode: 'history', historyView: view === 'cli' ? 'cli' : 'saved' });
    return result;
  });

  window.GBChatRestore = {
    restoreOnOpen,
    isRestoreSuspended,
    restoreGuard: _restoreGuard,
    runInternal: _runRestoreInternal,
    saveTargetState,
    saveStorageState,
  };
})();
