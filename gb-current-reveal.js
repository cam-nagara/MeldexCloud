/* gb-current-reveal.js: 現在開いている項目をフォルダツリー上で表示 */
(function () {
  'use strict';

  const DB_VIEW_TYPES = new Set(['database', 'db', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form']);

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/g, '');
  }

  function _activePaneId(event) {
    const paneEl = event?.target?.closest?.('.gb-pane[data-pane-id]');
    return paneEl?.dataset?.paneId || (typeof GBLayout !== 'undefined' ? GBLayout.activePane : '');
  }

  function _activeTab(event) {
    if (typeof GBTabs === 'undefined' || typeof GBTabs.getActiveTab !== 'function') return null;
    try { return GBTabs.getActiveTab(_activePaneId(event)); } catch { return null; }
  }

  function _statePath(key) {
    return (typeof state !== 'undefined' && state) ? state[key] || '' : '';
  }

  function _tabPath(tab, ...keys) {
    if (tab?.path) return tab.path;
    const tabState = tab?.state || {};
    for (const key of keys) {
      if (tabState[key]) return tabState[key];
    }
    return '';
  }

  function _currentRevealPath(hint, event) {
    const tab = _activeTab(event);
    const type = hint || tab?.type || '';
    if (type === 'entity') return _tabPath(tab, 'entityPath') || _statePath('currentEntityPath');
    if (type === 'page') return _tabPath(tab, 'pagePath') || _statePath('currentPagePath');
    if (type === 'board') return _tabPath(tab, 'boardPath') || _statePath('currentBoardPath');
    if (type === 'scriptnote') return _tabPath(tab, 'scenarioPath', 'scriptnotePath');
    if (type === 'smart-db') return _tabPath(tab, 'smartDbPath', 'dbPath') || _statePath('currentSmartDb')?._filePath || _statePath('currentDbPath');
    if (DB_VIEW_TYPES.has(type)) return _tabPath(tab, 'dbPath') || _statePath('currentDbPath');
    if (type === 'folder') return _tabPath(tab, 'folderPath') || (typeof _folderPath !== 'undefined' ? _folderPath : '');
    if (type === 'csv') return _tabPath(tab, 'csvPath') || (typeof _csvPath !== 'undefined' ? _csvPath : '');
    if (type === 'media') return _tabPath(tab, 'mediaPath', 'pagePath') || _statePath('currentPagePath');
    if (type === 'calendar') return (typeof _calRenderState !== 'undefined' ? _calRenderState?.dbPath || '' : '')
      || _tabPath(tab, 'calendarPath', 'dbPath')
      || _statePath('currentDbPath');
    return _tabPath(tab, 'path', 'dbPath', 'pagePath', 'boardPath', 'folderPath', 'csvPath', 'scenarioPath')
      || _statePath('currentEntityPath')
      || _statePath('currentPagePath')
      || _statePath('currentDbPath')
      || _statePath('currentBoardPath');
  }

  function _findOutlinerTab(options) {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function') return null;
    const panes = options?.activeOnly
      ? (GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [])
      : (GBLayout.getAllPanes(GBLayout.root) || []);
    for (const pane of panes) {
      const tab = (pane.tabs || []).find(t => t.type === 'outliner');
      if (tab) return { paneId: pane.id, tab };
    }
    return null;
  }

  function _captureActivePane() {
    if (typeof GBLayout === 'undefined') return null;
    const paneId = GBLayout.activePane || '';
    let tabId = '';
    if (paneId && typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function') {
      try { tabId = GBTabs.getActiveTab(paneId)?.id || ''; } catch {}
    }
    return { paneId, tabId };
  }

  function _restoreActivePane(snapshot) {
    if (!snapshot?.paneId || typeof GBLayout === 'undefined') return;
    if (snapshot.tabId && typeof GBTabs !== 'undefined' && typeof GBTabs.activateTab === 'function') {
      try {
        GBTabs.activateTab(snapshot.paneId, snapshot.tabId);
        return;
      } catch {}
    }
    try { GBLayout.setActivePane(snapshot.paneId); } catch {}
  }

  function _activatePanelsetGroupForPane(paneId) {
    if (!paneId || typeof GBLayout === 'undefined') return false;
    let changed = false;
    const containsPane = (node) => !!(node && typeof GBLayout.findNode === 'function' && GBLayout.findNode(node, paneId));
    const walk = (node) => {
      if (!node) return false;
      if (node.type === 'pane') return node.id === paneId;
      if (node.type === 'split' && Array.isArray(node.children)) {
        return node.children.some(child => walk(child));
      }
      if (node.type === 'panelset' && Array.isArray(node.groups)) {
        for (const group of node.groups) {
          if (!group?.root || !containsPane(group.root)) continue;
          if (node.activeGroupId !== group.id) {
            node.activeGroupId = group.id;
            changed = true;
          }
          walk(group.root);
          return true;
        }
      }
      return false;
    };
    walk(GBLayout.root);
    return changed;
  }

  function _activateOutlinerMatch(match, activeSnapshot) {
    if (!match?.paneId || !match?.tab?.id || typeof GBLayout === 'undefined') return false;
    try {
      const groupChanged = _activatePanelsetGroupForPane(match.paneId);
      let layoutChanged = groupChanged;
      if (typeof GBLayout.revealPane === 'function') {
        const revealed = GBLayout.revealPane(match.paneId, { deferRender: true, activate: false });
        layoutChanged = layoutChanged || revealed;
        if ((revealed || groupChanged) && typeof GBLayout.render === 'function') GBLayout.render();
      } else if (groupChanged && typeof GBLayout.render === 'function') {
        GBLayout.render();
      }
      if (typeof GBTabs !== 'undefined' && typeof GBTabs.activateTab === 'function') {
        GBTabs.activateTab(match.paneId, match.tab.id, { preserveActivePane: true });
      }
      if (layoutChanged && typeof GBLayout.saveLayout === 'function') GBLayout.saveLayout({ immediate: true });
      if (activeSnapshot?.paneId && GBLayout.activePane !== activeSnapshot.paneId) {
        _restoreActivePane(activeSnapshot);
      }
      return true;
    } catch {
      return false;
    }
  }

  function _createOutlinerPane(activeSnapshot) {
    if (typeof GBLayout === 'undefined' || typeof GBTabs === 'undefined') return false;
    if (typeof GBLayout.createPaneNode !== 'function' || typeof GBLayout.splitPane !== 'function' || typeof GBTabs.createTab !== 'function') return false;
    const sourcePaneId = activeSnapshot?.paneId || GBLayout.activePane || GBLayout.findFirstPane?.(GBLayout.root)?.id || '';
    if (!sourcePaneId) return false;
    const tab = GBTabs.createTab('フォルダツリー', 'outliner', '');
    const pane = GBLayout.createPaneNode(null, [tab], 0);
    const paneId = GBLayout.splitPane(sourcePaneId, 'horizontal', 'left', pane, { skipHistory: true });
    if (!paneId) return false;
    _restoreActivePane(activeSnapshot);
    return true;
  }

  function _wouldReplaceActiveTab(match, activeSnapshot) {
    return !!(match?.paneId && activeSnapshot?.paneId
      && match.paneId === activeSnapshot.paneId
      && activeSnapshot.tabId
      && match.tab?.id !== activeSnapshot.tabId);
  }

  function _hasOutlinerNodes() {
    return !!document.querySelector('#outliner-tree .tree-node, #body-home .tree-node');
  }

  function _ensureSidebarOutlinerVisible() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return false;
    sidebar.style.display = 'flex';
    sidebar.classList.add('open');
    return true;
  }

  function _ensureOutlinerVisible(activeSnapshot) {
    if (_hasOutlinerNodes() && _ensureSidebarOutlinerVisible()) return true;
    const visible = _findOutlinerTab({ activeOnly: true });
    if (visible && !_wouldReplaceActiveTab(visible, activeSnapshot) && _activateOutlinerMatch(visible, activeSnapshot)) return true;
    if (_createOutlinerPane(activeSnapshot)) return true;
    const existing = activeSnapshot?.paneId ? null : _findOutlinerTab();
    if (existing && _activateOutlinerMatch(existing, activeSnapshot)) return true;
    return _ensureSidebarOutlinerVisible();
  }

  function _findTreeNode(path) {
    const target = _normalizePath(path);
    if (!target) return null;
    for (const candidate of _candidateRevealPaths(target)) {
      const node = _findTreeNodeExact(candidate);
      if (node) return node;
    }
    return null;
  }

  function _findTreeNodeExact(path) {
    const target = _normalizePath(path);
    if (!target) return null;
    if (typeof _findTreeNodeByPath === 'function') {
      const node = _findTreeNodeByPath(target);
      if (node) return node;
    }
    const nodes = document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #sidebar .tree-node');
    for (const node of nodes) {
      const nodePath = _normalizePath(node._nodeData?.path || node.dataset?.path || '');
      if (nodePath === target) return node;
    }
    return null;
  }

  function _isAbsoluteRevealPath(path) {
    const text = _normalizePath(path);
    return /^[A-Za-z]:\//.test(text) || text.startsWith('/') || text.startsWith('//');
  }

  function _visibleRootPaths() {
    const roots = [];
    document.querySelectorAll('#outliner-tree > .tree-node, #body-home > .tree-node').forEach(node => {
      const path = _normalizePath(node._nodeData?.path || node.dataset?.path || '');
      if (path && !roots.includes(path)) roots.push(path);
    });
    return roots;
  }

  function _candidateRevealPaths(path) {
    const raw = _normalizePath(path);
    if (!raw) return [];
    const variants = [raw];
    if (/\.md$/i.test(raw)) variants.push(raw.replace(/\.md$/i, ''));
    const roots = _visibleRootPaths();
    const out = [];
    const add = value => {
      const normalized = _normalizePath(value);
      if (normalized && !out.includes(normalized)) out.push(normalized);
    };
    variants.forEach(add);
    roots.forEach(root => {
      const rootName = root.split('/').filter(Boolean).pop() || '';
      variants.forEach(variant => {
        if (!_isAbsoluteRevealPath(variant)) add(root + '/' + variant);
        if (_isAbsoluteRevealPath(variant) && variant.startsWith(root + '/')) add(variant.slice(root.length + 1));
        if (rootName && variant === rootName) add(root);
        if (rootName && variant.startsWith(rootName + '/')) add(root + variant.slice(rootName.length));
      });
    });
    return out;
  }

  function _pathPrefixes(path) {
    const parts = _normalizePath(path).split('/').filter(Boolean);
    const prefixes = [];
    for (let i = 1; i <= parts.length; i++) prefixes.push(parts.slice(0, i).join('/'));
    return prefixes;
  }

  function _nodeChildrenContainer(node) {
    return node?.querySelector?.(':scope > .tree-children') || null;
  }

  async function _waitForTreeNodeChildren(node) {
    const children = _nodeChildrenContainer(node);
    const toggle = node?.querySelector?.(':scope > .tree-node-row .tree-toggle');
    if (!children || children.dataset.loaded === 'true' || toggle?.dataset.expanded !== 'true') return;
    for (let i = 0; i < 30; i++) {
      await _sleep(50);
      if (!node.isConnected || toggle.dataset.expanded !== 'true' || children.dataset.loaded === 'true') return;
    }
  }

  async function _expandTreeNode(node) {
    if (!node) return false;
    const toggle = node.querySelector(':scope > .tree-node-row .tree-toggle');
    const children = _nodeChildrenContainer(node);
    if (!toggle || !children) return false;
    if (toggle.dataset.expanded !== 'true') {
      toggle.click();
      await _waitForTreeNodeChildren(node);
      return true;
    }
    children.classList.remove('collapsed');
    await _waitForTreeNodeChildren(node);
    return false;
  }

  async function _expandTreeNodeAncestors(node) {
    const ancestors = [];
    let parent = node?.parentElement || null;
    while (parent) {
      const ancestor = parent.closest?.('.tree-node') || null;
      if (!ancestor) break;
      ancestors.push(ancestor);
      parent = ancestor.parentElement;
    }
    ancestors.reverse();
    for (const ancestor of ancestors) {
      await _expandTreeNode(ancestor);
    }
  }

  async function _expandTreeToPath(path) {
    for (const candidate of _candidateRevealPaths(path)) {
      let exact = _findTreeNodeExact(candidate);
      if (exact) {
        await _expandTreeNodeAncestors(exact);
        return exact;
      }
      for (const prefix of _pathPrefixes(candidate)) {
        const node = _findTreeNodeExact(prefix);
        if (!node) continue;
        await _expandTreeNode(node);
        exact = _findTreeNodeExact(candidate);
        if (exact) {
          await _expandTreeNodeAncestors(exact);
          return exact;
        }
      }
      exact = _findTreeNodeExact(candidate);
      if (exact) {
        await _expandTreeNodeAncestors(exact);
        return exact;
      }
    }
    return null;
  }

  async function _ensureOutlinerLoadedIfEmpty() {
    if (_hasOutlinerNodes()) return;
    if (typeof loadOutliner === 'function') {
      try { await Promise.resolve(loadOutliner()); } catch {}
    }
  }

  function _selectTreeNode(node, options) {
    if (!node) return false;
    document.querySelectorAll('.tree-node-row.active').forEach(row => row.classList.remove('active'));
    const row = node.querySelector('.tree-node-row');
    if (row) {
      row.classList.add('active');
      row.scrollIntoView({ block: 'nearest' });
      if (!options?.preserveFocus) row.focus?.({ preventScroll: true });
    }
    if (typeof treeSelection !== 'undefined' && treeSelection) {
      treeSelection.clear();
      treeSelection.add(node);
      treeSelection.lastClicked = node;
    }
    return true;
  }

  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function revealCurrentInFolderTree(hint, event) {
    const activeSnapshot = _captureActivePane();
    const path = _normalizePath(_currentRevealPath(hint, event));
    if (!path) {
      if (typeof showStatus === 'function') showStatus('現在の項目の場所を特定できません', true);
      return false;
    }
    if (!_ensureOutlinerVisible(activeSnapshot)) {
      if (typeof showStatus === 'function') showStatus('フォルダツリーを開けませんでした', true);
      return false;
    }
    await _ensureOutlinerLoadedIfEmpty();
    const expandedNode = await _expandTreeToPath(path);
    if (expandedNode && _selectTreeNode(expandedNode, { preserveFocus: true })) {
      if (activeSnapshot?.paneId && typeof GBLayout !== 'undefined' && GBLayout.activePane !== activeSnapshot.paneId) {
        _restoreActivePane(activeSnapshot);
      }
      return true;
    }
    for (let i = 0; i < 30; i++) {
      const node = _findTreeNode(path);
      if (node && _selectTreeNode(node, { preserveFocus: true })) {
        if (activeSnapshot?.paneId && typeof GBLayout !== 'undefined' && GBLayout.activePane !== activeSnapshot.paneId) {
          _restoreActivePane(activeSnapshot);
        }
        return true;
      }
      await _sleep(100);
    }
    if (typeof showStatus === 'function') showStatus('フォルダツリーで表示できませんでした', true);
    return false;
  }

  window.revealCurrentInFolderTree = revealCurrentInFolderTree;
  window.getCurrentFolderTreeRevealPath = (hint, event) => _currentRevealPath(hint, event);
})();
