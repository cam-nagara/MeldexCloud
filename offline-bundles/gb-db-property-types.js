/* マルチソースリレーション列のソース設定UI */

let _msrSourceIdSequence = 0;

function _msrCreateSourceId() {
  _msrSourceIdSequence += 1;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'msr-' + crypto.randomUUID();
  }
  return 'msr-' + Date.now().toString(36) + '-' + _msrSourceIdSequence.toString(36);
}

function _msrLegacySourceId(source, index) {
  const kind = source?.kind === 'relation' ? 'relation' : 'sheet';
  const seed = [kind, source?.db || '', source?.relationProp || '', source?.label || '', index].join('|');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'msr-legacy-' + (hash >>> 0).toString(36);
}

function _msrNormalizeSourcesForEditor(sources) {
  return (Array.isArray(sources) ? sources : []).map((src, index) => ({
    ...src,
    sourceId: src?.sourceId || _msrLegacySourceId(src, index),
    kind: src?.kind === 'relation' ? 'relation' : 'sheet',
  }));
}

function _msrSameDbPath(a, b) {
  const normalize = typeof _dbNormalizePath === 'function'
    ? _dbNormalizePath
    : value => String(value || '').replace(/\\/g, '/').replace(/^\.\/+|\/+$/g, '');
  return normalize(a || '') === normalize(b || '');
}

async function _loadMsrRelationPropCandidates(row, sourceDb, currentDbPath, selectedProp) {
  const select = row.querySelector('.msr-relation-prop');
  const warning = row.querySelector('.msr-relation-warning');
  if (!select || !warning) return;
  select.innerHTML = '';
  const addOption = (value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  };
  addOption(selectedProp || '', sourceDb ? '読み込み中...' : (selectedProp || '先に対象シートを選択'));
  select.disabled = true;
  warning.textContent = '';
  if (!sourceDb) {
    if (selectedProp) warning.textContent = '対象シートが未設定です。現在の参照列は変更していません。';
    return;
  }

  try {
    const metadata = await apiFetch('/db-metadata?path=' + encodeURIComponent(sourceDb));
    if (!row.isConnected || row.querySelector('.msr-db-input')?.value?.trim() !== sourceDb) return;
    const propertyTypes = metadata?.property_types || metadata?.propertyTypes || {};
    const candidates = Object.entries(propertyTypes)
      .filter(([, cfg]) => cfg && (cfg.type === 'relation' || cfg.type === 'multi-relation'))
      .filter(([, cfg]) => {
        const resolved = typeof _dbResolveRelationDbPath === 'function'
          ? _dbResolveRelationDbPath(sourceDb, cfg)
          : (cfg.relationDb || '');
        return _msrSameDbPath(resolved, currentDbPath);
      })
      .map(([name]) => name);
    select.innerHTML = '';
    addOption('', '参照列を選択');
    candidates.forEach(name => addOption(name, name));
    if (selectedProp && !candidates.includes(selectedProp)) {
      addOption(selectedProp, selectedProp + '（現在の設定・無効）');
      warning.textContent = '現在の参照列は、このシートを参照していません。設定を確認してください。';
    }
    select.value = selectedProp || '';
    select.disabled = false;
    if (!candidates.length && !selectedProp) {
      warning.textContent = '現在のシートを参照する列がありません。';
    }
  } catch (error) {
    select.innerHTML = '';
    addOption(selectedProp || '', selectedProp || '参照列を読み込めませんでした');
    select.value = selectedProp || '';
    warning.textContent = '参照列を読み込めませんでした。現在の設定は変更していません。';
  }
}

function _msrSourceKindRow(source) {
  const row = document.createElement('div');
  row.className = 'msr-field-row';
  const label = document.createElement('span');
  label.textContent = 'ソース種別:';
  const select = document.createElement('select');
  select.className = 'msr-kind-select';
  [['sheet', 'シート'], ['relation', 'リレーション参照元']].forEach(([value, text]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = source.kind === value;
    select.appendChild(option);
  });
  row.append(label, select);
  return { row, select };
}

function _msrSourceDbRow(source, scope) {
  const row = document.createElement('div');
  row.className = 'msr-field-row';
  row.innerHTML = '<span>シート:</span>';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'msr-db-input';
  input.value = source.db || '';
  input.placeholder = '例: 開発/デバッグリスト';
  row.appendChild(input);
  _attachDbPicker(input, _ptState(scope)?.dbPath);
  return { row, input };
}

function _msrAppendRelationPropEditor(host, source, dbInput, stateInfo) {
  const row = document.createElement('div');
  row.className = 'msr-field-row';
  const label = document.createElement('span');
  label.textContent = '参照列:';
  const select = document.createElement('select');
  select.className = 'msr-relation-prop';
  const warning = document.createElement('div');
  warning.className = 'msr-relation-warning pt-hint';
  row.append(label, select);
  host.append(row, warning);

  const currentDbPath = stateInfo.dbPath || state.currentDbPath || '';
  _loadMsrRelationPropCandidates(host, source.db || '', currentDbPath, source.relationProp || '');
  let loadTimer = null;
  const reloadCandidates = () => {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      _loadMsrRelationPropCandidates(
        host,
        dbInput.value.trim(),
        currentDbPath,
        select.value || source.relationProp || ''
      );
    }, 150);
  };
  dbInput.addEventListener('input', reloadCandidates);
  dbInput.addEventListener('change', reloadCandidates);
}

function _msrAppendLabelEditor(host, source) {
  const row = document.createElement('div');
  row.className = 'msr-field-row';
  row.innerHTML = '<span>ラベル:</span>';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'msr-label-input';
  input.value = source.label || '';
  input.placeholder = '(シート名から自動生成)';
  row.appendChild(input);
  host.appendChild(row);
}

function _msrRuleRow(rule, sourceIndex, ruleIndex, mode, scope) {
  const row = document.createElement('div');
  row.className = 'msr-rule-row';
  const stateInfo = _ptState(scope);
  const rawProps = stateInfo.pivotData?.properties || [];
  const props = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(stateInfo.dbPath || state.currentDbPath || '', rawProps)
    : rawProps;
  const mySelect = document.createElement('select');
  mySelect.className = 'msr-my-prop';
  props.forEach(prop => {
    const option = document.createElement('option');
    option.value = prop;
    option.textContent = prop;
    option.selected = prop === rule.myProp;
    mySelect.appendChild(option);
  });
  row.appendChild(mySelect);
  row.appendChild(document.createTextNode(' = 参照先の '));
  const remoteInput = document.createElement('input');
  remoteInput.type = 'text';
  remoteInput.className = 'msr-remote-prop';
  remoteInput.value = rule.remoteProp || '';
  remoteInput.placeholder = '列名';
  row.appendChild(remoteInput);
  const remove = document.createElement('button');
  remove.innerHTML = lucide('x', 12);
  remove.className = 'pt-small-btn';
  remove.addEventListener('click', () => {
    const sources = _collectMsrSources(scope);
    sources[sourceIndex].matchRules.splice(ruleIndex, 1);
    _renderMsrSources(sources, mode, scope);
  });
  row.appendChild(remove);
  return row;
}

function _msrAppendRulesEditor(host, source, sourceIndex, mode, scope) {
  if (mode !== 'auto' || source.kind === 'relation') return;
  const rules = document.createElement('div');
  rules.className = 'msr-rules';
  const label = document.createElement('div');
  label.className = 'msr-rules-label';
  label.textContent = 'マッチ条件:';
  rules.appendChild(label);
  (source.matchRules || []).forEach((rule, ruleIndex) => {
    rules.appendChild(_msrRuleRow(rule, sourceIndex, ruleIndex, mode, scope));
  });
  const add = document.createElement('button');
  add.textContent = '+ 条件を追加';
  add.className = 'pt-small-btn';
  add.addEventListener('click', () => {
    const sources = _collectMsrSources(scope);
    if (!sources[sourceIndex].matchRules) sources[sourceIndex].matchRules = [];
    sources[sourceIndex].matchRules.push({ myProp: '', remoteProp: '' });
    _renderMsrSources(sources, mode, scope);
  });
  rules.appendChild(add);
  host.appendChild(rules);
}

function _msrAppendSourceActions(host, sourceIndex, mode, scope, kindSelect) {
  const remove = document.createElement('button');
  remove.innerHTML = lucide('x', 12) + ' ソース削除';
  remove.className = 'pt-small-btn muted';
  remove.addEventListener('click', () => {
    const sources = _collectMsrSources(scope);
    sources.splice(sourceIndex, 1);
    _renderMsrSources(sources, mode, scope);
  });
  host.appendChild(remove);
  kindSelect.addEventListener('change', () => {
    const sources = _collectMsrSources(scope);
    sources[sourceIndex].kind = kindSelect.value;
    if (kindSelect.value === 'relation') delete sources[sourceIndex].matchRules;
    else delete sources[sourceIndex].relationProp;
    _renderMsrSources(sources, mode, scope);
  });
}

// マルチソースリレーション設定UI描画
function _renderMsrSources(sources, mode, root) {
  const scope = _ptResolveRoot(root);
  const container = _ptGet('pt-msr-sources', scope);
  if (!container) return;
  container.innerHTML = '';
  const stateInfo = _ptState(scope);

  _msrNormalizeSourcesForEditor(sources).forEach((source, index) => {
    const host = document.createElement('div');
    host.className = 'msr-source-row';
    host.dataset.sourceId = source.sourceId;
    const kind = _msrSourceKindRow(source);
    host.appendChild(kind.row);
    const db = _msrSourceDbRow(source, scope);
    host.appendChild(db.row);
    if (source.kind === 'relation') _msrAppendRelationPropEditor(host, source, db.input, stateInfo);
    _msrAppendLabelEditor(host, source);
    _msrAppendRulesEditor(host, source, index, mode, scope);
    _msrAppendSourceActions(host, index, mode, scope, kind.select);
    container.appendChild(host);
  });
}

// マルチソースリレーション設定をUIから収集
function _collectMsrSources(root) {
  const container = _ptGet('pt-msr-sources', root);
  if (!container) return [];
  const sources = [];
  container.querySelectorAll('.msr-source-row').forEach(row => {
    const kind = row.querySelector('.msr-kind-select')?.value === 'relation' ? 'relation' : 'sheet';
    const source = {
      sourceId: row.dataset.sourceId || _msrCreateSourceId(),
      kind,
      db: row.querySelector('.msr-db-input')?.value?.trim() || '',
      label: row.querySelector('.msr-label-input')?.value?.trim() || '',
    };
    if (kind === 'relation') {
      source.relationProp = row.querySelector('.msr-relation-prop')?.value || '';
      sources.push(source);
      return;
    }
    const matchRules = [];
    row.querySelectorAll('.msr-rules > div:not(:last-child)').forEach(ruleRow => {
      if (!ruleRow.querySelector('.msr-my-prop')) return;
      matchRules.push({
        myProp: ruleRow.querySelector('.msr-my-prop')?.value || '',
        remoteProp: ruleRow.querySelector('.msr-remote-prop')?.value || '',
      });
    });
    if (matchRules.length) source.matchRules = matchRules;
    sources.push(source);
  });
  return sources;
}
/* プロパティ型・値エディタ — gb-db-props.js から分離 */

function getPropertyTypes(dbPath, ctxOverride) {
  const targetPath = dbPath || state.currentDbPath || '';
  const localTypes = getDbViewConfig(targetPath).propertyTypes || {};
  const targetMetadata = _ptMetadataForDbPath(targetPath, ctxOverride);
  // バックエンド（フォルダノート）を優先: property_types キーが存在すればそれを使う
  if (targetMetadata && 'property_types' in targetMetadata && targetMetadata.property_types !== null) {
    const backendTypes = targetMetadata.property_types || {};
    if (Object.keys(backendTypes).length > 0) return backendTypes;
    return Object.keys(localTypes).length > 0 ? localTypes : backendTypes;
  }
  // フォールバック: localStorage（後方互換、オフライン対応）
  return localTypes;
}

