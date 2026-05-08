/* シート pivot 同期・relation キャッシュ helper — gb-db-props.js から分離 */

const _relationCache = {};

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

async function _getRelationMap(relationDbPath) {
  const now = Date.now();
  const cached = _relationCache[relationDbPath];
  if (typeof _dbCacheIsFresh === 'function') {
    if (_dbCacheIsFresh(cached, 'relation')) return cached;
  } else if (cached && now - cached.timestamp < 30000) {
    return cached;
  }
  try {
    const data = await apiFetch('/pivot?path=' + encodeURIComponent(relationDbPath));
    return _setRelationMapCache(relationDbPath, data) || _buildRelationMapEntry({});
  } catch {
    return { idToName: {}, nameToId: {}, entities: {}, new_format: false, timestamp: now };
  }
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
      const relDb = (ptc.relationDb === '' ? dbPath : ptc.relationDb) || '';
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

function _getPivotEntityData(entityPath) {
  const entityName = _getPivotEntityName(entityPath);
  return state.pivotData?.entities?.[entityName] || null;
}

function _upsertLocalPivotValue(entityPath, propName, val, newValue, extra) {
  if (val) val.value = newValue;
  const entData = _getPivotEntityData(entityPath);
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

function _getCascadeDependents(sourcePropName) {
  if (!state.currentDbPath || !sourcePropName) return [];
  const pts = getPropertyTypes(state.currentDbPath) || {};
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

async function _clearCascadeDependentValues(entityPath, sourcePropName, oldValue, newValue) {
  if (!state.currentDbPath || oldValue === newValue) return [];
  const entData = _getPivotEntityData(entityPath);
  if (!entData) return [];
  const nextSourceValues = _splitDbMultiValue(newValue);
  const clears = [];
  for (const dep of _getCascadeDependents(sourcePropName)) {
    const currentVals = [...(entData[dep.propName] || [])];
    if (currentVals.length === 0) continue;
    const deleteTargets = [];
    for (const depVal of currentVals) {
      const ids = _splitDbMultiValue(depVal?.value);
      if (!ids.length) continue;
      let stillValid = false;
      for (const id of ids) {
        if (await _validateCascadeValue(id, entityPath, dep.ptc, nextSourceValues)) {
          stillValid = true;
          break;
        }
      }
      if (!stillValid) deleteTargets.push(depVal);
    }
    if (deleteTargets.length === 0) continue;
    const snapshot = _snapshotPivotValues(deleteTargets);
    await _deleteCascadeValuesOrRollback(entityPath, dep.propName, deleteTargets, snapshot);
    const removed = new Set(deleteTargets);
    entData[dep.propName] = currentVals.filter(value => !removed.has(value));
    clears.push({ propName: dep.propName, values: snapshot });
  }
  return clears;
}

async function _restoreCascadeDependentValues(entityPath, clears) {
  if (!entityPath || !Array.isArray(clears) || clears.length === 0) return;
  const errors = [];
  for (const clear of clears) {
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
    const currentVals = [...(entData[clear.propName] || [])];
    if (currentVals.length === 0) {
      entData[clear.propName] = [];
      continue;
    }
    await _deleteCascadeValuesOrRollback(entityPath, clear.propName, currentVals, _snapshotPivotValues(currentVals));
    entData[clear.propName] = [];
  }
}

function _refreshPivotRelationCell(targetEl, entityPath, propName, ptc) {
  const td = targetEl?.closest?.('td') || (targetEl?.matches?.('td') ? targetEl : null);
  const container = td?.querySelector('.cell-values');
  if (!td || !container || !state.currentDbPath) return false;
  const entityName = _getPivotEntityName(entityPath);
  const entityData = _getPivotEntityData(entityPath) || {};
  const thumbSize = getThumbnailSize(state.currentDbPath);
  let values = filterValues(entityData[propName] || []);
  const advFilters = getAdvancedFilters(state.currentDbPath);
  if (advFilters.length > 0) values = applyAdvancedFilters(values, propName, advFilters);
  container.innerHTML = '';
  values.forEach(cellVal => {
    container.appendChild(createTypedValueElement(cellVal, entityPath, propName, thumbSize, ptc));
  });
  const statusOn = getStatusEnabled(state.currentDbPath);
  if (statusOn || values.length === 0) {
    const addBtn = document.createElement('span');
    addBtn.className = 'cell-add-btn';
    addBtn.innerHTML = lucide('plus', 14);
    addBtn.title = '候補値を追加';
    addBtn.addEventListener('click', () => startCellInlineAdd(td, entityPath, entityName, propName));
    container.appendChild(addBtn);
  }
  const cellValues = values.map(v => v.value).join(', ');
  const cc = getCellColor(cellValues, propName, state.currentDbPath);
  if (cc) {
    td.style.background = cc.bg;
    td.style.color = cc.fg;
  } else {
    td.style.background = '';
    td.style.color = '';
  }
  return true;
}

function _shouldReloadPivotAfterRelationChange(propName, ptc, affectedProps) {
  if (!state.currentDbPath) return true;
  const affected = new Set([propName, ...(affectedProps || [])]);
  const groupBy = getGroupBy(state.currentDbPath);
  if (groupBy && affected.has(groupBy)) return true;
  if (ptc && ptc.pairWith && ptc.relationDb === '') return true;
  const advFilters = getAdvancedFilters(state.currentDbPath) || [];
  return advFilters.some(f => f?.property === '*' || affected.has(f?.property));
}

async function _finalizeRelationCellUpdate(targetEl, entityPath, propName, ptc, affectedProps) {
  if (!_shouldReloadPivotAfterRelationChange(propName, ptc, affectedProps)
      && _refreshPivotRelationCell(targetEl, entityPath, propName, ptc)) {
    const extraProps = affectedProps || [];
    extraProps.forEach(depProp => {
      const depPtc = getPropertyTypes(state.currentDbPath)?.[depProp];
      const depTd = _getPivotRowCellByProp(targetEl, depProp);
      if (depTd && depPtc) _refreshPivotRelationCell(depTd, entityPath, depProp, depPtc);
    });
    const td = targetEl?.closest?.('td') || (targetEl?.matches?.('td') ? targetEl : null);
    if (td) _refreshDerivedCellsInRow(td, entityPath);
    if (td && typeof setActiveCell === 'function') setActiveCell(td);
    return;
  }
  if (state.currentDbPath) await selectDatabase(state.currentDbPath);
}

function _tryRefreshPivotCellLocal(td, entityPath, propName) {
  if (!td || !state.currentDbPath) return false;
  const ptc = getPropertyTypes(state.currentDbPath)?.[propName];
  if (_shouldReloadPivotAfterRelationChange(propName, ptc, [])) return false;
  if (ptc && ['formula', 'rollup', 'chat', 'multi-source-relation', 'button'].includes(ptc.type)) return false;
  const sortCfg = typeof getDbSortConfig === 'function'
    ? getDbSortConfig(state.currentDbPath)
    : (typeof getDbViewConfig === 'function' && getDbViewConfig(state.currentDbPath))?.sortConfig;
  if (sortCfg && sortCfg.key === propName) return false;
  if (!_refreshPivotRelationCell(td, entityPath, propName, ptc)) return false;
  _refreshDerivedCellsInRow(td, entityPath);
  return true;
}

function _refreshDerivedCellsInRow(editedTd, entityPath) {
  if (!editedTd || !state.currentDbPath || !state.pivotData?.entities) return;
  const tr = editedTd.closest('tr');
  if (!tr) return;
  const propTypes = getPropertyTypes(state.currentDbPath) || {};
  const entityName = _getPivotEntityName(entityPath);
  const entityData = state.pivotData.entities[entityName];
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
      if (typeof clearRollupCache === 'function') clearRollupCache(state.currentDbPath);
      rollupCacheCleared = true;
    }
    _renderDerivedCellContent(container, ptc, entityName, propName, entityData);
  }
}

function _cssEscapeAttr(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/(["\\])/g, '\\$1');
}

function _renderDerivedCellContent(container, ptc, entityName, propName, entityData) {
  container.innerHTML = '';
  if (ptc.source) {
    const metaKey = '_' + ptc.source;
    const metaVal = entityData[metaKey] || '';
    const span = document.createElement('span');
    span.style.cssText = 'font-size:13px;color:var(--fg2);';
    if (ptc.source === 'modified' && metaVal) {
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
      ? formulaEvalForEntity(ptc.formula, entityData)
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
          && _cellUiApplyAutoLinks(span, formulaValue, typeof _entityPath === 'function' ? _entityPath(state.currentDbPath, entityName) : '')) {
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
    const entitiesMap = state.pivotData?.entities || {};
    const propTypes = getPropertyTypes(state.currentDbPath) || {};
    calcRollupValue(entityName, entitiesMap, ptc, propTypes).then(val => {
      const displayValue = val === '-' ? '-' : String(val);
      span.textContent = displayValue;
      span.style.color = 'var(--fg)';
      if (typeof _cellUiApplyAutoLinks === 'function'
          && _cellUiApplyAutoLinks(span, displayValue, typeof _entityPath === 'function' ? _entityPath(state.currentDbPath, entityName) : '')) {
        span.addEventListener('click', (e) => { if (typeof _cellUiHandleAutoLinkClick === 'function') _cellUiHandleAutoLinkClick(e); });
      }
    }).catch(() => {
      span.textContent = '#ERR';
      span.style.color = 'var(--red)';
    });
  }
}

function _removeLocalPivotValue(val, entityPath, propName) {
  if (!val || !state.pivotData?.entities) return;
  const entName = entityPath.replace(/\.md$/, '').split('/').pop();
  const entData = state.pivotData.entities[entName];
  if (!entData || !Array.isArray(entData[propName])) return;
  const idx = entData[propName].indexOf(val);
  if (idx >= 0) entData[propName].splice(idx, 1);
}

function _refreshAfterCellEdit(anchorEl, entityPath, propName) {
  if (state.view === 'entity' && state.currentEntityPath) {
    if (typeof selectEntity === 'function') selectEntity(state.currentEntityPath);
    return;
  }
  const currentMode = state.currentDbPath && typeof getCurrentViewMode === 'function'
    ? getCurrentViewMode(state.currentDbPath)
    : state.view;
  if ((state.view === 'timeline' || currentMode === 'timeline') && state.currentDbPath) {
    const ctx = typeof _dbPaneContextFromEvent === 'function'
      ? _dbPaneContextFromEvent(anchorEl, { dbPath: state.currentDbPath })
      : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
    if (typeof renderTimeline === 'function') renderTimeline(ctx);
    else selectDatabase(state.currentDbPath, undefined, { silent: true });
    return;
  }
  if (state.view !== 'pivot' || !state.currentDbPath) return;
  const td = anchorEl?.closest?.('td');
  if (td && entityPath && _tryRefreshPivotCellLocal(td, entityPath, propName)) return;
  selectDatabase(state.currentDbPath, undefined, { silent: true });
}

async function _validateCascadeValue(currentId, entityPath, ptc, parentValuesOverride) {
  const relDb = (ptc.relationDb === '' ? state.currentDbPath : ptc.relationDb) || '';
  if (!currentId || !ptc.cascadeFrom || !relDb) return true;
  const parentValues = Array.isArray(parentValuesOverride)
    ? parentValuesOverride
    : _getCurrentEntityValues(entityPath, ptc.cascadeFrom);
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

function _getCurrentEntityValues(entityPath, propName) {
  if (!state.pivotData?.entities) return [];
  const entData = _getPivotEntityData(entityPath);
  if (!entData || !entData[propName]) return [];
  const vals = entData[propName];
  const adopted = vals.filter(v => v.status === '採用' || v.status === '掲載済み');
  const sourceVals = adopted.length ? adopted : vals;
  return [...new Set(sourceVals.flatMap(v => _splitDbMultiValue(v?.value)))];
}

function _getCurrentEntityValue(entityPath, propName) {
  return _getCurrentEntityValues(entityPath, propName)[0] || '';
}
