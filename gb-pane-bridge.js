/* gb-pane-bridge.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-pane-bridge.part01.js */
/* ==============================
   gb-pane-bridge.js: ペインシステム統合ブリッジ（v5.0 Phase C）

   旧レイアウト（#main-views, #right-panel, showView(), addTab()等）を
   v5.0 ペインシステム（GBLayout, GBTabs, GBDocking）に完全接続する。
   - showView() をペインコンテンツ管理に変換
   - レガシータブ → GBTabs 委譲
   - navPush() でペインタブを自動更新
   - 右パネル廃止 → ペインタブ化
   ============================== */

const GBPaneBridge = (() => {
  let _initialized = false;
  let _bridgeUpdating = 0; // 再帰防止（入れ子対応）
  let _outlinerLoaded = false; // loadOutliner初回のみフラグ

  // ビュータイプ → レガシーコンテナ要素ID
  // 注: login-viewはペインシステム外で管理（認証時のオーバーレイ）
  const LEGACY_CONTAINERS = {
    welcome:    'welcome-view',
    database:   'db-view-container',
    pivot:      'db-view-container',
    gallery:    'db-view-container',
    kanban:     'db-view-container',
    timeline:   'db-view-container',
    chart:      'db-view-container',
    graph:      'db-view-container',
    form:       'db-view-container',
    'smart-db': 'db-view-container',
    compare:    'compare-view',
    entity:     'entity-view',
    page:       'page-view',
    media:      'media-view',
    html:       'html-view',
    csv:        'csv-view',
    folder:     'folder-view',
  };

  // DB系サブビューID
  const DB_SUB_VIEWS = {
    pivot:      'pivot-view',
    gallery:    'gallery-view',
    kanban:     'kanban-view',
    timeline:   'timeline-view',
    chart:      'chart-view',
    graph:      'graph-view',
    form:       'form-view',
    'smart-db': 'smart-db-view',
  };

  // ToolComponentで描画するタイプ（レガシーコンテナを使わない、独自DOM生成）
  const COMPONENT_TYPES = new Set(['calendar', 'search', 'scriptnote', 'version', 'board', 'timer']);

  // 右パネルから移行するコンテナ（レガシーコンテナとして管理）
  const RP_CONTAINERS = {
    chat:       'rp-chat',
    annotation: 'rp-annotation',
    sticky:     'rp-annotation',
    history:    'rp-history',
  };

  // 特殊パネルコンテナ（サイドバー・詳細パネル等、丸ごとペインに移動）
  const PANEL_CONTAINERS = {
    outliner:   'sidebar',
    detail:     'rp-detail',
    preview:    'gb-preview-pane',
  };
  const TOOL_LABELS = Object.freeze({
    outliner: 'フォルダツリー',
    detail: 'オプション',
    preview: 'ビューワー',
    calendar: 'カレンダー',
    timer: 'タイマー',
    chat: 'チャット',
    annotation: '注釈',
    history: 'ヒストリー',
    sticky: '付箋',
    scriptnote: 'シナリオ',
    search: '検索',
    version: 'バージョン管理',
    page: 'ノート',
    database: 'シート',
    pivot: 'シート',
    gallery: 'シート',
    kanban: 'シート',
    timeline: 'シート',
    chart: 'シート',
    graph: 'シート',
    form: 'シート',
    board: 'ボード',
    'smart-db': 'スマートシート',
    folder: 'フォルダ',
    entity: 'エントリ',
    media: 'メディア',
    html: 'HTML',
    csv: 'CSV',
    compare: '比較',
  });
  const FLOATING_UI_CONTAINERS = ['ann-overlay', 'btn-tb-annotation'];
  // コンテナID → 現在配置ペインID
  const _containerPane = {};
  const _legacySnapshots = new Map(); // tabId -> cloned DOM
  const _legacySnapshotHosts = new Map(); // tabId -> host element
  const _legacyLiveBindings = new Map(); // containerId -> { paneId, tabId, viewName, observer }
  const _legacySnapshotTimers = new Map();
  const _legacyLoadJobs = new Map(); // containerId -> { tabId, viewName, path, token, promise }
  let _domLookupPatched = false;
  const _bridgeOpenOpts = Object.freeze({
    bridgeLoad: true,
    skipShowView: true,
    skipNavPush: true,
    skipSaveLastView: true,
    skipRecent: true,
    skipAutoVersion: true,
    skipHighlight: true,
    skipHistoryScope: true,
  });
  const _bridgePassiveOpenOpts = Object.freeze({
    ..._bridgeOpenOpts,
    skipGlobalUi: true,
    skipStateView: true,
  });
  function _isDesktopStartupRestore() {
    if (!window._meldexStartupRestoring) return false;
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.get('desktop') === '1' || document.documentElement?.dataset?.desktopLaunch === '1';
    } catch {
      return false;
    }
  }
  function _yieldStartupRestorePaint() {
    if (!_isDesktopStartupRestore()) return Promise.resolve();
    if (typeof _hideStartupSplash === 'function') {
      try { _hideStartupSplash(); } catch {}
    }
    return new Promise(resolve => {
      const done = () => setTimeout(resolve, 0);
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done);
      else done();
    });
  }

  function _beginBridgeUpdate() {
    _bridgeUpdating += 1;
  }

  function _endBridgeUpdate() {
    _bridgeUpdating = Math.max(0, _bridgeUpdating - 1);
  }

  function _isPathScopedLegacyType(type) {
    return ['database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db', 'entity', 'page', 'media', 'html', 'folder', 'board', 'compare'].includes(type);
  }

  function _legacySnapshotKey(tab) {
    if (!tab) return '';
    return _isPathScopedLegacyType(tab.type)
      ? (tab.type + '::' + (tab.path || ''))
      : (tab.type + '::tab:' + tab.id);
  }

  // panelset 非アクティブグループのタブは操作対象外なので除外する
  function _allLayoutTabs() {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return [];
    const tabs = [];
    for (const pane of GBLayout.getAllPanes(GBLayout.root, { activeOnly: true })) {
      for (const tab of (pane.tabs || [])) tabs.push(tab);
    }
    return tabs;
  }

  function _patchDomLookupForSnapshots() {
    if (_domLookupPatched || typeof document === 'undefined' || !document.getElementById) return;
    const nativeGetElementById = Document.prototype.getElementById;
    const escapeId = (value) => {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    };
    const isSnapshotNode = (el) => !!el?.closest?.('[data-gb-snapshot="true"]');
    Document.prototype.getElementById = function(id) {
      const first = nativeGetElementById.call(this, id);
      if (!first || !isSnapshotNode(first)) return first;
      const matches = this.querySelectorAll('[id="' + escapeId(id) + '"]');
      for (const el of matches) {
        if (!isSnapshotNode(el)) return el;
      }
      return first;
    };
    _domLookupPatched = true;
  }

  // ================================================================
  // 初期化
  // ================================================================
  // Phase 6: 起動時URLパラメータ解析。?subwindow=1 で chrome を非表示化、
  // ?open=<type>&path=<path>&label=<label> でメインペインに指定タブを開く。
  function _bootstrapFromURL() {
    try {
      const params = new URLSearchParams(location.search || '');
      const subwindow = params.get('subwindow') === '1';
      const openType = params.get('open');
      const openPath = params.get('path') || '';
      const openLabel = params.get('label') || '';
      if (subwindow) {
        document.body.classList.add('gb-subwindow-mode');
      }
      return { subwindow, openType, openPath, openLabel };
    } catch (e) {
      return { subwindow: false, openType: null, openPath: '', openLabel: '' };
    }
  }

  function init() {
    if (_initialized) return;
    _patchDomLookupForSnapshots();

    // Phase 6: URL パラメータ解析を init 最初で実行
    const _bootParams = _bootstrapFromURL();
    window.__meldexBootParams = _bootParams;

    // 1. レガシービューコンテナをストレージに退避
    _createLegacyStorage();

    // 2. レンダリングフック設定（GBLayout.init → render の前に）
    GBLayout.onPreRender = _beforeRender;
    GBLayout.onPostRender = _afterRender;
    GBLayout.onActivePaneChange = _onActivePaneChange;
    GBLayout.isNavPaneType = (type) => NAV_PANE_TYPES.has(type);
    GBLayout.isPassivePaneType = (type, tab) => _isPassiveToolPaneTab(type, tab);

    // 3. GBLayout 初期化（#gb-layout-root が必要）
    const layoutRoot = document.getElementById('gb-layout-root');
    if (!layoutRoot) { console.error('[PaneBridge] #gb-layout-root not found'); return; }
    GBLayout.init(layoutRoot);

    // 詳細パネルのタブシェルを初期化（Phase 5以降は lazy 注入のため、早期に確保する）
    const rpDetail = document.getElementById('rp-detail');
    if (rpDetail && typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(rpDetail);

    // 4. レガシータブバーを非表示
    const tabBar = document.getElementById('tab-bar');
    if (tabBar) tabBar.style.display = 'none';

    // 5. 関数オーバーライド
    _overrideShowView();
    _overrideNavPush();
    _overrideLegacyTabs();
    _overrideRightPanel();
    _setupKeyboardRouting();

    // 6. デフォルトレイアウト構築（保存レイアウトがない場合のみ）
    const mainPane = GBLayout.findFirstPane(GBLayout.root);
    if (mainPane && (!mainPane.tabs || mainPane.tabs.length === 0)) {
      // Phase 6: URL パラメータ ?open= が指定されていれば、サブウィンドウ向け単独タブを構築
      if (_bootParams?.openType) {
        const tab = GBTabs.createTab(
          _bootParams.openLabel || _bootParams.openType,
          _bootParams.openType,
          _bootParams.openPath || ''
        );
        mainPane.tabs = [tab];
        mainPane.activeTabIndex = 0;
        if (typeof GBLayout?.render === 'function') GBLayout.render();
        if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
        // サブウィンドウとして broadcast
        if (_bootParams.subwindow && typeof GBBroadcast?.notifySubwindowReady === 'function') {
          GBBroadcast.notifySubwindowReady({ type: _bootParams.openType, path: _bootParams.openPath });
        }
      } else {
        _buildDefaultLayout(mainPane);
      }
    }

    _initialized = true;
  }

  // ================================================================
  // デフォルトレイアウト構築
  // ================================================================
  function _buildDefaultLayout(mainPane) {
    if (typeof GBPaneDefaultLayout !== 'undefined' && typeof GBPaneDefaultLayout.build === 'function') {
      GBPaneDefaultLayout.build({ mainPane });
      return;
    }
    console.error('[GBPaneBridge] GBPaneDefaultLayout is not loaded');
  }

  // ================================================================
  // レガシービュー退避
  // ================================================================
  function _createLegacyStorage() {
    let storage = document.getElementById('legacy-views');
    if (!storage) {
      storage = document.createElement('div');
      storage.id = 'legacy-views';
      storage.style.cssText = 'display:none;';
      document.body.appendChild(storage);
    }
    // メインビューのレガシーコンテナを退避
    const moved = new Set();
    for (const id of Object.values(LEGACY_CONTAINERS)) {
      if (moved.has(id)) continue;
      const el = document.getElementById(id);
      if (el && el.parentNode) {
        el.style.display = 'none';
        storage.appendChild(el);
        moved.add(id);
      }
    }
    // 右パネルのコンテナも退避（ペインタブとして使用）
    for (const id of Object.values(RP_CONTAINERS)) {
      const el = document.getElementById(id);
      if (el && el.parentNode) {
        el.style.display = 'none';
        storage.appendChild(el);
      }
    }
    // 特殊パネルコンテナ退避（サイドバー、詳細パネル）
    for (const id of Object.values(PANEL_CONTAINERS)) {
      let el = document.getElementById(id);
      if (!el && id === 'gb-preview-pane') {
        // プレビューペインを動的生成
        el = document.createElement('div');
        el.id = 'gb-preview-pane';
        el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:auto;align-items:center;justify-content:center;background:var(--bg);padding:16px;';
        el.innerHTML = '<div style="color:var(--fg2);font-size:13px;">ファイルを選択するとプレビューが表示されます</div>';
      }
      if (el && el.parentNode) {
        el.style.display = 'none';
        storage.appendChild(el);
      } else if (el) {
        el.style.display = 'none';
        storage.appendChild(el);
      }
    }
    for (const id of FLOATING_UI_CONTAINERS) {
      const el = document.getElementById(id);
      if (el && el.parentNode) {
        storage.appendChild(el);
      }
    }
  }

  function _getLegacyUiState(tab) {
    return (tab && tab.state && tab.state._legacyPaneUi) ? tab.state._legacyPaneUi : null;
  }

  function _setLegacyUiState(tab, data) {
    if (!tab || !data) return;
    if (!tab.state) tab.state = {};
    tab.state._legacyPaneUi = data;
  }

  const _detailTabIds = ['note-editor', 'db-property-settings', 'sn2-main', 'calendar-today', 'board-card', 'board-line', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style'];
  const _detailScrollSelectors = ['__root__', '#detail-tab-note-editor', '#detail-tab-db-property-settings', '#detail-tab-sn2-main', '#detail-tab-calendar-today', '#detail-tab-board-card', '#detail-tab-board-line', '#detail-tab-board-note', '#detail-tab-board-card-style', '#detail-tab-board-line-style', '#detail-tab-board-depth-style'];
  const _viewScrollSelectors = {
    page: ['#page-content'],
    entity: ['#entity-view'],
    folder: ['#folder-grid'],
    media: ['#media-view'],
    pivot: ['#pivot-view'],
    gallery: ['#gallery-view'],
    kanban: ['#kanban-view'],
    timeline: ['#timeline-view'],
    chart: ['#chart-view'],
    graph: ['#graph-view'],
    form: ['#form-view'],
    'smart-db': ['#smart-db-view'],
    detail: _detailScrollSelectors.slice(1),
    preview: ['#gb-preview-pane'],
    chat: ['__root__'],
    annotation: ['__root__'],
    history: ['__root__'],
    outliner: ['__root__'],
  };

  function _scopedSelector(root, selector) {
    if (!root) return null;
    if (selector === '__root__') return root;
    return root.querySelector(selector);
  }

  function _captureScrollState(root, selectors) {
    const items = [];
    for (const selector of (selectors || [])) {
      const el = _scopedSelector(root, selector);
      if (!el) continue;
      items.push({ selector, left: el.scrollLeft || 0, top: el.scrollTop || 0 });
    }
    return items;
  }

  function _applyScrollState(root, scrolls) {
    for (const item of (scrolls || [])) {
      const el = _scopedSelector(root, item.selector);
      if (!el) continue;
      el.scrollLeft = item.left || 0;
      el.scrollTop = item.top || 0;
    }
  }

  function _applyScopedDetailTab(root, tabName) {
    if (!root || !tabName) return;
    const normalizedTab = typeof _normalizeDetailTab === 'function' ? _normalizeDetailTab(tabName) : tabName;
    const bar = root.querySelector('#detail-tab-bar');
    if (!bar) return;
    bar.querySelectorAll('.gb-inner-tab, .detail-tab').forEach(t => {
      const active = t.dataset.detailTab === normalizedTab;
      t.classList.toggle('gb-inner-tab-active', active);
      t.classList.toggle('active', active);
      // 旧インライン style が残っていれば除去（CSS クラス優先）
      t.style.borderBottomColor = '';
      t.style.color = '';
      t.style.fontWeight = '';
    });
    _detailTabIds.forEach(id => {
      const el = root.querySelector('#detail-tab-' + id);
      if (!el) return;
      const isSn2 = normalizedTab && normalizedTab.startsWith('sn2-');
      const show = id === normalizedTab || (id === 'sn2-main' && isSn2);
      el.hidden = !show;
      // 旧 style.display 直書換の残留をクリア
      el.style.display = '';
    });
  }

  function _captureLegacyDomState(viewName, root) {
    if (!root) return null;
    const state = {
      scrolls: _captureScrollState(root, ['__root__', ...(_viewScrollSelectors[viewName] || [])]),
    };
    if (viewName === 'board') {
      const canvas = root.querySelector('[data-bd-role="canvas"]');
      const world = root.querySelector('[data-bd-role="world"]');
      state.board = {
        className: canvas?.className || '',
        background: canvas?.style.background || '',
        transform: world?.style.transform || '',
      };
      if (typeof bd !== 'undefined') {
        state.board.panX = bd.panX;
        state.board.panY = bd.panY;
        state.board.zoom = bd.zoom;
        state.board.rotation = bd.rotation;
      }
    }
    if (viewName === 'detail' || viewName === 'scriptnote') {
      state.detailTab = root.querySelector('.detail-tab.active')?.dataset.detailTab
        || (typeof _currentDetailTab !== 'undefined' ? _currentDetailTab : null);
    }
    return state;
  }

  function _applyLegacyDomState(viewName, root, savedState, options) {
    if (!root || !savedState) return;
    const live = !!options?.live;
    if ((viewName === 'detail' || viewName === 'scriptnote') && savedState.detailTab) {
      if (live && typeof switchDetailTab === 'function') switchDetailTab(savedState.detailTab);
      else _applyScopedDetailTab(root, savedState.detailTab);
    }
    if (viewName === 'board' && savedState.board) {
      const canvas = root.querySelector('[data-bd-role="canvas"]');
      const world = root.querySelector('[data-bd-role="world"]');
      if (canvas) {
        if (savedState.board.className) canvas.className = savedState.board.className;
        if (savedState.board.background) canvas.style.background = savedState.board.background;
      }
      if (live && typeof bd !== 'undefined') {
        if (savedState.board.panX != null) bd.panX = savedState.board.panX;
        if (savedState.board.panY != null) bd.panY = savedState.board.panY;
        if (savedState.board.zoom != null) bd.zoom = savedState.board.zoom;
        if (savedState.board.rotation != null) bd.rotation = savedState.board.rotation;
        if (typeof bdTransform === 'function') bdTransform();
      } else if (world && savedState.board.transform) {
        world.style.transform = savedState.board.transform;
      }
    }
    _applyScrollState(root, savedState.scrolls);
  }

  function _findTabById(tabId) {
    return _allLayoutTabs().find(t => t.id === tabId) || null;
  }

  function _getTabContainerId(type) {
    return LEGACY_CONTAINERS[type] || PANEL_CONTAINERS[type] || RP_CONTAINERS[type] || '';
  }

  function _needsLegacySnapshot(containerId, tabId) {
    if (!containerId) return false;
    let count = 0;
    for (const tab of _allLayoutTabs()) {
      if (_getTabContainerId(tab.type) !== containerId) continue;
      if (tab.id === tabId) continue;
      count += 1;
      if (count > 0) return true;
    }
    return false;
  }

  function _teardownSnapshotHost(tabId) {
    const host = _legacySnapshotHosts.get(tabId);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    _legacySnapshotHosts.delete(tabId);
  }

  function _renderSnapshotIntoHost(host, snapshot) {
    if (!host || !snapshot) return;
    host.replaceChildren(snapshot.cloneNode(true));
  }

  function _mergedSnapshotClone(viewName, sourceClone, targetTab, existingClone) {
    if (!sourceClone) return null;
    const next = sourceClone.cloneNode(true);
    const preserved = existingClone ? _captureLegacyDomState(viewName, existingClone) : _getLegacyUiState(targetTab);
    _applyLegacyDomState(viewName, next, preserved, { live: false });
    return next;
  }

  function _syncMirroredSnapshots(sourceTab, viewName, sourceClone) {
    const key = _legacySnapshotKey(sourceTab);
    for (const targetTab of _allLayoutTabs()) {
      if (targetTab.id === sourceTab.id) continue;
      if (_legacySnapshotKey(targetTab) !== key) continue;
      const host = _legacySnapshotHosts.get(targetTab.id);
      const existingClone = host?.firstElementChild || _legacySnapshots.get(targetTab.id) || null;
      const merged = _mergedSnapshotClone(viewName, sourceClone, targetTab, existingClone);
      if (!merged) continue;
      _legacySnapshots.set(targetTab.id, merged);
      if (host && host.isConnected) _renderSnapshotIntoHost(host, merged);
    }
  }

  function _captureLegacySnapshotForTab(tab, viewName, viewEl) {
    if (!tab || !viewEl) return;
    _setLegacyUiState(tab, _captureLegacyDomState(viewName, viewEl));
    const clone = viewEl.cloneNode(true);
    _legacySnapshots.set(tab.id, clone);
    _syncMirroredSnapshots(tab, viewName, clone);
  }

  function _scheduleLegacySnapshot(tab, viewName, viewEl) {
    if (!tab || !viewEl) return;
    if (_legacySnapshotTimers.has(tab.id)) return;
    const timer = setTimeout(() => {
      _legacySnapshotTimers.delete(tab.id);
      _captureLegacySnapshotForTab(tab, viewName, viewEl);
    }, 80);
    _legacySnapshotTimers.set(tab.id, timer);
  }

  function _teardownLiveBinding(containerId, captureSnapshot) {
    const binding = _legacyLiveBindings.get(containerId);
    if (!binding) return;
    if (captureSnapshot) {
      const viewEl = document.getElementById(containerId);
      const tab = _findTabById(binding.tabId);
      if (tab && viewEl) _captureLegacySnapshotForTab(tab, binding.viewName, viewEl);
    }
    if (binding.observer) binding.observer.disconnect();
    _legacyLiveBindings.delete(containerId);
  }

  function _bindLiveLegacyContainer(containerId, paneId, tab, viewName, viewEl) {
    const shouldTrackSnapshot = _needsLegacySnapshot(containerId, tab.id);
    const binding = _legacyLiveBindings.get(containerId);
    if (binding && binding.tabId === tab.id && binding.paneId === paneId) {
      if (binding.observer && !shouldTrackSnapshot) {
        binding.observer.disconnect();
        binding.observer = null;
      } else if (!binding.observer && shouldTrackSnapshot) {
        binding.observer = new MutationObserver(() => _scheduleLegacySnapshot(tab, viewName, viewEl));
        binding.observer.observe(viewEl, { childList: true, subtree: true, attributes: true, characterData: true });
      }
      if (shouldTrackSnapshot) _scheduleLegacySnapshot(tab, viewName, viewEl);
      return;
    }
    _teardownLiveBinding(containerId, shouldTrackSnapshot);
    let observer = null;
    if (shouldTrackSnapshot) {
      observer = new MutationObserver(() => _scheduleLegacySnapshot(tab, viewName, viewEl));
      observer.observe(viewEl, { childList: true, subtree: true, attributes: true, characterData: true });
    }
    _legacyLiveBindings.set(containerId, { containerId, paneId, tabId: tab.id, viewName, observer });
    if (shouldTrackSnapshot) _scheduleLegacySnapshot(tab, viewName, viewEl);
  }

  function _captureAllLiveLegacySnapshots() {
    for (const binding of _legacyLiveBindings.values()) {
      const viewEl = document.getElementById(binding.containerId);
      const tab = _findTabById(binding.tabId);
      if (tab && viewEl && _needsLegacySnapshot(binding.containerId, binding.tabId)) {
        _captureLegacySnapshotForTab(tab, binding.viewName, viewEl);
      }
      if (binding.observer) binding.observer.disconnect();
    }
    _legacyLiveBindings.clear();
  }

  function _stopSnapshotInteraction(ev, preventDefault) {
    if (!ev) return;
    if (preventDefault && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    if (typeof ev.stopPropagation === 'function') ev.stopPropagation();
  }

  function _snapshotClickInit(ev) {
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      screenX: ev?.screenX || 0,
      screenY: ev?.screenY || 0,
      clientX: ev?.clientX || 0,
      clientY: ev?.clientY || 0,
      ctrlKey: !!ev?.ctrlKey,
      shiftKey: !!ev?.shiftKey,
      altKey: !!ev?.altKey,
      metaKey: !!ev?.metaKey,
      button: 0,
      buttons: 0,
    };
  }

  function _replaySnapshotClick(paneId, eventState) {
    const target = document.elementFromPoint(eventState.clientX, eventState.clientY);
    if (!target || target.closest?.('.gb-legacy-snapshot-host')) return;
    const paneEl = target.closest?.('.gb-pane');
    if (paneId && paneEl?.dataset?.paneId !== paneId) return;
    try {
      target.dispatchEvent(new MouseEvent('click', _snapshotClickInit(eventState)));
    } catch {}
  }

  function _recoverSnapshotClick(paneId, ev) {
    if (!paneId || (ev.button != null && ev.button !== 0)) return;
    const eventState = {
      clientX: ev.clientX,
      clientY: ev.clientY,
      screenX: ev.screenX,
      screenY: ev.screenY,
      ctrlKey: ev.ctrlKey,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      metaKey: ev.metaKey,
    };
    _stopSnapshotInteraction(ev, true);
    if (typeof GBLayout !== 'undefined' && typeof GBLayout.setActivePane === 'function') {
      GBLayout.setActivePane(paneId, { sync: true });
    }
    const replay = () => _replaySnapshotClick(paneId, eventState);
    setTimeout(() => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(replay);
      else replay();
    }, 0);
  }

  function _installSnapshotInteractionRecovery(host, paneId) {
    if (!host || !paneId) return;
    host.addEventListener('mousedown', (ev) => _stopSnapshotInteraction(ev, false), true);
    host.addEventListener('pointerdown', (ev) => _stopSnapshotInteraction(ev, false), true);
    host.addEventListener('click', (ev) => _recoverSnapshotClick(paneId, ev), true);
    host.addEventListener('contextmenu', (ev) => _stopSnapshotInteraction(ev, true), true);
  }

  function _showLegacySnapshotInPane(paneId, contentEl, tab, viewName) {
    const host = document.createElement('div');
    host.className = 'gb-legacy-snapshot-host';
    host.dataset.gbSnapshot = 'true';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;pointer-events:auto;user-select:none;';
    _installSnapshotInteractionRecovery(host, paneId);
    contentEl.querySelectorAll('.gb-legacy-snapshot-host').forEach(el => el.remove());
    contentEl.appendChild(host);
    _legacySnapshotHosts.set(tab.id, host);

    let sourceClone = _legacySnapshots.get(tab.id);
    if (!sourceClone) {
      const liveTab = _findTabById(_legacyLiveBindings.get(LEGACY_CONTAINERS[viewName] || PANEL_CONTAINERS[viewName] || RP_CONTAINERS[viewName])?.tabId || '');
      if (liveTab && _legacySnapshotKey(liveTab) === _legacySnapshotKey(tab)) {
        sourceClone = _legacySnapshots.get(liveTab.id);
      }
    }
    if (!sourceClone) {
      host.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;flex:1;color:var(--fg2);font-size:13px;">表示を準備中...</div>';
      return;
    }
    const merged = _mergedSnapshotClone(viewName, sourceClone, tab, host.firstElementChild || _legacySnapshots.get(tab.id));
    _legacySnapshots.set(tab.id, merged);
    _renderSnapshotIntoHost(host, merged);
  }

  function _scheduleLegacyStateRestore(tab, viewName, containerId) {
    const savedState = _getLegacyUiState(tab);
    if (!savedState) return;
    [0, 80, 220].forEach(delay => {
      setTimeout(() => {
        const binding = _legacyLiveBindings.get(containerId);
        if (!binding || binding.tabId !== tab.id) return;
        const root = document.getElementById(containerId);
        if (root) _applyLegacyDomState(viewName, root, savedState, { live: true });
      }, delay);
    });
  }

  function _ensureLegacyTabContent(tab, viewName, containerId, openOpts) {
    const label = tab.label || '';
    const path = tab.path || '';
    const viewEl = document.getElementById(containerId);
    const bridgeOpts = openOpts || _bridgeOpenOpts;
    if (!path) {
      _scheduleLegacyStateRestore(tab, viewName, containerId);
      return;
    }
    const existingJob = _legacyLoadJobs.get(containerId);
    if (existingJob && existingJob.tabId === tab.id && existingJob.viewName === viewName && existingJob.path === path) {
      _scheduleLegacyStateRestore(tab, viewName, containerId);
      return;
    }
    const liveView = viewEl?.dataset?.gbLegacyView || '';
    const livePath = viewEl?.dataset?.gbLegacyPath || '';
    const needsLiveReload = liveView !== viewName || livePath !== path;
    const token = {};
    const run = async () => {
      try {
        const prevView = state.view;
        const prevPagePath = state.currentPagePath;
        const prevEntityPath = state.currentEntityPath;
        const prevBoardPath = state.currentBoardPath;
        const prevCsvPath = (typeof _csvPath !== 'undefined') ? _csvPath : '';
        const prevSmartDbPath = state.currentSmartDb?._filePath || (state.currentSmartDb?.id ? 'smart-db:' + state.currentSmartDb.id : '');
        if (viewEl) {
          viewEl.dataset.gbLegacyView = viewName;
          viewEl.dataset.gbLegacyPath = path;
        }
        _beginBridgeUpdate();
        await _yieldStartupRestorePaint();
        if (viewName === 'board' && typeof openBoard === 'function' && (needsLiveReload || prevBoardPath !== path || prevView !== 'board')) await openBoard(label, path, bridgeOpts);
        else if (viewName === 'folder' && typeof openFolder === 'function' && (needsLiveReload || _folderPath !== path || prevView !== 'folder')) await openFolder(label, path, bridgeOpts);
        else if (viewName === 'page' && typeof openPage === 'function' && (needsLiveReload || prevPagePath !== path || prevView !== 'page')) await openPage(label, path, bridgeOpts);
        else if (viewName === 'entity' && typeof selectEntity === 'function' && (needsLiveReload || prevEntityPath !== path || prevView !== 'entity')) await selectEntity(path, bridgeOpts);
        else if (viewName === 'media' && typeof openMedia === 'function' && (needsLiveReload || prevPagePath !== path || prevView !== 'media')) openMedia(label, path, tab.state?.mediaType || 'image', bridgeOpts);
        else if (viewName === 'csv' && typeof openCsvFile === 'function' && (needsLiveReload || prevCsvPath !== path || prevView !== 'csv')) await openCsvFile(label, path, bridgeOpts);
        else if (viewName === 'smart-db' && typeof openSmartDbFile === 'function' && (needsLiveReload || prevSmartDbPath !== path || prevView !== 'smart-db')) await openSmartDbFile(label, path, bridgeOpts);
        else if (viewName === 'timeline' && tab.state?.calendarFile && typeof openCalendarFile === 'function' && (needsLiveReload || state.currentDbPath !== path || prevView !== 'timeline')) openCalendarFile(label, path, bridgeOpts);
        else if (['database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph'].includes(viewName) && typeof selectDatabase === 'function' && (needsLiveReload || state.currentDbPath !== path || prevView !== viewName)) await selectDatabase(path, null, bridgeOpts);
        else if (viewName === 'html' && typeof openViewer === 'function' && (needsLiveReload || prevPagePath !== path || prevView !== 'html')) {
          openViewer(tab.state?.urlExternal ? path : '/viewer?file=' + encodeURIComponent(path), bridgeOpts);
        }
        else if (viewName === 'compare' && typeof openCompare === 'function' && (needsLiveReload || prevView !== 'compare')) openCompare(label, path);
        else {
          state.view = viewName;
          if (viewName === 'page' || viewName === 'html' || viewName === 'media') state.currentPagePath = path;
          else if (viewName === 'entity') state.currentEntityPath = path;
          else if (viewName === 'board') state.currentBoardPath = path;
        }
        const boundViewEl = document.getElementById(containerId);
        if (boundViewEl && _legacyLoadJobs.get(containerId)?.token === token) {
          boundViewEl.dataset.gbLegacyView = viewName;
          boundViewEl.dataset.gbLegacyPath = path;
        }
      } finally {
        _endBridgeUpdate();
      }
    };
    const previousPromise = existingJob?.promise || Promise.resolve();
    const promise = previousPromise.catch(() => {}).then(run).finally(() => {
      if (_legacyLoadJobs.get(containerId)?.token === token) {
        _legacyLoadJobs.delete(containerId);
        _scheduleLegacyStateRestore(tab, viewName, containerId);
      }
    });
    _legacyLoadJobs.set(containerId, { tabId: tab.id, viewName, path, token, promise });
  }

  // ================================================================
  // レンダリングフック
  // ================================================================

  // render前: 管理下の要素をストレージに退避（innerHTML=''で消失させない）
  function _beforeRender() {
    const storage = document.getElementById('legacy-views');
    if (!storage) return;
    _captureAllLiveLegacySnapshots();
    _legacySnapshotHosts.clear();
    // レガシーコンテナを退避
    for (const containerId of Object.keys(_containerPane)) {
      const el = document.getElementById(containerId);
      if (el && el.parentNode && el.parentNode.id !== 'legacy-views') {
        el.style.display = 'none';
        storage.appendChild(el);
      }
    }
    // ツールバーをストレージに退避
    const appTb = document.getElementById('app-toolbar');
    if (appTb && appTb.parentNode && appTb.parentNode.id !== 'legacy-views') {
      appTb.classList.remove('visible');
      storage.appendChild(appTb);
    }
    for (const id of FLOATING_UI_CONTAINERS) {
      const el = document.getElementById(id);
      if (el && el.parentNode && el.parentNode.id !== 'legacy-views') {
        storage.appendChild(el);
      }
    }
    document.querySelectorAll('.ann-note:not(.ann-note-embedded)').forEach(note => {
      if (note.parentNode && note.parentNode.id !== 'legacy-views') {
        storage.appendChild(note);
      }
    });
    // コンポーネントの状態を保存してからDOMをデタッチ（参照は保持）
    // 全ペインのタブ情報を取得して状態を書き込む
    const _allLayoutPanes = typeof GBLayout !== 'undefined' && GBLayout.root
      ? (function _collect(n, r) { if (n.type==='pane') r.push(n); else if (n.children) n.children.forEach(c => _collect(c, r)); return r; })(GBLayout.root, [])
      : [];
    forEachComponent((comp, tabId) => {
      if (comp.getState) {
        try {
          const st = comp.getState();
          for (const p of _allLayoutPanes) {
            const tab = (p.tabs || []).find(t => t.id === tabId);
            if (tab) { tab.state = st; break; }
          }
        } catch (e) { console.warn('[PaneBridge] getState failed:', tabId, e); }
      }
      if (comp.el && comp.el.parentNode) {
        comp.el.parentNode.removeChild(comp.el);
        comp._mounted = false;
      }
    });
    // _containerPaneをクリア（afterRenderで再構築）
    for (const k of Object.keys(_containerPane)) delete _containerPane[k];
  }

  // render後: 各ペインのアクティブタブに応じてコンテンツをマウント
  function _afterRender() {
    _mountAllPanes();
    _pruneOrphanPaneState();
    // アクティブペインのタブタイプを state.view に同期
    _syncStateView();
    _mountFloatingAnnotationUi();
    // 詳細パネル・ビューワーをアクティブペインに同期
    _syncDetailForActivePane(GBLayout.activePane);
    // ツールボタンの active 状態をパネル表示状態に同期
    _syncToolButtonStates();
    if (typeof GBAppLayouts !== 'undefined' && typeof GBAppLayouts.syncButtons === 'function') {
      GBAppLayouts.syncButtons();
    }
    // render後のDOMに対してアイコン置換
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  function _pruneOrphanPaneState() {
    const validTabIds = new Set(_allLayoutTabs().map((tab) => tab.id));
    const orphanComponentIds = [];
    if (typeof forEachComponent === 'function') {
      forEachComponent((comp, tabId) => {
        if (!validTabIds.has(tabId)) orphanComponentIds.push(tabId);
      });
    }
    orphanComponentIds.forEach((tabId) => {
      if (typeof removeComponentInstance === 'function') removeComponentInstance(tabId);
    });
    [..._legacySnapshots.keys()].forEach((tabId) => {
      if (!validTabIds.has(tabId)) _legacySnapshots.delete(tabId);
    });
    [..._legacySnapshotHosts.entries()].forEach(([tabId, host]) => {
      if (validTabIds.has(tabId)) return;
      host?.remove?.();
      _legacySnapshotHosts.delete(tabId);
    });
    [..._legacySnapshotTimers.entries()].forEach(([tabId, timer]) => {
      if (validTabIds.has(tabId)) return;
      clearTimeout(timer);
      _legacySnapshotTimers.delete(tabId);
    });
    [..._legacyLoadJobs.entries()].forEach(([containerId, job]) => {
      if (validTabIds.has(job?.tabId)) return;
      _legacyLoadJobs.delete(containerId);
    });
    [..._legacyLiveBindings.entries()].forEach(([containerId, binding]) => {
      if (validTabIds.has(binding?.tabId)) return;
      try { binding?.observer?.disconnect?.(); } catch {}
      _legacyLiveBindings.delete(containerId);
    });
  }

  // ツールボタンのactive状態をパネル表示状態に同期
  // data-action属性からツールタイプを抽出し、パネルに存在するかで判定
  // Phase 4-A: chat/calendar/history/annotation はトップバーから除去済みのためマップから削除
  const _toolActionToType = {
    "toggleSidebar()":                'outliner',
    "toggleOptionPanel()":            'detail',
    "toggleDetailPanel()":            'detail',
    "toggleRightPanelTab('preview')": 'preview',
    "openCurrentVersionsTab()":       'version',
  };
  function _syncToolButtonStates() {
    for (const [action, type] of Object.entries(_toolActionToType)) {
      const btn = document.querySelector('button[data-action="' + action + '"]');
      if (btn) {
        let exists = false;
        if (type === 'version' && typeof GBLayout.getAllPanes === 'function') {
          exists = GBLayout.getAllPanes(GBLayout.root).some((pane) => (pane.tabs || []).some((tab) => tab.type === 'version'));
        } else {
          exists = !!GBTabs.findPaneWithTab(type, '');
        }
        btn.classList.toggle('active', exists);
      }
    }
  }

  function _paneHasVisibleManagedView(type) {
    if (!type) return false;
    const containerId = LEGACY_CONTAINERS[type];
    if (containerId) {
      const paneId = _containerPane[containerId] || '';
      return !!(paneId && typeof _isPaneActuallyVisible === 'function' && _isPaneActuallyVisible(paneId));
    }
    if (!COMPONENT_TYPES.has(type) || typeof GBLayout?.getAllPanes !== 'function') return false;
    return GBLayout.getAllPanes(GBLayout.root).some(pane => {
      const tab = pane?.tabs?.[pane.activeTabIndex];
      return tab?.type === type && (typeof _isPaneActuallyVisible !== 'function' || _isPaneActuallyVisible(pane.id));
    });
  }

  // アクティブペインのアクティブタブのtypeをstate.viewに同期する
  function _syncStateView() {
    let newView = null;
    let activePaneOwnsView = false;
    const isPaneManagedType = (type) => !!(type && (LEGACY_CONTAINERS[type] || COMPONENT_TYPES.has(type)));
    const isWorkManagedType = (type) => isPaneManagedType(type) && !_isToolbarUtilityView(type);
    // まずアクティブペインのタブをチェック
    const paneId = GBLayout.activePane;
    if (paneId) {
      const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
      if (paneInfo) {
        const activeTab = paneInfo.node.tabs?.[paneInfo.node.activeTabIndex];
        if (isWorkManagedType(activeTab?.type)) {
          newView = activeTab.type;
          activePaneOwnsView = true;
        }
      }
    }
    // ツールペイン等の場合: 全ペインからメインコンテンツを探す
    if (!newView && isWorkManagedType(state.view) && _paneHasVisibleManagedView(state.view)) {
      newView = state.view;
    }
    if (!newView) {
      for (const p of GBLayout.getAllPanes(GBLayout.root)) {
        const tab = p.tabs?.[p.activeTabIndex];
        if (isWorkManagedType(tab?.type)) { newView = tab.type; break; }
      }
    }
    if (newView && (newView !== state.view || activePaneOwnsView)) {
      state.view = newView;
      _updateToolbars(newView);
    } else if (!newView) {
      _updateToolbars('');
    }
  }

  // ペインのアクティブ切替時にstate.viewを同期
  function _onActivePaneChange(paneId, prevPaneId) {
    if (_bridgeUpdating) return;
    _mountAllPanes();
    _syncStateView();
    _mountFloatingAnnotationUi();
    _syncDetailForActivePane(paneId);
  }

  // アクティブペインに応じて詳細パネル・ビューワーを同期
  // サイドバー・詳細・ビューワー・右パネルツール等のユーティリティペインは同期対象外
  const _DETAIL_SYNC_SKIP_TYPES = new Set(Object.keys(PANEL_CONTAINERS).concat(Object.keys(RP_CONTAINERS)));
  const _DETAIL_DB_VIEW_TYPES = new Set(['database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db']);
  const _DETAIL_FILE_INFO_TYPES = new Set(['media', 'html', 'csv']);
  const _DETAIL_GLOBAL_TYPES = new Set(['page', 'entity', 'folder', 'board']);
  let _lastDetailContentPaneId = null;

  function _detailPaneActiveTab(paneId) {
    if (!paneId) return null;
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    const pane = paneInfo?.node || null;
    return pane?.tabs?.[pane.activeTabIndex] || null;
  }

  function _detailNormalizeTabType(tab) {
    const raw = tab?.type || '';
    return (typeof _normalizeDbPaneView === 'function') ? _normalizeDbPaneView(raw) : raw;
  }

  function _detailFileStyleContextForTab(tab) {
    const type = _detailNormalizeTabType(tab);
    if (type === 'page') return 'page';
    if (type === 'folder') return 'folder';
    if (_DETAIL_DB_VIEW_TYPES.has(type)) return 'db';
    if (type === 'board') return 'board';
    if (type === 'scriptnote') return 'scriptnote';
    if (type === 'calendar') return 'calendar';
    return '';
  }

  function _detailTabMatchesState(tab) {
    const st = (typeof state !== 'undefined') ? state : null;
    if (!st || !tab) return false;
    const type = _detailNormalizeTabType(tab);
    const view = (typeof _normalizeDbPaneView === 'function') ? _normalizeDbPaneView(st.view || '') : (st.view || '');
    const path = tab.path || '';
    if (path) {
      if (type === 'page' && path === st.currentPagePath) return true;
      if (type === 'entity' && path === st.currentEntityPath) return true;
      if (type === 'board' && path === st.currentBoardPath) return true;
      if (_DETAIL_DB_VIEW_TYPES.has(type) && (path === st.currentDbPath || path === st.currentSmartDb?._filePath)) return true;
    }
    return !!view && type === view;
  }

  function _detailPaneHasVisibleTab(detailPane, selector) {
    return [...(detailPane?.querySelectorAll?.(selector) || [])].some(t => !t.hidden);
  }

  function _detailPaneLooksStaleForTab(tab) {
    const detailPane = document.getElementById('rp-detail');
    if (!detailPane || !detailPane.closest('.gb-pane-content')) return false;
    const type = _detailNormalizeTabType(tab);
    const expectedCtx = _detailFileStyleContextForTab(tab);
    const styleBody = detailPane.querySelector('#detail-tab-file-style');
    const currentCtx = styleBody?.dataset?.fileStyleContext || '';
    const activeDetailTab = detailPane.querySelector('#detail-tab-bar .gb-inner-tab-active, #detail-tab-bar .active')?.dataset?.detailTab || '';
    const fileStyleVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-file-style');
    const calendarVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-calendar');
    const scriptnoteVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-scriptnote');
    const boardVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-board, .detail-tab-board-note, .detail-tab-board-style');
    const publishVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-publish');
    const publishAllowed = new Set(['page', 'calendar', 'csv', 'smart-db']).has(type) || _DETAIL_DB_VIEW_TYPES.has(type);
    if (type !== 'calendar' && calendarVisible) return true;
    if (type !== 'scriptnote' && scriptnoteVisible) return true;
    if (type !== 'board' && boardVisible) return true;
    if (!publishAllowed && publishVisible) return true;
    if (expectedCtx && activeDetailTab === 'file-style' && currentCtx !== expectedCtx) return true;
    if (expectedCtx && fileStyleVisible && currentCtx !== expectedCtx) return true;
    if (!expectedCtx && fileStyleVisible) return true;
    return false;
  }

  function _isDetailSyncSourcePane(paneId) {
    const tab = _detailPaneActiveTab(paneId);
    return !!tab && !_DETAIL_SYNC_SKIP_TYPES.has(tab.type);
  }

  function _findDetailSyncSourcePane(excludePaneId) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return null;
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    const visibleSources = panes.filter(pane => {
      if (!pane || pane.id === excludePaneId) return false;
      if (typeof _isPaneActuallyVisible === 'function' && !_isPaneActuallyVisible(pane.id)) return false;
      return _isDetailSyncSourcePane(pane.id);
    });
    const stateMatch = visibleSources.find(pane => _detailTabMatchesState(_detailPaneActiveTab(pane.id)));
    if (stateMatch) return stateMatch.id;
    const last = visibleSources.find(pane => pane.id === _lastDetailContentPaneId);
    if (last) return last.id;
    return visibleSources[0]?.id || null;
  }

  function _clearDetailPaneShell() {
    const detailPane = document.getElementById('rp-detail');
    if (!detailPane || !detailPane.closest('.gb-pane-content')) return;
    if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailPane);
    if (typeof _dpSavePending === 'function') _dpSavePending();
    if (typeof showNoteTabs === 'function') showNoteTabs(false);
    if (typeof showDbTabs === 'function') showDbTabs(false);
    if (typeof showBoardTabs === 'function') showBoardTabs(false);
    if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
    if (typeof showFileStyleTab === 'function') showFileStyleTab(false);
    if (typeof showPublishDetailTab === 'function') showPublishDetailTab(false);
    if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
    if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
    if (typeof switchDetailTab === 'function') switchDetailTab(null);
    if (typeof _removeStaleDpEditables === 'function') _removeStaleDpEditables(detailPane);
    else detailPane.querySelectorAll('#dp-editable').forEach(n => n.remove());
    ['#detail-tab-note-editor', '#detail-tab-db-property-settings', '#detail-tab-file-style', '#detail-tab-calendar-today', '#detail-tab-publish'].forEach(selector => {
      const el = detailPane.querySelector(selector);
      if (el) el.innerHTML = '';
    });
    const titleEl = detailPane.querySelector('#split-right-title');
    if (titleEl) titleEl.textContent = '';
  }

  function _syncDetailForActivePane(paneId, options) {
    if (!paneId) return;
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    if (!paneInfo) return;
    const activeTab = paneInfo.node.tabs?.[paneInfo.node.activeTabIndex];
    if (!activeTab) return;
    // ユーティリティペイン（詳細パネル、ビューワー、チャット等）のアクティブ化では
    // 既存の詳細パネル内容を保持する（ユーザーが作業コンテンツを見ながら
    // オプションを参照できる状態を壊さない）
    if (_DETAIL_SYNC_SKIP_TYPES.has(activeTab.type)) {
      if (options?.fromUtilityPane) return;
      const sourcePaneId = _findDetailSyncSourcePane(paneId);
      const sourceTab = _detailPaneActiveTab(sourcePaneId);
      if (sourcePaneId && _detailPaneLooksStaleForTab(sourceTab)) {
        _syncDetailForActivePane(sourcePaneId, { fromUtilityPane: true });
      }
      return;
    }
    _lastDetailContentPaneId = paneId;
    // ToolComponent型: コンポーネントの _syncDetailPanel を呼ぶ
    if (COMPONENT_TYPES.has(activeTab.type)) {
      const comp = getComponentInstance(activeTab.id);
      if (comp && typeof comp._syncDetailPanel === 'function') comp._syncDetailPanel();
      else _clearDetailPaneShell();
      _updatePreviewPane(false);
      return;
    }
    // 非scriptnote型: グローバル _syncDetailPanel 経由で詳細パネルを同期
    const type = activeTab.type;
    const label = activeTab.label || '';
    const path = activeTab.path || '';
    if (_DETAIL_DB_VIEW_TYPES.has(type)) {
      if (typeof _syncDetailPanel === 'function') _syncDetailPanel(label, path, 'database');
    } else if (_DETAIL_GLOBAL_TYPES.has(type)) {
      if (typeof _syncDetailPanel === 'function') _syncDetailPanel(label, path, type);
    } else if (_DETAIL_FILE_INFO_TYPES.has(type) && path && typeof _showFileInfoInDetailPanel === 'function') {
      _clearDetailPaneShell();
      _showFileInfoInDetailPanel(path);
    } else {
      // welcome / compare / search 等: 前のアプリ固有オプションを残さない
      _clearDetailPaneShell();
    }
    // ビューワーも同期
    _updatePreviewPane(false);
  }

  // ================================================================
  // 全ペインにコンテンツをマウント
  // ================================================================
  function _mountAllPanes() {
    const allPanes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }).slice().sort((a, b) => {

/* Source chunk: gb-pane-bridge.part02.js */
      if (a.id === GBLayout.activePane) return -1;
      if (b.id === GBLayout.activePane) return 1;
      return 0;
    });
    for (const pane of allPanes) {
      _mountPaneContent(pane);
    }
    window.MeldexStartupTabGuard?.pruneRestoredTabs?.();
  }

  function _mountPaneContent(pane, options) {
    const paneInfo = GBLayout.paneMap[pane.id];
    if (!paneInfo || !paneInfo.contentEl) return;
    if (!pane.tabs || pane.activeTabIndex < 0 || pane.activeTabIndex >= pane.tabs.length) return;

    const activeTab = pane.tabs[pane.activeTabIndex];
    const contentEl = paneInfo.contentEl;
    const tabType = activeTab.type;

    if (window.MeldexStartupTabGuard?.deferMount?.(pane, contentEl, activeTab, tabType, currentPane => _mountPaneContent(currentPane))) return;
    contentEl.querySelectorAll(':scope > .gb-startup-path-check').forEach(el => el.remove());

    // 非アクティブタブのコンポーネントをdeactivate
    pane.tabs.forEach((tab, i) => {
      if (i !== pane.activeTabIndex) {
        const comp = getComponentInstance(tab.id);
        if (comp && comp._active) comp.deactivate();
      }
    });

    // ToolComponent で描画するタイプ
    if (COMPONENT_TYPES.has(tabType)) {
      _retractLegacyFromPane(contentEl);
      let comp = getComponentInstance(activeTab.id);
      if (!comp) {
        const reg = TOOL_REGISTRY[tabType];
        if (reg && reg.cls) {
          comp = new reg.cls(pane.id, activeTab.id);
          comp.create();
          setComponentInstance(activeTab.id, comp);
        }
      }
      if (comp) {
        comp.paneId = pane.id;
        comp.tabId = activeTab.id;
        if (!comp._mounted || comp.el.parentNode !== contentEl) comp.mount(contentEl);
        if (activeTab.state && Object.keys(activeTab.state).length > 0) comp.restoreState(activeTab.state);
        // 非アクティブペインでは詳細パネル同期をスキップ
        const isActive = pane.id === GBLayout.activePane;
        comp._skipDetailSync = !isActive;
        comp.activate();
        comp._skipDetailSync = false;
      }
      return;
    }

    // パネルコンテナで描画するタイプ（サイドバー・詳細パネル）
    const panelContainerId = PANEL_CONTAINERS[tabType];
    if (panelContainerId) {
      const mountedLive = _mountLegacyLikeTab(pane, contentEl, activeTab, tabType, panelContainerId, options);
      // パネル固有の初期化（初回マウント時のみ）
      if (mountedLive && tabType === 'outliner' && typeof loadOutliner === 'function' && !_outlinerLoaded) {
        _outlinerLoaded = true;
        loadOutliner();
      }
      if (mountedLive && tabType === 'preview') _updatePreviewPane(true);
      return;
    }

    // 右パネルコンテナで描画するタイプ
    const rpContainerId = RP_CONTAINERS[tabType];
    if (rpContainerId) {
      const mountedLive = _mountLegacyLikeTab(pane, contentEl, activeTab, tabType, rpContainerId, options);
      // 初回マウント時の初期化
      if (mountedLive) _initRpTool(tabType, options);
      return;
    }

    // レガシーコンテナで描画するタイプ
    const containerId = LEGACY_CONTAINERS[tabType];
    if (!containerId) return;
    _mountLegacyLikeTab(pane, contentEl, activeTab, tabType, containerId, options);
  }

  function _mountLegacyLikeTab(pane, contentEl, tab, tabType, containerId, options) {
    // これから載せる containerId は退避対象から外す（同一コンテンツのまま active 切替時に
    // detach→reattach が発生して click 配信を阻害するのを防ぐ）。
    _retractLegacyFromPane(contentEl, containerId);
    contentEl.querySelectorAll('.gb-legacy-snapshot-host').forEach(el => el.remove());
    const ownerPaneId = _containerPane[containerId] || '';
    const ownerIsVisible = ownerPaneId ? _isPaneActuallyVisible(ownerPaneId) : false;
    const isDockPopupMount = !!options?.dockPopup;
    const isSubPanelMount = !!options?.subPanel || !!contentEl.closest?.('.gb-subpanel');
    const paneIsVisible = _isPaneActuallyVisible(pane.id);
    const canMountLive = isDockPopupMount || isSubPanelMount || (paneIsVisible && (!ownerPaneId || ownerPaneId === pane.id || pane.id === GBLayout.activePane || !ownerIsVisible));
    const bridgeOpts = pane.id === GBLayout.activePane ? _bridgeOpenOpts : _bridgePassiveOpenOpts;
    if (canMountLive && document.getElementById(containerId)) {
      _teardownSnapshotHost(tab.id);
      _showLegacyViewInPane(pane.id, contentEl, tabType, containerId, tab);
      _ensureLegacyTabContent(tab, tabType, containerId, bridgeOpts);
      return true;
    } else {
      _showLegacySnapshotInPane(pane.id, contentEl, tab, tabType);
      return false;
    }
  }

  // 右パネルツールの初期化（switchRightTabの初期化ロジックを再現）
  function _initRpTool(toolType, options) {
    if (toolType === 'chat') {
      const savedProvider = localStorage.getItem('chat-provider');
      const savedModel = localStorage.getItem('chat-model');
      if (savedProvider) {
        const sel = document.getElementById('chat-provider');
        if (sel) sel.value = savedProvider;
      }
      if (typeof updateChatModels === 'function') updateChatModels();
      if (savedModel) {
        const modelSel = document.getElementById('chat-model');
        if (modelSel && [...modelSel.options].some(o => o.value === savedModel)) {
          modelSel.value = savedModel;
        }
      }
      const isDockPopupMount = !!options?.dockPopup;
      const restoring = !isDockPopupMount && typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.restoreOnOpen === 'function'
        ? GBChatRestore.restoreOnOpen()
        : false;
      if (!isDockPopupMount && !restoring && !(typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.isRestoreSuspended === 'function' && GBChatRestore.isRestoreSuspended()) && typeof switchChatMode === 'function') {
        switchChatMode('team');
      }
    } else if (toolType === 'annotation') {
      if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
    } else if (toolType === 'sticky') {
      const type = document.getElementById('rp-ann-type');
      if (type) type.value = 'sticky';
      if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
    } else if (toolType === 'history') {
      if (typeof renderHistoryList === 'function') renderHistoryList();
    }
  }

  // ビューワーペインの更新（現在選択中のファイルをプレビュー）
  function _updatePreviewPane(forceRestore) {
    const pane = document.getElementById('gb-preview-pane');
    if (!pane) return;
    // キャンバスアクティブ時はミニマップを表示
    if (state.view === 'board' && typeof bdUpdateMinimap === 'function') {
      pane.dataset.previewMode = 'board';
      bdUpdateMinimap();
      return;
    }
    // キャンバス以外に切り替わった場合、ミニマップをクリア
    const oldMinimap = pane.querySelector('.bd-minimap');
    if (oldMinimap) pane.innerHTML = '';
    const activePreviewTab = (typeof _getActiveContentPaneInfo === 'function') ? _getActiveContentPaneInfo()?.activeTab : null;
    const activePreviewPath = activePreviewTab && !['preview', 'detail'].includes(activePreviewTab.type)
      ? (activePreviewTab.path || activePreviewTab.state?.scenarioPath || '')
      : '';
    // 再マウント時は保存済みパスを優先（最大化/復元でグローバルstateがずれる問題の対策）
    const mediaPath = forceRestore
      ? (pane.dataset.previewPath || '')
      : (activePreviewPath || state.currentPagePath || state.currentEntityPath || '');
    // 現在のパスを保存（次回再マウント用）
    if (mediaPath) pane.dataset.previewPath = mediaPath;
    if (forceRestore && pane.dataset.previewMode === 'board-link' && mediaPath && typeof bdRenderLinkedPreview === 'function') {
      bdRenderLinkedPreview(mediaPath, pane);
      return;
    }
    if (!mediaPath) {
      pane.innerHTML = '<div style="color:var(--fg2);font-size:13px;">ファイルを選択するとプレビューが表示されます</div>';
      return;
    }
    const ext = mediaPath.split('.').pop().toLowerCase();
    const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp'];
    if (imgExts.includes(ext)) {
      const url = (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/file-raw?path=' + encodeURIComponent(mediaPath);
      // 既存画像のsrcを更新（白フラッシュ防止）
      const existingImg = pane.querySelector('img');
      if (existingImg) {
        existingImg.src = url;
      } else {
        pane.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;" alt="preview">';
      }
    } else {
      const fname = document.createElement('div');
      fname.style.cssText = 'color:var(--fg2);font-size:13px;';
      fname.textContent = mediaPath.split('/').pop();
      pane.innerHTML = '';
      pane.appendChild(fname);
    }
  }

  const _ANNOTATION_HOST_TYPES = new Set([
    'database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db',
    'compare', 'entity', 'page', 'folder', 'media', 'html', 'csv',
    'board', 'scriptnote', 'calendar',
  ]);
  const _ANNOTATION_DB_HOST_TYPES = new Set([
    'database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db',
  ]);
  let _lastAnnotationPaneId = '';

  function _normalizeDbPaneView(viewName) {
    return viewName === 'database' ? 'pivot' : viewName;
  }

  function _resolveDbPaneDisplayView(viewName, tab) {
    const normalizedViewName = _normalizeDbPaneView(viewName);
    if (!DB_SUB_VIEWS[normalizedViewName]) return normalizedViewName;
    const dbPath = tab?.path || tab?.state?.dbPath || state.currentDbPath || '';
    const mode = (dbPath && typeof getCurrentViewMode === 'function') ? getCurrentViewMode(dbPath) : '';
    const resolvedMode = ['calendar', 'tasks', 'shifts'].includes(mode) ? 'timeline' : mode;
    return DB_SUB_VIEWS[resolvedMode] ? resolvedMode : normalizedViewName;
  }

  function _getActiveContentPaneInfo() {
    const paneId = _getContentPane(GBLayout.activePane);
    if (!paneId) return null;
    return _getPaneInfoById(paneId);
  }

  function _getPaneInfoById(paneId) {
    if (!paneId) return null;
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    const paneNode = paneInfo?.node || null;
    const activeTab = paneNode?.tabs?.[paneNode.activeTabIndex] || null;
    const contentEl = GBLayout.paneMap?.[paneId]?.contentEl || null;
    if (!paneNode || !activeTab || !contentEl) return null;
    return { paneId, paneNode, activeTab, contentEl };
  }

  function _getAnnotationTargetForTab(tab) {
    const rawType = tab?.type || '';
    const tabType = _normalizeDbPaneView(rawType);
    const statePath = (key) => (typeof state !== 'undefined' ? (state?.[key] || '') : '');
    const tabPath = (...keys) => {
      if (tab?.path) return tab.path;
      const tabState = tab?.state || {};
      for (const key of keys) {
        if (tabState[key]) return tabState[key];
      }
      return '';
    };
    if (tabType === 'scriptnote') return tabPath('scenarioPath', 'scriptnotePath') || '';
    if (tabType === 'board') return tabPath('boardPath') || statePath('currentBoardPath');
    if (tabType === 'calendar') return 'calendar:panel';
    if (_ANNOTATION_DB_HOST_TYPES.has(rawType) || _ANNOTATION_DB_HOST_TYPES.has(tabType)) {
      if (tabType === 'smart-db') {
        return tabPath('smartDbPath', 'dbPath') || statePath('currentSmartDb')?._filePath || statePath('currentDbPath');
      }
      return tabPath('dbPath') || statePath('currentDbPath');
    }
    if (tabType === 'folder') {
      return tabPath('folderPath') || (typeof _folderPath !== 'undefined' ? _folderPath : '') || '';
    }
    if (tabType === 'entity') return tabPath('entityPath') || statePath('currentEntityPath');
    if (tabType === 'page') return tabPath('pagePath') || statePath('currentPagePath');
    if (tabType === 'media' || tabType === 'html') return tabPath('mediaPath', 'pagePath') || statePath('currentPagePath');
    if (tabType === 'csv') return tabPath('csvPath') || (typeof _csvPath !== 'undefined' ? _csvPath : '');
    if (tabType === 'compare') {
      const left = tab?.state?.pathA || tab?.state?.leftPath || '';
      const right = tab?.state?.pathB || tab?.state?.rightPath || '';
      return tabPath('comparePath') || (left || right ? `compare:${left}|${right}` : '');
    }
    return '';
  }

  function _isUsableAnnotationPaneInfo(info) {
    if (!info || !_isPaneActuallyVisible(info.paneId)) return false;
    if (!_ANNOTATION_HOST_TYPES.has(info.activeTab?.type)) return false;
    return !!_getAnnotationTargetForTab(info.activeTab);
  }

  function _rememberAnnotationPaneInfo(info) {
    if (info?.paneId) _lastAnnotationPaneId = info.paneId;
    return info || null;
  }

  function _getAnnotationPaneInfos() {
    if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return [];
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    const infos = [];
    for (const pane of panes) {
      const info = _getPaneInfoById(pane?.id);
      if (_isUsableAnnotationPaneInfo(info)) infos.push(info);
    }
    return infos;
  }

  function _getAnnotationContentPaneInfo(preferredPaneId) {
    const pick = (paneId) => {
      const info = _getPaneInfoById(paneId);
      return _isUsableAnnotationPaneInfo(info) ? info : null;
    };
    for (const paneId of [preferredPaneId, GBLayout.activePane, _getContentPane(GBLayout.activePane), _lastAnnotationPaneId]) {
      const info = pick(paneId);
      if (info) return _rememberAnnotationPaneInfo(info);
    }
    return _rememberAnnotationPaneInfo(_getAnnotationPaneInfos()[0] || null);
  }

  function _getCurrentAnnotationTarget(preferredPaneId) {
    const info = _getAnnotationContentPaneInfo(preferredPaneId);
    return _getAnnotationTargetForTab(info?.activeTab) || '';
  }

  function _rememberAnnotationTargetForPane(paneId) {
    const info = _getAnnotationContentPaneInfo(paneId);
    return _getAnnotationTargetForTab(info?.activeTab) || '';
  }

  function _annotationFabButtonForPane(contentEl, paneId) {
    const buttons = contentEl?.querySelectorAll?.(':scope > .annotation-fab-mirror[data-annotation-fab-pane]') || [];
    return [...buttons].find(btn => btn.dataset.annotationFabPane === paneId) || null;
  }

  function _syncAnnotationFabMirrors(primaryPaneId) {
    const sourceButton = document.getElementById('btn-tb-annotation');
    const validPaneIds = new Set();
    for (const info of _getAnnotationPaneInfos()) {
      if (!info?.paneId || info.paneId === primaryPaneId) continue;
      validPaneIds.add(info.paneId);
      if (getComputedStyle(info.contentEl).position === 'static') info.contentEl.style.position = 'relative';
      let mirror = _annotationFabButtonForPane(info.contentEl, info.paneId);
      if (!mirror) {
        mirror = document.createElement('button');
        mirror.type = 'button';
        mirror.className = 'annotation-fab annotation-fab-mirror';
        mirror.title = sourceButton?.title || '注釈 (Alt+A)';
        mirror.setAttribute('aria-label', '注釈ツール');
        mirror.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          _activateAnnotationFabForPane(ev.currentTarget?.dataset?.annotationFabPane || '');
        });
        info.contentEl.appendChild(mirror);
      }
      mirror.dataset.annotationFabPane = info.paneId;
      mirror.dataset.e2eId = `annotation-fab-${info.paneId}`;
      mirror.innerHTML = sourceButton?.innerHTML || '';
      mirror.classList.remove('active');
      mirror.style.display = '';
    }
    document.querySelectorAll('.annotation-fab-mirror[data-annotation-fab-pane]').forEach(mirror => {
      const paneId = mirror.dataset.annotationFabPane || '';
      const hostPaneId = mirror.closest?.('.gb-pane')?.dataset?.paneId || '';
      if (!validPaneIds.has(paneId) || hostPaneId !== paneId) mirror.remove();
    });
  }

  function _activateAnnotationFabForPane(paneId) {
    const paneInfo = _getAnnotationContentPaneInfo(paneId);
    if (!paneInfo) return false;
    const toolbar = document.getElementById('ann-toolbar');
    const currentPaneId = document.getElementById('btn-tb-annotation')?.closest?.('.gb-pane')?.dataset?.paneId || '';
    if (toolbar?.classList?.contains('visible') && currentPaneId && currentPaneId !== paneInfo.paneId && typeof closeAnnotationToolbar === 'function') {
      closeAnnotationToolbar();
    }
    if (GBLayout.activePane !== paneInfo.paneId && typeof GBLayout.setActivePane === 'function') {
      GBLayout.setActivePane(paneInfo.paneId, { sync: true });
    }
    _mountFloatingAnnotationUi({ paneId: paneInfo.paneId });
    if (typeof toggleAnnotationToolbar === 'function') {
      toggleAnnotationToolbar();
      return true;
    }
    return false;
  }

  function _mountFloatingAnnotationUi(options = {}) {
    const storage = document.getElementById('legacy-views');
    const overlay = document.getElementById('ann-overlay');
    const button = document.getElementById('btn-tb-annotation');
    const paneInfo = _getAnnotationContentPaneInfo(options?.paneId || options?.preferredPaneId || '');
    const paneTarget = _getAnnotationTargetForTab(paneInfo?.activeTab);
    const activeView = _normalizeDbPaneView(paneInfo?.activeTab?.type || state.view);
    const nextTarget = paneTarget || ((typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : '');
    const hasUsableTarget = !!paneTarget;
    const host = (paneInfo && _ANNOTATION_HOST_TYPES.has(paneInfo.activeTab.type) && hasUsableTarget)
      ? paneInfo.contentEl
      : storage;
    if (!host) return;
    if (host !== storage) {
      const hostPosition = getComputedStyle(host).position;
      if (!hostPosition || hostPosition === 'static') host.style.position = 'relative';
    }

    [overlay, button].forEach(el => {
      if (!el) return;
      if (el.parentNode !== host) host.appendChild(el);
      // _retractLegacyFromPane が display:none を付けて storage へ退避するため、
      // host が表示先（contentEl）のときは display を解除して再表示する
      if (host !== storage) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });
    _syncAnnotationFabMirrors(host === storage ? '' : paneInfo?.paneId || '');
    if (host === storage) {
      document.querySelectorAll('.ann-note:not(.ann-note-embedded)').forEach(note => {
        if (note.parentNode !== host) host.appendChild(note);
      });
      return;
    }

    if (overlay) {
      overlay.style.width = '100%';
      overlay.style.height = '100%';
    }
    document.querySelectorAll('.ann-note:not(.ann-note-embedded)').forEach(note => {
      if (note.parentNode !== host) host.appendChild(note);
    });
    if (typeof _setupOverlayScroll === 'function') _setupOverlayScroll(activeView);
    if (typeof ann !== 'undefined' && typeof getAnnotationTarget === 'function') {
      if (nextTarget !== ann.targetPath) {
        ann.targetPath = nextTarget;
        const embedded = typeof _usesEmbeddedAnnotationSurface === 'function'
          && _usesEmbeddedAnnotationSurface(activeView);
        if (embedded) {
          const layer = document.getElementById('ann-layer');
          if (layer) layer.innerHTML = '';
          if (typeof _forEachStandaloneAnnotationNote === 'function') {
            _forEachStandaloneAnnotationNote(el => el.remove());
          }
        } else if (typeof loadAnnotations === 'function') {
          loadAnnotations();
        }
      }
    }
  }

  function _scheduleToolbarRecheck(viewName) {
    const run = () => {
      if (typeof _updateToolbars === 'function') _updateToolbars(viewName || state.view || '');
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 0);
  }

  // レガシーコンテナをペインに配置
  function _showLegacyViewInPane(paneId, contentEl, viewName, containerId, tab) {
    const viewEl = document.getElementById(containerId);
    if (!viewEl) return;
    const resolvedViewName = _resolveDbPaneDisplayView(viewName, tab);

    // 他のペインから奪う場合は退避
    if (_containerPane[containerId] && _containerPane[containerId] !== paneId) {
      _retractContainer(containerId);
    }

    // 既にこのペインにある場合はスキップ
    if (viewEl.parentNode !== contentEl) {
      contentEl.appendChild(viewEl);
    }
    _containerPane[containerId] = paneId;

    // DB系サブビュー切替
    if (containerId === 'db-view-container') {
      viewEl.style.display = 'flex';
      for (const [type, subId] of Object.entries(DB_SUB_VIEWS)) {
        const subEl = document.getElementById(subId);
        if (subEl) {
          const show = (type === resolvedViewName);
          subEl.style.display = show ? (type === 'pivot' || type === 'timeline' || type === 'smart-db' ? '' : 'flex') : 'none';
        }
      }
    } else {
      viewEl.style.display = 'flex';
    }
    if (viewEl.hasAttribute('aria-hidden')) viewEl.setAttribute('aria-hidden', 'false');
    try { if (viewEl.inert) viewEl.inert = false; } catch (e) {}

    if (tab) _bindLiveLegacyContainer(containerId, paneId, tab, viewName, viewEl);
    if (containerId === 'db-view-container') _scheduleToolbarRecheck(viewName);
  }

  // ペインからレガシーコンテナを退避（メインビュー＋右パネル両方）
  // exceptId を渡すと、その ID のコンテナだけは退避対象から外す（idempotent 化のため）。
  function _retractLegacyFromPane(contentEl, exceptId = null) {
    const storage = document.getElementById('legacy-views');
    if (!storage) return;
    const ids = new Set([
      ...Object.values(LEGACY_CONTAINERS),
      ...Object.values(RP_CONTAINERS),
      ...Object.values(PANEL_CONTAINERS),
      'ann-overlay',
      'btn-tb-annotation',
    ]);
    ids.forEach(id => {
      if (id === exceptId) return;
      const el = document.getElementById(id);
      if (el && el.parentNode === contentEl) {
        el.style.display = 'none';
        storage.appendChild(el);
        delete _containerPane[id];
      }
    });
  }

  function _retractContainer(containerId) {
    const storage = document.getElementById('legacy-views');
    const el = document.getElementById(containerId);
    if (el && storage) {
      el.style.display = 'none';
      storage.appendChild(el);
      delete _containerPane[containerId];
    }
  }

  // ================================================================
  // ナビゲーション用ペインタイプ（ファイルを開く先にならない）
  // ================================================================
  const NAV_PANE_TYPES = new Set(['outliner']);
  const PRIMARY_TOOL_PANE_TYPES = new Set(['chat', 'calendar', 'timer', 'history', 'annotation', 'sticky', 'search']);
  const TOOL_HOST_PANE_TYPES = new Set([...PRIMARY_TOOL_PANE_TYPES, 'version']);
  const FILE_OPEN_AVOID_PANE_TYPES = new Set([
    ...NAV_PANE_TYPES,
    ...PRIMARY_TOOL_PANE_TYPES,
    'detail',
    'preview',
    'version',
  ]);
  const FILE_SHOW_VIEW_TYPES = new Set(Object.keys(LEGACY_CONTAINERS).filter(type => type !== 'welcome'));
  const TOOLBAR_DB_VIEW_TYPES = new Set(['pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db']);
  const TOOLBAR_UTILITY_VIEW_TYPES = new Set([
    ...Object.keys(PANEL_CONTAINERS),
    ...Object.keys(RP_CONTAINERS),
    ...PRIMARY_TOOL_PANE_TYPES,
    'version',
  ]);
  const PASSIVE_TOOL_PANE_TYPES = new Set([
    'chat',
    'annotation',
    'sticky',
    'history',
    'detail',
    'preview',
    'search',
    'version',
    'timer',
  ]);

  function _isPassiveToolPaneTab(type, tab) {
    const rawType = type || tab?.type || '';
    const normalizedType = rawType === 'sticky' ? 'annotation' : rawType;
    if (normalizedType === 'calendar') return !tab?.path;
    return PASSIVE_TOOL_PANE_TYPES.has(normalizedType);
  }

  function _isPaneActuallyVisible(paneId) {
    if (!paneId) return false;
    const virtualEl = GBLayout?.paneMap?.[paneId]?.el || null;
    if (virtualEl?.closest?.('.gb-subpanel')) {
      const rect = virtualEl.getBoundingClientRect?.();
      return !virtualEl.hidden && !!rect && rect.width > 0 && rect.height > 0;
    }
    if (typeof GBLayout.isPaneVisible === 'function') return GBLayout.isPaneVisible(paneId);
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    return !!paneInfo?.node && !paneInfo.node.collapsed;
  }

  function _paneActiveType(pane) {
    const tab = pane?.tabs?.[pane.activeTabIndex];
    return tab?.type || '';
  }

  function _firstPaneMatching(panes, predicate) {
    for (const pane of (panes || [])) {
      if (predicate(pane)) return pane;
    }
    return null;
  }

  function _createFileOpenPaneNear(paneId) {
    if (typeof GBLayout === 'undefined' || typeof GBTabs === 'undefined') return null;
    const allPanes = typeof GBLayout.getAllPanes === 'function' ? GBLayout.getAllPanes(GBLayout.root) : [];
    const visiblePanes = allPanes.filter(pane => _isPaneActuallyVisible(pane.id));
    const sourcePane = _firstPaneMatching(visiblePanes, pane => pane.id === paneId && !pane.locked)
      || _firstPaneMatching(visiblePanes, pane => _paneActiveType(pane) === 'outliner' && !pane.locked)
      || _firstPaneMatching(visiblePanes, pane => !_isFileOpenPaneCandidate(pane) && !pane.locked)
      || _firstPaneMatching(allPanes, pane => _paneActiveType(pane) === 'outliner' && !pane.locked)
      || _firstPaneMatching(allPanes, pane => !pane.locked)
      || null;
    const tab = GBTabs.createTab('フォルダ', 'folder', '');
    const newPane = GBLayout.createPaneNode(null, [tab], 0);
    const historyOptions = {
      historyLabel: 'レイアウト: 作業パネルを作成',
      historyDetail: 'ファイルリンクを開く',
    };
    let newPaneId = null;
    if (sourcePane?.id) {
      const position = _paneActiveType(sourcePane) === 'outliner' ? 'right' : 'left';
      newPaneId = GBLayout.splitPane(sourcePane.id, 'horizontal', position, newPane, historyOptions);
    }
    if (!newPaneId && typeof GBLayout.splitRoot === 'function') {
      newPaneId = GBLayout.splitRoot('right', newPane, historyOptions);
    }
    if (newPaneId) {
      _expandCollapsedPane(newPaneId);
      GBLayout.setActivePane(newPaneId, { sync: true });
    }
    return newPaneId;
  }

  // アクティブペインがナビゲーション用ペインの場合、コンテンツペインを返す
  function _getContentPane(paneId) {
    if (!paneId) return paneId;
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    if (!paneInfo) return paneId;
    const pane = paneInfo.node;
    const activeTab = pane.tabs && pane.tabs[pane.activeTabIndex];
    const isVisible = _isPaneActuallyVisible(paneId);
    if (isVisible && (!activeTab || !FILE_OPEN_AVOID_PANE_TYPES.has(activeTab.type))) return paneId;

    const allPanes = GBLayout.getAllPanes(GBLayout.root);
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      const t = p.tabs && p.tabs[p.activeTabIndex];
      if (!t || !FILE_OPEN_AVOID_PANE_TYPES.has(t.type)) return p.id;
    }
    for (const p of allPanes) {
      if (p.id === paneId) continue;
      const t = p.tabs && p.tabs[p.activeTabIndex];
      if (!t || !FILE_OPEN_AVOID_PANE_TYPES.has(t.type)) return p.id;
    }
    for (const p of allPanes) {
      if (p.id !== paneId && _isPaneActuallyVisible(p.id)) return p.id;
    }
    for (const p of allPanes) {
      if (p.id !== paneId) return p.id;
    }
    return paneId;
  }

  function _isFileOpenPaneCandidate(pane, options) {
    if (!pane) return false;
    if (!options?.allowLocked && pane.locked) return false;
    const activeTab = pane.tabs && pane.tabs[pane.activeTabIndex];
    return !activeTab || !FILE_OPEN_AVOID_PANE_TYPES.has(activeTab.type);
  }

  function _isFileOpenFallbackPaneCandidate(pane, options) {
    if (!pane) return false;
    if (!options?.allowLocked && pane.locked) return false;
    const activeTab = pane.tabs && pane.tabs[pane.activeTabIndex];
    const type = activeTab?.type || '';
    if (NAV_PANE_TYPES.has(type) || type === 'detail' || type === 'preview') return false;
    if (!options?.allowChat && type === 'chat') return false;
    return true;
  }

  function _getFileOpenPane(paneId, options) {
    const opts = options || {};
    paneId = paneId || GBLayout.activePane || GBLayout.findFirstPane?.(GBLayout.root)?.id || '';
    if (!paneId) return opts.ensureWorkPane ? _createFileOpenPaneNear('') : _getContentPane(paneId);
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    const pane = paneInfo?.node || null;
    if (pane && _isPaneActuallyVisible(paneId) && _isFileOpenPaneCandidate(pane)) return paneId;

    const allPanes = GBLayout.getAllPanes(GBLayout.root);
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      if (_isFileOpenPaneCandidate(p)) return p.id;
    }
    for (const p of allPanes) {
      if (p.id === paneId) continue;
      if (_isFileOpenPaneCandidate(p)) return p.id;
    }
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      if (_isFileOpenPaneCandidate(p, { allowLocked: true })) return p.id;
    }
    for (const p of allPanes) {
      if (p.id === paneId) continue;
      if (_isFileOpenPaneCandidate(p, { allowLocked: true })) return p.id;
    }
    if (opts.ensureWorkPane) {
      const ensuredPaneId = _createFileOpenPaneNear(paneId);
      if (ensuredPaneId) return ensuredPaneId;
    }
    if (opts.fileOpenOnly) return null;
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      if (_isFileOpenFallbackPaneCandidate(p)) return p.id;
    }
    if (pane && _isPaneActuallyVisible(paneId) && _isFileOpenFallbackPaneCandidate(pane)) return paneId;
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      if (_isFileOpenFallbackPaneCandidate(p, { allowChat: true })) return p.id;
    }
    if (pane && _isPaneActuallyVisible(paneId) && _isFileOpenFallbackPaneCandidate(pane, { allowChat: true })) return paneId;
    for (const p of allPanes) {
      if (p.id === paneId) continue;
      if (_isFileOpenFallbackPaneCandidate(p, { allowLocked: true })) return p.id;
    }
    if (pane && _isFileOpenFallbackPaneCandidate(pane, { allowLocked: true })) return paneId;
    return null;
  }

  function _activateFileOpenPane(options) {
    const paneId = _getFileOpenPane(options?.paneId || GBLayout.activePane, { ensureWorkPane: true });
    if (!paneId) return null;
    _expandCollapsedPane(paneId);
    if (GBLayout.activePane !== paneId) GBLayout.setActivePane(paneId, { sync: true });
    return paneId;
  }

  function _getViewHostPane(viewName) {
    if (!FILE_SHOW_VIEW_TYPES.has(viewName)) return _getContentPane(GBLayout.activePane);
    return _getFileOpenPane(GBLayout.activePane, { ensureWorkPane: true });
  }

  function _isToolbarUtilityView(viewName) {
    return TOOLBAR_UTILITY_VIEW_TYPES.has(viewName);
  }

  function _toolbarViewForTab(tab) {
    const rawType = tab?.type || '';
    if (!rawType || _isToolbarUtilityView(rawType)) return '';
    const normalizedType = _normalizeDbPaneView(rawType);
    if (TOOLBAR_DB_VIEW_TYPES.has(normalizedType)) return _resolveDbPaneDisplayView(rawType, tab);
    return normalizedType;
  }

  function _getToolbarContentContext(viewName) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return null;
    const activePaneId = GBLayout.activePane || '';
    const paneIds = [];
    const seen = new Set();
    const pushPaneId = (paneId) => {
      if (!paneId || seen.has(paneId)) return;
      seen.add(paneId);
      paneIds.push(paneId);
    };

    if (!_isToolbarUtilityView(viewName)) pushPaneId(activePaneId);
    pushPaneId(_getFileOpenPane(activePaneId));
    pushPaneId(_getContentPane(activePaneId));
    pushPaneId(_containerPane['db-view-container']);
    pushPaneId(_lastDetailContentPaneId);

    const panes = typeof GBLayout.getAllPanes === 'function'
      ? GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || []
      : [];
    panes.filter(pane => _isPaneActuallyVisible(pane.id)).forEach(pane => pushPaneId(pane.id));
    panes.forEach(pane => pushPaneId(pane.id));

    for (const paneId of paneIds) {
      const info = _getPaneInfoById(paneId);
      const toolbarView = _toolbarViewForTab(info?.activeTab);
      if (info && toolbarView) return { ...info, viewName: toolbarView };
    }
    return null;
  }

  function _resolveToolbarContext(viewName) {
    const normalizedViewName = _normalizeDbPaneView(viewName);
    const contentContext = _getToolbarContentContext(viewName);
    if (_isToolbarUtilityView(viewName) && contentContext) return contentContext;
    const requestedViewName = TOOLBAR_DB_VIEW_TYPES.has(normalizedViewName)
      ? _resolveDbPaneDisplayView(viewName, contentContext?.activeTab)
      : normalizedViewName;
    if (contentContext) return { ...contentContext, viewName: requestedViewName };
    return { paneId: '', paneNode: null, activeTab: null, contentEl: null, viewName: requestedViewName };
  }

  function _focusFileOpenPane(paneId) {
    if (!paneId || GBLayout.activePane === paneId) return;
    GBLayout.setActivePane(paneId);
  }

  function _findLayoutParent(node, targetId) {
    if (!node || node.type !== 'split' || !node.children) return null;
    for (const child of node.children) {
      if (!child) continue;
      if (child.id === targetId) return { node, child };
      const nested = _findLayoutParent(child, targetId);
      if (nested) return nested;
    }
    return null;
  }

  function _expandCollapsedPane(paneId) {
    if (!paneId) return;
    if (typeof GBLayout.revealPane === 'function') {
      GBLayout.revealPane(paneId);
      return;
    }
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    const pane = paneInfo?.node;
    if (!pane || !pane.collapsed) return;
    pane.collapsed = false;
    const parentInfo = _findLayoutParent(GBLayout.root, paneId);
    if (parentInfo?.node) {
      const splitNode = parentInfo.node;
      const childIndex = splitNode.children[0]?.id === paneId
        ? 0
        : (splitNode.children[1]?.id === paneId ? 1 : (GBLayout.findNode(splitNode.children[0], paneId) ? 0 : 1));
      const otherChild = splitNode.children[childIndex === 0 ? 1 : 0];
      if (otherChild?.collapsed && pane._savedRatio != null) {
        splitNode.ratio = pane._savedRatio;
        delete pane._savedRatio;
      } else if (otherChild?.collapsed) {
        // 親 split の現在 ratio を維持する。両側ドックバー状態でも 0.975/0.025 に
        // 寄せず、記憶済みのパネル幅/高さがない場合は初期比率を残す。
      } else if (pane._savedRatio != null) {
        splitNode.ratio = pane._savedRatio;
        delete pane._savedRatio;
      } else {
        // 親 split の現在 ratio を維持する。初期折りたたみドックはこの ratio に
        // 展開時の既定幅 (左 260px / 右 360px) を保持している。
      }
    }
    GBLayout.render();
    GBLayout.saveLayout();
  }

  function _isVersionHostPane(pane) {
    const tabs = pane?.tabs || [];
    if (!tabs.length) return false;
    if (tabs.some(t => PRIMARY_TOOL_PANE_TYPES.has(t.type))) return true;
    return tabs.every(t => TOOL_HOST_PANE_TYPES.has(t.type));
  }

  function _getVersionHostPaneInfo() {
    const allPanes = GBLayout.getAllPanes(GBLayout.root).filter(pane => {
      const activeTab = pane.tabs?.[pane.activeTabIndex];
      return !activeTab || !NAV_PANE_TYPES.has(activeTab.type);
    });
    const preferredPanes = allPanes.filter(pane => !pane.locked);
    const candidatePanes = preferredPanes.length ? preferredPanes : allPanes;
    for (const pane of candidatePanes) {
      if ((pane.tabs || []).some(t => PRIMARY_TOOL_PANE_TYPES.has(t.type))) {
        return { paneId: pane.id, reusable: true };
      }
    }
    for (const pane of candidatePanes) {
      if (_isVersionHostPane(pane)) {
        return { paneId: pane.id, reusable: true };
      }
    }
    const activeContentPane = _getContentPane(GBLayout.activePane);
    const activeContentInfo = activeContentPane ? GBLayout.findNode(GBLayout.root, activeContentPane)?.node : null;
    const fallbackPaneId = activeContentInfo && !activeContentInfo.locked
      ? activeContentPane
      : candidatePanes[candidatePanes.length - 1]?.id || allPanes[allPanes.length - 1]?.id || null;
    return { paneId: fallbackPaneId, reusable: false };
  }

  function _updateVersionTab(tab, label, versionType) {
    if (!tab) return;
    tab.label = label;
    tab.icon = GBTabs.tabIcon('version');
    tab.state = { ...(tab.state || {}), versionType };
  }

  // ================================================================
  // showView() オーバーライド
  // ================================================================
  function _overrideShowView() {
    const _origShowView = window.showView;

    window.showView = function(viewName, ctx) {
      // スプリットペイン内のビュー切替はそのまま
      if (ctx && ctx.containerEl) return _origShowView(viewName, ctx);
      if (_bridgeUpdating) {
        // navPush中でもツールバーは更新する
        _updateToolbars(viewName);
        return;
      }

      // ボード保存
      if (state.view === 'board' && viewName !== 'board' && typeof bd !== 'undefined' && bd.dirty && bd.path) {
        if (typeof bdSave === 'function') {
          const saveResult = bdSave();
          if (saveResult && typeof saveResult.then === 'function') {
            saveResult.then(saved => { if (saved && typeof bd !== 'undefined') bd.dirty = false; }).catch(() => {});
          } else if (saveResult) {
            bd.dirty = false;
          }
        }
      }

      // アクティブペインにビューを表示（ナビペインならコンテンツペインへ）
      const paneId = _getViewHostPane(viewName);
      if (!paneId) return;
      const paneInfo = GBLayout.paneMap[paneId];
      if (!paneInfo || !paneInfo.contentEl) return;
      const paneNode = GBLayout.findNode(GBLayout.root, paneId)?.node || null;
      const activeTab = paneNode?.tabs?.[paneNode.activeTabIndex] || null;

      // コンポーネントタイプの場合は何もしない（navPush経由でマウントされる）
      if (COMPONENT_TYPES.has(viewName)) {
        _updateToolbars(viewName);
        state.view = viewName;
        _mountFloatingAnnotationUi();
        _clearDetailAndPreview(viewName);
        return;
      }

      // レガシーコンテナを直接移動（render()なしでパフォーマンス向上）
      const containerId = LEGACY_CONTAINERS[viewName];
      _retractLegacyFromPane(paneInfo.contentEl, containerId);
      if (containerId) {
        _showLegacyViewInPane(paneId, paneInfo.contentEl, viewName, containerId, activeTab);
        // 空状態オーバーレイを除去（ファイルが開かれた）
        const emptyEl = document.getElementById(containerId)?.querySelector('.gb-empty-state');
        if (emptyEl) emptyEl.remove();
      }

      // ツールバー更新
      _updateToolbars(viewName);
      state.view = viewName;

      // アノテーション
      if (typeof ann !== 'undefined') {
        const newTarget = typeof getAnnotationTarget === 'function' ? getAnnotationTarget() : '';
        if (newTarget !== ann.targetPath) {
          ann.targetPath = newTarget;
          if (typeof loadAnnotations === 'function') loadAnnotations();
        }
        if (typeof _setupOverlayScroll === 'function') _setupOverlayScroll(viewName);
      }
      _mountFloatingAnnotationUi();

      // 詳細/プレビューペインをクリア（ビュー切替時に古い情報が残らないように）
      _clearDetailAndPreview(viewName);
    };
  }

  // 詳細/プレビューペインのクリア
  function _clearDetailAndPreview(viewName = '') {
    const detailPane = document.getElementById('rp-detail');
    if (detailPane && detailPane.closest('.gb-pane-content')) {
      if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailPane);
      // 未保存の編集があれば先に保存
      if (typeof _dpSavePending === 'function') _dpSavePending();
      if (typeof showNoteTabs === 'function') showNoteTabs(false);
      if (typeof showDbTabs === 'function') showDbTabs(false);
      if (typeof showBoardTabs === 'function') showBoardTabs(false);
      if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
      if (typeof showFileStyleTab === 'function') showFileStyleTab(false);
      if (typeof showPublishDetailTab === 'function') showPublishDetailTab(false);
      if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
      if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
      if (typeof switchDetailTab === 'function') switchDetailTab(null);
      // 残留 dp-editable を全削除（自動保存タイマーもクリア）
      if (typeof _removeStaleDpEditables === 'function') _removeStaleDpEditables(detailPane);
      else detailPane.querySelectorAll('#dp-editable').forEach(n => n.remove());
      // タイトルバーもクリア
      const titleEl = detailPane.querySelector('#split-right-title');
      if (titleEl) titleEl.textContent = '';
      ['#detail-tab-note-editor', '#detail-tab-db-property-settings', '#detail-tab-file-style', '#detail-tab-calendar-today', '#detail-tab-publish'].forEach(selector => {
        const el = detailPane.querySelector(selector);
        if (el) el.innerHTML = '';
      });
    }
    const previewPane = document.getElementById('gb-preview-pane');
    if (previewPane && previewPane.closest('.gb-pane-content')) {
      previewPane.innerHTML = '<div style="color:var(--fg2);font-size:13px;">ファイルを選択するとプレビューが表示されます</div>';
    }
  }

  // ツールバー更新（v5.0: ツールバーをペインのcontentEl先頭に動的配置）
  function _updateToolbars(viewName) {
    const toolbarContext = _resolveToolbarContext(viewName);
    const toolbarViewName = toolbarContext.viewName;
    const isDbView = TOOLBAR_DB_VIEW_TYPES.has(toolbarViewName);
    const showRt = (toolbarViewName === 'page');
    const showToolbar = isDbView || showRt;

    const appTb = document.getElementById('app-toolbar');
    const tbDb = document.getElementById('tb-db');
    if (tbDb) tbDb.style.display = isDbView ? 'contents' : 'none';
    const rtTb = document.getElementById('rt-toolbar');
    // page-view内に専用ツールバー(#page-rt-toolbar)があるので、app-toolbar内のrt-toolbarは常に非表示
    if (rtTb) rtTb.style.display = 'none';
    if (appTb) appTb.classList.toggle('visible', isDbView);

    // ツールバーをアクティブペインのcontentElの先頭に移動
    if (appTb && showToolbar) {
      const paneId = toolbarContext.paneId || _getFileOpenPane(GBLayout.activePane) || _getContentPane(GBLayout.activePane);
      if (paneId) {
        const paneInfo = GBLayout.paneMap[paneId];
        if (paneInfo && paneInfo.contentEl && appTb.parentNode !== paneInfo.contentEl) {
          paneInfo.contentEl.insertBefore(appTb, paneInfo.contentEl.firstChild);
        }
      }
    }

    const entityRt = document.getElementById('entity-rt-toolbar');
    if (entityRt) {
      const entityFreeText = document.getElementById('entity-freetext');
      const hasEntityNote = toolbarViewName === 'entity'
        && entityFreeText?.dataset?.entityNoteCreated === '1'
        && entityFreeText.style.display !== 'none';
      entityRt.style.display = hasEntityNote ? 'flex' : 'none';
    }

    const sc = document.getElementById('sb-shortcuts');
    if (sc) {
      if (isDbView) sc.textContent = '';
      else if (['entity', 'page'].includes(toolbarViewName)) {
        sc.textContent = 'Ctrl+B 太字 | Ctrl+I 斜体 | Ctrl+U 下線 | Ctrl+Shift+1~6 見出し | Ctrl+Shift+8 箇条書き';
      } else if (toolbarViewName === 'scriptnote') {
        if (typeof updateScriptnoteShortcutStatusbar === 'function') updateScriptnoteShortcutStatusbar(sc);
        else sc.textContent = 'Enter 行追加 | Ctrl+Enter 同タイプ行追加 | Shift+Del 行削除 | Ctrl+↑↓ 行入替 | Ctrl+R ルビ | Ctrl+Z Undo | Ctrl+Y Redo';
      } else sc.textContent = '';
    }
  }

  // ================================================================
  // navPush() オーバーライド
  // ================================================================
  function _overrideNavPush() {
    const _prevNavPush = navPush; // gb-app.jsの上書き版

    navPush = function(entry, paneId) {
      // パネルタブ更新が責務。履歴記録は navPush 本体で行われる
      const targetPaneId = paneId || _getFileOpenPane(GBLayout.activePane);
      if (targetPaneId) _prevNavPush(entry, targetPaneId);

      if (_bridgeUpdating || !_initialized) return;
      if (!entry || !entry.type || entry.type === 'welcome') return;

      _beginBridgeUpdate();
      try {
        const label = entry.label || entry.path?.split('/').pop() || '(無題)';
        const path = entry.path || entry.dbPath || '';
        const type = entry.type;

        // ナビ/補助ペインではなく、作業用ペインのアクティブタブを上書きする
        const paneId = _getFileOpenPane(GBLayout.activePane);
        if (paneId) {
          const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
          if (paneInfo) {
            const pane = paneInfo.node;
            let tabAddedByManager = false;
            // フォルダは既存タブを再利用し、なければアクティブタブを置換
            if (type === 'folder') {
              const folderTab = pane.tabs.find(t => t.type === 'folder');
              if (folderTab) {
                folderTab.label = label;
                folderTab.path = path;
                folderTab.state = {};
                const fi = pane.tabs.indexOf(folderTab);
                pane.activeTabIndex = fi;
                GBLayout.render();
                GBLayout.saveLayout({ immediate: true });
              } else if (pane.tabs.length > 0 && pane.activeTabIndex >= 0) {
                const tab = pane.tabs[pane.activeTabIndex];
                if (typeof removeComponentInstance === 'function') removeComponentInstance(tab.id);
                tab.type = type;
                tab.label = label;
                tab.path = path;
                tab.state = {};
                tab.icon = GBTabs.tabIcon(type);
                GBLayout.render();
                GBLayout.saveLayout({ immediate: true });
              } else {
                GBTabs.addTab(paneId, label, type, path);
                tabAddedByManager = true;
              }
            } else if (pane.tabs.length > 0 && pane.activeTabIndex >= 0) {
              const tab = pane.tabs[pane.activeTabIndex];
              // コンポーネント型タブが自身のnavPushを呼んだ場合: ラベルだけ更新して破棄しない
              if (COMPONENT_TYPES.has(type) && tab.type === type && tab.path === path) {
                tab.label = label;
                GBLayout.saveLayout({ immediate: true });
              } else if (tab.type === type && !COMPONENT_TYPES.has(type)) {
                // 同タイプ内のナビゲーション（page→page 等）: render() 不要、タブラベルのみ更新
                // コンポーネント型は render() でマウントが必要なため除外
                tab.state = entry.mediaType ? { mediaType: entry.mediaType } : {};
                tab.label = label;
                tab.path = path;
                // タブバーのラベルを直接更新（full render を避ける）
                const tabEl = GBLayout.paneMap[paneId]?.el?.querySelector('.gb-tab.active .gb-tab-label');
                if (tabEl) tabEl.textContent = label;
                GBLayout.saveLayout({ immediate: true });
              } else {
                // 別タイプへのナビゲーション: コンポーネントを破棄して置換、full render
                if (typeof removeComponentInstance === 'function') {
                  removeComponentInstance(tab.id);
                }
                tab.state = entry.mediaType ? { mediaType: entry.mediaType } : {};
                tab.type = type;
                tab.label = label;
                tab.path = path;
                tab.icon = GBTabs.tabIcon(type);
                GBLayout.render();
                GBLayout.saveLayout({ immediate: true });
              }
            } else {
              GBTabs.addTab(paneId, label, type, path);
              tabAddedByManager = true;
            }
            if (!tabAddedByManager) _focusFileOpenPane(paneId);
          }
        }
      } finally {
        _endBridgeUpdate();
      }
    };
  }

  // ================================================================
  // レガシータブ関数オーバーライド
  // ================================================================
  function _overrideLegacyTabs() {
    // addTab → GBTabs に委譲
    window.addTab = function(label, type, path) {
      return GBTabs.addToActivePane(label, type, path);
    };

    // activateTab → ペイン内タブ検索して委譲
    window.activateTab = function(tabId) {
      const allPanes = GBLayout.getAllPanes(GBLayout.root);
      for (const pane of allPanes) {
        if ((pane.tabs || []).find(t => t.id === tabId)) {
          GBTabs.activateTab(pane.id, tabId);
          return;
        }
      }
    };

    // closeTab → ペイン内タブ検索して委譲
    window.closeTab = function(tabId) {
      const allPanes = GBLayout.getAllPanes(GBLayout.root);
      for (const pane of allPanes) {
        if ((pane.tabs || []).find(t => t.id === tabId)) {
          GBTabs.closeTab(pane.id, tabId);
          return;
        }
      }
    };

    // renderTabs → noop（ペインシステムがレンダリング担当）
    window.renderTabs = function() {};

    // _openInNewTab → ペインに新タブとして開く
    window._openInNewTab = function(label, path, type) {
      type = type || 'page';
      const paneId = _getFileOpenPane(GBLayout.activePane, { ensureWorkPane: true });
      const tabId = paneId ? GBTabs.addTab(paneId, label, type, path) : null;
      if (tabId) {
        _beginBridgeUpdate();
        window._suppressAutoAppLayoutSwitch = true;
        try {
          navOpen({ type, label, path });
        } finally {
          window._suppressAutoAppLayoutSwitch = false;
          _endBridgeUpdate();
        }
      }
    };

    // 新規作成メニュー（トップバーから呼び出し）
    window.toggleNewMenu = function(e) { _toggleNewMenu(e); };

    // ユーザーメニュー
    window.showUserMenu = function(e) {
      const existing = document.querySelector('.gb-user-menu');
      if (existing) { existing.remove(); return; }
      const menu = document.createElement('div');
      menu.className = 'gb-user-menu gb-context-menu';
      let user = {};
      try { user = JSON.parse(localStorage.getItem('meldex-user') || '{}') || {}; } catch { user = {}; }
      if (user.name) {
        const roleLabels = { owner: '管理者', editor: '編集者', viewer: '閲覧者' };
        const mi = document.createElement('div');
        mi.style.cssText = 'padding:5px 14px;font-size:13px;color:var(--fg2);';
        mi.textContent = user.name + (typeof _myTeamRole !== 'undefined' ? '（' + (roleLabels[_myTeamRole] || '編集者') + '）' : '');
        menu.appendChild(mi);
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
        menu.appendChild(sep);
        const st = document.createElement('div');
        st.style.cssText = 'padding:5px 14px;cursor:pointer;font-size:13px;';
        st.textContent = '設定';
        st.onmouseenter = () => { st.style.background = 'var(--bg4)'; };
        st.onmouseleave = () => { st.style.background = ''; };
        st.addEventListener('click', () => { menu.remove(); if (typeof showSettingsModal === 'function') showSettingsModal({ panel: 'ユーザー' }); });
        menu.appendChild(st);
        if (window.MeldexCloudBootstrap?.openSettingsFlow) {
          const cloud = document.createElement('div');
          cloud.style.cssText = 'padding:5px 14px;cursor:pointer;font-size:13px;';
          cloud.textContent = 'Dropbox / 保存モード';
          cloud.onmouseenter = () => { cloud.style.background = 'var(--bg4)'; };
          cloud.onmouseleave = () => { cloud.style.background = ''; };
          cloud.addEventListener('click', () => {
            menu.remove();
            window.MeldexCloudBootstrap.openSettingsFlow();
          });
          menu.appendChild(cloud);
        }
      } else {
        const mi = document.createElement('div');
        mi.style.cssText = 'padding:5px 14px;font-size:13px;color:var(--fg2);';
        mi.textContent = '名前が設定されていません';
        menu.appendChild(mi);
      }
      document.body.appendChild(menu);
      const fallbackBtn = document.getElementById('left-chrome-user') || document.getElementById('left-chrome-floating-user');
      const btn = e && e.target ? e.target.closest('button') || fallbackBtn : fallbackBtn;
      if (!btn) { menu.remove(); return; }
      const rect = btn.getBoundingClientRect();
      { const z = _getZoom(); menu.style.right = ((window.innerWidth - rect.right) / z) + 'px'; menu.style.top = (rect.bottom / z + 2) + 'px'; }
      clampPopupToViewport(menu);
      setTimeout(() => {
        document.addEventListener('pointerdown', function cl(ev) {
          if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', cl); }
        });
      }, 0);
    };

    // ツールタブを空状態で開く（トップバーボタンから呼び出し）
    window.openToolTab = function(toolType) {
      const labels = {
        page: 'ノート', scriptnote: 'シナリオ', database: 'シート',
        board: 'ボード', calendar: 'カレンダー', timer: 'タイマー',
        'smart-db': 'スマートシート',
        folder: 'フォルダ', outliner: 'フォルダツリー',
      };
      const existingGlobal = (typeof GBTabs !== 'undefined' && typeof GBTabs.findPaneWithTab === 'function')
        ? (GBTabs.findPaneWithTab(toolType, '') || _findToolPaneInAnyGroup(toolType))
        : null;
      if (existingGlobal) {
        _activateToolPaneMatch(existingGlobal);
        return;
      }
      const paneId = _getContentPane(GBLayout.activePane);
      if (!paneId) return;
      // アクティブパネル内に同じタイプのタブがあれば切り替え
      const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
      if (paneInfo) {
        const existing = paneInfo.node.tabs.find(t => t.type === toolType);
        if (existing) {
          GBTabs.activateTab(paneId, existing.id);
          return;
        }
      }
      const tabId = GBTabs.addTab(paneId, labels[toolType] || toolType, toolType, '');
      if (tabId) _showEmptyToolView(toolType);
    };

    // パネルメニュー経由の「常に新規タブとして追加」動作（C案 — 他のパネルセットに同種のタブがあっても新規追加する）
    const _PANEL_MENU_LABELS = {
      page: 'ノート', scriptnote: 'シナリオ', database: 'シート',
      board: 'ボード', calendar: 'カレンダー', timer: 'タイマー',
      'smart-db': 'スマートシート',
      folder: 'フォルダ',
      outliner: 'フォルダツリー', preview: 'ビューワー', detail: 'オプション',
      chat: 'チャット', history: 'ヒストリー', annotation: '注釈',
    };
    const _PANEL_FILE_CREATE_TYPES = new Set(['page', 'scriptnote', 'database', 'board', 'smart-db']);
    const _PANEL_FILE_OPEN_TYPES = {
      database: 'pivot',
    };
    function _panelFileTabState(toolType, name, path) {
      const state = { label: name };
      if (toolType === 'scriptnote') state.scenarioPath = path;
      if (toolType === 'board') state.boardPath = path;
      if (toolType === 'database') state.dbPath = path;
      if (toolType === 'smart-db') state.smartDbPath = path;
      return state;
    }
    async function _panelHomeFolderPath() {
      try {
        if (typeof _homeFolderPath !== 'undefined' && _homeFolderPath) return _homeFolderPath;
      } catch (_) {}
      try {
        const res = await apiFetch('/home-folder');
        const path = res?.path || '';
        try {
          if (path && typeof _homeFolderPath !== 'undefined') _homeFolderPath = path;
        } catch (_) {}
        return path;
      } catch (_) {
        return '';
      }
    }
    async function _refreshPanelCreatedFileLists(path) {
      const jobs = [];
      if (typeof renderHomeFolderTree === 'function') jobs.push(Promise.resolve().then(() => renderHomeFolderTree()));
      if (typeof loadOutliner === 'function') jobs.push(Promise.resolve().then(() => loadOutliner()));
      if (jobs.length) await Promise.allSettled(jobs);
      if (path && typeof highlightOutlinerNode === 'function') {
        try { highlightOutlinerNode(path); } catch (_) {}
      }
    }
    let _panelCreatedFileListRefreshScheduled = false;
    let _panelCreatedFileListRefreshPath = '';
    function _schedulePanelCreatedFileListRefresh(path) {
      if (path) _panelCreatedFileListRefreshPath = path;
      if (_panelCreatedFileListRefreshScheduled) return;
      _panelCreatedFileListRefreshScheduled = true;
      const defer = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => setTimeout(fn, 0);
      defer(() => setTimeout(() => {
        const refreshPath = _panelCreatedFileListRefreshPath;
        _panelCreatedFileListRefreshPath = '';
        _panelCreatedFileListRefreshScheduled = false;
        _refreshPanelCreatedFileLists(refreshPath).catch(() => {});
      }, 0));
    }
    async function _createPanelFileTab(toolType, paneId) {
      let pendingTabId = null;
      try {
        const openType = _PANEL_FILE_OPEN_TYPES[toolType] || toolType;
        const pendingState = _panelFileTabState(toolType, '無題', '');
        pendingState.pendingCreate = true;
        pendingTabId = GBTabs.addTab(paneId, '無題', openType, '', pendingState, { forceNewToolTab: true });
        if (pendingTabId && typeof GBLayout.setActivePane === 'function') GBLayout.setActivePane(paneId);
        const parent = await _panelHomeFolderPath();
        if (!parent) {
          if (pendingTabId) GBTabs.closeTab(paneId, pendingTabId, { skipHistory: true });
          if (typeof showStatus === 'function') showStatus('ホームフォルダが見つからないため作成できません', true);
          return null;
        }
        const res = await apiPost('/outliner/add', { type: toolType, label: '無題', parent });
        const node = res?.node || {};
        const path = node.path || '';
        if (!path) throw new Error('created node path is empty');
        const name = node.name || node.label || '無題';
        const state = _panelFileTabState(toolType, name, path);
        const tabId = pendingTabId || GBTabs.addTab(paneId, name, openType, path, state, { forceNewToolTab: true });
        if (pendingTabId && typeof GBTabs.updateTab === 'function') {
          GBTabs.updateTab(paneId, pendingTabId, { label: name, type: openType, path, state }, { activate: true });
        } else if (!pendingTabId && tabId && typeof GBLayout.setActivePane === 'function') {
          GBLayout.setActivePane(paneId);
        }
        _schedulePanelCreatedFileListRefresh(path);
        if (typeof showStatus === 'function') showStatus('作成しました: ' + name);
        return tabId;
      } catch (err) {
        if (pendingTabId) GBTabs.closeTab(paneId, pendingTabId, { skipHistory: true });
        if (typeof showStatus === 'function') showStatus('作成に失敗しました', true);
        return null;
      }
    }
    window.addPanelMenuTool = function(toolType, options) {
      // ＋ボタン／パネルメニューから呼ばれた時は、メニューを開いたペインへ追加する。
      // paneId 未指定の既存呼び出しだけ、現在アクティブなペインを使う。
      const paneId = options?.paneId || GBLayout.activePane;
      if (!paneId) return null;
      if (!GBLayout.findNode?.(GBLayout.root, paneId)) return null;
      if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(paneId)) {
        if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
        return null;
      }
      if (_PANEL_FILE_CREATE_TYPES.has(toolType)) {
        return _createPanelFileTab(toolType, paneId);
      }
      const label = _PANEL_MENU_LABELS[toolType] || toolType;
      const tabId = GBTabs.addTab(paneId, label, toolType, '', null, { forceNewToolTab: true });
      if (tabId && typeof _showEmptyToolView === 'function') _showEmptyToolView(toolType);
      return tabId;
    };
    window.addPanelMenuVersion = function(options) {
      const target = (typeof _getCurrentVersionTarget === 'function')
        ? _getCurrentVersionTarget() : { path: '', type: 'file' };
      const vType = target.type || 'file';
      const path = target.path || '';
      const hasPath = !!path;
      const label = hasPath ? 'バージョン: ' + (path.split('/').pop() || path) : 'バージョン管理';
      const paneId = options?.paneId || GBLayout.activePane;
      if (!paneId) return null;
      if (!GBLayout.findNode?.(GBLayout.root, paneId)) return null;
      if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(paneId)) {
        if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
        return null;
      }
      const tabId = GBTabs.addTab(paneId, label, 'version', '', { versionType: vType, versionPath: path });
      if (!tabId) return null;
      if (hasPath) {
        const comp = typeof getComponentInstance === 'function' ? getComponentInstance(tabId) : null;
        if (comp && comp._loadVersions) comp._loadVersions(path, vType);
      }
      return tabId;
    };

    // バージョン管理タブを開く（path が空でも「対象未指定」の状態で開ける）
    window.openVersionTab = function(path, versionType) {
      const vType = versionType || 'file';
      const hasPath = !!path;
      const searchPath = path || '';
      const fileName = hasPath ? (path.split('/').pop() || path) : '';
      const label = hasPath ? 'バージョン: ' + fileName : 'バージョン管理';
      const hostInfo = _getVersionHostPaneInfo();

      // 対象付きで呼ばれた時、空タブ（対象未指定）が既にあれば、そこに対象を流し込んで再利用する
      if (hasPath) {
        const emptyExisting = GBTabs.findPaneWithTab('version', '');
        if (emptyExisting) {
          const emptyPaneInfo = GBLayout.findNode(GBLayout.root, emptyExisting.paneId);
          const emptyTab = emptyPaneInfo?.node?.tabs?.find(t => t.id === emptyExisting.tabId);
          if (emptyTab) {
            if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(emptyExisting.paneId)) {
              GBTabs.activateTab(emptyExisting.paneId, emptyExisting.tabId);
              return emptyExisting.tabId;
            }
            emptyTab.path = path;
            emptyTab.label = label;
            emptyTab.state = { ...(emptyTab.state || {}), versionType: vType };
            GBLayout.render();
            GBLayout.saveLayout();
            _expandCollapsedPane(emptyExisting.paneId);
            GBTabs.activateTab(emptyExisting.paneId, emptyExisting.tabId);
            const comp = typeof getComponentInstance === 'function' ? getComponentInstance(emptyExisting.tabId) : null;
            if (comp && comp._loadVersions) comp._loadVersions(path, vType);
            return emptyExisting.tabId;
          }
        }
      }

      const existing = GBTabs.findPaneWithTab('version', searchPath);

      if (existing) {
        const existingPaneInfo = GBLayout.findNode(GBLayout.root, existing.paneId);
        const existingTab = existingPaneInfo?.node?.tabs?.find(t => t.id === existing.tabId);
        const existingLocked = typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(existing.paneId);
        if (_isVersionHostPane(existingPaneInfo?.node)) {
          if (!existingLocked) _updateVersionTab(existingTab, label, vType);
          GBLayout.render();
          GBLayout.saveLayout();
          _expandCollapsedPane(existing.paneId);
          GBTabs.activateTab(existing.paneId, existing.tabId);
          return existing.tabId;
        }
        if (hostInfo.reusable && hostInfo.paneId && hostInfo.paneId !== existing.paneId) {
          if (existingLocked ||
              (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(hostInfo.paneId))) {
            GBTabs.activateTab(existing.paneId, existing.tabId);
            return existing.tabId;
          }
          _updateVersionTab(existingTab, label, vType);
          _expandCollapsedPane(hostInfo.paneId);
          GBTabs.moveTab(existing.paneId, existing.tabId, hostInfo.paneId);
          GBTabs.activateTab(hostInfo.paneId, existing.tabId);
          return existing.tabId;
        }
        if (existingLocked) {
          GBTabs.activateTab(existing.paneId, existing.tabId);
          return existing.tabId;
        }
        _updateVersionTab(existingTab, label, vType);
        const sourcePaneId = hostInfo.paneId || existing.paneId;
        if (!sourcePaneId) return existing.tabId;
        const newPane = GBLayout.createPaneNode(null, [], -1);
        const newPaneId = GBLayout.splitPane(sourcePaneId, 'horizontal', 'right', newPane);
        if (!newPaneId) {
          GBTabs.activateTab(existing.paneId, existing.tabId);
          return existing.tabId;
        }
        GBTabs.moveTab(existing.paneId, existing.tabId, newPaneId);
        GBTabs.activateTab(newPaneId, existing.tabId);
        return existing.tabId;
      }

      if (hostInfo.reusable && hostInfo.paneId) {
        _expandCollapsedPane(hostInfo.paneId);
        return GBTabs.addTab(hostInfo.paneId, label, 'version', searchPath, { versionType: vType });
      }

      const sourcePaneId = hostInfo.paneId;
      if (!sourcePaneId) return null;
      const tab = GBTabs.createTab(label, 'version', searchPath, { versionType: vType });
      const newPane = GBLayout.createPaneNode(null, [tab], 0);
      const newPaneId = GBLayout.splitPane(sourcePaneId, 'horizontal', 'right', newPane);
      if (newPaneId) {
        GBLayout.setActivePane(newPaneId);
        if (typeof _refreshPaneAfterTabSwitch === 'function') {
          _refreshPaneAfterTabSwitch(newPaneId);
        }
      }
      return tab.id;
    };

    // バージョンパネルを更新
    window.refreshVersionPanel = function() {
      const activeTab = GBTabs.getActiveTab(GBLayout.activePane);
      if (!activeTab || activeTab.type !== 'version') return;
      const comp = typeof getComponentInstance === 'function' ? getComponentInstance(activeTab.id) : null;
      if (comp && comp._loadVersions) {
        comp._loadVersions(comp.state.versionPath, comp.state.versionType);
      }
    };

    function _initToolDropTargets() {
      // パネルのタブバーのみでツールドロップを受け付け（コンテンツ領域は除外）
      document.addEventListener('dragover', (e) => {
        if (!e.target.closest('.gb-pane-tabs')) return;
        if (!e.dataTransfer.types.includes('application/meldex-tool')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });

      document.addEventListener('drop', (e) => {
        const tool = e.dataTransfer.getData('application/meldex-tool');
        if (!tool) return;
        // タブバーへのドロップのみ（コンテンツ領域はノート/キャンバス等の固有D&Dに委ねる）
        if (!e.target.closest('.gb-pane-tabs')) return;
        e.preventDefault();
        const paneEl = e.target.closest('.gb-pane');
        if (!paneEl) return;
        const paneId = paneEl.dataset.paneId;
        if (!paneId) return;
        if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(paneId)) {
          if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
          return;
        }

        const labels = {
          page: 'ノート', scriptnote: 'シナリオ', database: 'シート',
          board: 'ボード', calendar: 'カレンダー', timer: 'タイマー', preview: 'ビューワー',
          'smart-db': 'スマートシート',
          folder: 'フォルダ', chat: 'チャット', history: 'ヒストリー',
          annotation: '注釈', detail: 'オプション',
        };

        if (typeof window.addPanelMenuTool === 'function') {
          window.addPanelMenuTool(tool, { paneId });
          return;
        }
        GBTabs.addTab(paneId, labels[tool] || tool, tool, '');
      });
    }
    setTimeout(_initToolDropTargets, 500);

    // 空状態UI表示
    function _showEmptyToolView(toolType) {
      const labels = {

/* Source chunk: gb-pane-bridge.part03.js */
      page: 'ノート', scriptnote: 'シナリオ', database: 'シート',
      board: 'ボード', calendar: 'カレンダー',
      'smart-db': 'スマートシート', folder: 'フォルダ',
      };
      const containerId = LEGACY_CONTAINERS[toolType];
      if (!containerId) return;
      const el = document.getElementById(containerId);
      if (!el) return;
      const label = labels[toolType] || toolType;
      // 空状態オーバーレイを表示（既存コンテンツの上に）
      let emptyEl = el.querySelector('.gb-empty-state');
      if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'gb-empty-state';
        emptyEl.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg);z-index:5;gap:12px;';
        el.style.position = 'relative';
        el.appendChild(emptyEl);
      }
      emptyEl.innerHTML = '<div style="font-size:36px;color:var(--fg2);">' + (typeof lucide === 'function' ? lucide(GBTabs.tabIcon(toolType), 48) : '') + '</div>'
        + '<div style="font-size:16px;color:var(--fg);">' + label + '</div>'
        + '<div style="font-size:13px;color:var(--fg2);">ファイルを開くか、新規作成してください</div>'
        + '<button class="gb-empty-create-btn" style="margin-top:8px;padding:6px 16px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:6px;cursor:pointer;font-size:13px;">+ 新規作成</button>';
      emptyEl.querySelector('.gb-empty-create-btn').addEventListener('click', () => {
        emptyEl.remove();
        if (typeof showAddOutlinerItem === 'function') showAddOutlinerItem(toolType);
      });
    }

    // サイドバートグル → フォルダツリーペインの開閉
    window.toggleSidebar = function() {
      if (window.MeldexCloudMobile?.toggleSidebarDrawer?.()) return;
      _openToolPane('outliner', { toggleExisting: true });
    };

    // オプションパネルトグル → 詳細タブとして開く
    window.toggleOptionPanel = function() {
      _openToolPane('detail', { toggleExisting: true });
    };
    window.toggleDetailPanel = window.toggleOptionPanel;
  }

  // ================================================================
  // 右パネル廃止 → ペインタブ化
  // ================================================================
  function _overrideRightPanel() {
    // 右パネルを非表示
    const rp = document.getElementById('right-panel');
    const rrh = document.getElementById('right-resize-handle');
    const rab = document.getElementById('activity-bar-right');
    if (rp) rp.style.display = 'none';
    if (rrh) rrh.style.display = 'none';
    // 右アクティビティバーは残す（ペインタブ開きのトリガーとして使う）

    // toggleRightPanelTab → ペインにツールを開く
    window.toggleRightPanelTab = function(tabName) {
      _openToolPane(tabName, { toggleExisting: true });
    };
    window.openRightPanelTab = function(tabName) {
      _openToolPane(tabName);
    };
    window.toggleRightPanel = function() {
      const rightPanelTypes = ['chat', 'calendar', 'timer', 'history', 'annotation', 'preview', 'detail'];
      let closed = 0;
      rightPanelTypes.forEach((type) => {
        for (let guard = 0; guard < 20; guard += 1) {
          const found = GBTabs.findPaneWithTab(type, '');
          if (!found) break;
          GBTabs.closeTab(found.paneId, found.tabId);
          closed += 1;
        }
      });
      if (!closed) {
        _openToolPane('chat');
      }
    };

    // switchRightTab → ペインタブ切替
    window.switchRightTab = function(tabName) {
      _openToolPane(tabName);
    };

    // 旧スプリットビュー → ペイン分割に置換
    let _legacySplitPair = null;
    function _findDirectParentSplit(root, paneId) {
      if (!root || root.type !== 'split') return null;
      for (const child of (root.children || [])) {
        if (!child) continue;
        if (child.id === paneId) return root;
        if (child.type === 'split') {
          const found = _findDirectParentSplit(child, paneId);
          if (found) return found;
        }
      }
      return null;
    }
    function _getLegacySplitPair() {
      if (!_legacySplitPair?.sourcePaneId || !_legacySplitPair?.splitPaneId) {
        _legacySplitPair = null;
        return null;
      }
      const sourcePane = GBLayout.findNode(GBLayout.root, _legacySplitPair.sourcePaneId)?.node;
      const splitPane = GBLayout.findNode(GBLayout.root, _legacySplitPair.splitPaneId)?.node;
      if (!sourcePane || !splitPane || sourcePane.type !== 'pane' || splitPane.type !== 'pane') {
        _legacySplitPair = null;
        return null;
      }
      const sourceParent = _findDirectParentSplit(GBLayout.root, sourcePane.id);
      const splitParent = _findDirectParentSplit(GBLayout.root, splitPane.id);
      if (!sourceParent || sourceParent !== splitParent) {
        _legacySplitPair = null;
        return null;
      }
      return { sourcePane, splitPane };
    }
    function _disposePaneTabs(pane) {
      pane?.tabs?.forEach(t => {
        if (typeof removeComponentInstance === 'function') removeComponentInstance(t.id);
      });
    }
    function _entryFromSplitArg(splitArg) {
      if (!splitArg) return null;
      if (typeof splitArg === 'object') {
        const path = splitArg.path || splitArg.dbPath || '';
        return {
          label: splitArg.label || path.split('/').pop() || '(無題)',
          type: splitArg.type || 'pivot',
          path,
        };
      }
      const path = String(splitArg || '');
      return { label: path.split('/').pop() || path || '(無題)', type: 'pivot', path };
    }
    function _replacePaneWithEntry(pane, entry) {
      if (!pane || pane.type !== 'pane' || !entry) return false;
      _disposePaneTabs(pane);
      pane.tabs = [GBTabs.createTab(entry.label, entry.type, entry.path)];
      pane.activeTabIndex = 0;
      GBLayout.render();
      GBLayout.saveLayout();
      GBLayout.setActivePane(pane.id);
      return true;
    }
    function _activateLegacySplitView(splitArg) {
      if (GBLayout.isMaximized()) { GBLayout.restoreMaximizedPane(); return false; }
      const requestedEntry = _entryFromSplitArg(splitArg);
      const existingPair = _getLegacySplitPair();
      if (existingPair) {
        if (requestedEntry) _replacePaneWithEntry(existingPair.splitPane, requestedEntry);
        return true;
      }
      const paneId = GBLayout.activePane;
      if (!paneId) return false;
      const activeTab = GBTabs.getActiveTab(paneId);
      const entry = requestedEntry || {
        label: activeTab ? activeTab.label : '(無題)',
        type: activeTab ? activeTab.type : 'welcome',
        path: activeTab ? activeTab.path : '',
      };
      const tab = GBTabs.createTab(entry.label, entry.type, entry.path);
      const newPane = GBLayout.createPaneNode(null, [tab], 0);
      const splitPaneId = GBLayout.splitPane(paneId, 'horizontal', 'right', newPane);
      if (!splitPaneId) return false;
      _legacySplitPair = { sourcePaneId: paneId, splitPaneId };
      GBLayout.setActivePane(splitPaneId);
      return true;
    }
    function _deactivateLegacySplitView() {
      if (GBLayout.isMaximized()) { GBLayout.restoreMaximizedPane(); return false; }
      const pair = _getLegacySplitPair();
      if (!pair) return false;
      _disposePaneTabs(pair.splitPane);
      GBLayout.removePane(pair.splitPane.id);
      _legacySplitPair = null;
      if (GBLayout.findNode(GBLayout.root, pair.sourcePane.id)?.node) {
        GBLayout.setActivePane(pair.sourcePane.id);
      }
      return true;
    }
    window.toggleSplitView = function() {
      if (!_deactivateLegacySplitView()) _activateLegacySplitView();
    };
    window.activateSplitView = function(splitArg) {
      _activateLegacySplitView(splitArg);
    };
    window.deactivateSplitView = function() {
      _deactivateLegacySplitView();
    };
    window.isSplitActive = function() {
      return !!_getLegacySplitPair();
    };
    window.openInNewSplit = function(dbPath) {
      return _activateLegacySplitView(_entryFromSplitArg(dbPath));
    };
    window.openDbInOtherPane = function(dbPath) {
      const entry = _entryFromSplitArg(dbPath);
      const pair = _getLegacySplitPair();
      if (!pair) return _activateLegacySplitView(entry);
      const targetPane = GBLayout.activePane === pair.splitPane.id ? pair.sourcePane : pair.splitPane;
      return _replacePaneWithEntry(targetPane, entry);
    };
  }

  function _findToolPaneInAnyGroup(toolType) {
    const targetPath = '';
    function walk(node, panelsetNode, groupId) {
      if (!node) return null;
      if (node.type === 'pane') {
        const tab = (node.tabs || []).find(t => t.type === toolType && (t.path || '') === targetPath);
        return tab ? { paneId: node.id, tabId: tab.id, panelsetNode, groupId } : null;
      }
      if (node.type === 'split' && Array.isArray(node.children)) {
        for (const child of node.children) {
          const found = walk(child, panelsetNode, groupId);
          if (found) return found;
        }
      } else if (node.type === 'panelset' && Array.isArray(node.groups)) {
        for (const group of node.groups) {
          const found = walk(group?.root, node, group?.id || '');
          if (found) return found;
        }
      }
      return null;
    }
    return walk(GBLayout.root, null, '') || null;
  }

  function _activateToolPaneMatch(match, options) {
    if (!match?.paneId || !match?.tabId) return;
    if (match.panelsetNode && match.groupId && match.panelsetNode.activeGroupId !== match.groupId) {
      match.panelsetNode.activeGroupId = match.groupId;
    }
    GBTabs.activateTab(match.paneId, match.tabId, options);
  }

  function _scheduleContentPaneRestore(paneId) {
    if (!paneId) return;
    const run = () => {
      if (typeof GBLayout === 'undefined' || !GBLayout.root || !GBLayout.paneMap?.[paneId]) return;
      const paneInfo = _getPaneInfoById(paneId);
      if (!paneInfo || _isToolbarUtilityView(paneInfo.activeTab?.type)) return;
      _refreshMountedPane(paneId);
      const toolbarView = _toolbarViewForTab(paneInfo.activeTab) || state.view || '';
      _syncStateView();
      _mountFloatingAnnotationUi();
      if (toolbarView && typeof _updateToolbars === 'function') _updateToolbars(toolbarView);
      if (typeof replaceIcons === 'function') replaceIcons();
    };
    queueMicrotask(run);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 0);
    setTimeout(run, 80);
  }

  function _toolLabel(toolType) {
    return TOOL_LABELS[toolType] || toolType || '';
  }

  // ツール（chat/calendar/annotation/history等）をペインタブとして開く
  function _openToolPane(toolType, options) {
    const openOpts = options || {};
    const popupToolType = toolType === 'sticky' ? 'annotation' : toolType;
    const mobileSinglePane = typeof GBLayout?.isMobileLayout === 'function' && GBLayout.isMobileLayout();
    const preserveWorkActive = !mobileSinglePane && _isPassiveToolPaneTab(toolType, { type: toolType, path: '' });
    if (typeof GBDockPopup !== 'undefined' && typeof GBDockPopup.activateTabType === 'function') {
      if (GBDockPopup.activateTabType(popupToolType, '')) return;
    }

    // 既に開いているか確認
    const existing = GBTabs.findPaneWithTab(toolType, '') || _findToolPaneInAnyGroup(toolType);
    if (existing) {
      const paneId = existing.paneId;
      const activePane = GBLayout.activePane;
      // toggleRightPanelTab() だけが同一ペイン時のクローズを許可する。
      // openRightPanelTab()/switchRightTab() は既存タブを必ずアクティブ化する。
      const existingVisible = typeof GBLayout.isPaneVisible === 'function'
        ? GBLayout.isPaneVisible(paneId)
        : paneId === activePane;
      const closeExisting = openOpts.toggleExisting && (paneId === activePane || (preserveWorkActive && existingVisible));
      if (!closeExisting) {
        const restorePaneId = _getContentPane(activePane) || _getFileOpenPane(activePane);
        _activateToolPaneMatch(existing, { preserveActivePane: preserveWorkActive });
        _scheduleContentPaneRestore(restorePaneId);
      } else {
        GBTabs.closeTab(paneId, existing.tabId);
      }
      return;
    }

    // 新規作成
    const paneId = GBLayout.activePane;
    if (!paneId) return;
    const tab = GBTabs.createTab(_toolLabel(toolType), toolType, '');
    const newPane = GBLayout.createPaneNode(null, [tab], 0);

    if (NAV_PANE_TYPES.has(toolType)) {
      // ナビペインは常に左に配置
      const newPaneId = GBLayout.splitPane(paneId, 'horizontal', 'left', newPane);
      if (newPaneId) GBLayout.setActivePane(newPaneId);
    } else {
      // 通常ツールは右に配置
      const allPanes = GBLayout.getAllPanes(GBLayout.root);
      const reusableToolPane = allPanes.find(pane => pane?.id && !pane.locked && _isVersionHostPane(pane));
      if (reusableToolPane) {
        const restorePaneId = _getContentPane(GBLayout.activePane) || _getFileOpenPane(GBLayout.activePane);
        GBTabs.addTab(reusableToolPane.id, _toolLabel(toolType), toolType, '', null, { preserveActivePane: preserveWorkActive });
        _scheduleContentPaneRestore(restorePaneId);
        return;
      }
      const sourcePaneId = _getContentPane(GBLayout.activePane) || paneId;
      const newPaneId = GBLayout.splitPane(sourcePaneId, 'horizontal', 'right', newPane);
      if (newPaneId) {
        if (!preserveWorkActive) GBLayout.setActivePane(newPaneId);
        _refreshPaneAfterTabSwitch(newPaneId, { previousActivePane: preserveWorkActive ? null : sourcePaneId });
        _scheduleContentPaneRestore(sourcePaneId);
      }
    }
  }

  // ================================================================
  // 新規作成ドロップダウンメニュー
  // ================================================================
  function _toggleNewMenu(e) {
    const existing = document.querySelector('.gb-new-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'gb-new-menu gb-context-menu';
    const items = [
      ['ノート', 'page', () => openToolTab('page')],
      ['シナリオ', 'bookOpenText', () => openToolTab('scriptnote')],
      ['シート', 'db', () => openToolTab('database')],
      ['ボード', 'presentation', () => openToolTab('board')],
      ['カレンダー', 'calendar', () => openToolTab('calendar')],
      ['スマートシート', 'databaseSearch', () => openToolTab('smart-db')],
      ['---'],
      ['フォルダ', 'folder', () => openToolTab('folder')],
      ['XLSX取込', (typeof uiTransferIconName === 'function' ? uiTransferIconName('import') : 'download'), () => { if (typeof importXlsxToOutliner === 'function') importXlsxToOutliner(); }],
      ['ゴミ箱', 'trash2', () => { if (typeof showTrashModal === 'function') showTrashModal(); }],
    ];
    for (const item of items) {
      if (item[0] === '---') {
        const s = document.createElement('div');
        s.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
        menu.appendChild(s);
        continue;
      }
      const mi = document.createElement('div');
      mi.style.cssText = 'padding:5px 14px;cursor:pointer;font-size:13px;white-space:nowrap;display:flex;align-items:center;gap:6px;';
      mi.innerHTML = (typeof lucide === 'function' ? lucide(item[1], 14) : '') + ' ' + item[0];
      mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; };
      mi.onmouseleave = () => { mi.style.background = ''; };
      mi.addEventListener('click', () => { menu.remove(); item[2](); });
      menu.appendChild(mi);
    }

    document.body.appendChild(menu);
    const btn = (e && e.target) ? e.target.closest('button') || document.getElementById('btn-new-menu') : document.getElementById('btn-new-menu');
    const rect = btn.getBoundingClientRect();
    { const z = _getZoom(); menu.style.left = (rect.left / z) + 'px'; menu.style.top = (rect.bottom / z + 2) + 'px'; }
    requestAnimationFrame(() => {
      const z = _getZoom(); const mr = menu.getBoundingClientRect();
      if (mr.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - mr.height - 4) / z) + 'px';
      if (mr.right > window.innerWidth) menu.style.left = ((window.innerWidth - mr.width - 4) / z) + 'px';
    });
    setTimeout(() => {
      document.addEventListener('pointerdown', function cl(ev) {
        if (!menu.contains(ev.target) && ev.target !== btn) { menu.remove(); document.removeEventListener('pointerdown', cl, true); }
      }, true);
    }, 0);
  }

  // ================================================================
  // キーボードルーティング
  // ================================================================
  function _setupKeyboardRouting() {
    // Ctrl+Shift+M, Ctrl+W → gb-shortcuts.js の中央ハンドラに移行済み
    // コンポーネントへのキー委譲のみ残存
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return;
      const activeTab = GBTabs.getActiveTab();
      if (activeTab) {
        const component = getComponentInstance(activeTab.id);
        if (component && component.handleKeyDown && component.handleKeyDown(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    });
  }

  function _capturePaneComponentStates(pane) {
    for (const tab of (pane?.tabs || [])) {
      const comp = getComponentInstance(tab.id);
      if (!comp || typeof comp.getState !== 'function') continue;
      try {
        tab.state = comp.getState();
      } catch (e) {
        console.warn('[PaneBridge] getState failed:', tab.id, e);
      }
    }
  }

  function _refreshMountedPane(paneId, options) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root || !paneId) return;
    const pane = GBLayout.findNode?.(GBLayout.root, paneId)?.node || null;
    if (!pane || pane.type !== 'pane') return;
    _capturePaneComponentStates(pane);
    _mountPaneContent(pane, options);
  }

  function _mountVirtualPane(pane, contentEl, options) {
    if (typeof GBLayout === 'undefined' || !pane?.id || !contentEl) return false;
    const paneMap = GBLayout.paneMap;
    if (!paneMap) return false;
    paneMap[pane.id] = {
      node: pane,
      el: contentEl.closest?.('.gb-subpanel') || contentEl,
      contentEl,
    };
    _mountPaneContent(pane, { ...(options || {}), subPanel: true });
    return true;
  }

  function _refreshPaneAfterTabSwitch(paneId, options) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return;
    _refreshMountedPane(paneId, options);
    const previousActivePane = options?.previousActivePane || null;
    if (previousActivePane && previousActivePane !== paneId) {
      _refreshMountedPane(previousActivePane);
    }
    _syncStateView();
    _mountFloatingAnnotationUi();
    _syncDetailForActivePane(GBLayout.activePane || paneId);
    _syncToolButtonStates();
    if (typeof GBAppLayouts !== 'undefined' && typeof GBAppLayouts.syncButtons === 'function') {
      GBAppLayouts.syncButtons();
    }
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  function _retractPaneContent(paneId) {
    const contentEl = GBLayout?.paneMap?.[paneId]?.contentEl || null;
    if (!contentEl) return false;
    _retractLegacyFromPane(contentEl);
    return true;
  }

  function _resetDefaultLayout(options) {
    const before = !options?.skipHistory && typeof GBLayout.captureLayoutSnapshot === 'function'
      ? GBLayout.captureLayoutSnapshot()
      : null;
    _buildDefaultLayout(GBLayout.createPaneNode('pane-main', [], -1));
    if (before && typeof GBLayout.pushLayoutHistory === 'function') {
      GBLayout.pushLayoutHistory('レイアウト: 初期化', before, GBLayout.captureLayoutSnapshot(), '標準レイアウトへ戻す');
    }
  }

  // ================================================================
  // Public API
  // ================================================================
  return {
    init,
    mountAllPanes: _mountAllPanes,
    mountFloatingAnnotationUi: _mountFloatingAnnotationUi,
    mountVirtualPane: _mountVirtualPane,
    activateFileOpenPane: _activateFileOpenPane,
    activateAnnotationFabForPane: _activateAnnotationFabForPane,
    getAnnotationContentPaneInfo: _getAnnotationContentPaneInfo,
    getCurrentAnnotationTarget: _getCurrentAnnotationTarget,
    rememberAnnotationTargetForPane: _rememberAnnotationTargetForPane,
    refreshPaneAfterTabSwitch: _refreshPaneAfterTabSwitch,
    retractPaneContent: _retractPaneContent,
    toolLabel: _toolLabel,
    toggleNewMenu: _toggleNewMenu,
    clearDetailPaneShell: _clearDetailPaneShell,
    resetDefaultLayout: _resetDefaultLayout,
    get initialized() { return _initialized; },
  };
})();
