/* Chat-side LLM generation settings */

let _chatGenerationSettingsMenu = null;
const CHAT_NATIVE_GENERATION_STORAGE_KEY = 'chat-native-generation-settings';

function _chatGenerationModel(provider = _chatGenerationCurrentProvider()) {
  try { return String(_chatState.provider === provider ? _chatState.model || '' : ''); } catch { return ''; }
}

function _chatNativeGenerationKey(provider, model) {
  return JSON.stringify([String(provider || ''), String(model || '_cli_default_')]);
}

function _chatReadNativeGenerationMap() {
  try {
    const value = JSON.parse(localStorage.getItem(CHAT_NATIVE_GENERATION_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function _chatNativeGenerationSettings(provider = _chatGenerationCurrentProvider(), model = _chatGenerationModel(provider), options = {}) {
  const map = _chatReadNativeGenerationMap();
  const key = _chatNativeGenerationKey(provider, model);
  const saved = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
  const levels = _chatReasoningLevelOptions(provider, model).map(item => item[0]);
  // 共通の旧値は最初に利用するモデルだけへ引き継ぎ、以後は別モデルへ持ち越さない。
  const legacy = Object.keys(map).length === 0 ? localStorage.getItem('chat-reasoning-level') : 'off';
  const previous = saved?.reasoning_level ?? legacy ?? 'off';
  const raw = previous === 'standard' ? 'medium' : previous;
  const order = ['off', 'low', 'medium', 'high', 'xhigh', 'max', 'ultracode', 'ultra'];
  const migratedLevel = order.slice(0, order.indexOf(raw) + 1).reverse().find(value => levels.includes(value)) || 'off';
  const settings = {
    reasoning_level: levels.includes(raw) ? raw : !saved ? migratedLevel : 'off',
    speed_mode: _chatSpeedOptions(provider, model).some(item => item[0] === saved?.speed_mode) ? saved.speed_mode : 'default',
  };
  // 旧来の共通値の引き継ぎは、実際に使うモデルが決まってから一度だけ行う（表示の更新だけでは保存しない）。
  if (!options.readOnly && legacy != null && Object.keys(map).length === 0) _chatStoreNativeGenerationSettings(settings, provider, model);
  return settings;
}

function _chatStoreNativeGenerationSettings(values, provider = _chatGenerationCurrentProvider(), model = _chatGenerationModel(provider)) {
  const map = _chatReadNativeGenerationMap();
  map[_chatNativeGenerationKey(provider, model)] = {
    reasoning_level: String(values.reasoning_level || 'off'),
    speed_mode: String(values.speed_mode || 'default'),
  };
  localStorage.setItem(CHAT_NATIVE_GENERATION_STORAGE_KEY, JSON.stringify(map));
}

function _chatSpeedOptions(provider, model = _chatGenerationModel(provider)) {
  const name = String(model || '').toLowerCase();
  const options = [['default', '既定'], ['standard', '標準']];
  if (provider === 'codex') {
    options.push(['fast', '高速']);
    const entry = (typeof CHAT_CLI_MODEL_CATALOG !== 'undefined' && Array.isArray(CHAT_CLI_MODEL_CATALOG.codex))
      ? CHAT_CLI_MODEL_CATALOG.codex.find(item => item && String(item.id || '').toLowerCase() === name)
      : null;
    const ultrafast = Array.isArray(entry?.speeds) ? entry.speeds.includes('ultrafast') : /^gpt-6(?:\.1-sol|-astra)(?:$|-)/.test(name);
    if (ultrafast) options.push(['ultrafast', '超高速']);
    return options;
  }
  if (provider === 'claude_code'
      && (name === 'opus' || /^claude-opus-(5(?:-5)?|4-8)(?:$|-)/.test(name))) {
    return [...options, ['fast', '高速']];
  }
  return [];
}

function _chatGenerationSpeedRowHtml() {
  const provider = _chatGenerationCurrentProvider();
  const options = _chatSpeedOptions(provider);
  if (!options.length) return '';
  const selected = _chatNativeGenerationSettings(undefined, undefined, { readOnly: true }).speed_mode;
  return _chatGenerationSettingsRow('応答速度', `<select id="chat-menu-speed-mode" class="gb-input" style="max-width:150px;">${options.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`)
    + `<div data-chat-speed-notice ${['fast', 'ultrafast'].includes(selected) ? '' : 'hidden'} style="font-size:11px;color:var(--fg2);line-height:1.5;">高速・超高速は利用枠の消費や料金が増えます。対応モデル・契約でのみ利用できます。</div>`;
}

const CHAT_GENERATION_NUMERIC_SETTINGS = {
  'temperature': { key: 'chat-temperature', min: 0, max: 2, integer: false },
  'max-tokens': { key: 'chat-max-tokens', min: 1024, max: 32768, integer: true },
  'top-p': { key: 'chat-top-p', min: 0, max: 1, integer: false },
};

function _closeChatGenerationSettingsMenu() {
  if (!_chatGenerationSettingsMenu) return;
  if (typeof _chatGenerationSettingsMenu._cleanup === 'function') _chatGenerationSettingsMenu._cleanup();
  _chatGenerationSettingsMenu.remove();
  _chatGenerationSettingsMenu = null;
}

function _chatGenerationSettingValue(key, fallback) {
  const value = localStorage.getItem(key);
  return value == null || value === '' ? fallback : value;
}

function _normalizeChatGenerationNumberValue(value, config) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const number = Number(raw);
  if (!Number.isFinite(number)) return '';
  const clamped = Math.max(config.min, Math.min(config.max, config.integer ? Math.floor(number) : number));
  return config.integer ? String(clamped) : String(Math.round(clamped * 1000) / 1000);
}

function _chatGenerationStoredNumberValue(id) {
  const config = CHAT_GENERATION_NUMERIC_SETTINGS[id];
  if (!config) return '';
  return _normalizeChatGenerationNumberValue(localStorage.getItem(config.key), config);
}

function _chatGenerationSettingsRow(label, controlHtml) {
  return `<label style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:var(--fg);">
    <span>${esc(label)}</span>
    ${controlHtml}
  </label>`;
}

function _chatGenerationCurrentProvider() {
  try {
    return typeof _chatState !== 'undefined' ? String(_chatState.provider || '') : '';
  } catch {
    return '';
  }
}

// 思考の深さ（reasoning）はサーバ実装（meldex_chat_stream_support.py / meldex_api_cli_chat.py）で
// anthropic/openai/gemini の3プロバイダ（API経由）に加え、claude_code/codex/antigravity_cli
// （CLI経由、--effort注入）でも生成オプションへ反映される。local_llm は未対応のまま。
// antigravity_cli は原則 low/medium/high の3段階で、それ以上はhighへ丸める
// （meldex_cli_chat_model_args.py の _cli_chat_reasoning_effort_for_antigravity 参照）。
// Gemini 4 Neon だけは xhigh 変種を持つため「最高」まで選べる。
const CHAT_REASONING_SUPPORTED_PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'claude_code', 'codex', 'antigravity_cli']);

function _chatGenerationReasoningSupported(provider) {
  return CHAT_REASONING_SUPPORTED_PROVIDERS.has(String(provider || '').trim().toLowerCase());
}

// モデルごとの思考段階。CLIの「既定」は思考引数を追加しない。
// 内部値はgb-right-panel-chat.part01.part01.jsのCHAT_REASONING_LEVELSと対応させること。
function _chatReasoningLevelOptions(provider, model = _chatGenerationModel(provider)) {
  const base = [
    ['off', '既定'],
    ['low', '低'],
    ['medium', '中'],
    ['high', '高'],
    ['xhigh', '最高'],
    ['max', '最大'],
  ];
  const name = String(model || '').toLowerCase();
  // CLIが示すモデル一覧に深さの一覧があれば、それだけを出す（Codex / Antigravity CLI）。
  const catalogEntry = (typeof CHAT_CLI_MODEL_CATALOG !== 'undefined' && Array.isArray(CHAT_CLI_MODEL_CATALOG[provider]))
    ? CHAT_CLI_MODEL_CATALOG[provider].find(item => item && String(item.id || '').toLowerCase() === name)
    : null;
  if (['codex', 'antigravity_cli'].includes(provider) && Array.isArray(catalogEntry?.efforts)) {
    const efforts = catalogEntry.efforts.map(value => String(value));
    const extra = [['ultra', 'Ultra']];
    return [base[0], ...base.slice(1).filter(([value]) => efforts.includes(value)), ...extra.filter(([value]) => efforts.includes(value))];
  }
  if (provider === 'antigravity_cli') {
    const variants = name === 'gemini-3.1-pro' ? ['low', 'high']
      : name === 'gpt-oss-120b' ? ['medium']
      : name === 'gemini-4-neon' ? ['low', 'medium', 'high', 'xhigh']
      : ['low', 'medium', 'high'];
    return base.filter(([value]) => value === 'off' || variants.includes(value));
  }
  if (provider === 'openai') return base.filter(([value]) => value !== 'max' || /^gpt-6/.test(name));
  if (provider === 'gemini') return base.filter(([value]) => ['off', 'low', 'medium', 'high'].includes(value));
  if (['claude_code', 'anthropic'].includes(provider)) {
    if (provider === 'claude_code' && /^claude-(opus|sonnet|haiku)-4-[0-5](?:$|-)/.test(name)) return [base[0]];
    if (/claude-(opus|sonnet)-4-6/.test(name)) return base.filter(([value]) => value !== 'xhigh');
    if (provider === 'claude_code') base.push(['ultracode', 'Ultracode']);
  }
  if (provider === 'codex' && /^gpt-(6(?:\.1-sol|-astra|-sol)|5\.6-(?:sol|terra))$/.test(name)) base.push(['ultra', 'Ultra']);
  return base;
}

// 思考の深さはメッセージ入力欄の下（#chat-reasoning-level）で選ぶ。LLM設定ポップアップには置かない。
// 値はプロバイダ×モデルごとに保存し、指定できないモデルでは選択欄ごと隠す。
function _chatReasoningLevelLabel(provider, model, level) {
  const value = typeof _chatNormalizeReasoningLevel === 'function' ? _chatNormalizeReasoningLevel(level) : String(level || '');
  if (!value) return '';
  const found = _chatReasoningLevelOptions(provider, model).find(([key]) => key === value);
  if (found) return found[1];
  return ({ off: '既定', low: '低', medium: '中', high: '高', xhigh: '最高', max: '最大', ultracode: 'Ultracode', ultra: 'Ultra' })[value] || value;
}

function _chatRefreshReasoningControl() {
  const select = document.getElementById('chat-reasoning-level');
  if (!select) return;
  const provider = _chatGenerationCurrentProvider();
  const model = _chatGenerationModel(provider);
  const options = _chatReasoningLevelOptions(provider, model);
  const supported = _chatGenerationReasoningSupported(provider) && options.length > 1;
  select.dataset.generationProvider = provider;
  select.dataset.generationModel = model;
  select.hidden = !supported;
  select.disabled = !supported;
  if (!supported) { select.innerHTML = ''; return; }
  const stored = _chatNativeGenerationSettings(provider, model, { readOnly: true }).reasoning_level;
  select.innerHTML = options.map(([value, label]) => `<option value="${value}">思考: ${esc(label)}</option>`).join('');
  select.value = options.some(([value]) => value === stored) ? stored : 'off';
}

function _chatBindReasoningControl() {
  const select = document.getElementById('chat-reasoning-level');
  if (!select || select.dataset.reasoningBound === '1') return;
  select.dataset.reasoningBound = '1';
  select.addEventListener('change', () => {
    const provider = select.dataset.generationProvider || _chatGenerationCurrentProvider();
    const model = select.dataset.generationModel ?? _chatGenerationModel(provider);
    const current = _chatNativeGenerationSettings(provider, model, { readOnly: true });
    const level = select.value || 'off';
    const map = _chatReadNativeGenerationMap();
    map[_chatNativeGenerationKey(provider, model)] = { ...current, reasoning_level: level };
    if (!_chatPersistPreferences({
      [CHAT_NATIVE_GENERATION_STORAGE_KEY]: JSON.stringify(map),
      'chat-reasoning-level': level,
    })) {
      _chatRefreshReasoningControl();
      return;
    }
    if (typeof _chatSaveCurrentRoomModelSettings === 'function') _chatSaveCurrentRoomModelSettings();
  });
}

// 現行世代のClaudeモデル（Fable 5 / Opus 5 / Opus 4.8 / Opus 4.7 / Sonnet 5）はtemperature/top_pに
// 既定値以外を指定するとエラーになるため、詳細パラメータの値があっても送信時に省略される
// （meldex_chat_stream_support.py の _anthropic_supports_sampling_params 参照）。
// UI共通ルール: モデルのコード名やtemperature/top_pといった内部用語は基本UIに出さず、
// ツールチップへ集約する。
function _chatGenerationSamplingParamsNoteHtml() {
  if (_chatGenerationCurrentProvider() !== 'anthropic') return '';
  return `<div data-chat-sampling-params-note style="font-size:11px;color:var(--fg2);margin-top:6px;">${fieldHelp('一部の新しいモデルではこの詳細指定は使われません')}</div>`;
}

// CLIチャット（Antigravity CLI / Claude Code / Codex CLI）では、Web検索・自動要約・
// コード実行・応答プリセット・詳細パラメータは各CLI側の設定で決まり、Meldexからは
// 一切渡していない。押しても何も起きない項目を並べないよう、CLI選択中は出さない
// （app/AGENTS.md「機能しないなら表示しない」）。
function _chatGenerationIsCliProvider() {
  return !!window.GBChatCli?.isCliChatProvider?.(_chatGenerationCurrentProvider());
}

function _chatGenerationApiOnlyControlsHtml() {
  if (_chatGenerationIsCliProvider()) return '';
  return `
    <label class="gb-check" style="margin:0;"><input id="chat-menu-allow-web-search" type="checkbox" ${localStorage.getItem('chat-allow-web-search') !== '0' ? 'checked' : ''}><span>Web検索を許可</span></label>
    <label class="gb-check" style="margin:0;"><input id="chat-menu-auto-compress" type="checkbox" ${localStorage.getItem('chat-auto-compress') === '1' ? 'checked' : ''}><span>長い会話を自動要約</span></label>
  `;
}

function _chatGenerationCodeExecutionControlHtml() {
  if (_chatGenerationIsCliProvider()) return '';
  return `<label class="gb-check" style="margin:0;"><input id="chat-menu-allow-code-execution" type="checkbox" ${localStorage.getItem('chat-allow-code-execution') === '1' ? 'checked' : ''}><span>コード実行を許可</span></label>`;
}

function _chatGenerationResponseTuningHtml() {
  if (_chatGenerationIsCliProvider()) return '';
  return `
    ${_chatGenerationSettingsRow('応答プリセット', `<select id="chat-menu-param-preset" class="gb-input" style="max-width:130px;">
      ${[
        ['creative', '創作'],
        ['standard', '標準'],
        ['strict', '厳密'],
      ].map(([v, label]) => `<option value="${v}" ${_chatGenerationSettingValue('chat-param-preset', 'standard') === v ? 'selected' : ''}>${label}</option>`).join('')}
    </select>`)}
    <details data-chat-generation-details style="font-size:12px;color:var(--fg2);">
      <summary style="cursor:pointer;">詳細パラメータ</summary>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
        ${_chatGenerationSettingsRow('temperature', `<input id="chat-menu-temperature" type="number" min="0" max="2" step="0.1" class="gb-input" style="max-width:100px;" value="${esc(_chatGenerationStoredNumberValue('temperature'))}" placeholder="自動">`)}
        ${_chatGenerationSettingsRow('max tokens', `<input id="chat-menu-max-tokens" type="number" min="1024" max="32768" step="512" class="gb-input" style="max-width:100px;" value="${esc(_chatGenerationStoredNumberValue('max-tokens'))}" placeholder="8192">`)}
        ${_chatGenerationSettingsRow('top_p', `<input id="chat-menu-top-p" type="number" min="0" max="1" step="0.05" class="gb-input" style="max-width:100px;" value="${esc(_chatGenerationStoredNumberValue('top-p'))}" placeholder="自動">`)}
        ${_chatGenerationSamplingParamsNoteHtml()}
      </div>
    </details>
  `;
}

function _chatGenerationCliSessionControlsHtml() {
  const provider = _chatGenerationCurrentProvider();
  const cli = window.GBChatCli;
  if (!cli?.isCliChatProvider?.(provider) || !cli?.sessionContinuitySupported?.(provider)) return '';
  const checked = cli.sessionContinuityEnabled(provider) ? 'checked' : '';
  const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 13) : '';
  return `
    <div data-chat-cli-session-controls style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <label class="gb-check" style="margin:0;min-width:0;"><input id="chat-menu-cli-session-continuity" type="checkbox" ${checked}><span>CLIの会話を継続</span></label>
      <button type="button" data-chat-cli-session-reset data-e2e-id="chat-menu-cli-session-reset" title="このチャットのCLI会話継続をリセット" style="display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border:1px solid var(--border);border-radius:4px;background:var(--bg3);color:var(--fg);font-size:12px;cursor:pointer;white-space:nowrap;">${resetIcon}<span>リセット</span></button>
    </div>
  `;
}

