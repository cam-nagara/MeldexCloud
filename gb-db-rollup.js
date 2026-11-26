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
    // 参照先シートが保存先の外や見つからない時は、リレーション一覧と同じ静かな確認で空として扱う。
    const data = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath), {
      silentError: true,
      headers: { 'X-Meldex-Relation-Probe': 'true' },
    });
    if (data?.relation_target_unavailable) return null;
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
  filterMode = typeof _dbStatusFilterMode === 'function'
    ? _dbStatusFilterMode(sourceDbPath || state.currentDbPath || '', filterMode) : filterMode;
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
  filterMode = typeof _dbStatusFilterMode === 'function'
    ? _dbStatusFilterMode(sourceDbPath || state.currentDbPath || '', filterMode) : filterMode;
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
  // 参照先の型取得前も保存済み設定を保持する（別シートの列はまだ型が無い）。
  if (current?.aggregation && !aggOptions.some(a => a.key === current.aggregation)) {
    aggOptions.push({ key: current.aggregation, label: current.aggregation });
  }

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
  html += '<select id="rollup-target-prop"><option value="' + esc(current?.targetProp || '') + '">'
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
  sel.replaceChildren(new Option('読み込み中...', preselect || ''));

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
  // 未表示の別シートでも型を解決する。取得失敗時に既存の集計設定を文字列へ上書きしない。
  let targetMetadata;
  try {
    targetMetadata = typeof _getDbMetadataCached === 'function'
      ? await _getDbMetadataCached(_relDb, true) : null;
  } catch (error) {
    console.warn('[Meldex] 集計の参照先シートの列設定を読み込めませんでした', error);
    if (seq === scope._rollupRelationLoadSeq) {
      sel.replaceChildren(new Option('(取得失敗)', preselect || ''));
      if (typeof showStatus === 'function') {
        showStatus('参照先シートの列を読み込めませんでした: ' + (error?.message || error), true);
      }
    }
    return;
  }
  if (seq !== scope._rollupRelationLoadSeq || sel !== (typeof _ptGet === 'function' ? _ptGet('rollup-target-prop', scope) : document.getElementById('rollup-target-prop'))) return;
  if (!targetData || !targetData.properties) {
    sel.replaceChildren(new Option('(取得失敗)', preselect || ''));
    return;
  }

  const targetPropTypes = _rollupTargetPropertyTypes(_relDb, targetMetadata || targetData);
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
  // 読込待ちの間にも表示方法を変更できる。開始時の保存値で利用者の選択を戻さない。
  _rollupSetAggregationOptionsForType(selectedType, aggSel?.value || aggSel?.dataset.current || 'values', scope);
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
  // localStorage は編集した列だけの部分キャッシュ。完全なバックエンド型定義を優先する。
  return typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) :
    (getDbViewConfig(dbPath).propertyTypes || {});
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

/* --- ロールアップのセルへの直接入力（2026-11-19） --- */
// 「値をそのまま表示」のロールアップは、参照先トピックの列の値をそのまま出しているので、
// セルに入力した値を参照先シートのその列へ書き込む。参照先が複数ある時は、
// ダブルクリックした行（行合わせの何番目か）か、1件だけの時に限って編集する。
// 件数・合計などの集計結果は、参照先のどの値を変えればよいか決まらないため編集しない。
function _rollupEditTarget(td, ctx, groupIndex) {
  const dbPath = (ctx && ctx.dbPath) || state.currentDbPath || '';
  const propName = td?.dataset?.propName || '';
  const entityName = td?.closest?.('tr')?.dataset?.entityName || '';
  const propTypes = typeof getPropertyTypes === 'function' ? (getPropertyTypes(dbPath, ctx) || {}) : {};
  const ptc = propTypes[propName];
  if (!dbPath || !propName || !entityName || ptc?.type !== 'rollup') return { error: '' };
  if (!ptc.relationProp || !ptc.targetProp) return { error: '列の設定でリレーション列と参照先の列を選ぶと、入力できます' };
  if (_rollupEffectiveAggregation(ptc) !== 'values') {
    return { error: '集計した値（件数・合計など）は直接入力できません。参照先のシートで値を変えてください' };
  }
  const entitiesMap = ((ctx && ctx.pivotData) || state.pivotData)?.entities || {};
  const { refs, targetDbPath } = resolveRelationNames(entityName, entitiesMap, ptc.relationProp, propTypes, dbPath, ctx?.filter);
  if (!targetDbPath) return { error: 'リレーション列の参照先シートが見つかりません' };
  if (!refs.length) return { error: `先に「${ptc.relationProp}」で参照先を選ぶと、ここへ入力した値が参照先へ入ります` };
  if (refs.length > 1 && !Number.isInteger(groupIndex)) {
    return { error: '参照先が複数あります。編集する行をダブルクリックしてください' };
  }
  const ref = refs[Number.isInteger(groupIndex) ? groupIndex : 0];
  if (!ref) return { error: '' };
  return { dbPath, propName, entityName, ptc, targetDbPath, ref };
}

