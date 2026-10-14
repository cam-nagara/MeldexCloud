/* ==============================
   gb-db-rollup.js: ロールアッププロパティ＋リレーション解決キャッシュ
   リレーション先DBの値を集計するプロパティ型を提供
   ============================== */

/* --- リレーション解決キャッシュ --- */
const _rollupCache = new Map();
let _rollupRelationLoadSeq = 0;

/**
 * リレーション先DBのpivotDataを取得（キャッシュ付き）
 */
async function fetchRelatedDbData(dbPath) {
  if (!dbPath) return null;
  const cached = _rollupCache.get(dbPath);
  const fresh = typeof _dbCacheIsFresh === 'function'
    ? _dbCacheIsFresh(cached, 'rollup')
    : cached && Date.now() - cached.timestamp < 30000;
  if (fresh) {
    return cached.data;
  }
  try {
    const data = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath));
    _rollupCache.set(dbPath, { data, timestamp: Date.now() });
    return data;
  } catch (e) {
    return null;
  }
}

/**
 * キャッシュをクリアする
 */
function clearRollupCache(dbPath) {
  if (dbPath) _rollupCache.delete(dbPath);
  else _rollupCache.clear();
}

/* --- リレーション解決 --- */

/**
 * エントリのリレーション値を解決し、参照先エントリ名の配列を返す
 */
function resolveRelationNames(entityName, entitiesMap, relationPropName, propTypes, sourceDbPath, filterMode) {
  const ptc = propTypes?.[relationPropName];
  if (!ptc || (ptc.type !== 'relation' && ptc.type !== 'multi-relation')) return { names: [], refs: [], targetDbPath: null };

  // リレーションセルと同じ解決規則を使い、作品フォルダー相対パスも同じ参照先へ揃える
  const effectiveSourcePath = sourceDbPath || state.currentDbPath || '';
  const targetDbPath = typeof _dbResolveRelationDbPath === 'function'
    ? _dbResolveRelationDbPath(effectiveSourcePath, ptc)
    : ((ptc.relationDb === '' || ptc.relationDb == null) ? effectiveSourcePath : ptc.relationDb);
  if (!targetDbPath) return { names: [], refs: [], targetDbPath: null };

  const rawVals = entitiesMap[entityName]?.[relationPropName] || [];
  const vals = filterValues(rawVals, undefined, filterMode);
  const refs = [];
  vals.forEach((v, filteredIndex) => {
    if (!v.value) return;
    const sourceIndex = rawVals.indexOf(v);
    const candidateIndex = sourceIndex >= 0 ? sourceIndex : filteredIndex;
    const addRef = (name) => {
      if (!name) return;
      refs.push({
        name,
        status: v.status || '採用',
        candidateIndex,
      });
    };
    // multi-relationの場合、カンマ区切りの可能性
    if (ptc.type === 'multi-relation') {
      v.value.split(',').forEach(n => addRef(n.trim()));
    } else {
      addRef(v.value.trim());
    }
  });
  return { names: refs.map(ref => ref.name), refs, targetDbPath };
}

function _rollupIdToNameMap(targetData) {
  const map = new Map();
  Object.entries(targetData?.entities || {}).forEach(([name, props]) => {
    if (props?._id) map.set(String(props._id), name);
  });
  return map;
}

function _rollupResolveEntityNames(names, targetData) {
  const idToName = _rollupIdToNameMap(targetData);
  return names.map(n => idToName.get(String(n)) || n);
}

function _rollupEffectiveAggregation(rollupConfig) {
  return rollupConfig?.aggregation || 'values';
}

function _rollupValuesResult(relationProp, targetDbPath, groups) {
  const normalizedGroups = (groups || []).map(group => ({
    relationId: String(group?.relationId || ''),
    relationName: String(group?.relationName || group?.relationId || '—'),
    relationStatus: String(group?.relationStatus || '採用'),
    relationCandidateIndex: Number.isInteger(group?.relationCandidateIndex) ? group.relationCandidateIndex : 0,
    values: Array.isArray(group?.values) && group.values.length
      ? group.values.map(value => String(value == null || value === '' ? '—' : value))
      : ['—'],
  }));
  const text = normalizedGroups.length
    ? normalizedGroups.flatMap(group => group.values).join('\n')
    : '—';
  return {
    kind: 'rollup-values',
    relationProp: relationProp || '',
    targetDbPath: targetDbPath || '',
    groups: normalizedGroups,
    text,
    toString() { return this.text; },
  };
}

