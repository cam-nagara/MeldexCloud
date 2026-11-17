/* gb-scriptnote-navigation.js: シナリオのExcel風セルナビゲーション
   クリックはセルを「アクティブ化」するだけ（強調表示のみ、編集はしない）。
   Enter またはダブルクリックで編集モードに入り、Escapeで編集モード→アクティブ→非アクティブの順に抜ける。
   矢印キー/Tabでセル間を移動する（縦書き時は論理方向を物理キーに読み替える）。
   既存のテキストセル範囲選択 (_textCellSelection) ・行選択 (_rowSelection) ・
   タイプセル選択 (_roleCellSelection) とは相互排他: アクティブセルへ移動すると
   これらの選択は解除される。 */

Object.assign(ScriptNoteEditor.prototype, {

  _initCellNavigation() {
    this._activeCellRowId = null;
    this._activeCellColId = null;
    this._cellEditMode = false;
  },

  // 表示順の列ID配列を返す（非表示列は除外）。_render() のヘッダー構築ロジック
  // (visibleStandardColumns / columnOrder) と同じ並び替えを行い、実際の見た目の
  // 左右（縦書きは上下）の並びとナビゲーション順序を一致させる。
  _getNavigableColumnOrder() {
    if (typeof this._getVisibleColumnIds === 'function') return this._getVisibleColumnIds();
    const customCols = this._getCustomColumns();
    const statusEnabled = !!this.doc.editor?.statusEnabled;
    const visCols = {
      _handle: true, _gutter: true, _gutter2: true, _character: true, _role: true,
      _status: statusEnabled, _text: true,
      ...(this.doc.editor?.visibleStandardColumns || {}),
    };
    if (!statusEnabled) visCols._status = false;
    const allStdIds = ['_handle', '_gutter', '_gutter2', '_character', '_role', '_status', '_text'];
    const unsortedIds = [
      ...allStdIds.filter(id => visCols[id] !== false),
      ...customCols.filter(cc => cc.visible !== false).map(cc => cc.id),
    ];
    const colOrder = this.doc.editor?.columnOrder;
    if (!colOrder) return unsortedIds;
    // columnOrderで並べ替え（_handleは常に先頭。_render()のヘッダー構築と同じ規則）
    const hasHandle = unsortedIds.includes('_handle');
    const rest = unsortedIds.filter(id => id !== '_handle');
    rest.sort((a, b) => {
      const ai = colOrder.indexOf(a), bi = colOrder.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return 0;
    });
    return hasHandle ? ['_handle', ...rest] : rest;
  },

  // rowId・colId からセルのDOM要素を取得する。標準列・カスタム列とも _buildRowEl() の
  // appendCell() が dataset.colId を一貫して設定しているため data-col-id 属性で引く
  // （.sn2-gutter は .sn2-gutter2 にも付いているクラスなのでクラス名だけでは曖昧になる）。
  // カスタム列のテキスト型は、実際に編集可能な内側の .sn2-custom-text を返す
  // （ラッパーの .sn2-custom-cell ではない）。number/select型はラッパーをそのまま返す。
  _getCellElement(rowId, colId) {
    if (!rowId || !colId) return null;
    const rowEl = this.host?.querySelector(`.sn2-row[data-row-id="${rowId}"]`);
    if (!rowEl) return null;
    const cell = rowEl.querySelector(`[data-col-id="${colId}"]`);
    if (!cell) return null;
    if (cell.classList.contains('sn2-custom-cell')) {
      return cell.querySelector('.sn2-custom-text') || cell;
    }
    return cell;
  },

  // el（イベントターゲット）が「現在アクティブだが非編集」セルそのもの（またはその内部）かどうかを判定する。
  // ホストのkeydownルーティングと、既存テキストセルkeydownハンドラの抑制判定の両方から使う共通ヘルパー。
  _isActiveNonEditingTarget(el) {
    if (!el || this._cellEditMode || !this._activeCellRowId) return false;
    const activeCellEl = this._getCellElement(this._activeCellRowId, this._activeCellColId);
    if (!activeCellEl) return false;
    return el === activeCellEl || (typeof activeCellEl.contains === 'function' && activeCellEl.contains(el));
  },

  // rowId・colId のセルをアクティブにする。enterEdit=true ならそのまま編集モードへ入る
  // （テキスト系）か、タイプメニューを開く（_role）。それ以外は強調表示のみでフォーカスする。
  _setActiveCell(rowId, colId, enterEdit) {
    if (!rowId || !colId) return;
    if (this._readOnly && enterEdit) return;
    // 既存のアクティブセル強調をすべて解除（テキスト系セルはcontentEditableも復元する）
    this.host?.querySelectorAll('.sn2-cell-active').forEach(el => {
      el.classList.remove('sn2-cell-active');
      if (el.classList.contains('sn2-text') || el.classList.contains('sn2-custom-text')) {
        el.contentEditable = this._readOnly ? 'false' : 'true';
      }
    });
    // 他の選択系（矩形セル・テキストセル・行・タイプセル選択）とは相互排他
    if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
    if (this._textCellSelection?.size) this._clearTextCellSelection?.();
    if (this._rowSelection?.size) this._clearRowSelection?.();
    if (this._roleCellSelection?.size) this._clearRoleCellSelection?.();

    // 別セルへ切り替える場合は、編集中だったセルの内容をモデルへ同期してから抜ける
    if (this._cellEditMode && (this._activeCellRowId !== rowId || this._activeCellColId !== colId)) {
      this._exitEditMode();
    }

    // 旧セルに残るブラウザ選択範囲をクリアしてカスタムキャレットの残留を防ぐ
    const sel = window.getSelection();
    if (sel?.rangeCount) sel.removeAllRanges();

    this._activeCellRowId = rowId;
    this._activeCellColId = colId;

    const cellEl = this._getCellElement(rowId, colId);
    if (!cellEl) return;
    const isTextLike = cellEl.classList.contains('sn2-text') || cellEl.classList.contains('sn2-custom-text');

    if (enterEdit && isTextLike) {
      this._enterEditMode(cellEl);
      return;
    }
    if (enterEdit && (colId === '_character' || colId === '_role')) {
      // キャラ／タイプセルの「編集」＝対応する選択メニューを開く。
      this._cellEditMode = false;
      if (typeof this._showRoleMenu === 'function') this._showRoleMenu(cellEl, {
        fromNav: true,
        kind: colId === '_character' ? 'character' : 'type',
      });
      return;
    }
    // それ以外: アクティブ化のみ（編集はしない）
    this._cellEditMode = false;
    cellEl.classList.add('sn2-cell-active');
    if (isTextLike) cellEl.contentEditable = 'false';
    cellEl.tabIndex = 0;
    cellEl.focus();
  },

  // 編集モードへ入る。キャレットは既定で末尾（Excel の F2/Enter 編集開始と同じ）に置く。
  _enterEditMode(cellEl, caret = 'end') {
    if (this._readOnly) return;
    if (!cellEl) cellEl = this._getCellElement(this._activeCellRowId, this._activeCellColId);
    if (!cellEl) return;
    this._cellEditMode = true;
    cellEl.classList.remove('sn2-cell-active');
    if (cellEl.classList.contains('sn2-text') || cellEl.classList.contains('sn2-custom-text')) {
      cellEl.contentEditable = 'true';
      cellEl.focus();
      if (caret !== 'start' && cellEl.classList.contains('sn2-text') && typeof this._focusText === 'function') {
        // 本文セルは末尾の番兵<br>や前後の飾り文字を考慮する既存の末尾配置を使う
        this._focusText(cellEl, 'end');
        return;
      }
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(cellEl);
        range.collapse(caret === 'start');
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  },

  // テキスト編集中のセル（標準本文・カスタムテキスト列）の内容を確定し、
  // そのセルを「アクティブ（非編集）」状態へ戻す。Enterでの確定に使う。
  _commitCellEditToActive(cellEl) {
    if (!cellEl) return false;
    const rowId = cellEl.closest('.sn2-row')?.dataset.rowId || '';
    const colId = cellEl.classList.contains('sn2-text')
      ? '_text'
      : (cellEl.closest('.sn2-custom-cell')?.dataset.colId || '');
    if (!rowId || !colId) return false;
    if (this._cellEditMode && this._activeCellRowId === rowId && this._activeCellColId === colId) {
      this._exitEditMode();
      return true;
    }
    // 直接フォーカスでの編集（_cellEditMode 外）も同じくモデルへ同期してからアクティブ化する
    if (cellEl.classList.contains('sn2-text')) {
      try { this._syncRowFromDom(cellEl, { skipUndo: true }); } catch {}
      if (typeof this._endTextInputUndo === 'function') this._endTextInputUndo();
    } else {
      const row = this.doc.rows.find(r => r.id === rowId);
      if (row) {
        if (!row.columns) row.columns = {};
        if ((row.columns[colId] ?? '') !== (cellEl.textContent || '')) {
          row.columns[colId] = cellEl.textContent || '';
          this._markDirty({ skipUndo: true });
        }
      }
    }
    this._cellEditMode = false;
    this._setActiveCell(rowId, colId, false);
    if (this._caretSelChangeHandler) this._caretSelChangeHandler();
    return true;
  },

  // 再描画などで失われたアクティブセルの強調・フォーカスを、他の選択（矩形セル範囲）を
  // 保ったまま戻す。
  _restoreActiveCellHighlight() {
    if (this._cellEditMode || !this._activeCellRowId) return false;
    const cellEl = this._getCellElement(this._activeCellRowId, this._activeCellColId);
    if (!cellEl) return false;
    cellEl.classList.add('sn2-cell-active');
    if (cellEl.classList.contains('sn2-text') || cellEl.classList.contains('sn2-custom-text')) cellEl.contentEditable = 'false';
    cellEl.tabIndex = 0;
    try { cellEl.focus({ preventScroll: true }); } catch { cellEl.focus(); }
    return true;
  },

  // アクティブ（非編集）セルの値を空にする。Undo可能で、保存対象としてdirtyにする。
  _clearActiveCellValue() {
    if (this._readOnly) return false;
    const rowId = this._activeCellRowId;
    const colId = this._activeCellColId;
    if (!rowId || !colId || colId === '_handle' || colId === '_gutter' || colId === '_gutter2') return false;
    const row = this.doc.rows.find(r => r.id === rowId);
    if (!row || typeof this._setGridPastedValue !== 'function') return false;
    const current = typeof this._gridCellValue === 'function' ? this._gridCellValue(rowId, colId) : '';
    if (current === '' || current == null) return true;
    this._pushUndo('セル内容を削除');
    this._setGridPastedValue(row, colId, '');
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    this._setActiveCell(rowId, colId, false);
    return true;
  },

  // アクティブセル（または矩形セル範囲）の値をクリップボードへ書き出す。
  // 実際の書き込みは copy イベント（_copyHandler → _handleGridCellSelectionCopy）で
  // 行い、イベントを発火できない環境では Clipboard API へフォールバックする。
  _copyActiveCellToClipboard() {
    const payload = typeof this._cellClipboardPayload === 'function' ? this._cellClipboardPayload() : null;
    if (!payload) return false;
    let handled = false;
    const onCopy = (ev) => {
      ev.clipboardData?.setData('text/plain', payload.tsv);
      ev.clipboardData?.setData('text/html', payload.html);
      ev.preventDefault();
      handled = true;
    };
    document.addEventListener('copy', onCopy, true);
    try { document.execCommand('copy'); } catch {}
    finally { document.removeEventListener('copy', onCopy, true); }
    const reportFailure = (error) => {
      // 失敗時は「最後にコピーした内容」を更新しない（貼り付け側が古い内容を正と誤認しないため）。
      if (typeof showStatus === 'function') {
        showStatus(`セルをコピーできませんでした${error?.message ? `: ${error.message}` : ''}`, true);
      }
    };
    if (handled) {
      this._lastCellClipboardText = payload.tsv;
    } else if (navigator.clipboard?.writeText) {
      const text = payload.tsv;
      Promise.resolve()
        .then(() => navigator.clipboard.writeText(text))
        .then(() => { this._lastCellClipboardText = text; }, reportFailure);
    } else {
      reportFailure(null);
    }
    return true;
  },

  // アクティブセルを起点に Shift+矢印で矩形セル範囲を広げる（範囲の動く端を1セル進める）。
  _extendGridSelectionFromActive(logicalDir) {
    if (typeof this._setGridCellRange !== 'function') return false;
    const rowIds = this._gridVisibleRowIds();
    const colIds = this._gridSelectableColumnIds();
    const activeRef = { rowId: this._activeCellRowId, colId: this._activeCellColId };
    if (!rowIds.includes(activeRef.rowId) || !colIds.includes(activeRef.colId)) return false;
    const hasSel = !!(this._gridCellSelection?.size && this._gridCellAnchor);
    const anchor = hasSel ? this._gridCellAnchor : activeRef;
    const kbFocus = this._gridKeyboardFocus;
    const focus = (hasSel && kbFocus && this._gridCellSelection.has(_sn2GridCellKey(kbFocus.rowId, kbFocus.colId)))
      ? kbFocus : activeRef;
    let r = rowIds.indexOf(focus.rowId);
    let c = colIds.indexOf(focus.colId);
    if (r < 0 || c < 0) return false;
    if (logicalDir === 'prev-row') r -= 1;
    else if (logicalDir === 'next-row') r += 1;
    else if (logicalDir === 'prev-col') c -= 1;
    else if (logicalDir === 'next-col') c += 1;
    r = Math.max(0, Math.min(rowIds.length - 1, r));
    c = Math.max(0, Math.min(colIds.length - 1, c));
    if (!this._setGridCellRange(anchor.rowId, anchor.colId, rowIds[r], colIds[c])) return false;
    this._gridKeyboardFocus = { rowId: rowIds[r], colId: colIds[c] };
    const focusEl = this.host?.querySelector(`.sn2-row[data-row-id="${rowIds[r]}"] [data-col-id="${colIds[c]}"]`);
    focusEl?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    return true;
  },

  // 編集モードを抜ける。標準テキスト列は _syncRowFromDom()、カスタムテキスト列は
  // 既存のfocusoutハンドラと同じ代入経路でモデルへ反映してから、
  // 「アクティブだが非編集」の見た目・状態に戻す。
  _exitEditMode() {
    const cellEl = this._getCellElement(this._activeCellRowId, this._activeCellColId);
    if (!cellEl) { this._cellEditMode = false; return; }
    this._cellEditMode = false;
    const isStdText = cellEl.classList.contains('sn2-text');
    const isCustomText = cellEl.classList.contains('sn2-custom-text');
    if (isStdText) {
      try { this._syncRowFromDom(cellEl, { skipUndo: true }); } catch {}
      if (typeof this._endTextInputUndo === 'function') this._endTextInputUndo();
    } else if (isCustomText) {
      const rowEl = cellEl.closest('.sn2-row');
      const row = rowEl ? this.doc.rows.find(r => r.id === rowEl.dataset.rowId) : null;
      const colId = cellEl.closest('.sn2-custom-cell')?.dataset.colId;
      if (row && colId) {
        if (!row.columns) row.columns = {};
        row.columns[colId] = cellEl.textContent || '';
        this._markDirty({ skipUndo: true });
      }
    }
    if (isStdText || isCustomText) cellEl.contentEditable = 'false';
    // 編集モードのブラウザ選択範囲をクリアしてカスタムキャレットの残留を防ぐ
    const sel = window.getSelection();
    if (sel?.rangeCount) sel.removeAllRanges();
    cellEl.classList.add('sn2-cell-active');
    cellEl.tabIndex = 0;
    cellEl.focus();
    if (this._caretSelChangeHandler) this._caretSelChangeHandler();
  },

  // アクティブセルを完全に解除する（編集中なら先に抜けてから解除）
  _clearActiveCell() {
    if (this._cellEditMode) this._exitEditMode();
    this.host?.querySelectorAll('.sn2-cell-active').forEach(el => {
      el.classList.remove('sn2-cell-active');
      // 非アクティブに戻すテキスト系セルは、直接クリックでの即編集に戻す
      if (el.classList.contains('sn2-text') || el.classList.contains('sn2-custom-text')) {
        el.contentEditable = this._readOnly ? 'false' : 'true';
      }
    });
    this._activeCellRowId = null;
    this._activeCellColId = null;
    this._cellEditMode = false;
  },

  _navigateCell(direction) {
    if (!this._activeCellRowId || !this._activeCellColId) return;
    const cols = this._getNavigableColumnOrder();
    const colIdx = cols.indexOf(this._activeCellColId);
    if (colIdx < 0) return;

    if (direction === 'prev-col' || direction === 'next-col') {
      const step = direction === 'prev-col' ? -1 : 1;
      const newColIdx = this._findFirstVisibleCol(this._activeCellRowId, cols, colIdx + step, step);

      if (newColIdx < 0) {
        // 折り返しモード時は段を跨いで同位置の行へ移動
        const crossRowId = this._findCrossDanRow(this._activeCellRowId, step > 0);
        if (crossRowId) {
          const startIdx = step > 0 ? 0 : cols.length - 1;
          const targetColIdx = this._findFirstVisibleCol(crossRowId, cols, startIdx, step);
          if (targetColIdx >= 0) this._setActiveCell(crossRowId, cols[targetColIdx], false);
          return;
        }
        // 段がない場合はデータ行順で折り返す
        const fallbackRowId = this._findNextVisibleRowId(this._activeCellRowId, step);
        if (fallbackRowId) {
          const startIdx = step > 0 ? 0 : cols.length - 1;
          const targetColIdx = this._findFirstVisibleCol(fallbackRowId, cols, startIdx, step);
          if (targetColIdx >= 0) this._setActiveCell(fallbackRowId, cols[targetColIdx], false);
        }
        return;
      }
      this._setActiveCell(this._activeCellRowId, cols[newColIdx], false);
    } else {
      // prev-row / next-row
      const dir = direction === 'prev-row' ? -1 : 1;
      const nextRowId = this._findNextVisibleRowId(this._activeCellRowId, dir);
      if (!nextRowId) return;
      let targetCol = this._activeCellColId;
      if (this._isCellHiddenByShift(nextRowId, targetCol)) {
        const idx = cols.indexOf(targetCol);
        for (let d = 1; d < cols.length; d++) {
          if (idx + d < cols.length && !this._isCellHiddenByShift(nextRowId, cols[idx + d])) { targetCol = cols[idx + d]; break; }
          if (idx - d >= 0 && !this._isCellHiddenByShift(nextRowId, cols[idx - d])) { targetCol = cols[idx - d]; break; }
        }
      }
      this._setActiveCell(nextRowId, targetCol, false);
    }
  },

  _findNextVisibleRowId(currentRowId, dir) {
    const rows = this.doc.rows;
    let idx = rows.findIndex(r => r.id === currentRowId);
    if (idx < 0) return null;
    for (;;) {
      idx += dir;
      if (idx < 0 || idx >= rows.length) return null;
      const row = rows[idx];
      if (typeof this._isRoleVisible === 'function' && !this._isRoleVisible(row)) continue;
      return row.id;
    }
  },

  _isCellHiddenByShift(rowId, colId) {
    const rowEl = this.host?.querySelector(`.sn2-row[data-row-id="${rowId}"]`);
    if (!rowEl) return false;
    const cell = rowEl.querySelector(`[data-col-id="${colId}"]`);
    return cell ? cell.style.visibility === 'hidden' : false;
  },

  _findCrossDanRow(rowId, isForward) {
    const rowEl = this.host?.querySelector(`.sn2-row[data-row-id="${rowId}"]`);
    if (!rowEl) return null;
    const colGroup = rowEl.closest('.sn2-column-group');
    if (!colGroup) return null;
    const groupRows = [...colGroup.querySelectorAll(':scope > .sn2-row')];
    const rowIndex = groupRows.indexOf(rowEl);
    if (rowIndex < 0) return null;
    const adjGroup = isForward ? colGroup.nextElementSibling : colGroup.previousElementSibling;
    if (!adjGroup || !adjGroup.classList.contains('sn2-column-group')) return null;
    const adjRows = [...adjGroup.querySelectorAll(':scope > .sn2-row')];
    if (!adjRows.length) return null;
    return adjRows[Math.min(rowIndex, adjRows.length - 1)]?.dataset?.rowId || null;
  },

  _findFirstVisibleCol(rowId, cols, startIdx, step) {
    for (let i = startIdx; i >= 0 && i < cols.length; i += step) {
      if (!this._isCellHiddenByShift(rowId, cols[i])) return i;
    }
    return -1;
  },

  // 非編集時（アクティブセルのみ存在する状態）のキー操作を処理する。
  // 呼び出し側（ホストのkeydownルーティング）が _isActiveNonEditingTarget() で
  // 対象を確認してから呼ぶ想定だが、単体で呼ばれても安全なように自前でも確認する。
  _handleNavigationKeydown(e) {
    if (this._cellEditMode || !this._activeCellRowId) return false;
    const isVert = this.doc.editor?.viewMode === 'vertical';

    if (e.key === 'Escape') {
      e.preventDefault();
      if (this._roleCellSelection?.size) this._clearRoleCellSelection?.();
      if (this._gridCellSelection?.size) this._clearGridCellSelection?.();
      this._clearActiveCell();
      return true;
    }

    // タイプ列のボタンで従来のタイプセル選択がある間は、コピー・切り取り・貼り付け・削除を
    // 既存のタイプセル用処理（_handleRoleCellKeydown）へ任せる。
    const roleSelectionOwnsKey = !!(e.target?.closest?.('.sn2-role-btn') && this._roleCellSelection?.size
      && !this._gridCellSelection?.size);
    const mod = e.ctrlKey || e.metaKey;
    const lk = String(e.key || '').toLowerCase();

    // Ctrl+C / Ctrl+X: アクティブセル（矩形セル範囲があればその範囲）をコピー／切り取り。
    // Ctrl+V はここでは既定動作を止めず、ホストの paste ハンドラ（_handleGridCellPaste）で処理する。
    if (mod && !e.shiftKey && !e.altKey && (lk === 'c' || lk === 'x') && !roleSelectionOwnsKey) {
      e.preventDefault(); e.stopPropagation();
      const copied = this._copyActiveCellToClipboard();
      if (copied && lk === 'x' && !this._readOnly) {
        if (this._gridCellSelection?.size) {
          this._clearSelectedGridCells?.();
          this._restoreActiveCellHighlight();
        } else {
          this._clearActiveCellValue();
        }
      }
      return true;
    }

    // Shift+Delete: アクティブセル（矩形セル範囲があればその範囲）を含むすべての行を削除し、
    // 削除した位置の次の行・同じ列をアクティブにする。
    if (e.key === 'Delete' && e.shiftKey && !mod && !e.altKey) {
      e.preventDefault(); e.stopPropagation();
      if (!this._readOnly) this._deleteRowsKeepingActiveCell(this._rowIdsForCellSelection(), this._activeCellColId);
      return true;
    }

    // Delete / Backspace: アクティブセル（矩形セル範囲があればその範囲）の内容を空にする
    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.altKey && !e.shiftKey && !roleSelectionOwnsKey) {
      e.preventDefault(); e.stopPropagation();
      if (this._gridCellSelection?.size) {
        this._clearSelectedGridCells?.();
        this._restoreActiveCellHighlight();
      } else {
        this._clearActiveCellValue();
      }
      return true;
    }

    // Shift+矢印: アクティブセルを起点に矩形セル範囲を広げる（縦書きは論理方向へ読み替え）
    if (e.shiftKey && !mod && !e.altKey && e.key.startsWith('Arrow')) {
      let logicalDir = null;
      if (e.key === 'ArrowLeft') logicalDir = isVert ? 'next-row' : 'prev-col';
      else if (e.key === 'ArrowRight') logicalDir = isVert ? 'prev-row' : 'next-col';
      else if (e.key === 'ArrowUp') logicalDir = isVert ? 'prev-col' : 'prev-row';
      else if (e.key === 'ArrowDown') logicalDir = isVert ? 'next-col' : 'next-row';
      if (logicalDir) {
        e.preventDefault(); e.stopPropagation();
        if (this._roleCellSelection?.size) this._clearRoleCellSelection?.();
        this._extendGridSelectionFromActive(logicalDir);
        return true;
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const rowEl = this.host?.querySelector(`.sn2-row[data-row-id="${this._activeCellRowId}"]`);
      const target = this._roleMenuAnchor?.(rowEl, e.shiftKey ? 'type' : 'character');
      if (target && typeof this._showRoleMenu === 'function') {
        this._showRoleMenu(target, { fromNav: true, kind: e.shiftKey ? 'type' : 'character' });
        return true;
      }
      return true;
    }

    if ((e.key === 'Enter' || e.key === ' ') && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      const colId = this._activeCellColId;
      const cellEl = this._getCellElement(this._activeCellRowId, colId);
      if (cellEl?.classList.contains('sn2-text') || cellEl?.classList.contains('sn2-custom-text')) {
        this._enterEditMode(cellEl, 'end');
      } else if (colId === '_character' || colId === '_role') {
        this._setActiveCell(this._activeCellRowId, colId, true);
      } else if (cellEl?.classList.contains('sn2-custom-cell')) {
        const nativeCtrl = cellEl.querySelector('.sn2-custom-input, .sn2-custom-select');
        if (nativeCtrl) {
          this._cellEditMode = true;
          cellEl.classList.remove('sn2-cell-active');
          nativeCtrl.focus();
        }
      }
      return true;
    }

    if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      this._insertEmptyRowBelow();
      return true;
    }

    // 矢印キーは修飾キーなし（プレーン）のときだけセル移動として扱う。
    // Ctrl+上下（行入れ替え）・Alt+矢印（タイプセル移動／5行スキップ）など、
    // 編集中に使う既存ショートカットを非編集時に奪わないための保護。
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      let logicalDir = null;
      if (e.key === 'ArrowLeft') logicalDir = isVert ? 'next-row' : 'prev-col';
      else if (e.key === 'ArrowRight') logicalDir = isVert ? 'prev-row' : 'next-col';
      else if (e.key === 'ArrowUp') logicalDir = isVert ? 'prev-col' : 'prev-row';
      else if (e.key === 'ArrowDown') logicalDir = isVert ? 'next-col' : 'next-row';
      if (logicalDir) {
        e.preventDefault();
        this._navigateCell(logicalDir);
        return true;
      }
    }

    return false;
  },

  // 行の削除・貼り付けなどで表を描き直した後、元の位置に近いセルをアクティブにする。
  // rowIndex は描き直し後の doc.rows 上の位置（削除した最初の行の位置＝次の行）。
  // その行がフィルタで隠れていれば下→上の順に近い表示行を探す。列は元の列を保つ。
  _activateCellNear(rowIndex, colId) {
    const rows = this.doc?.rows || [];
    if (!rows.length || !this.host) return false;
    const visible = row => typeof this._isRoleVisible !== 'function' || this._isRoleVisible(row);
    const start = Math.max(0, Math.min(rows.length - 1, Number(rowIndex) || 0));
    let target = null;
    for (let i = start; i < rows.length && !target; i += 1) if (visible(rows[i])) target = rows[i];
    for (let i = start - 1; i >= 0 && !target; i -= 1) if (visible(rows[i])) target = rows[i];
    if (!target) return false;
    const cols = this._getNavigableColumnOrder().filter(id => id !== '_handle');
    let col = cols.includes(colId) ? colId : (cols.includes('_text') ? '_text' : cols[0]);
    if (col && this._isCellHiddenByShift(target.id, col)) {
      const idx = cols.indexOf(col);
      col = cols.find((id, i) => i !== idx && !this._isCellHiddenByShift(target.id, id)) || col;
    }
    if (!col || !this._getCellElement(target.id, col)) return false;
    this._setActiveCell(target.id, col, false);
    return true;
  },

  // メニュー・確認ダイアログを閉じた直後は、閉じる処理が元の部品へフォーカスを戻そうとして
  // アクティブセルのフォーカスを奪うことがある。描き直し後と次のフレームで、
  // フォーカスが表の外（何もない所）へ落ちていればアクティブセルへ戻す。
  _activateCellNearAfterClose(rowIndex, colId) {
    this._activateCellNear(rowIndex, colId);
    const settle = () => {
      if (!this.host?.isConnected || this._cellEditMode) return;
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected;
      if (lost || !this._activeCellRowId) this._activateCellNear(rowIndex, colId);
    };
    requestAnimationFrame(settle);
    setTimeout(settle, 0);
  },

  // 矩形セル範囲（なければアクティブセル）を含むすべての行のID（表示順）。
  _rowIdsForCellSelection() {
    const ids = new Set();
    if (this._gridCellSelection?.size) {
      this._sanitizeGridCellSelection?.();
      this._gridCellSelection.forEach(key => {
        const [rowId] = _sn2GridCellParts(key);
        if (rowId) ids.add(rowId);
      });
    }
    if (!ids.size && this._activeCellRowId) ids.add(this._activeCellRowId);
    return this.doc.rows.filter(row => ids.has(row.id)).map(row => row.id);
  },

  // 指定行をまとめて削除し、削除した位置の次の行（同じ列）をアクティブにする。
  // すべての行が対象の時は、最初の1行を残す（シナリオは最低1行を持つ）。
  _deleteRowsKeepingActiveCell(rowIds, colId = '_text') {
    if (this._readOnly) return false;
    if (this._scenarioViewEditUnit?.() === 'page' && typeof this._deleteScenarioPagesForRows === 'function') {
      return this._deleteScenarioPagesForRows(rowIds, colId);
    }
    const ids = new Set((rowIds || []).filter(Boolean));
    const rows = this.doc.rows;
    const firstIdx = rows.findIndex(row => ids.has(row.id));
    if (firstIdx < 0) return false;
    if (rows.every(row => ids.has(row.id))) {
      ids.delete(rows[firstIdx].id);
      if (typeof showStatus === 'function') showStatus('最後の1行は削除できません', true);
      if (!ids.size) return true;
    }
    if (this._cellEditMode) this._exitEditMode();
    this._pushUndo(ids.size > 1 ? `${ids.size}行を削除` : '行削除');
    const removeIndex = rows.findIndex(row => ids.has(row.id));
    this.doc.rows = rows.filter(row => !ids.has(row.id));
    ids.forEach(id => this._rowSelection?.delete?.(id));
    if (this._gridCellSelection?.size) this._gridCellSelection.clear();
    this._gridCellAnchor = null;
    this._gridKeyboardFocus = null;
    if (this._textCellSelection?.size) this._textCellSelection.clear();
    this._activeCellRowId = null;
    this._activeCellColId = null;
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    this._updateRowSelectionUI?.();
    this._activateCellNear(removeIndex, colId);
    return true;
  },

  _insertEmptyRowBelow() {
    if (!this._activeCellRowId) return;
    this._insertEmptyRowRelative(this._activeCellRowId, 'below', this._activeCellColId || '_text');
  },

  _insertEmptyRowRelative(rowId, position = 'below', focusColId = '_text') {
    // ビューの「追加・削除はページ単位」の時は、ページ（区切り行＋1行）を追加する。
    if (this._scenarioViewEditUnit?.() === 'page' && typeof this._insertScenarioPageRelative === 'function') {
      return this._insertScenarioPageRelative(rowId, position, focusColId);
    }
    const idx = this.doc.rows.findIndex(r => r.id === rowId);
    if (idx < 0) return;
    this._pushUndo('行追加');
    let newRole = '';
    if (this._filterRoles && this._filterRoles.size === 1) newRole = [...this._filterRoles][0];
    let newStatus = this.doc.rows[idx].status || '';
    if (this._filterStatuses && this._filterStatuses.size === 1) newStatus = [...this._filterStatuses][0];
    const newRow = {
      id: `sn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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
    this.doc.rows.splice(position === 'above' ? idx : idx + 1, 0, newRow);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    this._setActiveCell(newRow.id, focusColId, false);
    return newRow;
  },

});
