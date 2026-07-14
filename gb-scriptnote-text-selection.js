/* gb-scriptnote-text-selection.js: シナリオのテキストセル範囲選択
   矩形ドラッグ・テキストセル跨ぎドラッグ・Shift+矢印で行のテキストセルを範囲選択し、
   コピー（改行結合）と Delete/Backspace によるセル内容クリアを提供する。
   _rowSelection（行選択）/ _roleCellSelection（タイプセル選択）とは相互排他。 */

Object.assign(ScriptNoteEditor.prototype, {

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
    if (this._rowSelection?.size) this._clearRowSelection();
    if (this._roleCellSelection?.size) this._clearRoleCellSelection();
    if (!this._textCellSelection) this._textCellSelection = new Set();
    const anchorIdx = anchorRowId ? this.doc.rows.findIndex(row => row.id === anchorRowId) : -1;
    if (anchorIdx >= 0) this._textCellAnchorIdx = anchorIdx;
  },

  // アンカー〜現在行の連続範囲で選択を再構築（フィルタ非表示行はスキップ）
  _setTextCellRange(fromIdx, toIdx, baseSet = null) {
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
