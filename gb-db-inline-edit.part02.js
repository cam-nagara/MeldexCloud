      o.value = opt.key;
      o.textContent = opt.label;
      if (opt.key === countType) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => { setCountType(dbPath, propName, sel.value); renderPivot(ctx); };
    wrapper.appendChild(sel);

    if (countType !== 'none') {
      const span = document.createElement('span');
      span.textContent = result;
      wrapper.appendChild(span);
    }
    td.appendChild(wrapper);
    tr.appendChild(td);
  });
  // ＋プロパティ列の空セル
  const tdAddFoot = document.createElement('td');
  tdAddFoot.className = 'col-add-prop-cell';
  tdAddFoot.setAttribute('role', 'cell');
  tr.appendChild(tdAddFoot);
  tfoot.appendChild(tr);
}

function calcColumnCount(propName, entitiesMap, entityNames, type, ptc, propTypes) {
  if (type === 'none') return '';
  let count = 0, uniqueSet = new Set(), empty = 0, notEmpty = 0;
  entityNames.forEach(en => {
    // 数式プロパティの場合、計算結果で集計
    if (ptc && ptc.type === 'formula' && ptc.formula) {
      const result = formulaEvalForEntity(ptc.formula, entitiesMap[en], { propTypes });
      const v = result.error ? '' : String(result.value);
      if (!v || v === '') empty++;
      else { notEmpty++; count++; uniqueSet.add(v); }
    } else {
      const vals = filterValues(entitiesMap[en][propName] || []);
      if (vals.length === 0) empty++;
      else { notEmpty++; vals.forEach(v => { count++; uniqueSet.add(v.value); }); }
    }
  });
  switch (type) {
    case 'count': return count;
    case 'unique': return uniqueSet.size;
    case 'empty': return empty;
    case 'not_empty': return notEmpty;
    default: return '';
  }
}

// アクティブセル管理
let activeCell = null;
let rangeAnchorCell = null;

function _scrollDbActiveCellIntoView(td) {
  if (!td) return;
  const table = td.closest?.('table');
  const scroller = td.closest?.('.pivot-view, #pivot-view') || table?.closest?.('.pivot-view, #pivot-view')
    || (typeof _getDbViewScrollContainer === 'function' ? _getDbViewScrollContainer(null, 'pivot') : null);
  if (!scroller) {
    td.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return;
  }
  const cellRect = td.getBoundingClientRect?.();
  const scrollRect = scroller.getBoundingClientRect?.();
  if (!cellRect || !scrollRect || cellRect.width <= 0 || cellRect.height <= 0) return;
  const headerRect = table?.querySelector?.('thead')?.getBoundingClientRect?.();
  const headerHeight = headerRect && headerRect.bottom > scrollRect.top && headerRect.top < scrollRect.bottom
    ? Math.max(0, headerRect.height)
    : 0;
  const cellIndex = td.parentElement ? Array.from(td.parentElement.children).indexOf(td) : -1;
  const entityPinned = !!table && !table.classList.contains('entity-col-unpinned');
  const entityRect = entityPinned && cellIndex > 0
    ? table.querySelector('tbody tr:not(.group-header-row):not(.new-entity-row) td.col-entity')?.getBoundingClientRect?.()
    : null;
  const pad = 4;
  const topLimit = scrollRect.top + headerHeight + pad;
  const bottomLimit = scrollRect.bottom - pad;
  const leftLimit = scrollRect.left + (entityRect?.width || 0) + pad;
  const rightLimit = scrollRect.right - pad;
  let deltaTop = 0;
  let deltaLeft = 0;
  if (cellRect.top < topLimit) deltaTop = cellRect.top - topLimit;
  else if (cellRect.bottom > bottomLimit) deltaTop = cellRect.bottom - bottomLimit;
  if (cellRect.left < leftLimit) deltaLeft = cellRect.left - leftLimit;
  else if (cellRect.right > rightLimit) deltaLeft = cellRect.right - rightLimit;
  if (deltaTop) scroller.scrollTop += deltaTop;
  if (deltaLeft) scroller.scrollLeft += deltaLeft;
}

