/* gb-app-layout.js: legacy app-layout compatibility no-ops for the single-layout shell */
const GB_APP_LAYOUTS_KEY = 'gb:app-layouts';
const GB_APP_LAYOUT_ACTIVE_KEY = 'gb:app-layout-active';
const GB_LAYOUT_SOURCE_KEY = 'gb:layout-source';
const GB_APP_LAYOUT_TYPE_BINDINGS_KEY = 'gb:app-layout-type-bindings';

const GBAppLayouts = (() => {
  const APP_LAYOUTS = {};

  const TYPE_ALIASES = {
    scenario: 'scriptnote',
    pivot: 'database',
    entity: 'database',
    gallery: 'database',
    kanban: 'database',
    timeline: 'database',
    gantt: 'database',
    tasks: 'database',
    shifts: 'database',
    calendar: 'database',
    chart: 'database',
    graph: 'database',
  };

  const UTILITY_TYPES = new Set([
    'outliner', 'detail', 'preview', 'chat', 'calendar',
    'history', 'annotation', 'sticky', 'tags', 'search', 'version',
  ]);

  let _initialized = false;

  function _loadAppLayouts() {
    try {
      const raw = JSON.parse(localStorage.getItem(GB_APP_LAYOUTS_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  function _saveAppLayouts(layouts) {
    localStorage.setItem(GB_APP_LAYOUTS_KEY, JSON.stringify(layouts || {}));
  }

  function _canonicalFileType(type) {
    const key = String(type || '').trim();
    return TYPE_ALIASES[key] || key;
  }

  function _loadTypeBindings() {
    return {};
  }

  function _saveTypeBindings(bindings) {
    localStorage.removeItem(GB_APP_LAYOUT_TYPE_BINDINGS_KEY);
  }

  const APP_LAYOUT_HISTORY_KEYS = [
    'gb:layout',
    'gb:layout:active-pane',
    GB_APP_LAYOUTS_KEY,
    GB_APP_LAYOUT_ACTIVE_KEY,
    GB_LAYOUT_SOURCE_KEY,
    GB_APP_LAYOUT_TYPE_BINDINGS_KEY,
  ];

  function _captureLayoutStorageSnapshot(keys = APP_LAYOUT_HISTORY_KEYS) {
    const storage = {};
    keys.forEach((key) => {
      storage[key] = localStorage.getItem(key);
    });
    return {
      keys: keys.slice(),
      storage,
      layout: (typeof GBLayout !== 'undefined' && typeof GBLayout.captureLayoutSnapshot === 'function')
        ? GBLayout.captureLayoutSnapshot()
        : null,
    };
  }

  function _applyLayoutStorageValues(snapshot) {
    (snapshot.keys || Object.keys(snapshot.storage || {})).forEach((key) => {
      const value = Object.prototype.hasOwnProperty.call(snapshot.storage || {}, key) ? snapshot.storage[key] : null;
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
  }

  async function _restoreLayoutStorageSnapshot(snapshot) {
    if (!snapshot?.storage) return false;
    const before = _captureLayoutStorageSnapshot(snapshot.keys || Object.keys(snapshot.storage));
    if (snapshot.layout && typeof GBLayout !== 'undefined' && typeof GBLayout.restoreLayoutSnapshot === 'function') {
      const restored = await GBLayout.restoreLayoutSnapshot(snapshot.layout);
      if (restored !== true) {
        throw new Error('編集中の画面を保存できなかったため、レイアウト履歴を適用しませんでした');
      }
    }
    try {
      // live layoutのflush/apply成功後だけ、再読込用storage世代を切り替える。
      _applyLayoutStorageValues(snapshot);
    } catch (error) {
      try {
        if (before.layout && typeof GBLayout !== 'undefined'
          && typeof GBLayout.restoreLayoutSnapshot === 'function') {
          await GBLayout.restoreLayoutSnapshot(before.layout);
        }
        _applyLayoutStorageValues(before);
      } catch (_) {}
      throw error;
    }
    try { syncButtons(); } catch (_) {}
    return true;
  }

  function _pushLayoutStorageHistory(label, beforeSnapshot, afterSnapshot, detail) {
    if (typeof historyPush !== 'function' || !beforeSnapshot || !afterSnapshot) return false;
    let beforeKey = '';
    let afterKey = '';
    try {
      beforeKey = JSON.stringify(beforeSnapshot);
      afterKey = JSON.stringify(afterSnapshot);
    } catch {}
    if (beforeKey && beforeKey === afterKey) return false;
    const scope = (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
    historyPush(
      label,
      () => _restoreLayoutStorageSnapshot(beforeSnapshot),
      () => _restoreLayoutStorageSnapshot(afterSnapshot),
      scope,
      detail || ''
    );
    return true;
  }

  function _getTypeBindingValue(type) {
    return null;
  }

  function getLayoutSource() {
    return localStorage.getItem(GB_LAYOUT_SOURCE_KEY) || '';
  }

  function setLayoutSource(source) {
    if (source) localStorage.setItem(GB_LAYOUT_SOURCE_KEY, source);
    else localStorage.removeItem(GB_LAYOUT_SOURCE_KEY);
  }

  function getLastSelectedAppLayoutId() {
    return localStorage.getItem(GB_APP_LAYOUT_ACTIVE_KEY) || '';
  }

  function getCurrentAppLayoutId() {
    const source = getLayoutSource();
    return source.startsWith('app:') ? source.slice(4) : '';
  }

  function _getStoredLayoutRecord(appId) {
    const record = _loadAppLayouts()[appId];
    return record && typeof record === 'object' ? record : null;
  }

  function _getAppLayoutConfig(appId) {
    const record = _getStoredLayoutRecord(appId);
    if (APP_LAYOUTS[appId]) {
      return {
        ...APP_LAYOUTS[appId],
        label: record?.label || APP_LAYOUTS[appId].label,
        toolType: record?.toolType || APP_LAYOUTS[appId].toolType,
      };
    }
    if (record?.custom) {
      return {
        label: record.label || 'レイアウト',
        toolType: record.toolType || 'folder',
        custom: true,
      };
    }
    return null;
  }

  function _layoutLabel(appId) {
    return _getAppLayoutConfig(appId)?.label || 'レイアウト';
  }

  function _setStoredLayoutRecord(appId, patch) {
    if (!appId || !_isKnownAppLayout(appId)) return false;
    const layouts = _loadAppLayouts();
    const existing = layouts[appId] || {};
    layouts[appId] = { ...existing, ...patch, time: Date.now() };
    _saveAppLayouts(layouts);
    return true;
  }

  function _isKnownAppLayout(appId) {
    return !!_getAppLayoutConfig(appId);
  }

  function _renderLayoutIcon(iconSpec, size) {
    const spec = iconSpec || 'layoutTemplate';
    if (typeof GBIconAssets !== 'undefined') return GBIconAssets.render(spec, size || 18);
    return typeof lucide === 'function' ? lucide(spec, size || 18) : '';
  }

  function _cloneLayout(layout) {
    if (!layout) return null;
    try {
      return JSON.parse(JSON.stringify(layout));
    } catch {
      return null;
    }
  }

  function _loadStoredLayout() {
    try {
      return _cloneLayout(JSON.parse(localStorage.getItem('gb:layout') || 'null'));
    } catch {
      return null;
    }
  }

  function _collectContentPane(root) {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function') return null;
    const panes = GBLayout.getAllPanes(root || GBLayout.root);
    if (!panes.length) return null;
    const activePaneId = typeof GBLayout.activePane === 'string' ? GBLayout.activePane : '';
    const activePane = panes.find((pane) => pane.id === activePaneId);
    const activeTab = activePane?.tabs?.[activePane.activeTabIndex];
    if (activeTab && !UTILITY_TYPES.has(activeTab.type)) return activePane;
    return panes.find((pane) => {
      const tab = pane.tabs?.[pane.activeTabIndex];
      return tab && !UTILITY_TYPES.has(tab.type);
    }) || activePane || panes[0];
  }

  function inferAppLayoutFromCurrent() {
    return '';
  }

  function _defaultAppLayoutIdForType(type) {
    return '';
  }

  function getAppLayoutIdForType(type) {
    return '';
  }

  function setFileTypeBinding(type, appId) {
    _saveTypeBindings({});
    return false;
  }

  function clearFileTypeBinding(type) {
    _saveTypeBindings({});
    return true;
  }

  function _removeBindingsForLayout(appId) {
    const bindings = _loadTypeBindings();
    let changed = false;
    Object.keys(bindings).forEach(type => {
      if (bindings[type] === appId) {
        delete bindings[type];
        changed = true;
      }
    });
    if (changed) _saveTypeBindings(bindings);
  }

  function getFileTypesForAppLayout(appId) {
    return [];
  }

  function _exportCurrentLayoutRecord() {
    if (typeof GBLayout === 'undefined') return null;
    const layout = typeof GBLayout.exportLayout === 'function'
      ? GBLayout.exportLayout()
      : _cloneLayout(GBLayout.root);
    if (!layout) return null;
    const activePaneId = GBLayout.activePane || GBLayout.findFirstPane?.(GBLayout.root)?.id || '';
    return { layout, activePaneId };
  }

  function _captureCurrentFilterState(fallback) {
    if (typeof getCurrentOutlinerFilterState === 'function') {
      return _cloneLayout(getCurrentOutlinerFilterState());
    }
    return _cloneLayout(fallback);
  }

  function _persistCurrentAppLayout(appId) {
    _ensureInitialized();
    return false;
  }

  function _createUtilityPane(label, type) {
    return GBLayout.createPaneNode(null, [GBTabs.createTab(label, type, '')], 0);
  }

  function _buildDefaultLayoutRecord(appId) {
    const config = _getAppLayoutConfig(appId);
    if (!config || typeof GBLayout === 'undefined' || typeof GBTabs === 'undefined') return null;
    const mainPane = GBLayout.createPaneNode(null, [GBTabs.createTab(config.label, config.toolType, '')], 0);
    const outlinerPane = _createUtilityPane('フォルダツリー', 'outliner');
    const previewPane = _createUtilityPane('ビューワー', 'preview');
    const detailPane = _createUtilityPane('オプション', 'detail');
    const utilityPane = GBLayout.createPaneNode(null, [
      GBTabs.createTab('チャット', 'chat', ''),
      GBTabs.createTab('カレンダー', 'calendar', ''),
      GBTabs.createTab('ヒストリー', 'history', ''),
      GBTabs.createTab('アノテート', 'annotation', ''),
    ], 0);
    utilityPane.collapsed = true;
    utilityPane._savedRatio = 0.75;

    const sideSplit = GBLayout.createSplitNode('vertical', 0.5, [previewPane, detailPane]);
    const contentSplit = GBLayout.createSplitNode('horizontal', 0.82, [mainPane, sideSplit]);
    const rightSplit = GBLayout.createSplitNode('horizontal', 0.975, [contentSplit, utilityPane]);
    const root = GBLayout.createSplitNode('horizontal', 0.15, [outlinerPane, rightSplit]);
    return { layout: root, activePaneId: mainPane.id };
  }

  function _ensureStoredLayout(appId) {
    const layouts = _loadAppLayouts();
    if (!layouts[appId]?.layout) {
      const record = _buildDefaultLayoutRecord(appId);
      if (!record) return null;
      const existing = layouts[appId] || {};
      layouts[appId] = { ...record, ...existing, layout: record.layout, activePaneId: record.activePaneId };
      _saveAppLayouts(layouts);
    }
    return layouts[appId];
  }

  function _customLayoutEntries() {
    return Object.entries(_loadAppLayouts())
      .filter(([id, record]) => !APP_LAYOUTS[id] && record?.custom && record?.layout)
      .sort((a, b) => (a[1].createdAt || a[1].time || 0) - (b[1].createdAt || b[1].time || 0));
  }

  function listAppLayouts() {
    _ensureInitialized();
    return [];
  }

  function _discardAppLayoutSetsForSingleLayout() {
    localStorage.removeItem(GB_APP_LAYOUTS_KEY);
    localStorage.removeItem(GB_APP_LAYOUT_ACTIVE_KEY);
    localStorage.removeItem(GB_APP_LAYOUT_TYPE_BINDINGS_KEY);
    const source = getLayoutSource();
    if (source.startsWith('app:')) setLayoutSource('custom');
  }

  function _ensureInitialized() {
    _discardAppLayoutSetsForSingleLayout();
    if (_initialized) {
      if (!getLayoutSource()) setLayoutSource('custom');
      return;
    }
    _initialized = true;
    let source = getLayoutSource();
    // 旧ワークスペース機能は廃止。残存ソースは 'custom' に置き換える。
    if (source.startsWith('workspace:')) {
      setLayoutSource('custom');
      source = 'custom';
    }
    if (!source) {
      setLayoutSource('custom');
      return;
    }
  }

  function syncButtons() {
    _ensureInitialized();
    const activeAppId = getCurrentAppLayoutId();
    document.body.dataset.appLayoutActive = activeAppId || '';
    if (typeof refreshCommandPalette === 'function') refreshCommandPalette();
  }

  function applyAppLayout(appId) {
    _ensureInitialized();
    syncButtons();
    return false;
  }

  function getFilterStateForAppLayout(appId) {
    _ensureInitialized();
    return null;
  }

  function saveFilterStateForAppLayout(appId, filterState) {
    _ensureInitialized();
    return false;
  }

  function saveCurrentFilterState() {
    _ensureInitialized();
    return false;
  }

  function _newCustomLayoutId() {
    return 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  function _nextCustomLayoutName() {
    const names = new Set(_customLayoutEntries().map(([, record]) => record.label).filter(Boolean));
    let n = 1;
    while (names.has('レイアウト ' + n)) n += 1;
    return 'レイアウト ' + n;
  }

  function _inferToolTypeFromRecord(record) {
    const pane = _collectContentPane(record?.layout);
    return pane?.tabs?.[pane.activeTabIndex]?.type || 'folder';
  }

  async function createNewAppLayout() {
    _ensureInitialized();
    _discardAppLayoutSetsForSingleLayout();
    if (typeof showStatus === 'function') showStatus('レイアウト追加は廃止されています', true);
    return null;
  }

  function _uniqueCustomLayoutName(baseName) {
    const base = String(baseName || 'レイアウト').trim() || 'レイアウト';
    const names = new Set(Object.entries(_loadAppLayouts())
      .map(([, record]) => record?.label)
      .filter(Boolean));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }

  async function renameAppLayout(appId) {
    _ensureInitialized();
    return false;
  }

  async function duplicateAppLayout(appId) {
    _ensureInitialized();
    return null;
  }

  function _applyRecordIfActive(appId, record) {
    return false;
  }

  function resetAppLayoutToDefault(appId) {
    _ensureInitialized();
    return false;
  }

  function saveCurrentAsAppLayoutDefault(appId) {
    _ensureInitialized();
    return false;
  }

  function deleteAppLayout(appId) {
    _ensureInitialized();
    return false;
  }

  function _showAppLayoutMenu(event, appId, anchorEl) {
    return false;
  }

  function showFileTypeBindingModal(appId) {
    _ensureInitialized();
    if (typeof showStatus === 'function') showStatus('ファイル形式ごとのレイアウト切り替えは廃止されています', true);
    return false;
  }

  function autoApplyAppLayoutForType(type, options) {
    _ensureInitialized();
    syncButtons();
    return false;
  }

  function setAppLayoutIcon(appId, iconName) {
    _ensureInitialized();
    return false;
  }

  function pickAppLayoutIcon(appId, anchorEl) {
    _ensureInitialized();
    return false;
  }

  return {
    APP_LAYOUTS,
    applyAppLayout,
    syncButtons,
    getLayoutSource,
    setLayoutSource,
    getCurrentAppLayoutId,
    getLastSelectedAppLayoutId,
    getAppLayoutIdForType,
    getFileTypesForAppLayout,
    setFileTypeBinding,
    clearFileTypeBinding,
    inferAppLayoutFromCurrent,
    autoApplyAppLayoutForType,
    saveCurrentAppLayout: _persistCurrentAppLayout,
    createNewAppLayout,
    getFilterStateForAppLayout,
    saveFilterStateForAppLayout,
    saveCurrentFilterState,
    setAppLayoutIcon,
    pickAppLayoutIcon,
    listAppLayouts,
    renameAppLayout,
    duplicateAppLayout,
    resetAppLayoutToDefault,
    deleteAppLayout,
    showFileTypeBindingModal,
    saveCurrentAsAppLayoutDefault,
    captureLayoutStorageSnapshot: _captureLayoutStorageSnapshot,
    restoreLayoutStorageSnapshot: _restoreLayoutStorageSnapshot,
    pushLayoutStorageHistory: _pushLayoutStorageHistory,
  };
})();

window.applyAppLayout = function(appId) {
  const result = GBAppLayouts.applyAppLayout(appId);
  window.MeldexCloudMobile?.afterLayoutApplied?.();
  return result;
};

window.createNewAppLayout = function() {
  return GBAppLayouts.createNewAppLayout();
};

window.renameAppLayout = function(appId) {
  return GBAppLayouts.renameAppLayout(appId);
};

window.duplicateAppLayout = function(appId) {
  return GBAppLayouts.duplicateAppLayout(appId);
};

window.resetAppLayoutToDefault = function(appId) {
  return GBAppLayouts.resetAppLayoutToDefault(appId);
};

window.deleteAppLayout = function(appId) {
  return GBAppLayouts.deleteAppLayout(appId);
};

window.pickAppLayoutIcon = function(appId, anchorEl) {
  return GBAppLayouts.pickAppLayoutIcon(appId, anchorEl);
};

window.pickCurrentAppLayoutIcon = function(anchorEl) {
  const appId = GBAppLayouts.getCurrentAppLayoutId?.() || GBAppLayouts.inferAppLayoutFromCurrent?.() || '';
  if (!appId) return null;
  return GBAppLayouts.pickAppLayoutIcon(appId, anchorEl);
};

window.showAppLayoutFileTypeBindingModal = function(appId) {
  return GBAppLayouts.showFileTypeBindingModal(appId);
};

function _autoSaveCurrentAppLayout() {
  return false;
}

// レイアウト関連のローカル設定をすべて初期化する（設定画面の「レイアウトを初期化」）
async function resetLayoutToDefault() {
  const layoutKeys = [
    'gb:layout', 'gb:layout:active-pane', 'gb:app-layouts', 'gb:app-layout-active', 'gb:layout-source',
    'gb:app-layout-type-bindings',
    'lastView', 'detail-panel-cfg',
    'sidebar-width', 'right-panel-width',
    'folder-layout', 'folder-zoom',
    'gb:cal-sidebar-width', 'outliner-expanded', 'global-filter',
    'tree-search-include-entities', 'gb:filter-bar-visible',
  ];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('sidebar-section-') || k.startsWith('fv-panel-cfg:'))) {
      layoutKeys.push(k);
    }
  }
  const before = typeof GBAppLayouts?.captureLayoutStorageSnapshot === 'function'
    ? GBAppLayouts.captureLayoutStorageSnapshot(layoutKeys)
    : null;
  let restoredDefaultLayout = false;
  if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.resetDefaultLayout === 'function') {
    restoredDefaultLayout = await GBPaneBridge.resetDefaultLayout({ skipHistory: true }) === true;
  }
  if (!restoredDefaultLayout && typeof GBLayout !== 'undefined' && typeof GBLayout.resetLayout === 'function') {
    restoredDefaultLayout = await GBLayout.resetLayout({ skipHistory: true }) === true;
  }
  if (!restoredDefaultLayout) {
    if (typeof showStatus === 'function') {
      showStatus('編集中の画面を保存できなかったため、レイアウトを初期化しませんでした', true);
    }
    return false;
  }
  try {
    // flushとdefault layout適用が完了してから、旧storageだけを削除する。
    layoutKeys.forEach((k) => localStorage.removeItem(k));
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('sidebar-section-') || k.startsWith('fv-panel-cfg:'))) {
        localStorage.removeItem(k);
      }
    }
    if (typeof GBAppLayouts?.setLayoutSource === 'function') GBAppLayouts.setLayoutSource('custom');
    else localStorage.setItem('gb:layout-source', 'custom');
    if (typeof GBLayout !== 'undefined' && typeof GBLayout.saveLayout === 'function') {
      await Promise.resolve(GBLayout.saveLayout({ immediate: true }));
    }
  } catch (error) {
    let rollbackFailed = false;
    try {
      if (before && typeof GBAppLayouts?.restoreLayoutStorageSnapshot === 'function') {
        await GBAppLayouts.restoreLayoutStorageSnapshot(before);
      }
    } catch (_) {
      rollbackFailed = true;
    }
    if (typeof showStatus === 'function') {
      showStatus(
        'レイアウト設定の初期化に失敗しました'
          + (rollbackFailed ? '。保存前状態を自動復元できませんでした' : ''),
        true,
      );
    }
    return false;
  }
  if (typeof GBAppLayouts?.syncButtons === 'function') GBAppLayouts.syncButtons();
  if (before && typeof GBAppLayouts?.pushLayoutStorageHistory === 'function') {
    GBAppLayouts.pushLayoutStorageHistory(
      'レイアウト: 全体初期化',
      before,
      GBAppLayouts.captureLayoutStorageSnapshot(layoutKeys),
      '設定画面'
    );
  }
  if (typeof showStatus === 'function') showStatus('レイアウトを初期化しました');
  return true;
}
