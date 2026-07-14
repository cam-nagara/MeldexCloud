/**
 * Meldex Calendar Integration (完全版)
 * タイムラインビューのカレンダーモード描画 + 全機能
 */

/* ==============================
   状態管理
   ============================== */
const _calUndoStack = [];
const _calRedoStack = [];
const _CAL_UNDO_MAX = 50;
const _CAL_ALERTED_KEY = 'gb-cal-alerted-ids';
let _calAlertedIds = (()=>{try{const a=JSON.parse(localStorage.getItem(_CAL_ALERTED_KEY)||'[]');return new Set(Array.isArray(a)?a:[]);}catch{return new Set();}})();
function _persistAlertedIds(){try{localStorage.setItem(_CAL_ALERTED_KEY,JSON.stringify([..._calAlertedIds].slice(-500)));}catch{}}
let _calAlarmInterval = null;
let _calStartDay = parseInt(localStorage.getItem('gb-cal-start-day') || '0');
let _calVisibleDbKey = '';
let _calRenderState = { dbPath: '', ctx: null, allEvents: [], visibleEvents: [], info: { kind: 'none', isMappedDb: false, canEditDates: false, canCreateEvents: false, canDeleteEvents: false, canSyncExternal: false, mapping: null } };

function _calendarCtxForDb(dbPath) {
  if (_calRenderState?.ctx && (!dbPath || _calRenderState.dbPath === dbPath)) return _calRenderState.ctx;
  if (typeof _dbFindPaneContextForPath === 'function' && dbPath) return _dbFindPaneContextForPath(dbPath);
  return typeof _currentPaneState === 'function' ? _currentPaneState() : null;
}

async function _refreshCalendarDb(dbPath, options = {}) {
  if (typeof selectDatabase !== 'function') return;
  return selectDatabase(dbPath, options.ctx || _calendarCtxForDb(dbPath), {
    silent: options.silent !== false,
    skipRecent: true,
    skipNavPush: true,
    skipSaveLastView: true,
  });
}

function _rerenderCalendarDb(dbPath) {
  return renderCalendar(_calendarCtxForDb(dbPath));
}