function _rollupSplitDisplayValue(value, propType) {
  const text = String(value == null ? '' : value);
  if (!text.trim()) return [];
  const byLine = text.split(/\r?\n/).map(part => part.trim()).filter(Boolean);
  if (!['multi-select', 'multi-user', 'multi-relation'].includes(propType)) return byLine;
  return byLine.flatMap(part => part.split(',').map(item => item.trim()).filter(Boolean));
}

function _rollupImageDisplayStrings(rawValue) {
  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map(item => {
      if (typeof item === 'string') return item;
      return item?.caption || item?.name || item?.filename || item?.path || item?.url || '';
    }).filter(Boolean);
  } catch {
    return _rollupSplitDisplayValue(rawValue, 'text');
  }
}

async function _rollupResolveTargetRelationStrings(values, targetPtc, targetDbPath) {
  const relationDbPath = typeof _dbResolveRelationDbPath === 'function'
    ? _dbResolveRelationDbPath(targetDbPath, targetPtc)
    : ((targetPtc?.relationDb === '' || targetPtc?.relationDb == null) ? targetDbPath : targetPtc?.relationDb);
  if (!relationDbPath) return values;
  const relationData = await fetchRelatedDbData(relationDbPath);
  if (!relationData?.entities) return values;
  const idToName = _rollupIdToNameMap(relationData);
  return values.map(value => idToName.get(String(value)) || value);
}

async function _rollupTargetDisplayStrings(entityData, targetProp, targetPtc, targetPropTypes, targetDbPath, filterMode) {
  if (!entityData) return ['—'];

  const metadataSource = typeof _dbPropertyMetadataSource === 'function'
    ? _dbPropertyMetadataSource(targetPtc)
    : (['created', 'modified', 'modified_by'].includes(targetPtc?.source) ? targetPtc.source : '');
  if (metadataSource) {
    const sourceValue = entityData['_' + metadataSource];
    if (sourceValue == null || sourceValue === '') return ['—'];
    if ((metadataSource === 'created' || metadataSource === 'modified')
        && typeof _formatDateDisplay === 'function') {
      return [_formatDateDisplay(String(sourceValue), targetPtc)];
    }
    return [String(sourceValue)];
  }

  if (targetPtc?.type === 'formula' && targetPtc.formula && typeof formulaEvalForEntity === 'function') {
    const result = formulaEvalForEntity(targetPtc.formula, entityData, { propTypes: targetPropTypes, dbPath: targetDbPath });
    return result?.error || result?.value == null || result.value === '' ? ['—'] : [String(result.value)];
  }

  const rawValues = Array.isArray(entityData[targetProp]) ? entityData[targetProp] : [];
  const filtered = typeof filterValues === 'function'
    ? filterValues(rawValues, undefined, filterMode)
    : rawValues;
  let displayValues = [];
  filtered.forEach(item => {
    const rawValue = item?.value;
    if (targetPtc?.type === 'image') displayValues.push(..._rollupImageDisplayStrings(rawValue));
    else displayValues.push(..._rollupSplitDisplayValue(rawValue, targetPtc?.type || 'text'));
  });
  if (!displayValues.length) return ['—'];

  if (targetPtc?.type === 'relation' || targetPtc?.type === 'multi-relation') {
    displayValues = await _rollupResolveTargetRelationStrings(displayValues, targetPtc, targetDbPath);
  } else if (targetPtc?.type === 'date' && typeof _formatDateDisplay === 'function') {
    displayValues = displayValues.map(value => _formatDateDisplay(value, targetPtc));
  }
  return displayValues.length ? displayValues : ['—'];
}

async function _rollupBuildValuesResult(refs, targetData, targetDbPath, relationProp, targetProp, filterMode) {
  const names = refs.map(ref => ref.name);
  const targetNames = _rollupResolveEntityNames(names, targetData);
  const targetPropTypes = getPropertyTypes(targetDbPath);
  const targetPtc = targetPropTypes?.[targetProp] || null;
  const groups = [];

  for (let idx = 0; idx < names.length; idx++) {
    const relationId = names[idx];
    const relationName = targetNames[idx] || relationId;
    const values = await _rollupTargetDisplayStrings(
      targetData?.entities?.[relationName],
      targetProp,
      targetPtc,
      targetPropTypes,
      targetDbPath,
      filterMode
    );
    groups.push({
      relationId,
      relationName,
      relationStatus: refs[idx]?.status || '採用',
      relationCandidateIndex: refs[idx]?.candidateIndex || 0,
      values,
    });
  }
  return _rollupValuesResult(relationProp, targetDbPath, groups);
}

