// 行先頭コントロール列（＋追加/ドラッグハンドル/選択チェックボックス）の分だけ、
// キーボードナビゲーション上の「実DOM列インデックス」の最小値が 1 になる（0列目は常に非対象）。
const DB_ROW_CONTROLS_COL_COUNT = 1;

// 行先頭コントロール列の幅。正は CSS 変数 --db-row-controls-w（gb-tools.part01.part01.css）で、
// タッチ環境では gb-sheet-mobile.css が上書きする。固定列の sticky left はこの幅を起点にするため、
// CSS と JS で必ず同じ値を使う（ズレると固定列だけ横にずれる）。
function _dbRowControlsWidth(tableEl) {
  if (tableEl && typeof getComputedStyle === 'function') {
    const w = parseFloat(getComputedStyle(tableEl).getPropertyValue('--db-row-controls-w'));
    if (Number.isFinite(w) && w > 0) return w;
  }
  return 56;
}

function _dbTableUsesManualSort(ctx) {
  const dbPath = ctx?.dbPath || state.currentDbPath || '';
  const sortConfig = typeof getDbSortConfig === 'function'
    ? getDbSortConfig(dbPath, { ctx })
    : getDbViewConfig(dbPath).sortConfig;
  return sortConfig?.key === 'manual';
}

function _dbTableWarnManualSortRequired() {
  if (typeof showStatus === 'function') {
    showStatus('行を並べ替えるには、並び替えを「マニュアル」にしてください。', true);
  }
}

function _dbPinnedColumnOffsets(renderedCols, pinnedCols, entityColumnPinned, savedWidths, entityWidth, rowControlsWidth) {
  const offsets = {};
  let left = Number.isFinite(rowControlsWidth) ? rowControlsWidth : 56;
  (Array.isArray(renderedCols) ? renderedCols : []).forEach(token => {
    const pinned = token === '__entity__'
      ? !!entityColumnPinned
      : (Array.isArray(pinnedCols) && pinnedCols.includes(token));
    if (!pinned) return;
    offsets[token] = left;
    const rawWidth = token === '__entity__'
      ? entityWidth
      : ((savedWidths && savedWidths[token]) || 100);
    const numericWidth = Number(rawWidth);
    left += Number.isFinite(numericWidth) && numericWidth > 0
      ? numericWidth
      : (token === '__entity__' ? 120 : 100);
  });
  return offsets;
}

