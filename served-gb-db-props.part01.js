/* プロパティ管理・モーダル・表示設定 — gb-database.js から分離 */

// プロパティタイプ → Lucideアイコン名マッピング
const PROP_TYPE_ICON = {
  text: 'alignLeft',
  number: 'hash',
  select: 'tag',
  'multi-select': 'tags',
  checkbox: 'checkSquare',
  date: 'calendar',
  url: 'globe',
  relation: 'link2',
  'multi-relation': 'link',
  user: 'user',
  'multi-user': 'users',
  formula: 'sigma',
  rollup: 'sigma',
  button: 'play',
  'multi-source-relation': 'database',
  chat: 'messagesSquare',
};

/* ==============================
   リレーションIDキャッシュ
   ============================== */
const _relationCache = {};
function _buildRelationMapEntry(data) {
  const entities = data?.entities || {};
  const idToName = {}, nameToId = {};
  for (const [name, props] of Object.entries(entities)) {
    const id = props._id || name;
    idToName[id] = name;
    nameToId[name] = id;
  }
  return { idToName, nameToId, entities, timestamp: Date.now() };
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
  } catch { return { idToName: {}, nameToId: {}, entities: {}, timestamp: now }; }
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
  return _getRelationDisplayInfo(idOrName, relationDbPath).label || idOrName;
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
function _snapshotPivotValues(values) {
  return (values || []).map((v, index) => ({
    index,
    value: v?.value || '',
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
      await _apiPostValue(entityPath, propName, value?.value || '', value?.status || '採用', value?.note || '');
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
  const clears = [];
  for (const dep of _getCascadeDependents(sourcePropName)) {
    const currentVals = [...(entData[dep.propName] || [])];
    if (currentVals.length === 0) continue;
    const snapshot = _snapshotPivotValues(currentVals);
    await _deleteCascadeValuesOrRollback(entityPath, dep.propName, currentVals, snapshot);
    entData[dep.propName] = [];
    clears.push({ propName: dep.propName, values: snapshot });
  }
  return clears;
}
async function _restoreCascadeDependentValues(entityPath, clears) {
  if (!entityPath || !Array.isArray(clears) || clears.length === 0) return;
  for (const clear of clears) {
    for (const value of (clear.values || [])) {
      try {
        await _apiPostValue(entityPath, clear.propName, value.value || '', value.status || '採用', value.note || '');
      } catch {}
    }
  }
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
  // ステータス機能 OFF の DB は 1セル1値運用 → 既存値ありセルでは add ボタンを出さない
  const _statusOn = getStatusEnabled(state.currentDbPath);
  if (_statusOn || values.length === 0) {
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
    // Step 3 第3陣: relation 編集後も同じ行の派生セル (formula / rollup / source) を再評価
    if (td) _refreshDerivedCellsInRow(td, entityPath);
    if (td && typeof setActiveCell === 'function') setActiveCell(td);
    return;
  }
  if (state.currentDbPath) await selectDatabase(state.currentDbPath);
}

// 汎用セル増分更新 (relation 以外の型でも使用)
// 値変更後、当該セルだけ DOM 更新して画面全体の再描画を回避する。
// グループ化中・集計影響範囲などで不可な場合は false を返し、呼び出し側でフルリロードへフォールバック。
function _tryRefreshPivotCellLocal(td, entityPath, propName) {
  if (!td || !state.currentDbPath) return false;
  const ptc = getPropertyTypes(state.currentDbPath)?.[propName];
  // groupBy / advFilter 影響時はフルリロード
  if (_shouldReloadPivotAfterRelationChange(propName, ptc, [])) return false;
  // formula / rollup / button / chat は他値依存または値を持たないためフルリロード
  if (ptc && ['formula', 'rollup', 'chat', 'multi-source-relation', 'button'].includes(ptc.type)) return false;
  // ソート対象列の編集はフォールバック (行順が変わる)
  const sortCfg = (typeof getDbViewConfig === 'function' && getDbViewConfig(state.currentDbPath))?.sortConfig;
  if (sortCfg && sortCfg.key === propName) return false;
  if (!_refreshPivotRelationCell(td, entityPath, propName, ptc)) return false;
  // Step 3 第3陣: 同じ行の派生セル (formula / rollup / source) を再評価
  _refreshDerivedCellsInRow(td, entityPath);
  return true;
}

/**
 * Step 3 第3陣: 同じ行の派生セル (formula / rollup / source) を再評価する。
 * partial update が成功した直後に呼び、行内の派生セルだけを再描画する。
 *
 * 対象:
 *   - source 系 (`ptc.source` flag): _modified / _modified_by の値表示
 *   - formula 型: 同行の他プロパティ (`prop("X")`) に依存
 *   - rollup 型: この行の relationProp が参照する他エントリの targetProp に依存
 *
 * source 型の自動更新: 編集が起きた瞬間に `entityData._modified` と
 * `_modified_by` をクライアント側でも書き換える (サーバーは _touch_modified で
 * frontmatter を既に更新済み)。
 *
 * クロス行 / クロス DB の rollup 連鎖更新は対象外 (逆引きインデックスがない)。
 * `_rollupCache` の 30 秒 TTL に任せる。
 *
 * @param {HTMLElement} editedTd 直前に編集された td (この td は除外)
 * @param {string} entityPath 編集対象エントリのパス
 */
function _refreshDerivedCellsInRow(editedTd, entityPath) {
  if (!editedTd || !state.currentDbPath || !state.pivotData?.entities) return;
  const tr = editedTd.closest('tr');
  if (!tr) return;
  const propTypes = getPropertyTypes(state.currentDbPath) || {};
  const entityName = _getPivotEntityName(entityPath);
  const entityData = state.pivotData.entities[entityName];
  if (!entityData) return;

  // source 系 (modified / modified_by) のクライアント側自動更新
  // サーバーは _touch_modified で frontmatter を既に更新しているので、
  // ローカル pivotData も同じタイミングで合わせておく
  entityData._modified = new Date().toISOString();
  if (typeof getUsername === 'function') {
    try { entityData._modified_by = getUsername() || entityData._modified_by || ''; } catch {}
  }

  // 自己参照ロールアップ等で当該 DB を参照するケースを安全側に倒す
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
      if (typeof clearRollupCache === 'function') {
        clearRollupCache(state.currentDbPath);
      }
      rollupCacheCleared = true;
    }
    _renderDerivedCellContent(container, ptc, entityName, propName, entityData);
  }
}

// 属性値の安全エスケープ (CSS.escape の薄ラッパー)
function _cssEscapeAttr(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return String(s).replace(/(["\\])/g, '\\$1');
}

/**
 * Step 3 第3陣: 派生セル (source / formula / rollup) のコンテンツを再生成する。
 * gb-database.js の renderEntityCell の対応分岐をミラーしている。
 * @param {HTMLElement} container `.cell-values` div
 * @param {object} ptc プロパティ型設定
 * @param {string} entityName エントリ名
 * @param {string} propName プロパティ名
 * @param {object} entityData state.pivotData.entities[entityName]
 */
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
    }).catch(() => { span.textContent = '#ERR'; span.style.color = 'var(--red)'; });
    return;
  }
}

