    if (typeof _chatContentToText === 'function') return _chatContentToText(message?.content || '');
    return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content || '');
  }).filter(Boolean).join('\n\n');
}

function _chatQueueUserInputForNextTurn(options = {}) {
  if (options?.fromButton || options?.stopRequested) {
    chatStopStreaming();
    return false;
  }
  const input = document.getElementById('chat-input');
  const attachments = Array.isArray(_chatState.pendingAttachments) ? _chatState.pendingAttachments.slice() : [];
  const text = String(input?.value || '').trim();
  if (!text && attachments.length === 0) return false;
  if (attachments.some(att => att?.uploading || att?.uploadError || !String(att?.path || '').trim())) {
    if (typeof showStatus === 'function') showStatus('添付ファイルのアップロード完了後に送信してください', true);
    return false;
  }

  const submitFingerprint = JSON.stringify({ text, attachments: attachments.map(att => att.path || att.name || '') });
  const now = Date.now();
  if (submitFingerprint === _chatLastSubmitFingerprint && now - _chatLastSubmitAt < 300) {
    if (typeof showStatus === 'function') showStatus('同じメッセージの連続送信を抑止しました');
    return false;
  }
  _chatLastSubmitFingerprint = submitFingerprint;
  _chatLastSubmitAt = now;

  const queue = _chatQueuedMessages();

  if (input) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
    if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
  }
  if (attachments.length > 0) {
    if (typeof _chatClearPendingAttachments === 'function') _chatClearPendingAttachments();
    else _chatState.pendingAttachments = [];
  }

  const scope = _chatCurrentQueueScope();
  const message = _chatCreateWaitingDraft(text, attachments, scope);
  const timestamp = message.timestamp;
  _chatState.queuedScope = scope;
  queue.push(message);
  _chatPersistQueuedMessages();
  chatAddMessage('user', message.content, {
    messageIndex: _chatState.messages.length + queue.length - 1,
    msg_id: message.msg_id,
    queuedMessageId: message.msg_id,
    timestamp,
    queued_for_next_response: true,
  });
  if (typeof showStatus === 'function') showStatus('待機カードへ追加しました');
  return true;
}

function _chatDrainQueuedMessagesForScope(scope) {
  const queue = _chatQueuedMessages();
  const drained = [];
  for (let index = queue.length - 1; index >= 0; index--) {
    if (!_chatQueueScopesMatch(_chatDraftScope(queue[index]), scope)) continue;
    drained.unshift(queue.splice(index, 1)[0]);
  }
  if (!queue.length) _chatState.queuedScope = null;
  _chatPersistQueuedMessages();
  return drained;
}

function _chatDrainQueuedMessages() {
  return _chatDrainQueuedMessagesForScope(_chatCurrentQueueScope());
}

function _chatQueueScopeFromOptions(options = {}) {
  if (!Object.prototype.hasOwnProperty.call(options || {}, 'messages')) return _chatCurrentQueueScope();
  const hasWorkspaceId = Object.prototype.hasOwnProperty.call(options || {}, 'workspaceId');
  const hasSourceFolder = Object.prototype.hasOwnProperty.call(options || {}, 'sourceFolder');
  const hasMode = Object.prototype.hasOwnProperty.call(options || {}, 'mode');
  return {
    messages: options.messages,
    sessionId: String(options.sessionId || ''),
    targetPath: String(options.targetPath || ''),
    workspaceId: String(hasWorkspaceId ? (options.workspaceId || '') : (_chatState.queuedScope?.workspaceId || '')),
    sourceFolder: String(hasSourceFolder ? (options.sourceFolder || '') : (_chatState.queuedScope?.sourceFolder || '')),
    mode: String(hasMode ? (options.mode || '') : (_chatState.queuedScope?.mode || (typeof _chatMode === 'undefined' ? '' : _chatMode || ''))),
  };
}

function _chatPromoteQueuedMessagesToHistory() {
  const queued = _chatDrainQueuedMessages();
  if (!queued.length) return 0;
  queued.forEach(message => {
    message.role = 'user';
    message.timestamp = message.timestamp || _chatLocalTimestamp();
    _ensureChatMessageId(message);
  });
  _chatState.messages.push(...queued);
  if (typeof _chatRenderStoredMessages === 'function') _chatRenderStoredMessages();
  return queued.length;
}

