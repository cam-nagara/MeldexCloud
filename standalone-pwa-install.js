/* Install affordance shared by standalone Cloud PWAs. */
(function () {
  'use strict';

  const state = {
    initialized: false,
    deferredPrompt: null,
    installed: false,
    dialogOpen: false,
    swRegistration: null,
    lastFocus: null,
    refs: {},
  };

  function _isCloud() {
    return document.documentElement?.hasAttribute('data-standalone-cloud') === true;
  }

  function _isIos() {
    const platform = String(navigator.platform || '');
    const agent = String(navigator.userAgent || '');
    return /iPad|iPhone|iPod/i.test(agent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function _isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches === true
      || navigator.standalone === true;
  }

  function _el(tag, attributes, text) {
    const node = document.createElement(tag);
    Object.entries(attributes || {}).forEach(([name, value]) => {
      if (value == null) return;
      if (name === 'className') node.className = value;
      else if (name === 'hidden') node.hidden = !!value;
      else if (name === 'type') node.type = value;
      else node.setAttribute(name, String(value));
    });
    if (text != null) node.textContent = String(text);
    return node;
  }

  function _style() {
    if (document.getElementById('sa-pwa-install-style')) return;
    const style = _el('style', { id: 'sa-pwa-install-style' });
    // 色は本体の「ダーク」プリセット（gb-theme.css の --bg 系）を参照する。以前はここだけ独自の
    // 配色（旧 --sa-workspace-* とほぼ同じ退役済みパレット）を直書きしていた
    // （単独アプリのダークモード統一計画 app/docs/standalone-apps-dark-theme-unification-plan-2026-08-13.md）。
    style.textContent = `
      .sa-pwa-install-button{position:fixed;z-index:9989;inset-inline-end:max(12px,env(safe-area-inset-right));inset-block-end:max(12px,env(safe-area-inset-bottom));min-width:44px;min-height:44px;padding:8px 14px;border:1px solid var(--border,#2b323b);border-radius:999px;background:var(--bg3,#181c22);color:var(--fg,#d4d4d4);box-shadow:0 4px 18px rgb(0 0 0 / 38%);font:600 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;touch-action:manipulation}
      .sa-pwa-install-button:hover{background:var(--bg4,#242a32)}.sa-pwa-install-button:focus-visible,.sa-pwa-install-dialog button:focus-visible{outline:3px solid color-mix(in srgb, var(--accent,#569cd6) 65%, #fff);outline-offset:2px}
      .sa-pwa-install-backdrop{position:fixed;z-index:10015;inset:0;background:rgb(4 6 10 / 66%);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
      .sa-pwa-install-dialog{position:fixed;z-index:10016;inset-inline-start:50%;inset-block-start:50%;translate:-50% -50%;display:grid;gap:14px;width:min(440px,calc(100vw - 28px));max-height:min(620px,calc(var(--sa-visual-height,100dvh) - 28px));box-sizing:border-box;padding:20px;overflow:auto;border:1px solid var(--border,#2b323b);border-radius:14px;background:var(--bg2,#111419);color:var(--fg,#d4d4d4);box-shadow:0 18px 54px rgb(0 0 0 / 50%);color-scheme:dark;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
      .sa-pwa-install-dialog[hidden],.sa-pwa-install-backdrop[hidden],.sa-pwa-install-button[hidden]{display:none!important}.sa-pwa-install-dialog h2,.sa-pwa-install-dialog p,.sa-pwa-install-dialog ol{margin:0}.sa-pwa-install-dialog p,.sa-pwa-install-dialog ol{color:var(--fg2,#969696)}.sa-pwa-install-dialog ol{padding-inline-start:24px}.sa-pwa-install-dialog li+li{margin-block-start:8px}
      .sa-pwa-install-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.sa-pwa-install-actions button{min-height:44px;padding:8px 14px;border:1px solid var(--border,#2b323b);border-radius:8px;background:var(--bg3,#181c22);color:var(--fg,#d4d4d4);font:600 14px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;touch-action:manipulation}.sa-pwa-install-actions .is-primary{border-color:var(--accent,#569cd6);background:color-mix(in srgb, var(--accent,#569cd6) 78%, #000)}
      .sa-pwa-install-status{min-height:20px;color:var(--fg2,#969696);font-size:12px}.sa-pwa-install-status.is-error{color:var(--red,#f44747)}@media(pointer:coarse){.sa-pwa-install-button,.sa-pwa-install-dialog button{min-height:44px}}`;
    document.head.appendChild(style);
  }

  function _createDom() {
    _style();
    const refs = state.refs;
    refs.button = _el('button', {
      type: 'button', className: 'sa-pwa-install-button', 'aria-haspopup': 'dialog',
      'aria-controls': 'sa-pwa-install-dialog',
    }, 'ホームに追加');
    refs.backdrop = _el('div', { className: 'sa-pwa-install-backdrop', hidden: true });
    refs.dialog = _el('section', {
      id: 'sa-pwa-install-dialog', className: 'sa-pwa-install-dialog', role: 'dialog',
      'aria-modal': 'true', 'aria-labelledby': 'sa-pwa-install-title', hidden: true,
    });
    refs.title = _el('h2', { id: 'sa-pwa-install-title' }, 'ホーム画面に追加');
    refs.lead = _el('p');
    refs.steps = _el('ol');
    refs.status = _el('div', {
      className: 'sa-pwa-install-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true',
    });
    refs.actions = _el('div', { className: 'sa-pwa-install-actions', 'data-dialog-actions': '1' });
    refs.close = _el('button', { type: 'button' }, '閉じる');
    refs.install = _el('button', { type: 'button', className: 'is-primary' }, 'この端末に追加');
    refs.actions.append(refs.close, refs.install);
    refs.dialog.append(refs.title, refs.lead, refs.steps, refs.status, refs.actions);
    document.body.append(refs.button, refs.backdrop, refs.dialog);
  }

  function _setStatus(message, error) {
    state.refs.status.textContent = String(message || '');
    state.refs.status.classList.toggle('is-error', !!error);
  }

  function _renderInstructions() {
    const refs = state.refs;
    refs.steps.replaceChildren();
    const ios = _isIos();
    const canPrompt = !!state.deferredPrompt;
    refs.lead.textContent = ios
      ? 'Safariから、このアプリをiPhoneまたはiPadのホーム画面へ追加できます。'
      : canPrompt
        ? 'このアプリを独立した画面で使えるように、この端末へ追加できます。'
        : 'ブラウザのメニューから、このアプリをホーム画面またはアプリ一覧へ追加できます。';
    const steps = ios
      ? ['Safari下部または上部の共有ボタンを押します。', '「ホーム画面に追加」を選びます。', '右上の「追加」を押します。']
      : canPrompt
        ? ['下の「この端末に追加」を押します。', 'ブラウザの確認画面で「インストール」または「追加」を選びます。']
        : ['ブラウザのメニューを開きます。', '「アプリをインストール」または「ホーム画面に追加」を選びます。'];
    steps.forEach((step) => refs.steps.appendChild(_el('li', {}, step)));
    refs.install.hidden = ios || !canPrompt;
  }

  function showInstructions() {
    if (!state.initialized || state.installed) return;
    state.lastFocus = document.activeElement;
    state.dialogOpen = true;
    _renderInstructions();
    _setStatus('', false);
    state.refs.backdrop.hidden = false;
    state.refs.dialog.hidden = false;
    queueMicrotask(() => (state.refs.install.hidden ? state.refs.close : state.refs.install).focus());
  }

  function closeInstructions() {
    if (!state.dialogOpen) return;
    state.dialogOpen = false;
    state.refs.backdrop.hidden = true;
    state.refs.dialog.hidden = true;
    state.lastFocus?.focus?.();
  }

  async function promptInstall() {
    if (state.installed) return { outcome: 'installed' };
    const prompt = state.deferredPrompt;
    if (!prompt) {
      showInstructions();
      return { outcome: 'unavailable' };
    }
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      state.deferredPrompt = null;
      if (choice?.outcome === 'accepted') {
        _setStatus('ホーム画面への追加を受け付けました。', false);
      } else {
        _setStatus('追加はキャンセルされました。いつでも後から追加できます。', false);
      }
      _updateButton();
      return choice || { outcome: 'dismissed' };
    } catch (error) {
      _setStatus(error?.message || 'ホーム画面へ追加できませんでした。', true);
      return { outcome: 'error', error };
    }
  }

  function _updateButton() {
    state.installed = _isStandalone() || state.installed;
    if (!state.refs.button) return;
    state.refs.button.hidden = state.installed;
    state.refs.button.textContent = state.deferredPrompt ? 'この端末に追加' : 'ホームに追加';
  }

  function _focusables() {
    return [...state.refs.dialog.querySelectorAll('button:not([hidden]):not([disabled]),a[href]')]
      .filter((node) => node.offsetParent !== null);
  }

  function _keydown(event) {
    if (!state.dialogOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeInstructions();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = _focusables();
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function init() {
    if (!_isCloud()) return { initialized: false, cloud: false };
    if (state.initialized) return getState();
    _createDom();
    state.initialized = true;
    state.installed = _isStandalone();
    state.refs.button.addEventListener('click', () => {
      if (state.deferredPrompt) promptInstall();
      else showInstructions();
    });
    state.refs.install.addEventListener('click', promptInstall);
    state.refs.close.addEventListener('click', closeInstructions);
    state.refs.backdrop.addEventListener('click', closeInstructions);
    document.addEventListener('keydown', _keydown, true);
    _updateButton();
    return getState();
  }

  function getState() {
    return {
      cloud: _isCloud(), initialized: state.initialized, installed: state.installed,
      canPrompt: !!state.deferredPrompt, ios: _isIos(), dialogOpen: state.dialogOpen,
      serviceWorkerReady: !!state.swRegistration,
    };
  }

  async function registerServiceWorker() {
    if (!_isCloud() || !('serviceWorker' in navigator)) return null;
    if (state.swRegistration) return state.swRegistration;
    const manifest = document.querySelector('link[rel="manifest"]');
    if (!manifest?.href) throw new Error('このアプリのmanifestが見つかりません');
    const manifestUrl = new URL(manifest.href, window.location.href);
    if (manifestUrl.origin !== window.location.origin) throw new Error('manifestはアプリと同じ配布元に置いてください');
    const serviceWorkerUrl = new URL('sw.js', manifestUrl);
    const scopeUrl = new URL('./', manifestUrl);
    try {
      state.swRegistration = await navigator.serviceWorker.register(serviceWorkerUrl.href, {
        scope: scopeUrl.pathname,
        updateViaCache: 'none',
      });
      return state.swRegistration;
    } catch (error) {
      console.warn('Standalone PWA service worker registration failed:', error);
      if (state.initialized) _setStatus('オフライン準備を完了できませんでした。オンラインでは引き続き使えます。', true);
      throw error;
    }
  }

  if (_isCloud()) {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.deferredPrompt = event;
      _updateButton();
    });
    window.addEventListener('appinstalled', () => {
      state.installed = true;
      state.deferredPrompt = null;
      closeInstructions();
      _updateButton();
    });
    window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', _updateButton);
    const start = () => {
      init();
      if (document.readyState === 'complete') registerServiceWorker().catch(() => {});
      else window.addEventListener('load', () => registerServiceWorker().catch(() => {}), { once: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else queueMicrotask(start);
  }

  window.MeldexStandalonePwaInstall = {
    init,
    promptInstall,
    showInstructions,
    closeInstructions,
    registerServiceWorker,
    getState,
  };
})();
