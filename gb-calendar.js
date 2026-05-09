/* gb-calendar.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-calendar.part01.js */
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
let _calRenderState = { dbPath: '', allEvents: [], visibleEvents: [], info: { kind: 'none', isMappedDb: false, canEditDates: false, canCreateEvents: false, canDeleteEvents: false, canSyncExternal: false, mapping: null } };

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
function _getCalendarViewMode(dbPath) {
  const mode = getCurrentViewMode(dbPath);
  if (mode === 'calendar' || mode === 'tasks' || mode === 'shifts' || mode === 'timeline') return mode;
  return 'calendar';
}
function _getActiveCalendarViewMode(dbPath, pivotData) {
  const info = typeof _getCalendarIntegrationInfo === 'function'
    ? _getCalendarIntegrationInfo(dbPath, pivotData || state.pivotData)
    : { kind: (pivotData || state.pivotData)?.calendar_db ? 'calendar-db' : 'none' };
  const rawMode = _getCalendarViewMode(dbPath);
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
    const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
    await selectDatabase(dbPath, ctx);
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
  const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
  return { ctx, data: ctx?.pivotData || state.pivotData, dbPath: ctx?.dbPath || _calRenderState.dbPath || state.currentDbPath || '' };
}
function _calendarSnapshotValue(props, propName, fallback) {
  const values = props?.[propName];
  if (!Array.isArray(values) || values.length === 0) return fallback;
  return values[0]?.value ?? fallback;
}
function _calendarSnapshotEventPayload(name, props) {
  const start = _calendarSnapshotValue(props, 'start', '');
  if (!start) return null;
  const alertMinutes = parseInt(_calendarSnapshotValue(props, 'alert_minutes', '-1'), 10);
  const allDayRaw = _calendarSnapshotValue(props, 'all_day', false);
  const linkedAutoGeneratedRaw = _calendarSnapshotValue(props, 'linkedAutoGenerated', false);
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
    && a.linkedEntryId === b.linkedEntryId
    && a.linkedEntryPath === b.linkedEntryPath
    && a.linkedEntrySourceProperty === b.linkedEntrySourceProperty
    && a.linkedAutoGenerated === b.linkedAutoGenerated;
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
      linkedEntryId: nextEvent.linkedEntryId,
      linkedEntryPath: nextEvent.linkedEntryPath,
      linkedEntrySourceProperty: nextEvent.linkedEntrySourceProperty,
      linkedAutoGenerated: nextEvent.linkedAutoGenerated,
    };
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
function renderCalendarSettingsBar(container, dbPath, viewMode) {
  const info = typeof _getCalendarIntegrationInfo === 'function'
    ? _getCalendarIntegrationInfo(dbPath, state.pivotData)
    : { kind: 'calendar-db', isMappedDb: false, canEditDates: true, canCreateEvents: true, canDeleteEvents: true, canSyncExternal: true };
  const timeMode = typeof _normalizeCalendarModeForDb === 'function'
    ? _normalizeCalendarModeForDb(dbPath, getCalendarMode(dbPath), state.pivotData)
    : getCalendarMode(dbPath);
  const curDate = getCalendarDate(dbPath);
  const activeViewMode = viewMode || _getActiveCalendarViewMode(dbPath, state.pivotData);
  const bar = document.createElement('div');
  bar.className = 'tl-settings';
  const sel = _calendarTimeModes().map(m=>`<option value="${m.v}" ${timeMode===m.v?'selected':''}>${m.l}</option>`).join('');
  const title = activeViewMode === 'calendar' ? _calTitle(curDate, timeMode) : _calTitle(curDate, activeViewMode === 'day' ? 'day' : 'month');
  const viewBadge = activeViewMode === 'tasks'
    ? '<span style="font-size:11px;color:var(--fg2);padding:0 6px;">タスクビュー</span>'
    : activeViewMode === 'shifts'
      ? '<span style="font-size:11px;color:var(--fg2);padding:0 6px;">シフトビュー</span>'
      : '';
  bar.innerHTML = `
    ${activeViewMode === 'calendar'
      ? `<label>表示: <select id="cal-mode" class="gb-select gb-select-sm">${sel}</select></label>`
      : viewBadge}
    <button id="cal-prev" class="tl-nav-btn">${lucide('chevronLeft', 14)}</button>
    <span id="cal-title" style="font-weight:600;min-width:120px;text-align:center;">${esc(title)}</span>
    <button id="cal-next" class="tl-nav-btn">${lucide('chevronRight', 14)}</button>
    <button id="cal-today" class="tl-nav-btn">今日</button>
    ${info.isMappedDb ? '<span style="font-size:11px;color:var(--fg2);padding:0 8px;">日時のみ編集可</span>' : ''}
    ${info.canCreateEvents ? '<button id="cal-add-ev" class="tl-nav-btn" title="イベント追加">+ イベント</button>' : ''}
    ${info.canCreateEvents && activeViewMode==='tasks'?'<button id="cal-add-task" class="tl-nav-btn" title="タスク追加">+ タスク</button>':''}
    <button id="cal-timer" class="tl-nav-btn" title="タイマー">タイマー</button>
    ${info.canSyncExternal ? '<button id="cal-sync" class="tl-nav-btn" title="同期">同期</button>' : ''}
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
  bar.querySelector('#cal-mode')?.addEventListener('change', function() { setCalendarMode(dbPath, this.value); renderCalendar(); });
  bar.querySelector('#cal-prev').addEventListener('click', () => { _calNav(dbPath, activeViewMode === 'calendar' ? timeMode : activeViewMode, -1); renderCalendar(); });
  bar.querySelector('#cal-next').addEventListener('click', () => { _calNav(dbPath, activeViewMode === 'calendar' ? timeMode : activeViewMode, 1); renderCalendar(); });
  bar.querySelector('#cal-today').addEventListener('click', () => { setCalendarDate(dbPath,new Date()); renderCalendar(); });
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
    renderCalendar();
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
  if(mode==='month'||mode==='tasks'||mode==='shifts') d.setMonth(d.getMonth()+dir);
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
    ? _getCalendarIntegrationInfo(dbPath, data)
    : { kind: data.calendar_db ? 'calendar-db' : 'none', isMappedDb: false, canEditDates: !!data.calendar_db, canCreateEvents: !!data.calendar_db, canDeleteEvents: !!data.calendar_db, canSyncExternal: !!data.calendar_db, mapping: null };
  if (info.kind === 'none') { container.innerHTML = ''; return; }
  const activeViewMode = _getActiveCalendarViewMode(dbPath, data);
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
  }
  container.innerHTML = '';
  renderCalendarSettingsBar(container, dbPath, activeViewMode);
  const allEvents = typeof _collectCalendarEventsForDb === 'function'
    ? _collectCalendarEventsForDb(dbPath, data)
    : _collectCalendarEvents(data);
  const allCalIds = [...new Set(allEvents.map(e => e.calendarId || 'default'))];
  if (!_calVisibleIds) _calVisibleIds = new Set(allCalIds);
  else allCalIds.forEach(cid => _calVisibleIds.add(cid));
  const events = allEvents.filter(ev => !_calVisibleIds || _calVisibleIds.has(ev.calendarId || 'default'));
  _calRenderState = { dbPath, allEvents, visibleEvents: events, info };
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
function _expandRecurrence(ev){
  // 繰り返し展開。ev.recurrence は JSON文字列 ({type,interval,endDate,daysOfWeek?})
  if(!ev.recurrence) return [ev];
  let rec; try{rec=typeof ev.recurrence==='string'?JSON.parse(ev.recurrence):ev.recurrence;}catch{return [ev];}
  if(!rec||!rec.type) return [ev];
  const interval=Math.max(1,parseInt(rec.interval)||1);
  const endLimit=rec.endDate?new Date(rec.endDate+'T23:59:59'):new Date(ev.start.getTime()+365*86400000);
  const out=[ev];
  const dur=ev.end-ev.start;
  const MAX=500; // 上限件数（安全装置）
  // weekly+daysOfWeek: 開始週を含めて各週の指定曜日を列挙
  if(rec.type==='weekly' && Array.isArray(rec.daysOfWeek) && rec.daysOfWeek.length){
    let weekStart=new Date(ev.start);weekStart.setDate(weekStart.getDate()-weekStart.getDay());weekStart.setHours(0,0,0,0);
    for(let i=0;i<MAX;i++){
      for(const dow of rec.daysOfWeek){
        const dd=new Date(weekStart);dd.setDate(dd.getDate()+parseInt(dow));
        dd.setHours(ev.start.getHours(),ev.start.getMinutes(),ev.start.getSeconds(),0);
        if(dd<=ev.start||dd>endLimit) continue;
        out.push({...ev,start:new Date(dd),end:new Date(dd.getTime()+dur),_recurrenceInstance:true,_origStart:ev.start,_origEnd:ev.end});
        if(out.length>=MAX) return out;
      }
      weekStart.setDate(weekStart.getDate()+7*interval);
      if(weekStart>endLimit) break;
    }
    return out;
  }
  // daily/weekly(無曜日)/monthly/yearly: 単純な繰り返し
  let cur=new Date(ev.start);
  for(let i=0;i<MAX;i++){
    const next=new Date(cur);
    if(rec.type==='daily') next.setDate(next.getDate()+interval);
    else if(rec.type==='weekly') next.setDate(next.getDate()+7*interval);
    else if(rec.type==='monthly') next.setTime(_addCalendarMonthsClamped(cur, interval).getTime());
    else if(rec.type==='yearly') next.setTime(_addCalendarYearsClamped(cur, interval).getTime());
    else break;
    if(next>endLimit) break;
    out.push({...ev,start:new Date(next),end:new Date(new Date(next).getTime()+dur),_recurrenceInstance:true,_origStart:ev.start,_origEnd:ev.end});
    cur=next;
  }
  return out;
}

function _collectCalendarEvents(data) {
  const events = [];
  for (const [name, props] of Object.entries(data.entities)) {
    const sv=props['start']; if(!sv||!sv.length) continue;
    const calV=props['calendar_id'];
    const ev=props['end'], cv=props['color'], adv=props['all_day'];
    const locV=props['location'], descV=props['description'];
    const urlV=props['url'], alertV=props['alert_minutes'], recV=props['recurrence'];
    const creatorV=props['creator'], membersV=props['members'];
    const baseEv={
      name, file: sv[0].file||'',
      start: new Date(sv[0].value),
      end: ev&&ev.length ? new Date(ev[0].value) : new Date(sv[0].value),
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
    };
    for(const expanded of _expandRecurrence(baseEv)) events.push(expanded);
  }
  return events;
}

function _isTask(ev) { return (ev.description || '').includes('status:'); }
function _taskStatus(ev) { return (ev.description || '').match(/status:(\w+)/)?.[1] || ''; }
function _taskPriority(ev) { return (ev.description || '').match(/priority:(\w+)/)?.[1] || 'medium'; }

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
    const [startDateObj, endDateObj] = _sortCalendarRange(new Date(startToken), new Date(endToken));
    grid.querySelectorAll('.cal-month-cell[data-date]').forEach(cell => {
      const token = cell.dataset.date;
      if (!token) return;
      const date = new Date(token);
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
    const dayEvs=events.filter(ev=>{const s=new Date(ev.start);s.setHours(0,0,0,0);const e=new Date(ev.end);e.setHours(0,0,0,0);return cellDate>=s&&cellDate<=e;});
    dayEvs.slice(0,3).forEach(ev=>{
      const el=document.createElement('div'); el.className='cal-month-event'; el.style.background=ev.color;
      el.innerHTML=`<span class="cal-event-title">${_isTask(ev)?lucide('square',10)+' ':''}${esc(ev.name)}</span>${_calendarEventAvatarsHtml(ev, 14)}`; el.title=ev.name; el.draggable=canEditDates;
      if (canEditDates) {
        el.addEventListener('dragstart',e2=>{e2.dataTransfer.setData('text/plain',JSON.stringify({name:ev.name,file:ev.file,duration:ev.end-ev.start,entityName:ev.entityName||'',entityPath:ev.entityPath||'',mapped:!!ev._mapped,allDay:!!ev.allDay,origHour:ev.start.getHours(),origMinute:ev.start.getMinutes()}));el.style.opacity='0.4';});
        el.addEventListener('dragend',()=>{el.style.opacity='';});
      }
      el.addEventListener('click', e2=>{e2.stopPropagation();if(ev._mapped&&typeof _openMappedCalendarEventPanel==='function'){_openMappedCalendarEventPanel(dbPath,ev);return;}_showCalendarEventDetailPanel(dbPath,ev);});
      cell.appendChild(el);
    });
    if(dayEvs.length>3){const more=document.createElement('div');more.className='cal-month-more';more.textContent=`+${dayEvs.length-3}`;cell.appendChild(more);}
    if (canEditDates) {
      cell.addEventListener('dragover',e2=>{e2.preventDefault();cell.style.background='rgba(86,156,214,0.15)';});
      cell.addEventListener('dragleave',()=>{cell.style.background='';});
      // 月ビューの drop: ターゲットセルは 00:00。_handleEventDrop 側で元の時刻を復元する
      cell.addEventListener('drop',e2=>{e2.preventDefault();cell.style.background='';_handleEventDrop(dbPath,e2,cellDate,{preserveTime:true});});
    }
    if (canCreateEvents) {
      _bindCalendarCellAddButton(cell, () => _quickCreateCalendarEvent(dbPath, { start: new Date(cellDate), end: new Date(cellDate), allDay: true }));
      cell.addEventListener('pointerdown', (e2) => {
        if (e2.button !== 0) return;
        if (e2.target.closest('.cal-month-event, .cal-month-more, .cal-cell-quick-add')) return;
        dragState = { startToken: cell.dataset.date, endToken: cell.dataset.date, moved: false };
        applyRangePreview(dragState.startToken, dragState.endToken);
      });
      cell.addEventListener('pointerenter', () => {
        if (!dragState) return;
        if (dragState.endToken !== cell.dataset.date) dragState.moved = true;
        dragState.endToken = cell.dataset.date;
        applyRangePreview(dragState.startToken, dragState.endToken);
      });
      cell.addEventListener('pointerup', async () => {
        if (!dragState) return;
        const current = dragState;
        dragState = null;
        clearRangePreview();
        if (!current.moved) return;
        const [startRange, endRange] = _sortCalendarRange(new Date(current.startToken), new Date(current.endToken));
        await _quickCreateCalendarEvent(dbPath, { start: startRange, end: endRange, allDay: true });
      });
    }
    grid.appendChild(cell); d.setDate(d.getDate()+1);
  }
  if (window._calMonthPointerUp) document.removeEventListener('pointerup', window._calMonthPointerUp);
  window._calMonthPointerUp = () => {
    if (!dragState) return;
    dragState = null;
    clearRangePreview();
  };
  document.addEventListener('pointerup', window._calMonthPointerUp);
  main.appendChild(grid); wrapper.appendChild(main);
  const sidebar=document.createElement('div'); sidebar.style.cssText='width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:8px;';
  _renderCalendarList(sidebar,dbPath,_calRenderState.allEvents || events);
  if (sidebar.childElementCount > 0) wrapper.appendChild(sidebar);
  container.appendChild(wrapper);
}

/* ==============================
   週表示（ピクセル精度位置 + リサイズ + ドラッグ作成）
   ============================== */
const _HOUR_PX = 40;

function _renderWeek(container, dbPath, events) {
  const canEditDates = !!_calRenderState.info?.canEditDates;
  const canCreateEvents = !!_calRenderState.info?.canCreateEvents;
  const curDate=getCalendarDate(dbPath), ws=_weekStart(curDate);
  const dayNames=_getDayNames();
  const grid=document.createElement('div'); grid.className='cal-week-grid';
  grid.style.gridTemplateColumns=`50px repeat(7, 1fr)`;
  // ヘッダー
  const corner=document.createElement('div'); corner.className='cal-week-corner'; grid.appendChild(corner);
  const dayDates=[];
  for(let di=0;di<7;di++){const dd=new Date(ws);dd.setDate(dd.getDate()+di);dayDates.push(dd);const h=document.createElement('div');h.className='cal-week-header';h.textContent=`${dayNames[di]} ${dd.getDate()}`;grid.appendChild(h);}

  // 時間行 + イベントカラム
  let dragState=null;
  for(let hour=0;hour<24;hour++){
    const tl=document.createElement('div');tl.className='cal-week-time';tl.textContent=`${hour}:00`;tl.style.height=_HOUR_PX+'px';grid.appendChild(tl);
    for(let di=0;di<7;di++){
      const cell=document.createElement('div');cell.className='cal-week-cell';cell.style.height=_HOUR_PX+'px';cell.style.position='relative';
      const cd=new Date(dayDates[di]);cd.setHours(hour,0,0,0);
      cell.dataset.date=_dateStr(cd);cell.dataset.hour=hour;
      // イベントカード（ピクセル精度位置。日またぎイベントは各日の先頭セルに描画）
      const cellDay=cd.toDateString();
      const cellDayDate0=new Date(cd);cellDayDate0.setHours(0,0,0,0);
      events.filter(ev=>{
        const sd=new Date(ev.start);sd.setHours(0,0,0,0);
        const ed=new Date(ev.end);ed.setHours(0,0,0,0);
        if(cellDayDate0<sd||cellDayDate0>ed) return false;
        if(ev.allDay) return hour===0;
        const segStartH=(cellDay===ev.start.toDateString())?ev.start.getHours():0;
        return segStartH===hour;
      }).forEach(ev=>{
        const evSDay=ev.start.toDateString(), evEDay=ev.end.toDateString();
        const startH=ev.allDay?0:((cellDay===evSDay)?(ev.start.getHours()+ev.start.getMinutes()/60):0);
        const endH=ev.allDay?1:((cellDay===evEDay)?(ev.end.getHours()+ev.end.getMinutes()/60):24);
        const card=_createWeekEventCard(dbPath,ev,startH,endH,cellDayDate0);
        cell.appendChild(card);
      });
      // ドラッグ作成
      if (canCreateEvents) {
        _bindCalendarCellAddButton(cell, () => {
          const s = new Date(cd);
          const e = new Date(cd);
          e.setHours(e.getHours() + 1);
          return _quickCreateCalendarEvent(dbPath, { start: s, end: e, allDay: false });
        });
        cell.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('.cal-day-event, .cal-cell-quick-add'))return;e.preventDefault();dragState={startDate:cell.dataset.date,startHour:hour,pv:null,moved:false};document.body.style.userSelect='none';const pv=document.createElement('div');pv.className='cal-day-event cal-drag-preview';pv.style.cssText=`position:absolute;left:0;right:0;top:0;height:${_HOUR_PX}px;background:var(--accent);opacity:0.6;pointer-events:none;z-index:5;`;pv.textContent=`${hour}:00–${hour+1}:00`;cell.appendChild(pv);dragState.pv=pv;});
        cell.addEventListener('pointermove',()=>{if(!dragState||cell.dataset.date!==dragState.startDate)return;const minH=Math.min(dragState.startHour,hour),maxH=Math.max(dragState.startHour,hour)+1;if(hour!==dragState.startHour)dragState.moved=true;if(dragState.pv)dragState.pv.remove();const anchor=grid.querySelector(`.cal-week-cell[data-date="${dragState.startDate}"][data-hour="${minH}"]`);if(anchor){const pv=document.createElement('div');pv.className='cal-day-event cal-drag-preview';pv.style.cssText=`position:absolute;left:0;right:0;top:0;height:${(maxH-minH)*_HOUR_PX}px;background:var(--accent);opacity:0.6;pointer-events:none;z-index:5;`;pv.textContent=`${minH}:00–${maxH}:00`;anchor.appendChild(pv);dragState.pv=pv;}});
        cell.addEventListener('pointerup',async()=>{if(!dragState)return;const current=dragState;if(current.pv)current.pv.remove();dragState=null;document.body.style.userSelect='';if(!current.moved)return;const endH=hour+1;const minH=Math.min(current.startHour,endH-1),maxH=Math.max(current.startHour+1,endH);const ds=current.startDate;const s=new Date(ds+'T'+_p2(minH)+':00'),e=new Date(ds+'T'+_p2(maxH)+':00');await _quickCreateCalendarEvent(dbPath,{start:s,end:e,allDay:false});});
      }
      if (canEditDates) {
        cell.addEventListener('dragover',e2=>{e2.preventDefault();cell.style.background='rgba(86,156,214,0.15)';});
        cell.addEventListener('dragleave',()=>{cell.style.background='';});
        cell.addEventListener('drop',e2=>{e2.preventDefault();cell.style.background='';_handleEventDrop(dbPath,e2,cd);});
      }
      grid.appendChild(cell);
    }
  }
  // dragState cleanup（前回リスナーを除去してからリスナー登録）
  if (window._calWeekMouseupHandler) document.removeEventListener('pointerup', window._calWeekMouseupHandler);
  window._calWeekMouseupHandler = () => { if(dragState){if(dragState.pv)dragState.pv.remove();dragState=null;document.body.style.userSelect='';} };
  document.addEventListener('pointerup', window._calWeekMouseupHandler);
  container.appendChild(grid);
}

function _createWeekEventCard(dbPath, ev, startH, endH, segmentDate) {
  const canEditDates = !!_calRenderState.info?.canEditDates;
  const segmentStartDate = new Date(segmentDate || ev.start);
  segmentStartDate.setHours(0,0,0,0);
  const el=document.createElement('div');el.className='cal-day-event';
  el.style.cssText=`position:absolute;left:1px;right:1px;top:${(startH%1)*_HOUR_PX}px;height:${Math.max(10,(endH-startH)*_HOUR_PX)}px;background:${ev.color};z-index:3;overflow:hidden;`;
  el.innerHTML=`<span class="cal-event-title">${esc(ev.name)}</span>${_calendarEventAvatarsHtml(ev, 14)}`;el.title=`${ev.name}\n${(ev.start.toISOString()||'').substring(11,16)}–${(ev.end.toISOString()||'').substring(11,16)}`;
  el.draggable=canEditDates;
  if (canEditDates) {
    el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',JSON.stringify({name:ev.name,file:ev.file,duration:ev.end-ev.start,entityName:ev.entityName||'',entityPath:ev.entityPath||'',mapped:!!ev._mapped,allDay:!!ev.allDay,origHour:ev.start.getHours(),origMinute:ev.start.getMinutes()}));el.style.opacity='0.4';});
    el.addEventListener('dragend',()=>{el.style.opacity='';});
  }
  el.addEventListener('click', e=>{e.stopPropagation();if(ev._mapped&&typeof _openMappedCalendarEventPanel==='function'){_openMappedCalendarEventPanel(dbPath,ev);return;}_showCalendarEventDetailPanel(dbPath,ev);});
  if (!canEditDates || (ev._mapped && !ev._mappedSupportsEnd)) return el;
  const commitResize = async (newStart, newEnd) => {
    if (ev._mapped && typeof _saveMappedCalendarDates === 'function') {
      try {
        await _saveMappedCalendarDates(dbPath, ev, newStart, newEnd, { preserveMissingEndIfZeroDuration: true });
        showStatus('日時を更新しました');
      } catch (err) {
        showStatus('リサイズに失敗', true);
      }
      return;
    }
    _calPushUndo('リサイズ');
    await apiPut('/calendar-db/events/'+encodeURIComponent(ev.name),{
      db_path:dbPath,
      start:newStart.toISOString(),
      end:newEnd.toISOString()
    });
    await selectDatabase(dbPath);
  };
  // リサイズハンドル（下）
  const resBot=document.createElement('div');resBot.style.cssText='position:absolute;bottom:0;left:0;right:0;height:6px;cursor:ns-resize;';
  resBot.onpointerdown=e2=>{e2.stopPropagation();e2.preventDefault();el.style.touchAction='none';const sy=e2.clientY,sh=el.offsetHeight;document.body.style.userSelect='none';
    const onMove=e3=>{el.style.height=Math.max(10,sh+e3.clientY-sy)+'px';};
    const onUp=async()=>{document.removeEventListener('pointermove',onMove);document.removeEventListener('pointerup',onUp);document.body.style.userSelect='';el.style.touchAction='';
      let newEndH=_snapQuarterHour(startH+el.offsetHeight/_HOUR_PX);if(newEndH<0)newEndH=0;if(newEndH>24)newEndH=24;
      // newEnd は元の ev.end の日付部分を起点にして時刻だけ差し替える（multi-day イベントの日境界を保つ）
      const endDayBase=new Date(ev.end);endDayBase.setHours(0,0,0,0);
      const newEnd=_hourToDate(endDayBase, newEndH);
      try {
        await commitResize(new Date(ev.start), newEnd);
      } catch (err) {
        showStatus('リサイズに失敗', true);
      }
    };document.addEventListener('pointermove',onMove);document.addEventListener('pointerup',onUp);};
  el.appendChild(resBot);
  // リサイズハンドル（上）
  const resTop=document.createElement('div');resTop.style.cssText='position:absolute;top:0;left:0;right:0;height:6px;cursor:ns-resize;';
  resTop.onpointerdown=e2=>{e2.stopPropagation();e2.preventDefault();el.style.touchAction='none';const sy=e2.clientY,origTop=parseFloat(el.style.top),origH=el.offsetHeight;document.body.style.userSelect='none';
    const onMove=e3=>{const dy=Math.min(e3.clientY-sy, origH-10);el.style.top=(origTop+dy)+'px';el.style.height=Math.max(10,origH-dy)+'px';};
    const onUp=async()=>{document.removeEventListener('pointermove',onMove);document.removeEventListener('pointerup',onUp);document.body.style.userSelect='';el.style.touchAction='';
      const topDelta=(parseFloat(el.style.top)-origTop)/_HOUR_PX;
      let newStartH=_snapQuarterHour(startH+topDelta);if(newStartH<0)newStartH=0;if(newStartH>24)newStartH=24;
      // newStart は元の ev.start の日付部分を起点にして時刻だけ差し替える
      const startDayBase=new Date(ev.start);startDayBase.setHours(0,0,0,0);
      const newStart=_hourToDate(startDayBase, newStartH);
      try {
        await commitResize(newStart, new Date(ev.end));
      } catch (err) {
        showStatus('リサイズに失敗', true);
      }
    };document.addEventListener('pointermove',onMove);document.addEventListener('pointerup',onUp);};
  el.appendChild(resTop);
  return el;
}

/* ==============================
   日表示
   ============================== */
function _renderDay(container, dbPath, events) {
  const canEditDates = !!_calRenderState.info?.canEditDates;
  const canCreateEvents = !!_calRenderState.info?.canCreateEvents;
  const curDate=getCalendarDate(dbPath);
  const grid=document.createElement('div');grid.className='cal-day-grid';
  let dragState = null;
  for(let hour=0;hour<24;hour++){
    const tl=document.createElement('div');tl.className='cal-day-time';tl.style.height=_HOUR_PX+'px';tl.textContent=`${hour}:00`;grid.appendChild(tl);
    const cell=document.createElement('div');cell.className='cal-day-cell';cell.style.cssText=`height:${_HOUR_PX}px;position:relative;`;
    cell.dataset.hour = hour;
    const cellDay=curDate.toDateString();
    events.filter(ev=>{
      const evS=new Date(ev.start);evS.setHours(0,0,0,0);const evE=new Date(ev.end);evE.setHours(0,0,0,0);
      const cdd=new Date(curDate);cdd.setHours(0,0,0,0);
      if(cdd<evS||cdd>evE)return false;if(ev.allDay)return hour===0;
      if(ev.start.toDateString()===cellDay) return ev.start.getHours()===hour;
      return false;
    }).forEach(ev=>{
      const startH=ev.start.getHours()+ev.start.getMinutes()/60;
      const endH=ev.end.toDateString()===cellDay?(ev.end.getHours()+ev.end.getMinutes()/60):24;
      const dayStart = new Date(curDate);
      dayStart.setHours(0,0,0,0);
      const card=_createWeekEventCard(dbPath,ev,startH,endH,dayStart);
      cell.appendChild(card);
    });
    if (canCreateEvents) {
      _bindCalendarCellAddButton(cell, () => {
        const s = new Date(curDate);
        s.setHours(hour, 0, 0, 0);
        const e = new Date(s);
        e.setHours(hour + 1);
        return _quickCreateCalendarEvent(dbPath, { start: s, end: e, allDay: false });
      });
      cell.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.cal-day-event, .cal-cell-quick-add')) return;
        e.preventDefault();
        dragState = { startHour: hour, pv: null, moved: false };
        document.body.style.userSelect = 'none';
        const pv = document.createElement('div');
        pv.className = 'cal-day-event cal-drag-preview';
        pv.style.cssText = `position:absolute;left:0;right:0;top:0;height:${_HOUR_PX}px;background:var(--accent);opacity:0.6;pointer-events:none;z-index:5;`;
        pv.textContent = `${hour}:00–${hour+1}:00`;
        cell.appendChild(pv);
        dragState.pv = pv;
      });
      cell.addEventListener('pointermove', () => {
        if (!dragState) return;
        const minH = Math.min(dragState.startHour, hour);
        const maxH = Math.max(dragState.startHour, hour) + 1;
        if (hour !== dragState.startHour) dragState.moved = true;
        if (dragState.pv) dragState.pv.remove();
        const anchor = grid.querySelector(`.cal-day-cell[data-hour="${minH}"]`);
        if (!anchor) return;
        const pv = document.createElement('div');
        pv.className = 'cal-day-event cal-drag-preview';
        pv.style.cssText = `position:absolute;left:0;right:0;top:0;height:${(maxH-minH)*_HOUR_PX}px;background:var(--accent);opacity:0.6;pointer-events:none;z-index:5;`;
        pv.textContent = `${minH}:00–${maxH}:00`;
        anchor.appendChild(pv);
        dragState.pv = pv;
      });
      cell.addEventListener('pointerup', async () => {
        if (!dragState) return;
        const current = dragState;
        if (current.pv) current.pv.remove();
        dragState = null;
        document.body.style.userSelect = '';
        if (!current.moved) return;
        const endH = hour + 1;
        const minH = Math.min(current.startHour, endH - 1);
        const maxH = Math.max(current.startHour + 1, endH);
        const s = new Date(curDate);
        s.setHours(minH, 0, 0, 0);
        const e = new Date(curDate);
        e.setHours(maxH, 0, 0, 0);
        await _quickCreateCalendarEvent(dbPath, { start: s, end: e, allDay: false });
      });
    }
    if (canEditDates) {
      cell.addEventListener('dragover',e=>{e.preventDefault();cell.style.background='rgba(86,156,214,0.15)';});
      cell.addEventListener('dragleave',()=>{cell.style.background='';});
      cell.addEventListener('drop',e=>{e.preventDefault();cell.style.background='';const cd=new Date(curDate);cd.setHours(hour);_handleEventDrop(dbPath,e,cd);});
    }
    grid.appendChild(cell);
  }
  if (window._calDayPointerUp) document.removeEventListener('pointerup', window._calDayPointerUp);
  window._calDayPointerUp = () => {
    if (!dragState) return;
    if (dragState.pv) dragState.pv.remove();
    dragState = null;
    document.body.style.userSelect = '';
  };
  document.addEventListener('pointerup', window._calDayPointerUp);
  container.appendChild(grid);
}

/* ==============================
   D&D移動
   ============================== */
async function _handleEventDrop(dbPath,e,targetDate,opts) {
  let data; try{data=JSON.parse(e.dataTransfer.getData('text/plain'));}catch{return;}
  if(!data||!data.name) return;
  const duration=Number.isFinite(data.duration)?data.duration:3600000;
  const newStart=new Date(targetDate);
  // 月ビュー等では targetDate が 00:00 になるので、allDay でなければ元イベントの時/分を復元する
  if (opts && opts.preserveTime && !data.allDay && Number.isFinite(data.origHour)) {
    newStart.setHours(data.origHour, Number.isFinite(data.origMinute) ? data.origMinute : 0, 0, 0);
  }
  const newEnd=new Date(newStart.getTime()+duration);
  if (data.mapped && typeof _saveMappedCalendarDates === 'function') {

/* Source chunk: gb-calendar.part02.js */
    try {
      await _saveMappedCalendarDates(dbPath, { _mapped: true, entityName: data.entityName, entityPath: data.entityPath, name: data.name }, newStart, newEnd, { preserveMissingEndIfZeroDuration: true });
      showStatus('日時を更新しました');
    } catch(err){ showStatus('移動に失敗',true); }
    return;
  }
  _calPushUndo('イベント移動');
  try{
    await apiPut('/calendar-db/events/'+encodeURIComponent(data.name),{
      db_path:dbPath,
      start:_toCalendarApiValue(newStart, false),
      end:_toCalendarApiValue(newEnd, false),
    });
    await selectDatabase(dbPath);
  }catch(err){showStatus('移動に失敗',true);}
}

async function _calendarLoadUserChoices() {
  const users = new Map();
  const add = name => { name = String(name || '').trim(); if (name && !users.has(name)) users.set(name, { name }); };
  add(_getUser());
  let roots = [];
  try { roots = await apiFetch('/outliner-roots'); } catch {}
  const visibleRoots = (roots || []).filter(root => root?.visible && root?.path);
  const sources = visibleRoots.length ? visibleRoots.map(root => root.path) : [''];
  for (const folder of sources) {
    try {
      const members = await apiFetch('/team' + (folder ? '?folder=' + encodeURIComponent(folder) : ''));
      (members || []).forEach(member => add(member.name));
    } catch {}
  }
  return [...users.values()];
}
function _calendarUserFields(prefix, ev) {
  const creator = _calendarEventCreator(ev);
  return `
    <div class="field"><label>作成者</label><select id="${prefix}-creator" class="gb-select"><option value="${esc(creator)}">${esc(creator || 'anonymous')}</option></select></div>
    <div class="field"><label>メンバー</label><div id="${prefix}-members" class="cal-option-members"><span style="color:var(--fg2);font-size:12px;">読み込み中...</span></div></div>`;
}
async function _populateCalendarEventUserControls(root, prefix, ev) {
  const creatorSelect = root.querySelector('#' + prefix + '-creator');
  const membersBox = root.querySelector('#' + prefix + '-members');
  if (!creatorSelect && !membersBox) return;
  const creator = _calendarEventCreator(ev);
  const selectedMembers = new Set(_calendarEventMembers(ev));
  const users = await _calendarLoadUserChoices();
  [creator, ...selectedMembers].forEach(name => {
    if (name && !users.some(user => user.name === name)) users.push({ name });
  });
  if (!root.isConnected) return;
  if (creatorSelect) creatorSelect.innerHTML = users.map(user => `<option value="${esc(user.name)}" ${user.name === creator ? 'selected' : ''}>${esc(user.name)}</option>`).join('');
  if (membersBox) membersBox.innerHTML = users.map(user => `<label class="cal-option-member"><input type="checkbox" class="${prefix}-member" value="${esc(user.name)}" data-e2e-id="${prefix}-member-${esc(user.name)}" aria-label="${esc(user.name)}" ${selectedMembers.has(user.name) ? 'checked' : ''}> <span>${esc(user.name)}</span></label>`).join('');
}
function _collectCalendarEventMembers(root, prefix, creator) {
  const seen = new Set();
  const inputs = [...root.querySelectorAll('.' + prefix + '-member')];
  const source = inputs.length ? inputs.filter(input => input.checked).map(input => input.value) : _calendarUserList(root.dataset.calEventMembers || '[]');
  return source.map(input => String(input || '').trim()).filter(name => {
    if (!name || name === creator || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function _showCalendarEventDetailPanel(dbPath, ev) {
  if (!ev) return;
  if (ev._mapped && typeof _openMappedCalendarEventPanel === 'function') {
    _openMappedCalendarEventPanel(dbPath, ev);
    return;
  }
  if (typeof toggleOptionPanel === 'function') toggleOptionPanel();
  else if (typeof toggleDetailPanel === 'function') toggleDetailPanel();
  const detailRoot = typeof _resolveDetailEl === 'function' ? _resolveDetailEl() : document.getElementById('rp-detail');
  if (!detailRoot) {
    _openEventEditPanel(dbPath, ev);
    return;
  }
  if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailRoot);
  if (typeof showBoardTabs === 'function') showBoardTabs(false);
  if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
  if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
  if (typeof showNoteTabs === 'function') showNoteTabs(false);
  if (typeof showDbTabs === 'function') showDbTabs(false);
  if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(true);
  if (typeof showFileStyleTab === 'function') showFileStyleTab(true);
  if (typeof renderFileStyleTab === 'function') renderFileStyleTab('calendar');
  if (typeof showPublishDetailTab === 'function') showPublishDetailTab(true);
  if (typeof switchDetailTab === 'function') switchDetailTab('calendar-today');
  const titleEl = detailRoot.querySelector('#split-right-title');
  if (titleEl) titleEl.textContent = ev.name || 'イベント詳細';
  const tabContent = detailRoot.querySelector('#detail-tab-calendar-today');
  if (!tabContent) {
    _openEventEditPanel(dbPath, ev);
    return;
  }
  const rec = _recParse(ev);
  const recType = rec.type || '';
  tabContent.innerHTML = '';
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;';
  body.dataset.calEventMembers = JSON.stringify(_calendarEventMembers(ev));
  body.innerHTML = `
    <div class="field"><label>タイトル</label><input id="cal-detail-title" value="${esc(ev.name || '')}" placeholder="イベント名"></div>
    <div class="field"><label><input id="cal-detail-allday" type="checkbox" ${ev.allDay ? 'checked' : ''}> 終日</label></div>
    <div class="field"><label>開始</label><input id="cal-detail-start" type="datetime-local" value="${_toCalendarInputValue(ev._origStart || ev.start)}" ${ev.allDay ? 'disabled style="opacity:0.4"' : ''}></div>
    <div class="field"><label>終了</label><input id="cal-detail-end" type="datetime-local" value="${_toCalendarInputValue(ev._origEnd || ev.end || ev.start)}" ${ev.allDay ? 'disabled style="opacity:0.4"' : ''}></div>
    <div class="field"><label>色</label><button type="button" id="cal-detail-color" class="gb-color-swatch gb-color-swatch--field" data-color="${esc(ev.color || '#569cd6')}" title="イベント色"></button></div>
    <div class="field"><label>場所</label><input id="cal-detail-location" value="${esc(ev.location || '')}"></div>
    <div class="field"><label>URL</label><input id="cal-detail-url" type="url" value="${esc(ev.url || '')}" placeholder="https://..."></div>
    <div class="field"><label>説明</label><textarea id="cal-detail-desc" rows="4">${esc(ev.description || '')}</textarea></div>
    <div class="field"><label>アラーム</label>
      <select id="cal-detail-alert">
        <option value="-1" ${Number(ev.alertMinutes)===-1?'selected':''}>なし</option>
        <option value="0" ${Number(ev.alertMinutes)===0?'selected':''}>イベント時</option>
        <option value="5" ${Number(ev.alertMinutes)===5?'selected':''}>5分前</option>
        <option value="10" ${Number(ev.alertMinutes)===10?'selected':''}>10分前</option>
        <option value="15" ${Number(ev.alertMinutes)===15?'selected':''}>15分前</option>
        <option value="30" ${Number(ev.alertMinutes)===30?'selected':''}>30分前</option>
        <option value="60" ${Number(ev.alertMinutes)===60?'selected':''}>1時間前</option>
      </select>
    </div>
    <div class="field"><label>繰り返し</label>
      <select id="cal-detail-rec-type">
        <option value="">なし</option>
        <option value="daily" ${recType==='daily'?'selected':''}>毎日</option>
        <option value="weekly" ${recType==='weekly'?'selected':''}>毎週</option>
        <option value="monthly" ${recType==='monthly'?'selected':''}>毎月</option>
        <option value="yearly" ${recType==='yearly'?'selected':''}>毎年</option>
      </select>
      <div id="cal-detail-rec-opts" style="${recType?'':'display:none;'}margin-top:6px;">
        <label style="font-size:11px;">間隔: <input id="cal-detail-rec-interval" type="number" min="1" value="${rec.interval||1}" style="width:56px;"></label>
        <label style="font-size:11px;margin-left:8px;">終了日: <input id="cal-detail-rec-end" type="date" value="${rec.endDate||''}"></label>
        <div id="cal-detail-rec-days" style="margin-top:6px;font-size:11px;${recType==='weekly'?'':'display:none;'}">
          ${['日','月','火','水','木','金','土'].map((d,i)=>`<label style="margin-right:4px;"><input type="checkbox" class="cal-detail-rec-dow" value="${i}" ${(rec.daysOfWeek||[]).includes(i)?'checked':''}> ${d}</label>`).join('')}
        </div>
      </div>
    </div>
    <div class="field"><label>カレンダー</label><input id="cal-detail-calendar" value="${esc(ev.calendarId || 'default')}" placeholder="default"></div>
    ${_calendarUserFields('cal-detail', ev)}
    ${ev.linkedEntryPath ? `
    <div class="field">
      <label>元エントリ <span style="font-size:10px;color:var(--fg2);margin-left:6px;">${ev.linkedAutoGenerated ? '(自動生成)' : ''}</span></label>
      <div style="display:flex;gap:6px;align-items:center;">
        <div style="flex:1;font-size:11px;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ev.linkedEntryPath)}</div>
        <button id="cal-detail-open-entry" type="button">元エントリを開く</button>
      </div>
    </div>
    ` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">
      <button class="danger" id="cal-detail-delete">削除</button>
      <button id="cal-detail-save" class="primary">更新</button>
    </div>
  `;
  tabContent.appendChild(body);
  _populateCalendarEventUserControls(body, 'cal-detail', ev);
  const colorSwatch = body.querySelector('#cal-detail-color');
  bindColorSwatch(colorSwatch, () => getColorSwatchValue(colorSwatch, ev.color || '#569cd6'), (nextColor) => {
    setColorSwatchValue(colorSwatch, nextColor || '#569cd6');
  });
  const toggleAllDayInputs = () => {
    const disabled = body.querySelector('#cal-detail-allday')?.checked;
    ['cal-detail-start', 'cal-detail-end'].forEach(id => {
      const input = body.querySelector('#' + id);
      if (!input) return;
      input.disabled = !!disabled;
      input.style.opacity = disabled ? '0.4' : '1';
    });
  };
  body.querySelector('#cal-detail-allday')?.addEventListener('change', toggleAllDayInputs);
  body.querySelector('#cal-detail-open-entry')?.addEventListener('click', () => {
    // Phase 1 §5.4: リンク元 settings-entry を開く
    const p = ev.linkedEntryPath;
    if (!p) return;
    if (typeof selectEntity === 'function') {
      selectEntity(p);
    } else if (window.GbEditor && typeof window.GbEditor.selectEntity === 'function') {
      window.GbEditor.selectEntity(p);
    }
  });
  body.querySelector('#cal-detail-rec-type')?.addEventListener('change', function() {
    body.querySelector('#cal-detail-rec-opts').style.display = this.value ? '' : 'none';
    body.querySelector('#cal-detail-rec-days').style.display = this.value === 'weekly' ? '' : 'none';
  });
  body.querySelector('#cal-detail-save')?.addEventListener('click', async () => {
    const title = body.querySelector('#cal-detail-title').value.trim() || '無題イベント';
    const creator = body.querySelector('#cal-detail-creator')?.value || _getUser();
    const allDay = body.querySelector('#cal-detail-allday').checked;
    const start = body.querySelector('#cal-detail-start').value;
    const end = body.querySelector('#cal-detail-end').value;
    const alertMinutes = parseInt(body.querySelector('#cal-detail-alert').value, 10);
    let recurrence = '';
    const recMode = body.querySelector('#cal-detail-rec-type').value;
    if (recMode) {
      const nextRec = {
        type: recMode,
        interval: parseInt(body.querySelector('#cal-detail-rec-interval').value, 10) || 1,
        endDate: body.querySelector('#cal-detail-rec-end').value || '',
      };
      if (recMode === 'weekly') nextRec.daysOfWeek = [...body.querySelectorAll('.cal-detail-rec-dow:checked')].map(cb => parseInt(cb.value, 10));
      recurrence = JSON.stringify(nextRec);
    }
    _calPushUndo('イベント編集');
    try {
      await apiPut('/calendar-db/events/' + encodeURIComponent(ev.name), {
        db_path: dbPath,
        title,
        start,
        end,
        all_day: allDay,
        color: getColorSwatchValue(colorSwatch, ev.color || ''),
        location: body.querySelector('#cal-detail-location').value,
        url: body.querySelector('#cal-detail-url').value,
        description: body.querySelector('#cal-detail-desc').value,
        alert_minutes: alertMinutes,
        calendar_id: body.querySelector('#cal-detail-calendar').value || 'default',
        creator,
        members: _collectCalendarEventMembers(body, 'cal-detail', creator),
        recurrence,
      });
      // Phase 2 §5.5: 逆方向同期（Calendar→Entry）。自動生成イベントなら元エントリの
      // 日付プロパティを更新する。繰り返し化されたイベントはスキップ（reverseSync.skipIfRecurrence）。
      try {
        if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onEventSaved === 'function') {
          await window.GbDbCalendarSync.onEventSaved({
            prev: ev,
            next: { ...ev, title, start, end, allDay, recurrence },
          });
        }
      } catch {}
      const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
      await selectDatabase(dbPath, ctx);
      const nextEvent = (_calRenderState.allEvents || []).find(item => item.name === title)
        || { ...ev, name: title, allDay, color: getColorSwatchValue(colorSwatch, ev.color || ''), creator, members: _collectCalendarEventMembers(body, 'cal-detail', creator) };
      _showCalendarEventDetailPanel(dbPath, nextEvent);
      showStatus('イベントを更新しました');
    } catch {
      showStatus('イベントの更新に失敗しました', true);
    }
  });
  body.querySelector('#cal-detail-delete')?.addEventListener('click', async () => {
    if (!await cfConfirm((ev.name || 'イベント') + ' を削除しますか？')) return;
    _calPushUndo('イベント削除');
    try {
      await apiDelete('/calendar-db/events/' + encodeURIComponent(ev.name) + '?db_path=' + encodeURIComponent(dbPath));
      const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : null;
      await selectDatabase(dbPath, ctx);
      if (typeof clearDetailPanel === 'function') clearDetailPanel();
      showStatus('イベントを削除しました');
    } catch {
      showStatus('イベントの削除に失敗しました', true);
    }
  });
  setTimeout(() => body.querySelector('#cal-detail-title')?.focus(), 40);
}

/* ==============================
   イベント編集パネル（完全版）
   ============================== */
function _openEventEditPanel(dbPath, ev, defStart, defEnd, defAllDay) {
  if (ev?._mapped && typeof _openMappedCalendarEventPanel === 'function') {
    _openMappedCalendarEventPanel(dbPath, ev);
    return;
  }
  if (!_calRenderState.info?.canCreateEvents && !ev) {
    showStatus('このDBではカレンダーから新規作成できません');
    return;
  }
  document.querySelectorAll('.modal-overlay').forEach(existing => {
    if (existing.querySelector?.('#ep-title')) existing.remove();
  });
  // v5.0: モーダルオーバーレイで編集（旧detail-panelは廃止済み）
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const panel = document.createElement('div');
  panel.className = 'modal';
  panel.style.cssText = 'min-width:450px;max-height:80vh;overflow-y:auto;';
  panel.dataset.calEventMembers = JSON.stringify(_calendarEventMembers(ev));
  overlay.appendChild(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  const isNew=!ev;
  const title=isNew?'':ev.name;
  const _toLocalDT=(dt)=>{const y=dt.getFullYear(),m=_p2(dt.getMonth()+1),d=_p2(dt.getDate()),h=_p2(dt.getHours()),mi=_p2(dt.getMinutes());return `${y}-${m}-${d}T${h}:${mi}`;};
  // 繰り返し展開インスタンスの場合は元の日時で編集（繰り返しルール自体を編集）
  const evStart=isNew?null:(ev._origStart||ev.start);
  const evEnd=isNew?null:(ev._origEnd||ev.end);
  const start=isNew?_toLocalDT(defStart||new Date()):_toLocalDT(evStart);
  const end=isNew?_toLocalDT(defEnd||new Date(Date.now()+3600000)):_toLocalDT(evEnd);
  const allDay=isNew?!!defAllDay:ev.allDay;
  const color=isNew?'#569cd6':ev.color;
  const loc=isNew?'':(ev.location||'');
  const url=isNew?'':(ev.url||'');
  const desc=isNew?'':(ev.description||'');
  const alertMin=isNew?-1:(ev.alertMinutes ?? -1);
  const calId=isNew?'default':(ev.calendarId||'default');
  const rec=isNew?{}:_recParse(ev);
  const recType=rec.type||'';

  panel.innerHTML=`<div style="padding:12px;overflow-y:auto;">
    <h3 style="margin:0 0 12px;">${isNew?'新規イベント':'イベント編集'}</h3>
    <div class="field"><label>タイトル</label><input id="ep-title" value="${esc(title)}" placeholder="イベント名"></div>
    <div class="field"><label><input id="ep-allday" type="checkbox" ${allDay?'checked':''}> 終日</label></div>
    <div class="field"><label>開始</label><input id="ep-start" type="datetime-local" value="${start}" ${allDay?'disabled style="opacity:0.4"':''}></div>
    <div class="field"><label>終了</label><input id="ep-end" type="datetime-local" value="${end}" ${allDay?'disabled style="opacity:0.4"':''}></div>
    <div class="field"><label>色</label><button type="button" id="ep-color" class="gb-color-swatch gb-color-swatch--field" data-color="${esc(color || '')}" title="イベント色"></button></div>
    <div class="field"><label>場所</label><input id="ep-location" value="${esc(loc)}"></div>
    <div class="field"><label>URL</label><input id="ep-url" type="url" value="${esc(url)}" placeholder="https://..."></div>
    <div class="field"><label>説明</label><textarea id="ep-desc" rows="3">${esc(desc)}</textarea></div>
    <div class="field"><label>アラーム</label>
      <select id="ep-alert"><option value="-1" ${alertMin===-1?'selected':''}>なし</option><option value="0" ${alertMin===0?'selected':''}>イベント時</option><option value="5" ${alertMin===5?'selected':''}>5分前</option><option value="10" ${alertMin===10?'selected':''}>10分前</option><option value="15" ${alertMin===15?'selected':''}>15分前</option><option value="30" ${alertMin===30?'selected':''}>30分前</option><option value="60" ${alertMin===60?'selected':''}>1時間前</option></select>
    </div>
    <div class="field"><label>繰り返し</label>
      <select id="ep-rec-type">
        <option value="">なし</option><option value="daily" ${recType==='daily'?'selected':''}>毎日</option><option value="weekly" ${recType==='weekly'?'selected':''}>毎週</option><option value="monthly" ${recType==='monthly'?'selected':''}>毎月</option><option value="yearly" ${recType==='yearly'?'selected':''}>毎年</option>
      </select>
      <div id="ep-rec-opts" style="${recType?'':'display:none;'}margin-top:4px;">
        <label style="font-size:11px;">間隔: <input id="ep-rec-interval" type="number" min="1" value="${rec.interval||1}" style="width:50px;"></label>
        <label style="font-size:11px;margin-left:8px;">終了日: <input id="ep-rec-end" type="date" value="${rec.endDate||''}"></label>
        <div id="ep-rec-days" style="margin-top:4px;font-size:11px;${recType==='weekly'?'':'display:none;'}">
          ${['日','月','火','水','木','金','土'].map((d,i)=>`<label style="margin-right:4px;"><input type="checkbox" class="ep-rec-dow" value="${i}" ${(rec.daysOfWeek||[]).includes(i)?'checked':''}> ${d}</label>`).join('')}
        </div>
      </div>
    </div>
    <div class="field"><label>カレンダー</label><input id="ep-calid" value="${esc(calId)}" placeholder="default"></div>
    ${_calendarUserFields('ep', ev)}
    <div class="btn-row" style="margin-top:12px;">
      ${isNew?'':`<button class="danger" id="ep-delete">削除</button>`}
      <button id="ep-cancel">キャンセル</button>
      <button class="primary" id="ep-save">${isNew?'作成':'更新'}</button>
    </div>
  </div>`;
  // 繰り返しタイプ切替
  panel.querySelector('#ep-rec-type').addEventListener('change', function(){
    panel.querySelector('#ep-rec-opts').style.display=this.value?'':'none';
    panel.querySelector('#ep-rec-days').style.display=this.value==='weekly'?'':'none';
  });
  const colorSwatch = panel.querySelector('#ep-color');
  bindColorSwatch(colorSwatch, () => getColorSwatchValue(colorSwatch, color || ''), (nextColor) => {
    setColorSwatchValue(colorSwatch, nextColor || '#569cd6');
  });
  _populateCalendarEventUserControls(panel, 'ep', ev);
  // 終日トグル
  panel.querySelector('#ep-allday').onchange=function(){const d=this.checked;['ep-start','ep-end'].forEach(id=>{const el=panel.querySelector('#'+id);el.disabled=d;el.style.opacity=d?'0.4':'1';});};
  // 保存
  panel.querySelector('#ep-save').addEventListener('click', async()=>{
    const t=panel.querySelector('#ep-title').value.trim()||'無題イベント';
    const s=panel.querySelector('#ep-start').value,en=panel.querySelector('#ep-end').value;
    const c=getColorSwatchValue(colorSwatch, color || ''),lc=panel.querySelector('#ep-location').value;
    const u=panel.querySelector('#ep-url').value,d=panel.querySelector('#ep-desc').value;
    const ad=panel.querySelector('#ep-allday').checked;
    const al=parseInt(panel.querySelector('#ep-alert').value);
    const ci=panel.querySelector('#ep-calid').value||'default';
    const creator=panel.querySelector('#ep-creator')?.value||_getUser();
    const members=_collectCalendarEventMembers(panel,'ep',creator);
    let recStr='';
    const rt=panel.querySelector('#ep-rec-type').value;
    if(rt){const r={type:rt,interval:parseInt(panel.querySelector('#ep-rec-interval').value)||1,endDate:panel.querySelector('#ep-rec-end').value||''};if(rt==='weekly')r.daysOfWeek=[...panel.querySelectorAll('.ep-rec-dow:checked')].map(cb=>parseInt(cb.value));recStr=JSON.stringify(r);}
    _calPushUndo(isNew?'イベント作成':'イベント編集');
    try{
      if(isNew) await apiPost('/calendar-db/events',{db_path:dbPath,title:t,start:s,end:en,color:c,location:lc,url:u,description:d,all_day:ad,alert_minutes:al,calendar_id:ci,creator,members,recurrence:recStr});
      else await apiPut('/calendar-db/events/'+encodeURIComponent(ev.name),{db_path:dbPath,start:s,end:en,color:c,location:lc,url:u,description:d,all_day:ad,alert_minutes:al,calendar_id:ci,creator,members,recurrence:recStr,title:t});
      overlay.remove();await selectDatabase(dbPath);
    }catch{showStatus('保存に失敗',true);}
  });
  panel.querySelector('#ep-cancel').addEventListener('click', ()=>{overlay.remove();});
  if(!isNew) panel.querySelector('#ep-delete').addEventListener('click', async()=>{if(!await cfConfirm(ev.name+' を削除しますか？'))return;_calPushUndo('イベント削除');try{await apiDelete('/calendar-db/events/'+encodeURIComponent(ev.name)+'?db_path='+encodeURIComponent(dbPath));overlay.remove();await selectDatabase(dbPath);}catch{showStatus('削除に失敗',true);}});
}
function _recParse(ev){try{return ev?.recurrence?(typeof ev.recurrence==='string'?JSON.parse(ev.recurrence):ev.recurrence):{};}catch{return {};}}

/* ==============================
   タスクモーダル（完全版）
   ============================== */
function _openTaskModal(dbPath, task, defaultStatus) {
  const isNew=!task;
  const o=document.createElement('div');o.className='modal-overlay';
  o.innerHTML=`<div class="modal" style="min-width:450px;">
    <h3>${isNew?'新規タスク':'タスク編集'}</h3>
    <div class="field"><label>タイトル</label><input id="tk-title" value="${esc(task?.name||'')}"></div>
    <div style="display:flex;gap:8px;">
      <div class="field" style="flex:1;"><label>ステータス</label><select id="tk-status">
        ${[['backlog','バックログ'],['todo','未着手'],['in_progress','進行中'],['review','レビュー'],['done','完了']].map(([v,l])=>`<option value="${v}" ${(task?.description?.match(/status:(\w+)/)?.[1]||defaultStatus||'todo')===v?'selected':''}>${l}</option>`).join('')}
      </select></div>
      <div class="field" style="flex:1;"><label>優先度</label><select id="tk-priority">
        ${[['low','低'],['medium','中'],['high','高'],['urgent','緊急']].map(([v,l])=>`<option value="${v}" ${(task?.description?.match(/priority:(\w+)/)?.[1]||'medium')===v?'selected':''}>${l}</option>`).join('')}
      </select></div>
    </div>
    <div style="display:flex;gap:8px;">
      <div class="field" style="flex:1;"><label>期限</label><input id="tk-due" type="date" value="${task?.end?_dateStr(task.end):(task?.start?_dateStr(task.start):'')}"></div>
      <div class="field" style="flex:1;"><label>担当者</label><input id="tk-assignee" value="${esc(task?.calendarId||'')}"></div>
    </div>
    <div class="field"><label>説明</label><textarea id="tk-desc" rows="3">${esc(task?.description?.replace(/status:\w+\s*/g,'').replace(/priority:\w+\s*/g,'').trim()||'')}</textarea></div>
    <div class="btn-row">
      ${isNew?'':`<button class="danger" id="tk-delete">削除</button>`}
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" id="tk-save">${isNew?'作成':'更新'}</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  o.querySelector('#tk-save').addEventListener('click', async()=>{
    const title=o.querySelector('#tk-title').value.trim()||'無題タスク';
    const status=o.querySelector('#tk-status').value;
    const priority=o.querySelector('#tk-priority').value;
    const due=o.querySelector('#tk-due').value;
    const assignee=o.querySelector('#tk-assignee').value;
    const desc=o.querySelector('#tk-desc').value;
    const fullDesc=`status:${status} priority:${priority} ${desc}`.trim();
    o.remove();
    _calPushUndo(isNew?'タスク作成':'タスク編集');
    try{
      const fallbackDate = task?.start ? _dateStr(task.start) : _dateStr(new Date());
      const taskDate = due || fallbackDate;
      if(isNew) await apiPost('/calendar-db/events',{db_path:dbPath,title,start:taskDate,end:taskDate,description:fullDesc,calendar_id:assignee||'default',color:status==='done'?'#98c379':status==='in_progress'?'#d19a66':'#569cd6'});
      else await apiPut('/calendar-db/events/'+encodeURIComponent(task.name),{db_path:dbPath,description:fullDesc,calendar_id:assignee||'default',title,start:taskDate,end:taskDate});
      await selectDatabase(dbPath);
    }catch{showStatus('保存に失敗',true);}
  });
  if(!isNew) o.querySelector('#tk-delete').addEventListener('click', async()=>{if(!await cfConfirm('このタスクを削除しますか？'))return;o.remove();_calPushUndo('タスク削除');try{await apiDelete('/calendar-db/events/'+encodeURIComponent(task.name)+'?db_path='+encodeURIComponent(dbPath));await selectDatabase(dbPath);}catch{}});
  setTimeout(()=>o.querySelector('#tk-title').focus(),50);
}

