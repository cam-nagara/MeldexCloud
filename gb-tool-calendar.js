/* ==============================
   gb-tool-calendar.js: CalendarComponent (v5.0 Phase C)
   calendar.html → JSモジュール変換
   ============================== */

class CalendarComponent extends ToolComponent {
  constructor(paneId, tabId) {
    super(paneId, tabId);
    this._view = 'month';
    // _view は月・週・ToDoなどカレンダー内の表示形式を保持する。
    // 制作タスクリストは同名の既存ToDoと混同しないよう、独立した surface で切り替える。
    this._surface = 'calendar';
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
    if (typeof this._bindProductionTemplateDnD === 'function') this._bindProductionTemplateDnD();
    this._bindSidebarResize();
    this._initClockPanel();
    if (typeof this._applySidebarMode === 'function') this._applySidebarMode();
    this._syncMultiDayControls();
    return this.el;
  }

  static _buildHTML(startDay, multiDayCount) {
    void startDay;
    return `<div class="gb-cal-status" role="status" aria-live="polite"></div>
<div class="gb-toolbar gb-toolbar-cal" role="toolbar" aria-label="スケジュール">
  <button type="button" class="tb-icon-btn tool-menu-btn" title="メニュー" aria-label="メニュー" aria-haspopup="menu" data-action="showToolMenu(event,'calendar')"><span class="ico ico-menu"></span></button>
  <button type="button" class="tb-icon-btn" title="フォルダツリーで表示" aria-label="フォルダツリーで表示" data-action="revealCurrentInFolderTree('calendar', event)"><span class="ico ico-folderTree"></span></button>
  <button type="button" class="tb-icon-btn gb-cal-calendar-control" data-cal-action="toggleSidebar" title="スケジュールサイドバー" aria-label="スケジュールサイドバー"><span class="ico ico-panelLeft"></span></button>
  <div class="sep"></div>
  <div class="gb-cal-surface-switch" role="tablist" aria-label="表示するシート">
    <button type="button" role="tab" class="tb-text-btn gb-inner-tab gb-cal-surface-btn gb-inner-tab-active" data-production-tab="calendar" data-cal-surface="calendar" data-e2e-id="gb-cal-surface-calendar" aria-selected="true" tabindex="0" title="カレンダーを表示">${lucide('calendarDays', 14)}<span class="gb-inner-tab-label">カレンダー</span></button>
    <button type="button" role="tab" class="tb-text-btn gb-inner-tab gb-cal-surface-btn" data-production-tab="tasks" data-cal-surface="productionTasks" data-e2e-id="gb-cal-surface-production-tasks" aria-selected="false" tabindex="-1" title="タスクリストを表示">${lucide('listTodo', 14)}<span class="gb-inner-tab-label">タスクリスト</span></button>
    <button type="button" role="tab" class="tb-text-btn gb-inner-tab gb-cal-surface-btn" data-production-tab="works" data-production-managed-list="works" data-e2e-id="gb-cal-surface-managed-works" aria-selected="false" tabindex="-1" title="プロジェクト一覧を表示">${lucide('folderKanban', 14)}<span class="gb-inner-tab-label">プロジェクト一覧</span></button>
  </div>
  <div class="sep gb-cal-calendar-control"></div>
  <button type="button" class="tb-icon-btn gb-cal-calendar-control" data-cal-action="today" title="今日に戻る" aria-label="今日に戻る">${lucide('calendar', 16)}</button>
  <button type="button" class="tb-icon-btn gb-cal-calendar-control" data-cal-action="prev" title="前へ" aria-label="前へ">${lucide('chevronLeft', 16)}</button>
  <span class="tb-title gb-cal-title gb-cal-calendar-control">---</span>
  <button type="button" class="tb-icon-btn gb-cal-calendar-control" data-cal-action="next" title="次へ" aria-label="次へ">${lucide('chevronRight', 16)}</button>
  <div class="sep gb-cal-calendar-control"></div>
  <select class="tb-select gb-cal-view-select gb-cal-calendar-control" title="表示" aria-label="表示" data-cal-setting="view">
    <option value="month">月</option>
    <option value="week">週</option>
    <option value="multi">複数日</option>
    <option value="day">日</option>
    <option value="tasks">ToDoリスト</option>
    <option value="shifts">シフト</option>
    <option value="clock12">アナログ時計（12時間）</option>
    <option value="clock24">アナログ時計（24時間）</option>
  </select>
  <input class="tb-input gb-cal-multi-day-count gb-cal-calendar-control" type="number" min="2" max="14" step="1" value="${multiDayCount || 3}" title="表示日数" aria-label="表示日数" data-cal-setting="multi-day-count" style="width:48px;" hidden>
  <div class="tb-spacer"></div>
  <div class="gb-cal-toolbar-actions">
    <button type="button" class="tb-icon-btn gb-cal-calendar-control" data-cal-action="undo" title="元に戻す (Ctrl+Z)" aria-label="元に戻す" data-undo-button><span class="ico ico-undo2"></span></button>
    <button type="button" class="tb-icon-btn gb-cal-calendar-control" data-cal-action="redo" title="やり直し (Ctrl+Y)" aria-label="やり直し" data-redo-button><span class="ico ico-redo2"></span></button>
    <div class="sep gb-cal-calendar-control"></div>
    <button type="button" class="tb-icon-btn gb-cal-production-control" data-cal-action="sheetAutoFit" data-e2e-id="gb-production-sheet-auto-fit" title="列幅自動調整" aria-label="列幅自動調整"><span class="ico ico-columns3"></span></button>
    <button type="button" class="tb-icon-btn gb-cal-production-control" data-cal-action="sheetColumnDisplayOrder" data-e2e-id="gb-production-sheet-column-display-order" title="列の表示と順序" aria-label="列の表示と順序"><span class="ico ico-listChecks"></span></button>
    <button type="button" class="tb-icon-btn gb-cal-production-control" data-cal-action="sheetFilter" data-e2e-id="gb-production-sheet-filter" title="フィルタ" aria-label="フィルタ"><span class="ico ico-filter"></span></button>
    <button type="button" class="tb-icon-btn gb-cal-production-control" data-cal-action="sheetSort" data-e2e-id="gb-production-sheet-sort" title="並び替え" aria-label="並び替え" aria-haspopup="menu"><span class="ico ico-arrowUpDown"></span></button>
    <div class="sep gb-cal-production-control"></div>
    <button type="button" class="tb-icon-btn gb-cal-production-control" data-cal-action="bulkCreateTasks" data-e2e-id="gb-production-bulk-create-open" data-production-write-action="1" title="タスクを一括作成" aria-label="タスクを一括作成">${lucide('listPlus', 16)}</button>
    <button type="button" class="tb-icon-btn gb-cal-production-control" data-cal-action="recalculate" data-e2e-id="gb-production-task-recalculate" title="自動割り当て" aria-label="自動割り当て">${lucide('calculator', 16)}</button>
    <button type="button" class="tb-icon-btn gb-cal-production-control" data-cal-action="productionManagement" data-e2e-id="gb-production-management-open" title="管理操作" aria-label="管理操作">${lucide('settings2', 16)}</button>
    <button type="button" class="tb-icon-btn" data-cal-action="template" title="テンプレート" aria-label="テンプレート" data-e2e-id="gb-production-open-templates">${lucide('layoutTemplate', 16)}</button>
    <button type="button" class="tb-icon-btn gb-cal-calendar-control" data-cal-action="timer" title="タイマー" aria-label="タイマー">${lucide('timer', 16)}</button>
    <div class="sep gb-cal-calendar-control"></div>
    <button type="button" class="tb-icon-btn" data-cal-action="reload" title="再読み込み" aria-label="再読み込み" data-e2e-id="gb-production-task-refresh"><span class="ico ico-refreshCw"></span></button>
    <button type="button" class="tb-icon-btn gb-cal-calendar-control" data-cal-action="sync" title="同期" aria-label="同期"><span class="ico ico-calendarSync"></span></button>
    <button type="button" class="tb-icon-btn gb-toolbar-option-panel-btn" data-cal-action="detail" title="オプションを開く" aria-label="オプションを開く"><span class="ico ico-slidersHorizontal"></span></button>
  </div>
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
      const surfaceBtn = e.target.closest('button[data-production-tab]');
      if (surfaceBtn) {
        const key = surfaceBtn.dataset.productionTab;
        if (typeof this._selectProductionTab === 'function') this._selectProductionTab(key);
        else this.setSurface(key === 'calendar' ? 'calendar' : 'productionTasks');
        return;
      }
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
    const surfaceSwitch = this.el.querySelector('.gb-cal-surface-switch');
    surfaceSwitch?.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...surfaceSwitch.querySelectorAll('[role="tab"]')].filter(tab => !tab.disabled);
      const current = event.target.closest('[role="tab"]');
      const index = tabs.indexOf(current);
      if (index < 0 || !tabs.length) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
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
      case 'template':
        if (this._surface === 'productionTasks' && window.MeldexProductionSidebar?.showTemplates) {
          window.MeldexProductionSidebar.showTemplates(this);
        } else {
          this._showScheduleTemplateModal();
        }
        break;
      case 'bulkCreateTasks':
        if (window.MeldexProductionUiAvailability?.ensureWritable?.() === false) break;
        if (this._surface === 'productionTasks' && typeof this._openProductionTaskCreate === 'function') {
          this._openProductionTaskCreate(anchor);
        }
        break;
      case 'recalculate':
        if (this._surface === 'productionTasks' && typeof this._openProductionRecalculate === 'function') {
          this._openProductionRecalculate(anchor);
        }
        break;
      case 'productionManagement':
        if (this._surface === 'productionTasks') window.MeldexProductionSidebar?.showActions?.(this);
        break;
      case 'sheetAutoFit':
      case 'sheetColumnDisplayOrder':
      case 'sheetFilter':
      case 'sheetSort':
        if (this._surface === 'productionTasks' && typeof this._runProductionSheetDisplayAction === 'function') {
          this._runProductionSheetDisplayAction(action, anchor);
        }
        break;
      case 'undo': if (typeof meldexUndo === 'function') meldexUndo(); break;
      case 'redo': if (typeof meldexRedo === 'function') meldexRedo(); break;
      case 'reload': this.reload(); break;
      case 'timer':
        if (typeof openTimerPanel === 'function') openTimerPanel();
        else if (typeof showStatus === 'function') showStatus('タイマーパネルを初期化できませんでした', true);
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
    if (typeof this._syncHistoryScope === 'function') this._syncHistoryScope();
    if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
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
      surface: this._surface,
      calendarPath: this.state.calendarPath || '',
      multiDayCount: this._multiDayCount,
      selectedMiniDates: this._selectedMiniDateList(),
      productionTaskSelection: this.state.productionTaskSelection || null,
      productionTaskLastSheetName: this.state.productionTaskLastSheetName || '',
    };
  }
  restoreState(s) {
    super.restoreState(s);
    if (s) {
      this._view = s.view || 'month';
      this._surface = s.surface === 'productionTasks' ? 'productionTasks' : 'calendar';
      this.state.calendarPath = s.calendarPath || '';
      this._multiDayCount = this._normalizeMultiDayCount(s.multiDayCount || this._multiDayCount);
      this._selectedMiniDates = new Set(Array.isArray(s.selectedMiniDates) ? s.selectedMiniDates.filter(v => /^\d{4}-\d{2}-\d{2}$/.test(String(v))) : []);
      this._lastMiniDateStr = this._selectedMiniDateList()[0] || '';
    }
  }

  // === 公開API (postMessage置換) ===
  pushUndo(label) { this._pushUndo(label); }
  async reload() {
    const requests = [this._loadEvents(), this._loadTasks(), this._loadCalendars()];
    if (this._surface === 'productionTasks' && typeof this._refreshProductionTaskEmbed === 'function') {
      requests.push(this._refreshProductionTaskEmbed());
    }
    await Promise.all(requests);
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
      if (seq !== this._loadEventsSeq) return { ok: true, stale: true }; // 古い読み込み窓の応答は破棄（連打時の巻き戻り防止）
      this._events = events;
      return { ok: true, stale: false };
    } catch (error) {
      if (seq !== this._loadEventsSeq) return { ok: true, stale: true };
      if (!Array.isArray(this._events)) this._events = [];
      this._showStatus('予定の読み込みに失敗', true);
      return { ok: false, stale: false, error };
    }
  }

  // 読み込み窓（表示期間）が変わったらアンドゥ履歴を破棄する。
  // 窓違いのスナップショット復元は、現在の窓にだけ存在する予定を巻き添え削除するため
  _guardUndoLoadWindow(windowKey, start, end) {
    if (this._undoWindowKey && this._undoWindowKey !== windowKey && this._hasUndoHistoryEntries()) {
      this._clearUndoStacks();
      this._notifyParentHistory();
    }
    this._undoWindowKey = windowKey;
    this._undoLoadWindow = { key: windowKey, start, end };
  }

  // 共通履歴（'schedule:<tabId>' スコープ）と自己完結スタックの両方をまたいで
  // 「取り消せる/やり直せる操作が何かあるか」を判定する（表示期間変更時の破棄要否判定用）。
  _hasUndoHistoryEntries() {
    if (this._undoStack.length || this._redoStack.length) return true;
    if (typeof _schedHasCommonHistory === 'function' && _schedHasCommonHistory() && typeof _historyStacks !== 'undefined') {
      const stack = _historyStacks[_schedHistoryScope(this)];
      if (stack && (stack.undo.length || stack.redo.length)) return true;
    }
    return false;
  }

  // 共通履歴のこのタブ用スコープと、自己完結スタックの両方をクリアする
  // （ボードの bdClearUndoStacks() と同じ二重クリア方式。表示期間変更時に呼ばれる）。
  _clearUndoStacks() {
    if (typeof _schedHasCommonHistory === 'function' && _schedHasCommonHistory() && typeof _historyStacks !== 'undefined') {
      const stack = _historyStacks[_schedHistoryScope(this)];
      if (stack) { stack.undo.length = 0; stack.redo.length = 0; }
    }
    this._undoStack.length = 0;
    this._redoStack.length = 0;
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

  // v0.6.199: 共通履歴（gb-history.js）が読み込まれている環境（本体アプリ）では
  // 'schedule:<tabId>' スコープの共通履歴（historyPush）へ委譲し、右パネルの操作履歴タブ・
  // 操作履歴パネルの両方と連動する。共通履歴が無い環境（将来の単独起動・テストスタブ向けの保険。
  // 現状このコンポーネントを読み込む単独起動アプリは存在しない）は、従来どおり
  // this._undoStack/_redoStack の自己完結スタックへ自動フォールバックし挙動を変えない。
  _pushUndo(label) {
    if (typeof _schedHasCommonHistory === 'function' && _schedHasCommonHistory()) {
      const snap = { events: this._snapshotEventsForUndo(), tasks: this._snapshotTasksForUndo(), eventWindow: this._snapshotEventWindowForUndo() };
      historyPush(label, () => this._restoreSnapshot(snap), null, _schedHistoryScope(this));
    } else {
      this._undoStack.push({ label, events: this._snapshotEventsForUndo(), tasks: this._snapshotTasksForUndo(), eventWindow: this._snapshotEventWindowForUndo() });
      if (this._undoStack.length > this._UNDO_MAX) this._undoStack.shift();
      this._redoStack.length = 0;
    }
    this._notifyParentHistory();
  }

  async _undo() {
    // 復元はサーバーへの逐次API呼び出しを伴う長い処理のため、完了まで再入を受け付けない。
    // 共通履歴経路でも「component._undo()/_redo() を経由する限り」このガードで多重実行を防ぐ
    // （historyUndo() 自体は scope の stack.pop() を同期的に行うため、ガード無しで連打すると
    // 2件目の復元が1件目と並行実行され、レストア対象のずれや redo スタックの不整合を招く）。
    if (typeof _schedHasCommonHistory === 'function' && _schedHasCommonHistory()) {
      if (this._undoBusy) return;
      this._undoBusy = true;
      try { await historyUndo(_schedHistoryScope(this)); }
      finally { this._undoBusy = false; }
      return;
    }
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
    if (typeof _schedHasCommonHistory === 'function' && _schedHasCommonHistory()) {
      if (this._undoBusy) return;
      this._undoBusy = true;
      try { await historyRedo(_schedHistoryScope(this)); }
      finally { this._undoBusy = false; }
      return;
    }
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
      // 一時ID・保存未確定（saving/confirming/retrying/unsaved）のイベントは
      // まだサーバーに存在しないか状態が確定していないため、アンドゥ/リドゥの
      // DELETE・POST・PUT対象から除外する（送信するとサーバー側で不整合を招く）。
      const isPending = ev => window.MeldexCalendarSaveQueue?.isPendingEvent?.(ev) || false;
      const snapEvents = (snap.events || []).filter(ev => this._eventIsUndoable(ev) && !isPending(ev));
      const curEvents = (this._events || []).filter(ev => this._eventIsUndoable(ev) && !isPending(ev));
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
    this._surface = 'calendar';
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

  setSurface(surface, onConfirmed) {
    const next = surface === 'productionTasks' ? 'productionTasks' : 'calendar';
    if (this._surface === next) {
      this._syncSurfaceControls();
      return true;
    }
    const applySurface = () => {
      this._surface = next;
      this._persistViewToTabState(this._view);
      this._syncSurfaceControls();
      this._render();
      if (typeof this._syncHistoryScope === 'function') this._syncHistoryScope();
      if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
    };
    if (next === 'productionTasks') {
      const canSwitch = window.MeldexProductionSidebar?.prepareTaskListSurface?.(this, () => {
        applySurface();
        onConfirmed?.();
      });
      if (canSwitch === false) return false;
    }
    applySurface();
    return true;
  }

  _syncSurfaceControls() {
    if (!this.el) return;
    this.el.dataset.calSurface = this._surface;
    const activeKey = this._surface === 'calendar'
      ? 'calendar'
      : (typeof this._productionActiveTabKey === 'function' ? this._productionActiveTabKey() : 'tasks');
    let activeButton = null;
    this.el.querySelectorAll('[data-production-tab]').forEach(button => {
      const active = button.dataset.productionTab === activeKey;
      button.classList.toggle('gb-inner-tab-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
      if (active) activeButton = button;
    });
    // The tab list wraps like Sheet view tabs.  Do not retain a legacy horizontal
    // scroll offset: every production surface remains visible at once.
    const tablist = this.el.querySelector('.gb-cal-surface-switch');
    if (activeButton && tablist) tablist.scrollLeft = 0;
  }

  _persistViewToTabState(view) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return;
    try {
      const paneInfo = GBLayout.findNode?.(GBLayout.root, this.paneId);
      const tab = paneInfo?.node?.tabs?.find?.(t => t.id === this.tabId);
      if (!tab) return;
      if (!tab.state) tab.state = {};
      tab.state.view = view;
      tab.state.surface = this._surface;
      tab.state.multiDayCount = this._multiDayCount;
      tab.state.selectedMiniDates = this._selectedMiniDateList();
      tab.state.productionTaskSelection = this.state.productionTaskSelection || null;
      tab.state.productionTaskLastSheetName = this.state.productionTaskLastSheetName || '';
    } catch {}
  }

  // === メイン描画 ===
  _render() {
    const renderSeq = ++this._renderSeq;
    this._syncSurfaceControls();
    if (this._surface === 'productionTasks') {
      this._titleEl.textContent = '';
      this._syncMultiDayControls();
      if (typeof this._clearNowLineTimer === 'function') this._clearNowLineTimer();
      if (typeof this._renderProductionTaskView === 'function') this._renderProductionTaskView();
      else this._contentEl.textContent = 'タスクリストを初期化しています…';
      return;
    }
    if (typeof this._hideProductionTaskEmbed === 'function') this._hideProductionTaskEmbed();
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

/* ==============================
   v0.6.199: 「スケジュール」タブ本体（系統(A) CalendarComponent）の取り消し・やり直しを
   共通履歴（gb-history.js）へ統合するための補助関数。

   背景: 2026-07-19 に判明した既存不具合（AGENT_INBOX参照）— CalendarComponentは
   独自の this._undoStack/_redoStack を持つが、Ctrl+Z・ツールバーボタンのどちらからも
   到達できず、かつシートの「カレンダー表示モード」用の別系統(_calUndoStack, 系統(B))へ
   誤ってルーティングされていた。本ファイルの _pushUndo/_undo/_redo（上記）を
   'schedule:<tabId>' スコープの共通履歴へ統合し、gb-history.part02.js 側のルーターで
   このスコープを優先解決することで、系統(A)自身の予定/ToDo編集がCtrl+Z・ツールバー
   ボタン・履歴パネルの3経路すべてから機能するようにする（系統(B)は無変更）。

   スコープの接頭辞は 'calendar:' ではなく 'schedule:' を採用する。理由:
   gb-tool-calendar-options.js は既に 'calendar:settings'（サイドバー表示・週開始曜日等の
   localStorage設定変更用スコープ）を使っており、historyRegisterSnapshotProvider の
   マッチングは scope.startsWith(prefix) の前方一致で行われるため、'calendar:' を
   プレフィックス登録すると 'calendar:settings' にも誤って一致してしまう
   （設定変更のredoクロージャがスナップショット・プロバイダで上書きされ、
   設定変更のやり直しが壊れる）。'schedule:' なら前方一致の衝突が無い。

   tabId は getComponentInstance()/setComponentInstance() のキーと同一の値を使うため、
   スコープ文字列からコンポーネントインスタンスを逆引きできる（複数のスケジュールタブを
   同時に開いても、タブごとに独立した取り消し履歴になる）。
   ============================== */
function _schedHasCommonHistory() {
  return typeof historyPush === 'function' && typeof historyUndo === 'function' && typeof historyRedo === 'function';
}
function _schedHistoryScope(component) {
  return 'schedule:' + (component && component.tabId ? component.tabId : '');
}
function _schedComponentForScope(scope) {
  if (!scope || typeof scope !== 'string' || !scope.startsWith('schedule:')) return null;
  const tabId = scope.slice('schedule:'.length);
  if (!tabId || typeof getComponentInstance !== 'function') return null;
  const comp = getComponentInstance(tabId);
  return (comp && typeof CalendarComponent !== 'undefined' && comp instanceof CalendarComponent) ? comp : null;
}
// gb-history.part02.js の historyRegisterSnapshotProvider('schedule:', {...}) から呼ばれる
// capture/restore の実処理。既存の _snapshotXForUndo() 3点セット・_restoreSnapshot() を
// そのまま再利用し、挙動（何を保存し何を復元するか）は自己完結スタック時代と変えていない。
function _schedCaptureSnapshot(scope) {
  const comp = _schedComponentForScope(scope);
  if (!comp) return null;
  return {
    events: comp._snapshotEventsForUndo(),
    tasks: comp._snapshotTasksForUndo(),
    eventWindow: comp._snapshotEventWindowForUndo(),
  };
}
async function _schedRestoreSnapshot(snap, scope) {
  const comp = _schedComponentForScope(scope);
  if (!comp || snap == null) return;
  await comp._restoreSnapshot(snap);
}

// コンポーネントレジストリ更新
window.CalendarComponent = CalendarComponent;
registerToolComponent('calendar', { cls: CalendarComponent, icon: 'calendar', label: 'スケジュール', multi: true, requiresViewLock: true });
