/* gb-settings-mobile-access.js: settings dialog mobile/tablet URL helpers */
(function(global) {
  function _mobileUrlLabel(url) {
    return String(url || '').replace(/\/+$/, '') + '/';
  }

  async function copyMobileUrl(url) {
    const value = _mobileUrlLabel(url);
    if (!value || value === '/') {
      if (typeof global.showStatus === 'function') global.showStatus('コピーするURLがありません', true);
      return;
    }
    try {
      if (global.navigator?.clipboard?.writeText) {
        await global.navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement('textarea');
        input.value = value;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      if (typeof global.showStatus === 'function') global.showStatus('URLをコピーしました');
    } catch (e) {
      if (typeof global.showStatus === 'function') global.showStatus('URLのコピーに失敗しました', true);
    }
  }

  function copyPrimaryUrl() {
    const el = document.getElementById('settings-mobile-primary-url');
    copyMobileUrl(el?.dataset?.url || '');
  }

  function _escapeHtml(value) {
    if (typeof global.esc === 'function') return global.esc(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function _icon(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size) : '';
  }

  function _renderUrlList(listEl, localUrl, urls) {
    const rows = [
      `<div>このPCで開くURL: <code style="user-select:all;">${_escapeHtml(localUrl)}</code></div>`,
    ];
    if (urls.length) {
      rows.push('<div style="margin-top:4px;">スマホ・タブレット用候補URL:</div>');
      urls.forEach((url, index) => {
        rows.push(`<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;"><code style="user-select:all;">${_escapeHtml(url)}</code><button type="button" class="gb-btn gb-btn-xs" data-settings-mobile-url-index="${index}">${_icon('copy',12)} コピー</button></div>`);
      });
    } else {
      rows.push('<div style="margin-top:4px;">ネットワーク内で使えるIPアドレスを取得できませんでした。</div>');
    }
    rows.push('<div style="margin-top:6px;">スマホから開けない場合は、PC側のMeldexが起動中か、Cloud版PWA/共有URLを利用しているかを確認してください。</div>');
    listEl.innerHTML = rows.join('');
    listEl.querySelectorAll('[data-settings-mobile-url-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.settingsMobileUrlIndex || '-1', 10);
        copyMobileUrl(urls[idx] || '');
      });
    });
    if (typeof global.replaceIcons === 'function') global.replaceIcons(listEl);
  }

  async function loadMobileAccessUrlsForSettings() {
    const primaryEl = document.getElementById('settings-mobile-primary-url');
    const listEl = document.getElementById('settings-mobile-url-list');
    if (!primaryEl || !listEl) return;
    primaryEl.textContent = '読み込み中...';
    primaryEl.dataset.url = '';
    listEl.textContent = '接続情報を取得中...';
    try {
      const info = await global.apiFetch('/server-info');
      const port = parseInt(info.port || 8001, 10) || 8001;
      const ips = (Array.isArray(info.local_ips) ? info.local_ips : [info.local_ip])
        .map(ip => String(ip || '').trim())
        .filter(Boolean);
      const urls = ips
        .filter(ip => ip !== 'localhost' && ip !== '127.0.0.1')
        .map(ip => `http://${ip}:${port}/`);
      const localUrl = `http://localhost:${port}/`;
      const primary = urls[0] || localUrl;
      primaryEl.textContent = primary;
      primaryEl.dataset.url = primary;
      _renderUrlList(listEl, localUrl, urls);
    } catch (e) {
      primaryEl.textContent = '取得できませんでした';
      listEl.textContent = '接続URLを取得できませんでした。Meldexを再読み込みしてからもう一度開いてください。';
    }
  }

  global.copySettingsMobilePrimaryUrl = copyPrimaryUrl;
  global.loadMobileAccessUrlsForSettings = loadMobileAccessUrlsForSettings;
})(window);
