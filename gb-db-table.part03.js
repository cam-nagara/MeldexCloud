function _applySelectedColumnClasses(ctx, dbPath) {
  const table = typeof _currentPivotTable === 'function' ? _currentPivotTable(ctx) : document.getElementById('pivot-table');
  if (!table) return;
  const selected = typeof _getSelectedColumns === 'function' ? _getSelectedColumns(dbPath) : [];
  table.querySelectorAll('th.col-selected, td.col-selected').forEach(el => el.classList.remove('col-selected'));
  if (selected.includes('__entity__')) {
    table.querySelector('thead th.col-entity-header')?.classList.add('col-selected');
    table.querySelectorAll('tbody td.col-entity, tfoot td.col-entity').forEach(td => td.classList.add('col-selected'));
  }
  selected.forEach(propName => {
    if (propName === '__entity__') return;
    const cssProp = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
      ? CSS.escape(propName)
      : String(propName).replace(/["\\]/g, '\\$&');
    table.querySelectorAll(`thead th[data-prop="${cssProp}"], tbody td[data-prop-name="${cssProp}"], tfoot td[data-prop-name="${cssProp}"]`)
      .forEach(el => el.classList.add('col-selected'));
  });
}

function _setupDbColumnHeaderA11y(th, label) {
  if (!th) return;
  th.setAttribute('role', 'columnheader');
  th.setAttribute('scope', 'col');
  th.tabIndex = 0;
  th.setAttribute('aria-label', label || th.textContent?.trim() || '列');
}

function _dbEntityColumnDisplayLabel(dbPath) {
  const path = String(dbPath || '').replace(/\\/g, '/').replace(/\/+$/g, '');
  return path.endsWith('制作管理/シート/タスクリスト') ? 'タスク名' : 'エントリ名';
}

function _dbDefaultEntityColumnWidth(dbPath) {
  const path = String(dbPath || '').replace(/\\/g, '/').replace(/\/+$/g, '');
  return path.endsWith('制作管理/シート/タスクリスト') ? 260 : 120;
}

function _dbE2eToken(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function _dbE2eId(ctx, kind, ...parts) {
  const tableId = _dbE2eToken(ctx?.tableId || 'pivot-table');
  const suffix = parts.map(_dbE2eToken).join('-');
  return `db-${tableId}-${kind}${suffix ? '-' + suffix : ''}`;
}

function _setupDbColumnResizeHandleA11y(handle, th, colIndex, propName, dbPath, ctx) {
  if (!handle || !th) return;
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', `${propName === '__entity__' ? _dbEntityColumnDisplayLabel(dbPath) : propName} 列幅を調整`);
  const applyWidth = (width) => {
    const nextWidth = Math.max(60, Math.round(width));
    th.style.width = nextWidth + 'px';
    th.style.minWidth = nextWidth + 'px';
    handle.setAttribute('aria-valuenow', String(nextWidth));
    const table = th.closest('table');
    if (table) {

      table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
        const cell = tr.children[colIndex];
        if (cell) {
          cell.style.width = nextWidth + 'px';
          cell.style.minWidth = nextWidth + 'px';
        }
      });
    } else if (typeof setColWidth === 'function') {
      setColWidth(colIndex, nextWidth);
    }
    if (dbPath && propName && typeof setColWidthPersist === 'function') {
      setColWidthPersist(dbPath, propName, nextWidth, {
        ctx,
        label: 'シート表示: 列幅',
        detail: propName,
      });
    }
    _dbReflowPinnedColumnOffsets(table);
  };
  const syncValue = () => {
    const width = Math.max(60, Math.round(th.offsetWidth || parseFloat(th.style.width) || 100));
    handle.setAttribute('aria-valuemin', '60');
    handle.setAttribute('aria-valuemax', '800');
    handle.setAttribute('aria-valuenow', String(width));
  };
  syncValue();
  handle.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const current = Math.max(60, Math.round(th.offsetWidth || parseFloat(th.style.width) || 100));
    const step = e.shiftKey ? 40 : 8;
    applyWidth(current + (e.key === 'ArrowRight' ? step : -step));
  });
  handle.addEventListener('focus', syncValue);
}

function _dbReflowPinnedColumnOffsets(table) {
  if (!table) return;
  const headers = Array.from(table.querySelectorAll('thead th'));
  let left = 0;
  headers.forEach((th, colIndex) => {
    const isEntity = th.classList.contains('col-entity-header');
    const isEntityPinned = isEntity && th.style.position === 'sticky';
    const isPinned = th.classList.contains('col-pinned');
    if (isEntityPinned || isPinned) {
      th.style.left = left + 'px';
      table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
        const cell = tr.children[colIndex];
        if (cell && (isEntityPinned || cell.classList.contains('col-pinned'))) {
          cell.style.left = left + 'px';
        }
      });
      left += Math.max(60, Math.round(th.offsetWidth || parseFloat(th.style.width) || 100));
    }
  });
}

function _dbClampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function _dbCellDisplayConfig(dbPath) {
  const cfg = getDbViewConfig(dbPath);
  const overflow = cfg.cellTextOverflow === 'clip' ? 'clip' : 'wrap';
  const lines = _dbClampInt(cfg.cellWrapLines, 1, 10, 10);
  return { overflow, lines };
}

function syncDbCellDisplayToolbar(dbPath) {
  const btn = document.getElementById('btn-db-cell-wrap');
  if (!btn) return;
  const cfg = _dbCellDisplayConfig(dbPath);
  const active = cfg.overflow === 'wrap';
  const iconName = active ? 'wrapText' : 'scissors';
  btn.classList.toggle('active', active);
  btn.innerHTML = (typeof lucide === 'function') ? lucide(iconName, 16) : '';
  btn.title = active ? `折返し (${cfg.lines}行まで)` : '切り詰め';
  btn.setAttribute('aria-label', btn.title);
}

