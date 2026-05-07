/* gb-scriptnote-interactions.js: シナリオの入力インタラクション */

function _sn2GetDragRectStyles(customColor) {
  if (customColor) {
    let bgStyle = customColor;
    if (!customColor.includes('rgba') && !customColor.includes('hsla')) {
      bgStyle = `color-mix(in srgb, ${customColor} 20%, transparent)`;
    }
    return { bgStyle, bdStyle: customColor };
  }
  return {
    bgStyle: 'rgba(74,144,217,0.15)',
    bdStyle: 'var(--accent, #4a90d9)',
  };
}

Object.assign(ScriptNoteEditor.prototype, {

  runShortcutAction(id, e) {
    if (e?.isComposing) return false;
    const ae = document.activeElement;
    if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return false;
    switch (id) {
      case 'scenario.undo':
        if (typeof this.undo !== 'function') return false;
        this.undo();
        return true;
      case 'scenario.redo':
        if (typeof this.redo !== 'function') return false;
        this.redo();
        return true;
      case 'scenario.ruby':
        if (typeof this._insertRuby !== 'function') return false;
        this._insertRuby();
        return true;
      case 'scenario.search':
        return this._runSearchShortcut();
      case 'scenario.deselectAll':
        return this._runDeselectAllShortcut();
      case 'scenario.selectAll':
        if (typeof this._selectAllRows !== 'function') return false;
        this._selectAllRows();
        return true;
      case 'scenario.moveUp':
        return this._runMoveRowShortcut(-1);
      case 'scenario.moveDown':
        return this._runMoveRowShortcut(1);
      case 'scenario.addRow':
        return this._runAddRowShortcut(false, e);
      case 'scenario.addRowSameType':
        return this._runAddRowShortcut(true, e);
      case 'scenario.newline':
        return this._runNewlineShortcut(e);
      case 'scenario.tab':
        return this._runTabShortcut(e);
      case 'scenario.deleteRow':
        return this._runDeleteRowShortcut(e);
      case 'scenario.escape':
        return this._runEscapeShortcut();
      case 'scenario.copy':
        document.execCommand('copy');
        return true;
      case 'scenario.cut':
        document.execCommand('cut');
        return true;
      case 'scenario.paste':
        return false;
      case 'scenario.pasteInCell':
        this._pasteInCellFlag = true;
        setTimeout(() => { this._pasteInCellFlag = false; }, 200);
        return false;
      default:
        return false;
    }
  },

  _shortcutTextTarget(e) {
    const target = e?.target || document.activeElement;
    return target?.closest?.('.sn2-text') || document.activeElement?.closest?.('.sn2-text') || null;
  },

  _runSearchShortcut() {
    const searchBtn = this.host?.closest?.('.gb-se-root')?.querySelector?.('[data-sn-action="search"]') || null;
    if (typeof this._showSearchReplacePopup !== 'function') return false;
    this._showSearchReplacePopup(searchBtn);
    return true;
  },

  _runDeselectAllShortcut() {
    if (this._rowSelection?.size) this._clearRowSelection();
    this._lastSelectedIdx = -1;
    const sel = window.getSelection();
    if (sel?.rangeCount && !sel.isCollapsed) sel.collapseToStart();
    return true;
  },

  _runMoveRowShortcut(dir) {
    const text = this._shortcutTextTarget();
    if (!text) return false;
    const row = text.closest('.sn2-row');
    if (!row) return false;
    const rowId = row.dataset.rowId;
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    if (idx < 0) return false;
    let targetIdx = idx + dir;
    while (targetIdx >= 0 && targetIdx < this.doc.rows.length) {
      const targetRow = this.doc.rows[targetIdx];
      if (this._isRoleVisible(targetRow.role, targetRow.status || '')) break;
      targetIdx += dir;
    }
    if (targetIdx < 0 || targetIdx >= this.doc.rows.length) return false;
    this._pushUndo('行入れ替え');
    const targetRowId = this.doc.rows[targetIdx].id;
    const tmp = this.doc.rows[idx];
    this.doc.rows[idx] = this.doc.rows[targetIdx];
    this.doc.rows[targetIdx] = tmp;
    this._calcCache = null;
    const targetRow = this.host?.querySelector(`.sn2-row[data-row-id="${targetRowId}"]`);
    if (row && targetRow && !this._filterRoles) {
      if (dir === -1) row.parentNode.insertBefore(row, targetRow);
      else row.parentNode.insertBefore(row, targetRow.nextSibling);
      this._updateGuttersFrom(Math.min(idx, targetIdx));
      row.classList.add('sn2-swap-highlight');
      setTimeout(() => row.classList.remove('sn2-swap-highlight'), 400);
    } else {
      this._render();
    }
    this._markDirty({ skipUndo: true });
    requestAnimationFrame(() => {
      const curRow = this.host?.querySelector(`.sn2-row[data-row-id="${rowId}"]`);
      const newText = curRow?.querySelector('.sn2-text');
      if (!newText) return;
      const sel = window.getSelection();
      const inText = sel?.anchorNode && newText.contains(sel.anchorNode);
      if (!inText) this._focusText(newText, 'start');
      if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      requestAnimationFrame(() => {
        if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      });
    });
    return true;
  },

  _runAddRowShortcut(keepRole, e) {
    const text = this._shortcutTextTarget(e);
    if (!text) return false;
    const splitOffset = this._getTextOffset(text);
    this._pushUndo(keepRole ? '同タイプ行追加' : '行追加');
    this._splitRow(text, { keepRole, visibleOffset: splitOffset });
    return true;
  },

  _runNewlineShortcut(e) {
    const text = this._shortcutTextTarget(e);
    if (!text) return false;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return false;
    const range = sel.getRangeAt(0);
    this._pushUndo('セル内改行');
    range.deleteContents();
    const br = document.createElement('br');
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    let needsTrailingBr = true;
    for (let n = br.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 3 && !n.textContent) continue;
      if (n.nodeType === 1 && n.tagName === 'BR') { needsTrailingBr = false; break; }
      needsTrailingBr = false;
      break;
    }
    if (needsTrailingBr) text.appendChild(document.createElement('br'));
    text.style.height = 'auto';
    this._syncRowFromDom(text, { skipUndo: true });
    requestAnimationFrame(() => {
      const r2 = sel.getRangeAt(0);
      const marker = document.createElement('span');
      r2.insertNode(marker);
      marker.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const markerParent = marker.parentNode;
      const markerIndex = markerParent ? Array.prototype.indexOf.call(markerParent.childNodes, marker) : -1;
      marker.remove();
      if (markerParent && markerIndex >= 0) {
        const restoreRange = document.createRange();
        restoreRange.setStart(markerParent, Math.min(markerIndex, markerParent.childNodes.length));
        restoreRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(restoreRange);
      } else {
        sel.collapseToEnd();
      }
      if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      requestAnimationFrame(() => {
        if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      });
    });
    return true;
  },

  _runTabShortcut(e) {
    const text = this._shortcutTextTarget(e);
    if (!text) return false;
    const row = text.closest('.sn2-row');
    if (!row) return false;
    const roleBtn = row.querySelector('.sn2-role-btn');
    if (roleBtn) this._showRoleMenu(roleBtn);
    return true;
  },

  _runDeleteRowShortcut(e) {
    const text = this._shortcutTextTarget(e);
    if (!text) return false;
    const row = text.closest('.sn2-row');
    if (!row) return false;
    const rowId = row.dataset.rowId;
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    if (idx < 0 || this.doc.rows.length <= 1) return false;
    this._pushUndo('行削除');
    this.doc.rows.splice(idx, 1);
    this._calcCache = null;
    const focusIdx = Math.min(idx, this.doc.rows.length - 1);
    const focusId = this.doc.rows[focusIdx].id;
    this._render();
    this._markDirty({ skipUndo: true });
    requestAnimationFrame(() => {
      const nextEl = this.host?.querySelector(`.sn2-row[data-row-id="${focusId}"] .sn2-text`);
      if (nextEl) this._focusText(nextEl, 'start');
    });
    return true;
  },

  _runEscapeShortcut() {
    document.querySelectorAll('.sn2-header-popup, .sn2-header-sub-popup, .gb-fmt-popup--bulk-edit').forEach(el => el.remove());
    if (typeof this._closeRoleMenu === 'function') this._closeRoleMenu();
    if (this._rowSelection?.size) this._clearRowSelection();
    return true;
  },

  _bindInteractionEvents(host) {
    this._bindWheelScroll(host);
    this._bindDragSelection(host);
    this._bindRowSelectionCopy();
    this._bindRightDragPan(host);
  },

  _bindWheelScroll(host) {
    host.addEventListener('wheel', (e) => {
      const sc = e.target.closest?.('.sn2-scroll');
      if (!sc) return;
      const isVerticalMode = this.doc.editor?.viewMode === 'vertical';
      const isWrap = !!this.doc.editor?.wrapMode;
      if (!e.deltaY || e.deltaX) return;
      const stored = parseFloat(localStorage.getItem('meldex-wheel-speed'));
      const mul = (!isNaN(stored) && stored > 0) ? stored : 2.5;
      if (isWrap && !isVerticalMode) {
        e.preventDefault();
        sc.scrollBy({ left: e.deltaY * mul, behavior: 'smooth' });
      } else if (!isWrap && isVerticalMode) {
        e.preventDefault();
        sc.scrollBy({ left: -e.deltaY * mul, behavior: 'smooth' });
      }
    }, { passive: false });
  },

  _bindDragSelection(host) {
    let dragSelecting = false;
    let dragPending = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragPointerId = 0;
    let dragCtrl = false;
    let dragShift = false;
    let dragRect = null;
    let textDragRowId = null;
    let textDragStartX = 0;
    let textDragStartY = 0;
    let textDragPointerId = 0;
    const DRAG_THRESHOLD = 4;

    const updateDragRect = (x, y) => {
      if (!dragRect) {
        dragRect = document.createElement('div');
        dragRect.className = 'sn2-drag-select-rect';
        document.body.appendChild(dragRect);
      }
      const z = typeof _getZoom === 'function' ? _getZoom() : 1;
      const left = Math.min(dragStartX, x) / z;
      const top = Math.min(dragStartY, y) / z;
      const w = Math.abs(x - dragStartX) / z;
      const h = Math.abs(y - dragStartY) / z;
      const customColor = this.doc.editor?.dragSelectColor || '';
      const { bgStyle, bdStyle } = _sn2GetDragRectStyles(customColor);
      dragRect.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${w}px;height:${h}px;z-index:9999;background:${bgStyle};border:1px solid ${bdStyle};border-radius:2px;pointer-events:none;`;
    };
    const removeDragRect = () => {
      if (dragRect) {
        dragRect.remove();
        dragRect = null;
      }
    };
    const cancelDragState = () => {
      textDragRowId = null;
      dragPending = false;
      if (dragSelecting) {
        dragSelecting = false;
        removeDragRect();
        this._updateRowSelectionUI();
      }
    };
    if (this._dragSelectionDocCleanup) this._dragSelectionDocCleanup();
    document.addEventListener('pointerup', cancelDragState);
    document.addEventListener('pointercancel', cancelDragState);
    this._dragSelectionDocCleanup = () => {
      document.removeEventListener('pointerup', cancelDragState);
      document.removeEventListener('pointercancel', cancelDragState);
    };

    host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (target.closest('.sn2-text[contenteditable]')) {
        const row = target.closest('.sn2-row');
        textDragRowId = row?.dataset.rowId || null;
        textDragStartX = e.clientX;
        textDragStartY = e.clientY;
        textDragPointerId = e.pointerId;
        return;
      }
      if (target.closest('.sn2-role-btn')
          || target.closest('.sn2-header')
          || target.closest('.sn2-handle')
          || target.tagName === 'INPUT'
          || target.tagName === 'BUTTON') return;
      if (!target.closest('.sn2-row')
          && !target.closest('.sn2-scroll')
          && !target.closest('.sn2-editor')
          && !target.closest('.sn2-column-group')) return;
      dragPending = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragPointerId = e.pointerId;
      dragCtrl = e.ctrlKey || e.metaKey;
      dragShift = e.shiftKey;
    });

    host.addEventListener('pointermove', (e) => {
      if (textDragRowId && !dragSelecting && !dragPending) {
        const overEl = document.elementFromPoint(e.clientX, e.clientY);
        const overRow = overEl?.closest?.('.sn2-row');
        if (overRow && host.contains(overRow) && overRow.dataset.rowId && overRow.dataset.rowId !== textDragRowId) {
          const startRowId = textDragRowId;
          textDragRowId = null;
          dragSelecting = true;
          dragStartX = textDragStartX;
          dragStartY = textDragStartY;
          dragPointerId = textDragPointerId;
          dragCtrl = e.ctrlKey || e.metaKey;
          dragShift = e.shiftKey;
          if (!this._rowSelection) this._rowSelection = new Set();
          if (!dragCtrl && !dragShift) this._rowSelection.clear();
          try { window.getSelection()?.removeAllRanges(); } catch {}
          try { host.setPointerCapture(dragPointerId); } catch {}
          this._rowSelection.add(startRowId);
          this._rowSelection.add(overRow.dataset.rowId);
          this._updateRowSelectionUI();
        }
      }
      if (dragPending && !dragSelecting) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        dragPending = false;
        dragSelecting = true;
        if (!dragCtrl && !dragShift) {
          if (!this._rowSelection) this._rowSelection = new Set();
          this._rowSelection.clear();
        }
        host.setPointerCapture(dragPointerId);
        const startEl = document.elementFromPoint(dragStartX, dragStartY);
        const startRow = startEl?.closest('.sn2-row');
        if (startRow && host.contains(startRow) && startRow.dataset.rowId) {
          this._rowSelection.add(startRow.dataset.rowId);
        }
      }
      if (!dragSelecting) return;
      updateDragRect(e.clientX, e.clientY);
      const z = typeof _getZoom === 'function' ? _getZoom() : 1;
      const rx1 = Math.min(dragStartX, e.clientX) / z;
      const ry1 = Math.min(dragStartY, e.clientY) / z;
      const rx2 = Math.max(dragStartX, e.clientX) / z;
      const ry2 = Math.max(dragStartY, e.clientY) / z;
      let changed = false;
      host.querySelectorAll('.sn2-row').forEach((row) => {
        const rr = row.getBoundingClientRect();
        if (rr.right / z >= rx1 && rr.left / z <= rx2 && rr.bottom / z >= ry1 && rr.top / z <= ry2) {
          const rowId = row.dataset.rowId;
          if (rowId && !this._rowSelection.has(rowId)) {
            this._rowSelection.add(rowId);
            changed = true;
          }
        }
      });
      if (changed) this._updateRowSelectionUI();
    });

    host.addEventListener('pointerup', (e) => {
      textDragRowId = null;
      if (dragPending && !dragSelecting) {
        dragPending = false;
        if (this._rowSelection?.size) {
          this._rowSelection.clear();
          this._updateRowSelectionUI();
        }
        return;
      }
      dragPending = false;
      removeDragRect();
      if (!dragSelecting) return;
      dragSelecting = false;
      host.releasePointerCapture(e.pointerId);
      this._updateRowSelectionUI();
    });

    host.addEventListener('lostpointercapture', () => {
      textDragRowId = null;
      if (dragSelecting) {
        dragSelecting = false;
        removeDragRect();
        this._updateRowSelectionUI();
      }
      dragPending = false;
    });
  },

  _bindRowSelectionCopy() {
    this._copyHandler = (e) => {
      if (!this._rowSelection || this._rowSelection.size === 0) return;
      if (!this.host || !this.host.isConnected) return;
      if (typeof this._sanitizeRowSelection === 'function') this._sanitizeRowSelection();
      if (!this._rowSelection || this._rowSelection.size === 0) return;
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        const anchor = sel.anchorNode;
        const anchorEl = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
        const anchorHost = anchor?.nodeType === 1 ? anchor : anchor?.parentNode;
        const isInsideText = anchorEl?.closest?.('.sn2-text');
        if (isInsideText && this.host.contains(anchorHost)) return;
      }
      const selectedIds = typeof this._getVisibleSelectedIds === 'function'
        ? this._getVisibleSelectedIds()
        : new Set(this._rowSelection || []);
      const selected = this.doc.rows.filter((row) => selectedIds.has(row.id));
      if (!selected.length) return;
      const lines = selected.map((row) => _sn2StripRubyToPlain(row.text || ''));
      e.clipboardData?.setData('text/plain', lines.join('\n'));
      e.preventDefault();
    };
    document.addEventListener('copy', this._copyHandler);
  },

  _bindRightDragPan(host) {
    let panActive = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOrigSL = 0;
    let panOrigST = 0;
    let panSc = null;
    let panPid = 0;
    let panMoved = false;

    host.addEventListener('pointerdown', (e) => {
      if (e.button !== 2) return;
      const target = e.target;
      if (target.closest('.sn2-text[contenteditable]')
          || target.tagName === 'INPUT'
          || target.tagName === 'BUTTON'
          || target.tagName === 'SELECT'
          || target.tagName === 'TEXTAREA') return;
      const sc = target.closest?.('.sn2-scroll');
      if (!sc) return;
      panActive = true;
      panMoved = false;
      panSc = sc;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOrigSL = sc.scrollLeft;
      panOrigST = sc.scrollTop;
      panPid = e.pointerId;
      try { host.setPointerCapture(panPid); } catch {}
      sc.classList.add('sn2-panning');
      e.preventDefault();
    });

    host.addEventListener('pointermove', (e) => {
      if (!panActive || !panSc) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      if (!panMoved && Math.abs(dx) + Math.abs(dy) > 3) panMoved = true;
      panSc.scrollLeft = panOrigSL - dx;
      panSc.scrollTop = panOrigST - dy;
    });

    const endPan = () => {
      if (!panActive) return;
      panActive = false;
      if (panSc) panSc.classList.remove('sn2-panning');
      try { host.releasePointerCapture(panPid); } catch {}
      panSc = null;
    };

    host.addEventListener('pointerup', (e) => {
      if (e.button === 2) endPan();
    });
    host.addEventListener('lostpointercapture', endPan);
    host.addEventListener('contextmenu', (e) => {
      const target = e.target;
      if (target.closest('.sn2-text[contenteditable]') || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (target.closest?.('.sn2-scroll')) e.preventDefault();
    });
  },

});
