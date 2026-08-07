/* シート列ヘッダーの値フィルター
   条件フィルターとは独立して保存し、行表示時には両方を AND で適用する。 */

const DB_COLUMN_FILTER_BLANK = '\u0000meldex:blank';

function _dbColumnValueFiltersObject(dbPath, ctx) {
  if (typeof getColumnValueFilters === 'function') {
    const saved = getColumnValueFilters(dbPath, { ctx });
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }
  const view = typeof getCurrentDbViewConfigEntry === 'function'
    ? getCurrentDbViewConfigEntry(dbPath, { ctx })
    : null;
  return view?.columnValueFilters && typeof view.columnValueFilters === 'object'
    ? view.columnValueFilters
    : {};
}

function _dbColumnFilterEntry(dbPath, propName, ctx) {
  const entry = _dbColumnValueFiltersObject(dbPath, ctx)?.[propName];
  return entry && Array.isArray(entry.selected) ? entry : null;
}

function isDbColumnValueFilterActive(dbPath, propName, ctx) {
  return !!_dbColumnFilterEntry(dbPath, propName, ctx);
}

function isDbColumnFilterActive(dbPath, propName, ctx) {
  if (isDbColumnValueFilterActive(dbPath, propName, ctx)) return true;
  const conditions = typeof getAdvancedFilters === 'function'
    ? getAdvancedFilters(dbPath, { ctx })
    : [];
  return conditions.some(filter => filter?.property === propName || filter?.prop === propName);
}

function _dbColumnFilterText(value) {
  if (value === null || value === undefined || value === '') return DB_COLUMN_FILTER_BLANK;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value);
    return text ? text : DB_COLUMN_FILTER_BLANK;
  }
  if (typeof _dbSearchValueText === 'function') {
    const text = String(_dbSearchValueText(value) || '');
    return text || DB_COLUMN_FILTER_BLANK;
  }
  try {
    const text = JSON.stringify(value);
    return text && text !== '{}' && text !== '[]' ? text : DB_COLUMN_FILTER_BLANK;
  } catch {
    return String(value || '') || DB_COLUMN_FILTER_BLANK;
  }
}

function _dbColumnFilterValuesForEntity(entityName, entityData, propName, dbPath, ctx, filterMode) {
  if (propName === '__entity__') return [_dbColumnFilterText(entityName)];
  const ptc = typeof getPropertyTypes === 'function'
    ? (getPropertyTypes(dbPath, ctx)?.[propName] || null)
    : null;
  if (ptc?.source) {
    return [_dbColumnFilterText(entityData?.['_' + ptc.source])];
  }
  const raw = Array.isArray(entityData?.[propName]) ? entityData[propName] : [];
  const visible = typeof filterValues === 'function'
    ? filterValues(raw, undefined, filterMode)
    : raw;
  const values = visible.map(item => _dbColumnFilterText(item?.value));
  return values.length ? [...new Set(values)] : [DB_COLUMN_FILTER_BLANK];
}

function _dbEntityPassesColumnValueFilters(entityName, entityData, filters, dbPath, ctx, filterMode) {
  const entries = Object.entries(filters || {}).filter(([, entry]) => Array.isArray(entry?.selected));
  if (!entries.length) return true;
  return entries.every(([propName, entry]) => {
    const selected = new Set(entry.selected.map(value => String(value)));
    const candidates = _dbColumnFilterValuesForEntity(
      entityName,
      entityData || {},
      propName,
      dbPath,
      ctx,
      filterMode,
    );
    return candidates.some(value => selected.has(String(value)));
  });
}

