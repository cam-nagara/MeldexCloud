(function () {
  'use strict';

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function validCount(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function render(payload) {
    const registered = validCount(payload?.betaTesters?.registered);
    const connected = validCount(payload?.dropboxDevelopment?.connected);
    const limit = validCount(payload?.dropboxDevelopment?.limit);
    const dropboxStatus = String(payload?.dropboxDevelopment?.status || 'unverified');
    setText('beta-tester-count', registered == null ? '更新確認中' : `${registered}名`);
    if (dropboxStatus === 'production') {
      setText('dropbox-development-count', 'Production（500人枠なし）');
    } else if (connected != null && limit != null) {
      setText('dropbox-development-count', `${connected} / ${limit}`);
    } else {
      setText('dropbox-development-count', '更新確認中');
    }
    const updatedAt = payload?.updatedAt ? new Date(payload.updatedAt) : null;
    const validDate = updatedAt && !Number.isNaN(updatedAt.getTime());
    const stale = validDate && Date.now() - updatedAt.getTime() > 7 * 24 * 60 * 60 * 1000;
    setText('beta-status-updated', validDate
      ? `集計更新: ${updatedAt.toLocaleDateString('ja-JP')}${stale ? '（更新確認中）' : ''}`
      : '集計値は更新確認中です');
  }

  async function load() {
    try {
      const response = await fetch('beta-status.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.type !== 'meldex-public-beta-status' || payload?.schemaVersion !== 1) throw new Error('schema');
      render(payload);
    } catch {
      render(null);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, { once: true });
  else load();
})();
