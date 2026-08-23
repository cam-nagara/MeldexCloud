(function () {
  'use strict';

  const APPS = Object.freeze([
    Object.freeze({
      id: 'viewer',
      name: 'Meldex Viewer',
      icon: 'MeldexViewer_icon_128.png',
      windowsAsset: 'MeldexViewer.zip',
      cloudUrl: 'apps/viewer/',
      description: '画像やPDFを選択またはドラッグ＆ドロップして確認できます。',
    }),
    Object.freeze({
      id: 'timer',
      name: 'Meldex Timer',
      icon: 'MeldexTimer_icon_128.png',
      windowsAsset: 'MeldexTimer.zip',
      cloudUrl: 'apps/timer/',
      description: '作業タイマーを単独で開き、執筆時間を管理できます。',
    }),
    Object.freeze({
      id: 'quick-memo',
      name: 'Meldex クイックメモ',
      icon: 'MeldexQuickMemo_icon_128.png',
      windowsAsset: 'MeldexQuickMemo.zip',
      cloudUrl: 'apps/quick-memo/',
      description: '短いメモや共有URLを、Meldex Cloudの共通接続ですばやく保存できます。',
    }),
  ]);

  function node(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function appCard(app) {
    const card = node('article', 'item available standalone-app');
    card.dataset.standaloneApp = app.id;

    const heading = node('div', 'standalone-app-head');
    const icon = node('img');
    icon.src = app.icon;
    icon.alt = '';
    heading.append(icon, node('h3', '', app.name));

    const actions = node('div', 'mode-actions');
    const download = node('a', 'button primary', 'Windows版は準備中');
    download.dataset.runtimeHref = 'standalone-' + app.id + '-download';
    download.dataset.standaloneDownload = app.id;
    download.dataset.standaloneAsset = app.windowsAsset;
    download.setAttribute('aria-disabled', 'true');
    const cloud = node('a', 'button', 'Meldex Cloudで開く');
    cloud.href = app.cloudUrl;
    actions.append(download, cloud);

    card.append(heading, node('p', '', app.description), actions);
    return card;
  }

  function githubReleasesApiUrl(releasesUrl) {
    try {
      const url = new URL(releasesUrl || '');
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.hostname !== 'github.com' || parts.length < 2) return '';
      return 'https://api.github.com/repos/' + encodeURIComponent(parts[0]) + '/'
        + encodeURIComponent(parts[1]) + '/releases?per_page=20';
    } catch (_) {
      return '';
    }
  }

  function safeDownloadUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
    try {
      const url = new URL(raw, document.baseURI || window.location?.href || 'https://meldex.invalid/');
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function setDownloadState(link, downloadUrl, releasesUrl) {
    const safeDownload = safeDownloadUrl(downloadUrl);
    const safeReleases = safeDownloadUrl(releasesUrl);
    if (safeDownload) {
      link.href = safeDownload;
      link.removeAttribute('aria-disabled');
      link.textContent = 'Windows版をダウンロード';
    } else if (safeReleases) {
      link.href = safeReleases;
      link.removeAttribute('aria-disabled');
      link.textContent = 'Windows版の配布ページを開く';
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      link.textContent = 'Windows版は準備中';
    }
  }

  async function latestReleaseAssetUrls(releasesUrl, fetchImpl) {
    const apiUrl = githubReleasesApiUrl(releasesUrl);
    if (!apiUrl) return new Map();
    try {
      const response = await fetchImpl(apiUrl, { headers: { Accept: 'application/vnd.github+json' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const releases = await response.json();
      const assets = new Map();
      (Array.isArray(releases) ? releases : []).filter((release) => !release?.draft).forEach((release) => {
        (Array.isArray(release?.assets) ? release.assets : []).forEach((asset) => {
          const name = String(asset?.name || '');
          const url = String(asset?.browser_download_url || '');
          if (name && url && !assets.has(name)) assets.set(name, url);
        });
      });
      return assets;
    } catch (error) {
      console.warn('単独アプリの公開状況を確認できませんでした', error);
      return new Map();
    }
  }

  async function applyDownloadLinks(config, releasesUrl, fetchImpl) {
    const configured = config && config.standaloneApps ? config.standaloneApps : {};
    const pending = [];
    document.querySelectorAll('[data-standalone-download]').forEach((link) => {
      const appId = link.dataset.standaloneDownload || '';
      const app = configured[appId] || {};
      const assetName = app.windowsAsset || link.dataset.standaloneAsset || '';
      const explicitUrl = safeDownloadUrl(app.downloadUrl);
      setDownloadState(link, explicitUrl, releasesUrl);
      if (!explicitUrl && assetName) pending.push({ link, assetName });
    });
    if (!pending.length) return;
    const assets = await latestReleaseAssetUrls(releasesUrl, fetchImpl || window.fetch.bind(window));
    pending.forEach(({ link, assetName }) => setDownloadState(link, assets.get(assetName) || '', releasesUrl));
  }

  async function renderAndApply(config, releasesUrl) {
    const grid = document.getElementById('standalone-app-grid');
    if (grid && grid.dataset.rendered !== '1') {
      grid.dataset.rendered = '1';
      grid.replaceChildren(...APPS.map(appCard));
    }
    await applyDownloadLinks(config, releasesUrl);
  }

  window.MeldexStandaloneDistribution = Object.freeze({
    apps: APPS,
    renderAndApply,
    latestReleaseAssetUrls,
    safeDownloadUrl,
  });
})();
