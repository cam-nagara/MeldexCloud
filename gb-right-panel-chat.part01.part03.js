  if (!sendBtn || _chatState.streaming) return;
  const status = await _chatProviderReadyStatus(provider);
  if (refreshToken !== _chatState.apiKeyRefreshToken || provider !== _chatProviderKey(_chatState.provider)) return;
  const configured = typeof _chatProviderStatusConfigured === 'function' ? _chatProviderStatusConfigured(status) : !!status.configured;
  sendBtn.disabled = !configured;
  sendBtn.title = configured ? '送信 (Enter)' : (status.message || '送信設定を確認してください。');
  if (typeof _chatRefreshProviderAvailability === 'function') {
    _chatRefreshProviderAvailability({ [provider]: status }).catch(() => {});
  }
}

function _chatSafeUserSegment() {
  const raw = (typeof getUsername === 'function' ? getUsername() : '') || 'anonymous';
  return String(raw).trim().replace(/[\\/:*?"<>|]/g, '_') || 'anonymous';
}

function _chatSavedPathForSession(sessionId) {
  if (!sessionId) return '';
  return '_chat/llm/' + _chatSafeUserSegment() + '/' + sessionId + '.md';
}

function _newChatMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return 'msg_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return 'msg_' + Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

function _chatLocalTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('');
}

function _chatFormatMessageTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(' ', 'T');
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = part => String(part).padStart(2, '0');
    return `${parsed.getFullYear()}/${pad(parsed.getMonth() + 1)}/${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  }
  const compact = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2})[:\-](\d{1,2}))?/);
  if (!compact) return '';
  const pad = part => String(part).padStart(2, '0');
  return `${compact[1]}/${pad(compact[2])}/${pad(compact[3])} ${pad(compact[4] || '0')}:${pad(compact[5] || '0')}`;
}

function _chatFormatHistoryModifiedTimestamp(value) {
  if (value == null || value === '') return '';
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
    return _chatFormatMessageTimestamp(new Date(milliseconds).toISOString());
  }
  return _chatFormatMessageTimestamp(value);
}

function _ensureChatMessageId(message) {
  if (!message || typeof message !== 'object') return _newChatMessageId();
  if (!message.msg_id) message.msg_id = _newChatMessageId();
  return message.msg_id;
}

function _ensureChatMessageIds(messages) {
  (messages || []).forEach(message => _ensureChatMessageId(message));
  return messages || [];
}

function _chatResetCurrentSession(options = {}) {
  if (typeof _chatBumpSessionGen === 'function') _chatBumpSessionGen();
  _chatState.messages = [];
  _chatState.sessionId = '';
  _chatState.targetPath = options.keepTargetPath ? (_chatState.targetPath || '') : '';
  _chatState.lastImplicitTargetPath = options.keepTargetPath ? (_chatState.lastImplicitTargetPath || '') : '';
  if (typeof _chatClearPendingAttachments === 'function') {
    _chatClearPendingAttachments({ cleanupUploads: options.cleanupUploads !== false });
  } else {
    _chatState.pendingAttachments = [];
  }
  if (typeof _chatClearQueuedMessages === 'function') _chatClearQueuedMessages();
  if (typeof _renderChatAttachments === 'function') _renderChatAttachments();
  _setChatSessionTitle('');
  const container = _chatLiveMessagesContainer();
  if (container) container.innerHTML = '';
  _showChatTargetBadge(typeof _chatEffectiveTargetPath === 'function' ? _chatEffectiveTargetPath() : _chatState.targetPath);
}

function _chatAddSourceOption(options, seen, option) {
  const value = String(option?.value || '');
  const normalized = _chatNormalizePath(value || option?.path || '');
  if (normalized && seen.has(normalized)) return;
  if (normalized) seen.add(normalized);
  options.push(option);
}

function _chatFindSourceOption(value, options) {
  const raw = String(value || '');
  if (!raw) return null;
  if (raw.startsWith('workspace:')) return (options || []).find(item => String(item.value || '') === raw) || null;
  const normalized = _chatNormalizePath(raw);
  return (options || []).find(item => _chatNormalizePath(item.value) === normalized) || null;
}

function _chatWorkspaceOptionValue(workspaceId) {
  return workspaceId ? 'workspace:' + String(workspaceId) : '';
}

function _chatTargetSelectorValue() {
  return _chatState.workspaceId ? _chatWorkspaceOptionValue(_chatState.workspaceId) : _chatSourceFolderValue();
}

function _chatApplySourceContextValue(sourceValue, options = {}) {
  const rawNext = String(sourceValue || '');
  const nextWorkspaceId = rawNext.startsWith('workspace:') ? rawNext.slice('workspace:'.length) : '';
  const next = nextWorkspaceId ? '' : rawNext;
  _chatState.workspaceId = nextWorkspaceId;
  _chatState.sourceFolder = next;
  if (options.persist !== false) {
    if (nextWorkspaceId) {
      localStorage.setItem(_CHAT_WORKSPACE_STORAGE_KEY, nextWorkspaceId);
      localStorage.removeItem(_CHAT_SOURCE_FOLDER_STORAGE_KEY);
    } else {
      localStorage.removeItem(_CHAT_WORKSPACE_STORAGE_KEY);
      if (next) localStorage.setItem(_CHAT_SOURCE_FOLDER_STORAGE_KEY, next);
      else localStorage.removeItem(_CHAT_SOURCE_FOLDER_STORAGE_KEY);
    }
  }
  if (options.syncWorkspace !== false && nextWorkspaceId) {
    window.MeldexWorkspaces?.setActiveId?.(nextWorkspaceId, { reason: options.reason || 'chat' });
  }
  _syncChatSourceFolderUi();
  _refreshChatDebugAvailability();
}

function _chatSourceOptions() {
  const options = [];
  const seen = new Set();
  (_chatWorkspacesCache || []).forEach(workspace => {
    if (!workspace || !workspace.id) return;
    _chatAddSourceOption(options, seen, {
      value: _chatWorkspaceOptionValue(workspace.id),
      label: 'ワークスペース: ' + (workspace.name || 'ワークスペース'),
      kind: 'workspace',
      workspaceId: workspace.id,
      path: workspace.folder || '',
    });
  });
  const homePath = String(_chatVaultInfo?.path || (_chatVaultsCache || [])[0]?.path || '').trim();
  if (homePath) {
    _chatAddSourceOption(options, seen, {
      value: homePath,
      label: 'ホームフォルダ',
      kind: 'home',
      path: homePath,
    });
  }
  (_chatSourceFoldersCache || []).forEach(root => {
    if (!root || !root.path) return;
    // ワークスペース由来のルートは「ワークスペース: ○○」の選択肢が別途あるため、ソースとして重複表示しない
    if (root.kind === 'workspace' || root.workspaceId) return;
    _chatAddSourceOption(options, seen, {
      value: root.path,
      label: 'ソース: ' + (root.name || root.path.split(/[\\/]/).pop() || root.path),
      kind: 'source',
      path: root.path,
    });
  });
  (_chatVaultsCache || []).forEach(vault => {
    if (!vault || !vault.path) return;
    _chatAddSourceOption(options, seen, {
      value: vault.path,
      label: 'ソース: ' + (vault.name || vault.path.split(/[\\/]/).pop() || vault.path),
      kind: 'source',
      path: vault.path,
    });
  });
  return options;
}

function _syncChatSourceFolderUi() {
  const select = document.getElementById('chat-source-folder');
  const badge = document.getElementById('chat-source-badge');
  const selected = _chatFindSourceOption(_chatTargetSelectorValue(), _chatSourceOptions());
  const hasSource = !!(_chatWorkspaceIdValue() || _chatSourceFolderValue());
  if (select) {
    select.value = _chatTargetSelectorValue();
    select.disabled = !!_chatState.streaming || !_chatSourceOptions().length;
  }
  if (badge) {
    badge.textContent = hasSource && selected ? '対象' : '未選択';
    badge.style.color = hasSource && selected ? 'var(--green, #4ec9b0)' : 'var(--fg2)';
    badge.style.background = hasSource && selected ? 'rgba(78,201,176,0.12)' : 'var(--bg2)';
    badge.style.border = '1px solid ' + (hasSource && selected ? 'var(--green, #4ec9b0)' : 'var(--border)');
  }
  if (typeof _chatRefreshCurrentTargetDisplay === 'function') _chatRefreshCurrentTargetDisplay();
  if (typeof _chatSyncStreamingControls === 'function') _chatSyncStreamingControls();
}

function _chatSyncStreamingControls() {
  const sendBtn = document.getElementById('chat-send-btn');
  if (!sendBtn || !_chatState.streaming) return;
  const isCli = typeof _chatIsCliProvider === 'function' && _chatIsCliProvider(_chatState.streamingProvider || _chatState.provider);
  sendBtn.textContent = '停止';
  sendBtn.title = isCli ? 'CLIの実行を停止' : '応答生成を停止';
  sendBtn.disabled = false;
}

async function _refreshChatDebugAvailability() {
  const el = document.getElementById('chat-debug-available');
  if (!el) return;
  try {
    const data = await apiFetch(_chatApiPath('/settings-db/debug-report/exists'), { silentError: true });
    el.style.display = data?.exists ? 'inline-flex' : 'none';
  } catch {
    el.style.display = 'none';
  }
}

async function _initChatSourceFolderSelector() {
  const select = document.getElementById('chat-source-folder');
  try { _chatVaultInfo = await apiFetch('/vault', { silentError: true }); } catch { _chatVaultInfo = { path: '', name: '' }; }
  try {
    const vaultsPayload = await apiFetch('/vaults', { silentError: true });
    _chatVaultsCache = Array.isArray(vaultsPayload?.vaults) ? vaultsPayload.vaults : [];
  } catch {
    _chatVaultsCache = [];
  }
  try { _chatSourceFoldersCache = await apiFetch('/outliner-roots', { silentError: true }); } catch { _chatSourceFoldersCache = []; }
  try {
    const workspacesPayload = await apiFetch('/workspaces', { silentError: true });
    _chatWorkspacesCache = Array.isArray(workspacesPayload?.workspaces) ? workspacesPayload.workspaces : [];
  } catch {
    _chatWorkspacesCache = [];
  }
  if (window.MeldexWorkspaces?.getActiveId && !_chatState.workspaceId) {
    _chatState.workspaceId = window.MeldexWorkspaces.getActiveId() || '';
  }
  let options = _chatSourceOptions();
  let selected = _chatFindSourceOption(_chatTargetSelectorValue(), options);
  if (!selected && !_chatState.sourceFolder && !_chatState.workspaceId) selected = options.find(item => item.kind === 'home') || options.find(item => item.kind === 'workspace') || null;
  if (!selected && _chatState.sourceFolder) {
    const preserved = String(_chatState.sourceFolder || '');
    options = options.concat([{
      value: preserved,
      label: 'ソース: ' + (preserved.split(/[\\/]/).pop() || preserved),
      kind: 'source',
      path: preserved,
      preserved: true,
    }]);
    selected = _chatFindSourceOption(preserved, options);
  }
  if (select) {
    const placeholder = options.length
      ? '<option value="" disabled>対象を選択</option>'
      : '<option value="" disabled>対象がありません</option>';
    select.innerHTML = placeholder + options.map(item => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('');
  }
  if (selected) {
    _chatApplySourceContextValue(selected.kind === 'workspace' ? _chatWorkspaceOptionValue(selected.workspaceId || '') : selected.value, { reason: 'chat-init' });
  } else {
    _chatApplySourceContextValue('', { reason: 'chat-init' });
  }
  _syncChatSourceFolderUi();
  _refreshChatDebugAvailability();
}

function _detectSourceFolderFromPath(targetPath) {
  const raw = _chatNormalizePath(targetPath);
  if (!raw) return '';
  let best = '';
  let bestLength = 0;
  _chatSourceOptions().forEach(option => {
    const rootPath = _chatNormalizePath(option?.path || option?.value);
    if (!rootPath) return;
    if (raw === rootPath || raw.startsWith(rootPath + '/')) {
      if (rootPath.length > bestLength) {
        best = option.kind === 'workspace' ? option.value : (option.path || option.value);
        bestLength = rootPath.length;
      }
    }
  });
  return best;
}

async function _setChatSourceFolder(sourceFolder, options = {}) {
  const rawNext = String(sourceFolder || '');
  const nextWorkspaceId = rawNext.startsWith('workspace:') ? rawNext.slice('workspace:'.length) : '';
  const next = nextWorkspaceId ? '' : rawNext;
  if (next === _chatSourceFolderValue() && nextWorkspaceId === _chatWorkspaceIdValue() && !options.force) {
    _syncChatSourceFolderUi();
    return true;
  }
  if (_chatState.streaming) {
    _syncChatSourceFolderUi();
    if (typeof showStatus === 'function') showStatus('応答生成中は対象を切り替えられません', true);
    return false;
  }
  if (!options.skipSave && _chatState.messages.length > 0) {
    const saved = await chatAutoSave({ silent: false }).catch(error => {
      if (typeof showStatus === 'function') showStatus('現在のチャット保存に失敗: ' + (error?.message || error), true);
      return false;
    });
    if (!saved) {
      _syncChatSourceFolderUi();
      return false;
    }
  }
  _chatApplySourceContextValue(rawNext, { reason: 'chat' });
  _chatResetCurrentSession();
  _teamCurrentRoom = '';
  _teamLastTimestamp = '';
  if (typeof _teamClearPendingAttachments === 'function') {
    _teamClearPendingAttachments({ cleanupUploads: true });
  } else {
    _teamPendingAttachments = [];
  }
  _clearTeamRoomSelection();
  _syncChatSourceFolderUi();
  _refreshChatDebugAvailability();
  if (_chatMode === 'team') await loadTeamRooms();
  if (_chatMode === 'history') await renderChatHistory();
  return true;
}

(function _bindChatSourceFolderSelector() {
  const run = () => {
    _initChatSourceFolderSelector();
    const select = document.getElementById('chat-source-folder');
    if (!select || select._chatSourceFolderBound) return;
    select._chatSourceFolderBound = true;
    select.addEventListener('change', () => _setChatSourceFolder(select.value));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

function _chatCloneMessages(messages) {
  const source = Array.isArray(messages) ? messages : [];
  try {
    return JSON.parse(JSON.stringify(source));
  } catch {
    return source.map(message => {
      if (!message || typeof message !== 'object') return message;
      const clone = { ...message };
      if (Array.isArray(message.content)) {
        clone.content = message.content.map(part => (part && typeof part === 'object') ? { ...part } : part);
      }
      return clone;
    });
  }
}

function _chatMessageRenderOptions(message, index) {
  const options = (message && typeof message === 'object') ? { ...message } : {};
  options.messageIndex = index;
  options.msg_id = _ensureChatMessageId(options);
  return options;
}

function _chatRenderQueuedMessageBubbles() {
  if (!_chatQueueScopeMatchesCurrent()) return;
  const queue = Array.isArray(_chatState.queuedMessages) ? _chatState.queuedMessages : [];
  queue.forEach((message, offset) => {
    if (!message || message.role !== 'user') return;
    const messageId = _ensureChatMessageId(message);
    chatAddMessage('user', message.content, {
      messageIndex: _chatState.messages.length + offset,
      msg_id: messageId,
      queuedMessageId: messageId,
      timestamp: message.timestamp || '',
      queued_for_next_response: true,
    });
  });
}

function _chatRenderStoredMessages() {
  const container = _chatLiveMessagesContainer();
  if (!container) return;
  container.innerHTML = '';
  _ensureChatMessageIds(_chatState.messages).forEach((message, index) => {
    if (!message || typeof message !== 'object') return;
    chatAddMessage(message.role || 'assistant', message.content, _chatMessageRenderOptions(message, index));
  });
  _chatRenderQueuedMessageBubbles();
  window.GBChatCliRestoreActivity?.();
}

function _chatApplyCompression(data, options = {}) {
  const messages = Array.isArray(options.messages) ? options.messages : _chatState.messages;
  if (!data || !data.summary_message || !Array.isArray(messages)) return;
  const oldCount = Number(data.original_count || data.summary_message.original_message_count || 0);
  const keepTail = Math.max(0, messages.length - oldCount);
  if (oldCount <= 0 || keepTail < 0) return;
  const oldMessages = _chatCloneMessages(messages.slice(0, oldCount)).map(message => ({ ...message, compressed: true }));
  const tail = _chatCloneMessages(messages.slice(oldCount));
  const summary = {
    ...data.summary_message,
    role: 'assistant',
    compressed_summary: true,
    original_message_count: oldMessages.length,
    original_messages: oldMessages,
    msg_id: data.summary_message.msg_id || ('summary_' + Date.now().toString(36)),
  };
  messages.splice(0, messages.length, summary, ...tail);
  if (messages === _chatState.messages && options.render !== false) {
    _chatRenderStoredMessages();
    chatAddSystem(`古い会話 ${oldMessages.length} 件を要約して圧縮しました`);
  }
}

function _chatHistoryScope() {
  const storageScope = _chatWorkspaceIdValue() ? ('workspace:' + _chatWorkspaceIdValue()) : (_chatSourceFolderValue() || 'personal');
  const key = storageScope + ':' + (_chatState.sessionId || _chatState.targetPath || 'llm');
  return 'chat:' + key;
}

function _chatSessionScopeSnapshot() {
  return {
    messages: _chatState.messages,
    sessionId: String(_chatState.sessionId || ''),
    targetPath: String(typeof _chatEffectiveTargetPath === 'function' ? (_chatEffectiveTargetPath() || '') : (_chatState.currentTargetPath || _chatState.targetPath || _chatState.lastImplicitTargetPath || '')),
    workspaceId: typeof _chatWorkspaceIdValue === 'function' ? String(_chatWorkspaceIdValue() || '') : String(_chatState.workspaceId || ''),
    sourceFolder: typeof _chatSourceFolderValue === 'function' ? String(_chatSourceFolderValue() || '') : String(_chatState.sourceFolder || ''),
    mode: typeof _chatMode === 'undefined' ? '' : String(_chatMode || ''),
  };
}

function _chatSessionScopeMatches(scope) {
  if (!scope) return true;
  const current = _chatSessionScopeSnapshot();
  if (String(scope.mode || '') !== String(current.mode || '')) return false;
  if (String(scope.workspaceId || '') !== String(current.workspaceId || '')) return false;
  if (String(scope.sourceFolder || '') !== String(current.sourceFolder || '')) return false;
  if (String(scope.targetPath || '') !== String(current.targetPath || '')) return false;
  const scopeSession = String(scope.sessionId || '');
  const currentSession = String(current.sessionId || '');
  if (scopeSession || currentSession) return scopeSession === currentSession;
  return !scope.messages || scope.messages === current.messages;
}

function _chatRemoveQueuedMessage(msgId) {
  const id = String(msgId || '').trim();
  if (!id) return false;
  const queue = _chatQueuedMessages();
  const index = queue.findIndex(message => String(message?.msg_id || '') === id);
  if (index < 0) return false;
  queue.splice(index, 1);
  if (!queue.length) _chatState.queuedScope = null;
  const row = Array.from(document.querySelectorAll('#chat-messages .chat-message-row'))
    .find(el => String(el.dataset.msgId || '') === id);
  if (row) row.remove();
  else if (!_chatState.streaming) _chatRenderStoredMessages();
  if (typeof showStatus === 'function') showStatus('保留メッセージを取り消しました');
  return true;
}
window._chatRemoveQueuedMessage = _chatRemoveQueuedMessage;

function _chatRefreshMessageDeleteButtons() {
  const container = _chatLiveMessagesContainer();
  if (!container) return;
  container.querySelectorAll('[data-chat-delete-index]').forEach(btn => {
    btn.disabled = !!_chatState.streaming;
    btn.style.cursor = btn.disabled ? 'default' : 'pointer';
  });
  container.querySelectorAll('[data-chat-regenerate-index], [data-chat-edit-index]').forEach(btn => {
    btn.disabled = !!_chatState.streaming;
    btn.style.cursor = btn.disabled ? 'default' : 'pointer';
  });
  container.querySelectorAll('[data-chat-queued-cancel-id]').forEach(btn => {
    btn.disabled = !!_chatState.queuedSendRunning;
    btn.style.cursor = btn.disabled ? 'default' : 'pointer';
  });
}

async function _chatApplyMessagesSnapshot(messages, options = {}) {
  if (options.scope && !_chatSessionScopeMatches(options.scope)) {
    if (typeof showStatus === 'function') showStatus('別チャットの履歴操作は適用できません', true);
    return false;
  }
  const previous = _chatCloneMessages(_chatState.messages);
  _chatState.messages = _chatCloneMessages(messages);
  _chatRenderStoredMessages();
  if (options.save === false) return true;
  const shouldSave = _chatState.sessionId || _chatState.messages.length > 0;
  if (!shouldSave) {
    if (typeof renderChatHistory === 'function') renderChatHistory();
    return false;
  }
  try {
    await chatAutoSave({ silent: false, allowEmpty: true });
    if (typeof renderChatHistory === 'function') renderChatHistory();
    return true;
  } catch (e) {
    _chatState.messages = previous;
    _chatRenderStoredMessages();
    throw e;
  }
}

async function chatDeleteMessage(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= _chatState.messages.length) return;
  if (_chatState.streaming) {
    if (typeof showStatus === 'function') showStatus('応答生成中はメッセージを削除できません', true);
    return;
  }
  const message = _chatState.messages[idx] || {};
  const previewText = _chatContentToText(message.content || '').trim().replace(/\s+/g, ' ');
  const preview = previewText.length > 40 ? previewText.substring(0, 40) + '...' : previewText;
  if (typeof cfConfirm === 'function') {
    const ok = await cfConfirm('このメッセージを削除しますか？' + (preview ? '\n\n' + preview : ''));
    if (!ok) return;
  }

  const operationScope = _chatSessionScopeSnapshot();
  const beforeMessages = _chatCloneMessages(_chatState.messages);
  const afterMessages = _chatCloneMessages(_chatState.messages);
  afterMessages.splice(idx, 1);

  try {
    await _chatApplyMessagesSnapshot(afterMessages, { scope: operationScope });
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('メッセージ削除の保存に失敗: ' + (e?.message || e), true);
    return;
  }

  if (typeof historyPush === 'function') {
    const scope = _chatHistoryScope();
    if (typeof historySetScope === 'function') historySetScope(scope);
    historyPush(
      'チャット: メッセージ削除',
      () => _chatApplyMessagesSnapshot(beforeMessages, { scope: operationScope }),
      () => _chatApplyMessagesSnapshot(afterMessages, { scope: operationScope }),
      scope,
      preview || ''
    );
  }
  if (typeof showStatus === 'function') showStatus('メッセージを削除しました');
}

function _chatFindPreviousUserIndex(index) {
  const start = Math.min(Number(index) || 0, _chatState.messages.length - 1);
  for (let i = start; i >= 0; i--) {
    if (_chatState.messages[i]?.role === 'user') return i;
  }
  return -1;
}

async function _chatReplayFromUserMessage(userIndex, content, historyLabel) {
  if (_chatState.streaming) {
    if (typeof showStatus === 'function') showStatus('応答生成中は操作できません', true);
    return;
  }
  const idx = Number(userIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= _chatState.messages.length) return;
  const operationScope = _chatSessionScopeSnapshot();
  const beforeMessages = _chatCloneMessages(_chatState.messages);
  const input = document.getElementById('chat-input');
  const replayText = String(content ?? _chatContentToText(_chatState.messages[idx]?.content || '')).trim();
  if (!replayText) return;
  _chatState.messages = _chatCloneMessages(_chatState.messages.slice(0, idx));
  _chatRenderStoredMessages();
  if (input) {
    input.value = replayText;
    if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
  }
  const sent = await chatSend({ replay: true });
  if (!sent) {
    _chatState.messages = beforeMessages;
    _chatRenderStoredMessages();
    if (input) {
      input.value = replayText;
      if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
    }
    return;
  }
  const afterMessages = _chatCloneMessages(_chatState.messages);
  if (typeof historyPush === 'function') {
    const scope = _chatHistoryScope();
    if (typeof historySetScope === 'function') historySetScope(scope);
    historyPush(
      historyLabel || 'チャット: 再送',
      () => _chatApplyMessagesSnapshot(beforeMessages, { scope: operationScope }),
      () => _chatApplyMessagesSnapshot(afterMessages, { scope: operationScope }),
      scope,
      replayText.substring(0, 80)
    );
  }
}

async function chatRegenerateMessage(index) {
  const assistantIndex = Number(index);
  if (!Number.isInteger(assistantIndex) || assistantIndex < 0 || assistantIndex >= _chatState.messages.length) return;
  const userIndex = _chatFindPreviousUserIndex(assistantIndex);
  if (userIndex < 0) return;
  await _chatReplayFromUserMessage(userIndex, _chatContentToText(_chatState.messages[userIndex]?.content || ''), 'チャット: 再生成');
}

function chatEditUserMessage(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= _chatState.messages.length) return;
  if (_chatState.streaming) {
    if (typeof showStatus === 'function') showStatus('応答生成中は編集できません', true);
    return;
  }
  const wrapper = document.querySelector(`#chat-messages [data-chat-message-index="${idx}"]`);
  const bubble = wrapper?.querySelector('.chat-message-bubble');
  if (!bubble || bubble.querySelector('textarea')) return;
  const original = _chatContentToText(_chatState.messages[idx]?.content || '');
  const bubbleWidth = Math.ceil(bubble.getBoundingClientRect?.().width || 0);
  if (bubbleWidth > 0) bubble.style.width = bubbleWidth + 'px';
  bubble.style.maxWidth = '100%';
  bubble.style.boxSizing = 'border-box';
  bubble.style.whiteSpace = 'normal';
  const textarea = document.createElement('textarea');
  textarea.className = 'chat-message-edit-textarea';
  textarea.value = original;
  textarea.rows = Math.min(10, Math.max(3, original.split('\n').length + 1));
  textarea.style.cssText = 'display:block;width:100%;min-width:0;box-sizing:border-box;background:rgba(255,255,255,0.08);color:inherit;border:1px solid rgba(255,255,255,0.35);border-radius:6px;padding:6px;font:inherit;resize:vertical;';
  const actions = document.createElement('div');
  actions.className = 'chat-message-edit-actions';
  actions.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin-top:6px;flex-wrap:wrap;';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'chat-message-edit-cancel';
  cancel.textContent = 'キャンセル';
  cancel.style.cssText = 'font-size:11px;padding:2px 8px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.35);border-radius:4px;cursor:pointer;';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'chat-message-edit-save';
  save.textContent = '保存して再送';
  save.style.cssText = 'font-size:11px;padding:2px 8px;background:rgba(255,255,255,0.18);color:inherit;border:1px solid rgba(255,255,255,0.45);border-radius:4px;cursor:pointer;';
  actions.append(cancel, save);
  bubble.innerHTML = '';
  bubble.append(textarea, actions);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  const restore = () => _chatRenderStoredMessages();
  cancel.addEventListener('click', restore);
  save.addEventListener('click', () => {
    const next = textarea.value.trim();
    if (!next) {
      restore();
      return;
    }
    _chatReplayFromUserMessage(idx, next, 'チャット: ユーザー発言編集');
  });
  textarea.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      restore();
    } else if (event.key === 'Enter' && !event.shiftKey && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      save.click();
    }
  });
}

