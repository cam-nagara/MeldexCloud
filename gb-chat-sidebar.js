/* チャット専用サイドバー。既存の右サイドバーとそのレールの外側に置く。 */
(function () {
  'use strict';
  let initialStateApplied = false;
  let returnPaneId = '';
  function workPaneId(root, dock) {
    const chatPanes = new Set(GBLayout.getAllPanes(dock).map(pane => pane.id));
    const panes = GBLayout.getAllPanes(root);
    return panes.find(pane => pane.id === returnPaneId && !chatPanes.has(pane.id))?.id
      || panes.find(pane => pane.meldexRole === 'main')?.id;
  }
  function widths(node, width) {
    if (node.direction !== 'horizontal') return [width, width];
    const available = Math.max(1, width - 4);
    const size = child => child.meldexRole === 'chat-sidebar' ? 0 : 32;
    if (node.children[0].collapsed) return [size(node.children[0]), available - size(node.children[0])];
    if (node.children[1].collapsed) return [available - size(node.children[1]), size(node.children[1])];
    return [available * node.ratio, available * (1 - node.ratio)];
  }
  function preserveRailWidths(node, before, after) {
    if (node.type === 'panelset') {
      if (!['left-sidebar', 'right-sidebar'].includes(node.meldexRole)) node.groups.forEach(group => preserveRailWidths(group.root, before, after));
    } else if (node.type === 'split') {
      const old = widths(node, before);
      if (node.direction === 'horizontal') node.children.forEach((child, index) => {
        if (!child.collapsed && ['left-sidebar', 'right-sidebar'].includes(child.meldexRole)) {
          const fraction = Math.max(.05, Math.min(.9, old[index] / Math.max(1, after - 4)));
          node.ratio = index === 0 ? fraction : 1 - fraction;
        }
      });
      const next = widths(node, after);
      node.children.forEach((child, index) => preserveRailWidths(child, old[index], next[index]));
    }
  }
  function closeInitially(root, dock) {
    function visit(node, width) {
      if (node.type === 'split') {
        const sizes = widths(node, width);
        const index = node.children.indexOf(dock);
        if (index >= 0 && node.direction === 'horizontal') {
          dock._savedRatio = node.ratio;
          preserveRailWidths(node.children[1 - index], sizes[1 - index], Math.max(1, width - 4));
        } else node.children.forEach((child, i) => visit(child, sizes[i]));
      } else if (node.type === 'panelset') node.groups.forEach(group => visit(group.root, width));
    }
    if (!dock.collapsed) visit(root, (typeof document !== 'undefined' && document.getElementById('gb-layout-root')?.clientWidth) || window.innerWidth);
    dock.collapsed = true;
    if (window.innerWidth <= 768 && GBLayout.getAllPanes(dock).some(pane => pane.id === GBLayout.activePane)) {
      const paneId = workPaneId(root, dock);
      if (paneId) GBLayout.revealPane(paneId, { activate: true, deferRender: true, preserveCollapsed: true });
    }
  }
  function ensure(root) {
    if (!root || window._gbSingleWindow || typeof GBPanelSet === 'undefined') return root;
    let dock = null;
    let chatTab = null;
    function walk(node) {
      if (!node) return;
      if (node.meldexRole === 'chat-sidebar' && node.type === 'panelset') { dock = node; return; }
      if (node.type === 'pane') {
        if (!(node.tabs || []).some(tab => tab.type === 'chat')) return;
        const active = node.tabs?.[node.activeTabIndex];
        (node.tabs || []).forEach(tab => { if (tab.type === 'chat') chatTab ||= tab; });
        node.tabs = (node.tabs || []).filter(tab => tab.type !== 'chat');
        node.activeTabIndex = Math.max(0, node.tabs.indexOf(active));
        if (!node.tabs.length) node.activeTabIndex = -1;
      }
      if (node.type === 'split') node.children.forEach(walk);
      if (node.type === 'panelset') {
        const chatGroups = new Set(node.groups.filter(group => GBLayout.getAllPanes(group.root).some(pane => pane.tabs?.some(tab => tab.type === 'chat'))));
        node.groups.forEach(group => walk(group.root));
        node.groups = node.groups.filter(group => !chatGroups.has(group) || GBLayout.getAllPanes(group.root).some(pane => pane.tabs?.length));
        if (!node.groups.some(group => group.id === node.activeGroupId)) node.activeGroupId = node.groups[0]?.id;
      }
    }
    walk(root);
    if (dock) {
      // 保存レイアウトでチャットタブだけが欠けても、右レールの入口を空にしない。
      let group = dock.groups.find(item => GBLayout.getAllPanes(item.root).some(pane => pane.tabs?.some(tab => tab.type === 'chat')));
      if (!group) {
        const pane = GBLayout.createPaneNode(null, [chatTab || GBTabs.createTab('チャット', 'chat', '')], 0);
        pane.meldexRole = 'chat-sidebar';
        group = GBPanelSet.createGroup(pane);
        dock.groups.push(group);
      }
      dock.activeGroupId = group.id;
      if (!initialStateApplied) closeInitially(root, dock);
      initialStateApplied = true;
      return root;
    }
    const tab = chatTab || GBTabs.createTab('チャット', 'chat', '');
    const pane = GBLayout.createPaneNode(null, [tab], 0);
    pane.meldexRole = 'chat-sidebar';
    const group = GBPanelSet.createGroup(pane);
    dock = GBPanelSet.createPanelSetNode([group], group.id);
    dock.meldexRole = 'chat-sidebar';
    dock.defaultPopupWidth = 380;
    dock.collapsed = true;
    initialStateApplied = true;
    return GBLayout.createSplitNode('horizontal', Math.max(.5, 1 - 380 / Math.max(800, window.innerWidth)), [root, dock]);
  }
  function currentDock() {
    function find(node) {
      if (!node) return null;
      if (node.meldexRole === 'chat-sidebar' && node.type === 'panelset') return node;
      const children = node.type === 'panelset' ? node.groups.map(group => group.root) : node.children || [];
      return children.map(find).find(Boolean);
    }
    return find(GBLayout.root);
  }
  function close() {
    const dock = currentDock();
    if (dock && window.innerWidth <= 768) {
      const paneId = workPaneId(GBLayout.root, dock);
      if (paneId) GBLayout.revealPane(paneId, { activate: true, deferRender: true, preserveCollapsed: true });
      GBLayout.render();
      GBLayout.saveLayout({ immediate: true });
      window.MeldexCloudMobileEditBar?.refresh?.();
      return;
    }
    if (dock) GBLayout.setNodeCollapsed(dock.id, true);
    window.MeldexCloudMobileEditBar?.refresh?.();
  }
  function open() {
    const dock = currentDock();
    if (!dock) return false;
    if (window.innerWidth <= 768) {
      const pane = GBLayout.getAllPanes(dock).find(item => item.tabs?.some(tab => tab.type === 'chat'));
      if (!pane) return false;
      if (GBLayout.activePane !== pane.id) returnPaneId = GBLayout.activePane;
      GBLayout.revealPane(pane.id, { activate: true, userIntent: true, deferRender: true, preserveCollapsed: true });
      GBLayout.render();
      GBLayout.saveLayout({ immediate: true });
    } else GBLayout.setNodeCollapsed(dock.id, false);
    window.MeldexCloudMobileEditBar?.refresh?.();
    return true;
  }
  function toggle() {
    const dock = currentDock();
    if (dock && !isOpen()) open();
    else if (dock) close();
  }
  function isOpen() {
    const dock = currentDock();
    return !!dock && (window.innerWidth <= 768
      ? GBLayout.getAllPanes(dock).some(pane => pane.id === GBLayout.activePane)
      : !dock.collapsed);
  }
  window.GBChatSidebar = { ensure, open, close, toggle, isOpen };
})();
