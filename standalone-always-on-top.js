/* standalone-always-on-top.js
 * 単独アプリのウィンドウを他のアプリより手前に固定する「常に最前面」ボタン。
 *
 * この機能はWindowsのデスクトップ版だけで動く。クラウド版（ブラウザ）や他のOSでは
 * ウィンドウを最前面に固定する手段が無いため、押しても何も起きないボタンを残さず
 * ボタン自体を出さない（サーバーが supported: false を返したら描画しない）。
 */
(function (root) {
  'use strict';

  if (typeof document === 'undefined') return;

  const ENDPOINT = '/api/window-always-on-top';

  function storageKey(appId) {
    return `meldex-${appId}-always-on-top`;
  }

  function readStored(appId) {
    try { return localStorage.getItem(storageKey(appId)) === '1'; } catch { return false; }
  }

  function writeStored(appId, enabled) {
    try { localStorage.setItem(storageKey(appId), enabled ? '1' : '0'); } catch { /* 保存できない環境では画面中だけ維持 */ }
  }

  function apiBase() {
    if (typeof root.API_BASE === 'string') return root.API_BASE;
    return root.location?.protocol === 'file:' ? 'http://127.0.0.1:8765' : '';
  }

  async function request(method, body) {
    const response = await fetch(apiBase() + ENDPOINT, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  function iconHtml(name) {
    if (typeof root.lucide === 'function') return root.lucide(name, 16);
    return '';
  }

  function applyState(button, enabled) {
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.classList.toggle('is-active', enabled);
    const label = enabled ? '常に最前面を解除' : '常に最前面にする';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = iconHtml(enabled ? 'pinOff' : 'pin') || (enabled ? '解除' : '最前面');
  }

  /**
   * @param {object} options
   *  - appId: localStorage を分けるためのアプリ識別子
   *  - host: ボタンを入れる要素（ツールバー等）
   *  - buttonClass: そのアプリのツールバーに合わせたクラス
   *  - before: この要素の手前に入れる（省略時は末尾）
   */
  async function install(options) {
    const opts = options || {};
    const host = opts.host;
    if (!host) return null;
    if (host.querySelector('[data-always-on-top]')) return null;

    let status = null;
    try {
      status = await request('GET');
    } catch {
      status = null;
    }
    // 非対応環境（クラウド版・Windows以外・APIが無い）ではボタンを出さない
    if (!status || status.supported !== true) return null;

    const appId = String(opts.appId || 'standalone');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = opts.buttonClass || 'gb-btn gb-btn-icon';
    button.dataset.alwaysOnTop = '1';
    button.dataset.e2eId = `${appId}-always-on-top`;
    button.id = `${appId}-always-on-top-button`;
    let enabled = !!status.enabled;
    applyState(button, enabled);

    button.addEventListener('click', async () => {
      const next = !enabled;
      button.disabled = true;
      try {
        const result = await request('POST', { enabled: next });
        enabled = !!result?.enabled;
        applyState(button, enabled);
        writeStored(appId, enabled);
      } catch (error) {
        if (typeof root.showStatus === 'function') {
          root.showStatus('最前面表示を切り替えられませんでした', true);
        }
      } finally {
        button.disabled = false;
      }
    });

    if (opts.before && opts.before.parentElement === host) host.insertBefore(button, opts.before);
    else host.appendChild(button);

    // 前回「常に最前面」で終了していたら、起動時に復元する
    if (!enabled && readStored(appId)) {
      try {
        const result = await request('POST', { enabled: true });
        enabled = !!result?.enabled;
        applyState(button, enabled);
      } catch { /* 復元できなくても通常表示のまま使える */ }
    }
    return button;
  }

  root.MeldexAlwaysOnTop = Object.freeze({ install });
})(typeof window !== 'undefined' ? window : globalThis);