function chatAddMessage(role, content, options = {}) {
  const container = _chatLiveMessagesContainer();
  if (!container) return null;
  container.querySelectorAll('.chat-empty-placeholder').forEach(el => el.remove());
  const isUser = role === 'user';
  const shouldScrollAfterAppend = _chatShouldStickToBottom(container, options?.forceScroll === true || (isUser && options?.forceScroll !== false));
  const isQueued = !!options?.queued_for_next_response;
  const plainContent = _chatContentToText(content);
  const provider = options?.provider || _chatState.provider;
  const model = options?.model || _chatState.model;
  const name = isUser ? getUsername() : getProviderLabel(provider, model);
  const icon = isUser ? getUserAvatarHtml(getUsername(), 18) : getProviderIconHtml(provider, 18);

  // ラッパー（名前+アイコン+バブル）
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-message-row chat-message-row-llm chat-copy-message' + (isUser ? ' is-user' : ' is-assistant');
  const msgId = options?.msg_id || options?.msgId || '';
  if (msgId) wrapper.dataset.msgId = msgId;
  if (Number.isInteger(options?.messageIndex)) wrapper.dataset.chatMessageIndex = String(options.messageIndex);
  if (options?.error_code === 'cli_auth_required') wrapper.dataset.cliAuthProvider = String(provider || '');
  wrapper.style.cssText = isUser
    ? 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;max-width:85%;align-self:flex-end;'
    : 'display:flex;flex-direction:column;align-items:flex-start;gap:2px;max-width:85%;align-self:flex-start;';

  // ヘッダー（アイコン+名前）
  const header = document.createElement('div');
  header.className = 'chat-message-header';
  header.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg2);padding:0 4px;';
  header.innerHTML = icon;
  const nameEl = document.createElement('span');
  nameEl.className = 'chat-message-author';
  nameEl.textContent = name;
  header.appendChild(nameEl);
  if (!isUser && options?.compressed_summary) {
    const summaryBadge = document.createElement('span');
    summaryBadge.className = 'chat-summary-badge';
    summaryBadge.textContent = '要約';
    summaryBadge.title = `自動圧縮された過去の会話要約（元発言 ${Number(options.original_message_count || 0)} 件）`;
    summaryBadge.style.cssText = 'display:inline-flex;align-items:center;height:16px;padding:0 6px;border:1px solid var(--border);border-radius:999px;font-size:10px;color:var(--fg2);background:var(--bg2);';
    header.appendChild(summaryBadge);
  }
  const timestampLabel = _chatFormatMessageTimestamp(options?.timestamp || options?.created_at || options?.createdAt || options?.time);
  wrapper.dataset.chatCopyAuthor = name;
  wrapper.dataset.chatCopyTime = timestampLabel;
  if (timestampLabel) {
    const timeEl = document.createElement('span');
    timeEl.className = 'chat-message-time';
    timeEl.textContent = timestampLabel;
    timeEl.title = String(options?.timestamp || options?.created_at || options?.createdAt || options?.time || '');
    timeEl.style.cssText = 'opacity:0.72;font-variant-numeric:tabular-nums;';
    header.appendChild(timeEl);
  }
  if (isQueued && isUser) {
    const badge = document.createElement('span');
    badge.className = 'chat-queued-badge';
    badge.textContent = '保留';
    badge.title = '応答完了後に送信されます';
    badge.style.cssText = 'display:inline-flex;align-items:center;height:16px;padding:0 6px;border:1px solid var(--border);border-radius:999px;font-size:10px;color:var(--fg2);background:var(--bg2);';
    header.appendChild(badge);
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.title = '保留を取り消す';
    cancelBtn.setAttribute('aria-label', '保留を取り消す');
    cancelBtn.disabled = !!_chatState.queuedSendRunning;
    cancelBtn.dataset.chatQueuedCancelId = String(options?.queuedMessageId || msgId || '');
    cancelBtn.dataset.e2eId = 'chat-message-queued-cancel-' + (options?.queuedMessageId || msgId || 'unknown');
    cancelBtn.innerHTML = lucide('x', 12);
    cancelBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:2px;background:transparent;color:var(--fg2);border:none;border-radius:4px;cursor:pointer;padding:0;';
    cancelBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      _chatRemoveQueuedMessage(options?.queuedMessageId || msgId);
    });
    header.appendChild(cancelBtn);
  }
  if (Number.isInteger(options?.messageIndex) && !isQueued) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.title = 'メッセージをコピー';
    copyBtn.setAttribute('aria-label', 'メッセージをコピー');
    copyBtn.dataset.chatCopyIndex = String(options.messageIndex);
    copyBtn.dataset.e2eId = 'chat-message-copy-' + options.messageIndex;
    copyBtn.innerHTML = _chatCopyIconHtml(12);
    copyBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:2px;background:transparent;color:var(--fg2);border:none;border-radius:4px;cursor:pointer;padding:0;';
    copyBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const current = _chatState.messages[options.messageIndex]?.content;
      _chatCopyText(_chatContentToText(current ?? content), 'メッセージをコピーしました');
    });
    header.appendChild(copyBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.title = 'メッセージを削除';
    deleteBtn.setAttribute('aria-label', 'メッセージを削除');
    deleteBtn.disabled = !!_chatState.streaming;
    deleteBtn.dataset.chatDeleteIndex = String(options.messageIndex);
    deleteBtn.dataset.e2eId = 'chat-message-delete-' + options.messageIndex;
    deleteBtn.innerHTML = lucide('trash2', 12);
    deleteBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:2px;background:transparent;color:var(--fg2);border:none;border-radius:4px;cursor:pointer;padding:0;';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      chatDeleteMessage(options.messageIndex);
    });
    header.appendChild(deleteBtn);
  }
  if (Number.isInteger(options?.messageIndex) && !isQueued && !isUser) {
    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.title = '再生成';
    regenBtn.setAttribute('aria-label', '再生成');
    regenBtn.disabled = !!_chatState.streaming;
    regenBtn.dataset.chatRegenerateIndex = String(options.messageIndex);
    regenBtn.dataset.e2eId = 'chat-message-regenerate-' + options.messageIndex;
    regenBtn.innerHTML = lucide('refreshCw', 12);
    regenBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:2px;background:transparent;color:var(--fg2);border:none;border-radius:4px;cursor:pointer;padding:0;';
    regenBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      chatRegenerateMessage(options.messageIndex);
    });
    header.appendChild(regenBtn);
  }
  if (Number.isInteger(options?.messageIndex) && !isQueued && isUser) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.title = '編集して再送';
    editBtn.setAttribute('aria-label', '編集して再送');
    editBtn.disabled = !!_chatState.streaming;
    editBtn.dataset.chatEditIndex = String(options.messageIndex);
    editBtn.dataset.e2eId = 'chat-message-edit-' + options.messageIndex;
    editBtn.innerHTML = lucide('pencil', 12);
    editBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:2px;background:transparent;color:var(--fg2);border:none;border-radius:4px;cursor:pointer;padding:0;';
    editBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      chatEditUserMessage(options.messageIndex);
    });
    header.appendChild(editBtn);
  }
  wrapper.appendChild(header);

  // バブル
  const div = document.createElement('div');
  div.className = 'chat-message-bubble chat-message-bubble-llm chat-copy-body' + (isUser ? ' is-user' : ' is-assistant');
  div.style.cssText = isUser
    ? 'background:var(--accent);color:var(--ui-fg-strong);padding:8px 12px;border-radius:12px 12px 2px 12px;white-space:pre-wrap;word-break:break-word;font-size:13px;'
    : 'background:var(--bg3);color:var(--fg);padding:8px 12px;border-radius:12px 12px 12px 2px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.6;';
  // スタンプのみメッセージの判定
  const _isStructured = Array.isArray(content);
  const _stampOnly = !_isStructured && typeof isStampOnly === 'function' && isStampOnly(plainContent);
  if (_isStructured) {
    _chatRenderStructuredMessage(div, content, isUser);
  } else if (_stampOnly) {
    div.style.background = 'transparent';
    div.style.padding = '4px';
    div.innerHTML = typeof renderStampsLarge === 'function' ? renderStampsLarge(esc(plainContent)) : esc(plainContent);
  } else if (isUser && plainContent && typeof renderStamps === 'function' && plainContent.includes('::stamp:')) {
    if (typeof renderChatMarkdown === 'function') renderChatMarkdown(div, plainContent, { role: 'user' });
    else div.innerHTML = renderStamps(esc(plainContent));
  } else {
    if (isUser && typeof renderChatMarkdown === 'function') renderChatMarkdown(div, plainContent, { role: 'user' });
    else div.textContent = plainContent;
  }
  if (!_isStructured && !_stampOnly && !isUser && plainContent) {
    if (typeof renderChatMarkdown === 'function') renderChatMarkdown(div, plainContent, { role: 'assistant' });
    else {
      let safe = esc(plainContent);
      safe = safe.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
      safe = safe.replace(/`([^`]+)`/g, '<code style="background:var(--bg2);padding:1px 4px;border-radius:3px;">$1</code>');
      safe = safe.replace(/\n/g, '<br>');
      if (typeof renderStamps === 'function') safe = renderStamps(safe);
      div.innerHTML = safe;
    }
  }
  wrapper.appendChild(div);
  container.appendChild(wrapper);
  if (!isUser && options?.citations?.length && typeof _chatRenderCitations === 'function') {
    _chatRenderCitations(div, options.citations);
  }
  if (!isUser && options?.tool_audit_warning) _chatRenderToolAuditWarning(div, options.tool_audit_warning);
  if (!isUser && options?.thinking) _chatRenderThinking(div, options.thinking);
  if (!isUser && options?.compressed_summary) {
    div.style.border = '1px dashed var(--border)';
    div.title = `圧縮済み会話の要約（元発言 ${Number(options.original_message_count || 0)} 件）`;
  }
  if (!isUser && options?.code_exec_blocks?.length) chatRenderCodeExecBlocks(div, options.code_exec_blocks);
  if (!isUser && options?.error_code === 'cli_auth_required') {
    queueMicrotask(() => window.MeldexCliAuthRecovery?.attach?.(div, provider));
  }
  _chatScrollToBottomIf(container, shouldScrollAfterAppend);
  return div;
}

function chatAddSystem(text) {
  const container = _chatLiveMessagesContainer();
  if (!container) return null;
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center;color:var(--fg2);font-size:11px;padding:4px;';
  div.textContent = text;
  container.appendChild(div);
  return div;
}

function chatAddToolUse(name, result, parent = null) {
  const container = parent || _chatLiveMessagesContainer();
  if (!container) return null;
  const div = document.createElement('div');
  div.className = 'chat-tool-use';
  div.style.cssText = parent
    ? 'background:var(--bg2);border:1px solid var(--border);padding:6px 10px;border-radius:6px;max-width:100%;font-size:11px;color:var(--fg2);'
    : 'align-self:flex-start;background:var(--bg2);border:1px solid var(--border);padding:6px 10px;border-radius:6px;max-width:80%;font-size:11px;color:var(--fg2);';
  const icon = /^(web_search|google_search)$/i.test(String(name || '')) ? 'globe' : 'settings';
  div.innerHTML = `${lucide(icon, 12)} <b>${esc(name)}</b><div class="tool-result-text" style="margin-top:4px;max-height:60px;overflow:hidden;text-overflow:ellipsis;">${esc(result?.substring(0, 200) || '')}</div>`;
  const shouldScrollAfterAppend = !parent && _chatShouldStickToBottom(container);
  container.appendChild(div);
  if (!parent) _chatScrollToBottomIf(container, shouldScrollAfterAppend);
  return div;
}

let _chatToolRefreshTimer = null;
const CHAT_WORKSPACE_REFRESH_TOOLS = new Set([
  'write_file',
  'create_sheet',
  'write_to_database',
  'create_entity',
  'add_value',
  'set_property_type',
  'configure_public_form',
  'configure_form_view',
  'update_knowledge',
  'create_folder',
  'rename',
  'delete',
  'add_debug_report',
  'llm_ui_action',
]);

function _parseChatToolResult(result) {
  if (!result || typeof result !== 'string') return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

function _chatToolResultSucceeded(parsed) {
  return !!parsed && !parsed.error && parsed.ok !== false;
}

const CHAT_WRITE_VERIFY_TOOLS = new Set(['write_file', 'create_sheet', 'create_entity', 'add_value', 'set_property_type', 'configure_public_form', 'configure_form_view', 'update_knowledge', 'create_folder', 'rename', 'delete', 'llm_ui_action', 'add_debug_report']);
const CHAT_NONEMPTY_RESULT_TOOLS = new Set(['search', 'search_knowledge', 'llm_list_ui_controls']);

function _chatToolResultHasMatches(parsed) {
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (!parsed || typeof parsed !== 'object') return false;
  const collections = ['results', 'items', 'controls', 'files', 'folders', 'entries', 'matches'];
  for (const key of collections) {
    if (Array.isArray(parsed[key])) return parsed[key].length > 0;
  }
  if (Number.isFinite(Number(parsed.count))) return Number(parsed.count) > 0;
  return false;
}

function _chatToolEventSucceeded(event) {
  if (!event || !event.name) return false;
  const name = String(event.name || '');
  const parsed = _parseChatToolResult(event.result);
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (parsed) {
    if (!_chatToolResultSucceeded(parsed)) return false;
    if (CHAT_NONEMPTY_RESULT_TOOLS.has(name)) return _chatToolResultHasMatches(parsed);
    return true;
  }
  if (name === 'read_file') return !/(^|[,{]\s*)"error"\s*:|エラー|見つかりません|失敗|拒否|denied|not found|not allowed/i.test(String(event.result || '').slice(0, 400));
  const result = String(event.result || '').trim();
  return !!result && !/(^|[,{]\s*)"error"\s*:|エラー|見つかりません|失敗|拒否|denied|not found|not allowed/i.test(result.slice(0, 400));
}

function _chatSuccessfulToolNames(toolEvents) {
  return new Set((Array.isArray(toolEvents) ? toolEvents : [])
    .filter(_chatToolEventSucceeded)
    .map(event => String(event.name || '')));
}

function _chatTextSuggestsMeldexTarget(text) {
  return /(ファイル|フォルダ|シート|ノート|パス|場所|存在|中身|Meldex|UI|ナレッジ|記憶|メモリ|ルール|設定|方針|感性原則|好み|Skills|スキル|マニュアル|バグ報告|canonical|リネーム|改名|作成|登録|更新|削除|保存|移動|書き込み|追加)/i.test(String(text || ''));
}

function _chatClaimsMutation(text) {
  return /(リネーム|改名|作成|登録|記憶|更新|反映|固定|解除|削除|保存|移動|書き込み|追加)(しました|しました。|完了|済み|できました|しましたので|しました、)/.test(String(text || ''));
}

function _chatToolTruthAudit(assistantText, latestUserText, toolEvents) {
  const assistant = String(assistantText || '');
  const user = String(latestUserText || '');
  if (!assistant.trim()) return '';
  if (!_chatTextSuggestsMeldexTarget(user + '\n' + assistant)) return '';
  const claimsMutation = _chatClaimsMutation(assistant);
  if (!claimsMutation) return '';
  const successNames = _chatSuccessfulToolNames(toolEvents);
  const hasWriteEvidence = Array.from(successNames).some(name => CHAT_WRITE_VERIFY_TOOLS.has(name));
  if (!hasWriteEvidence) {
    return '**注意:** この応答はファイル/フォルダ/ナレッジ等の操作完了を述べていますが、このターンでは対応するMeldex書き込み系ツールの成功結果を確認できませんでした。実際に操作完了した結果としては扱わないでください。';
  }
  return '';
}

function _chatToolTruthSanitize(assistantText, latestUserText, toolEvents) {
  const warning = _chatToolTruthAudit(assistantText, latestUserText, toolEvents);
  const text = String(assistantText || '');
  if (!warning) return { text, warning: '', replaced: false };
  return {
    text,
    warning,
    replaced: false,
  };
}

window.GBChatToolTruthAudit = {
  audit: _chatToolTruthAudit,
  sanitize: _chatToolTruthSanitize,
};

async function _refreshWorkspaceAfterChatToolEffect() {
  const refreshJobs = [];
  if (typeof refreshOutliner === 'function') {
