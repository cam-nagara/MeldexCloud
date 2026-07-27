/* standalone-app-bootstrap.js: UIを先に有効化し、保存先接続を独立して管理する。 */
(function () {
  'use strict';

  const DEFAULT_DELAY_MS = 8000;

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* 古いWebViewでは通知を省略する。 */ }
  }

  function notify(message, isError) {
    if (typeof window.showStatus === 'function') window.showStatus(message, isError);
    else if (isError) console.error(message);
    else console.log(message);
  }

  function create(options) {
    const config = options || {};
    let state = 'idle';
    let bound = false;
    let attempt = 0;
    let readyPromise = null;
    let delayedTimer = 0;

    function setState(next, detail) {
      state = next;
      emit('meldex:standalone-boot-state', {
        appId: String(config.appId || document.documentElement?.dataset?.standaloneApp || ''),
        state,
        attempt,
        ...(detail || {}),
      });
    }

    function bindUi() {
      if (bound) return;
      bound = true;
      config.bindUi?.();
      setState('binding-complete');
    }

    function connect() {
      bindUi();
      if (state === 'ready') return Promise.resolve(config.getReadyValue?.());
      if ((state === 'connecting' || state === 'delayed') && readyPromise) return readyPromise;
      attempt += 1;
      setState('connecting');
      clearTimeout(delayedTimer);
      delayedTimer = window.setTimeout(() => {
        if (state !== 'connecting') return;
        setState('delayed');
        notify(config.delayedMessage || '保存先への接続に時間がかかっています。画面の操作は利用できます。', true);
      }, Number(config.delayMs) > 0 ? Number(config.delayMs) : DEFAULT_DELAY_MS);
      readyPromise = Promise.resolve()
        .then(() => config.initialize?.())
        .then((value) => {
          clearTimeout(delayedTimer);
          setState('ready');
          return value;
        })
        .catch((error) => {
          clearTimeout(delayedTimer);
          readyPromise = null;
          setState('error', { error });
          config.onError?.(error);
          throw error;
        });
      return readyPromise;
    }

    async function run(label, action) {
      try {
        if (state !== 'ready') {
          notify(state === 'error'
            ? '保存先へ再接続しています...'
            : '保存先へ接続しています。完了後に操作を続けます。');
          await connect();
        }
        return await action();
      } catch (error) {
        notify(String(label || '操作') + 'できません: ' + (error?.message || error || '不明なエラー'), true);
        return null;
      }
    }

    return {
      start() {
        bindUi();
        return connect();
      },
      retry: connect,
      run,
      getState: () => state,
      isReady: () => state === 'ready',
    };
  }

  window.MeldexStandaloneBootstrap = { create };

  const previousRun = window.runStandaloneFileAction;
  window.runStandaloneFileAction = async function (label, action) {
    const boot = window.MeldexStandaloneBoot;
    if (boot?.run) return boot.run(label, action);
    if (typeof previousRun === 'function') return previousRun(label, action);
    try {
      return await action();
    } catch (error) {
      notify(String(label || '操作') + 'できません: ' + (error?.message || error || '不明なエラー'), true);
      return null;
    }
  };
})();
