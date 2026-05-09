      if (a.id === GBLayout.activePane) return -1;
      if (b.id === GBLayout.activePane) return 1;
      return 0;
    });
    for (const pane of allPanes) {
      _mountPaneContent(pane);
    }
    window.MeldexStartupTabGuard?.pruneRestoredTabs?.();
  }

  function _mountPaneContent(pane, options) {
    const paneInfo = GBLayout.paneMap[pane.id];
    if (!paneInfo || !paneInfo.contentEl) return;
    if (!pane.tabs || pane.activeTabIndex < 0 || pane.activeTabIndex >= pane.tabs.length) return;

    const activeTab = pane.tabs[pane.activeTabIndex];
    const contentEl = paneInfo.contentEl;
    const tabType = activeTab.type;

    if (window.MeldexStartupTabGuard?.deferMount?.(pane, contentEl, activeTab, tabType, currentPane => _mountPaneContent(currentPane))) return;
    contentEl.querySelectorAll(':scope > .gb-startup-path-check').forEach(el => el.remove());

    // 非アクティブタブのコンポーネントをdeactivate
    pane.tabs.forEach((tab, i) => {
      if (i !== pane.activeTabIndex) {
        const comp = getComponentInstance(tab.id);
        if (comp && comp._active) comp.deactivate();
      }
    });

    // ToolComponent で描画するタイプ
    if (COMPONENT_TYPES.has(tabType)) {
      _retractLegacyFromPane(contentEl);
      let comp = getComponentInstance(activeTab.id);
      if (!comp) {
        const reg = TOOL_REGISTRY[tabType];
        if (reg && reg.cls) {
          comp = new reg.cls(pane.id, activeTab.id);
          comp.create();
          setComponentInstance(activeTab.id, comp);
        }
      }
      if (comp) {
        comp.paneId = pane.id;
        comp.tabId = activeTab.id;
        if (!comp._mounted || comp.el.parentNode !== contentEl) comp.mount(contentEl);
        if (activeTab.state && Object.keys(activeTab.state).length > 0) comp.restoreState(activeTab.state);
        // 非アクティブペインでは詳細パネル同期をスキップ
        const isActive = pane.id === GBLayout.activePane;
        comp._skipDetailSync = !isActive;
        comp.activate();
        comp._skipDetailSync = false;
      }
      return;
    }

    // パネルコンテナで描画するタイプ（サイドバー・詳細パネル）
    const panelContainerId = PANEL_CONTAINERS[tabType];
    if (panelContainerId) {
      const mountedLive = _mountLegacyLikeTab(pane, contentEl, activeTab, tabType, panelContainerId, options);
      // パネル固有の初期化（初回マウント時のみ）
      if (mountedLive && tabType === 'outliner' && typeof loadOutliner === 'function' && !_outlinerLoaded) {
        _outlinerLoaded = true;
        loadOutliner();
      }
      if (mountedLive && tabType === 'preview') _updatePreviewPane(true);
      return;
    }

    // 右パネルコンテナで描画するタイプ
    const rpContainerId = RP_CONTAINERS[tabType];
    if (rpContainerId) {
      const mountedLive = _mountLegacyLikeTab(pane, contentEl, activeTab, tabType, rpContainerId, options);
      // 初回マウント時の初期化
      if (mountedLive) _initRpTool(tabType, options);
      return;
    }

    // レガシーコンテナで描画するタイプ
    const containerId = LEGACY_CONTAINERS[tabType];
    if (!containerId) return;
    _mountLegacyLikeTab(pane, contentEl, activeTab, tabType, containerId, options);
  }

  function _mountLegacyLikeTab(pane, contentEl, tab, tabType, containerId, options) {
    // これから載せる containerId は退避対象から外す（同一コンテンツのまま active 切替時に
    // detach→reattach が発生して click 配信を阻害するのを防ぐ）。
    _retractLegacyFromPane(contentEl, containerId);
    contentEl.querySelectorAll('.gb-legacy-snapshot-host').forEach(el => el.remove());
    const ownerPaneId = _containerPane[containerId] || '';
    const ownerIsVisible = ownerPaneId ? _isPaneActuallyVisible(ownerPaneId) : false;
    const isDockPopupMount = !!options?.dockPopup;
    const isSubPanelMount = !!options?.subPanel || !!contentEl.closest?.('.gb-subpanel');
    const paneIsVisible = _isPaneActuallyVisible(pane.id);
    const canMountLive = isDockPopupMount || isSubPanelMount || (paneIsVisible && (!ownerPaneId || ownerPaneId === pane.id || pane.id === GBLayout.activePane || !ownerIsVisible));
    const bridgeOpts = pane.id === GBLayout.activePane ? _bridgeOpenOpts : _bridgePassiveOpenOpts;
    if (canMountLive && document.getElementById(containerId)) {
      _teardownSnapshotHost(tab.id);
      _showLegacyViewInPane(pane.id, contentEl, tabType, containerId, tab);
      _ensureLegacyTabContent(tab, tabType, containerId, bridgeOpts);
      return true;
    } else {
      _showLegacySnapshotInPane(pane.id, contentEl, tab, tabType);
      return false;
    }
  }

  // 右パネルツールの初期化（switchRightTabの初期化ロジックを再現）
  function _initRpTool(toolType, options) {
    if (toolType === 'chat') {
      const savedProvider = localStorage.getItem('chat-provider');
      const savedModel = localStorage.getItem('chat-model');
      if (savedProvider) {
        const sel = document.getElementById('chat-provider');
        if (sel) sel.value = savedProvider;
      }
      if (typeof updateChatModels === 'function') updateChatModels();
      if (savedModel) {
        const modelSel = document.getElementById('chat-model');
        if (modelSel && [...modelSel.options].some(o => o.value === savedModel)) {
          modelSel.value = savedModel;
        }
      }
      const isDockPopupMount = !!options?.dockPopup;
      const restoring = !isDockPopupMount && typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.restoreOnOpen === 'function'
        ? GBChatRestore.restoreOnOpen()
        : false;
      if (!isDockPopupMount && !restoring && !(typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.isRestoreSuspended === 'function' && GBChatRestore.isRestoreSuspended()) && typeof switchChatMode === 'function') {
        switchChatMode('team');
      }
    } else if (toolType === 'annotation') {
      if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
    } else if (toolType === 'sticky') {
      const type = document.getElementById('rp-ann-type');
      if (type) type.value = 'sticky';
      if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
    } else if (toolType === 'history') {
      if (typeof renderHistoryList === 'function') renderHistoryList();
    }
  }

  // ビューワーペインの更新（現在選択中のファイルをプレビュー）
  function _updatePreviewPane(forceRestore) {
    const pane = document.getElementById('gb-preview-pane');
    if (!pane) return;
    // キャンバスアクティブ時はミニマップを表示
    if (state.view === 'board' && typeof bdUpdateMinimap === 'function') {
      pane.dataset.previewMode = 'board';
      bdUpdateMinimap();
      return;
    }
    // キャンバス以外に切り替わった場合、ミニマップをクリア
    const oldMinimap = pane.querySelector('.bd-minimap');
    if (oldMinimap) pane.innerHTML = '';
    const activePreviewTab = (typeof _getActiveContentPaneInfo === 'function') ? _getActiveContentPaneInfo()?.activeTab : null;
    const activePreviewPath = activePreviewTab && !['preview', 'detail'].includes(activePreviewTab.type)
      ? (activePreviewTab.path || activePreviewTab.state?.scenarioPath || '')
      : '';
    // 再マウント時は保存済みパスを優先（最大化/復元でグローバルstateがずれる問題の対策）
    const mediaPath = forceRestore
      ? (pane.dataset.previewPath || '')
      : (activePreviewPath || state.currentPagePath || state.currentEntityPath || '');
    // 現在のパスを保存（次回再マウント用）
    if (mediaPath) pane.dataset.previewPath = mediaPath;
    if (forceRestore && pane.dataset.previewMode === 'board-link' && mediaPath && typeof bdRenderLinkedPreview === 'function') {
      bdRenderLinkedPreview(mediaPath, pane);
      return;
    }
    if (!mediaPath) {
      pane.innerHTML = '<div style="color:var(--fg2);font-size:13px;">ファイルを選択するとプレビューが表示されます</div>';
      return;
    }
    const ext = mediaPath.split('.').pop().toLowerCase();
    const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp'];
    if (imgExts.includes(ext)) {
      const url = (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/file-raw?path=' + encodeURIComponent(mediaPath);
      // 既存画像のsrcを更新（白フラッシュ防止）
      const existingImg = pane.querySelector('img');
      if (existingImg) {
        existingImg.src = url;
      } else {
        pane.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;" alt="preview">';
      }
    } else {
      const fname = document.createElement('div');
      fname.style.cssText = 'color:var(--fg2);font-size:13px;';
      fname.textContent = mediaPath.split('/').pop();
      pane.innerHTML = '';
      pane.appendChild(fname);
    }
  }

  const _ANNOTATION_HOST_TYPES = new Set([
    'database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db',
    'compare', 'entity', 'page', 'folder', 'media', 'html', 'csv',
    'board', 'scriptnote', 'calendar',
  ]);
  const _ANNOTATION_DB_HOST_TYPES = new Set([
    'database', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db',
  ]);
  let _lastAnnotationPaneId = '';

  function _normalizeDbPaneView(viewName) {
    return viewName === 'database' ? 'pivot' : viewName;
  }

  function _resolveDbPaneDisplayView(viewName, tab) {
    const normalizedViewName = _normalizeDbPaneView(viewName);
    if (!DB_SUB_VIEWS[normalizedViewName]) return normalizedViewName;
    if (normalizedViewName === 'smart-db') return 'smart-db';
    const dbPath = tab?.path || tab?.state?.dbPath || state.currentDbPath || '';
    const mode = (dbPath && typeof getCurrentViewMode === 'function') ? getCurrentViewMode(dbPath) : '';
    const resolvedMode = ['calendar', 'tasks', 'shifts'].includes(mode) ? 'timeline' : mode;
    return DB_SUB_VIEWS[resolvedMode] ? resolvedMode : normalizedViewName;
  }

  function _getActiveContentPaneInfo() {
    const paneId = _getContentPane(GBLayout.activePane);
    if (!paneId) return null;
    return _getPaneInfoById(paneId);
  }

  function _getPaneInfoById(paneId) {
    if (!paneId) return null;
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    const paneNode = paneInfo?.node || null;
    const activeTab = paneNode?.tabs?.[paneNode.activeTabIndex] || null;
    const contentEl = GBLayout.paneMap?.[paneId]?.contentEl || null;
    if (!paneNode || !activeTab || !contentEl) return null;
    return { paneId, paneNode, activeTab, contentEl };
  }

  function _getAnnotationTargetForTab(tab) {
    const rawType = tab?.type || '';
    const tabType = _normalizeDbPaneView(rawType);
    const statePath = (key) => (typeof state !== 'undefined' ? (state?.[key] || '') : '');
    const tabPath = (...keys) => {
      if (tab?.path) return tab.path;
      const tabState = tab?.state || {};
      for (const key of keys) {
        if (tabState[key]) return tabState[key];
      }
      return '';
    };
    if (tabType === 'scriptnote') return tabPath('scenarioPath', 'scriptnotePath') || '';
    if (tabType === 'board') return tabPath('boardPath') || statePath('currentBoardPath');
    if (tabType === 'calendar') return 'calendar:panel';
    if (_ANNOTATION_DB_HOST_TYPES.has(rawType) || _ANNOTATION_DB_HOST_TYPES.has(tabType)) {
      if (tabType === 'smart-db') {
        return tabPath('smartDbPath', 'dbPath') || statePath('currentSmartDb')?._filePath || statePath('currentDbPath');
      }
      return tabPath('dbPath') || statePath('currentDbPath');
    }
    if (tabType === 'folder') {
      return tabPath('folderPath') || (typeof _folderPath !== 'undefined' ? _folderPath : '') || '';
    }
    if (tabType === 'entity') return tabPath('entityPath') || statePath('currentEntityPath');
    if (tabType === 'page') return tabPath('pagePath') || statePath('currentPagePath');
    if (tabType === 'media' || tabType === 'html') return tabPath('mediaPath', 'pagePath') || statePath('currentPagePath');
    if (tabType === 'csv') return tabPath('csvPath') || (typeof _csvPath !== 'undefined' ? _csvPath : '');
    if (tabType === 'compare') {
      const left = tab?.state?.pathA || tab?.state?.leftPath || '';
      const right = tab?.state?.pathB || tab?.state?.rightPath || '';
      return tabPath('comparePath') || (left || right ? `compare:${left}|${right}` : '');
    }
    return '';
  }

  function _isUsableAnnotationPaneInfo(info) {
    if (!info || !_isPaneActuallyVisible(info.paneId)) return false;
    if (!_ANNOTATION_HOST_TYPES.has(info.activeTab?.type)) return false;
    return !!_getAnnotationTargetForTab(info.activeTab);
  }

  function _rememberAnnotationPaneInfo(info) {
    if (info?.paneId) _lastAnnotationPaneId = info.paneId;
    return info || null;
  }

  function _getAnnotationPaneInfos() {
    if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return [];
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    const infos = [];
    for (const pane of panes) {
      const info = _getPaneInfoById(pane?.id);
      if (_isUsableAnnotationPaneInfo(info)) infos.push(info);
    }
    return infos;
  }

  function _getAnnotationContentPaneInfo(preferredPaneId) {
    const pick = (paneId) => {
      const info = _getPaneInfoById(paneId);
      return _isUsableAnnotationPaneInfo(info) ? info : null;
    };
    for (const paneId of [preferredPaneId, GBLayout.activePane, _getContentPane(GBLayout.activePane), _lastAnnotationPaneId]) {
      const info = pick(paneId);
      if (info) return _rememberAnnotationPaneInfo(info);
    }
    return _rememberAnnotationPaneInfo(_getAnnotationPaneInfos()[0] || null);
  }

  function _getCurrentAnnotationTarget(preferredPaneId) {
    const info = _getAnnotationContentPaneInfo(preferredPaneId);
    return _getAnnotationTargetForTab(info?.activeTab) || '';
  }

  function _rememberAnnotationTargetForPane(paneId) {
    const info = _getAnnotationContentPaneInfo(paneId);
    return _getAnnotationTargetForTab(info?.activeTab) || '';
  }

  function _annotationFabButtonForPane(contentEl, paneId) {
    const buttons = contentEl?.querySelectorAll?.(':scope > .annotation-fab-mirror[data-annotation-fab-pane]') || [];
    return [...buttons].find(btn => btn.dataset.annotationFabPane === paneId) || null;
  }

  function _syncAnnotationFabMirrors(primaryPaneId) {
    const sourceButton = document.getElementById('btn-tb-annotation');
    const validPaneIds = new Set();
    for (const info of _getAnnotationPaneInfos()) {
      if (!info?.paneId || info.paneId === primaryPaneId) continue;
      validPaneIds.add(info.paneId);
      if (getComputedStyle(info.contentEl).position === 'static') info.contentEl.style.position = 'relative';
      let mirror = _annotationFabButtonForPane(info.contentEl, info.paneId);
      if (!mirror) {
        mirror = document.createElement('button');
        mirror.type = 'button';
        mirror.className = 'annotation-fab annotation-fab-mirror';
        mirror.title = sourceButton?.title || '注釈 (Alt+A)';
        mirror.setAttribute('aria-label', '注釈ツール');
        mirror.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          _activateAnnotationFabForPane(ev.currentTarget?.dataset?.annotationFabPane || '');
        });
        info.contentEl.appendChild(mirror);
      }
      mirror.dataset.annotationFabPane = info.paneId;
      mirror.dataset.e2eId = `annotation-fab-${info.paneId}`;
      mirror.innerHTML = sourceButton?.innerHTML || '';
      mirror.classList.remove('active');
      mirror.style.display = '';
    }
    document.querySelectorAll('.annotation-fab-mirror[data-annotation-fab-pane]').forEach(mirror => {
      const paneId = mirror.dataset.annotationFabPane || '';
      const hostPaneId = mirror.closest?.('.gb-pane')?.dataset?.paneId || '';
      if (!validPaneIds.has(paneId) || hostPaneId !== paneId) mirror.remove();
    });
  }

  function _activateAnnotationFabForPane(paneId) {
    const paneInfo = _getAnnotationContentPaneInfo(paneId);
    if (!paneInfo) return false;
    const toolbar = document.getElementById('ann-toolbar');
    const currentPaneId = document.getElementById('btn-tb-annotation')?.closest?.('.gb-pane')?.dataset?.paneId || '';
    if (toolbar?.classList?.contains('visible') && currentPaneId && currentPaneId !== paneInfo.paneId && typeof closeAnnotationToolbar === 'function') {
      closeAnnotationToolbar();
    }
    if (GBLayout.activePane !== paneInfo.paneId && typeof GBLayout.setActivePane === 'function') {
      GBLayout.setActivePane(paneInfo.paneId, { sync: true });
    }
    _mountFloatingAnnotationUi({ paneId: paneInfo.paneId });
    if (typeof toggleAnnotationToolbar === 'function') {
      toggleAnnotationToolbar();
      return true;
    }
    return false;
  }

  function _mountFloatingAnnotationUi(options = {}) {
    const storage = document.getElementById('legacy-views');
    const overlay = document.getElementById('ann-overlay');
    const button = document.getElementById('btn-tb-annotation');
    const paneInfo = _getAnnotationContentPaneInfo(options?.paneId || options?.preferredPaneId || '');
    const paneTarget = _getAnnotationTargetForTab(paneInfo?.activeTab);
    const activeView = _normalizeDbPaneView(paneInfo?.activeTab?.type || state.view);
    const nextTarget = paneTarget || ((typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : '');
    const hasUsableTarget = !!paneTarget;
    const host = (paneInfo && _ANNOTATION_HOST_TYPES.has(paneInfo.activeTab.type) && hasUsableTarget)
      ? paneInfo.contentEl
      : storage;
    if (!host) return;
    if (host !== storage) {
      const hostPosition = getComputedStyle(host).position;
      if (!hostPosition || hostPosition === 'static') host.style.position = 'relative';
    }

    [overlay, button].forEach(el => {
      if (!el) return;
      if (el.parentNode !== host) host.appendChild(el);
      // _retractLegacyFromPane が display:none を付けて storage へ退避するため、
      // host が表示先（contentEl）のときは display を解除して再表示する
      if (host !== storage) {
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });
    _syncAnnotationFabMirrors(host === storage ? '' : paneInfo?.paneId || '');
    if (host === storage) {
      document.querySelectorAll('.ann-note:not(.ann-note-embedded)').forEach(note => {
        if (note.parentNode !== host) host.appendChild(note);
      });
      return;
    }

    if (overlay) {
      overlay.style.width = '100%';
      overlay.style.height = '100%';
    }
    document.querySelectorAll('.ann-note:not(.ann-note-embedded)').forEach(note => {
      if (note.parentNode !== host) host.appendChild(note);
    });
    if (typeof _setupOverlayScroll === 'function') _setupOverlayScroll(activeView);
    if (typeof ann !== 'undefined' && typeof getAnnotationTarget === 'function') {
      if (nextTarget !== ann.targetPath) {
        ann.targetPath = nextTarget;
        const embedded = typeof _usesEmbeddedAnnotationSurface === 'function'
          && _usesEmbeddedAnnotationSurface(activeView);
        if (embedded) {
          const layer = document.getElementById('ann-layer');
          if (layer) layer.innerHTML = '';
          if (typeof _forEachStandaloneAnnotationNote === 'function') {
            _forEachStandaloneAnnotationNote(el => el.remove());
          }
        } else if (typeof loadAnnotations === 'function') {
          loadAnnotations();
        }
      }
    }
  }

  function _scheduleToolbarRecheck(viewName) {
    const run = () => {
      if (typeof _updateToolbars === 'function') _updateToolbars(viewName || state.view || '');
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 0);
  }

  // レガシーコンテナをペインに配置
  function _showLegacyViewInPane(paneId, contentEl, viewName, containerId, tab) {
    const viewEl = document.getElementById(containerId);
    if (!viewEl) return;
    const resolvedViewName = _resolveDbPaneDisplayView(viewName, tab);

    // 他のペインから奪う場合は退避
    if (_containerPane[containerId] && _containerPane[containerId] !== paneId) {
      _retractContainer(containerId);
    }

    // 既にこのペインにある場合はスキップ
    if (viewEl.parentNode !== contentEl) {
      contentEl.appendChild(viewEl);
    }
    _containerPane[containerId] = paneId;

    // DB系サブビュー切替
    if (containerId === 'db-view-container') {
      viewEl.style.display = 'flex';
      for (const [type, subId] of Object.entries(DB_SUB_VIEWS)) {
        const subEl = document.getElementById(subId);
        if (subEl) {
          const show = (type === resolvedViewName);
          subEl.style.display = show ? (type === 'pivot' || type === 'timeline' || type === 'smart-db' ? '' : 'flex') : 'none';
        }
      }
    } else {
      viewEl.style.display = 'flex';
    }
    if (viewEl.hasAttribute('aria-hidden')) viewEl.setAttribute('aria-hidden', 'false');
    try { if (viewEl.inert) viewEl.inert = false; } catch (e) {}

    if (tab) _bindLiveLegacyContainer(containerId, paneId, tab, viewName, viewEl);
    if (containerId === 'db-view-container') _scheduleToolbarRecheck(viewName);
  }

  // ペインからレガシーコンテナを退避（メインビュー＋右パネル両方）
  // exceptId を渡すと、その ID のコンテナだけは退避対象から外す（idempotent 化のため）。
  function _retractLegacyFromPane(contentEl, exceptId = null) {
    const storage = document.getElementById('legacy-views');
    if (!storage) return;
    const ids = new Set([
      ...Object.values(LEGACY_CONTAINERS),
      ...Object.values(RP_CONTAINERS),
      ...Object.values(PANEL_CONTAINERS),
      'ann-overlay',
      'btn-tb-annotation',
    ]);
    ids.forEach(id => {
      if (id === exceptId) return;
      const el = document.getElementById(id);
      if (el && el.parentNode === contentEl) {
        el.style.display = 'none';
        storage.appendChild(el);
        delete _containerPane[id];
      }
    });
  }

  function _retractContainer(containerId) {
    const storage = document.getElementById('legacy-views');
    const el = document.getElementById(containerId);
    if (el && storage) {
      el.style.display = 'none';
      storage.appendChild(el);
      delete _containerPane[containerId];
    }
  }

  // ================================================================
  // ナビゲーション用ペインタイプ（ファイルを開く先にならない）
  // ================================================================
  const NAV_PANE_TYPES = new Set(['outliner']);
  const PRIMARY_TOOL_PANE_TYPES = new Set(['chat', 'calendar', 'timer', 'history', 'annotation', 'sticky', 'search']);
  const TOOL_HOST_PANE_TYPES = new Set([...PRIMARY_TOOL_PANE_TYPES, 'version']);
  const FILE_OPEN_AVOID_PANE_TYPES = new Set([
    ...NAV_PANE_TYPES,
    ...PRIMARY_TOOL_PANE_TYPES,
    'detail',
    'preview',
    'version',
  ]);
  const FILE_SHOW_VIEW_TYPES = new Set(Object.keys(LEGACY_CONTAINERS).filter(type => type !== 'welcome'));
  const TOOLBAR_DB_VIEW_TYPES = new Set(['pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db']);
  const TOOLBAR_UTILITY_VIEW_TYPES = new Set([
    ...Object.keys(PANEL_CONTAINERS),
    ...Object.keys(RP_CONTAINERS),
    ...PRIMARY_TOOL_PANE_TYPES,
    'version',
  ]);
  const PASSIVE_TOOL_PANE_TYPES = new Set([
    'chat',
    'annotation',
    'sticky',
    'history',
    'detail',
    'preview',
    'search',
    'version',
    'timer',
  ]);

  function _isPassiveToolPaneTab(type, tab) {
    const rawType = type || tab?.type || '';
    const normalizedType = rawType === 'sticky' ? 'annotation' : rawType;
    if (normalizedType === 'calendar') return !tab?.path;
    return PASSIVE_TOOL_PANE_TYPES.has(normalizedType);
  }

  function _isPaneActuallyVisible(paneId) {
    if (!paneId) return false;
    const virtualEl = GBLayout?.paneMap?.[paneId]?.el || null;
    if (virtualEl?.closest?.('.gb-subpanel')) {
      const rect = virtualEl.getBoundingClientRect?.();
      return !virtualEl.hidden && !!rect && rect.width > 0 && rect.height > 0;
    }
    if (typeof GBLayout.isPaneVisible === 'function') return GBLayout.isPaneVisible(paneId);
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    return !!paneInfo?.node && !paneInfo.node.collapsed;
  }

  function _paneActiveType(pane) {
    const tab = pane?.tabs?.[pane.activeTabIndex];
    return tab?.type || '';
  }

  function _firstPaneMatching(panes, predicate) {
    for (const pane of (panes || [])) {
      if (predicate(pane)) return pane;
    }
    return null;
  }

  function _createFileOpenPaneNear(paneId) {
    if (typeof GBLayout === 'undefined' || typeof GBTabs === 'undefined') return null;
    const allPanes = typeof GBLayout.getAllPanes === 'function' ? GBLayout.getAllPanes(GBLayout.root) : [];
    const visiblePanes = allPanes.filter(pane => _isPaneActuallyVisible(pane.id));
    const sourcePane = _firstPaneMatching(visiblePanes, pane => pane.id === paneId && !pane.locked)
      || _firstPaneMatching(visiblePanes, pane => _paneActiveType(pane) === 'outliner' && !pane.locked)
      || _firstPaneMatching(visiblePanes, pane => !_isFileOpenPaneCandidate(pane) && !pane.locked)
      || _firstPaneMatching(allPanes, pane => _paneActiveType(pane) === 'outliner' && !pane.locked)
      || _firstPaneMatching(allPanes, pane => !pane.locked)
      || null;
    const tab = GBTabs.createTab('フォルダ', 'folder', '');
    const newPane = GBLayout.createPaneNode(null, [tab], 0);
    const historyOptions = {
      historyLabel: 'レイアウト: 作業パネルを作成',
      historyDetail: 'ファイルリンクを開く',
    };
    let newPaneId = null;
    if (sourcePane?.id) {
      const position = _paneActiveType(sourcePane) === 'outliner' ? 'right' : 'left';
      newPaneId = GBLayout.splitPane(sourcePane.id, 'horizontal', position, newPane, historyOptions);
    }
    if (!newPaneId && typeof GBLayout.splitRoot === 'function') {
      newPaneId = GBLayout.splitRoot('right', newPane, historyOptions);
    }
    if (newPaneId) {
      _expandCollapsedPane(newPaneId);
      GBLayout.setActivePane(newPaneId, { sync: true });
    }
    return newPaneId;
  }

  // アクティブペインがナビゲーション用ペインの場合、コンテンツペインを返す
  function _getContentPane(paneId) {
    if (!paneId) return paneId;
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    if (!paneInfo) return paneId;
    const pane = paneInfo.node;
    const activeTab = pane.tabs && pane.tabs[pane.activeTabIndex];
    const isVisible = _isPaneActuallyVisible(paneId);
    if (isVisible && (!activeTab || !FILE_OPEN_AVOID_PANE_TYPES.has(activeTab.type))) return paneId;

    const allPanes = GBLayout.getAllPanes(GBLayout.root);
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      const t = p.tabs && p.tabs[p.activeTabIndex];
      if (!t || !FILE_OPEN_AVOID_PANE_TYPES.has(t.type)) return p.id;
    }
    for (const p of allPanes) {
      if (p.id === paneId) continue;
      const t = p.tabs && p.tabs[p.activeTabIndex];
      if (!t || !FILE_OPEN_AVOID_PANE_TYPES.has(t.type)) return p.id;
    }
    for (const p of allPanes) {
      if (p.id !== paneId && _isPaneActuallyVisible(p.id)) return p.id;
    }
    for (const p of allPanes) {
      if (p.id !== paneId) return p.id;
    }
    return paneId;
  }

  function _isFileOpenPaneCandidate(pane, options) {
    if (!pane) return false;
    if (!options?.allowLocked && pane.locked) return false;
    const activeTab = pane.tabs && pane.tabs[pane.activeTabIndex];
    return !activeTab || !FILE_OPEN_AVOID_PANE_TYPES.has(activeTab.type);
  }

  function _isFileOpenFallbackPaneCandidate(pane, options) {
    if (!pane) return false;
    if (!options?.allowLocked && pane.locked) return false;
    const activeTab = pane.tabs && pane.tabs[pane.activeTabIndex];
    const type = activeTab?.type || '';
    if (NAV_PANE_TYPES.has(type) || type === 'detail' || type === 'preview') return false;
    if (!options?.allowChat && type === 'chat') return false;
    return true;
  }

  function _getFileOpenPane(paneId, options) {
    const opts = options || {};
    paneId = paneId || GBLayout.activePane || GBLayout.findFirstPane?.(GBLayout.root)?.id || '';
    if (!paneId) return opts.ensureWorkPane ? _createFileOpenPaneNear('') : _getContentPane(paneId);
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    const pane = paneInfo?.node || null;
    if (pane && _isPaneActuallyVisible(paneId) && _isFileOpenPaneCandidate(pane)) return paneId;

    const allPanes = GBLayout.getAllPanes(GBLayout.root);
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      if (_isFileOpenPaneCandidate(p)) return p.id;
    }
    for (const p of allPanes) {
      if (p.id === paneId) continue;
      if (_isFileOpenPaneCandidate(p)) return p.id;
    }
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      if (_isFileOpenPaneCandidate(p, { allowLocked: true })) return p.id;
    }
    for (const p of allPanes) {
      if (p.id === paneId) continue;
      if (_isFileOpenPaneCandidate(p, { allowLocked: true })) return p.id;
    }
    if (opts.ensureWorkPane) {
      const ensuredPaneId = _createFileOpenPaneNear(paneId);
      if (ensuredPaneId) return ensuredPaneId;
    }
    if (opts.fileOpenOnly) return null;
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      if (_isFileOpenFallbackPaneCandidate(p)) return p.id;
    }
    if (pane && _isPaneActuallyVisible(paneId) && _isFileOpenFallbackPaneCandidate(pane)) return paneId;
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      if (_isFileOpenFallbackPaneCandidate(p, { allowChat: true })) return p.id;
    }
    if (pane && _isPaneActuallyVisible(paneId) && _isFileOpenFallbackPaneCandidate(pane, { allowChat: true })) return paneId;
    for (const p of allPanes) {
      if (p.id === paneId) continue;
      if (_isFileOpenFallbackPaneCandidate(p, { allowLocked: true })) return p.id;
    }
    if (pane && _isFileOpenFallbackPaneCandidate(pane, { allowLocked: true })) return paneId;
    return null;
  }

  function _activateFileOpenPane(options) {
    const paneId = _getFileOpenPane(options?.paneId || GBLayout.activePane, { ensureWorkPane: true });
    if (!paneId) return null;
    _expandCollapsedPane(paneId);
    if (GBLayout.activePane !== paneId) GBLayout.setActivePane(paneId, { sync: true });
    return paneId;
  }

  function _getViewHostPane(viewName) {
    if (!FILE_SHOW_VIEW_TYPES.has(viewName)) return _getContentPane(GBLayout.activePane);
    return _getFileOpenPane(GBLayout.activePane, { ensureWorkPane: true });
  }

  function _isToolbarUtilityView(viewName) {
    return TOOLBAR_UTILITY_VIEW_TYPES.has(viewName);
  }

  function _toolbarViewForTab(tab) {
    const rawType = tab?.type || '';
    if (!rawType || _isToolbarUtilityView(rawType)) return '';
    const normalizedType = _normalizeDbPaneView(rawType);
    if (TOOLBAR_DB_VIEW_TYPES.has(normalizedType)) return _resolveDbPaneDisplayView(rawType, tab);
    return normalizedType;
  }

  function _getToolbarContentContext(viewName) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return null;
    const activePaneId = GBLayout.activePane || '';
    const paneIds = [];
    const seen = new Set();
    const pushPaneId = (paneId) => {
      if (!paneId || seen.has(paneId)) return;
      seen.add(paneId);
      paneIds.push(paneId);
    };

    if (!_isToolbarUtilityView(viewName)) pushPaneId(activePaneId);
    pushPaneId(_getFileOpenPane(activePaneId));
    pushPaneId(_getContentPane(activePaneId));
    pushPaneId(_containerPane['db-view-container']);
    pushPaneId(_lastDetailContentPaneId);

    const panes = typeof GBLayout.getAllPanes === 'function'
      ? GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || []
      : [];
    panes.filter(pane => _isPaneActuallyVisible(pane.id)).forEach(pane => pushPaneId(pane.id));
    panes.forEach(pane => pushPaneId(pane.id));

    for (const paneId of paneIds) {
      const info = _getPaneInfoById(paneId);
      const toolbarView = _toolbarViewForTab(info?.activeTab);
      if (info && toolbarView) return { ...info, viewName: toolbarView };
    }
    return null;
  }

  function _resolveToolbarContext(viewName) {
    const normalizedViewName = _normalizeDbPaneView(viewName);
    const contentContext = _getToolbarContentContext(viewName);
    if (_isToolbarUtilityView(viewName) && contentContext) return contentContext;
    const requestedViewName = TOOLBAR_DB_VIEW_TYPES.has(normalizedViewName)
      ? _resolveDbPaneDisplayView(viewName, contentContext?.activeTab)
      : normalizedViewName;
    if (contentContext) return { ...contentContext, viewName: requestedViewName };
    return { paneId: '', paneNode: null, activeTab: null, contentEl: null, viewName: requestedViewName };
  }

  function _focusFileOpenPane(paneId) {
    if (!paneId || GBLayout.activePane === paneId) return;
    GBLayout.setActivePane(paneId);
  }

  function _findLayoutParent(node, targetId) {
    if (!node || node.type !== 'split' || !node.children) return null;
    for (const child of node.children) {
      if (!child) continue;
      if (child.id === targetId) return { node, child };
      const nested = _findLayoutParent(child, targetId);
      if (nested) return nested;
    }
    return null;
  }

  function _expandCollapsedPane(paneId) {
    if (!paneId) return;
    if (typeof GBLayout.revealPane === 'function') {
      GBLayout.revealPane(paneId);
      return;
    }
    const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
    const pane = paneInfo?.node;
    if (!pane || !pane.collapsed) return;
    pane.collapsed = false;
    const parentInfo = _findLayoutParent(GBLayout.root, paneId);
    if (parentInfo?.node) {
      const splitNode = parentInfo.node;
      const childIndex = splitNode.children[0]?.id === paneId
        ? 0
        : (splitNode.children[1]?.id === paneId ? 1 : (GBLayout.findNode(splitNode.children[0], paneId) ? 0 : 1));
      const otherChild = splitNode.children[childIndex === 0 ? 1 : 0];
      if (otherChild?.collapsed && pane._savedRatio != null) {
        splitNode.ratio = pane._savedRatio;
        delete pane._savedRatio;
      } else if (otherChild?.collapsed) {
        // 親 split の現在 ratio を維持する。両側ドックバー状態でも 0.975/0.025 に
        // 寄せず、記憶済みのパネル幅/高さがない場合は初期比率を残す。
      } else if (pane._savedRatio != null) {
        splitNode.ratio = pane._savedRatio;
        delete pane._savedRatio;
      } else {
        // 親 split の現在 ratio を維持する。初期折りたたみドックはこの ratio に
        // 展開時の既定幅 (左 260px / 右 360px) を保持している。
      }
    }
    GBLayout.render();
    GBLayout.saveLayout();
  }

  function _isVersionHostPane(pane) {
    const tabs = pane?.tabs || [];
    if (!tabs.length) return false;
    if (tabs.some(t => PRIMARY_TOOL_PANE_TYPES.has(t.type))) return true;
    return tabs.every(t => TOOL_HOST_PANE_TYPES.has(t.type));
  }

  function _getVersionHostPaneInfo() {
    const allPanes = GBLayout.getAllPanes(GBLayout.root).filter(pane => {
      const activeTab = pane.tabs?.[pane.activeTabIndex];
      return !activeTab || !NAV_PANE_TYPES.has(activeTab.type);
    });
    const preferredPanes = allPanes.filter(pane => !pane.locked);
    const candidatePanes = preferredPanes.length ? preferredPanes : allPanes;
    for (const pane of candidatePanes) {
      if ((pane.tabs || []).some(t => PRIMARY_TOOL_PANE_TYPES.has(t.type))) {
        return { paneId: pane.id, reusable: true };
      }
    }
    for (const pane of candidatePanes) {
      if (_isVersionHostPane(pane)) {
        return { paneId: pane.id, reusable: true };
      }
    }
    const activeContentPane = _getContentPane(GBLayout.activePane);
    const activeContentInfo = activeContentPane ? GBLayout.findNode(GBLayout.root, activeContentPane)?.node : null;
    const fallbackPaneId = activeContentInfo && !activeContentInfo.locked
      ? activeContentPane
      : candidatePanes[candidatePanes.length - 1]?.id || allPanes[allPanes.length - 1]?.id || null;
    return { paneId: fallbackPaneId, reusable: false };
  }

  function _updateVersionTab(tab, label, versionType) {
    if (!tab) return;
    tab.label = label;
    tab.icon = GBTabs.tabIcon('version');
    tab.state = { ...(tab.state || {}), versionType };
  }

  // ================================================================
  // showView() オーバーライド
  // ================================================================
  function _overrideShowView() {
    const _origShowView = window.showView;

    window.showView = function(viewName, ctx) {
      // スプリットペイン内のビュー切替はそのまま
      if (ctx && ctx.containerEl) return _origShowView(viewName, ctx);
      if (_bridgeUpdating) {
        // navPush中でもツールバーは更新する
        _updateToolbars(viewName);
        return;
      }

      // ボード保存
      if (state.view === 'board' && viewName !== 'board' && typeof bd !== 'undefined' && bd.dirty && bd.path) {
        if (typeof bdSave === 'function') {
          const saveResult = bdSave();
          if (saveResult && typeof saveResult.then === 'function') {
            saveResult.then(saved => { if (saved && typeof bd !== 'undefined') bd.dirty = false; }).catch(() => {});
          } else if (saveResult) {
            bd.dirty = false;
          }
        }
      }

      // アクティブペインにビューを表示（ナビペインならコンテンツペインへ）
      const paneId = _getViewHostPane(viewName);
      if (!paneId) return;
      const paneInfo = GBLayout.paneMap[paneId];
      if (!paneInfo || !paneInfo.contentEl) return;
      const paneNode = GBLayout.findNode(GBLayout.root, paneId)?.node || null;
      const activeTab = paneNode?.tabs?.[paneNode.activeTabIndex] || null;

      // コンポーネントタイプの場合は何もしない（navPush経由でマウントされる）
      if (COMPONENT_TYPES.has(viewName)) {
        _updateToolbars(viewName);
        state.view = viewName;
        _mountFloatingAnnotationUi();
        _clearDetailAndPreview(viewName);
        return;
      }

      // レガシーコンテナを直接移動（render()なしでパフォーマンス向上）
      const containerId = LEGACY_CONTAINERS[viewName];
      _retractLegacyFromPane(paneInfo.contentEl, containerId);
      if (containerId) {
        _showLegacyViewInPane(paneId, paneInfo.contentEl, viewName, containerId, activeTab);
        // 空状態オーバーレイを除去（ファイルが開かれた）
        const emptyEl = document.getElementById(containerId)?.querySelector('.gb-empty-state');
        if (emptyEl) emptyEl.remove();
      }

      // ツールバー更新
      _updateToolbars(viewName);
      state.view = viewName;

      // アノテーション
      if (typeof ann !== 'undefined') {
        const newTarget = typeof getAnnotationTarget === 'function' ? getAnnotationTarget() : '';
        if (newTarget !== ann.targetPath) {
          ann.targetPath = newTarget;
          if (typeof loadAnnotations === 'function') loadAnnotations();
        }
        if (typeof _setupOverlayScroll === 'function') _setupOverlayScroll(viewName);
      }
      _mountFloatingAnnotationUi();

      // 詳細/プレビューペインをクリア（ビュー切替時に古い情報が残らないように）
      _clearDetailAndPreview(viewName);
    };
  }

  // 詳細/プレビューペインのクリア
  function _clearDetailAndPreview(viewName = '') {
    const detailPane = document.getElementById('rp-detail');
    if (detailPane && detailPane.closest('.gb-pane-content')) {
      if (typeof _ensureDetailTabShell === 'function') _ensureDetailTabShell(detailPane);
      // 未保存の編集があれば先に保存
      if (typeof _dpSavePending === 'function') _dpSavePending();
      if (typeof showNoteTabs === 'function') showNoteTabs(false);
      if (typeof showDbTabs === 'function') showDbTabs(false);
      if (typeof showBoardTabs === 'function') showBoardTabs(false);
      if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
      if (typeof showFileStyleTab === 'function') showFileStyleTab(false);
      if (typeof showPublishDetailTab === 'function') showPublishDetailTab(false);
      if (typeof hideBoardNoteTab === 'function') hideBoardNoteTab();
      if (typeof hideScriptnoteDetailTabs === 'function') hideScriptnoteDetailTabs();
      if (typeof switchDetailTab === 'function') switchDetailTab(null);
      // 残留 dp-editable を全削除（自動保存タイマーもクリア）
      if (typeof _removeStaleDpEditables === 'function') _removeStaleDpEditables(detailPane);
      else detailPane.querySelectorAll('#dp-editable').forEach(n => n.remove());
      // タイトルバーもクリア
      const titleEl = detailPane.querySelector('#split-right-title');
      if (titleEl) titleEl.textContent = '';
      ['#detail-tab-note-editor', '#detail-tab-db-property-settings', '#detail-tab-file-style', '#detail-tab-calendar-today', '#detail-tab-publish'].forEach(selector => {
        const el = detailPane.querySelector(selector);
        if (el) el.innerHTML = '';
      });
    }
    const previewPane = document.getElementById('gb-preview-pane');
    if (previewPane && previewPane.closest('.gb-pane-content')) {
      previewPane.innerHTML = '<div style="color:var(--fg2);font-size:13px;">ファイルを選択するとプレビューが表示されます</div>';
    }
  }

  // ツールバー更新（v5.0: ツールバーをペインのcontentEl先頭に動的配置）
  function _updateToolbars(viewName) {
    const toolbarContext = _resolveToolbarContext(viewName);
    const toolbarViewName = toolbarContext.viewName;
    const isDbView = TOOLBAR_DB_VIEW_TYPES.has(toolbarViewName);
    const showRt = (toolbarViewName === 'page');
    const showToolbar = isDbView || showRt;

    const appTb = document.getElementById('app-toolbar');
    const tbDb = document.getElementById('tb-db');
    if (tbDb) tbDb.style.display = isDbView ? 'contents' : 'none';
    const rtTb = document.getElementById('rt-toolbar');
    // page-view内に専用ツールバー(#page-rt-toolbar)があるので、app-toolbar内のrt-toolbarは常に非表示
    if (rtTb) rtTb.style.display = 'none';
    if (appTb) appTb.classList.toggle('visible', isDbView);

    // ツールバーをアクティブペインのcontentElの先頭に移動
    if (appTb && showToolbar) {
      const paneId = toolbarContext.paneId || _getFileOpenPane(GBLayout.activePane) || _getContentPane(GBLayout.activePane);
      if (paneId) {
        const paneInfo = GBLayout.paneMap[paneId];
        if (paneInfo && paneInfo.contentEl && appTb.parentNode !== paneInfo.contentEl) {
          paneInfo.contentEl.insertBefore(appTb, paneInfo.contentEl.firstChild);
        }
      }
    }

    const entityRt = document.getElementById('entity-rt-toolbar');
    if (entityRt) {
      const entityFreeText = document.getElementById('entity-freetext');
      const hasEntityNote = toolbarViewName === 'entity'
        && entityFreeText?.dataset?.entityNoteCreated === '1'
        && entityFreeText.style.display !== 'none';
      entityRt.style.display = hasEntityNote ? 'flex' : 'none';
    }

    const sc = document.getElementById('sb-shortcuts');
    if (sc) {
      if (isDbView) sc.textContent = '';
      else if (['entity', 'page'].includes(toolbarViewName)) {
        sc.textContent = 'Ctrl+B 太字 | Ctrl+I 斜体 | Ctrl+U 下線 | Ctrl+Shift+1~6 見出し | Ctrl+Shift+8 箇条書き';
      } else if (toolbarViewName === 'scriptnote') {
        if (typeof updateScriptnoteShortcutStatusbar === 'function') updateScriptnoteShortcutStatusbar(sc);
        else sc.textContent = 'Enter 行追加 | Ctrl+Enter 同タイプ行追加 | Shift+Del 行削除 | Ctrl+↑↓ 行入替 | Ctrl+R ルビ | Ctrl+Z Undo | Ctrl+Y Redo';
      } else sc.textContent = '';
    }
  }

  // ================================================================
  // navPush() オーバーライド
  // ================================================================
  function _overrideNavPush() {
    const _prevNavPush = navPush; // gb-app.jsの上書き版

    navPush = function(entry, paneId) {
      // パネルタブ更新が責務。履歴記録は navPush 本体で行われる
      const targetPaneId = paneId || _getFileOpenPane(GBLayout.activePane);
      if (targetPaneId) _prevNavPush(entry, targetPaneId);

      if (_bridgeUpdating || !_initialized) return;
      if (!entry || !entry.type || entry.type === 'welcome') return;

      _beginBridgeUpdate();
      try {
        const label = entry.label || entry.path?.split('/').pop() || '(無題)';
        const path = entry.path || entry.dbPath || '';
        const type = entry.type;

        // ナビ/補助ペインではなく、作業用ペインのアクティブタブを上書きする
        const paneId = _getFileOpenPane(GBLayout.activePane);
        if (paneId) {
          const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
          if (paneInfo) {
            const pane = paneInfo.node;
            let tabAddedByManager = false;
            // フォルダは既存タブを再利用し、なければアクティブタブを置換
            if (type === 'folder') {
              const folderTab = pane.tabs.find(t => t.type === 'folder');
              if (folderTab) {
                folderTab.label = label;
                folderTab.path = path;
                folderTab.state = {};
                const fi = pane.tabs.indexOf(folderTab);
                pane.activeTabIndex = fi;
                GBLayout.render();
                GBLayout.saveLayout({ immediate: true });
              } else if (pane.tabs.length > 0 && pane.activeTabIndex >= 0) {
                const tab = pane.tabs[pane.activeTabIndex];
                if (typeof removeComponentInstance === 'function') removeComponentInstance(tab.id);
                tab.type = type;
                tab.label = label;
                tab.path = path;
                tab.state = {};
                tab.icon = GBTabs.tabIcon(type);
                GBLayout.render();
                GBLayout.saveLayout({ immediate: true });
              } else {
                GBTabs.addTab(paneId, label, type, path);
                tabAddedByManager = true;
              }
            } else if (pane.tabs.length > 0 && pane.activeTabIndex >= 0) {
              const tab = pane.tabs[pane.activeTabIndex];
              // コンポーネント型タブが自身のnavPushを呼んだ場合: ラベルだけ更新して破棄しない
              if (COMPONENT_TYPES.has(type) && tab.type === type && tab.path === path) {
                tab.label = label;
                GBLayout.saveLayout({ immediate: true });
              } else if (tab.type === type && !COMPONENT_TYPES.has(type)) {
                // 同タイプ内のナビゲーション（page→page 等）: render() 不要、タブラベルのみ更新
                // コンポーネント型は render() でマウントが必要なため除外
                tab.state = entry.mediaType ? { mediaType: entry.mediaType } : {};
                tab.label = label;
                tab.path = path;
                // タブバーのラベルを直接更新（full render を避ける）
                const tabEl = GBLayout.paneMap[paneId]?.el?.querySelector('.gb-tab.active .gb-tab-label');
                if (tabEl) tabEl.textContent = label;
                GBLayout.saveLayout({ immediate: true });
              } else {
                // 別タイプへのナビゲーション: コンポーネントを破棄して置換、full render
                if (typeof removeComponentInstance === 'function') {
                  removeComponentInstance(tab.id);
                }
                tab.state = entry.mediaType ? { mediaType: entry.mediaType } : {};
                tab.type = type;
                tab.label = label;
                tab.path = path;
                tab.icon = GBTabs.tabIcon(type);
                GBLayout.render();
                GBLayout.saveLayout({ immediate: true });
              }
            } else {
              GBTabs.addTab(paneId, label, type, path);
              tabAddedByManager = true;
            }
            if (!tabAddedByManager) _focusFileOpenPane(paneId);
          }
        }
      } finally {
        _endBridgeUpdate();
      }
    };
  }

  // ================================================================
  // レガシータブ関数オーバーライド
  // ================================================================
  function _overrideLegacyTabs() {
    // addTab → GBTabs に委譲
    window.addTab = function(label, type, path) {
      return GBTabs.addToActivePane(label, type, path);
    };

    // activateTab → ペイン内タブ検索して委譲
    window.activateTab = function(tabId) {
      const allPanes = GBLayout.getAllPanes(GBLayout.root);
      for (const pane of allPanes) {
        if ((pane.tabs || []).find(t => t.id === tabId)) {
          GBTabs.activateTab(pane.id, tabId);
          return;
        }
      }
    };

    // closeTab → ペイン内タブ検索して委譲
    window.closeTab = function(tabId) {
      const allPanes = GBLayout.getAllPanes(GBLayout.root);
      for (const pane of allPanes) {
        if ((pane.tabs || []).find(t => t.id === tabId)) {
          GBTabs.closeTab(pane.id, tabId);
          return;
        }
      }
    };

    // renderTabs → noop（ペインシステムがレンダリング担当）
    window.renderTabs = function() {};

    // _openInNewTab → ペインに新タブとして開く
    window._openInNewTab = function(label, path, type) {
      type = type || 'page';
      const paneId = _getFileOpenPane(GBLayout.activePane, { ensureWorkPane: true });
      const tabId = paneId ? GBTabs.addTab(paneId, label, type, path) : null;
      if (tabId) {
        _beginBridgeUpdate();
        window._suppressAutoAppLayoutSwitch = true;
        try {
          navOpen({ type, label, path });
        } finally {
          window._suppressAutoAppLayoutSwitch = false;
          _endBridgeUpdate();
        }
      }
    };

    // 新規作成メニュー（トップバーから呼び出し）
    window.toggleNewMenu = function(e) { _toggleNewMenu(e); };

    // ユーザーメニュー
    window.showUserMenu = function(e) {
      const existing = document.querySelector('.gb-user-menu');
      if (existing) { existing.remove(); return; }
      const menu = document.createElement('div');
      menu.className = 'gb-user-menu gb-context-menu';
      let user = {};
      try { user = JSON.parse(localStorage.getItem('meldex-user') || '{}') || {}; } catch { user = {}; }
      if (user.name) {
        const roleLabels = { owner: '管理者', editor: '編集者', viewer: '閲覧者' };
        const mi = document.createElement('div');
        mi.style.cssText = 'padding:5px 14px;font-size:13px;color:var(--fg2);';
        mi.textContent = user.name + (typeof _myTeamRole !== 'undefined' ? '（' + (roleLabels[_myTeamRole] || '編集者') + '）' : '');
        menu.appendChild(mi);
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
        menu.appendChild(sep);
        const st = document.createElement('div');
        st.style.cssText = 'padding:5px 14px;cursor:pointer;font-size:13px;';
        st.textContent = '設定';
        st.onmouseenter = () => { st.style.background = 'var(--bg4)'; };
        st.onmouseleave = () => { st.style.background = ''; };
        st.addEventListener('click', () => { menu.remove(); if (typeof showSettingsModal === 'function') showSettingsModal({ panel: 'ユーザー' }); });
        menu.appendChild(st);
        if (window.MeldexCloudBootstrap?.openSettingsFlow) {
          const cloud = document.createElement('div');
          cloud.style.cssText = 'padding:5px 14px;cursor:pointer;font-size:13px;';
          cloud.textContent = '保存先を設定';
          cloud.onmouseenter = () => { cloud.style.background = 'var(--bg4)'; };
          cloud.onmouseleave = () => { cloud.style.background = ''; };
          cloud.addEventListener('click', () => {
            menu.remove();
            window.MeldexCloudBootstrap.openSettingsFlow();
          });
          menu.appendChild(cloud);
        }
      } else {
        const mi = document.createElement('div');
        mi.style.cssText = 'padding:5px 14px;font-size:13px;color:var(--fg2);';
        mi.textContent = '名前が設定されていません';
        menu.appendChild(mi);
      }
      document.body.appendChild(menu);
      const fallbackBtn = document.getElementById('left-chrome-user') || document.getElementById('left-chrome-floating-user');
      const btn = e && e.target ? e.target.closest('button') || fallbackBtn : fallbackBtn;
      if (!btn) { menu.remove(); return; }
      const rect = btn.getBoundingClientRect();
      { const z = _getZoom(); menu.style.right = ((window.innerWidth - rect.right) / z) + 'px'; menu.style.top = (rect.bottom / z + 2) + 'px'; }
      clampPopupToViewport(menu);
      setTimeout(() => {
        document.addEventListener('pointerdown', function cl(ev) {
          if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', cl); }
        });
      }, 0);
    };

    // ツールタブを空状態で開く（トップバーボタンから呼び出し）
    window.openToolTab = function(toolType) {
      const labels = {
        page: 'ノート', scriptnote: 'シナリオ', database: 'シート',
        board: 'ボード', calendar: 'カレンダー', timer: 'タイマー',
        'smart-db': 'スマートシート',
        folder: 'フォルダ', outliner: 'フォルダツリー',
      };
      const existingGlobal = (typeof GBTabs !== 'undefined' && typeof GBTabs.findPaneWithTab === 'function')
        ? (GBTabs.findPaneWithTab(toolType, '') || _findToolPaneInAnyGroup(toolType))
        : null;
      if (existingGlobal) {
        _activateToolPaneMatch(existingGlobal);
        return;
      }
      const paneId = _getContentPane(GBLayout.activePane);
      if (!paneId) return;
      // アクティブパネル内に同じタイプのタブがあれば切り替え
      const paneInfo = GBLayout.findNode(GBLayout.root, paneId);
      if (paneInfo) {
        const existing = paneInfo.node.tabs.find(t => t.type === toolType);
        if (existing) {
          GBTabs.activateTab(paneId, existing.id);
          return;
        }
      }
      const tabId = GBTabs.addTab(paneId, labels[toolType] || toolType, toolType, '');
      if (tabId) _showEmptyToolView(toolType);
    };

    // パネルメニュー経由の「常に新規タブとして追加」動作（C案 — 他のパネルセットに同種のタブがあっても新規追加する）
    const _PANEL_MENU_LABELS = {
      page: 'ノート', scriptnote: 'シナリオ', database: 'シート',
      board: 'ボード', calendar: 'カレンダー', timer: 'タイマー',
      'smart-db': 'スマートシート',
      folder: 'フォルダ',
      outliner: 'フォルダツリー', preview: 'ビューワー', detail: 'オプション',
      chat: 'チャット', history: 'ヒストリー', annotation: '注釈',
    };
    const _PANEL_FILE_CREATE_TYPES = new Set(['page', 'scriptnote', 'database', 'board', 'smart-db']);
    const _PANEL_FILE_OPEN_TYPES = {
      database: 'pivot',
    };
    function _panelFileTabState(toolType, name, path) {
      const state = { label: name };
      if (toolType === 'scriptnote') state.scenarioPath = path;
      if (toolType === 'board') state.boardPath = path;
      if (toolType === 'database') state.dbPath = path;
      if (toolType === 'smart-db') state.smartDbPath = path;
      return state;
    }
    async function _panelHomeFolderPath() {
      try {
        if (typeof _homeFolderPath !== 'undefined' && _homeFolderPath) return _homeFolderPath;
      } catch (_) {}
      try {
        const res = await apiFetch('/home-folder');
        const path = res?.path || '';
        try {
          if (path && typeof _homeFolderPath !== 'undefined') _homeFolderPath = path;
        } catch (_) {}
        return path;
      } catch (_) {
        return '';
      }
    }
    async function _refreshPanelCreatedFileLists(path) {
      const jobs = [];
      if (typeof renderHomeFolderTree === 'function') jobs.push(Promise.resolve().then(() => renderHomeFolderTree()));
      if (typeof loadOutliner === 'function') jobs.push(Promise.resolve().then(() => loadOutliner()));
      if (jobs.length) await Promise.allSettled(jobs);
      if (path && typeof highlightOutlinerNode === 'function') {
        try { highlightOutlinerNode(path); } catch (_) {}
      }
    }
    let _panelCreatedFileListRefreshScheduled = false;
    let _panelCreatedFileListRefreshPath = '';
    function _schedulePanelCreatedFileListRefresh(path) {
      if (path) _panelCreatedFileListRefreshPath = path;
      if (_panelCreatedFileListRefreshScheduled) return;
      _panelCreatedFileListRefreshScheduled = true;
      const defer = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => setTimeout(fn, 0);
      defer(() => setTimeout(() => {
        const refreshPath = _panelCreatedFileListRefreshPath;
        _panelCreatedFileListRefreshPath = '';
        _panelCreatedFileListRefreshScheduled = false;
        _refreshPanelCreatedFileLists(refreshPath).catch(() => {});
      }, 0));
    }
    async function _createPanelFileTab(toolType, paneId) {
      let pendingTabId = null;
      try {
        const openType = _PANEL_FILE_OPEN_TYPES[toolType] || toolType;
        const pendingState = _panelFileTabState(toolType, '無題', '');
        pendingState.pendingCreate = true;
        pendingTabId = GBTabs.addTab(paneId, '無題', openType, '', pendingState, { forceNewToolTab: true });
        if (pendingTabId && typeof GBLayout.setActivePane === 'function') GBLayout.setActivePane(paneId);
        const parent = await _panelHomeFolderPath();
        if (!parent) {
          if (pendingTabId) GBTabs.closeTab(paneId, pendingTabId, { skipHistory: true });
          if (typeof showStatus === 'function') showStatus('ホームフォルダが見つからないため作成できません', true);
          return null;
        }
        const res = await apiPost('/outliner/add', { type: toolType, label: '無題', parent });
        const node = res?.node || {};
        const path = node.path || '';
        if (!path) throw new Error('created node path is empty');
        const name = node.name || node.label || '無題';
        const state = _panelFileTabState(toolType, name, path);
        const tabId = pendingTabId || GBTabs.addTab(paneId, name, openType, path, state, { forceNewToolTab: true });
        if (pendingTabId && typeof GBTabs.updateTab === 'function') {
          GBTabs.updateTab(paneId, pendingTabId, { label: name, type: openType, path, state }, { activate: true });
        } else if (!pendingTabId && tabId && typeof GBLayout.setActivePane === 'function') {
          GBLayout.setActivePane(paneId);
        }
        _schedulePanelCreatedFileListRefresh(path);
        if (typeof showStatus === 'function') showStatus('作成しました: ' + name);
        return tabId;
      } catch (err) {
        if (pendingTabId) GBTabs.closeTab(paneId, pendingTabId, { skipHistory: true });
        if (typeof showStatus === 'function') showStatus('作成に失敗しました', true);
        return null;
      }
    }
    window.addPanelMenuTool = function(toolType, options) {
      // ＋ボタン／パネルメニューから呼ばれた時は、メニューを開いたペインへ追加する。
      // paneId 未指定の既存呼び出しだけ、現在アクティブなペインを使う。
      const paneId = options?.paneId || GBLayout.activePane;
      if (!paneId) return null;
      if (!GBLayout.findNode?.(GBLayout.root, paneId)) return null;
      if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(paneId)) {
        if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
        return null;
      }
      if (_PANEL_FILE_CREATE_TYPES.has(toolType)) {
        return _createPanelFileTab(toolType, paneId);
      }
      const label = _PANEL_MENU_LABELS[toolType] || toolType;
      const tabId = GBTabs.addTab(paneId, label, toolType, '', null, { forceNewToolTab: true });
      if (tabId && typeof _showEmptyToolView === 'function') _showEmptyToolView(toolType);
      return tabId;
    };
    window.addPanelMenuVersion = function(options) {
      const target = (typeof _getCurrentVersionTarget === 'function')
        ? _getCurrentVersionTarget() : { path: '', type: 'file' };
      const vType = target.type || 'file';
      const path = target.path || '';
      const hasPath = !!path;
      const label = hasPath ? 'バージョン: ' + (path.split('/').pop() || path) : 'バージョン管理';
      const paneId = options?.paneId || GBLayout.activePane;
      if (!paneId) return null;
      if (!GBLayout.findNode?.(GBLayout.root, paneId)) return null;
      if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(paneId)) {
        if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
        return null;
      }
      const tabId = GBTabs.addTab(paneId, label, 'version', '', { versionType: vType, versionPath: path });
      if (!tabId) return null;
      if (hasPath) {
        const comp = typeof getComponentInstance === 'function' ? getComponentInstance(tabId) : null;
        if (comp && comp._loadVersions) comp._loadVersions(path, vType);
      }
      return tabId;
    };

    // バージョン管理タブを開く（path が空でも「対象未指定」の状態で開ける）
    window.openVersionTab = function(path, versionType) {
      const vType = versionType || 'file';
      const hasPath = !!path;
      const searchPath = path || '';
      const fileName = hasPath ? (path.split('/').pop() || path) : '';
      const label = hasPath ? 'バージョン: ' + fileName : 'バージョン管理';
      const hostInfo = _getVersionHostPaneInfo();

      // 対象付きで呼ばれた時、空タブ（対象未指定）が既にあれば、そこに対象を流し込んで再利用する
      if (hasPath) {
        const emptyExisting = GBTabs.findPaneWithTab('version', '');
        if (emptyExisting) {
          const emptyPaneInfo = GBLayout.findNode(GBLayout.root, emptyExisting.paneId);
          const emptyTab = emptyPaneInfo?.node?.tabs?.find(t => t.id === emptyExisting.tabId);
          if (emptyTab) {
            if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(emptyExisting.paneId)) {
              GBTabs.activateTab(emptyExisting.paneId, emptyExisting.tabId);
              return emptyExisting.tabId;
            }
            emptyTab.path = path;
            emptyTab.label = label;
            emptyTab.state = { ...(emptyTab.state || {}), versionType: vType };
            GBLayout.render();
            GBLayout.saveLayout();
            _expandCollapsedPane(emptyExisting.paneId);
            GBTabs.activateTab(emptyExisting.paneId, emptyExisting.tabId);
            const comp = typeof getComponentInstance === 'function' ? getComponentInstance(emptyExisting.tabId) : null;
            if (comp && comp._loadVersions) comp._loadVersions(path, vType);
            return emptyExisting.tabId;
          }
        }
      }

      const existing = GBTabs.findPaneWithTab('version', searchPath);

      if (existing) {
        const existingPaneInfo = GBLayout.findNode(GBLayout.root, existing.paneId);
        const existingTab = existingPaneInfo?.node?.tabs?.find(t => t.id === existing.tabId);
        const existingLocked = typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(existing.paneId);
        if (_isVersionHostPane(existingPaneInfo?.node)) {
          if (!existingLocked) _updateVersionTab(existingTab, label, vType);
          GBLayout.render();
          GBLayout.saveLayout();
          _expandCollapsedPane(existing.paneId);
          GBTabs.activateTab(existing.paneId, existing.tabId);
          return existing.tabId;
        }
        if (hostInfo.reusable && hostInfo.paneId && hostInfo.paneId !== existing.paneId) {
          if (existingLocked ||
              (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(hostInfo.paneId))) {
            GBTabs.activateTab(existing.paneId, existing.tabId);
            return existing.tabId;
          }
          _updateVersionTab(existingTab, label, vType);
          _expandCollapsedPane(hostInfo.paneId);
          GBTabs.moveTab(existing.paneId, existing.tabId, hostInfo.paneId);
          GBTabs.activateTab(hostInfo.paneId, existing.tabId);
          return existing.tabId;
        }
        if (existingLocked) {
          GBTabs.activateTab(existing.paneId, existing.tabId);
          return existing.tabId;
        }
        _updateVersionTab(existingTab, label, vType);
        const sourcePaneId = hostInfo.paneId || existing.paneId;
        if (!sourcePaneId) return existing.tabId;
        const newPane = GBLayout.createPaneNode(null, [], -1);
        const newPaneId = GBLayout.splitPane(sourcePaneId, 'horizontal', 'right', newPane);
        if (!newPaneId) {
          GBTabs.activateTab(existing.paneId, existing.tabId);
          return existing.tabId;
        }
        GBTabs.moveTab(existing.paneId, existing.tabId, newPaneId);
        GBTabs.activateTab(newPaneId, existing.tabId);
        return existing.tabId;
      }

      if (hostInfo.reusable && hostInfo.paneId) {
        _expandCollapsedPane(hostInfo.paneId);
        return GBTabs.addTab(hostInfo.paneId, label, 'version', searchPath, { versionType: vType });
      }

      const sourcePaneId = hostInfo.paneId;
      if (!sourcePaneId) return null;
      const tab = GBTabs.createTab(label, 'version', searchPath, { versionType: vType });
      const newPane = GBLayout.createPaneNode(null, [tab], 0);
      const newPaneId = GBLayout.splitPane(sourcePaneId, 'horizontal', 'right', newPane);
      if (newPaneId) {
        GBLayout.setActivePane(newPaneId);
        if (typeof _refreshPaneAfterTabSwitch === 'function') {
          _refreshPaneAfterTabSwitch(newPaneId);
        }
      }
      return tab.id;
    };

    // バージョンパネルを更新
    window.refreshVersionPanel = function() {
      const activeTab = GBTabs.getActiveTab(GBLayout.activePane);
      if (!activeTab || activeTab.type !== 'version') return;
      const comp = typeof getComponentInstance === 'function' ? getComponentInstance(activeTab.id) : null;
      if (comp && comp._loadVersions) {
        comp._loadVersions(comp.state.versionPath, comp.state.versionType);
      }
    };

    function _initToolDropTargets() {
      // パネルのタブバーのみでツールドロップを受け付け（コンテンツ領域は除外）
      document.addEventListener('dragover', (e) => {
        if (!e.target.closest('.gb-pane-tabs')) return;
        if (!e.dataTransfer.types.includes('application/meldex-tool')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });

      document.addEventListener('drop', (e) => {
        const tool = e.dataTransfer.getData('application/meldex-tool');
        if (!tool) return;
        // タブバーへのドロップのみ（コンテンツ領域はノート/キャンバス等の固有D&Dに委ねる）
        if (!e.target.closest('.gb-pane-tabs')) return;
        e.preventDefault();
        const paneEl = e.target.closest('.gb-pane');
        if (!paneEl) return;
        const paneId = paneEl.dataset.paneId;
        if (!paneId) return;
        if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(paneId)) {
          if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
          return;
        }

        const labels = {
          page: 'ノート', scriptnote: 'シナリオ', database: 'シート',
          board: 'ボード', calendar: 'カレンダー', timer: 'タイマー', preview: 'ビューワー',
          'smart-db': 'スマートシート',
          folder: 'フォルダ', chat: 'チャット', history: 'ヒストリー',
          annotation: '注釈', detail: 'オプション',
        };

        if (typeof window.addPanelMenuTool === 'function') {
          window.addPanelMenuTool(tool, { paneId });
          return;
        }
        GBTabs.addTab(paneId, labels[tool] || tool, tool, '');
      });
    }
    setTimeout(_initToolDropTargets, 500);

    // 空状態UI表示
    function _showEmptyToolView(toolType) {
      const labels = {
