function _applySelectedColumnClasses(ctx, dbPath) {
  const table = typeof _currentPivotTable === 'function'
    ? _currentPivotTable(ctx)
    : (!ctx ? document.getElementById('pivot-table') : null);
  if (!table) return;
  const selected = typeof _getSelectedColumns === 'function' ? _getSelectedColumns(dbPath) : [];
  table.querySelectorAll('th.col-selected, td.col-selected').forEach(el => el.classList.remove('col-selected'));
  if (selected.includes('__entity__')) {
    table.querySelector('thead th.col-entity-header')?.classList.add('col-selected');
    table.querySelectorAll('tbody td.col-entity, tfoot td.col-entity').forEach(td => td.classList.add('col-selected'));
  }
  selected.forEach(propName => {
    if (propName === '__entity__') return;
    const cssProp = MeldexEscape.cssIdent(propName);
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

// パスから決まる既定のエントリ名列ラベル（制作管理シートは固定名）
function _dbDefaultEntityColumnLabel(dbPath) {
  const parts = String(dbPath || '').replace(/\\/g, '/').replace(/\/+$/g, '').split('/').filter(Boolean);
  if (parts.length < 3 || parts[parts.length - 3] !== '制作管理' || parts[parts.length - 2] !== 'シート') {
    return 'トピック名';
  }
  const sheetName = parts[parts.length - 1];
  if (sheetName === 'タスクリスト' || sheetName.startsWith('タスクリスト_')) return 'タスク名';
  return ({
    '作品リスト': '作品名',
    '作業対象リスト': '作業対象名',
    '作業内容リスト': '作業内容名',
    '作業規模リスト': '作業規模名',
    'スタッフリスト': 'スタッフ名',
  })[sheetName] || 'トピック名';
}

// 表示用ラベル。制作管理以外のシートでは、ユーザーがビュー設定に保存した任意名を優先する。
function _dbEntityColumnDisplayLabel(dbPath, options) {
  const isProduction = typeof isProductionManagementSheetPath === 'function'
    && isProductionManagementSheetPath(dbPath);
  if (!isProduction && typeof getEntityColumnLabel === 'function') {
    const custom = getEntityColumnLabel(dbPath, options || {});
    if (custom) return custom;
  }
  return _dbDefaultEntityColumnLabel(dbPath);
}

function _dbDefaultEntityColumnWidth(dbPath) {
  // 幅の目安は既定ラベル基準（任意名を付けても既定の幅感を保つ）
  const label = _dbDefaultEntityColumnLabel(dbPath);
  return label === 'タスク名' ? 260 : (label === 'トピック名' ? 120 : 180);
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
    th.style.maxWidth = nextWidth + 'px';
    handle.setAttribute('aria-valuenow', String(nextWidth));
    const table = th.closest('table');
    if (table) {

      table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
        const cell = tr.children[colIndex];
        if (cell) {
          cell.style.width = nextWidth + 'px';
          cell.style.minWidth = nextWidth + 'px';
          cell.style.maxWidth = nextWidth + 'px';
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
  // 行先頭コントロール列（常時先頭固定）の分だけ、後続の固定列オフセットを右にずらす。
  const controlsHeader = headers.find(th => th.classList.contains('col-row-controls-header'));
  let left = controlsHeader
    ? Math.max(0, Math.round(controlsHeader.offsetWidth || parseFloat(controlsHeader.style.width) || 52))
    : 0;
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
  _dbAlignPinnedColumnSeams(table);
  _dbSchedulePinnedColumnSeamAlignment(table);
}

function _dbPinnedColumnCells(table, header, colIndex, isEntityPinned) {
  const cells = [header];
  table.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
    const cell = tr.children[colIndex];
    if (!cell) return;
    if (isEntityPinned ? cell.classList.contains('col-entity') : cell.classList.contains('col-pinned')) {
      cells.push(cell);
    }
  });
  return cells;
}

function _dbSetPinnedColumnShift(table, entry, shiftPx) {
  const transform = Math.abs(shiftPx) > 0.25 ? `translateX(${shiftPx}px)` : '';
  _dbPinnedColumnCells(table, entry.header, entry.colIndex, entry.isEntityPinned).forEach(cell => {
    cell.style.transform = transform;
  });
}

// 固定列の合計幅が狭いパネルを超えると、Chrome は末尾の sticky セルを
// スクロール領域の右端へ押し戻し、直前の固定列へ重ねてしまう。実際の描画座標を基準に
// 各固定列を順番に継ぎ目へ戻し、固定列の間から通常列が見える隙間・重なりを防ぐ。
function _dbAlignPinnedColumnSeams(table) {
  if (!table?.isConnected) return;
  const headers = Array.from(table.querySelectorAll('thead th'));
  const entries = headers.map((header, colIndex) => {
    const isEntity = header.classList.contains('col-entity-header');
    const isEntityPinned = isEntity && header.style.position === 'sticky';
    const isPinned = header.classList.contains('col-pinned');
    return (isEntityPinned || isPinned)
      ? { header, colIndex, isEntityPinned }
      : null;
  }).filter(Boolean);
  if (!entries.length) return;
  const controlsHeader = headers.find(header => header.classList.contains('col-row-controls-header'));

  // 前回の補正を外した同一レイアウトから再計測する。ここから補正の再適用までは
  // 同じフレーム内なので、中間状態が画面へ描画されることはない。
  entries.forEach(entry => _dbSetPinnedColumnShift(table, entry, 0));
  let targetLeft = controlsHeader?.getBoundingClientRect?.().right ?? null;
  entries.forEach((entry, index) => {
    const rect = entry.header.getBoundingClientRect();
    // 先頭の固定列は既存の sticky left を基準にする。狭幅時には行コントロール列自体も
    // テーブル右端制約を受けるため、その描画位置を基準にすると固定列群全体が左へずれる。
    if (index === 0 && !Number.isFinite(targetLeft)) {
      targetLeft = rect.right;
      return;
    }
    const scaleX = entry.header.offsetWidth > 0
      ? rect.width / entry.header.offsetWidth
      : 1;
    const shiftPx = (targetLeft - rect.left) / (Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1);
    _dbSetPinnedColumnShift(table, entry, shiftPx);
    targetLeft = entry.header.getBoundingClientRect().right;
  });
}

function _dbSchedulePinnedColumnSeamAlignment(table) {
  if (!table) return;
  if (table._dbPinnedSeamTimer) clearTimeout(table._dbPinnedSeamTimer);
  // scroll イベントが発火しない「同じ scrollLeft のままパネル幅だけ変わる」経路も拾う。
  table._dbPinnedSeamTimer = setTimeout(() => {
    table._dbPinnedSeamTimer = 0;
    _dbAlignPinnedColumnSeams(table);
  }, 32);
  if (table._dbPinnedSeamFrame) return;
  if (typeof requestAnimationFrame !== 'function') {
    _dbAlignPinnedColumnSeams(table);
    return;
  }
  table._dbPinnedSeamFrame = requestAnimationFrame(() => {
    _dbAlignPinnedColumnSeams(table);
    // scrollLeft 更新直後は sticky の右端制約が次の描画フレームで確定する場合がある。
    // 2フレーム目でも再計測し、狭幅・拡大表示時の末尾固定列の重なりを補正する。
    table._dbPinnedSeamFrame = requestAnimationFrame(() => {
      table._dbPinnedSeamFrame = 0;
      _dbAlignPinnedColumnSeams(table);
    });
  });
}

function _dbPinnedColumnScrollHost(table) {
  let node = table?.parentElement;
  while (node && node !== document.body) {
    const overflowX = typeof getComputedStyle === 'function'
      ? getComputedStyle(node).overflowX
      : '';
    if (/(auto|scroll|overlay)/.test(overflowX)) return node;
    node = node.parentElement;
  }
  return table?.parentElement || null;
}

function _dbDisconnectPinnedColumnTracking(table) {
  if (!table) return;
  table._dbPinnedWidthObserver?.disconnect?.();
  table._dbPinnedWidthObserver = null;
  table._dbPinnedHostMutationObserver?.disconnect?.();
  table._dbPinnedHostMutationObserver = null;
  if (table._dbPinnedScrollHost && table._dbPinnedScrollHandler) {
    table._dbPinnedScrollHost.removeEventListener('scroll', table._dbPinnedScrollHandler);
  }
  table._dbPinnedScrollHost = null;
  table._dbPinnedScrollHandler = null;
  if (table._dbPinnedSeamFrame && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(table._dbPinnedSeamFrame);
  }
  table._dbPinnedSeamFrame = 0;
  if (table._dbPinnedSeamTimer) clearTimeout(table._dbPinnedSeamTimer);
  table._dbPinnedSeamTimer = 0;
}

function _dbObservePinnedColumnWidths(table) {
  _dbDisconnectPinnedColumnTracking(table);
  if (!table || typeof ResizeObserver !== 'function') return;
  const observer = new ResizeObserver(() => _dbReflowPinnedColumnOffsets(table));
  table.querySelectorAll('thead th').forEach(header => observer.observe(header));
  const scrollHost = _dbPinnedColumnScrollHost(table);
  if (scrollHost) {
    observer.observe(scrollHost);
    const onScroll = () => _dbSchedulePinnedColumnSeamAlignment(table);
    scrollHost.addEventListener('scroll', onScroll, { passive: true });
    table._dbPinnedScrollHost = scrollHost;
    table._dbPinnedScrollHandler = onScroll;
    if (typeof MutationObserver === 'function') {
      const hostObserver = new MutationObserver(() => _dbSchedulePinnedColumnSeamAlignment(table));
      hostObserver.observe(scrollHost, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
      table._dbPinnedHostMutationObserver = hostObserver;
    }
  }
  table._dbPinnedWidthObserver = observer;
  _dbSchedulePinnedColumnSeamAlignment(table);
}

// 表示責務（セル表示設定・自動列幅算出）は gb-db-table-display.js へ移設した。
// _dbClampInt / _dbCellDisplayConfig / setDbCellTextDisplay / showDbCellWrapMenu /
// _makeColumnWrapSubmenuItems / autoFitCurrentSheetColumns 等はそちらを参照。

const _dbNaturalTextCollator = new Intl.Collator('ja', {
  numeric: true,
  sensitivity: 'variant',
});

function _dbNaturalTextCompare(left, right) {
  return _dbNaturalTextCollator.compare(String(left ?? ''), String(right ?? ''));
}

function _dbSortedEntityNames(data, dbPath, ctx, options = {}) {
  const entitiesMap = data?.entities || {};
  const propTypes = options.propTypes || (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath, ctx) : {});
  const advFilters = options.advFilters || (typeof getAdvancedFilters === 'function' ? getAdvancedFilters(dbPath, { ctx }) : []);
  const columnValueFilters = options.columnValueFilters
    || (typeof getColumnValueFilters === 'function' ? getColumnValueFilters(dbPath, { ctx }) : {});
  const filterMode = options.filterMode ?? ctx?.filter ?? (typeof state !== 'undefined' ? state.filter : undefined) ?? 'disabled';
  const sortCfg = (typeof getDbSortConfig === 'function' ? getDbSortConfig(dbPath, { ctx }) : getDbViewConfig(dbPath).sortConfig)
    || { key: 'name', dir: 'asc' };
  const manualOrder = typeof getDbManualOrder === 'function'
    ? getDbManualOrder(dbPath, { ctx })
    : getDbViewConfig(dbPath).manualOrder;
  let entityNames = Object.keys(entitiesMap);
  if (options.applyAdvancedFilters && Array.isArray(advFilters) && advFilters.length && typeof _dbEntityPassesAdvancedFilters === 'function') {
    entityNames = entityNames.filter(name => _dbEntityPassesAdvancedFilters(entitiesMap[name], advFilters, filterMode));
  }
  if (typeof _dbEntityPassesColumnValueFilters === 'function' && Object.keys(columnValueFilters || {}).length) {
    entityNames = entityNames.filter(name => _dbEntityPassesColumnValueFilters(
      name,
      entitiesMap[name],
      columnValueFilters,
      dbPath,
      ctx,
      filterMode,
    ));
  }
  if (sortCfg.key === 'manual') {
    const order = Array.isArray(manualOrder)
      ? manualOrder
      : (typeof _getEntityOrderSnapshot === 'function'
          ? _getEntityOrderSnapshot(ctx, dbPath, entitiesMap)
          : [...entityNames]);
    const sourceIndexes = new Map(entityNames.map((name, index) => [name, index]));
    entityNames.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0 && ib < 0) return sourceIndexes.get(a) - sourceIndexes.get(b);
      if (ia < 0) return 1; if (ib < 0) return -1;
      return ia - ib;
    });
  } else if (sortCfg.key === 'name') {
    entityNames.sort((a, b) => sortCfg.dir === 'desc'
      ? _dbNaturalTextCompare(b, a)
      : _dbNaturalTextCompare(a, b));
  } else {
    const sortPtc = propTypes?.[sortCfg.key] || {};
    const sortType = sortPtc.type || 'text';
    const adoptedStr = (v) => {
      if (!Array.isArray(v)) return v == null ? '' : String(v);
      const picked = v.find(x => x && (x.status === '採用' || x.status === '掲載済み'))
                  || v.find(x => x && x.status === '案')
                  || v[0];
      return picked && picked.value != null ? String(picked.value) : '';
    };
    const sortValue = (entityName) => {
      const metadataSource = typeof _dbPropertyMetadataSource === 'function'
        ? _dbPropertyMetadataSource(sortPtc)
        : (['created', 'modified', 'modified_by'].includes(sortPtc?.source) ? sortPtc.source : '');
      if (metadataSource || sortPtc.type === 'formula') {
        return _dbTextForProp(entityName, sortCfg.key, data, propTypes, advFilters, dbPath, filterMode);
      }
      const entityData = entitiesMap[entityName] || {};
      const rawValues = Object.prototype.hasOwnProperty.call(entityData, sortCfg.key) && Array.isArray(entityData[sortCfg.key])
        ? entityData[sortCfg.key]
        : [];
      return adoptedStr(rawValues);
    };
    const toNum = (s) => { const n = parseFloat(s); return isNaN(n) ? null : n; };
    const toDate = (s) => { const t = Date.parse(s); return isNaN(t) ? null : t; };
    entityNames.sort((a, b) => {
      const sa = sortValue(a);
      const sb = sortValue(b);
      if (!sa && !sb) return 0;
      if (!sa) return 1;
      if (!sb) return -1;
      let cmp;
      if (sortType === 'number' || sortType === 'formula') {
        const na = toNum(sa), nb = toNum(sb);
        if (na != null && nb != null) cmp = na - nb;
        else if (na != null) cmp = -1;
        else if (nb != null) cmp = 1;
        else cmp = _dbNaturalTextCompare(sa, sb);
      } else if (sortType === 'date') {
        const da = toDate(sa), db = toDate(sb);
        if (da != null && db != null) cmp = da - db;
        else if (da != null) cmp = -1;
        else if (db != null) cmp = 1;
        else cmp = _dbNaturalTextCompare(sa, sb);
      } else {
        cmp = _dbNaturalTextCompare(sa, sb);
      }
      return sortCfg.dir === 'desc' ? -cmp : cmp;
    });
  }
  return entityNames;
}

