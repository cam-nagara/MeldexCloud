// gb-pane-default-layout.js — Meldex standard initial pane layout
(function() {
  'use strict';

  const DEFAULT_LEFT_DOCK_WIDTH_PX = 260;
  const DEFAULT_RIGHT_DOCK_WIDTH_PX = 360;
  const DEFAULT_MIN_WORK_WIDTH_PX = 400;

  function _clampRatio(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function _layoutWidth() {
    const rootEl = document.getElementById('gb-layout-root');
    const raw = rootEl?.clientWidth || window.innerWidth || 1600;
    return Math.max(1, raw);
  }

  function _dockRatios() {
    const totalWidth = _layoutWidth();
    const minWorkWidth = Math.min(DEFAULT_MIN_WORK_WIDTH_PX, Math.max(260, totalWidth * 0.25));
    let leftWidth = DEFAULT_LEFT_DOCK_WIDTH_PX;
    let rightWidth = DEFAULT_RIGHT_DOCK_WIDTH_PX;
    const requiredWidth = leftWidth + rightWidth + minWorkWidth;
    if (requiredWidth > totalWidth) {
      const scale = Math.max(0.35, (totalWidth - minWorkWidth) / (leftWidth + rightWidth));
      leftWidth *= scale;
      rightWidth *= scale;
    }
    const leftRatio = _clampRatio(leftWidth / totalWidth, 0.08, 0.45);
    const remainingWidth = Math.max(1, totalWidth - leftWidth);
    const workRatio = _clampRatio((remainingWidth - rightWidth) / remainingWidth, 0.2, 0.9);
    return {
      leftRatio,
      workRatio,
      leftWidth: Math.round(leftWidth),
      rightWidth: Math.round(rightWidth),
    };
  }

  function _fallbackId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function _group(root) {
    if (typeof GBPanelSet !== 'undefined' && typeof GBPanelSet.createGroup === 'function') {
      return GBPanelSet.createGroup(root);
    }
    return { id: _fallbackId('group-default'), root };
  }

  function _dock(root, options) {
    const group = _group(root);
    const dock = (typeof GBPanelSet !== 'undefined' && typeof GBPanelSet.createPanelSetNode === 'function')
      ? GBPanelSet.createPanelSetNode([group], group.id)
      : {
          type: 'panelset',
          id: _fallbackId('panelset-default'),
          groups: [group],
          activeGroupId: group.id,
        };
    dock.collapsed = !!options?.collapsed;
    if (Number.isFinite(options?.popupWidth) && options.popupWidth > 0) {
      dock.defaultPopupWidth = Math.round(options.popupWidth);
    }
    return dock;
  }

  function _rightDock(rightTopRoot, rightBottomRoot, options) {
    const topGroup = _group(rightTopRoot);
    const bottomGroup = _group(rightBottomRoot);
    const dock = (typeof GBPanelSet !== 'undefined' && typeof GBPanelSet.createPanelSetNode === 'function')
      ? GBPanelSet.createPanelSetNode([topGroup, bottomGroup], topGroup.id)
      : {
          type: 'panelset',
          id: _fallbackId('panelset-default-right'),
          groups: [topGroup, bottomGroup],
          activeGroupId: topGroup.id,
        };
    dock.collapsed = true;
    if (Number.isFinite(options?.popupWidth) && options.popupWidth > 0) {
      dock.defaultPopupWidth = Math.round(options.popupWidth);
    }
    return dock;
  }

  function _tab(label, type) {
    return GBTabs.createTab(label, type, '');
  }

  function _pane(tabs) {
    return GBLayout.createPaneNode(null, tabs, 0);
  }

  function build(options) {
    if (typeof GBLayout === 'undefined' || typeof GBTabs === 'undefined') return null;
    const mainPane = options?.mainPane || GBLayout.createPaneNode('pane-main', [], -1);
    const ratios = _dockRatios();

    mainPane.tabs = [_tab('フォルダ', 'folder')];
    mainPane.activeTabIndex = 0;

    const leftDock = _dock(_pane([_tab('フォルダツリー', 'outliner')]), { collapsed: true, popupWidth: ratios.leftWidth });

    const viewerPane = _pane([_tab('ビューワー', 'preview'), _tab('タイマー', 'timer')]);
    const detailPane = _pane([_tab('オプション', 'detail'), _tab('バージョン管理', 'version')]);
    const rightTopSplit = GBLayout.createSplitNode('vertical', 0.3, [viewerPane, detailPane]);

    const rightBottomPane = _pane([
      _tab('チャット', 'chat'),
      _tab('カレンダー', 'calendar'),
      _tab('ヒストリー', 'history'),
      _tab('注釈', 'annotation'),
    ]);
    const rightDock = _rightDock(rightTopSplit, rightBottomPane, { popupWidth: ratios.rightWidth });

    const workDock = _dock(mainPane, { collapsed: false });
    const contentSplit = GBLayout.createSplitNode('horizontal', ratios.workRatio, [workDock, rightDock]);
    const rootSplit = GBLayout.createSplitNode('horizontal', ratios.leftRatio, [leftDock, contentSplit]);

    GBLayout.root = rootSplit;
    GBLayout.render();
    GBLayout.saveLayout();
    GBLayout.setActivePane(mainPane.id);
    return { root: rootSplit, activePaneId: mainPane.id, ratios };
  }

  window.GBPaneDefaultLayout = {
    build,
    constants: {
      DEFAULT_LEFT_DOCK_WIDTH_PX,
      DEFAULT_RIGHT_DOCK_WIDTH_PX,
      DEFAULT_MIN_WORK_WIDTH_PX,
    },
  };
})();
