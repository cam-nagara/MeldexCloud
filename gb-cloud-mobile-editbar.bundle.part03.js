    document.addEventListener('focusout', () => { if (_isEnabled()) setTimeout(_scheduleRefresh, 80); });
    document.addEventListener('input', (event) => {
      if (!_isEnabled()) return;
      if (_editableFromNode(event.target)) _saveSelection();
      if (_chatInputFromNode(event.target)) _activeChatInput = event.target;
      if (_plainInputFromNode(event.target)) _activePlainInput = event.target;
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        _closeMenuSheet();
        _closeOverflowSheet();
      }
    });
    new MutationObserver(_scheduleRefresh).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-cloud-mode', 'data-cloud-mobile', 'data-cloud-mobile-keyboard', 'data-cloud-mobile-editing-ui'],
      childList: true,
    });
    const mainViews = document.getElementById('main-views');
    if (mainViews) {
      // ツールバーのあふれ判定は測り直しのたびに隠しクラスを外して付け直す。
      // その出し入れだけでは更新しない（拾うとあふれ判定と互いに起こし合って止まらない）。
      new MutationObserver((records) => {
        if (records.some(record => !_isToolbarOverflowClassToggle(record))) _scheduleRefresh();
      }).observe(mainViews, {
        attributes: true,
        attributeFilter: ['style', 'class'],
        attributeOldValue: true,
        subtree: true,
      });
    }
    const annToolbar = document.getElementById('ann-toolbar');
    if (annToolbar) {
      annToolbar.addEventListener('click', () => setTimeout(_scheduleRefresh, 0), true);
      new MutationObserver((records) => {
        if (records.some(record => !_isToolbarOverflowClassToggle(record))) _scheduleRefresh();
      }).observe(annToolbar, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        attributeOldValue: true,
        subtree: true,
      });
    }
    document.getElementById('btn-overlay-toggle')?.addEventListener('click', () => setTimeout(_scheduleRefresh, 0), true);
    _scheduleRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bind, { once: true });
  else _bind();

  window.MeldexCloudMobileEditBar = {
    refresh: _refresh,
    openMenu: _openMenuSheet,
    openToolMenu: _openToolMenuSheet,
    closeMenu: _closeMenuSheet,
    closeOverflow: _closeOverflowSheet,
  };
})();