function isCalendarDb() { return !!(state.pivotData && state.pivotData.calendar_db); }
function _normalizeCalendarTimeMode(mode) {
  return ['month', 'week', 'day'].includes(mode) ? mode : 'month';
}
function getCalendarMode(p) {
  const fid = _pathToFileId(p);
  if (fid) {
    try {
      const v = localStorage.getItem('gb-cal-mode-'+fid);
      if (v) return _normalizeCalendarTimeMode(JSON.parse(v));
    } catch {}
  }
  try { return _normalizeCalendarTimeMode(JSON.parse(localStorage.getItem('gb-cal-mode-'+p)) || 'month'); } catch { return 'month'; }
}
function setCalendarMode(p, m) {
  const k = _pathToFileId(p) || p;
  localStorage.setItem('gb-cal-mode-'+k, JSON.stringify(_normalizeCalendarTimeMode(m)));
}
function getCalendarDate(p) {
  const fid = _pathToFileId(p);
  if (fid) { const s = localStorage.getItem('gb-cal-date-'+fid); if (s) return new Date(s); }
  const s = localStorage.getItem('gb-cal-date-'+p); return s ? new Date(s) : new Date();
}
function setCalendarDate(p, d) { const k = _pathToFileId(p) || p; localStorage.setItem('gb-cal-date-'+k, d.toISOString()); }
function _dateStr(d) { return `${d.getFullYear()}-${_p2(d.getMonth()+1)}-${_p2(d.getDate())}`; }
function _p2(n) { return String(n).padStart(2,'0'); }
function _getUser() { try { return JSON.parse(localStorage.getItem('meldex-user')||'{}').name||'anonymous'; } catch { return 'anonymous'; } }
function _calendarUserList(value) {
  let raw = value;
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = raw.split(','); }
  }
  if (!Array.isArray(raw)) raw = [raw];
  const seen = new Set();
  return raw.map(item => String(item || '').trim()).filter(name => {
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
function _calendarEventCreator(ev) { return String(ev?.creator || ev?.user || _getUser() || '').trim(); }
function _calendarEventMembers(ev) { return _calendarUserList(ev?.members); }
function _calendarEventUserNames(ev) {
  const seen = new Set();
  return [_calendarEventCreator(ev), ..._calendarEventMembers(ev)].filter(name => {
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
function _calendarEventAvatarsHtml(ev, size = 14) {
  const names = _calendarEventUserNames(ev).slice(0, 4);
  if (!names.length) return '';
  return `<span class="gb-cal-event-avatars">${names.map(name => {
    const src = window.MeldexDataAccess?.team?.avatarUrl?.(name || 'anonymous', {}) || ('/api/team/avatar/' + encodeURIComponent(name) + '?t=0');
    return `<span class="gb-cal-event-avatar" style="width:${size}px;height:${size}px;" title="${esc(name)}"><img src="${src}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';"><span>${esc((name || '?').charAt(0).toUpperCase() || '?')}</span></span>`;
  }).join('')}</span>`;
}
function _getDayNames() { const a=['日','月','火','水','木','金','土']; return [...a.slice(_calStartDay),...a.slice(0,_calStartDay)]; }
function _weekStart(d) { const r=new Date(d); r.setDate(r.getDate()-((r.getDay()-_calStartDay+7)%7)); r.setHours(0,0,0,0); return r; }
function _getCalendarViewMode(dbPath, ctx) {
  const mode = getCurrentViewMode(dbPath, { ctx });
  if (mode === 'calendar' || mode === 'tasks' || mode === 'shifts' || mode === 'timeline') return mode;
  return 'calendar';
}
function _getActiveCalendarViewMode(dbPath, pivotData, ctx) {
  const info = typeof _getCalendarIntegrationInfo === 'function'
    ? _getCalendarIntegrationInfo(dbPath, pivotData || state.pivotData, ctx)
    : { kind: (pivotData || state.pivotData)?.calendar_db ? 'calendar-db' : 'none' };
  const rawMode = _getCalendarViewMode(dbPath, ctx);
  if (info.kind === 'mapped-db') return rawMode === 'timeline' ? 'timeline' : 'calendar';
  if (info.kind === 'calendar-db') return ['calendar', 'tasks', 'shifts', 'timeline'].includes(rawMode) ? rawMode : 'calendar';
  return 'calendar';
}
function _calendarTimeModes() {
  return [{ v: 'month', l: '月' }, { v: 'week', l: '週' }, { v: 'day', l: '日' }];
}
function _sortCalendarRange(a, b) {
  return a.getTime() <= b.getTime() ? [a, b] : [b, a];
}
function _toCalendarApiValue(date, allDay) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return allDay ? _dateStr(date) : _toCalendarInputValue(date);
}
function _toCalendarInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${_p2(date.getMonth()+1)}-${_p2(date.getDate())}T${_p2(date.getHours())}:${_p2(date.getMinutes())}`;
}
function _parseCalendarDateValue(value) {
  if (typeof apiValueToLocalDate === 'function') return apiValueToLocalDate(value);
  if (typeof parseLocalDate === 'function') return parseLocalDate(value);
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), 0);
  }
  return new Date(value);
}
function _calendarTimeLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${_p2(date.getHours())}:${_p2(date.getMinutes())}`;
}
function _addCalendarMonthsClamped(date, months) {
  const base = new Date(date);
  const targetDay = base.getDate();
  base.setDate(1);
  base.setMonth(base.getMonth() + months);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(targetDay, lastDay));
  return base;
}
function _addCalendarYearsClamped(date, years) {
  const base = new Date(date);
  const month = base.getMonth();
  const targetDay = base.getDate();
  base.setDate(1);
  base.setFullYear(base.getFullYear() + years, month, 1);
  const lastDay = new Date(base.getFullYear(), month + 1, 0).getDate();
  base.setDate(Math.min(targetDay, lastDay));
  return base;
}
function _nextUntitledEventName(events) {
  const used = new Set((events || []).map(ev => String(ev?.name || '').trim()).filter(Boolean));
  let idx = 1;
  let name = '無題イベント';
  while (used.has(name)) {
    idx += 1;
    name = '無題イベント ' + idx;
  }
  return name;
}
function _snapQuarterHour(hours) {
  return Math.round(hours * 4) / 4;
}
function _hourToDate(baseDate, hours) {
  const d = new Date(baseDate);
  const snapped = Math.max(0, Math.min(24, _snapQuarterHour(hours)));
  const whole = Math.floor(snapped);
  const minutes = Math.round((snapped - whole) * 60);
  d.setHours(whole, minutes, 0, 0);
  return d;
}
function _bindCalendarCellAddButton(cell, onClick) {
  if (!cell || typeof onClick !== 'function') return null;
  cell.style.position = cell.style.position || 'relative';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cal-cell-quick-add';
  btn.textContent = '+';
  btn.title = 'イベントを追加';
  btn.setAttribute('aria-label', 'イベントを追加');
  const token = [cell.dataset.date || 'day', cell.dataset.hour || 'all-day'].join('-').replace(/[^a-zA-Z0-9_-]/g, '-');
  btn.dataset.e2eId = `cal-cell-quick-add-${token}`;
  btn.style.cssText = 'position:absolute;top:4px;right:4px;width:20px;height:20px;border:none;border-radius:999px;background:var(--accent);color:var(--ui-fg-strong);font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.12s ease;z-index:4;';
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await onClick();
  });
  cell.appendChild(btn);
  const show = () => { btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; };
  const hide = () => { btn.style.opacity = '0'; btn.style.pointerEvents = 'none'; };
  cell.addEventListener('mouseenter', show);
  cell.addEventListener('mouseleave', hide);
  btn.addEventListener('focus', show);
  btn.addEventListener('blur', hide);
  return btn;
}
async function _quickCreateCalendarEvent(dbPath, options = {}) {
  const info = _calRenderState.info || {};
  if (!info.canCreateEvents) {
    showStatus('このDBではカレンダーから新規作成できません', true);
    return null;
  }
  const start = options.start instanceof Date ? new Date(options.start) : new Date();
  const end = options.end instanceof Date ? new Date(options.end) : new Date(start.getTime() + 3600000);
  const [sortedStart, sortedEnd] = _sortCalendarRange(start, end);
  const allDay = !!options.allDay;
  const title = options.title || _nextUntitledEventName(_calRenderState.allEvents || []);
  const payload = {
    db_path: dbPath,
    title,
    start: _toCalendarApiValue(sortedStart, allDay),
    end: _toCalendarApiValue(sortedEnd, allDay),
    color: options.color || '#569cd6',
    location: '',
    url: '',
    description: '',
    all_day: allDay,
    alert_minutes: -1,
    calendar_id: options.calendarId || 'default',
    recurrence: '',
    creator: _getUser(),
    members: [],
  };
  _calPushUndo('イベント作成');
  try {
    await apiPost('/calendar-db/events', payload);
    await _refreshCalendarDb(dbPath, { silent: false });
    const created = (_calRenderState.allEvents || []).find(ev => ev.name === title)
      || {
        name: title,
        start: sortedStart,
        end: sortedEnd,
        color: payload.color,
        allDay,
        location: '',
        description: '',
        calendarId: payload.calendar_id,
        url: '',
        alertMinutes: -1,
        recurrence: '',
        creator: payload.creator,
        members: payload.members,
      };
    _showCalendarEventDetailPanel(dbPath, created);
    return created;
  } catch (err) {
    showStatus('イベントの作成に失敗しました', true);
    return null;
  }
}
function _defaultQuickCreateOptions(dbPath, activeViewMode) {
  const baseDate = getCalendarDate(dbPath);
  const timeMode = _normalizeCalendarTimeMode(getCalendarMode(dbPath));
  if (activeViewMode === 'calendar' && timeMode === 'month') {
    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    return { start, end: new Date(start), allDay: true };
  }
  const start = new Date(baseDate);
  const now = new Date();
  const defaultHour = _snapQuarterHour(baseDate.toDateString() === now.toDateString() ? now.getHours() + (now.getMinutes() / 60) : 9);
  const snappedStart = _hourToDate(start, defaultHour);
  const end = new Date(snappedStart.getTime() + 3600000);
  return { start: snappedStart, end, allDay: false };
}
function _refreshCalendarAuxPanels(dbPath, events, viewMode) {
  if (typeof showBoardTabs === 'function') showBoardTabs(false);
  if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
  if (typeof showNoteTabs === 'function') showNoteTabs(false);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(viewMode !== 'timeline');
  const rpDetail = document.getElementById('rp-detail');
  if (rpDetail) {
    const todayTab = rpDetail.querySelector('#detail-tab-calendar-today');
    if (todayTab) {
      todayTab.innerHTML = '';
      if (viewMode !== 'timeline') todayTab.appendChild(_renderTodayWidget(null, dbPath, events));
    }
  }
  const previewPane = document.getElementById('gb-preview-pane');
  if (previewPane && previewPane.closest('.gb-pane-content')) {
    previewPane.innerHTML = '';
    delete previewPane.dataset.previewMode;
    if (viewMode !== 'timeline') {
      previewPane.dataset.previewMode = 'calendar-mini';
      previewPane.appendChild(_renderMiniCalendar(null, dbPath, events));
    }
  }
}

