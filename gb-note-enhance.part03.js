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

// 表の組方向。表自体は本文の組方向を継承する。
function _noteTableAxis(cell) {
  const wm = window.MeldexNoteWritingMode;
  const host = cell && cell.closest ? cell.closest('[contenteditable]') : null;
  return (wm && typeof wm.axis === 'function') ? wm.axis(host) : null;
}

// 列＝行の中でセルが並ぶ向き（インライン軸）、行＝行同士が積み重なる向き（ブロック軸）。
// 縦書き(vertical-rl)では列は上下、行は右→左に並ぶので、掴む辺は
// 列＝セルの下辺、行＝セルの左辺になる（横書きの右辺／下辺の鏡映し）。
function _noteTableCellAtResizeEdge(event) {
  const cell = _noteTableCellFromTarget(event.target);
  if (!cell) return null;
  const rect = cell.getBoundingClientRect();
  const edge = 6;
  const ax = _noteTableAxis(cell);
  const vertical = !!(ax && ax.vertical);
  const pt = { x: event.clientX, y: event.clientY };
  // インライン軸の終端辺（横書き=右 / 縦書き=下）
  const inlineEnd = vertical ? rect.bottom : rect.right;
  const inlineCoord = vertical ? pt.y : pt.x;
  const inlineCross = vertical ? (pt.x >= rect.left && pt.x <= rect.right) : (pt.y >= rect.top && pt.y <= rect.bottom);
  // ブロック軸の終端辺（横書き=下 / 縦書き=左）
  const blockEnd = vertical ? rect.left : rect.bottom;
  const blockCoord = vertical ? pt.x : pt.y;
  const blockCross = vertical ? (pt.y >= rect.top && pt.y <= rect.bottom) : (pt.x >= rect.left && pt.x <= rect.right);
  const dInline = Math.abs(inlineCoord - inlineEnd);
  const dBlock = Math.abs(blockCoord - blockEnd);
  const nearCol = dInline <= edge && inlineCross;
  const nearRow = dBlock <= edge && blockCross;
  if (!nearCol && !nearRow) return null;
  if (nearCol && (!nearRow || dInline <= dBlock)) return { cell, axis: 'col' };
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
  const vertical = !!_noteTableAxis(target.cell)?.vertical;
  target.cell.style.cursor = _noteTableResizeCursor(target.axis, vertical);
}

// 掴む辺の向きに合わせたカーソル。縦書きでは列＝上下、行＝左右になる。
function _noteTableResizeCursor(axis, vertical) {
  if (vertical) return axis === 'col' ? 'row-resize' : 'col-resize';
  return axis === 'col' ? 'col-resize' : 'row-resize';
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
  // <col>/<td> の寸法は表レイアウト内部の値で、論理プロパティでは Chrome が拾わない
  // （inline-size にすると列幅が一切変わらなくなる）。ここは物理プロパティのまま扱う。
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
    vertical: !!_noteTableAxis(target.cell)?.vertical,
    startWidth: (_noteTableAxis(target.cell)?.vertical
      ? target.cell.getBoundingClientRect().height
      : target.cell.getBoundingClientRect().width) / z,
    startHeight: (_noteTableAxis(target.cell)?.vertical
      ? row.getBoundingClientRect().width
      : row.getBoundingClientRect().height) / z,
    pointerTarget: target.cell,
    pointerId: event.pointerId,
    undoPushed: false,
    changed: false,
  };
  document.body.classList.add('note-table-resizing');
  document.body.style.cursor = _noteTableResizeCursor(target.axis, !!_noteTableAxis(target.cell)?.vertical);
  _noteTableBindResizeFinishGuards();
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function _noteTableResizeMove(event) {
  const state = _noteTableResizeState;
  if (!state) return;
  const z = _noteTableUiZoom();
  const delta = state.vertical
    ? (state.axis === 'col' ? (event.clientY - state.startY) : -(event.clientX - state.startX)) / z
    : (state.axis === 'col' ? (event.clientX - state.startX) : (event.clientY - state.startY)) / z;
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
