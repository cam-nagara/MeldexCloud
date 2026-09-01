/* ==============================
   gb-tool-calendar-views.js: CalendarComponent描画・CRUD・モーダル
   gb-tool-calendar.js のプロトタイプ拡張
   ============================== */

function _gbCalModalSizeStyle(minWidth, extra, options) {
  const width = Math.max(240, Number(minWidth) || 400);
  const zoom = Math.max(0.1, (typeof _getZoom === 'function' ? _getZoom() : parseFloat(document.documentElement?.style?.zoom || '')) || 1);
  const viewportWidth = Math.floor(window.visualViewport?.width || window.innerWidth || document.documentElement?.clientWidth || width + 16);
  const viewportHeight = Math.floor(window.visualViewport?.height || window.innerHeight || document.documentElement?.clientHeight || 720);
  const safeWidth = Math.max(240, Math.min(width, viewportWidth - 16));
  const safeHeight = Math.max(180, Math.floor((viewportHeight - 56) / zoom));
  const overflow = extra == null ? 'overflow-y:auto;' : String(extra);
  const height = options?.forceHeight ? `height:${safeHeight}px;` : '';
  return `min-width:0;min-height:0;width:${safeWidth}px;max-width:${safeWidth}px;max-height:${safeHeight}px;${height}${overflow}`;
}

// === 月表示 ===
CalendarComponent.prototype._renderMonth = function() {
  const el = this._contentEl;
  const y = this._date.getFullYear(), m = this._date.getMonth();
  const rawFirst = new Date(y, m, 1).getDay();
  const firstDay = (rawFirst - this._startDay + 7) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = this._localDateStr();
  let html = '<div class="gb-cal-month">';
  const dayNames = this._getDayNames();
  dayNames.forEach((d, i) => {
    const dow = (this._startDay + i) % 7;
    html += `<div class="gb-cal-month-header" data-cal-dow="${dow}">${d}</div>`;
  });
  const prevDays = new Date(y, m, 0).getDate();
  const prevM = m === 0 ? 12 : m, prevY = m === 0 ? y - 1 : y;
  for (let i = firstDay - 1; i >= 0; i--) { const day = prevDays - i; const ds = `${prevY}-${String(prevM).padStart(2,'0')}-${String(day).padStart(2,'0')}`; html += this._monthDayCell(ds, day, ds === todayStr, true); }
  for (let d = 1; d <= daysInMonth; d++) { const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; html += this._monthDayCell(ds, d, ds === todayStr, false); }
  const total = firstDay + daysInMonth, rem = Math.max(0, 42 - total);
  const nextM = m + 2 > 12 ? 1 : m + 2, nextY = m + 2 > 12 ? y + 1 : y;
  for (let i = 1; i <= rem; i++) { const ds = `${nextY}-${String(nextM).padStart(2,'0')}-${String(i).padStart(2,'0')}`; html += this._monthDayCell(ds, i, ds === todayStr, true); }
  html += '</div>';
  el.innerHTML = html;
  // イベント委譲（前回リスナーを除去してから追加）
  if (el._calClickHandler) el.removeEventListener('click', el._calClickHandler);
  el._calClickHandler = (e) => {
    const evEl = e.target.closest('.gb-cal-day-event');
    const moreBtn = e.target.closest('[data-cal-event-more]');
    if (moreBtn && evEl) {
      e.preventDefault();
      e.stopPropagation();
      const eid = evEl.dataset.eventId;
      if (eid && typeof this._showEventCardMenu === 'function') this._showEventCardMenu(moreBtn, eid);
      return;
    }
    if (evEl) { e.stopPropagation(); const eid = evEl.dataset.eventId; const tid = evEl.dataset.taskId; if (eid) this._openEventInPanel(eid); else if (tid) this._showTaskModal(tid); return; }
    const dayEl = e.target.closest('.gb-cal-day');
    if (dayEl) this._onDayClick(dayEl.dataset.date, dayEl);
  };
  el.addEventListener('click', el._calClickHandler);
  // 月表示イベントのdragstart（日付間D&D移動用）
  el.querySelectorAll('.gb-cal-day-event[data-event-id]').forEach(evEl => {
    evEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-cal-event', evEl.dataset.eventId);
      e.dataTransfer.effectAllowed = 'move';
      evEl.style.opacity = '0.4';
    });
    evEl.addEventListener('dragend', () => { evEl.style.opacity = ''; });
  });
  // 月表示D&D（日セルへのドロップ）
  el.querySelectorAll('.gb-cal-day').forEach(dayEl => {
    dayEl.addEventListener('dragover', (e) => { e.preventDefault(); dayEl.style.outline = '2px solid var(--cal-accent, var(--accent))'; });
    dayEl.addEventListener('dragleave', () => { dayEl.style.outline = ''; });
    dayEl.addEventListener('drop', (e) => { e.preventDefault(); dayEl.style.outline = ''; this._onMonthDayDrop(e, dayEl.dataset.date); });
  });
};

CalendarComponent.prototype._eventIntersectsDay = function(ev, dateStr) {
  const range = _calEventRange(ev);
  if (!range) return false;
  const dayStart = new Date(dateStr + 'T00:00');
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return range.start < dayEnd && range.end > dayStart;
};

CalendarComponent.prototype._eventSegmentForDay = function(ev, dateStr) {
  const range = _calEventRange(ev);
  if (!range) return null;
  const dayStart = new Date(dateStr + 'T00:00');
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  if (!(range.start < dayEnd && range.end > dayStart)) return null;
  const segStart = range.start > dayStart ? range.start : dayStart;
  const segEnd = range.end < dayEnd ? range.end : dayEnd;
  const startH = segStart.getHours() + segStart.getMinutes() / 60;
  let endH = segEnd.getHours() + segEnd.getMinutes() / 60;
  if (segEnd >= dayEnd) endH = 24;
  if (endH <= startH) endH = Math.min(24, startH + 0.25);
  return { dayStart, segStart, segEnd, startH, endH };
};