function _dbColumnFilterEntries(dbPath, propName, ctx) {
  const data = ctx?.pivotData
    || (state.currentDbPath === dbPath ? state.pivotData : null)
    || state.pivotData
    || {};
  const counts = new Map();
  const filterMode = ctx?.filter ?? state.filter ?? 'disabled';
  Object.entries(data.entities || {}).forEach(([entityName, entityData]) => {
    _dbColumnFilterValuesForEntity(entityName, entityData, propName, dbPath, ctx, filterMode)
      .forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  });
  return [...counts.entries()]
    .map(([value, count]) => ({
      value,
      label: value === DB_COLUMN_FILTER_BLANK ? '（空白）' : value,
      count,
    }))
    .sort((a, b) => {
      if (a.value === DB_COLUMN_FILTER_BLANK) return -1;
      if (b.value === DB_COLUMN_FILTER_BLANK) return 1;
      return a.label.localeCompare(b.label, 'ja', { numeric: true, sensitivity: 'base' });
    });
}

function _dbSaveColumnValueFilter(dbPath, propName, selected, allValues, ctx) {
  const filters = { ..._dbColumnValueFiltersObject(dbPath, ctx) };
  const selectedValues = [...new Set((selected || []).map(String))];
  const everyValueSelected = selectedValues.length === allValues.length
    && allValues.every(value => selectedValues.includes(String(value)));
  if (everyValueSelected) delete filters[propName];
  else filters[propName] = { selected: selectedValues };
  if (typeof setColumnValueFilters === 'function') {
    setColumnValueFilters(dbPath, filters, {
      ctx,
      detail: propName,
      label: 'シート表示: 列の値フィルター',
    });
  }
  return filters;
}

function _dbRefreshAfterColumnFilter(dbPath, ctx) {
  if (typeof _updateFilterBadge === 'function') _updateFilterBadge({ dbPath, ctx });
  if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
  else if (typeof renderPivot === 'function') renderPivot(ctx);
}

function clearDbColumnValueFilter(dbPath, propName, ctx) {
  const filters = { ..._dbColumnValueFiltersObject(dbPath, ctx) };
  if (!Object.prototype.hasOwnProperty.call(filters, propName)) return;
  delete filters[propName];
  if (typeof setColumnValueFilters === 'function') {
    setColumnValueFilters(dbPath, filters, {
      ctx,
      detail: propName,
      label: 'シート表示: 列の値フィルターを解除',
    });
  }
  _dbRefreshAfterColumnFilter(dbPath, ctx);
}

function clearDbColumnFilter(dbPath, propName, ctx) {
  const valueFilters = { ..._dbColumnValueFiltersObject(dbPath, ctx) };
  const hadValueFilter = Object.prototype.hasOwnProperty.call(valueFilters, propName);
  if (hadValueFilter) {
    delete valueFilters[propName];
    if (typeof setColumnValueFilters === 'function') {
      setColumnValueFilters(dbPath, valueFilters, {
        ctx,
        detail: propName,
        label: 'シート表示: この列のフィルターを解除',
      });
    }
  }
  const advanced = typeof getAdvancedFilters === 'function'
    ? getAdvancedFilters(dbPath, { ctx })
    : [];
  const nextAdvanced = advanced.filter(filter => filter?.property !== propName && filter?.prop !== propName);
  if (nextAdvanced.length !== advanced.length && typeof setAdvancedFilters === 'function') {
    setAdvancedFilters(dbPath, nextAdvanced, {
      ctx,
      detail: propName,
      label: 'シート表示: この列のフィルターを解除',
    });
  }
  if (hadValueFilter || nextAdvanced.length !== advanced.length) {
    _dbRefreshAfterColumnFilter(dbPath, ctx);
  }
}

const DB_COLUMN_FILTER_OPERATOR_LABEL = {
  contains: '含む',
  not_contains: '含まない',
  equals: '一致',
  not_equals: '不一致',
  empty: '空',
  not_empty: '空でない',
};
// 条件フィルタ1件の要約文字列（列ヘッダーのフィルターポップアップに表示する）。
function _dbColumnFilterConditionSummaryText(cond) {
  const fieldLabel = cond?.field === 'status' ? 'ステータス' : '値';
  const opLabel = DB_COLUMN_FILTER_OPERATOR_LABEL[cond?.operator] || cond?.operator || '';
  const hasValue = !['empty', 'not_empty'].includes(cond?.operator);
  const valueText = hasValue && cond?.value !== '' && cond?.value != null ? `「${cond.value}」` : '';
  return `${fieldLabel} ${opLabel}${valueText}`;
}

