/* シート pivot 同期・relation キャッシュ helper — gb-db-props.js から分離 */

const _relationCache = {};
const _relationMapPromises = {};

function _buildRelationMapEntry(data) {
  const entities = data?.entities || {};
  const idToName = {};
  const nameToId = {};
  for (const [name, props] of Object.entries(entities)) {
    const id = props._id || name;
    idToName[id] = name;
    nameToId[name] = id;
  }
  return { idToName, nameToId, entities, new_format: !!data?.new_format, timestamp: Date.now() };
}

function _setRelationMapCache(relationDbPath, data) {
  if (!relationDbPath || !data) return null;
  const entry = _buildRelationMapEntry(data);
  _relationCache[relationDbPath] = entry;
  return entry;
}

function _getCachedRelationMap(relationDbPath) {
  const cached = relationDbPath ? _relationCache[relationDbPath] : null;
  return cached && cached.idToName && cached.nameToId ? cached : null;
}

function _refreshRelationMapSoon(relationDbPath) {
  if (!relationDbPath || _relationMapPromises[relationDbPath]) return;
  setTimeout(() => {
    try { _getRelationMap(relationDbPath); } catch {}
  }, 0);
}

async function _getRelationMap(relationDbPath) {
  const now = Date.now();
  const cached = _relationCache[relationDbPath];
  if (typeof _dbCacheIsFresh === 'function') {
    if (_dbCacheIsFresh(cached, 'relation')) return cached;
  } else if (cached && now - cached.timestamp < 30000) {
    return cached;
  }
  if (_relationMapPromises[relationDbPath]) return _relationMapPromises[relationDbPath];
  _relationMapPromises[relationDbPath] = (async () => {
    try {
      const data = await apiFetch('/pivot?path=' + encodeURIComponent(relationDbPath));
      return _setRelationMapCache(relationDbPath, data) || _buildRelationMapEntry({});
    } catch {
      return { idToName: {}, nameToId: {}, entities: {}, new_format: false, timestamp: now };
    } finally {
      delete _relationMapPromises[relationDbPath];
    }
  })();
  return _relationMapPromises[relationDbPath];
}

function _getRelationDisplayInfo(idOrName, relationDbPath) {
  if (!idOrName) return { label: '', resolved: true };
  const cached = _relationCache[relationDbPath];
  if (!cached) return { label: idOrName, resolved: false };
  if (Object.prototype.hasOwnProperty.call(cached.idToName, idOrName)) {
    return { label: cached.idToName[idOrName] || idOrName, resolved: true };
  }
  if (Object.prototype.hasOwnProperty.call(cached.nameToId, idOrName)) {
    return { label: idOrName, resolved: true };
  }
  return { label: idOrName, resolved: false };
}

function _resolveRelationNameSync(idOrName, relationDbPath) {
  const info = _getRelationDisplayInfo(idOrName, relationDbPath);
  if (!info.resolved && relationDbPath) {
    try { _getRelationMap(relationDbPath); } catch {}
  }
  return info.label || idOrName;
}

async function _resolveRelationName(idOrName, relationDbPath) {
  if (!idOrName) return '';
  const map = await _getRelationMap(relationDbPath);
  return map.idToName[idOrName] || idOrName;
}

async function _preloadRelationMapsForDb(dbPath, pivotData) {
  if (!dbPath) return;
  if (pivotData?.entities) _setRelationMapCache(dbPath, pivotData);
  const propTypes = getPropertyTypes(dbPath);
  const targets = new Set();
  Object.values(propTypes || {}).forEach(ptc => {
    if (!ptc) return;
    if (ptc.type === 'relation' || ptc.type === 'multi-relation') {
      const relDb = typeof _dbResolveRelationDbPath === 'function'
        ? _dbResolveRelationDbPath(dbPath, ptc)
        : ((ptc.relationDb === '' ? dbPath : ptc.relationDb) || '');
      if (relDb && relDb !== dbPath) targets.add(relDb);
    } else if (ptc.type === 'multi-source-relation') {
      (ptc.sources || []).forEach(src => {
        if (src?.db) targets.add(src.db);
      });
    }
  });
  if (targets.size === 0) return;
  await Promise.all([...targets].map(async relDb => {
    try { await _getRelationMap(relDb); } catch {}
  }));
}

