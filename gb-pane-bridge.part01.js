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

  function _isDesktopStartupRestoreActive() {
    if (!window._meldexStartupRestoring) return false;
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.get('desktop') === '1' || document.documentElement?.dataset?.desktopLaunch === '1';
    } catch {
      return false;
    }
  }

  function _renderDeferredStartupFolder(tab, containerId) {
    const path = tab?.path || '';
    const label = tab?.label || (path ? path.split(/[\\/]/).filter(Boolean).pop() : 'フォルダ');
    const title = document.getElementById('folder-title');
    if (title) title.textContent = label;
    const count = document.getElementById('folder-item-count');
    if (count) count.textContent = '未読込';
    const grid = document.getElementById('folder-grid');
    if (!grid) return;
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:160px;color:var(--fg2);font-size:13px;';
    const message = document.createElement('div');
    message.textContent = '起動時の負荷を抑えるため、フォルダの内容はまだ読み込んでいません。';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-btn';
    button.textContent = '読み込む';
    button.addEventListener('click', () => {
      if (typeof openFolder === 'function') {
        openFolder(label, path, { fromExplorer: true, skipAutoAppLayout: true });
      }
    });
    box.appendChild(message);
    box.appendChild(button);
    grid.replaceChildren(box);
    const viewEl = document.getElementById(containerId);
    if (viewEl) {
      viewEl.dataset.gbLegacyView = 'folder';
      viewEl.dataset.gbLegacyPath = '';
    }
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
    if (viewName === 'folder' && _isDesktopStartupRestoreActive()) {
      _renderDeferredStartupFolder(tab, containerId);
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
        if (viewName === 'board' && typeof openBoard === 'function' && (needsLiveReload || prevBoardPath !== path || prevView !== 'board')) await openBoard(label, path, bridgeOpts);
        else if (viewName === 'folder' && typeof openFolder === 'function' && (needsLiveReload || _folderPath !== path || prevView !== 'folder')) await openFolder(label, path, bridgeOpts);
        else if (viewName === 'page' && typeof openPage === 'function' && (needsLiveReload || prevPagePath !== path || prevView !== 'page')) await openPage(label, path, bridgeOpts);
        else if (viewName === 'entity' && typeof selectEntity === 'function' && (needsLiveReload || prevEntityPath !== path || prevView !== 'entity')) await selectEntity(path, bridgeOpts);
        else if (viewName === 'media' && typeof openMedia === 'function' && (needsLiveReload || prevPagePath !== path || prevView !== 'media')) openMedia(label, path, tab.state?.mediaType || 'image', bridgeOpts);
        else if (viewName === 'csv' && typeof openCsvFile === 'function' && (needsLiveReload || prevCsvPath !== path || prevView !== 'csv')) await openCsvFile(label, path, bridgeOpts);
        else if (viewName === 'smart-db' && typeof openSmartDbFile === 'function' && (needsLiveReload || prevSmartDbPath !== path || prevView !== 'smart-db')) await openSmartDbFile(label, path, bridgeOpts);
        else if (viewName === 'timeline' && tab.state?.calendarFile && typeof openCalendarFile === 'function' && (needsLiveReload || state.currentDbPath !== path || prevView !== 'timeline')) openCalendarFile(label, path, bridgeOpts);
        else if (['pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph'].includes(viewName) && typeof selectDatabase === 'function' && (needsLiveReload || state.currentDbPath !== path || prevView !== viewName)) await selectDatabase(path, null, bridgeOpts);
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

  // アクティブペインのアクティブタブのtypeをstate.viewに同期する
  function _syncStateView() {
    let newView = null;
    let activePaneOwnsView = false;
    const isPaneManagedType = (type) => !!(type && (LEGACY_CONTAINERS[type] || COMPONENT_TYPES.has(type)));
    // まずアクティブペインのタブをチェック
    const paneId = GBLayout.activePane;
    if (paneId) {
      const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
      if (paneInfo) {
        const activeTab = paneInfo.node.tabs?.[paneInfo.node.activeTabIndex];
        if (isPaneManagedType(activeTab?.type)) {
          newView = activeTab.type;
          activePaneOwnsView = true;
        }
      }
    }
    // ツールペイン等の場合: 全ペインからメインコンテンツを探す
    if (!newView) {
      for (const p of GBLayout.getAllPanes(GBLayout.root)) {
        const tab = p.tabs?.[p.activeTabIndex];
        if (isPaneManagedType(tab?.type)) { newView = tab.type; break; }
      }
    }
    if (newView && (newView !== state.view || activePaneOwnsView)) {
      state.view = newView;
      _updateToolbars(newView);
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