function _calIsDateOnlyValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function _calParseDateValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (_calIsDateOnlyValue(raw)) {
    const parts = raw.split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function _calDateAddDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function _calDateOnlyString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function _calEventRange(ev) {
  if (!ev?.start) return null;
  const start = _calParseDateValue(ev.start);
  if (!start) return null;
  const startIsDate = _calIsDateOnlyValue(ev.start);
  const endIsDate = _calIsDateOnlyValue(ev.end);
  let end = ev.end ? _calParseDateValue(ev.end) : null;
  if (ev.all_day || startIsDate || endIsDate) {
    if (!end || end <= start) end = _calDateAddDays(start, 1);
    // 日付のみの終了日は「最終日を含む」扱い（保存慣例は包括的な終了日のため、表示境界は翌日0時）
    else if (endIsDate) end = _calDateAddDays(end, 1);
  } else if (!end) {
    end = new Date(start.getTime() + 3600000);
  }
  if (!end || Number.isNaN(end.getTime())) end = new Date(start.getTime() + 3600000);
  if (end <= start) end = new Date(start.getTime() + 15 * 60000);
  return { start, end };
}

function _calAllDayDateSpan(ev) {
  const range = _calEventRange(ev);
  if (!range) return 1;
  return Math.max(1, Math.round((range.end - range.start) / 86400000));
}

function _calRecurringInteractionBlocked(component, ev) {
  if (!ev?._recurrence_instance) return false;
  component._showStatus?.('繰り返し予定は元の予定から編集してください', true);
  return true;
}

// === 複数選択イベントのグループD&D移動: 日付演算ヘルパー ===
// サーバーが自動生成する予定のうち、書き戻し経路を持たないもの（シフト/休憩/勤怠）は
// グループ移動の「他の選択イベント」から除外する（ドラッグしたイベント自身はこの判定をしない）。
// production-task は _calApplyEventTimePatch 経由のタスク書き戻しに対応済みのため対象外にしない
// （制作管理UX改善計画 2026-08-04 §6-4 の残作業: 複数選択グループ移動）。
function _calGroupMoveSourceBlocked(ev) {
  return ['shift', 'shift-break', 'attendance'].includes(String(ev?.calendar_source || ''));
}

// 制作管理UX改善計画（2026-08-04）§6-4: production-task イベントの移動・リサイズは、汎用イベント
// 更新（/cal/events/{id}。自動生成された予定として409で拒否される）ではなく、タスクへの書き戻し
// （/production-management/task-schedule/update）として処理する。書き戻し時にサーバー側が
// 「シフト固定」を自動付与するため、失敗ロールバック機構（各呼び出し元の.catch）はそのまま使える
// （このヘルパーは apiPut と同様に成功時は結果を返し、失敗時は reject する）。
// シフト・勤怠など他の自動生成イベントは従来どおり409のままとする（このヘルパーを経由させない）。
function _calIsProductionTaskEvent(ev) {
  return String(ev?.calendar_source || '') === 'production-task';
}

async function _calApplyEventTimePatch(component, ev, patch) {
  if (!_calIsProductionTaskEvent(ev)) return apiPut('/cal/events/' + ev.id, patch);
  const start = patch?.start || ev?.start || '';
  const end = patch?.end || ev?.end || '';
  const result = await apiPost('/production-management/task-schedule/update', {
    event_id: String(ev?.id || ''), start, end,
  });
  if (result?.ok === false) throw new Error(result?.message || '予定を更新できませんでした');
  component?._showStatus?.('予定を固定しました。再計算でも動かなくなります');
  return result;
}

// fromValue（旧開始日時）から toDateStr（新しい日付）までの日数差を返す（時刻は無視）
function _calDateDayDelta(fromValue, toDateStr) {
  const fromDate = _calParseDateValue(fromValue);
  const toDate = _calParseDateValue(toDateStr);
  if (!fromDate || !toDate) return 0;
  const fromMid = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const toMid = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.round((toMid - fromMid) / 86400000);
}

// 日付/日時値を days 日シフトする（元の表記形式=日付のみ/日時を維持する）
function _calShiftValueByDays(component, value, days) {
  if (!value || !days) return value;
  const parsed = _calParseDateValue(value);
  if (!parsed) return value;
  const shifted = _calDateAddDays(parsed, days);
  return _calIsDateOnlyValue(value) ? _calDateOnlyString(shifted) : component._localDateTimeStr(shifted);
}

// 日時値を deltaMs ミリ秒シフトする（日付のみ値は呼び出し側で _calShiftValueByDays を使うこと）
function _calShiftValueByMs(component, value, deltaMs) {
  if (!value || !deltaMs) return value;
  const parsed = _calParseDateValue(value);
  if (!parsed) return value;
  return component._localDateTimeStr(new Date(parsed.getTime() + deltaMs));
}

// 月表示・終日帯ドロップ用: グループ内の他イベントを dayDelta 日シフトするパッチを作る
// （0日シフトや対象値なしは null を返し、呼び出し側でAPI呼び出しを省略させる＝変更なし扱い）
function _calDayShiftPatch(component, ev, dayDelta) {
  if (!dayDelta) return null;
  const patch = {};
  if (ev.start) patch.start = _calShiftValueByDays(component, ev.start, dayDelta);
  if (ev.end) patch.end = _calShiftValueByDays(component, ev.end, dayDelta);
  return Object.keys(patch).length ? patch : null;
}

// 週/日/複数日セルドロップ用: 他イベントを移動先へ合わせてシフトするパッチを作る
// （終日イベントは日単位、時刻付きイベントはミリ秒単位でシフトする。共に無変化は null＝対象外）
function _calWeekShiftPatch(component, ev, deltaMs) {
  if (ev.all_day) {
    const days = Math.round(deltaMs / 86400000);
    if (!days) return null;
    const patch = {};
    if (ev.start) patch.start = _calShiftValueByDays(component, ev.start, days);
    if (ev.end) patch.end = _calShiftValueByDays(component, ev.end, days);
    return Object.keys(patch).length ? patch : null;
  }
  if (!deltaMs) return null;
  const patch = {};
  if (ev.start) patch.start = _calShiftValueByMs(component, ev.start, deltaMs);
  if (ev.end) patch.end = _calShiftValueByMs(component, ev.end, deltaMs);
  return Object.keys(patch).length ? patch : null;
}

CalendarComponent.prototype._sanitizeEventColor = function(color) {
  const raw = String(color || '').trim();
  if (!raw) return 'var(--cal-event-bg, var(--cal-accent, var(--accent)))';
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(raw)) return raw;
  if (/^var\(--[-_a-zA-Z0-9]+(?:\s*,\s*(?:#[0-9a-f]{3,8}|var\(--[-_a-zA-Z0-9]+\)))?\)$/i.test(raw)) return raw;
  return 'var(--cal-event-bg, var(--cal-accent, var(--accent)))';
};

CalendarComponent.prototype._eventSourceClass = function(ev) {
  const source = String(ev?.calendar_source || '');
  let cls = '';
  if (source === 'production-task') cls = ' gb-cal-production-task-event';
  else if (source === 'shift') cls = ' gb-cal-shift-event';
  else if (source === 'shift-break') cls = ' gb-cal-shift-break-event';
  else if (source === 'attendance') cls = ' gb-cal-attendance-event';
  // 保存未確定（タイムアウト後の再試行待ち）のイベントは破線枠+バッジで区別する
  if (ev?._saveState === 'unsaved') cls += ' gb-cal-event-unsaved';
  return cls;
};

CalendarComponent.prototype._eventTitleContentHtml = function(ev) {
  const source = String(ev?.calendar_source || '');
  const iconName = source === 'production-task' ? 'hammer' : source === 'shift' ? 'calendarClock' : source === 'shift-break' ? 'coffee' : source === 'attendance' ? 'clock' : '';
  const icon = iconName ? `<span class="gb-cal-event-source-icon">${lucide(iconName, 10)}</span>` : '';
  return `${icon}<span class="gb-cal-event-title">${esc(ev?.title || '')}</span>`;
};

function _calMonthGroupKey(ev, dateStr) {
  const source = String(ev?.calendar_source || '');
  const baseId = String(ev?.external_id || ev?.id || '').replace(/^shift:/, '').split(':break:')[0];
  if (source === 'shift' || source === 'shift-break') return `shift:${baseId || ev?.id || ''}:${dateStr}`;
  if (source === 'attendance') return `attendance:${ev?.user || ev?.external_id || ev?.id || ''}:${dateStr}`;
  return '';
}

function _calEventStableSlug(value) {
  const raw = String(value || '').trim().toLowerCase();
  const ascii = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `${ascii || 'event'}-${Math.abs(hash).toString(36)}`;
}

CalendarComponent.prototype._monthDisplayEvents = function(dateStr, events) {
  const rows = Array.isArray(events) ? events : [];
  const shiftWorkKeys = new Set(rows
    .filter(ev => String(ev?.calendar_source || '') === 'shift')
    .map(ev => _calMonthGroupKey(ev, dateStr)));
  const seenAttendance = new Set();
  return rows.filter(ev => {
    const source = String(ev?.calendar_source || '');
    if (source === 'shift-break' && shiftWorkKeys.has(_calMonthGroupKey(ev, dateStr))) return false;
    if (source === 'attendance') {
      const key = _calMonthGroupKey(ev, dateStr);
      if (seenAttendance.has(key)) return false;
      seenAttendance.add(key);
    }
    return true;
  });
};

CalendarComponent.prototype._eventCardMenuHtml = function(ev, context) {
  const base = [
    context || 'event',
    ev?.id || ev?.external_id || ev?.title || 'event',
  ].join('|');
  const e2eId = `calendar-event-more-${_calEventStableSlug(base)}`;
  return `<button type="button" class="gb-cal-event-more" data-cal-event-more data-e2e-id="${esc(e2eId)}" draggable="false" title="イベントメニュー" aria-label="イベントメニュー">${lucide('moreHorizontal', 10)}</button>`;
};

CalendarComponent.prototype._monthDayCell = function(dateStr, dayNum, isToday, isOther) {
  const dayEvents = this._events.filter(e => this._eventIntersectsDay(e, dateStr) && this._isCalVisible(e));
  const monthEvents = this._monthDisplayEvents(dateStr, dayEvents);
  const dayTasks = this._tasks.filter(t => t.due_date === dateStr);
  const dow = this._parseLocalDate(dateStr).getDay();
  let html = `<div class="gb-cal-day${isToday?' gb-cal-today':''}${isOther?' gb-cal-other-month':''}" data-date="${dateStr}" data-cal-dow="${dow}">`;
  html += `<div class="gb-cal-day-num">${dayNum}</div>`;
  monthEvents.forEach(e => {
    const avatars = typeof this._eventUserAvatarsHtml === 'function' ? this._eventUserAvatarsHtml(e, 14) : '';
    const summaryClass = ['shift', 'attendance'].includes(String(e?.calendar_source || '')) ? ' gb-cal-month-summary-event' : '';
    html += `<div class="gb-cal-day-event${summaryClass}${this._eventSourceClass(e)}" data-event-id="${e.id}" data-calendar-id="${esc(e.calendar_id||'_calendar')}" draggable="true" style="background:${this._sanitizeEventColor(e.color)};color:var(--cal-event-fg, #fff);position:relative;" title="${esc(e.title)}">${this._eventTitleContentHtml(e)}${this._eventCardMenuHtml(e, 'month-' + dateStr)}${avatars}</div>`;
  });
  dayTasks.forEach(t => {
    const pc = {urgent:'var(--red)',high:'var(--orange)',medium:'var(--blue)',low:'var(--cal-control-bg, var(--bg3))'}[t.priority] || 'var(--cal-control-bg, var(--bg3))';
    html += `<div class="gb-cal-day-event gb-cal-all-day-task" data-task-id="${t.id}" style="background:${pc};color:var(--cal-event-fg, #fff);" title="${esc(t.title)}">${lucide('checkSquare', 10)} ${esc(t.title)}</div>`;
  });
  return html + '</div>';
};

CalendarComponent.prototype._onDayClick = function(dateStr, anchorEl) {
  if (this._view === 'month') {
    if (typeof this._handleShiftCalendarDayClick === 'function' && this._handleShiftCalendarDayClick(dateStr, anchorEl)) return;
    this._openEventInPanel(null, dateStr + 'T00:00', dateStr + 'T23:59', true);
  } else {
    this._date = this._parseLocalDate(dateStr); this.setView('day');
  }
};

CalendarComponent.prototype._snapshotEventLocal = function(eventId) {
  const ev = (this._events || []).find(x => x.id === eventId);
  return ev ? JSON.parse(JSON.stringify(ev)) : null;
};

CalendarComponent.prototype._applyEventLocal = function(eventId, patch) {
  const ev = (this._events || []).find(x => x.id === eventId);
  if (!ev) return null;
  Object.assign(ev, patch || {});
  return ev;
};

CalendarComponent.prototype._restoreEventLocal = function(snapshot) {
  if (!snapshot?.id) return;
  const idx = (this._events || []).findIndex(x => x.id === snapshot.id);
  if (idx >= 0) this._events[idx] = snapshot;
};

// 選択中の複数イベントをまとめて移動する（グループD&D）。
// ドラッグしたイベントが2件以上の選択に含まれる場合のみ処理し、それ以外は false を返す
// （呼び出し側はこれまでどおり単一移動を行う）。ドラッグイベントは呼び出し側が計算した
// 従来パッチ（draggedApplyPatch=ローカル反映用、draggedApiPatch=サーバー送信用）をそのまま使い、
// 他の選択イベントは otherPatchFn(ev) が返すパッチ（null なら変更なし/対象外）を使う。
CalendarComponent.prototype._moveSelectedEventGroup = async function(draggedEv, draggedApplyPatch, draggedApiPatch, otherPatchFn) {
  const draggedId = draggedEv?.id;
  const selection = this._eventSelection ? this._eventSelection() : null;
  if (!draggedId || !selection || selection.size < 2 || !selection.has(draggedId)) return false;

  const targets = [{ id: draggedId, ev: draggedEv, applyPatch: draggedApplyPatch, apiPatch: draggedApiPatch }];
  let skipped = 0;
  (this._selectedEventRecords ? this._selectedEventRecords() : []).forEach(other => {
    if (!other || other.id === draggedId) return;
    if (other._recurrence_instance || _calGroupMoveSourceBlocked(other)) { skipped += 1; return; }
    const patch = otherPatchFn(other);
    if (patch && Object.keys(patch).length) targets.push({ id: other.id, ev: other, applyPatch: patch, apiPatch: patch });
  });

  const before = targets.map(t => this._snapshotEventLocal(t.id));
  // production-task予定はタスク側が正本で undo 対象外（_eventIsUndoable。コミット前レビュー
  // 指摘 #5 と同じ扱い）。グループ内に undo 可能なイベントが1件も無ければ偽の undo 記録を積まない。
  if (targets.some(t => this._eventIsUndoable(t.ev))) this._pushUndo('イベント移動');
  targets.forEach(t => this._applyEventLocal(t.id, t.applyPatch));
  this._render();

  // production-task予定は汎用更新（自動生成予定として409で拒否される）ではなく、タスクへの
  // 書き戻し（_calApplyEventTimePatch。分割区間なら event_id の part:N からサーバー側が対象
  // 区間を判定し、担当者固定409/区間陳腐化409をそれぞれハンドリングする）を経由させる。
  const results = await Promise.allSettled(targets.map(t => _calApplyEventTimePatch(this, t.ev, t.apiPatch)));
  let failed = 0;
  results.forEach((result, i) => {
    if (result.status !== 'rejected') return;
    failed += 1;
    this._restoreEventLocal(before[i]);
  });

  const notices = [];
  if (failed) notices.push(`${failed}件の移動に失敗`);
  if (skipped) notices.push(`${skipped}件は移動できないためスキップしました`);
  if (notices.length) this._showStatus(notices.join(' / '), true);

  await this._loadEvents();
  this._render();
  return true;
};

CalendarComponent.prototype._onMonthDayDrop = async function(e, dateStr) {
  const eventId = e.dataTransfer.getData('application/x-cal-event');
  if (!eventId) return;
  const ev = this._events.find(x => x.id === eventId);
  if (!ev) return;
  if (_calRecurringInteractionBlocked(this, ev)) return;
  const oldStart = ev.start || '', timePart = oldStart.includes('T') ? oldStart.substring(10) : 'T00:00';
  const newStart = dateStr + timePart;
  let newEnd = '';
  if (ev.end) {
    const dur = new Date(ev.end) - new Date(oldStart);
    newEnd = this._localDateTimeStr(new Date(new Date(newStart).getTime() + dur));
  }
  if (newStart === oldStart && (!ev.end || newEnd === ev.end)) return;
  const dayDelta = _calDateDayDelta(oldStart, dateStr);
  const grouped = await this._moveSelectedEventGroup(
    ev,
    { start: newStart, end: newEnd || ev.end || '' },
    { start: newStart, end: newEnd || undefined },
    other => _calDayShiftPatch(this, other, dayDelta)
  );
  if (grouped) return;
  const before = this._snapshotEventLocal(eventId);
  try {
    // production-task予定はタスク側が正本で undo 対象外（コミット前レビュー指摘 #5 と同じ扱い）。
    if (this._eventIsUndoable(ev)) this._pushUndo('イベント移動');
    this._applyEventLocal(eventId, { start: newStart, end: newEnd || ev.end || '' });
    this._render();
    // production-task予定は汎用更新（自動生成予定として409拒否）ではなく、タスクへの書き戻しを経由する
    // （制作管理UX改善計画 2026-08-04 §6-4 の残作業: 月表示セルへのドロップ）。
    await _calApplyEventTimePatch(this, ev, { start: newStart, end: newEnd || undefined });
    await this._loadEvents(); this._render();
  } catch (error) {
    this._restoreEventLocal(before);
    this._render();
    this._showStatus(error?.message ? ('イベント移動に失敗: ' + error.message) : 'イベント移動に失敗', true);
  }
};

// === 週表示 ===
CalendarComponent.prototype._timedEventSegmentsForDay = function(dateStr) {
  const segments = [];
  (this._events || []).forEach(ev => {
    if (!ev.start || ev.all_day || !this._isCalVisible(ev)) return;
    const seg = this._eventSegmentForDay(ev, dateStr);
    if (!seg) return;
    segments.push({
      ev,
      dateStr,
      segStart: seg.segStart,
      startH: seg.startH,
      endH: Math.max(seg.startH + 0.25, seg.endH),
    });
  });
  return segments.sort((a, b) => (a.startH - b.startH) || (b.endH - a.endH));
};

CalendarComponent.prototype._allDayEventsForDay = function(dateStr) {
  return (this._events || [])
    .filter(ev => ev?.all_day && this._isCalVisible(ev) && this._eventIntersectsDay(ev, dateStr))
    .sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')) || String(a.title || '').localeCompare(String(b.title || '')));
};

CalendarComponent.prototype._allDayStripHtml = function(dateStrs) {
  const cols = Array.isArray(dateStrs) && dateStrs.length ? dateStrs : [];
  if (!cols.length) return '';
  let html = `<div class="gb-cal-all-day-strip" style="display:grid;grid-template-columns:60px repeat(${cols.length}, minmax(0,1fr));border-bottom:1px solid var(--cal-grid-line, var(--border));">`;
  html += '<div class="gb-cal-week-time" style="padding-top:6px;">終日</div>';
  cols.forEach(dateStr => {
    html += `<div class="gb-cal-all-day-cell" data-date="${dateStr}" style="min-height:30px;padding:2px;border-left:1px solid var(--cal-grid-line, var(--border));">`;
    this._allDayEventsForDay(dateStr).forEach(ev => {
      const avatars = typeof this._eventUserAvatarsHtml === 'function' ? this._eventUserAvatarsHtml(ev, 14) : '';
      html += `<div class="gb-cal-day-event gb-cal-all-day-event${this._eventSourceClass(ev)}" data-event-id="${esc(ev.id)}" data-calendar-id="${esc(ev.calendar_id||'_calendar')}" draggable="true" style="background:${this._sanitizeEventColor(ev.color)};color:var(--cal-event-fg, #fff);position:relative;margin:1px 0;" title="${esc(ev.title || '')}">${this._eventTitleContentHtml(ev)}${this._eventCardMenuHtml(ev, 'all-day-' + dateStr)}${avatars}</div>`;
    });
    html += '</div>';
  });
  return html + '</div>';
};

CalendarComponent.prototype._bindAllDayStripEvents = function(rootEl) {
  rootEl.querySelectorAll('.gb-cal-all-day-event[data-event-id]').forEach(evEl => {
    evEl.addEventListener('click', (e) => {
      const moreBtn = e.target.closest('[data-cal-event-more]');
      if (moreBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof this._showEventCardMenu === 'function') this._showEventCardMenu(moreBtn, evEl.dataset.eventId);
        return;
      }
      e.stopPropagation(); this._openEventInPanel(evEl.dataset.eventId);
    });
    evEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-cal-move', JSON.stringify({ id: evEl.dataset.eventId, startH: 0, allDay: true }));
      e.dataTransfer.effectAllowed = 'move';
      evEl.style.opacity = '0.4';
    });
    evEl.addEventListener('dragend', () => { evEl.style.opacity = ''; });
  });
  rootEl.querySelectorAll('.gb-cal-all-day-cell').forEach(cell => {
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.style.background = 'rgba(86,156,214,0.12)'; });
    cell.addEventListener('dragleave', () => { cell.style.background = ''; });
    cell.addEventListener('drop', async (e) => {
      e.preventDefault(); cell.style.background = '';
      const d = e.dataTransfer.getData('application/x-cal-move');
      if (!d) return;
      const { id } = JSON.parse(d);
      const ev = this._events.find(x => x.id === id);
      if (!ev) return;
      if (_calRecurringInteractionBlocked(this, ev)) return;
      const dateStr = cell.dataset.date;
      const dayDelta = _calDateDayDelta(ev.start, dateStr);
      if (_calIsProductionTaskEvent(ev)) {
        // タスク予定には終日という概念が無い（作業予定時間は時刻付きの区間で正本管理する）ため、
        // 終日帯へのドロップは全日化せず、月表示ドロップと同じ「時刻を保ったまま日付だけ移動」
        // として扱い、タスクへの書き戻し経路（_calApplyEventTimePatch）を経由する
        // （制作管理UX改善計画 2026-08-04 §6-4 の残作業: 終日帯へのドロップ）。
        const patch = _calDayShiftPatch(this, ev, dayDelta);
        if (!patch) return;
        const grouped = await this._moveSelectedEventGroup(ev, patch, patch, other => _calDayShiftPatch(this, other, dayDelta));
        if (grouped) return;
        const before = this._snapshotEventLocal(id);
        this._applyEventLocal(id, patch);
        this._render();
        try {
          await _calApplyEventTimePatch(this, ev, patch);
          await this._loadEvents(); this._render();
        } catch (error) {
          this._restoreEventLocal(before);
          this._render();
          this._showStatus(error?.message ? ('イベント移動に失敗: ' + error.message) : 'イベント移動に失敗', true);
        }
        return;
      }
      const spanDays = _calAllDayDateSpan(ev);
      const startDate = _calParseDateValue(dateStr);
      const endDate = spanDays <= 1 ? dateStr : _calDateOnlyString(_calDateAddDays(startDate, spanDays));
      const patch = { start: dateStr, end: endDate, all_day: 1 };
      const grouped = await this._moveSelectedEventGroup(ev, patch, patch, other => _calDayShiftPatch(this, other, dayDelta));
      if (grouped) return;
      const before = this._snapshotEventLocal(id);
      this._pushUndo('イベント移動');
      this._applyEventLocal(id, patch);
      this._render();
      apiPut('/cal/events/' + id, patch)
        .then(() => this._loadEvents())
        .then(() => this._render())
        .catch(() => {
          this._restoreEventLocal(before);
          this._render();
          this._showStatus('イベント移動に失敗', true);
        });
    });
  });
};