function _handleTbodyDragstart(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const target = e.target;
  if (target.closest('.row-add-btn, .entity-row-more-btn, .row-select-cb, button, input, select, textarea, [contenteditable="true"]')) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // 1. nameSpan ドラッグ → DB間 D&D (text/plain 単一名 + application/x-meldex-node)
  // 自身が複数選択中なら text/x-meldex-rows ペイロードも乗せて行並び替えにも使えるようにする
  const nameSpan = target.closest('.entity-name-label');
  if (nameSpan) {
    e.stopPropagation();
    const tr = nameSpan.closest('tr');
    const entityName = tr?.dataset?.entityName;
    if (!entityName) return;
    const ep = _entityPath(ctx.dbPath, entityName);
    e.dataTransfer.effectAllowed = 'copyMove';
    const sel = ctx._selectedEntities;
    if (sel && sel.has(entityName) && sel.size > 1) {
      const payloadNames = [...sel];
      e.dataTransfer.setData('text/plain', payloadNames.join('\n'));
      e.dataTransfer.setData('text/x-meldex-rows', JSON.stringify(payloadNames));
    } else {
      e.dataTransfer.setData('text/plain', entityName);

    }
    e.dataTransfer.setData('application/x-meldex-node', JSON.stringify({
      name: entityName, path: ep, type: 'entity'
    }));
    nameSpan.classList.add('dragging');
    return;
  }

  // 2. 専用ハンドルからのドラッグ → 行並び替え (複数選択時は全行)
  // セル自体は draggable にしない。編集・選択操作と行並び替えを明確に分離する。
  const rowHandle = target.closest('.row-drag-handle');
  if (!rowHandle) return;
  const tr = target.closest('tr[data-entity-name]');
  if (tr) {
    const groupByProp = typeof getGroupBy === 'function' ? getGroupBy(ctx.dbPath, ctx) : '';
    if (!_dbTableUsesManualSort(ctx) && !groupByProp) {
      e.preventDefault();
      e.stopPropagation();
      _dbTableWarnManualSortRequired();
      return;
    }
    const entityName = tr.dataset.entityName;
    let payloadNames = [entityName];
    // D-5: 自分が選択中で複数選択されている場合は全選択中エントリを運ぶ
    const sel = ctx._selectedEntities;
    if (sel && sel.has(entityName) && sel.size > 1) {
      payloadNames = [...sel];
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', payloadNames.join('\n'));
    e.dataTransfer.setData('text/x-meldex-rows', JSON.stringify(payloadNames));
    tr.style.opacity = '0.4';
  }
}

function _handleTbodyDragend(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  _dbTableClearRowDropIndicator(tbody);
  const target = e.target;
  const nameSpan = target.closest('.entity-name-label');
  if (nameSpan) { nameSpan.classList.remove('dragging'); return; }
  const tr = target.closest('tr[data-entity-name]');
  if (tr) { tr.style.opacity = ''; }
}

// D-4-f: tbody dragover / dragleave / drop 委譲ハンドラ (エントリ行の並び替え)
function _dbTableHasInternalRowDrag(e) {
  const types = e?.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('text/x-meldex-rows');
}

function _dbTableReadDraggedRows(e) {
  if (!_dbTableHasInternalRowDrag(e)) return [];
  const rowsJson = e.dataTransfer.getData('text/x-meldex-rows');
  if (!rowsJson) return [];
  try {
    const parsed = JSON.parse(rowsJson);
    return Array.isArray(parsed)
      ? parsed.filter(name => typeof name === 'string' && name.length > 0)
      : [];
  } catch {
    return [];
  }
}

function _dbTableClearRowDropIndicator(tbody) {
  if (!tbody?._lastDragoverTr) return;
  tbody._lastDragoverTr.classList.remove('db-row-drop-before', 'db-row-drop-after');
  tbody._lastDragoverTr = null;
}

function _dbTableSetRowDropIndicator(tbody, tr, position) {
  if (!tbody || !tr) return;
  if (tbody._lastDragoverTr && tbody._lastDragoverTr !== tr) {
    tbody._lastDragoverTr.classList.remove('db-row-drop-before', 'db-row-drop-after');
  }
  tr.classList.toggle('db-row-drop-before', position === 'before');
  tr.classList.toggle('db-row-drop-after', position === 'after');
  tbody._lastDragoverTr = tr;
}

function _handleTbodyDragover(e) {
  const tbody = e.currentTarget;
  if (!_dbTableHasInternalRowDrag(e)) return;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  // 1. グループヘッダー行への dragover (グループ間 D&D)
  const gtr = e.target.closest('tr.group-header-row');
  if (gtr) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    gtr.classList.add('group-drop-target');
    if (tbody._lastDragoverGroup && tbody._lastDragoverGroup !== gtr) {
      tbody._lastDragoverGroup.classList.remove('group-drop-target');
    }
    tbody._lastDragoverGroup = gtr;
    return;
  }
  if (!_dbTableUsesManualSort(ctx)) return;
  const tr = e.target.closest('tr[data-entity-name]');
  if (!tr) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const rect = tr.getBoundingClientRect();
  _dbTableSetRowDropIndicator(tbody, tr, e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
}

function _handleTbodyDragleave(e) {
  const tbody = e.currentTarget;
  // tbody から完全に離脱する場合のみクリア (子要素間の遷移は無視)
  if (e.relatedTarget && tbody.contains(e.relatedTarget)) return;
  _dbTableClearRowDropIndicator(tbody);
  if (tbody._lastDragoverGroup) {
    tbody._lastDragoverGroup.classList.remove('group-drop-target');
    tbody._lastDragoverGroup = null;
  }
}

// グループヘッダーへのドロップ: 各 dragged entity の groupBy プロパティ値を新グループ key に書き換える
function _dbTableCandidateSnapshot(val) {
  if (!val) return null;
  return {
    file: val.file || '',
    property: val.property || '',
    candidate_index: val.candidate_index,
    value: val.value || '',
    status: val.status || '採用',
    note: val.note || '',
    rich_html: val.rich_html || '',
  };
}

function _dbTableValueObjFromSnapshot(snapshot, propName) {
  return {
    file: snapshot.file,
    property: snapshot.property || propName,
    candidate_index: snapshot.candidate_index,
    value: snapshot.value,
    status: snapshot.status,
    note: snapshot.note,
    rich_html: snapshot.rich_html,
  };
}

async function _dbTableDeleteCandidateSnapshot(snapshot, propName) {
  if (!snapshot?.file) return;
  const valObj = _dbTableValueObjFromSnapshot(snapshot, propName);
  if (snapshot.candidate_index != null) await _apiPutValue(valObj, { _delete: true });
  else await apiPost('/outliner/delete', { path: snapshot.file });
}

async function _dbTablePostCandidateSnapshot(dbPath, entityName, propName, snapshot) {
  if (!snapshot) return null;
  const result = await _apiPostValue(
    _entityPath(dbPath, entityName),
    propName,
    snapshot.value,
    snapshot.status || '採用',
    snapshot.note || '',
    snapshot.rich_html || ''
  );
  return {
    ...snapshot,
    file: result?.path || snapshot.file,
    property: result?.property || propName,
    candidate_index: result?.candidate_index,
  };
}

async function _dbTableApplyGroupDropOp(dbPath, groupByProp, op, side) {
  if (op.kind === 'update') {
    const snapshot = side === 'before' ? op.before : op.after;
    await _apiPutValue(_dbTableValueObjFromSnapshot(snapshot, groupByProp), {
      new_value: snapshot.value,
      new_status: snapshot.status || '採用',
      new_note: snapshot.note || '',
      new_rich_html: snapshot.rich_html || '',
    });
    return;
  }
  if (op.kind === 'delete') {
    if (side === 'before') {
      op.current = await _dbTablePostCandidateSnapshot(dbPath, op.entityName, groupByProp, op.before);
    } else {
      await _dbTableDeleteCandidateSnapshot(op.current || op.before, groupByProp);
      op.current = null;
    }
    return;
  }
  if (op.kind === 'create') {
    if (side === 'before') {
      await _dbTableDeleteCandidateSnapshot(op.current || op.after, groupByProp);
      op.current = null;
    } else {
      op.current = await _dbTablePostCandidateSnapshot(dbPath, op.entityName, groupByProp, op.after);
    }
  }
}

function _dbTablePushGroupDropHistory(dbPath, groupByProp, ops, ctx, label) {
  if (!ops.length || typeof historyPush !== 'function') return;
  const scope = typeof _dbViewConfigHistoryScope === 'function'
    ? _dbViewConfigHistoryScope(dbPath)
    : 'db:' + String(dbPath || '').replace(/\\/g, '/');
  historyPush(label,
    async () => {
      for (let i = ops.length - 1; i >= 0; i -= 1) {
        await _dbTableApplyGroupDropOp(dbPath, groupByProp, ops[i], 'before');
      }
      await selectDatabase(dbPath, ctx, { silent: true });
    },
    async () => {
      for (const op of ops) await _dbTableApplyGroupDropOp(dbPath, groupByProp, op, 'after');
      await selectDatabase(dbPath, ctx, { silent: true });
    },
    scope
  );
}

async function _handleGroupDrop(ctx, draggedNames, newGroupKey) {
  const dbPath = ctx.dbPath;
  const groupByProp = getGroupBy(dbPath, ctx);
  if (!groupByProp) return;
  const lockMsg = typeof checkColumnEditable === 'function' ? checkColumnEditable(dbPath, groupByProp) : null;
  if (lockMsg) {
    showStatus(lockMsg, true);
    return;
  }
  const propTypes = getPropertyTypes(dbPath);
  const ptc = propTypes[groupByProp];
  if (!ptc) {
    showStatus('グループ列の型設定が見つかりません', true);
    return;
  }
  // formula / rollup / multi-source-relation はドロップ不可
  if (['formula', 'rollup', 'multi-source-relation'].includes(ptc.type)) {
    showStatus('この型はグループ間ドラッグ&ドロップに対応していません', true);
    return;
  }
  const entities = ctx.pivotData?.entities || {};
  const shouldClear = newGroupKey === '(未設定)' || newGroupKey === '';
  let updated = 0;
  const historyOps = [];
  for (const name of draggedNames) {
    const ed = entities[name];
    if (!ed) continue;
    const vals = Array.isArray(ed[groupByProp]) ? ed[groupByProp] : [];
    // 互換テスト用: const visibleVals = filterValues(vals);
    const visibleVals = filterValues(vals, null, ctx?.filter);
    const target = typeof getAdoptedValueForWrite === 'function'
      ? getAdoptedValueForWrite(vals)
      : (vals.find(v => v.status === '採用') || vals.find(v => v.status === '掲載済み') || null);
    try {
      if (shouldClear) {
        if (!target) continue;
        const before = _dbTableCandidateSnapshot(target);
        await _dbTableDeleteCandidateSnapshot(before, groupByProp);
        ed[groupByProp] = vals.filter(v => v !== target);
        historyOps.push({ kind: 'delete', entityName: name, before, current: null });
      } else if (target && target.file) {
        const before = _dbTableCandidateSnapshot(target);
        await _apiPutValue(target, { new_value: newGroupKey });
        target.value = newGroupKey;
        historyOps.push({
          kind: 'update',
          entityName: name,
          before,
          after: { ...before, value: newGroupKey },
        });
      } else {
        const ep = _entityPath(dbPath, name);
        const result = await _apiPostValue(ep, groupByProp, newGroupKey, '採用', '');
        const after = {
          file: result?.path || ep,
          property: result?.property || groupByProp,
          candidate_index: result?.candidate_index,
          value: newGroupKey,
          status: '採用',
          note: '',
          rich_html: '',
        };
        historyOps.push({ kind: 'create', entityName: name, after, current: after });
      }
      updated++;
    } catch (e) { /* error shown */ }
  }
  if (updated > 0) {
    _dbTablePushGroupDropHistory(
      dbPath,
      groupByProp,
      historyOps,
      ctx,
      `グループ移動: ${updated} 件 → ${shouldClear ? '(未設定)' : newGroupKey}`
    );
    showStatus(`グループを変更: ${updated} 件 → ${shouldClear ? '(未設定)' : newGroupKey}`);
    await selectDatabase(dbPath, ctx, { silent: true });
  }
}

function _handleTbodyDrop(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const draggedRows = _dbTableReadDraggedRows(e);
  if (draggedRows.length === 0) return;
  // 1. グループヘッダー行へのドロップ → グループ間 D&D
  const gtr = e.target.closest('tr.group-header-row');
  if (gtr) {
    e.preventDefault();
    gtr.classList.remove('group-drop-target');
    if (tbody._lastDragoverGroup) {
      tbody._lastDragoverGroup.classList.remove('group-drop-target');
      tbody._lastDragoverGroup = null;
    }
    const dn = draggedRows;
    if (dn.length === 0) return;
    const newGroupKey = gtr.dataset.groupKey || '';
    _handleGroupDrop(ctx, dn, newGroupKey);
    return;
  }
  if (!_dbTableUsesManualSort(ctx)) {
    e.preventDefault();
    _dbTableClearRowDropIndicator(tbody);
    _dbTableWarnManualSortRequired();
    return;
  }
  const tr = e.target.closest('tr[data-entity-name]');
  if (!tr) return;
  e.preventDefault();
  _dbTableClearRowDropIndicator(tbody);

  let draggedNames = draggedRows;
  const dropTargetEntity = tr.dataset.entityName;
  draggedNames = draggedNames.filter(n => n && n !== dropTargetEntity);
  if (draggedNames.length === 0) return;

  const dbPath = ctx.dbPath;
  const cfgBefore = getDbViewConfig(dbPath);
  const viewBefore = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfgBefore, { ctx })
    : null;
  const beforeTarget = viewBefore || cfgBefore;
  const oldSortConfig = beforeTarget.sortConfig ? { ...beforeTarget.sortConfig } : null;
  const oldOrder = beforeTarget.manualOrder ? [...beforeTarget.manualOrder] : null;
  const cfg = cfgBefore;
  const view = typeof _getCurrentDbViewConfigEntryFromConfig === 'function'
    ? _getCurrentDbViewConfigEntryFromConfig(cfg, { ctx })
    : null;
  const target = view || cfg;
  if (!target.manualOrder) {
    target.manualOrder = _getEntityOrderSnapshot(ctx, dbPath, ctx.pivotData?.entities || {});
    if (target.manualOrder.length === 0) {
      target.manualOrder = [...tbody.querySelectorAll('tr[data-entity-name]')].map(t => t.dataset.entityName).filter(Boolean);
    }
  }
  const order = target.manualOrder;
  const draggedSet = new Set(draggedNames);
  const orderedDragged = [
    ...order.filter(n => draggedSet.has(n)),
    ...draggedNames.filter(n => !order.includes(n)),
  ];
  if (orderedDragged.length === 0) return;
  for (const n of orderedDragged) {
    const i = order.indexOf(n);
    if (i >= 0) order.splice(i, 1);
  }
  let toIdx = order.indexOf(dropTargetEntity);
  if (toIdx < 0) toIdx = order.length;
  const rect = tr.getBoundingClientRect();
  if (e.clientY >= rect.top + rect.height / 2) toIdx++;
  order.splice(toIdx, 0, ...orderedDragged);
  const newOrder = [...order];
  saveDbViewConfig(dbPath, cfg);
  renderPivot(ctx);
  _dbUndoManualOrder(dbPath, orderedDragged, oldOrder, oldSortConfig, newOrder, ctx);
}

