/* gb-right-panel-chat.js: right panel chat / team chat / history */
const _CHAT_SOURCE_FOLDER_STORAGE_KEY = 'chat-source-folder';
const _CHAT_WORKSPACE_STORAGE_KEY = 'chat-workspace-id';
const CHAT_ROOM_GENERATION_STORAGE_KEYS = [
  'chat-allow-web-search',
  'chat-auto-compress',
  'chat-allow-code-execution',
  'chat-reasoning-level',
  'chat-param-preset',
  'chat-temperature',
  'chat-max-tokens',
  'chat-top-p',
];
const _chatState = { messages: [], streaming: false, provider: 'gemini', model: '', pendingModel: '', sessionId: '', targetPath: '', lastImplicitTargetPath: '', sessionTitle: '', sourceFolder: String(localStorage.getItem(_CHAT_SOURCE_FOLDER_STORAGE_KEY) || ''), workspaceId: String(localStorage.getItem(_CHAT_WORKSPACE_STORAGE_KEY) || ''), modelsByProvider: {}, abortController: null, streamingTargetPath: '', queuedMessages: [], queuedScope: null, queuedSendRunning: false, stopSerial: 0 };
let _chatMode = localStorage.getItem('chat-mode') || 'team';
if (_chatMode === 'cli') _chatMode = 'history';
let _teamCurrentRoom = '';
let _teamPollTimer = null;
let _teamLastTimestamp = '';
let _teamRoomsCache = [];
let _teamPendingAttachments = [];
let _teamSessionGen = 0;
let _chatLastSubmitFingerprint = '';
let _chatLastSubmitAt = 0;
let _chatSourceFoldersCache = [];
let _chatVaultsCache = [];
let _chatWorkspacesCache = [];
let _chatVaultInfo = { path: '', name: '' };

function _chatIsLiveElement(el, options = {}) {
  if (!el) return false;
  if (el.isConnected === false) return false;
  if (el.closest('#legacy-views,.gb-legacy-snapshot-host,[data-gb-snapshot="true"],[aria-hidden="true"],[inert]')) return false;
  if (options.allowHidden) return true;
  return el.getClientRects().length > 0 || el.offsetParent !== null;
}

function _chatLiveElement(id, options = {}) {
  const first = document.getElementById(id);
  if (_chatIsLiveElement(first, options)) return first;
  return Array.from(document.querySelectorAll(`[id="${id}"]`)).find(el => _chatIsLiveElement(el, options)) || null;
}

function _chatLiveMessagesContainer() {
  return _chatLiveElement('chat-messages');
}

const CHAT_SCROLL_BOTTOM_THRESHOLD = 48;

function _chatIsScrolledNearBottom(container) {
  if (!container) return true;
  const gap = container.scrollHeight - container.scrollTop - container.clientHeight;
  return gap <= CHAT_SCROLL_BOTTOM_THRESHOLD;
}

function _chatScrollToBottom(container) {
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}

function _chatShouldStickToBottom(container, force = false) {
  return !!force || _chatIsScrolledNearBottom(container);
}

function _chatScrollToBottomIf(container, shouldScroll) {
  if (shouldScroll) _chatScrollToBottom(container);
}

function _chatCopyIconHtml(size = 12) {
  return typeof lucide === 'function' ? lucide('copy', size) : 'Copy';
}

function _chatCopyTextFallback(text) {
  if (typeof document === 'undefined' || !document.body) return false;
  const textarea = document.createElement('textarea');
  textarea.value = String(text || '');
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(textarea);
  const selection = typeof document.getSelection === 'function' ? document.getSelection() : null;
  const ranges = [];
  if (selection) {
    for (let i = 0; i < selection.rangeCount; i += 1) ranges.push(selection.getRangeAt(i).cloneRange());
  }
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  textarea.remove();
  if (selection) {
    selection.removeAllRanges();
    ranges.forEach(range => selection.addRange(range));
  }
  return ok;
}

async function _chatCopyText(text, okMessage = 'コピーしました') {
  const value = String(text ?? '');
  if (!value) {
    if (typeof showStatus === 'function') showStatus('コピーする内容がありません', true);
    return false;
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else if (!_chatCopyTextFallback(value)) {
      throw new Error('clipboard unavailable');
    }
    if (typeof showStatus === 'function') showStatus(okMessage);
    return true;
  } catch (err) {
    if (_chatCopyTextFallback(value)) {
      if (typeof showStatus === 'function') showStatus(okMessage);
      return true;
    }
    if (typeof showStatus === 'function') showStatus('コピーに失敗: ' + (err?.message || err), true);
    return false;
  }
}

window.GBChatCopyText = _chatCopyText;

async function _chatWaitForLiveMessagesContainer() {
  for (let i = 0; i < 8; i++) {
    const container = _chatLiveMessagesContainer();
    if (container) return container;
    await new Promise(resolve => setTimeout(resolve, i === 0 ? 0 : 40));
  }
  return null;
}

