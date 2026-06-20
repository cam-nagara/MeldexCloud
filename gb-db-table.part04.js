/* 大規模シートの段階描画 — gb-db-table.js から分離 */

const DB_LARGE_SHEET_CELL_LIMIT = 80000;
const DB_LARGE_SHEET_MORE_STEP = 500;
const _dbRenderRowLimitMemory = new Map();

function _dbRenderRowLimitKey(ctx, dbPath) {
  const path = dbPath || ctx?.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '');
  if (!path) return '';
  const paneId = ctx?.paneId || 'main';
  return paneId + '\n' + path;
}

function _dbRememberRenderRowLimit(ctx, dbPath, limit) {
  const key = _dbRenderRowLimitKey(ctx, dbPath);
  if (!key) return;
  const value = Number.parseInt(limit, 10);
  if (Number.isFinite(value) && value > 0) _dbRenderRowLimitMemory.set(key, value);
  else _dbRenderRowLimitMemory.delete(key);
}

function _dbRememberedRenderRowLimit(ctx, dbPath) {
  const key = _dbRenderRowLimitKey(ctx, dbPath);
  if (!key || !_dbRenderRowLimitMemory.has(key)) return 0;
  const value = Number.parseInt(_dbRenderRowLimitMemory.get(key), 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function _dbSetRenderRowLimit(ctx, totalRows, requestedLimit) {
  if (!ctx) return 0;
  const total = Math.max(0, Number.parseInt(totalRows, 10) || 0);
  const requested = Math.max(0, Number.parseInt(requestedLimit, 10) || 0);
  const limit = total ? Math.min(total, requested) : requested;
  ctx._dbRenderRowLimit = limit;
  _dbRememberRenderRowLimit(ctx, ctx.dbPath, limit);
  return limit;
}

function _dbInitialRenderRowLimit(totalRows, visiblePropCount) {
  const rowCount = Math.max(0, totalRows || 0);
  const colCount = Math.max(1, (visiblePropCount || 0) + 1);
  const projectedCells = rowCount * colCount;
  if (rowCount <= 700 || projectedCells <= DB_LARGE_SHEET_CELL_LIMIT) return 0;
  if (visiblePropCount >= 80) return 200;
  if (visiblePropCount >= 40) return 300;
  return 500;
}

function _dbEffectiveRenderRowLimit(ctx, entityNames, visibleProps) {
  const totalRows = Array.isArray(entityNames) ? entityNames.length : 0;
  const initialLimit = _dbInitialRenderRowLimit(totalRows, Array.isArray(visibleProps) ? visibleProps.length : 0);
  if (!initialLimit || totalRows <= initialLimit) {
    if (ctx) {
      ctx._dbRenderRowLimit = 0;
      _dbRememberRenderRowLimit(ctx, ctx.dbPath, 0);
    }
    return 0;
  }
  const requested = Math.max(
    Number.parseInt(ctx?._dbRenderRowLimit, 10) || 0,
    _dbRememberedRenderRowLimit(ctx, ctx?.dbPath),
  );
  const effective = Number.isFinite(requested) && requested > 0
    ? Math.max(initialLimit, requested)
    : initialLimit;
  const limit = Math.min(totalRows, effective);
  if (ctx && requested > 0) ctx._dbRenderRowLimit = limit;
  return limit;
}

function _dbCreateRenderMoreRow(ctx, options) {
  const { visibleProps, totalRows, shownRows, currentLimit } = options;
  const remaining = Math.max(0, totalRows - shownRows);
  if (remaining <= 0) return null;
  const tr = document.createElement('tr');
  tr.className = 'db-render-more-row';
  tr.setAttribute('role', 'row');
  const td = document.createElement('td');
  td.colSpan = visibleProps.length + 2;
  td.setAttribute('role', 'cell');
  const status = document.createElement('span');
  status.className = 'db-render-more-status';
  status.textContent = `表示: ${shownRows} / ${totalRows} 件`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'db-render-more-btn';
  btn.innerHTML = lucide('chevronsDown', 14) + ' ' + (remaining <= DB_LARGE_SHEET_MORE_STEP ? '残りを表示' : `次の${DB_LARGE_SHEET_MORE_STEP}件`);
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    _dbSetRenderRowLimit(ctx, totalRows, Math.max(currentLimit, shownRows) + DB_LARGE_SHEET_MORE_STEP);
    if (typeof renderPivot === 'function') renderPivot(ctx);
  });
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'db-render-more-btn db-render-all-btn';
  allBtn.innerHTML = lucide('chevronsDown', 14) + ' すべて表示';
  allBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    _dbSetRenderRowLimit(ctx, totalRows, totalRows);
    if (typeof renderPivot === 'function') renderPivot(ctx);
  });
  td.appendChild(status);
  td.appendChild(btn);
  td.appendChild(allBtn);
  tr.appendChild(td);
  return tr;
}
