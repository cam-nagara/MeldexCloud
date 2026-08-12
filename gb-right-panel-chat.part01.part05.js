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

const CHAT_QUEUE_STORAGE_KEY = 'meldex-chat-waiting-drafts:v1';
const CHAT_QUEUE_MODE_KEY = 'chat-waiting-send-mode';
const CHAT_QUEUE_MODES = new Set(['one-by-one', 'combined', 'consecutive']);
let _chatDeletedDraftUndo = null;

function _chatQueueSendMode() {
  const value = String(localStorage.getItem(CHAT_QUEUE_MODE_KEY) || 'one-by-one');
  return CHAT_QUEUE_MODES.has(value) ? value : 'one-by-one';
}

function _chatSetQueueSendMode(value) {
  const next = CHAT_QUEUE_MODES.has(String(value || '')) ? String(value) : 'one-by-one';
  localStorage.setItem(CHAT_QUEUE_MODE_KEY, next);
  return next;
}

function _chatSerializableQueueScope(scope) {
  const value = scope || {};
  return {
    sessionId: String(value.sessionId || ''),
    targetPath: String(value.targetPath || ''),
    workspaceId: String(value.workspaceId || ''),
    sourceFolder: String(value.sourceFolder || ''),
    mode: String(value.mode || ''),
  };
}

function _chatQueueScopeKey(scope) {
  const value = _chatSerializableQueueScope(scope);
  return [value.mode, value.workspaceId, value.sourceFolder, value.sessionId, value.targetPath].join('\u001f');
}

function _chatDraftScope(message) {
  return message?.draftScope || _chatState.queuedScope || null;
}

function _chatPersistQueuedMessages() {
  try {
    const saved = _chatQueuedMessages().map(message => {
      const copy = { ...message, draftScope: _chatSerializableQueueScope(_chatDraftScope(message)) };
      delete copy._messages;
      return copy;
    });
    if (saved.length) localStorage.setItem(CHAT_QUEUE_STORAGE_KEY, JSON.stringify(saved));
    else localStorage.removeItem(CHAT_QUEUE_STORAGE_KEY);
  } catch {}
}

function _chatRestoreQueuedMessages() {
  if (_chatState.queueRestored) return;
  _chatState.queueRestored = true;
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_QUEUE_STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) _chatState.queuedMessages = saved.filter(item => item && item.role === 'user');
  } catch {
    localStorage.removeItem(CHAT_QUEUE_STORAGE_KEY);
  }
}

function _chatQueuedMessages() {
  _chatRestoreQueuedMessages();
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
  const stableScope = String(scope.workspaceId || scope.sourceFolder || scope.targetPath || scope.mode || '');
  const stableCurrent = String(current.workspaceId || current.sourceFolder || current.targetPath || current.mode || '');
  if (stableScope || stableCurrent) return _chatQueueScopeKey(scope) === _chatQueueScopeKey(current);
  return !scope.messages || !current.messages || scope.messages === current.messages;
}

function _chatQueueScopeMatchesCurrent() {
  const queue = _chatQueuedMessages();
  if (!queue.length) return true;
  const current = _chatCurrentQueueScope();
  return queue.some(message => _chatQueueScopesMatch(_chatDraftScope(message), current));
}

function _chatQueuedMessagesForScope(scope) {
  return _chatQueuedMessages().filter(message => _chatQueueScopesMatch(_chatDraftScope(message), scope));
}

function _chatClearQueuedMessages() {
  const queue = _chatQueuedMessages();
  queue.splice(0, queue.length);
  _chatState.queuedScope = null;
  _chatPersistQueuedMessages();
}

function _chatCreateWaitingDraft(text, attachments, scope) {
  const message = {
    role: 'user',
    origin: 'user',
    content: _chatNormalizeUserContent(text, attachments),
    attachments: (attachments || []).map(item => ({ ...item })),
    timestamp: typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString(),
    draftVersion: 1,
    draftScope: _chatSerializableQueueScope(scope),
    provider: String(_chatState.provider || ''),
    model: String(_chatState.model || ''),
    generation: typeof chatGenerationSettings === 'function' ? { ...chatGenerationSettings() } : {},
    _messages: scope?.messages || _chatState.messages,
  };
  _ensureChatMessageId(message);
  return message;
}