CalendarComponent.prototype._layoutTimedEventSegments = function(segments) {
  const out = [];
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    if (!group.length) return;
    const laneEnds = [];
    group.forEach(item => {
      let lane = laneEnds.findIndex(end => end <= item.startH);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = item.endH;
      item._overlapLane = lane;
    });
    const laneCount = Math.max(1, laneEnds.length);
    group.forEach(item => {
      const visibleLane = Math.min(item._overlapLane, 5);
      const visibleCount = Math.min(laneCount, 6);
      out.push({
        ...item,
        overlapLane: visibleLane,
        overlapCount: visibleCount,
      });
    });
    group = [];
    groupEnd = -1;
  };
  (segments || []).forEach(item => {
    if (!group.length || item.startH < groupEnd) {
      group.push(item);
      groupEnd = Math.max(groupEnd, item.endH);
    } else {
      flush();
      group.push(item);
      groupEnd = item.endH;
    }
  });
  flush();
  return out;
};

CalendarComponent.prototype._renderTimedEventSegmentsForDay = function(rootEl, dateStr) {
  const segments = this._layoutTimedEventSegments(this._timedEventSegmentsForDay(dateStr));
  segments.forEach(seg => {
    const cell = rootEl.querySelector(`.gb-cal-week-cell[data-date="${dateStr}"][data-hour="${Math.floor(seg.startH)}"]`);
    if (!cell) return;
    const card = this._createEventCard(seg.ev, seg.segStart, seg.startH, seg.endH, seg);
    cell.appendChild(card);
  });
};

