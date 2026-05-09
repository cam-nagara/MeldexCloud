/* gb-right-panel-chat.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-right-panel-chat.part01.js */
/* gb-right-panel-chat.js: right panel chat / team chat / history */
const _CHAT_SOURCE_FOLDER_STORAGE_KEY = 'chat-source-folder';
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
const _chatState = { messages: [], streaming: false, provider: 'gemini', model: '', pendingModel: '', sessionId: '', targetPath: '', sessionTitle: '', sourceFolder: String(localStorage.getItem(_CHAT_SOURCE_FOLDER_STORAGE_KEY) || ''), modelsByProvider: {}, abortController: null, queuedMessages: [], queuedScope: null, queuedSendRunning: false, stopSerial: 0 };
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

function _chatRoomSettingsKey(roomPath) {
  const path = String(roomPath || '').trim();
  return path ? 'chat-room-llm-settings:' + encodeURIComponent(path) : '';
}

function _chatLoadRoomModelSettings(roomPath) {
  const key = _chatRoomSettingsKey(roomPath);
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
  const banner = document.getElementById('chat-usage-banner');
  if (!banner) return;
  try {
    const sessionParam = _chatState.sessionId ? '?session_id=' + encodeURIComponent(_chatState.sessionId) : '';
    const data = await apiFetch('/chat/budget' + sessionParam);
    const settings = data.settings || {};
    const totals = data.totals || {};
    const dayUsed = Number(totals.day?.cost_usd || 0);
    const monthUsed = Number(totals.month?.cost_usd || 0);
    const dayLimit = Number(settings.daily_budget_usd || 0);
    const monthLimit = Number(settings.monthly_budget_usd || 0);
    const tone = [_chatBudgetTone(dayUsed, dayLimit), _chatBudgetTone(monthUsed, monthLimit)].includes('danger')
      ? 'danger'
      : [_chatBudgetTone(dayUsed, dayLimit), _chatBudgetTone(monthUsed, monthLimit)].includes('warning') ? 'warning' : 'normal';
    banner.style.display = 'block';
    banner.style.borderColor = tone === 'danger' ? 'var(--danger,#d9534f)' : tone === 'warning' ? 'var(--warning,#d6a300)' : 'var(--border)';
    banner.style.color = tone === 'danger' ? 'var(--danger,#ff8a80)' : tone === 'warning' ? 'var(--warning,#ffd166)' : 'var(--fg2)';
    banner.textContent = `LLM使用量 今日 ${_chatFormatUsdWithJpy(dayUsed, 4)} / ${_chatFormatUsdWithJpy(dayLimit, 2)}、今月 ${_chatFormatUsdWithJpy(monthUsed, 4)} / ${_chatFormatUsdWithJpy(monthLimit, 2)}`;
  } catch {
    banner.style.display = 'none';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => chatRefreshUsageBanner().catch(() => {}), { once: true });
} else {
  chatRefreshUsageBanner().catch(() => {});
}

function _chatRenderUsage(el, usage, provider, model) {
  if (!el) return;
  let usageEl = el.querySelector(':scope > .chat-usage');
  const label = _chatUsageLabel(usage, provider, model);
  if (!label) {
    if (usageEl) usageEl.remove();
    return;
  }
  if (!usageEl) {
    usageEl = document.createElement('div');
    usageEl.className = 'chat-usage';
    usageEl.style.cssText = 'margin-top:6px;text-align:right;font-size:10px;color:var(--fg2);opacity:0.9;';
    el.appendChild(usageEl);
  }
  usageEl.textContent = label;
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
  const total = _chatSessionUsage();
  if (!total.input && !total.output && !total.total) return;
  const div = document.createElement('div');
  div.className = 'chat-session-usage-summary';
  div.style.cssText = 'align-self:center;color:var(--fg2);font-size:11px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg2);';
  div.textContent = `累計 ${total.input} in / ${total.output} out tokens - ${_chatFormatUsdWithJpy(total.cost, 4)}`;
  container.appendChild(div);
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
  } catch {
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
  _renderChatModelOptions(_chatState.modelsByProvider[provider] || _chatNormalizeModels([], provider), options);
  _chatRefreshApiKeyState().catch(() => {});
  loadProviderModels(provider).then(models => {
    if (_chatProviderKey(_chatState.provider) === provider) _renderChatModelOptions(models, options);
  });
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
  const changed = nextTitle !== (_chatState.sessionTitle || '');
  _chatState.sessionTitle = nextTitle;
  if (!changed) return;
  renderChatHistory();
  if (_chatState.messages.length === 0) return;
  try {
    const saved = await chatAutoSave();
    renderChatHistory();
    if (saved && showSavedStatus) showStatus('チャット名を保存しました');
  } catch {}
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
  _syncTeamRoomSelect(_teamRoomsCache);
  _restartTeamPolling();
}

function _syncTeamRoomSelect(rooms) {
  const select = document.getElementById('team-room-select');
  if (!select) return;
  const current = _teamCurrentRoom;
  const visibleRooms = (rooms || []).filter(room => !_isBuiltInGeneralRoom(room));
  select.innerHTML = '<option value="">ルームを選択</option>' + visibleRooms.map(room => {
    const label = room.type === 'dm' ? 'DM: ' + _roomDisplayName(room) : _roomDisplayName(room);
    return `<option value="${esc(room.path)}" ${room.path===current?'selected':''}>${esc(label)}</option>`;
  }).join('');
}

async function loadTeamRooms() {
  const list = document.getElementById('team-room-list');
  try {
    let rooms = await apiFetch(_chatApiPath('/collab/rooms'));
    const me = getUsername();
    rooms = rooms.filter(room => !_isBuiltInGeneralRoom(room) && _isRoomVisibleToUser(room, me));
    _teamRoomsCache = rooms;
    if (_teamCurrentRoom && !_teamRoomByPath(_teamCurrentRoom)) {
      _clearTeamRoomSelection();
    }
    _syncTeamRoomSelect(rooms);
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom));
    if (!list) return;
    list.style.display = 'none';
    list.innerHTML = rooms.map(r => {
      const active = r.path === _teamCurrentRoom;
      const lastBody = String(r.last?.text ?? '');
      const lastFrom = String(r.last?.from ?? '');
      const lastText = r.last ? esc((lastFrom ? lastFrom + ': ' : '') + lastBody.substring(0, 30)) : '';
      const typeIcon = { general: lucide('messagesSquare',12), dm: lucide('user',12), group: lucide('users',12), file: lucide('paperclip',12) }[r.type] || lucide('messagesSquare',12);
      const displayName = _roomDisplayName(r);
      return `<div data-room-path="${esc(r.path)}" data-room-name="${esc(r.name)}" data-room-type="${esc(r.type || 'general')}" data-room-display="${esc(displayName)}" data-action="selectTeamRoom('${esc(r.path).replace(/'/g, "\\'")}')" style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border);${active?'background:var(--bg4);':''}" title="${lastText}">` +
        `<div>${typeIcon} <span class="team-room-name">${esc(displayName)}</span></div>` +
        (lastText ? `<div style="font-size:10px;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${lastText}</div>` : '') +
        `</div>`;
    }).join('');
    // 右クリック/ダブルクリックでリネーム/削除
    list.querySelectorAll('[data-room-path]').forEach(row => {
      const room = { path: row.dataset.roomPath, name: row.dataset.roomName, type: row.dataset.roomType, displayName: row.dataset.roomDisplay };
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); showTeamRoomContextMenu(e, room); });
      if (typeof addLongPressHandler === 'function') {
        addLongPressHandler(row, (e) => showTeamRoomContextMenu(e, room));
      }
      row.addEventListener('dblclick', (e) => { if (room.type === 'dm') return; e.stopPropagation(); _doRenameTeamRoom(room); });
    });
  } catch(e) {
    if (list) {
      list.style.display = 'none';
      list.innerHTML = '';
    }
  }
}

function _teamRoomDeleteLabel(room) {
  return room?.type === 'dm' ? 'DMを閉じる' : 'ルームを削除';
}

function _renderTeamRoomTitle(room) {
  const title = document.getElementById('team-room-title');
  if (!title) return;
  title.innerHTML = '';
  title.style.display = 'flex';
  title.style.alignItems = 'center';
  title.style.gap = '6px';
  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  if (!room) {
    nameEl.textContent = 'ルームを選択';
    nameEl.style.color = 'var(--fg2)';
    title.appendChild(nameEl);
    return;
  }

  nameEl.textContent = _roomDisplayName(room) || room.name || room.path || '';
  if (room.type !== 'dm') {
    nameEl.tabIndex = 0;
    nameEl.title = 'クリックしてルーム名を編集';
    nameEl.style.cursor = 'text';
    nameEl.addEventListener('click', () => _beginTeamRoomTitleEdit(room));
    nameEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'F2') {
        event.preventDefault();
        _beginTeamRoomTitleEdit(room);
      }
    });
  }
  title.appendChild(nameEl);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.title = _teamRoomDeleteLabel(room);
  deleteBtn.setAttribute('aria-label', _teamRoomDeleteLabel(room));
  deleteBtn.innerHTML = lucide('trash2', 13);
  deleteBtn.style.cssText = 'margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:transparent;color:var(--fg2);border:1px solid transparent;border-radius:4px;cursor:pointer;padding:0;';
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    _deleteTeamRoom(room);
  });
  title.appendChild(deleteBtn);
}

function _beginTeamRoomTitleEdit(room) {
  if (!room || room.type === 'dm') return;
  const title = document.getElementById('team-room-title');
  if (!title) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = room.name || _roomDisplayName(room) || '';
  input.style.cssText = 'flex:1;min-width:0;font:inherit;font-weight:bold;background:var(--bg);color:var(--fg);border:1px solid var(--accent);border-radius:3px;padding:2px 6px;';
  title.innerHTML = '';
  title.appendChild(input);
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.title = '編集をキャンセル';
  cancelBtn.setAttribute('aria-label', '編集をキャンセル');
  cancelBtn.innerHTML = lucide('x', 13);
  cancelBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:transparent;color:var(--fg2);border:1px solid transparent;border-radius:4px;cursor:pointer;padding:0;';
  title.appendChild(cancelBtn);
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const nextName = input.value.trim();
    if (commit && nextName && nextName !== room.name) {
      await _renameTeamRoom(room, nextName);
      return;
    }
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom) || room);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  cancelBtn.addEventListener('mousedown', (event) => event.preventDefault());
  cancelBtn.addEventListener('click', () => finish(false));
  input.focus();
  input.select();
}

async function _deleteTeamRoom(room) {
  if (!room?.path) return;
  const ok = await cfConfirm(`ルーム「${_roomDisplayName(room) || room.name || room.path}」を本当に削除しますか？\n\n全メッセージが失われます。`);
  if (!ok) return;
  try {
    await apiFetch(_chatApiPath('/collab/rooms?path=' + encodeURIComponent(room.path)), { method: 'DELETE' });
    if (_teamCurrentRoom === room.path) _clearTeamRoomSelection();
    await loadTeamRooms();
    showStatus(room.type === 'dm' ? 'DMを閉じました' : 'ルームを削除しました');
  } catch (e) { showStatus('削除に失敗', true); }
}

async function _renameTeamRoom(room, newName) {
  if (!room?.path || room.type === 'dm') return;
  const name = String(newName || '').trim();
  if (!name || name === room.name) {
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom) || room);
    return;
  }
  try {
    const res = await apiPost(_chatApiPath('/collab/rooms/rename'), _chatPostPayload({ path: room.path, new_name: name }));
    if (_teamCurrentRoom === room.path && res?.path) {
      _teamCurrentRoom = res.path;
    }
    await loadTeamRooms();
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom) || { ...room, name, path: res?.path || room.path });
    showStatus('ルームをリネームしました');
  } catch (e) {
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom) || room);
    showStatus('リネームに失敗', true);
  }
}

// ルーム右クリックメニュー
function showTeamRoomContextMenu(e, room) {
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  if (room.type !== 'dm') {
    const renameItem = document.createElement('div');
    renameItem.className = 'gb-context-menu-item';
    renameItem.innerHTML = lucide('pencil', 14) + ' リネーム';
    renameItem.addEventListener('click', () => { menu.remove(); _doRenameTeamRoom(room); });
    menu.appendChild(renameItem);
  }
  const delItem = document.createElement('div');
  delItem.className = 'gb-context-menu-item';
  delItem.style.color = 'var(--red)';
  delItem.innerHTML = lucide('trash2', 14) + (room.type === 'dm' ? ' DMを閉じる' : ' ルームを削除');
  delItem.addEventListener('click', async () => {
    menu.remove();
    await _deleteTeamRoom(room);
  });
  menu.appendChild(delItem);
  document.body.appendChild(menu);
  const _z = (typeof _getZoom === 'function') ? _getZoom() : 1;
  menu.style.left = (e.clientX / _z) + 'px';
  menu.style.top = (e.clientY / _z) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closer); } };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

async function _doRenameTeamRoom(room) {
  const newName = await cfPrompt('新しいルーム名:', room.name);
  if (!newName || newName === room.name) return;
  await _renameTeamRoom(room, newName);
}

async function selectTeamRoom(roomPath) {
  if (!roomPath) {
    _clearTeamRoomSelection();
    return;
  }
  const hiddenGeneral = _isBuiltInGeneralRoom({ path: roomPath, name: roomPath, type: 'general' });
  if (hiddenGeneral) {
    _clearTeamRoomSelection();
    await loadTeamRooms();
    return;
  }
  _chatSaveCurrentRoomModelSettings();
  _teamCurrentRoom = roomPath;
  _chatApplyRoomModelSettings(roomPath);
  _teamLastTimestamp = '';
  _teamSessionGen++;
  _teamPendingAttachments = [];
  if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
  const room = _teamRoomByPath(roomPath) || { path: roomPath, name: roomPath.split('/').pop(), type: roomPath.startsWith('dm/') ? 'dm' : 'general' };
  _renderTeamRoomTitle(room);
  await loadTeamRooms(); // ハイライト更新
  await loadTeamMessages();
  // ポーリング開始
  _restartTeamPolling();
}

async function showDirectMessageModal() {
  const me = getUsername();
  let users = [];
  const seen = new Set([me]);
  try {
    const team = await apiFetch('/team');
    if (Array.isArray(team)) {
      team.forEach(member => {
        if (member.name && !seen.has(member.name)) {
          seen.add(member.name);
          users.push(member.name);
        }
      });
    }
  } catch {}
  try {
    const authUsers = await apiFetch('/auth/users');
    if (Array.isArray(authUsers)) {
      authUsers.forEach(user => {
        if (user.name && !seen.has(user.name)) {
          seen.add(user.name);
          users.push(user.name);
        }
      });
    }
  } catch {}
  users.sort((a, b) => a.localeCompare(b, 'ja'));
  if (!users.length) {
    showStatus('DMできるユーザーが見つかりません', true);
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:320px;">
    <h3>ダイレクトメッセージ</h3>
    <div class="field">
      <label>相手</label>
      <select id="team-dm-user" style="width:100%;padding:6px 8px;">
        ${users.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
      </select>
    </div>
    <div class="btn-row" style="margin-top:12px;">
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" id="team-dm-open">開く</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#team-dm-open')?.addEventListener('click', async () => {
    const openBtn = overlay.querySelector('#team-dm-open');
    const targetUser = overlay.querySelector('#team-dm-user')?.value;
    if (!targetUser) return;
    if (openBtn) openBtn.disabled = true;
    try {
      const roomName = _canonicalDmRoomName(me, targetUser);
      let room = _teamRoomsCache.find(item => item.type === 'dm' && item.name === roomName);
      if (!room) {
        const res = await apiPost(_chatApiPath('/collab/rooms'), _chatPostPayload({ name: roomName, type: 'dm' }));
        room = { name: roomName, path: res?.path || ('dm/' + roomName), type: 'dm' };
      }
      overlay.remove();
      await loadTeamRooms();
      await selectTeamRoom(room.path);
    } catch (e) {
      if (openBtn) openBtn.disabled = false;
      showStatus('DMを開けませんでした: ' + (e.message || ''), true);
    }
  });
}

document.getElementById('team-room-select')?.addEventListener('change', function() {
  selectTeamRoom(this.value);
});

