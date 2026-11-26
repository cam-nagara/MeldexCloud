/* プロパティ型・値エディタ — gb-db-props.js から分離 */

function getPropertyTypes(dbPath, ctxOverride) {
  const targetPath = dbPath || state.currentDbPath || '';
  const localTypes = getDbViewConfig(targetPath).propertyTypes || {};
  const targetMetadata = _ptMetadataForDbPath(targetPath, ctxOverride);
  if (targetMetadata && typeof _dbLegacyChipTheme === 'function') {
    const migrated = _dbLegacyChipTheme(targetMetadata);
    if (Object.keys(migrated).length) {
      const previous = targetMetadata.style || targetMetadata.theme || {};
      const source = previous.__themeSourceId || previous.__themeId || window.MeldexThemeManager?.getDefaultThemeId?.();
      const sourceVars = typeof _fileStyleThemeVars === 'function' ? _fileStyleThemeVars(previous) : {};
      targetMetadata.style = { ...sourceVars, ...previous, ...migrated, __themeId: '__fileCustomTheme',
        __themeName: previous.__themeName || '移行した候補値の書式', __chipTypeMigration: '1' };
      Object.defineProperty(targetMetadata, '__chipThemeMigrationPending', { value: true, writable: true, configurable: true });
      if (source && source !== '__fileCustomTheme') targetMetadata.style.__themeSourceId = source;
      const root = typeof _dbSheetTransitionRoot === 'function' ? _dbSheetTransitionRoot(ctxOverride || _ptContextForDbPath(targetPath)) : null;
      if (root && typeof applyFileStyleToPanel === 'function') applyFileStyleToPanel(targetMetadata.style, 'db-view-container', root);
    }
  }
  // バックエンド（フォルダノート）を優先: property_types キーが存在すればそれを使う
  if (targetMetadata && 'property_types' in targetMetadata && targetMetadata.property_types !== null) {
    const backendTypes = targetMetadata.property_types || {};
    // 旧URL列は読込時だけリンクの別名として扱う。ここではメモリ上だけを
    // 正規化し、通常の列設定保存が発生するまで既存ファイルを書き換えない。
    Object.values(backendTypes).forEach(config => {
      if (config && typeof config === 'object' && config.type === 'url') config.type = 'link';
    });
    if (Object.keys(backendTypes).length > 0) return backendTypes;
    return Object.keys(localTypes).length > 0 ? localTypes : backendTypes;
  }
  // フォールバック: localStorage（後方互換、オフライン対応）
  Object.values(localTypes).forEach(config => {
    if (config && typeof config === 'object' && config.type === 'url') config.type = 'link';
  });
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
  const previousConfig = JSON.parse(JSON.stringify(currentTypes[propName] || {}));
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
  // 削除した列と同じ名前で列を作り直した時は、保存先のシートの設定の削除済み一覧からも外す。
  // 手元だけ外していたため、再読み込みや別の端末では今ある列が削除済みとして扱われていた（2026-11-21 実データ「姓」）。
  const unmarkedDeleted = _unmarkDbPropertyDeletedInConfig(c, propName);
  saveDbViewConfig(targetPath, c, { skipBackend: !unmarkedDeleted, ctx: ctxOverride });
  // state.dbMetadata にも反映
  const targetMetadata = _ptMetadataForDbPath(targetPath, ctxOverride);
  if (targetMetadata) {
    if (!targetMetadata.property_types) targetMetadata.property_types = {};
    targetMetadata.property_types[propName] = typeConfig;
    if (_ptIsCurrentDbPath(targetPath)) state.dbMetadata = targetMetadata;
  }
  // バックエンドに永続保存
  let save;
  try {
    save = _savePropertyTypesToBackend(targetPath, undefined, ctxOverride);
  } catch (error) {
    _ptRestoreLocalStoredTypeConfig(targetPath, propName, previousConfig, ctxOverride);
    throw error;
  }
  return Promise.resolve(save).then((saved) => {
    if (saved === false) {
      _ptRestoreLocalStoredTypeConfig(targetPath, propName, previousConfig, ctxOverride);
      return false;
    }
    return true;
  }).catch((error) => {
    _ptRestoreLocalStoredTypeConfig(targetPath, propName, previousConfig, ctxOverride);
    throw error;
  });
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
function _ptPushTypeChangeHistory(dbPath, propName, beforeConfig, afterConfig, ctx, valueMigration = null) {
  if (typeof historyPush !== 'function' || typeof _dbScope !== 'function') return;
  if (!dbPath || !propName) return;
  const before = JSON.parse(JSON.stringify(beforeConfig || {}));
  const after = JSON.parse(JSON.stringify(afterConfig || {}));
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const beforeType = before.type || 'text';
  const afterType = after.type || 'text';
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
  // 列タイプの変更で値を置き換えた時（リレーションの識別番号⇔名前）は、取り消しで元の値へ、
  // やり直しで置き換えた値へ戻す。列設定を先に戻してから値を戻す。
  const _restoreValues = async (forward) => {
    if (!valueMigration) return;
    if (forward) await valueMigration.reapply();
    else await valueMigration.rollback();
    const rc = _resolveCtx();
    if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(rc, dbPath);
  };
  historyPush((beforeType === afterType ? '列設定変更: ' : '列タイプ変更: ') + propName,
    async () => { await _restore(after, before); await _restoreValues(false); },
    async () => { await _restore(before, after); await _restoreValues(true); },
    (typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : _dbScope(dbPath))
  );
}

// 列タイプの変更に伴う値の置き換え（v0.7.538）。
// リレーション列を文字などへ変える時は、識別番号（ent_…）を相手のトピックの名前へ置き換える。
// 文字などをリレーション列へ変える時は、名前が参照先のトピック1件だけに一致する時だけ相手のトピックへ置き換える
// （見つからない・同じ名前が複数ある時はそのまま残し、未解決として表示される。セルの貼り付けと同じ規則）。
const PT_VALUE_RELATION_TYPES = ['relation', 'multi-relation'];
const PT_VALUE_DERIVED_TYPES = ['formula', 'rollup', 'button', 'multi-source-relation', 'chat', 'created-time', 'last-edited-time', 'created-by', 'last-edited-by'];

function _ptValueTypeOf(config) {
  return String(config?.type || 'text').replace(/_/g, '-');
}

function _ptSplitValueTokens(raw) {
  return String(raw ?? '').split(/[,、]/).map(token => token.trim()).filter(Boolean);
}

function _ptPivotDataForTypeChange(dbPath, ctx) {
  const target = _ptNormalizeDbPath(dbPath || '');
  if (ctx?.pivotData?.entities && (!ctx.dbPath || _ptNormalizeDbPath(ctx.dbPath) === target)) return ctx.pivotData;
  const found = typeof _dbFindPaneContextForPath === 'function' && target ? _dbFindPaneContextForPath(target) : null;
  if (found?.pivotData?.entities) return found.pivotData;
  return _ptIsCurrentDbPath(target) ? state.pivotData : null;
}

async function _ptPlanTypeChangeValues(dbPath, propName, beforeConfig, afterConfig, ctx) {
  const fromType = _ptValueTypeOf(beforeConfig);
  const toType = _ptValueTypeOf(afterConfig);
  const fromRelation = PT_VALUE_RELATION_TYPES.includes(fromType);
  const toRelation = PT_VALUE_RELATION_TYPES.includes(toType);
  if (fromRelation === toRelation) return { writes: [] };
  if (PT_VALUE_DERIVED_TYPES.includes(fromType) || PT_VALUE_DERIVED_TYPES.includes(toType)) return { writes: [] };
  const relationConfig = fromRelation ? beforeConfig : afterConfig;
  const relationDb = typeof _dbResolveRelationDbPath === 'function' ? _dbResolveRelationDbPath(dbPath, relationConfig) : '';
  if (!relationDb || typeof _getRelationMap !== 'function') return { writes: [] };
  const map = await _getRelationMap(relationDb);
  const idToName = map?.idToName || {};
  const nameToId = map?.nameToId || {};
  const nameCounts = new Map();
  Object.values(idToName).forEach(name => nameCounts.set(name, (nameCounts.get(name) || 0) + 1));
  const convert = (raw) => {
    if (fromRelation) {
      const tokens = _ptSplitValueTokens(raw);
      return tokens.map(token => (Object.prototype.hasOwnProperty.call(idToName, token) ? idToName[token] : token)).join(', ');
    }
    const tokens = toType === 'multi-relation' ? _ptSplitValueTokens(raw) : [String(raw ?? '').trim()].filter(Boolean);
    return tokens.map(token => {
      if (Object.prototype.hasOwnProperty.call(idToName, token)) return token;
      if ((nameCounts.get(token) || 0) === 1 && Object.prototype.hasOwnProperty.call(nameToId, token)) return nameToId[token];
      return token;
    }).join(', ');
  };
  const pivotData = _ptPivotDataForTypeChange(dbPath, ctx);
  const writes = [];
  Object.values(pivotData?.entities || {}).forEach(entityData => {
    (entityData?.[propName] || []).forEach(valueRef => {
      if (!valueRef || valueRef.value == null) return;
      const oldValue = String(valueRef.value);
      if (!oldValue.trim()) return;
      const newValue = convert(oldValue);
      if (newValue && newValue !== oldValue) {
        if (!valueRef.property) valueRef.property = propName;
        writes.push({ ref: valueRef, oldValue, newValue });
      }
    });
  });
  return { writes, fromType, toType, relationDb };
}

function _ptPlannedValues(plan, pivotData, propName) {
  const replaced = new Map((plan?.writes || []).map(write => [write.ref, write.newValue]));
  const values = [];
  Object.values(pivotData?.entities || {}).forEach(entityData => {
    (entityData?.[propName] || []).forEach(valueRef => {
      values.push(replaced.has(valueRef) ? replaced.get(valueRef) : valueRef?.value);
    });
  });
  return values;
}

async function _ptWriteValueSet(writes, key) {
  const completed = [];
  try {
    for (const write of writes) {
      await _apiPutValue(write.ref, { new_value: write[key] });
      write.ref.value = write[key];
      completed.push(write);
    }
  } catch (error) {
    const back = key === 'newValue' ? 'oldValue' : 'newValue';
    for (const write of completed.reverse()) {
      try { await _apiPutValue(write.ref, { new_value: write[back] }); write.ref.value = write[back]; } catch (rollbackError) {
        console.error('列タイプ変更の値の復元に失敗:', rollbackError, error);
      }
    }
    throw error;
  }
}

// 置き換えを保存し、取り消し・やり直し用の操作を返す。置き換える値が無ければ null。
async function _ptApplyTypeChangeValuePlan(plan) {
  const writes = plan?.writes || [];
  if (!writes.length) return null;
  await _ptWriteValueSet(writes, 'newValue');
  return {
    count: writes.length,
    rollback: () => _ptWriteValueSet(writes, 'oldValue'),
    reapply: () => _ptWriteValueSet(writes, 'newValue'),
  };
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
  if (level === 'required') { showStatus('ユーザー管理に必要な列は削除できません。非表示を利用してください', true); return; }
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
  // 確認は出さない。列の削除は Ctrl+Z・やり直し・共通の履歴で元に戻せ、値もトピックに残るため
  // （app/AGENTS.md「3経路で復元できる場合に限り確認を出さない」。2026-11-21 予期しないダイアログの検査で検出）。
  // 取り消しの記録は操作した時点で枠を取る（保存の完了後に記録すると、保存が終わる前の Ctrl+Z が直前の別の操作を
  // 取り消してしまう。Cloud版・exe など保存が遅い環境で再現、2026-11-21）。保存に失敗した時は枠を取り除く。
  const historyScope = (typeof historyPush === 'function' && typeof _dbScope === 'function')
    ? (typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : _dbScope(dbPath)) : '';
  const reservation = historyScope && typeof historyReserve === 'function' ? historyReserve('列削除: ' + propName, historyScope) : null;
  try {
    const result = await _deleteColumnConfirmed(dbPath, propName, renderCtx, reservation, historyScope);
    if (result !== true) reservation?.cancel();
    return result;
  } catch (error) {
    reservation?.cancel();
    throw error;
  }
}

async function _deleteColumnConfirmed(dbPath, propName, renderCtx, reservation, historyScope) {
  // undo用スナップショット
  const oldCfg = JSON.parse(JSON.stringify(getDbViewConfig(dbPath)));
  const oldBackendPropertyTypes = JSON.parse(JSON.stringify((typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : oldCfg.propertyTypes) || {}));
  const oldPT = (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath)?.[propName] : null) || oldCfg.propertyTypes?.[propName];
  const oldMetadata = _ptSnapshotColumnDeleteMetadata(dbPath);

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
  // 保存の完了を待たずに列を画面から消す。保存に失敗したら削除前へ戻す。
  _ptApplyColumnDeleteLocally(dbPath, propName, c, renderCtx);
  if (!await _ptPersistColumnDeleteViewConfig(dbPath, propName, c, { oldCfg, oldMetadata, renderCtx })) return false;

  // バックエンドに保存（列タイプの保存が確定してから取り消し履歴を積む）
  const commit = await _ptSaveColumnDeleteToBackend(dbPath, propName, { oldCfg, oldMetadata, oldPT, renderCtx });
  if (!commit.ok) return false;
  const layoutError = commit.layoutError;

  // Undo/Redo
  if (historyScope) {
    const recordHistory = reservation
      ? (label, undoFn, redoFn) => reservation.fill(undoFn, redoFn, label)
      : historyPush;
    recordHistory('列削除: ' + propName,
      async () => { // undo: 列タイプと削除表示を同じ保存で復元してから読み直す
        const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        const beforeUndoCfg = clone(getDbViewConfig(dbPath));
        const ownerMeta = typeof _ptMetadataForDbPath === 'function' ? _ptMetadataForDbPath(dbPath, renderCtx) : null;
        const metadata = [...new Set([ownerMeta, _ptIsCurrentDbPath(dbPath) ? state.dbMetadata : null].filter(Boolean))]
          .map(meta => ({ meta, types: clone(meta.property_types), layout: clone(meta.property_layout) }));
        try {
          saveDbViewConfig(dbPath, clone(oldCfg), { skipBackend: true, skipHistory: true });
          const restoredTypes = Object.keys(oldBackendPropertyTypes).length ? clone(oldBackendPropertyTypes)
            : clone(oldCfg.propertyTypes || (oldPT ? { [propName]: oldPT } : {}));
          metadata.forEach(({ meta }) => { meta.property_types = clone(restoredTypes); meta.property_layout = clone(oldCfg.propertyLayout || null); });
          const cfg = getDbViewConfig(dbPath);
          cfg.propertyTypes = restoredTypes;
          saveDbViewConfig(dbPath, cfg, { skipBackend: true, skipHistory: true });
          const viewConfig = typeof _sanitizeDbViewConfigForBackend === 'function' ? _sanitizeDbViewConfigForBackend(cfg) : cfg;
          if (await _savePropertyTypesToBackend(dbPath, { property_layout: oldCfg.propertyLayout || null, view_config: viewConfig }, renderCtx) === false) {
            throw new Error(`列「${propName}」の取り消しを保存できませんでした`);
          }
          await selectDatabase(dbPath, renderCtx, { silent: true, forceReload: true });
          return true;
        } catch (error) {
          saveDbViewConfig(dbPath, beforeUndoCfg, { skipBackend: true, skipHistory: true });
          metadata.forEach(({ meta, types, layout }) => { meta.property_types = types; meta.property_layout = layout; });
          _ptRenderAfterColumnDelete(renderCtx, dbPath);
          throw error;
        }
      },
      () => { // redo: 再削除
        return _deleteColumnNoConfirm(dbPath, propName, renderCtx);
      },
      historyScope
    );
  }

  if (layoutError) {
    showStatus(`列「${propName}」を削除しましたが、トピック詳細の配置設定を更新できませんでした: ${layoutError?.message || layoutError}`, true);
  } else {
    showStatus(`列「${propName}」を削除しました`);
  }
  // 列削除 → 該当 sheet_col/sheet_cell コメントを孤児化 (annotation_unification_plan.md §5.3)
  apiPost('/annotations/orphan-by-target', {
    target_kind: 'sheet_col',
    target_file: dbPath,
    item_id: propName,
    cascade_container: true,
  }).catch(() => {});
  return true;
}

