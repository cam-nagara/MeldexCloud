/* gb-tool-calendar-production-all-view.js
 * スケジュール タスクリスト面の「すべて」タブ用に、全作品のタスクを1枚のフラット表で
 * 横断表示する独立モジュール。
 *
 * 実装方式（依頼8での再設計）: 集約用の実シートは存在しない（作品別シートが正）ため、旧版は
 * 「作品ごとの生きたシート表を縦に積む」方式だったが、作品ごとに独立表示が分かれるため
 * 担当者フィルタ・目標作業時間ソートが作品をまたいで効かないという実害があった。読み取り
 * 専用の全作品統合クエリAPI（/production-management/tasks/query、Desktop:
 * meldex_production_task_query.py、Cloud: _pmCloudQueryTasks）が両環境に実装済みで
 * 未使用だったため、それを使って1枚のフラット表（行 = タスク、先頭列 = 作品）へ作り直す。
 * フィルタ・検索・ソート・ページングはすべてサーバー側へ委譲する。
 *
 * 編集は第一段階では行わない（セル直接編集は作品間の名前衝突・単一dbPath前提の汎用機構との
 * 相性が悪いため見送り）。行クリックで既存のタスク詳細サイドバー（MeldexProductionSidebar.
 * openTask、patchEntry経由の管理された書込経路）を開いて編集する。表示設定（フィルタ・
 * ソート）は localStorage にのみ保存し、シートデータ・view configへは一切書き込まない
 * （制作管理シートの暗黙sheet-store化を防止するガードに抵触しないため）。
 */
