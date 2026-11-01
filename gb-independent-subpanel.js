/* A saved, independent editor column between the work area and the inspector. */
(function () {
  'use strict';
  const ROLE = 'subpanel-workspace';
  function find(node) {
    if (!node) return null;
    if (node.meldexRole === ROLE) return node;
    const children = node.type === 'panelset' ? (node.groups || []).map(g => g.root) : node.children || [];
    return children.map(find).find(Boolean) || null;
  }
  function ensure(root) {
    if (!root || window._gbSingleWindow || typeof GBPanelSet === 'undefined' || find(root)) return root;
    const backup = JSON.stringify(root);
    // Build the migration off the live tree so a failed conversion cannot remove tabs.
    root = JSON.parse(backup);
    let tab = null, wasOpen = false;
    function remove(node) {
      if (node.type === 'pane') {
        const active = node.tabs?.[node.activeTabIndex];
        tab ||= node.tabs?.find(t => t.type === 'subpanel');
        node.tabs = (node.tabs || []).filter(t => t.type !== 'subpanel');
        node.activeTabIndex = node.tabs.length ? Math.max(0, node.tabs.indexOf(active)) : -1;
      } else if (node.type === 'split') node.children.forEach(remove);
      else if (node.type === 'panelset') {
        const selected = node.groups.find(g => g.id === node.activeGroupId);
        if (node.meldexRole === 'right-sidebar') {
          wasOpen ||= !node.collapsed && GBLayout.getAllPanes(selected?.root).some(p => p.tabs?.[p.activeTabIndex]?.type === 'subpanel');
        }
        const oldGroups = new Set(node.groups.filter(g => GBLayout.getAllPanes(g.root).some(p => p.tabs?.some(t => t.type === 'subpanel'))));
        node.groups.forEach(g => remove(g.root));
        node.groups = node.groups.filter(g => !oldGroups.has(g) || GBLayout.getAllPanes(g.root).some(p => p.tabs?.length));
        if (!node.groups.some(g => g.id === node.activeGroupId)) node.activeGroupId = node.groups[0]?.id || null;
      }
    }
    try {
      const key = 'gb:layout:backup-pre-independent-subpanel';
      if (!localStorage.getItem(key)) localStorage.setItem(key, backup);
    } catch { /* Storage unavailable: keep the in-memory layout usable. */ }
    remove(root);
    const pane = GBLayout.createPaneNode(null, [tab || GBTabs.createTab('サブパネル', 'subpanel', '')], 0);
    pane.meldexRole = ROLE;
    const group = GBPanelSet.createGroup(pane);
    const dock = GBPanelSet.createPanelSetNode([group], group.id);
    dock.meldexRole = ROLE;
    dock.defaultPopupWidth = 440;
    dock.collapsed = !wasOpen;
    function insert(node) {
      if (node.type === 'split') {
        const index = node.children.findIndex(child => child.meldexRole === 'right-sidebar');
        if (index >= 0) {
          const work = node.children[1 - index];
          node.children[1 - index] = GBLayout.createSplitNode('horizontal', .6, [work, dock]);
          return true;
        }
        return node.children.some(insert);
      }
      return node.type === 'panelset' && node.groups.some(g => insert(g.root));
    }
    return insert(root) ? root : GBLayout.createSplitNode('horizontal', .65, [root, dock]);
  }
  function current() { return typeof GBLayout !== 'undefined' ? find(GBLayout.root) : null; }
  function open() {
    const dock = current();
    if (!dock) return false;
    if (dock.collapsed) GBLayout.setNodeCollapsed(dock.id, false);
    return true;
  }
  async function close() {
    const dock = current();
    if (!dock || dock.collapsed) return true;
    if (window.GBSubPanel?.flush) {
      if (await window.GBSubPanel.flush() === false) return false;
    } else if (await window.GBEditorHost?.flushSurface?.('subpanel') === false) return false;
    GBLayout.setNodeCollapsed(dock.id, true);
    window.GBEditorHost?.returnToMain?.();
    return true;
  }
  window.GBIndependentSubpanel = { ensure, open, close, isOpen: () => !!current() && !current().collapsed,
    toggle: () => current()?.collapsed ? open() : close() };
})();
