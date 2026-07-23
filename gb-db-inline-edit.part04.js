function _dbCellClipboardValue(td, ctx) {
  const value = _dbCellPrimaryValue(td, ctx);
  if (value && value.value != null) return String(value.value);
  return '';
}

function _dbMakeClipboardFromCells(table, cells, ctx) {
  const coords = cells.map(cell => ({ cell, coords: _dbCellCoords(table, cell) })).filter(item => item.coords);
  if (!coords.length) return null;
  const minRow = Math.min(...coords.map(item => item.coords.row));
  const minCol = Math.min(...coords.map(item => item.coords.col));
  const payloadCells = coords.map(({ cell, coords }) => {
    const valueRef = _dbCellPrimaryValue(cell, ctx);
    return {
      rowOffset: coords.row - minRow,
      colOffset: coords.col - minCol,
      propName: cell.dataset.propName || '',
      value: valueRef && valueRef.value != null ? String(valueRef.value) : _dbCellClipboardValue(cell, ctx),
      status: valueRef?.status || '採用',
      note: valueRef?.note || '',
    };
  });
  const rowCount = Math.max(...payloadCells.map(cell => cell.rowOffset)) + 1;
  const colCount = Math.max(...payloadCells.map(cell => cell.colOffset)) + 1;
  const rows = Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => ''));
  payloadCells.forEach(cell => { rows[cell.rowOffset][cell.colOffset] = cell.value; });
  return { cells: payloadCells, rowCount, colCount, text: rows.map(row => row.join('\t')).join('\n') };
}

async function _dbCopySelectedCells(table) {
  const ctx = _dbContextForCell(activeCell || table);
  const cells = _dbSelectedDataCells(table, true);
  const clipboard = _dbMakeClipboardFromCells(table, cells, ctx);
  if (!clipboard) return false;
  dbCellClipboard = clipboard;
  dbCellClipboardAt = Date.now();
  try {
    await navigator.clipboard?.writeText?.(clipboard.text);
  } catch {}
  if (typeof showStatus === 'function') showStatus(`${clipboard.cells.length} 件のセルをコピーしました`);
  return true;
}

function _dbClipboardFromText(text, propName) {
  const lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const rows = lines.map(line => String(line).split('\t'));
  const colCount = Math.max(1, ...rows.map(row => row.length));
  const cells = [];
  rows.forEach((row, rowOffset) => {
    for (let colOffset = 0; colOffset < colCount; colOffset += 1) {
      cells.push({
        rowOffset,
        colOffset,
        propName,
        value: row[colOffset] || '',
        status: '採用',
        note: '',
      });
    }
  });
  return { cells, rowCount: rows.length, colCount, text: rows.map(row => {
    const normalized = [...row];
    while (normalized.length < colCount) normalized.push('');
    return normalized.join('\t');
  }).join('\n') };
}

function _dbCellAllowsPaste(td, ctx) {
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const propName = td?.dataset?.propName || '';
  const ptc = dbPath && propName && typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)[propName] : null;
  if (!td || !propName || ptc?.source) return false;
  if (ptc && ['formula', 'rollup', 'button', 'multi-source-relation', 'chat'].includes(ptc.type)) return false;
  return !(typeof checkColumnEditable === 'function' && checkColumnEditable(dbPath, propName));
}

function _dbSnapshotCellValues(entityData, propName) {
  return Array.isArray(entityData?.[propName])
    ? entityData[propName].map(v => ({ ...v }))
    : [];
}

function _dbRestoreCellValues(entityData, propName, snapshot) {
  if (!entityData || !propName) return;
  entityData[propName] = (snapshot || []).map(v => ({ ...v }));
}

function _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx) {
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const ptc = dbPath && propName && typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)[propName] : null;
  if (typeof _refreshPivotRelationCell === 'function'
      && _refreshPivotRelationCell(td, entityPath, propName, ptc, { dbPath, ctx })) {
    if (typeof _refreshDerivedCellsInRow === 'function') {
      _refreshDerivedCellsInRow(td, entityPath, { dbPath, ctx });
    }
    return true;
  }
  return typeof _tryRefreshPivotCellLocal === 'function'
    && _tryRefreshPivotCellLocal(td, entityPath, propName, { dbPath, ctx });
}

function _dbCanPersistCellValueRef(valueRef) {
  const file = String(valueRef?.file || '').trim().replace(/\\/g, '/').toLowerCase();
  return !!file && file.endsWith('.md');
}