function _getPivotEntityName(entityPath) {
  return (entityPath || '').split('/').pop().replace(/\.md$/, '');
}

function _dbPivotContextFromTarget(targetEl, options = {}) {
  if (options && options.ctx) return options.ctx;
  const dbPath = (options && options.dbPath)
    || (typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(options?.entityPath || '') : '')
    || (typeof state !== 'undefined' ? state.currentDbPath : '')
    || '';
  if (typeof _dbPaneContextFromEvent === 'function') {
    const ctx = _dbPaneContextFromEvent(targetEl, { dbPath });
    if (ctx) return ctx;
  }
  if (typeof _dbFindPaneContextForPath === 'function' && dbPath) {
    const ctx = _dbFindPaneContextForPath(dbPath);
    if (ctx) return ctx;
  }
  return (typeof _currentPaneState === 'function') ? _currentPaneState() : null;
}

function _dbPivotPathForContext(ctx, fallbackPath) {
  return (ctx && ctx.dbPath) || fallbackPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '';
}

function _dbPivotDataForContext(ctx) {
  return (ctx && ctx.pivotData) || (typeof state !== 'undefined' ? state.pivotData : null) || null;
}

function _dbScopeForPath(dbPath) {
  if (!dbPath) return '';
  if (typeof _dbViewConfigHistoryScope === 'function') return _dbViewConfigHistoryScope(dbPath);
  return 'db:' + String(dbPath).replace(/\\/g, '/');
}

function _getPivotEntityData(entityPath, ctx) {
  const entityName = _getPivotEntityName(entityPath);
  const data = _dbPivotDataForContext(ctx);
  return data?.entities?.[entityName] || null;
}

function _upsertLocalPivotValue(entityPath, propName, val, newValue, extra, ctx) {
  if (val) val.value = newValue;
  const entData = _getPivotEntityData(entityPath, ctx);
  if (!entData) return val || null;
  if (!Array.isArray(entData[propName])) entData[propName] = [];
  const values = entData[propName];
  let target = values.find(v => v === val);
  if (!target && val) {
    target = values.find(v => v.file === val.file && v.property === val.property
      && (val.candidate_index == null || v.candidate_index === val.candidate_index));
  }
  if (!target && val && values.length === 1) target = values[0];
  if (!target && newValue) {
    target = {
      property: propName,
      value: newValue,
      status: val?.status || extra?.status || '採用',
      note: val?.note || extra?.note || '',
    };
    values.push(target);
  }
  if (!target) return val || null;
  target.value = newValue;
  if (extra && extra.file !== undefined) target.file = extra.file;
  if (extra && extra.property !== undefined) target.property = extra.property;
  else if (target.property == null) target.property = propName;
  if (extra && extra.candidate_index !== undefined) target.candidate_index = extra.candidate_index;
  if (extra && extra.status !== undefined) target.status = extra.status;
  else if (target.status == null) target.status = val?.status || '採用';
  if (extra && extra.note !== undefined) target.note = extra.note;
  else if (target.note == null) target.note = val?.note || '';
  return target;
}

function _getPivotRowCellByProp(targetEl, propName) {
  const td = targetEl?.closest?.('td') || (targetEl?.matches?.('td') ? targetEl : null);
  const tr = td?.closest?.('tr');
  const table = tr?.closest?.('table');
  if (!td || !tr || !table) return null;
  const headers = [...table.querySelectorAll('thead th[data-prop]')];
  const idx = headers.findIndex(th => th.dataset.prop === propName);
  return idx >= 0 ? tr.children[idx + 1] || null : null;
}

function _getCascadeDependents(sourcePropName, dbPath) {
  if (!dbPath || !sourcePropName) return [];
  const pts = getPropertyTypes(dbPath) || {};
  return Object.entries(pts)
    .filter(([propName, cfg]) => propName !== sourcePropName
      && (cfg?.type === 'relation' || cfg?.type === 'multi-relation')
      && cfg.cascadeFrom === sourcePropName)
    .map(([propName, cfg]) => ({ propName, ptc: cfg }));
}

function _dbValueToString(value) {
  return value == null ? '' : String(value);
}

function _splitDbMultiValue(value) {
  return _dbValueToString(value).split(',').map(s => s.trim()).filter(Boolean);
}