function _dbCloseColumnFilterPopup() {
  document.querySelectorAll('.db-column-filter-popover').forEach(el => el.remove());
}

function _dbPositionColumnFilterPopup(popover, source) {
  const rect = source?.currentTarget?.getBoundingClientRect?.()
    || source?.target?.getBoundingClientRect?.();
  if (typeof positionPopup === 'function') {
    if (rect) {
      positionPopup(popover, { left: rect.left, right: rect.right, top: rect.bottom, bottom: rect.bottom });
    } else {
      const x = Number(source?.clientX) || Math.max(12, window.innerWidth - 380);
      const y = Number(source?.clientY) || 80;
      positionPopup(popover, { left: x, right: x, top: y, bottom: y });
    }
  } else {
    popover.style.left = Math.max(8, Number(source?.clientX) || 8) + 'px';
    popover.style.top = Math.max(8, Number(source?.clientY) || 8) + 'px';
  }
}

function showDbColumnFilterPopup(source, propName, ctxOverride, dbPathOverride) {
  _dbCloseColumnFilterPopup();
  const ctx = ctxOverride || (typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(source?.target || source?.currentTarget, { dbPath: dbPathOverride || state.currentDbPath })
    : null);
  const dbPath = dbPathOverride || ctx?.dbPath || state.currentDbPath;
  if (!dbPath || !propName) return;

  const entries = _dbColumnFilterEntries(dbPath, propName, ctx);
  const allValues = entries.map(entry => String(entry.value));
  const active = _dbColumnFilterEntry(dbPath, propName, ctx);
  const selected = new Set(active ? active.selected.map(String) : allValues);

  const popover = document.createElement('div');
  popover.className = 'db-column-filter-popover';
  popover.dataset.e2eId = 'db-column-filter-popover';
  popover.dataset.dbPath = dbPath;
  const viewConfig = typeof getDbViewConfig === 'function' ? getDbViewConfig(dbPath) : null;
  const viewIndex = typeof _getCurrentDbViewIndexFromConfig === 'function'
    ? _getCurrentDbViewIndexFromConfig(viewConfig, { ctx })
    : -1;
  popover.dataset.viewIndex = String(viewIndex);
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', `${propName === '__entity__' ? 'エントリ名' : propName}列のフィルター`);

  const header = document.createElement('div');
  header.className = 'db-column-filter-header';
  const title = document.createElement('strong');
  title.textContent = propName === '__entity__' ? 'エントリ名をフィルター' : `${propName}をフィルター`;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'db-column-filter-icon-button';
  closeButton.title = '閉じる';
  closeButton.setAttribute('aria-label', '列フィルターを閉じる');
  closeButton.innerHTML = typeof lucide === 'function' ? lucide('x', 14) : '×';
  closeButton.addEventListener('click', _dbCloseColumnFilterPopup);
  header.append(title, closeButton);
  popover.appendChild(header);

  if (propName !== '__entity__') {
    // 既にこの列に条件フィルタ（advancedFilters）があれば要約を表示し、ダイアログへの導線を示す
    // （ツールバーの統合フィルタダイアログと同じ状態を読み書きするため、内容はそこで編集した結果と一致する）。
    const conditions = (typeof getAdvancedFilters === 'function' ? getAdvancedFilters(dbPath, { ctx }) : [])
      .filter(f => f?.property === propName || f?.prop === propName);
    if (conditions.length && typeof _dbColumnFilterConditionSummaryText === 'function') {
      const summary = document.createElement('div');
      summary.className = 'db-column-filter-condition-summary';
      conditions.forEach(cond => {
        const item = document.createElement('span');
        item.className = 'db-column-filter-condition-summary-item';
        item.textContent = '条件: ' + _dbColumnFilterConditionSummaryText(cond);
        summary.appendChild(item);
      });
      popover.appendChild(summary);
    }
    const conditionButton = document.createElement('button');
    conditionButton.type = 'button';
    conditionButton.className = 'db-column-filter-condition';
    conditionButton.innerHTML = (typeof lucide === 'function' ? lucide('slidersHorizontal', 14) : '')
      + (conditions.length ? ' 条件フィルターを編集' : ' 条件フィルターを追加');
    conditionButton.addEventListener('click', () => {
      _dbCloseColumnFilterPopup();
      if (typeof showUnifiedFilterModal === 'function') {
        showUnifiedFilterModal({ ctx, initialProperty: propName });
      }
    });
    popover.appendChild(conditionButton);
  }

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'db-column-filter-search';
  search.placeholder = '値を検索';
  search.setAttribute('aria-label', '列の値を検索');
  popover.appendChild(search);

  const actions = document.createElement('div');
  actions.className = 'db-column-filter-select-actions';
  const selectAllButton = document.createElement('button');
  selectAllButton.type = 'button';
  selectAllButton.textContent = 'すべて表示';
  const clearAllButton = document.createElement('button');
  clearAllButton.type = 'button';
  clearAllButton.textContent = 'すべてクリア';
  actions.append(selectAllButton, clearAllButton);
  popover.appendChild(actions);

  const list = document.createElement('div');
  list.className = 'db-column-filter-value-list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', '表示する値');
  entries.forEach((entry, index) => {
    const label = document.createElement('label');
    label.className = 'db-column-filter-value';
    label.dataset.searchText = entry.label.toLocaleLowerCase('ja');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(String(entry.value));
    checkbox.value = String(entry.value);
    checkbox.dataset.e2eId = `db-column-filter-value-${index}`;
    const text = document.createElement('span');
    text.className = 'db-column-filter-value-label';
    text.textContent = entry.label;
    const count = document.createElement('span');
    count.className = 'db-column-filter-value-count';
    count.textContent = String(entry.count);
    label.append(checkbox, text, count);
    list.appendChild(label);
  });
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'db-column-filter-empty';
    empty.textContent = 'この列に値はありません';
    list.appendChild(empty);
  }
  popover.appendChild(list);

  search.addEventListener('input', () => {
    const needle = search.value.trim().toLocaleLowerCase('ja');
    list.querySelectorAll('.db-column-filter-value').forEach(label => {
      label.hidden = !!needle && !String(label.dataset.searchText || '').includes(needle);
    });
  });
  selectAllButton.addEventListener('click', () => {
    list.querySelectorAll('.db-column-filter-value input').forEach(input => { input.checked = true; });
  });
  clearAllButton.addEventListener('click', () => {
    list.querySelectorAll('.db-column-filter-value input').forEach(input => { input.checked = false; });
  });

  const footer = document.createElement('div');
  footer.className = 'db-column-filter-footer';
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.textContent = 'この列を解除';
  removeButton.disabled = !isDbColumnFilterActive(dbPath, propName, ctx);
  removeButton.addEventListener('click', () => {
    _dbCloseColumnFilterPopup();
    clearDbColumnFilter(dbPath, propName, ctx);
  });
  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'primary';
  applyButton.textContent = '適用';
  applyButton.addEventListener('click', () => {
    const picked = [...list.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
    _dbSaveColumnValueFilter(dbPath, propName, picked, allValues, ctx);
    _dbCloseColumnFilterPopup();
    _dbRefreshAfterColumnFilter(dbPath, ctx);
  });
  footer.append(removeButton, applyButton);
  popover.appendChild(footer);

  popover.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      _dbCloseColumnFilterPopup();
    }
  });
  document.body.appendChild(popover);
  _dbPositionColumnFilterPopup(popover, source);
  setTimeout(() => search.focus(), 0);

  setTimeout(() => {
    const closer = event => {
      if (!popover.isConnected) {
        document.removeEventListener('pointerdown', closer);
        return;
      }
      if (!popover.contains(event.target)) {
        _dbCloseColumnFilterPopup();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

if (typeof window !== 'undefined') {
  window.showDbColumnFilterPopup = showDbColumnFilterPopup;
  window.clearDbColumnValueFilter = clearDbColumnValueFilter;
  window.clearDbColumnFilter = clearDbColumnFilter;
}
