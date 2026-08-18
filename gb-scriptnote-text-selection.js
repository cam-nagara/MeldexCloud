/* gb-scriptnote-text-selection.js: シナリオのセル範囲選択と表形式クリップボード
   矩形ドラッグは行ID×列IDのセル範囲として保持し、TSV/HTML tableで表計算ソフトと
   双方向コピー＆ペーストする。従来のテキスト列・タイプ列だけの範囲選択も維持する。 */

const _SN2_GRID_CELL_KEY_SEPARATOR = '\u001f';

function _sn2GridCellKey(rowId, colId) {
  return String(rowId || '') + _SN2_GRID_CELL_KEY_SEPARATOR + String(colId || '');
}

function _sn2GridCellParts(key) {
  const raw = String(key || '');
  const index = raw.indexOf(_SN2_GRID_CELL_KEY_SEPARATOR);
  return index < 0 ? ['', ''] : [raw.slice(0, index), raw.slice(index + 1)];
}

function _sn2QuoteTsvCell(value) {
  const text = String(value == null ? '' : value);
  return /[\t\n\r"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function _sn2EscapeClipboardHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

function _sn2ParseClipboardTable(rawText) {
  const text = String(rawText || '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) {
        quoted = false;
      } else if (!cell) {
        quoted = true;
      } else {
        cell += ch;
      }
      continue;
    }
    if (!quoted && ch === '\t') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!quoted && ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  rows.push(row);
  if (text.endsWith('\n') && rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

Object.assign(ScriptNoteEditor.prototype, {

  _gridVisibleRowIds() {
    return (this.doc?.rows || [])
      .filter(row => this._isRoleVisible(row.role || '', row.status || ''))
      .map(row => row.id);
  },

  _gridSelectableColumnIds() {
    const firstRow = this.host?.querySelector('.sn2-row[data-row-id]');
    const domIds = firstRow
      ? [...firstRow.children].map(cell => cell.dataset?.colId || '').filter(colId => colId && colId !== '_handle')
      : [];
    if (domIds.length) return domIds;
    if (typeof this._getVisibleColumnIds === 'function') return this._getVisibleColumnIds({ includeHandle: false });
    const statusEnabled = !!this.doc?.editor?.statusEnabled;
    const visible = {
      _gutter: true,
      _gutter2: true,
      _role: true,
      _status: statusEnabled,
      _text: true,
      ...(this.doc?.editor?.visibleStandardColumns || {}),
    };
    if (!statusEnabled) visible._status = false;
    const ids = ['_gutter', '_gutter2', '_role', '_status', '_text']
      .filter(colId => visible[colId] !== false)
      .concat((this.doc?.editor?.customColumns || []).filter(col => col?.id && col.visible !== false).map(col => col.id));
    const order = Array.isArray(this.doc?.editor?.columnOrder) ? this.doc.editor.columnOrder : [];
    return ids.sort((left, right) => {
      const li = order.indexOf(left);
      const ri = order.indexOf(right);
      if (li >= 0 && ri >= 0) return li - ri;
      if (li >= 0) return -1;
      if (ri >= 0) return 1;
      return 0;
    });
  },

  _sanitizeGridCellSelection() {
    if (!this._gridCellSelection) return;
    const rows = new Set(this._gridVisibleRowIds());
    const cols = new Set(this._gridSelectableColumnIds());
    for (const key of [...this._gridCellSelection]) {
      const [rowId, colId] = _sn2GridCellParts(key);
      if (!rows.has(rowId) || !cols.has(colId)) this._gridCellSelection.delete(key);
    }
  },

  _updateGridCellSelectionUI() {
    this._sanitizeGridCellSelection();
    this.host?.querySelectorAll('.sn2-row[data-row-id] > [data-col-id]').forEach(cell => {
      const rowId = cell.parentElement?.dataset?.rowId || '';
      const colId = cell.dataset.colId || '';
      cell.classList.toggle('sn2-grid-cell-selected', !!this._gridCellSelection?.has(_sn2GridCellKey(rowId, colId)));
    });
  },

  _clearGridCellSelection() {
    if (this._gridCellSelection) this._gridCellSelection.clear();
    this._gridCellAnchor = null;
    this._updateGridCellSelectionUI();
  },

  _beginGridCellDragSelection(rowId, colId, baseSet = null) {
    if (this._rowSelection?.size) this._clearRowSelection?.();
    if (this._roleCellSelection?.size) this._clearRoleCellSelection?.();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    if (this._activeCellRowId) this._clearActiveCell?.();
    this._gridCellSelection = new Set(baseSet || []);
    this._gridCellAnchor = { rowId, colId };
  },

  _setGridCellRange(anchorRowId, anchorColId, targetRowId, targetColId, baseSet = null) {
    const rowIds = this._gridVisibleRowIds();
    const colIds = this._gridSelectableColumnIds();
    const rowStart = rowIds.indexOf(anchorRowId);
    const rowEnd = rowIds.indexOf(targetRowId);
    const colStart = colIds.indexOf(anchorColId);
    const colEnd = colIds.indexOf(targetColId);
    if (rowStart < 0 || rowEnd < 0 || colStart < 0 || colEnd < 0) return false;
    const next = new Set(baseSet || []);
    const firstRow = Math.min(rowStart, rowEnd);
    const lastRow = Math.max(rowStart, rowEnd);
    const firstCol = Math.min(colStart, colEnd);
    const lastCol = Math.max(colStart, colEnd);
    for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex++) {
      for (let colIndex = firstCol; colIndex <= lastCol; colIndex++) {
        next.add(_sn2GridCellKey(rowIds[rowIndex], colIds[colIndex]));
      }
    }
    this._gridCellSelection = next;
    this._gridCellAnchor = { rowId: anchorRowId, colId: anchorColId };
    this._updateGridCellSelectionUI();
    return true;
  },

  _gridCellSelectionBounds() {
    this._sanitizeGridCellSelection();
    if (!this._gridCellSelection?.size) return null;
    const rowIds = this._gridVisibleRowIds();
    const colIds = this._gridSelectableColumnIds();
    let firstRow = rowIds.length;
    let lastRow = -1;
    let firstCol = colIds.length;
    let lastCol = -1;
    this._gridCellSelection.forEach(key => {
      const [rowId, colId] = _sn2GridCellParts(key);
      const rowIndex = rowIds.indexOf(rowId);
      const colIndex = colIds.indexOf(colId);
      if (rowIndex < 0 || colIndex < 0) return;
      firstRow = Math.min(firstRow, rowIndex);
      lastRow = Math.max(lastRow, rowIndex);
      firstCol = Math.min(firstCol, colIndex);
      lastCol = Math.max(lastCol, colIndex);
    });
    if (lastRow < firstRow || lastCol < firstCol) return null;
    return { rowIds, colIds, firstRow, lastRow, firstCol, lastCol };
  },

  _gridCellValue(rowId, colId) {
    const row = this.doc?.rows?.find(item => item.id === rowId);
    if (!row) return '';
    if (colId === '_role') return row.role || '';
    if (colId === '_status') return row.status || '';
    if (colId === '_text') return typeof _sn2StripRubyToPlain === 'function' ? _sn2StripRubyToPlain(row.text || '') : (row.text || '');
    if (colId === '_gutter' || colId === '_gutter2') {
      const rowEl = [...(this.host?.querySelectorAll('.sn2-row[data-row-id]') || [])].find(el => el.dataset.rowId === rowId);
      return rowEl?.querySelector(`[data-col-id="${colId}"]`)?.textContent || '';
    }
    return row.columns?.[colId] ?? '';
  },

  _gridSelectionMatrix() {
    const bounds = this._gridCellSelectionBounds();
    if (!bounds) return null;
    const matrix = [];
    for (let rowIndex = bounds.firstRow; rowIndex <= bounds.lastRow; rowIndex++) {
      const values = [];
      for (let colIndex = bounds.firstCol; colIndex <= bounds.lastCol; colIndex++) {
        const rowId = bounds.rowIds[rowIndex];
        const colId = bounds.colIds[colIndex];
        values.push(this._gridCellSelection.has(_sn2GridCellKey(rowId, colId)) ? this._gridCellValue(rowId, colId) : '');
      }
      matrix.push(values);
    }
    return { bounds, matrix };
  },

  _handleGridCellSelectionCopy(e) {
    if (!this._gridCellSelection?.size || !this.host?.isConnected) return false;
    if (typeof this._isRowSelectionOwnerActive === 'function' && !this._isRowSelectionOwnerActive()) return false;
    const nativeSelection = window.getSelection();
    if (nativeSelection?.rangeCount && !nativeSelection.isCollapsed) return false;
    const table = this._gridSelectionMatrix();
    if (!table?.matrix?.length) return false;
    const tsv = table.matrix.map(row => row.map(_sn2QuoteTsvCell).join('\t')).join('\n');
    const html = '<table><tbody>' + table.matrix.map(row => '<tr>' + row.map(value => `<td>${_sn2EscapeClipboardHtml(value)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
    e.clipboardData?.setData('text/plain', tsv);
    e.clipboardData?.setData('text/html', html);
    e.preventDefault();
    return true;
  },

  _gridPasteStart(target) {
    const bounds = this._gridCellSelectionBounds();
    if (bounds) return { rowId: bounds.rowIds[bounds.firstRow], colId: bounds.colIds[bounds.firstCol] };
    const cell = target?.closest?.('[data-col-id]');
    const rowId = cell?.closest?.('.sn2-row[data-row-id]')?.dataset?.rowId || this._activeCellRowId || '';
    const colId = cell?.dataset?.colId || this._activeCellColId || '';
    return rowId && colId && colId !== '_handle' ? { rowId, colId } : null;
  },

  _setGridPastedValue(row, colId, value) {
    const text = String(value == null ? '' : value);
    if (colId === '_gutter' || colId === '_gutter2') return false;
    if (colId === '_role') {
      if (globalThis.GBScriptNoteRoleModel?.assignRowRole) {
        globalThis.GBScriptNoteRoleModel.assignRowRole(this.doc, row, text.trim());
      } else {
        row.role = text.trim();
      }
      return true;
    }
    if (colId === '_status') {
      row.status = text.trim();
      return true;
    }
    if (colId === '_text') {
      row.text = typeof _sn2EscapeScriptNotePlainText === 'function' ? _sn2EscapeScriptNotePlainText(text) : text;
      return true;
    }
    if (!row.columns || typeof row.columns !== 'object') row.columns = {};
    const column = (this.doc?.editor?.customColumns || []).find(item => item?.id === colId);
    if (column?.type === 'number') {
      const numberValue = Number(text);
      row.columns[colId] = text === '' ? '' : (Number.isFinite(numberValue) ? numberValue : '');
    } else {
      row.columns[colId] = text;
    }
    return true;
  },

  _createGridPasteRow(templateRow = null) {
    const row = {
      id: globalThis.crypto?.randomUUID?.() || `sn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: templateRow?.role || '',
      ...(templateRow?.roleRef ? { roleRef: { ...templateRow.roleRef } } : {}),
      status: templateRow?.status || '',
      text: '',
      columns: {},
    };
    if (globalThis.GBScriptNoteRoleModel?.assignRowRole) {
      globalThis.GBScriptNoteRoleModel.assignRowRole(this.doc, row, row.roleRef || row.role);
    }
    return row;
  },

  _handleGridCellPaste(e, plainText, pasteInCell = false) {
    if (pasteInCell) return false;
    const hasGridSelection = !!this._gridCellSelection?.size;
    const targetCell = e.target?.closest?.('[data-col-id]');
    const hasTableShape = String(plainText || '').includes('\t');
    if (!hasGridSelection && !hasTableShape && !targetCell?.classList?.contains('sn2-custom-cell')) return false;
    const start = this._gridPasteStart(e.target);
    if (!start) return false;
    const matrix = _sn2ParseClipboardTable(plainText);
    if (!matrix.length || !matrix.some(row => row.length)) return false;
    const colIds = this._gridSelectableColumnIds();
    const startColIndex = colIds.indexOf(start.colId);
    const visibleRowIds = this._gridVisibleRowIds();
    const startVisibleRowIndex = visibleRowIds.indexOf(start.rowId);
    if (startColIndex < 0 || startVisibleRowIndex < 0) return false;
    const hasWritableCell = matrix.some(values => values.some((value, colOffset) => {
      const colId = colIds[startColIndex + colOffset];
      return !!colId && colId !== '_gutter' && colId !== '_gutter2';
    }));
    if (!hasWritableCell) return false;
    e.preventDefault();
    this._pushUndo('表を貼り付け');
    const templateRow = this.doc.rows.find(row => row.id === start.rowId) || null;
    const selectedKeys = new Set();
    let changed = false;
    let mappedColumns = 0;
    matrix.forEach((values, rowOffset) => {
      const targetVisibleIndex = startVisibleRowIndex + rowOffset;
      while (targetVisibleIndex >= visibleRowIds.length) {
        const newRow = this._createGridPasteRow(templateRow);
        this.doc.rows.push(newRow);
        visibleRowIds.push(newRow.id);
      }
      const row = this.doc.rows.find(item => item.id === visibleRowIds[targetVisibleIndex]);
      if (!row) return;
      values.forEach((value, colOffset) => {
        const colId = colIds[startColIndex + colOffset];
        if (!colId) return;
        selectedKeys.add(_sn2GridCellKey(row.id, colId));
        if (this._setGridPastedValue(row, colId, value)) changed = true;
        mappedColumns = Math.max(mappedColumns, colOffset + 1);
      });
    });
    if (changed) {
      this._syncCharactersFromRows?.();
      this._calcCache = null;
      this._gridCellSelection = selectedKeys;
      this._gridCellAnchor = { rowId: start.rowId, colId: start.colId };
      this._render();
      this._markDirty({ skipUndo: true });
      this._updateGridCellSelectionUI();
      this._focusGridCellSelectionHost();
      if (typeof showStatus === 'function') showStatus(`表を貼り付けました: ${matrix.length}行 × ${mappedColumns}列`);
    }
    return true;
  },

  _clearSelectedGridCells() {
    this._sanitizeGridCellSelection();
    if (!this._gridCellSelection?.size) return false;
    const targets = [];
    this._gridCellSelection.forEach(key => {
      const [rowId, colId] = _sn2GridCellParts(key);
      const row = this.doc?.rows?.find(item => item.id === rowId);
      if (row && colId !== '_gutter' && colId !== '_gutter2') targets.push([row, colId]);
    });
    if (!targets.length) return false;
    this._pushUndo('セル内容を削除');
    targets.forEach(([row, colId]) => this._setGridPastedValue(row, colId, ''));
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    this._updateGridCellSelectionUI();
    this._focusGridCellSelectionHost();
    return true;
  },

  _focusGridCellSelectionHost() {
    const host = this.host;
    if (!host?.isConnected || !this._gridCellSelection?.size) return;
    if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');
    try { host.focus({ preventScroll: true }); } catch { host.focus(); }
  },

  _sanitizeTextCellSelection() {
    if (!this._textCellSelection || !this.doc?.rows) return;
    const visible = new Set(this.doc.rows.filter(row => this._isRoleVisible(row.role || '', row.status || '')).map(row => row.id));
    for (const rowId of [...this._textCellSelection]) {
      if (!visible.has(rowId)) this._textCellSelection.delete(rowId);
    }
  },

  _updateTextCellSelectionUI() {
    this._sanitizeTextCellSelection();
    this.host?.querySelectorAll('.sn2-text').forEach((el) => {
      const selected = !!this._textCellSelection?.has(el.dataset.rowId);
      el.classList.toggle('sn2-text-cell-selected', selected);
    });
  },

  _clearTextCellSelection() {
    if (this._textCellSelection) this._textCellSelection.clear();
    this._textCellAnchorIdx = -1;
    this._updateTextCellSelectionUI();
  },

  // ドラッグ選択開始時の初期化。排他: 行選択・タイプセル選択とは同時に成立させない
  _beginTextCellDragSelection(anchorRowId = '') {
    if (this._gridCellSelection?.size) this._clearGridCellSelection();
    if (this._rowSelection?.size) this._clearRowSelection();
    if (this._roleCellSelection?.size) this._clearRoleCellSelection();
    if (!this._textCellSelection) this._textCellSelection = new Set();
    const anchorIdx = anchorRowId ? this.doc.rows.findIndex(row => row.id === anchorRowId) : -1;
    if (anchorIdx >= 0) this._textCellAnchorIdx = anchorIdx;
  },

  // アンカー〜現在行の連続範囲で選択を再構築（フィルタ非表示行はスキップ）
  _setTextCellRange(fromIdx, toIdx, baseSet = null) {
    if (this._gridCellSelection?.size) this._clearGridCellSelection();
    if (this._rowSelection?.size) this._clearRowSelection();
    if (this._roleCellSelection?.size) this._clearRoleCellSelection();
    if (!this._textCellSelection) this._textCellSelection = new Set();
    const next = new Set(baseSet || []);
    const from = Math.max(0, Math.min(fromIdx, toIdx));
    const to = Math.min(this.doc.rows.length - 1, Math.max(fromIdx, toIdx));
    for (let i = from; i <= to; i++) {
      const row = this.doc.rows[i];
      if (row && this._isRoleVisible(row.role || '', row.status || '')) next.add(row.id);
    }
    this._textCellSelection = next;
    this._updateTextCellSelectionUI();
  },

  // 選択行のテキストセル内容をクリアする（行削除ではない。undoで復元可能）
  _clearSelectedTextCells() {
    this._sanitizeTextCellSelection();
    const ids = new Set(this._textCellSelection || []);
    if (!ids.size) return false;
    this._pushUndo('セル内容を削除');
    let emptied = false;
    this.doc.rows.forEach((row) => {
      if (!ids.has(row.id) || !row.text) return;
      row.text = '';
      emptied = true;
    });
    if (emptied) this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    this._updateTextCellSelectionUI();
    this._focusTextCellSelectionHost();
    return true;
  },

  _copyTextCellSelectionText() {
    this._sanitizeTextCellSelection();
    const ids = new Set(this._textCellSelection || []);
    if (!ids.size) return null;
    const rows = this.doc.rows.filter(row => ids.has(row.id));
    if (!rows.length) return null;
    return rows.map(row => (typeof _sn2StripRubyToPlain === 'function' ? _sn2StripRubyToPlain(row.text || '') : (row.text || ''))).join('\n');
  },

  // document copy イベントの受け口（行選択が無いときのみ interactions 側から呼ばれる）
  _handleTextCellSelectionCopy(e) {
    if (!this._textCellSelection?.size) return false;
    if (!this.host?.isConnected) return false;
    if (typeof this._isRowSelectionOwnerActive === 'function' && !this._isRowSelectionOwnerActive()) return false;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) return false; // ネイティブ選択を優先
    const text = this._copyTextCellSelectionText();
    if (text == null) return false;
    e.clipboardData?.setData('text/plain', text);
    e.preventDefault();
    return true;
  },

  // ドラッグ終了後などに host が Delete/Backspace を受けられるようフォーカスを保証する
  _focusTextCellSelectionHost() {
    const host = this.host;
    if (!host?.isConnected || !this._textCellSelection?.size) return;
    const ae = document.activeElement;
    if (ae && host.contains(ae)) return;
    if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');
    try { host.focus({ preventScroll: true }); } catch { host.focus(); }
  },

});
