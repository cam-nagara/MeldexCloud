/* Shared measured-width overflow. Original controls stay in their toolbar so
 * delegated handlers, editor selection and application state remain intact. */
(function () {
  'use strict';
  const hosts = '.gb-toolbar, header.sa-toolbar, .folder-toolbar, #se-toolbar, #sidebar-search-bar, .qm-toolbar-group, .floating-toolbar, .team-room-toolbar, .chat-cli-toolbar, .sn2-detail-toolbar, .gb-production-all-flat-toolbar, .gb-production-template-toolbar, [role="toolbar"]:not([aria-orientation="vertical"])';
  const hiddenClass = 'gb-tbo-hidden';
  const registry = new Map();
  let active = null;
  let pending = false;
  let hostSequence = 0;
  const externalClass = value => String(value || '').split(/\s+/).filter(name => name && name !== hiddenClass && name !== 'gb-toolbar-overflow-host').join(' ');
  const matches = (el, selectors) => selectors.some(selector => el.matches(selector));
  const label = el => el.getAttribute('aria-label') || el.title || el.textContent.trim() || '操作';
  const controls = el => (el.matches('button, select, input:not([type="hidden"])') ? [el]
    : Array.from(el.querySelectorAll('button, select, input:not([type="hidden"])'))).filter(control =>
      control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden' &&
      !el.contains(control.closest('[role="dialog"], [role="menu"], .qm-menu, .qm-color-popover')));

  function close(restoreFocus = false) {
    if (!active) return;
    const entry = active;
    active = null;
    entry.popup.remove();
    entry.popup = null;
    entry.more.setAttribute('aria-expanded', 'false');
    if (restoreFocus) entry.more.focus({ preventScroll: true });
  }

  function place(popup, anchor) {
    if (typeof window.positionPopup === 'function') {
      window.positionPopup(popup, anchor);
    } else {
      document.body.appendChild(popup);
      // Standalone apps have no popup helper; use layout coordinates under CSS zoom.
      const zoom = popup.getBoundingClientRect().width / popup.offsetWidth || 1;
      const box = popup.getBoundingClientRect();
      const left = Math.max(8, Math.min(anchor.right - box.width, innerWidth - box.width - 8));
      const top = anchor.bottom + 4 + box.height <= innerHeight - 8 ? anchor.bottom + 4
        : Math.max(8, anchor.top - box.height - 4);
      popup.style.left = left / zoom + 'px';
      popup.style.top = top / zoom + 'px';
    }
  }

  function activate(entry, source, row) {
    if (source.disabled) return;
    const rect = row.getBoundingClientRect();
    // Make the original anchor measurable for menus opened by its click handler.
    const ancestors = [];
    for (let node = source; node && node !== entry.toolbar; node = node.parentElement) {
      ancestors.push([node, node.getAttribute('style')]);
      node.style.setProperty('display', 'inline-flex', 'important');
      node.style.setProperty('visibility', 'hidden', 'important');
    }
    const zoom = entry.toolbar.getBoundingClientRect().width / entry.toolbar.offsetWidth || 1;
    source.style.setProperty('position', 'fixed', 'important');
    source.style.setProperty('left', rect.left / zoom + 'px', 'important');
    source.style.setProperty('top', rect.top / zoom + 'px', 'important');
    source.style.setProperty('width', rect.width / zoom + 'px', 'important');
    source.style.setProperty('height', rect.height / zoom + 'px', 'important');
    close();
    try {
      source.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      source.click();
    } finally {
      ancestors.forEach(([node, style]) => style === null ? node.removeAttribute('style') : node.setAttribute('style', style));
    }
  }

  function open(entry) {
    if (active === entry) { close(true); return; }
    close();
    const popup = document.createElement('div');
    popup.className = 'gb-context-menu gb-toolbar-overflow-popup';
    popup._cleanup = () => close();
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', '隠れているツールバーの操作');
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'gb-tbo-close';
    dismiss.dataset.e2eId = entry.more.dataset.e2eId + '-close';
    dismiss.textContent = '閉じる';
    dismiss.addEventListener('click', () => close(true));
    popup.appendChild(dismiss);
    entry.overflow.forEach(item => (entry.sources.get(item) || []).forEach(source => {
      if (source.hidden) return;
      const row = document.createElement(source.tagName === 'BUTTON' ? 'button' : 'label');
      row.className = 'gb-context-menu-item gb-tbo-row';
      row.dataset.overflowSource = source.id || source.dataset.e2eId || source.dataset.noteRtCmd || source.dataset.snAction || source.dataset.bdAction || source.dataset.bdTool || source.dataset.action || '';
      row.dataset.e2eId = 'toolbar-overflow-' + (source.id || source.dataset.snAction || source.dataset.bdAction || source.dataset.bdTool || source.dataset.noteRtCmd || source.dataset.sheetAction || source.dataset.e2eId || source.dataset.action || 'control');
      const text = document.createElement('span');
      text.textContent = label(source);
      if (source.tagName === 'BUTTON') {
        row.type = 'button';
        row.disabled = source.disabled;
        row.classList.toggle('active', source.classList.contains('active') || source.getAttribute('aria-pressed') === 'true');
        row.setAttribute('aria-pressed', String(row.classList.contains('active')));
        const icon = source.querySelector('svg, .ico');
        if (icon) { const copy = icon.cloneNode(true); copy.removeAttribute('id'); row.appendChild(copy); }
        row.appendChild(text);
        row.addEventListener('mousedown', event => event.preventDefault());
        row.addEventListener('click', event => { event.stopPropagation(); activate(entry, source, row); });
      } else {
        const copy = source.cloneNode(true);
        copy.removeAttribute('id');
        copy.removeAttribute('name');
        copy.removeAttribute('style');
        copy.removeAttribute('data-action');
        copy.removeAttribute('onchange');
        copy.removeAttribute('oninput');
        copy.value = source.value;
        copy.checked = source.checked;
        for (const name of ['input', 'change']) copy.addEventListener(name, event => {
          event.stopPropagation();
          source.value = copy.value;
          source.checked = copy.checked;
          source.dispatchEvent(new Event(name, { bubbles: true }));
          if (name === 'change' && source.tagName === 'SELECT') close(true);
        });
        row.append(text, copy);
      }
      popup.appendChild(row);
    }));
    entry.popup = popup;
    active = entry;
    entry.more.setAttribute('aria-expanded', 'true');
    place(popup, entry.more.getBoundingClientRect());
    popup.querySelector('.gb-tbo-row:not(:disabled)')?.focus({ preventScroll: true });
  }

  function recompute(entry) {
    const { toolbar, more } = entry;
    const hadMoreFocus = document.activeElement === more;
    if (!toolbar.isConnected || !toolbar.getClientRects().length) return;
    if (toolbar.lastElementChild !== more) toolbar.appendChild(more);
    const before = entry.overflow;
    Array.from(toolbar.children).forEach(el => el.classList.remove(hiddenClass));
    more.hidden = true;
    const items = Array.from(toolbar.children).filter(el => el !== more && !el.hidden && getComputedStyle(el).display !== 'none');
    entry.sources = new Map(items.map(el => [el, controls(el)]));
    const candidates = items.filter(el => entry.sources.get(el).length && !matches(el, entry.keep) &&
      !el.matches('.qm-brand, .sa-title, .tb-title, .tb-file-title, .gb-toolbar-title, #sidebar-search-input') &&
      !el.querySelector('#titleInput, #title-input, .sa-title-input'));
    const fits = () => {
      const box = toolbar.getBoundingClientRect();
      const style = getComputedStyle(toolbar);
      const zoom = box.width / toolbar.offsetWidth || 1;
      const right = box.right - (parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth) || 0) * zoom;
      const left = box.left + (parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) || 0) * zoom;
      return Array.from(toolbar.children).filter(el => !el.hidden && getComputedStyle(el).display !== 'none')
        .every(el => { const rect = el.getBoundingClientRect(); return rect.right <= right + 1 && rect.left >= left - 1; });
    };
    const removed = new Set();
    if (!fits()) {
      more.hidden = false;
      items.filter(el => el.matches('.sep, .tb-spacer')).forEach(el => el.classList.add(hiddenClass));
      // Preserve configured priority operations; otherwise collapse from the right.
      candidates.sort((a, b) => Number(matches(a, entry.priority)) - Number(matches(b, entry.priority)) || items.indexOf(b) - items.indexOf(a));
      for (const el of candidates) {
        if (fits()) break;
        el.classList.add(hiddenClass);
        removed.add(el);
      }
    }
    entry.overflow = items.filter(el => removed.has(el));
    more.hidden = entry.overflow.length === 0;
    if (hadMoreFocus && !more.hidden) more.focus({ preventScroll: true });
    if (active === entry && (before.length !== entry.overflow.length || before.some((el, i) => el !== entry.overflow[i]))) close(true);
  }

  function schedule() {
    if (pending) return;
    pending = true;
    // Timers also run in hidden embedded panels where animation frames may pause.
    setTimeout(() => {
      pending = false;
      registry.forEach((entry, toolbar) => {
        if (!toolbar.isConnected) { if (active === entry) close(); entry.observer.disconnect(); registry.delete(toolbar); }
        else recompute(entry);
      });
    }, 0);
  }

  function setup(config) {
    const opts = typeof config === 'string' || config instanceof Element ? { toolbar: config } : config || {};
    const toolbar = typeof opts.toolbar === 'string' ? document.querySelector(opts.toolbar) : opts.toolbar;
    if (!toolbar || toolbar.matches('.gb-toolbar-app--vertical')) return null;
    if (registry.has(toolbar)) {
      const entry = registry.get(toolbar);
      entry.keep = opts.keep || entry.keep;
      entry.priority = opts.priority || entry.priority;
      schedule();
      return entry;
    }
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'tb-icon-btn gb-toolbar-overflow-button';
    more.dataset.e2eId = 'toolbar-overflow-' + (toolbar.dataset.e2eId || toolbar.id || ('host-' + (++hostSequence)));
    more.textContent = '▼';
    more.title = '隠れている操作を表示';
    more.setAttribute('aria-label', more.title);
    more.setAttribute('aria-haspopup', 'dialog');
    more.setAttribute('aria-expanded', 'false');
    more.hidden = true;
    const entry = { toolbar, more, overflow: [], keep: opts.keep || [], priority: opts.priority || [] };
    registry.set(toolbar, entry);
    toolbar.classList.add('gb-toolbar-overflow-host');
    toolbar.appendChild(more);
    more.addEventListener('mousedown', event => { event.preventDefault(); window.closeAllFormatPopups?.(); });
    more.addEventListener('click', event => { event.stopPropagation(); open(entry); });
    entry.observer = new ResizeObserver(schedule);
    entry.observer.observe(toolbar);
    schedule();
    return entry;
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches(hosts) && !root.parentElement?.closest(hosts)) setup(root);
    root.querySelectorAll(hosts).forEach(toolbar => { if (!toolbar.parentElement?.closest(hosts)) setup(toolbar); });
  }
  function start() {
    scan(document.body);
    new MutationObserver(records => {
      let changed = false;
      for (const record of records) {
        if (record.target.matches?.('.gb-toolbar-overflow-button')) continue;
        if (record.type === 'childList') record.addedNodes.forEach(scan);
        if (record.target.closest?.(hosts) && !record.target.closest('.gb-toolbar-overflow-popup')) {
          // Ignore our own visibility classes to avoid a measurement loop.
          if (record.attributeName !== 'class' || externalClass(record.oldValue) !== externalClass(record.target.className)) changed = true;
        }
        if (record.type === 'attributes' && record.target.querySelector?.(hosts) && record.attributeName !== 'class') changed = true;
      }
      if (changed) schedule();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true,
      attributeFilter: ['hidden', 'style', 'class', 'disabled', 'data-cal-surface'] });
    document.addEventListener('pointerdown', event => { if (active && !active.popup.contains(event.target) && !active.more.contains(event.target)) close(); });
    document.addEventListener('keydown', event => {
      if (!active) return;
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !event.target.matches('input, select')) {
        const rows = Array.from(active.popup.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)'));
        const current = rows.indexOf(document.activeElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        event.preventDefault(); rows[index]?.focus();
      }
    });
    window.addEventListener('resize', () => { close(); schedule(); });
    document.fonts?.ready.then(schedule);
  }
  window.MeldexToolbarOverflow = { setup, refresh: schedule, close, teardown(toolbar) {
    const entry = registry.get(toolbar);
    if (!entry) return;
    if (active === entry) close();
    entry.observer.disconnect(); entry.more.remove(); registry.delete(toolbar);
    Array.from(toolbar.children).forEach(el => el.classList.remove(hiddenClass));
    toolbar.classList.remove('gb-toolbar-overflow-host');
  } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
