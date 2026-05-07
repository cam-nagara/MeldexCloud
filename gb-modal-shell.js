(function() {
  'use strict';

  const OVERLAY_SELECTOR = '.modal-overlay, .gb-modal-overlay, .gb-cal-modal-overlay, .link-modal-overlay';
  const MODAL_SELECTOR = ':scope > .modal, :scope > .gb-modal, :scope > .gb-cal-modal, :scope > .link-modal';
  const LIVE_DIALOG_SELECTOR = MODAL_SELECTOR + ', :scope > .gb-confirm';
  const RECOVERY_TARGET_SELECTOR = 'a, button, input, textarea, select, [data-action], .tree-node-row, .fav-item, .sidebar-item, [role="button"], [tabindex]';
  const VIEWPORT_PADDING = 12;
  const RESIZE_CLICK_SUPPRESS_MS = 350;
  let _observerStarted = false;
  let _staleOverlayRecoveryStarted = false;

  function _zoom() {
    if (typeof _getZoom === 'function') return _getZoom();
    const z = parseFloat(document.documentElement.style.zoom || '');
    return Number.isFinite(z) && z > 0 ? z : 1;
  }

  function _modalScale(modal) {
    const fallback = _zoom();
    if (!modal?.getBoundingClientRect) return fallback;
    const rect = modal.getBoundingClientRect();
    const styledWidth = _numericStyle(modal.style.width, 0);
    if (styledWidth > 0 && rect.width > 0) return Math.max(0.1, rect.width / styledWidth);
    if (modal.offsetWidth > 0 && rect.width > 0) return Math.max(0.1, rect.width / modal.offsetWidth);
    return fallback;
  }

  function _layoutViewport(modal) {
    const z = _modalScale(modal);
    const overlay = modal?.closest?.(OVERLAY_SELECTOR);
    const rect = overlay?.getBoundingClientRect?.();
    const originX = rect ? rect.left : 0;
    const originY = rect ? rect.top : 0;
    return {
      z,
      originX,
      originY,
      width: (rect?.width || window.innerWidth) / z,
      height: (rect?.height || window.innerHeight) / z,
    };
  }

  function _clientToLayout(ev, viewport) {
    return {
      x: (ev.clientX - (viewport?.originX || 0)) / (viewport?.z || 1),
      y: (ev.clientY - (viewport?.originY || 0)) / (viewport?.z || 1),
    };
  }

  function _directModal(overlay) {
    if (!overlay?.querySelector) return null;
    return overlay.querySelector(MODAL_SELECTOR);
  }

  function _directLiveDialog(overlay) {
    if (!overlay?.querySelector) return null;
    return overlay.querySelector(LIVE_DIALOG_SELECTOR);
  }

  function _isVisibleElement(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    return !rect || (rect.width > 0 && rect.height > 0);
  }

  function _isStaleOverlay(overlay) {
    if (!overlay?.matches?.(OVERLAY_SELECTOR)) return false;
    if (!_isVisibleElement(overlay)) return false;
    const dialog = _directLiveDialog(overlay);
    if (!dialog) return true;
    return !_isVisibleElement(dialog);
  }

  function cleanupStaleOverlays() {
    const removed = [];
    document.querySelectorAll(OVERLAY_SELECTOR).forEach((overlay) => {
      if (!_isStaleOverlay(overlay)) return;
      removed.push(overlay);
      overlay.remove();
    });
    return removed.length;
  }

  function _dispatchRecoveredClick(target, sourceEvent) {
    const actionable = target?.closest?.(RECOVERY_TARGET_SELECTOR);
    if (!actionable || !actionable.isConnected) return;
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: sourceEvent.clientX,
      clientY: sourceEvent.clientY,
      screenX: sourceEvent.screenX,
      screenY: sourceEvent.screenY,
      ctrlKey: sourceEvent.ctrlKey,
      shiftKey: sourceEvent.shiftKey,
      altKey: sourceEvent.altKey,
      metaKey: sourceEvent.metaKey,
      button: 0,
    };
    actionable.dispatchEvent(new MouseEvent('click', eventInit));
  }

  function _clonePointerForRecoveredClick(ev) {
    return {
      clientX: ev.clientX,
      clientY: ev.clientY,
      screenX: ev.screenX,
      screenY: ev.screenY,
      ctrlKey: ev.ctrlKey,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      metaKey: ev.metaKey,
    };
  }

  function _installStaleOverlayRecovery() {
    if (_staleOverlayRecoveryStarted) return;
    _staleOverlayRecoveryStarted = true;
    document.addEventListener('pointerdown', (ev) => {
      const overlay = ev.target?.closest?.(OVERLAY_SELECTOR);
      if (!_isStaleOverlay(overlay)) return;
      const x = ev.clientX;
      const y = ev.clientY;
      overlay.remove();
      const nextTarget = document.elementFromPoint(x, y);
      const recoveredEvent = _clonePointerForRecoveredClick(ev);
      ev.preventDefault();
      ev.stopImmediatePropagation();
      setTimeout(() => _dispatchRecoveredClick(nextTarget, recoveredEvent), 0);
    }, true);
  }

  function _isHeaderCandidate(el) {
    if (!el) return false;
    if (el.matches('.gb-modal-header, .gb-modal-shell-header, h1, h2, h3, header, [data-modal-header]')) return true;
    if (el.matches('.btn-row, .gb-modal-footer, .gb-modal-body, .modal-body, .gb-modal-shell-body')) return false;
    if (!['DIV', 'SECTION'].includes(el.tagName)) return false;
    const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 60) return false;
    if (el.querySelector('input, textarea, select')) return false;
    return !!el.querySelector('button, .gb-modal-close') || el.children.length <= 3;
  }

  function _findHeader(modal) {
    const first = modal?.firstElementChild;
    if (_isHeaderCandidate(first)) return first;
    const titled = modal?.querySelector(':scope > h1, :scope > h2, :scope > h3');
    if (titled) return titled;
    return null;
  }

  function _findFooter(modal) {
    const direct = modal?.querySelector(':scope > .gb-modal-footer, :scope > .btn-row, :scope > [data-modal-footer]');
    if (direct) return direct;
    const last = modal?.lastElementChild;
    if (!last) return null;
    if (last.matches('.gb-modal-shell-header, .gb-modal-header, h1, h2, h3, header')) return null;
    if (last.querySelector('button') && !last.querySelector('input, textarea, select')) return last;
    return null;
  }

  function _ensureHeader(modal) {
    let header = modal.querySelector(':scope > .gb-modal-shell-header, :scope > .gb-modal-header');
    if (header) {
      header.classList.add('gb-modal-shell-header');
      return header;
    }
    const candidate = _findHeader(modal);
    if (!candidate) return null;
    if (candidate.matches('h1, h2, h3')) {
      header = document.createElement('div');
      header.className = 'gb-modal-shell-header';
      candidate.classList.add('gb-modal-shell-title');
      candidate.style.margin = '0';
      header.appendChild(candidate);
      modal.insertBefore(header, modal.firstChild);
      return header;
    }
    candidate.classList.add('gb-modal-shell-header');
    return candidate;
  }

  function _ensureFooter(modal) {
    const footer = _findFooter(modal);
    if (!footer) return null;
    footer.classList.add('gb-modal-shell-footer');
    return footer;
  }

  function _ensureBody(modal, header, footer) {
    let body = modal.querySelector(':scope > .gb-modal-shell-body, :scope > .gb-modal-body, :scope > .modal-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'gb-modal-shell-body gb-modal-shell-body-generated';
      const nodes = Array.from(modal.children).filter((child) => child !== header && child !== footer);
      const anchor = footer || null;
      nodes.forEach((child) => body.appendChild(child));
      modal.insertBefore(body, anchor);
      return body;
    }
    body.classList.add('gb-modal-shell-body');
    const extras = Array.from(modal.children).filter((child) => child !== header && child !== footer && child !== body);
    extras.forEach((child) => body.appendChild(child));
    if (footer && body.nextElementSibling !== footer) {
      modal.insertBefore(body, footer);
    } else if (!footer && modal.lastElementChild !== body) {
      modal.appendChild(body);
    }
    return body;
  }

  function _numericStyle(value, fallback) {
    const parsed = parseFloat(value || '');
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function _modalSize(modal, header, footer) {
    const rect = modal.getBoundingClientRect();
    const z = _modalScale(modal);
    const width = Math.max(_numericStyle(modal.style.width, rect.width / z || modal.offsetWidth || 0), 0);
    const height = Math.max(_numericStyle(modal.style.height, rect.height / z || modal.offsetHeight || 0), 0);
    const minWidth = Math.max(_numericStyle(getComputedStyle(modal).minWidth, 320), 260);
    const headerHeight = header ? Math.max(header.getBoundingClientRect().height / z, 40) : 0;
    const footerHeight = footer ? Math.max(footer.getBoundingClientRect().height / z, 44) : 0;
    const minHeight = Math.max(_numericStyle(getComputedStyle(modal).minHeight, 180), headerHeight + footerHeight + 80);
    return { width, height, minWidth, minHeight };
  }

  function _clampModal(modal, header, footer) {
    const viewport = _layoutViewport(modal);
    const { minWidth, minHeight } = _modalSize(modal, header, footer);
    let width = _numericStyle(modal.style.width, minWidth);
    let height = _numericStyle(modal.style.height, minHeight);
    const maxWidth = Math.max(240, viewport.width - VIEWPORT_PADDING * 2);
    const maxHeight = Math.max(180, viewport.height - VIEWPORT_PADDING * 2);
    width = Math.min(Math.max(width, Math.min(minWidth, maxWidth)), maxWidth);
    height = Math.min(Math.max(height, Math.min(minHeight, maxHeight)), maxHeight);

    let left = _numericStyle(modal.style.left, (viewport.width - width) / 2);
    let top = _numericStyle(modal.style.top, Math.max(VIEWPORT_PADDING, (viewport.height - height) / 2));
    left = Math.min(Math.max(left, VIEWPORT_PADDING), Math.max(VIEWPORT_PADDING, viewport.width - width - VIEWPORT_PADDING));
    top = Math.min(Math.max(top, VIEWPORT_PADDING), Math.max(VIEWPORT_PADDING, viewport.height - height - VIEWPORT_PADDING));

    modal.style.width = width + 'px';
    modal.style.height = height + 'px';
    modal.style.left = left + 'px';
    modal.style.top = top + 'px';
  }

  function _ensureGeometry(modal, header, footer) {
    if (!modal) return;
    modal.style.position = 'absolute';
    modal.style.margin = '0';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!modal.isConnected) return;
        const viewport = _layoutViewport(modal);
        const { width, height, minWidth, minHeight } = _modalSize(modal, header, footer);
        if (!_numericStyle(modal.style.width, 0)) {
          modal.style.width = Math.max(width, minWidth) + 'px';
        }
        if (!_numericStyle(modal.style.height, 0)) {
          modal.style.height = Math.max(height, minHeight) + 'px';
        }
        if (!_numericStyle(modal.style.left, NaN)) {
          modal.style.left = Math.max(VIEWPORT_PADDING, (viewport.width - Math.max(width, minWidth)) / 2) + 'px';
        }
        if (!_numericStyle(modal.style.top, NaN)) {
          modal.style.top = Math.max(VIEWPORT_PADDING, (viewport.height - Math.max(height, minHeight)) / 2) + 'px';
        }
        _clampModal(modal, header, footer);
      });
    });
  }

  function _interactiveTarget(target) {
    return !!target?.closest('button, input, textarea, select, a, [contenteditable="true"], [data-action], .gb-modal-close, .gb-pane-btn');
  }

  function _suppressOverlayClick(overlay) {
    const until = parseInt(overlay?.dataset?.modalShellSuppressClickUntil || '0', 10);
    if (!Number.isFinite(until) || until <= 0) return false;
    if (Date.now() > until) {
      delete overlay.dataset.modalShellSuppressClickUntil;
      return false;
    }
    return true;
  }

  function _bindDrag(header, modal, footer) {
    if (!header || header.dataset.modalShellDragBound === '1') return;
    header.dataset.modalShellDragBound = '1';
    header.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || _interactiveTarget(ev.target)) return;
      ev.preventDefault();
      const viewport = _layoutViewport(modal);
      const startLeft = _numericStyle(modal.style.left, Math.max(VIEWPORT_PADDING, (viewport.width - modal.offsetWidth) / 2));
      const startTop = _numericStyle(modal.style.top, VIEWPORT_PADDING);
      const startPoint = _clientToLayout(ev, viewport);
      const move = (moveEv) => {
        const nextPoint = _clientToLayout(moveEv, viewport);
        modal.style.left = startLeft + (nextPoint.x - startPoint.x) + 'px';
        modal.style.top = startTop + (nextPoint.y - startPoint.y) + 'px';
        _clampModal(modal, header, footer);
      };
      const stop = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', stop);
        document.removeEventListener('pointercancel', stop);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', stop);
      document.addEventListener('pointercancel', stop);
    });
  }

  // 2026-04-18: 旧右下ハンドル (.gb-modal-shell-resize) を廃止し、ウィンドウと同じく
  // 4 辺 + 4 隅でリサイズできる共通仕様に変更。モーダルの全 8 方向に不可視ハンドルを配置する。
  const RESIZE_DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  function _removeLegacyResizeHandle(modal) {
    const legacy = modal.querySelector(':scope > .gb-modal-shell-resize');
    if (legacy) legacy.remove();
  }

  function _applyResizeDelta(modal, dir, dx, dy, start) {
    let { left, top, width, height } = start;
    // w/n エッジは左端・上端をドラッグするため、サイズが最小値でクランプされたら
    // left/top も連動して止める必要がある。連動しないと minWidth/minHeight に達した後も
    // モーダルがスライドしてしまう。
    if (dir.includes('e')) width = Math.max(start.minWidth, start.width + dx);
    if (dir.includes('w')) {
      width = Math.max(start.minWidth, start.width - dx);
      left = start.left + (start.width - width);
    }
    if (dir.includes('s')) height = Math.max(start.minHeight, start.height + dy);
    if (dir.includes('n')) {
      height = Math.max(start.minHeight, start.height - dy);
      top = start.top + (start.height - height);
    }
    modal.style.left = left + 'px';
    modal.style.top = top + 'px';
    modal.style.width = width + 'px';
    modal.style.height = height + 'px';
  }

  function _ensureResizeHandles(modal, header, footer) {
    _removeLegacyResizeHandle(modal);
    RESIZE_DIRECTIONS.forEach((dir) => {
      let handle = modal.querySelector(`:scope > .gb-modal-shell-edge[data-edge="${dir}"]`);
      if (!handle) {
        handle = document.createElement('div');
        handle.className = `gb-modal-shell-edge gb-modal-shell-edge-${dir}`;
        handle.dataset.edge = dir;
        modal.appendChild(handle);
      }
      if (handle.dataset.modalShellResizeBound === '1') return;
      handle.dataset.modalShellResizeBound = '1';
      handle.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        const overlay = modal.closest?.(OVERLAY_SELECTOR);
        if (overlay) overlay.dataset.modalShellSuppressClickUntil = String(Date.now() + RESIZE_CLICK_SUPPRESS_MS);
        const viewport = _layoutViewport(modal);
        const rect = modal.getBoundingClientRect();
        const size = _modalSize(modal, header, footer);
        const startPoint = _clientToLayout(ev, viewport);
        const start = {
          x: startPoint.x,
          y: startPoint.y,
          left: _numericStyle(modal.style.left, (rect.left - viewport.originX) / viewport.z),
          top: _numericStyle(modal.style.top, (rect.top - viewport.originY) / viewport.z),
          width: _numericStyle(modal.style.width, rect.width / viewport.z),
          height: _numericStyle(modal.style.height, rect.height / viewport.z),
          minWidth: size.minWidth,
          minHeight: size.minHeight,
        };
        try { handle.setPointerCapture?.(ev.pointerId); } catch {}
        const move = (moveEv) => {
          const point = _clientToLayout(moveEv, viewport);
          const dx = point.x - start.x;
          const dy = point.y - start.y;
          _applyResizeDelta(modal, dir, dx, dy, start);
          _clampModal(modal, header, footer);
        };
        const stop = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', stop);
          document.removeEventListener('pointercancel', stop);
          if (overlay) overlay.dataset.modalShellSuppressClickUntil = String(Date.now() + RESIZE_CLICK_SUPPRESS_MS);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', stop);
        document.addEventListener('pointercancel', stop);
      });
    });
  }

  function enhanceOverlay(overlay) {
    if (!overlay || overlay.dataset.modalShellEnhanced === '1') return;
    if (overlay.dataset.modalShell === 'off') {
      overlay.dataset.modalShellEnhanced = 'skip';
      return;
    }
    const modal = _directModal(overlay);
    if (!modal) return;
    if (modal.dataset.modalShell === 'off') {
      overlay.dataset.modalShellEnhanced = 'skip';
      return;
    }
    overlay.dataset.modalShellEnhanced = '1';
    overlay.addEventListener('click', (ev) => {
      if (ev.target !== overlay) return;
      if (!_suppressOverlayClick(overlay)) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }, true);
    modal.classList.add('gb-modal-shell');
    const header = _ensureHeader(modal);
    const footer = _ensureFooter(modal);
    _ensureBody(modal, header, footer);
    _ensureResizeHandles(modal, header, footer);
    _bindDrag(header, modal, footer);
    _ensureGeometry(modal, header, footer);
  }

  function enhanceAll() {
    document.querySelectorAll(OVERLAY_SELECTOR).forEach(enhanceOverlay);
  }

  function _observeBody() {
    if (_observerStarted) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', _observeBody, { once: true });
      return;
    }
    _observerStarted = true;
    const callback = (mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.(OVERLAY_SELECTOR)) enhanceOverlay(node);
          node.querySelectorAll?.(OVERLAY_SELECTOR).forEach(enhanceOverlay);
        });
      });
    };
    const filter = (mutation) => Array.from(mutation.addedNodes || []).some((node) => {
      if (!(node instanceof HTMLElement)) return false;
      return node.matches?.(OVERLAY_SELECTOR) || !!node.querySelector?.(OVERLAY_SELECTOR);
    });
    if (window.GBMutationBus) {
      window.GBMutationBus.subscribe('gb-modal-shell', { filter, callback, throttle: 30 });
    } else {
      const observer = new MutationObserver(callback);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener('resize', () => {
      document.querySelectorAll(OVERLAY_SELECTOR).forEach((overlay) => {
        const modal = _directModal(overlay);
        if (!modal) return;
        const header = modal.querySelector(':scope > .gb-modal-shell-header, :scope > .gb-modal-header');
        const footer = modal.querySelector(':scope > .gb-modal-shell-footer, :scope > .gb-modal-footer, :scope > .btn-row');
        _clampModal(modal, header, footer);
      });
    });
    enhanceAll();
  }

  window.GBModalShell = {
    enhanceOverlay,
    enhanceAll,
    clamp: _clampModal,
    cleanupStaleOverlays,
  };

  _observeBody();
  _installStaleOverlayRecovery();
})();