const CHAT_DEFAULT_MODELS = {
  gemini: ['gemini-2.5-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite-preview'],
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-5.4-mini', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-nano'],
  codex: ['Codex CLI'],
  claude_code: ['Claude Code'],
  gemini_cli: ['Gemini CLI'],
};
const CHAT_PROVIDER_META = {
  gemini: { label: 'Gemini', iconColor: '#8ab4f8', iconBg: 'rgba(138,180,248,0.14)', iconBorder: 'rgba(138,180,248,0.48)' },
  anthropic: { label: 'Claude', iconColor: '#d97745', iconBg: 'rgba(217,119,69,0.14)', iconBorder: 'rgba(217,119,69,0.48)' },
  openai: { label: 'ChatGPT', iconColor: '#10a37f', iconBg: 'rgba(16,163,127,0.14)', iconBorder: 'rgba(16,163,127,0.48)' },
  codex: { label: 'Codex CLI', iconColor: '#10a37f', iconBg: 'rgba(16,163,127,0.14)', iconBorder: 'rgba(16,163,127,0.48)' },
  claude_code: { label: 'Claude Code', iconColor: '#d97745', iconBg: 'rgba(217,119,69,0.14)', iconBorder: 'rgba(217,119,69,0.48)' },
  gemini_cli: { label: 'Gemini CLI', iconColor: '#8ab4f8', iconBg: 'rgba(138,180,248,0.14)', iconBorder: 'rgba(138,180,248,0.48)' },
};
const CHAT_CLI_PROVIDERS = {
  codex: { label: 'Codex CLI', command: 'codex' },
  claude_code: { label: 'Claude Code', command: 'claude' },
  gemini_cli: { label: 'Gemini CLI', command: 'gemini' },
};
const CHAT_MODELS_CACHE_TTL = 24 * 60 * 60 * 1000;
const CHAT_MODELS_CACHE_VERSION = 3;
const CHAT_COST_TABLE_PER_MILLION = {
  gemini: {
    default: { input: 0.30, output: 2.50 },
    'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  },
  anthropic: {
    default: { input: 3.00, output: 15.00 },
    'claude-haiku': { input: 1.00, output: 5.00 },
    'claude-opus': { input: 5.00, output: 25.00 },
  },
  openai: {
    default: { input: 0.75, output: 4.50 },
    'gpt-5.5': { input: 5.00, output: 30.00 },
    'gpt-5.4-mini': { input: 0.75, output: 4.50 },
    'gpt-5.4-nano': { input: 0.15, output: 0.90 },
    'gpt-5.4': { input: 2.50, output: 15.00 },
  },
};

function _chatProviderKey(provider) {
  return String(provider || '').trim().toLowerCase() || 'gemini';
}

function _chatIsCliProvider(provider) {
  return Object.prototype.hasOwnProperty.call(CHAT_CLI_PROVIDERS, _chatProviderKey(provider));
}

function _chatDefaultModel(provider) {
  const list = CHAT_DEFAULT_MODELS[_chatProviderKey(provider)] || [];
  return list[0] || '';
}

function _chatModelCacheKey(provider) {
  return 'chat-models:' + _chatProviderKey(provider);
}

function _chatRoomSettingsSourceFolder(sourceFolder) {
  if (sourceFolder != null) return String(sourceFolder || '').trim();
  if (typeof _chatWorkspaceIdValue === 'function' && _chatWorkspaceIdValue()) return 'workspace:' + _chatWorkspaceIdValue();
  if (typeof _chatSourceFolderValue === 'function') return String(_chatSourceFolderValue() || '').trim();
  return String(_chatState.sourceFolder || '').trim();
}

function _chatLegacyRoomSettingsKey(roomPath) {
  const path = String(roomPath || '').trim();
  return path ? 'chat-room-llm-settings:' + encodeURIComponent(path) : '';
}

function _chatRoomSettingsKey(roomPath, sourceFolder) {
  const path = String(roomPath || '').trim();
  if (!path) return '';
  const source = _chatRoomSettingsSourceFolder(sourceFolder);
  return 'chat-room-llm-settings:v2:' + encodeURIComponent(source) + ':' + encodeURIComponent(path);
}

function _chatReadRoomModelSettingsKey(key) {
  if (!key) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    if (parsed && typeof parsed === 'object') {
      const provider = _chatProviderKey(parsed.provider || '');
      const model = String(parsed.model || '').trim();
      const generation = parsed.generation && typeof parsed.generation === 'object' ? parsed.generation : null;
      return { provider, model, generation };
    }
  } catch {}
  return null;
}

function _chatLoadRoomModelSettings(roomPath) {
  const source = _chatRoomSettingsSourceFolder();
  const saved = _chatReadRoomModelSettingsKey(_chatRoomSettingsKey(roomPath, source));
  if (saved) return saved;
  return source ? null : _chatReadRoomModelSettingsKey(_chatLegacyRoomSettingsKey(roomPath));
}

function _chatGenerationStorageSnapshot() {
  const snapshot = {};
  CHAT_ROOM_GENERATION_STORAGE_KEYS.forEach(key => {
    const value = localStorage.getItem(key);
    if (value != null) snapshot[key] = value;
  });
  return snapshot;
}

function _chatApplyGenerationStorageSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  CHAT_ROOM_GENERATION_STORAGE_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
      localStorage.setItem(key, String(snapshot[key]));
    } else {
      localStorage.removeItem(key);
    }
  });
}

function _chatSaveCurrentRoomModelSettings() {
  if (typeof _chatMode === 'undefined' || _chatMode !== 'team' || !_teamCurrentRoom) return;
  const key = _chatRoomSettingsKey(_teamCurrentRoom);
  if (!key) return;
  localStorage.setItem(key, JSON.stringify({
    provider: _chatProviderKey(_chatState.provider),
    model: String(_chatState.model || '').trim(),
    generation: _chatGenerationStorageSnapshot(),
    savedAt: Date.now(),
  }));
}

function _chatApplyRoomModelSettings(roomPath) {
  const saved = _chatLoadRoomModelSettings(roomPath);
  const provider = _chatProviderKey(saved?.provider || localStorage.getItem('chat-provider') || _chatState.provider);
  const model = saved?.model || localStorage.getItem('chat-model:' + provider) || localStorage.getItem('chat-model') || _chatDefaultModel(provider);
  _chatState.provider = provider;
  _chatState.model = model;
  _chatState.pendingModel = model;
  if (saved?.generation) _chatApplyGenerationStorageSnapshot(saved.generation);
  _safeSetValue('chat-provider', provider);
  if (typeof updateChatModels === 'function') {
    updateChatModels({ preferredModel: model, suppressNotify: true, skipGlobalPersist: true, skipRoomPersist: true });
  }
}

function _chatUnavailableModelNoticeKey(provider, model) {
  return 'chat-model-unavailable-notice:' + _chatProviderKey(provider) + ':' + String(model || '');
}

function _chatNotifyUnavailableModel(provider, previousModel, nextModel) {
  const prior = String(previousModel || '').trim();
  if (!prior) return;
  const key = _chatUnavailableModelNoticeKey(provider, prior);
  if (localStorage.getItem(key) === '1') return;
  localStorage.setItem(key, '1');
  const message = `選択していたモデル「${prior}」は現在のモデル一覧にありません。代わりに「${nextModel || '利用可能なモデル'}」を選択しました。`;
  if (typeof showStatus === 'function') showStatus(message);
}

