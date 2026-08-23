/* gb-settings.part06.js: Discord knowledge bot settings */

let _discordBotSettingsCache = null;

function _discordBotEsc(value) {
  return MeldexEscape.html(value);
}

function _discordBotIcon(name, size) {
  return typeof lucide === 'function' ? lucide(name, size || 14) : '';
}

function _discordBotDefaultBot() {
  return {
    bot_id: '',
    bot_name: 'Meldex Knowledge Bot',
    application_id: '',
    icon_url: '',
    enabled: false,
    paused: true,
    default_source_folder: '',
    slash_command_prefix: 'meldex',
    search_only: true,
    llm_response_enabled: false,
    llm_provider: '',
    llm_model: '',
    monthly_budget_jpy: 0,
    requests_per_minute: 10,
    daily_message_limit: 200,
    system_prompt: '',
    has_token: false,
    has_llm_api_key: false,
  };
}

async function renderDiscordBotSettings(root) {
  const scope = root?.querySelector ? root : document;
  const container = scope.querySelector('#discord-bot-settings-container') || document.getElementById('discord-bot-settings-container');
  if (!container) return;
  container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${_discordBotIcon('bot',14)} Discord Bot</div><div class="gb-section-desc">読み込み中...</div></section>`;
  try {
    _discordBotSettingsCache = await apiFetch('/discord-bot/settings');
    _renderDiscordBotSettingsContainer(container, _discordBotSettingsCache);
  } catch (e) {
    container.innerHTML = `<section class="gb-section gb-section--boxed"><div class="gb-section-title">${_discordBotIcon('triangleAlert',14)} Discord Bot</div><div class="gb-section-desc">読み込みに失敗しました: ${_discordBotEsc(e.message)}</div></section>`;
  }
}

function _renderDiscordBotSettingsContainer(container, settings) {
  const bots = Array.isArray(settings?.bots) ? settings.bots : [];
  container.innerHTML = `
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${_discordBotIcon('bot',14)} Discord Bot 常駐</div>
      <label class="gb-check">
        <input id="discord-bot-master-enabled" type="checkbox" ${settings?.master_enabled ? 'checked' : ''}>
        <span>このPCでDiscord Botを起動する</span>
      </label>
      <div class="gb-section-desc">この端末内で暗号化して保存します。 ${fieldHelp('保存したBot TokenやAPIキーの中身は、あとから画面に表示されません。', { e2eId: 'discord-secret-storage-help' })}</div>
      <div class="gb-section-desc">暗号化方式: ${_discordBotEsc(settings?.encryption_backend || '')}</div>
      <div class="gb-field-row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;">
        <button type="button" class="gb-btn gb-btn-sm" id="discord-bot-add">${_discordBotIcon('plus',14)} Bot追加</button>
        <button type="button" class="gb-btn gb-btn-sm" id="discord-bot-template">${_discordBotIcon('fileJson',14)} テンプレート読込</button>
        <button type="button" class="gb-btn gb-btn-sm" id="discord-bot-refresh">${_discordBotIcon('refreshCw',14)} 状態更新</button>
      </div>
    </section>
    <div id="discord-bot-list" style="display:flex;flex-direction:column;gap:10px;">
      ${bots.map((bot, index) => _discordBotCardHtml(bot, index)).join('') || _discordBotCardHtml(_discordBotDefaultBot(), 0)}
    </div>
    <section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${_discordBotIcon('search',14)} 公開ナレッジ検索テスト</div>
      <div class="gb-field-row" style="align-items:flex-start;">
        <input id="discord-bot-test-query" class="gb-input" style="flex:1;" placeholder="検索語">
        <button type="button" class="gb-btn gb-btn-sm" id="discord-bot-test-run">検索</button>
      </div>
      <pre id="discord-bot-test-output" class="gb-code-block" style="white-space:pre-wrap;max-height:180px;overflow:auto;"></pre>
    </section>
    <div id="discord-bot-settings-status" class="gb-section-desc"></div>
  `;
  _bindDiscordBotSettings(container);
  if (typeof replaceIcons === 'function') replaceIcons(container);
}

function _discordBotCardHtml(bot, index) {
  const id = _discordBotEsc(bot.bot_id || '');
  const tokenPlaceholder = bot.has_token ? '保存済み（変更時のみ入力）' : 'Bot Token';
  const llmKeyPlaceholder = bot.has_llm_api_key ? '保存済み（変更時のみ入力）' : 'LLM APIキー（任意）';
  return `
    <section class="gb-section gb-section--boxed discord-bot-card" data-bot-id="${id}">
      <div class="gb-section-title" style="justify-content:space-between;gap:8px;">
        <span>${_discordBotIcon('bot',14)} Bot ${index + 1}</span>
        <span class="gb-section-desc" data-discord-runtime="${id}">${_discordBotEsc(bot.last_error || '')}</span>
      </div>
      <div class="gb-field-row">
        <label class="gb-field" style="flex:1;min-width:180px;">
          <span class="gb-label">名前</span>
          <input class="gb-input" data-e2e-id="discord-bot-${index}-bot-name" data-discord-field="bot_name" value="${_discordBotEsc(bot.bot_name || '')}" placeholder="Meldex Knowledge Bot">
        </label>
        <label class="gb-field" style="width:140px;">
          <span class="gb-label">Slash名</span>
          <input class="gb-input" data-e2e-id="discord-bot-${index}-slash-command" data-discord-field="slash_command_prefix" value="${_discordBotEsc(bot.slash_command_prefix || 'meldex')}" placeholder="meldex">
        </label>
      </div>
      <div class="gb-field-row">
        <label class="gb-field" style="flex:1;min-width:180px;">
          <span class="gb-label">Application ID</span>
          <input class="gb-input" data-e2e-id="discord-bot-${index}-application-id" data-discord-field="application_id" value="${_discordBotEsc(bot.application_id || '')}" placeholder="1234567890">
        </label>
        <label class="gb-field" style="flex:1;min-width:180px;">
          <span class="gb-label">Bot Token</span>
          <input class="gb-input" type="password" data-e2e-id="discord-bot-${index}-token" data-discord-field="token" placeholder="${_discordBotEsc(tokenPlaceholder)}" autocomplete="off">
        </label>
      </div>
      <label class="gb-field">
        <span class="gb-label">既定ソースフォルダ</span>
        <input class="gb-input" data-e2e-id="discord-bot-${index}-default-source-folder" data-discord-field="default_source_folder" value="${_discordBotEsc(bot.default_source_folder || '')}" placeholder="未指定時は現在のソースフォルダ" aria-label="既定ソースフォルダ">
      </label>
      <div class="gb-field-row" style="align-items:flex-start;">
        <label class="gb-check"><input type="checkbox" data-e2e-id="discord-bot-${index}-enabled" data-discord-field="enabled" ${bot.enabled ? 'checked' : ''}><span>有効</span></label>
        <label class="gb-check"><input type="checkbox" data-e2e-id="discord-bot-${index}-paused" data-discord-field="paused" ${bot.paused ? 'checked' : ''}><span>一時停止</span></label>
        <label class="gb-check"><input type="checkbox" data-e2e-id="discord-bot-${index}-search-only" data-discord-field="search_only" ${bot.search_only ? 'checked' : ''}><span>検索のみ</span></label>
        <label class="gb-check"><input type="checkbox" data-e2e-id="discord-bot-${index}-llm-response" data-discord-field="llm_response_enabled" ${bot.llm_response_enabled ? 'checked' : ''}><span>LLM応答</span></label>
      </div>
      <div class="gb-field-row">
        <label class="gb-field" style="width:150px;">
          <span class="gb-label">LLM</span>
          <select class="gb-select" data-e2e-id="discord-bot-${index}-llm-provider" data-discord-field="llm_provider">
            ${['','anthropic','openai','gemini'].map(v => `<option value="${v}" ${String(bot.llm_provider || '') === v ? 'selected' : ''}>${v || '未使用'}</option>`).join('')}
          </select>
        </label>
        <label class="gb-field" style="flex:1;">
          <span class="gb-label">モデル</span>
          <input class="gb-input" data-e2e-id="discord-bot-${index}-llm-model" data-discord-field="llm_model" value="${_discordBotEsc(bot.llm_model || '')}" placeholder="claude-3-5-haiku-latest">
        </label>
        <label class="gb-field" style="flex:1;">
          <span class="gb-label">LLM APIキー</span>
          <input class="gb-input" type="password" data-e2e-id="discord-bot-${index}-llm-api-key" data-discord-field="llm_api_key" placeholder="${_discordBotEsc(llmKeyPlaceholder)}" autocomplete="off">
        </label>
      </div>
      <div class="gb-field-row">
        <label class="gb-field" style="width:130px;">
          <span class="gb-label">円/月</span>
          <input class="gb-input" type="number" min="0" step="100" data-e2e-id="discord-bot-${index}-monthly-budget" data-discord-field="monthly_budget_jpy" value="${_discordBotEsc(bot.monthly_budget_jpy || 0)}">
        </label>
        <label class="gb-field" style="width:130px;">
          <span class="gb-label">回/分</span>
          <input class="gb-input" type="number" min="1" max="120" data-e2e-id="discord-bot-${index}-requests-per-minute" data-discord-field="requests_per_minute" value="${_discordBotEsc(bot.requests_per_minute || 10)}">
        </label>
        <label class="gb-field" style="width:130px;">
          <span class="gb-label">回/日</span>
          <input class="gb-input" type="number" min="1" data-e2e-id="discord-bot-${index}-daily-message-limit" data-discord-field="daily_message_limit" value="${_discordBotEsc(bot.daily_message_limit || 200)}">
        </label>
      </div>
      <label class="gb-field">
        <span class="gb-label">公開応答用システムプロンプト</span>
        <textarea class="gb-input" rows="3" data-e2e-id="discord-bot-${index}-system-prompt" data-discord-field="system_prompt" placeholder="未入力なら既定ルールのみ">${_discordBotEsc(bot.system_prompt || '')}</textarea>
      </label>
      <div class="gb-field-row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap;">
        <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="discord-bot-${index}-invite" data-discord-action="invite">${_discordBotIcon('externalLink',14)} 招待URL</button>
        <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="discord-bot-${index}-start" data-discord-action="start">${_discordBotIcon('play',14)} 起動</button>
        <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="discord-bot-${index}-stop" data-discord-action="stop">${_discordBotIcon('square',14)} 停止</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-e2e-id="discord-bot-${index}-delete" data-discord-action="delete">${_discordBotIcon('trash2',14)} 削除</button>
      </div>
    </section>
  `;
}

function _bindDiscordBotSettings(container) {
  container.querySelector('#discord-bot-add')?.addEventListener('click', () => {
    const list = container.querySelector('#discord-bot-list');
    list?.insertAdjacentHTML('beforeend', _discordBotCardHtml(_discordBotDefaultBot(), container.querySelectorAll('.discord-bot-card').length));
    const card = list?.lastElementChild;
    if (card) _bindDiscordBotCard(card);
    if (typeof replaceIcons === 'function') replaceIcons(container);
  });
  container.querySelector('#discord-bot-template')?.addEventListener('click', applyDiscordBotTemplate);
  container.querySelector('#discord-bot-refresh')?.addEventListener('click', refreshDiscordBotRuntimeStatus);
  container.querySelector('#discord-bot-test-run')?.addEventListener('click', runDiscordBotTestSearch);
  container.querySelectorAll('.discord-bot-card').forEach(card => _bindDiscordBotCard(card));
}

function _bindDiscordBotCard(card) {
  card.querySelectorAll('[data-discord-action]').forEach(btn => {
    if (btn.dataset.discordBound === '1') return;
    btn.dataset.discordBound = '1';
    btn.addEventListener('click', () => _handleDiscordBotAction(btn));
  });
}

function _discordBotNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function _discordBotPayloadFromCard(card) {
  const value = name => card.querySelector(`[data-discord-field="${name}"]`)?.value?.trim?.() || '';
  const checked = name => !!card.querySelector(`[data-discord-field="${name}"]`)?.checked;
  return {
    bot_id: card.dataset.botId || '',
    bot_name: value('bot_name'),
    application_id: value('application_id'),
    token: value('token'),
    default_source_folder: value('default_source_folder'),
    slash_command_prefix: value('slash_command_prefix') || 'meldex',
    enabled: checked('enabled'),
    paused: checked('paused'),
    search_only: checked('search_only'),
    llm_response_enabled: checked('llm_response_enabled'),
    llm_provider: value('llm_provider'),
    llm_model: value('llm_model'),
    llm_api_key: value('llm_api_key'),
    monthly_budget_jpy: _discordBotNumber(value('monthly_budget_jpy'), 0),
    requests_per_minute: _discordBotNumber(value('requests_per_minute'), 10),
    daily_message_limit: _discordBotNumber(value('daily_message_limit'), 200),
    system_prompt: value('system_prompt'),
  };
}

function _discordBotSettingsPayload() {
  const bots = Array.from(document.querySelectorAll('#discord-bot-list .discord-bot-card'))
    .map(_discordBotPayloadFromCard)
    .filter(_discordBotPayloadIsMeaningful);
  return {
    master_enabled: !!document.getElementById('discord-bot-master-enabled')?.checked,
    bots,
  };
}

function _discordBotSettingsRendered(container) {
  return !!container?.querySelector?.('#discord-bot-master-enabled');
}

function _discordBotPayloadIsMeaningful(bot) {
  const base = _discordBotDefaultBot();
  if (bot.bot_id || bot.token || bot.llm_api_key) return true;
  if (bot.application_id || bot.default_source_folder || bot.icon_url || bot.system_prompt) return true;
  if (bot.bot_name && bot.bot_name !== base.bot_name) return true;
  if ((bot.slash_command_prefix || 'meldex') !== base.slash_command_prefix) return true;
  if (bot.enabled || !bot.paused || !bot.search_only || bot.llm_response_enabled) return true;
  if (bot.llm_provider || bot.llm_model) return true;
  if (Number(bot.monthly_budget_jpy || 0) !== 0) return true;
  if (Number(bot.requests_per_minute || 10) !== 10) return true;
  if (Number(bot.daily_message_limit || 200) !== 200) return true;
  return false;
}

async function saveDiscordBotSettingsFromSettingsDialog(options = {}) {
  const container = document.getElementById('discord-bot-settings-container');
  if (!container) return true;
  if (!_discordBotSettingsRendered(container)) return true;
  try {
    const payload = _discordBotSettingsPayload();
    const result = await apiPost('/discord-bot/settings', payload);
    _discordBotSettingsCache = result;
    if (!options.skipRender) _renderDiscordBotSettingsContainer(container, result);
    if (!options.silent) showStatus('Discord Bot設定を保存しました');
    return true;
  } catch (e) {
    if (!options.silent) showStatus('Discord Bot設定の保存に失敗: ' + e.message, true);
    return false;
  }
}

async function applyDiscordBotTemplate() {
  const template = await apiFetch('/discord-bot/template');
  _discordBotSettingsCache = { master_enabled: false, encryption_backend: _discordBotSettingsCache?.encryption_backend || '', bots: template.bots || [] };
  const container = document.getElementById('discord-bot-settings-container');
  if (container) _renderDiscordBotSettingsContainer(container, _discordBotSettingsCache);
}

async function refreshDiscordBotRuntimeStatus() {
  const container = document.getElementById('discord-bot-settings-container');
  const statusEl = document.getElementById('discord-bot-settings-status');
  try {
    const status = await apiFetch('/discord-bot/status');
    (status.bots || []).forEach(bot => {
      const el = container?.querySelector?.(`[data-discord-runtime="${_discordBotEsc(bot.bot_id)}"]`);
      if (!el) return;
      const runtime = bot.runtime || {};
      el.textContent = runtime.running ? 'running' : (runtime.status || 'stopped');
      if (runtime.error) el.textContent += ' / ' + runtime.error;
    });
    if (statusEl) statusEl.textContent = status.dependency?.available ? 'discord.py 利用可' : (status.dependency?.error || 'discord.py 未検出');
  } catch (e) {
    if (statusEl) statusEl.textContent = '状態取得に失敗: ' + e.message;
  }
}

async function _handleDiscordBotAction(btn) {
  const card = btn.closest('.discord-bot-card');
  if (!card) return;
  const action = btn.dataset.discordAction;
  const statusEl = document.getElementById('discord-bot-settings-status');
  let payload = _discordBotPayloadFromCard(card);
  try {
    if (action === 'delete') {
      const message = payload.bot_id
        ? 'このDiscord Bot設定を削除しますか？保存済みのBot Tokenも削除されます。'
        : 'このDiscord Bot設定を削除しますか？';
      const ok = typeof cfConfirm === 'function' ? await cfConfirm(message) : confirm(message);
      if (!ok) return;
      if (payload.bot_id) await apiFetch('/discord-bot/bots/' + encodeURIComponent(payload.bot_id), { method: 'DELETE' });
      card.remove();
      if (statusEl) statusEl.textContent = 'Discord Bot設定を削除しました';
      return;
    }
    if (action === 'start') {
      const savedSettings = await saveDiscordBotSettingsFromSettingsDialog({ silent: true, skipRender: true });
      if (!savedSettings) {
        if (statusEl) statusEl.textContent = 'Discord Bot設定を保存できませんでした';
        return;
      }
      payload = _discordBotPayloadFromCard(card);
    }
    if (action === 'start' || action === 'invite' || !payload.bot_id || payload.token || payload.llm_api_key) {
      const saved = await apiPost('/discord-bot/bots', payload);
      card.dataset.botId = saved.bot?.bot_id || '';
      payload.bot_id = card.dataset.botId;
      card.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
    }
    if (action === 'invite') {
      const data = await apiPost('/discord-bot/invite-url', { bot_id: payload.bot_id, application_id: payload.application_id });
      if (data.url) window.open(data.url, '_blank', 'noopener');
      return;
    }
    if (action === 'start' || action === 'stop') {
      const data = await apiPost('/discord-bot/bots/' + encodeURIComponent(payload.bot_id) + '/' + action, {});
      if (statusEl) statusEl.textContent = data.error || data.status || '';
      await refreshDiscordBotRuntimeStatus();
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = e.message;
  }
}

async function runDiscordBotTestSearch() {
  const output = document.getElementById('discord-bot-test-output');
  const query = document.getElementById('discord-bot-test-query')?.value || '';
  const firstCard = document.querySelector('#discord-bot-list .discord-bot-card');
  const botId = firstCard?.dataset?.botId || '';
  const sourceFolder = firstCard?.querySelector?.('[data-discord-field="default_source_folder"]')?.value || '';
  if (output) output.textContent = '検索中...';
  try {
    const result = await apiPost('/discord-bot/test-search', { bot_id: botId, source_folder: sourceFolder, query });
    if (output) output.textContent = result.message || JSON.stringify(result.items || [], null, 2);
  } catch (e) {
    if (output) output.textContent = e.message;
  }
}
