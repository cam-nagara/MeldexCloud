/* gb-context-menu-ui.js — Meldex共通コンテキストメニュー生成器。
 * 項目生成、フォーカス、サブメニュー、画面端補正、外側クリック/Escapeを一元化する。
 */
(function (global) {
  'use strict';

  if (global.MeldexContextMenuUI) return;
  let active = null;

  function _notifyLayout() {
    // The owning shell's progress tray also avoids menus in embedded viewers.
    let target = global;
    try {
      while (target) {
        if (typeof target.dispatchEvent === 'function' && typeof target.Event === 'function') {
          target.dispatchEvent(new target.Event('meldex-context-menu-layout'));
        }
        if (!target.parent || target.parent === target) break;
        target = target.parent;
      }
    } catch (_) { /* A cross-origin parent owns its own overlay placement. */ }
  }

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
    clearTimeout(active.hoverTimer);
    active.submenu?.remove();
    active.menu.remove();
    document.removeEventListener('pointerdown', active.outside, true);
    document.removeEventListener('keydown', active.keydown, true);
    document.removeEventListener('mousemove', active.mousemove);
    const restore = active.restoreFocus;
    const onClose = active.onClose;
    active = null;
    _notifyLayout();
    restore?.focus?.({ preventScroll: true });
    try { onClose?.(); } catch (error) { console.warn('[MeldexContextMenuUI] onClose failed', error); }
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
    clearTimeout(active.hoverTimer);
    if (active.submenuTrigger === trigger && active.submenu?.isConnected) return;
    active.hoverAction = null;
    active.submenu?.remove();
    active.submenuTrigger?.setAttribute('aria-expanded', 'false');
    const submenu = _buildMenu(item.items || [], item.label);
    document.body.appendChild(submenu);
    _position(submenu, trigger.getBoundingClientRect(), 'right');
    trigger.setAttribute('aria-expanded', 'true');
    active.submenu = submenu;
    _notifyLayout();
    active.submenuTrigger = trigger;
    submenu.addEventListener('mouseenter', () => clearTimeout(active?.hoverTimer));
  }

  // 子の項目へ入ることは、親の別項目へ移ることではない。
  // 親を斜めに横切る間は切替を保留し、子へ到着したら取り消す。
  function _hoverItem(menu, action) {
    if (!active || menu !== active.menu) return;
    clearTimeout(active.hoverTimer);
    if (!active.submenu) { action(); return; }
    active.hoverAction = action;
    active.hoverTimer = setTimeout(() => {
      if (active?.menu === menu) { active.hoverAction = null; action(); }
    }, 240);
  }

  function _closeSubmenu() {
    if (!active) return;
    clearTimeout(active.hoverTimer);
    active.hoverAction = null;
    active.submenu?.remove();
    active.submenu = null;
    active.submenuTrigger?.setAttribute('aria-expanded', 'false');
    active.submenuTrigger = null;
  }

  function _appendItem(menu, item) {
    if (!item || item.type === 'separator') { _appendSeparator(menu); return; }
    if (item.type === 'slider') { _appendSlider(menu, item); return; }
    if (item.type === 'label') {
      // 操作できない見出し（一括実行の「3行を選択中」など）。フォーカス移動の対象にしない。
      const heading = document.createElement('div');
      heading.className = 'gb-context-menu-label';
      heading.setAttribute('role', 'presentation');
      if (item.e2eId) heading.dataset.e2eId = String(item.e2eId);
      heading.textContent = String(item.label || '');
      menu.appendChild(heading);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `gb-context-menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`;
    button.setAttribute('role', 'menuitem');
    button.disabled = item.disabled === true;
    if (item.e2eId) button.dataset.e2eId = String(item.e2eId);
    if (item.icon && typeof global.lucide === 'function') {
      const icon = document.createElement('span');
      icon.className = 'menu-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = global.lucide(String(item.icon), 16);
      button.appendChild(icon);
    }
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
      button.addEventListener('mouseenter', () => _hoverItem(menu, open));
      button.addEventListener('click', event => { event.stopPropagation(); open(); _focusEdge(active?.submenu, false); });
      button.addEventListener('keydown', event => {
        if (!['ArrowRight', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault(); open(); _focusEdge(active?.submenu, false);
      });
    } else {
      button.addEventListener('mouseenter', () => {
        _hoverItem(menu, _closeSubmenu);
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
    if (options?.e2eId) menu.dataset.e2eId = String(options.e2eId);
    document.body.appendChild(menu);
    // anchorRect を渡すと、点ではなく矩形（行など）を基準に配置する。
    const anchor = options?.anchorRect;
    if (anchor && Number.isFinite(Number(anchor.left)) && Number.isFinite(Number(anchor.bottom))) {
      _position(menu, anchor, options?.prefer || 'below');
    } else {
      const x = Number(options?.x || 0);
      const y = Number(options?.y || 0);
      _position(menu, { left: x, right: x, top: y, bottom: y }, 'below');
    }
    const outside = event => {
      if (active?.menu.contains(event.target) || active?.submenu?.contains(event.target)) return;
      close();
    };
    const mousemove = event => {
      if (!active?.submenu) return;
      if (active.submenuTrigger?.contains(event.target)) {
        active.hoverOrigin = { x: event.clientX, y: event.clientY };
      } else if (active.submenu.contains(event.target)) {
        clearTimeout(active.hoverTimer);
        active.hoverAction = null;
      } else if (active.hoverAction && active.hoverOrigin) {
        const origin = active.hoverOrigin;
        const rect = active.submenu.getBoundingClientRect();
        const edge = rect.left >= origin.x ? rect.left : rect.right;
        const fraction = (event.clientX - origin.x) / (edge - origin.x);
        // 三角形の中を子に向かって移動中は、隣の項目への切替を待つ。
        const top = origin.y + (rect.top - 6 - origin.y) * fraction;
        const bottom = origin.y + (rect.bottom + 6 - origin.y) * fraction;
        if (fraction >= 0 && fraction <= 1 && event.clientY >= top && event.clientY <= bottom) {
          _hoverItem(active.menu, active.hoverAction);
        }
      }
    };
    const keydown = event => {
      if (!active) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      const host = active.submenu?.contains(document.activeElement) ? active.submenu : active.menu;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); _cycle(host, event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); _focusEdge(host, event.key === 'End');
      } else if (event.key === 'ArrowLeft' && active.submenu) {
        event.preventDefault();
        const trigger = active.submenuTrigger;
        _closeSubmenu();
        trigger.focus({ preventScroll: true });
      }
    };
    active = {
      menu, submenu: null, submenuTrigger: null, outside, keydown, mousemove,
      restoreFocus: options?.restoreFocus || null,
      onClose: typeof options?.onClose === 'function' ? options.onClose : null,
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('mousemove', mousemove);
    menu.focus({ preventScroll: true });
    _notifyLayout();
    return menu;
  }

  global.MeldexContextMenuUI = Object.freeze({ openAt, close, isOpen: () => !!active });
})(typeof window !== 'undefined' ? window : globalThis);
