/* gb-tool-calendar-production-templates.js: production task template cards and D&D */
(function() {
  'use strict';

  const MIME = 'application/x-meldex-production-task-template';
  const CONTAINER_STATE = new WeakMap();
  const FIELDS = [
    ['タスク名', 'タスク名', 'text'],
    ['単位レベル1', '大分類の初期値', 'text'],
    ['単位レベル2', '中分類の初期値', 'text'],
    ['単位レベル3', '小分類の初期値', 'text'],
    ['作業対象リスト', '作業対象', 'text'],
    ['作業内容リスト', '作業内容', 'text'],
    ['作業規模リスト', '作業規模', 'text'],
    ['担当者', '担当者', 'text'],
    ['目標作業時間_値', '目標時間（時間）', 'number'],
    ['対象色', '色', 'color'],
    ['優先度', '優先度', 'priority'],
    ['備考', '備考', 'textarea'],
  ];

  function api() {
    if (!window.MeldexProductionApi) throw new Error('制作管理APIを初期化できませんでした');
    return window.MeldexProductionApi;
  }

  function icon(name, size = 14) {
    const span = document.createElement('span');
    span.className = 'gb-production-template-icon';
    if (typeof lucide === 'function') span.innerHTML = lucide(name, size);
    return span;
  }

  function status(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
  }

  function prop(row, name) {
    return row?.properties?.[name] ?? '';
  }

  function durationMinutes(value, fallback = 60) {
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes > 0 ? Math.max(15, Math.round(minutes)) : fallback;
  }

  function templateDurationMinutes(row) {
    const hours = Number(prop(row, '目標作業時間_値'));
    return Number.isFinite(hours) && hours > 0 ? durationMinutes(hours * 60) : 60;
  }

  function templatePayload(row) {
    return {
      templateId: String(row?.id || ''),
      templatePath: String(row?.path || ''),
      version: String(row?.modified || ''),
      durationMinutes: templateDurationMinutes(row),
    };
  }

  function hasDrag(dataTransfer) {
    return !!dataTransfer && Array.from(dataTransfer.types || []).includes(MIME);
  }

  function readDrag(dataTransfer) {
    if (!hasDrag(dataTransfer)) return null;
    try {
      const parsed = JSON.parse(dataTransfer.getData(MIME) || '{}');
      if (!parsed.templateId && !parsed.templatePath) return null;
      return {
        templateId: String(parsed.templateId || ''),
        templatePath: String(parsed.templatePath || ''),
        version: String(parsed.version || ''),
        durationMinutes: durationMinutes(parsed.durationMinutes),
      };
    } catch {
      return null;
    }
  }

  function writeDrag(event, row) {
    const payload = templatePayload(row);
    event.dataTransfer.setData(MIME, JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', prop(row, 'テンプレート名') || row.name || 'タスクテンプレート');
    event.dataTransfer.effectAllowed = 'copy';
  }

  function localDateTime(component, date) {
    if (typeof component?._localDateTimeStr === 'function') return component._localDateTimeStr(date).substring(0, 16);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function roundedNow(component) {
    const date = new Date();
    date.setSeconds(0, 0);
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15);
    return localDateTime(component, date);
  }

  function workTitles(options = {}) {
    const meta = options.workMeta || options.component?._productionTaskState?.workMeta || {};
    return Object.keys(meta).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  }

  function chooseWork(works, preferred = '') {
    const choices = Array.from(new Set((works || []).filter(Boolean)));
    if (preferred) return Promise.resolve(preferred);
    if (choices.length === 1) return Promise.resolve(choices[0]);
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'gb-production-work-dialog';
      dialog.setAttribute('aria-labelledby', 'gb-production-work-dialog-title');
      const title = document.createElement('strong');
      title.id = 'gb-production-work-dialog-title';
      title.textContent = '追加先の作品を選択';
      const description = document.createElement('p');
      description.textContent = '複数作品を表示しているため、タスクを追加する作品を選んでください。';
      let control;
      if (choices.length) {
        control = document.createElement('select');
        choices.forEach(choice => {
          const option = document.createElement('option');
          option.value = choice;
          option.textContent = choice;
          control.appendChild(option);
        });
      } else {
        control = document.createElement('input');
        control.type = 'text';
        control.placeholder = '作品名';
      }
      control.setAttribute('aria-label', '作品');
      const actions = document.createElement('div');
      actions.className = 'gb-production-dialog-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'キャンセル';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'primary';
      confirm.textContent = '選択';
      actions.append(cancel, confirm);
      dialog.append(title, description, control, actions);
      const finish = value => {
        try { dialog.close(); } catch {}
        dialog.remove();
        resolve(value || '');
      };
      cancel.addEventListener('click', () => finish(''));
      confirm.addEventListener('click', () => finish(control.value.trim()));
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(''); });
      document.body.appendChild(dialog);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      control.focus();
    });
  }

  function makeButton(label, iconName, handler, primary = false, writeAction = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-production-template-button' + (primary ? ' primary' : '');
    button.append(icon(iconName), document.createTextNode(label));
    button.addEventListener('click', handler);
    if (writeAction) window.MeldexProductionUiAvailability?.markWriteControl?.(button);
    return button;
  }

  async function instantiate(row, surface, options, drop = {}) {
    if (window.MeldexProductionUiAvailability?.ensureWritable?.() === false) return null;
    const component = options.component || window.MeldexCalendarOptionPanel?.findCalendarComponent?.();
    if (!component?._createProductionTaskFromTemplate) {
      status('スケジュールのタスクリストを開いてから追加してください', true);
      return null;
    }
    const context = options.contextProvider?.() || {};
    return component._createProductionTaskFromTemplate(templatePayload(row), { surface, ...drop }, context);
  }

  function placementForm(row, state, options) {
    const box = document.createElement('div');
    box.className = 'gb-production-template-placement';
    const title = document.createElement('strong');
    title.textContent = 'カレンダーへ配置';
    const work = document.createElement('select');
    work.setAttribute('aria-label', '作品');
    const workList = workTitles(options);
    const selectedWork = options.contextProvider?.()?.workTitle || options.component?._productionTaskState?.filters?.work || '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '作品を選択';
    work.appendChild(emptyOption);
    workList.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      work.appendChild(option);
    });
    work.value = selectedWork;
    const start = document.createElement('input');
    start.type = 'datetime-local';
    start.value = roundedNow(options.component);
    start.setAttribute('aria-label', '開始日時');
    const duration = document.createElement('input');
    duration.type = 'number';
    duration.min = '15';
    duration.step = '15';
    duration.value = String(templateDurationMinutes(row));
    duration.setAttribute('aria-label', '時間（分）');
    [work, start, duration].forEach(control => window.MeldexProductionUiAvailability?.markWriteControl?.(control));
    const actions = document.createElement('div');
    actions.className = 'gb-production-template-card-actions';
    actions.append(
      makeButton('キャンセル', 'x', () => { state.placementPath = ''; render(state.container, options); }),
      makeButton('配置', 'calendarPlus', async (event) => {
        const button = event.currentTarget;
        if (!start.value) {
          status('開始日時を入力してください', true);
          start.focus();
          return;
        }
        button.disabled = true;
        const startDate = new Date(start.value);
        const minutes = Math.max(15, Number(duration.value || 60));
        const endDate = new Date(startDate.getTime() + minutes * 60000);
        const context = options.contextProvider?.() || {};
        const previousWorkTitle = context.workTitle || '';
        const selectedWorkTitle = work.value || previousWorkTitle;
        if (previousWorkTitle && selectedWorkTitle !== previousWorkTitle) context.classification = {};
        context.workTitle = selectedWorkTitle;
        try {
          if (!options.component?._createProductionTaskFromTemplate) {
            status('スケジュールのタスクリストを開いてから配置してください', true);
            return;
          }
          const created = await options.component._createProductionTaskFromTemplate(
            templatePayload(row),
            { surface: 'calendar', start: start.value, end: localDateTime(options.component, endDate), duration_minutes: minutes },
            context
          );
          if (!created) return;
          state.placementPath = '';
          await render(state.container, options);
        } catch (error) {
          status(error?.message || 'テンプレートをカレンダーへ配置できませんでした', true);
        } finally {
          button.disabled = false;
        }
      }, true, true)
    );
    box.append(title, work, start, duration, actions);
    return box;
  }

  function templateCard(row, state, options) {
    const card = document.createElement('article');
    card.className = 'gb-production-template-card';
    card.draggable = true;
    card.dataset.templatePath = row.path || '';
    card.dataset.e2eId = 'gb-production-template-card';
    window.MeldexProductionUiAvailability?.markWriteDrag?.(card);
    card.addEventListener('dragstart', event => {
      if (window.MeldexProductionUiAvailability?.ensureWritable?.() === false) {
        event.preventDefault();
        return;
      }
      writeDrag(event, row);
    });
    const header = document.createElement('div');
    header.className = 'gb-production-template-card-header';
    const grip = icon('gripVertical', 14);
    grip.setAttribute('aria-hidden', 'true');
    const title = document.createElement('strong');
    title.textContent = prop(row, 'テンプレート名') || row.name || '名称未設定';
    header.append(grip, title);
    const summary = document.createElement('p');
    summary.textContent = [prop(row, '作業内容リスト'), prop(row, '作業規模リスト'), prop(row, '目標作業時間_値') ? `${prop(row, '目標作業時間_値')}時間` : ''].filter(Boolean).join(' · ') || '詳細未設定';
    const actions = document.createElement('div');
    actions.className = 'gb-production-template-card-actions';
    const isManagedList = !!options.contextProvider?.()?.isManagedList;
    const addToListButton = makeButton('リストへ追加', 'listPlus', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try { await instantiate(row, 'list', options); } finally { button.disabled = false; }
    }, true, true);
    addToListButton.dataset.e2eId = 'gb-production-template-add-to-list';
    if (isManagedList) {
      addToListButton.disabled = true;
      addToListButton.title = '管理リストの表示中はタスクへ追加できません。タスクリストを選択してください';
    }
    const addToCalendarButton = makeButton('カレンダーへ', 'calendarPlus', () => {
        state.placementPath = state.placementPath === row.path ? '' : row.path;
        render(state.container, options);
      }, false, true);
    addToCalendarButton.dataset.e2eId = 'gb-production-template-add-to-calendar';
    const editButton = makeButton('編集', 'pencil', () => {
        state.editing = row;
        render(state.container, options);
      }, false, true);
    editButton.dataset.e2eId = 'gb-production-template-edit';
    actions.append(addToListButton, addToCalendarButton, editButton);
    card.append(header, summary, actions);
    if (state.placementPath === row.path) card.appendChild(placementForm(row, state, options));
    return card;
  }

  function fieldControl(name, type, value, options = {}) {
    const label = document.createElement('label');
    label.className = 'gb-production-template-field';
    const text = document.createElement('span');
    text.textContent = name;
    let control;
    if (type === 'textarea') control = document.createElement('textarea');
    else if (type === 'priority') {
      control = document.createElement('select');
      ['', '低', '通常', '高', '最優先'].forEach(priority => {
        const option = document.createElement('option');
        option.value = priority;
        option.textContent = priority || '未設定';
        control.appendChild(option);
      });
    }
    else {
      control = document.createElement('input');
      control.type = type;
      if (type === 'number') {
        control.step = options.step || '1';
        if (options.min) control.min = options.min;
      }
    }
    control.value = value || (type === 'color' ? '#569cd6' : '');
    label.append(text, control);
    return { label, control };
  }

  function editor(state, options) {
    const row = state.editing || null;
    const form = document.createElement('form');
    form.className = 'gb-production-template-editor';
    form.dataset.e2eId = 'gb-production-template-editor';
    const title = document.createElement('strong');
    title.textContent = row ? 'テンプレートを編集' : 'テンプレートを作成';
    const nameField = fieldControl('テンプレート名', 'text', prop(row, 'テンプレート名') || row?.name || '');
    nameField.control.required = true;
    const controls = new Map();
    const grid = document.createElement('div');
    grid.className = 'gb-production-template-fields';
    grid.appendChild(nameField.label);
    FIELDS.forEach(([key, label, type]) => {
      const numberOptions = key === '目標作業時間_値' ? { step: '0.25', min: '0.25' } : {};
      const field = fieldControl(label, type, prop(row, key), numberOptions);
      controls.set(key, field.control);
      grid.appendChild(field.label);
    });
    const actions = document.createElement('div');
    actions.className = 'gb-production-template-card-actions';
    const cancel = makeButton('キャンセル', 'x', () => { state.editing = undefined; render(state.container, options); });
    cancel.type = 'button';
    const save = makeButton('保存', 'save', () => {}, true, true);
    save.type = 'submit';
    actions.append(cancel, save);
    form.append(title, grid, actions);
    window.MeldexProductionUiAvailability?.markWriteForm?.(form);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const name = nameField.control.value.trim();
      if (!name) return;
      const properties = { 'テンプレート名': name };
      controls.forEach((control, key) => { properties[key] = control.value; });
      const editorRenderSeq = state.renderSeq;
      save.disabled = true;
      try {
        if (row) await api().patchTemplate({ path: row.path, id: row.id, properties });
        else await api().createTemplate({ name, properties });
        state.loaded = false;
        status('タスクテンプレートを保存しました');
        if (editorRenderSeq === state.renderSeq) {
          state.editing = undefined;
          await render(state.container, options);
        }
      } catch (error) {
        status(error?.message || 'タスクテンプレートを保存できませんでした', true);
      } finally {
        save.disabled = false;
      }
    });
    return form;
  }

  async function render(container, options = {}) {
    if (!container) return;
    const state = CONTAINER_STATE.get(container) || { container, rows: [], loaded: false, editing: undefined, placementPath: '', renderSeq: 0 };
    state.container = container;
    state.renderSeq = Number(state.renderSeq || 0);
    const renderSeq = ++state.renderSeq;
    CONTAINER_STATE.set(container, state);
    container.replaceChildren();
    const header = document.createElement('div');
    header.className = 'gb-production-template-toolbar';
    const help = document.createElement('p');
    help.innerHTML = 'テンプレート ' + fieldHelp('カードをタスクリストの分類、またはカレンダーの日付・時間へドラッグできます。');
    const add = makeButton('テンプレートを作成', 'plus', () => {
      state.editing = null;
      render(container, options);
    }, true, true);
    add.dataset.e2eId = 'gb-production-template-create';
    header.append(help, add);
    container.appendChild(header);
    if (state.editing !== undefined) {
      container.appendChild(editor(state, options));
      return;
    }
    if (!state.loaded) {
      const loading = document.createElement('div');
      loading.className = 'cal-option-empty';
      loading.textContent = 'テンプレートを読み込み中…';
      container.appendChild(loading);
      try {
        const data = await api().templates();
        if (renderSeq !== state.renderSeq) return;
        state.rows = data?.rows || [];
        state.loaded = true;
      } catch (error) {
        if (renderSeq !== state.renderSeq) return;
        loading.textContent = `テンプレートを読み込めません: ${error?.message || error}`;
        add.disabled = true;
        add.title = '制作管理APIに接続できないため作成できません';
        return;
      }
      loading.remove();
    }
    if (renderSeq !== state.renderSeq) return;
    const list = document.createElement('div');
    list.className = 'gb-production-template-list';
    if (!state.rows.length) {
      const empty = document.createElement('div');
      empty.className = 'cal-option-empty';
      empty.textContent = 'テンプレートはまだありません。「テンプレートを作成」から追加できます。';
      list.appendChild(empty);
    } else {
      state.rows.forEach(row => list.appendChild(templateCard(row, state, options)));
    }
    container.appendChild(list);
  }

  function calendarDrop(component, target, event, targetDurationMinutes = 60) {
    const cell = target.closest?.('.gb-cal-week-cell[data-date][data-hour], .gb-cal-all-day-cell[data-date], .gb-cal-day[data-date]');
    if (!cell) return null;
    const date = cell.dataset.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
    let hour = 9;
    let minute = 0;
    if (cell.classList.contains('gb-cal-week-cell')) {
      hour = Math.max(0, Math.min(23, Number(cell.dataset.hour || 0)));
      const rect = cell.getBoundingClientRect();
      const ratio = rect.height ? Math.max(0, Math.min(0.999, (event.clientY - rect.top) / rect.height)) : 0;
      minute = Math.floor(ratio * 4) * 15;
    }
    const startDate = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
    const minutes = durationMinutes(targetDurationMinutes);
    const endDate = new Date(startDate.getTime() + minutes * 60000);
    return {
      surface: 'calendar',
      start: localDateTime(component, startDate),
      end: localDateTime(component, endDate),
      duration_minutes: minutes,
    };
  }

  if (typeof CalendarComponent !== 'undefined') {
    CalendarComponent.prototype._bindProductionTemplateDnD = function() {
      if (!this.el || this._productionTemplateDndBound) return;
      this._productionTemplateDndBound = true;
      this.el.addEventListener('dragover', event => {
        if (!hasDrag(event.dataTransfer)) return;
        const drop = calendarDrop(this, event.target, event);
        if (!drop) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        event.target.closest('.gb-cal-week-cell, .gb-cal-all-day-cell, .gb-cal-day')?.classList.add('is-production-template-drop-target');
      }, true);
      this.el.addEventListener('dragleave', event => {
        event.target.closest?.('.is-production-template-drop-target')?.classList.remove('is-production-template-drop-target');
      }, true);
      this.el.addEventListener('drop', event => {
        const payload = readDrag(event.dataTransfer);
        if (!payload) return;
        const cell = event.target.closest?.('.gb-cal-week-cell, .gb-cal-all-day-cell, .gb-cal-day');
        const drop = calendarDrop(this, event.target, event, payload.durationMinutes);
        if (!drop) return;
        event.preventDefault();
        event.stopPropagation();
        cell?.classList.remove('is-production-template-drop-target');
        this._createProductionTaskFromTemplate?.(payload, drop, {});
      }, true);
    };
  }

  window.MeldexProductionTemplates = Object.freeze({
    MIME,
    hasDrag,
    readDrag,
    writeDrag,
    render,
    chooseWork,
    templatePayload,
  });
})();
