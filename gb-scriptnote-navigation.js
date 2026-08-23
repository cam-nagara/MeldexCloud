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
      _handle: true, _gutter: true, _gutter2: true, _role: true,
      _status: statusEnabled, _text: true,
      ...(this.doc.editor?.visibleStandardColumns || {}),
    };
    if (!statusEnabled) visCols._status = false;
    const allStdIds = ['_handle', '_gutter', '_gutter2', '_role', '_status', '_text'];
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
    // 既存のアクティブセル強調をすべて解除（テキスト系セルはcontentEditableも復元する）
    this.host?.querySelectorAll('.sn2-cell-active').forEach(el => {
      el.classList.remove('sn2-cell-active');
      if (el.classList.contains('sn2-text') || el.classList.contains('sn2-custom-text')) {
        el.contentEditable = 'true';
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
    if (enterEdit && colId === '_role') {
      // タイプセルの「編集」＝タイプ変更メニューを開く（既存の役割選択・メニュー機構をそのまま使う）
      this._cellEditMode = false;
      if (typeof this._showRoleMenu === 'function') this._showRoleMenu(cellEl, { fromNav: true });
      return;
    }
    // それ以外: アクティブ化のみ（編集はしない）
    this._cellEditMode = false;
    cellEl.classList.add('sn2-cell-active');
    if (isTextLike) cellEl.contentEditable = 'false';
    cellEl.tabIndex = 0;
    cellEl.focus();
  },

  _enterEditMode(cellEl) {
    if (!cellEl) cellEl = this._getCellElement(this._activeCellRowId, this._activeCellColId);
    if (!cellEl) return;
    this._cellEditMode = true;
    cellEl.classList.remove('sn2-cell-active');
    if (cellEl.classList.contains('sn2-text') || cellEl.classList.contains('sn2-custom-text')) {
      cellEl.contentEditable = 'true';
      cellEl.focus();
      // カーソルを先頭に置く
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(cellEl);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
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
        el.contentEditable = 'true';
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
      if (typeof this._isRoleVisible === 'function' && !this._isRoleVisible(row.role || '', row.status || '')) continue;
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
      this._clearActiveCell();
      return true;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      // Tab はその行のタイプ選択メニューを開く（Shift+Tab は従来どおり前のセルへ移動）
      if (!e.shiftKey) {
        const roleBtn = this.host?.querySelector(`.sn2-row[data-row-id="${this._activeCellRowId}"] .sn2-role-btn`);
        if (roleBtn && typeof this._showRoleMenu === 'function') {
          this._showRoleMenu(roleBtn, { fromNav: true });
          return true;
        }
      }
      this._navigateCell(e.shiftKey ? 'prev-col' : 'next-col');
      return true;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      const colId = this._activeCellColId;
      const cellEl = this._getCellElement(this._activeCellRowId, colId);
      if (cellEl?.classList.contains('sn2-text') || cellEl?.classList.contains('sn2-custom-text')) {
        this._enterEditMode(cellEl);
      } else if (colId === '_role') {
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

  _insertEmptyRowBelow() {
    if (!this._activeCellRowId) return;
    const idx = this.doc.rows.findIndex(r => r.id === this._activeCellRowId);
    if (idx < 0) return;
    this._pushUndo('行追加');
    let newRole = '';
    if (this._filterRoles && this._filterRoles.size === 1) newRole = [...this._filterRoles][0];
    let newStatus = this.doc.rows[idx].status || '';
    if (this._filterStatuses && this._filterStatuses.size === 1) newStatus = [...this._filterStatuses][0];
    const newRow = { id: `sn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: newRole, status: newStatus, text: '', columns: {} };
    if (globalThis.GBScriptNoteRoleModel?.assignRowRole) {
      globalThis.GBScriptNoteRoleModel.assignRowRole(this.doc, newRow, newRole);
    }
    this.doc.rows.splice(idx + 1, 0, newRow);
    this._calcCache = null;
    this._render();
    this._markDirty({ skipUndo: true });
    this._setActiveCell(newRow.id, this._activeCellColId || '_text', false);
  },

});