function _ptNormalizeDbPath(dbPath) {
  if (typeof _dbNormalizePath === 'function') return _dbNormalizePath(dbPath || '');
  return String(dbPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _ptIsCurrentDbPath(dbPath) {
  const target = _ptNormalizeDbPath(dbPath || state.currentDbPath || '');
  const current = _ptNormalizeDbPath(state.currentDbPath || '');
  return !target || !current || target === current;
}

function _ptMetadataForDbPath(dbPath, ctxOverride) {
  const target = _ptNormalizeDbPath(dbPath || state.currentDbPath || '');
  if (ctxOverride
    && (!target || _ptNormalizeDbPath(ctxOverride.dbPath || '') === target)
    && ctxOverride.dbMetadata) {
    return ctxOverride.dbMetadata;
  }
  if (_ptIsCurrentDbPath(target) && state.dbMetadata) return state.dbMetadata;
  if (typeof _dbFindPaneContextForPath === 'function' && target) {
    const ctx = _dbFindPaneContextForPath(target);
    if (ctx?.dbMetadata) return ctx.dbMetadata;
  }
  return null;
}

function _ptContextForDbPath(dbPath, ctx) {
  if (ctx && (!dbPath || _ptNormalizeDbPath(ctx.dbPath || '') === _ptNormalizeDbPath(dbPath || ''))) return ctx;
  if (typeof _dbFindPaneContextForPath === 'function' && dbPath) {
    const found = _dbFindPaneContextForPath(dbPath);
    if (found) return found;
  }
  if (typeof _currentPaneState === 'function') {
    const current = _currentPaneState();
    if (!dbPath || _ptNormalizeDbPath(current?.dbPath || '') === _ptNormalizeDbPath(dbPath || '')) return current;
  }
  return ctx || null;
}

function setPropertyType(dbPath, propName, typeConfig, ctxOverride) {
  const targetPath = dbPath || state.currentDbPath || '';
  const currentTypes = getPropertyTypes(targetPath, ctxOverride) || {};
  const protectionLevel = _dbSchemaProtectionLevel(targetPath, propName);
  if (protectionLevel
    && Object.prototype.hasOwnProperty.call(currentTypes, propName)
    && JSON.stringify(currentTypes[propName] || {}) !== JSON.stringify(typeConfig || {})) {
    _showSchemaProtectionBlockedStatus(protectionLevel);
    return false;
  }
  // localStorage にキャッシュ（従来通り）
  const c = getDbViewConfig(targetPath);
  if (!c.propertyTypes) c.propertyTypes = {};
  c.propertyTypes[propName] = typeConfig;
  _unmarkDbPropertyDeletedInConfig(c, propName);
  saveDbViewConfig(targetPath, c, { skipBackend: true, ctx: ctxOverride });
  // state.dbMetadata にも反映
  const targetMetadata = _ptMetadataForDbPath(targetPath, ctxOverride);
  if (targetMetadata) {
    if (!targetMetadata.property_types) targetMetadata.property_types = {};
    targetMetadata.property_types[propName] = typeConfig;
    if (_ptIsCurrentDbPath(targetPath)) state.dbMetadata = targetMetadata;
  }
  // バックエンドに永続保存
  return _savePropertyTypesToBackend(targetPath, undefined, ctxOverride);
}

function _ptRestoreLocalStoredTypeConfig(dbPath, propName, previousConfig, ctx) {
  const restored = JSON.parse(JSON.stringify(previousConfig || {}));
  const currentTypes = getPropertyTypes(dbPath, ctx) || {};
  if (Object.keys(restored).length) currentTypes[propName] = restored;
  else delete currentTypes[propName];
  const localConfig = getDbViewConfig(dbPath);
  if (!localConfig.propertyTypes) localConfig.propertyTypes = {};
  if (Object.keys(restored).length) localConfig.propertyTypes[propName] = restored;
  else delete localConfig.propertyTypes[propName];
  saveDbViewConfig(dbPath, localConfig, { skipBackend: true, skipHistory: true, ctx });
  const metadata = _ptMetadataForDbPath(dbPath, ctx);
  if (metadata) metadata.property_types = currentTypes;
}

async function _ptApplyStoredTypeConfig(dbPath, propName, previousConfig, requestedConfig, ctx) {
  const nextConfig = JSON.parse(JSON.stringify(requestedConfig || {}));
  const rollbackOps = [];
  try {
    if ((nextConfig.type === 'relation' || nextConfig.type === 'multi-relation')
        && nextConfig.bidirectional
        && typeof _ensureBidirectionalRelationConfig === 'function') {
      const ensured = await _ensureBidirectionalRelationConfig(dbPath, propName, nextConfig);
      Object.assign(nextConfig, ensured?.config || ensured || {});
      if (ensured?.undo) rollbackOps.push(ensured.undo);
    }
    if (typeof _disableBidirectionalRelationConfig === 'function') {
      const disabled = await _disableBidirectionalRelationConfig(
        dbPath, propName, previousConfig || {}, nextConfig
      );
      if (disabled?.undo) rollbackOps.push(disabled.undo);
    }
    const saved = await Promise.resolve(setPropertyType(dbPath, propName, nextConfig, ctx));
    if (saved === false) throw new Error('列タイプが保護されているため変更できません');
  } catch (error) {
    for (let index = rollbackOps.length - 1; index >= 0; index -= 1) {
      try { await rollbackOps[index](); } catch (rollbackError) {
        console.error('列タイプ変更の関連設定復旧に失敗:', rollbackError, error);
      }
    }
    _ptRestoreLocalStoredTypeConfig(dbPath, propName, previousConfig, ctx);
    if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
    throw error;
  }
  if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
  return nextConfig;
}

// 列タイプ変更を Undo/Redo 履歴へ積む共通処理（列名リネームの historyPush と揃える）。
// 双方向リレーションは元シートと対応先シートを同じ操作として戻す。
function _ptPushTypeChangeHistory(dbPath, propName, beforeConfig, afterConfig, ctx) {
  if (typeof historyPush !== 'function' || typeof _dbScope !== 'function') return;
  if (!dbPath || !propName) return;
  const beforeType = (beforeConfig && beforeConfig.type) || 'text';
  const afterType = (afterConfig && afterConfig.type) || 'text';
  if (beforeType === afterType) return;
  const before = JSON.parse(JSON.stringify(beforeConfig || {}));
  const after = JSON.parse(JSON.stringify(afterConfig || {}));
  const _resolveCtx = () => (typeof _ptContextForDbPath === 'function' ? _ptContextForDbPath(dbPath) : ctx);
  const _restore = async (fromCfg, toCfg) => {
    const rc = _resolveCtx();
    await _ptApplyStoredTypeConfig(dbPath, propName, fromCfg, toCfg, rc);
    // 設定パネルが開いていれば型ドロップダウンの表示も同期する（開いていなければ no-op）
    if (typeof renderDbPropertySettingsPanel === 'function'
        && typeof document !== 'undefined'
        && document.querySelector('#detail-tab-db-property-settings')) {
      try { renderDbPropertySettingsPanel(dbPath, propName); } catch {}
    }
  };
  historyPush('列タイプ変更: ' + propName,
    () => _restore(after, before),
    () => _restore(before, after),
    (typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : _dbScope(dbPath))
  );
}

const _ptBackendSaveQueues = {};

function _dbDeletedPropsArrayFromConfig(cfg) {
  return Array.isArray(cfg?.deletedProps) ? cfg.deletedProps : [];
}

function _isProductionManagementColumnDeletionBlocked(dbPath) {
  return typeof isProductionManagementSheetPath === 'function'
    && isProductionManagementSheetPath(dbPath || state.currentDbPath || '');
}

// スタッフ管理シート（正本）を含む列保護レベルの統一判定（実体は gb-db-core.js の
// getSchemaProtectionLevel()。'all'=制作管理・全列ロック / 'required'=正本シートの
// 必須列のみロック / null=無保護）。計画書§5.2「列保護（列単位の保護機構を新設）」。
function _dbSchemaProtectionLevel(dbPath, propName) {
  if (typeof getSchemaProtectionLevel === 'function') return getSchemaProtectionLevel(dbPath, propName);
  return _isProductionManagementColumnDeletionBlocked(dbPath) ? 'all' : null;
}

function _showSchemaProtectionBlockedStatus(level) {
  if (typeof showStatus !== 'function') return;
  if (level === 'all') { showStatus('制作管理に必要な列は削除できません。非表示を利用してください', true); return; }
  if (level === 'required') { showStatus('スタッフ管理に必要な列は削除できません。非表示を利用してください', true); return; }
  if (level === 'computed') { showStatus('自動計算列のため、削除・列名変更・型変更はできません', true); }
}

function getDeletedDbProperties(dbPath) {
  // 旧版で付いた tombstone が残っていても、制作管理の必須列は表示対象へ戻す。
  if (_isProductionManagementColumnDeletionBlocked(dbPath)) return [];
  const raw = _dbDeletedPropsArrayFromConfig(getDbViewConfig(dbPath));
  const targetPath = dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '';
  if (raw.length && typeof window !== 'undefined' && window.MeldexUserRegistry?.isRegistryPathSync?.(targetPath)) {
    // 正本シートは必須列のtombstoneだけ除去し、管理者追加列のtombstoneは残す
    // （制作管理は全tombstone除去、正本は必須列のみ。計画書§5.2）。
    return raw.filter((name) => !window.MeldexStaffRegistrySchema?.isRequiredProperty?.(name));
  }
  return raw;
}

function isDbPropertyDeleted(dbPath, propName) {
  return !!propName && getDeletedDbProperties(dbPath).includes(propName);
}

function filterDeletedDbProperties(dbPath, props) {
  if (!Array.isArray(props)) return [];
  const deleted = new Set(getDeletedDbProperties(dbPath));
  // '__entity__' はエントリ名列を表す予約トークン（フェーズ2でcolOrderに含まれ得る）。
  // 通常のプロパティ一覧（フィルタ/条件付き書式/列タイプ設定等）には流れ込ませない。
  if (deleted.size === 0) return props.filter(prop => prop && prop !== '__entity__');
  return props.filter(prop => prop && prop !== '__entity__' && !deleted.has(prop));
}

function _markDbPropertyDeletedInConfig(cfg, propName) {
  if (!cfg || typeof cfg !== 'object' || !propName) return false;
  if (!Array.isArray(cfg.deletedProps)) cfg.deletedProps = [];
  if (cfg.deletedProps.includes(propName)) return false;
  cfg.deletedProps.push(propName);
  return true;
}

function _unmarkDbPropertyDeletedInConfig(cfg, propName) {
  if (!cfg || typeof cfg !== 'object' || !propName || !Array.isArray(cfg.deletedProps)) return false;
  const next = cfg.deletedProps.filter(name => name !== propName);
  if (next.length === cfg.deletedProps.length) return false;
  if (next.length) cfg.deletedProps = next;
  else delete cfg.deletedProps;
  return true;
}

// 列を削除（設定のみ）: 候補値データは各エントリに残る
async function _deleteColumn(dbPath, propName, ctx) {
  if (!dbPath || !propName) return false;
  const deleteProtectionLevel = _dbSchemaProtectionLevel(dbPath, propName);
  if (deleteProtectionLevel) {
    _showSchemaProtectionBlockedStatus(deleteProtectionLevel);
    return false;
  }
  const renderCtx = _ptContextForDbPath(dbPath, ctx);
  const ok = await cfConfirm(
    `列「${propName}」を削除します。\n\n既存の候補値データはエントリに残りますが、表示されなくなります。\n（再度同名の列を追加すれば値は復活します）\n\n削除しますか？`
  );
  if (!ok) return false;

  // undo用スナップショット
  const oldCfg = JSON.parse(JSON.stringify(getDbViewConfig(dbPath)));
  const oldBackendPropertyTypes = JSON.parse(JSON.stringify((typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : oldCfg.propertyTypes) || {}));
  const oldPT = (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)?.[propName] : null) || oldCfg.propertyTypes?.[propName];

  const c = getDbViewConfig(dbPath);
  _deleteViewConfigPropReferences(c, propName);
  (c.savedViews || []).forEach(view => _deleteViewConfigPropReferences(view, propName));
  if (c.propertyTypes) _deletePropertyTypePropReferences(c.propertyTypes, propName);
  _markDbPropertyDeletedInConfig(c, propName);
  if (c.columnLocks) {
    delete c.columnLocks[propName];
    if (Object.keys(c.columnLocks).length === 0) delete c.columnLocks;
  }
  if (c.entryPropOrder) c.entryPropOrder = c.entryPropOrder.filter(n => n !== propName);
  if (c.propertyLayout && typeof removePropertyLayoutReferences === 'function') {
    c.propertyLayout = removePropertyLayoutReferences(c.propertyLayout, propName);
  }
  let viewConfigPersisted = true;
  if (typeof _persistDbViewConfigToBackend === 'function') {
    viewConfigPersisted = await _persistDbViewConfigToBackend(dbPath, c, { immediate: true });
  }
  if (viewConfigPersisted === false) {
    saveDbViewConfig(dbPath, oldCfg, { skipBackend: true, skipHistory: true });
    showStatus(`列「${propName}」を削除できませんでした。保存先の空き容量や権限を確認してください`, true);
    return false;
  }
  saveDbViewConfig(dbPath, c, { skipBackend: true });

  // state.dbMetadata にも反映
  if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata?.property_types) _deletePropertyTypePropReferences(state.dbMetadata.property_types, propName);
  if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata?.property_layout && typeof removePropertyLayoutReferences === 'function') {
    state.dbMetadata.property_layout = removePropertyLayoutReferences(state.dbMetadata.property_layout, propName);
  }

  // バックエンドに保存
  if (typeof updatePropertyLayoutForDelete === 'function') updatePropertyLayoutForDelete(dbPath, propName).catch(() => {});
  const savePromise = _savePropertyTypesToBackend(dbPath);
  if (oldPT?.type === 'image') {
    Promise.resolve(savePromise).then(() => apiPost('/media/rebuild-refs', {})).catch(() => {});
  }

  // Undo/Redo
  if (typeof historyPush === 'function' && typeof _dbScope === 'function') {
    historyPush('列削除: ' + propName,
      () => { // undo: 設定を復元
        saveDbViewConfig(dbPath, oldCfg);
        if (state.dbMetadata) {
          if (_ptIsCurrentDbPath(dbPath)) {
            if (!state.dbMetadata.property_types) state.dbMetadata.property_types = {};
            if (Object.keys(oldBackendPropertyTypes).length) state.dbMetadata.property_types = JSON.parse(JSON.stringify(oldBackendPropertyTypes));
            else if (oldCfg.propertyTypes) state.dbMetadata.property_types = JSON.parse(JSON.stringify(oldCfg.propertyTypes));
            else if (oldPT) state.dbMetadata.property_types[propName] = oldPT;
            state.dbMetadata.property_layout = oldCfg.propertyLayout || null;
          }
        }
        if (Object.keys(oldBackendPropertyTypes).length) {
          const cfg = getDbViewConfig(dbPath);
          cfg.propertyTypes = JSON.parse(JSON.stringify(oldBackendPropertyTypes));
          saveDbViewConfig(dbPath, cfg, { skipHistory: true });
        }
        _savePropertyTypesToBackend(dbPath, { property_layout: oldCfg.propertyLayout || null });
        selectDatabase(dbPath, renderCtx);
      },
      () => { // redo: 再削除
        return _deleteColumnNoConfirm(dbPath, propName, renderCtx);
      },
      (typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : _dbScope(dbPath))
    );
  }

  if (typeof _renderCurrentDbView === 'function' && (renderCtx?.pivotData || state.pivotData)) {
    if (renderCtx && !renderCtx.pivotData && state.pivotData) renderCtx.pivotData = state.pivotData;
    _renderCurrentDbView(renderCtx, dbPath);
  } else {
    selectDatabase(dbPath, renderCtx);
  }
  showStatus(`列「${propName}」を削除しました`);
  // 列削除 → 該当 sheet_col/sheet_cell コメントを孤児化 (annotation_unification_plan.md §5.3)
  apiPost('/annotations/orphan-by-target', {
    target_kind: 'sheet_col',
    target_file: dbPath,
    item_id: propName,
    cascade_container: true,
  }).catch(() => {});
  return true;
}

// 確認なしで列削除（redo用）
async function _deleteColumnNoConfirm(dbPath, propName, ctx) {
  if (!dbPath || !propName) return false;
  const deleteProtectionLevel = _dbSchemaProtectionLevel(dbPath, propName);
  if (deleteProtectionLevel) {
    _showSchemaProtectionBlockedStatus(deleteProtectionLevel);
    return false;
  }
  const renderCtx = _ptContextForDbPath(dbPath, ctx);
  const oldCfg = JSON.parse(JSON.stringify(getDbViewConfig(dbPath)));
  const c = getDbViewConfig(dbPath);
  const oldPT = (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)?.[propName] : null) || c.propertyTypes?.[propName];
  _deleteViewConfigPropReferences(c, propName);
  (c.savedViews || []).forEach(view => _deleteViewConfigPropReferences(view, propName));
  if (c.propertyTypes) _deletePropertyTypePropReferences(c.propertyTypes, propName);
  _markDbPropertyDeletedInConfig(c, propName);
  if (c.columnLocks) { delete c.columnLocks[propName]; if (Object.keys(c.columnLocks).length === 0) delete c.columnLocks; }
  if (c.entryPropOrder) c.entryPropOrder = c.entryPropOrder.filter(n => n !== propName);
  if (c.propertyLayout && typeof removePropertyLayoutReferences === 'function') {
    c.propertyLayout = removePropertyLayoutReferences(c.propertyLayout, propName);
  }
  let viewConfigPersisted = true;
  if (typeof _persistDbViewConfigToBackend === 'function') {
    viewConfigPersisted = await _persistDbViewConfigToBackend(dbPath, c, { immediate: true });
  }
  if (viewConfigPersisted === false) {
    saveDbViewConfig(dbPath, oldCfg, { skipBackend: true, skipHistory: true });
    showStatus(`列「${propName}」を削除できませんでした。保存先の空き容量や権限を確認してください`, true);
    return false;
  }
  saveDbViewConfig(dbPath, c, { skipBackend: true });
  if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata?.property_types) _deletePropertyTypePropReferences(state.dbMetadata.property_types, propName);
  if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata?.property_layout && typeof removePropertyLayoutReferences === 'function') {
    state.dbMetadata.property_layout = removePropertyLayoutReferences(state.dbMetadata.property_layout, propName);
  }
  if (typeof updatePropertyLayoutForDelete === 'function') updatePropertyLayoutForDelete(dbPath, propName).catch(() => {});
  const savePromise = _savePropertyTypesToBackend(dbPath);
  if (oldPT?.type === 'image') {
    Promise.resolve(savePromise).then(() => apiPost('/media/rebuild-refs', {})).catch(() => {});
  }
  if (typeof _renderCurrentDbView === 'function' && (renderCtx?.pivotData || state.pivotData)) {
    if (renderCtx && !renderCtx.pivotData && state.pivotData) renderCtx.pivotData = state.pivotData;
    _renderCurrentDbView(renderCtx, dbPath);
  } else {
    selectDatabase(dbPath, renderCtx);
  }
  return true;
}

// 保存に送る property_types を組み立てる。
// フォルダノートの property_types は「送った内容でまるごと置き換え」られるため、
// そのシートのメタデータをまだ読み込んでいない状態（＝画面に出していないシート）で
// ローカルにある分だけを送ると、他の列の型設定を巻き添えで消してしまう。
// メタデータ未読込のときだけサーバーの現在値を取り直し、ローカルの変更を重ねる。
async function _ptPropertyTypesPayloadForSave(targetPath, ctxOverride) {
  const localTypes = getPropertyTypes(targetPath, ctxOverride) || {};
  if (_ptMetadataForDbPath(targetPath, ctxOverride)) return localTypes;
  try {
    const meta = await apiFetch('/db-metadata?path=' + encodeURIComponent(targetPath));
    const remote = { ...((meta && meta.property_types) || {}) };
    // 削除済みの列まで拾い直すと、削除操作が取り消されたように見えてしまう。
    // 削除の記録が残っている列はサーバー側の値から取り除いてから重ねる。
    _dbDeletedPropsArrayFromConfig(getDbViewConfig(targetPath)).forEach(name => { delete remote[name]; });
    return { ...remote, ...localTypes };
  } catch (e) {
    console.warn('列タイプ保存前のシート情報取得に失敗:', e);
    return null;
  }
}

async function _savePropertyTypesToBackend(dbPath, extraMetadata, ctxOverride) {
  const targetPath = dbPath || state.currentDbPath || '';
  if (typeof isProductionManagementWriteBlocked === 'function'
      && isProductionManagementWriteBlocked(targetPath, ctxOverride)) return false;
  const key = _ptNormalizeDbPath(targetPath);
  const queue = _ptBackendSaveQueues[key] || (_ptBackendSaveQueues[key] = {
    dirty: false,
    extraMetadata: {},
    promise: null,
    running: false,
  });
  queue.dirty = true;
  if (extraMetadata && typeof extraMetadata === 'object') Object.assign(queue.extraMetadata, extraMetadata);
  if (queue.running) return queue.promise || Promise.resolve();

  queue.running = true;
  queue.promise = (async () => {
    let saveError = null;
    try {
      while (queue.dirty) {
        queue.dirty = false;
        const propertyTypes = await _ptPropertyTypesPayloadForSave(targetPath, ctxOverride);
        const payload = {};
        if (propertyTypes) payload.property_types = propertyTypes;
        if (queue.extraMetadata && typeof queue.extraMetadata === 'object') {
          Object.assign(payload, queue.extraMetadata);
          queue.extraMetadata = {};
        }
        if (!Object.keys(payload).length) {
          showStatus('列タイプを保存できませんでした。時間をおいて再度お試しください', true);
          continue;
        }
        try {
          if (typeof isProductionManagementWriteBlocked === 'function'
              && isProductionManagementWriteBlocked(targetPath, ctxOverride)) continue;
          const meta = (typeof _ptMetadataForDbPath === 'function'
            ? _ptMetadataForDbPath(targetPath, ctxOverride)
            : null) || {};
          const schemaMutation = globalThis.GbDbSchemaMutation;
          if (schemaMutation && payload.property_types) {
            const ensured = schemaMutation.ensurePropertyIds(
              targetPath, meta, payload.property_types
            );
            payload.property_types = ensured.propertyTypes;
            payload.property_ids = ensured.propertyIds;
          }
          if (schemaMutation) {
            await schemaMutation.saveMetadata(targetPath, payload, ctxOverride);
          } else {
            await apiPut('/db-metadata?path=' + encodeURIComponent(targetPath), payload);
          }
        } catch (e) {
          console.warn('プロパティ型設定のバックエンド保存に失敗:', e);
          showStatus('列タイプの保存に失敗しました: ' + (e?.message || e), true);
          saveError = e;
          queue.dirty = false;
        }
      }
      if (saveError) throw saveError;
      // ふりがな型の設定・解除はルビ辞書の内容を変えるため、保存確定後に再読込する
      if (typeof loadLinkDict === 'function') loadLinkDict();
    } finally {
      queue.running = false;
      queue.promise = null;
      if (!queue.dirty) delete _ptBackendSaveQueues[key];
    }
  })();
  return queue.promise;
}

async function waitForPendingDbPropertyTypeSaves(dbPath) {
  const key = _ptNormalizeDbPath(dbPath || '');
  for (let pass = 0; pass < 20; pass += 1) {
    const queue = _ptBackendSaveQueues[key];
    if (!queue?.promise) return true;
    await Promise.resolve(queue.promise).catch(() => {});
  }
  return false;
}

function _escapeRegExpForPropName(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _formulaPropLiteral(propName, quote) {
  const q = quote === "'" ? "'" : '"';
  return String(propName || '')
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(_escapeRegExpForPropName(q), 'g'), '\\' + q);
}

function _renameFormulaPropRefs(formula, oldName, newName) {
  if (typeof formula !== 'string' || !oldName) return formula;
  const re = new RegExp('prop\\(\\s*([\\\"\\\'])' + _escapeRegExpForPropName(oldName) + '\\1\\s*\\)', 'g');
  return formula.replace(re, (match, quote) => 'prop(' + quote + _formulaPropLiteral(newName, quote) + quote + ')');
}

function _deleteFormulaPropRefs(formula, propName) {
  if (typeof formula !== 'string' || !propName) return formula;
  const re = new RegExp('prop\\(\\s*([\\\"\\\'])' + _escapeRegExpForPropName(propName) + '\\1\\s*\\)', 'g');
  return formula.replace(re, '""');
}

function _deletePropertyTypeReferences(cfg, propName) {
  if (!cfg || typeof cfg !== 'object' || !propName) return;
  if (cfg.pairWith === propName) delete cfg.pairWith;
  if (cfg.cascadeFrom === propName) {
    delete cfg.cascadeFrom;
    delete cfg.cascadeKey;
  } else if (cfg.cascadeKey === propName) {
    delete cfg.cascadeKey;
  }
  if (cfg.relationProp === propName) {
    delete cfg.relationProp;
    delete cfg.targetProp;
  }
  if (cfg.targetProp === propName) delete cfg.targetProp;
  if (cfg.relationDb === '' && cfg.bidirectionalProp === propName) delete cfg.bidirectionalProp;
  if (typeof cfg.formula === 'string') cfg.formula = _deleteFormulaPropRefs(cfg.formula, propName);
  if (Array.isArray(cfg.actions)) {
    cfg.actions = cfg.actions.filter(action => {
      if (!action || typeof action !== 'object') return false;
      if (action.targetProp === propName) return false;
      if (Array.isArray(action.copyProps)) action.copyProps = action.copyProps.filter(p => p !== propName);
      return true;
    });
  }
  if (Array.isArray(cfg.sources)) {
    cfg.sources.forEach(src => {
      if (Array.isArray(src.matchRules)) src.matchRules = src.matchRules.filter(rule => rule?.myProp !== propName);
    });
  }
  if (Array.isArray(cfg.calendarSync?.colorRules)) {
    cfg.calendarSync.colorRules = cfg.calendarSync.colorRules.filter(rule => rule?.when?.prop !== propName);
  }
}

function _deletePropertyTypePropReferences(propertyTypes, propName) {
  if (!propertyTypes || typeof propertyTypes !== 'object') return;
  delete propertyTypes[propName];
  Object.values(propertyTypes).forEach(cfg => _deletePropertyTypeReferences(cfg, propName));
}

function _renamePropertyTypeReferences(cfg, oldName, newName, propertyTypes) {
  if (!cfg || typeof cfg !== 'object') return;
  if (cfg.pairWith === oldName) cfg.pairWith = newName;
  if (cfg.cascadeFrom === oldName) cfg.cascadeFrom = newName;
  if (cfg.relationProp === oldName) cfg.relationProp = newName;
  if (cfg.relationDb === '') {
    if (cfg.bidirectionalProp === oldName) cfg.bidirectionalProp = newName;
    if (cfg.cascadeKey === oldName) cfg.cascadeKey = newName;
  }
  const relationConfig = propertyTypes?.[cfg.relationProp];
  if (relationConfig?.relationDb === '' && cfg.targetProp === oldName) cfg.targetProp = newName;
  if (typeof cfg.formula === 'string') cfg.formula = _renameFormulaPropRefs(cfg.formula, oldName, newName);
  if (Array.isArray(cfg.actions)) {
    cfg.actions.forEach(action => {
      if (action.targetProp === oldName) action.targetProp = newName;
      if (Array.isArray(action.copyProps)) action.copyProps = action.copyProps.map(p => p === oldName ? newName : p);
    });
  }
  if (Array.isArray(cfg.sources)) {
    cfg.sources.forEach(src => {
      (src.matchRules || []).forEach(rule => {
        if (rule.myProp === oldName) rule.myProp = newName;
        if (rule.remoteProp === oldName && !src.db) rule.remoteProp = newName;
      });
    });
  }
  (cfg.calendarSync?.colorRules || []).forEach(rule => {
    if (rule?.when?.prop === oldName) rule.when.prop = newName;
  });
}