/* ==============================
   アンドゥ・リドゥ
   ============================== */
function _cloneCalendarSnapshot(pivotData) {
  return JSON.parse(JSON.stringify(pivotData || {}));
}
function _currentCalendarSnapshotSource() {
  const ctx = _calendarCtxForDb(_calRenderState.dbPath) || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  return { ctx, data: ctx?.pivotData || state.pivotData, dbPath: ctx?.dbPath || _calRenderState.dbPath || state.currentDbPath || '' };
}
function _calendarSnapshotValue(props, propName, fallback) {
  const values = props?.[propName];
  if (!Array.isArray(values) || values.length === 0) return fallback;
  return values[0]?.value ?? fallback;
}
function _calendarSnapshotHasProp(props, propName) {
  const values = props?.[propName];
  return Array.isArray(values) && values.length > 0;
}
function _calendarSnapshotEventPayload(name, props) {
  const start = _calendarSnapshotValue(props, 'start', '');
  if (!start) return null;
  const alertMinutes = parseInt(_calendarSnapshotValue(props, 'alert_minutes', '-1'), 10);
  const allDayRaw = _calendarSnapshotValue(props, 'all_day', false);
  const linkedAutoGeneratedRaw = _calendarSnapshotValue(props, 'linkedAutoGenerated', false);
  const snapshotProps = {
    linkedEntryId: _calendarSnapshotHasProp(props, 'linkedEntryId'),
    linkedEntryPath: _calendarSnapshotHasProp(props, 'linkedEntryPath'),
    linkedEntrySourceProperty: _calendarSnapshotHasProp(props, 'linkedEntrySourceProperty'),
    linkedAutoGenerated: _calendarSnapshotHasProp(props, 'linkedAutoGenerated'),
  };
  return {
    name,
    title: name,
    start,
    end: _calendarSnapshotValue(props, 'end', ''),
    all_day: allDayRaw === true || allDayRaw === 'true' || allDayRaw === 'True',
    color: _calendarSnapshotValue(props, 'color', '#569cd6'),
    location: _calendarSnapshotValue(props, 'location', ''),
    url: _calendarSnapshotValue(props, 'url', ''),
    description: _calendarSnapshotValue(props, 'description', ''),
    recurrence: _calendarSnapshotValue(props, 'recurrence', ''),
    alert_minutes: Number.isFinite(alertMinutes) ? alertMinutes : -1,
    calendar_id: _calendarSnapshotValue(props, 'calendar_id', 'default'),
    creator: _calendarSnapshotValue(props, 'creator', ''),
    members: _calendarSnapshotValue(props, 'members', []),
    linkedEntryId: _calendarSnapshotValue(props, 'linkedEntryId', ''),
    linkedEntryPath: _calendarSnapshotValue(props, 'linkedEntryPath', ''),
    linkedEntrySourceProperty: _calendarSnapshotValue(props, 'linkedEntrySourceProperty', ''),
    linkedAutoGenerated: linkedAutoGeneratedRaw === true || linkedAutoGeneratedRaw === 'true' || linkedAutoGeneratedRaw === 'True',
    _snapshotProps: snapshotProps,
  };
}
function _calendarSnapshotEventMap(snapshot) {
  const events = new Map();
  for (const [name, props] of Object.entries(snapshot?.entities || {})) {
    const payload = _calendarSnapshotEventPayload(name, props);
    if (payload) events.set(name, payload);
  }
  return events;
}
function _calendarSnapshotPayloadEqual(a, b) {
  return !!a && !!b
    && a.start === b.start
    && a.end === b.end
    && a.all_day === b.all_day
    && a.color === b.color
    && a.location === b.location
    && a.url === b.url
    && a.description === b.description
    && a.recurrence === b.recurrence
    && a.alert_minutes === b.alert_minutes
    && a.calendar_id === b.calendar_id
    && a.creator === b.creator
    && JSON.stringify(_calendarUserList(a.members)) === JSON.stringify(_calendarUserList(b.members))
    && _calendarSnapshotOptionalEqual(a, b, 'linkedEntryId')
    && _calendarSnapshotOptionalEqual(a, b, 'linkedEntryPath')
    && _calendarSnapshotOptionalEqual(a, b, 'linkedEntrySourceProperty')
    && _calendarSnapshotOptionalEqual(a, b, 'linkedAutoGenerated');
}
function _calendarSnapshotOptionalEqual(a, b, propName) {
  const aHas = !!a?._snapshotProps?.[propName];
  const bHas = !!b?._snapshotProps?.[propName];
  if (!aHas && !bHas) return true;
  return a[propName] === b[propName];
}
async function _applyCalendarSnapshot(dbPath, currentSnapshot, nextSnapshot) {
  if (!dbPath) throw new Error('対象シートが特定できません');
  const currentEvents = _calendarSnapshotEventMap(currentSnapshot);
  const nextEvents = _calendarSnapshotEventMap(nextSnapshot);
  for (const [name] of currentEvents) {
    if (!nextEvents.has(name)) {
      await apiDelete('/calendar-db/events/' + encodeURIComponent(name) + '?db_path=' + encodeURIComponent(dbPath));
    }
  }
  for (const [name, nextEvent] of nextEvents) {
    const payload = {
      db_path: dbPath,
      title: nextEvent.title,
      start: nextEvent.start,
      end: nextEvent.end,
      color: nextEvent.color,
      location: nextEvent.location,
      url: nextEvent.url,
      description: nextEvent.description,
      all_day: nextEvent.all_day,
      alert_minutes: nextEvent.alert_minutes,
      calendar_id: nextEvent.calendar_id,
      creator: nextEvent.creator,
      members: _calendarUserList(nextEvent.members),
      recurrence: nextEvent.recurrence,
    };
    if (nextEvent._snapshotProps?.linkedEntryId) payload.linkedEntryId = nextEvent.linkedEntryId;
    if (nextEvent._snapshotProps?.linkedEntryPath) payload.linkedEntryPath = nextEvent.linkedEntryPath;
    if (nextEvent._snapshotProps?.linkedEntrySourceProperty) payload.linkedEntrySourceProperty = nextEvent.linkedEntrySourceProperty;
    if (nextEvent._snapshotProps?.linkedAutoGenerated) payload.linkedAutoGenerated = nextEvent.linkedAutoGenerated;
    const currentEvent = currentEvents.get(name);
    if (!currentEvent) {
      await apiPost('/calendar-db/events', payload);
    } else if (!_calendarSnapshotPayloadEqual(currentEvent, nextEvent)) {
      await apiPut('/calendar-db/events/' + encodeURIComponent(name), payload);
    }
  }
}
function _calPushUndo(label) {
  const { data, dbPath } = _currentCalendarSnapshotSource();
  if (!dbPath) return;
  _calUndoStack.push({ label, dbPath, snapshot: _cloneCalendarSnapshot(data) });
  if (_calUndoStack.length > _CAL_UNDO_MAX) _calUndoStack.shift();
  _calRedoStack.length = 0;
  if (typeof markAutoVersionDirty === 'function') markAutoVersionDirty();
}

