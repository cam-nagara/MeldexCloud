/* タグ管理のメニューと検索結果表示を、ツリー本体から分離して管理する。 */
(function () {
  'use strict';

  let activeCleanup = null;
  let activeTrigger = null;
  let activeMenuId = 0;

  function focusTrigger(element) {
    if (typeof focusMeldexDropdownTrigger === 'function') {
      focusMeldexDropdownTrigger(element);
    } else if (element?.focus) {
      try { element.focus({ preventScroll: true }); } catch (_) { element.focus(); }
    }
  }

  function forceTriggerFocus(element) {
    if (!element?.isConnected || typeof element.focus !== 'function') return;
    try { element.focus({ preventScroll: true }); } catch (_) { element.focus(); }
  }

  function cssZoom() {
    try { return typeof _getZoom === 'function' ? (_getZoom() || 1) : 1; } catch (_) { return 1; }
  }

  function closeMenu(options = {}) {
    const trigger = activeTrigger;
    if (typeof activeCleanup === 'function') {
      try { activeCleanup(); } catch (_) {}
      activeCleanup = null;
    }
    document.querySelectorAll('.gb-tag-management-menu').forEach(element => element.remove());
    if (options.restoreFocus && trigger?.isConnected) {
      focusTrigger(trigger);
      forceTriggerFocus(trigger);
      setTimeout(() => forceTriggerFocus(trigger), 0);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => forceTriggerFocus(trigger));
      }
    }
    activeTrigger = null;
  }

  function bindOutsideClick(menu, trigger) {
    if (typeof activeCleanup === 'function') activeCleanup();
    const onOut = event => {
      if (!menu.contains(event.target)) closeMenu({ restoreFocus: true });
    };
    const onKey = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ restoreFocus: true });
    };
    document.addEventListener('mousedown', onOut, true);
    document.addEventListener('keydown', onKey, true);
    activeCleanup = () => {
      document.removeEventListener('mousedown', onOut, true);
      document.removeEventListener('keydown', onKey, true);
      if (trigger?.setAttribute) trigger.setAttribute('aria-expanded', 'false');
      trigger?.removeAttribute?.('aria-controls');
    };
  }

  function openMenu(anchor, rows, helpers = {}) {
    closeMenu({ restoreFocus: false });
    activeTrigger = anchor || null;
    const icon = typeof helpers.icon === 'function' ? helpers.icon : (() => '');
    const escapeHtml = typeof helpers.escapeHtml === 'function'
      ? helpers.escapeHtml
      : value => String(value || '');
    const safeKey = typeof helpers.safeKey === 'function'
      ? helpers.safeKey
      : value => String(value || '');
    const menu = document.createElement('div');
    const menuId = 'tag-management-menu-' + (++activeMenuId);
    menu.id = menuId;
    menu.className = 'gb-context-menu gb-tag-management-menu';
    menu.dataset.e2eId = 'tag-management-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'タグ操作メニュー');
    menu.setAttribute('tabindex', '-1');
    menu.style.cssText = 'position:fixed;z-index:10000;background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:4px;min-width:190px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    if (anchor?.setAttribute) {
      anchor.setAttribute('aria-haspopup', 'menu');
      anchor.setAttribute('aria-expanded', 'true');
      anchor.setAttribute('aria-controls', menuId);
    }
    rows.forEach(([iconName, label, action, danger]) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gb-context-menu-item' + (danger ? ' danger' : '');
      row.dataset.e2eId = 'tag-management-menu-item-' + safeKey(label);
      row.setAttribute('role', 'menuitem');
      row.setAttribute('aria-label', label);
      row.innerHTML = '<span class="menu-icon" aria-hidden="true">'
        + icon(iconName, 13)
        + '</span><span class="gb-context-menu-item-label">'
        + escapeHtml(label)
        + '</span>';
      row.addEventListener('click', () => {
        closeMenu({ restoreFocus: false });
        action();
      });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    if (typeof attachMeldexDropdownCloseButton === 'function') {
      attachMeldexDropdownCloseButton(menu, {
        trigger: anchor,
        close: () => closeMenu({ restoreFocus: true }),
        attr: 'data-e2e-id="tag-management-menu-close" data-tag-management-role="menu-close"',
      });
    }
    if (typeof positionPopup === 'function') {
      positionPopup(menu, anchor.getBoundingClientRect());
    } else {
      const rect = anchor.getBoundingClientRect();
      const zoom = cssZoom();
      menu.style.left = (rect.left / zoom) + 'px';
      menu.style.top = (rect.bottom / zoom + 4) + 'px';
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    bindOutsideClick(menu, anchor);
    const firstItem = menu.querySelector('.gb-context-menu-item');
    setTimeout(() => focusTrigger(firstItem || menu), 0);
  }

  function scrollSearchResultsIntoView(container) {
    const scroll = () => {
      const results = container?.querySelector?.('[data-e2e-id="tag-management-search-results"]');
      if (!results?.scrollIntoView) return;
      try { results.scrollIntoView({ block: 'end', inline: 'nearest' }); }
      catch (_) { results.scrollIntoView(); }
    };
    scroll();
    setTimeout(scroll, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(scroll);
  }

  function renderSearchResults(options = {}) {
    const results = Array.isArray(options.results) ? options.results : [];
    const wrap = document.createElement('div');
    wrap.className = 'gb-section gb-section--boxed';
    wrap.dataset.e2eId = 'tag-management-search-results';
    wrap.style.cssText = 'margin-top:12px;';
    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const titleText = document.createElement('span');
    titleText.style.flex = '1';
    titleText.textContent = `「${options.tagName || ''}」の項目（${results.length}件）`;
    title.insertAdjacentHTML('afterbegin', options.icon?.('search', 14) || '');
    title.appendChild(titleText);
    title.appendChild(options.closeButton());
    wrap.appendChild(title);
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:2px;margin-top:6px;';
    if (!results.length) list.appendChild(options.emptyRow('該当する項目はありません'));
    results.slice(0, 200).forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gb-btn gb-btn-sm gb-btn-quiet';
      button.dataset.e2eId = 'tag-management-search-result-' + String(index + 1);
      button.dataset.tagManagementRole = 'search-result';
      button.style.cssText = 'justify-content:flex-start;text-align:left;width:100%;min-width:0;';
      button.textContent = item.name || item.path || '';
      button.title = item.path || '';
      button.setAttribute('aria-label', (item.name || item.path || '項目') + 'を開く');
      button.addEventListener('click', () => options.onOpen?.(item));
      list.appendChild(button);
    });
    wrap.appendChild(list);
    return wrap;
  }

  window.MeldexTagManagementOverlays = {
    closeMenu,
    openMenu,
    renderSearchResults,
    scrollSearchResultsIntoView,
  };
})();