// リンク切れ（参照先シート欠落）を列見出しに示す警告アイコンを生成する。
// 色だけに頼らず三角形状＋aria-label で意味を担保（UI共通ルール準拠）。
// ホバー/フォーカス/長押しの説明は gb-tooltip が data-gb-tooltip / title を拾って表示する。
function _buildLinkWarnIcon(targetSheetName) {
  const icon = document.createElement('span');
  icon.className = 'th-linkwarn-icon';
  icon.style.cssText = 'margin-left:4px;flex-shrink:0;display:inline-flex;align-items:center;color:var(--orange);';
  icon.innerHTML = lucide('alertTriangle', 12);
  const msg = 'リンク切れ: 参照先シート『' + (targetSheetName || '') + '』が見つかりません';
  icon.title = msg;
  icon.dataset.gbTooltip = msg;
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', msg);
  return icon;
}

// リレーション列の参照先シートパスを解決する（relation / multi-relation 用）。
function _relationColumnTargetPath(dbPath, ptc) {
  if (!ptc) return '';
  return typeof _dbResolveRelationDbPath === 'function'
    ? _dbResolveRelationDbPath(dbPath, ptc)
    : ((ptc.relationDb === '' ? dbPath : ptc.relationDb) || '');
}

// リレーション列の「参照先シート欠落（リンク切れ）」を列見出しの警告アイコンで反映する。
// - 検出範囲: 参照先シートフォルダ自体が存在しない場合のみ（値の未解決 dangling は対象外）。
// - 冪等: 欠落なら .th-linkwarn-icon を追加、解消なら除去。再呼び出しで最新状態に揃える。
// - 通常シート・埋め込みシートとも同じ renderPivot 経由なので、この1関数で両対応。
function _syncRelationWarningIcons(ctx) {
  ctx = typeof _normalizeDbRenderContext === 'function' ? _normalizeDbRenderContext(ctx) : (ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null));
  if (!ctx) return;
  const dbPath = ctx.dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '');
  if (!dbPath) return;
  if (typeof _isRelationTargetMissing !== 'function' || typeof _paneEl !== 'function') return;
  const _tblId = ctx.tableId || 'pivot-table';
  const thead = _paneEl(ctx, '#' + _tblId + ' thead');
  if (!thead) return;
  // 見出しの装飾処理。renderPivot の行描画前に呼ばれるため、
  // 万一の例外で本体描画を止めないよう全体を try/catch で保護する。
  try {
  const propTypes = (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath, ctx) : null) || {};
  const basename = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);
  thead.querySelectorAll('th[data-prop]').forEach(th => {
    const propName = th.dataset.prop;
    if (!propName || propName === '__entity__') return;
    const ptc = propTypes[propName];
    let targetName = '';
    if (ptc && (ptc.type === 'relation' || ptc.type === 'multi-relation')) {
      const target = _relationColumnTargetPath(dbPath, ptc);
      if (target && target !== dbPath && _isRelationTargetMissing(target)) targetName = basename(target);
    } else if (ptc && ptc.type === 'multi-source-relation') {
      // 複数ソースのうち欠落しているシートがあれば警告（欠落シート名を列挙）。
      const missNames = (ptc.sources || [])
        .map(src => src && src.db)
        .filter(sdb => sdb && sdb !== dbPath && _isRelationTargetMissing(sdb))
        .map(basename);
      if (missNames.length) targetName = missNames.join('・');
    }
    const existing = th.querySelector(':scope > .th-linkwarn-icon');
    if (targetName) {
      const msg = 'リンク切れ: 参照先シート『' + targetName + '』が見つかりません';
      if (existing) {
        if (existing.dataset.gbTooltip !== msg) {
          existing.title = msg; existing.dataset.gbTooltip = msg; existing.setAttribute('aria-label', msg);
        }
      } else {
        const icon = _buildLinkWarnIcon(targetName);
        const label = th.querySelector(':scope > .th-label');
        if (label && label.nextSibling) th.insertBefore(icon, label.nextSibling);
        else th.appendChild(icon);
      }
    } else if (existing) {
      existing.remove();
    }
  });
  } catch (e) {
    try { console.warn('[Meldex] リンク切れ警告アイコンの反映に失敗しました', e); } catch {}
  }
}