function _ptRenderAfterColumnDelete(renderCtx, dbPath) {
  if (typeof _renderCurrentDbView === 'function' && (renderCtx?.pivotData || state.pivotData)) {
    if (renderCtx && !renderCtx.pivotData && state.pivotData) renderCtx.pivotData = state.pivotData;
    _renderCurrentDbView(renderCtx, dbPath);
  } else if (typeof selectDatabase === 'function') {
    selectDatabase(dbPath, renderCtx);
  }
  // 開いている列管理も保存の完了を待たずに追従させる（削除・保存失敗での復元の両方）。
  try { window.MeldexColumnManager?.refresh?.(); } catch (_) { /* 列管理が開いていない */ }
}

// 削除後の表示設定と列タイプを画面側へ先に反映し、すぐ描き直す。
function _ptApplyColumnDeleteLocally(dbPath, propName, cfg, renderCtx) {
  saveDbViewConfig(dbPath, cfg, { skipBackend: true, skipHistory: true });
  if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata?.property_types) _deletePropertyTypePropReferences(state.dbMetadata.property_types, propName);
  if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata?.property_layout && typeof removePropertyLayoutReferences === 'function') {
    state.dbMetadata.property_layout = removePropertyLayoutReferences(state.dbMetadata.property_layout, propName);
  }
  _ptRenderAfterColumnDelete(renderCtx, dbPath);
}

