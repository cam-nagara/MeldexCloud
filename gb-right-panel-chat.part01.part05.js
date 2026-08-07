    refreshJobs.push(refreshOutliner());
  } else if (typeof loadOutliner === 'function') {
    refreshJobs.push(loadOutliner());
    if (typeof renderHomeFolderTree === 'function') refreshJobs.push(renderHomeFolderTree());
  }
  await Promise.allSettled(refreshJobs);
  if (typeof openFolder === 'function' && _folderPath) {
    await openFolder(_folderPath.split('/').pop() || _folderPath, _folderPath, {
      skipShowView: true,
      skipSaveLastView: true,
      skipNavPush: true,
      skipHighlight: true,
      skipGlobalUi: true,
    });
  }
}

function _handleChatToolWorkspaceEffect(name, result) {
  const toolName = String(name || '');
  const parsed = _parseChatToolResult(result);
  if (!CHAT_WORKSPACE_REFRESH_TOOLS.has(toolName) || !_chatToolResultSucceeded(parsed)) return;
  clearTimeout(_chatToolRefreshTimer);
  _chatToolRefreshTimer = setTimeout(() => {
    _chatToolRefreshTimer = null;
    _refreshWorkspaceAfterChatToolEffect().catch(() => {});
  }, 80);
}

function chatStopStreaming() {
  const controller = _chatState.abortController;
  if (!controller) return;
  _chatState.stopSerial = Number(_chatState.stopSerial || 0) + 1;
  try { controller.abort(); } catch {}
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) {
    sendBtn.textContent = '停止中...';
    sendBtn.title = '停止処理中';
    sendBtn.disabled = true;
  }
  if (typeof showStatus === 'function') showStatus('チャット応答を停止しています...');
  setTimeout(() => {
    if (_chatState.streaming && _chatState.abortController === controller && typeof _chatSyncStreamingControls === 'function') {
      _chatSyncStreamingControls();
    }
  }, 1500);
}

function _chatQueuedMessages() {
  if (!Array.isArray(_chatState.queuedMessages)) _chatState.queuedMessages = [];
  return _chatState.queuedMessages;
}

function _chatCurrentQueueScope() {
  return {
    messages: _chatState.messages,
    sessionId: String(_chatState.sessionId || ''),
    targetPath: String(_chatState.streamingTargetPath || (typeof _chatEffectiveTargetPath === 'function' ? _chatEffectiveTargetPath() : (_chatState.targetPath || '')) || ''),
    workspaceId: typeof _chatWorkspaceIdValue === 'function' ? String(_chatWorkspaceIdValue() || '') : String(_chatState.workspaceId || ''),
    sourceFolder: typeof _chatSourceFolderValue === 'function' ? String(_chatSourceFolderValue() || '') : String(_chatState.sourceFolder || ''),
    mode: typeof _chatMode === 'undefined' ? '' : String(_chatMode || ''),
  };
}

function _chatQueueScopesMatch(scope, current) {
  if (!scope || !current) return false;
  if (String(scope.mode || '') !== String(current.mode || '')) return false;
  if (String(scope.workspaceId || '') !== String(current.workspaceId || '')) return false;
  if (String(scope.sourceFolder || '') !== String(current.sourceFolder || '')) return false;
  if (String(scope.targetPath || '') !== String(current.targetPath || '')) return false;
  const scopeSession = String(scope.sessionId || '');
  const currentSession = String(current.sessionId || '');
  if (scopeSession || currentSession) return scopeSession === currentSession;
  return scope.messages === current.messages;
}

function _chatQueueScopeMatchesCurrent() {
  const queue = _chatQueuedMessages();
  if (!queue.length) return true;
  return _chatQueueScopesMatch(_chatState.queuedScope, _chatCurrentQueueScope());
}

function _chatClearQueuedMessages() {
  const queue = _chatQueuedMessages();
  queue.splice(0, queue.length);
  _chatState.queuedScope = null;
}

function _chatNormalizeUserContent(text, attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) return String(text || '');
  return [
    { type: 'text', text: String(text || '') },
    ...list.map(att => {
      const mime = String(att?.mime || '').toLowerCase();
      const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(att?.name || att?.path || '');
      return { type: isPdf ? 'document' : 'image', name: att?.name, path: att?.path, mimeType: isPdf ? 'application/pdf' : att?.mime };
    }),
  ];
}

function _chatQueuedMessagesText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map(message => {