function renderPivot(ctx) {
  const renderPerfStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  ctx = typeof _normalizeDbRenderContext === 'function' ? _normalizeDbRenderContext(ctx) : (ctx || _currentPaneState());
  const data = ctx.pivotData || state.pivotData;
  if (!data || !data.properties || !data.entities) { clearPivot(ctx); return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const filterMode = ctx.filter ?? state.filter ?? 'disabled';
  const hiddenCols = getHiddenCols(dbPath, { ctx });
  const configuredPinnedCols = getPinnedCols(dbPath, { ctx });
  const colOrder = getColOrder(dbPath, { ctx });
  const condFmt = getConditionalFormat(dbPath, { ctx });
  const thumbSize = getThumbnailSize(dbPath, { ctx });
  let savedWidths = getColWidths(dbPath, { ctx });
  const advFilters = getAdvancedFilters(dbPath, { ctx });
  const columnValueFilters = typeof getColumnValueFilters === 'function'
    ? getColumnValueFilters(dbPath, { ctx })
    : {};
  const propTypes = getPropertyTypes(dbPath, ctx);
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

  // 列の描画順序（'__entity__' を含む）。フェーズ2でエントリ名列もD&D並べ替え対象化。
  // colOrder に '__entity__' が無い(=未保存/旧データ)場合は先頭補完し、従来の見た目を維持する。
  const entityOrderRaw = colOrder ? [...colOrder] : [];
  const renderedCols = entityOrderRaw.includes('__entity__')
    ? entityOrderRaw.filter(p => p === '__entity__' || visibleProps.includes(p))
    : [];
  if (!renderedCols.includes('__entity__')) renderedCols.unshift('__entity__');
  visibleProps.forEach(p => { if (!renderedCols.includes(p)) renderedCols.push(p); });
  // 固定列は現在の表示順における左端から固定終端までの連続範囲に正規化する。
  // 旧版の飛び飛び固定設定や列D&D後も、固定列間にスクロールする列を残さない。
  const configuredEntityColumnPinned = typeof getEntityColumnPinned === 'function'
    ? getEntityColumnPinned(dbPath, { ctx })
    : true;
  const pinnedRange = typeof getPinnedColumnRangeState === 'function'
    ? getPinnedColumnRangeState(renderedCols, configuredPinnedCols, configuredEntityColumnPinned)
    : {
      pinnedCols: configuredPinnedCols,
      entityColumnPinned: configuredEntityColumnPinned,
    };
  const pinnedCols = pinnedRange.pinnedCols;
  const entityColumnPinned = pinnedRange.entityColumnPinned;

  const entitiesMap = data.entities;
  const entityNames = _dbSortedEntityNames(data, dbPath, ctx, {
    propTypes,
    advFilters,
    columnValueFilters,
    filterMode,
    applyAdvancedFilters: true,
  });
  // データを持つビューで保存済み列幅が一つも無ければ、初回描画前に一度だけ自動調整して保存する
  // （利用者調整済みの列幅がある場合や空のビューでは何もしない。gb-db-table-display.js 参照）。
  if (typeof _dbMaybeAutoFitColumnsOnce === 'function') {
    const autoFitWidths = _dbMaybeAutoFitColumnsOnce(dbPath, ctx, {
      data, propTypes, visibleProps, entityNames, advFilters, savedWidths,
    });
    if (autoFitWidths) savedWidths = autoFitWidths;
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
  // 列ごとのセル折返し/切り詰め上書き。未設定なら null にして renderEntityCell 側の per-td 処理を丸ごとスキップさせる。
  const currentViewDisplay = typeof getCurrentDbViewConfigEntry === 'function'
    ? getCurrentDbViewConfigEntry(dbPath, { ctx })
    : null;
  const currentViewCellDisplay = currentViewDisplay
    && Object.prototype.hasOwnProperty.call(currentViewDisplay, 'cellDisplayByCol')
    ? currentViewDisplay.cellDisplayByCol
    : gridCfg.cellDisplayByCol;
  const cellDisplayByCol = (currentViewCellDisplay
      && typeof currentViewCellDisplay === 'object'
      && Object.keys(currentViewCellDisplay).length)
    ? currentViewCellDisplay
    : null;
  // セル表示の画像サムネ数（保存ビュー単位。gb-db-table-display.js の getCellImageThumbCount 参照）。
  const cellImageThumbCount = typeof getCellImageThumbCount === 'function' ? getCellImageThumbCount(dbPath, { ctx }) : 3;
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
    const cellDisplay = _dbCellDisplayConfig(dbPath, ctx);
    tblEl.dataset.cellOverflow = cellDisplay.overflow;
    tblEl.dataset.cellWrapLines = String(cellDisplay.lines);
    tblEl.style.setProperty('--db-cell-wrap-lines', String(cellDisplay.lines));
  }
  syncDbCellDisplayToolbar(dbPath, ctx);

  // ヘッダー
  const headerRow = document.createElement('tr');
  headerRow.setAttribute('role', 'row');

  // 行先頭コントロール列（＋追加/ドラッグハンドル/選択チェックボックス）。常に先頭固定・並べ替え対象外。
  // 幅は gb-tools.part01.part01.css の CSS 変数 --db-row-controls-w が正（タッチ環境では拡幅される）。
  const ROW_CONTROLS_WIDTH = typeof _dbRowControlsWidth === 'function' ? _dbRowControlsWidth(tblEl) : 56;
  const thControls = document.createElement('th');
  thControls.className = 'col-row-controls-header';
  thControls.dataset.e2eId = _dbE2eId(ctx, 'column-header', 'row-controls');
  thControls.setAttribute('role', 'columnheader');
  thControls.setAttribute('scope', 'col');
  thControls.setAttribute('aria-label', '行操作とトピック選択');
  if (typeof _createPaneRowSelectHeaderCheckbox === 'function') {
    thControls.appendChild(_createPaneRowSelectHeaderCheckbox(ctx));
  }
  headerRow.appendChild(thControls);

  // 列D&D並べ替え（エントリ名列・プロパティ列で共通）
  const _dbHandleColumnDrop = (fromName, targetToken, isLeft) => {
    if (!fromName || fromName === targetToken) return;
    const arr = renderedCols.filter(n => n !== fromName);
    const idx = arr.indexOf(targetToken);
    const insertIdx = idx >= 0 ? idx + (isLeft ? 0 : 1) : arr.length;
    arr.splice(insertIdx, 0, fromName);
    // hidden 列は元の colOrder の順序のまま末尾に保持
    const oldOrder = getColOrder(dbPath, { ctx }) || [];
    const hiddenInOrder = oldOrder.filter(n => hiddenCols.includes(n) && !arr.includes(n));
    setColOrder(dbPath, [...arr, ...hiddenInOrder], { ctx });
    renderPivot(ctx);
  };

  const entityColumnLabel = _dbEntityColumnDisplayLabel(dbPath);
  // エントリ名列の幅（永続化）
  const _entityW = (savedWidths['__entity__'] || _dbDefaultEntityColumnWidth(dbPath));

  const pinnedOffsets = typeof _dbPinnedColumnOffsets === 'function'
    ? _dbPinnedColumnOffsets(renderedCols, pinnedCols, entityColumnPinned, savedWidths, _entityW, ROW_CONTROLS_WIDTH)
    : {};
  renderedCols.forEach((token, idx) => {
    // 行先頭コントロール列の分だけ +1 した実DOM列インデックス（列幅リサイズ等で使用）
    const domColIndex = idx + 1;

    if (token === '__entity__') {
      const th0 = document.createElement('th');
      th0.className = 'col-entity-header';
      th0.dataset.dbColToken = '__entity__';
      th0.dataset.e2eId = _dbE2eId(ctx, 'column-header', 'entity');
      _setupDbColumnHeaderA11y(th0, entityColumnLabel);
      if (selectedCols.includes('__entity__')) th0.classList.add('col-selected');
      const entityLeft = pinnedOffsets.__entity__;
      const entityShouldStick = entityColumnPinned && Number.isFinite(entityLeft);
      th0.style.position = entityShouldStick ? 'sticky' : 'relative';
      th0.style.left = entityShouldStick ? entityLeft + 'px' : '';
      th0.style.zIndex = entityShouldStick ? '11' : '';
      th0.style.width = _entityW + 'px';
      th0.style.minWidth = _entityW + 'px';
      th0.style.maxWidth = _entityW + 'px';
      const th0Label = document.createElement('span');
      th0Label.className = 'th-label';
      th0Label.textContent = entityColumnLabel;
      th0.appendChild(th0Label);
      if (typeof isDbColumnFilterActive === 'function' && isDbColumnFilterActive(dbPath, '__entity__', ctx)) {
        th0.classList.add('col-filtered');
        const filterIcon = document.createElement('span');
        filterIcon.className = 'th-filter-icon';
        filterIcon.innerHTML = lucide('filter', 12);
        filterIcon.title = 'この列にフィルターが適用されています';
        filterIcon.setAttribute('aria-label', 'フィルター適用中');
        th0.appendChild(filterIcon);
      }
      const th0MoreBtn = document.createElement('span');
      th0MoreBtn.className = 'th-more-btn entity-th-more-btn';
      th0MoreBtn.innerHTML = lucide('moreHorizontal', 14);
      th0MoreBtn.title = '列メニュー';
      th0MoreBtn.setAttribute('aria-label', entityColumnLabel + '列メニュー');
      th0MoreBtn.style.cssText = 'position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0;padding:2px 3px;border-radius:3px;cursor:pointer;background:var(--bg2);display:inline-flex;align-items:center;transition:opacity 0.1s;z-index:2;';
      th0MoreBtn.addEventListener('mouseenter', () => { th0MoreBtn.style.background = 'var(--bg4)'; });
      th0MoreBtn.addEventListener('mouseleave', () => { th0MoreBtn.style.background = 'var(--bg2)'; });
      th0MoreBtn.addEventListener('click', (e) => { e.stopPropagation(); showEntityColMenu(e, ctx, dbPath); });
      th0.appendChild(th0MoreBtn);
      th0.style.cursor = 'pointer';
      th0.addEventListener('mouseenter', () => { th0MoreBtn.style.opacity = '1'; });
      th0.addEventListener('mouseleave', () => { th0MoreBtn.style.opacity = '0'; });
      th0.addEventListener('contextmenu', (e) => { e.preventDefault(); showEntityColMenu(e, ctx, dbPath); });
      if (typeof addLongPressHandler === 'function') {
        addLongPressHandler(th0, (e) => showEntityColMenu(e, ctx, dbPath));
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
      _setupDbColumnResizeHandleA11y(th0Handle, th0, domColIndex, '__entity__', dbPath, ctx);
      th0Handle.addEventListener('pointerdown', (e) => startColResize(e, th0, domColIndex, '__entity__'));
      th0Handle.addEventListener('click', (e) => { e.stopPropagation(); });
      th0Handle.addEventListener('dblclick', (e) => { e.stopPropagation(); });
      th0.appendChild(th0Handle);
      // D&D 列並び替え（プロパティ列と同じ機構。他の列と同様に並べ替え可能）
      th0.draggable = true;
      th0.addEventListener('dragstart', (e) => {
        if (e.target.closest('.col-resize-handle, .th-more-btn')) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/x-col-name', '__entity__');
        e.dataTransfer.effectAllowed = 'move';
        th0.classList.add('col-dragging');
      });
      th0.addEventListener('dragend', () => th0.classList.remove('col-dragging'));
      th0.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes('text/x-col-name')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = th0.getBoundingClientRect();
        const isLeftHalf = (e.clientX - rect.left) < rect.width / 2;
        th0.classList.toggle('col-drop-left', isLeftHalf);
        th0.classList.toggle('col-drop-right', !isLeftHalf);
      });
      th0.addEventListener('dragleave', () => { th0.classList.remove('col-drop-left', 'col-drop-right'); });
      th0.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromName = e.dataTransfer.getData('text/x-col-name');
        const isLeftHalf = th0.classList.contains('col-drop-left');
        th0.classList.remove('col-drop-left', 'col-drop-right');
        _dbHandleColumnDrop(fromName, '__entity__', isLeftHalf);
      });
      headerRow.appendChild(th0);
      return;
    }

    const p = token;
    const th = document.createElement('th');
    const ptcHeader = propTypes[p];
    th.dataset.prop = p;
    th.dataset.dbColToken = p;
    th.dataset.e2eId = _dbE2eId(ctx, 'column-header', p);
    _setupDbColumnHeaderA11y(th, p);
    const w = savedWidths[p] || 100;
    th.style.width = w + 'px';
    th.style.minWidth = w + 'px';
    th.style.maxWidth = w + 'px';
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
    if (typeof isDbColumnFilterActive === 'function' && isDbColumnFilterActive(dbPath, p, ctx)) {
      th.classList.add('col-filtered');
      const filterIcon = document.createElement('span');
      filterIcon.className = 'th-filter-icon';
      filterIcon.innerHTML = lucide('filter', 12);
      filterIcon.title = 'この列にフィルターが適用されています';
      filterIcon.setAttribute('aria-label', 'フィルター適用中');
      th.appendChild(filterIcon);
    }

    // 列ロック / sourceインジケータ / 計算列インジケータ
    const _ptcHeader2 = propTypes[p];
    if (typeof window !== 'undefined' && window.MeldexComputedColumns?.attachHeaderIcon?.(th, dbPath, p, ctx)) {
      // 計算列（読み取り専用・コードが更新する列）: 鍵アイコンを付与済み
    } else if (_ptcHeader2 && _ptcHeader2.source) {
      const autoIcon = document.createElement('span');
      autoIcon.className = 'th-lock-icon';
      autoIcon.style.cssText = 'opacity:0.5;margin-left:4px;flex-shrink:0;';
      autoIcon.innerHTML = lucide('zap', 12);
      autoIcon.title = _ptcHeader2.source === 'import'
        ? '取り込み列（読み取り専用）'
        : '自動入力（読み取り専用）';
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
      const pinnedLeft = pinnedOffsets[p];
      if (Number.isFinite(pinnedLeft)) th.style.left = pinnedLeft + 'px';
    }

    // ホバー表示の「...」ボタン（メニュー起動）
    const moreBtn = document.createElement('span');
    moreBtn.className = 'th-more-btn';
    moreBtn.innerHTML = lucide('moreHorizontal', 14);
    moreBtn.title = '列メニュー';
    moreBtn.style.cssText = 'position:absolute;right:14px;top:50%;transform:translateY(-50%);opacity:0;padding:2px 3px;border-radius:3px;cursor:pointer;background:var(--bg2);display:inline-flex;align-items:center;transition:opacity 0.1s;z-index:2;';
    moreBtn.addEventListener('mouseenter', () => { moreBtn.style.background = 'var(--bg4)'; });
    moreBtn.addEventListener('mouseleave', () => { moreBtn.style.background = 'var(--bg2)'; });
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showColHeaderMenu(e, p, domColIndex, ctx, dbPath); });
    th.appendChild(moreBtn);
    th.style.position = pinnedCols.includes(p) ? 'sticky' : 'relative';
    th.addEventListener('mouseenter', () => { moreBtn.style.opacity = '1'; });
    th.addEventListener('mouseleave', () => { moreBtn.style.opacity = '0'; });

    // リサイズハンドル
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    handle.dataset.e2eId = _dbE2eId(ctx, 'column-resize', p);
    _setupDbColumnResizeHandleA11y(handle, th, domColIndex, p, dbPath, ctx);
    handle.addEventListener('pointerdown', (e) => startColResize(e, th, domColIndex, p));
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
      _dbHandleColumnDrop(fromName, p, isLeft);
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
      startHeaderInlineRename(th, p, dbPath, ctx);
    });

    // 右クリックメニュー ＋ 長押しで同メニュー（タッチ/ペン）
    th.addEventListener('contextmenu', (e) => { e.preventDefault(); showColHeaderMenu(e, p, domColIndex, ctx, dbPath); });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(th, (e) => showColHeaderMenu(e, p, domColIndex, ctx, dbPath));
    }
    headerRow.appendChild(th);
  });

  // ＋プロパティ追加列（ヘッダー末尾）
  const thAdd = document.createElement('th');
  thAdd.className = 'col-add-prop';
  thAdd.dataset.e2eId = _dbE2eId(ctx, 'column-add-prop');
  _setupDbColumnHeaderA11y(thAdd, '列を追加');
  thAdd.style.cssText = 'width:36px;min-width:36px;text-align:center;cursor:pointer;color:var(--fg2);padding:0;';
  thAdd.title = '列を追加';
  thAdd.innerHTML = lucide('plus', 16);
  // クリックで列タイプ選択ポップアップを表示する（「左/右に列を挿入」と同じ列タイプ一覧・
  // 同じ日時サブメニューを共有。選んだ型で末尾に列を追加）。
  thAdd.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
    if (typeof closeAllDropdowns === 'function') closeAllDropdowns(ctx || thAdd);
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    menu.dataset.e2eId = _dbE2eId(ctx, 'column-add-type-menu');
    const items = typeof _makeInsertColumnTypeChildren === 'function'
      ? _makeInsertColumnTypeChildren(null, 'after', ctx || dbPath)
      : [];
    if (typeof _renderColMenuItems === 'function') _renderColMenuItems(menu, items);
    document.body.appendChild(menu);
    if (typeof positionPopup === 'function') positionPopup(menu, thAdd.getBoundingClientRect());
    setTimeout(() => {
      const closer = (ev) => {
        const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
        if (!inAny) {
          if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
          else menu.remove();
          document.removeEventListener('pointerdown', closer);
        }
      };
      document.addEventListener('pointerdown', closer);
    }, 0);
  });

  thAdd.onmouseenter = () => { if (!thAdd.querySelector('input')) thAdd.style.color = 'var(--accent)'; };
  thAdd.onmouseleave = () => { if (!thAdd.querySelector('input')) thAdd.style.color = 'var(--fg2)'; };
  headerRow.appendChild(thAdd);

  thead.innerHTML = '';
  thead.appendChild(headerRow);
  if (typeof _syncPaneRowSelectHeader === 'function') _syncPaneRowSelectHeader(ctx);

  // リンク切れ（参照先シート欠落）の列見出し警告アイコンを反映（既知欠落を即時、
  // 未判明分は先読み完了後に selectDatabase から再度この関数が呼ばれて反映される）。
  if (typeof _syncRelationWarningIcons === 'function') _syncRelationWarningIcons(ctx);

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
    cellDisplayByCol, renderedCols, pinnedOffsets, cellImageThumbCount,
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

  const paneRoot = _paneEl(ctx, _tbl()) || (!ctx ? document : null);
  if (!paneRoot) return;
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
  const newEntryRow = renderNewEntryRow(ctx, {
    visibleProps,
    selectedCols,
    _entityW,
    renderedCols,
    pinnedCols,
    pinnedOffsets,
  });
  tbody.appendChild(newEntryRow);
  const newEntrySpacerRow = document.createElement('tr');
  newEntrySpacerRow.className = 'new-entity-spacer-row';
  newEntrySpacerRow.setAttribute('aria-hidden', 'true');
  newEntrySpacerRow.setAttribute('role', 'presentation');
  const newEntrySpacerCell = document.createElement('td');
  newEntrySpacerCell.colSpan = visibleProps.length + 3;
  newEntrySpacerRow.appendChild(newEntrySpacerCell);
  tbody.appendChild(newEntrySpacerRow);

  // フッター集計行 (entityNames は確定済みなので即時計算)
  renderPivotFooter(visibleProps, entitiesMap, entityNames, pinnedCols, savedWidths, propTypes, ctx, {
    renderedCols,
    entityColumnPinned,
    pinnedOffsets,
    entityWidth: _entityW,
  });
  if (tblEl && typeof _dbReflowPinnedColumnOffsets === 'function') {
    requestAnimationFrame(() => {
      if (tblEl.isConnected) _dbReflowPinnedColumnOffsets(tblEl);
    });
    if (typeof _dbObservePinnedColumnWidths === 'function') _dbObservePinnedColumnWidths(tblEl);
  }

  const countEl = _paneEl(ctx, '#sb-count') || (!ctx ? document.getElementById('sb-count') : null);
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
    const tbl = _paneEl(ctx, '#' + tableId)
      || (!ctx ? document.querySelector('#pivot-table') || document.querySelector('table.pivot-table') : null);
    if (tbl && dbPath) {
      tbl.dataset.dbPath = dbPath;
      tbl.dataset.path = dbPath;
    }
    if (dbPath && tbl) CommentBadges.refreshSheet(dbPath, tbl);
  } catch {}
}
