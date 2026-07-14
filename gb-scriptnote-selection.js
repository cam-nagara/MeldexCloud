/* gb-scriptnote-selection.js: シナリオの複数行選択と一括操作 */

Object.assign(ScriptNoteEditor.prototype, {

  _isRowSelectionTarget(row) {
    return !!(row && this._isRoleVisible(row.role || '', row.status || ''));
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
    if (this._isRowSelectionOwnerActive()) return true;
    if (this._rowSelection) this._rowSelection.clear();
    if (this._textCellSelection) this._textCellSelection.clear();
    if (this._rowBulkBar?.isConnected) this._rowBulkBar.remove();
    this._rowBulkBar = null;
    return false;
  },

  _startRowBulkBarGuard() {
    if (this._rowBulkBarGuardTimer) return;
    this._rowBulkBarGuardTimer = setInterval(() => {
      if (!this._rowBulkBar?.isConnected || !this._rowSelection?.size) {
        this._stopRowBulkBarGuard();
        return;
      }
      if (!this._isRowSelectionOwnerActive()) this._clearRowSelection();
    }, 250);
  },

  _stopRowBulkBarGuard() {
    if (!this._rowBulkBarGuardTimer) return;
    clearInterval(this._rowBulkBarGuardTimer);
    this._rowBulkBarGuardTimer = null;
  },

  _clampRowBulkBarToViewport(bar) {
    if (!bar?.isConnected) return;
    const z = (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
    const margin = 8 / z;
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    const parentRect = bar.offsetParent?.getBoundingClientRect?.() || { left: 0, top: 0 };
    const rect = bar.getBoundingClientRect();
    const box = {
      left: rect.left / z,
      top: rect.top / z,
      width: rect.width / z,
      height: rect.height / z,
    };
    const maxHeight = Math.max(120 / z, vh - margin * 2);
    if (box.height > maxHeight) {
      bar.style.maxHeight = `${maxHeight}px`;
      bar.style.overflowY = 'auto';
    }
    const nextRect = bar.getBoundingClientRect();
    const next = {
      left: nextRect.left / z,
      top: nextRect.top / z,
      width: nextRect.width / z,
      height: nextRect.height / z,
    };
    const clampedLeft = Math.max(margin, Math.min(next.left, vw - next.width - margin));
    const clampedTop = Math.max(margin, Math.min(next.top, vh - next.height - margin));
    if (Math.abs(clampedLeft - next.left) > 0.5 || Math.abs(clampedTop - next.top) > 0.5) {
      bar.style.left = `${clampedLeft - (parentRect.left / z)}px`;
      bar.style.top = `${clampedTop - (parentRect.top / z)}px`;
      bar.style.right = '';
      bar.style.bottom = 'auto';
      bar.style.transform = 'none';
    }
  },

  _toggleRowSelection(rowId, idx, shiftKey, ctrlKey) {
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
        if (!this._isRoleVisible(row.role || '', row.status || '')) continue;
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
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    if (!this._rowSelection) this._rowSelection = new Set();
    this._rowSelection.clear();
    this.doc.rows.forEach((row) => {
      if (!this._isRowSelectionTarget(row)) return;
      this._rowSelection.add(row.id);
    });
    this._updateRowSelectionUI();
  },

  _bulkDuplicateRows() {
    if (!this._guardRowBulkAction()) return;
    const selectedIds = this._getVisibleSelectedIds();
    if (!selectedIds.size) return;
    this._pushUndo('一括複製');
    const newRows = [];
    this.doc.rows.forEach((row) => {
      newRows.push(row);
      if (selectedIds.has(row.id)) {
        const nextId = (globalThis.crypto?.randomUUID?.() || ('sn-row-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)));
        newRows.push({ ...row, id: nextId, columns: { ...(row.columns || {}) } });
      }
    });
    this.doc.rows = newRows;
    this._clearRowSelection();
    this._render();
    this._markDirty();
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
    this._updateRowBulkBar();
  },

  _updateRowBulkBar() {
    let bar = this._rowBulkBar && this._rowBulkBar.isConnected ? this._rowBulkBar : null;
    const count = this._rowSelection?.size || 0;
    if (count >= 1 && !this._isRowSelectionOwnerActive()) {
      if (bar) bar.remove();
      this._rowBulkBar = null;
      this._stopRowBulkBarGuard();
      return;
    }
    if (count < 1) {
      if (bar) bar.remove();
      this._rowBulkBar = null;
      this._stopRowBulkBarGuard();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'sn2-row-bulk-bar gb-selection-float-bar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'シナリオ行の一括操作');
      (this.host || document.body).appendChild(bar);
      this._rowBulkBar = bar;
    }
    if (window.GBSelectionFloatMenu) {
      window.GBSelectionFloatMenu.bindDrag(bar, { host: this.host || document.body });
      window.GBSelectionFloatMenu.resetPosition(bar, { host: this.host || document.body, anchor: this.host, zIndex: '1000' });
    } else {
      const hostRect = this.host?.getBoundingClientRect();
      const zoom = (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
      const left = hostRect ? (hostRect.left / zoom) : 0;
      const top = hostRect ? (hostRect.top / zoom) : 0;
      const offset = 8 / zoom;
      bar.style.cssText = `position:fixed;top:${top + offset}px;left:${left + offset}px;z-index:1000;background:var(--ui-popup-bg, var(--bg3));border:1px solid var(--border);border-left:3px solid var(--accent, #4a90d9);border-radius:6px;padding:6px 12px;display:flex;align-items:center;gap:6px;font-size:12px;box-shadow:0 2px 12px rgba(0,0,0,0.4);width:fit-content;`;
    }
    bar.innerHTML = '';
    if (window.GBSelectionFloatMenu) {
      bar.appendChild(window.GBSelectionFloatMenu.createDragHandle());
    }
    const label = document.createElement('span');
    label.className = 'gb-selection-float-count';
    label.textContent = `${count}行選択中`;
    bar.appendChild(label);
    const mkBtn = (id, text, title, onClick, options = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.title = title;
      button.dataset.e2eId = id;
      button.setAttribute('aria-label', title);
      button.className = 'gb-selection-float-button' + (options.danger ? ' danger' : '');
      button.addEventListener('click', () => {
        if (!this._guardRowBulkAction()) return;
        window.GBSelectionFloatMenu?.pulseButton?.(button);
        onClick();
      });
      return button;
    };
    bar.appendChild(mkBtn('sn-row-bulk-role', 'タイプ変更', '選択行のタイプを一括変更', () => this._bulkChangeRole()));
    bar.appendChild(mkBtn('sn-row-bulk-duplicate', '複製', '選択行を複製', () => this._bulkDuplicateRows()));
    bar.appendChild(mkBtn('sn-row-bulk-delete', '削除', '選択行を一括削除', () => this._bulkDeleteRows(), { danger: true }));
    bar.appendChild(mkBtn('sn-row-bulk-invert', '選択反転', '選択状態を反転', () => this._invertRowSelection()));
    bar.appendChild(mkBtn('sn-row-bulk-clear', '選択解除', '選択を解除', () => this._clearRowSelection()));
    this._clampRowBulkBarToViewport(bar);
    this._startRowBulkBarGuard();
  },

  _bulkChangeRole() {
    if (!this._guardRowBulkAction()) return;
    const selectedIds = this._getVisibleSelectedIds();
    if (!selectedIds.size) return;
    const roles = (this.doc.characters || []).map((chara) => chara.name).filter(Boolean);
    if (!roles.length) return;
    const popup = document.createElement('div');
    popup.className = 'sn2-header-popup sn2-bulk-role-popup';
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', '選択行のタイプを一括変更');
    popup.style.cssText = 'position:fixed;z-index:10100;max-height:300px;overflow-y:auto;';
    const bar = this._rowBulkBar && this._rowBulkBar.isConnected ? this._rowBulkBar : null;
    const trigger = bar?.querySelector?.('[data-e2e-id="sn-row-bulk-role"]') || null;
    const close = (options = {}) => {
      popup.remove();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeydown, true);
      if (options.restoreFocus) trigger?.focus?.();
    };
    const onPointerDown = (ev) => {
      if (!popup.contains(ev.target)) close({ restoreFocus: true });
    };
    const onKeydown = (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      close({ restoreFocus: true });
    };
    roles.forEach((name, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sn2-header-popup-item';
      item.setAttribute('role', 'menuitem');
      item.dataset.e2eId = `sn-row-bulk-role-option-${index + 1}`;
      item.dataset.sn2BulkRoleOption = name;
      item.textContent = name;
      item.addEventListener('click', () => {
        if (!this._guardRowBulkAction()) { close(); return; }
        close();
        this._pushUndo('一括タイプ変更');
        this.doc.rows.forEach((row) => { if (selectedIds.has(row.id)) row.role = name; });
        this._render();
        this._markDirty();
        this._clearRowSelection();
      });
      popup.appendChild(item);
    });
    document.body.appendChild(popup);
    if (bar && typeof positionPopup === 'function') positionPopup(popup, bar.getBoundingClientRect());
    else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
    requestAnimationFrame(() => popup.querySelector('.sn2-header-popup-item')?.focus());
    setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('keydown', onKeydown, true);
    }, 0);
  },

  _bulkDeleteRows() {
    if (!this._guardRowBulkAction()) return;
    const selectedIds = this._getVisibleSelectedIds();
    if (!selectedIds.size) return;
    if ((this.doc?.rows?.length || 0) - selectedIds.size < 1) {
      const keepRow = this.doc.rows.find((row) => selectedIds.has(row.id));
      if (keepRow) selectedIds.delete(keepRow.id);
      if (typeof showStatus === 'function') showStatus('最後の1行は削除できません', true);
    }
    if (!selectedIds.size) {
      this._clearRowSelection();
      return;
    }
    if (typeof showConfirmDialog === 'function') {
      showConfirmDialog(`${selectedIds.size}行を削除しますか？`, () => {
        this._pushUndo('一括行削除');
        this.doc.rows = this.doc.rows.filter((row) => !selectedIds.has(row.id));
        this._clearRowSelection();
        this._render();
        this._markDirty();
      });
    }
  },

  _setRowSelectionState(rowId, idx, selected) {
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
    const visible = new Set(this.doc.rows.filter(row => this._isRoleVisible(row.role || '', row.status || '')).map(row => row.id));
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
    if (this._rowSelection?.size) this._clearRowSelection();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    if (!this._roleCellSelection) this._roleCellSelection = new Set();
    const next = new Set(baseSet || []);
    const from = Math.max(0, Math.min(fromIdx, toIdx));
    const to = Math.min(this.doc.rows.length - 1, Math.max(fromIdx, toIdx));
    for (let i = from; i <= to; i++) {
      const row = this.doc.rows[i];
      if (row && this._isRoleVisible(row.role || '', row.status || '')) next.add(row.id);
    }
    this._roleCellSelection = next;
    this._updateRoleCellSelectionUI();
  },

  _selectRoleCell(rowId, idx, options = {}) {
    if (!rowId || idx < 0) return;
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
      if (this._isRoleVisible(row.role || '', row.status || '')) return next;
      next += dir;
    }
    return -1;
  },

  _writeRoleClipboard(text) {
    const value = String(text || '');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch(() => this._writeRoleClipboardFallback(value));
      return;
    }
    this._writeRoleClipboardFallback(value);
  },

  _writeRoleClipboardFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('aria-hidden', 'true');
    ta.tabIndex = -1;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch {}
    ta.remove();
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
      else { row.role = value; needsRender = true; }
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
    if (crossCol || key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      this._activeCellRowId = rowId;
      this._activeCellColId = '_role';
      this._cellEditMode = false;
      if (this._roleCellSelection?.size) this._clearRoleCellSelection?.();
      this._navigateCell(key === 'Tab' ? (e.shiftKey ? 'prev-col' : 'next-col') : crossCol);
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

});
