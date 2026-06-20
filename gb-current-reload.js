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

  function _paneIdFromEvent(event) {
    const paneEl = event?.target?.closest?.('.gb-pane[data-pane-id]');
    return paneEl?.dataset?.paneId || '';
  }

  function _tabFromEvent(event) {
    return _tabFromPaneId(_paneIdFromEvent(event)) || null;
  }

  function _currentTarget(event) {
    const eventPaneId = _paneIdFromEvent(event);
    const eventTab = _tabFromEvent(event);
    if (eventTab) return { tab: eventTab, paneId: eventPaneId };
    const paneId = _activePaneId();
    return { tab: _tabFromPaneId(paneId), paneId };
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

  function _bridgeOpts(paneId) {
    return {
      paneId: paneId || '',
      bridgeLoad: true,
      skipGlobalUi: true,
      skipHistoryScope: true,
      skipNavPush: true,
      skipRecent: true,
      skipAutoVersion: true,
      skipSaveLastView: true,
      skipHighlight: true,
      forceRefresh: true,
    };
  }

  async function _withTargetPane(paneId, fn) {
    if (paneId && typeof GBLayout !== 'undefined' && typeof GBLayout.setActivePane === 'function' && GBLayout.activePane !== paneId) {
      GBLayout.setActivePane(paneId, { sync: true });
    }
    return fn();
  }

  async function _handled(call) {
    const result = await call();
    return result !== false;
  }

  async function _flushPendingEditorBeforeReload(type) {
    if (type !== 'page' && type !== 'entity') return;
    if (typeof flushPendingEditorAutosave !== 'function') return;
    await Promise.resolve(flushPendingEditorAutosave()).catch(() => {});
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

  async function _reloadLegacyTab(tab, path, label, paneId) {
    const type = tab?.type || '';
    const opts = _bridgeOpts(paneId);
    _clearLegacyDataset(type);
    return _withTargetPane(paneId, async () => {
      await _flushPendingEditorBeforeReload(type);
      if (type === 'folder' && typeof openFolder === 'function') return _handled(() => openFolder(label, path, opts));
      if (type === 'page' && typeof openPage === 'function') return _handled(() => openPage(label, path, opts));
      if (type === 'entity' && typeof selectEntity === 'function') return _handled(() => selectEntity(path, opts));
      if (type === 'media' && typeof openMedia === 'function') return _handled(() => openMedia(label, path, tab?.state?.mediaType || 'image', opts));
      if (type === 'csv' && typeof openCsvFile === 'function') return _handled(() => openCsvFile(label, path, opts));
      if (type === 'smart-db' && typeof openSmartDbFile === 'function') return _handled(() => openSmartDbFile(label, path, opts));
      if (type === 'board' && typeof openBoard === 'function') return _handled(() => openBoard(label, path, opts));
      if (type === 'html' && tab?.state?.urlExternal && typeof openViewer === 'function') {
        openViewer(path, opts);
        return true;
      }
      if (type === 'html' && typeof openHtmlFile === 'function') return _handled(() => openHtmlFile(label, path, opts));
      if (type === 'html' && typeof openViewer === 'function') {
        openViewer('/viewer?file=' + encodeURIComponent(path), opts);
        return true;
      }
      if (DB_VIEW_TYPES.has(type) && typeof selectDatabase === 'function') return _handled(() => selectDatabase(path, typeof _currentPaneState === 'function' ? _currentPaneState() : null, opts));
      if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.refreshPaneAfterTabSwitch === 'function') {
        GBPaneBridge.refreshPaneAfterTabSwitch(paneId || _activePaneId(), { force: true });
        return true;
      }
      return false;
    });
  }

  async function reloadCurrentOpenFile(event) {
    const current = _currentTarget(event);
    const tab = current.tab;
    if (!tab) {
      if (typeof showStatus === 'function') showStatus('再読み込みできるファイルがありません', true);
      return false;
    }
    const path = _tabPath(tab);
    const label = _tabLabel(tab, path);
    try {
      const handled = await _reloadComponent(tab) || (path ? await _reloadLegacyTab(tab, path, label, current.paneId) : false);
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