/* ==============================
   タスクボード
   ============================== */
function _renderTaskBoard(container, dbPath, events) {
  const statuses=[{key:'backlog',label:'バックログ',color:'var(--fg2)'},{key:'todo',label:'未着手',color:'#569cd6'},{key:'in_progress',label:'進行中',color:'#d19a66'},{key:'review',label:'レビュー',color:'#c678dd'},{key:'done',label:'完了',color:'#98c379'}];
  const board=document.createElement('div');board.style.cssText='display:flex;gap:8px;overflow-x:auto;padding:8px 0;flex:1;';
  statuses.forEach(s=>{
    const col=document.createElement('div');col.style.cssText='min-width:180px;flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:4px;display:flex;flex-direction:column;';
    const taskEvs=events.filter(ev=>(ev.description||'').includes('status:'+s.key));
    const hdr=document.createElement('div');hdr.style.cssText='padding:6px 8px;font-size:12px;font-weight:bold;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;';
    hdr.innerHTML=`<span style="color:${s.color};">${s.label}</span><span style="font-size:10px;color:var(--fg2);">${taskEvs.length}</span>`;
    col.appendChild(hdr);
    const body=document.createElement('div');body.style.cssText='flex:1;padding:4px;overflow-y:auto;min-height:100px;';
    body.addEventListener('dragover',e=>{e.preventDefault();body.style.background='rgba(86,156,214,0.08)';});
    body.addEventListener('dragleave',()=>{body.style.background='';});
    body.addEventListener('drop',async e=>{e.preventDefault();body.style.background='';let data;try{data=JSON.parse(e.dataTransfer.getData('text/plain'));}catch{return;}if(!data||!data.name)return;
      _calPushUndo('タスク移動');
      const ev=events.find(x=>x.name===data.name);const oldDesc=(ev?.description||'').replace(/status:\w+/,'status:'+s.key);
      try{await apiPut('/calendar-db/events/'+encodeURIComponent(data.name),{db_path:dbPath,description:oldDesc});await selectDatabase(dbPath);}catch{};
    });
    taskEvs.forEach(ev=>{
      const card=document.createElement('div');
      const priority=(ev.description||'').match(/priority:(\w+)/)?.[1]||'medium';
      const prioColors={urgent:'#e06c75',high:'#d19a66',medium:'#569cd6',low:'var(--fg2)'};
      card.style.cssText=`background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px;margin:4px 0;cursor:pointer;font-size:11px;border-left:3px solid ${prioColors[priority]||'#569cd6'};`;
      card.draggable=true;
      card.addEventListener('dragstart',e2=>{e2.dataTransfer.setData('text/plain',JSON.stringify({name:ev.name,file:ev.file}));card.style.opacity='0.4';});
      card.addEventListener('dragend',()=>{card.style.opacity='';});
      const titleDiv=document.createElement('div');titleDiv.style.fontWeight='bold';titleDiv.textContent=ev.name;
      card.appendChild(titleDiv);
      // メタ行
      const meta=document.createElement('div');meta.style.cssText='font-size:10px;color:var(--fg2);margin-top:2px;display:flex;gap:6px;';
      meta.innerHTML=`<span style="color:${prioColors[priority]}">${priority}</span>`;
      if(ev.end&&!isNaN(ev.end.getTime())) meta.innerHTML+=`<span>〆${(ev.end.toISOString()||'').substring(5,10)}</span>`;
      if(ev.calendarId&&ev.calendarId!=='default') meta.innerHTML+=`<span>${esc(ev.calendarId)}</span>`;
      card.appendChild(meta);
      card.addEventListener('click', ()=>_openTaskModal(dbPath,ev));
      body.appendChild(card);
    });
    const addBtn=document.createElement('div');addBtn.style.cssText='padding:4px;text-align:center;color:var(--fg2);font-size:11px;cursor:pointer;';
    addBtn.textContent='+ 追加';addBtn.addEventListener('click', ()=>_openTaskModal(dbPath,null,s.key));
    body.appendChild(addBtn);
    col.appendChild(body);board.appendChild(col);
  });
  container.appendChild(board);
}

