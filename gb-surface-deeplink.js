(function (global) {
  'use strict';

  const ALLOWED = new Set([
    'tabs', 'chat', 'links', 'checkboxes', 'context-menu',
    'edge-navigation', 'right-sidebar', 'sticky',
  ]);

  function _visible(selector) {
    return [...document.querySelectorAll(selector)].find(el => el.getClientRects().length > 0) || null;
  }

  function _unavailable(surface, message) {
    const text = message || '移動先を開けませんでした。Meldexで対象ファイルを開いてから、もう一度お試しください。';
    if (typeof global.showStatus === 'function') global.showStatus(text, true);
    return { handled: false, surface, reason: 'target-unavailable', message: text };
  }

  function _handled(surface, target) {
    if (!target || target.getClientRects().length === 0) {
      return _unavailable(surface);
    }
    document.documentElement.dataset.meldexContinueSurface = surface;
    return { handled: true, surface, target: target.dataset.e2eId || target.id || target.className || target.tagName };
  }

  function _nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function _layoutApi() {
    return typeof GBLayout !== 'undefined' ? GBLayout : global.GBLayout;
  }

  function _tabsApi() {
    return typeof GBTabs !== 'undefined' ? GBTabs : global.GBTabs;
  }

  function _defaultLayoutApi() {
    return typeof GBPaneDefaultLayout !== 'undefined' ? GBPaneDefaultLayout : global.GBPaneDefaultLayout;
  }

  async function apply(surface) {
    const target = String(surface || '').trim();
    if (!ALLOWED.has(target)) return { handled: false, reason: 'not-allowed' };
    if (target === 'chat') {
      openRightPanelTab('chat');
      return _handled(target, _visible('#rp-chat,.rp-tab[data-rp-tab="chat"]'));
    }
    else if (target === 'links') {
      openRightPanelTab('detail');
      if (typeof switchDetailTab === 'function') switchDetailTab('backlinks');
      return _handled(target, _visible('#detail-backlinks,.detail-tab[data-tab="backlinks"],#rp-detail'));
    } else if (target === 'checkboxes') {
      if (typeof openSearchPanel !== 'function') return _unavailable(target, 'チェック項目を編集できる検索パネルを開けませんでした。');
      openSearchPanel({ surface: 'main' });
      return _handled(target, _visible('#search-panel input[type="checkbox"]'));
    } else if (target === 'right-sidebar') {
      openRightPanelTab('detail');
      return _handled(target, _visible('#rp-detail,.rp-tab[data-rp-tab="detail"]'));
    } else if (target === 'sticky') {
      openRightPanelTab('annotation');
      const toolbar = document.getElementById('ann-toolbar');
      if (!toolbar?.classList.contains('visible') && typeof toggleAnnotationToolbar === 'function') toggleAnnotationToolbar();
      const sticky = _visible('#ann-toolbar .ann-tool[data-tool="sticky"]');
      if (!sticky) return _unavailable(target, '注釈を開きました。対象ファイルを選び、付箋を選択してください。');
      sticky.click();
      return _handled(target, sticky);
    }
    else if (target === 'tabs') {
      const layout = _layoutApi();
      const tabs = _tabsApi();
      const defaults = _defaultLayoutApi();
      let paneId = defaults?.resolveMainPaneId?.({ contentOnly: true })
        || layout?.activePane
        || layout?.findFirstPane?.(layout?.root)?.id;
      if (!paneId && defaults?.build && !document.documentElement.dataset.singleWindow) {
        paneId = defaults.build()?.activePaneId || layout?.activePane;
      }
      let paneNode = paneId ? layout?.findNode?.(layout.root, paneId)?.node : null;
      if (paneId && paneNode && !(paneNode.tabs || []).length && tabs?.addTab) {
        const tabId = tabs.addTab(paneId, 'フォルダ', 'folder', '', null, { preferTargetPane: true });
        paneId = tabs.findPaneIdForTab?.(tabId) || paneId;
        paneNode = layout?.findNode?.(layout.root, paneId)?.node || paneNode;
      }
      if (paneId && layout?.revealPane) {
        layout.revealPane(paneId, { activate: true, userIntent: true });
        if (!layout.refreshPaneTabs?.(paneId)) layout.render?.();
        await _nextFrame();
      }
      let pane = paneId ? layout?.paneMap?.[paneId]?.el : null;
      let tab = pane ? [...pane.querySelectorAll('.gb-pane-tabs .gb-tab[data-tab-id]')].find(el => el.getClientRects().length > 0) : null;
      if (!tab) return _unavailable(target, '操作できるタブがありません。ファイルを開いてから、もう一度お試しください。');
      tab.click();
      if (!tab.hasAttribute('tabindex')) tab.tabIndex = 0;
      tab.focus();
      return _handled(target, tab);
    } else if (target === 'context-menu') {
      const row = _visible('.tree-node[data-path] > .tree-node-row');
      if (!row) return _unavailable(target, 'メニューを開く項目がありません。ファイル一覧から項目を選んでください。');
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 24, clientY: 24 }));
      return _handled(target, _visible('.gb-context-menu'));
    } else if (target === 'edge-navigation') {
      if (typeof openSearchPanel !== 'function') return _unavailable(target, 'ナビゲーションを開けませんでした。');
      openSearchPanel({ surface: 'main' });
      return _handled(target, _visible('#search-panel'));
    }
    return _unavailable(target);
  }

  async function applyFromLocation() {
    const url = new URL(global.location.href);
    const target = url.searchParams.get('continue');
    if (!target) return { handled: false, reason: 'not-requested' };
    try {
      let result;
      try {
        result = await apply(target);
      } catch (error) {
        const message = '移動先を開けませんでした。Meldexの準備完了後に、もう一度お試しください。';
        if (typeof global.showStatus === 'function') global.showStatus(message, true);
        result = { handled: false, surface: target, reason: 'target-error', message };
      }
      if (!result.handled && result.reason === 'not-allowed' && typeof global.showStatus === 'function') {
        global.showStatus('この移動先はMeldexから開けません。', true);
      }
      return result;
    } finally {
      url.searchParams.delete('continue');
      global.history.replaceState(global.history.state, '', url.pathname + url.search + url.hash);
    }
  }

  global.MeldexSurfaceDeepLink = Object.freeze({ allowed: Object.freeze([...ALLOWED]), apply, applyFromLocation });
})(window);