function _repositionChatGenerationSettingsMenu(menu, anchor) {
  if (!menu || !menu.isConnected) return;
  menu.style.maxHeight = '';
  menu.style.maxWidth = '';
  menu.style.overflowX = '';
  menu.style.overflowY = '';
  if (typeof positionPopup === 'function' && anchor?.getBoundingClientRect) {
    positionPopup(menu, anchor.getBoundingClientRect(), { prefer: 'below' });
  } else if (typeof clampPopupToViewport === 'function') {
    clampPopupToViewport(menu);
  }
}

function _scheduleChatGenerationSettingsReposition(menu, anchor) {
  const run = () => _repositionChatGenerationSettingsMenu(menu, anchor);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
  } else {
    setTimeout(run, 0);
  }
  setTimeout(run, 80);
}

function _restoreChatGenerationSettingsControls(menu) {
  for (const id of ['allow-web-search', 'auto-compress', 'cli-session-continuity', 'allow-code-execution']) {
    const input = menu.querySelector('#chat-menu-' + id);
    if (input) input.checked = ['cli-session-continuity', 'allow-web-search'].includes(id)
      ? localStorage.getItem('chat-' + id) !== '0'
      : localStorage.getItem('chat-' + id) === '1';
  }
  const speed = menu.querySelector('#chat-menu-speed-mode');
  if (speed) speed.value = _chatNativeGenerationSettings(menu.dataset.generationProvider, menu.dataset.generationModel, { readOnly: true }).speed_mode;
  const preset = menu.querySelector('#chat-menu-param-preset');
  if (preset) preset.value = _chatGenerationSettingValue('chat-param-preset', 'standard');
  for (const id of Object.keys(CHAT_GENERATION_NUMERIC_SETTINGS)) {
    const input = menu.querySelector('#chat-menu-' + id);
    if (input) input.value = _chatGenerationStoredNumberValue(id);
  }
}