/**
 * Step 3: pivotData の特定の val 参照を該当エントリ・プロパティの配列から除去する。
 * 値削除 (`_apiPutValue(val, { _delete: true })`) 後に呼んで、ローカル pivotData を
 * 同期させる。
 * @param {object} val 削除済みの値オブジェクト
 * @param {string} entityPath
 * @param {string} propName
 */
function _removeLocalPivotValue(val, entityPath, propName) {
  if (!val || !state.pivotData?.entities) return;
  const entName = entityPath.replace(/\.md$/, '').split('/').pop();
  const entData = state.pivotData.entities[entName];
  if (!entData || !Array.isArray(entData[propName])) return;
  const idx = entData[propName].indexOf(val);
  if (idx >= 0) entData[propName].splice(idx, 1);
}

/**
 * Step 3: セル編集後の DOM 更新 + フォールバック共通ヘルパー。
 * anchorEl から td を取得して `_tryRefreshPivotCellLocal` を試み、失敗したら
 * フルリロード (silent な selectDatabase) にフォールバックする。
 * エンティティビューでは selectEntity にフォールバックする。
 * @param {HTMLElement|null} anchorEl 編集対象のセル内の任意の要素 (closest('td') で td を取る)
 * @param {string} entityPath エンティティのパス
 * @param {string} propName プロパティ名
 */
function _refreshAfterCellEdit(anchorEl, entityPath, propName) {
  if (state.view === 'entity' && state.currentEntityPath) {
    if (typeof selectEntity === 'function') selectEntity(state.currentEntityPath);
    return;
  }
  if (state.view !== 'pivot' || !state.currentDbPath) return;
  const td = anchorEl?.closest?.('td');
  if (td && entityPath && _tryRefreshPivotCellLocal(td, entityPath, propName)) return;
  selectDatabase(state.currentDbPath, undefined, { silent: true });
}

