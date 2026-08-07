/* ツリービューの列ヘッダー操作。
   列幅、列順、固定状態、共通列メニューを保存済みビュー単位で扱う。 */

function _dbTreeApplyLiveColumnWidth(list, propName, width) {
  const layout = list?._dbTreeLayout;
  if (!layout || !layout.keys.includes(propName)) return;
  layout.widths[propName] = Math.max(60, Math.min(640, Math.round(width)));
  const parts = layout.keys.map(key => `${layout.widths[key]}px`);
  layout.template = [...parts, `${layout.actionWidth}px`].join(' ');
  layout.totalWidth = layout.keys.reduce((sum, key) => sum + layout.widths[key], 0) + layout.actionWidth;
  const header = list.querySelector('.db-tree-header');
  const rows = list.querySelector('.db-tree-rows');
  if (header) {
    header.style.gridTemplateColumns = layout.template;
    header.style.width = `${layout.totalWidth}px`;
  }
  if (rows) rows.style.width = `${layout.totalWidth}px`;
  list.querySelectorAll('.db-tree-row').forEach(row => { row.style.gridTemplateColumns = layout.template; });
  list.querySelectorAll('.db-tree-row-window').forEach(windowHost => {
    windowHost.style.width = `${layout.totalWidth}px`;
  });
  list.querySelectorAll('.db-tree-column-resize-handle').forEach(handle => {
    if (handle.dataset.dbResizeToken === propName) {
      handle.setAttribute('aria-valuenow', String(layout.widths[propName]));
    }
  });
  let stickyLeft = 0;
  (layout.pinnedKeys || []).forEach(key => {
    list.querySelectorAll('.db-tree-header-cell.is-pinned').forEach(cell => {
      if (cell.dataset.dbColToken === key) cell.style.left = `${stickyLeft}px`;
    });
    list.querySelectorAll('[data-db-pinned-token]').forEach(cell => {
      if (cell.dataset.dbPinnedToken === key) cell.style.left = `${stickyLeft}px`;
    });
    stickyLeft += layout.widths[key] || 0;
  });
}

function _dbTreePersistColumnWidth(list, propName, width, ctx, dbPath) {
  const nextWidth = Math.max(60, Math.min(640, Math.round(width)));
  setColWidthPersist(dbPath, propName, nextWidth, {
    ctx,
    label: 'シート表示: 列幅',
    detail: propName,
  });
  _dbTreeApplyLiveColumnWidth(list, propName, nextWidth);
}

