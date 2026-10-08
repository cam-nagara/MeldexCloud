/* standalone-save-queue.js: 単独アプリの書き込みAPIを直列追跡し、終了前に待機できるようにする。 */
(function (root) {
  'use strict';

  const pending = new Set();
  let lastError = '';

  function track(result) {
    if (!result || typeof result.then !== 'function') return result;
    const promise = Promise.resolve(result)
      .then(value => {
        lastError = '';
        return value;
      })
      .catch(error => {
        lastError = String(error?.message || error || '保存に失敗しました');
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
