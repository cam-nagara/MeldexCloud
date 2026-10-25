// 既存のインポート進捗APIをMeldexOperationProgressへ接続する互換ファサード。
// importジョブの再読込復元と、既存のbegin/update/finish呼び出しを共通状態へ統合する。
(function () {
  'use strict';

  const POLL_INTERVAL_MS = 1500;
  const CATEGORY = 'import';
  const KIND_LABELS = {
    'notion-sync': 'Notion同期',
    'x-bookmarks': 'Xブックマーク',
    'x-bookmark-notes': 'Xブックマークのノート',
    'x-bookmark-post': 'Xポスト',
    'x-bookmark-translations': 'Xポストの翻訳',
    'x-account-posts': 'Xアカウント投稿',
    'external-import': '外部取り込み',
    'pureref-import': 'PureRef取り込み',
    'enex-import': 'ENEX取り込み',
    'webclip-inbox': 'Web受信箱',
  };
  const restoredJobs = new Map();
  const foregroundStack = [];
  let pollTimer = null;
  let polling = false;

  function _progressApi() { return window.MeldexOperationProgress || null; }
  function _kindLabel(kind) { return KIND_LABELS[kind] || kind || 'インポート'; }
  function _apiAvailable() { return typeof apiFetch === 'function'; }

  function _jobLabel(job) {
    const kind = _kindLabel(job?.kind);
    return job?.label ? kind + ': ' + job.label : kind;
  }

  function _activeJobs(jobs) {
    const priority = { running: 0, cancelling: 1, queued: 2 };
    return jobs
      .filter(function (job) { return job.status === 'running' || job.status === 'cancelling' || job.status === 'queued'; })
      .sort(function (a, b) {
        const diff = (priority[a.status] ?? 9) - (priority[b.status] ?? 9);
        if (diff) return diff;
        return (a.started_at || a.queued_at || 0) - (b.started_at || b.queued_at || 0);
      });
  }

  function _syncJob(job) {
    const api = _progressApi();
    if (!api || !job?.id) return null;
    const jobId = String(job.id);
    let handle = api.findByPersistentJobId(jobId) || restoredJobs.get(jobId)?.handle;
    // 定期巡回だけでは通知しない。実際の取得開始か、取得結果・失敗を待つ。
    if (!handle && job.kind === 'webclip-inbox'
        && ['queued', 'running'].includes(job.status)
        && !job.progress?.current && !(Number(job.progress?.processed) > 0)) {
      restoredJobs.set(jobId, { handle: null, misses: 0 });
      return null;
    }
    if (!handle) {
      handle = api.begin({
        id: 'job-' + jobId,
        kind: String(job.kind || 'import'),
        label: _jobLabel(job),
        phase: job.status === 'queued' ? '待機中' : String(job.progress?.phase || '準備中'),
        status: job.status,
        mode: Number(job.progress?.total) > 0 ? 'determinate' : 'indeterminate',
        processed: Number(job.progress?.processed) || 0,
        total: Number(job.progress?.total) || null,
        persistentJobId: jobId,
        background: true,
        showImmediately: true,
        priority: job.status === 'running' ? 20 : 10,
      });
    }
    const rawTotal = Number(job.progress?.total);
    let processed = Math.max(0, Number(job.progress?.processed) || 0);
    handle.update({
      label: _jobLabel(job),
      phase: job.status === 'queued' ? '待機中' : String(job.progress?.phase || '準備中'),
      status: job.status,
      mode: rawTotal > 0 ? 'determinate' : 'indeterminate',
      processed: processed,
      total: rawTotal > 0 ? rawTotal : null,
      currentItem: job.progress?.current_item || job.progress?.current || '',
      rate: job.progress?.rate,
      eta: job.progress?.eta_seconds ?? job.progress?.eta,
      message: job.progress?.message || '',
      persistentJobId: jobId,
    });
    restoredJobs.set(jobId, { handle: handle, misses: 0 });
    return handle;
  }

  async function _scheduledJobSnapshot(jobId) {
    const data = await apiFetch('/import-schedules', { silentError: true });
    for (const schedule of (Array.isArray(data?.schedules) ? data.schedules : [])) {
      const run = schedule.last_run;
      if (String(run?.job_id || '') !== jobId || !['done', 'error', 'cancelled'].includes(run.status)) continue;
      const legacyXSummary = run.status === 'done' && schedule.category === 'x-bookmarks'
        && typeof run.summary?.ok !== 'boolean';
      return {
        id: jobId, kind: schedule.category, label: schedule.label, status: legacyXSummary ? 'unknown' : run.status,
        result: { ...(run.summary || {}), summary: legacyXSummary
          ? '処理終了の記録はありますが、項目別の結果は残っていません。取り込み予定の前回結果を確認してください。'
          : '定期実行の結果を保存済みの記録から確認しました' },
        error: run.error,
      };
    }
    return null;
  }

  async function _resolveMissingJob(jobId, entry) {
    let job;
    try {
      job = await apiFetch('/jobs/' + encodeURIComponent(jobId), { silentError: true });
    } catch (error) {
      if (!/404/.test(String(error?.message || ''))) { entry.misses = 0; return; }
      if (++entry.misses < 2) return;
      // 完了ジョブは1時間で破棄され、再起動でもメモリから消える。
      // 予定の永続記録が同じjob_idを示す場合だけ、その確定結果を採用する。
      try { job = await _scheduledJobSnapshot(jobId); }
      catch (_) { return; } // 記録の取得失敗も処理そのものの失敗にはしない。
      if (!job) {
        const status = entry.handle?.getState()?.status;
        if (status === 'running' || status === 'queued' || status === 'cancelling') {
          entry.handle.unknown({ summary: 'ジョブの記録を取得できないため、完了・失敗を判定できません。取り込み予定の前回結果を確認してください。' });
        }
        restoredJobs.delete(jobId);
        return;
      }
    }
    entry.misses = 0;
    if (job?.status === 'done') {
      const result = job.result || {};
      if (!entry.handle && job.kind === 'webclip-inbox'
          && result.ok !== false && !['saved', 'failed', 'recovered'].some(key => Number(result[key]) > 0)) {
        restoredJobs.delete(jobId);
        return;
      }
      entry.handle = entry.handle || _syncJob(job);
      const values = { summary: result.summary || '取り込みが完了しました', details: result.failure_samples || result.failures || [] };
      if (result.ok === false) entry.handle.fail({ error: result.error || result.message || '取り込みに失敗しました', ...values });
      else if (['failed', 'errors', 'media_failed', 'author_icon_failed', 'translation_pending_existing', 'translation_pending_replies', 'reply_unavailable', 'reference_unavailable'].some(key => Number(result[key]) > 0) || result.folder_error) entry.handle.partial({ ...values, summary: result.summary || '取り込みが終了しました（未取得・翻訳待ちを含む）' });
      else entry.handle.succeed(values);
      restoredJobs.delete(jobId);
    } else if (job?.status === 'cancelled' || job?.status === 'canceled') {
      entry.handle?.cancelled({ summary: '取り込みを中止しました' });
      restoredJobs.delete(jobId);
    } else if (job?.status === 'error') {
      entry.handle = entry.handle || _syncJob(job);
      entry.handle.fail({
        error: job.error || '取り込みに失敗しました',
        details: job.result?.failure_samples || job.error_detail?.failure_samples || [],
      });
      restoredJobs.delete(jobId);
    } else if (job?.status === 'unknown') {
      entry.handle?.unknown({ summary: job.result?.summary || '取り込み結果の内訳を確認できません。' });
      restoredJobs.delete(jobId);
    } else if (job) {
      _syncJob(job);
    }
  }

  async function poll() {
    if (!_apiAvailable() || polling) return;
    polling = true;
    try {
      const data = await apiFetch('/jobs?category=' + encodeURIComponent(CATEGORY) + '&active_only=1', { silentError: true });
      const active = _activeJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      const seen = new Set();
      active.forEach(function (job) {
        seen.add(String(job.id));
        _syncJob(job);
      });
      const missing = [];
      restoredJobs.forEach(function (entry, jobId) {
        if (!seen.has(jobId)) missing.push(_resolveMissingJob(jobId, entry));
      });
      await Promise.all(missing);
    } catch (_) {
      // 一時的なポーリング失敗では現役表示を消さず、次回復旧を待つ。
    } finally {
      polling = false;
    }
  }

  function start() {
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }

  function stop() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function beginOperation(label, total, options) {
    const api = _progressApi();
    if (!api) return null;
    const count = Number(total);
    const opts = options || {};
    const handle = api.begin({
      kind: String(opts.kind || 'foreground-operation'),
      label: String(label || '処理中'),
      mode: Number.isFinite(count) && count > 0 ? 'determinate' : 'indeterminate',
      total: Number.isFinite(count) && count > 0 ? count : null,
      processed: 0,
      origin: opts.origin || null,
      originPlacement: opts.originPlacement || 'after',
      background: false,
      delayMs: opts.delayMs,
      showInTray: opts.showInTray !== false,
      cancellable: !!opts.cancellable,
      cancel: opts.cancel,
      retry: opts.retry,
      priority: Number(opts.priority) || 30,
    });
    foregroundStack.push(handle);
    return handle;
  }

  function _resolveForeground(token) {
    if (token && typeof token.update === 'function') return token;
    if (typeof token === 'string') return _progressApi()?.get(token) || null;
    return foregroundStack[foregroundStack.length - 1] || null;
  }

  function updateOperation(processed, label, token) {
    const handle = _resolveForeground(token);
    if (!handle) return;
    const values = { processed: Math.max(0, Number(processed) || 0) };
    if (label) values.label = String(label);
    handle.update(values);
  }

  function finishOperation(token, options) {
    const handle = _resolveForeground(token);
    if (!handle) return;
    const index = foregroundStack.indexOf(handle);
    if (index >= 0) foregroundStack.splice(index, 1);
    const opts = options || {};
    if (opts.error) handle.fail(opts);
    else if (Number(opts.failed) > 0) handle.partial(opts);
    else handle.succeed(Object.assign({ dismissMs: 0 }, opts));
    poll();
  }

  function failOperation(error, token, options) {
    const handle = _resolveForeground(token);
    if (!handle) return;
    const index = foregroundStack.indexOf(handle);
    if (index >= 0) foregroundStack.splice(index, 1);
    handle.fail(Object.assign({ error: error }, options || {}));
  }

  function _init() {
    if (typeof _isTrayAnnotationHost === 'function' && _isTrayAnnotationHost()) return;
    start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init, { once: true });
  else _init();

  window.MeldexImportProgress = {
    start: start,
    stop: stop,
    poll: poll,
    beginOperation: beginOperation,
    updateOperation: updateOperation,
    finishOperation: finishOperation,
    failOperation: failOperation,
  };
})();