// チームメッセージDOM生成（共通ヘルパー）
function _buildTeamMessageRow(m, me) {
  m = {
    ...(m || {}),
    from: String(m?.from ?? ''),
    text: typeof m?.text === 'string' ? m.text : (m?.text == null ? '' : String(m.text)),
  };
  const isMine = m.from === me;
  // 行: アバター + フキダシ（行全体でalign-selfで左右配置）
  const row = document.createElement('div');
  row.className = 'chat-message-row chat-message-row-team' + (isMine ? ' is-mine' : '');
  row.style.cssText = 'display:flex;gap:6px;max-width:85%;align-items:flex-start;' + (isMine ? 'align-self:flex-end;flex-direction:row-reverse;' : 'align-self:flex-start;flex-direction:row;');
  row.dataset.msgText = m.text;
  row.dataset.msgFrom = m.from;
  row.dataset.msgTime = m.timestamp || '';
  // アバター
  if (typeof _userAvatarSmall === 'function') {
    const avatar = document.createElement('span');
    avatar.style.cssText = 'flex-shrink:0;margin-top:2px;';
    avatar.innerHTML = _userAvatarSmall(m.from);
    // アバターを24pxに拡大
    avatar.querySelectorAll('img,span').forEach(el => { el.style.width = '24px'; el.style.height = '24px'; el.style.fontSize = '12px'; });
    row.appendChild(avatar);
  }
  // フキダシ
  const div = document.createElement('div');
  div.className = 'chat-message-bubble chat-message-bubble-team';
  div.style.cssText = (isMine
    ? 'background:var(--accent);color:var(--ui-fg-strong);padding:6px 10px;border-radius:10px 2px 10px 10px;'
    : 'background:var(--bg3);color:var(--fg);padding:6px 10px;border-radius:2px 10px 10px 10px;')
    + 'font-size:13px;user-select:text;cursor:text;';
  // 名前（自分以外）
  if (!isMine) {
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:10px;font-weight:bold;color:var(--accent);margin-bottom:2px;user-select:text;';
    nameEl.textContent = m.from;
    div.appendChild(nameEl);
  }
  // 本文
  const textEl = document.createElement('div');
  textEl.className = 'chat-message-text';
  textEl.style.cssText = 'white-space:pre-wrap;word-break:break-word;user-select:text;';
  const _so = typeof isStampOnly === 'function' && isStampOnly(m.text);
  const _hasImage = /!\[[^\]]*\]\([^)]+\)/.test(m.text || '');
  if (_so) {
    div.style.background = 'transparent'; div.style.padding = '4px';
    textEl.innerHTML = typeof renderStampsLarge === 'function' ? renderStampsLarge(esc(m.text)) : esc(m.text);
  } else if (typeof renderStamps === 'function' && m.text.includes('::stamp:')) {
    if (typeof renderChatMarkdown === 'function') renderChatMarkdown(textEl, m.text, { role: isMine ? 'user' : 'assistant' });
    else textEl.innerHTML = renderStamps(esc(m.text));
  } else if (_hasImage && typeof renderChatMarkdown !== 'function') {
    _renderTeamMessageWithImages(textEl, m.text);
  } else {
    if (typeof renderChatMarkdown === 'function') renderChatMarkdown(textEl, m.text, { role: isMine ? 'user' : 'assistant' });
    else textEl.textContent = m.text;
  }
  div.appendChild(textEl);
  // タイムスタンプ
  const timeEl = document.createElement('div');
  timeEl.style.cssText = 'font-size:9px;opacity:0.6;text-align:right;margin-top:2px;';
  timeEl.textContent = (m.timestamp || '').substring(11, 16);
  div.appendChild(timeEl);
  // 右クリックメニュー（コピー） ＋ 長押しで同メニュー（タッチ/ペン）
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _showChatMessageMenu(e, m);
  });
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(row, (e) => _showChatMessageMenu(e, m));
  }
  row.appendChild(div);
  return row;
}

// メッセージ右クリックメニュー
function _showChatMessageMenu(e, m) {
  document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  const items = [
    { icon: 'copy', label: 'テキストをコピー', action: () => _chatCopyText(m.text, 'テキストをコピーしました') },
    { icon: 'copy', label: '名前+テキストをコピー', action: () => _chatCopyText(m.from + ': ' + m.text, '名前とテキストをコピーしました') },
  ];
  items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
    el.innerHTML = lucide(it.icon, 14) + ' ' + it.label;
    el.addEventListener('click', () => { menu.remove(); it.action(); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  const _z = (typeof _getZoom === 'function') ? _getZoom() : 1;
  menu.style.left = (e.clientX / _z) + 'px';
  menu.style.top = (e.clientY / _z) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closer); } };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

async function loadTeamMessages() {
  if (!_teamCurrentRoom) return;
  const container = document.getElementById('team-messages');
  try {
    const msgs = await apiFetch(_chatApiPath('/collab/messages?room=' + encodeURIComponent(_teamCurrentRoom) + '&limit=100'));
    container.innerHTML = '';
    const me = getUsername();
    msgs.forEach(m => {
      container.appendChild(_buildTeamMessageRow(m, me));
      _teamLastTimestamp = m.timestamp || _teamLastTimestamp;
    });
    container.scrollTop = container.scrollHeight;
  } catch(e) {}
}

async function pollTeamMessages() {
  // v5.0: ペインシステムではright-panel.openクラスは使わない。
  // rp-chatがペインにマウントされているか（表示中か）を確認する。
  const rpChat = document.getElementById('rp-chat');
  const chatVisible = rpChat && rpChat.closest('.gb-pane-content') && rpChat.style.display !== 'none';
  if (!_teamCurrentRoom || _chatMode !== 'team' || !chatVisible) { clearInterval(_teamPollTimer); _teamPollTimer = null; return; }
  try {
    const msgs = await apiFetch(_chatApiPath('/collab/messages?room=' + encodeURIComponent(_teamCurrentRoom) + '&since=' + encodeURIComponent(_teamLastTimestamp)));
    if (msgs.length === 0) return;
    const container = document.getElementById('team-messages');
    const me = getUsername();
    msgs.forEach(m => {
      container.appendChild(_buildTeamMessageRow(m, me));
      _teamLastTimestamp = m.timestamp || _teamLastTimestamp;
    });
    container.scrollTop = container.scrollHeight;
  } catch(e) {}
}

async function teamSend() {
  if (!_teamCurrentRoom) { showStatus('ルームを選択してください', true); return; }
  const input = document.getElementById('team-input');
  const text = input.value.trim();
  const atts = _teamPendingAttachments || [];
  if (!text && atts.length === 0) return;
  const pendingBeforeSend = atts.slice();
  // 画像があれば末尾に Markdown 画像として付与
  let finalText = text;
  if (atts.length > 0) {
    const imgs = atts.map(a => `![${a.name}](/api/file-raw?path=${encodeURIComponent(a.path)})`).join('\n');
    finalText = text ? (text + '\n' + imgs) : imgs;
  }
  try {
    await apiPost(_chatApiPath('/collab/send'), _chatPostPayload({ room: _teamCurrentRoom, text: finalText, from: getUsername() }));
    input.value = '';
    _autoGrowTextarea(input, 2, 8);
    _teamPendingAttachments = [];
    if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
    await pollTeamMessages();
  } catch(e) {
    input.value = text;
    _teamPendingAttachments = pendingBeforeSend;
    _autoGrowTextarea(input, 2, 8);
    if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
    showStatus('送信に失敗', true);
  }
}

// ===== チーム/DM: 画像添付（マルチモーダル） =====
function teamAttachmentPick() {
  const fileInput = document.getElementById('team-attachment-file');
  if (!fileInput) return;
  fileInput.value = '';
  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files || []);
    for (const f of files) {
      await _teamUploadAttachment(f);
    }
    fileInput.value = '';
  };
  fileInput.click();
}
window.teamAttachmentPick = teamAttachmentPick;

async function _teamUploadAttachment(file) {
  if (!file || !file.type?.startsWith('image/')) {
    showStatus('画像ファイルのみ添付できます', true);
    return;
  }
  const gen = _teamSessionGen;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('read error'));
      r.readAsDataURL(file);
    });
    // ルームフォルダ直下にアップロード（メンバー間で共有可能）
    const uploadDir = _teamChatUploadDir();
    const res = await apiFetch('/upload-file?path=' + encodeURIComponent(uploadDir), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: dataUrl, filename: file.name }),
    });
    if (gen !== _teamSessionGen) return;
    _teamPendingAttachments.push({
      name: file.name,
      path: res.path || file.name,
      mime: file.type || 'image/png',
      dataUrl,
    });
    _renderTeamAttachments();
  } catch (e) {
    if (gen !== _teamSessionGen) return;
    showStatus('画像のアップロードに失敗しました', true);
  }
}

function _renderTeamAttachments() {
  const bar = document.getElementById('team-attachments-bar');
  if (!bar) return;
  const list = _teamPendingAttachments || [];
  bar.innerHTML = '';
  if (list.length === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  list.forEach((att, idx) => {
    const chip = document.createElement('div');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 6px;background:var(--bg);border:1px solid var(--border);border-radius:3px;max-width:100%;';
    const img = document.createElement('img');
    img.src = att.dataUrl;
    img.alt = att.name;
    img.style.cssText = 'width:24px;height:24px;object-fit:cover;border-radius:2px;flex-shrink:0;';
    const label = document.createElement('span');
    label.textContent = att.name;
    label.title = att.name;
    label.style.cssText = 'max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = '削除';
    close.style.cssText = 'background:transparent;color:var(--fg2);border:none;cursor:pointer;padding:0 4px;font-size:14px;line-height:1;';
    close.addEventListener('click', () => {
      _teamPendingAttachments.splice(idx, 1);
      _renderTeamAttachments();
    });
    chip.appendChild(img);
    chip.appendChild(label);
    chip.appendChild(close);
    bar.appendChild(chip);
  });
}
window._renderTeamAttachments = _renderTeamAttachments;

// Markdown 画像を含むチームメッセージ本文をレンダリング（textContent + <img>）
// 安全な URL（/api/file-raw?... または相対 /file-raw?...）のみ画像化、他はテキスト
function _renderTeamMessageWithImages(container, text) {
  container.innerHTML = '';
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const seg = document.createElement('div');
      seg.style.cssText = 'white-space:pre-wrap;word-break:break-word;user-select:text;';
      seg.textContent = text.substring(last, m.index);
      container.appendChild(seg);
    }
    const alt = m[1];
    const url = m[2];
    if (url.startsWith('/api/file-raw?') || url.startsWith('/file-raw?')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = alt;
      img.loading = 'lazy';
      img.style.cssText = 'max-width:240px;max-height:240px;border-radius:4px;margin-top:4px;display:block;object-fit:contain;cursor:zoom-in;';
      img.addEventListener('click', () => {
        if (typeof openImageViewer === 'function') openImageViewer(url, alt);
        else window.open(url, '_blank');
      });
      container.appendChild(img);
    } else {
      const seg = document.createElement('span');
      seg.textContent = m[0];
      container.appendChild(seg);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const seg = document.createElement('div');
    seg.style.cssText = 'white-space:pre-wrap;word-break:break-word;user-select:text;';
    seg.textContent = text.substring(last);
    container.appendChild(seg);
  }
}

function _chatBindImeCompositionGuard(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.chatImeGuardBound === '1') return;
  input.dataset.chatImeGuardBound = '1';
  input.addEventListener('compositionstart', () => {
    input.dataset.chatImeComposing = '1';
  });
  input.addEventListener('compositionend', () => {
    input.dataset.chatImeComposing = '0';
    input.dataset.chatLastCompositionEnd = String(Date.now());
  });
}

function _chatIsImeEnterEvent(event) {
  const target = event?.target;
  const lastEnd = Number(target?.dataset?.chatLastCompositionEnd || 0);
  return !!(
    event?.isComposing ||
    event?.keyCode === 229 ||
    event?.which === 229 ||
    target?.dataset?.chatImeComposing === '1' ||
    (lastEnd && Date.now() - lastEnd < 120)
  );
}

_chatBindImeCompositionGuard('team-input');
document.getElementById('team-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    if (_chatIsImeEnterEvent(e)) return;
    e.preventDefault();
    teamSend();
  }
});

// textarea auto-grow（入力内容に合わせて高さを調整）
function _autoGrowTextarea(ta, minRows, maxRows) {
  if (!ta) return;
  const fontSize = parseFloat(getComputedStyle(ta).fontSize) || 13;
  const lineHeight = fontSize * 1.4;
  const padding = 16; // 上下padding合計
  const minH = (minRows || 2) * lineHeight + padding;
  const maxH = (maxRows || 8) * lineHeight + padding;
  if (ta.dataset.chatManualHeight === '1') {
    const manualMaxH = Number(ta.dataset.chatManualMaxHeight || 0);
    const effectiveMaxH = Math.max(maxH, Number.isFinite(manualMaxH) ? manualMaxH : 0);
    const currentH = parseFloat(ta.style.height) || ta.getBoundingClientRect().height || minH;
    const newH = Math.min(Math.max(currentH, ta.scrollHeight, minH), effectiveMaxH);
    ta.style.height = newH + 'px';
    ta.style.overflowY = ta.scrollHeight > newH + 1 ? 'auto' : 'hidden';
    return;
  }
  ta.style.height = 'auto';
  const newH = Math.min(Math.max(ta.scrollHeight, minH), maxH);
  ta.style.height = newH + 'px';
  ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
}
document.getElementById('team-input')?.addEventListener('input', function() { _autoGrowTextarea(this, 2, 8); });
_chatBindImeCompositionGuard('chat-input');
document.getElementById('chat-input')?.addEventListener('input', function() { _autoGrowTextarea(this, 2, 10); });
// 送信後のリセットにも対応するため、teamSend/chatSend内で呼ぶよう修正

async function showCreateRoomModal() {
  // ダイアログなしで即座に「無題」ルームを作成（連番を自動付与）
  try {
    const existing = await apiFetch(_chatApiPath('/collab/rooms')).catch(() => []);
    const names = new Set((existing || []).map(r => r.name));
    let name = '無題';
    let i = 2;
    while (names.has(name)) { name = '無題' + i; i++; }
    const res = await apiPost(_chatApiPath('/collab/rooms'), _chatPostPayload({ name, type: 'general' }));
    await loadTeamRooms();
    const roomName = name;
    const roomPath = res?.path || roomName;
    showStatus('ルーム「' + roomName + '」を作成しました');
    await selectTeamRoom(roomPath);
    // 作成直後にリネームモードに入る
    setTimeout(() => {
      _beginTeamRoomTitleEdit(_teamRoomByPath(roomPath) || { path: roomPath, name: roomName, type: 'general' });
    }, 50);
  } catch (e) {
    showStatus('ルーム作成に失敗: ' + (e.message || ''), true);
  }
}

function openChat() {
  toggleRightPanelTab('chat');
}

function _chatNormalizeStoredPath(pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return '';
  if (!/^https?:/i.test(raw) && !raw.startsWith('/api/')) return raw;
  try {
    const parsed = new URL(raw, location.origin);
    const nextPath = parsed.searchParams.get('path');
    return nextPath ? decodeURIComponent(nextPath) : raw;
  } catch {
    const match = raw.match(/[?&]path=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : raw;
  }
}

function _chatGuessMimeType(pathOrName) {
  const lower = String(pathOrName || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  return 'image/png';
}

function _chatIsImagePath(pathOrName) {
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(String(pathOrName || ''));
}

function _chatContentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content.map(part => {
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'text') return String(part.text || '');
    if (part.type === 'image') return `[画像: ${part.name || part.path || 'image'}]`;
    if (part.type === 'document') return `[PDF: ${part.name || part.path || 'document'}]`;
    return '';
  }).filter(Boolean).join('\n');
}

function _chatBuildImageContent(name, pathOrUrl) {
  const storedPath = _chatNormalizeStoredPath(pathOrUrl);
  const nextName = String(name || storedPath.split('/').pop() || 'image').trim() || 'image';
  return [
    { type: 'text', text: `画像を添付しました: ${nextName}` },
    { type: 'image', name: nextName, path: storedPath, mimeType: _chatGuessMimeType(storedPath || nextName) },
  ];
}

