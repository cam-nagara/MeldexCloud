      type: 'submenu',
      label: lucide('layoutDashboard', 14) + ' ビュータイプを変更',
      children: VIEW_TYPES
        .filter(vt => isCalendarCapable || vt.mode !== 'calendar')
        .map(vt => ({
          label: (vt.mode === currentType ? lucide('check', 14) + ' ' : '<span style="display:inline-block;width:14px;"></span> ') + lucide(vt.icon, 14) + ' ' + vt.label,
          action: () => changeViewType(idx, vt.mode, ctx),
        })),
    },
    { type: 'sep' },
    { label: '左と入れ替え', disabled: idx === 0, action: () => swapViews(idx, idx - 1) },
    { label: '右と入れ替え', disabled: idx >= viewsCount - 1, action: () => swapViews(idx, idx + 1) },
    { type: 'sep' },
    { label: '削除', action: async () => {
      if (!await cfConfirm('このビューを削除しますか？')) return;
      const before = typeof captureDbViewConfigHistory === 'function' ? captureDbViewConfigHistory(dbPath) : null;
      const views = getSavedViews(dbPath);
      views.splice(idx, 1);
      setSavedViews(dbPath, views, { skipHistory: true });
      const curIdx = getCurrentViewIdx(dbPath);
      let nextIdx = curIdx;
      if (curIdx === idx) nextIdx = views.length > 0 ? Math.min(idx, views.length - 1) : -1;
      else if (curIdx > idx) setCurrentViewIdx(dbPath, curIdx - 1, { skipHistory: true });
      if (curIdx === idx) setCurrentViewIdx(dbPath, nextIdx, { skipHistory: true });
      if (typeof pushDbViewConfigHistory === 'function' && typeof captureDbViewConfigHistory === 'function') {
        pushDbViewConfigHistory(dbPath, 'シート表示: ビュー削除', before, captureDbViewConfigHistory(dbPath));
      }
      if (nextIdx >= 0) loadSavedView(nextIdx, ctx, { skipHistory: true });
      else {
        renderDbViewTabs(ctx);
        if (typeof renderDbNoViewsGuide === 'function') renderDbNoViewsGuide(ctx);
      }
    }},
  ];

  _renderDbViewTabMenuItems(menu, items);

  { const z = _getZoom(); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
  document.body.appendChild(menu);
  clampPopupToViewport(menu);
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target)) { closeColHeaderMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

/* ==============================
   グループ化
   ============================== */
function getGroupBy(dbPath) {
  return getCurrentDbViewTypeSpecific(dbPath, 'pivot')?.groupBy || null;
}

function _renderDbViewTabMenuItems(container, itemList) {
  itemList.forEach(item => {
    if (item.type === 'sep') {
      container.appendChild(Object.assign(document.createElement('div'), { className: 'gb-context-menu-sep' }));
      return;
    }
    if (item.type === 'submenu') {
      const wrapper = document.createElement('div');
      const el = document.createElement('div');
      el.className = 'gb-context-menu-item';
      el.innerHTML = item.label + (typeof submenuArrow === 'function' ? submenuArrow() : ' ▸');
      const sub = document.createElement('div');
      sub.className = 'gb-context-menu gb-context-submenu';
      sub.style.display = 'none';
      _renderDbViewTabMenuItems(sub, item.children || []);
      if (typeof attachHoverSubmenu === 'function') attachHoverSubmenu(el, sub);
      else {
        el.addEventListener('mouseenter', () => { sub.style.display = 'block'; });
        wrapper.addEventListener('mouseleave', () => { sub.style.display = 'none'; });
      }
      wrapper.appendChild(el);
      wrapper.appendChild(sub);
      container.appendChild(wrapper);
      return;
    }
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
    el.innerHTML = item.label;
    if (item.disabled) {
      el.style.opacity = '0.4';
      el.style.pointerEvents = 'none';
    } else {
      el.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        closeColHeaderMenu();
        try {
          await item.action();
        } catch (err) {
          console.error(err);
          showStatus('ビュー操作に失敗しました: ' + (err?.message || err), true);
        }
      });
    }
    container.appendChild(el);
  });
}
function setGroupBy(dbPath, prop, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: グループ化', options.detail || prop || '解除', options, (v) => {
    if (!v.typeSpecific || typeof v.typeSpecific !== 'object' || Array.isArray(v.typeSpecific)) v.typeSpecific = {};
    if (!v.typeSpecific.pivot || typeof v.typeSpecific.pivot !== 'object' || Array.isArray(v.typeSpecific.pivot)) v.typeSpecific.pivot = {};
    v.typeSpecific.pivot.groupBy = prop;
  });
}