CalendarComponent.prototype._renderWeek = function() {
  const el = this._contentEl;
  const start = new Date(this._date);
  start.setDate(start.getDate() - ((start.getDay() - this._startDay + 7) % 7));
  const today = this._localDateStr();
  const dayNames = this._getDayNames();
  const dateStrs = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    dateStrs.push(this._localDateStr(d));
  }
  let html = '<div class="gb-cal-timed-view">' + this._allDayStripHtml(dateStrs) + '<div class="gb-cal-week"><div></div>';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const ds = this._localDateStr(d);
    const dow = d.getDay();
    html += `<div class="gb-cal-week-header" data-cal-dow="${dow}" data-date="${ds}"${ds===today?' data-today="1"':''}>${dayNames[i]} ${d.getDate()}</div>`;
  }
  for (let h = 0; h < 24; h++) {
    html += `<div class="gb-cal-week-time">${h}:00</div>`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      html += `<div class="gb-cal-week-cell" data-date="${this._localDateStr(d)}" data-hour="${h}"></div>`;
    }
  }
  html += '</div></div>';
  el.innerHTML = html;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    this._renderTimedEventSegmentsForDay(el, this._localDateStr(d));
  }
  this._bindAllDayStripEvents(el);
  this._initWeekDrag(el);
  this._syncNowLineTimer();
};

// === 日表示 ===
CalendarComponent.prototype._renderDay = function() {
  const el = this._contentEl;
  const ds = this._localDateStr(this._date);
  let html = this._allDayStripHtml([ds]) + '<div class="gb-cal-week gb-cal-day-grid" style="grid-template-columns:60px minmax(0,1fr);">';
  for (let h = 0; h < 24; h++) {
    html += `<div class="gb-cal-week-time">${h}:00</div>`;
    html += `<div class="gb-cal-week-cell" data-date="${ds}" data-hour="${h}"></div>`;
  }
  html = '<div class="gb-cal-timed-view">' + html + '</div>';
  el.innerHTML = html;
  this._renderTimedEventSegmentsForDay(el, ds);
  this._bindAllDayStripEvents(el);
  this._initWeekDrag(el);
  this._syncNowLineTimer();
};

// === 複数日表示 ===
CalendarComponent.prototype._renderMultiDays = function() {
  const el = this._contentEl;
  const dateStrs = this._multiDayDateStrs();
  const today = this._localDateStr();
  const dayNames = ['日','月','火','水','木','金','土'];
  let html = '<div class="gb-cal-timed-view">' + this._allDayStripHtml(dateStrs) + `<div class="gb-cal-week gb-cal-multi-day-grid" style="grid-template-columns:60px repeat(${dateStrs.length}, minmax(96px,1fr));">`;
  html += '<div></div>';
  dateStrs.forEach(ds => {
    const d = this._parseLocalDate(ds);
    const dow = d.getDay();
    html += `<div class="gb-cal-week-header" data-cal-dow="${dow}" data-date="${ds}"${ds===today?' data-today="1"':''}>${dayNames[dow]} ${d.getMonth()+1}/${d.getDate()}</div>`;
  });
  for (let h = 0; h < 24; h++) {
    html += `<div class="gb-cal-week-time">${h}:00</div>`;
    dateStrs.forEach(ds => {
      html += `<div class="gb-cal-week-cell" data-date="${ds}" data-hour="${h}"></div>`;
    });
  }
  html += '</div></div>';
  el.innerHTML = html;
  dateStrs.forEach(ds => this._renderTimedEventSegmentsForDay(el, ds));
  this._bindAllDayStripEvents(el);
  this._initWeekDrag(el);
  this._syncNowLineTimer();
};

// === イベントカード生成 ===
CalendarComponent.prototype._createEventCard = function(ev, evStart, startH, endH, layout) {
  const card = document.createElement('div');
  card.className = 'gb-cal-week-event gb-cal-day-event' + this._eventSourceClass(ev);
  card.dataset.eventId = ev.id;
  card.dataset.calendarId = ev.calendar_id || '_calendar';
  card.style.background = this._sanitizeEventColor(ev.color);
  card.style.top = ((startH % 1) * 40) + 'px';
  card.style.height = Math.max(20, (endH - startH) * 40) + 'px';
  card.style.position = 'absolute';
  const lane = Math.max(0, layout?.overlapLane || 0);
  const count = Math.max(1, layout?.overlapCount || 1);
  const offset = lane * 12;
  const rightReserve = 18 + Math.max(0, count - lane - 1) * 12;
  card.style.left = (2 + offset) + 'px';
  card.style.right = rightReserve + 'px';
  card.style.zIndex = String(2 + lane);
  card.innerHTML = `${this._eventTitleContentHtml(ev)}${this._eventCardMenuHtml(ev, 'timed-' + (layout?.dateStr || '') + '-' + String(startH || 0))}${typeof this._eventUserAvatarsHtml === 'function' ? this._eventUserAvatarsHtml(ev, 14) : ''}`;
  card.title = ev.title + '\n' + (ev.start||'').substring(11,16) + '–' + (ev.end||'').substring(11,16);
  card.addEventListener('click', (e) => {
    const moreBtn = e.target.closest('[data-cal-event-more]');
    if (moreBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof this._showEventCardMenu === 'function') this._showEventCardMenu(moreBtn, ev.id);
      return;
    }
    e.stopPropagation(); this._openEventInPanel(ev.id);
  });
  // リサイズハンドル
  const resBot = document.createElement('div'); resBot.className = 'gb-cal-ev-resize-bottom';
  const resTop = document.createElement('div'); resTop.className = 'gb-cal-ev-resize-top';
  card.appendChild(resTop); card.appendChild(resBot);
  resBot.addEventListener('pointerdown', (e) => { if (!_calRecurringInteractionBlocked(this, ev)) this._handleResize(e, card, ev, evStart, startH, 'bottom'); });
  resTop.addEventListener('pointerdown', (e) => { if (!_calRecurringInteractionBlocked(this, ev)) this._handleResize(e, card, ev, evStart, startH, 'top'); });
  // D&D
  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    if (_calRecurringInteractionBlocked(this, ev)) { e.preventDefault(); return; }
    e.dataTransfer.setData('application/x-cal-move', JSON.stringify({ id: ev.id, startH, allDay: false }));
    e.dataTransfer.effectAllowed = 'move';
    card.style.opacity = '0.4';
  });
  card.addEventListener('dragend', () => { card.style.opacity = ''; });
  return card;
};

CalendarComponent.prototype._handleResize = function(e, card, ev, evStart, startH, direction) {
  e.stopPropagation(); e.preventDefault();
  const sy = e.clientY, origTop = parseFloat(card.style.top), origH = card.offsetHeight;
  // 15分刻み: 40px = 1時間、10px = 15分
  const snap15 = (px) => Math.round(px / 10) * 10;
  document.body.style.userSelect = 'none';
  const onMove = (e2) => {
    if (direction === 'bottom') card.style.height = Math.max(10, snap15(origH + e2.clientY - sy)) + 'px';
    else { const dy = snap15(e2.clientY - sy); card.style.top = (origTop + dy) + 'px'; card.style.height = Math.max(10, origH - dy) + 'px'; }
  };
  const snap15min = (h) => Math.round(h * 4) / 4; // 15分単位に丸め
  const onUp = () => {
    document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
    document.body.style.userSelect = ''; card.style.touchAction = '';
    // コミット前レビュー指摘 #5: production-task予定はタスク側が正本で undo 対象外
    // （_eventIsUndoable。_calApplyEventTimePatch がタスクへ書き戻す）。undo記録を積んでも
    // 元に戻せないため、偽のUndo記録を残さない。
    if (this._eventIsUndoable(ev)) this._pushUndo('イベントリサイズ');
    const minDurationMs = 15 * 60000;
    const originalStart = new Date(ev.start || evStart);
    const originalEnd = ev.end ? new Date(ev.end) : new Date(originalStart.getTime() + 3600000);
    if (direction === 'bottom') {
      const newEndH = snap15min(startH + card.offsetHeight / 40);
      const ne = new Date(evStart); ne.setHours(Math.floor(newEndH), (newEndH % 1) * 60);
      if (ne <= originalStart) ne.setTime(originalStart.getTime() + minDurationMs);
      _calApplyEventTimePatch(this, ev, { end: this._localDateTimeStr(ne) })
        .then(() => { this._loadEvents().then(() => this._render()); })
        .catch((error) => { this._showStatus?.(error?.message || '予定のリサイズに失敗しました', true); this._loadEvents().then(() => this._render()); });
    } else {
      const newStartH = snap15min(Math.floor(startH) + parseFloat(card.style.top) / 40);
      const ns = new Date(evStart); ns.setHours(Math.floor(newStartH), (newStartH % 1) * 60);
      if (ns >= originalEnd) ns.setTime(originalEnd.getTime() - minDurationMs);
      _calApplyEventTimePatch(this, ev, { start: this._localDateTimeStr(ns) })
        .then(() => { this._loadEvents().then(() => this._render()); })
        .catch((error) => { this._showStatus?.(error?.message || '予定のリサイズに失敗しました', true); this._loadEvents().then(() => this._render()); });
    }
  };
  card.style.touchAction = 'none';
  document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
};

