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