function _snapshotPivotValues(values) {
  return (values || []).map((v, index) => ({
    index,
    value: _dbValueToString(v?.value),
    status: v?.status || '採用',
    note: v?.note || '',
    file: v?.file || '',
    property: v?.property || '',
    candidate_index: v?.candidate_index,
  }));
}
function _sortCascadeDeleteValues(values) {
  return [...(values || [])].sort((a, b) => {
    const ai = Number.isInteger(a?.candidate_index) ? a.candidate_index : -1;
    const bi = Number.isInteger(b?.candidate_index) ? b.candidate_index : -1;
    if (ai !== bi) return bi - ai;
    return 0;
  });
}
async function _deleteCascadeValue(valObj) {
  if (valObj?.candidate_index != null) return _apiPutValue(valObj, { _delete: true });
  if (valObj?.file) return apiPost('/outliner/delete', { path: valObj.file });
  throw new Error('削除対象の参照情報がありません');
}
async function _rollbackCascadeValues(entityPath, propName, deletedValues) {
  const rollbackErrors = [];
  const restoreTargets = [...(deletedValues || [])].sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
  for (const value of restoreTargets) {
    try {
      await _apiPostValue(entityPath, propName, _dbValueToString(value?.value), value?.status || '採用', value?.note || '');
    } catch (err) {
      rollbackErrors.push(err?.message || String(err));
    }
  }
  return rollbackErrors;
}
async function _deleteCascadeValuesOrRollback(entityPath, propName, currentVals, snapshot) {
  const deletedValues = [];
  const snapshotByVal = new Map(currentVals.map((value, index) => [value, snapshot[index]]));
  for (const depVal of _sortCascadeDeleteValues(currentVals)) {
    try {
      await _deleteCascadeValue(depVal);
      deletedValues.push(snapshotByVal.get(depVal));
    } catch (err) {
      const rollbackErrors = await _rollbackCascadeValues(entityPath, propName, deletedValues);
      const reason = err?.message || String(err);
      if (rollbackErrors.length) {
        throw new Error(propName + ' の cascade 値削除に失敗し、巻き戻しも失敗しました: ' + reason + ' / ' + rollbackErrors.join(' / '));
      }
      throw new Error(propName + ' の cascade 値削除に失敗しました: ' + reason);
    }
  }
}

async function _clearCascadeDependentValues(entityPath, sourcePropName, oldValue, newValue, options = {}) {
  const dbPath = _dbPivotPathForContext(options.ctx, options.dbPath || (typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : ''));
  if (!dbPath || oldValue === newValue) return [];
  const entData = _getPivotEntityData(entityPath, options.ctx);
  if (!entData) return [];
  const nextSourceValues = _splitDbMultiValue(newValue);
  const clears = [];
  for (const dep of _getCascadeDependents(sourcePropName, dbPath)) {
    const currentVals = [...(entData[dep.propName] || [])];
    if (currentVals.length === 0) continue;
    const deleteTargets = [];
    const updateTargets = [];
    for (const depVal of currentVals) {
      const ids = _splitDbMultiValue(depVal?.value);
      if (!ids.length) continue;
      const validIds = [];
      for (const id of ids) {
        if (await _validateCascadeValue(id, entityPath, dep.ptc, nextSourceValues, { dbPath, ctx: options.ctx })) validIds.push(id);
      }
      if (validIds.length === ids.length) continue;
      if (validIds.length === 0) deleteTargets.push(depVal);
      else updateTargets.push({ value: depVal, oldValue: _dbValueToString(depVal?.value), newValue: validIds.join(', ') });
    }
    if (deleteTargets.length === 0 && updateTargets.length === 0) continue;
    const snapshot = _snapshotPivotValues(deleteTargets);
    const updates = [];
    let deleteSucceeded = false;
    const appliedUpdates = [];
    try {
      if (deleteTargets.length) {
        await _deleteCascadeValuesOrRollback(entityPath, dep.propName, deleteTargets, snapshot);
        deleteSucceeded = true;
      }
      for (const target of updateTargets) {
        await _apiPutValue(target.value, { new_value: target.newValue });
        appliedUpdates.push(target);
        target.value.value = target.newValue;
        updates.push({
          ref: target.value,
          oldValue: target.oldValue,
          newValue: target.newValue,
        });
      }
    } catch (err) {
      for (const target of appliedUpdates.reverse()) {
        try {
          await _apiPutValue(target.value, { new_value: target.oldValue });
          target.value.value = target.oldValue;
        } catch {}
      }
      if (deleteSucceeded) await _rollbackCascadeValues(entityPath, dep.propName, snapshot);
      throw err;
    }
    if (deleteTargets.length) {
      const removed = new Set(deleteTargets);
      entData[dep.propName] = currentVals.filter(value => !removed.has(value));
    }
    clears.push({ propName: dep.propName, values: snapshot, updates });
  }
  return clears;
}

