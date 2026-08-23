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
      case 'scenario.replace':
        return this._runSearchShortcut();
      case 'scenario.deselectAll':
        return this._runDeselectAllShortcut();
      case 'scenario.selectAll': {
        // セル内で Ctrl+A: 全行選択ではなくそのセルの内容全体を選択する
        const cell = ae?.closest?.('.sn2-text[contenteditable], .sn2-custom-text[contenteditable]');
        if (cell && this.host?.contains(cell)) {
          // 過去のセル範囲選択が残っていると、この後のDeleteで無関係なセルまで消えるため先に解除する
          this._clearGridCellSelection?.();
          this._clearTextCellSelection?.();
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(cell);
            sel.removeAllRanges();
            sel.addRange(range);
            return true;
          }
        }
        if (typeof this._selectAllRows !== 'function') return false;
        this._selectAllRows();
        return true;
      }
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
    if (this._roleCellSelection?.size) this._clearRoleCellSelection();
    if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
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
    if (!this._rangeWithinElement(range, text)) return false;
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
      if (!sel.rangeCount) return;
      const r2 = sel.getRangeAt(0);
      if (!this._rangeWithinElement(r2, text)) return;
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
    const focusDeletedNeighbor = () => {
      const nextEl = this.host?.querySelector(`.sn2-row[data-row-id="${focusId}"] .sn2-text`);
      if (nextEl) {
        this._focusText(nextEl, 'start');
        document.dispatchEvent(new Event('selectionchange'));
        if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      }
    };
    focusDeletedNeighbor();
    requestAnimationFrame(focusDeletedNeighbor);
    return true;
  },

  _runEscapeShortcut() {
    // セルナビゲーションで編集中の場合、まず編集モードを抜けるだけに留める
    // （アクティブ状態は保持。もう一度Escapeでアクティブ解除まで進む）
    if (this._cellEditMode && typeof this._exitEditMode === 'function') {
      this._exitEditMode();
      return true;
    }
    if (typeof this._closeRubyPopup === 'function') this._closeRubyPopup();
    document.querySelectorAll('.sn2-header-popup, .sn2-header-sub-popup, .gb-fmt-popup--bulk-edit').forEach(el => el.remove());
    if (typeof this._closeRoleMenu === 'function') this._closeRoleMenu();
    if (this._rowSelection?.size) this._clearRowSelection();
    if (this._roleCellSelection?.size) this._clearRoleCellSelection();
    if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    return true;
  },

  _bindInteractionEvents(host) {
    if (typeof this._initCellNavigation === 'function') this._initCellNavigation();
    this._bindWheelScroll(host);
    this._bindDragSelection(host);
    this._bindRowSelectionCopy();
    if (typeof this._bindRowCheckDragToggle === 'function') this._bindRowCheckDragToggle(host);
    if (typeof this._bindRoleCellSelection === 'function') this._bindRoleCellSelection(host);
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
      let mul;
      if (!isNaN(stored) && stored > 0) {
        mul = stored;
      } else {
        const viewSize = sc.clientWidth;
        if (e.deltaMode === 2) {
          mul = viewSize * 0.8;
        } else if (e.deltaMode === 1) {
          mul = viewSize * 0.08;
        } else {
          mul = viewSize * 0.25 / 100;
        }
      }
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
    let dragBaseSet = null;
    let dragAnchorCell = null;
    let dragScrollEl = null;
    let dragLastX = 0;
    let dragLastY = 0;
    let dragAutoScrollRaf = 0;
    let dragRect = null;
    let textDragCell = null;
    let textDragStartX = 0;
    let textDragStartY = 0;
    let textDragPointerId = 0;
    const DRAG_THRESHOLD = 4;
    const EDGE_THRESHOLD = 52;
    const EDGE_MAX_SPEED = 24;

    const selectableCell = (element) => {
      const cell = element?.closest?.('[data-col-id]');
      const row = cell?.closest?.('.sn2-row[data-row-id]');
      const colId = cell?.dataset?.colId || '';
      if (!cell || !row || !host.contains(row) || !colId || colId === '_handle') return null;
      return { element: cell, rowId: row.dataset.rowId || '', colId };
    };
    const visibleScrollRect = () => {
      const rect = dragScrollEl?.getBoundingClientRect?.();
      if (!rect) return null;
      return {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        right: Math.min(window.innerWidth, rect.right),
        bottom: Math.min(window.innerHeight, rect.bottom),
      };
    };
    const cellFromPoint = (x, y, clampToScroll = false) => {
      let pointX = x;
      let pointY = y;
      if (clampToScroll && dragScrollEl) {
        const rect = visibleScrollRect() || dragScrollEl.getBoundingClientRect();
        pointX = Math.max(rect.left + 2, Math.min(rect.right - 2, pointX));
        pointY = Math.max(rect.top + 2, Math.min(rect.bottom - 2, pointY));
      }
      return selectableCell(document.elementFromPoint(pointX, pointY));
    };
    const nearestCellFromPoint = (x, y) => {
      const scrollEl = dragScrollEl || host.querySelector('.sn2-scroll');
      const rawRect = scrollEl?.getBoundingClientRect?.();
      if (!rawRect) return null;
      const viewRect = {
        left: Math.max(0, rawRect.left),
        top: Math.max(0, rawRect.top),
        right: Math.min(window.innerWidth, rawRect.right),
        bottom: Math.min(window.innerHeight, rawRect.bottom),
      };
      const pointX = Math.max(viewRect.left + 2, Math.min(viewRect.right - 2, x));
      const pointY = Math.max(viewRect.top + 2, Math.min(viewRect.bottom - 2, y));
      let nearest = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      host.querySelectorAll('.sn2-row[data-row-id] > [data-col-id]').forEach(cell => {
        const candidate = selectableCell(cell);
        if (!candidate) return;
        const rect = cell.getBoundingClientRect();
        if (rect.right <= viewRect.left || rect.left >= viewRect.right
            || rect.bottom <= viewRect.top || rect.top >= viewRect.bottom) return;
        const dx = pointX < rect.left ? rect.left - pointX : pointX > rect.right ? pointX - rect.right : 0;
        const dy = pointY < rect.top ? rect.top - pointY : pointY > rect.bottom ? pointY - rect.bottom : 0;
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      });
      return nearest;
    };

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
    const updateGridRangeAtPoint = (x, y) => {
      if (!dragSelecting || !dragAnchorCell) return false;
      const over = cellFromPoint(x, y, true) || nearestCellFromPoint(x, y);
      if (!over) return false;
      return !!this._setGridCellRange?.(
        dragAnchorCell.rowId,
        dragAnchorCell.colId,
        over.rowId,
        over.colId,
        dragBaseSet,
      );
    };
    const edgeVelocity = (position, start, end) => {
      if (position < start + EDGE_THRESHOLD) {
        const ratio = Math.min(1, Math.max(0, (start + EDGE_THRESHOLD - position) / EDGE_THRESHOLD));
        return -Math.max(2, Math.round(EDGE_MAX_SPEED * ratio));
      }
      if (position > end - EDGE_THRESHOLD) {
        const ratio = Math.min(1, Math.max(0, (position - (end - EDGE_THRESHOLD)) / EDGE_THRESHOLD));
        return Math.max(2, Math.round(EDGE_MAX_SPEED * ratio));
      }
      return 0;
    };
    const stopAutoScroll = () => {
      if (dragAutoScrollRaf) cancelAnimationFrame(dragAutoScrollRaf);
      dragAutoScrollRaf = 0;
    };
    const performAutoScrollStep = () => {
      if (!dragSelecting || !dragScrollEl?.isConnected) return false;
      const rect = visibleScrollRect() || dragScrollEl.getBoundingClientRect();
      const deltaX = dragScrollEl.scrollWidth > dragScrollEl.clientWidth
        ? edgeVelocity(dragLastX, rect.left, rect.right)
        : 0;
      const deltaY = dragScrollEl.scrollHeight > dragScrollEl.clientHeight
        ? edgeVelocity(dragLastY, rect.top, rect.bottom)
        : 0;
      const beforeLeft = dragScrollEl.scrollLeft;
      const beforeTop = dragScrollEl.scrollTop;
      if (deltaX) dragScrollEl.scrollLeft += deltaX;
      if (deltaY) dragScrollEl.scrollTop += deltaY;
      if (dragScrollEl.scrollLeft !== beforeLeft || dragScrollEl.scrollTop !== beforeTop) {
        updateGridRangeAtPoint(dragLastX, dragLastY);
        return true;
      }
      return false;
    };
    const runAutoScroll = () => {
      dragAutoScrollRaf = 0;
      if (!dragSelecting || !dragScrollEl?.isConnected) return;
      performAutoScrollStep();
      dragAutoScrollRaf = requestAnimationFrame(runAutoScroll);
    };
    const startAutoScroll = () => {
      if (!dragAutoScrollRaf) dragAutoScrollRaf = requestAnimationFrame(runAutoScroll);
    };
    const beginGridDrag = (anchor, pointerEvent, startX, startY, pointerId) => {
      if (!anchor?.rowId || !anchor?.colId) return false;
      dragPending = false;
      dragSelecting = true;
      dragAnchorCell = anchor;
      dragStartX = startX;
      dragStartY = startY;
      dragPointerId = pointerId;
      dragScrollEl = anchor.element?.closest?.('.sn2-scroll') || host.querySelector('.sn2-scroll');
      this._beginGridCellDragSelection?.(anchor.rowId, anchor.colId, dragBaseSet);
      this._setGridCellRange?.(anchor.rowId, anchor.colId, anchor.rowId, anchor.colId, dragBaseSet);
      this._gridDragSelectionActive = true;
      try { window.getSelection()?.removeAllRanges(); } catch {}
      try { host.setPointerCapture(dragPointerId); } catch {}
      pointerEvent?.preventDefault?.();
      startAutoScroll();
      return true;
    };
    const finishDrag = (options = {}) => {
      const hadSelection = dragSelecting;
      stopAutoScroll();
      this._gridDragSelectionActive = false;
      textDragCell = null;
      dragPending = false;
      dragSelecting = false;
      removeDragRect();
      try { if (dragPointerId) host.releasePointerCapture(dragPointerId); } catch {}
      dragPointerId = 0;
      dragScrollEl = null;
      dragAnchorCell = null;
      dragBaseSet = null;
      if (hadSelection) {
        this._updateGridCellSelectionUI?.();
        if (options.focus !== false) this._focusGridCellSelectionHost?.();
      }
    };
    if (this._dragSelectionDocCleanup) this._dragSelectionDocCleanup();
    const onDocumentPointerUp = () => finishDrag();
    const onDocumentPointerCancel = () => finishDrag({ focus: false });
    document.addEventListener('pointerup', onDocumentPointerUp);
    document.addEventListener('pointercancel', onDocumentPointerCancel);
    this._dragSelectionDocCleanup = () => {
      finishDrag({ focus: false });
      document.removeEventListener('pointerup', onDocumentPointerUp);
      document.removeEventListener('pointercancel', onDocumentPointerCancel);
    };

    host.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const target = e.target;
      const textLike = target.closest('.sn2-text[contenteditable], .sn2-custom-text[contenteditable]');
      if (textLike) {
        textDragCell = selectableCell(textLike);
        textDragStartX = e.clientX;
        textDragStartY = e.clientY;
        textDragPointerId = e.pointerId;
        dragBaseSet = (e.ctrlKey || e.metaKey || e.shiftKey) ? new Set(this._gridCellSelection || []) : new Set();
        dragLastX = e.clientX;
        dragLastY = e.clientY;
        return;
      }
      if (target.closest('.sn2-role-btn')
          || target.closest('.sn2-status-btn')
          || target.closest('.sn2-header')
          || target.closest('.sn2-handle')
          || target.tagName === 'INPUT'
          || target.tagName === 'SELECT'
          || target.tagName === 'BUTTON') return;
      if (!target.closest('.sn2-row')
          && !target.closest('.sn2-scroll')
          && !target.closest('.sn2-editor')
          && !target.closest('.sn2-column-group')) return;
      dragPending = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragPointerId = e.pointerId;
      dragLastX = e.clientX;
      dragLastY = e.clientY;
      dragAnchorCell = selectableCell(target) || nearestCellFromPoint(e.clientX, e.clientY);
      dragBaseSet = (e.ctrlKey || e.metaKey || e.shiftKey) ? new Set(this._gridCellSelection || []) : new Set();
    });

    host.addEventListener('pointermove', (e) => {
      dragLastX = e.clientX;
      dragLastY = e.clientY;
      if (textDragCell && !dragSelecting && !dragPending) {
        const over = cellFromPoint(e.clientX, e.clientY);
        const movedToOtherCell = over && (over.rowId !== textDragCell.rowId || over.colId !== textDragCell.colId);
        if (movedToOtherCell) {
          const anchor = textDragCell;
          textDragCell = null;
          beginGridDrag(anchor, e, textDragStartX, textDragStartY, textDragPointerId);
          updateGridRangeAtPoint(e.clientX, e.clientY);
        }
      }
      if (dragPending && !dragSelecting) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        const anchor = dragAnchorCell || cellFromPoint(dragStartX, dragStartY) || nearestCellFromPoint(dragStartX, dragStartY);
        if (!beginGridDrag(anchor, e, dragStartX, dragStartY, dragPointerId)) return;
      }
      if (!dragSelecting) return;
      updateDragRect(e.clientX, e.clientY);
      updateGridRangeAtPoint(e.clientX, e.clientY);
      // rAFが間引かれる環境でも端へ入った瞬間には必ず1段階スクロールする。
      performAutoScrollStep();
    });

    host.addEventListener('pointerup', (e) => {
      const wasTextCellClick = !!textDragCell;
      textDragCell = null;
      if (dragPending && !dragSelecting) {
        dragPending = false;
        // ドラッグでない単クリック: すべての選択系を解除
        if (this._rowSelection?.size) {
          this._rowSelection.clear();
          this._updateRowSelectionUI();
        }
        if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
        if (this._textCellSelection?.size) this._clearTextCellSelection?.();
        if (this._roleCellSelection?.size) this._clearRoleCellSelection?.();
        if (this._activeCellRowId) this._clearActiveCell?.();
        return;
      }
      // テキストセル上のドラッグでない単クリック: テキストセル範囲選択を解除
      if (wasTextCellClick && !dragSelecting) {
        if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
        if (this._textCellSelection?.size) this._clearTextCellSelection?.();
      }
      if (dragSelecting) finishDrag();
    });

    host.addEventListener('lostpointercapture', () => {
      textDragCell = null;
      if (dragSelecting || dragPending) finishDrag();
    });

    host.addEventListener('wheel', (e) => {
      if (!dragSelecting || !dragScrollEl?.isConnected) return;
      dragLastX = e.clientX || dragLastX;
      dragLastY = e.clientY || dragLastY;
      if (!e.defaultPrevented) {
        e.preventDefault();
        dragScrollEl.scrollLeft += e.deltaX;
        dragScrollEl.scrollTop += e.deltaY;
      }
      requestAnimationFrame(() => updateGridRangeAtPoint(dragLastX, dragLastY));
    }, { passive: false });
  },

  _bindRowSelectionCopy() {
    this._copyHandler = (e) => {
      if (!this._rowSelection || this._rowSelection.size === 0) {
        // 行選択が無い場合は矩形セル範囲→従来テキストセル範囲の順にコピーを試す
        if (typeof this._handleGridCellSelectionCopy === 'function'
            && this._handleGridCellSelectionCopy(e)) return;
        if (typeof this._handleTextCellSelectionCopy === 'function') this._handleTextCellSelectionCopy(e);
        return;
      }
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
      if (panSc.classList.contains('sn2-vertical') && panSc.classList.contains('sn2-wrap')) {
        panSc.scrollLeft = 0;
      } else {
        panSc.scrollLeft = panOrigSL - dx;
      }
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
