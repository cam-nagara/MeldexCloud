/* gb-scriptnote-history.js: シナリオの Undo/Redo とスナップショット復元 */

function _sn2FindRowFromNode(node) {
  if (!node) return null;
  const el = node.nodeType === 3 ? node.parentElement : node;
  return el?.closest?.('.sn2-row') || null;
}

function _sn2CaptureSnapshotFocus(editor) {
  let focusRowId = null;
  let focusRowIdx = -1;
  // 取り消し・やり直しの前のアクティブなセル（列と編集中か）も覚え、復元後に同じ状態へ戻す（設計意図§12）。
  const activeColId = editor._activeCellRowId ? (editor._activeCellColId || null) : null;
  let editing = !!(editor._activeCellRowId && editor._cellEditMode);
  try {
    const sel = window.getSelection();
    const activeElement = document.activeElement;
    // 直接クリックで編集中の本文（アクティブなセルの記録なし）も編集中として扱う。
    if (!editing && activeElement?.matches?.('.sn2-text[contenteditable="true"], .sn2-custom-text[contenteditable="true"]')
        && editor.host?.contains(activeElement)) editing = true;
    const recordedRow = editor._activeCellRowId
      ? editor.host?.querySelector(`.sn2-row[data-row-id="${MeldexEscape.cssIdent(editor._activeCellRowId)}"]`)
      : null;
    const activeRow = recordedRow
      || _sn2FindRowFromNode(activeElement)
      || _sn2FindRowFromNode(sel?.anchorNode)
      || _sn2FindRowFromNode(sel?.focusNode);
    if (activeRow && editor.host?.contains(activeRow)) {
      focusRowId = activeRow.dataset.rowId || null;
      if (focusRowId) focusRowIdx = editor.doc.rows.findIndex((row) => row.id === focusRowId);
    }
  } catch {}
  return { focusRowId, focusRowIdx, activeColId, editing };
}

// 復元後のフォーカスを、アクティブなセルの記録と一致する形で戻す（M-014 S24）。
// 以前は描き直しで消えたセルの記録を残したまま本文へフォーカスしていたため、記録とフォーカスが
// 食い違い、続く矢印・Enter が記録側のセルから動いていた。戻した位置（行・列・フォーカス要素）を返す。
function _sn2RestoreSnapshotFocus(editor, focusState) {
  const restoreText = _sn2FindRestoreTarget(editor, focusState);
  if (!restoreText) return null;
  const rowId = restoreText.closest('.sn2-row')?.dataset?.rowId || '';
  // 描き直し前のセルの記録は、新しい DOM には当てはまらないので先に外す。
  editor._cellEditMode = false;
  if (!rowId || editor._rowSelection?.size || typeof editor._setActiveCell !== 'function') {
    // 行の選択を残す時は、セルをアクティブにしない（行の選択とアクティブなセルは相互排他）。
    editor._activeCellRowId = null;
    editor._activeCellColId = null;
    editor._focusText(restoreText, 'end');
  } else {
    let colId = focusState?.activeColId || '_text';
    if (!editor._getCellElement?.(rowId, colId)) colId = '_text';
    const cellEl = editor._getCellElement?.(rowId, colId);
    const textLike = !!cellEl?.classList?.contains('sn2-text') || !!cellEl?.classList?.contains('sn2-custom-text');
    editor._activeCellRowId = null;
    editor._activeCellColId = null;
    editor._setActiveCell(rowId, colId, !!(focusState?.editing && textLike && !editor._readOnly));
  }
  restoreText.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  return { rowId: editor._activeCellRowId, colId: editor._activeCellColId, focused: document.activeElement };
}