function _chatRestoreWaitingDraftToComposer(message) {
  if (!message) return false;
  const input = document.getElementById('chat-input');
  if (!input) return false;
  const existingText = String(input.value || '').trim();
  const existingAttachments = Array.isArray(_chatState.pendingAttachments) ? _chatState.pendingAttachments.slice() : [];
  if (existingText || existingAttachments.length) {
    _chatQueuedMessages().push(_chatCreateWaitingDraft(existingText, existingAttachments, _chatCurrentQueueScope()));
  }
  input.value = typeof _chatContentToText === 'function' ? _chatContentToText(message.content) : String(message.content || '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  _chatState.pendingAttachments = (message.attachments || []).map(item => ({ ...item }));
  if (message.provider) {
    _chatState.provider = message.provider;
    const providerSelect = document.getElementById('chat-provider');
    if (providerSelect) providerSelect.value = message.provider;
  }
  if (message.model) {
    _chatState.model = message.model;
    const modelSelect = document.getElementById('chat-model');
    if (modelSelect) modelSelect.value = message.model;
  }
  const generation = message.generation || {};
  const generationKeys = {
    reasoning_level: 'chat-reasoning-level',
    temperature: 'chat-temperature',
    max_tokens: 'chat-max-tokens',
    top_p: 'chat-top-p',
  };
  Object.entries(generationKeys).forEach(([field, key]) => {
    const value = generation[field];
    if (value == null || value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  });
  _chatPersistQueuedMessages();
  if (typeof _chatRenderStoredMessages === 'function') _chatRenderStoredMessages();
  window.GBChatFormatting?.syncInput?.();
  window.GBChatFormatting?.focusInput?.();
  return true;
}

function _chatShowDraftUndo(message, index) {
  if (_chatDeletedDraftUndo?.timer) clearTimeout(_chatDeletedDraftUndo.timer);
  const undo = { message, index, timer: null };
  _chatDeletedDraftUndo = undo;
  const host = typeof _chatLiveMessagesContainer === 'function' ? _chatLiveMessagesContainer() : document.getElementById('chat-messages');
  const toast = document.createElement('div');
  toast.className = 'chat-waiting-undo-toast';
  toast.setAttribute('role', 'status');
  toast.innerHTML = '<span>待機カードを削除しました</span><button type="button">元に戻す</button>';
  toast.querySelector('button')?.addEventListener('click', () => {
    if (_chatDeletedDraftUndo !== undo) return;
    _chatQueuedMessages().splice(Math.min(index, _chatQueuedMessages().length), 0, message);
    _chatDeletedDraftUndo = null;
    clearTimeout(undo.timer);
    toast.remove();
    _chatPersistQueuedMessages();
    _chatRenderStoredMessages();
  });
  host?.appendChild(toast);
  undo.timer = setTimeout(() => {
    if (_chatDeletedDraftUndo === undo) _chatDeletedDraftUndo = null;
    toast.remove();
  }, 6000);
}

function _chatEditQueuedMessage(msgId) {
  const queue = _chatQueuedMessages();
  const index = queue.findIndex(item => String(item?.msg_id || '') === String(msgId || ''));
  if (index < 0) return false;
  const [message] = queue.splice(index, 1);
  return _chatRestoreWaitingDraftToComposer(message);
}

function _chatInterruptWithQueuedMessage(msgId) {
  const message = _chatQueuedMessages().find(item => String(item?.msg_id || '') === String(msgId || ''));
  if (!message || !_chatState.abortController) return false;
  _chatState.interruptDraftId = String(message.msg_id || '');
  try { _chatState.abortController.abort(); } catch {}
  if (typeof showStatus === 'function') showStatus('現在の応答を中断して待機カードを送信します');
  return true;
}

window._chatEditQueuedMessage = _chatEditQueuedMessage;
window._chatInterruptWithQueuedMessage = _chatInterruptWithQueuedMessage;
window.MeldexChatWaitingDrafts = {
  mode: _chatQueueSendMode,
  setMode: _chatSetQueueSendMode,
  scopeKey: _chatQueueScopeKey,
  persist: _chatPersistQueuedMessages,
  edit: _chatEditQueuedMessage,
  interrupt: _chatInterruptWithQueuedMessage,
};

function _chatInstallQueueModeControl() {
  const controls = document.querySelector('#chat-composer .chat-composer-controls');
  if (!controls || document.getElementById('chat-waiting-send-mode')) return;
  const select = document.createElement('select');
  select.id = 'chat-waiting-send-mode';
  select.title = '待機カードの送信方法';
  select.setAttribute('aria-label', '待機カードの送信方法');
  select.innerHTML = '<option value="one-by-one">1件ずつ</option><option value="combined">まとめて</option><option value="consecutive">連続送信</option>';
  select.value = _chatQueueSendMode();
  select.style.cssText = 'min-width:92px;max-width:118px;padding:3px 5px;background:var(--bg3);color:var(--fg2);border:1px solid var(--border);border-radius:4px;font-size:11px;';
  select.addEventListener('change', () => _chatSetQueueSendMode(select.value));
  controls.appendChild(select);
}

function _chatEnhanceSelectAsListbox(select) {
  if (!select) return;
  let host = select.nextElementSibling;
  if (!host?.classList?.contains('meldex-chat-listbox')) {
    host = document.createElement('div');
    host.className = 'meldex-chat-listbox';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'meldex-chat-listbox-trigger';
    button.setAttribute('aria-haspopup', 'listbox');
    const popup = document.createElement('div');
    popup.className = 'meldex-chat-listbox-popup';
    popup.setAttribute('role', 'listbox');
    popup.hidden = true;
    button.addEventListener('click', () => {
      popup.hidden = !popup.hidden;
      button.setAttribute('aria-expanded', popup.hidden ? 'false' : 'true');
    });
    host.append(button, popup);
    select.insertAdjacentElement('afterend', host);
    select.style.display = 'none';
  }
  const trigger = host.querySelector('.meldex-chat-listbox-trigger');
  const popup = host.querySelector('.meldex-chat-listbox-popup');
  if (select.id) trigger.dataset.e2eId = select.dataset.e2eId || `${select.id}-trigger`;
  const selected = select.options[select.selectedIndex] || select.options[0];
  trigger.textContent = selected?.textContent || '選択';
  trigger.setAttribute('aria-expanded', popup.hidden ? 'false' : 'true');
  popup.innerHTML = '';
  Array.from(select.options).forEach(option => {
    const row = document.createElement('button');
    row.type = 'button';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', option.value === select.value ? 'true' : 'false');
    row.disabled = option.disabled;
    row.textContent = option.textContent;
    row.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      popup.hidden = true;
      trigger.textContent = option.textContent;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    });
    popup.appendChild(row);
  });
}

function _chatDecorateHistoryList() {
  const list = document.getElementById('chat-history-list');
  if (!list) return;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'AIチャット履歴');
  list.querySelectorAll('[data-chat-session-id]').forEach(row => {
    row.setAttribute('role', 'option');
    const sessionId = String(row.dataset.chatSessionId || '');
    const working = String(_chatState.activeExecution?.sessionId || '') === sessionId;
    const unread = row.dataset.chatUnread === '1';
    row.querySelector('.chat-list-state-icons')?.remove();
    if (!working && !unread) return;
    const icons = document.createElement('span');
    icons.className = 'chat-list-state-icons';
    icons.setAttribute('aria-label', [working ? 'AI作業中' : '', unread ? '未読' : ''].filter(Boolean).join('、'));
    icons.textContent = (working ? '●' : '') + (unread ? ' •' : '');
    row.firstElementChild?.appendChild(icons);
  });
}

_chatRestoreQueuedMessages();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _chatInstallQueueModeControl, { once: true });
else _chatInstallQueueModeControl();
window.MeldexChatListbox = { enhance: _chatEnhanceSelectAsListbox, decorateHistory: _chatDecorateHistoryList };

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
