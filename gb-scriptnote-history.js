/* gb-scriptnote-history.js: シナリオの Undo/Redo とスナップショット復元 */

function _sn2FindRowFromNode(node) {
  if (!node) return null;
  const el = node.nodeType === 3 ? node.parentElement : node;
  return el?.closest?.('.sn2-row') || null;
}

function _sn2CaptureSnapshotFocus(editor) {
  let focusRowId = null;
  let focusRowIdx = -1;
  try {
    const sel = window.getSelection();
    const activeElement = document.activeElement;
    const activeRow = _sn2FindRowFromNode(activeElement)
      || _sn2FindRowFromNode(sel?.anchorNode)
      || _sn2FindRowFromNode(sel?.focusNode);
    if (activeRow && editor.host?.contains(activeRow)) {
      focusRowId = activeRow.dataset.rowId || null;
      if (focusRowId) focusRowIdx = editor.doc.rows.findIndex((row) => row.id === focusRowId);
    }
  } catch {}
  return { focusRowId, focusRowIdx };
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

let _sn2HistoryScopeSeq = 0;
function _sn2NewHistoryScopeId() {
  _sn2HistoryScopeSeq += 1;
  return 'sn-' + Date.now().toString(36) + '-' + _sn2HistoryScopeSeq.toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

Object.assign(ScriptNoteEditor.prototype, {

  _takeSnapshot() {
    return JSON.stringify(serializeScriptNoteDoc(this.doc));
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
    this._syncAllFromDom();
    const snap = this._takeSnapshot();
    if (this._lastPushedSnap === snap) return;
    this._lastPushedSnap = snap;
    const scope = this._historyScope();
    if (typeof historyPush === 'function') {
      historyPush(label, () => { this._applySnapshot(snap); }, null, scope);
    }
  },

  undo() {
    const scope = this._historyScope();
    if (typeof historyUndo === 'function') historyUndo(scope);
  },

  redo() {
    const scope = this._historyScope();
    if (typeof historyRedo === 'function') historyRedo(scope);
  },

  _applySnapshot(snap) {
    if (!this.doc || !this.host) return;
    const focusState = _sn2CaptureSnapshotFocus(this);
    this._pushUndoSuppressed = true;
    try {
      // 書式ポップアップはタイプオブジェクトを捕捉するため、配列を復元する前に閉じる。
      // 復元後も残すと、切断済みオブジェクトへの変更が保存されずに消える。
      if (typeof closeAllPalettePopups === 'function') closeAllPalettePopups();
      if (typeof closeAllFormatPopups === 'function') closeAllFormatPopups();
      const data = createScriptNoteDoc(JSON.parse(snap));
      this.doc.fileType = data.fileType;
      this.doc.version = data.version;
      this.doc.title = data.title;
      this.doc.layoutMode = data.layoutMode;
      this.doc.editor = data.editor;
      this.doc.scenarioTypes = data.scenarioTypes;
      this.doc.characters = data.characters;
      this.doc.characterDb = data.characterDb;
      this.doc.notes = data.notes;
      this.doc.rubyRules = data.rubyRules || [];
      this.doc.rubyPresentation = data.rubyPresentation;
      this.doc.rows = data.rows;
      this.doc.source = data.source;
      this._ensureDefaultChara();
      this._lastPushedSnap = snap;
      this._calcCache = null;
      this._render();
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
    } finally {
      this._pushUndoSuppressed = false;
    }
    requestAnimationFrame(() => {
      if (!this.host) return;
      const restoreText = _sn2FindRestoreTarget(this, focusState);
      if (restoreText) {
        this._focusText(restoreText, 'end');
        restoreText.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      }
      if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      requestAnimationFrame(() => {
        if (this._caretSelChangeHandler) this._caretSelChangeHandler();
      });
    });
  },

  _refreshDetailPanel() {
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
    if (!this._historyScopeId || (this._historyScopePath && nextPath && this._historyScopePath !== nextPath)) {
      this._historyScopeId = _sn2NewHistoryScopeId();
    }
    this._historyScopePath = nextPath;
    return originalLoadDoc.apply(this, arguments);
  };
  proto.loadDoc.__sn2HistoryScopePatched = true;
})();
