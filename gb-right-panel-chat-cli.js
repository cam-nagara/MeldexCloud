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
  const CLI_CHAT_PROVIDER_KEYS = new Set(CLI_CHAT_PROVIDERS.map(provider => provider.key));
  let cliChatConfig = null;
  let originalChatSend = null;

  function icon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function text(value) {
    return String(value ?? '');
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

  function cliChatModel(provider) {
    const configured = cliChatConfig?.providers?.[provider]?.model;
    return configured || cliChatMeta(provider)?.model || cliChatMeta(provider)?.label || 'CLI';
  }

  function ensureCliChatProviderOptions() {
    try {
      if (typeof CHAT_DEFAULT_MODELS !== 'undefined') {
        CLI_CHAT_PROVIDERS.forEach(provider => { CHAT_DEFAULT_MODELS[provider.key] = [provider.model]; });
      }
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
    return { ok: true, message: '' };
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
    return contentToText(message?.content || '').replace(/\s+/g, ' ').trim();
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
    btn.title = title || label;
    if (actionId) btn.dataset.testid = 'chat-cli-' + actionId;
    btn.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:4px;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0;';
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
    panel.style.display = 'none';
    panel.style.flexDirection = 'column';
    panel.style.flex = '1';
    panel.style.overflow = 'hidden';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border);background:var(--bg3);flex-shrink:0;">
        <label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--fg2);white-space:nowrap;min-width:0;">
          <input id="chat-cli-enabled" type="checkbox" style="margin:0;flex-shrink:0;">
          <span style="overflow:hidden;text-overflow:ellipsis;">外部CLI取り込み</span>
        </label>
        <div id="chat-cli-actions" style="display:flex;gap:4px;"></div>
      </div>
      <div id="chat-cli-provider-settings" style="display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-bottom:1px solid var(--border);background:var(--bg);flex-shrink:0;"></div>
      <div id="chat-cli-status" style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--fg2);font-size:11px;flex-shrink:0;"></div>
      <div style="display:grid;grid-template-columns:minmax(140px,34%) 1fr;min-height:0;flex:1;overflow:hidden;">
        <div id="chat-cli-session-list" style="border-right:1px solid var(--border);overflow:auto;"></div>
        <div id="chat-cli-session-view" style="overflow:auto;padding:8px;display:flex;flex-direction:column;gap:8px;"></div>
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
      row.style.cssText = 'display:grid;grid-template-columns:minmax(92px,auto) minmax(120px,1fr);align-items:center;gap:6px;';
      row.innerHTML = `
        <label style="display:inline-flex;align-items:center;gap:4px;min-width:0;font-size:11px;color:var(--fg2);white-space:nowrap;">
          <input data-role="enabled" data-e2e-id="chat-cli-${provider.key}-enabled" aria-label="${esc(provider.label)}の取り込みを有効にする" type="checkbox" style="margin:0;flex-shrink:0;">
          <span style="overflow:hidden;text-overflow:ellipsis;">${esc(provider.label)}</span>
        </label>
        <input data-role="watch-path" data-e2e-id="chat-cli-${provider.key}-watch-path" aria-label="${esc(provider.label)}のログフォルダ" type="text" style="width:100%;min-width:0;padding:3px 6px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:3px;font-size:11px;">
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
    await saveCliConfig({ silent: true });
    setPanelStatus('外部CLIログをスキャン中...');
    const result = await apiPost('/cli-transcripts/scan', {});
    if (result.skipped) {
      setPanelStatus('スキャンをスキップ: ' + (result.reason || 'disabled'), true);
    } else {
      setPanelStatus(`取り込み ${Number(result.imported_count || 0)} 件 / エラー ${Number(result.error_count || 0)} 件`);
    }
    await loadCliSessions();
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
      empty.style.cssText = 'padding:16px;color:var(--fg2);font-size:12px;';
      empty.textContent = '取り込まれたCLIセッションはありません';
      list.appendChild(empty);
      return;
    }
    cliSessions.forEach(session => {
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.testid = 'chat-cli-session-' + String(session.session_id || '').replace(/[^A-Za-z0-9_-]/g, '_');
      const active = cliSelectedSession && cliSelectedSession.session?.provider === session.provider && cliSelectedSession.session?.session_id === session.session_id;
      row.style.cssText = `width:100%;text-align:left;padding:8px;border:0;border-bottom:1px solid var(--border);background:${active ? 'var(--bg3)' : 'var(--bg)'};color:var(--fg);cursor:pointer;`;
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:bold;">${icon('terminal', 13)}<span>${esc(providerLabel(session.provider))}</span></div>
        <div style="font-size:11px;color:var(--fg2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(shortPath(session.project_path || session.path))}</div>
        <div style="font-size:10px;color:var(--fg2);margin-top:2px;">${Number(session.message_count || 0)}件 / ${esc(session.last_updated_at || '')}</div>
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
    row.style.cssText = `align-self:${isUser ? 'flex-end' : 'flex-start'};max-width:88%;display:flex;flex-direction:column;gap:3px;`;
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg2);padding:0 4px;';
    header.innerHTML = `${icon(isUser ? 'user' : (role === 'tool' ? 'wrench' : 'bot'), 12)}<span>${esc(role)}</span><span>${esc(message.timestamp || '')}</span>`;
    const quote = document.createElement('button');
    quote.type = 'button';
    quote.title = 'Meldexのチャットで引用';
    quote.dataset.testid = 'chat-cli-quote-' + String(message.msg_id || '').replace(/[^A-Za-z0-9_-]/g, '_');
    quote.dataset.cliMsgId = String(message.msg_id || '');
    quote.innerHTML = icon('quote', 12);
    quote.style.cssText = 'width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--fg2);border:0;border-radius:4px;cursor:pointer;padding:0;';
    quote.addEventListener('click', () => quoteCliMessage(message, session));
    header.appendChild(quote);
    const bubble = document.createElement('div');
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
    setPanelStatus('ナレッジを抽出中...');
    const result = await apiPost(
      '/cli-transcripts/session/' + encodeURIComponent(session.provider) + '/' + encodeURIComponent(session.session_id) + '/extract-knowledge',
      {}
    );
    setPanelStatus(`ナレッジ抽出: ${Number(result.item_count || 0)}件`);
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
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:2px;max-width:85%;align-self:flex-start;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg2);padding:0 4px;';
    const label = cliChatModel(provider);
    header.innerHTML = (typeof getProviderIconHtml === 'function' ? getProviderIconHtml(provider, 16) : icon('terminal', 16)) + '<span>' + esc(label) + '</span>';
    const body = document.createElement('div');
    body.style.cssText = 'background:var(--bg3);padding:8px 16px;border-radius:12px 12px 12px 2px;font-size:13px;color:var(--fg2);display:flex;align-items:center;gap:8px;';
    body.innerHTML = '<span class="chat-spinner"></span><span data-cli-chat-status>CLIを起動中...</span>';
    const log = document.createElement('div');
    log.style.cssText = 'display:none;flex-direction:column;gap:4px;width:100%;max-height:28vh;overflow:auto;color:var(--fg2);font-size:11px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:6px;white-space:pre-wrap;word-break:break-word;';
    wrapper.append(header, body, log);
    return { wrapper, status: body.querySelector('[data-cli-chat-status]'), log };
  }

  function appendCliChatLog(log, textValue) {
    if (!log || !String(textValue || '').trim()) return;
    log.style.display = 'flex';
    const line = document.createElement('div');
    line.textContent = String(textValue || '').trimEnd();
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  async function sendCliChat(options = {}) {
    if (_chatState.streaming) {
      if (typeof _chatQueueUserInputForNextTurn === 'function') return _chatQueueUserInputForNextTurn(options);
      if (options?.fromButton || options?.stopRequested) {
        if (typeof chatStopStreaming === 'function') chatStopStreaming();
      }
      return false;
    }
    if (!cliChatConfig) await loadCliChatConfig();
    const provider = String(_chatState.provider || '').trim();
    const providerStatus = cliChatProviderReadyStatus(provider);
    if (!providerStatus.ok) {
      if (typeof chatAddSystem === 'function') chatAddSystem(providerStatus.message || ((cliChatMeta(provider)?.label || provider) + ' のCLIチャット設定を確認してください。'));
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
    const attachments = usingDeferredMessages ? [] : (_chatState.pendingAttachments || []);
    const textValue = usingDeferredMessages && typeof _chatQueuedMessagesText === 'function'
      ? _chatQueuedMessagesText(deferredMessages).trim()
      : input.value.trim();
    if (!usingDeferredMessages && !textValue && attachments.length === 0) {
      if (typeof _chatQueuedMessages === 'function' && _chatQueuedMessages().length && typeof _chatSendQueuedMessagesAfterStream === 'function') {
        return _chatSendQueuedMessagesAfterStream();
      }
      return false;
    }

    if (!usingDeferredMessages) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (window.GBChatFormatting?.syncInput) window.GBChatFormatting.syncInput();
      if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
    }

    if (usingDeferredMessages) {
      deferredMessages.forEach(message => {
        message.role = 'user';
        message.timestamp = message.timestamp || (typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString());
        if (typeof _ensureChatMessageId === 'function') _ensureChatMessageId(message);
      });
      _chatState.messages.push(...deferredMessages);
      if (typeof _chatRenderStoredMessages === 'function') _chatRenderStoredMessages();
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
      _chatState.messages.push(userMessage);
    }
    if (typeof _ensureSessionId === 'function') _ensureSessionId();

    const streamMessages = _chatState.messages;
    const streamSessionId = _chatState.sessionId || '';
    const streamSessionTitle = _chatState.sessionTitle || '';
    const streamTargetPath = _chatState.targetPath || '';
    const streamSourceFolder = typeof _chatSourceFolderValue === 'function' ? _chatSourceFolderValue() : '';
    const streamWorkFolder = typeof getWorkFolder === 'function' ? getWorkFolder() : '';
    const streamModel = cliChatModel(provider);
    const streamController = new AbortController();
    const streamVisibleInCurrentChat = () => _chatState.messages === streamMessages
      && (_chatState.sessionId || '') === streamSessionId
      && (_chatState.targetPath || '') === streamTargetPath;
    const streamLiveContainer = () => streamVisibleInCurrentChat()
      ? (typeof _chatLiveMessagesContainer === 'function' ? _chatLiveMessagesContainer() : document.getElementById('chat-messages'))
      : null;
    const scrollStreamContainer = () => {
      const liveContainer = streamLiveContainer();
      if (liveContainer) liveContainer.scrollTop = liveContainer.scrollHeight;
    };
    const addAssistantToVisibleStream = (content, renderOptions) => (
      streamVisibleInCurrentChat() && typeof chatAddMessage === 'function'
        ? chatAddMessage('assistant', content, renderOptions)
        : null
    );

    _chatState.streaming = true;
    _chatState.abortController = streamController;
    _chatState.streamingProvider = provider;
    cliChatSetSendButtonStreaming(true);
    const activity = createCliChatActivity(provider);
    msgContainer.appendChild(activity.wrapper);
    msgContainer.scrollTop = msgContainer.scrollHeight;

    const assistantMessageId = typeof _newChatMessageId === 'function' ? _newChatMessageId() : 'msg_' + Math.random().toString(16).slice(2, 10);
    let assistantTimestamp = '';
    let assistantDiv = null;
    let fullText = '';
    let stderrText = '';
    let sendOk = false;
    let sawCliEvent = false;
    let cliCompleted = false;
    const renderOptions = () => {
      if (!assistantTimestamp) assistantTimestamp = typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString();
      return {
        messageIndex: streamMessages.length,
        msg_id: assistantMessageId,
        provider,
        model: streamModel,
        timestamp: assistantTimestamp,
      };
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
          model: streamModel,
          messages: typeof _ensureChatMessageIds === 'function' ? _ensureChatMessageIds(streamMessages) : streamMessages,
          system_prompt: typeof _buildSystemPrompt === 'function' ? _buildSystemPrompt() : '',
          session_id: streamSessionId,
          session_title: streamSessionTitle,
          target_path: streamTargetPath,
          source_folder: streamSourceFolder,
          work_folder: streamWorkFolder,
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
            if (activity.status && streamVisibleInCurrentChat()) activity.status.textContent = nextStatus;
          } else if (data.type === 'text_delta') {
            const chunk = data.content == null ? '' : String(data.content);
            if (!chunk) continue;
            activity.wrapper.remove();
            fullText += chunk;
            if (!streamVisibleInCurrentChat()) assistantDiv = null;
            if (!assistantDiv || !assistantDiv.isConnected) assistantDiv = addAssistantToVisibleStream('', renderOptions());
            if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, []);
            else if (assistantDiv) assistantDiv.textContent = fullText;
            scrollStreamContainer();
          } else if (data.type === 'cli_stderr') {
            const chunk = data.content == null ? '' : String(data.content);
            stderrText += chunk;
            if (streamVisibleInCurrentChat()) appendCliChatLog(activity.log, chunk);
          } else if (data.type === 'error') {
            const detail = stderrText.trim();
            throw new Error((data.error || 'CLIチャットでエラーが発生しました') + (detail ? '\n\n' + detail : ''));
          } else if (data.type === 'done') {
            if (activity.status && streamVisibleInCurrentChat()) activity.status.textContent = 'CLIが完了しました';
          }
        }
      }
      activity.wrapper.remove();
      cliCompleted = true;
      if (!fullText.trim() && stderrText.trim()) fullText = stderrText.trim();
      if (!fullText.trim() && !stderrText.trim()) {
        const label = cliChatMeta(provider)?.label || provider || 'CLI';
        fullText = sawCliEvent
          ? `${label} は終了しましたが、返答が空でした。\n\nMeldexから起動した時だけ確認画面や権限確認で止まる場合があります。設定 > LLM > CLIチャットと、作業フォルダの信頼設定を確認してください。`
          : `${label} の実行結果を受け取れませんでした。\n\nMeldexから起動したCLIがすぐ終了した可能性があります。設定 > LLM > CLIチャットと、Meldexを再起動した後のPATHを確認してください。`;
      }
      if (fullText.trim()) {
        if (!assistantDiv || !assistantDiv.isConnected) assistantDiv = addAssistantToVisibleStream(fullText, renderOptions());
        else if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, fullText, []);
        const assistantMessage = { role: 'assistant', content: fullText, msg_id: assistantMessageId, provider, model: streamModel, timestamp: assistantTimestamp || (typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString()) };
        streamMessages.push(assistantMessage);
        sendOk = true;
        if (typeof chatAutoSave === 'function') {
          chatAutoSave({
            messages: streamMessages,
            sessionId: streamSessionId,
            sessionTitle: streamSessionTitle,
            targetPath: streamTargetPath,
            sourceFolder: streamSourceFolder,
            provider,
            model: streamModel,
          }).then(() => { if (typeof renderChatHistory === 'function') renderChatHistory(); });
        }
      }
    } catch (error) {
      activity.wrapper.remove();
      if (error?.name === 'AbortError') {
        const abortedText = (fullText ? fullText.trimEnd() + '\n\n' : '') + '[中断されました]';
        if (!streamVisibleInCurrentChat()) assistantDiv = null;
        if (!assistantDiv || !assistantDiv.isConnected) assistantDiv = addAssistantToVisibleStream(abortedText, renderOptions());
        else if (assistantDiv && typeof _chatRenderAssistantStream === 'function') _chatRenderAssistantStream(assistantDiv, abortedText, []);
        streamMessages.push({ role: 'assistant', content: abortedText, msg_id: assistantMessageId, provider, model: streamModel, timestamp: assistantTimestamp || (typeof _chatLocalTimestamp === 'function' ? _chatLocalTimestamp() : new Date().toISOString()), aborted: true });
        sendOk = true;
        if (typeof chatAutoSave === 'function') {
          chatAutoSave({
            messages: streamMessages,
            sessionId: streamSessionId,
            sessionTitle: streamSessionTitle,
            targetPath: streamTargetPath,
            sourceFolder: streamSourceFolder,
            provider,
            model: streamModel,
          }).then(() => { if (typeof renderChatHistory === 'function') renderChatHistory(); });
        }
      } else if (streamVisibleInCurrentChat() && typeof chatAddSystem === 'function') {
        chatAddSystem('CLIエラー: ' + (error?.message || error));
      }
    } finally {
      if (_chatState.abortController === streamController) {
        _chatState.streaming = false;
        _chatState.abortController = null;
        _chatState.streamingProvider = '';
        cliChatSetSendButtonStreaming(false);
        if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});
        if (input?.isConnected && !window.GBChatFormatting?.focusInput?.()) input.focus();
        if (cliCompleted && typeof _chatSendQueuedMessagesAfterStream === 'function') {
          setTimeout(() => {
            _chatSendQueuedMessagesAfterStream({
              messages: streamMessages,
              sessionId: streamSessionId,
              targetPath: streamTargetPath,
            }).catch(() => {});
          }, 0);
        }
      }
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
            const model = cliChatModel(key);
            _chatState.modelsByProvider[key] = [{ id: model, name: model }];
            return _chatState.modelsByProvider[key];
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
    loadChatConfig: loadCliChatConfig,
    providerReadyStatus: cliChatProviderReadyStatus,
    sendCliChat,
  };

  installCliChatPatches();

  document.addEventListener('DOMContentLoaded', () => {
    installCliChatPatches();
    loadCliChatConfig().then(() => {
      if (isCliChatProvider(_chatState.provider) && typeof updateChatModels === 'function') updateChatModels({ suppressNotify: true });
      if (typeof _chatRefreshApiKeyState === 'function') _chatRefreshApiKeyState().catch(() => {});
    });
    ensureCliPanel();
    if (localStorage.getItem('chat-mode') === 'cli') {
      localStorage.setItem('chat-mode', 'history');
      localStorage.setItem('chat-history-view', 'cli');
    }
  });
})();
