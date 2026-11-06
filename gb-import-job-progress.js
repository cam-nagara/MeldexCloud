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
  // Worker completion, not elapsed time, determines when observation ends.
  // A caller may still request an explicit diagnostic polling limit.
  const JOB_MAX_POLLS = Infinity;
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
        const status = Number(err?.status || err?.statusCode || 0);
        if (err?.isTimeout || err?.name === 'TypeError' || status === 429 || status >= 500) {
          await delay(Math.max(pollIntervalMs, 1000)); continue;
        }
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

  // 翻訳待ちは保存済みポスト全体の残件で、今回の取り込み失敗ではない。
  function describeImportResult(result) {
    result = result || {};
    const labels = {
      failed: '保存失敗', errors: 'エラー', failed_assets: '添付取得失敗', conflicts: '競合',
      blocked: '処理不可', unsupported: '未対応', unprocessed: '未処理',
      media_failed: '画像取得失敗', author_icon_failed: 'アイコン取得失敗',
      reply_unavailable: '返信取得不可', reference_unavailable: '参照ポスト取得不可',
    };
    const issues = Object.entries(labels).filter(([key]) => Number(result[key]) > 0)
      .map(([key, label]) => label + Number(result[key]) + '件');
    const samples = result.failure_samples || result.failures;
    const details = Array.isArray(samples) ? [...samples] : [];
    if (result.folder_error) {
      issues.push('フォルダ取得失敗');
      details.push({ stage: 'フォルダ', message: String(result.folder_error) });
    }
    (Array.isArray(result.warnings) ? result.warnings : []).forEach(message => {
      issues.push(String(message));
    });
    const pending = Number(result.translation_pending_existing || 0) + Number(result.translation_pending_replies || 0);
    const pendingText = pending > 0 ? '翻訳待ち' + pending + '件（原文は保存済み）。設定の「保存済みポストの翻訳を続ける」で再開できます。' : '';
    const summary = [result.summary || '取り込みが終了しました', issues.join(' / '), pendingText].filter(Boolean).join('。');
    if (Number(result.media_failed) > 0 || Number(result.author_icon_failed) > 0) details.push({ message: '設定で前回保存の内訳と保存先を確認してください。取得できなかった画像・アイコンは、X上の元ポストでも確認できます。' });
    if (Number(result.reply_unavailable) > 0 || Number(result.reference_unavailable) > 0) details.push({ message: '削除済み・非公開や通信失敗などにより、返信や参照ポストを取得できませんでした。保存済みの原文は残ります。返信の追加取得は設定から実行でき、X APIの料金が発生します。' });
    return { partial: issues.length > 0, summary, details };
  }

  // 通信/ジョブ処理は従来実装を保ち、表示だけを共通操作状態へ接続する。
  async function runBackgroundJob(startPath, body, options) {
    const opts = options || {};
    const progressApi = window.MeldexOperationProgress;
    let cancelJobId = '';
    let operation = opts.operationProgress === false || !progressApi
      ? null
      : progressApi.begin({
          kind: String(opts.operationKind || 'background-job'),
          settingsPanel: String(startPath || '').startsWith('/x-bookmarks/') ? 'Xブックマーク' : '',
          label: _operationLabel(startPath, opts),
          mode: 'indeterminate',
          background: true,
          delayMs: opts.operationDelayMs,
          showInTray: opts.showInTray !== false,
          priority: Number(opts.operationPriority) || 20,
          cancellable: false,
          cancelCompletes: false,
          cancel: async () => {
            if (cancelJobId) await apiPost('/jobs/' + encodeURIComponent(cancelJobId) + '/cancel', {}, { silentError: true });
          },
        });
    const userOnStarted = typeof opts.onStarted === 'function' ? opts.onStarted : null;
    const userOnProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const wrapped = Object.assign({}, opts, {
      onStarted: function (jobId, started) {
        cancelJobId = jobId;
        const existing = progressApi?.findByPersistentJobId(jobId);
        if (operation && existing && existing.id !== operation.id) {
          operation.dispose();
          operation = existing;
        }
        operation?.setPersistentJobId(jobId);
        operation?.update({ status: started?.status || 'running', phase: started?.status === 'queued' ? '待機中' : '準備中', cancellable: true });
        if (userOnStarted) userOnStarted(jobId, started);
      },
      onProgress: function (progress, job) {
        const total = Number(progress?.total);
        // Terminal states are finalized below with their result/exception.
        // Marking "cancelled" here would bypass completion and auto-dismiss.
        const activeStatus = ['queued', 'running', 'cancelling'].includes(job?.status) ? job.status : operation?.getState()?.status || 'running';
        operation?.update({
          status: job?.cancel_requested || (activeStatus === 'running' && operation?.getState()?.status === 'cancelling') ? 'cancelling' : activeStatus,
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
      if (result?.ok === false) {
        operation?.fail({ error: result.error || result.message || '処理に失敗しました' });
      } else {
        const outcome = describeImportResult(result);
        if (outcome.partial) operation?.partial(outcome);
        else operation?.succeed({ ...outcome, summary: opts.successMessage || outcome.summary });
      }
      return result;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const partial = error.jobStatus?.result;
        operation?.cancelled({ summary: partial?.unprocessed !== undefined
          ? `${error.message}。新規${partial.created || 0} / 更新${partial.updated || 0} / 未処理${partial.unprocessed}` : error.message });
      }
      else if (error?.jobError || error?.jobStatus?.status === 'error' || !operation?.getState()?.persistentJobId) operation?.fail({ error: error });
      else if (error?.name === 'LongRunningJobError' || [400, 401, 403, 404].includes(Number(error?.status)) || /HTTP 404/.test(error?.message || '')) operation?.unknown({ summary: '進捗を確認できないため、処理の結果は未確認です。取り込みの前回結果を確認してください。' });
      else operation?.update({ message: error?.name === 'LongRunningJobError' ? error.message : '進捗を確認できません。処理が終了したかは未確認です。' });
      throw error;
    }
  }

  // 進捗オブジェクトを表示テキストへ整形する既定フォーマッタ。
  //   options.unit    件数の後ろに付ける語（既定: '件'。例: '件保存済み'）
  //   options.defaultPhase フェーズ未設定時の見出し（既定: '処理中'）
  function formatJobProgress(progress, options) {
    progress = progress || {};
    options = options || {};
    const unit = options.unit || '件';
    const defaultPhase = options.defaultPhase || '処理中';
    const phase = progress.phase || defaultPhase;
    const processed = Number(progress.processed) || 0;
    const total = Number(progress.total);
    const count = Number.isFinite(total) && total > 0
      ? processed + '/' + total + unit
      : processed + unit;
    return phase + '… ' + count + (progress.message ? ' · ' + String(progress.message) : '');
  }

  // 残り時間の見込みを短い日本語にする。ジョブ進捗を出す画面で共有する。
  function formatJobEta(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return Math.ceil(value) + '秒';
    if (value < 3600) return Math.ceil(value / 60) + '分';
    if (value < 86400) return (value / 3600).toFixed(value < 36000 ? 1 : 0) + '時間';
    return (value / 86400).toFixed(1) + '日';
  }

  window.describeImportResult = describeImportResult;
  window.runBackgroundJob = runBackgroundJob;
  window.formatJobProgress = formatJobProgress;
  window.formatJobEta = formatJobEta;
})();
