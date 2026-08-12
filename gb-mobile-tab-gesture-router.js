/* Common <=640px tab dropdown and edge gesture router. */
(function (global) {
  'use strict';

  const PHONE_QUERY = '(max-width: 640px)';
  const LEFT_ZONE = 28;
  const SWIPE_DISTANCE = 72;
  const BLOCKED = [
    'input', 'textarea', 'select', '[contenteditable="true"]',
    '[role="dialog"]', '.modal-overlay', '.gb-modal-overlay', '.gb-cal-modal-overlay',
    '.link-modal-overlay', '.cloud-mobile-menu-overlay', '.cloud-mobile-overflow-overlay',
    '#board-canvas', '.board-canvas', '.gb-board', '#html-view', '.gb-viewer',
    '#ann-overlay', '.ann-note', '.cloud-mobile-annotationbar'
  ].join(',');
  let observer = null;
  let gesture = null;

  function isPhone() {
    return !!global.matchMedia?.(PHONE_QUERY).matches;
  }

  function tabTitle(tab) {
    return String(tab?.dataset?.tabTitle || tab?.getAttribute?.('aria-label') ||
      tab?.getAttribute?.('title') || tab?.textContent || 'タブ').trim() || 'タブ';
  }

  function tabItems(tablist) {
    const selector = tablist.classList.contains('gb-pane-tabs')
      ? ':scope > .gb-pane-tabs-scroll > .gb-tab'
      : ':scope > [role="tab"]';
    return Array.from(tablist.querySelectorAll(selector));
  }

  function activeTab(tabs) {
    return tabs.find(tab => tab.classList.contains('active') || tab.getAttribute('aria-selected') === 'true') || tabs[0];
  }

  function closeMenu(menu, trigger) {
    menu?.remove();
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.focus?.();
  }

  function closeMainTab(tablist, tab) {
    const paneId = tablist.closest('.gb-pane')?.dataset?.paneId;
    const tabId = tab?.dataset?.tabId;
    if (!paneId || !tabId || typeof global.GBTabs?.closeTab !== 'function') return false;
    global.GBTabs.closeTab(paneId, tabId);
    return true;
  }

  function openMenu(trigger, tablist) {
    document.querySelectorAll('.gb-mobile-tab-menu').forEach(node => node.remove());
    const tabs = tabItems(tablist);
    const menu = document.createElement('div');
    menu.className = 'gb-mobile-tab-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '表示を切り替える');
    tabs.forEach((tab) => {
      const row = document.createElement('div');
      row.className = 'gb-mobile-tab-menu-row';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-mobile-tab-menu-item';
      item.setAttribute('role', 'menuitem');
      item.disabled = tab.matches(':disabled,[aria-disabled="true"]');
      item.textContent = tabTitle(tab);
      item.addEventListener('click', () => {
        tab.click();
        syncOne(tablist);
        closeMenu(menu, trigger);
      });
      row.appendChild(item);
      if (tablist.classList.contains('gb-pane-tabs')) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'gb-mobile-tab-menu-close';
        close.setAttribute('aria-label', `${tabTitle(tab)}を閉じる`);
        close.title = `${tabTitle(tab)}を閉じる`;
        close.textContent = '×';
        close.addEventListener('click', () => {
          if (closeMainTab(tablist, tab)) closeMenu(menu, trigger);
        });
        row.appendChild(close);
      }
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    trigger.setAttribute('aria-expanded', 'true');
    if (typeof global.positionPopup === 'function') global.positionPopup(menu, trigger.getBoundingClientRect());
    else {
      const rect = trigger.getBoundingClientRect();
      menu.style.setProperty('left', `${Math.max(8, rect.left)}px`);
      menu.style.setProperty('top', `${rect.bottom + 4}px`);
    }
    menu.querySelector('button:not(:disabled)')?.focus();
    menu.addEventListener('keydown', (event) => {
      const items = Array.from(menu.querySelectorAll('button:not(:disabled)'));
      const index = items.indexOf(document.activeElement);
      let next = -1;
      if (event.key === 'ArrowDown') next = index < items.length - 1 ? index + 1 : 0;
      else if (event.key === 'ArrowUp') next = index > 0 ? index - 1 : items.length - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      if (next >= 0) {
        event.preventDefault();
        items[next]?.focus();
      }
    });
    const dismiss = (event) => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && !menu.contains(event.target) && event.target !== trigger)) {
        closeMenu(menu, trigger);
        document.removeEventListener('keydown', dismiss, true);
        document.removeEventListener('pointerdown', dismiss, true);
      }
    };
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('pointerdown', dismiss, true);
  }

  function ensureDropdown(tablist) {
    let trigger = tablist.previousElementSibling;
    if (!trigger?.classList?.contains('gb-mobile-tab-dropdown')) {
      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'gb-mobile-tab-dropdown';
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('click', () => openMenu(trigger, tablist));
      tablist.parentNode?.insertBefore(trigger, tablist);
    }
    const owner = tablist.closest?.('[data-pane-id]')?.dataset?.paneId
      || tablist.id || tablist.getAttribute?.('aria-label') || 'tabs';
    trigger.dataset.e2eId = `mobile-tab-dropdown-${String(owner).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'tabs'}`;
    trigger.__meldexTablist = tablist;
    return trigger;
  }

  function syncOne(tablist) {
    if (!tablist?.isConnected) return;
    const trigger = ensureDropdown(tablist);
    const tabs = tabItems(tablist);
    const active = activeTab(tabs);
    const title = tabTitle(active);
    if (trigger.textContent !== title) trigger.textContent = title;
    trigger.title = title;
    trigger.setAttribute('aria-label', `${title}。表示を切り替える`);
    trigger.disabled = tabs.length === 0;
  }

  function syncAll() {
    const phone = isPhone();
    document.documentElement.toggleAttribute('data-meldex-phone-tabs', phone);
    const tablists = Array.from(document.querySelectorAll('[role="tablist"], .gb-pane-tabs'));
    tablists.forEach(syncOne);
    document.querySelectorAll('.gb-mobile-tab-dropdown').forEach((trigger) => {
      if (!trigger.__meldexTablist?.isConnected) trigger.remove();
    });
  }

  function blockedTarget(target) {
    if (target?.closest?.(BLOCKED)) return true;
    try {
      if (typeof global.ann !== 'undefined' && (global.ann.active || global.ann.drawing)) return true;
    } catch (_) { /* optional annotation runtime */ }
    return false;
  }

  function leftOpen() {
    return document.getElementById('sidebar')?.classList.contains('cloud-mobile-tree-screen-open');
  }

  function rightOpen() {
    return document.getElementById('right-panel')?.classList.contains('open') ||
      !!document.querySelector('.gb-pane[data-meldex-role="right-sidebar"]');
  }

  function routeGesture(event, dx, dy) {
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (gesture.side === 'left' && dx > 0) global.MeldexCloudMobile?.openSidebar?.(true);
    else if (gesture.side === 'left-open' && dx < 0) global.MeldexCloudMobile?.closeSidebar?.({ reason: 'gesture-router' });
    else if (gesture.side === 'right' && dx < 0) {
      if (typeof global.openRightPanelTab === 'function') global.openRightPanelTab('detail');
      else if (typeof global.toggleRightPanel === 'function') global.toggleRightPanel();
    } else if (gesture.side === 'right-open' && dx > 0 && typeof global.toggleRightPanel === 'function') {
      global.toggleRightPanel();
    }
  }

  function installGestures() {
    if (document.__MeldexCommonEdgeGestureRouter) return;
    document.__MeldexCommonEdgeGestureRouter = true;
    document.addEventListener('pointerdown', (event) => {
      if (!isPhone() || event.pointerType === 'mouse' || blockedTarget(event.target)) return;
      const width = global.innerWidth || document.documentElement.clientWidth;
      let side = '';
      if (leftOpen() && event.target?.closest?.('#sidebar')) side = 'left-open';
      else if (rightOpen() && event.target?.closest?.('#right-panel, .gb-pane[data-meldex-role="right-sidebar"]')) side = 'right-open';
      else if (event.clientX <= LEFT_ZONE) side = 'left';
      else if (event.clientX >= width - LEFT_ZONE) side = 'right';
      if (side) gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, side };
    }, true);
    document.addEventListener('pointerup', (event) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const current = gesture;
      gesture = current;
      routeGesture(event, event.clientX - current.x, event.clientY - current.y);
      gesture = null;
    }, true);
    document.addEventListener('pointermove', (event) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.2) event.preventDefault();
    }, { capture: true, passive: false });
    document.addEventListener('pointercancel', () => { gesture = null; }, true);
  }

  function init() {
    syncAll();
    installGestures();
    observer = new MutationObserver(syncAll);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-disabled', 'disabled'] });
    global.addEventListener('resize', syncAll, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  global.MeldexMobileTabGestureRouter = { sync: syncAll, isPhone };
})(window);
