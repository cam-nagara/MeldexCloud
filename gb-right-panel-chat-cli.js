/* gb-right-panel-chat-cli.js: external CLI transcript mode */
(function () {
  let cliSessions = [];
  let cliSelectedSession = null;
  let cliConfig = null;
  const CLI_TRANSCRIPT_PROVIDERS = [
    { key: 'claude_code', label: 'Claude Code', watchPath: '~/.claude/projects', enabled: true },
    { key: 'codex', label: 'Codex', watchPath: '~/.codex/sessions', enabled: false },
    { key: 'gemini_cli', label: 'Gemini CLI', watchPath: '~/.gemini', enabled: false },
  ];
  const CLI_CHAT_PROVIDERS = [
    { key: 'codex', label: 'Codex CLI', model: 'Codex CLI', command: 'codex' },
    { key: 'claude_code', label: 'Claude Code', model: 'Claude Code', command: 'claude' },
    { key: 'gemini_cli', label: 'Gemini CLI', model: 'Gemini CLI', command: 'gemini' },
  ];
  const CLI_CHAT_OUTPUT_IDLE_TIMEOUT_MS = 0;
  const CLI_CHAT_AUTO_CONTINUE_MAX = 6;
  const CLI_CHAT_CONTINUE_MARKER = '[MELDEX_CONTINUE_NEEDED]';
  const CLI_CHAT_SESSION_CONTINUITY_KEY = 'chat-cli-session-continuity';
  const CLI_CHAT_SESSION_STATE_PREFIX = 'chat-cli-session-state:v1:';
  const CLI_CHAT_PROVIDER_KEYS = new Set(CLI_CHAT_PROVIDERS.map(provider => provider.key));
  const CLI_CHAT_SESSION_CONTINUITY_SUPPORTED_KEYS = new Set(['codex', 'claude_code']);
  let cliChatConfig = null;
  let originalChatSend = null;
  let activeCliChatStream = null;

  function icon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function text(value) {
    return String(value ?? '');
  }

  function cliAuthRequestHeaders(json = false) {
    const headers = json ? { 'Content-Type': 'application/json' } : {};
    if (typeof _authToken !== 'undefined' && _authToken) headers.Authorization = 'Bearer ' + _authToken;
    return headers;
  }

  async function cliAuthResponse(response) {
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw new Error(payload?.detail || payload?.message || `HTTP ${response.status}`);
    return payload || {};
  }

  function attachCliAuthRecovery(host, provider) {
    const key = text(provider).trim();
    if (!host || !['claude_code', 'codex'].includes(key)) return null;
    const existing = host.querySelector('[data-cli-auth-recovery]');
    if (existing) return existing;
    const card = document.createElement('section');
    card.className = 'chat-cli-auth-recovery';
    card.dataset.cliAuthRecovery = key;
    card.dataset.e2eId = 'chat-cli-auth-recovery-' + key;
    const title = document.createElement('strong');
    title.textContent = 'CLIのログインを更新';
    const description = document.createElement('p');
    description.textContent = 'MeldexのAPIキーへ切り替えず、CLI自身のログイン状態を確認します。';
    const status = document.createElement('div');
    status.className = 'chat-cli-auth-status';
    status.setAttribute('role', 'status');
    status.textContent = '認証状態を確認してください。';
    const actions = document.createElement('div');
    actions.className = 'chat-cli-auth-actions';
    const checkButton = document.createElement('button');
    checkButton.type = 'button';
    checkButton.className = 'gb-btn gb-btn-sm';
    checkButton.dataset.e2eId = 'chat-cli-auth-check-' + key;
    checkButton.textContent = '認証状態を確認';
    const loginButton = document.createElement('button');
    loginButton.type = 'button';
    loginButton.className = 'gb-btn gb-btn-sm';
    loginButton.dataset.e2eId = 'chat-cli-auth-login-' + key;
    loginButton.textContent = 'ログイン画面を開く';
    const details = document.createElement('details');
    details.className = 'chat-cli-auth-details';
    details.hidden = true;
    const detailsSummary = document.createElement('summary');
    detailsSummary.textContent = '確認結果の詳細';
    const detailsText = document.createElement('pre');
    details.append(detailsSummary, detailsText);
    const setBusy = value => {
      checkButton.disabled = value;
      loginButton.disabled = value;
    };
    const checkStatus = async () => {
      setBusy(true);
      status.textContent = 'CLIの認証状態を確認中…';
      try {
        const response = await fetch(
          API_BASE + '/cli-chat/auth-status?provider=' + encodeURIComponent(key),
          { headers: cliAuthRequestHeaders(false) },
        );
        const data = await cliAuthResponse(response);
        status.textContent = data.authenticated
          ? `${data.label || 'CLI'}はログイン済みです。質問を再送信できます。`
          : (data.message || 'CLI側のログイン更新が必要です。');
        status.classList.toggle('is-ok', data.authenticated === true);
        status.classList.toggle('is-error', data.authenticated !== true);
        const executableSummary = [data.executable_path || data.executable, data.version]
          .filter(Boolean)
          .join(' — ');
        detailsText.textContent = [executableSummary, data.detail].filter(Boolean).join('\n\n');
        details.hidden = !detailsText.textContent;
        checkButton.textContent = '認証状態を再確認';
      } catch (error) {
        status.textContent = '認証状態を確認できませんでした: ' + (error?.message || error);
        status.classList.remove('is-ok');
        status.classList.add('is-error');
      } finally {
        setBusy(false);
      }
    };
    checkButton.addEventListener('click', checkStatus);
    loginButton.addEventListener('click', async () => {
      setBusy(true);
      status.textContent = 'ログイン用ターミナルを開いています…';
      try {
        const response = await fetch(API_BASE + '/cli-chat/auth-login', {
          method: 'POST',
          headers: cliAuthRequestHeaders(true),
          body: JSON.stringify({ provider: key }),
        });
        const data = await cliAuthResponse(response);
        status.textContent = data.message || 'ログイン完了後に認証状態を再確認してください。';
        status.classList.remove('is-ok', 'is-error');
        detailsText.textContent = [data.command, data.executable].filter(Boolean).join('\n\n');
        details.hidden = !detailsText.textContent;
        checkButton.textContent = '認証状態を再確認';
      } catch (error) {
        status.textContent = 'ログイン画面を開けませんでした: ' + (error?.message || error);
        status.classList.remove('is-ok');
        status.classList.add('is-error');
      } finally {
        setBusy(false);
      }
    });
    actions.append(checkButton, loginButton);
    card.append(title, description, status, actions, details);
    host.appendChild(card);
    return card;
  }

  function shortPath(value) {
    const raw = text(value).replace(/\\/g, '/');
    if (!raw) return '';
    const parts = raw.split('/').filter(Boolean);
    return parts.slice(-3).join('/') || raw;
  }

  function providerMeta(provider) {
    return CLI_TRANSCRIPT_PROVIDERS.find(item => item.key === provider) || { key: provider || '', label: provider || 'CLI', watchPath: '' };
  }

  function providerLabel(provider) {
    return providerMeta(provider).label;
  }

  function cliChatMeta(provider) {
    return CLI_CHAT_PROVIDERS.find(item => item.key === provider) || null;
  }

  function isCliChatProvider(provider) {
    return CLI_CHAT_PROVIDER_KEYS.has(String(provider || '').trim());
  }

  function cliChatSessionContinuitySupported(provider) {
    const key = String(provider || '').trim();
    if (cliChatConfig?.providers?.[key]) return !!cliChatConfig.providers[key].session_continuity_supported;
    return CLI_CHAT_SESSION_CONTINUITY_SUPPORTED_KEYS.has(key);
  }

  function cliChatSessionContinuitySettingEnabled() {
    try {
      return localStorage.getItem(CLI_CHAT_SESSION_CONTINUITY_KEY) === '1';
    } catch {
      return false;
    }
  }

  function cliChatSessionContinuityEnabled(provider) {
    return isCliChatProvider(provider)
      && cliChatSessionContinuitySupported(provider)
      && cliChatSessionContinuitySettingEnabled();
  }

  // CLIチャットのモデル選択。設定ダイアログ側の値（cliChatConfig）と、チャットパネルの
  // モデル選択ドロップダウン（#chat-model、CHAT_CLI_MODEL_CATALOG由来）の2系統がある。
  // ドロップダウンでの選択がある場合はそちらを優先し、無ければ設定ダイアログの値、
  // それも無ければ「CLI既定」を使う。

  function cliChatConfiguredModelOverride(provider) {
    const raw = String(cliChatConfig?.providers?.[provider]?.model || '').trim();
    if (!raw) return '';
    const placeholder = String(cliChatMeta(provider)?.model || '').trim();
    if (placeholder && raw === placeholder) return '';
    return raw;
  }

  function cliChatModelCatalogFor(provider) {
    const catalog = (typeof CHAT_CLI_MODEL_CATALOG !== 'undefined' && CHAT_CLI_MODEL_CATALOG[provider]) || [];
    const models = catalog.map(item => ({ id: item.id, name: item.name }));
    const configured = cliChatConfiguredModelOverride(provider);
    if (configured && !models.some(item => item.id === configured)) {
      models.push({ id: configured, name: configured });
    }
    return { models, configured };
  }

  function cliChatDefaultModelSentinel() {
    return typeof CLI_CHAT_DEFAULT_MODEL_SENTINEL !== 'undefined' ? CLI_CHAT_DEFAULT_MODEL_SENTINEL : '';
  }

  function cliChatSelectedModelValue(provider) {
    const key = String(provider || '').trim();
    const normalizeLegacyCodexModel = value => {
      const normalized = String(value || '').trim();
      if (key === 'codex' && ['Codex CLI', 'gpt-5-codex', 'gpt-5.3-codex', 'gpt-5.5', 'gpt-5.6'].includes(normalized)) {
        try { localStorage.removeItem('chat-model:' + key); } catch {}
        return cliChatDefaultModelSentinel();
      }
      return normalized;
    };
    const modelSelect = document.getElementById('chat-model');
    if (modelSelect && typeof _chatState !== 'undefined' && _chatState.provider === key && modelSelect.value) {
      return normalizeLegacyCodexModel(modelSelect.value);
    }
    let stored = '';
    try { stored = localStorage.getItem('chat-model:' + key) || ''; } catch { stored = ''; }
    if (stored) return normalizeLegacyCodexModel(stored);
    if (typeof _chatState !== 'undefined' && _chatState.provider === key && _chatState.model) return normalizeLegacyCodexModel(_chatState.model);
    const configured = cliChatConfiguredModelOverride(key);
    if (configured) return configured;
    return cliChatDefaultModelSentinel();
  }

  function cliChatModelLabel(provider, value) {
    const key = String(provider || '').trim();
    const modelValue = value != null ? value : cliChatSelectedModelValue(key);
    const sentinel = cliChatDefaultModelSentinel();
    if (!modelValue || modelValue === sentinel) {
      return (cliChatMeta(key)?.label || key || 'CLI') + '（CLI既定）';
    }
    const catalog = (typeof CHAT_CLI_MODEL_CATALOG !== 'undefined' && CHAT_CLI_MODEL_CATALOG[key]) || [];
    const entry = catalog.find(item => item.id === modelValue);
    return entry ? entry.name : modelValue;
  }

  function cliChatEffectiveModelForRequest(provider) {
    const value = cliChatSelectedModelValue(provider);
    const sentinel = cliChatDefaultModelSentinel();
    return (!value || value === sentinel) ? '' : value;
  }

  function cliChatSessionStorageKey(provider, sessionId) {
    return CLI_CHAT_SESSION_STATE_PREFIX
      + encodeURIComponent(String(provider || 'cli'))
      + ':'
      + encodeURIComponent(String(sessionId || 'current'));
  }

  function cliChatSessionScope(provider, sessionId, sourceFolder, workspaceId, targetPath, workFolder) {
    return {
      provider: String(provider || ''),
      session_id: String(sessionId || ''),
      source_folder: String(sourceFolder || ''),
      workspace_id: String(workspaceId || ''),
      target_path: String(targetPath || ''),
      work_folder: String(workFolder || ''),
    };
  }

  function cliChatSessionScopeKey(scope) {
    return [
      scope?.provider,
      scope?.session_id,
      scope?.workspace_id,
      scope?.source_folder,
      scope?.work_folder,
      scope?.target_path,
    ].map(value => String(value || '')).join('\n');
  }

  function cliChatSessionScopesMatch(left, right) {
    return cliChatSessionScopeKey(left) === cliChatSessionScopeKey(right);
  }

  function randomCliSessionUuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, marker => {
      const value = Math.floor(Math.random() * 16);
      const next = marker === 'x' ? value : ((value & 0x3) | 0x8);
      return next.toString(16);
    });
  }

  function readCliChatSessionState(scope) {
    const key = cliChatSessionStorageKey(scope.provider, scope.session_id);
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      if (!parsed || !cliChatSessionScopesMatch(parsed, scope) || !parsed.cli_session_id) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed;
    } catch {
      try { localStorage.removeItem(key); } catch {}
      return null;
    }
  }

  function writeCliChatSessionState(scope, state) {
    const key = cliChatSessionStorageKey(scope.provider, scope.session_id);
    try {
      localStorage.setItem(key, JSON.stringify({ ...scope, ...state, last_at: new Date().toISOString() }));
    } catch {}
  }

  function cliChatSessionContinuityForRequest(scope) {
    if (!cliChatSessionContinuityEnabled(scope.provider)) return { enabled: false };
    let state = readCliChatSessionState(scope);
    if (!state && scope.provider === 'claude_code') {
      state = {
        cli_session_id: randomCliSessionUuid(),
        created_at: new Date().toISOString(),
      };
    }
    if (state) writeCliChatSessionState(scope, state);
    return {
      enabled: true,
      sessionId: state?.cli_session_id || '',
      scopeKey: cliChatSessionScopeKey(scope),
    };
  }

  function rememberCliChatSessionContinuity(scope, cliSessionId) {
    const sessionId = String(cliSessionId || '').trim();
    if (!sessionId || !cliChatSessionContinuityEnabled(scope.provider)) return;
    const state = readCliChatSessionState(scope) || { created_at: new Date().toISOString() };
    writeCliChatSessionState(scope, { ...state, cli_session_id: sessionId });
  }

  function resetSessionContinuityForCurrentChat(options = {}) {
    const provider = String(options.provider || _chatState.provider || '').trim();
    const sessionId = String(options.sessionId || _chatState.sessionId || '');
    try {
      localStorage.removeItem(cliChatSessionStorageKey(provider, sessionId));
    } catch {}
    if (!options.silent && typeof showStatus === 'function') showStatus('CLIの会話継続をリセットしました');
  }

  function ensureCliChatProviderOptions() {
    try {
      // CHAT_DEFAULT_MODELS[provider.key] は gb-right-panel-chat.part01.part01.js の
      // CHAT_CLI_MODEL_CATALOG から既に複数候補で定義済みのため、ここで1件だけの配列に
      // 上書きしない（旧実装はここで [provider.model] へ上書きしてしまい、モデル選択肢が
      // 常に1件しか出ない不具合の原因の一つだった）。
      if (typeof CHAT_PROVIDER_META !== 'undefined') {
        CLI_CHAT_PROVIDERS.forEach(provider => {
          CHAT_PROVIDER_META[provider.key] = { ...(CHAT_PROVIDER_META[provider.key] || {}), label: provider.label };
        });
      }
    } catch {}
    const select = document.getElementById('chat-provider');
    if (!select) return;
    CLI_CHAT_PROVIDERS.forEach(provider => {
      if (select.querySelector(`option[value="${provider.key}"]`)) return;
      const option = document.createElement('option');
      option.value = provider.key;
      option.textContent = provider.label;
      select.appendChild(option);
    });
  }

  function cliChatProviderEnabled(provider) {
    const item = cliChatConfig?.providers?.[provider];
    if (!item) return true;
    return item.enabled !== false;
  }

  function cliChatProviderReadyStatus(provider) {
    const key = String(provider || '').trim();
    const meta = cliChatMeta(key) || { label: key || 'CLI' };
    const item = cliChatConfig?.providers?.[key];
    if (!cliChatConfig) {
      return { ok: false, message: 'CLIチャット設定を読み込めませんでした。Meldexを再起動してからもう一度試してください。' };
    }
    if (cliChatConfig.enabled === false) {
      return { ok: false, message: 'CLIチャット機能が無効です。設定 > LLM > CLIチャットで有効にしてください。' };
    }
    if (!item) {
      return { ok: false, message: `${meta.label} のCLIチャット設定が見つかりません。設定 > LLM > CLIチャットで確認してください。` };
    }
    if (item.enabled === false) {
      return { ok: false, message: `${item.label || meta.label} はCLIチャット設定で無効です。` };
    }
    if (item.available === false) {
      const command = item.command || meta.command || key;
      return { ok: false, message: `${item.label || meta.label} のコマンドが見つかりません。${command} をインストールし、Meldexを起動した環境のPATHから実行できるようにしてください。` };
    }
    if (item.compatible === false) {
      const minimum = item.minimum_version ? `（必要: ${item.minimum_version}以上）` : '';
      return {
        ok: false,
        errorCode: 'cli_update_required',
        message: item.compatibility_message || `${item.label || meta.label}の更新が必要です${minimum}。`,
        action: key === 'codex'
          ? 'ターミナルで `npm install -g @openai/codex@latest` を実行し、Meldexを再起動してください。'
          : '',
      };
    }
    return { ok: true, message: '' };
  }

  async function saveCliChatProviderNotice(provider, status) {
    const message = [status?.message, status?.action].filter(Boolean).join('\n\n').trim();
    if (!message || typeof _chatState === 'undefined' || !Array.isArray(_chatState.messages)) {
      if (typeof chatAddSystem === 'function') chatAddSystem(message);
      return false;
    }
    const previous = _chatState.messages[_chatState.messages.length - 1];
    if (previous?.error_code === status?.errorCode && String(previous?.content || '') === message) {
      if (typeof chatAddMessage === 'function') {
        chatAddMessage('assistant', message, {
          provider,
          model: cliChatModelLabel(provider),
          error: true,
          error_code: status?.errorCode || 'cli_config_incompatible',
        });
      }
      return false;
    }
    const notice = {
      role: 'assistant',
      content: message,
      provider,
      model: cliChatModelLabel(provider),
      timestamp: typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString(),
      error: true,
      error_code: status?.errorCode || 'cli_config_incompatible',
    };
    _chatState.messages.push(notice);
    if (typeof chatAddMessage === 'function') {
      chatAddMessage('assistant', message, {
        ...notice,
        messageIndex: _chatState.messages.length - 1,
      });
    }
    if (typeof chatAutoSave === 'function') await chatAutoSave({ silent: true });
    return true;
  }

  function contentToText(content) {
    if (typeof _chatContentToText === 'function') return _chatContentToText(content);
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return text(content);
    return content.map(part => {
      if (!part || typeof part !== 'object') return text(part);
      if (part.type === 'text' || part.type === 'thinking') return text(part.text);
      if (part.type === 'tool_use') return `[tool_use] ${text(part.name)} ${JSON.stringify(part.input || {})}`;
      if (part.type === 'tool_result') return `[tool_result] ${text(part.content)}`;
      return text(part.text || part.content || JSON.stringify(part));
    }).filter(Boolean).join('\n');
  }

  function messagePreview(message) {
    return contentToText(message?.content || '').replace(/\r\n/g, '\n').trim();
  }

  function setPanelStatus(message, isError = false) {
    const el = document.getElementById('chat-cli-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--fg2)';
  }

  function button(label, iconName, handler, title = '', actionId = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-btn gb-btn-sm chat-cli-action-btn';
    btn.title = title || label;
    if (actionId) {
      btn.dataset.testid = 'chat-cli-' + actionId;
      btn.dataset.e2eId = 'chat-cli-' + actionId;
    }
    btn.innerHTML = icon(iconName, 13) + `<span>${esc(label)}</span>`;
    btn.addEventListener('click', handler);
    return btn;
  }

  function ensureCliPanel() {
    const panel = document.getElementById('chat-cli-panel');
    const historyPanel = document.getElementById('chat-history-panel');
    if (panel && historyPanel && panel.parentElement !== historyPanel) historyPanel.appendChild(panel);
    if (!panel || panel.dataset.cliReady === '1') return panel;
    panel.dataset.cliReady = '1';
    panel.classList.add('chat-cli-panel');
    panel.style.display = 'none';
    panel.style.flexDirection = 'column';
    panel.style.flex = '1';
    panel.style.overflow = 'hidden';
    panel.innerHTML = `
      <div class="chat-cli-toolbar">
        <label class="chat-cli-main-toggle gb-check">
          <input id="chat-cli-enabled" class="gb-checkbox" data-e2e-id="chat-cli-enabled" type="checkbox">
          <span class="chat-cli-ellipsis">外部CLI取り込み</span>
        </label>
        <div id="chat-cli-actions" class="chat-cli-actions"></div>
      </div>
      <div id="chat-cli-provider-settings" class="chat-cli-provider-settings"></div>
      <div id="chat-cli-status" class="chat-cli-status"></div>
      <div class="chat-cli-content">
        <div id="chat-cli-session-list" class="chat-cli-session-list"></div>
        <div id="chat-cli-session-view" class="chat-cli-session-view"></div>
      </div>
    `;
    const actions = panel.querySelector('#chat-cli-actions');
    actions.append(
      button('保存', 'save', () => saveCliConfig(), '', 'save-config'),
      button('スキャン', 'refreshCw', () => scanCliTranscripts(), '', 'scan')
    );
    const enabled = panel.querySelector('#chat-cli-enabled');
    if (enabled) enabled.addEventListener('change', () => saveCliConfig());
    renderProviderSettings();
    return panel;
  }

  function liveElement(id) {
    if (typeof _chatLiveElement === 'function') {
      const live = _chatLiveElement(id, { allowHidden: true });
      if (live) return live;
    }
    return document.getElementById(id);
  }

  function applyCliImportVisibility(view) {
    const current = view === 'cli' ? 'cli' : 'saved';
    const historyList = liveElement('chat-history-list', { allowHidden: true });
    const cliPanel = liveElement('chat-cli-panel');
    if (!cliPanel) return;
    if (historyList) historyList.style.display = current === 'cli' ? 'none' : 'block';
    cliPanel.style.display = current === 'cli' ? 'flex' : 'none';
    document.querySelectorAll('[data-chat-history-view]').forEach(btn => {
      const active = btn.dataset.chatHistoryView === current;
      btn.classList.toggle('gb-btn-primary', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function switchChatHistoryView(view) {
    const current = view === 'cli' ? 'cli' : 'saved';
    try { localStorage.setItem('chat-history-view', current); } catch {}
    ensureCliPanel();
    applyCliImportVisibility(current);
    if (current === 'cli') renderCliTranscripts();
    else if (typeof renderChatHistory === 'function') renderChatHistory();
  }

  function applyConfigToPanel(config) {
    cliConfig = config || {};
    const enabled = document.getElementById('chat-cli-enabled');
    if (enabled) enabled.checked = !!cliConfig.cli_transcript_import_enabled;
    renderProviderSettings();
  }

  function renderProviderSettings() {
    const container = document.getElementById('chat-cli-provider-settings');
    if (!container) return;
    const sources = cliConfig?.cli_transcript_sources || {};
    container.innerHTML = '';
    CLI_TRANSCRIPT_PROVIDERS.forEach(provider => {
      const source = sources[provider.key] || {};
      const row = document.createElement('div');
      row.dataset.provider = provider.key;
      row.className = 'chat-cli-provider-row';
      row.innerHTML = `
        <label class="chat-cli-provider-toggle gb-check">
          <input class="gb-checkbox" data-role="enabled" data-e2e-id="chat-cli-${provider.key}-enabled" aria-label="${esc(provider.label)}の取り込みを有効にする" type="checkbox">
          <span class="chat-cli-ellipsis">${esc(provider.label)}</span>
        </label>
        <input class="gb-input gb-input-sm chat-cli-watch-path" data-role="watch-path" data-e2e-id="chat-cli-${provider.key}-watch-path" aria-label="${esc(provider.label)}のログフォルダ" type="text">
      `;
      const enabled = row.querySelector('[data-role="enabled"]');
      const watchPath = row.querySelector('[data-role="watch-path"]');
      enabled.checked = source.enabled !== undefined ? source.enabled !== false : provider.enabled !== false;
      watchPath.value = source.watch_path || provider.watchPath;
      enabled.addEventListener('change', () => saveCliConfig());
      watchPath.addEventListener('blur', () => saveCliConfig());
      container.appendChild(row);
    });
  }

  function readProviderSourcesFromPanel() {
    const sources = {};
    CLI_TRANSCRIPT_PROVIDERS.forEach(provider => {
      const row = document.querySelector(`#chat-cli-provider-settings [data-provider="${provider.key}"]`);
      const enabled = row?.querySelector('[data-role="enabled"]');
      const watchPath = row?.querySelector('[data-role="watch-path"]');
      sources[provider.key] = {
        enabled: enabled ? !!enabled.checked : true,
        watch_path: watchPath?.value?.trim() || provider.watchPath,
      };
    });
    return sources;
  }

  async function loadCliConfig() {
    const config = await apiFetch('/cli-transcripts/config');
    applyConfigToPanel(config);
    return config;
  }

  async function loadCliChatConfig() {
    try {
      cliChatConfig = await apiFetch('/cli-chat/config', { silentError: true });
    } catch {
      cliChatConfig = null;
    }
    return cliChatConfig;
  }

  async function saveCliConfig(options = {}) {
    const enabled = document.getElementById('chat-cli-enabled');
    const payload = {
      cli_transcript_import_enabled: !!enabled?.checked,
      cli_transcript_sources: readProviderSourcesFromPanel(),
      cli_transcript_extract_to_knowledge: cliConfig?.cli_transcript_extract_to_knowledge !== false,
    };
    const saved = await apiPost('/cli-transcripts/config', payload);
    applyConfigToPanel(saved);
    if (!options.silent) setPanelStatus('設定を保存しました');
    return saved;
  }

  async function scanCliTranscripts() {
    const enabled = document.getElementById('chat-cli-enabled');
    if (!enabled?.checked) {
      setPanelStatus('外部CLI取り込みが無効です', true);
      return;
    }
    try {
      await saveCliConfig({ silent: true });
      setPanelStatus('外部CLIログをスキャン中...');
      const result = await apiPost('/cli-transcripts/scan', {});
      if (result.skipped) {
        setPanelStatus('スキャンをスキップ: ' + (result.reason || 'disabled'), true);
      } else {
        setPanelStatus(`取り込み ${Number(result.imported_count || 0)} 件 / エラー ${Number(result.error_count || 0)} 件`);
      }
      await loadCliSessions();
    } catch (error) {
      setPanelStatus('外部CLIログのスキャンに失敗: ' + (error?.message || error), true);
    }
  }

  async function loadCliSessions() {
    const data = await apiFetch('/cli-transcripts/sessions?limit=100');
    cliSessions = Array.isArray(data.sessions) ? data.sessions : [];
    if (cliSelectedSession && !cliSessions.some(session => session.provider === cliSelectedSession.session?.provider && session.session_id === cliSelectedSession.session?.session_id)) {
      cliSelectedSession = null;
    }
    renderCliSessionList();
    if (!cliSelectedSession && cliSessions.length) {
      await openCliSession(cliSessions[0].provider, cliSessions[0].session_id);
    } else if (!cliSessions.length) {
      renderCliSessionView(null);
    }
  }

  function renderCliSessionList() {
    const list = document.getElementById('chat-cli-session-list');
    if (!list) return;
    list.innerHTML = '';
    if (!cliSessions.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-cli-empty';
      empty.textContent = '取り込まれたCLIセッションはありません';
      list.appendChild(empty);
      return;
    }
    cliSessions.forEach(session => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'chat-cli-session-row';
      row.dataset.testid = 'chat-cli-session-' + String(session.session_id || '').replace(/[^A-Za-z0-9_-]/g, '_');
      row.dataset.e2eId = row.dataset.testid;
      const active = cliSelectedSession && cliSelectedSession.session?.provider === session.provider && cliSelectedSession.session?.session_id === session.session_id;
      row.classList.toggle('is-active', !!active);
      row.innerHTML = `
        <div class="chat-cli-session-title">${icon('terminal', 13)}<span>${esc(providerLabel(session.provider))}</span></div>
        <div class="chat-cli-session-path">${esc(shortPath(session.project_path || session.path))}</div>
        <div class="chat-cli-session-meta">${Number(session.message_count || 0)}件 / ${esc(session.last_updated_at || '')}</div>
      `;
      row.addEventListener('click', () => openCliSession(session.provider, session.session_id));
      list.appendChild(row);
    });
  }

  async function openCliSession(provider, sessionId) {
    const payload = await apiFetch('/cli-transcripts/session/' + encodeURIComponent(provider) + '/' + encodeURIComponent(sessionId));
    cliSelectedSession = payload;
    renderCliSessionList();
    renderCliSessionView(payload);
  }

  function renderCliSessionView(payload) {
    const view = document.getElementById('chat-cli-session-view');
    if (!view) return;
    view.innerHTML = '';
    if (!payload) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:var(--fg2);font-size:12px;';
      empty.textContent = 'セッションを選択してください';
      view.appendChild(empty);
      return;
    }
    const session = payload.session || {};
    const label = providerLabel(session.provider);
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border);padding-bottom:8px;';
    head.innerHTML = `
      <div style="min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:bold;">${icon('terminal', 14)}<span>${esc(label)} Transcript</span></div>
        <div style="font-size:11px;color:var(--fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(shortPath(session.project_path || session.path))}</div>
        <div style="font-size:10px;color:var(--fg2);">読み取り専用 / ${Number(session.message_count || 0)}件</div>
      </div>
    `;
    head.appendChild(button('ナレッジ抽出', 'sparkles', () => extractSelectedCliKnowledge(), 'このCLI履歴からナレッジを抽出', 'extract-knowledge'));
    view.appendChild(head);
    (payload.messages || []).forEach(message => view.appendChild(renderCliMessage(message, session)));
  }

  function renderCliMessage(message, session) {
    const row = document.createElement('div');
    const role = text(message.role || 'assistant');
    const isUser = role === 'user';
    row.className = 'chat-copy-message chat-cli-transcript-message';
    row.dataset.chatCopyAuthor = isUser
      ? 'ユーザー'
      : (role === 'tool' ? 'ツール' : label);
    row.dataset.chatCopyTime = typeof _chatFormatMessageTimestamp === 'function'
      ? _chatFormatMessageTimestamp(message.timestamp || '')
      : text(message.timestamp || '');
    row.style.cssText = `align-self:${isUser ? 'flex-end' : 'flex-start'};max-width:88%;display:flex;flex-direction:column;gap:3px;`;
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg2);padding:0 4px;';
    header.innerHTML = `${icon(isUser ? 'user' : (role === 'tool' ? 'wrench' : 'bot'), 12)}<span>${esc(role)}</span><span>${esc(message.timestamp || '')}</span>`;
    const quote = document.createElement('button');
    quote.type = 'button';
    quote.className = 'gb-btn gb-btn-icon gb-btn-xs gb-btn-ghost chat-cli-quote-btn';
    quote.title = 'Meldexのチャットで引用';
    quote.dataset.testid = 'chat-cli-quote-' + String(message.msg_id || '').replace(/[^A-Za-z0-9_-]/g, '_');
    quote.dataset.e2eId = quote.dataset.testid;
    quote.dataset.cliMsgId = String(message.msg_id || '');
    quote.innerHTML = icon('quote', 12);
    quote.addEventListener('click', () => quoteCliMessage(message, session));
    header.appendChild(quote);
    const bubble = document.createElement('div');
    bubble.className = 'chat-copy-body chat-message-bubble chat-message-bubble-cli';
    bubble.style.cssText = `padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:${isUser ? 'var(--accent)' : 'var(--bg3)'};color:${isUser ? 'var(--ui-fg-strong)' : 'var(--fg)'};white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;`;
    bubble.textContent = messagePreview(message);
    row.append(header, bubble);
    return row;
  }

  function quoteCliMessage(message, session) {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const body = messagePreview(message);
    const source = `${providerLabel(session?.provider)} / ${shortPath(session?.project_path || session?.path || '')}`;
    const quoted = `\n> ${source}\n` + body.split(/\r?\n/).map(line => '> ' + line).join('\n') + '\n';
    const prefix = input.value && !input.value.endsWith('\n') ? '\n' : '';
    input.value += prefix + quoted;
    if (typeof switchChatMode === 'function') switchChatMode('llm');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
  }

  async function extractSelectedCliKnowledge() {
    const session = cliSelectedSession?.session;
    if (!session) return;
    try {
      setPanelStatus('ナレッジを抽出中...');
      const result = await apiPost(
        '/cli-transcripts/session/' + encodeURIComponent(session.provider) + '/' + encodeURIComponent(session.session_id) + '/extract-knowledge',
        {}
      );
      setPanelStatus(`ナレッジ抽出: ${Number(result.item_count || 0)}件`);
    } catch (error) {
      setPanelStatus('ナレッジ抽出に失敗: ' + (error?.message || error), true);
    }
  }

  function normalizeCliChatUserContent(textValue, attachments) {
    if (typeof _chatNormalizeUserContent === 'function') return _chatNormalizeUserContent(textValue, attachments);
    const textPart = String(textValue || '');
    if (!Array.isArray(attachments) || !attachments.length) return textPart;
    return [
      { type: 'text', text: textPart },
      ...attachments.map(att => ({
        type: String(att.mime || '').toLowerCase() === 'application/pdf' ? 'document' : 'image',
        name: att.name,
        path: att.path,
        mimeType: att.mime,
      })),
    ];
  }

  function cliChatSetSendButtonStreaming(streaming) {
    const sendBtn = document.getElementById('chat-send-btn');
    if (!sendBtn) return null;
    sendBtn.textContent = streaming ? '停止' : '送信';
    sendBtn.title = streaming ? 'CLIの実行を停止' : '送信 (Enter)';
    sendBtn.disabled = false;
    return sendBtn;
  }

  function createCliChatActivity(provider) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-cli-activity';
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:2px;max-width:85%;min-width:0;align-self:flex-start;box-sizing:border-box;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg2);padding:0 4px;';
    const label = cliChatModelLabel(provider);
    header.innerHTML = (typeof getProviderIconHtml === 'function' ? getProviderIconHtml(provider, 16) : icon('terminal', 16)) + '<span>' + esc(label) + '</span>';
    const body = document.createElement('div');
    body.style.cssText = 'background:var(--bg3);padding:8px 16px;border-radius:12px 12px 12px 2px;font-size:13px;color:var(--fg2);display:flex;align-items:center;gap:8px;max-width:100%;min-width:0;box-sizing:border-box;';
    body.innerHTML = '<span class="chat-spinner"></span><span data-cli-chat-status style="min-width:0;overflow-wrap:anywhere;word-break:break-word;">CLIを起動中...</span>';
    const log = document.createElement('div');
    log.style.cssText = 'display:none;flex-direction:column;gap:4px;width:100%;max-height:28vh;overflow:auto;color:var(--fg2);font-size:11px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px;white-space:pre-wrap;word-break:break-word;box-sizing:border-box;';
    wrapper.append(header, body, log);
    return { wrapper, status: body.querySelector('[data-cli-chat-status]'), log };
  }

  function formatCliChatDuration(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    if (minutes <= 0) return seconds + '秒';
    return minutes + '分' + String(seconds).padStart(2, '0') + '秒';
  }

  function appendCliChatLog(log, textValue) {
    if (!log || !String(textValue || '').trim()) return;
    log.style.display = 'flex';
    const line = document.createElement('div');
    line.textContent = String(textValue || '').trimEnd();
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function summarizeCliChatErrorDetail(textValue) {
    let detail = String(textValue || '').replace(/\r\n/g, '\n').trim();
    if (!detail) return '';
    const promptMarkers = [
      'MeldexチャットからCLIへ中継された依頼です。',
      '\n--- user',
      '\nuser:',
    ];
    for (const marker of promptMarkers) {
      const index = detail.indexOf(marker);
      if (index >= 0) detail = detail.slice(0, index).trim();
    }
    detail = detail
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer=[削除]')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[削除]')
      .replace(/\b(?:ghp_|AIza|AKIA|ya29\.)[A-Za-z0-9._/-]{8,}\b/g, '[削除]')
      .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*[^\s,;]+/g, '$1=[削除]');
    const lines = detail.split('\n').map(line => line.trimEnd()).filter(line => {
      if (!line) return false;
      const lower = line.toLowerCase();
      return !(lower.includes('pid') && (lower.includes('成功:') || lower.includes('success:'))
        && (lower.includes('終了') || lower.includes('terminated')));
    });
    detail = lines.slice(-12).join('\n').trim();
    if (detail.length > 1200) detail = detail.slice(0, 1200).trimEnd() + '\n...（CLIログを省略しました）';
    return detail;
  }

  function cliChatContinuationCount(options = {}) {
    const count = Number(options.cliContinuationCount || 0);
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  }

  function cliChatErrorAllowsContinuation(error) {
    if (['cli_auth_required', 'cli_update_required', 'model_not_supported', 'cli_config_incompatible', 'cli_empty_response'].includes(error?.errorCode)) {
      return false;
    }
    const message = String(error?.message || error || '');
    return /タイムアウト|返答がなかった|応答がなかった|timed?\s*out|timeout/i.test(message);
  }

  function cliChatTextRequestsContinuation(textValue) {
    return String(textValue || '').includes(CLI_CHAT_CONTINUE_MARKER);
  }

  function buildCliContinuationInstruction(reason, count) {
    const attempt = Math.max(1, Number(count || 0));
    const why = String(reason || '前回のCLI実行が完了前に終了しました').trim();
    return [
      '前回のCLI実行の続きです。',
      '同じ依頼を完了するため、現在のデータを読み直して、未処理の作業だけを小さな範囲で続行してください。',
      '既に完了済みの変更は繰り返さず、途中で止まっても再実行できるように進めてください。',
      '今回だけで完了しない場合は、完了した範囲、残りの範囲、次に実行すべき内容を短く書き、末尾に ' + CLI_CHAT_CONTINUE_MARKER + ' を付けてください。',
      'すべて完了した場合は、完了した内容と確認結果だけを返し、この継続マーカーは付けないでください。',
      '',
      '継続理由: ' + why,
      '継続回数: ' + attempt + ' / ' + CLI_CHAT_AUTO_CONTINUE_MAX,
    ].join('\n');
  }

  function restoreActiveCliChatActivity() {
    try { activeCliChatStream?.restore?.(); } catch {}
  }
  window.GBChatCliRestoreActivity = restoreActiveCliChatActivity;

  async function sendCliChat(options = {}) {
    if (_chatState.streaming) {
      if (typeof _chatQueueUserInputForNextTurn === 'function') return _chatQueueUserInputForNextTurn(options);
      if (options?.fromButton || options?.stopRequested) {
        if (typeof chatStopStreaming === 'function') chatStopStreaming();
      }
      return false;
    }
    if (!cliChatConfig) await loadCliChatConfig();
    const provider = String(options.provider || _chatState.provider || '').trim();
    const providerStatus = cliChatProviderReadyStatus(provider);
    if (!providerStatus.ok) {
      if (providerStatus.errorCode) {
        resetSessionContinuityForCurrentChat({
          provider,
          sessionId: String(options.sessionId || _chatState.sessionId || ''),
          silent: true,
        });
      }
      await saveCliChatProviderNotice(provider, {
        ...providerStatus,
        message: providerStatus.message || ((cliChatMeta(provider)?.label || provider) + ' のCLIチャット設定を確認してください。'),
      });
      return false;
    }
    if (typeof _captureChatSessionTitleFromInput === 'function') _captureChatSessionTitleFromInput();
    const input = document.getElementById('chat-input');
    const msgContainer = typeof _chatLiveMessagesContainer === 'function' ? _chatLiveMessagesContainer() : document.getElementById('chat-messages');
    if (!input || !msgContainer) return false;
    const deferredMessages = Array.isArray(options.deferredMessages)
      ? (typeof _chatCloneMessages === 'function' ? _chatCloneMessages(options.deferredMessages) : JSON.parse(JSON.stringify(options.deferredMessages))).filter(message => message?.role === 'user')
      : [];
    const usingDeferredMessages = deferredMessages.length > 0;
    let attachments = usingDeferredMessages ? [] : (_chatState.pendingAttachments || []);
    const textValue = usingDeferredMessages && typeof _chatQueuedMessagesText === 'function'
      ? _chatQueuedMessagesText(deferredMessages).trim()
      : input.value.trim();
    if (!usingDeferredMessages && !textValue && attachments.length === 0) {
      if (typeof _chatQueuedMessages === 'function' && _chatQueuedMessages().length && typeof _chatSendQueuedMessagesAfterStream === 'function') {
        return _chatSendQueuedMessagesAfterStream();
      }
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
    if (!usingDeferredMessages && attachments.length > 0) {
      if (typeof _chatWaitForPendingAttachmentUploads === 'function') {
        const readyAttachments = await _chatWaitForPendingAttachmentUploads(attachments);
        if (!readyAttachments) {
          if (typeof showStatus === 'function') showStatus('添付ファイルのアップロード完了後に送信してください', true);
          return false;
        }
        attachments = readyAttachments;
      } else if (attachments.some(att => att?.uploading || att?.uploadError || !String(att?.path || '').trim())) {
        if (typeof showStatus === 'function') showStatus('添付ファイルのアップロード完了後に送信してください', true);
        return false;
      }
    }

    if (!usingDeferredMessages) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
      if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
    }

    const scopedMessages = Array.isArray(options.streamMessages) ? options.streamMessages : null;
    const targetMessages = scopedMessages || _chatState.messages;
    const detachedScope = !!scopedMessages && scopedMessages !== _chatState.messages;

    if (usingDeferredMessages) {
      deferredMessages.forEach(message => {
        message.role = 'user';
        message.timestamp = message.timestamp || (typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString());
        if (typeof _ensureChatMessageId === 'function') _ensureChatMessageId(message);
      });
      targetMessages.push(...deferredMessages);
      if (!detachedScope && typeof _chatRenderStoredMessages === 'function') _chatRenderStoredMessages();
    } else {
      if (typeof _chatPromoteQueuedMessagesToHistory === 'function') _chatPromoteQueuedMessagesToHistory();
      const userTimestamp = typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString();
      const userContent = normalizeCliChatUserContent(textValue, attachments);
      if (attachments.length > 0) {
        if (typeof _chatClearPendingAttachments === 'function') _chatClearPendingAttachments();
        else _chatState.pendingAttachments = [];
      }
      const userMessage = { role: 'user', content: userContent, timestamp: userTimestamp };
      if (typeof _ensureChatMessageId === 'function') _ensureChatMessageId(userMessage);
      if (typeof chatAddMessage === 'function') {
        chatAddMessage('user', userContent, { messageIndex: _chatState.messages.length, msg_id: userMessage.msg_id, timestamp: userTimestamp });
      }
      targetMessages.push(userMessage);
    }
    if (!detachedScope && typeof _ensureSessionId === 'function') _ensureSessionId();

    const streamMessages = targetMessages;
    const streamSessionId = Object.prototype.hasOwnProperty.call(options || {}, 'sessionId') ? String(options.sessionId || '') : (_chatState.sessionId || '');
    const streamSessionTitle = Object.prototype.hasOwnProperty.call(options || {}, 'sessionTitle') ? String(options.sessionTitle || '') : (_chatState.sessionTitle || '');
    const streamTargetPath = typeof _chatEffectiveTargetPath === 'function' ? _chatEffectiveTargetPath(options) : (Object.prototype.hasOwnProperty.call(options || {}, 'targetPath') ? String(options.targetPath || '') : (_chatState.targetPath || ''));
    const streamSourceFolder = requestSourceFolder;
    const streamWorkspaceId = requestWorkspaceId;
    const streamMode = Object.prototype.hasOwnProperty.call(options || {}, 'mode')
      ? String(options.mode || '')
      : (typeof _chatMode === 'undefined' ? '' : String(_chatMode || ''));
    const streamWorkFolder = typeof _chatEffectiveWorkFolder === 'function' ? _chatEffectiveWorkFolder(streamTargetPath, options) : '';
    // streamModelValue: サーバーへ送る実際の値（CLI既定選択時は空文字列に変換済み）。
    // streamModelLabel: 表示・保存履歴用の人間向けラベル（内部値やセンチネルは出さない）。
    const streamModelValue = cliChatEffectiveModelForRequest(provider);
    const streamModelLabel = cliChatModelLabel(provider);
    const cliSessionScope = cliChatSessionScope(provider, streamSessionId, streamSourceFolder, streamWorkspaceId, streamTargetPath, streamWorkFolder);
    const cliSessionContinuity = cliChatSessionContinuityForRequest(cliSessionScope);
    const streamController = new AbortController();
    const streamVisibleInCurrentChat = () => _chatState.messages === streamMessages
      && (_chatState.sessionId || '') === streamSessionId;
    const streamLiveContainer = () => streamVisibleInCurrentChat()
      ? (typeof _chatLiveMessagesContainer === 'function' ? _chatLiveMessagesContainer() : document.getElementById('chat-messages'))
      : null;
    let _autoScroll = true;
    const scrollStreamContainer = () => {
      const liveContainer = streamLiveContainer();
      if (liveContainer && _autoScroll) {
        if (typeof _chatScrollToBottom === 'function') _chatScrollToBottom(liveContainer);
        else liveContainer.scrollTop = liveContainer.scrollHeight;
      }
    };
    const addAssistantToVisibleStream = (content, renderOptions) => (
      streamVisibleInCurrentChat() && typeof chatAddMessage === 'function'
        ? chatAddMessage('assistant', content, renderOptions)
        : null
    );

    _chatState.streaming = true;
    _chatState.abortController = streamController;
    _chatState.streamingProvider = provider;
    _chatState.streamingTargetPath = streamTargetPath;
    _chatState.lastImplicitTargetPath = streamTargetPath;
    cliChatSetSendButtonStreaming(true);
    if (typeof _syncChatSourceFolderUi === 'function') _syncChatSourceFolderUi();
    const activity = createCliChatActivity(provider);
    const _scrollHandler = () => {
      _autoScroll = typeof _chatIsScrolledNearBottom === 'function'
        ? _chatIsScrolledNearBottom(msgContainer)
        : (msgContainer.scrollHeight - msgContainer.scrollTop - msgContainer.clientHeight < 48);
    };
    if (!detachedScope) msgContainer.addEventListener('scroll', _scrollHandler);
    if (!detachedScope) {
      msgContainer.appendChild(activity.wrapper);
      if (typeof _chatScrollToBottom === 'function') _chatScrollToBottom(msgContainer);
      else msgContainer.scrollTop = msgContainer.scrollHeight;
    }

    const assistantMessageId = typeof _newChatMessageId === 'function' ? _newChatMessageId() : 'msg_' + Math.random().toString(16).slice(2, 10);
    let assistantTimestamp = '';
    let assistantDiv = null;
    let fullText = '';
    let stderrText = '';
    let cliThinkingText = '';
    let lastStatusText = 'CLIを起動中...';
    let lastCliOutputAt = 0;
    let lastCliTextAt = 0;
    const streamStartedAt = Date.now();
    let sendOk = false;
    let sawCliEvent = false;
    let cliCompleted = false;
    let clientIdleAbortMessage = '';
    let autoContinueRequest = null;
    const continuationCount = cliChatContinuationCount(options);
    const prepareAutoContinue = (reason) => {
      if (options.disableAutoContinue || continuationCount >= CLI_CHAT_AUTO_CONTINUE_MAX) return false;
      autoContinueRequest = {
        count: continuationCount + 1,
        reason: String(reason || '').trim(),
      };
      return true;
    };
    const renderOptions = () => {
      if (!assistantTimestamp) assistantTimestamp = typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString();
      return {
        messageIndex: streamMessages.length,
        msg_id: assistantMessageId,
        provider,
        model: streamModelLabel,
        timestamp: assistantTimestamp,
      };
    };
    const findAssistantBubble = () => {
      const liveContainer = streamLiveContainer();
      if (!liveContainer) return null;
      const row = Array.from(liveContainer.querySelectorAll('.chat-message-row'))
        .find(el => String(el.dataset.msgId || '') === assistantMessageId);
      return row?.querySelector?.('.chat-message-bubble') || null;
    };
    const ensureAssistantVisible = (content = fullText) => {
      if (!String(content || '').trim()) return null;
      if (!assistantDiv || !assistantDiv.isConnected) assistantDiv = findAssistantBubble();
      if (!assistantDiv || !assistantDiv.isConnected) assistantDiv = addAssistantToVisibleStream('', renderOptions());
      if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, String(content || ''), []);
      else if (assistantDiv) assistantDiv.textContent = String(content || '');
      return assistantDiv;
    };
    const refreshActivityStatus = (label = lastStatusText) => {
      lastStatusText = String(label || 'CLIを実行中...');
      if (!activity.status) return;
      const elapsed = formatCliChatDuration(Date.now() - streamStartedAt);
      const idle = lastCliOutputAt
        ? '最終出力 ' + formatCliChatDuration(Date.now() - lastCliOutputAt) + '前'
        : 'まだ出力なし';
      activity.status.textContent = `${lastStatusText}（経過 ${elapsed} / ${idle}）`;
    };
    const ensureActivityVisible = () => {
      const liveContainer = streamLiveContainer();
      if (!liveContainer) return;
      if (!liveContainer.contains(activity.wrapper)) liveContainer.appendChild(activity.wrapper);
      refreshActivityStatus();
      if (_autoScroll) {
        if (typeof _chatScrollToBottom === 'function') _chatScrollToBottom(liveContainer);
        else liveContainer.scrollTop = liveContainer.scrollHeight;
      }
    };
    const markCliOutput = (isText = false) => {
      lastCliOutputAt = Date.now();
      if (isText) lastCliTextAt = lastCliOutputAt;
    };
    const appendCliThinking = (chunk, label = 'CLIの思考内容を受信中...') => {
      const text = String(chunk || '').trimEnd();
      if (!text.trim()) return;
      cliThinkingText += (cliThinkingText && !cliThinkingText.endsWith('\n') ? '\n' : '') + text;
      markCliOutput();
      refreshActivityStatus(label);
      if (streamVisibleInCurrentChat()) {
        appendCliChatLog(activity.log, text);
        ensureActivityVisible();
      }
    };
    const cliResponseIdleMs = () => Date.now() - (lastCliTextAt || streamStartedAt);
    const maybeAbortIdleCliStream = () => {
      if (!CLI_CHAT_OUTPUT_IDLE_TIMEOUT_MS) return false;
      if (clientIdleAbortMessage || !_chatState.streaming || _chatState.abortController !== streamController) return false;
      if (cliResponseIdleMs() < CLI_CHAT_OUTPUT_IDLE_TIMEOUT_MS) return false;
      clientIdleAbortMessage = 'CLIから一定時間返答がないため、自動停止しました。必要なら内容を絞って再送信してください。';
      refreshActivityStatus('CLI応答を自動停止中...');
      try { streamController.abort(); } catch {}
      return true;
    };
    const activityTimer = setInterval(() => {
      if (maybeAbortIdleCliStream()) return;
      if (!streamVisibleInCurrentChat()) return;
      if (fullText.trim()) ensureAssistantVisible(fullText);
      ensureActivityVisible();
    }, 1000);
    activeCliChatStream = {
      restore() {
        if (!streamVisibleInCurrentChat()) return;
        if (fullText.trim()) ensureAssistantVisible(fullText);
        ensureActivityVisible();
      },
    };
    const saveStreamMessages = async (throwOnError = false) => {
      if (typeof chatAutoSave !== 'function') return false;
      const saved = await chatAutoSave({
        messages: streamMessages,
        sessionId: streamSessionId,
        sessionTitle: streamSessionTitle,
        targetPath: streamTargetPath,
        sourceFolder: streamSourceFolder,
        workspaceId: streamWorkspaceId,
        provider,
        model: streamModelLabel,
        silent: !throwOnError,
      });
      if (saved && typeof renderChatHistory === 'function') renderChatHistory();
      return saved;
    };

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (typeof _authToken !== 'undefined' && _authToken) headers.Authorization = 'Bearer ' + _authToken;
      const response = await fetch(API_BASE + '/cli-chat/stream', {
        method: 'POST',
        headers,
        signal: streamController.signal,
        body: JSON.stringify({
          provider,
          model: streamModelValue,
          reasoning_level: typeof chatGenerationSettings === 'function' ? chatGenerationSettings().reasoning_level : 'off',
          messages: typeof _ensureChatMessageIds === 'function' ? _ensureChatMessageIds(streamMessages) : streamMessages,
          system_prompt: typeof _buildSystemPrompt === 'function' ? _buildSystemPrompt({ targetPath: streamTargetPath }) : '',
          session_id: streamSessionId,
          session_title: streamSessionTitle,
          target_path: streamTargetPath,
          source_folder: streamSourceFolder,
          workspace_id: streamWorkspaceId,
          work_folder: streamWorkFolder,
          cli_session_continuity: !!cliSessionContinuity.enabled,
          cli_session_id: cliSessionContinuity.sessionId || '',
          cli_session_scope: cliSessionContinuity.scopeKey || '',
          active_feature: typeof _chatActiveFeatureForTarget === 'function' ? _chatActiveFeatureForTarget(streamTargetPath) : '',
          user: typeof getUsername === 'function' ? getUsername() : '',
          theme_context: typeof window.chatThemeContextSettings === 'function' ? window.chatThemeContextSettings() : {},
        }),
      });
      if (!response.ok) {
        let errorText = '';
        try { errorText = (await response.json())?.detail || ''; } catch {
          try { errorText = await response.text(); } catch {}
        }
        throw new Error(errorText || ('HTTP ' + response.status));
      }
      const reader = response.body?.getReader?.();
      if (!reader) throw new Error('CLIチャットを開始できませんでした');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.substring(6));
          sawCliEvent = true;
          if (data.type === 'cli_status') {
            const nextStatus = data.message
              || (data.status === 'started' ? 'CLIを実行中...'
                : data.status === 'waiting' ? 'CLIからの応答を待っています...'
                  : String(data.status || 'CLIを実行中...'));
            refreshActivityStatus(nextStatus);
            ensureActivityVisible();
          } else if (data.type === 'text_delta') {
            const chunk = data.content == null ? '' : String(data.content);
            if (!chunk) continue;
            markCliOutput(true);
            refreshActivityStatus('CLIの出力を受信中...');
            fullText += chunk;
            if (!streamVisibleInCurrentChat()) assistantDiv = null;
            ensureAssistantVisible(fullText);
            ensureActivityVisible();
            scrollStreamContainer();
          } else if (data.type === 'cli_stderr') {
            const chunk = data.content == null ? '' : String(data.content);
            stderrText += chunk;
            markCliOutput();
            refreshActivityStatus('CLIの進行ログを受信中...');
            const safeChunk = summarizeCliChatErrorDetail(chunk);
            if (safeChunk && streamVisibleInCurrentChat()) {
              appendCliChatLog(activity.log, safeChunk);
              ensureActivityVisible();
            }
          } else if (data.type === 'thinking_delta') {
            appendCliThinking(data.content, 'CLIの思考内容を受信中...');
          } else if (data.type === 'cli_session_update') {
            if (String(data.provider || provider) === provider && data.cli_session_id) {
              rememberCliChatSessionContinuity(cliSessionScope, data.cli_session_id);
            }
          } else if (data.type === 'error') {
            const detail = summarizeCliChatErrorDetail(data.detail || stderrText);
            if (detail) appendCliThinking('CLIエラー詳細:\n' + detail, 'CLIエラーを確認中...');
            const streamError = new Error(data.error || 'CLIチャットでエラーが発生しました');
            streamError.errorCode = String(data.error_code || 'cli_exit_nonzero');
            streamError.detail = detail;
            streamError.action = String(data.action || '');
            if (['cli_auth_required', 'cli_update_required', 'model_not_supported', 'cli_config_incompatible', 'cli_empty_response'].includes(streamError.errorCode)) {
              resetSessionContinuityForCurrentChat({ provider, sessionId: streamSessionId, silent: true });
            }
            throw streamError;
          } else if (data.type === 'done') {
            if (activity.status && streamVisibleInCurrentChat()) activity.status.textContent = 'CLIが完了しました';
          }
        }
      }
      activity.wrapper.remove();
      if (!fullText.trim()) {
        const label = cliChatMeta(provider)?.label || provider || 'CLI';
        const emptyError = new Error(
          sawCliEvent
            ? `${label}は終了しましたが、回答が空でした。`
            : `${label}の実行結果を受け取れませんでした。`
        );
        emptyError.errorCode = 'cli_empty_response';
        emptyError.detail = summarizeCliChatErrorDetail(stderrText);
        emptyError.action = 'CLIの更新・ログイン・モデル設定を確認してから再送信してください。';
        resetSessionContinuityForCurrentChat({ provider, sessionId: streamSessionId, silent: true });
        throw emptyError;
      }
      cliCompleted = true;
      if (fullText.trim()) {
        if (!assistantDiv || !assistantDiv.isConnected) assistantDiv = addAssistantToVisibleStream(fullText, renderOptions());
        else if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, []);
        if (assistantDiv && typeof _chatRenderThinking === 'function') _chatRenderThinking(assistantDiv, cliThinkingText);
        const assistantMessage = { role: 'assistant', content: fullText, msg_id: assistantMessageId, provider, model: streamModelLabel, timestamp: assistantTimestamp || (typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString()) };
        if (cliThinkingText.trim()) assistantMessage.thinking = cliThinkingText;
        streamMessages.push(assistantMessage);
        sendOk = true;
        if (cliChatTextRequestsContinuation(fullText)) {
          prepareAutoContinue('CLIが作業分割の継続を要求しました');
        }
        saveStreamMessages().catch(() => {});
      }
    } catch (error) {
      activity.wrapper.remove();
      if (error?.name === 'AbortError') {
        const abortedText = clientIdleAbortMessage
          ? (fullText ? fullText.trimEnd() + '\n\n' : '') + clientIdleAbortMessage
          : (fullText ? fullText.trimEnd() + '\n\n' : '') + '[中断されました]';
        if (!streamVisibleInCurrentChat()) assistantDiv = null;
        if (!assistantDiv || !assistantDiv.isConnected) assistantDiv = addAssistantToVisibleStream(abortedText, renderOptions());
        else if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, abortedText, []);
        if (assistantDiv && typeof _chatRenderThinking === 'function') _chatRenderThinking(assistantDiv, cliThinkingText);
        if (error?.errorCode === 'cli_auth_required') attachCliAuthRecovery(assistantDiv, provider);
        streamMessages.push({
          role: 'assistant',
          content: abortedText,
          msg_id: assistantMessageId,
          provider,
          model: streamModelLabel,
          timestamp: assistantTimestamp || (typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString()),
          aborted: !clientIdleAbortMessage,
          auto_stopped: !!clientIdleAbortMessage,
          ...(cliThinkingText.trim() ? { thinking: cliThinkingText } : {}),
        });
        sendOk = true;
        saveStreamMessages().catch(() => {});
      } else {
        const label = cliChatMeta(provider)?.label || provider || 'CLI';
        const recoverable = cliChatErrorAllowsContinuation(error);
        const autoContinuing = recoverable && prepareAutoContinue(error?.message || error);
        const actionText = String(error?.action || '').trim();
        const errorText = autoContinuing
          ? `${label} の実行が時間内に終わりませんでした。\n\n作業を分割して、自動で続きから実行します。`
          : `${label} がエラーで終了しました。\n\n${error?.message || error}${actionText ? '\n\n' + actionText : ''}`;
        if (!streamVisibleInCurrentChat()) assistantDiv = null;
        if (!assistantDiv || !assistantDiv.isConnected) assistantDiv = addAssistantToVisibleStream(errorText, renderOptions());
        else if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, errorText, []);
        else if (assistantDiv) assistantDiv.textContent = errorText;
        if (assistantDiv && typeof _chatRenderThinking === 'function') _chatRenderThinking(assistantDiv, cliThinkingText);
        if (!autoContinuing && error?.errorCode === 'cli_auth_required') attachCliAuthRecovery(assistantDiv, provider);
        streamMessages.push({
          role: 'assistant',
          content: errorText,
          msg_id: assistantMessageId,
          provider,
          model: streamModelLabel,
          timestamp: assistantTimestamp || (typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString()),
          error: !autoContinuing,
          error_code: error?.errorCode || 'cli_exit_nonzero',
          error_detail: error?.detail || '',
          action: actionText,
          auto_continue: !!autoContinuing,
          ...(cliThinkingText.trim() ? { thinking: cliThinkingText } : {}),
        });
        sendOk = true;
        try {
          await saveStreamMessages(true);
        } catch (saveError) {
          if (typeof showStatus === 'function') showStatus('CLI送信内容の保存に失敗: ' + (saveError?.message || saveError), true);
        }
      }
    } finally {
      clearInterval(activityTimer);
      if (activeCliChatStream?.restore) activeCliChatStream = null;
      activity.wrapper.remove();
      if (_chatState.abortController === streamController) {
        _chatState.streaming = false;
        _chatState.abortController = null;
        _chatState.streamingProvider = '';
        _chatState.streamingTargetPath = '';
        cliChatSetSendButtonStreaming(false);
        if (typeof _syncChatSourceFolderUi === 'function') _syncChatSourceFolderUi();
        if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});
        if (input?.isConnected && !window.GBChatFormatting?.focusInput?.()) input.focus();
        if (autoContinueRequest) {
          const continueMessage = {
            role: 'user',
            content: buildCliContinuationInstruction(autoContinueRequest.reason, autoContinueRequest.count),
            timestamp: typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString(),
          };
          setTimeout(() => {
            sendCliChat({
              deferredMessages: [continueMessage],
              streamMessages,
              sessionId: streamSessionId,
              sessionTitle: streamSessionTitle,
              targetPath: streamTargetPath,
              sourceFolder: streamSourceFolder,
              workspaceId: streamWorkspaceId,
              provider,
              model: streamModelLabel,
              mode: streamMode,
              cliContinuationCount: autoContinueRequest.count,
            }).catch(() => {});
          }, 0);
        } else if (cliCompleted && typeof _chatSendQueuedMessagesAfterStream === 'function') {
          setTimeout(() => {
            _chatSendQueuedMessagesAfterStream({
              messages: streamMessages,
              sessionId: streamSessionId,
              sessionTitle: streamSessionTitle,
              targetPath: streamTargetPath,
              sourceFolder: streamSourceFolder,
              workspaceId: streamWorkspaceId,
              provider,
              mode: streamMode,
            }).catch(() => {});
          }, 0);
        }
      }
      if (!detachedScope) msgContainer.removeEventListener('scroll', _scrollHandler);
    }
    return sendOk;
  }

  async function renderCliTranscripts() {
    ensureCliPanel();
    applyCliImportVisibility('cli');
    try {
      await loadCliConfig();
      await loadCliSessions();
    } catch (e) {
      setPanelStatus('外部CLI履歴の読み込みに失敗: ' + (e?.message || e), true);
    }
  }

  function installCliChatPatches() {
    ensureCliChatProviderOptions();
    try {
      if (typeof loadProviderModels === 'function' && !loadProviderModels._cliChatPatched) {
        const baseLoadProviderModels = loadProviderModels;
        const patched = async function(provider, options = {}) {
          const key = String(provider || '').trim();
          if (isCliChatProvider(key)) {
            await loadCliChatConfig();
            const { models, configured } = cliChatModelCatalogFor(key);
            _chatState.modelsByProvider[key] = models;
            if (configured) {
              // 設定ダイアログ側に既存の上書き値があり、かつユーザーがこのプロバイダの
              // モデルをこの端末でまだ一度も選んでいない場合は、それを次回描画の優先候補にする
              // （_currentChatModelSelectionのpendingModel優先ロジックに乗せる）。
              let hasStoredChoice = true;
              try { hasStoredChoice = localStorage.getItem('chat-model:' + key) != null; } catch { hasStoredChoice = true; }
              if (!hasStoredChoice && typeof _chatState !== 'undefined' && _chatState.provider === key && !_chatState.pendingModel) {
                _chatState.pendingModel = configured;
              }
            }
            return models;
          }
          return baseLoadProviderModels(provider, options);
        };
        patched._cliChatPatched = true;
        loadProviderModels = patched;
        window.loadProviderModels = patched;
      }
    } catch {}
    try {
      if (typeof _chatProviderHasConfiguredKey === 'function' && !_chatProviderHasConfiguredKey._cliChatPatched) {
        const baseProviderHasConfiguredKey = _chatProviderHasConfiguredKey;
        const patched = async function(provider) {
          const key = String(provider || '').trim();
          if (isCliChatProvider(key)) {
            await loadCliChatConfig();
            return cliChatProviderReadyStatus(key).ok;
          }
          return baseProviderHasConfiguredKey(provider);
        };
        patched._cliChatPatched = true;
        _chatProviderHasConfiguredKey = patched;
        window._chatProviderHasConfiguredKey = patched;
      }
    } catch {}
    try {
      if (typeof chatSend === 'function' && !chatSend._cliChatPatched) {
        originalChatSend = chatSend;
        const patched = function(options = {}) {
          if (isCliChatProvider(_chatState.provider)) return sendCliChat(options);
          return originalChatSend.call(this, options);
        };
        patched._cliChatPatched = true;
        chatSend = patched;
        window.chatSend = patched;
      }
    } catch {}
  }

  window.renderCliTranscripts = renderCliTranscripts;
  window.switchChatHistoryView = switchChatHistoryView;
  window.GBChatCli = {
    render: renderCliTranscripts,
    switchHistoryView: switchChatHistoryView,
    applyImportVisibility: applyCliImportVisibility,
    ensurePanel: ensureCliPanel,
    isCliChatProvider,
    sessionContinuitySupported: cliChatSessionContinuitySupported,
    sessionContinuityEnabled: cliChatSessionContinuityEnabled,
    resetSessionContinuityForCurrentChat,
    loadChatConfig: loadCliChatConfig,
    providerReadyStatus: cliChatProviderReadyStatus,
    sendCliChat,
  };
  window.MeldexCliAuthRecovery = { attach: attachCliAuthRecovery };

  installCliChatPatches();

  document.querySelectorAll('[data-cli-auth-provider]').forEach(row => {
    attachCliAuthRecovery(
      row.querySelector('.chat-message-bubble'),
      row.dataset.cliAuthProvider,
    );
  });

  document.addEventListener('DOMContentLoaded', () => {
    installCliChatPatches();
    loadCliChatConfig().then(async () => {
      if (window.GBChatProviderDefault?.applyFirstRun) {
        await window.GBChatProviderDefault.applyFirstRun({ configLoaded: true });
      }
      if (typeof _chatState !== 'undefined'
        && isCliChatProvider(_chatState.provider)
        && typeof updateChatModels === 'function') {
        updateChatModels({ suppressNotify: true });
      }
      if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});
    });
    ensureCliPanel();
    if (localStorage.getItem('chat-mode') === 'cli') {
      localStorage.setItem('chat-mode', 'history');
      localStorage.setItem('chat-history-view', 'cli');
    }
  });
})();
