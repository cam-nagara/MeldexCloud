/* sheet-standalone-app.js
 *
 * 単独版シートは本体のシート資産（gb-database.js + gb-db-*.js 一式）を
 * そのまま同梱し、実データの表示・編集は本体と同じ selectDatabase() /
 * selectSmartDb() / renderPivot() 等をそのまま呼び出す（本体パリティ方式。
 * ノート・シナリオ・ボード単独版と同じ「本体コード共有」パターン）。
 *
 * この IIFE 自身が持つ関数（normalizeSheet / normalizeSource / normalizeFilter /
 * CSV編集など）は、「.mel-sheet（スマートシート定義ファイル）」と「.csv」を
 * 開いた時の編集フォームを担当する（Phase 0〜3 から存在。既存の単体テストが
 * 前提にしているため関数シグネチャ・挙動は変更していない）。
 *
 * 新規追加分（Phase 4）:
 *  - 「フォルダをシートとして開く」: 本体と同じフォルダ型シート
 *    （フォルダノート + type: settings-entry のエントリファイル群）を
 *    selectDatabase(folderPath) でそのまま開く。表示・セル編集・列管理・
 *    ビュー切替（表/ギャラリー/カンバン/タイムライン/チャート/フォーム）は
 *    すべて本体エンジンがそのまま担当する。
 *  - 「.mel-sheet を開いた時の実データプレビュー」: 既存の定義編集フォームに
 *    加えて、selectSmartDb() で実際に一致するエントリを検索・表示する
 *    （renderSmartDbTable() をそのまま利用）。
 *  - Windows単独版のローカルサーバー（meldex_standalone_runtime.py +
 *    meldex_standalone_sheet_service.py）に /pivot・/db-metadata・/value・
 *    /entity/create・/smart-db・/outliner-roots を追加実装済み。
 *    Cloud/PWA版は本体のCloudデータアクセス層
 *    （gb-data-access-dropbox-expanded.part01.js の _readPivot 等）が
 *    同じ経路をすでに実装済みのため追加実装なしで動く。
 */
