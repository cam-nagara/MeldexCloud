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
    'sheet-file-import': 'シート取り込み',
    'webclip-inbox': 'Web受信箱',
  };
  const restoredJobs = new Map();
  const durableSchedules = new Map();
  const foregroundStack = [];
  let pollTimer = null;
  let polling = false;
  let lastDurablePollAt = 0;

  function _progressApi() { return window.MeldexOperationProgress || null; }
  function _kindLabel(kind) { return KIND_LABELS[kind] || kind || 'インポート'; }
  function _apiAvailable() { return typeof apiFetch === 'function'; }
  function _settingsPanelForKind(kind) {
    const normalized = String(kind || '');
    if (normalized === 'x-account-posts') return 'Xアカウント保存';
    if (normalized.startsWith('x-bookmark')) return 'Xブックマーク';
    return '';
  }

  function _jobLabel(job) {
    const kind = _kindLabel(job?.kind);
    return job?.label && job.label !== kind ? kind + ': ' + job.label : kind;
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
    const activeStatus = ['queued', 'running', 'cancelling'].includes(job.status) ? job.status : 'running';
    const basePhase = job.status === 'queued' ? '待機中' : String(job.progress?.phase || '準備中');
    const externalWait = job.progress?.external_wait === true;
    const stalled = job.progress?.stalled === true && !externalWait;
    const displayPhase = stalled
      ? `停滞: ${basePhase}`
      : (externalWait ? `外部待機: ${basePhase}` : basePhase);
    const baseMessage = String(job.progress?.message || '');
    const displayMessage = stalled
      ? `30秒以上進んでいません。${baseMessage}`
      : (externalWait
        ? `${String(job.progress?.wait_reason || '外部処理の完了待ち')}${baseMessage ? ` / ${baseMessage}` : ''}`
        : baseMessage);
    let handle = api.findByPersistentJobId(jobId) || restoredJobs.get(jobId)?.handle;
    if (handle && ['queued', 'running', 'cancelling'].includes(job.status)
        && api.isTerminalStatus(handle.getState()?.status)) {
      handle.dispose();
      handle = null;
    }
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
        settingsPanel: _settingsPanelForKind(job.kind),
        label: _jobLabel(job),
        phase: displayPhase,
        status: activeStatus,
        mode: Number(job.progress?.total) > 0 ? 'determinate' : 'indeterminate',
        processed: Number(job.progress?.processed) || 0,
        total: Number(job.progress?.total) || null,
        persistentJobId: jobId,
        background: true,
        showImmediately: true,
        priority: job.status === 'running' ? 20 : 10,
        cancellable: true,
        cancelCompletes: false,
        cancel: () => apiPost('/jobs/' + encodeURIComponent(jobId) + '/cancel', {}, { silentError: true }),
      });
    }
    const rawTotal = Number(job.progress?.total);
    let processed = Math.max(0, Number(job.progress?.processed) || 0);
    handle.update({
      label: _jobLabel(job),
      phase: displayPhase,
      status: job.cancel_requested || (activeStatus === 'running' && handle.getState()?.status === 'cancelling') ? 'cancelling' : activeStatus,
      mode: rawTotal > 0 ? 'determinate' : 'indeterminate',
      processed: processed,
      total: rawTotal > 0 ? rawTotal : null,
      currentItem: job.progress?.current_item || job.progress?.current || '',
      rate: job.progress?.rate,
      eta: job.progress?.eta_seconds ?? job.progress?.eta,
      message: displayMessage,
      persistentJobId: jobId,
    });
    restoredJobs.set(jobId, { handle: handle, misses: 0 });
    return handle;
  }

  function _durableProgressText(dispatch) {
    const processed = Math.max(0, Number(dispatch?.processed) || 0);
    const total = Math.max(0, Number(dispatch?.total) || 0);
    return total > 0 ? `${processed}/${total}件` : (processed > 0 ? `${processed}件` : '開始前');
  }

  function _durableScheduleKey(schedule) {
    return `durable-schedule-${String(schedule?.id || '').replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
  }

  function _syncDurableSchedule(schedule, volatileJobIds) {
    const api = _progressApi();
    const dispatch = schedule?.last_dispatch || {};
    const dispatchStatus = String(dispatch.status || '');
    const jobId = String(dispatch.job_id || '');
    const relevant = schedule?.auto_retry_blocked === true
      || dispatchStatus === 'interrupted'
      || (['claimed', 'submitted', 'running', 'cancelling'].includes(dispatchStatus)
          && (!jobId || !volatileJobIds.has(jobId)));
    const key = _durableScheduleKey(schedule);
    if (!relevant) {
      durableSchedules.get(key)?.dispose?.();
      durableSchedules.delete(key);
      return;
    }
    if (!api || !schedule?.id) return;
    const processed = Math.max(0, Number(dispatch.processed) || 0);
    const total = Math.max(0, Number(dispatch.total) || 0);
    const stage = String(dispatch.stage || '準備中');
    const lastProgressAt = Date.parse(dispatch.last_progress_at || '');
    const externalWait = dispatch.external_wait === true || Boolean(dispatch.wait_reason);
    const stalled = !schedule.auto_retry_blocked
      && !externalWait
      && Number.isFinite(lastProgressAt)
      && Date.now() - lastProgressAt >= 30000;
    const retry = async () => {
      await apiPost(`/import-schedules/${encodeURIComponent(schedule.id)}/run`, {}, {silentError: true});
      durableSchedules.get(key)?.dispose?.();
      durableSchedules.delete(key);
      lastDurablePollAt = 0;
      await poll();
    };
    let handle = durableSchedules.get(key);
    if (!handle) {
      handle = api.begin({
        id: key,
        kind: String(schedule.category || 'import'),
        settingsPanel: _settingsPanelForKind(schedule.category),
        label: _jobLabel({kind: schedule.category, label: schedule.label}),
        phase: stage,
        status: dispatchStatus === 'cancelling' ? 'cancelling' : (dispatchStatus === 'running' ? 'running' : 'queued'),
        mode: total > 0 ? 'determinate' : 'indeterminate',
        processed,
        total: total || null,
        background: true,
        showImmediately: true,
        priority: schedule.auto_retry_blocked ? 40 : 15,
        retry: schedule.auto_retry_blocked ? retry : null,
      });
      durableSchedules.set(key, handle);
    }
    if (schedule.auto_retry_blocked) {
      if (handle.getState()?.status !== 'failed') {
        handle.fail({
          error: '同じ工程で3回進まなかったため、自動再開を停止しました。',
          summary: `${stage} / ${_durableProgressText(dispatch)}。「再試行」で手動再開できます。`,
          retry,
        });
      }
      return;
    }
    handle.update({
      label: _jobLabel({kind: schedule.category, label: schedule.label}),
      phase: stalled
        ? `停滞: ${stage}`
        : (externalWait ? `外部待機: ${stage}` : (dispatchStatus === 'interrupted' ? `再開待ち: ${stage}` : stage)),
      status: dispatchStatus === 'cancelling' ? 'cancelling' : (dispatchStatus === 'running' ? 'running' : 'queued'),
      mode: total > 0 ? 'determinate' : 'indeterminate',
      processed,
      total: total || null,
      message: stalled
        ? `30秒以上進んでいません。最後の位置: ${_durableProgressText(dispatch)}`
        : (externalWait
          ? `${String(dispatch.wait_reason || '外部処理の完了待ち')} / ${_durableProgressText(dispatch)}`
          : (dispatchStatus === 'interrupted' ? `再開予定まで待機中 / ${_durableProgressText(dispatch)}` : _durableProgressText(dispatch))),
    });
  }

  async function _pollDurableSchedules(volatileJobIds) {
    // 取り込みの予定はデスクトップ版の機能。Cloud版には経路が無く、6秒ごとに失敗を繰り返していた（2026-11-21）。
    if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) return;
    const now = Date.now();
    if (now - lastDurablePollAt < 5000) return;
    lastDurablePollAt = now;
    const data = await apiFetch('/import-schedules', {silentError: true});
    const schedules = (Array.isArray(data?.schedules) ? data.schedules : [])
      .filter(schedule => schedule?.category === 'x-bookmarks' || schedule?.category === 'x-account-posts');
    const currentKeys = new Set(schedules.map(_durableScheduleKey));
    schedules.forEach(schedule => _syncDurableSchedule(schedule, volatileJobIds));
    durableSchedules.forEach((handle, key) => {
      if (!currentKeys.has(key)) {
        handle.dispose();
        durableSchedules.delete(key);
      }
    });
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
      const values = window.describeImportResult(result);
      if (result.ok === false) entry.handle.fail({ ...values, error: result.error || result.message || '取り込みに失敗しました' });
      else if (values.partial) entry.handle.partial(window.importAttentionValues ? window.importAttentionValues(values, _settingsPanelForKind(job.kind)) : values);
      else entry.handle.succeed(values);
      restoredJobs.delete(jobId);
    } else if (job?.status === 'cancelled' || job?.status === 'canceled') {
      const partial = job.result;
      entry.handle?.cancelled({ summary: partial?.unprocessed !== undefined
        ? `取り込みを中止しました。新規${partial.created || 0} / 更新${partial.updated || 0} / 未処理${partial.unprocessed}` : '取り込みを中止しました' });
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
      await _pollDurableSchedules(seen);
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
