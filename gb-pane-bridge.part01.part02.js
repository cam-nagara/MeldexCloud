    "toggleRightPanelTab('preview')": 'preview',
    "openCurrentVersionsTab()":       'version',
  };
  function _syncToolButtonStates() {
    for (const [action, type] of Object.entries(_toolActionToType)) {
      document.querySelectorAll('button[data-action="' + action + '"]').forEach(btn => {
        let exists = false;
        if (type === 'version' && typeof GBLayout.getAllPanes === 'function') {
          exists = GBLayout.getAllPanes(GBLayout.root).some((pane) => (pane.tabs || []).some((tab) => tab.type === 'version'));
        } else {
          exists = !!GBTabs.findPaneWithTab(type, '');
        }
        btn.classList.toggle('active', exists);
      });
    }
  }

  function _paneHasVisibleManagedView(type) {
    if (!type) return false;
    const containerId = LEGACY_CONTAINERS[type];
    if (containerId) {
      const paneId = _containerPane[containerId] || '';
      return !!(paneId && typeof _isPaneActuallyVisible === 'function' && _isPaneActuallyVisible(paneId));
    }
    if (!COMPONENT_TYPES.has(type) || typeof GBLayout?.getAllPanes !== 'function') return false;
    return GBLayout.getAllPanes(GBLayout.root).some(pane => {
      const tab = pane?.tabs?.[pane.activeTabIndex];
      return tab?.type === type && (typeof _isPaneActuallyVisible !== 'function' || _isPaneActuallyVisible(pane.id));
    });
  }

  // アクティブペインのアクティブタブのtypeをstate.viewに同期する
  function _syncStateView() {
    let newView = null;
    const isPaneManagedType = (type) => !!(type && (LEGACY_CONTAINERS[type] || COMPONENT_TYPES.has(type)));
    const isWorkManagedType = (type) => isPaneManagedType(type) && !_isToolbarUtilityView(type);
    // まずアクティブペインのタブをチェック
    const paneId = GBLayout.activePane;
    if (paneId) {
      const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
      if (paneInfo) {
        const activeTab = paneInfo.node.tabs?.[paneInfo.node.activeTabIndex];
        if (isWorkManagedType(activeTab?.type)) {
          newView = activeTab.type;
        }
      }
    }
    // ツールペイン等の場合: 全ペインからメインコンテンツを探す
    if (!newView && isWorkManagedType(state.view) && _paneHasVisibleManagedView(state.view)) {
      newView = state.view;
    }
    if (!newView) {
      for (const p of GBLayout.getAllPanes(GBLayout.root)) {
        const tab = p.tabs?.[p.activeTabIndex];
        if (isWorkManagedType(tab?.type)) { newView = tab.type; break; }
      }
    }
    if (newView) {
      if (newView !== state.view) state.view = newView;
      _updateToolbars(newView);
    } else if (!newView) {
      _updateToolbars('');
    }
  }

  // ペインのアクティブ切替時にstate.viewを同期
  function _onActivePaneChange(paneId, prevPaneId) {
    if (_bridgeUpdating) return;
    _mountAllPanes();
    _syncStateView();
    _mountFloatingAnnotationUi();
    if (typeof navNavigating !== 'undefined' && navNavigating) return;
    _syncDetailForActivePane(paneId);
  }

  // アクティブペインに応じて詳細パネル・ビューワーを同期
  // サイドバー・詳細・ビューワー・右パネルツール等のユーティリティペインは同期対象外
  const _DETAIL_SYNC_SKIP_TYPES = new Set(Object.keys(PANEL_CONTAINERS).concat(Object.keys(RP_CONTAINERS)));
  const _DETAIL_SYNC_SKIP_COMPONENT_TYPES = new Set(['version', 'search', 'timer']);
  const _DETAIL_DB_VIEW_TYPES = new Set(['database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db']);
  const _DETAIL_FILE_INFO_TYPES = new Set(['media', 'html', 'csv']);
  const _DETAIL_GLOBAL_TYPES = new Set(['page', 'entity', 'folder', 'board']);
  let _lastDetailContentPaneId = null;
  let _detailClearJob = 0;

  function _detailPaneActiveTab(paneId) {
    if (!paneId) return null;
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    const pane = paneInfo?.node || null;
    return pane?.tabs?.[pane.activeTabIndex] || null;
  }

  function _detailNormalizeTabType(tab) {
    const raw = tab?.type || '';
    return (typeof _normalizeDbPaneView === 'function') ? _normalizeDbPaneView(raw) : raw;
  }

  function _detailFileStyleContextForTab(tab) {
    const type = _detailNormalizeTabType(tab);
    if (type === 'page') return 'page';
    if (type === 'folder') return 'folder';
    if (_DETAIL_DB_VIEW_TYPES.has(type)) return 'db';
    if (type === 'board') return 'board';
    if (type === 'scriptnote') return 'scriptnote';
    if (type === 'calendar') return 'calendar';
    return '';
  }

  function _detailTabMatchesState(tab) {
    const st = (typeof state !== 'undefined') ? state : null;
    if (!st || !tab) return false;
    const type = _detailNormalizeTabType(tab);
    const view = (typeof _normalizeDbPaneView === 'function') ? _normalizeDbPaneView(st.view || '') : (st.view || '');
    const path = tab.path || '';
    if (path) {
      if (type === 'page' && path === st.currentPagePath) return true;
      if (type === 'entity' && path === st.currentEntityPath) return true;
      if (type === 'board' && path === st.currentBoardPath) return true;
      if (_DETAIL_DB_VIEW_TYPES.has(type) && (path === st.currentDbPath || path === st.currentSmartDb?._filePath)) return true;
    }
    return !!view && type === view;
  }

  function _detailPaneHasVisibleTab(detailPane, selector) {
    return [...(detailPane?.querySelectorAll?.(selector) || [])].some(t => !t.hidden);
  }

  function _detailPaneLooksStaleForTab(tab) {
    const detailPane = document.getElementById('rp-detail');
    if (!detailPane || !detailPane.closest('.gb-pane-content')) return false;
    const type = _detailNormalizeTabType(tab);
    const expectedCtx = _detailFileStyleContextForTab(tab);
    const styleBody = detailPane.querySelector('#detail-tab-file-style');
    const currentCtx = styleBody?.dataset?.fileStyleContext || '';
    const activeDetailTab = detailPane.querySelector('#detail-tab-bar .gb-inner-tab-active, #detail-tab-bar .active')?.dataset?.detailTab || '';
    const fileStyleVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-file-style');
    const calendarVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-calendar');
    const scriptnoteVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-scriptnote');
    const boardVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-board, .detail-tab-board-note, .detail-tab-board-style');
    const publishVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-publish');
    const tagManagementVisible = _detailPaneHasVisibleTab(detailPane, '.detail-tab-tag-management');
    const publishAllowed = new Set(['page', 'calendar', 'csv', 'smart-db']).has(type) || _DETAIL_DB_VIEW_TYPES.has(type);
    if (type !== 'calendar' && calendarVisible) return true;
    if (type !== 'scriptnote' && scriptnoteVisible) return true;
    if (type !== 'board' && boardVisible) return true;
    if (!publishAllowed && publishVisible) return true;
    if (type !== 'folder' && tagManagementVisible) return true;
    if (expectedCtx && activeDetailTab === 'file-style' && currentCtx !== expectedCtx) return true;
    if (expectedCtx && fileStyleVisible && currentCtx !== expectedCtx) return true;
    if (!expectedCtx && fileStyleVisible) return true;
    return false;
  }

  function _isDetailSyncSourcePane(paneId) {
    const tab = _detailPaneActiveTab(paneId);
    return !!tab && !_shouldSkipDetailSyncForTab(tab);
  }

  function _shouldSkipDetailSyncForTab(tab) {
    if (!tab) return true;
    if (_DETAIL_SYNC_SKIP_TYPES.has(tab.type)) return true;
    if (_DETAIL_SYNC_SKIP_COMPONENT_TYPES.has(tab.type)) return true;
    return false;
  }

  function _findDetailSyncSourcePane(excludePaneId) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return null;
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    const visibleSources = panes.filter(pane => {
      if (!pane || pane.id === excludePaneId) return false;
      if (typeof _isPaneActuallyVisible === 'function' && !_isPaneActuallyVisible(pane.id)) return false;
      return _isDetailSyncSourcePane(pane.id);
    });
    const stateMatch = visibleSources.find(pane => _detailTabMatchesState(_detailPaneActiveTab(pane.id)));
    if (stateMatch) return stateMatch.id;
    const last = visibleSources.find(pane => pane.id === _lastDetailContentPaneId);
    if (last) return last.id;
    return visibleSources[0]?.id || null;
  }

  function _clearDetailPaneShell() {
    return _clearDetailPaneShellAfterSave(null);
  }

  function _cancelDetailPaneClearJob() {
    _detailClearJob += 1;
  }

  function _clearDetailPaneShellAfterSave(afterClear) {
    const detailPane = document.getElementById('rp-detail');
    if (!detailPane || !detailPane.closest('.gb-pane-content')) return true;
    const jobId = ++_detailClearJob;
    const clearNow = () => {
      if (jobId !== _detailClearJob) return false;
      if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailPane);
      if (typeof showNoteTabs === 'function') showNoteTabs(false);
      if (typeof showDbTabs === 'function') showDbTabs(false);
      if (typeof showBoardTabs === 'function') showBoardTabs(false);
      if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
      if (typeof showFileStyleTab === 'function') showFileStyleTab(false);
      if (typeof showPublishDetailTab === 'function') showPublishDetailTab(false);
      if (typeof showTagManagementTab === 'function') showTagManagementTab(false);
      if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
      if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
      if (typeof switchDetailTab === 'function') switchDetailTab(null);
      if (typeof _removeStaleDpEditables === 'function') _removeStaleDpEditables(detailPane);
      else detailPane.querySelectorAll('#dp-editable').forEach(n => n.remove());
      ['#detail-tab-note-editor', '#detail-tab-db-property-settings', '#detail-tab-file-style', '#detail-tab-calendar-today', '#detail-tab-calendar-settings', '#detail-tab-calendar-production', '#detail-tab-publish', '#detail-tab-tag-management'].forEach(selector => {
        const el = detailPane.querySelector(selector);
        if (el) el.innerHTML = '';
      });
      const titleEl = detailPane.querySelector('#split-right-title');
      if (titleEl) titleEl.textContent = '';
      if (typeof afterClear === 'function') afterClear();
      return true;
    };
    if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailPane);
    if (typeof _dpSavePending === 'function') {
      const saveResult = _dpSavePending();
      if (saveResult && typeof saveResult.then === 'function') {
        saveResult.then(ok => { if (ok !== false) clearNow(); }).catch(() => {});
        return false;
      }
      if (saveResult === false) return false;
    }
    return clearNow();
  }

  function _syncDetailForActivePane(paneId, options) {
    if (!paneId) return;
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    if (!paneInfo) return;
    const activeTab = paneInfo.node.tabs?.[paneInfo.node.activeTabIndex];
    if (!activeTab) return;
    // ユーティリティペイン（詳細パネル、ビューワー、チャット等）のアクティブ化では
    // 既存の詳細パネル内容を保持する（ユーザーが作業コンテンツを見ながら
    // オプションを参照できる状態を壊さない）
    if (_shouldSkipDetailSyncForTab(activeTab)) {
      if (options?.fromUtilityPane) return;
      const sourcePaneId = _findDetailSyncSourcePane(paneId);
      const sourceTab = _detailPaneActiveTab(sourcePaneId);
      if (sourcePaneId && _detailPaneLooksStaleForTab(sourceTab)) {
        _syncDetailForActivePane(sourcePaneId, { fromUtilityPane: true });
      }
      return;
    }
    _cancelDetailPaneClearJob();
    _lastDetailContentPaneId = paneId;
    // ToolComponent型: コンポーネントの _syncDetailPanel を呼ぶ
    if (COMPONENT_TYPES.has(activeTab.type)) {
      const comp = getComponentInstance(activeTab.id);
      if (comp && typeof comp._syncDetailPanel === 'function') comp._syncDetailPanel();
      else _clearDetailPaneShell();
      _updatePreviewPane(false);
      return;
    }
    // 非scriptnote型: グローバル _syncDetailPanel 経由で詳細パネルを同期
    const type = activeTab.type;
    const label = activeTab.label || '';
    const path = activeTab.path || '';
    if (_DETAIL_DB_VIEW_TYPES.has(type)) {
      if (typeof _syncDetailPanel === 'function') _syncDetailPanel(label, path, 'database');
    } else if (_DETAIL_GLOBAL_TYPES.has(type)) {
      if (typeof _syncDetailPanel === 'function') _syncDetailPanel(label, path, type);
    } else if (_DETAIL_FILE_INFO_TYPES.has(type) && path && typeof _showFileInfoInDetailPanel === 'function') {
      // 保存失敗・拒否で clearNow が走らなかった場合でも file-info は必ず描画する
      const cleared = _clearDetailPaneShellAfterSave(() => _showFileInfoInDetailPanel(path));
      if (cleared === false) {
        // save の Promise が解決して afterClear が走るのを待つ余地を与えてから、
        // それでも描画されていない場合のみフォールバック描画する（二重 fetch 防止）
        setTimeout(() => {
          const detailPane = document.getElementById('rp-detail');
          if (!detailPane) return;
          // file-info が描画済みかどうかは hydrate ターゲット属性で判定
          const already = detailPane.querySelector('[data-global-tags-target-path]');
          if (already) return;
          try { _showFileInfoInDetailPanel(path); } catch {}
        }, 150);
      }
    } else {
      // welcome / compare / search 等: 前のアプリ固有オプションを残さない
      _clearDetailPaneShell();
    }
    // ビューワーも同期
    _updatePreviewPane(false);
  }

  // ================================================================
  // 全ペインにコンテンツをマウント
  // ================================================================
  function _mountAllPanes() {
    const allPanes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }).slice().sort((a, b) => {