// カスケード不整合チェック
async function _validateCascadeValue(currentId, entityPath, ptc) {
  const relDb = (ptc.relationDb === '' ? state.currentDbPath : ptc.relationDb) || '';
  if (!currentId || !ptc.cascadeFrom || !relDb) return true;
  const parentValue = _getCurrentEntityValue(entityPath, ptc.cascadeFrom);
  if (!parentValue) return true; // 依存元が未選択なら不整合なし
  const map = await _getRelationMap(relDb);
  const entName = map.idToName[currentId] || currentId;
  const entData = map.entities?.[entName];
  if (!entData) return false;
  const cascadeVals = entData[ptc.cascadeKey] || [];
  return cascadeVals.some(v => {
    const val = v.value || '';
    return val.split(',').map(s => s.trim()).includes(parentValue);
  });
}

// 現在編集中エントリの特定プロパティ値を取得
function _getCurrentEntityValue(entityPath, propName) {
  if (!state.pivotData?.entities) return '';
  const entData = _getPivotEntityData(entityPath);
  if (!entData || !entData[propName]) return '';
  const vals = entData[propName];
  // 採用ステータスを優先
  const adopted = vals.find(v => v.status === '採用' || v.status === '掲載済み');
  return (adopted || vals[0])?.value || '';
}

/* ==============================
   モーダル: 新規エントリ追加
   ============================== */
// エントリ作成テンプレート管理
function getEntityTemplates(dbPath) {
  const fid = _pathToFileId(dbPath);
  if (fid) { try { const v = localStorage.getItem('entityTemplates:' + fid); if (v) return JSON.parse(v); } catch {} }
  try { return JSON.parse(localStorage.getItem('entityTemplates:' + (dbPath || ''))) || []; } catch { return []; }
}
function saveEntityTemplates(dbPath, templates) {
  const fid = _pathToFileId(dbPath);
  localStorage.setItem('entityTemplates:' + (fid || dbPath || ''), JSON.stringify(templates));
}

/* ==============================
   カラムヘッダーコンテキストメニュー
   ============================== */
function closeColHeaderMenu() {
  document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
}

// メニュー上部にリネーム入力欄を挿入する共通ヘルパー
// onRename(newValue) は newValue !== currentValue かつ非空のときだけ呼ばれる
function _addMenuRenameInput(menu, currentValue, onRename, opts) {
  const placeholder = (opts && opts.placeholder) || '名前を変更...';
  const wrap = document.createElement('div');
  wrap.className = 'gb-menu-rename-row';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = currentValue || '';
  inp.placeholder = placeholder;
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const newVal = inp.value.trim();
      if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
      menu.remove();
      if (newVal && newVal !== currentValue) onRename(newVal);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
      menu.remove();
    }
  });
  // クリックでメニューが閉じないようイベント伝播をストップ
  wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
  wrap.addEventListener('click', (e) => e.stopPropagation());
  wrap.appendChild(inp);
  menu.insertBefore(wrap, menu.firstChild);
  if (opts && opts.autoFocus === true) {
    setTimeout(() => { inp.focus(); }, 0);
  }
  return inp;
}

function _renderColMenuItems(container, itemList) {
  itemList.forEach(item => {
    if (item.type === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'gb-context-menu-sep';
      container.appendChild(sep);
      return;
    }
    if (item.type === 'submenu') {
      const wrapper = document.createElement('div');
      const el = document.createElement('div');
      el.className = 'gb-context-menu-item';
      el.innerHTML = item.label + submenuArrow();
      const sub = document.createElement('div');
      sub.className = 'gb-context-menu gb-context-submenu';
      sub.style.display = 'none';
      _renderColMenuItems(sub, item.children);
      attachHoverSubmenu(el, sub);
      wrapper.appendChild(el);
      wrapper.appendChild(sub);
      container.appendChild(wrapper);
      return;
    }
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
    el.innerHTML = item.label;
    if (item.danger) el.classList.add('danger');
    if (item.action) el.addEventListener('click', (ev) => { ev.stopPropagation(); closeColHeaderMenu(); item.action(); });
    container.appendChild(el);
  });
}