// 表示設定を保存する。失敗したら画面の列と列タイプを削除前へ戻し、理由を表示して false を返す。
async function _ptPersistColumnDeleteViewConfig(dbPath, propName, cfg, snapshot) {
  const { oldCfg, oldMetadata, renderCtx } = snapshot || {};
  let persisted = true;
  if (typeof _persistDbViewConfigToBackend === 'function') {
    try {
      persisted = await _persistDbViewConfigToBackend(dbPath, cfg, { immediate: true });
    } catch (error) {
      console.warn('[Meldex] 列削除の表示設定を保存できませんでした', error);
      persisted = false;
    }
  }
  if (persisted !== false) return true;
  saveDbViewConfig(dbPath, oldCfg, { skipBackend: true, skipHistory: true });
  if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata && oldMetadata) {
    state.dbMetadata.property_types = oldMetadata.property_types;
    state.dbMetadata.property_layout = oldMetadata.property_layout;
  }
  _ptRenderAfterColumnDelete(renderCtx, dbPath);
  showStatus(`列「${propName}」を削除できませんでした。保存先の空き容量や権限を確認してください`, true);
  return false;
}

// 列削除前の画面上の列タイプ・配置を控える（保存失敗時にそのまま戻す）。
function _ptSnapshotColumnDeleteMetadata(dbPath) {
  if (!_ptIsCurrentDbPath(dbPath) || !state.dbMetadata) return null;
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  return {
    property_types: clone(state.dbMetadata.property_types),
    property_layout: clone(state.dbMetadata.property_layout),
  };
}

