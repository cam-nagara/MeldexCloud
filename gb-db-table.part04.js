/* 大規模シートの仮想スクロール — gb-db-table.js から分離 */

const DB_VIRTUAL_ROW_TASK_THRESHOLD = 900;
const DB_VIRTUAL_CELL_TASK_THRESHOLD = 80000;
const DB_VIRTUAL_ROW_OVERSCAN = 24;
const DB_VIRTUAL_MAX_RENDERED_TASKS = 220;
const DB_VIRTUAL_BACKLINK_DEBOUNCE_MS = 180;

function _dbSetRenderRowLimit(ctx, totalRows, requestedLimit) {
  if (ctx) ctx._dbRenderRowLimit = 0;
  return 0;
}

function _dbEffectiveRenderRowLimit(ctx, entityNames, visibleProps) {
  if (ctx) ctx._dbRenderRowLimit = 0;
  return 0;
}

function _dbDisposeVirtualRows(ctx) {
  const v = ctx?._dbVirtualRows;
  if (!v) return;
  if (v.scroller && v.onScroll) v.scroller.removeEventListener('scroll', v.onScroll);
  if (v.onResize) window.removeEventListener('resize', v.onResize);
  if (v.resizeObserver) v.resizeObserver.disconnect();
  if (v.raf) cancelAnimationFrame(v.raf);
  if (ctx?._dbVirtualBacklinkTimer) {
    clearTimeout(ctx._dbVirtualBacklinkTimer);
    ctx._dbVirtualBacklinkTimer = null;
  }
  if (v.table && v.table._dbVirtualRows === v) v.table._dbVirtualRows = null;
  if (ctx) ctx._dbVirtualRows = null;
}

function _dbShouldUseVirtualRows(ctx, rowTasks, options = {}) {
  if (!ctx || !Array.isArray(rowTasks)) return false;
  if (options.disabled === true || ctx._dbDisableVirtualRows === true) return false;
  const projectedCells = rowTasks.length * Math.max(1, (options.visibleProps?.length || 0) + 1);
  return rowTasks.length >= DB_VIRTUAL_ROW_TASK_THRESHOLD
    || projectedCells >= DB_VIRTUAL_CELL_TASK_THRESHOLD;
}

function _dbVirtualEstimateRowHeight(options = {}) {
  const visibleProps = Array.isArray(options.visibleProps) ? options.visibleProps : [];
  const propTypes = options.propTypes || {};
  let rowHeight = options.thumbSize === 'large' ? 104 : 38;
  visibleProps.forEach(propName => {
    const ptc = propTypes[propName];
    if (ptc?.type !== 'image') return;
    const cellSize = typeof _imagePropCellSize === 'function'
      ? _imagePropCellSize(ptc)
      : _dbClampInt(ptc?.options?.cell_height ?? ptc?.options?.cell_thumbnail_size, 32, 320, 96);
    rowHeight = Math.max(rowHeight, cellSize + 14);
  });
  return Math.max(30, Math.min(360, Math.round(rowHeight)));
}

function _dbVirtualScrollContainer(ctx, tbody) {
  const table = tbody?.closest?.('table');
  return table?.closest?.('#pivot-view,.pivot-view')
    || (typeof _paneEl === 'function' ? (_paneEl(ctx, '.pivot-view') || _paneEl(ctx, '#pivot-view')) : null)
    || (typeof findScrollableParent === 'function' ? findScrollableParent(table) : null);
}

function _dbCreateVirtualSpacerRow(className, colSpan) {
  const tr = document.createElement('tr');
  tr.className = className;
  tr.setAttribute('aria-hidden', 'true');
  tr.setAttribute('role', 'presentation');
  const td = document.createElement('td');
  td.colSpan = colSpan;
  td.style.cssText = 'height:0;padding:0;border:0;line-height:0;';
  tr.appendChild(td);
  return tr;
}