// renderPivotに統合（後述のrenderPivot改修で使用）

function _dbValueMatchesAdvancedFilter(valueObj, filter) {
  const target = filter.field === 'status' ? (valueObj?.status || '') : (valueObj?.value || '');
  switch (filter.operator) {
    case 'equals': return target === filter.value;
    case 'not_equals': return target !== filter.value;
    case 'contains': return target && target.includes(filter.value);
    case 'not_contains': return !target || !target.includes(filter.value);
    case 'empty': return !target || String(target).trim() === '';
    case 'not_empty': return target && String(target).trim() !== '';
    default: return true;
  }
}

function _dbValuesMatchAdvancedFilter(values, filter) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) return filter.operator === 'empty' || filter.operator === 'not_contains';
  if (filter.operator === 'not_equals' || filter.operator === 'not_contains') {
    return list.every(v => _dbValueMatchesAdvancedFilter(v, filter));
  }
  return list.some(v => _dbValueMatchesAdvancedFilter(v, filter));
}

function _dbFilterValuesForCurrentView(values) {
  const list = Array.isArray(values) ? values : [];
  return typeof filterValues === 'function' ? filterValues(list) : list;
}

function _dbEntityPassesAdvancedFilters(entityData, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return true;
  return filters.every(filter => {
    if (filter.property === '*') {
      const allValues = Object.values(entityData || {})
        .flatMap(vals => Array.isArray(vals) ? _dbFilterValuesForCurrentView(vals) : [])
        .filter(v => v && typeof v === 'object');
      return _dbValuesMatchAdvancedFilter(allValues, filter);
    }
    const values = _dbFilterValuesForCurrentView(entityData?.[filter.property] || []);
    return _dbValuesMatchAdvancedFilter(values, filter);
  });
}

function _isKanbanGroupableProperty(dbPath, propName) {
  const ptc = getPropertyTypes(dbPath)[propName] || {};
  if (ptc.source) return false;
  if (['formula', 'rollup', 'button', 'multi-source-relation', 'chat'].includes(ptc.type || '')) return false;
  return !checkColumnEditable(dbPath, propName);
}

function _kanbanStatusDefs(dbPath) {
  const preferredOrder = ['掲載済み', '採用', '案', 'ボツ'];
  const sourceList = (typeof getStatusList === 'function') ? getStatusList(dbPath) : [];
  const rawList = Array.isArray(sourceList) && sourceList.length
    ? sourceList
    : preferredOrder.map(name => ({ name, color: typeof _getStatusColor === 'function' ? _getStatusColor(name, dbPath) : '' }));
  const byName = new Map();
  rawList.forEach(item => {
    const name = String(item?.name ?? item ?? '').trim();
    if (!name || byName.has(name)) return;
    const color = item?.color || (typeof _getStatusColor === 'function' ? _getStatusColor(name, dbPath) : '');
    byName.set(name, { name, color });
  });
  const ordered = [];
  const seen = new Set();
  const push = (name) => {
    if (!byName.has(name) || seen.has(name)) return;
    ordered.push(byName.get(name));
    seen.add(name);
  };
  preferredOrder.forEach(push);
  rawList.forEach(item => push(String(item?.name ?? item ?? '').trim()));
  return ordered.length ? ordered : preferredOrder.map(name => ({ name, color: '' }));
}

function _kanbanEntityMainStatus(entityData, dbPath) {
  const order = _kanbanStatusDefs(dbPath).map(item => item.name);
  let best = '';
  let bestIdx = Infinity;
  Object.values(entityData || {}).forEach(propVals => {
    if (!Array.isArray(propVals)) return;
    propVals.forEach(v => {
      const status = String(v?.status || '採用').trim() || '採用';
      let idx = order.indexOf(status);
      if (idx < 0) idx = order.length;
      if (idx < bestIdx) {
        best = status;
        bestIdx = idx;
      }
    });
  });
  return best || order[0] || '採用';
}

function _kanbanValueRef(valueObj, propName) {
  return {
    file: valueObj?.file,
    property: valueObj?.property || propName,
    candidate_index: valueObj?.candidate_index,
  };
}