/* --- ロールアップ計算 --- */

/**
 * 1エントリのロールアップ値を計算する
 */
async function calcRollupValue(entityName, entitiesMap, rollupConfig, propTypes, sourceDbPath, filterMode) {
  const { relationProp, targetProp } = rollupConfig;
  const aggregation = _rollupEffectiveAggregation(rollupConfig);
  const { names, refs, targetDbPath } = resolveRelationNames(entityName, entitiesMap, relationProp, propTypes, sourceDbPath, filterMode);
  if (names.length === 0 || !targetDbPath) {
    return aggregation === 'count'
      ? 0
      : (aggregation === 'values' ? _rollupValuesResult(relationProp, targetDbPath, []) : '-');
  }

  const targetData = await fetchRelatedDbData(targetDbPath);
  if (!targetData || !targetData.entities) {
    return aggregation === 'values'
      ? _rollupValuesResult(relationProp, targetDbPath, refs.map(ref => ({
          relationId: ref.name,
          relationName: ref.name,
          relationStatus: ref.status,
          relationCandidateIndex: ref.candidateIndex,
          values: ['—'],
        })))
      : '-';
  }

  if (aggregation === 'values') {
    return _rollupBuildValuesResult(refs, targetData, targetDbPath, relationProp, targetProp, filterMode);
  }

  const targetNames = _rollupResolveEntityNames(names, targetData);

  // countの場合はリレーション先エントリ数を返す
  if (aggregation === 'count') {
    return targetNames.filter(n => targetData.entities[n]).length;
  }

  // 参照先エントリのサブセットで集計
  const subMap = {};
  const subNames = [];
  targetNames.forEach(n => {
    if (targetData.entities[n]) {
      subMap[n] = targetData.entities[n];
      subNames.push(n);
    }
  });

  if (subNames.length === 0) return '-';

  const targetPropTypes = getPropertyTypes(targetDbPath);
  const targetPtc = targetPropTypes?.[targetProp] || null;

  return calcAggregation(targetProp, subMap, subNames, aggregation, targetPtc, targetPropTypes, filterMode);
}

/**
 * DB全体のロールアップ値を一括計算（バッチ最適化）
 * @returns {Promise<Map<string, string|number>>} entityName → 集計値
 */
async function calcRollupColumn(entitiesMap, entityNames, rollupConfig, propTypes, sourceDbPath, filterMode) {
  const { relationProp, targetProp } = rollupConfig;
  const aggregation = _rollupEffectiveAggregation(rollupConfig);
  const results = new Map();

  // 参照先DBを1回だけ取得
  const sampleEntity = entityNames[0];
  if (!sampleEntity) return results;
  const { targetDbPath } = resolveRelationNames(sampleEntity, entitiesMap, relationProp, propTypes, sourceDbPath, filterMode);
  if (!targetDbPath) {
    entityNames.forEach(en => results.set(
      en,
      aggregation === 'values' ? _rollupValuesResult(relationProp, '', []) : '-'
    ));
    return results;
  }

  const targetData = await fetchRelatedDbData(targetDbPath);
  if (!targetData || !targetData.entities) {
    entityNames.forEach(en => results.set(
      en,
      aggregation === 'values' ? _rollupValuesResult(relationProp, targetDbPath, []) : '-'
    ));
    return results;
  }

  const targetPropTypes = getPropertyTypes(targetDbPath);
  const targetPtc = targetPropTypes?.[targetProp] || null;

  for (const en of entityNames) {
    const { names, refs } = resolveRelationNames(en, entitiesMap, relationProp, propTypes, sourceDbPath, filterMode);
    if (names.length === 0) {
      results.set(
        en,
        aggregation === 'count'
          ? 0
          : (aggregation === 'values' ? _rollupValuesResult(relationProp, targetDbPath, []) : '-')
      );
      continue;
    }

    if (aggregation === 'values') {
      results.set(en, await _rollupBuildValuesResult(refs, targetData, targetDbPath, relationProp, targetProp, filterMode));
      continue;
    }

    const targetNames = _rollupResolveEntityNames(names, targetData);

    if (aggregation === 'count') {
      results.set(en, targetNames.filter(n => targetData.entities[n]).length);
      continue;
    }

    const subMap = {};
    const subNames = [];
    targetNames.forEach(n => {
      if (targetData.entities[n]) {
        subMap[n] = targetData.entities[n];
        subNames.push(n);
      }
    });

    if (subNames.length === 0) {
      results.set(en, '-');
      continue;
    }

    const val = calcAggregation(targetProp, subMap, subNames, aggregation, targetPtc, targetPropTypes, filterMode);
    results.set(en, val);
  }

  return results;
}