function _dbSetVirtualSpacerHeight(row, height) {
  const px = Math.max(0, Math.round(height || 0));
  const td = row?.firstElementChild;
  if (td) td.style.height = px + 'px';
}

function _dbRenderVirtualTask(task, config) {
  if (task.kind === 'group') {
    return renderGroupHeaderRow(task.groupKey, task.names, config.visibleProps, config.groupByProp, config.ctx);
  }
  return renderEntityRow(task.entityName, config.ctx, config.entityRowOpts);
}

function _dbScheduleVirtualBacklinkSummary(ctx, renderToken) {
  if (typeof _appendBacklinkSummaryColumns !== 'function' || !ctx) return;
  clearTimeout(ctx._dbVirtualBacklinkTimer);
  ctx._dbVirtualBacklinkTimer = setTimeout(() => {
    if (renderToken && ctx._renderToken !== renderToken) return;
    _appendBacklinkSummaryColumns(ctx);
  }, DB_VIRTUAL_BACKLINK_DEBOUNCE_MS);
}

function _dbVirtualAfterVisibleRows(ctx, renderToken) {
  if (renderToken && ctx?._renderToken !== renderToken) return;
  if (typeof _refreshSheetBadges === 'function') _refreshSheetBadges(ctx);
  _dbScheduleVirtualBacklinkSummary(ctx, renderToken);
}

function _dbVirtualStateForTable(table) {
  return table?._dbVirtualRows || null;
}

function _dbApplyVirtualPendingCell(vState) {
  const pending = vState?.pendingCell;
  if (!pending?.entityName || pending.colIdx == null) return;
  const cssName = MeldexEscape.cssIdent(pending.entityName);
  const row = vState.table?.querySelector?.(`tbody tr[data-entity-name="${cssName}"]`);
  const cell = row?.children?.[pending.colIdx] || null;
  if (!cell || cell.classList.contains('col-add-prop-cell')) return;
  vState.pendingCell = null;
  if (typeof setActiveCell === 'function') {
    setTimeout(() => {
      if (cell.isConnected) setActiveCell(cell, { preserveRange: true });
    }, 0);
  }
}

function _dbRequestVirtualCellReveal(table, rowIdx, colIdx) {
  const v = _dbVirtualStateForTable(table);
  if (!v) return false;
  const entityName = v.entityNames?.[rowIdx];
  if (!entityName) return false;
  v.pendingCell = { entityName, colIdx };
  return _dbRevealVirtualEntityRow(v.ctx, entityName);
}