// D-4-d: tbody contextmenu 委譲ハンドラ
function _handleTbodyContextmenu(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  // 新規エントリ行・グループヘッダー行は対象外
  const tr = e.target.closest('tr');
  if (!tr) return;
  if (tr.classList.contains('new-entity-row') || tr.classList.contains('group-header-row')) return;
  const entityName = tr.dataset.entityName;
  if (!entityName) return;
  e.preventDefault();
  const td = e.target.closest('td[data-prop-name]');
  showDbCardContextMenu(e, ctx.dbPath, entityName, td?.dataset?.propName);
}

// D-4-c / D-5: tbody change 委譲ハンドラ (キーボード/Space 等のチェックボックス変更)
function _handleTbodyChange(e) {
  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const cb = e.target.closest('.row-select-cb');
  if (!cb) return;
  const tbl = ctx.tableId || 'pivot-table';
  const paneRoot = _paneEl(ctx, '#' + tbl) || (!ctx ? document : null);
  if (!paneRoot) return;
  cb.closest('tr')?.classList.toggle('row-selected', cb.checked);
  paneRoot._lastSelectedCb = cb;
  // D-5: Set 同期
  const en = cb.dataset.entityName;
  const sel = typeof _ensureSelectedEntities === 'function' ? _ensureSelectedEntities(ctx) : ctx._selectedEntities;
  if (sel && en) {
    if (cb.checked) sel.add(en);
    else sel.delete(en);
  }
  _updateBulkEditBar(ctx);
}

// D-4-b: tbody dblclick 委譲ハンドラ
function _handleTbodyDblclick(e) {

  const tbody = e.currentTarget;
  const ctx = tbody._meldexCtx;
  if (!ctx) return;
  const target = e.target;
  // エントリ名セル (col-entity, new-entity-row 以外) の dblclick → インライン名称編集開始
  const colEntityTd = target.closest('td.col-entity');
  if (colEntityTd && !colEntityTd.closest('tr.new-entity-row')) {
    e.stopPropagation();
    const entityName = colEntityTd.closest('tr')?.dataset?.entityName;
    if (entityName && typeof startEntityInlineRename === 'function') {
      const nameSpan = colEntityTd.querySelector('.entity-name-label');
      startEntityInlineRename(colEntityTd, nameSpan, entityName, ctx.dbPath);
    }
    return;
  }
}