async function _dbDeleteValueRef(valueRef, propName) {
  if (!valueRef?.file) return;
  const ref = { ...valueRef, property: valueRef.property || propName };
  if (!_dbCanPersistCellValueRef(ref)) return;
  if (ref.candidate_index != null) {
    await _apiPutValue(ref, { _delete: true });
  } else {
    await apiPost('/outliner/delete', { path: ref.file });
  }
}

function _dbDeleteOrderForCellSnapshot(snapshot) {
  return [...(snapshot || [])].sort((a, b) => {
    const af = a?.file || '';
    const bf = b?.file || '';
    const ap = a?.property || '';
    const bp = b?.property || '';
    if (af !== bf) return af.localeCompare(bf);
    if (ap !== bp) return ap.localeCompare(bp);
    const ai = Number.isInteger(a?.candidate_index) ? a.candidate_index : -1;
    const bi = Number.isInteger(b?.candidate_index) ? b.candidate_index : -1;
    return bi - ai;
  });
}

function _dbCellMutationGroupKey(target, ctx) {
  const td = target?.target || target;
  const { entityName } = _dbCellEntityAndProp(td);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  return `${dbPath}\n${entityName || ''}`;
}

async function _dbRunCellMutationsByEntity(targets, ctx, mutate) {
  const groups = new Map();
  (targets || []).forEach(item => {
    const key = _dbCellMutationGroupKey(item, ctx);

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const groupedResults = await Promise.all(Array.from(groups.values()).map(async group => {
    const results = [];
    for (const item of group) {
      results.push(await mutate(item));
    }
    return results;
  }));
  return groupedResults.flat();
}

function _dbYieldCellBatchPaint() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function _dbPrepareClearCellValues(td, ctx) {
  const { entityName, propName } = _dbCellEntityAndProp(td);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const data = (ctx && ctx.pivotData) || state.pivotData;
  if (!entityName || !propName || !dbPath || !_dbCellAllowsPaste(td, ctx)) return null;
  const entityPath = typeof _entityPath === 'function' ? _entityPath(dbPath, entityName, data) : `${dbPath}/${entityName}.md`;
  const entityData = data?.entities?.[entityName];
  if (!entityData || !Array.isArray(entityData[propName]) || entityData[propName].length === 0) return null;
  const snapshot = _dbSnapshotCellValues(entityData, propName);
  entityData[propName] = [];
  const refreshed = _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
  if (!refreshed && ctx) ctx._clipboardPasteNeedsRefresh = true;
  return {
    target: td,
    entityPath,
    propName,
    persist: async () => {
      for (const valueRef of _dbDeleteOrderForCellSnapshot(snapshot)) {
        await _dbDeleteValueRef(valueRef, propName);
      }
    },
    rollback: () => {
      _dbRestoreCellValues(entityData, propName, snapshot);
      _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
    },
  };
}

async function _dbClearCellValues(td, ctx) {
  const op = _dbPrepareClearCellValues(td, ctx);
  if (!op) return false;
  try {
    await op.persist();
    return true;
  } catch (err) {
    op.rollback();
    throw err;
  }
}

function _dbPrepareWriteClipboardCellValue(td, value, ctx, meta = {}) {
  const { entityName, propName } = _dbCellEntityAndProp(td);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const data = (ctx && ctx.pivotData) || state.pivotData;
  if (!entityName || !propName || !dbPath || !_dbCellAllowsPaste(td, ctx)) return null;
  const entityPath = typeof _entityPath === 'function' ? _entityPath(dbPath, entityName, data) : `${dbPath}/${entityName}.md`;
  const entityData = data?.entities?.[entityName];
  if (!entityData) return null;
  if (!Array.isArray(entityData[propName])) entityData[propName] = [];
  if (String(value ?? '') === '') return _dbPrepareClearCellValues(td, ctx);
  const snapshot = _dbSnapshotCellValues(entityData, propName);
  const existing = _dbCellPrimaryValue(td, ctx);
  const existingRef = existing ? { ...existing, property: existing.property || propName } : null;
  const status = meta.status || existing?.status || '採用';
  const note = meta.note || existing?.note || '';
  let localValue = null;
  if (typeof _upsertLocalPivotValue === 'function') {
    localValue = _upsertLocalPivotValue(entityPath, propName, existing, value, {
      file: existing?.file || '',
      property: propName,
      candidate_index: existing?.candidate_index,
      status,
      note,
    }, ctx);
  } else if (existing) {
    existing.value = value;
    existing.status = status;
    existing.note = note;
    localValue = existing;
  } else {
    localValue = { property: propName, value, status, note, file: '', candidate_index: null };
    entityData[propName].push(localValue);
  }
  const refreshed = _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
  if (!refreshed && ctx) ctx._clipboardPasteNeedsRefresh = true;
  return {
    target: td,
    entityPath,
    propName,
    persist: async () => {
      if (existing && _dbCanPersistCellValueRef(existingRef)) {
        await _apiPutValue(existingRef, { new_value: value });
        existing.value = value;
        existing.property = propName;
        if (existingRef?.file) existing.file = existingRef.file;
        if (existingRef?.candidate_index !== undefined) existing.candidate_index = existingRef.candidate_index;
        delete existing.rich_html;
        if (localValue && localValue !== existing) {
          localValue.file = existing.file;
          localValue.candidate_index = existing.candidate_index;
        }
        _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
        return;
      }
      const result = await _apiPostValue(entityPath, propName, value, status, note);
      if (localValue) {
        localValue.file = result?.path || entityPath;
        localValue.candidate_index = result?.candidate_index;
        localValue.property = propName;
      }
      _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
    },
    rollback: () => {
      _dbRestoreCellValues(entityData, propName, snapshot);
      _dbRefreshClipboardTargetCell(td, entityPath, propName, ctx);
    },
  };
}

async function _dbWriteClipboardCellValue(td, value, ctx, meta = {}) {
  const op = _dbPrepareWriteClipboardCellValue(td, value, ctx, meta);
  if (!op) return false;
  try {
    await op.persist();
    return true;
  } catch (err) {
    op.rollback();
    throw err;
  }
}

async function _dbPersistPreparedCellMutations(ops, ctx, debug) {
  return _dbRunCellMutationsByEntity(ops, ctx, async op => {
    try {
      await op.persist();
      return 1;
    } catch (err) {
      try { op.rollback(); } catch {}
      if (debug?.errors) {
        debug.errors.push({
          target: _dbCellPasteDebugRef(op.target),
          message: err?.message || String(err || ''),
        });
      }
      return -1;
    }
  });
}

function _dbPasteTargetsFromClipboard(table, startCell, clipboard) {
  const start = _dbCellCoords(table, startCell);
  if (!start || !clipboard?.cells?.length) return [];
  return clipboard.cells.map(src => {
    const target = _dbCellAt(table, start.row + src.rowOffset, start.col + src.colOffset);
    if (!target || !target.dataset?.propName) return null;
    return { target, value: src.value, status: src.status, note: src.note };
  }).filter(Boolean);
}

function _dbCellPasteDebugRef(td) {
  if (!td) return null;
  return {
    entityName: td.closest?.('tr')?.dataset?.entityName || '',
    propName: td.dataset?.propName || '',
    text: td.textContent || '',
  };
}

function _dbRecordCellPasteKeydownDebug(phase, e, table, keyCell, extra = {}) {
  try {
    window.__meldexLastCellPasteKeydownDebug = {
      phase,
      defaultPrevented: !!e?.defaultPrevented,
      key: e?.key || '',
      target: _dbCellPasteDebugRef(e?.target?.closest?.('td.col-entity,td[data-prop-name]')),
      keyCell: _dbCellPasteDebugRef(keyCell),
      visualCell: _dbCellPasteDebugRef(_dbCurrentVisualActiveCell()),
      activeCell: _dbCellPasteDebugRef(activeCell),
      focusedCell: _dbCellPasteDebugRef(document.activeElement?.closest?.('td.col-entity,td[data-prop-name]')),
      tableFound: !!table,
      ...extra,
    };
  } catch {}
}

async function _dbPasteClipboardCells(table, startCellOverride = null) {
  const visualStartCell = _dbCurrentVisualActiveCell();
  const pasteStartCell = startCellOverride?.dataset?.propName
    ? startCellOverride
    : (visualStartCell?.dataset?.propName ? visualStartCell : activeCell);
  if (!pasteStartCell?.dataset?.propName || !table) return false;
  if (pasteStartCell !== activeCell) setActiveCell(pasteStartCell, { preserveRange: true, scroll: false });
  const ctx = _dbContextForCell(pasteStartCell);
  const activePos = _dbCellEntityAndProp(pasteStartCell);
  let clipboard = dbCellClipboard;
  let systemText = '';
  const preferInternalClipboard = _dbHasInternalCellClipboard();
  if (!preferInternalClipboard) {
    try { systemText = await navigator.clipboard?.readText?.() || ''; } catch {}
  }
  if (systemText && !preferInternalClipboard && (!clipboard || systemText !== clipboard.text)) {
    clipboard = _dbClipboardFromText(systemText, pasteStartCell.dataset.propName);
  }
  if (!clipboard && !systemText) return false;
  if (!clipboard) {
    clipboard = _dbClipboardFromText(systemText, pasteStartCell.dataset.propName);
  }
  const selected = _dbSelectedDataCells(table, false);
  let targets = [];
  if (clipboard?.cells?.length === 1 && selected.length > 1) {
    targets = selected.map(target => ({
      target,
      value: clipboard.cells[0].value,
      status: clipboard.cells[0].status,
      note: clipboard.cells[0].note,
    }));
  } else {
    targets = _dbPasteTargetsFromClipboard(table, pasteStartCell, clipboard);
  }
  const pasteDebug = {
    startedAt: Date.now(),
    startCell: _dbCellPasteDebugRef(pasteStartCell),
    clipboardCells: Array.isArray(clipboard?.cells) ? clipboard.cells.map(cell => ({
      rowOffset: cell.rowOffset,
      colOffset: cell.colOffset,
      propName: cell.propName || '',
      value: cell.value || '',
      status: cell.status || '',
    })) : [],
    rawTargets: targets.map(item => ({ target: _dbCellPasteDebugRef(item.target), value: item.value || '', status: item.status || '' })),
    allowedTargets: [],
    written: 0,
    errors: [],
  };
  targets = targets.filter(item => _dbCellAllowsPaste(item.target, ctx));
  pasteDebug.allowedTargets = targets.map(item => ({ target: _dbCellPasteDebugRef(item.target), value: item.value || '', status: item.status || '' }));
  try { window.__meldexLastCellPasteDebug = pasteDebug; } catch {}
  if (!targets.length) {
    if (typeof showStatus === 'function') showStatus('貼り付けできるセルがありません', true);
    return false;
  }
  const ops = [];
  for (const item of targets) {
    try {
      const op = _dbPrepareWriteClipboardCellValue(item.target, item.value, ctx, item);
      if (op) ops.push(op);
    } catch (err) {
      pasteDebug.errors.push({
        target: _dbCellPasteDebugRef(item.target),
        message: err?.message || String(err || ''),
      });
    }
  }
  const written = ops.length;
  pasteDebug.written = written;
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const needsRefresh = !!ctx?._clipboardPasteNeedsRefresh;
  if (ctx) delete ctx._clipboardPasteNeedsRefresh;
  if (!needsRefresh) {
    setActiveCell(pasteStartCell, { preserveRange: true, scroll: false });
  }
  await _dbYieldCellBatchPaint();
  const saveResults = await _dbPersistPreparedCellMutations(ops, ctx, pasteDebug);
  const failed = saveResults.filter(value => value < 0).length;
  if (needsRefresh && dbPath && typeof selectDatabase === 'function') {
    selectDatabase(dbPath, ctx, { silent: true })
      .then(() => {
        if (typeof _restoreCellPos === 'function') _restoreCellPos(activePos, null);
      })
      .catch(() => {});
  }
  if (typeof showStatus === 'function') {
    showStatus(`${written - failed} 件のセルに貼り付けました${failed > 0 ? '（失敗 ' + failed + ' 件）' : ''}`, failed > 0);
  }
  return written > 0;
}

async function _dbClearSelectedCells(table) {
  const selected = _dbSelectedDataCells(table, true);
  if (!selected.length) return false;
  const ctx = _dbContextForCell(activeCell || selected[0] || table);
  const targets = selected.filter(cell => _dbCellAllowsPaste(cell, ctx));
  if (!targets.length) {
    if (typeof showStatus === 'function') showStatus('削除できるセルがありません', true);
    return false;
  }
  const ops = [];
  for (const target of targets) {
    try {
      const op = _dbPrepareClearCellValues(target, ctx);
      if (op) ops.push(op);
    } catch {
      // ローカル準備に失敗したセルは保存対象に含めない
    }
  }
  const cleared = ops.length;
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const needsRefresh = !!ctx?._clipboardPasteNeedsRefresh;
  if (ctx) delete ctx._clipboardPasteNeedsRefresh;
  await _dbYieldCellBatchPaint();
  const clearResults = await _dbPersistPreparedCellMutations(ops, ctx, null);
  const failed = clearResults.filter(value => value < 0).length;
  if (needsRefresh && dbPath && typeof selectDatabase === 'function') {
    selectDatabase(dbPath, ctx, { silent: true }).catch(() => {});
  }
  if (typeof showStatus === 'function') {
    showStatus(`${cleared - failed} 件のセルを削除しました${failed > 0 ? '（失敗 ' + failed + ' 件）' : ''}`, failed > 0);
  }
  return cleared > 0;
}

document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  const bypassNativeSheetShortcut = _dbShouldBypassNativeEditorForSheetShortcut(e);
  const nativeInTransientUi = _dbActiveNativeElementInTransientUi();
  const routedStaleNativeEditor = _dbCancelStaleNativeEditorForSheetShortcut(e);
  if (_dbIsNativeEditingElement(document.activeElement) && !nativeInTransientUi && !bypassNativeSheetShortcut && !routedStaleNativeEditor) return;
  if (_dbBlockForTransientUi(e)) return;
  if (bypassNativeSheetShortcut) _dbCancelNativeEditorForSheetShortcut(e);
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'v' && _dbHasInternalCellClipboard()) {
    const table = _dbKeyboardActiveTable();
    const keyCell = _dbKeyboardActiveCell(table, e.target);
    _dbRecordCellPasteKeydownDebug('inline-priority', e, table, keyCell);
    if (table && keyCell?.dataset?.propName) {
      e.preventDefault();
      if (keyCell !== activeCell) setActiveCell(keyCell, { preserveRange: true, scroll: false });
      try {
        _dbCancelCellInlineEditors(keyCell);
      } catch (err) {
        _dbRecordCellPasteKeydownDebug('inline-priority-cancel-editor-error', e, table, keyCell, {
          error: err?.message || String(err || ''),
        });
      }
      const pastePromise = _dbPasteClipboardCells(table, keyCell);
      _dbRecordCellPasteKeydownDebug('inline-priority-dispatched', e, table, keyCell, {
        pastePromise: !!pastePromise,
      });
      pastePromise.catch((err) => {
        _dbRecordCellPasteKeydownDebug('inline-priority-error', e, table, keyCell, {
          error: err?.message || String(err || ''),
        });
        if (typeof showStatus === 'function') showStatus('セルの貼り付けに失敗しました', true);
      });
      return;
    }
  }
  if (e.defaultPrevented) return;
  const table = _dbKeyboardActiveTable();
  const keyCell = _dbKeyboardActiveCell(table, e.target);
  if (!table || !keyCell) return;
  if (keyCell !== activeCell) setActiveCell(keyCell, { preserveRange: true, scroll: false });
  const tr = keyCell.parentElement;
  if (!tr || !table.contains(tr)) return;
  const colIdx = Array.from(tr.children).indexOf(keyCell);
  _dbHandleCellEditorKey(e, colIdx, keyCell);
}, true);