function setDbCellTextDisplay(dbPath, overflow, lines, options = {}) {
  if (!dbPath) return;
  const cfg = getDbViewConfig(dbPath);
  cfg.cellTextOverflow = overflow === 'clip' ? 'clip' : 'wrap';
  cfg.cellWrapLines = _dbClampInt(lines, 1, 10, cfg.cellWrapLines || 10);
  saveDbViewConfig(dbPath, cfg, {
    historyLabel: options.label || 'シート表示: セル折返し',
    historyDetail: cfg.cellTextOverflow === 'wrap' ? `${cfg.cellWrapLines}行` : '切り詰め',
    skipHistory: options.skipHistory === true,
  });
  const ctx = options.ctx
    || (typeof _dbPaneContextFromEvent === 'function' ? _dbPaneContextFromEvent(options.event, { dbPath }) : null)
    || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
  else if (typeof renderPivot === 'function') renderPivot(ctx);
}

function showDbCellWrapMenu(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(event, { dbPath: state.currentDbPath })
    : _currentPaneState();
  const dbPath = ctx?.dbPath || state.currentDbPath;
  if (!dbPath) return;
  document.querySelectorAll('.db-cell-wrap-menu').forEach(el => el.remove());
  const cfg = _dbCellDisplayConfig(dbPath);
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu db-cell-wrap-menu';
  menu.style.minWidth = '180px';

  const addItem = (label, icon, active, action) => {
    const item = document.createElement('div');
    item.className = 'gb-context-menu-item' + (active ? ' active' : '');
    item.innerHTML = lucide(icon, 14) + ' ' + label;
    item.addEventListener('click', () => {
      action();
      menu.remove();
    });
    menu.appendChild(item);
  };

  addItem('折り返し', 'wrapText', cfg.overflow === 'wrap', () => {
    setDbCellTextDisplay(dbPath, 'wrap', cfg.lines, { ctx, event });
  });
  addItem('切り詰め', 'scissors', cfg.overflow === 'clip', () => {
    setDbCellTextDisplay(dbPath, 'clip', cfg.lines, { ctx, event });
  });

  const row = document.createElement('label');
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;color:var(--fg);';
  const label = document.createElement('span');
  label.textContent = '最大行数';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.max = '10';
  input.value = String(cfg.lines);
  input.style.cssText = 'width:56px;padding:2px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;';
  const applyLines = () => {
    const nextLines = _dbClampInt(input.value, 1, 10, cfg.lines);
    input.value = String(nextLines);
    setDbCellTextDisplay(dbPath, 'wrap', nextLines, { ctx, event });
  };
  input.addEventListener('change', applyLines);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLines();
      menu.remove();
    }
  });
  row.appendChild(label);
  row.appendChild(input);
  menu.appendChild(row);

  const x = event?.clientX ?? 16;
  const y = event?.clientY ?? 16;
  const z = parseFloat(document.documentElement.style.zoom) || 1;
  menu.style.left = (x / z) + 'px';
  menu.style.top = (y / z) + 'px';
  document.body.appendChild(menu);
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function _dbTextLengthForWidth(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const longest = lines.reduce((max, line) => Math.max(max, [...line].length), 0);
  return Math.max(longest, [...String(text ?? '').replace(/\r?\n/g, '')].length);
}

function _dbEstimateWrapLines(text, widthChars) {
  const width = Math.max(1, widthChars || 1);
  const lines = String(text ?? '').split(/\r?\n/);
  return lines.reduce((sum, line) => {
    const len = Math.max(1, [...line].length);
    return sum + Math.ceil(len / width);
  }, 0);
}

function _dbTextForProp(entityName, propName, data, propTypes, advFilters, dbPath, filterMode) {
  const entityData = data?.entities?.[entityName] || {};
  const ptc = propTypes?.[propName];
  if (ptc?.source) {
    const metaVal = entityData['_' + ptc.source] ?? '';
    return metaVal == null ? '' : String(metaVal);
  }
  if (ptc?.type === 'formula' && ptc.formula && typeof formulaEvalForEntity === 'function') {
    const result = formulaEvalForEntity(ptc.formula, entityData, { propTypes, dbPath });
    return result?.error ? '' : String(result?.value ?? '');
  }
  let values = Object.prototype.hasOwnProperty.call(entityData, propName) && Array.isArray(entityData[propName])
    ? entityData[propName]
    : [];
  if (typeof filterValues === 'function') values = filterValues(values, undefined, filterMode);
  if (advFilters?.length && typeof applyAdvancedFilters === 'function') {
    values = applyAdvancedFilters(values, propName, advFilters);
  }
  return values.map(v => v?.value == null ? '' : String(v.value)).filter(Boolean).join(', ');
}

function _dbAutoWidthCharsForTexts(texts, headerText) {
  const values = texts.filter(Boolean);
  const lengths = values.map(_dbTextLengthForWidth);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  let chars = Math.max(4, Math.ceil(Math.max(avg, [...String(headerText || '')].length)));
  chars = Math.min(10, chars);
  if (values.some(text => _dbEstimateWrapLines(text, 10) > 3)) chars = Math.max(chars, 20);
  if (values.some(text => _dbEstimateWrapLines(text, 20) > 10)) chars = Math.max(chars, 30);
  if (values.some(text => _dbEstimateWrapLines(text, 30) > 10)) {
    const longest = lengths.length ? Math.max(...lengths) : chars;
    chars = Math.max(chars, Math.min(50, Math.ceil(longest / 10) * 10));
  }
  return Math.min(50, Math.max(4, chars));
}

function _dbAutoWidthCharsForEntryNames(entityNames) {
  const base = _dbAutoWidthCharsForTexts(entityNames, 'エントリ名');
  const maxNameLen = entityNames.length
    ? Math.max(...entityNames.map(name => _dbTextLengthForWidth(name)))
    : 0;
  return Math.max(base, Math.min(36, maxNameLen));
}

function _dbWidthPxFromChars(chars) {
  return Math.max(60, Math.min(640, Math.round(chars * 12 + 28)));
}

const DB_ENTITY_AUTO_WIDTH_CHROME_PX = 74;

function _dbEntityWidthPxFromChars(chars) {
  return Math.max(120, Math.min(640, _dbWidthPxFromChars(chars) + DB_ENTITY_AUTO_WIDTH_CHROME_PX));
}