function _deleteViewConfigPropReferences(target, propName) {
  if (!target || typeof target !== 'object' || !propName) return;
  if (Array.isArray(target.colOrder)) target.colOrder = target.colOrder.filter(n => n !== propName);
  if (Array.isArray(target.pinnedCols)) target.pinnedCols = target.pinnedCols.filter(n => n !== propName);
  if (Array.isArray(target.hiddenCols)) target.hiddenCols = target.hiddenCols.filter(n => n !== propName);
  if (target.colWidths?.[propName] !== undefined) delete target.colWidths[propName];
  if (target.countTypes?.[propName] !== undefined) delete target.countTypes[propName];
  if (target.conditionalColors?.[propName] !== undefined) delete target.conditionalColors[propName];
  if (target.cellDisplayByCol?.[propName] !== undefined) delete target.cellDisplayByCol[propName];
  if (Array.isArray(target.advancedFilters)) {
    target.advancedFilters = target.advancedFilters.filter(filter => filter?.property !== propName && filter?.prop !== propName);
  }
  if (target.columnValueFilters?.[propName] !== undefined) delete target.columnValueFilters[propName];
  if (target.sortConfig?.key === propName) delete target.sortConfig;
  if (target.groupBy === propName) target.groupBy = null;
  if (target.entityNameProp === propName) target.entityNameProp = '';
  if (Array.isArray(target.fields)) target.fields = target.fields.filter(n => n !== propName);
  if (target.formConfig) _deleteViewConfigPropReferences(target.formConfig, propName);
  const ts = target.typeSpecific;
  if (ts && typeof ts === 'object') {
    if (ts.pivot?.groupBy === propName) ts.pivot.groupBy = null;
    if (ts.kanban?.groupBy === propName) ts.kanban.groupBy = '_status';
    const tree = ts.tree;
    if (tree && typeof tree === 'object') {
      ['parentProp', 'orderProp', 'labelProp', 'typeProp', 'colorProp', 'collapsedProp'].forEach(key => {
        if (tree[key] === propName) tree[key] = '';
      });
    }
    const mapping = ts.calendar?.mapping;
    if (mapping && typeof mapping === 'object') {
      ['startProp', 'endProp', 'titleProp', 'colorProp', 'descriptionProp', 'locationProp', 'urlProp', 'calendarIdProp'].forEach(key => {
        if (mapping[key] === propName) mapping[key] = '';
      });
    }
    const timeline = ts.timeline;
    if (timeline && typeof timeline === 'object') {
      ['timeProp', 'endProp'].forEach(key => {
        if (timeline[key] === propName) timeline[key] = '';
      });
      if (timeline.rowProp === propName) timeline.rowProp = '_entity';
      if (Array.isArray(timeline.cardProps)) timeline.cardProps = timeline.cardProps.filter(n => n !== propName);
      if (timeline.colWidths?.[propName] !== undefined) delete timeline.colWidths[propName];
    }
    if (ts.chart?.xProperty === propName) ts.chart.xProperty = '';
    if (ts.chart?.yProperty === propName) ts.chart.yProperty = null;
    if (ts.graph?.colorProperty === propName) ts.graph.colorProperty = '';
    if (ts.form?.formConfig) _deleteViewConfigPropReferences(ts.form.formConfig, propName);
  }
  for (const key of ["required"]) {
    if (Array.isArray(target[key])) target[key] = target[key].filter(n => n !== propName);
  }
  for (const key of ["descriptions", "placeholders", "labels"]) {
    if (target[key]?.[propName] !== undefined) delete target[key][propName];
  }
}

function _renameViewConfigPropReferences(target, oldName, newName) {
  if (!target || typeof target !== 'object') return;
  if (Array.isArray(target.colOrder)) target.colOrder = target.colOrder.map(n => n === oldName ? newName : n);
  if (Array.isArray(target.pinnedCols)) target.pinnedCols = target.pinnedCols.map(n => n === oldName ? newName : n);
  if (Array.isArray(target.hiddenCols)) target.hiddenCols = target.hiddenCols.map(n => n === oldName ? newName : n);
  if (target.colWidths?.[oldName] !== undefined) {
    target.colWidths[newName] = target.colWidths[oldName];
    delete target.colWidths[oldName];
  }
  if (target.countTypes?.[oldName] !== undefined) {
    target.countTypes[newName] = target.countTypes[oldName];
    delete target.countTypes[oldName];
  }
  if (target.conditionalColors?.[oldName] !== undefined) {
    target.conditionalColors[newName] = target.conditionalColors[oldName];
    delete target.conditionalColors[oldName];
  }
  if (target.cellDisplayByCol?.[oldName] !== undefined) {
    target.cellDisplayByCol[newName] = target.cellDisplayByCol[oldName];
    delete target.cellDisplayByCol[oldName];
  }
  if (Array.isArray(target.advancedFilters)) {
    target.advancedFilters.forEach(filter => {
      if (filter?.property === oldName) filter.property = newName;
      if (filter?.prop === oldName) filter.prop = newName;
    });
  }
  if (target.columnValueFilters?.[oldName] !== undefined) {
    target.columnValueFilters[newName] = target.columnValueFilters[oldName];
    delete target.columnValueFilters[oldName];
  }
  if (target.sortConfig?.key === oldName) target.sortConfig.key = newName;
  if (target.groupBy === oldName) target.groupBy = newName;
  if (target.entityNameProp === oldName) target.entityNameProp = newName;
  if (Array.isArray(target.fields)) target.fields = target.fields.map(n => n === oldName ? newName : n);
  if (target.formConfig) _renameViewConfigPropReferences(target.formConfig, oldName, newName);
  const ts = target.typeSpecific;
  if (ts && typeof ts === 'object') {
    if (ts.pivot?.groupBy === oldName) ts.pivot.groupBy = newName;
    if (ts.kanban?.groupBy === oldName) ts.kanban.groupBy = newName;
    const tree = ts.tree;
    if (tree && typeof tree === 'object') {
      ['parentProp', 'orderProp', 'labelProp', 'typeProp', 'colorProp', 'collapsedProp'].forEach(key => {
        if (tree[key] === oldName) tree[key] = newName;
      });
    }
    const mapping = ts.calendar?.mapping;
    if (mapping && typeof mapping === 'object') {
      ['startProp', 'endProp', 'titleProp', 'colorProp', 'descriptionProp', 'locationProp', 'urlProp', 'calendarIdProp'].forEach(key => {
        if (mapping[key] === oldName) mapping[key] = newName;
      });
    }
    const timeline = ts.timeline;
    if (timeline && typeof timeline === 'object') {
      ['timeProp', 'endProp', 'rowProp'].forEach(key => {
        if (timeline[key] === oldName) timeline[key] = newName;
      });
      if (Array.isArray(timeline.cardProps)) timeline.cardProps = timeline.cardProps.map(n => n === oldName ? newName : n);
      if (timeline.colWidths?.[oldName] !== undefined) {
        timeline.colWidths[newName] = timeline.colWidths[oldName];
        delete timeline.colWidths[oldName];
      }
    }
    if (ts.chart?.xProperty === oldName) ts.chart.xProperty = newName;
    if (ts.chart?.yProperty === oldName) ts.chart.yProperty = newName;
    if (ts.graph?.colorProperty === oldName) ts.graph.colorProperty = newName;
    if (ts.form?.formConfig) _renameViewConfigPropReferences(ts.form.formConfig, oldName, newName);
  }
  for (const key of ["required"]) {
    if (Array.isArray(target[key])) target[key] = target[key].map(n => n === oldName ? newName : n);
  }
  for (const key of ["descriptions", "placeholders", "labels"]) {
    if (target[key]?.[oldName] !== undefined) {
      target[key][newName] = target[key][oldName];
      delete target[key][oldName];
    }
  }
}

function _renameValidationRulesForColumn(sourceDbPath, oldName, newName, propertyId) {
  if (typeof localStorage === 'undefined' || !globalThis.GbDbSchemaMutation) {
    return { changed: 0, undo: () => {} };
  }
  const source = typeof _dbNormalizePath === 'function'
    ? _dbNormalizePath(sourceDbPath)
    : String(sourceDbPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const snapshots = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith('validationRules:')) continue;
    const raw = localStorage.getItem(key);
    let rules;
    try { rules = JSON.parse(raw || '[]'); } catch { continue; }
    if (!Array.isArray(rules)) continue;
    const storedDb = key.slice('validationRules:'.length);
    const dependentDbPath = (typeof _fileIdToPath === 'function' && _fileIdToPath(storedDb)) || storedDb;
    let next = JSON.parse(JSON.stringify(rules));
    const dependent = typeof _dbNormalizePath === 'function'
      ? _dbNormalizePath(dependentDbPath)
      : String(dependentDbPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (dependent === source) {
      globalThis.GbDbSchemaMutation.renameExactRefs(next, oldName, newName);
    }
    const rewritten = globalThis.GbDbSchemaMutation.renameDependentRefs(
      { view_config: { validationRules: next } },
      {
        sourceDbPath,
        dependentDbPath,
        oldName,
        newName,
        propertyId,
      }
    );
    next = rewritten.metadata?.view_config?.validationRules || next;
    const nextRaw = JSON.stringify(next);
    if (nextRaw === JSON.stringify(rules)) continue;
    snapshots.push({ key, raw });
    localStorage.setItem(key, nextRaw);
  }
  return {
    changed: snapshots.length,
    undo: () => snapshots.forEach(snapshot => {
      if (snapshot.raw == null) localStorage.removeItem(snapshot.key);
      else localStorage.setItem(snapshot.key, snapshot.raw);
    }),
  };
}

// ctxOverride: 呼び出し側が既に持っているペインctxを直接渡すためのオプション引数。値の移設
// （entities のcandidateを oldName から newName へ移す下の for ループ）は pivotData.entities
// を辿るため、正しい ctx が無いと「登録済みペインの pivotData」ではなく state.pivotData
// （現在グローバルにアクティブな別ペインの pivotData、または何も開いていなければ空）を誤って
// 対象にしてしまう。埋め込みシート（グローバル _panes レジストリに未登録）から呼ぶ場合は特に
// 必須（_dbFindPaneContextForPath() のレジストリ探索では見つからないため）。渡さない場合は
// 従来通りの再解決にフォールバックする（挙動は変わらない）。2026-07-15 フェーズD1で確認。
async function renameDbProperty(dbPath, oldName, newName, ctxOverride, opts = {}) {
  if (!dbPath || !oldName || !newName || oldName === newName) return false;
  const targetCtx = ctxOverride || (typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null);
  const renameProtectionLevel = _dbSchemaProtectionLevel(dbPath, oldName);
  if (renameProtectionLevel) {
    _showSchemaProtectionBlockedStatus(renameProtectionLevel);
    return false;
  }
  const beforeCfg = JSON.parse(JSON.stringify(getDbViewConfig(dbPath)));
  const beforePropertyTypes = JSON.parse(JSON.stringify(
    (typeof getPropertyTypes === 'function'
      ? getPropertyTypes(dbPath, targetCtx)
      : beforeCfg.propertyTypes) || {}
  ));
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(targetCtx) : null) || (_ptIsCurrentDbPath(dbPath) ? state.pivotData : null);
  const c = getDbViewConfig(dbPath);
  const rawExistingProps = [
    ...(Array.isArray(pivotData?.properties) ? pivotData.properties : []),
    ...(Array.isArray(c.colOrder) ? c.colOrder : []),
    ...Object.keys(c.propertyTypes || {}),
    ...Object.keys(getPropertyTypes(dbPath, targetCtx) || {}),
  ];
  const existingProps = new Set(
    typeof filterDeletedDbProperties === 'function'
      ? filterDeletedDbProperties(dbPath, rawExistingProps)
      : rawExistingProps
  );
  if (existingProps.has(newName) && newName !== oldName) {
    showStatus('同じ名前の列が既にあります: ' + newName, true);
    return false;
  }
  if (Array.isArray(c.colOrder)) c.colOrder = c.colOrder.map(n => n === oldName ? newName : n);
  const pt = JSON.parse(JSON.stringify(getPropertyTypes(dbPath, targetCtx) || {}));
  if (pt[oldName]) { pt[newName] = pt[oldName]; delete pt[oldName]; }
  Object.values(pt).forEach(cfg => _renamePropertyTypeReferences(cfg, oldName, newName, pt));
  const propertyId = pt[newName]?.property_id
    || targetCtx?.dbMetadata?.property_ids?.[oldName]
    || (_ptIsCurrentDbPath(dbPath) ? state.dbMetadata?.property_ids?.[oldName] : '')
    || '';
  c.propertyTypes = pt;
  if (c.colWidths?.[oldName] !== undefined) { c.colWidths[newName] = c.colWidths[oldName]; delete c.colWidths[oldName]; }
  if (c.columnLocks?.[oldName]) {
    c.columnLocks[newName] = c.columnLocks[oldName];
    delete c.columnLocks[oldName];
  }
  if (c.countTypes?.[oldName]) {
    c.countTypes[newName] = c.countTypes[oldName];
    delete c.countTypes[oldName];
  }
  if (Array.isArray(c.pinnedCols)) c.pinnedCols = c.pinnedCols.map(n => n === oldName ? newName : n);
  if (Array.isArray(c.hiddenCols)) c.hiddenCols = c.hiddenCols.map(n => n === oldName ? newName : n);
  if (Array.isArray(c.entryPropOrder)) c.entryPropOrder = c.entryPropOrder.map(n => n === oldName ? newName : n);
  if (c.propertyLayout && typeof renamePropertyLayoutReferences === 'function') {
    c.propertyLayout = renamePropertyLayoutReferences(c.propertyLayout, oldName, newName);
  }
  if (Array.isArray(c.advancedFilters)) {
    c.advancedFilters.forEach(filter => {
      if (filter?.property === oldName) filter.property = newName;
      if (filter?.prop === oldName) filter.prop = newName;
    });
  }
  if (c.columnValueFilters?.[oldName] !== undefined) {
    c.columnValueFilters[newName] = c.columnValueFilters[oldName];
    delete c.columnValueFilters[oldName];
  }
  if (c.conditionalColors?.[oldName]) {
    c.conditionalColors[newName] = c.conditionalColors[oldName];
    delete c.conditionalColors[oldName];
  }
  if (c.sortConfig?.key === oldName) c.sortConfig.key = newName;
  if (c.groupBy === oldName) c.groupBy = newName;
  if (c.formConfig) _renameViewConfigPropReferences(c.formConfig, oldName, newName);
  _renameViewConfigPropReferences(c, oldName, newName);
  (c.savedViews || []).forEach(view => _renameViewConfigPropReferences(view, oldName, newName));
  saveDbViewConfig(dbPath, c, { skipBackend: true, ctx: targetCtx });
  if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata) {
    state.dbMetadata.property_types = pt;
    if (state.dbMetadata.property_layout && typeof renamePropertyLayoutReferences === 'function') {
      state.dbMetadata.property_layout = renamePropertyLayoutReferences(state.dbMetadata.property_layout, oldName, newName);
    }
  }
  const entities = pivotData?.entities || {};
  const valueErrors = [];
  const movedValueRefs = [];
  // 描画に使う pivotData の列名を付け替える共通処理。properties と entities を一緒に
  // 付け替える（properties だけ新名にして entities を旧名のまま残すと、その pivotData を
  // 描画するペインがヘッダー新名＋空セル＝データ消失に見えるため）。付け替え元のキーが
  // 既に無ければ no-op＝冪等。分割ビューで同一シートを別ペインに開いている場合の
  // state.pivotData（別オブジェクト）にも同じ移行を適用する。
  const _renamePivotLocal = (pd, fromName, toName) => {
    if (!pd) return;
    if (Array.isArray(pd.properties)) {
      pd.properties = [...new Set(pd.properties.map(n => (n === fromName ? toName : n)))];
    }
    if (pd.entities && typeof pd.entities === 'object') {
      Object.values(pd.entities).forEach(ent => {
        if (ent && Array.isArray(ent[fromName])) {
          ent[toName] = ent[fromName].map(v => ({ ...v, property: toName }));
          delete ent[fromName];
        }
      });
    }
  };
  const _applyPivotRename = (fromName, toName) => {
    if (typeof _dbPaneContextsForPath === 'function') {
      _dbPaneContextsForPath(dbPath).forEach(paneCtx => _renamePivotLocal(paneCtx?.pivotData, fromName, toName));
    } else {
      _renamePivotLocal(pivotData, fromName, toName);
    }
    if (_ptIsCurrentDbPath(dbPath) && state.pivotData && state.pivotData !== pivotData) {
      _renamePivotLocal(state.pivotData, fromName, toName);
    }
  };
  const applyTypesToOpenContexts = (types, layout, viewConfig) => {
    const targets = [];
    const add = candidate => {
      if (candidate && !targets.includes(candidate)) targets.push(candidate);
    };
    add(targetCtx);
    if (typeof _dbPaneContextsForPath === 'function') _dbPaneContextsForPath(dbPath).forEach(add);
    targets.forEach(paneCtx => {
      if (!paneCtx.dbMetadata) paneCtx.dbMetadata = {};
      paneCtx.dbMetadata.property_types = JSON.parse(JSON.stringify(types || {}));
      paneCtx.dbMetadata.property_layout = layout == null ? null : JSON.parse(JSON.stringify(layout));
      paneCtx.dbMetadata.view_config = JSON.parse(JSON.stringify(viewConfig || {}));
    });
    if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata) {
      state.dbMetadata.property_types = JSON.parse(JSON.stringify(types || {}));
      state.dbMetadata.property_layout = layout == null ? null : JSON.parse(JSON.stringify(layout));
      state.dbMetadata.view_config = JSON.parse(JSON.stringify(viewConfig || {}));
    }
  };
  applyTypesToOpenContexts(pt, c.propertyLayout || null, c);
  const validationMutation = _renameValidationRulesForColumn(
    dbPath, oldName, newName, propertyId
  );
  const restoreBeforeConfig = async () => {
    saveDbViewConfig(dbPath, beforeCfg, { skipBackend: true, ctx: targetCtx });
    const restoredTypes = Object.keys(beforePropertyTypes).length ? beforePropertyTypes : (beforeCfg.propertyTypes || {});
    applyTypesToOpenContexts(restoredTypes, beforeCfg.propertyLayout || null, beforeCfg);
    const cfg = getDbViewConfig(dbPath);
    cfg.propertyTypes = JSON.parse(JSON.stringify(restoredTypes));
    saveDbViewConfig(dbPath, cfg, { skipBackend: true, skipHistory: true, ctx: targetCtx });
    await _savePropertyTypesToBackend(dbPath, {
      property_layout: beforeCfg.propertyLayout || null,
      view_config: beforeCfg,
    }, targetCtx);
  };
  const rollbackMovedValues = async () => {
    for (const ref of [...movedValueRefs].reverse()) {
      try { await _apiPutValue(ref, { new_property: oldName }); } catch {}
    }
  };
  // 楽観的描画のロールバック: 付け替えた pivotData を旧名へ戻し、設定も戻して再描画する。
  const rollbackOptimistic = async () => {
    _applyPivotRename(newName, oldName);
    validationMutation.undo();
    try { await restoreBeforeConfig(); } catch (error) {
      console.error('列名変更の設定ロールバックに失敗:', error);
    }
    if (typeof _renderCurrentDbView === 'function' && targetCtx) _renderCurrentDbView(targetCtx, dbPath);
    else if (typeof renderPivot === 'function' && targetCtx) renderPivot(targetCtx);
  };
  // レガシー（旧マークダウン）形式は下の逐次経路でサーバーへ値を移送する。楽観的に
  // entities を新名へ移すと ent[oldName] が消えて逐次 PUT が飛ばなくなるため、移送前に
  // 旧名の値配列（参照）をスナップショットしておく。
  const fallbackMoves = [];
  for (const ent of Object.values(entities)) {
    if (ent && Array.isArray(ent[oldName])) fallbackMoves.push({ vals: ent[oldName] });
  }
  // 楽観的描画: サーバー往復を待たず、ローカルの表示モデル（pivotData の列名・値、
  // 直前に更新済みの viewConfig / state.dbMetadata.property_types）を新名へ付け替えて
  // 即座に描画する。これで「Enter しても反映されない」を解消する。サーバー保存が失敗した
  // 場合は rollbackOptimistic() で元に戻す。
  _applyPivotRename(oldName, newName);
  if (typeof _renderCurrentDbView === 'function' && targetCtx) _renderCurrentDbView(targetCtx, dbPath);
  else if (typeof renderPivot === 'function' && targetCtx) renderPivot(targetCtx);
  // SQLiteネイティブシートはサーバー側で列名を全エントリ一括変更する。
  // 従来は1マスずつ PUT し、そのたびにシート全体のスナップショットを保存していたため
  // 数百行の列で数百往復＋数百スナップショットになり、確定に数秒かかっていた。
  let bulkRenamed = false;
  try {
    if (!globalThis.GbDbSchemaMutation) {
      throw new Error('列スキーマ変更モジュールを読み込めませんでした。アプリを再読み込みしてください。');
    }
    const bulk = await globalThis.GbDbSchemaMutation.renameRemote({
      dbPath, oldName, newName, ctx: targetCtx, propertyId, propertyTypes: pt,
    });
    if (bulk && bulk.ok && !bulk.fallback) {
      bulkRenamed = true;
    } else if (bulk && bulk.conflict) {
      await rollbackOptimistic();
      showStatus('同じ名前の列が既にあります: ' + newName, true);
      return false;
    }
    // bulk.fallback（旧マークダウン形式）の場合は下の逐次経路へ
  } catch (e) {
    if (e?.resultUnknown) {
      showStatus('列名変更の結果を確認できませんでした。シートを再読み込みして確認します。', true);
      if (globalThis.GbDbEntryIdentity && targetCtx) {
        try { await globalThis.GbDbEntryIdentity.reload(targetCtx, dbPath); } catch (reloadError) {
          console.error('列名変更結果不明後の再読み込みに失敗:', reloadError, e);
        }
      }
      throw e;
    }
    await rollbackOptimistic();
    showStatus('列名変更に失敗: ' + (e?.message || e), true);
    throw e;
  }

  if (!bulkRenamed) {
    // レガシー形式: スナップショットした旧名の値をサーバーへ逐次移送する。
    // pivotData の表示は既に楽観移送済みなので、ここではサーバー側だけを更新する。
    for (const { vals } of fallbackMoves) {
      const moveVals = vals.slice().sort((a, b) => (Number(b?.candidate_index) || 0) - (Number(a?.candidate_index) || 0));
      for (const val of moveVals) {
        try {
          await _apiPutValue(val, { new_property: newName });
          movedValueRefs.push({ ...val, property: newName });
        }
        catch (e) { valueErrors.push(e); }
      }
      if (valueErrors.length) {
        await rollbackMovedValues();
        await rollbackOptimistic();
        const msg = valueErrors[0]?.message || valueErrors[0] || '値の更新に失敗しました';
        showStatus('列名変更に失敗: ' + msg, true);
        throw valueErrors[0] || new Error('rename value update failed');
      }
    }
  }
  if (typeof apiPost === 'function') {
    await apiPost('/annotations/rename-sheet-column', {
      target_file: dbPath,
      old_col: oldName,
      new_col: newName,
    }).catch((e) => console.warn('列名変更時の注釈参照更新に失敗:', e));
  }
  if (!bulkRenamed) {
    try {
      await _savePropertyTypesToBackend(dbPath, {
        property_layout: c.propertyLayout || null,
        view_config: c,
      }, targetCtx);
    } catch (error) {
      await rollbackMovedValues();
      await rollbackOptimistic();
      showStatus('列名変更の設定保存に失敗: ' + (error?.message || error), true);
      throw error;
    }
  }
  // Undo/Redo: 列削除と同型に、逆方向/順方向の renameDbProperty を呼び直す。
  // skipHistory で undo/redo 実行時の再帰 push を防ぐ。ctx はクロージャ実行時に再解決し、
  // ペインの開き直しにも追従させる（捕捉した targetCtx は stale になり得る）。
  if (!opts.skipHistory && typeof historyPush === 'function' && typeof _dbScope === 'function') {
    historyPush('列名変更: ' + oldName + ' → ' + newName,
      async () => { // undo: 新名 → 旧名へ戻す
        await renameDbProperty(dbPath, newName, oldName, _ptContextForDbPath(dbPath), { skipHistory: true });
        if (typeof selectDatabase === 'function') selectDatabase(dbPath, _ptContextForDbPath(dbPath));
      },
      async () => { // redo: 旧名 → 新名へ再適用
        await renameDbProperty(dbPath, oldName, newName, _ptContextForDbPath(dbPath), { skipHistory: true });
        if (typeof selectDatabase === 'function') selectDatabase(dbPath, _ptContextForDbPath(dbPath));
      },
      (typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : _dbScope(dbPath))
    );
  }
  return true;
}

