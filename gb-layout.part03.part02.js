    _normalizePaneNode(nextRoot);
    const fixedRoot = _migrateLayoutToFixedRailsIfNeeded(nextRoot);
    _removeOrphanComponentInstances(_root, fixedRoot);
    _root = fixedRoot;
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
      _sidebarWasVisible = false;
    } else {
      _sidebarWasVisible = false;
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
    if (!_maximizedPaneId) return;
    const restoredPaneId = _maximizedPaneId;
    if (!findNode(_root, restoredPaneId) && _savedRootForMaximize) {
      _root = _savedRootForMaximize;
    }
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
    isFreeLayoutUiEnabled: _showFreeLayoutUi,
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
    setNodeCollapsed,
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
