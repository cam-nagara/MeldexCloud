/* gb-sheet-view-config.js: 本体・Cloud・Windows単独版で共有するシート表示設定 */
'use strict';

// DB表示設定（シートメタデータを正、localStorageを即時キャッシュとして使う）
const _dbViewConfigBackendSaveTimers = new Map();
const _dbViewConfigBackendSaveRunners = new Map();
const _dbViewConfigBackendSavePromises = new Map();
const _dbViewConfigBackendSavePayloads = new Map();
let _dbViewConfigBackendSaveRevision = 0;

function getDbViewConfigStorageKey(dbPath) {
  const fileId = MeldexSheetViewConfigEnvironment.fileId(dbPath);
  return 'dbViewConfig:' + (fileId || dbPath || '');
}
function _isDbViewPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function _cloneDbViewValue(value, fallback) {
  if (value == null) return fallback;
  try {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  } catch {
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }
}
function _cloneDbViewArray(value) {
  return Array.isArray(value) ? _cloneDbViewValue(value, []) : [];
}
function _cloneDbViewObject(value) {
  return _isDbViewPlainObject(value) ? _cloneDbViewValue(value, {}) : {};
}
function _hasDbViewArrayState(value) {
  return Array.isArray(value) && value.length > 0;
}
function _hasDbViewObjectState(value) {
  return _isDbViewPlainObject(value) && Object.keys(value).length > 0;
}
function _normalizeDbViewModeValue(mode) {
  const value = String(mode || '').trim();
  return ['pivot', 'tree', 'gallery', 'kanban', 'calendar', 'timeline', 'chart', 'graph', 'form'].includes(value)
    ? value
    : 'pivot';
}
function _normalizeDbTimelineTypeSpecific(timeline) {
  const src = _cloneDbViewObject(timeline);
  const out = {
    timeProp: String(src.timeProp || ''),
    endProp: String(src.endProp || ''),
    rowProp: String(src.rowProp || '_entity'),
    scale: String(src.scale || 'day'),
    direction: String(src.direction || 'horizontal'),
    displayStart: String(src.displayStart || ''),
    displayEnd: String(src.displayEnd || ''),
    timeStepMinutes: Math.max(1, Math.round(Number(src.timeStepMinutes || 1) || 1)),
    calendarSystemId: String(src.calendarSystemId || 'gregorian'),
    ...src,
  };
  out.colWidths = _cloneDbViewObject(src.colWidths);
  out.rowHeights = _cloneDbViewObject(src.rowHeights);
  out.cardProps = _cloneDbViewArray(src.cardProps);
  out.calendarSystems = _cloneDbViewArray(src.calendarSystems);
  out.displayStart = String(out.displayStart || '');
  out.displayEnd = String(out.displayEnd || '');
  out.timeStepMinutes = Math.max(1, Math.round(Number(out.timeStepMinutes || 1) || 1));
  out.calendarSystemId = String(out.calendarSystemId || 'gregorian');
  out.cardImageThumbCount = Math.max(1, Math.min(12, Math.round(Number(out.cardImageThumbCount || 3) || 3)));
  out.cardPropLineCount = Math.max(1, Math.min(20, Math.round(Number(out.cardPropLineCount || 1) || 1)));
  return out;
}
function _makeLegacyDbSavedView(cfg) {
  const viewMode = _normalizeDbViewModeValue(cfg.currentViewMode || 'pivot');
  return {
    name: typeof _defaultDbSavedViewName === 'function' ? _defaultDbSavedViewName(viewMode, 0) : 'テーブル',
    viewMode,
    hiddenCols: _cloneDbViewArray(cfg.hiddenCols),
    pinnedCols: _cloneDbViewArray(cfg.pinnedCols),
    colOrder: cfg.colOrder == null ? null : _cloneDbViewValue(cfg.colOrder, null),
    advancedFilters: _cloneDbViewArray(cfg.advancedFilters),
    columnValueFilters: _cloneDbViewObject(cfg.columnValueFilters),
    conditionalFormat: !!cfg.conditionalFormat,
    conditionalColors: _cloneDbViewObject(cfg.conditionalColors),
    filter: 'disabled',
    sortConfig: cfg.sortConfig == null ? null : _cloneDbViewValue(cfg.sortConfig, null),
    manualOrder: cfg.manualOrder == null ? null : _cloneDbViewValue(cfg.manualOrder, null),
    showFooter: !!cfg.showFooter,
    entityColumnPinned: cfg.entityColumnPinned !== false,
    countTypes: _cloneDbViewObject(cfg.countTypes),
    colWidths: _cloneDbViewObject(cfg.colWidths),
    thumbnailSize: cfg.thumbnailSize || 'small',
    typeSpecific: {
      pivot: { groupBy: cfg.groupBy || null },
      gallery: {},
      kanban: { groupBy: cfg.kanbanGroupBy || '_status' },
      calendar: { mapping: _cloneDbViewObject(cfg.calendarMapping) },
      timeline: _normalizeDbTimelineTypeSpecific(cfg.timeline),
      chart: _cloneDbViewObject(cfg.chartConfig),
      graph: _cloneDbViewObject(cfg.graphConfig),
      form: { formConfig: cfg.formConfig == null ? null : _cloneDbViewValue(cfg.formConfig, null) },
    },
  };
}
function _ensureDbViewTypeSpecific(view, cfg) {
  const current = _isDbViewPlainObject(view.typeSpecific) ? view.typeSpecific : {};
  view.typeSpecific = current;
  if (!_isDbViewPlainObject(current.pivot)) current.pivot = {};
  if (current.pivot.groupBy == null) current.pivot.groupBy = view.groupBy || cfg.groupBy || null;
  if (!_isDbViewPlainObject(current.tree)) current.tree = {};
  if (!_isDbViewPlainObject(current.gallery)) current.gallery = {};
  if (!_isDbViewPlainObject(current.kanban)) current.kanban = {};
  if (current.kanban.groupBy == null) current.kanban.groupBy = view.kanbanGroupBy || cfg.kanbanGroupBy || '_status';
  if (!_isDbViewPlainObject(current.calendar)) current.calendar = {};
  if (!_isDbViewPlainObject(current.calendar.mapping)) current.calendar.mapping = _cloneDbViewObject(cfg.calendarMapping);
  current.timeline = _normalizeDbTimelineTypeSpecific(current.timeline || cfg.timeline);
  if (!_isDbViewPlainObject(current.chart)) current.chart = _cloneDbViewObject(cfg.chartConfig);
  if (!_isDbViewPlainObject(current.graph)) current.graph = _cloneDbViewObject(cfg.graphConfig);
  if (!_isDbViewPlainObject(current.form)) current.form = {};
  if (current.form.formConfig == null) {
    current.form.formConfig = view.formConfig != null
      ? _cloneDbViewValue(view.formConfig, null)
      : (cfg.formConfig != null ? _cloneDbViewValue(cfg.formConfig, null) : null);
  }
}
function _normalizeSavedDbViewForV2(view, cfg, index) {
  const v = _isDbViewPlainObject(view) ? view : {};
  v.viewMode = _normalizeDbViewModeValue(v.viewMode || cfg.currentViewMode || 'pivot');
  if (!String(v.name || '').trim()) {
    v.name = typeof _defaultDbSavedViewName === 'function'
      ? _defaultDbSavedViewName(v.viewMode, index)
      : (index === 0 ? 'テーブル' : 'テーブル ' + (index + 1));
  }
  if (v.hiddenCols == null) v.hiddenCols = _cloneDbViewArray(cfg.hiddenCols);
  else v.hiddenCols = _cloneDbViewArray(v.hiddenCols);
  if (v.pinnedCols == null) v.pinnedCols = _cloneDbViewArray(cfg.pinnedCols);
  else v.pinnedCols = _cloneDbViewArray(v.pinnedCols);
  if (v.colOrder == null) v.colOrder = cfg.colOrder == null ? null : _cloneDbViewValue(cfg.colOrder, null);
  else v.colOrder = _cloneDbViewValue(v.colOrder, null);
  if (v.advancedFilters == null) v.advancedFilters = _cloneDbViewArray(cfg.advancedFilters);
  else v.advancedFilters = _cloneDbViewArray(v.advancedFilters);
  if (v.columnValueFilters == null) v.columnValueFilters = _cloneDbViewObject(cfg.columnValueFilters);
  else v.columnValueFilters = _cloneDbViewObject(v.columnValueFilters);
  if (v.conditionalFormat == null) v.conditionalFormat = !!cfg.conditionalFormat;
  else v.conditionalFormat = !!v.conditionalFormat;
  if (v.conditionalColors == null) v.conditionalColors = _cloneDbViewObject(cfg.conditionalColors);
  else v.conditionalColors = _cloneDbViewObject(v.conditionalColors);
  if (v.filter == null) v.filter = 'disabled';
  if (v.sortConfig == null) v.sortConfig = cfg.sortConfig == null ? null : _cloneDbViewValue(cfg.sortConfig, null);
  else v.sortConfig = _cloneDbViewValue(v.sortConfig, null);
  if (v.manualOrder == null) v.manualOrder = cfg.manualOrder == null ? null : _cloneDbViewValue(cfg.manualOrder, null);
  else v.manualOrder = _cloneDbViewValue(v.manualOrder, null);
  if (v.showFooter == null) v.showFooter = !!cfg.showFooter;
  else v.showFooter = !!v.showFooter;
  if (v.entityColumnPinned == null) v.entityColumnPinned = cfg.entityColumnPinned !== false;
  else v.entityColumnPinned = v.entityColumnPinned !== false;
  if (v.countTypes == null) v.countTypes = _cloneDbViewObject(cfg.countTypes);
  else v.countTypes = _cloneDbViewObject(v.countTypes);
  if (v.colWidths == null) v.colWidths = _cloneDbViewObject(cfg.colWidths);
  else v.colWidths = _cloneDbViewObject(v.colWidths);
  if (v.thumbnailSize == null) v.thumbnailSize = cfg.thumbnailSize || 'small';
  _ensureDbViewTypeSpecific(v, cfg);
  return v;
}
function _hasLegacyDbViewState(cfg) {
  return _hasDbViewArrayState(cfg.hiddenCols)
    || _hasDbViewArrayState(cfg.pinnedCols)
    || _hasDbViewArrayState(cfg.colOrder)
    || _hasDbViewArrayState(cfg.advancedFilters)
    || _hasDbViewObjectState(cfg.columnValueFilters)
    || _hasDbViewObjectState(cfg.conditionalColors)
    || _hasDbViewObjectState(cfg.countTypes)
    || _hasDbViewObjectState(cfg.colWidths)
    || !!cfg.conditionalFormat
    || !!cfg.groupBy
    || !!cfg.kanbanGroupBy
    || !!cfg.chartConfig
    || !!cfg.graphConfig
    || !!cfg.timeline
    || !!cfg.formConfig
    || !!cfg.calendarMapping
    || !!cfg.sortConfig
    || !!cfg.manualOrder
    || cfg.showFooter === true
    || cfg.entityColumnPinned === false
    || (cfg.thumbnailSize && cfg.thumbnailSize !== 'small')
    || (cfg.currentViewMode && cfg.currentViewMode !== 'pivot');
}
function _hasDbViewMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (_isDbViewPlainObject(value)) return Object.values(value).some(_hasDbViewMeaningfulValue);
  return value !== null && value !== undefined && value !== '' && value !== false;
}
function _hasMeaningfulDbTimelineState(timeline) {
  if (!_isDbViewPlainObject(timeline)) return false;
  if (String(timeline.timeProp || '')) return true;
  if (String(timeline.endProp || '')) return true;
  if (String(timeline.rowProp || '_entity') !== '_entity') return true;
  if (String(timeline.scale || 'day') !== 'day') return true;
  if (String(timeline.direction || 'horizontal') !== 'horizontal') return true;
  if (String(timeline.displayStart || '')) return true;
  if (String(timeline.displayEnd || '')) return true;
  if (Math.max(1, Math.round(Number(timeline.timeStepMinutes || 1) || 1)) !== 1) return true;
  if (String(timeline.calendarSystemId || 'gregorian') !== 'gregorian') return true;
  if (Math.max(1, Math.min(12, Math.round(Number(timeline.cardImageThumbCount || 3) || 3))) !== 3) return true;
  if (Math.max(1, Math.min(20, Math.round(Number(timeline.cardPropLineCount || 1) || 1))) !== 1) return true;
  if (_hasDbViewObjectState(timeline.colWidths)) return true;
  if (_hasDbViewObjectState(timeline.rowHeights)) return true;
  if (_hasDbViewArrayState(timeline.cardProps)) return true;
  if (_hasDbViewArrayState(timeline.calendarSystems)) return true;
  const defaults = new Set([
    'timeProp', 'endProp', 'rowProp', 'scale', 'direction', 'displayStart', 'displayEnd',
    'timeStepMinutes', 'calendarSystemId', 'colWidths', 'rowHeights', 'cardProps', 'calendarSystems',
    'cardImageThumbCount', 'cardPropLineCount',
  ]);
  return Object.keys(timeline).some((key) => !defaults.has(key) && _hasDbViewMeaningfulValue(timeline[key]));
}
function _hasMeaningfulDbSavedViewState(view, index) {
  if (!_isDbViewPlainObject(view)) return false;
  const viewMode = _normalizeDbViewModeValue(view.viewMode || 'pivot');
  if (viewMode !== 'pivot') return true;
  const defaultName = typeof _defaultDbSavedViewName === 'function'
    ? _defaultDbSavedViewName(viewMode, index)
    : (index === 0 ? 'テーブル' : 'テーブル ' + (index + 1));
  const name = String(view.name || '').trim();
  if (name && name !== defaultName) return true;
  if (_hasDbViewArrayState(view.hiddenCols) || _hasDbViewArrayState(view.pinnedCols)) return true;
  if (_hasDbViewArrayState(view.colOrder) || _hasDbViewObjectState(view.colOrder)) return true;
  if (_hasDbViewArrayState(view.advancedFilters)) return true;
  if (_hasDbViewObjectState(view.columnValueFilters)) return true;
  if (view.conditionalFormat === true || _hasDbViewObjectState(view.conditionalColors)) return true;
  if (view.filter && view.filter !== 'disabled') return true;
  if (_hasDbViewMeaningfulValue(view.sortConfig) || _hasDbViewMeaningfulValue(view.manualOrder)) return true;
  if (view.showFooter === true || view.entityColumnPinned === false) return true;
  if (_hasDbViewObjectState(view.countTypes) || _hasDbViewObjectState(view.colWidths)) return true;
  if (view.thumbnailSize && view.thumbnailSize !== 'small') return true;
  const typeSpecific = _isDbViewPlainObject(view.typeSpecific) ? view.typeSpecific : {};
  if (typeSpecific.pivot?.groupBy) return true;
  if (_hasDbViewObjectState(typeSpecific.tree)) return true;
  if (typeSpecific.kanban?.groupBy && typeSpecific.kanban.groupBy !== '_status') return true;
  if (_hasDbViewObjectState(typeSpecific.calendar?.mapping)) return true;
  if (_hasMeaningfulDbTimelineState(typeSpecific.timeline)) return true;
  if (_hasDbViewObjectState(typeSpecific.chart) || _hasDbViewObjectState(typeSpecific.graph)) return true;
  return typeSpecific.form?.formConfig != null;
}
function _hasMeaningfulDbViewConfigState(cfg) {
  if (!_isDbViewPlainObject(cfg)) return false;
  if (_hasDbViewArrayState(cfg.deletedProps)) return true;
  if (_hasLegacyDbViewState(cfg)) return true;
  const views = Array.isArray(cfg.savedViews) ? cfg.savedViews : [];
  if (views.length > 1) return true;
  if (Number.isInteger(cfg.currentViewIdx) && cfg.currentViewIdx > 0) return true;
  return views.some((view, index) => _hasMeaningfulDbSavedViewState(view, index));
}
function _migrateLegacyViewConfig(dbPath, cfg) {
  const config = _isDbViewPlainObject(cfg) ? cfg : {};
  if (!dbPath) return { cfg: config, changed: false };
  if (config._viewMigrationV2Done === true) {
    if (!Array.isArray(config.savedViews)) config.savedViews = [];
    if (config.savedViews.length > 0
      && (!Number.isInteger(config.currentViewIdx)
        || config.currentViewIdx < 0
        || config.currentViewIdx >= config.savedViews.length)) {
      config.currentViewIdx = 0;
      return { cfg: config, changed: true };
    }
    return { cfg: config, changed: false };
  }

  const legacyView = _makeLegacyDbSavedView(config);
  const existingViews = Array.isArray(config.savedViews) ? config.savedViews : [];
  config.savedViews = existingViews.map((view, index) => _normalizeSavedDbViewForV2(view, config, index));
  if (config.savedViews.length === 0) {
    config.savedViews.push(legacyView);
    config.currentViewIdx = 0;
  } else {
    if (_hasLegacyDbViewState(config) && config.currentViewIdx === -1) {
      config.savedViews.unshift(legacyView);
      config.currentViewIdx = 0;
    } else if (config.currentViewIdx === -1 || config.currentViewIdx == null) {
      config.currentViewIdx = 0;
    }
    if (config.currentViewIdx < 0 || config.currentViewIdx >= config.savedViews.length) {
      config.currentViewIdx = 0;
    }
  }
  config._viewMigrationV2Done = true;
  return { cfg: config, changed: true };
}
function _persistMigratedDbViewConfig(dbPath, cfg) {
  try { localStorage.setItem(getDbViewConfigStorageKey(dbPath), JSON.stringify(cfg || {})); } catch {}
}
function _sanitizeDbViewConfigForBackend(cfg) {
  const cleaned = _cloneDbViewObject(cfg);
  // プロパティ型は property_types として別保存される。重複保存すると新旧形式がずれやすい。
  if (Object.prototype.hasOwnProperty.call(cleaned, 'propertyTypes')) delete cleaned.propertyTypes;
  return cleaned;
}
function _hasLocalDbViewConfigCache(dbPath) {
  const fileId = MeldexSheetViewConfigEnvironment.fileId(dbPath);
  const keys = [];
  if (fileId) keys.push('dbViewConfig:' + fileId);
  keys.push('dbViewConfig:' + (dbPath || ''));
  return [...new Set(keys)].some((key) => {
    try {
      const value = localStorage.getItem(key);
      if (value == null || String(value).trim() === '') return false;
      return _hasMeaningfulDbViewConfigState(JSON.parse(value));
    } catch {
      return false;
    }
  });
}
function _persistDbViewConfigToBackend(dbPath, cfg, options = {}) {
  if (!dbPath || typeof MeldexSheetViewConfigEnvironment?.put !== 'function') return Promise.resolve(false);
  const payload = _sanitizeDbViewConfigForBackend(cfg);
  const key = String(dbPath || '');
  const writeBlocked = () => MeldexSheetViewConfigEnvironment?.isWriteBlocked?.(dbPath, options.ctx) === true;
  if (writeBlocked()) return Promise.resolve(false);
  const previousState = _dbViewConfigBackendSavePayloads.get(key);
  if (previousState) {
    previousState.superseded = true;
    if (previousState.timer) clearTimeout(previousState.timer);
    _dbViewConfigBackendSaveTimers.delete(key);
    _dbViewConfigBackendSaveRunners.delete(key);
  }
  const state = {
    key,
    path: String(dbPath),
    payload,
    ctx: options.ctx,
    revision: ++_dbViewConfigBackendSaveRevision,
    superseded: false,
    timer: null,
    promise: null,
  };
  _dbViewConfigBackendSavePayloads.set(key, state);
  const run = (prerequisite) => {
    if (state.promise) return state.promise;
    const previous = prerequisite || _dbViewConfigBackendSavePromises.get(key);
    const promise = Promise.resolve(previous).catch(() => {}).then(() => (
      state.superseded || MeldexSheetViewConfigEnvironment?.isWriteBlocked?.(state.path, state.ctx) === true
        ? false
        : MeldexSheetViewConfigEnvironment.put(
          '/db-metadata?path=' + encodeURIComponent(state.path),
          { view_config: state.payload }
        )
        .then(() => true)
        .catch((error) => {
          console.warn('[Meldex] シート表示設定を保存できませんでした', error);
          return false;
        })
    ))
      .finally(() => {
        if (_dbViewConfigBackendSavePromises.get(key) === promise) {
          _dbViewConfigBackendSavePromises.delete(key);
        }
        if (_dbViewConfigBackendSavePayloads.get(key) === state) {
          _dbViewConfigBackendSavePayloads.delete(key);
        }
      });
    state.promise = promise;
    _dbViewConfigBackendSavePromises.set(key, promise);
    return promise;
  };
  _dbViewConfigBackendSaveRunners.set(key, run);
  if (options.immediate === true) {
    _dbViewConfigBackendSaveRunners.delete(key);
    return run();
  }
  const timer = setTimeout(() => {
    _dbViewConfigBackendSaveTimers.delete(key);
    const pendingRun = _dbViewConfigBackendSaveRunners.get(key);
    _dbViewConfigBackendSaveRunners.delete(key);
    (pendingRun || run)();
  }, 180);
  state.timer = timer;
  _dbViewConfigBackendSaveTimers.set(key, timer);
  return Promise.resolve(true);
}
// 「保存中」判定: デバウンスタイマー待ち・実行中の保存関数・送信済みでレスポンス待ちの
// Promise のいずれかが残っていれば true を返す。タイマーだけを見ると、タイマー発火後
// PUT 応答待ちの間に GET で取得した古いバックエンド値へ上書きされてしまう
// （メインパネルのサイズ変更等で再読込が走った際に列幅が巻き戻る事故の原因）。
// _dbViewConfigBackendSavePayloads は保存要求の受付時に set され、PUT 完了（成功/失敗
// いずれも）まで残るため、この3マップのいずれかに残っていれば「保存が終わっていない」
// ことを網羅的に表せる。
function _hasPendingDbViewConfigBackendSave(dbPath) {
  const key = String(dbPath || '');
  return _dbViewConfigBackendSaveTimers.has(key)
    || _dbViewConfigBackendSavePayloads.has(key)
    || _dbViewConfigBackendSavePromises.has(key);
}
async function flushPendingDbViewConfigBackendSave(dbPath) {
  const key = String(dbPath || '');
  const state = _dbViewConfigBackendSavePayloads.get(key);
  const timer = state?.timer || _dbViewConfigBackendSaveTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    _dbViewConfigBackendSaveTimers.delete(key);
    const run = _dbViewConfigBackendSaveRunners.get(key);
    _dbViewConfigBackendSaveRunners.delete(key);
    if (run) await run();
  }
  const inFlight = state?.promise || _dbViewConfigBackendSavePromises.get(key);
  if (inFlight) await Promise.resolve(inFlight).catch(() => {});
  return true;
}
function _mapPendingDbViewConfigPath(path, oldPath, newPath, isFolder) {
  const current = String(path || '');
  const source = String(oldPath || '');
  const target = String(newPath || '');
  if (!current || !source || !target) return current;
  if (current === source) return target;
  if (isFolder !== false) {
    const slashPrefix = source + '/';
    const backslashPrefix = source + '\\';
    if (current.startsWith(slashPrefix) || current.startsWith(backslashPrefix)) {
      return target + current.slice(source.length);
    }
  }
  return current;
}
async function rebindPendingDbViewConfigBackendSave(oldPath, newPath, options = {}) {
  const source = String(oldPath || '');
  const target = String(newPath || '');
  if (!source || !target || source === target) return true;
  const pendingPaths = [..._dbViewConfigBackendSavePayloads.keys()]
    .filter(path => _mapPendingDbViewConfigPath(path, source, target, options.isFolder) !== path);
  const saves = pendingPaths.map(async (path) => {
    const pending = _dbViewConfigBackendSavePayloads.get(path);
    const mappedPath = _mapPendingDbViewConfigPath(path, source, target, options.isFolder);
    if (!pending || !mappedPath) return false;
    const timer = pending.timer || _dbViewConfigBackendSaveTimers.get(path);
    if (timer) clearTimeout(timer);
    pending.superseded = true;
    _dbViewConfigBackendSaveTimers.delete(path);
    _dbViewConfigBackendSaveRunners.delete(path);
    if (_dbViewConfigBackendSavePayloads.get(path) === pending) {
      _dbViewConfigBackendSavePayloads.delete(path);
    }
    const mappedKey = String(mappedPath);
    const targetState = _dbViewConfigBackendSavePayloads.get(mappedKey);
    if (targetState && targetState.revision > pending.revision) return true;
    const oldInFlight = pending.promise || _dbViewConfigBackendSavePromises.get(path);
    const targetInFlight = targetState?.promise || _dbViewConfigBackendSavePromises.get(mappedKey);
    if (targetState) {
      targetState.superseded = true;
      if (targetState.timer) clearTimeout(targetState.timer);
      _dbViewConfigBackendSaveTimers.delete(mappedKey);
      _dbViewConfigBackendSaveRunners.delete(mappedKey);
    }
    const rebound = {
      key: mappedKey,
      path: mappedPath,
      payload: pending.payload,
      ctx: pending.ctx,
      revision: pending.revision,
      superseded: false,
      timer: null,
      promise: null,
    };
    _dbViewConfigBackendSavePayloads.set(mappedKey, rebound);
    const prerequisite = Promise.all([
      Promise.resolve(oldInFlight).catch(() => {}),
      Promise.resolve(targetInFlight).catch(() => {}),
    ]);
    const promise = prerequisite.then(() => {
      const latest = _dbViewConfigBackendSavePayloads.get(mappedKey);
      if (rebound.superseded || (latest && latest.revision > rebound.revision)) return false;
      if (MeldexSheetViewConfigEnvironment?.isWriteBlocked?.(mappedPath, rebound.ctx) === true) return false;
      return MeldexSheetViewConfigEnvironment.put(
        '/db-metadata?path=' + encodeURIComponent(mappedPath),
        { view_config: rebound.payload }
      ).then(() => true).catch((error) => {
        console.warn('[Meldex] シート表示設定を保存できませんでした', error);
        return false;
      });
    }).finally(() => {
      if (_dbViewConfigBackendSavePromises.get(mappedKey) === promise) {
        _dbViewConfigBackendSavePromises.delete(mappedKey);
      }
      if (_dbViewConfigBackendSavePayloads.get(mappedKey) === rebound) {
        _dbViewConfigBackendSavePayloads.delete(mappedKey);
      }
    });
    rebound.promise = promise;
    _dbViewConfigBackendSavePromises.set(mappedKey, promise);
    return promise;
  });
  await Promise.all(saves);
  return true;
}
if (typeof window !== 'undefined' && !window.__MeldexSheetViewConfigPathMutationHook) {
  window.__MeldexSheetViewConfigPathMutationHook = async (event) => {
    if (!event?.oldPath || !event?.newPath || !['rename', 'move', 'restore'].includes(event.action)) return;
    await rebindPendingDbViewConfigBackendSave(event.oldPath, event.newPath, {
      isFolder: event.isFolder !== false,
    });
  };
  window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];
  window.__MeldexPwaPathMutationHooks.push(window.__MeldexSheetViewConfigPathMutationHook);
}
function getDbViewConfig(dbPath) {
  const fileId = MeldexSheetViewConfigEnvironment.fileId(dbPath);
  let cfg = {};
  if (fileId) {
    try { const v = localStorage.getItem('dbViewConfig:' + fileId); if (v) cfg = JSON.parse(v) || {}; } catch { cfg = {}; }
  }
  if (!fileId || Object.keys(cfg).length === 0) {
    try {
      const v = localStorage.getItem('dbViewConfig:' + (dbPath || ''));
      if (v) cfg = JSON.parse(v) || {};
    } catch {}
  }
  const migrated = _migrateLegacyViewConfig(dbPath, cfg);
  const productionRepaired = typeof repairProductionManagementDbViewConfig === 'function'
    && repairProductionManagementDbViewConfig(dbPath, migrated.cfg);
  if (migrated.changed || productionRepaired) _persistMigratedDbViewConfig(dbPath, migrated.cfg);
  return migrated.cfg;
}
function _dbViewConfigHistoryScope(dbPath) {
  const fileId = MeldexSheetViewConfigEnvironment.fileId(dbPath);
  if (fileId) return 'db:' + fileId;
  if (dbPath) return 'db:' + String(dbPath).replace(/\\/g, '/');
  return (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
}
function _refreshDbViewConfigAfterHistory(dbPath) {
  if (!dbPath) return;
  // state.currentDbPath だけで判定すると、取り消し直前に対象タブへ切り替えた
  // 直後（そのタブ自身の再読み込みがまだ state に追いついていないタイミング）に
  // 「表示中でない」と誤判定して黙って何もしない事故が起きる（v0.7.056）。
  // GBLayout上で実際にそのタブがアクティブかどうかも併せて確認する。
  const isCurrentlyShown = state.currentDbPath === dbPath
    || (typeof _dbFindActiveTabPaneForPath === 'function' && !!_dbFindActiveTabPaneForPath(dbPath));
  if (!isCurrentlyShown) return;
  const ctx = typeof _currentPaneState === 'function' ? _currentPaneState() : undefined;
  if (typeof selectDatabase === 'function') {
    Promise.resolve(selectDatabase(dbPath, ctx, {
      silent: true,
      skipRecent: true,
      skipNavPush: true,
      skipSaveLastView: true,
      skipAutoVersion: true,
    })).catch(() => {});
  } else if (typeof renderPivot === 'function') {
    renderPivot(ctx);
  }
}
function captureDbViewConfigHistory(dbPath) {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return null;
  return captureLocalStorageSettings([getDbViewConfigStorageKey(dbPath)]);
}
function pushDbViewConfigHistory(dbPath, label, beforeSnapshot, afterSnapshot, detail, onRestore) {
  if (!beforeSnapshot || !afterSnapshot || typeof historyPush !== 'function'
    || typeof restoreLocalStorageSettings !== 'function'
    || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return false;
  const snapshots = _normalizeLocalStorageSettingsSnapshots(beforeSnapshot, afterSnapshot);
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(snapshots.before);
    afterKey = JSON.stringify(snapshots.after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  const refresh = typeof onRestore === 'function'
    ? onRestore
    : () => _refreshDbViewConfigAfterHistory(dbPath);
  const restoreViewConfigSnapshot = (snapshot) => {
    const restored = restoreLocalStorageSettings(snapshot);
    if (!restored) return false;
    const finish = () => refresh(snapshot.keys || [], snapshot);
    if (typeof _persistDbViewConfigToBackend === 'function') {
      return _persistDbViewConfigToBackend(dbPath, getDbViewConfig(dbPath), { immediate: true })
        .finally(finish);
    }
    return finish();
  };
  historyPush(
    label || 'シート表示設定',
    () => restoreViewConfigSnapshot(snapshots.before),
    () => restoreViewConfigSnapshot(snapshots.after),
    _dbViewConfigHistoryScope(dbPath),
    detail || ''
  );
  return true;
}
function withDbViewConfigHistory(dbPath, label, mutator, detail, onRestore) {
  const before = captureDbViewConfigHistory(dbPath);
  const result = typeof mutator === 'function' ? mutator() : undefined;
  const after = captureDbViewConfigHistory(dbPath);
  pushDbViewConfigHistory(dbPath, label, before, after, detail, onRestore);
  return result;
}
function saveDbViewConfig(dbPath, cfg, options = {}) {
  const key = getDbViewConfigStorageKey(dbPath);
  const label = options.historyLabel || options.label || '';
  const before = (label && options.skipHistory !== true) ? captureDbViewConfigHistory(dbPath) : null;
  localStorage.setItem(key, JSON.stringify(cfg || {}));
  if (options.skipBackend !== true) {
    _persistDbViewConfigToBackend(dbPath, cfg || {}, { immediate: options.flushBackend === true, ctx: options.ctx });
  }
  if (label && options.skipHistory !== true) {
    pushDbViewConfigHistory(
      dbPath,
      label,
      before,
      captureDbViewConfigHistory(dbPath),
      options.historyDetail || options.detail || '',
      options.onRestore
    );
  }
}
function _getCurrentDbViewIndexFromConfig(cfg, options = {}) {
  const views = Array.isArray(cfg?.savedViews) ? cfg.savedViews : [];
  if (views.length === 0) return -1;
  const ctxIdx = Number.isInteger(options?.ctx?.currentViewIdx) ? options.ctx.currentViewIdx : null;
  const optIdx = Number.isInteger(options?.currentViewIdx) ? options.currentViewIdx : null;
  const rawIdx = ctxIdx != null ? ctxIdx : (optIdx != null ? optIdx : (Number.isInteger(cfg.currentViewIdx) ? cfg.currentViewIdx : 0));
  return rawIdx >= 0 && rawIdx < views.length ? rawIdx : 0;
}
function _getCurrentDbViewConfigEntryFromConfig(cfg, options = {}) {
  const views = Array.isArray(cfg?.savedViews) ? cfg.savedViews : [];
  const idx = _getCurrentDbViewIndexFromConfig(cfg, options);
  if (idx < 0) return null;
  return views[idx] || null;
}
function getCurrentDbViewConfigEntry(dbPath, options = {}) {
  return _getCurrentDbViewConfigEntryFromConfig(getDbViewConfig(dbPath), options);
}
function getCurrentViewMode(dbPath, options = {}) {
  return getCurrentDbViewConfigEntry(dbPath, options)?.viewMode || 'pivot';
}
function getCurrentDbViewTypeSpecific(dbPath, type, options = {}) {
  const bucket = getCurrentDbViewConfigEntry(dbPath, options)?.typeSpecific?.[type];
  return _isDbViewPlainObject(bucket) ? bucket : null;
}
function _saveCurrentDbViewField(dbPath, label, detail, options, mutator) {
  const c = getDbViewConfig(dbPath);
  const v = _getCurrentDbViewConfigEntryFromConfig(c, options);
  if (!v || typeof mutator !== 'function') return false;
  mutator(v, c);
  saveDbViewConfig(dbPath, c, {
    historyLabel: label || '',
    historyDetail: detail || '',
    skipHistory: options?.skipHistory === true || !label,
    ctx: options?.ctx,
  });
  return true;
}
function setCurrentDbViewTypeSpecific(dbPath, type, value, options = {}) {
  const label = options.historyLabel || options.label || '';
  return _saveCurrentDbViewField(dbPath, label, options.detail || '', options, (v) => {
    if (!_isDbViewPlainObject(v.typeSpecific)) v.typeSpecific = {};
    v.typeSpecific[type] = _isDbViewPlainObject(value) ? value : {};
  });
}
// 非表示カラム
function getHiddenCols(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.hiddenCols || []; }
function setHiddenCols(dbPath, cols, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 表示列', options.detail || '', options, (v) => { v.hiddenCols = cols; });
}
// ピン留めカラム
function getPinnedCols(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.pinnedCols || []; }
function setPinnedCols(dbPath, cols, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 固定列', options.detail || '', options, (v) => { v.pinnedCols = cols; });
}
// 固定列は表示順の左端から終端列までを常に連続範囲として扱う。
// 旧版で保存された飛び飛びの pinnedCols も、最も右にある固定列を終端として読み替える。
function getPinnedColumnRangeState(renderedCols, pinnedCols, entityColumnPinned) {
  const order = [...new Set((Array.isArray(renderedCols) ? renderedCols : []).filter(Boolean))];
  const pinned = new Set(Array.isArray(pinnedCols) ? pinnedCols : []);
  let boundaryIndex = -1;
  order.forEach((token, index) => {
    if ((token === '__entity__' && entityColumnPinned !== false) || (token !== '__entity__' && pinned.has(token))) {
      boundaryIndex = index;
    }
  });
  const pinnedTokens = boundaryIndex >= 0 ? order.slice(0, boundaryIndex + 1) : [];
  return {
    boundaryIndex,
    pinnedTokens,
    pinnedCols: pinnedTokens.filter(token => token !== '__entity__'),
    entityColumnPinned: pinnedTokens.includes('__entity__'),
  };
}
function setPinnedColumnRange(dbPath, renderedCols, boundaryToken, on, options = {}) {
  const order = [...new Set((Array.isArray(renderedCols) ? renderedCols : []).filter(Boolean))];
  const targetIndex = order.indexOf(boundaryToken);
  if (targetIndex < 0) return false;
  const view = getCurrentDbViewConfigEntry(dbPath, options);
  const current = getPinnedColumnRangeState(
    order,
    view?.pinnedCols || [],
    view ? view.entityColumnPinned !== false : true,
  );
  const boundaryIndex = on !== false
    ? Math.max(current.boundaryIndex, targetIndex)
    : Math.min(current.boundaryIndex, targetIndex - 1);
  const pinnedTokens = boundaryIndex >= 0 ? order.slice(0, boundaryIndex + 1) : [];
  return _saveCurrentDbViewField(
    dbPath,
    options.label || 'シート表示: 固定列',
    options.detail || (on !== false ? '固定' : '解除'),
    options,
    (v) => {
      v.pinnedCols = pinnedTokens.filter(token => token !== '__entity__');
      v.entityColumnPinned = pinnedTokens.includes('__entity__');
    },
  );
}
// カウントタイプ
function getCountTypes(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.countTypes || {}; }
function setCountType(dbPath, prop, type, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 集計タイプ', options.detail || prop || '', options, (v) => {
    if (!v.countTypes || typeof v.countTypes !== 'object' || Array.isArray(v.countTypes)) v.countTypes = {};
    v.countTypes[prop] = type;
  });
}
// カラム幅
function getColWidths(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.colWidths || {}; }
function setColWidthPersist(dbPath, prop, w, options = {}) {
  const label = options.historyLabel || options.label || '';
  _saveCurrentDbViewField(dbPath, label, options.detail || prop || '', options, (v) => {
    if (!v.colWidths || typeof v.colWidths !== 'object' || Array.isArray(v.colWidths)) v.colWidths = {};
    v.colWidths[prop] = w;
  });
}
// 条件付き書式ON/OFF
function getConditionalFormat(dbPath, options = {}) { return !!getCurrentDbViewConfigEntry(dbPath, options)?.conditionalFormat; }
function setConditionalFormat(dbPath, on, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 条件付き書式', options.detail || (on ? '有効' : '無効'), options, (v) => { v.conditionalFormat = !!on; });
}
// 集計行
function getShowFooter(dbPath, options = {}) { return !!getCurrentDbViewConfigEntry(dbPath, options)?.showFooter; }
function setShowFooter(dbPath, on, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 集計行', options.detail || (on ? '表示' : '非表示'), options, (v) => { v.showFooter = !!on; });
}
// エントリ名列固定
function getEntityColumnPinned(dbPath, options = {}) {
  const view = getCurrentDbViewConfigEntry(dbPath, options);
  return view ? view.entityColumnPinned !== false : true;
}
function setEntityColumnPinned(dbPath, on, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: エントリ名列固定', options.detail || (on ? '固定' : '解除'), options, (v) => { v.entityColumnPinned = on !== false; });
}
// エントリ名列の表示名（未設定ならパス由来の既定名を使う）
function getEntityColumnLabel(dbPath, options = {}) {
  const view = getCurrentDbViewConfigEntry(dbPath, options);
  return view && typeof view.entityColumnLabel === 'string' ? view.entityColumnLabel.trim() : '';
}
function setEntityColumnLabel(dbPath, label, options = {}) {
  const clean = String(label == null ? '' : label).trim();
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: エントリ名列名', options.detail || clean, options, (v) => {
    if (clean) v.entityColumnLabel = clean; else delete v.entityColumnLabel;
  });
}
// ステータス機能ON/OFF（既定OFF。OFF時は候補値追加・ステータスドット・一括編集ステータスを非表示）
function getStatusEnabled(dbPath) { return getDbViewConfig(dbPath).statusEnabled === true; }
function setStatusEnabled(dbPath, on, options = {}) {
  const c = getDbViewConfig(dbPath);
  c.statusEnabled = !!on;
  saveDbViewConfig(dbPath, c, { historyLabel: options.label || 'シート表示: ステータス機能', historyDetail: options.detail || (on ? 'オン' : 'オフ'), skipHistory: options.skipHistory === true });
}
// サムネサイズ
function getThumbnailSize(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.thumbnailSize || 'small'; }
function setThumbnailSize(dbPath, size, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: サムネイル', options.detail || size || '', options, (v) => { v.thumbnailSize = size; });
}
// カラム順序
function getColOrder(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.colOrder || null; }
function setColOrder(dbPath, order, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 列順序', options.detail || '', options, (v) => { v.colOrder = order; });
}
// 並び替え
function getDbSortConfig(dbPath, options = {}) {
  const sc = getCurrentDbViewConfigEntry(dbPath, options)?.sortConfig;
  return sc && typeof sc === 'object' && sc.key ? sc : null;
}
function setDbSortConfig(dbPath, sortConfig, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 並び替え', options.detail || '', options, (v) => {
    if (sortConfig == null) delete v.sortConfig;
    else v.sortConfig = _cloneDbViewValue(sortConfig, null);
  });
}
// マニュアル行順序
function getDbManualOrder(dbPath, options = {}) {
  const order = getCurrentDbViewConfigEntry(dbPath, options)?.manualOrder;
  return Array.isArray(order) ? order : null;
}
function setDbManualOrder(dbPath, order, sortConfig, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || '', options.detail || '', options, (v) => {
    if (Array.isArray(order)) v.manualOrder = [...order];
    else delete v.manualOrder;
    if (sortConfig !== undefined) {
      if (sortConfig == null) delete v.sortConfig;
      else v.sortConfig = _cloneDbViewValue(sortConfig, null);
    }
  });
}
// 複数条件フィルタ
function getAdvancedFilters(dbPath, options = {}) { return getCurrentDbViewConfigEntry(dbPath, options)?.advancedFilters || []; }
function setAdvancedFilters(dbPath, filters, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 複数条件フィルタ', options.detail || '', options, (v) => { v.advancedFilters = filters; });
}
// 列ヘッダーメニューの値チェックフィルター（列ごとの選択値を保存）
function getColumnValueFilters(dbPath, options = {}) {
  const filters = getCurrentDbViewConfigEntry(dbPath, options)?.columnValueFilters;
  return filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {};
}
function setColumnValueFilters(dbPath, filters, options = {}) {
  return _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 列の値フィルター', options.detail || '', options, (v) => {
    v.columnValueFilters = _cloneDbViewObject(filters);
  });
}

