/* シート共通ツリービュー
   親を表す列と並び順列を選び、同一シート内のエントリを階層表示・編集する。 */

function _dbTreeViewSurface(ctx) {
  if (typeof _dbViewSurfaceEl === 'function') return _dbViewSurfaceEl(ctx, '.tree-view', 'tree-view');
  return ctx?.containerEl?.querySelector?.('.tree-view')
    || document.getElementById('tree-view')
    || document.querySelector('.tree-view');
}

function _dbTreeFirstValue(entityData, propName, filterMode) {
  if (!propName) return '';
  const raw = Array.isArray(entityData?.[propName]) ? entityData[propName] : [];
  const values = typeof filterValues === 'function' ? filterValues(raw, undefined, filterMode) : raw;
  const picked = values.find(item => ['採用', '掲載済み'].includes(item?.status || '採用'))
    || values[0];
  return picked?.value ?? '';
}

function _dbTreeDisplayValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'オン' : 'オフ';
  if (typeof _dbSearchValueText === 'function') {
    const text = String(_dbSearchValueText(value) || '').trim();
    if (text) return text;
  }
  if (Array.isArray(value)) return value.map(_dbTreeDisplayValue).filter(text => text !== '—').join(', ') || '—';
  if (typeof value === 'object') {
    return String(value.name || value.label || value.value || value.path || value.id || '—');
  }
  return String(value);
}

function _dbTreeEditableProperty(dbPath, ctx, propName, config) {
  if (!propName || propName === config.parentProp || propName === config.orderProp || propName === config.collapsedProp) {
    return false;
  }
  const typeConfig = getPropertyTypes(dbPath, ctx)?.[propName] || {};
  return !typeConfig.source && !['formula', 'rollup', 'button'].includes(typeConfig.type);
}

async function _dbTreeEditProperty(dbPath, ctx, node, propName, config) {
  if (!_dbTreeEditableProperty(dbPath, ctx, propName, config)) return;
  const filterMode = ctx?.filter ?? state.filter ?? 'disabled';
  const current = _dbTreeFirstValue(node.entityData, propName, filterMode);
  const typeConfig = getPropertyTypes(dbPath, ctx)?.[propName] || {};
  let nextValue;
  if (typeConfig.type === 'checkbox') {
    nextValue = !['1', 'true', 'yes', 'on', 'はい'].includes(String(current || '').toLowerCase());
  } else if (typeof cfPrompt === 'function') {
    nextValue = await cfPrompt(`${propName}を編集`, _dbTreeDisplayValue(current) === '—' ? '' : String(current ?? ''), {
      okLabel: '保存',
    });
  } else {
    nextValue = window.prompt(`${propName}を編集`, String(current ?? ''));
  }
  if (nextValue === null || nextValue === undefined) return;
  if (typeConfig.type === 'number' && String(nextValue).trim() !== '') {
    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed)) {
      showStatus('数値を入力してください', true);
      return;
    }
    nextValue = parsed;
  }
  try {
    await _dbTreeSetValue(dbPath, ctx, node.entityName, propName, nextValue, `ツリー: ${propName}を編集`);
    await _dbTreeRefreshAfterEdit(dbPath, ctx);
    showStatus(`${propName}を更新しました`);
  } catch (error) {
    showStatus(error?.message || `${propName}の更新に失敗しました`, true);
  }
}

function _dbTreeDefaultConfig(dbPath, ctx) {
  const data = ctx?.pivotData || state.pivotData || {};
  const props = Array.isArray(data.properties) ? data.properties : [];
  const has = name => props.includes(name);
  const tagDictionary = has('親グループ') && has('正式名') && has('種類');
  const relationProp = props.find(prop => {
    const type = getPropertyTypes(dbPath, ctx)?.[prop]?.type;
    return type === 'relation' || type === 'multi-relation';
  }) || '';
  return {
    parentProp: has('親グループ') ? '親グループ' : relationProp,
    orderProp: has('並び順') ? '並び順' : '',
    labelProp: has('正式名') ? '正式名' : '',
    typeProp: has('種類') ? '種類' : '',
    colorProp: has('色') ? '色' : '',
    collapsedProp: has('折りたたみ') ? '折りたたみ' : '',
    parentTypeValue: tagDictionary ? 'グループ' : '',
  };
}

function _dbTreeIsTagDictionary(ctx) {
  const properties = ctx?.pivotData?.properties || state.pivotData?.properties || [];
  return ['親グループ', '正式名', '種類', '並び順']
    .every(name => Array.isArray(properties) && properties.includes(name));
}

function _dbTreeNotifyTagDictionaryChanged(dbPath, ctx) {
  if (!_dbTreeIsTagDictionary(ctx)) return;
  const sourceFolder = String(window.MeldexAutoTagSourceFolder?.(dbPath) || '').trim();
  window.MeldexGlobalTags?.notifyDictionaryChanged?.('dictionary-sheet-tree-updated', sourceFolder);
}

function getDbTreeViewConfig(dbPath, ctx) {
  const view = typeof getCurrentDbViewConfigEntry === 'function'
    ? getCurrentDbViewConfigEntry(dbPath, { ctx })
    : null;
  const stored = view?.typeSpecific?.tree;
  return { ..._dbTreeDefaultConfig(dbPath, ctx), ...(stored && typeof stored === 'object' ? stored : {}) };
}

