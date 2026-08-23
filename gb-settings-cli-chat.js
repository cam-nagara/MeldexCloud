/* gb-settings-cli-chat.js: CLI chat settings UI */
function _settingsCliEsc(value) {
  return MeldexEscape.html(value);
}

function _settingsCliIcon(name, size) {
  return typeof lucide === 'function' ? lucide(name, size || 14) : '';
}

const SETTINGS_CLI_CHAT_MODEL_FALLBACK = {
  codex: [
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
  ],
  claude_code: [
    { id: 'claude-fable-5', name: 'Fable 5' },
    { id: 'claude-opus-5', name: 'Opus 5' },
    { id: 'claude-opus-4-8', name: 'Opus 4.8' },
    { id: 'claude-sonnet-5', name: 'Sonnet 5' },
    { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
  ],
  antigravity_cli: [
    { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6' },
    { id: 'gpt-oss-120b', name: 'GPT-OSS 120B' },
  ],
};

function _settingsCliModelChoices(key) {
  const sentinel = typeof CLI_CHAT_DEFAULT_MODEL_SENTINEL !== 'undefined' ? CLI_CHAT_DEFAULT_MODEL_SENTINEL : '';
  const shared = (typeof CHAT_CLI_MODEL_CATALOG !== 'undefined' && CHAT_CLI_MODEL_CATALOG[key]) || null;
  const source = shared || SETTINGS_CLI_CHAT_MODEL_FALLBACK[key] || [];
  return source
    .filter(item => item && item.id && item.id !== sentinel)
    .map(item => ({ id: String(item.id), name: String(item.name || item.id) }));
}

function _settingsCliProviderRows(config) {
  const providers = config?.providers || {};
  const order = ['codex', 'claude_code', 'antigravity_cli'];
  const labels = { codex: 'Codex CLI', claude_code: 'Claude Code', antigravity_cli: 'Antigravity CLI' };
  const defaultModels = { codex: 'CLI既定（推奨）', claude_code: 'Claude Code', antigravity_cli: 'Antigravity CLI' };
  const modelTitles = {
    codex: 'CLIへ渡すモデルです。「CLI既定」ならCodex CLI自身の既定モデルを使います',
    claude_code: 'CLIへ渡すモデルです。「CLI既定」ならClaude Code自身の既定モデルを使います',
    antigravity_cli: 'CLIへ渡すモデルです。「CLI既定」ならAntigravity CLI自身の既定モデルを使います',
  };
  return order.map(key => {
    const item = providers[key] || {};
    const label = item.label || labels[key] || key;
    const command = item.command || (key === 'claude_code' ? 'claude' : key === 'antigravity_cli' ? 'agy' : 'codex');
    const placeholderModel = defaultModels[key] || label;
    const rawModel = String(item.model || '').trim();
    const modelValue = (!rawModel || rawModel === placeholderModel) ? '' : rawModel;
    const available = item.available !== false;
    const compatible = item.compatible !== false;
    const statusText = !available ? '未検出' : !compatible ? '更新必要' : item.version ? `v${item.version}` : '検出済み';
    const statusTitle = !available || !compatible ? '' : 'これは実行ファイルの検出状態です。ログイン状態とは別に、CLIチャット送信時またはエラー時に確認されます。';
    const statusColor = available && compatible ? 'var(--accent)' : 'var(--red)';
    const compatibilityMessage = String(item.compatibility_message || '').trim();
    const choices = _settingsCliModelChoices(key).slice();
    if (modelValue && !choices.some(choice => choice.id === modelValue)) choices.push({ id: modelValue, name: modelValue });
    const modelOptions = [`<option value=""${modelValue ? '' : ' selected'}>CLI既定（推奨）</option>`]
      .concat(choices.map(choice => `<option value="${_settingsCliEsc(choice.id)}"${choice.id === modelValue ? ' selected' : ''}>${_settingsCliEsc(choice.name)}</option>`))
      .join('');
    return `
      <div class="settings-cli-chat-row" data-provider="${_settingsCliEsc(key)}" style="display:grid;grid-template-columns:minmax(105px,.9fr) minmax(110px,1fr) minmax(110px,1fr) 72px;gap:8px;align-items:center;margin-top:8px;">
        <label class="gb-check" style="min-width:0;">
          <input type="checkbox" data-e2e-id="settings-cli-chat-${_settingsCliEsc(key)}-enabled" data-cli-chat-field="enabled" ${item.enabled === false ? '' : 'checked'}>
          <span>${_settingsCliEsc(label)}</span>
        </label>
        <input class="gb-input" data-e2e-id="settings-cli-chat-${_settingsCliEsc(key)}-command" data-cli-chat-field="command" value="${_settingsCliEsc(command)}" placeholder="${_settingsCliEsc(command)}">
        <select class="gb-select" style="min-width:0;" data-e2e-id="settings-cli-chat-${_settingsCliEsc(key)}-model" data-cli-chat-field="model" title="${_settingsCliEsc(modelTitles[key] || 'CLIへ渡すモデル')}">${modelOptions}</select>
        <span style="font-size:11px;color:${statusColor};white-space:nowrap;"${statusTitle ? ` title="${_settingsCliEsc(statusTitle)}"` : ''}>${_settingsCliEsc(statusText)}</span>
        ${compatibilityMessage ? `<div class="gb-section-desc" style="grid-column:1/-1;color:${compatible ? 'var(--fg2)' : 'var(--red)'};">${_settingsCliEsc(compatibilityMessage)}</div>` : ''}
      </div>`;
  }).join('');
}

function _renderCliChatSettingsContainer(container, config) {
  if (!container) return;
  container.innerHTML = `
    <div class="gb-check-help-row" style="margin-top:4px;">
      <label class="gb-check"><input id="settings-cli-chat-enabled" type="checkbox" ${config?.enabled === false ? '' : 'checked'}><span>CLIチャットを有効にする</span></label>
      ${fieldHelp('コマンド名は、ターミナルで実行する名前と同じにしてください。例: codex / claude / gemini')}
    </div>
    <div style="margin-top:4px;">${_settingsCliProviderRows(config)}</div>
    <div class="btn-row" style="justify-content:flex-start;gap:8px;margin-top:10px;flex-wrap:wrap;">
      <button type="button" class="gb-btn gb-btn-sm" id="settings-cli-chat-refresh">${_settingsCliIcon('refreshCw',14)} 状態を更新</button>
      <button type="button" class="gb-btn gb-btn-sm" id="settings-cli-chat-save">${_settingsCliIcon('save',14)} CLIチャット設定を保存</button>
    </div>
    <div id="settings-cli-chat-status" class="gb-section-desc" style="margin-top:6px;"></div>
    <div id="settings-workspace-cli-relay-container"></div>`;
  container.querySelector('#settings-cli-chat-refresh')?.addEventListener('click', () => renderCliChatSettingsForSettings(container.closest('.modal-overlay') || document));
  container.querySelector('#settings-cli-chat-save')?.addEventListener('click', () => saveCliChatSettingsFromSettingsDialog(container.closest('.modal-overlay') || document));
  if (typeof renderWorkspaceCliRelaySettingsForSettings === 'function') renderWorkspaceCliRelaySettingsForSettings(container.closest('.modal-overlay') || document);
  if (typeof replaceIcons === 'function') replaceIcons(container);
}

async function renderCliChatSettingsForSettings(root) {
  const scope = root?.querySelector ? root : document;
  const container = scope.querySelector('#settings-cli-chat-container') || document.getElementById('settings-cli-chat-container');
  if (!container) return;
  container.innerHTML = '<div class="gb-section-desc">CLIチャット設定を読み込み中...</div>';
  try {
    _renderCliChatSettingsContainer(container, await apiFetch('/cli-chat/config'));
  } catch (e) {
    container.innerHTML = `<div class="gb-section-desc" style="color:var(--red);">CLIチャット設定を読み込めませんでした: ${_settingsCliEsc(e?.message || e)}</div>`;
  }
}

async function saveCliChatSettingsFromSettingsDialog(root, options = {}) {
  const scope = root?.querySelector ? root : document;
  const container = scope.querySelector('#settings-cli-chat-container') || document.getElementById('settings-cli-chat-container');
  if (!container || !container.querySelector('[data-provider]')) return true;
  const providers = {};
  container.querySelectorAll('[data-provider]').forEach(row => {
    const key = row.dataset.provider || '';
    if (!key) return;
    providers[key] = {
      enabled: row.querySelector('[data-cli-chat-field="enabled"]')?.checked !== false,
      command: row.querySelector('[data-cli-chat-field="command"]')?.value?.trim() || '',
      model: row.querySelector('[data-cli-chat-field="model"]')?.value?.trim() || '',
    };
  });
  const body = { cli_chat_enabled: document.getElementById('settings-cli-chat-enabled')?.checked !== false, cli_chat_providers: providers };
  const status = container.querySelector('#settings-cli-chat-status');
  try {
    if (status) { status.textContent = '保存中...'; status.style.color = 'var(--fg2)'; }
    await apiPut('/cli-chat/config', body);
    if (typeof saveWorkspaceCliRelaySettingsFromSettingsDialog === 'function') {
      const relayOk = await saveWorkspaceCliRelaySettingsFromSettingsDialog(container.closest('.modal-overlay') || document, { silent: true, skipReload: true });
      if (relayOk === false) return false;
    }
    if (status) { status.textContent = '保存しました。未検出のままならMeldexを再起動してください。'; status.style.color = 'var(--fg2)'; }
    if (typeof window.GBChatCli?.loadChatConfig === 'function') {
      const reload = window.GBChatCli.loadChatConfig().catch(() => {});
      if (!options.backgroundChatRefresh) await reload;
    }
    if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});
    if (!options.skipReload) await renderCliChatSettingsForSettings(container.closest('.modal-overlay') || document);
    if (!options.silent && typeof showStatus === 'function') showStatus('CLIチャット設定を保存しました');
    return true;
  } catch (e) {
    if (status) { status.textContent = '保存に失敗しました: ' + (e?.message || e); status.style.color = 'var(--red)'; }
    if (!options.silent && typeof showStatus === 'function') showStatus('CLIチャット設定の保存に失敗しました', true);
    return false;
  }
}
