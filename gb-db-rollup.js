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
  if (!ptc || (ptc.type !== 'relation' && ptc.type !== 'multi-relation')) return { names: [], targetDbPath: null };

  // 自己参照: relationDb が未設定または '' の場合は sourceDbPath (= 現在のDB) を指す
  const targetDbPath = (ptc.relationDb === '' || ptc.relationDb == null)
    ? (sourceDbPath || state.currentDbPath || null)
    : ptc.relationDb;
  if (!targetDbPath) return { names: [], targetDbPath: null };

  const rawVals = entitiesMap[entityName]?.[relationPropName] || [];
  const vals = filterValues(rawVals, undefined, filterMode);
  const names = [];
  vals.forEach(v => {
    if (!v.value) return;
    // multi-relationの場合、カンマ区切りの可能性
    if (ptc.type === 'multi-relation') {
      v.value.split(',').forEach(n => { const t = n.trim(); if (t) names.push(t); });
    } else {
      names.push(v.value.trim());
    }
  });
  return { names, targetDbPath };
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

/* --- ロールアップ計算 --- */

/**
 * 1エントリのロールアップ値を計算する
 */
async function calcRollupValue(entityName, entitiesMap, rollupConfig, propTypes, sourceDbPath, filterMode) {
  const { relationProp, targetProp, aggregation } = rollupConfig;
  const { names, targetDbPath } = resolveRelationNames(entityName, entitiesMap, relationProp, propTypes, sourceDbPath, filterMode);
  if (names.length === 0 || !targetDbPath) return aggregation === 'count' ? 0 : '-';

  const targetData = await fetchRelatedDbData(targetDbPath);
  if (!targetData || !targetData.entities) return '-';
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
  const { relationProp, targetProp, aggregation } = rollupConfig;
  const results = new Map();

  // 参照先DBを1回だけ取得
  const sampleEntity = entityNames[0];
  if (!sampleEntity) return results;
  const { targetDbPath } = resolveRelationNames(sampleEntity, entitiesMap, relationProp, propTypes, sourceDbPath, filterMode);
  if (!targetDbPath) {
    entityNames.forEach(en => results.set(en, '-'));
    return results;
  }

  const targetData = await fetchRelatedDbData(targetDbPath);
  if (!targetData || !targetData.entities) {
    entityNames.forEach(en => results.set(en, '-'));
    return results;
  }

  const targetPropTypes = getPropertyTypes(targetDbPath);
  const targetPtc = targetPropTypes?.[targetProp] || null;

  entityNames.forEach(en => {
    const { names } = resolveRelationNames(en, entitiesMap, relationProp, propTypes, sourceDbPath, filterMode);
    if (names.length === 0) {
      results.set(en, aggregation === 'count' ? 0 : '-');
      return;
    }
    const targetNames = _rollupResolveEntityNames(names, targetData);

    if (aggregation === 'count') {
      results.set(en, targetNames.filter(n => targetData.entities[n]).length);
      return;
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
      return;
    }

    const val = calcAggregation(targetProp, subMap, subNames, aggregation, targetPtc, targetPropTypes, filterMode);
    results.set(en, val);
  });

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

  let html = '<div class="field"><label>リレーション列</label>';
  html += '<select id="rollup-relation-prop">';
  html += '<option value="">選択...</option>';
  relationProps.forEach(p => {
    const sel = current?.relationProp === p ? ' selected' : '';
    html += '<option value="' + esc(p) + '"' + sel + '>' + esc(p) + '</option>';
  });
  html += '</select></div>';

  html += '<div class="field"><label>参照先の列</label>';
  html += '<select id="rollup-target-prop"><option value="">読み込み中...</option></select></div>';

  html += '<div class="field"><label>集計タイプ</label>';
  html += '<select id="rollup-aggregation" data-current="' + esc(current?.aggregation || 'count') + '">';
  aggOptions.forEach(a => {
    const sel = current?.aggregation === a.key ? ' selected' : '';
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
    _rollupSetAggregationOptionsForType('', 'count', scope);
    return;
  }
  // 自己参照: relationDb が未設定または '' の場合は現在のDBを指す
  const _relDb = (ptc.relationDb === '' || ptc.relationDb == null) ? dbPath : ptc.relationDb;
  const targetData = await fetchRelatedDbData(_relDb);
  if (seq !== scope._rollupRelationLoadSeq || sel !== (typeof _ptGet === 'function' ? _ptGet('rollup-target-prop', scope) : document.getElementById('rollup-target-prop'))) return;
  if (!targetData || !targetData.properties) {
    sel.innerHTML = '<option value="">(取得失敗)</option>';
    _rollupSetAggregationOptionsForType('', 'count', scope);
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
    _rollupSetAggregationOptionsForType(pt, aggSel?.value || 'count', scope);
  };
  const selectedType = targetPropTypes?.[sel.value]?.type || '';
  const aggSel = typeof _ptGet === 'function' ? _ptGet('rollup-aggregation', scope) : document.getElementById('rollup-aggregation');
  _rollupSetAggregationOptionsForType(selectedType, aggSel?.dataset.current || 'count', scope);
}

/**
 * ロールアップ設定を収集して返す
 */
function collectRollupConfig(root) {
  const scope = typeof _ptResolveRoot === 'function' ? _ptResolveRoot(root) : (root || document);
  const get = (id) => typeof _ptGet === 'function' ? _ptGet(id, scope) : document.getElementById(id);
  const relationProp = get('rollup-relation-prop')?.value || '';
  const targetProp = get('rollup-target-prop')?.value || '';
  const aggregation = get('rollup-aggregation')?.value || 'count';
  return { type: 'rollup', relationProp, targetProp, aggregation };
}

function _rollupAggregationOptionsForType(propType) {
  if (typeof getAggregationTypesForProperty === 'function') {
    return getAggregationTypesForProperty(propType || 'text').filter(a => a.key !== 'none');
  }
  return [
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
  const nextValue = options.some(a => a.key === preferred) ? preferred : 'count';
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