function showPropertyTypeModal(propName, dbPathOverride, ctxOverride) {
  const dbPath = dbPathOverride || state.currentDbPath;
  if (!dbPath) return;
  const ctx = ctxOverride || (typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null);
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(ctx) : null) || (_ptIsCurrentDbPath(dbPath) ? state.pivotData : null);
  const types = getPropertyTypes(dbPath);
  const current = types[propName] || { type: 'text' };

  // Select型の既存オプションを収集
  const existingValues = new Set();
  if (pivotData?.entities) {
    Object.values(pivotData.entities).forEach(ent => {
      (ent[propName] || []).forEach(v => existingValues.add(v.value));
    });
  }

  const o = document.createElement('div');
  o.className = 'modal-overlay';
  const scopeId = 'modal-' + Math.random().toString(36).slice(2, 8);
  o.innerHTML = `<div class="modal pt-modal" data-pt-root>
    <h3>列タイプの設定</h3>
    <div class="modal-body">
      <div class="gb-section-desc">列: ${esc(propName)}</div>
      <div class="field"><label>型</label>
        <select id="pt-type" data-onchange="onPropertyTypeChange(this.closest('[data-pt-root]'))">
          ${renderPropertyTypeOptions(current.type)}
        </select>
      </div>
      ${_renderPropertyMultiplicityControls(current.type, scopeId)}
      <div id="pt-options"></div>
    </div>
    <div class="btn-row">
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" id="modal-pt-apply">適用</button>
    </div>
  </div>`;
  document.body.appendChild(o);
  const root = o.querySelector('[data-pt-root]');
  // propName の ' や \ を保護するため直接バインド
  root.querySelector('#modal-pt-apply').addEventListener('click', () => applyPropertyType(propName, root));

  // 型別オプションを表示
  _ptSetState(root, current, [...existingValues], propName, dbPath, pivotData, ctx);
  onPropertyTypeChange(root);
  if (typeof enhancePropertyTypeSelect === 'function') enhancePropertyTypeSelect(root);
}

// DB一覧から選択するピッカー（relation参照先DB・MSRソース用）
let _dbListCache = null;
let _dbListCacheAt = 0;
async function _getAllDatabases(force) {
  // ピッカーを開くたびに最新化する（新規作成したシートが再読込まで候補に出ない問題を防ぐ）。
  if (!force && _dbListCache && (Date.now() - _dbListCacheAt < 4000)) return _dbListCache;
  try { _dbListCache = await apiFetch('/databases', { skipBrowseCache: true }); }
  catch { _dbListCache = _dbListCache || []; }
  _dbListCacheAt = Date.now();
  return _dbListCache;
}

// パスを絶対（スラッシュ区切り）へ正規化。相対パスは vault を前置する。
function _dbPickerNormAbs(p) {
  let s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!s) return '';
  if (/^[A-Za-z]:\//.test(s) || s.startsWith('/')) return s;
  const vault = (typeof state !== 'undefined' && state?.vaultPath) ? String(state.vaultPath).replace(/\\/g, '/').replace(/\/+$/, '') : '';
  return vault ? vault + '/' + s.replace(/^\/+/, '') : s;
}
function _dbPickerInside(childAbs, rootAbs) {
  return !!childAbs && !!rootAbs && (childAbs === rootAbs || childAbs.startsWith(rootAbs + '/'));
}
function _dbPickerWorkFolderAbs() {
  if (typeof getWorkFolder !== 'function') return '';
  const wf = getWorkFolder();
  return wf ? _dbPickerNormAbs(wf) : '';
}
function _dbPickerCurrentSheetAbs(dbPath) {
  return _dbPickerNormAbs(dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '');
}
// 作品フォルダが設定され、編集中シートがその中にある場合のみ、候補を作品フォルダ配下へ絞る
function _dbPickerScopeToWorkFolder(dbs, dbPath) {
  const wfAbs = _dbPickerWorkFolderAbs();
  if (!wfAbs) return { list: dbs, scoped: false };
  const curAbs = _dbPickerCurrentSheetAbs(dbPath);
  if (!curAbs || !_dbPickerInside(curAbs, wfAbs)) return { list: dbs, scoped: false };
  const list = dbs.filter(d => _dbPickerInside(_dbPickerNormAbs(d.path), wfAbs));
  return { list, scoped: true };
}
function _dbPickerRootKindLabel(kind) {
  if (kind === 'home') return 'ホームフォルダ';
  if (kind === 'workspace') return 'ワークスペース';
  return 'ソースフォルダ';
}
// 作品フォルダによる絞り込みが効かない場合、編集中シートを含むルート（ワークスペース/ソースフォルダ/ホーム）へ絞る（最長前置一致）
function _dbPickerScopeToRoot(dbs, dbPath, roots) {
  if (!Array.isArray(roots) || !roots.length) return { list: dbs, scoped: false };
  const curAbs = _dbPickerCurrentSheetAbs(dbPath);
  if (!curAbs) return { list: dbs, scoped: false };
  let bestRoot = null;
  let bestRootAbs = '';
  roots.forEach(root => {
    const rootAbs = _dbPickerNormAbs(root.rootPath || root.path);
    if (rootAbs && _dbPickerInside(curAbs, rootAbs) && rootAbs.length >= bestRootAbs.length) {
      bestRoot = root;
      bestRootAbs = rootAbs;
    }
  });
  if (!bestRoot) return { list: dbs, scoped: false };
  const list = dbs.filter(d => _dbPickerInside(_dbPickerNormAbs(d.path), bestRootAbs));
  return { list, scoped: true, root: bestRoot };
}

// フラットな /databases 一覧から「ルート → フォルダ → シート」のツリーを組む
function _dbPickerBuildTree(dbs) {
  const roots = new Map();
  const ensureRoot = (name) => {
    if (!roots.has(name)) roots.set(name, { name, kind: 'root', folders: new Map(), sheets: [], id: 'root:' + name });
    return roots.get(name);
  };
  dbs.forEach(d => {
    const rootName = d.rootName || d.name || '(その他)';
    const rel = String(d.relPath || d.name || '').replace(/\\/g, '/');
    const segs = rel.split('/').filter(Boolean);
    let node = ensureRoot(rootName);
    const folderSegs = segs.slice(0, -1);
    let idPath = node.id;
    folderSegs.forEach(seg => {
      idPath += '/' + seg;
      if (!node.folders.has(seg)) node.folders.set(seg, { name: seg, kind: 'folder', folders: new Map(), sheets: [], id: idPath });
      node = node.folders.get(seg);
    });
    node.sheets.push(d);
  });
  return roots;
}

function _attachDbPicker(input, dbPath) {
  // inputの隣にピッカーボタンを追加
  if (input.dataset.dbPickerAttached) return;
  input.dataset.dbPickerAttached = '1';
  let stack = input.closest?.('.db-picker-field-stack') || null;
  const inputHost = input.parentElement?.classList?.contains('gb-middle-ellipsis-input-wrap')
    ? input.parentElement
    : input;
  let row = inputHost.parentNode;
  if (!row || !row.classList || !row.classList.contains('db-picker-input-row')) {
    stack = document.createElement('div');
    stack.className = 'db-picker-field-stack';
    row = document.createElement('div');
    row.className = 'db-picker-input-row';
    inputHost.parentNode.insertBefore(stack, inputHost);
    stack.appendChild(row);
    row.appendChild(inputHost);
  } else if (!stack) {
    stack = document.createElement('div');
    stack.className = 'db-picker-field-stack';
    row.parentNode.insertBefore(stack, row);
    stack.appendChild(row);
  }
  // 作品フォルダ内のシートを候補（datalist）として提示する
  const listId = 'db-picker-dl-' + Math.random().toString(36).slice(2, 8);
  const datalist = document.createElement('datalist');
  datalist.id = listId;
  input.setAttribute('list', listId);
  row.appendChild(datalist);
  // 絞り込みが効いている間は、黙って全件出ないように一言添える（行き止まり感の防止）
  const scopeHint = document.createElement('div');
  scopeHint.className = 'db-picker-scope-hint';
  scopeHint.hidden = true;
  stack.appendChild(scopeHint);
  let _rootsCache = null;
  const _ensureRoots = async () => {
    if (_rootsCache) return _rootsCache;
    if (typeof window.GBFolderPicker?.loadRoots === 'function') {
      try { _rootsCache = await window.GBFolderPicker.loadRoots(); }
      catch { _rootsCache = []; }
    } else {
      _rootsCache = [];
    }
    return _rootsCache;
  };
  const refreshCandidates = async () => {
    const dbs = await _getAllDatabases();
    let { list, scoped } = _dbPickerScopeToWorkFolder(dbs, dbPath);
    let hintText = '';
    if (scoped) {
      const wfName = (_dbPickerWorkFolderAbs().split('/').pop() || '作品フォルダ');
      hintText = `${wfName}（作品フォルダ）内のシートを表示中`;
    } else {
      const roots = await _ensureRoots();
      const rootScope = _dbPickerScopeToRoot(dbs, dbPath, roots);
      if (rootScope.scoped) {
        list = rootScope.list;
        scoped = true;
        hintText = `${rootScope.root.name}（${_dbPickerRootKindLabel(rootScope.root.kind)}）内のシートを表示中`;
      }
    }
    datalist.innerHTML = list.map(d => `<option value="${esc(d.path)}">${esc(d.name)}</option>`).join('');
    if (scoped) {
      scopeHint.textContent = hintText;
      scopeHint.hidden = false;
    } else {
      scopeHint.hidden = true;
    }
  };
  input.addEventListener('focus', () => { refreshCandidates(); });
  refreshCandidates();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'db-picker-btn';
  btn.innerHTML = lucide('folderTree', 14);
  btn.title = '一覧から選択';
  btn.setAttribute('aria-label', '一覧から選択');
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    document.querySelectorAll('.db-picker-popup').forEach(el => el.remove());
    if (typeof window.GBFolderPicker?.pickFolder === 'function') {
      const selection = await window.GBFolderPicker.pickFolder({
        title: 'シートを選択',
        selectFiles: true,
        fileTypes: ['database'],
        emptyText: 'この階層にフォルダとシートはありません。',
        searchProvider: () => _getAllDatabases(true),
        searchPlaceholder: 'シート名で検索...',
        revealPath: _dbPickerCurrentSheetAbs(dbPath),
      });
      if (selection && selection.path) {
        input.value = selection.path;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    const dbs = await _getAllDatabases(true); // ツリーは開くたびに最新（GBFolderPicker未定義時のフォールバック）
    _openDbTreePicker(btn, dbs, input, dbPath);
  });
  row.appendChild(btn);
  window.GBPathUtils?.bindMiddleEllipsisInput?.(input);
}