async function _restoreCascadeDependentValues(entityPath, clears) {
  if (!entityPath || !Array.isArray(clears) || clears.length === 0) return;
  const errors = [];
  for (const clear of clears) {
    for (const update of (clear.updates || [])) {
      try {
        await _apiPutValue(update.ref, { new_value: _dbValueToString(update.oldValue) });
        if (update.ref) update.ref.value = _dbValueToString(update.oldValue);
      } catch (err) {
        errors.push(clear.propName + ': ' + (err?.message || String(err)));
      }
    }
    for (const value of (clear.values || [])) {
      try {
        await _apiPostValue(entityPath, clear.propName, _dbValueToString(value.value), value.status || '採用', value.note || '');
      } catch (err) {
        errors.push(clear.propName + ': ' + (err?.message || String(err)));
      }
    }
  }
  if (errors.length) throw new Error('cascade 値の復元に失敗しました: ' + errors.join(' / '));
}

async function _redoCascadeDependentValues(entityPath, clears) {
  if (!entityPath || !Array.isArray(clears) || clears.length === 0) return;
  const entData = _getPivotEntityData(entityPath);
  if (!entData) return;
  for (const clear of clears) {
    for (const update of (clear.updates || [])) {
      await _apiPutValue(update.ref, { new_value: _dbValueToString(update.newValue) });
      if (update.ref) update.ref.value = _dbValueToString(update.newValue);
    }
    const currentVals = [...(entData[clear.propName] || [])];
    const deleteValues = (clear.values || []);
    if (!deleteValues.length) continue;
    const deleteTargets = currentVals.filter(v => deleteValues.some(s => _dbValueToString(s.value) === _dbValueToString(v?.value)));
    if (!deleteTargets.length) continue;
    await _deleteCascadeValuesOrRollback(entityPath, clear.propName, deleteTargets, _snapshotPivotValues(deleteTargets));
    const removed = new Set(deleteTargets);
    entData[clear.propName] = currentVals.filter(value => !removed.has(value));
  }
}

function _refreshPivotRelationCell(targetEl, entityPath, propName, ptc, options = {}) {
  const ctx = _dbPivotContextFromTarget(targetEl, { ...options, entityPath });
  const dbPath = _dbPivotPathForContext(ctx, options.dbPath || (typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : ''));
  const td = targetEl?.closest?.('td') || (targetEl?.matches?.('td') ? targetEl : null);
  const container = td?.querySelector('.cell-values');
  if (!td || !container || !dbPath) return false;
  const entityName = _getPivotEntityName(entityPath);
  const entityData = _getPivotEntityData(entityPath, ctx) || {};
  const thumbSize = getThumbnailSize(dbPath, { ctx });
  let values = filterValues(entityData[propName] || [], undefined, ctx?.filter);
  const advFilters = getAdvancedFilters(dbPath, { ctx });
  if (advFilters.length > 0) values = applyAdvancedFilters(values, propName, advFilters);
  container.innerHTML = '';
  values.forEach(cellVal => {
    container.appendChild(createTypedValueElement(cellVal, entityPath, propName, thumbSize, ptc, { dbPath, ctx, filter: ctx?.filter }));
  });
  const statusOn = getStatusEnabled(dbPath);
  const hasVisibleValue = values.some(v => String(v?.value || '').trim() !== '');
  if (statusOn || values.length === 0 || (ptc?.type === 'select' && !hasVisibleValue)) {
    const addBtn = document.createElement('span');
    addBtn.className = 'cell-add-btn';
    addBtn.innerHTML = lucide('plus', 14);
    addBtn.title = ptc?.type === 'select' ? '値を選択' : '候補値を追加';
    addBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    addBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startCellInlineAdd(td, entityPath, entityName, propName);
    });
    container.appendChild(addBtn);
  }
  const cellValues = values.map(v => v.value).join(', ');
  const cc = getCellColor(cellValues, propName, dbPath, ctx);
  if (cc) {
    td.style.background = cc.bg;
    td.style.color = cc.fg;
  } else {
    td.style.background = '';
    td.style.color = '';
  }
  return true;
}