async function _chatSendQueuedMessagesAfterStream(options = {}) {
  if (_chatState.streaming || _chatState.queuedSendRunning) return false;
  const queue = _chatQueuedMessages();
  if (!queue.length) return false;
  const sendScope = _chatQueueScopeFromOptions(options);
  let queued = _chatDrainQueuedMessagesForScope(sendScope);
  if (!queued.length) return false;
  const interruptId = String(_chatState.interruptDraftId || '');
  if (interruptId) {
    const chosen = queued.find(item => String(item?.msg_id || '') === interruptId);
    const rest = queued.filter(item => item !== chosen);
    if (rest.length) {
      _chatState.queuedMessages = rest.concat(_chatQueuedMessages());
      _chatPersistQueuedMessages();
    }
    queued = chosen ? [chosen] : queued.slice(0, 1);
    _chatState.interruptDraftId = '';
  }
  const sendMode = interruptId ? 'one-by-one' : _chatQueueSendMode();
  if (sendMode === 'one-by-one' && queued.length > 1) {
    _chatState.queuedMessages = queued.slice(1).concat(_chatQueuedMessages());
    queued = queued.slice(0, 1);
    _chatPersistQueuedMessages();
  } else if (sendMode === 'combined' && queued.length > 1) {
    const combinedAttachments = queued.flatMap(item => item.attachments || []);
    const combinedText = queued.map((item, index) => `${index + 1}. ${_chatContentToText(item.content)}`).join('\n\n');
    const combined = _chatCreateWaitingDraft(combinedText, combinedAttachments, sendScope);
    combined.msg_id = queued[0].msg_id;
    queued = [combined];
  }
  if (interruptId) {
    queued.unshift({
      role: 'user',
      origin: 'meldex-control',
      controlKind: 'interrupt-handoff',
      presentation: 'MeldexからAIへの自動指示',
      content: 'これはMeldexからAIへの制御指示です。明示的な停止指示なら停止し、それ以外は追加内容を反映して元の作業を続けてください。',
      timestamp: _chatLocalTimestamp(),
    });
  }
  _chatState.queuedSendRunning = true;
  const stopSerial = Number(_chatState.stopSerial || 0);
  let sent = false;
  try {
    if (typeof showStatus === 'function') showStatus(`保留メッセージ ${queued.length} 件を送信します`);
    const firstDraft = queued.find(item => item?.origin !== 'meldex-control') || queued[0];
    const deferredOptions = {
      deferredMessages: queued,
      fromQueuedMessages: true,
      provider: firstDraft?.provider || options.provider,
      model: firstDraft?.model || options.model,
      generationSettings: firstDraft?.generation || null,
    };
    if (Object.prototype.hasOwnProperty.call(options || {}, 'messages')) {
      Object.assign(deferredOptions, {
        streamMessages: options.messages,
        sessionId: options.sessionId,
        sessionTitle: options.sessionTitle,
        targetPath: options.targetPath,
        sourceFolder: options.sourceFolder,
        workspaceId: options.workspaceId,
        provider: firstDraft?.provider || options.provider,
        model: firstDraft?.model || options.model,
        mode: options.mode,
      });
    }
    const cliProvider = deferredOptions.provider && window.GBChatCli?.isCliChatProvider?.(deferredOptions.provider);
    const sendQueued = cliProvider && window.GBChatCli?.sendCliChat ? window.GBChatCli.sendCliChat : chatSend;
    sent = await sendQueued(deferredOptions);
    if (!sent && !_chatState.streaming) {
      _chatState.queuedMessages = queued.filter(item => item.origin !== 'meldex-control').concat(_chatQueuedMessages());
      _chatState.queuedScope = sendScope;
      _chatPersistQueuedMessages();
    }
    return sent;
  } finally {
    _chatState.queuedSendRunning = false;
    if (sent && !_chatState.streaming && _chatQueuedMessagesForScope(sendScope).length && Number(_chatState.stopSerial || 0) === stopSerial) {
      setTimeout(() => { _chatSendQueuedMessagesAfterStream(options).catch(() => {}); }, 0);
    }
  }
}

