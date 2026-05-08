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
    this._startDay = parseInt(localStorage.getItem('gb-cal-start-day') || '0');
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
  }

  // === DOM生成 ===
  create() {
    this.el = document.createElement('div');
    this.el.className = 'gb-cal-root';
    this.el.innerHTML = CalendarComponent._buildHTML(this._startDay);
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
    return this.el;
  }

  static _buildHTML(startDay) {
    void startDay;
    return `<div class="gb-cal-status"></div>
<div class="gb-toolbar gb-toolbar-cal">
  <button class="tb-icon-btn tool-menu-btn" title="メニュー" data-action="showToolMenu(event,'calendar')"><span class="ico ico-menu"></span></button>
  <button class="tb-icon-btn" title="フォルダツリーで表示" data-action="revealCurrentInFolderTree('calendar', event)"><span class="ico ico-folderTree"></span></button>
  <button class="tb-icon-btn" data-cal-action="toggleSidebar" title="カレンダーサイドバー"><span class="ico ico-panelLeft"></span></button>
  <div class="sep"></div>
  <button class="tb-icon-btn" data-cal-action="today" title="今日に戻る">${lucide('calendar', 16)}</button>
  <button class="tb-icon-btn" data-cal-action="prev" title="前へ">${lucide('chevronLeft', 16)}</button>
  <span class="tb-title gb-cal-title">---</span>
  <button class="tb-icon-btn" data-cal-action="next" title="次へ">${lucide('chevronRight', 16)}</button>
  <div class="sep"></div>
  <select class="tb-select gb-cal-view-select" title="表示">
    <option value="month">月</option>
    <option value="week">週</option>
    <option value="day">日</option>
    <option value="tasks">タスク</option>
    <option value="shifts">シフト</option>
    <option value="clock12">アナログ時計（12時間）</option>
    <option value="clock24">アナログ時計（24時間）</option>
  </select>
  <div class="tb-spacer"></div>
  <button class="tb-icon-btn" data-cal-action="template" title="テンプレート">${lucide('layoutTemplate', 16)}</button>
  <button class="tb-icon-btn" data-cal-action="timer" title="タイマー">${lucide('timer', 16)}</button>
  <div class="sep"></div>
  <button class="tb-icon-btn" data-cal-action="reload" title="再読み込み"><span class="ico ico-refreshCw"></span></button>
  <button class="tb-icon-btn" data-cal-action="sync" title="同期"><span class="ico ico-refreshCw"></span></button>
  <button class="tb-icon-btn" data-cal-action="settings" title="設定">${lucide('settings', 16)}</button>
</div>
<div class="gb-cal-main">
  <div class="gb-cal-sidebar">
    <div class="gb-cal-clock-panel">
      <div style="display:flex;align-items:center;margin-bottom:8px;">
        <span style="font-size:13px;font-weight:bold;flex:1;">打刻</span>
        <label style="font-size:11px;color:var(--cal-muted-fg, var(--fg2));cursor:pointer;display:flex;align-items:center;gap:3px;">
          <input type="checkbox" class="gb-cal-clock-toggle"> 有効
        </label>
      </div>
      <div class="gb-cal-clock-buttons" style="display:none;">
        <button class="gb-cal-clock-btn clock-in" data-clock="clock_in">出勤</button>
        <button class="gb-cal-clock-btn clock-out" data-clock="clock_out">退勤</button>
        <button class="gb-cal-clock-btn break" data-clock="break_start">離席</button>
        <button class="gb-cal-clock-btn break" data-clock="break_end">復帰</button>
      </div>
    </div>
    <div class="gb-cal-mini">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <button data-cal-action="miniPrev" style="background:none;border:none;color:var(--cal-muted-fg, var(--fg2));cursor:pointer;">${lucide('chevronLeft', 12)}</button>
        <span class="gb-cal-mini-title" style="font-size:12px;font-weight:bold;"></span>
        <button data-cal-action="miniNext" style="background:none;border:none;color:var(--cal-muted-fg, var(--fg2));cursor:pointer;">${lucide('chevronRight', 12)}</button>
      </div>
      <div class="gb-cal-mini-grid"></div>
    </div>
    <div><div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;"><span style="font-size:13px;font-weight:bold;flex:1;">今日のタスク</span><button data-cal-action="addTodayTask" class="gb-cal-sidebar-add-task" title="タスク追加">+</button></div><div class="gb-cal-today-tasks" style="font-size:12px;"></div></div>
    <div style="margin-top:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-size:13px;font-weight:bold;">カレンダー</span>
        <button data-cal-action="createCalendar" class="gb-cal-sidebar-add-task gb-cal-sidebar-add-calendar" title="新規カレンダー">+</button>
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
  }

  _handleAction(action, anchor) {
    switch (action) {
      case 'today': this._date = new Date(); this._loadEvents().then(() => this._render()); this._renderMiniCal(); break;
      case 'prev': this._goNav(-1); break;
      case 'next': this._goNav(1); break;
      case 'template': this._showScheduleTemplateModal(); break;
      case 'reload': this.reload(); break;
      case 'timer':
        if (typeof openTimerPanel === 'function') openTimerPanel();
        else if (typeof showStatus === 'function') showStatus('タイマーパネルを初期化できませんでした', true);
        break;
      case 'sync': this._showSyncModal(); break;
      case 'toggleSidebar': this._toggleSidebar(); break;
      case 'sidebarOnly': if (typeof this._setSidebarOnly === 'function') this._setSidebarOnly(!this._sidebarOnly); break;
      case 'settings': if (typeof this._showCalendarSettingsPanel === 'function') this._showCalendarSettingsPanel(); break;
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
    if (this._alarmInterval) { clearInterval(this._alarmInterval); this._alarmInterval = null; }
    if (typeof this._clearNowLineTimer === 'function') this._clearNowLineTimer();
  }

  destroy() {
    if (this._alarmInterval) clearInterval(this._alarmInterval);
    if (typeof this._clearNowLineTimer === 'function') this._clearNowLineTimer();
    super.destroy();
  }

  async _init() {
    if (this._initialized) return;
    this._initialized = true;
    await Promise.all([this._loadEvents(), this._loadTasks(), this._loadCalendars()]);
    this._refreshAfterActivation();
  }

  _refreshAfterActivation() {
    this._render();
    this._renderMiniCal();
    this._renderTodayTasks();
    this._updateClockStatus();
    this._ensureAlarmTimer();
  }

  _ensureAlarmTimer() {
    if (!this._alarmInterval) {
      this._alarmInterval = setInterval(() => this._checkAlarms(), 60000);
      setTimeout(() => this._checkAlarms(), 3000);
    }
  }

  handleKeyDown(e) {
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this._undo(); return true; }
    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) { e.preventDefault(); this._redo(); return true; }
    return false;
  }

  // === 状態永続化 ===
  getState() { return { view: this._view, calendarPath: this.state.calendarPath || '' }; }
  restoreState(s) { super.restoreState(s); if (s) { this._view = s.view || 'month'; this.state.calendarPath = s.calendarPath || ''; } }

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
    try {
      this._events = await apiFetch('/cal/events?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end) + '&user=' + encodeURIComponent(this._getUser()));
    } catch { this._events = []; }
  }

  async _loadTasks() { try { this._tasks = await apiFetch('/cal/tasks?user=' + encodeURIComponent(this._getUser())); } catch { this._tasks = []; } }

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
  _pushUndo(label) {
    this._undoStack.push({ label, events: JSON.parse(JSON.stringify(this._events)), tasks: JSON.parse(JSON.stringify(this._tasks)) });
    if (this._undoStack.length > this._UNDO_MAX) this._undoStack.shift();
    this._redoStack.length = 0;
    this._notifyParentHistory();
  }

  async _undo() {
    if (!this._undoStack.length) return;
    this._redoStack.push({ label: '(現在)', events: JSON.parse(JSON.stringify(this._events)), tasks: JSON.parse(JSON.stringify(this._tasks)) });
    await this._restoreSnapshot(this._undoStack.pop());
    this._notifyParentHistory();
  }

  async _redo() {
    if (!this._redoStack.length) return;
    this._undoStack.push({ label: '(現在)', events: JSON.parse(JSON.stringify(this._events)), tasks: JSON.parse(JSON.stringify(this._tasks)) });
    await this._restoreSnapshot(this._redoStack.pop());
    this._notifyParentHistory();
  }

  async _restoreSnapshot(snap) {
    try {
      const snapEvIds = new Set(snap.events.map(e => e.id));
      const curEvIds = new Set(this._events.map(e => e.id));
      for (const ev of this._events) { if (!snapEvIds.has(ev.id)) await apiFetch('/cal/events/' + ev.id, { method: 'DELETE' }).catch(() => {}); }
      for (const ev of snap.events) {
        const { id, ...data } = ev; data.user = data.user || this._getUser();
        if (curEvIds.has(id)) await apiPut('/cal/events/' + id, data).catch(() => {});
        else await apiPost('/cal/events', { ...data, id }).catch(() => {});
      }
      const snapTkIds = new Set(snap.tasks.map(t => t.id));
      const curTkIds = new Set(this._tasks.map(t => t.id));
      for (const t of this._tasks) { if (!snapTkIds.has(t.id)) await apiFetch('/cal/tasks/' + t.id, { method: 'DELETE' }).catch(() => {}); }
      for (const t of snap.tasks) {
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
    } catch {}
  }

  // === メイン描画 ===
  _render() {
    const renderSeq = ++this._renderSeq;
    const y = this._date.getFullYear(), m = this._date.getMonth(), d = this._date.getDate();
    this._titleEl.textContent =
      this._view === 'day' ? `${y}年${m+1}月${d}日` :
      this._view === 'week' ? `${y}年${m+1}月 第${Math.ceil(d/7)}週` :
      this._view === 'tasks' ? 'タスクボード' :
      this._view === 'shifts' ? `${y}年${m+1}月 シフト表` :
      `${y}年${m+1}月`;
    if (this._view === 'month') this._renderMonth();
    else if (this._view === 'week') this._renderWeek();
    else if (this._view === 'day') this._renderDay();
    else if (this._view === 'tasks') this._renderTaskBoard();
    else if (this._view === 'shifts') this._renderShiftView(renderSeq);
    if (!['week', 'day'].includes(this._view) && typeof this._clearNowLineTimer === 'function') this._clearNowLineTimer();
    // Audit-P1 H-6 (残作業): カレンダーイベント要素にコメントバッジを描画
    if (this._contentEl && typeof CommentBadges !== 'undefined' && typeof CommentBadges.refreshCalendar === 'function') {
      try { CommentBadges.refreshCalendar(this._contentEl); } catch (_) {}
    }
  }

  // 以降の描画メソッドは gb-tool-calendar-views.js に定義
}

// コンポーネントレジストリ更新
registerToolComponent('calendar', { cls: CalendarComponent, icon: 'calendar', label: 'カレンダー', multi: true, requiresViewLock: true });
