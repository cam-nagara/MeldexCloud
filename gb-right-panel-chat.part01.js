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
const _chatState = { messages: [], streaming: false, provider: 'gemini', model: '', pendingModel: '', sessionId: '', targetPath: '', sessionTitle: '', sourceFolder: String(localStorage.getItem(_CHAT_SOURCE_FOLDER_STORAGE_KEY) || ''), modelsByProvider: {}, abortController: null };
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

document.getElementById('team-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); teamSend(); }
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
    const cfg = await apiFetch('/cli-chat/config');
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
    const data = await apiFetch(_chatApiPath('/settings-db/debug-report/exists'));
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

function _chatRenderStoredMessages() {
  const container = _chatLiveMessagesContainer();
  if (!container) return;
  container.innerHTML = '';
  _ensureChatMessageIds(_chatState.messages).forEach((message, index) => {
    if (!message || typeof message !== 'object') return;
    chatAddMessage(message.role || 'assistant', message.content, _chatMessageRenderOptions(message, index));
  });
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
    chatStopStreaming();
    return;
  }
  if (_chatIsCliProvider(_chatState.provider)) {
    if (window.GBChatCli?.sendCliChat) return window.GBChatCli.sendCliChat(options);
    if (typeof chatAddSystem === 'function') chatAddSystem('CLIチャット機能を読み込み中です。少し待ってから再送信してください。');
    return false;
  }
  _captureChatSessionTitleFromInput();
  const input = document.getElementById('chat-input');
  const msgContainer = _chatLiveMessagesContainer();
  if (!msgContainer) {
    if (typeof showStatus === 'function') showStatus('チャット表示を準備中です', true);
    return false;
  }
  const _pendingAtts = _chatState.pendingAttachments || [];
  const text = input.value.trim();
  if (!text && _pendingAtts.length === 0) return;
  const submitFingerprint = JSON.stringify({ text, attachments: _pendingAtts.map(att => att.path || att.name || '') });
  const now = Date.now();
  if (submitFingerprint === _chatLastSubmitFingerprint && now - _chatLastSubmitAt < 300) {
    if (typeof showStatus === 'function') showStatus('同じメッセージの連続送信を抑止しました');
    return false;
  }
  if (window.MeldexOnlineStatus?.assertOnlineForLlm && !window.MeldexOnlineStatus.assertOnlineForLlm()) {
    chatAddSystem(window.MeldexOnlineStatus.offlineMessage());
    return false;
  }
  _chatLastSubmitFingerprint = submitFingerprint;
  _chatLastSubmitAt = now;
  chatRefreshUsageBanner().catch(() => {});
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
  if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);

  // CLIP画像検索コマンド: /image-search <query> または /画像検索 <query>
  const imgSearchMatch = text.match(/^\/(?:image-search|画像検索)\s+(.+)/i);
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
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
    if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
    chatAddSystem(providerStatus.message || '送信設定を確認してください。');
    _chatRefreshApiKeyState().catch(() => {});
    return false;
  }

  // ユーザーメッセージ表示・記録（画像添付があれば構造化コンテンツにする）
  let _userContent = text;
  if (_pendingAtts.length > 0) {
    _userContent = [
      { type: 'text', text: text },
      ..._pendingAtts.map(att => {
        const mime = String(att.mime || '').toLowerCase();
        const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(att.name || att.path || '');
        return { type: isPdf ? 'document' : 'image', name: att.name, path: att.path, mimeType: isPdf ? 'application/pdf' : att.mime };
      }),
    ];
    if (typeof _chatClearPendingAttachments === 'function') _chatClearPendingAttachments();
    else _chatState.pendingAttachments = [];
  }
  const userTimestamp = _chatLocalTimestamp();
  const userMessage = { role: 'user', content: _userContent, timestamp: userTimestamp };
  _ensureChatMessageId(userMessage);
  chatAddMessage('user', _userContent, { messageIndex: _chatState.messages.length, msg_id: userMessage.msg_id, timestamp: userTimestamp });
  _chatState.messages.push(userMessage);
  _ensureSessionId();

  // ストリーミング開始
  const streamMessages = _chatState.messages;
  const streamProvider = _chatState.provider;
  const streamModel = _chatState.model;
  const streamSessionId = _chatState.sessionId || '';
  const streamSessionTitle = _chatState.sessionTitle || '';
  const streamTargetPath = _chatState.targetPath || '';
  const streamSourceFolder = _chatSourceFolderValue();
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
