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
  v.disposed = true;
  if (v.scroller && v.onScroll) v.scroller.removeEventListener('scroll', v.onScroll);
  if (v.onResize) window.removeEventListener('resize', v.onResize);
  if (v.resizeObserver) v.resizeObserver.disconnect();
  if (v.rowResizeObserver) v.rowResizeObserver.disconnect();
  if (v.raf) cancelAnimationFrame(v.raf);
  if (ctx?._dbVirtualBacklinkTimer) {
    clearTimeout(ctx._dbVirtualBacklinkTimer);
    ctx._dbVirtualBacklinkTimer = null;
  }
  if (v.table && v.table._dbVirtualRows === v) {
    v.table.style.overflowAnchor = v.previousOverflowAnchor;
    v.table._dbVirtualRows = null;
  }
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
  // Cells and groups must retain this sheet's owner, including isolated tabs.
  // Falling back to the globally active/legacy sheet loses image cell context.
  config = { ...config, ctx };
  const table = tbody.closest('table');
  // Spacer updates preserve the logical anchor below. Browser scroll anchoring
  // would apply a second correction and move the visible rows out of view.
  const previousOverflowAnchor = table?.style.overflowAnchor || '';
  if (table) table.style.overflowAnchor = 'none';

  const colSpan = (config.visibleProps?.length || 0) + 3;
  const topSpacer = _dbCreateVirtualSpacerRow('db-virtual-spacer-row db-virtual-spacer-top', colSpan);
  const bottomSpacer = _dbCreateVirtualSpacerRow('db-virtual-spacer-row db-virtual-spacer-bottom', colSpan);
  const anchor = config.renderMoreRow || config.newEntryRow || null;
  tbody.insertBefore(topSpacer, anchor);
  tbody.insertBefore(bottomSpacer, anchor);

  const rowHeight = _dbVirtualEstimateRowHeight(config);
  // Store measured height deltas in a Fenwick tree: prefix offsets and updates
  // stay logarithmic even when a sheet has many rows and wrapped image cells.
  const measuredHeights = new Map();
  const heightDeltas = new Float64Array(rowTasks.length + 1);
  const offsetFor = index => {
    let offset = index * rowHeight;
    for (let i = index; i > 0; i -= i & -i) offset += heightDeltas[i];
    return offset;
  };
  const indexAtOffset = offset => {
    let low = 0, high = Math.max(0, rowTasks.length - 1);
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (offsetFor(mid + 1) <= offset) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const measureRow = (index, row) => {
    const height = row?.offsetHeight;
    if (!height || height === (measuredHeights.get(index) || rowHeight)) return false;
    const delta = height - (measuredHeights.get(index) || rowHeight);
    measuredHeights.set(index, height);
    for (let i = index + 1; i < heightDeltas.length; i += i & -i) heightDeltas[i] += delta;
    return true;
  };
  const renderToken = config.renderToken;
  const vState = {
    rowTasks,
    rowHeight,
    offsetFor,
    heightFor: index => measuredHeights.get(index) || rowHeight,
    previousOverflowAnchor,
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
    rowResizeObserver: null,
    rowIndexes: new Map(),
    forceNextRender: false,
    measureNextRender: false,
    renderNow: null,
    renderToken,
  };
  ctx._dbVirtualRows = vState;
  if (table) table._dbVirtualRows = vState;

  const renderVisible = (force = false, remeasure = false) => {
    if (vState.disposed) return;
    if (renderToken && ctx._renderToken !== renderToken) return;
    if (ctx.destroyed || bottomSpacer.parentNode !== tbody) return;
    const viewportHeight = Math.max(240, scroller.clientHeight || window.innerHeight || 600);
    const scrollTop = scroller.scrollTop || 0;
    const anchorIndex = indexAtOffset(scrollTop);
    const anchorOffset = scrollTop - offsetFor(anchorIndex);
    const first = Math.max(0, anchorIndex - DB_VIRTUAL_ROW_OVERSCAN);
    const visibleCount = Math.min(
      DB_VIRTUAL_MAX_RENDERED_TASKS,
      Math.max(Math.ceil(viewportHeight / rowHeight),
        indexAtOffset(scrollTop + viewportHeight - 1) - anchorIndex + 1) + DB_VIRTUAL_ROW_OVERSCAN * 2,
    );
    const last = Math.min(rowTasks.length, first + visibleCount);
    if (!force && !remeasure && first === vState.start && last === vState.end) return;

    const previousRows = new Map();
    vState.renderedRows.forEach((row, offset) => {
      const index = vState.start + offset;
      if (!force && index >= first && index < last) previousRows.set(index, row);
      else {
        vState.rowResizeObserver?.unobserve(row);
        vState.rowIndexes.delete(row);
        row.remove();
      }
    });
    vState.renderedRows = [];
    _dbSetVirtualSpacerHeight(topSpacer, offsetFor(first));
    _dbSetVirtualSpacerHeight(bottomSpacer, offsetFor(rowTasks.length) - offsetFor(last));

    // Keep retained rows attached. Moving a focused editor through a fragment
    // blurs it even when the same row DOM is inserted again immediately.
    let cursor = topSpacer.nextSibling || bottomSpacer;
    for (let i = first; i < last; i++) {
      const row = previousRows.get(i) || _dbRenderVirtualTask(rowTasks[i], config);
      vState.renderedRows.push(row);
      if (row !== cursor) tbody.insertBefore(row, cursor);
      cursor = row.nextSibling || bottomSpacer;
      vState.rowIndexes.set(row, i);
      vState.rowResizeObserver?.observe(row);
    }
    let heightsChanged = false;
    vState.renderedRows.forEach((row, offset) => {
      if (measureRow(first + offset, row)) heightsChanged = true;
    });
    if (heightsChanged) {
      _dbSetVirtualSpacerHeight(topSpacer, offsetFor(first));
      _dbSetVirtualSpacerHeight(bottomSpacer, offsetFor(rowTasks.length) - offsetFor(last));
      scroller.scrollTop = Math.max(0, offsetFor(anchorIndex) + anchorOffset);
    }
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

  const requestRender = (force = false, remeasure = false) => {
    if (vState.disposed) return;
    vState.forceNextRender = vState.forceNextRender || force;
    vState.measureNextRender = vState.measureNextRender || remeasure;
    if (vState.raf) return;
    vState.raf = requestAnimationFrame(() => {
      vState.raf = 0;
      const shouldForce = vState.forceNextRender;
      const shouldMeasure = vState.measureNextRender;
      vState.forceNextRender = false;
      vState.measureNextRender = false;
      renderVisible(shouldForce, shouldMeasure);
    });
  };
  vState.renderNow = renderVisible;
  vState.onScroll = () => requestRender(false);
  vState.onResize = () => requestRender(false, true);
  scroller.addEventListener('scroll', vState.onScroll, { passive: true });
  window.addEventListener('resize', vState.onResize);
  if (typeof ResizeObserver === 'function') {
    vState.rowResizeObserver = new ResizeObserver(entries => {
      if (entries.some(entry => {
        const index = vState.rowIndexes.get(entry.target);
        return index != null && entry.target.offsetHeight > 0
          && entry.target.offsetHeight !== vState.heightFor(index);
      })) requestRender(false, true);
    });
    let lastWidth = scroller.clientWidth;
    let lastHeight = scroller.clientHeight;
    vState.resizeObserver = new ResizeObserver(() => {
      const nextWidth = scroller.clientWidth;
      const nextHeight = scroller.clientHeight;
      if (nextWidth === lastWidth && nextHeight === lastHeight) return;
      lastWidth = nextWidth;
      lastHeight = nextHeight;
      requestRender(false, true);
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
  v.scroller.scrollTop = Math.max(0, Math.round(v.offsetFor(index) - viewportHeight / 2));
  v.renderNow?.(true);
  // The target's height becomes known on its first mount. Center using that
  // measurement as well, so wrapped thumbnails are actually in the viewport.
  v.scroller.scrollTop = Math.max(0, Math.round(v.offsetFor(index) - Math.max(0, viewportHeight - v.heightFor(index)) / 2));
  v.renderNow?.();
  return true;
}
