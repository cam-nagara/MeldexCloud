(function () {
  'use strict';

  if (window.MeldexModeIndicator) return;

  function _runtimeMode() {
    if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) return 'dropbox';
    return 'legacy';
  }

  function _isTouchMode() {
    return window.matchMedia?.('(pointer: coarse)')?.matches || window.innerWidth <= 768;
  }

  function _workspaceState() {
    return window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null;
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
    const source = String(window.state?.vaultPath || window._homeFolderPath || '');
    const hybrid = /dropbox/i.test(source);
    return {
      id: touch ? 'mobile-local' : (hybrid ? 'hybrid' : 'local'),
      label: touch ? 'タッチ表示' : (hybrid ? 'Dropbox同期フォルダ' : 'このPCに保存'),
      detail: source || 'このPCに保存',
    };
  }

  function _showDetails(anchor) {
    closeDetails();
    const info = getModeInfo();
    const popup = document.createElement('div');
    popup.id = 'meldex-mode-indicator-popup';
    popup.className = 'gb-context-menu';
    popup.style.cssText = 'position:fixed;z-index:100055;min-width:260px;max-width:360px;padding:10px;';
    popup.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">${esc(info.label)}</div>
      <div style="color:var(--fg2);line-height:1.5;word-break:break-all;">保存先: ${esc(info.detail || '未設定')}</div>
      <div style="color:var(--fg2);line-height:1.5;">Service Worker: ${navigator.serviceWorker ? '対応' : '未対応'}</div>
      <div style="color:var(--fg2);line-height:1.5;">画面: ${_isTouchMode() ? 'タッチ向け' : 'デスクトップ向け'}</div>`;
    document.body.appendChild(popup);
    const rect = anchor?.getBoundingClientRect?.();
    if (rect && typeof positionPopup === 'function') positionPopup(popup, rect, { prefer: 'above' });
    else {
      popup.style.right = '12px';
      popup.style.bottom = '32px';
    }
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
    setTimeout(() => {
      document.addEventListener('pointerdown', function closer(event) {
        if (!popup.contains(event.target) && event.target !== anchor) {
          popup.remove();
          document.removeEventListener('pointerdown', closer);
        }
      });
    }, 0);
  }

  function closeDetails() {
    document.getElementById('meldex-mode-indicator-popup')?.remove();
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
      badge.addEventListener('click', () => _showDetails(badge));
      const shortcut = document.getElementById('sb-shortcuts');
      statusBar.insertBefore(badge, shortcut || null);
    }
    const info = getModeInfo();
    badge.textContent = info.label;
    badge.title = '現在の保存先を表示';
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