// === 週ドラッグ選択 ===
CalendarComponent.prototype._initWeekDrag = function(el) {
  let dragging = false, startDate = '', startHour = 0, preview = null;
  const cells = el.querySelectorAll('.gb-cal-week-cell');
  const self = this;
  cells.forEach(cell => {
    cell.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.gb-cal-week-event')) return;
      if (self._selectedCalendar?.()?.source === 'shift') {
        self._showStatus?.('シフトカレンダーは月表示で日付をクリックして追加してください', true);
        return;
      }
      e.preventDefault(); dragging = true;
      startDate = cell.dataset.date; startHour = parseInt(cell.dataset.hour);
      document.body.style.userSelect = 'none';
      preview = document.createElement('div'); preview.className = 'gb-cal-week-event';
      preview.style.cssText = 'background:var(--cal-event-bg, var(--cal-accent, var(--accent)));color:var(--cal-event-fg, var(--ui-accent-fg, var(--ui-fg-strong)));opacity:0.6;pointer-events:none;top:0;height:40px;left:2px;right:18px;';
      preview.textContent = `${startHour}:00 – ${startHour+1}:00`;
      cell.style.position = 'relative'; cell.appendChild(preview);
    });
    cell.addEventListener('pointermove', () => {
      if (!dragging || cell.dataset.date !== startDate) return;
      const curH = parseInt(cell.dataset.hour);
      const minH = Math.min(startHour, curH), maxH = Math.max(startHour, curH) + 1;
      if (preview?.parentElement) preview.remove();
      const anchor = el.querySelector(`.gb-cal-week-cell[data-date="${startDate}"][data-hour="${minH}"]`);
      if (anchor) { anchor.style.position = 'relative'; preview.style.top = '0'; preview.style.height = ((maxH-minH)*40) + 'px'; preview.textContent = `${minH}:00 – ${maxH}:00`; anchor.appendChild(preview); }
    });
    cell.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false; document.body.style.userSelect = '';
      if (preview) { preview.remove(); preview = null; }
      const endH = parseInt(cell.dataset.hour) + 1;
      const minH = Math.min(startHour, endH - 1), maxH = Math.max(startHour + 1, endH);
      let endStr;
      if (maxH >= 24) {
        // 「T24:00」は日時入力欄で扱えないため、翌日0:00として渡す（月末・年末も Date 演算で処理）
        const next = new Date(startDate + 'T00:00');
        next.setDate(next.getDate() + 1);
        endStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}T00:00`;
      } else {
        endStr = startDate + 'T' + String(maxH).padStart(2, '0') + ':00';
      }
      self._openEventInPanel(null, startDate + 'T' + String(minH).padStart(2,'0') + ':00', endStr);
    });
    // D&Dドロップ受け入れ
    cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.style.background = 'rgba(86,156,214,0.15)'; });
    cell.addEventListener('dragleave', () => { cell.style.background = ''; });
    cell.addEventListener('drop', async (e) => {
      e.preventDefault(); cell.style.background = '';
      const d = e.dataTransfer.getData('application/x-cal-move');
      if (!d) return;
      const { id, allDay } = JSON.parse(d);
      const ev = self._events.find(x => x.id === id);
      if (!ev) return;
      if (_calRecurringInteractionBlocked(self, ev)) return;
      const range = _calEventRange(ev);
      if (!range) return;
      const dur = allDay || ev.all_day ? 3600000 : Math.max(15 * 60000, range.end - range.start);
      const ns = new Date(cell.dataset.date + 'T' + String(parseInt(cell.dataset.hour)).padStart(2,'0') + ':00');
      const nextStart = self._localDateTimeStr(ns);
      const nextEnd = self._localDateTimeStr(new Date(ns.getTime()+dur));
      const patch = { start: nextStart, end: nextEnd, all_day: 0 };
      const deltaMs = ns.getTime() - range.start.getTime();
      const grouped = await self._moveSelectedEventGroup(ev, patch, patch, other => _calWeekShiftPatch(self, other, deltaMs));
      if (grouped) return;
      // コミット前レビュー指摘 #5: production-task予定は undo 対象外なので偽記録を積まない。
      if (self._eventIsUndoable(ev)) self._pushUndo('イベント移動');
      const before = self._snapshotEventLocal(id);
      self._applyEventLocal(id, patch);
      self._render();
      _calApplyEventTimePatch(self, ev, patch)
        .then(() => self._loadEvents())
        .then(() => self._render())
        .catch((error) => {
          self._restoreEventLocal(before);
          self._render();
          self._showStatus(error?.message ? ('イベント移動に失敗: ' + error.message) : 'イベント移動に失敗', true);
        });
    });
  });
  const cleanup = () => { if (dragging) { dragging = false; document.body.style.userSelect = ''; if (preview) { preview.remove(); preview = null; } } };
  if (el._calWeekCleanup) document.removeEventListener('pointerup', el._calWeekCleanup);
  el._calWeekCleanup = cleanup;
  document.addEventListener('pointerup', cleanup);
};

CalendarComponent.prototype._clearNowLineTimer = function() {
  if (this._nowLineTimer) clearInterval(this._nowLineTimer);
  this._nowLineTimer = null;
  this._contentEl?.querySelectorAll?.('.gb-cal-now-line').forEach(el => el.remove());
};

CalendarComponent.prototype._syncNowLineTimer = function() {
  if (!['week', 'multi', 'day'].includes(this._view)) {
    this._clearNowLineTimer?.();
    return;
  }
  this._updateNowLine();
  if (this._nowLineTimer) return;
  this._nowLineTimer = setInterval(() => this._updateNowLine(), 30000);
};

CalendarComponent.prototype._updateNowLine = function() {
  const root = this._contentEl;
  if (!root || !['week', 'multi', 'day'].includes(this._view)) return;
  root.querySelectorAll('.gb-cal-now-line').forEach(el => el.remove());
  const now = new Date();
  const dateStr = this._localDateStr(now);
  const hour = now.getHours();
  const cell = root.querySelector(`.gb-cal-week-cell[data-date="${dateStr}"][data-hour="${hour}"]`);
  if (!cell) return;
  const line = document.createElement('div');
  line.className = 'gb-cal-now-line';
  const rect = cell.getBoundingClientRect?.();
  const hourPx = Math.max(1, rect?.height || 40);
  line.style.top = ((now.getMinutes() / 60) * hourPx) + 'px';
  cell.appendChild(line);
};

// === ToDoリスト ===
CalendarComponent.prototype._renderTaskBoard = function() {
  this._clearNowLineTimer?.();
  const el = this._contentEl;
  const statuses = [['backlog','バックログ'],['todo','未着手'],['in_progress','進行中'],['review','レビュー'],['done','完了']];
  let html = '<div class="gb-cal-task-board">';
  statuses.forEach(([key, label]) => {
    const tasks = this._tasks.filter(t => t.status === key && !t.parent_id);
    html += `<div class="gb-cal-task-column"><div class="gb-cal-task-col-header"><span>${label}</span><span style="font-size:11px;color:var(--cal-muted-fg, var(--fg2));">${tasks.length}</span></div><div class="gb-cal-task-col-body">`;
    tasks.forEach(t => {
      const pc = t.priority || 'medium';
      html += `<div class="gb-cal-task-card" data-task-id="${t.id}"><div class="gb-cal-task-card-title">${esc(t.title)}</div><div class="gb-cal-task-card-meta"><span class="gb-cal-task-priority ${pc}">${pc}</span>`;
      if (t.due_date) html += `<span>〆 ${t.due_date.substring(5)}</span>`;
      if (t.assignee) html += `<span>${esc(t.assignee)}</span>`;
      html += '</div></div>';
    });
    html += `<div style="padding:4px;text-align:center;cursor:pointer;color:var(--cal-muted-fg, var(--fg2));font-size:12px;" data-add-task="${key}">+ 追加</div></div></div>`;
  });
  html += '</div>';
  el.innerHTML = html;
  if (el._calClickHandler) el.removeEventListener('click', el._calClickHandler);
  el._calClickHandler = (e) => {
    const card = e.target.closest('.gb-cal-task-card');
    if (card) { this._showTaskModal(card.dataset.taskId); return; }
    const add = e.target.closest('[data-add-task]');
    if (add) this._showTaskModal(null, add.dataset.addTask);
  };
  el.addEventListener('click', el._calClickHandler);
};

// === シフト表 ===
CalendarComponent.prototype._renderShiftView = async function(renderSeq) {
  const activeSeq = renderSeq || this._renderSeq;
  await this._loadShifts();
  if (this._view !== 'shifts' || activeSeq !== this._renderSeq) return;
  const el = this._contentEl, y = this._date.getFullYear(), m = this._date.getMonth();
  const dim = new Date(y, m+1, 0).getDate(), todayStr = this._localDateStr();
  const users = [...new Set(this._shifts.map(s => s.user).filter(Boolean))];
  if (!users.length) users.push(this._getUser());
  const mStart = `${y}-${String(m+1).padStart(2,'0')}-01`;
  const mEnd = `${y}-${String(m+1).padStart(2,'0')}-${String(dim).padStart(2,'0')}T23:59:59`;
  let timeEntries = [];
  try { timeEntries = await apiFetch('/cal/time?date_from=' + mStart + '&date_to=' + mEnd); } catch {}
  if (this._view !== 'shifts' || activeSeq !== this._renderSeq) return;
  let html = '<div style="overflow-x:auto;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
  html += `<span style="font-weight:bold;">${y}年${m+1}月 シフト表</span><button class="gb-cal-shift-add" style="font-size:12px;padding:3px 10px;">+ シフト追加</button></div>`;
  html += '<table style="width:100%;border-collapse:collapse;font-size:11px;"><tr><th style="padding:4px 8px;border:1px solid var(--cal-grid-line, var(--border));background:var(--cal-header-bg, var(--bg3));color:var(--cal-header-fg, var(--fg2));min-width:80px;">ユーザー</th>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = ['日','月','火','水','木','金','土'][new Date(y,m,d).getDay()];
    const isT = ds === todayStr, isW = [0,6].includes(new Date(y,m,d).getDay());
    html += `<th style="padding:2px 4px;border:1px solid var(--cal-grid-line, var(--border));background:${isT?'var(--cal-mini-selected-bg, var(--cal-accent, var(--accent)))':isW?'var(--cal-cell-hover-bg, var(--bg4))':'var(--cal-header-bg, var(--bg3))'};color:${isT?'var(--cal-mini-selected-fg, var(--ui-accent-fg, var(--ui-fg-strong)))':'var(--cal-header-fg, var(--fg))'};min-width:36px;text-align:center;">${d}<br><span style="font-size:9px;">${dow}</span></th>`;
  }
  html += '</tr>';
  users.forEach(user => {
    html += `<tr><td style="padding:4px 8px;border:1px solid var(--cal-grid-line, var(--border));background:var(--cal-sidebar-bg, var(--bg2));font-weight:bold;color:var(--cal-sidebar-fg, var(--fg));">${esc(user)}<br><span style="font-size:9px;color:var(--cal-muted-fg, var(--fg2));">予定</span></td>`;
    for (let d = 1; d <= dim; d++) {
      const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const sh = this._shifts.find(s => s.user === user && s.date === ds);
      const tc = { work: 'var(--blue)', off: 'var(--cal-muted-fg, var(--fg2))', holiday: 'var(--green)' };
      const bg = sh ? (tc[sh.type] || 'var(--cal-muted-fg, var(--fg2))') : '';
      const txt = sh ? (sh.start_time ? sh.start_time.substring(0,5)+'-'+(sh.end_time||'').substring(0,5) : (sh.type==='off'?'休':sh.type==='holiday'?'祝':'')) : '';
      html += `<td class="gb-cal-shift-cell" data-user="${esc(user)}" data-date="${ds}" ${sh?`data-sid="${sh.id}"`:''}style="padding:2px;border:1px solid var(--cal-grid-line, var(--border));text-align:center;cursor:pointer;background:var(--cal-cell-bg, var(--bg));color:var(--cal-fg, var(--fg));${bg?'color:var(--cal-event-fg, #fff);background:'+bg:''}" title="${esc(sh?.note||'')}">${txt}</td>`;
    }
    html += '</tr>';
    html += `<tr><td style="padding:4px 8px;border:1px solid var(--cal-grid-line, var(--border));background:var(--cal-cell-bg, var(--bg));"><span style="font-size:9px;color:var(--cal-muted-fg, var(--fg2));">実績</span></td>`;
    for (let d = 1; d <= dim; d++) {
      const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const de = timeEntries.filter(e => e.user === user && e.timestamp.startsWith(ds));
      const ci = de.find(e => e.type === 'clock_in'), co = de.filter(e => e.type === 'clock_out').pop();
      let breakMs = 0;
      let breakStart = null;
      de.forEach(row => {
        if (row.type === 'break_start') breakStart = row;
        else if (row.type === 'break_end' && breakStart) {
          breakMs += Math.max(0, new Date(row.timestamp) - new Date(breakStart.timestamp));
          breakStart = null;
        }
      });
      let at = '';
      if (ci && co) at = (Math.max(0, new Date(co.timestamp) - new Date(ci.timestamp) - breakMs) / 3600000).toFixed(1) + 'h';
      else if (ci) at = ci.timestamp.substring(11,16)+'-';
      const sh = this._shifts.find(s => s.user === user && s.date === ds);
      const cb = sh && sh.type === 'work' && !ci ? 'background:rgba(244,71,71,0.15);' : '';
      html += `<td style="padding:2px;border:1px solid var(--cal-grid-line, var(--border));text-align:center;font-size:10px;color:var(--cal-muted-fg, var(--fg2));background:var(--cal-cell-bg, var(--bg));${cb}">${at}</td>`;
    }
    html += '</tr>';
  });
  html += '</table></div>';
  el.innerHTML = html;
  el.querySelector('.gb-cal-shift-add')?.addEventListener('click', () => this._showShiftModal());
  el.querySelectorAll('.gb-cal-shift-cell').forEach(c => {
    c.addEventListener('click', () => this._showShiftModal(c.dataset.user, c.dataset.date, c.dataset.sid));
  });
};

CalendarComponent.prototype._loadShifts = async function() {
  const y = this._date.getFullYear(), m = this._date.getMonth() + 1;
  try { this._shifts = await apiFetch('/cal/shifts?month=' + y + '-' + String(m).padStart(2,'0')); } catch { this._shifts = []; }
};

// === ミニカレンダー ===
CalendarComponent.prototype._miniDateRange = function(startStr, endStr) {
  const start = this._parseLocalDate(startStr);
  const end = this._parseLocalDate(endStr);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [endStr].filter(Boolean);
  const dir = start <= end ? 1 : -1;
  const out = [];
  const cur = new Date(start);
  while ((dir > 0 && cur <= end) || (dir < 0 && cur >= end)) {
    out.push(this._localDateStr(cur));
    cur.setDate(cur.getDate() + dir);
  }
  return dir > 0 ? out : out.reverse();
};

CalendarComponent.prototype._onMiniDayClick = function(dateStr, event) {
  const previousDateStr = this._localDateStr(this._date);
  const selected = this._selectedMiniDates || new Set();
  if (event?.shiftKey) {
    const anchor = this._lastMiniDateStr || this._selectedMiniDateList()[0] || previousDateStr;
    this._selectedMiniDates = new Set(this._miniDateRange(anchor, dateStr));
  } else if (event?.ctrlKey || event?.metaKey) {
    if (!selected.size) selected.add(previousDateStr);
    if (selected.has(dateStr)) selected.delete(dateStr);
    else selected.add(dateStr);
    if (!selected.size) selected.add(dateStr);
    this._selectedMiniDates = selected;
    this._lastMiniDateStr = dateStr;
  } else {
    selected.clear();
    this._selectedMiniDates = selected;
    this._lastMiniDateStr = dateStr;
  }
  let focusDateStr = dateStr;
  const selectedList = this._selectedMiniDateList();
  if (selectedList.length > 1) {
    this._view = 'multi';
  } else if (selectedList.length === 1) {
    focusDateStr = selectedList[0];
    this._selectedMiniDates.clear();
  }
  this._date = this._parseLocalDate(focusDateStr);
  this._persistViewToTabState?.(this._view);
  const viewSel = this.el?.querySelector?.('.gb-cal-view-select');
  if (viewSel && viewSel.value !== this._view) viewSel.value = this._view;
  this._syncMultiDayControls?.();
  this._loadEvents().then(() => this._render());
  this._renderMiniCal();
};

CalendarComponent.prototype._renderMiniCal = function() {
  const y = this._date.getFullYear(), m = this._date.getMonth();
  this._miniTitleEl.textContent = `${y}年${m+1}月`;
  const rawFirst = new Date(y, m, 1).getDay();
  const firstDay = (rawFirst - this._startDay + 7) % 7;
  const dim = new Date(y, m+1, 0).getDate();
  const todayStr = this._localDateStr(), selStr = this._localDateStr(this._date);
  const selectedDates = new Set(this._selectedMiniDateList());
  let html = this._getDayNames().map(d => `<div style="font-size:10px;color:var(--cal-muted-fg, var(--fg2));padding:2px;">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += '<div></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isSelected = selectedDates.size ? selectedDates.has(ds) : ds === selStr;
    const cls = [ds===todayStr?'gb-cal-today':'',isSelected?'gb-cal-selected':''].filter(Boolean).join(' ');
    html += `<div class="gb-cal-mini-day ${cls}" data-date="${ds}">${d}</div>`;
  }
  this._miniGridEl.innerHTML = html;
  this._miniGridEl.querySelectorAll('.gb-cal-mini-day').forEach(el => {
    el.addEventListener('click', (event) => this._onMiniDayClick(el.dataset.date, event));
  });
};