function _makeDbGlobalSortMenuItems(dbPath) {
  const sc = getDbViewConfig(dbPath).sortConfig || { key: 'name', dir: 'asc' };
  const items = [
    { label: (sc.key === 'name' && sc.dir === 'asc' ? radioMark(true) : '　') + '名前 昇順', action: () => { const c = getDbViewConfig(dbPath); c.sortConfig = { key: 'name', dir: 'asc' }; saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 並び替え', historyDetail: '名前 昇順' }); renderPivot(); }},
    { label: (sc.key === 'name' && sc.dir === 'desc' ? radioMark(true) : '　') + '名前 降順', action: () => { const c = getDbViewConfig(dbPath); c.sortConfig = { key: 'name', dir: 'desc' }; saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 並び替え', historyDetail: '名前 降順' }); renderPivot(); }},
    { label: (sc.key === 'manual' ? radioMark(true) : '　') + 'マニュアル', action: () => { const c = getDbViewConfig(dbPath); c.sortConfig = { key: 'manual', dir: 'asc' }; saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 並び替え', historyDetail: 'マニュアル' }); renderPivot(); }},
  ];
  if (state.pivotData?.properties?.length) {
    items.push({ type: 'sep' });
    state.pivotData.properties.forEach(p => {
      items.push({ label: (sc.key === p ? radioMark(true) : '　') + p, action: () => {
        const c = getDbViewConfig(dbPath);
        const dir = sc.key === p && sc.dir === 'asc' ? 'desc' : 'asc';
        c.sortConfig = { key: p, dir };
        saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 並び替え', historyDetail: p + ' ' + (dir === 'asc' ? '昇順' : '降順') });
        renderPivot();
      }});
    });
  }
  return items;
}

function showDbSortMenu(e) {
  closeColHeaderMenu();
  closeAllDropdowns();
  const dbPath = state.currentDbPath;
  if (!dbPath) return;
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  _renderColMenuItems(menu, _makeDbGlobalSortMenuItems(dbPath));
  document.body.appendChild(menu);
  const rect = e?.currentTarget?.getBoundingClientRect?.() || e?.target?.getBoundingClientRect?.();
  if (rect) positionPopup(menu, { left: rect.left, right: rect.right, top: rect.bottom, bottom: rect.bottom });
  else positionPopup(menu, { left: e?.clientX || 0, right: e?.clientX || 0, top: e?.clientY || 0, bottom: e?.clientY || 0 });
  setTimeout(() => {
    const closer = (ev) => {
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAny) { closeColHeaderMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function showColHeaderMenu(e, propName, colIndex) {
  closeColHeaderMenu();
  closeAllDropdowns();
  const dbPath = state.currentDbPath;
  const pinnedCols = getPinnedCols(dbPath);
  const groupBy = getGroupBy(dbPath);

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  // 上部にリネーム入力欄: 列名変更（startHeaderInlineRename と同じロジック）
  _addMenuRenameInput(menu, propName, async (newName) => {
    if (typeof renameDbProperty === 'function') {
      await renameDbProperty(dbPath, propName, newName);
    }
    // 列選択状態の追従（選択列がリネームされた場合）
    if (typeof _getSelectedColumns === 'function' && typeof _setSelectedColumns === 'function') {
      const selected = _getSelectedColumns(dbPath).map(name => name === propName ? newName : name);
      _setSelectedColumns(dbPath, selected, newName);
    }
    if (typeof renderPivot === 'function') renderPivot();
  }, { placeholder: '列名を変更...' });

  const currentPtc = getPropertyTypes(dbPath)[propName] || { type: 'text' };
  const currentType = currentPtc.type || 'text';
  const currentUiType = typeof getPropertyTypeUiBaseType === 'function' ? getPropertyTypeUiBaseType(currentType) : currentType;

  // プロパティ型サブメニュー項目
  const typeItems = getPropertyTypeMenuItems();

  const items = [
    // プロパティ型（サブメニュー展開）— 選択時は型のみ変更、設定モーダルは開かない
    { type: 'submenu', label: lucide(getPropertyTypeIcon(currentType) || PROP_TYPE_ICON[currentType] || 'alignLeft', 14) + ' プロパティ型の変更',
      children: typeItems.map(ti => ({
        label: (ti.type === currentUiType ? radioMark(true) : '\u3000') + lucide(ti.icon, 14) + ' ' + ti.label,
        action: () => {
          if (ti.type === currentUiType && currentType === currentUiType) return;
          let opts = undefined;
          if (ti.type === 'select' || ti.type === 'multi-select') {
            const existingValues = new Set();
            if (state.pivotData) {
              Object.values(state.pivotData.entities).forEach(ent => {
                (ent[propName] || []).forEach(v => existingValues.add(v.value));
              });
            }
            opts = [...existingValues];
          }
          const cfg = { type: ti.type };
          if (opts) cfg.options = opts;
          if (ti.type === 'number' && currentPtc.unit) cfg.unit = currentPtc.unit;
          setPropertyType(dbPath, propName, cfg);
          renderPivot();
        }
      }))
    },
    // プロパティ型の設定（relation先DB・数式・ボタン等の詳細設定）
    { label: lucide('settings', 14) + ' プロパティ型の設定...', action: () => showPropertyTypeModal(propName) },
    { type: 'sep' },
    // 並び替え（この列を基準に）
    { type: 'submenu', label: lucide('arrowUpDown', 14) + ' 並び替え', children: (() => {
      const sc = getDbViewConfig(dbPath).sortConfig || { key: 'name', dir: 'asc' };
      return [
        { label: (sc.key === propName && sc.dir === 'asc' ? radioMark(true) : '　') + 'この列で昇順', action: () => { const c = getDbViewConfig(dbPath); c.sortConfig = { key: propName, dir: 'asc' }; saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 並び替え', historyDetail: propName + ' 昇順' }); renderPivot(); }},
        { label: (sc.key === propName && sc.dir === 'desc' ? radioMark(true) : '　') + 'この列で降順', action: () => { const c = getDbViewConfig(dbPath); c.sortConfig = { key: propName, dir: 'desc' }; saveDbViewConfig(dbPath, c, { historyLabel: 'シート表示: 並び替え', historyDetail: propName + ' 降順' }); renderPivot(); }},
      ];
    })() },
    { type: 'submenu', label: 'このプロパティでグループ化', children: [
      { label: (groupBy === propName ? radioMark(true) : '　') + 'グループ化する', action: () => { setGroupBy(dbPath, propName); renderPivot(); }},
      { label: (groupBy !== propName ? radioMark(true) : '　') + 'グループ化しない', action: () => { setGroupBy(dbPath, null); renderPivot(); }},
    ]},
    { type: 'sep' },
    // 列操作サブメニュー
    { type: 'submenu', label: lucide('columns', 14) + ' 列操作',
      children: [
        { label: '\u2190 左に列を挿入', action: () => insertPropertyInline(propName, 'left') },
        { label: '\u2192 右に列を挿入', action: () => insertPropertyInline(propName, 'right') },
        { label: lucide('ruler', 14) + ' 列幅を数値指定...', action: () => _showBulkColumnWidthModal(propName) },
        { type: 'submenu', label: '列を固定', children: [
          { label: (pinnedCols.includes(propName) ? radioMark(true) : '　') + '固定する', action: () => {
            const pc = getPinnedCols(dbPath);
            if (!pc.includes(propName)) setPinnedCols(dbPath, [...pc, propName]);
            renderPivot();
          }},
          { label: (!pinnedCols.includes(propName) ? radioMark(true) : '　') + '固定しない', action: () => {
            const pc = getPinnedCols(dbPath);
            if (pc.includes(propName)) setPinnedCols(dbPath, pc.filter(c => c !== propName));
            renderPivot();
          }},
        ]},
        { label: 'この列を非表示', action: () => {
          const hc = getHiddenCols(dbPath);
          if (!hc.includes(propName)) setHiddenCols(dbPath, [...hc, propName]);
          renderPivot();
        }},
      ]
    },
    { label: '条件付きカラー...', action: () => showConditionalColorModal(propName) },
  ];

  // 編集制限サブメニュー
  const curLock = getColumnLock(dbPath, propName);
  const lockLabels = [
    { key: 'none',   label: '制限なし',       icon: 'lockOpen' },
    { key: 'admin',  label: '管理者のみ編集', icon: 'shield' },
    { key: 'locked', label: 'ロック',         icon: 'lock' },
  ];
  const curLockLabel = lockLabels.find(l => l.key === curLock)?.label || '制限なし';
  items.push({ type: 'sep' });
  items.push({
    type: 'submenu',
    label: lucide(curLock === 'locked' ? 'lock' : curLock === 'admin' ? 'shield' : 'lockOpen', 14) + ' 編集制限: ' + curLockLabel,
    children: lockLabels.map(l => ({
      label: (curLock === l.key ? radioMark(true) : '\u3000') + lucide(l.icon, 14) + ' ' + l.label,
      action: () => { setColumnLock(dbPath, propName, l.key); renderPivot(); }
    }))
  });

  // date型: ステータス連動設定
  if (currentType === 'date') {
    const curAuto = currentPtc.autoFillOnStatus || '';
    items.push({ type: 'sep' });
    items.push({
      label: lucide('clock', 14) + ' ステータス連動' + (curAuto ? ': ' + curAuto : ''),
      action: () => {
        _showAutoFillStatusInput(dbPath, propName, currentPtc, curAuto);
      }
    });
