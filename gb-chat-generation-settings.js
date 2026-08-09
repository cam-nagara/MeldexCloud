/* Chat-side LLM generation settings */

let _chatGenerationSettingsMenu = null;

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
// antigravity_cli は low/medium/high の3段階のみ受け付けるため、それ以上はhighへ丸める
// （meldex_cli_chat_model_args.py の _cli_chat_reasoning_effort_for_antigravity 参照）。
const CHAT_REASONING_SUPPORTED_PROVIDERS = new Set(['anthropic', 'openai', 'gemini', 'claude_code', 'codex', 'antigravity_cli']);

function _chatGenerationReasoningSupported(provider) {
  return CHAT_REASONING_SUPPORTED_PROVIDERS.has(String(provider || '').trim().toLowerCase());
}

// 思考の深さの選択肢。オフ/低/中/高/最高/最大の6段階 + claude_code限定のUltracode。
// 内部値はgb-right-panel-chat.part01.part01.jsのCHAT_REASONING_LEVELSと対応させること。
function _chatReasoningLevelOptions(provider) {
  const base = [
    ['off', 'オフ'],
    ['low', '低'],
    ['medium', '中'],
    ['high', '高'],
    ['xhigh', '最高'],
    ['max', '最大'],
  ];
  if (String(provider || '').trim().toLowerCase() === 'claude_code') base.push(['ultracode', 'Ultracode']);
  return base;
}

function _chatGenerationReasoningRowHtml() {
  const provider = _chatGenerationCurrentProvider();
  const supported = _chatGenerationReasoningSupported(provider);
  const options = _chatReasoningLevelOptions(provider);
  const storedRaw = _chatGenerationSettingValue('chat-reasoning-level', 'off');
  const stored = typeof _chatNormalizeReasoningLevel === 'function' ? _chatNormalizeReasoningLevel(storedRaw) : storedRaw;
  const select = `<select id="chat-menu-reasoning-level" class="gb-input" style="max-width:130px;" ${supported ? '' : 'disabled'}>
      ${options.map(([value, label]) => `<option value="${value}" ${stored === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}
    </select>`;
  const row = _chatGenerationSettingsRow('思考の深さ', select);
  if (supported) return row;
  return `${row}<div data-chat-reasoning-unsupported-note style="font-size:11px;color:var(--fg2);margin-top:-4px;">このプロバイダでは思考の深さ設定は使われません</div>`;
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
  const checked = localStorage.getItem('chat-cli-session-continuity') === '1' ? 'checked' : '';
  const resetIcon = typeof lucide === 'function' ? lucide('rotateCcw', 13) : '';
  return `
    <div data-chat-cli-session-controls style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <label class="gb-check" style="margin:0;min-width:0;"><input id="chat-menu-cli-session-continuity" type="checkbox" ${checked}><span>CLIの会話を継続</span></label>
      <button type="button" data-chat-cli-session-reset title="このチャットのCLI会話継続をリセット" style="display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border:1px solid var(--border);border-radius:4px;background:var(--bg3);color:var(--fg);font-size:12px;cursor:pointer;white-space:nowrap;">${resetIcon}<span>リセット</span></button>
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

function _persistChatGenerationSettings(menu, options = {}) {
  const web = menu.querySelector('#chat-menu-allow-web-search');
  if (web) localStorage.setItem('chat-allow-web-search', web.checked ? '1' : '0');
  const compress = menu.querySelector('#chat-menu-auto-compress');
  if (compress) localStorage.setItem('chat-auto-compress', compress.checked ? '1' : '0');
  const cliSession = menu.querySelector('#chat-menu-cli-session-continuity');
  if (cliSession) localStorage.setItem('chat-cli-session-continuity', cliSession.checked ? '1' : '0');
  const code = menu.querySelector('#chat-menu-allow-code-execution');
  if (code) localStorage.setItem('chat-allow-code-execution', code.checked ? '1' : '0');
  const showRecommendations = menu.querySelector('#chat-menu-show-recommendations');
  if (showRecommendations) {
    const nextValue = showRecommendations.checked ? '1' : '0';
    if (localStorage.getItem('chat-recommendations-enabled') !== nextValue) {
      localStorage.setItem('chat-recommendations-enabled', nextValue);
      try { window.GBChatRecommendations?.refresh?.({ force: true }); } catch {}
    }
  }
  const reasoning = menu.querySelector('#chat-menu-reasoning-level');
  if (reasoning) localStorage.setItem('chat-reasoning-level', reasoning.value || 'off');
  const preset = menu.querySelector('#chat-menu-param-preset');
  if (preset) localStorage.setItem('chat-param-preset', preset.value || 'standard');
  Object.entries(CHAT_GENERATION_NUMERIC_SETTINGS).forEach(([id, config]) => {
    const input = menu.querySelector('#chat-menu-' + id);
    if (!input) return;
    const value = input.value.trim();
    const normalized = _normalizeChatGenerationNumberValue(value, config);
    if (normalized) {
      localStorage.setItem(config.key, normalized);
      if (options.normalizeNumbers && input.value !== normalized) input.value = normalized;
    } else {
      localStorage.removeItem(config.key);
      if (options.normalizeNumbers && input.value) input.value = '';
    }
  });
  if (typeof _chatSaveCurrentRoomModelSettings === 'function') _chatSaveCurrentRoomModelSettings();
}

function showChatGenerationSettingsMenu(event) {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  const anchor = event?.target?.closest?.('button') || event?.currentTarget || null;
  if (_chatGenerationSettingsMenu) { _closeChatGenerationSettingsMenu(); return; }
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu chat-generation-settings-menu';
  menu.style.cssText = 'position:fixed;z-index:10090;min-width:280px;max-width:340px;padding:10px;display:flex;flex-direction:column;gap:10px;';
  menu.innerHTML = `
    <div style="font-weight:600;font-size:13px;color:var(--fg);line-height:1.4;">LLM設定</div>
    ${_chatGenerationApiOnlyControlsHtml()}
    ${_chatGenerationCliSessionControlsHtml()}
    ${_chatGenerationCodeExecutionControlHtml()}
    <label class="gb-check" style="margin:0;"><input id="chat-menu-show-recommendations" type="checkbox" ${localStorage.getItem('chat-recommendations-enabled') !== '0' ? 'checked' : ''}><span>「次にできること」の提案を表示</span></label>
    <div data-chat-generation-tuning-hint style="font-size:11px;color:var(--fg2);line-height:1.4;">${fieldHelp('応答の賢さは思考の深さとモデルで、速度は軽いモデルの選択で調整できます')}</div>
    ${_chatGenerationReasoningRowHtml()}
    ${_chatGenerationResponseTuningHtml()}
  `;
  menu.addEventListener('change', () => {
    _persistChatGenerationSettings(menu, { normalizeNumbers: true });
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