// ステータスフィルタ・条件フィルタ・列の値フィルターをまとめて1回の保存操作で原子的に
// 永続化する。個別セッターを続けて呼ぶと、保存の都度 localStorage 書込み＋バックエンド
// デバウンス予約＋Undo/Redo 履歴が別々に積まれてしまう（ステータスフィルタは skipHistory
// 固定のため単独では Undo 対象外にもなる）。フィルタダイアログの「適用」「全解除」等、
// 複数種のフィルタを同時に変更する操作はこの関数を使うこと。
// fields に含めなかったキーは変更しない（部分更新可）。
function setDbFilterState(dbPath, fields = {}, options = {}) {
  const label = options.label || 'シート表示: フィルタ';
  return _saveCurrentDbViewField(dbPath, label, options.detail || '', options, (v) => {
    if (Object.prototype.hasOwnProperty.call(fields, 'filter')) {
      v.filter = fields.filter || 'disabled';
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'advancedFilters')) {
      v.advancedFilters = Array.isArray(fields.advancedFilters) ? fields.advancedFilters : [];
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'columnValueFilters')) {
      v.columnValueFilters = _cloneDbViewObject(fields.columnValueFilters);
    }
  });
}

// セル表示（値の最大行数・折返し/切り詰め・画像サムネ数）: 保存ビューごとに保持する。
// 旧データはルート（DB全体）設定にのみ cellTextOverflow/cellWrapLines を持つため、
// ビュー側に未設定なら読み込み時にルート値へフォールバックする（破壊的移行はしない）。
function _dbCellDisplaySettingsSource(dbPath, ctx) {
  const cfg = getDbViewConfig(dbPath);
  const view = typeof getCurrentDbViewConfigEntry === 'function' ? getCurrentDbViewConfigEntry(dbPath, { ctx }) : null;
  return { cfg, view };
}
function getCellImageThumbCount(dbPath, options = {}) {
  const { cfg, view } = _dbCellDisplaySettingsSource(dbPath, options.ctx);
  const raw = view && Object.prototype.hasOwnProperty.call(view, 'cellImageThumbCount')
    ? view.cellImageThumbCount
    : cfg.cellImageThumbCount;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) ? Math.max(1, Math.min(12, n)) : 3;
}
function setCellImageThumbCount(dbPath, count, options = {}) {
  if (!dbPath) return;
  const n = Math.round(Number(count));
  const clamped = Number.isFinite(n) ? Math.max(1, Math.min(12, n)) : 3;
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: セル表示', options.detail || `画像サムネ${clamped}件`, options, (v) => {
    v.cellImageThumbCount = clamped;
  });
  return clamped;
}