async function _calendarSnapshotForDb(targetDbPath, currentDbPath, currentData) {
  if (targetDbPath === currentDbPath) return _cloneCalendarSnapshot(currentData);
  return apiFetch('/pivot?path=' + encodeURIComponent(targetDbPath));
}

async function _calUndo() {
  if (!_calUndoStack.length) return;
  const { ctx, data, dbPath } = _currentCalendarSnapshotSource();
  const snap = _calUndoStack[_calUndoStack.length - 1];
  const targetDbPath = snap.dbPath || dbPath;
  try {
    const currentSnapshot = await _calendarSnapshotForDb(targetDbPath, dbPath, data);
    await _applyCalendarSnapshot(targetDbPath, currentSnapshot, snap.snapshot);
    _calUndoStack.pop();
    _calRedoStack.push({ label: '(現在)', dbPath: targetDbPath, snapshot: currentSnapshot });
    if (_calRedoStack.length > _CAL_UNDO_MAX) _calRedoStack.shift();
    await selectDatabase(targetDbPath, ctx, { silent: true });
    showStatus('元に戻しました: ' + snap.label);
  } catch (err) {
    try { if (targetDbPath) await selectDatabase(targetDbPath, ctx, { silent: true }); } catch {}
    showStatus('元に戻せませんでした: ' + (err?.message || err), true);
  }
}

async function _calRedo() {
  if (!_calRedoStack.length) return;
  const { ctx, data, dbPath } = _currentCalendarSnapshotSource();
  const snap = _calRedoStack[_calRedoStack.length - 1];
  const targetDbPath = snap.dbPath || dbPath;
  try {
    const currentSnapshot = await _calendarSnapshotForDb(targetDbPath, dbPath, data);
    await _applyCalendarSnapshot(targetDbPath, currentSnapshot, snap.snapshot);
    _calRedoStack.pop();
    _calUndoStack.push({ label: '(現在)', dbPath: targetDbPath, snapshot: currentSnapshot });
    if (_calUndoStack.length > _CAL_UNDO_MAX) _calUndoStack.shift();
    await selectDatabase(targetDbPath, ctx, { silent: true });
    showStatus('やり直しました');
  } catch (err) {
    try { if (targetDbPath) await selectDatabase(targetDbPath, ctx, { silent: true }); } catch {}
    showStatus('やり直せませんでした: ' + (err?.message || err), true);
  }
}

// Ctrl+Z / Ctrl+Y → gb-shortcuts.js の中央ハンドラに移行済み

/* ==============================
   設定バー
   ============================== */
