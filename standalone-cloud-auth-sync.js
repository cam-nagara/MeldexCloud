/* standalone-cloud-auth-sync.js: Cloud単独画面間のDropbox接続状態を同期する */
(() => {
  'use strict';

  let lastSessionSignature;
  let refreshQueue = Promise.resolve();

  async function sessionSignature() {
    const session = await window.MeldexDropboxAuth?.getSession?.().catch(() => null);
    return `${session?.accessToken ? 'connected' : 'disconnected'}:${String(session?.accountId || '')}`;
  }

  async function refreshSharedSession(force) {
    const signature = await sessionSignature();
    if (lastSessionSignature === undefined) {
      lastSessionSignature = signature;
      if (!force) return;
    }
    if (!force && lastSessionSignature === signature) return;
    lastSessionSignature = signature;
    const runtime = window.MeldexStandaloneCloud;
    if (!runtime) return;
    await runtime.init().catch(() => {});
    await runtime.disconnect({ keepSession: true, silent: true });
    const status = await runtime.init();
    window.dispatchEvent(new CustomEvent('meldex:standalone-auth-changed', { detail: status }));
  }

  function run(force) {
    refreshQueue = refreshQueue
      .catch(() => {})
      .then(() => refreshSharedSession(force))
      .catch((error) => {
        try {
          window.dispatchEvent(new CustomEvent('meldex:standalone-cloud-error', { detail: { error } }));
        } catch { /* Older embedded webviews may not support CustomEvent. */ }
      });
    return refreshQueue;
  }

  window.addEventListener('meldex:dropbox-auth-session-changed', (event) => {
    if (event?.detail?.remote === true) run(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run(false);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => run(false), { once: true });
  } else {
    queueMicrotask(() => run(false));
  }
})();