function _chatNormalizeModels(models, provider) {
  const seen = new Set();
  const list = Array.isArray(models) ? models : [];
  const result = [];
  list.forEach(item => {
    const id = typeof item === 'string' ? item : String(item?.id || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    result.push({ id, name: String((typeof item === 'string' ? item : item?.name) || id) });
  });
  if (result.length) return result;
  return (CHAT_DEFAULT_MODELS[_chatProviderKey(provider)] || []).map(id => ({ id, name: id }));
}

function getProviderIconHtml(provider, size = 16) {
  const meta = CHAT_PROVIDER_META[_chatProviderKey(provider)] || { label: 'LLM' };
  const box = Number(size) + 6;
  const bg = meta.iconBg || 'var(--bg3)';
  const color = meta.iconColor || 'var(--fg2)';
  const border = meta.iconBorder || 'var(--border)';
  return `<span class="chat-provider-icon" style="display:inline-flex;align-items:center;justify-content:center;width:${box}px;height:${box}px;border-radius:50%;background:${bg};color:${color};border:1px solid ${border};box-sizing:border-box;flex:0 0 auto;" title="${esc(meta.label)}" aria-label="${esc(meta.label)}">${lucide('bot', size)}</span>`;
}

function getProviderLabel(provider, model) {
  if (model) return model;
  const meta = CHAT_PROVIDER_META[_chatProviderKey(provider)];
  return meta ? meta.label : (provider || 'LLM');
}

function chatAllowWebSearch() {
  return localStorage.getItem('chat-allow-web-search') !== '0';
}

function chatAllowAutoCompress() {
  return localStorage.getItem('chat-auto-compress') === '1';
}

function chatAllowCodeExecution() {
  return localStorage.getItem('chat-allow-code-execution') === '1';
}

function _chatInstructionScopeKey(base) {
  const source = _chatSourceFolderValue();
  return source ? `${base}:${encodeURIComponent(source)}` : '';
}

function chatCustomInstructionSettings() {
  const sourceAboutKey = _chatInstructionScopeKey('chat-custom-about');
  const sourceInstructionsKey = _chatInstructionScopeKey('chat-custom-instructions');
  return {
    custom_about: localStorage.getItem('chat-custom-about') || '',
    custom_instructions: localStorage.getItem('chat-custom-instructions') || '',
    source_custom_about: sourceAboutKey ? (localStorage.getItem(sourceAboutKey) || '') : '',
    source_custom_instructions: sourceInstructionsKey ? (localStorage.getItem(sourceInstructionsKey) || '') : '',
  };
}

function chatGenerationSettings() {
  const preset = localStorage.getItem('chat-param-preset') || 'standard';
  const presetTemperature = preset === 'creative' ? 1.2 : preset === 'strict' ? 0.2 : 0.7;
  const temperatureRaw = localStorage.getItem('chat-temperature');
  const maxTokensRaw = localStorage.getItem('chat-max-tokens');
  const topPRaw = localStorage.getItem('chat-top-p');
  const temperature = temperatureRaw !== null && temperatureRaw !== '' ? Number(temperatureRaw) : presetTemperature;
  const maxTokens = maxTokensRaw ? Number(maxTokensRaw) : 8192;
  const topP = topPRaw !== null && topPRaw !== '' ? Number(topPRaw) : null;
  return {
    reasoning_level: localStorage.getItem('chat-reasoning-level') || 'off',
    temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : presetTemperature,
    max_tokens: Number.isFinite(maxTokens) ? Math.max(1024, Math.min(32768, Math.floor(maxTokens))) : 8192,
    top_p: Number.isFinite(topP) ? Math.max(0, Math.min(1, topP)) : undefined,
  };
}

function _chatRenderThinking(el, text) {
  if (!el) return;
  el.querySelectorAll(':scope > .chat-thinking-process').forEach(details => details.remove());
}

function _chatUsageTokens(usage) {
  const u = (usage && typeof usage === 'object') ? usage : {};
  const input = Number(u.input_tokens ?? u.prompt_tokens ?? u.prompt_token_count ?? 0) || 0;
  const output = Number(u.output_tokens ?? u.completion_tokens ?? u.candidates_token_count ?? 0) || 0;
  const total = Number(u.total_tokens ?? u.total_token_count ?? (input + output)) || (input + output);
  return { input, output, total };
}

function _chatCostRate(provider, model) {
  const table = CHAT_COST_TABLE_PER_MILLION[_chatProviderKey(provider)] || {};
  const modelId = String(model || '').toLowerCase();
  for (const [prefix, rate] of Object.entries(table)) {
    if (prefix !== 'default' && modelId.startsWith(prefix)) return rate;
  }
  return table.default || { input: 0, output: 0 };
}

function _chatEstimateCost(usage, provider, model) {
  const tokens = _chatUsageTokens(usage);
  const rate = _chatCostRate(provider, model);
  return (tokens.input * rate.input + tokens.output * rate.output) / 1000000;
}

// 2026-05-06時点の丸めた目安。請求額ではなく日本円感覚を掴むための表示用。
const CHAT_USD_JPY_APPROX_RATE = 156;

function _chatFormatApproxJpy(usd) {
  const amount = Number(usd || 0) * CHAT_USD_JPY_APPROX_RATE;
  if (!Number.isFinite(amount) || amount === 0) return '約0円';
  if (Math.abs(amount) < 1) {
    return '約' + amount.toFixed(2).replace(/\.?0+$/, '') + '円';
  }
  return '約' + Math.round(amount).toLocaleString('ja-JP') + '円';
}

function _chatFormatUsdWithJpy(usd, decimals) {
  const number = Number(usd || 0);
  const fixed = Number.isFinite(decimals) ? decimals : (Math.abs(number) >= 1 ? 2 : 4);
  return '$' + number.toFixed(fixed) + '（' + _chatFormatApproxJpy(number) + '）';
}

function _chatUsageLabel(usage, provider, model) {
  if (!usage || typeof usage !== 'object') return '';
  const tokens = _chatUsageTokens(usage);
  if (!tokens.input && !tokens.output && !tokens.total) return '';
  const cost = _chatEstimateCost(usage, provider, model);
  const tokenLabel = `${tokens.input} in / ${tokens.output} out tokens`;
  return cost > 0 ? `${tokenLabel} - ${_chatFormatUsdWithJpy(cost, 4)}` : tokenLabel;
}

function _chatBudgetTone(used, limit) {
  const budget = Number(limit || 0);
  if (!budget) return 'normal';
  const ratio = Number(used || 0) / budget;
  if (ratio >= 1) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'normal';
}

async function chatRefreshUsageBanner() {
  // 使用量は設定ダイアログに集約し、チャット画面には表示しない。
  const banner = document.getElementById('chat-usage-banner');
  if (banner) banner.remove();
}

function _chatRenderUsage(el, usage, provider, model) {
  if (!el) return;
  el.querySelectorAll(':scope > .chat-usage').forEach(node => node.remove());
}

function _chatRenderToolAuditWarning(el, warning) {
  if (!el) return;
  el.querySelectorAll(':scope > .chat-tool-audit-warning').forEach(node => node.remove());
  const text = String(warning || '').replace(/\*\*/g, '').trim();
  if (!text) return;
  const box = document.createElement('div');
  box.className = 'chat-tool-audit-warning';
  box.style.cssText = 'margin:0 0 8px;padding:6px 8px;border-left:3px solid var(--red,#d9534f);background:rgba(217,83,79,0.12);color:var(--red,#ff8a80);font-weight:600;white-space:pre-wrap;';
  box.textContent = text;
  el.insertBefore(box, el.firstChild || null);
}

function _chatSessionUsage() {
  const total = { input: 0, output: 0, total: 0, cost: 0 };
  (_chatState.messages || []).forEach(message => {
    if (!message?.usage) return;
    const tokens = _chatUsageTokens(message.usage);
    total.input += tokens.input;
    total.output += tokens.output;
    total.total += tokens.total || (tokens.input + tokens.output);
    total.cost += _chatEstimateCost(message.usage, message.provider || _chatState.provider, message.model || _chatState.model);
  });
  return total;
}

function _chatRenderSessionUsageSummary() {
  const container = _chatLiveMessagesContainer();
  if (!container) return;
  container.querySelectorAll('.chat-session-usage-summary').forEach(el => el.remove());
}

function _chatCodeExecBlockId(block) {
  if (!block.id) block.id = 'code_exec_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  return block.id;
}

function _chatCodeExecStatusLabel(block) {
  if (block.status === 'done') {
    const exit = Number.isFinite(Number(block.exit_code)) ? ` / exit ${Number(block.exit_code)}` : '';
    const duration = Number.isFinite(Number(block.duration_ms)) ? ` / ${(Number(block.duration_ms) / 1000).toFixed(1)}s` : '';
    return `完了${exit}${duration}`;
  }
  if (block.status === 'error') return 'エラー';
  return '実行中';
}

function _chatCodeExecOutput(block) {
  const out = [];
  if (block.stdout) out.push(String(block.stdout));
  if (block.stderr) out.push('[stderr]\n' + String(block.stderr));
  if (block.result) out.push(String(block.result));
  return out.join('\n').trim();
}

function _chatAttachPreCopyButton(pre, text, okMessage = 'コードをコピーしました') {
  if (!pre || !String(text || '')) return;
  if (!pre.style.position) pre.style.position = 'relative';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-code-copy-btn';
  btn.title = 'コピー';
  btn.setAttribute('aria-label', 'コピー');
  btn.innerHTML = _chatCopyIconHtml(12);
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    _chatCopyText(text, okMessage);
  });
  pre.appendChild(btn);
}

