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
  const opened = window.open(resolvedUrl, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
  return !!opened;
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
    try {
      // タブを追加（既存ならアクティブ化のみ、navOpenは呼ばない）
      const path = entry.path || entry.dbPath || '';
      const type = typeof _normalizeOpenTypeForNav === 'function' ? _normalizeOpenTypeForNav(entry.type) : entry.type;
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
    } finally {
      _addingTab = false;
    }
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
  const fileId = _pathToFileId(dbPath);
  if (fileId) return 'db:' + fileId;
  if (dbPath) return 'db:' + String(dbPath).replace(/\\/g, '/');
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
  const filePath = obj?.path || obj?.dbPath || obj?.entityPath || '';
  if (obj && filePath && !obj.file_id) {
    const fid = _pathToFileId(filePath);
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
  } else if (route === '/outliner/delete') {
    addBody('path');
  } else if (route === '/outliner/duplicate') {
    const srcPath = String(body?.path || '').trim();
    if (srcPath) _apiLockAddPath(paths, _apiLockPathDir(srcPath));
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
  try { await window.MeldexDropboxProfileSync?.resolveStartupProfile?.(); } catch {}
  const name = getUsername();
  if (!name || name === 'anonymous') return;
  const avatar = localStorage.getItem('meldex-avatar') || '';
  const teamPayload = (extra) => window.MeldexDropboxProfileSync?.teamSyncPayload?.({ name, avatar, ...(extra || {}) }) || { name, avatar, ...(extra || {}) };
  // 全ソースフォルダに同期