function _dbTreeStartColumnResize(event, handle, list, propName, ctx, dbPath) {
  event.preventDefault();
  event.stopPropagation();
  const layout = list?._dbTreeLayout;
  if (!layout) return;
  const startX = event.clientX;
  const startWidth = layout.widths[propName];
  let lastWidth = startWidth;
  handle.classList.add('active');
  try {
    handle.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic pointer events used by deterministic E2E do not own a native pointer.
  }
  const onMove = moveEvent => {
    lastWidth = startWidth + moveEvent.clientX - startX;
    _dbTreeApplyLiveColumnWidth(list, propName, lastWidth);
  };
  const onUp = upEvent => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    handle.classList.remove('active');
    try {
      handle.releasePointerCapture?.(upEvent?.pointerId ?? event.pointerId);
    } catch {
      // The browser may already have released capture after cancellation.
    }
    _dbTreePersistColumnWidth(list, propName, list._dbTreeLayout.widths[propName], ctx, dbPath);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function _dbTreeReorderColumn(dbPath, ctx, config, properties, fromName, targetName, beforeTarget) {
  const labelKey = config.labelProp || '__entity__';
  if (!fromName || fromName === labelKey || fromName === targetName) return false;
  const hidden = typeof getHiddenCols === 'function' ? getHiddenCols(dbPath, { ctx }) : [];
  const structural = new Set([
    config.parentProp,
    config.orderProp,
    config.collapsedProp,
    '内部ID',
  ].filter(Boolean));
  const oldOrder = typeof getColOrder === 'function' ? (getColOrder(dbPath, { ctx }) || []) : [];
  const extra = [...new Set([...oldOrder, ...properties])]
    .filter(name => name !== labelKey && properties.includes(name) && !hidden.includes(name) && !structural.has(name));
  const nextExtra = extra.filter(name => name !== fromName);
  const targetIndex = targetName === labelKey ? 0 : nextExtra.indexOf(targetName);
  const insertIndex = targetIndex < 0
    ? nextExtra.length
    : Math.max(0, targetIndex + (beforeTarget || targetName === labelKey ? 0 : 1));
  nextExtra.splice(insertIndex, 0, fromName);
  const visible = [labelKey, ...nextExtra];
  const remainder = [...new Set([...oldOrder, ...properties])]
    .filter(name => !visible.includes(name));
  setColOrder(dbPath, [...visible, ...remainder], {
    ctx,
    label: 'シート表示: 列順序',
    detail: `${fromName} → ${insertIndex + 2}列目`,
  });
  renderDbTreeView(ctx);
  return true;
}

function _dbTreeOpenColumnMenu(event, propName, index, hierarchy, ctx, dbPath) {
  const rect = event.currentTarget?.getBoundingClientRect?.()
    || event.target?.getBoundingClientRect?.()
    || { right: 0, bottom: 0 };
  const menuEvent = {
    target: event.target,
    currentTarget: event.currentTarget,
    clientX: Number(event.clientX) || rect.right,
    clientY: Number(event.clientY) || rect.bottom,
  };
  if (propName === '__entity__') {
    showEntityColMenu(menuEvent, ctx, dbPath);
    return;
  }
  showColHeaderMenu(menuEvent, propName, index, ctx, dbPath, {
    omitGroupBy: true,
    protectLeftEdge: hierarchy,
    protectVisibility: hierarchy,
    includeManualSort: true,
  });
}

function _dbTreeAppendHeaderIndicator(cell, icon, title, className) {
  const indicator = document.createElement('span');
  indicator.className = className;
  indicator.innerHTML = lucide(icon, 12);
  indicator.title = title;
  indicator.setAttribute('aria-label', title);
  cell.appendChild(indicator);
}

function _dbTreeCreateColumnHeader({
  propName,
  index,
  hierarchy,
  ctx,
  dbPath,
  config,
  properties,
  list,
  host,
  pinnedOffsets,
}) {
  const cell = document.createElement('span');
  cell.className = 'db-tree-header-cell';
  cell.dataset.dbColToken = propName;
  cell.dataset.e2eId = `db-tree-column-header-${propName}`;
  cell.setAttribute('role', 'columnheader');
  cell.tabIndex = 0;
  if (hierarchy) cell.classList.add('is-hierarchy');
  const stickyLeft = pinnedOffsets[propName];
  if (Number.isFinite(stickyLeft)) {
    cell.classList.add('is-pinned');
    cell.style.left = `${stickyLeft}px`;
  }

  if (propName !== '__entity__') {
    const type = getPropertyTypes(dbPath, ctx)?.[propName]?.type || 'text';
    const typeIcon = document.createElement('span');
    typeIcon.className = 'db-tree-header-type';
    typeIcon.innerHTML = lucide(
      typeof getPropertyTypeIcon === 'function' ? getPropertyTypeIcon(type) : 'alignLeft',
      13,
    );
    typeIcon.title = `列タイプ: ${typeof getPropertyTypeLabel === 'function' ? getPropertyTypeLabel(type) : type}`;
    cell.appendChild(typeIcon);
  }
  const label = document.createElement('span');
  label.className = 'db-tree-header-label';
  label.textContent = propName === '__entity__'
    ? (typeof _dbEntityColumnDisplayLabel === 'function' ? _dbEntityColumnDisplayLabel(dbPath, { ctx }) : 'エントリ名')
    : propName;
  cell.appendChild(label);

  const sortConfig = typeof getDbSortConfig === 'function' ? getDbSortConfig(dbPath, { ctx }) : null;
  const sortKey = propName === '__entity__' ? 'name' : propName;
  if (sortConfig?.key === sortKey) {
    cell.classList.add('is-sorted');
    cell.setAttribute('aria-sort', sortConfig.dir === 'desc' ? 'descending' : 'ascending');
    _dbTreeAppendHeaderIndicator(
      cell,
      sortConfig.dir === 'desc' ? 'arrowDown' : 'arrowUp',
      sortConfig.dir === 'desc' ? '降順' : '昇順',
      'db-tree-header-indicator is-sort',
    );
  }
  if (typeof isDbColumnFilterActive === 'function' && isDbColumnFilterActive(dbPath, propName, ctx)) {
    cell.classList.add('is-filtered');
    _dbTreeAppendHeaderIndicator(cell, 'filter', 'フィルター適用中', 'db-tree-header-indicator is-filter');
  }
  if (propName !== '__entity__') {
    const ptc = getPropertyTypes(dbPath, ctx)?.[propName];
    const lock = typeof getColumnLock === 'function' ? getColumnLock(dbPath, propName) : 'none';
    if (ptc?.source || lock !== 'none') {
      _dbTreeAppendHeaderIndicator(
        cell,
        ptc?.source ? 'zap' : lock === 'admin' ? 'shield' : 'lock',
        ptc?.source ? '自動入力（読み取り専用）' : lock === 'admin' ? '管理者のみ編集' : 'ロック',
        'db-tree-header-indicator is-lock',
      );
    }
  }
  if (Number.isFinite(stickyLeft)) {
    _dbTreeAppendHeaderIndicator(cell, 'pin', '固定列', 'db-tree-header-indicator is-pin');
  }

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'db-tree-header-more';
  more.innerHTML = lucide('moreHorizontal', 14);
  more.title = '列メニュー';
  more.setAttribute('aria-label', `${label.textContent}列メニュー`);
  more.addEventListener('click', event => {
    event.stopPropagation();
    _dbTreeOpenColumnMenu(event, propName, index, hierarchy, ctx, dbPath);
  });
  cell.appendChild(more);

  const resize = document.createElement('span');
  resize.className = 'db-tree-column-resize-handle';
  resize.dataset.e2eId = `db-tree-column-resize-${propName}`;
  resize.dataset.dbResizeToken = propName;
  resize.tabIndex = 0;
  resize.setAttribute('role', 'separator');
  resize.setAttribute('aria-orientation', 'vertical');
  resize.setAttribute('aria-valuemin', '60');
  resize.setAttribute('aria-valuemax', '640');
  resize.setAttribute('aria-valuenow', String(list._dbTreeLayout?.widths?.[propName] || 150));
  resize.setAttribute('aria-label', `${label.textContent}の列幅を変更`);
  resize.addEventListener('pointerdown', event => {
    _dbTreeStartColumnResize(event, resize, list, propName, ctx, dbPath);
  });
  resize.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    const amount = event.shiftKey ? 40 : 8;
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    _dbTreePersistColumnWidth(list, propName, list._dbTreeLayout.widths[propName] + amount * direction, ctx, dbPath);
  });
  cell.appendChild(resize);

  cell.addEventListener('contextmenu', event => {
    event.preventDefault();
    _dbTreeOpenColumnMenu(event, propName, index, hierarchy, ctx, dbPath);
  });
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(cell, event => {
      if (!cell.isConnected) return;
      if (event.target?.closest?.('button, .db-tree-column-resize-handle')) return;
      _dbTreeOpenColumnMenu(event, propName, index, hierarchy, ctx, dbPath);
    });
  }
  cell.addEventListener('click', event => {
    if (event.target.closest('button, .db-tree-column-resize-handle')) return;
    if (typeof _setSelectedColumns === 'function') _setSelectedColumns(dbPath, [propName], propName);
    host.querySelectorAll('.db-tree-header-cell.is-selected').forEach(item => item.classList.remove('is-selected'));
    cell.classList.add('is-selected');
  });

  cell.draggable = !hierarchy;
  if (!hierarchy) {
    cell.addEventListener('dragstart', event => {
      if (event.target.closest('button, .db-tree-column-resize-handle')) {
        event.preventDefault();
        return;
      }
      host.dataset.draggingColumn = propName;
      event.dataTransfer?.setData('text/x-db-tree-column', propName);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      cell.classList.add('is-dragging');
    });
    cell.addEventListener('dragend', () => {
      host.dataset.draggingColumn = '';
      cell.classList.remove('is-dragging');
      host.querySelectorAll('.is-drop-before,.is-drop-after').forEach(item => {
        item.classList.remove('is-drop-before', 'is-drop-after');
      });
    });
  }
  cell.addEventListener('dragover', event => {
    const fromName = host.dataset.draggingColumn || event.dataTransfer?.getData('text/x-db-tree-column');
    if (!fromName || fromName === propName) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = cell.getBoundingClientRect();
    const before = hierarchy || event.clientX < rect.left + rect.width / 2;
    cell.classList.toggle('is-drop-before', before);
    cell.classList.toggle('is-drop-after', !before);
  });
  cell.addEventListener('dragleave', event => {
    if (!event.relatedTarget || !cell.contains(event.relatedTarget)) {
      cell.classList.remove('is-drop-before', 'is-drop-after');
    }
  });
  cell.addEventListener('drop', event => {
    event.preventDefault();
    const fromName = host.dataset.draggingColumn || event.dataTransfer?.getData('text/x-db-tree-column');
    const before = cell.classList.contains('is-drop-before');
    cell.classList.remove('is-drop-before', 'is-drop-after');
    host.dataset.draggingColumn = '';
    _dbTreeReorderColumn(dbPath, ctx, config, properties, fromName, propName, before);
  });
  return cell;
}