function _shouldReloadPivotAfterRelationChange(propName, ptc, affectedProps, options = {}) {
  const dbPath = _dbPivotPathForContext(options.ctx, options.dbPath);
  if (!dbPath) return true;
  const affected = new Set([propName, ...(affectedProps || [])]);
  const groupBy = getGroupBy(dbPath, options.ctx || null);
  if (groupBy && affected.has(groupBy)) return true;
  if (ptc && ptc.pairWith && ptc.relationDb === '') return true;
  const sortCfg = typeof getDbSortConfig === 'function'
    ? getDbSortConfig(dbPath, { ctx: options.ctx || null })
    : (typeof getDbViewConfig === 'function' && getDbViewConfig(dbPath))?.sortConfig;
  if (sortCfg && affected.has(sortCfg.key)) return true;
  const advFilters = getAdvancedFilters(dbPath, { ctx: options.ctx || null }) || [];
  return advFilters.some(f => f?.property === '*' || affected.has(f?.property));
}

async function _finalizeRelationCellUpdate(targetEl, entityPath, propName, ptc, affectedProps, options = {}) {
  const ctx = _dbPivotContextFromTarget(targetEl, { ...options, entityPath });
  const dbPath = _dbPivotPathForContext(ctx, options.dbPath || (typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : ''));
  if (!_shouldReloadPivotAfterRelationChange(propName, ptc, affectedProps, { dbPath, ctx })
      && _refreshPivotRelationCell(targetEl, entityPath, propName, ptc, { dbPath, ctx })) {
    const extraProps = affectedProps || [];
    const propTypes = getPropertyTypes(dbPath) || {};
    extraProps.forEach(depProp => {
      const depPtc = propTypes[depProp];
      const depTd = _getPivotRowCellByProp(targetEl, depProp);
      if (depTd && depPtc) _refreshPivotRelationCell(depTd, entityPath, depProp, depPtc, { dbPath, ctx });
    });
    const td = targetEl?.closest?.('td') || (targetEl?.matches?.('td') ? targetEl : null);
    if (td) _refreshDerivedCellsInRow(td, entityPath, { dbPath, ctx });
    if (td && typeof setActiveCell === 'function') setActiveCell(td);
    return;
  }
  if (dbPath) await selectDatabase(dbPath, ctx);
}

function _tryRefreshPivotCellLocal(td, entityPath, propName, options = {}) {
  const ctx = _dbPivotContextFromTarget(td, { ...options, entityPath });
  const dbPath = _dbPivotPathForContext(ctx, options.dbPath || (typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : ''));
  if (!td || !dbPath) return false;
  const ptc = getPropertyTypes(dbPath)?.[propName];
  if (_shouldReloadPivotAfterRelationChange(propName, ptc, [], { dbPath, ctx })) return false;
  if (ptc && ['formula', 'rollup', 'chat', 'multi-source-relation', 'button'].includes(ptc.type)) return false;
  const sortCfg = typeof getDbSortConfig === 'function'
    ? getDbSortConfig(dbPath, { ctx })
    : (typeof getDbViewConfig === 'function' && getDbViewConfig(dbPath))?.sortConfig;
  if (sortCfg && sortCfg.key === propName) return false;
  if (!_refreshPivotRelationCell(td, entityPath, propName, ptc, { dbPath, ctx })) return false;
  _refreshDerivedCellsInRow(td, entityPath, { dbPath, ctx });
  return true;
}