function _dbAutoImageColumnWidth(propName, ptc) {
  const imageCellHeight = ptc?.options?.cell_height ?? ptc?.options?.cell_thumbnail_size;
  const cellSize = typeof _imagePropCellSize === 'function'
    ? _imagePropCellSize(ptc)
    : _dbClampInt(imageCellHeight, 32, 320, 96);
  const labelWidth = _dbWidthPxFromChars(Math.min(16, Math.max(4, [...String(propName || '')].length)));
  return Math.max(96, Math.min(260, Math.max(labelWidth, cellSize + 52)));
}

function autoFitCurrentSheetColumns(event) {
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(event, { dbPath: state.currentDbPath })
    : _currentPaneState();
  const data = ctx?.pivotData || state.pivotData;
  const dbPath = ctx?.dbPath || state.currentDbPath;
  if (!dbPath || !data?.entities) return;
  const viewMode = typeof _dbCurrentViewModeForContext === 'function'
    ? _dbCurrentViewModeForContext(ctx, dbPath)
    : (typeof getCurrentViewMode === 'function' ? getCurrentViewMode(dbPath, { ctx }) : 'pivot');
  if (viewMode === 'timeline' && typeof autoFitTimelineColumns === 'function') {
    autoFitTimelineColumns(ctx, dbPath);
    return;
  }
  if (viewMode !== 'pivot') {
    if (typeof showStatus === 'function') showStatus('列幅自動調整はテーブル表示とタイムライン表示で利用できます', true);
    return;
  }
  const cfg = getDbViewConfig(dbPath);
  const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
  const hiddenCols = getHiddenCols(dbPath, { ctx });
  const propTypes = getPropertyTypes(dbPath);
  const advFilters = getAdvancedFilters(dbPath, { ctx });
  const colOrder = getColOrder(dbPath, { ctx });
  let props = colOrder ? [...colOrder] : [...(data.properties || [])];
  props = [...new Set(props)];
  (data.properties || []).forEach(p => { if (!props.includes(p)) props.push(p); });
  Object.keys(propTypes || {}).forEach(p => { if (!props.includes(p)) props.push(p); });
  if (typeof filterDeletedDbProperties === 'function') props = filterDeletedDbProperties(dbPath, props);
  const visibleProps = props.filter(p => !hiddenCols.includes(p));
  const entityNames = Object.keys(data.entities || {});
  const currentView = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfg)
    : null;
  const widthTarget = currentView || cfg;

  widthTarget.colWidths = { ...(widthTarget.colWidths || {}) };
  const entityChars = _dbAutoWidthCharsForEntryNames(entityNames);
  widthTarget.colWidths.__entity__ = _dbEntityWidthPxFromChars(entityChars);
  visibleProps.forEach(propName => {
    const ptc = propTypes?.[propName] || {};
    if (ptc?.type === 'image') {
      widthTarget.colWidths[propName] = _dbAutoImageColumnWidth(propName, ptc);
      return;
    }
    const texts = entityNames.map(name => _dbTextForProp(name, propName, data, propTypes, advFilters, dbPath, ctx?.filter));
    widthTarget.colWidths[propName] = _dbWidthPxFromChars(_dbAutoWidthCharsForTexts(texts, propName));
  });
  cfg.cellWrapLines = _dbClampInt(cfg.cellWrapLines, 1, 10, 10);
  saveDbViewConfig(dbPath, cfg, { skipHistory: true });
  if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
    pushDbViewConfigHistory(dbPath, 'シート表示: 列幅自動調整', before, captureDbViewConfigHistory(dbPath), '全列');
  }
  renderPivot(ctx);
  if (typeof showStatus === 'function') showStatus('列幅を自動調整しました');
}