// テーブルキーボードナビゲーション
// セル単位のキー操作。Enter/F2 は分割パネル中でもアクティブセルの型別エディタを直接開く。
// Ctrl+Enter / Ctrl+Shift+Enter などのコマンド系は gb-shortcuts.js に委譲する。
document.addEventListener('keydown', (e) => {
  const setNavDebug = (extra) => {
    try {
      window.__meldexLastSheetNavDebug = {
        key: e.key,
        phase: extra?.phase || '',
        reason: extra?.reason || '',
        ...extra,
      };
    } catch {}
  };
  if (e.defaultPrevented) return;
  // ドロップダウンやメニューが開いている場合はそちらのキーナビに任せる
  const nativeInTransientUi = _dbActiveNativeElementInTransientUi();
  const routedStaleNativeEditor = _dbCancelStaleNativeEditorForSheetShortcut(e);
  if (_dbIsNativeEditingElement(document.activeElement) && !nativeInTransientUi && !routedStaleNativeEditor) {
    setNavDebug({ phase: 'before-table', reason: 'native-editor-active', activeTag: document.activeElement?.tagName || '', activeClass: String(document.activeElement?.className || '') });
    return;
  }
  if (_dbBlockForTransientUi(e)) {
    setNavDebug({ phase: 'before-table', reason: 'transient-ui-blocked' });
    return;
  }
  if (e.isComposing || e.keyCode === 229) return;

  const shortcutKey = String(e.key || '').toLowerCase();
  const preferSelectionTable = ((e.ctrlKey || e.metaKey) && !e.altKey && (shortcutKey === 'c' || shortcutKey === 'v'))
    || ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey);
  let table = _dbKeyboardActiveTable({ preferSelection: preferSelectionTable });
  if (state.view !== 'pivot' && !table) {
    setNavDebug({ phase: 'table', reason: 'not-pivot-no-table', view: state.view || '' });
    return;
  }
  if (!table) {
    setNavDebug({ phase: 'table', reason: 'no-table', view: state.view || '' });
    return;
  }
  let dataRows = _dbVisibleDataRows(table);

  let keyCell = _dbKeyboardActiveCell(table, e.target);
  if (!keyCell) {
    setNavDebug({ phase: 'cell', reason: 'no-key-cell', dataRowsLength: dataRows.length });
    if (dataRows.length > 0 && dataRows[0].children.length > 1) {
      setActiveCell(dataRows[0].children[1]);
    }
    return;
  }
  if (keyCell !== activeCell) setActiveCell(keyCell, { preserveRange: true, scroll: false });

  const tr = keyCell.parentElement;
  const rowIdx = dataRows.indexOf(tr);
  if (rowIdx < 0) {
    setNavDebug({
      phase: 'row',
      reason: 'row-not-visible-data-row',
      dataRowsLength: dataRows.length,
      entityName: tr?.dataset?.entityName || '',
      propName: keyCell?.dataset?.propName || '',
    });
    activeCell = null;
    rangeAnchorCell = null;
    if (dataRows.length > 0 && dataRows[0].children.length > 1) setActiveCell(dataRows[0].children[1]);
    return;
  }
  const cells = Array.from(tr.children);
  const colIdx = cells.indexOf(keyCell);
  const maxCol = cells.length - 2;
  const isLastRow = rowIdx === dataRows.length - 1;
  setNavDebug({
    phase: 'ready',
    rowIdx,
    colIdx,
    maxCol,
    isLastRow,
    dataRowsLength: dataRows.length,
    entityName: tr?.dataset?.entityName || '',
    propName: keyCell?.dataset?.propName || '',
  });

  if (_dbHandleCellEditorKey(e, colIdx, keyCell)) return;

  if (e.key === 'Escape' && _dbSelectedDataCells(table, true).length > 1) {
    e.preventDefault();
    _clearDbCellSelection(table);
    return;
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const selectedForDelete = _dbSelectedDataCells(table, true);
    if (selectedForDelete.length > 0) {
      e.preventDefault();
      _dbClearSelectedCells(table).catch(() => {
        if (typeof showStatus === 'function') showStatus('セルの削除に失敗しました', true);
      });
      return;
    }
  }

  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    _dbCopySelectedCells(table).catch(() => {
      if (typeof showStatus === 'function') showStatus('セルのコピーに失敗しました', true);
    });
    return;
  }

  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    _dbRecordCellPasteKeydownDebug('navigation', e, table, keyCell);
    const pastePromise = _dbPasteClipboardCells(table, keyCell);
    _dbRecordCellPasteKeydownDebug('navigation-dispatched', e, table, keyCell, {
      pastePromise: !!pastePromise,
    });
    pastePromise.catch((err) => {
      _dbRecordCellPasteKeydownDebug('navigation-error', e, table, keyCell, {
        error: err?.message || String(err || ''),
      });
      if (typeof showStatus === 'function') showStatus('セルの貼り付けに失敗しました', true);
    });
    return;
  }

  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    const first = _dbCellAt(table, 0, 0);
    const last = _dbCellAt(table, dataRows.length - 1, maxCol);
    if (first && last) {
      rangeAnchorCell = first;
      setActiveCell(last, { preserveRange: true });
      _markDbCellRange(table, first, last);
    }
    return;
  }

  if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const anchor = rangeAnchorCell || keyCell;
    rangeAnchorCell = anchor;
    let targetRow = rowIdx;
    let targetCol = colIdx;
    if (e.key === 'ArrowUp') targetRow = e.ctrlKey || e.metaKey ? 0 : rowIdx - 1;
    else if (e.key === 'ArrowDown') targetRow = e.ctrlKey || e.metaKey ? dataRows.length - 1 : rowIdx + 1;
    else if (e.key === 'ArrowLeft') targetCol = e.ctrlKey || e.metaKey ? 0 : colIdx - 1;
    else if (e.key === 'ArrowRight') targetCol = e.ctrlKey || e.metaKey ? maxCol : colIdx + 1;
    const targetCell = _dbCellAt(table, targetRow, targetCol);
    if (targetCell && !targetCell.classList.contains('col-add-prop-cell')) {
      setActiveCell(targetCell, { preserveRange: true });
      _markDbCellRange(table, anchor, targetCell);
    }
    return;
  }

  let nextRow = rowIdx, nextCol = colIdx;

  if (e.key === 'ArrowUp') {
    nextRow = Math.max(0, rowIdx - 1);
    e.preventDefault();
  }
  else if (e.key === 'ArrowDown') {
    if (isLastRow) {
      e.preventDefault();
      try {
        window.__meldexLastSheetNavDebug = {
          action: 'arrow-down-create',
          rowIdx,
          dataRowsLength: dataRows.length,
          entityName: tr?.dataset?.entityName || '',
          propName: keyCell?.dataset?.propName || '',
        };
      } catch {}
      triggerNewEntity(table, dataRows, colIdx);
      return;
    }
    nextRow = rowIdx + 1;
    e.preventDefault();
  }
  else if (e.key === 'ArrowLeft') { nextCol = Math.max(0, colIdx - 1); e.preventDefault(); }
  else if (e.key === 'ArrowRight') { nextCol = Math.min(maxCol, colIdx + 1); e.preventDefault(); }
  else if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      nextCol = colIdx - 1;
      if (nextCol < 0) { nextCol = maxCol; nextRow = rowIdx - 1; }
      nextRow = Math.max(0, nextRow);
    } else {
      nextCol = colIdx + 1;
      if (nextCol > maxCol) {
        if (isLastRow) { triggerNewEntity(table, dataRows, 1); return; }
        nextCol = 1; nextRow = rowIdx + 1;
      }
    }
    nextRow = Math.min(dataRows.length - 1, nextRow);
  }
  else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) return;
  else return;

  rangeAnchorCell = null;
  _clearDbCellRangeSelection(table);
  const targetRow = dataRows[nextRow];
  if (targetRow) {
    const targetCell = targetRow.children[nextCol];
    if (targetCell && !targetCell.classList.contains('col-add-prop-cell')) setActiveCell(targetCell);
  }
}, true);

