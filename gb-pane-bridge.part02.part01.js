      if (a.pane.id === GBLayout.activePane) return -1;
      if (b.pane.id === GBLayout.activePane) return 1;
      return 0;
    });
    for (const entry of allPanes) {
      _mountPaneContent(entry.pane, {
        surface: entry.surface,
        preserveLiveOwner: true,
        claimLive: entry.pane.id === claimPaneId,
      });
    }
    window.MeldexStartupTabGuard?.pruneRestoredTabs?.();
  }

  function _showPendingCreatePane(contentEl, tab) {
    if (!contentEl) return;
    if (getComputedStyle(contentEl).position === 'static') contentEl.style.position = 'relative';
    let pendingEl = contentEl.querySelector(':scope > .gb-pending-create-view');
    if (!pendingEl) {
      pendingEl = document.createElement('div');
      pendingEl.className = 'gb-pending-create-view';
      pendingEl.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:var(--bg);color:var(--fg2);z-index:6;font-size:13px;';
      const title = document.createElement('div');
      title.className = 'gb-pending-create-title';
      title.style.cssText = 'color:var(--fg);font-size:15px;';
      const status = document.createElement('div');
      status.className = 'gb-pending-create-status';
      pendingEl.appendChild(title);
      pendingEl.appendChild(status);
      contentEl.appendChild(pendingEl);
    }
    const titleEl = pendingEl.querySelector('.gb-pending-create-title');
    const statusEl = pendingEl.querySelector('.gb-pending-create-status');
    if (titleEl) titleEl.textContent = tab?.label || '無題';
    if (statusEl) statusEl.textContent = '作成しています...';
  }

  function _mountPaneContent(pane, options) {
    const paneInfo = GBLayout.paneMap[pane.id];
    if (!paneInfo || !paneInfo.contentEl) return;
    if (!pane.tabs || pane.activeTabIndex < 0 || pane.activeTabIndex >= pane.tabs.length) return;

    const activeTab = pane.tabs[pane.activeTabIndex];
    const contentEl = paneInfo.contentEl;
    const tabType = activeTab.type;
    contentEl.querySelectorAll(':scope > .gb-pending-create-view').forEach(el => el.remove());

    if (window.MeldexStartupTabGuard?.deferMount?.(pane, contentEl, activeTab, tabType, currentPane => _mountPaneContent(currentPane))) return;
    contentEl.querySelectorAll(':scope > .gb-startup-path-check').forEach(el => el.remove());

    if (activeTab.state?.pendingCreate) {
      _retractLegacyFromPane(contentEl);
      contentEl.querySelectorAll(':scope > .gb-legacy-snapshot-host').forEach(el => el.remove());
      _showPendingCreatePane(contentEl, activeTab);
      return;
    }

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
      // 直前のビュー（シート等）の残骸を消してからツール本体を載せる。
      // comp.mount() は appendChild のみでコンテナを空にしないため、ここで消さないと積み重なる。
      contentEl.querySelectorAll(':scope > .gb-legacy-snapshot-host').forEach(el => el.remove());
      _retractAppToolbarFromPane(contentEl);
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
    let containerId = LEGACY_CONTAINERS[tabType];
    if (!containerId) return;
    // media タブのうち画像/PDF/動画の実体はビューワー（html-view の #html-iframe）に
    // 表示される（openMedia→openViewer。media-view を使うのは audio のみ）。マウント先を
    // 実体側に一致させないと、タブ復帰のたびに空の media-view が html-view を退避
    // （=iframeのDOM移動→強制再読み込み）してビューワー状態が失われる（v0.7.139）。
    if (tabType === 'media' && (activeTab.state?.mediaType || 'image') !== 'audio') {
      containerId = 'html-view';
    }
    _mountLegacyLikeTab(pane, contentEl, activeTab, tabType, containerId, options);
    // タブ復帰（タブ切替・タブクローズ後の再アクティブ化）で共有コンテナ
    // （html-view の iframe / media-view の #media-content）の実内容がこのタブと
    // 食い違っていないか検証し、不一致なら開き直す（不具合B対策）。詳細は
    // _gbScheduleMediaContainerResync 参照。
    _gbScheduleMediaContainerResync(pane, activeTab, tabType, containerId);
  }

  // ================================================================
  // 不具合B対策: タブ間メディア混入の防止
  //
  // html-view の #html-iframe / media-view の #media-content は、複数タブ・複数ペインで
  // 使い回される単一の共有DOMである（LEGACY_CONTAINERS参照）。タブ切替・タブクローズ後の
  // 復帰時、_ensureLegacyTabContent 自身のロード要否判定（コンテナのdataset比較）が
  // 何らかの理由で更新をスキップした場合や、postMessage経由の高速パス（gb-folder.part02.js
  // 参照）がまだ応答を返していない場合、共有コンテナには「今アクティブなタブとは別の
  // タブが最後に表示していた内容」が残ったまま見えてしまうことがある
  // （例: 動画タブを閉じたら、復帰した画像タブに直前の動画が残って見える）。
  //
  // ここでは、アクティブタブが要求する「本来映すべき対象」（署名）と、共有コンテナに
  // 実際に描画されている内容（openMedia/openViewer が書き込む dataset マーカー）を
  // 突き合わせ、不一致なら明示的に開き直す。_ensureLegacyTabContent の非同期ロード
  // （job.promise）完了を待ってから検証することで、進行中の正当な読み込みと競合しない
  // ようにする。
  // ================================================================

  // アクティブタブが本来映すべき対象（共有コンテナ種別 + URL/パス）を算出する。
  // media タブ（openMedia経由の画像/PDF/動画/音声）のみを対象にする。html タブ
  // （openHtmlFile経由の生HTML表示等）は URL 解決方式が別系統で曖昧なため対象外。
  // URL解決は gb-app.part03.js の openMedia の実装と必ず一致させること
  // （image/video は viewerUrl 優先、pdf は常に固定ルートで viewerUrl を見ない）。
  function _gbMediaTabExpectedSignature(tab, tabType) {
    if (!tab || !tab.path || tabType !== 'media') return null;
    const mediaType = tab.state?.mediaType || 'image';
    if (mediaType === 'audio') {
      return { container: 'media-view', mediaKind: 'audio', path: tab.path };
    }
    if (mediaType === 'pdf') {
      return { container: 'html-view', url: '/viewer?pdf=' + encodeURIComponent(tab.path) };
    }
    // image / video（動画もビューワー(html-view)側に統一。gb-app.part03.js openMedia参照）
    const url = tab.state?.viewerUrl || '/viewer?file=' + encodeURIComponent(tab.path);
    return { container: 'html-view', url };
  }

  function _gbScheduleMediaContainerResync(pane, tab, tabType, containerId) {
    if (containerId !== 'html-view' && containerId !== 'media-view') return;
    const expected = _gbMediaTabExpectedSignature(tab, tabType);
    if (!expected) return;
    const paneId = pane.id;
    const tabId = tab.id;
    const job = _legacyLoadJobs.get(containerId);
    const afterJob = (job?.promise && typeof job.promise.then === 'function') ? job.promise : Promise.resolve();
    const verify = () => {
      // _ensureLegacyTabContent の非同期ロード完了後も、openViewer側のpostMessage高速パス
      // （最大250ms）が残っている可能性があるため、余裕を持たせてから検証する。
      setTimeout(() => _gbVerifyAndFixMediaContainer(paneId, tabId, expected), 260);
    };
    afterJob.then(verify).catch(verify);
  }

  function _gbVerifyAndFixMediaContainer(paneId, tabId, expected) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return;
    const paneInfo = GBLayout.findNode?.(GBLayout.root, paneId);
    const pane = paneInfo?.node;
    const currentTab = pane?.tabs?.[pane.activeTabIndex];
    if (!currentTab || currentTab.id !== tabId) return; // 既にタブ切替済み・タブが閉じられた
    // このペインが対象コンテナを今もライブ所有していない（スナップショット表示等）場合は対象外
    if (_containerPane[expected.container] !== paneId) return;
    // openMedia/openViewer は showView 経由で「今アクティブなペイン」を対象に解決する
    // （明示的にpaneIdを渡す口が無い）。このペインが今アクティブでない状態で呼ぶと、
    // 誤って別ペインへ表示してしまう恐れがあるため、アクティブペインの時だけ修正する。
    if (GBLayout.activePane !== paneId) return;
    if (expected.container === 'html-view') {
      const iframe = document.getElementById('html-iframe');
      if (!iframe) return;
      if ((iframe.dataset.gbViewerCurrentUrl || '') === expected.url) return;
      if (typeof openViewer === 'function') {
        openViewer(expected.url, {
          skipShowView: true, skipStateView: true, skipNavPush: true, skipSaveLastView: true,
          skipRecent: true, skipHighlight: true, skipGlobalUi: true,
        });
      }
      return;
    }
    const container = document.getElementById('media-content');
    if (!container) return;
    if ((container.dataset.gbMediaPath || '') === expected.path
        && (container.dataset.gbMediaKind || '') === expected.mediaKind) return;
    if (typeof openMedia === 'function') {
      openMedia(currentTab.label || '', expected.path, expected.mediaKind, {
        skipShowView: true, skipStateView: true, skipNavPush: true, skipSaveLastView: true,
        skipRecent: true, skipHighlight: true, skipGlobalUi: true,
      });
    }
  }

  function _mountLegacyLikeTab(pane, contentEl, tab, tabType, containerId, options) {
    // これから載せる containerId は退避対象から外す（同一コンテンツのまま active 切替時に
    // detach→reattach が発生して click 配信を阻害するのを防ぐ）。
    _retractLegacyFromPane(contentEl, containerId);
    contentEl.querySelectorAll('.gb-legacy-snapshot-host').forEach(el => el.remove());
    const ownerPaneId = _containerPane[containerId] || '';
    const ownerIsVisible = ownerPaneId ? _isPaneActuallyVisible(ownerPaneId) : false;
    const liveBinding = _legacyLiveBindings.get(containerId);
    const hasVisibleLiveOwner = !!(liveBinding?.paneId && _isPaneActuallyVisible(liveBinding.paneId));
    const isDockPopupMount = !!options?.dockPopup;
    const isVirtualSurfaceMount = options?.surface === 'subpanel'
      || !!contentEl.closest?.('.gb-subpanel');
    const paneIsVisible = _isPaneActuallyVisible(pane.id);
    const preservesOtherLiveOwner = !!options?.preserveLiveOwner && hasVisibleLiveOwner
      && liveBinding.paneId !== pane.id;
    const canMountLive = !!options?.claimLive || (!preservesOtherLiveOwner
      && (isDockPopupMount || isVirtualSurfaceMount
        || (paneIsVisible && (!ownerPaneId || ownerPaneId === pane.id || pane.id === GBLayout.activePane || !ownerIsVisible))));
    const bridgeOpts = pane.id === GBLayout.activePane ? _bridgeOpenOpts : _bridgePassiveOpenOpts;
    if (canMountLive && document.getElementById(containerId)) {
      _teardownSnapshotHost(tab.id);
      _showLegacyViewInPane(pane.id, contentEl, tabType, containerId, tab);
      _ensureLegacyTabContent(tab, tabType, containerId, bridgeOpts, pane);
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
      // モード決定（保存セッションの復元 / team既定へのフォールバック）はセッション内の
      // 初回ライブマウント時のみ行う。以降のライブ再マウント（リサイズ再描画等での
      // 全ペインDOM再構築）では、ユーザーが選択済みのモードタブをそのまま維持する。
      const isDockPopupMount = !!options?.dockPopup;
      if (!isDockPopupMount && !_chatModeInitDone) {
        _chatModeInitDone = true;
        const restoring = typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.restoreOnOpen === 'function'
          ? GBChatRestore.restoreOnOpen()
          : false;
        if (!restoring && !(typeof GBChatRestore !== 'undefined' && typeof GBChatRestore.isRestoreSuspended === 'function' && GBChatRestore.isRestoreSuspended()) && typeof switchChatMode === 'function') {
          switchChatMode(localStorage.getItem('chat-mode') || _chatMode || 'team');
        }
      }
    } else if (toolType === 'annotation') {
      if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
    } else if (toolType === 'sticky') {
      // 種類フィルタの既定値('sticky')もセッション内の初回ライブマウント時のみ適用する。
      // 以降の再マウントでユーザーが選んだフィルタを維持するため（チャットのモード決定と同じ理由）。
      if (!_stickyTypeInitDone) {
        _stickyTypeInitDone = true;
        const type = document.getElementById('rp-ann-type');
        if (type) type.value = 'sticky';
      }
      if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
    } else if (toolType === 'history') {
      if (typeof renderHistoryList === 'function') renderHistoryList();
    } else if (toolType === 'tags') {
      if (typeof renderTagManagementTab === 'function') {
        const container = document.getElementById('rp-tags');
        if (container) renderTagManagementTab(container);
      }
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
    // 'folder' タブの path はフォルダそのもの（フォルダツリー内で選択中の個別ファイルを
    // 表さない）。folder タブがアクティブなときにこの path をファイルとして誤解決すると、
    // showFolderPreview が既に表示済みのリッチな内容（iframe等）を、画像でも何でもない
    // フォルダパスの「ファイル名テキストだけ」で上書きしてしまう（不具合A関連）。
    const activePreviewPath = activePreviewTab && !['preview', 'detail', 'folder'].includes(activePreviewTab.type)
      ? (activePreviewTab.path || activePreviewTab.state?.scenarioPath || '')
      : '';
    // 再マウント時は保存済みパスを優先（最大化/復元でグローバルstateがずれる問題の対策）
    const mediaPath = forceRestore
      ? (pane.dataset.previewPath || '')
      : (activePreviewPath || state.currentPagePath || state.currentEntityPath || '');
    if (forceRestore && pane.dataset.previewMode === 'board-link' && mediaPath && typeof bdRenderLinkedPreview === 'function') {
      pane.dataset.previewPath = mediaPath;
      bdRenderLinkedPreview(mediaPath, pane);
      return;
    }
    const ext = mediaPath ? mediaPath.split('.').pop().toLowerCase() : '';
    // フォルダツリー側の許容拡張子（gb-outliner-activation.js の IMAGE_EXTS）と揃える
    const imgExts = ['jpg','jpeg','jpe','jfif','png','apng','gif','webp','svg','bmp','avif','ico','tif','tiff','heic','heif','psd','psb'];
    const resolvesToImage = !!mediaPath && imgExts.includes(ext);
    if (resolvesToImage) {
      // 現在のパスを保存（次回再マウント用）
      pane.dataset.previewPath = mediaPath;
      const url = (typeof API_BASE !== 'undefined' ? API_BASE : '') + '/file-raw?path=' + encodeURIComponent(mediaPath);
      // 既存画像のsrcを更新（白フラッシュ防止）
      const existingImg = pane.querySelector('img');
      if (existingImg) {
        existingImg.src = url;
      } else {
        pane.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;" alt="preview">';
      }
      return;
    }
    // 不具合A対策: showFolderPreview 等が既にリッチな内容（埋め込みビューワーの
    // <iframe>、動画/音声プレイヤー、サムネイル画像）を表示済みの場合、対象を
    // 特定できない/画像として解決できない更新でそれを破壊しない。
    if (pane.querySelector('iframe, video, audio, img')) return;
    if (!mediaPath) {
      pane.innerHTML = '<div style="color:var(--fg2);font-size:13px;">ファイルを選択するとプレビューが表示されます</div>';
      return;
    }
    pane.dataset.previewPath = mediaPath;
    const fname = document.createElement('div');
    fname.style.cssText = 'color:var(--fg2);font-size:13px;';
    fname.textContent = mediaPath.split('/').pop();
    pane.innerHTML = '';
    pane.appendChild(fname);
  }

  const _ANNOTATION_HOST_TYPES = new Set([
    'database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db',
    'compare', 'entity', 'page', 'folder', 'media', 'html', 'csv',
    'board', 'scriptnote', 'calendar', 'chat',
  ]);
  const _ANNOTATION_DB_HOST_TYPES = new Set([
    'database', 'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db',
  ]);
  let _lastAnnotationPaneId = '';

  function _normalizeDbPaneView(viewName) {
    return viewName === 'database' ? 'pivot' : viewName;
  }

  function _resolveCalendarDbDisplayMode(dbPath, tab) {
    if (!dbPath) return '';
    const tabData = tab?.state?.pivotData || null;
    const globalData = (state?.currentDbPath === dbPath) ? state?.pivotData : null;
    const data = tabData || globalData;
    if (!data) return '';
    let info = null;
    try {
      info = typeof _getCalendarIntegrationInfo === 'function'
        ? _getCalendarIntegrationInfo(dbPath, data)
        : { kind: data.calendar_db ? 'calendar-db' : 'none' };
    } catch {}
    const rawMode = (dbPath && typeof getCurrentViewMode === 'function') ? getCurrentViewMode(dbPath) : '';
    if (['calendar', 'tasks', 'shifts', 'timeline'].includes(rawMode)) return rawMode;
    if (info?.kind === 'calendar-db' || data.calendar_db) return 'calendar';
    return '';
  }

  function _resolveDbPaneDisplayView(viewName, tab) {
    const normalizedViewName = _normalizeDbPaneView(viewName);
    if (!DB_SUB_VIEWS[normalizedViewName]) return normalizedViewName;
    if (normalizedViewName === 'smart-db') return 'smart-db';
    const dbPath = tab?.path || tab?.state?.dbPath || state.currentDbPath || '';
    const mode = (dbPath && typeof getCurrentViewMode === 'function') ? getCurrentViewMode(dbPath) : '';
    let resolvedMode = ['calendar', 'tasks', 'shifts'].includes(mode) ? 'timeline' : mode;
    if (resolvedMode === 'pivot' && _resolveCalendarDbDisplayMode(dbPath, tab)) resolvedMode = 'timeline';
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
    if (tabType === 'chat') {
      return tabPath('chatPath', 'historyPath')
        || (tab?.state?.sessionId ? `chat:${tab.state.sessionId}` : '');
    }
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

  function _isAnnotationHostPaneInfo(info) {
    return !!(info
      && _isPaneActuallyVisible(info.paneId)
      && _ANNOTATION_HOST_TYPES.has(info.activeTab?.type));
  }

  function _annotationAvailabilityForPane(info) {
    if (!_isAnnotationHostPaneInfo(info)) {
      return { enabled: false, target: '', reason: 'この画面では注釈を利用できません' };
    }
    const target = _getAnnotationTargetForTab(info.activeTab);
    if (!target) {
      return { enabled: false, target: '', reason: '保存すると注釈を利用できます' };
    }
    const tabState = info.activeTab?.state || {};
    const readOnly = document.body?.dataset?.cloudReadonly === '1'
      || document.body?.dataset?.cloudQuotaBlocked === '1'
      || info.activeTab?.readOnly === true
      || tabState.readOnly === true
      || tabState.writeBlocked === true
      || tabState.access === 'viewer';
    if (readOnly) {
      return { enabled: false, target, reason: '閲覧専用のため注釈を編集できません' };
    }
    return { enabled: true, target, reason: '' };
  }

  function _applyAnnotationFabAvailability(button, info) {
    if (!button) return;
    const availability = _annotationAvailabilityForPane(info);
    button.disabled = !availability.enabled;
    button.setAttribute('aria-disabled', availability.enabled ? 'false' : 'true');
    button.dataset.annotationTarget = availability.target;
    button.dataset.annotationUnavailableReason = availability.reason;
    button.title = availability.enabled ? '注釈 (Alt+A)' : availability.reason;
    button.setAttribute('aria-label', availability.enabled ? '注釈ツール' : `注釈ツール（${availability.reason}）`);
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
      if (_isAnnotationHostPaneInfo(info)) infos.push(info);
    }
    return infos;
  }

  function _getAnnotationContentPaneInfo(preferredPaneId) {
    const pick = (paneId) => {
      const info = _getPaneInfoById(paneId);
      return _isAnnotationHostPaneInfo(info) ? info : null;
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
      _applyAnnotationFabAvailability(mirror, info);
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
    if (!paneInfo || !_annotationAvailabilityForPane(paneInfo).enabled) return false;
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
    if (typeof _isTrayAnnotationHost === 'function' && _isTrayAnnotationHost()) return;
    const storage = document.getElementById('legacy-views');
    const overlay = document.getElementById('ann-overlay');
    const button = document.getElementById('btn-tb-annotation');
    const paneInfo = _getAnnotationContentPaneInfo(options?.paneId || options?.preferredPaneId || '');
    const paneTarget = _getAnnotationTargetForTab(paneInfo?.activeTab);
    const activeView = _normalizeDbPaneView(paneInfo?.activeTab?.type || state.view);
    const nextTarget = paneInfo ? paneTarget : ((typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : '');
    const host = (paneInfo && _ANNOTATION_HOST_TYPES.has(paneInfo.activeTab.type))
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
    _applyAnnotationFabAvailability(button, host === storage ? null : paneInfo);
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
    let embedded = false;
    if (typeof ann !== 'undefined' && typeof getAnnotationTarget === 'function') {
      embedded = typeof _usesEmbeddedAnnotationSurface === 'function'
        && _usesEmbeddedAnnotationSurface(activeView);
      if (nextTarget !== ann.targetPath) {
        ann.targetPath = nextTarget;
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
    if (typeof _setupOverlayScroll === 'function') {
      _setupOverlayScroll(activeView);
    } else if (embedded) {
      if (typeof _syncAnnStateToIframe === 'function') _syncAnnStateToIframe();
      if (typeof _loadAnnotationsToIframe === 'function') _loadAnnotationsToIframe();
    }
  }

  function _scheduleToolbarRecheck(viewName) {
    const run = () => {
      if (typeof _updateToolbars === 'function') _updateToolbars(viewName || state.view || '');
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 0);
  }

  function _ensureDbSubviewVisibleForPane(paneId, contentEl, viewName, tab) {
    if (!paneId || !contentEl) return;
    const resolvedViewName = _resolveDbPaneDisplayView(viewName, tab);
    if (!DB_SUB_VIEWS[resolvedViewName]) return;
    const viewEl = contentEl.querySelector('#db-view-container, .db-view-container');
    if (!viewEl) return;
    viewEl.style.display = 'flex';
    for (const [type, subId] of Object.entries(DB_SUB_VIEWS)) {
      const subEl = contentEl.querySelector('#' + subId) || document.getElementById(subId);
      if (!subEl) continue;
      const show = (type === resolvedViewName);
      subEl.style.display = show ? (type === 'pivot' || type === 'timeline' || type === 'smart-db' ? '' : 'flex') : 'none';
    }
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
      _ensureDbSubviewVisibleForPane(paneId, contentEl, resolvedViewName, tab);
    } else {
      viewEl.style.display = 'flex';
    }
    if (viewEl.hasAttribute('aria-hidden')) viewEl.setAttribute('aria-hidden', 'false');
    try { if (viewEl.inert) viewEl.inert = false; } catch (e) {}

    if (tab) _bindLiveLegacyContainer(containerId, paneId, tab, viewName, viewEl);
    if (containerId === 'db-view-container') _scheduleToolbarRecheck(viewName);
  }

  // media-view（#media-content）が退避される際、中の動画/音声を一旦停止する。
  // 停止するだけで再生位置の復元は保証しない（不具合Bの対策方針として明示的に許容）。
  // 退避先で別タブの内容へ差し替えられる場合はそのまま消える（DOM自体は
  // openMedia側の innerHTML 上書きで破棄される）ため、バックグラウンド再生・
  // 音声の混入リークを防ぐことが目的。
  function _gbPauseMediaContentPlayback() {
    const container = document.getElementById('media-content');
    if (!container) return;
    container.querySelectorAll('video, audio').forEach(el => {
      try { el.pause(); } catch {}
    });
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
        if (id === 'media-view') _gbPauseMediaContentPlayback();
        el.style.display = 'none';
        storage.appendChild(el);
        delete _containerPane[id];
      }
    });
  }

  // シート用ツールバー（#app-toolbar）をペインから退避場所へ戻す。
  // ToolComponent 型（スケジュール・ボード・シナリオ等）の mount() は appendChild するだけで
  // コンテナを空にしないため、直前に表示していたシートのツールバーがペインの先頭に残ったまま、
  // その下にツール本体のUIが積まれて二重表示になる。_retractLegacyFromPane() の退避対象は
  // レガシーコンテナのIDだけで #app-toolbar を含まないため、ここで別途戻す。
  // ID が重複して複製されている場合に取りこぼさないよう、getElementById ではなく
  // contentEl 配下の全一致を対象にする。
  function _retractAppToolbarFromPane(contentEl) {
    if (!contentEl) return;
    const storage = document.getElementById('legacy-views');
    if (!storage) return;
    contentEl.querySelectorAll('#app-toolbar').forEach(appTb => {
      appTb.classList.remove('visible');
      storage.appendChild(appTb);
    });
  }

  function _retractContainer(containerId) {
    const storage = document.getElementById('legacy-views');
    const el = document.getElementById(containerId);
    if (el && storage) {
      if (containerId === 'media-view') _gbPauseMediaContentPlayback();
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
  const TOOL_HOST_PANE_TYPES = new Set([...PRIMARY_TOOL_PANE_TYPES, 'detail', 'version']);
  const FILE_OPEN_AVOID_PANE_TYPES = new Set([
    ...NAV_PANE_TYPES,
    ...PRIMARY_TOOL_PANE_TYPES,
    'detail',
    'preview',
    'version',
  ]);
  const FILE_SHOW_VIEW_TYPES = new Set(Object.keys(LEGACY_CONTAINERS).filter(type => type !== 'welcome'));
  const TOOLBAR_DB_VIEW_TYPES = new Set(['pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db']);
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
    'tags',
  ]);

  function _isPassiveToolPaneTab(type, tab) {
    const rawType = type || tab?.type || '';
    const normalizedType = rawType === 'sticky' ? 'annotation' : rawType;
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
      historyLabel: 'レイアウト: メインパネルを作成',
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
    const mainPaneId = typeof GBPaneDefaultLayout !== 'undefined' && typeof GBPaneDefaultLayout.resolveMainPaneId === 'function'
      ? GBPaneDefaultLayout.resolveMainPaneId({ contentOnly: true })
      : '';
    if (mainPaneId) return mainPaneId;
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
    if (opts.ensureWorkPane) {
      const ensuredPaneId = _createFileOpenPaneNear(paneId);
      if (ensuredPaneId) return ensuredPaneId;
    }
    for (const p of allPanes) {
      if (p.id === paneId || !_isPaneActuallyVisible(p.id)) continue;
      if (_isFileOpenPaneCandidate(p, { allowLocked: true })) return p.id;
    }
    for (const p of allPanes) {
      if (p.id === paneId) continue;
      if (_isFileOpenPaneCandidate(p, { allowLocked: true })) return p.id;
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

  function _visibleDbToolbarContextForPane(paneId) {
    const info = _getPaneInfoById(paneId);
    if (!info || !_isPaneActuallyVisible(info.paneId)) return null;
    const viewEl = info.contentEl.querySelector?.('#db-view-container, .db-view-container') || null;
    if (!viewEl) return null;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(viewEl) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return null;
    const toolbarView = _toolbarViewForTab(info.activeTab);
    const normalizedView = _normalizeDbPaneView(toolbarView || info.activeTab?.type || '');
    if (!TOOLBAR_DB_VIEW_TYPES.has(normalizedView)) return null;
    return { ...info, viewName: _resolveDbPaneDisplayView(normalizedView, info.activeTab) };
  }

  function _findVisibleDbToolbarContext() {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return null;
    const paneIds = [];
    const seen = new Set();
    const pushPaneId = (paneId) => {
      if (!paneId || seen.has(paneId)) return;
      seen.add(paneId);
      paneIds.push(paneId);
    };
    const activePaneId = GBLayout.activePane || '';
    pushPaneId(_containerPane['db-view-container']);
    pushPaneId(_getFileOpenPane(activePaneId));
    pushPaneId(_getContentPane(activePaneId));
    const panes = typeof GBLayout.getAllPanes === 'function'
      ? GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || []
      : [];
    panes.filter(pane => _isPaneActuallyVisible(pane.id)).forEach(pane => pushPaneId(pane.id));
    panes.forEach(pane => pushPaneId(pane.id));
    for (const paneId of paneIds) {
      const context = _visibleDbToolbarContextForPane(paneId);
      if (context) return context;
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
      // ここに来るのはファイル・バージョン・サブパネルなどをユーザーが開いた場合。
      // ユーザー操作起点として、閉じている固定レールも開く。
      GBLayout.revealPane(paneId, { userIntent: true });
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
    const isEligiblePane = (pane) => {
      const activeTab = pane.tabs?.[pane.activeTabIndex];
      return !activeTab || !NAV_PANE_TYPES.has(activeTab.type);
    };
    const findReusable = (panes) => {
      for (const pane of panes) {
        if ((pane.tabs || []).some(t => PRIMARY_TOOL_PANE_TYPES.has(t.type))) {
          return { paneId: pane.id, reusable: true };
        }
      }
      for (const pane of panes) {
        if (_isVersionHostPane(pane)) {
          return { paneId: pane.id, reusable: true };
        }
      }
      return null;
    };
    const visiblePanes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }).filter(isEligiblePane);
    const allPanes = GBLayout.getAllPanes(GBLayout.root).filter(isEligiblePane);
    const visiblePreferred = visiblePanes.filter(pane => !pane.locked);
    const allPreferred = allPanes.filter(pane => !pane.locked);
    const visibleCandidatePanes = visiblePreferred.length ? visiblePreferred : visiblePanes;
    const allCandidatePanes = allPreferred.length ? allPreferred : allPanes;
    const visibleMatch = findReusable(visibleCandidatePanes);
    if (visibleMatch) return visibleMatch;
    const allMatch = findReusable(allCandidatePanes);
    if (allMatch) return allMatch;
    const activeContentPane = _getContentPane(GBLayout.activePane);
    const activeContentInfo = activeContentPane ? GBLayout.findNode(GBLayout.root, activeContentPane)?.node : null;
    const fallbackPaneId = activeContentInfo && !activeContentInfo.locked
      ? activeContentPane
      : allCandidatePanes[allCandidatePanes.length - 1]?.id || allPanes[allPanes.length - 1]?.id || null;
    return { paneId: fallbackPaneId, reusable: false };
  }

  function _updateVersionTab(tab, label, versionType, versionPath, follow) {
    if (!tab) return;
    tab.label = label;
    if (versionPath != null) tab.path = versionPath || '';
    tab.icon = GBTabs.tabIcon('version');
    const path = tab.path || tab.state?.versionPath || '';
    tab.state = { ...(tab.state || {}), versionType, versionPath: path, versionFollow: !!follow };
  }

  // ================================================================
  // showView() オーバーライド
  // ================================================================
  function _overrideShowView() {
    const _origShowView = window.showView;

    window.showView = function(viewName, ctx) {
      // スプリットペイン内のビュー切替はそのまま
      if (ctx && ctx.containerEl) {
        const result = _origShowView(viewName, ctx);
        // 埋め込みシートは親ツール（例: スケジュール）の中だけで描画する。
        // ここで通常シート用の全体ツールバーを更新すると、親ツール自身の
        // ツールバーの上へ #app-toolbar / #tb-db が追加表示されてしまう。
        if (ctx.embedded === true) return result;
        const toolbarViewForPaneRender = ['calendar', 'tasks', 'shifts'].includes(viewName) ? 'timeline' : _normalizeDbPaneView(viewName);
        if (TOOLBAR_DB_VIEW_TYPES.has(toolbarViewForPaneRender)) {
          _updateToolbars(toolbarViewForPaneRender);
          _scheduleToolbarRecheck(toolbarViewForPaneRender);
        }
        return result;
      }
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