// === 今日のToDo ===
CalendarComponent.prototype._renderTodayTasks = function() {
  const todayStr = this._localDateStr();
  const tasks = this._tasks.filter(t => t.due_date === todayStr || (t.status !== 'done' && t.status !== 'backlog'));
  const el = this._todayTasksEl;
  if (!tasks.length) {
    el.innerHTML = '<div style="color:var(--cal-muted-fg, var(--fg2));">ToDoなし</div>';
  } else {
    el.innerHTML = tasks.slice(0, 10).map(t =>
      `<div class="gb-cal-today-task-item" data-task-id="${t.id}" style="padding:4px 0;border-bottom:1px solid var(--cal-grid-line, var(--border));cursor:pointer;">` +
      `<span class="gb-cal-task-priority ${t.priority||'medium'}" style="margin-right:4px;">${(t.priority||'M')[0].toUpperCase()}</span>${esc(t.title)}</div>`
    ).join('');
    el.querySelectorAll('.gb-cal-today-task-item').forEach(item => {
      item.addEventListener('click', () => this._showTaskModal(item.dataset.taskId));
    });
  }
  this._renderProductionTodayTasks?.(el, todayStr);
};

CalendarComponent.prototype._renderProductionTodayTasks = async function(container, todayStr) {
  if (!container || !window.MeldexProductionApi?.list) return;
  const seq = (this._productionTodaySeq || 0) + 1;
  this._productionTodaySeq = seq;
  container.querySelector('.gb-cal-production-today-section')?.remove();
  const user = String(this._getUser?.() || '').trim();
  if (!user) return;
  const plannedOnToday = (value) => {
    const text = String(value || '').trim();
    if (!text) return false;
    const [startRaw, endRaw] = text.includes('|') ? text.split('|', 2) : [text, text];
    const start = String(startRaw || '').slice(0, 10);
    const end = String(endRaw || startRaw || '').slice(0, 10);
    return start <= todayStr && todayStr <= (end || start);
  };
  try {
    const data = await window.MeldexProductionApi.list('タスクリスト', { limit: 1000 });
    if (this._productionTodaySeq !== seq) return;
    const rows = (data.rows || []).filter(row => {
      const props = row.properties || {};
      const assignees = String(props['担当者'] || '').split(/[,\n、]/).map(v => v.trim()).filter(Boolean);
      return assignees.includes(user) && plannedOnToday(props['作業予定日時']);
    }).slice(0, 8);
    if (!rows.length) return;
    const section = document.createElement('div');
    section.className = 'gb-cal-production-today-section';
    const heading = document.createElement('div');
    heading.className = 'gb-cal-production-today-heading';
    heading.textContent = '自分のタスク';
    section.appendChild(heading);
    rows.forEach(row => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-cal-production-today-task';
      item.textContent = row.name || 'タスク';
      item.title = item.textContent;
      item.addEventListener('click', () => {
        if (row.path && typeof openPage === 'function') openPage(row.name || 'タスク', row.path);
      });
      section.appendChild(item);
    });
    container.appendChild(section);
  } catch {}
};