function _scheduleDbActiveCellScroll(td) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => _scrollDbActiveCellIntoView(td));
  } else {
    setTimeout(() => _scrollDbActiveCellIntoView(td), 0);
  }
}

function _clearDbCellRangeSelection(table) {
  (table || document).querySelectorAll('.db-range-selected').forEach(cell => {
    cell.classList.remove('db-range-selected');
    cell.removeAttribute('aria-selected');
  });
}

function _dbCellCoords(table, td) {
  if (!table || !td) return null;
  const rows = Array.from(table.querySelectorAll('tbody tr:not(.group-header-row):not(.new-entity-row)'));
  const tr = td.parentElement;
  const row = rows.indexOf(tr);
  const col = tr ? Array.from(tr.children).indexOf(td) : -1;
  if (row < 0 || col < 0) return null;
  return { row, col, rows };
}

function _dbCellAt(table, rowIdx, colIdx) {
  const rows = Array.from(table.querySelectorAll('tbody tr:not(.group-header-row):not(.new-entity-row)'));
  const row = rows[Math.max(0, Math.min(rows.length - 1, rowIdx))];
  if (!row) return null;
  const maxCol = row.children.length - 2;
  return row.children[Math.max(0, Math.min(maxCol, colIdx))] || null;
}

function _markDbCellRange(table, anchor, target) {
  if (!table || !anchor || !target) return;
  const a = _dbCellCoords(table, anchor);
  const b = _dbCellCoords(table, target);
  if (!a || !b) return;
  _clearDbCellRangeSelection(table);
  const [rowStart, rowEnd] = a.row < b.row ? [a.row, b.row] : [b.row, a.row];
  const [colStart, colEnd] = a.col < b.col ? [a.col, b.col] : [b.col, a.col];
  for (let r = rowStart; r <= rowEnd; r += 1) {
    const tr = a.rows[r];
    if (!tr) continue;
    const maxCol = tr.children.length - 2;
    for (let c = colStart; c <= Math.min(colEnd, maxCol); c += 1) {
      const cell = tr.children[c];
      if (!cell || cell.classList.contains('col-add-prop-cell')) continue;
      cell.classList.add('db-range-selected');
      cell.setAttribute('aria-selected', 'true');
    }
  }
}

function setActiveCell(td, options = {}) {
  const table = td?.closest?.('table') || activeCell?.closest?.('table') || null;
  if (!options.preserveRange) {
    _clearDbCellRangeSelection(table);
    rangeAnchorCell = null;
  }
  if (activeCell) {
    activeCell.classList.remove('active-cell');
    activeCell.tabIndex = -1;
  }
  activeCell = td;
  if (td) {
    td.classList.add('active-cell');
    td.tabIndex = 0;
    td.focus?.({ preventScroll: true });
    if (options.scroll !== false) {
      _scrollDbActiveCellIntoView(td);
      _scheduleDbActiveCellScroll(td);
    }
  }
}