function _sn2FindRestoreTarget(editor, focusState) {
  if (!editor.host) return null;
  const { focusRowId, focusRowIdx } = focusState || {};
  if (focusRowId) {
    const byId = editor.host.querySelector(`.sn2-row[data-row-id="${focusRowId}"] .sn2-text`);
    if (byId) return byId;
  }
  if (focusRowIdx >= 0 && Array.isArray(editor.doc.rows) && editor.doc.rows.length) {
    const tryIdx = (index) => {
      if (index < 0 || index >= editor.doc.rows.length) return null;
      const rowId = editor.doc.rows[index]?.id;
      if (!rowId) return null;
      return editor.host.querySelector(`.sn2-row[data-row-id="${rowId}"] .sn2-text`);
    };
    return tryIdx(focusRowIdx - 1)
      || tryIdx(focusRowIdx)
      || tryIdx(Math.min(focusRowIdx, editor.doc.rows.length - 1))
      || tryIdx(editor.doc.rows.length - 1);
  }
  return editor.host.querySelector('.sn2-row .sn2-text');
}

// 取り消し・やり直しで内容が変わった最初の行を探す（設計意図§12「元の行かその直前の行にカーソル」）。
// 変わった行が残っていればその行、消えた行なら復元後の同じ位置（無ければ直前）の行を返す。
function _sn2ChangedRowFocus(beforeRows, afterRows) {
  const key = row => {
    try { return JSON.stringify([row?.id, row?.text, row?.role, row?.character, row?.status, row?.typeRef, row?.characterRef, row?.columns]); }
    catch { return String(row?.id || ''); }
  };
  const before = Array.isArray(beforeRows) ? beforeRows : [];
  const after = Array.isArray(afterRows) ? afterRows : [];
  const length = Math.max(before.length, after.length);
  for (let index = 0; index < length; index += 1) {
    if (key(before[index]) === key(after[index])) continue;
    const beforeId = before[index]?.id;
    const afterIndex = beforeId ? after.findIndex(row => row?.id === beforeId) : -1;
    if (afterIndex >= 0 && key(after[afterIndex]) !== key(before[index])) return { focusRowId: beforeId, focusRowIdx: afterIndex };
    // 行が消えた（追加の取り消し等）時は直前の行、行が戻った時はその行。
    const removed = beforeId && afterIndex < 0;
    const targetIndex = Math.max(0, Math.min(removed ? index - 1 : index, after.length - 1));
    const target = after[targetIndex];
    return target ? { focusRowId: target.id, focusRowIdx: targetIndex } : null;
  }
  return null;
}