// 列削除の保存。列タイプの保存に失敗したら表示設定と画面上の列を削除前へ戻し、
// 理由を表示して ok:false を返す（取り消し履歴は呼び出し側が ok の時だけ積む）。
async function _ptSaveColumnDeleteToBackend(dbPath, propName, snapshot) {
  const { oldCfg, oldMetadata, oldPT, renderCtx } = snapshot || {};
  let typesSaved = true;
  let typesSaveError = null;
  try {
    if (await _savePropertyTypesToBackend(dbPath) === false) typesSaved = false;
  } catch (error) {
    typesSaved = false;
    typesSaveError = error;
  }
  if (!typesSaved) {
    // 列タイプが保存されていないので、表示設定と画面上の列も削除前へ戻す
    console.warn('[Meldex] 列の削除を保存できませんでした', typesSaveError);
    let restored = true;
    if (typeof _persistDbViewConfigToBackend === 'function') {
      restored = await _persistDbViewConfigToBackend(dbPath, oldCfg, { immediate: true }).catch(() => false) !== false;
    }
    saveDbViewConfig(dbPath, oldCfg, { skipBackend: true, skipHistory: true });
    if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata && oldMetadata) {
      state.dbMetadata.property_types = oldMetadata.property_types;
      state.dbMetadata.property_layout = oldMetadata.property_layout;
    }
    if (typeof selectDatabase === 'function') selectDatabase(dbPath, renderCtx);
    const reason = typesSaveError ? ': ' + (typesSaveError?.message || typesSaveError) : '';
    showStatus(`列「${propName}」を削除できませんでした${reason}${restored ? '' : '。表示設定を元に戻せなかったため、画面を開き直してください'}`, true);
    return { ok: false, layoutError: null };
  }
  let layoutError = null;
  if (typeof updatePropertyLayoutForDelete === 'function') {
    try {
      await updatePropertyLayoutForDelete(dbPath, propName);
    } catch (error) {
      layoutError = error;
      console.warn('[Meldex] 列削除後の配置設定を更新できませんでした', error);
    }
  }
  if (oldPT?.type === 'image') {
    // 画像参照の再集計は背景の補助処理。失敗は記録だけ残す。
    Promise.resolve(apiPost('/media/rebuild-refs', {})).catch(error => console.warn('[Meldex] 画像参照の再集計に失敗しました', error));
  }
  return { ok: true, layoutError };
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
  const oldMetadata = _ptSnapshotColumnDeleteMetadata(dbPath);
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
  _ptApplyColumnDeleteLocally(dbPath, propName, c, renderCtx);
  if (!await _ptPersistColumnDeleteViewConfig(dbPath, propName, c, { oldCfg, oldMetadata, renderCtx })) return false;
  const commit = await _ptSaveColumnDeleteToBackend(dbPath, propName, { oldCfg, oldMetadata, oldPT, renderCtx });
  if (!commit.ok) return false;
  if (commit.layoutError) {
    showStatus(`列「${propName}」を削除しましたが、トピック詳細の配置設定を更新できませんでした: ${commit.layoutError?.message || commit.layoutError}`, true);
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

// 列の安定IDは1列に1つ。2つの列が同じIDを持っていたら（2026-11-22 利用者役の探索: リレーション列の複製が
// 元の列のIDを写していた）、先にそのIDを持っていた列に残し、ほかの列からは外して新しいIDを振らせる。
function _ptReleaseDuplicatedPropertyIds(meta, propertyTypes) {
  if (!propertyTypes || typeof propertyTypes !== 'object') return;
  const known = (meta && typeof meta.property_ids === 'object' && meta.property_ids) || {};
  const owners = new Map();
  const names = Object.keys(propertyTypes);
  // 名前の表でもそのIDを指している列を先に持ち主とする（無ければ並び順で先の列）。
  [true, false].forEach(preferMapped => {
    names.forEach(name => {
      const config = propertyTypes[name];
      const id = config && typeof config === 'object' ? String(config.property_id || '').trim() : '';
      if (!id || owners.has(id)) return;
      if (preferMapped && String(known[name] || '') !== id) return;
      owners.set(id, name);
    });
  });
  names.forEach(name => {
    const config = propertyTypes[name];
    const id = config && typeof config === 'object' ? String(config.property_id || '').trim() : '';
    if (id && owners.get(id) !== name) delete config.property_id;
  });
}

// 名前の表から、今の列ではない名前のうち今の列と同じIDを指すもの（改名・取り消しの残り）を除く。
function _ptDropStalePropertyIdAliases(propertyIds, propertyTypes) {
  const ids = { ...(propertyIds || {}) };
  const types = propertyTypes || {};
  const live = new Set(Object.keys(types).map(name => String(ids[name] || types[name]?.property_id || '')).filter(Boolean));
  Object.keys(ids).forEach(name => {
    if (Object.prototype.hasOwnProperty.call(types, name)) return;
    if (live.has(String(ids[name] || ''))) delete ids[name];
  });
  return ids;
}

// 列の名前を名前の表（列の安定ID）から外す。複製を取り消した列のように、無かったことにする列で使う。
function _ptForgetPropertyIdName(dbPath, propName, ctx) {
  if (!propName) return;
  const targets = new Set();
  const add = meta => { if (meta && typeof meta === 'object') targets.add(meta); };
  add(_ptMetadataForDbPath(dbPath, ctx));
  if (ctx?.dbMetadata && _ptNormalizeDbPath(ctx.dbPath || '') === _ptNormalizeDbPath(dbPath || '')) add(ctx.dbMetadata);
  if (_ptIsCurrentDbPath(dbPath)) add(state.dbMetadata);
  if (typeof _dbPaneContextsForPath === 'function') (_dbPaneContextsForPath(dbPath) || []).forEach(item => add(item?.dbMetadata));
  targets.forEach(meta => {
    if (meta.property_ids && Object.prototype.hasOwnProperty.call(meta.property_ids, propName)) {
      meta.property_ids = { ...meta.property_ids };
      delete meta.property_ids[propName];
    }
  });
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
          if (meta.__chipThemeMigrationPending) payload.style = JSON.parse(JSON.stringify(meta.style));
          const schemaMutation = globalThis.GbDbSchemaMutation;
          if (schemaMutation && payload.property_types) {
            _ptReleaseDuplicatedPropertyIds(meta, payload.property_types);
            const ensured = schemaMutation.ensurePropertyIds(
              targetPath, meta, payload.property_types
            );
            payload.property_types = ensured.propertyTypes;
            payload.property_ids = _ptDropStalePropertyIdAliases(ensured.propertyIds, ensured.propertyTypes);
            if (meta && typeof meta === 'object') meta.property_ids = { ...payload.property_ids };
          }
          if (schemaMutation) {
            await schemaMutation.saveMetadata(targetPath, payload, ctxOverride);
          } else {
            await apiPut('/db-metadata?path=' + encodeURIComponent(targetPath), payload);
          }
          if (payload.style?.__chipTypeMigration) delete meta.__chipThemeMigrationPending;
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
  if (cfg.rubyBaseProp === propName) delete cfg.rubyBaseProp;
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
  if (cfg.rubyBaseProp === oldName) cfg.rubyBaseProp = newName;
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
  // AI自動生成列のプロンプト内の {列名} も新しい列名へ付け替える（gb-db-ai-column.js）。
  if (typeof _ptRenameAiPromptRefs === 'function') _ptRenameAiPromptRefs(cfg, oldName, newName);
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
// 旧形式（マークダウン）のシートの列名変更は、値を1件ずつ新しい名前へ移してから列の設定を保存する。
// 途中で本体が止まる・画面が閉じると、列の設定は旧名のまま一部の値だけが新名へ移り、その値が見えなくなっていた
// （M-014 追加4、2026-11-20）。移す前に端末へ「列名の変更中」を記録し、次にそのシートを開いた時に記録が残っていれば、
// 移した値を旧名へ戻して元の状態にする（列の設定まで保存できていれば記録を消すだけ）。
const _PT_LEGACY_RENAME_JOURNAL = 'meldex-sheet-legacy-rename-v1:';
const _ptLegacyRenamesInFlight = new Set();
function _ptLegacyRenameJournalKey(dbPath) {
  return _PT_LEGACY_RENAME_JOURNAL + (typeof _dbNormalizePath === 'function' ? _dbNormalizePath(dbPath) : String(dbPath || ''));
}
function _ptWriteLegacyRenameJournal(dbPath, oldName, newName) {
  try { localStorage.setItem(_ptLegacyRenameJournalKey(dbPath), JSON.stringify({ dbPath, oldName, newName, startedAt: new Date().toISOString() })); } catch {}
}
function _ptClearLegacyRenameJournal(dbPath) {
  try { localStorage.removeItem(_ptLegacyRenameJournalKey(dbPath)); } catch {}
}
async function _ptRecoverInterruptedLegacyRename(dbPath, ctx) {
  let journal = null;
  try { journal = JSON.parse(localStorage.getItem(_ptLegacyRenameJournalKey(dbPath)) || 'null'); } catch {}
  if (!journal || !journal.oldName || !journal.newName) return false;
  const key = _ptLegacyRenameJournalKey(dbPath);
  if (_ptLegacyRenamesInFlight.has(key)) return false;
  _ptLegacyRenamesInFlight.add(key);
  try {
    const meta = await apiFetch('/db-metadata?path=' + encodeURIComponent(dbPath), { skipBrowseCache: true, silentError: true });
    const types = meta?.property_types || {};
    if (types[journal.newName] && !types[journal.oldName]) { _ptClearLegacyRenameJournal(dbPath); return false; }
    if (!types[journal.oldName]) { _ptClearLegacyRenameJournal(dbPath); return false; }
    // 列の設定は旧名のまま: 新名へ移っていた値を旧名へ戻す。列の設定に無い名前の値はシートの表に載らないので、
    // トピックごとに読み直して探す（旧形式のシートは件数が少ない。この確認は記録が残っている時だけ走る）。
    const pivot = await apiFetch('/pivot?path=' + encodeURIComponent(dbPath), { skipBrowseCache: true, silentError: true });
    let restored = 0;
    let failed = 0;
    let firstError = '';
    const noteError = (where, error) => { if (!firstError) firstError = where + ': ' + (error?.message || error); };
    for (const name of Object.keys(pivot?.entities || {})) {
      const entryPath = typeof _entityPath === 'function' ? _entityPath(dbPath, name, pivot) : `${dbPath}/${name}.md`;
      let entity = null;
      try { entity = await apiFetch('/entity?path=' + encodeURIComponent(entryPath), { skipBrowseCache: true, silentError: true }); }
      catch (error) { failed += 1; noteError(name, error); continue; }
      const moved = Array.isArray(entity?.properties?.[journal.newName]) ? entity.properties[journal.newName] : [];
      for (let index = moved.length - 1; index >= 0; index -= 1) {
        // 保存の版は、中断の前に覚えた版ではなく、いま読んだ版で送る（覚えた版だと「他の端末で更新」の409で
        // 戻せず、値が見えない名前に残っていた。2026-11-25）。1件戻すごとに版が進むので、読み直してから送る。
        // 再起動の直後は、中断前の画面の送り直しなどで版が進むことがある。版の食い違い（409）の時だけ、
        // 読み直して数回やり直す（新しい名前に残っている値を旧名へ戻すだけなので、何度やっても同じ結果になる）。
        let done = false;
        let lastError = null;
        for (let attempt = 0; attempt < 3 && !done; attempt += 1) {
          let current = entity;
          if (attempt > 0 || index !== moved.length - 1) {
            try { current = await apiFetch('/entity?path=' + encodeURIComponent(entryPath), { skipBrowseCache: true, silentError: true }); }
            catch (error) { lastError = error; break; }
          }
          const candidate = (current?.properties?.[journal.newName] || [])[index];
          if (!candidate) { done = true; lastError = null; break; }
          const ref = { entry_path: entryPath, property: journal.newName, candidate_index: index,
            candidate_id: candidate.candidate_id || '', entry_id: current?.id || current?.entry_id || '',
            entry_revision: current?.revision };
          try {
            await _apiPutValue(ref, { new_property: journal.oldName, baseRevision: current?.revision, __revisionFromRead: Number.isInteger(Number(current?.revision)) });
            restored += 1; done = true; lastError = null;
          } catch (error) {
            lastError = error;
            if (Number(error?.status) !== 409) break;
            await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
          }
        }
        if (lastError) { failed += 1; noteError(name, lastError); }
      }
    }
    if (failed) {
      showStatus('中断した列名の変更を元に戻せませんでした（' + failed + '件。' + firstError.slice(0, 160) + '）。もう一度シートを開いてください', true);
      window.MeldexDiagnostics?.recordSheetIncident?.('retry-failed', { op: 'column-rename-recovery', sheet: dbPath, errorType: 'partial' });
      return false;
    }
    _ptClearLegacyRenameJournal(dbPath);
    if (restored) {
      showStatus('中断した列名の変更（' + journal.oldName + ' → ' + journal.newName + '）を元に戻しました。もう一度変更してください', true);
      window.MeldexDiagnostics?.recordSheetIncident?.('retry-failed', { op: 'column-rename-interrupted', sheet: dbPath, errorType: 'rolled-back' });
      if (typeof selectDatabase === 'function') await selectDatabase(dbPath, ctx, { silent: true, forceReload: true });
    }
    return restored > 0;
  } finally {
    _ptLegacyRenamesInFlight.delete(key);
  }
}

// 列名の変更の取り消しの記録は、保存の完了を待たずに、操作した時点で履歴の枠を取る（2026-11-21）。
// 以前は保存の完了後に記録していたため、保存が終わる前に Ctrl+Z を押すと、直前の別の操作（セルの編集など）が
// 取り消され、列名の変更の記録はその後に積まれていた（exe など保存が遅い環境で再現）。枠は保存が終わるまで
// 取り消しを待たせ、失敗した時は取り除く（セルの値の変更の _dbReserveValueHistory と同じ扱い）。
async function renameDbProperty(dbPath, oldName, newName, ctxOverride, opts = {}) {
  if (!dbPath || !oldName || !newName || oldName === newName) return false;
  if (opts.skipHistory || opts.historyReservation || typeof historyReserve !== 'function') {
    return _renameDbPropertyCore(dbPath, oldName, newName, ctxOverride, opts);
  }
  const scope = typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : (typeof _dbScope === 'function' ? _dbScope(dbPath) : '');
  const reservation = scope ? historyReserve('列名変更: ' + oldName + ' → ' + newName, scope) : null;
  try {
    const result = await _renameDbPropertyCore(dbPath, oldName, newName, ctxOverride, { ...opts, historyReservation: reservation });
    if (result !== true) reservation?.cancel();
    return result;
  } catch (error) {
    reservation?.cancel();
    throw error;
  }
}

async function _renameDbPropertyCore(dbPath, oldName, newName, ctxOverride, opts = {}) {
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
    // 先に送った列定義の保存応答が後から戻っても、この手元の変更を古い定義で戻させない。
    globalThis.GbDbSchemaMutation?.markLocalSchemaChange?.(dbPath);
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
  // 移した値を旧名へ戻す。全部戻せた時だけ true（戻せなかった時は「列名の変更中」の記録を残し、次に開いた時に戻す）。
  const rollbackMovedValues = async () => {
    let ok = true;
    for (const ref of [...movedValueRefs].reverse()) {
      try { await _apiPutValue(ref, { new_property: oldName }); } catch { ok = false; }
    }
    return ok;
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
    if (typeof _ptSyncColumnRenameToPanels === 'function') _ptSyncColumnRenameToPanels(dbPath, newName, oldName, 'reverted');
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
  // オプションパネルの列設定タブ・列管理も保存の完了を待たずに新しい名前へ（失敗時は rollbackOptimistic で戻す）。
  if (typeof _ptSyncColumnRenameToPanels === 'function') _ptSyncColumnRenameToPanels(dbPath, oldName, newName, 'applied');
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
    // 中断に備えて「列名の変更中」を記録する（_ptRecoverInterruptedLegacyRename）。
    _ptWriteLegacyRenameJournal(dbPath, oldName, newName);
    _ptLegacyRenamesInFlight.add(_ptLegacyRenameJournalKey(dbPath));
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
        if (await rollbackMovedValues()) _ptClearLegacyRenameJournal(dbPath);
        _ptLegacyRenamesInFlight.delete(_ptLegacyRenameJournalKey(dbPath));
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
    }).catch((e) => console.warn('列名変更時のアノテート参照更新に失敗:', e));
  }
  if (!bulkRenamed) {
    try {
      await _savePropertyTypesToBackend(dbPath, {
        property_layout: c.propertyLayout || null,
        view_config: c,
      }, targetCtx);
    } catch (error) {
      if (await rollbackMovedValues()) _ptClearLegacyRenameJournal(dbPath);
      _ptLegacyRenamesInFlight.delete(_ptLegacyRenameJournalKey(dbPath));
      await rollbackOptimistic();
      showStatus('列名変更の設定保存に失敗: ' + (error?.message || error), true);
      throw error;
    }
    _ptClearLegacyRenameJournal(dbPath);
    _ptLegacyRenamesInFlight.delete(_ptLegacyRenameJournalKey(dbPath));
  }
  // Undo/Redo: 列削除と同型に、逆方向/順方向の renameDbProperty を呼び直す。
  // skipHistory で undo/redo 実行時の再帰 push を防ぐ。ctx はクロージャ実行時に再解決し、
  // ペインの開き直しにも追従させる（捕捉した targetCtx は stale になり得る）。
  if (!opts.skipHistory && typeof historyPush === 'function' && typeof _dbScope === 'function') {
    const recordHistory = opts.historyReservation
      ? (label, undoFn, redoFn) => opts.historyReservation.fill(undoFn, redoFn, label)
      : historyPush;
    recordHistory('列名変更: ' + oldName + ' → ' + newName,
      async () => { // undo: 新名 → 旧名へ戻す
        if (await renameDbProperty(dbPath, newName, oldName, _ptContextForDbPath(dbPath), { skipHistory: true }) === false) {
          throw new Error('列名の変更を取り消せませんでした');
        }
        if (typeof selectDatabase === 'function') await selectDatabase(dbPath, _ptContextForDbPath(dbPath));
      },
      async () => { // redo: 旧名 → 新名へ再適用
        if (await renameDbProperty(dbPath, oldName, newName, _ptContextForDbPath(dbPath), { skipHistory: true }) === false) {
          throw new Error('列名の変更をやり直せませんでした');
        }
        if (typeof selectDatabase === 'function') await selectDatabase(dbPath, _ptContextForDbPath(dbPath));
      },
      (typeof _dbScopeForPath === 'function' ? _dbScopeForPath(dbPath) : _dbScope(dbPath))
    );
  }
  return true;
}