function _chatAbortActiveStreamForNavigation() {
  if (!_chatState.streaming) return;
  if (typeof showStatus === 'function') {
    showStatus('チャット応答はバックグラウンドで継続しています');
  }
  _syncChatSourceFolderUi();
}

let _chatSpeechRecognition = null;

function chatToggleVoiceInput() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-voice-btn');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!input || !SpeechRecognition) {
    if (typeof showStatus === 'function') showStatus('このブラウザは音声入力に対応していません', true);
    return;
  }
  if (_chatSpeechRecognition) {
    try { _chatSpeechRecognition.stop(); } catch {}
    _chatSpeechRecognition = null;
    if (btn) {
      btn.dataset.recording = '0';
      btn.style.color = 'var(--fg2)';
      btn.title = '音声入力';
    }
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.interimResults = true;
  recognition.continuous = false;
  const baseValue = input.value;
  recognition.onresult = event => {
    const finalParts = [];
    const interimParts = [];
    for (let i = 0; i < event.results.length; i++) {
      const text = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) finalParts.push(text);
      else interimParts.push(text);
    }
    const speechText = (finalParts.join('') + interimParts.join('')).trim();
    const next = (baseValue + (baseValue && speechText ? '\n' : '') + speechText).trimStart();
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  recognition.onerror = event => {
    if (typeof showStatus === 'function') showStatus('音声入力エラー: ' + (event.error || 'unknown'), true);
  };
  recognition.onend = () => {
    _chatSpeechRecognition = null;
    if (btn) {
      btn.dataset.recording = '0';
      btn.style.color = 'var(--fg2)';
      btn.title = '音声入力';
    }
    if (!window.GBChatFormatting?.focusInput?.()) input.focus();
  };
  _chatSpeechRecognition = recognition;
  if (btn) {
    btn.dataset.recording = '1';
    btn.style.color = 'var(--accent)';
    btn.title = '録音停止';
  }
  recognition.start();
}