function _chatRenderStructuredMessage(div, content, isUser) {
  div.innerHTML = '';
  content.forEach(part => {
    if (!part || typeof part !== 'object') return;
    if (part.type === 'text') {
      const text = String(part.text || '').trim();
      if (!text) return;
      const textDiv = document.createElement('div');
      textDiv.style.cssText = 'white-space:pre-wrap;word-break:break-word;';
      textDiv.textContent = text;
      div.appendChild(textDiv);
      return;
    }
    if (part.type === 'image') {
      const storedPath = _chatNormalizeStoredPath(part.path || part.url || '');
      const imgUrl = storedPath ? (API_BASE + '/file-raw?path=' + encodeURIComponent(storedPath)) : String(part.url || '');
      const imgWrap = document.createElement('div');
      imgWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:4px;';
      if (part.name) {
        const caption = document.createElement('div');
        caption.style.cssText = `font-size:12px;display:flex;align-items:center;gap:4px;${isUser ? 'color:rgba(255,255,255,0.92);' : 'color:var(--fg2);'}`;
        caption.innerHTML = `${lucide('image', 14)} <span>${esc(String(part.name))}</span>`;
        imgWrap.appendChild(caption);
      }
      if (imgUrl) {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = String(part.name || storedPath || 'image');
        img.style.cssText = 'max-width:min(320px, 100%);max-height:220px;border-radius:8px;display:block;cursor:pointer;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.08);';
        img.addEventListener('click', () => {
          if (typeof openViewer === 'function') openViewer(imgUrl);
        });
        img.onerror = () => { img.style.display = 'none'; };
        imgWrap.appendChild(img);
      }
      div.appendChild(imgWrap);
      return;
    }
    if (part.type === 'document') {
      const storedPath = _chatNormalizeStoredPath(part.path || part.url || '');
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:6px;margin-top:4px;font-size:12px;${isUser ? 'color:rgba(255,255,255,0.92);' : 'color:var(--fg2);'}`;
      row.innerHTML = `${lucide('fileText', 14)} <span style="text-decoration:underline;cursor:pointer;">${esc(String(part.name || storedPath || 'PDF'))}</span>`;
      row.querySelector('span')?.addEventListener('click', () => {
        if (storedPath && typeof openViewer === 'function') openViewer(API_BASE + '/file-raw?path=' + encodeURIComponent(storedPath));
      });
      div.appendChild(row);
    }
  });
  if (!div.childNodes.length) {
    div.textContent = _chatContentToText(content);
  }
}

function _chatNormalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _chatSourceFolderValue() {
  return String(_chatState.sourceFolder || '');
}

function _chatSourceQuery() {
  const sourceFolder = _chatSourceFolderValue();
  return sourceFolder ? 'source_folder=' + encodeURIComponent(sourceFolder) : '';
}

function _chatApiPath(path) {
  const sourceQuery = _chatSourceQuery();
  if (!sourceQuery) return path;
  return path + (path.includes('?') ? '&' : '?') + sourceQuery;
}

function _chatPostPayload(body = {}) {
  const hasSourceFolder = Object.prototype.hasOwnProperty.call(body || {}, 'source_folder');
  return { ...body, source_folder: hasSourceFolder ? body.source_folder : _chatSourceFolderValue() };
}

async function _chatClientApiKeysForRequest() {
  if (!window.MeldexLlmKeys?.getAll) return {};
  return await window.MeldexLlmKeys.getAll();
}

async function _chatKnowledgeAutomationForSave() {
  const manager = window.MeldexKnowledgeAutomationSettings;
  if (!manager?.load || !manager?.hasSaved?.()) return null;
  const settings = manager.load();
  return {
    ...settings,
    api_keys: typeof _chatClientApiKeysForRequest === 'function' ? await _chatClientApiKeysForRequest() : {},
  };
}

async function _chatProviderHasConfiguredKey(provider) {
  const status = await _chatProviderReadyStatus(provider);
  return !!status.configured;
}

async function _chatProviderReadyStatus(provider) {
  const key = _chatProviderKey(provider);
  if (_chatIsCliProvider(key)) return _chatCliProviderReadyStatus(key);
  try {
    if (await window.MeldexLlmKeys?.hasProvider?.(key)) return { configured: true, message: '' };
  } catch {}
  try {
    const cfg = await apiFetch('/chat/config');
    const configured = !!cfg?.providers?.[key]?.configured;
    return {
      configured,
      message: configured ? '' : 'APIキーが未設定です。設定ダイアログのLLMタブで、この端末用のAPIキーを保存してください。',
    };
  } catch {
    return {
      configured: false,
      message: 'APIキー設定を確認できませんでした。Meldexを再起動してからもう一度試してください。',
    };
  }
}

async function _chatCliProviderReadyStatus(provider) {
  const key = _chatProviderKey(provider);
  const meta = CHAT_CLI_PROVIDERS[key] || { label: key || 'CLI', command: key || 'CLI' };
  try {
    const cfg = await apiFetch('/cli-chat/config', { silentError: true });
    if (cfg?.enabled === false) {
      return { configured: false, message: 'CLIチャット機能が無効です。設定 > LLM > CLIチャットで有効にしてください。' };
    }
    const item = cfg?.providers?.[key];
    if (!item) {
      return { configured: false, message: `${meta.label} のCLIチャット設定が見つかりません。設定 > LLM > CLIチャットで確認してください。` };
    }
    if (item.enabled === false) {
      return { configured: false, message: `${item.label || meta.label} はCLIチャット設定で無効です。` };
    }
    if (item.available === false) {
      const command = item.command || meta.command || key;
      return { configured: false, message: `${item.label || meta.label} のコマンドが見つかりません。${command} をインストールし、Meldexを起動した環境のPATHから実行できるようにしてください。` };
    }
    return { configured: true, message: '' };
  } catch {
    return { configured: false, message: 'CLIチャット設定を読み込めませんでした。Meldexを再起動してからもう一度試してください。' };
  }
}

async function _chatRefreshApiKeyState() {
  const sendBtn = document.getElementById('chat-send-btn');
  if (!sendBtn || _chatState.streaming) return;
  const status = await _chatProviderReadyStatus(_chatState.provider);
  if (_chatIsCliProvider(_chatState.provider)) {
    sendBtn.disabled = false;
    sendBtn.title = status.configured ? '送信 (Enter)' : (status.message || 'CLIチャット設定を確認してください。');
    return;
  }
  sendBtn.disabled = !status.configured;
  sendBtn.title = status.configured ? '送信 (Enter)' : (status.message || '送信設定を確認してください。');
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
  _chatState.pendingAttachments = [];
  if (typeof _chatClearQueuedMessages === 'function') _chatClearQueuedMessages();
  if (typeof _renderChatAttachments === 'function') _renderChatAttachments();
  _setChatSessionTitle('');
  const container = _chatLiveMessagesContainer();
  if (container) container.innerHTML = '';
  _showChatTargetBadge(_chatState.targetPath);
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
  if (!raw) return (options || []).find(item => !item.value) || null;
  const normalized = _chatNormalizePath(raw);
  return (options || []).find(item => _chatNormalizePath(item.value) === normalized) || null;
}

function _chatSourceOptions() {
  const options = [{ value: '', label: '個人Vault（既定）', kind: 'personal', path: _chatVaultInfo.path || '' }];
  const seen = new Set();
  const vaultPath = String(_chatVaultInfo.path || '');
  if (vaultPath) {
    _chatAddSourceOption(options, seen, {
      value: vaultPath,
      label: 'ソース: ' + (_chatVaultInfo.name || vaultPath.split(/[\\/]/).pop() || vaultPath),
      kind: 'vault',
      path: vaultPath,
    });
  }
  (_chatVaultsCache || []).forEach(vault => {
    if (!vault || !vault.path) return;
    _chatAddSourceOption(options, seen, {
      value: vault.path,
      label: 'ソース: ' + (vault.name || vault.path.split(/[\\/]/).pop() || vault.path),
      kind: 'vault',
      path: vault.path,
    });
  });
  (_chatSourceFoldersCache || []).forEach(root => {
    if (!root || !root.path) return;
    _chatAddSourceOption(options, seen, {
      value: root.path,
      label: 'ソース: ' + (root.name || root.path.split(/[\\/]/).pop() || root.path),
      kind: 'source',
      path: root.path,
    });
  });
  return options;
}

function _syncChatSourceFolderUi() {
  const select = document.getElementById('chat-source-folder');
  const badge = document.getElementById('chat-source-badge');
  if (select) {
    select.value = _chatSourceFolderValue();
    select.disabled = !!_chatState.streaming;
  }
  const selected = _chatFindSourceOption(_chatSourceFolderValue(), _chatSourceOptions());
  const shared = !!_chatSourceFolderValue();
  if (badge) {
    badge.textContent = shared ? (selected?.kind === 'vault' ? 'ソース' : '共有') : '個人';
    badge.style.color = shared ? 'var(--green, #4ec9b0)' : 'var(--fg2)';
    badge.style.background = shared ? 'rgba(78,201,176,0.12)' : 'var(--bg2)';
    badge.style.border = '1px solid ' + (shared ? 'var(--green, #4ec9b0)' : 'var(--border)');
  }
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
  if (!select) return;
  try { _chatVaultInfo = await apiFetch('/vault'); } catch { _chatVaultInfo = { path: '', name: '' }; }
  try {
    const vaultsPayload = await apiFetch('/vaults');
    _chatVaultsCache = Array.isArray(vaultsPayload?.vaults) ? vaultsPayload.vaults : [];
  } catch {
    _chatVaultsCache = [];
  }
  try { _chatSourceFoldersCache = await apiFetch('/outliner-roots'); } catch { _chatSourceFoldersCache = []; }
  const options = _chatSourceOptions();
  select.innerHTML = options.map(item => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('');
  const selected = _chatFindSourceOption(_chatState.sourceFolder, options);
  if (selected) {
    _chatState.sourceFolder = selected.value;
    localStorage.setItem(_CHAT_SOURCE_FOLDER_STORAGE_KEY, selected.value);
  } else {
    _chatState.sourceFolder = '';
    localStorage.setItem(_CHAT_SOURCE_FOLDER_STORAGE_KEY, '');
  }
  _syncChatSourceFolderUi();
  _refreshChatDebugAvailability();
}

function _detectSourceFolderFromPath(targetPath) {
  const raw = _chatNormalizePath(targetPath);
  if (!raw) return '';
  const vaultPath = _chatNormalizePath(_chatVaultInfo.path);
  if (vaultPath && (raw === vaultPath || raw.startsWith(vaultPath + '/'))) return _chatVaultInfo.path || '';
  let best = '';
  (_chatSourceFoldersCache || []).forEach(root => {
    const rootPath = _chatNormalizePath(root?.path);
    if (!rootPath) return;
    if (raw === rootPath || raw.startsWith(rootPath + '/')) {
      if (rootPath.length > _chatNormalizePath(best).length) best = root.path;
    }
  });
  return best;
}

async function _setChatSourceFolder(sourceFolder, options = {}) {
  const next = String(sourceFolder || '');
  if (next === _chatSourceFolderValue() && !options.force) {
    _syncChatSourceFolderUi();
    return;
  }
  if (_chatState.streaming) {
    _syncChatSourceFolderUi();
    if (typeof showStatus === 'function') showStatus('応答生成中は対象ソースフォルダを切り替えられません', true);
    return;
  }
  if (!options.skipSave && _chatState.messages.length > 0) {
    await chatAutoSave({ silent: true }).catch(() => {});
  }
  _chatState.sourceFolder = next;
  localStorage.setItem(_CHAT_SOURCE_FOLDER_STORAGE_KEY, next);
  _chatResetCurrentSession();
  _teamCurrentRoom = '';
  _teamLastTimestamp = '';
  _teamPendingAttachments = [];
  _clearTeamRoomSelection();
  _syncChatSourceFolderUi();
  _refreshChatDebugAvailability();
  if (_chatMode === 'team') await loadTeamRooms();
  if (_chatMode === 'history') await renderChatHistory();
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
    chatAddMessage('user', message.content, {
      messageIndex: _chatState.messages.length + offset,
      msg_id: _ensureChatMessageId(message),
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
  const key = (_chatSourceFolderValue() || 'personal') + ':' + (_chatState.sessionId || _chatState.targetPath || 'llm');
  return 'chat:' + key;
}

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
}

async function _chatApplyMessagesSnapshot(messages, options = {}) {
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

  const beforeMessages = _chatCloneMessages(_chatState.messages);
  const afterMessages = _chatCloneMessages(_chatState.messages);
  afterMessages.splice(idx, 1);

  try {
    await _chatApplyMessagesSnapshot(afterMessages);
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('メッセージ削除の保存に失敗: ' + (e?.message || e), true);
    return;
  }

  if (typeof historyPush === 'function') {
    const scope = _chatHistoryScope();
    if (typeof historySetScope === 'function') historySetScope(scope);
    historyPush(
      'チャット: メッセージ削除',
      () => _chatApplyMessagesSnapshot(beforeMessages),
      () => _chatApplyMessagesSnapshot(afterMessages),
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
      () => _chatApplyMessagesSnapshot(beforeMessages),
      () => _chatApplyMessagesSnapshot(afterMessages),
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
  const textarea = document.createElement('textarea');
  textarea.value = original;
  textarea.rows = Math.min(10, Math.max(3, original.split('\n').length + 1));
  textarea.style.cssText = 'width:100%;min-width:220px;background:rgba(255,255,255,0.08);color:inherit;border:1px solid rgba(255,255,255,0.35);border-radius:6px;padding:6px;font:inherit;resize:vertical;';
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin-top:6px;';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'キャンセル';
  cancel.style.cssText = 'font-size:11px;padding:2px 8px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.35);border-radius:4px;cursor:pointer;';
  const save = document.createElement('button');
  save.type = 'button';
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
  const plainContent = _chatContentToText(content);
  const provider = options?.provider || _chatState.provider;
  const model = options?.model || _chatState.model;
  const name = isUser ? getUsername() : getProviderLabel(provider, model);
  const icon = isUser ? getUserAvatarHtml(getUsername(), 18) : getProviderIconHtml(provider, 18);

  // ラッパー（名前+アイコン+バブル）
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-message-row chat-message-row-llm' + (isUser ? ' is-user' : ' is-assistant');
  const msgId = options?.msg_id || options?.msgId || '';
  if (msgId) wrapper.dataset.msgId = msgId;
  if (Number.isInteger(options?.messageIndex)) wrapper.dataset.chatMessageIndex = String(options.messageIndex);
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
  if (timestampLabel) {
    const timeEl = document.createElement('span');
    timeEl.className = 'chat-message-time';
    timeEl.textContent = timestampLabel;
    timeEl.title = String(options?.timestamp || options?.created_at || options?.createdAt || options?.time || '');
    timeEl.style.cssText = 'opacity:0.72;font-variant-numeric:tabular-nums;';
    header.appendChild(timeEl);
  }
  if (Number.isInteger(options?.messageIndex)) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.title = 'メッセージをコピー';
    copyBtn.setAttribute('aria-label', 'メッセージをコピー');
    copyBtn.dataset.chatCopyIndex = String(options.messageIndex);
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
    deleteBtn.innerHTML = lucide('trash2', 12);
    deleteBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:2px;background:transparent;color:var(--fg2);border:none;border-radius:4px;cursor:pointer;padding:0;';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      chatDeleteMessage(options.messageIndex);
    });
    header.appendChild(deleteBtn);
  }
  if (Number.isInteger(options?.messageIndex) && !isUser) {
    const regenBtn = document.createElement('button');
    regenBtn.type = 'button';
    regenBtn.title = '再生成';
    regenBtn.setAttribute('aria-label', '再生成');
    regenBtn.disabled = !!_chatState.streaming;
    regenBtn.dataset.chatRegenerateIndex = String(options.messageIndex);
    regenBtn.innerHTML = lucide('refreshCw', 12);
    regenBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:2px;background:transparent;color:var(--fg2);border:none;border-radius:4px;cursor:pointer;padding:0;';
    regenBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      chatRegenerateMessage(options.messageIndex);
    });
    header.appendChild(regenBtn);
  }
  if (Number.isInteger(options?.messageIndex) && isUser) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.title = '編集して再送';
    editBtn.setAttribute('aria-label', '編集して再送');
    editBtn.disabled = !!_chatState.streaming;
    editBtn.dataset.chatEditIndex = String(options.messageIndex);
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
  div.className = 'chat-message-bubble chat-message-bubble-llm' + (isUser ? ' is-user' : ' is-assistant');
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
  if (!isUser && options?.usage) _chatRenderUsage(div, options.usage, provider, model);
  if (!isUser && options?.compressed_summary) {
    div.style.border = '1px dashed var(--border)';
    div.title = `圧縮済み会話の要約（元発言 ${Number(options.original_message_count || 0)} 件）`;
  }
  if (!isUser && options?.code_exec_blocks?.length) chatRenderCodeExecBlocks(div, options.code_exec_blocks);
  container.scrollTop = container.scrollHeight;
  _chatRenderSessionUsageSummary();
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
  container.appendChild(div);
  if (!parent) container.scrollTop = container.scrollHeight;
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
    targetPath: String(_chatState.targetPath || ''),
    sourceFolder: typeof _chatSourceFolderValue === 'function' ? String(_chatSourceFolderValue() || '') : String(_chatState.sourceFolder || ''),
    mode: typeof _chatMode === 'undefined' ? '' : String(_chatMode || ''),
  };
}

function _chatQueueScopesMatch(scope, current) {
  if (!scope || !current) return false;
  if (String(scope.mode || '') !== String(current.mode || '')) return false;
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

  const submitFingerprint = JSON.stringify({ text, attachments: attachments.map(att => att.path || att.name || '') });
  const now = Date.now();
  if (submitFingerprint === _chatLastSubmitFingerprint && now - _chatLastSubmitAt < 300) {
    if (typeof showStatus === 'function') showStatus('同じメッセージの連続送信を抑止しました');
    return false;
  }
  _chatLastSubmitFingerprint = submitFingerprint;
  _chatLastSubmitAt = now;

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

  const timestamp = _chatLocalTimestamp();
  const message = { role: 'user', content: _chatNormalizeUserContent(text, attachments), timestamp };
  _ensureChatMessageId(message);
  const queue = _chatQueuedMessages();
  if (queue.length && !_chatQueueScopeMatchesCurrent()) _chatClearQueuedMessages();
  _chatState.queuedScope = _chatCurrentQueueScope();
  queue.push(message);
  chatAddMessage('user', message.content, {
    messageIndex: _chatState.messages.length + queue.length - 1,
    msg_id: message.msg_id,
    timestamp,
    queued_for_next_response: true,
  });
  if (typeof showStatus === 'function') showStatus('応答完了後にまとめて送信します');
  return true;
}

function _chatDrainQueuedMessages() {
  if (!_chatQueueScopeMatchesCurrent()) return [];
  const queue = _chatQueuedMessages();
  if (!queue.length) return [];
  const drained = _chatCloneMessages(queue);
  queue.splice(0, queue.length);
  _chatState.queuedScope = null;
  return drained;
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
  if (!_chatQueueScopeMatchesCurrent()) return false;

  const queued = _chatDrainQueuedMessages();
  if (!queued.length) return false;
  _chatState.queuedSendRunning = true;
  const stopSerial = Number(_chatState.stopSerial || 0);
  let sent = false;
  try {
    if (typeof showStatus === 'function') showStatus(`保留メッセージ ${queued.length} 件を送信します`);
    sent = await chatSend({ deferredMessages: queued, fromQueuedMessages: true });
    if (!sent && !_chatState.streaming) {
      _chatState.queuedMessages = queued.concat(_chatQueuedMessages());
      _chatState.queuedScope = _chatCurrentQueueScope();
    }
    return sent;
  } finally {
    _chatState.queuedSendRunning = false;
    if (sent && !_chatState.streaming && _chatQueuedMessages().length && Number(_chatState.stopSerial || 0) === stopSerial) {
      setTimeout(() => { _chatSendQueuedMessagesAfterStream().catch(() => {}); }, 0);
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
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0]?.transcript || '';
      if (event.results[i].isFinal) finalText += text;
      else interimText += text;
    }
    const next = (baseValue + (baseValue && (finalText || interimText) ? '\n' : '') + finalText + interimText).trimStart();
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
  if (_chatIsCliProvider(_chatState.provider)) {
    if (window.GBChatCli?.sendCliChat) return window.GBChatCli.sendCliChat(options);
    if (typeof chatAddSystem === 'function') chatAddSystem('CLIチャット機能を読み込み中です。少し待ってから再送信してください。');
    return false;
  }
  const deferredMessages = Array.isArray(options.deferredMessages) ? _chatCloneMessages(options.deferredMessages).filter(message => message?.role === 'user') : [];
  const usingDeferredMessages = deferredMessages.length > 0;
  if (!usingDeferredMessages) _captureChatSessionTitleFromInput();
  const input = document.getElementById('chat-input');
  const msgContainer = _chatLiveMessagesContainer();
  if (!msgContainer) {
    if (typeof showStatus === 'function') showStatus('チャット表示を準備中です', true);
    return false;
  }
  const _pendingAtts = usingDeferredMessages ? [] : (_chatState.pendingAttachments || []);
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
  if (window.MeldexOnlineStatus?.assertOnlineForLlm && !window.MeldexOnlineStatus.assertOnlineForLlm()) {
    chatAddSystem(window.MeldexOnlineStatus.offlineMessage());
    return false;
  }
  chatRefreshUsageBanner().catch(() => {});
  if (!usingDeferredMessages) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
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
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
    return;
  }

  const providerStatus = await _chatProviderReadyStatus(_chatState.provider);
  if (!providerStatus.configured) {
    if (!usingDeferredMessages) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
      if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
    }
    chatAddSystem(providerStatus.message || '送信設定を確認してください。');
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
    _chatState.messages.push(...deferredMessages);
    _chatRenderStoredMessages();
  } else {
    _chatPromoteQueuedMessagesToHistory();
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
  }
  _ensureSessionId();

  // ストリーミング開始
  const streamMessages = _chatState.messages;
  const streamProvider = _chatState.provider;
  const streamModel = _chatState.model;
  const streamSessionId = _chatState.sessionId || '';
  const streamSessionTitle = _chatState.sessionTitle || '';
  const streamTargetPath = _chatState.targetPath || '';
  const streamSourceFolder = _chatSourceFolderValue();
  const streamWorkFolder = typeof getWorkFolder === 'function' ? getWorkFolder() : '';
  const streamSystemPrompt = _buildSystemPrompt();
  const streamController = new AbortController();
  _chatState.streaming = true;
  _chatState.abortController = streamController;
  _chatState.streamingProvider = streamProvider;
  _syncChatSourceFolderUi();
  const sendBtn = document.getElementById('chat-send-btn');
  sendBtn.textContent = '停止';
  sendBtn.title = '応答生成を停止';
  sendBtn.disabled = false;

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
  msgContainer.appendChild(spinnerWrapper);
  msgContainer.scrollTop = msgContainer.scrollHeight;

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
    && (_chatState.sessionId || '') === streamSessionId
    && (_chatState.targetPath || '') === streamTargetPath;
  const streamLiveContainer = () => streamVisibleInCurrentChat() ? _chatLiveMessagesContainer() : null;
  const scrollStreamContainer = () => {
    const liveContainer = streamLiveContainer();
    if (liveContainer && _autoScroll) liveContainer.scrollTop = liveContainer.scrollHeight;
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
  let _autoScroll = true;
  let streamError = null;
  let streamCompleted = false;
  const _scrollHandler = () => {
    const atBottom = msgContainer.scrollHeight - msgContainer.scrollTop - msgContainer.clientHeight < 40;
    _autoScroll = atBottom;
  };
  msgContainer.addEventListener('scroll', _scrollHandler);
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
  const hideLiveActivity = () => spinnerWrapper.remove();

  try {
    const _streamHeaders = { 'Content-Type': 'application/json' };
    if (_authToken) _streamHeaders['Authorization'] = 'Bearer ' + _authToken;
    const res = await fetch(API_BASE + '/chat/stream', {
      method: 'POST',
      headers: _streamHeaders,
      signal: streamController.signal,

/* Source chunk: gb-right-panel-chat.part02.js */
      body: JSON.stringify({
        provider: streamProvider,
        model: streamModel || undefined,
        client_api_keys: typeof _chatClientApiKeysForRequest === 'function' ? await _chatClientApiKeysForRequest() : {},
        messages: _ensureChatMessageIds(streamMessages),
        system_prompt: streamSystemPrompt,
        session_id: streamSessionId,
        session_title: streamSessionTitle,
        target_path: streamTargetPath,
        source_folder: streamSourceFolder,
        work_folder: streamWorkFolder,
        active_feature: typeof _chatActiveFeatureForTarget === 'function' ? _chatActiveFeatureForTarget(streamTargetPath) : '',
        user: typeof getUsername === 'function' ? getUsername() : '',
        user_agent: navigator.userAgent || '',
        theme_context: typeof window.chatThemeContextSettings === 'function' ? window.chatThemeContextSettings() : {},
        allow_web_search: chatAllowWebSearch(),
        allow_auto_compress: chatAllowAutoCompress(),
        allow_code_execution: chatAllowCodeExecution(),
        ...chatGenerationSettings(),
        ...chatCustomInstructionSettings(),
      }),
    });
    if (!res.ok) {
      let errorText = '';
      let errorCode = '';
      try {
        const errorData = await res.json();
        const detail = errorData?.detail;
        if (detail && typeof detail === 'object') {
          errorCode = detail.code || '';
          errorText = detail.message || detail.technical_detail || '';
        } else {
          errorText = detail || errorData?.error || errorData?.message || '';
        }
      } catch {
        try { errorText = await res.text(); } catch {}
      }
      const error = new Error(errorText || ('HTTP ' + res.status + ': ' + res.statusText));
      error.meldexCode = errorCode;
      error.status = res.status;
      throw error;
    }
    if (!res.body) throw new Error('ストリームを開始できませんでした');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!isCurrentStream()) {
        try { await reader.cancel(); } catch {}
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!isCurrentStream()) break;
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.substring(6));
          if (data.type === 'text_delta') {
            const chunk = data.content == null ? '' : String(data.content);
            if (!chunk) continue;
            // テキストが来たら実況用の一時表示を消してフキダシへ集約する。
            hideLiveActivity();
            if (!streamVisibleInCurrentChat()) assistantDiv = null;
            if (!assistantDiv || !assistantDiv.isConnected) {
              assistantDiv = addAssistantToVisibleStream('', _assistantRenderOptions());
            }
            fullText += chunk;
            if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, responseCitations);
            else if (assistantDiv) { let s = esc(fullText); s = s.replace(/\*\*(.*?)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code style="background:var(--bg2);padding:1px 4px;border-radius:3px;">$1</code>').replace(/\n/g,'<br>'); assistantDiv.innerHTML = s; }
            scrollStreamContainer();
          } else if (data.type === 'thinking_delta') {
            showLiveActivity('考え中...');
            scrollStreamContainer();
          } else if (data.type === 'citation') {
            if (data.citation) responseCitations.push(data.citation);
            hideLiveActivity();
            if (!streamVisibleInCurrentChat()) assistantDiv = null;
            if (!assistantDiv || !assistantDiv.isConnected) {
              assistantDiv = addAssistantToVisibleStream('', _assistantRenderOptions());
            }
            if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, responseCitations);
            scrollStreamContainer();
          } else if (data.type === 'usage') {
            responseUsage = data.usage || null;
            if (assistantDiv) _chatRenderUsage(assistantDiv, responseUsage, streamProvider, streamModel);
          } else if (data.type === 'usage_recorded') {
            if (typeof chatRefreshUsageBanner === 'function') chatRefreshUsageBanner();
          } else if (data.type === 'budget_warning' || data.type === 'large_context_warning') {
            if (streamVisibleInCurrentChat()) chatAddSystem(data.message || 'LLM費用に関する警告があります');
          } else if (data.type === 'internal_notice') {
            // モデル別の復旧処理メモはアシスタント本文に混ぜない。
          } else if (data.type === 'error') {
            streamError = new Error(data.error || 'ストリームエラー');
            try { await reader.cancel(); } catch {}
            break;
          } else if (data.type === 'compression') {
            _chatApplyCompression(data, { messages: streamMessages, render: streamVisibleInCurrentChat() });
            showLiveActivity('会話履歴を圧縮中...');
            scrollStreamContainer();
          } else if (String(data.type || '').startsWith('code_exec_')) {
            showLiveActivityLog(data.type === 'code_exec_done' ? 'コード実行完了。応答を生成中...' : 'コードを実行中...');
            chatHandleCodeExecutionEvent(data, responseCodeExecBlocks, activityLog);
            scrollStreamContainer();
          } else if (data.type === 'tool_start') {
            showLiveActivityLog(data.name + ' を実行中...');
            chatAddToolUse(data.name, '実行中...', activityLog);
          } else if (data.type === 'client_tool_request') {
            showLiveActivityLog(data.name + ' を実行中...');
            await _chatHandleClientToolRequest(data, activityLog);
          } else if (data.type === 'tool_result') {
            responseToolEvents.push({ name: String(data.name || ''), result: data.result == null ? '' : String(data.result) });
            const toolDivs = activityLog.querySelectorAll('.chat-tool-use');
            const last = toolDivs[toolDivs.length - 1];
            if (last) {
              const resultText = data.result?.substring(0, 300) || '';
              last.querySelector('.tool-result-text').textContent = resultText;
            }
            _handleChatToolWorkspaceEffect(data.name, data.result);
            showLiveActivity('結果を処理中...');
          } else if (data.type === 'done') {
            hideLiveActivity();
          }
        } catch (e) {}
      }
    }

    if (streamError) throw streamError;
    streamCompleted = true;

    // アシスタントメッセージを記録 + 自動保存
    const toolOnlyResponse = !fullText && !responseCodeExecBlocks.length && responseToolEvents.length > 0;
    if (toolOnlyResponse) {
      fullText = 'ツール実行は完了しましたが、LLMから応答本文が返りませんでした。必要ならもう一度送信してください。';
    }
    if (isCurrentStream() && (fullText || responseCodeExecBlocks.length)) {
      const auditResult = typeof _chatToolTruthSanitize === 'function'
        ? _chatToolTruthSanitize(fullText, text, responseToolEvents)
        : {
            text: fullText,
            warning: typeof _chatToolTruthAudit === 'function' ? _chatToolTruthAudit(fullText, text, responseToolEvents) : '',
            replaced: false,
          };
      const auditWarning = auditResult.warning || '';
      if (auditResult.replaced) {
        fullText = auditResult.text;
        if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, responseCitations);
        else if (assistantDiv) assistantDiv.textContent = fullText;
      } else if (auditWarning) {
        if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, responseCitations);
        else if (assistantDiv) assistantDiv.textContent = fullText;
        if (assistantDiv && typeof _chatRenderToolAuditWarning === 'function') _chatRenderToolAuditWarning(assistantDiv, auditWarning);
      }
      if (!assistantDiv || !assistantDiv.isConnected) {
        const renderOptions = _assistantRenderOptions();
        if (auditWarning) renderOptions.tool_audit_warning = auditWarning;
        assistantDiv = addAssistantToVisibleStream(fullText || '[コード実行結果]', renderOptions);
      }
      if (assistantDiv && responseUsage) _chatRenderUsage(assistantDiv, responseUsage, streamProvider, streamModel);
      const assistantMessage = { role: 'assistant', content: fullText || '[コード実行結果]', msg_id: assistantMessageId, provider: streamProvider, model: streamModel, timestamp: assistantTimestamp || _chatLocalTimestamp() };
      if (responseCitations.length > 0) assistantMessage.citations = responseCitations;
      if (responseUsage) assistantMessage.usage = responseUsage;
      if (responseCodeExecBlocks.length > 0) assistantMessage.code_exec_blocks = responseCodeExecBlocks;
      if (auditWarning) assistantMessage.tool_audit_warning = auditWarning;
      streamMessages.push(assistantMessage);
      sendOk = true;
      chatAutoSave({
        messages: streamMessages,
        sessionId: streamSessionId,
        sessionTitle: streamSessionTitle,
        targetPath: streamTargetPath,
        sourceFolder: streamSourceFolder,
        provider: streamProvider,
        model: streamModel,
      }).then(() => { if (typeof renderChatHistory === 'function') renderChatHistory(); });
      if (streamVisibleInCurrentChat()) _chatRenderSessionUsageSummary();
    }
  } catch (e) {
    if (!isCurrentStream()) return false;
    spinnerWrapper.remove();
    if (e?.name === 'AbortError') {
      const abortedText = (fullText ? fullText.trimEnd() + '\n\n' : '') + '[中断されました]';
      if (!streamVisibleInCurrentChat()) assistantDiv = null;
      if (!assistantDiv || !assistantDiv.isConnected) {
        assistantDiv = addAssistantToVisibleStream('', _assistantRenderOptions());
      }
      if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, abortedText, responseCitations);
      else if (assistantDiv) assistantDiv.textContent = abortedText;
      if (assistantDiv && responseUsage) _chatRenderUsage(assistantDiv, responseUsage, streamProvider, streamModel);
      const assistantMessage = { role: 'assistant', content: abortedText, msg_id: assistantMessageId, provider: streamProvider, model: streamModel, timestamp: assistantTimestamp || _chatLocalTimestamp(), aborted: true };
      if (responseCitations.length > 0) assistantMessage.citations = responseCitations;
      if (responseUsage) assistantMessage.usage = responseUsage;
      if (responseCodeExecBlocks.length > 0) assistantMessage.code_exec_blocks = responseCodeExecBlocks;
      streamMessages.push(assistantMessage);
      sendOk = true;
      chatAutoSave({
        messages: streamMessages,
        sessionId: streamSessionId,
        sessionTitle: streamSessionTitle,
        targetPath: streamTargetPath,
        sourceFolder: streamSourceFolder,
        provider: streamProvider,
        model: streamModel,
      }).then(() => { if (typeof renderChatHistory === 'function') renderChatHistory(); });
      if (streamVisibleInCurrentChat()) _chatRenderSessionUsageSummary();
    } else if (streamVisibleInCurrentChat()) {
      chatAddSystem('エラー: ' + (e?.message || e));
    }
  } finally {
    spinnerWrapper.remove();
    if (_chatState.streamToken === streamToken && _chatState.abortController === streamController) {
      _chatState.streaming = false;
      _chatState.abortController = null;
      _chatState.streamingProvider = '';
      _syncChatSourceFolderUi();
      if (typeof _chatRefreshMessageDeleteButtons === 'function') _chatRefreshMessageDeleteButtons();
      const liveSendBtn = document.getElementById('chat-send-btn') || sendBtn;
      if (liveSendBtn) {
        liveSendBtn.textContent = '送信';
        liveSendBtn.title = '送信 (Enter)';
        liveSendBtn.disabled = false;
      }
      if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});
      if (input?.isConnected && !window.GBChatFormatting?.focusInput?.()) input.focus();
      if (streamCompleted && typeof _chatSendQueuedMessagesAfterStream === 'function') {
        setTimeout(() => {
          _chatSendQueuedMessagesAfterStream({
            messages: streamMessages,
            sessionId: streamSessionId,
            targetPath: streamTargetPath,
          }).catch(() => {});
        }, 0);
      }
    }
    msgContainer.removeEventListener('scroll', _scrollHandler);
  }
  return sendOk;
}

async function _chatHandleClientToolRequest(data, activityLog) {
  const name = String(data?.name || '');
  let result = { ok: false, error: 'クライアント側UI操作ブリッジが利用できません' };
  try {
    if (window.GBMeldexLlmOperations?.handleClientToolRequest) {
      result = await window.GBMeldexLlmOperations.handleClientToolRequest(data);
    }
  } catch (e) {
    result = { ok: false, error: e?.message || String(e) };
  }

  const resultText = (() => {
    try { return JSON.stringify(result, null, 2); } catch { return String(result || ''); }
  })();
  try {
    const toolDivs = activityLog?.querySelectorAll?.('.chat-tool-use') || [];
    const last = toolDivs[toolDivs.length - 1];
    if (last) last.querySelector('.tool-result-text').textContent = resultText.substring(0, 300);
  } catch {}

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (_authToken) headers['Authorization'] = 'Bearer ' + _authToken;
    await fetch(API_BASE + '/chat/client-tool-result', {
      method: 'POST',
      headers,
      body: JSON.stringify({ call_id: data.call_id || '', name, result }),
    });
  } catch (e) {
    console.warn('chat client tool result post failed:', e);
  }
}

function _buildSystemPrompt() {
  const intro = window.MeldexI18n?.t?.(
    'chat.systemPromptIntro',
    'あなたはMeldexで動作する創作支援アシスタントです。日本語で応答してください。'
  ) || 'あなたはMeldexで動作する創作支援アシスタントです。日本語で応答してください。';
  let prompt = `${intro}

Meldexはマンガ・小説・脚本・ゲーム・音楽・映像・ブログ・学術論文など、創作全般を補助する統合ワークスペースです。ユーザーのソースフォルダ内のノート、シート、シナリオ、ボード、チャット履歴、ナレッジ層を参照し、既存情報と矛盾しない提案・整理・作成を行ってください。

## あなたの役割

1. **ナレッジに基づいた応答**: search_knowledge/search/read_file/read_database/browseでソースフォルダを調査し、既存のナレッジに整合した提案をする
2. **積極的な創作物の作成**: ユーザーが「シナリオを作って」「キャラクターシートを作って」「構想ボードを作って」等と依頼したら、Meldexの機能を駆使して**実際にファイルを作成**する（ノート/シナリオ/ボードはwrite_file、シートはcreate_sheet→set_property_type→create_entity→add_valueを使う）
3. **最適な機能の選択**: 内容に応じて、どのMeldex機能（シナリオ/シート/ボード/カレンダー/通常のMarkdownノート）が最適かを判断し、ユーザーに説明しつつ作成する
4. **ジャンル中立**: ユーザーの創作ジャンルや用途を勝手に限定せず、依頼内容と既存ナレッジから判断する

## ナレッジの多層構造

Meldexのチャットでは、次の層を矛盾なく扱ってください。

1. **ソースフォルダ Skills**: \`_skills/\` 配下の専門ルール。必要なら load_skill(name) で本文を読む。ユーザー定義ルールより優先。
2. **ユーザー定義ルール**: ルールボタンで管理される個人ルール。Skillsと矛盾しない範囲で尊重する。
3. **ナレッジ層**: 過去チャットから抽出された fact / decision / preference / correction / team_consensus。関連項目は自動注入され、追加で search_knowledge(query) でも探せる。ただし自動注入ナレッジは参考情報であり、存在確認・場所確認・作成更新完了の証拠にはしない。
4. **ステータス別ポリシー**: 掲載済み・確定など canonical 扱いの項目は変更不可。内部確定は矛盾させない。調整可能項目はユーザー指示があれば提案・変更できる。
5. **ファイル検索層**: read_project_overview を最初に呼び、search(query) は既定で作品フォルダ内を検索する。作品外の確認が必要な場合だけ scope: source / roots / all を明示し、必要に応じて read_file / read_database / read_*_context で原文または構造化contextを読む。
6. **現在のコンテキスト**: ユーザーが開いているファイル、添付、直近メッセージ。上位ルールや canonical と矛盾する場合は、矛盾を報告する。

ナレッジ層の項目を修正する場合、ユーザーが明確に訂正・固定・解除を求めたときだけ update_knowledge を使ってください。canonical や保護された項目は勝手に上書きしないでください。

## Meldex の主要機能と使い分け

### 1. シナリオ (.scriptnote.json)
脚本・セリフ構成・小説のプロット・対話形式のコンテンツに使用。
**形式（JSON）**:
\`\`\`json
{
  "title": "タイトル",
  "rows": [
    {"id":"r1","pageSetting":"めくり","character":"","text":""},
    {"id":"r2","pageSetting":"","character":"","text":"シーン見出しやト書きなど"},
    {"id":"r3","pageSetting":"","character":"登場人物名","text":"セリフ内容"}
  ],
  "settings": {"modeName":"小説","viewMode":"horizontal"}
}
\`\`\`
- **pageSetting**: 改ページ系制御（"めくり"/"改ページ"/"シーン見出し"/"柱"など、空文字も可）
- **character**: 発話者名（"ト書き"/"プロット"等の特殊値もあり）
- **text**: セリフまたは説明文
- modeName候補: "マンガ脚本" / "映像脚本" / "小説" / "舞台脚本" / "ゲームシナリオ" 等。ユーザーの用途に合わせて選ぶ
- idは任意のユニークID（短いランダム文字列）

### 2. シート (構造化エントリ)
キャラクター設定・用語集・アイテム一覧・楽曲リスト・参考文献・タスク管理など、**複数のエントリを構造化して管理**するもの全般に使用。
**新形式の構造**:
\`\`\`
シートフォルダ/
  シートフォルダ.md          ← type: settings-db
  エントリ名.md              ← type: settings-entry、properties内に値を保持
\`\`\`
- set_property_type で列/型/リレーションを設定 → create_entity でエントリ作成 → add_value でプロパティ値を追加
- 新形式シートで add_value を使うときは、create_entity の戻り値 path（例: \`キャラ表/主人公.md\`）を folder_path に使う。シートフォルダだけを folder_path に渡さない。エントリ名指定で更新する場合は db_path + entity を使う
- プロパティ型・選択肢・リレーション・数式・ロールアップは set_property_type で設定する。フォームビューの項目/必須/ラベルは configure_form_view、公開フォーム送信は configure_public_form で設定する
- 「追加しました」「登録しました」と言う前に read_database で対象シートを読み、目的のエントリとプロパティ値が実際に返っていることを確認する
- プロパティ値のstatus: "案"/"採用"/"ボツ"/"掲載済み" 等
- 旧形式のエントリフォルダにも対応しているが、新規作成では新形式を優先
- タイムラインは独立ファイルではなく、date型プロパティを持つ通常シートのビュー。開始日/終了日/状態などを set_property_type で整え、必要に応じてUI操作でビュー設定する
- キャラクター表を作る場合は、年齢・誕生日・身長・体格・カップサイズ・体重・B/W/Hなど、テンプレートの数式/プロパティを欠落させない

### 3. ボード (.board.md)
マインドマップ・構想図・ストーリーボード・組織図・フローチャート・年表・関係図など、**カードとラインで視覚化**する情報に使用。
**形式（Markdownフロントマター）**:
\`\`\`
---
type: board
nodes:
  - {id: "n1", text: "主人公", x: 100, y: 100, w: 120, h: 60, color: "#569cd6"}
  - {id: "n2", text: "ライバル", x: 300, y: 100, w: 120, h: 60, color: "#f48771"}
connections:
  - {from: "n1", to: "n2", label: "対立", arrow: "end"}
---
\`\`\`
- ノードidは安定した値にし、connections.from/to はノードidを参照する。リンクカードやスタイル情報を追加する場合もフロントマター構造を壊さない

### 4. スマートシート (.smart-db.json)
複数シートの横断ビュー・絞り込み・ダッシュボードに使用。実データ本体ではなく、参照元とビュー設定を持つJSON。
**基本構造**:
\`\`\`json
{
  "type": "smart-db",
  "title": "スマートシート名",
  "sources": [{"kind": "sheet", "path": "Characters"}],
  "views": [],
  "activeView": "table"
}
\`\`\`
- 通常シートに入れるべきエントリを .smart-db.json に直接書かない。先に create_sheet / create_entity / add_value で元シートを作る

### 5. カレンダーDB
イベント・スケジュール・締切管理・学習計画など、**日時情報を伴う管理**に使用。
read_databaseで取得可能（calendar_db: trueフラグあり）。

### 6. 通常のMarkdownノート (.md)
上記に当てはまらない自由記述（世界観設定・あらすじ・エッセイ・注釈・ドキュメント等）。

## ツール（Function Calling）

- **read_file(path)**: ファイル内容を読み取る
- **write_file(path, content)**: ファイルに書き込む（新規/上書き）。フロントマターは維持
- **create_sheet(path, title)**: シート本体を作成する。キャラ表、用語集、一覧表などのシート作成依頼では、最初にこれを使う
- **create_entity(parent_path, name)**: シートにエントリを作成。戻り値 path を add_value の folder_path に使う
- **set_property_type(db_path, property, type, ...)**: シートのプロパティ型・選択肢・リレーション・数式・ロールアップを設定
- **add_value(folder_path, property, value, status)**: エントリにプロパティ値を追加。新形式ではエントリファイル path または db_path + entity を指定
- **configure_form_view(db_path, fields, required, ...)**: ブラウザ側のフォームビュー項目・必須・ラベル・説明を設定
- **configure_public_form(db_path, enabled, ...)**: 公開フォーム送信設定を保存
- **search(query)**: 全文検索
- **browse(path)**: フォルダ内一覧（空でルート）
- **read_database(path)**: DBの全エントリ・プロパティを一括取得
- **read_db_audit_log(path, since, until, ...)**: 編集履歴と変更レコードを読み、誰がいつ何を変えたかを確認する
- **create_folder(path, name)**: フォルダ作成
- **rename(path, new_name)**: リネーム
- **delete(path)**: ゴミ箱に移動
- **load_skill(name)**: ソースフォルダ Skills の本文を読み込む
- **search_knowledge(query, limit)**: 過去チャットから抽出されたナレッジを検索する
- **update_knowledge(id, ...)**: ナレッジ項目を訂正・固定・解除する
- **add_debug_report(...)**: ユーザーが明示的に不具合報告を依頼したときだけ使う
- **llm_list_ui_controls(query, include_hidden, limit)**: 現在のMeldex画面にある操作可能なUI要素をselector付きで一覧する。オプションパネルのポップアップ内のチェックボックスやドロップダウンも、表示後にこのツールで確認する
- **llm_ui_action(selector, action, value, checked, path, label)**: Meldex UIを実際に操作する。actionは click / set_value / set_checked / toggle / select / contextmenu / focus。selectorが不明な時はlabelでラベル検索できる。設定変更はUndo/Redoとヒストリーに記録される

## ツール実行の事実性ルール

- ファイル、フォルダ、シート、ノート、パス、Meldex UI、ナレッジ項目、記憶、ルール、設定の存在確認・中身確認・作成・更新・登録・リネーム・削除・移動・保存について、ツール結果なしに「確認しました」「存在します」「作成しました」「登録しました」「リネーム完了です」などと断言しない
- 自動注入されたナレッジ、会話履歴、要約、推測は存在確認・場所確認・更新完了の証拠ではない。確認手段がない場合は、確認できないと答える
- 存在確認や場所確認を求められたら、browse/read_file/read_database/read_db_audit_log/search_knowledge/load_skill/llm_list_ui_controls のいずれかを実行し、返ってきた tool_result に基づいて答える。search は候補発見用であり、存在確認の最終証拠として単独では使わない
- シートの編集履歴に関する質問（「いつ誰が直したか」「最近変更されたセル」「先週の修正一覧」等）には、必ず read_db_audit_log を呼ぶ。read_database で現在値を見ても誰がいつ変えたかは分からない。時間範囲が曖昧な場合（「最近」「先週」等）は適切な since / until を補完し、結果が 0 件なら推測せず履歴がないと答える。
- 作成・更新・リネーム・削除・移動・保存を求められたら、write_file/create_sheet/create_entity/add_value/set_property_type/configure_public_form/configure_form_view/create_folder/rename/delete/update_knowledge/add_debug_report/llm_ui_action の tool_result が ok であることを確認してから完了報告する
- ツール結果がエラー、空、未実行、または対象不一致の場合は、成功したように言わず、確認できなかった事実と次に必要な操作だけを短く伝える

## Meldex機能の詳細解説について

ユーザーがMeldexの使い方・機能・操作手順について質問した場合、**マニュアルフォルダ** \`MeldexHome/マニュアル/\` の該当ドキュメントをread_fileで読んでから解説してください。推測で答えず、マニュアルに基づいた正確な情報を提供してください。

主なマニュアル:
- **Meldex マニュアル.md** / **01_はじめに/クイックスタート.md** / **01_はじめに/画面の見方.md** / **01_はじめに/UI用語ガイド.md**
- **02_ツール別ガイド/フォルダツリー マニュアル.md** / **ノートエディタ マニュアル.md** / **シナリオエディタ マニュアル.md** / **シート マニュアル.md** / **スマートシート マニュアル.md**
- **02_ツール別ガイド/ボード マニュアル.md** / **カレンダー マニュアル.md** / **オプションパネル マニュアル.md** / **パネルレイアウト マニュアル.md** / **バージョン管理 マニュアル.md**
- **03_設定と連携/LLM設定.md** / **03_設定と連携/チャットLLM ツールガイド.md** / **03_設定と連携/LLMプライバシーガイド.md**
- **03_設定と連携/Chrome拡張機能の設定.md** / **CalDAVカレンダー同期の設定.md** / **画像ツールの設定.md** / **スマホ・タブレットからの利用.md**
- **04_サポート/よくある質問.md** / **トラブルシューティング集.md** / **既知の不具合.md** / **スクリーンショットの撮り方.md** / **ショートカット一覧/**

機能名・用語はマニュアル内の正式名称に従い、古い呼称（台本、データベース、メモ等）をユーザー向け説明に使わないでください。

## デバッグ・テスト支援

ユーザーがMeldexのテスター・バグ報告者として作業している場合、以下をサポート。関連情報は **04_サポート/トラブルシューティング集.md** や **04_サポート/既知の不具合.md** を参照。

### Meldex-QA 共有フォルダの構成
- \`テストケース/\` — テスト項目マスターDB（読み取り専用として扱う）
- \`テスト実績/\` — テスト結果記録先DB（テスターが書き込む）
- \`バグ報告/\` — バグ報告蓄積DB（タスクトレイの常駐アプリから自動送信される）
- \`テストデータ/\` — テスト用サンプルファイル群

### バグ報告作成支援
ユーザーが症状を説明したら、**良いバグ報告**の形式に整える手伝いをする:
- 操作手順（1-2-3の具体的ステップ）
- 実際に起きた症状（事実ベース、「おかしい」等の主観表現を避ける）
- 期待結果との差
- 再現性（毎回/条件付き/1回のみ）
- 環境（OS・ブラウザ・Meldexバージョン）

重要度判定: 致命的（クラッシュ・データ消失）/ 高（主要機能不可）/ 中（不便）/ 低（細かい不具合）

### テストケース作成支援
ユーザーが新機能のテストケースを考える際、以下の観点でリストアップ:
- 正常系（期待通りの操作）
- 異常系（想定外の入力・エラー処理）
- 境界値（最大/最小/ゼロ/空）
- 並行操作（複数の作業領域・複数ユーザー）
- UI確認（表示崩れ・レスポンシブ）

テストケースDBへの登録は create_entity + add_value で可能。

### テスト実績の集計支援
read_databaseで \`Meldex-QA/テスト実績/\` を読み、以下を提供:
- 機能別NG件数 / 未実行テストケース一覧
- テスター別進捗 / NG→修正済み再テスト未完了項目

### 既存バグとの重複チェック
新規の症状報告の前に、searchで \`Meldex-QA/バグ報告/\` を検索し類似報告がないか確認する。

## 作業指針

1. **まず調査**: 新規作成の依頼でも、まずsearch/browseで既存の関連ナレッジを確認し、整合性を取る
2. **形式を選択**: 依頼内容から最適な機能（シナリオ/シート/ボード/ノート）を選び、理由をユーザーに説明してから作成する
3. **実作成の確認**: 「作成しました」「登録しました」「完成しました」と言う前に、write_file / create_sheet / set_property_type / create_entity / add_value / configure_form_view / configure_public_form のツール結果が ok であることを確認し、必要なら browse/read_file/read_database でリンク先の存在を確認する。存在確認できないリンクを完成物として提示しない
4. **段階的提案**: 大規模な作成（シナリオ全体・シート全体）の前に、構成案・キャラクター案・章立て等をテキストで提示し、ユーザーの了承を得てから実ファイルを作成する
5. **既存の尊重**: 既存ファイルを大きく変更する場合は、read_fileで現状を確認し、差分をユーザーに示してから書き込む
6. **フロントマター保全**: .mdファイルの先頭にある\`---\`で囲まれたYAMLフロントマターは絶対に壊さない
7. **保護ファイル**: editor-config.json / .env.chat / _users.json / _permissions.json は編集不可
8. **ジャンル中立**: ユーザーの創作ジャンル（マンガ・小説・学術・ビジネス文書等）を勝手に決めつけず、依頼内容と既存ナレッジから判断する
9. **マニュアル参照**: 機能質問にはマニュアルを読んで正確に答える。憶測で答えない
10. **Meldex UI操作**: ユーザーがアプリ操作を依頼したら、必要に応じて llm_list_ui_controls で対象を確認し、llm_ui_action で操作する。ポップアップ内の細かいチェックボックスやドロップダウンも対象にする。クリックでポップアップを開いた後、必要なら再度 llm_list_ui_controls を使って内部のUIを確認する。selectorが見つからない場合だけlabel検索を使う
11. **編集ロック厳守**: ロック中のファイル/フォルダに対する編集・リネーム・削除・移動・保存・値追加は絶対に実行しない。UI操作で編集対象がある場合は path を付け、ツール結果がロックエラーならそこで停止してユーザーに報告する
`;

  // コンテキストバーにある添付ファイルのパスを追加
  const contextBar = document.getElementById('chat-context-bar');
  if (contextBar && contextBar.children.length > 0) {
    prompt += '\n## 現在のコンテキスト（ユーザーが開いているファイル）\n';
    Array.from(contextBar.querySelectorAll('.chat-context-item')).forEach(el => {
      prompt += '- ' + el.dataset.path + '\n';
    });
  }

  // 現在開いているビューの情報を追加
  if (state.currentPagePath) prompt += `\n現在開いているページ: ${state.currentPagePath}\n`;
  if (state.currentDbPath) prompt += `現在開いているシート: ${state.currentDbPath}\n`;
  if (state.currentBoardPath) prompt += `現在開いているボード: ${state.currentBoardPath}\n`;

  if (window.GBMeldexLlmOperations?.promptSummary) {
    const uiSummary = window.GBMeldexLlmOperations.promptSummary();
    if (uiSummary) prompt += '\n' + uiSummary + '\n';
  }

  // ファイル紐づきチャットの場合、対象ファイル情報を強調
  if (_chatState.targetPath) {
    prompt += `\n## このチャットの対象ファイル\nパス: ${_chatState.targetPath}\nこのチャットはこのファイルに関する会話です。ファイルの内容を参照する場合はread_fileツールを使ってください。\n`;
  }

  return prompt;
}

// ファイル紐づきチャットを開始/復元
async function openFileChat(targetPath) {
  if (!targetPath) return;
  const showOpenLoading = typeof showLoading === 'function' && typeof hideLoading === 'function';
  if (showOpenLoading) showLoading('チャットを読み込み中...');
  try {
  if (typeof _chatAbortActiveStreamForNavigation === 'function') _chatAbortActiveStreamForNavigation();
  await _initChatSourceFolderSelector();
  const detectedSourceFolder = _detectSourceFolderFromPath(targetPath);
  if (detectedSourceFolder !== _chatSourceFolderValue()) {
    await _setChatSourceFolder(detectedSourceFolder);
  }
  openRightPanelTab('chat');
  switchChatMode('llm');
  const liveMessagesContainer = await _chatWaitForLiveMessagesContainer();
  if (!liveMessagesContainer) {
    if (typeof showStatus === 'function') showStatus('チャット表示を準備中です', true);
    return;
  }
  if (typeof _chatBumpSessionGen === 'function') _chatBumpSessionGen();
  _chatState.pendingAttachments = [];
  if (typeof _renderChatAttachments === 'function') _renderChatAttachments();

  // _chat/llm/ 内からtargetPathが一致するチャットを検索
  let restored = false;
  try {
    const chatItems = await apiFetch(_chatApiPath('/chat/list'));
    for (const item of (chatItems || [])) {
      if (item.targetPath !== targetPath || !item.path) continue;
      const data = await apiFetch(_chatApiPath('/chat/load?path=' + encodeURIComponent(item.path)));
      if (data.messages?.length > 0) {
        _chatState.messages = _ensureChatMessageIds(data.messages);
        _chatState.sessionId = (item.path.split('/').pop() || '').replace('.md', '');
        _chatState.targetPath = targetPath;
        _setChatSessionTitle(data.frontmatter?.title || item.title || '');
        if (data.frontmatter?.provider) {
          _chatState.provider = data.frontmatter.provider;
          _safeSetValue('chat-provider', data.frontmatter.provider);
          updateChatModels();
          if (data.frontmatter.model) {
            _chatState.model = data.frontmatter.model;
            _safeSetValue('chat-model', data.frontmatter.model);
          }
        }
        const container = _chatLiveMessagesContainer();
        if (container) container.innerHTML = '';
        _chatState.messages.forEach((m, index) => {
          chatAddMessage(m.role, m.content, _chatMessageRenderOptions(m, index));
        });
        restored = true;
        break;
      }
    }
  } catch { /* 一覧復元失敗時は旧方式にフォールバック */ }

  if (!restored) {
    try {
      const llmBrowsePath = _chatSourceFolderValue()
        ? (_chatSourceFolderValue().replace(/[\\/]+$/, '') + '/_chat/llm')
        : '_chat/llm';
      const items = await apiFetch('/browse?path=' + encodeURIComponent(llmBrowsePath) + '&sort=modified&order=desc');
      for (const item of (items || [])) {
        try {
          const data = await apiFetch(_chatApiPath('/chat/load?path=' + encodeURIComponent(item.path)));
          if (data.frontmatter?.targetPath === targetPath && data.messages?.length > 0) {
            // 一致するセッションを復元
            _chatState.messages = _ensureChatMessageIds(data.messages);
            _chatState.sessionId = item.name.replace('.md', '');
            _chatState.targetPath = targetPath;
            _setChatSessionTitle(data.frontmatter?.title || '');
            if (data.frontmatter.provider) {
              _chatState.provider = data.frontmatter.provider;
              _safeSetValue('chat-provider', data.frontmatter.provider);
              updateChatModels();
              if (data.frontmatter.model) {
                _chatState.model = data.frontmatter.model;
                _safeSetValue('chat-model', data.frontmatter.model);
              }
            }
            const container = _chatLiveMessagesContainer();
            if (container) container.innerHTML = '';
            _chatState.messages.forEach((m, index) => {
              chatAddMessage(m.role, m.content, _chatMessageRenderOptions(m, index));
            });
            restored = true;
            break;
          }
        } catch { continue; }
      }
    } catch (e) { /* 検索失敗 */ }
  }

  if (!restored) {
    // チャットが存在しない → 作成ボタンを表示
    _chatState.messages = [];
    _chatState.sessionId = '';
    _chatState.targetPath = targetPath;
    _setChatSessionTitle('');
    const container = _chatLiveMessagesContainer();
    if (container) {
      container.innerHTML = '';
      const fileName = targetPath.split('/').pop();
      const placeholder = document.createElement('div');
      placeholder.className = 'chat-empty-placeholder';
      placeholder.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:24px;color:var(--fg2);';
      placeholder.innerHTML = `
        <div style="font-size:13px;margin-bottom:12px;">「${esc(fileName)}」のチャットはまだありません</div>
        <button data-action="_createFileChat('${esc(targetPath).replace(/'/g, "\\'")}')" style="padding:6px 16px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;cursor:pointer;font-size:13px;">${lucide('messagesSquare', 14)} チャットを作成</button>
      `;
      container.appendChild(placeholder);
    }
  }

  _showChatTargetBadge(targetPath);
  } finally {
    if (showOpenLoading) hideLoading();
  }
}

function _createFileChat(targetPath) {
  _chatState.messages = [];
  _chatState.sessionId = '';
  _chatState.targetPath = targetPath;
  if (typeof _chatClearQueuedMessages === 'function') _chatClearQueuedMessages();
  _setChatSessionTitle('');
  const container = _chatLiveMessagesContainer();
  if (container) container.innerHTML = '';
  const fileName = targetPath.split('/').pop();
  chatAddSystem(`「${fileName}」のチャットを作成しました`);
  _showChatTargetBadge(targetPath);
}

function _showChatTargetBadge(targetPath) {
  let badge = _chatLiveElement('chat-target-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'chat-target-badge';
    badge.style.cssText = 'padding:3px 8px;background:var(--bg3);border-bottom:1px solid var(--border);font-size:11px;color:var(--fg2);display:flex;align-items:center;gap:4px;flex-shrink:0;';
    // chat-llm-panelの先頭に挿入
    const panel = _chatLiveElement('chat-llm-panel');
    if (panel && panel.children.length > 1) {
      panel.insertBefore(badge, panel.children[1]);
    }
  }
  if (targetPath) {
    const name = targetPath.split('/').pop();
    badge.innerHTML = `${lucide('fileText', 12)} <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(targetPath)}">${esc(name)}</span><button data-action="chatClear()" style="background:none;border:none;color:var(--fg2);cursor:pointer;font-size:10px;">${lucide('x', 10)}</button>`;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function _chatScrollToMessage(msgId) {
  const id = String(msgId || '').trim();
  if (!id) return;
  const safeId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
  const target = document.querySelector(`#chat-messages [data-msg-id="${safeId}"]`);
  if (!target) return;
  target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  target.style.outline = '2px solid var(--accent)';
  target.style.outlineOffset = '2px';
  target.style.transition = 'outline-color 0.3s ease';
  setTimeout(() => { target.style.outlineColor = 'transparent'; }, 1500);
  setTimeout(() => { target.style.outline = ''; target.style.outlineOffset = ''; target.style.transition = ''; }, 1900);
}

// 保存済みチャットを開いてリプレイ＋続行
async function openSavedChat(path, anchor = '', sourceFolder) {
  const showOpenLoading = typeof showLoading === 'function' && typeof hideLoading === 'function';
  if (showOpenLoading) showLoading('チャットを読み込み中...');
  try {
  if (typeof _chatAbortActiveStreamForNavigation === 'function') _chatAbortActiveStreamForNavigation();
  const hashIndex = String(path || '').indexOf('#');
  if (hashIndex >= 0) {
    anchor = anchor || String(path).slice(hashIndex + 1);
    path = String(path).slice(0, hashIndex);
  }
  if (sourceFolder !== undefined && sourceFolder !== _chatSourceFolderValue()) {
    await _setChatSourceFolder(sourceFolder, { skipSave: true });
  } else {
    const detectedSourceFolder = _detectSourceFolderFromPath(path);
    if (detectedSourceFolder && detectedSourceFolder !== _chatSourceFolderValue()) {
      await _setChatSourceFolder(detectedSourceFolder, { skipSave: true });
    }
  }
  openRightPanelTab('chat');
  switchChatMode('llm');
  const liveMessagesContainer = await _chatWaitForLiveMessagesContainer();
  if (!liveMessagesContainer) {
    if (typeof showStatus === 'function') showStatus('チャット表示を準備中です', true);
    return;
  }
  if (typeof _chatBumpSessionGen === 'function') _chatBumpSessionGen();
  _chatState.pendingAttachments = [];
  if (typeof _renderChatAttachments === 'function') _renderChatAttachments();
  // 直接 fetch して status を判定（404 を他のエラーと区別するため apiFetch は使わない）
  let data = null;
  let notFound = false;
  let otherError = null;
  try {
    const user = (typeof getUsername === 'function') ? getUsername() : '';
    let url = (typeof API_BASE !== 'undefined' ? API_BASE : '/api') + '/chat/load?path=' + encodeURIComponent(path);
    const sourceFolderParam = _chatSourceFolderValue();
    if (sourceFolderParam) url += '&source_folder=' + encodeURIComponent(sourceFolderParam);
    if (user && user !== 'anonymous') url += '&_user=' + encodeURIComponent(user);
    const res = await fetch(url);
    if (res.status === 404) {
      notFound = true;
    } else if (!res.ok) {
      otherError = new Error('HTTP ' + res.status + ': ' + res.statusText);
    } else {
      data = await res.json();
    }
  } catch (e) {
    otherError = e;
  }

  if (notFound) {
    // 404フォールバック: 存在しないチャット → 穏やかに通知してリセット
    _chatState.messages = [];
    _chatState.sessionId = '';
    _chatState.targetPath = '';
    _setChatSessionTitle('');
    const container = _chatLiveMessagesContainer();
    if (container) container.innerHTML = '';
    _showChatTargetBadge('');
    // localStorage に残った古い savedPath 参照を除去
    try {
      const STORAGE_KEY = 'gb:last-chat-session';
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.savedPath) {
          // 該当 savedPath と一致する場合のみクリア（他チャットを誤って消さない）
          const legacySaved = '_chat/llm/' + (path.split('/').pop() || '');
          const targetSaved = _chatSavedPathForSession((path.split('/').pop() || '').replace(/\.md$/, ''));
          if (parsed.savedPath === path || parsed.savedPath === targetSaved || parsed.savedPath === legacySaved) {
            delete parsed.savedPath;
            parsed.savedAt = Date.now();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          }
        }
      }
    } catch {}
    const fileName = (path || '').split('/').pop() || '';
    chatAddSystem('チャット履歴が見つかりませんでした' + (fileName ? '（' + fileName + '）' : '') + '。新しいチャットを開始するか、履歴タブから既存のチャットを選んでください。');
    if (typeof showStatus === 'function') showStatus('チャット履歴が見つかりませんでした');
    if (typeof renderChatHistory === 'function') renderChatHistory();
    return;
  }

  if (otherError) {
    // 既存の挙動を維持（ネットワーク障害・5xx等はエラー表示）
    if (typeof showStatus === 'function') showStatus('チャット読み込みに失敗', true);
    return;
  }

  _chatState.messages = _ensureChatMessageIds(data.messages || []);
  // セッションIDをファイル名から復元
  const fname = path.split('/').pop().replace('.md', '');
  _chatState.sessionId = fname;
  _chatState.targetPath = data.frontmatter?.targetPath || '';
  _setChatSessionTitle(data.frontmatter?.title || '');
  if (data.frontmatter?.provider) {
    _chatState.provider = data.frontmatter.provider;
    _safeSetValue('chat-provider', data.frontmatter.provider);
    updateChatModels();
    if (data.frontmatter.model) {
      _chatState.model = data.frontmatter.model;
      _safeSetValue('chat-model', data.frontmatter.model);
    }
  }
  // メッセージをレンダリング
  const container = _chatLiveMessagesContainer();
  if (container) container.innerHTML = '';
  _showChatTargetBadge(_chatState.targetPath);
  chatAddSystem('保存済みチャットを読み込みました。');
  _chatState.messages.forEach((m, index) => {
    if (m.role === 'user') chatAddMessage('user', m.content, _chatMessageRenderOptions(m, index));
    else chatAddMessage('assistant', m.content, _chatMessageRenderOptions(m, index));
  });
  if (anchor) _chatScrollToMessage(anchor);
  } finally {
    if (showOpenLoading) hideLoading();
  }
}

function chatClear() {
  if (typeof _chatBumpSessionGen === 'function') _chatBumpSessionGen();
  _chatState.messages = [];
  _chatState.sessionId = '';
  _chatState.targetPath = '';
  _chatState.pendingAttachments = [];
  if (typeof _chatClearQueuedMessages === 'function') _chatClearQueuedMessages();
  if (typeof _renderChatAttachments === 'function') _renderChatAttachments();
  _setChatSessionTitle('');
  const container = _chatLiveMessagesContainer();
  if (container) container.innerHTML = '';
  // ファイル紐づき表示をクリア
  const badge = _chatLiveElement('chat-target-badge');
  if (badge) badge.style.display = 'none';
  chatAddSystem('新しいチャットを開始しました');
  renderChatHistory();
}

// セッションIDを生成/取得
function _ensureSessionId() {
  if (!_chatState.sessionId) {
    _chatState.sessionId = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19) + '_' + Math.random().toString(36).substring(2, 6);
  }
  return _chatState.sessionId;
}

// 自動保存（毎回のアシスタント応答後に呼ばれる）
async function chatAutoSave(options = {}) {
  const silent = options?.silent !== false;
  const messages = Array.isArray(options?.messages) ? options.messages : _chatState.messages;
  const savingCurrentSession = messages === _chatState.messages;
  if (messages.length === 0 && !options?.allowEmpty) return false;
  const hasSessionId = Object.prototype.hasOwnProperty.call(options || {}, 'sessionId');
  const hasSessionTitle = Object.prototype.hasOwnProperty.call(options || {}, 'sessionTitle');
  const hasTargetPath = Object.prototype.hasOwnProperty.call(options || {}, 'targetPath');
  const hasProvider = Object.prototype.hasOwnProperty.call(options || {}, 'provider');
  const hasModel = Object.prototype.hasOwnProperty.call(options || {}, 'model');
  const hasSourceFolder = Object.prototype.hasOwnProperty.call(options || {}, 'sourceFolder');
  if (savingCurrentSession && !hasSessionTitle) _captureChatSessionTitleFromInput();
  _ensureChatMessageIds(messages);
  let sid = hasSessionId ? String(options.sessionId || '') : String(_chatState.sessionId || '');
  if (!sid && savingCurrentSession) sid = _ensureSessionId();
  if (messages.length === 0 && options?.allowEmpty && !sid) return false;
  if (!sid) return false;
  const sessionTitle = hasSessionTitle ? String(options.sessionTitle || '') : (_chatState.sessionTitle || '');
  const targetPath = hasTargetPath ? String(options.targetPath || '') : (_chatState.targetPath || '');
  const provider = hasProvider ? options.provider : _chatState.provider;
  const model = hasModel ? options.model : _chatState.model;
  const sourceFolder = hasSourceFolder ? String(options.sourceFolder || '') : _chatSourceFolderValue();
  // 全チャットを _chat/llm/ に統一保存（ファイル紐づきもセッションの一つ）
  const savePath = _chatSavedPathForSession(sid);
  try {
    const knowledgeAutomation = typeof _chatKnowledgeAutomationForSave === 'function'
      ? await _chatKnowledgeAutomationForSave()
      : null;
    await apiPost('/chat/save', _chatPostPayload({
      path: savePath,
      messages,
      provider,
      model,
      title: sessionTitle,
      tags: targetPath ? [targetPath] : [],
      targetPath,
      source_folder: sourceFolder,
      user: typeof getUsername === 'function' ? getUsername() : '',
      ...(knowledgeAutomation ? { knowledge_automation: knowledgeAutomation } : {}),
    }));
    return true;
  } catch (e) {
    if (!silent) throw e;
    return false;
  }
}

function _chatExportTitle() {
  _captureChatSessionTitleFromInput();
  return _chatState.sessionTitle || _chatFallbackTitle(_chatState.sessionId, _chatState.targetPath) || 'チャット';
}

function _chatYamlQuote(value) {
  return JSON.stringify(String(value ?? ''));
}

function _chatHtmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _chatExportRoleLabel(message) {
  const role = String(message?.role || '').toLowerCase();
  if (role === 'user') return typeof getUsername === 'function' ? getUsername() : 'User';
  if (role === 'assistant') return getProviderLabel(message?.provider || _chatState.provider, message?.model || _chatState.model);
  return role || 'Message';
}

function _chatExportTimestamp(message) {
  return String(message?.timestamp || message?.created_at || message?.createdAt || message?.time || '').trim();
}

function _chatExportThemeCss() {
  const vars = (typeof MeldexExportHtml !== 'undefined' && typeof MeldexExportHtml.collectCssVars === 'function')
    ? MeldexExportHtml.collectCssVars()
    : '';
  return `
:root{${vars}}
html,body{
  margin:0;
  padding:0;
  background:var(--bg,#1e1e1e);
  color:var(--fg,#d4d4d4);
  font-family:var(--ui-font,'Noto Sans JP','Hiragino Sans','Yu Gothic UI','Meiryo',system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
  font-size:var(--ui-font-size,15px);
  line-height:1.6;
  scrollbar-color:var(--ui-scrollbar-thumb-bg,var(--bg4,#444)) var(--ui-scrollbar-track-bg,var(--bg2,#252525));
}
::-webkit-scrollbar{width:10px;height:10px;}
::-webkit-scrollbar-track{background:var(--ui-scrollbar-track-bg,var(--bg2,#252525));}
::-webkit-scrollbar-thumb{background:var(--ui-scrollbar-thumb-bg,var(--bg4,#444));border-radius:5px;}
::-webkit-scrollbar-thumb:hover{background:var(--ui-scrollbar-thumb-hover-bg,var(--fg2,#888));}
main{max-width:960px;margin:0 auto;padding:32px;}
article{border:1px solid var(--border,#444);border-radius:8px;padding:14px 16px;margin:14px 0;background:var(--bg2,#252525);}
article.user{background:var(--bg3,#303030);}
h1{font-size:28px;margin:0 0 18px;color:var(--accent,var(--fg));}
h2{font-size:16px;margin:0 0 10px;color:var(--fg,#d4d4d4);}
h3{font-size:14px;margin:14px 0 6px;color:var(--fg,#d4d4d4);}
time{font-size:12px;color:var(--fg2,#aaa);font-weight:400;}
pre{white-space:pre-wrap;word-break:break-word;background:var(--bg,#1e1e1e);color:var(--fg,#d4d4d4);border:1px solid var(--border,#444);border-radius:6px;padding:10px;overflow:auto;}
p{color:var(--fg2,#aaa);}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
`;
}

function _chatExportMessageMarkdown(message, index) {
  const role = _chatExportRoleLabel(message);
  const time = _chatExportTimestamp(message);
  const title = time ? `${role} (${time})` : role;
  const chunks = [`## ${index + 1}. ${title}`, '', _chatContentToText(message?.content || '').trim()];
  const blocks = Array.isArray(message?.code_exec_blocks) ? message.code_exec_blocks : [];
  blocks.forEach((block, blockIndex) => {
    const code = String(block?.code || '').trim();
    const output = typeof _chatCodeExecOutput === 'function' ? _chatCodeExecOutput(block) : '';
    if (code) chunks.push('', `### 実行コード ${blockIndex + 1}`, '', '```' + String(block?.language || 'python'), code, '```');
    if (output) chunks.push('', `### 実行結果 ${blockIndex + 1}`, '', '```text', output, '```');
  });
  return chunks.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

function _chatExportMarkdownBody(title) {
  const lines = [
    '# ' + title,
    '',
    '- エクスポート日時: ' + new Date().toISOString(),
    '- セッションID: ' + (_chatState.sessionId || '(未採番)'),
  ];
  if (_chatState.targetPath) lines.push('- 対象: ' + _chatState.targetPath);
  if (_chatState.provider || _chatState.model) lines.push('- モデル: ' + getProviderLabel(_chatState.provider, _chatState.model));
  lines.push('');
  _chatState.messages.forEach((message, index) => {
    lines.push(_chatExportMessageMarkdown(message, index), '');
  });
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

function _chatExportMeldexNote(title) {
  const frontmatter = [
    '---',
    'type: note',
    'source: chat-export',
    'title: ' + _chatYamlQuote(title),
    'chatSessionId: ' + _chatYamlQuote(_chatState.sessionId || ''),
    'chatTargetPath: ' + _chatYamlQuote(_chatState.targetPath || ''),
    'chatProvider: ' + _chatYamlQuote(_chatState.provider || ''),
    'chatModel: ' + _chatYamlQuote(_chatState.model || ''),
    'exportedAt: ' + _chatYamlQuote(new Date().toISOString()),
    '---',
    '',
  ];
  return frontmatter.join('\n') + _chatExportMarkdownBody(title);
}

function _chatExportHtml(title) {
  const messages = _chatState.messages.map((message, index) => {
    const role = _chatExportRoleLabel(message);
    const time = _chatExportTimestamp(message);
    const text = _chatContentToText(message?.content || '').trim();
    const blocks = Array.isArray(message?.code_exec_blocks) ? message.code_exec_blocks : [];
    const codeBlocks = blocks.map((block, blockIndex) => {
      const code = String(block?.code || '').trim();
      const output = typeof _chatCodeExecOutput === 'function' ? _chatCodeExecOutput(block) : '';
      return [
        code ? `<h3>実行コード ${blockIndex + 1}</h3><pre><code>${_chatHtmlEscape(code)}</code></pre>` : '',
        output ? `<h3>実行結果 ${blockIndex + 1}</h3><pre><code>${_chatHtmlEscape(output)}</code></pre>` : '',
      ].join('');
    }).join('');
    return `<article class="message ${_chatHtmlEscape(message?.role || '')}">
  <h2>${index + 1}. ${_chatHtmlEscape(role)}${time ? ` <time>${_chatHtmlEscape(time)}</time>` : ''}</h2>
  <pre>${_chatHtmlEscape(text)}</pre>
  ${codeBlocks}
</article>`;
  }).join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="dark light">
<title>${_chatHtmlEscape(title)}</title>
<style>
${_chatExportThemeCss()}
</style>
</head>
<body>
<main>
<h1>${_chatHtmlEscape(title)}</h1>
<p>エクスポート日時: ${_chatHtmlEscape(new Date().toISOString())}</p>
${messages}
</main>
</body>
</html>
`;
}

async function chatExport(format = 'markdown') {
  const key = String(format || 'markdown');
  if (_chatState.messages.length === 0) {
    showStatus('エクスポートするメッセージがありません', true);
    return false;
  }
  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
    showStatus('エクスポート機能を読み込めませんでした', true);
    return false;
  }
  const title = _chatExportTitle();
  const safeTitle = (typeof MeldexExportSave.sanitizeTitle === 'function')
    ? MeldexExportSave.sanitizeTitle(title, 'チャット')
    : (title || 'チャット');
  if (key === 'meldex-note') {
    return MeldexExportSave.saveText(_chatExportMeldexNote(title), {
      filename: safeTitle + '-Meldexノート.md',
      extension: '.md',
      filetypes: [['Meldexノート', '*.md'], ['Markdown', '*.md'], ['すべてのファイル', '*.*']],
      dialogTitle: 'チャットをMeldexノート形式でエクスポート',
      okMessage: 'チャットをMeldexノート形式でエクスポートしました',
      errorMessage: 'エクスポートに失敗しました',
    });
  }
  if (key === 'html') {
    return MeldexExportSave.saveText(_chatExportHtml(title), {
      filename: safeTitle + '.html',
      extension: '.html',
      filetypes: [['HTML', '*.html'], ['すべてのファイル', '*.*']],
      dialogTitle: 'チャットをHTML形式でエクスポート',
      okMessage: 'チャットをHTML形式でエクスポートしました',
      errorMessage: 'エクスポートに失敗しました',
    });
  }
  return MeldexExportSave.saveText(_chatExportMarkdownBody(title), {
    filename: safeTitle + '.md',
    extension: '.md',
    filetypes: [['Markdown', '*.md'], ['テキスト', '*.txt'], ['すべてのファイル', '*.*']],
    dialogTitle: 'チャットをMarkdown形式でエクスポート',
    okMessage: 'チャットをMarkdown形式でエクスポートしました',
    errorMessage: 'エクスポートに失敗しました',
  });
}

function showChatExportMenu(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  document.querySelectorAll('.gb-context-menu').forEach(menu => menu.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu chat-export-menu';
  const items = [
    { format: 'meldex-note', icon: 'fileText', label: 'Meldexノート形式' },
    { format: 'html', icon: 'globe', label: 'HTML形式' },
    { format: 'markdown', icon: 'fileText', label: 'Markdown形式' },
  ];
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'gb-context-menu-item';
    row.innerHTML = (typeof lucide === 'function' ? lucide(item.icon, 14) : '') + ' ' + item.label;
    row.addEventListener('click', () => {
      menu.remove();
      chatExport(item.format);
    });
    menu.appendChild(row);
  });
  document.body.appendChild(menu);
  const zoom = (typeof _getZoom === 'function') ? _getZoom() : 1;
  const anchor = event?.currentTarget?.getBoundingClientRect?.();
  if (anchor && typeof positionPopup === 'function') {
    positionPopup(menu, anchor);
  } else {
    menu.style.left = (((event?.clientX || window.innerWidth / 2) / zoom)) + 'px';
    menu.style.top = (((event?.clientY || 48) / zoom)) + 'px';
  }
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function chatSave(event) {
  return showChatExportMenu(event);
}

// チャット履歴一覧を表示
async function renderChatHistory() {
  const listEl = document.getElementById('chat-history-list');
  if (!listEl) return;
  listEl.innerHTML = '<div style="padding:8px;color:var(--fg2);font-size:11px;text-align:center;">読み込み中...</div>';
  try {
    const items = await apiFetch(_chatApiPath('/chat/list'));
    if (!items || items.length === 0) {
      listEl.innerHTML = '<div style="padding:8px;color:var(--fg2);font-size:11px;text-align:center;">履歴がありません</div>';
      return;
    }
    listEl.innerHTML = '';
    items.forEach(item => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;';
      div.onmouseover = () => div.style.background = 'rgba(255,255,255,0.03)';
      div.onmouseout = () => div.style.background = '';
      const isActive = _chatState.sessionId && item.name === _chatState.sessionId;
      const targetName = item.targetPath ? item.targetPath.split('/').pop() : '';
      const displayTitle = _chatListTitle(item) || item.name;
      const targetInfo = item.title && targetName && item.title !== targetName
        ? `<div style="margin-top:3px;font-size:10px;color:var(--fg2);display:flex;align-items:center;gap:4px;">${lucide('fileText', 10)} <span>${esc(targetName)}</span></div>`
        : '';
      const msgCount = item.messageCount ? `<span style="font-size:10px;color:var(--fg2);">${item.messageCount}件</span>` : '';
      const providerIcon = getProviderIconHtml(item.provider || 'gemini', 14);
      div.innerHTML = `<div style="display:flex;align-items:center;gap:4px;color:${isActive ? 'var(--accent)' : 'var(--fg)'};${isActive ? 'font-weight:bold;' : ''}">${providerIcon}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(displayTitle)}</span> ${msgCount}</div>${targetInfo}`;
      div.addEventListener('click', () => {
        openSavedChat(item.path);
      });
      listEl.appendChild(div);
    });
  } catch (e) {
    listEl.innerHTML = '<div style="padding:8px;color:var(--fg2);font-size:11px;text-align:center;">履歴を取得できません</div>';
  }
}

// ==============================
// チャット検索
// ==============================
let _chatSearchTimer = null;
function _chatSearchToggle() {
  const bar = document.getElementById('chat-search-bar');
  if (!bar) return;
  const visible = bar.style.display === 'flex';
  bar.style.display = visible ? 'none' : 'flex';
  if (!visible) {
    document.getElementById('chat-search-input')?.focus();
  } else {
    _chatSearchClose();
  }
}
function _chatSearchClose() {
  clearTimeout(_chatSearchTimer);
  const bar = document.getElementById('chat-search-bar');
  if (bar) bar.style.display = 'none';
  const results = document.getElementById('chat-search-results');
  if (results) { results.style.display = 'none'; results.innerHTML = ''; }
  const msgs = _chatLiveMessagesContainer();
  if (msgs) msgs.style.display = 'flex';
  // ハイライト除去
  if (msgs) msgs.querySelectorAll('.chat-search-hl').forEach(m => {
    m.replaceWith(document.createTextNode(m.textContent));
  });
  const countEl = document.getElementById('chat-search-count');
  if (countEl) countEl.textContent = '';
  const input = document.getElementById('chat-search-input');
  if (input) input.value = '';
}
// 全チャット検索結果からセッションを開く
function _chatLoadSession(path) {
  _chatSearchClose();
  if (typeof openSavedChat === 'function') openSavedChat(path);
}

function _chatAppendHighlightedText(parent, text, query) {
  const source = String(text || '');
  const needle = String(query || '');
  if (!parent || !needle) {
    parent?.appendChild(document.createTextNode(source));
    return;
  }
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let lastIndex = 0;
  source.replace(pattern, (match, offset) => {
    if (offset > lastIndex) parent.appendChild(document.createTextNode(source.slice(lastIndex, offset)));
    const mark = document.createElement('mark');
    mark.style.cssText = 'background:var(--orange);color:var(--ui-fg-strong);border-radius:2px;padding:0 1px;';
    mark.textContent = match;
    parent.appendChild(mark);
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < source.length) parent.appendChild(document.createTextNode(source.slice(lastIndex)));
}

function _chatSearch() {
  const q = document.getElementById('chat-search-input')?.value?.trim();
  const scope = document.getElementById('chat-search-scope')?.value || 'session';
  const countEl = document.getElementById('chat-search-count');
  if (!q) { _chatSearchClose(); _safeSetDisplay('chat-search-bar', 'flex'); return; }
  if (scope === 'session') {
    // セッション内検索: メッセージ内テキストをハイライト
    const results = document.getElementById('chat-search-results');
    if (results) { results.style.display = 'none'; }
    const msgs = _chatLiveMessagesContainer();
    if (!msgs) return;
    if (msgs) msgs.style.display = 'flex';
    // 既存ハイライト除去
    msgs.querySelectorAll('.chat-search-hl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
    let count = 0;
    const lq = q.toLowerCase();
    // 1パスでハイライト: 全テキストノードを収集してから一括処理
    const textNodes = [];
    const walker = document.createTreeWalker(msgs, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    for (const tnode of textNodes) {
      const text = tnode.textContent;
      const parent = tnode.parentNode;
      if (!parent || parent.classList?.contains('chat-search-hl')) continue;
      const parts = [];
      let lastIdx = 0;
      const lt = text.toLowerCase();
      let idx;
      while ((idx = lt.indexOf(lq, lastIdx)) >= 0) {
        if (idx > lastIdx) parts.push(document.createTextNode(text.substring(lastIdx, idx)));
        const hl = document.createElement('mark');
        hl.className = 'chat-search-hl';
        hl.style.cssText = 'background:var(--orange);color:var(--ui-fg-strong);border-radius:2px;padding:0 1px;';
        hl.textContent = text.substring(idx, idx + q.length);
        parts.push(hl);
        count++;
        lastIdx = idx + q.length;
      }
      if (parts.length) {
        if (lastIdx < text.length) parts.push(document.createTextNode(text.substring(lastIdx)));
        const frag = document.createDocumentFragment();
        parts.forEach(p => frag.appendChild(p));
        parent.replaceChild(frag, tnode);
      }
    }
    if (countEl) countEl.textContent = count + '件';
    // 最初のハイライトにスクロール
    const first = msgs.querySelector('.chat-search-hl');
    if (first) first.scrollIntoView({ block: 'center' });
  } else {
    // 全チャット検索: API経由
    const msgs = _chatLiveMessagesContainer();
    if (msgs) msgs.style.display = 'none';
    const results = document.getElementById('chat-search-results');
    if (!results) return;
    results.style.display = 'block';
    results.innerHTML = '<div style="color:var(--fg2);font-size:12px;padding:8px;">検索中...</div>';
    apiFetch(_chatApiPath('/chat/search?q=' + encodeURIComponent(q))).then(data => {
      const items = data.results || [];
      if (countEl) countEl.textContent = items.length + '件';
      if (items.length === 0) {
        results.innerHTML = '<div style="color:var(--fg2);font-size:12px;padding:8px;">結果なし</div>';
        return;
      }
      results.innerHTML = '';
      items.forEach(r => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;font-size:12px;';
        const title = document.createElement('div');
        title.style.cssText = 'font-weight:bold;color:var(--fg);margin-bottom:2px;';
        title.textContent = r.title || String(r.path || '').split('/').pop();
        const preview = document.createElement('div');
        preview.style.cssText = 'color:var(--fg2);font-size:11px;';
        _chatAppendHighlightedText(preview, r.snippet || '', q);
        row.append(title, preview);
        row.addEventListener('click', () => _chatLoadSession(r.path));
        results.appendChild(row);
      });
    }).catch(() => {
      results.innerHTML = '<div style="color:var(--fg2);font-size:12px;padding:8px;">検索に失敗しました</div>';
      if (countEl) countEl.textContent = '';
    });
  }
}
// 検索入力のデバウンス
document.getElementById('chat-search-input')?.addEventListener('input', () => {
  clearTimeout(_chatSearchTimer);
  _chatSearchTimer = setTimeout(_chatSearch, 300);
});
document.getElementById('chat-search-scope')?.addEventListener('change', () => { _chatSearch(); });

// Enter送信、Shift+Enter改行
document.getElementById('chat-input')?.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    if (typeof _chatIsImeEnterEvent === 'function' && _chatIsImeEnterEvent(e)) return;
    e.preventDefault();
    chatSend();
  }
});

// ============================
// メッセージ入力欄への D&D（LLM / チーム / DM 共通）
// - 画像 → pending 添付に追加（＋ボタンと同じ扱い）
// - 非画像 → アップロードして入力欄に 名前表示のリンクを挿入
// - 外部ブラウザの画像 URL → fetch して再アップロード
// ============================
function _chatMessageDropBind(inputId, messagesId, mode) {
  [inputId, messagesId].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('drop', (e) => { _chatMessageDropHandle(e, inputId, mode); });
  });
}

async function _chatMessageDropHandle(e, inputId, mode) {
  e.preventDefault();
  e.stopPropagation();
  const dt = e.dataTransfer;
  if (!dt) return;
  if (mode === 'team' && !_teamCurrentRoom) {
    if (typeof showStatus === 'function') showStatus('ルームを選択してください', true);
    return;
  }

  // 1. OS / 外部ブラウザからの実ファイル（画像 or それ以外）
  if (dt.files && dt.files.length > 0) {
    for (const file of dt.files) {
      await _chatMessageDropFile(file, mode, inputId);
    }
    return;
  }

  // 2. Meldex 内部ノードのドロップ（フォルダツリー/フォルダパネル/シート）
  const nodeData = dt.getData('application/x-meldex-node');
  if (nodeData) {
    try {
      const node = JSON.parse(nodeData);
      await _chatMessageDropMeldexNode(node, mode, inputId);
    } catch {}
    return;
  }

  // 3. Meldex 内部ビューワー画像（URL に path= が含まれる）
  const raw = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
  const internalMatch = raw.match(/\/(?:api\/)?file-raw\?[^\s]*?path=([^&\s]+)/);
  if (internalMatch) {
    const path = decodeURIComponent(internalMatch[1]);
    const name = path.split('/').pop() || 'image';
    if (_chatIsImagePath(path)) {
      _chatMessageDropAddImageByPath(name, path, mode);
    } else {
      _chatMessageDropInsertLink(inputId, _chatMessageDropLinkMarkup(name, path));
    }
    return;
  }

  // 4. 外部ブラウザの画像 URL（https://...）
  if (/^https?:\/\//i.test(raw)) {
    try {
      const resp = await fetch(raw, { mode: 'cors' });
      if (!resp.ok) throw new Error('fetch failed');
      const blob = await resp.blob();
      if (!blob.type?.startsWith('image/') && !_chatIsImagePath(raw.split('?')[0])) {
        _chatMessageDropInsertLink(inputId, raw);
        return;
      }
      const parsedUrl = new URL(raw);
      const rawName = (parsedUrl.pathname.split('/').pop() || 'image.png') || 'image.png';
      const name = decodeURIComponent(rawName);
      const file = new File([blob], name, { type: blob.type || 'image/png' });
      await _chatMessageDropFile(file, mode, inputId);
    } catch (err) {
      _chatMessageDropInsertLink(inputId, raw);
    }
    return;
  }

  // 5. ツリーパス（フォルダツリー以外の内部ドラッグ）
  const treePath = dt.getData('text/x-tree-path');
  if (treePath) {
    _chatMessageDropInsertLink(inputId, _chatMessageDropLinkMarkup('', treePath));
    return;
  }

  // 6. フォールバック: 任意テキスト
  if (raw) {
    _chatMessageDropInsertLink(inputId, raw);
  }
}

async function _chatMessageDropFile(file, mode, inputId) {
  if (file.type?.startsWith('image/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
    if (mode === 'team') {
      if (typeof _teamUploadAttachment === 'function') await _teamUploadAttachment(file);
    } else {
      if (typeof _chatUploadAttachment === 'function') await _chatUploadAttachment(file);
    }
    return;
  }
  // 非画像: アップロードして入力欄に名前表示のリンクを挿入
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('read error'));
      r.readAsDataURL(file);
    });
    const uploadDir = _chatMessageDropUploadDir(mode);
    const res = await apiFetch('/upload-file?path=' + encodeURIComponent(uploadDir), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: dataUrl, filename: file.name }),
    });
    _chatMessageDropInsertLink(inputId, _chatMessageDropLinkMarkup(file.name, res.path || file.name));
  } catch (err) {
    if (typeof showStatus === 'function') showStatus('ファイルのアップロードに失敗しました', true);
  }
}

async function _chatMessageDropMeldexNode(node, mode, inputId) {
  const items = Array.isArray(node?.items) && node.items.length ? node.items : [node];
  const linkTexts = [];
  for (const item of items) {
    const name = String(item?.name || '').trim();
    const path = String(item?.path || '').trim();
    const type = String(item?.type || '').trim();
    if (!path) continue;
    const isImage = type === 'image' || (typeof _chatIsImagePath === 'function' && _chatIsImagePath(path));
    if (isImage) {
      _chatMessageDropAddImageByPath(name || _chatMessageDropNameFromPath(path, 'image'), path, mode);
    } else {
      linkTexts.push(_chatMessageDropLinkMarkup(name, path));
    }
  }
  if (linkTexts.length) _chatMessageDropInsertLink(inputId, linkTexts.join('\n'));
}

function _chatMessageDropNameFromPath(path, fallback = 'リンク') {
  const clean = String(path || '').replace(/[?#].*$/, '').replace(/[\\/]+$/, '');
  const parts = clean.split(/[\\/]/).filter(Boolean);
  return parts.pop() || String(path || '').trim() || fallback;
}

function _chatMessageDropEscapeMarkdownLabel(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function _chatMessageDropMarkdownLinkMarkup(label, target) {
  const safeLabel = _chatMessageDropEscapeMarkdownLabel(label);
  const safeTarget = String(target || '').replace(/\\/g, '\\\\').replace(/\)/g, '\\)');
  return '[' + safeLabel + '](' + safeTarget + ')';
}

function _chatMessageDropLinkMarkup(name, pathOrUrl) {
  const target = String(pathOrUrl || '').trim();
  if (!target) return '';
  const label = String(name || '').trim() || _chatMessageDropNameFromPath(target, target);
  if (/^https?:\/\//i.test(target)) {
    return _chatMessageDropMarkdownLinkMarkup(label, target);
  }
  if (/[|\]]/.test(target)) return _chatMessageDropMarkdownLinkMarkup(label, target);
  return '[[' + target + '|' + String(label).replace(/\]/g, ')') + ']]';
}

function _chatMessageDropAddImageByPath(name, path, mode) {
  const att = {
    name: name || path.split('/').pop() || 'image',
    path,
    mime: (typeof _chatGuessMimeType === 'function') ? _chatGuessMimeType(path) : 'image/png',
    dataUrl: (typeof API_BASE === 'string' ? API_BASE : '') + '/file-raw?path=' + encodeURIComponent(path),
  };
  if (mode === 'team') {
    _teamPendingAttachments = _teamPendingAttachments || [];
    _teamPendingAttachments.push(att);
    if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
  } else {
    _chatState.pendingAttachments = _chatState.pendingAttachments || [];
    _chatState.pendingAttachments.push(att);
    if (typeof _renderChatAttachments === 'function') _renderChatAttachments();
  }
}

function _chatMessageDropInsertLink(inputId, text) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const insert = String(text || '');
  if (!insert) return;
  if (inputId === 'chat-input' && window.GBChatFormatting?.insertText?.(insert)) return;
  const hasFocusedSelection = document.activeElement === input
    && Number.isFinite(input.selectionStart)
    && Number.isFinite(input.selectionEnd);
  const pos = hasFocusedSelection ? input.selectionStart : input.value.length;
  const end = hasFocusedSelection ? input.selectionEnd : input.value.length;
  if (typeof input.setRangeText === 'function') {
    input.setRangeText(insert, pos, end, 'end');
  } else {
    input.value = input.value.substring(0, pos) + insert + input.value.substring(end);
    input.selectionStart = input.selectionEnd = pos + insert.length;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (inputId === 'chat-input' && window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
  if (inputId === 'chat-input' && window.GBChatFormatting?.focusInput?.()) return;
  input.focus();
}

function _chatMessageDropUploadDir(mode) {
  if (mode === 'team') {
    return typeof _teamChatUploadDir === 'function' ? _teamChatUploadDir() : '_chat';
  }
  const chatPath = state.currentPagePath || state.currentEntityPath || '';
  return chatPath ? chatPath.replace(/\/[^/]+$/, '') : '';
}

// LLM / チーム・DM 両方にバインド
_chatMessageDropBind('chat-input', 'chat-messages', 'llm');
_chatMessageDropBind('team-input', 'team-messages', 'team');

function _chatPostFileLink(name, pathOrUrl, isImage) {
  const persistPath = _chatNormalizeStoredPath(pathOrUrl.startsWith('blob:') ? name : pathOrUrl);
  const treatAsImage = !!isImage || _chatIsImagePath(persistPath || name);
  const content = treatAsImage
    ? _chatBuildImageContent(name, persistPath || pathOrUrl)
    : `[[${persistPath || name}]]`;
  const timestamp = _chatLocalTimestamp();
  const message = { role: 'user', content, timestamp };
  _ensureChatMessageId(message);
  chatAddMessage('user', content, { messageIndex: _chatState.messages.length, msg_id: message.msg_id, timestamp });
  _chatState.messages.push(message);
}

// （チャット・カレンダーボタンはHTML直書きに移行済み）

// ============================
// チャット名ドロップダウン（過去チャットの選択）
// ============================
let _chatTitleDropdown = null;
async function showChatHistoryDropdown(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  if (_chatTitleDropdown) { _closeChatTitleDropdown(); return; }
  const combo = document.getElementById('chat-title-combo');
  const input = document.getElementById('chat-session-title');
  if (!combo || !input) return;

  const popup = document.createElement('div');
  popup.id = 'chat-title-dropdown';
  popup.style.cssText = 'position:fixed;z-index:10080;background:var(--ui-popup-bg, var(--bg));color:var(--fg);border:1px solid var(--border);border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,0.25);min-width:240px;max-width:380px;max-height:320px;overflow-y:auto;font-size:12px;';
  const loading = document.createElement('div');
  loading.style.cssText = 'padding:8px;color:var(--fg2);text-align:center;';
  loading.textContent = '読み込み中...';
  popup.appendChild(loading);

  const comboRect = combo.getBoundingClientRect();
  popup.style.minWidth = (comboRect.width / _getZoom()) + 'px';
  document.body.appendChild(popup);
  positionPopup(popup, comboRect);
  _chatTitleDropdown = popup;

  const onOutside = (e) => {
    if (!popup.contains(e.target) && e.target.id !== 'chat-title-dropdown-btn') _closeChatTitleDropdown();
  };
  const onKey = (e) => { if (e.key === 'Escape') _closeChatTitleDropdown(); };
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
  }, 0);
  popup._cleanup = () => {
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onKey);
  };

  try {
    const items = await apiFetch(_chatApiPath('/chat/list'));
    popup.innerHTML = '';
    if (!items || items.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px;color:var(--fg2);text-align:center;';
      empty.textContent = '過去のチャットはありません';
      popup.appendChild(empty);
      return;
    }
    items.forEach(item => {
      const row = document.createElement('div');
      const isActive = _chatState.sessionId && item.name === _chatState.sessionId;
      row.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--border);cursor:pointer;' + (isActive ? 'background:var(--bg3);' : '');
      row.addEventListener('mouseover', () => row.style.background = isActive ? 'var(--bg3)' : 'rgba(255,255,255,0.05)');
      row.addEventListener('mouseout', () => row.style.background = isActive ? 'var(--bg3)' : '');
      const title = document.createElement('div');
      title.style.cssText = 'color:' + (isActive ? 'var(--accent)' : 'var(--fg)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' + (isActive ? 'font-weight:bold;' : '');
      title.textContent = _chatListTitle(item) || item.name;
      row.appendChild(title);
      const targetName = item.targetPath ? item.targetPath.split('/').pop() : '';
      if (item.title && targetName && item.title !== targetName) {
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:10px;color:var(--fg2);margin-top:2px;';
        sub.textContent = targetName;
        row.appendChild(sub);
      }
      row.addEventListener('click', () => {
        _closeChatTitleDropdown();
        openSavedChat(item.path);
      });
      popup.appendChild(row);
    });
  } catch (e) {
    popup.innerHTML = '';
    const err = document.createElement('div');
    err.style.cssText = 'padding:8px;color:var(--fg2);text-align:center;';
    err.textContent = '履歴を取得できません';
    popup.appendChild(err);
  }
}
window.showChatHistoryDropdown = showChatHistoryDropdown;

function _closeChatTitleDropdown() {
  if (!_chatTitleDropdown) return;
  if (typeof _chatTitleDropdown._cleanup === 'function') _chatTitleDropdown._cleanup();
  _chatTitleDropdown.remove();
  _chatTitleDropdown = null;
}

// ============================
// マルチモーダル: 画像添付
// ============================
let _chatSessionGen = 0;
function _chatBumpSessionGen() { _chatSessionGen++; }
window._chatBumpSessionGen = _chatBumpSessionGen;

function chatAttachmentPick() {
  const fileInput = document.getElementById('chat-attachment-file');
  if (!fileInput) return;
  fileInput.value = '';
  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files || []);
    for (const f of files) {
      await _chatUploadAttachment(f);
    }
    fileInput.value = '';
  };
  fileInput.click();
}
window.chatAttachmentPick = chatAttachmentPick;

async function _chatUploadAttachment(file) {
  const isPdf = file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
  if (!file || (!file.type?.startsWith('image/') && !isPdf)) {
    if (typeof showStatus === 'function') showStatus('画像またはPDFファイルのみ添付できます', true);
    return;
  }
  if (file.size > 32 * 1024 * 1024) {
    if (typeof showStatus === 'function') showStatus('添付ファイルは32MB以下にしてください', true);
    return;
  }
  const gen = _chatSessionGen;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('read error'));
      r.readAsDataURL(file);
    });
    const chatPath = state.currentPagePath || state.currentEntityPath || '';
    const uploadDir = chatPath ? chatPath.replace(/\/[^/]+$/, '') : '';
    const res = await apiFetch('/upload-file?path=' + encodeURIComponent(uploadDir), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: dataUrl, filename: file.name }),
    });
    if (gen !== _chatSessionGen) return;
    _chatState.pendingAttachments = _chatState.pendingAttachments || [];
    _chatState.pendingAttachments.push({
      name: file.name,
      path: res.path || file.name,
      mime: isPdf ? 'application/pdf' : (file.type || 'image/png'),
      dataUrl,
    });
    _renderChatAttachments();
  } catch (e) {
    if (gen !== _chatSessionGen) return;
    if (typeof showStatus === 'function') showStatus('添付ファイルのアップロードに失敗しました', true);
  }
}

function _renderChatAttachments() {
  const bar = document.getElementById('chat-attachments-bar');
  if (!bar) return;
  const list = _chatState.pendingAttachments || [];
  bar.innerHTML = '';
  if (list.length === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  list.forEach((att, idx) => {
    const chip = document.createElement('div');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 6px;background:var(--bg);border:1px solid var(--border);border-radius:3px;max-width:100%;';
    const isPdf = String(att.mime || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(att.name || att.path || '');
    const thumb = document.createElement(isPdf ? 'span' : 'img');
    if (isPdf) {
      thumb.innerHTML = typeof lucide === 'function' ? lucide('fileText', 18) : 'PDF';
      thumb.style.cssText = 'width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;color:var(--fg2);flex-shrink:0;';
    } else {
      thumb.src = att.dataUrl;
      thumb.alt = att.name;
      thumb.style.cssText = 'width:24px;height:24px;object-fit:cover;border-radius:2px;flex-shrink:0;';
    }
    const label = document.createElement('span');
    label.textContent = att.name;
    label.title = att.name;
    label.style.cssText = 'max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = '削除';
    close.style.cssText = 'background:transparent;color:var(--fg2);border:none;cursor:pointer;padding:0 4px;font-size:14px;line-height:1;';
    close.addEventListener('click', () => {
      _chatState.pendingAttachments.splice(idx, 1);
      _renderChatAttachments();
    });
    chip.appendChild(thumb);
    chip.appendChild(label);
    chip.appendChild(close);
    bar.appendChild(chip);
  });
}
window._renderChatAttachments = _renderChatAttachments;

function _chatClearPendingAttachments() {
  _chatState.pendingAttachments = [];
  _renderChatAttachments();
}
window._chatClearPendingAttachments = _chatClearPendingAttachments;