/* ==============================
   シフト表（予定 + 実績 2行、打刻パネル）
   ============================== */
function _renderShiftView(container, dbPath, events) {
  const curDate=getCalendarDate(dbPath);
  const y=curDate.getFullYear(),m=curDate.getMonth();
  const daysInMonth=new Date(y,m+1,0).getDate();
  const dayNames=_getDayNames();
  const todayStr=_dateStr(new Date());
  // 打刻パネル
  const clockPanel=document.createElement('div');
  clockPanel.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:8px;padding:4px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;font-size:12px;';
  clockPanel.innerHTML=`<span style="font-weight:bold;">打刻:</span>
    <button class="tl-nav-btn" data-action="_clockAction('clock_in')">出勤</button>
    <button class="tl-nav-btn" data-action="_clockAction('clock_out')">退勤</button>
    <button class="tl-nav-btn" data-action="_clockAction('break_start')">休憩開始</button>
    <button class="tl-nav-btn" data-action="_clockAction('break_end')">休憩終了</button>
    <span id="clock-status" style="color:var(--fg2);"></span>`;
  container.appendChild(clockPanel);
  _updateClockStatus();

  const users=[...new Set(events.map(e=>e.calendarId||'default'))];
  const eventOverlapsDay = (ev, ds) => {
    const start = new Date(ev.start); start.setHours(0,0,0,0);
    const end = new Date(ev.end || ev.start); end.setHours(0,0,0,0);
    const day = new Date(ds + 'T00:00');
    return start <= day && day <= end;
  };
  const dbPathArg = esc(JSON.stringify(dbPath));
  const table=document.createElement('div');table.style.cssText='overflow-x:auto;';
  let html='<table style="border-collapse:collapse;font-size:10px;width:max-content;">';
  html+='<tr><th style="border:1px solid var(--border);padding:2px 4px;background:var(--bg3);position:sticky;left:0;z-index:2;min-width:80px;">ユーザー</th>';
  for(let d=1;d<=daysInMonth;d++){const ds=`${y}-${_p2(m+1)}-${_p2(d)}`;const dow=new Date(y,m,d).getDay();const isToday=ds===todayStr;const isWe=dow===0||dow===6;
    html+=`<th style="border:1px solid var(--border);padding:2px 4px;background:${isToday?'var(--accent)':isWe?'var(--bg4)':'var(--bg3)'};color:${isToday?'var(--ui-fg-strong)':'var(--fg2)'};min-width:36px;text-align:center;">${d}<br>${['日','月','火','水','木','金','土'][dow]}</th>`;}
  html+='</tr>';
  users.forEach(user=>{
    // 予定行
    html+=`<tr><td style="border:1px solid var(--border);padding:2px 6px;background:var(--bg2);font-weight:bold;position:sticky;left:0;z-index:1;white-space:nowrap;">${esc(user)}<br><span style="font-size:9px;color:var(--fg2);">予定</span></td>`;
    for(let d=1;d<=daysInMonth;d++){const ds=`${y}-${_p2(m+1)}-${_p2(d)}`;
      // user==='default' はマッピングのない（calendarId 未設定）のイベントのみ拾う。
      // 以前の `user==='default'` ショートカットは全ユーザーの予定を default 行にも重複表示してしまっていた。
      const dayEvs=events.filter(ev=>{
        const cid=ev.calendarId||'default';
        return cid===user && eventOverlapsDay(ev, ds);
      });
      const isWe=new Date(y,m,d).getDay()===0||new Date(y,m,d).getDay()===6;
      let content='',bg=isWe?'var(--bg4)':'';
      if(dayEvs.length>0){content=dayEvs.map(ev=>ev.allDay?lucide('circle',8):`${_p2(ev.start.getHours())}:${_p2(ev.start.getMinutes())}-${_p2(ev.end.getHours())}:${_p2(ev.end.getMinutes())}`).join('<br>');bg=dayEvs[0].color+'33';}
      html+=`<td style="border:1px solid var(--border);padding:1px 2px;text-align:center;cursor:pointer;${bg?'background:'+bg+';':''}" ondblclick="_openEventEditPanel(${dbPathArg},null,new Date('${ds}T09:00'),new Date('${ds}T18:00'))">${content}</td>`;
    }
    html+='</tr>';
    // 実績行（簡易 — 打刻データはAPIから取得する必要があるが、現時点ではイベントデータのみ）
    html+=`<tr><td style="border:1px solid var(--border);padding:2px 6px;background:var(--bg);position:sticky;left:0;z-index:1;"><span style="font-size:9px;color:var(--fg2);">実績</span></td>`;
    for(let d=1;d<=daysInMonth;d++){html+=`<td style="border:1px solid var(--border);padding:1px 2px;text-align:center;font-size:9px;color:var(--fg2);"></td>`;}
    html+='</tr>';
  });
  // 合計行
  html+='<tr><td style="border:1px solid var(--border);padding:2px 6px;background:var(--bg3);font-weight:bold;position:sticky;left:0;z-index:1;">合計</td>';
  for(let d=1;d<=daysInMonth;d++){const ds=`${y}-${_p2(m+1)}-${_p2(d)}`;const count=events.filter(ev=>eventOverlapsDay(ev, ds)).length;
    html+=`<td style="border:1px solid var(--border);padding:1px 2px;text-align:center;font-size:9px;background:var(--bg3);">${count||''}</td>`;}
  html+='</tr></table>';
  table.innerHTML=html;container.appendChild(table);
}

