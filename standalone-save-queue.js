/* standalone-save-queue.js: 単独アプリの書き込みAPIを直列追跡し、終了前に待機できるようにする。 */
(function (root) {
  'use strict';

  const pending = new Set();
  let lastError = '';

  function track(result, options = {}) {
    if (!result || typeof result.then !== 'function') return result;
    // 新しいファイルの作成は、断られても未保存の内容が残らない（作られないだけ）。終わるまでは待つが、
    // 結果で保存の失敗の印を付けも消しもしない（印が残ると次の「新しいシートを作成」「開く」が黙って止まっていた）。
    const affectsError = options.affectsError !== false;
    const promise = Promise.resolve(result)
      .then(value => {
        if (affectsError) lastError = '';
        return value;
      })
      .catch(error => {
        if (affectsError) lastError = String(error?.message || error || '保存に失敗しました');
        throw error;
      })
      .finally(() => pending.delete(promise));
    pending.add(promise);
    return promise;
  }

  function wrap(name) {
    const original = root[name];
    if (typeof original !== 'function' || original._meldexSaveQueue) return;
    const wrapped = function (...args) {
      // 起動要求には未保存の本文がない。失敗を保存失敗として残すと、
      // prepareClose が同じ「本体で開く」の再試行を止めてしまう。
      const path = String(args[0] || '').split('?')[0].replace(/^\/api(?=\/)/, '');
      if (name === 'apiPost' && path === '/standalone/open-target') return original.apply(this, args);
      if (name === 'apiPost' && path === '/outliner/add') return track(original.apply(this, args), { affectsError: false });
      return track(original.apply(this, args));
    };
    wrapped._meldexSaveQueue = true;
    wrapped._meldexOriginal = original;
    root[name] = wrapped;
  }

  async function flush() {
    while (pending.size) {
      const batch = Array.from(pending);
      const results = await Promise.allSettled(batch);
      if (results.some(result => result.status === 'rejected')) return false;
    }
    return !lastError;
  }

  function getCloseState() {
    return {
      appId: 'api-write-queue',
      state: lastError ? 'error' : pending.size ? 'saving' : 'clean',
      pendingLocal: pending.size > 0,
      saving: pending.size > 0,
      failed: !!lastError,
      unnamed: false,
      hasSnapshot: false,
      hasFinalDestination: true,
      shouldWarn: pending.size > 0 || !!lastError,
      message: lastError || (pending.size ? 'ファイルへの保存が完了していません' : ''),
    };
  }

  ['apiPut', 'apiPost', 'apiDelete'].forEach(wrap);
  root.addEventListener('meldex:standalone-boot-state', () => ['apiPut', 'apiPost', 'apiDelete'].forEach(wrap));
  root.MeldexStandaloneSaveQueue = Object.freeze({
    track,
    flush,
    clearError() { lastError = ''; },
    getCloseState,
    pendingCount: () => pending.size,
  });
  root.MeldexStandaloneCloseGuard?.register?.({
    appId: 'api-write-queue',
    getCloseState,
    flushLocal: flush,
    flushFinal: flush,
  });
})(typeof window !== 'undefined' ? window : globalThis);
