/* 型別値エディタ・ドロップダウン — gb-db-property-types.js から分離 */

// 日付値の表示用フォーマット: 時刻部分があれば "YYYY-MM-DD HH:MM" で表示
function _formatDateDisplay(v, ptc) {
  if (typeof _dbDateFormatDisplay === 'function') return _dbDateFormatDisplay(v, ptc);
  if (!v || typeof v !== 'string') return v || '';
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (m) return m[1] + ' ' + m[2];
  return v;
}
// ストア値からinput用の値に変換（datetime-local形式: "YYYY-MM-DDTHH:MM"）
function _toInputDateValue(v, wantTime) {
  if (typeof _dbDateToInputValue === 'function') return _dbDateToInputValue(v, wantTime);
  if (!v || typeof v !== 'string') return '';
  if (wantTime) {
    // datetime-local expects "YYYY-MM-DDTHH:MM"
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.substring(0, 16);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v + 'T00:00';
    return v;
  } else {
    // date input expects "YYYY-MM-DD"
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.substring(0, 10);
    return v;
  }
}

function _valueEditorDbPath(entityPath, anchorEl) {
  const fromEntity = typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : '';
  if (fromEntity) return fromEntity;
  if (typeof _dbPivotContextFromTarget === 'function' && typeof _dbPivotPathForContext === 'function') {
    const ctx = _dbPivotContextFromTarget(anchorEl, { entityPath });
    const fromCtx = _dbPivotPathForContext(ctx, '');
    if (fromCtx) return fromCtx;
  }
  return state.currentDbPath || '';
}

function _valueEditorContext(entityPath, anchorEl, dbPath) {
  const targetDbPath = dbPath || _valueEditorDbPath(entityPath, anchorEl);
  if (typeof _dbPivotContextFromTarget === 'function') {
    const ctx = _dbPivotContextFromTarget(anchorEl, { entityPath, dbPath: targetDbPath });
    if (ctx) return ctx;
  }
  if (targetDbPath && typeof _dbFindPaneContextForPath === 'function') {
    const ctx = _dbFindPaneContextForPath(targetDbPath);
    if (ctx) return ctx;
  }
  return typeof _currentPaneState === 'function' ? _currentPaneState() : null;
}

function _typedCellControlE2eId(kind, entityPath, propName) {
  const token = (typeof _dbE2eToken === 'function')
    ? _dbE2eToken
    : (value) => String(value == null ? '' : value)
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'item';
  return `db-cell-${token(kind)}-${token(entityPath)}-${token(propName)}`;
}

function _valueEditorLockMessage(dbPath, propName) {
  return typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, propName) : '';
}

function _valueEditorReload(dbPath, ctx) {
  if (!dbPath || typeof selectDatabase !== 'function') return undefined;
  const reloadCtx = ctx || (typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null);
  return selectDatabase(dbPath, reloadCtx || undefined, { silent: true });
}

function _startNumberValueEdit(span, val, entityPath, propName, dbPath) {
  const lockMsg = _valueEditorLockMessage(dbPath, propName);
  if (lockMsg) { showStatus(lockMsg); return; }
  if (span.querySelector('input')) return;
  const old = typeof _cellUiValueToString === 'function' ? _cellUiValueToString(val.value) : String(val.value || '');
  const editedTd = span.closest('td');
  const editedRoot = editedTd?.closest?.('.gb-pane') || editedTd?.closest?.('.gb-pane-content') || document;
  const restoreEditedCellSelection = (afterRender = false) => {
    const restore = () => {
      const target = typeof _cellUiResolveRenderedCell === 'function'
        ? _cellUiResolveRenderedCell(editedTd, entityPath, propName, editedRoot)
        : editedTd;
      if (target && typeof setActiveCell === 'function') setActiveCell(target, { scroll: false });
    };
    restore();
    if (!afterRender) return;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
    setTimeout(restore, 80);
  };
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'value-input cell-number-input';
  input.value = old;
  input.style.cssText = 'width:100%;padding:2px 4px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;';
  span.textContent = '';
  span.appendChild(input);
  input.focus();
  input.select();
  let done = false;
  const restore = () => { span.textContent = old; restoreEditedCellSelection(); };
  const finish = () => {
    if (done) return;
    done = true;
    const nv = input.value.trim();
    if (nv && !Number.isFinite(Number(nv))) {
      showStatus('数値として保存できません', true);
      restore();
      return;
    }
    if (nv === old) { restore(); return; }
    span.textContent = nv;
    restoreEditedCellSelection();
    const saveRef = { ...val };
    val.value = nv;
    const save = async () => {
      try {
        await _apiPutValue(saveRef, { new_value: nv });
        if (saveRef.file) val.file = saveRef.file;
        if (typeof _dbUndoValue === 'function') _dbUndoValue(propName + ': ' + old + ' → ' + nv, val, old, nv);
        if (typeof _refreshAfterCellEdit === 'function') _refreshAfterCellEdit(span, entityPath, propName);
        restoreEditedCellSelection(true);
      } catch (e) {
        val.value = old;
        showStatus('保存に失敗: ' + (e?.message || e), true);
        restore();
      }
    };
    if (typeof _cellUiScheduleAfterPaint === 'function') {
      _cellUiScheduleAfterPaint(save);
    } else if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(save));
    } else {
      setTimeout(save, 0);
    }
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); finish(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.(); done = true; restore(); }
  });
}

// 型に応じたセル描画
