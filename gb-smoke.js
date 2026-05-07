/* ==============================
   gb-smoke.js: frontend smoke entrypoint
   ============================== */

(function () {
  const enabled = !!window.GBE2E?.enabled;

  async function run() {
    if (!enabled) return null;
    return window.GBE2E.run();
  }

  window.GBSmoke = { enabled, run };
})();