// 「一覧から選択」: 全ワークスペース/ソース/ホームを横断するフォルダツリーからシートを選ぶ
function _openDbTreePicker(anchorBtn, dbs, input, dbPath) {
  const pop = document.createElement('div');
  pop.className = 'db-picker-popup db-picker-tree';
  const search = document.createElement('input');
  search.type = 'text'; search.placeholder = 'シート名で検索...';
  pop.appendChild(search);
  const host = document.createElement('div');
  host.className = 'db-picker-tree-host';
  pop.appendChild(host);

  const curAbs = _dbPickerCurrentSheetAbs(dbPath);
  // 現在編集中シートの祖先フォルダIDを初期展開対象にする
  const expanded = new Set();
  {
    const roots = _dbPickerBuildTree(dbs);
    const markPath = (node, prefix) => {
      node.sheets.forEach(d => {
        if (_dbPickerNormAbs(d.path) === curAbs) {
          // このシートに至る祖先フォルダをすべて展開
          expanded.add(node.id);
          prefix.forEach(id => expanded.add(id));
        }
      });
      node.folders.forEach(child => markPath(child, [...prefix, node.id]));
    };
    roots.forEach(r => { markPath(r, []); });
    // ルートは常に展開初期表示
    roots.forEach(r => expanded.add(r.id));
  }

  const selectSheet = (d) => {
    input.value = d.path;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    pop.remove();
  };

  const render = (filter) => {
    host.innerHTML = '';
    const f = String(filter || '').toLowerCase().trim();
    const roots = _dbPickerBuildTree(dbs);
    const matchSheet = (d) => !f || d.name.toLowerCase().includes(f) || String(d.path).toLowerCase().includes(f);
    // ノードにフィルタ一致シートが子孫に存在するか
    const hasMatch = (node) => node.sheets.some(matchSheet) || [...node.folders.values()].some(hasMatch);
    let anyShown = false;
    const renderNode = (node, depth) => {
      if (f && !hasMatch(node)) return;
      const isOpen = f ? true : expanded.has(node.id); // 検索中は全開
      const rowEl = document.createElement('div');
      rowEl.className = 'db-picker-tree-row db-picker-tree-' + node.kind;
      rowEl.style.paddingLeft = (6 + depth * 14) + 'px';
      const icon = 'folder';
      rowEl.innerHTML = `<span class="db-picker-tw-caret">${isOpen ? '▾' : '▸'}</span>`
        + `<span class="db-picker-tw-icon">${lucide(icon, 13)}</span>`
        + `<span class="db-picker-tw-name">${esc(node.name)}</span>`;
      rowEl.addEventListener('click', () => {
        if (f) return; // 検索中はトグルしない
        if (expanded.has(node.id)) expanded.delete(node.id); else expanded.add(node.id);
        render(search.value);
      });
      host.appendChild(rowEl);
      if (!isOpen) return;
      // 子フォルダ → シートの順
      [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(child => renderNode(child, depth + 1));
      node.sheets.filter(matchSheet).sort((a, b) => a.name.localeCompare(b.name)).forEach(d => {
        anyShown = true;
        const sheetEl = document.createElement('div');
        const isCur = _dbPickerNormAbs(d.path) === curAbs;
        sheetEl.className = 'db-picker-tree-row db-picker-tree-sheet' + (isCur ? ' is-current' : '');
        sheetEl.style.paddingLeft = (6 + (depth + 1) * 14) + 'px';
        sheetEl.innerHTML = `<span class="db-picker-tw-caret"></span>`
          + `<span class="db-picker-tw-icon">${lucide('database', 13)}</span>`
          + `<span class="db-picker-tw-name">${esc(d.name)}</span>`;
        sheetEl.addEventListener('click', () => selectSheet(d));
        host.appendChild(sheetEl);
      });
    };
    [...roots.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(r => renderNode(r, 0));
    if (!anyShown && f) {
      const m = document.createElement('div');
      m.className = 'db-picker-empty';
      m.textContent = '該当なし';
      host.appendChild(m);
    }
  };
  render('');
  search.addEventListener('input', () => render(search.value));
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(pop, { trigger: () => anchorBtn, close: () => pop.remove() });
  }

  const rect = anchorBtn.getBoundingClientRect();
  { const z = _getZoom(); pop.style.left = Math.min(rect.left / z, window.innerWidth / z - 440) + 'px'; pop.style.top = (rect.bottom / z + 4) + 'px'; }
  document.body.appendChild(pop);
  clampPopupToViewport(pop);
  setTimeout(() => {
    search.focus();
    const closer = (ev) => { if (!pop.contains(ev.target) && ev.target !== anchorBtn) { pop.remove(); document.removeEventListener('pointerdown', closer); } };
    document.addEventListener('pointerdown', closer);
  }, 50);
}

// ボタンプロパティのアクション設定UI描画
function _renderButtonActions(actions, root) {
  const scope = _ptResolveRoot(root);
  const container = _ptGet('pt-btn-actions', scope);
  if (!container) return;
  container.innerHTML = '';
  const stateInfo = _ptState(scope);
  const rawAllProps = stateInfo.pivotData?.properties || [];
  const allProps = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(stateInfo.dbPath || state.currentDbPath || '', rawAllProps)
    : rawAllProps;
  const actionTypes = [
    { value: 'set-value', label: '値を設定' },
    { value: 'set-current-user', label: '現在のユーザーを設定' },
    { value: 'set-now', label: '現在の日時を設定' },
    { value: 'create-dependent', label: '依存エントリを作成' },
  ];

  actions.forEach((act, idx) => {
    const row = document.createElement('div');
    row.className = 'btn-action-row';

    // アクション型選択
    const typeSelect = document.createElement('select');
    typeSelect.className = 'btn-action-type';
    actionTypes.forEach(at => {
      const opt = document.createElement('option');
      opt.value = at.value; opt.textContent = at.label;
      if (at.value === act.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    row.appendChild(typeSelect);

    // パラメータ部分
    const paramDiv = document.createElement('span');
    paramDiv.className = 'btn-action-params';
    const renderParams = (type) => {
      paramDiv.innerHTML = '';
      if (type === 'set-value') {
        const propSel = document.createElement('select');
        propSel.className = 'btn-action-target';
        allProps.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; if (p === act.targetProp) o.selected = true; propSel.appendChild(o); });
        paramDiv.appendChild(propSel);
        paramDiv.appendChild(document.createTextNode(' = '));
        const valInput = document.createElement('input');
        valInput.type = 'text'; valInput.className = 'btn-action-value';
        valInput.value = act.value || ''; valInput.placeholder = '値';
        paramDiv.appendChild(valInput);
      } else if (type === 'set-current-user' || type === 'set-now') {
        const propSel = document.createElement('select');
        propSel.className = 'btn-action-target';
        allProps.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; if (p === act.targetProp) o.selected = true; propSel.appendChild(o); });
        paramDiv.appendChild(propSel);
      } else if (type === 'create-dependent') {
        const selected = new Set(Array.isArray(act.copyProps) ? act.copyProps : []);
        const wrap = document.createElement('div');
        wrap.className = 'btn-action-copy-props';
        wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;max-height:96px;overflow:auto;';
        allProps.forEach(p => {
          const lbl = document.createElement('label');
          lbl.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:12px;';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'btn-action-copy-prop';
          cb.value = p;
          cb.checked = selected.has(p);
          lbl.appendChild(cb);
          lbl.appendChild(document.createTextNode(p));
          wrap.appendChild(lbl);
        });
        paramDiv.appendChild(wrap);
      }
    };
    renderParams(act.type);
    typeSelect.addEventListener('change', () => {
      act.type = typeSelect.value;
      act.targetProp = ''; act.value = ''; act.copyProps = [];
      renderParams(typeSelect.value);
    });
    row.appendChild(paramDiv);

    // 削除ボタン
    const delBtn = document.createElement('button');
    delBtn.innerHTML = lucide('x', 12); delBtn.title = '削除';
    delBtn.className = 'pt-small-btn muted';
    delBtn.addEventListener('click', () => {
      const acts = _collectButtonActions(scope);
      acts.splice(idx, 1);
      _renderButtonActions(acts, scope);
    });
    row.appendChild(delBtn);

    container.appendChild(row);
  });
}

// ボタンプロパティのアクション設定をUIから収集
function _collectButtonActions(root) {
  const container = _ptGet('pt-btn-actions', root);
  if (!container) return [];
  const actions = [];
  container.querySelectorAll('.btn-action-row').forEach(row => {
    const type = row.querySelector('.btn-action-type')?.value || 'set-value';
    const act = { type };
    if (type === 'set-value') {
      act.targetProp = row.querySelector('.btn-action-target')?.value || '';
      act.value = row.querySelector('.btn-action-value')?.value || '';
    } else if (type === 'set-current-user' || type === 'set-now') {
      act.targetProp = row.querySelector('.btn-action-target')?.value || '';
    } else if (type === 'create-dependent') {
      act.copyProps = [...row.querySelectorAll('.btn-action-copy-prop:checked')].map(cb => cb.value);
    }
    actions.push(act);
  });
  return actions;
}

function _buttonActionResolveContext(dbPath, ctx) {
  if (ctx) return ctx;
  if (typeof _dbFindPaneContextForPath === 'function' && dbPath) {
    const paneCtx = _dbFindPaneContextForPath(dbPath);
    if (paneCtx) return paneCtx;
  }
  return typeof _currentPaneState === 'function' ? _currentPaneState() : null;
}

function _buttonActionCss(value) {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : String(value || '').replace(/["\\]/g, '\\$&');
}

function _buttonActionTargetCell(dbPath, entityName, propName, ctx) {
  const tableId = (ctx && ctx.tableId) || 'pivot-table';
  const root = (typeof _paneEl === 'function' && ctx ? _paneEl(ctx, '#' + tableId) : null)
    || document.getElementById(tableId)
    || document;
  return root.querySelector(`tbody tr[data-entity-name="${_buttonActionCss(entityName)}"] td[data-prop-name="${_buttonActionCss(propName)}"]`);
}

function _buttonActionEntityPath(dbPath, entityName, pivotData, entityData) {
  const groups = entityData && typeof entityData === 'object' ? Object.values(entityData) : [];
  for (const values of groups) {
    if (!Array.isArray(values)) continue;
    for (const candidate of values) {
      if (!candidate || typeof candidate !== 'object') continue;
      const rawPath = candidate.entry_path || candidate.entity_path || candidate.folder_path || candidate.file || '';
      if (!rawPath) continue;
      if (typeof _resolveEntityPathFromValObj === 'function') {
        const resolved = _resolveEntityPathFromValObj(candidate);
        if (resolved) return resolved;
      }
      const normalized = String(rawPath).replace(/\\/g, '/');
      if (normalized.endsWith('.md') && normalized.includes('/' + entityName + '/')) {
        return normalized.slice(0, normalized.lastIndexOf('/'));
      }
      return normalized.replace(/\/+$/, '');
    }
  }
  return _entityPath(dbPath, entityName, pivotData);
}

function _buttonActionUpdateLocalValue(dbPath, entityPath, entityName, propName, oldTarget, value, extra, ctx) {
  const contexts = [];
  const addContext = (targetCtx) => {
    if (targetCtx && !contexts.includes(targetCtx)) contexts.push(targetCtx);
  };
  addContext(ctx);
  if (typeof state !== 'undefined' && state.currentDbPath === dbPath) addContext(state);
  contexts.forEach(targetCtx => {
    if (typeof _upsertLocalPivotValue === 'function') {
      _upsertLocalPivotValue(entityPath, propName, oldTarget, value, extra, targetCtx);
      return;
    }
    const entityData = targetCtx?.pivotData?.entities?.[entityName];
    if (!entityData) return;
    if (!Array.isArray(entityData[propName])) entityData[propName] = [];
    let target = oldTarget && entityData[propName].includes(oldTarget) ? oldTarget : null;
    if (!target) {
      target = { property: propName, value: '', status: extra?.status || '採用', note: extra?.note || '' };
      entityData[propName].push(target);
    }
    target.value = value;
    if (extra?.file !== undefined) target.file = extra.file;
    if (extra?.property !== undefined) target.property = extra.property;
    if (extra?.candidate_index !== undefined) target.candidate_index = extra.candidate_index;
  });
}

function _buttonActionRefreshTargetCell(dbPath, entityPath, entityName, propName, ctx) {
  const td = _buttonActionTargetCell(dbPath, entityName, propName, ctx);
  const ptc = dbPath && typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)?.[propName] : null;
  if (td && typeof _refreshPivotRelationCell === 'function') {
    _refreshPivotRelationCell(td, entityPath, propName, ptc, { dbPath, ctx });
    if (typeof _refreshDerivedCellsInRow === 'function') _refreshDerivedCellsInRow(td, entityPath, { dbPath, ctx });
    return true;
  }
  if (typeof renderPivot === 'function') {
    renderPivot(ctx);
    return true;
  }
  return false;
}

async function _buttonActionWriteValue(dbPath, entityName, entityPath, propName, value, ctx) {
  if (!propName) return;
  const actionCtx = _buttonActionResolveContext(dbPath, ctx);
  const entityData = actionCtx?.pivotData?.entities?.[entityName] || state.pivotData?.entities?.[entityName] || null;
  const target = entityData ? getAdoptedValueForWrite(entityData[propName] || []) : null;
  if (target) {
    const oldVal = target.value;
    await _apiPutValue(target, { new_value: value });
    _dbUndoValue(propName, target, oldVal, value);
    _buttonActionUpdateLocalValue(dbPath, entityPath, entityName, propName, target, value, {}, actionCtx);
  } else {
    const result = await _apiPostValue(entityPath, propName, value, '採用', '');
    _buttonActionUpdateLocalValue(dbPath, entityPath, entityName, propName, null, value, {
      file: result?.path || result?.file,
      candidate_index: result?.candidate_index,
      status: '採用',
      note: '',
      property: propName,
    }, actionCtx);
  }
  _buttonActionRefreshTargetCell(dbPath, entityPath, entityName, propName, actionCtx);
}

// ボタンアクション実行エンジン
async function _executeButtonActions(dbPath, entityName, actions, ctx) {
  const targetDbPath = dbPath || state.currentDbPath || '';
  const actionCtx = _buttonActionResolveContext(targetDbPath, ctx);
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(actionCtx) : null) || (_ptIsCurrentDbPath(targetDbPath) ? state.pivotData : null);
  const entityData = actionCtx?.pivotData?.entities?.[entityName] || state.pivotData?.entities?.[entityName] || null;
  const entityPath = _buttonActionEntityPath(targetDbPath, entityName, pivotData, entityData);
  let needsReload = false;

  for (const action of actions) {
    switch (action.type) {
      case 'set-value': {
        await _buttonActionWriteValue(targetDbPath, entityName, entityPath, action.targetProp, action.value, actionCtx);
        break;
      }
      case 'set-current-user': {
        const username = typeof getUsername === 'function' ? getUsername() : 'anonymous';
        await _buttonActionWriteValue(targetDbPath, entityName, entityPath, action.targetProp, username, actionCtx);
        break;
      }
      case 'set-now': {
        const propTypes = targetDbPath ? getPropertyTypes(targetDbPath) : {};
        const targetPtc = propTypes[action.targetProp] || null;
        const now = typeof _dbDateCurrentValue === 'function'
          ? _dbDateCurrentValue(targetPtc)
          : new Date().toISOString().substring(0, 10);
        await _buttonActionWriteValue(targetDbPath, entityName, entityPath, action.targetProp, now, actionCtx);
        break;
      }
      case 'create-dependent': {
        await _createDependentEntry(targetDbPath, entityName, action.copyProps, actionCtx);
        needsReload = true;
        break;
      }
    }
  }

  if (needsReload && targetDbPath && typeof selectDatabase === 'function') {
    await selectDatabase(targetDbPath, actionCtx, { silent: true });
  }
}

// Phase 3 §5.1: カレンダー連動設定エディタ（date 型プロパティ用）
// calendarSync メタの targetDb / colorRules / テンプレ / onEntryDelete / reverseSync / writeStatus を UI で編集。
// 汎用性（N1）: 特定DB名をハードコードせず、汎用 DB パスピッカーで選択する。
function _renderCalendarSyncEditor(cs) {
  const enabled = !!cs;
  const safe = cs || {};
  const rules = Array.isArray(safe.colorRules) ? safe.colorRules : [];
  const rsObj = safe.reverseSync || {};
  const colorRulesJson = rules.length ? JSON.stringify(rules, null, 2) : '';
  return `
    <div class="gb-section-head" style="margin-top:12px;border-top:1px solid var(--border);padding-top:8px;">
      <div class="gb-check-help-row">
        <label class="pt-check-label">
          <input id="pt-calsync-enabled" type="checkbox" ${enabled ? 'checked' : ''}>
          カレンダー連動を有効にする
        </label>
        ${fieldHelp('オンにすると、この列に日時を設定したとき対象カレンダーシートへイベントが自動生成されます')}
      </div>
    </div>
    <div id="pt-calsync-body" style="${enabled ? '' : 'display:none;'}padding-left:8px;border-left:2px solid var(--border);margin-top:6px;">
      <div class="field"><label>対象カレンダーシート（フォルダパス）</label>
        <input id="pt-calsync-target-db" type="text" value="${esc(safe.targetDb || '')}" placeholder="例: ShareDevelop/Meldex開発/カレンダー/AI修正スケジュール">
      </div>
      <div class="field"><label>タイトルテンプレート ${fieldHelp('利用可能な変数: {entryName} / {entryPath} / {entryId}')}</label>
        <input id="pt-calsync-title-tmpl" type="text" value="${esc(safe.titleTemplate || '{entryName}')}" placeholder="{entryName}">
      </div>
      <div class="field"><label>説明テンプレート ${fieldHelp('テンプレ変数に加え、エントリの採用列名も {列名} で参照できます')}</label>
        <textarea id="pt-calsync-desc-tmpl" rows="3" placeholder="デバッグリストエントリ: {entryPath}">${esc(safe.descriptionTemplate || '')}</textarea>
      </div>
      <div class="field"><label>色ルール (JSON 配列) ${fieldHelp('上から順に評価し、最初にマッチしたルールの color を使います。default ルールがフォールバックになります')}</label>
        <textarea id="pt-calsync-color-rules" rows="5" placeholder='[
  { "when": { "prop": "進捗", "equals": "完了" }, "color": "#6a9955" },
  { "default": "#569cd6" }
]'>${esc(colorRulesJson)}</textarea>
      </div>
      <div class="field"><label>エントリ削除時の挙動</label>
        <select id="pt-calsync-on-entry-delete">
          <option value="deleteEvent" ${(safe.onEntryDelete || 'deleteEvent') === 'deleteEvent' ? 'selected' : ''}>イベントも削除</option>
          <option value="orphan" ${safe.onEntryDelete === 'orphan' ? 'selected' : ''}>孤立マーク（残す）</option>
          <option value="ignore" ${safe.onEntryDelete === 'ignore' ? 'selected' : ''}>何もしない</option>
        </select>
      </div>
      <div class="field"><label>日時クリア時の挙動</label>
        <select id="pt-calsync-on-date-cleared">
          <option value="deleteEvent" ${(safe.onDateCleared || 'deleteEvent') === 'deleteEvent' ? 'selected' : ''}>イベントを削除</option>
          <option value="ignore" ${safe.onDateCleared === 'ignore' ? 'selected' : ''}>何もしない</option>
        </select>
      </div>
      <div class="field">
        <label class="pt-check-label">
          <input id="pt-calsync-reverse-enabled" type="checkbox" ${rsObj.enabled !== false ? 'checked' : ''}>
          カレンダー側の変更を逆方向同期する
        </label>
        <label class="pt-check-label" style="margin-top:4px;">
          <input id="pt-calsync-reverse-skip-rec" type="checkbox" ${rsObj.skipIfRecurrence !== false ? 'checked' : ''}>
          繰り返し化されたイベントは逆方向同期しない（推奨）
        </label>
      </div>
      <div class="field"><label>書き戻し時のステータス</label>
        <input id="pt-calsync-write-status" type="text" value="${esc(safe.writeStatus || '採用')}" placeholder="採用">
      </div>
    </div>
  `;
}

function _bindCalendarSyncEditor(root) {
  const chk = _ptGet('pt-calsync-enabled', root);
  const body = _ptGet('pt-calsync-body', root);
  const tgt = _ptGet('pt-calsync-target-db', root);
  if (chk && body) {
    chk.addEventListener('change', () => { body.style.display = chk.checked ? '' : 'none'; });
  }
  if (tgt && typeof _attachDbPicker === 'function') _attachDbPicker(tgt, _ptState(root)?.dbPath);
}

// applyPropertyType から呼ばれる。calendarSync セクションの入力値を収集して返す（無効時は null）。
function _collectCalendarSyncConfig(root) {
  const chk = _ptGet('pt-calsync-enabled', root);
  if (!chk || !chk.checked) return null;
  const targetDb = _ptGet('pt-calsync-target-db', root)?.value?.trim() || '';
  if (!targetDb) {
    showStatus('カレンダー連動: 対象カレンダーシートを指定してください', true);
    throw new Error('calendarSync.targetDb is required');
  }
  const titleTemplate = _ptGet('pt-calsync-title-tmpl', root)?.value?.trim() || '{entryName}';
  const descriptionTemplate = _ptGet('pt-calsync-desc-tmpl', root)?.value || '';
  const rulesRaw = _ptGet('pt-calsync-color-rules', root)?.value?.trim() || '';
  let colorRules = [];
  if (rulesRaw) {
    try {
      colorRules = JSON.parse(rulesRaw);
      if (!Array.isArray(colorRules)) throw new Error('配列ではありません');
    } catch (e) {
      showStatus('色ルールのJSONが不正: ' + (e?.message || e), true);
      throw e;
    }
  }
  const onEntryDelete = _ptGet('pt-calsync-on-entry-delete', root)?.value || 'deleteEvent';
  const onDateCleared = _ptGet('pt-calsync-on-date-cleared', root)?.value || 'deleteEvent';
  const reverseSync = {
    enabled: !!_ptGet('pt-calsync-reverse-enabled', root)?.checked,
    syncDate: true,
    syncTitle: false,
    skipIfRecurrence: !!_ptGet('pt-calsync-reverse-skip-rec', root)?.checked,
  };
  const writeStatus = _ptGet('pt-calsync-write-status', root)?.value?.trim() || '採用';
  const out = { targetDb, titleTemplate, descriptionTemplate, onEntryDelete, onDateCleared, reverseSync, writeStatus };
  if (colorRules.length) out.colorRules = colorRules;
  return out;
}

// 選択肢欄の初期値: スキーマ登録済み選択肢に、列内で実際に使われている値
// （スキーマ未登録の値。型変更前の入力・外部書き込み等）を統合して表示する。
// これにより「選択肢の色」欄にも列内の全値が並び、値ごとに色を設定できる。
// マルチセレクトはカンマ結合で保存されるため個別値へ分割してから統合する。
// 行ごとに候補が変わる動的選択肢列（optionSource）では実在値を混ぜない。
function _ptMergedSelectOptions(current, existing, type) {
  const merged = [];
  const seen = new Set();
  const push = (value) => {
    const v = String(value ?? '').trim();
    if (v && !seen.has(v)) { seen.add(v); merged.push(v); }
  };
  (Array.isArray(current?.options) ? current.options : []).forEach(push);
  if (!current?.optionSource) {
    (existing || []).forEach(raw => {
      if (type === 'multi-select') String(raw ?? '').split(',').forEach(push);
      else push(raw);
    });
  }
  return merged;
}

