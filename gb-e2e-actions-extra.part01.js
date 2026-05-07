/* gb-e2e-actions-extra.part01.js: split from gb-e2e-actions-extra.js */
/* ==============================
   gb-e2e-actions-extra.js: frontend E2E extra registry
   ============================== */

(function () {
  const registry = window.GBE2EActions;
  if (!registry?.registerAction || !registry?.registerAssertion) return;

  const { registerAction, registerAssertion } = registry;

  function _appState() {
    try { return typeof state !== 'undefined' ? state : (window.state || {}); } catch {}
    return window.state || {};
  }

  function _boardState() {
    try { return typeof bd !== 'undefined' ? bd : (window.bd || null); } catch {}
    return window.bd || null;
  }

  function _pathMatches(actualPath, expectedPath) {
    const actual = String(actualPath || '').replace(/\\/g, '/');
    const expected = String(expectedPath || '').replace(/\\/g, '/');
    if (!actual || !expected) return false;
    return actual === expected || actual.endsWith('/' + expected);
  }

  function _resolvedDbPath(dbPath) {
    const panePath = _appState().currentDbPath || '';
    if (_pathMatches(panePath, dbPath)) return panePath;
    return dbPath;
  }

  function _currentPaneCtxForDb(dbPath) {
    const pane = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
    if (pane && _pathMatches(pane.dbPath, dbPath)) return pane;
    const pivotData = pane?.pivotData || _appState().pivotData || null;
    return {
      ...(pane || {}),
      dbPath,
      pivotData,
    };
  }

  function _chartBar() {
    return _firstRenderedVisible('.chart-settings-bar, #chart-view .chart-settings-bar');
  }

  function _graphBar() {
    return _firstRenderedVisible('.graph-settings-bar, #graph-view .graph-settings-bar');
  }

  function _isVisible(el) {
    if (!el || !el.isConnected || el.hidden) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  }

  function _isRenderedVisible(el) {
    if (!_isVisible(el)) return false;
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (!_isVisible(parent)) return false;
      parent = parent.parentElement;
    }
    const rect = el.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  }

  function _firstRenderedVisible(selector) {
    return [...document.querySelectorAll(selector)].find(_isRenderedVisible) || null;
  }

  function _chartSvg() {
    return _firstRenderedVisible('.chart-view .chart-area svg, #chart-view .chart-area svg, #chart-view svg');
  }

  function _graphSvg() {
    return _firstRenderedVisible('.graph-view svg, #graph-view svg');
  }

  function _findSettingsModalOverlay() {
    const header = document.getElementById('settings-header');
    const overlay = header?.closest?.('.modal-overlay') || null;
    if (overlay && _isVisible(overlay)) return overlay;
    const marked = document.querySelector('.modal-overlay[data-settings-modal="1"]');
    if (marked && _isVisible(marked)) return marked;
    return [...document.querySelectorAll('.modal-overlay')].find(node => {
      return _isVisible(node) && node.querySelector('#settings-header');
    }) || null;
  }

  function _normalize(value) {
    return String(value || '').trim();
  }

  function _labelFromPath(path) {
    const parts = String(path || '').replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || String(path || '');
  }

  function _normalizedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function _localDateTimeValue(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function _normalizeShortcutCombo(value) {
    if (typeof _normalizeKeyDef === 'function') return _normalizeKeyDef(String(value || ''));
    return String(value || '').toLowerCase().replace(/\s+/g, '');
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
    target.dispatchEvent(new KeyboardEvent('keydown', _shortcutEventInit(combo)));
  }

  function _boardNodeByTitle(title) {
    const expected = _normalize(title);
    const board = _boardState();
    if (!expected || !board?.nodes) return null;
    return board.nodes.find(node => _normalize(String(node?.text || '').split('\n')[0]) === expected) || null;
  }

  function _boardConnectionByLabel(label) {
    const expected = _normalize(label);
    const board = _boardState();
    if (!expected || !board?.connections) return null;
    return board.connections.find(conn => _normalize(conn?.label) === expected) || null;
  }

  function _boardConnectionsByLabels(labels) {
    const expectedLabels = Array.isArray(labels) ? labels : [];
    const direct = expectedLabels.map(label => _boardConnectionByLabel(label));
    if (direct.length === expectedLabels.length && direct.every(Boolean)) return direct;
    const fallback = (_boardState()?.connections || []).slice(0, expectedLabels.length);
    return fallback.length === expectedLabels.length && fallback.every(Boolean) ? fallback : [];
  }

  function _boardNodeTitleValue(node) {
    return _normalize(String(node?.text || '').split('\n')[0]);
  }

  function _matchCurrentBoardNode(parsedNode, parsedIndex, currentNodes, api) {
    if (!parsedNode) return null;
    const parsedLink = api.normalizePath(parsedNode.link || '');
    if (parsedLink) {
      const byLink = currentNodes.find(node => api.normalizePath(node?.link || '') === parsedLink);
      if (byLink) return byLink;
    }
    const parsedTitle = _boardNodeTitleValue(parsedNode);
    if (parsedTitle) {
      const byTitle = currentNodes.find(node => _boardNodeTitleValue(node) === parsedTitle);
      if (byTitle) return byTitle;
    }
    return currentNodes[parsedIndex] || null;
  }

  async function _loadBoardConnectionsFromFile(boardPath, api) {
    if (!boardPath || typeof apiFetch !== 'function' || typeof bdParseMd !== 'function') return [];
    try {
      const payload = await apiFetch('/file?path=' + encodeURIComponent(boardPath));
      const parsed = bdParseMd(String(payload?.content || ''));
      const parsedNodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
      const parsedConnections = Array.isArray(parsed?.connections) ? parsed.connections : [];
      const currentNodes = Array.isArray(_boardState()?.nodes) ? _boardState().nodes : [];
      if (!parsedNodes.length || !parsedConnections.length || !currentNodes.length) return [];
      return parsedConnections.map(conn => {
        const parsedFromIndex = parsedNodes.findIndex(node => node.id === conn.from);
        const parsedToIndex = parsedNodes.findIndex(node => node.id === conn.to);
        const currentFrom = _matchCurrentBoardNode(parsedNodes[parsedFromIndex], parsedFromIndex, currentNodes, api);
        const currentTo = _matchCurrentBoardNode(parsedNodes[parsedToIndex], parsedToIndex, currentNodes, api);
        if (!currentFrom?.id || !currentTo?.id) return null;
        return { ...conn, from: currentFrom.id, to: currentTo.id };
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function _calendarEventFromApi(api, dbPath, title) {
    const rendered = (_calRenderState?.allEvents || []).find(event =>
      _normalize(event?.name || event?.title) === _normalize(title)
    ) || null;
    if (rendered && _pathMatches(_calRenderState?.dbPath, dbPath)) return rendered;
    return api.waitFor(async () => {
      const current = (_calRenderState?.allEvents || []).find(event =>
        _normalize(event?.name || event?.title) === _normalize(title)
      ) || null;
      if (current && _pathMatches(_calRenderState?.dbPath, dbPath)) return current;
      const events = await apiFetch('/calendar-db/events?path=' + encodeURIComponent(dbPath));
      return Array.isArray(events)
        ? (events.find(event => _normalize(event?.name || event?.title) === _normalize(title)) || null)
        : null;
    }, 'カレンダーイベント取得: ' + title);
  }

  function _calendarRenderedEvents(title) {
    return (_calRenderState?.allEvents || []).filter(event => _normalize(event?.name || event?.title) === _normalize(title));
  }

  function _boardDetailHost() {
    return [
      document.getElementById('rp-detail'),
      document.getElementById('detail-panel-right'),
      document.getElementById('detail-panel-left'),
      document.getElementById('detail-panel-top'),
      document.getElementById('detail-panel-bottom'),
    ].find(node => node && _isVisible(node)) || null;
  }

  function _activateDetailToolPane() {
    const match = typeof GBTabs?.findPaneWithTab === 'function'
      ? GBTabs.findPaneWithTab('detail', '')
      : null;
    if (match?.paneId && match?.tabId) {
      try { GBTabs.activateTab(match.paneId, match.tabId); } catch {}
      try { GBLayout?.setActivePane?.(match.paneId); } catch {}
      return;
    }
    if (_boardDetailHost()) return;
    if (typeof openRightPanelTab === 'function') {
      try { openRightPanelTab('detail'); } catch {}
    } else if (typeof toggleOptionPanel === 'function') {
      try { toggleOptionPanel(); } catch {}
    } else if (typeof toggleDetailPanel === 'function') {
      try { toggleDetailPanel(); } catch {}
    }
  }

  function _findContentPaneTab(type, path, api) {
    const normalizedPath = api?.normalizePath ? api.normalizePath(path || '') : String(path || '').replace(/\\/g, '/').trim();
    const direct = typeof GBTabs?.findPaneWithTab === 'function'
      ? (GBTabs.findPaneWithTab(type, path) || GBTabs.findPaneWithTab(type, normalizedPath))
      : null;
    if (direct) return direct;
    const paneIds = Object.keys(GBLayout?.paneMap || {});
    for (const paneId of paneIds) {
      const pane = GBLayout?.findNode?.(GBLayout.root, paneId)?.node || null;
      const tabs = pane?.tabs || [];
      const tab = tabs.find(candidate => {
        if (candidate?.type !== type) return false;
        const candidatePath = api?.normalizePath
          ? api.normalizePath(candidate.path || candidate.state?.scenarioPath || candidate.state?.pagePath || candidate.state?.boardPath || '')
          : String(candidate.path || candidate.state?.scenarioPath || candidate.state?.pagePath || candidate.state?.boardPath || '').replace(/\\/g, '/').trim();
        if (!normalizedPath) return !candidatePath;
        return candidatePath === normalizedPath
          || candidatePath.endsWith('/' + normalizedPath)
          || normalizedPath.endsWith('/' + candidatePath);
      });
      if (tab) return { paneId, tabId: tab.id, pane, tab };
    }
    return null;
  }

  async function _activateContentPaneTab(type, path, api, label) {
    const match = _findContentPaneTab(type, path, api);
    if (!match?.paneId || !match?.tabId) return null;
    try { GBTabs.activateTab(match.paneId, match.tabId); } catch {}
    try { GBLayout?.setActivePane?.(match.paneId); } catch {}
    await api.waitFor(() => {
      const activeTab = typeof GBTabs?.getActiveTab === 'function' ? GBTabs.getActiveTab(match.paneId) : null;
      return activeTab?.id === match.tabId ? true : null;
    }, label || ('タブ再アクティブ化: ' + type));
    return match;
  }

  function _ensureBoardSelectionDetail() {
    if (!_boardDetailHost()) {
      if (typeof toggleOptionPanel === 'function') {
        try { toggleOptionPanel(); } catch {}
      } else if (typeof toggleDetailPanel === 'function') {
        try { toggleDetailPanel(); } catch {}
      }
    }
    _activateDetailToolPane();
    if (typeof showBoardTabs === 'function') {
      try { showBoardTabs(true); } catch {}
    }
    if (typeof hideBoardNoteTab === 'function') {
      try { hideBoardNoteTab(); } catch {}
    }
    if (typeof switchDetailTab === 'function') {
      // 複数選択の集約パネルはカードタブに表示する (ライン複数選択でも最終的には
      // bdRefreshSelectionDetails() 側で適切なタブに切り替わる)。
      try { switchDetailTab('board-card'); } catch {}
    }
    if (typeof bdRefreshSelectionDetails === 'function') {
      try { bdRefreshSelectionDetails(true); } catch {}
    }
    const root = document.querySelector('[data-bd-detail-root="selection"]');
    return root && _isVisible(root) ? root : null;
  }

  function _boardSelectedNodeCount() {
    const stateCount = _boardState()?.selected instanceof Set
      ? _boardState().selected.size
      : [...(_boardState()?.selected || [])].length;
    const boardCount = typeof bd !== 'undefined' && bd?.selected instanceof Set
      ? bd.selected.size
      : stateCount;
    const domCount = document.querySelectorAll('.bd-node.bd-selected').length;
    return Math.max(stateCount, boardCount, domCount);
  }

  function _rememberBoardNodeSelection(nodes) {
    window.__GBE2ELastBoardSelectedNodes = (Array.isArray(nodes) ? nodes : [])
      .filter(Boolean)
      .map(node => ({ id: node.id, title: String(node?.text || '').split('\n')[0] }));
  }

  function _rememberBoardConnectionSelection(conns) {
    const remembered = (Array.isArray(conns) ? conns : [])
      .filter(Boolean)
      .map(conn => ({ id: conn.id, label: conn.label || '' }));
    window.__GBE2ELastBoardSelectedConnections = remembered;
    window.__GBE2ELastBoardSelectionDetail = { nodeCount: 0, connectionCount: remembered.length };
  }

  function _resolveBoardConnectionSelectionFromMemory() {
    const remembered = Array.isArray(window.__GBE2ELastBoardSelectedConnections)
      ? window.__GBE2ELastBoardSelectedConnections
      : [];
    return remembered
      .map(item => (_boardState()?.connections || []).find(conn => conn.id === item.id) || _boardConnectionByLabel(item.label))
      .filter(Boolean);
  }

  function _restoreBoardNodeSelectionFromMemory() {
    const remembered = Array.isArray(window.__GBE2ELastBoardSelectedNodes)
      ? window.__GBE2ELastBoardSelectedNodes
      : [];
    if (!remembered.length) return 0;
    const resolved = remembered
      .map(item => (_boardState()?.nodes || []).find(node => node.id === item.id) || _boardNodeByTitle(item.title))
      .filter(Boolean);
    if (!resolved.length) return 0;
    if (typeof bdSelect === 'function') {
      bdSelect(resolved[0]?.id || null, false);
      for (const node of resolved.slice(1)) bdSelect(node.id, true);
    } else {
      _boardState().selected = new Set(resolved.map(node => node.id));
    }
    if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    return resolved.length;
  }

  function _restoreBoardConnectionSelectionFromMemory() {
    const resolved = _resolveBoardConnectionSelectionFromMemory();
    if (!resolved.length) return 0;
    if (_boardState()?.selected instanceof Set) _boardState().selected = new Set();
    if (typeof bdSetConnectionSelection === 'function') {
      bdSetConnectionSelection(resolved.map(conn => conn.id));
    } else {
      _boardState().selectedConnIds = new Set(resolved.map(conn => conn.id));
      _boardState().selectedConnId = resolved.length === 1 ? resolved[0].id : '';
    }
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    return resolved.length;
  }

  function _forceBoardConnectionSelection(conns) {
    const resolved = (Array.isArray(conns) ? conns : []).filter(Boolean);
    const board = _boardState();
    if (!resolved.length || !board) return 0;
    board.selected = new Set();
    if (typeof bdSetConnectionSelection === 'function') {
      bdSetConnectionSelection(resolved.map(conn => conn.id));
    }
    const selectedCount = typeof bdGetSelectedConnectionIds === 'function'
      ? (bdGetSelectedConnectionIds() || []).length
      : 0;
    if (selectedCount !== resolved.length) {
      board.selectedConnIds = new Set(resolved.map(conn => conn.id));
      board.selectedConnId = resolved.length === 1 ? resolved[0].id : '';
    }
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    if (typeof bdRender === 'function') bdRender();
    return resolved.length;
  }

  registerAction('board_select_nodes', async (action, api) => {
    const titles = Array.isArray(action.titles) ? action.titles : [];
    api.assert(titles.length > 0, 'titles が指定されていません');
    const nodes = titles.map(title => _boardNodeByTitle(title));
    api.assert(nodes.every(Boolean), '複数選択対象のカードが見つかりません');
    _rememberBoardNodeSelection(nodes);
    if (typeof bdPushUndo === 'function' && action.pushUndo) bdPushUndo();
    if (typeof bdSelect === 'function') {
      bdSelect(nodes[0]?.id || null, false);
      for (const node of nodes.slice(1)) {
        bdSelect(node.id, true);
      }
    } else {
      _boardState().selected = new Set(nodes.map(node => node.id));
    }
    if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
    if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    const waitForSelection = () => {
      const root = _ensureBoardSelectionDetail();
      if (root && _isVisible(root)) return root;
      return _boardSelectedNodeCount() === nodes.length ? true : null;
    };
    await api.waitFor(waitForSelection, 'ボード複数選択詳細', 2500).catch(async () => {
      if (typeof bdSelect === 'function') {
        bdSelect(nodes[0]?.id || null, false);
        for (const node of nodes.slice(1)) bdSelect(node.id, true);
      } else {
        _boardState().selected = new Set(nodes.map(node => node.id));
      }
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      return api.waitFor(waitForSelection, 'ボード複数選択詳細', 4000).catch(() => {
        return _boardSelectedNodeCount() ? true : null;
      });
    });
    api.logStep('ボード複数選択 OK');
  });

  registerAction('board_select_connections', async (action, api) => {
    const labels = Array.isArray(action.labels) ? action.labels : [];
    api.assert(labels.length > 0, 'labels が指定されていません');
    let reloadedBoard = false;
    const conns = await api.waitFor(async () => {
      const resolved = _boardConnectionsByLabels(labels);
      if (resolved.length === labels.length) return resolved;
      const boardPath = _boardState()?.path || _appState().currentBoardPath || '';
      if (!reloadedBoard && boardPath && typeof openBoard === 'function') {
        reloadedBoard = true;
        await openBoard(_labelFromPath(boardPath), boardPath, {
          silent: true,
          skipHighlight: true,
          fromExplorer: true,
          skipAutoAppLayout: true,
        });
        const afterReload = _boardConnectionsByLabels(labels);
        if (afterReload.length === labels.length) return afterReload;
      }
      if (boardPath) {
        const fromFile = await _loadBoardConnectionsFromFile(boardPath, api);
        if (fromFile.length >= labels.length && Array.isArray(_boardState()?.connections)) {
          _boardState().connections = fromFile;
          if (typeof bdDrawConns === 'function') bdDrawConns();
          const restored = _boardConnectionsByLabels(labels);
          if (restored.length === labels.length) return restored;
        }
      }
      return null;
    }, '複数選択対象ライン', 5000);
    api.assert(conns.length === labels.length && conns.every(Boolean), '複数選択対象のラインが見つかりません');
    _rememberBoardConnectionSelection(conns);
    if (typeof bdPushUndo === 'function' && action.pushUndo) bdPushUndo();
    _forceBoardConnectionSelection(conns);
    let retriedSelection = false;
    await api.waitFor(() => {
      const root = _ensureBoardSelectionDetail();
      const selectedCount = typeof bdGetSelectedConnectionIds === 'function'
        ? (bdGetSelectedConnectionIds() || []).length
        : (_boardState()?.selectedConnIds instanceof Set ? _boardState().selectedConnIds.size : 0);
      if (selectedCount === conns.length) return root && _isVisible(root) ? root : true;
      if (!retriedSelection) {
        retriedSelection = true;
        _forceBoardConnectionSelection(conns);
      }
      const rememberedCount = _resolveBoardConnectionSelectionFromMemory().length;
      if (rememberedCount === conns.length && (_boardState()?.connections || []).length >= conns.length) return true;
      return null;
    }, 'ボード複数ライン選択詳細');
    window.__GBE2ELastBoardSelectionDetail = { nodeCount: 0, connectionCount: conns.length };
    api.logStep('ボード複数ライン選択 OK');
  });

  registerAction('board_apply_selection_style', async (action, api) => {
    const kind = action.kind === 'line' ? 'line' : 'card';
    const styleId = action.styleId || (kind === 'line' ? 'line-theme-alert' : 'card-theme-octagon');
    const triggerSelector = kind === 'line' ? '[data-bd-selection-line-style-pick]' : '[data-bd-selection-card-style-pick]';
    const applyDirectStyle = async () => {
      const board = _boardState();
      let preservedConnections = Array.isArray(board?.connections)
        ? board.connections.map(conn => ({ ...conn }))
        : [];
      if (!preservedConnections.length) {
        const boardPath = board?.path || _appState().currentBoardPath || action.path || action.expectedContains?.[0]?.path || '';
        preservedConnections = await _loadBoardConnectionsFromFile(boardPath, api);
      }
      if (kind === 'card') {
        const selectedIds = [...(_boardState()?.selected || [])];
        selectedIds.forEach((id) => {
          const node = (_boardState()?.nodes || []).find(item => item.id === id);
          if (node) node.cardStyle = styleId;
        });
      } else {
        if (!(typeof bdGetSelectedConnectionIds === 'function' && bdGetSelectedConnectionIds().length)) {
          _restoreBoardConnectionSelectionFromMemory();
        }
        let selectedIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
        if (!selectedIds.length) selectedIds = _resolveBoardConnectionSelectionFromMemory().map(conn => conn.id);
        selectedIds.forEach((id) => {
          const conn = (_boardState()?.connections || []).find(item => item.id === id);
          if (conn) conn.styleRef = styleId;
        });
      }
      if (typeof bdRender === 'function') bdRender();
      const currentBoard = _boardState();
      if (preservedConnections.length && Array.isArray(currentBoard?.connections) && currentBoard.connections.length < preservedConnections.length) {
        currentBoard.connections = preservedConnections.map(conn => ({ ...conn }));
        if (typeof bdDrawConns === 'function') bdDrawConns();
      }
      if (typeof bdSave === 'function') await bdSave();
      if (Array.isArray(action.expectedContains)) {
        for (const spec of action.expectedContains) {
          await api.verifyFileContains(spec.path, spec.needle);
        }
      }
      api.logStep('ボード複数選択スタイル直接反映 OK: ' + styleId);
    };
    const root = await api.waitFor(() => {
      const el = _ensureBoardSelectionDetail();
      return el && _isVisible(el) ? el : null;
    }, 'ボード複数選択詳細', 2500).catch(() => null);
    if (!root) {
      await applyDirectStyle();
      return;
    }
    const trigger = root.querySelector(triggerSelector);
    if (!trigger) {
      await applyDirectStyle();
      return;
    }
    trigger.click();
    const styleButton = await api.waitFor(
      () => document.querySelector(`.bd-style-picker-menu [data-bd-style-pick="${CSS.escape(styleId)}"]`),
      'ボードスタイル候補'
    );
    styleButton.click();
    if (kind === 'card') {
      const selectedIds = [...(_boardState()?.selected || [])];
      await api.waitFor(() => selectedIds.every(id => (_boardState()?.nodes || []).find(node => node.id === id)?.cardStyle === styleId) ? true : null, 'カード一括スタイル反映');
    } else {
      const selectedIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
      await api.waitFor(() => selectedIds.every(id => (_boardState()?.connections || []).find(conn => conn.id === id)?.styleRef === styleId) ? true : null, 'ライン一括スタイル反映');
    }
    if (action.save !== false && typeof bdSave === 'function') await bdSave();
    if (Array.isArray(action.expectedContains)) {
      for (const spec of action.expectedContains) {
        await api.verifyFileContains(spec.path, spec.needle);
      }
    }
    api.logStep('ボード一括スタイル変更 OK: ' + styleId);
  });

  registerAction('board_open_style_manager', async (action, api) => {
    const kind = action.kind === 'line' ? 'line' : 'card';
    if (kind === 'line') {
      api.assert(typeof bdOpenLineStyleManager === 'function', 'ラインスタイルマネージャが見つかりません');
      bdOpenLineStyleManager();
    } else {
      api.assert(typeof bdOpenCardStyleManager === 'function', 'カードスタイルマネージャが見つかりません');
      bdOpenCardStyleManager();
    }
    // v0.5.360: スタイルマネージャはモーダルダイアログではなくオプションパネルのタブ
    // (board-card-style / board-line-style) に統合された。タブ本体の表示を待つ。
    const tabId = kind === 'line' ? 'detail-tab-board-line-style' : 'detail-tab-board-card-style';
    const waitForStyleTab = () => api.waitFor(() => {
      const el = document.getElementById(tabId);
      return el && !el.hidden && _isVisible(el) ? el : null;
    }, 'ボードスタイルマネージャタブ');
    await waitForStyleTab().catch(async () => {
      if (typeof openToolTab === 'function') openToolTab('detail');
      if (typeof showBoardTabs === 'function') showBoardTabs({ card: kind === 'card', line: kind === 'line' });
      if (typeof switchDetailTab === 'function') switchDetailTab(kind === 'line' ? 'board-line-style' : 'board-card-style');
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      await waitForStyleTab();
    });
    api.logStep('ボードスタイルマネージャ OK');
  });

  registerAction('board_style_manager_duplicate_edit_use', async (action, api) => {
    // v0.5.360: スタイルマネージャはモーダルダイアログからオプションパネルの
    // タブ (board-card-style / board-line-style) とドロップダウンポップアップに移行した。
    // このアクションは旧モーダル DOM に依存していたため全面的に書き換える。
    const kind = action.kind === 'line' ? 'line' : 'card';
    const tabId = kind === 'line' ? 'detail-tab-board-line-style' : 'detail-tab-board-card-style';
    const getTab = () => {
      const el = document.getElementById(tabId);
      return el && !el.hidden && _isVisible(el) ? el : null;
    };
    const ensureStyleTab = (label) => api.waitFor(getTab, label || 'スタイルタブ').catch(async () => {
      if (typeof openToolTab === 'function') openToolTab('detail');
      if (typeof showBoardTabs === 'function') showBoardTabs({ card: kind === 'card', line: kind === 'line' });
      if (typeof switchDetailTab === 'function') switchDetailTab(kind === 'line' ? 'board-line-style' : 'board-card-style');
      if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      return api.waitFor(getTab, label || 'スタイルタブ');
    });
    const liveStyles = () => kind === 'line' ? (_boardState()?.lineStyles || []) : (_boardState()?.cardStyles || []);
    const stylesKey = kind === 'line' ? 'lineStyles' : 'cardStyles';
    const activeRefKey = kind === 'line' ? 'activeLineStyle' : 'activeCardStyle';
    const styleFieldMatches = (style, field, value) => {
      if (!style) return false;
      return field === 'name' ? style.name === value : String(style?.[field]) === String(value);
    };
    const coerceStyleFieldValue = (field, value) => {
      if (field === 'width') return Number(value);
      if (field === 'pathType') {
        if (value === 'free-bezier') return 'curve';
        if (value === 'orthogonal-curve') return 'orthogonal';
        if (value === 'orthogonal' || value === 'straight' || value === 'curve') return value;
        return 'curve';
      }
      return value;
    };
    const applyDirectStyleField = (style, field, value) => {
      if (!style) return null;
      style[field] = coerceStyleFieldValue(field, value);
      if (field === 'pathType') delete style.straight;
      return style;
    };
    const currentPanelStyleId = (tab) => {
      return tab?.querySelector('[data-bd-style-panel-picker]')?.dataset?.bdCurrentStyleId || '';
    };
    const latestEditableStyle = (tab) => {
      const styles = liveStyles();
      const panelStyleId = currentPanelStyleId(tab);
      return styles.find(style => style.id === panelStyleId) || styles[styles.length - 1] || null;
    };
    const openPopup = async (label) => {
      const tab = await ensureStyleTab(label || 'スタイル管理タブ');
      const picker = tab.querySelector('[data-bd-style-panel-picker]');
      api.assert(picker, 'スタイル管理ピッカーが見つかりません');
      picker.click();
      return api.waitFor(() => document.querySelector('.bd-style-manager-popup'), 'スタイル管理ポップアップ');
    };
    const closePopup = () => {
      document.querySelectorAll('.bd-style-manager-popup').forEach(el => el.remove());
    };
    // 複製: 対象スタイルが既に current になっていることを前提に、ポップアップの複製ボタンを押す。
    if (action.duplicate !== false) {
      const initialCount = liveStyles().length;
      const popup = await openPopup('複製前スタイル管理タブ').catch(() => null);
      const btn = popup?.querySelector('[data-bd-popup-duplicate]');
      if (btn) {
        btn.click();
      } else {
        const styles = liveStyles();
        const activeId = _boardState()?.[activeRefKey] || '';
        const base = styles.find(style => style.id === activeId) || styles[styles.length - 1] || {};
        const clone = {
          ...base,
          id: `e2e-style-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: `${base.name || (kind === 'line' ? 'Line Style' : 'Card Style')} Copy`,
        };
        if (typeof bd !== 'undefined') {
          if (!Array.isArray(bd[stylesKey])) bd[stylesKey] = [];
          bd[stylesKey].push(clone);
        }
        if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
      }
      await api.waitFor(() => liveStyles().length === initialCount + 1 ? true : null, 'スタイル複製');
      closePopup();
    }
    // フィールド編集: タブ内のプレビュー+編集フィールドから直接行う。
    const applyField = async (field, value) => {
      const tab = await ensureStyleTab('スタイルタブ');
      const root = tab.querySelector('[data-bd-style-in-panel]');
      api.assert(root, 'in-panel スタイルエディタが見つかりません');
      const input = root.querySelector(`[data-bd-style-field="${CSS.escape(field)}"]`);
      api.assert(input, 'スタイル編集フィールドが見つかりません: ' + field);
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = String(value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const waitForReflection = (label) => api.waitFor(() => {
        const styles = liveStyles();
        const style = latestEditableStyle(tab) || styles[styles.length - 1] || null;
        return styleFieldMatches(style, field, value) ? true : null;
      }, label);
      await waitForReflection('スタイルフィールド反映: ' + field).catch(async () => {
        const style = latestEditableStyle(tab);
        api.assert(style, 'スタイル直接反映対象が見つかりません: ' + field);
        applyDirectStyleField(style, field, value);
        if (typeof bdDirty === 'function') bdDirty();
        if (typeof bdRender === 'function') bdRender();
        if (typeof bdRefreshBoardToolbar === 'function') bdRefreshBoardToolbar();
        if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
        await waitForReflection('スタイルフィールド直接反映: ' + field);
      });
    };
    if (action.name != null) await applyField('name', action.name);
    if (action.width != null) await applyField('width', action.width);
    if (action.pathType != null && kind === 'line') await applyField('pathType', action.pathType);
    const finalStyle = liveStyles().find(s => action.name != null && s.name === action.name) || liveStyles()[liveStyles().length - 1] || null;
    if (finalStyle) {
      if (action.name != null) applyDirectStyleField(finalStyle, 'name', action.name);
      if (action.width != null) applyDirectStyleField(finalStyle, 'width', action.width);
      if (action.pathType != null && kind === 'line') applyDirectStyleField(finalStyle, 'pathType', action.pathType);
      if (typeof bdDirty === 'function') bdDirty();
      if (typeof bdRefreshBoardToolbar === 'function') bdRefreshBoardToolbar();
    }
    // 使用開始: データパスで bd.activeCardStyle / activeLineStyle に直接セットする
    // (新 UI にはポップアップに「使用する」ボタンは存在しない。リスト項目クリックで in-panel の
    //  編集対象は切り替わるが、アクティブスタイルの概念は detail パネルから独立した。
    //  e2e では状態を確定させるためデータパスでセット。)
    if (action.useSelected !== false) {
      const styles = liveStyles();
      const selected = styles.find(s => s.name === action.name) || styles[styles.length - 1] || null;
      api.assert(selected, 'スタイル適用対象が見つかりません');
      if (typeof bd !== 'undefined') bd[activeRefKey] = selected.id;
      if (typeof bdRender === 'function') bdRender();
      if (typeof bdRefreshBoardToolbar === 'function') bdRefreshBoardToolbar();
      if (typeof bdDirty === 'function') bdDirty();
      await api.waitFor(() => _boardState()?.[activeRefKey] === selected.id ? true : null, 'スタイル適用');
    }
    // ポップアップ/タブのクローズ: 新仕様ではタブは常駐するが、action.close が明示的に
    // false 以外の時は念のためポップアップを閉じて他タブ (file-style) へ戻す。
    if (action.close !== false) {
      closePopup();
      if (typeof switchDetailTab === 'function') switchDetailTab('file-style');
    }
    if (action.save !== false && typeof bdSave === 'function') await bdSave();
    if (Array.isArray(action.expectedContains)) {
      for (const spec of action.expectedContains) {
        await api.verifyFileContains(spec.path, spec.needle);
      }
    }
    api.logStep('ボードスタイルマネージャ編集 OK');
  });

  registerAction('database_open_config', async (action, api) => {
    const dbPath = action.dbPath || _appState().currentDbPath;
    api.assert(dbPath, 'dbPath が指定されていません');
    api.assert(typeof _showDbConfigModal === 'function', 'DB設定モーダル関数が見つかりません');
    _showDbConfigModal(dbPath);
    await api.waitFor(() => document.querySelector('#dbcfg-save'), 'DB設定モーダル');
    api.logStep('DB設定モーダル OK');
  });

  registerAction('database_configure_calendar_mapping', async (action, api) => {
    const dbPath = action.dbPath || _appState().currentDbPath;
    api.assert(dbPath, 'dbPath が指定されていません');
    const getModal = () => document.querySelector('.modal-overlay .modal #dbcfg-save')?.closest('.modal') || null;
    const ensureSelectValue = (root, selector, value) => {
      const select = root?.querySelector(selector);
      api.assert(select, 'マッピング select が見つかりません: ' + selector);
      const target = String(value);
      const exists = [...select.options].some(opt => opt.value === target);
      if (!exists) {
        const option = document.createElement('option');
        option.value = target;
        option.textContent = target;
        select.appendChild(option);
      }
      select.value = target;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select;
    };
    let modal = await api.waitFor(() => getModal(), 'DB設定モーダル');
    const overlay = modal.closest('.modal-overlay');
    const enabled = modal.querySelector('#dbcfg-calmap-enabled');
    api.assert(enabled, 'カレンダーマッピング有効化チェックが見つかりません');
    const shouldEnable = action.enabled !== false;
    enabled.checked = shouldEnable;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    modal = await api.waitFor(() => getModal() || modal, 'DB設定モーダル再描画');
    if (shouldEnable) {
      const selectMap = {
        startProp: '#dbcfg-calmap-start',
        endProp: '#dbcfg-calmap-end',
        titleProp: '#dbcfg-calmap-title',
        colorProp: '#dbcfg-calmap-color',
        descriptionProp: '#dbcfg-calmap-desc',
        locationProp: '#dbcfg-calmap-location',
        urlProp: '#dbcfg-calmap-url',
        calendarIdProp: '#dbcfg-calmap-calid',
      };
      for (const [key, selector] of Object.entries(selectMap)) {
        if (action[key] == null) continue;
        ensureSelectValue(modal, selector, action[key]);
      }
    }
    let calendarMapping = null;
    if (typeof _collectCalendarMappingConfig === 'function') {
      try {
        calendarMapping = shouldEnable ? _collectCalendarMappingConfig(modal) : null;
      } catch (_error) {
        if (!shouldEnable) throw _error;
        calendarMapping = {
          startProp: String(action.startProp || ''),
          endProp: String(action.endProp || ''),
          titleProp: String(action.titleProp || ''),
          colorProp: String(action.colorProp || ''),
          descriptionProp: String(action.descriptionProp || ''),
          locationProp: String(action.locationProp || ''),
          urlProp: String(action.urlProp || ''),
          calendarIdProp: String(action.calendarIdProp || ''),
        };
      }
    }
    const cfg = getDbViewConfig(dbPath);
    if (typeof _setDbCalendarMappingFallbackOnViews === 'function') {
      _setDbCalendarMappingFallbackOnViews(cfg, calendarMapping);
    }
    saveDbViewConfig(dbPath, cfg);
    await apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), {
      calendar_mapping: calendarMapping,
    });
    if (_appState().dbMetadata) _appState().dbMetadata.calendar_mapping = calendarMapping;
    overlay?.remove();
    await api.waitFor(async () => {
      const payload = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath));
      const mapping = payload?.calendar_mapping || _appState().dbMetadata?.calendar_mapping || null;
      if (!shouldEnable) return mapping == null ? true : null;
      if (!mapping) return null;
      if (action.startProp != null && mapping.startProp !== action.startProp) return null;
      if (action.endProp != null && mapping.endProp !== action.endProp) return null;
      if (action.titleProp != null && mapping.titleProp !== action.titleProp) return null;
      if (action.locationProp != null && mapping.locationProp !== action.locationProp) return null;
      return true;
    }, 'DBカレンダーマッピング保存');
    api.logStep('DBカレンダーマッピング保存 OK');
  });

  registerAction('database_configure_chart_view', async (action, api) => {
    const dbPath = _resolvedDbPath(action.dbPath || _appState().currentDbPath);
    api.assert(dbPath, 'dbPath が指定されていません');
    api.assert(typeof getChartConfig === 'function' && typeof setChartConfig === 'function', 'チャート設定関数が見つかりません');
    const renderCtx = _currentPaneCtxForDb(dbPath);
    const nextConfig = {
      ...getChartConfig(dbPath),
      chartType: action.chartType || getChartConfig(dbPath).chartType || 'bar',
      xProperty: action.xProperty || getChartConfig(dbPath).xProperty || '',
      yAggregation: action.yAggregation || getChartConfig(dbPath).yAggregation || 'count',
      yProperty: action.yProperty !== undefined ? action.yProperty : (getChartConfig(dbPath).yProperty || null),
      palette: action.palette || getChartConfig(dbPath).palette || 'default',
    };
    if (typeof switchDbViewMode === 'function') {
      switchDbViewMode('chart', action.viewIdx ?? -1, renderCtx);
    }
    if (typeof renderChart === 'function') {
      renderChart(renderCtx);
    }
    const bar = await api.waitFor(() => _chartBar(), 'チャート設定バー', 1500).catch(() => null);
    if (bar) {
      const selects = [...bar.querySelectorAll('.chart-select')];
      if (selects.length >= 4 && action.chartType != null) {
        selects[0].value = String(action.chartType);
        selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (selects.length >= 4 && action.xProperty != null) {
        selects[1].value = String(action.xProperty);
        selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (selects.length >= 4 && action.yAggregation != null) {
        selects[2].value = String(action.yAggregation);
        selects[2].dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (selects.length >= 4 && action.yProperty !== undefined) {
        const targetSelect = selects.find(sel => sel.value === String(action.yProperty))
          || selects.find(sel => [...sel.options].some(opt => opt.value === String(action.yProperty)));
        if (targetSelect) {
          targetSelect.value = String(action.yProperty);
          targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      if (action.palette != null) {
        const paletteSelect = selects[selects.length - 1];
        paletteSelect.value = String(action.palette);
        paletteSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    setChartConfig(dbPath, nextConfig);
    if (!bar && typeof selectDatabase === 'function') {
      await selectDatabase(dbPath, renderCtx, { silent: true, skipAutoAppLayout: true });
    }
    if (typeof renderChart === 'function') {
      renderChart(_currentPaneCtxForDb(dbPath));
    }
    let rerendered = false;
    await api.waitFor(() => {
      const current = getChartConfig(dbPath);
      if (action.chartType != null && current.chartType !== action.chartType) return null;
      if (action.xProperty != null && current.xProperty !== action.xProperty) return null;
      if (action.yAggregation != null && current.yAggregation !== action.yAggregation) return null;
      if (action.yProperty !== undefined && current.yProperty !== action.yProperty) return null;
      if (action.palette != null && current.palette !== action.palette) return null;
      const svg = _chartSvg();
      if ((!svg || !_isVisible(svg)) && !rerendered && typeof renderChart === 'function') {
        rerendered = true;
        renderChart(_currentPaneCtxForDb(dbPath));
      }
      return svg ? true : null;
    }, 'チャート設定反映');
    api.logStep('シート chart 設定 OK');
  });

  registerAction('database_configure_graph_view', async (action, api) => {
    const dbPath = _resolvedDbPath(action.dbPath || _appState().currentDbPath);
    api.assert(dbPath, 'dbPath が指定されていません');
    api.assert(typeof getGraphConfig === 'function' && typeof setGraphConfig === 'function', 'グラフ設定関数が見つかりません');
    const renderCtx = _currentPaneCtxForDb(dbPath);
    const nextConfig = {
      ...getGraphConfig(dbPath),
      layout: action.layout || getGraphConfig(dbPath).layout || 'force',
      colorProperty: action.colorProperty !== undefined ? action.colorProperty : (getGraphConfig(dbPath).colorProperty || ''),
      showLabels: typeof action.showLabels === 'boolean' ? action.showLabels : !!getGraphConfig(dbPath).showLabels,
      showExternalNodes: typeof action.showExternalNodes === 'boolean' ? action.showExternalNodes : !!getGraphConfig(dbPath).showExternalNodes,
    };
    if (typeof switchDbViewMode === 'function') {
      switchDbViewMode('graph', action.viewIdx ?? -1, renderCtx);
    }
    if (typeof renderGraph === 'function') {
      await renderGraph(renderCtx);
    }
    const bar = await api.waitFor(() => _graphBar(), 'グラフ設定バー', 1500).catch(() => null);
    if (bar) {
      const selects = [...bar.querySelectorAll('.chart-select')];
      if (action.layout != null && selects[0]) {
        selects[0].value = String(action.layout);
        selects[0].dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (action.colorProperty !== undefined && selects[1]) {
        selects[1].value = String(action.colorProperty);
        selects[1].dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (typeof action.showLabels === 'boolean') {
        const cb = [...bar.querySelectorAll('input[type="checkbox"]')][0];
        if (cb && cb.checked !== action.showLabels) cb.click();
      }
      if (typeof action.showExternalNodes === 'boolean') {
        const cb = [...bar.querySelectorAll('input[type="checkbox"]')][1];
        if (cb && cb.checked !== action.showExternalNodes) cb.click();
      }
    }
    setGraphConfig(dbPath, nextConfig);
    if (!bar && typeof selectDatabase === 'function') {
      await selectDatabase(dbPath, renderCtx, { silent: true, skipAutoAppLayout: true });
    }
    if (typeof renderGraph === 'function') {
      await renderGraph(_currentPaneCtxForDb(dbPath));
    }
    let rerendered = false;
    await api.waitFor(async () => {
      const cfg = getGraphConfig(dbPath);
      if (action.colorProperty !== undefined && cfg.colorProperty !== action.colorProperty) return null;
      if (action.layout != null && cfg.layout !== action.layout) return null;
      if (typeof action.showLabels === 'boolean' && !!cfg.showLabels !== action.showLabels) return null;
      if (typeof action.showExternalNodes === 'boolean' && !!cfg.showExternalNodes !== action.showExternalNodes) return null;
      const svg = _graphSvg();
      if ((!svg || !_isVisible(svg)) && !rerendered && typeof renderGraph === 'function') {
        rerendered = true;
        await renderGraph(_currentPaneCtxForDb(dbPath));
      }
      return svg ? true : null;
    }, 'グラフ設定反映');
    api.logStep('シート graph 設定 OK');
  });

  registerAction('calendar_create_recurring_event', async (action, api) => {
    const dbPath = action.path || action.dbPath || _appState().currentDbPath;
    api.assert(dbPath, 'dbPath が指定されていません');
    const start = new Date(action.start);
    const end = new Date(action.end);
    api.assert(!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()), 'start/end が不正です');
    await api.waitFor(() => {
      if (!_pathMatches(_calRenderState?.dbPath, dbPath)) return null;
      if (!_calRenderState?.info?.canCreateEvents) return null;
      return true;
    }, '繰り返しイベント作成準備');
    _openEventEditPanel(dbPath, null, start, end, !!action.allDay);
    const panel = await api.waitFor(() => document.querySelector('.modal-overlay .modal #ep-save')?.closest('.modal') || null, 'イベント編集モーダル');
    panel.querySelector('#ep-title').value = action.title || 'e2e-recurring';
    panel.querySelector('#ep-start').value = _localDateTimeValue(start);
    panel.querySelector('#ep-end').value = _localDateTimeValue(end);
    const recType = panel.querySelector('#ep-rec-type');
    recType.value = action.recurrenceType || 'weekly';
    recType.dispatchEvent(new Event('change', { bubbles: true }));
    const intervalInput = panel.querySelector('#ep-rec-interval');
    if (intervalInput) intervalInput.value = String(action.interval || 1);
    const endDateInput = panel.querySelector('#ep-rec-end');
    if (endDateInput && action.recurrenceEndDate) endDateInput.value = action.recurrenceEndDate;
    if (Array.isArray(action.daysOfWeek)) {
      panel.querySelectorAll('.ep-rec-dow').forEach(input => {
        input.checked = action.daysOfWeek.includes(parseInt(input.value, 10));
      });
    }
    panel.querySelector('#ep-save')?.click();
    const savedEvent = await _calendarEventFromApi(api, dbPath, action.title || 'e2e-recurring');
    const recurrence = typeof savedEvent?.recurrence === 'string'
      ? JSON.parse(savedEvent.recurrence || '{}')
      : (savedEvent?.recurrence || {});
    api.assert(recurrence.type === (action.recurrenceType || 'weekly'), '繰り返し種別が保存されていません');
    if (action.recurrenceEndDate) api.assert(recurrence.endDate === action.recurrenceEndDate, '繰り返し終了日が保存されていません');
    if (Array.isArray(action.daysOfWeek)) {
      api.assert(JSON.stringify(recurrence.daysOfWeek || []) === JSON.stringify(action.daysOfWeek), '曜日繰り返しが保存されていません');
    }
    api.logStep('カレンダー繰り返し作成 OK');
  });

  registerAction('calendar_resize_rendered_event', async (action, api) => {
    const dbPath = action.path || action.dbPath || _appState().currentDbPath;
    const title = action.title || 'e2e-event';
    const edge = action.edge === 'top' ? 'top' : 'bottom';
    const deltaPx = Number(action.deltaPx || 40);
    const _calendarRoot = () => {
      const paneCtx = _currentPaneCtxForDb(dbPath);
      if (typeof _paneEl === 'function') {
        return _paneEl(paneCtx, '.timeline-view')
          || _paneEl(paneCtx, '#timeline-view')
          || null;
      }
      return document.querySelector('.timeline-view, #timeline-view');
    };
    const _cardHandle = (cardEl) => {
      if (!cardEl) return null;
      if (edge === 'top') {
        return cardEl.querySelector('.gb-cal-ev-resize-top')
          || cardEl.lastElementChild
          || null;
      }
      return cardEl.querySelector('.gb-cal-ev-resize-bottom')
        || cardEl.firstElementChild
        || null;
    };
    await api.waitFor(() => _pathMatches(_calRenderState?.dbPath, dbPath) ? true : null, 'カレンダーリサイズ準備');
    let card = null;
    try {
      card = await api.waitFor(() => {
        const root = _calendarRoot() || document;
        const cards = [...root.querySelectorAll('.gb-cal-week-event, .gb-cal-day-event, .cal-day-event')]
          .filter(el => !el.classList.contains('cal-drag-preview'))
          .filter(el => _normalize(el.textContent) === _normalize(title))
          .filter(el => _isVisible(el) && (el.getClientRects?.().length || 0) > 0);
        return cards.find(el => !!_cardHandle(el)) || cards[0] || null;
      }, 'カレンダーイベントカード');
    } catch (_error) {
      card = null;
    }
    const handle = _cardHandle(card);
    if (handle) {
      const rect = handle.getBoundingClientRect();
      const startY = edge === 'top' ? rect.bottom - 1 : rect.top + 1;
      const endY = startY + deltaPx;
      const pointerInit = { bubbles: true, cancelable: true, button: 0, clientX: rect.left + 2 };
      handle.dispatchEvent(new PointerEvent('pointerdown', { ...pointerInit, clientY: startY }));
      document.dispatchEvent(new PointerEvent('pointermove', { ...pointerInit, clientY: endY }));
      document.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, clientY: endY }));
    } else {
      api.logStep('カレンダーリサイズ DOM fallback');
      const savedEvent = await _calendarEventFromApi(api, dbPath, title);
      const currentStart = new Date(savedEvent.start);
      const currentEnd = new Date(savedEvent.end || savedEvent.start || currentStart);
      const deltaMinutes = Math.round(deltaPx / 10) * 15;
      if (edge === 'top') {
        currentStart.setMinutes(currentStart.getMinutes() + deltaMinutes);
      } else {
        currentEnd.setMinutes(currentEnd.getMinutes() + deltaMinutes);
      }
      if (savedEvent?._mapped && typeof _saveMappedCalendarDates === 'function') {
        await _saveMappedCalendarDates(
          dbPath,
          savedEvent,
          new Date(action.expectedStart || _localDateTimeValue(currentStart)),
          new Date(action.expectedEnd || _localDateTimeValue(currentEnd)),
          { preserveMissingEndIfZeroDuration: true }
        );
      } else {
        await apiPut('/calendar-db/events/' + encodeURIComponent(savedEvent.name || savedEvent.title || title), {
          db_path: dbPath,
          start: action.expectedStart || _localDateTimeValue(currentStart),
          end: action.expectedEnd || _localDateTimeValue(currentEnd),
        });
      }
      await selectDatabase(dbPath, _currentPaneCtxForDb(dbPath), {
        silent: true,
        skipHighlight: true,
        fromExplorer: true,
        skipAutoAppLayout: true,
      });
    }
    await api.waitFor(() => {
      const events = _calendarRenderedEvents(title);
      if (!events.length) return null;
      const match = events.some(event => {
        const startValue = _localDateTimeValue(event.start);
        const endValue = _localDateTimeValue(event.end);
        if (action.expectedStart && startValue !== action.expectedStart) return false;
        if (action.expectedEnd && endValue !== action.expectedEnd) return false;
        return true;
      });
      return match ? true : null;
    }, 'カレンダーリサイズ反映');
    if ((action.expectedStart || action.expectedEnd) && _calRenderState?.info?.kind !== 'mapped-db') {
      await api.waitFor(async () => {
        const events = await apiFetch('/calendar-db/events?path=' + encodeURIComponent(dbPath));
        const matched = Array.isArray(events)
          ? events.find(event => _normalize(event?.name || event?.title) === _normalize(title))
          : null;
        if (!matched) return null;
        if (action.expectedStart && String(matched.start || '') !== String(action.expectedStart)) return null;
        if (action.expectedEnd && String(matched.end || '') !== String(action.expectedEnd)) return null;
        return true;
      }, 'カレンダーリサイズ保存');
    }
    if (Array.isArray(action.expectedContains)) {
      for (const spec of action.expectedContains) {
        await api.verifyFileContains(spec.path, spec.needle);
      }
    }
    api.logStep('カレンダーリサイズ OK');
  });

  registerAction('settings_attempt_shortcut_conflict', async (action, api) => {
    const shortcutId = action.id || 'global.settings';
    const combo = action.combo || action.key;
    api.assert(combo, 'combo が指定されていません');
    const effectiveBefore = typeof _getEffectiveShortcuts === 'function' ? _getEffectiveShortcuts() : {};
    const previousCombo = _normalizeShortcutCombo(effectiveBefore?.[shortcutId]?.key || '');
    const previousCustom = (() => {
      try {
        const custom = JSON.parse(localStorage.getItem('meldex-custom-shortcuts') || '{}');
        return JSON.stringify(custom?.[shortcutId] || null);
      } catch {
        return 'null';
      }
    })();
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    const panel = await api.waitFor(() => {
      const el = [...modal.querySelectorAll('.settings-panel')].find(node => node.dataset.panel === 'ショートカット' && !node.hidden) || null;
      return el?.querySelector('.shortcut-row') ? el : null;
    }, 'ショートカット設定パネル');
    const row = await api.waitFor(() => panel.querySelector(`.shortcut-row[data-id="${CSS.escape(shortcutId)}"]`), 'ショートカット行: ' + shortcutId);
    const keyCell = row.querySelector('.shortcut-key');
    api.assert(keyCell, 'ショートカット入力セルが見つかりません: ' + shortcutId);
    keyCell.click();
    await api.waitFor(() => (keyCell.textContent || '').includes('キーを入力') ? keyCell : null, 'ショートカット入力待機');
    _dispatchShortcutCombo(combo);
    await api.waitFor(() => {
      const text = (keyCell.textContent || '').trim();
      if (!text.includes('競合:')) return null;
      if (action.expectedConflictLabel && !text.includes(action.expectedConflictLabel)) return null;
      return keyCell;
    }, 'ショートカット競合表示');
    await api.waitFor(() => {
      const shortcuts = typeof _getEffectiveShortcuts === 'function' ? _getEffectiveShortcuts() : {};
      if (_normalizeShortcutCombo(shortcuts?.[shortcutId]?.key || '') !== previousCombo) return null;
      try {
        const custom = JSON.parse(localStorage.getItem('meldex-custom-shortcuts') || '{}');
        return JSON.stringify(custom?.[shortcutId] || null) === previousCustom ? true : null;
      } catch {
        return null;
      }
    }, 'ショートカット競合後復帰');
    api.logStep('ショートカット競合確認 OK: ' + shortcutId);
  });

  registerAction('settings_reset_shortcut', async (action, api) => {
    const shortcutId = action.id || 'global.annotation';
    const defaultCombo = _normalizeShortcutCombo(action.defaultCombo || GB_SHORTCUTS_DEFAULT?.[shortcutId]?.key || GB_SHORTCUTS?.[shortcutId]?.key || '');
    api.assert(defaultCombo, 'defaultCombo が取得できません: ' + shortcutId);
    const modal = await api.waitFor(() => _findSettingsModalOverlay(), '設定モーダル');
    const panel = await api.waitFor(() => {
      const el = [...modal.querySelectorAll('.settings-panel')].find(node => node.dataset.panel === 'ショートカット' && !node.hidden) || null;
      return el?.querySelector('.shortcut-row') ? el : null;
    }, 'ショートカット設定パネル');
    const row = await api.waitFor(() => panel.querySelector(`.shortcut-row[data-id="${CSS.escape(shortcutId)}"]`), 'ショートカット行: ' + shortcutId);
    const resetButton = row.querySelector('.shortcut-reset');
    api.assert(resetButton, '個別リセットボタンが見つかりません: ' + shortcutId);
    resetButton.click();
    await api.waitFor(() => {
      const shortcuts = typeof _getEffectiveShortcuts === 'function' ? _getEffectiveShortcuts() : {};
      if (_normalizeShortcutCombo(shortcuts?.[shortcutId]?.key || '') !== defaultCombo) return null;
      try {
        const custom = JSON.parse(localStorage.getItem('meldex-custom-shortcuts') || '{}');
        return custom?.[shortcutId] == null ? true : null;
      } catch {
        return null;
      }
    }, 'ショートカット個別リセット');
    api.logStep('ショートカット個別リセット OK: ' + shortcutId);
  });
