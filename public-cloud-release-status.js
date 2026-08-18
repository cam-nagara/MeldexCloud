(function () {
  'use strict';

  const VERSION_URL = 'version.json';
  const RELEASE_MANIFEST_URL = 'cloud-public-release-manifest.json';

  function setText(kind, value) {
    document.querySelectorAll(`[data-runtime-text="${kind}"]`).forEach((node) => {
      node.textContent = value;
    });
  }

  function releaseLabel(semver) {
    const normalized = String(semver || '').trim().replace(/^v/i, '');
    return normalized ? `v${normalized} BETA` : '確認できません';
  }

  function formatPublishedAt(value) {
    const date = new Date(String(value || ''));
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date) + ' JST';
  }

  async function fetchJson(path) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${path}${separator}status=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
    return response.json();
  }

  async function load() {
    setText('cloud-release-state', '公開情報を確認中');
    try {
      const [version, manifest] = await Promise.all([
        fetchJson(VERSION_URL),
        fetchJson(RELEASE_MANIFEST_URL),
      ]);
      const versionSemver = String(version?.semver || '').trim();
      const manifestSemver = String(manifest?.semver || '').trim();
      if (!versionSemver || versionSemver !== manifestSemver) {
        throw new Error('公開ファイルのバージョンが一致しません');
      }
      const publishedAt = formatPublishedAt(manifest?.generatedAt);
      if (!publishedAt) throw new Error('公開日時がありません');
      setText('cloud-version', releaseLabel(versionSemver));
      setText('cloud-published', publishedAt);
      setText('cloud-release-state', '公開ファイルを確認済み');
      return { ok: true, semver: versionSemver, publishedAt };
    } catch (error) {
      setText('cloud-published', '取得できません');
      setText('cloud-release-state', '公開情報を確認できません');
      return { ok: false, error };
    }
  }

  window.MeldexCloudReleaseStatus = {
    load,
    _internals: { releaseLabel, formatPublishedAt },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