/* ==============================
   打刻
   ============================== */
async function _clockAction(type) {
  try{await apiPost('/cal/time',{type,user:_getUser(),timestamp:new Date().toISOString()});
    const labels={clock_in:'出勤しました',clock_out:'退勤しました',break_start:'休憩開始',break_end:'休憩終了'};
    showStatus(labels[type]||type);_updateClockStatus();
  }catch{showStatus('打刻に失敗',true);}
}
async function _updateClockStatus() {
  // v5.0: CalendarComponent内の.gb-cal-clock-status-textも探す
  const el=document.getElementById('clock-status') || document.querySelector('.gb-cal-clock-status-text');if(!el)return;
  try{const entries=await apiFetch('/cal/time?user='+encodeURIComponent(_getUser())+'&date_from='+_dateStr(new Date()));
    const last=entries[entries.length-1];if(!last){el.textContent='未出勤';return;}
    const labels={clock_in:'出勤中',clock_out:'退勤済み',break_start:'休憩中',break_end:'勤務中'};
    el.textContent=(labels[last.type]||last.type)+' '+(last.timestamp||'').substring(11,16);
  }catch{el.textContent='';}
}

/* ==============================
   ミニカレンダー
   ============================== */
function _renderMiniCalendar(sidebar,dbPath,events) {
  const curDate=getCalendarDate(dbPath);const y=curDate.getFullYear(),m=curDate.getMonth();
  const box=document.createElement('div');box.style.cssText='background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px;';
  const hdr=document.createElement('div');hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
  hdr.innerHTML=`<button class="tl-nav-btn" style="padding:0 4px;">${lucide('chevronLeft', 12)}</button><span style="font-size:11px;font-weight:bold;">${y}年${m+1}月</span><button class="tl-nav-btn" style="padding:0 4px;">${lucide('chevronRight', 12)}</button>`;
  hdr.children[0].addEventListener('click', ()=>{const d=getCalendarDate(dbPath);d.setMonth(d.getMonth()-1);setCalendarDate(dbPath,d);renderCalendar();});
  hdr.children[2].addEventListener('click', ()=>{const d=getCalendarDate(dbPath);d.setMonth(d.getMonth()+1);setCalendarDate(dbPath,d);renderCalendar();});
  box.appendChild(hdr);
  const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(7,1fr);gap:0;text-align:center;';
  _getDayNames().forEach(dn=>{const h=document.createElement('div');h.style.cssText='font-size:9px;color:var(--fg2);padding:1px;';h.textContent=dn;grid.appendChild(h);});
  const firstDay=(new Date(y,m,1).getDay()-_calStartDay+7)%7;
  const daysInMonth=new Date(y,m+1,0).getDate();
  const todayStr=_dateStr(new Date()),selStr=_dateStr(curDate);
  for(let i=0;i<firstDay;i++){grid.appendChild(document.createElement('div'));}
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${y}-${_p2(m+1)}-${_p2(d)}`;const el=document.createElement('div');
    el.style.cssText='font-size:10px;padding:2px;cursor:pointer;border-radius:3px;';
    if(ds===todayStr)el.style.cssText+='color:var(--accent);font-weight:bold;';
    if(ds===selStr)el.style.cssText+='background:var(--accent);color:var(--ui-fg-strong);';
    const hasEv=events.some(ev=>{const s=new Date(ev.start);return s.getFullYear()===y&&s.getMonth()===m&&s.getDate()===d;});
    el.textContent=d;if(hasEv&&ds!==selStr)el.style.cssText+='text-decoration:underline;';
    el.addEventListener('click', ()=>{setCalendarDate(dbPath,new Date(ds));renderCalendar();});
    grid.appendChild(el);
  }
  box.appendChild(grid);
  if (sidebar) sidebar.appendChild(box);
  return box;
}

/* ==============================
   本日のイベント + タスク
   ============================== */
function _renderTodayWidget(sidebar,dbPath,events) {
  const mappedDb = !!_calRenderState.info?.isMappedDb;
  const today=new Date();today.setHours(0,0,0,0);
  const todayEvs=events.filter(ev=>{const s=new Date(ev.start);s.setHours(0,0,0,0);const e=new Date(ev.end);e.setHours(0,0,0,0);return today>=s&&today<=e;});
  // 未完了タスク（期限が今日以前 or ステータスがdone/backlog以外）
  const activeTasks=events.filter(ev=>_isTask(ev)&&_taskStatus(ev)!=='done'&&_taskStatus(ev)!=='backlog');
  const todayTasks=activeTasks.filter(ev=>{const s=new Date(ev.start);s.setHours(0,0,0,0);return s<=today;});

  // 2026-04-17: detail-panel-section-unification-plan.md に基づき .gb-section.gb-section--detail でくくる
  const box=document.createElement('div');
  // イベントセクション
  const evSection=document.createElement('section');evSection.className='gb-section gb-section--detail';
  const evHdr=document.createElement('div');evHdr.className='gb-section-title';
  evHdr.textContent=`今日のイベント (${todayEvs.filter(e=>!_isTask(e)).length})`;evSection.appendChild(evHdr);
  const pureEvents=todayEvs.filter(e=>!_isTask(e));
  if(!pureEvents.length){const e=document.createElement('div');e.style.cssText='font-size:10px;color:var(--fg2);';e.textContent='イベントなし';evSection.appendChild(e);}
  else pureEvents.forEach(ev=>{const el=document.createElement('div');el.style.cssText='font-size:10px;padding:2px 4px;margin:2px 0;border-radius:3px;cursor:pointer;color:#fff;';el.style.background=ev.color;
    const timeStr=ev.allDay?'終日':`${_p2(ev.start.getHours())}:${_p2(ev.start.getMinutes())}`;
    el.textContent=`${timeStr} ${ev.name}`;el.addEventListener('click', ()=>{if(ev._mapped&&typeof _openMappedCalendarEventPanel==='function'){_openMappedCalendarEventPanel(dbPath,ev);return;}_showCalendarEventDetailPanel(dbPath,ev);});evSection.appendChild(el);});
  box.appendChild(evSection);
  // タスクセクション
  if(todayTasks.length>0){
    const tkSection=document.createElement('section');tkSection.className='gb-section gb-section--detail';
    const tkHdr=document.createElement('div');tkHdr.className='gb-section-title';
    tkHdr.textContent=`タスク (${todayTasks.length})`;tkSection.appendChild(tkHdr);
    todayTasks.slice(0,10).forEach(ev=>{
      const el=document.createElement('div');el.style.cssText='font-size:10px;padding:2px 4px;margin:2px 0;cursor:pointer;display:flex;align-items:center;gap:4px;';
      const prioColors={urgent:'var(--red)',high:'var(--orange)',medium:'var(--blue)',low:'var(--fg2)'};
      const p=_taskPriority(ev);
      el.innerHTML=`<span style="color:${prioColors[p]||'var(--fg2)'};font-weight:bold;">${(p[0]||'M').toUpperCase()}</span> ${esc(ev.name)}`;
      el.addEventListener('click', ()=>{if(mappedDb&&ev._mapped&&typeof _openMappedCalendarEventPanel==='function'){_openMappedCalendarEventPanel(dbPath,ev);return;}_openTaskModal(dbPath,ev);});tkSection.appendChild(el);
    });
    box.appendChild(tkSection);
  }
  if (sidebar) sidebar.appendChild(box);
  return box;
}

/* ==============================
   カレンダーリスト（フィルタ付き）
   ============================== */
let _calVisibleIds = null;
function _renderCalendarList(sidebar,dbPath,events) {
  const calIds=[...new Set(events.map(e=>e.calendarId||'default'))];
  if(calIds.length<=1) return;
  if(!_calVisibleIds) _calVisibleIds=new Set(calIds);
  const box=document.createElement('div');box.style.cssText='background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:6px;';
  const hdr=document.createElement('div');hdr.style.cssText='font-size:11px;font-weight:bold;margin-bottom:4px;';hdr.textContent='カレンダー';box.appendChild(hdr);
  calIds.forEach(cid=>{
    const el=document.createElement('label');el.style.cssText='display:flex;align-items:center;gap:4px;font-size:10px;padding:2px 0;cursor:pointer;';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=_calVisibleIds.has(cid);
    cb.onchange=()=>{if(cb.checked)_calVisibleIds.add(cid);else _calVisibleIds.delete(cid);renderCalendar();};
    const dot=document.createElement('span');dot.style.cssText='width:8px;height:8px;border-radius:50%;flex-shrink:0;';
    const evOfCal=events.find(e=>e.calendarId===cid);dot.style.background=evOfCal?evOfCal.color:'#569cd6';
    el.appendChild(cb);el.appendChild(dot);el.appendChild(document.createTextNode(cid));box.appendChild(el);
  });
  sidebar.appendChild(box);
}

/* ==============================
   アラームチェッカー
   ============================== */
function _startAlarmChecker(dbPath,events) {
  if(_calAlarmInterval) clearInterval(_calAlarmInterval);
  const check=()=>{
    const now=Date.now();
    events.forEach(ev=>{
      if(ev.alertMinutes<0) return;
      const alertTime=ev.start.getTime()-ev.alertMinutes*60000;
      const key=ev.name+'_'+alertTime;
      if(_calAlertedIds.has(key)) return;
      // 過去24時間以内に発生すべきだった通知も発火（120秒窓を逃した場合の補償）
      if(now>=alertTime && now<ev.start.getTime()+86400000){
        _calAlertedIds.add(key);
        _persistAlertedIds();
        if('Notification' in window && Notification.permission==='granted') new Notification('Meldex カレンダー',{body:ev.name+'\n'+(ev.start.toISOString()||'').substring(11,16),icon:'/Meldex_icon.png'});
        showStatus('🔔 '+ev.name);
      }
    });
  };
  check();
  _calAlarmInterval=setInterval(check,60000);
}

/* ==============================
   スケジュールテンプレート
   ============================== */
const _dayLabels = ['日','月','火','水','木','金','土'];

async function _showTemplateModal(dbPath) {
  let templates = [];
  try { templates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(_getUser())); } catch {}
  const o = document.createElement('div'); o.className = 'modal-overlay';
  let html = '<div class="modal" style="min-width:600px;max-height:80vh;overflow-y:auto;"><h3>週間テンプレート</h3>';
  html += '<div id="tmpl-list">';
  if (!templates.length) html += '<div style="color:var(--fg2);font-size:12px;padding:8px;">テンプレートがありません</div>';
  templates.forEach(t => {
    html += `<div style="border:1px solid var(--border);border-radius:4px;padding:8px;margin-bottom:8px;">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">`;
    html += `<strong>${esc(t.name)}</strong><div>`;
    html += `<button data-action="edit" data-tid="${esc(t.id)}" style="font-size:11px;padding:2px 8px;margin-right:4px;">編集</button>`;
    html += `<button data-action="delete" data-tid="${esc(t.id)}" style="font-size:11px;padding:2px 8px;color:var(--red);margin-right:4px;">削除</button>`;
    html += `<button data-action="generate" data-tid="${esc(t.id)}" style="font-size:11px;padding:2px 8px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:3px;cursor:pointer;">一括生成</button>`;
    html += '</div></div>';
    (t.entries || []).forEach(e => {
      const endTime = _addMinutes(e.startTime || '09:00', e.duration || 60);
      html += `<div style="font-size:11px;color:var(--fg2);padding:1px 0;">${_dayLabels[e.dayOfWeek]} ${e.startTime}〜${endTime} ${esc(e.title || '')}</div>`;
    });
    html += '</div>';
  });
  html += '</div>';
  html += '<div class="btn-row"><button id="tmpl-create">新規テンプレート</button><button data-action="this.closest(\'.modal-overlay\').remove()">閉じる</button></div>';
  html += '</div>';
  o.innerHTML = html;
  document.body.appendChild(o);

  // イベントハンドラ
  o.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => { o.remove(); _editTemplate(dbPath, btn.dataset.tid); }));
  o.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', async () => {
    try { await apiDelete('/cal/schedule-templates/' + btn.dataset.tid); } catch {}
    o.remove(); _showTemplateModal(dbPath);
  }));
  o.querySelectorAll('[data-action="generate"]').forEach(btn => btn.addEventListener('click', () => _generateFromTemplate(dbPath, btn.dataset.tid, templates, o)));
  o.querySelector('#tmpl-create').addEventListener('click', async () => {
    let idx = 1, name = '無題';
    const names = templates.map(t => t.name);
    while (names.includes(name)) { idx++; name = '無題' + idx; }
    try {
      const res = await apiPost('/cal/schedule-templates', { name, entries: [], user: _getUser() });
      o.remove(); _editTemplate(dbPath, res.id);
    } catch { showStatus('作成に失敗', true); }
  });
}

