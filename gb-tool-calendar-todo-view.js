/* ==============================
   gb-tool-calendar-todo-view.js: ToDoのカレンダー終日帯表示
   gb-tool-calendar-views.js のプロトタイプ拡張
   ============================== */
(function() {
  if (typeof CalendarComponent === 'undefined') return;

  const STATUS_ORDER = { backlog: 0, todo: 1, in_progress: 2, review: 3, done: 4 };
  const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

  function _todoEsc(value) {
    return MeldexEscape.html(value);
  }

  function _todoIcon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 10) : '';
  }

  function _todoDueDate(task) {
    return String(task?.due_date || '').trim().slice(0, 10);
  }

  function _todoPriorityStyle(task) {
    const priority = String(task?.priority || 'medium');
    if (priority === 'urgent') return { bg: 'var(--cal-task-priority-urgent-bg, var(--red))', fg: 'var(--cal-event-fg, var(--ui-fg-strong))' };
    if (priority === 'high') return { bg: 'var(--cal-task-priority-high-bg, var(--orange))', fg: 'var(--cal-event-fg, var(--ui-fg-strong))' };
    if (priority === 'medium') return { bg: 'var(--cal-task-priority-medium-bg, var(--blue))', fg: 'var(--cal-event-fg, var(--ui-fg-strong))' };
    return { bg: 'var(--cal-control-bg, var(--bg3))', fg: 'var(--cal-task-fg, var(--fg))' };
  }

  function _todoForDay(component, dateStr) {
    return (component?._tasks || [])
      .filter(task => task && !task.parent_id && _todoDueDate(task) === dateStr)
      .sort((a, b) =>
        ((STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)) ||
        ((PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99)) ||
        String(a.title || '').localeCompare(String(b.title || ''))
      );
  }

  function _todoChipHtml(component, task) {
    const style = _todoPriorityStyle(task);
    const title = task?.title || '無題';
    return `<div class="gb-cal-day-event gb-cal-all-day-task" data-task-id="${_todoEsc(task?.id || '')}" style="background:${style.bg};color:${style.fg};" title="${_todoEsc(title)}">` +
      `<span class="gb-cal-event-source-icon">${_todoIcon('checkSquare', 10)}</span><span class="gb-cal-event-title">${_todoEsc(title)}</span></div>`;
  }

  CalendarComponent.prototype._todoForAllDayStrip = function(dateStr) {
    return _todoForDay(this, dateStr);
  };

  CalendarComponent.prototype._todoAllDayChipHtml = function(task) {
    return _todoChipHtml(this, task);
  };

  CalendarComponent.prototype._allDayStripHtml = function(dateStrs) {
    const cols = Array.isArray(dateStrs) && dateStrs.length ? dateStrs : [];
    if (!cols.length) return '';
    let html = `<div class="gb-cal-all-day-strip" style="display:grid;grid-template-columns:60px repeat(${cols.length}, minmax(0,1fr));border-bottom:1px solid var(--cal-grid-line, var(--border));">`;
    html += '<div class="gb-cal-week-time" style="padding-top:6px;">終日</div>';
    cols.forEach(dateStr => {
      html += `<div class="gb-cal-all-day-cell" data-date="${dateStr}" style="min-height:30px;padding:2px;border-left:1px solid var(--cal-grid-line, var(--border));">`;
      this._allDayEventsForDay(dateStr).forEach(ev => {
        const avatars = typeof this._eventUserAvatarsHtml === 'function' ? this._eventUserAvatarsHtml(ev, 16) : '';
        html += `<div class="gb-cal-day-event gb-cal-all-day-event${this._eventSourceClass(ev)}" data-event-id="${_todoEsc(ev.id)}" data-calendar-id="${_todoEsc(ev.calendar_id || '_calendar')}" draggable="true" style="background:${this._sanitizeEventColor(ev.color)};color:var(--cal-event-fg, #fff);position:relative;margin:1px 0;" title="${_todoEsc(ev.title || '')}">${this._eventTitleContentHtml(ev)}${this._eventCardMenuHtml(ev, 'all-day-' + dateStr)}${avatars}</div>`;
      });
      this._todoForAllDayStrip(dateStr).forEach(task => {
        if (task?.id) html += this._todoAllDayChipHtml(task);
      });
      html += '</div>';
    });
    return html + '</div>';
  };

  const _baseBindAllDayStripEvents = CalendarComponent.prototype._bindAllDayStripEvents;
  CalendarComponent.prototype._bindAllDayStripEvents = function(rootEl) {
    if (typeof _baseBindAllDayStripEvents === 'function') _baseBindAllDayStripEvents.call(this, rootEl);
    rootEl.querySelectorAll('.gb-cal-all-day-task[data-task-id]').forEach(taskEl => {
      taskEl.addEventListener('click', event => {
        event.stopPropagation();
        this._showTaskModal(taskEl.dataset.taskId);
      });
    });
  };
  // ToDoリスト: カードを別の列へドラッグすると状態が変わる（マニュアル「ステータス変更」。M-014 で未実装を発見）。
  // 保存の後でだけ取り消しの履歴に積み、失敗したら元の列へ戻して原因を出す。
  const _baseRenderTaskBoard = CalendarComponent.prototype._renderTaskBoard;
  CalendarComponent.prototype._renderTaskBoard = function(...args) {
    const result = _baseRenderTaskBoard?.apply(this, args);
    const el = this._contentEl;
    if (!el) return result;
    el.querySelectorAll('.gb-cal-task-card[data-task-id]').forEach(card => {
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', event => {
        event.dataTransfer?.setData('text/x-meldex-cal-task', card.dataset.taskId || '');
        event.dataTransfer?.setData('text/plain', card.dataset.taskId || '');
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        card.classList.add('is-dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    });
    el.querySelectorAll('.gb-cal-task-column').forEach(column => {
      const status = column.querySelector('[data-add-task]')?.dataset.addTask || '';
      if (!status) return;
      column.dataset.taskStatus = status;
      column.addEventListener('dragover', event => {
        const types = Array.from(event.dataTransfer?.types || []);
        if (!types.includes('text/x-meldex-cal-task')) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        column.classList.add('is-drop-target');
      });
      column.addEventListener('dragleave', event => {
        if (!column.contains(event.relatedTarget)) column.classList.remove('is-drop-target');
      });
      column.addEventListener('drop', event => {
        const id = event.dataTransfer?.getData('text/x-meldex-cal-task') || '';
        column.classList.remove('is-drop-target');
        if (!id) return;
        event.preventDefault();
        this._moveTaskToStatus(id, status);
      });
    });
    return result;
  };

  CalendarComponent.prototype._moveTaskToStatus = async function(id, status) {
    const task = (this._tasks || []).find(item => item.id === id);
    if (!task || task.status === status) return false;
    if (!this._savingTaskIds) this._savingTaskIds = new Set();
    if (this._savingTaskIds.has(id)) {
      this._showStatus('保存中です。少し待ってからもう一度お試しください');
      return false;
    }
    const undoSnapshot = typeof this._captureUndoSnapshot === 'function' ? this._captureUndoSnapshot() : undefined;
    const previous = task.status;
    task.status = status;
    this._render();
    this._savingTaskIds.add(id);
    try {
      const { id: _id, created, modified, external_id, task_source, last_synced, ...data } = task;
      const save = apiPut('/cal/tasks/' + encodeURIComponent(id), { ...data, status, user: this._getUser() });
      await (globalThis.MeldexDiagnostics?.watchScheduleTask || ((op, task) => task))('todo-save', save);
    } catch (error) {
      task.status = previous;
      this._render();
      this._showStatus('ToDoの状態を変更できませんでした: ' + (error?.userMessage || error?.message || error), true);
      return false;
    } finally {
      this._savingTaskIds.delete(id);
    }
    this._pushUndo('ToDo編集', undoSnapshot);
    try { await this._loadTasks(); } catch {}
    this._render();
    this._renderTodayTasks?.();
    this._showStatus('ToDoの状態を変更しました');
    return true;
  };
})();