// tbody に全イベント委譲を 1 回だけ登録 (click / dblclick / change / contextmenu / drag / pointer)
function _installTbodyDelegation(tbody, ctx) {
  if (!tbody) return;
  tbody._meldexCtx = ctx;
  if (tbody._delegationInstalled) return;
  tbody.addEventListener('click', _handleTbodyClick);
  tbody.addEventListener('dblclick', _handleTbodyDblclick);
  tbody.addEventListener('change', _handleTbodyChange);
  tbody.addEventListener('contextmenu', _handleTbodyContextmenu);
  // 長押しでも同メニュー（タッチ/ペン）
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(tbody, (ev) => {
      const tr = ev.target?.closest?.('tr');
      if (!tr) return;
      if (tr.classList.contains('new-entity-row') || tr.classList.contains('group-header-row')) return;
      const entityName = tr.dataset.entityName;
      if (!entityName) return;
      const c = tbody._meldexCtx;
      if (!c) return;
      const td = ev.target?.closest?.('td[data-prop-name]');
      showDbCardContextMenu(ev, c.dbPath, entityName, td?.dataset?.propName);
    });
  }
  tbody.addEventListener('dragstart', _handleTbodyDragstart);
  tbody.addEventListener('dragend', _handleTbodyDragend);
  tbody.addEventListener('dragover', _handleTbodyDragover);
  tbody.addEventListener('dragleave', _handleTbodyDragleave);
  tbody.addEventListener('drop', _handleTbodyDrop);
  tbody.addEventListener('pointerdown', _handleTbodyPointerdown);
  tbody.addEventListener('pointerover', _handleTbodyPointerover);
  tbody._delegationInstalled = true;
}

function renderGroupHeaderRow(groupKey, names, visibleProps, groupByProp, ctx) {
  const gtr = document.createElement('tr');
  gtr.className = 'group-header-row';
  gtr.dataset.groupKey = groupKey;
  gtr.setAttribute('role', 'row');
  const gtd = document.createElement('td');
  gtd.setAttribute('role', 'cell');
  gtd.setAttribute('aria-label', `${groupByProp}: ${groupKey}、${names.length} 件`);
  gtd.colSpan = visibleProps.length + 3;
  const collapsed = _isGroupCollapsed(ctx, groupKey);
  const groupColor = typeof getDbOptionColorForGroup === 'function'
    ? getDbOptionColorForGroup((ctx && ctx.dbPath) || (typeof state !== 'undefined' ? state.currentDbPath : ''), groupByProp, groupKey, ctx)
    : '';
  const dotHtml = typeof dbOptionColorDotHtmlForGroup === 'function'
    ? dbOptionColorDotHtmlForGroup((ctx && ctx.dbPath) || (typeof state !== 'undefined' ? state.currentDbPath : ''), groupByProp, groupKey, ctx)
    : '';
  gtd.innerHTML = `<span class="group-toggle ${collapsed ? 'collapsed' : ''}">\u25BC</span>${dotHtml}${esc(groupByProp)}: ${esc(groupKey)}<span class="group-count">${names.length} 件</span>`;
  gtr.appendChild(gtd);
  if (typeof applyDbOptionHeaderColor === 'function') applyDbOptionHeaderColor(gtr, groupColor);
  return gtr;
}

function _dbRollupAlignmentState(ctx) {
  if (!ctx) return null;
  const token = ctx._renderToken || null;
  if (!ctx._rollupAlignmentState || ctx._rollupAlignmentState.token !== token) {
    ctx._rollupAlignmentState = { token, rows: new Map() };
  }
  return ctx._rollupAlignmentState;
}

function _dbRollupLineElement(text, className) {
  const line = document.createElement('span');
  line.className = className;
  line.textContent = text == null || text === '' ? '' : String(text);
  return line;
}

function _dbRenderAlignedRollupCell(record, slotCounts) {
  const { host, result, visible } = record;
  host.innerHTML = '';
  host.className = 'db-cell-display-text db-rollup-lines';
  if (!visible) return;
  if (!result.groups.length) {
    host.appendChild(_dbRollupLineElement('—', 'db-rollup-line'));
    return;
  }
  result.groups.forEach((group, groupIndex) => {
    const count = slotCounts[groupIndex] || 1;
    for (let lineIndex = 0; lineIndex < count; lineIndex++) {
      const line = _dbRollupLineElement(group.values[lineIndex] || '', 'db-rollup-line');
      line.dataset.relationStatus = group.relationStatus || '採用';
      host.appendChild(line);
    }
  });
}

function _dbRelationAlignmentStatusTarget(relationCell, group) {
  const values = [...relationCell.querySelectorAll('.cell-values > .cell-value')];
  const candidateIndex = Number.isInteger(group?.relationCandidateIndex)
    ? group.relationCandidateIndex
    : 0;
  return values[candidateIndex]?.querySelector('.status-dot') || values[0]?.querySelector('.status-dot') || null;
}

function _dbRelationAlignmentLinkTarget(relationCell, groupIndex) {
  const links = [...relationCell.querySelectorAll('.relation-link')];
  const link = links[groupIndex] || links[0] || null;
  if (!link) return relationCell.querySelector('.multi-select-tags,.cell-value');
  return link.closest('.multi-select-tags') || link;
}

function _dbOpenAlignedRelationStatusDropdown(statusDot, ctx) {
  const relationCell = statusDot?.closest('td[data-prop-name]');
  if (!relationCell) return false;
  const candidateIndex = Number.parseInt(statusDot.dataset.relationCandidateIndex || '0', 10);
  const sourceStatusDot = _dbRelationAlignmentStatusTarget(relationCell, {
    relationCandidateIndex: Number.isInteger(candidateIndex) ? candidateIndex : 0,
  });
  const dropdownArgs = sourceStatusDot?._dbStatusDropdownArgs;
  if (dropdownArgs && typeof showStatusDropdown === 'function') {
    showStatusDropdown(
      statusDot,
      dropdownArgs.val,
      dropdownArgs.entityPath,
      dropdownArgs.propName
    );
    return true;
  }
  sourceStatusDot?.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
  }));
  return Boolean(sourceStatusDot);
}

function _dbRenderAlignedRelationCell(rowRecord, relationProp, groups, slotCounts, ctx) {
  const firstRollup = [...rowRecord.rollups.values()][0];
  const relationCell = [...(firstRollup?.td?.closest('tr')?.querySelectorAll('td[data-prop-name]') || [])]
    .find(cell => cell.dataset.propName === relationProp);
  if (!relationCell) return;
  const cellValues = relationCell.querySelector('.cell-values');
  if (!cellValues) return;

  cellValues.querySelector('.db-rollup-relation-lines')?.remove();
  [...cellValues.children].forEach(child => {
    if (child.classList?.contains('db-rollup-relation-lines')) return;
    if (child.classList?.contains('cell-add-btn')) {
      child.hidden = false;
      return;
    }
    child.hidden = true;
  });
  const aligned = document.createElement('div');
  aligned.className = 'db-rollup-relation-lines';
  if (!groups.length) {
    aligned.appendChild(_dbRollupLineElement('—', 'db-rollup-relation-line'));
  } else {
    groups.forEach((group, groupIndex) => {
      const count = slotCounts[groupIndex] || 1;
      for (let lineIndex = 0; lineIndex < count; lineIndex++) {
        const line = _dbRollupLineElement(group.relationName || group.relationId || '—', 'db-rollup-relation-line relation-link');
        line.dataset.dbPath = firstRollup.result.targetDbPath || '';
        line.dataset.entityId = group.relationId || '';
        line.dataset.entityName = group.relationName || group.relationId || '';
        line.dataset.relationStatus = group.relationStatus || '採用';
        const statusDot = document.createElement('span');
        statusDot.className = 'status-dot db-rollup-relation-status';
        statusDot.style.background = typeof _getStatusColor === 'function'
          ? _getStatusColor(group.relationStatus || '採用', ctx?.dbPath || '')
          : '';
        statusDot.title = group.relationStatus || '採用';
        statusDot.dataset.relationCandidateIndex = String(
          Number.isInteger(group.relationCandidateIndex) ? group.relationCandidateIndex : 0
        );
        line.prepend(statusDot);
        line.addEventListener('click', (event) => {
          if (event.target.closest('.db-rollup-relation-status')) return;
          event.stopPropagation();
          const target = _dbRelationAlignmentLinkTarget(relationCell, groupIndex);
          target?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
          }));
        });
        line.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof navigateToEntity === 'function') {
            navigateToEntity(
              group.relationName || group.relationId,
              firstRollup.result.targetDbPath || '',
              ctx
            );
          }
        });
        aligned.appendChild(line);
      }
    });
  }
  cellValues.appendChild(aligned);
  relationCell.classList.add('db-rollup-aligned-relation');
}

