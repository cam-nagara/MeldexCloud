/* Chat-side LLM generation settings */

let _chatGenerationSettingsMenu = null;

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

function _chatGenerationSettingsRow(label, controlHtml) {
  return `<label style="display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;color:var(--fg);">
    <span>${esc(label)}</span>
    ${controlHtml}
  </label>`;
}

function _repositionChatGenerationSettingsMenu(menu, anchor) {
  if (!menu) return;
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

function _persistChatGenerationSettings(menu) {
  const web = menu.querySelector('#chat-menu-allow-web-search');
  if (web) localStorage.setItem('chat-allow-web-search', web.checked ? '1' : '0');
  const compress = menu.querySelector('#chat-menu-auto-compress');
  if (compress) localStorage.setItem('chat-auto-compress', compress.checked ? '1' : '0');
  const code = menu.querySelector('#chat-menu-allow-code-execution');
  if (code) localStorage.setItem('chat-allow-code-execution', code.checked ? '1' : '0');
  const reasoning = menu.querySelector('#chat-menu-reasoning-level');
  if (reasoning) localStorage.setItem('chat-reasoning-level', reasoning.value || 'off');
  const preset = menu.querySelector('#chat-menu-param-preset');
  if (preset) localStorage.setItem('chat-param-preset', preset.value || 'standard');
  [
    ['temperature', 'chat-temperature'],
    ['max-tokens', 'chat-max-tokens'],
    ['top-p', 'chat-top-p'],
  ].forEach(([id, key]) => {
    const input = menu.querySelector('#chat-menu-' + id);
    if (!input) return;
    const value = input.value.trim();
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
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
    <label class="gb-check" style="margin:0;"><input id="chat-menu-allow-web-search" type="checkbox" ${localStorage.getItem('chat-allow-web-search') !== '0' ? 'checked' : ''}><span>Web検索を許可</span></label>
    <label class="gb-check" style="margin:0;"><input id="chat-menu-auto-compress" type="checkbox" ${localStorage.getItem('chat-auto-compress') === '1' ? 'checked' : ''}><span>長い会話を自動要約</span></label>
    <label class="gb-check" style="margin:0;"><input id="chat-menu-allow-code-execution" type="checkbox" ${localStorage.getItem('chat-allow-code-execution') === '1' ? 'checked' : ''}><span>コード実行を許可</span></label>
    ${_chatGenerationSettingsRow('思考の深さ', `<select id="chat-menu-reasoning-level" class="gb-input" style="max-width:130px;">
      ${['off','standard','max'].map(v => `<option value="${v}" ${_chatGenerationSettingValue('chat-reasoning-level', 'off') === v ? 'selected' : ''}>${v === 'off' ? 'オフ' : v === 'standard' ? '標準' : '最大'}</option>`).join('')}
    </select>`)}
    ${_chatGenerationSettingsRow('応答プリセット', `<select id="chat-menu-param-preset" class="gb-input" style="max-width:130px;">
      ${[
        ['creative','創作'],
        ['standard','標準'],
        ['strict','厳密'],
      ].map(([v, label]) => `<option value="${v}" ${_chatGenerationSettingValue('chat-param-preset', 'standard') === v ? 'selected' : ''}>${label}</option>`).join('')}
    </select>`)}
    <details data-chat-generation-details style="font-size:12px;color:var(--fg2);">
      <summary style="cursor:pointer;">詳細パラメータ</summary>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
        ${_chatGenerationSettingsRow('temperature', `<input id="chat-menu-temperature" type="number" min="0" max="2" step="0.1" class="gb-input" style="max-width:100px;" value="${esc(localStorage.getItem('chat-temperature') || '')}" placeholder="自動">`)}
        ${_chatGenerationSettingsRow('max tokens', `<input id="chat-menu-max-tokens" type="number" min="1024" max="32768" step="512" class="gb-input" style="max-width:100px;" value="${esc(localStorage.getItem('chat-max-tokens') || '')}" placeholder="8192">`)}
        ${_chatGenerationSettingsRow('top_p', `<input id="chat-menu-top-p" type="number" min="0" max="1" step="0.05" class="gb-input" style="max-width:100px;" value="${esc(localStorage.getItem('chat-top-p') || '')}" placeholder="自動">`)}
      </div>
    </details>
  `;
  menu.addEventListener('change', () => {
    _persistChatGenerationSettings(menu);
    _scheduleChatGenerationSettingsReposition(menu, anchor);
  });
  menu.addEventListener('input', (e) => {
    if (e.target?.matches?.('input[type="number"]')) {
      _persistChatGenerationSettings(menu);
      _scheduleChatGenerationSettingsReposition(menu, anchor);
    }
  });
  document.body.appendChild(menu);
  if (typeof positionPopup === 'function' && anchor?.getBoundingClientRect) {
    _repositionChatGenerationSettingsMenu(menu, anchor);
  } else {
    menu.style.right = '16px';
    menu.style.bottom = '96px';
  }
  if (typeof replaceIcons === 'function') replaceIcons(menu);
  menu.querySelector('[data-chat-generation-details]')?.addEventListener('toggle', () => {
    _scheduleChatGenerationSettingsReposition(menu, anchor);
  });
  _chatGenerationSettingsMenu = menu;
  const onOutside = (e) => {
    if (!menu.contains(e.target) && !anchor?.contains?.(e.target)) _closeChatGenerationSettingsMenu();
  };
  const onKey = (e) => { if (e.key === 'Escape') _closeChatGenerationSettingsMenu(); };
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
  }, 0);
  menu._cleanup = () => {
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
}

window.showChatGenerationSettingsMenu = showChatGenerationSettingsMenu;