async function startRollupCellEdit(td, options = {}) {
  // 打ち始めの一時入力欄を受け取った時は、編集を始められなければ片付ける
  const proxy = options.input || null;
  if (proxy) proxy.dataset.adopted = '1';
  const started = await _startRollupCellEditInner(td, options);
  if (!started && proxy?.isConnected) {
    proxy.remove();
    if (td._dbTypedProxy === proxy) td._dbTypedProxy = null;
    if (typeof setActiveCell === 'function' && td.isConnected) setActiveCell(td, { scroll: false });
  }
  return started;
}

async function _startRollupCellEditInner(td, options = {}) {
  const ctx = typeof _dbPaneContextFromEvent === 'function'
    ? _dbPaneContextFromEvent(td, { dbPath: state.currentDbPath })
    : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const target = _rollupEditTarget(td, ctx, options.groupIndex);
  if (!target.targetDbPath) {
    if (target.error && typeof showStatus === 'function') showStatus(target.error, true);
    return false;
  }
  const { dbPath, ptc, targetDbPath, ref } = target;
  const lockMsg = typeof checkColumnEditable === 'function' ? checkColumnEditable(targetDbPath, ptc.targetProp, null) : '';
  if (lockMsg) { if (typeof showStatus === 'function') showStatus(lockMsg, true); return false; }
  const container = td.querySelector('.cell-values');
  if (!container || (container.querySelector('.cell-inline-input') && !options.input)) return false;
  const targetData = await fetchRelatedDbData(targetDbPath);
  const targetName = _rollupResolveEntityNames([ref.name], targetData)[0] || ref.name;
  const targetEntity = targetData?.entities?.[targetName];
  if (!targetEntity) {
    if (typeof showStatus === 'function') showStatus(`参照先のトピック「${targetName}」が見つかりません`, true);
    return false;
  }
  const raw = Array.isArray(targetEntity[ptc.targetProp]) ? targetEntity[ptc.targetProp] : [];
  const adopted = typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(raw) : raw[0];
  const oldValue = String(adopted?.value ?? '');
  if (!td.isConnected) return false;
  const input = options.input || document.createElement('input');
  input.type = 'text';
  input.className = 'cell-inline-input';
  if (td._dbTypedProxy === input) td._dbTypedProxy = null;
  input.dataset.e2eId = 'db-rollup-inline-input';
  input.setAttribute('aria-label', `${targetName} の ${ptc.targetProp}（参照先シート）`);
  if (!options.input) input.value = options.seed != null ? String(options.seed) : oldValue;
  input.style.cssText = 'width:100%;box-sizing:border-box;padding:2px 4px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:13px;';
  // 編集中は表示中の値と入れ替え、同じ高さに収める（値の下へ入力欄を足すと行が伸び、下の行がずれた。
  // UI共通ルール §10、2026-11-20 状態の総当たり検査で検出）。
  const shownValues = Array.from(container.children).filter(el => el !== input && el.getClientRects?.().length);
  const shownHeight = shownValues.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
  shownValues.forEach(el => { el.dataset.dbRollupEditHidden = el.style.display || '-'; el.style.display = 'none'; });
  if (shownHeight > 0) {
    input.style.height = shownHeight + 'px';
    input.style.minHeight = '0';
  }
  if (input.parentNode !== container) container.appendChild(input);
  input.focus();
  if (options.seed == null && !options.input) input.select();
  let done = false;
  const pos = typeof _cellPos === 'function' ? _cellPos(td) : null;
  let moveTo = null;
  const finish = () => {
    done = true;
    input.remove();
    shownValues.forEach(el => {
      const before = el.dataset.dbRollupEditHidden;
      delete el.dataset.dbRollupEditHidden;
      el.style.display = before === '-' ? '' : before;
    });
    if (typeof setActiveCell === 'function' && td.isConnected) setActiveCell(td, { scroll: false });
  };
  const refresh = async () => {
    clearRollupCache(targetDbPath);
    if (typeof selectDatabase === 'function') await selectDatabase(dbPath, ctx || undefined, { silent: true, forceReload: true });
  };
  const commit = async () => {
    if (done) return;
    const value = input.value;
    finish();
    if (value === oldValue) {
      if (moveTo && pos && typeof _restoreCellPos === 'function') _restoreCellPos(pos, moveTo);
      return;
    }
    const entityPath = _entityPath(targetDbPath, targetName, targetData);
    const scope = typeof _dbScope === 'function' ? _dbScope(dbPath) : '';
    const label = `${ptc.targetProp}（${targetName}）: ${oldValue} → ${value}`;
    try {
      if (adopted) {
        await _apiPutValue(adopted, { new_value: value });
        adopted.value = value;
        if (typeof historyPush === 'function') historyPush(label,
          async () => { await _apiPutValue(adopted, { new_value: oldValue }); adopted.value = oldValue; await refresh(); },
          async () => { await _apiPutValue(adopted, { new_value: value }); adopted.value = value; await refresh(); },
          scope);
      } else {
        const result = await _apiPostValue(entityPath, ptc.targetProp, value, '採用', '');
        let added = {
          value, status: '採用', file: result?.path || result?.file || entityPath, property: ptc.targetProp,
          candidate_id: result?.candidate_id, entry_id: result?.entry_id, candidate_index: result?.candidate_index ?? raw.length,
        };
        if (typeof historyPush === 'function') historyPush(label,
          async () => { await _apiPutValue(added, { _delete: true }); await refresh(); },
          async () => {
            const redo = await _apiPostValue(entityPath, ptc.targetProp, value, '採用', '');
            added = { ...added, file: redo?.path || redo?.file || added.file, candidate_id: redo?.candidate_id,
              entry_id: redo?.entry_id, candidate_index: redo?.candidate_index ?? added.candidate_index };
            await refresh();
          },
          scope);
      }
      if (typeof showStatus === 'function') showStatus(`参照先「${targetName}」の${ptc.targetProp}を保存しました`);
    } catch (error) {
      if (typeof showStatus === 'function') showStatus('参照先への保存に失敗しました: ' + (error?.message || error), true);
    }
    await refresh();
    if (pos && typeof _restoreCellPos === 'function') _restoreCellPos(pos, moveTo);
  };
  input.addEventListener('keydown', (event) => {
    if (typeof _dbInlineIsComposing === 'function' && _dbInlineIsComposing(event)) return;
    if (typeof _dbInlineConsumeImeBoundaryKey === 'function' && _dbInlineConsumeImeBoundaryKey(event)) return;
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.(); commit(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.(); finish(); }
    else if (event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
      moveTo = event.shiftKey ? 'left' : 'right';
      commit();
    }
  });
  if (typeof attachInlineBlurCommit === 'function') attachInlineBlurCommit(input, commit);
  else input.addEventListener('blur', commit);
  return true;
}