function _dbUpdateRollupAlignment(ctx, entityName, relationProp) {
  const stateInfo = _dbRollupAlignmentState(ctx);
  const rowRecord = stateInfo?.rows.get(entityName + '\u0000' + relationProp);
  if (!rowRecord?.rollups.size) return;
  const results = [...rowRecord.rollups.values()].map(record => record.result);
  const reference = results.find(result => result.groups.length) || results[0];
  const groupCount = reference?.groups?.length || 0;
  const slotCounts = Array.from({ length: groupCount }, (_, groupIndex) => {
    return Math.max(
      1,
      ...results.map(result => result.groups[groupIndex]?.values?.length || 1)
    );
  });
  rowRecord.rollups.forEach(record => _dbRenderAlignedRollupCell(record, slotCounts));
  _dbRenderAlignedRelationCell(rowRecord, relationProp, reference?.groups || [], slotCounts, ctx);
}

function _dbRegisterRollupAlignment(ctx, entityName, propName, td, host, result, visible) {
  const stateInfo = _dbRollupAlignmentState(ctx);
  if (!stateInfo) return;
  const relationProp = result.relationProp || '';
  const key = entityName + '\u0000' + relationProp;
  let rowRecord = stateInfo.rows.get(key);
  if (!rowRecord) {
    rowRecord = { rollups: new Map() };
    stateInfo.rows.set(key, rowRecord);
  }
  rowRecord.rollups.set(propName, { td, host, result, visible });
  _dbUpdateRollupAlignment(ctx, entityName, relationProp);
}

