// gb-pane-default-layout.js — Meldex standard initial pane layout
(function() {
  'use strict';

  const DEFAULT_LEFT_DOCK_WIDTH_PX = 260;
  const DEFAULT_RIGHT_DOCK_WIDTH_PX = 360;
  const DEFAULT_MIN_WORK_WIDTH_PX = 400;
  // 右レールの既定パネル一覧（gb-layout.js の FIXED_RAIL_RIGHT_DEFAULTS と同じ並び）。
  // 片方だけに項目を足すと、初期レイアウトと欠損補填で並びがずれる。
  const UTILITY_PANE_TYPES = new Set([
    'outliner', 'detail', 'preview', 'subpanel', 'chat', 'timer',
    'history', 'annotation', 'sticky', 'tags', 'search', 'version',
  ]);

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
    const leftRatio = leftWidth / totalWidth;
    const remainingWidth = Math.max(1, totalWidth - leftWidth);
    const workRatio = Math.max(1, remainingWidth - rightWidth) / remainingWidth;
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

  function _panelset(roots, activeIndex, options) {
    const groups = (Array.isArray(roots) ? roots : []).filter(Boolean).map(root => _group(root));
    const activeGroup = groups[Math.max(0, Math.min(groups.length - 1, activeIndex || 0))];
    const dock = (typeof GBPanelSet !== 'undefined' && typeof GBPanelSet.createPanelSetNode === 'function')
      ? GBPanelSet.createPanelSetNode(groups, activeGroup?.id)
      : {
          type: 'panelset',
          id: _fallbackId('panelset-default-fixed'),
          groups,
          activeGroupId: activeGroup?.id || null,
        };
    dock.collapsed = !!options?.collapsed;
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

  function _activeTabType(pane) {
    const tab = pane?.tabs?.[pane.activeTabIndex];
    return tab?.type || '';
  }

  function _isContentPane(pane) {
    const type = _activeTabType(pane);
    return !type || !UTILITY_PANE_TYPES.has(type);
  }

  function resolveMainPaneId(options) {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function') return '';
    const opts = options || {};
    const root = opts.root || GBLayout.root;
    const allPanes = GBLayout.getAllPanes(root) || [];
    const visiblePanes = GBLayout.getAllPanes(root, { activeOnly: true }).filter((pane) => {
      if (!pane?.id) return false;
      return typeof GBLayout.isPaneVisible === 'function' ? GBLayout.isPaneVisible(pane.id) : true;
    });
    const isUsable = (pane) => pane?.id && (opts.allowLocked || !pane.locked);
    const pick = (...candidates) => {
      for (const pane of candidates) {
        if (isUsable(pane)) return pane.id;
      }
      return '';
    };
    return pick(
      visiblePanes.find(pane => pane.meldexRole === 'main' && _isContentPane(pane)),
      visiblePanes.find(pane => pane.id === 'pane-main' && _isContentPane(pane)),
      visiblePanes.find(_isContentPane),
      allPanes.find(pane => pane.meldexRole === 'main' && _isContentPane(pane)),
      allPanes.find(pane => pane.id === 'pane-main' && _isContentPane(pane)),
      allPanes.find(_isContentPane),
      opts.contentOnly ? null : visiblePanes[0],
      opts.contentOnly ? null : allPanes[0],
    );
  }

  function build(options) {
    if (typeof GBLayout === 'undefined' || typeof GBTabs === 'undefined') return null;
    const mainPane = options?.mainPane || GBLayout.createPaneNode('pane-main', [], -1);
    const ratios = _dockRatios();

    mainPane.meldexRole = 'main';
    mainPane.tabs = [_tab('フォルダ', 'folder')];
    mainPane.activeTabIndex = 0;

    const leftPane = _pane([_tab('フォルダツリー', 'outliner')]);
    leftPane.meldexRole = 'left-sidebar';
    const leftDock = _dock(leftPane, { collapsed: false, popupWidth: ratios.leftWidth });
    leftDock.meldexRole = 'left-sidebar';

    const rightPanes = [
      _pane([_tab('オプション', 'detail')]),
      _pane([_tab('ビューワー', 'preview')]),
      _pane([_tab('サブパネル', 'subpanel')]),
      _pane([_tab('バージョン管理', 'version')]),
      _pane([_tab('チャット', 'chat')]),
      _pane([_tab('タイマー', 'timer')]),
      _pane([_tab('ヒストリー', 'history')]),
      _pane([_tab('注釈', 'annotation')]),
      _pane([_tab('タグ', 'tags')]),
    ];
    rightPanes.forEach(pane => { pane.meldexRole = 'right-sidebar'; });
    const rightDock = _panelset(rightPanes, 0, { collapsed: false, popupWidth: ratios.rightWidth });
    rightDock.meldexRole = 'right-sidebar';

    const workDock = _dock(mainPane, { collapsed: false });
    workDock.meldexRole = 'main';
    const contentSplit = GBLayout.createSplitNode('horizontal', ratios.workRatio, [workDock, rightDock]);
    const rootSplit = GBLayout.createSplitNode('horizontal', ratios.leftRatio, [leftDock, contentSplit]);

    GBLayout.root = rootSplit;
    if (typeof GBLayout.revealPane === 'function') {
      GBLayout.revealPane(mainPane.id, { activate: true, deferRender: true });
    }
    GBLayout.render();
    GBLayout.setActivePane(mainPane.id);
    if (!options?.skipSave) GBLayout.saveLayout();
    return { root: rootSplit, activePaneId: mainPane.id, ratios };
  }

  window.GBPaneDefaultLayout = {
    build,
    resolveMainPaneId,
    constants: {
      DEFAULT_LEFT_DOCK_WIDTH_PX,
      DEFAULT_RIGHT_DOCK_WIDTH_PX,
      DEFAULT_MIN_WORK_WIDTH_PX,
    },
  };
})();
