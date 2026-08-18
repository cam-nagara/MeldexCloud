(function () {
  'use strict';

  if (window.MeldexModeIndicator) return;

  let _detailsState = null;

  function _runtimeMode() {
    if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) return 'dropbox';
    if (window.MeldexRuntimeAdapter?.isBrowserMode?.()) return 'browser';
    return 'legacy';
  }

  function _isTouchMode() {
    return window.matchMedia?.('(pointer: coarse)')?.matches || window.innerWidth <= 768;
  }

  function _workspaceState() {
    return window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null;
  }

  function _localWorkspaceSource() {
    const currentState = (typeof state !== 'undefined' && state) ? state : null;
    const homeFolder = (typeof _homeFolderPath !== 'undefined' && _homeFolderPath) ? _homeFolderPath : '';
    return String(currentState?.vaultPath || homeFolder || window.state?.vaultPath || window._homeFolderPath || '');
  }

  function getModeInfo() {
    const runtime = _runtimeMode();
    const touch = _isTouchMode();
    const workspace = _workspaceState();
    if (runtime === 'dropbox') {
      return {
        id: touch ? 'mobile-dropbox' : 'dropbox',
        label: touch ? 'タッチ表示（Dropbox）' : 'Dropboxに保存',
        detail: workspace?.path || workspace?.accountName || 'Dropboxと接続中',
      };
    }
    if (runtime === 'browser') {
      return {
        id: touch ? 'mobile-browser' : 'browser',
        label: touch ? 'タッチ表示（この端末）' : 'この端末内に保存',
        detail: workspace?.path || 'この端末内に保存',
      };
    }
    const source = _localWorkspaceSource();
    const hybrid = /dropbox/i.test(source);
    return {
      id: touch ? 'mobile-local' : (hybrid ? 'hybrid' : 'local'),
      label: touch ? 'タッチ表示' : (hybrid ? 'Dropbox同期フォルダ' : 'このPCに保存'),
      detail: source || 'このPCに保存',
    };
  }

  function _setBadgeExpanded(anchor, expanded) {
    if (anchor?.setAttribute) anchor.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function _focusAnchor(anchor) {
    if (!anchor?.isConnected || typeof anchor.focus !== 'function') return;
    try { anchor.focus({ preventScroll: true }); }
    catch { anchor.focus(); }
  }

  function closeDetails(options = {}) {
    const opts = typeof options === 'boolean' ? { restoreFocus: options } : (options || {});
    const current = _detailsState || {};
    const popup = current.popup || document.getElementById('meldex-mode-indicator-popup');
    if (current.pointerCloser) document.removeEventListener?.('pointerdown', current.pointerCloser, true);
    if (current.keyCloser) document.removeEventListener?.('keydown', current.keyCloser, true);
    popup?.remove?.();
    const anchor = current.anchor || document.getElementById('meldex-mode-indicator');
    _setBadgeExpanded(anchor, false);
    _detailsState = null;
    if (opts.restoreFocus) _focusAnchor(anchor);
  }

  function _showDetails(anchor) {
    closeDetails({ restoreFocus: false });
    const info = getModeInfo();
    const popup = document.createElement('div');
    popup.id = 'meldex-mode-indicator-popup';
    popup.className = 'gb-context-menu meldex-mode-indicator-popup';
    popup.dataset.e2eId = 'mode-indicator-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-labelledby', 'meldex-mode-indicator-popup-title');
    popup.setAttribute('aria-describedby', 'meldex-mode-indicator-popup-desc');
    popup.tabIndex = -1;
    popup.style.cssText = 'position:fixed;z-index:100055;min-width:260px;max-width:360px;padding:10px;';
    popup.innerHTML = `<div class="meldex-mode-indicator-popup__content">
      <div id="meldex-mode-indicator-popup-title" class="meldex-mode-indicator-popup__title">${esc(info.label)}</div>
      <div id="meldex-mode-indicator-popup-desc" class="meldex-mode-indicator-popup__row">保存先: ${esc(info.detail || '未設定')}</div>
      <div class="meldex-mode-indicator-popup__row">Service Worker: ${navigator.serviceWorker ? '対応' : '未対応'}</div>
      <div class="meldex-mode-indicator-popup__row">画面: ${_isTouchMode() ? 'タッチ向け' : 'デスクトップ向け'}</div>
    </div>`;
    document.body.appendChild(popup);
    _setBadgeExpanded(anchor, true);
    const rect = anchor?.getBoundingClientRect?.();
    if (rect && typeof positionPopup === 'function') positionPopup(popup, rect, { prefer: 'above' });
    else {
      popup.style.right = '12px';
      popup.style.bottom = '32px';
    }
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
    const keyCloser = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDetails({ restoreFocus: true });
    };
    _detailsState = { popup, anchor, pointerCloser: null, keyCloser };
    document.addEventListener('keydown', keyCloser, true);
    try { popup.focus({ preventScroll: true }); }
    catch { popup.focus?.(); }
    setTimeout(() => {
      if (_detailsState?.popup !== popup || !popup.isConnected) return;
      const pointerCloser = (event) => {
        if (!popup.contains(event.target) && event.target !== anchor && !anchor?.contains?.(event.target)) {
          closeDetails({ restoreFocus: false });
        }
      };
      _detailsState.pointerCloser = pointerCloser;
      document.addEventListener('pointerdown', pointerCloser, true);
    }, 0);
  }

  function _toggleDetails(anchor) {
    const popup = document.getElementById('meldex-mode-indicator-popup');
    if (popup && _detailsState?.anchor === anchor) {
      closeDetails({ restoreFocus: true });
      return;
    }
    _showDetails(anchor);
  }

  function render() {
    const statusBar = document.getElementById('status-bar');
    if (!statusBar) return;
    let badge = document.getElementById('meldex-mode-indicator');
    if (!badge) {
      badge = document.createElement('button');
      badge.id = 'meldex-mode-indicator';
      badge.type = 'button';
      badge.style.cssText = 'border:1px solid var(--border);border-radius:5px;background:var(--bg3);color:var(--fg2);font-size:11px;padding:1px 6px;white-space:nowrap;cursor:pointer;';
      badge.addEventListener('click', (event) => {
        event.stopPropagation();
        _toggleDetails(badge);
      });
      const shortcut = document.getElementById('sb-shortcuts');
      statusBar.insertBefore(badge, shortcut || null);
    }
    const info = getModeInfo();
    badge.classList.add('meldex-mode-indicator-badge');
    badge.setAttribute('aria-haspopup', 'dialog');
    if (!badge.hasAttribute('aria-expanded')) badge.setAttribute('aria-expanded', 'false');
    badge.setAttribute('aria-controls', 'meldex-mode-indicator-popup');
    badge.textContent = info.label;
    badge.title = '現在の保存先を表示';
    badge.setAttribute('aria-label', `保存モード: ${info.label}。詳細を表示`);
    badge.dataset.mode = info.id;
  }

  function _boot() {
    render();
    window.addEventListener('resize', () => render());
    document.addEventListener('meldex:mode-changed', () => render());
    setInterval(render, 10000);
  }

  window.MeldexModeIndicator = { render, getModeInfo, closeDetails };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot, { once: true });
  else _boot();
})();