function renderEntityCell(entityName, propName, ctx, options) {
  const { propTypes, entitiesMap, dbPath, advFilters, pinnedCols, savedWidths, thumbSize, selectedCols, cellDisplayByCol } = options;
  const entityData = entitiesMap[entityName];
  const td = document.createElement('td');
  td.dataset.propName = propName;
  td.dataset.dbColToken = propName;
  if (typeof _dbE2eId === 'function') {
    td.dataset.e2eId = _dbE2eId(ctx, 'cell', entityName, propName);
  }
  td.setAttribute('role', 'cell');
  td.tabIndex = -1;
  td.setAttribute('aria-label', `${entityName} / ${propName}`);
  if ((selectedCols || []).includes(propName)) td.classList.add('col-selected');
  // 列単位のセル折返し/切り詰め上書き（シート全体設定より優先。CSS側は td[data-cell-overflow] で特異度勝ち）。
  // cellDisplayByCol が未設定(null)の大多数のケースでは即座に何もせず抜ける。
  const colDisplay = typeof _dbColumnCellOverrideEntry === 'function' ? _dbColumnCellOverrideEntry(cellDisplayByCol, propName) : null;
  if (colDisplay) {
    td.dataset.cellOverflow = colDisplay.overflow;
    td.style.setProperty('--db-cell-wrap-lines', String(colDisplay.lines));
  }
  const rawValues = entityData && Object.prototype.hasOwnProperty.call(entityData, propName) && Array.isArray(entityData[propName])
    ? entityData[propName]
    : [];
  let values = filterValues(rawValues, undefined, ctx?.filter);
  if (advFilters.length > 0) values = applyAdvancedFilters(values, propName, advFilters);
  let colorValues = values;

  if (pinnedCols.includes(propName)) {
    td.classList.add('col-pinned');
    const pinnedLeft = options.pinnedOffsets?.[propName];
    if (Number.isFinite(pinnedLeft)) td.style.left = pinnedLeft + 'px';
  }

  td.addEventListener('pointerdown', (e) => {
    if (e.defaultPrevented) return;
    if (e._dbCellPointerHandled) return;
    if (e.target.closest('.cell-add-btn,.status-dot,.cell-checkbox,.chat-prop-cell,.db-action-btn,.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-editor')) return;
    e._dbCellPointerHandled = true;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      td._dbModifierPointerSelectionHandledUntil = Date.now() + 300;
      if (typeof selectDbCellFromPointer === 'function') selectDbCellFromPointer(td, e);
    } else if (typeof setActiveCell === 'function') {
      setActiveCell(td, { scroll: false });
    }
  }, { capture: true });

  const container = document.createElement('div');
  container.className = 'cell-values';

  const ptc = propTypes[propName];
  if (ptc && ptc.type === 'select') {
    td.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      if (e.target.closest('.cell-select-val,.cell-add-btn,.status-dot,.cell-inline-input,.cell-inline-select,.cell-inline-dd,.cell-date-editor')) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (typeof selectDbCellFromPointer === 'function') selectDbCellFromPointer(td, e);
        else if (typeof setActiveCell === 'function') setActiveCell(td, { scroll: false });
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof setActiveCell === 'function') setActiveCell(td, { scroll: false });
      if (typeof startCellInlineAdd === 'function') {
        startCellInlineAdd(td, _entityPath(dbPath, entityName), entityName, propName);
      }
    });
  }

  // sourceプロパティ: フロントマターのメタデータを読み取り専用で表示
  if (ptc && ptc.source) {
    const metaKey = '_' + ptc.source;
    const metaVal = entityData[metaKey] ?? '';
    let sourceValues = [{ value: String(metaVal), status: '採用' }];
    if (advFilters.length > 0) sourceValues = applyAdvancedFilters(sourceValues, propName, advFilters);
    colorValues = sourceValues;
    const span = document.createElement('span');
    span.className = 'db-cell-display-text';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    if (sourceValues.length === 0) {
      span.textContent = '';
    } else if ((ptc.source === 'created' || ptc.source === 'modified') && metaVal) {
      span.textContent = typeof _formatDateDisplay === 'function'
        ? _formatDateDisplay(metaVal, ptc)
        : metaVal.replace('T', ' ').substring(0, 16);
    } else if (ptc.source === 'modified_by' && metaVal) {
      span.innerHTML = (typeof _userAvatarSmall === 'function' ? _userAvatarSmall(metaVal) + ' ' : '') + esc(metaVal);
    } else {
      span.textContent = '—';
    }
    container.appendChild(span);
  }
  // ロールアップ型: リレーション先の集計値を非同期表示
  // 設定が未完了（リレーション列が未選択）のままここで値の表示へ落とすと、
  // 元のテキスト値がそのまま出てテキスト列と見分けが付かなくなるため、
  // 「まだ集計していない列」だと分かる表示にして値編集の見た目にはしない。
  else if (ptc && ptc.type === 'rollup' && (!ptc.relationProp || typeof calcRollupValue !== 'function')) {
    const span = document.createElement('span');
    span.className = 'db-cell-display-text db-cell-unconfigured';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    span.textContent = '未設定';
    span.title = '列タイプの設定でリレーション列と参照先の列を指定してください';
    container.appendChild(span);
    colorValues = [];
  }
  else if (ptc && ptc.type === 'rollup') {
    const span = document.createElement('span');
    span.className = 'db-cell-display-text';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    span.textContent = '...';
    container.appendChild(span);
    colorValues = [];
    const renderToken = ctx?._renderToken || null;
    calcRollupValue(entityName, entitiesMap, ptc, propTypes, dbPath, ctx?.filter).then(val => {
      if ((renderToken && ctx?._renderToken !== renderToken) || !td.isConnected) return;
      if (val?.kind === 'rollup-values') {
        let rollupValues = [{ value: val.text, status: '採用' }];
        if (advFilters.length > 0) rollupValues = applyAdvancedFilters(rollupValues, propName, advFilters);
        span.style.color = 'var(--fg)';
        _dbRegisterRollupAlignment(ctx, entityName, propName, td, span, val, rollupValues.length > 0);
        const cc = getCellColor(val.text, propName, dbPath, ctx);
        if (cc) { td.style.background = cc.bg; td.style.color = cc.fg; }
        return;
      }
      const displayValue = val === '-' ? '-' : String(val);
      let rollupValues = [{ value: displayValue, status: '採用' }];
      if (advFilters.length > 0) rollupValues = applyAdvancedFilters(rollupValues, propName, advFilters);
      if (rollupValues.length === 0) {
        span.textContent = '';
        return;
      }
      span.textContent = displayValue;
      span.style.color = 'var(--fg)';
      if (typeof _cellUiApplyAutoLinks === 'function'
          && _cellUiApplyAutoLinks(span, displayValue, _entityPath(dbPath, entityName))) {
        span.addEventListener('click', (e) => { if (typeof _cellUiHandleAutoLinkClick === 'function') _cellUiHandleAutoLinkClick(e); });
      }
      const cc = getCellColor(displayValue, propName, dbPath, ctx);
      if (cc) { td.style.background = cc.bg; td.style.color = cc.fg; }
    }).catch(() => {
      if ((renderToken && ctx?._renderToken !== renderToken) || !td.isConnected) return;
      span.textContent = '#ERR';
      span.style.color = 'var(--red)';
    });
  }
  // ボタン型: 値を持たず、常にボタンを表示 (click は tbody 委譲で処理)
  else if (ptc && ptc.type === 'button') {
    const btn = document.createElement('button');
    btn.className = 'db-action-btn';
    if (typeof _dbE2eId === 'function') {
      btn.dataset.e2eId = _dbE2eId(ctx, 'cell-button', entityName, propName);
    }
    btn._dbButtonActions = Array.isArray(ptc.actions) ? ptc.actions.map(action => ({ ...action })) : [];
    btn.textContent = ptc.label || '実行';
    container.appendChild(btn);
  }
  // マルチソースリレーション型
  else if (ptc && ptc.type === 'multi-source-relation') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0 ? values[0] : { value: '', status: '採用' };
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter }));
  }
  // チャット型
  else if (ptc && ptc.type === 'chat') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0 ? values[0] : { value: '', status: '採用' };
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter }));
  }
  // 画像型: 空セルでも D&D 用のプレースホルダを表示
  else if (ptc && ptc.type === 'image') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0
      ? values[0]
      : { value: '', status: '採用', file: ep, property: propName, candidate_index: null };
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter }));
  }
  // チェックボックス型: 未設定セルも false として直接切り替え可能にする
  else if (ptc && ptc.type === 'checkbox') {
    const ep = _entityPath(dbPath, entityName);
    const val = values.length > 0
      ? values[0]
      : { value: 'false', status: '採用', file: ep, property: propName, candidate_index: null };
    colorValues = values.length > 0 ? values : [val];
    container.appendChild(createTypedValueElement(val, ep, propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter }));
  }
  // 数式型: 数式が未入力のうちはロールアップと同じく「未設定」を出す（下のコメント参照）
  else if (ptc && ptc.type === 'formula' && !ptc.formula) {
    const span = document.createElement('span');
    span.className = 'db-cell-display-text db-cell-unconfigured';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    span.textContent = '未設定';
    span.title = '列タイプの設定で数式を入力してください';
    container.appendChild(span);
    colorValues = [];
  }
  // 数式型: 値ファイルではなく計算結果を表示
  else if (ptc && ptc.type === 'formula' && ptc.formula) {
    const result = formulaEvalForEntity(ptc.formula, entityData, { propTypes, dbPath });
    const span = document.createElement('span');
    span.className = 'db-cell-display-text';
    span.style.cssText = 'font-size:13px;color:var(--fg);';
    if (result.error) {
      span.style.color = 'var(--red)';
      span.textContent = '#ERROR';
      span.title = result.error;
    } else {
      const formulaValue = result.value === '' ? '' : String(result.value);
      let formulaValues = [{ value: formulaValue, status: '採用' }];
      if (advFilters.length > 0) formulaValues = applyAdvancedFilters(formulaValues, propName, advFilters);
      colorValues = formulaValues;
      span.textContent = formulaValues.length === 0 ? '' : formulaValue;
      if (formulaValues.length !== 0 && typeof _cellUiApplyAutoLinks === 'function'
          && _cellUiApplyAutoLinks(span, formulaValue, _entityPath(dbPath, entityName))) {
        span.addEventListener('click', (e) => { if (typeof _cellUiHandleAutoLinkClick === 'function') _cellUiHandleAutoLinkClick(e); });
      }
    }
    container.appendChild(span);
  } else {
    // 候補値が2つ以上あるセルは、ステータス機能OFFでも採用/案/ボツを区別できるよう
    // ステータスマークを自動表示する（ユーザー判断・案A 2026-07-25）。
    const _forceStatusDot = values.length > 1;
    values.forEach(val => {
      container.appendChild(
        ptc ? createTypedValueElement(val, _entityPath(dbPath, entityName), propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter, forceStatusDot: _forceStatusDot })
            : createValueElement(val, _entityPath(dbPath, entityName), propName, thumbSize, { dbPath, ctx, filter: ctx?.filter, forceStatusDot: _forceStatusDot })
      );
    });

    // 候補値追加は基本機能。ステータス機能OFFでも値のある列型では常に＋を出す
    // （ユーザー判断・案A 2026-07-25。従来の「OFF時は1セル1値」設計を反転）。
    // button/formula/rollup 等の非値型は上の分岐で処理されここには来ないが、防御的に除外する。
    const _nonValueTypes = ['button', 'formula', 'rollup', 'multi-source-relation', 'chat'];
    const _allowAdd = !ptc || !_nonValueTypes.includes(ptc.type);
    if (_allowAdd) {
      const addBtn = document.createElement('span');
      addBtn.className = 'cell-add-btn';
      addBtn.innerHTML = lucide('plus', 14);
      addBtn.title = ptc && ptc.type === 'select' ? '値を選択' : '候補値を追加';
      addBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      addBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startCellInlineAdd(td, _entityPath(dbPath, entityName), entityName, propName);
      });
      container.appendChild(addBtn);
    }
  }

  td.appendChild(container);
  // 条件付きカラー
  const cellValues = colorValues.map(v => v.value).join(', ');
  const cc = getCellColor(cellValues, propName, dbPath, ctx);
  if (cc) { td.style.background = cc.bg; td.style.color = cc.fg; }

  // リンク型: サイドバーD&D（application/x-meldex-node）を受理する
  if (ptc && ptc.type === 'link' && typeof decorateDbLinkCellDrop === 'function') {
    decorateDbLinkCellDrop(td, entityName, propName, ctx, dbPath);
  }

  // click は tbody 委譲で処理 (空セル/アクティブセル切替は _handleTbodyClick 内)

  return td;
}

