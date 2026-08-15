/* ==============================
   gb-tool-calendar-task-options.js: ToDo option form and CRUD
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined' || !window.MeldexCalendarOptions) return;
  const {
    _calEsc,
    _calOptionContainer,
    _calField,
  } = window.MeldexCalendarOptions;

  CalendarComponent.prototype._createTaskQuick = async function(options) {
    const opts = options || {};
    this._pushUndo('ToDo作成');
    try {
      const res = await apiPost('/cal/tasks', {
        title: '無題',
        status: opts.status || 'todo',
        priority: opts.priority || 'medium',
        due_date: opts.due_date || '',
        user: this._getUser(),
      });
      await this._loadTasks();
      this._render();
      this._renderTodayTasks();
      const id = res?.id || '';
      if (id) this._showTaskModal(id);
      this._showStatus('ToDoを追加しました');
      return id;
    } catch {
      this._showStatus('ToDo追加に失敗', true);
      return '';
    }
  };

  CalendarComponent.prototype._showTaskModal = function(editId, defaultStatus) {
    if (!editId) {
      this._createTaskQuick({ status: defaultStatus || 'todo' });
      return;
    }
    const task = this._tasks.find(t => t.id === editId);
    if (!task) return;
    this._showTaskOptionsPanel(task);
  };

  CalendarComponent.prototype._showTaskOptionsPanel = function(task) {
    const body = _calOptionContainer('ToDo設定');
    if (!body) return;
    body._calComponent = this;
    const statuses = [['backlog','バックログ'],['todo','未着手'],['in_progress','進行中'],['review','レビュー'],['done','完了']];
    const priorities = [['low','低'],['medium','中'],['high','高'],['urgent','緊急']];
    body.innerHTML = `
      ${_calField('タイトル', `<input data-cal-task-title data-e2e-id="cal-task-title" aria-label="ToDoタイトル" type="text" value="${_calEsc(task.title || '')}" placeholder="ToDo名">`)}
      ${_calField('ステータス', `<select data-cal-task-status data-e2e-id="cal-task-status" aria-label="ToDoステータス" class="gb-select">${statuses.map(([v,l]) => `<option value="${v}" ${(task.status || 'todo') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${_calField('優先度', `<select data-cal-task-priority data-e2e-id="cal-task-priority" aria-label="ToDo優先度" class="gb-select">${priorities.map(([v,l]) => `<option value="${v}" ${(task.priority || 'medium') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${_calField('期限', `<input data-cal-task-due data-e2e-id="cal-task-due" aria-label="ToDo期限" type="date" value="${_calEsc(task.due_date || '')}">`)}
      ${_calField('担当者', `<div style="display:flex;gap:4px;align-items:center;">
        <input data-cal-task-assignee data-e2e-id="cal-task-assignee" aria-label="ToDo担当者" type="text" value="${_calEsc(task.assignee || '')}" style="flex:1;min-width:0;">
        <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-cal-task-assignee-picker data-e2e-id="cal-task-assignee-picker" aria-label="担当者候補から選択" title="候補から選択">▾</button>
      </div>`)}
      <div class="cal-option-grid">
        ${_calField('見積(h)', `<input data-cal-task-est data-e2e-id="cal-task-estimated-hours" aria-label="ToDo見積時間" type="number" step="0.5" value="${_calEsc(task.estimated_hours || 0)}">`)}
        ${_calField('実績(h)', `<input data-cal-task-act data-e2e-id="cal-task-actual-hours" aria-label="ToDo実績時間" type="number" step="0.5" value="${_calEsc(task.actual_hours || 0)}">`)}
      </div>
      ${_calField('説明', `<textarea data-cal-task-desc data-e2e-id="cal-task-description" aria-label="ToDo説明" rows="3">${_calEsc(task.description || '')}</textarea>`)}
      <div class="cal-option-actions cal-option-actions--footer">
        <button type="button" class="danger" data-cal-task-delete data-e2e-id="cal-task-delete" aria-label="ToDoを削除">削除</button>
        <span></span>
        <button type="button" class="primary" data-cal-task-save data-e2e-id="cal-task-save" aria-label="ToDoを保存">保存</button>
      </div>`;
    body.querySelector('[data-cal-task-save]')?.addEventListener('click', () => this._saveTaskOptions(task.id, body));
    body.querySelector('[data-cal-task-delete]')?.addEventListener('click', () => this._deleteTaskFromOptions(task.id));
    // ToDo担当者はコンボ型ピッカー（候補選択+自由入力併用。ユーザーアカウント
    // 一元管理 計画書 Phase 3、§5.8）。既存の自由入力値は保存経路（value読み取り）
    // をそのまま使うため壊さない。
    body.querySelector('[data-cal-task-assignee-picker]')?.addEventListener('click', (event) => {
      const input = body.querySelector('[data-cal-task-assignee]');
      if (!input || !window.MeldexUserPicker) return;
      window.MeldexUserPicker.open(event.currentTarget, {
        value: input.value,
        allowFreeText: true,
        onCommit: (name) => { input.value = name; input.focus(); },
      });
    });
    setTimeout(() => body.querySelector('[data-cal-task-title]')?.focus(), 0);
  };

  CalendarComponent.prototype._saveTaskOptions = async function(editId, body) {
    this._pushUndo('ToDo編集');
    const data = {
      title: body.querySelector('[data-cal-task-title]')?.value || '無題',
      status: body.querySelector('[data-cal-task-status]')?.value || 'todo',
      priority: body.querySelector('[data-cal-task-priority]')?.value || 'medium',
      due_date: body.querySelector('[data-cal-task-due]')?.value || '',
      assignee: body.querySelector('[data-cal-task-assignee]')?.value || '',
      estimated_hours: parseFloat(body.querySelector('[data-cal-task-est]')?.value || '0') || 0,
      actual_hours: parseFloat(body.querySelector('[data-cal-task-act]')?.value || '0') || 0,
      description: body.querySelector('[data-cal-task-desc]')?.value || '',
      user: this._getUser(),
    };
    try {
      await apiPut('/cal/tasks/' + editId, data);
      await this._loadTasks();
      this._render();
      this._renderTodayTasks();
      this._showStatus('ToDoを保存しました');
    } catch {
      this._showStatus('保存に失敗', true);
    }
  };

  CalendarComponent.prototype._deleteTaskFromOptions = async function(id) {
    if (await this._deleteTask(id)) {
      const body = _calOptionContainer('カレンダー');
      if (body) body.innerHTML = '<div class="cal-option-empty">ToDoを削除しました</div>';
    }
  };
})();