// テーブルキーボードナビゲーション
// 離散ショートカット（Ctrl+Enter, Ctrl+Shift+Enter, Enter, F2等）→ gb-shortcuts.js に移行済み
// 矢印キー・Tab・文字入力のセルナビゲーションのみ残存
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (state.view !== 'pivot') return;
  // ドロップダウンやメニューが開いている場合はそちらのキーナビに任せる
  if (document.querySelector('.status-dropdown, .cell-inline-dd, .user-dropdown, .gb-context-menu')) return;
  const ae = document.activeElement;
  const isEditing = ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
  if (isEditing) return;
  if (e.isComposing || e.keyCode === 229) return;

  let table = activeCell?.closest?.('table') || _currentPivotTable();
  if (table && !table.isConnected) table = _currentPivotTable();
  if (!table) return;
  let dataRows = Array.from(table.querySelectorAll('tbody tr:not(.new-entity-row):not(.group-header-row)'));

  if (!activeCell) {
    if (dataRows.length > 0 && dataRows[0].children.length > 1) {
      setActiveCell(dataRows[0].children[1]);
    }
    return;
  }

  const tr = activeCell.parentElement;
  const rowIdx = dataRows.indexOf(tr);
  if (rowIdx < 0) {
    activeCell = null;
    rangeAnchorCell = null;
    if (dataRows.length > 0 && dataRows[0].children.length > 1) setActiveCell(dataRows[0].children[1]);
    return;
  }
  const cells = Array.from(tr.children);
  const colIdx = cells.indexOf(activeCell);
  const maxCol = cells.length - 2;
  const isLastRow = rowIdx === dataRows.length - 1;

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
    const anchor = rangeAnchorCell || activeCell;
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
  else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // 文字キー入力 → 空セルでインライン入力開始
    if (colIdx > 0) {
      const hasValue = activeCell.querySelector('.value-text');
      if (!hasValue) {
        const thAll = Array.from(table.querySelectorAll('thead th'));
        const entityName = dataRows[rowIdx]?.querySelector('.entity-name-label')?.textContent;
        const propName = thAll[colIdx]?.dataset?.prop;
        const ctx = typeof _dbPaneContextFromEvent === 'function'
          ? _dbPaneContextFromEvent(activeCell, { dbPath: state.currentDbPath })
          : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
        const dbPath = (ctx && ctx.dbPath) || state.currentDbPath;
        if (entityName && propName && dbPath) {
          e.preventDefault();
          startCellInlineAdd(activeCell, _entityPath(dbPath, entityName), entityName, propName);
          setTimeout(() => {
            const inp = activeCell.querySelector('.cell-inline-input');
            if (inp) inp.value = e.key;
          }, 10);
        }
      }
    }
    return;
  }
  else return;

  rangeAnchorCell = null;
  _clearDbCellRangeSelection(table);
  const targetRow = dataRows[nextRow];
  if (targetRow) {
    const targetCell = targetRow.children[nextCol];
    if (targetCell && !targetCell.classList.contains('col-add-prop-cell')) setActiveCell(targetCell);
  }
});

