/* sheet-standalone-app.js */
(function () {
  'use strict';

  const app = {
    mode: 'sheet',
    path: '',
    data: null,
    csvData: [],
    dirty: false,
    jsonDirty: false,
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
    qs('sheet-definition-panel').hidden = app.mode === 'csv';
    qs('sheet-json-panel').hidden = app.mode === 'csv';
    qs('sheet-csv-panel').hidden = app.mode !== 'csv';
  }

  function setPath(path) {
    app.path = String(path || '').replace(/\\/g, '/');
    MeldexStandaloneFS.setCurrentPath?.(app.path);
    qs('sheet-title-label').textContent = app.path ? titleFromPath(app.path) : '新規シート';
    qs('sheet-path-label').textContent = app.path ? MeldexStandaloneFS.pathLabel(app.path) : '未保存';
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

  async function saveSheet() {
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
    });
    qs('sheet-format-json').addEventListener('click', syncJsonToForm);
    qs('sheet-csv-add-row').addEventListener('click', addCsvRow);
    qs('sheet-csv-add-col').addEventListener('click', addCsvColumn);
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
        else collectFromForm();
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

  async function init() {
    await MeldexStandaloneFS.init();
    bindMenus();
    bindEditor();
    bindShortcuts();
    bindPathChanges();
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
