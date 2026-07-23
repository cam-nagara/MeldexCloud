
// 列をインラインで挿入（ダイアログなし）
// typeConfig を渡すとその列タイプで作成する（未指定なら従来どおりテキスト列）
function insertPropertyInline(refProp, direction, ctxOrDbPath, typeConfig) {
  const ctx = (typeof ctxOrDbPath === 'object' && ctxOrDbPath)
    ? ctxOrDbPath
    : (typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(null, { dbPath: typeof ctxOrDbPath === 'string' ? ctxOrDbPath : state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  const dbPath = (typeof ctxOrDbPath === 'string' ? ctxOrDbPath : '') || (ctx && ctx.dbPath) || state.currentDbPath;
  if (!dbPath) return;
  const pivotData = (ctx && ctx.pivotData) || state.pivotData;
  const fallbackOrder = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(dbPath, pivotData?.properties || [])
    : [...(pivotData?.properties || [])];
  const order = getColOrder(dbPath, { ctx }) || fallbackOrder;
  // 新しい列の初期名は選んだ列タイプ名にする（型未指定はテキスト）。
  const _newColType = (typeConfig && typeof typeConfig === 'object' && typeConfig.type) ? typeConfig.type : 'text';
  const base = (typeof getPropertyTypeLabel === 'function' ? getPropertyTypeLabel(_newColType) : '') || 'テキスト';
  let idx = 1, name = base;
  while (order.includes(name)) { idx++; name = base + idx; }
  const refIdx = order.indexOf(refProp);
  if (refIdx >= 0) {
    const insertIdx = direction === 'left' ? refIdx : refIdx + 1;
    order.splice(insertIdx, 0, name);
  } else {
    order.push(name);
  }
  setColOrder(dbPath, order, { skipHistory: true, ctx });
  setPropertyType(dbPath, name, (typeConfig && typeof typeConfig === 'object') ? typeConfig : { type: 'text' });
  renderPivot(ctx);
  // 挿入後にヘッダーをインラインリネームモードに
  setTimeout(() => {
    const _ctx = ctx || _currentPaneState();
    const th = _paneEl(_ctx, '#' + (_ctx.tableId || 'pivot-table') + ` thead th[data-prop="${name}"]`);
    // _ctx を渡さないと startHeaderInlineRename() が _dbPaneContextFromEvent() で再解決し、
    // 埋め込みシート（グローバル _panes レジストリ未登録）の場合はメイン画面側の別ペインへ
    // 誤って解決され得る（showColHeaderMenu 系と同根。2026-07-15 徹底チェックで発見）。
    if (th) startHeaderInlineRename(th, name, dbPath, _ctx);
  }, 30);
}

// エントリのメインステータスを判定（最も優先度の高いステータス）
function getEntityMainStatus(entityData) {
  const order = ['掲載済み', '採用', '案', 'ボツ'];
  let best = 'ボツ';
  for (const propVals of Object.values(entityData)) {
    if (!Array.isArray(propVals)) continue;
    for (const v of propVals) {
      const idx = order.indexOf(v.status);
      if (idx >= 0 && idx < order.indexOf(best)) best = v.status;
    }
  }
  return best;
}

// 複数条件フィルタ適用
function applyAdvancedFilters(values, propName, filters) {
  const propFilters = filters.filter(f => f.property === propName || f.property === '*');
  if (propFilters.length === 0) return values;
  return values.filter(v => {
    return propFilters.every(f => {
      const target = f.field === 'status' ? v.status : v.value;
      switch (f.operator) {
        case 'equals': return target === f.value;
        case 'not_equals': return target !== f.value;
        case 'contains': return target && target.includes(f.value);
        case 'not_contains': return !target || !target.includes(f.value);
        case 'empty': return !target || target.trim() === '';
        case 'not_empty': return target && target.trim() !== '';
        default: return true;
      }
    });
  });
}

// フッター集計行
function _closePivotAggregationDropdowns() {
  document.querySelectorAll('.count-type-select[aria-expanded="true"]').forEach(el => {
    el.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('.count-type-dropdown').forEach(el => el.remove());
}

function _pivotAggregationLabel(aggTypes, key) {
  return (aggTypes || []).find(opt => opt.key === key)?.label || '-';
}

function _openPivotAggregationDropdown(anchor, aggTypes, currentKey, onSelect) {
  if (!anchor || !Array.isArray(aggTypes)) return;
  closeAllDropdowns();
  _closePivotAggregationDropdowns();
  const dd = document.createElement('div');
  dd.className = 'status-dropdown count-type-dropdown';
  dd.setAttribute('role', 'listbox');
  dd.setAttribute('aria-label', '集計タイプ');

  aggTypes.forEach(opt => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'status-dropdown-item count-type-dropdown-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', opt.key === currentKey ? 'true' : 'false');
    item.textContent = opt.label;
    if (opt.key === currentKey) item.classList.add('selected');
    item.addEventListener('click', () => {
      _closePivotAggregationDropdowns();
      if (typeof onSelect === 'function') onSelect(opt.key);
      anchor.focus?.();
    });
    dd.appendChild(item);
  });

  document.body.appendChild(dd);
  if (typeof positionPopup === 'function') {
    positionPopup(dd, anchor.getBoundingClientRect(), { prefer: 'above', gap: 2 });
  } else {
    const rect = anchor.getBoundingClientRect();
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    dd.style.position = 'fixed';
    dd.style.left = (rect.left / z) + 'px';
    dd.style.top = (rect.top / z - dd.offsetHeight - 2) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(dd);
  }
  if (typeof _enableDropdownKeyNav === 'function') _enableDropdownKeyNav(dd, '.count-type-dropdown-item');

  setTimeout(() => {
    const closer = (e) => {
      if (dd.contains(e.target) || anchor.contains?.(e.target)) return;
      _closePivotAggregationDropdowns();
      document.removeEventListener('pointerdown', closer);
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function renderPivotFooter(visibleProps, entitiesMap, entityNames, pinnedCols, savedWidths, propTypes, ctx) {
  ctx = ctx || _currentPaneState();
  const _ftblId = ctx.tableId || 'pivot-table';
  const tfoot = _paneEl(ctx, '#' + _ftblId + ' tfoot');
  if (!tfoot) return;
  tfoot.innerHTML = '';
  const dbPath = ctx.dbPath || state.currentDbPath;
  const filterMode = ctx.filter ?? state.filter ?? 'disabled';
  const countTypes = getCountTypes(dbPath, { ctx });

  // フッター表示トグル（localStorageで管理）
  const showFooter = typeof getShowFooter === 'function' ? getShowFooter(dbPath, { ctx }) : (getDbViewConfig(dbPath).showFooter || false);
  if (!showFooter) return;

  const tr = document.createElement('tr');
  tr.setAttribute('role', 'row');
  const tdLabel = document.createElement('td');
  tdLabel.className = 'col-entity';
  tdLabel.setAttribute('role', 'rowheader');
  tdLabel.setAttribute('aria-label', '集計');
  tdLabel.textContent = '集計';
  tdLabel.style.fontStyle = 'italic';
  const _footerEntW = (savedWidths && savedWidths['__entity__']) || 120;
  tdLabel.style.width = _footerEntW + 'px';
  tdLabel.style.minWidth = _footerEntW + 'px';
  tr.appendChild(tdLabel);

  let pLeftOffset = _footerEntW;
  visibleProps.forEach(propName => {
    const td = document.createElement('td');
    td.setAttribute('role', 'cell');
    td.setAttribute('aria-label', `集計 / ${propName}`);
    if (pinnedCols.includes(propName)) {
      td.classList.add('col-pinned');
      td.style.left = pLeftOffset + 'px';
      pLeftOffset += (savedWidths[propName] || 100);
    }

    const countType = countTypes[propName] || 'none';
    const fPtc = propTypes?.[propName];
    // 拡張集計エンジン使用（gb-db-aggregate.js）
    const resolvedType = fPtc?.type || (typeof inferPropertyType === 'function' ? inferPropertyType(propName, entitiesMap, entityNames, filterMode) : 'text');
    const needsAsyncAggregation = fPtc?.type === 'rollup' && typeof calcAggregationAsync === 'function';
    const result = needsAsyncAggregation ? '計算中...' : (typeof calcAggregation === 'function'
      ? calcAggregation(propName, entitiesMap, entityNames, countType, fPtc, propTypes, filterMode)
      : calcColumnCount(propName, entitiesMap, entityNames, countType, fPtc, propTypes, filterMode));

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:4px;';
    // 型に応じた集計タイプ一覧を取得
    const aggTypes = typeof getAggregationTypesForProperty === 'function'
      ? getAggregationTypesForProperty(resolvedType)
      : [{key:'none',label:'-'},{key:'count',label:'件数'},{key:'unique',label:'ユニーク'},{key:'empty',label:'空'},{key:'not_empty',label:'非空'}];
    const sel = document.createElement('button');
    sel.type = 'button';
    sel.className = 'count-type-select';
    sel.setAttribute('aria-haspopup', 'listbox');
    sel.setAttribute('aria-expanded', 'false');
    sel.setAttribute('aria-label', `集計タイプ / ${propName}`);
    sel.textContent = _pivotAggregationLabel(aggTypes, countType);
    sel.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sel.setAttribute('aria-expanded', 'true');
      _openPivotAggregationDropdown(sel, aggTypes, countType, (nextType) => {
        sel.setAttribute('aria-expanded', 'false');
        setCountType(dbPath, propName, nextType, { ctx });
        renderPivot(ctx);
      });
    });
    wrapper.appendChild(sel);

    if (countType !== 'none') {
      const span = document.createElement('span');
      span.textContent = result;
      wrapper.appendChild(span);
      if (needsAsyncAggregation) {
        calcAggregationAsync(propName, entitiesMap, entityNames, countType, fPtc, propTypes, filterMode, { dbPath, sourceDbPath: dbPath })
          .then(value => { if (span.isConnected) span.textContent = value; })
          .catch(() => { if (span.isConnected) span.textContent = '-'; });
      }
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

function calcColumnCount(propName, entitiesMap, entityNames, type, ptc, propTypes, filterMode) {
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
      const vals = filterValues(entitiesMap[en][propName] || [], undefined, filterMode);
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
let dbCellClipboard = null;
let dbCellClipboardAt = 0;
const DB_CELL_INTERNAL_CLIPBOARD_TTL_MS = 30 * 60 * 1000;
let dbCellBulkBarRaf = 0;
let dbActiveCellSeq = 0;

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
    ? table.querySelector('tbody tr:not(.group-header-row):not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row) td.col-entity')?.getBoundingClientRect?.()
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
  const tr = td.parentElement;
  let rows = Array.from(table.querySelectorAll('tbody tr:not(.group-header-row):not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row)'));
  const virtualRows = typeof _dbVirtualStateForTable === 'function' ? _dbVirtualStateForTable(table) : null;
  if (virtualRows) {
    const rowByName = new Map(rows.map(rowEl => [rowEl.dataset.entityName || '', rowEl]));
    rows = (virtualRows.entityNames || []).map(name => rowByName.get(name) || null);
  }
  const row = virtualRows && tr?.dataset?.entityName
    ? virtualRows.entityNames.indexOf(tr.dataset.entityName)
    : rows.indexOf(tr);
  const col = tr ? Array.from(tr.children).indexOf(td) : -1;
  if (row < 0 || col < 0) return null;
  return { row, col, rows };
}

function _dbCellAt(table, rowIdx, colIdx) {
  const rows = Array.from(table.querySelectorAll('tbody tr:not(.group-header-row):not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row)'));
  const virtualRows = typeof _dbVirtualStateForTable === 'function' ? _dbVirtualStateForTable(table) : null;
  if (virtualRows) {
    const entityName = virtualRows.entityNames?.[rowIdx];
    if (!entityName) return null;
    const cssName = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(entityName)
      : String(entityName).replace(/["\\]/g, '\\$&');
    const row = table.querySelector(`tbody tr[data-entity-name="${cssName}"]`);
    if (!row) {
      if (typeof _dbRequestVirtualCellReveal === 'function') _dbRequestVirtualCellReveal(table, rowIdx, colIdx);
      return null;
    }
    const maxCol = row.children.length - 2;
    if (colIdx < 0 || colIdx > maxCol) return null;
    return row.children[colIdx] || null;
  }
  if (rowIdx < 0 || rowIdx >= rows.length) return null;
  const row = rows[rowIdx];
  if (!row) return null;
  const maxCol = row.children.length - 2;
  if (colIdx < 0 || colIdx > maxCol) return null;
  return row.children[colIdx] || null;
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
  _scheduleDbCellBulkBarUpdate(table);
}

function _setDbCellRangeSelected(cell, selected) {
  if (!cell || cell.classList.contains('col-add-prop-cell')) return;
  cell.classList.toggle('db-range-selected', !!selected);
  if (selected) cell.setAttribute('aria-selected', 'true');
  else cell.removeAttribute('aria-selected');
  _scheduleDbCellBulkBarUpdate(cell.closest('table'));
}

function _dbSelectedDataCells(table, includeActive = true) {
  const cells = Array.from((table || document).querySelectorAll('tbody td.db-range-selected[data-prop-name]'));
  if (includeActive && activeCell?.dataset?.propName && activeCell.closest('table') === table && !cells.includes(activeCell)) {
    cells.push(activeCell);
  }
  cells.sort((a, b) => {
    const ca = _dbCellCoords(table, a);
    const cb = _dbCellCoords(table, b);
    if (!ca || !cb) return 0;
    return ca.row === cb.row ? ca.col - cb.col : ca.row - cb.row;
  });
  return cells;
}

function _dbCellBulkPaneId(table) {
  const ctx = _dbContextForCell(activeCell || table);
  return (ctx && ctx.paneId) || table?.closest?.('[data-pane-id]')?.dataset?.paneId || 'main';
}

function _dbCellBulkBarsFor(table) {
  const paneId = _dbCellBulkPaneId(table);
  return Array.from(document.querySelectorAll(`.db-cell-bulk-bar[data-pane-id="${paneId}"]`));
}

function _hideDbCellBulkBar(table) {
  _dbCellBulkBarsFor(table).forEach(bar => bar.remove());
}

function _clearDbCellSelection(table) {
  _clearDbCellRangeSelection(table);
  rangeAnchorCell = null;
  if (activeCell) {
    activeCell.classList.remove('active-cell');
    activeCell.tabIndex = -1;
  }
  activeCell = null;
  _hideDbCellBulkBar(table);
}

function _dbHasInternalCellClipboard() {
  return !!(dbCellClipboard && Array.isArray(dbCellClipboard.cells)
    && dbCellClipboard.cells.length
    && Date.now() - dbCellClipboardAt < DB_CELL_INTERNAL_CLIPBOARD_TTL_MS);
}

function _dbCellBulkPaneHostFrom(el) {
  const host = el?.closest?.('.gb-pane-content,.pane-content,[data-pane-id]');
  if (!host) return null;
  if (!host.matches?.('#pivot-view,.pivot-view')) return host;
  return host.parentElement?.closest?.('.gb-pane-content,.pane-content,[data-pane-id]') || null;
}

function _dbCellBulkHost(table) {
  const ctx = _dbContextForCell(table) || _dbContextForCell(activeCell);
  const ctxHost = _dbCellBulkPaneHostFrom(ctx?.containerEl);
  if (ctxHost) return ctxHost;
  const paneHost = _dbCellBulkPaneHostFrom(table);
  if (paneHost) return paneHost;
  const pivotHost = table?.closest?.('#pivot-view,.pivot-view');
  const pivotPaneHost = _dbCellBulkPaneHostFrom(pivotHost?.parentElement);
  if (pivotPaneHost) return pivotPaneHost;
  return table?.closest?.('#main-views')
    || document.getElementById('main-views')
    || document.body;
}

function _dbBulkPasteStartCell(table) {
  const selected = _dbSelectedDataCells(table, false);
  if (selected.length > 0) return selected[0];
  const visual = _dbCurrentVisualActiveCell();
  if (visual?.dataset?.propName && table?.contains?.(visual)) return visual;
  return activeCell?.dataset?.propName && table?.contains?.(activeCell) ? activeCell : null;
}

function _updateDbCellBulkBar(table) {
  const targetTable = table || activeCell?.closest?.('table') || (typeof _currentPivotTable === 'function' ? _currentPivotTable() : null);
  if (!targetTable || !targetTable.isConnected) {
    _hideDbCellBulkBar(targetTable);
    return;
  }
  const selected = _dbSelectedDataCells(targetTable, true);
  if (selected.length <= 1) {
    _hideDbCellBulkBar(targetTable);
    return;
  }

  const paneId = _dbCellBulkPaneId(targetTable);
  const host = _dbCellBulkHost(targetTable);
  let bar = document.querySelector(`.db-cell-bulk-bar[data-pane-id="${paneId}"]`);
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'db-cell-bulk-bar gb-selection-float-bar';
    bar.dataset.paneId = paneId;
    bar.dataset.selectionFloatPaneId = paneId;
    bar.dataset.e2eId = 'db-cell-bulk-bar-' + paneId;
    bar.addEventListener('pointerdown', event => event.stopPropagation());
    (host || document.body).appendChild(bar);
  }
  if (window.GBSelectionFloatMenu) {
    window.GBSelectionFloatMenu.bindDrag(bar, { host });
    window.GBSelectionFloatMenu.resetPosition(bar, { host, anchor: targetTable, zIndex: '510' });
  }
  bar.innerHTML = '';
  if (window.GBSelectionFloatMenu) {
    bar.appendChild(window.GBSelectionFloatMenu.createDragHandle());
  }

  const label = document.createElement('span');
  label.className = 'db-cell-bulk-count gb-selection-float-count';
  label.textContent = selected.length + ' セル選択中';
  bar.appendChild(label);

  const makeButton = (labelText, e2eId, onClick, options = {}) => {
    const btn = window.GBSelectionFloatMenu
      ? window.GBSelectionFloatMenu.button(labelText, {
          e2eId: e2eId + '-' + paneId,
          danger: options.danger,
          muted: options.muted,
          onClick,
        })
      : document.createElement('button');
    if (!window.GBSelectionFloatMenu) {
      btn.type = 'button';
      btn.textContent = labelText;
      btn.dataset.e2eId = e2eId + '-' + paneId;
      btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
    }
    bar.appendChild(btn);
    return btn;
  };

  makeButton('コピー', 'db-cell-bulk-copy', () => {
    _dbCopySelectedCells(targetTable).catch(() => {
      if (typeof showStatus === 'function') showStatus('セルのコピーに失敗しました', true);
    });
  });
  makeButton('貼り付け', 'db-cell-bulk-paste', () => {
    _dbPasteClipboardCells(targetTable, _dbBulkPasteStartCell(targetTable)).catch(() => {
      if (typeof showStatus === 'function') showStatus('セルの貼り付けに失敗しました', true);
    });
  });
  makeButton('削除', 'db-cell-bulk-delete', () => {
    _dbClearSelectedCells(targetTable).catch(() => {
      if (typeof showStatus === 'function') showStatus('セルの削除に失敗しました', true);
    });
  }, { danger: true });
  makeButton('選択解除', 'db-cell-bulk-clear', () => _clearDbCellSelection(targetTable), { muted: true });
}

function _scheduleDbCellBulkBarUpdate(table) {
  if (table && table.isConnected) _updateDbCellBulkBar(table);
  if (dbCellBulkBarRaf) cancelAnimationFrame(dbCellBulkBarRaf);
  dbCellBulkBarRaf = requestAnimationFrame(() => {
    dbCellBulkBarRaf = 0;
    _updateDbCellBulkBar(table);
  });
}

function selectDbCellFromPointer(td, event) {
  const table = td?.closest?.('table');
  if (!table || !td?.dataset?.propName) return;
  if (event?.shiftKey || event?.ctrlKey || event?.metaKey) {
    _dbCloseTransientUiForCellRangeSelection();
  }
  if (event?.shiftKey) {
    const anchor = rangeAnchorCell || activeCell || td;
    rangeAnchorCell = anchor;
    setActiveCell(td, { preserveRange: true });
    _markDbCellRange(table, anchor, td);
    return;
  }
  if (event?.ctrlKey || event?.metaKey) {
    const previousActive = activeCell && activeCell.closest?.('table') === table ? activeCell : null;
    const wasSelected = td.classList.contains('db-range-selected');
    if (previousActive && previousActive !== td && previousActive.dataset?.propName) {
      _setDbCellRangeSelected(previousActive, true);
    }
    if (!rangeAnchorCell) rangeAnchorCell = activeCell || td;
    setActiveCell(td, { preserveRange: true });
    _setDbCellRangeSelected(td, previousActive === td ? !wasSelected : true);
    return;
  }
  setActiveCell(td);
}

function _dbPointerDataCell(event) {
  const target = event?.target;
  if (!target || typeof target.closest !== 'function') return null;
  const td = target.closest('td[data-prop-name]');
  if (!td || !td.isConnected) return null;
  if (td.closest('tr.new-entity-row, tr.new-entity-spacer-row, tr.group-header-row')) return null;
  if (target.closest('.status-dot,.cell-checkbox,.chat-prop-cell,.db-action-btn,.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-editor')) return null;
  return td;
}

document.addEventListener('pointerdown', (event) => {
  if (event.defaultPrevented || event._dbCellPointerHandled) return;
  const td = _dbPointerDataCell(event);
  if (!td) return;
  event._dbCellPointerHandled = true;
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    td._dbModifierPointerSelectionHandledUntil = Date.now() + 300;
    selectDbCellFromPointer(td, event);
  } else {
    setActiveCell(td, { scroll: false });
  }
}, true);

try {
  window.__meldexSetActiveCell = setActiveCell;
  window.__meldexSelectDbCellFromPointer = selectDbCellFromPointer;
} catch {}

function _dbRestoreCellAddButtonsIfIdle(td) {
  if (!td || !td.querySelectorAll) return;
  if (td.querySelector('.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-editor')) return;
  td.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
    btn.style.display = '';
    delete btn.dataset.editingHidden;
  });
}

function _dbRemoveNodeIfAttached(el) {
  try {
    if (el?.parentNode) el.remove();
  } catch {}
}

function _dbCloseTransientUiForCellRangeSelection() {
  document.querySelectorAll('.status-dropdown,.cell-inline-dd,.user-dropdown,.gb-context-menu').forEach(_dbRemoveNodeIfAttached);
  document.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
    btn.style.display = '';
    delete btn.dataset.editingHidden;
  });
}

function _dbCancelCellInlineEditors(td) {
  if (!td || !td.querySelectorAll) return;
  td.querySelectorAll('.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-toggle,.cell-date-editor').forEach(_dbRemoveNodeIfAttached);
  td.querySelectorAll('.entity-rename-input').forEach(inp => {
    const host = inp.closest?.('td.col-entity') || td;
    const label = host?.querySelector?.('.entity-name-label');
    const moreBtn = host?.querySelector?.('.entity-row-more-btn');
    const relDiv = host?.querySelector?.('.relation-links');
    if (label) label.style.display = '';
    if (moreBtn) moreBtn.style.display = '';
    if (relDiv) relDiv.style.display = '';
    _dbRemoveNodeIfAttached(inp);
  });
  td.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
    btn.style.display = '';
    delete btn.dataset.editingHidden;
  });
}

function _dbDeactivateActiveCell(cell) {
  if (!cell) return;
  _dbRestoreCellAddButtonsIfIdle(cell);
  cell.classList?.remove('active-cell');
  delete cell.dataset.dbActiveSeq;
  if (cell.tabIndex === 0) cell.tabIndex = -1;
}

function _dbCurrentVisualActiveCell() {
  const focused = document.activeElement?.closest?.('td.col-entity,td[data-prop-name]');
  if (focused?.isConnected && focused.classList.contains('active-cell')) return focused;
  const visual = Array.from(document.querySelectorAll('td.active-cell'))
    .filter(cell => cell?.isConnected)
    .sort((a, b) => Number(b.dataset.dbActiveSeq || 0) - Number(a.dataset.dbActiveSeq || 0))[0];
  if (visual?.isConnected) return visual;
  if (activeCell?.isConnected && activeCell.classList?.contains('active-cell')) return activeCell;
  return visual?.isConnected ? visual : null;
}

function setActiveCell(td, options = {}) {
  const table = td?.closest?.('table') || activeCell?.closest?.('table') || null;
  if (!options.preserveRange) {
    _clearDbCellRangeSelection(table);
    rangeAnchorCell = null;
  }
  const previous = activeCell;
  if (previous) _dbDeactivateActiveCell(previous);
  document.querySelectorAll('td.active-cell').forEach(cell => {
    if (cell !== td) _dbDeactivateActiveCell(cell);
  });
  activeCell = td;
  if (td) {
    _dbRestoreCellAddButtonsIfIdle(td);
    td.classList.add('active-cell');
    td.dataset.dbActiveSeq = String(++dbActiveCellSeq);
    td.tabIndex = 0;
    td.focus?.({ preventScroll: true });
    try {
      window.__meldexLastSetActiveCell = {
        propName: td.dataset?.propName || '',
        entityName: td.closest?.('tr')?.dataset?.entityName || '',
        seq: td.dataset.dbActiveSeq || '',
        stack: (new Error()).stack || '',
      };
    } catch {}
    if (options.scroll !== false) {
      _scrollDbActiveCellIntoView(td);
      _scheduleDbActiveCellScroll(td);
    }
  }
  _scheduleDbCellBulkBarUpdate(table);
}

function _dbContextForCell(cell) {
  if (typeof _dbPaneContextFromEvent === 'function') {
    return _dbPaneContextFromEvent(cell, { dbPath: state.currentDbPath });
  }
  return typeof _currentPaneState === 'function' ? _currentPaneState() : null;
}

function _dbCellEntityAndProp(td) {
  const entityName = td?.closest?.('tr')?.dataset?.entityName || '';
  const propName = td?.dataset?.propName || '';
  return { entityName, propName };
}

function _dbCellPrimaryValue(td, ctx) {
  const { entityName, propName } = _dbCellEntityAndProp(td);
  const data = (ctx && ctx.pivotData) || state.pivotData;
  const values = data?.entities?.[entityName]?.[propName] || [];
  const filtered = typeof filterValues === 'function' ? filterValues(values) : values;
  return filtered?.[0] || null;
}

function _dbCellPropertyType(td, ctx) {
  const propName = td?.dataset?.propName || '';
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  if (!propName || !dbPath || typeof getPropertyTypes !== 'function') return null;
  const ptc = getPropertyTypes(dbPath)?.[propName] || null;
  return ptc?.type ? { ...ptc, type: String(ptc.type).replace(/_/g, '-') } : ptc;
}

function _dbCellUsesPickerEditor(ptc) {
  const type = String(ptc?.type || '').replace(/_/g, '-');
  return !!ptc && ['select', 'multi-select', 'common-tags', 'relation', 'multi-relation', 'user', 'multi-user', 'link'].includes(type);
}

function _dbCellHasAnyValue(td, ctx) {
  const value = _dbCellPrimaryValue(td, ctx);
  if (value && String(value.value ?? '').trim() !== '') return true;
  const container = td?.querySelector?.('.cell-values');
  if (!container) return false;
  return !!container.querySelector('.cell-value,.value-text,.value-url,.cell-select-val,.multi-select-tag,.relation-link,.multi-select-tags,.cell-checkbox,.gb-image-thumb');
}

function _dbOpenExistingCellValueEditor(td, ctx) {
  const target = td?.querySelector?.('.cell-select-val,.relation-link,.multi-select-tags,.user-chip,.value-text,.value-url');
  if (!target) return false;
  target.click();
  return true;
}

function _dbOpenExistingCellValueEditorFromData(td, ctx) {
  const ptc = _dbCellPropertyType(td, ctx);
  const value = _dbCellPrimaryValue(td, ctx);
  if (!ptc || !value) return _dbOpenExistingCellValueEditor(td, ctx);
  const { entityName, propName } = _dbCellEntityAndProp(td);
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const entityPath = typeof _entityPath === 'function'
    ? _entityPath(dbPath, entityName, (ctx && ctx.pivotData) || state.pivotData)
    : `${dbPath}/${entityName}.md`;
  const type = String(ptc.type || '').replace(/_/g, '-');
  if ((type === 'select' || type === 'multi-select' || type === 'link') && typeof startCellInlineAdd === 'function') {
    startCellInlineAdd(td, entityPath, entityName, propName);
    return true;
  }
  if ((type === 'relation' || type === 'multi-relation') && typeof _showRelationDropdown === 'function') {
    _showRelationDropdown(td, value, entityPath, propName, { ...ptc, type, __sourceDbPath: dbPath }, type === 'multi-relation');
    return true;
  }
  return _dbOpenExistingCellValueEditor(td, ctx);
}

function _dbStartCellInlineEditor(td, options = {}) {
  if (!td || td.classList?.contains('col-entity')) return false;
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(td, { dbPath: state.currentDbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const tr = td.closest?.('tr');
  const entityName = tr?.dataset?.entityName || tr?.querySelector?.('.entity-name-label')?.textContent || '';
  const propName = td.dataset?.propName || '';
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  if (!entityName || !propName || !dbPath || typeof startCellInlineAdd !== 'function') return false;
  const ptc = _dbCellPropertyType(td, ctx);
  const hasValue = _dbCellHasAnyValue(td, ctx);
  if (options.preferExistingValue && hasValue && _dbOpenExistingCellValueEditorFromData(td, ctx)) return true;
  const entityPath = typeof _entityPath === 'function'
    ? _entityPath(dbPath, entityName, (ctx && ctx.pivotData) || state.pivotData)
    : `${dbPath}/${entityName}.md`;
  startCellInlineAdd(td, entityPath, entityName, propName);
  if (options.initialText && !_dbCellUsesPickerEditor(ptc)) {
    const inp = td.querySelector('.cell-inline-input');
    if (inp) {
      inp.value = options.initialText;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  return true;
}

function _dbIsNativeEditingElement(el) {
  return !!(el && el.isConnected !== false && (
    el.contentEditable === 'true' ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  ));
}

function _dbIsInternalRangePasteShortcut(e) {
  return (e.ctrlKey || e.metaKey) && !e.altKey && String(e.key || '').toLowerCase() === 'v'
    && _dbHasInternalCellClipboard()
    && Array.isArray(dbCellClipboard.cells) && dbCellClipboard.cells.length > 1;
}

function _dbActiveNativeEditingCell() {
  const el = document.activeElement;
  if (!_dbIsNativeEditingElement(el)) return null;
  return el.closest?.('td.col-entity,td[data-prop-name]') || null;
}

function _dbActiveNativeElementInTransientUi() {
  const el = document.activeElement;
  return !!(_dbIsNativeEditingElement(el) && el.closest?.('.status-dropdown,.cell-inline-dd,.user-dropdown,.gb-context-menu'));
}

function _dbShortcutEventCell(e) {
  return e?.target?.closest?.('td.col-entity,td[data-prop-name]') || null;
}

function _dbShouldRouteShortcutFromStaleNativeEditor(e) {
  const activeEl = document.activeElement;
  if (!_dbIsNativeEditingElement(activeEl) || _dbActiveNativeElementInTransientUi()) return false;
  const editingCell = _dbActiveNativeEditingCell();
  const eventCell = _dbShortcutEventCell(e);
  if (!editingCell || !eventCell || editingCell === eventCell || e.target === activeEl) return false;
  const key = String(e.key || '');
  const isNavigationKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'F2'].includes(key);
  if (!isNavigationKey) return false;
  if (activeEl.classList?.contains('entity-rename-input')) {
    const currentName = editingCell.closest?.('tr')?.dataset?.entityName || '';
    if (activeEl.value.trim() !== currentName) return false;
  }
  return true;
}

function _dbCancelStaleNativeEditorForSheetShortcut(e) {
  if (!_dbShouldRouteShortcutFromStaleNativeEditor(e)) return false;
  const editingCell = _dbActiveNativeEditingCell();
  const eventCell = _dbShortcutEventCell(e);
  if (editingCell) _dbCancelCellInlineEditors(editingCell);
  if (eventCell) setActiveCell(eventCell, { preserveRange: true, scroll: false });
  return true;
}

function _dbShouldBypassNativeEditorForSheetShortcut(e) {
  const editingCell = _dbActiveNativeEditingCell();
  if (!editingCell) return false;
  if (_dbIsInternalRangePasteShortcut(e)) return true;
  const key = String(e.key || '').toLowerCase();
  const isCopy = (e.ctrlKey || e.metaKey) && !e.altKey && key === 'c';
  const isDelete = (e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (!isCopy && !isDelete) return false;
  const table = _dbRangeSelectionTable() || editingCell.closest?.('table');
  return !!(table && _dbSelectedDataCells(table, true).length > 1);
}

function _dbCancelNativeEditorForSheetShortcut(e) {
  if (!_dbShouldBypassNativeEditorForSheetShortcut(e)) return false;
  const editingCell = _dbActiveNativeEditingCell();
  if (editingCell) {
    _dbCancelCellInlineEditors(editingCell);
    setActiveCell(editingCell, { preserveRange: true, scroll: false });
  }
  return true;
}

function _dbShortcutShouldCloseTransientUi(e) {
  if (!e) return false;
  const isInternalRangePaste = _dbIsInternalRangePasteShortcut(e);
  if (_dbIsNativeEditingElement(document.activeElement) && !_dbActiveNativeElementInTransientUi() && !isInternalRangePaste && !_dbShouldBypassNativeEditorForSheetShortcut(e)) return false;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && ['c', 'v'].includes(String(e.key || '').toLowerCase())) return true;
  return (e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey;
}

function _dbBlockForTransientUi(e) {
  const transient = Array.from(document.querySelectorAll('.status-dropdown, .cell-inline-dd, .user-dropdown, .gb-context-menu'));
  if (!transient.length) return false;
  if (!_dbShortcutShouldCloseTransientUi(e)) return true;
  transient.forEach(_dbRemoveNodeIfAttached);
  document.querySelectorAll('.cell-add-btn[data-editing-hidden]').forEach(btn => {
    btn.style.display = '';
    delete btn.dataset.editingHidden;
  });
  return false;
}
function _dbRangeSelectionTable() {
  const selectedCell = Array.from(document.querySelectorAll('tbody td.db-range-selected[data-prop-name]'))
    .find(cell => cell?.isConnected);
  return selectedCell?.closest?.('table') || null;
}

function _dbKeyboardActiveTable(options = {}) {
  const selectedTable = _dbRangeSelectionTable();
  if (options.preferSelection && selectedTable) return selectedTable;
  const visualCell = _dbCurrentVisualActiveCell();
  const focusedTable = document.activeElement?.closest?.('table');
  const selectedCell = document.querySelector('tbody td.db-range-selected[data-prop-name]');
  if (state.view !== 'pivot' && !activeCell?.closest?.('table') && !visualCell?.closest?.('table') && !selectedCell?.closest?.('table')) return null;
  let table = visualCell?.closest?.('table') || focusedTable || activeCell?.closest?.('table') || selectedCell?.closest?.('table') || _currentPivotTable();
  if (table && !table.isConnected) table = _currentPivotTable();
  return table || null;
}

function _dbKeyboardActiveCell(table, eventTarget = null) {
  const visual = _dbCurrentVisualActiveCell();
  if (visual && (!table || table.contains(visual))) return visual;
  const eventCell = eventTarget?.closest?.('td.col-entity,td[data-prop-name]');
  if (eventCell && table?.contains?.(eventCell)) return eventCell;
  const focused = document.activeElement?.closest?.('td.col-entity,td[data-prop-name]');
  if (focused && table?.contains?.(focused)) return focused;
  const selected = table?.querySelector?.('tbody td.db-range-selected[data-prop-name]');
  if (selected) return selected;
  return activeCell && table?.contains?.(activeCell) ? activeCell : null;
}

function _dbVisibleDataRows(table) {
  return Array.from(table?.querySelectorAll?.('tbody tr:not(.new-entity-row):not(.new-entity-spacer-row):not(.db-virtual-spacer-row):not(.group-header-row)') || [])
    .filter(row => {
      if (!row?.isConnected) return false;
      const style = typeof getComputedStyle === 'function' ? getComputedStyle(row) : null;
      return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse');
    });
}

function _dbHandleCellEditorKey(e, colIdx, targetCell) {
  if (typeof _dbInlineIsComposing === 'function' && _dbInlineIsComposing(e)) return false;
  const cell = targetCell || activeCell;
  if (!cell || colIdx <= 0) return false;
  if ((e.key === 'Enter' || e.key === 'F2') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    _dbStartCellInlineEditor(cell, { preferExistingValue: true });
    return true;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const ctx = typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(cell, { dbPath: state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
    const ptc = _dbCellPropertyType(cell, ctx);
    const hasValue = _dbCellHasAnyValue(cell, ctx);
    if (_dbCellUsesPickerEditor(ptc) || !hasValue) {
      e.preventDefault();
      _dbStartCellInlineEditor(cell, { initialText: e.key, preferExistingValue: _dbCellUsesPickerEditor(ptc) && hasValue });
      return true;
    }
  }
  return false;
}