function _refreshDerivedCellsInRow(editedTd, entityPath, options = {}) {
  const ctx = _dbPivotContextFromTarget(editedTd, { ...options, entityPath });
  const dbPath = _dbPivotPathForContext(ctx, options.dbPath || (typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : ''));
  const pivotData = _dbPivotDataForContext(ctx);
  if (!editedTd || !dbPath || !pivotData?.entities) return;
  const tr = editedTd.closest('tr');
  if (!tr) return;
  const propTypes = getPropertyTypes(dbPath) || {};
  const entityName = _getPivotEntityName(entityPath);
  const entityData = pivotData.entities[entityName];
  if (!entityData) return;

  entityData._modified = new Date().toISOString();
  if (typeof getUsername === 'function') {
    try { entityData._modified_by = getUsername() || entityData._modified_by || ''; } catch {}
  }

  let rollupCacheCleared = false;
  for (const [propName, ptc] of Object.entries(propTypes)) {
    if (!ptc) continue;
    const isSource = !!ptc.source;
    const isFormula = ptc.type === 'formula' && ptc.formula;
    const isRollup = ptc.type === 'rollup' && ptc.relationProp;
    if (!isSource && !isFormula && !isRollup) continue;
    const td = tr.querySelector('td[data-prop-name="' + _cssEscapeAttr(propName) + '"]');
    if (!td || td === editedTd) continue;
    const container = td.querySelector('.cell-values');
    if (!container) continue;
    if (isRollup && !rollupCacheCleared) {
      if (typeof clearRollupCache === 'function') clearRollupCache(dbPath);
      rollupCacheCleared = true;
    }
    _renderDerivedCellContent(container, ptc, entityName, propName, entityData, { dbPath, ctx, propTypes, pivotData });
  }
}

