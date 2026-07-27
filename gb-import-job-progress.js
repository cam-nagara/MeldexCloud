/* インポート/同期系のバックグラウンドジョブ進捗ヘルパー（共通）。

   長時間処理を「開始APIでジョブID取得 → /api/jobs/{id} を定期ポーリング →
   進捗コールバックで表示更新 → 完了で結果を返す/失敗で例外」に統一する。
   アプリ内通信の待ち時間上限（最長5分）に依存せずに済ませるための共通部品。

   使い方:
     const result = await runBackgroundJob('/x-bookmarks/account-posts/sync',
       { username },
       { onProgress: (p) => setStatus(formatJobProgress(p, { unit: '件保存済み' }), false) });

   バックエンドが job_id を返さない（未ジョブ化）場合は、開始APIの返り値を
   そのまま最終結果として返すため、移行前後どちらでも呼び出せる。
*/
(function () {
  'use strict';

  const JOB_POLL_INTERVAL_MS = 1200;
  // 上限（保険）: 1.2秒 × 3000 ≒ 60分。通常はこれより早く完了/失敗する。
  const JOB_MAX_POLLS = 3000;

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function runBackgroundJob(startPath, body, options) {
    options = options || {};
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const onStarted = typeof options.onStarted === 'function' ? options.onStarted : null;
    const signal = options.signal || null;
    const pollIntervalMs = options.pollIntervalMs || JOB_POLL_INTERVAL_MS;
    const maxPolls = options.maxPolls || JOB_MAX_POLLS;
    if (typeof apiPost !== 'function' || typeof apiFetch !== 'function') {
      throw new Error('APIを利用できません');
    }

    // 開始APIはジョブIDを即返すが、大きいファイルのアップロード（ENEX/PureRef等）は
    // 本文受信自体に時間がかかるため、必要なら開始POSTの待ち時間を延ばせるようにする。
    const startOpts = { silentError: true };
    if (options.startTimeoutMs) startOpts.timeoutMs = options.startTimeoutMs;
    const started = await apiPost(startPath, body || {}, startOpts);
    const jobId = started && started.job_id;
    if (!jobId) {
      // 未ジョブ化エンドポイントとの後方互換: 返り値をそのまま最終結果として扱う
      return started;
    }
    if (onStarted) onStarted(jobId, started);

    let cancelRequested = false;
    async function cancelIfRequested() {
      if (!signal?.aborted || cancelRequested) return false;
      try {
        await apiPost('/jobs/' + encodeURIComponent(jobId) + '/cancel', {}, { silentError: true });
        cancelRequested = true;
      } catch (cause) {
        const error = new Error(
          '中止要求を送信できませんでした。処理は裏側で続いている可能性があります。'
        );
        error.name = 'CancelRequestError';
        error.jobId = jobId;
        error.cause = cause;
        throw error;
      }
      return true;
    }

    let missCount = 0;
    for (let i = 0; i < maxPolls; i += 1) {
      await cancelIfRequested();
      let job;
      try {
        job = await apiFetch('/jobs/' + encodeURIComponent(jobId), { silentError: true });
      } catch (err) {
        // 一時的な通信タイムアウトはポーリングを継続する（処理はサーバ側で継続中）
        if (err && err.isTimeout) { await delay(pollIntervalMs); continue; }
        // ジョブが見つからない（サーバ再起動等）場合は数回まで許容してから諦める
        if (err && /404/.test(String(err.message || '')) && missCount < 3) {
          missCount += 1;
          await delay(pollIntervalMs);
          continue;
        }
        throw err;
      }
      missCount = 0;
      if (onProgress) {
        try { onProgress(job.progress || {}, job); } catch (_) { /* 表示更新失敗は無視 */ }
      }
      if (job.status === 'done') return job.result || {};
      if (job.status === 'cancelled' || job.status === 'canceled') {
        const error = new Error('処理を中止しました');
        error.name = 'AbortError';
        error.jobId = jobId;
        throw error;
      }
      if (job.status === 'error') {
        const error = new Error(job.error || '処理に失敗しました');
        error.jobError = job;
        error.errorDetail = job.error_detail || null;
        error.errorStatus = job.error_status || null;
        throw error;
      }
      await delay(pollIntervalMs);
    }
    throw new Error('処理が長時間続いています。時間をおいてフォルダを確認してください。');
  }

  // 進捗オブジェクトを表示テキストへ整形する既定フォーマッタ。
  //   options.unit    件数の後ろに付ける語（既定: '件'。例: '件保存済み'）
  //   options.defaultPhase フェーズ未設定時の見出し（既定: '処理中'）
  function formatJobProgress(progress, options) {
    progress = progress || {};
    options = options || {};
    if (progress.message) return String(progress.message);
    const unit = options.unit || '件';
    const defaultPhase = options.defaultPhase || '処理中';
    const phase = progress.phase || defaultPhase;
    const processed = Number(progress.processed) || 0;
    const total = Number(progress.total);
    const count = Number.isFinite(total) && total > 0
      ? processed + '/' + total + unit
      : processed + unit;
    return phase + '… ' + count;
  }

  window.runBackgroundJob = runBackgroundJob;
  window.formatJobProgress = formatJobProgress;
})();
