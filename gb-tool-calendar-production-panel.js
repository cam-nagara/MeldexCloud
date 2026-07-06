/* gb-tool-calendar-production-panel.js: production management lists in scheduler option panel */
(function() {
  'use strict';

  const TABS = [
    ['summary', '概要'],
    ['tasks', 'タスク'],
    ['works', '作品'],
    ['targets', '作業対象'],
    ['contents', '作業内容'],
    ['scales', '作業規模'],
    ['staff', 'メンバー'],
  ];
  const SHEET_BY_TAB = {
    tasks: 'タスクリスト',
    works: '作品リスト',
    staff: 'スタッフリスト',
    targets: '作業対象リスト',
    contents: '作業内容リスト',
    scales: '作業規模リスト',
  };
  const DEFAULT_COLUMNS = {
    tasks: ['__name', '作品タイトル', '作業対象リスト', '作業内容リスト', '作業規模リスト', '状況', '担当者', '作業予定日時', '目標作業時間'],
    works: ['作品タイトル_話数', '完了', 'ページ数', '作業作成粒度', '作業期間', '状況', '担当者'],
    targets: ['作業対象', '基準作業時間', '担当者候補', '対象色'],
    contents: ['作業内容', '表示名', '作業順', '依存階層', '作業時間倍率', '担当者候補', '標準粒度'],
    scales: ['作業規模', '作業時間倍率', '面積比'],
    staff: ['スタッフ名', '表示名', '権限', '担当できる作業', '作業可能時間', '休憩時間'],
  };
  const ADD_CONFIG = {
    works: {
      label: '作品を追加',
      nameProp: '作品タイトル_話数',
      fields: [
        ['作品タイトル_話数', 'text', '無題作品'],
        ['ページ数', 'number', '1'],
        ['作業作成粒度', 'select', 'ページ単位', ['ページ単位', 'コマ単位']],
        ['プリセット種別', 'select', 'マンガ', ['マンガ', '汎用']],
      ],
    },
    targets: {
      label: '作業対象を追加',
      nameProp: '作業対象',
      fields: [['作業対象', 'text', '全体'], ['基準作業時間', 'number', '1'], ['担当者候補', 'member', ''], ['備考', 'text', '']],
    },
    contents: {
      label: '作業内容を追加',
      nameProp: '作業内容',
      fields: [['作業内容', 'text', 'ネーム'], ['表示名', 'text', ''], ['作業順', 'number', '1'], ['依存階層', 'number', '1'], ['作業時間倍率', 'number', '1'], ['担当者候補', 'member', '']],
    },
    scales: {
      label: '作業規模を追加',
      nameProp: '作業規模',
      fields: [['作業規模', 'text', 'ページ全体'], ['作業時間倍率', 'number', '1'], ['面積比', 'number', '1']],
    },
  };
  const TAB_LABELS = Object.fromEntries(TABS);
  const DISPLAY_LABELS = {
    common: {
      '作業作成粒度': 'タスク作成粒度',
      'スタッフ名': 'メンバー名',
      'スタッフリスト': 'メンバー',
      '担当できる作業': '担当できるタスク',
    },
    tasks: {
      '__name': 'タスク名',
      '作業対象リスト': '作業対象',
      '作業内容リスト': '作業内容',
      '作業規模リスト': '作業規模',
      '作業予定日時': '予定日時',
      '作業予定時間': '予定時間',
      '目標作業時間': '目標時間',
      '目標作業時間_値': '目標時間',
    },
  };
  let _composerSeq = 0;

  function _icon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _esc(value) {
    return typeof esc === 'function'
      ? esc(value == null ? '' : String(value))
      : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function _api() {
    if (!window.MeldexProductionApi) throw new Error('制作管理APIを初期化できませんでした');
    return window.MeldexProductionApi;
  }

  function _status(message, isError) {
    if (typeof showStatus === 'function') showStatus(message, !!isError);
  }

  function _displayLabel(name, tab = '') {
    return DISPLAY_LABELS[tab]?.[name] || DISPLAY_LABELS.common?.[name] || name;
  }

  function _truthy(value) {
    return ['true', '1', 'yes', 'on', '採用', '完了'].includes(String(value || '').trim().toLowerCase());
  }

  function _isMemberField(name) {
    return ['担当者', '担当者候補', 'スタッフ名'].includes(name);
  }

  function _createOption(select, value, label = value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function _memberChoices(value, memberOptions = []) {
    const current = String(value || '').trim();
    const choices = [''];
    memberOptions.forEach(name => {
      const text = String(name || '').trim();
      if (text && !choices.includes(text)) choices.push(text);
    });
    if (current && !choices.includes(current)) choices.push(current);
    return choices;
  }

  async function _workspaceMemberNames() {
    const names = new Set();
    let hasWorkspace = false;
    const currentUser = typeof getUsername === 'function' ? String(getUsername() || '').trim() : '';
    const add = name => {
      const text = String(name || '').trim();
      if (text) names.add(text);
    };
    try {
      const workspaces = window.MeldexWorkspaces?.load
        ? await window.MeldexWorkspaces.load({ force: false })
        : [];
      const active = window.MeldexWorkspaces?.getActiveWorkspace?.() || workspaces[0] || null;
      hasWorkspace = !!active;
      (Array.isArray(active?.members) ? active.members : []).forEach(member => add(member?.name || member));
    } catch {}
    if (!hasWorkspace && names.size <= 1 && typeof apiFetch === 'function') {
      try {
        const members = await apiFetch('/team');
        (Array.isArray(members) ? members : []).forEach(member => add(member?.name || member));
      } catch {}
    }
    if (!hasWorkspace && !names.size) add(currentUser);
    if (hasWorkspace && !names.size) add(currentUser);
    return [...names];
  }

  function _dateParts(value) {
    const text = String(value || '');
    const [start = '', end = ''] = text.includes('|') ? text.split('|', 2) : [text, ''];
    return { start: start.trim(), end: end.trim() };
  }

  function _toDateInputValue(value, withTime) {
    const text = String(value || '').trim();
    if (!text) return '';
    const normalized = text.replace(' ', 'T');
    if (withTime && /^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized + 'T00:00';
    return withTime ? normalized.slice(0, 16) : normalized.slice(0, 10);
  }

  function _dateDisplay(value) {
    const { start, end } = _dateParts(value);
    const fmt = text => String(text || '').replace('T', ' ');
    if (start && end) return `${fmt(start)} - ${fmt(end)}`;
    return fmt(start || end);
  }

  function _displayValue(row, col, spec = {}) {
    if (col === '__name') return row.name || '';
    const value = row.properties?.[col];
    if (spec.type === 'checkbox') return _truthy(value) ? '✓' : '';
    if (spec.type === 'date') return _dateDisplay(value);
    return value || '';
  }

  function _getShowCompletedWorks() {
    try { return localStorage.getItem('gb:production-show-completed-works') === 'true'; } catch { return false; }
  }

  function _setShowCompletedWorks(value) {
    try { localStorage.setItem('gb:production-show-completed-works', value ? 'true' : 'false'); } catch {}
  }

  function _button(label, icon, handler, options = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = options.primary ? 'gb-btn gb-btn-xs gb-cal-production-button primary' : 'gb-btn gb-btn-xs gb-cal-production-button';
    btn.setAttribute('aria-label', options.ariaLabel || label);
    btn.dataset.calProductionAction = options.actionId || label;
    if (options.actionId) btn.dataset.e2eId = `gb-cal-production-action-${options.actionId}`;
    btn.innerHTML = `${_icon(icon, 13)} <span>${_esc(label)}</span>`;
    btn.addEventListener('click', event => {
      try {
        const result = handler(event, btn);
        if (result && typeof result.catch === 'function') {
          result.catch(error => _status(error?.message || String(error), true));
        }
      } catch (error) {
        _status(error?.message || String(error), true);
      }
    });
    return btn;
  }

  async function _withBusy(button, label, task) {
    if (button?.disabled) return;
    const span = button?.querySelector('span');
    const prev = span?.textContent || '';
    if (button) button.disabled = true;
    if (span && label) span.textContent = label;
    try {
      return await task();
    } finally {
      if (span) span.textContent = prev;
      if (button) button.disabled = false;
    }
  }

  function _ensureShell(body, active) {
    body.replaceChildren();
    const shell = document.createElement('div');
    shell.className = 'gb-cal-production-panel';
    const tabs = document.createElement('div');
    tabs.className = 'gb-cal-production-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '制作管理');
    TABS.forEach(([key, label]) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'gb-cal-production-tab' + (key === active ? ' is-active' : '');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', key === active ? 'true' : 'false');
      tab.dataset.calProductionTab = key;
      tab.dataset.e2eId = `gb-cal-production-tab-${key}`;
      tab.textContent = label;
      tab.addEventListener('click', () => render(body, { tab: key }));
      tabs.appendChild(tab);
    });
    const content = document.createElement('div');
    content.className = 'gb-cal-production-content';
    shell.append(tabs, content);
    body.appendChild(shell);
    return content;
  }

  function _actions(body) {
    const rows = [
      ['制作管理を始める', 'hammer', 'openProductionManagementStart'],
      ['シフトを取り込む', 'fileInput', 'openProductionShiftImport'],
      ['担当者と時間を割り当て', 'users', 'runProductionAssignment'],
      ['再計算', 'refreshCw', 'openProductionRecalculate'],
      ['メンバーを追加', 'userPlus', 'openProductionStaffAdd'],
      ['外部カレンダーへ送信', 'send', 'runProductionExternalSync'],
      ['書き出す', 'fileOutput', 'openProductionExport'],
    ];
    const wrap = document.createElement('div');
    wrap.className = 'gb-cal-production-actions';
    wrap.appendChild(_button('タスクを作成', 'listPlus', () => render(body, { tab: 'tasks' }), { primary: true, actionId: 'task-tab' }));
    rows.forEach(([label, icon, fn]) => {
      wrap.appendChild(_button(label, icon, () => {
        const action = window[fn];
        if (typeof action === 'function') action();
        else _status(label + 'を初期化できませんでした', true);
      }, { actionId: fn.replace(/^openProduction|^runProduction/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() }));
    });
    return wrap;
  }

  function _summaryMetrics(data) {
    const tasks = data?.tasks || {};
    const wrap = document.createElement('div');
    wrap.className = 'gb-cal-production-grid';
    [
      ['タスク', tasks.total || 0],
      ['未担当', tasks.unassigned || 0],
      ['固定', tasks.locked || 0],
      ['作品', data?.works?.total || 0],
      ['メンバー', data?.staff?.total || 0],
    ].forEach(([label, value]) => {
      const card = document.createElement('div');
      card.className = 'gb-cal-production-metric';
      card.innerHTML = `<span>${_esc(label)}</span><strong>${_esc(value)}</strong>`;
      wrap.appendChild(card);
    });
    return wrap;
  }

  function _summaryLoading() {
    const wrap = document.createElement('div');
    wrap.className = 'gb-cal-production-grid';
    ['タスク', '未担当', '固定', '作品', 'メンバー'].forEach(label => {
      const card = document.createElement('div');
      card.className = 'gb-cal-production-metric';
      card.innerHTML = `<span>${_esc(label)}</span><strong>...</strong>`;
      wrap.appendChild(card);
    });
    return wrap;
  }

  async function _renderSummary(content, body) {
    content.replaceChildren(_summaryLoading(), _actions(body));
    const data = await _api().summary();
    content.replaceChildren(_summaryMetrics(data));
    content.appendChild(_actions(body));
  }

  function _rowGrid(cols) {
    return cols.map((col, index) => index === 0 ? 'minmax(140px,1.4fr)' : 'minmax(96px,1fr)').join(' ');
  }

  function _makeField(name, type, value, options = [], context = {}) {
    const label = document.createElement('label');
    label.textContent = _displayLabel(name);
    let input;
    if (type === 'member' || _isMemberField(name)) {
      input = document.createElement('select');
      _memberChoices(value, context.memberOptions || []).forEach((choice, index) => {
        _createOption(input, choice, index === 0 && !choice ? '未設定' : choice);
      });
      input.value = value || '';
    } else if (type === 'select') {
      input = document.createElement('select');
      options.forEach(opt => {
        _createOption(input, opt);
      });
      input.value = value || options[0] || '';
    } else {
      input = document.createElement('input');
      input.type = type || 'text';
      input.value = value || '';
    }
    input.dataset.propName = name;
    input.dataset.calProductionField = name;
    input.setAttribute('aria-label', _displayLabel(name));
    label.appendChild(input);
    return label;
  }

  function _renderQuickAdd(tab, onSaved, showInitially = false, context = {}) {
    const config = ADD_CONFIG[tab];
    if (!config) return null;
    const box = document.createElement('div');
    box.className = 'gb-cal-production-add';
    box.hidden = !showInitially;
    const title = document.createElement('strong');
    title.textContent = config.label;
    const grid = document.createElement('div');
    grid.className = 'gb-cal-production-form-grid';
    config.fields.forEach(([name, type, value, options]) => grid.appendChild(_makeField(name, type, value, options || [], { ...context, fieldScope: tab })));
    const actions = document.createElement('div');
    actions.className = 'gb-cal-production-actions';
    actions.appendChild(_button('追加', 'plus', async (event, button) => {
      await _withBusy(button, '追加中...', async () => {
        const props = {};
        box.querySelectorAll('[data-prop-name]').forEach(input => { props[input.dataset.propName] = input.value; });
        const name = props[config.nameProp] || config.label;
        await _api().createEntry({ sheet: SHEET_BY_TAB[tab], name, properties: props });
        _status(config.label.replace('を追加', '') + 'を追加しました');
        await onSaved();
      });
    }, { primary: true, actionId: `quick-add-save-${tab}` }));
    actions.appendChild(_button('閉じる', 'x', () => { box.hidden = true; }, { actionId: `quick-add-close-${tab}` }));
    box.append(title, grid, actions);
    return box;
  }

  function _toolbar(label, options = {}) {
    const toolbar = document.createElement('div');
    toolbar.className = 'gb-cal-production-toolbar';
    const caption = document.createElement('div');
    caption.className = 'gb-cal-production-toolbar-title';
    caption.innerHTML = `<strong>${_esc(label)}</strong>${Number.isFinite(options.count) ? `<span>${options.count}件</span>` : ''}`;
    if (typeof options.onSearch === 'function') {
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = '検索';
      search.value = options.query || '';
      search.className = 'gb-cal-production-search';
      search.setAttribute('aria-label', `${label}を検索`);
      search.dataset.calProductionSearch = options.tab || label;
      search.dataset.e2eId = `gb-cal-production-search-${options.tab || 'list'}`;
      let timer = null;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const result = options.onSearch(search.value.trim());
          if (result && typeof result.catch === 'function') result.catch(error => _status(error?.message || String(error), true));
        }, 220);
      });
      search.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        clearTimeout(timer);
        const result = options.onSearch(search.value.trim());
        if (result && typeof result.catch === 'function') result.catch(error => _status(error?.message || String(error), true));
      });
      caption.appendChild(search);
    }
    (options.extraControls || []).forEach(node => caption.appendChild(node));
    const actions = document.createElement('div');
    actions.className = 'gb-cal-production-actions';
    if (options.onAdd) actions.appendChild(_button(options.onAdd.label, 'plus', options.onAdd.handler, { primary: true, actionId: options.onAdd.actionId || `quick-add-open-${options.tab || 'list'}` }));
    actions.appendChild(_button('更新', 'refreshCw', options.onRefresh || (() => {}), { actionId: `refresh-${options.tab || 'list'}` }));
    toolbar.append(caption, actions);
    return toolbar;
  }

  async function _optionRows(sheet, fallback) {
    try {
      const data = await _api().list(sheet, { limit: 1000 });
      return (data.rows || []).map(row => row.properties?.[fallback] || row.name || '').filter(Boolean);
    } catch {
      return [];
    }
  }

  function _checkList(label, values, fallback) {
    const field = document.createElement('div');
    field.className = 'gb-cal-production-check-list';
    const title = document.createElement('label');
    title.textContent = label;
    const list = document.createElement('div');
    list.dataset.checkList = label;
    const items = values.length ? values : [fallback];
    items.forEach((value, index) => {
      const item = document.createElement('label');
      item.className = 'cal-option-member';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = value;
      input.checked = index === 0;
      input.dataset.calProductionChecklist = label;
      input.setAttribute('aria-label', `${label}: ${value}`);
      const span = document.createElement('span');
      span.textContent = value;
      item.append(input, span);
      list.appendChild(item);
    });
    field.append(title, list);
    return field;
  }

  function _checkedValues(root, label, fallback) {
    const values = [...root.querySelectorAll(`[data-check-list="${label}"] input:checked`)]
      .map(input => input.value)
      .filter(Boolean);
    return values.length ? values : [fallback];
  }

  async function _taskComposer(onSaved) {
    const [works, targets, contents, scales] = await Promise.all([
      _optionRows('作品リスト', '作品タイトル_話数'),
      _optionRows('作業対象リスト', '作業対象'),
      _optionRows('作業内容リスト', '作業内容'),
      _optionRows('作業規模リスト', '作業規模'),
    ]);
    const box = document.createElement('div');
    box.className = 'gb-cal-production-composer';
    const title = document.createElement('strong');
    title.textContent = 'タスクを作成';
    const grid = document.createElement('div');
    grid.className = 'gb-cal-production-form-grid';
    const workField = document.createElement('label');
    workField.textContent = '作品';
    const workInput = document.createElement('input');
    const workOptionsId = `gb-cal-production-work-options-${++_composerSeq}`;
    workInput.setAttribute('list', workOptionsId);
    workInput.dataset.calProductionField = '作品';
    workInput.dataset.e2eId = 'gb-cal-production-task-work';
    workInput.setAttribute('aria-label', '作品');
    workInput.value = works[0] || '無題作品';
    const dataList = document.createElement('datalist');
    dataList.id = workOptionsId;
    works.forEach(work => {
      const option = document.createElement('option');
      option.value = work;
      dataList.appendChild(option);
    });
    workField.append(workInput, dataList);
    grid.append(
      workField,
      _makeField('ページ数', 'number', '1'),
      _makeField('コマ数', 'number', '1'),
      _makeField('作業作成粒度', 'select', 'ページ単位', ['ページ単位', 'コマ単位'])
    );
    const checks = document.createElement('div');
    checks.className = 'gb-cal-production-task-lists';
    checks.append(
      _checkList('作業対象', targets, '全体'),
      _checkList('作業内容', contents, 'ネーム'),
      _checkList('作業規模', scales, 'ページ全体')
    );
    const actions = document.createElement('div');
    actions.className = 'gb-cal-production-actions';
    actions.appendChild(_button('作成', 'listPlus', async (event, button) => {
      await _withBusy(button, '作成中...', async () => {
        const pageCount = box.querySelector('[data-prop-name="ページ数"]')?.value || '1';
        const panelCount = box.querySelector('[data-prop-name="コマ数"]')?.value || '1';
        const granularity = box.querySelector('[data-prop-name="作業作成粒度"]')?.value || 'ページ単位';
        const result = await _api().createTasks({
          work_title: workInput.value.trim() || '無題作品',
          page_count: pageCount,
          panel_count: panelCount,
          granularity,
          target_names: _checkedValues(box, '作業対象', '全体'),
          content_names: _checkedValues(box, '作業内容', 'ネーム'),
          scale_names: _checkedValues(box, '作業規模', 'ページ全体'),
        });
        _status(`タスクを作成しました: ${result.created || 0}件`);
        await onSaved();
      });
    }, { primary: true, actionId: 'task-composer-create' }));
    box.append(title, grid, checks, actions);
    return box;
  }

  async function _renderList(content, tab, options = {}) {
    content.textContent = '読み込み中...';
    const sheet = SHEET_BY_TAB[tab];
    const query = String(options.q || '');
    const includeCompletedWorks = tab === 'works' && _getShowCompletedWorks();
    const [data, memberOptions] = await Promise.all([
      _api().list(sheet, { limit: 120, q: query, include_completed: includeCompletedWorks ? '1' : '' }),
      _workspaceMemberNames(),
    ]);
    let rows = data.rows || [];
    if (tab === 'works' && !includeCompletedWorks) {
      rows = rows.filter(row => !_truthy(row.properties?.['完了']));
    }
    const cols = DEFAULT_COLUMNS[tab] || data.columns?.slice(0, 5) || [];
    // path（初回の行選択）と focusSearch（検索フォーカス）は1回限りの指定。
    // 引き継ぐと、以後の保存・更新のたびに選択が元の行へ戻り、フォーカスが検索欄へ奪われる
    const refresh = (next = {}) => {
      const { path, focusSearch, ...rest } = options;
      return _renderList(content, tab, { ...rest, ...next });
    };
    const addBox = _renderQuickAdd(tab, refresh, Boolean(ADD_CONFIG[tab]), { memberOptions });
    const extraControls = [];
    if (tab === 'works') {
      const doneToggle = document.createElement('label');
      doneToggle.className = 'gb-cal-production-inline-check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = includeCompletedWorks;
      checkbox.dataset.calProductionShowCompletedWorks = '1';
      checkbox.dataset.e2eId = 'gb-cal-production-show-completed-works';
      checkbox.setAttribute('aria-label', '完了の作品を表示');
      checkbox.addEventListener('change', () => {
        _setShowCompletedWorks(checkbox.checked);
        refresh();
      });
      doneToggle.append(checkbox, document.createTextNode('完了の作品を表示'));
      extraControls.push(doneToggle);
    }
    const toolbar = _toolbar(TAB_LABELS[tab] || '制作管理', {
      count: rows.length,
      query,
      tab,
      onSearch: q => refresh({ q, focusSearch: true }),
      onAdd: addBox ? { label: ADD_CONFIG[tab].label, handler: () => { addBox.hidden = !addBox.hidden; }, actionId: `quick-add-open-${tab}` } : null,
      onRefresh: () => refresh(),
      extraControls,
    });
    const list = document.createElement('div');
    list.className = 'gb-cal-production-list';
    const head = document.createElement('div');
    head.className = 'gb-cal-production-row is-head';
    head.style.gridTemplateColumns = _rowGrid(cols);
    cols.forEach(col => {
      const cell = document.createElement('div');
      cell.className = 'gb-cal-production-cell';
      cell.textContent = _displayLabel(col, tab);
      head.appendChild(cell);
    });
    list.appendChild(head);
    const detail = document.createElement('div');
    detail.className = 'gb-cal-production-detail';
    detail.hidden = true;
    const selectRow = row => {
      list.querySelectorAll('.gb-cal-production-row').forEach(item => item.classList.remove('is-selected'));
      const safePath = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(row.path) : String(row.path || '').replace(/["\\]/g, '\\$&');
      const rowEl = list.querySelector(`[data-entry-path="${safePath}"]`);
      rowEl?.classList.add('is-selected');
      _renderDetail(detail, row, cols.filter(col => col !== '__name'), data.property_types || {}, tab, { memberOptions, refresh });
    };
    rows.forEach(row => {
      const el = document.createElement('div');
      el.className = 'gb-cal-production-row';
      el.dataset.entryPath = row.path || '';
      el.dataset.calProductionRow = row.path || row.name || '';
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${row.name || '制作管理項目'}を編集`);
      el.tabIndex = 0;
      el.style.gridTemplateColumns = _rowGrid(cols);
      cols.forEach(col => {
        const cell = document.createElement('div');
        cell.className = 'gb-cal-production-cell';
        cell.textContent = _displayValue(row, col, data.property_types?.[col] || {});
        el.appendChild(cell);
      });
      el.addEventListener('click', () => selectRow(row));
      el.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectRow(row);
      });
      list.appendChild(el);
      if (options.path && row.path === options.path) setTimeout(() => selectRow(row), 0);
    });
    const nodes = [toolbar];
    if (tab === 'tasks') nodes.push(await _taskComposer(refresh));
    if (addBox) nodes.push(addBox);
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'cal-option-empty';
      empty.textContent = '項目がありません。上の追加ボタンから作成できます。';
      nodes.push(empty);
    }
    nodes.push(list, detail);
    content.replaceChildren(...nodes);
    if (options.focusSearch) {
      const search = content.querySelector('.gb-cal-production-search');
      search?.focus();
      search?.setSelectionRange?.(search.value.length, search.value.length);
    }
  }

  function _dateRangeControl(col, value, spec = {}) {
    const withTime = spec.withTime !== false;
    const parts = _dateParts(value);
    const wrap = document.createElement('div');
    wrap.className = 'gb-cal-production-date-range';
    wrap.dataset.propRange = col;
    const start = document.createElement('input');
    start.type = withTime ? 'datetime-local' : 'date';
    start.value = _toDateInputValue(parts.start, withTime);
    start.dataset.rangeStart = '1';
    start.dataset.rangeRaw = parts.start;
    start.dataset.rangeInitial = start.value || '';
    start.dataset.calProductionRangePart = 'start';
    start.setAttribute('aria-label', `${_displayLabel(col)} 開始`);
    const end = document.createElement('input');
    end.type = withTime ? 'datetime-local' : 'date';
    end.value = _toDateInputValue(parts.end, withTime);
    end.dataset.rangeEnd = '1';
    end.dataset.rangeRaw = parts.end;
    end.dataset.rangeInitial = end.value || '';
    end.dataset.calProductionRangePart = 'end';
    end.setAttribute('aria-label', `${_displayLabel(col)} 終了`);
    wrap.append(start, end);
    return wrap;
  }

  function _detailControl(col, value, spec = {}, context = {}) {
    const type = String(spec.type || 'text');
    if (_isMemberField(col)) {
      const select = document.createElement('select');
      _memberChoices(value, context.memberOptions || []).forEach((choice, index) => {
        _createOption(select, choice, index === 0 && !choice ? '未設定' : choice);
      });
      select.value = value || '';
      select.dataset.propName = col;
      select.dataset.calProductionField = col;
      select.setAttribute('aria-label', _displayLabel(col, context.tab || ''));
      return select;
    }
    if (type === 'date' && spec.range) return _dateRangeControl(col, value, spec);
    if (type === 'select' && Array.isArray(spec.options) && spec.options.length) {
      const select = document.createElement('select');
      spec.options.forEach(optionValue => _createOption(select, optionValue));
      if (value && !spec.options.includes(value)) {
        _createOption(select, value);
      }
      select.value = value || '';
      select.dataset.propName = col;
      select.dataset.calProductionField = col;
      select.setAttribute('aria-label', _displayLabel(col, context.tab || ''));
      return select;
    }
    const input = document.createElement('input');
    input.type = type === 'number' ? 'number' : type === 'checkbox' ? 'checkbox' : type === 'date' ? (spec.withTime ? 'datetime-local' : 'date') : 'text';
    if (input.type === 'checkbox') input.checked = _truthy(value);
    else input.value = type === 'date' ? _toDateInputValue(value, !!spec.withTime) : (value || '');
    input.dataset.propName = col;
    input.dataset.calProductionField = col;
    input.setAttribute('aria-label', _displayLabel(col, context.tab || ''));
    return input;
  }

  function _renderDetail(detail, row, cols, propertyTypes = {}, tab = '', context = {}) {
    detail.hidden = false;
    detail.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = row.name || '項目';
    detail.appendChild(title);
    cols.forEach(col => {
      const label = document.createElement('label');
      label.textContent = _displayLabel(col, tab);
      label.appendChild(_detailControl(col, row.properties?.[col] || '', propertyTypes[col] || {}, { ...context, tab }));
      detail.appendChild(label);
    });
    const actions = document.createElement('div');
    actions.className = 'gb-cal-production-actions';
    actions.appendChild(_button('保存', 'save', async (event, button) => {
      await _withBusy(button, '保存中...', async () => {
        const props = {};
        detail.querySelectorAll('[data-prop-range]').forEach(group => {
          const propName = group.dataset.propRange;
          const rangeValue = input => {
            const value = input?.value || '';
            const raw = input?.dataset?.rangeRaw || '';
            const initial = input?.dataset?.rangeInitial || '';
            return value && raw && value === initial ? raw : value;
          };
          const start = rangeValue(group.querySelector('[data-range-start]'));
          const end = rangeValue(group.querySelector('[data-range-end]'));
          props[propName] = start && end ? `${start}|${end}` : (start || end);
        });
        detail.querySelectorAll('[data-prop-name]').forEach(input => {
          props[input.dataset.propName] = input.type === 'checkbox' ? input.checked : input.value;
        });
        const result = await _api().patchEntry({ sheet: row.sheet, path: row.path, properties: props });
        Object.assign(row, result.row || row);
        _status('制作管理リストを保存しました');
        // 保存後も編集していた行の選択・詳細表示を維持する
        if (typeof context.refresh === 'function') await context.refresh({ path: row.path });
      });
    }, { primary: true, actionId: 'detail-save' }));
    actions.appendChild(_button('元シートを開く', 'externalLink', () => {
      if (row.path && typeof openPage === 'function') openPage(row.name || '制作管理', row.path);
    }, { actionId: 'detail-open-source' }));
    detail.appendChild(actions);
  }

  async function render(body, options = {}) {
    const requestedTab = options.tab || 'summary';
    const tab = TABS.some(([key]) => key === requestedTab) ? requestedTab : 'summary';
    const content = _ensureShell(body, tab);
    try {
      if (tab === 'summary') await _renderSummary(content, body);
      else if (SHEET_BY_TAB[tab]) await _renderList(content, tab, options);
    } catch (error) {
      content.textContent = '制作管理を読み込めません: ' + (error?.message || error);
    }
  }

  async function openTaskEvent(body, event) {
    try {
      const data = await _api().taskByEvent(event?.id || '');
      await render(body, { tab: 'tasks', path: data.row?.path || '' });
    } catch {
      await render(body, { tab: 'tasks' });
    }
  }

  window.MeldexProductionPanel = { render, openTaskEvent };
})();
