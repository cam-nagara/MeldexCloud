/* gb-dropdown-dismiss.js: shared outside-click dismissal for custom dropdowns */
(function () {
  'use strict';

  const DROPDOWN_SELECTORS = [
    '.cs-theme-ui-picker-menu',
    '.ab-dropdown',
    '.tool-menu-dropdown',
    '.status-dropdown',
    '.cell-inline-dd',
    '.user-dropdown',
    '.gb-context-menu',
    '#chat-title-dropdown',
  ];
  const SUPPORT_POPUP_SELECTORS = [
    '.gb-dock-popup',
    '.gb-palette-popup',
    '.gb-fmt-popup',
    '.sn2-header-popup',
    '._note-ctx-menu',
    // gb-mobile-tab-gesture-router.js のスマホ用タブ切替メニュー。位置制御の
    // ため document.body 直下に付く(親のタブバーの子ではない)ので、ここに
    // 加えないとメニュー項目タップの度に他の全ドロップダウン/gb-context-menu
    // (アイコンピッカー等)が誤って一括で閉じてしまう
    // （2026-08-13 バグ報告で確認）。
    '.gb-mobile-tab-menu',
  ];
  const TRIGGER_SELECTORS = [
    '[data-theme-ui-picker]',
    '[data-action*="Menu"]',
    '[data-action*="menu"]',
    '[data-action*="Dropdown"]',
    '[data-action*="dropdown"]',
    '[aria-haspopup="listbox"]',
    '[aria-haspopup="menu"]',
    '[aria-haspopup="dialog"]',
    '.tool-menu-btn',
    '.bd-style-trigger',
    '.bd-detail-style-trigger',
    '.bd-card-menu-btn',
    '[data-bd-action="pick-card-style"]',
    '[data-bd-action="pick-line-style"]',
    '#bd-card-style-select',
    '#bd-line-style-select',
  ];

  function _matchesAny(el, selectors) {
    if (!el?.closest) return false;
    try { return selectors.some(selector => !!el.closest(selector)); } catch { return false; }
  }

  function _dropdowns() {
    const set = new Set();
    DROPDOWN_SELECTORS.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => set.add(el));
    });
    return [...set];
  }

  function _hideThemeUiMenu(menu) {
    menu.hidden = true;
    const wrap = menu.closest('.cs-theme-ui-picker-wrap');
    wrap?.classList?.remove?.('cs-theme-ui-picker-wrap--open-up');
    menu.style.removeProperty('--theme-ui-picker-menu-max-height');
    wrap?.querySelector?.('[data-theme-ui-picker]')?.setAttribute('aria-expanded', 'false');
  }

  function _closeDropdown(el) {
    if (!el || !el.isConnected) return;
    if (el.matches?.('.cs-theme-ui-picker-menu,[data-theme-ui-menu]')) {
      _hideThemeUiMenu(el);
      return;
    }
    if (el.matches?.('.bd-style-picker-menu') && typeof window.bdCloseStylePicker === 'function') {
      window.bdCloseStylePicker();
      return;
    }
    if (el.id === 'chat-title-dropdown' && typeof window._closeChatTitleDropdown === 'function') {
      window._closeChatTitleDropdown();
      return;
    }
    if (el.matches?.('.chat-generation-settings-menu') && typeof window._closeChatGenerationSettingsMenu === 'function') {
      window._closeChatGenerationSettingsMenu();
      return;
    }
    if (typeof el._cleanupActivityMenu === 'function') el._cleanupActivityMenu();
    if (typeof el._cleanupPanelMenu === 'function') el._cleanupPanelMenu();
    if (typeof el._cleanup === 'function') el._cleanup();
    el.remove();
  }

  function _resolveFocusTarget(target) {
    return typeof target === 'function' ? target() : target;
  }

  function focusMeldexDropdownTrigger(target) {
    const focus = () => {
      const el = _resolveFocusTarget(target);
      if (!el?.isConnected || typeof el.focus !== 'function') return;
      try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
    };
    focus();
    setTimeout(focus, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
  }

  function meldexDropdownCloseButtonHtml(options = {}) {
    const label = options.label || '閉じる';
    const cls = options.className || 'meldex-dropdown-close-btn';
    const e2eId = options.e2eId || 'meldex-dropdown-close';
    const attr = options.attr ? ' ' + options.attr : '';
    const icon = typeof window.lucide === 'function' ? window.lucide('x', 14) : 'x';
    return `<button type="button" class="${cls}" data-meldex-dropdown-close data-e2e-id="${e2eId}"${attr} title="${label}" aria-label="${label}">${icon}</button>`;
  }

  function attachMeldexDropdownCloseButton(popup, options = {}) {
    if (!popup || popup.querySelector('[data-meldex-dropdown-close]')) return null;
    const row = document.createElement('div');
    row.className = options.rowClassName || 'meldex-dropdown-close-row';
    row.innerHTML = meldexDropdownCloseButtonHtml(options);
    popup.appendChild(row);
    const btn = row.querySelector('[data-meldex-dropdown-close]');
    btn?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof options.close === 'function') options.close();
      else popup.remove();
      focusMeldexDropdownTrigger(options.trigger);
    });
    return btn || null;
  }

  function bindMeldexDropdownKeySwitch(trigger, options = {}) {
    if (!trigger) return;
    trigger._meldexDropdownKeySwitchOptions = options;
    if (trigger.dataset.meldexDropdownKeySwitch === '1') return;
    trigger.dataset.meldexDropdownKeySwitch = '1';
    trigger.addEventListener('keydown', event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const opts = trigger._meldexDropdownKeySwitchOptions || {};
      const items = (typeof opts.getItems === 'function' ? opts.getItems() : []).filter(item => item && item.value !== undefined);
      if (!items.length) return;
      const currentValue = typeof opts.getCurrentValue === 'function' ? opts.getCurrentValue() : items[0].value;
      const currentIndex = Math.max(0, items.findIndex(item => String(item.value) === String(currentValue)));
      const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)));
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      if (nextIndex === currentIndex) return;
      if (typeof opts.onSelect === 'function') opts.onSelect(items[nextIndex], nextIndex);
      setTimeout(() => focusMeldexDropdownTrigger(opts.getFreshTrigger || trigger), 0);
    });
  }

  function closeMeldexDropdowns(options) {
    const exceptTarget = options?.exceptTarget || null;
    _dropdowns().forEach(el => {
      if (exceptTarget && el.contains(exceptTarget)) return;
      _closeDropdown(el);
    });
  }

  document.addEventListener('click', event => {
    const target = event.target;
    if (_matchesAny(target, DROPDOWN_SELECTORS)) return;
    if (_matchesAny(target, SUPPORT_POPUP_SELECTORS)) return;
    if (_matchesAny(target, TRIGGER_SELECTORS)) return;
    closeMeldexDropdowns({ exceptTarget: target });
  });

  document.addEventListener('change', event => {
    const select = event.target?.closest?.('select');
    if (!event.isTrusted || !select || select.disabled || select.tabIndex < 0) return;
    const style = window.getComputedStyle ? window.getComputedStyle(select) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return;
    if (!select.getClientRects?.().length) return;
    focusMeldexDropdownTrigger(select);
  }, true);

  window.closeMeldexDropdowns = closeMeldexDropdowns;
  window.focusMeldexDropdownTrigger = focusMeldexDropdownTrigger;
  window.meldexDropdownCloseButtonHtml = meldexDropdownCloseButtonHtml;
  window.attachMeldexDropdownCloseButton = attachMeldexDropdownCloseButton;
  window.bindMeldexDropdownKeySwitch = bindMeldexDropdownKeySwitch;
})();