// 新規エントリ追加（キーボード用）
async function triggerNewEntity(table, dataRows, focusCol) {
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(table, { dbPath: state.currentDbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const _db = (ctx && ctx.dbPath) || state.currentDbPath;
  if (!_db) return;
  const focusOwner = typeof _dbCurrentVisualActiveCell === 'function'
    ? _dbCurrentVisualActiveCell()
    : activeCell;
  const focusSeq = Number(focusOwner?.dataset?.dbActiveSeq || dbActiveCellSeq || 0);
  const focusOwnerKey = {
    entityName: focusOwner?.closest?.('tr')?.dataset?.entityName || '',
    propName: focusOwner?.dataset?.propName || '',
  };
  const shouldKeepCreateFocus = () => {
    const currentActive = typeof _dbCurrentVisualActiveCell === 'function'
      ? _dbCurrentVisualActiveCell()
      : activeCell;
    if (!currentActive?.isConnected) return false;
    const currentSeq = Number(currentActive?.dataset?.dbActiveSeq || 0);
    if (currentSeq > focusSeq && currentActive !== focusOwner) return false;
    if (focusOwner?.isConnected) return currentActive === focusOwner;
    return (currentActive.closest?.('tr')?.dataset?.entityName || '') === focusOwnerKey.entityName
      && (currentActive.dataset?.propName || '') === focusOwnerKey.propName;
  };
  const focusCreatedRow = (newRow, name, allowImmediate = false) => {
    if (!allowImmediate && !shouldKeepCreateFocus()) return;
    const col = focusCol || 0;
    const td = newRow.children[col];
    if (td) setActiveCell(td);
    if (col === 0 || !focusCol) {
      const label = newRow.querySelector('.entity-name-label');
      if (label) startEntityInlineRename(td || newRow.children[0], label, name, _db);
    }
  };
  if (typeof _dbCreateEntityOptimistic === 'function') {
    const visibleOrder = (Array.isArray(dataRows) ? dataRows : [])
      .map(row => row?.dataset?.entityName || '')
      .filter(Boolean);
    const created = _dbCreateEntityOptimistic(ctx, _db, { baseName: '無題', position: 'append', baselineOrder: visibleOrder });
    const immediateRow = typeof _dbFindEntityRow === 'function' ? _dbFindEntityRow(created.renderCtx || ctx, created.name) : null;
    if (immediateRow) focusCreatedRow(immediateRow, created.name, true);
    else _waitForEntityRow(created.renderCtx || ctx, created.name, (newRow) => focusCreatedRow(newRow, created.name));
    try {
      const saved = await created.promise;
      if (saved.name !== created.name && typeof _dbRenameOptimisticEntityLocally === 'function') {
        _dbRenameOptimisticEntityLocally(created.renderCtx || ctx, _db, created.name, saved.name);
      }
      if (typeof _dbScheduleEntityCreatePostSync === 'function') {
        _dbScheduleEntityCreatePostSync(_db, [{ name: saved.name, path: saved.path, response: saved.response }], created.renderCtx || ctx);
      }
    } catch (e) {
      // タイムアウト等でも作成済みのことがあるため、撤去前に確認する
      const recovered = typeof _dbRecoverEntityCreateAfterError === 'function'
        ? await _dbRecoverEntityCreateAfterError(created.renderCtx || ctx, _db, created)
        : null;
      if (recovered) {
        if (typeof showStatus === 'function') showStatus('エントリを追加しました');
      } else {
        if (typeof _dbRemoveCreatedEntitiesLocally === 'function') _dbRemoveCreatedEntitiesLocally(created.renderCtx || ctx, _db, [created.name]);
        if (typeof showStatus === 'function') showStatus('エントリ作成に失敗: ' + (e?.message || e), true);
      }
    }
    return;
  }
  const pivotData = (ctx && ctx.pivotData) || state.pivotData;
  const existing = pivotData ? Object.keys(pivotData.entities || {}) : [];
  try {
    const created = typeof _apiCreateEntityWithUniqueName === 'function'
      ? await _apiCreateEntityWithUniqueName(_db, existing)
      : null;
    const r = created?.response || await apiPost('/entity/create', { parent_path: _db, name: '無題' });
    const name = created?.name || '無題';
    const createdPath = created?.path || (r && (r.path || r.entry_path)) || `${_db}/${name}.md`;
    if (typeof _shouldRunFrontendAutoFillOnCreate !== 'function' || _shouldRunFrontendAutoFillOnCreate(r)) {
      try { await _autoFillOnCreate(_db, createdPath, {}); } catch {}
    }
    historyPush('エントリ追加: ' + name,
      async () => { await apiPost('/outliner/delete', { path: _entityPath(_db, name) }); await selectDatabase(_db, ctx); },
      async () => {
        const redo = await apiPost('/entity/create', { parent_path: _db, name });
        const redoPath = (redo && (redo.path || redo.entry_path)) || `${_db}/${name}.md`;
        if (typeof _shouldRunFrontendAutoFillOnCreate !== 'function' || _shouldRunFrontendAutoFillOnCreate(redo)) {
          try { await _autoFillOnCreate(_db, redoPath, {}); } catch {}
        }
        await selectDatabase(_db, ctx);
      },
      typeof _dbScopeForPath === 'function'
        ? _dbScopeForPath(_db)
        : (typeof _dbScope === 'function' ? _dbScope(_db) : 'db:' + String(_db).replace(/\\/g, '/'))
    );
    await selectDatabase(_db, ctx);
    // Step 2: チャンク分割中は新規行が遅れて DOM に出現する可能性があるため、待機
    const _ctxNew = ctx || ((typeof _currentPaneState === 'function') ? _currentPaneState() : null);
    const immediateRow = typeof _dbFindEntityRow === 'function' ? _dbFindEntityRow(_ctxNew, name) : null;
    if (immediateRow) focusCreatedRow(immediateRow, name, true);
    else _waitForEntityRow(_ctxNew, name, (newRow) => focusCreatedRow(newRow, name));
  } catch(e) { /* error shown */ }
}

// 新規プロパティ追加（キーボード用）
function triggerNewProperty(ctxOrDbPath) {
  const ctx = (typeof ctxOrDbPath === 'object' && ctxOrDbPath)
    ? ctxOrDbPath
    : (typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(activeCell, { dbPath: typeof ctxOrDbPath === 'string' ? ctxOrDbPath : state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  const dbPath = (typeof ctxOrDbPath === 'string' ? ctxOrDbPath : '') || (ctx && ctx.dbPath) || state.currentDbPath;
  if (!dbPath) return;
  const pivotData = (ctx && ctx.pivotData) || state.pivotData;
  const fallbackOrder = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(dbPath, pivotData?.properties || [])
    : [...(pivotData?.properties || [])];
  const order = getColOrder(dbPath, { ctx }) || fallbackOrder;
  // 新しい列の初期名は列タイプ名（この経路はテキスト列）
  const base = (typeof getPropertyTypeLabel === 'function' ? getPropertyTypeLabel('text') : '') || 'テキスト';
  let idx = 1, name = base;
  while (order.includes(name)) { idx++; name = base + idx; }
  order.push(name);
  setColOrder(dbPath, order, { skipHistory: true, ctx });
  setPropertyType(dbPath, name, { type: 'text' });
  renderPivot(ctx);
  setTimeout(() => {
    const _ctx2 = ctx || _currentPaneState();
    const th = _paneEl(_ctx2, '#' + (_ctx2.tableId || 'pivot-table') + ` thead th[data-prop="${name}"]`);
    // _ctx2 を渡さないと startHeaderInlineRename() が独自に ctx を再解決し、直前の
    // setColOrder/setPropertyType が使った ctx/dbPath と食い違う経路が生まれる
    // （embedded ctx を持つ埋め込みシートでは特に、メイン画面側へ誤爆しうる。2026-07-15 徹底チェックで発見）。
    if (th) startHeaderInlineRename(th, name, dbPath, _ctx2);
  }, 30);
}

// 列リサイズ
