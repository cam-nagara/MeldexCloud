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
  let _chatModeInitDone = false; // チャットのモード決定（復元/team既定）は初回ライブマウント時のみフラグ
  let _stickyTypeInitDone = false; // 付箋タブの種類フィルタ既定値適用は初回ライブマウント時のみフラグ
  let _appToolbarTemplateHtml = '';

  // ビュータイプ → レガシーコンテナ要素ID
  // 注: login-viewはペインシステム外で管理（認証時のオーバーレイ）
  const LEGACY_CONTAINERS = {
    welcome:    'welcome-view',
    database:   'db-view-container',
    pivot:      'db-view-container',
    tree:       'db-view-container',
    gallery:    'db-view-container',
    kanban:     'db-view-container',
    timeline:   'db-view-container',
    gantt:      'db-view-container',
    chart:      'db-view-container',
    graph:      'db-view-container',
    form:       'db-view-container',
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
    tree:       'tree-view',
    gallery:    'gallery-view',
    kanban:     'kanban-view',
    timeline:   'timeline-view',
    gantt:      'timeline-view',
    chart:      'chart-view',
    graph:      'graph-view',
    form:       'form-view',
  };

  // ToolComponentで描画するタイプ（レガシーコンテナを使わない、独自DOM生成）
  const COMPONENT_TYPES = new Set([
    'calendar', 'search', 'scriptnote', 'version', 'board', 'system-sheet',
    'information', 'backlinks', 'file-theme',
  ]);

  // 右パネルから移行するコンテナ（レガシーコンテナとして管理）
  const RP_CONTAINERS = {
    chat:       'rp-chat',
    annotation: 'rp-annotation',
    sticky:     'rp-annotation',
    history:    'rp-history',
    tags:       'rp-tags',
  };

  // 特殊パネルコンテナ（サイドバー・詳細パネル等、丸ごとペインに移動）
  const PANEL_CONTAINERS = {
    outliner:   'sidebar',
    detail:     'rp-detail',
    preview:    'gb-preview-pane',
    subpanel:   'gb-subpanel-root',
  };
  const TOOL_LABELS = Object.freeze({
    outliner: 'フォルダツリー',
    detail: 'オプション',
    preview: 'ビューワー',
    subpanel: 'サブパネル',
    calendar: 'スケジュール',
    chat: 'チャット',
    annotation: 'アノテート',
    history: 'ヒストリー',
    sticky: '付箋',
    tags: 'タグ',
    scriptnote: 'シナリオ',
    search: '検索',
    version: 'バージョン管理',
    page: 'ノート',
    database: 'シート',
    pivot: 'シート',
    tree: 'シート',
    gallery: 'シート',
    kanban: 'シート',
    timeline: 'シート',
    gantt: 'シート',
    chart: 'シート',
    graph: 'シート',
    form: 'シート',
    board: 'ボード',
    folder: 'フォルダ',
    entity: 'エントリ',
    media: 'メディア',
    html: 'HTML',
    csv: 'CSV',
    compare: '比較',
  });
  const FLOATING_UI_CONTAINERS = ['ann-overlay', 'btn-tb-annotation'];

  function _isLegacySnapshotNode(el) {
    return !!el?.closest?.('[data-gb-snapshot="true"]');
  }

  function _rememberAppToolbarTemplate() {
    const appTb = document.getElementById('app-toolbar');
    if (appTb && !_isLegacySnapshotNode(appTb) && !_appToolbarTemplateHtml) {
      _appToolbarTemplateHtml = appTb.outerHTML;
    }
    return appTb;
  }

  function _ensureAppToolbarElement() {
    const existing = document.getElementById('app-toolbar');
    if (existing && !_isLegacySnapshotNode(existing)) {
      if (!_appToolbarTemplateHtml) _appToolbarTemplateHtml = existing.outerHTML;
      return existing;
    }
    if (!_appToolbarTemplateHtml) _rememberAppToolbarTemplate();
    if (!_appToolbarTemplateHtml) return null;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = _appToolbarTemplateHtml.trim();
    const restored = wrapper.firstElementChild;
    if (!restored || restored.id !== 'app-toolbar') return null;
    restored.classList.remove('visible');
    const storage = document.getElementById('legacy-views') || document.body;
    storage.appendChild(restored);
    if (typeof replaceIcons === 'function') replaceIcons(restored);
    return restored;
  }
  // コンテナID → 現在配置ペインID
  const _containerPane = {};
  const _legacySnapshots = new Map(); // tabId -> cloned DOM
  const _legacySnapshotHosts = new Map(); // tabId -> host element
  const _legacyLiveBindings = new Map(); // containerId -> { paneId, tabId, viewName, observer }
  const _legacySnapshotTimers = new Map();
  const _legacyLoadJobs = new Map(); // containerId -> { tabId, viewName, path, token, promise }
  let _virtualPanesBeforeRender = [];
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
    return ['database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'form', 'entity', 'page', 'media', 'html', 'folder', 'board'].includes(type);
  }

  function _legacySnapshotKey(tab) {
    if (!tab) return '';
    return _isPathScopedLegacyType(tab.type)
      ? (tab.type + '::' + (tab.path || ''))
      : (tab.type + '::tab:' + tab.id);
  }

  // スナップショット/状態保存は panelset の非アクティブグループと、
  // float/subpanel が paneMap に登録した仮想ペインも含める。
  function _allLayoutTabs() {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return [];
    const tabs = [];
    const seenTabIds = new Set();
    const appendPaneTabs = (pane) => {
      for (const tab of (pane?.tabs || [])) {
        if (!tab || seenTabIds.has(tab.id)) continue;
        seenTabIds.add(tab.id);
        tabs.push(tab);
      }
    };
    for (const pane of _collectAllLayoutPanes(GBLayout.root)) {
      appendPaneTabs(pane);
    }
    for (const paneInfo of Object.values(GBLayout.paneMap || {})) {
      appendPaneTabs(paneInfo?.node);
    }
    return tabs;
  }

  function _collectAllLayoutPanes(root) {
    const panes = [];
    function walk(node) {
      if (!node) return;
      if (node.type === 'pane') {
        panes.push(node);
        return;
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
      if (Array.isArray(node.groups)) node.groups.forEach(group => walk(group?.root));
    }
    walk(root);
    return panes;
  }

  function _patchDomLookupForSnapshots() {
    if (_domLookupPatched || typeof document === 'undefined' || !document.getElementById) return;
    const nativeGetElementById = Document.prototype.getElementById;
    const escapeId = (value) => MeldexEscape.cssIdent(value);
    Document.prototype.getElementById = function(id) {
      const first = nativeGetElementById.call(this, id);
      if (!first || !_isLegacySnapshotNode(first)) return first;
      const matches = this.querySelectorAll('[id="' + escapeId(id) + '"]');
      for (const el of matches) {
        if (!_isLegacySnapshotNode(el)) return el;
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
    _rememberAppToolbarTemplate();

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
      if (!el && id === 'gb-subpanel-root') {
        // サブパネルの外枠(見出し・戻る/進む・「メインパネルで開く」・本文)は
        // gb-subpanel.js が所有する。ここでは初回のみ持続DOMを生成してもらい、
        // 他のPANEL_CONTAINERSと同じ退避・移動の仕組みに乗せる。
        el = (typeof GBSubPanel !== 'undefined' && typeof GBSubPanel.createRootElement === 'function')
          ? GBSubPanel.createRootElement()
          : null;
        if (!el) {
          el = document.createElement('div');
          el.id = 'gb-subpanel-root';
          el.style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;';
        }
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
    const appTb = _ensureAppToolbarElement();
    if (appTb && appTb.parentNode && appTb.parentNode.id !== 'legacy-views') {
      appTb.classList.remove('visible');
      storage.appendChild(appTb);
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

  const _detailTabIds = ['note-editor', 'db-property-settings', 'sn2-main', 'calendar-today', 'calendar-settings', 'calendar-production', 'board-card', 'board-line', 'board-note', 'board-card-style', 'board-line-style', 'board-depth-style'];
  const _detailScrollSelectors = ['__root__', '#detail-tab-note-editor', '#detail-tab-db-property-settings', '#detail-tab-sn2-main', '#detail-tab-calendar-today', '#detail-tab-calendar-settings', '#detail-tab-calendar-production', '#detail-tab-board-card', '#detail-tab-board-line', '#detail-tab-board-note', '#detail-tab-board-card-style', '#detail-tab-board-line-style', '#detail-tab-board-depth-style'];
  const _viewScrollSelectors = {
    page: ['#page-content'],
    entity: ['#entity-view'],
    folder: ['#folder-grid'],
    media: ['#media-view'],
    pivot: ['#pivot-view'],
    tree: ['#tree-view'],
    gallery: ['#gallery-view'],
    kanban: ['#kanban-view'],
    timeline: ['#timeline-view'],
    gantt: ['#timeline-view'],
    chart: ['#chart-view'],
    graph: ['#graph-view'],
    form: ['#form-view'],
    detail: _detailScrollSelectors.slice(1),
    preview: ['#gb-preview-pane'],
    subpanel: ['#gb-subpanel-content'],
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
      const active = !t.hidden && t.dataset.detailTab === normalizedTab;
      t.classList.toggle('gb-inner-tab-active', active);
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
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
    // canvas の cloneNode はイベントリスナーを複製しない。プレビューへ
    // 復元したミニマップだけ、実要素へ操作ハンドラを再接続する。
    if (typeof _bdBindPreviewMinimapInteraction === 'function') {
      host.querySelectorAll?.('.bd-minimap').forEach((canvas) => {
        _bdBindPreviewMinimapInteraction(canvas);
      });
    }
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
    _cancelLegacySnapshotTimer(tab.id);
    _setLegacyUiState(tab, _captureLegacyDomState(viewName, viewEl));
    const clone = viewEl.cloneNode(true);
    _legacySnapshots.set(tab.id, clone);
    _syncMirroredSnapshots(tab, viewName, clone);
  }

  function _cancelLegacySnapshotTimer(tabId) {
    const timer = _legacySnapshotTimers.get(tabId);
    if (!timer) return;
    clearTimeout(timer);
    _legacySnapshotTimers.delete(tabId);
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
    _cancelLegacySnapshotTimer(binding.tabId);
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
    const paneInfo = typeof GBLayout !== 'undefined' ? GBLayout.paneMap?.[paneId] : null;
    const isVirtualSurface = paneInfo?.surface === 'subpanel';
    if (!isVirtualSurface && typeof GBLayout !== 'undefined' && typeof GBLayout.setActivePane === 'function') {
      GBLayout.setActivePane(paneId, { sync: true });
    }
    if (paneInfo?.node && paneInfo.contentEl) {
      _mountPaneContent(paneInfo.node, {
        surface: paneInfo.surface || '',
        claimLive: true,
      });
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

  function _normalizeLegacyLivePath(path) {
    return String(path || '').replace(/\\/g, '/');
  }

  // openPage() 等をタブ登録より先に直接呼ぶ経路では、実内容の
  // data-path とグローバル表示状態は更新済みでも、pane-bridge 専用の
  // gbLegacyView/gbLegacyPath はまだ無い。その状態を「未描画」とみなして
  // 再読込すると、ノート等の未保存内容が失われる。現在状態と
  // 実DOMの data-path の両方がタブと一致する場合だけ、現ライブ内容を採用する。
  function _hasMatchingUnmarkedLiveContent(viewEl, viewName, path) {
    if (!viewEl || !path || viewEl.dataset?.gbLegacyView || viewEl.dataset?.gbLegacyPath) return false;
    const expected = _normalizeLegacyLivePath(path);
    let currentPath = '';
    if (viewName === 'page' || viewName === 'media' || viewName === 'html') currentPath = state.currentPagePath;
    else if (viewName === 'entity') currentPath = state.currentEntityPath;
    else if (['database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'form'].includes(viewName)) currentPath = state.currentDbPath;
    else if (viewName === 'folder' && typeof _folderPath !== 'undefined') currentPath = _folderPath;
    else if (viewName === 'csv' && typeof _csvPath !== 'undefined') currentPath = _csvPath;
    if (_normalizeLegacyLivePath(currentPath) !== expected) return false;
    if (state.view !== viewName && !(viewName === 'database' && state.view === 'database')) return false;
    const candidates = [viewEl, ...viewEl.querySelectorAll('[data-path]')];
    return candidates.some(el => _normalizeLegacyLivePath(el?.dataset?.path) === expected);
  }

  function _ensureLegacyTabContent(tab, viewName, containerId, openOpts, pane) {
    const label = tab.label || '';
    const path = tab.path || '';
    const viewEl = document.getElementById(containerId);
    const bridgeOpts = openOpts || _bridgeOpenOpts;
    const paneContentEl = pane?.id ? (GBLayout?.paneMap?.[pane.id]?.contentEl || null) : null;
    const paneCtx = pane?.id && typeof getPaneContext === 'function' ? getPaneContext(pane.id) : null;
    const paneRenderCtx = paneCtx || (pane?.id ? { paneId: pane.id, containerEl: paneContentEl, tableId: 'pivot-table' } : null);
    if (paneRenderCtx) {
      paneRenderCtx.containerEl = paneContentEl || paneRenderCtx.containerEl;
      if (['database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'form'].includes(viewName)) {
        paneRenderCtx.dbPath = path || paneRenderCtx.dbPath;
      }
    }
    if (!path) {
      if (viewName === 'folder' && typeof renderFolderInitialPrompt === 'function') {
        renderFolderInitialPrompt();
      }
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
    const adoptsUnmarkedLiveContent = !liveView && !livePath
      && _hasMatchingUnmarkedLiveContent(viewEl, viewName, path);
    const needsLiveReload = !adoptsUnmarkedLiveContent && (liveView !== viewName || livePath !== path);
    const resolvedViewName = typeof _resolveDbPaneDisplayView === 'function'
      ? _resolveDbPaneDisplayView(viewName, tab)
      : viewName;
    const token = {};
    const isCurrentLoadJob = () => _legacyLoadJobs.get(containerId)?.token === token;
    const scopedBridgeOpts = { ...bridgeOpts, isLegacyLoadCurrent: isCurrentLoadJob };
    if (['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'form'].includes(viewName)) {
      scopedBridgeOpts.requestedViewMode = tab.state?.viewMode || viewName;
    }
    if (viewName === 'folder' && tab.state?.selectedPath) {
      scopedBridgeOpts.selectedPath = tab.state.selectedPath;
    }
    if (viewName === 'folder' && Array.isArray(tab.state?.selectedPaths)) {
      scopedBridgeOpts.selectedPaths = tab.state.selectedPaths;
    }
    const run = async () => {
      try {
        const prevView = state.view;
        const prevPagePath = state.currentPagePath;
        const prevEntityPath = state.currentEntityPath;
        const prevBoardPath = state.currentBoardPath;
        const prevCsvPath = (typeof _csvPath !== 'undefined') ? _csvPath : '';
        if (viewEl) {
          viewEl.dataset.gbLegacyView = viewName;
          viewEl.dataset.gbLegacyPath = path;
        }
        _beginBridgeUpdate();
        await _yieldStartupRestorePaint();
        if (!isCurrentLoadJob()) return;
        const needsDisplayReload = resolvedViewName !== viewName || prevView !== resolvedViewName;
        if (viewName === 'board' && typeof openBoard === 'function' && (needsLiveReload || prevBoardPath !== path || prevView !== 'board')) await openBoard(label, path, scopedBridgeOpts);
        // フォルダの _folderPath は、サブパネル専用描画（ボードのリンクカード計画 Phase B-2、
        // gb-folder.part01.part01.js の _folderRenderContainerOverride）が加わったことで、
        // メインの folder-view とサブパネルの2つの面が同時に更新し得る単一のグローバル変数に
        // なった。needsLiveReload（このコンテナ自身の直前の描画内容との突き合わせ、
        // スケジュール時点＝競合が起きる前に確定済みで安全）が既に「変化なし」と判定している
        // 場合、_folderPath !== path だけを理由に再読込を強制すると、他の面（サブパネル）が
        // ちょうど _folderPath を書き換えた直後の一瞬に割り込んでしまい、非同期のopenFolder()が
        // 「自分こそが正しい切替元」と誤認して相手の描画先（_folderRenderContainerOverride）へ
        // 誤った「切り替わりました」通知を書き込み、相手の実表示を消してしまう（2026-08-19
        // 実ブラウザE2Eで確認・固定: targeted-shell-micro-subpanel-folder-render）。
        // needsLiveReload || prevView !== 'folder' だけで、このコンテナ自身が本当に変化した
        // ケースは正しく再読込される。
        else if (viewName === 'folder' && typeof openFolder === 'function' && (needsLiveReload || prevView !== 'folder')) await openFolder(label, path, scopedBridgeOpts);
        else if (viewName === 'page' && typeof openPage === 'function' && (needsLiveReload || prevPagePath !== path || prevView !== 'page')) await openPage(label, path, scopedBridgeOpts);
        else if (viewName === 'entity' && typeof selectEntity === 'function' && (needsLiveReload || prevEntityPath !== path || prevView !== 'entity')) await selectEntity(path, scopedBridgeOpts);
        else if (viewName === 'media' && typeof openMedia === 'function' && (needsLiveReload || prevPagePath !== path || prevView !== 'media')) {
          // tab.state.viewerUrl（例: シート内ギャラリーが渡す特殊なビューワーURL。
          // gb-db-image-gallery.js 等）が保存されていれば再読み込み時も引き継ぐ
          // （navPushの保存箇所は _gbNavPushMediaTabState 参照）。
          const mediaReloadOpts = tab.state?.viewerUrl
            ? { ...scopedBridgeOpts, viewerUrl: tab.state.viewerUrl }
            : scopedBridgeOpts;
          openMedia(label, path, tab.state?.mediaType || 'image', mediaReloadOpts);
        }
        // CSVの _csvPath も、フォルダの _folderPath と同じ理由（サブパネル専用描画
        // _csvRenderContainerOverride、gb-csv-viewer.js）で単一のグローバル変数を2つの面が
        // 共有する。同じ競合を予防的に塞ぐ（needsLiveReload || prevView !== 'csv' で
        // このコンテナ自身が変化したケースは引き続き正しく再読込される）。
        else if (viewName === 'csv' && typeof openCsvFile === 'function' && (needsLiveReload || prevView !== 'csv')) await openCsvFile(label, path, scopedBridgeOpts);
        else if (viewName === 'timeline' && tab.state?.calendarFile && typeof openCalendarFile === 'function' && (needsLiveReload || state.currentDbPath !== path || prevView !== 'timeline')) openCalendarFile(label, path, scopedBridgeOpts);
        else if (['database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'gantt', 'chart', 'graph', 'form'].includes(viewName) && typeof selectDatabase === 'function' && (needsLiveReload || needsDisplayReload || state.currentDbPath !== path || prevView !== viewName)) await selectDatabase(path, paneRenderCtx || null, scopedBridgeOpts);
        else if (viewName === 'html' && (needsLiveReload || prevPagePath !== path || prevView !== 'html')) {
          if (tab.state?.urlExternal && typeof openViewer === 'function') openViewer(path, scopedBridgeOpts);
          else if (typeof openHtmlFile === 'function') openHtmlFile(label, path, scopedBridgeOpts);
        }
        else if (viewName === 'compare' && typeof openCompareView === 'function' && (needsLiveReload || prevView !== 'compare')) {
          const encodedPaths = path.startsWith('compare:') ? path.slice('compare:'.length).split('|') : [];
          const pathA = tab.state?.pathA || encodedPaths[0] || '';
          const pathB = tab.state?.pathB || encodedPaths[1] || '';
          if (pathA && pathB) await openCompareView(pathA, pathB, { ...scopedBridgeOpts, skipShowView: true });
        }
        else {
          state.view = viewName;
          if (viewName === 'page' || viewName === 'html' || viewName === 'media') state.currentPagePath = path;
          else if (viewName === 'entity') state.currentEntityPath = path;
          else if (viewName === 'board') state.currentBoardPath = path;
        }
        if (!isCurrentLoadJob()) return;
        // selectDatabase() 等の非同期描画はサブビューの display を再設定する。
        // 共有 db-view-container を別ペインへ移した直後は、mount開始時に選んだ
        // calendar/timeline 面がロード完了時に再び隠れることがあるため、現在の
        // load job とペインに対して最後に表示面を確定する。
        if (containerId === 'db-view-container' && pane?.id && typeof _ensureDbSubviewVisibleForPane === 'function') {
          const finalViewName = typeof _resolveDbPaneDisplayView === 'function'
            ? _resolveDbPaneDisplayView(viewName, tab)
            : resolvedViewName;
          _ensureDbSubviewVisibleForPane(pane.id, paneContentEl, finalViewName, tab);
        }
        const boundViewEl = document.getElementById(containerId);
        if (boundViewEl && _legacyLoadJobs.get(containerId)?.token === token) {
          boundViewEl.dataset.gbLegacyView = viewName;
          boundViewEl.dataset.gbLegacyPath = path;
        }
        // レガシー種別（page/entity/board/folder/csv/database等）のタブは
        // ここまで非同期（Promise.resolve().then）。この時点まで state.currentPagePath 等が
        // 未更新のため、refreshPaneAfterTabSwitch 内の同期呼び出しは間に合わない
        // （state更新前に走ってしまう）。実際に state が確定したこの完了時点で追従を同期する。
        if (typeof _syncFollowingVersionTabs === 'function') _syncFollowingVersionTabs();
      } finally {
        _endBridgeUpdate();
      }
    };
    const promise = Promise.resolve().then(run).finally(() => {
      if (_legacyLoadJobs.get(containerId)?.token === token) {
        _legacyLoadJobs.delete(containerId);
        _scheduleLegacyStateRestore(tab, viewName, containerId);
      }
    });
    _legacyLoadJobs.set(containerId, { tabId: tab.id, viewName, path, token, promise });
  }

  // 通知を出した側（openFolder()/openCsvFile()等、共有シングルトンの描画先を持つ種類）が、
  // 直前の描画先へ「切り替わりました」通知を書き込んだ直後に呼ぶ公開の入口。containerId の
  // dataset（gbLegacyView/gbLegacyPath、上の run() が「この面へ最後に描いた内容」として
  // 記録している）を無効化するだけで、そのタブへ戻った時点で needsLiveReload が真になり
  // _ensureLegacyTabContent() が自動的に再読込する（2026-08-19 AGENT_INBOX「メイン画面が
  // 『切り替わりました』通知のまま自動復帰しない」）。判定はここでは増やさず、既存の
  // needsLiveReload 比較（このファイル上部の run() 内）へ委ねる。
  // path指定時は、現在の記録がその path を指している場合のみ無効化する（無関係な
  // 巻き込み再読込を避ける）。
  function _invalidateLegacyRenderState(viewName, path) {
    const containerId = LEGACY_CONTAINERS[viewName];
    if (!containerId) return false;
    const viewEl = document.getElementById(containerId);
    if (!viewEl) return false;
    if (path && viewEl.dataset.gbLegacyPath !== path) return false;
    delete viewEl.dataset.gbLegacyView;
    delete viewEl.dataset.gbLegacyPath;
    return true;
  }

  // ================================================================
  // レンダリングフック
  // ================================================================

  // render前: 管理下の要素をストレージに退避（innerHTML=''で消失させない）
  function _beforeRender() {
    const storage = document.getElementById('legacy-views');
    if (!storage) return;
    // GBLayout.render() は paneMap を作り直すが、サブパネルはレイアウトツリー外の
    // 仮想ペインとして同じmapへ登録される。再描画をまたいで登録と表示先を保持しないと、
    // モバイルの自動レイアウト整形時に表示中コンポーネントが孤児判定され破棄される。
    _virtualPanesBeforeRender = Object.values(GBLayout?.paneMap || {}).filter(info => (
      info?.surface === 'subpanel' && info.node?.id && info.contentEl
    ));
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
    const appTb = _ensureAppToolbarElement();
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
    const _allLayoutPanes = typeof GBLayout !== 'undefined' && GBLayout.root ? _collectAllLayoutPanes(GBLayout.root) : [];
    _virtualPanesBeforeRender.forEach(info => _allLayoutPanes.push(info.node));
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
    for (const info of _virtualPanesBeforeRender) {
      if (info?.contentEl?.isConnected && info.node?.id) GBLayout.paneMap[info.node.id] = info;
    }
    _virtualPanesBeforeRender = [];
    _mountAllPanes();
    _pruneOrphanPaneState();
    // アクティブペインのタブタイプを state.view に同期
    _syncStateView();
    // 取り消し・やり直しの対象スコープをアクティブタブへ追随させる（パネル取り違え対策）
    if (typeof _meldexSyncActiveTabHistoryScope === 'function') _meldexSyncActiveTabHistoryScope();
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
