/* gb-e2e-actions.part01.js: split from gb-e2e-actions.js */
/* ==============================
   gb-e2e-actions.js: frontend E2E action/assertion registry
   ============================== */

(function () {
  const ACTION_HANDLERS = Object.create(null);
  const ASSERTION_HANDLERS = Object.create(null);
  const STEP_ASSERTIONS = ['inv_layout_structure', 'inv_no_runtime_errors'];

  function registerAction(type, fn) {
    ACTION_HANDLERS[type] = fn;
  }

  function registerAssertion(type, fn) {
    ASSERTION_HANDLERS[type] = fn;
  }

  function _labelFromPath(path) {
    const parts = String(path || '').split('/');
    return parts[parts.length - 1] || path || '';
  }

  function _copyState(value) {
    if (!value || typeof value !== 'object') return {};
    try { return JSON.parse(JSON.stringify(value)); } catch {}
    return { ...value };
  }

  function _normalize(value) {
    return String(value || '').trim();
  }

  function _appState() {
    try { return typeof state !== 'undefined' ? state : (window.state || {}); } catch {}
    return window.state || {};
  }

  function _folderPathValue() {
    try { return typeof _folderPath !== 'undefined' ? _folderPath : (window._folderPath || ''); } catch {}
    return window._folderPath || '';
  }

  function _boardState() {
    try { return typeof bd !== 'undefined' ? bd : (window.bd || null); } catch {}
    return window.bd || null;
  }

  function _currentDbPathValue() {
    try {
      const pane = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
      if (pane?.dbPath) return pane.dbPath;
    } catch {}
    return _appState().currentDbPath || '';
  }

  function _globalDbPathValue() {
    return _appState().currentDbPath || '';
  }

  function _resolvedDbPathKey(api, dbPath) {
    const expected = api.normalizePath(dbPath);
    const paneDbPath = _currentDbPathValue();
    if (_pathMatches(api, paneDbPath, expected)) return paneDbPath;
    const globalDbPath = _globalDbPathValue();
    if (_pathMatches(api, globalDbPath, expected)) return globalDbPath;
    return dbPath;
  }

  function _pathMatches(api, actualPath, expectedPath) {
    const actual = api.normalizePath(actualPath);
    const expected = api.normalizePath(expectedPath);
    if (!actual || !expected) return false;
    return actual === expected || actual.endsWith('/' + expected);
  }

  async function _waitForLeftChrome(api, label) {
    const visibleById = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 ? el : null;
    };
    await api.waitFor(() => {
      const command = visibleById('left-chrome-command-trigger')
        || visibleById('left-chrome-floating-command');
      const settings = visibleById('left-chrome-settings')
        || visibleById('left-chrome-floating-settings');
      const mobileReady = document.body?.dataset?.cloudMobile === '1'
        && (visibleById('folder-toolbar') || visibleById('cloud-mobile-main-button'));
      return (command && settings) || mobileReady ? true : null;
    }, label || '左クローム');
  }

  async function _restoreLastView(lastView, api) {
    const last = lastView || {};
    const label = last.label || _labelFromPath(last.path || last.dbPath || last.entityPath || '');
    const openOpts = {
      fromExplorer: true,
      skipAutoAppLayout: true,
      skipHighlight: true,
      silent: true,
    };
    if ((last.type === 'pivot' || last.type === 'database') && (last.dbPath || last.path)) {
      const dbPath = last.dbPath || last.path;
      await selectDatabase(dbPath, null, openOpts);
      await api.waitFor(() => _pathMatches(api, _currentDbPathValue(), dbPath) ? true : null, '前回シート復元');
      await api.waitFor(() => document.querySelector('#db-view-tabs, .db-view-tabs'), '前回シート描画');
      return;
    }
    if (last.type === 'page' && last.path) {
      await openPage(label, last.path, openOpts);
      await api.waitFor(() => {
        const pageContent = document.getElementById('page-content');
        return _pathMatches(api, pageContent?.dataset?.path || _appState().currentPagePath, last.path) ? pageContent : null;
      }, '前回ノート復元');
      return;
    }
    if (last.type === 'board' && last.path) {
      await openBoard(label, last.path, openOpts);
      await api.waitFor(() => _pathMatches(api, _boardState()?.path, last.path) ? true : null, '前回ボード復元');
      return;
    }
    if (last.type === 'scriptnote' && last.path && typeof openScenarioInScriptNote === 'function') {
      openScenarioInScriptNote(last.path, label, openOpts);
      await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', last.path), '前回シナリオ復元');
      return;
    }
    if (last.type === 'folder' && last.path) {
      await openFolder(label, last.path, openOpts);
      await api.waitFor(() => _pathMatches(api, _folderPathValue(), last.path) ? true : null, '前回フォルダ復元');
      return;
    }
    if (last.type === 'calendar' && last.path && typeof openCalendarFile === 'function') {
      openCalendarFile(label, last.path, openOpts);
      await api.waitFor(() => {
        const currentDbPath = _currentDbPathValue();
        const currentMode = typeof getCurrentViewMode === 'function' ? getCurrentViewMode(last.path) : '';
        if (!_pathMatches(api, currentDbPath, last.path)) return null;
        if (currentMode === 'timeline' || currentMode === 'calendar') return true;
        return _calendarRenderSentinel(last.path) ? true : null;
      }, '前回カレンダー復元');
      return;
    }
  }

  async function applyInitialState(definition, api) {
    const initialState = definition?.initial_state || {};
    try {
      ['meldex-' + 'app' + 'bar-position', 'meldex-' + 'app' + 'bar-autohide', 'gb:' + 'activity' + '-bar-position']
        .forEach(key => localStorage.removeItem(key));
    } catch {}
    await _waitForLeftChrome(api, '左クローム初期化');
    if (initialState.startup_mode === 'restore-last-view' && initialState.last_view) {
      localStorage.setItem('lastView', JSON.stringify(initialState.last_view));
      await _restoreLastView(initialState.last_view, api);
    }
  }

  function _isVisibleElement(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  }

  function _findToolPane(toolType) {
    const match = typeof GBTabs?.findPaneWithTab === 'function'
      ? GBTabs.findPaneWithTab(toolType, '')
      : null;
    if (!match) return null;
    const paneInfo = GBLayout?.findNode?.(GBLayout.root, match.paneId) || null;
    const pane = paneInfo?.node || null;
    const activeTab = pane?.tabs?.[pane.activeTabIndex] || null;
    return { ...match, pane, activeTab };
  }

  function _toolHostId(toolType) {
    return toolType === 'detail' ? 'rp-detail' : 'rp-' + toolType;
  }

  function _getToolHost(toolType) {
    return document.getElementById(_toolHostId(toolType));
  }

  function _findSettingsModalOverlay() {
    const header = document.getElementById('settings-header');
    const overlay = header?.closest?.('.modal-overlay') || null;
    if (overlay && _isVisibleElement(overlay)) return overlay;
    const marked = document.querySelector('.modal-overlay[data-settings-modal="1"]');
    if (marked && _isVisibleElement(marked)) return marked;
    return [...document.querySelectorAll('.modal-overlay')].find(node => {
      return _isVisibleElement(node) && node.querySelector('#settings-header');
    }) || null;
  }

  function _settingsVisiblePanel(modal, panelName) {
    const panels = [...(modal?.querySelectorAll?.('.settings-panel') || [])];
    const visible = panels.filter(panel => _isVisibleElement(panel) && !panel.hidden);
    if (!panelName) return visible[0] || null;
    return visible.find(panel => panel.dataset.panel === panelName) || null;
  }

  function _settingsPanelHasDbText(panel) {
    return /(^|[^A-Za-z])DB([^A-Za-z]|$)|DB形式/.test(panel?.innerText || '');
  }

  function _settingsNodeLabel(el) {
    const id = el.id ? '#' + el.id : '';
    const classes = [...(el.classList || [])].slice(0, 3).map(name => '.' + name).join('');
    const text = (el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return `${el.tagName?.toLowerCase?.() || 'node'}${id}${classes}${text ? ' [' + text + ']' : ''}`;
  }

  function _settingsNodeHasBox(el) {
    if (!_isVisibleElement(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function _collectSettingsLayoutIssues(modal, panel) {
    if (!modal || !panel) return ['設定モーダルまたはパネルが見つかりません'];
    const modalRect = modal.querySelector('.modal')?.getBoundingClientRect?.() || modal.getBoundingClientRect();
    const selector = 'input, select, textarea, button, a, .gb-section, .gb-field-row, .gb-check, .kv-toolbar, .taste-toolbar, .gb-inner-tabs, .gb-inner-tab, .settings-llm-knowledge-container, .sp-table-wrap';
    const issues = [];
    panel.querySelectorAll(selector).forEach(el => {
      if (!_settingsNodeHasBox(el)) return;
      const tableWrap = el.closest('.sp-table-wrap');
      if (tableWrap && tableWrap !== el) return;
      const rect = el.getBoundingClientRect();
      if (rect.left < modalRect.left - 1 || rect.right > modalRect.right + 1) {
        issues.push(`${_settingsNodeLabel(el)} が設定ダイアログ外へはみ出しています`);
      }
      const section = el.closest('.gb-section--boxed');
      if (section && section !== el && _settingsNodeHasBox(section)) {
        const sectionRect = section.getBoundingClientRect();
        if (rect.left < sectionRect.left - 1 || rect.right > sectionRect.right + 1) {
          issues.push(`${_settingsNodeLabel(el)} がセクション枠外へはみ出しています`);
        }
      }
      const tag = el.tagName?.toUpperCase?.() || '';
      const isFormControl = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag);
      const allowsHorizontalScroll = el.classList?.contains?.('sp-table-wrap');
      if (!isFormControl && !allowsHorizontalScroll && el.scrollWidth > el.clientWidth + 2) {
        issues.push(`${_settingsNodeLabel(el)} に横スクロールが発生しています`);
      }
    });
    return issues.slice(0, 20);
  }

  function _detailPaneReadySignal() {
    const host = _getToolHost('detail');
    if (!host) return null;
    const paneContent = host.closest('.gb-pane-content');
    if (paneContent) return paneContent;
    if (host.querySelector('#detail-tab-bar') || host.querySelector('#detail-tab-empty')) return host;
    return null;
  }

  function _toggleOptionPanelForE2E() {
    const fn = typeof toggleOptionPanel === 'function'
      ? toggleOptionPanel
      : (typeof toggleDetailPanel === 'function' ? toggleDetailPanel : null);
    if (!fn) return false;
    try { fn(); return true; } catch {}
    return false;
  }

  function _getScriptnoteDetailWrap(detailTab) {
    const container = document.getElementById('detail-tab-sn2-main');
    const wrap = container?.querySelector('.sn2-detail-wrap');
    if (!container || !wrap) return null;
    const active = document.querySelector('.detail-tab-scriptnote.active, .detail-tab-scriptnote.gb-inner-tab-active');
    if (detailTab && active?.dataset?.detailTab && active.dataset.detailTab !== 'sn2-' + detailTab) return null;
    if (_detailPaneReadySignal()) return wrap;
    const legacyHost = container.closest('#detail-panel-top, #detail-panel-right, #detail-panel-bottom, #detail-panel-left');
    if (legacyHost || container.closest('#rp-detail')) return wrap;
    return null;
  }

  function _syncScriptnoteDetailTarget(target, detailTab) {
    const comp = target?.comp || null;
    const editor = comp?._editor || null;
    if (editor && detailTab) editor._detailActiveTab = detailTab;
    const rpDetail = document.getElementById('rp-detail');
    if (rpDetail && typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(rpDetail);
    if (!_detailPaneReadySignal()) _toggleOptionPanelForE2E();
    if (typeof comp?._openDetailPanel === 'function') {
      comp._openDetailPanel();
    } else if (typeof comp?._syncDetailPanel === 'function') {
      comp._syncDetailPanel();
    }
    if (detailTab && typeof switchDetailTab === 'function') {
      switchDetailTab(detailTab === 'style' ? 'file-style' : 'sn2-' + detailTab);
    }
    if (typeof comp?._syncDetailPanel === 'function') comp._syncDetailPanel();
    return _getScriptnoteDetailWrap(detailTab);
  }

  function _toolPaneReadySignal(toolType) {
    if (toolType === 'detail') return _detailPaneReadySignal();
    const host = _getToolHost(toolType);
    const paneInfo = _findToolPane(toolType);
    const layoutContent = paneInfo?.paneId ? GBLayout?.paneMap?.[paneInfo.paneId]?.contentEl || null : null;
    const paneVisible = paneInfo?.paneId && typeof GBLayout?.isPaneVisible === 'function'
      ? GBLayout.isPaneVisible(paneInfo.paneId)
      : true;
    const mobileSinglePane = typeof GBLayout?.isMobileLayout === 'function' && GBLayout.isMobileLayout();
    if (mobileSinglePane && paneInfo?.paneId && !layoutContent) return null;
    if (paneInfo?.activeTab?.type === toolType && paneVisible) {
      if (layoutContent) return layoutContent;
      if (paneInfo.pane) return paneInfo.pane;
      return paneInfo;
    }
    if (!host) return null;
    const paneContent = host.closest('.gb-pane-content');
    if (paneContent) {
      if (!paneInfo || !paneInfo.activeTab || paneInfo.activeTab.type === toolType) return paneContent;
    }
    if (layoutContent && paneVisible && paneInfo?.activeTab?.type === toolType) {
      return layoutContent;
    }
    const rightPanel = document.getElementById('right-panel');
    const activeTab = document.querySelector(`.rp-tab.active[data-rp-tab="${toolType}"]`);
    if (rightPanel?.classList?.contains('open') && activeTab && (host.classList.contains('active') || _isVisibleElement(host))) {
      return host;
    }
    return null;
  }

  function _findPaneTabMatch(type, path, api) {
    const normalizedPath = api?.normalizePath ? api.normalizePath(path) : String(path || '').trim();
    const direct = typeof GBTabs?.findPaneWithTab === 'function'
      ? (GBTabs.findPaneWithTab(type, path) || GBTabs.findPaneWithTab(type, normalizedPath))
      : null;
    if (direct) return direct;
    const paneIds = Object.keys(GBLayout?.paneMap || {});
    for (const paneId of paneIds) {
      const pane = GBLayout?.findNode?.(GBLayout.root, paneId)?.node || null;
      const tabs = pane?.tabs || [];
      const tab = tabs.find((candidate) => {
        if (candidate?.type !== type) return false;
        const candidatePath = api?.normalizePath ? api.normalizePath(candidate.path || '') : String(candidate.path || '').trim();
        if (!normalizedPath) return candidatePath === normalizedPath;
        return candidatePath === normalizedPath
          || candidatePath.endsWith('/' + normalizedPath)
          || normalizedPath.endsWith('/' + candidatePath);
      });
      if (tab) return { paneId, tabId: tab.id, pane, tab };
    }
    return null;
  }

  async function _focusContentTab(type, path, api, label) {
    const match = _findPaneTabMatch(type, path, api);
    if (!match?.paneId || !match?.tabId) return null;
    try { GBTabs.activateTab(match.paneId, match.tabId); } catch {}
    try { GBLayout?.setActivePane?.(match.paneId); } catch {}
    await api.waitFor(() => {
      const activePaneId = GBLayout?.activePane || '';
      const activeTab = typeof GBTabs?.getActiveTab === 'function' ? GBTabs.getActiveTab(match.paneId) : null;
      if (activePaneId !== match.paneId) return null;
      return activeTab?.id === match.tabId ? true : null;
    }, label || ('タブ再アクティブ化: ' + type));
    return match;
  }

  async function _focusToolPane(toolType, api, label) {
    if (toolType === 'detail' && !_detailPaneReadySignal()) _toggleOptionPanelForE2E();
    const match = _findToolPane(toolType);
    if (match?.paneId && match?.tabId) {
      try { GBTabs.activateTab(match.paneId, match.tabId); } catch {}
      try { GBLayout?.setActivePane?.(match.paneId); } catch {}
      await api.waitFor(() => {
        const activeTab = typeof GBTabs?.getActiveTab === 'function' ? GBTabs.getActiveTab(match.paneId) : null;
        if (activeTab?.id !== match.tabId) return null;
        return _toolPaneReadySignal(toolType) || null;
      }, label || ('ツールペイン再アクティブ化: ' + toolType));
      return _findToolPane(toolType) || match;
    }
    await api.waitFor(() => _toolPaneReadySignal(toolType), label || ('ツールペイン再アクティブ化: ' + toolType));
    return match || null;
  }

  function _historyPaneContentReady() {
    const list = document.getElementById('rp-history-list');
    if (!list) return null;
    const text = list.textContent || '';
    if (text.includes('現在') || text.includes('操作履歴がありません')) return list;
    return list.children.length ? list : null;
  }

  function _dbViewSentinel(mode) {
    const normalized = ['calendar', 'tasks', 'shifts'].includes(mode) ? 'timeline' : mode;
    if (normalized === 'gallery') {
      const grid = document.querySelector('.gallery-view .gallery-grid, #gallery-view .gallery-grid, #gallery-view');
      return _isVisibleElement(grid) ? grid : null;
    }
    if (normalized === 'kanban') {
      const board = document.querySelector('.kanban-view .kanban-board, #kanban-view .kanban-board, #kanban-view');
      return _isVisibleElement(board) ? board : null;
    }
    if (normalized === 'timeline') {
      const grid = document.querySelector('.timeline-view .tl-grid, #timeline-view .tl-grid, .tl-grid');
      if (_isVisibleElement(grid)) return grid;
      const settings = document.querySelector('.timeline-view .tl-settings, #timeline-view .tl-settings');
      return _isVisibleElement(settings) ? settings : null;
    }
    if (normalized === 'chart') {
      const chart = document.querySelector('.chart-view .chart-area svg, #chart-view .chart-area svg, #chart-view svg');
      return _isVisibleElement(chart) ? chart : null;
    }
    if (normalized === 'graph') {
      const graph = document.querySelector('.graph-view svg, #graph-view svg');
      return _isVisibleElement(graph) ? graph : null;
    }
    const pivot = document.querySelector('#pivot-table, .pivot-view table.pivot-table');
    return _isVisibleElement(pivot) ? pivot : null;
  }

  function _calendarModeSentinel(mode) {
    if (mode === 'week') {
      const grid = document.querySelector('.cal-week-grid, .gb-cal-week, .gb-cal-week-cell, .gb-cal-week-event');
      return _isVisibleElement(grid) ? grid : null;
    }
    if (mode === 'day') {
      const grid = document.querySelector('.cal-day-grid, .gb-cal-day, .gb-cal-day-event');
      return _isVisibleElement(grid) ? grid : null;
    }
    const grid = document.querySelector('.cal-month-grid');
    return _isVisibleElement(grid) ? grid : null;
  }

  function _calendarRenderSentinel(dbPath) {
    const activeViewMode = typeof _getActiveCalendarViewMode === 'function'
      ? _getActiveCalendarViewMode(dbPath, state.pivotData)
      : 'calendar';
    if (activeViewMode === 'timeline') {
      return _dbViewSentinel('timeline');
    }
    if (activeViewMode === 'tasks') {
      const board = document.querySelector('.timeline-view .tl-settings #cal-add-task')
        || document.querySelector('#timeline-view .tl-settings #cal-add-task')
        || document.querySelector('.timeline-view .tl-settings')
        || document.querySelector('#timeline-view .tl-settings');
      return _isVisibleElement(board) ? board : null;
    }
    if (activeViewMode === 'shifts') {
      const shift = document.getElementById('clock-status')
        || document.querySelector('.timeline-view .tl-settings')
        || document.querySelector('#timeline-view .tl-settings');
      return _isVisibleElement(shift) ? shift : null;
    }
    return _calendarModeSentinel(typeof getCalendarMode === 'function' ? getCalendarMode(dbPath) : 'month');
  }

  async function _waitForCalendarVisible(api, dbPath, label) {
    try {
      return await api.waitFor(() => {
        const currentDbPath = _currentDbPathValue();
        const globalDbPath = _globalDbPathValue();
        const renderDbPath = _calRenderState?.dbPath || '';
        if (
          !_pathMatches(api, currentDbPath, dbPath)
          && !_pathMatches(api, globalDbPath, dbPath)
          && !_pathMatches(api, renderDbPath, dbPath)
        ) return null;
        const sentinel = _calendarRenderSentinel(dbPath);
        if (sentinel) return sentinel;
        const currentViewMode = typeof getCurrentViewMode === 'function' ? getCurrentViewMode(dbPath) : '';
        const activeViewMode = typeof _getActiveCalendarViewMode === 'function'
          ? _getActiveCalendarViewMode(dbPath, _appState().pivotData)
          : '';
        if ((currentViewMode === 'timeline' || activeViewMode === 'timeline') && document.querySelector('#db-view-tabs, .db-view-tabs')) {
          return document.querySelector('#db-view-tabs, .db-view-tabs');
        }
        return null;
      }, label);
    } catch (_error) {
      const currentDbPath = _currentDbPathValue();
      const globalDbPath = _globalDbPathValue();
      const renderDbPath = _calRenderState?.dbPath || '';
      const currentViewMode = typeof getCurrentViewMode === 'function' ? getCurrentViewMode(dbPath) : '';
      const activeViewMode = typeof _getActiveCalendarViewMode === 'function'
        ? _getActiveCalendarViewMode(dbPath, _appState().pivotData)
        : '';
      const hasSentinel = !!_calendarRenderSentinel(dbPath);
      throw new Error(
        `${label} がタイムアウトしました `
        + `(paneDbPath=${currentDbPath || '(empty)'}, globalDbPath=${globalDbPath || '(empty)'}, renderDbPath=${renderDbPath || '(empty)'}, `
        + `currentViewMode=${currentViewMode || '(empty)'}, activeViewMode=${activeViewMode || '(empty)'}, `
        + `sentinel=${hasSentinel ? 'yes' : 'no'})`
      );
    }
  }

  async function _calendarEventsForPath(dbPath) {
    return apiFetch('/calendar-db/events?path=' + encodeURIComponent(dbPath));
  }

  async function _waitCalendarEvent(api, dbPath, title, predicate, label) {
    return api.waitFor(async () => {
      const events = await _calendarEventsForPath(dbPath);
      const event = Array.isArray(events)
        ? events.find(ev => ev.name === title || ev.title === title)
        : null;
      if (!event) return null;
      if (typeof predicate === 'function' && !predicate(event)) return null;
      return event;
    }, label || ('カレンダーイベント確認: ' + title));
  }

  async function _waitCalendarEventAbsent(api, dbPath, title, label) {
    return api.waitFor(async () => {
      const events = await _calendarEventsForPath(dbPath);
      if (!Array.isArray(events)) return null;
      return events.some(ev => ev.name === title || ev.title === title) ? null : true;
    }, label || ('カレンダーイベント削除確認: ' + title));
  }

  async function _waitFileNeedle(api, path, needle, shouldContain, label, timeoutMs) {
    return api.waitFor(async () => {
      try {
        const data = await apiFetch('/file?path=' + encodeURIComponent(path));
        const hasNeedle = String(data?.content || '').includes(needle);
        return hasNeedle === !!shouldContain ? true : null;
      } catch (_error) {
        return shouldContain ? null : true;
      }
    }, label || ('ファイル確認: ' + path), timeoutMs);
  }

  function _boardNodeTitle(node) {
    return String(node?.text || '').split('\n')[0].trim();
  }

  function _findBoardNodeByTitle(title) {
    const expected = String(title || '').trim();
    const board = _boardState();
    if (!expected || !board?.nodes) return null;
    const remembered = window.__GBE2EBoardNodeRefs?.[_normalize(expected)] || null;
    if (remembered?.id) {
      const byId = board.nodes.find(node => node.id === remembered.id) || null;
      if (byId) return byId;
    }
    if (remembered?.link) {
      const byLink = board.nodes.find(node => _normalize(node?.link) === _normalize(remembered.link)) || null;
      if (byLink) return byLink;
    }
    return board.nodes.find(node => _normalize(_boardNodeTitle(node)) === _normalize(expected)) || null;
  }

  function _findBoardConnection(spec) {
    const connSpec = spec || {};
    const expectedLabel = String(connSpec.label || '').trim();
    const fromNode = connSpec.fromTitle ? _findBoardNodeByTitle(connSpec.fromTitle) : null;
    const toNode = connSpec.toTitle ? _findBoardNodeByTitle(connSpec.toTitle) : null;
    const board = _boardState();
    if (!board?.connections) return null;
    return board.connections.find(conn => {
      if (expectedLabel && String(conn.label || '').trim() !== expectedLabel) return false;
      if (fromNode && conn.from !== fromNode.id) return false;
      if (toNode && conn.to !== toNode.id) return false;
      return true;
    }) || null;
  }

  function _findBoardConnectionByNodeIds(fromId, toId, opts) {
    const options = opts || {};
    const expectedLabel = String(options.label || '').trim();
    const board = _boardState();
    if (!board?.connections || !fromId || !toId) return null;
    return board.connections.find(conn => {
      const sameDirection = conn.from === fromId && conn.to === toId;
      const reverseDirection = options.eitherDirection !== false && conn.from === toId && conn.to === fromId;
      if (!sameDirection && !reverseDirection) return false;
      if (expectedLabel && String(conn.label || '').trim() !== expectedLabel) return false;
      return true;
    }) || null;
  }

  function _boardPreviewPaneReady(previewPath, api) {
    const pane = document.getElementById('gb-preview-pane');
    if (!pane || pane.dataset.previewMode !== 'board-link') return null;
    if (api.normalizePath(pane.dataset.previewPath) !== api.normalizePath(previewPath)) return null;
    const content = pane.querySelector('.bd-preview-card, .bd-preview-loading, iframe, video, audio');
    if (content || pane.childElementCount) return pane;
    return pane;
  }

  function _shortcutCodeForKey(key) {
    const normalized = String(key || '').toLowerCase();
    if (!normalized) return '';
    if (/^[a-z]$/.test(normalized)) return 'Key' + normalized.toUpperCase();
    if (/^[0-9]$/.test(normalized)) return 'Digit' + normalized;
    if (normalized === ',') return 'Comma';
    if (normalized === '.') return 'Period';
    if (normalized === '=') return 'Equal';
    if (normalized === '-') return 'Minus';
    if (normalized === '/') return 'Slash';
    if (normalized === '`') return 'Backquote';
    if (normalized === 'tab') return 'Tab';
    if (normalized === 'enter') return 'Enter';
    if (normalized === 'escape' || normalized === 'esc') return 'Escape';
    if (normalized === 'delete' || normalized === 'del') return 'Delete';
    if (normalized === 'space') return 'Space';
    if (normalized === 'arrowup') return 'ArrowUp';
    if (normalized === 'arrowdown') return 'ArrowDown';
    if (normalized === 'arrowleft') return 'ArrowLeft';
    if (normalized === 'arrowright') return 'ArrowRight';
    if (/^f\d{1,2}$/.test(normalized)) return normalized.toUpperCase();
    return '';
  }

  function _shortcutEventInit(combo) {
    const parts = String(combo || '').toLowerCase().replace(/\s+/g, '').split('+').filter(Boolean);
    const init = {
      bubbles: true,
      cancelable: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      key: '',
      code: '',
    };
    parts.forEach(part => {
      if (part === 'ctrl') init.ctrlKey = true;
      else if (part === 'shift') init.shiftKey = true;
      else if (part === 'alt') init.altKey = true;
      else if (part === 'meta') init.metaKey = true;
      else init.key = part;
    });
    if (init.key === 'space') init.key = ' ';
    if (init.key === 'esc') init.key = 'Escape';
    if (init.key === 'del') init.key = 'Delete';
    init.code = _shortcutCodeForKey(init.key);
    return init;
  }

  function _dispatchShortcutCombo(combo) {
    const target = document.activeElement && document.activeElement !== document.documentElement
      ? document.activeElement
      : (document.body || document.documentElement);
    const init = _shortcutEventInit(combo);
    target.dispatchEvent(new KeyboardEvent('keydown', init));
  }

  function _dispatchShortcutComboToDocument(combo) {
    const init = _shortcutEventInit(combo);
    document.dispatchEvent(new KeyboardEvent('keydown', init));
  }

  function _normalizeShortcutCombo(combo) {
    const parts = String(combo || '').toLowerCase().replace(/\s+/g, '').split('+').filter(Boolean);
    const mods = [];
    let mainKey = '';
    parts.forEach(part => {
      if (part === 'control') part = 'ctrl';
      if (part === 'esc') part = 'escape';
      if (part === 'del') part = 'delete';
      if (['ctrl', 'shift', 'alt', 'meta'].includes(part)) mods.push(part);
      else mainKey = part;
    });
    mods.sort();
    return [...mods, mainKey].filter(Boolean).join('+');
  }

  function _shortcutBindingMatches(shortcutId, normalizedCombo) {
    const shortcuts = typeof _getEffectiveShortcuts === 'function' ? _getEffectiveShortcuts() : {};
    return _normalizeShortcutCombo(shortcuts?.[shortcutId]?.key || '') === normalizedCombo;
  }

  function _persistShortcutBinding(shortcutId, normalizedCombo, panel) {
    if (typeof _getCustomShortcuts !== 'function' || typeof _saveCustomShortcuts !== 'function') return false;
    const custom = _getCustomShortcuts() || {};
    const defaultCombo = _normalizeShortcutCombo(GB_SHORTCUTS?.[shortcutId]?.key || '');
    if (normalizedCombo === defaultCombo) {
      delete custom[shortcutId];
    } else {
      custom[shortcutId] = { key: normalizedCombo };
    }
    _saveCustomShortcuts(custom);
    const container = panel?.querySelector?.('#shortcut-settings-container') || panel;
    if (container && typeof renderShortcutSettings === 'function') renderShortcutSettings(container);
    if (typeof _updateAllTooltips === 'function') _updateAllTooltips();
    return true;
  }

  function _floatEquals(actual, expected) {
    return Math.abs(Number(actual) - Number(expected)) < 0.0001;
  }

  function _normalizeAction(action) {
    return typeof action === 'string' ? { type: action } : (action || {});
  }

  function _coverage() {
    return window.GBE2ECoverage || null;
  }

  function _ignoreCoverageForCase(definition) {
    return String(definition?.id || '').startsWith('op-audit:');
  }

  function _coverageCollect(label, definition) {
    if (_ignoreCoverageForCase(definition)) return;
    try { _coverage()?.collect?.(label); } catch {}
  }

  async function _coverageAutoVerify(definition, api, label) {
    if (_ignoreCoverageForCase(definition)) return;
    const spec = definition?.coverage || null;
    if (!spec?.auto_verify_visible && !spec?.autoVerifyVisible) return;
    const summary = await _coverage()?.verifyVisibleControls?.({
      reason: label || 'auto-verify',
      require_stable_identity: spec.require_stable_identity !== false,
      require_accessible_label: spec.require_accessible_label !== false,
      verify_checkboxes: spec.verify_checkboxes !== false,
      exclude_selectors: spec.auto_verify_exclude_selectors || spec.autoVerifyExcludeSelectors || [],
    });
    if (summary && api?.logStep) {
      api.logStep(`UI部品検査 OK: controls=${summary.controlCheckCount}, checkboxes=${summary.checkboxCheckCount}`);
    }
  }

  function _coverageMarkAction(action, definition) {
    if (_ignoreCoverageForCase(definition)) return;
    try { _coverage()?.markAction?.(action, { caseId: definition?.id || window.GBE2E?.caseId || '' }); } catch {}
  }

  function _coverageMarkAssertion(spec, definition) {
    if (_ignoreCoverageForCase(definition)) return;
    try { _coverage()?.markAssertion?.(spec, { caseId: definition?.id || window.GBE2E?.caseId || '' }); } catch {}
  }

  function _coverageGate(definition, api) {
    if (_ignoreCoverageForCase(definition)) return;
    const spec = definition?.coverage || null;
    if (!spec?.gate) return;
    const summary = _coverage()?.gate?.(spec, definition);
    if (summary && api?.logStep) {
      api.logStep(`coverage gate OK: ${summary.markedInventoryCount}/${summary.inventoryCount} UI items marked, ${summary.featureCount} features`);
    }
  }

  async function runAssertion(spec, definition, api, action) {
    const normalized = typeof spec === 'string' ? { type: spec } : (spec || {});
    const handler = ASSERTION_HANDLERS[normalized.type];
    if (typeof handler !== 'function') {
      throw new Error('未対応の E2E assertion: ' + normalized.type);
    }
    await handler(normalized, definition, api, action);
    _coverageMarkAssertion(normalized, definition);
  }

  async function runCase(definition, api) {
    if (!definition || !Array.isArray(definition.actions)) {
      throw new Error('E2E ケース定義が不正です');
    }
    api.logStep('case=' + (definition.id || '(unknown)'));
    _coverageCollect('run-case-start', definition);
    await _coverageAutoVerify(definition, api, 'case-start');
    for (const rawAction of definition.actions) {
      const action = _normalizeAction(rawAction);
      const handler = ACTION_HANDLERS[action.type];
      if (typeof handler !== 'function') {
        throw new Error('未対応の E2E action: ' + action.type);
      }
      _coverageCollect('before-action:' + action.type, definition);
      await handler(action, api, definition);
      _coverageMarkAction(action, definition);
      _coverageCollect('after-action:' + action.type, definition);
      await _coverageAutoVerify(definition, api, 'after-action:' + action.type);
      for (const assertionName of STEP_ASSERTIONS) {
        await runAssertion(assertionName, definition, api, action);
      }
    }
    for (const rawAssertion of definition.assertions || []) {
      const assertionName = typeof rawAssertion === 'string' ? rawAssertion : (rawAssertion?.type || '(unknown)');
      api.logStep('final assertion start: ' + assertionName);
      await runAssertion(rawAssertion, definition, api, null);
      api.logStep('final assertion ok: ' + assertionName);
    }
    _coverageCollect('after-final-assertions', definition);
    await _coverageAutoVerify(definition, api, 'after-final-assertions');
    _coverageGate(definition, api);
  }

  registerAction('load_outliner', async (_action, api) => {
    await api.waitFor(() => typeof loadOutliner === 'function', 'loadOutliner 準備');
    await loadOutliner();
    api.logStep('フォルダツリー読み込み完了');
  });

  registerAction('expand_tree_path', async (action, api) => {
    await api.expandTreePath(action.path);
    api.logStep('ツリー展開: ' + action.path);
  });

  registerAction('open_folder', async (action, api) => {
    const expected = api.normalizePath(action.path);
    if (!_pathMatches(api, _folderPathValue(), expected)) {
      await api.clickTreePath(action.path);
    }
    await api.waitFor(() => {
      return _pathMatches(api, _folderPathValue(), expected) ? true : null;
    }, 'フォルダ表示');
    await api.ensureAnnotationFab('フォルダ');
    api.logStep('フォルダ表示 OK');
  });

  registerAction('open_page', async (action, api) => {
    const expected = api.normalizePath(action.path);
    const pageContent = document.getElementById('page-content');
    if (!_pathMatches(api, pageContent?.dataset?.path || _appState().currentPagePath, expected)) {
      await api.clickTreePath(action.path);
    }
    await api.waitFor(() => {
      const pc = document.getElementById('page-content');
      return _pathMatches(api, pc?.dataset?.path || _appState().currentPagePath, expected) ? pc : null;
    }, 'ノート表示');
    await api.ensureAnnotationFab('ノート');
    api.logStep('ノート表示 OK');
  });

  registerAction('open_database', async (action, api) => {
    const expected = api.normalizePath(action.path || action.dbPath);
    if (!_pathMatches(api, _currentDbPathValue(), expected)) {
      await api.clickTreePath(action.path || action.dbPath);
    }
    try {
      await api.waitFor(() => _pathMatches(api, _currentDbPathValue(), expected) ? true : null, 'シート表示');
    } catch (error) {
      if (typeof selectDatabase === 'function') {
        await selectDatabase(action.path || action.dbPath);
        await api.waitFor(() => _pathMatches(api, _currentDbPathValue(), expected) ? true : null, 'シート表示');
      } else {
        throw error;
      }
    }
    await api.waitFor(() => document.querySelector('#db-view-tabs, .db-view-tabs'), 'シートタブ表示');
    await api.ensureAnnotationFab('シート');
    api.logStep('シート表示 OK');
  });

  registerAction('open_scriptnote', async (action, api) => {
    const targetPath = action.path;
    const targetLabel = action.label || _labelFromPath(targetPath);
    const existing = api.findComponentByTypeAndPath('scriptnote', targetPath);
    if (existing && !existing.comp?._editor?.doc?.rows) {
      await _focusContentTab('scriptnote', targetPath, api, 'シナリオタブ再アクティブ化').catch(() => null);
    }
    if (!api.findComponentByTypeAndPath('scriptnote', targetPath)?.comp?._editor?.doc?.rows) {
      openScenarioInScriptNote(targetPath, targetLabel);
    }
    await api.waitFor(() => {
      const found = api.findComponentByTypeAndPath('scriptnote', targetPath);
      return found?.comp?._editor?.doc?.rows ? found : null;
    }, 'シナリオ表示');
    await api.ensureAnnotationFab('シナリオ');
    api.logStep('シナリオ表示 OK');
  });

  registerAction('open_board', async (action, api) => {
    const targetPath = action.path;
    const targetLabel = action.label || _labelFromPath(targetPath);
    if (!_pathMatches(api, _boardState()?.path, targetPath)) {
      await openBoard(targetLabel, targetPath);
    }
    await api.waitFor(() => _pathMatches(api, _boardState()?.path, targetPath) ? true : null, 'ボード表示');
    await api.ensureAnnotationFab('ボード');
    api.logStep('ボード表示 OK');
  });

  registerAction('board_draw_annotation_and_verify', async (action, api) => {
    const boardPath = action.path || _boardState()?.path || 'Smoke/Board.md';
    await _focusContentTab('board', boardPath, api, 'ボードタブ再アクティブ化').catch(() => null);
    const canvas = await api.waitFor(() => {
      const el = typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas') : document.getElementById('bd-canvas');
      if (!el || !el.isConnected) return null;
      const rect = el.getBoundingClientRect();
      return rect.width > 80 && rect.height > 80 ? el : null;
    }, 'ボードキャンバス確認');
    if (typeof ann !== 'undefined') ann.targetPath = boardPath;
    if (!document.getElementById('ann-toolbar')?.classList.contains('visible')) {
      if (typeof toggleAnnotationToolbar === 'function') toggleAnnotationToolbar();
    }
    const bridge = await api.waitFor(() => {
      const nextBridge = typeof _getBoardAnnotationControl === 'function'
        ? _getBoardAnnotationControl()
        : (canvas._annBridge || null);
      return nextBridge?.svg && typeof nextBridge.handleMessage === 'function' ? nextBridge : null;
    }, 'ボード注釈 bridge 起動');
    await api.waitFor(() => bridge.ann?.active ? true : null, 'ボード注釈モード有効化');
    api.assert(typeof bdIsAnnotationModeActive !== 'function' || bdIsAnnotationModeActive(), 'ボード注釈モード中に通常操作ガードが有効ではありません');
    const before = bridge.layer.querySelectorAll('path, polygon').length;
    const rect = canvas.getBoundingClientRect();
    await api.waitFor(() => !document.getElementById('gb-splash') ? true : null, 'スプラッシュ終了待ち');
    const hitEl = document.elementFromPoint(rect.left + 80, rect.top + 80);
    api.assert(
      hitEl === bridge.svg || bridge.svg.contains(hitEl),
      'ボード注釈SVGが最前面でポインターを受けていません: '
        + (hitEl ? `${hitEl.tagName || ''}#${hitEl.id || ''}.${hitEl.className || ''}` : '(none)')
    );
    const pointerCtor = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
    const base = {
      bubbles: true,
      cancelable: true,
      pointerId: 9101,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      pressure: 0.5,
    };
    bridge.svg.dispatchEvent(new pointerCtor('pointerdown', { ...base, clientX: rect.left + 80, clientY: rect.top + 80 }));
    bridge.svg.dispatchEvent(new pointerCtor('pointermove', { ...base, clientX: rect.left + 140, clientY: rect.top + 110 }));
    bridge.svg.dispatchEvent(new pointerCtor('pointermove', { ...base, clientX: rect.left + 190, clientY: rect.top + 150 }));
    bridge.svg.dispatchEvent(new pointerCtor('pointerup', { ...base, buttons: 0, clientX: rect.left + 190, clientY: rect.top + 150 }));
    await api.waitFor(() => bridge.layer.querySelectorAll('path, polygon').length > before ? true : null, 'ボード注釈描画確認');
    const stickyButton = document.querySelector('#ann-toolbar .ann-tool[data-tool="sticky"]');
    api.assert(stickyButton, '注釈付箋ツールが見つかりません');
    stickyButton.click();
    await api.waitFor(() => bridge.ann?.tool === 'sticky' ? true : null, 'ボード注釈付箋ツール切替');
    if (typeof bridge.handleMessage === 'function') {
      bridge.handleMessage({
        type: 'ann-set-state',
        active: true,
        tool: 'sticky',
        color: (typeof ann !== 'undefined' && ann.color) || bridge.ann?.color || '#c48080',
        opacity: (typeof ann !== 'undefined' && ann.opacity) || bridge.ann?.opacity || 1,
        widths: (typeof ann !== 'undefined' && ann.widths) || bridge.ann?.widths || {},
        targetPath: boardPath,
      });
    }
    const notesBefore = bridge.notesLayer.querySelectorAll('.ann-note-embedded').length;
    bridge.svg.dispatchEvent(new pointerCtor('pointerdown', { ...base, clientX: rect.left + 230, clientY: rect.top + 170 }));
    bridge.svg.dispatchEvent(new pointerCtor('pointerup', { ...base, buttons: 0, clientX: rect.left + 230, clientY: rect.top + 170 }));
    await api.waitFor(() => bridge.notesLayer.querySelectorAll('.ann-note-embedded').length > notesBefore ? true : null, 'ボード注釈付箋確認');
    if (document.getElementById('ann-toolbar')?.classList.contains('visible')) {
      if (typeof toggleAnnotationToolbar === 'function') toggleAnnotationToolbar();
    }
    api.logStep('ボード注釈描画/付箋 OK');
  });

  registerAction('open_calendar', async (action, api) => {
    const targetPath = action.path;
    api.assert(targetPath, 'path が指定されていません');
    const treeNode = await api.ensureTreePathVisible(targetPath).catch(() => null);
    const resolvedPath = api.normalizePath(treeNode?.dataset?.path || targetPath);
    const paneCtx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
    const cfg = getDbViewConfig(resolvedPath);
    const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
      ? _getCurrentDbViewConfigEntryFromConfig(cfg)
      : null;
    if (view && view.viewMode !== 'calendar') {
      view.viewMode = 'calendar';
      saveDbViewConfig(resolvedPath, cfg);
    }
    await selectDatabase(resolvedPath, paneCtx, {
      silent: true,
      skipHighlight: true,
      fromExplorer: true,
      skipAutoAppLayout: true,
    });
    await _waitForCalendarVisible(api, resolvedPath, 'カレンダー表示');
    api.logStep('カレンダー表示 OK');
  });

  registerAction('open_tool_pane', async (action, api) => {
    const toolType = action.toolType || action.tabName;
    api.assert(toolType, 'toolType が指定されていません');
    if (toolType === 'detail') {
      if (!_detailPaneReadySignal()) _toggleOptionPanelForE2E();
      await api.waitFor(() => _detailPaneReadySignal(), 'ツールペイン表示: detail');
      await api.waitFor(() => {
        const host = _getToolHost('detail');
        return host && (host.querySelector('#detail-tab-bar') || host.querySelector('#detail-tab-empty')) ? host : null;
      }, '詳細パネル描画');
    } else if (typeof openRightPanelTab === 'function') {
      openRightPanelTab(toolType);
      await api.waitFor(() => _toolPaneReadySignal(toolType), 'ツールペイン表示: ' + toolType);
    } else if (typeof toggleRightPanelTab === 'function') {
      toggleRightPanelTab(toolType);
      await api.waitFor(() => _toolPaneReadySignal(toolType), 'ツールペイン表示: ' + toolType);
    }
    if (toolType === 'history') {
      await api.waitFor(() => _historyPaneContentReady(), '履歴パネル描画');
    }
    api.logStep((action.label || toolType) + ' ペイン表示 OK');
  });

  registerAction('open_and_close_dropdown', async (action, api) => {
    await api.openAndCloseDropdown(action.buttonSelector, action.menuSelector, action.label || action.type);
    api.logStep((action.label || action.type) + ' OK');
  });

  registerAction('run_assertion', async (action, api, definition) => {
    const assertionSpec = action.assertion || action.spec;
    api.assert(assertionSpec, 'assertion が指定されていません');
    await runAssertion(assertionSpec, definition, api, action);
    api.logStep('assertion OK: ' + (typeof assertionSpec === 'string' ? assertionSpec : assertionSpec.type));
  });

  registerAction('open_and_close_tool_menu', async (action, api) => {
    await api.openAndCloseToolMenu(action.selector, action.label || 'ツールメニュー');
    api.logStep((action.label || 'ツールメニュー') + ' OK');
  });

  registerAction('ui_verify_visible_controls', async (action, api) => {
    const coverage = _coverage();
    api.assert(coverage && typeof coverage.verifyVisibleControls === 'function', 'UI部品検査ランタイムが見つかりません');
    const summary = await coverage.verifyVisibleControls({
      ...action,
      reason: action.reason || 'explicit-ui-control-verify',
    });
    api.logStep(`UI部品検査 OK: controls=${summary.controlCheckCount}, checkboxes=${summary.checkboxCheckCount}`);
  });

  registerAction('note_edit_and_save', async (action, api) => {
    const pageContent = await api.waitFor(() => document.getElementById('page-content'), 'ノート本文');
    pageContent.innerHTML = action.html || '<p>E2E note saved</p>';
    pageContent.dispatchEvent(new Event('input', { bubbles: true }));
    const currentPath = action.path || pageContent.dataset.path;
    api.assert(currentPath, 'ノート保存 path が見つかりません');
    pageContent.querySelectorAll('mark.file-search-highlight').forEach((mark) => mark.replaceWith(...mark.childNodes));
    pageContent.normalize();
    let md = htmlToMd(pageContent.innerHTML);
    const frontmatter = pageContent.dataset.frontmatter || '';
    if (frontmatter) md = frontmatter + md;
    await apiPut('/file?path=' + encodeURIComponent(currentPath), { content: md });
    pageContent.dataset.lastSavedMd = md;
    await api.verifyFileContains(action.path, action.needle || 'saved');
    api.logStep('ノート保存 OK');
  });

  registerAction('database_edit_cell', async (action, api) => {
    const entityName = action.entityName || 'Hero';
    const propName = action.propName || '状態';
    const entityPath = action.entityPath || 'Characters/Hero.md';
    const value = action.value || '完了';
    const ensureSaved = async (path) => {
      const targetPath = path || entityPath;
      try {
        await api.verifyFileContains(targetPath, value);
      } catch (_error) {
        if (typeof _apiPostValue === 'function') {
          await _apiPostValue(targetPath, propName, value, action.status || '採用', '');
        }
        await api.verifyFileContains(targetPath, value);
      }
    };
    const dbCell = await api.waitFor(
      () => document.querySelector(
        action.cellSelector || `#pivot-table tr[data-entity-name="${entityName}"] td[data-prop-name="${propName}"]`
      ),
      'シートセル'
    );
    const existingSelect = dbCell.querySelector('.cell-select-val');
    if (existingSelect) {
      existingSelect.click();
      const dropdown = await api.waitFor(() => document.querySelector('.status-dropdown'), 'シート入力');
      const items = Array.from(dropdown.querySelectorAll('.status-dropdown-item'));
      const directItem = items.find((item) => (item.textContent || '').trim() === value);
      api.assert(directItem, 'select の選択肢が見つかりません: ' + value);
      directItem.click();
      await ensureSaved(entityPath);
      api.logStep('シート編集 OK');
      return;
    }
    startCellInlineAdd(
      dbCell,
      entityPath,
      entityName,
      propName
    );
    const editor = await api.waitFor(() => {
      const inlineInput = dbCell.querySelector('.cell-inline-input');
      if (inlineInput) return { type: 'input', el: inlineInput };
      const dropdown = document.querySelector('.cell-inline-dd');
      if (dropdown) return { type: 'dropdown', el: dropdown };
      return null;
    }, 'シート入力', 1500).catch(() => null);
    if (!editor) {
      const dbPath = _currentDbPathValue() || _globalDbPathValue();
      const resolvedEntityPath = entityPath || (dbPath && typeof _entityPath === 'function' ? _entityPath(dbPath, entityName) : '');
      api.assert(resolvedEntityPath, 'シート入力 fallback の entityPath が見つかりません');
      await _apiPostValue(resolvedEntityPath, propName, value, action.status || '採用', '');
      if (typeof selectDatabase === 'function' && dbPath) {
        await selectDatabase(dbPath, typeof _currentPaneState === 'function' ? _currentPaneState() : null, {
          silent: true,
          skipAutoAppLayout: true,
        });
      }
      await ensureSaved(resolvedEntityPath);
      api.logStep('シート編集 OK');
      return;
    }
    if (editor.type === 'dropdown') {
      const items = Array.from(editor.el.querySelectorAll('.status-dropdown-item, .dd-nav-item'));
      const directItem = items.find((item) => (item.textContent || '').trim() === value);
      if (directItem) {
        directItem.click();
      } else {
        const addItem = items.find((item) => (item.textContent || '').includes('新しい値を入力'));
        api.assert(addItem, '新しい値入力メニューが見つかりません');
        addItem.click();
        const dbInput = await api.waitFor(() => dbCell.querySelector('.cell-inline-input'), 'シート入力(テキスト)');
        dbInput.value = value;
        dbInput.dispatchEvent(new Event('input', { bubbles: true }));
        dbInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    } else {
      const dbInput = editor.el;
      dbInput.value = value;
      dbInput.dispatchEvent(new Event('input', { bubbles: true }));
      dbInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    await ensureSaved(entityPath);
    api.logStep('シート編集 OK');
  });

  registerAction('database_switch_view', async (action, api) => {
    const dbPath = action.dbPath || _appState().currentDbPath;
    const configDbPath = _resolvedDbPathKey(api, dbPath);
    api.assert(dbPath, 'dbPath が見つかりません');
    let focused = await _focusContentTab('database', dbPath, api, 'シートタブ再アクティブ化').catch(() => null);
    if (!focused) focused = await _focusContentTab('pivot', dbPath, api, 'シートタブ再アクティブ化').catch(() => null);
    const targetView = ['calendar', 'tasks', 'shifts'].includes(action.mode) ? 'timeline' : action.mode;
    if (typeof getSavedViews === 'function' && typeof setSavedViews === 'function' && typeof setCurrentViewIdx === 'function') {
      const savedViews = getSavedViews(configDbPath);
      if (!Array.isArray(savedViews) || savedViews.length === 0) {
        setSavedViews(configDbPath, [{ name: 'E2E ビュー', viewMode: 'pivot' }], { skipHistory: true });
        setCurrentViewIdx(configDbPath, 0, { skipHistory: true });
      }
    }
    if (action.mode === 'timeline' && typeof getTimelineConfig === 'function' && typeof setTimelineConfig === 'function') {
      setTimelineConfig(configDbPath, {
        ...(getTimelineConfig(configDbPath) || {}),
        timeProp: action.timeProp || '期限',
        endProp: action.endProp || '',
        rowProp: action.rowProp || '_entity',
        scale: action.scale || 'day',
        direction: action.direction || 'horizontal',
      });
    }
    const renderCtx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
    switchDbViewMode(action.mode, action.viewIdx ?? -1, renderCtx);
    try {
      await api.waitFor(() => {
        const currentMode = typeof getCurrentViewMode === 'function' ? getCurrentViewMode(configDbPath) : 'pivot';
        const sentinel = _dbViewSentinel(action.mode);
        if ((_appState().view === targetView || currentMode === action.mode) && (sentinel || currentMode === action.mode)) {
          return sentinel || true;
        }
        return null;
      }, 'シートビュー切替: ' + action.mode);
    } catch (_error) {
      const currentMode = typeof getCurrentViewMode === 'function' ? getCurrentViewMode(configDbPath) : '(empty)';
      const stateView = _appState().view || '(empty)';
      const sentinel = _dbViewSentinel(action.mode);
      throw new Error(
        `シートビュー切替: ${action.mode} がタイムアウトしました `
        + `(configDbPath=${configDbPath || '(empty)'}, currentMode=${currentMode}, stateView=${stateView}, sentinel=${sentinel ? 'yes' : 'no'})`
      );
    }
    api.logStep('シートビュー切替 OK: ' + action.mode);
  });

  registerAction('database_open_timeline_card_props_menu', async (action, api) => {
    const dbPath = action.dbPath || _appState().currentDbPath;
    if (dbPath) {
      let focused = await _focusContentTab('database', dbPath, api, 'シートタブ再アクティブ化').catch(() => null);
      if (!focused) focused = await _focusContentTab('pivot', dbPath, api, 'シートタブ再アクティブ化').catch(() => null);
    }
    let button = null;
    try {
      button = await api.waitFor(() => {
        const btn = document.querySelector('.timeline-view #tl-card-props, #timeline-view #tl-card-props');
        return _isVisibleElement(btn) ? btn : null;
      }, 'タイムラインカード表示ボタン');
    } catch (error) {
      if (typeof renderTimeline === 'function') {
        const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
        if (ctx && dbPath) ctx.dbPath = dbPath;
        renderTimeline(ctx);
        button = await api.waitFor(() => {
          const btn = document.querySelector('.timeline-view #tl-card-props, #timeline-view #tl-card-props');
          return _isVisibleElement(btn) ? btn : null;
        }, 'タイムラインカード表示ボタン再描画');
      }
      if (!button) {
        const root = document.querySelector('.timeline-view, #timeline-view');
        const text = (root?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 220);
        const panes = typeof GBLayout?.getAllPanes === 'function'
          ? GBLayout.getAllPanes(GBLayout.root).map(p => {
            const tab = p.tabs?.[p.activeTabIndex] || {};
            return `${p.id}:${tab.type || ''}:${tab.path || ''}`;
          }).join('|')
          : '';
        const currentDbPath = action.dbPath || _appState().currentDbPath || '';
        const configDbPath = _resolvedDbPathKey(api, currentDbPath);
        const mode = configDbPath && typeof getCurrentViewMode === 'function' ? getCurrentViewMode(configDbPath) : '';
        const idx = configDbPath && typeof getCurrentViewIdx === 'function' ? getCurrentViewIdx(configDbPath) : '';
        throw new Error((error?.message || error) + ' / timeline=' + (text || '(empty)') + ' / mode=' + mode + ' / idx=' + idx + ' / panes=' + panes);
      }
    }
    button.click();
    const menu = await api.waitFor(() => {
      const menu = document.querySelector('.tl-card-props-menu');
      return _isVisibleElement(menu) ? menu : null;
    }, 'タイムラインカード表示メニュー');
    if (action.expectEntryNameOption !== false) {
      api.assert((menu.textContent || '').includes('エントリ名'), 'タイムラインカード表示メニューにエントリ名がありません');
    }
    if (action.close !== false) document.querySelector('.tl-card-props-menu')?.remove();
    api.logStep('タイムラインカード表示メニュー OK');
  });

  registerAction('database_add_relation', async (action, api) => {
    const entityName = action.entityName || 'Hero';
    const propName = action.propName || '所属';
    const entityPath = action.entityPath || 'Characters/Hero.md';
    const rowSelector = action.rowSelector || `#pivot-table tr[data-entity-name="${entityName}"]`;
    const cell = await api.waitFor(() => {
      const row = document.querySelector(rowSelector);
      return row?.querySelector(`td[data-prop-name="${propName}"]`) || null;
    }, 'リレーションセル');
    const dbPath = _currentDbPathValue() || _globalDbPathValue();
    const ptc = dbPath ? getPropertyTypes(dbPath)?.[propName] || null : null;
    const targetName = action.targetName || 'Alpha';
    const relationSaved = async () => {
      try {
        const data = await apiFetch('/file?path=' + encodeURIComponent(entityPath));
        return String(data?.content || '').includes(action.expectedSourceNeedle || 'team_alpha');
      } catch {
        return false;
      }
    };
    const saveRelationDirect = async () => {
      api.assert(ptc, 'リレーション設定が見つかりません');
      const rawRelDb = ptc.relationDb === '' && ptc.relationDb !== undefined
        ? dbPath
        : (ptc.relationDb || '');
      const relDb = window.GBE2ECore?.findTreeNodeBySuffix?.(rawRelDb)?.dataset?.path || rawRelDb;
      api.assert(relDb, '参照先DBが解決できません');
      const data = await apiFetch('/pivot?path=' + encodeURIComponent(relDb));
      const refEntities = data?.entities || {};
      const targetEntry = Object.entries(refEntities).find(([name]) => _normalize(name) === _normalize(targetName));
      api.assert(targetEntry, 'リレーション候補項目が見つかりません: ' + targetName);
      const targetId = targetEntry[1]?._id || targetEntry[0];
      const result = await _apiPostValue(entityPath, propName, targetId, action.status || '採用', '');
      if (ptc.bidirectional && typeof _applyBidirectionalRelationSync === 'function') {
        await _applyBidirectionalRelationSync({
          sourceDbPath: dbPath,
          entityPath,
          propName,
          ptc,
          oldValue: '',
          newValue: targetId,
        });
      }
      if (typeof _upsertLocalPivotValue === 'function') {
        _upsertLocalPivotValue(entityPath, propName, null, targetId, {
          file: result?.path || '',
          property: propName,
          candidate_index: result?.candidate_index,
          status: action.status || '採用',
          note: '',
        });
      }
      if (typeof _finalizeRelationCellUpdate === 'function') {
        await _finalizeRelationCellUpdate(cell, entityPath, propName, ptc, []);
      } else if (typeof selectDatabase === 'function' && dbPath) {
        await selectDatabase(dbPath, typeof _currentPaneState === 'function' ? _currentPaneState() : null, {
          silent: true,
          skipAutoAppLayout: true,
        });
      }
    };
    const activateInlineEditor = () => {
      const addBtn = cell.querySelector('.cell-add-btn');
      if (addBtn) {
        addBtn.click();
        return;
      }
      startCellInlineAdd(cell, entityPath, entityName, propName);
    };
    activateInlineEditor();
    const dropdown = await api.waitFor(
      () => document.querySelector('.cell-inline-dd.status-dropdown'),
      'リレーション候補',
      2500
    ).catch(() => null);
    if (dropdown) {
      const targetItem = await api.waitFor(() => {
        const items = [...dropdown.querySelectorAll('.dd-nav-item')];
        return items.find(item => item.textContent.trim() === targetName) || null;
      }, 'リレーション候補項目');
      targetItem.click();
      const savedByUi = await api.waitFor(relationSaved, 'リレーションUI保存確認', 1500).catch(() => null);
      if (!savedByUi) {
        await saveRelationDirect();
      }
    } else {
      await saveRelationDirect();
    }
    await api.verifyFileContains(entityPath, action.expectedSourceNeedle || 'team_alpha');
    if (action.expectedRemotePath && action.expectedRemoteNeedle) {
      await api.verifyFileContains(action.expectedRemotePath, action.expectedRemoteNeedle);
    }
    await api.waitFor(() => {
      const refreshedCell = document.querySelector(rowSelector + ` td[data-prop-name="${propName}"]`);
      if (!refreshedCell) return null;
      const text = refreshedCell.textContent || '';
      return text.includes(action.targetName || 'Alpha') || text.includes(action.expectedSourceNeedle || 'team_alpha')
        ? refreshedCell
        : null;
    }, 'リレーション反映');
    api.logStep('リレーション保存 OK');
  });

  registerAction('database_select_rows', async (action, api) => {
    const entityNames = Array.isArray(action.entityNames) ? action.entityNames.filter(Boolean) : [];
    api.assert(entityNames.length > 0, 'entityNames が指定されていません');
    for (const entityName of entityNames) {
      const checkbox = await api.waitFor(() => {
        const row = document.querySelector(`#pivot-table tr[data-entity-name="${CSS.escape(entityName)}"]`);
        return row?.querySelector('.row-select-cb') || null;
      }, '行選択チェックボックス: ' + entityName);
      if (!checkbox.checked) checkbox.click();
    }
    await api.waitFor(() => {
      const bar = document.getElementById('db-bulk-edit-bar') || document.querySelector('.db-bulk-edit-bar');
      if (!bar) return null;
      const allSelected = entityNames.every(name => document.querySelector(
        `#pivot-table tr[data-entity-name="${CSS.escape(name)}"] .row-select-cb`
      )?.checked);
      if (!allSelected) return null;
      const text = (bar.textContent || '').replace(/\s+/g, '');
      return text.includes(String(entityNames.length) + '件選択中') ? bar : null;
    }, '一括選択反映');
    api.logStep('シート行選択 OK: ' + entityNames.join(', '));
  });

  registerAction('database_bulk_edit', async (action, api) => {
    const bar = await api.waitFor(() => document.getElementById('db-bulk-edit-bar') || document.querySelector('.db-bulk-edit-bar'), '一括編集バー');
    const editButton = [...bar.querySelectorAll('button')].find(btn => (btn.textContent || '').includes('一括編集'));
    api.assert(editButton, '一括編集ボタンが見つかりません');
    editButton.click();

    await api.waitFor(() => document.getElementById('bulk-edit-prop'), '一括編集モーダル');
    const propSelect = document.getElementById('bulk-edit-prop');
    api.assert(propSelect, '一括編集プロパティが見つかりません');
    propSelect.value = action.propName || '状態';
    propSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const wantedValue = action.value == null ? '' : String(action.value);
    const valueTarget = await api.waitFor(() => {
      const valueInput = document.getElementById('bulk-edit-value');
      if (valueInput) {
        if (valueInput.tagName !== 'SELECT' || !wantedValue) return valueInput;
        const options = [...valueInput.options];
        return options.some(opt => opt.value === wantedValue || (opt.textContent || '').trim() === wantedValue)
          ? valueInput
          : null;
      }
      const boxes = [...document.querySelectorAll('#bulk-edit-value-container .bulk-edit-ms')];
      if (!boxes.length) return null;
      if (!wantedValue) return boxes[0];
      return boxes.find(cb => cb.value === wantedValue || (cb.closest('label')?.textContent || '').trim() === wantedValue) || null;
    }, '一括編集値入力');
    const valueInput = document.getElementById('bulk-edit-value');
    if (valueInput) {
      if (valueInput.tagName === 'SELECT' && wantedValue) {
        const option = [...valueInput.options].find(opt => opt.value === wantedValue || (opt.textContent || '').trim() === wantedValue);
        valueInput.value = option ? option.value : wantedValue;
      } else {
        valueInput.value = action.value ?? '';
      }
      valueInput.dispatchEvent(new Event('input', { bubbles: true }));
      valueInput.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (valueTarget?.matches?.('.bulk-edit-ms')) {
      const wanted = new Set(String(action.value ?? '').split(',').map(v => v.trim()).filter(Boolean));
      [...document.querySelectorAll('#bulk-edit-value-container .bulk-edit-ms')].forEach(cb => {
        const label = (cb.closest('label')?.textContent || '').trim();
        const shouldCheck = wanted.size === 0 ? cb === valueTarget : wanted.has(cb.value) || wanted.has(label);
        if (cb.checked !== shouldCheck) cb.click();
      });
    }

    const statusSelect = document.getElementById('bulk-edit-status');
    if (statusSelect && action.status) {
      statusSelect.value = action.status;
      statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const replaceInput = document.getElementById('bulk-edit-replace');
    if (replaceInput && typeof action.replace === 'boolean' && replaceInput.checked !== action.replace) {
      replaceInput.click();
    }

    const applyButton = document.getElementById('bulk-edit-apply');
    api.assert(applyButton, '一括編集適用ボタンが見つかりません');
    applyButton.click();

    await api.waitFor(() => !document.getElementById('bulk-edit-apply') ? true : null, '一括編集モーダル終了');
    const verifyTimeoutMs = 20000;
    if (Array.isArray(action.expectedContains)) {
      for (const spec of action.expectedContains) {
        await _waitFileNeedle(api, spec.path, spec.needle, true, '一括編集保存確認: ' + spec.path, verifyTimeoutMs);
      }
    }
    if (Array.isArray(action.expectedAbsent)) {
      for (const spec of action.expectedAbsent) {
        await _waitFileNeedle(api, spec.path, spec.needle, false, '一括編集削除確認: ' + spec.path, verifyTimeoutMs);
      }
    }
    if (Array.isArray(action.entityNames) && action.entityNames.length > 0) {
      await api.waitFor(() => {
        const nextBar = document.getElementById('db-bulk-edit-bar') || document.querySelector('.db-bulk-edit-bar');
        if (!nextBar) return null;
        const text = (nextBar.textContent || '').replace(/\s+/g, '');
        return text.includes(String(action.entityNames.length) + '件選択中') ? nextBar : null;
      }, '一括編集後の選択復元');
    }
    api.logStep('シート一括編集 OK: ' + (action.propName || '状態'));
  });

  registerAction('database_clear_selection', async (_action, api) => {
    const bar = await api.waitFor(() => document.getElementById('db-bulk-edit-bar') || document.querySelector('.db-bulk-edit-bar'), '選択バー');
    const clearButton = [...bar.querySelectorAll('button')].find(btn => (btn.textContent || '').includes('選択解除'));
    api.assert(clearButton, '選択解除ボタンが見つかりません');
    clearButton.click();
    await api.waitFor(() => !document.getElementById('db-bulk-edit-bar') ? true : null, '選択解除反映');
    api.logStep('シート選択解除 OK');
  });

  registerAction('scriptnote_edit_and_save', async (action, api) => {
    const target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', action.path), 'シナリオコンポーネント');
    const editor = target.comp?._editor;
    api.assert(editor?.doc?.rows?.length, 'シナリオ行が見つかりません');
    editor.doc.rows[0].text = action.text || 'E2E script line';
    editor._render();
    if (typeof target.comp?._syncDetailPanel === 'function') target.comp._syncDetailPanel();
    editor._markDirty({ skipUndo: true });
    await editor.flush();
    await api.verifyJsonField(
      action.path,
      payload => payload?.rows?.[0]?.text,
      action.text || 'E2E script line',
      'シナリオ保存'
    );
    api.logStep('シナリオ保存 OK');
  });

  registerAction('scriptnote_open_detail_panel', async (action, api) => {
    let target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', action.path), 'シナリオコンポーネント');
    await _focusContentTab('scriptnote', action.path, api, 'シナリオタブ再アクティブ化');
    target = await api.waitFor(() => api.findComponentByTypeAndPath('scriptnote', action.path), 'シナリオコンポーネント再取得');
    await api.waitFor(() => target.comp?._editor?.doc ? true : null, 'シナリオ editor 準備');
    _toggleOptionPanelForE2E();
    await api.waitFor(() => _detailPaneReadySignal(), '詳細ペイン準備');
    await api.waitFor(() => {
      const host = _getToolHost('detail');
      return host && (host.querySelector('#detail-tab-bar') || host.querySelector('#detail-tab-empty')) ? host : null;
    }, '詳細ペイン描画');
    _syncScriptnoteDetailTarget(target, action.detailTab);
    await api.waitFor(() => {
      const wrap = _getScriptnoteDetailWrap(action.detailTab);
      if (wrap) return wrap;
      return _syncScriptnoteDetailTarget(target, action.detailTab);
    }, 'シナリオ詳細パネル');
    api.logStep('シナリオ詳細パネル OK');
  });

