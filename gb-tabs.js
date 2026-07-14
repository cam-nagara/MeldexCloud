/* ==============================
   gb-tabs.js: ペイン内タブ管理（v5.0）
   ============================== */

const GBTabs = (() => {
  let _tabIdCounter = 0;

  const TAB_ICONS = {
    pivot: 'db', gallery: 'db', kanban: 'db', timeline: 'db',
    media: 'galleryThumbnails', html: 'globe',
    chart: 'db', graph: 'db', compare: 'columns',
    search: 'search', scriptnote: 'bookOpenText', version: 'gitBranch',
    timer: 'timer',
  };
  const SINGLETON_TOOL_TYPES = new Set(['chat', 'annotation', 'history', 'detail', 'outliner', 'search', 'timer']);

  function tabIcon(type) {
    if (typeof uiTypeIconName === 'function') {
      const shared = uiTypeIconName(type);
      if (shared) return shared;
    }
    return TAB_ICONS[type] || 'page';
  }

  function createTab(label, type, path, state) {
    return {
      id: 'tab-' + (++_tabIdCounter),
      type: type || 'page',
      label: label || '(無題)',
      path: path || '',
      icon: tabIcon(type),
      state: state || {},
    };
  }

  function _ensurePaneVisible(paneId, options) {
    if (!paneId || typeof GBLayout === 'undefined') return false;
    if (typeof GBLayout.revealPane === 'function') {
      const activate = options?.activate !== false;
      return !!GBLayout.revealPane(paneId, { deferRender: true, activate });
    }
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    if (paneInfo?.node?.collapsed) {
      paneInfo.node.collapsed = false;
      return true;
    }
    return false;
  }

  function _updatePaneTabDom(paneId, tabId) {
    const paneEl = GBLayout.paneMap?.[paneId]?.el;
    if (!paneEl) return false;
    const tabs = paneEl.querySelectorAll(':scope > .gb-pane-tabs .gb-tab[data-tab-id]');
    if (!tabs.length) return false;
    tabs.forEach(el => el.classList.toggle('active', el.dataset.tabId === tabId));
    return true;
  }

  function _activateTabFast(paneId, tabId, revealed) {
    if (revealed) return false;
    if (typeof GBPaneBridge === 'undefined' || typeof GBPaneBridge.refreshPaneAfterTabSwitch !== 'function') return false;
    if (!GBLayout.paneMap?.[paneId]?.contentEl) return false;
    if (typeof GBLayout.isMobileLayout === 'function' && GBLayout.isMobileLayout()) return false;
    return _updatePaneTabDom(paneId, tabId);
  }

  function _refreshPaneTabsFast(paneIds) {
    if (typeof GBLayout.refreshPaneTabs !== 'function') return false;
    if (typeof GBLayout.isMobileLayout === 'function' && GBLayout.isMobileLayout()) return false;
    const ids = Array.isArray(paneIds) ? paneIds : [paneIds];
    for (const id of ids) {
      if (!GBLayout.paneMap?.[id]?.contentEl) return false;
    }
    for (const id of ids) {
      if (!GBLayout.refreshPaneTabs(id)) return false;
    }
    return true;
  }

  function _visiblePanes() {
    if (typeof GBLayout.getAllPanes !== 'function') return [];
    try { return GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }); } catch {}
    return GBLayout.getAllPanes(GBLayout.root);
  }

  function _findVisibleTab(predicate) {
    const allPanes = _visiblePanes();
    for (const p of allPanes) {
      const ex = (p.tabs || []).find(predicate);
      if (ex) return { paneId: p.id, tab: ex };
    }
    return null;
  }

  function _cleanTreePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function _pathTailLabel(path, fallback) {
    const clean = _cleanTreePath(path);
    return clean.split('/').filter(Boolean).pop() || fallback || 'フォルダ';
  }

  function _parentFolderPath(path) {
    const clean = _cleanTreePath(path);
    const index = clean.lastIndexOf('/');
    return index > 0 ? clean.slice(0, index) : '';
  }

  function _selectedOutlinerNodeData() {
    if (typeof document === 'undefined') return null;
    const activeSelector = '#outliner-tree .tree-node-row.active, #body-home .tree-node-row.active, #body-workspaces .tree-node-row.active';
    const selectedSelector = '#outliner-tree .tree-node-row.selected, #body-home .tree-node-row.selected, #body-workspaces .tree-node-row.selected';
    const rows = Array.from(document.querySelectorAll(activeSelector));
    const fallbackRows = rows.length ? rows : Array.from(document.querySelectorAll(selectedSelector));
    const row = fallbackRows[fallbackRows.length - 1] || null;
    const node = row?.closest?.('.tree-node') || null;
    return node?._nodeData || null;
  }

  function _folderFallbackTargetFromSelection() {
    const data = _selectedOutlinerNodeData();
    const path = _cleanTreePath(data?.path || '');
    if (!path) return null;
    const type = data?.type || '';
    if (data?._isRoot || type === 'folder' || type === 'database') {
      return {
        label: data?.name || _pathTailLabel(path, 'フォルダ'),
        path,
        selectedPath: path,
      };
    }
    const parentPath = _parentFolderPath(path);
    if (!parentPath) return null;
    return {
      label: _pathTailLabel(parentPath, 'フォルダ'),
      path: parentPath,
      selectedPath: path,
    };
  }

  function _isMainWorkPane(pane, allPanes) {
    if (!pane) return false;
    if ((allPanes || []).length <= 1) return true;
    return pane.meldexRole === 'main' || pane.id === 'pane-main';
  }

  function _restoreFolderFallbackTab(pane) {
    if (!pane || (pane.tabs || []).length > 0) return false;
    const target = _folderFallbackTargetFromSelection();
    const tab = createTab(
      target?.label || 'フォルダ',
      'folder',
      target?.path || '',
      target ? { folderPath: target.path, selectedPath: target.selectedPath } : { initialFolderPrompt: true }
    );
    pane.tabs = [tab];
    pane.activeTabIndex = 0;
    return true;
  }

  // ペインにタブを追加
  function addTab(paneId, label, type, path, state, options) {
    const opts = options || {};
    const initialPaneInfo = GBLayout.findNode(GBLayout.root, paneId);
    if (!initialPaneInfo) return null;
    const initialPane = initialPaneInfo.node;
    const preferTargetPane = !!opts.preferTargetPane;

    // メインパネル固定など、呼び出し元が明示したパネルを優先する場合は、
    // 他パネルに残った同種タブで開き先が横取りされないよう対象パネル内だけ再利用する。
    if (preferTargetPane) {
      const existingTargetTab = (initialPane.tabs || []).find(t => {
        if (path) return t.path === path && t.type === type;
        return !t.path && t.type === type;
      });
      if (existingTargetTab) {
        if (state && typeof state === 'object' && Object.keys(state).length) {
          existingTargetTab.state = { ...(existingTargetTab.state || {}), ...state };
        }
        activateTab(paneId, existingTargetTab.id, opts);
        return existingTargetTab.id;
      }
    }

    // 同じpath+typeのタブがあればそちらをアクティブに（全ペイン横断）
    if (path) {
      const existing = preferTargetPane ? null : _findVisibleTab(t => t.path === path && t.type === type);
      if (existing) {
        if (state && typeof state === 'object' && Object.keys(state).length) {
          existing.tab.state = { ...(existing.tab.state || {}), ...state };
        }
        activateTab(existing.paneId, existing.tab.id, opts);
        return existing.tab.id;
      }
    }
    if (!path && SINGLETON_TOOL_TYPES.has(type) && !opts.forceNewToolTab) {
      const existing = preferTargetPane ? null : _findVisibleTab(t => !t.path && t.type === type);
      if (existing) {
        activateTab(existing.paneId, existing.tab.id, opts);
        return existing.tab.id;
      }
    }

    let targetPaneId = paneId;
    if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(targetPaneId)) {
      const fallbackPane = typeof GBLayout.findFirstUnlockedPane === 'function' ? GBLayout.findFirstUnlockedPane(targetPaneId) : null;
      if (fallbackPane?.id) {
        targetPaneId = fallbackPane.id;
      } else {
        if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
        return null;
      }
    }

    const paneInfo = GBLayout.findNode(GBLayout.root, targetPaneId);
    if (!paneInfo) return null;
    const pane = paneInfo.node;

    if (!path && targetPaneId !== paneId) {
      const existingToolTab = (pane.tabs || []).find(t => t.type === type && !t.path);
      if (existingToolTab) {
        activateTab(targetPaneId, existingToolTab.id, opts);
        return existingToolTab.id;
      }
    }

    const tab = createTab(label, type, path, state);
    pane.tabs.push(tab);
    pane.activeTabIndex = pane.tabs.length - 1;
    const previousActivePane = GBLayout.activePane;
    const revealed = _ensurePaneVisible(targetPaneId, { activate: !opts.preserveActivePane });
    const fastAdded = !revealed && _refreshPaneTabsFast(targetPaneId);
    if (!fastAdded) GBLayout.render();
    GBLayout.saveLayout({ immediate: true });
    if (!opts.preserveActivePane) GBLayout.setActivePane(targetPaneId, fastAdded ? { skipCallback: true } : undefined);
    if (fastAdded && typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.refreshPaneAfterTabSwitch === 'function') {
      GBPaneBridge.refreshPaneAfterTabSwitch(targetPaneId, {
        previousActivePane: opts.preserveActivePane ? null : previousActivePane,
      });
    }

    return tab.id;
  }

  function updateTab(paneId, tabId, patch, options) {
    const opts = options || {};
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    if (!paneInfo) return false;
    const pane = paneInfo.node;
    const tab = (pane.tabs || []).find(t => t.id === tabId);
    if (!tab) return false;

    if (Object.prototype.hasOwnProperty.call(patch || {}, 'label')) tab.label = patch.label || '(無題)';
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'type')) {
      tab.type = patch.type || 'page';
      tab.icon = tabIcon(tab.type);
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'path')) tab.path = patch.path || '';
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'state')) {
      tab.state = patch.state && typeof patch.state === 'object' ? patch.state : {};
    }
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'icon')) tab.icon = patch.icon || tabIcon(tab.type);

    const idx = pane.tabs.indexOf(tab);
    if (opts.activate && idx >= 0) pane.activeTabIndex = idx;
    const fastUpdated = _refreshPaneTabsFast(paneId);
    if (!fastUpdated) GBLayout.render();
    else if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.refreshPaneAfterTabSwitch === 'function') {
      GBPaneBridge.refreshPaneAfterTabSwitch(paneId);
    }
    GBLayout.saveLayout({ immediate: true });
    return true;
  }

  // タブをアクティブ化
  function activateTab(paneId, tabId, options) {
    const opts = options || {};
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    if (!paneInfo) return;
    const pane = paneInfo.node;

    const idx = pane.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    const alreadyActive = pane.activeTabIndex === idx;
    pane.activeTabIndex = idx;
    const revealed = _ensurePaneVisible(paneId, { activate: !opts.preserveActivePane });
    const previousActivePane = GBLayout.activePane;

    if (alreadyActive) {
      if (revealed) GBLayout.render();
      if (!opts.preserveActivePane && previousActivePane !== paneId) {
        const fastFocused = _activateTabFast(paneId, tabId, revealed);
        if (fastFocused) {
          GBLayout.setActivePane(paneId, { skipCallback: true });
          GBPaneBridge.refreshPaneAfterTabSwitch(paneId, { previousActivePane });
        } else {
          GBLayout.setActivePane(paneId);
        }
      }
      GBLayout.saveLayout({ immediate: true });
      return;
    }

    const fastActivated = _activateTabFast(paneId, tabId, revealed);
    if (fastActivated) {
      if (!opts.preserveActivePane) GBLayout.setActivePane(paneId, { skipCallback: true });
      GBPaneBridge.refreshPaneAfterTabSwitch(paneId, {
        previousActivePane: opts.preserveActivePane ? null : previousActivePane,
      });
    } else {
      GBLayout.render();
      if (!opts.preserveActivePane) GBLayout.setActivePane(paneId);
    }
    GBLayout.saveLayout({ immediate: true });
  }

  // タブを閉じる
  function closeTab(paneId, tabId, options) {
    const opts = options || {};
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    if (!paneInfo) return;
    if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(paneId)) {
      if (typeof showStatus === 'function') showStatus('ロック中のパネルではタブを閉じられません', true);
      return;
    }
    const pane = paneInfo.node;

    const idx = pane.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    const closedTab = pane.tabs[idx];
    const before = (!opts.skipHistory && typeof GBLayout.captureLayoutSnapshot === 'function')
      ? GBLayout.captureLayoutSnapshot()
      : null;
    pane.tabs.splice(idx, 1);

    // コンポーネントインスタンスを破棄（メモリリーク防止）
    if (typeof removeComponentInstance === 'function') {
      removeComponentInstance(tabId);
    }

    if (idx < pane.activeTabIndex) {
      // 閉じたタブがアクティブタブより前なら、インデックスを1つ前に補正
      pane.activeTabIndex--;
    } else if (idx === pane.activeTabIndex) {
      // アクティブタブ自体を閉じた場合
      if (pane.activeTabIndex >= pane.tabs.length) {
        pane.activeTabIndex = pane.tabs.length - 1;
      }
    }

    // ペインが空になった場合
    if (pane.tabs.length === 0) {
      const allPanes = GBLayout.getAllPanes(GBLayout.root);
      if (!_isMainWorkPane(pane, allPanes) && allPanes.length > 1) {
        // 複数ペインがある場合、空ペインを除去
        GBLayout.removePane(paneId, { skipHistory: true });
        if (before && typeof GBLayout.pushLayoutHistory === 'function') {
          GBLayout.pushLayoutHistory(
            'レイアウト: タブを閉じる',
            before,
            GBLayout.captureLayoutSnapshot(),
            closedTab?.label || closedTab?.path || ''
          );
        }
        return;
      }
      if (!_restoreFolderFallbackTab(pane)) {
        // 最後の1ペインなら空のまま維持
        pane.activeTabIndex = -1;
      }
    }

    const fastClosed = _refreshPaneTabsFast(paneId);
    if (!fastClosed) GBLayout.render();
    else if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.refreshPaneAfterTabSwitch === 'function') {
      GBPaneBridge.refreshPaneAfterTabSwitch(paneId);
    }
    GBLayout.saveLayout({ immediate: true });
    if (before && typeof GBLayout.pushLayoutHistory === 'function') {
      GBLayout.pushLayoutHistory(
        'レイアウト: タブを閉じる',
        before,
        GBLayout.captureLayoutSnapshot(),
        closedTab?.label || closedTab?.path || ''
      );
    }
  }

  // タブを別ペインに移動（同ペイン内の並べ替えにも対応）
  function moveTab(fromPaneId, tabId, toPaneId, insertIndex) {
    const fromInfo = GBLayout.findNode(GBLayout.root, fromPaneId);
    const toInfo = GBLayout.findNode(GBLayout.root, toPaneId);
    if (!fromInfo || !toInfo) return;

    const fromPane = fromInfo.node;
    const toPane = toInfo.node;

    const idx = fromPane.tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;

    const fromLocked = typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(fromPaneId);
    const toLocked = typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(toPaneId);
    if (fromLocked || toLocked) {
      if (typeof showStatus === 'function') showStatus('ロック中のパネルとの間でタブは移動できません', true);
      return;
    }

    // 同ペイン内の並べ替え
    if (fromPaneId === toPaneId) {
      if (insertIndex == null || insertIndex === idx) return; // 移動なし
      const before = typeof GBLayout.captureLayoutSnapshot === 'function' ? GBLayout.captureLayoutSnapshot() : null;
      const activeTab = fromPane.tabs[fromPane.activeTabIndex] || null;
      const [tab] = fromPane.tabs.splice(idx, 1);
      // splice後のインデックス調整
      const adjustedIdx = idx < insertIndex ? insertIndex - 1 : insertIndex;
      fromPane.tabs.splice(adjustedIdx, 0, tab);
      if (activeTab) {
        fromPane.activeTabIndex = fromPane.tabs.indexOf(activeTab);
      } else {
        fromPane.activeTabIndex = fromPane.tabs.indexOf(tab);
      }
      const fastMoved = _refreshPaneTabsFast(fromPaneId);
      if (!fastMoved) GBLayout.render();
      GBLayout.saveLayout({ immediate: true });
      if (before && typeof GBLayout.pushLayoutHistory === 'function') {
        GBLayout.pushLayoutHistory('レイアウト: タブ移動', before, GBLayout.captureLayoutSnapshot(), tab.label || tab.path || '');
      }
      return;
    }

    const before = typeof GBLayout.captureLayoutSnapshot === 'function' ? GBLayout.captureLayoutSnapshot() : null;
    const movedWasActive = idx === fromPane.activeTabIndex;
    const [tab] = fromPane.tabs.splice(idx, 1);
    // 移動元の activeTabIndex を補正：移動タブがアクティブタブより前にあった場合はデクリメント
    if (idx < fromPane.activeTabIndex) {
      fromPane.activeTabIndex--;
    }
    if (insertIndex != null && insertIndex >= 0) {
      toPane.tabs.splice(insertIndex, 0, tab);
    } else {
      toPane.tabs.push(tab);
    }

    // 移動先でアクティブに
    toPane.activeTabIndex = toPane.tabs.indexOf(tab);
    _ensurePaneVisible(toPaneId);

    // 移動元が空になった場合
    if (fromPane.tabs.length === 0) {
      if (fromPane.activeTabIndex >= 0) fromPane.activeTabIndex = -1;
      const allPanes = GBLayout.getAllPanes(GBLayout.root);
      if (allPanes.length > 1) {
        GBLayout.removePane(fromPaneId, { skipHistory: true });
        GBLayout.setActivePane(toPaneId);
        if (before && typeof GBLayout.pushLayoutHistory === 'function') {
          GBLayout.pushLayoutHistory('レイアウト: タブ移動', before, GBLayout.captureLayoutSnapshot(), tab.label || tab.path || '');
        }
        return;
      }
    } else {
      if (fromPane.activeTabIndex >= fromPane.tabs.length) {
        fromPane.activeTabIndex = fromPane.tabs.length - 1;
      }
    }

    const previousActivePane = GBLayout.activePane;
    const fastMoved = _refreshPaneTabsFast([fromPaneId, toPaneId]);
    GBLayout.setActivePane(toPaneId, fastMoved ? { skipCallback: true } : undefined);
    if (!fastMoved) GBLayout.render();
    else if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.refreshPaneAfterTabSwitch === 'function') {
      const sourcePaneStillPresent = fromPane.tabs.length > 0 && !!GBLayout.findNode(GBLayout.root, fromPaneId);
      if (movedWasActive && sourcePaneStillPresent) {
        GBPaneBridge.refreshPaneAfterTabSwitch(fromPaneId, { previousActivePane: toPaneId });
      }
      GBPaneBridge.refreshPaneAfterTabSwitch(toPaneId, {
        previousActivePane: previousActivePane && previousActivePane !== toPaneId ? previousActivePane : fromPaneId,
      });
    }
    GBLayout.saveLayout({ immediate: true });
    if (before && typeof GBLayout.pushLayoutHistory === 'function') {
      GBLayout.pushLayoutHistory('レイアウト: タブ移動', before, GBLayout.captureLayoutSnapshot(), tab.label || tab.path || '');
    }
  }

  // アクティブペインにタブを追加（ショートカット）
  function addToActivePane(label, type, path) {
    let paneId = '';
    let preferTargetPane = false;
    if ((path || !SINGLETON_TOOL_TYPES.has(type)) && typeof GBPaneDefaultLayout !== 'undefined' && typeof GBPaneDefaultLayout.resolveMainPaneId === 'function') {
      paneId = GBPaneDefaultLayout.resolveMainPaneId({ contentOnly: true });
      preferTargetPane = !!paneId;
    }
    if (!paneId) paneId = GBLayout.activePane;
    if (!paneId) {
      const firstPane = GBLayout.findFirstPane(GBLayout.root);
      if (firstPane) paneId = firstPane.id;
    }
    if (!paneId) return null;
    return addTab(paneId, label, type, path, null, { preferTargetPane });
  }

  // 指定のタブを持つペインを検索
  // panelset 非アクティブグループのペインは検索対象外にする
  // （paneMap に載っていない = DOM 未生成のペインに activateTab しても何も起きない）
  function findPaneWithTab(type, path) {
    const allPanes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true });
    for (const pane of allPanes) {
      const tab = pane.tabs.find(t => t.path === path && t.type === type);
      if (tab) return { paneId: pane.id, tabId: tab.id };
    }
    return null;
  }

  // アクティブタブの情報取得
  function getActiveTab(paneId) {
    paneId = paneId || GBLayout.activePane;
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    if (!paneInfo) return null;
    const pane = paneInfo.node;
    if (pane.activeTabIndex < 0 || pane.activeTabIndex >= pane.tabs.length) return null;
    return pane.tabs[pane.activeTabIndex];
  }

  // ペインのタブ配列を取得（shortcuts の nextTab/prevTab 用）
  function getTabs(paneId) {
    paneId = paneId || GBLayout.activePane;
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    if (!paneInfo) return [];
    return (paneInfo.node.tabs || []).slice();
  }

  // カウンター復元（レイアウト復元時のID衝突防止）
  function _restoreCounter(maxId) {
    if (maxId > _tabIdCounter) _tabIdCounter = maxId;
  }

  return {
    createTab,
    addTab,
    updateTab,
    activateTab,
    closeTab,
    moveTab,
    addToActivePane,
    findPaneWithTab,
    getActiveTab,
    getTabs,
    tabIcon,
    _restoreCounter,
  };
})();
