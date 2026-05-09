/* gb-note-enhance.part03.js: note table boundary resize */
let _noteTableResizeState = null;
let _noteTableResizeHoverCell = null;

function _noteTableCellAtResizeEdge(event) {
  const cell = _noteTableCellFromTarget(event.target);
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  const edge = 6;
  const nearRight = Math.abs(event.clientX - rect.right) <= edge && event.clientY >= rect.top && event.clientY <= rect.bottom;
  const nearBottom = Math.abs(event.clientY - rect.bottom) <= edge && event.clientX >= rect.left && event.clientX <= rect.right;
  if (!nearRight && !nearBottom) return null;
  if (nearRight && (!nearBottom || Math.abs(event.clientX - rect.right) <= Math.abs(event.clientY - rect.bottom))) {
    return { cell, axis: 'col' };
  }
  return { cell, axis: 'row' };
}

function _noteTableClearResizeHover() {
  if (_noteTableResizeHoverCell?.isConnected) _noteTableResizeHoverCell.style.cursor = '';
  _noteTableResizeHoverCell = null;
}

function _noteTableSetResizeHover(target) {
  if (_noteTableResizeState) return;
  if (!target) {
    _noteTableClearResizeHover();
    return;
  }
  if (_noteTableResizeHoverCell && _noteTableResizeHoverCell !== target.cell) _noteTableResizeHoverCell.style.cursor = '';
  _noteTableResizeHoverCell = target.cell;
  target.cell.style.cursor = target.axis === 'col' ? 'col-resize' : 'row-resize';
}

function _noteTableEnsureColgroup(table, colCount) {
  let colgroup = table.querySelector(':scope > colgroup');
  if (!colgroup) {
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
  }
  while (colgroup.children.length < colCount) colgroup.appendChild(document.createElement('col'));
  while (colgroup.children.length > colCount) colgroup.lastElementChild.remove();
  return colgroup;
}

function _noteTableApplyColumnWidth(table, colIndex, width) {
  const rows = Array.from(table?.rows || []);
  const colCount = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  if (!table || colIndex < 0 || colIndex >= colCount) return;
  table.style.tableLayout = 'fixed';
  table.dataset.noteTableResized = '1';
  const col = _noteTableEnsureColgroup(table, colCount).children[colIndex];
  col.style.width = Math.max(40, Math.round(width)) + 'px';
  rows.forEach(row => {
    if (row.cells[colIndex]) row.cells[colIndex].style.width = col.style.width;
  });
}

function _noteTableApplyRowHeight(row, height) {
  if (!row) return;
  const px = Math.max(24, Math.round(height)) + 'px';
  row.style.height = px;
  Array.from(row.cells || []).forEach(cell => { cell.style.height = px; });
  const table = row.closest('table');
  if (table) table.dataset.noteTableResized = '1';
}

function _noteTableStartResize(event) {
  const target = _noteTableCellAtResizeEdge(event);
  if (!target) return false;
  const table = target.cell.closest('table');
  const editable = _noteTableEditable(table);
  if (!table || !editable) return false;
  const row = target.cell.parentElement;
  _noteTablePushCustomUndo(editable);
  _noteTableResizeState = {
    axis: target.axis,
    table,
    row,
    colIndex: _noteTableColumnIndex(target.cell),
    editable,
    beforeHtml: editable.innerHTML,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: target.cell.getBoundingClientRect().width,
    startHeight: row.getBoundingClientRect().height,
    changed: false,
  };
  document.body.classList.add('note-table-resizing');
  document.body.style.cursor = target.axis === 'col' ? 'col-resize' : 'row-resize';
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function _noteTableResizeMove(event) {
  const state = _noteTableResizeState;
  if (!state) return;
  const z = _noteTableUiZoom();
  if (state.axis === 'col') {
    _noteTableApplyColumnWidth(state.table, state.colIndex, state.startWidth + (event.clientX - state.startX) / z);
  } else {
    _noteTableApplyRowHeight(state.row, state.startHeight + (event.clientY - state.startY) / z);
  }
  state.changed = true;
  _positionNoteTableCellControls();
  event.preventDefault();
}

function _noteTableFinishResize() {
  const state = _noteTableResizeState;
  if (!state) return;
  _noteTableResizeState = null;
  document.body.classList.remove('note-table-resizing');
  document.body.style.cursor = '';
  _noteTableClearResizeHover();
  if (state.changed) _noteTableDispatchInput(state.editable, state.beforeHtml);
}
