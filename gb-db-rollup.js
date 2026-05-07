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
function resolveRelationNames(entityName, entitiesMap, relationPropName, propTypes, sourceDbPath) {
  const ptc = propTypes?.[relationPropName];
  if (!ptc || (ptc.type !== 'relation' && ptc.type !== 'multi-relation')) return { names: [], targetDbPath: null };

  // 自己参照: relationDb が未設定または '' の場合は sourceDbPath (= 現在のDB) を指す
  const targetDbPath = (ptc.relationDb === '' || ptc.relationDb == null)
    ? (sourceDbPath || state.currentDbPath || null)
    : ptc.relationDb;
  if (!targetDbPath) return { names: [], targetDbPath: null };

  const rawVals = entitiesMap[entityName]?.[relationPropName] || [];
  const vals = filterValues(rawVals);
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
async function calcRollupValue(entityName, entitiesMap, rollupConfig, propTypes) {
  const { relationProp, targetProp, aggregation } = rollupConfig;
  const { names, targetDbPath } = resolveRelationNames(entityName, entitiesMap, relationProp, propTypes);
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

  return calcAggregation(targetProp, subMap, subNames, aggregation, targetPtc);
}

/**
 * DB全体のロールアップ値を一括計算（バッチ最適化）
 * @returns {Promise<Map<string, string|number>>} entityName → 集計値
 */
async function calcRollupColumn(entitiesMap, entityNames, rollupConfig, propTypes) {
  const { relationProp, targetProp, aggregation } = rollupConfig;
  const results = new Map();

  // 参照先DBを1回だけ取得
  const sampleEntity = entityNames[0];
  if (!sampleEntity) return results;
  const { targetDbPath } = resolveRelationNames(sampleEntity, entitiesMap, relationProp, propTypes);
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
    const { names } = resolveRelationNames(en, entitiesMap, relationProp, propTypes);
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

    const val = calcAggregation(targetProp, subMap, subNames, aggregation, targetPtc);
    results.set(en, val);
  });

  return results;
}

/* --- UI: ロールアッププロパティ型設定 --- */

/**
 * プロパティ型モーダル内のロールアップ設定HTMLを生成
 */
function buildRollupOptionsHtml(current, dbProperties, propTypes) {
  // リレーション型プロパティのみフィルタ
  const relationProps = dbProperties.filter(p => {
    const pt = propTypes?.[p];
    return pt && (pt.type === 'relation' || pt.type === 'multi-relation');
  });

  const initialTargetType = current?.targetProp ? propTypes?.[current.targetProp]?.type : '';
  const aggOptions = _rollupAggregationOptionsForType(initialTargetType);

  let html = '<div class="field"><label>リレーションプロパティ</label>';
  html += '<select id="rollup-relation-prop" data-onchange="onRollupRelationChange(this.value)">';
  html += '<option value="">選択...</option>';
  relationProps.forEach(p => {
    const sel = current?.relationProp === p ? ' selected' : '';
    html += '<option value="' + esc(p) + '"' + sel + '>' + esc(p) + '</option>';
  });
  html += '</select></div>';

  html += '<div class="field"><label>参照先プロパティ</label>';
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
    setTimeout(() => onRollupRelationChange(current.relationProp, current.targetProp), 100);
  }

  return html;
}

/**
 * リレーションプロパティ選択時に参照先DBのプロパティ一覧を動的取得
 */
async function onRollupRelationChange(relationPropName, preselect) {
  const sel = document.getElementById('rollup-target-prop');
  if (!sel) return;
  const seq = ++_rollupRelationLoadSeq;
  sel.innerHTML = '<option value="">読み込み中...</option>';

  const dbPath = state.currentDbPath;
  const propTypes = getPropertyTypes(dbPath);
  const ptc = propTypes?.[relationPropName];
  if (!ptc) {
    if (seq !== _rollupRelationLoadSeq) return;
    sel.innerHTML = '<option value="">(リレーション先未設定)</option>';
    _rollupSetAggregationOptionsForType('', 'count');
    return;
  }
  // 自己参照: relationDb が未設定または '' の場合は現在のDBを指す
  const _relDb = (ptc.relationDb === '' || ptc.relationDb == null) ? dbPath : ptc.relationDb;
  const targetData = await fetchRelatedDbData(_relDb);
  if (seq !== _rollupRelationLoadSeq || sel !== document.getElementById('rollup-target-prop')) return;
  if (!targetData || !targetData.properties) {
    sel.innerHTML = '<option value="">(取得失敗)</option>';
    _rollupSetAggregationOptionsForType('', 'count');
    return;
  }

  const targetPropTypes = _rollupTargetPropertyTypes(_relDb, targetData);
  sel.innerHTML = '';
  targetData.properties.forEach(p => {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = p;
    if (preselect === p) o.selected = true;
    sel.appendChild(o);
  });
  if (preselect && !targetData.properties.includes(preselect) && sel.options.length) sel.selectedIndex = 0;
  sel.onchange = () => {
    const pt = targetPropTypes?.[sel.value]?.type || '';
    _rollupSetAggregationOptionsForType(pt, document.getElementById('rollup-aggregation')?.value || 'count');
  };
  const selectedType = targetPropTypes?.[sel.value]?.type || '';
  _rollupSetAggregationOptionsForType(selectedType, document.getElementById('rollup-aggregation')?.dataset.current || 'count');
}

/**
 * ロールアップ設定を収集して返す
 */
function collectRollupConfig() {
  const relationProp = document.getElementById('rollup-relation-prop')?.value || '';
  const targetProp = document.getElementById('rollup-target-prop')?.value || '';
  const aggregation = document.getElementById('rollup-aggregation')?.value || 'count';
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

function _rollupSetAggregationOptionsForType(propType, preferred) {
  const aggSel = document.getElementById('rollup-aggregation');
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