function _persistChatGenerationSettings(menu, options = {}) {
  const values = {}, normalizedNumbers = [];
  for (const id of ['allow-web-search', 'auto-compress', 'cli-session-continuity', 'allow-code-execution']) {
    const input = menu.querySelector('#chat-menu-' + id);
    if (input) values['chat-' + id] = input.checked ? '1' : '0';
  }
  const speed = menu.querySelector('#chat-menu-speed-mode');
  if (speed) {
    const provider = menu.dataset.generationProvider, model = menu.dataset.generationModel;
    const current = _chatNativeGenerationSettings(provider, model, { readOnly: true });
    const map = _chatReadNativeGenerationMap();
    map[_chatNativeGenerationKey(provider, model)] = { ...current, speed_mode: speed.value || 'default' };
    values[CHAT_NATIVE_GENERATION_STORAGE_KEY] = JSON.stringify(map);
  }
  const preset = menu.querySelector('#chat-menu-param-preset');
  if (preset) values['chat-param-preset'] = preset.value || 'standard';
  Object.entries(CHAT_GENERATION_NUMERIC_SETTINGS).forEach(([id, config]) => {
    const input = menu.querySelector('#chat-menu-' + id);
    if (!input) return;
    const normalized = _normalizeChatGenerationNumberValue(input.value.trim(), config);
    values[config.key] = normalized || null;
    normalizedNumbers.push([input, normalized]);
  });
  // A team room stores the same settings separately; commit both copies together.
  if (typeof _chatMode !== 'undefined' && _chatMode === 'team' && _teamCurrentRoom) {
    const key = _chatRoomSettingsKey(_teamCurrentRoom);
    if (key) {
      const generation = _chatGenerationStorageSnapshot();
      for (const [name, value] of Object.entries(values)) {
        if (!CHAT_ROOM_GENERATION_STORAGE_KEYS.includes(name)) continue;
        if (value == null) delete generation[name];
        else generation[name] = value;
      }
      values[key] = JSON.stringify({
        provider: _chatProviderKey(_chatState.provider), model: String(_chatState.model || '').trim(),
        generation, savedAt: Date.now(),
      });
    }
  }
  if (!_chatPersistPreferences(values)) {
    // Restore existing nodes: rebuilding the menu loses focus and details state.
    _restoreChatGenerationSettingsControls(menu);
    return false;
  }
  if (options.normalizeNumbers) for (const [input, normalized] of normalizedNumbers) {
    if (input.value !== normalized) input.value = normalized;
  }
  return true;
}