/* --- UI: ロールアッププロパティ型設定 --- */

/**
 * プロパティ型モーダル内のロールアップ設定HTMLを生成
 */
function buildRollupOptionsHtml(current, dbProperties, propTypes, root) {
  // リレーション型プロパティのみフィルタ
  const relationProps = dbProperties.filter(p => {
    const pt = propTypes?.[p];
    return pt && (pt.type === 'relation' || pt.type === 'multi-relation');
  });

  const initialTargetType = current?.targetProp ? propTypes?.[current.targetProp]?.type : '';
  const aggOptions = _rollupAggregationOptionsForType(initialTargetType);

  // リレーション列が1つも無いシートでは、空のドロップダウンを出すと
  // 「選べないのに理由が分からない」状態になるため、その場で理由を出す。
  const hasRelationProps = relationProps.length > 0;

  let html = '<div class="field"><label>リレーション列</label>';
  html += '<select id="rollup-relation-prop"' + (hasRelationProps ? '' : ' disabled') + '>';
  if (!hasRelationProps) {
    html += '<option value="">リレーション列がありません</option>';
  } else {
    html += '<option value="">選択...</option>';
    relationProps.forEach(p => {
      const sel = current?.relationProp === p ? ' selected' : '';
      html += '<option value="' + esc(p) + '"' + sel + '>' + esc(p) + '</option>';
    });
  }
  html += '</select>';
  if (!hasRelationProps) {
    html += '<div class="pt-hint">先にリレーション列を作ると、その参照先を集計できます。</div>';
  }
  html += '</div>';

  html += '<div class="field"><label>参照先の列</label>';
  html += '<select id="rollup-target-prop"><option value="">'
       + (current?.relationProp ? '読み込み中...' : 'リレーション列を選ぶと表示されます')
       + '</option></select></div>';

  html += '<div class="field"><label>表示方法</label>';
  html += '<select id="rollup-aggregation" data-current="' + esc(current?.aggregation || 'values') + '">';
  aggOptions.forEach(a => {
    const sel = (current?.aggregation || 'values') === a.key ? ' selected' : '';
    html += '<option value="' + a.key + '"' + sel + '>' + a.label + '</option>';
  });
  html += '</select></div>';

  // 初期ロード: 既存設定があれば参照先プロパティをロード
  if (current?.relationProp) {
    setTimeout(() => onRollupRelationChange(current.relationProp, current.targetProp, root), 100);
  }

  return html;
}

/**
 * リレーションプロパティ選択時に参照先DBのプロパティ一覧を動的取得
 */