function _kanbanStatusMoveTargets(entityData, dbPath) {
  const entries = [];
  Object.entries(entityData || {}).forEach(([propName, propVals]) => {
    if (!Array.isArray(propVals)) return;
    propVals.forEach(v => {
      if (!v || typeof v !== 'object') return;
      const old = String(v.status || '採用').trim() || '採用';
      entries.push({ val: v, ref: _kanbanValueRef(v, propName), old, propName });
    });
  });
  const adopted = entries.filter(item => item.old === '採用' || item.old === '掲載済み');
  if (adopted.length) return adopted;
  const mainStatus = _kanbanEntityMainStatus(entityData, dbPath);
  return entries.filter(item => item.old === mainStatus);
}

async function _rollbackKanbanStatusMove(statusWriteOps, autoFillOps) {
  if (typeof _undoAutoFillStatusOps === 'function') {
    try { await _undoAutoFillStatusOps(autoFillOps); } catch {}
  }
  for (const op of [...(statusWriteOps || [])].reverse()) {
    try { await _apiPutValue(op.ref || op.val, { new_status: op.old }); } catch {}
  }
}

function _kanbanAdoptedValueForWrite(values) {
  if (typeof getAdoptedValueForWrite === 'function') return getAdoptedValueForWrite(values);
  const list = Array.isArray(values) ? values : [];
  return list.find(v => ['採用', '掲載済み'].includes(v?.status || '採用')) || null;
}

/* ==============================
   ギャラリービュー
   ============================== */
function _dbViewSurfaceEl(ctx, selector, id) {
  if (ctx && ctx.containerEl) {
    const scoped = ctx.containerEl.querySelector(selector);
    if (scoped) return scoped;
  }
  return document.getElementById(id) || document.querySelector(selector);
}

function _galleryImageSrcFromValue(rawValue, dbPath, entityName) {
  const items = typeof parseImagePropertyValue === 'function' ? parseImagePropertyValue(rawValue) : [];
  if (items.length && typeof _imageSrc === 'function') return _imageSrc(items[0], true);
  const text = String(rawValue || '').trim();
  if (!text || !/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(text)) return '';
  if (/^(https?:|data:|blob:|\/)/.test(text)) return text;
  return '/api/file-raw?path=' + encodeURIComponent(dbPath + '/' + entityName + '/' + text);
}