function showPropertyTypeModal(propName, dbPathOverride, ctxOverride) {
  const dbPath = dbPathOverride || state.currentDbPath;
  if (!dbPath || !propName) return null;
  // 旧APIを呼ぶ拡張や既存コードも、廃止したモーダルではなく列設定タブへ誘導する。
  if (typeof _setSelectedColumns === 'function') _setSelectedColumns(dbPath, [propName], propName);
  if (typeof showDbPropertySettingsForColumn === 'function') {
    showDbPropertySettingsForColumn(dbPath, propName, { switchTab: true, ctx: ctxOverride || null });
  }
  return null;
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
function _dbPickerWorkFolderAbs(dbPath) {
  if (typeof getWorkFolder !== 'function') return '';
  const wf = getWorkFolder(dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '');
  return wf ? _dbPickerNormAbs(wf) : '';
}
function _dbPickerCurrentSheetAbs(dbPath) {
  return _dbPickerNormAbs(dbPath || (typeof state !== 'undefined' ? state.currentDbPath : '') || '');
}
// 作品フォルダが設定され、編集中シートがその中にある場合のみ、候補を作品フォルダ配下へ絞る
function _dbPickerScopeToWorkFolder(dbs, dbPath) {
  const wfAbs = _dbPickerWorkFolderAbs(dbPath);
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

// 参照先シートの表示名。保存先の絶対パスは見せず、入っている場所（ホームフォルダ等）から見た位置で示す
// （2026-11-22 利用者役の探索: 「C:/Users/…/組織」と保存先の絶対パスが出ていた）。
function _dbRelationDbDisplayLabel(dbPath, raw, roots) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const resolved = typeof _dbResolveConfiguredRelationPath === 'function' ? _dbResolveConfiguredRelationPath(dbPath, value) : value;
  const normalized = String(resolved || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!(/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/'))) return value.replace(/\\/g, '/');
  let best = null;
  let bestAbs = '';
  (Array.isArray(roots) ? roots : []).forEach(root => {
    const rootAbs = _dbPickerNormAbs(root?.rootPath || root?.path);
    if (rootAbs && _dbPickerInside(normalized, rootAbs) && rootAbs.length >= bestAbs.length) {
      best = root;
      bestAbs = rootAbs;
    }
  });
  if (best) return normalized.slice(bestAbs.length).replace(/^\/+/, '') || String(best.name || '');
  const name = normalized.split('/').filter(Boolean).pop() || normalized;
  return `${name}（保存先の外）`;
}

// 参照先シート欄の値（保存する参照先）。表示名を出している間は控えておいた参照先を返す。
function _dbRelationDbInputValue(input) {
  if (!input) return '';
  if (input.dataset.relationDbPath != null && input.value === input._relationDisplayValue) return input.dataset.relationDbPath;
  return String(input.value || '').trim();
}

// 絞り込みの一言。ルート名と種類が同じ（「ホームフォルダ」等）なら繰り返さない。
function _dbPickerRootScopeHint(root) {
  const kind = _dbPickerRootKindLabel(root?.kind);
  const name = String(root?.name || '').trim();
  return (!name || name === kind) ? `${kind}内のシートを表示中` : `${name}（${kind}）内のシートを表示中`;
}

function _attachDbPicker(input, dbPath, opts = {}) {
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
  // opts.displayNames: 欄には参照先シートの表示名を出し、保存する参照先は控えに持つ（リレーション列の参照先シート）。
  const displayNames = !!opts.displayNames;
  const displayLabelToPath = new Map();
  const showRelationPath = async (path) => {
    input.dataset.relationDbPath = path;
    const roots = await _ensureRoots();
    if (input.dataset.relationDbPath !== path) return;
    const label = _dbRelationDbDisplayLabel(dbPath, path, roots);
    input._relationDisplayValue = label;
    input.value = label;
    // 中略表示を新しい値へ合わせる（変更の知らせは出さない。開いただけで列の設定を保存しないため）。
    window.GBPathUtils?.bindMiddleEllipsisInput?.(input);
  };
  if (displayNames) {
    const onEdited = (event) => {
      if (input.dataset.relationDbPath != null && input.value === input._relationDisplayValue) return;
      delete input.dataset.relationDbPath;
      input._relationDisplayValue = undefined;
      if (event.type !== 'change') return;
      const typed = String(input.value || '').trim();
      // 候補（表示名）を選んだ・一覧から選んだ・保存先のパスを貼り付けた時は、参照先を控えて表示名に直す。
      const fromList = displayLabelToPath.get(typed);
      if (fromList) showRelationPath(fromList);
      else if (/^[A-Za-z]:[\\/]/.test(typed) || typed.startsWith('/')) showRelationPath(typed);
    };
    input.addEventListener('input', onEdited);
    input.addEventListener('change', onEdited);
    const initial = String(input.value || '').trim();
    if (initial) showRelationPath(initial);
  }
  const refreshCandidates = async () => {
    const dbs = await _getAllDatabases();
    let { list, scoped } = _dbPickerScopeToWorkFolder(dbs, dbPath);
    let hintText = '';
    if (scoped) {
      const wfName = (_dbPickerWorkFolderAbs(dbPath).split('/').pop() || '作品フォルダ');
      hintText = `${wfName}（作品フォルダ）内のシートを表示中`;
    } else {
      const roots = await _ensureRoots();
      const rootScope = _dbPickerScopeToRoot(dbs, dbPath, roots);
      if (rootScope.scoped) {
        list = rootScope.list;
        scoped = true;
        hintText = _dbPickerRootScopeHint(rootScope.root);
      }
    }
    datalist.innerHTML = list.map(d => `<option value="${esc(d.path)}">${esc(d.name)}</option>`).join('');
    if (displayNames) {
      // 候補にも保存先の絶対パスを出さない。表示名から参照先を引けるよう控えておく。
      const roots = await _ensureRoots();
      displayLabelToPath.clear();
      datalist.querySelectorAll('option').forEach(option => {
        const path = option.value;
        const label = _dbRelationDbDisplayLabel(dbPath, path, roots) || path;
        displayLabelToPath.set(label, path);
        option.value = label;
      });
    }
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
          + `<span class="db-picker-tw-icon">${window.MeldexFileIcons?.itemIconHtml?.({ type: 'database', path: d.path }, 13) ?? lucide('database', 13)}</span>`
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
    { value: 'create-dependent', label: '依存トピックを作成' },
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
  return MeldexEscape.cssIdent(value);
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
    // 空のセルへ書いた値も、既存の値の書き換えと同じく取り消せるようにする
    if (typeof _dbUndoCreatedValue === 'function') _dbUndoCreatedValue(propName, entityPath, propName, value, result, { dbPath, ctx: actionCtx });
    _buttonActionUpdateLocalValue(dbPath, entityPath, entityName, propName, null, value, {
      file: result?.path || result?.file,
      candidate_id: result?.candidate_id, entry_id: result?.entry_id, candidate_index: result?.candidate_index,
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
        ${fieldHelp('オンにすると、この列に日時を設定したとき対象カレンダーシートへイベントが自動生成されます', { e2eId: 'pt-calendar-autogen-help' })}
      </div>
    </div>
    <div id="pt-calsync-body" style="${enabled ? '' : 'display:none;'}padding-left:8px;border-left:2px solid var(--border);margin-top:6px;">
      <div class="field"><label>対象カレンダーシート（フォルダパス）</label>