async function onRollupRelationChange(relationPropName, preselect, root) {
  const scope = typeof _ptResolveRoot === 'function' ? _ptResolveRoot(root) : (root || document);
  const sel = typeof _ptGet === 'function' ? _ptGet('rollup-target-prop', scope) : document.getElementById('rollup-target-prop');
  if (!sel) return;
  const seq = (scope._rollupRelationLoadSeq || 0) + 1;
  scope._rollupRelationLoadSeq = seq;
  _rollupRelationLoadSeq++;
  sel.innerHTML = '<option value="">読み込み中...</option>';

  const dbPath = (typeof _ptState === 'function' ? _ptState(scope).dbPath : '') || state.currentDbPath;
  const propTypes = getPropertyTypes(dbPath);
  const ptc = propTypes?.[relationPropName];
  if (!ptc) {
    if (seq !== scope._rollupRelationLoadSeq) return;
    sel.innerHTML = '<option value="">(リレーション先未設定)</option>';
    _rollupSetAggregationOptionsForType('', 'values', scope);
    return;
  }
  const _relDb = typeof _dbResolveRelationDbPath === 'function'
    ? _dbResolveRelationDbPath(dbPath, ptc)
    : ((ptc.relationDb === '' || ptc.relationDb == null) ? dbPath : ptc.relationDb);
  const targetData = await fetchRelatedDbData(_relDb);
  if (seq !== scope._rollupRelationLoadSeq || sel !== (typeof _ptGet === 'function' ? _ptGet('rollup-target-prop', scope) : document.getElementById('rollup-target-prop'))) return;
  if (!targetData || !targetData.properties) {
    sel.innerHTML = '<option value="">(取得失敗)</option>';
    _rollupSetAggregationOptionsForType('', 'values', scope);
    return;
  }

  const targetPropTypes = _rollupTargetPropertyTypes(_relDb, targetData);
  const targetProps = Array.from(new Set([
    ...(Array.isArray(targetData.properties) ? targetData.properties : []),
    ...Object.keys(targetPropTypes || {}),
    ...(preselect ? [preselect] : []),
  ])).filter(p => p && !String(p).startsWith('_'));
  sel.innerHTML = '';
  targetProps.forEach(p => {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = p;
    if (preselect === p) o.selected = true;
    sel.appendChild(o);
  });
  if (preselect && !targetProps.includes(preselect) && sel.options.length) sel.selectedIndex = 0;
  sel.onchange = () => {
    const pt = targetPropTypes?.[sel.value]?.type || '';
    const aggSel = typeof _ptGet === 'function' ? _ptGet('rollup-aggregation', scope) : document.getElementById('rollup-aggregation');
    _rollupSetAggregationOptionsForType(pt, aggSel?.value || 'values', scope);
  };
  const selectedType = targetPropTypes?.[sel.value]?.type || '';
  const aggSel = typeof _ptGet === 'function' ? _ptGet('rollup-aggregation', scope) : document.getElementById('rollup-aggregation');
  _rollupSetAggregationOptionsForType(selectedType, aggSel?.dataset.current || 'values', scope);
}

/**
 * ロールアップ設定を収集して返す
 */
function collectRollupConfig(root) {
  const scope = typeof _ptResolveRoot === 'function' ? _ptResolveRoot(root) : (root || document);
  const get = (id) => typeof _ptGet === 'function' ? _ptGet(id, scope) : document.getElementById(id);
  const relationProp = get('rollup-relation-prop')?.value || '';
  const targetProp = get('rollup-target-prop')?.value || '';
  const aggregation = get('rollup-aggregation')?.value || 'values';
  return { type: 'rollup', relationProp, targetProp, aggregation };
}

function _rollupAggregationOptionsForType(propType) {
  const valuesOption = { key: 'values', label: '文字列' };
  if (typeof getAggregationTypesForProperty === 'function') {
    return [
      valuesOption,
      ...getAggregationTypesForProperty(propType || 'text').filter(a => a.key !== 'none' && a.key !== 'values'),
    ];
  }
  return [
    valuesOption,
    { key: 'count', label: '件数' },
    { key: 'unique', label: 'ユニーク' },
    { key: 'empty', label: '空' },
    { key: 'not_empty', label: '非空' },
  ];
}

function _rollupTargetPropertyTypes(dbPath, targetData) {
  if (targetData?.property_types) return targetData.property_types;
  if (targetData?.propertyTypes) return targetData.propertyTypes;
  const localTypes = getDbViewConfig(dbPath).propertyTypes || {};
  if (Object.keys(localTypes).length) return localTypes;
  return typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : {};
}

function _rollupSetAggregationOptionsForType(propType, preferred, root) {
  const scope = typeof _ptResolveRoot === 'function' ? _ptResolveRoot(root) : (root || document);
  const aggSel = typeof _ptGet === 'function' ? _ptGet('rollup-aggregation', scope) : document.getElementById('rollup-aggregation');
  if (!aggSel) return;
  const options = _rollupAggregationOptionsForType(propType);
  const nextValue = options.some(a => a.key === preferred) ? preferred : 'values';
  aggSel.innerHTML = '';
  options.forEach(a => {
    const o = document.createElement('option');
    o.value = a.key;
    o.textContent = a.label;
    if (a.key === nextValue) o.selected = true;
    aggSel.appendChild(o);
  });
  aggSel.dataset.current = aggSel.value || nextValue;
  aggSel.onchange = () => { aggSel.dataset.current = aggSel.value; };
}
