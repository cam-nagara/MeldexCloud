/* gb-context-menu-ui.js — Meldex共通コンテキストメニュー生成器。
 * 項目生成、フォーカス、サブメニュー、画面端補正、外側クリック/Escapeを一元化する。
 */
(function (global) {
  'use strict';

  if (global.MeldexContextMenuUI) return;
  let active = null;

  function _shortcutText(item) {
    if (item.shortcut) return String(item.shortcut);
    const registry = global.MeldexShortcutRegistry;
    if (!item.shortcutId || !registry) return '';
    return registry.keyDisplay(registry.keyFor(item.shortcutId));
  }

  function _focusable(menu) {
    return Array.from(menu?.querySelectorAll?.(':scope > .gb-context-menu-item:not(.disabled)') || []);
  }

  function _focusEdge(menu, last) {
    const items = _focusable(menu);
    items[last ? items.length - 1 : 0]?.focus?.({ preventScroll: true });
  }

  function _cycle(menu, delta) {
    const items = _focusable(menu);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const next = current < 0 ? (delta < 0 ? items.length - 1 : 0) : (current + delta + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  function _position(menu, anchorRect, prefer) {
    if (typeof global.positionPopup === 'function') {
      global.positionPopup(menu, anchorRect, { prefer: prefer || 'below' });
      return;
    }
    document.body.appendChild(menu);
    menu.style.setProperty('position', 'fixed');
    menu.style.setProperty('left', `${anchorRect.left}px`);
    menu.style.setProperty('top', `${anchorRect.bottom}px`);
    global.clampPopupToViewport?.(menu);
  }

  function close() {
    if (!active) return;
    active.submenu?.remove();
    active.menu.remove();
    document.removeEventListener('pointerdown', active.outside, true);
    document.removeEventListener('keydown', active.keydown, true);
    const restore = active.restoreFocus;
    active = null;
    restore?.focus?.({ preventScroll: true });
  }

  function _appendSeparator(menu) {
    const sep = document.createElement('div');
    sep.className = 'gb-context-menu-sep';
    sep.setAttribute('role', 'separator');
    menu.appendChild(sep);
  }

  function _appendSlider(menu, item) {
    const row = document.createElement('div');
    row.className = 'gb-context-menu-item';
    row.setAttribute('role', 'menuitem');
    row.tabIndex = 0;
    const label = document.createElement('span');
    label.className = 'gb-context-menu-item-label';
    label.textContent = `${item.label}: `;
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'gb-context-menu-slider-input';
    ['min', 'max', 'step', 'value'].forEach(key => { input[key] = String(item[key]); });
    input.setAttribute('aria-label', item.label);
    const value = document.createElement('span');
    value.className = 'menu-shortcut';
    const format = typeof item.format === 'function' ? item.format : String;
    value.textContent = format(input.value);
    input.addEventListener('input', () => { value.textContent = format(input.value); });
    input.addEventListener('change', () => item.onChange?.(input.value));
    row.addEventListener('click', event => event.stopPropagation());
    row.append(label, input, value);
    menu.appendChild(row);
  }

  function _openSubmenu(trigger, item) {
    if (!active) return;
    active.submenu?.remove();
    active.submenuTrigger?.setAttribute('aria-expanded', 'false');
    const submenu = _buildMenu(item.items || [], item.label);
    document.body.appendChild(submenu);
    _position(submenu, trigger.getBoundingClientRect(), 'right');
    trigger.setAttribute('aria-expanded', 'true');
    active.submenu = submenu;
    active.submenuTrigger = trigger;
  }

  function _appendItem(menu, item) {
    if (!item || item.type === 'separator') { _appendSeparator(menu); return; }
    if (item.type === 'slider') { _appendSlider(menu, item); return; }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `gb-context-menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`;
    button.setAttribute('role', 'menuitem');
    button.disabled = item.disabled === true;
    const label = document.createElement('span');
    label.className = 'gb-context-menu-item-label';
    label.textContent = String(item.label || '');
    button.appendChild(label);
    const shortcut = _shortcutText(item);
    if (shortcut) {
      const key = document.createElement('span');
      key.className = 'menu-shortcut';
      key.textContent = shortcut;
      button.appendChild(key);
    }
    if (Array.isArray(item.items)) {
      button.classList.add('has-submenu');
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
      const open = () => _openSubmenu(button, item);
      button.addEventListener('mouseenter', open);
      button.addEventListener('click', event => { event.stopPropagation(); open(); _focusEdge(active?.submenu, false); });
      button.addEventListener('keydown', event => {
        if (!['ArrowRight', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault(); open(); _focusEdge(active?.submenu, false);
      });
    } else {
      button.addEventListener('mouseenter', () => {
        if (!active?.submenu) return;
        active.submenu.remove(); active.submenu = null;
        active.submenuTrigger?.setAttribute('aria-expanded', 'false');
        active.submenuTrigger = null;
      });
      button.addEventListener('click', () => { close(); item.action?.(); });
    }
    menu.appendChild(button);
  }

  function _buildMenu(items, ariaLabel) {
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', ariaLabel || 'コンテキストメニュー');
    menu.tabIndex = -1;
    items.forEach(item => _appendItem(menu, item));
    return menu;
  }

  function openAt(options) {
    close();
    const menu = _buildMenu(options?.items || [], options?.ariaLabel);
    document.body.appendChild(menu);
    const x = Number(options?.x || 0);
    const y = Number(options?.y || 0);
    _position(menu, { left: x, right: x, top: y, bottom: y }, 'below');
    const outside = event => {
      if (active?.menu.contains(event.target) || active?.submenu?.contains(event.target)) return;
      close();
    };
    const keydown = event => {
      if (!active) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      const host = active.submenu || active.menu;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); _cycle(host, event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); _focusEdge(host, event.key === 'End');
      } else if (event.key === 'ArrowLeft' && active.submenu) {
        event.preventDefault();
        const trigger = active.submenuTrigger;
        active.submenu.remove(); active.submenu = null;
        trigger.setAttribute('aria-expanded', 'false'); trigger.focus({ preventScroll: true });
      }
    };
    active = { menu, submenu: null, submenuTrigger: null, outside, keydown, restoreFocus: options?.restoreFocus || null };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    menu.focus({ preventScroll: true });
    return menu;
  }

  global.MeldexContextMenuUI = Object.freeze({ openAt, close, isOpen: () => !!active });
})(typeof window !== 'undefined' ? window : globalThis);