function renderCalendarSettingsBar(container, dbPath, viewMode, pivotData, ctx) {
  const data = pivotData || state.pivotData;
  const info = typeof _getCalendarIntegrationInfo === 'function'
    ? _getCalendarIntegrationInfo(dbPath, data, ctx)
    : { kind: 'calendar-db', isMappedDb: false, canEditDates: true, canCreateEvents: true, canDeleteEvents: true, canSyncExternal: true };
  const timeMode = typeof _normalizeCalendarModeForDb === 'function'
    ? _normalizeCalendarModeForDb(dbPath, getCalendarMode(dbPath), data)
    : getCalendarMode(dbPath);
  const curDate = getCalendarDate(dbPath);
  const activeViewMode = viewMode || _getActiveCalendarViewMode(dbPath, data, ctx);
  const bar = document.createElement('div');
  bar.className = 'tl-settings';
  const sel = _calendarTimeModes().map(m=>`<option value="${m.v}" ${timeMode===m.v?'selected':''}>${m.l}</option>`).join('');
  const title = activeViewMode === 'calendar' ? _calTitle(curDate, timeMode) : _calTitle(curDate, activeViewMode === 'day' ? 'day' : 'month');
  const viewBadge = activeViewMode === 'tasks'
    ? '<span style="font-size:11px;color:var(--fg2);padding:0 6px;">ToDoリスト</span>'
    : activeViewMode === 'shifts'
      ? '<span style="font-size:11px;color:var(--fg2);padding:0 6px;">シフトビュー</span>'
      : '';
  bar.innerHTML = `
    ${activeViewMode === 'calendar'
      ? `<label>表示: <select id="cal-mode" class="gb-select gb-select-sm">${sel}</select></label>`
      : viewBadge}
    <button id="cal-prev" type="button" class="tl-nav-btn" title="前へ" aria-label="前へ">${lucide('chevronLeft', 14)}</button>
    <span id="cal-title" style="font-weight:600;min-width:120px;text-align:center;">${esc(title)}</span>
    <button id="cal-next" type="button" class="tl-nav-btn" title="次へ" aria-label="次へ">${lucide('chevronRight', 14)}</button>
    <button id="cal-today" type="button" class="tl-nav-btn" title="今日" aria-label="今日">今日</button>
    ${info.isMappedDb ? '<span style="font-size:11px;color:var(--fg2);padding:0 8px;">日時のみ編集可</span>' : ''}
    ${info.canCreateEvents ? '<button id="cal-add-ev" type="button" class="tl-nav-btn" title="イベント追加" aria-label="イベント追加">+ イベント</button>' : ''}
    ${info.canCreateEvents && activeViewMode==='tasks'?'<button id="cal-add-task" type="button" class="tl-nav-btn" title="ToDo追加" aria-label="ToDo追加">+ ToDo</button>':''}
    <button id="cal-timer" type="button" class="tl-nav-btn" title="タイマー" aria-label="タイマー">タイマー</button>
    ${info.canSyncExternal ? '<button id="cal-sync" type="button" class="tl-nav-btn" title="同期" aria-label="同期">同期</button>' : ''}
    <label style="margin-left:auto;font-size:10px;">開始曜日:
      <select id="cal-start-day" class="gb-select gb-select-sm">
        <option value="0" ${_calStartDay===0?'selected':''}>日</option>
        <option value="1" ${_calStartDay===1?'selected':''}>月</option>
        <option value="2" ${_calStartDay===2?'selected':''}>火</option>
        <option value="3" ${_calStartDay===3?'selected':''}>水</option>
        <option value="4" ${_calStartDay===4?'selected':''}>木</option>
        <option value="5" ${_calStartDay===5?'selected':''}>金</option>
        <option value="6" ${_calStartDay===6?'selected':''}>土</option>
      </select>
    </label>
  `;
  container.appendChild(bar);
  bar.querySelector('#cal-mode')?.addEventListener('change', function() { setCalendarMode(dbPath, this.value); renderCalendar(ctx); });
  bar.querySelector('#cal-prev').addEventListener('click', () => { _calNav(dbPath, activeViewMode === 'calendar' ? timeMode : activeViewMode, -1); renderCalendar(ctx); });
  bar.querySelector('#cal-next').addEventListener('click', () => { _calNav(dbPath, activeViewMode === 'calendar' ? timeMode : activeViewMode, 1); renderCalendar(ctx); });
  bar.querySelector('#cal-today').addEventListener('click', () => { setCalendarDate(dbPath,new Date()); renderCalendar(ctx); });
  bar.querySelector('#cal-add-ev')?.addEventListener('click', () => _quickCreateCalendarEvent(dbPath, _defaultQuickCreateOptions(dbPath, activeViewMode)));
  const addTask = bar.querySelector('#cal-add-task');
  if (addTask) addTask.addEventListener('click', () => _openTaskModal(dbPath, null, 'todo'));
  bar.querySelector('#cal-timer').addEventListener('click', () => {
    if (typeof openTimerPanel === 'function') openTimerPanel();
    else if (typeof showStatus === 'function') showStatus('タイマーパネルを初期化できませんでした', true);
  });
  bar.querySelector('#cal-sync')?.addEventListener('click', () => _showSyncModal(dbPath));
  bar.querySelector('#cal-start-day').onchange = function() {
    _calStartDay = parseInt(this.value);
    localStorage.setItem('gb-cal-start-day', _calStartDay);
    renderCalendar(ctx);
  };
}

function _calTitle(d,mode) {
  if (typeof formatMeldexDateIntl === 'function') {
    if(mode==='month'||mode==='tasks'||mode==='shifts') return formatMeldexDateIntl(d, { year: 'numeric', month: 'long' });
    if(mode==='week'){const s=_weekStart(d),e=new Date(s);e.setDate(e.getDate()+6);return `${formatMeldexDateIntl(s, { month: 'numeric', day: 'numeric' })} – ${formatMeldexDateIntl(e, { month: 'numeric', day: 'numeric' })}`;}
    return formatMeldexDateIntl(d, { year: 'numeric', month: 'numeric', day: 'numeric' });
  }
  const y=d.getFullYear(),m=d.getMonth()+1;
  if(mode==='month'||mode==='tasks'||mode==='shifts') return `${y}年${m}月`;
  if(mode==='week'){const s=_weekStart(d),e=new Date(s);e.setDate(e.getDate()+6);return `${s.getMonth()+1}/${s.getDate()} – ${e.getMonth()+1}/${e.getDate()}`;}
  return `${y}/${m}/${d.getDate()}`;
}
function _calNav(p,mode,dir) {
  const d=getCalendarDate(p);
  if(mode==='month'||mode==='tasks'||mode==='shifts') {
    const next = _addCalendarMonthsClamped(d, dir);
    d.setTime(next.getTime());
  }
  else if(mode==='week') d.setDate(d.getDate()+7*dir);
  else d.setDate(d.getDate()+dir);
  setCalendarDate(p,d);
}

/* ==============================
   メインレンダラー
   ============================== */
