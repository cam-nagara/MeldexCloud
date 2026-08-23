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
        const avatars = typeof this._eventUserAvatarsHtml === 'function' ? this._eventUserAvatarsHtml(ev, 14) : '';
        html += `<div class="gb-cal-day-event gb-cal-all-day-event${this._eventSourceClass(ev)}" data-event-id="${_todoEsc(ev.id)}" data-calendar-id="${_todoEsc(ev.calendar_id || '_calendar')}" draggable="true" style="background:${this._sanitizeEventColor(ev.color)};color:var(--cal-event-fg, #fff);position:relative;margin:1px 0;" title="${_todoEsc(ev.title || '')}">${this._eventTitleContentHtml(ev)}${this._eventCardMenuHtml()}${avatars}</div>`;
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
})();