const _DEFAULT_STATUS_LIST = [
  { name: '案',     color: '#ce9178' },
  { name: '採用',   color: '#6fa8dc' },
  { name: 'ボツ',   color: '#969696' },
  { name: '掲載済み', color: '#6a9955' },
];
// DB単位のカスタムステータス取得
function getStatusList(dbPath) {
  if (dbPath) {
    const cfg = getDbViewConfig(dbPath);
    if (cfg.statusList && cfg.statusList.length > 0) return cfg.statusList;
  }
  return _DEFAULT_STATUS_LIST;
}
function setStatusList(dbPath, list) {
  const cfg = getDbViewConfig(dbPath);
  cfg.statusList = list;
  saveDbViewConfig(dbPath, cfg, { historyLabel: 'シート表示: ステータス一覧' });
}
function _getStatusColor(statusName, dbPath) {
  const list = getStatusList(dbPath);
  const found = list.find(s => s.name === statusName);
  if (found) return found.color;
  // 後方互換フォールバック
  if (STATUS_MAP[statusName]) return STATUS_MAP[statusName].color;
  return list.length > 0 ? list[0].color : '#ce9178';
}
// 後方互換: 旧コードが STATUS_MAP/STATUS_LIST を参照する場合のフォールバック
const STATUS_MAP = {
  '掲載済み': { cls: 'st-published', color: '#6a9955' },
  '採用':     { cls: 'st-adopted',   color: '#6fa8dc' },
  '案':       { cls: 'st-draft',     color: '#ce9178' },
  'ボツ':     { cls: 'st-rejected',  color: '#969696' },
};
const STATUS_LIST = ['案', '採用', 'ボツ', '掲載済み'];
