      page: 'ノート', scriptnote: 'シナリオ', database: 'シート',
      board: 'ボード', calendar: 'スケジュール',
      'smart-db': 'スマートシート', folder: 'フォルダ',
      };
      const containerId = LEGACY_CONTAINERS[toolType];
      if (!containerId) return;
      const el = document.getElementById(containerId);
      if (!el) return;
      const label = labels[toolType] || toolType;
      // 空状態オーバーレイを表示（既存コンテンツの上に）
      let emptyEl = el.querySelector('.gb-empty-state');
      if (!emptyEl) {
        emptyEl = document.createElement('div');
        emptyEl.className = 'gb-empty-state';
        emptyEl.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg);z-index:5;gap:12px;';
        el.style.position = 'relative';
        el.appendChild(emptyEl);
      }
      emptyEl.innerHTML = '<div style="font-size:36px;color:var(--fg2);">' + (typeof lucide === 'function' ? lucide(GBTabs.tabIcon(toolType), 48) : '') + '</div>'
        + '<div style="font-size:16px;color:var(--fg);">' + label + '</div>'
        + '<div style="font-size:13px;color:var(--fg2);">ファイルを開くか、新規作成してください</div>'
        + '<button class="gb-empty-create-btn" style="margin-top:8px;padding:6px 16px;background:var(--accent);color:var(--ui-accent-fg, var(--ui-fg-strong));border:none;border-radius:6px;cursor:pointer;font-size:13px;">+ 新規作成</button>';
      const createBtn = emptyEl.querySelector('.gb-empty-create-btn');
      createBtn.dataset.e2eId = `empty-create-${toolType}`;
      createBtn.addEventListener('click', () => {
        emptyEl.remove();
        if (typeof showAddOutlinerItem === 'function') showAddOutlinerItem(toolType);
      });
    }

    // サイドバートグル → フォルダツリーペインの開閉
    window.toggleSidebar = function() {
      if (window.MeldexCloudMobile?.toggleSidebarDrawer?.()) return;
      _openToolPane('outliner', { toggleExisting: true });
    };

    // オプションパネルトグル → 詳細タブとして開く
    window.toggleOptionPanel = function(source) {
      _openToolPane('detail', { toggleExisting: true, source });
    };
    window.toggleDetailPanel = window.toggleOptionPanel;
  }

  // ================================================================
  // 右パネル廃止 → ペインタブ化
  // ================================================================
  function _overrideRightPanel() {
    // 右パネルを非表示
    const rp = document.getElementById('right-panel');
    const rrh = document.getElementById('right-resize-handle');
    const rab = document.getElementById('activity-bar-right');
    if (rp) rp.style.display = 'none';
    if (rrh) rrh.style.display = 'none';
    // 右アクティビティバーは残す（ペインタブ開きのトリガーとして使う）

    function _syncLegacyRightPanelState(tabName) {
      const normalized = tabName === 'sticky' ? 'annotation' : tabName;
      document.querySelectorAll('#right-panel-tabs .rp-tab').forEach(tab => {
        const active = tab.dataset.rpTab === normalized;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('#right-panel .rp-content').forEach(content => {
        content.classList.toggle('active', content.id === 'rp-' + normalized);
      });
      if (typeof window._updateRabActiveState === 'function') {
        window._updateRabActiveState(normalized);
        return;
      }
      document.querySelectorAll('#activity-bar-right button').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      });
      const rail = normalized ? document.getElementById('rab-' + normalized) : null;
      if (rail) {
        rail.classList.add('active');
        rail.setAttribute('aria-pressed', 'true');
      }
    }

    // toggleRightPanelTab → ペインにツールを開く
    window.toggleRightPanelTab = function(tabName, source) {
      if (!_guardRightSidebarTool(tabName, source)) return;
      _syncLegacyRightPanelState(tabName);
      _openToolPane(tabName, { toggleExisting: true, source });
    };
    window.openRightPanelTab = function(tabName, source) {
      if (!_guardRightSidebarTool(tabName, source)) return;
      _syncLegacyRightPanelState(tabName);
      _openToolPane(tabName, { source, userIntent: true });
    };
    window.toggleRightPanel = function(source) {
      if (!_guardRightSidebarTool('chat', source)) return;
      const rightPanelTypes = ['chat', 'calendar', 'timer', 'history', 'annotation', 'preview', 'detail'];
      let closed = 0;
      rightPanelTypes.forEach((type) => {
        for (let guard = 0; guard < 20; guard += 1) {
          const found = GBTabs.findPaneWithTab(type, '');
          if (!found) break;
          GBTabs.closeTab(found.paneId, found.tabId);
          closed += 1;
        }
      });
      if (!closed) {
        _openToolPane('chat', { source });
      }
    };

    // switchRightTab → ペインタブ切替
    window.switchRightTab = function(tabName, source) {
      if (!_guardRightSidebarTool(tabName, source)) return;
      _syncLegacyRightPanelState(tabName);
      _openToolPane(tabName, { source });
    };

    // 旧スプリットビュー → ペイン分割に置換
    let _legacySplitPair = null;
    function _nodeContainsPane(node, paneId) {
      if (!node || !paneId) return false;
      if (node.type === 'pane') return node.id === paneId;
      if (node.type === 'split') return (node.children || []).some(child => _nodeContainsPane(child, paneId));
      if (node.type === 'panelset' && Array.isArray(node.groups)) {
        return node.groups.some(group => _nodeContainsPane(group?.root, paneId));
      }
      return false;
    }
    function _findDirectParentSplit(root, paneId) {
      if (!root || !paneId) return null;
      if (root.type === 'split') {
        for (const child of (root.children || [])) {
          if (!child || !_nodeContainsPane(child, paneId)) continue;
          return _findDirectParentSplit(child, paneId) || root;
        }
        return null;
      }
      if (root.type === 'panelset' && Array.isArray(root.groups)) {
        for (const group of root.groups) {
          const found = _findDirectParentSplit(group?.root, paneId);
          if (found) return found;
        }
      }
      return null;
    }
    function _getLegacySplitPair() {
      if (!_legacySplitPair?.sourcePaneId || !_legacySplitPair?.splitPaneId) {
        _legacySplitPair = null;
        return null;
      }
      const sourcePane = GBLayout.findNode(GBLayout.root, _legacySplitPair.sourcePaneId)?.node;
      const splitPane = GBLayout.findNode(GBLayout.root, _legacySplitPair.splitPaneId)?.node;
      if (!sourcePane || !splitPane || sourcePane.type !== 'pane' || splitPane.type !== 'pane') {
        _legacySplitPair = null;
        return null;
      }
      const sourceParent = _findDirectParentSplit(GBLayout.root, sourcePane.id);
      const splitParent = _findDirectParentSplit(GBLayout.root, splitPane.id);
      if (!sourceParent || sourceParent !== splitParent) {
        _legacySplitPair = null;
        return null;
      }
      return { sourcePane, splitPane };
    }
    function _disposePaneTabs(pane) {
      pane?.tabs?.forEach(t => {
        if (typeof removeComponentInstance === 'function') removeComponentInstance(t.id);
      });
    }
    function _entryFromSplitArg(splitArg) {
      if (!splitArg) return null;
      if (typeof splitArg === 'object') {
        const path = splitArg.path || splitArg.dbPath || '';
        return {
          label: splitArg.label || path.split('/').pop() || '(無題)',
          type: splitArg.type || 'pivot',
          path,
        };
      }
      const path = String(splitArg || '');
      return { label: path.split('/').pop() || path || '(無題)', type: 'pivot', path };
    }
    function _replacePaneWithEntry(pane, entry) {
      if (!pane || pane.type !== 'pane' || !entry) return false;
      _disposePaneTabs(pane);
      pane.tabs = [GBTabs.createTab(entry.label, entry.type, entry.path)];
      pane.activeTabIndex = 0;
      GBLayout.render();
      GBLayout.saveLayout();
      GBLayout.setActivePane(pane.id);
      return true;
    }
    function _activateLegacySplitView(splitArg) {
      if (GBLayout.isMaximized()) { GBLayout.restoreMaximizedPane(); return false; }
      const requestedEntry = _entryFromSplitArg(splitArg);
      const existingPair = _getLegacySplitPair();
      if (existingPair) {
        if (requestedEntry) _replacePaneWithEntry(existingPair.splitPane, requestedEntry);
        return true;
      }
      const paneId = GBLayout.activePane;
      if (!paneId) return false;
      const activeTab = GBTabs.getActiveTab(paneId);
      const entry = requestedEntry || {
        label: activeTab ? activeTab.label : '(無題)',
        type: activeTab ? activeTab.type : 'welcome',
        path: activeTab ? activeTab.path : '',
      };
      const tab = GBTabs.createTab(entry.label, entry.type, entry.path);
      const newPane = GBLayout.createPaneNode(null, [tab], 0);
      const splitPaneId = GBLayout.splitPane(paneId, 'horizontal', 'right', newPane);
      if (!splitPaneId) return false;
      _legacySplitPair = { sourcePaneId: paneId, splitPaneId };
      GBLayout.setActivePane(splitPaneId);
      return true;
    }
    function _deactivateLegacySplitView() {
      if (GBLayout.isMaximized()) { GBLayout.restoreMaximizedPane(); return false; }
      const pair = _getLegacySplitPair();
      if (!pair) return false;
      _disposePaneTabs(pair.splitPane);
      GBLayout.removePane(pair.splitPane.id);
      _legacySplitPair = null;
      if (GBLayout.findNode(GBLayout.root, pair.sourcePane.id)?.node) {
        GBLayout.setActivePane(pair.sourcePane.id);
      }
      return true;
    }
    window.toggleSplitView = function() {
      if (!_deactivateLegacySplitView()) _activateLegacySplitView();
    };
    window.activateSplitView = function(splitArg) {
      _activateLegacySplitView(splitArg);
    };
    window.deactivateSplitView = function() {
      _deactivateLegacySplitView();
    };
    window.isSplitActive = function() {
      return !!_getLegacySplitPair();
    };
    window.openInNewSplit = function(dbPath) {
      return _activateLegacySplitView(_entryFromSplitArg(dbPath));
    };
    window.openDbInOtherPane = function(dbPath) {
      const entry = _entryFromSplitArg(dbPath);
      const pair = _getLegacySplitPair();
      if (!pair) return _activateLegacySplitView(entry);
      const targetPane = GBLayout.activePane === pair.splitPane.id ? pair.sourcePane : pair.splitPane;
      return _replacePaneWithEntry(targetPane, entry);
    };
  }

  function _findToolPaneInAnyGroup(toolType) {
    const targetPath = '';
    function walk(node, panelsetNode, groupId) {
      if (!node) return null;
      if (node.type === 'pane') {
        const tab = (node.tabs || []).find(t => t.type === toolType && (t.path || '') === targetPath);
        return tab ? { paneId: node.id, tabId: tab.id, panelsetNode, groupId } : null;
      }
      if (node.type === 'split' && Array.isArray(node.children)) {
        for (const child of node.children) {
          const found = walk(child, panelsetNode, groupId);
          if (found) return found;
        }
      } else if (node.type === 'panelset' && Array.isArray(node.groups)) {
        for (const group of node.groups) {
          const found = walk(group?.root, node, group?.id || '');
          if (found) return found;
        }
      }
      return null;
    }
    return walk(GBLayout.root, null, '') || null;
  }

  function _findTabByIdInAnyGroup(tabId) {
    if (!tabId) return null;
    function walk(node, panelsetNode, groupId) {
      if (!node) return null;
      if (node.type === 'pane') {
        const tab = (node.tabs || []).find(t => t.id === tabId);
        return tab ? { paneId: node.id, tabId: tab.id, panelsetNode, groupId } : null;
      }
      if (node.type === 'split' && Array.isArray(node.children)) {
        for (const child of node.children) {
          const found = walk(child, panelsetNode, groupId);
          if (found) return found;
        }
      } else if (node.type === 'panelset' && Array.isArray(node.groups)) {
        for (const group of node.groups) {
          const found = walk(group?.root, node, group?.id || '');
          if (found) return found;
        }
      }
      return null;
    }
    return walk(GBLayout.root, null, '') || null;
  }

  function _findReusableToolHostPane() {
    const visiblePanes = typeof GBLayout.getAllPanes === 'function'
      ? GBLayout.getAllPanes(GBLayout.root, { activeOnly: true })
      : [];
    const allPanes = typeof GBLayout.getAllPanes === 'function'
      ? GBLayout.getAllPanes(GBLayout.root)
      : [];
    return visiblePanes.find(pane => pane?.id && !pane.locked && _isVersionHostPane(pane))
      || allPanes.find(pane => pane?.id && !pane.locked && _isVersionHostPane(pane))
      || null;
  }

  function _activateToolPaneMatch(match, options) {
    if (!match?.paneId || !match?.tabId) return;
    const previousActivePane = GBLayout?.activePane || '';
    let groupChanged = false;
    if (match.panelsetNode && match.groupId && match.panelsetNode.activeGroupId !== match.groupId) {
      groupChanged = true;
      if (typeof GBPanelSet?.switchGroup === 'function') {
        GBPanelSet.switchGroup(match.panelsetNode, match.groupId);
      } else {
        match.panelsetNode.activeGroupId = match.groupId;
      }
    }
    GBTabs.activateTab(match.paneId, match.tabId, options);
    if (groupChanged && typeof _refreshPaneAfterTabSwitch === 'function') {
      _refreshPaneAfterTabSwitch(match.paneId, {
        previousActivePane: options?.preserveActivePane ? null : previousActivePane,
      });
    }
  }

  function _scheduleContentPaneRestore(paneId) {
    if (!paneId) return;
    const run = () => {
      if (typeof GBLayout === 'undefined' || !GBLayout.root || !GBLayout.paneMap?.[paneId]) return;
      const paneInfo = _getPaneInfoById(paneId);
      if (!paneInfo || _isToolbarUtilityView(paneInfo.activeTab?.type)) return;
      _refreshMountedPane(paneId);
      const toolbarView = _toolbarViewForTab(paneInfo.activeTab) || state.view || '';
      _ensureDbSubviewVisibleForPane(paneId, GBLayout.paneMap?.[paneId]?.contentEl || null, toolbarView, paneInfo.activeTab);
      _syncStateView();
      _mountFloatingAnnotationUi();
      if (toolbarView && typeof _updateToolbars === 'function') _updateToolbars(toolbarView);
      if (typeof replaceIcons === 'function') replaceIcons();
    };
    queueMicrotask(run);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 0);
    setTimeout(run, 80);
  }

  function _toolLabel(toolType) {
    return TOOL_LABELS[toolType] || toolType || '';
  }

  // ツール（chat/calendar/annotation/history等）をペインタブとして開く
  function _openToolPane(toolType, options) {
    const openOpts = options || {};
    const operationSource = openOpts.source ?? openOpts.sourceEl ?? openOpts.sourcePaneId ?? openOpts.paneId ?? openOpts.surface;
    if (!_guardRightSidebarTool(toolType, operationSource)) return false;
    const popupToolType = toolType === 'sticky' ? 'annotation' : toolType;
    const mobileSinglePane = typeof GBLayout?.isMobileLayout === 'function' && GBLayout.isMobileLayout();
    const preserveWorkActive = !mobileSinglePane && _isPassiveToolPaneTab(toolType, { type: toolType, path: '' });
    if (typeof GBDockPopup !== 'undefined' && typeof GBDockPopup.activateTabType === 'function') {
      if (GBDockPopup.activateTabType(popupToolType, '')) return;
    }

    // 既に開いているか確認
    const existing = _findToolPaneInAnyGroup(toolType) || GBTabs.findPaneWithTab(toolType, '');
    if (existing) {
      const paneId = existing.paneId;
      const activePane = GBLayout.activePane;
      // toggleRightPanelTab() だけが同一ペイン時のクローズを許可する。
      // openRightPanelTab()/switchRightTab() は既存タブを必ずアクティブ化する。
      const existingVisible = typeof GBLayout.isPaneVisible === 'function'
        ? GBLayout.isPaneVisible(paneId)
        : paneId === activePane;
      const closeExisting = openOpts.toggleExisting && (paneId === activePane || (preserveWorkActive && existingVisible) || (existing.panelsetNode && existingVisible));
      if (!closeExisting) {
        const restorePaneId = _getContentPane(activePane) || _getFileOpenPane(activePane);
        _activateToolPaneMatch(existing, { preserveActivePane: preserveWorkActive });
        if (openOpts.userIntent && typeof GBLayout?.revealPane === 'function') {
          GBLayout.revealPane(paneId, { userIntent: true, activate: !preserveWorkActive });
        }
        if (toolType === 'detail') _syncDetailForActivePane(restorePaneId || activePane);
        _scheduleContentPaneRestore(restorePaneId);
      } else if (existing.panelsetNode) {
        if (typeof GBLayout?.setNodeCollapsed === 'function') {
          GBLayout.setNodeCollapsed(existing.panelsetNode.id, true);
        } else {
          existing.panelsetNode.collapsed = true;
          if (typeof GBLayout?.render === 'function') GBLayout.render();
          if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
        }
      } else {
        GBTabs.closeTab(paneId, existing.tabId);
      }
      return;
    }

    // 新規作成
    const paneId = GBLayout.activePane;
    if (!paneId) return;
    const tab = GBTabs.createTab(_toolLabel(toolType), toolType, '');
    const newPane = GBLayout.createPaneNode(null, [tab], 0);

    if (NAV_PANE_TYPES.has(toolType)) {
      // ナビペインは常に左に配置
      const newPaneId = GBLayout.splitPane(paneId, 'horizontal', 'left', newPane);
      if (newPaneId) GBLayout.setActivePane(newPaneId);
    } else {
      // 通常ツールは右に配置
      const reusableToolPane = _findReusableToolHostPane();
      if (reusableToolPane) {
        const restorePaneId = _getContentPane(GBLayout.activePane) || _getFileOpenPane(GBLayout.activePane);
        const tabId = GBTabs.addTab(reusableToolPane.id, _toolLabel(toolType), toolType, '', null, { preserveActivePane: preserveWorkActive });
        const match = _findTabByIdInAnyGroup(tabId);
        if (match) _activateToolPaneMatch(match, { preserveActivePane: preserveWorkActive });
        if (openOpts.userIntent && typeof GBLayout?.revealPane === 'function') {
          GBLayout.revealPane(reusableToolPane.id, { userIntent: true, activate: !preserveWorkActive });
        }
        if (tabId && typeof _refreshPaneAfterTabSwitch === 'function') {
          _refreshPaneAfterTabSwitch(match?.paneId || reusableToolPane.id, {
            previousActivePane: preserveWorkActive ? null : restorePaneId,
          });
        }
        _scheduleContentPaneRestore(restorePaneId);
        return;
      }
      const sourcePaneId = _getContentPane(GBLayout.activePane) || paneId;
      const newPaneId = GBLayout.splitPane(sourcePaneId, 'horizontal', 'right', newPane);
      if (newPaneId) {
        if (!preserveWorkActive) GBLayout.setActivePane(newPaneId);
        if (openOpts.userIntent && typeof GBLayout?.revealPane === 'function') {
          GBLayout.revealPane(newPaneId, { userIntent: true, activate: !preserveWorkActive });
        }
        _refreshPaneAfterTabSwitch(newPaneId, { previousActivePane: preserveWorkActive ? null : sourcePaneId });
        _scheduleContentPaneRestore(sourcePaneId);
      }
    }
  }

  // ================================================================
  // 新規作成ドロップダウンメニュー
  // ================================================================
  function _toggleNewMenu(e) {
    const existing = document.querySelector('.gb-new-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'gb-new-menu gb-context-menu';
    const items = [
      ['ノート', 'page', () => openToolTab('page')],
      ['シナリオ', 'bookOpenText', () => openToolTab('scriptnote')],
      ['シート', 'db', () => openToolTab('database')],
      ['ボード', 'presentation', () => openToolTab('board')],
      ['スケジュール', 'calendar', () => openToolTab('calendar')],
      ['スマートシート', 'databaseSearch', () => openToolTab('smart-db')],
      ['---'],
      ['フォルダ', 'folder', () => openToolTab('folder')],
      ['XLSX取込', (typeof uiTransferIconName === 'function' ? uiTransferIconName('import') : 'download'), () => { if (typeof importXlsxToOutliner === 'function') importXlsxToOutliner(); }],
      ['ゴミ箱', 'trash2', () => { if (typeof showTrashModal === 'function') showTrashModal(); }],
    ];
    for (const item of items) {
      if (item[0] === '---') {
        const s = document.createElement('div');
        s.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
        menu.appendChild(s);
        continue;
      }
      const mi = document.createElement('div');
      mi.style.cssText = 'padding:5px 14px;cursor:pointer;font-size:13px;white-space:nowrap;display:flex;align-items:center;gap:6px;';
      mi.innerHTML = (typeof lucide === 'function' ? lucide(item[1], 14) : '') + ' ' + item[0];
      mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; };
      mi.onmouseleave = () => { mi.style.background = ''; };
      mi.addEventListener('click', () => { menu.remove(); item[2](); });
      menu.appendChild(mi);
    }

    document.body.appendChild(menu);
    const btn = (e && e.target) ? e.target.closest('button') || document.getElementById('btn-new-menu') : document.getElementById('btn-new-menu');
    const rect = btn.getBoundingClientRect();
    { const z = _getZoom(); menu.style.left = (rect.left / z) + 'px'; menu.style.top = (rect.bottom / z + 2) + 'px'; }
    requestAnimationFrame(() => {
      const z = _getZoom(); const mr = menu.getBoundingClientRect();
      if (mr.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - mr.height - 4) / z) + 'px';
      if (mr.right > window.innerWidth) menu.style.left = ((window.innerWidth - mr.width - 4) / z) + 'px';
    });
    setTimeout(() => {
      document.addEventListener('pointerdown', function cl(ev) {
        if (!menu.contains(ev.target) && ev.target !== btn) { menu.remove(); document.removeEventListener('pointerdown', cl, true); }
      }, true);
    }, 0);
  }

  // ================================================================
  // キーボードルーティング
  // ================================================================
  function _setupKeyboardRouting() {
    // Ctrl+Shift+M, Ctrl+W → gb-shortcuts.js の中央ハンドラに移行済み
    // コンポーネントへのキー委譲のみ残存
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) return;
      const activeTab = GBTabs.getActiveTab();
      if (activeTab) {
        const component = getComponentInstance(activeTab.id);
        if (component && component.handleKeyDown && component.handleKeyDown(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    });
  }

  function _capturePaneComponentStates(pane) {
    for (const tab of (pane?.tabs || [])) {
      const comp = getComponentInstance(tab.id);
      if (!comp || typeof comp.getState !== 'function') continue;
      try {
        tab.state = comp.getState();
      } catch (e) {
        console.warn('[PaneBridge] getState failed:', tab.id, e);
      }
    }
  }

  function _refreshMountedPane(paneId, options) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root || !paneId) return;
    const pane = GBLayout.findNode?.(GBLayout.root, paneId)?.node || null;
    if (!pane || pane.type !== 'pane') return;
    _capturePaneComponentStates(pane);
    _mountPaneContent(pane, options);
  }

  function _mountVirtualPane(pane, contentEl, options) {
    if (typeof GBLayout === 'undefined' || !pane?.id || !contentEl) return false;
    const paneMap = GBLayout.paneMap;
    if (!paneMap) return false;
    const surface = options?.surface || 'subpanel';
    paneMap[pane.id] = {
      node: pane,
      el: contentEl.closest?.('.gb-subpanel') || contentEl,
      contentEl,
      surface,
    };
    _mountPaneContent(pane, { ...(options || {}), surface });
    return true;
  }

  function _refreshPaneAfterTabSwitch(paneId, options) {
    if (typeof GBLayout === 'undefined' || !GBLayout.root) return;
    _refreshMountedPane(paneId, options);
    const previousActivePane = options?.previousActivePane || null;
    if (previousActivePane && previousActivePane !== paneId) {
      _refreshMountedPane(previousActivePane);
    }
    // タブ切替でアクティブタブが変わった分、戻る/進むボタンの表示もタブ単位の履歴へ
    // 追随させる（②タブ別ナビ履歴、2026-07-21）。activateTab の高速経路（タブDOM再構築を
    // 伴わない場合）・パネルセットのグループ切替・ペイン間 moveTab はいずれもここを
    // 通るため、この1箇所に集約する。
    if (typeof GBLayout.updatePaneNavButtons === 'function') {
      GBLayout.updatePaneNavButtons(paneId);
      if (previousActivePane && previousActivePane !== paneId) {
        GBLayout.updatePaneNavButtons(previousActivePane);
      }
    }
    _syncStateView();
    // 取り消し・やり直しの対象スコープをアクティブタブへ追随させる（パネル取り違え対策）
    if (typeof _meldexSyncActiveTabHistoryScope === 'function') _meldexSyncActiveTabHistoryScope();
    _mountFloatingAnnotationUi();
    const detailSourcePaneId = _isDetailSyncSourcePane(paneId) ? paneId : (GBLayout.activePane || paneId);
    _syncDetailForActivePane(detailSourcePaneId);
    _syncFollowingVersionTabs();
    _syncToolButtonStates();
    if (typeof GBAppLayouts !== 'undefined' && typeof GBAppLayouts.syncButtons === 'function') {
      GBAppLayouts.syncButtons();
    }
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  function _retractPaneContent(paneId) {
    const contentEl = GBLayout?.paneMap?.[paneId]?.contentEl || null;
    if (!contentEl) return false;
    _retractLegacyFromPane(contentEl);
    return true;
  }

  function _disposeLayoutTreeComponents(node) {
    if (!node) return;
    if (node.type === 'pane') {
      (node.tabs || []).forEach(tab => {
        if (typeof removeComponentInstance === 'function') removeComponentInstance(tab.id);
      });
      return;
    }
    if (node.type === 'split') {
      (node.children || []).forEach(_disposeLayoutTreeComponents);
      return;
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      node.groups.forEach(group => _disposeLayoutTreeComponents(group?.root));
    }
  }

  function _resetDefaultLayout(options) {
    const before = !options?.skipHistory && typeof GBLayout.captureLayoutSnapshot === 'function'
      ? GBLayout.captureLayoutSnapshot()
      : null;
    _disposeLayoutTreeComponents(GBLayout.root);
    _buildDefaultLayout(GBLayout.createPaneNode('pane-main', [], -1));
    if (before && typeof GBLayout.pushLayoutHistory === 'function') {
      GBLayout.pushLayoutHistory('レイアウト: 初期化', before, GBLayout.captureLayoutSnapshot(), '標準レイアウトへ戻す');
    }
  }

  // ================================================================
  // 右サイドバー補助操作の制限（サブパネル内）
  //
  // 計画書「右サイドバー操作の制限」節: オプション・ビューワー・バージョン管理・
  // チャット・タイマー・ヒストリー・注釈・タグ・別サブパネルを開く操作は、
  // サブパネル内では使用できない。メインパネルからは従来どおり。
  // ================================================================
  const RIGHT_SIDEBAR_RESTRICTED_TOOLS = new Set([
    'detail', 'preview', 'version', 'chat', 'timer', 'history',
    'annotation', 'sticky', 'tags', 'subpanel',
  ]);

  function _surfaceOfElement(el) {
    if (!el || typeof el.closest !== 'function') return 'main';
    if (el.closest('.gb-subpanel')) return 'subpanel';
    return 'main';
  }

  function _surfaceOfPaneId(paneId) {
    const info = GBLayout?.paneMap?.[paneId];
    if (!info) return 'main';
    if (info.surface === 'subpanel') return info.surface;
    return _surfaceOfElement(info.contentEl || info.el);
  }

  // source は DOM要素／paneId文字列／surface文字列／それらを持つoptions風オブジェクト／
  // 省略のいずれかを受け付ける。
  // 省略時は現在のフォーカス位置（document.activeElement）で判定する
  // （計画書「判定はフォーカス位置 or 操作対象paneのsurface」に対応）。
  function _surfaceOf(source) {
    if (source == null) {
      return _surfaceOfElement(typeof document !== 'undefined' ? document.activeElement : null);
    }
    if (typeof source === 'string') {
      if (source === 'main' || source === 'subpanel') return source;
      return _surfaceOfPaneId(source);
    }
    if (source.nodeType) return _surfaceOfElement(source);
    if (typeof source === 'object') {
      if (source.surface === 'main' || source.surface === 'subpanel') {
        return source.surface;
      }
      const nestedSource = source.source ?? source.sourceEl ?? source.sourcePaneId
        ?? source.paneId ?? source.target;
      if (nestedSource != null && nestedSource !== source) return _surfaceOf(nestedSource);
    }
    return 'main';
  }

  function _canUseRightSidebarTools(surface) {
    return surface !== 'subpanel';
  }

  function _isRightSidebarRestrictedTool(toolType) {
    return RIGHT_SIDEBAR_RESTRICTED_TOOLS.has(toolType);
  }

  function _surfaceStatusLabel(surface) {
    return surface === 'subpanel' ? 'サブパネル' : '作業領域';
  }

  // 右サイドバー補助操作（オプション/ビューワー/バージョン管理/チャット/タイマー/
  // ヒストリー/注釈/タグ/サブパネルを開く）の可否を判定する。制限対象で、かつ
  // サブパネル内からの呼び出しであれば false を返し、短いステータス
  // 通知を出す。呼び出し側はこの戻り値が true の場合のみ処理を継続すること。
  function _guardRightSidebarTool(toolType, source) {
    if (!RIGHT_SIDEBAR_RESTRICTED_TOOLS.has(toolType)) return true;
    const surface = _surfaceOf(source);
    if (_canUseRightSidebarTools(surface)) return true;
    if (typeof showStatus === 'function') {
      showStatus(_surfaceStatusLabel(surface) + '内では使えません', true);
    }
    return false;
  }

  // ================================================================
  // Public API
  // ================================================================
  return {
    init,
    mountAllPanes: _mountAllPanes,
    mountFloatingAnnotationUi: _mountFloatingAnnotationUi,
    mountVirtualPane: _mountVirtualPane,
    activateFileOpenPane: _activateFileOpenPane,
    activateAnnotationFabForPane: _activateAnnotationFabForPane,
    getAnnotationContentPaneInfo: _getAnnotationContentPaneInfo,
    getCurrentAnnotationTarget: _getCurrentAnnotationTarget,
    getCurrentOpenTargetInfo: _getAnnotationContentPaneInfo,
    getCurrentOpenTarget: _getCurrentAnnotationTarget,
    rememberAnnotationTargetForPane: _rememberAnnotationTargetForPane,
    refreshPaneAfterTabSwitch: _refreshPaneAfterTabSwitch,
    syncFollowingVersionTabs: _syncFollowingVersionTabs,
    retractPaneContent: _retractPaneContent,
    invalidateLegacyRenderState: _invalidateLegacyRenderState,
    toolLabel: _toolLabel,
    toggleNewMenu: _toggleNewMenu,
    clearDetailPaneShell: _clearDetailPaneShell,
    resetDefaultLayout: _resetDefaultLayout,
    surfaceOf: _surfaceOf,
    canUseRightSidebarTools: _canUseRightSidebarTools,
    isRightSidebarRestrictedTool: _isRightSidebarRestrictedTool,
    guardRightSidebarTool: _guardRightSidebarTool,
    get initialized() { return _initialized; },
  };
})();