function renderCalendar(ctx) {
  ctx = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const data = ctx?.pivotData || state.pivotData;
  const container = (typeof _paneEl === 'function' ? _paneEl(ctx, '.timeline-view') : null) || document.getElementById('timeline-view');
  if (!container) {
    if (typeof showStatus === 'function') showStatus('カレンダー表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }
  if (!data || !data.entities) { container.innerHTML = ''; return; }
  const dbPath = ctx?.dbPath || state.currentDbPath;
  const info = typeof _getCalendarIntegrationInfo === 'function'
    ? _getCalendarIntegrationInfo(dbPath, data, ctx)
    : { kind: data.calendar_db ? 'calendar-db' : 'none', isMappedDb: false, canEditDates: !!data.calendar_db, canCreateEvents: !!data.calendar_db, canDeleteEvents: !!data.calendar_db, canSyncExternal: !!data.calendar_db, mapping: null };
  if (info.kind === 'none') { container.innerHTML = ''; return; }
  const activeViewMode = _getActiveCalendarViewMode(dbPath, data, ctx);
  if (activeViewMode === 'timeline' && typeof renderTimeline === 'function') {
    renderTimeline(ctx);
    return;
  }
  let mode = getCalendarMode(dbPath);
  if (typeof _normalizeCalendarModeForDb === 'function') {
    const normalizedMode = _normalizeCalendarModeForDb(dbPath, mode, data);
    if (normalizedMode !== mode) {
      setCalendarMode(dbPath, normalizedMode);
      mode = normalizedMode;
    }
  }
  if (_calVisibleDbKey !== dbPath) {
    _calVisibleDbKey = dbPath;
    _calVisibleIds = null;
    _calKnownIds = null;
  }
  container.innerHTML = '';
  renderCalendarSettingsBar(container, dbPath, activeViewMode, data, ctx);
  const allEvents = typeof _collectCalendarEventsForDb === 'function'
    ? _collectCalendarEventsForDb(dbPath, data, ctx)
    : _collectCalendarEvents(data, dbPath);
  const allCalIds = [...new Set(allEvents.map(e => e.calendarId || 'default'))];
  if (!_calVisibleIds) {
    _calVisibleIds = new Set(allCalIds);
    _calKnownIds = new Set(allCalIds);
  } else {
    if (!_calKnownIds) _calKnownIds = new Set([..._calVisibleIds]);
    allCalIds.forEach(cid => {
      if (!_calKnownIds.has(cid)) _calVisibleIds.add(cid);
      _calKnownIds.add(cid);
    });
    [..._calVisibleIds].forEach(cid => { if (!allCalIds.includes(cid)) _calVisibleIds.delete(cid); });
    [..._calKnownIds].forEach(cid => { if (!allCalIds.includes(cid)) _calKnownIds.delete(cid); });
  }
  const events = allEvents.filter(ev => !_calVisibleIds || _calVisibleIds.has(ev.calendarId || 'default'));
  _calRenderState = { dbPath, ctx, allEvents, visibleEvents: events, info };
  _refreshCalendarAuxPanels(dbPath, events, activeViewMode);
  if (activeViewMode === 'tasks') _renderTaskBoard(container, dbPath, events);
  else if (activeViewMode === 'shifts') _renderShiftView(container, dbPath, events);
  else if (mode === 'week') _renderWeek(container, dbPath, events);
  else if (mode === 'day') _renderDay(container, dbPath, events);
  else _renderMonth(container, dbPath, events);
  // アラームチェッカー起動
  _startAlarmChecker(dbPath, events);
}

/* ==============================
   イベントデータ収集
   ============================== */
function _expandRecurrence(ev, dbPath){
  // 繰り返し展開。ev.recurrence は JSON文字列 ({type,interval,endDate,count,daysOfWeek?})
  if(!ev.recurrence) return [ev];
  let rec; try{rec=typeof ev.recurrence==='string'?JSON.parse(ev.recurrence):ev.recurrence;}catch{return [ev];}
  if(!rec||!rec.type) return [ev];
  const interval=Math.max(1,parseInt(rec.interval,10)||1);
  const type=String(rec.type||'').toLowerCase();
  const out=[ev];
  const dur=ev.end-ev.start;
  const window=_calendarRecurrenceWindow(dbPath);
  const parsedEnd=_calendarParseRecurrenceEndDate(rec.endDate);
  const endLimit=parsedEnd || window.end;
  const countLimit=_calendarRecurrenceCount(rec);
  const MAX=5000; // 表示範囲を広げても無制限展開しない安全装置

  if(type==='weekly' && Array.isArray(rec.daysOfWeek) && rec.daysOfWeek.length){
    const days=[...new Set(rec.daysOfWeek.map(d=>parseInt(d,10)).filter(d=>Number.isFinite(d)&&d>=0&&d<=6))].sort((a,b)=>a-b);
    if(!days.length) return [ev];
    let weekStart=new Date(ev.start);weekStart.setDate(weekStart.getDate()-weekStart.getDay());weekStart.setHours(0,0,0,0);
    if(!countLimit && window.start>weekStart){
      const weeks=Math.max(0,Math.floor((window.start-weekStart)/(7*86400000)));
      const jumpWeeks=Math.max(0,Math.floor(weeks/interval)-1)*interval;
      weekStart.setDate(weekStart.getDate()+jumpWeeks*7);
    }
    let occurrenceNumber=1;
    let finished=false;
    for(let i=0;i<MAX&&!finished;i++){
      for(const dow of days){
        const dd=new Date(weekStart);dd.setDate(dd.getDate()+dow);
        dd.setHours(ev.start.getHours(),ev.start.getMinutes(),ev.start.getSeconds(),ev.start.getMilliseconds());
        if(dd<=ev.start) continue;
        occurrenceNumber++;
        if(countLimit && occurrenceNumber>countLimit){finished=true;break;}
        if(dd>endLimit){finished=true;break;}
        if(_calendarOccurrenceTouchesWindow(dd,dur,window.start,window.end)){
          out.push({...ev,start:new Date(dd),end:new Date(dd.getTime()+dur),_recurrenceInstance:true,_origStart:ev.start,_origEnd:ev.end});
          if(out.length>=MAX){finished=true;break;}
        }
        if(!countLimit && dd>window.end){finished=true;break;}
      }
      weekStart.setDate(weekStart.getDate()+7*interval);
      if(weekStart>endLimit||(!countLimit&&weekStart>window.end)) break;
    }
    return out;
  }

  let { current: cur, occurrenceNumber } = _calendarFastForwardRecurrence(ev.start, type, interval, dur, window.start, countLimit);
  for(let i=0;i<MAX;i++){
    const next=_calendarAdvanceRecurrenceDate(cur,type,interval);
    if(!next) break;
    occurrenceNumber++;
    if(countLimit && occurrenceNumber>countLimit) break;
    if(next>endLimit) break;
    if(_calendarOccurrenceTouchesWindow(next,dur,window.start,window.end)){
      out.push({...ev,start:new Date(next),end:new Date(next.getTime()+dur),_recurrenceInstance:true,_origStart:ev.start,_origEnd:ev.end});
      if(out.length>=MAX) break;
    }
    if(!countLimit && next>window.end) break;
    cur=next;
  }
  return out;
}

function _collectCalendarEvents(data, dbPath) {
  const events = [];
  for (const [name, props] of Object.entries(data.entities)) {
    const sv=props['start']; if(!sv||!sv.length) continue;
    const calV=props['calendar_id'];
    const ev=props['end'], cv=props['color'], adv=props['all_day'];
    const locV=props['location'], descV=props['description'];
    const urlV=props['url'], alertV=props['alert_minutes'], recV=props['recurrence'];
    const creatorV=props['creator'], membersV=props['members'];
    const linkedAutoGeneratedRaw = _calendarSnapshotValue(props, 'linkedAutoGenerated', false);
    const baseEv={
      name, file: sv[0].file||'',
      start: _parseCalendarDateValue(sv[0].value),
      end: ev&&ev.length ? _parseCalendarDateValue(ev[0].value) : _parseCalendarDateValue(sv[0].value),
      color: cv&&cv.length ? cv[0].value : '#569cd6',
      allDay: adv&&adv.length ? (adv[0].value==='True'||adv[0].value==='true') : false,
      location: locV&&locV.length ? locV[0].value : '',
      description: descV&&descV.length ? descV[0].value : '',
      calendarId: calV&&calV.length ? calV[0].value : 'default',
      url: urlV&&urlV.length ? urlV[0].value : '',
      alertMinutes: alertV&&alertV.length ? parseInt(alertV[0].value) : -1,
      recurrence: recV&&recV.length ? recV[0].value : '',
      creator: creatorV&&creatorV.length ? creatorV[0].value : '',
      members: membersV&&membersV.length ? _calendarUserList(membersV[0].value) : [],
      linkedEntryId: _calendarSnapshotValue(props, 'linkedEntryId', ''),
      linkedEntryPath: _calendarSnapshotValue(props, 'linkedEntryPath', ''),
      linkedEntrySourceProperty: _calendarSnapshotValue(props, 'linkedEntrySourceProperty', ''),
      linkedAutoGenerated: linkedAutoGeneratedRaw === true || linkedAutoGeneratedRaw === 'true' || linkedAutoGeneratedRaw === 'True',
    };
    for(const expanded of _expandRecurrence(baseEv, dbPath)) events.push(expanded);
  }
  return events;
}

function _isTask(ev) { return (ev.description || '').includes('status:'); }
function _taskStatus(ev) { return (ev.description || '').match(/status:(\w+)/)?.[1] || ''; }
function _taskPriority(ev) { return (ev.description || '').match(/priority:(\w+)/)?.[1] || 'medium'; }
function _calendarParseRecurrenceEndDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const end = _parseCalendarDateValue(raw);
    if (end instanceof Date && !Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999);
      return end;
    }
  }
  const parsed = _parseCalendarDateValue(raw);
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
}
function _calendarRecurrenceWindow(dbPath) {
  let center = null;
  try { center = getCalendarDate(dbPath || _calRenderState.dbPath || state.currentDbPath || ''); } catch {}
  if (!(center instanceof Date) || Number.isNaN(center.getTime())) center = new Date();
  const start = new Date(center);
  start.setFullYear(start.getFullYear() - 2);
  start.setHours(0, 0, 0, 0);
  const end = new Date(center);
  end.setFullYear(end.getFullYear() + 2);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
function _calendarRecurrenceCount(rec) {
  const count = parseInt(rec?.count, 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}
function _calendarAdvanceRecurrenceDate(date, type, interval) {
  const next = new Date(date);
  if (type === 'daily') next.setDate(next.getDate() + interval);
  else if (type === 'weekly') next.setDate(next.getDate() + 7 * interval);
  else if (type === 'monthly') next.setTime(_addCalendarMonthsClamped(date, interval).getTime());
  else if (type === 'yearly') next.setTime(_addCalendarYearsClamped(date, interval).getTime());
  else if (type === 'hourly') next.setHours(next.getHours() + interval);
  else if (type === 'minutely') next.setMinutes(next.getMinutes() + interval);
  else return null;
  return next instanceof Date && !Number.isNaN(next.getTime()) ? next : null;
}
function _calendarOccurrenceTouchesWindow(start, duration, windowStart, windowEnd) {
  const finish = new Date(start.getTime() + Math.max(0, duration || 0));
  return finish >= windowStart && start <= windowEnd;
}
function _calendarFastForwardRecurrence(baseDate, type, interval, duration, windowStart, countLimit) {
  const stepMs = type === 'minutely' ? 60000 * interval
    : type === 'hourly' ? 3600000 * interval
    : type === 'daily' ? 86400000 * interval
    : type === 'weekly' ? 7 * 86400000 * interval
    : 0;
  if (!stepMs || windowStart <= baseDate) return { current: new Date(baseDate), occurrenceNumber: 1 };
  const target = windowStart.getTime() - Math.max(0, duration || 0) - stepMs;
  let jumps = Math.floor((target - baseDate.getTime()) / stepMs);
  if (!Number.isFinite(jumps) || jumps <= 0) return { current: new Date(baseDate), occurrenceNumber: 1 };
  if (countLimit) jumps = Math.min(jumps, Math.max(0, countLimit - 1));
  return {
    current: new Date(baseDate.getTime() + jumps * stepMs),
    occurrenceNumber: 1 + jumps,
  };
}
function _calendarEventDisplayEnd(ev) {
  const start = ev?.start instanceof Date ? ev.start : _parseCalendarDateValue(ev?.start || '');
  const end = ev?.end instanceof Date ? new Date(ev.end) : _parseCalendarDateValue(ev?.end || ev?.start || '');
  if (!ev?.allDay && start instanceof Date && end instanceof Date && end > start
    && end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0) {
    end.setMilliseconds(-1);
  }
  return end;
}
function _calendarEventOccursOnDay(ev, dayDate) {
  const day = new Date(dayDate);
  day.setHours(0, 0, 0, 0);
  const start = new Date(ev.start);
  start.setHours(0, 0, 0, 0);
  const end = _calendarEventDisplayEnd(ev);
  end.setHours(0, 0, 0, 0);
  return day >= start && day <= end;
}
function _calendarEventSegmentHours(ev, dayDate) {
  const day = new Date(dayDate);
  day.setHours(0, 0, 0, 0);
  if (ev.allDay) return { start: 0, end: 1 };
  const dayKey = day.toDateString();
  const renderEnd = _calendarEventDisplayEnd(ev);
  let startH = ev.start.toDateString() === dayKey ? ev.start.getHours() + ev.start.getMinutes() / 60 : 0;
  let endH = renderEnd.toDateString() === dayKey
    ? renderEnd.getHours() + renderEnd.getMinutes() / 60 + renderEnd.getSeconds() / 3600 + renderEnd.getMilliseconds() / 3600000
    : 24;
  if (endH > 23.99) endH = 24;
  if (endH <= startH) endH = Math.min(24, startH + 0.25);
  return { start: startH, end: endH };
}
function _calendarEventOverlapLayouts(events, dayDate) {
  const items = events.map((ev, index) => ({ ev, index, ..._calendarEventSegmentHours(ev, dayDate) }));
  const parent = items.map((_, index) => index);
  const find = index => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].start < items[j].end && items[j].start < items[i].end) union(i, j);
    }
  }
  const groups = new Map();
  items.forEach((item, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  });
  const layouts = new Map();
  for (const group of groups.values()) {
    const lanes = [];
    group.sort((a, b) => a.start - b.start || a.end - b.end).forEach(item => {
      let laneIndex = lanes.findIndex(end => end <= item.start);
      if (laneIndex < 0) {
        laneIndex = lanes.length;
        lanes.push(item.end);
      } else {
        lanes[laneIndex] = item.end;
      }
      item.lane = laneIndex;
    });
    const laneCount = Math.max(1, lanes.length);
    group.forEach(item => layouts.set(item.ev, { lane: item.lane, lanes: laneCount }));
  }
  return layouts;
}
function _calendarDragPayloadForEvent(ev) {
  return {
    name: ev.name,
    file: ev.file,
    start: _toCalendarApiValue(ev.start, !!ev.allDay),
    end: _toCalendarApiValue(ev.end || ev.start, !!ev.allDay),
    duration: ev.end - ev.start,
    entityName: ev.entityName || '',
    entityPath: ev.entityPath || '',
    mapped: !!ev._mapped,
    allDay: !!ev.allDay,
    origHour: ev.start.getHours(),
    origMinute: ev.start.getMinutes(),
    recurrenceInstance: !!ev._recurrenceInstance,
    linkedAutoGenerated: !!ev.linkedAutoGenerated,
    linkedEntryId: ev.linkedEntryId || '',
    linkedEntryPath: ev.linkedEntryPath || '',
    linkedEntrySourceProperty: ev.linkedEntrySourceProperty || '',
    recurrence: ev.recurrence || '',
  };
}

