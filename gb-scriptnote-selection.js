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

  _toggleRowSelection(rowId, idx, shiftKey, ctrlKey) {
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
        newRows.push({ ...row, id: crypto.randomUUID(), columns: { ...(row.columns || {}) } });
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
    const mkBtn = (id, text, title, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.title = title;
      button.dataset.e2eId = id;
      button.setAttribute('aria-label', title);
      button.className = 'gb-selection-float-button';
      button.addEventListener('click', () => {
        if (!this._guardRowBulkAction()) return;
        window.GBSelectionFloatMenu?.pulseButton?.(button);
        onClick();
      });
      return button;
    };
    bar.appendChild(mkBtn('sn-row-bulk-role', 'タイプ変更', '選択行のタイプを一括変更', () => this._bulkChangeRole()));
    bar.appendChild(mkBtn('sn-row-bulk-duplicate', '複製', '選択行を複製', () => this._bulkDuplicateRows()));
    bar.appendChild(mkBtn('sn-row-bulk-delete', '削除', '選択行を一括削除', () => this._bulkDeleteRows()));
    bar.appendChild(mkBtn('sn-row-bulk-invert', '選択反転', '選択状態を反転', () => this._invertRowSelection()));
    bar.appendChild(mkBtn('sn-row-bulk-clear', '選択解除', '選択を解除', () => this._clearRowSelection()));
    this._startRowBulkBarGuard();
  },

  _bulkChangeRole() {
    if (!this._guardRowBulkAction()) return;
    const selectedIds = this._getVisibleSelectedIds();
    if (!selectedIds.size) return;
    const roles = (this.doc.characters || []).map((chara) => chara.name).filter(Boolean);
    if (!roles.length) return;
    const popup = document.createElement('div');
    popup.className = 'sn2-header-popup';
    popup.style.cssText = 'position:fixed;z-index:10100;background:var(--ui-popup-bg, var(--bg3));border:1px solid var(--border);border-radius:6px;padding:4px;box-shadow:0 4px 12px rgba(0,0,0,0.4);max-height:300px;overflow-y:auto;';
    roles.forEach((name) => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:4px 8px;cursor:pointer;font-size:12px;border-radius:3px;';
      item.textContent = name;
      item.addEventListener('click', () => {
        if (!this._guardRowBulkAction()) { popup.remove(); return; }
        popup.remove();
        this._pushUndo('一括タイプ変更');
        this.doc.rows.forEach((row) => { if (selectedIds.has(row.id)) row.role = name; });
        this._render();
        this._markDirty();
        this._clearRowSelection();
      });
      item.addEventListener('pointerenter', () => { item.style.background = 'var(--bg4)'; });
      item.addEventListener('pointerleave', () => { item.style.background = ''; });
      popup.appendChild(item);
    });
    document.body.appendChild(popup);
    const bar = this._rowBulkBar && this._rowBulkBar.isConnected ? this._rowBulkBar : null;
    if (bar && typeof positionPopup === 'function') positionPopup(popup, bar.getBoundingClientRect());
    setTimeout(() => {
      const close = (ev) => {
        if (!popup.contains(ev.target)) {
          popup.remove();
          document.removeEventListener('pointerdown', close, true);
        }
      };
      document.addEventListener('pointerdown', close, true);
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

});