(function () {
  'use strict';

  const app = {
    mode: 'sheet',
    path: '',
    data: null,
    csvData: [],
    dirty: false,
    jsonDirty: false,
    // 追加分の状態（.mel-sheet/.csv編集 と フォルダ実データ表示 を区別する）。
    // 'definition' = スマートシート定義編集（既存）, 'csv' = CSV編集（既存）,
    // 'live' = フォルダを直接シートとして開いた実データ表示・編集（新規）。
    pageMode: 'definition',
  };

  function qs(id) { return document.getElementById(id); }

  function titleFromPath(path) {
    const name = String(path || '').split('/').pop() || '新規シート';
    return name.replace(/(\.mel-sheet|\.smart-db\.json|\.csv)$/i, '') || '新規シート';
  }

  function isCsvPath(path) {
    return /\.csv$/i.test(String(path || ''));
  }

  function normalizeSource(source) {
    if (source && typeof source === 'object') {
      const kind = String(source.kind || 'folder').trim() || 'folder';
      const path = String(source.path || '').replace(/\\/g, '/').trim();
      return path ? { ...source, kind, path } : null;
    }
    const path = String(source || '').replace(/\\/g, '/').trim();
    return path ? { kind: 'folder', path } : null;
  }

  function normalizeOperator(operator) {
    const value = String(operator || 'contains');
    const aliases = {
      notEquals: 'not_equals',
      notContains: 'not_contains',
      isNotEmpty: 'not_empty',
      isEmpty: 'empty',
    };
    return aliases[value] || value;
  }

  function normalizeFilter(filter, sourceType) {
    const source = filter && typeof filter === 'object' ? filter : {};
    const operator = normalizeOperator(filter?.operator || filter?.op || 'contains');
    const value = String(filter?.value ?? '');
    if (sourceType === 'all-files') {
      const column = String(filter?.column || filter?.property || filter?.field || '').trim();
      return column || value ? { ...source, column, operator, value } : null;
    }
    const property = String(filter?.property || filter?.field || filter?.column || '').trim();
    const field = ['value', 'status'].includes(filter?.field) ? filter.field : 'value';
    return property || value ? { ...source, property, field, operator, value } : null;
  }

  function filterLabel(filter) {
    return filter?.property || filter?.column || '';
  }

  function normalizeSheet(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const views = src.views && typeof src.views === 'object' ? src.views : {};
    const table = views.table && typeof views.table === 'object' ? views.table : {};
    const sourceType = src.sourceType === 'all-files' ? 'all-files' : 'db-entities';
    return {
      ...src,
      type: 'smart-db',
      name: String(src.name || ''),
      sourceType,
      sources: Array.isArray(src.sources) ? src.sources.map(normalizeSource).filter(Boolean) : [],
      filters: Array.isArray(src.filters) ? src.filters.map(filter => normalizeFilter(filter, sourceType)).filter(Boolean) : [],
      views: {
        ...views,
        table: {
          ...table,
          columns: Array.isArray(table.columns) ? table.columns.map(String) : [],
          sort: Array.isArray(table.sort) ? table.sort : [],
        },
      },
      activeView: src.activeView || 'table',
    };
  }

  function parseCsv(text) {
    const normalized = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let inQuote = false;
    let sawCell = false;
    for (let i = 0; i < normalized.length; i++) {
      const c = normalized[i];
      if (inQuote) {
        if (c === '"' && normalized[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') inQuote = false;
        else cell += c;
      } else if (c === '"') {
        inQuote = true;
        sawCell = true;
      } else if (c === ',') {
        row.push(cell);
        cell = '';
        sawCell = true;
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && normalized[i + 1] === '\n') i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        sawCell = false;
      } else {
        cell += c;
        sawCell = true;
      }
    }
    if (sawCell || cell || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  function serializeCsv(rows) {
    return rows.map(row => row.map(cell => {
      const value = String(cell ?? '');
      if (/[",\r\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
      return value;
    }).join(',')).join('\n');
  }

  function normalizeCsvRows(rows) {
    const data = Array.isArray(rows) ? rows.map(row => Array.isArray(row) ? row.map(value => String(value ?? '')) : []) : [];
    if (!data.length) return [];
    const maxCols = data.reduce((max, row) => Math.max(max, row.length), 0);
    while (data[0].length < maxCols) data[0].push('列' + (data[0].length + 1));
    for (let ri = 1; ri < data.length; ri++) {
      while (data[ri].length < data[0].length) data[ri].push('');
    }
    return data;
  }

  function setDirty(flag) {
    app.dirty = !!flag;
    document.title = (app.dirty ? '* ' : '') + 'Meldex Sheet';
  }

  function setMode(mode) {
    app.mode = mode === 'csv' ? 'csv' : 'sheet';
    document.body.dataset.sheetMode = app.mode;
    qs('sheet-definition-row').hidden = app.mode === 'csv';
    qs('sheet-csv-panel').hidden = app.mode !== 'csv';
    setPageMode(app.mode === 'csv' ? 'csv' : 'definition');
  }

  // -------------------------------------------------------------------
  // 実データ表示（Phase 4 新規）: 本体エンジンの描画先切替
  // -------------------------------------------------------------------

  // 本体の showView() は state.view / #db-view-container 系の固定IDを直接
  // 触るため、単独版でも同じIDを用意し、この単独版専用のshowView()で
  // 「今どのビューを表示するか」を切り替える（本体のgb-app.jsは
  // フォルダツリー・タブ・複数ペイン等に深く結合しているため同梱しない。
  // 表示切替ロジックだけを本体と同じ分岐で単独版向けに再実装している）。
  function showView(viewName, ctx) {
    const resolvedViewName = ['calendar', 'tasks', 'shifts'].includes(viewName) ? 'timeline' : viewName;
    const isDbView = ['pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db', 'calendar', 'tasks', 'shifts'].includes(viewName);
    const setDisplay = (id, value) => {
      const el = qs(id);
      if (el) el.style.display = value;
    };
    qs('sheet-live-root').hidden = false;
    setDisplay('welcome-view', resolvedViewName === 'welcome' ? 'flex' : 'none');
    setDisplay('db-view-container', (isDbView && resolvedViewName !== 'smart-db') ? 'flex' : 'none');
    setDisplay('pivot-view', resolvedViewName === 'pivot' ? '' : 'none');
    setDisplay('gallery-view', resolvedViewName === 'gallery' ? 'flex' : 'none');
    setDisplay('kanban-view', resolvedViewName === 'kanban' ? 'flex' : 'none');
    setDisplay('timeline-view', resolvedViewName === 'timeline' ? '' : 'none');
    setDisplay('chart-view', resolvedViewName === 'chart' ? 'flex' : 'none');
    setDisplay('graph-view', resolvedViewName === 'graph' ? 'flex' : 'none');
    setDisplay('form-view', resolvedViewName === 'form' ? 'flex' : 'none');
    setDisplay('smart-db-view', resolvedViewName === 'smart-db' ? 'flex' : 'none');
    setDisplay('entity-view', resolvedViewName === 'entity' ? 'flex' : 'none');
    const entityRt = qs('entity-rt-toolbar');
    if (entityRt) entityRt.style.display = (resolvedViewName === 'entity') ? 'flex' : 'none';
    const dbToolbar = qs('sheet-db-toolbar');
    if (dbToolbar) dbToolbar.hidden = !(isDbView && resolvedViewName !== 'smart-db');
    state.view = viewName;
    if (ctx) ctx.viewMode = viewName;
  }
  window.showView = showView;

  // 'definition' = .mel-sheet 定義編集（既存フォーム表示中も実データ
  // プレビューは見える）, 'csv' = 既存CSV編集, 'live' = フォルダを
  // 直接開いた実データ編集（本体のシート機能そのもの）。
  function setPageMode(pageMode) {
    app.pageMode = pageMode;
    document.body.dataset.sheetPageMode = pageMode;
    const liveRoot = qs('sheet-live-root');
    if (pageMode === 'csv') {
      liveRoot.hidden = true;
      qs('sheet-db-toolbar').hidden = true;
      return;
    }
    if (pageMode === 'definition') {
      // プレビューが無ければ welcome を出しておく（表示切替はrenderSmartDbPreviewが担当）。
      liveRoot.hidden = false;
    }
    // pageMode === 'live' は selectDatabase() → showView() が中身を出し分ける。
  }

  function setPath(path) {
    app.path = String(path || '').replace(/\\/g, '/');
    MeldexStandaloneFS.setCurrentPath?.(app.path);
    qs('sheet-title-label').textContent = app.path ? titleFromPath(app.path) : '新規シート';
    qs('sheet-path-label').textContent = app.path ? MeldexStandaloneFS.pathLabel(app.path) : '未保存';
    syncOptionPanel().catch(error => console.error('option panel sync failed', error));
  }

  // -------------------------------------------------------------------
  // オプションパネル配線（Phase 0 共通基盤 + Phase 4 拡張）。
  // 「公開」「バックリンク」は保管庫全体の機能に依存するため単独版では
  // 機能せず、行き止まりタブとして残さず隠す（ノート単独版Phase 3と同じ
  // 理由・同じ手当て。非同期再表示に備えて MutationObserver で監視する）。
  // -------------------------------------------------------------------
  let _hideUnsupportedTabsObserver = null;
  function hideUnsupportedOptionTabs() {
    document.querySelectorAll('.detail-tab-publish, .detail-tab-backlinks').forEach(tab => {
      if (!tab.hidden) tab.hidden = true;
    });
  }
  function watchUnsupportedOptionTabs() {
    const tabBar = qs('detail-tab-bar');
    if (!tabBar || _hideUnsupportedTabsObserver) return;
    _hideUnsupportedTabsObserver = new MutationObserver(hideUnsupportedOptionTabs);
    _hideUnsupportedTabsObserver.observe(tabBar, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  }

  function ensureDetailPanelCfgVisible() {
    try {
      const cfg = JSON.parse(localStorage.getItem('detail-panel-cfg') || '{}');
      if (cfg.visible !== true) {
        cfg.visible = true;
        localStorage.setItem('detail-panel-cfg', JSON.stringify(cfg));
      }
    } catch {
      localStorage.setItem('detail-panel-cfg', JSON.stringify({ visible: true }));
    }
  }

  // type='database' はフォルダ実データ表示（列の表示・型・スタイル等が
  // 本体と同じタブで操作できる）、'smart-db' は .mel-sheet 定義編集
  // （プレビュー用の公開/スタイルタブのみ）、'csv' はCSV編集。
  async function syncOptionPanel() {
    if (typeof _syncDetailPanel !== 'function') return;
    const type = app.pageMode === 'live' ? 'database' : (app.mode === 'csv' ? 'csv' : 'smart-db');
    const label = qs('sheet-title-label')?.textContent || '';
    await _syncDetailPanel(label, app.path, type, {});
    watchUnsupportedOptionTabs();
    hideUnsupportedOptionTabs();
  }

  function renderRows() {
    const sourceBody = qs('sheet-source-rows');
    const filterBody = qs('sheet-filter-rows');
    sourceBody.textContent = '';
    filterBody.textContent = '';
    app.data.sources.forEach((source, index) => {
      const sourcePath = source?.path || '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>参照</td><td colspan="2"><input data-source-index="${index}" value="${esc(sourcePath)}" placeholder="フォルダまたはファイル"></td><td class="sheet-row-actions"><button class="sa-text-btn" type="button" data-remove-source="${index}">削除</button></td>`;
      sourceBody.appendChild(tr);
    });
    const addSource = document.createElement('tr');
    addSource.innerHTML = '<td>参照</td><td colspan="3"><button class="sa-text-btn" type="button" data-add-source>参照を追加</button></td>';
    sourceBody.appendChild(addSource);

    app.data.filters.forEach((filter, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>フィルタ</td>
        <td><input data-filter-field="${index}" value="${esc(filterLabel(filter))}" placeholder="列名"></td>
        <td><select data-filter-operator="${index}">
          <option value="contains">含む</option>
          <option value="equals">等しい</option>
          <option value="not_equals">等しくない</option>
          <option value="not_contains">含まない</option>
          <option value="not_empty">空でない</option>
          <option value="empty">空</option>
        </select><input data-filter-value="${index}" value="${esc(filter.value)}" placeholder="値"></td>
        <td class="sheet-row-actions"><button class="sa-text-btn" type="button" data-remove-filter="${index}">削除</button></td>`;
      filterBody.appendChild(tr);
      tr.querySelector(`[data-filter-operator="${index}"]`).value = filter.operator || 'contains';
    });
    const addFilter = document.createElement('tr');
    addFilter.innerHTML = '<td>フィルタ</td><td colspan="3"><button class="sa-text-btn" type="button" data-add-filter>フィルタを追加</button></td>';
    filterBody.appendChild(addFilter);
  }

  function render() {
    if (app.mode === 'csv') {
      renderCsv();
      return;
    }
    qs('sheet-name').value = app.data.name || '';
    qs('sheet-source-type').value = app.data.sourceType || 'db-entities';
    qs('sheet-columns').value = (app.data.views?.table?.columns || []).join(', ');
    renderRows();
    qs('sheet-json').value = JSON.stringify(app.data, null, 2);
    app.jsonDirty = false;
    refreshSmartDbPreview();
  }

  // -------------------------------------------------------------------
  // 実データプレビュー（Phase 4 新規）: .mel-sheet 定義に一致する実際の
  // エントリを本体の selectSmartDb()/renderSmartDbTable() でそのまま表示する。
  // 定義そのものの保存は既存の collectFromForm()/collectJson() が担当し、
  // ここでは「今の定義でどのエントリが一致するか」を確認用に描画するだけ
  // （保存前でも参照できる。プレビュー結果は保存しない）。
  // -------------------------------------------------------------------
  const SMART_DB_PREVIEW_ID = 'standalone-preview';
  let _previewSeq = 0;

  async function refreshSmartDbPreview() {
    if (app.pageMode === 'csv' || app.mode === 'csv' || !app.data) return;
    if (typeof selectSmartDb !== 'function') return;
    const seq = ++_previewSeq;
    const def = { ...app.data, id: SMART_DB_PREVIEW_ID };
    try {
      await selectSmartDb(SMART_DB_PREVIEW_ID, def, {
        skipSaveLastView: true,
        skipNavPush: true,
        skipRecent: true,
        skipHighlight: true,
        skipAutoVersion: true,
        skipHistoryScope: true,
        skipGlobalUi: true,
        silent: true,
      });
    } catch (error) {
      if (seq === _previewSeq) showStatus('プレビューを更新できません: ' + (error?.message || error), true);
    }
  }

  function csvHeaders() {
    return app.csvData[0] || [];
  }

  function csvUniqueHeader(base, excludeIndex = null) {
    const used = new Set(csvHeaders()
      .map((header, index) => index === excludeIndex ? null : String(header))
      .filter(header => header));
    const cleanBase = String(base || '').trim() || '列';
    let name = cleanBase;
    let index = 2;
    while (used.has(name)) {
      name = `${cleanBase} ${index}`;
      index += 1;
    }
    return name;
  }

  function csvEnsureHeader() {
    if (!app.csvData.length) app.csvData.push([]);
    if (!csvHeaders().length) {
      const name = csvUniqueHeader('列1');
      csvHeaders().push(name);
    }
  }

  function clearCsvSelection() {
    document.querySelectorAll('.sheet-csv-selected').forEach(el => el.classList.remove('sheet-csv-selected'));
  }

  function addCsvHeaderCell(row, value, ci) {
    const th = document.createElement('th');
    th.textContent = value;
    th.dataset.col = String(ci);
    th.addEventListener('click', () => {
      if (th.querySelector('input')) return;
      if (th.classList.contains('sheet-csv-selected')) {
        startCsvHeaderEdit(th, ci);
        return;
      }
      clearCsvSelection();
      th.classList.add('sheet-csv-selected');
    });
    th.addEventListener('dblclick', () => startCsvHeaderEdit(th, ci));
    row.appendChild(th);
  }

  function addCsvCell(rowEl, row, ri, ci) {
    const td = document.createElement('td');
    td.textContent = row[ci] ?? '';
    td.dataset.row = String(ri);
    td.dataset.col = String(ci);
    td.addEventListener('click', () => {
      if (td.querySelector('input, textarea')) return;
      if (td.classList.contains('sheet-csv-selected')) {
        startCsvCellEdit(td, ri, ci);
        return;
      }
      clearCsvSelection();
      td.classList.add('sheet-csv-selected');
    });
    td.addEventListener('dblclick', () => startCsvCellEdit(td, ri, ci));
    rowEl.appendChild(td);
  }

  function renderCsv() {
    const table = qs('sheet-csv-table');
    table.textContent = '';
    if (!app.csvData.length) {
      const tbody = document.createElement('tbody');
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'sheet-csv-empty';
      td.textContent = '空のCSVファイルです';
      tr.appendChild(td);
      tbody.appendChild(tr);
      table.appendChild(tbody);
      return;
    }
    const headers = csvHeaders();
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const thNum = document.createElement('th');
    thNum.className = 'sheet-csv-row-num';
    thNum.textContent = '#';
    headerRow.appendChild(thNum);
    headers.forEach((header, ci) => addCsvHeaderCell(headerRow, header, ci));
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let ri = 1; ri < app.csvData.length; ri++) {
      const tr = document.createElement('tr');
      const tdNum = document.createElement('td');
      tdNum.className = 'sheet-csv-row-num';
      tdNum.textContent = String(ri);
      tr.appendChild(tdNum);
      for (let ci = 0; ci < headers.length; ci++) addCsvCell(tr, app.csvData[ri], ri, ci);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  function startCsvCellEdit(td, ri, ci) {
    if (td.querySelector('input, textarea')) return;
    const value = app.csvData[ri]?.[ci] ?? '';
    const input = document.createElement(value.includes('\n') ? 'textarea' : 'input');
    if (input.tagName === 'INPUT') input.type = 'text';
    input.value = value;
    input.className = 'sheet-csv-input';
    input.dataset.csvEditKind = 'cell';
    input.dataset.row = String(ri);
    input.dataset.col = String(ci);
    let cancelled = false;
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select?.();
    input.addEventListener('blur', () => {
      if (!cancelled && input.dataset.commitHandled !== '1') commitCsvCellEdit(td, input.value, ri, ci);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && input.tagName === 'INPUT') input.blur();
      else if (event.key === 'Enter' && event.ctrlKey) input.blur();
      else if (event.key === 'Escape') {
        cancelled = true;
        td.textContent = value;
      }
    });
  }

  function commitCsvCellEdit(td, newValue, ri, ci) {
    if (!app.csvData[ri]) return;
    while (app.csvData[ri].length <= ci) app.csvData[ri].push('');
    app.csvData[ri][ci] = String(newValue ?? '');
    td.textContent = app.csvData[ri][ci];
    setDirty(true);
  }

  function startCsvHeaderEdit(th, ci) {
    if (th.querySelector('input')) return;
    const value = csvHeaders()[ci] ?? '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.className = 'sheet-csv-input';
    input.dataset.csvEditKind = 'header';
    input.dataset.col = String(ci);
    let cancelled = false;
    th.textContent = '';
    th.appendChild(input);
    input.focus();
    input.select();
    input.addEventListener('blur', () => {
      if (!cancelled && input.dataset.commitHandled !== '1') commitCsvHeaderEdit(th, input.value, ci);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') input.blur();
      else if (event.key === 'Escape') {
        cancelled = true;
        th.textContent = value;
      }
    });
  }

  function commitCsvHeaderEdit(th, newValue, ci) {
    csvEnsureHeader();
    const value = csvUniqueHeader(newValue || ('列' + (ci + 1)), ci);
    csvHeaders()[ci] = value;
    th.textContent = value;
    setDirty(true);
  }

  function commitActiveCsvEditor() {
    const editor = document.querySelector('#sheet-csv-table .sheet-csv-input');
    if (!editor) return;
    editor.dataset.commitHandled = '1';
    const host = editor.closest('td,th');
    if (!host) return;
    if (editor.dataset.csvEditKind === 'header') {
      commitCsvHeaderEdit(host, editor.value, Number(editor.dataset.col || 0));
      return;
    }
    commitCsvCellEdit(host, editor.value, Number(editor.dataset.row || 0), Number(editor.dataset.col || 0));
  }

  function addCsvRow() {
    commitActiveCsvEditor();
    csvEnsureHeader();
    app.csvData.push(new Array(csvHeaders().length).fill(''));
    renderCsv();
    setDirty(true);
  }

  function addCsvColumn() {
    commitActiveCsvEditor();
    if (!app.csvData.length) app.csvData.push([]);
    const name = csvUniqueHeader('新規列');
    csvHeaders().push(name);
    for (let ri = 1; ri < app.csvData.length; ri++) app.csvData[ri].push('');
    renderCsv();
    setDirty(true);
  }

  function collectCsv() {
    commitActiveCsvEditor();
    return '\uFEFF' + serializeCsv(normalizeCsvRows(app.csvData));
  }

  function collectFromForm() {
    if (app.mode === 'csv') return app.data;
    const data = normalizeSheet(app.data || {});
    data.name = qs('sheet-name').value.trim();
    data.sourceType = qs('sheet-source-type').value === 'all-files' ? 'all-files' : 'db-entities';
    data.sources = [...document.querySelectorAll('[data-source-index]')]
      .map(input => {
        const index = Number(input.dataset.sourceIndex);
        return normalizeSource({ ...(data.sources[index] || {}), path: input.value });
      })
      .filter(Boolean);
    data.views.table.columns = qs('sheet-columns').value.split(',').map(value => value.trim()).filter(Boolean);
    data.filters = [...document.querySelectorAll('[data-filter-field]')].map(input => {
      const index = input.dataset.filterField;
      const key = input.value.trim();
      const operator = document.querySelector(`[data-filter-operator="${index}"]`)?.value || 'contains';
      const value = document.querySelector(`[data-filter-value="${index}"]`)?.value || '';
      const original = data.filters[Number(index)] || {};
      return normalizeFilter(
        data.sourceType === 'all-files'
          ? { ...original, column: key, operator, value }
          : { ...original, property: key, field: original.field || 'value', operator, value },
        data.sourceType
      );
    }).filter(Boolean);
    app.data = data;
    qs('sheet-json').value = JSON.stringify(data, null, 2);
    app.jsonDirty = false;
    return data;
  }

  function collectJson() {
    if (app.mode === 'csv') return collectCsv();
    if (app.jsonDirty) {
      app.data = normalizeSheet(JSON.parse(qs('sheet-json').value || '{}'));
      qs('sheet-json').value = JSON.stringify(app.data, null, 2);
      app.jsonDirty = false;
    } else {
      collectFromForm();
    }
    return JSON.stringify(app.data, null, 2) + '\n';
  }

  async function newSheet() {
    if (app.dirty && !(await cfConfirm('未保存の変更を破棄しますか？'))) return;
    const content = await MeldexStandaloneFS.newContent('無題');
    setMode('sheet');
    app.data = normalizeSheet(JSON.parse(content));
    app.csvData = [];
    setPath('');
    render();
    setDirty(false);
  }

  async function openPath(path) {
    showLoading('シートを読み込んでいます...');
    try {
      const data = await MeldexStandaloneFS.readText(path);
      if (isCsvPath(path)) {
        setMode('csv');
        app.csvData = normalizeCsvRows(parseCsv(data.content || ''));
        app.data = null;
      } else {
        setMode('sheet');
        app.data = normalizeSheet(JSON.parse(data.content || '{}'));
        app.csvData = [];
      }
      setPath(path);
      render();
      setDirty(false);
      showStatus(app.mode === 'csv' ? 'CSVを読み込みました' : 'シートを読み込みました');
    } catch (error) {
      if (MeldexStandaloneFS.currentPath?.() !== path) {
        await MeldexStandaloneFS.releaseEditLock?.(path);
        MeldexStandaloneFS.discardRememberedPath?.(path);
      }
      throw error;
    } finally {
      hideLoading();
    }
  }

  async function openSheet() {
    if (app.dirty && !(await cfConfirm('未保存の変更を破棄して開きますか？'))) {
      MeldexStandaloneFS.discardQueuedOpen?.();
      return;
    }
    const selected = await MeldexStandaloneFS.openFile();
    if (selected?.path) await openPath(selected.path);
  }

  // -------------------------------------------------------------------
  // フォルダを直接シートとして開く（Phase 4 新規）。
  // 本体の「シート」はフォルダ（フォルダノート + type: settings-entry の
  // エントリファイル群）そのものであり、単独版でも同じ形式を
  // selectDatabase(folderPath) でそのまま開く。フォルダ選択は既存の
  // standalone-workspace-tree.js の pickFolder()（Cloud/Windows共通）を使う。
  // -------------------------------------------------------------------
  function liveFolderTitle(path) {
    const value = String(path || '').replace(/\/+$/, '');
    if (!value) return MeldexStandaloneFS.rootLabel?.() || 'ルート';
    return value.split('/').pop() || value;
  }

  async function openLiveFolder(path) {
    if (typeof selectDatabase !== 'function') {
      showStatus('シートエンジンを読み込めませんでした', true);
      return;
    }
    const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    showLoading('シートを読み込んでいます...');
    try {
      setPageMode('live');
      app.path = normalized;
      app.mode = 'sheet';
      MeldexStandaloneFS.setCurrentPath?.(normalized);
      state.currentDbPath = normalized;
      qs('sheet-title-label').textContent = liveFolderTitle(normalized);
      qs('sheet-path-label').textContent = normalized ? MeldexStandaloneFS.pathLabel(normalized) : 'ルート直下';
      document.title = 'Meldex Sheet';
      await selectDatabase(normalized);
      syncOptionPanel().catch(error => console.error('option panel sync failed', error));
      showStatus('シートを開きました');
    } catch (error) {
      showStatus('シートを開けませんでした: ' + (error?.message || error), true);
    } finally {
      hideLoading();
    }
  }

  async function openFolderAsSheet() {
    if (app.pageMode !== 'live' && app.dirty && !(await cfConfirm('未保存の変更を破棄して開きますか？'))) return;
    // Cloud/PWA版: standalone-workspace-tree.js のフォルダ選択ダイアログ
    // （保管庫ツリーから選ぶ）。Windows単独版: ワークスペースツリーは
    // Cloudモード専用のため未構築 → ネイティブのフォルダ選択ダイアログを
    // 使う（meldex_standalone_runtime.py の /standalone/pick-folder。
    // 開いている保存先の外は選べない）。
    const isCloud = window.MeldexStandaloneCloud?.isCloudMode?.() === true;
    if (isCloud) {
      const tree = window.MeldexStandaloneWorkspaceTree;
      if (!tree?.pickFolder) {
        showStatus('フォルダ選択を利用できません', true);
        return;
      }
      const picked = await tree.pickFolder({ title: 'シートとして開くフォルダを選択' });
      if (!picked) return;
      await openLiveFolder(picked.path || '');
      return;
    }
    try {
      const picked = await apiPost('/standalone/pick-folder', {});
      if (picked?.path == null) return;
      await openLiveFolder(picked.path || '');
    } catch (error) {
      if (error?.status === 499) return;
      showStatus('フォルダを選べませんでした: ' + (error?.message || error), true);
    }
  }

  async function saveSheet() {
    if (app.pageMode === 'live') {
      showStatus('フォルダのシートはセルを編集するたびに自動保存されています');
      return;
    }
    if (!app.path) {
      await saveSheetAs();
      return;
    }
    showLoading('シートを保存しています...');
    try {
      const res = await MeldexStandaloneFS.writeText(app.path, app.mode === 'csv' ? collectCsv() : collectJson(), { skip_if_missing: true });
      if (res?.skipped || res?.missing) {
        showStatus('保存先が見つかりません。名前を付けて保存してください', true);
        await saveSheetAs();
        return;
      }
      setDirty(false);
      showStatus('保存しました');
    } catch (error) {
      showStatus('保存できません: ' + (error.message || error), true);
      throw error;
    } finally {
      hideLoading();
    }
  }

  async function saveSheetAs() {
    if (app.pageMode === 'live') {
      showStatus('フォルダのシートは名前を付けて保存できません（自動保存済み）', true);
      return;
    }
    let content = '';
    try {
      content = app.mode === 'csv' ? collectCsv() : collectJson();
    } catch (error) {
      showStatus('保存できません: ' + (error.message || error), true);
      throw error;
    }
    const fallbackName = app.mode === 'csv' ? '無題.csv' : '無題.mel-sheet';
    const saved = await MeldexStandaloneFS.saveAs(content, MeldexStandaloneFS.suggestedName(app.path, fallbackName));
    if (!saved?.path) return;
    setPath(saved.path);
    setDirty(false);
    showStatus('保存しました');
  }

  function syncJsonToForm() {
    if (app.mode === 'csv') {
      showStatus('CSVモードではJSONを使いません', true);
      return;
    }
    try {
      app.data = normalizeSheet(JSON.parse(qs('sheet-json').value || '{}'));
      render();
      setDirty(true);
      showStatus('JSONを反映しました');
    } catch (error) {
      showStatus('JSONを読み取れません: ' + (error.message || error), true);
    }
  }

  function bindMenus() {
    attachStandaloneMenu(qs('sheet-menu-button'), qs('sheet-menu'));
    document.addEventListener('click', async event => {
      const action = event.target.closest('[data-sheet-action]')?.dataset.sheetAction;
      if (!action) return;
      if (action === 'new') await window.runStandaloneFileAction('新規作成', newSheet);
      if (action === 'open') await window.runStandaloneFileAction('シートを開くことが', openSheet);
      if (action === 'openFolder') await window.runStandaloneFileAction('フォルダを開くことが', openFolderAsSheet);
      if (action === 'save') await window.runStandaloneFileAction('保存', saveSheet);
      if (action === 'saveAs') await window.runStandaloneFileAction('名前を付けて保存', saveSheetAs);
      if (action === 'addFilter') {
        if (app.mode === 'csv') {
          showStatus('CSVモードではフィルタを追加できません', true);
          return;
        }
        app.data.filters.push({ property: '', field: 'value', operator: 'contains', value: '' });
        render();
        setDirty(true);
      }
      if (action === 'syncJson') syncJsonToForm();
      if (action === 'refreshPreview') await window.runStandaloneFileAction('プレビュー更新', refreshSmartDbPreview);
    });
    qs('sheet-format-json').addEventListener('click', syncJsonToForm);
    qs('sheet-csv-add-row').addEventListener('click', addCsvRow);
    qs('sheet-csv-add-col').addEventListener('click', addCsvColumn);
  }

  // -------------------------------------------------------------------
  // フォルダ実データ表示のツールバー（Phase 4 新規）。本体の #tb-db が
  // 呼ぶのと同じ本体関数をそのまま呼ぶ（未読込・未対応の場合は静かに
  // no-op にする。本体のツールバーそのものは同梱していない— data-action
  // 経由の暗黙依存を避け、明示的にバインドする方針。ノート単独版Phase 3と同じ）。
  // -------------------------------------------------------------------
  function bindDbToolbar() {
    function on(id, fn) {
      qs(id)?.addEventListener('click', event => {
        if (typeof fn === 'function') fn(event);
        else showStatus('この操作は単独版では利用できません', true);
      });
    }
    on('sheet-tb-undo', () => { if (typeof meldexUndo === 'function') meldexUndo(); });
    on('sheet-tb-redo', () => { if (typeof meldexRedo === 'function') meldexRedo(); });
    on('sheet-tb-filter', () => { if (typeof showUnifiedFilterModal === 'function') showUnifiedFilterModal(); });
    on('sheet-tb-sort', event => { if (typeof showDbSortMenu === 'function') showDbSortMenu(event); });
    on('sheet-tb-cell-wrap', event => { if (typeof showDbCellWrapMenu === 'function') showDbCellWrapMenu(event); });
    on('sheet-tb-autofit', () => { if (typeof autoFitCurrentSheetColumns === 'function') autoFitCurrentSheetColumns(); });
    on('sheet-tb-columns', () => { if (typeof showColumnDisplayOrderModal === 'function') showColumnDisplayOrderModal(); });
    on('sheet-tb-reload', async () => {
      if (app.pageMode === 'live' && app.path && typeof selectDatabase === 'function') {
        await selectDatabase(app.path, null, { forceReload: true });
        showStatus('再読み込みしました');
      }
    });
    on('sheet-tb-smart-refresh', () => { refreshSmartDbPreview(); });
  }

  // スマホ幅（≤820px）で優先操作だけを常時表示し、残りを「その他」ボトムシートへ畳む
  // （計画書: standalone-mobile-toolbar_plan_2026-07-20.md §4）。
  // ビュー切替はツールバー外の .db-main-view-switcher にあるため、畳み対象には含まれない。
  function initMobileToolbar() {
    window.MeldexStandaloneMobileToolbar?.setup({
      toolbar: '#sheet-db-toolbar',
      priority: ['#sheet-tb-undo', '#sheet-tb-redo', '#sheet-tb-filter', '#sheet-tb-sort'],
      keep: [],
      sheetTitle: 'その他',
    });
  }

  function bindEditor() {
    document.addEventListener('input', event => {
      if (event.target.closest('.sheet-main')) {
        if (app.mode === 'csv') return;
        if (event.target.id === 'sheet-json') app.jsonDirty = true;
        else collectFromForm();
        setDirty(true);
      }
    });
    document.addEventListener('change', event => {
      if (event.target.closest('.sheet-main')) {
        if (app.mode === 'csv') return;
        if (event.target.id === 'sheet-json') app.jsonDirty = true;
        else {
          collectFromForm();
          refreshSmartDbPreview();
        }
        setDirty(true);
      }
    });
    document.addEventListener('click', event => {
      const addSource = event.target.closest('[data-add-source]');
      const addFilter = event.target.closest('[data-add-filter]');
      const removeSource = event.target.closest('[data-remove-source]');
      const removeFilter = event.target.closest('[data-remove-filter]');
      if (app.mode === 'csv') return;
      if (addSource) app.data.sources.push({ kind: 'folder', path: '' });
      if (addFilter) app.data.filters.push({ property: '', field: 'value', operator: 'contains', value: '' });
      if (removeSource) app.data.sources.splice(Number(removeSource.dataset.removeSource), 1);
      if (removeFilter) app.data.filters.splice(Number(removeFilter.dataset.removeFilter), 1);
      if (addSource || addFilter || removeSource || removeFilter) {
        render();
        setDirty(true);
      }
    });
  }

  function bindShortcuts() {
    document.addEventListener('keydown', async event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        await window.runStandaloneFileAction('保存', saveSheet);
      } else if (key === 'o') {
        event.preventDefault();
        await window.runStandaloneFileAction('シートを開くことが', openSheet);
      } else if (key === 'n') {
        event.preventDefault();
        await window.runStandaloneFileAction('新規作成', newSheet);
      } else if (key === 'z' || key === 'y') {
        // contentEditable（エントリの自由記述欄等）や入力欄にフォーカスがある間は
        // ブラウザ標準のundo/redoに委譲する（本体 gb-shortcuts.part01.js と同じ判定）。
        const ae = document.activeElement;
        if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
        event.preventDefault();
        if (key === 'z' && !event.shiftKey) {
          if (typeof meldexUndo === 'function') meldexUndo();
        } else if (typeof meldexRedo === 'function') {
          meldexRedo();
        }
      }
    });
  }

  function bindPathChanges() {
    window.addEventListener('meldex:file-path-renamed', event => {
      const oldPath = String(event?.detail?.oldPath || '').replace(/\\/g, '/');
      const newPath = String(event?.detail?.newPath || '').replace(/\\/g, '/');
      if (oldPath && newPath && app.path === oldPath) setPath(newPath);
    });
  }

  function initOptionPanel() {
    ensureDetailPanelCfgVisible();
    window.MeldexStandaloneOptionPanel?.init({
      storagePrefix: 'meldex-sheet',
      toggleButtonIds: ['sheet-option-panel-button'],
      defaultWidth: 360,
    });
  }

  async function init() {
    await MeldexStandaloneFS.init();
    initOptionPanel();
    bindMenus();
    bindEditor();
    bindShortcuts();
    bindPathChanges();
    bindDbToolbar();
    initMobileToolbar();
    const initial = MeldexStandaloneFS.nativeInitialPath();
    if (!initial) await newSheet();
    else {
      try { await openPath(initial); }
      catch {
        await newSheet();
        showStatus('前回のシートを開けなかったため、新規シートで起動しました', true);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => showStatus('シートの初期化に失敗: ' + (error.message || error), true));
  });
})();