function renderEntityRow(entityName, ctx, options) {
  const { visibleProps, propTypes, entitiesMap, entityNames, dbPath, condFmt, thumbSize, savedWidths, advFilters, pinnedCols, selectedCols, _entityW, _tbl, _tblId, entityColumnPinned, cellDisplayByCol, renderedCols, pinnedOffsets } = options;
  const entityData = entitiesMap[entityName];
  const tr = document.createElement('tr');
  tr.dataset.entityName = entityName;
  tr.setAttribute('role', 'row');
  // 行並べ替えは専用ハンドルだけを draggable にして、セル選択・セル編集と競合させない。
  tr.draggable = false;

  if (condFmt) {
    const mainStatus = getEntityMainStatus(entityData);
    if (mainStatus === '掲載済み') tr.className = 'row-status-published';
    else if (mainStatus === '採用') tr.className = 'row-status-adopted';
    else if (mainStatus === '案') tr.className = 'row-status-draft';
    else if (mainStatus === 'ボツ') tr.className = 'row-status-rejected';
  }

  // 行先頭コントロール列（＋追加/ドラッグハンドル/選択チェックボックス）。
  // エントリ名列（col-entity）から独立した、常に先頭固定・並べ替え対象外の列。
  // 中身（addRowBtn/dragHandle/cb）は既存のまま下方で生成し、controlsMain へ追加する。
  const tdControls = document.createElement('td');
  tdControls.className = 'col-row-controls';
  tdControls.dataset.e2eId = _dbE2eId(ctx, 'row-controls-cell', entityName);
  tdControls.setAttribute('role', 'cell');
  const controlsMain = document.createElement('div');
  controlsMain.className = 'row-controls-main';
  tdControls.appendChild(controlsMain);
  tr.appendChild(tdControls);

  const tdName = document.createElement('td');
  tdName.className = 'col-entity';
  tdName.dataset.dbColToken = '__entity__';
  tdName.dataset.e2eId = _dbE2eId(ctx, 'entry-name-cell', entityName);
  tdName.setAttribute('role', 'rowheader');
  tdName.setAttribute('aria-label', `エントリ: ${entityName}`);
  if ((selectedCols || []).includes('__entity__')) tdName.classList.add('col-selected');
  tdName.style.width = _entityW + 'px';
  tdName.style.minWidth = _entityW + 'px';
  tdName.style.maxWidth = _entityW + 'px';
  // エントリ名列の折り返し/切り詰め上書き（__entity__ キー）。通常列と同じ仕組み。
  const _entityColDisplay = typeof _dbColumnCellOverrideEntry === 'function'
    ? _dbColumnCellOverrideEntry(cellDisplayByCol, '__entity__') : null;
  if (_entityColDisplay) {
    tdName.dataset.cellOverflow = _entityColDisplay.overflow;
    tdName.style.setProperty('--db-cell-wrap-lines', String(_entityColDisplay.lines));
  }

  const nameMain = document.createElement('div');
  nameMain.className = 'entity-name-cell-main';

  // ＋ボタン (エントリ追加: クリック=下に追加 / Alt+クリック=上に追加)
  const addRowBtn = document.createElement('span');
  addRowBtn.className = 'row-add-btn';
  addRowBtn.title = 'クリックで下にエントリを追加 / Alt+クリックで上に追加';
  addRowBtn.draggable = false;
  addRowBtn.tabIndex = 0;
  addRowBtn.setAttribute('role', 'button');
  addRowBtn.setAttribute('aria-label', 'エントリを追加');
  addRowBtn.dataset.e2eId = 'db-row-add-' + String(entityName || '').replace(/[^\w\u3040-\u30ff\u3400-\u9fff-]+/g, '-').slice(0, 60);
  addRowBtn.innerHTML = lucide('plus', 12);
  const triggerAddRow = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const position = e.altKey ? 'above' : 'below';
    _handleInsertRowRelative(ctx, entityName, position);
  };
  addRowBtn.addEventListener('click', triggerAddRow);
  addRowBtn.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    triggerAddRow(e);
  });
  // 行そのものが draggable のため、追加ボタンから行ドラッグを開始させない。
  addRowBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  addRowBtn.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  addRowBtn.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  controlsMain.appendChild(addRowBtn);

  // 行ドラッグハンドル
  const dragHandle = document.createElement('span');
  dragHandle.className = 'row-drag-handle';
  dragHandle.draggable = true;
  dragHandle.title = _dbTableUsesManualSort(ctx)
    ? 'ドラッグして行を並べ替え'
    : '行を並べ替えるには、並び替えを「マニュアル」にしてください';
  dragHandle.dataset.e2eId = _dbE2eId(ctx, 'row-drag', entityName);
  dragHandle.setAttribute('role', 'button');
  dragHandle.setAttribute('aria-label', dragHandle.title);
  dragHandle.innerHTML = lucide('gripVertical', 12);
  dragHandle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  controlsMain.appendChild(dragHandle);

  // 複数選択対応チェックボックス
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'row-select-cb';
  cb.dataset.entityName = entityName;
  cb.dataset.e2eId = `db-row-select-${entityName}`;
  cb.setAttribute('aria-label', `エントリ選択: ${entityName}`);
  // D-5: ctx の Set に含まれていれば checked 状態で生成 (render 跨ぎで選択維持)
  const isSelected = ctx && ctx._selectedEntities && ctx._selectedEntities.has(entityName);
  cb.checked = !!isSelected;
  if (isSelected) tr.classList.add('row-selected');
  cb.addEventListener('click', (e) => {
    if (e.shiftKey || cb._rowSelectPointerdownHandled) return;
    cb._rowSelectDirectClickHandled = true;
    if (typeof _syncRowSelectCheckboxState === 'function') _syncRowSelectCheckboxState(cb, ctx);
    if (typeof _emitRowSelectCheckboxChange === 'function') _emitRowSelectCheckboxChange(cb);
    if (typeof _updateBulkEditBar === 'function') _updateBulkEditBar(ctx);
  });
  // cb pointerdown / pointerover (pointerenter 代替) / Shift+click は tbody 委譲で処理
  controlsMain.appendChild(cb);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'entity-name-label';
  nameSpan.textContent = entityName;
  nameSpan.style.paddingLeft = '4px';
  nameSpan.draggable = true;
  // nameSpan dragstart / dragend は tbody 委譲で処理
  tdName.style.cursor = 'pointer';
  // tdName click / dblclick は tbody 委譲で処理 (選択のみ / startEntityInlineRename)
  // 既定パネルで開くボタン。行自体が draggable なので、ボタン側でドラッグ起点を止める。
  const openBtn = document.createElement('span');
  openBtn.className = 'entity-row-open-btn';
  openBtn.title = '既定パネルで開く';
  openBtn.draggable = false;
  openBtn.innerHTML = lucide('externalLink', 14);
  openBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  openBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  openBtn.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const ep = typeof _entityPath === 'function' ? _entityPath(dbPath, entityName) : '';
    if (!ep) return;
    const cfg = typeof getDbViewConfig === 'function' ? getDbViewConfig(dbPath) : {};
    const target = cfg.defaultPanel || 'main';
    const sourcePaneId = e.target.closest('.gb-pane')?.dataset?.paneId || '';
    if (target === 'float') {
      if (typeof openLinkInSubPanel === 'function') openLinkInSubPanel(ep, entityName, { linkType: 'entity', sourcePaneId });
    } else if (target === 'sidebar') {
      if (typeof openLinkInRightPane === 'function') openLinkInRightPane(ep, entityName, { linkType: 'entity', sourcePaneId });
    } else {
      if (typeof openLinkInMainPane === 'function') openLinkInMainPane(ep, entityName, { linkType: 'entity' });
    }
  });
  // 「...」ボタン。行自体が draggable なので、ボタン側でドラッグ起点を止める。
  const moreBtn = document.createElement('span');
  moreBtn.className = 'entity-row-more-btn';
  moreBtn.title = 'メニュー';
  moreBtn.draggable = false;
  moreBtn.innerHTML = lucide('moreHorizontal', 12);
  moreBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  moreBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  moreBtn.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  moreBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof showDbCardContextMenu === 'function') showDbCardContextMenu(e, dbPath, entityName);
  });
  nameMain.appendChild(nameSpan);
  nameMain.appendChild(openBtn);
  nameMain.appendChild(moreBtn);
  tdName.appendChild(nameMain);

  // tr contextmenu は tbody 委譲 (_handleTbodyContextmenu) で処理

  // フェーズ2: エントリ名列（tdName）もプロパティ列と同じ並べ替え順序（renderedCols）に従って配置する。
  // renderedCols が無い場合（保存済み colOrder に '__entity__' が未含有の旧データ等）は先頭固定として扱う。
  const cols = Array.isArray(renderedCols) && renderedCols.length ? renderedCols : ['__entity__', ...visibleProps];
  const cellOpts = { propTypes, entitiesMap, dbPath, advFilters, pinnedCols, savedWidths, thumbSize, selectedCols, pinnedOffsets, cellDisplayByCol };
  cols.forEach(token => {
    if (token === '__entity__') {
      const entityLeft = pinnedOffsets?.__entity__;
      const entityShouldStick = entityColumnPinned && Number.isFinite(entityLeft);
      tdName.style.position = entityShouldStick ? 'sticky' : '';
      tdName.style.left = entityShouldStick ? entityLeft + 'px' : '';
      tr.appendChild(tdName);
      return;
    }
    tr.appendChild(renderEntityCell(entityName, token, ctx, cellOpts));
  });

  // ＋プロパティ列の空セル
  const tdAddCol = document.createElement('td');
  tdAddCol.className = 'col-add-prop-cell';
  tdAddCol.setAttribute('role', 'cell');
  tr.appendChild(tdAddCol);

  return tr;
}