function renderGallery(ctx) {
  ctx = ctx || _currentPaneState();
  const data = ctx.pivotData || state.pivotData;
  const container = _dbViewSurfaceEl(ctx, '.gallery-view', 'gallery-view');
  if (!container) {
    if (typeof showStatus === 'function') showStatus('シートのギャラリー表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }
  container.style.display = 'flex';
  if (!data || !data.entities) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--fg2);">データがありません</div>'; return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const hiddenCols = getHiddenCols(dbPath);
  const advFilters = getAdvancedFilters(dbPath);
  const propTypes = getPropertyTypes(dbPath);
  const colOrder = getColOrder(dbPath);
  const entitiesMap = data.entities;
  const entityNames = Object.keys(entitiesMap)
    .filter(name => _dbEntityPassesAdvancedFilters(entitiesMap[name], advFilters))
    .sort();
  if (entityNames.length === 0) { renderEmptyState(container, 'image', 'エントリがありません', '下部の入力欄から追加してください'); return; }
  // colOrder適用（renderPivotと同じ順序ロジック）
  let orderedProps = colOrder ? colOrder.filter(p => data.properties.includes(p)) : [...data.properties];
  data.properties.forEach(p => { if (!orderedProps.includes(p)) orderedProps.push(p); });
  const visibleProps = orderedProps.filter(p => !hiddenCols.includes(p));

  const grid = document.createElement('div');
  grid.className = 'gallery-grid';

  entityNames.forEach(entityName => {
    const entityData = entitiesMap[entityName];
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.dataset.entity = entityName;
    card.addEventListener('click', () => openEntityInSplit(_entityPath(dbPath, entityName), entityName));
    card.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, entityName);
      selectEntity(_entityPath(dbPath, entityName));
    });
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); showDbCardContextMenu(e, dbPath, entityName); });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(card, (e) => showDbCardContextMenu(e, dbPath, entityName));
    }

    // タッチ用メニューボタン
    const moreBtn = document.createElement('span');
    moreBtn.className = 'card-more-btn';
    moreBtn.innerHTML = lucide('moreHorizontal', 12);
    moreBtn.title = 'メニュー';
    moreBtn.style.cssText = 'position:absolute;top:4px;right:4px;cursor:pointer;font-size:14px;color:var(--fg2);padding:2px 4px;border-radius:3px;z-index:5;';
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showDbCardContextMenu(e, dbPath, entityName); });
    card.style.position = 'relative';
    card.appendChild(moreBtn);

    // タイトル
    const title = document.createElement('div');
    title.className = 'gallery-card-title';
    title.textContent = entityName;
    card.appendChild(title);

    // 画像プロパティがあればサムネイル
    for (const propName of visibleProps) {
      const vals = filterValues(entityData[propName] || []);
      for (const val of vals) {
        const imgSrc = _galleryImageSrcFromValue(val.value, dbPath, entityName);
        if (imgSrc) {
          const img = document.createElement('img');
          img.className = 'gallery-card-thumb';
          img.src = imgSrc;
          img.onerror = () => img.remove();
          card.insertBefore(img, title.nextSibling);
          break;
        }
      }
    }

    // プロパティ一覧（先頭4件）
    const propsDiv = document.createElement('div');
    propsDiv.className = 'gallery-card-props';
    let shown = 0;
    for (const propName of visibleProps) {
      if (shown >= 4) break;
      // sourceプロパティ: メタデータから表示
      const ptcG = propTypes[propName];
      let displayVal = '';
      if (ptcG && ptcG.source) {
        const metaKey = '_' + ptcG.source;
        const mv = entityData[metaKey] || '';
        if (ptcG.source === 'modified' && mv) displayVal = mv.replace('T', ' ').substring(0, 16);
        else displayVal = mv || '';
      } else {
        const vals = filterValues(entityData[propName] || []);
        if (vals.length === 0) continue;
        displayVal = vals.map(v => v.value).join(', ');
      }
      if (!displayVal) continue;
      const propRow = document.createElement('div');
      propRow.className = 'gallery-card-prop';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'gallery-card-prop-name';
      nameSpan.textContent = propName + ':';
      propRow.appendChild(nameSpan);
      const valSpan = document.createElement('span');
      valSpan.className = 'gallery-card-prop-val';
      if (!ptcG?.source && typeof _dbRichAppendValuePreview === 'function') {
        _dbRichAppendValuePreview(valSpan, filterValues(entityData[propName] || []));
      } else {
        valSpan.textContent = displayVal;
      }
      propRow.appendChild(valSpan);
      propsDiv.appendChild(propRow);
      shown++;
    }
    card.appendChild(propsDiv);

    // リレーション表示
    const allRelations = [];
    Object.values(entityData).forEach(vals => {
      if (!Array.isArray(vals)) return;
      vals.forEach(v => {
        if (v.relations && v.relations.length > 0) {
          v.relations.forEach(r => allRelations.push(r));
        }
      });
    });
    if (allRelations.length > 0) {
      const relDiv = document.createElement('div');
      relDiv.className = 'relation-links';
      relDiv.style.marginTop = '6px';
      allRelations.slice(0, 3).forEach(r => {
        const link = document.createElement('span');
        link.className = 'relation-link';
        link.textContent = (r.entity || '') + (r.role ? ' (' + r.role + ')' : '');
        link.dataset.dbPath = r.db_path || r.dbPath || r.database || dbPath;
        link.dataset.entityName = r.entity || '';
        link.addEventListener('click', (e) => { e.stopPropagation(); navigateToEntity(r.entity, link.dataset.dbPath || dbPath); });
        relDiv.appendChild(link);
      });
      card.appendChild(relDiv);
    }

    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

// リレーションエントリへのナビゲーション
/* ==============================
   カンバンビュー
   ============================== */
function getKanbanGroupBy(dbPath) {
  return getCurrentDbViewTypeSpecific(dbPath, 'kanban')?.groupBy || '_status';
}
function setKanbanGroupBy(dbPath, prop, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: カンバングループ', options.detail || prop || '', options, (v) => {
    if (!v.typeSpecific || typeof v.typeSpecific !== 'object' || Array.isArray(v.typeSpecific)) v.typeSpecific = {};
    if (!v.typeSpecific.kanban || typeof v.typeSpecific.kanban !== 'object' || Array.isArray(v.typeSpecific.kanban)) v.typeSpecific.kanban = {};
    v.typeSpecific.kanban.groupBy = prop;
  });
}