(function () {
  'use strict';

  const PREFS_PREFIX = 'productionAllFlatViewPrefs:';
  const DEFAULT_GENERIC_LABELS = ['中分類', '小分類', '詳細分類'];
  const NEW_LEVEL_NAMES = ['中分類', '小分類', '詳細分類'];
  const LEGACY_LEVEL_NAMES = ['単位レベル1', '単位レベル2', '単位レベル3'];
  const LIMIT = 200;
  const SEARCH_DEBOUNCE_MS = 300;

  // field はサーバー側 FIELD_ALIASES（Desktop: meldex_production_task_query.py、
  // Cloud: gb-production-management-cloud-task-event-query.js（旧
  // gb-production-management.part02.js の一部）の _pmCloudQuerySort）と両方が受理する
  // キー名で揃えている。
  const COLUMN_DEFS = [
    { key: 'work', field: 'work_title', label: '作品', sortable: true },
    { key: 'name', field: 'name', label: 'タスク名', sortable: true },
    { key: 'status', field: 'status', label: '状況', sortable: true },
    { key: 'assignee', field: 'assignee', label: '担当者', sortable: true },
    { key: 'priority', field: 'priority', label: '優先度', sortable: true },
    { key: 'planned', field: 'planned_start', label: '作業予定日時', sortable: true },
    { key: 'duration', field: 'duration', label: '目標作業時間', sortable: true },
    { key: 'level1', field: 'level1', label: '', sortable: true },
    { key: 'level2', field: 'level2', label: '', sortable: true },
    { key: 'level3', field: 'level3', label: '', sortable: true },
  ];

  function _logError(instance, message, error) {
    console.error('[MeldexProductionAllView] ' + message + ': ' + (instance?.idSuffix || '(unmounted)'), error || '');
  }

  function _notify(message, error) {
    if (typeof showStatus === 'function') showStatus(message, !!error);
  }

  function _icon(name, size) {
    const span = document.createElement('span');
    span.className = 'gb-production-task-icon';
    if (typeof lucide === 'function') span.innerHTML = lucide(name, size || 14);
    return span;
  }

  /* --- localStorage 表示設定（フィルタ・ソートのみ。シートデータは一切書き込まない） --- */

  function _prefsKey(pmRoot) {
    return PREFS_PREFIX + String(pmRoot || '制作管理');
  }

  function _loadPrefs(pmRoot) {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(_prefsKey(pmRoot));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function _savePrefs(instance) {
    try {
      if (typeof localStorage === 'undefined' || !instance._pmRoot) return;
      localStorage.setItem(_prefsKey(instance._pmRoot), JSON.stringify({
        filters: { work: instance._filters.work, status: instance._filters.status, assignee: instance._filters.assignee },
        sort: instance._sort,
      }));
    } catch { /* localStorage 不可時は表示設定の保存だけを諦める（機能自体は動く） */ }
  }

  /* --- 行データの表示用ヘルパー --- */

  function _levelCandidates(customLabels, index) {
    const candidates = [];
    const custom = String(customLabels?.[index] || '').trim();
    if (custom) candidates.push(custom);
    if (NEW_LEVEL_NAMES[index]) candidates.push(NEW_LEVEL_NAMES[index]);
    if (LEGACY_LEVEL_NAMES[index]) candidates.push(LEGACY_LEVEL_NAMES[index]);
    return [...new Set(candidates)];
  }

  function _workTitleOf(row, instance) {
    const props = row?.properties || {};
    const direct = String(props['作品タイトル'] || props['作品タイトル_話数'] || '').trim();
    if (direct) return direct;
    // フォールバック: 作品タイトルのリレーションが候補値として登録されていない行がある
    // （例: 汎用エントリ作成経路では採用候補として書き込まれないことがある）。row.path は
    // 必ず対象シートのディレクトリ配下にあるため、シート一覧とのパス前方一致で特定する。
    const path = String(row?.path || '');
    if (!path || !instance?._sheetsByWork) return '';
    for (const [title, sheet] of instance._sheetsByWork) {
      const dir = String(sheet?.dir || '');
      if (dir && (path === dir || path.startsWith(dir + '/'))) return title;
    }
    return '';
  }

  // 表示用ラベル解決の優先順位（作品固有ラベル > 新名 > 旧名）はサーバー側
  // resolve_level_prop_names / _pmResolveLevelPropNames と揃えている。
  function _levelValue(row, index, instance) {
    const meta = instance?._workMeta?.[_workTitleOf(row, instance)];
    const customLabels = Array.isArray(meta?.classification_labels) ? meta.classification_labels : [];
    const props = row?.properties || {};
    for (const name of _levelCandidates(customLabels, index)) {
      const value = props[name];
      if (value) return String(value);
    }
    return '';
  }

  function _formatDuration(row) {
    const props = row?.properties || {};
    const num = Number(props['目標作業時間_値']);
    if (Number.isFinite(num) && num > 0) return `${Math.round(num * 10) / 10}時間`;
    return String(props['目標作業時間'] || '').trim();
  }

  function _formatPlanned(row) {
    const text = String(row?.properties?.['作業予定日時'] || '').trim();
    if (!text) return '';
    const [startRaw, endRaw] = text.split('|');
    const norm = value => String(value || '').trim().replace('T', ' ').slice(0, 16);
    const start = norm(startRaw);
    const end = norm(endRaw);
    if (!start && !end) return '';
    if (start && end) {
      const sameDay = start.slice(0, 10) === end.slice(0, 10);
      return sameDay ? `${start}〜${end.slice(11)}` : `${start}〜${end}`;
    }
    return start || end;
  }

  function _cellText(instance, row, column) {
    const props = row?.properties || {};
    switch (column.key) {
      case 'work': return _workTitleOf(row, instance);
      case 'name': return row?.name || '';
      case 'status': return props['状況'] || '';
      case 'assignee': return props['担当者'] || '';
      case 'priority': return props['優先度'] || '';
      case 'planned': return _formatPlanned(row);
      case 'duration': return _formatDuration(row);
      case 'level1': return _levelValue(row, 0, instance);
      case 'level2': return _levelValue(row, 1, instance);
      case 'level3': return _levelValue(row, 2, instance);
      default: return '';
    }
  }

  /* --- フィルタドロップダウンの選択肢 --- */

  function _fillSelect(selectEl, options, currentValue, blankLabel) {
    if (!selectEl) return;
    const previousValue = selectEl.value;
    selectEl.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = blankLabel;
    selectEl.appendChild(blank);
    const values = new Set((options || []).filter(Boolean).map(String));
    if (currentValue) values.add(currentValue);
    [...values].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true })).forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      selectEl.appendChild(option);
    });
    if (currentValue && values.has(currentValue)) selectEl.value = currentValue;
    else if (values.has(previousValue)) selectEl.value = previousValue;
    else selectEl.value = '';
  }

  function _renderFilterOptions(instance) {
    _fillSelect(instance._workSelectEl, [...instance._sheetsByWork.keys()], instance._filters.work, 'すべての作品');
    _fillSelect(instance._statusSelectEl, [...instance._facets.statuses], instance._filters.status, 'すべての状況');
    _fillSelect(instance._assigneeSelectEl, [...instance._facets.assignees], instance._filters.assignee, 'すべての担当者');
  }

  /* --- ヘッダー・ステータス表示 --- */

  function _sortIndicator(instance, field) {
    if (instance._sort.field !== field) return '';
    return instance._sort.direction === 'desc' ? ' ▼' : ' ▲';
  }

  function _renderHeaderLabels(instance) {
    COLUMN_DEFS.forEach((column, index) => {
      const th = instance._headerCells.get(column.key);
      if (!th) return;
      const levelIndex = column.key.startsWith('level') ? Number(column.key.slice(-1)) - 1 : -1;
      const label = levelIndex >= 0
        ? (instance._genericLabels[levelIndex] || DEFAULT_GENERIC_LABELS[levelIndex] || column.label)
        : column.label;
      th.textContent = label + _sortIndicator(instance, column.field);
      if (column.sortable) {
        th.setAttribute('aria-sort', instance._sort.field === column.field
          ? (instance._sort.direction === 'desc' ? 'descending' : 'ascending')
          : 'none');
      }
      void index;
    });
  }

  function _renderStatus(instance) {
    if (!instance._statusEl) return;
    if (instance._errorText) {
      instance._statusEl.textContent = instance._errorText;
      instance._statusEl.classList.add('is-error');
      return;
    }
    instance._statusEl.classList.remove('is-error');
    if (instance._loading && !instance._rows.length) {
      instance._statusEl.textContent = '読み込み中…';
      return;
    }
    instance._statusEl.textContent = `${instance._rows.length.toLocaleString('ja-JP')} / ${instance._total.toLocaleString('ja-JP')}件`;
  }

  /* --- DOM構築 --- */

  function _buildToolbar(instance) {
    const toolbar = document.createElement('div');
    toolbar.className = 'gb-production-all-flat-toolbar';

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'タスクを検索';
    search.className = 'gb-production-all-flat-search';
    search.dataset.e2eId = 'gb-production-all-flat-search';
    search.setAttribute('aria-label', 'タスクを検索');
    let searchTimer = null;
    search.addEventListener('input', () => {
      instance._filters.q = search.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => _fetchRows(instance, { append: false }), SEARCH_DEBOUNCE_MS);
    });
    instance._searchEl = search;

    const workSelect = document.createElement('select');
    workSelect.className = 'gb-production-all-flat-filter';
    workSelect.dataset.e2eId = 'gb-production-all-flat-filter-work';
    workSelect.setAttribute('aria-label', '作品で絞り込み');
    workSelect.addEventListener('change', () => {
      instance._filters.work = workSelect.value;
      _savePrefs(instance);
      _fetchRows(instance, { append: false });
    });
    instance._workSelectEl = workSelect;

    const statusSelect = document.createElement('select');
    statusSelect.className = 'gb-production-all-flat-filter';
    statusSelect.dataset.e2eId = 'gb-production-all-flat-filter-status';
    statusSelect.setAttribute('aria-label', '状況で絞り込み');
    statusSelect.addEventListener('change', () => {
      instance._filters.status = statusSelect.value;
      _savePrefs(instance);
      _fetchRows(instance, { append: false });
    });
    instance._statusSelectEl = statusSelect;

    const assigneeSelect = document.createElement('select');
    assigneeSelect.className = 'gb-production-all-flat-filter';
    assigneeSelect.dataset.e2eId = 'gb-production-all-flat-filter-assignee';
    assigneeSelect.setAttribute('aria-label', '担当者で絞り込み');
    assigneeSelect.addEventListener('change', () => {
      instance._filters.assignee = assigneeSelect.value;
      _savePrefs(instance);
      _fetchRows(instance, { append: false });
    });
    instance._assigneeSelectEl = assigneeSelect;

    const status = document.createElement('span');
    status.className = 'gb-production-all-flat-status';
    status.dataset.e2eId = 'gb-production-all-flat-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    instance._statusEl = status;

    toolbar.append(search, workSelect, statusSelect, assigneeSelect, status);
    return toolbar;
  }

  function _buildTable(instance) {
    const wrap = document.createElement('div');
    wrap.className = 'gb-production-all-flat-table-wrap';

    const table = document.createElement('table');
    table.className = 'pivot-table gb-production-all-flat-table';
    table.dataset.e2eId = 'gb-production-all-flat-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const selectTh = document.createElement('th');
    selectTh.className = 'gb-production-all-flat-select-col';
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.className = 'row-select-cb';
    selectAll.dataset.e2eId = 'gb-production-all-flat-select-all';
    selectAll.setAttribute('aria-label', 'すべての行を選択');
    selectAll.addEventListener('change', () => {
      const rows = [...instance._tbodyEl.querySelectorAll('tr[data-row-path]')];
      rows.forEach(rowEl => {
        if (selectAll.checked) instance._selectedPaths.add(rowEl.dataset.rowPath);
        else instance._selectedPaths.delete(rowEl.dataset.rowPath);
      });
      instance._tbodyEl.querySelectorAll('.gb-production-all-flat-select').forEach(cb => { cb.checked = selectAll.checked; });
    });
    selectTh.appendChild(selectAll);
    instance._selectAllEl = selectAll;
    headRow.appendChild(selectTh);

    COLUMN_DEFS.forEach(column => {
      const th = document.createElement('th');
      th.dataset.sortField = column.field;
      th.dataset.e2eId = 'gb-production-all-flat-sort-' + column.key;
      th.setAttribute('role', 'columnheader');
      if (column.sortable) {
        th.className = 'gb-production-all-flat-sortable';
        th.tabIndex = 0;
        const activate = () => {
          if (instance._sort.field === column.field) {
            instance._sort.direction = instance._sort.direction === 'asc' ? 'desc' : 'asc';
          } else {
            instance._sort = { field: column.field, direction: 'asc' };
          }
          _savePrefs(instance);
          _fetchRows(instance, { append: false });
        };
        th.addEventListener('click', activate);
        th.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
        });
      }
      instance._headerCells.set(column.key, th);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    instance._tbodyEl = tbody;
    table.appendChild(tbody);

    tbody.addEventListener('click', event => {
      if (event.target.closest?.('.gb-production-all-flat-select, .gb-production-all-flat-work-jump')) return;
      const rowEl = event.target.closest?.('tr[data-row-path]');
      if (!rowEl) return;
      const row = instance._rowsByPath.get(rowEl.dataset.rowPath);
      if (row?._schedulerProposal) {
        _notify('案の表示中は編集できません。採用すると確定版へ反映されます');
        return;
      }
      if (row) instance.onOpenTask?.(row);
    });

    wrap.appendChild(table);
    return wrap;
  }

  function _buildLoadMore(instance) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gb-production-all-flat-load-more';
    button.dataset.e2eId = 'gb-production-all-flat-load-more';
    button.textContent = 'さらに読み込む';
    button.hidden = true;
    button.addEventListener('click', () => _fetchRows(instance, { append: true }));
    instance._loadMoreEl = button;
    return button;
  }

  function _buildRow(instance, row) {
    const path = String(row?.path || '');
    const tr = document.createElement('tr');
    tr.dataset.rowPath = path;
    tr.className = 'gb-production-all-flat-row';
    if (row?._schedulerProposal) {
      tr.classList.add('gb-scheduler-proposal-row');
      tr.dataset.schedulerProposalId = row._schedulerProposalId || '';
    }

    const selectTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'row-select-cb gb-production-all-flat-select';
    checkbox.checked = instance._selectedPaths.has(path);
    checkbox.setAttribute('aria-label', (row?.name || 'タスク') + 'を選択');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) instance._selectedPaths.add(path);
      else instance._selectedPaths.delete(path);
      if (instance._selectAllEl) {
        instance._selectAllEl.checked = [...instance._tbodyEl.querySelectorAll('.gb-production-all-flat-select')]
          .every(cb => cb.checked);
      }
    });
    selectTd.appendChild(checkbox);
    tr.appendChild(selectTd);

    COLUMN_DEFS.forEach(column => {
      const td = document.createElement('td');
      if (column.key === 'work') {
        const text = document.createElement('span');
        text.className = 'gb-production-all-flat-work-text';
        text.textContent = _cellText(instance, row, column);
        td.appendChild(text);
        const sheet = instance._sheetsByWork.get(_workTitleOf(row, instance));
        if (sheet) {
          const jump = document.createElement('button');
          jump.type = 'button';
          jump.className = 'gb-production-all-flat-work-jump';
          jump.title = '作品タブで開く';
          jump.setAttribute('aria-label', `「${sheet.work_title || sheet.sheet_name}」のタブで開く`);
          jump.appendChild(_icon('arrowUpRight', 12));
          jump.addEventListener('click', event => {
            event.stopPropagation();
            instance.onOpenWork?.(sheet);
          });
          td.appendChild(jump);
        }
      } else {
        td.textContent = _cellText(instance, row, column);
      }
      tr.appendChild(td);
    });
    return tr;
  }

  function _renderTable(instance) {
    const tbody = instance._tbodyEl;
    if (!tbody) return;
    tbody.replaceChildren();
    instance._rowsByPath = new Map();
    if (!instance._rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = COLUMN_DEFS.length + 1;
      td.className = 'gb-production-all-flat-no-rows';
      td.textContent = instance._hasLoadedOnce ? '該当するタスクがありません' : '読み込み中…';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      instance._rows.forEach(row => {
        instance._rowsByPath.set(String(row?.path || ''), row);
        tbody.appendChild(_buildRow(instance, row));
      });
    }
    if (instance._selectAllEl) {
      instance._selectAllEl.checked = instance._rows.length > 0
        && instance._rows.every(row => instance._selectedPaths.has(String(row?.path || '')));
    }
    if (instance._loadMoreEl) instance._loadMoreEl.hidden = instance._rows.length >= instance._total;
  }

  /* --- データ取得（全作品統合クエリAPIへ委譲） --- */

  async function _fetchRows(instance, opts = {}) {
    if (!instance._mounted || instance._destroyed) return false;
    if (!window.MeldexProductionApi?.queryTasks) {
      _logError(instance, 'MeldexProductionApi.queryTasks が未定義です');
      return false;
    }
    const append = opts.append === true;
    const seq = ++instance._loadSeq;
    instance._loading = true;
    _renderStatus(instance);
    const body = {
      filters: {
        work: instance._filters.work || undefined,
        status: instance._filters.status || undefined,
        assignee: instance._filters.assignee || undefined,
      },
      q: instance._filters.q || '',
      sort: [{ field: instance._sort.field, direction: instance._sort.direction }],
      offset: append ? instance._rows.length : 0,
      limit: LIMIT,
    };
    let data;
    try {
      data = await window.MeldexProductionApi.queryTasks(body);
    } catch (error) {
      if (seq !== instance._loadSeq || instance._destroyed) return false;
      instance._loading = false;
      instance._errorText = error?.message || 'タスクを読み込めませんでした';
      _logError(instance, 'タスクの読み込みに失敗しました', error);
      _renderStatus(instance);
      _notify(instance._errorText, true);
      return false;
    }
    if (seq !== instance._loadSeq || instance._destroyed) return false;
    instance._loading = false;
    instance._errorText = '';
    instance._hasLoadedOnce = true;
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    instance._total = Number(data?.total || 0);
    instance._workMeta = data?.work_meta && typeof data.work_meta === 'object' ? data.work_meta : {};
    if (Array.isArray(data?.generic_classification_labels) && data.generic_classification_labels.length) {
      instance._genericLabels = data.generic_classification_labels;
    }
    // APIが全件走査から返すfacetを正本にする。これにより初回200件より後にしか現れない
    // 状況・担当者も、追加読み込み前から絞り込み候補として選べる。
    const responseStatuses = Array.isArray(data?.facets?.statuses) ? data.facets.statuses : null;
    const responseAssignees = Array.isArray(data?.facets?.assignees) ? data.facets.assignees : null;
    if (responseStatuses) instance._facets.statuses = new Set(responseStatuses.map(String).filter(Boolean));
    else if (!append) instance._facets.statuses = new Set();
    if (responseAssignees) instance._facets.assignees = new Set(responseAssignees.map(String).filter(Boolean));
    else if (!append) instance._facets.assignees = new Set();
    // 旧サーバーとの互換用に、応答行の値も合流する。
    rows.forEach(row => {
      const status = row?.properties?.['状況'];
      const assignee = row?.properties?.['担当者'];
      if (status) instance._facets.statuses.add(String(status));
      if (assignee) instance._facets.assignees.add(String(assignee));
    });
    if (append) instance._baseRows = instance._baseRows.concat(rows);
    else {
      instance._baseRows = rows;
      instance._selectedPaths.clear();
    }
    const projection = window.MeldexSchedulerProposalOverlay?.projectTaskRows?.(
      instance._baseRows, window.MeldexSchedulerProposalOverlay?.active?.(),
    );
    instance._rows = projection?.rows || instance._baseRows;
    _renderFilterOptions(instance);
    _renderHeaderLabels(instance);
    _renderTable(instance);
    _renderStatus(instance);
    return true;
  }

  async function _open(instance, sheets, opts = {}) {
    if (instance._destroyed || !instance._mounted) return false;
    const list = (Array.isArray(sheets) ? sheets : []).filter(sheet => sheet && sheet.sheet_name && sheet.dir);
    instance._sheets = list;
    instance._sheetsByWork = new Map();
    list.forEach(sheet => {
      const title = String(sheet.work_title || sheet.sheet_name || '').trim();
      if (title) instance._sheetsByWork.set(title, sheet);
    });
    const pmRoot = String(opts?.pmRoot || instance._pmRoot || '');
    if (pmRoot && pmRoot !== instance._pmRoot) {
      instance._pmRoot = pmRoot;
      const prefs = _loadPrefs(pmRoot);
      if (prefs?.filters) {
        instance._filters.work = String(prefs.filters.work || '');
        instance._filters.status = String(prefs.filters.status || '');
        instance._filters.assignee = String(prefs.filters.assignee || '');
      }
      if (prefs?.sort?.field) {
        instance._sort = { field: String(prefs.sort.field), direction: prefs.sort.direction === 'desc' ? 'desc' : 'asc' };
      }
    } else if (pmRoot) {
      instance._pmRoot = pmRoot;
    }
    instance._emptyEl.hidden = list.length > 0;
    _renderFilterOptions(instance);
    _renderHeaderLabels(instance);
    if (!list.length) {
      instance._rows = [];
      instance._total = 0;
      _renderTable(instance);
      _renderStatus(instance);
      return true;
    }
    if (opts?.refresh === true || !instance._hasLoadedOnce) {
      return _fetchRows(instance, { append: false });
    }
    return true;
  }

  function _refresh(instance) {
    if (instance._destroyed || !instance._mounted) return Promise.resolve(false);
    return _fetchRows(instance, { append: false });
  }

  function create(options) {
    const idSuffix = String(options?.idSuffix || 'production-all').replace(/[^a-zA-Z0-9_-]+/g, '-');
    const instance = {
      idSuffix,
      onOpenWork: typeof options?.onOpenWork === 'function' ? options.onOpenWork : null,
      onOpenTask: typeof options?.onOpenTask === 'function' ? options.onOpenTask : null,
      _mounted: false,
      _destroyed: false,
      _containerEl: null,
      _emptyEl: null,
      _headerCells: new Map(),
      _tbodyEl: null,
      _selectAllEl: null,
      _searchEl: null,
      _workSelectEl: null,
      _statusSelectEl: null,
      _assigneeSelectEl: null,
      _statusEl: null,
      _loadMoreEl: null,
      _sheets: [],
      _sheetsByWork: new Map(),
      _rows: [],
      _baseRows: [],
      _rowsByPath: new Map(),
      _selectedPaths: new Set(),
      _facets: { statuses: new Set(), assignees: new Set() },
      _workMeta: {},
      _genericLabels: DEFAULT_GENERIC_LABELS.slice(),
      _filters: { work: '', status: '', assignee: '', q: '' },
      _sort: { field: 'work_title', direction: 'asc' },
      _pmRoot: '',
      _total: 0,
      _loadSeq: 0,
      _loading: false,
      _hasLoadedOnce: false,
      _errorText: '',
    };

    instance.isMounted = function () { return instance._mounted && !instance._destroyed; };

    instance.mount = function (hostEl) {
      if (instance._destroyed) {
        _logError(instance, 'destroy 済みインスタンスは再マウントできません');
        return null;
      }
      if (instance._mounted) return instance._containerEl;
      if (!hostEl || typeof hostEl.appendChild !== 'function') {
        _logError(instance, 'mount先のホスト要素が不正です');
        return null;
      }
      const container = document.createElement('div');
      container.className = 'gb-production-all-view';
      container.dataset.e2eId = 'gb-production-all-view';

      const empty = document.createElement('p');
      empty.className = 'gb-production-all-empty';
      empty.textContent = 'タスクリストがありません。「＋」から作品のタスクリストを追加できます。';
      empty.hidden = true;
      instance._emptyEl = empty;

      const toolbar = _buildToolbar(instance);
      const tableWrap = _buildTable(instance);
      const loadMore = _buildLoadMore(instance);

      container.append(empty, toolbar, tableWrap, loadMore);
      hostEl.appendChild(container);
      instance._containerEl = container;
      instance._mounted = true;
      _renderHeaderLabels(instance);
      _renderFilterOptions(instance);
      return container;
    };

    instance.open = function (sheets, opts) { return _open(instance, sheets, opts); };
    instance.refresh = function () { return _refresh(instance); };

    instance.applySchedulerProposal = function (proposal) {
      const projection = window.MeldexSchedulerProposalOverlay?.projectTaskRows?.(instance._baseRows, proposal);
      instance._rows = projection?.rows || instance._baseRows;
      _renderTable(instance);
      _renderStatus(instance);
      return projection || { rows: instance._rows, warnings: [] };
    };

    instance.setVisible = function (visible) {
      // 非表示でも DOM から外さない（埋め込みシートと同じ制約は無いが、表示状態の
      // 復元を単純にするため他のスケジュール面と同じ display 切替方式に揃える）。
      if (instance._containerEl) instance._containerEl.style.display = visible ? 'flex' : 'none';
    };

    instance.getSelectedEntryPaths = function () {
      return [...instance._selectedPaths];
    };

    instance.destroy = function () {
      if (instance._destroyed) return;
      instance._destroyed = true;
      instance._loadSeq += 1;
      instance._containerEl?.remove();
      instance._containerEl = null;
      instance._emptyEl = null;
      instance._tbodyEl = null;
      instance._headerCells = new Map();
      instance._mounted = false;
    };

    return instance;
  }

  window.MeldexProductionAllView = Object.freeze({ create });
})();
