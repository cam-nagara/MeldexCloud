/* gb-layout.part03.js */
  // === ペイン分割 ===
  function splitPane(paneId, direction, position, newPaneNode, options) {
    const opts = options || {};
    const target = findNode(_root, paneId);
    if (!target) return null;
    if (target.node?.locked) {
      if (typeof showStatus === 'function') showStatus('ロック中のパネルは分割できません', true);
      return null;
    }

    const depth = getNodeDepth(_root, paneId);
    if (depth >= MAX_DEPTH) return null;

    newPaneNode = newPaneNode || createPaneNode();
    const before = !opts.skipHistory ? (opts.historyBefore || captureLayoutSnapshot()) : null;

    const isFirst = (position === 'left' || position === 'top');
    const splitDir = (position === 'left' || position === 'right') ? 'horizontal' : 'vertical';

    const newSplit = createSplitNode(splitDir, isFirst ? 0.3 : 0.7,
      isFirst ? [newPaneNode, target.node] : [target.node, newPaneNode]
    );

    if (!_replaceNodeById(paneId, newSplit)) return null;

    render();
    saveLayout();
    if (before) {
      pushLayoutHistory(
        opts.historyLabel || 'レイアウト: パネル分割',
        before,
        captureLayoutSnapshot(),
        opts.historyDetail || position || newPaneNode.id || ''
      );
    }
    return newPaneNode.id;
  }

  // === ペイン除去（空になったペインを閉じる） ===
  function removePane(paneId, options) {
    const opts = options || {};
    // ルートペイン自身は除去不可
    if (_root && _root.id === paneId) return;
    const parentInfo = findParent(_root, paneId);
    if (!parentInfo) return;
    const before = !opts.skipHistory ? (opts.historyBefore || captureLayoutSnapshot()) : null;

    // split/panelset どちらの親でも _detachNodeById が一括処理
    // （単一化した split を兄弟で置換、panelset なら groups から除去し
    //  1 件なら自動解体、0 件なら親から除去を再帰）
    _detachNodeById(paneId);

    if (_activePane === paneId) {
      const firstPane = findFirstPane(_root);
      if (firstPane) setActivePane(firstPane.id);
    }

    delete _paneMap[paneId];
    render();
    saveLayout();
    if (before) {
      pushLayoutHistory(
        opts.historyLabel || 'レイアウト: パネルを閉じる',
        before,
        captureLayoutSnapshot(),
        opts.historyDetail || paneId || ''
      );
    }
  }

  // ルートレベルで横断パネルを追加（ウィンドウ端へのドロップ用）
  const MAX_ROOT_DEPTH = 6; // ルートラップ専用の制限（通常のsplitPaneより緩い）
  function splitRoot(position, newPaneNode, options) {
    const opts = options || {};
    if (hasLockedPane()) {
      if (typeof showStatus === 'function') showStatus('ロック中のパネルがあるため外側へ新しいパネルを追加できません', true);
      return null;
    }
    const maxDepth = _getMaxDepth(_root, 0);
    if (maxDepth + 1 >= MAX_ROOT_DEPTH) return null;
    newPaneNode = newPaneNode || createPaneNode();
    const before = !opts.skipHistory ? (opts.historyBefore || captureLayoutSnapshot()) : null;
    const isFirst = (position === 'left' || position === 'top');
    const splitDir = (position === 'left' || position === 'right') ? 'horizontal' : 'vertical';
    const newSplit = createSplitNode(splitDir, isFirst ? 0.2 : 0.8,
      isFirst ? [newPaneNode, _root] : [_root, newPaneNode]
    );
    _root = newSplit;
    render();
    saveLayout();
    if (before) {
      pushLayoutHistory(
        opts.historyLabel || 'レイアウト: 外側パネル追加',
        before,
        captureLayoutSnapshot(),
        opts.historyDetail || position || newPaneNode.id || ''
      );
    }
    return newPaneNode.id;
  }

  function _getMaxDepth(node, depth) {
    if (!node) return depth;
    if (node.type === 'pane') return depth;
    if (node.type === 'split') return Math.max(_getMaxDepth(node.children[0], depth + 1), _getMaxDepth(node.children[1], depth + 1));
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      // パネルセットは自身で1階層消費せず、アクティブグループの深度のみ評価
      // （MAX_DEPTH 制約はアクティブ表示中のネスト深度に対して適用）
      const active = node.groups.find(g => g && g.id === node.activeGroupId);
      return active?.root ? _getMaxDepth(active.root, depth) : depth;
    }
    return depth;
  }

  // splitノードの子からpaneIdを持つ子のインデックスを返す（ID比較）
  function _getChildIndex(splitNode, paneId) {
    for (let i = 0; i < splitNode.children.length; i++) {
      const child = splitNode.children[i];
      if (!child) continue;
      if (child.type === 'pane' && child.id === paneId) return i;
      // childがsplit/panelsetノードで、その中にpaneIdがある場合もこの子
      if ((child.type === 'split' || child.type === 'panelset') && findNode(child, paneId)) return i;
    }
    return -1;
  }

  // === ツリー探索ヘルパー ===
  function findNode(root, nodeId) {
    if (!root) return null;
    if (root.id === nodeId) return { node: root };
    if (root.type === 'split' && Array.isArray(root.children)) {
      for (const child of root.children) {
        const found = findNode(child, nodeId);
        if (found) return found;
      }
    } else if (root.type === 'panelset' && Array.isArray(root.groups)) {
      // 非アクティブグループ内のノードも検索対象にする（ID探索はグループをまたぐ）
      for (const group of root.groups) {
        const found = group?.root ? findNode(group.root, nodeId) : null;
        if (found) return found;
      }
    }
    return null;
  }

  // nodeIdの直接の親split/panelsetノードを返す（pane/split両対応）
  function findParent(root, nodeId) {
    if (!root) return null;
    if (root.type === 'split' && Array.isArray(root.children)) {
      for (const child of root.children) {
        if (!child) continue;
        if (child.id === nodeId) return { node: root };
        if (child.type === 'split' || child.type === 'panelset') {
          const found = findParent(child, nodeId);
          if (found) return found;
        }
      }
      return null;
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      for (const group of root.groups) {
        const grRoot = group?.root;
        if (!grRoot) continue;
        if (grRoot.id === nodeId) return { node: root };
        if (grRoot.type === 'split' || grRoot.type === 'panelset') {
          const found = findParent(grRoot, nodeId);
          if (found) return found;
        }
      }
    }
    return null;
  }

  function _collectNodePath(root, targetId, path) {
    if (!root) return null;
    const nextPath = path ? [...path, root] : [root];
    if (root.id === targetId) return nextPath;
    if (root.type === 'split' && Array.isArray(root.children)) {
      for (const child of root.children) {
        const found = _collectNodePath(child, targetId, nextPath);
        if (found) return found;
      }
      return null;
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      // 可視性判定に使われるため、非アクティブグループ内は到達不可とみなす
      const active = root.groups.find(g => g && g.id === root.activeGroupId);
      if (active?.root) {
        const found = _collectNodePath(active.root, targetId, nextPath);
        if (found) return found;
      }
    }
    return null;
  }

  function isPaneVisible(paneId) {
    if (!paneId) return false;
    const path = _collectNodePath(_root, paneId);
    if (!path || !path.length) return false;
    return path.every((node) => !node?.collapsed);
  }

  function revealPane(paneId, options) {
    if (!paneId) return false;
    const path = _collectNodePath(_root, paneId);
    if (!path || !path.length) return false;
    let activated = false;
    if (options?.activate && findNode(_root, paneId)?.node?.type === 'pane' && _activePane !== paneId) {
      _activePane = paneId;
      activated = true;
    }
    let changed = false;
    path.forEach((node) => {
      if (!node?.collapsed) return;
      node.collapsed = false;
      _adjustSplitForCollapse(node, { skipRender: true });
      changed = true;
    });
    if (!changed) return activated;
    if (!options?.deferRender) {
      render();
      saveLayout();
    }
    return true;
  }

  // splitノードの親を検索（参照比較だがrender前の同一オブジェクト内で使用）
  function findParentOfSplit(root, targetSplit) {
    if (!root) return null;
    if (root.type === 'split' && Array.isArray(root.children)) {
      for (const child of root.children) {
        if (child === targetSplit) return { node: root };
        if (child && (child.type === 'split' || child.type === 'panelset')) {
          const found = findParentOfSplit(child, targetSplit);
          if (found) return found;
        }
      }
      return null;
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      for (const group of root.groups) {
        const grRoot = group?.root;
        if (!grRoot) continue;
        if (grRoot === targetSplit) return { node: root };
        if (grRoot.type === 'split' || grRoot.type === 'panelset') {
          const found = findParentOfSplit(grRoot, targetSplit);
          if (found) return found;
        }
      }
    }
    return null;
  }

  function findFirstPane(root) {
    if (!root) return null;
    if (root.type === 'pane') return root;
    if (root.type === 'split') {
      return findFirstPane(root.children[0]) || findFirstPane(root.children[1]);
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      // アクティブグループから優先的に探索（初期フォーカス対象を可視ペインに限定）
      const active = root.groups.find(g => g && g.id === root.activeGroupId);
      if (active?.root) {
        const p = findFirstPane(active.root);
        if (p) return p;
      }
      for (const group of root.groups) {
        if (!group || group.id === root.activeGroupId || !group.root) continue;
        const p = findFirstPane(group.root);
        if (p) return p;
      }
    }
    return null;
  }

  function getNodeDepth(root, paneId, depth) {
    depth = depth || 0;
    if (!root) return -1;
    if (root.type === 'pane' && root.id === paneId) return depth;
    if (root.type === 'split') {
      const d1 = getNodeDepth(root.children[0], paneId, depth + 1);
      if (d1 >= 0) return d1;
      return getNodeDepth(root.children[1], paneId, depth + 1);
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      // panelset は自身で1階層消費しない（MAX_DEPTH とレイアウト深度の整合）
      for (const group of root.groups) {
        if (!group?.root) continue;
        const d = getNodeDepth(group.root, paneId, depth);
        if (d >= 0) return d;
      }
    }
    return -1;
  }

  // getAllPanes(root) / getAllPanes(root, result) / getAllPanes(root, opts) / getAllPanes(root, result, opts)
  //   opts.activeOnly: true なら panelset の非アクティブグループを除外（表示中のペインのみ収集）
  function getAllPanes(root, resultOrOpts, maybeOpts) {
    let result, opts;
    if (Array.isArray(resultOrOpts)) { result = resultOrOpts; opts = maybeOpts || {}; }
    else { result = []; opts = resultOrOpts || {}; }
    if (!root) return result;
    if (root.type === 'pane') { result.push(root); return result; }
    if (root.type === 'split') {
      getAllPanes(root.children[0], result, opts);
      getAllPanes(root.children[1], result, opts);
      return result;
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      const targets = opts.activeOnly
        ? root.groups.filter(g => g && g.id === root.activeGroupId)
        : root.groups;
      targets.forEach(g => { if (g?.root) getAllPanes(g.root, result, opts); });
    }
    return result;
  }

  // === レンダリングフック ===
  let _preRender = null;
  let _postRender = null;

  // モバイルモード判定
  function _isMobileLayout() { return window.innerWidth <= 768; }
  let _wasMobileLayout = false;

  // 古いペインに紐付いた ResizeObserver を解放する。
  // render() 再呼び出しで _paneMap が差し替わる前に呼ぶこと。
  function _disconnectPaneObservers() {
    for (const id in _paneMap) {
      const info = _paneMap[id];
      if (info?.observer && typeof info.observer.disconnect === 'function') {
        info.observer.disconnect();
      }
    }
  }

  // モバイルモード: アクティブペインのみ描画
  function _renderMobile() {
    if (!_layoutEl) return;
    _disconnectPaneObservers();
    _paneMap = {};
    _layoutEl.innerHTML = '';
    // アクティブペインを検索
    let targetPane = _activePane ? findNode(_root, _activePane)?.node : null;
    if (!targetPane) targetPane = findFirstPane(_root);
    if (targetPane) {
      _layoutEl.appendChild(renderPane(targetPane, 0));
      if (!_activePane) _activePane = targetPane.id;
    }
  }

  // === レンダリング ===
  // _preRender (pane-bridge._beforeRender) がレガシーコンテナを display:none の
  // ストレージに退避するため、その中のスクロールコンテナの scrollTop がリセットされる。
  // render() 全体をスクロール保護で囲み、_postRender 完了後に復元する。
  function _saveAllScrollPositions() {
    if (typeof _captureViewportSnapshot === 'function') return _captureViewportSnapshot();
    const snap = new Map();
    document.querySelectorAll('#legacy-views [style*="overflow"], #gb-layout-root [style*="overflow"]').forEach(el => {
      if (el.scrollTop > 0) snap.set(el, el.scrollTop);
    });
    return snap;
  }
  function _restoreAllScrollPositions(snap) {
    if (snap && snap.scroll instanceof Map && typeof _restoreViewportSnapshot === 'function') {
      _restoreViewportSnapshot(snap);
      return;
    }
    snap.forEach((v, el) => { el.scrollTop = v; });
  }
  // ルート描画: ルートが水平スプリットの場合は子ごとに renderAsColumn される。
  // それ以外（垂直スプリット / 単独ペイン / panelset）の場合はルート全体を 1 列としてラップ。
  function _renderRoot() {
    if (!_root) return document.createElement('div');
    if (_root.type === 'split' && _root.direction === 'horizontal') {
      return renderNode(_root, 0);
    }
    return renderAsColumn(_root, 0);
  }

  function render() {
    if (!_layoutEl) return;
    // Phase 5 安全策: ポップアップ表示中に再レンダリングすると、ポップアップ内に
    // 移動した pane DOM が innerHTML = '' で消える一方、_state.originalParent が
    // 新しい DOM に差し替わってしまい孤立する。事前にポップアップを閉じて pane DOM
    // を元位置に戻してから再描画する。
    if (typeof GBDockPopup !== 'undefined' && typeof GBDockPopup.isOpen === 'function'
        && GBDockPopup.isOpen() && typeof GBDockPopup.close === 'function') {
      GBDockPopup.close();
    }
    const scrollSnap = _saveAllScrollPositions();
    if (_preRender) _preRender();
    _disconnectPaneObservers();
    _paneMap = {};
    _layoutEl.innerHTML = '';

    if (_isMobileLayout()) {
      // モバイル: アクティブペインのみ
      _renderMobile();
    } else if (_maximizedPaneId) {
      // 最大化モード: 対象ペインの実ノードをツリーから探して描画
      const info = findNode(_root, _maximizedPaneId);
      if (info) {
        _layoutEl.appendChild(renderPane(info.node, 0));
      } else {
        _maximizedPaneId = null;
        _savedRootForMaximize = null;
        _setMaximizeChrome(false);
        _layoutEl.appendChild(_renderRoot());
      }
    } else {
      _layoutEl.appendChild(_renderRoot());
    }

    if (!_activePane || !_paneMap[_activePane]) {
      const firstPane = _maximizedPaneId ? findNode(_root, _maximizedPaneId)?.node : findFirstPane(_root);
      if (firstPane) setActivePane(firstPane.id);
    }

    if (typeof GBDocking !== 'undefined' && !_isMobileLayout()) {
      GBDocking.setupDropTargets();
    }
    if (_postRender) _postRender();
    _restoreAllScrollPositions(scrollSnap);
    queueMicrotask(() => _restoreAllScrollPositions(scrollSnap));
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => _restoreAllScrollPositions(scrollSnap));
    setTimeout(() => _restoreAllScrollPositions(scrollSnap), 80);
  }

  // === 初期化 ===
  const STARTUP_ACTIVE_PANE_AVOID_TYPES = new Set([
    'outliner',
    'detail',
    'preview',
    'chat',
    'calendar',
    'timer',
    'history',
    'annotation',
    'sticky',
    'search',
    'version',
  ]);

  function _activeTabTypeForStartupPane(pane) {
    if (!pane || pane.type !== 'pane') return '';
    const tabs = Array.isArray(pane.tabs) ? pane.tabs : [];
    const index = Number.isInteger(pane.activeTabIndex) ? pane.activeTabIndex : -1;
    return String(tabs[index]?.type || tabs[0]?.type || '');
  }

  function _isStartupUtilityPane(pane) {
    return STARTUP_ACTIVE_PANE_AVOID_TYPES.has(_activeTabTypeForStartupPane(pane));
  }

  function _isStartupVisiblePane(pane) {
    return !!(pane?.id && isPaneVisible(pane.id));
  }

  function _findStartupContentPane(root) {
    const activePanes = getAllPanes(root, { activeOnly: true });
    const allPanes = getAllPanes(root);
    return activePanes.find(pane => _isStartupVisiblePane(pane) && !_isStartupUtilityPane(pane))
      || allPanes.find(pane => _isStartupVisiblePane(pane) && !_isStartupUtilityPane(pane))
      || activePanes.find(pane => !_isStartupUtilityPane(pane))
      || allPanes.find(pane => !_isStartupUtilityPane(pane))
      || null;
  }

  function _resolveStartupActivePaneId(storedActivePaneId) {
    const stored = storedActivePaneId ? findNode(_root, storedActivePaneId)?.node : null;
    if (stored && _isStartupVisiblePane(stored) && !_isStartupUtilityPane(stored)) return stored.id;
    const contentPane = _findStartupContentPane(_root);
    if (contentPane) return contentPane.id;
    if (stored && _isStartupVisiblePane(stored)) return stored.id;
    const visiblePane = getAllPanes(_root, { activeOnly: true }).find(_isStartupVisiblePane)
      || getAllPanes(_root).find(_isStartupVisiblePane);
    if (visiblePane) return visiblePane.id;
    return stored?.id || null;
  }

  function init(containerEl) {
    _layoutEl = containerEl || document.getElementById('gb-layout-root');
    if (!_layoutEl) return;

    // 保存されたレイアウトを復元、なければデフォルト
    const loadedRoot = loadLayout();
    _loadedLayoutFromStorage = !!loadedRoot;
    _root = loadedRoot || defaultLayout();
    const storedActivePaneId = _loadedLayoutFromStorage ? _readStoredActivePaneId() : '';
    const startupActivePaneId = _loadedLayoutFromStorage ? _resolveStartupActivePaneId(storedActivePaneId) : null;
    _activePane = startupActivePaneId;
    if (_loadedLayoutFromStorage && _activePane !== storedActivePaneId) {
      _writeActivePaneToStorage();
    }

    // paneIdCounter と tabIdCounter を復元（ID衝突防止）
    // splitノードのIDも走査する
    let maxTabId = 0;
    function _scanIds(node) {
      if (!node) return;
      if (node.id) {
        const num = parseInt(node.id.replace(/^(pane|split)-/, ''));
        if (!isNaN(num) && num > _paneIdCounter) _paneIdCounter = num;
      }
      if (node.type === 'pane' && node.tabs) {
        node.tabs.forEach(t => {
          const tnum = parseInt((t.id || '').replace('tab-', ''));
          if (!isNaN(tnum) && tnum > maxTabId) maxTabId = tnum;
        });
      }
      if (node.type === 'split' && node.children) {
        node.children.forEach(c => _scanIds(c));
      }
      if (node.type === 'panelset' && Array.isArray(node.groups)) {
        node.groups.forEach(g => { if (g?.root) _scanIds(g.root); });
      }
    }
    _scanIds(_root);
    // GBTabsのカウンター復元
    if (typeof GBTabs !== 'undefined' && maxTabId > 0) {
      GBTabs._restoreCounter(maxTabId);
    }

    render();

    // リサイズでモバイル↔デスクトップ切替時に再描画
    _wasMobileLayout = _isMobileLayout();
    let resizeRenderTimer = 0;
    const scheduleResizeRender = () => {
      clearTimeout(resizeRenderTimer);
      resizeRenderTimer = setTimeout(() => {
        resizeRenderTimer = 0;
        render();
      }, 80);
    };
    window.addEventListener('resize', () => {
      const now = _isMobileLayout();
      if (now !== _wasMobileLayout) {
        _wasMobileLayout = now;
        render();
        return;
      }
      scheduleResizeRender();
    });
    window.visualViewport?.addEventListener('resize', scheduleResizeRender, { passive: true });
  }

  // === パネル操作メニュー（…ボタン経由: ロック/折りたたみ/最大化/閉じる） ===
  function _showPaneActionsMenu(e, node) {
    if (typeof closeMeldexDropdowns === 'function') {
      closeMeldexDropdowns({ exceptTarget: e.currentTarget });
    }
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    menu.style.cssText = 'position:fixed;z-index:10000;';
    const isMaxed = _maximizedPaneId === node.id;
    const hasParent = !!findParent(_root, node.id);

    function addItem(label, fn, icon) {
      const mi = document.createElement('div');
      if (icon && typeof lucide === 'function') {
        mi.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' + label;
      } else {
        mi.textContent = label;
      }
      mi.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
      mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; };
      mi.onmouseleave = () => { mi.style.background = ''; };
      mi.addEventListener('click', () => {
        document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
        fn();
      });
      menu.appendChild(mi);
    }

    // ロック: サブメニューで現在の状態が一目で分かるよう「ロック」「ロック解除」両方を表示。
    // 選択中の状態には Lucide の check を表示し、クリックで対応する状態へ遷移。
    (function _addLockSubmenu() {
      const wrap = document.createElement('div');
      wrap.style.position = 'relative';
      const trigger = document.createElement('div');
      trigger.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
      trigger.innerHTML =
        '<span style="margin-right:6px;opacity:0.7;">'
        + (typeof lucide === 'function' ? lucide(node.locked ? 'lock' : 'unlock', 14) : '')
        + '</span>ロック'
        + (typeof submenuArrow === 'function' ? submenuArrow() : ' ▸');
      trigger.onmouseenter = () => { trigger.style.background = 'var(--bg4)'; };
      trigger.onmouseleave = () => { trigger.style.background = ''; };
      const panel = document.createElement('div');
      panel.className = 'gb-context-menu';
      panel.style.cssText = 'display:none;';
      function addLockSub(label, iconName, isActive, desired) {
        const si = document.createElement('div');
        si.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
        const iconHtml = (typeof lucide === 'function') ? lucide(iconName, 14) : '';
        const check = isActive
          ? '<span class="gb-menu-check-icon" style="display:inline-flex;width:1em;margin-right:4px;color:var(--accent);vertical-align:middle;">' + (typeof lucide === 'function' ? lucide('check', 14) : '') + '</span>'
          : '<span class="gb-menu-check-icon" style="display:inline-block;width:1em;margin-right:4px;"></span>';
        si.innerHTML = check
          + '<span style="margin-right:6px;opacity:0.7;">' + iconHtml + '</span>'
          + label;
        si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
        si.onmouseleave = () => { si.style.background = ''; };
        si.addEventListener('click', () => {
          document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
          if (!isActive) setPaneLocked(node.id, desired);
        });
        panel.appendChild(si);
      }
      addLockSub('ロック', 'lock', !!node.locked, true);
      addLockSub('ロック解除', 'unlock', !node.locked, false);
      if (typeof attachHoverSubmenu === 'function') attachHoverSubmenu(trigger, panel);
      wrap.appendChild(trigger);
      wrap.appendChild(panel);
      menu.appendChild(wrap);
    })();
    if (hasParent) {
      addItem(node.collapsed ? '折りたたみを解除' : '最小化（折りたたみ）', () => {
        if (isMaxed) { restoreMaximizedPane(); return; }
        const before = captureLayoutSnapshot();
        node.collapsed = !node.collapsed;
        _adjustSplitForCollapse(node);
        saveLayout();
        render();
        pushLayoutHistory(
          node.collapsed ? 'レイアウト: 折りたたみ' : 'レイアウト: 折りたたみ解除',
          before,
          captureLayoutSnapshot(),
          node.id || ''
        );
      }, node.collapsed ? 'maximize2' : 'minus');
    }
    addItem(isMaxed ? '元のサイズに戻す' : '最大化', () => {
      if (isMaxed) restoreMaximizedPane();
      else maximizePane(node.id);
    }, isMaxed ? 'copy' : 'square');
    if (hasParent) {
      addItem('パネルを閉じる', () => {
        if (isMaxed) restoreMaximizedPane();
        removePane(node.id);
      }, 'x');
    }

    document.body.appendChild(menu);
    const anchor = e.currentTarget?.getBoundingClientRect
      ? e.currentTarget.getBoundingClientRect()
      : { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 };
    if (typeof positionPopup === 'function') {
      positionPopup(menu, anchor);
    } else {
      const z = (typeof _getZoom === 'function') ? _getZoom() : 1;
      menu.style.left = (e.clientX / z) + 'px';
      menu.style.top = (e.clientY / z) + 'px';
    }

    setTimeout(() => {
      const close = (ev) => {
        // 自分のメニューが既に DOM から外されている場合は、このリスナー自身を破棄して終了
        // （mi.click で removeAll した後に古いクロージャが残ると、次回開いた別メニューを
        //   「外側クリック」と誤判定して破壊してしまうため）
        if (!menu.isConnected) {
          document.removeEventListener('pointerdown', close);
          return;
        }
        // 現在開いているどのコンテキストメニュー内にも該当しない場合のみ閉じる
        const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
        if (!inAny) {
          document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
          document.removeEventListener('pointerdown', close);
        }
      };
      document.addEventListener('pointerdown', close);
    }, 0);
  }

  // === ペインタブ右クリックメニュー ===
  function _showTabContextMenu(e, paneId, tab) {
    // 既存メニューを除去
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    { const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
    function addItem(label, fn, icon) {
      const mi = document.createElement('div');
      if (icon && typeof lucide === 'function') {
        mi.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' + label;
      } else {
        mi.textContent = label;
      }
      mi.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
      mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; };
      mi.onmouseleave = () => { mi.style.background = ''; };
      mi.addEventListener('click', () => { document.querySelectorAll('.gb-context-menu').forEach(m => m.remove()); fn(); });
      menu.appendChild(mi);
    }
    // 新しいウィンドウで開く
    addItem('新しいウィンドウで開く', () => {
      const t = tab.type === 'database' ? 'pivot' : (tab.type || 'page');
      const url = '/?open=' + encodeURIComponent(t) + '&path=' + encodeURIComponent(tab.path || '') + '&label=' + encodeURIComponent(tab.label || '');
      if (typeof _open_app_window_js === 'function') _open_app_window_js(url);
      else window.open(url, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
      GBTabs.closeTab(paneId, tab.id);
    }, 'monitor');
    addItem('タブを閉じる', () => GBTabs.closeTab(paneId, tab.id), 'x');
    addItem('他のタブをすべて閉じる', () => {
      const paneInfo = findNode(_root, paneId);
      if (!paneInfo) return;
      const pane = paneInfo.node;
      const keep = pane.tabs.find(t => t.id === tab.id);
      if (!keep) return;
      const before = captureLayoutSnapshot();
      pane.tabs.forEach(t => {
        if (t.id !== tab.id && typeof removeComponentInstance === 'function') {
          removeComponentInstance(t.id);
        }
      });
      pane.tabs = [keep];
      pane.activeTabIndex = 0;
      render();
      saveLayout();
      pushLayoutHistory('レイアウト: 他のタブを閉じる', before, captureLayoutSnapshot(), keep.label || keep.path || '');
    }, 'x');
    addItem(isPaneLocked(paneId) ? 'パネルロックを解除' : 'パネルをロック', () => {
      togglePaneLocked(paneId);
    }, isPaneLocked(paneId) ? 'unlock' : 'lock');
    // ペイン最大化サブメニュー
    {
      const maxWrap = document.createElement('div');
      maxWrap.style.position = 'relative';
      const maxTrigger = document.createElement('div');
      maxTrigger.innerHTML = (typeof lucide === 'function' ? '<span style="margin-right:6px;opacity:0.7;">' + lucide('maximize2', 14) + '</span>' : '') + '表示モード' + submenuArrow();
      maxTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
      maxTrigger.onmouseenter = () => { maxTrigger.style.background = 'var(--bg4)'; };
      maxTrigger.onmouseleave = () => { maxTrigger.style.background = ''; };
      const maxPanel = document.createElement('div');
      maxPanel.className = 'gb-context-menu';
      maxPanel.style.cssText = 'display:none;min-width:120px;';
      attachHoverSubmenu(maxTrigger, maxPanel);
      const isMax = _maximizedPaneId === paneId;
      [['最大化', true], ['通常表示', false]].forEach(([label, val]) => {
        const si = document.createElement('div');
        si.innerHTML = radioMark(isMax === val) + label;
        si.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;' + (isMax === val ? 'color:var(--accent);' : '');
        si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
        si.onmouseleave = () => { si.style.background = ''; };
        si.addEventListener('click', () => { document.querySelectorAll('.gb-context-menu').forEach(m => m.remove()); if (val) maximizePane(paneId); else restoreMaximizedPane(); });
        maxPanel.appendChild(si);
      });
      maxWrap.appendChild(maxTrigger);
      maxWrap.appendChild(maxPanel);
      menu.appendChild(maxWrap);
    }
    // 別のペインで開く（分割）
    addItem('右の作業領域で開く', () => {
      const tabCopy = { ...tab, id: 'tab-' + Date.now() };
      const newPane = createPaneNode(null, [tabCopy], 0);
      const newPaneId = splitPane(paneId, 'horizontal', 'right', newPane);
      if (newPaneId) setActivePane(newPaneId);
    }, 'columns');
    document.body.appendChild(menu);
    clampPopupToViewport(menu);
    setTimeout(() => {
      const close = (ev) => {
        const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
        if (!inAny) { document.querySelectorAll('.gb-context-menu').forEach(m => m.remove()); document.removeEventListener('pointerdown', close); }
      };
      document.addEventListener('pointerdown', close);
    }, 0);
  }

  // === レイアウトリセット ===
  function resetLayout(options) {
    const opts = options || {};
    const before = !opts.skipHistory ? captureLayoutSnapshot() : null;
    _root = defaultLayout();
    _activePane = null;
    render();
    saveLayout();
    if (before) {
      const after = captureLayoutSnapshot();
      pushLayoutHistory('レイアウト: 初期化', before, after, '標準レイアウトへ戻す');
    }
  }

  function _cloneLayoutTree(layout) {
    if (!layout) return null;
    try {
      return JSON.parse(JSON.stringify(layout));
    } catch {
      return null;
    }
  }

  function _collectLayoutCounters(node, state) {
    if (!node || !state) return;
    if (node.id) {
      const paneNum = parseInt(String(node.id).replace(/^(pane|split)-/, ''), 10);
      if (!isNaN(paneNum) && paneNum > state.maxPaneId) state.maxPaneId = paneNum;
    }
    if (node.type === 'pane' && Array.isArray(node.tabs)) {
      node.tabs.forEach((tab) => {
        const tabNum = parseInt(String(tab?.id || '').replace(/^tab-/, ''), 10);
        if (!isNaN(tabNum) && tabNum > state.maxTabId) state.maxTabId = tabNum;
      });
      return;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
      node.children.forEach((child) => _collectLayoutCounters(child, state));
      return;
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      node.groups.forEach((g) => { if (g?.root) _collectLayoutCounters(g.root, state); });
    }
  }

  function _collectTabIds(node, ids) {
    if (!node || !ids) return ids;
    if (node.type === 'pane' && Array.isArray(node.tabs)) {
      node.tabs.forEach((tab) => {
        if (tab?.id) ids.add(tab.id);
      });
      return ids;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
      node.children.forEach((child) => _collectTabIds(child, ids));
      return ids;
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      node.groups.forEach((g) => { if (g?.root) _collectTabIds(g.root, ids); });
    }
    return ids;
  }

  function _syncLayoutCounters(root) {
    const state = { maxPaneId: _paneIdCounter, maxTabId: 0 };
    _collectLayoutCounters(root, state);
    if (state.maxPaneId > _paneIdCounter) _paneIdCounter = state.maxPaneId;
    if (typeof GBTabs !== 'undefined' && typeof GBTabs._restoreCounter === 'function') {
      GBTabs._restoreCounter(state.maxTabId);
    }
  }

  function _removeOrphanComponentInstances(prevRoot, nextRoot) {
    if (typeof removeComponentInstance !== 'function') return;
    const prevIds = _collectTabIds(prevRoot, new Set());
    const nextIds = _collectTabIds(nextRoot, new Set());
    prevIds.forEach((tabId) => {
      if (!nextIds.has(tabId)) removeComponentInstance(tabId);
    });
  }

  function exportLayout() {
    return _cloneLayoutTree(_root);
  }

  function captureLayoutSnapshot() {
    return {
      layout: exportLayout(),
      activePaneId: _activePane || '',
    };
  }

  function restoreLayoutSnapshot(snapshot) {
    if (!snapshot?.layout) return false;
    applyLayoutTree(snapshot.layout, {
      activePaneId: snapshot.activePaneId || '',
      skipSave: true,
    });
    saveLayout({ immediate: true });
    return true;
  }

  function pushLayoutHistory(label, beforeSnapshot, afterSnapshot, detail) {
    if (typeof historyPush !== 'function' || !beforeSnapshot?.layout || !afterSnapshot?.layout) return false;
    let beforeKey = '';
    let afterKey = '';
    try {
      beforeKey = JSON.stringify(beforeSnapshot);
      afterKey = JSON.stringify(afterSnapshot);
    } catch {}
    if (beforeKey && beforeKey === afterKey) return false;
    const scope = (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
    historyPush(
      label,
      () => restoreLayoutSnapshot(beforeSnapshot),
      () => restoreLayoutSnapshot(afterSnapshot),
      scope,
      detail || ''
    );
    saveLayout({ immediate: true });
    return true;
  }

  function applyLayoutTree(layout, options) {
    const nextRoot = _cloneLayoutTree(layout);
    if (!nextRoot || (nextRoot.type !== 'pane' && nextRoot.type !== 'split' && nextRoot.type !== 'panelset')) return null;
    _normalizePaneNode(nextRoot);
    _removeOrphanComponentInstances(_root, nextRoot);
    _root = nextRoot;
    _savedRootForMaximize = null;
    _maximizedPaneId = null;
    _setMaximizeChrome(false);
    _syncLayoutCounters(_root);
    const requestedPaneId = options?.activePaneId || '';
    _activePane = requestedPaneId && findNode(_root, requestedPaneId)?.node
      ? requestedPaneId
      : (findFirstPane(_root)?.id || null);
    render();
    if (_activePane && _paneMap[_activePane]) setActivePane(_activePane);
    if (!options?.skipSave) saveLayout({ immediate: true });
    return _activePane;
  }

  // === ペイン最大化/復元 ===
  function _setMaximizeChrome(hidden) {
    const statusBar = document.getElementById('status-bar');
    const sidebar = document.getElementById('sidebar');
    const sidebarResize = document.getElementById('sidebar-resize');
    if (document.body) {
      if (hidden) document.body.dataset.paneMaximized = '1';
      else delete document.body.dataset.paneMaximized;
    }
    if (statusBar) statusBar.style.display = hidden ? 'none' : '';
    if (hidden) {
      // サイドバーが表示中なら一時的に隠す（復元時に元に戻す）
      _sidebarWasVisible = sidebar && sidebar.style.display !== 'none';
      if (_sidebarWasVisible) {
        sidebar.style.display = 'none';
        if (sidebarResize) sidebarResize.style.display = 'none';
      }
    } else if (_sidebarWasVisible) {
      if (sidebar) sidebar.style.display = '';
      if (sidebarResize) sidebarResize.style.display = '';
    }
  }
  let _sidebarWasVisible = false;
  function maximizePane(paneId) {
    if (_maximizedPaneId) { restoreMaximizedPane(); return; }
    const info = findNode(_root, paneId);
    if (!info) return;
    _savedRootForMaximize = JSON.parse(JSON.stringify(_root));
    _maximizedPaneId = paneId;
    _setMaximizeChrome(true);
    render();
    saveLayout();
  }
  function restoreMaximizedPane() {
    if (!_savedRootForMaximize) return;
    // 最大化中にタブ変更があった場合、現在の状態をsavedRootにマージ
    const currentPane = findNode(_root, _maximizedPaneId);
    if (currentPane) {
      const savedPane = findNode(_savedRootForMaximize, _maximizedPaneId);
      if (savedPane) {
        savedPane.node.tabs = currentPane.node.tabs;
        savedPane.node.activeTabIndex = currentPane.node.activeTabIndex;
        savedPane.node.locked = !!currentPane.node.locked;
        savedPane.node.navHistory = Array.isArray(currentPane.node.navHistory) ? currentPane.node.navHistory : [];
        savedPane.node.navIndex = Number.isInteger(currentPane.node.navIndex) ? currentPane.node.navIndex : (savedPane.node.navHistory.length ? savedPane.node.navHistory.length - 1 : -1);
      }
    }
    _root = _savedRootForMaximize;
    _savedRootForMaximize = null;
    _maximizedPaneId = null;
    _setMaximizeChrome(false);
    _restoreCounters(_root);
    render();
    saveLayout();
  }
  function _restoreCounters(node) {
    if (!node) return;
    if (node.id) {
      const n = parseInt(node.id.replace(/^(pane|split)-/, ''));
      if (!isNaN(n) && n > _paneIdCounter) _paneIdCounter = n;
    }
    if (node.children) node.children.forEach(c => _restoreCounters(c));
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      node.groups.forEach(g => { if (g?.root) _restoreCounters(g.root); });
    }
  }
  function isMaximized() { return !!_maximizedPaneId; }

  // === 列 D&D 操作 ===
  // 任意のノード ID を指定位置で置換。ルート自身ならルートを差し替える。
  function _replaceNodeById(targetId, newNode) {
    if (!_root) return false;
    if (_root.id === targetId) { _root = newNode; return true; }
    function walk(n) {
      if (!n) return false;
      if (n.type === 'split' && Array.isArray(n.children)) {
        for (let i = 0; i < n.children.length; i++) {
          if (n.children[i]?.id === targetId) { n.children[i] = newNode; return true; }
          if (walk(n.children[i])) return true;
        }
      } else if (n.type === 'panelset' && Array.isArray(n.groups)) {
        for (const g of n.groups) {
          if (g?.root?.id === targetId) { g.root = newNode; return true; }
          if (g?.root && walk(g.root)) return true;
        }
      }
      return false;
    }
    return walk(_root);
  }

  // ノードを親から取り除く。親 split が単一子になった場合、その子で親を置換（平坦化）。
  function _detachNodeById(targetId) {
    if (!_root || _root.id === targetId) { _root = null; return; }
    function walk(n, parent, parentKey, parentIdx) {
      if (!n) return false;
      if (n.type === 'split' && Array.isArray(n.children)) {
        for (let i = 0; i < n.children.length; i++) {
          if (n.children[i]?.id === targetId) {
            // 兄弟のみ残る → split を兄弟で置換（平坦化）
            const sibling = n.children[1 - i];
            if (parent === null) { _root = sibling; return true; }
            if (parentKey === 'children') parent.children[parentIdx] = sibling;
            else if (parentKey === 'group') parent.root = sibling;
            return true;
          }
          if (walk(n.children[i], n, 'children', i)) return true;
        }
      } else if (n.type === 'panelset' && Array.isArray(n.groups)) {
        for (let gi = 0; gi < n.groups.length; gi++) {
          const g = n.groups[gi];
          if (!g?.root) continue;
          if (g.root.id === targetId) {
            // panelset から該当 group を除去。B 案では groups.length === 1 でも解体しない
            n.groups.splice(gi, 1);
            if (n.groups.length === 0) {
              // 空 panelset → 親から除去（再帰）
              _detachNodeById(n.id);
            } else {
              // activeGroupId が消えた group を指していた場合、先頭に差し替え
              if (!n.groups.some(x => x && x.id === n.activeGroupId)) {
                n.activeGroupId = n.groups[0].id;
              }
            }
            return true;
          }
          if (walk(g.root, g, 'group')) return true;
        }
      }
      return false;
    }
    walk(_root, null, null, 0);
  }

  // 未アタッチの自由ノード（例: panelset から取り出した group.root）を
  // target の左/右に新カラムとして挿入。
  function insertFreeNodeAsColumn(newNode, targetId, position) {
    if (!newNode || !targetId) return false;
    if (position !== 'left' && position !== 'right') return false;
    const targetInfo = findNode(_root, targetId);
    if (!targetInfo) return false;
    const first = position === 'left' ? newNode : targetInfo.node;
    const second = position === 'left' ? targetInfo.node : newNode;
    const newSplit = createSplitNode('horizontal', 0.5, [first, second]);
    if (_root === targetInfo.node) {
      _root = newSplit;
    } else {
      _replaceNodeById(targetId, newSplit);
    }
    render();
    saveLayout();
    return true;
  }

  // 列 D&D の適用: source を target の左/右に新カラムとして挿入。
  // 同一ノードや包含関係では何もしない。
  // position: 'left' | 'right'
  function insertColumnAround(sourceId, targetId, position, options) {
    const opts = options || {};
    if (!sourceId || !targetId || sourceId === targetId) return false;
    if (position !== 'left' && position !== 'right') return false;
    const sourceInfo = findNode(_root, sourceId);
    const targetInfo = findNode(_root, targetId);
    if (!sourceInfo || !targetInfo) return false;
    // target が source のサブツリー内にある場合は不可
    if (findNode(sourceInfo.node, targetId)) return false;
    const before = !opts.skipHistory ? (opts.historyBefore || captureLayoutSnapshot()) : null;

    let sourceClone;
    try { sourceClone = JSON.parse(JSON.stringify(sourceInfo.node)); } catch { return false; }
    _detachNodeById(sourceId);

    const targetInfo2 = findNode(_root, targetId);
    if (!targetInfo2) return false;

    // target を新しい水平 split でラップ: [source, target] または [target, source]
    const first = position === 'left' ? sourceClone : targetInfo2.node;
    const second = position === 'left' ? targetInfo2.node : sourceClone;
    const newSplit = createSplitNode('horizontal', 0.5, [first, second]);

    if (_root === targetInfo2.node) {
      _root = newSplit;
    } else {
      _replaceNodeById(targetId, newSplit);
    }
    render();
    saveLayout();
    if (before) {
      pushLayoutHistory(
        opts.historyLabel || 'レイアウト: カラム移動',
        before,
        captureLayoutSnapshot(),
        opts.historyDetail || position || sourceId || ''
      );
    }
    return true;
  }

  // 列 D&D の適用: source を target の位置に合流させてパネルセット化。
  // 同一ノードや包含関係では何もしない。
  function applyColumnDrop(sourceId, targetId, options) {
    const opts = options || {};
    if (!sourceId || !targetId || sourceId === targetId) return false;
    if (typeof GBPanelSet === 'undefined') return false;
    const sourceInfo = findNode(_root, sourceId);
    const targetInfo = findNode(_root, targetId);
    if (!sourceInfo || !targetInfo) return false;
    // target が source のサブツリー内にある場合は不可
    if (findNode(sourceInfo.node, targetId)) return false;
    const before = !opts.skipHistory ? (opts.historyBefore || captureLayoutSnapshot()) : null;
    // source のツリーコピーを作ってから切り離し
    let sourceClone;
    try { sourceClone = JSON.parse(JSON.stringify(sourceInfo.node)); } catch { return false; }
    _detachNodeById(sourceId);
    // target が detach によって位置変化する可能性があるため再取得
    const targetInfo2 = findNode(_root, targetId);
    if (!targetInfo2) return false;
    const merged = GBPanelSet.mergeColumns(targetInfo2.node, sourceClone);
    if (!merged) return false;
    if (merged !== targetInfo2.node) {
      _replaceNodeById(targetId, merged);
    }
    render();
    saveLayout();
    if (before) {
      pushLayoutHistory(
        opts.historyLabel || 'レイアウト: カラム結合',
        before,
        captureLayoutSnapshot(),
        opts.historyDetail || sourceId || ''
      );
    }
    return true;
  }

  // === Public API ===
  return {
    init,
    render,
    renderNode,
    refreshPaneTabs,
    resetLayout,
    saveLayout,
    exportLayout,
    captureLayoutSnapshot,
    restoreLayoutSnapshot,
    pushLayoutHistory,
    applyLayoutTree,
    createPaneNode,
    createSplitNode,
    splitPane,
    splitRoot,
    removePane,
    setActivePane,
    findNode,
    findFirstPane,
    getAllPanes,
    isPaneVisible,
    isPaneLocked,
    hasLockedPane,
    findFirstUnlockedPane,
    revealPane,
    setPaneLocked,
    togglePaneLocked,
    updatePaneNavButtons: _updatePaneNavButtons,
    maximizePane,
    restoreMaximizedPane,
    isMaximized,
    applyColumnDrop,
    insertColumnAround,
    insertFreeNodeAsColumn,
    _findColumnAncestorId,
    _layoutInternal: {
      detachNodeById: _detachNodeById,
      replaceNodeById: _replaceNodeById,
    },
    get root() { return _root; },
    set root(v) { _root = v; },
    get activePane() { return _activePane; },
    get layoutLoadedFromStorage() { return _loadedLayoutFromStorage; },
    get paneMap() { return _paneMap; },
    get layoutEl() { return _layoutEl; },
    set onPreRender(fn) { _preRender = fn; },
    set onPostRender(fn) { _postRender = fn; },
    set onActivePaneChange(fn) { _onActivePaneChange = fn; },
    get isNavPaneType() { return _isNavPaneType; },
    set isNavPaneType(fn) { _isNavPaneType = fn; },
    get isPassivePaneType() { return _isPassivePaneType; },
    set isPassivePaneType(fn) { _isPassivePaneType = fn; },
    isMobileLayout: _isMobileLayout,
  };
})();
