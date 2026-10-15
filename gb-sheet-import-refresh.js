/* シートの手動更新: 差分取り込みを完了してから表示を読み直す。 */
(function () {
  'use strict';
  const running = new Map();

  function cloudMode() {
    return window.MeldexRuntimeAdapter?.isBrowserDataMode?.()
      || ['dropbox', 'browser'].includes(document.body?.dataset?.cloudMode)
      || window.apiFetch?._meldexStandaloneCloudAdapter === true;
  }

  async function run(path) {
    const results = [];
    if (cloudMode()) {
      // X/Webクリップ等が別端末からDropboxへ保存した差分も、TTLを待たず取得する。
      const provider = window.MeldexStorageAdapter?.getProvider?.();
      provider?.invalidateReadCache?.(path);
      window.GbTopicLiveBridge?.clearRootsCache?.();
      const pending = JSON.parse(localStorage.getItem('meldex:quick-memo:queue:v1') || '[]');
      if (window.MeldexQuickMemoSync && Array.isArray(pending) && pending.length
        && (window.MeldexRuntimeAdapter?.isDropboxMode?.() || document.body?.dataset?.cloudMode === 'dropbox')) {
        const target = await apiFetch('/quick-memo/config', { silentError: true });
        if (target.quick_memo_folder === path && !await window.MeldexQuickMemoSync.syncQueue()) {
          throw new Error('クイックメモの送信待ちを保存できませんでした。入力は保持しています');
        }
      }
      const google = window.MeldexGoogleImportCloud;
      if (google) {
        const payload = await google.getPayload();
        const destination = String(payload?.config?.destination?.path || '').replace(/\/$/, '');
        if (destination && String(path).startsWith(destination + '/外部取り込み/Google/')) results.push(await google.run());
      }
      provider?.invalidateReadCache?.(path);
      if (results.some(result => Number(result?.errors || result?.failed || result?.conflicts || 0))) {
        throw new Error('外部データの取り込みに未完了の項目があります。取り込み済みの差分を表示し、未完了分は再試行できます');
      }
      return { results, received: true };
    }
    const plan = await apiFetch('/sheet/import-refresh?path=' + encodeURIComponent(path), { silentError: true });
    for (const action of plan.actions || []) {
      if (action.kind === 'quick-memo') {
        if (window.MeldexQuickMemoSync && !await window.MeldexQuickMemoSync.syncQueue()) {
          throw new Error('クイックメモの送信待ちを保存できませんでした。入力は保持しています');
        }
        continue;
      }
      const body = { ...action.body };
      if (action.cost_notice) {
        const limit = body.max_results ? `最大${body.max_results}件まで確認します。` : '';
        const message = `${action.label}の差分を取得します。${limit}\nX APIの追加取得料金が発生する場合があります。実行しますか？`;
        const accepted = typeof cfConfirm === 'function' ? await cfConfirm(message) : window.confirm(message);
        if (!accepted) return { results, cancelled: true };
        body.ack_cost_notice = true;
      }
      if (typeof runBackgroundJob !== 'function') throw new Error('取り込み処理を読み込めませんでした');
      const result = await runBackgroundJob(action.endpoint, body, {
        operationLabel: action.label + 'の差分を取り込んでいます',
        onProgress: progress => { if (typeof showStatus === 'function') showStatus(progress.message || action.label + 'を更新しています'); },
      });
      results.push(result);
      if (Number(result?.errors || result?.failed || 0) || Number(result?.conflicts || 0)) {
        throw new Error(action.label + 'の取り込みに失敗・競合があります。取り込み済みの差分を表示し、未完了分は再試行できます');
      }
    }
    return { results };
  }

  function refresh(path) {
    if (running.has(path)) return running.get(path);
    const promise = run(path).finally(() => running.delete(path));
    running.set(path, promise);
    return promise;
  }
  window.MeldexSheetImportRefresh = Object.freeze({ refresh });
})();