function showChatGenerationSettingsMenu(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  const anchor = event?.target?.closest?.('button') || event?.currentTarget || null;
  if (_chatGenerationSettingsMenu) { _closeChatGenerationSettingsMenu(); return; }
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu chat-generation-settings-menu';
  menu.dataset.generationProvider = _chatGenerationCurrentProvider();
  menu.dataset.generationModel = _chatGenerationModel();
  menu.style.cssText = 'position:fixed;z-index:10090;min-width:280px;max-width:340px;padding:10px;display:flex;flex-direction:column;gap:10px;';
  menu.innerHTML = `
    <div class="chat-generation-settings-heading" style="display:flex;align-items:center;gap:4px;font-weight:600;font-size:13px;color:var(--fg);line-height:1.4;">
      <span data-chat-generation-title>LLM設定</span>
      <span data-chat-generation-tuning-hint>${fieldHelp('応答の賢さは入力欄の下の思考の深さとモデルで、速度は軽いモデルの選択で調整できます')}</span>
    </div>
    ${_chatGenerationApiOnlyControlsHtml()}
    ${_chatGenerationCliSessionControlsHtml()}
    ${_chatGenerationCodeExecutionControlHtml()}
    ${_chatGenerationSpeedRowHtml()}
    ${_chatGenerationResponseTuningHtml()}
  `;
  menu.addEventListener('change', () => {
    _persistChatGenerationSettings(menu, { normalizeNumbers: true });
    const speedNotice = menu.querySelector('[data-chat-speed-notice]');
    if (speedNotice) speedNotice.hidden = !['fast', 'ultrafast'].includes(menu.querySelector('#chat-menu-speed-mode')?.value);
    _scheduleChatGenerationSettingsReposition(menu, anchor);
  });
  menu.addEventListener('input', (e) => {
    if (e.target?.matches?.('input[type="number"]')) {
      _persistChatGenerationSettings(menu);
      _scheduleChatGenerationSettingsReposition(menu, anchor);
    }
  });
  _chatGenerationSettingsMenu = menu;
  document.body.appendChild(menu);
  if (typeof positionPopup === 'function' && anchor?.getBoundingClientRect) {
    _repositionChatGenerationSettingsMenu(menu, anchor);
  } else {
    menu.style.right = '16px';
    menu.style.bottom = '96px';
  }
  if (typeof replaceIcons === 'function') replaceIcons(menu);
  menu.querySelector('[data-chat-cli-session-reset]')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.GBChatCli?.resetSessionContinuityForCurrentChat?.();
    _scheduleChatGenerationSettingsReposition(menu, anchor);
  });
  menu.querySelector('[data-chat-generation-details]')?.addEventListener('toggle', () => {
    _scheduleChatGenerationSettingsReposition(menu, anchor);
  });
  const onOutside = (e) => {
    if (!menu.contains(e.target) && !anchor?.contains?.(e.target)) _closeChatGenerationSettingsMenu();
  };
  const onKey = (e) => { if (e.key === 'Escape') _closeChatGenerationSettingsMenu(); };
  let listenersAttached = false;
  const listenerTimer = setTimeout(() => {
    if (_chatGenerationSettingsMenu !== menu || !menu.isConnected) return;
    listenersAttached = true;
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
  }, 0);
  menu._cleanup = () => {
    clearTimeout(listenerTimer);
    if (listenersAttached) {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    }
  };
}

window.showChatGenerationSettingsMenu = showChatGenerationSettingsMenu;
window._closeChatGenerationSettingsMenu = _closeChatGenerationSettingsMenu;
window._chatRefreshReasoningControl = _chatRefreshReasoningControl;
window._chatReasoningLevelLabel = _chatReasoningLevelLabel;
if (typeof document !== 'undefined') {
  _chatBindReasoningControl();
  _chatRefreshReasoningControl();
}