function setDbTreeViewConfig(dbPath, config, ctx) {
  if (typeof _saveCurrentDbViewField !== 'function') return;
  _saveCurrentDbViewField(dbPath, 'シート表示: ツリービュー設定', '', { ctx }, view => {
    if (!view.typeSpecific || typeof view.typeSpecific !== 'object') view.typeSpecific = {};
    view.typeSpecific.tree = { ...config };
  });
}

function _dbTreeValueKey(value) {
  const text = typeof value === 'object' && value
    ? (value.name || value.label || value.entity || value.entity_name || value.file || value.path || value.id || '')
    : value;
  return String(text ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/\.md$/i, '')
    .trim() || '';
}

function _dbTreePresetNames(entityData, filterMode) {
  const raw = Array.isArray(entityData?.['プリセット']) ? entityData['プリセット'] : [];
  const values = typeof filterValues === 'function' ? filterValues(raw, undefined, filterMode) : raw;
  return [...new Set(values
    .flatMap(item => String(item?.value ?? '').split(/[\r\n,、;；]+/))
    .map(value => value.trim())
    .filter(Boolean))];
}

function _dbTreeSortConfig(dbPath, ctx) {
  return typeof getDbSortConfig === 'function'
    ? getDbSortConfig(dbPath, { ctx })
    : (typeof getDbViewConfig === 'function' ? getDbViewConfig(dbPath)?.sortConfig || null : null);
}

function _dbTreeUsesHierarchyOrder(dbPath, ctx) {
  const sortConfig = _dbTreeSortConfig(dbPath, ctx);
  return !sortConfig || sortConfig.key === 'manual';
}

function _dbTreeCompareSortValues(first, second) {
  const a = first == null ? '' : first;
  const b = second == null ? '' : second;
  const aText = typeof a === 'object' ? _dbTreeDisplayValue(a) : String(a);
  const bText = typeof b === 'object' ? _dbTreeDisplayValue(b) : String(b);
  const aNumber = Number(aText);
  const bNumber = Number(bText);
  if (aText.trim() && bText.trim() && Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    return aNumber - bNumber;
  }
  return aText.localeCompare(bText, 'ja', { numeric: true, sensitivity: 'base' });
}

function _dbTreeNodeComparator(dbPath, ctx, config, filterMode) {
  const sortConfig = _dbTreeSortConfig(dbPath, ctx);
  if (!sortConfig || sortConfig.key === 'manual') {
    return (a, b) => a.order - b.order
      || a.label.localeCompare(b.label, 'ja', { numeric: true })
      || a.sourceIndex - b.sourceIndex;
  }
  const direction = sortConfig.dir === 'desc' ? -1 : 1;
  const key = sortConfig.key;
  return (a, b) => {
    const first = key === 'name' || key === '__entity__'
      ? a.entityName
      : _dbTreeFirstValue(a.entityData, key, filterMode);
    const second = key === 'name' || key === '__entity__'
      ? b.entityName
      : _dbTreeFirstValue(b.entityData, key, filterMode);
    return direction * _dbTreeCompareSortValues(first, second)
      || a.order - b.order
      || a.label.localeCompare(b.label, 'ja', { numeric: true })
      || a.sourceIndex - b.sourceIndex;
  };
}

function _dbTreeBuildModel(data, dbPath, ctx, config) {
  const filterMode = ctx?.filter ?? state.filter ?? 'disabled';
  const entities = data?.entities || {};
  const filteredNames = typeof _dbSortedEntityNames === 'function'
    ? _dbSortedEntityNames(data, dbPath, ctx, { applyAdvancedFilters: true })
    : Object.keys(entities);
  const names = Object.keys(entities);
  const filteredNameSet = new Set(filteredNames);
  const hasFilteredRows = filteredNameSet.size !== names.length
    || names.some(entityName => !filteredNameSet.has(entityName));
  const nodes = names.map((entityName, sourceIndex) => {
    const entityData = entities[entityName] || {};
    const rawOrder = _dbTreeFirstValue(entityData, config.orderProp, filterMode);
    const label = String(_dbTreeFirstValue(entityData, config.labelProp, filterMode) || entityName);
    const searchText = [entityName, label, ...Object.values(entityData)
      .flatMap(values => Array.isArray(values) ? values : [])
      .map(value => _dbTreeDisplayValue(value?.value))]
      .join('\n')
      .toLocaleLowerCase('ja');
    return {
      entityName,
      entityData,
      label,
      parentRef: _dbTreeValueKey(_dbTreeFirstValue(entityData, config.parentProp, filterMode)),
      order: Number.isFinite(Number(rawOrder)) ? Number(rawOrder) : sourceIndex,
      type: String(_dbTreeFirstValue(entityData, config.typeProp, filterMode) || ''),
      color: String(_dbTreeFirstValue(entityData, config.colorProp, filterMode) || ''),
      presets: _dbTreePresetNames(entityData, filterMode),
      searchText,
      initiallyCollapsed: ['1', 'true', 'yes', 'on', 'はい'].includes(
        String(_dbTreeFirstValue(entityData, config.collapsedProp, filterMode) || '').toLowerCase(),
      ),
      sourceIndex,
      parent: null,
      children: [],
      orphaned: false,
    };
  });
  const byName = new Map();
  const register = (key, node) => {
    const normalized = String(key || '').trim().toLocaleLowerCase('ja');
    if (normalized && !byName.has(normalized)) byName.set(normalized, node);
  };
  nodes.forEach(node => {
    register(node.entityName, node);
    register(node.label, node);
    register(_dbTreeFirstValue(node.entityData, '内部ID', filterMode), node);
  });
  const roots = [];
  nodes.forEach(node => {
    if (!node.parentRef) {
      roots.push(node);
      return;
    }
    const parent = byName.get(node.parentRef.toLocaleLowerCase('ja')) || null;
    if (!parent || parent === node) {
      node.orphaned = true;
      roots.push(node);
      return;
    }
    node.parent = parent;
    parent.children.push(node);
  });
  const compare = _dbTreeNodeComparator(dbPath, ctx, config, filterMode);
  roots.sort(compare);
  nodes.forEach(node => node.children.sort(compare));
  const rootSet = new Set(roots);
  nodes.forEach(node => {
    const seen = new Set([node]);
    let cursor = node.parent;
    while (cursor) {
      if (seen.has(cursor)) {
        const previousParent = node.parent;
        if (previousParent) {
          previousParent.children = previousParent.children.filter(child => child !== node);
        }
        node.parent = null;
        node.orphaned = true;
        if (!rootSet.has(node)) {
          rootSet.add(node);
          roots.push(node);
          roots.sort(compare);
        }
        break;
      }
      seen.add(cursor);
      cursor = cursor.parent;
    }
  });
  return {
    nodes,
    roots,
    byEntity: new Map(nodes.map(node => [node.entityName, node])),
    filterMatches: hasFilteredRows ? filteredNameSet : null,
  };
}