function renderNewEntryRow(ctx, options) {
  const { visibleProps, selectedCols, _entityW, renderedCols, pinnedCols, pinnedOffsets } = options;
  const newTr = document.createElement('tr');
  newTr.className = 'new-entity-row';
  newTr.setAttribute('role', 'row');

  // 行先頭コントロール列（列数を揃えるための空セル。新規行自体に個別の＋/ハンドル/チェックボックスは無い）
  const tdControls = document.createElement('td');
  tdControls.className = 'col-row-controls';
  tdControls.setAttribute('role', 'cell');
  tdControls.setAttribute('aria-hidden', 'true');
  newTr.appendChild(tdControls);

  const tdName = document.createElement('td');
  tdName.className = 'col-entity';
  tdName.dataset.dbColToken = '__entity__';
  tdName.dataset.e2eId = _dbE2eId(ctx, 'entry-name-new');
  tdName.setAttribute('role', 'cell');
  tdName.setAttribute('aria-label', '新規エントリを追加');
  if ((selectedCols || []).includes('__entity__')) tdName.classList.add('col-selected');
  tdName.style.cssText = 'cursor:pointer;color:var(--fg2);width:' + _entityW + 'px;min-width:' + _entityW + 'px;';
  tdName.style.maxWidth = _entityW + 'px';
  tdName.innerHTML = `<span class="ico" style="margin-right:4px;">${lucide('plus',14)}</span><span>新規</span>`;
  // click は tbody 委譲 (_handleNewEntryClick) で処理

  // フェーズ2: エントリ名列も他の列と同じ並べ替え順序（renderedCols）で配置する
  const cols = Array.isArray(renderedCols) && renderedCols.length ? renderedCols : ['__entity__', ...visibleProps];
  cols.forEach(token => {
    if (token === '__entity__') {
      const entityLeft = pinnedOffsets?.__entity__;
      if (Number.isFinite(entityLeft)) {
        tdName.style.position = 'sticky';
        tdName.style.left = entityLeft + 'px';
      }
      newTr.appendChild(tdName);
      return;
    }
    const propName = token;
    const td = document.createElement('td');
    td.dataset.dbColToken = propName;
    td.setAttribute('role', 'cell');
    td.setAttribute('aria-label', `新規 / ${propName}`);
    if ((selectedCols || []).includes(propName)) td.classList.add('col-selected');
    if ((pinnedCols || []).includes(propName)) {
      td.classList.add('col-pinned');
      const pinnedLeft = pinnedOffsets?.[propName];
      if (Number.isFinite(pinnedLeft)) td.style.left = pinnedLeft + 'px';
    }
    newTr.appendChild(td);
  });
  // ＋プロパティ列の空セル
  const tdAddCol2 = document.createElement('td');
  tdAddCol2.className = 'col-add-prop-cell';
  tdAddCol2.setAttribute('role', 'cell');
  newTr.appendChild(tdAddCol2);

  return newTr;
}
