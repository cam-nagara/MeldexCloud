/* ==============================
   gb-tool-calendar-save-queue.js: スケジュールの保存キュー・状態機械
   連続追加時のPOSTタイムアウトでイベントが消える問題への対策。
   楽観追加したイベントを「保存中→（タイムアウト時のみ）確認中→再試行中→
   保存済み／未保存」の状態機械で管理し、無条件破棄をやめる。
   gb-tool-calendar-options.js より前に読み込むこと。
   ============================== */
(function () {
  'use strict';
  if (window.MeldexCalendarSaveQueue) return;

  // 未保存イベントのバックグラウンド再試行間隔（ミリ秒）。
  // E2Eテストから setRetryDelaysMs() で短縮できるよう可変にする。
  let _retryDelaysMs = [10000, 30000, 60000];
  // id → setTimeoutハンドル。イベントが保存済み/削除済みになったら止められるよう保持する。
  const _pendingRetryTimers = new Map();
  // 直列実行キューの末尾Promise（並列度1のFIFO実行に使う）。
  let _queueTail = Promise.resolve();

  function newEventId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // フォールバック: サーバーのID正規表現 ^[A-Za-z0-9:_-]{1,128}$ に適合する形式。tmp- 接頭辞は使わない。
    return 'cal-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // 同時POST殺到を防ぐための直列実行キュー（並列度1・FIFO）。
  // 直前の処理が失敗してもキュー自体は途切れず、次の処理へ進む。
  function enqueue(fn) {
    const run = () => Promise.resolve().then(fn);
    const result = _queueTail.then(run, run);
    _queueTail = result.then(() => {}, () => {});
    return result;
  }

  function getRetryDelaysMs() {
    return _retryDelaysMs.slice();
  }

  function setRetryDelaysMs(list) {
    if (Array.isArray(list) && list.every(n => Number.isFinite(n) && n >= 0)) {
      _retryDelaysMs = list.slice();
    }
  }

  function cancelPendingRetry(id) {
    const timer = _pendingRetryTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      _pendingRetryTimers.delete(id);
    }
  }

  function isPendingEvent(ev) {
    return !!(ev && (ev._optimistic || ev._saveState || String(ev.id || '').startsWith('tmp-')));
  }

  // サーバー一覧に無い保存未確定のローカルイベントだけを末尾に残す。
  // 同IDがサーバー側にあれば、そちらを正としてpending状態を解除する。
  function mergeServerEvents(serverEvents, localEvents) {
    const server = Array.isArray(serverEvents) ? serverEvents : [];
    const local = Array.isArray(localEvents) ? localEvents : [];
    const serverIds = new Set(server.map(ev => ev?.id));
    const pendingOnly = local.filter(ev => isPendingEvent(ev) && !serverIds.has(ev?.id));
    return [...server, ...pendingOnly];
  }

  function _findEvent(calendar, id) {
    return (calendar._events || []).find(ev => ev && ev.id === id) || null;
  }

  function _applyState(calendar, id, patch) {
    const ev = _findEvent(calendar, id);
    if (ev) Object.assign(ev, patch);
    return ev;
  }

  // 保存確定時に楽観フラグを完全に消す（値をfalseにするだけだと、アンドゥ等で
  // オブジェクトをそのまま送信APIペイロードへ展開した際に残存してしまうため）。
  function _clearSaveFlags(calendar, id) {
    const ev = _findEvent(calendar, id);
    if (!ev) return;
    delete ev._optimistic;
    delete ev._saveState;
  }

  function _postEvent(id, payload) {
    // silentError: 状態機械側で表示・報告を制御するため、apiFetch標準のエラートーストは出さない。
    return apiPost('/cal/events', payload, { silentError: true });
  }

  async function _confirmEventExists(id) {
    try {
      const data = await apiFetch('/cal/events/' + encodeURIComponent(id), { silentError: true });
      return data || true;
    } catch {
      return null;
    }
  }

  function _isTimeoutOrServerError(error) {
    if (error?.isTimeout) return true;
    const status = Number(error?.status || 0);
    return status >= 500 && status < 600;
  }

  function _markSaved(calendar, id) {
    _clearSaveFlags(calendar, id);
    cancelPendingRetry(id);
    calendar._render?.();
    calendar._showStatus?.('イベントを追加しました');
  }

  function _discardEvent(calendar, id, error) {
    calendar._events = (calendar._events || []).filter(ev => ev?.id !== id);
    cancelPendingRetry(id);
    calendar._render?.();
    calendar._showStatus?.('イベント追加に失敗', true);
    // 既存の保存失敗レポート機構（3連続失敗でモーダル等）と連携する。
    window.MeldexSaveSafety?.reportApiError?.('/cal/events', { method: 'POST' }, error);
  }

  function _giveUp(calendar, id, error) {
    if (window.MeldexSaveSafety?.reportApiError) {
      window.MeldexSaveSafety.reportApiError('/cal/events', { method: 'POST' }, error || new Error('保存の再試行に失敗しました'));
    } else {
      calendar._showStatus?.('未保存の予定があります。通信回復後に保存を再試行します', true);
    }
    calendar._render?.();
  }

  function _enterUnsaved(calendar, id, payload) {
    _applyState(calendar, id, { _saveState: 'unsaved' });
    calendar._render?.();
    _scheduleBackgroundRetry(calendar, id, payload, 0);
  }

  function _scheduleBackgroundRetry(calendar, id, payload, attemptIndex) {
    if (attemptIndex >= _retryDelaysMs.length) return;
    const delay = _retryDelaysMs[attemptIndex];
    const timer = setTimeout(() => _runBackgroundRetry(calendar, id, payload, attemptIndex), delay);
    _pendingRetryTimers.set(id, timer);
  }

  // バックグラウンド再試行の1回分。実行時点でイベントが保存済み/削除済みなら何もしない。
  async function _runBackgroundRetry(calendar, id, payload, attemptIndex) {
    _pendingRetryTimers.delete(id);
    const ev = _findEvent(calendar, id);
    if (!ev || ev._saveState !== 'unsaved') return;
    try {
      await enqueue(() => _postEvent(id, payload));
      _markSaved(calendar, id);
    } catch (error) {
      const nextIndex = attemptIndex + 1;
      if (nextIndex < _retryDelaysMs.length) {
        _scheduleBackgroundRetry(calendar, id, payload, nextIndex);
      } else {
        _giveUp(calendar, id, error);
      }
    }
  }

  // saving失敗時の分岐: isTimeout/5xxはconfirming→retryingへ、4xx等はdiscardedへ。
  async function _handleInitialFailure(calendar, id, payload, error) {
    if (!_isTimeoutOrServerError(error)) {
      _discardEvent(calendar, id, error);
      return '';
    }
    _applyState(calendar, id, { _saveState: 'confirming' });
    calendar._render?.();
    const exists = await _confirmEventExists(id);
    if (exists) {
      _markSaved(calendar, id);
      return id;
    }
    _applyState(calendar, id, { _saveState: 'retrying' });
    calendar._render?.();
    try {
      await _postEvent(id, payload);
      _markSaved(calendar, id);
      return id;
    } catch {
      _enterUnsaved(calendar, id, payload);
      return id;
    }
  }

  async function _runCreateFlow(calendar, id, payload) {
    _applyState(calendar, id, { _saveState: 'saving' });
    try {
      await _postEvent(id, payload);
      _markSaved(calendar, id);
      return id;
    } catch (error) {
      return _handleInitialFailure(calendar, id, payload, error);
    }
  }

  // 新規イベント作成の状態機械。calendar は CalendarComponent インスタンス（this）。
  // 戻り値: 保存済み/未保存で画面に残っていればid、破棄されていれば空文字。
  function createWithConfirm(calendar, id, payload) {
    return enqueue(() => _runCreateFlow(calendar, id, payload));
  }

  window.MeldexCalendarSaveQueue = {
    newEventId,
    enqueue,
    createWithConfirm,
    mergeServerEvents,
    isPendingEvent,
    getRetryDelaysMs,
    setRetryDelaysMs,
    cancelPendingRetry,
  };
})();
