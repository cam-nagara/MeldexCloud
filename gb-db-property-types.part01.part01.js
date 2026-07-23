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
  saveDbViewConfig(targetPath, c);
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
  if (level === 'required') { showStatus('スタッフ管理に必要な列は削除できません。非表示を利用してください', true); }
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
  if (deleted.size === 0) return props.filter(Boolean);
  return props.filter(prop => prop && !deleted.has(prop));
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
    try {
      while (queue.dirty) {
        queue.dirty = false;
        const payload = {
          property_types: getPropertyTypes(targetPath, ctxOverride)
        };
        if (queue.extraMetadata && typeof queue.extraMetadata === 'object') {
          Object.assign(payload, queue.extraMetadata);
          queue.extraMetadata = {};
        }
        try {
          if (typeof isProductionManagementWriteBlocked === 'function'
              && isProductionManagementWriteBlocked(targetPath, ctxOverride)) continue;
          await apiPut('/db-metadata?path=' + encodeURIComponent(targetPath), payload);
        } catch (e) {
          console.warn('プロパティ型設定のバックエンド保存に失敗:', e);
        }
      }
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

function _renamePropertyTypeReferences(cfg, oldName, newName) {
  if (!cfg || typeof cfg !== 'object') return;
  if (cfg.pairWith === oldName) cfg.pairWith = newName;
  if (cfg.cascadeFrom === oldName) cfg.cascadeFrom = newName;
  if (cfg.relationProp === oldName) cfg.relationProp = newName;
  if (cfg.relationDb === '' && cfg.bidirectionalProp === oldName) cfg.bidirectionalProp = newName;
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
  if (Array.isArray(target.advancedFilters)) {
    target.advancedFilters = target.advancedFilters.filter(filter => filter?.property !== propName && filter?.prop !== propName);
  }
  if (target.sortConfig?.key === propName) delete target.sortConfig;
  if (target.groupBy === propName) target.groupBy = null;
  if (target.entityNameProp === propName) target.entityNameProp = '';
  if (Array.isArray(target.fields)) target.fields = target.fields.filter(n => n !== propName);
  if (target.formConfig) _deleteViewConfigPropReferences(target.formConfig, propName);
  const ts = target.typeSpecific;
  if (ts && typeof ts === 'object') {
    if (ts.pivot?.groupBy === propName) ts.pivot.groupBy = null;
    if (ts.kanban?.groupBy === propName) ts.kanban.groupBy = '_status';
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
  if (Array.isArray(target.advancedFilters)) {
    target.advancedFilters.forEach(filter => {
      if (filter?.property === oldName) filter.property = newName;
      if (filter?.prop === oldName) filter.prop = newName;
    });
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

// ctxOverride: 呼び出し側が既に持っているペインctxを直接渡すためのオプション引数。値の移設
// （entities のcandidateを oldName から newName へ移す下の for ループ）は pivotData.entities
// を辿るため、正しい ctx が無いと「登録済みペインの pivotData」ではなく state.pivotData
// （現在グローバルにアクティブな別ペインの pivotData、または何も開いていなければ空）を誤って
// 対象にしてしまう。埋め込みシート（グローバル _panes レジストリに未登録）から呼ぶ場合は特に
// 必須（_dbFindPaneContextForPath() のレジストリ探索では見つからないため）。渡さない場合は
// 従来通りの再解決にフォールバックする（挙動は変わらない）。2026-07-15 フェーズD1で確認。
async function renameDbProperty(dbPath, oldName, newName, ctxOverride) {
  if (!dbPath || !oldName || !newName || oldName === newName) return false;
  const renameProtectionLevel = _dbSchemaProtectionLevel(dbPath, oldName);
  if (renameProtectionLevel) {
    _showSchemaProtectionBlockedStatus(renameProtectionLevel);
    return false;
  }
  const beforeCfg = JSON.parse(JSON.stringify(getDbViewConfig(dbPath)));
  const beforePropertyTypes = JSON.parse(JSON.stringify((typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : beforeCfg.propertyTypes) || {}));
  const targetCtx = ctxOverride || (typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null);
  const pivotData = (typeof _dbPivotDataForContext === 'function' ? _dbPivotDataForContext(targetCtx) : null) || (_ptIsCurrentDbPath(dbPath) ? state.pivotData : null);
  const c = getDbViewConfig(dbPath);
  const rawExistingProps = [
    ...(Array.isArray(pivotData?.properties) ? pivotData.properties : []),
    ...(Array.isArray(c.colOrder) ? c.colOrder : []),
    ...Object.keys(c.propertyTypes || {}),
    ...Object.keys(getPropertyTypes(dbPath) || {}),
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
  const pt = JSON.parse(JSON.stringify(getPropertyTypes(dbPath) || {}));
  if (pt[oldName]) { pt[newName] = pt[oldName]; delete pt[oldName]; }
  Object.values(pt).forEach(cfg => _renamePropertyTypeReferences(cfg, oldName, newName));
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
  if (c.conditionalColors?.[oldName]) {
    c.conditionalColors[newName] = c.conditionalColors[oldName];
    delete c.conditionalColors[oldName];
  }
  if (c.sortConfig?.key === oldName) c.sortConfig.key = newName;
  if (c.groupBy === oldName) c.groupBy = newName;
  if (c.formConfig) _renameViewConfigPropReferences(c.formConfig, oldName, newName);
  _renameViewConfigPropReferences(c, oldName, newName);
  (c.savedViews || []).forEach(view => _renameViewConfigPropReferences(view, oldName, newName));
  saveDbViewConfig(dbPath, c);
  if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata) {
    state.dbMetadata.property_types = pt;
    if (state.dbMetadata.property_layout && typeof renamePropertyLayoutReferences === 'function') {
      state.dbMetadata.property_layout = renamePropertyLayoutReferences(state.dbMetadata.property_layout, oldName, newName);
    }
  }
  const entities = pivotData?.entities || {};
  const valueErrors = [];
  const movedEntities = [];
  const movedValueRefs = [];
  const restoreBeforeConfig = async () => {
    saveDbViewConfig(dbPath, beforeCfg);
    const restoredTypes = Object.keys(beforePropertyTypes).length ? beforePropertyTypes : (beforeCfg.propertyTypes || {});
    if (_ptIsCurrentDbPath(dbPath) && state.dbMetadata) {
      state.dbMetadata.property_types = JSON.parse(JSON.stringify(restoredTypes));
      state.dbMetadata.property_layout = beforeCfg.propertyLayout || null;
    }
    const cfg = getDbViewConfig(dbPath);
    cfg.propertyTypes = JSON.parse(JSON.stringify(restoredTypes));
    saveDbViewConfig(dbPath, cfg, { skipHistory: true });
    await _savePropertyTypesToBackend(dbPath, { property_layout: beforeCfg.propertyLayout || null });
  };
  const rollbackMovedValues = async () => {
    for (const ref of [...movedValueRefs].reverse()) {
      try { await _apiPutValue(ref, { new_property: oldName }); } catch {}
    }
  };
  // SQLiteネイティブシートはサーバー側で列名を全エントリ一括変更する。
  // 従来は1マスずつ PUT し、そのたびにシート全体のスナップショットを保存していたため
  // 数百行の列で数百往復＋数百スナップショットになり、確定に数秒かかっていた。
  let bulkRenamed = false;
  try {
    const bulk = await apiPut('/db-property/rename',
      { db_path: dbPath, old_name: oldName, new_name: newName },
      { silentError: true });
    if (bulk && bulk.ok && !bulk.fallback) {
      bulkRenamed = true;
    } else if (bulk && bulk.conflict) {
      await restoreBeforeConfig();
      showStatus('同じ名前の列が既にあります: ' + newName, true);
      return false;
    }
    // bulk.fallback（旧マークダウン形式）の場合は下の逐次経路へ
  } catch (e) {
    // 一括経路が使えない場合は従来の逐次経路へフォールバックする
  }

  if (bulkRenamed) {
    Object.values(entities).forEach(ent => {
      if (ent && Array.isArray(ent[oldName])) {
        ent[newName] = ent[oldName].map(v => ({ ...v, property: newName }));
        delete ent[oldName];
      }
    });
  } else {
    for (const ent of Object.values(entities)) {
      const vals = ent?.[oldName];
      if (!Array.isArray(vals)) continue;
      const moveVals = vals.slice().sort((a, b) => (Number(b?.candidate_index) || 0) - (Number(a?.candidate_index) || 0));
      for (const val of moveVals) {
        try {
          await _apiPutValue(val, { new_property: newName });
          val.property = newName;
          movedValueRefs.push({ ...val, property: newName });
        }
        catch (e) { valueErrors.push(e); }
      }
      if (valueErrors.length) {
        await rollbackMovedValues();
        await restoreBeforeConfig();
        const msg = valueErrors[0]?.message || valueErrors[0] || '値の更新に失敗しました';
        showStatus('列名変更に失敗: ' + msg, true);
        throw valueErrors[0] || new Error('rename value update failed');
      }
      movedEntities.push({ ent, vals });
    }
    movedEntities.forEach(({ ent, vals }) => {
      ent[newName] = vals.map(v => ({ ...v, property: newName }));
      delete ent[oldName];
    });
  }
  // 描画に使う pivotData の列名を付け替える。properties 配列の付け替えが抜けていると、
  // renderPivot() は colOrder ∪ pivotData.properties ∪ propertyTypes から列を組み立て
  // 生キーをヘッダーに出すため、旧名がそのまま残り「リネームが反映されない」ように見える。
  // entities も一緒に付け替える。properties だけ新名にして entities を旧名のまま残すと、
  // その pivotData を描画するペインがヘッダー新名＋空セル（データ消失に見える）になる。
  // value-move 済みの pivotData では entities 側は no-op（旧名キーが既に無い）＝冪等。
  // 分割ビューで同一シートを別ペインに開いている場合の state.pivotdata（別オブジェクト）にも
  // 同じ移行を適用し、そのペインが空セルにならないようにする。
  const _renamePivotLocal = (pd) => {
    if (!pd) return;
    if (Array.isArray(pd.properties)) {
      pd.properties = [...new Set(pd.properties.map(n => (n === oldName ? newName : n)))];
    }
    if (pd.entities && typeof pd.entities === 'object') {
      Object.values(pd.entities).forEach(ent => {
        if (ent && Array.isArray(ent[oldName])) {
          ent[newName] = ent[oldName].map(v => ({ ...v, property: newName }));
          delete ent[oldName];
        }
      });
    }
  };
  _renamePivotLocal(pivotData);
  if (_ptIsCurrentDbPath(dbPath) && state.pivotData && state.pivotData !== pivotData) {
    _renamePivotLocal(state.pivotData);
  }
  if (typeof updatePropertyLayoutForRename === 'function') {
    await updatePropertyLayoutForRename(dbPath, oldName, newName);
  }
  if (typeof apiPost === 'function') {
    await apiPost('/annotations/rename-sheet-column', {
      target_file: dbPath,
      old_col: oldName,
      new_col: newName,
    }).catch((e) => console.warn('列名変更時の注釈参照更新に失敗:', e));
  }
  await _savePropertyTypesToBackend(dbPath);
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
  let row = input.parentNode;
  if (!row || !row.classList || !row.classList.contains('db-picker-input-row')) {
    row = document.createElement('div');
    row.className = 'db-picker-input-row';
    input.parentNode.insertBefore(row, input);
    row.appendChild(input);
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
  row.parentNode.insertBefore(scopeHint, row.nextSibling);
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

// マルチソースリレーション設定UI描画
function _renderMsrSources(sources, mode, root) {
  const scope = _ptResolveRoot(root);
  const container = _ptGet('pt-msr-sources', scope);
  if (!container) return;
  container.innerHTML = '';
  const stateInfo = _ptState(scope);
  const rawMyProps = stateInfo.pivotData?.properties || [];
  const myProps = typeof filterDeletedDbProperties === 'function'
    ? filterDeletedDbProperties(stateInfo.dbPath || state.currentDbPath || '', rawMyProps)
    : rawMyProps;

  sources.forEach((src, idx) => {
    const div = document.createElement('div');
    div.className = 'msr-source-row';

    // DB パス
    const dbRow = document.createElement('div');
    dbRow.className = 'msr-field-row';
    dbRow.innerHTML = '<span>シート:</span>';
    const dbInput = document.createElement('input');
    dbInput.type = 'text'; dbInput.className = 'msr-db-input';
    dbInput.value = src.db || ''; dbInput.placeholder = '例: 開発/デバッグリスト';
    dbRow.appendChild(dbInput);
    _attachDbPicker(dbInput, _ptState(scope)?.dbPath);
    div.appendChild(dbRow);

    // ラベル
    const lblRow = document.createElement('div');
    lblRow.className = 'msr-field-row';
    lblRow.innerHTML = '<span>ラベル:</span>';
    const lblInput = document.createElement('input');
    lblInput.type = 'text'; lblInput.className = 'msr-label-input';
    lblInput.value = src.label || ''; lblInput.placeholder = '(シート名から自動生成)';
    lblRow.appendChild(lblInput);
    div.appendChild(lblRow);

    // マッチ条件（自動モード時のみ）
    if (mode === 'auto') {
      const rulesDiv = document.createElement('div');
      rulesDiv.className = 'msr-rules';
      const rulesLabel = document.createElement('div');
      rulesLabel.className = 'msr-rules-label';
      rulesLabel.textContent = 'マッチ条件:';
      rulesDiv.appendChild(rulesLabel);

      const rules = src.matchRules || [];
      rules.forEach((rule, ri) => {
        const ruleRow = document.createElement('div');
        ruleRow.className = 'msr-rule-row';

        // 自DBプロパティ
        const mySelect = document.createElement('select');
        mySelect.className = 'msr-my-prop';
        myProps.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; if (p === rule.myProp) o.selected = true; mySelect.appendChild(o); });
        ruleRow.appendChild(mySelect);

        ruleRow.appendChild(document.createTextNode(' = 参照先の '));

        // 参照先プロパティ（テキスト入力）
        const remoteInput = document.createElement('input');
        remoteInput.type = 'text'; remoteInput.className = 'msr-remote-prop';
        remoteInput.value = rule.remoteProp || ''; remoteInput.placeholder = '列名';
        remoteInput.className = 'msr-remote-prop';
        ruleRow.appendChild(remoteInput);

        // 削除ボタン
        const delRule = document.createElement('button');
        delRule.innerHTML = lucide('x', 12); delRule.className = 'pt-small-btn';
        delRule.addEventListener('click', () => {
          const s = _collectMsrSources(scope);
          s[idx].matchRules.splice(ri, 1);
          _renderMsrSources(s, mode, scope);
        });
        ruleRow.appendChild(delRule);
        rulesDiv.appendChild(ruleRow);
      });

      // + 条件追加
      const addRule = document.createElement('button');
      addRule.textContent = '+ 条件を追加'; addRule.className = 'pt-small-btn';
      addRule.addEventListener('click', () => {
        const s = _collectMsrSources(scope);
        if (!s[idx].matchRules) s[idx].matchRules = [];
        s[idx].matchRules.push({ myProp: '', remoteProp: '' });
        _renderMsrSources(s, mode, scope);
      });
      rulesDiv.appendChild(addRule);
      div.appendChild(rulesDiv);
    }

    // ソース削除
    const delBtn = document.createElement('button');
    delBtn.innerHTML = lucide('x', 12) + ' ソース削除'; delBtn.className = 'pt-small-btn muted';
    delBtn.addEventListener('click', () => {
      const s = _collectMsrSources(scope);
      s.splice(idx, 1);
      _renderMsrSources(s, mode, scope);
    });
    div.appendChild(delBtn);

    container.appendChild(div);
  });
}

// マルチソースリレーション設定をUIから収集
function _collectMsrSources(root) {
  const container = _ptGet('pt-msr-sources', root);
  if (!container) return [];
  const sources = [];
  container.querySelectorAll('.msr-source-row').forEach(row => {
    const src = {
      db: row.querySelector('.msr-db-input')?.value?.trim() || '',
      label: row.querySelector('.msr-label-input')?.value?.trim() || '',
    };
    const rules = [];
    row.querySelectorAll('.msr-rules > div:not(:last-child)').forEach(ruleRow => {
      if (!ruleRow.querySelector('.msr-my-prop')) return;
      rules.push({
        myProp: ruleRow.querySelector('.msr-my-prop')?.value || '',
        remoteProp: ruleRow.querySelector('.msr-remote-prop')?.value || '',
      });
    });
    if (rules.length > 0) src.matchRules = rules;
    sources.push(src);
  });
  return sources;
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