function _chatRenderCodeExecBlock(block, parent) {
  const container = parent || _chatLiveMessagesContainer();
  if (!container || !block) return null;
  const id = _chatCodeExecBlockId(block);
  let el = Array.from(container.querySelectorAll('[data-code-exec-id]')).find(node => node.dataset.codeExecId === id);
  if (!el) {
    el = document.createElement('div');
    el.className = 'chat-code-exec';
    el.dataset.codeExecId = id;
    el.style.cssText = parent
      ? 'margin-top:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);padding:8px;font-size:11px;color:var(--fg2);white-space:normal;'
      : 'align-self:flex-start;max-width:85%;border:1px solid var(--border);border-radius:6px;background:var(--bg2);padding:8px;font-size:11px;color:var(--fg2);white-space:normal;';
    container.appendChild(el);
  }
  const code = String(block.code || '').trim();
  const output = _chatCodeExecOutput(block);
  const artifacts = Array.isArray(block.artifacts) ? block.artifacts : [];
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;font-weight:600;color:var(--fg);">${lucide('terminal', 13)} Python 実行 <span style="margin-left:auto;font-weight:400;color:var(--fg2);">${esc(_chatCodeExecStatusLabel(block))}</span></div>
    ${code ? `<details style="margin-top:6px;"><summary style="cursor:pointer;">コードを表示</summary><pre style="margin:6px 0 0;white-space:pre-wrap;font-family:var(--mono-font, monospace);font-size:11px;line-height:1.45;color:var(--fg);">${esc(code)}</pre></details>` : ''}
    ${output ? `<pre style="margin:6px 0 0;max-height:160px;overflow:auto;white-space:pre-wrap;font-family:var(--mono-font, monospace);font-size:11px;line-height:1.45;color:var(--fg);">${esc(output)}</pre>` : ''}
  `;
  const pres = Array.from(el.querySelectorAll('pre'));
  if (code && pres[0]) _chatAttachPreCopyButton(pres[0], code, 'コードをコピーしました');
  if (output && pres[pres.length - 1]) _chatAttachPreCopyButton(pres[pres.length - 1], output, '実行結果をコピーしました');
  if (artifacts.length) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;';
    artifacts.forEach(artifact => {
      const url = String(artifact?.url || artifact?.data_url || artifact?.path || '').trim();
      const name = String(artifact?.name || artifact?.path || 'artifact').split(/[\\/]/).pop();
      if (!url) return;
      if (/^data:image\//i.test(url) || /\.(png|jpe?g|webp|gif)$/i.test(name)) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = name;
        img.title = name;
        img.style.cssText = 'max-width:220px;max-height:160px;border:1px solid var(--border);border-radius:4px;background:var(--bg);cursor:pointer;';
        img.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
        row.appendChild(img);
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.target = '_blank';
        a.rel = 'noopener';
        a.style.cssText = 'display:inline-flex;align-items:center;gap:4px;color:var(--accent);';
        a.innerHTML = lucide('fileDown', 12) + esc(name);
        row.appendChild(a);
      }
    });
    el.appendChild(row);
  }
  return el;
}

function chatRenderCodeExecBlocks(parent, blocks) {
  if (!parent || !Array.isArray(blocks)) return;
  blocks.forEach(block => _chatRenderCodeExecBlock(block, parent));
}

function _chatEnsureCodeExecBlock(blocks, incoming = {}) {
  const list = Array.isArray(blocks) ? blocks : [];
  const id = incoming.id || list[list.length - 1]?.id;
  let block = id ? list.find(item => item.id === id) : null;
  if (!block || incoming.type === 'code_exec_start') {
    block = { id: incoming.id || undefined, language: incoming.language || 'python', code: '', stdout: '', stderr: '', artifacts: [], status: 'running' };
    _chatCodeExecBlockId(block);
    list.push(block);
  }
  return block;
}

function chatHandleCodeExecutionEvent(data, blocks, parent = null) {
  const block = _chatEnsureCodeExecBlock(blocks, data || {});
  if (data.type === 'code_exec_start') {
    block.language = data.language || 'python';
    if (data.code) block.code = String(data.code);
    block.status = 'running';
  } else if (data.type === 'code_exec_stdout') {
    block.stdout = (block.stdout || '') + String(data.content || '');
  } else if (data.type === 'code_exec_stderr') {
    block.stderr = (block.stderr || '') + String(data.content || '');
  } else if (data.type === 'code_exec_image') {
    block.artifacts = block.artifacts || [];
    block.artifacts.push({ type: 'image', name: data.name || 'image.png', url: data.url || data.data_url || data.path || '' });
  } else if (data.type === 'code_exec_file') {
    block.artifacts = block.artifacts || [];
    block.artifacts.push({ type: 'file', name: data.name || 'artifact', url: data.url || data.data_url || data.path || '' });
  } else if (data.type === 'code_exec_done') {
    block.status = 'done';
    block.duration_ms = data.duration_ms;
    block.exit_code = data.exit_code;
    if (data.result) block.result = String(data.result);
  }
  _chatRenderCodeExecBlock(block, parent);
  return block;
}

async function loadProviderModels(provider, options = {}) {
  const key = _chatProviderKey(provider);
  const force = !!options.force;
  if (_chatIsCliProvider(key)) {
    const model = _chatDefaultModel(key);
    _chatState.modelsByProvider[key] = model ? [{ id: model, name: model }] : [];
    return _chatState.modelsByProvider[key];
  }
  if (!force && _chatState.modelsByProvider[key]?.length) return _chatState.modelsByProvider[key];
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(_chatModelCacheKey(key)) || 'null');
      if (cached?.version === CHAT_MODELS_CACHE_VERSION && cached?.time && Date.now() - cached.time < CHAT_MODELS_CACHE_TTL && Array.isArray(cached.models)) {
        _chatState.modelsByProvider[key] = _chatNormalizeModels(cached.models, key);
        return _chatState.modelsByProvider[key];
      }
    } catch {}
  }
  try {
    const data = await apiFetch('/chat/models?provider=' + encodeURIComponent(key) + '&refresh=' + (force ? 'true' : 'false'));
    const models = _chatNormalizeModels(data?.models, key);
    _chatState.modelsByProvider[key] = models;
    if (!data?.fallback) {
      localStorage.setItem(_chatModelCacheKey(key), JSON.stringify({ version: CHAT_MODELS_CACHE_VERSION, time: Date.now(), models }));
    }
    return models;
  } catch (error) {
    if (force) throw error;
    const existing = _chatState.modelsByProvider[key];
    if (Array.isArray(existing) && existing.length) return existing;
    const fallback = _chatNormalizeModels([], key);
    _chatState.modelsByProvider[key] = fallback;
    return fallback;
  }
}

function _currentChatModelSelection(provider, models, options = {}) {
  const storedModel = localStorage.getItem('chat-model:' + _chatProviderKey(provider)) || localStorage.getItem('chat-model') || '';
  const current = options.preferredModel || _chatState.pendingModel || _chatState.model || storedModel || _chatDefaultModel(provider);
  const modelIds = new Set((models || []).map(item => item.id));
  const selected = modelIds.has(current) ? current : ((models || [])[0]?.id || _chatDefaultModel(provider));
  if (current && selected && current !== selected && modelIds.size && !options.suppressNotify) _chatNotifyUnavailableModel(provider, current, selected);
  if (selected === _chatState.pendingModel) _chatState.pendingModel = '';
  return { value: selected, model: selected };
}

function _renderChatModelOptions(models, options = {}) {
  const provider = _chatProviderKey(_chatState.provider);
  const sel = document.getElementById('chat-model');
  if (!sel) return;
  const normalized = _chatNormalizeModels(models, provider);
  const selection = _currentChatModelSelection(provider, normalized, options);
  sel.innerHTML = '';
  normalized.forEach(model => {
    const o = document.createElement('option');
    o.value = model.id;
    o.textContent = model.name || model.id;
    sel.appendChild(o);
  });
  sel.value = selection.value;
  _chatState.model = sel.value || selection.model || _chatDefaultModel(provider);
  if (!options.skipGlobalPersist) {
    localStorage.setItem('chat-model', _chatState.model || '');
    localStorage.setItem('chat-model:' + provider, _chatState.model || '');
  }
  if (!options.skipRoomPersist) _chatSaveCurrentRoomModelSettings();
}

// プロバイダ変更時にモデル一覧を更新
(function _bindChatProviderChange() {
  const el = document.getElementById('chat-provider');
  if (!el) return;
  el.onchange = function() {
    _chatState.provider = this.value;
    localStorage.setItem('chat-provider', this.value);
    _chatState.model = localStorage.getItem('chat-model:' + _chatProviderKey(this.value)) || _chatDefaultModel(this.value);
    _chatState.pendingModel = _chatState.model;
    updateChatModels();
    _chatRefreshApiKeyState().catch(() => {});
  };
})();
function updateChatModels(options = {}) {
  const provider = _chatProviderKey(_chatState.provider);
  _renderChatModelOptions(_chatState.modelsByProvider[provider] || _chatNormalizeModels([], provider), {
    ...options,
    suppressNotify: true,
    skipGlobalPersist: true,
    skipRoomPersist: true,
  });
  _chatRefreshApiKeyState().catch(() => {});
  loadProviderModels(provider).then(models => {
    if (_chatProviderKey(_chatState.provider) === provider) _renderChatModelOptions(models, options);
  }).catch(() => {});
}
(function _bindChatModelChange() {
  const el = document.getElementById('chat-model');
  if (!el) return;
  el.onchange = function() {
    const provider = _chatProviderKey(_chatState.provider);
    _chatState.model = this.value || _chatDefaultModel(provider);
    localStorage.setItem('chat-model', _chatState.model || '');
    localStorage.setItem('chat-model:' + provider, _chatState.model || '');
    _chatState.pendingModel = '';
    _chatSaveCurrentRoomModelSettings();
  };
})();

function chatRefreshModels() {
  const provider = _chatProviderKey(_chatState.provider);
  loadProviderModels(provider, { force: true }).then(models => {
    if (_chatProviderKey(_chatState.provider) === provider) _renderChatModelOptions(models);
    if (typeof showStatus === 'function') showStatus('モデル一覧を更新しました');
  }).catch(error => {
    if (typeof showStatus === 'function') showStatus('モデル一覧の更新に失敗: ' + (error?.message || error), true);
  });
}

(function _initChatProviderAndModels() {
  const run = () => {
    const storedProvider = _chatProviderKey(localStorage.getItem('chat-provider') || _chatState.provider);
    _chatState.provider = storedProvider;
    _chatState.model = localStorage.getItem('chat-model:' + storedProvider) || localStorage.getItem('chat-model') || _chatDefaultModel(storedProvider);
    _chatState.pendingModel = _chatState.model;
    const providerEl = document.getElementById('chat-provider');
    if (providerEl) providerEl.value = storedProvider;
    updateChatModels();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

function _chatFallbackTitle(sessionId, targetPath) {
  const resolvedTargetPath = targetPath != null ? targetPath : _chatState.targetPath;
  const resolvedSessionId = sessionId != null ? sessionId : _chatState.sessionId;
  if (resolvedTargetPath) return resolvedTargetPath.split('/').pop();
  if (resolvedSessionId) return resolvedSessionId;
  return '新しいチャット';
}

function _chatListTitle(item) {
  const customTitle = String(item?.title || '').trim();
  if (customTitle) return customTitle;
  if (item?.targetPath) return item.targetPath.split('/').pop();
  return item?.name || '';
}

function _syncChatSessionTitleInput() {
  const input = document.getElementById('chat-session-title');
  if (!input) return;
  input.value = _chatState.sessionTitle || '';
  const fallbackTitle = _chatFallbackTitle('', _chatState.targetPath);
  input.placeholder = _chatState.targetPath ? `チャット名（既定: ${fallbackTitle}）` : 'チャット名（任意）';
}

function _setChatSessionTitle(title) {
  _chatState.sessionTitle = String(title || '').trim();
  _syncChatSessionTitleInput();
}

function _captureChatSessionTitleFromInput() {
  const input = document.getElementById('chat-session-title');
  if (!input) return _chatState.sessionTitle;
  _chatState.sessionTitle = input.value.trim();
  return _chatState.sessionTitle;
}

async function chatCommitSessionTitle(showSavedStatus = true) {
  const input = document.getElementById('chat-session-title');
  if (!input) return;
  const nextTitle = input.value.trim();
  const previousTitle = _chatState.sessionTitle || '';
  const changed = nextTitle !== previousTitle;
  _chatState.sessionTitle = nextTitle;
  if (!changed) return;
  renderChatHistory();
  if (_chatState.messages.length === 0) return;
  try {
    const saved = await chatAutoSave({ silent: false });
    if (!saved) throw new Error('チャット名を保存できませんでした');
    renderChatHistory();
    if (saved && showSavedStatus) showStatus('チャット名を保存しました');
  } catch (error) {
    _chatState.sessionTitle = previousTitle;
    _syncChatSessionTitleInput();
    renderChatHistory();
    if (typeof showStatus === 'function') showStatus('チャット名の保存に失敗: ' + (error?.message || error), true);
  }
}

(function _bindChatSessionTitleInput() {
  const el = document.getElementById('chat-session-title');
  if (!el) return;
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      chatCommitSessionTitle();
    }
  });
  el.addEventListener('blur', () => { chatCommitSessionTitle(false); });
})();

// チャットモード切替
function switchChatMode(mode) {
  const requestedMode = mode;
  if (mode === 'cli') {
    mode = 'history';
    try { localStorage.setItem('chat-history-view', 'cli'); } catch {}
  }
  _chatMode = mode;
  localStorage.setItem('chat-mode', mode);
  clearInterval(_teamPollTimer); // タイマー蓄積防止
  _teamPollTimer = null;
  if (typeof _chatSearchClose === 'function') _chatSearchClose(); // 検索バーを閉じる
  const llmPanel = _chatLiveElement('chat-llm-panel', { allowHidden: true });
  const teamPanel = _chatLiveElement('chat-team-panel', { allowHidden: true });
  const historyPanel = _chatLiveElement('chat-history-panel', { allowHidden: true });
  if (llmPanel) llmPanel.style.display = mode === 'llm' ? 'flex' : 'none';
  if (teamPanel) teamPanel.style.display = mode === 'team' ? 'flex' : 'none';
  if (historyPanel) historyPanel.style.display = mode === 'history' ? 'flex' : 'none';
  document.querySelectorAll('.chat-mode-tab').forEach(t => {
    const active = t.id === 'chat-tab-' + mode;
    t.classList.toggle('active', active);
    t.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
    t.style.color = active ? 'var(--accent)' : 'var(--fg2)';
    t.style.fontWeight = active ? 'bold' : 'normal';
  });
  if (mode === 'team') {
    loadTeamRooms().then(() => {
      if (_chatMode !== 'team' || !_teamCurrentRoom) return;
      loadTeamMessages();
      _restartTeamPolling();
    }).catch(() => {});
  }
  if (mode === 'llm') {
    _syncChatSessionTitleInput();
    if (typeof _chatSyncStreamingControls === 'function') _chatSyncStreamingControls();
  }
  if (mode === 'history') {
    const historyView = requestedMode === 'cli'
      ? 'cli'
      : (localStorage.getItem('chat-history-view') || 'saved');
    if (typeof switchChatHistoryView === 'function') switchChatHistoryView(historyView);
    else renderChatHistory();
  }
}

// チームチャット
function _teamChatUploadDir() {
  const roomPath = String(_teamCurrentRoom || '').replace(/^\/+/, '');
  const rel = roomPath ? '_chat/' + roomPath : '_chat';
  const workspaceId = typeof _chatWorkspaceIdValue === 'function' ? _chatWorkspaceIdValue() : '';
  if (workspaceId && Array.isArray(_chatWorkspacesCache)) {
    const workspace = _chatWorkspacesCache.find(item => item?.id === workspaceId);
    if (workspace?.folder) return workspace.folder.replace(/[\\/]+$/, '') + '/' + rel;
  }
  const sourceFolder = _chatSourceFolderValue();
  return sourceFolder ? (sourceFolder.replace(/[\\/]+$/, '') + '/' + rel) : rel;
}

function _restartTeamPolling() {
  clearInterval(_teamPollTimer);
  _teamPollTimer = null;
  if (_teamCurrentRoom && _chatMode === 'team') _teamPollTimer = setInterval(pollTeamMessages, 3000);
}

function _canonicalDmRoomName(a, b) {
  return [String(a || '').trim(), String(b || '').trim()].filter(Boolean).sort((x, y) => x.localeCompare(y, 'ja')).join('__');
}

function _isRoomVisibleToUser(room, username) {
  if (!room) return false;
  if (room.type !== 'dm') return true;
  const parts = Array.isArray(room.members) && room.members.length
    ? room.members
    : String(room.name || '').split('__').filter(Boolean);
  return parts.length < 2 || parts.includes(username);
}

function _roomDisplayName(room) {
  if (!room) return '';
  if (room.type !== 'dm') return room.name;
  const me = getUsername();
  const parts = Array.isArray(room.members) && room.members.length
    ? room.members
    : String(room.name || '').split('__').filter(Boolean);
  return parts.find(name => name !== me) || room.name;
}

function _isBuiltInGeneralRoom(room) {
  if (!room) return false;
  const type = String(room.type || 'general');
  return type === 'general' && (String(room.path || '') === 'general' || String(room.name || '') === 'general');
}

function _teamRoomByPath(roomPath) {
  const path = String(roomPath || '');
  if (!path) return null;
  return (_teamRoomsCache || []).find(item => item && item.path === path) || null;
}

function _clearTeamRoomSelection() {
  _chatSaveCurrentRoomModelSettings();
  _teamCurrentRoom = '';
  _teamLastTimestamp = '';
  _teamSessionGen++;
  _teamPendingAttachments = [];
  _safeSetHTML('team-messages', '');
  if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
  _renderTeamRoomTitle(null);
