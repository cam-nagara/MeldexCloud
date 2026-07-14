/* ==============================
   gb-tool-calendar.js: CalendarComponent (v5.0 Phase C)
   calendar.html → JSモジュール変換
   ============================== */

class CalendarComponent extends ToolComponent {
  constructor(paneId, tabId) {
    super(paneId, tabId);
    this._view = 'month';
    this._date = new Date();
    this._events = [];
    this._tasks = [];
    this._calendars = [];
    this._visibleCalIds = new Set();
    this._selectedCalendarId = localStorage.getItem('gb:cal-selected-id') || '';
    this._shifts = [];
    this._undoStack = [];
    this._redoStack = [];
    this._undoLoadWindow = null;
    this._startDay = parseInt(localStorage.getItem('gb-cal-start-day') || '0');
    this._multiDayCount = this._normalizeMultiDayCount(localStorage.getItem('gb:cal-multi-day-count') || '3');
    this._selectedMiniDates = new Set();
    this._lastMiniDateStr = '';
    const sidebarMode = localStorage.getItem('gb:cal-sidebar-mode') || '';
    this._sidebarMode = sidebarMode || (localStorage.getItem('gb:cal-sidebar-only') === 'true' ? 'only' : 'all');
    this._sidebarOnly = this._sidebarMode === 'only';
    this._alarmInterval = null;
    this._alertedIds = new Set();
    this._clockEnabled = localStorage.getItem('gb:clock-enabled') === 'true';
    this._UNDO_MAX = 50;
    // DOM refs (set in create)
    this._contentEl = null;
    this._titleEl = null;
    this._sidebarEl = null;
    this._rightPanelEl = null;
    this._miniGridEl = null;
    this._miniTitleEl = null;
    this._todayTasksEl = null;
    this._calListEl = null;
    this._statusEl = null;
    this._clockBtnsEl = null;
    this._clockStatusEl = null;
    this._renderSeq = 0;
    this._initialized = false;
    this._initPromise = null;
    this._destroyed = false;
  }