// 新規エントリ追加（キーボード用）
async function triggerNewEntity(table, dataRows, focusCol) {
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(table, { dbPath: state.currentDbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const pivotData = (ctx && ctx.pivotData) || state.pivotData;
  const existing = pivotData ? Object.keys(pivotData.entities || {}) : [];
  const _db = (ctx && ctx.dbPath) || state.currentDbPath;
  if (!_db) return;
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
        : (typeof _dbScope === 'function' ? _dbScope() : 'db:' + String(_db).replace(/\\/g, '/'))
    );
    await selectDatabase(_db, ctx);
    // Step 2: チャンク分割中は新規行が遅れて DOM に出現する可能性があるため、待機
    const _ctxNew = ctx || ((typeof _currentPaneState === 'function') ? _currentPaneState() : null);
    _waitForEntityRow(_ctxNew, name, (newRow) => {
      const col = focusCol || 0;
      const td = newRow.children[col];
      if (td) setActiveCell(td);
      if (col === 0 || !focusCol) {
        const label = newRow.querySelector('.entity-name-label');
        if (label) startEntityInlineRename(td || newRow.children[0], label, name, _db);
      }
    });
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
  const order = getColOrder(dbPath) || [...(pivotData?.properties || [])];
  let idx = 1, name = 'プロパティ';
  while (order.includes(name)) { idx++; name = 'プロパティ' + idx; }
  order.push(name);
  setColOrder(dbPath, order, { skipHistory: true });
  setPropertyType(dbPath, name, { type: 'text' });
  renderPivot(ctx);
  setTimeout(() => {
    const _ctx2 = ctx || _currentPaneState();
    const th = _paneEl(_ctx2, '#' + (_ctx2.tableId || 'pivot-table') + ` thead th[data-prop="${name}"]`);
    if (th) startHeaderInlineRename(th, name, dbPath);
  }, 30);
}

// 列リサイズ
function startColResize(e, th, colIndex, propName) {
  e.preventDefault();
  e.stopPropagation();
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(th, { dbPath: state.currentDbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath;
  const table = th?.closest?.('table') || _currentPivotTable(ctx);
  const startX = e.clientX;
  const startW = th.offsetWidth;

  const handle = e.target;
  handle.classList.add('active');

  const onMove = (e2) => {
    const w = Math.max(60, startW + e2.clientX - startX);
    th.style.width = w + 'px';
    th.style.minWidth = w + 'px';
    setColWidth(colIndex, w, table);
  };
  const onUp = () => {
    handle.classList.remove('active');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    // 幅を永続化
    if (propName && dbPath) {
      setColWidthPersist(dbPath, propName, th.offsetWidth, {
        label: 'シート表示: 列幅',
        detail: propName,
      });
    }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function setColWidth(colIndex, width, table) {
  // tbody内の同じ列のセルにも幅を反映
  table = table || _currentPivotTable();
  if (!table) return;
  table.querySelectorAll('tbody tr').forEach(tr => {
    const td = tr.children[colIndex];
    if (td) { td.style.width = width + 'px'; td.style.minWidth = width + 'px'; }
  });
}

function _showBulkColumnWidthModal(propName, ctxOrDbPath) {
  const ctx = (typeof ctxOrDbPath === 'object' && ctxOrDbPath)
    ? ctxOrDbPath
    : (typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(activeCell, { dbPath: typeof ctxOrDbPath === 'string' ? ctxOrDbPath : state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  const dbPath = (typeof ctxOrDbPath === 'string' ? ctxOrDbPath : '') || (ctx && ctx.dbPath) || state.currentDbPath;
  if (!dbPath) return;
  let targets = _getSelectedColumns(dbPath);
  if (!targets.length || !targets.includes(propName)) {
    targets = [propName];
    _setSelectedColumns(dbPath, targets, propName);
  }
  const widths = getColWidths(dbPath);
  const firstWidth = Number(widths[targets[0]] || 100);
  const sameWidth = targets.every(name => Number(widths[name] || 100) === firstWidth);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:360px;">
    <h3>列幅を指定</h3>
    <div style="margin:8px 0;color:var(--fg2);font-size:12px;line-height:1.6;">対象: ${targets.map(name => esc(name)).join(' / ')}</div>
    <div class="field">
      <label>幅 (px)</label>
      <input id="bulk-col-width-input" type="number" min="60" step="1" value="${sameWidth ? firstWidth : ''}" placeholder="${sameWidth ? '' : '現在は列ごとに異なります'}" style="width:100%;padding:6px 8px;">
    </div>
    <div class="btn-row" style="margin-top:12px;">
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" id="bulk-col-width-apply">適用</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#bulk-col-width-apply')?.addEventListener('click', () => {
    const input = overlay.querySelector('#bulk-col-width-input');
    const raw = (input?.value || '').trim();
    const parsed = parseInt(raw, 10);
    if (!raw || Number.isNaN(parsed)) {
      showStatus('幅を入力してください', true);
      return;
    }
    const value = Math.max(60, parsed);
    const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
    targets.forEach(name => setColWidthPersist(dbPath, name, value, { skipHistory: true }));
    if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
      pushDbViewConfigHistory(dbPath, 'シート表示: 列幅', before, captureDbViewConfigHistory(dbPath), targets.join(' / '));
    }
    overlay.remove();
    renderPivot(ctx);
  });
  setTimeout(() => overlay.querySelector('#bulk-col-width-input')?.focus(), 30);
}

/* DB Undo/Redo ヘルパー（scope = 'db:' + dbPath で開いているDB単位） */
