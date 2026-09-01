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
      if (typeof _clearDetailPaneShell === 'function') _clearDetailPaneShell();
    }
    const previewPane = document.getElementById('gb-preview-pane');
    if (previewPane && previewPane.closest('.gb-pane-content')) {
      previewPane.innerHTML = '<div style="color:var(--fg2);font-size:13px;">ファイルを選択するとプレビューが表示されます</div>';
    }
  }

  // ツールバー更新（v5.0: ツールバーをペインのcontentEl先頭に動的配置）
  // そのパネルが今ツール本体（スケジュール・ボード・シナリオ・タイマー等）を表示しているか。
  // 表示中ならシート用ツールバーを差し込まない。_scheduleToolbarRecheck() は古いビュー名を
  // 抱えたまま遅延実行されるため、タブを切り替えた後に「シート表示中」として再挿入され、
  // ツール本体の上にシートのツールバーが重なる（二重表示）ことがある。
  function _paneShowsComponentTool(paneInfo) {
    const node = paneInfo?.node;
    const tabs = node?.tabs;
    if (!Array.isArray(tabs)) return false;
    const idx = node.activeTabIndex;
    if (!(idx >= 0 && idx < tabs.length)) return false;
    return COMPONENT_TYPES.has(tabs[idx]?.type);
  }

  function _updateToolbars(viewName) {
    const toolbarContext = _resolveToolbarContext(viewName);
    const toolbarViewName = toolbarContext.viewName;
    const isDbView = TOOLBAR_DB_VIEW_TYPES.has(toolbarViewName);
    const shouldUseVisibleDbFallback = !isDbView && (!toolbarViewName || _isToolbarUtilityView(toolbarViewName) || _isToolbarUtilityView(viewName));
    const visibleDbToolbarContext = shouldUseVisibleDbFallback ? _findVisibleDbToolbarContext() : null;
    const effectiveToolbarContext = visibleDbToolbarContext || toolbarContext;
    const effectiveToolbarViewName = visibleDbToolbarContext?.viewName || toolbarViewName;
    const effectiveIsDbView = isDbView || !!visibleDbToolbarContext;
    const showRt = (toolbarViewName === 'page');
    const showToolbar = isDbView || showRt;
    const effectiveShowRt = (effectiveToolbarViewName === 'page');
    const effectiveShowToolbar = effectiveIsDbView || effectiveShowRt || showToolbar;

    const appTb = effectiveShowToolbar ? _ensureAppToolbarElement() : document.getElementById('app-toolbar');
    const tbDb = appTb?.querySelector?.('#tb-db') || document.getElementById('tb-db');
    if (tbDb) tbDb.style.display = effectiveIsDbView ? 'contents' : 'none';
    const rtTb = appTb?.querySelector?.('#rt-toolbar') || document.getElementById('rt-toolbar');
    // page-view内に専用ツールバー(#page-rt-toolbar)があるので、app-toolbar内のrt-toolbarは常に非表示
    if (rtTb) rtTb.style.display = 'none';
    if (appTb) appTb.classList.toggle('visible', effectiveIsDbView);

    // ツールバーをアクティブペインのcontentElの先頭に移動
    if (appTb && effectiveShowToolbar) {
      const paneId = toolbarContext.paneId || _getFileOpenPane(GBLayout.activePane) || _getContentPane(GBLayout.activePane);
      const mountPaneId = effectiveToolbarContext.paneId || paneId;
      if (mountPaneId) {
        const paneInfo = GBLayout.paneMap[mountPaneId];
        if (paneInfo && paneInfo.contentEl && appTb.parentNode !== paneInfo.contentEl
            && !_paneShowsComponentTool(paneInfo)) {
          paneInfo.contentEl.insertBefore(appTb, paneInfo.contentEl.firstChild);
        }
      }
    }

    const entityRt = document.getElementById('entity-rt-toolbar');
    if (entityRt) {
      const entityFreeText = document.getElementById('entity-freetext');
      const hasEntityNote = effectiveToolbarViewName === 'entity'
        && entityFreeText?.dataset?.entityNoteCreated === '1'
        && entityFreeText.style.display !== 'none';
      entityRt.style.display = hasEntityNote ? 'flex' : 'none';
    }

    const sc = document.getElementById('sb-shortcuts');
    if (sc) {
      if (effectiveIsDbView) {
        const csvSheetActive = typeof isCsvSheetModeActive === 'function' && isCsvSheetModeActive();
        if (csvSheetActive && typeof updateCsvShortcutStatusbar === 'function') updateCsvShortcutStatusbar(sc);
        else if (typeof updateDatabaseShortcutStatusbar === 'function') updateDatabaseShortcutStatusbar(sc);
        else sc.textContent = '';
      }
      else if (['entity', 'page'].includes(effectiveToolbarViewName)) {
        sc.textContent = 'Ctrl+B 太字 | Ctrl+I 斜体 | Ctrl+U 下線 | Ctrl+Shift+1~6 見出し | Ctrl+Shift+8 箇条書き';
      } else if (effectiveToolbarViewName === 'scriptnote') {
        if (typeof updateScriptnoteShortcutStatusbar === 'function') updateScriptnoteShortcutStatusbar(sc);
        else sc.textContent = 'Enter 行追加 | Ctrl+Enter 同タイプ行追加 | Shift+Del 行削除 | Tab タイプ選択 | Ctrl+↑↓ 行移動 | Ctrl+R ルビ | Ctrl+Z Undo | Ctrl+Y Redo';
      } else if (effectiveToolbarViewName === 'media') {
        if (typeof updateMediaViewerShortcutStatusbar === 'function') updateMediaViewerShortcutStatusbar(sc);
        else sc.textContent = '';
      } else sc.textContent = '';
    }
  }

  // ================================================================
  // navPush() オーバーライド
  // ================================================================
  // openMedia が navPush に渡す entry（{type, label, path, mediaType, viewerUrl}）から、
  // タブへ保存すべき state を組み立てる。従来は entry.mediaType のみ保存しており、
  // entry.viewerUrl（シート内ギャラリー等が渡す特殊なビューワーURL。例:
  // gb-db-image-gallery.js の openMedia(..., {viewerUrl})）が保存されず、タブ復帰時の
  // 再読み込み（_ensureLegacyTabContent）で汎用URLへ差し替わってしまっていた
  // （不具合B関連の取りこぼし。共有コンテナの実内容検証は _gbMediaTabExpectedSignature /
  // _gbVerifyAndFixMediaContainer 参照）。
  function _gbNavPushMediaTabState(entry) {
    if (entry.type === 'compare') {
      return { pathA: entry.pathA || '', pathB: entry.pathB || '' };
    }
    if (!entry.mediaType && !entry.viewerUrl) return {};
    const st = {};
    if (entry.mediaType) st.mediaType = entry.mediaType;
    if (entry.viewerUrl) st.viewerUrl = entry.viewerUrl;
    return st;
  }

  function _overrideNavPush() {
    const _prevNavPush = navPush; // gb-app.jsの上書き版

    navPush = async function(entry, paneId) {
      const targetPaneId = paneId || _getFileOpenPane(GBLayout.activePane);
      const shouldUpdateTab = !!targetPaneId && !_bridgeUpdating && _initialized
        && !!entry && !!entry.type && entry.type !== 'welcome';

      // タブ更新対象が定まらない/ブリッジ未初期化/再入中/welcome型は、従来どおり
      // 履歴記録（gb-app.jsの上書き版）だけを行って抜ける。
      if (!shouldUpdateTab) {
        if (targetPaneId) _prevNavPush(entry, targetPaneId);
        return;
      }

      _beginBridgeUpdate();
      try {
        const label = entry.label || entry.path?.split('/').pop() || '(無題)';
        const path = entry.path || entry.dbPath || '';
        const type = entry.type;

        // ナビ/補助ペインではなく、作業用ペインのアクティブタブを上書きする
        const paneInfo = GBLayout.findNode(GBLayout.root, targetPaneId);
        if (!paneInfo) {
          _prevNavPush(entry, targetPaneId);
          return;
        }
        const pane = paneInfo.node;
        let tabAddedByManager = false;
        // フォルダは必ず現在のアクティブタブを更新/置換する。
        // 履歴再生中（navBack/navForward/履歴ドロップダウン経由、navNavigating=true）は、
        // 同ペイン内の「別の」フォルダタブへ activeTabIndex を強制切替する
        // ハイジャックを行わない。戻る/進むでタブが絶対に切り替わらないことを保証するため、
        // 常に「アクティブタブをその場で上書き」する分岐へ落とす
        // （副作用として、再生後に同ペイン内へフォルダタブが一時的に2枚並ぶことがあるが、
        // 既知の制限として許容する）。
        if (type === 'folder') {
          const activeTab = pane.tabs[pane.activeTabIndex] || null;
          const folderTab = activeTab?.type === 'folder' ? activeTab : null;
          if (folderTab) {
            folderTab.label = label;
            folderTab.path = path;
            folderTab.state = {};
            // 同じフォルダタブ内の移動ではペイン全体を再描画しない。
            const tabEl = GBLayout.paneMap[targetPaneId]?.el?.querySelector('.gb-tab.active .gb-tab-label');
            if (tabEl) tabEl.textContent = label;
            GBLayout.saveLayout({ immediate: true });
          } else if (pane.tabs.length > 0 && pane.activeTabIndex >= 0) {
            const tab = pane.tabs[pane.activeTabIndex];
            if (typeof removeComponentInstanceSafely === 'function') {
              if (!await removeComponentInstanceSafely(tab.id)) return false;
            } else if (typeof removeComponentInstance === 'function'
              && removeComponentInstance(tab.id) === false) {
              return false;
            }
            tab.type = type;
            tab.label = label;
            tab.path = path;
            tab.state = {};
            tab.icon = GBTabs.tabIcon(type);
            GBLayout.render();
            GBLayout.saveLayout({ immediate: true });
          } else {
            GBTabs.addTab(targetPaneId, label, type, path, null, { preferTargetPane: true });
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
            tab.state = _gbNavPushMediaTabState(entry);
            tab.label = label;
            tab.path = path;
            // タブバーのラベルを直接更新（full render を避ける）
            const tabEl = GBLayout.paneMap[targetPaneId]?.el?.querySelector('.gb-tab.active .gb-tab-label');
            if (tabEl) tabEl.textContent = label;
            GBLayout.saveLayout({ immediate: true });
          } else {
            // 別タイプへのナビゲーション: コンポーネントを破棄して置換、full render
            if (typeof removeComponentInstanceSafely === 'function') {
              if (!await removeComponentInstanceSafely(tab.id)) return false;
            } else if (typeof removeComponentInstance === 'function'
              && removeComponentInstance(tab.id) === false) {
              return false;
            }
            tab.state = _gbNavPushMediaTabState(entry);
            tab.type = type;
            tab.label = label;
            tab.path = path;
            tab.icon = GBTabs.tabIcon(type);
            GBLayout.render();
            GBLayout.saveLayout({ immediate: true });
          }
        } else {
          GBTabs.addTab(targetPaneId, label, type, path, null, { preferTargetPane: true });
          tabAddedByManager = true;
        }
        if (!tabAddedByManager) _focusFileOpenPane(targetPaneId);

        // タブの解決/更新が確定した後に基底の navPush を呼ぶ（②タブ別ナビ履歴、2026-07-21）。
        // 旧実装は push→タブ更新の順だったため、addTab のdedup 再利用やフォルダタブ再利用で
        // 「これから表示されるタブ」とは別のタブが最終的にアクティブになった場合、履歴エントリが
        // 直前にアクティブだったタブ側へ誤って積まれていた（タブ複数時に履歴が混線するバグの一因）。
        // pane.activeTabIndex が確定した後に push することで、_getNavState が解決する
        // 「今アクティブなタブ」に必ず一致させる。
        _prevNavPush(entry, targetPaneId);

        // 追従バージョン管理タブの同期。
        // 同一タブ内で別ファイルを開いた場合（例: ノート内リンクから別ノートへ）は
        // 対象ペインが既にアクティブのままで GBLayout.setActivePane が呼ばれず
        // onActivePaneChange 経由の同期が発火しないため、ここで明示的に同期する。
        // 分岐によらず一度だけ呼べば十分なので、if/else の外・try の末尾に置く。
        if (typeof _syncFollowingVersionTabs === 'function') _syncFollowingVersionTabs();
        return true;
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
      type = typeof _normalizeOpenTypeForNav === 'function' ? _normalizeOpenTypeForNav(type) : (type || 'page');
      const paneId = _getFileOpenPane(GBLayout.activePane, { ensureWorkPane: true });
      const tabId = paneId ? GBTabs.addTab(paneId, label, type, path, null, { preferTargetPane: true }) : null;
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
    window.openToolTab = function(toolType, options) {
      const openOpts = options || {};
      const labels = {
        page: 'ノート', scriptnote: 'シナリオ', database: 'シート',
        board: 'ボード', calendar: 'スケジュール',
        folder: 'フォルダ', outliner: 'フォルダツリー',
        search: '検索',
      };
      const existingGlobal = (typeof GBTabs !== 'undefined' && typeof GBTabs.findPaneWithTab === 'function')
        ? (openOpts.preferTargetPane ? null : (GBTabs.findPaneWithTab(toolType, '') || _findToolPaneInAnyGroup(toolType)))
        : null;
      if (existingGlobal) {
        _activateToolPaneMatch(existingGlobal);
        return;
      }
      const paneId = openOpts.paneId || _getContentPane(GBLayout.activePane);
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
      const tabId = GBTabs.addTab(paneId, labels[toolType] || toolType, toolType, '', null, {
        preferTargetPane: !!openOpts.preferTargetPane,
      });
      if (tabId) _showEmptyToolView(toolType);
    };

    // パネルメニュー経由の「常に新規タブとして追加」動作（C案 — 他のパネルセットに同種のタブがあっても新規追加する）
    const _PANEL_MENU_LABELS = {
      page: 'ノート', scriptnote: 'シナリオ', database: 'シート',
      board: 'ボード', calendar: 'スケジュール',
      folder: 'フォルダ',
      outliner: 'フォルダツリー', preview: 'ビューワー', detail: 'オプション',
      chat: 'チャット', history: 'ヒストリー', annotation: 'アノテート',
    };
    const _PANEL_FILE_CREATE_TYPES = new Set(['page', 'scriptnote', 'database', 'board']);
    // API の type 値 → タブの type 値（同名なら省略）
    // ここに無いタイプは toolType がそのままタブ type になる
    const _PANEL_FILE_OPEN_TYPES = {
      database: 'pivot',
    };
    // _createPanelFileTab で受け付ける API type のホワイトリスト。
    // ここに無い toolType を弾くことで、API が知らない type を投げて 200 で空 node が返るケースを防ぐ。
    function _isPanelFileCreateType(toolType) {
      return _PANEL_FILE_CREATE_TYPES.has(toolType);
    }
    function _panelFileTabState(toolType, name, path) {
      const state = { label: name };
      if (toolType === 'scriptnote') state.scenarioPath = path;
      if (toolType === 'board') state.boardPath = path;
      if (toolType === 'database') state.dbPath = path;
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
      if (!_isPanelFileCreateType(toolType)) {
        if (typeof showStatus === 'function') showStatus('未対応のファイル種別です: ' + toolType, true);
        return null;
      }
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
          const updated = GBTabs.updateTab(paneId, pendingTabId, { label: name, type: openType, path, state }, { activate: true });
          if (updated && typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.refreshPaneAfterTabSwitch === 'function') {
            GBPaneBridge.refreshPaneAfterTabSwitch(paneId);
          }
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
    const _MAIN_PANEL_TAB_TYPES = new Set(['folder', 'page', 'scriptnote', 'database', 'board', 'calendar']);
    function _isMainPanelPane(paneId) {
      const pane = GBLayout.findNode?.(GBLayout.root, paneId)?.node;
      return !!(pane && (pane.meldexRole === 'main' || pane.id === 'pane-main'));
    }
    function _guardMainPanelTabType(paneId, toolType) {
      if (!_isMainPanelPane(paneId) || _MAIN_PANEL_TAB_TYPES.has(toolType)) return true;
      if (typeof showStatus === 'function') showStatus('補助パネルはメインパネルでは開けません', true);
      return false;
    }

    window.addPanelMenuTool = function(toolType, options) {
      // ＋ボタン／パネルメニューから呼ばれた時は、メニューを開いたペインへ追加する。
      // paneId 未指定の既存呼び出しだけ、現在アクティブなペインを使う。
      const paneId = options?.paneId || GBLayout.activePane;
      if (!paneId) return null;
      if (!GBLayout.findNode?.(GBLayout.root, paneId)) return null;
      if (!_guardMainPanelTabType(paneId, toolType)) return null;
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
      if (!_guardMainPanelTabType(paneId, 'version')) return null;
      if (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(paneId)) {
        if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
        return null;
      }
      // パネルメニュー／コマンドパレット経由は「今アクティブなファイル」を追いかける追従タブとして開く。
      // 対象未指定で開いた場合も、後から対象ができた時に自動で反映されるよう追従フラグを立てておく。
      const tabId = GBTabs.addTab(paneId, label, 'version', path, { versionType: vType, versionPath: path, versionFollow: true });
      if (!tabId) return null;
      if (hasPath) {
        const comp = typeof getComponentInstance === 'function' ? getComponentInstance(tabId) : null;
        if (comp && comp._loadVersions) comp._loadVersions(path, vType);
      }
      return tabId;
    };

    function _loadVersionTab(tabId, path, vType) {
      if (!tabId || !path) return;
      const comp = typeof getComponentInstance === 'function' ? getComponentInstance(tabId) : null;
      if (comp && comp._loadVersions) comp._loadVersions(path, vType || 'file');
    }

    // バージョン管理タブを開く（path が空でも「対象未指定」の状態で開ける）
    // options.follow=true で開いた場合、対象未指定で終わらせず「今アクティブなファイル」を
    // 自動で追いかける追従タブになる（メインパネルのファイル切替に応じて表示対象が変わる）。
    // 省略時（false）は従来通り、渡された path に固定されたピン留めタブになる。
    window.openVersionTab = function(path, versionType, options) {
      const vType = versionType || 'file';
      const follow = !!options?.follow;
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
            const emptyLocked = typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(emptyExisting.paneId);
            if (!emptyLocked) {
              _updateVersionTab(emptyTab, label, vType, path, follow);
              GBLayout.render();
              GBLayout.saveLayout();
              _expandCollapsedPane(emptyExisting.paneId);
              GBTabs.activateTab(emptyExisting.paneId, emptyExisting.tabId);
              _loadVersionTab(emptyExisting.tabId, path, vType);
              return emptyExisting.tabId;
            }
          }
        }
      }

      const existing = GBTabs.findPaneWithTab('version', searchPath);

      if (existing) {
        const existingPaneInfo = GBLayout.findNode(GBLayout.root, existing.paneId);
        const existingTab = existingPaneInfo?.node?.tabs?.find(t => t.id === existing.tabId);
        const existingLocked = typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(existing.paneId);
        if (_isVersionHostPane(existingPaneInfo?.node)) {
          if (!existingLocked) _updateVersionTab(existingTab, label, vType, searchPath, follow);
          GBLayout.render();
          GBLayout.saveLayout();
          _expandCollapsedPane(existing.paneId);
          GBTabs.activateTab(existing.paneId, existing.tabId);
          _loadVersionTab(existing.tabId, searchPath, vType);
          return existing.tabId;
        }
        if (hostInfo.reusable && hostInfo.paneId && hostInfo.paneId !== existing.paneId) {
          if (existingLocked ||
              (typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(hostInfo.paneId))) {
            GBTabs.activateTab(existing.paneId, existing.tabId);
            return existing.tabId;
          }
          _updateVersionTab(existingTab, label, vType, searchPath, follow);
          _expandCollapsedPane(hostInfo.paneId);
          GBTabs.moveTab(existing.paneId, existing.tabId, hostInfo.paneId);
          GBTabs.activateTab(hostInfo.paneId, existing.tabId);
          _loadVersionTab(existing.tabId, searchPath, vType);
          return existing.tabId;
        }
        if (existingLocked) {
          GBTabs.activateTab(existing.paneId, existing.tabId);
          _loadVersionTab(existing.tabId, searchPath, vType);
          return existing.tabId;
        }
        _updateVersionTab(existingTab, label, vType, searchPath, follow);
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
        _loadVersionTab(existing.tabId, searchPath, vType);
        return existing.tabId;
      }

      if (hostInfo.reusable && hostInfo.paneId) {
        _expandCollapsedPane(hostInfo.paneId);
        const tabId = GBTabs.addTab(hostInfo.paneId, label, 'version', searchPath, { versionType: vType, versionPath: searchPath, versionFollow: follow });
        _loadVersionTab(tabId, searchPath, vType);
        return tabId;
      }

      const sourcePaneId = hostInfo.paneId;
      if (!sourcePaneId) return null;
      const tab = GBTabs.createTab(label, 'version', searchPath, { versionType: vType, versionPath: searchPath, versionFollow: follow });
      const newPane = GBLayout.createPaneNode(null, [tab], 0);
      const newPaneId = GBLayout.splitPane(sourcePaneId, 'horizontal', 'right', newPane);
      if (newPaneId) {
        GBLayout.setActivePane(newPaneId);
        if (typeof _refreshPaneAfterTabSwitch === 'function') {
          _refreshPaneAfterTabSwitch(newPaneId);
        }
        _loadVersionTab(tab.id, searchPath, vType);
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
          board: 'ボード', calendar: 'スケジュール', preview: 'ビューワー',
          folder: 'フォルダ', chat: 'チャット', history: 'ヒストリー',
          annotation: 'アノテート', detail: 'オプション',
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
