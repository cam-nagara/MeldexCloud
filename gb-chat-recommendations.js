/* gb-chat-recommendations.js: context-aware next action suggestions for chat. */
(function (global) {
  'use strict';

  const PANEL_ID = 'chat-recommendations-panel';
  const STORAGE_KEY = 'chat-recommendations-dismissed:v1';
  const ENABLED_STORAGE_KEY = 'chat-recommendations-enabled';
  const MAX_ACTIONS = 3;
  const REFRESH_DELAY_MS = 120;
  const REFRESH_INTERVAL_MS = 2500;
  let refreshTimer = null;
  let lastSignature = '';
  let lastActions = [];
  let lastContext = null;

  function icon(name, size = 14) {
    return typeof global.lucide === 'function' ? global.lucide(name, size) : '';
  }

  function safeText(value) {
    return String(value == null ? '' : value);
  }

  function stableIdPart(value) {
    return safeText(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'action';
  }

  function chatState() {
    try {
      return typeof _chatState !== 'undefined' ? _chatState : null;
    } catch {
      return null;
    }
  }

  function chatMode() {
    try {
      return typeof _chatMode !== 'undefined' ? String(_chatMode || '') : '';
    } catch {
      return '';
    }
  }

  function globalStateValue(key) {
    try {
      return typeof state !== 'undefined' && state ? String(state[key] || '') : '';
    } catch {
      return '';
    }
  }

  function sourceFolderValue() {
    try {
      if (typeof _chatSourceFolderValue === 'function') return String(_chatSourceFolderValue() || '');
    } catch {}
    return String(chatState()?.sourceFolder || '');
  }

  function workspaceIdValue() {
    try {
      if (typeof _chatWorkspaceIdValue === 'function') return String(_chatWorkspaceIdValue() || '');
    } catch {}
    return String(chatState()?.workspaceId || '');
  }

  function contentToText(content) {
    try {
      if (typeof _chatContentToText === 'function') return _chatContentToText(content);
    } catch {}
    if (typeof content === 'string') return content;
    try {
      if (Array.isArray(content)) {
        return content.map(part => {
          if (typeof part === 'string') return part;
          if (!part || typeof part !== 'object') return '';
          return safeText(part.text || part.content || part.name || '');
        }).filter(Boolean).join('\n');
      }
      return safeText(content);
    } catch {
      return '';
    }
  }

  function activeTabType() {
    try {
      if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.getCurrentOpenTargetInfo === 'function') {
        const paneId = (typeof GBLayout !== 'undefined' && GBLayout) ? (GBLayout.activePane || '') : '';
        const info = GBPaneBridge.getCurrentOpenTargetInfo(paneId);
        if (info?.activeTab?.type) return String(info.activeTab.type || '');
      }
    } catch {}
    try {
      if (typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function' && typeof GBLayout !== 'undefined') {
        return String(GBTabs.getActiveTab(GBLayout.activePane)?.type || '');
      }
    } catch {}
    return globalStateValue('view');
  }

  function currentTarget() {
    const st = chatState();
    if (st?.currentTargetPath) {
      return { path: String(st.currentTargetPath || ''), kind: String(st.currentTargetKind || '') };
    }
    try {
      if (typeof _chatEffectiveTargetPath === 'function') {
        const path = String(_chatEffectiveTargetPath() || '');
        if (path) return { path, kind: String(st?.currentTargetKind || '') };
      }
    } catch {}
    try {
      if (typeof _chatCurrentOpenTarget === 'function') {
        const target = _chatCurrentOpenTarget();
        if (target?.path) return { path: String(target.path || ''), kind: String(target.kind || '') };
      }
    } catch {}
    const path = String(st?.targetPath || globalStateValue('currentPagePath') || globalStateValue('currentDbPath') || globalStateValue('currentBoardPath') || '');
    return { path, kind: '' };
  }

  function fileName(path) {
    const raw = safeText(path).replace(/\\/g, '/');
    return raw.split('/').filter(Boolean).pop() || raw || '現在の対象';
  }

  function detectFeature(type, path, kind) {
    const lowerType = safeText(type).toLowerCase();
    const lowerPath = safeText(path).toLowerCase();
    if (lowerType === 'scriptnote' || lowerPath.endsWith('.scriptnote.json')) return 'scriptnote';
    if (lowerType === 'board' || lowerPath.endsWith('.mel-board') || lowerPath.endsWith('.board.md')) return 'board';
    if (['database', 'db', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'tasks', 'shifts', 'chart', 'graph', 'form', 'smart-db'].includes(lowerType)) return 'sheet';
    if (lowerType === 'calendar') return 'calendar';
    if (lowerType === 'folder' || kind === 'folder') return 'folder';
    if (lowerType === 'media' || lowerType === 'html' || /\.(png|jpe?g|gif|webp|svg|pdf|html?)$/i.test(lowerPath)) return 'media';
    if (lowerType === 'page' || lowerType === 'entity' || lowerPath.endsWith('.md')) return 'note';
    return path ? 'file' : 'workspace';
  }

  function lastMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const lastUser = [...list].reverse().find(message => message?.role === 'user');
    const lastAssistant = [...list].reverse().find(message => message?.role === 'assistant');
    return {
      count: list.length,
      lastUserText: contentToText(lastUser?.content || '').trim(),
      lastAssistantText: contentToText(lastAssistant?.content || '').trim(),
    };
  }

  function contextSnapshot() {
    const st = chatState();
    const target = currentTarget();
    const type = activeTabType();
    const messages = lastMessages(st?.messages || []);
    const input = safeText(global.document?.getElementById('chat-input')?.value || '').trim();
    const feature = detectFeature(type, target.path, target.kind);
    const provider = safeText(st?.provider || '');
    const hasSource = !!(sourceFolderValue() || workspaceIdValue());
    return {
      path: target.path,
      kind: target.kind,
      name: fileName(target.path),
      type,
      feature,
      provider,
      hasSource,
      input,
      messageCount: messages.count,
      lastUserText: messages.lastUserText,
      lastAssistantText: messages.lastAssistantText,
      contextKey: [feature, target.path || '(none)', Math.min(6, Math.floor(messages.count / 2)), input ? 'draft' : 'empty'].join('|'),
    };
  }

  function targetLine(ctx) {
    return ctx.path ? `対象: ${ctx.path}\n\n` : '';
  }

  function addAction(actions, action) {
    if (!action?.id || actions.some(item => item.id === action.id)) return;
    actions.push({ priority: 0, icon: 'sparkles', kind: 'prompt', ...action });
  }

  function buildPromptActions(ctx) {
    const actions = [];
    if (!ctx.hasSource) {
      addAction(actions, {
        id: 'choose-source',
        kind: 'focus-source',
        icon: 'folderOpen',
        label: '対象を選ぶ',
        reason: '参照する場所を先に決めると、回答の根拠が安定します。',
        priority: 100,
      });
      return actions;
    }

    if (ctx.input) {
      addAction(actions, {
        id: 'draft-clarify',
        icon: 'wandSparkles',
        label: '相談を整理して進める',
        reason: '入力中の内容を、前提確認と次の作業に分けて進めます。',
        priority: 96,
        prompt: targetLine(ctx)
          + '次の相談内容を、確認すべき前提、使うべきMeldex内情報、最初の回答方針に分けて整理し、そのまま回答してください。\n\n相談内容:\n'
          + ctx.input,
      });
    }

    if (ctx.feature === 'scriptnote') {
      addAction(actions, {
        id: 'scriptnote-review',
        icon: 'bookOpenText',
        label: 'この場面を点検',
        reason: 'シナリオを開いているので、流れ・会話・矛盾を確認できます。',
        priority: 92,
        prompt: targetLine(ctx)
          + '現在開いているシナリオを読み、場面の目的、会話の自然さ、前後の矛盾、改善案を短く整理してください。根拠にした箇所も示してください。',
      });
      addAction(actions, {
        id: 'scriptnote-next-scene',
        icon: 'split',
        label: '次の展開を3案出す',
        reason: '場面の続きを、方向性の違う候補として比較できます。',
        priority: 72,
        prompt: targetLine(ctx)
          + '現在開いているシナリオの直後に続けられる展開を3案出してください。各案について、狙い、読者への効果、既存設定との注意点を添えてください。',
      });
    } else if (ctx.feature === 'sheet') {
      addAction(actions, {
        id: 'sheet-gaps',
        icon: 'tableProperties',
        label: '設定の抜けを探す',
        reason: 'シートの列とエントリから、未入力や矛盾しそうな点を探せます。',
        priority: 92,
        prompt: targetLine(ctx)
          + '現在開いているシートを読み、未入力、矛盾しそうな項目、次に整えるべきエントリを3つ提案してください。必要なら確認に使った列名も示してください。',
      });
    } else if (ctx.feature === 'board') {
      addAction(actions, {
        id: 'board-structure',
        icon: 'network',
        label: '関係と伏線を整理',
        reason: 'ボード上のカード同士のつながりから、未接続の要素を見つけられます。',
        priority: 92,
        prompt: targetLine(ctx)
          + '現在開いているボードを読み、カード同士の関係、未接続の要素、伏線として伸ばせそうな点、次に深掘りすべき点を整理してください。',
      });
    } else if (ctx.feature === 'note') {
      addAction(actions, {
        id: 'note-next',
        icon: 'fileText',
        label: '要点と次の一手',
        reason: 'ノートの内容を作業単位に分けると、次に進めやすくなります。',
        priority: 88,
        prompt: targetLine(ctx)
          + '現在開いているノートを読み、要点、未決定事項、次にできる作業を3つに分けて整理してください。本文にない推測は推測として分けてください。',
      });
    } else if (ctx.feature === 'folder' || ctx.feature === 'workspace') {
      addAction(actions, {
        id: 'folder-overview',
        icon: 'folderSearch',
        label: '作業候補を俯瞰',
        reason: '今のフォルダから、進める価値が高いファイルや整理点を探せます。',
        priority: 84,
        prompt: targetLine(ctx)
          + '現在の対象フォルダを確認し、最近取り組むとよいファイル、整理すべき点、創作上の次の一手を3つ提案してください。判断理由も短く添えてください。',
      });
    }

    if (ctx.messageCount >= 4) {
      addAction(actions, {
        id: 'chat-summary',
        icon: 'listChecks',
        label: 'ここまでを整理',
        reason: '会話が続いているので、決定事項と保留事項を一度まとめられます。',
        priority: 78,
        prompt: 'このチャットのここまでの内容を、決定事項、保留事項、次にやることに分けて整理してください。ナレッジ化すべき内容があれば候補として分けてください。',
      });
    }

    if (ctx.lastAssistantText && ctx.messageCount >= 2) {
      addAction(actions, {
        id: 'compare-last',
        icon: 'scale',
        label: '直前の案を比較',
        reason: '出た案をそのまま増やす前に、採用しやすさを見比べます。',
        priority: 70,
        prompt: '直前の提案を、採用しやすさ、面白さ、既存設定との整合、リスクで比較し、次に取るべき一手を1つ薦めてください。',
      });
    }

    addAction(actions, {
      id: 'creative-brief',
      icon: 'sparkles',
      label: '創作ブリーフを作る',
      reason: '作品の前提・根拠・未決定事項を短く束ねてから相談できます。',
      priority: 56,
      prompt: targetLine(ctx)
        + '今後の創作相談に使うため、現在の対象と関連ナレッジから、作品前提、重要な決定事項、未決定事項、注意すべき矛盾、次の相談に渡すべき文脈を短いブリーフにしてください。',
    });

    addAction(actions, {
      id: 'diverge-ideas',
      icon: 'gitBranch',
      label: '方向性を分けて3案',
      reason: '似た案に寄りすぎないよう、別方向の候補を作れます。',
      priority: 52,
      prompt: targetLine(ctx)
        + '現在の対象に対して、王道、意外性重視、感情重視の3方向で次のアイディアを出してください。各案の狙いと、既存設定と衝突しそうな点を添えてください。',
    });

    return actions;
  }

  function recommendationsEnabled() {
    try {
      return global.localStorage.getItem(ENABLED_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  function dismissedMap() {
    try {
      const parsed = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeDismissedMap(map) {
    try {
      const entries = Object.entries(map || {}).slice(-80);
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }

  function dismissKey(ctx, actionId) {
    return ctx.contextKey + '::' + actionId;
  }

  function filteredActions(ctx) {
    const dismissed = dismissedMap();
    return buildPromptActions(ctx)
      .filter(action => dismissed[dismissKey(ctx, action.id)] !== '1')
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
      .slice(0, MAX_ACTIONS);
  }

  function hidePanelForDisabled() {
    const panel = global.document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.style.display = 'none';
    panel.innerHTML = '';
  }

  function ensurePanel() {
    let panel = global.document.getElementById(PANEL_ID);
    if (panel) return panel;
    const messages = global.document.getElementById('chat-messages');
    if (!messages?.parentNode) return null;
    panel = global.document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'chat-recommendations-panel';
    panel.style.cssText = 'display:none;flex-direction:column;gap:6px;flex-shrink:0;padding:8px;border-bottom:1px solid var(--border);background:var(--bg);';
    messages.parentNode.insertBefore(panel, messages);
    return panel;
  }

  function makeIconButton(title, iconName) {
    const button = global.document.createElement('button');
    button.type = 'button';
    button.className = 'chat-recommendation-icon-btn';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = icon(iconName, 14);
    button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 28px;background:transparent;color:var(--fg2);border:1px solid transparent;border-radius:4px;cursor:pointer;padding:0;';
    return button;
  }

  function createActionRow(action) {
    const row = global.document.createElement('div');
    row.className = 'chat-recommendation-row';
    row.style.cssText = 'display:flex;align-items:stretch;gap:6px;min-width:0;';

    const run = global.document.createElement('button');
    run.type = 'button';
    run.className = 'chat-recommendation-run-btn';
    run.dataset.chatRecommendationRun = action.id;
    run.dataset.e2eId = 'chat-recommendation-run-' + stableIdPart(action.id);
    run.title = `${action.label || '提案'}を実行`;
    run.setAttribute('aria-label', run.title);
    run.style.cssText = 'display:flex;align-items:flex-start;gap:7px;flex:1;min-width:0;text-align:left;padding:7px 8px;background:var(--bg3);color:var(--fg);border:1px solid var(--border);border-radius:6px;cursor:pointer;';
    const iconEl = global.document.createElement('span');
    iconEl.innerHTML = icon(action.icon || 'sparkles', 15);
    iconEl.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:0 0 18px;color:var(--accent);';
    const text = global.document.createElement('span');
    text.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;';
    const label = global.document.createElement('span');
    label.textContent = action.label || '実行';
    label.style.cssText = 'font-size:12px;font-weight:700;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const reason = global.document.createElement('span');
    reason.textContent = action.reason || '';
    reason.style.cssText = 'font-size:11px;color:var(--fg2);line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    text.append(label, reason);
    run.append(iconEl, text);
    run.addEventListener('click', () => runAction(action.id));

    const dismiss = makeIconButton('今は不要', 'x');
    dismiss.dataset.chatRecommendationDismiss = action.id;
    dismiss.dataset.e2eId = 'chat-recommendation-dismiss-' + stableIdPart(action.id);
    dismiss.addEventListener('click', () => dismissAction(action.id));

    row.append(run, dismiss);
    return row;
  }

  function renderPanel(ctx, actions) {
    if (!recommendationsEnabled()) {
      hidePanelForDisabled();
      return;
    }
    const panel = ensurePanel();
    if (!panel) return;
    if (chatMode() !== 'llm' || chatState()?.streaming || !actions.length) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }
    const searchResults = global.document.getElementById('chat-search-results');
    if (searchResults && searchResults.style.display && searchResults.style.display !== 'none') {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }

    panel.innerHTML = '';
    const header = global.document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;';
    const titleIcon = global.document.createElement('span');
    titleIcon.innerHTML = icon('sparkles', 14);
    titleIcon.style.cssText = 'display:inline-flex;color:var(--accent);flex:0 0 auto;';
    const title = global.document.createElement('strong');
    title.textContent = '次にできること';
    title.style.cssText = 'font-size:12px;line-height:1.25;white-space:nowrap;';
    const summary = global.document.createElement('span');
    summary.textContent = ctx.path ? ctx.name : '現在の状況';
    summary.title = ctx.path || '';
    summary.style.cssText = 'font-size:11px;color:var(--fg2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const refresh = makeIconButton('更新', 'refreshCw');
    refresh.dataset.e2eId = 'chat-recommendation-refresh';
    refresh.style.marginLeft = 'auto';
    refresh.addEventListener('click', () => refreshNow({ force: true }));
    header.append(titleIcon, title, summary, refresh);
    panel.appendChild(header);
    actions.forEach(action => panel.appendChild(createActionRow(action)));
    panel.style.display = 'flex';
  }

  function signatureFor(ctx, actions) {
    const searchResults = global.document.getElementById('chat-search-results');
    const searchVisible = !!(searchResults && searchResults.style.display && searchResults.style.display !== 'none');
    return JSON.stringify({
      mode: chatMode(),
      streaming: !!chatState()?.streaming,
      searchVisible,
      key: ctx.contextKey,
      path: ctx.path,
      inputLength: ctx.input.length,
      actions: actions.map(action => action.id),
    });
  }

  function refreshNow(options = {}) {
    if (!recommendationsEnabled()) {
      hidePanelForDisabled();
      lastSignature = '';
      return;
    }
    const ctx = contextSnapshot();
    const actions = filteredActions(ctx);
    const signature = signatureFor(ctx, actions);
    if (!options.force && signature === lastSignature) return;
    lastSignature = signature;
    lastContext = ctx;
    lastActions = actions;
    renderPanel(ctx, actions);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshNow(), REFRESH_DELAY_MS);
  }

  function fillInput(text) {
    const input = global.document.getElementById('chat-input');
    if (!input) return false;
    const current = safeText(input.value || '').trim();
    const next = current && !safeText(text).includes(current)
      ? current + '\n\n' + safeText(text)
      : safeText(text);
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    try { global.GBChatFormatting?.syncInput?.(); } catch {}
    try {
      if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 10);
    } catch {}
    input.focus();
    return true;
  }

  function runAction(actionId) {
    const action = lastActions.find(item => item.id === actionId);
    if (!action) return false;
    if (action.kind === 'focus-source') {
      const target = global.document.getElementById('chat-target-badge');
      if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (typeof global.showStatus === 'function') global.showStatus('フォルダツリーで対象を選択してください');
      return true;
    }
    if (!fillInput(action.prompt || action.label || '')) return false;
    try {
      if (typeof global.chatSend === 'function') {
        global.chatSend({ fromRecommendation: true });
      } else if (typeof chatSend === 'function') {
        chatSend({ fromRecommendation: true });
      }
    } catch {}
    scheduleRefresh();
    return true;
  }

  function dismissAction(actionId) {
    if (!lastContext || !actionId) return;
    const map = dismissedMap();
    map[dismissKey(lastContext, actionId)] = '1';
    writeDismissedMap(map);
    refreshNow({ force: true });
  }

  function install() {
    // Listeners and the refresh interval are wired unconditionally so that toggling
    // the "show recommendations" setting back on (via settings, or in another tab)
    // is picked up on the next interval tick without needing to reload the page.
    const input = global.document.getElementById('chat-input');
    if (input && !input.dataset.chatRecommendationsBound) {
      input.dataset.chatRecommendationsBound = '1';
      input.addEventListener('input', scheduleRefresh);
      input.addEventListener('focus', scheduleRefresh);
    }
    global.document.addEventListener('click', scheduleRefresh, true);
    global.addEventListener('focus', scheduleRefresh);
    global.setInterval(() => refreshNow(), REFRESH_INTERVAL_MS);
    if (!recommendationsEnabled()) return;
    ensurePanel();
    refreshNow({ force: true });
  }

  global.GBChatRecommendations = {
    refresh: refreshNow,
    scheduleRefresh,
    getRecommendations: () => filteredActions(contextSnapshot()),
    run: runAction,
    dismiss: dismissAction,
  };

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', install);
  } else {
    install();
  }
})(window);