function _dbRunVirtualRowRenderer(ctx, config) {
  const tbody = config?.tbody;
  const rowTasks = config?.rowTasks;
  const scroller = _dbVirtualScrollContainer(ctx, tbody);
  if (!ctx || !tbody || !Array.isArray(rowTasks) || !scroller) return false;
  const table = tbody.closest('table');

  const colSpan = (config.visibleProps?.length || 0) + 3;
  const topSpacer = _dbCreateVirtualSpacerRow('db-virtual-spacer-row db-virtual-spacer-top', colSpan);
  const bottomSpacer = _dbCreateVirtualSpacerRow('db-virtual-spacer-row db-virtual-spacer-bottom', colSpan);
  const anchor = config.renderMoreRow || config.newEntryRow || null;
  tbody.insertBefore(topSpacer, anchor);
  tbody.insertBefore(bottomSpacer, anchor);

  const rowHeight = _dbVirtualEstimateRowHeight(config);
  const renderToken = config.renderToken;
  const vState = {
    rowTasks,
    rowHeight,
    scroller,
    topSpacer,
    bottomSpacer,
    table,
    ctx,
    entityNames: rowTasks.filter(task => task.kind === 'entity').map(task => task.entityName),
    renderedRows: [],
    start: -1,
    end: -1,
    raf: 0,
    onScroll: null,
    onResize: null,
    resizeObserver: null,
    forceNextRender: false,
    renderNow: null,
    renderToken,
  };
  ctx._dbVirtualRows = vState;
  if (table) table._dbVirtualRows = vState;

  const renderVisible = (force = false) => {
    if (renderToken && ctx._renderToken !== renderToken) return;
    const viewportHeight = Math.max(240, scroller.clientHeight || window.innerHeight || 600);
    const first = Math.max(0, Math.floor((scroller.scrollTop || 0) / rowHeight) - DB_VIRTUAL_ROW_OVERSCAN);
    const visibleCount = Math.min(
      DB_VIRTUAL_MAX_RENDERED_TASKS,
      Math.ceil(viewportHeight / rowHeight) + DB_VIRTUAL_ROW_OVERSCAN * 2,
    );
    const last = Math.min(rowTasks.length, first + visibleCount);
    if (!force && first === vState.start && last === vState.end) return;

    vState.renderedRows.forEach(row => row.remove());
    vState.renderedRows = [];
    _dbSetVirtualSpacerHeight(topSpacer, first * rowHeight);
    _dbSetVirtualSpacerHeight(bottomSpacer, (rowTasks.length - last) * rowHeight);

    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const row = _dbRenderVirtualTask(rowTasks[i], config);
      vState.renderedRows.push(row);
      frag.appendChild(row);
    }
    tbody.insertBefore(frag, bottomSpacer);
    vState.start = first;
    vState.end = last;
    ctx._renderDoneRows = Math.max(0, last - first);
    ctx._renderInProgress = false;
    _dbApplyVirtualPendingCell(vState);
    _dbVirtualAfterVisibleRows(ctx, renderToken);

    if (!vState.logged && typeof _logPerfEvent === 'function') {
      vState.logged = true;
      _logPerfEvent('sheet.renderPivot.complete', config.renderPerfStartedAt, {
        targetLabel: String(config.dbPath || '').split(/[\\/]/).filter(Boolean).pop() || String(config.dbPath || ''),
        entityCount: config.entityNames?.length || 0,
        propertyCount: config.visibleProps?.length || 0,
        rowTaskCount: rowTasks.length,
        renderRowLimit: config.renderRowLimit,
        renderedRows: ctx._renderDoneRows,
        virtualRows: true,
      });
    }
  };

  const requestRender = (force = false) => {
    vState.forceNextRender = vState.forceNextRender || force;
    if (vState.raf) return;
    vState.raf = requestAnimationFrame(() => {
      vState.raf = 0;
      const shouldForce = vState.forceNextRender;
      vState.forceNextRender = false;
      renderVisible(shouldForce);
    });
  };
  vState.renderNow = renderVisible;
  vState.onScroll = () => requestRender(false);
  vState.onResize = () => requestRender(true);
  scroller.addEventListener('scroll', vState.onScroll, { passive: true });
  window.addEventListener('resize', vState.onResize);
  if (typeof ResizeObserver === 'function') {
    let lastWidth = scroller.clientWidth;
    let lastHeight = scroller.clientHeight;
    vState.resizeObserver = new ResizeObserver(() => {
      const nextWidth = scroller.clientWidth;
      const nextHeight = scroller.clientHeight;
      if (nextWidth === lastWidth && nextHeight === lastHeight) return;
      lastWidth = nextWidth;
      lastHeight = nextHeight;
      requestRender(true);
    });
    vState.resizeObserver.observe(scroller);
  }
  renderVisible(true);
  return true;
}

function _dbRevealVirtualEntityRow(ctx, entityName) {
  const v = ctx?._dbVirtualRows;
  if (!v || !entityName) return false;
  const index = v.rowTasks.findIndex(task => task.kind === 'entity' && task.entityName === entityName);
  if (index < 0) return false;
  const viewportHeight = Math.max(240, v.scroller?.clientHeight || window.innerHeight || 600);
  v.scroller.scrollTop = Math.max(0, Math.round(index * v.rowHeight - viewportHeight / 2));
  v.renderNow?.(true);
  return true;
}
