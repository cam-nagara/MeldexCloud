/* gb-csv-workbench.js: CSVで再現可能な編集操作だけを提供するシート面。 */
(function (root) {
  'use strict';

  const ROW_HEIGHT = 29;
  const VIRTUAL_THRESHOLD = 500;
  const VIRTUAL_BUFFER = 35;
  const model = {
    path: '',
    dialect: null,
    columns: [],
    filters: {},
    sortKeys: [],
    selection: null,
    matchIndex: -1,
    metadataTimer: 0,
    metadataRevision: '',
    metadataExists: false,
    metadataSavePromise: Promise.resolve(),
    scrollBound: null,
    dragSelecting: false,
    menuOutsideHandler: null,
  };

  function host() { return root.MeldexCsvHost; }
  function state() { return host()?.getState?.() || { data: [], headers: [], active: false }; }
  function data() { return state().data || []; }
  function headers() { return state().headers || []; }
  function table() {
    if (state().active) return document.getElementById('pivot-table');
    return document.getElementById('csv-table');
  }
  function scrollHost() {
    const target = table();
    return target?.parentElement || null;
  }
  function showMessage(message, isError) {
    if (typeof showStatus === 'function') showStatus(message, !!isError);
  }
  function setDecoratedText(element, value) {
    if (!element) return;
    const displayText = String(value ?? '');
    element.textContent = displayText;
    if (typeof MeldexAutoLink === 'undefined' || displayText.length < 2) return;
    MeldexAutoLink.applyToDom(element, model.path || '');
  }
  function handleAutoLinkClick(event) {
    const link = event?.target?.closest?.('.auto-link[data-path]');
    if (!link || typeof onAutoLinkClick !== 'function') return false;
    event.preventDefault();
    event.stopPropagation();
    onAutoLinkClick(link, event);
    return true;
  }
  function cloneRows(rows) {
    return (rows || []).map(row => Array.isArray(row) ? row.slice() : []);
  }
  function mutation(label, callback) {
    const api = host();
    const before = api.snapshot();
    callback();
    api.normalize();
    reconcileColumns();
    api.registerHistory(label, before);
    render(true);
    scheduleMetadataSave();
  }

  function defaultColumn(index, name) {
    const inferred = root.MeldexCsv.inferColumn(data().slice(1).map(row => row?.[index] ?? ''));
    return {
      id: `column-${index + 1}`,
      name: String(name || `列${index + 1}`),
      type: inferred.type,
      formula: inferred.formula,
      width: 140,
      wrap: false,
      hidden: false,
      frozen: false,
      warning: inferred.warning,
    };
  }

  function reconcileColumns() {
    const current = model.columns || [];
    model.columns = headers().map((name, index) => {
      const found = current[index] || defaultColumn(index, name);
      return {
        id: found.id || `column-${index + 1}`,
        name: String(name || `列${index + 1}`),
        type: ['text', 'number', 'formula'].includes(found.type) ? found.type : 'text',
        formula: String(found.formula || ''),
        width: Math.max(64, Math.min(800, Number(found.width) || 140)),
        wrap: found.wrap === true,
        hidden: found.hidden === true,
        frozen: found.frozen === true,
        warning: String(found.warning || ''),
      };
    });
    Object.keys(model.filters).forEach(key => {
      if (Number(key) >= model.columns.length) delete model.filters[key];
    });
    const validIds = new Set(model.columns.map(column => column.id));
    model.sortKeys = (model.sortKeys || []).filter(key => validIds.has(key.columnId));
  }

  function metadataPayload() {
    return {
      schemaVersion: 1,
      sourcePath: model.path,
      dialect: root.MeldexCsv.normalizeDialect(model.dialect),
      columns: model.columns.map(column => ({ ...column })),
      filters: { ...model.filters },
      sortKeys: model.sortKeys.map(key => ({ ...key })),
      updatedAt: new Date().toISOString(),
    };
  }

  async function loadMetadata() {
    if (!model.path || typeof apiFetch !== 'function') return false;
    const metadataPath = root.MeldexCsv.metadataPath(model.path);
    model.metadataRevision = '';
    model.metadataExists = false;
    try {
      const result = await apiFetch('/file?path=' + encodeURIComponent(metadataPath), { silentError: true });
      model.metadataExists = true;
      model.metadataRevision = result?.transport_revision || result?.etag || '';
      const parsed = JSON.parse(result?.content || '{}');
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.columns)) return false;
      model.dialect = root.MeldexCsv.normalizeDialect({ ...model.dialect, ...(parsed.dialect || {}) });
      model.columns = parsed.columns;
      model.filters = parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {};
      model.sortKeys = Array.isArray(parsed.sortKeys) ? parsed.sortKeys : [];
      reconcileColumns();
      return true;
    } catch {
      return false;
    }
  }

  async function saveMetadata() {
    clearTimeout(model.metadataTimer);
    model.metadataTimer = 0;
    if (!model.path || typeof apiPut !== 'function') return false;
    const pathAtRequest = model.path;
    const payloadAtRequest = metadataPayload();
    const revisionAtRequest = model.metadataRevision;
    const run = async (previousSave) => {
      try {
        const coordinator = root.MeldexDocumentSaveCoordinator;
        const revision = previousSave?.ok && previousSave.path === pathAtRequest
          ? previousSave.revision
          : revisionAtRequest;
        const result = await apiPut('/file?path=' + encodeURIComponent(root.MeldexCsv.metadataPath(pathAtRequest)), {
          content: JSON.stringify(payloadAtRequest, null, 2) + '\n',
          ...(revision ? {
            if_match_etag: coordinator?.revisionTokenForWrite
              ? coordinator.revisionTokenForWrite(revision)
              : String(revision?.token || revision),
            transport_revision: revision,
          } : { create_only: true }),
        });
        if (model.path === pathAtRequest) {
          model.metadataExists = true;
          model.metadataRevision = result?.transport_revision || result?.etag || revision;
        }
        return {
          ok: true,
          path: pathAtRequest,
          revision: result?.transport_revision || result?.etag || revision,
        };
      } catch {
        showMessage('CSVの列設定を保存できませんでした', true);
        return { ok: false, path: pathAtRequest, revision: revisionAtRequest };
      }
    };
    model.metadataSavePromise = model.metadataSavePromise.catch(() => null).then(run);
    return model.metadataSavePromise.then(result => !!result?.ok);
  }

  function scheduleMetadataSave() {
    clearTimeout(model.metadataTimer);
    model.metadataTimer = setTimeout(saveMetadata, 700);
  }

  async function open(options) {
    if (model.metadataTimer) await saveMetadata();
    else await model.metadataSavePromise.catch(() => null);
    const value = options || {};
    model.path = String(value.path || '');
    model.metadataRevision = '';
    model.metadataExists = false;
    model.dialect = root.MeldexCsv.normalizeDialect(value.dialect);
    model.columns = root.MeldexCsv.inferColumns(value.rows || data(), true);
    model.filters = {};
    model.sortKeys = [];
    model.selection = null;
    model.matchIndex = -1;
    await loadMetadata();
    reconcileColumns();
    render(true);
    const encoding = String(model.dialect.encoding || 'utf-8').toUpperCase();
    setBarStatus(`${Math.max(0, data().length - 1).toLocaleString()}行・${headers().length}列 / ${encoding}`);
  }

  function serialize() {
    return root.MeldexCsv.serialize(data(), model.dialect);
  }

  function filteredRows() {
    const active = Object.entries(model.filters).filter(([, value]) => String(value || '') !== '');
    const rows = [];
    for (let rowIndex = 1; rowIndex < data().length; rowIndex += 1) {
      const row = data()[rowIndex] || [];
      const visible = active.every(([columnIndex, query]) =>
        String(row[Number(columnIndex)] ?? '').toLocaleLowerCase().includes(String(query).toLocaleLowerCase())
      );
      if (visible) rows.push(rowIndex);
    }
    return rows;
  }

  function ensureBar() {
    const pivot = document.getElementById('pivot-view');
    if (!pivot || !state().active) return null;
    let bar = pivot.querySelector('.csv-workbench-bar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'csv-workbench-bar';
    bar.dataset.e2eId = 'csv-workbench-bar';
    bar.innerHTML =
      '<input class="csv-search-input" type="search" aria-label="CSV内を検索" placeholder="検索" data-e2e-id="csv-search-input">' +
      '<button type="button" data-csv-command="find-prev" data-e2e-id="csv-find-prev" title="前を検索">↑</button>' +
      '<button type="button" data-csv-command="find-next" data-e2e-id="csv-find-next" title="次を検索">↓</button>' +
      '<input class="csv-replace-input" type="text" aria-label="置換後の文字" placeholder="置換" data-e2e-id="csv-replace-input">' +
      '<button type="button" data-csv-command="replace" data-e2e-id="csv-replace">置換</button>' +
      '<button type="button" data-csv-command="replace-all" data-e2e-id="csv-replace-all">すべて置換</button>' +
      '<label><input type="checkbox" data-csv-option="case" data-e2e-id="csv-case">大小</label>' +
      '<label><input type="checkbox" data-csv-option="exact" data-e2e-id="csv-exact">完全</label>' +
      '<span class="csv-workbench-status" aria-live="polite"></span>';
    pivot.prepend(bar);
    bar.addEventListener('click', event => {
      const command = event.target.closest('[data-csv-command]')?.dataset.csvCommand;
      if (command === 'find-prev') findMatch(-1);
      else if (command === 'find-next') findMatch(1);
      else if (command === 'replace') replaceCurrent();
      else if (command === 'replace-all') replaceAll();
    });
    bar.querySelector('.csv-search-input').addEventListener('keydown', event => {
      if (event.key === 'Enter') findMatch(event.shiftKey ? -1 : 1);
      if (event.key === 'Escape') event.currentTarget.blur();
    });
    return bar;
  }

  function setBarStatus(message) {
    const target = ensureBar()?.querySelector('.csv-workbench-status');
    if (target) target.textContent = message;
  }

  function visibleColumns() {
    return model.columns.map((column, index) => ({ column, index })).filter(item => !item.column.hidden);
  }

  function frozenOffset(columnIndex) {
    let offset = 42;
    for (const item of visibleColumns()) {
      if (item.index === columnIndex) return item.column.frozen ? offset : null;
      if (item.column.frozen) offset += item.column.width;
    }
    return null;
  }

  function applyFrozenCell(element, columnIndex) {
    const offset = frozenOffset(columnIndex);
    if (offset == null) {
      delete element.dataset.csvFrozen;
      element.style.removeProperty('--csv-frozen-left');
      return;
    }
    element.dataset.csvFrozen = '1';
    element.style.setProperty('--csv-frozen-left', `${offset}px`);
  }

  function selectionBounds() {
    const selection = model.selection;
    if (!selection) return null;
    return {
      rowStart: Math.min(selection.anchorRow, selection.focusRow),
      rowEnd: Math.max(selection.anchorRow, selection.focusRow),
      colStart: Math.min(selection.anchorCol, selection.focusCol),
      colEnd: Math.max(selection.anchorCol, selection.focusCol),
    };
  }

  function isSelected(row, column) {
    const bounds = selectionBounds();
    return !!bounds && row >= bounds.rowStart && row <= bounds.rowEnd
      && column >= bounds.colStart && column <= bounds.colEnd;
  }

  function setSelection(row, column, extend) {
    const safeRow = Math.max(1, Math.min(Math.max(1, data().length - 1), Number(row) || 1));
    const safeColumn = Math.max(0, Math.min(Math.max(0, headers().length - 1), Number(column) || 0));
    if (!extend || !model.selection) {
      model.selection = { anchorRow: safeRow, anchorCol: safeColumn, focusRow: safeRow, focusCol: safeColumn };
    } else {
      model.selection.focusRow = safeRow;
      model.selection.focusCol = safeColumn;
    }
    paintSelection();
  }

  function paintSelection() {
    const target = table();
    target?.querySelectorAll('[data-csv-row][data-csv-col]').forEach(cell => {
      const selected = isSelected(Number(cell.dataset.csvRow), Number(cell.dataset.csvCol));
      cell.classList.toggle('csv-cell-selected', selected);
      cell.tabIndex = selected && Number(cell.dataset.csvRow) === model.selection?.focusRow
        && Number(cell.dataset.csvCol) === model.selection?.focusCol ? 0 : -1;
    });
  }

  function displayValue(rowIndex, columnIndex) {
    const column = model.columns[columnIndex];
    const raw = String(data()[rowIndex]?.[columnIndex] ?? '');
    if (column?.type !== 'formula' || !column.formula || typeof formulaEvalForEntity !== 'function') {
      return { text: raw, error: column?.type === 'number' && raw.trim() && !root.MeldexCsv.isSafeNumber(raw) };
    }
    const entity = {};
    headers().forEach((name, index) => {
      entity[name] = [{ value: String(data()[rowIndex]?.[index] ?? ''), status: '採用' }];
    });
    const propTypes = {};
    model.columns.forEach(item => { propTypes[item.name] = { type: item.type, formula: item.formula }; });
    const result = formulaEvalForEntity(column.formula, entity, { propTypes });
    return { text: result.error ? '数式エラー' : String(result.value ?? ''), error: !!result.error, formula: true };
  }

  function appendHeader(row, item) {
    const { column, index } = item;
    const th = document.createElement('th');
    th.dataset.csvCol = String(index);
    th.dataset.col = String(index);
    th.style.setProperty('--csv-column-width', `${column.width}px`);
    th.dataset.csvWrap = column.wrap ? '1' : '0';
    setDecoratedText(th, column.name);
    th.title = `${column.name}（${column.type === 'number' ? '数値' : column.type === 'formula' ? '数式' : 'テキスト'}）`;
    applyFrozenCell(th, index);
    th.addEventListener('mousedown', event => {
      if (event.target?.closest?.('.auto-link[data-path]')) return;
      if (event.button !== 0) return;
      setSelection(1, index, event.shiftKey);
      model.selection.anchorRow = 1;
      model.selection.focusRow = Math.max(1, data().length - 1);
      paintSelection();
    });
    th.addEventListener('click', event => { handleAutoLinkClick(event); });
    th.addEventListener('dblclick', () => host()?.startHeaderEdit?.(th, index));
    th.addEventListener('contextmenu', event => {
      event.preventDefault();
      openColumnMenu(event.clientX, event.clientY, index);
    });
    row.appendChild(th);
  }

  function appendDataCell(row, rowIndex, item) {
    const { column, index } = item;
    const cell = document.createElement('td');
    cell.dataset.csvRow = String(rowIndex);
    cell.dataset.row = String(rowIndex);
    cell.dataset.csvCol = String(index);
    cell.dataset.col = String(index);
    cell.dataset.e2eId = `csv-cell-${rowIndex}-${index}`;
    cell.dataset.csvWrap = column.wrap ? '1' : '0';
    cell.style.setProperty('--csv-column-width', `${column.width}px`);
    applyFrozenCell(cell, index);
    const value = displayValue(rowIndex, index);
    setDecoratedText(cell, value.text);
    cell.classList.toggle('csv-cell-invalid', !!value.error);
    cell.classList.toggle('csv-formula-result', !!value.formula);
    cell.addEventListener('mousedown', event => {
      if (event.target?.closest?.('.auto-link[data-path]')) return;
      if (event.button !== 0) return;
      model.dragSelecting = true;
      setSelection(rowIndex, index, event.shiftKey);
    });
    cell.addEventListener('click', event => { handleAutoLinkClick(event); });
    cell.addEventListener('mouseenter', () => {
      if (model.dragSelecting) setSelection(rowIndex, index, true);
    });
    cell.addEventListener('dblclick', () => {
      if (column.type === 'formula') return;
      host()?.startCellEdit?.(cell, rowIndex, index);
    });
    row.appendChild(cell);
  }

  function spacerRow(tbody, columns, height) {
    if (height <= 0) return;
    const row = document.createElement('tr');
    row.className = 'csv-virtual-spacer';
    row.style.setProperty('--csv-spacer-height', `${height}px`);
    const cell = document.createElement('td');
    cell.colSpan = columns + 1;
    row.appendChild(cell);
    tbody.appendChild(row);
  }

  function bindScroll(target) {
    const container = scrollHost();
    if (!container || model.scrollBound === container) return;
    if (model.scrollBound) model.scrollBound.removeEventListener('scroll', onScroll);
    model.scrollBound = container;
    container.addEventListener('scroll', onScroll, { passive: true });
  }

  let scrollFrame = 0;
  function onScroll() {
    if (filteredRows().length < VIRTUAL_THRESHOLD) return;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => render(false));
  }

  function render(force) {
    if (!state().active || !document.getElementById('pivot-table')) return false;
    ensureBar();
    reconcileColumns();
    const target = document.getElementById('pivot-table');
    target.className = 'pivot-table csv-sheet-mode-table';
    target.dataset.csvPath = model.path;
    target.setAttribute('aria-label', 'CSV編集');
    const priorScroll = scrollHost()?.scrollTop || 0;
    target.textContent = '';
    const columns = visibleColumns();
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'csv-row-num';
    corner.textContent = '#';
    corner.addEventListener('click', () => {
      if (!data().length || !headers().length) return;
      model.selection = {
        anchorRow: 1, anchorCol: 0,
        focusRow: Math.max(1, data().length - 1), focusCol: Math.max(0, headers().length - 1),
      };
      paintSelection();
    });
    corner.addEventListener('contextmenu', event => {
      event.preventDefault();
      const menu = document.createElement('div');
      menuButton(menu, '非表示列をすべて表示', () => {
        model.columns.forEach(item => { item.hidden = false; });
        scheduleMetadataSave();
        render(true);
      });
      placeMenu(menu, event.clientX, event.clientY);
    });
    headerRow.appendChild(corner);
    columns.forEach(item => appendHeader(headerRow, item));
    thead.appendChild(headerRow);
    target.appendChild(thead);

    const visibleRows = filteredRows();
    const container = scrollHost();
    const virtual = visibleRows.length >= VIRTUAL_THRESHOLD;
    const start = virtual ? Math.max(0, Math.floor((container?.scrollTop || 0) / ROW_HEIGHT) - VIRTUAL_BUFFER) : 0;
    const viewportRows = Math.ceil((container?.clientHeight || 700) / ROW_HEIGHT);
    const end = virtual ? Math.min(visibleRows.length, start + viewportRows + VIRTUAL_BUFFER * 2) : visibleRows.length;
    const tbody = document.createElement('tbody');
    target.classList.toggle('csv-has-frozen', columns.some(item => item.column.frozen));
    spacerRow(tbody, columns.length, start * ROW_HEIGHT);
    visibleRows.slice(start, end).forEach(rowIndex => {
      const row = document.createElement('tr');
      row.dataset.csvRow = String(rowIndex);
      const number = document.createElement('td');
      number.className = 'csv-row-num';
      number.textContent = String(rowIndex);
      number.addEventListener('mousedown', event => {
        if (event.button !== 0 || !columns.length) return;
        model.selection = {
          anchorRow: rowIndex, anchorCol: columns[0].index,
          focusRow: rowIndex, focusCol: columns[columns.length - 1].index,
        };
        paintSelection();
      });
      number.addEventListener('contextmenu', event => {
        event.preventDefault();
        openRowMenu(event.clientX, event.clientY, rowIndex);
      });
      row.appendChild(number);
      columns.forEach(item => appendDataCell(row, rowIndex, item));
      tbody.appendChild(row);
    });
    spacerRow(tbody, columns.length, Math.max(0, visibleRows.length - end) * ROW_HEIGHT);
    target.appendChild(tbody);
    target.style.minWidth = `${Math.max(520, 48 + columns.reduce((sum, item) => sum + item.column.width, 0))}px`;
    bindScroll(target);
    if (force && container) container.scrollTop = priorScroll;
    paintSelection();
    setBarStatus(`${visibleRows.length.toLocaleString()}/${Math.max(0, data().length - 1).toLocaleString()}行`);
    return true;
  }

  function cellForSelection() {
    const selection = model.selection;
    if (!selection) return null;
    return table()?.querySelector(
      `[data-csv-row="${selection.focusRow}"][data-csv-col="${selection.focusCol}"]`
    ) || null;
  }

  function ensureFocusVisible() {
    const selection = model.selection;
    if (!selection) return;
    let cell = cellForSelection();
    if (!cell) {
      const rows = filteredRows();
      const visiblePosition = rows.indexOf(selection.focusRow);
      const container = scrollHost();
      if (container && visiblePosition >= 0) container.scrollTop = visiblePosition * ROW_HEIGHT;
      render(false);
      cell = cellForSelection();
    }
    cell?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    cell?.focus?.({ preventScroll: true });
  }

  function moveSelection(rowDelta, colDelta, extend) {
    if (!model.selection) {
      const firstRow = filteredRows()[0] || 1;
      const firstColumn = visibleColumns()[0]?.index || 0;
      setSelection(firstRow, firstColumn, false);
    } else {
      let row = model.selection.focusRow;
      let column = model.selection.focusCol;
      if (rowDelta) {
        const rows = filteredRows();
        const current = rows.indexOf(row);
        const next = current >= 0
          ? current + rowDelta
          : rowDelta > 0 ? 0 : rows.length - 1;
        row = rows[Math.max(0, Math.min(rows.length - 1, next))] ?? row;
      }
      if (colDelta) {
        const columns = visibleColumns().map(item => item.index);
        const current = columns.indexOf(column);
        const next = current >= 0
          ? current + colDelta
          : colDelta > 0 ? 0 : columns.length - 1;
        column = columns[Math.max(0, Math.min(columns.length - 1, next))] ?? column;
      }
      setSelection(row, column, extend);
    }
    ensureFocusVisible();
  }

  function copyText() {
    const bounds = selectionBounds();
    if (!bounds) return '';
    const rows = [];
    for (let row = bounds.rowStart; row <= bounds.rowEnd; row += 1) {
      const values = [];
      for (let column = bounds.colStart; column <= bounds.colEnd; column += 1) {
        values.push(String(data()[row]?.[column] ?? ''));
      }
      rows.push(values);
    }
    return root.MeldexCsv.serialize(rows, {
      delimiter: '\t',
      newline: '\r\n',
      bom: false,
      finalNewline: false,
    });
  }

  async function copySelection(cut) {
    const text = copyText();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch { return; }
    if (cut) clearSelection('CSV切り取り');
  }

  function clearSelection(label) {
    const bounds = selectionBounds();
    if (!bounds) return;
    mutation(label || 'CSV値を消去', () => {
      for (let row = bounds.rowStart; row <= bounds.rowEnd; row += 1) {
        for (let column = bounds.colStart; column <= bounds.colEnd; column += 1) {
          if (data()[row]) data()[row][column] = '';
        }
      }
    });
  }

  async function pasteSelection() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { return; }
    if (!text) return;
    const parsed = root.MeldexCsv.parse(text, { delimiter: '\t', bom: false }).rows;
    if (!parsed.length) return;
    const startRow = model.selection?.focusRow || 1;
    const startColumn = model.selection?.focusCol || 0;
    mutation('CSV貼り付け', () => {
      const requiredColumns = startColumn + Math.max(...parsed.map(row => row.length));
      while (headers().length < requiredColumns) {
        const name = root.MeldexCsv.uniqueHeaders(headers().concat(`列${headers().length + 1}`)).pop();
        headers().push(name);
        for (let row = 1; row < data().length; row += 1) data()[row].push('');
      }
      while (data().length <= startRow + parsed.length - 1) data().push(new Array(headers().length).fill(''));
      parsed.forEach((row, rowOffset) => row.forEach((value, colOffset) => {
        data()[startRow + rowOffset][startColumn + colOffset] = value;
      }));
      setSelection(startRow + parsed.length - 1, startColumn + parsed[parsed.length - 1].length - 1, true);
    });
  }

  function searchOptions() {
    const bar = ensureBar();
    return {
      query: bar?.querySelector('.csv-search-input')?.value || '',
      replacement: bar?.querySelector('.csv-replace-input')?.value || '',
      caseSensitive: !!bar?.querySelector('[data-csv-option="case"]')?.checked,
      exact: !!bar?.querySelector('[data-csv-option="exact"]')?.checked,
    };
  }

  function matches(value, options) {
    const source = options.caseSensitive ? String(value) : String(value).toLocaleLowerCase();
    const query = options.caseSensitive ? options.query : options.query.toLocaleLowerCase();
    return options.exact ? source === query : source.includes(query);
  }

  function allMatches() {
    const options = searchOptions();
    if (!options.query) return [];
    const found = [];
    for (let row = 1; row < data().length; row += 1) {
      for (let column = 0; column < headers().length; column += 1) {
        if (matches(data()[row]?.[column] ?? '', options)) found.push({ row, column });
      }
    }
    return found;
  }

  function findMatch(direction) {
    const found = allMatches();
    if (!found.length) {
      setBarStatus('一致するセルはありません');
      return;
    }
    model.matchIndex = (model.matchIndex + direction + found.length) % found.length;
    const match = found[model.matchIndex];
    setSelection(match.row, match.column, false);
    ensureFocusVisible();
    setBarStatus(`${model.matchIndex + 1}/${found.length}件`);
  }

  function replaceValue(value, options) {
    if (options.exact) return options.replacement;
    if (options.caseSensitive) return String(value).split(options.query).join(options.replacement);
    return String(value).replace(new RegExp(escapeRegExp(options.query), 'gi'), options.replacement);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function replaceCurrent() {
    const options = searchOptions();
    const selection = model.selection;
    if (!selection || !options.query) return;
    const old = data()[selection.focusRow]?.[selection.focusCol] ?? '';
    if (!matches(old, options)) {
      findMatch(1);
      return;
    }
    mutation('CSV置換', () => {
      data()[selection.focusRow][selection.focusCol] = replaceValue(old, options);
    });
    findMatch(1);
  }

  function replaceAll() {
    const options = searchOptions();
    if (!options.query) return;
    let count = 0;
    mutation('CSVすべて置換', () => {
      for (let row = 1; row < data().length; row += 1) {
        for (let column = 0; column < headers().length; column += 1) {
          const old = data()[row]?.[column] ?? '';
          if (!matches(old, options)) continue;
          data()[row][column] = replaceValue(old, options);
          count += 1;
        }
      }
    });
    setBarStatus(`${count}件を置換しました`);
  }

  function closeMenu() {
    if (model.menuOutsideHandler) {
      document.removeEventListener('pointerdown', model.menuOutsideHandler, true);
      model.menuOutsideHandler = null;
    }
    document.querySelectorAll('.csv-column-menu').forEach(menu => menu.remove());
  }

  function menuButton(menu, label, callback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      closeMenu();
      callback();
    });
    menu.appendChild(button);
  }

  function placeMenu(menu, x, y) {
    closeMenu();
    menu.className = 'csv-column-menu';
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    setTimeout(() => {
      model.menuOutsideHandler = event => {
        if (menu.contains(event.target)) return;
        closeMenu();
      };
      document.addEventListener('pointerdown', model.menuOutsideHandler, true);
    }, 0);
  }

  function openColumnMenu(x, y, columnIndex) {
    const column = model.columns[columnIndex];
    if (!column) return;
    const menu = document.createElement('div');
    menuButton(menu, `列タイプ: ${column.type === 'number' ? '数値' : column.type === 'formula' ? '数式' : 'テキスト'}`, async () => {
      const entered = await promptValue('列タイプ（text / number / formula）', column.type);
      if (!['text', 'number', 'formula'].includes(entered)) return;
      let nextFormula = column.formula;
      if (entered === 'formula') {
        const formula = await promptValue('Meldex数式', column.formula || '=prop("列名")');
        if (formula == null || !root.MeldexCsv.isMeldexFormula(formula)) {
          showMessage('Meldex列数式を入力してください', true);
          return;
        }
        nextFormula = formula;
      }
      mutation('CSV列タイプ変更', () => {
        column.type = entered;
        column.formula = entered === 'formula' ? nextFormula : '';
        if (entered === 'formula') {
          for (let row = 1; row < data().length; row += 1) data()[row][columnIndex] = nextFormula;
        }
      });
      scheduleMetadataSave();
    });
    menuButton(menu, 'この列で昇順', () => sortRows(columnIndex, 1, false));
    menuButton(menu, 'この列で降順', () => sortRows(columnIndex, -1, false));
    menuButton(menu, '昇順を並べ替え条件に追加', () => sortRows(columnIndex, 1, true));
    menuButton(menu, '降順を並べ替え条件に追加', () => sortRows(columnIndex, -1, true));
    menuButton(menu, 'フィルター...', async () => {
      const query = await promptValue('含む文字（空欄で解除）', model.filters[columnIndex] || '');
      if (query == null) return;
      if (query) model.filters[columnIndex] = query;
      else delete model.filters[columnIndex];
      scheduleMetadataSave();
      render(true);
    });
    menuButton(menu, column.wrap ? '折り返しを解除' : '折り返す', () => {
      column.wrap = !column.wrap;
      scheduleMetadataSave();
      render(true);
    });
    menuButton(menu, '列幅...', async () => {
      const value = Number(await promptValue('列幅（64〜800px）', String(column.width)));
      if (!Number.isFinite(value)) return;
      column.width = Math.max(64, Math.min(800, value));
      scheduleMetadataSave();
      render(true);
    });
    menuButton(menu, '内容に合わせる', () => {
      const max = Math.max(column.name.length, ...data().slice(1, 2000).map(row => String(row?.[columnIndex] ?? '').length));
      column.width = Math.max(80, Math.min(480, max * 8 + 24));
      scheduleMetadataSave();
      render(true);
    });
    menuButton(menu, column.frozen ? '固定を解除' : '左端へ固定', () => {
      const unfreeze = column.frozen;
      model.columns.forEach((item, index) => { item.frozen = !unfreeze && index <= columnIndex; });
      scheduleMetadataSave();
      render(true);
    });
    menuButton(menu, '左へ移動', () => moveColumn(columnIndex, -1));
    menuButton(menu, '右へ移動', () => moveColumn(columnIndex, 1));
    menuButton(menu, '列を複製', () => duplicateColumn(columnIndex));
    menuButton(menu, '左へ列を挿入', () => insertColumn(columnIndex));
    menuButton(menu, '列を非表示', () => {
      if (visibleColumns().length <= 1) {
        showMessage('少なくとも1列は表示してください', true);
        return;
      }
      column.hidden = true;
      if (model.selection?.focusCol === columnIndex) {
        const replacement = visibleColumns().find(item => item.index !== columnIndex);
        if (replacement) setSelection(model.selection.focusRow, replacement.index, false);
      }
      scheduleMetadataSave();
      render(true);
    });
    menuButton(menu, '非表示列をすべて表示', () => {
      model.columns.forEach(item => { item.hidden = false; });
      scheduleMetadataSave();
      render(true);
    });
    menuButton(menu, '列を削除...', () => deleteColumn(columnIndex));
    placeMenu(menu, x, y);
  }

  function openRowMenu(x, y, rowIndex) {
    const menu = document.createElement('div');
    menuButton(menu, '上へ行を挿入', () => insertRow(rowIndex));
    menuButton(menu, '行を複製', () => duplicateRow(rowIndex));
    menuButton(menu, '上へ移動', () => moveRow(rowIndex, -1));
    menuButton(menu, '下へ移動', () => moveRow(rowIndex, 1));
    menuButton(menu, '行を削除...', () => deleteRow(rowIndex));
    placeMenu(menu, x, y);
  }

  function promptValue(label, value) {
    if (typeof cfPrompt === 'function') return cfPrompt(label, value);
    return Promise.resolve(window.prompt(label, value));
  }

  function confirmValue(message) {
    if (typeof cfConfirm === 'function') return cfConfirm(message);
    return Promise.resolve(window.confirm(message));
  }

  function sortRows(columnIndex, direction, append) {
    const columnId = model.columns[columnIndex]?.id;
    if (!columnId) return;
    const nextKey = { columnId, direction: direction < 0 ? -1 : 1 };
    model.sortKeys = append
      ? model.sortKeys.filter(key => key.columnId !== columnId).concat(nextKey)
      : [nextKey];
    mutation('CSV並べ替え', () => {
      const rows = data().slice(1).map((row, originalIndex) => ({ row, originalIndex }));
      rows.sort((left, right) => {
        for (const key of model.sortKeys) {
          const index = model.columns.findIndex(item => item.id === key.columnId);
          if (index < 0) continue;
          const a = String(left.row?.[index] ?? '');
          const b = String(right.row?.[index] ?? '');
          let order;
          if (model.columns[index]?.type === 'number' && root.MeldexCsv.isSafeNumber(a) && root.MeldexCsv.isSafeNumber(b)) {
            order = Number(a) - Number(b);
          } else order = a.localeCompare(b, 'ja', { numeric: true });
          if (order !== 0) return order * key.direction;
        }
        return left.originalIndex - right.originalIndex;
      });
      data().splice(1, data().length - 1, ...rows.map(item => item.row));
    });
    scheduleMetadataSave();
  }

  function insertColumn(index) {
    mutation('CSV列挿入', () => {
      const name = root.MeldexCsv.uniqueHeaders(headers().concat(`列${index + 1}`)).pop();
      data().forEach((row, rowIndex) => row.splice(index, 0, rowIndex === 0 ? name : ''));
      model.columns.splice(index, 0, defaultColumn(index, name));
    });
  }

  function duplicateColumn(index) {
    mutation('CSV列複製', () => {
      const name = root.MeldexCsv.uniqueHeaders(headers().concat(`${headers()[index]} コピー`)).pop();
      data().forEach((row, rowIndex) => row.splice(index + 1, 0, rowIndex === 0 ? name : String(row[index] ?? '')));
      model.columns.splice(index + 1, 0, { ...model.columns[index], id: `column-${Date.now()}`, name });
    });
  }

  function moveColumn(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= headers().length) return;
    mutation('CSV列移動', () => {
      data().forEach(row => {
        const [value] = row.splice(index, 1);
        row.splice(target, 0, value);
      });
      const [column] = model.columns.splice(index, 1);
      model.columns.splice(target, 0, column);
    });
  }

  async function deleteColumn(index) {
    if (!await confirmValue(`列「${headers()[index]}」を削除しますか？\n${Math.max(0, data().length - 1)}件の値が削除されます。`)) return;
    mutation('CSV列削除', () => {
      data().forEach(row => row.splice(index, 1));
      model.columns.splice(index, 1);
      if (!headers().length) data().splice(0, data().length);
    });
  }

  function insertRow(index) {
    mutation('CSV行挿入', () => data().splice(index, 0, new Array(headers().length).fill('')));
  }

  function duplicateRow(index) {
    mutation('CSV行複製', () => data().splice(index + 1, 0, (data()[index] || []).slice()));
  }

  function moveRow(index, delta) {
    const target = index + delta;
    if (target < 1 || target >= data().length) return;
    mutation('CSV行移動', () => {
      const [row] = data().splice(index, 1);
      data().splice(target, 0, row);
    });
  }

  async function deleteRow(index) {
    if (!await confirmValue(`行 ${index} を削除しますか？`)) return;
    mutation('CSV行削除', () => data().splice(index, 1));
  }

  function onKeyDown(event) {
    if (!state().active || event.defaultPrevented) return;
    const editing = event.target.closest?.('input,textarea,select,[contenteditable="true"]');
    if (editing) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        ensureBar()?.querySelector('.csv-search-input')?.focus();
      }
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (modifier && key.toLowerCase() === 'c') { event.preventDefault(); copySelection(false); }
    else if (modifier && key.toLowerCase() === 'x') { event.preventDefault(); copySelection(true); }
    else if (modifier && key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); }
    else if (modifier && key.toLowerCase() === 'f') {
      event.preventDefault();
      ensureBar()?.querySelector('.csv-search-input')?.focus();
    } else if (modifier && key.toLowerCase() === 'h') {
      event.preventDefault();
      ensureBar()?.querySelector('.csv-replace-input')?.focus();
    } else if (modifier && key.toLowerCase() === 'a') {
      event.preventDefault();
      if (data().length > 1 && headers().length) {
        model.selection = { anchorRow: 1, anchorCol: 0, focusRow: data().length - 1, focusCol: headers().length - 1 };
        paintSelection();
      }
    } else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      clearSelection();
    } else if (key === 'ArrowLeft') { event.preventDefault(); moveSelection(0, -1, event.shiftKey); }
    else if (key === 'ArrowRight') { event.preventDefault(); moveSelection(0, 1, event.shiftKey); }
    else if (key === 'ArrowUp') { event.preventDefault(); moveSelection(-1, 0, event.shiftKey); }
    else if (key === 'ArrowDown') { event.preventDefault(); moveSelection(1, 0, event.shiftKey); }
    else if (key === 'Home') {
      event.preventDefault();
      const row = modifier ? (filteredRows()[0] || 1) : model.selection?.focusRow || 1;
      setSelection(row, visibleColumns()[0]?.index || 0, event.shiftKey);
      ensureFocusVisible();
    } else if (key === 'End') {
      event.preventDefault();
      const rows = filteredRows();
      const columns = visibleColumns();
      const row = modifier ? (rows[rows.length - 1] || 1) : model.selection?.focusRow || 1;
      setSelection(row, columns[columns.length - 1]?.index || 0, event.shiftKey);
      ensureFocusVisible();
    } else if (key === 'PageUp') { event.preventDefault(); moveSelection(-20, 0, event.shiftKey); }
    else if (key === 'PageDown') { event.preventDefault(); moveSelection(20, 0, event.shiftKey); }
    else if (key === 'F2' || key === 'Enter') {
      const cell = cellForSelection();
      if (cell && model.columns[model.selection.focusCol]?.type !== 'formula') {
        event.preventDefault();
        host()?.startCellEdit?.(cell, model.selection.focusRow, model.selection.focusCol);
      }
    } else if (key === 'Tab') {
      event.preventDefault();
      let row = model.selection?.focusRow || 1;
      const columns = visibleColumns().map(item => item.index);
      const rows = filteredRows();
      let columnPosition = columns.indexOf(model.selection?.focusCol ?? columns[0]);
      if (columnPosition < 0) columnPosition = 0;
      columnPosition += event.shiftKey ? -1 : 1;
      let rowPosition = Math.max(0, rows.indexOf(row));
      if (columnPosition >= columns.length) { columnPosition = 0; rowPosition += 1; }
      if (columnPosition < 0) { columnPosition = Math.max(0, columns.length - 1); rowPosition -= 1; }
      row = rows[Math.max(0, Math.min(rows.length - 1, rowPosition))] ?? row;
      const column = columns[columnPosition] ?? 0;
      setSelection(row, column, false);
      ensureFocusVisible();
    } else if (key === 'Escape') closeMenu();
  }

  function deactivate() {
    clearTimeout(model.metadataTimer);
    closeMenu();
    document.querySelectorAll('.csv-workbench-bar').forEach(element => element.remove());
    if (model.scrollBound) model.scrollBound.removeEventListener('scroll', onScroll);
    model.scrollBound = null;
    model.selection = null;
    model.dragSelecting = false;
  }

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerup', () => { model.dragSelecting = false; });

  root.MeldexCsvWorkbench = Object.freeze({
    open,
    render,
    serialize,
    saveMetadata,
    deactivate,
    getMetadata: metadataPayload,
    reconcile: reconcileColumns,
    setSelection,
    copySelection,
    pasteSelection,
    clearSelection,
    sortRows,
    insertRow,
    insertColumn,
  });
})(typeof window !== 'undefined' ? window : globalThis);