function _dbTreeState(ctx, dbPath, model, config = {}) {
  const viewConfig = typeof getDbViewConfig === 'function' ? getDbViewConfig(dbPath) : null;
  const viewIndex = typeof _getCurrentDbViewIndexFromConfig === 'function'
    ? _getCurrentDbViewIndexFromConfig(viewConfig, { ctx })
    : (Number.isInteger(ctx?.currentViewIdx) ? ctx.currentViewIdx : Number(viewConfig?.currentViewIdx) || 0);
  const viewKey = `${dbPath}\n${viewIndex}`;
  if (!ctx._dbTreeViewState || ctx._dbTreeViewState.viewKey !== viewKey) {
    const collapsed = new Set();
    model.nodes.forEach(node => {
      if (node.initiallyCollapsed) collapsed.add(node.entityName);
    });
    if (model.nodes.length > 500 && collapsed.size === 0) {
      model.roots.forEach(node => {
        if (node.children.length) collapsed.add(node.entityName);
      });
    }
    ctx._dbTreeViewState = {
      dbPath,
      viewKey,
      collapsed,
      query: '',
      presetFilter: String(config.presetFilter || ''),
      selected: '',
      dragging: '',
    };
  }
  return ctx._dbTreeViewState;
}

function _dbTreeSearchVisibility(model, query) {
  const needle = String(query || '').trim().toLocaleLowerCase('ja');
  if (!needle) return null;
  const visible = new Set();
  model.nodes.forEach(node => {
    if (!node.searchText.includes(needle)) return;
    let cursor = node;
    while (cursor) {
      visible.add(cursor.entityName);
      cursor = cursor.parent;
    }
  });
  return visible;
}

function _dbTreePresetVisibility(model, presetName) {
  const target = String(presetName || '').trim();
  if (!target) return null;
  const visible = new Set();
  model.nodes.forEach(node => {
    if (!node.presets.includes(target)) return;
    let cursor = node;
    while (cursor) {
      visible.add(cursor.entityName);
      cursor = cursor.parent;
    }
  });
  return visible;
}

function _dbTreeCombinedVisibility(model, stateInfo) {
  const needle = String(stateInfo.query || '').trim().toLocaleLowerCase('ja');
  const target = String(stateInfo.presetFilter || '').trim();
  if (!model.filterMatches && !needle && !target) return null;
  const visible = new Set();
  model.nodes.forEach(node => {
    if (model.filterMatches && !model.filterMatches.has(node.entityName)) return;
    if (target && !node.presets.includes(target)) return;
    if (needle && !node.searchText.includes(needle)) return;
    let cursor = node;
    while (cursor) {
      visible.add(cursor.entityName);
      cursor = cursor.parent;
    }
  });
  return visible;
}

function _dbTreeFlattenVisible(model, stateInfo, visible) {
  const rows = [];
  const visit = (node, depth) => {
    if (visible && !visible.has(node.entityName)) return;
    rows.push({ node, depth });
    if (!visible && stateInfo.collapsed.has(node.entityName)) return;
    node.children.forEach(child => visit(child, depth + 1));
  };
  model.roots.forEach(node => visit(node, 0));
  return rows;
}

function _dbTreeWouldCreateCycle(node, parent) {
  let cursor = parent;
  while (cursor) {
    if (cursor === node) return true;
    cursor = cursor.parent;
  }
  return false;
}

function _dbTreeValueRef(dbPath, entityName, propName, value, rawIndex, data) {
  return {
    file: value?.file || _entityPath(dbPath, entityName, data),
    property: value?.property || propName,
    candidate_index: value?.candidate_index != null ? value.candidate_index : rawIndex,
    value: value?.value,
    status: value?.status,
  };
}

