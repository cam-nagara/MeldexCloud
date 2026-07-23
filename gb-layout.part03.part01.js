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
  function _canRemovePane(paneId) {
    const info = findNode(_root, paneId);
    if (!info?.node || info.node.type !== 'pane') return false;
    return getAllPanes(_root).some(pane => pane && pane.id !== paneId);
  }

  function _showPaneCloseBlockedStatus(paneId) {
    const info = findNode(_root, paneId);
    if (info?.node?.locked) {
      if (typeof showStatus === 'function') showStatus('ロック中のパネルは閉じられません', true);
      return;
    }
    if (typeof showStatus === 'function') showStatus('最後のパネルは閉じられません', true);
  }

  function removePane(paneId, options) {
    const opts = options || {};
    const target = findNode(_root, paneId);
    if (!target?.node || target.node.type !== 'pane') return;
    if (target.node.locked || !_canRemovePane(paneId)) {
      _showPaneCloseBlockedStatus(paneId);
      return;
    }
    // ルートペイン自身は除去不可
    if (_root && _root.id === paneId) {
      _showPaneCloseBlockedStatus(paneId);
      return;
    }
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
      // ユーザーが明示的に閉じた固定レールは、付随的な reveal（コンテンツ更新・
      // タブ切替等）では開き直さない。ユーザー操作起点（options.userIntent）のみ開く。
      const isFixedRail = node.meldexRole === 'left-sidebar' || node.meldexRole === 'right-sidebar';
      if (isFixedRail && node._userCollapsed && !options?.userIntent) return;
      node.collapsed = false;
      if (isFixedRail) delete node._userCollapsed;
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

  function _createLayoutContextMenuItem(label, icon, options) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gb-context-menu-item';
    if (options?.submenu) {
      item.classList.add('has-submenu');
      item.setAttribute('aria-haspopup', 'menu');
      item.setAttribute('aria-expanded', 'false');
    }
    if (options?.checked !== undefined) {
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', options.checked ? 'true' : 'false');
      const check = document.createElement('span');
      check.className = 'gb-menu-check-icon menu-icon';
      check.style.color = 'var(--ui-accent, var(--accent))';
      if (options.checked && typeof lucide === 'function') check.innerHTML = lucide('check', 14);
      item.appendChild(check);
    } else {
      item.setAttribute('role', 'menuitem');
    }
    if (icon && typeof lucide === 'function') {
      const iconEl = document.createElement('span');
      iconEl.className = 'menu-icon';
      iconEl.innerHTML = lucide(icon, 14);
      item.appendChild(iconEl);
    }
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    item.appendChild(labelEl);
    return item;
  }

  function _layoutContextMenuItems(menu) {
    return Array.from(menu?.querySelectorAll?.('.gb-context-menu-item') || [])
      .filter(item => !item.disabled && item.getAttribute('aria-disabled') !== 'true');
  }

  function _layoutContextMenuAnchorRect(e) {
    const x = Number(e?.clientX);
    const y = Number(e?.clientY);
    if (Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0)) {
      return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
    }
    const trigger = e?.currentTarget;
    if (trigger?.getBoundingClientRect) return trigger.getBoundingClientRect();
    return { left: 12, top: 12, right: 12, bottom: 12, width: 0, height: 0 };
  }

  function _restoreLayoutMenuFocus(trigger) {
    if (!trigger) return;
    if (typeof focusMeldexDropdownTrigger === 'function') {
      focusMeldexDropdownTrigger(trigger);
      return;
    }
    trigger.focus?.({ preventScroll: true });
  }

  function _positionLayoutContextMenu(menu, e) {
    const anchor = _layoutContextMenuAnchorRect(e);
    if (typeof positionPopup === 'function') {
      positionPopup(menu, anchor);
      return;
    }
    const z = (typeof _getZoom === 'function') ? _getZoom() : 1;
    menu.style.left = (anchor.left / z) + 'px';
    menu.style.top = (anchor.bottom / z) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }

  function _bindLayoutContextMenuDismiss(menu, trigger) {
    const cleanup = () => {
      document.removeEventListener('keydown', closeOnKey, true);
      document.removeEventListener('pointerdown', closeOnPointer);
    };
    const closeMenu = (restoreFocus) => {
      document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
      cleanup();
      if (restoreFocus) _restoreLayoutMenuFocus(trigger);
    };
    function closeOnKey(ev) {
      if (!menu.isConnected) {
        cleanup();
        return;
      }
      const items = _layoutContextMenuItems(menu);
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu(true);
        return;
      }
      if (!items.length) return;
      if (ev.key === 'Home' || ev.key === 'End' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        ev.stopPropagation();
        const activeIndex = Math.max(0, items.indexOf(document.activeElement));
        const nextIndex = ev.key === 'Home'
          ? 0
          : ev.key === 'End'
            ? items.length - 1
            : (activeIndex + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[nextIndex]?.focus?.({ preventScroll: true });
      }
    }
    function closeOnPointer(ev) {
      if (!menu.isConnected) {
        cleanup();
        return;
      }
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAny) closeMenu(false);
    }
    document.addEventListener('keydown', closeOnKey, true);
    setTimeout(() => document.addEventListener('pointerdown', closeOnPointer), 0);
    return closeMenu;
  }

  // === パネル操作メニュー（…ボタン経由: ロック/折りたたみ/最大化/閉じる） ===
  function _showPaneActionsMenu(e, node) {
    if (!_showFreeLayoutUi()) return;
    if (typeof closeMeldexDropdowns === 'function') {
      closeMeldexDropdowns({ exceptTarget: e.currentTarget });
    }
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'パネル操作');
    menu.style.cssText = 'position:fixed;z-index:10000;';
    const isMaxed = _maximizedPaneId === node.id;
    const hasParent = !!findParent(_root, node.id);
    const canClosePane = hasParent && !node.locked && _canRemovePane(node.id);
    let closeMenu = () => document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());

    function addItem(label, fn, icon) {
      const mi = _createLayoutContextMenuItem(label, icon);
      mi.addEventListener('click', () => {
        closeMenu(false);
        fn();
      });
      menu.appendChild(mi);
    }

    // ロック: サブメニューで現在の状態が一目で分かるよう「ロック」「ロック解除」両方を表示。
    // 選択中の状態には Lucide の check を表示し、クリックで対応する状態へ遷移。
    (function _addLockSubmenu() {
      const trigger = _createLayoutContextMenuItem('ロック', node.locked ? 'lock' : 'unlock', { submenu: true });
      const panel = document.createElement('div');
      panel.className = 'gb-context-menu';
      panel.setAttribute('role', 'menu');
      panel.setAttribute('aria-label', 'パネルロック');
      panel.style.cssText = 'display:none;';
      function addLockSub(label, iconName, isActive, desired) {
        const si = _createLayoutContextMenuItem(label, iconName, { checked: isActive });
        si.addEventListener('click', () => {
          document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
          if (!isActive) setPaneLocked(node.id, desired);
        });
        panel.appendChild(si);
      }
      addLockSub('ロック', 'lock', !!node.locked, true);
      addLockSub('ロック解除', 'unlock', !node.locked, false);
      if (typeof attachHoverSubmenu === 'function') attachHoverSubmenu(trigger, panel);
      menu.appendChild(trigger);
      document.body.appendChild(panel);
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
    if (canClosePane) {
      addItem('パネルを閉じる', () => {
        if (isMaxed) restoreMaximizedPane();
        removePane(node.id);
      }, 'x');
    }

    document.body.appendChild(menu);
    _positionLayoutContextMenu(menu, e);
    menu.querySelector('.gb-context-menu-item')?.focus?.({ preventScroll: true });
    closeMenu = _bindLayoutContextMenuDismiss(menu, e?.currentTarget || null);
  }

  // === ペインタブ右クリックメニュー ===
  function _showTabContextMenu(e, paneId, tab) {
    // 既存メニューを除去
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu tab-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'タブ操作');
    menu.style.cssText = 'position:fixed;z-index:10000;';
    const isLocked = () => isPaneLocked(paneId);
    const showLockedStatus = () => {
      if (typeof showStatus === 'function') showStatus('ロック中のパネルではタブを閉じられません', true);
    };
    let closeMenu = () => document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    function addItem(label, fn, icon) {
      const mi = _createLayoutContextMenuItem(label, icon);
      mi.addEventListener('click', () => { closeMenu(false); fn(); });
      menu.appendChild(mi);
    }
    // 新しいウィンドウで開く
    addItem('新しいウィンドウで開く', () => {
      if (isLocked()) { showLockedStatus(); return; }
      const t = tab.type === 'database' ? 'pivot' : (tab.type || 'page');
      const url = '/?open=' + encodeURIComponent(t) + '&path=' + encodeURIComponent(tab.path || '') + '&label=' + encodeURIComponent(tab.label || '');
      const closeSourceTab = () => GBTabs.closeTab(paneId, tab.id);
      if (typeof _open_app_window_js === 'function') {
        Promise.resolve(_open_app_window_js(url)).then((ok) => {
          if (ok) closeSourceTab();
          else if (typeof showStatus === 'function') showStatus('新しいウィンドウを開けませんでした', true);
        }).catch(() => {
          if (typeof showStatus === 'function') showStatus('新しいウィンドウを開けませんでした', true);
        });
        return;
      }
      const opened = window.open(url, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
      if (opened) closeSourceTab();
      else if (typeof showStatus === 'function') showStatus('新しいウィンドウを開けませんでした', true);
    }, 'monitor');
    addItem('タブを閉じる', () => {
      if (isLocked()) { showLockedStatus(); return; }
      GBTabs.closeTab(paneId, tab.id);
    }, 'x');
    addItem('他のタブをすべて閉じる', () => {
      if (isLocked()) { showLockedStatus(); return; }
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
    if (_showFreeLayoutUi()) {
      addItem(isPaneLocked(paneId) ? 'パネルロックを解除' : 'パネルをロック', () => {
        togglePaneLocked(paneId);
      }, isPaneLocked(paneId) ? 'unlock' : 'lock');
      // ペイン最大化サブメニュー
      {
        const maxTrigger = _createLayoutContextMenuItem('表示モード', 'maximize2', { submenu: true });
        const maxPanel = document.createElement('div');
        maxPanel.className = 'gb-context-menu';
        maxPanel.setAttribute('role', 'menu');
        maxPanel.setAttribute('aria-label', '表示モード');
        maxPanel.style.cssText = 'display:none;min-width:120px;';
        attachHoverSubmenu(maxTrigger, maxPanel);
        const isMax = _maximizedPaneId === paneId;
        [['最大化', true], ['通常表示', false]].forEach(([label, val]) => {
          const si = _createLayoutContextMenuItem(label, '', { checked: isMax === val });
          si.addEventListener('click', () => { document.querySelectorAll('.gb-context-menu').forEach(m => m.remove()); if (val) maximizePane(paneId); else restoreMaximizedPane(); });
          maxPanel.appendChild(si);
        });
        menu.appendChild(maxTrigger);
        document.body.appendChild(maxPanel);
      }
      // 別のペインで開く（分割）
      addItem('右の作業領域で開く', () => {
        const tabCopy = { ...tab, id: 'tab-' + Date.now() };
        const newPane = createPaneNode(null, [tabCopy], 0);
        const newPaneId = splitPane(paneId, 'horizontal', 'right', newPane);
        if (newPaneId) setActivePane(newPaneId);
      }, 'columns');
    }
    document.body.appendChild(menu);
    _positionLayoutContextMenu(menu, e);
    menu.querySelector('.gb-context-menu-item')?.focus?.({ preventScroll: true });
    closeMenu = _bindLayoutContextMenuDismiss(menu, e?.currentTarget || null);
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