function renderKanban(ctx) {
  ctx = ctx || _currentPaneState();
  const data = ctx.pivotData || state.pivotData;
  const container = _dbViewSurfaceEl(ctx, '.kanban-view', 'kanban-view');
  if (!container) {
    if (typeof showStatus === 'function') showStatus('シートのカンバン表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }
  container.style.display = 'flex';
  if (!data || !data.entities) { container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--fg2);">データがありません</div>'; return; }

  const dbPath = ctx.dbPath || state.currentDbPath;
  const entitiesMap = data.entities;
  const advFilters = getAdvancedFilters(dbPath);
  const entityNames = Object.keys(entitiesMap)
    .filter(name => _dbEntityPassesAdvancedFilters(entitiesMap[name], advFilters))
    .sort();
  if (entityNames.length === 0) { renderEmptyState(container, 'columns', 'エントリがありません', '下部の入力欄から追加してください'); return; }
  const hiddenCols = getHiddenCols(dbPath);
  const colOrder = getColOrder(dbPath);
  let orderedProps = colOrder ? colOrder.filter(p => data.properties.includes(p)) : [...data.properties];
  data.properties.forEach(p => { if (!orderedProps.includes(p)) orderedProps.push(p); });
  const visibleProps = orderedProps.filter(p => !hiddenCols.includes(p));
  let groupByProp = getKanbanGroupBy(dbPath);
  if (groupByProp !== '_status' && !_isKanbanGroupableProperty(dbPath, groupByProp)) {
    groupByProp = '_status';
    setKanbanGroupBy(dbPath, groupByProp, { skipHistory: true });
  }

  // グループ化: ステータスまたはSelect型プロパティで分類
  const columns = new Map();

  if (groupByProp === '_status') {
    // ステータスベースのカンバン
    const statusDefs = _kanbanStatusDefs(dbPath);
    statusDefs.forEach(st => columns.set(st.name, []));

    entityNames.forEach(entityName => {
      const entityData = entitiesMap[entityName];
      const mainStatus = _kanbanEntityMainStatus(entityData, dbPath);
      if (!columns.has(mainStatus)) columns.set(mainStatus, []);
      columns.get(mainStatus).push({ name: entityName, data: entityData, status: mainStatus });
    });
  } else {
    // プロパティベースのカンバン
    entityNames.forEach(entityName => {
      const entityData = entitiesMap[entityName];
      const vals = filterValues(entityData[groupByProp] || []);
      const groupKey = vals.length > 0 ? vals[0].value : '(未設定)';
      if (!columns.has(groupKey)) columns.set(groupKey, []);
      columns.get(groupKey).push({ name: entityName, data: entityData, groupValue: groupKey });
    });
  }

  // ヘッダー: グループ化プロパティ選択
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-shrink:0;';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:12px;color:var(--fg2);';
  label.textContent = 'グループ化:';
  header.appendChild(label);

  const sel = document.createElement('select');
  sel.className = 'gb-select';
  sel.dataset.e2eId = 'kanban-group-by-select';
  sel.setAttribute('aria-label', 'カンバンのグループ化');
  const optStatus = document.createElement('option');
  optStatus.value = '_status'; optStatus.textContent = 'ステータス';
  if (groupByProp === '_status') optStatus.selected = true;
  sel.appendChild(optStatus);
  visibleProps.filter(p => _isKanbanGroupableProperty(dbPath, p)).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    if (groupByProp === p) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.onchange = () => { setKanbanGroupBy(dbPath, sel.value); renderKanban(ctx); };
  header.appendChild(sel);

  // ボード描画
  const board = document.createElement('div');
  board.className = 'kanban-board';

  const statusColors = new Map(_kanbanStatusDefs(dbPath).map(st => [st.name, st.color]));

  columns.forEach((cards, colKey) => {
    const col = document.createElement('div');
    col.className = 'kanban-column';

    // カラムヘッダー
    const colHeader = document.createElement('div');
    colHeader.className = 'kanban-column-header';
    if (groupByProp === '_status') {
      const dot = document.createElement('span');
      dot.className = 'kanban-dot';
      dot.style.background = statusColors.get(colKey) || (typeof _getStatusColor === 'function' ? _getStatusColor(colKey, dbPath) : '#888');
      colHeader.appendChild(dot);
    }
    const colTitle = document.createElement('span');
    colTitle.textContent = colKey;
    colHeader.appendChild(colTitle);
    const countBadge = document.createElement('span');
    countBadge.className = 'kanban-count';
    countBadge.textContent = cards.length;
    colHeader.appendChild(countBadge);
    col.appendChild(colHeader);

    // カラムボディ（カード一覧 + D&Dドロップ先）
    const colBody = document.createElement('div');
    colBody.className = 'kanban-column-body';
    colBody.dataset.column = colKey;

    // D&D: ドロップ先
    colBody.addEventListener('dragover', (e) => { e.preventDefault(); colBody.classList.add('drag-over'); });
    colBody.addEventListener('dragleave', () => colBody.classList.remove('drag-over'));
    colBody.addEventListener('drop', async (e) => {
      e.preventDefault();
      colBody.classList.remove('drag-over');
      const entityName = e.dataTransfer.getData('text/x-kanban-entity');
      if (!entityName) return;

      // ロックチェック（プロパティベースのグループ化の場合）
      if (groupByProp !== '_status') {
        const lockMsg = checkColumnEditable(dbPath, groupByProp);
        if (lockMsg) { showStatus(lockMsg); return; }
      }

      if (groupByProp === '_status') {
        // ステータスベース: 代表候補だけを変更し、案/ボツなどの別候補を巻き込まない
        const entityData = entitiesMap[entityName];
        const statusWriteOps = [];
        const autoFillOps = [];
        try {
          const statusTargets = _kanbanStatusMoveTargets(entityData, dbPath);
          for (const target of statusTargets) {
            if (target.old === colKey) continue;
            await _apiPutValue(target.ref, { new_status: colKey });
            statusWriteOps.push(target);
            if (typeof _autoFillOnStatusChange === 'function') {
              const entityPath = _entityPath(dbPath, entityName);
              const ops = await _autoFillOnStatusChange(entityPath, target.propName, colKey, dbPath);
              if (Array.isArray(ops)) autoFillOps.push(...ops);
            }
          }
        } catch(err) {
          await _rollbackKanbanStatusMove(statusWriteOps, autoFillOps);
          showStatus('ステータス更新に失敗: ' + (err.message || err), true);
          await selectDatabase(dbPath);
          return;
        }
        if (statusWriteOps.length > 0) {
          historyPush('カンバン移動: ' + entityName + ' → ' + colKey,
            async () => {
              if (typeof _undoAutoFillStatusOps === 'function') await _undoAutoFillStatusOps(autoFillOps);
              for (const s of [...statusWriteOps].reverse()) { try { await _apiPutValue(s.ref, { new_status: s.old }); } catch {} }
              await selectDatabase(dbPath);
            },
            async () => {
              for (const s of statusWriteOps) { try { await _apiPutValue(s.ref, { new_status: colKey }); } catch {} }
              if (typeof _redoAutoFillStatusOps === 'function') await _redoAutoFillStatusOps(autoFillOps);
              await selectDatabase(dbPath);
            },
            _dbScope()
          );
        }
      } else {
        // プロパティベース: 該当プロパティの採用値を変更
        const entityData = entitiesMap[entityName];
        const rawVals = entityData[groupByProp] || [];
        // 案/ボツの先頭候補を書き換えないよう、採用/掲載済みの代表候補だけを対象にする
        const target = _kanbanAdoptedValueForWrite(rawVals);
        if (target) {
          const oldVal = target.value || '';
          try {
            if (colKey === '(未設定)') {
              const oldStatus = target.status || '採用';
              const oldNote = target.note || '';
              const oldRichHtml = target.rich_html || '';
              let currentRef = { file: target.file, property: target.property || groupByProp, candidate_index: target.candidate_index };
              await _apiPutValue(target, { _delete: true });
              historyPush('カンバン移動: ' + entityName,
                async () => {
                  const result = await _apiPostValue(_entityPath(dbPath, entityName), groupByProp, oldVal, oldStatus, oldNote, oldRichHtml);
                  currentRef = { file: result?.path || result?.file || currentRef.file, property: result?.property || groupByProp, candidate_index: result?.candidate_index };
                  await selectDatabase(dbPath);
                },
                async () => { await _apiPutValue(currentRef, { _delete: true }); await selectDatabase(dbPath); },
                _dbScope()
              );
            } else {
              await _apiPutValue(target, { new_value: colKey });
              _dbUndoValue('カンバン移動: ' + entityName, target, oldVal, colKey);
            }
          } catch(err) {
            showStatus('値の更新に失敗: ' + (err.message || err), true);
            await selectDatabase(dbPath);
            return;
          }
        } else {
          // 値が存在しない場合は新規に採用値を追加
          if (colKey !== '(未設定)') {
            try {
              const entityPath = _entityPath(dbPath, entityName);
              const result = await _apiPostValue(entityPath, groupByProp, colKey, '採用', '');
              let createdRef = { file: result?.path || result?.file, property: result?.property || groupByProp, candidate_index: result?.candidate_index };
              if (createdRef.file) {
                historyPush('カンバン移動: ' + entityName,
                  async () => { await _apiPutValue(createdRef, { _delete: true }); await selectDatabase(dbPath); },
                  async () => {
                    const redo = await _apiPostValue(entityPath, groupByProp, colKey, '採用', '');
                    createdRef = { file: redo?.path || redo?.file || createdRef.file, property: redo?.property || groupByProp, candidate_index: redo?.candidate_index };
                    await selectDatabase(dbPath);
                  },
                  _dbScope()
                );
              }
            } catch(err) { showStatus('値の更新に失敗: ' + (err.message || err), true); await selectDatabase(dbPath); return; }
          }
        }
      }
      showStatus(entityName + ' → ' + colKey);
      selectDatabase(dbPath);
    });

    // カード描画
    cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'kanban-card';
      cardEl.dataset.entity = card.name;
      cardEl.draggable = true;

      // D&D: ドラッグ開始
      cardEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-kanban-entity', card.name);
        e.dataTransfer.effectAllowed = 'move';
        cardEl.classList.add('dragging');
      });
      cardEl.addEventListener('dragend', () => cardEl.classList.remove('dragging'));

      // クリック: サイドバーに詳細表示
      cardEl.addEventListener('click', () => openEntityInSplit(_entityPath(dbPath, card.name), card.name));
      cardEl.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, card.name);
        selectEntity(_entityPath(dbPath, card.name));
      });
      cardEl.addEventListener('contextmenu', (e) => { e.preventDefault(); showDbCardContextMenu(e, dbPath, card.name); });
      if (typeof addLongPressHandler === 'function') {
        addLongPressHandler(cardEl, (e) => showDbCardContextMenu(e, dbPath, card.name));
      }

      // タッチ用メニューボタン
      const moreBtn = document.createElement('span');
      moreBtn.className = 'card-more-btn';
      moreBtn.innerHTML = lucide('moreHorizontal', 12);
      moreBtn.title = 'メニュー';
      moreBtn.style.cssText = 'position:absolute;top:4px;right:4px;cursor:pointer;font-size:14px;color:var(--fg2);padding:2px 4px;border-radius:3px;z-index:5;';
      moreBtn.addEventListener('click', (e) => { e.stopPropagation(); showDbCardContextMenu(e, dbPath, card.name); });
      cardEl.style.position = 'relative';
      cardEl.appendChild(moreBtn);

      // タイトル
      const title = document.createElement('div');
      title.className = 'kanban-card-title';
      title.textContent = card.name;
      cardEl.appendChild(title);

      // プロパティプレビュー（先頭3件）
      const propsDiv = document.createElement('div');
      propsDiv.className = 'kanban-card-props';
      let shown = 0;
      for (const propName of visibleProps) {
        if (shown >= 3) break;
        if (propName === groupByProp) continue; // グループ化プロパティは表示不要
        const vals = filterValues(card.data[propName] || []);
        if (vals.length === 0) continue;
        const propRow = document.createElement('div');
        propRow.className = 'kanban-card-prop';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'kanban-card-prop-name';
        nameSpan.textContent = propName + ': ';
        propRow.appendChild(nameSpan);
        if (typeof _dbRichAppendValuePreview === 'function') {
          _dbRichAppendValuePreview(propRow, vals);
        } else {
          propRow.appendChild(document.createTextNode(vals.map(v => v.value).join(', ')));
        }
        propsDiv.appendChild(propRow);
        shown++;
      }
      cardEl.appendChild(propsDiv);

      colBody.appendChild(cardEl);
    });

    col.appendChild(colBody);
    board.appendChild(col);
  });

  container.innerHTML = '';
  container.appendChild(header);
  container.appendChild(board);
}

/* ==============================
   タイムラインビュー
   ============================== */