function _addMinutes(timeStr, minutes) {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  const total = h * 60 + m + (minutes || 0);
  return _p2(Math.floor(total / 60) % 24) + ':' + _p2(total % 60);
}

async function _editTemplate(dbPath, tid) {
  let templates = [];
  try { templates = await apiFetch('/cal/schedule-templates?user=' + encodeURIComponent(_getUser())); } catch {}
  const t = templates.find(x => x.id === tid);
  if (!t) return;

  const o = document.createElement('div'); o.className = 'modal-overlay';
  let entriesHtml = '';
  (t.entries || []).forEach(e => { entriesHtml += _templateEntryRow(e); });

  o.innerHTML = `<div class="modal" style="min-width:550px;max-height:80vh;overflow-y:auto;">
    <h3>テンプレート編集: ${esc(t.name)}</h3>
    <div class="field"><label>名前</label><input id="tmpl-name" type="text" value="${esc(t.name)}"></div>
    <div style="font-size:12px;color:var(--fg2);margin-bottom:4px;">エントリ（1週間分）</div>
    <div id="tmpl-entries">${entriesHtml}</div>
    <button id="tmpl-add-entry" style="font-size:12px;padding:2px 8px;margin:4px 0;">+ エントリ追加</button>
    <div class="btn-row">
      <button id="tmpl-cancel">キャンセル</button>
      <button class="primary" id="tmpl-save">保存</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  o.querySelector('#tmpl-add-entry').addEventListener('click', () => { o.querySelector('#tmpl-entries').insertAdjacentHTML('beforeend', _templateEntryRow({})); });
  o.querySelector('#tmpl-cancel').addEventListener('click', () => { o.remove(); _showTemplateModal(dbPath); });
  o.querySelector('#tmpl-save').addEventListener('click', async () => {
    const name = o.querySelector('#tmpl-name').value.trim() || '無題';
    const entries = [];
    o.querySelectorAll('#tmpl-entries .tmpl-entry').forEach(row => {
      entries.push({
        dayOfWeek: parseInt(row.querySelector('[data-field="dayOfWeek"]').value),
        startTime: row.querySelector('[data-field="startTime"]').value,
        duration: parseInt(row.querySelector('[data-field="duration"]').value) || 60,
        title: row.querySelector('[data-field="title"]').value.trim(),
      });
    });
    try { await apiPut('/cal/schedule-templates/' + tid, { name, entries }); showStatus('テンプレートを保存しました'); } catch { showStatus('保存に失敗', true); }
    o.remove(); _showTemplateModal(dbPath);
  });
}

function _templateEntryRow(entry) {
  return `<div class="tmpl-entry" style="display:flex;gap:4px;align-items:center;margin-bottom:4px;font-size:12px;">
    <select data-field="dayOfWeek" class="gb-select gb-select-sm">
      ${_dayLabels.map((d,i) => `<option value="${i}" ${(entry?.dayOfWeek??0)===i?'selected':''}>${d}</option>`).join('')}
    </select>
    <input type="time" data-field="startTime" value="${entry?.startTime||'09:00'}" style="padding:2px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
    <input type="number" data-field="duration" value="${entry?.duration||60}" min="5" step="5" style="width:60px;padding:2px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;" title="分">
    <span style="color:var(--fg2);">分</span>
    <input type="text" data-field="title" value="${esc(entry?.title||'')}" placeholder="タイトル" style="flex:1;padding:2px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
    <button data-action="this.closest('.tmpl-entry').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;display:flex;align-items:center;">${lucide('x', 14)}</button>
  </div>`;
}

async function _generateFromTemplate(dbPath, tid, templates, modalEl) {
  const t = templates.find(x => x.id === tid);
  if (!t || !t.entries?.length) { showStatus('エントリがありません', true); return; }
  const weeks = parseInt(await cfPrompt('何週間分生成しますか？', '4')) || 0;
  if (weeks <= 0) return;
  const curDate = getCalendarDate(dbPath);
  const startDate = _weekStart(curDate);
  let count = 0;
  _calPushUndo('テンプレート一括生成');
  for (let w = 0; w < weeks; w++) {
    for (const entry of t.entries) {
      const d = new Date(startDate);
      const dayOffset = (entry.dayOfWeek - _calStartDay + 7) % 7;
      d.setDate(d.getDate() + w * 7 + dayOffset);
      const [h, m] = (entry.startTime || '09:00').split(':').map(Number);
      d.setHours(h, m, 0, 0);
      const endD = new Date(d.getTime() + (entry.duration || 60) * 60000);
      try {
        await apiPost('/calendar-db/events', {
          db_path: dbPath, title: entry.title || '無題',
          start: d.toISOString(), end: endD.toISOString(),
          creator: _getUser(), members: [],
        });
        count++;
      } catch {}
    }
  }
  if (modalEl) modalEl.remove();
  await selectDatabase(dbPath);
  showStatus(`${count}件のイベントを生成しました`);
}

/* ==============================
   同期モーダル（Google Calendar + iCal + CSV + テンプレート）
   ============================== */
function _showSyncModal(dbPath) {
  const o = document.createElement('div'); o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="min-width:500px;max-height:80vh;overflow-y:auto;">
    <h3>カレンダー同期・ツール</h3>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">Google Calendar</div>
      <div id="sync-google-status" style="font-size:12px;color:var(--fg2);margin-bottom:8px;">確認中...</div>
      <div id="sync-google-auth" style="display:none;">
        <div class="field"><label>Client ID</label><input id="sync-gcal-id" type="text" placeholder="Google Cloud Consoleで取得"></div>
        <div class="field"><label>Client Secret</label><input id="sync-gcal-secret" type="password"></div>
        <button id="sync-gcal-auth-btn" style="font-size:12px;padding:4px 12px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;cursor:pointer;">Google認証開始</button>
      </div>
      <div id="sync-google-actions" style="display:none;gap:4px;">
        <button id="sync-gcal-pull" style="font-size:12px;padding:4px 12px;">← Googleから取得</button>
        <button id="sync-gcal-push" style="font-size:12px;padding:4px 12px;">→ Googleに送信</button>
      </div>
    </div>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">iCal / .ics</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        <button id="sync-ical-import" style="font-size:12px;padding:4px 12px;">.icsインポート</button>
        <button id="sync-ical-export" style="font-size:12px;padding:4px 12px;">.icsエクスポート</button>
      </div>
      <div style="font-size:11px;color:var(--fg2);margin-top:4px;">iPhone・Outlook・Nextcloud等と互換</div>
    </div>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">勤怠CSVエクスポート</div>
      <div style="font-size:11px;color:var(--fg2);margin-bottom:6px;">打刻データを給与計算ソフト向けにCSV出力</div>
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:4px;">
        <label style="font-size:11px;">開始: <input id="csv-from" type="date" style="padding:2px;font-size:11px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;"></label>
        <label style="font-size:11px;">終了: <input id="csv-to" type="date" style="padding:2px;font-size:11px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;"></label>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        <button id="csv-generic" style="font-size:12px;padding:4px 12px;">汎用CSV</button>
        <button id="csv-smaregi" style="font-size:12px;padding:4px 12px;">スマレジ形式</button>
        <button id="csv-mf" style="font-size:12px;padding:4px 12px;">マネーフォワード形式</button>
      </div>
    </div>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">週間テンプレート</div>
      <button id="sync-templates" style="font-size:12px;padding:4px 12px;">テンプレート管理</button>
    </div>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">CalDAV (Radicale)</div>
      <div style="font-size:11px;color:var(--fg2);margin-bottom:6px;">CalDAVサーバーとの双方向同期</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">
        <button id="sync-caldav-push" style="font-size:12px;padding:4px 12px;">→ CalDAVに送信</button>
        <button id="sync-caldav-pull" style="font-size:12px;padding:4px 12px;">← CalDAVから取得</button>
      </div>
    </div>

    <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">SQLiteマイグレーション</div>
      <div style="font-size:11px;color:var(--fg2);margin-bottom:6px;">旧カレンダーデータ（SQLite）をファイルベースDBに変換</div>
      <button id="sync-migrate" style="font-size:12px;padding:4px 12px;">マイグレーション実行</button>
    </div>

    <div class="btn-row"><button data-action="this.closest('.modal-overlay').remove()">閉じる</button></div>
  </div>`;
  document.body.appendChild(o);

  // Google Calendar ステータス確認

/* Source chunk: gb-calendar.part03.js */
  (async () => {
    try {
      const status = await apiFetch('/cal/sync/status');
      const gStatus = o.querySelector('#sync-google-status');
      const gConnected = status.google?.connected;
      const gAvailable = status.google?.available;
      if (gConnected) {
        gStatus.innerHTML = 'ステータス: <span style="color:var(--green);">接続済み</span>';
        o.querySelector('#sync-google-actions').style.display = 'flex';
      } else if (gAvailable) {
        gStatus.textContent = 'ステータス: 未接続';
        o.querySelector('#sync-google-auth').style.display = '';
      } else {
        gStatus.innerHTML = 'ステータス: <span style="color:var(--red);">パッケージ未インストール</span>';
      }
    } catch { o.querySelector('#sync-google-status').textContent = 'ステータス確認に失敗'; }
  })();

  // Google認証
  const authBtn = o.querySelector('#sync-gcal-auth-btn');
  if (authBtn) authBtn.addEventListener('click', async () => {
    const id = o.querySelector('#sync-gcal-id')?.value.trim();
    const secret = o.querySelector('#sync-gcal-secret')?.value.trim();
    if (!id || !secret) { showStatus('Client IDとSecretを入力してください', true); return; }
    try { const res = await apiPost('/cal/sync/google/auth', { client_id: id, client_secret: secret }); showStatus(res.message || '認証成功'); o.remove(); _showSyncModal(dbPath); } catch (e) { showStatus('認証失敗', true); }
  });
  // Google Pull/Push
  o.querySelector('#sync-gcal-pull').addEventListener('click', async () => {
    showStatus('Googleカレンダーから取得中...');
    try { const res = await apiPost('/calendar-db/sync/google/pull', { db_path: dbPath }); showStatus(`取得完了: ${res.imported}件`); await selectDatabase(dbPath); } catch { showStatus('同期失敗', true); }
  });
  o.querySelector('#sync-gcal-push').addEventListener('click', async () => {
    showStatus('Googleカレンダーに送信中...');
    try { const res = await apiPost('/calendar-db/sync/google/push', { db_path: dbPath }); showStatus(`送信完了: ${res.pushed}件`); } catch { showStatus('送信失敗', true); }
  });

  // iCal
  o.querySelector('#sync-ical-import').addEventListener('click', () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.ics,.ical';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      const text = await file.text();
      try { const res = await apiPost('/calendar-db/ical/import', { db_path: dbPath, ics: text }); showStatus(`iCalインポート完了: ${res.imported}件`); o.remove(); await selectDatabase(dbPath); } catch { showStatus('インポート失敗', true); }
    };
    input.click();
  });
  o.querySelector('#sync-ical-export').addEventListener('click', async () => {
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
      showStatus('保存ダイアログを初期化できませんでした', true);
      return;
    }
    const baseName = (typeof MeldexExportSave.guessNameFromPath === 'function')
      ? MeldexExportSave.guessNameFromPath(dbPath, 'calendar')
      : 'calendar';
    const stem = String(baseName || 'calendar').replace(/\.[^.]+$/, '') || 'calendar';
    await MeldexExportSave.saveUrl('/api/calendar-db/ical/export?path=' + encodeURIComponent(dbPath), {
      filename: stem + '.ics',
      extension: '.ics',
      dialogTitle: 'iCal として保存',
      filetypes: [['iCalファイル', '*.ics'], ['すべてのファイル', '*.*']],
      okMessage: 'iCal を保存しました',
      errorMessage: 'iCal の保存に失敗しました',
      path: dbPath,
    });
  });

  // 勤怠CSV
  const now = new Date(), cy = now.getFullYear(), cm = now.getMonth();
  const csvFrom = o.querySelector('#csv-from'), csvTo = o.querySelector('#csv-to');
  csvFrom.value = `${cy}-${_p2(cm + 1)}-01`;
  csvTo.value = _dateStr(new Date(cy, cm + 1, 0));
  const csvExport = async (fmt) => {
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
      showStatus('保存ダイアログを初期化できませんでした', true);
      return;
    }
    const user = encodeURIComponent(_getUser());
    await MeldexExportSave.saveUrl(`/api/cal/export/attendance-csv?format=${fmt}&date_from=${csvFrom.value}&date_to=${csvTo.value}&user=${user}`, {
      filename: `attendance-${fmt}-${csvFrom.value || 'from'}_${csvTo.value || 'to'}.csv`,
      extension: '.csv',
      dialogTitle: '勤怠CSVとして保存',
      filetypes: [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']],
      okMessage: '勤怠CSVを保存しました',
      errorMessage: '勤怠CSVの保存に失敗しました',
    });
  };
  o.querySelector('#csv-generic').addEventListener('click', () => csvExport('generic'));
  o.querySelector('#csv-smaregi').addEventListener('click', () => csvExport('smaregi'));
  o.querySelector('#csv-mf').addEventListener('click', () => csvExport('moneyforward'));

  // テンプレート
  o.querySelector('#sync-templates').addEventListener('click', () => { o.remove(); _showTemplateModal(dbPath); });

  // CalDAV
  o.querySelector('#sync-caldav-push').addEventListener('click', async () => {
    showStatus('CalDAVに送信中...');
    try { const res = await apiPost('/calendar-db/caldav/sync-to-ics', { db_path: dbPath }); showStatus(`CalDAV送信完了: ${res.synced}件`); } catch { showStatus('CalDAV送信に失敗', true); }
  });
  o.querySelector('#sync-caldav-pull').addEventListener('click', async () => {
    showStatus('CalDAVから取得中...');
    try { const res = await apiPost('/calendar-db/caldav/sync-from-ics', { db_path: dbPath }); showStatus(`CalDAV取得完了: ${res.imported}件`); o.remove(); await selectDatabase(dbPath); } catch { showStatus('CalDAV取得に失敗', true); }
  });

  // SQLiteマイグレーション
  o.querySelector('#sync-migrate').addEventListener('click', async () => {
    try { const res = await apiPost('/calendar-db/migrate-from-sqlite', { db_path: dbPath }); showStatus(`マイグレーション完了: ${res.migrated}件`); o.remove(); await selectDatabase(dbPath); } catch { showStatus('マイグレーションに失敗', true); }
  });
}
