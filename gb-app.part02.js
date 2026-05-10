  addMI('タブを閉じる', () => closeTab(tab.id));
  addMI('他のタブをすべて閉じる', () => {
    _tabs.splice(0, _tabs.length, tab);
    activateTab(tab.id);
  });
  document.body.appendChild(menu);
  clampPopupToViewport(menu);
  setTimeout(() => {
    document.addEventListener('pointerdown', function cl(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', cl); } });
  }, 0);
}
{
  const _tabBar = document.getElementById('tab-bar');
  _tabBar?.addEventListener('contextmenu', _handleTabBarContextmenu);
  if (_tabBar && typeof addLongPressHandler === 'function') {
    addLongPressHandler(_tabBar, _handleTabBarContextmenu);
  }
}

// Chrome --appモードで新しいウィンドウを開く（JS版）
async function _open_app_window_js(url) {
  const resolvedUrl = new URL(url, location.origin).toString();
  try {
    const res = await fetch(API_BASE + '/open-app-window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: resolvedUrl }),
    });
    if (res.ok) return true;
  } catch {}
  window.open(resolvedUrl, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
  return false;
}

// 既存のopen関数をフックしてタブを追加（再帰防止付き）
let _addingTab = false;
const _origNavPush = navPush;
navPush = function(entry, paneId) {
  _origNavPush(entry, paneId);
  if (_addingTab || navNavigating) return; // activateTab→navOpen→openX→navPush の再帰を防止
  if (entry && entry.type) {
    const label = entry.label || entry.path?.split('/').pop() || '(無題)';
    if (entry.type === 'welcome') return;
    _addingTab = true;
    // タブを追加（既存ならアクティブ化のみ、navOpenは呼ばない）
    const path = entry.path || entry.dbPath || '';
    const type = entry.type;
    const existing = _tabs.find(t => t.path === path && t.type === type);
    if (existing) {
      _activeTabId = existing.id;
      renderTabs();
    } else {
      // 現在のアクティブタブを上書き（新しいタブを追加しない）
      const activeTab = _tabs.find(t => t.id === _activeTabId);
      if (activeTab) {
        activeTab.label = label || '(無題)';
        activeTab.type = type;
        activeTab.path = path;
        activeTab.icon = _tabIcon(type);
        renderTabs();
      } else {
        const id = 'tab-' + (++_tabIdCounter);
        _tabs.push({ id, label: label || '(無題)', type, path, icon: _tabIcon(type) });
        _activeTabId = id;
        renderTabs();
      }
    }
    _addingTab = false;
  }
};

// ナビゲーション履歴の戻る/進む
function navBack(paneId) {
  const navState = _getNavState(paneId);
  if (navState.index <= 0) return false;
  navState.index -= 1;
  const entry = navState.history[navState.index];
  if (!entry) return false;
  if (navState.paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(navState.paneId, { sync: true });
  navNavigating = true;
  _withNavFlag(navOpen(entry));
  if (navState.kind === 'legacy') {
    const tab = _tabs.find(t => t.path === entry.path && t.type === entry.type);
    if (tab) { _activeTabId = tab.id; renderTabs(); }
  }
  _refreshPaneNavUi(navState.paneId);
  _persistPaneNavState(navState);
  return true;
}
function navForward(paneId) {
  const navState = _getNavState(paneId);
  if (navState.index < 0 || navState.index >= navState.history.length - 1) return false;
  navState.index += 1;
  const entry = navState.history[navState.index];
  if (!entry) return false;
  if (navState.paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(navState.paneId, { sync: true });
  navNavigating = true;
  _withNavFlag(navOpen(entry));
  if (navState.kind === 'legacy') {
    const tab = _tabs.find(t => t.path === entry.path && t.type === entry.type);
    if (tab) { _activeTabId = tab.id; renderTabs(); }
  }
  _refreshPaneNavUi(navState.paneId);
  _persistPaneNavState(navState);
  return true;
}

function showPaneNavHistoryDropdown(e, paneId, direction) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.nav-history-dropdown').forEach(el => el.remove());
  const navState = _getNavState(paneId);
  const items = [];
  if (direction === 'back') {
    for (let i = navState.index - 1; i >= Math.max(0, navState.index - 15); i--) items.push({ index: i, entry: navState.history[i] });
  } else {
    for (let i = navState.index + 1; i <= Math.min(navState.history.length - 1, navState.index + 15); i++) items.push({ index: i, entry: navState.history[i] });
  }
  if (items.length === 0) return;

  const dd = document.createElement('div');
  dd.className = 'ab-dropdown nav-history-dropdown';
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:220px;max-width:360px;max-height:400px;overflow-y:auto;';
  items.forEach(({ index, entry }) => {
    const item = document.createElement('div');
    item.className = 'ab-dropdown-item';
    item.textContent = entry.label || entry.path?.split('/').pop() || '(不明)';
    item.title = entry.path || '';
    item.addEventListener('click', () => {
      navState.index = index;
      if (navState.paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(navState.paneId, { sync: true });
      navNavigating = true;
      _withNavFlag(navOpen(entry));
      _refreshPaneNavUi(navState.paneId);
      _persistPaneNavState(navState);
      dd.remove();
    });
    dd.appendChild(item);
  });
  const anchor = e.currentTarget || e.target?.closest?.('button') || e.target;
  const rect = anchor.getBoundingClientRect();
  { const z = _getZoom(); dd.style.left = (rect.left / z) + 'px'; dd.style.top = (rect.bottom / z + 2) + 'px'; }
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  setTimeout(() => {
    const close = (ev) => { if (!dd.contains(ev.target)) { dd.remove(); document.removeEventListener('pointerdown', close, true); } };
    document.addEventListener('pointerdown', close, true);
  }, 0);
}

function showNavHistoryDropdown(e, direction) {
  return showPaneNavHistoryDropdown(e, null, direction);
}

function updateNavBreadcrumb() {}

let _pointerNavPaneId = null;

function _handlePointerNavigationButtons(e) {
  if (e.button !== 3 && e.button !== 4) return;
  const ae = document.activeElement;
  if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
  const paneId = _pointerNavPaneId || e.target?.closest?.('.gb-pane')?.dataset?.paneId || undefined;
  _pointerNavPaneId = null;
  if (e.button === 3) {
    if (navBack(paneId)) e.preventDefault();
  } else if (e.button === 4) {
    if (navForward(paneId)) e.preventDefault();
  }
}

window.addEventListener('mousedown', (e) => {
  if (e.button === 3 || e.button === 4) {
    _pointerNavPaneId = e.target?.closest?.('.gb-pane')?.dataset?.paneId || null;
    e.preventDefault();
  }
}, true);
window.addEventListener('mouseup', _handlePointerNavigationButtons, true);
window.addEventListener('pointercancel', () => { _pointerNavPaneId = null; }, true);

// DB表示設定（DBパスごとにlocalStorageで永続化）
function getDbViewConfigStorageKey(dbPath) {
  const fileId = _pathToFileId(dbPath);
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
function _normalizeDbViewModeValue(mode) {
  const value = String(mode || '').trim();
  return ['pivot', 'gallery', 'kanban', 'calendar', 'timeline', 'chart', 'graph', 'form'].includes(value)
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
    ...src,
  };
  out.colWidths = _cloneDbViewObject(src.colWidths);
  out.rowHeights = _cloneDbViewObject(src.rowHeights);
  out.cardProps = _cloneDbViewArray(src.cardProps);
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
  const hasArray = (value) => Array.isArray(value) && value.length > 0;
  const hasObject = (value) => _isDbViewPlainObject(value) && Object.keys(value).length > 0;
  return hasArray(cfg.hiddenCols)
    || hasArray(cfg.pinnedCols)
    || hasArray(cfg.colOrder)
    || hasArray(cfg.advancedFilters)
    || hasObject(cfg.conditionalColors)
    || hasObject(cfg.countTypes)
    || hasObject(cfg.colWidths)
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
function getDbViewConfig(dbPath) {
  const fileId = _pathToFileId(dbPath);
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
  if (migrated.changed) _persistMigratedDbViewConfig(dbPath, migrated.cfg);
  return migrated.cfg;
}
function _dbViewConfigHistoryScope(dbPath) {
  const leaf = dbPath ? String(dbPath).split('/').pop() : '';
  if (leaf) return 'db:' + leaf;
  return (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
}
function _refreshDbViewConfigAfterHistory(dbPath) {
  if (!dbPath || state.currentDbPath !== dbPath) return;
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
  historyPush(
    label || 'シート表示設定',
    () => restoreLocalStorageSettings(snapshots.before, refresh),
    () => restoreLocalStorageSettings(snapshots.after, refresh),
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
function _getCurrentDbViewConfigEntryFromConfig(cfg) {
  const views = Array.isArray(cfg?.savedViews) ? cfg.savedViews : [];
  if (views.length === 0) return null;
  const rawIdx = Number.isInteger(cfg.currentViewIdx) ? cfg.currentViewIdx : 0;
  const idx = rawIdx >= 0 && rawIdx < views.length ? rawIdx : 0;
  return views[idx] || null;
}
function getCurrentDbViewConfigEntry(dbPath) {
  return _getCurrentDbViewConfigEntryFromConfig(getDbViewConfig(dbPath));
}
function getCurrentViewMode(dbPath) {
  return getCurrentDbViewConfigEntry(dbPath)?.viewMode || 'pivot';
}
function getCurrentDbViewTypeSpecific(dbPath, type) {
  const bucket = getCurrentDbViewConfigEntry(dbPath)?.typeSpecific?.[type];
  return _isDbViewPlainObject(bucket) ? bucket : null;
}
function _saveCurrentDbViewField(dbPath, label, detail, options, mutator) {
  const c = getDbViewConfig(dbPath);
  const v = _getCurrentDbViewConfigEntryFromConfig(c);
  if (!v || typeof mutator !== 'function') return false;
  mutator(v, c);
  saveDbViewConfig(dbPath, c, {
    historyLabel: label || '',
    historyDetail: detail || '',
    skipHistory: options?.skipHistory === true || !label,
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
function getHiddenCols(dbPath) { return getCurrentDbViewConfigEntry(dbPath)?.hiddenCols || []; }
function setHiddenCols(dbPath, cols, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 表示列', options.detail || '', options, (v) => { v.hiddenCols = cols; });
}
// ピン留めカラム
function getPinnedCols(dbPath) { return getCurrentDbViewConfigEntry(dbPath)?.pinnedCols || []; }
function setPinnedCols(dbPath, cols, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 固定列', options.detail || '', options, (v) => { v.pinnedCols = cols; });
}
// カウントタイプ
function getCountTypes(dbPath) { return getCurrentDbViewConfigEntry(dbPath)?.countTypes || {}; }
function setCountType(dbPath, prop, type, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 集計タイプ', options.detail || prop || '', options, (v) => {
    if (!v.countTypes || typeof v.countTypes !== 'object' || Array.isArray(v.countTypes)) v.countTypes = {};
    v.countTypes[prop] = type;
  });
}
// カラム幅
function getColWidths(dbPath) { return getCurrentDbViewConfigEntry(dbPath)?.colWidths || {}; }
function setColWidthPersist(dbPath, prop, w, options = {}) {
  const label = options.historyLabel || options.label || '';
  _saveCurrentDbViewField(dbPath, label, options.detail || prop || '', options, (v) => {
    if (!v.colWidths || typeof v.colWidths !== 'object' || Array.isArray(v.colWidths)) v.colWidths = {};
    v.colWidths[prop] = w;
  });
}
// 条件付き書式ON/OFF
function getConditionalFormat(dbPath) { return !!getCurrentDbViewConfigEntry(dbPath)?.conditionalFormat; }
function setConditionalFormat(dbPath, on, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 条件付き書式', options.detail || (on ? '有効' : '無効'), options, (v) => { v.conditionalFormat = !!on; });
}
// 集計行
function getShowFooter(dbPath) { return !!getCurrentDbViewConfigEntry(dbPath)?.showFooter; }
function setShowFooter(dbPath, on, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 集計行', options.detail || (on ? '表示' : '非表示'), options, (v) => { v.showFooter = !!on; });
}
// エントリ名列固定
function getEntityColumnPinned(dbPath) {
  const view = getCurrentDbViewConfigEntry(dbPath);
  return view ? view.entityColumnPinned !== false : true;
}
function setEntityColumnPinned(dbPath, on, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: エントリ名列固定', options.detail || (on ? '固定' : '解除'), options, (v) => { v.entityColumnPinned = on !== false; });
}
// ステータス機能ON/OFF（既定OFF。OFF時は候補値追加・ステータスドット・一括編集ステータスを非表示）
function getStatusEnabled(dbPath) { return getDbViewConfig(dbPath).statusEnabled === true; }
function setStatusEnabled(dbPath, on, options = {}) {
  const c = getDbViewConfig(dbPath);
  c.statusEnabled = !!on;
  saveDbViewConfig(dbPath, c, { historyLabel: options.label || 'シート表示: ステータス機能', historyDetail: options.detail || (on ? 'オン' : 'オフ'), skipHistory: options.skipHistory === true });
}
// サムネサイズ
function getThumbnailSize(dbPath) { return getCurrentDbViewConfigEntry(dbPath)?.thumbnailSize || 'small'; }
function setThumbnailSize(dbPath, size, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: サムネイル', options.detail || size || '', options, (v) => { v.thumbnailSize = size; });
}
// カラム順序
function getColOrder(dbPath) { return getCurrentDbViewConfigEntry(dbPath)?.colOrder || null; }
function setColOrder(dbPath, order, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 列順序', options.detail || '', options, (v) => { v.colOrder = order; });
}
// 並び替え
function getDbSortConfig(dbPath) {
  const sc = getCurrentDbViewConfigEntry(dbPath)?.sortConfig;
  return sc && typeof sc === 'object' && sc.key ? sc : null;
}
function setDbSortConfig(dbPath, sortConfig, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 並び替え', options.detail || '', options, (v) => {
    if (sortConfig == null) delete v.sortConfig;
    else v.sortConfig = _cloneDbViewValue(sortConfig, null);
  });
}
// マニュアル行順序
function getDbManualOrder(dbPath) {
  const order = getCurrentDbViewConfigEntry(dbPath)?.manualOrder;
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
function getAdvancedFilters(dbPath) { return getCurrentDbViewConfigEntry(dbPath)?.advancedFilters || []; }
function setAdvancedFilters(dbPath, filters, options = {}) {
  _saveCurrentDbViewField(dbPath, options.label || 'シート表示: 複数条件フィルタ', options.detail || '', options, (v) => { v.advancedFilters = filters; });
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

// esc() は meldex-core.js で定義済み
function saveLastView(obj) {
  // 単一タブポップアウト窓では元ウィンドウの lastView を汚染しないよう常にスキップ
  if (window._skipLastViewSave || window._gbSingleWindow) return;
  // file_id を付与
  if (obj && obj.path && !obj.file_id) {
    const fid = _pathToFileId(obj.path);
    if (fid) obj.file_id = fid;
  }
  localStorage.setItem('lastView', JSON.stringify(obj));
}

function _isCloudPhase1UnsupportedOpenType(type) {
  return !!window.MeldexCloudBootstrap?.isPhase1UnsupportedType?.(type);
}

function _showCloudPhase1UnsupportedOpen(type) {
  if (window.MeldexCloudBootstrap?.showPhase1Unsupported) return window.MeldexCloudBootstrap.showPhase1Unsupported(type);
  showStatus('ブラウザ版Meldexではまだ未対応のビューです', true);
  return false;
}

function _pathTailLabel(path, fallback) {
  const raw = String(path || '').replace(/[\\/]+$/, '');
  if (!raw) return fallback || '';
  return raw.split(/[\\/]/).filter(Boolean).pop() || fallback || raw;
}

function _startupFolderCandidate(roots, homeRes, vault) {
  if (homeRes?.exists && homeRes.path) {
    try {
      if (typeof _homeFolderPath !== 'undefined') _homeFolderPath = homeRes.path;
    } catch (e) {}
    return { label: (typeof HOME_FOLDER_DISPLAY_LABEL !== 'undefined' ? HOME_FOLDER_DISPLAY_LABEL : 'ホームフォルダ'), path: homeRes.path };
  }
  const root = Array.isArray(roots)
    ? roots.find(r => r && r.path && r.visible !== false)
    : null;
  if (root) return { label: root.name || _pathTailLabel(root.path, 'フォルダ'), path: root.path };
  if (vault?.path) {
    return { label: vault.name || _pathTailLabel(vault.path, 'フォルダ'), path: vault.path };
  }
  return null;
}

function _isDesktopStartupLaunch() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('desktop') === '1' || document.documentElement?.dataset?.desktopLaunch === '1';
  } catch {
    return false;
  }
}

function _paneLayoutHasAnyTabs() {
  try {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function' || !GBLayout.root) return false;
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    return panes.some(p => Array.isArray(p?.tabs) && p.tabs.length > 0);
  } catch {
    return false;
  }
}

const STARTUP_LAYOUT_UTILITY_TAB_TYPES = new Set([
  'outliner',
  'detail',
  'preview',
  'chat',
  'calendar',
  'timer',
  'history',
  'annotation',
  'sticky',
  'search',
  'version',
]);

function _paneLayoutHasContentTabs() {
  try {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function' || !GBLayout.root) return false;
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    return panes.some(pane => {
      if (typeof GBLayout.isPaneVisible === 'function' && !GBLayout.isPaneVisible(pane?.id)) return false;
      return (pane?.tabs || []).some(tab => !STARTUP_LAYOUT_UTILITY_TAB_TYPES.has(tab?.type));
    });
  } catch {
    return false;
  }
}

function _paneLayoutRestoredFromStorage() {
  return !!(typeof GBLayout !== 'undefined' && GBLayout.layoutLoadedFromStorage && _paneLayoutHasContentTabs());
}

/* ==============================
   API呼び出し
   ============================== */
async function apiFetch(path, opts) {
  try {
    const res = await fetch(API_BASE + path, opts);
    if (!res.ok) {
      let detail = res.statusText || '';
      let payload = null;
      try {
        payload = await res.clone().json();
        const rawDetail = payload?.error || payload?.detail || detail;
        detail = rawDetail && typeof rawDetail === 'object'
          ? (rawDetail.message || rawDetail.code || detail)
          : rawDetail;
      } catch {}
      const error = new Error(`HTTP ${res.status}: ${detail}`);
      error.status = res.status;
      error.payload = payload;
      error.userMessage = window.MeldexErrorMessages?.toStatusText?.(error, { path }) || error.message;
      throw (window.MeldexSaveSafety?.enrichError?.(error, payload, res.status) || error);
    }
    const data = await res.json();
    window.MeldexSaveSafety?.reportApiSuccess?.(path, opts);
    return data;
  } catch (e) {
    if (!opts?.silentError) window.MeldexDiagnostics?.captureApiError?.(path, opts, e);
    if (!opts?.silentError && !window.MeldexSaveSafety?.reportApiError?.(path, opts, e)) {
      const text = window.MeldexErrorMessages?.toStatusText?.(e, { path }) || e.message;
      showStatus('エラー: ' + text, true);
    }
    throw e;
  }
}

async function apiPut(path, body) {
  return apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function apiPost(path, body, options = {}) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(options || {}),
  });
}

/* ==============================
   初期化
   ============================== */
// 認証トークン管理
// 旧認証変数（互換性のため残す — 他モジュールが参照）
let _authToken = '';
let _authUser = null;

function _apiLockJsonBody(opts) {
  const raw = opts?.body;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  if (raw && typeof raw === 'object' && !(raw instanceof FormData)) return raw;
  return {};
}

function _apiLockPathDir(path) {
  const text = String(path || '').replace(/\\/g, '/');
  const index = text.lastIndexOf('/');
  return index > 0 ? text.slice(0, index) : '';
}

function _apiLockAddPath(paths, value) {
  const text = String(value || '').trim();
  if (text) paths.push(text);
}

function _apiLockWriteCandidatePaths(path, opts) {
  const method = String(opts?.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return [];
  let url;
  try { url = new URL(String(path || ''), window.location.origin); } catch { return []; }
  const route = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  if (route === '/file-lock' || route.startsWith('/file-lock/')) return [];
  const body = _apiLockJsonBody(opts);
  const query = url.searchParams;
  const paths = [];
  const addQuery = (key) => _apiLockAddPath(paths, query.get(key));
  const addBody = (key) => _apiLockAddPath(paths, body?.[key]);
  const addBoth = (key) => { addQuery(key); addBody(key); };

  if (route === '/file' || route === '/value' || route === '/db-metadata' || route === '/replace') {
    addBoth('path');
  } else if (route === '/outliner/add') {
    addBody('parent');
  } else if (route === '/outliner/delete' || route === '/outliner/duplicate') {
    addBody('path');
  } else if (route === '/outliner/delete-batch') {
    (Array.isArray(body?.items) ? body.items : []).forEach(item => _apiLockAddPath(paths, item?.path));
  } else if (route === '/outliner/move') {
    addBody('path');
    addBody('dest_folder');
  } else if (route === '/outliner/rename') {
    addBody('old_path');
    const oldPath = String(body?.old_path || '');
    const newName = String(body?.new_name || '').trim();
    if (oldPath && newName) _apiLockAddPath(paths, (_apiLockPathDir(oldPath) ? _apiLockPathDir(oldPath) + '/' : '') + newName);
  } else if (route === '/entity/create') {
    addBody('parent_path');
  } else if (route === '/entity/rename') {
    addBody('path');
    const oldPath = String(body?.path || '');
    const newName = String(body?.new_name || '').trim();
    if (oldPath && newName) _apiLockAddPath(paths, (_apiLockPathDir(oldPath) ? _apiLockPathDir(oldPath) + '/' : '') + newName);
  } else if (route === '/annotations' || route === '/annotations/restore' || route === '/annotations/orphan-by-target') {
    addBody('target_path');
  } else if (route === '/import-csv') {
    addBody('csv_path');
    addBody('db_path');
  } else if (route.startsWith('/calendar-db/events') || route.startsWith('/calendar-db/sync') || route.startsWith('/calendar-db/ical') || route.startsWith('/calendar-db/caldav')) {
    addBoth('db_path');
  } else if (route === '/version/restore' || route === '/version/restore-db' || route === '/version/restore-folder' || route === '/version/delete-folder') {
    addBody('path');
  }

  return [...new Set(paths)];
}

function _apiLockBlockIfNeeded(path, opts) {
  if (typeof isItemLocked !== 'function') return false;
  const lockedPath = _apiLockWriteCandidatePaths(path, opts).find(p => {
    try { return isItemLocked(p); } catch { return false; }
  });
  if (!lockedPath) return false;
  const reason = typeof getItemLockReason === 'function' ? getItemLockReason(lockedPath) : '';
  const message = reason
    ? `編集ロック中のため編集できません（理由: ${reason}）`
    : '編集ロック中のため編集できません';
  if (typeof showStatus === 'function') showStatus(message, true);
  throw new Error(message);
}

// apiFetchをオーバーライドしてユーザー名を付加
const _origApiFetch = apiFetch;
apiFetch = async function(path, opts) {
  opts = opts || {};
  _apiLockBlockIfNeeded(path, opts);
  // _user パラメータを自動付与（監査ログ・modified_by 用）
  const user = getUsername();
  if (user && user !== 'anonymous') {
    const sep = path.includes('?') ? '&' : '?';
    path += sep + '_user=' + encodeURIComponent(user);
  }
  return _origApiFetch(path, opts);
};

// チームプロフィール同期（起動時に全ソースフォルダの _Meldex_team.json に自分を登録）
// フォルダ別ロールを保持（DB列ロック等で参照）
let _myTeamRole = 'editor';  // デフォルト（ソースフォルダ未設定時）
const _myTeamRoles = {};     // { folderPath: role }

async function _syncMyTeamProfile() {
  const name = getUsername();
  if (!name || name === 'anonymous') return;
  const avatar = localStorage.getItem('meldex-avatar') || '';
  // 全ソースフォルダに同期
  try {
    const roots = await apiFetch('/outliner-roots').catch(() => []);
    const visibleRoots = roots.filter(r => r.visible && r.path);
    if (visibleRoots.length === 0) {
      // ソースフォルダなし → デフォルトvaultに同期
      try {
        await apiPost('/team/sync', { name, avatar });
        const members = await apiFetch('/team');
        const me = members.find(m => m.name === name);
        if (me) _myTeamRole = me.role || 'editor';
      } catch {}
      return;
    }
    for (const root of visibleRoots) {
      try {
        await apiPost('/team/sync', { name, avatar, folder: root.path });
        const members = await apiFetch('/team?folder=' + encodeURIComponent(root.path));
        const me = members.find(m => m.name === name);
        if (me) _myTeamRoles[root.path] = me.role || 'editor';
      } catch {}
    }
    // デフォルトロール = 最初の可視ソースフォルダのロール
    const firstRole = _myTeamRoles[visibleRoots[0].path];
    if (firstRole) _myTeamRole = firstRole;
  } catch {}
}

let _startupSplashHidden = false;
function _hideStartupSplash() {
  if (_startupSplashHidden) return;
  _startupSplashHidden = true;
  const splash = document.getElementById('gb-splash');
  if (!splash) return;
  splash.style.pointerEvents = 'none';
  splash.style.transition = 'opacity 0.3s';
  splash.style.opacity = '0';
  setTimeout(() => splash.remove(), 300);
}

function _withStartupTimeout(label, promise, timeoutMs, fallbackValue) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  if (!timeout) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[Meldex] startup timeout: ${label} (${timeout}ms)`);
      if (typeof _sendLog === 'function') {
        _sendLog('warn', { message: `[startup-timeout] ${label}`, timeoutMs: timeout });
      }
      resolve(fallbackValue);
    }, timeout);
    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function _runStartupBackground(label, promise, onReady) {
  Promise.resolve(promise)
    .then((value) => {
      if (typeof onReady === 'function') onReady(value);
      return value;
    })
    .catch((error) => {
      console.warn(`[Meldex] startup background task failed: ${label}`, error);
      if (typeof _sendLog === 'function') {
        _sendLog('warn', {
          message: `[startup-bg-failed] ${label}: ${error?.message || error}`,
          stack: error?.stack || '',
        });
      }
      return null;
    });
}

// 特定フォルダ内のパスに対するロールを取得
function getMyRoleForPath(filePath) {
  if (!filePath) return _myTeamRole;
  for (const [folder, role] of Object.entries(_myTeamRoles)) {
    const norm = folder.replace(/\\/g, '/');
    const normFile = filePath.replace(/\\/g, '/');
    if (normFile.startsWith(norm + '/') || normFile === norm) return role;
  }
  return _myTeamRole;
}

// doLogin / ログイン画面は廃止（チーム方式に移行）

// localStorage移行（旧CrossFolio → Meldex、一度だけ実行）
(function migrateLocalStorage() {
  if (localStorage.getItem('gb:migrated')) return;
  const migrations = {
    'crossfolio-auth-token': 'meldex-auth-token',
    'crossfolio-user': 'meldex-user',
    'crossfolio-recent': 'meldex-recent',
    'crossfolio-theme-vars': 'meldex-theme-vars',
    'crossfolio-favorites': 'meldex-favorites',
    'cf-cal-start-day': 'gb-cal-start-day',
  };
  for (const [oldKey, newKey] of Object.entries(migrations)) {
    const val = localStorage.getItem(oldKey);
    if (val !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, val);
    }
  }
  // cf-cal-mode-*, cf-cal-date-* のプレフィックス移行
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('cf-cal-')) {
      const newKey = key.replace('cf-cal-', 'gb-cal-');
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, localStorage.getItem(key));
      }
    }
  }
  localStorage.setItem('gb:migrated', '1');
})();

async function init() {
  // チームプロフィール同期は権限情報の更新用途。起動表示は待たず、裏で完了させる。
  _runStartupBackground('team-profile-sync', _syncMyTeamProfile());

  try {
    const [vault, roots, homeRes] = await Promise.all([
      _withStartupTimeout('vault', apiFetch('/vault'), 5000, { path: '', name: '' }),
      _withStartupTimeout('outliner-roots', apiFetch('/outliner-roots').catch(() => []), 5000, []),
      _withStartupTimeout('home-folder', apiFetch('/home-folder').catch(() => ({ exists: false })), 5000, { exists: false }),
    ]);
    state.vaultPath = vault.path;
    try {
      if (homeRes?.path && typeof _homeFolderPath !== 'undefined') _homeFolderPath = homeRes.path;
    } catch (e) {}

    const hasRoots = roots.length > 0 && roots.some(r => r.visible);
    const hasHome = homeRes.exists;
    const onboardingShown = !!window.MeldexOnboarding?.handleStartupState?.({
      vaultPath: vault.path || '',
      hasRoots,
      hasHome,
      homePath: homeRes?.path || '',
    });
    if (hasHome && !window.MeldexRuntimeAdapter?.isDropboxMode?.()) {
      window.MeldexSampleInstaller?.schedulePostSetupPrompt?.({
        trigger: 'desktop-home-ready',
        homePath: homeRes?.path || '',
      });
    }
    if (!vault.path && !hasRoots && !hasHome) {
      // ソースフォルダもルートもホームもない場合はウェルカム画面
      // ただしサイドバーは表示したまま（設定ボタンにアクセスできるように）
      showView('welcome');
    }

    document.getElementById('sb-work').textContent = vault.path ? ('ソースフォルダ: ' + vault.name) : '';
    document.getElementById('current-title').textContent = '';

    // file_id マイグレーションは初回のみだが、起動表示を止めないよう背景化する。
    const rawMigrationPromise = _migratePathsToFileIds();
    const migrationPromise = _withStartupTimeout('file-id-migration', rawMigrationPromise, 5000, null);

    // 廃止された非表示機能の localStorage を一度だけ除去
    if (!localStorage.getItem('_folder-hidden-removed')) {
      localStorage.removeItem('folder-files-hidden');
      localStorage.setItem('_folder-hidden-removed', '1');
    }
    if (typeof removeLegacyDashboardStorageOnce === 'function') removeLegacyDashboardStorageOnce();

    // フォルダツリーとビュー復元を並行実行
    const outlinerPromise = loadOutliner();
    const linkDictPromise = loadLinkDict();

    // URLパラメータによる初期表示（新しいタブ/ウィンドウで開く用）
    let restored = onboardingShown;
    const restoredByPaneLayout = _paneLayoutRestoredFromStorage();
    const urlParams = new URLSearchParams(window.location.search);
    const openType = urlParams.get('open');
    const openPath = urlParams.get('path');
    const openLabel = urlParams.get('label') || (openPath ? openPath.split('/').pop() : '');
    const isUrlOpen = !!(openType && openPath);
    if (isUrlOpen && _isCloudPhase1UnsupportedOpenType(openType)) {
      _showCloudPhase1UnsupportedOpen(openType);
    } else if (isUrlOpen) {
      const _urlOpenOpts = { skipAutoAppLayout: true };
      // URLパラメータ経由の場合、lastViewを上書きしないフラグを設定
      window._skipLastViewSave = true;
      if (openType === 'page') { openPage(openLabel, openPath, _urlOpenOpts); restored = true; }
      else if (openType === 'board') { openBoard(openLabel, openPath, _urlOpenOpts); restored = true; }
      else if (openType === 'entity') { selectEntity(openPath, _urlOpenOpts); restored = true; }
      else if (openType === 'pivot' || openType === 'database') { selectDatabase(openPath, null, _urlOpenOpts); restored = true; }
      else if (openType === 'media' || openType === 'image' || openType === 'video' || openType === 'audio') {
        const mt = urlParams.get('mediaType') || (openType === 'media' ? 'image' : openType);
        openMedia(openLabel, openPath, mt, _urlOpenOpts);
        restored = true;
      }
      else if (openType === 'html') { openHtmlFile(openLabel, openPath, _urlOpenOpts); restored = true; }
      else if (openType === 'csv') { if (typeof openCsvFile === 'function') { openCsvFile(openLabel, openPath, _urlOpenOpts); restored = true; } }
      else if (openType === 'folder') { openFolder(openLabel, openPath, _urlOpenOpts); restored = true; }
      else if (openType === 'calendar') { openCalendarFile(openLabel, openPath, _urlOpenOpts); restored = true; }
      else if (openType === 'scriptnote' || openType === 'scenario') {
        if (typeof openScenarioInScriptNote === 'function') {
          openScenarioInScriptNote(openPath, openLabel, _urlOpenOpts);
          restored = true;
        }
      }
      else if (openType === 'smart-db') {
        if (typeof openSmartDbFile === 'function') {
          openSmartDbFile(openLabel, openPath, _urlOpenOpts);
          restored = true;
        }
      }
      window._skipLastViewSave = false;
    }

    // v5.0 ペイン配置が復元済みなら、旧 lastView 復元でアクティブペインを上書きしない。
    if (!restored && restoredByPaneLayout) restored = true;

    // 前回のビューを即座に復元（URLパラメータがなかった場合）
    if (!restored) {
    try {
      let last = JSON.parse(localStorage.getItem('lastView') || 'null');
      if (last && _isCloudPhase1UnsupportedOpenType(last.type)) {
        localStorage.removeItem('lastView');
        _showCloudPhase1UnsupportedOpen(last.type);
        last = null;
      }
      const _expOpts = { fromExplorer: true, skipAutoAppLayout: true };
      if (last) {
        if (last.type === 'pivot' && last.dbPath) { selectDatabase(last.dbPath, null, _expOpts); restored = true; }
        else if (last.type === 'entity' && last.entityPath) { selectEntity(last.entityPath, _expOpts); restored = true; }
        else if (last.type === 'page' && last.path) { openPage(last.label || '', last.path, _expOpts); restored = true; }
        else if (last.type === 'board' && last.path) { openBoard(last.label || '', last.path, _expOpts); restored = true; }
        else if (last.type === 'media' && last.path) { openMedia(last.label || '', last.path, last.mediaType || 'image', _expOpts); restored = true; }
        else if (last.type === 'html' && last.path) { openHtmlFile(last.label || '', last.path, _expOpts); restored = true; }
        else if (last.type === 'csv' && last.path) { if (typeof openCsvFile === 'function') { openCsvFile(last.label || '', last.path, _expOpts); restored = true; } }
        else if (last.type === 'scriptnote' && last.path && typeof openScenarioInScriptNote === 'function') { openScenarioInScriptNote(last.path, last.label || '', _expOpts); restored = true; }
        else if (last.type === 'folder' && last.path) { openFolder(last.label || '', last.path, _expOpts); restored = true; }
        else if (last.type === 'calendar' && last.path) { openCalendarFile(last.label || '', last.path, _expOpts); restored = true; }
        else if (last.type === 'smart-db' && last.path && last.path.startsWith('file:') === false && typeof openSmartDbFile === 'function') { openSmartDbFile(last.label || '', last.path, _expOpts); restored = true; }
        else if (last.type === 'smart-db' && last.smartDbId) { selectSmartDb(last.smartDbId, null, _expOpts); restored = true; }
      }
    } catch (e) {}
    } // if (!restored) from URL params

    // 初回起動: lastView もURLパラメータも無く、過去にクイックスタートを開いた履歴が無ければ
    // マニュアルのクイックスタートをノートとして開く（ファイルが存在する場合のみ）
    if (!restored && !localStorage.getItem('meldex-quickstart-shown') && _homeFolderPath) {
      const _qsPath = _homeFolderPath.replace(/[\\/]$/, '') + '/マニュアル/01_はじめに/クイックスタート.md';
      try {
        const _check = await apiFetch('/file?path=' + encodeURIComponent(_qsPath), { silentError: true });
        if (_check && typeof _check.content === 'string') {
          const _qsOpts = { fromExplorer: true, skipAutoAppLayout: true };
          openPage('クイックスタート', _qsPath, _qsOpts);
          localStorage.setItem('meldex-quickstart-shown', '1');
          restored = true;
        }
      } catch (e) {}
    }

    if (!restored && !_isDesktopStartupLaunch()) {
      const startupFolder = _startupFolderCandidate(roots, homeRes, vault);
      if (startupFolder?.path) {
        const _startupOpts = { fromExplorer: true, skipAutoAppLayout: true };
        await openFolder(startupFolder.label || _pathTailLabel(startupFolder.path, 'フォルダ'), startupFolder.path, _startupOpts);
        restored = true;
      }
    }

    // v5.0 ペインシステムがタブを復元している場合は welcome にフォールバックしない。
    // lastView ベースの復元が hit しなくても、ペイン配置が残っていれば画面は埋まっている。
    if (!restored) {
      const _paneHasTabs = _paneLayoutHasAnyTabs();
      if (!_paneHasTabs) showView('welcome');
    }

    // 起動後の重い補助処理は背景で継続し、表示を先に返す。
    _hideStartupSplash();
    _runStartupBackground('file-id-migration-finalize', rawMigrationPromise.then(() => _migratePathsToFileIds()));
    _runStartupBackground('post-init-ready', Promise.allSettled([migrationPromise, outlinerPromise, linkDictPromise]), () => {
      initGlobalFilterBar();
      setTimeout(() => {
        const last = JSON.parse(localStorage.getItem('lastView') || 'null');
        if (last) {
          const p = last.path || last.dbPath || last.entityPath || '';
          if (p) highlightOutlinerNode(p);
        }
      }, 500);
      showStatus('準備完了');
    });
  } catch (e) {
    showStatus('ソースフォルダ情報の取得に失敗しました', true);
  }
  _hideStartupSplash();
}
/* ==============================
   表示切替
   ============================== */
function showView(viewName, ctx) {
  const resolvedViewName = ['calendar', 'tasks', 'shifts'].includes(viewName) ? 'timeline' : viewName;
  const isDbViewName = (name) => ['pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db', 'calendar', 'tasks', 'shifts'].includes(name);
  // スプリットペイン内のビュー切替（ctxにcontainerElがある場合）
  if (ctx && ctx.containerEl) {
    const isDbView = isDbViewName(viewName);
    const c = ctx.containerEl;
    const _sv = (sel, show) => { const el = c.querySelector(sel); if (el) el.style.display = show; };
    _sv('.db-view-container', isDbView ? 'flex' : 'none');
    _sv('.pivot-view', resolvedViewName === 'pivot' ? '' : 'none');
    _sv('.gallery-view', resolvedViewName === 'gallery' ? 'flex' : 'none');
    _sv('.kanban-view', resolvedViewName === 'kanban' ? 'flex' : 'none');
    _sv('.timeline-view', resolvedViewName === 'timeline' ? '' : 'none');
    _sv('.chart-view', resolvedViewName === 'chart' ? 'flex' : 'none');
    _sv('.graph-view', resolvedViewName === 'graph' ? 'flex' : 'none');
    _sv('.form-view', resolvedViewName === 'form' ? 'flex' : 'none');
    _sv('.smart-db-view', resolvedViewName === 'smart-db' ? '' : 'none');
    ctx.viewMode = viewName;
    return;
  }
  // ビュー切替前にボードの未保存を即時保存
  if (state.view === 'board' && viewName !== 'board' && typeof bd !== 'undefined' && bd.dirty && bd.path) {
    if (typeof bdSave === 'function') bdSave();
  }
  // ボードから離れたらノートタブを非表示
  if (state.view === 'board' && viewName !== 'board' && typeof hideBoardNoteTab === 'function') {
    hideBoardNoteTab();
  }
  if (state.view === 'board' && viewName !== 'board' && typeof clearBoardDetailTabs === 'function') {
    clearBoardDetailTabs();
  }
  // viewName: 'welcome' | 'pivot' | 'gallery' | 'kanban' | 'entity' | 'page' | 'board'
  const isDbView = isDbViewName(viewName);
  const _setDisplay = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.style.display = value;
  };
  _setDisplay('login-view', 'none');
  _setDisplay('welcome-view', resolvedViewName === 'welcome' ? 'flex' : 'none');
  _setDisplay('db-view-container', isDbView ? 'flex' : 'none');
  _setDisplay('pivot-view', resolvedViewName === 'pivot' ? '' : 'none');
  _setDisplay('gallery-view', resolvedViewName === 'gallery' ? 'flex' : 'none');
  _setDisplay('kanban-view', resolvedViewName === 'kanban' ? 'flex' : 'none');
  _setDisplay('timeline-view', resolvedViewName === 'timeline' ? '' : 'none');
  _setDisplay('chart-view', resolvedViewName === 'chart' ? 'flex' : 'none');
  _setDisplay('graph-view', resolvedViewName === 'graph' ? 'flex' : 'none');
  _setDisplay('form-view', resolvedViewName === 'form' ? 'flex' : 'none');
  _setDisplay('smart-db-view', resolvedViewName === 'smart-db' ? 'flex' : 'none');
  _setDisplay('compare-view', resolvedViewName === 'compare' ? 'flex' : 'none');
  _setDisplay('entity-view', resolvedViewName === 'entity' ? 'flex' : 'none');
  _setDisplay('page-view', resolvedViewName === 'page' ? 'flex' : 'none');
  _setDisplay('media-view', resolvedViewName === 'media' ? 'flex' : 'none');
  _setDisplay('html-view', resolvedViewName === 'html' ? 'flex' : 'none');
  _setDisplay('csv-view', resolvedViewName === 'csv' ? 'flex' : 'none');
  _setDisplay('folder-view', resolvedViewName === 'folder' ? 'flex' : 'none');
  // app-toolbarの表示切替
  const appTb = document.getElementById('app-toolbar');
  _setDisplay('tb-db', isDbView ? 'contents' : 'none');
  // ページビュー: app-toolbarにリッチテキストツールバー表示
  const showRtInAppbar = (resolvedViewName === 'page');
  _setDisplay('rt-toolbar', showRtInAppbar ? '' : 'none');
  const hasAppTb = isDbView || showRtInAppbar;
  if (appTb) appTb.classList.toggle('visible', hasAppTb);
  // エントリビュー: エントリ内ツールバー
  const entityRt = document.getElementById('entity-rt-toolbar');
  if (entityRt) entityRt.style.display = (resolvedViewName === 'entity') ? 'flex' : 'none';
  // ステータスバーのショートカットヘルプ
  const sc = document.getElementById('sb-shortcuts');
  if (isDbView) {
    sc.textContent = '';
  } else if (resolvedViewName === 'entity' || resolvedViewName === 'page') {
    sc.textContent = 'Ctrl+B 太字 | Ctrl+I 斜体 | Ctrl+U 下線 | Ctrl+Shift+1~6 見出し | Ctrl+Shift+8 箇条書き | Tab インデント | Ctrl+Shift+↑↓ 移動';
  } else if (resolvedViewName === 'scriptnote') {
    if (typeof updateScriptnoteShortcutStatusbar === 'function') updateScriptnoteShortcutStatusbar(sc);
    else sc.textContent = 'Enter 行追加 | Ctrl+Enter 同タイプ行追加 | Shift+Del 行削除 | Ctrl+↑↓ 行入替 | Ctrl+R ルビ | Ctrl+Z Undo | Ctrl+Y Redo';
  } else {
    sc.textContent = '';
  }

  state.view = viewName;

  // メモ: ビュー切替時にターゲット更新＋再読み込み＋スクロール同期
  if (typeof ann !== 'undefined') {
    const newTarget = typeof getAnnotationTarget === 'function' ? getAnnotationTarget() : '';
    if (newTarget !== ann.targetPath) {
      ann.targetPath = newTarget;
      // 埋め込みサーフェス (board/html) の場合は iframe/bridge 側でロードされるため、
      // スタンドアロン側の loadAnnotations を呼ぶと同じ注釈が二重に描画される
      const embedded = typeof _usesEmbeddedAnnotationSurface === 'function'
        && _usesEmbeddedAnnotationSurface(viewName);
      if (embedded) {
        // 旧ビューからの残留（スタンドアロン overlay の描画＋付箋）をクリア
        const layer = document.getElementById('ann-layer');
        if (layer) layer.innerHTML = '';
        if (typeof _forEachStandaloneAnnotationNote === 'function') {
          _forEachStandaloneAnnotationNote(el => el.remove());
        }
      } else if (typeof loadAnnotations === 'function') {
        loadAnnotations();
      }
    }
    if (typeof _setupOverlayScroll === 'function') _setupOverlayScroll(viewName);
  }
}
// スクリーンショットメニュー
function showScreenshotMenu(e) {
  const existing = document.querySelector('.ab-dropdown.ss-menu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.className = 'ab-dropdown ss-menu';
  function addItem(label, fn) { const item = document.createElement('div'); item.className = 'ab-dropdown-item'; item.textContent = label; item.addEventListener('click', () => { menu.remove(); fn(); }); menu.appendChild(item); }
  function addSep() { const s = document.createElement('div'); s.className = 'ab-dropdown-sep'; menu.appendChild(s); }
  addItem('全画面キャプチャ', () => captureScreenshot('full'));
  addItem('範囲選択キャプチャ', () => captureScreenshot('region'));
  addSep();
  addItem('全画面（GB非表示）', () => captureScreenshot('full-hide'));
  addItem('範囲選択（GB非表示）', () => captureScreenshot('region-hide'));
  addSep();
  addItem('トレイアプリから操作', () => showStatus('Ctrl+Shift+S (全画面) / Ctrl+Shift+R (範囲) / Ctrl+Shift+W (ウィンドウ)'));
  document.body.appendChild(menu);
  const btn = e.target.closest('button') || e.target;
  const rect = btn.getBoundingClientRect();
  { const z = _getZoom(); menu.style.left = (rect.right / z + 4) + 'px'; menu.style.top = (rect.top / z) + 'px'; }
  requestAnimationFrame(() => { const z = _getZoom(); const mr = menu.getBoundingClientRect(); if (mr.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - mr.height - 4) / z) + 'px'; if (mr.right > window.innerWidth) menu.style.left = ((rect.left - mr.width - 4) / z) + 'px'; });
  setTimeout(() => { document.addEventListener('pointerdown', function closer(ev) { if (!menu.contains(ev.target) && !btn.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closer); } }); }, 0);
}

async function captureScreenshot(mode) {
  try {
    const hideFirst = mode.includes('hide');
    if (hideFirst) { window.blur(); await new Promise(r => setTimeout(r, 500)); }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' } });
    const video = document.createElement('video');
    video.srcObject = stream; video.play();
    await new Promise(r => video.onloadeddata = r);
    await new Promise(r => setTimeout(r, 200));
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    stream.getTracks().forEach(t => t.stop());
    if (hideFirst) window.focus();
    const b64 = canvas.toDataURL('image/png');
    const res = await apiPost('/annotation/screenshot', { data: b64, target_path: '_screenshots' });
    if (res.path) {
      showStatus('スクリーンショットを保存しました', false, { showSaveDialog: true });
      const viewerUrl = window.MeldexResourceUrl?.viewer
        ? window.MeldexResourceUrl.viewer({ file: res.path, markup: 1 })
        : ('/viewer?file=' + encodeURIComponent(res.path) + '&markup=1');
      window.open(viewerUrl, '_blank');
    }
  } catch (e) { if (e.name !== 'NotAllowedError') showStatus('スクリーンショット失敗: ' + e.message, true); }
}

// モバイル: スワイプでサイドバー開閉
(function() {
  let touchStartX = 0, touchStartY = 0;
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (window.innerWidth > 768) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return; // 横スワイプのみ
    const sidebar = document.getElementById('sidebar');
    if (dx > 0 && touchStartX < 40 && !sidebar.classList.contains('open')) {
      // 左端から右スワイプ → サイドバー開く
      sidebar.classList.add('open');
      document.getElementById('sidebar-backdrop').classList.add('open');
    } else if (dx < 0 && sidebar.classList.contains('open')) {
      // 左スワイプ → サイドバー閉じる
      sidebar.classList.remove('open');
      document.getElementById('sidebar-backdrop').classList.remove('open');
    }
  }, { passive: true });
})();

/* ==============================
   ステータスバー
   ============================== */
// メッセージ先頭行をタイトル、残りを本文として HTML を組み立てる。
// 単一行メッセージは従来通り本文 div のみ表示し、複数行のみタイトル化する。
function _buildCfDialogBody(message) {
  const text = String(message ?? '');
  if (!text) return '';
  // v0.5.250: .gb-confirm-message クラスに統一 (CSS で line-height / white-space / word-break を一括指定)。
  // 複数行メッセージでは先頭行を強調表示 (font-weight) し、以降を本文として扱う。
  const lines = text.split('\n');
  if (lines.length < 2) {
    return `<div class="gb-confirm-message">${esc(text)}</div>`;
  }
  const title = (lines.shift() || '').trim();
  const body = lines.join('\n').trim();
  let html = '';
  if (title) html += `<div class="gb-confirm-message" style="font-weight:600;">${esc(title)}</div>`;
  if (body) html += `<div class="gb-confirm-message" style="color:var(--ui-fg-muted);">${esc(body)}</div>`;
  return html;
}

// v0.5.250: cf ダイアログは .modal (大型殻) から .gb-confirm (コンパクト殻) に統一。
// - ヘッダー / フッター分割なし (短い問いかけ専用)
// - OK ボタンは .gb-btn-primary 基準、message に「削除」が含まれる場合は .gb-btn-danger + ラベル「削除」に自動切替
// - options.danger で明示指定可、options.okLabel / options.cancelLabel で文言上書き可
function _cfIsDeleteMessage(text) {
  // 破壊的操作を示唆するキーワード。
  // 「元に戻す」(= undo) は破壊的でないため「デフォルト.*戻」のみ (リセット系) を拾う。
  // 「を空に」は「ゴミ箱を空にする/します/しますか」を両活用形でカバーする。
  return /削除|破棄|除去|消去|初期化|リセット|を空に|デフォルト.{0,8}戻/.test(String(text || ''));
}

// カスタムalertダイアログ（alert()の代替、画面中央モーダル）
function cfAlert(message, options) {
  const opts = options || {};
  const okLabel = opts.okLabel || 'OK';
  const showSupport = opts.support !== false && /HTTP\s+\d{3}|Error|エラー|失敗|例外/.test(String(message || ''));
  const supportButton = showSupport
    ? '<button id="_gb-support" class="gb-btn gb-btn-sm">サポートに送信</button>'
    : '';
  return new Promise(resolve => {
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.style.zIndex = '300';
    o.innerHTML = `<div class="gb-confirm" role="alertdialog" aria-modal="true">
      ${_buildCfDialogBody(message)}
      <div class="gb-confirm-actions">
        ${supportButton}
        <button id="_gb-ok" class="gb-btn gb-btn-sm gb-btn-primary">${esc(okLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(o);
    const cleanup = () => { o.remove(); document.removeEventListener('keydown', kh); resolve(); };
    function kh(e) { if (e.key === 'Enter' || e.key === 'Escape') cleanup(); }
    o.querySelector('#_gb-ok').addEventListener('click', cleanup);
    o.querySelector('#_gb-support')?.addEventListener('click', () => {
      window.MeldexDiagnostics?.showSupportDialog?.(new Error(String(message || '')), { kind: 'cfAlert' });
    });
    o.addEventListener('click', (e) => { if (e.target === o) cleanup(); });
    document.addEventListener('keydown', kh);
    o.querySelector('#_gb-ok').focus();
  });
}

// カスタムconfirmダイアログ（confirm()の代替、画面中央モーダル）
// options: { danger?: boolean, okLabel?: string, cancelLabel?: string }
function cfConfirm(message, options) {
  const opts = options || {};
  const autoDanger = _cfIsDeleteMessage(message);
  const isDanger = opts.danger !== undefined ? !!opts.danger : autoDanger;
  const defaultOk = isDanger ? (autoDanger && /削除/.test(String(message)) ? '削除' : '実行') : '決定';
  const okLabel = opts.okLabel || defaultOk;
  const cancelLabel = opts.cancelLabel || 'キャンセル';
  const okVariant = isDanger ? 'gb-btn-danger' : 'gb-btn-primary';
  return new Promise(resolve => {
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.style.zIndex = '300';
    o.innerHTML = `<div class="gb-confirm" role="alertdialog" aria-modal="true">
      ${_buildCfDialogBody(message)}
      <div class="gb-confirm-actions">
        <button id="_gb-cancel" class="gb-btn gb-btn-sm">${esc(cancelLabel)}</button>
        <button id="_gb-ok" class="gb-btn gb-btn-sm ${okVariant}">${esc(okLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(o);
    const cleanup = (val) => { o.remove(); document.removeEventListener('keydown', kh); resolve(val); };
    function kh(e) {
      if (e.key === 'Escape') { cleanup(false); return; }
      // 通常モードは Enter = OK のショートカット。
      // danger モードは誤操作防止のため Enter のショートカットを無効化し、
      // フォーカスされたボタン (初期は cancel) の自然な Enter 起動に任せる。
      if (e.key === 'Enter' && !isDanger) cleanup(true);
    }
    o.querySelector('#_gb-ok').addEventListener('click', () => cleanup(true));
    o.querySelector('#_gb-cancel').addEventListener('click', () => cleanup(false));
    o.addEventListener('click', (e) => { if (e.target === o) cleanup(false); });
    document.addEventListener('keydown', kh);
    // danger 時は誤操作防止のため cancel に初期フォーカス、それ以外は ok
    o.querySelector(isDanger ? '#_gb-cancel' : '#_gb-ok').focus();
  });
}

// カスタムpromptダイアログ（prompt()の代替）
function cfPrompt(message, defaultValue, options) {
  const opts = options || {};
  const okLabel = opts.okLabel || '決定';
  const cancelLabel = opts.cancelLabel || 'キャンセル';
  return new Promise(resolve => {
    const o = document.createElement('div');
    o.className = 'modal-overlay';
    o.style.zIndex = '300';
    o.innerHTML = `<div class="gb-confirm" role="dialog" aria-modal="true">
      ${_buildCfDialogBody(message)}
      <input type="text" id="_gb-prompt-input" class="gb-confirm-input" value="${esc(defaultValue || '')}">
      <div class="gb-confirm-actions">
        <button id="_gb-cancel" class="gb-btn gb-btn-sm">${esc(cancelLabel)}</button>
        <button id="_gb-ok" class="gb-btn gb-btn-sm gb-btn-primary">${esc(okLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(o);
    const input = o.querySelector('#_gb-prompt-input');
    const cleanup = (val) => { o.remove(); resolve(val); };
    o.querySelector('#_gb-ok').addEventListener('click', () => cleanup(input.value));
    o.querySelector('#_gb-cancel').addEventListener('click', () => cleanup(null));
    o.addEventListener('click', (e) => { if (e.target === o) cleanup(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') cleanup(input.value); if (e.key === 'Escape') cleanup(null); });
    input.focus();
    input.select();
  });
}

// showStatus() は meldex-core.js で定義済み（nullチェック付き）

// xlsx取込: ファイル選択 → 新規台本作成 → 台本エディタで開く
function importXlsxToOutliner() {
  document.getElementById('xlsx-import-input').click();
}

async function handleXlsxImportToOutliner(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  // ファイル名（拡張子なし）を台本名にする
  const baseName = file.name.replace(/\.(xlsx|xls)$/, '');

  try {
    // 空の台本ファイルを作成
    const res = await apiPost('/outliner/add', { type: 'scriptnote', label: baseName });
    const scriptnotePath = res.node.path;

    // 台本エディタで開く
    if (typeof openScenarioInScriptNote === 'function') {
      openScenarioInScriptNote(scriptnotePath, baseName);
    }

    // フォルダツリーをリロード
    await loadOutliner();
    showStatus(`xlsx取込: ${baseName}`);
  } catch (err) {
    showStatus('xlsx取込に失敗しました: ' + err.message, true);
  }
}

// Phase C: ボードエンジンはgb-canvas-engine.js + gb-canvas-features.js + gb-canvas-interact.js に移行済み
// bd オブジェクトは gb-canvas-engine.js で定義

// グローバルdrop防止（未処理エリアへのドロップでブラウザがファイルを開くのを防ぐ）
document.addEventListener('dragover', (e) => { e.preventDefault(); }, false);
document.addEventListener('drop', (e) => {
  // 個別ハンドラでpreventDefaultされていない場合のみ（フォールバック）
  if (!e.defaultPrevented) e.preventDefault();
}, false);
