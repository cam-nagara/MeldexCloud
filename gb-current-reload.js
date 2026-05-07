/* gb-current-reload.js: アクティブなアプリ表示をディスク上の最新状態へ再読み込み */
(function () {
  'use strict';

  const DB_VIEW_TYPES = new Set(['database', 'db', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form']);
  const LEGACY_CONTAINER_IDS = {
    board: 'bd-canvas',
    folder: 'folder-view',
    page: 'page-view',
    entity: 'entity-view',
    media: 'media-view',
    csv: 'csv-view',
    html: 'html-view',
    'smart-db': 'db-view-container',
    database: 'db-view-container',
    db: 'db-view-container',
    pivot: 'db-view-container',
    gallery: 'db-view-container',
    kanban: 'db-view-container',
    timeline: 'db-view-container',
    chart: 'db-view-container',
    graph: 'db-view-container',
    form: 'db-view-container',
  };

  function _activePaneId() {
    return (typeof GBLayout !== 'undefined' && GBLayout.activePane) ? GBLayout.activePane : '';
  }

  function _tabFromPaneId(paneId) {
    if (!paneId || typeof GBTabs === 'undefined' || typeof GBTabs.getActiveTab !== 'function') return null;
    try { return GBTabs.getActiveTab(paneId); } catch { return null; }
  }

  function _tabFromEvent(event) {
    const paneEl = event?.target?.closest?.('.gb-pane[data-pane-id]');
    return _tabFromPaneId(paneEl?.dataset?.paneId || '') || null;
  }

  function _currentTab(event) {
    return _tabFromEvent(event) || _tabFromPaneId(_activePaneId());
  }

  function _tabPath(tab) {
    const state = tab?.state || {};
    return tab?.path || state.boardPath || state.folderPath || state.pagePath || state.scenarioPath
      || state.csvPath || state.dbPath || state.smartDbPath || state.mediaPath || state.calendarPath || '';
  }

  function _tabLabel(tab, path) {
    const raw = tab?.label || tab?.state?.label || '';
    if (raw) return raw;
    return String(path || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || '';
  }

  function _bridgeOpts() {
    return {
      bridgeLoad: true,
      skipGlobalUi: true,
      skipHistoryScope: true,
      skipNavPush: true,
      skipRecent: true,
      skipAutoVersion: true,
      skipSaveLastView: true,
      skipHighlight: true,
    };
  }

  function _clearLegacyDataset(type) {
    const id = LEGACY_CONTAINER_IDS[type] || '';
    const el = id ? document.getElementById(id) : null;
    if (!el?.dataset) return;
    delete el.dataset.gbLegacyPath;
    delete el.dataset.gbLegacyView;
  }

  async function _reloadComponent(tab) {
    if (!tab?.id || typeof getComponentInstance !== 'function') return false;
    const component = getComponentInstance(tab.id);
    if (!component || typeof component.reload !== 'function') return false;
    const result = await component.reload();
    return result !== false;
  }

  async function _reloadLegacyTab(tab, path, label) {
    const type = tab?.type || '';
    const opts = _bridgeOpts();
    _clearLegacyDataset(type);
    if (type === 'folder' && typeof openFolder === 'function') return openFolder(label, path, opts);
    if (type === 'page' && typeof openPage === 'function') return openPage(label, path, opts);
    if (type === 'entity' && typeof selectEntity === 'function') return selectEntity(path, opts);
    if (type === 'media' && typeof openMedia === 'function') return openMedia(label, path, tab?.state?.mediaType || 'image', opts);
    if (type === 'csv' && typeof openCsvFile === 'function') return openCsvFile(label, path, opts);
    if (type === 'smart-db' && typeof openSmartDbFile === 'function') return openSmartDbFile(label, path, opts);
    if (type === 'board' && typeof openBoard === 'function') return openBoard(label, path, opts);
    if (type === 'html' && typeof openViewer === 'function') {
      openViewer(tab?.state?.urlExternal ? path : '/viewer?file=' + encodeURIComponent(path), opts);
      return true;
    }
    if (DB_VIEW_TYPES.has(type) && typeof selectDatabase === 'function') return selectDatabase(path, null, opts);
    if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.refreshPaneAfterTabSwitch === 'function') {
      GBPaneBridge.refreshPaneAfterTabSwitch(_activePaneId(), { force: true });
      return true;
    }
    return false;
  }

  async function reloadCurrentOpenFile(event) {
    const tab = _currentTab(event);
    if (!tab) {
      if (typeof showStatus === 'function') showStatus('再読み込みできるファイルがありません', true);
      return false;
    }
    const path = _tabPath(tab);
    const label = _tabLabel(tab, path);
    try {
      const handled = await _reloadComponent(tab) || (path ? await _reloadLegacyTab(tab, path, label) : false);
      if (!handled) {
        if (typeof showStatus === 'function') showStatus('この表示は再読み込み対象ではありません', true);
        return false;
      }
      if (typeof showStatus === 'function') showStatus('再読み込みしました');
      return true;
    } catch (error) {
      if (typeof showStatus === 'function') showStatus('再読み込みに失敗: ' + (error?.message || error), true);
      return false;
    }
  }

  window.reloadCurrentOpenFile = reloadCurrentOpenFile;
})();