function renderPivot(ctx) {
  const renderPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  ctx = typeof _normalizeDbRenderContext === 'function' ? _normalizeDbRenderContext(ctx) : (ctx || _currentPaneState());
  const data = ctx.pivotData || state.pivotData;
  if (!data || !data.properties || !data.entities) { clearPivot(ctx); return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const filterMode = ctx.filter ?? state.filter ?? 'disabled';
  const hiddenCols = getHiddenCols(dbPath, { ctx });
  const pinnedCols = getPinnedCols(dbPath, { ctx });
  const colOrder = getColOrder(dbPath, { ctx });
  const condFmt = getConditionalFormat(dbPath, { ctx });
  const thumbSize = getThumbnailSize(dbPath, { ctx });
  const savedWidths = getColWidths(dbPath, { ctx });
  const advFilters = getAdvancedFilters(dbPath, { ctx });
  const propTypes = getPropertyTypes(dbPath);
  const groupByProp = getGroupBy(dbPath);

  // カラム順序適用（非表示カラムは除外）
  // colOrderにあるがdata.propertiesに無い空列も保持する
  let props = colOrder ? [...colOrder] : [...data.properties];
  // colOrder が過去の不整合で重複を含んでいた場合の防御
  props = [...new Set(props)];
  // colOrderに含まれない新規プロパティを末尾に追加
  data.properties.forEach(p => { if (!props.includes(p)) props.push(p); });
  // property_types に定義されているがデータに存在しないプロパティも追加（テンプレート適用直後等）
  if (propTypes) {
    Object.keys(propTypes).forEach(p => { if (!props.includes(p)) props.push(p); });
  }
  if (typeof filterDeletedDbProperties === 'function') props = filterDeletedDbProperties(dbPath, props);
  const visibleProps = props.filter(p => !hiddenCols.includes(p));

  const entitiesMap = data.entities;
  // エントリのソート（ソート設定に基づく）
  // 互換テスト用: const sortCfg = (typeof getDbSortConfig === 'function' ? getDbSortConfig(dbPath) : getDbViewConfig(dbPath).sortConfig)
  const sortCfg = (typeof getDbSortConfig === 'function' ? getDbSortConfig(dbPath, { ctx }) : getDbViewConfig(dbPath).sortConfig)
    || { key: 'name', dir: 'asc' };
  // 互換テスト用: const manualOrder = typeof getDbManualOrder === 'function' ? getDbManualOrder(dbPath) : getDbViewConfig(dbPath).manualOrder;
  const manualOrder = typeof getDbManualOrder === 'function' ? getDbManualOrder(dbPath, { ctx }) : getDbViewConfig(dbPath).manualOrder;
  let entityNames = Object.keys(entitiesMap);
  if (sortCfg.key === 'manual' && manualOrder) {
    const order = manualOrder;
    entityNames.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0 && ib < 0) return a.localeCompare(b);
      if (ia < 0) return 1; if (ib < 0) return -1;
      return ia - ib;
    });
  } else if (sortCfg.key === 'name') {
    entityNames.sort((a, b) => sortCfg.dir === 'desc' ? b.localeCompare(a) : a.localeCompare(b));
  } else {
    // プロパティ値でソート — 採用/掲載済み値を型に応じて比較
    const sortPtc = propTypes?.[sortCfg.key] || {};
    const sortType = sortPtc.type || 'text';
    const _adoptedStr = (v) => {
      if (!Array.isArray(v)) return v == null ? '' : String(v);
      const picked = v.find(x => x && (x.status === '採用' || x.status === '掲載済み'))
                  || v.find(x => x && x.status === '案')
                  || v[0];
      return picked && picked.value != null ? String(picked.value) : '';
    };
    const _sortValue = (entityName) => {
      if (sortPtc.source || sortPtc.type === 'formula') {
        return _dbTextForProp(entityName, sortCfg.key, data, propTypes, advFilters, dbPath, filterMode);
      }
      const entityData = entitiesMap[entityName] || {};
      const rawValues = Object.prototype.hasOwnProperty.call(entityData, sortCfg.key) && Array.isArray(entityData[sortCfg.key])
        ? entityData[sortCfg.key]
        : [];
      return _adoptedStr(rawValues);
    };
    const _toNum = (s) => { const n = parseFloat(s); return isNaN(n) ? null : n; };
    const _toDate = (s) => { const t = Date.parse(s); return isNaN(t) ? null : t; };
    entityNames.sort((a, b) => {
      const sa = _sortValue(a);
      const sb = _sortValue(b);
      // 空値は常に末尾へ
      if (!sa && !sb) return 0;
      if (!sa) return 1;
      if (!sb) return -1;
      let cmp;
      if (sortType === 'number' || sortType === 'formula') {
        const na = _toNum(sa), nb = _toNum(sb);
        if (na != null && nb != null) cmp = na - nb;
        else if (na != null) cmp = -1;
        else if (nb != null) cmp = 1;
        else cmp = sa.localeCompare(sb);
      } else if (sortType === 'date') {
        const da = _toDate(sa), db = _toDate(sb);
        if (da != null && db != null) cmp = da - db;
        else if (da != null) cmp = -1;
        else if (db != null) cmp = 1;
        else cmp = sa.localeCompare(sb);
      } else {
        cmp = sa.localeCompare(sb);
      }
      return sortCfg.dir === 'desc' ? -cmp : cmp;
    });
  }
  // Step 2: チャンク分割中の D&D で manualOrder 初期化に使う (DOM 未完成時のフォールバック)
  ctx._lastEntityNames = entityNames;
  const renderRowLimit = _dbEffectiveRenderRowLimit(ctx, entityNames, visibleProps);
  const isRenderLimited = renderRowLimit > 0 && renderRowLimit < entityNames.length;
  const shownEntityCount = isRenderLimited ? renderRowLimit : entityNames.length;
  const selectedCols = _getSelectedColumns(dbPath);

  // エントリ0件でもテーブルを描画（＋新規エントリ行を表示するため）

  // テーブルセレクタヘルパー（スプリットビュー対応: ペインごとにテーブルIDが異なる）
  const _tblId = ctx.tableId || 'pivot-table';
  const _tbl = (sub) => '#' + _tblId + (sub ? ' ' + sub : '');
  const thead = _paneEl(ctx, _tbl('thead'));
  const tbody = _paneEl(ctx, _tbl('tbody'));
  if (!thead || !tbody) {
    if (typeof showStatus === 'function') showStatus('シート表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }

  // 枠線設定の適用（DB個別）
  const gridCfg = getDbViewConfig(dbPath);
  const gridH = gridCfg.gridH || { width: '1px', color: '' };
  const gridV = gridCfg.gridV || { width: '1px', color: '' };
  const entityColumnPinned = typeof getEntityColumnPinned === 'function'
    ? getEntityColumnPinned(dbPath, { ctx })
    : gridCfg.entityColumnPinned !== false;
  const tblEl = _paneEl(ctx, _tbl());
  if (tblEl) {
    tblEl.classList.add('pivot-table');
    tblEl.setAttribute('role', 'table');
    tblEl.setAttribute('aria-label', 'シート');
    const hW = gridH.width === 'none' ? '0' : gridH.width;
    const vW = gridV.width === 'none' ? '0' : gridV.width;
    const hC = gridH.color || 'var(--db-grid-border)';
    const vC = gridV.color || 'var(--db-grid-border)';
    tblEl.style.setProperty('--db-grid-h', hW);
    tblEl.style.setProperty('--db-grid-v', vW);
    tblEl.style.setProperty('--db-grid-h-color', hC);
    tblEl.style.setProperty('--db-grid-v-color', vC);
    tblEl.classList.toggle('entity-col-unpinned', !entityColumnPinned);
    const cellDisplay = _dbCellDisplayConfig(dbPath);
    tblEl.dataset.cellOverflow = cellDisplay.overflow;
    tblEl.dataset.cellWrapLines = String(cellDisplay.lines);
    tblEl.style.setProperty('--db-cell-wrap-lines', String(cellDisplay.lines));
  }
  syncDbCellDisplayToolbar(dbPath);

  // ヘッダー
  const headerRow = document.createElement('tr');
  headerRow.setAttribute('role', 'row');
  const th0 = document.createElement('th');
  th0.className = 'col-entity-header';
  th0.dataset.e2eId = _dbE2eId(ctx, 'column-header', 'entity');
  const entityColumnLabel = _dbEntityColumnDisplayLabel(dbPath);
  _setupDbColumnHeaderA11y(th0, entityColumnLabel);
  if (selectedCols.includes('__entity__')) th0.classList.add('col-selected');
  th0.style.position = entityColumnPinned ? 'sticky' : 'relative';
  th0.style.left = entityColumnPinned ? '0px' : '';
  th0.style.zIndex = entityColumnPinned ? '11' : '';
  // エントリ名列の幅（永続化）
  const _entityW = (savedWidths['__entity__'] || _dbDefaultEntityColumnWidth(dbPath));
  th0.style.width = _entityW + 'px';
  th0.style.minWidth = _entityW + 'px';
  const th0Label = document.createElement('span');
  th0Label.className = 'th-label';
  th0Label.textContent = entityColumnLabel;
  th0.appendChild(th0Label);
  const th0MoreBtn = document.createElement('span');
  th0MoreBtn.className = 'th-more-btn entity-th-more-btn';
  th0MoreBtn.innerHTML = lucide('moreHorizontal', 14);
  th0MoreBtn.title = '列メニュー';
  th0MoreBtn.setAttribute('aria-label', entityColumnLabel + '列メニュー');
  th0MoreBtn.style.cssText = 'position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0;padding:2px 3px;border-radius:3px;cursor:pointer;background:var(--bg2);display:inline-flex;align-items:center;transition:opacity 0.1s;z-index:2;';
  th0MoreBtn.addEventListener('mouseenter', () => { th0MoreBtn.style.background = 'var(--bg4)'; });
  th0MoreBtn.addEventListener('mouseleave', () => { th0MoreBtn.style.background = 'var(--bg2)'; });
  th0MoreBtn.addEventListener('click', (e) => { e.stopPropagation(); showEntityColMenu(e); });
  th0.appendChild(th0MoreBtn);
  th0.style.cursor = 'pointer';
  th0.addEventListener('mouseenter', () => { th0MoreBtn.style.opacity = '1'; });
  th0.addEventListener('mouseleave', () => { th0MoreBtn.style.opacity = '0'; });
  th0.addEventListener('contextmenu', (e) => { e.preventDefault(); showEntityColMenu(e); });
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(th0, (e) => showEntityColMenu(e));
  }
  th0.addEventListener('click', (e) => {
    if (e.target.closest('.col-resize-handle, .th-more-btn')) return;
    e.stopPropagation();
    _setSelectedColumns(dbPath, ['__entity__'], '__entity__');
    _applySelectedColumnClasses(ctx, dbPath);
    if (typeof showDbPropertySettingsForColumn === 'function') {
      showDbPropertySettingsForColumn(dbPath, '__entity__');
    }
  });
  // リサイズハンドル
  const th0Handle = document.createElement('div');
  th0Handle.className = 'col-resize-handle';
  th0Handle.dataset.e2eId = _dbE2eId(ctx, 'column-resize', 'entity');
  _setupDbColumnResizeHandleA11y(th0Handle, th0, 0, '__entity__', dbPath, ctx);
  th0Handle.addEventListener('pointerdown', (e) => startColResize(e, th0, 0, '__entity__'));
  th0Handle.addEventListener('click', (e) => { e.stopPropagation(); });
  th0Handle.addEventListener('dblclick', (e) => { e.stopPropagation(); });
  th0.appendChild(th0Handle);
  // D&D受け取り（他の列をエントリ名列の左側にドロップ）
  th0.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/x-col-name')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    th0.classList.add('col-drop-right');
  });
  th0.addEventListener('dragleave', () => th0.classList.remove('col-drop-right'));
  th0.addEventListener('drop', (e) => {
    e.preventDefault();
    const fromName = e.dataTransfer.getData('text/x-col-name');
    th0.classList.remove('col-drop-right');
    if (!fromName) return;
    // エントリ名列の直後に移動 = visible 列の先頭。hidden 列は末尾保持
    const arr = visibleProps.filter(n => n !== fromName);
    arr.unshift(fromName);
    const oldOrder = getColOrder(dbPath, { ctx }) || [];
    const hiddenInOrder = oldOrder.filter(n => hiddenCols.includes(n) && !arr.includes(n));
    setColOrder(dbPath, [...arr, ...hiddenInOrder], { ctx });
    renderPivot(ctx);
  });
  headerRow.appendChild(th0);

  let pinnedLeftOffset = entityColumnPinned ? _entityW : 0; // エントリ列を固定しない場合は左端から固定列を始める
  visibleProps.forEach((p, i) => {
    const th = document.createElement('th');
    const ptcHeader = propTypes[p];
    th.dataset.prop = p;
    th.dataset.e2eId = _dbE2eId(ctx, 'column-header', p);
    _setupDbColumnHeaderA11y(th, p);
    const w = savedWidths[p] || 100;
    th.style.width = w + 'px';
    th.style.minWidth = w + 'px';
    if (selectedCols.includes(p)) th.classList.add('col-selected');

    // ヘッダーラベル（タイプアイコン＋テキスト）
    const typeIcon = document.createElement('span');
    typeIcon.className = 'th-type-icon';
    typeIcon.style.cssText = 'opacity:0.8;margin-right:4px;';
    typeIcon.innerHTML = lucide(PROP_TYPE_ICON[ptcHeader?.type] || PROP_TYPE_ICON.text, 14);
    th.appendChild(typeIcon);
    const labelSpan = document.createElement('span');
    labelSpan.className = 'th-label';
    labelSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    labelSpan.textContent = p;
    th.appendChild(labelSpan);

    // 列ロック / sourceインジケータ
    const _ptcHeader2 = propTypes[p];
    if (_ptcHeader2 && _ptcHeader2.source) {
      const autoIcon = document.createElement('span');
      autoIcon.className = 'th-lock-icon';
      autoIcon.style.cssText = 'opacity:0.5;margin-left:4px;flex-shrink:0;';
      autoIcon.innerHTML = lucide('zap', 12);
      autoIcon.title = '自動入力（読み取り専用）';
      th.appendChild(autoIcon);
    } else {
      const _colLock = getColumnLock(dbPath, p);
      if (_colLock !== 'none') {
        const lockIcon = document.createElement('span');
        lockIcon.className = 'th-lock-icon';
        lockIcon.style.cssText = 'opacity:0.5;margin-left:4px;flex-shrink:0;';
        lockIcon.innerHTML = lucide(_colLock === 'locked' ? 'lock' : 'shield', 12);
        lockIcon.title = _colLock === 'locked' ? 'ロック' : '管理者のみ編集';
        th.appendChild(lockIcon);
      }
    }

    // ピン留め
    if (pinnedCols.includes(p)) {
      th.classList.add('col-pinned');
      th.style.left = pinnedLeftOffset + 'px';
      pinnedLeftOffset += w;
    }

    // ホバー表示の「...」ボタン（メニュー起動）
    const moreBtn = document.createElement('span');
    moreBtn.className = 'th-more-btn';
    moreBtn.innerHTML = lucide('moreHorizontal', 14);
    moreBtn.title = '列メニュー';
    moreBtn.style.cssText = 'position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0;padding:2px 3px;border-radius:3px;cursor:pointer;background:var(--bg2);display:inline-flex;align-items:center;transition:opacity 0.1s;z-index:2;';
    moreBtn.addEventListener('mouseenter', () => { moreBtn.style.background = 'var(--bg4)'; });
    moreBtn.addEventListener('mouseleave', () => { moreBtn.style.background = 'var(--bg2)'; });
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showColHeaderMenu(e, p, i); });
    th.appendChild(moreBtn);
    th.style.position = 'relative';
    th.addEventListener('mouseenter', () => { moreBtn.style.opacity = '1'; });
    th.addEventListener('mouseleave', () => { moreBtn.style.opacity = '0'; });

    // リサイズハンドル
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    handle.dataset.e2eId = _dbE2eId(ctx, 'column-resize', p);
    _setupDbColumnResizeHandleA11y(handle, th, i + 1, p, dbPath, ctx);
    handle.addEventListener('pointerdown', (e) => startColResize(e, th, i + 1, p));
    handle.addEventListener('click', (e) => { e.stopPropagation(); });
    handle.addEventListener('dblclick', (e) => { e.stopPropagation(); });
    th.appendChild(handle);

    // D&D 列並び替え
    th.draggable = true;
    th.addEventListener('dragstart', (e) => {
      if (e.target.closest('.col-resize-handle, .th-more-btn, .th-rename-input')) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/x-col-name', p);
      e.dataTransfer.effectAllowed = 'move';
      th.classList.add('col-dragging');
    });
    th.addEventListener('dragend', () => th.classList.remove('col-dragging'));
    th.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-col-name')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = th.getBoundingClientRect();
      const isLeft = (e.clientX - rect.left) < rect.width / 2;
      th.classList.toggle('col-drop-left', isLeft);
      th.classList.toggle('col-drop-right', !isLeft);
    });
    th.addEventListener('dragleave', () => { th.classList.remove('col-drop-left', 'col-drop-right'); });
    th.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromName = e.dataTransfer.getData('text/x-col-name');
      const isLeft = th.classList.contains('col-drop-left');
      th.classList.remove('col-drop-left', 'col-drop-right');
      if (!fromName || fromName === p) return;
      // 現在表示中の visible 順序を起点にする (colOrder が古い場合の防御)
      // visibleProps は forEach 外のクロージャから参照できる
      const arr = visibleProps.filter(n => n !== fromName);
      const idx = arr.indexOf(p);
      const insertIdx = idx >= 0 ? idx + (isLeft ? 0 : 1) : arr.length;
      arr.splice(insertIdx, 0, fromName);
      // hidden 列は元の colOrder の順序のまま末尾に保持
      const oldOrder = getColOrder(dbPath, { ctx }) || [];
      const hiddenInOrder = oldOrder.filter(n => hiddenCols.includes(n) && !arr.includes(n));
      const newOrder = [...arr, ...hiddenInOrder];
      setColOrder(dbPath, newOrder, { ctx });
      renderPivot(ctx);
    });

    // シングルクリック → プロパティメニュー（Notion風）
    th.addEventListener('click', (e) => {
      if (e.target.closest('.col-resize-handle')) return;
      if (th.querySelector('.th-rename-input')) return;
      let nextSelected;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const current = _getSelectedColumns(dbPath);
        if (e.shiftKey) {
          const anchor = _dbSelectedColumns.dbPath === dbPath ? _dbSelectedColumns.anchor : '';
          const startIdx = visibleProps.indexOf(anchor || p);
          const endIdx = visibleProps.indexOf(p);
          if (startIdx >= 0 && endIdx >= 0) {
            const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            nextSelected = visibleProps.slice(lo, hi + 1);
            _setSelectedColumns(dbPath, nextSelected, anchor || p);
          } else {
            nextSelected = [p];
            _setSelectedColumns(dbPath, nextSelected, p);
          }
        } else {
          nextSelected = current.includes(p) ? current.filter(name => name !== p) : [...current, p];
          _setSelectedColumns(dbPath, nextSelected, p);
        }
        _applySelectedColumnClasses(ctx, dbPath);
        if (typeof showDbPropertySettingsForColumn === 'function') {
          showDbPropertySettingsForColumn(dbPath, nextSelected.length === 1 ? nextSelected[0] : '', { switchTab: true });
        }
        return;
      }
      const currentSelected = _getSelectedColumns(dbPath);
      if (!currentSelected.includes(p) || currentSelected.length > 1 || currentSelected.includes('__entity__')) {
        nextSelected = [p];
        _setSelectedColumns(dbPath, nextSelected, p);
      }
      if (typeof showDbPropertySettingsForColumn === 'function') {
        showDbPropertySettingsForColumn(dbPath, p);
      }
      _applySelectedColumnClasses(ctx, dbPath);
    });

    // ダブルクリック → インラインリネーム
    th.addEventListener('dblclick', (e) => {
      if (e.target.closest('.col-resize-handle')) return;
      e.stopPropagation();
      closeColHeaderMenu();
      startHeaderInlineRename(th, p, dbPath);
    });

    // 右クリックメニュー ＋ 長押しで同メニュー（タッチ/ペン）
    th.addEventListener('contextmenu', (e) => { e.preventDefault(); showColHeaderMenu(e, p, i); });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(th, (e) => showColHeaderMenu(e, p, i));
    }
    headerRow.appendChild(th);
  });

  // ＋プロパティ追加列（ヘッダー末尾）
  const thAdd = document.createElement('th');
  thAdd.className = 'col-add-prop';
  thAdd.dataset.e2eId = _dbE2eId(ctx, 'column-add-prop');
  _setupDbColumnHeaderA11y(thAdd, 'プロパティを追加');
  thAdd.style.cssText = 'width:36px;min-width:36px;text-align:center;cursor:pointer;color:var(--fg2);padding:0;';
  thAdd.title = 'プロパティを追加';
  thAdd.innerHTML = lucide('plus', 16);
  thAdd.addEventListener('click', () => {
    const order = getColOrder(dbPath, { ctx }) || [...props];
    const existingNames = new Set([
      ...order,
      ...props,
      ...(typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, data.properties || []) : (data.properties || [])),
      ...Object.keys(propTypes || {}),
    ]);
    let idx = 1, name = 'プロパティ';
    while (existingNames.has(name)) { idx++; name = 'プロパティ' + idx; }
    order.push(name);
    setColOrder(dbPath, order, { skipHistory: true, ctx });
    setPropertyType(dbPath, name, { type: 'text' });
    renderPivot(ctx);
  });

  thAdd.onmouseenter = () => { if (!thAdd.querySelector('input')) thAdd.style.color = 'var(--accent)'; };
  thAdd.onmouseleave = () => { if (!thAdd.querySelector('input')) thAdd.style.color = 'var(--fg2)'; };
  headerRow.appendChild(thAdd);

  thead.innerHTML = '';
  thead.appendChild(headerRow);

  // ボディ
  if (typeof _dbDisposeVirtualRows === 'function') {
    if (tblEl?._dbVirtualRows?.ctx && tblEl._dbVirtualRows.ctx !== ctx) _dbDisposeVirtualRows(tblEl._dbVirtualRows.ctx); _dbDisposeVirtualRows(ctx);
  }
  tbody.innerHTML = '';
  // D-4-a: tbody click 委譲を登録 (べき等。再 render 時は ctx だけ更新)
  _installTbodyDelegation(tbody, ctx);

  // グループ化処理
  let groupedEntities;
  if (groupByProp && visibleProps.includes(groupByProp)) {
    groupedEntities = new Map();
    const groupPtc = propTypes[groupByProp];
    entityNames.forEach(en => {
      let groupKey;
      if (groupPtc && groupPtc.type === 'formula' && groupPtc.formula) {
        const result = formulaEvalForEntity(groupPtc.formula, entitiesMap[en], { propTypes, dbPath });
        groupKey = result.error ? '#ERROR' : (result.value === '' ? '(未設定)' : String(result.value));
      } else {
        const entityData = entitiesMap[en] || {};
        const rawVals = Object.prototype.hasOwnProperty.call(entityData, groupByProp) && Array.isArray(entityData[groupByProp])
          ? entityData[groupByProp]
          : [];
        const vals = filterValues(rawVals, undefined, filterMode);
        const firstValue = vals.length > 0 ? vals[0].value : '';
        groupKey = firstValue === '' || firstValue == null ? '(未設定)' : String(firstValue);
      }
      if (!groupedEntities.has(groupKey)) groupedEntities.set(groupKey, []);
      groupedEntities.get(groupKey).push(en);
    });
  } else {
    groupedEntities = new Map([['', entityNames]]);
  }

  // 折りたたみ状態
  if (!window._groupCollapsed) window._groupCollapsed = {};

  const entityRowOpts = {
    visibleProps, propTypes, entitiesMap, entityNames,
    dbPath, condFmt, thumbSize, savedWidths, advFilters, pinnedCols,
    selectedCols, _entityW, _tbl, _tblId, entityColumnPinned,
  };

  // 行生成タスクをフラット化 (グループヘッダー + エントリ行を順序通りに並べる)
  // チャンク分割レンダリングで使用 (Step2)
  const rowTasks = [];
  let pushedEntityRows = 0;
  groupedEntities.forEach((names, groupKey) => {
    if (isRenderLimited && pushedEntityRows >= renderRowLimit) return;
    if (groupKey !== '') {
      rowTasks.push({ kind: 'group', groupKey, names });
      if (_isGroupCollapsed(ctx, groupKey)) return;
    }
    for (const entityName of names) {
      if (isRenderLimited && pushedEntityRows >= renderRowLimit) break;
      rowTasks.push({ kind: 'entity', entityName });
      pushedEntityRows++;
    }
  });

  const paneRoot = _paneEl(ctx, _tbl()) || document;
  if (ctx?._dragSelectPointerUp) {
    document.removeEventListener('pointerup', ctx._dragSelectPointerUp);
    document.removeEventListener('pointercancel', ctx._dragSelectPointerUp);
  }
  if (paneRoot._dragSelectPointerUp) document.removeEventListener('pointerup', paneRoot._dragSelectPointerUp);
  if (paneRoot._dragSelectPointerUp) document.removeEventListener('pointercancel', paneRoot._dragSelectPointerUp);
  paneRoot._dragSelectPointerUp = () => {
    paneRoot._dragSelectState = null;
    if (ctx) ctx._dragSelectState = null;
  };
  if (ctx) ctx._dragSelectPointerUp = paneRoot._dragSelectPointerUp;
  document.addEventListener('pointerup', paneRoot._dragSelectPointerUp);
  document.addEventListener('pointercancel', paneRoot._dragSelectPointerUp);

  // 常に末尾に「＋新規エントリ」行を表示（Notion風）
  // 大規模シートも初期状態から全件スクロール可能にし、実DOMは仮想スクロールで画面周辺だけ作る。
  const renderMoreRow = null;
  const newEntryRow = renderNewEntryRow(ctx, { visibleProps, entitiesMap, dbPath, selectedCols, _tbl, _entityW });
  tbody.appendChild(newEntryRow);
  const newEntrySpacerRow = document.createElement('tr');
  newEntrySpacerRow.className = 'new-entity-spacer-row';
  newEntrySpacerRow.setAttribute('aria-hidden', 'true');
  newEntrySpacerRow.setAttribute('role', 'presentation');
  const newEntrySpacerCell = document.createElement('td');
  newEntrySpacerCell.colSpan = visibleProps.length + 2;
  newEntrySpacerRow.appendChild(newEntrySpacerCell);
  tbody.appendChild(newEntrySpacerRow);

  // フッター集計行 (entityNames は確定済みなので即時計算)
  renderPivotFooter(visibleProps, entitiesMap, entityNames, pinnedCols, savedWidths, propTypes, ctx);

  const countEl = _paneEl(ctx, '#sb-count') || document.getElementById('sb-count');
  if (countEl) countEl.textContent = isRenderLimited
    ? entityNames.length + ' 件 (' + shownEntityCount + '件表示)'
    : entityNames.length + ' 件';

  // ----- Step 2: チャンク分割レンダリング -----
  // 中断トークン: ctx._renderToken に Symbol を割り振る。
  // 後続の renderPivot 呼び出し / destroyPaneContext 等で _renderToken が変わると進行中チャンクは破棄される。
  const renderToken = Symbol('renderPivot');
  ctx._renderToken = renderToken;
  ctx._renderInProgress = true;
  ctx._renderTotalRows = rowTasks.length;
  ctx._renderDoneRows = 0;

  const virtualRowsEnabled = typeof _dbShouldUseVirtualRows === 'function' && _dbShouldUseVirtualRows(ctx, rowTasks, { visibleProps, propTypes, thumbSize });
  if (virtualRowsEnabled && typeof _dbRunVirtualRowRenderer === 'function'
      && _dbRunVirtualRowRenderer(ctx, { rowTasks, tbody, renderToken, renderMoreRow, newEntryRow, visibleProps, groupByProp, entityRowOpts, propTypes, thumbSize, renderPerfStartedAt, dbPath, entityNames, renderRowLimit })) return;

  const CHUNK_SIZE = 100; // ベンチマーク用閾値 (100行/チャンク)

  // チャンクを 1 つ生成して tbody に挿入する
  // 最初のチャンクは同期、残りは requestIdleCallback で。
  const _renderChunk = (startIdx) => {
    // 中断チェック: トークンが書き換わっていれば破棄
    if (ctx._renderToken !== renderToken) return;
    const endIdx = Math.min(startIdx + CHUNK_SIZE, rowTasks.length);
    // DocumentFragment でまとめて挿入 (reflow 削減)
    const frag = document.createDocumentFragment();
    for (let i = startIdx; i < endIdx; i++) {
      const task = rowTasks[i];
      if (task.kind === 'group') {
        frag.appendChild(renderGroupHeaderRow(task.groupKey, task.names, visibleProps, groupByProp, ctx));
      } else {
        frag.appendChild(renderEntityRow(task.entityName, ctx, entityRowOpts));
      }
    }
    // 中断チェック (ループ中に破棄された可能性)
    if (ctx._renderToken !== renderToken) return;
    // 新規エントリ行の前に挿入 → 常に末尾に新規エントリ行を維持
    tbody.insertBefore(frag, renderMoreRow || newEntryRow);
    ctx._renderDoneRows = endIdx;
    if (endIdx < rowTasks.length) {
      // 残りを idle callback で処理
      const scheduleNextChunk = (cb) => {
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 120 });
        else setTimeout(cb, 0);
      };
      scheduleNextChunk(() => _renderChunk(endIdx));
    } else {
      ctx._renderInProgress = false;
      // Phase 2e-ii-b: 全チャンク完了後にセルコメントバッジを描画
      _refreshSheetBadges(ctx);
      if (typeof _appendBacklinkSummaryColumns === 'function') _appendBacklinkSummaryColumns(ctx);
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('sheet.renderPivot.complete', renderPerfStartedAt, {
          targetLabel: String(dbPath || '').split(/[\\/]/).filter(Boolean).pop() || String(dbPath || ''),
          entityCount: entityNames.length,
          propertyCount: visibleProps.length,
          rowTaskCount: rowTasks.length,
          renderRowLimit,
          renderedRows: ctx._renderDoneRows,
        });
      }
    }
  };

  // 最初の CHUNK_SIZE 行は同期で生成 → 即座に表示
  if (rowTasks.length > 0) {
    _renderChunk(0);
  } else {
    ctx._renderInProgress = false;
    _refreshSheetBadges(ctx);
    if (typeof _appendBacklinkSummaryColumns === 'function') _appendBacklinkSummaryColumns(ctx);
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('sheet.renderPivot.complete', renderPerfStartedAt, {
        targetLabel: String(dbPath || '').split(/[\\/]/).filter(Boolean).pop() || String(dbPath || ''),
        entityCount: entityNames.length,
        propertyCount: visibleProps.length,
        rowTaskCount: rowTasks.length,
        renderRowLimit,
        renderedRows: 0,
      });
    }
  }
}

function _refreshSheetBadges(ctx) {
  if (typeof CommentBadges === 'undefined') return;
  try {
    const dbPath = ctx?.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '');
    const tableId = (ctx && ctx.tableId) || 'pivot-table';
    const tbl = _paneEl(ctx, '#' + tableId) || document.querySelector('#pivot-table') || document.querySelector('table.pivot-table');
    if (tbl && dbPath) {
      tbl.dataset.dbPath = dbPath;
      tbl.dataset.path = dbPath;
    }
    if (dbPath && tbl) CommentBadges.refreshSheet(dbPath, tbl);
  } catch {}
}