function _cssEscapeAttr(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/(["\\])/g, '\\$1');
}

function _renderDerivedCellContent(container, ptc, entityName, propName, entityData, options = {}) {
  const dbPath = options.dbPath || _dbPivotPathForContext(options.ctx, '');
  const propTypes = options.propTypes || (dbPath ? getPropertyTypes(dbPath) : {}) || {};
  const pivotData = options.pivotData || _dbPivotDataForContext(options.ctx);
  container.innerHTML = '';
  if (ptc.source) {
    const metaKey = '_' + ptc.source;
    const metaVal = entityData[metaKey] || '';
    const span = document.createElement('span');
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    if ((ptc.source === 'created' || ptc.source === 'modified') && metaVal) {
      span.textContent = typeof _formatDateDisplay === 'function'
        ? _formatDateDisplay(metaVal, ptc)
        : metaVal.replace('T', ' ').substring(0, 16);
    } else if (ptc.source === 'modified_by' && metaVal) {
      span.innerHTML = (typeof _userAvatarSmall === 'function' ? _userAvatarSmall(metaVal) + ' ' : '') + esc(metaVal);
    } else {
      span.textContent = '—';
    }
    container.appendChild(span);
    return;
  }
  if (ptc.type === 'formula' && ptc.formula) {
    const result = typeof formulaEvalForEntity === 'function'
      ? formulaEvalForEntity(ptc.formula, entityData, { propTypes, dbPath })
      : { value: '', error: 'formula engine unavailable' };
    const span = document.createElement('span');
    span.style.cssText = 'font-size:13px;color:var(--fg);';
    if (result.error) {
      span.style.color = 'var(--red)';
      span.textContent = '#ERROR';
      span.title = result.error;
    } else {
      const formulaValue = result.value === '' ? '' : String(result.value);
      span.textContent = formulaValue;
      if (typeof _cellUiApplyAutoLinks === 'function'
          && _cellUiApplyAutoLinks(span, formulaValue, typeof _entityPath === 'function' && dbPath ? _entityPath(dbPath, entityName) : '')) {
        span.addEventListener('click', (e) => { if (typeof _cellUiHandleAutoLinkClick === 'function') _cellUiHandleAutoLinkClick(e); });
      }
    }
    container.appendChild(span);
    return;
  }
  if (ptc.type === 'rollup' && ptc.relationProp && typeof calcRollupValue === 'function') {
    const span = document.createElement('span');
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    span.textContent = '...';
    container.appendChild(span);
    const entitiesMap = pivotData?.entities || {};
    calcRollupValue(entityName, entitiesMap, ptc, propTypes, dbPath, options.ctx?.filter).then(val => {
      const displayValue = val === '-' ? '-' : String(val);
      span.textContent = displayValue;
      span.style.color = 'var(--fg)';
      if (typeof _cellUiApplyAutoLinks === 'function'
          && _cellUiApplyAutoLinks(span, displayValue, typeof _entityPath === 'function' && dbPath ? _entityPath(dbPath, entityName) : '')) {
        span.addEventListener('click', (e) => { if (typeof _cellUiHandleAutoLinkClick === 'function') _cellUiHandleAutoLinkClick(e); });
      }
    }).catch(() => {
      span.textContent = '#ERR';
      span.style.color = 'var(--red)';
    });
  }
}

function _removeLocalPivotValue(val, entityPath, propName, options = {}) {
  if (!val) return;
  const dbPath = options.dbPath || (typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : '');
  const ctx = options.ctx || (dbPath && typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null);
  const entName = entityPath.replace(/\.md$/, '').split('/').pop();
  const targets = [];
  if (ctx?.pivotData?.entities) targets.push(ctx.pivotData);
  if (state.pivotData?.entities && (!dbPath || state.currentDbPath === dbPath)) targets.push(state.pivotData);
  targets.forEach(pivotData => {
    const entData = pivotData.entities?.[entName];
    if (!entData || !Array.isArray(entData[propName])) return;
    const idx = entData[propName].indexOf(val);
    if (idx >= 0) entData[propName].splice(idx, 1);
  });
}

function _refreshAfterCellEdit(anchorEl, entityPath, propName) {
  const ctx = _dbPivotContextFromTarget(anchorEl, { entityPath });
  const dbPath = _dbPivotPathForContext(ctx, typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : '');
  if (!dbPath && state.view === 'entity' && state.currentEntityPath) {
    if (typeof selectEntity === 'function') selectEntity(state.currentEntityPath);
    return;
  }
  const currentMode = dbPath && typeof getCurrentViewMode === 'function'
    ? (ctx?.viewMode || getCurrentViewMode(dbPath, { ctx }))
    : state.view;
  if ((currentMode === 'timeline' || currentMode === 'calendar' || currentMode === 'tasks' || currentMode === 'shifts') && dbPath) {
    if (typeof renderTimeline === 'function') renderTimeline(ctx);
    else selectDatabase(dbPath, ctx, { silent: true });
    return;
  }
  if (currentMode !== 'pivot' || !dbPath) return;
  const td = anchorEl?.closest?.('td');
  if (td && entityPath && _tryRefreshPivotCellLocal(td, entityPath, propName, { dbPath, ctx })) return;
  selectDatabase(dbPath, ctx, { silent: true });
}

async function _validateCascadeValue(currentId, entityPath, ptc, parentValuesOverride, options = {}) {
  const dbPath = _dbPivotPathForContext(options.ctx, options.dbPath || (typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(entityPath) : ''));
  const relDb = typeof _dbResolveRelationDbPath === 'function'
    ? _dbResolveRelationDbPath(dbPath, ptc)
    : ((ptc.relationDb === '' ? dbPath : ptc.relationDb) || '');
  if (!currentId || !ptc.cascadeFrom || !relDb) return true;
  const parentValues = Array.isArray(parentValuesOverride)
    ? parentValuesOverride
    : _getCurrentEntityValues(entityPath, ptc.cascadeFrom, options.ctx);
  if (!parentValues.length) return !Array.isArray(parentValuesOverride);
  const map = await _getRelationMap(relDb);
  const entName = map.idToName[currentId] || currentId;
  const entData = map.entities?.[entName];
  if (!entData) return false;
  const cascadeVals = entData[ptc.cascadeKey] || [];
  return cascadeVals.some(v => {
    const vals = _splitDbMultiValue(v.value);
    return parentValues.some(parentValue => vals.includes(parentValue));
  });
}

function _getCurrentEntityValues(entityPath, propName, ctx) {
  const pivotData = _dbPivotDataForContext(ctx);
  if (!pivotData?.entities) return [];
  const entData = _getPivotEntityData(entityPath, ctx);
  if (!entData || !entData[propName]) return [];
  const vals = entData[propName];
  const adopted = vals.filter(v => v.status === '採用' || v.status === '掲載済み');
  const sourceVals = adopted.length ? adopted : vals;
  return [...new Set(sourceVals.flatMap(v => _splitDbMultiValue(v?.value)))];
}

function _getCurrentEntityValue(entityPath, propName) {
  return _getCurrentEntityValues(entityPath, propName)[0] || '';
}
