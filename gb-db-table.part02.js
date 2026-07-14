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

  // 2. tr (エントリ行) ドラッグ → 並び替え (複数選択時は全行)
  // 早期 return を削除: セル領域からドラッグした場合も並び替えできるように
  const tr = target.closest('tr[data-entity-name]');
  if (tr) {
    // セル内の値チップなど他の draggable はそれ自身で stopPropagation するため
    // ここに到達するのは行レベルのドラッグのみ
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
  target.sortConfig = { key: 'manual', dir: 'asc' };
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
  setTimeout(() => restoreActiveCellByEntityName(orderedDragged[0]), 50);
  _restoreSelectionByEntityNames(ctx, orderedDragged);
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
  const paneRoot = _paneEl(ctx, '#' + tbl) || document;
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
  // エントリ名セル (col-entity, new-entity-row 以外) の dblclick → メインパネルで開く
  const colEntityTd = target.closest('td.col-entity');
  if (colEntityTd && !colEntityTd.closest('tr.new-entity-row')) {
    e.stopPropagation();
    const entityName = colEntityTd.closest('tr')?.dataset?.entityName;
    if (entityName) {
      if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, entityName);
      selectEntity(_entityPath(ctx.dbPath, entityName));
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
  gtd.colSpan = visibleProps.length + 2;
  const collapsed = _isGroupCollapsed(ctx, groupKey);
  gtd.innerHTML = `<span class="group-toggle ${collapsed ? 'collapsed' : ''}">\u25BC</span>${esc(groupByProp)}: ${esc(groupKey)}<span class="group-count">${names.length} 件</span>`;
  gtr.appendChild(gtd);
  return gtr;
}

function renderEntityCell(entityName, propName, ctx, options) {
  const { propTypes, entitiesMap, dbPath, advFilters, pinnedCols, savedWidths, thumbSize, selectedCols } = options;
  const entityData = entitiesMap[entityName];
  const td = document.createElement('td');
  td.dataset.propName = propName;
  if (typeof _dbE2eId === 'function') {
    td.dataset.e2eId = _dbE2eId(ctx, 'cell', entityName, propName);
  }
  td.setAttribute('role', 'cell');
  td.tabIndex = -1;
  td.setAttribute('aria-label', `${entityName} / ${propName}`);
  if ((selectedCols || []).includes(propName)) td.classList.add('col-selected');
  const rawValues = entityData && Object.prototype.hasOwnProperty.call(entityData, propName) && Array.isArray(entityData[propName])
    ? entityData[propName]
    : [];
  let values = filterValues(rawValues, undefined, ctx?.filter);
  if (advFilters.length > 0) values = applyAdvancedFilters(values, propName, advFilters);
  let colorValues = values;

  if (pinnedCols.includes(propName)) {
    td.classList.add('col-pinned');
    td.style.left = options.pLeftOffset + 'px';
    options.pLeftOffset += (savedWidths[propName] || 100);
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
  else if (ptc && ptc.type === 'rollup' && ptc.relationProp && typeof calcRollupValue === 'function') {
    const span = document.createElement('span');
    span.className = 'db-cell-display-text';
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    span.textContent = '...';
    container.appendChild(span);
    colorValues = [];
    calcRollupValue(entityName, entitiesMap, ptc, propTypes, dbPath, ctx?.filter).then(val => {
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
    }).catch(() => { span.textContent = '#ERR'; span.style.color = 'var(--red)'; });
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
    values.forEach(val => {
      container.appendChild(
        ptc ? createTypedValueElement(val, _entityPath(dbPath, entityName), propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter })
            : createValueElement(val, _entityPath(dbPath, entityName), propName, thumbSize, { dbPath, ctx, filter: ctx?.filter })
      );
    });

    // ステータス機能 OFF の DB では複数候補値追加を許可しない
    const _statusOn = getStatusEnabled(dbPath);
    const _hasVisibleValue = values.some(v => String(v?.value || '').trim() !== '');
    const _allowAdd = (!ptc || ptc.type !== 'button')
      && (_statusOn || values.length === 0 || (ptc && ptc.type === 'select' && !_hasVisibleValue));
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

  // click は tbody 委譲で処理 (空セル/アクティブセル切替は _handleTbodyClick 内)

  return td;
}

function renderEntityRow(entityName, ctx, options) {
  const { visibleProps, propTypes, entitiesMap, entityNames, dbPath, condFmt, thumbSize, savedWidths, advFilters, pinnedCols, selectedCols, _entityW, _tbl, _tblId, entityColumnPinned } = options;
  const entityData = entitiesMap[entityName];
  const tr = document.createElement('tr');
  tr.dataset.entityName = entityName;
  tr.setAttribute('role', 'row');
  // エントリD&D並べ替え (draggable は維持。dragstart/dragend/dragover/dragleave/drop は tbody 委譲)
  tr.draggable = true;

  if (condFmt) {
    const mainStatus = getEntityMainStatus(entityData);
    if (mainStatus === '掲載済み') tr.className = 'row-status-published';
    else if (mainStatus === '採用') tr.className = 'row-status-adopted';
    else if (mainStatus === '案') tr.className = 'row-status-draft';
    else if (mainStatus === 'ボツ') tr.className = 'row-status-rejected';
  }

  const tdName = document.createElement('td');
  tdName.className = 'col-entity';
  tdName.dataset.e2eId = _dbE2eId(ctx, 'entry-name-cell', entityName);
  tdName.setAttribute('role', 'rowheader');
  tdName.setAttribute('aria-label', `エントリ: ${entityName}`);
  if ((selectedCols || []).includes('__entity__')) tdName.classList.add('col-selected');
  tdName.style.width = _entityW + 'px';
  tdName.style.minWidth = _entityW + 'px';

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
  nameMain.appendChild(addRowBtn);

  // 行ドラッグハンドル (tr.draggable は既に true。視覚的な掴み所として表示)
  const dragHandle = document.createElement('span');
  dragHandle.className = 'row-drag-handle';
  dragHandle.title = 'ドラッグして並び替え';
  dragHandle.innerHTML = lucide('gripVertical', 12);
  nameMain.appendChild(dragHandle);

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
  nameMain.appendChild(cb);

  const nameSpan = document.createElement('span');
  nameSpan.className = 'entity-name-label';
  nameSpan.textContent = entityName;
  nameSpan.style.paddingLeft = '4px';
  nameSpan.draggable = true;
  // nameSpan dragstart / dragend は tbody 委譲で処理
  tdName.style.cursor = 'pointer';
  // tdName click / dblclick は tbody 委譲で処理 (openEntityInSplit / startEntityInlineRename)
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
  nameMain.appendChild(moreBtn);
  tdName.appendChild(nameMain);

  // tr contextmenu は tbody 委譲 (_handleTbodyContextmenu) で処理

  tr.appendChild(tdName);

  const cellOpts = { propTypes, entitiesMap, dbPath, advFilters, pinnedCols, savedWidths, thumbSize, selectedCols, pLeftOffset: entityColumnPinned ? _entityW : 0 };
  visibleProps.forEach(propName => {
    tr.appendChild(renderEntityCell(entityName, propName, ctx, cellOpts));
  });

  // ＋プロパティ列の空セル
  const tdAddCol = document.createElement('td');
  tdAddCol.className = 'col-add-prop-cell';
  tdAddCol.setAttribute('role', 'cell');
  tr.appendChild(tdAddCol);

  return tr;
}

function renderNewEntryRow(ctx, options) {
  const { visibleProps, entitiesMap, dbPath, selectedCols, _tbl, _entityW } = options;
  const newTr = document.createElement('tr');
  newTr.className = 'new-entity-row';
  newTr.setAttribute('role', 'row');

  const tdName = document.createElement('td');
  tdName.className = 'col-entity';
  tdName.dataset.e2eId = _dbE2eId(ctx, 'entry-name-new');
  tdName.setAttribute('role', 'cell');
  tdName.setAttribute('aria-label', '新規エントリを追加');
  if ((selectedCols || []).includes('__entity__')) tdName.classList.add('col-selected');
  tdName.style.cssText = 'cursor:pointer;color:var(--fg2);width:' + _entityW + 'px;min-width:' + _entityW + 'px;';
  tdName.innerHTML = `<span class="ico" style="margin-right:4px;">${lucide('plus',14)}</span><span>新規</span>`;
  // click は tbody 委譲 (_handleNewEntryClick) で処理
  newTr.appendChild(tdName);

  visibleProps.forEach(propName => {
    const td = document.createElement('td');
    td.setAttribute('role', 'cell');
    td.setAttribute('aria-label', `新規 / ${propName}`);
    if ((selectedCols || []).includes(propName)) td.classList.add('col-selected');
    newTr.appendChild(td);
  });
  // ＋プロパティ列の空セル
  const tdAddCol2 = document.createElement('td');
  tdAddCol2.className = 'col-add-prop-cell';
  tdAddCol2.setAttribute('role', 'cell');
  newTr.appendChild(tdAddCol2);

  return newTr;
}
