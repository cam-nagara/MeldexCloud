/* gb-note-enhance.part03.js: note table boundary resize */
let _noteTableResizeState = null;
let _noteTableResizeHoverCell = null;
const _NOTE_TABLE_SELECTOR = '#page-content table, #entity-freetext table, #dp-editable table, #board-note-editable table';
const _NOTE_TABLE_EDITABLE_SELECTOR = '#page-content, #entity-freetext, #dp-editable, #board-note-editable';
let _noteTableActiveCell = null;
let _noteTableControls = null;

function _noteTableUiZoom() {
  return (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
}

function _noteTableCellFromTarget(target) {
  const cell = target?.closest?.('td, th');
  if (!cell || !cell.closest?.(_NOTE_TABLE_SELECTOR)) return null;
  return cell;
}

function _noteTableEditable(table) {
  return table?.closest?.(_NOTE_TABLE_EDITABLE_SELECTOR) || null;
}

function _noteTableCanEdit(editable, options = {}) {
  if (editable && editable.contentEditable === 'true') return true;
  if (!options.silent && typeof showStatus === 'function') showStatus('ロック中または読み取り専用のため、表を編集できません', true);
  return false;
}

function _noteTablePushCustomUndo(editable) {
  if (!_noteTableCanEdit(editable, { silent: true }) || typeof _pushCustomUndo !== 'function') return false;
  _pushCustomUndo(editable);
  return true;
}

function _noteTableDiscardCustomUndoIfUnchanged(editable, beforeHtml) {
  if (!editable || beforeHtml === undefined || editable.innerHTML !== beforeHtml) return;
  if (!editable._customUndoInputPending || !Array.isArray(editable._customUndoStack)) return;
  const lastIndex = editable._customUndoStack.length - 1;
  if (lastIndex >= 0 && editable._customUndoStack[lastIndex] === beforeHtml) editable._customUndoStack.pop();
  editable._customUndoInputPending = false;
  editable._lastCustomOp = Array.isArray(editable._customUndoStack) && editable._customUndoStack.length > 0;
}

function _noteTableDispatchInput(editable, beforeHtml) {
  if (!editable) return;
  if (beforeHtml !== undefined && editable.innerHTML === beforeHtml) {
    _noteTableDiscardCustomUndoIfUnchanged(editable, beforeHtml);
    return;
  }
  editable.dispatchEvent(new Event('input', { bubbles: true }));
}

function _noteTableConfirm(message) {
  if (typeof cfConfirm === 'function') return cfConfirm(message);
  return typeof window.confirm === 'function' ? window.confirm(message) : false;
}

function _noteTableColumnIndex(cell) {
  const row = cell?.parentElement;
  return row ? [...row.children].indexOf(cell) : -1;
}

function _noteTableColumnCount(table) {
  return Array.from(table?.rows || []).reduce((max, row) => Math.max(max, row.cells.length), 0);
}

function _noteTableColgroup(table) {
  return table?.querySelector?.(':scope > colgroup') || null;
}

function _noteTableNormalizeColgroupToCount(table, colCount = _noteTableColumnCount(table)) {
  const colgroup = _noteTableColgroup(table);
  if (!colgroup) return null;
  while (colgroup.children.length < colCount) colgroup.appendChild(document.createElement('col'));
  while (colgroup.children.length > colCount) colgroup.lastElementChild.remove();
  return colgroup;
}

function _noteTableInsertColgroupColumn(table, colIndex) {
  const colgroup = _noteTableNormalizeColgroupToCount(table);
  if (!colgroup) return;
  const index = Math.max(0, Math.min(colIndex, colgroup.children.length));
  const col = document.createElement('col');
  const source = colgroup.children[Math.min(index, colgroup.children.length - 1)] || colgroup.lastElementChild;
  if (source?.style?.width) col.style.width = source.style.width;
  colgroup.insertBefore(col, colgroup.children[index] || null);
}

function _noteTableDeleteColgroupColumn(table, colIndex) {
  const colgroup = _noteTableNormalizeColgroupToCount(table);
  if (!colgroup) return;
  if (colIndex >= 0 && colIndex < colgroup.children.length) colgroup.children[colIndex].remove();
}

function _noteTableSyncCellWidthsFromColgroup(table) {
  const colgroup = _noteTableColgroup(table);
  if (!colgroup) return;
  Array.from(table?.rows || []).forEach(row => {
    Array.from(row.cells || []).forEach((cell, index) => {
      const width = colgroup.children[index]?.style?.width || '';
      if (width) cell.style.width = width;
    });
  });
}

function _noteTableNewCellForRow(row, rowIndex) {
  return document.createElement(rowIndex === 0 && row?.querySelector?.('th') ? 'th' : 'td');
}

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

function _noteTableBindResizeFinishGuards() {
  window.addEventListener('blur', _noteTableFinishResize, true);
  window.addEventListener('pointerup', _noteTableFinishResize, true);
  window.addEventListener('pointercancel', _noteTableFinishResize, true);
}

function _noteTableUnbindResizeFinishGuards() {
  window.removeEventListener('blur', _noteTableFinishResize, true);
  window.removeEventListener('pointerup', _noteTableFinishResize, true);
  window.removeEventListener('pointercancel', _noteTableFinishResize, true);
}

function _noteTableStartResize(event) {
  const target = _noteTableCellAtResizeEdge(event);
  if (!target) return false;
  const table = target.cell.closest('table');
  const editable = _noteTableEditable(table);
  if (!table || !editable) return false;
  if (!_noteTableCanEdit(editable)) return false;
  const row = target.cell.parentElement;
  const z = _noteTableUiZoom();
  try { target.cell.setPointerCapture?.(event.pointerId); } catch {}
  _noteTableResizeState = {
    axis: target.axis,
    table,
    row,
    colIndex: _noteTableColumnIndex(target.cell),
    editable,
    beforeHtml: editable.innerHTML,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: target.cell.getBoundingClientRect().width / z,
    startHeight: row.getBoundingClientRect().height / z,
    pointerTarget: target.cell,
    pointerId: event.pointerId,
    undoPushed: false,
    changed: false,
  };
  document.body.classList.add('note-table-resizing');
  document.body.style.cursor = target.axis === 'col' ? 'col-resize' : 'row-resize';
  _noteTableBindResizeFinishGuards();
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function _noteTableResizeMove(event) {
  const state = _noteTableResizeState;
  if (!state) return;
  const z = _noteTableUiZoom();
  const delta = state.axis === 'col' ? (event.clientX - state.startX) / z : (event.clientY - state.startY) / z;
  if (Math.abs(delta) < 0.5) return;
  if (!state.undoPushed) state.undoPushed = _noteTablePushCustomUndo(state.editable);
  if (state.axis === 'col') {
    _noteTableApplyColumnWidth(state.table, state.colIndex, state.startWidth + delta);
  } else {
    _noteTableApplyRowHeight(state.row, state.startHeight + delta);
  }
  state.changed = state.editable.innerHTML !== state.beforeHtml;
  _positionNoteTableCellControls();
  event.preventDefault();
}

function _noteTableFinishResize() {
  const state = _noteTableResizeState;
  if (!state) return;
  _noteTableResizeState = null;
  _noteTableUnbindResizeFinishGuards();
  try { state.pointerTarget?.releasePointerCapture?.(state.pointerId); } catch {}
  document.body.classList.remove('note-table-resizing');
  document.body.style.cursor = '';
  _noteTableClearResizeHover();
  if (state.changed || state.undoPushed) _noteTableDispatchInput(state.editable, state.beforeHtml);
}