let _sn2HistoryScopeSeq = 0;
function _sn2NewHistoryScopeId() {
  _sn2HistoryScopeSeq += 1;
  return 'sn-' + Date.now().toString(36) + '-' + _sn2HistoryScopeSeq.toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function _sn2PrepareHistoryNavigation(scope) {
  if (!String(scope || '').startsWith('scriptnote:')) return true;
  const editor = typeof _sn2EditorByScope === 'function' ? _sn2EditorByScope(scope) : null;
  if (!editor || editor._readOnly || editor._imeComposing) return false;
  editor._pushUndo('編集');
  return true;
}

function _sn2RecordHistoryTransition(editor, label) {
  editor._syncAllFromDom();
  const snap = editor._takeSnapshot();
  if (editor._lastPushedSnap === snap) return;
  const previous = editor._lastPushedSnap;
  editor._lastPushedSnap = snap;
  const scope = editor._historyScope();
  if (previous && typeof historyPush === 'function') {
    historyPush(label, () => editor._applySnapshot(previous), () => editor._applySnapshot(snap), scope);
  }
}

Object.assign(ScriptNoteEditor.prototype, {

  _takeSnapshot() {
    const data = serializeScriptNoteDoc(this.doc);
    // 表示中のビューは表示の切替なので履歴の比較・復元に含めない。
    if (data && typeof data === 'object') delete data.activeViewId;
    return JSON.stringify(data);
  },

  _historyScope() {
    if (!this._historyScopeId) {
      this._historyScopeId = _sn2NewHistoryScopeId();
      this._historyScopePath = this._path || '';
    }
    return 'scriptnote:' + this._historyScopeId;
  },

  _pushUndo(label = '') {
    if (this._pushUndoSuppressed) return;
    if (this._undoTimer) {
      clearTimeout(this._undoTimer);
      this._undoTimer = null;
    }
    _sn2RecordHistoryTransition(this, label);
    if (label === '初期状態') return;
    // 操作前に呼ぶ列・タイプ編集も、同じ操作の終了時に遷移を確定する。
    // skipUndoの編集でもボタンとパネルへ直ちに反映し、次の操作へ混ぜない。
    const document = this.doc;
    const scopeId = this._historyScopeId;
    queueMicrotask(() => {
      if (this.doc !== document || this._historyScopeId !== scopeId
          || this._pushUndoSuppressed || this._readOnly || this._imeComposing) return;
      try { _sn2RecordHistoryTransition(this, label); }
      catch (error) { if (typeof showStatus === 'function') showStatus('履歴の記録に失敗しました: ' + (error?.message || error), true); }
    });
  },

  undo() {
    if (this._readOnly || this._imeComposing) return;
    // 操作前の記録と、入力後の遅延記録を同じ遷移へまとめる。
    this._pushUndo('編集');
    const scope = this._historyScope();
    if (typeof historyUndo === 'function') return historyUndo(scope);
  },

  redo() {
    if (this._readOnly || this._imeComposing) return;
    this._pushUndo('編集');
    const scope = this._historyScope();
    if (typeof historyRedo === 'function') return historyRedo(scope);
  },

  _applySnapshot(snap) {
    if (!this.doc || !this.host || this._readOnly || this._imeComposing) return false;
    const focusState = _sn2CaptureSnapshotFocus(this);
    const rowsBefore = this.doc.rows;
    this._pushUndoSuppressed = true;
    try {
      // 書式ポップアップはタイプオブジェクトを捕捉するため、配列を復元する前に閉じる。
      // 復元後も残すと、切断済みオブジェクトへの変更が保存されずに消える。
      if (typeof closeAllPalettePopups === 'function') closeAllPalettePopups();
      if (typeof closeAllFormatPopups === 'function') closeAllFormatPopups();
      const data = createScriptNoteDoc(JSON.parse(snap));
      this._rebindRoleFilters?.(
        [...(this.doc.scenarioTypes || []), ...(this.doc.characters || [])],
        [...data.scenarioTypes, ...data.characters],
      );
      this.doc.fileType = data.fileType;
      this.doc.version = data.version;
      this.doc.title = data.title;
      this.doc.layoutMode = data.layoutMode;
      // 版付きテンプレートと紙面設定も本文と同じ履歴単位で復元する。
      // 欠けている旧文書へ戻す時は、現在値を残さず明示的に取り除く。
      ['templateId', 'templateVersion', 'templatePurpose', 'templateSourceRefs', 'pageSettings'].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(data, key)) this.doc[key] = data[key];
        else delete this.doc[key];
      });
      this.doc.editor = data.editor;
      this.doc.scenarioTypes = data.scenarioTypes;
      this.doc.characters = data.characters;
      this.doc.characterDb = data.characterDb;
      this.doc.notes = data.notes;
      this.doc.rubyRules = data.rubyRules || [];
      this.doc.rubyPresentation = data.rubyPresentation;
      this.doc.rows = data.rows;
      this.doc.source = data.source;
      // カーソルは、取り消し・やり直しで変わった行へ置く（変わった行が無ければ操作前の位置）。
      const changedFocus = _sn2ChangedRowFocus(rowsBefore, data.rows);
      if (changedFocus) Object.assign(focusState, changedFocus);
      // ビュー一覧は本文と同じ履歴単位で戻す。表示中のビューは戻さない（表示の切替は履歴に入れない）。
      if (Array.isArray(data.views)) this.doc.views = data.views;
      else delete this.doc.views;
      if (typeof this._ensureScenarioViews === 'function') {
        this._ensureScenarioViews();
        this._applyScenarioViewFilter?.(this._activeScenarioView(), { render: false });
        this._refreshScenarioViewTabs?.();
      }
      this._ensureDefaultChara();
      this._calcCache = null;
      this._render();
      this._syncAllFromDom();
      if (this._rowSelection instanceof Set) {
        const rowIds = createScriptNoteRowIdSet(this.doc);
        for (const rowId of [...this._rowSelection]) {
          if (!rowIds.has(rowId)) this._rowSelection.delete(rowId);
        }
      }
      if (typeof this._updateRowSelectionUI === 'function') this._updateRowSelectionUI();
      this._dirty = true;
      this._scheduleSave();
      this._refreshDetailPanel();
      this._lastPushedSnap = this._takeSnapshot();
      window.dispatchEvent(new CustomEvent('meldex:scriptnote-history-restored', { detail: { editor: this } }));
    } finally {
      this._pushUndoSuppressed = false;
    }
    // 復元の直後に同期でフォーカスを戻し、次のフレームでは描き直しの後始末でフォーカスが外れた時だけ
    // 戻し直す。その間に利用者が別のセルを選んだり編集を始めたりしていたら、遅れて奪わない（M-014 S24）。
    let restored = this.host ? _sn2RestoreSnapshotFocus(this, focusState) : null;
    requestAnimationFrame(() => {
      if (!this.host) return;
      const ae = document.activeElement;
      const userMoved = !restored
        || this._activeCellRowId !== restored.rowId
        || this._activeCellColId !== restored.colId
        || (ae && ae !== restored.focused && ae !== document.body && ae.isConnected);
      if (!userMoved && (!restored.focused?.isConnected || ae !== restored.focused)) {
        restored = _sn2RestoreSnapshotFocus(this, focusState);
      }
      if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      requestAnimationFrame(() => {
        if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      });
    });
    return true;
  },

  _refreshDetailPanel() {
    if (document.querySelector('.gb-tool-file-theme [data-file-theme-panel="scriptnote"]')
      && typeof _fsRefreshThemePanels === 'function') _fsRefreshThemePanels('scriptnote');
    const container = document.getElementById('detail-tab-sn2-main');
    if (!container) return;
    const panel = container.querySelector('.sn2-detail-wrap');
    if (!panel || panel.style.display === 'none') return;
    const activeTab = this._detailActiveTab || 'roles';
    if (activeTab === 'style') {
      if (typeof renderFileStyleTab === 'function') renderFileStyleTab('scriptnote');
    } else if (activeTab === 'ruby' && typeof this.renderRubyPanel === 'function') {
      this.renderRubyPanel(panel);
    } else if (activeTab === 'theme' && typeof this.renderThemePanel === 'function') {
      this.renderThemePanel(panel);
    } else if (activeTab === 'rowset' && typeof this.renderRowsetPanel === 'function') {
      this.renderRowsetPanel(panel);
    } else {
      this.renderDetailPanel(panel);
    }
  },

});

(function _sn2PatchHistoryScopePerEditor() {
  if (typeof ScriptNoteEditor === 'undefined') return;
  const proto = ScriptNoteEditor?.prototype;
  if (!proto || typeof proto.loadDoc !== 'function' || proto.loadDoc.__sn2HistoryScopePatched) return;
  const originalLoadDoc = proto.loadDoc;
  proto.loadDoc = function(parsed, path = '') {
    const nextPath = String(path || '');
    const previousId = this._historyScopeId;
    const previousPath = this._historyScopePath;
    // 新規文書・同じパスの再読込も新しい履歴にする。以前の全文を保存し直さない。
    this._historyScopeId = _sn2NewHistoryScopeId();
    this._historyScopePath = nextPath;
    try {
      const result = originalLoadDoc.apply(this, arguments);
      if (result !== false) return result;
      this._historyScopeId = previousId;
      this._historyScopePath = previousPath;
      return result;
    } catch (error) {
      this._historyScopeId = previousId;
      this._historyScopePath = previousPath;
      throw error;
    }
  };
  proto.loadDoc.__sn2HistoryScopePatched = true;
})();