function onPropertyTypeChange(root) {
  const scope = _ptResolveRoot(root);
  window._ptActiveRoot = scope;
  const baseType = _ptGet('pt-type', scope)?.value || 'text';
  const type = _ptReadUiType(scope);
  const optDiv = _ptGet('pt-options', scope);
  if (!optDiv) return;
  const multRow = _ptGet('pt-multiplicity-row', scope);
  if (multRow) {
    multRow.hidden = typeof isPropertyTypeMultiplicityBase === 'function'
      ? !isPropertyTypeMultiplicityBase(baseType)
      : !['select', 'relation', 'user'].includes(baseType);
  }
  const { current, existing, propName: statePropName, dbPath } = _ptState(scope);

  if (type === 'select' || type === 'multi-select') {
    const opts = _ptMergedSelectOptions(current, existing, type);
    const optionColorHelp = fieldHelp('色はセル・ドロップダウン・カンバン・グループヘッダーに反映されます。セル編集時の選択肢ドロップダウンからも設定できます')
      .replace('<span ', '<span data-e2e-id="pt-select-option-color-help" ');
    optDiv.innerHTML = `<div class="field"><label>選択肢（1行1項目）</label>
      <textarea id="pt-select-options" rows="5">${esc(opts.join('\n'))}</textarea>
    </div>
    <div class="field"><label>選択肢の色 ${optionColorHelp}</label>
      <div id="pt-select-option-colors" class="pt-option-color-list"></div>
    </div>`;
    scope._dbOptionColorBuffer = { ...(current.optionColors || {}) };
    if (typeof renderDbOptionColorEditor === 'function') {
      renderDbOptionColorEditor(_ptGet('pt-select-option-colors', scope), scope);
    }
  } else if (type === 'relation' || type === 'multi-relation') {
    // 現在のDBのリレーション型プロパティ一覧（カスケード元の候補）
    const relProps = [];
    const pts = getPropertyTypes(dbPath || state.currentDbPath);
    if (pts) {
      for (const [p, cfg] of Object.entries(pts)) {
        if ((cfg.type === 'relation' || cfg.type === 'multi-relation') && p !== (statePropName || '')) relProps.push(p);
      }
    }
    const cascadeOpts = relProps.map(p => `<option value="${esc(p)}"${p===(current.cascadeFrom||'')?'selected':''}>${esc(p)}</option>`).join('');
    // ペア候補: 同DB内の他のリレーションプロパティ
    const pairOpts = relProps.map(p => `<option value="${esc(p)}"${p===(current.pairWith||'')?'selected':''}>${esc(p)}</option>`).join('');
    optDiv.innerHTML = `<div class="field"><label>参照先シート ${fieldHelp(`指定したシート内のエントリ名がドロップダウンに表示されます。${type==='relation'?'単一選択（1つだけ選べます）':'複数選択（カンマ区切りで複数選べます）'}`)}</label>
      <input id="pt-relation-db" type="text" value="${esc(current.relationDb||'')}" placeholder="例: 設定/キャラ（空欄 = 自分自身のシート）">
    </div>
    <div class="field"><label>同一シート内の相互反映先の列 ${fieldHelp('同一シート内の自己参照リレーションで、片方を変更したとき相手側の列にも自動反映します')}</label>
      <select id="pt-pair-with">
        <option value="">(なし)</option>
        ${pairOpts}
      </select>
    </div>
    <div class="field"><label>タイムライン依存方向 ${fieldHelp('タイムラインの依存矢印で、列名に依存せず向きを決めます')}</label>
      <select id="pt-dependency-direction">
        <option value="" ${!current.dependencyDirection?'selected':''}>依存矢印に使わない</option>
        <option value="target-to-entry" ${current.dependencyDirection==='target-to-entry'?'selected':''}>参照先 → このエントリ</option>
        <option value="entry-to-target" ${current.dependencyDirection==='entry-to-target'?'selected':''}>このエントリ → 参照先</option>
      </select>
    </div>
    <div class="field">
      <div class="gb-check-help-row">
        <label class="pt-check-label">
          <input id="pt-bidirectional-enabled" type="checkbox" ${current.bidirectional ? 'checked' : ''}>
          双方向リレーション
        </label>
        ${fieldHelp('参照先シート側にも対応する列を持たせ、どちら側の編集でも相手シートへ反映します。初期値はオフです')}
      </div>
    </div>
    <div id="pt-bidirectional-prop-row" class="field"${current.bidirectional ? '' : ' style="display:none;"'}><label>参照先シート側の対応列 ${fieldHelp('未作成なら自動で作成し、既存なら双方向設定を付与します')}</label>
      <input id="pt-bidirectional-prop" type="text" value="${esc(current.bidirectionalProp || statePropName || '')}" placeholder="空欄なら同名">
    </div>
    <div class="field"><label>絞り込み（カスケード）</label>
      <select id="pt-cascade-from">
        <option value="">(なし)</option>
        ${cascadeOpts}
      </select>
    </div>
    <div id="pt-cascade-key-row" class="field"${current.cascadeFrom?'':' style="display:none;"'}><label>参照先シート側の絞り込み列 ${fieldHelp('参照先シートの各エントリについて、この列の値が依存元の選択値と一致するものだけを候補に出します')}</label>
      <input id="pt-cascade-key" type="text" value="${esc(current.cascadeKey||current.cascadeFrom||'')}" placeholder="参照先シート側で照合に使う列名">
    </div>`;
    // DBピッカーを参照先DB入力に取り付け
    setTimeout(() => { const dbInput = _ptGet('pt-relation-db', scope); if (dbInput) _attachDbPicker(dbInput, _ptState(scope)?.dbPath); }, 0);
    _ptGet('pt-bidirectional-enabled', scope)?.addEventListener('change', function() {
      const row = _ptGet('pt-bidirectional-prop-row', scope);
      const propInput = _ptGet('pt-bidirectional-prop', scope);
      if (!row || !propInput) return;
      if (this.checked) {
        row.style.display = '';
        if (!propInput.value) propInput.value = statePropName || '';
      } else {
        row.style.display = 'none';
      }
    });
    _ptGet('pt-cascade-from', scope)?.addEventListener('change', function() {
      const keyRow = _ptGet('pt-cascade-key-row', scope);
      const keyInput = _ptGet('pt-cascade-key', scope);
      if (this.value) {
        keyRow.style.display = '';
        if (!keyInput.value) keyInput.value = this.value;
      } else {
        keyRow.style.display = 'none';
        keyInput.value = '';
      }
    });
  } else if (type === 'number') {
    optDiv.innerHTML = `<div class="field"><label>単位（任意）</label>
      <input id="pt-number-unit" type="text" value="${esc(current.unit||'')}" placeholder="例: ページ, cm, kg">
    </div>`;
  } else if (type === 'formula') {
    optDiv.innerHTML = typeof _ptBuildFormulaOptionsHtml === 'function'
      ? _ptBuildFormulaOptionsHtml(current, scope)
      : `<div class="field"><label>数式（Notion互換構文） ${fieldHelp('使用可能: prop("名前"), if(条件, 真, 偽), let/lets(変数, 値, ..., 本体), and, or, not, empty, contains, replace, floor, round, mod, toNumber, format, year, month, day, dateBetween, dateSubtract, now, +, -, *, /, >, <, ==, !=')}</label>
        <textarea id="pt-formula-src" class="pt-formula-textarea" rows="8">${esc(current.formula||'')}</textarea>
      </div>
      <div class="field">
        <button data-action="testFormula(this.closest('[data-pt-root]'))" class="pt-small-btn">テスト</button>
        <span id="pt-formula-result" class="pt-hint"></span>
      </div>`;
    if (typeof _ptBindFormulaEditor === 'function') _ptBindFormulaEditor(scope);
  } else if (type === 'rollup' && typeof buildRollupOptionsHtml === 'function') {
    const { dbPath, pivotData } = _ptState(scope);
    const rawProps = pivotData?.properties || [];
    const allProps = typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, rawProps) : rawProps;
    const propTypes = getPropertyTypes(dbPath);
    optDiv.innerHTML = buildRollupOptionsHtml(current, allProps, propTypes, scope);
    const relSel = _ptGet('rollup-relation-prop', scope);
    relSel?.addEventListener('change', () => onRollupRelationChange(relSel.value, null, scope));
  } else if (type === 'button') {
    optDiv.innerHTML = `<div class="field"><label>ボタンラベル</label>
      <input id="pt-btn-label" type="text" value="${esc(current.label||'実行')}" placeholder="実行">
    </div>
    <div class="field"><label>アクション</label>
      <div id="pt-btn-actions"></div>
      <button id="pt-btn-add-action" class="pt-small-btn">+ アクション追加</button>
    </div>`;
    _renderButtonActions(current.actions || [], scope);
    _ptGet('pt-btn-add-action', scope)?.addEventListener('click', () => {
      const acts = _collectButtonActions(scope);
      acts.push({ type: 'set-value', targetProp: '', value: '' });
      _renderButtonActions(acts, scope);
    });
  } else if (type === 'multi-source-relation') {
    const curMode = current.mode || 'manual';
    optDiv.innerHTML = `<div class="field"><label>モード</label>
      <select id="pt-msr-mode">
        <option value="manual" ${curMode==='manual'?'selected':''}>手動</option>
        <option value="auto" ${curMode==='auto'?'selected':''}>自動</option>
      </select>
    </div>
    <div class="field"><label>ソース</label>
      <div id="pt-msr-sources"></div>
      <button id="pt-msr-add-source" class="pt-small-btn">+ ソース追加</button>
    </div>`;
    _renderMsrSources(_msrNormalizeSourcesForEditor(current.sources || []), curMode, scope);
    _ptGet('pt-msr-mode', scope)?.addEventListener('change', function() {
      const s = _collectMsrSources(scope);
      _renderMsrSources(s, this.value, scope);
    });
    _ptGet('pt-msr-add-source', scope)?.addEventListener('click', () => {
      const s = _collectMsrSources(scope);
      const mode = _ptGet('pt-msr-mode', scope)?.value || 'manual';
      s.push({ sourceId: _msrCreateSourceId(), kind: 'sheet', db: '', label: '', matchRules: [] });
      _renderMsrSources(s, mode, scope);
    });
  } else if (type === 'date') {
    const curSource = current.source || '';
    const withTime = !!current.withTime;
    const isAutoSource = _ptIsAutoDateSource(curSource);
    const isRange = !!current.range && !isAutoSource;
    optDiv.innerHTML = `<div class="field"><label>データソース</label>
      <select id="pt-date-source">
        <option value="" ${!curSource?'selected':''}>候補値（通常）</option>
        <option value="created" ${curSource==='created'?'selected':''}>作成日時（自動・読み取り専用）</option>
        <option value="modified" ${curSource==='modified'?'selected':''}>更新日時（自動・読み取り専用）</option>
      </select>
    </div>
    <label class="pt-check-label">
      <input id="pt-date-with-time" type="checkbox" ${withTime?'checked':''}>
      時刻（時分）を入力できるようにする
    </label>
    <label class="pt-check-label">
      <input id="pt-date-range" type="checkbox" ${isRange?'checked':''} ${isAutoSource?'disabled':''}>
      開始と終了を持つ期間にする
    </label>
    <div id="pt-date-range-note" class="pt-hint"${isAutoSource?'':' style="display:none;"'}>
      自動日時は単一日時として扱います。
    </div>
    ${_renderCalendarSyncEditor(current.calendarSync || null)}`;
    _bindCalendarSyncEditor(scope);
    const srcSel = _ptGet('pt-date-source', scope);
    const rangeCb = _ptGet('pt-date-range', scope);
    const rangeNote = _ptGet('pt-date-range-note', scope);
    const syncCb = _ptGet('pt-calsync-enabled', scope);
    const syncBody = _ptGet('pt-calsync-body', scope);
    const refreshDateSourceUi = () => {
      if (!rangeCb || !rangeNote) return;
      if (_ptIsAutoDateSource(srcSel.value)) {
        rangeCb.disabled = true;
        rangeCb.checked = false;
        rangeNote.style.display = '';
        if (syncCb) {
          syncCb.disabled = true;
          syncCb.checked = false;
        }
        if (syncBody) syncBody.style.display = 'none';
      } else {
        rangeCb.disabled = false;
        rangeNote.style.display = 'none';
        if (syncCb) syncCb.disabled = false;
        if (syncBody && syncCb?.checked) syncBody.style.display = '';
      }
      _ptRefreshAutoFillVisibility(scope);
    };
    refreshDateSourceUi();
    srcSel?.addEventListener('change', refreshDateSourceUi);
  } else if (type === 'user' || type === 'multi-user') {
    const curSource = current.source || '';
    optDiv.innerHTML = `<div class="field"><label>データソース</label>
      <select id="pt-user-source">
        <option value="" ${!curSource?'selected':''}>候補値（通常）</option>
        <option value="modified_by" ${curSource==='modified_by'?'selected':''}>最終更新者（自動・読み取り専用）</option>
      </select>
    </div>`;
  } else if (type === 'image') {
    const options = current.options || {};
    const accept = Array.isArray(options.accept) ? options.accept.filter(ext => String(ext).toLowerCase() !== 'svg').join(', ') : 'png, jpg, jpeg, gif, webp';
    const uploadThumbSize = Math.max(64, Math.min(1024, parseInt(options.thumbnail_size, 10) || 256));
    const cellHeight = Math.max(32, Math.min(320, parseInt(options.cell_height ?? options.cell_thumbnail_size, 10) || Math.min(96, uploadThumbSize)));
    optDiv.innerHTML = `<div class="field"><label>最大枚数</label>
      <input id="pt-image-max-count" class="gb-num-input" type="number" min="1" max="100" value="${esc(options.max_count == null ? '' : options.max_count)}" placeholder="空欄 = 100">
    </div>
    <div class="field"><label>許可する拡張子</label>
      <input id="pt-image-accept" type="text" value="${esc(accept)}" placeholder="png, jpg, webp">
    </div>
    <div class="field"><label>表の画像高さ(px)</label>
      <input id="pt-image-cell-height" class="gb-num-input" type="number" min="32" max="320" value="${esc(cellHeight)}">
    </div>
    <div class="field"><label>保存サムネイルサイズ(px)</label>
      <input id="pt-image-thumb-size" class="gb-num-input" type="number" min="64" max="1024" value="${esc(uploadThumbSize)}">
    </div>`;
  } else {
    optDiv.innerHTML = '';
  }

  // Phase 3 §5.1 / §12.1: 全型共通の自動初期値設定（autoFillOnCreate）。
  // $ 接頭辞で動的評価: $today / $now / $currentUser / $version（§15.4.2）
  const curAutoCreate = (current.autoFillOnCreate != null) ? String(current.autoFillOnCreate) : '';
  const autoFillBlock = document.createElement('div');
  autoFillBlock.id = 'pt-auto-fill-block';
  autoFillBlock.className = 'gb-section-head';
  autoFillBlock.style.cssText = 'margin-top:12px;border-top:1px solid var(--border);padding-top:8px;';
  autoFillBlock.innerHTML = `
    <div class="field"><label>新規エントリ作成時の初期値 ${fieldHelp('$today / $now / $currentUser / $version が使えます。空欄なら自動入力しません')}</label>
      <input id="pt-auto-fill-on-create" type="text" value="${esc(curAutoCreate)}" placeholder="例: $now / $currentUser / $version / 提案">
    </div>
  `;
  const autoFillHelp = autoFillBlock.querySelector('.gb-field-help');
  if (autoFillHelp) autoFillHelp.dataset.e2eId = 'pt-auto-fill-on-create-help';
  optDiv.appendChild(autoFillBlock);
  _ptRefreshAutoFillVisibility(scope);
}

function _ptIsAutoDateSource(source) {
  return source === 'created' || source === 'modified';
}

function _ptIsReadOnlySource(root) {
  const scope = _ptResolveRoot(root);
  const type = _ptReadUiType(scope);
  if (type === 'date') return _ptIsAutoDateSource(_ptGet('pt-date-source', scope)?.value || '');
  if (type === 'user' || type === 'multi-user') return (_ptGet('pt-user-source', scope)?.value || '') === 'modified_by';
  return false;
}

function _ptRefreshAutoFillVisibility(root) {
  const scope = _ptResolveRoot(root);
  const block = _ptGet('pt-auto-fill-block', scope);
  if (!block) return;
  block.hidden = _ptIsReadOnlySource(scope);
}

function _ptResolveRoot(root) {
  if (root && root.querySelector) return root;
  return window._ptActiveRoot || document.querySelector('[data-pt-root]') || document;
}

function _ptGet(id, root) {
  const scope = _ptResolveRoot(root);
  return scope.querySelector ? scope.querySelector('#' + id) : document.getElementById(id);
}

function _ptState(root) {
  const scope = _ptResolveRoot(root);
  const useWindowFallback = scope === document || !scope._ptDbPath;
  const dbPath = scope._ptDbPath || (useWindowFallback ? window._ptDbPath : '') || state.currentDbPath || '';
  const isCurrent = typeof _ptIsCurrentDbPath === 'function'
    ? _ptIsCurrentDbPath(dbPath)
    : (!dbPath || !state.currentDbPath || dbPath === state.currentDbPath);
  return {
    current: scope._ptCurrent || (useWindowFallback ? window._ptCurrent : null) || {},
    existing: scope._ptExistingValues || (useWindowFallback ? window._ptExistingValues : null) || [],
    propName: scope._ptPropName || (useWindowFallback ? window._ptPropName : '') || '',
    dbPath,
    pivotData: scope._ptPivotData || (useWindowFallback ? window._ptPivotData : null) || (isCurrent ? state.pivotData : null) || null,
    ctx: scope._ptCtx || (useWindowFallback ? window._ptCtx : null) || null,
  };
}

function _ptSetState(root, current, existing, propName, dbPath, pivotData, ctx) {
  const scope = _ptResolveRoot(root);
  scope._ptCurrent = current || {};
  scope._ptExistingValues = existing || [];
  scope._ptPropName = propName || '';
  scope._ptDbPath = dbPath || state.currentDbPath || '';
  scope._ptPivotData = pivotData || null;
  scope._ptCtx = ctx || null;
  window._ptCurrent = scope._ptCurrent;
  window._ptExistingValues = scope._ptExistingValues;
  window._ptPropName = scope._ptPropName;
  window._ptDbPath = scope._ptDbPath;
  window._ptPivotData = scope._ptPivotData;
  window._ptCtx = scope._ptCtx;
}

function _ptReadUiType(root) {
  const scope = _ptResolveRoot(root);
  const baseType = _ptGet('pt-type', scope)?.value || 'text';
  const multi = _ptGet('pt-multiplicity-multiple', scope);
  const multiplicity = multi?.checked ? 'multiple' : 'single';
  return typeof composePropertyTypeFromUi === 'function'
    ? composePropertyTypeFromUi(baseType, multiplicity)
    : baseType;
}

function _renderPropertyMultiplicityControls(currentType, scopeId) {
  const currentMultiplicity = typeof getPropertyTypeMultiplicity === 'function'
    ? getPropertyTypeMultiplicity(currentType)
    : 'single';
  const group = 'pt-multiplicity-' + (scopeId || 'default');
  return `<div id="pt-multiplicity-row" class="field" hidden>
    <label>選択数</label>
    <div class="pt-radio-row">
      <label class="pt-check-label"><input id="pt-multiplicity-single" class="gb-radio" type="radio" name="${esc(group)}" value="single" ${currentMultiplicity !== 'multiple' ? 'checked' : ''} data-onchange="onPropertyTypeChange(this.closest('[data-pt-root]'))"> 単一</label>
      <label class="pt-check-label"><input id="pt-multiplicity-multiple" class="gb-radio" type="radio" name="${esc(group)}" value="multiple" ${currentMultiplicity === 'multiple' ? 'checked' : ''} data-onchange="onPropertyTypeChange(this.closest('[data-pt-root]'))"> 複数</label>
    </div>
  </div>`;
}

