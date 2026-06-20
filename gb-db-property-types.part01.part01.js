/* プロパティ型・値エディタ — gb-db-props.js から分離 */

function getPropertyTypes(dbPath) {
  const targetPath = dbPath || state.currentDbPath || '';
  const localTypes = getDbViewConfig(targetPath).propertyTypes || {};
  const targetMetadata = _ptMetadataForDbPath(targetPath);
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

function _ptMetadataForDbPath(dbPath) {
  const target = _ptNormalizeDbPath(dbPath || state.currentDbPath || '');
  if (_ptIsCurrentDbPath(target)) return state.dbMetadata || null;
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

function setPropertyType(dbPath, propName, typeConfig) {
  const targetPath = dbPath || state.currentDbPath || '';
  // localStorage にキャッシュ（従来通り）
  const c = getDbViewConfig(targetPath);
  if (!c.propertyTypes) c.propertyTypes = {};
  c.propertyTypes[propName] = typeConfig;
  _unmarkDbPropertyDeletedInConfig(c, propName);
  saveDbViewConfig(targetPath, c);
  // state.dbMetadata にも反映
  const targetMetadata = _ptMetadataForDbPath(targetPath);
  if (targetMetadata) {
    if (!targetMetadata.property_types) targetMetadata.property_types = {};
    targetMetadata.property_types[propName] = typeConfig;
    if (_ptIsCurrentDbPath(targetPath)) state.dbMetadata = targetMetadata;
  }
  // バックエンドに永続保存
  return _savePropertyTypesToBackend(targetPath);
}

const _ptBackendSaveQueues = {};

function _dbDeletedPropsArrayFromConfig(cfg) {
  return Array.isArray(cfg?.deletedProps) ? cfg.deletedProps : [];
}

function getDeletedDbProperties(dbPath) {
  return _dbDeletedPropsArrayFromConfig(getDbViewConfig(dbPath));
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
  const renderCtx = _ptContextForDbPath(dbPath, ctx);
  const ok = await cfConfirm(
    `列「${propName}」を削除します。\n\n既存の候補値データはエントリに残りますが、表示されなくなります。\n（再度同名のプロパティを追加すれば値は復活します）\n\n削除しますか？`
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

async function _savePropertyTypesToBackend(dbPath, extraMetadata) {
  const targetPath = dbPath || state.currentDbPath || '';
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
          property_types: getPropertyTypes(targetPath)
        };
        if (queue.extraMetadata && typeof queue.extraMetadata === 'object') {
          Object.assign(payload, queue.extraMetadata);
          queue.extraMetadata = {};
        }
        try {
          await apiPut('/db-metadata?path=' + encodeURIComponent(targetPath), payload);
        } catch (e) {
          console.warn('プロパティ型設定のバックエンド保存に失敗:', e);
        }
      }
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

async function renameDbProperty(dbPath, oldName, newName) {
  if (!dbPath || !oldName || !newName || oldName === newName) return false;
  const beforeCfg = JSON.parse(JSON.stringify(getDbViewConfig(dbPath)));
  const beforePropertyTypes = JSON.parse(JSON.stringify((typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : beforeCfg.propertyTypes) || {}));
  const targetCtx = typeof _dbFindPaneContextForPath === 'function' ? _dbFindPaneContextForPath(dbPath) : null;
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
    <h3>プロパティ型の設定</h3>
    <div class="modal-body">
      <div class="gb-section-desc">プロパティ: ${esc(propName)}</div>
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
async function _getAllDatabases() {
  if (_dbListCache) return _dbListCache;
  try { _dbListCache = await apiFetch('/databases'); } catch { _dbListCache = []; }
  return _dbListCache;
}
function _attachDbPicker(input) {
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
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'db-picker-btn';
  btn.innerHTML = lucide('db', 14);
  btn.title = 'シート一覧から選択';
  btn.setAttribute('aria-label', 'シート一覧から選択');
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    document.querySelectorAll('.db-picker-popup').forEach(el => el.remove());
    const dbs = await _getAllDatabases();
    const pop = document.createElement('div');
    pop.className = 'db-picker-popup';
    const search = document.createElement('input');
    search.type = 'text'; search.placeholder = 'シート名で検索...';
    pop.appendChild(search);
    const list = document.createElement('div');
    const render = (filter) => {
      list.innerHTML = '';
      const f = (filter || '').toLowerCase();
      const filtered = f ? dbs.filter(d => d.path.toLowerCase().includes(f) || d.name.toLowerCase().includes(f)) : dbs;
      if (filtered.length === 0) {
        const m = document.createElement('div');
        m.className = 'db-picker-empty';
        m.textContent = '該当なし';
        list.appendChild(m);
        return;
      }
      filtered.forEach(d => {
        const item = document.createElement('div');
        item.className = 'dd-nav-item';
        item.innerHTML = `<div class="db-picker-name">${lucide('db', 12)} ${esc(d.name)}</div>`
          + `<div class="db-picker-path">${esc(d.path)}</div>`;
        item.addEventListener('click', () => {
          input.value = d.path;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          pop.remove();
        });
        list.appendChild(item);
      });
    };
    render('');
    search.addEventListener('input', () => render(search.value));
    pop.appendChild(list);
    const rect = btn.getBoundingClientRect();
    { const z = _getZoom(); pop.style.left = Math.min(rect.left / z, window.innerWidth / z - 440) + 'px'; pop.style.top = (rect.bottom / z + 4) + 'px'; }
    document.body.appendChild(pop);
    clampPopupToViewport(pop);
    setTimeout(() => {
      search.focus();
      const closer = (ev) => { if (!pop.contains(ev.target) && ev.target !== btn) { pop.remove(); document.removeEventListener('pointerdown', closer); } };
      document.addEventListener('pointerdown', closer);
    }, 50);
  });
  row.appendChild(btn);
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
    _attachDbPicker(dbInput);
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
        remoteInput.value = rule.remoteProp || ''; remoteInput.placeholder = 'プロパティ名';
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
      <label class="pt-check-label">
        <input id="pt-calsync-enabled" type="checkbox" ${enabled ? 'checked' : ''}>
        カレンダー連動を有効にする
      </label>
      <div class="pt-hint">有効にすると、このプロパティに日時を設定したときに対象カレンダーシートへイベントが自動生成されます（Phase 1 §5.2）。</div>
    </div>
    <div id="pt-calsync-body" style="${enabled ? '' : 'display:none;'}padding-left:8px;border-left:2px solid var(--border);margin-top:6px;">
      <div class="field"><label>対象カレンダーシート（フォルダパス）</label>