  // === DOM生成 ===
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-cal-root';
    this.el.innerHTML = CalendarComponent._buildHTML(this._startDay, this._multiDayCount);
    // DOM refs
    this._contentEl = this.el.querySelector('.gb-cal-content');
    this._titleEl = this.el.querySelector('.gb-cal-title');
    this._sidebarEl = this.el.querySelector('.gb-cal-sidebar');
    this._rightPanelEl = this.el.querySelector('.gb-cal-right-panel');
    this._miniGridEl = this.el.querySelector('.gb-cal-mini-grid');
    this._miniTitleEl = this.el.querySelector('.gb-cal-mini-title');
    this._todayTasksEl = this.el.querySelector('.gb-cal-today-tasks');
    this._calListEl = this.el.querySelector('.gb-cal-list');
    this._statusEl = this.el.querySelector('.gb-cal-status');
    this._clockBtnsEl = this.el.querySelector('.gb-cal-clock-buttons');
    this._clockStatusEl = null;
    this._bindToolbar();
    this._bindSidebarResize();
    this._initClockPanel();
    if (typeof this._applySidebarMode === 'function') this._applySidebarMode();
    this._syncMultiDayControls();
    return this.el;
  }

  static _buildHTML(startDay, multiDayCount) {
    void startDay;
    return `<div class="gb-cal-status" role="status" aria-live="polite"></div>
<div class="gb-toolbar gb-toolbar-cal" role="toolbar" aria-label="カレンダー">
  <button type="button" class="tb-icon-btn tool-menu-btn" title="メニュー" aria-label="メニュー" aria-haspopup="menu" data-action="showToolMenu(event,'calendar')"><span class="ico ico-menu"></span></button>
  <button type="button" class="tb-icon-btn" title="フォルダツリーで表示" aria-label="フォルダツリーで表示" data-action="revealCurrentInFolderTree('calendar', event)"><span class="ico ico-folderTree"></span></button>
  <button type="button" class="tb-icon-btn" data-cal-action="toggleSidebar" title="スケジューラーサイドバー" aria-label="スケジューラーサイドバー"><span class="ico ico-panelLeft"></span></button>
  <div class="sep"></div>
  <button type="button" class="tb-icon-btn" data-cal-action="today" title="今日に戻る" aria-label="今日に戻る">${lucide('calendar', 16)}</button>
  <button type="button" class="tb-icon-btn" data-cal-action="prev" title="前へ" aria-label="前へ">${lucide('chevronLeft', 16)}</button>
  <span class="tb-title gb-cal-title">---</span>
  <button type="button" class="tb-icon-btn" data-cal-action="next" title="次へ" aria-label="次へ">${lucide('chevronRight', 16)}</button>
  <div class="sep"></div>
  <select class="tb-select gb-cal-view-select" title="表示" aria-label="表示" data-cal-setting="view">
    <option value="month">月</option>
    <option value="week">週</option>
    <option value="multi">複数日</option>
    <option value="day">日</option>
    <option value="tasks">ToDoリスト</option>
    <option value="shifts">シフト</option>
    <option value="clock12">アナログ時計（12時間）</option>
    <option value="clock24">アナログ時計（24時間）</option>
  </select>
  <input class="tb-input gb-cal-multi-day-count" type="number" min="2" max="14" step="1" value="${multiDayCount || 3}" title="表示日数" aria-label="表示日数" data-cal-setting="multi-day-count" style="width:48px;" hidden>
  <div class="tb-spacer"></div>
  <button type="button" class="tb-icon-btn" data-cal-action="openProductionTaskList" title="タスクリストシートを開く" aria-label="タスクリストシートを開く">${lucide('listTodo', 16)}</button>
  <button type="button" class="tb-icon-btn" data-cal-action="template" title="テンプレート" aria-label="テンプレート">${lucide('layoutTemplate', 16)}</button>
  <button type="button" class="tb-icon-btn" data-cal-action="timer" title="タイマー" aria-label="タイマー">${lucide('timer', 16)}</button>
  <div class="sep"></div>
  <button type="button" class="tb-icon-btn" data-cal-action="reload" title="再読み込み" aria-label="再読み込み"><span class="ico ico-refreshCw"></span></button>
  <button type="button" class="tb-icon-btn" data-cal-action="sync" title="同期" aria-label="同期"><span class="ico ico-refreshCw"></span></button>
  <button type="button" class="tb-icon-btn gb-toolbar-option-panel-btn" data-cal-action="detail" title="オプションを開く" aria-label="オプションを開く"><span class="ico ico-slidersHorizontal"></span></button>
</div>
<div class="gb-cal-main">
  <div class="gb-cal-sidebar">
    <div class="gb-cal-clock-panel">
      <div style="display:flex;align-items:center;margin-bottom:8px;">
        <span style="font-size:13px;font-weight:bold;flex:1;">打刻</span>
        <label style="font-size:11px;color:var(--cal-muted-fg, var(--fg2));cursor:pointer;display:flex;align-items:center;gap:3px;">
          <input type="checkbox" class="gb-cal-clock-toggle" data-cal-setting="clock-enabled" aria-label="打刻を有効にする"> 有効
        </label>
      </div>
      <div class="gb-cal-clock-buttons" style="display:none;">
        <button type="button" class="gb-cal-clock-btn clock-in" data-clock="clock_in" aria-label="出勤">出勤</button>
        <button type="button" class="gb-cal-clock-btn clock-out" data-clock="clock_out" aria-label="退勤">退勤</button>
        <button type="button" class="gb-cal-clock-btn break" data-clock="break_start" aria-label="離席">離席</button>
        <button type="button" class="gb-cal-clock-btn break" data-clock="break_end" aria-label="復帰">復帰</button>
      </div>
    </div>
    <div class="gb-cal-mini">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <button type="button" class="gb-cal-mini-nav" data-cal-action="miniPrev" title="前の月" aria-label="前の月">${lucide('chevronLeft', 12)}</button>
        <span class="gb-cal-mini-title" style="font-size:12px;font-weight:bold;"></span>
        <button type="button" class="gb-cal-mini-nav" data-cal-action="miniNext" title="次の月" aria-label="次の月">${lucide('chevronRight', 12)}</button>
      </div>
      <div class="gb-cal-mini-grid"></div>
    </div>
    <div><div class="gb-cal-sidebar-title-row"><span>今日のToDo</span><button type="button" data-cal-action="addTodayTask" class="gb-cal-sidebar-add-task" title="ToDo追加" aria-label="今日のToDoを追加">${lucide('plus', 16)}</button></div><div class="gb-cal-today-tasks" style="font-size:12px;"></div></div>
    <div style="margin-top:12px;">
      <div class="gb-cal-sidebar-title-row">
        <span>カレンダー</span>
        <button type="button" data-cal-action="createCalendar" class="gb-cal-sidebar-add-task gb-cal-sidebar-add-calendar" title="新規カレンダー" aria-label="新規カレンダー">${lucide('plus', 16)}</button>
      </div>
      <div class="gb-cal-list" style="font-size:12px;"></div>
    </div>
  </div>
  <div class="gb-cal-sidebar-resize"></div>
  <div class="gb-cal-content"></div>
  <div class="gb-cal-right-panel"></div>
</div>`;
  }

  _bindToolbar() {
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cal-action]');
      if (btn) { this._handleAction(btn.dataset.calAction, btn); return; }
      const viewBtn = e.target.closest('[data-cal-view]');
      if (viewBtn) { this.setView(viewBtn.dataset.calView); return; }
      const clockBtn = e.target.closest('[data-clock]');
      if (clockBtn) { this._clockAction(clockBtn.dataset.clock); return; }
    });
    const sel = this.el.querySelector('.gb-cal-start-day-sel');
    if (sel) sel.addEventListener('change', () => { this._startDay = parseInt(sel.value); localStorage.setItem('gb-cal-start-day', this._startDay); this._render(); this._renderMiniCal(); });
    const viewSel = this.el.querySelector('.gb-cal-view-select');
    if (viewSel) viewSel.addEventListener('change', () => this.setView(viewSel.value));
    const multiDayCount = this.el.querySelector('.gb-cal-multi-day-count');
    if (multiDayCount) {
      multiDayCount.addEventListener('change', () => {
        this._multiDayCount = this._normalizeMultiDayCount(multiDayCount.value);
        localStorage.setItem('gb:cal-multi-day-count', String(this._multiDayCount));
        this._selectedMiniDates.clear();
        this._lastMiniDateStr = '';
        if (this._view !== 'multi') this.setView('multi');
        else { this._syncMultiDayControls(); this._render(); this._renderMiniCal(); }
      });
    }
  }

  _openDetailPanel() {
    const panel = document.getElementById('right-panel');
    const activeTab = document.querySelector('.rp-tab.active')?.dataset.rpTab;
    const detailOpen = !!(panel?.classList.contains('open') && activeTab === 'detail');
    if (!detailOpen) {
      if (typeof toggleOptionPanel === 'function') toggleOptionPanel();
      else if (typeof toggleDetailPanel === 'function') toggleDetailPanel();
    }
    if (typeof this._syncDetailPanel === 'function') this._syncDetailPanel();
  }

  _handleAction(action, anchor) {
    switch (action) {
      case 'today':
        this._date = new Date();
        // ミニカレンダーの複数選択が残っていると表示が変わらないため、今日基準へ戻す
        this._selectedMiniDates?.clear?.();
        this._lastMiniDateStr = '';
        if (typeof this._persistViewToTabState === 'function') this._persistViewToTabState();
        this._loadEvents().then(() => this._render());
        this._renderMiniCal();
        break;
      case 'prev': this._goNav(-1); break;
      case 'next': this._goNav(1); break;
      case 'template': this._showScheduleTemplateModal(); break;
      case 'reload': this.reload(); break;
      case 'timer':
        if (typeof openTimerPanel === 'function') openTimerPanel();
        else if (typeof showStatus === 'function') showStatus('タイマーパネルを初期化できませんでした', true);
        break;
      case 'openProductionTaskList':
        if (typeof window.openProductionTaskListSheet === 'function') window.openProductionTaskListSheet();
        else if (typeof showStatus === 'function') showStatus('タスクリストシートを開けませんでした', true);
        break;
      case 'sync': this._showSyncModal(); break;
      case 'toggleSidebar': this._toggleSidebar(); break;
      case 'sidebarOnly': if (typeof this._setSidebarOnly === 'function') this._setSidebarOnly(!this._sidebarOnly); break;
      case 'detail': this._openDetailPanel(); break;
      case 'addTodayTask':
        if (typeof this._createTaskQuick === 'function') this._createTaskQuick({ status: 'todo', due_date: this._localDateStr() });
        else this._showTaskModal(null, 'todo');
        break;
      case 'miniPrev': this._addMonths(-1); this._renderMiniCal(); this._loadEvents().then(() => this._render()); break;
      case 'miniNext': this._addMonths(1); this._renderMiniCal(); this._loadEvents().then(() => this._render()); break;
      case 'createCalendar':
        if (typeof this._showCreateCalendarMenu === 'function') this._showCreateCalendarMenu(anchor);
        else this._createCalendar();
        break;
    }
  }

  _goNav(dir) {
    if (this._view === 'month') this._addMonths(dir);
    else if (this._view === 'week') this._date.setDate(this._date.getDate() + dir * 7);
    else if (this._view === 'multi') {
      const selected = this._selectedMiniDateList();
      if (selected.length > 1) this._shiftSelectedMiniDates(dir * selected.length);
      else this._date.setDate(this._date.getDate() + dir * this._multiDayCount);
    }
    else if (this._view === 'shifts') this._addMonths(dir); // シフト表は月単位の表のため月送り
    else this._date.setDate(this._date.getDate() + dir);
    this._loadEvents().then(() => this._render());
    this._renderMiniCal();
  }

  // === ライフサイクル ===
  activate() {
    const wasActive = this._active;
    super.activate();
    if (this._initPromise) return;
    if (this._initialized) {
      if (!wasActive) this._refreshAfterActivation();
      return;
    }
    this._initPromise = this._init().catch(error => {
      this._initialized = false;
      console.warn('[CalendarComponent] init failed:', error);
    }).finally(() => {
      this._initPromise = null;
    });
  }

  deactivate() {
    super.deactivate();
    // アラーム監視はタブ非表示中も継続する（停止すると裏で作業中に通知を取り逃すため、解除は destroy 時のみ）
    if (typeof this._clearNowLineTimer === 'function') this._clearNowLineTimer();
  }

  destroy() {
    this._destroyed = true;
    if (this._alarmInterval) clearInterval(this._alarmInterval);
    if (typeof this._clearNowLineTimer === 'function') this._clearNowLineTimer();
    super.destroy();
  }

  async _init() {
    if (this._initialized) return;
    this._initialized = true;
    await Promise.all([this._loadEvents(), this._loadTasks(), this._loadCalendars()]);
    if (this._destroyed || !this._active) return;
    this._refreshAfterActivation();
  }

  _refreshAfterActivation() {
    if (this._destroyed || !this._active) return;
    this._render();
    this._renderMiniCal();
    this._renderTodayTasks();
    this._updateClockStatus();
    this._ensureAlarmTimer();
  }

  _ensureAlarmTimer() {
    if (this._destroyed || !this._active) return;
    if (!this._alarmInterval) {
      this._alarmInterval = setInterval(() => this._checkAlarms(), 60000);
      setTimeout(() => this._checkAlarms(), 3000);
    }
  }

  handleKeyDown(e) {
    // テキスト入力中はカレンダーのアンドゥで横取りせず、入力欄のネイティブUndoに任せる
    const target = e.target;
    if (target instanceof Element && (target.closest('input, textarea, select') || target.isContentEditable)) return false;
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); return true; }
    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) { e.preventDefault(); this._redo(); return true; }
    return false;
  }

  // === 状態永続化 ===
  getState() {
    return {
      view: this._view,
      calendarPath: this.state.calendarPath || '',
      multiDayCount: this._multiDayCount,
      selectedMiniDates: this._selectedMiniDateList(),
    };
  }
  restoreState(s) {
    super.restoreState(s);
    if (s) {
      this._view = s.view || 'month';
      this.state.calendarPath = s.calendarPath || '';
      this._multiDayCount = this._normalizeMultiDayCount(s.multiDayCount || this._multiDayCount);
      this._selectedMiniDates = new Set(Array.isArray(s.selectedMiniDates) ? s.selectedMiniDates.filter(v => /^\d{4}-\d{2}-\d{2}$/.test(String(v))) : []);
      this._lastMiniDateStr = this._selectedMiniDateList()[0] || '';
    }
  }

  // === 公開API (postMessage置換) ===
  pushUndo(label) { this._pushUndo(label); }
  async reload() {
    await Promise.all([this._loadEvents(), this._loadTasks(), this._loadCalendars()]);
    this._render();
    this._renderMiniCal();
    this._renderTodayTasks();
  }

  // === ユーティリティ ===
  _getUser() { try { return JSON.parse(localStorage.getItem('meldex-user') || '{}').name || 'anonymous'; } catch { return 'anonymous'; } }
  _normalizeMultiDayCount(value) {
    const n = parseInt(value, 10);
    return Math.max(2, Math.min(14, Number.isFinite(n) ? n : 3));
  }
  _addMonths(delta) {
    const d = this._date;
    const originalDay = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + delta);
    d.setDate(Math.min(originalDay, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  _localDateStr(d) { if (!d) d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  _localDateTimeStr(d) {
    if (!d) d = new Date();
    return `${this._localDateStr(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  _parseLocalDate(dateStr) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!match) return new Date(dateStr);
    return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
  }
  _getDayNames() { const a = ['日','月','火','水','木','金','土']; return [...a.slice(this._startDay), ...a.slice(0, this._startDay)]; }
  _isCalVisible(ev) { if (this._calendars.length === 0 || !ev.calendar_id) return true; return this._visibleCalIds.has(ev.calendar_id); }

  _firstCalendar() {
    const calendars = this._calendars || [];
    const visible = calendars.filter(c => this._visibleCalIds?.has(c.id));
    return visible[0] || calendars[0] || null;
  }
  _selectedMiniDateList() {
    return [...(this._selectedMiniDates || new Set())].filter(v => /^\d{4}-\d{2}-\d{2}$/.test(String(v))).sort();
  }
  _multiDayDateStrs() {
    const selected = this._selectedMiniDateList();
    if (selected.length > 1) return selected;
    const out = [];
    const start = new Date(this._date);
    for (let i = 0; i < this._multiDayCount; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(this._localDateStr(d));
    }
    return out;
  }
  _shiftSelectedMiniDates(days) {
    const shifted = this._selectedMiniDateList().map(dateStr => {
      const d = this._parseLocalDate(dateStr);
      d.setDate(d.getDate() + days);
      return this._localDateStr(d);
    });
    this._selectedMiniDates = new Set(shifted);
    if (shifted[0]) this._date = this._parseLocalDate(shifted[0]);
    this._lastMiniDateStr = shifted[0] || '';
  }
  _syncMultiDayControls() {
    const input = this.el?.querySelector?.('.gb-cal-multi-day-count');
    if (!input) return;
    input.hidden = this._view !== 'multi';
    input.value = String(this._selectedMiniDateList().length > 1 ? this._selectedMiniDateList().length : this._multiDayCount);
  }
  _multiDayTitle() {
    const dates = this._multiDayDateStrs();
    if (!dates.length) return '複数日';
    const first = dates[0];
    const last = dates[dates.length - 1];
    return first === last ? first : `${first} – ${last}（${dates.length}日）`;
  }

  _selectedCalendar() {
    const calendars = this._calendars || [];
    if (this._selectedCalendarId) {
      const selected = calendars.find(c => c.id === this._selectedCalendarId);
      if (selected && this._visibleCalIds?.has(selected.id)) return selected;
    }
    return this._firstCalendar();
  }

  _calendarIdForNewEvent() {
    const cal = this._selectedCalendar() || this._firstCalendar();
    if (cal && !this._visibleCalIds.has(cal.id)) {
      this._visibleCalIds.add(cal.id);
      apiPut('/cal/calendars/' + cal.id, { visible: 1 }).catch(() => {});
      this._renderCalendarList?.();
    }
    return cal?.id || '';
  }

  _ensureSelectedCalendar() {
    const cal = this._selectedCalendar();
    this._selectedCalendarId = cal?.id || '';
    if (this._selectedCalendarId) localStorage.setItem('gb:cal-selected-id', this._selectedCalendarId);
    else localStorage.removeItem('gb:cal-selected-id');
    return cal;
  }

  _selectCalendar(id, options = {}) {
    const cal = (this._calendars || []).find(c => c.id === id);
    if (!cal) return null;
    this._selectedCalendarId = cal.id;
    localStorage.setItem('gb:cal-selected-id', cal.id);
    if (options.ensureVisible !== false && !this._visibleCalIds.has(cal.id)) {
      this._visibleCalIds.add(cal.id);
      apiPut('/cal/calendars/' + cal.id, { visible: 1 }).catch(() => {});
    }
    if (options.render !== false) {
      this._renderCalendarList();
      this._render();
    }
    return cal;
  }

  _showStatus(msg, isError) {
    if (this._statusEl) { this._statusEl.textContent = msg; this._statusEl.style.color = isError ? 'var(--red)' : 'var(--cal-muted-fg, var(--fg2))'; }
    // 親のshowStatusも呼ぶ
    if (typeof showStatus === 'function') showStatus(msg, isError);
  }

  // === データロード ===
  async _loadEvents() {
    const y = this._date.getFullYear(), m = this._date.getMonth();
    const start = new Date(y, m - 1, 1).toISOString();
    const end = new Date(y, m + 2, 0).toISOString();
    this._guardUndoLoadWindow(start + '|' + end, start, end);
    const seq = (this._loadEventsSeq = (this._loadEventsSeq || 0) + 1);
    try {
      const events = await apiFetch('/cal/events?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end) + '&user=' + encodeURIComponent(this._getUser()));
      if (seq !== this._loadEventsSeq) return; // 古い読み込み窓の応答は破棄（連打時の巻き戻り防止）
      this._events = events;
    } catch {
      if (seq !== this._loadEventsSeq) return;
      if (!Array.isArray(this._events)) this._events = [];
      this._showStatus('予定の読み込みに失敗', true);
    }
  }

  // 読み込み窓（表示期間）が変わったらアンドゥ履歴を破棄する。
  // 窓違いのスナップショット復元は、現在の窓にだけ存在する予定を巻き添え削除するため
  _guardUndoLoadWindow(windowKey, start, end) {
    if (this._undoWindowKey && this._undoWindowKey !== windowKey && (this._undoStack.length || this._redoStack.length)) {
      this._undoStack.length = 0;
      this._redoStack.length = 0;
      this._notifyParentHistory();
    }
    this._undoWindowKey = windowKey;
    this._undoLoadWindow = { key: windowKey, start, end };
  }

  async _loadTasks() {
    try {
      this._tasks = await apiFetch('/cal/tasks?user=' + encodeURIComponent(this._getUser()));
    } catch {
      if (!Array.isArray(this._tasks)) this._tasks = [];
      this._showStatus('ToDoリストの読み込みに失敗', true);
    }
  }

  async _loadCalendars() {
    try {
      this._calendars = await apiFetch('/cal/calendars?user=' + encodeURIComponent(this._getUser()));
      if (this._calendars.length === 0) {
        await apiPost('/cal/calendars', { name: 'マイカレンダー', color: '#569cd6', user: this._getUser() });
        this._calendars = await apiFetch('/cal/calendars?user=' + encodeURIComponent(this._getUser()));
      }
      this._visibleCalIds = new Set(this._calendars.filter(c => c.visible).map(c => c.id));
      this._ensureSelectedCalendar();
      this._renderCalendarList();
    } catch {}
  }

  // === Undo/Redo ===
  _eventIsUndoable(ev) {
    // 自動生成イベント（シフト・実績・制作タスク由来）は元データ側が正本のため undo 対象にしない
    // （対象にすると undo がミラーだけを通常イベントとして再作成し、実データと乖離した幽霊行が残る）
    return ev && !ev._recurrence_instance
      && !['shift', 'shift-break', 'attendance', 'production-task'].includes(String(ev.calendar_source || ''));
  }

  _snapshotEventsForUndo() {
    const seen = new Set();
    return (this._events || []).filter(ev => {
      if (!this._eventIsUndoable(ev) || !ev.id || seen.has(ev.id)) return false;
      seen.add(ev.id);
      return true;
    }).map(ev => JSON.parse(JSON.stringify(ev)));
  }

  _snapshotTasksForUndo() {
    return JSON.parse(JSON.stringify(this._tasks || []));
  }

  _snapshotEventWindowForUndo() {
    return this._undoLoadWindow ? { ...this._undoLoadWindow } : null;
  }

  _eventIntersectsUndoWindow(ev, windowInfo) {
    if (!windowInfo?.start || !windowInfo?.end) return true;
    const windowStart = Date.parse(windowInfo.start);
    const windowEnd = Date.parse(windowInfo.end);
    if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) return true;
    const eventStart = Date.parse(ev?.start || ev?.end || '');
    const eventEnd = Date.parse(ev?.end || ev?.start || '');
    if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) return true;
    return eventEnd >= windowStart && eventStart <= windowEnd;
  }

  _pushUndo(label) {
    this._undoStack.push({ label, events: this._snapshotEventsForUndo(), tasks: this._snapshotTasksForUndo(), eventWindow: this._snapshotEventWindowForUndo() });
    if (this._undoStack.length > this._UNDO_MAX) this._undoStack.shift();
    this._redoStack.length = 0;
    this._notifyParentHistory();
  }

  async _undo() {
    // 復元はサーバーへの逐次API呼び出しを伴う長い処理のため、完了まで再入を受け付けない
    if (!this._undoStack.length || this._undoBusy) return;
    this._undoBusy = true;
    try {
      this._redoStack.push({ label: '(現在)', events: this._snapshotEventsForUndo(), tasks: this._snapshotTasksForUndo(), eventWindow: this._snapshotEventWindowForUndo() });
      await this._restoreSnapshot(this._undoStack.pop());
      this._notifyParentHistory();
    } finally {
      this._undoBusy = false;
    }
  }

  async _redo() {
    if (!this._redoStack.length || this._undoBusy) return;
    this._undoBusy = true;
    try {
      this._undoStack.push({ label: '(現在)', events: this._snapshotEventsForUndo(), tasks: this._snapshotTasksForUndo(), eventWindow: this._snapshotEventWindowForUndo() });
      await this._restoreSnapshot(this._redoStack.pop());
      this._notifyParentHistory();
    } finally {
      this._undoBusy = false;
    }
  }

  async _restoreSnapshot(snap) {
    try {
      const snapEvents = (snap.events || []).filter(ev => this._eventIsUndoable(ev));
      const curEvents = (this._events || []).filter(ev => this._eventIsUndoable(ev));
      const snapEvIds = new Set(snapEvents.map(e => e.id));
      const curEvIds = new Set(curEvents.map(e => e.id));
      for (const ev of curEvents) {
        if (!snapEvIds.has(ev.id) && this._eventIntersectsUndoWindow(ev, snap.eventWindow)) {
          await apiFetch('/cal/events/' + ev.id, { method: 'DELETE' }).catch(() => {});
        }
      }
      for (const ev of snapEvents) {
        const { id, ...data } = ev; data.user = data.user || this._getUser();
        if (curEvIds.has(id)) {
          await apiPut('/cal/events/' + id, data).catch(() => {});
        } else {
          await apiPost('/cal/events', { ...data, id }).catch(() => apiPut('/cal/events/' + id, data).catch(() => {}));
        }
      }
      const snapTasks = snap.tasks || [];
      const snapTkIds = new Set(snapTasks.map(t => t.id));
      const curTkIds = new Set((this._tasks || []).map(t => t.id));
      for (const t of this._tasks || []) { if (!snapTkIds.has(t.id)) await apiFetch('/cal/tasks/' + t.id, { method: 'DELETE' }).catch(() => {}); }
      for (const t of snapTasks) {
        const { id, ...data } = t;
        if (curTkIds.has(id)) await apiPut('/cal/tasks/' + id, data).catch(() => {});
        else await apiPost('/cal/tasks', { ...data, id }).catch(() => {});
      }
      await this._loadEvents(); await this._loadTasks();
      this._render(); this._renderTodayTasks();
      this._showStatus('元に戻しました');
    } catch { this._showStatus('元に戻す操作に失敗', true); }
  }

  _notifyParentHistory() {
    if (typeof renderHistoryList === 'function') renderHistoryList();
  }

  // === ビュー切り替え ===
  setView(v) {
    this._view = v;
    // タブの永続状態へ即時反映。パネル再マウント時に restoreState が
    // 古い activeTab.state で _view を上書きしてしまう問題を防ぐ。
    this._persistViewToTabState(v);
    this.el.querySelectorAll('.gb-toolbar-cal [data-cal-view]').forEach(b => b.classList.remove('active'));
    const btn = this.el.querySelector(`[data-cal-view="${v}"]`);
    if (btn) btn.classList.add('active');
    const sel = this.el.querySelector('.gb-cal-view-select');
    if (sel && sel.value !== v) sel.value = v;
    this._syncMultiDayControls();
    this._render();
  }

  _persistViewToTabState(view) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return;
    try {
      const paneInfo = GBLayout.findNode?.(GBLayout.root, this.paneId);
      const tab = paneInfo?.node?.tabs?.find?.(t => t.id === this.tabId);
      if (!tab) return;
      if (!tab.state) tab.state = {};
      tab.state.view = view;
      tab.state.multiDayCount = this._multiDayCount;
      tab.state.selectedMiniDates = this._selectedMiniDateList();
    } catch {}
  }

  // === メイン描画 ===
  _render() {
    const renderSeq = ++this._renderSeq;
    const y = this._date.getFullYear(), m = this._date.getMonth(), d = this._date.getDate();
    this._titleEl.textContent =
      this._view === 'day' ? `${y}年${m+1}月${d}日` :
      this._view === 'week' ? `${y}年${m+1}月 第${Math.ceil(d/7)}週` :
      this._view === 'multi' ? this._multiDayTitle() :
      this._view === 'tasks' ? 'ToDoリスト' :
      this._view === 'shifts' ? `${y}年${m+1}月 シフト表` :
      `${y}年${m+1}月`;
    this._syncMultiDayControls();
    if (this._view === 'month') this._renderMonth();
    else if (this._view === 'week') this._renderWeek();
    else if (this._view === 'multi') this._renderMultiDays();
    else if (this._view === 'day') this._renderDay();
    else if (this._view === 'tasks') this._renderTaskBoard();
    else if (this._view === 'shifts') this._renderShiftView(renderSeq);
    if (!['week', 'multi', 'day'].includes(this._view) && typeof this._clearNowLineTimer === 'function') this._clearNowLineTimer();
    // Audit-P1 H-6 (残作業): カレンダーイベント要素にコメントバッジを描画
    if (this._contentEl && typeof CommentBadges !== 'undefined' && typeof CommentBadges.refreshCalendar === 'function') {
      try { CommentBadges.refreshCalendar(this._contentEl); } catch (_) {}
    }
  }

  // 以降の描画メソッドは gb-tool-calendar-views.js に定義
}

// コンポーネントレジストリ更新
window.CalendarComponent = CalendarComponent;
registerToolComponent('calendar', { cls: CalendarComponent, icon: 'calendar', label: 'スケジューラー', multi: true, requiresViewLock: true });