// === カレンダーリスト ===
CalendarComponent.prototype._renderCalendarList = function() {
  const container = this._calListEl;
  if (!container) return;
  container.innerHTML = '';
  this._ensureSelectedCalendar?.();
  this._calendars.forEach(c => {
    const row = document.createElement('div');
    row.className = 'gb-cal-calendar-row';
    row.dataset.calendarId = c.id;
    row.tabIndex = 0;
    row.classList.toggle('is-selected', this._selectedCalendarId === c.id);
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;';
    row.addEventListener('click', (e) => {
      if (e.target.closest('input,button,select,label')) return;
      this._selectCalendar?.(c.id);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this._selectCalendar?.(c.id);
    });
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = this._visibleCalIds.has(c.id);
    cb.addEventListener('change', () => {
      if (cb.checked) this._visibleCalIds.add(c.id); else this._visibleCalIds.delete(c.id);
      if (!cb.checked && this._selectedCalendarId === c.id) this._selectedCalendarId = '';
      this._ensureSelectedCalendar?.();
      apiPut('/cal/calendars/' + c.id + '?_user=' + encodeURIComponent(this._getUser()), { visible: cb.checked ? 1 : 0 });
      this._renderCalendarList();
      this._render();
    });
    const dot = document.createElement('span');
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${c.color};flex-shrink:0;`;
    const label = document.createElement('span');
    label.textContent = c.name;
    label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    row.appendChild(cb); row.appendChild(dot); row.appendChild(label);
    container.appendChild(row);
  });
};

CalendarComponent.prototype._createCalendar = async function() {
  let idx = 1, name = '無題';
  const names = this._calendars.map(c => c.name);
  while (names.includes(name)) { idx++; name = '無題' + idx; }
  const calColor = (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getThemeColorSet === 'function')
    ? (MeldexThemeManager.getThemeColorSet()[this._calendars.length % 8] || PALETTE_COLORS[this._calendars.length % PALETTE_COLORS.length])
    : PALETTE_COLORS[this._calendars.length % PALETTE_COLORS.length];
  await apiPost('/cal/calendars', { name, color: calColor, user: this._getUser() });
  await this._loadCalendars();
};

// === 打刻 ===
CalendarComponent.prototype._initClockPanel = function() {
  const cb = this.el.querySelector('.gb-cal-clock-toggle');
  if (cb) { cb.checked = this._clockEnabled; cb.addEventListener('change', () => this._toggleClockPanel(cb.checked)); }
  if (this._clockBtnsEl) this._clockBtnsEl.style.display = this._clockEnabled ? '' : 'none';
};

CalendarComponent.prototype._toggleClockPanel = function(on) {
  this._clockEnabled = on;
  localStorage.setItem('gb:clock-enabled', on ? 'true' : 'false');
  if (this._clockBtnsEl) this._clockBtnsEl.style.display = on ? '' : 'none';
  if (on) this._updateClockStatus();
};

CalendarComponent.prototype._clockAction = async function(type) {
  try {
    await apiPost('/cal/time', { type, user: this._getUser(), timestamp: this._localDateTimeStr(new Date()) });
    const labels = { clock_in: '出勤しました', clock_out: '退勤しました', break_start: '離席しました', break_end: '復帰しました' };
    this._showStatus(labels[type] || type);
    this._updateClockStatus();
  } catch { this._showStatus('打刻に失敗', true); }
};

CalendarComponent.prototype._updateClockStatus = async function() {
  const todayStr = this._localDateStr();
  try {
    const entries = await apiFetch('/cal/time?user=' + encodeURIComponent(this._getUser()) + '&date_from=' + todayStr);
    const last = entries[entries.length - 1];
    if (!last) { if (this._clockStatusEl) this._clockStatusEl.textContent = '未出勤'; return; }
    const labels = { clock_in: '出勤中', clock_out: '退勤済み', break_start: '離席中', break_end: '出勤中' };
    if (this._clockStatusEl) this._clockStatusEl.textContent = (labels[last.type] || last.type) + ' ' + last.timestamp.substring(11, 16);
  } catch {}
};

// === サイドバーリサイズ ===
CalendarComponent.prototype._toggleSidebar = function() {
  const rz = this.el.querySelector('.gb-cal-sidebar-resize');
  this._sidebarEl.classList.toggle('gb-cal-hidden');
  rz.style.display = this._sidebarEl.classList.contains('gb-cal-hidden') ? 'none' : '';
};

CalendarComponent.prototype._bindSidebarResize = function() {
  const handle = this.el.querySelector('.gb-cal-sidebar-resize');
  const sidebar = this._sidebarEl;
  if (!handle || !sidebar) return;
  let startX, startW;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); startX = e.clientX; startW = sidebar.offsetWidth;
    handle.classList.add('gb-cal-active');
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const onMove = (e2) => { sidebar.style.width = Math.max(120, Math.min(500, startW + e2.clientX - startX)) + 'px'; };
    const onUp = () => { handle.classList.remove('gb-cal-active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); localStorage.setItem('gb:cal-sidebar-width', sidebar.offsetWidth); };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  });
  const saved = localStorage.getItem('gb:cal-sidebar-width');
  if (saved) sidebar.style.width = saved + 'px';
};

// === アラーム ===
CalendarComponent.prototype._checkAlarms = async function() {
  try {
    const alerts = await apiFetch('/cal/alerts?minutes_ahead=2&lookback_minutes=1440&user=' + encodeURIComponent(this._getUser()));
    alerts.forEach(ev => {
      const key = ev.id + ev._alert_time;
      if (this._alertedIds.has(key)) return;
      this._alertedIds.add(key);
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Meldex カレンダー', { body: ev.title + '\n' + (ev.start||'').substring(11,16), icon: '/Meldex_icon.png' });
      this._showStatus('🔔 ' + ev.title);
    });
  } catch {}
};

// === 右パネル（イベント編集フォーム） ===
CalendarComponent.prototype._openEventInPanel = function(editId, defaultStart, defaultEnd, defaultAllDay) {
  const ev = editId ? this._events.find(e => e.id === editId) : null;
  if (ev && _calRecurringInteractionBlocked(this, ev)) return;
  // 親の詳細パネルに表示を委譲
  if (typeof _showCalEventInDetailPanel === 'function') {
    _showCalEventInDetailPanel(ev ? { ...ev } : null, this._calendars.map(c => ({ id: c.id, name: c.name })), defaultStart, defaultEnd, !!defaultAllDay, this);
    return;
  }
  // フォールバック: コンポーネント内の右パネルに表示
  const panel = this._rightPanelEl;
  panel.classList.add('gb-cal-open');
  const now = new Date();
  const sVal = ev ? ev.start.substring(0,16) : (defaultStart || this._localDateTimeStr(now));
  const eVal = ev ? (ev.end||'').substring(0,16) : (defaultEnd || this._localDateTimeStr(new Date(now.getTime()+3600000)));
  const isAllDay = ev ? ev.all_day : !!defaultAllDay;
  const calOpts = this._calendars.map(c => `<option value="${c.id}" ${ev?.calendar_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
  const _rp = CalendarComponent._recParse;
  panel.innerHTML = `<h3>${ev?'イベント編集':'新規イベント'}</h3>
<div class="field"><label>タイトル</label><input class="rp-ev-title" type="text" value="${esc(ev?.title||'')}" placeholder="イベント名"></div>
<div class="field"><label><input class="rp-ev-allday" type="checkbox" ${isAllDay?'checked':''}> 終日</label></div>
<div class="field"><label>開始</label><input class="rp-ev-start" type="datetime-local" value="${sVal}" ${isAllDay?'disabled style="opacity:0.4"':''}></div>
<div class="field"><label>終了</label><input class="rp-ev-end" type="datetime-local" value="${eVal}" ${isAllDay?'disabled style="opacity:0.4"':''}></div>
<div class="field"><label>カレンダー</label><select class="rp-ev-calendar gb-select" style="width:100%;">${calOpts}</select></div>
<div class="field"><label>色</label><button type="button" class="rp-ev-color gb-color-swatch gb-color-swatch--field" data-color="${esc(ev?.color||'#569cd6')}" title="イベント色"></button></div>
<div class="field"><label>場所</label><input class="rp-ev-location" type="text" value="${esc(ev?.location||'')}"></div>
<div class="field"><label>URL</label><input class="rp-ev-url" type="url" value="${esc(ev?.url||'')}" placeholder="https://..."></div>
<div class="field"><label>説明</label><textarea class="rp-ev-desc" rows="3">${esc(ev?.description||'')}</textarea></div>
<div class="field"><label>アラーム</label><select class="rp-ev-alert gb-select" style="width:100%;">
  <option value="-1" ${(ev?.alert_minutes??-1)===-1?'selected':''}>なし</option><option value="0" ${ev?.alert_minutes===0?'selected':''}>イベント時</option>
  <option value="5" ${ev?.alert_minutes===5?'selected':''}>5分前</option><option value="15" ${ev?.alert_minutes===15?'selected':''}>15分前</option>
  <option value="30" ${ev?.alert_minutes===30?'selected':''}>30分前</option><option value="60" ${ev?.alert_minutes===60?'selected':''}>1時間前</option>
</select></div>
<div class="btn-row">
  ${ev?'<button class="danger rp-ev-delete">削除</button>':''}
  <button class="rp-ev-cancel">キャンセル</button>
  <button class="primary rp-ev-save">${ev?'更新':'作成'}</button>
</div>`;
  panel.querySelector('.rp-ev-allday').addEventListener('change', function() {
    const s = panel.querySelector('.rp-ev-start'), e2 = panel.querySelector('.rp-ev-end');
    s.disabled = e2.disabled = this.checked; s.style.opacity = e2.style.opacity = this.checked ? '0.4' : '1';
  });
  const colorSwatch = panel.querySelector('.rp-ev-color');
  bindColorSwatch(colorSwatch, () => getColorSwatchValue(colorSwatch, ev?.color || '#569cd6'), (nextColor) => {
    setColorSwatchValue(colorSwatch, nextColor || '#569cd6');
  });
  panel.querySelector('.rp-ev-save').addEventListener('click', () => this._saveEventFromPanel(ev?.id || ''));
  panel.querySelector('.rp-ev-cancel').addEventListener('click', () => this._closeRightPanel());
  if (ev) panel.querySelector('.rp-ev-delete').addEventListener('click', () => this._deleteEventFromPanel(ev.id));
  setTimeout(() => panel.querySelector('.rp-ev-title')?.focus(), 50);
};

CalendarComponent.prototype._saveEventFromPanel = async function(editId) {
  const p = this._rightPanelEl;
  this._pushUndo(editId ? 'イベント編集' : 'イベント作成');
  const data = {
    title: p.querySelector('.rp-ev-title').value,
    start: p.querySelector('.rp-ev-start').value,
    end: p.querySelector('.rp-ev-end').value,
    all_day: p.querySelector('.rp-ev-allday').checked ? 1 : 0,
    color: getColorSwatchValue(p.querySelector('.rp-ev-color'), ''),
    location: p.querySelector('.rp-ev-location').value,
    url: p.querySelector('.rp-ev-url')?.value || '',
    description: p.querySelector('.rp-ev-desc').value,
    alert_minutes: parseInt(p.querySelector('.rp-ev-alert').value),
    calendar_id: p.querySelector('.rp-ev-calendar')?.value || '',
    user: this._getUser(),
  };
  try {
    if (editId) await apiPut('/cal/events/' + editId, data);
    else await apiPost('/cal/events', data);
    await this._loadEvents(); this._render();
    this._closeRightPanel();
    this._showStatus('イベントを保存しました');
  } catch { this._showStatus('保存に失敗', true); }
};

CalendarComponent.prototype._deleteEventFromPanel = async function(id) {
  if (typeof cfConfirm === 'function' && !await cfConfirm('このイベントを削除しますか？')) return;
  this._pushUndo('イベント削除');
  let calId = '';
  try {
    const evRef = (this._events || []).find(x => x.id === id);
    calId = evRef?.calendar_id || '';
  } catch (_) {}
  try {
    await apiFetch('/cal/events/' + id, { method: 'DELETE' });
    // Audit-P1 H-6: 紐付いたコメントを孤児化する（target_kind='calendar_event'）
    apiPost('/annotations/orphan-by-target', {
      target_kind: 'calendar_event',
      target_file: calId || '_calendar',
      item_id: id,
      cascade_container: true,
    }).catch(() => {});
    await this._loadEvents();
    this._render();
    this._closeRightPanel();
    this._showStatus('削除しました');
  } catch {}
};

CalendarComponent.prototype._closeRightPanel = function() {
  this._rightPanelEl.classList.remove('gb-cal-open');
};

CalendarComponent._recParse = function(ev) { try { return ev?.recurrence ? (typeof ev.recurrence === 'string' ? JSON.parse(ev.recurrence) : ev.recurrence) : {}; } catch { return {}; } };

// === ToDoモーダル ===
CalendarComponent.prototype._showTaskDialogModal = function(editId, defaultStatus) {
  const t = editId ? this._tasks.find(x => x.id === editId) : null;
  const sts = [['backlog','バックログ'],['todo','未着手'],['in_progress','進行中'],['review','レビュー'],['done','完了']];
  const pris = [['low','低'],['medium','中'],['high','高'],['urgent','緊急']];
  const content = document.createElement('div');
  content.innerHTML = `<div class="gb-cal-task-form">
<div class="gb-cal-task-form-wide" role="status" aria-live="polite" data-cal-task-status></div>
<div class="field gb-cal-task-form-wide"><label>タイトル</label><input class="tk-title" value="${esc(t?.title||'')}"></div>
<div class="field"><label>ステータス</label><select class="tk-status">${sts.map(([v,l])=>`<option value="${v}" ${(t?.status||defaultStatus||'todo')===v?'selected':''}>${l}</option>`).join('')}</select></div>
<div class="field"><label>優先度</label><select class="tk-priority">${pris.map(([v,l])=>`<option value="${v}" ${(t?.priority||'medium')===v?'selected':''}>${l}</option>`).join('')}</select></div>
<div class="field"><label>期限</label><input class="tk-due" type="date" value="${t?.due_date||''}"></div>
<div class="field"><label>担当者</label><input class="tk-assignee" value="${esc(t?.assignee||'')}"></div>
<div class="field"><label>見積(h)</label><input class="tk-est" type="number" step="0.5" value="${t?.estimated_hours||0}"></div>
<div class="field"><label>実績(h)</label><input class="tk-act" type="number" step="0.5" value="${t?.actual_hours||0}"></div>
<div class="field gb-cal-task-form-wide"><label>説明</label><textarea class="tk-desc" rows="3">${esc(t?.description||'')}</textarea></div>
</div>`;
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button'; cancelButton.className = 'tk-cancel gb-btn gb-btn-sm'; cancelButton.textContent = 'キャンセル';
  const saveButton = document.createElement('button');
  saveButton.type = 'button'; saveButton.className = 'tk-save gb-btn gb-btn-sm gb-btn-primary primary'; saveButton.textContent = '保存';
  const deleteButton = t ? document.createElement('button') : null;
  if (deleteButton) {
    deleteButton.type = 'button'; deleteButton.className = 'tk-delete gb-btn gb-btn-sm gb-btn-danger danger'; deleteButton.textContent = '削除';
  }
  let busy = false;
  let deleteConfirmPending = false;
  const modalApi = window.GBUI.createModal({
    id: 'calendar-tool-todo',
    title: t ? 'ToDo編集' : '新規ToDo',
    body: [...content.childNodes],
    footer: [deleteButton, cancelButton, saveButton].filter(Boolean),
    variant: 'standard',
    geometryKey: 'calendar-tool-todo',
    minWidth: '0',
    initialFocus: '.tk-title',
    closeLabel: 'ToDo編集を閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
    onBeforeClose: () => !busy && !deleteConfirmPending,
  });
  const o = modalApi.overlay;
  const panel = modalApi.modal;
  modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
  modalApi.body.style.minWidth = '0';
  modalApi.body.style.overflowWrap = 'anywhere';
  o.dataset.e2eId = 'calendar-tool-todo-overlay';
  o._calendarClose = modalApi.close;
  panel.classList.add('gb-cal-task-modal');
  panel.dataset.e2eId = 'calendar-tool-todo-dialog';
  panel.style.cssText = _gbCalModalSizeStyle(450, 'overflow:hidden;');
  const form = panel.querySelector('.gb-cal-task-form');
  if (form) {
    form.style.display = 'grid';
    form.style.gridTemplateColumns = window.innerWidth <= 640 ? 'minmax(0,1fr)' : 'repeat(2,minmax(0,1fr))';
    form.style.gap = '12px';
    form.style.minWidth = '0';
  }
  panel.querySelectorAll('.gb-cal-task-form-wide').forEach(field => { field.style.gridColumn = '1 / -1'; });
  panel.querySelectorAll('.field').forEach(field => {
    field.style.display = 'grid';
    field.style.gap = '6px';
    field.style.minWidth = '0';
    const label = field.querySelector('label');
    if (label) label.style.display = 'block';
  });
  panel.querySelectorAll('.field input,.field select,.field textarea').forEach(control => {
    control.style.width = '100%';
    control.style.minWidth = '0';
    control.style.maxWidth = '100%';
    control.style.boxSizing = 'border-box';
  });
  const status = panel.querySelector('[data-cal-task-status]');
  const setBusy = (next) => {
    busy = next;
    panel.setAttribute('aria-busy', next ? 'true' : 'false');
    [saveButton, deleteButton, cancelButton].filter(Boolean).forEach(button => { button.disabled = next; });
  };
  const reloadTasks = async () => {
    await this._loadTasks();
    this._render();
    this._renderTodayTasks();
  };
  modalApi.open();
  cancelButton.addEventListener('click', () => modalApi.close('cancel'));
  saveButton.addEventListener('click', async () => {
    if (busy) return;
    const data = {
      title: panel.querySelector('.tk-title').value,
      status: panel.querySelector('.tk-status').value,
      priority: panel.querySelector('.tk-priority').value,
      due_date: panel.querySelector('.tk-due').value,
      assignee: panel.querySelector('.tk-assignee').value,
      estimated_hours: parseFloat(panel.querySelector('.tk-est').value) || 0,
      actual_hours: parseFloat(panel.querySelector('.tk-act').value) || 0,
      description: panel.querySelector('.tk-desc').value,
      user: this._getUser(),
    };
    setBusy(true);
    if (status) status.textContent = '保存中...';
    try {
      if (editId) await apiPut('/cal/tasks/' + encodeURIComponent(editId), data);
      else await apiPost('/cal/tasks', data);
    } catch {
      if (status) status.textContent = '保存に失敗しました。入力内容を保ったまま再試行できます。';
      this._showStatus('保存に失敗', true);
      if (modalApi.isOpen()) setBusy(false);
      return;
    }
    let undoFailed = false;
    try { this._pushUndo(editId ? 'ToDo編集' : 'ToDo作成'); }
    catch {
      undoFailed = true;
      this._showStatus('ToDoは保存しましたが、Undo履歴を記録できませんでした', true);
    }
    let reloadFailed = false;
    try { await reloadTasks(); }
    catch {
      reloadFailed = true;
      this._showStatus('ToDoは保存しましたが、表示を更新できませんでした。画面を再読み込みしてください', true);
    }
    if (!reloadFailed && !undoFailed) this._showStatus('ToDoを保存しました');
    setBusy(false);
    modalApi.close('saved');
  });
  deleteButton?.addEventListener('click', async () => {
    if (busy || deleteConfirmPending) return;
    deleteConfirmPending = true;
    setBusy(true);
    if (status) status.textContent = '削除を確認中...';
    let confirmed = false;
    try { confirmed = typeof cfConfirm !== 'function' || await cfConfirm('このToDoを削除しますか？'); }
    catch {
      if (status) status.textContent = '削除確認を表示できませんでした。もう一度お試しください。';
    } finally {
      deleteConfirmPending = false;
      if (!confirmed && modalApi.isOpen()) setBusy(false);
    }
    if (!confirmed) return;
    if (status) status.textContent = '削除中...';
    try {
      await apiFetch('/cal/tasks/' + encodeURIComponent(t.id), { method: 'DELETE' });
    } catch {
      if (status) status.textContent = '削除に失敗しました。もう一度お試しください。';
      this._showStatus('削除に失敗', true);
      if (modalApi.isOpen()) setBusy(false);
      return;
    }
    let undoFailed = false;
    try { this._pushUndo('ToDo削除'); }
    catch {
      undoFailed = true;
      this._showStatus('ToDoは削除しましたが、Undo履歴を記録できませんでした', true);
    }
    let reloadFailed = false;
    try { await reloadTasks(); }
    catch {
      reloadFailed = true;
      this._showStatus('ToDoは削除しましたが、表示を更新できませんでした。画面を再読み込みしてください', true);
    }
    if (!reloadFailed && !undoFailed) this._showStatus('削除しました');
    setBusy(false);
    modalApi.close('deleted');
  });
};
CalendarComponent.prototype._showTaskModal = CalendarComponent.prototype._showTaskDialogModal;