async function _dbTreeSetValue(dbPath, ctx, entityName, propName, nextValue, label) {
  if (!propName) return;
  const data = ctx?.pivotData || state.pivotData;
  const entityData = data?.entities?.[entityName] || {};
  const raw = Array.isArray(entityData[propName]) ? entityData[propName] : [];
  const adopted = typeof getAdoptedValueForWrite === 'function'
    ? getAdoptedValueForWrite(raw)
    : raw[0];
  const oldValue = adopted?.value ?? '';
  if (String(oldValue ?? '') === String(nextValue ?? '')) return;
  if (adopted) {
    const rawIndex = Math.max(0, raw.indexOf(adopted));
    const ref = _dbTreeValueRef(dbPath, entityName, propName, adopted, rawIndex, data);
    await _apiPutValue(ref, { new_value: nextValue, __source: 'sheet-tree-view' });
    if (typeof _dbUndoValue === 'function') {
      _dbUndoValue(label, ref, oldValue, nextValue, undefined, undefined, { dbPath, ctx });
    }
    adopted.value = nextValue;
  } else {
    const entityPath = _entityPath(dbPath, entityName, data);
    await _apiPostValue(entityPath, propName, nextValue, '採用', '', '', { __source: 'sheet-tree-view' });
    entityData[propName] = [{ value: nextValue, status: '採用', file: entityPath, property: propName, candidate_index: 0 }];
  }
}

async function _dbTreeRefreshAfterEdit(dbPath, ctx) {
  if (typeof selectDatabase === 'function') {
    await selectDatabase(dbPath, ctx, {
      silent: true,
      skipRecent: true,
      skipNavPush: true,
      skipSaveLastView: true,
    });
  } else {
    renderDbTreeView(ctx);
  }
  _dbTreeNotifyTagDictionaryChanged(dbPath, ctx);
}

async function _dbTreeMoveNode(dbPath, ctx, model, config, node, target, mode) {
  if (!node || !config.parentProp) return;
  if (mode !== 'child' && !_dbTreeUsesHierarchyOrder(dbPath, ctx)) {
    showStatus('同じ階層で位置を変えるには、列メニューの並び替えを「階層の並び順」に戻してください。', true);
    return;
  }
  let parent = null;
  let nextOrder = node.order;
  if (mode === 'child') {
    parent = target;
    if (target && config.parentTypeValue && target.type !== config.parentTypeValue) {
      showStatus(`${config.parentTypeValue}の行だけを親にできます`, true);
      return;
    }
    if (_dbTreeWouldCreateCycle(node, parent)) {
      showStatus('子孫を親にはできません', true);
      return;
    }
    const siblings = parent?.children || model.roots;
    nextOrder = siblings.length ? Math.max(...siblings.map(item => item.order)) + 1000 : 0;
  } else {
    parent = target?.parent || null;
    if (_dbTreeWouldCreateCycle(node, parent)) {
      showStatus('子孫の階層へは移動できません', true);
      return;
    }
    const siblings = parent?.children || model.roots;
    const targetIndex = siblings.indexOf(target);
    const previous = siblings[mode === 'before' ? targetIndex - 1 : targetIndex];
    const next = siblings[mode === 'before' ? targetIndex : targetIndex + 1];
    if (previous && next && next.order > previous.order) nextOrder = (previous.order + next.order) / 2;
    else if (previous && next) nextOrder = mode === 'before' ? next.order - 0.5 : previous.order + 0.5;
    else if (previous) nextOrder = previous.order + 1;
    else if (next) nextOrder = next.order - 1;
    else nextOrder = 0;
  }
  const parentValue = parent?.entityName || '';
  try {
    await _dbTreeSetValue(dbPath, ctx, node.entityName, config.parentProp, parentValue, 'ツリー: 親を変更');
    if (config.orderProp) {
      await _dbTreeSetValue(dbPath, ctx, node.entityName, config.orderProp, nextOrder, 'ツリー: 並び順を変更');
    }
    await _dbTreeRefreshAfterEdit(dbPath, ctx);
    showStatus('階層を変更しました');
  } catch (error) {
    showStatus(error?.message || '階層の変更に失敗しました', true);
  }
}

async function _dbTreeSwapSibling(dbPath, ctx, config, node, direction) {
  if (!_dbTreeUsesHierarchyOrder(dbPath, ctx)) {
    showStatus('行を前後へ動かすには、列メニューの並び替えを「階層の並び順」に戻してください。', true);
    return;
  }
  const siblings = node.parent?.children || ctx._dbTreeViewModel?.roots || [];
  const index = siblings.indexOf(node);
  const other = siblings[index + direction];
  if (!other || !config.orderProp) return;
  try {
    const first = node.order;
    const second = other.order;
    if (first === second) {
      const nextOrder = direction < 0 ? second - 1 : second + 1;
      await _dbTreeSetValue(dbPath, ctx, node.entityName, config.orderProp, nextOrder, 'ツリー: 並び順を変更');
    } else {
      await _dbTreeSetValue(dbPath, ctx, node.entityName, config.orderProp, second, 'ツリー: 並び順を変更');
      await _dbTreeSetValue(dbPath, ctx, other.entityName, config.orderProp, first, 'ツリー: 並び順を変更');
    }
    await _dbTreeRefreshAfterEdit(dbPath, ctx);
  } catch (error) {
    showStatus(error?.message || '並び替えに失敗しました', true);
  }
}

