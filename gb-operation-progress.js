/* Meldex共通の操作進捗状態。
   表示場所に依存せず、前景操作・バックグラウンドジョブ・同時処理を一意なハンドルで管理する。 */
(function () {
  'use strict';

  const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'cancelled']);
  const DEFAULT_DELAY_MS = 250;
  const DEFAULT_SUCCESS_DISMISS_MS = 1800;
  const records = new Map();
  const subscribers = new Set();
  let nextId = 1;

  function _number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function _id(prefix) {
    const safePrefix = String(prefix || 'operation').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'operation';
    return safePrefix + '-' + Date.now().toString(36) + '-' + (nextId++).toString(36);
  }

  function _details(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 50).map(function (item) {
      if (item && typeof item === 'object') {
        return {
          stage: String(item.stage || ''),
          path: String(item.path || item.name || ''),
          message: String(item.message || item.error || ''),
        };
      }
      return { stage: '', path: '', message: String(item || '') };
    });
  }

  function _snapshot(record) {
    if (!record) return null;
    const state = record.state;
    return {
      id: state.id,
      kind: state.kind,
      label: state.label,
      phase: state.phase,
      currentItem: state.currentItem,
      status: state.status,
      mode: state.mode,
      processed: state.processed,
      total: state.total,
      percent: state.percent,
      rate: state.rate,
      eta: state.eta,
      message: state.message,
      error: state.error,
      summary: state.summary,
      details: state.details.map(function (item) { return Object.assign({}, item); }),
      detailCount: state.detailCount,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt,
      visible: state.visible,
      background: state.background,
      showInTray: state.showInTray,
      showInStatus: state.showInStatus,
      origin: state.origin,
      originPlacement: state.originPlacement,
      cancellable: state.cancellable,
      retryable: state.retryable,
      persistentJobId: state.persistentJobId,
      priority: state.priority,
    };
  }

  function _emit(record, reason) {
    const detail = { reason: reason || 'update', operation: _snapshot(record), operations: list() };
    subscribers.forEach(function (listener) {
      try { listener(detail); } catch (error) { console.error('進捗表示の更新に失敗しました', error); }
    });
    if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('meldex-operation-progress', { detail: detail }));
    }
  }

  function _computePercent(state) {
    if (state.mode !== 'determinate' || !(state.total > 0)) return null;
    return Math.max(0, Math.min(100, Math.round((state.processed / state.total) * 100)));
  }

  function _clearTimer(record, name) {
    if (!record || !record[name]) return;
    clearTimeout(record[name]);
    record[name] = null;
  }

  function _show(record) {
    if (!record || TERMINAL.has(record.state.status) && record.state.status === 'succeeded') return;
    _clearTimer(record, 'showTimer');
    if (record.state.visible) return;
    record.state.visible = true;
    record.state.updatedAt = Date.now();
    _emit(record, 'show');
  }

  function _scheduleShow(record, delayMs) {
    const delay = Math.max(0, _number(delayMs, DEFAULT_DELAY_MS));
    if (delay === 0) {
      _show(record);
      return;
    }
    record.showTimer = setTimeout(function () { _show(record); }, delay);
  }

  function _disposeRecord(record, reason) {
    if (!record || !records.has(record.state.id)) return false;
    _clearTimer(record, 'showTimer');
    _clearTimer(record, 'dismissTimer');
    records.delete(record.state.id);
    if (record.onDispose) {
      const callback = record.onDispose;
      record.onDispose = null;
      try { callback(_snapshot(record), reason || 'dispose'); } catch (error) { console.error('進捗の後処理に失敗しました', error); }
    }
    _emit(record, reason || 'dispose');
    return true;
  }

  function _patch(record, values, reason) {
    if (!record || !records.has(record.state.id) || TERMINAL.has(record.state.status)) return _snapshot(record);
    const next = values || {};
    if (next.label !== undefined) record.state.label = String(next.label || '処理中');
    if (next.phase !== undefined) record.state.phase = String(next.phase || '');
    if (next.currentItem !== undefined) record.state.currentItem = String(next.currentItem || '');
    if (next.message !== undefined) record.state.message = String(next.message || '');
    if (next.details !== undefined) record.state.details = _details(next.details);
    if (next.detailCount !== undefined) record.state.detailCount = Math.max(record.state.details.length, _number(next.detailCount, 0));
    if (next.status && !TERMINAL.has(next.status)) record.state.status = String(next.status);
    if (next.total !== undefined) {
      const total = _number(next.total, null);
      record.state.total = total != null && total > 0 ? total : null;
      if (!record.state.total) record.state.mode = 'indeterminate';
    }
    if (next.processed !== undefined) record.state.processed = Math.max(0, _number(next.processed, 0));
    if (next.mode === 'determinate' || next.mode === 'indeterminate') record.state.mode = next.mode;
    if (record.state.mode === 'determinate' && !(record.state.total > 0)) record.state.mode = 'indeterminate';
    record.state.percent = _computePercent(record.state);
    if (next.rate !== undefined) record.state.rate = _number(next.rate, null);
    if (next.eta !== undefined) record.state.eta = _number(next.eta, null);
    if (next.persistentJobId !== undefined) record.state.persistentJobId = String(next.persistentJobId || '');
    if (next.cancellable !== undefined) record.state.cancellable = !!next.cancellable;
    if (next.retryable !== undefined) record.state.retryable = !!next.retryable;
    if (typeof next.retry === 'function') {
      record.retry = next.retry;
      record.state.retryable = true;
    }
    record.state.updatedAt = Date.now();
    _emit(record, reason || 'update');
    return _snapshot(record);
  }

  function _finish(record, status, values) {
    if (!record || !records.has(record.state.id) || TERMINAL.has(record.state.status)) return _snapshot(record);
    const next = values || {};
    _clearTimer(record, 'showTimer');
    record.state.status = status;
    record.state.completedAt = Date.now();
    record.state.updatedAt = record.state.completedAt;
    if (next.summary !== undefined) record.state.summary = String(next.summary || '');
    if (next.message !== undefined) record.state.message = String(next.message || '');
    if (next.error !== undefined) record.state.error = String(next.error?.message || next.error || '');
    if (typeof next.retry === 'function') {
      record.retry = next.retry;
      record.state.retryable = true;
    }
    if (next.details !== undefined) record.state.details = _details(next.details);
    if (next.detailCount !== undefined) record.state.detailCount = Math.max(record.state.details.length, _number(next.detailCount, 0));
    if (status === 'succeeded' && record.state.mode === 'determinate' && record.state.total > 0) {
      record.state.processed = record.state.total;
      record.state.percent = 100;
    }
    const needsAttention = status === 'failed' || status === 'partial';
    if (needsAttention && !record.state.visible) record.state.visible = true;
    _emit(record, status);
    const configuredDismiss = next.dismissMs !== undefined ? next.dismissMs : record.dismissMs;
    const dismissMs = configuredDismiss !== undefined
      ? Math.max(0, _number(configuredDismiss, 0))
      : (status === 'succeeded' || status === 'cancelled' ? DEFAULT_SUCCESS_DISMISS_MS : null);
    if (!record.state.visible && !needsAttention) {
      _disposeRecord(record, 'fast-complete');
    } else if (dismissMs != null) {
      record.dismissTimer = setTimeout(function () { _disposeRecord(record, 'auto-dismiss'); }, dismissMs);
    }
    return _snapshot(record);
  }

  function _handle(record) {
    return {
      id: record.state.id,
      update: function (values) { return _patch(record, values, 'update'); },
      showNow: function () { _show(record); return _snapshot(record); },
      setPersistentJobId: function (jobId) { return _patch(record, { persistentJobId: jobId }, 'job-id'); },
      succeed: function (values) { return _finish(record, 'succeeded', values); },
      partial: function (values) { return _finish(record, 'partial', values); },
      fail: function (values) {
        const payload = values instanceof Error ? { error: values } : values;
        return _finish(record, 'failed', payload);
      },
      cancelled: function (values) { return _finish(record, 'cancelled', values); },
      requestCancel: function () { return requestCancel(record.state.id); },
      retry: function () { return retry(record.state.id); },
      dispose: function () { return _disposeRecord(record, 'dispose'); },
      getState: function () { return _snapshot(record); },
    };
  }

  function begin(options) {
    const opts = options || {};
    const requestedId = String(opts.id || '').trim();
    if (requestedId && records.has(requestedId)) {
      const existing = records.get(requestedId);
      _patch(existing, opts, 'adopt');
      return existing.handle;
    }
    if (opts.persistentJobId) {
      const existing = findByPersistentJobId(opts.persistentJobId);
      if (existing) {
        existing.update(opts);
        return existing;
      }
    }
    const mode = opts.mode === 'determinate' && _number(opts.total, 0) > 0 ? 'determinate' : 'indeterminate';
    const id = requestedId || _id(opts.kind);
    const record = {
      state: {
        id: id,
        kind: String(opts.kind || 'operation'),
        label: String(opts.label || '処理中'),
        phase: String(opts.phase || ''),
        currentItem: String(opts.currentItem || ''),
        status: String(opts.status || 'running'),
        mode: mode,
        processed: Math.max(0, _number(opts.processed, 0)),
        total: mode === 'determinate' ? Math.max(1, _number(opts.total, 1)) : null,
        percent: null,
        rate: _number(opts.rate, null),
        eta: _number(opts.eta, null),
        message: String(opts.message || ''),
        error: '',
        summary: '',
        details: _details(opts.details),
        detailCount: Math.max(_details(opts.details).length, _number(opts.detailCount, 0)),
        startedAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: null,
        visible: !!opts.showImmediately,
        background: !!opts.background,
        showInTray: opts.showInTray !== false,
        showInStatus: opts.showInStatus !== false,
        origin: opts.origin || null,
        originPlacement: String(opts.originPlacement || 'after'),
        cancellable: !!opts.cancellable && typeof opts.cancel === 'function',
        retryable: typeof opts.retry === 'function',
        persistentJobId: String(opts.persistentJobId || ''),
        priority: _number(opts.priority, 0),
      },
      cancel: typeof opts.cancel === 'function' ? opts.cancel : null,
      retry: typeof opts.retry === 'function' ? opts.retry : null,
      onDispose: typeof opts.onDispose === 'function' ? opts.onDispose : null,
      dismissMs: opts.dismissMs,
      cancelCompletes: opts.cancelCompletes !== false,
      showTimer: null,
      dismissTimer: null,
      handle: null,
    };
    record.state.percent = _computePercent(record.state);
    record.handle = _handle(record);
    records.set(id, record);
    _emit(record, 'begin');
    if (!record.state.visible) _scheduleShow(record, opts.delayMs);
    return record.handle;
  }

  function get(id) {
    const record = records.get(String(id || ''));
    return record ? record.handle : null;
  }

  function findByPersistentJobId(jobId) {
    const wanted = String(jobId || '');
    if (!wanted) return null;
    for (const record of records.values()) {
      if (record.state.persistentJobId === wanted) return record.handle;
    }
    return null;
  }

  function list(options) {
    const opts = options || {};
    return Array.from(records.values())
      .map(_snapshot)
      .filter(function (state) { return opts.includeHidden || state.visible; })
      .sort(function (a, b) {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.startedAt - b.startedAt;
      });
  }

  async function requestCancel(id) {
    const record = records.get(String(id || ''));
    if (!record || !record.cancel || !record.state.cancellable || TERMINAL.has(record.state.status)) return false;
    record.state.status = 'cancelling';
    record.state.updatedAt = Date.now();
    _show(record);
    _emit(record, 'cancelling');
    try {
      await record.cancel(record.handle);
      if (record.cancelCompletes && !TERMINAL.has(record.state.status)) _finish(record, 'cancelled', {});
      return true;
    } catch (error) {
      _finish(record, 'failed', { error: error || '中止要求を送信できませんでした' });
      return false;
    }
  }

  async function retry(id) {
    const record = records.get(String(id || ''));
    if (!record || !record.retry) return false;
    try {
      await record.retry(record.handle);
      return true;
    } catch (error) {
      console.error('処理を再試行できませんでした', error);
      return false;
    }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    subscribers.add(listener);
    try { listener({ reason: 'subscribe', operation: null, operations: list() }); } catch (_) {}
    return function () { subscribers.delete(listener); };
  }

  window.MeldexOperationProgress = {
    begin: begin,
    get: get,
    findByPersistentJobId: findByPersistentJobId,
    list: list,
    subscribe: subscribe,
    requestCancel: requestCancel,
    retry: retry,
    isTerminalStatus: function (status) { return TERMINAL.has(String(status || '')); },
  };
})();