async function _calendarNotifyEventSaved(prev, next) {
  try {
    if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onEventSaved === 'function') {
      await window.GbDbCalendarSync.onEventSaved({ prev: prev || {}, next: next || {} });
    }
  } catch {}
}

/* ==============================
   月表示
   ============================== */
function _renderMonth(container, dbPath, events) {
  const canEditDates = !!_calRenderState.info?.canEditDates;
  const canCreateEvents = !!_calRenderState.info?.canCreateEvents;
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;gap:12px;';
  const main = document.createElement('div'); main.style.flex='1';
  const curDate = getCalendarDate(dbPath);
  const year=curDate.getFullYear(), month=curDate.getMonth();
  const startDate = new Date(year,month,1);
  startDate.setDate(startDate.getDate()-((startDate.getDay()-_calStartDay+7)%7));
  const grid = document.createElement('div'); grid.className = 'cal-month-grid';
  _getDayNames().forEach(d => { const h=document.createElement('div'); h.className='cal-month-header'; h.textContent=d; grid.appendChild(h); });
  const today=new Date(); today.setHours(0,0,0,0);
  const d=new Date(startDate);
  let dragState = null;
  const clearRangePreview = () => grid.querySelectorAll('.cal-month-cell.cal-drag-range').forEach(el => el.classList.remove('cal-drag-range'));
  const applyRangePreview = (startToken, endToken) => {
    clearRangePreview();
    const [startDateObj, endDateObj] = _sortCalendarRange(_parseCalendarDateValue(startToken), _parseCalendarDateValue(endToken));
    grid.querySelectorAll('.cal-month-cell[data-date]').forEach(cell => {
      const token = cell.dataset.date;
      if (!token) return;
      const date = _parseCalendarDateValue(token);
      if (date >= startDateObj && date <= endDateObj) cell.classList.add('cal-drag-range');
    });
  };
  for(let i=0;i<42;i++){
    const cell=document.createElement('div'); cell.className='cal-month-cell';
    cell.dataset.date = _dateStr(d);
    if(d.getMonth()!==month) cell.classList.add('cal-other-month');
    if(d.getTime()===today.getTime()) cell.classList.add('cal-today');
    const num=document.createElement('div'); num.className='cal-day-num'; num.textContent=d.getDate();
    cell.appendChild(num);
    const cellDate=new Date(d);
    const dayEvs=events.filter(ev=>_calendarEventOccursOnDay(ev,cellDate));
    dayEvs.slice(0,3).forEach(ev=>{
      const el=document.createElement('div'); el.className='cal-month-event'; el.style.background=ev.color;
      el.innerHTML=`<span class="cal-event-title">${_isTask(ev)?lucide('square',10)+' ':''}${esc(ev.name)}</span>${_calendarEventAvatarsHtml(ev, 14)}`; el.title=ev.name;
      const eventCanEditDates=canEditDates&&!ev._recurrenceInstance;
      el.draggable=eventCanEditDates;
      if (eventCanEditDates) {
        el.addEventListener('dragstart',e2=>{e2.dataTransfer.setData('text/plain',JSON.stringify(_calendarDragPayloadForEvent(ev)));el.style.opacity='0.4';});