function _ptPivotDataForDbPath(dbPath) {
  const ctx = _ptContextForDbPath(dbPath);
  if (ctx?.pivotData) return ctx.pivotData;
  if (typeof _ptIsCurrentDbPath === 'function' ? _ptIsCurrentDbPath(dbPath) : (!dbPath || dbPath === state.currentDbPath)) {
    return state.pivotData || null;
  }
  return null;
}

function _propertySettingsExistingValues(propName, pivotData) {
  const existingValues = new Set();
  const data = pivotData || state.pivotData;
  if (data?.entities) {
    Object.values(data.entities).forEach(ent => {
      (ent[propName] || []).forEach(v => existingValues.add(v.value));
    });
  }
  return [...existingValues];
}

async function _ptRollbackOperations(operations) {
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    try { await operations[index](); } catch (error) {
      console.error('列設定のロールバックに失敗:', error);
    }
  }
}

async function _ptReloadOtherDbContexts(dbPath, currentCtx) {
  if (typeof _dbPaneContextsForPath !== 'function') return;
  const targets = _dbPaneContextsForPath(dbPath)
    .filter(ctx => ctx && ctx !== currentCtx && !ctx.destroyed);
  for (const target of targets) {
    try {
      if (globalThis.GbDbEntryIdentity) await globalThis.GbDbEntryIdentity.reload(target, dbPath);
      else if (typeof selectDatabase === 'function') {
        await selectDatabase(dbPath, target, { silent: true, skipRecent: true, skipNavPush: true });
      }
    } catch (error) {
      console.warn('別画面のシート再読込に失敗:', error);
    }
  }
}

async function applyPropertyType(propName, root, options = {}) {
  const scope = _ptResolveRoot(root);
  window._ptActiveRoot = scope;
  const type = _ptReadUiType(scope);
  const config = { type };
  const stateInfo = _ptState(scope);
  const dbPath = stateInfo.dbPath || state.currentDbPath || '';
  const ctx = stateInfo.ctx || _ptContextForDbPath(dbPath);
  const pivotData = stateInfo.pivotData || _ptPivotDataForDbPath(dbPath);
  const storedTypes = typeof getPropertyTypes === 'function'
    ? getPropertyTypes(dbPath, ctx)
    : null;
  const prev = JSON.parse(JSON.stringify(
    storedTypes?.[propName] || stateInfo.current || {}
  ));
  const relationConfigRollbackOps = [];

  if (type === 'select' || type === 'multi-select') {
    const textarea = _ptGet('pt-select-options', scope);
    if (textarea) config.options = textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (typeof collectDbOptionColors === 'function') {
      const optionColors = collectDbOptionColors(scope, prev.optionColors, config.options);
      if (optionColors && Object.keys(optionColors).length) config.optionColors = optionColors;
    }
  } else if (type === 'relation' || type === 'multi-relation') {
    const dbInput = _ptGet('pt-relation-db', scope);
    if (dbInput) {
      const inputPath = dbInput.value.trim();
      config.relationDb = typeof _dbCanonicalizeRelationDbPathForSave === 'function'
        ? _dbCanonicalizeRelationDbPathForSave(dbPath, inputPath)
        : inputPath;
    }
    const pairWith = _ptGet('pt-pair-with', scope)?.value || '';
    if (pairWith) config.pairWith = pairWith;
    const dependencyDirection = _ptGet('pt-dependency-direction', scope)?.value || '';
    if (dependencyDirection) config.dependencyDirection = dependencyDirection;
    const bidirectional = !!_ptGet('pt-bidirectional-enabled', scope)?.checked;
    const bidirectionalProp = _ptGet('pt-bidirectional-prop', scope)?.value?.trim() || propName;
    if (bidirectional) {
      config.bidirectional = true;
      config.bidirectionalProp = bidirectionalProp;
    }
    const cascadeFrom = _ptGet('pt-cascade-from', scope)?.value || '';
    const cascadeKey = _ptGet('pt-cascade-key', scope)?.value || '';
    if (cascadeFrom) { config.cascadeFrom = cascadeFrom; config.cascadeKey = cascadeKey || cascadeFrom; }
  } else if (type === 'number') {
    const unitInput = _ptGet('pt-number-unit', scope);
    if (unitInput) config.unit = unitInput.value.trim();
  } else if (type === 'formula') {
    const src = _ptGet('pt-formula-src', scope);
    if (src) config.formula = src.value;
  } else if (type === 'rollup' && typeof collectRollupConfig === 'function') {
    Object.assign(config, collectRollupConfig(scope));
  } else if (type === 'button') {
    config.label = _ptGet('pt-btn-label', scope)?.value || '実行';
    config.actions = _collectButtonActions(scope);
  } else if (type === 'multi-source-relation') {
    config.mode = _ptGet('pt-msr-mode', scope)?.value || 'manual';
    config.sources = _collectMsrSources(scope);
  } else if (type === 'date') {
    const src = _ptGet('pt-date-source', scope)?.value || '';
    if (src) config.source = src;
    if (_ptGet('pt-date-with-time', scope)?.checked) config.withTime = true;
    if (!_ptIsAutoDateSource(src) && _ptGet('pt-date-range', scope)?.checked) config.range = true;
  } else if (type === 'user' || type === 'multi-user') {
    const src = _ptGet('pt-user-source', scope)?.value || '';
    if (src) config.source = src;
  } else if (type === 'image') {
    const maxRaw = _ptGet('pt-image-max-count', scope)?.value || '';
    const maxCount = maxRaw ? Math.max(1, Math.min(100, parseInt(maxRaw, 10) || 100)) : null;
    const acceptRaw = _ptGet('pt-image-accept', scope)?.value || '';
    const accept = acceptRaw.split(',').map(s => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
    const cellHeight = Math.max(32, Math.min(320, parseInt(_ptGet('pt-image-cell-height', scope)?.value || '96', 10) || 96));
    const thumbSize = Math.max(64, Math.min(1024, parseInt(_ptGet('pt-image-thumb-size', scope)?.value || '256', 10) || 256));
    config.options = {
      max_count: maxCount,
      accept: accept.length ? accept.filter(ext => ext !== 'svg') : ['png', 'jpg', 'jpeg', 'gif', 'webp'],
      cell_height: cellHeight,
      thumbnail_size: thumbSize,
    };
  }

  // Phase 3 §5.1: calendarSync（date 型のみ）
  if (type === 'date') {
    let cs = null;
    try { cs = _ptIsAutoDateSource(config.source) ? null : _collectCalendarSyncConfig(scope); }
    catch { return; /* バリデーションエラーは既に showStatus 済み */ }
    if (cs) config.calendarSync = cs;
  }

  // Phase 3 §12.1: autoFillOnCreate（全型共通。既存の autoFillOnStatus とは独立して共存）
  const autoCreateRaw = _ptIsReadOnlySource(scope) ? '' : (_ptGet('pt-auto-fill-on-create', scope)?.value?.trim() || '');
  if (autoCreateRaw) config.autoFillOnCreate = autoCreateRaw;
  // 以前の autoFillOnStatus は別UI（gb-db-props.js 793行あたり）で編集されるため、存在すれば保持する
  if (prev.autoFillOnStatus && !('autoFillOnStatus' in config)) {
    config.autoFillOnStatus = prev.autoFillOnStatus;
  }
  // writeStatus もプロパティレベルで保持（autoFillOnCreate/calendarSync 共通）
  if (prev.writeStatus && !('writeStatus' in config)) {
    config.writeStatus = prev.writeStatus;
  }

  if ((type === 'relation' || type === 'multi-relation') && config.bidirectional && typeof _ensureBidirectionalRelationConfig === 'function') {
    try {
      const ensured = await _ensureBidirectionalRelationConfig(dbPath, propName, config);
      Object.assign(config, ensured?.config || ensured || {});
      if (ensured?.undo) relationConfigRollbackOps.push(ensured.undo);
    } catch (e) {
      await _ptRollbackOperations(relationConfigRollbackOps);
      showStatus('双方向リレーション設定に失敗: ' + (e?.message || e), true);
      return;
    }
  }
  if (typeof _disableBidirectionalRelationConfig === 'function') {
    try {
      const disabled = await _disableBidirectionalRelationConfig(dbPath, propName, prev, config);
      if (disabled?.undo) relationConfigRollbackOps.push(disabled.undo);
    } catch (e) {
      await _ptRollbackOperations(relationConfigRollbackOps);
      showStatus('双方向リレーション解除に失敗: ' + (e?.message || e), true);
      return;
    }
  }

  let optionMigration = null;
  if ((type === 'select' || type === 'multi-select') && globalThis.GbDbSchemaMutation) {
    try {
      const migration = await globalThis.GbDbSchemaMutation.migrateSelectOptions({
        dbPath,
        propName,
        type,
        oldOptions: prev.options || [],
        newOptions: config.options || [],
        pivotData,
        ctx,
      });
      optionMigration = migration;
      config.options = migration.options;
      const previousIds = { ...(prev.option_ids || {}) };
      const optionIds = {};
      Object.entries(migration.renamed || {}).forEach(([oldValue, newValue]) => {
        if (previousIds[oldValue]) optionIds[newValue] = previousIds[oldValue];
      });
      config.options.forEach(value => {
        optionIds[value] = optionIds[value] || previousIds[value] || globalThis.GbDbSchemaMutation.newId('option');
      });
      config.option_ids = optionIds;
      if (migration.preserved.length && typeof showStatus === 'function') {
        showStatus('使用中の候補は削除せず維持しました: ' + migration.preserved.join('、'));
      }
    } catch (e) {
      await _ptRollbackOperations(relationConfigRollbackOps);
      showStatus('候補値の移行に失敗: ' + (e?.message || e), true);
      return null;
    }
  }

  // Undo/Redo 用に変更前の型設定を控える（setPropertyType が書き換える前に取る）
  const beforeCfg = JSON.parse(JSON.stringify(prev));
  // 分割ペインの初回表示直後は state のグローバル参照がまだ対象ペインへ追従していない場合がある。
  // 対象 ctx を明示して同じメタデータを更新し、初回の型設定から即座に表へ反映する。
  let savePromise;
  try {
    savePromise = Promise.resolve(setPropertyType(dbPath, propName, config, ctx));
  } catch (e) {
    try { await optionMigration?.rollback?.(); } catch (rollbackError) {
      console.error('列設定保存開始失敗後の候補値復旧に失敗:', rollbackError, e);
    }
    await _ptRollbackOperations(relationConfigRollbackOps);
    showStatus('列設定の保存に失敗: ' + (e?.message || e), true);
    return null;
  }
  _ptSetState(scope, config, _propertySettingsExistingValues(propName, pivotData), propName, dbPath, pivotData, ctx);
  if (prev.type === 'image' && type !== 'image') {
    Promise.resolve(savePromise).then(() => apiPost('/media/rebuild-refs', {})).catch(() => {});
  }
  const overlay = scope.closest?.('.modal-overlay');
  if (overlay) overlay.remove();
  // 数式キャッシュをクリア
  if (type === 'formula') {
    for (const k in _formulaCache) delete _formulaCache[k];
  }
  if (options.render !== false) {
    if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
    else renderPivot(ctx);
  }
  // リレーションの参照先シートを変えた（または型をリレーションにした）直後は、新しい
  // 参照先の名前解決マップがまだ無く生ID（ent_xxx）が表示される。マップを取得し終えて
  // から描き直し、再読み込みを押さなくても名前で表示されるようにする。
  const _relTypes = ['relation', 'multi-relation', 'multi-source-relation'];
  const _relTargetMayHaveChanged = _relTypes.includes(type)
    && (prev.type !== type
      || (config.relationDb || '') !== (prev.relationDb || '')
      || type === 'multi-source-relation');
  if (_relTargetMayHaveChanged && typeof _preloadRelationMapsForDb === 'function') {
    Promise.resolve(_preloadRelationMapsForDb(dbPath, pivotData, ctx)).then(() => {
      if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
      else if (options.render !== false) renderPivot(ctx);
    }).catch(() => {});
  }
  try {
    await savePromise;
  } catch (e) {
    try { await optionMigration?.rollback?.(); } catch (rollbackError) {
      console.error('候補値のロールバックに失敗:', rollbackError);
    }
    await _ptRollbackOperations(relationConfigRollbackOps);
    const currentTypes = getPropertyTypes(dbPath, ctx) || {};
    if (Object.keys(beforeCfg).length) currentTypes[propName] = JSON.parse(JSON.stringify(beforeCfg));
    else delete currentTypes[propName];
    const localCfg = getDbViewConfig(dbPath);
    if (!localCfg.propertyTypes) localCfg.propertyTypes = {};
    if (Object.keys(beforeCfg).length) localCfg.propertyTypes[propName] = JSON.parse(JSON.stringify(beforeCfg));
    else delete localCfg.propertyTypes[propName];
    saveDbViewConfig(dbPath, localCfg, { skipBackend: true, skipHistory: true, ctx });
    const metadata = typeof _ptMetadataForDbPath === 'function' ? _ptMetadataForDbPath(dbPath, ctx) : null;
    if (metadata) metadata.property_types = currentTypes;
    if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
    if (globalThis.GbDbEntryIdentity && ctx) {
      try { await globalThis.GbDbEntryIdentity.reload(ctx, dbPath); } catch (reloadError) {
        console.error('列設定保存失敗後の再読み込みに失敗:', reloadError, e);
      }
    }
    showStatus('列設定の保存に失敗: ' + (e?.message || e), true);
    return null;
  }
  // 保存が確定してから履歴へ積む（型が実際に変わった時のみ。ヘルパー側でゲート）
  await _ptReloadOtherDbContexts(dbPath, ctx);
  _ptPushTypeChangeHistory(dbPath, propName, beforeCfg, config, ctx);
  return config;
}

function testFormula(root) {
  const scope = _ptResolveRoot(root);
  const src = _ptGet('pt-formula-src', scope)?.value || '';
  const resultEl = _ptGet('pt-formula-result', scope);
  if (!resultEl) return;
  if (!src.trim()) { resultEl.textContent = ''; return; }
  if (typeof _ptUpdateFormulaPreview === 'function') _ptUpdateFormulaPreview(scope);
  // 最初のエントリでテスト
  const { dbPath, pivotData } = _ptState(scope);
  const data = pivotData || state.pivotData;
  if (!data || !data.entities) { resultEl.textContent = 'データがありません'; return; }
  const firstEntity = Object.keys(data.entities)[0];
  if (!firstEntity) { resultEl.textContent = 'エントリがありません'; return; }
  const entityData = data.entities[firstEntity];
  let result;
  try {
    result = formulaEvalForEntity(src, entityData, { propTypes: getPropertyTypes(dbPath), dbPath });
  } catch (e) {
    result = { error: e?.message || String(e) };
  }
  if (result.error) {
    const loc = Number.isFinite(result.errorPos) ? '（位置 ' + (result.errorPos + 1) + '）' : '';
    resultEl.innerHTML = '<span style="color:var(--red);">エラー' + loc + ': ' + esc(result.error) + '</span>';
  } else {
    resultEl.innerHTML = '<span style="color:var(--green);">' + esc(firstEntity) + ' → ' + esc(String(result.value)) + '</span>';
  }
}

function _ptFormulaProps(root) {
  const stateInfo = _ptState(root);
  const props = stateInfo.pivotData?.properties || state.pivotData?.properties || [];
  if (!Array.isArray(props)) return [];
  const dbPath = stateInfo.dbPath || state.currentDbPath || '';
  return typeof filterDeletedDbProperties === 'function' ? filterDeletedDbProperties(dbPath, props) : props;
}

function _ptFormulaTemplates() {
  return [
    { label: 'if', snippet: 'if(prop("状態") == "完了", "完了", "未完了")' },
    { label: '日時差', snippet: 'dateBetween(now(), prop("開始日時"), "days")' },
    { label: '表示形式', snippet: 'format(prop("数値"), "#,##0.00")' },
  ];
}

function _ptBuildFormulaOptionsHtml(current, root) {
  const props = _ptFormulaProps(root);
  const propButtons = props.length
    ? props.map(p => '<button type="button" class="pt-small-btn" data-formula-prop="' + esc(p) + '">prop("' + esc(_formulaPropLiteral(p, '"')) + '")</button>').join('')
    : '<span class="pt-hint">利用可能な列がありません</span>';
  const templateButtons = _ptFormulaTemplates()
    .map(t => '<button type="button" class="pt-small-btn" data-formula-template="' + esc(t.snippet) + '">' + esc(t.label) + '</button>')
    .join('');
  return `<div class="field"><label>数式（Notion互換構文） ${fieldHelp('使用可能: prop("名前"), if, let/lets, and, or, not, empty, contains, replace, floor, round, mod, toNumber, format, year, month, day, dateBetween, dateSubtract, now, +, -, *, /, >, <, ==, !=')}</label>
    <textarea id="pt-formula-src" class="pt-formula-textarea" rows="8">${esc(current.formula||'')}</textarea>
    <div class="pt-formula-tools" aria-label="数式テンプレート">${templateButtons}</div>
    <div class="pt-formula-props" aria-label="列候補">${propButtons}</div>
    <pre id="pt-formula-preview" class="pt-formula-preview" aria-label="数式シンタックスプレビュー"></pre>
  </div>
  <div class="field">
    <button data-action="testFormula(this.closest('[data-pt-root]'))" class="pt-small-btn">テスト</button>
    <span id="pt-formula-result" class="pt-hint"></span>
  </div>`;
}

function _ptInsertFormulaText(textarea, text) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const nextPos = start + text.length;
  textarea.focus();
  textarea.setSelectionRange(nextPos, nextPos);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function _ptFormulaTokenClass(token) {
  if (token.type === 'str') return 'string';
  if (token.type === 'num') return 'number';
  if (token.type === 'bool') return 'boolean';
  if (token.type === 'id') return 'identifier';
  return 'operator';
}

function _ptHighlightFormula(src) {
  if (!src) return '';
  if (typeof formulaTokenize !== 'function') return esc(src);
  let tokens = [];
  try {
    tokens = formulaTokenize(src);
  } catch {
    return esc(src);
  }
  let cursor = 0;
  let html = '';
  tokens.forEach(token => {
    const start = Number.isFinite(token.pos) ? token.pos : cursor;
    const end = Number.isFinite(token.end) ? token.end : start + String(token.value || '').length;
    if (start > cursor) html += esc(src.slice(cursor, start));
    html += '<span class="pt-formula-token pt-formula-token-' + _ptFormulaTokenClass(token) + '">' + esc(src.slice(start, end)) + '</span>';
    cursor = end;
  });
  if (cursor < src.length) html += esc(src.slice(cursor));
  return html;
}

function _ptUpdateFormulaPreview(root) {
  const scope = _ptResolveRoot(root);
  const textarea = _ptGet('pt-formula-src', scope);
  const preview = _ptGet('pt-formula-preview', scope);
  if (!textarea || !preview) return;
  try {
    preview.innerHTML = _ptHighlightFormula(textarea.value || '');
  } catch {
    preview.textContent = textarea.value || '';
  }
}

function _ptBindFormulaEditor(root) {
  const scope = _ptResolveRoot(root);
  const textarea = _ptGet('pt-formula-src', scope);
  if (!textarea || textarea.dataset.formulaEditorBound) return;
  textarea.dataset.formulaEditorBound = '1';
  textarea.addEventListener('input', () => _ptUpdateFormulaPreview(scope));
  scope.querySelectorAll('[data-formula-prop]').forEach(btn => {
    btn.addEventListener('click', () => {
      const prop = btn.dataset.formulaProp || '';
      _ptInsertFormulaText(textarea, 'prop("' + _formulaPropLiteral(prop, '"') + '")');
    });
  });
  scope.querySelectorAll('[data-formula-template]').forEach(btn => {
    btn.addEventListener('click', () => _ptInsertFormulaText(textarea, btn.dataset.formulaTemplate || ''));
  });
  _ptUpdateFormulaPreview(scope);
}

function showDbPropertySettingsForColumn(dbPath, propName, opts) {
  if (!dbPath) return;
  const selected = typeof _getSelectedColumns === 'function' ? _getSelectedColumns(dbPath) : [];
  const effectiveProp = propName || (selected.length === 1 ? selected[0] : '');
  if (typeof state !== 'undefined') state.selectedColumn = effectiveProp ? { dbPath, propName: effectiveProp } : { dbPath, propName: '' };

  const detailEl = typeof _resolveDetailEl === 'function' ? _resolveDetailEl() : document.getElementById('rp-detail');
  if (!detailEl) return;
  if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailEl);
  if (typeof showDbTabs === 'function') showDbTabs(true);
  const container = detailEl.querySelector('#detail-tab-db-property-settings');
  if (!container) return;

  const shouldSwitch = !opts || opts.switchTab !== false;
  if (shouldSwitch && typeof switchDetailTab === 'function') switchDetailTab('db-property-settings');
  renderDbPropertySettingsPanel(dbPath, effectiveProp, container);
}

