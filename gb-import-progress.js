// 既存のインポート進捗APIをMeldexOperationProgressへ接続する互換ファサード。
// importジョブの再読込復元と、既存のbegin/update/finish呼び出しを共通状態へ統合する。
(function () {
  'use strict';

  const POLL_INTERVAL_MS = 1500;
  const CATEGORY = 'import';
  const KIND_LABELS = {
    'import': '取り込み',
    'archive': '圧縮・解凍',
    'auto-tag': '自動タグ付け',
    'auto-tag-dictionary-import': 'タグ辞書の取り込み',
    'auto-tag-model-install': '自動タグモデルの準備',
    'auto-tag-preset-install': 'タグプリセットの準備',
    'backlinks-rebuild': '参照リンクの更新',
    'duplicate-scan': '重複ファイルの確認',
    'duplicate-baseline': '重複ファイルの全体確認',
    'duplicate-monitor': '重複ファイルの初期確認',
    'duplicate-pending': '追加ファイルの重複確認',
    'duplicate-resolve': '重複ファイルの整理',
    'extension-install': '拡張機能の準備',
    'external-tag-catalog-prepare': '外部タグ辞書の準備',
    'file-import': 'ファイルの取り込み',
    'global-tag-reset': 'タグの初期化',
    'global-tags-os-sync': 'ファイルのタグを同期',
    'global-tags-os-sync-bulk': 'ファイルのタグを一括同期',
    'google-import': 'Googleデータの取り込み',
    'move-aftercare': '移動後の参照更新',
    'rename-aftercare': '名前変更後の参照更新',
    'notion-migration-prepare': 'Notion一括移行の確認',
    'notion-migration-commit': 'Notionの一括取り込み',
    'sheet-ai-auto': 'シートのAI自動入力',
    'sheet-ai-bulk': 'シートのAI一括入力',
    'sheet-ai-generate': 'シートのAI入力',
    'version-migrate-shared': '履歴の共有先への移行',
    'x-bookmark-folders': 'Xブックマークのフォルダ更新',
    'notion-sync': 'Notion同期',
    'x-bookmarks': 'Xブックマーク',
    'x-bookmark-notes': 'Xブックマークのノート',
    'x-bookmark-post': 'Xポスト',
    'x-bookmark-translations': 'Xポストの翻訳',
    'x-account-posts': 'Xアカウント投稿',
    'external-import': '外部取り込み',
    'external-import-set': '外部取り込み',
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
  function _quietScheduleFailure(schedule) {
    return schedule?.failure_attention_dismissed === true
      || (schedule?.category === 'duplicate-baseline' && Number(schedule.consecutive_failures || 0) < 3);
  }
  function _scheduleFailureValues(schedule, run) {
    const options = {
      label: _jobLabel({kind: schedule.category, label: schedule.label}),
      details: run.summary?.failure_samples,
      attentionKey: schedule.failure_attention_key,
    };
    options.retry = async handle => {
      const action = schedule.category === 'duplicate-baseline' ? 'retry-maintenance' : 'run';
      try {
        await apiPost(`/import-schedules/${encodeURIComponent(schedule.id)}/${action}`, {}, {silentError: true});
      } catch (error) {
        const state = handle?.getState();
        if (state) {
          handle.dispose();
          _progressApi()?.begin({id: state.id, kind: state.kind, label: state.label,
            settingsPanel: state.settingsPanel, persistentJobId: state.persistentJobId,
            background: true, showImmediately: true, retry: options.retry})
            ?.fail(window.describeJobFailure(error, options));
        }
        throw error;
      }
      handle?.dispose();
      lastDurablePollAt = 0;
      await poll();
    };
    return window.describeJobFailure(run.error || run.summary?.error || run.summary?.message, options);
  }
  function _settingsPanelForKind(kind) {
    const normalized = String(kind || '');
    if (normalized === 'x-account-posts') return 'Xアカウント保存';
    if (normalized.startsWith('x-bookmark')) return 'Xブックマーク';
    return '';
  }

  function _jobLabel(job) {
    const kind = _kindLabel(job?.kind);
    if (['duplicate-monitor', 'duplicate-pending'].includes(job?.kind)) return kind;
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
    if (!api || !schedule?.id) return;
    const dispatch = schedule?.last_dispatch || {};
    const dispatchStatus = String(dispatch.status || '');
    const jobId = String(dispatch.job_id || '');
    const run = schedule?.last_run;
    const receiptJobId = String(run?.job_id || (run?.dispatch_id ? 'schedule-' + run.dispatch_id : ''));
    if (schedule.category === 'duplicate-baseline'
        && (run?.status === 'done' || run?.status === 'cancelled' || _quietScheduleFailure(schedule))) {
      api.list().filter(item => item.kind === 'duplicate-baseline' && item.status === 'failed')
        .forEach(item => api.get(item.id)?.dispose());
    }
    const receiptKey = `${schedule?.id}:${run?.job_id}:${run?.finished_at}:${schedule?.needs_attention}:${schedule?.failure_attention_dismissed}`;
    if (receiptJobId && run?.finished_at && ['done', 'error', 'cancelled'].includes(run.status)
        && !volatileJobIds.has(receiptJobId) && completedScheduleReceipts.get(schedule.id) !== receiptKey) {
      completedScheduleReceipts.set(schedule.id, receiptKey);
      const result = {...(run.summary || {})};
      if (!result.summary) {
        if (result.baseline_files != null) result.summary = `全体確認 ${Number(result.baseline_files)}件 / 画像 ${Number(result.baseline_images || 0)}件`;
        else if (result.saved != null) result.summary = `保存 ${Number(result.saved)}件`;
        else if (result.created != null || result.updated != null) result.summary = `新規 ${Number(result.created || 0)}件 / 更新 ${Number(result.updated || 0)}件`;
      }
      if (result.baseline_truncated) result.warnings = ['全体確認を途中で終了しました。次回の確認を待ってください。'];
      const quiet = schedule.category === 'webclip-inbox' && run.status === 'done'
        && result.ok !== false && !['saved', 'failed', 'recovered'].some(key => Number(result[key]) > 0)
        || ((run.status === 'error' || result.ok === false) && _quietScheduleFailure(schedule));
      if (quiet) api.findByPersistentJobId(receiptJobId)?.dispose();
      if (!quiet && !restoredJobs.has(receiptJobId)) {
        const handle = _syncJob({id: receiptJobId, kind: schedule.category,
          label: schedule.label, status: run.status, progress: {...dispatch, phase: dispatch.stage}});
        if (handle) {
          const values = window.describeImportResult(result);
          if (run.status === 'error' || result.ok === false) handle.fail(_scheduleFailureValues(schedule, run));
          else if (run.status === 'cancelled') handle.cancelled(values);
          else if (schedule.category === 'x-bookmarks' && typeof result.ok !== 'boolean') handle.unknown({summary: '項目別の結果を確認できません。取り込み予定の前回結果を確認してください。'});
          else if (values.partial) handle.partial(values);
          else handle.succeed(values);
          restoredJobs.delete(receiptJobId);
        }
      }
    }
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
    const data = await apiFetch('/import-schedules?include_system=1', {silentError: true});
    const schedules = Array.isArray(data?.schedules) ? data.schedules : [];
    const currentKeys = new Set(schedules.map(_durableScheduleKey));
    schedules.forEach(schedule => _syncDurableSchedule(schedule, volatileJobIds));
    durableSchedules.forEach((handle, key) => {
      if (!currentKeys.has(key)) {
        handle.dispose();
        durableSchedules.delete(key);
      }
    });
  }

  const completedScheduleReceipts = new Map();

  async function _scheduledJobSnapshot(jobId) {
    const data = await apiFetch('/import-schedules?include_system=1', { silentError: true });
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
        schedule,
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
    if ((job?.status === 'error' || (job?.status === 'done' && job.result?.ok === false))
        && !job.schedule && (job.kind === 'duplicate-baseline' || job.target_key)) {
      try { job = (await _scheduledJobSnapshot(jobId)) || job; }
      catch (_) { return; }
    }
    if (job?.schedule && _quietScheduleFailure(job.schedule) && job.status === 'error') {
      entry.handle?.dispose();
      restoredJobs.delete(jobId);
      return;
    }
    if (job?.status === 'done') {
      const result = job.result || {};
      if (!entry.handle && job.kind === 'webclip-inbox'
          && result.ok !== false && !['saved', 'failed', 'recovered'].some(key => Number(result[key]) > 0)) {
        restoredJobs.delete(jobId);
        return;
      }
      entry.handle = entry.handle || _syncJob(job);
      const values = window.describeImportResult(result);
      if (result.ok === false) entry.handle.fail(window.describeJobFailure(result.error || result.message, {
        label: _jobLabel(job), details: result.failure_samples,
      }));
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
      entry.handle.fail(job.schedule ? _scheduleFailureValues(job.schedule, job.schedule.last_run)
        : window.describeJobFailure(job.error, {label: _jobLabel(job),
          details: job.result?.failure_samples || job.error_detail?.failure_samples}));
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

  // 件数だけの更新は、1件ごとに進捗の表示を作り直さない（多数の移動・削除で、1件ごとの更新が塊ごとに
  // 0.4〜1秒を占め、件数に応じて伸びていた。実測）。最後の値は、間隔の後に必ず表示へ出す。
  const OPERATION_UPDATE_INTERVAL_MS = 100;
  const operationUpdateStates = new WeakMap();

  function _dropPendingOperationUpdate(handle) {
    const state = handle && operationUpdateStates.get(handle);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    operationUpdateStates.delete(handle);
  }

  function updateOperation(processed, label, token) {
    const handle = _resolveForeground(token);
    if (!handle) return;
    const values = { processed: Math.max(0, Number(processed) || 0) };
    if (label) values.label = String(label);
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let state = operationUpdateStates.get(handle);
    if (!state) { state = { last: -Infinity, timer: null, pending: null }; operationUpdateStates.set(handle, state); }
    if (label || now - state.last >= OPERATION_UPDATE_INTERVAL_MS) {
      state.last = now;
      state.pending = null;
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      handle.update(values);
      return;
    }
    state.pending = values;
    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = null;
        const pending = state.pending;
        state.pending = null;
        if (!pending) return;
        state.last = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        handle.update(pending);
      }, OPERATION_UPDATE_INTERVAL_MS);
    }
  }

  function finishOperation(token, options) {
    const handle = _resolveForeground(token);
    if (!handle) return;
    _dropPendingOperationUpdate(handle);
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
    _dropPendingOperationUpdate(handle);
    const index = foregroundStack.indexOf(handle);
    if (index >= 0) foregroundStack.splice(index, 1);
    handle.fail(Object.assign({ error: error }, options || {}));
  }

  function _init() {
    if ((typeof _isTrayAnnotationHost === 'function' && _isTrayAnnotationHost()) || (typeof _isTrayAnnotationBarHost === 'function' && _isTrayAnnotationBarHost())) return;
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
