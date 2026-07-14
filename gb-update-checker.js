(function () {
  'use strict';

  if (window.MeldexUpdateChecker) return;

  const LAST_CHECK_KEY = 'meldex-update-last-check-v1';
  const DISMISSED_KEY = 'meldex-update-dismissed-semver-v1';
  const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

  function _config() {
    return window.MeldexReleaseConfig?.updateCheck || {};
  }

  function _enabled() {
    return !!window.MeldexBetaRelease?.isUpdateCheckEnabled?.();
  }

  function _parts(value) {
    return String(value || '')
      .replace(/^v/i, '')
      .split('+')[0]
      .split('-')[0]
      .split('.')
      .map(n => parseInt(n, 10) || 0);
  }

  function _compare(a, b) {
    const av = _parts(a);
    const bv = _parts(b);
    const len = Math.max(av.length, bv.length, 3);
    for (let i = 0; i < len; i += 1) {
      const diff = (av[i] || 0) - (bv[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  async function _currentSemver() {
    try {
      const info = await window.MeldexBetaRelease?.getVersionInfo?.();
      return String(info?.semver || info?.version || '').replace(/^v/i, '').split('+')[0];
    } catch (_) {
      return '';
    }
  }

  async function _fetchLatest() {
    const cfg = _config();
    const url = String(cfg.url || cfg.latestUrl || '').trim();
    if (!url) return null;
    const res = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      semver: String(data.semver || data.version || '').replace(/^v/i, '').split('+')[0],
      version: data.version || (data.semver ? `v${data.semver}` : ''),
      url: data.url || data.pageUrl || cfg.pageUrl || '',
      notes: data.notes || '',
    };
  }

  function _showUpdateNotice(latest, current) {
    if (!latest?.semver || localStorage.getItem(DISMISSED_KEY) === latest.semver) return;
    const old = document.getElementById('meldex-update-notice');
    if (old) old.remove();
    const notice = document.createElement('div');
    notice.id = 'meldex-update-notice';
    notice.style.cssText = 'position:fixed;right:18px;bottom:34px;z-index:100050;max-width:360px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:12px;display:flex;flex-direction:column;gap:8px;font-size:13px;';
    notice.innerHTML = `<div style="font-weight:700;">新しいMeldexがあります</div>
      <div style="color:var(--fg2);line-height:1.5;">現在: ${esc(current || '不明')} / 最新: ${esc(latest.version || 'v' + latest.semver)}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="gb-btn gb-btn-sm" data-update-action="dismiss">この版は通知しない</button>
        <button class="gb-btn gb-btn-sm gb-btn-primary" data-update-action="open">詳細を見る</button>
      </div>`;
    document.body.appendChild(notice);
    notice.querySelector('[data-update-action="dismiss"]')?.addEventListener('click', () => {
      localStorage.setItem(DISMISSED_KEY, latest.semver);
      notice.remove();
    });
    notice.querySelector('[data-update-action="open"]')?.addEventListener('click', () => {
      if (latest.url) window.open(latest.url, '_blank', 'noopener');
      notice.remove();
    });
  }

  async function checkNow(options) {
    const opts = options || {};
    if (!_enabled() && !opts.force) return { ok: false, skipped: true, reason: 'disabled' };
    const last = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
    if (!opts.force && last && Date.now() - last < CHECK_INTERVAL_MS) {
      return { ok: false, skipped: true, reason: 'interval' };
    }
    try {
      const [current, latest] = await Promise.all([_currentSemver(), _fetchLatest()]);
      if (!latest?.semver) return { ok: false, skipped: true, reason: 'no-latest' };
      if (_compare(latest.semver, current) > 0) _showUpdateNotice(latest, current);
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      return { ok: true, current, latest };
    } catch (_) {
      return { ok: false, skipped: true, reason: 'network' };
    }
  }

  function _boot() {
    setTimeout(() => checkNow().catch(() => {}), 2500);
  }

  window.MeldexUpdateChecker = { checkNow };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot, { once: true });
  else _boot();
})();