function renderDbPropertySettingsPanel(dbPath, propName, container) {
  const target = container || document.getElementById('detail-tab-db-property-settings');
  if (!target) return;
  if (!propName) {
    target.innerHTML = `<div class="gb-empty-placeholder" style="padding:16px;">列を選択してください</div>`;
    return;
  }
  const ctx = _ptContextForDbPath(dbPath);
  const pivotData = ctx?.pivotData || _ptPivotDataForDbPath(dbPath);
  if (propName === '__entity__') {
    const entityColumnLabel = typeof _dbEntityColumnDisplayLabel === 'function'
      ? _dbEntityColumnDisplayLabel(dbPath, { ctx })
      : 'エントリ名';
    const pinnedRange = typeof _dbPinnedRangeForMenu === 'function'
      ? _dbPinnedRangeForMenu(ctx, dbPath)
      : null;
    const pinned = pinnedRange
      ? pinnedRange.entityColumnPinned
      : (typeof getEntityColumnPinned === 'function'
        ? getEntityColumnPinned(dbPath, { ctx })
        : getDbViewConfig(dbPath).entityColumnPinned !== false);
    // 制作管理シートのエントリ名列は固定名（変更不可）
    const labelLocked = typeof isProductionManagementSheetPath === 'function'
      && isProductionManagementSheetPath(dbPath);
    target.innerHTML = `<div class="db-prop-settings" data-db-property-settings-root>
      <div class="gb-section-head">${esc(entityColumnLabel)}列</div>
      <div class="field"><label for="entity-column-name-display">列名</label><input id="entity-column-name-display" type="text" value="${esc(entityColumnLabel)}"${labelLocked ? ' disabled' : ''} aria-label="列名"${labelLocked ? '' : ' placeholder="エントリ名"'}></div>
      ${labelLocked ? '<div class="gb-info-box">制作管理に必要な列のため、列名は変更できません。</div>' : ''}
      <div class="field"><label class="pt-check-label">
        <input id="entity-column-pinned" type="checkbox" ${pinned ? 'checked' : ''}>
        列を固定
      </label></div>
    </div>`;
    if (!labelLocked) {
      const labelInput = target.querySelector('#entity-column-name-display');
      let skipCommit = false;
      const commitLabel = () => {
        if (skipCommit) { skipCommit = false; return; }
        if (typeof setEntityColumnLabel !== 'function' || !labelInput) return;
        // 表示中のラベルと同じなら保存しない（開いて閉じただけで履歴を汚さない）
        if (labelInput.value.trim() === entityColumnLabel) return;
        setEntityColumnLabel(dbPath, labelInput.value, { ctx });
        if (typeof renderPivot === 'function') renderPivot(ctx);
      };
      labelInput?.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); labelInput.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); skipCommit = true; labelInput.value = entityColumnLabel; labelInput.blur(); }
      });
      if (labelInput && typeof attachInlineBlurCommit === 'function') attachInlineBlurCommit(labelInput, commitLabel);
      else labelInput?.addEventListener('blur', commitLabel);
    }
    target.querySelector('#entity-column-pinned')?.addEventListener('change', function() {
      if (pinnedRange && typeof setPinnedColumnRange === 'function') {
        setPinnedColumnRange(dbPath, pinnedRange.renderedCols, '__entity__', !!this.checked, {
          ctx,
          detail: entityColumnLabel,
        });
      } else if (typeof setEntityColumnPinned === 'function') {
        setEntityColumnPinned(dbPath, !!this.checked, { ctx });
      } else {
        const c = getDbViewConfig(dbPath);
        c.entityColumnPinned = !!this.checked;
        saveDbViewConfig(dbPath, c, {
          historyLabel: `シート表示: ${entityColumnLabel}列固定`,
          historyDetail: this.checked ? '固定' : '解除',
        });
      }
      if (typeof renderPivot === 'function') renderPivot(ctx);
    });
    return;
  }
  const types = getPropertyTypes(dbPath);
  if (typeof isProductionManagementSheetPath === 'function' && isProductionManagementSheetPath(dbPath)) {
    const current = types[propName] || { type: 'text' };
    const typeLabel = typeof getPropertyTypeMenuItems === 'function'
      ? (getPropertyTypeMenuItems().find(item => item.type === current.type)?.label || current.type || 'テキスト')
      : (current.type || 'テキスト');
    target.innerHTML = `<div class="db-prop-settings" data-db-property-settings-root>
      <div class="gb-section-head">${esc(propName)}列</div>
      <div class="field"><label>列名</label><input type="text" value="${esc(propName)}" disabled aria-label="列名"></div>
      <div class="field"><label>列タイプ</label><input type="text" value="${esc(typeLabel)}" disabled aria-label="列タイプ"></div>
      <div class="gb-info-box">制作管理に必要な列のため変更できません ${fieldHelp('列名と列タイプは変更できませんが、並べ替え・ソート・非表示・列幅の調整は利用できます')}</div>
    </div>`;
    return;
  }
  const colOrder = typeof getColOrder === 'function' ? getColOrder(dbPath, { ctx }) : null;
  const availableProps = [
    ...new Set([
      ...(pivotData?.properties || []),
      ...(Array.isArray(colOrder) ? colOrder : []),
      ...Object.keys(types || {}),
    ]),
  ];
  const visibleAvailableProps = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(dbPath, availableProps)
    : availableProps;
  if (visibleAvailableProps.length && !visibleAvailableProps.includes(propName)) {
    target.innerHTML = `<div class="gb-empty-placeholder" style="padding:16px;">列を選択してください</div>`;
    return;
  }

  const current = types[propName] || { type: 'text' };
  const scopeId = 'tab-' + Math.random().toString(36).slice(2, 8);
  target.innerHTML = `<div class="db-prop-settings" data-pt-root>
    <div class="gb-section-head">列設定</div>
    <div class="field"><label>列名</label>
      <input id="pt-prop-name" type="text" value="${esc(propName)}" placeholder="列名">
    </div>
    <div class="field"><label>型</label>
      <select id="pt-type" data-onchange="onPropertyTypeChange(this.closest('[data-pt-root]'))">
        ${renderPropertyTypeOptions(current.type)}
      </select>
    </div>
    ${_renderPropertyMultiplicityControls(current.type, scopeId)}
    <div id="pt-options"></div>
    <div class="pt-autosave-status" aria-live="polite"></div>
  </div>`;
  const root = target.querySelector('[data-pt-root]');
  _ptSetState(root, current, _propertySettingsExistingValues(propName, pivotData), propName, dbPath, pivotData, ctx);
  onPropertyTypeChange(root);
  _bindDbPropertySettingsAutosave(root, propName);
  if (typeof enhancePropertyTypeSelect === 'function') enhancePropertyTypeSelect(root);
}

// #pt-type のネイティブ<select>を、列タイプアイコン付きのカスタムドロップダウンで見た目上置き換える。
// ネイティブselectは非表示で残し（値の読み取り・changeイベント互換を保つ）、選択時に
// select.value を更新して change を発火する。列設定モーダル/パネル両方から呼ばれる。
function enhancePropertyTypeSelect(root) {
  const select = root?.querySelector?.('#pt-type');
  if (!select || select.dataset.ptTypeEnhanced) return;
  select.dataset.ptTypeEnhanced = '1';
  select.style.display = 'none';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pt-type-select-btn';
  btn.dataset.e2eId = 'pt-type-select-btn';
  const syncBtn = () => {
    const t = select.value || 'text';
    const iconName = typeof getPropertyTypeIcon === 'function' ? getPropertyTypeIcon(t) : 'alignLeft';
    const label = typeof getPropertyTypeLabel === 'function' ? getPropertyTypeLabel(t) : t;
    btn.innerHTML = '';
    if (typeof lucide === 'function') {
      const ic = document.createElement('span');
      ic.className = 'pt-type-select-icon';
      ic.innerHTML = lucide(iconName, 14);
      btn.appendChild(ic);
    }
    const lb = document.createElement('span');
    lb.className = 'pt-type-select-label';
    lb.textContent = label;
    btn.appendChild(lb);
    if (typeof lucide === 'function') {
      const caret = document.createElement('span');
      caret.className = 'pt-type-select-caret';
      caret.innerHTML = lucide('chevronDown', 14);
      btn.appendChild(caret);
    }
  };
  syncBtn();
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    _openPropertyTypeMenu(btn, select.value, (newType) => {
      if (newType && newType !== select.value) {
        select.value = newType;
        syncBtn();
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (btn.isConnected) btn.focus(); // 選択後はトリガーへフォーカスを戻す
    });
  });
  select.insertAdjacentElement('afterend', btn);
  select.addEventListener('change', syncBtn);
}

// 列タイプ選択メニュー（アイコン付き）。getPropertyTypeMenuItems() の各項目を .gb-context-menu で表示する。
function _openPropertyTypeMenu(anchor, currentType, onPick) {
  document.querySelectorAll('.pt-type-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu pt-type-menu';
  menu.dataset.e2eId = 'pt-type-menu';
  let closer = null;
  const closeMenu = () => {
    if (menu.parentNode) menu.remove();
    if (closer) { document.removeEventListener('pointerdown', closer, true); closer = null; }
  };
  const items = typeof getPropertyTypeMenuItems === 'function' ? getPropertyTypeMenuItems() : [];
  const curBase = typeof getPropertyTypeUiBaseType === 'function' ? getPropertyTypeUiBaseType(currentType) : currentType;
  items.forEach(ti => {
    const item = document.createElement('div');
    item.className = 'gb-context-menu-item pt-type-menu-item' + (ti.type === curBase ? ' active' : '');
    item.dataset.type = ti.type;
    if (typeof lucide === 'function') {
      const ic = document.createElement('span');
      ic.className = 'pt-type-menu-icon';
      ic.innerHTML = lucide(ti.icon, 14);
      item.appendChild(ic);
    }
    const lb = document.createElement('span');
    lb.textContent = ti.label;
    item.appendChild(lb);
    item.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); onPick(ti.type); });
    menu.appendChild(item);
  });
  document.body.appendChild(menu);
  menu.style.position = 'fixed';
  menu.style.zIndex = '10050';
  if (typeof positionPopup === 'function') {
    positionPopup(menu, anchor.getBoundingClientRect());
  } else {
    const r = anchor.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = (r.bottom + 2) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  closer = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', closer, true), 0);
}

function _ptSplitSelectOptionsFromTextarea(scope) {
  const textarea = _ptGet('pt-select-options', scope);
  if (!textarea) return null;
  return textarea.value.split('\n').map(s => s.trim()).filter(Boolean);
}

function _ptApplyFastLocalSettings(root) {
  const scope = _ptResolveRoot(root);
  const type = _ptReadUiType(scope);
  if (type !== 'select' && type !== 'multi-select') return false;
  const options = _ptSplitSelectOptionsFromTextarea(scope);
  if (!options) return false;
  const stateInfo = _ptState(scope);
  const dbPath = stateInfo.dbPath || state.currentDbPath || '';
  const propName = scope._ptAutosavePropName || stateInfo.propName;
  if (!dbPath || !propName) return false;

  const prev = stateInfo.current || getPropertyTypes(dbPath)?.[propName] || {};
  const config = { ...prev, type, options };
  if (typeof collectDbOptionColors === 'function') {
    const optionColors = collectDbOptionColors(scope, prev.optionColors, options);
    if (optionColors && Object.keys(optionColors).length) config.optionColors = optionColors;
    else delete config.optionColors;
  }
  const ctx = stateInfo.ctx || _ptContextForDbPath(dbPath);
  // 入力中はDOMに紐づく一時状態だけを更新する。永続メタデータを先に書き換えると、
  // 保存時に「変更前候補」が失われ、候補値の改名移行と失敗時ロールバックができない。
  _ptSetState(scope, config, stateInfo.existing, propName, dbPath, stateInfo.pivotData, ctx || stateInfo.ctx);
  return true;
}

function _bindDbPropertySettingsAutosave(root, initialPropName) {
  if (!root || root.dataset.ptAutosaveBound) return;
  root.dataset.ptAutosaveBound = '1';
  root._ptAutosavePropName = initialPropName;
  let timer = null;
  let saving = false;
  let queued = false;
  const schedule = (delay = 450) => {
    _ptApplyFastLocalSettings(root);
    const status = root.querySelector('.pt-autosave-status');
    if (status && !saving) status.textContent = '保存待ち...';
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  };
  const run = async (force = false) => {
    // force=true はパネルを閉じる直前の確定保存。root が DOM から外れていても保存する
    // （切り離された入力欄も値は保持されるため、編集内容を取りこぼさない）。
    if (!force && !root.isConnected) return;
    if (saving) {
      queued = true;
      return;
    }
    saving = true;
    const status = root.querySelector('.pt-autosave-status');
    if (status) status.textContent = '保存中...';
    try {
      const result = await applyDbPropertySettings(root._ptAutosavePropName || initialPropName, root, { auto: true });
      if (result?.propName) root._ptAutosavePropName = result.propName;
      if (status) status.textContent = result ? '保存しました' : '';
    } finally {
      saving = false;
      if (queued) {
        queued = false;
        schedule(250);
      }
    }
  };
  // デバウンス待ちの編集を確定させる。パネルを閉じる/フォーカスが外へ出る直前に呼び、
  // 「選択肢の色・名前などを編集したまま閉じると保存されず消える」取りこぼしを防ぐ。
  const flushPending = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      return run(true);
    }
    // 先行保存中に queued が立った場合も、その後の250ms待ちを残さず最後まで確定する。
    if (saving) {
      return new Promise(resolve => {
        const settle = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
            Promise.resolve(run(true)).then(resolve, resolve);
            return;
          }
          if (saving) {
            setTimeout(settle, 10);
            return;
          }
          resolve();
        };
        settle();
      });
    }
  };
  root._ptFlushAutosave = flushPending;
  root.addEventListener('focusout', (e) => {
    // フォーカスがパネルの外へ移ったら（別の場所をクリック／閉じるなど）確定保存する。
    if (root.contains(e.relatedTarget)) return;
    flushPending();
  });
  root.addEventListener('input', (e) => {
    if (e.target?.closest?.('.db-picker-popup')) return;
    schedule();
  });
  root.addEventListener('change', () => {
    _ptRefreshAutoFillVisibility(root);
    schedule(120);
  });
  root.addEventListener('click', (e) => {
    if (e.target?.closest?.('button')) setTimeout(() => schedule(120), 0);
  });
  root.querySelector('#pt-type')?.addEventListener('change', () => {
    onPropertyTypeChange(root);
    _bindDbPropertySettingsAutosave(root, root._ptAutosavePropName || initialPropName);
    schedule(120);
  });
  // 列名欄は Enter で即確定・Escape で取り消し。既定の 450ms デバウンス待ちを挟まない。
  const nameInput = root.querySelector('#pt-prop-name');
  if (nameInput && !nameInput.dataset.ptNameKeyBound) {
    nameInput.dataset.ptNameKeyBound = '1';
    nameInput.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; // IME変換中は無視
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(timer);
        timer = null; // blur→focusout→flushPending の再入による二重保存を防ぐ
        _ptApplyFastLocalSettings(root);
        run();
        nameInput.blur(); // Enter で確定したら編集状態を抜ける（フォーカスを外す）
      } else if (e.key === 'Escape') {
        e.preventDefault();
        nameInput.value = root._ptAutosavePropName || initialPropName;
        nameInput.blur();
      }
    });
  }
}

async function flushPendingDbPropertySettings(dbPath) {
  const target = _ptNormalizeDbPath(dbPath || '');
  const roots = Array.from(document.querySelectorAll('[data-pt-root]')).filter(root => {
    const rootPath = _ptNormalizeDbPath(_ptState(root)?.dbPath || '');
    return typeof root._ptFlushAutosave === 'function' && (!target || rootPath === target);
  });
  await Promise.allSettled(roots.map(root => Promise.resolve(root._ptFlushAutosave())));
  if (typeof waitForPendingDbPropertyTypeSaves === 'function') {
    await waitForPendingDbPropertyTypeSaves(target);
  }
  return true;
}

async function applyDbPropertySettings(originalPropName, root, options = {}) {
  const scope = _ptResolveRoot(root);
  const stateInfo = _ptState(scope);
  const dbPath = stateInfo.dbPath || state.currentDbPath;
  const ctx = stateInfo.ctx || _ptContextForDbPath(dbPath);
  const pivotData = stateInfo.pivotData || _ptPivotDataForDbPath(dbPath);
  if (!dbPath || !originalPropName) return null;
  let propName = originalPropName;
  const nameInput = scope.querySelector('#pt-prop-name');
  const newName = (nameInput?.value || '').trim();
  if (!newName) {
    showStatus('列名を入力してください', true);
    return null;
  }
  if (newName !== originalPropName) {
    const rawExistingProps = [
      ...(Array.isArray(pivotData?.properties) ? pivotData.properties : []),
      ...(Array.isArray(getDbViewConfig(dbPath).colOrder) ? getDbViewConfig(dbPath).colOrder : []),
      ...Object.keys(getPropertyTypes(dbPath) || {}),
    ];
    const existingProps = new Set(
      typeof filterDeletedDbProperties === 'function'
        ? filterDeletedDbProperties(dbPath, rawExistingProps)
        : rawExistingProps
    );
    if (existingProps.has(newName)) {
      showStatus('同じ名前の列が既にあります: ' + newName, true);
      return null;
    }
    try {
      const ok = await renameDbProperty(dbPath, originalPropName, newName, ctx);
      if (!ok) return null;
    } catch (e) {
      showStatus('列名変更に失敗: ' + (e?.message || e), true);
      return null;
    }
    propName = newName;
    scope._ptPropName = propName;
  }
  _ptSetState(scope, getPropertyTypes(dbPath)[propName] || {}, _propertySettingsExistingValues(propName, pivotData), propName, dbPath, pivotData, ctx);
  const savedConfig = await applyPropertyType(propName, scope, { render: !options.auto });
  if (!savedConfig) return null;
  // オプションパネルの自動保存（Enter確定）でも列タイプ変更をメインテーブルへ即座に反映する。
  // applyPropertyType は auto 時に描画しない（render:false）ため、ここで現在ビューを描き直す。
  // 表本体だけの再構築で、別サブツリーの設定パネルは閉じずフォーカスも維持される。
  if (options.auto && typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, dbPath);
  if (typeof _setSelectedColumns === 'function') _setSelectedColumns(dbPath, [propName], propName);
  if (typeof state !== 'undefined') state.selectedColumn = { dbPath, propName };
  if (!options.auto) {
    renderDbPropertySettingsPanel(dbPath, propName);
    showStatus('列設定を保存しました');
  }
  return { propName, config: savedConfig };
}

/* 型別値エディタ・ドロップダウン → gb-db-value-editors.js に分離 */
