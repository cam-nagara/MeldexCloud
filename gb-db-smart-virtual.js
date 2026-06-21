/* スマートシートの大規模表示用仮想スクロール */

const SMART_DB_VIRTUAL_ROW_THRESHOLD = 700;
const SMART_DB_VIRTUAL_CELL_THRESHOLD = 50000;
const SMART_DB_VIRTUAL_OVERSCAN = 24;
const SMART_DB_VIRTUAL_MAX_RENDERED_ROWS = 220;

function disposeSmartDbVirtualRows(table) {
  const target = table || document.getElementById('smart-db-table');
  const v = target?._smartDbVirtualRows;
  if (!v) return;
  if (v.scroller && v.onScroll) v.scroller.removeEventListener('scroll', v.onScroll);
  if (v.onResize) window.removeEventListener('resize', v.onResize);
  if (v.raf) cancelAnimationFrame(v.raf);
  _smartDbRestoreScrollerStyle(v.scroller, v.scrollerStyleSnapshot);
  if (target) {
    target._smartDbVirtualRows = null;
    delete target.dataset.smartDbVirtualRows;
    delete target.dataset.smartDbTotalRows;
  }
}

function shouldUseSmartDbVirtualRows(rows, columnCount) {
  const count = Array.isArray(rows) ? rows.length : 0;
  const cols = Math.max(1, Number(columnCount || 1));
  return count >= SMART_DB_VIRTUAL_ROW_THRESHOLD || count * cols >= SMART_DB_VIRTUAL_CELL_THRESHOLD;
}

function _smartDbVirtualScroller(table, tbody) {
  return table?.closest?.('#smart-db-table-area,.smart-db-table-area')
    || tbody?.closest?.('#smart-db-table-area,.smart-db-table-area')
    || (typeof findScrollableParent === 'function' ? findScrollableParent(table || tbody) : null);
}

function _smartDbScrollerStyleSnapshot(scroller) {
  if (!scroller || scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
    return null;
  }
  return {
    maxHeight: scroller.style.maxHeight || '',
    overflow: scroller.style.overflow || '',
    overflowY: scroller.style.overflowY || '',
    minHeight: scroller.style.minHeight || '',
  };
}

function _smartDbRestoreScrollerStyle(scroller, snapshot) {
  if (!scroller || !snapshot) return;
  scroller.style.maxHeight = snapshot.maxHeight;
  scroller.style.overflow = snapshot.overflow;
  scroller.style.overflowY = snapshot.overflowY;
  scroller.style.minHeight = snapshot.minHeight;
}

function _smartDbConstrainVirtualScroller(scroller) {
  if (!scroller || scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) return;
  const rect = scroller.getBoundingClientRect?.();
  const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 720;
  const top = Number.isFinite(rect?.top) ? rect.top : 0;
  const available = Math.max(240, Math.floor(viewportHeight - top - 8));
  const current = scroller.clientHeight || 0;
  if (!current || current > available + 2 || scroller.scrollHeight <= scroller.clientHeight + 1) {
    scroller.style.maxHeight = available + 'px';
    scroller.style.overflow = 'auto';
    scroller.style.overflowY = 'auto';
    scroller.style.minHeight = '0';
  }
}

function _smartDbCreateVirtualSpacerRow(className, colSpan) {
  const tr = document.createElement('tr');
  tr.className = 'smart-db-virtual-spacer-row ' + className;
  tr.setAttribute('aria-hidden', 'true');
  tr.setAttribute('role', 'presentation');
  const td = document.createElement('td');
  td.colSpan = Math.max(1, Number(colSpan || 1));
  td.style.cssText = 'height:0;padding:0;border:0;line-height:0;';
  tr.appendChild(td);
  return tr;
}

function _smartDbSetSpacerHeight(row, height) {
  const td = row?.firstElementChild;
  if (td) td.style.height = Math.max(0, Math.round(height || 0)) + 'px';
}

function renderSmartDbVirtualRows(config) {
  const table = config?.table || document.getElementById('smart-db-table');
  const tbody = config?.tbody || table?.querySelector?.('tbody');
  const rows = Array.isArray(config?.rows) ? config.rows : [];
  const columnCount = Math.max(1, Number(config?.colSpan || config?.columnCount || 1));
  if (!table || !tbody) return false;
  disposeSmartDbVirtualRows(table);
  if (!shouldUseSmartDbVirtualRows(rows, columnCount)) return false;

  const renderRow = typeof config.renderRow === 'function' ? config.renderRow : null;
  const scroller = _smartDbVirtualScroller(table, tbody);
  if (!renderRow || !scroller) return false;

  const rowHeight = Math.max(28, Math.min(160, Number(config.rowHeight || 34)));
  const scrollerStyleSnapshot = _smartDbScrollerStyleSnapshot(scroller);
  _smartDbConstrainVirtualScroller(scroller);
  const topSpacer = _smartDbCreateVirtualSpacerRow('smart-db-virtual-spacer-top', columnCount);
  const bottomSpacer = _smartDbCreateVirtualSpacerRow('smart-db-virtual-spacer-bottom', columnCount);
  tbody.appendChild(topSpacer);
  tbody.appendChild(bottomSpacer);

  const vState = {
    table,
    tbody,
    rows,
    rowHeight,
    scroller,
    topSpacer,
    bottomSpacer,
    scrollerStyleSnapshot,
    renderedRows: [],
    start: -1,
    end: -1,
    raf: 0,
    onScroll: null,
    onResize: null,
    renderNow: null,
  };
  table._smartDbVirtualRows = vState;
  table.dataset.smartDbVirtualRows = '1';
  table.dataset.smartDbTotalRows = String(rows.length);

  const renderVisible = (force = false) => {
    _smartDbConstrainVirtualScroller(scroller);
    const viewportHeight = Math.max(240, scroller.clientHeight || window.innerHeight || 600);
    const visibleCount = Math.min(
      SMART_DB_VIRTUAL_MAX_RENDERED_ROWS,
      Math.ceil(viewportHeight / rowHeight) + SMART_DB_VIRTUAL_OVERSCAN * 2,
    );
    const estimatedFirst = Math.max(0, Math.floor((scroller.scrollTop || 0) / rowHeight) - SMART_DB_VIRTUAL_OVERSCAN);
    const first = Math.min(Math.max(0, rows.length - visibleCount), estimatedFirst);
    const last = Math.min(rows.length, first + visibleCount);
    if (!force && first === vState.start && last === vState.end) return;

    vState.renderedRows.forEach(row => row.remove());
    vState.renderedRows = [];
    _smartDbSetSpacerHeight(topSpacer, first * rowHeight);
    _smartDbSetSpacerHeight(bottomSpacer, (rows.length - last) * rowHeight);

    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const row = renderRow(rows[i], i);
      if (!row) continue;
      vState.renderedRows.push(row);
      frag.appendChild(row);
    }
    tbody.insertBefore(frag, bottomSpacer);
    vState.start = first;
    vState.end = last;
    if (typeof config.onRendered === 'function') config.onRendered(vState);
  };

  const requestRender = () => {
    if (vState.raf) return;
    vState.raf = requestAnimationFrame(() => {
      vState.raf = 0;
      renderVisible(false);
    });
  };
  vState.renderNow = renderVisible;
  vState.onScroll = requestRender;
  vState.onResize = requestRender;
  scroller.addEventListener('scroll', vState.onScroll, { passive: true });
  window.addEventListener('resize', vState.onResize);
  renderVisible(true);
  return true;
}
