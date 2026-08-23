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
  const JOB_LONG_RUNNING_NOTICE_MS = 5 * 60 * 1000;

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function _runBackgroundJobImpl(startPath, body, options) {
    options = options || {};
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const onStarted = typeof options.onStarted === 'function' ? options.onStarted : null;
    const onLongRunning = typeof options.onLongRunning === 'function' ? options.onLongRunning : null;
    const signal = options.signal || null;
    const pollIntervalMs = options.pollIntervalMs !== undefined
      && Number.isFinite(Number(options.pollIntervalMs))
      ? Math.max(0, Number(options.pollIntervalMs))
      : JOB_POLL_INTERVAL_MS;
    const requestedMaxPolls = Number(options.maxPolls);
    const maxPolls = options.maxPolls === undefined
      || Number.isNaN(requestedMaxPolls)
      || requestedMaxPolls <= 0
      ? JOB_MAX_POLLS
      : requestedMaxPolls;
    const hasPollLimit = Number.isFinite(maxPolls);
    const longRunningAfterMs = options.longRunningAfterMs !== undefined
      && Number.isFinite(Number(options.longRunningAfterMs))
      ? Math.max(0, Number(options.longRunningAfterMs))
      : JOB_LONG_RUNNING_NOTICE_MS;
    if (typeof apiPost !== 'function' || typeof apiFetch !== 'function') {
      throw new Error('APIを利用できません');
    }

    let started = null;
    let jobId = String(options.resumeJobId || '').trim();
    if (!jobId) {
      // 開始APIはジョブIDを即返すが、大きいファイルのアップロード（ENEX/PureRef等）は
      // 本文受信自体に時間がかかるため、必要なら開始POSTの待ち時間を延ばせるようにする。
      const startOpts = { silentError: true };
      if (options.startTimeoutMs) startOpts.timeoutMs = options.startTimeoutMs;
      started = await apiPost(startPath, body || {}, startOpts);
      jobId = String(started?.job_id || '');
    }
    if (!jobId) {
      // 未ジョブ化エンドポイントとの後方互換: 返り値をそのまま最終結果として扱う
      return started;
    }
    if (onStarted) onStarted(jobId, started || { job_id: jobId, status: 'running', resumed: true });

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
    let longRunningNotified = false;
    const pollStartedAt = Date.now();
    for (let i = 0; !hasPollLimit || i < maxPolls; i += 1) {
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
      if (!longRunningNotified && onLongRunning && Date.now() - pollStartedAt >= longRunningAfterMs) {
        longRunningNotified = true;
        try { onLongRunning(job, jobId); } catch (_) { /* 表示更新失敗は無視 */ }
      }
      if (job.status === 'done') return job.result || {};
      if (job.status === 'cancelled' || job.status === 'canceled') {
        const error = new Error('処理を中止しました');
        error.name = 'AbortError';
        error.jobId = jobId;
        error.jobStatus = job;
        throw error;
      }
      if (job.status === 'error') {
        const error = new Error(job.error || '処理に失敗しました');
        error.jobError = job;
        error.jobStatus = job;
        error.errorDetail = job.error_detail || null;
        error.errorStatus = job.error_status || null;
        throw error;
      }
      await delay(pollIntervalMs);
    }
    const error = new Error('処理が長時間続いています。保存処理は裏側で続いている可能性があります。');
    error.name = 'LongRunningJobError';
    error.jobId = jobId;
    throw error;
  }

  function _operationLabel(startPath, options) {
    if (options?.operationLabel || options?.label) return String(options.operationLabel || options.label);
    const path = String(startPath || '').toLowerCase();
    if (path.includes('duplicate')) return '重複を確認しています';
    if (path.includes('tag')) return 'タグを処理しています';
    if (path.includes('import') || path.includes('sync')) return 'データを取り込んでいます';
    if (path.includes('rebuild') || path.includes('index')) return '索引を更新しています';
    return '処理しています';
  }

  // 通信/ジョブ処理は従来実装を保ち、表示だけを共通操作状態へ接続する。
  async function runBackgroundJob(startPath, body, options) {
    const opts = options || {};
    const progressApi = window.MeldexOperationProgress;
    const operation = opts.operationProgress === false || !progressApi
      ? null
      : progressApi.begin({
          kind: String(opts.operationKind || 'background-job'),
          label: _operationLabel(startPath, opts),
          mode: 'indeterminate',
          background: true,
          delayMs: opts.operationDelayMs,
          showInTray: opts.showInTray !== false,
          showInStatus: opts.showInStatus !== false,
          priority: Number(opts.operationPriority) || 20,
        });
    const userOnStarted = typeof opts.onStarted === 'function' ? opts.onStarted : null;
    const userOnProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const wrapped = Object.assign({}, opts, {
      onStarted: function (jobId, started) {
        operation?.setPersistentJobId(jobId);
        operation?.update({ status: started?.status || 'running', phase: started?.status === 'queued' ? '待機中' : '準備中' });
        if (userOnStarted) userOnStarted(jobId, started);
      },
      onProgress: function (progress, job) {
        const total = Number(progress?.total);
        operation?.update({
          status: job?.status || 'running',
          mode: total > 0 ? 'determinate' : 'indeterminate',
          processed: Number(progress?.processed) || 0,
          total: total > 0 ? total : null,
          phase: progress?.phase || '',
          message: progress?.message || '',
          currentItem: progress?.current_item || progress?.current || '',
          rate: progress?.rate,
          eta: progress?.eta_seconds ?? progress?.eta,
        });
        if (userOnProgress) userOnProgress(progress, job);
      },
    });
    try {
      const result = await _runBackgroundJobImpl(startPath, body, wrapped);
      operation?.succeed({ summary: opts.successMessage || '完了しました' });
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') operation?.cancelled({ summary: error.message });
      else operation?.fail({ error: error });
      throw error;
    }
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

  // 残り時間の見込みを短い日本語にする。ジョブ進捗を出す画面で共有する。
  function formatJobEta(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return Math.ceil(value) + '秒';
    if (value < 3600) return Math.ceil(value / 60) + '分';
    if (value < 86400) return (value / 3600).toFixed(value < 36000 ? 1 : 0) + '時間';
    return (value / 86400).toFixed(1) + '日';
  }

  window.runBackgroundJob = runBackgroundJob;
  window.formatJobProgress = formatJobProgress;
  window.formatJobEta = formatJobEta;
})();