function _dbTreeRenderDetails(host, node, dbPath, ctx, config) {
  host.textContent = '';
  if (!node) {
    host.className = 'db-tree-details is-empty';
    host.textContent = '行を選択すると、階層と値を確認できます';
    return;
  }
  host.className = 'db-tree-details';
  const title = document.createElement('h3');
  title.textContent = node.label;
  host.appendChild(title);
  const path = [];
  let cursor = node;
  while (cursor) {
    path.unshift(cursor.label);
    cursor = cursor.parent;
  }
  const pathLabel = document.createElement('div');
  pathLabel.className = 'db-tree-detail-path';
  pathLabel.textContent = path.join('  ›  ');
  host.appendChild(pathLabel);
  const meta = document.createElement('dl');
  [
    ['エントリ', node.entityName],
    ['親', node.parent?.label || '最上位'],
    ['子', `${node.children.length}件`],
    ...(config.orderProp ? [['並び順', String(node.order)]] : []),
    ...(node.type ? [['種類', node.type]] : []),
  ].forEach(([term, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    meta.append(dt, dd);
  });
  host.appendChild(meta);
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = 'エントリを開く';
  open.addEventListener('click', () => {
    const pathValue = _entityPath(dbPath, node.entityName, ctx?.pivotData || state.pivotData);
    if (typeof selectEntity === 'function') selectEntity(pathValue);
  });
  host.appendChild(open);
}

function _dbTreeApplyPinnedCell(cell, propName, pinnedOffsets) {
  const left = pinnedOffsets?.[propName];
  if (!Number.isFinite(left)) return;
  cell.classList.add('is-pinned');
  cell.dataset.dbPinnedToken = propName;
  cell.style.left = `${left}px`;
}

function _dbTreeApplyCellPresentation(cell, value, propName, dbPath, ctx) {
  const override = typeof getDbColumnCellDisplay === 'function'
    ? getDbColumnCellDisplay(dbPath, propName, ctx)
    : null;
  if (override) {
    cell.dataset.cellOverflow = override.overflow;
    cell.style.setProperty('--db-tree-cell-lines', String(override.lines));
  }
  const color = typeof getCellColor === 'function' ? getCellColor(value, propName, dbPath, ctx) : null;
  if (color?.bg) cell.style.backgroundColor = color.bg;
  if (color?.fg) cell.style.color = color.fg;
}

function _dbTreeRowHeight(dbPath, columnKeys, ctx) {
  const base = typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches ? 42 : 34;
  if (typeof getDbColumnCellDisplay !== 'function') return base;
  let maxLines = 1;
  columnKeys.forEach(propName => {
    const display = getDbColumnCellDisplay(dbPath, propName, ctx);
    if (display?.overflow === 'wrap') maxLines = Math.max(maxLines, Math.min(10, Number(display.lines) || 1));
  });
  return base + (maxLines - 1) * 16;
}

function _dbTreeRenderRow(node, depth, parentEl, renderCtx) {
  const {
    stateInfo,
    dbPath,
    ctx,
    config,
    model,
    extraProps,
    gridTemplate,
    labelKey,
    pinnedOffsets,
    rowHeight,
  } = renderCtx;
  const row = document.createElement('div');
  row.className = 'db-tree-row';
  row.dataset.entityName = node.entityName;
  row.dataset.e2eId = `db-tree-row-${node.entityName}`;
  row.draggable = true;
  row.style.setProperty('--db-tree-depth', String(depth));
  row.style.setProperty('--db-tree-row-height', `${rowHeight}px`);
  row.style.gridTemplateColumns = gridTemplate;
  row.setAttribute('role', 'treeitem');
  row.tabIndex = 0;
  row.setAttribute('aria-level', String(depth + 1));
  row.setAttribute('aria-selected', stateInfo.selected === node.entityName ? 'true' : 'false');
  if (node.children.length) row.setAttribute('aria-expanded', stateInfo.collapsed.has(node.entityName) ? 'false' : 'true');
  if (stateInfo.selected === node.entityName) row.classList.add('selected');
  if (node.orphaned) row.classList.add('orphaned');
  if (node.color) row.style.setProperty('--db-tree-node-color', node.color);

  const nameCell = document.createElement('div');
  nameCell.className = 'db-tree-name-cell';
  nameCell.style.setProperty('--db-tree-depth', String(depth));
  _dbTreeApplyPinnedCell(nameCell, labelKey, pinnedOffsets);
  _dbTreeApplyCellPresentation(nameCell, node.label, labelKey, dbPath, ctx);
  const grip = document.createElement('span');
  grip.className = 'db-tree-grip';
  grip.innerHTML = lucide('gripVertical', 13);
  grip.title = 'ドラッグして親または位置を変更';
  nameCell.appendChild(grip);

  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'db-tree-caret';
  if (node.children.length) {
    caret.innerHTML = lucide(stateInfo.collapsed.has(node.entityName) ? 'chevronRight' : 'chevronDown', 14);
    caret.title = stateInfo.collapsed.has(node.entityName) ? '展開' : '折りたたむ';
    caret.addEventListener('click', event => {
      event.stopPropagation();
      if (stateInfo.collapsed.has(node.entityName)) stateInfo.collapsed.delete(node.entityName);
      else stateInfo.collapsed.add(node.entityName);
      renderCtx.redraw();
    });
  } else {
    caret.disabled = true;
  }
  nameCell.appendChild(caret);

  const marker = document.createElement('span');
  marker.className = 'db-tree-marker';
  nameCell.appendChild(marker);
  const label = document.createElement('span');
  label.className = 'db-tree-label';
  label.textContent = node.label;
  if (_dbTreeEditableProperty(dbPath, ctx, config.labelProp, config)) {
    label.title = 'ダブルクリックして編集';
    label.addEventListener('dblclick', event => {
      event.stopPropagation();
      _dbTreeEditProperty(dbPath, ctx, node, config.labelProp, config);
    });
  }
  nameCell.appendChild(label);
  if (node.children.length) {
    const count = document.createElement('span');
    count.className = 'db-tree-count';
    count.textContent = String(node.children.length);
    nameCell.appendChild(count);
  }
  row.appendChild(nameCell);

  extraProps.forEach(propName => {
    const cell = document.createElement('div');
    cell.className = 'db-tree-value-cell';
    cell.dataset.propName = propName;
    const rawValue = _dbTreeFirstValue(node.entityData, propName, ctx?.filter ?? state.filter ?? 'disabled');
    const displayValue = _dbTreeDisplayValue(rawValue);
    const cellText = document.createElement('span');
    cellText.className = 'db-tree-cell-text';
    cellText.textContent = displayValue;
    cell.appendChild(cellText);
    _dbTreeApplyPinnedCell(cell, propName, pinnedOffsets);
    _dbTreeApplyCellPresentation(cell, rawValue, propName, dbPath, ctx);
    cell.title = _dbTreeEditableProperty(dbPath, ctx, propName, config)
      ? `${displayValue}\nダブルクリックして編集`
      : displayValue;
    if (propName === config.typeProp) cell.classList.add('is-type');
    if (propName === config.colorProp && String(rawValue || '')) {
      cellText.style.color = String(rawValue);
    }
    if (_dbTreeEditableProperty(dbPath, ctx, propName, config)) {
      cell.tabIndex = 0;
      cell.addEventListener('dblclick', event => {
        event.stopPropagation();
        _dbTreeEditProperty(dbPath, ctx, node, propName, config);
      });
      cell.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        _dbTreeEditProperty(dbPath, ctx, node, propName, config);
      });
    }
    row.appendChild(cell);
  });
  const moveButtons = document.createElement('span');
  moveButtons.className = 'db-tree-move-buttons';
  [-1, 1].forEach(direction => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = lucide(direction < 0 ? 'arrowUp' : 'arrowDown', 12);
    button.title = direction < 0 ? '同じ階層で前へ' : '同じ階層で次へ';
    button.disabled = !config.orderProp || !_dbTreeUsesHierarchyOrder(dbPath, ctx);
    if (!_dbTreeUsesHierarchyOrder(dbPath, ctx)) {
      button.title = '列で並び替え中は位置を変更できません';
    }
    button.addEventListener('click', event => {
      event.stopPropagation();
      _dbTreeSwapSibling(dbPath, ctx, config, node, direction);
    });
    moveButtons.appendChild(button);
  });
  row.appendChild(moveButtons);
  row.addEventListener('click', () => {
    stateInfo.selected = node.entityName;
    _dbTreeRenderOptionPanel(ctx);
    parentEl.querySelectorAll('.db-tree-row.selected').forEach(el => el.classList.remove('selected'));
    row.classList.add('selected');
    parentEl.querySelectorAll('.db-tree-row[aria-selected="true"]').forEach(el => el.setAttribute('aria-selected', 'false'));
    row.setAttribute('aria-selected', 'true');
  });
  row.addEventListener('keydown', event => {
    if (event.target !== row || event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    _dbTreeEditProperty(dbPath, ctx, node, config.labelProp, config);
  });
  row.addEventListener('dragstart', event => {
    stateInfo.dragging = node.entityName;
    event.dataTransfer?.setData('text/x-db-tree-entity', node.entityName);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  row.addEventListener('dragend', () => {
    stateInfo.dragging = '';
    row.classList.remove('dragging');
    document.querySelectorAll('.db-tree-row.drop-before,.db-tree-row.drop-child,.db-tree-row.drop-after')
      .forEach(el => el.classList.remove('drop-before', 'drop-child', 'drop-after'));
  });
  row.addEventListener('dragover', event => {
    const draggedName = stateInfo.dragging || event.dataTransfer?.getData('text/x-db-tree-entity');
    if (!draggedName || draggedName === node.entityName) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    row.classList.remove('drop-before', 'drop-child', 'drop-after');
    row.classList.add(ratio < 0.25 ? 'drop-before' : ratio > 0.75 ? 'drop-after' : 'drop-child');
  });
  row.addEventListener('dragleave', event => {
    if (!event.relatedTarget || !row.contains(event.relatedTarget)) {
      row.classList.remove('drop-before', 'drop-child', 'drop-after');
    }
  });
  row.addEventListener('drop', event => {
    event.preventDefault();
    const draggedName = stateInfo.dragging || event.dataTransfer?.getData('text/x-db-tree-entity');
    const dragged = model.byEntity.get(draggedName);
    const mode = row.classList.contains('drop-before')
      ? 'before'
      : row.classList.contains('drop-after') ? 'after' : 'child';
    row.classList.remove('drop-before', 'drop-child', 'drop-after');
    _dbTreeMoveNode(dbPath, ctx, model, config, dragged, node, mode);
  });
  parentEl.appendChild(row);
}

function _dbTreeGridLayout(currentView, config, extraProps) {
  const widths = currentView?.colWidths || {};
  const bounded = (value, fallback, min = 80) => {
    const number = Number(value);
    return Math.max(min, Math.min(640, Number.isFinite(number) ? number : fallback));
  };
  const labelKey = config.labelProp || '__entity__';
  const labelWidth = bounded(widths[labelKey] ?? widths.__entity__, 320, 60);
  const columnWidths = extraProps.map(propName => bounded(widths[propName], 150, 60));
  const widthMap = { [labelKey]: labelWidth };
  extraProps.forEach((propName, index) => { widthMap[propName] = columnWidths[index]; });
  const actionWidth = 58;
  const parts = [`${labelWidth}px`, ...columnWidths.map(width => `${width}px`), `${actionWidth}px`];
  return {
    labelKey,
    widths: widthMap,
    actionWidth,
    template: parts.join(' '),
    totalWidth: labelWidth + columnWidths.reduce((sum, width) => sum + width, 0) + actionWidth,
  };
}

function renderDbTreeView(ctx) {
  ctx = ctx || _currentPaneState();
  const container = _dbTreeViewSurface(ctx);
  const data = ctx?.pivotData || state.pivotData;
  const dbPath = ctx?.dbPath || state.currentDbPath;
  if (!container || !data?.entities || !dbPath) return;
  container.style.display = 'flex';
  container.textContent = '';
  const config = getDbTreeViewConfig(dbPath, ctx);
  const properties = Array.from(new Set([
    ...(data.properties || []),
    ...Object.keys(getPropertyTypes(dbPath, ctx) || {}),
  ])).filter(prop => typeof isDbPropertyDeleted !== 'function' || !isDbPropertyDeleted(dbPath, prop));

  const toolbar = document.createElement('div');
  toolbar.className = 'db-tree-toolbar';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'ツリーを検索';
  search.setAttribute('aria-label', 'ツリーを検索');
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.innerHTML = lucide('unfoldVertical', 14) + ' すべて展開';
  const collapse = document.createElement('button');
  collapse.type = 'button';
  collapse.innerHTML = lucide('foldVertical', 14) + ' すべて折りたたむ';
  const settings = document.createElement('button');
  settings.type = 'button';
  settings.innerHTML = lucide('settings', 14) + ' ツリー設定';
  toolbar.append(search, expand, collapse, settings);
  container.appendChild(toolbar);
  _dbTreeSetOptionTabVisible(true, ctx);

  if (!config.parentProp || !properties.includes(config.parentProp)) {
    const empty = document.createElement('div');
    empty.className = 'db-tree-setup-empty';
    const title = document.createElement('strong');
    title.textContent = '親を表す列を選択してください';
    const hint = document.createElement('span');
    hint.textContent = '同じシート内のエントリを参照する列を使って階層を作ります。';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.textContent = 'ツリー設定を開く';
    button.addEventListener('click', () => _dbTreeOpenOptions(ctx));
    empty.append(title, hint, button);
    container.appendChild(empty);
    settings.addEventListener('click', () => _dbTreeOpenOptions(ctx));
    return;
  }

  const model = _dbTreeBuildModel(data, dbPath, ctx, config);
  ctx._dbTreeViewModel = model;
  const stateInfo = _dbTreeState(ctx, dbPath, model, config);
  const presetOptions = [...new Set(model.nodes.flatMap(node => node.presets))]
    .sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
  if (presetOptions.length) {
    const presetFilter = document.createElement('select');
    presetFilter.className = 'db-tree-preset-filter';
    presetFilter.setAttribute('aria-label', 'タグプリセットで絞り込む');
    const all = document.createElement('option');
    all.value = '';
    all.textContent = `全プリセット（${presetOptions.length}件）`;
    presetFilter.appendChild(all);
    presetOptions.forEach(presetName => {
      const option = document.createElement('option');
      option.value = presetName;
      option.textContent = presetName;
      presetFilter.appendChild(option);
    });
    if (!presetOptions.includes(stateInfo.presetFilter)) stateInfo.presetFilter = '';
    presetFilter.value = stateInfo.presetFilter;
    presetFilter.addEventListener('change', () => {
      stateInfo.presetFilter = presetFilter.value;
      setDbTreeViewConfig(dbPath, { ...config, presetFilter: stateInfo.presetFilter }, ctx);
      list.scrollTop = 0;
      draw();
    });
    toolbar.insertBefore(presetFilter, expand);
  }
  const currentView = typeof getCurrentDbViewConfigEntry === 'function'
    ? getCurrentDbViewConfigEntry(dbPath, { ctx })
    : null;
  const hidden = typeof getHiddenCols === 'function' ? getHiddenCols(dbPath, { ctx }) : [];
  const preferredOrder = Array.isArray(currentView?.colOrder) && currentView.colOrder.length
    ? currentView.colOrder
    : properties;
  const excluded = new Set([
    '__entity__',
    config.labelProp,
    config.parentProp,
    config.orderProp,
    config.collapsedProp,
    '内部ID',
  ].filter(Boolean));
  const extraProps = [...new Set([...preferredOrder, ...properties])]
    .filter(propName => properties.includes(propName) && !hidden.includes(propName) && !excluded.has(propName));
  const gridLayout = _dbTreeGridLayout(currentView, config, extraProps);
  const gridTemplate = gridLayout.template;
  const rowHeight = _dbTreeRowHeight(dbPath, [gridLayout.labelKey, ...extraProps], ctx);
  search.value = stateInfo.query || '';
  const content = document.createElement('div');
  content.className = 'db-tree-content';
  const list = document.createElement('div');
  list.className = 'db-tree-list';
  list.dataset.e2eId = 'db-tree-list';
  const header = document.createElement('div');
  header.className = 'db-tree-header';
  header.setAttribute('role', 'row');
  header.style.gridTemplateColumns = gridTemplate;
  header.style.width = `${gridLayout.totalWidth}px`;
  const rowsHost = document.createElement('div');
  rowsHost.className = 'db-tree-rows';
  rowsHost.setAttribute('role', 'tree');
  rowsHost.style.width = `${gridLayout.totalWidth}px`;
  if (typeof _dbTreeRenderColumnHeaders === 'function') {
    _dbTreeRenderColumnHeaders(header, {
      ctx,
      dbPath,
      config,
      properties,
      extraProps,
      list,
      gridLayout,
    });
  } else {
    [gridLayout.labelKey, ...extraProps].forEach(propName => {
      const column = document.createElement('span');
      column.className = 'db-tree-header-cell';
      column.textContent = propName === '__entity__' ? 'エントリ名' : propName;
      header.appendChild(column);
    });
    const actions = document.createElement('span');
    actions.className = 'db-tree-header-actions';
    header.appendChild(actions);
  }
  list.append(header, rowsHost);
  content.appendChild(list);
  container.appendChild(content);

  let visibleRows = [];
  let lastWindow = '';
  let virtualFrame = 0;
  const renderWindow = () => {
    virtualFrame = 0;
    const virtualized = visibleRows.length > 250;
    const start = virtualized ? Math.max(0, Math.floor(list.scrollTop / rowHeight) - 12) : 0;
    const end = virtualized
      ? Math.min(visibleRows.length, start + Math.ceil(list.clientHeight / rowHeight) + 24)
      : visibleRows.length;
    const windowKey = `${start}:${end}:${stateInfo.selected}:${stateInfo.collapsed.size}:${stateInfo.query}:${stateInfo.presetFilter}`;
    if (windowKey === lastWindow) return;
    lastWindow = windowKey;
    rowsHost.textContent = '';
    rowsHost.classList.toggle('is-virtualized', virtualized);
    rowsHost.style.height = virtualized ? `${visibleRows.length * rowHeight}px` : '';
    const windowHost = document.createElement('div');
    windowHost.className = 'db-tree-row-window';
    const activeLayout = list._dbTreeLayout || gridLayout;
    const activePinnedOffsets = {};
    let activeStickyLeft = 0;
    (activeLayout.pinnedKeys || []).forEach(key => {
      activePinnedOffsets[key] = activeStickyLeft;
      activeStickyLeft += activeLayout.widths[key] || 0;
    });
    windowHost.style.width = `${activeLayout.totalWidth}px`;
    if (virtualized) windowHost.style.transform = `translateY(${start * rowHeight}px)`;
    const renderCtx = {
      stateInfo,
      dbPath,
      ctx,
      config,
      model,
      extraProps,
      gridTemplate: activeLayout.template,
      labelKey: gridLayout.labelKey,
      pinnedOffsets: activePinnedOffsets,
      rowHeight,
      redraw: draw,
    };
    visibleRows.slice(start, end).forEach(({ node, depth }) => {
      _dbTreeRenderRow(node, depth, windowHost, renderCtx);
    });
    rowsHost.appendChild(windowHost);
    if (!visibleRows.length) {
      const empty = document.createElement('div');
      empty.className = 'db-tree-no-results';
      empty.textContent = stateInfo.query || stateInfo.presetFilter
        ? '一致する行はありません'
        : '表示できる行はありません';
      rowsHost.appendChild(empty);
    }
  };
  const draw = () => {
    const visible = _dbTreeCombinedVisibility(model, stateInfo);
    visibleRows = _dbTreeFlattenVisible(model, stateInfo, visible);
    lastWindow = '';
    renderWindow();
  };
  draw();
  list.addEventListener('scroll', () => {
    if (virtualFrame) return;
    virtualFrame = requestAnimationFrame(renderWindow);
  }, { passive: true });

  let searchTimer = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    stateInfo.query = search.value;
    searchTimer = setTimeout(draw, 80);
  });
  expand.addEventListener('click', () => {
    stateInfo.collapsed.clear();
    draw();
  });
  collapse.addEventListener('click', () => {
    model.nodes.forEach(node => {
      if (node.children.length) stateInfo.collapsed.add(node.entityName);
    });
    draw();
  });
  settings.addEventListener('click', () => _dbTreeOpenOptions(ctx));
  rowsHost.addEventListener('dragover', event => {
    if (!event.target.closest?.('.db-tree-row')) event.preventDefault();
  });
  rowsHost.addEventListener('drop', event => {
    if (event.target.closest?.('.db-tree-row')) return;
    event.preventDefault();
    const draggedName = stateInfo.dragging || event.dataTransfer?.getData('text/x-db-tree-entity');
    _dbTreeMoveNode(dbPath, ctx, model, config, model.byEntity.get(draggedName), null, 'child');
  });
}

if (typeof window !== 'undefined') {
  window.renderDbTreeView = renderDbTreeView;
  window.getDbTreeViewConfig = getDbTreeViewConfig;
}