async function chatSend(options = {}) {
  if (_chatState.streaming) {
    return _chatQueueUserInputForNextTurn(options);
  }
  const effectiveProvider = _chatProviderKey(options.provider || _chatState.provider);
  if (_chatIsCliProvider(effectiveProvider)) {
    if (window.GBChatCli?.sendCliChat) return window.GBChatCli.sendCliChat(options);
    if (typeof chatAddSystem === 'function') chatAddSystem('CLIチャット機能を読み込み中です。少し待ってから再送信してください。');
    return false;
  }
  const scopedMessages = Array.isArray(options.streamMessages) ? options.streamMessages : null;
  const targetMessages = scopedMessages || _chatState.messages;
  const detachedScope = !!scopedMessages && scopedMessages !== _chatState.messages;
  const deferredMessages = Array.isArray(options.deferredMessages) ? _chatCloneMessages(options.deferredMessages).filter(message => message?.role === 'user') : [];
  const usingDeferredMessages = deferredMessages.length > 0;
  if (usingDeferredMessages && detachedScope && !String(options.sessionId || '')) {
    if (typeof showStatus === 'function') showStatus('保留メッセージの保存先を確認できませんでした', true);
    return false;
  }
  if (!usingDeferredMessages) _captureChatSessionTitleFromInput();
  const input = document.getElementById('chat-input');
  const msgContainer = _chatLiveMessagesContainer();
  if (!msgContainer && !detachedScope) {
    if (typeof showStatus === 'function') showStatus('チャット表示を準備中です', true);
    return false;
  }
  let _pendingAtts = usingDeferredMessages ? [] : (_chatState.pendingAttachments || []);
  if (!usingDeferredMessages && !input) return false;
  const text = usingDeferredMessages ? _chatQueuedMessagesText(deferredMessages).trim() : input.value.trim();
  if (!usingDeferredMessages && !text && _pendingAtts.length === 0) {
    if (_chatQueuedMessages().length) return _chatSendQueuedMessagesAfterStream();
    return;
  }
  if (!usingDeferredMessages) {
    const submitFingerprint = JSON.stringify({ text, attachments: _pendingAtts.map(att => att.path || att.name || '') });
    const now = Date.now();
    if (submitFingerprint === _chatLastSubmitFingerprint && now - _chatLastSubmitAt < 300) {
      if (typeof showStatus === 'function') showStatus('同じメッセージの連続送信を抑止しました');
      return false;
    }
    _chatLastSubmitFingerprint = submitFingerprint;
    _chatLastSubmitAt = now;
  }
  if (!_chatIsLocalLlmProvider(effectiveProvider) && window.MeldexOnlineStatus?.assertOnlineForLlm && !window.MeldexOnlineStatus.assertOnlineForLlm()) {
    if (!detachedScope) chatAddSystem(window.MeldexOnlineStatus.offlineMessage());
    return false;
  }
  const hasWorkspaceIdOption = Object.prototype.hasOwnProperty.call(options || {}, 'workspaceId');
  const hasSourceFolderOption = Object.prototype.hasOwnProperty.call(options || {}, 'sourceFolder');
  const storageOptions = {};
  if (hasWorkspaceIdOption) storageOptions.workspaceId = String(options.workspaceId || '');
  if (hasSourceFolderOption) storageOptions.sourceFolder = String(options.sourceFolder || '');
  const storageContext = window.GBChatStorageContext?.requireForAi
    ? await window.GBChatStorageContext.requireForAi(storageOptions)
    : null;
  const requestWorkspaceId = String(storageContext?.workspaceId || '');
  const requestSourceFolder = String(storageContext?.sourceFolder || '');
  if (!storageContext || (!requestWorkspaceId && !requestSourceFolder)) return false;
  if (!usingDeferredMessages && _pendingAtts.length > 0) {
    if (typeof _chatWaitForPendingAttachmentUploads === 'function') {
      const readyAttachments = await _chatWaitForPendingAttachmentUploads(_pendingAtts);
      if (!readyAttachments) return false;
      _pendingAtts = readyAttachments;
    } else if (_pendingAtts.some(att => att?.uploading || att?.uploadError || !String(att?.path || '').trim())) {
      if (typeof showStatus === 'function') showStatus('添付ファイルのアップロード完了後に送信してください', true);
      return false;
    }
  }
  if (!usingDeferredMessages) {
    if (typeof _chatWithDraftUploadCleanupPaused === 'function') {
      _chatWithDraftUploadCleanupPaused(() => {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    } else {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
    if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
  }

  // CLIP画像検索コマンド: /image-search <query> または /画像検索 <query>
  const imgSearchMatch = usingDeferredMessages ? null : text.match(/^\/(?:image-search|画像検索)\s+(.+)/i);
  if (imgSearchMatch) {
    const query = imgSearchMatch[1].trim();
    chatAddMessage('user', text, { timestamp: _chatLocalTimestamp() });
    chatAddSystem('画像を検索中...');
    const results = await clipSearchImages(query);
    if (results) {
      const html = showClipSearchResults(results, query);
      const container = _chatLiveMessagesContainer();
      if (!container) return false;
      const div = document.createElement('div');
      div.style.cssText = 'padding:8px;background:var(--bg3);border-radius:8px;max-width:95%;';
      div.innerHTML = html;
      window.MeldexImageLoading?.trackAll?.(div);
      container.appendChild(div);
      _chatScrollToBottom(container);
    }
    return;
  }

  const providerStatus = await _chatProviderReadyStatus(effectiveProvider);
  if (!providerStatus.configured) {
    if (!usingDeferredMessages) {
      if (typeof _chatWithDraftUploadCleanupPaused === 'function') {
        _chatWithDraftUploadCleanupPaused(() => {
          input.value = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
      } else {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
      if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
    }
    if (!detachedScope) chatAddSystem(providerStatus.message || '送信設定を確認してください。');
    _chatRefreshApiKeyState().catch(() => {});
    return false;
  }

  // ユーザーメッセージ表示・記録（画像添付があれば構造化コンテンツにする）
  if (usingDeferredMessages) {
    deferredMessages.forEach(message => {
      message.role = 'user';
      message.timestamp = message.timestamp || _chatLocalTimestamp();
      _ensureChatMessageId(message);
    });
    targetMessages.push(...deferredMessages);
    if (!detachedScope) _chatRenderStoredMessages();
  } else {
    const _userContent = _chatNormalizeUserContent(text, _pendingAtts);
    if (_pendingAtts.length > 0) {
      if (typeof _chatClearPendingAttachments === 'function') _chatClearPendingAttachments();
      else _chatState.pendingAttachments = [];
    }
    const userTimestamp = _chatLocalTimestamp();
    const userMessage = { role: 'user', content: _userContent, timestamp: userTimestamp };
    _ensureChatMessageId(userMessage);
    chatAddMessage('user', _userContent, { messageIndex: _chatState.messages.length, msg_id: userMessage.msg_id, timestamp: userTimestamp });
    _chatState.messages.push(userMessage);
    if (typeof _chatCommitDraftUploadsForText === 'function') _chatCommitDraftUploadsForText('chat-input', text);
  }
  if (!detachedScope) _ensureSessionId();

  // ストリーミング開始
  const streamMessages = targetMessages;
  const streamProvider = effectiveProvider;
  const streamModel = options.model
    || (_chatProviderKey(streamProvider) === _chatProviderKey(_chatState.provider)
      ? _chatState.model
      : (localStorage.getItem('chat-model:' + _chatProviderKey(streamProvider)) || _chatDefaultModel(streamProvider)));
  const streamSessionId = Object.prototype.hasOwnProperty.call(options || {}, 'sessionId') ? String(options.sessionId || '') : (_chatState.sessionId || '');
  const streamSessionTitle = Object.prototype.hasOwnProperty.call(options || {}, 'sessionTitle') ? String(options.sessionTitle || '') : (_chatState.sessionTitle || '');
  const streamTargetPath = typeof _chatEffectiveTargetPath === 'function' ? _chatEffectiveTargetPath(options) : (Object.prototype.hasOwnProperty.call(options || {}, 'targetPath') ? String(options.targetPath || '') : (_chatState.targetPath || ''));
  const streamSourceFolder = requestSourceFolder;
  const streamWorkspaceId = requestWorkspaceId;
  const streamWorkFolder = typeof _chatEffectiveWorkFolder === 'function' ? _chatEffectiveWorkFolder(streamTargetPath, options) : '';
  const streamSystemPrompt = _buildSystemPrompt({ targetPath: streamTargetPath });
  const streamController = new AbortController();
  _chatState.streaming = true;
  _chatState.abortController = streamController;
  _chatState.streamingProvider = streamProvider;
  _chatState.streamingTargetPath = streamTargetPath;
  _chatState.lastImplicitTargetPath = streamTargetPath;
  _chatState.activeExecution = {
    messages: streamMessages,
    sessionId: streamSessionId,
    sessionTitle: streamSessionTitle,
    targetPath: streamTargetPath,
    sourceFolder: streamSourceFolder,
    workspaceId: streamWorkspaceId,
    provider: streamProvider,
    model: streamModel,
    mode: Object.prototype.hasOwnProperty.call(options || {}, 'mode') ? String(options.mode || '') : (typeof _chatMode === 'undefined' ? '' : String(_chatMode || '')),
    controller: streamController,
  };
  window.MeldexChatListbox?.decorateHistory?.();
  _syncChatSourceFolderUi();
  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn && !detachedScope) {
    sendBtn.textContent = '停止';
    sendBtn.title = '応答生成を停止';
    sendBtn.disabled = false;
  }

  // 思考中スピナーを表示
  const spinnerWrapper = document.createElement('div');
  spinnerWrapper.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:2px;max-width:85%;align-self:flex-start;';
  const spinnerHeader = document.createElement('div');
  spinnerHeader.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg2);padding:0 4px;';
  const modelName = getProviderLabel(streamProvider, streamModel);
  spinnerHeader.innerHTML = getProviderIconHtml(streamProvider, 16) + '<span>' + esc(modelName) + '</span>';
  spinnerWrapper.appendChild(spinnerHeader);
  const spinnerDiv = document.createElement('div');
  spinnerDiv.style.cssText = 'background:var(--bg3);padding:8px 16px;border-radius:12px 12px 12px 2px;font-size:13px;color:var(--fg2);display:flex;align-items:center;gap:8px;';
  spinnerDiv.innerHTML = '<span class="chat-spinner"></span><span id="_chat-thinking-status">考え中...</span>';
  spinnerWrapper.appendChild(spinnerDiv);
  const activityLog = document.createElement('div');
  activityLog.className = 'chat-live-activity-log';
  activityLog.style.cssText = 'display:none;flex-direction:column;gap:6px;width:100%;max-height:42vh;overflow:auto;';
  spinnerWrapper.appendChild(activityLog);
  if (msgContainer && !detachedScope) {
    msgContainer.appendChild(spinnerWrapper);
    _chatScrollToBottom(msgContainer);
  }

  let assistantDiv = null; // テキストが来たら作る
  const assistantMessageId = _newChatMessageId();
  let assistantTimestamp = '';
  const _assistantRenderOptions = () => {
    if (!assistantTimestamp) assistantTimestamp = _chatLocalTimestamp();
    return {
      messageIndex: streamMessages.length,
      msg_id: assistantMessageId,
      provider: streamProvider,
      model: streamModel,
      timestamp: assistantTimestamp,
    };
  };
  const streamToken = (_chatState.streamToken || 0) + 1;
  _chatState.streamToken = streamToken;
  const isCurrentStream = () => _chatState.streamToken === streamToken
    && _chatState.abortController === streamController;
  const streamVisibleInCurrentChat = () => _chatState.messages === streamMessages
    && (_chatState.sessionId || '') === streamSessionId;
  const streamLiveContainer = () => streamVisibleInCurrentChat() ? _chatLiveMessagesContainer() : null;
  const scrollStreamContainer = () => {
    const liveContainer = streamLiveContainer();
    if (liveContainer && _autoScroll) _chatScrollToBottom(liveContainer);
  };
  const addAssistantToVisibleStream = (content, renderOptions) => (
    streamVisibleInCurrentChat() ? chatAddMessage('assistant', content, renderOptions) : null
  );
  let sendOk = false;
  let fullText = '';
  let responseCitations = [];
  let responseUsage = null;
  let responseCodeExecBlocks = [];
  let responseToolEvents = [];
  let responseThinking = '';
  let liveThinkingTextEl = null;
  let _autoScroll = true;
  let streamError = null;
  let streamCompleted = false;
  const _scrollHandler = () => {
    _autoScroll = _chatIsScrolledNearBottom(msgContainer);
  };
  if (msgContainer && !detachedScope) msgContainer.addEventListener('scroll', _scrollHandler);
  const setLiveActivityStatus = (label) => {
    const st = spinnerWrapper.querySelector('#_chat-thinking-status');
    if (st) st.textContent = label || '考え中...';
  };
  const showLiveActivity = (label = '考え中...') => {
    setLiveActivityStatus(label);
    const liveContainer = streamLiveContainer();
    if (liveContainer && !liveContainer.contains(spinnerWrapper)) liveContainer.appendChild(spinnerWrapper);
    scrollStreamContainer();
  };
  const showLiveActivityLog = (label = '考え中...') => {
    showLiveActivity(label);
    activityLog.style.display = 'flex';
  };
  const appendLiveThinking = (chunk, label = '思考中...') => {
    const text = String(chunk || '');
    if (!text.trim()) return;
    responseThinking += text;
    showLiveActivityLog(label);
    if (!liveThinkingTextEl || !liveThinkingTextEl.isConnected) {
      liveThinkingTextEl = document.createElement('div');
      liveThinkingTextEl.className = 'chat-live-thinking-text';
      liveThinkingTextEl.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;max-width:100%;font-size:12px;color:var(--fg2);white-space:pre-wrap;word-break:break-word;line-height:1.55;';
      activityLog.appendChild(liveThinkingTextEl);
    }
    liveThinkingTextEl.textContent = responseThinking.trim();
    activityLog.scrollTop = activityLog.scrollHeight;
    scrollStreamContainer();
  };
  const hideLiveActivity = () => spinnerWrapper.remove();

  try {
    const _streamHeaders = { 'Content-Type': 'application/json' };
    if (_authToken) _streamHeaders['Authorization'] = 'Bearer ' + _authToken;
    const res = await fetch(API_BASE + '/chat/stream', {
      method: 'POST',
      headers: _streamHeaders,
      signal: streamController.signal,
