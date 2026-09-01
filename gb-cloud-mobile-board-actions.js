(function () {
  if (window.__MeldexCloudMobileBoardActionsInstalled) return;
  window.__MeldexCloudMobileBoardActionsInstalled = true;
  let _annotationFab = null;

  function _callGlobal(name, arg) {
    const fn = window[name];
    if (typeof fn !== 'function') return false;
    const result = fn(arg);
    return result !== false && result !== null;
  }

  function _hasLineSelection() {
    try {
      return typeof bdGetSelectedConnectionIds === 'function' && bdGetSelectedConnectionIds().length > 0;
    } catch {
      return false;
    }
  }

  function _hasNodeSelection() {
    try {
      return typeof bd !== 'undefined' && bd?.selected instanceof Set && bd.selected.size > 0;
    } catch {
      return false;
    }
  }

  function _activateActivePaneTool(toolType) {
    try {
      const paneId = GBLayout?.activePane || '';
      const pane = GBLayout?.findNode?.(GBLayout.root, paneId)?.node;
      const tab = pane?.tabs?.find(item => item.type === toolType && !item.path);
      if (paneId && tab && typeof GBTabs?.activateTab === 'function') {
        GBTabs.activateTab(paneId, tab.id);
        return true;
      }
    } catch {}
    return false;
  }

  function _openVisibleToolTab(toolType) {
    if (_activateActivePaneTool(toolType)) return true;
    if (_callGlobal('addPanelMenuTool', toolType)) return true;
    return _callGlobal('openRightPanelTab', toolType);
  }

  function _ensureDetailShell() {
    const detail = document.getElementById('rp-detail');
    if (detail && typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detail);
    return detail;
  }

  function _refreshMobileBars() {
    try {
      window.MeldexCloudMobileEditBar?.refresh?.();
    } catch {}
    _refreshAnnotationFab();
  }

  function _renderIcon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 22) : '';
  }

  function _ensureAnnotationFab() {
    if (_annotationFab || !document.body) return _annotationFab;
    _annotationFab = document.createElement('button');
    _annotationFab.id = 'cloud-mobile-board-annotation-fab';
    _annotationFab.className = 'cloud-mobile-board-annotation-fab';
    _annotationFab.type = 'button';
    _annotationFab.setAttribute('aria-label', 'アノテートツールを開く');
    _annotationFab.innerHTML = `<span class="cloud-mobile-icon" aria-hidden="true">${_renderIcon('squarePen', 22)}</span>`;
    _annotationFab.addEventListener('click', openAnnotation);
    _annotationFab.hidden = true;
    document.body.appendChild(_annotationFab);
    return _annotationFab;
  }

  function _refreshAnnotationFab() {
    const fab = _ensureAnnotationFab();
    if (!fab || !document.body) return;
    const show = document.body.dataset.cloudMobileEditingUi === '1'
      && document.body.dataset.cloudMobileBoardbarOpen === '1'
      && document.body.dataset.cloudMobileAnnotationbarOpen !== '1'
      && document.body.dataset.cloudMobileKeyboard !== '1';
    fab.hidden = !show;
  }

  function _openActiveCardStyleManager() {
    if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
    if (typeof _bdEnsureBoardStyleManagerTabs === 'function') _bdEnsureBoardStyleManagerTabs();
    if (typeof showBoardTabs === 'function') showBoardTabs({ cardStyle: true, lineStyle: true, depthStyle: true });
    const el = document.getElementById('detail-tab-board-card-style');
    if (el && typeof _bdRenderStyleManagerInPanel === 'function') {
      el.innerHTML = '';
      _bdRenderStyleManagerInPanel('card', el, (typeof bd !== 'undefined' && bd?.activeCardStyle) || null);
    } else if (typeof bdOpenCardStyleManager === 'function') {
      bdOpenCardStyleManager();
      return;
    }
    if (typeof switchDetailTab === 'function') switchDetailTab('board-card-style');
  }

  function _styleTargetSelector(tabName) {
    if (tabName === 'board-line') return '[data-bd-conn-line-style-fields], [data-bd-selection-line-style-fields]';
    if (tabName === 'board-card') return '[data-bd-node-card-style-fields], [data-bd-selection-card-style-fields]';
    return '[data-bd-panel-fields]';
  }

  function _scrollStyleTargetIntoView(tabName) {
    const target = document.querySelector(_styleTargetSelector(tabName));
    if (!target) return false;
    target.closest?.('.bd-detail-section')?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
    return true;
  }

  function _switchBoardStyleTab(attempt) {
    _ensureDetailShell();
    if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
    if (typeof renderFileStyleTab === 'function') renderFileStyleTab('board');
    const line = _hasLineSelection();
    const node = _hasNodeSelection();
    if ((line || node) && typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    else if ((line || node) && typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
    if (typeof switchDetailTab === 'function' && line) {
      switchDetailTab('board-line');
    } else if (typeof switchDetailTab === 'function' && node) {
      switchDetailTab('board-card');
    } else {
      _openActiveCardStyleManager();
    }
    const tabName = line ? 'board-line' : (node ? 'board-card' : 'board-card-style');
    const active = document.querySelector(`[data-detail-tab="${tabName}"].active, [data-detail-tab="${tabName}"].gb-inner-tab-active`);
    const hasTarget = _scrollStyleTargetIntoView(tabName);
    if ((!active || !hasTarget) && attempt < 8) {
      setTimeout(() => {
        const current = document.querySelector('[data-detail-tab].active, [data-detail-tab].gb-inner-tab-active');
        if (current && current.dataset.detailTab !== tabName) return;
        _switchBoardStyleTab(attempt + 1);
      }, 80);
    }
  }

  function _bind() {
    _ensureAnnotationFab();
    _refreshAnnotationFab();
    if (!document.body) return;
    new MutationObserver(_refreshAnnotationFab).observe(document.body, {
      attributes: true,
      attributeFilter: [
        'data-cloud-mobile-boardbar-open',
        'data-cloud-mobile-annotationbar-open',
        'data-cloud-mobile-keyboard',
        'data-cloud-mobile-editing-ui',
        'data-cloud-mode',
        'data-mobile-ui-local',
      ],
    });
  }

  function openStyle() {
    const opened = _openVisibleToolTab('detail');
    _switchBoardStyleTab(0);
    return opened || true;
  }

  function _isAnnotationActive() {
    if (document.body?.classList?.contains('ann-toolbar-active')) return true;
    if (document.getElementById('ann-toolbar')?.classList?.contains('visible')) return true;
    try { return typeof ann !== 'undefined' && !!ann?.active; } catch { return false; }
  }

  function openAnnotation() {
    if (document.body?.dataset) {
      document.body.dataset.cloudMobileAnnotationRequested = '1';
      setTimeout(() => {
        delete document.body.dataset.cloudMobileAnnotationRequested;
        _refreshMobileBars();
      }, 2500);
    }
    if (!_isAnnotationActive()) _callGlobal('toggleAnnotationToolbar');
    document.getElementById('cloud-mobile-boardbar')?.setAttribute('hidden', '');
    document.dispatchEvent(new CustomEvent('meldex-cloud-mobile-board-annotation-request'));
    _refreshMobileBars();
    setTimeout(_refreshMobileBars, 80);
    setTimeout(_refreshMobileBars, 280);
    return true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bind, { once: true });
  else _bind();

  window.MeldexCloudMobileBoardActions = { openStyle, openAnnotation };
})();