function _dbTreeRenderColumnHeaders(host, options) {
  const {
    ctx,
    dbPath,
    config,
    properties,
    extraProps,
    list,
    gridLayout,
  } = options;
  const keys = [gridLayout.labelKey, ...extraProps];
  const configuredPinnedCols = typeof getPinnedCols === 'function' ? getPinnedCols(dbPath, { ctx }) : [];
  const configuredEntityPinned = typeof getEntityColumnPinned === 'function'
    ? getEntityColumnPinned(dbPath, { ctx })
    : true;
  const pinnedRange = typeof getPinnedColumnRangeState === 'function'
    ? getPinnedColumnRangeState(keys, configuredPinnedCols, configuredEntityPinned)
    : {
      pinnedCols: configuredPinnedCols,
      entityColumnPinned: configuredEntityPinned,
    };
  const pinnedCols = pinnedRange.pinnedCols;
  const entityPinned = pinnedRange.entityColumnPinned;
  const pinnedOffsets = {};
  let left = 0;
  keys.forEach(key => {
    const pinned = key === '__entity__' ? entityPinned : pinnedCols.includes(key);
    if (!pinned) return;
    pinnedOffsets[key] = left;
    left += gridLayout.widths[key];
  });
  list._dbTreeLayout = {
    keys,
    labelKey: gridLayout.labelKey,
    widths: { ...gridLayout.widths },
    actionWidth: gridLayout.actionWidth,
    template: gridLayout.template,
    totalWidth: gridLayout.totalWidth,
    pinnedKeys: keys.filter(key => Number.isFinite(pinnedOffsets[key])),
  };
  keys.forEach((propName, index) => {
    host.appendChild(_dbTreeCreateColumnHeader({
      propName,
      index,
      hierarchy: index === 0,
      ctx,
      dbPath,
      config,
      properties,
      list,
      host,
      pinnedOffsets,
    }));
  });
  const actions = document.createElement('span');
  actions.className = 'db-tree-header-actions';
  actions.setAttribute('aria-hidden', 'true');
  host.appendChild(actions);
  return pinnedOffsets;
}
