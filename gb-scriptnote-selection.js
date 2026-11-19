/* gb-scriptnote-selection.js: シナリオの複数行選択と一括操作 */

Object.assign(ScriptNoteEditor.prototype, {

  _isRowSelectionTarget(row) {
    return !!(row && this._isRoleVisible(row));
  },

  _sanitizeRowSelection() {
    if (!this._rowSelection || !this.doc?.rows) return;
    const visibleIds = new Set(this.doc.rows.filter(row => this._isRowSelectionTarget(row)).map(row => row.id));
    for (const rowId of [...this._rowSelection]) {
      if (!visibleIds.has(rowId)) this._rowSelection.delete(rowId);
    }
  },

  _getVisibleSelectedIds() {
    this._sanitizeRowSelection();
    return new Set(this._rowSelection || []);
  },

  _isRowSelectionOwnerActive() {
    if (!this.host?.isConnected || !this.doc?.rows) return false;
    if (this.host.getClientRects && !this.host.getClientRects().length) return false;
    const activeComp = typeof getActiveScriptNoteComponent === 'function' ? getActiveScriptNoteComponent() : null;
    if (activeComp?._editor) return activeComp._editor === this;
    return true;
  },

  _guardRowBulkAction() {
    if (this._readOnly) return false;
    if (this._isRowSelectionOwnerActive()) return true;
    if (this._rowSelection) this._rowSelection.clear();
    if (this._gridCellSelection) this._gridCellSelection.clear();
    if (this._textCellSelection) this._textCellSelection.clear();
    return false;
  },

  _toggleRowSelection(rowId, idx, shiftKey, ctrlKey) {
    if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    if (this._roleCellSelection?.size) this._clearRoleCellSelection?.();
    if (this._activeCellRowId) this._clearActiveCell?.();
    if (!this._rowSelection) this._rowSelection = new Set();
    if (shiftKey && this._lastSelectedIdx >= 0) {
      const from = Math.min(this._lastSelectedIdx, idx);
      const to = Math.max(this._lastSelectedIdx, idx);
      for (let i = from; i <= to; i++) {
        const row = this.doc.rows[i];
        if (!row) continue;
        if (!this._isRoleVisible(row)) continue;
        this._rowSelection.add(row.id);
      }
    } else if (ctrlKey) {
      if (this._rowSelection.has(rowId)) this._rowSelection.delete(rowId);
      else this._rowSelection.add(rowId);
    } else {
      if (this._rowSelection.has(rowId)) this._rowSelection.delete(rowId);
      else this._rowSelection.add(rowId);
    }
    this._lastSelectedIdx = idx;
    this._updateRowSelectionUI();
  },

  _clearRowSelection() {
    if (this._rowSelection) this._rowSelection.clear();
    this._lastSelectedIdx = -1;
    this._updateRowSelectionUI();
  },

  _invertRowSelection() {
    if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    if (!this._rowSelection) this._rowSelection = new Set();
    this._sanitizeRowSelection();
    this.doc.rows.forEach((row) => {
      if (!this._isRowSelectionTarget(row)) return;
      if (this._rowSelection.has(row.id)) this._rowSelection.delete(row.id);
      else this._rowSelection.add(row.id);
    });
    this._updateRowSelectionUI();
  },

  _selectAllRows() {
    if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    if (!this._rowSelection) this._rowSelection = new Set();
    this._rowSelection.clear();
    this.doc.rows.forEach((row) => {
      if (!this._isRowSelectionTarget(row)) return;
      this._rowSelection.add(row.id);
    });
    this._updateRowSelectionUI();
  },

  _updateRowSelectionUI() {
    this._sanitizeRowSelection();
    const editor = this.host?.querySelector('.sn2-editor');
    if (!editor) return;
    editor.querySelectorAll('.sn2-row').forEach((el) => {
      const rowId = el.dataset.rowId;
      const selected = this._rowSelection?.has(rowId) || false;
      el.classList.toggle('sn2-row-selected', selected);
      const checkbox = el.querySelector('.sn2-row-check');
      if (checkbox) checkbox.checked = selected;
    });
  },

  // ---------------------------------------------------------------------------
  // 行メニュー（ハンドル）からの一括実行。対象は MeldexRowHandleMenu.resolveTargets で決める。
  // 押した行が選択中で選択が2行以上なら選択中のすべての行、選択外ならその1行だけ（選択は変えない）。
  // どの一括操作も取り消し履歴は1回分だけ積む。
  // ---------------------------------------------------------------------------

  _rowHandleOrderedIds() {
    return (this.doc?.rows || []).filter(row => this._isRowSelectionTarget(row)).map(row => row.id);
  },

  _rowHandleTargets(rowId) {
    const ordered = this._rowHandleOrderedIds();
    const selected = this._getVisibleSelectedIds();
    const shared = globalThis.MeldexRowHandleMenu;
    if (shared?.resolveTargets) return shared.resolveTargets(rowId, ordered, selected);
    return { batch: false, ids: [rowId], runs: [[rowId]], count: 1, rowId };
  },

  // 引数なしの時は、選択中の行すべてを対象にする。
  _rowBulkTargets(targets = null) {
    if (targets?.ids?.length) return targets;
    const ordered = this._rowHandleOrderedIds();
    const selected = this._getVisibleSelectedIds();
    const ids = ordered.filter(id => selected.has(id));
    if (!ids.length) return null;
    const shared = globalThis.MeldexRowHandleMenu;
    const runs = shared?.runsOf ? shared.runsOf(ordered, new Set(ids)) : ids.map(id => [id]);
    return { batch: ids.length > 1, ids, runs, count: ids.length, rowId: ids[0] };
  },

  _rowBulkInsertPlans(targets, position) {
    const shared = globalThis.MeldexRowHandleMenu;
    if (shared?.planInsertions) return shared.planInsertions(targets, position);
    const where = position === 'above' ? 'above' : 'below';
    return (targets?.runs || []).map(run => ({
      ids: run.slice(), anchorId: where === 'above' ? run[0] : run[run.length - 1], position: where, count: run.length,
    })).reverse();
  },

  _newScenarioRowId() {
    return globalThis.crypto?.randomUUID?.() || ('sn-row-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  },

  // 空の行を作る（行の追加と同じ既定値。絞り込み中はそのタイプ・ステータスを引き継ぐ）。
  _createScenarioEmptyRow(baseRow) {
    let newRole = '';
    if (this._filterRoles && this._filterRoles.size === 1) newRole = [...this._filterRoles][0];
    let newStatus = baseRow?.status || '';
    if (this._filterStatuses && this._filterStatuses.size === 1) newStatus = [...this._filterStatuses][0];
    const newRow = {
      id: `sn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      character: '',
      characterRef: { kind: 'none', id: '__none__' },
      type: newRole,
      role: newRole,
      status: newStatus,
      text: '',
      columns: {},
    };
    if (globalThis.GBScriptNoteRoleModel?.assignRowType) {
      globalThis.GBScriptNoteRoleModel.assignRowType(this.doc, newRow, newRole);
      globalThis.GBScriptNoteRoleModel.assignRowCharacter?.(this.doc, newRow, '');
    } else if (globalThis.GBScriptNoteRoleModel?.assignRowRole) {
      globalThis.GBScriptNoteRoleModel.assignRowRole(this.doc, newRow, newRole);
    }
    return newRow;
  },

  _finishRowBulkEdit() {
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    this._updateRowSelectionUI();
  },

  // 連続して選択された行のまとまりごとに、まとまりの行数ぶんの空行を上／下へ入れる。
  _bulkInsertEmptyRows(targets, position = 'below') {
    if (!this._guardRowBulkAction()) return false;
    const resolved = this._rowBulkTargets(targets);
    if (!resolved) return false;
    const plans = this._rowBulkInsertPlans(resolved, position);
    const total = plans.reduce((sum, plan) => sum + plan.count, 0);
    if (!total) return false;
    this._pushUndo(`${total}行を追加`);
    plans.forEach(plan => {
      const idx = this.doc.rows.findIndex(row => row.id === plan.anchorId);
      if (idx < 0) return;
      const base = this.doc.rows[idx];
      const created = Array.from({ length: plan.count }, () => this._createScenarioEmptyRow(base));
      this.doc.rows.splice(plan.position === 'above' ? idx : idx + 1, 0, ...created);
    });
    this._finishRowBulkEdit();
    return true;
  },

  // まとまりごとに、まとまり全体の複製をまとまりの直後へ入れる。選択は変えない。
  _bulkDuplicateRows(targets = null) {
    if (!this._guardRowBulkAction()) return false;
    const resolved = this._rowBulkTargets(targets);
    if (!resolved) return false;
    this._pushUndo(resolved.count > 1 ? `${resolved.count}行を複製` : '行複製');
    const byId = new Map(this.doc.rows.map(row => [row.id, row]));
    this._rowBulkInsertPlans(resolved, 'below').forEach(plan => {
      const idx = this.doc.rows.findIndex(row => row.id === plan.anchorId);
      if (idx < 0) return;
      const copies = plan.ids
        .map(id => byId.get(id))
        .filter(Boolean)
        .map(row => ({ ...JSON.parse(JSON.stringify(row)), id: this._newScenarioRowId() }));
      this.doc.rows.splice(idx + 1, 0, ...copies);
    });
    this._finishRowBulkEdit();
    return true;
  },

  // 対象をまとめて1つ上（-1）／下（1）へ動かした表示順。端に当たる時は null。
  _bulkMoveRowOrder(targets, dir) {
    const resolved = this._rowBulkTargets(targets);
    if (!resolved) return null;
    const shared = globalThis.MeldexRowHandleMenu;
    return shared?.moveOrder ? shared.moveOrder(this._rowHandleOrderedIds(), resolved.ids, dir) : null;
  },

  // 非表示（絞り込みで隠れた）行の位置はそのままにし、表示中の行の並びだけを入れ替える。
  _bulkMoveRows(targets, dir) {
    if (!this._guardRowBulkAction()) return false;
    const next = this._bulkMoveRowOrder(targets, dir);
    if (!next) return false;
    const byId = new Map(this.doc.rows.map(row => [row.id, row]));
    const visible = new Set(next);
    let cursor = 0;
    this._pushUndo('行移動（複数）');
    this.doc.rows = this.doc.rows.map(row => (visible.has(row.id) ? byId.get(next[cursor++]) : row));
    this._finishRowBulkEdit();
    return true;
  },

  _bulkSetRowRole(targets, name) {
    if (!this._guardRowBulkAction()) return false;
    const resolved = this._rowBulkTargets(targets);
    if (!resolved) return false;
    const ids = new Set(resolved.ids);
    this._pushUndo(resolved.count > 1 ? '一括タイプ変更' : 'タイプ変更');
    this.doc.rows.forEach(row => {
      if (!ids.has(row.id)) return;
      if (globalThis.GBScriptNoteRoleModel?.assignRowType) {
        globalThis.GBScriptNoteRoleModel.assignRowType(this.doc, row, name);
      } else if (globalThis.GBScriptNoteRoleModel?.assignRowRole) {
        globalThis.GBScriptNoteRoleModel.assignRowRole(this.doc, row, name);
      } else {
        row.role = name;
      }
    });
    this._finishRowBulkEdit();
    return true;
  },

  // 対象の行をまとめて削除する（取り消し1回で戻る。全行が対象の時は最初の1行を残す）。
  // ページ単位の編集では、対象の行を含むページを削除する。
  _bulkDeleteRows(targets = null) {
    if (!this._guardRowBulkAction()) return false;
    const resolved = this._rowBulkTargets(targets);
    if (!resolved) return false;
    if (typeof this._deleteRowsKeepingActiveCell !== 'function') return false;
    return this._deleteRowsKeepingActiveCell(resolved.ids, '_text');
  },

  _setRowSelectionState(rowId, idx, selected) {
    if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    if (this._roleCellSelection?.size) this._clearRoleCellSelection?.();
    if (this._activeCellRowId) this._clearActiveCell?.();
    if (!this._rowSelection) this._rowSelection = new Set();
    if (selected) this._rowSelection.add(rowId);
    else this._rowSelection.delete(rowId);
    this._lastSelectedIdx = idx;
    this._updateRowSelectionUI();
  },

  _bindRowCheckDragToggle(host) {
    let active = false;
    let mode = false;
    let pointerId = 0;
    const seen = new Set();
    const apply = (target) => {
      const cb = target?.closest?.('.sn2-row-check');
      const rowEl = cb?.closest?.('.sn2-row');
      const rowId = rowEl?.dataset.rowId || '';
      if (!rowId || seen.has(rowId)) return;
      const idx = this.doc.rows.findIndex(row => row.id === rowId);
      if (idx < 0) return;
      seen.add(rowId);
      this._setRowSelectionState(rowId, idx, mode);
    };
    host.addEventListener('pointerdown', (e) => {
      const cb = e.target.closest?.('.sn2-row-check');
      if (!cb || e.button !== 0) return;
      // Shift+クリックはclick側の範囲選択へ渡す。ここでドラッグ選択を開始すると
      // clickを抑止してしまい、折り返し段や縦書きでも複数選択できなくなる。
      if (e.shiftKey) return;
      const rowId = cb.closest?.('.sn2-row')?.dataset.rowId || '';
      if (!rowId) return;
      e.preventDefault();
      e.stopPropagation();
      active = true;
      pointerId = e.pointerId;
      seen.clear();
      mode = !(this._rowSelection?.has(rowId));
      this._suppressRowCheckClick = true;
      try { host.setPointerCapture(pointerId); } catch {}
      apply(cb);
    });
    host.addEventListener('pointermove', (e) => {
      if (!active) return;
      apply(document.elementFromPoint(e.clientX, e.clientY));
    });
    const end = () => {
      if (!active) return;
      active = false;
      try { host.releasePointerCapture(pointerId); } catch {}
      setTimeout(() => { this._suppressRowCheckClick = false; }, 0);
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('lostpointercapture', end);
  },

  _syncTextCellLiveSize(textEl) {
    if (!textEl?.isConnected) return;
    const rowEl = textEl.closest?.('.sn2-row');
    const scrollEl = textEl.closest?.('.sn2-scroll');
    if (!rowEl || !scrollEl) return;
    const z = (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
    const isVertical = scrollEl.classList.contains('sn2-vertical');
    if (isVertical) {
      const currentWidth = rowEl.getBoundingClientRect().width / z;
      const nextWidth = Math.max(24, Math.ceil(textEl.scrollWidth || currentWidth || 0));
      rowEl.style.minWidth = `${nextWidth}px`;
      return;
    }
    const currentHeight = rowEl.getBoundingClientRect().height / z;
    const nextHeight = Math.max(28, Math.ceil(textEl.scrollHeight || currentHeight || 0));
    rowEl.style.minHeight = `${nextHeight}px`;
    if (textEl.dataset.overflow && textEl.dataset.overflow !== 'wrap') {
      const currentTextWidth = textEl.getBoundingClientRect().width / z;
      const nextTextWidth = Math.max(60, Math.ceil(textEl.scrollWidth || currentTextWidth || 0));
      textEl.style.minWidth = `${nextTextWidth}px`;
    }
  },

  _scheduleTextCellLiveResize(textEl) {
    if (!textEl?.isConnected) return;
    if (this._textCellLiveResizeRaf) cancelAnimationFrame(this._textCellLiveResizeRaf);
    this._textCellLiveResizeRaf = requestAnimationFrame(() => {
      this._textCellLiveResizeRaf = 0;
      this._syncTextCellLiveSize(textEl);
    });
  },

  _sanitizeRoleCellSelection() {
    if (!this._roleCellSelection || !this.doc?.rows) return;
    const visible = new Set(this.doc.rows.filter(row => this._isRoleVisible(row)).map(row => row.id));
    for (const rowId of [...this._roleCellSelection]) {
      if (!visible.has(rowId)) this._roleCellSelection.delete(rowId);
    }
  },

  _roleCellRows(fallbackRowId = '') {
    this._sanitizeRoleCellSelection();
    const ids = new Set(this._roleCellSelection || []);
    if (!ids.size && fallbackRowId) ids.add(fallbackRowId);
    return this.doc.rows.filter(row => ids.has(row.id));
  },

  _roleButtonByRowId(rowId) {
    return [...(this.host?.querySelectorAll('.sn2-role-btn') || [])].find(btn => btn.dataset.rowId === rowId) || null;
  },

  _updateRoleCellSelectionUI() {
    this._sanitizeRoleCellSelection();
    this.host?.querySelectorAll('.sn2-role-btn').forEach((btn) => {
      const selected = !!this._roleCellSelection?.has(btn.dataset.rowId);
      btn.classList.toggle('sn2-role-cell-selected', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  },

  _clearRoleCellSelection() {
    if (this._roleCellSelection) this._roleCellSelection.clear();
    this._lastRoleCellIdx = -1;
    this._updateRoleCellSelectionUI();
  },

  _setRoleCellRange(fromIdx, toIdx, baseSet = null) {
    if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
    if (this._rowSelection?.size) this._clearRowSelection();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    if (!this._roleCellSelection) this._roleCellSelection = new Set();
    const next = new Set(baseSet || []);
    const from = Math.max(0, Math.min(fromIdx, toIdx));
    const to = Math.min(this.doc.rows.length - 1, Math.max(fromIdx, toIdx));
    for (let i = from; i <= to; i++) {
      const row = this.doc.rows[i];
      if (row && this._isRoleVisible(row)) next.add(row.id);
    }
    this._roleCellSelection = next;
    this._updateRoleCellSelectionUI();
  },

  _selectRoleCell(rowId, idx, options = {}) {
    if (!rowId || idx < 0) return;
    if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
    if (this._rowSelection?.size) this._clearRowSelection();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    if (!this._roleCellSelection) this._roleCellSelection = new Set();
    const ctrl = !!options.ctrl;
    if (options.shift && this._lastRoleCellIdx >= 0) {
      this._setRoleCellRange(this._lastRoleCellIdx, idx, ctrl ? this._roleCellSelection : null);
    } else if (ctrl) {
      if (this._roleCellSelection.has(rowId)) this._roleCellSelection.delete(rowId);
      else this._roleCellSelection.add(rowId);
      this._lastRoleCellIdx = idx;
      this._updateRoleCellSelectionUI();
    } else {
      this._roleCellSelection.clear();
      this._roleCellSelection.add(rowId);
      this._lastRoleCellIdx = idx;
      this._updateRoleCellSelectionUI();
    }
  },

  _handleRoleCellClick(roleBtn, e) {
    if (!roleBtn) return false;
    if (this._suppressRoleCellClick) { this._suppressRoleCellClick = false; return true; }
    if (this._activeCellRowId) this._clearActiveCell?.();
    const rowId = roleBtn.dataset.rowId || '';
    const idx = this.doc.rows.findIndex(row => row.id === rowId);
    this._selectRoleCell(rowId, idx, { shift: e?.shiftKey, ctrl: e?.ctrlKey || e?.metaKey });
    if (!e?.shiftKey && !(e?.ctrlKey || e?.metaKey)) {
      this._activeCellRowId = rowId;
      this._activeCellColId = '_role';
      this._cellEditMode = false;
    }
    roleBtn.focus();
    return true;
  },

  _nextVisibleRoleIndex(idx, dir) {
    let next = idx + dir;
    while (next >= 0 && next < this.doc.rows.length) {
      const row = this.doc.rows[next];
      if (this._isRoleVisible(row)) return next;
      next += dir;
    }
    return -1;
  },

  _writeRoleClipboard(text) {
    const value = String(text || '');
    const fallback = () => {
      if (this._writeRoleClipboardFallback(value)) return;
      if (typeof showStatus === 'function') showStatus('タイプをコピーできませんでした。クリップボードへの書き込みが許可されていません', true);
    };
    if (navigator.clipboard?.writeText) {
      Promise.resolve()
        .then(() => navigator.clipboard.writeText(value))
        .catch(fallback);
      return;
    }
    fallback();
  },

  // 成功したら true。ブラウザがコピーを拒否・失敗した時は false を返す。
  _writeRoleClipboardFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('aria-hidden', 'true');
    ta.tabIndex = -1;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    let copied = false;
    try {
      ta.focus();
      ta.select();
      copied = document.execCommand('copy') !== false;
    } catch {
      copied = false;
    } finally {
      ta.remove();
    }
    return copied;
  },

  _copyRoleCellSelection(fallbackRowId = '') {
    const rows = this._roleCellRows(fallbackRowId);
    if (!rows.length) return false;
    this._writeRoleClipboard(rows.map(row => row.role || '').join('\n'));
    return true;
  },

  _applyRoleValuesToSelection(text, fallbackRowId = '', undoLabel = 'タイプ貼り付け') {
    const rows = this._roleCellRows(fallbackRowId);
    if (!rows.length) return false;
    const values = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    this._pushUndo(undoLabel);
    let needsRender = false;
    rows.forEach((row, i) => {
      const idx = this.doc.rows.indexOf(row);
      const value = (values.length === 1 ? values[0] : (values[i] ?? values[values.length - 1] ?? '')).trim();
      const rowEl = this._roleButtonByRowId(row.id)?.closest?.('.sn2-row') || null;
      if (rowEl && typeof this._setRowRole === 'function') this._setRowRole(idx, rowEl, value);
      else {
        if (globalThis.GBScriptNoteRoleModel?.assignRowType) {
          globalThis.GBScriptNoteRoleModel.assignRowType(this.doc, row, value);
        } else if (globalThis.GBScriptNoteRoleModel?.assignRowRole) {
          globalThis.GBScriptNoteRoleModel.assignRowRole(this.doc, row, value);
        } else {
          row.role = value;
        }
        needsRender = true;
      }
    });
    if (needsRender) this._render();
    this._markDirty({ skipUndo: true });
    this._updateRoleCellSelectionUI();
    return true;
  },

  async _pasteRoleCellSelectionFromClipboard(fallbackRowId = '') {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text == null) return false;
      return this._applyRoleValuesToSelection(text, fallbackRowId);
    } catch {
      if (typeof showStatus === 'function') showStatus('クリップボードを読み取れませんでした', true);
      return false;
    }
  },

  _clearSelectedRoleCells(fallbackRowId = '') {
    return this._applyRoleValuesToSelection('', fallbackRowId, 'タイプ削除');
  },

  _handleRoleCellKeydown(roleBtn, e) {
    const rowId = roleBtn?.dataset.rowId || '';
    const idx = this.doc.rows.findIndex(row => row.id === rowId);
    if (!rowId || idx < 0) return false;
    const key = e.key;
    const lk = String(key || '').toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (key === 'Enter' && !mod) {
      e.preventDefault(); e.stopPropagation();
      this._selectRoleCell(rowId, idx);
      this._showRoleMenu(roleBtn);
      return true;
    }
    if (mod && !e.shiftKey && (lk === 'c' || lk === 'x')) {
      e.preventDefault(); e.stopPropagation();
      this._copyRoleCellSelection(rowId);
      if (lk === 'x') this._clearSelectedRoleCells(rowId);
      return true;
    }
    if (mod && !e.shiftKey && lk === 'v') {
      e.preventDefault(); e.stopPropagation();
      this._pasteRoleCellSelectionFromClipboard(rowId);
      return true;
    }
    if ((key === 'Delete' || key === 'Backspace') && !mod) {
      e.preventDefault(); e.stopPropagation();
      this._clearSelectedRoleCells(rowId);
      return true;
    }
    const isVertical = this.doc.editor?.viewMode === 'vertical';
    const dir = key === (isVertical ? 'ArrowRight' : 'ArrowUp') ? -1 : key === (isVertical ? 'ArrowLeft' : 'ArrowDown') ? 1 : 0;
    if (dir) {
      const nextIdx = this._nextVisibleRoleIndex(idx, dir);
      if (nextIdx < 0) return false;
      e.preventDefault(); e.stopPropagation();
      const nextRow = this.doc.rows[nextIdx];
      this._selectRoleCell(nextRow.id, nextIdx, { shift: e.shiftKey, ctrl: mod });
      const nextBtn = this._roleButtonByRowId(nextRow.id);
      if (nextBtn) {
        nextBtn.focus();
        nextBtn.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
      return true;
    }
    const crossCol = isVertical
      ? (key === 'ArrowUp' ? 'prev-col' : key === 'ArrowDown' ? 'next-col' : null)
      : (key === 'ArrowLeft' ? 'prev-col' : key === 'ArrowRight' ? 'next-col' : null);
    // Tabでキャラ、Shift+Tabでタイプの選択メニューを開く。
    if (key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      this._selectRoleCell(rowId, idx);
      const target = roleBtn.closest('.sn2-row')?.querySelector(e.shiftKey ? '.sn2-role-btn' : '.sn2-character-btn');
      if (target) this._showRoleMenu(target, { kind: e.shiftKey ? 'type' : 'character' });
      return true;
    }
    if (crossCol) {
      e.preventDefault(); e.stopPropagation();
      this._activeCellRowId = rowId;
      this._activeCellColId = '_role';
      this._cellEditMode = false;
      if (this._roleCellSelection?.size) this._clearRoleCellSelection?.();
      this._navigateCell(crossCol);
      return true;
    }
    if (key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (this._roleCellSelection?.size) this._clearRoleCellSelection?.();
      this._activeCellRowId = null;
      this._activeCellColId = null;
      this._cellEditMode = false;
      return true;
    }
    return false;
  },

  _bindRoleCellSelection(host) {
    let pending = false;
    let dragging = false;
    let startIdx = -1;
    let startX = 0;
    let startY = 0;
    let pointerId = 0;
    let baseSet = null;
    const threshold = 4;
    host.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest?.('.sn2-role-btn');
      if (!btn || e.button !== 0) return;
      pending = true;
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      pointerId = e.pointerId;
      startIdx = this.doc.rows.findIndex(row => row.id === btn.dataset.rowId);
      baseSet = (e.ctrlKey || e.metaKey) ? new Set(this._roleCellSelection || []) : new Set();
    });
    host.addEventListener('pointermove', (e) => {
      if (!pending) return;
      if (!dragging && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < threshold) return;
      dragging = true;
      try { host.setPointerCapture(pointerId); } catch {}
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.sn2-role-btn');
      const overIdx = this.doc.rows.findIndex(row => row.id === over?.dataset.rowId);
      if (startIdx >= 0 && overIdx >= 0) this._setRoleCellRange(startIdx, overIdx, baseSet);
    });
    const end = () => {
      if (dragging) {
        this._suppressRoleCellClick = true;
        setTimeout(() => { this._suppressRoleCellClick = false; }, 0);
      }
      try { if (pointerId) host.releasePointerCapture(pointerId); } catch {}
      pending = false;
      dragging = false;
      pointerId = 0;
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
    host.addEventListener('lostpointercapture', end);
  },

  _showRoleCellContextMenu(roleBtn, e) {
    if (!roleBtn) return false;
    const rowId = roleBtn.dataset.rowId || '';
    const idx = this.doc.rows.findIndex(row => row.id === rowId);
    if (!this._roleCellSelection?.has(rowId)) this._selectRoleCell(rowId, idx);
    document.querySelectorAll('.sn2-role-cell-menu').forEach(el => el.remove());
    const menu = document.createElement('div');
    menu.className = 'sn2-role-cell-menu sn2-header-popup';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'タイプセル操作');
    const close = (options = {}) => {
      menu.remove();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeydown, true);
      if (options.restoreFocus) roleBtn.focus?.();
    };
    const onPointerDown = (ev) => {
      if (!menu.contains(ev.target)) close({ restoreFocus: true });
    };
    const onKeydown = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      close({ restoreFocus: true });
    };
    const mk = (label, fn, actionId = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sn2-header-popup-item';
      btn.setAttribute('role', 'menuitem');
      if (actionId) {
        btn.dataset.sn2RoleCellMenuAction = actionId;
        btn.dataset.e2eId = `sn2-role-cell-menu-${actionId}`;
      }
      btn.textContent = label;
      btn.addEventListener('click', () => { close(); fn(); });
      return btn;
    };
    menu.appendChild(mk('コピー', () => this._copyRoleCellSelection(rowId), 'copy'));
    menu.appendChild(mk('貼り付け', () => this._pasteRoleCellSelectionFromClipboard(rowId), 'paste'));
    menu.appendChild(mk('削除', () => this._clearSelectedRoleCells(rowId), 'clear'));
    menu.style.cssText = 'position:fixed;z-index:10000;min-width:140px;';
    document.body.appendChild(menu);
    const rect = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
    if (typeof positionPopup === 'function') positionPopup(menu, rect);
    else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    requestAnimationFrame(() => menu.querySelector('.sn2-header-popup-item')?.focus());
    setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKeydown, true);
    }, 0);
    return true;
  },

  // ハンドルクリックの行メニュー（MeldexRowHandleMenu）の項目。
  // 操作はすべて既存の行操作と同じ取り消し履歴に積む。
  // 押した行が選択中（2行以上）の時は、一括実行できる項目だけを出し、選択中のすべての行へ適用する。
  _rowHandleMenuItems(rowId) {
    const idx = this.doc?.rows?.findIndex(row => row.id === rowId) ?? -1;
    if (idx < 0) return [];
    const readOnly = !!this._readOnly;
    const targets = this._rowHandleTargets(rowId);
    const batch = !!targets.batch;
    const selected = !!this._rowSelection?.has(rowId);
    const neighbor = dir => this._rowHandleNeighborIndex(idx, dir) >= 0;
    const canMove = dir => (batch ? !!this._bulkMoveRowOrder(targets, dir) : neighbor(dir));
    const row = this.doc.rows[idx];
    // 一括時だけ対象行を集める（行数×選択数の比較を避けるため集合で判定する）。
    const targetIdSet = batch ? new Set(targets.ids) : null;
    const targetRows = batch ? this.doc.rows.filter(item => targetIdSet.has(item.id)) : [];
    const roles = (globalThis.GBScriptNoteRoleModel?.buildRoleChoices?.(this.doc) || [])
      .filter(choice => choice && choice.kind !== 'none')
      .map(choice => String(choice.name || choice.label || ''))
      .filter(Boolean);
    // ビューの「追加・削除はページ単位」の時は、行の追加・削除がページ単位になる。
    // ページの追加は、複数行がどのページに属するかで意味が変わるため一括にしない。
    const pageUnit = this._scenarioViewEditUnit?.() === 'page';
    const items = [
      { icon: 'arrowUp', label: pageUnit ? '上にページを追加' : '上に行を追加', e2eId: 'sn-row-menu-add-above', disabled: readOnly,
        batch: !pageUnit, batchLabel: count => `上に${count}行を追加`,
        action: () => (batch ? this._bulkInsertEmptyRows(targets, 'above') : this._insertEmptyRowRelative(rowId, 'above', '_text')) },
      { icon: 'arrowDown', label: pageUnit ? '下にページを追加' : '下に行を追加', e2eId: 'sn-row-menu-add-below', disabled: readOnly,
        batch: !pageUnit, batchLabel: count => `下に${count}行を追加`,
        action: () => (batch ? this._bulkInsertEmptyRows(targets, 'below') : this._insertEmptyRowRelative(rowId, 'below', '_text')) },
      { icon: 'copy', label: '複製', e2eId: 'sn-row-menu-duplicate', disabled: readOnly,
        batch: true, batchLabel: count => `${count}行を複製`,
        action: () => (batch ? this._bulkDuplicateRows(targets) : this._duplicateRowById(rowId)) },
      { type: 'separator' },
      { icon: 'chevronUp', label: '上へ移動', e2eId: 'sn-row-menu-move-up', disabled: readOnly || !canMove(-1),
        batch: true, batchLabel: count => `${count}行を上へ移動`,
        action: () => (batch ? this._bulkMoveRows(targets, -1) : this._moveRowById(rowId, -1)) },
      { icon: 'chevronDown', label: '下へ移動', e2eId: 'sn-row-menu-move-down', disabled: readOnly || !canMove(1),
        batch: true, batchLabel: count => `${count}行を下へ移動`,
        action: () => (batch ? this._bulkMoveRows(targets, 1) : this._moveRowById(rowId, 1)) },
    ];
    if (roles.length && !readOnly) {
      items.push({
        icon: 'tag', label: 'タイプ変更', e2eId: 'sn-row-menu-role',
        batch: true, batchLabel: count => `${count}行のタイプを変更`,
        items: roles.map((name, index) => ({
          label: name,
          e2eId: `sn-row-menu-role-${index + 1}`,
          batch: true,
          disabled: batch
            ? targetRows.every(item => String(item.role || '') === name)
            : String(row.role || '') === name,
          action: () => (batch ? this._bulkSetRowRole(targets, name) : this._setRowRoleById(rowId, name)),
        })),
      });
    }
    if (typeof this._scenarioPageHasBreaks === 'function' && this._scenarioPageHasBreaks()) {
      items.push({
        icon: 'bookOpen', label: 'ページ', e2eId: 'sn-row-menu-page', batch: true,
        items: [
          { label: '上にページを追加', e2eId: 'sn-row-menu-page-add-above', disabled: readOnly,
            action: () => this._insertScenarioPageRelative(rowId, 'above', '_text') },
          { label: '下にページを追加', e2eId: 'sn-row-menu-page-add-below', disabled: readOnly,
            action: () => this._insertScenarioPageRelative(rowId, 'below', '_text') },
          { label: 'ページを複製', e2eId: 'sn-row-menu-page-duplicate', disabled: readOnly,
            action: () => this._duplicateScenarioPage(rowId) },
          { label: 'ページを上へ移動', e2eId: 'sn-row-menu-page-move-up', disabled: readOnly,
            action: () => this._moveScenarioPage(rowId, -1) },
          { label: 'ページを下へ移動', e2eId: 'sn-row-menu-page-move-down', disabled: readOnly,
            action: () => this._moveScenarioPage(rowId, 1) },
          { label: 'ページを削除', e2eId: 'sn-row-menu-page-delete', danger: true, disabled: readOnly,
            // ページ単位の編集では下の「削除」が同じ操作になるため、一括時は重ねて出さない。
            batch: !pageUnit, batchLabel: '選択行のページを削除',
            action: () => this._deleteScenarioPagesForRows(batch ? targets.ids.slice() : [rowId], this._activeCellColId || '_text') },
        ],
      });
    }
    items.push(
      { type: 'separator' },
      { icon: selected ? 'squareMinus' : 'squareCheck', label: selected ? '選択解除' : '選択', e2eId: 'sn-row-menu-select',
        action: () => {
          const currentIdx = this.doc.rows.findIndex(item => item.id === rowId);
          if (currentIdx >= 0) this._toggleRowSelection(rowId, currentIdx, false, true);
        } },
      { icon: 'squareMinus', label: '選択を解除', e2eId: 'sn-row-menu-clear-selection', batchOnly: true,
        action: () => this._clearRowSelection() },
      { icon: 'arrowLeftRight', label: '選択を反転', e2eId: 'sn-row-menu-invert-selection', batchOnly: true,
        action: () => this._invertRowSelection() },
      { type: 'separator' },
      { icon: 'trash2', label: pageUnit ? 'ページを削除' : '削除', danger: true, e2eId: 'sn-row-menu-delete',
        disabled: readOnly || (!batch && this.doc.rows.length <= 1),
        batch: true, batchLabel: count => (pageUnit ? '選択行のページを削除' : `${count}行を削除`),
        action: () => (batch ? this._bulkDeleteRows(targets) : this._deleteRowById(rowId)) },
    );
    const shared = globalThis.MeldexRowHandleMenu;
    if (shared?.buildItems) return shared.buildItems(items, targets, { unit: '行', labelE2eId: 'sn-row-menu-batch-label' });
    return items.filter(item => !item.batchOnly);
  },

  _rowHandleNeighborIndex(idx, dir) {
    let target = idx + dir;
    while (target >= 0 && target < this.doc.rows.length) {
      if (this._isRoleVisible(this.doc.rows[target])) return target;
      target += dir;
    }
    return -1;
  },

  _duplicateRowById(rowId) {
    if (this._readOnly) return null;
    const idx = this.doc.rows.findIndex(row => row.id === rowId);
    if (idx < 0) return null;
    this._pushUndo('行複製');
    const nextId = (globalThis.crypto?.randomUUID?.() || ('sn-row-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));
    const copy = { ...JSON.parse(JSON.stringify(this.doc.rows[idx])), id: nextId };
    this.doc.rows.splice(idx + 1, 0, copy);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    return copy;
  },

  _moveRowById(rowId, dir) {
    if (this._readOnly) return false;
    const idx = this.doc.rows.findIndex(row => row.id === rowId);
    if (idx < 0) return false;
    const targetIdx = this._rowHandleNeighborIndex(idx, dir);
    if (targetIdx < 0) return false;
    this._pushUndo('行入れ替え');
    const tmp = this.doc.rows[idx];
    this.doc.rows[idx] = this.doc.rows[targetIdx];
    this.doc.rows[targetIdx] = tmp;
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    return true;
  },

  _setRowRoleById(rowId, name) {
    if (this._readOnly) return false;
    const row = this.doc.rows.find(item => item.id === rowId);
    if (!row) return false;
    this._pushUndo('タイプ変更');
    if (globalThis.GBScriptNoteRoleModel?.assignRowType) {
      globalThis.GBScriptNoteRoleModel.assignRowType(this.doc, row, name);
    } else if (globalThis.GBScriptNoteRoleModel?.assignRowRole) {
      globalThis.GBScriptNoteRoleModel.assignRowRole(this.doc, row, name);
    } else {
      row.role = name;
    }
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    return true;
  },

  _deleteRowById(rowId) {
    if (this._readOnly) return false;
    if (this._scenarioViewEditUnit?.() === 'page') {
      return this._deleteScenarioPagesForRows([rowId], this._activeCellColId || '_text');
    }
    const idx = this.doc.rows.findIndex(row => row.id === rowId);
    if (idx < 0) return false;
    if (this.doc.rows.length <= 1) {
      if (typeof showStatus === 'function') showStatus('最後の1行は削除できません', true);
      return false;
    }
    const focusColId = this._activeCellColId || '_text';
    this._pushUndo('行削除');
    this.doc.rows.splice(idx, 1);
    this._rowSelection?.delete?.(rowId);
    if (this._activeCellRowId === rowId) { this._activeCellRowId = null; this._cellEditMode = false; }
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    this._updateRowSelectionUI?.();
    // 削除した位置の次の行をアクティブにし、キーボード操作を続けられるようにする。
    this._activateCellNearAfterClose?.(idx, focusColId);
    return true;
  },

});
