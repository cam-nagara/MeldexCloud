(function () {
  if (window.__MeldexCloudMobileInstalled) return;
  window.__MeldexCloudMobileInstalled = true;

  const MOBILE_QUERY = '(max-width: 1024px), (pointer: coarse)';
  const KEYBOARD_THRESHOLD = 120;
  const EDGE_SWIPE_ZONE = 28;
  const EDGE_SWIPE_MIN_X = 72;
  const EDGE_SWIPE_MAX_Y = 64;
  const MOBILE_DISMISS_MIN_X = 78;
  const MOBILE_DISMISS_MAX_Y = 72;
  const LOCAL_MOBILE_UI_STORAGE_KEY = 'meldex-local-mobile-ui';
  const media = window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
  let _desktopToggleSidebar = null;
  let _layoutHookInstalled = false;
  let _layoutSaveHookInstalled = false;
  let _sanitizingLayout = false;
  let _lastTreeOpenAt = 0;
  let _paneBackObserverInstalled = false;
  let _sidebarDrawerReturnSlot = null;
  const _mobileCollapsedColumns = new Map();

  function _isDropboxMode() {
    return window.MeldexRuntimeAdapter?.isDropboxMode?.() || document.body?.dataset?.cloudMode === 'dropbox';
  }

  function _isLocalMobileUiAllowed() {
    try {
      return localStorage.getItem(LOCAL_MOBILE_UI_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  function _isMobileUiAllowed() {
    return _isDropboxMode() || _isLocalMobileUiAllowed();
  }

  function _isMobileViewport() {
    if (document.body?.dataset?.e2eCloudMobileForce === '1' || window.__MeldexE2ECloudMobileForce === true) return true;
    return media ? media.matches : window.innerWidth <= 1024;
  }

  function _isSingleWindow() {
    return !!window._gbSingleWindow || document.documentElement?.dataset?.singleWindow === '1';
  }

  function _isFocusedTextInput() {
    const active = document.activeElement;
    return !!active?.matches?.('input, textarea, [contenteditable="true"]');
  }

  function _setDatasetFlag(name, enabled) {
    if (!document.body) return;
    if (enabled) document.body.dataset[name] = '1';
    else delete document.body.dataset[name];
  }

  function isMobileEditingUiEnabled() {
    return _isMobileUiAllowed() && _isMobileViewport() && !_isSingleWindow();
  }

  function shouldUseSidebarDrawer() {
    return _isMobileUiAllowed() && _isMobileViewport() && !_isSingleWindow();
  }

  function _sidebarElements() {
    return {
      sidebar: document.getElementById('sidebar'),
      backdrop: document.getElementById('sidebar-backdrop'),
    };
  }

  function _isTreeScreenOpen() {
    return document.getElementById('sidebar')?.classList?.contains('cloud-mobile-tree-screen-open');
  }

  function _isSidebarDismissBlockedTarget(target) {
    return !!target?.closest?.('button, a, input, select, textarea, [contenteditable="true"], [role="button"], [role="menu"], [role="dialog"], .tree-toggle, .tree-hover-btns, .tree-hover-btn');
  }

  function _iconHtml(name, size, fallback) {
    return typeof lucide === 'function'
      ? lucide(name, size || 18)
      : `<span aria-hidden="true">${fallback || ''}</span>`;
  }

  function _ensureSidebarDismissHandle(sidebar) {
    if (!sidebar || !shouldUseSidebarDrawer()) return null;
    let handle = sidebar.querySelector('.cloud-mobile-left-drawer-handle');
    if (!handle) {
      handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'cloud-mobile-drawer-handle cloud-mobile-left-drawer-handle';
      handle.title = 'フォルダツリーを左へ閉じる';
      handle.setAttribute('aria-label', 'フォルダツリーを左へ閉じる');
      handle.innerHTML = _iconHtml('chevronsLeft', 20, '‹');
      handle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeSidebarDrawer();
      });
      sidebar.appendChild(handle);
    }
    return handle;
  }

  function _setSidebarDragOffset(sidebar, offsetX) {
    if (!sidebar) return;
    sidebar.style.setProperty('transition', 'none', 'important');
    sidebar.style.setProperty('transform', `translateX(${Math.min(0, Math.round(offsetX))}px)`, 'important');
  }

  function _clearSidebarDragOffset(sidebar) {
    if (!sidebar) return;
    sidebar.style.removeProperty('transition');
    sidebar.style.removeProperty('transform');
  }

  function _animateCloseSidebarDrawerFromGesture(sidebar) {
    if (!sidebar) return closeSidebarDrawer();
    sidebar.style.setProperty('transition', 'transform 0.16s ease', 'important');
    sidebar.style.setProperty('transform', 'translateX(-105%)', 'important');
    setTimeout(() => {
      _clearSidebarDragOffset(sidebar);
      closeSidebarDrawer();
    }, 170);
    return true;
  }

  function _openSidebarFromMobileControl(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const now = Date.now();
    if (now - _lastTreeOpenAt < 300) return false;
    _lastTreeOpenAt = now;
    return openSidebarDrawer(true);
  }

  function _openMobileMenuSheet(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (_isTreeScreenOpen()) closeSidebarDrawer();
    if (window.MeldexCloudMobileEditBar?.openMenu) {
      window.MeldexCloudMobileEditBar.openMenu();
      return true;
    }
    if (typeof showStatus === 'function') showStatus('スマホ用メニューを読み込み中です', true);
    return false;
  }

  function _bindMobileControlActivation(button, action) {
    let lastRunAt = 0;
    const run = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      if (now - lastRunAt < 300) return;
      lastRunAt = now;
      action(event);
    };
    button.addEventListener('pointerup', run);
    button.addEventListener('click', run);
  }

  function closeSidebarDrawer() {
    const { sidebar, backdrop } = _sidebarElements();
    if (!sidebar) return false;
    _clearSidebarDragOffset(sidebar);
    sidebar.classList.remove('open', 'cloud-mobile-tree-screen-open');
    if (shouldUseSidebarDrawer()) sidebar.setAttribute('aria-hidden', 'true');
    else sidebar.removeAttribute('aria-hidden');
    document.body?.classList?.remove('cloud-mobile-tree-screen-active');
    if (!shouldUseSidebarDrawer()) sidebar.style.removeProperty('display');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.style.setProperty('display', 'none', 'important');
    }
    _restoreSidebarDrawerHost(sidebar);
    return true;
  }

  function openSidebarDrawer(withFolderView) {
    const { sidebar, backdrop } = _sidebarElements();
    if (!sidebar) return false;
    _ensureTreeScreenHeader();
    _dockSidebarForDrawer(sidebar);
    _clearSidebarDragOffset(sidebar);
    sidebar.style.setProperty('display', 'flex', 'important');
    sidebar.setAttribute('aria-hidden', 'false');
    sidebar.classList.add('open', 'cloud-mobile-tree-screen-open');
    document.body?.classList?.add('cloud-mobile-tree-screen-active');
    if (backdrop) {
      backdrop.style.setProperty('display', 'block', 'important');
      backdrop.classList.add('open');
    }
    if (withFolderView && typeof showFolderViewForSidebar === 'function') showFolderViewForSidebar();
    return true;
  }

  function _dockSidebarForDrawer(sidebar) {
    if (!shouldUseSidebarDrawer() || !document.body || !sidebar) return;
    if (sidebar.parentNode === document.body) return;
    _sidebarDrawerReturnSlot = {
      parent: sidebar.parentNode,
      nextSibling: sidebar.nextSibling,
    };
    sidebar.dataset.cloudMobileDrawerDocked = '1';
    document.body.appendChild(sidebar);
  }

  function _restoreSidebarDrawerHost(sidebar) {
    if (!sidebar || sidebar.dataset.cloudMobileDrawerDocked !== '1') return;
    const slot = _sidebarDrawerReturnSlot;
    _sidebarDrawerReturnSlot = null;
    delete sidebar.dataset.cloudMobileDrawerDocked;
    if (!slot?.parent?.isConnected || sidebar.parentNode !== document.body) return;
    if (slot.nextSibling && slot.nextSibling.parentNode === slot.parent) {
      slot.parent.insertBefore(sidebar, slot.nextSibling);
    } else {
      slot.parent.appendChild(sidebar);
    }
  }

  function toggleSidebarDrawer(withFolderView) {
    if (!shouldUseSidebarDrawer()) return false;
    const { sidebar } = _sidebarElements();
    if (sidebar?.classList?.contains('cloud-mobile-tree-screen-open') || sidebar?.classList?.contains('open')) closeSidebarDrawer();
    else openSidebarDrawer(withFolderView);
    return true;
  }

  function _ensureTreeScreenHeader() {
    const sidebar = document.getElementById('sidebar');
    if (!shouldUseSidebarDrawer()) return;
    if (!sidebar) return;
    let header = sidebar.querySelector('.cloud-mobile-tree-screen-header');
    if (!header) {
      header = document.createElement('div');
      header.className = 'cloud-mobile-tree-screen-header';
      sidebar.prepend(header);
    }
    if (header.dataset.cloudMobileHeaderVersion !== '5') {
      header.dataset.cloudMobileHeaderVersion = '5';
      header.replaceChildren();

      const menuButton = document.createElement('button');
      menuButton.type = 'button';
      menuButton.className = 'cloud-mobile-tree-menu';
      menuButton.title = 'メニュー';
      menuButton.setAttribute('aria-label', 'メニューを開く');
      menuButton.innerHTML = _iconHtml('menu', 20, '≡');
      _bindMobileControlActivation(menuButton, _openMobileMenuSheet);

      const title = document.createElement('strong');
      title.className = 'cloud-mobile-tree-screen-title';
      title.textContent = 'フォルダ';

      const modeSwitch = document.createElement('div');
      modeSwitch.className = 'cloud-mobile-tree-mode-switch';
      modeSwitch.setAttribute('role', 'group');
      modeSwitch.setAttribute('aria-label', 'フォルダ表示の切り替え');
      const treeModeButton = _mobileTreeModeButton('ツリー', 'tree', true);
      const panelModeButton = _mobileTreeModeButton('フォルダ', 'panel', false);
      _bindMobileControlActivation(treeModeButton, (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
      });
      _bindMobileControlActivation(panelModeButton, () => {
        _openSelectedFolderPanelFromTree();
      });
      modeSwitch.appendChild(treeModeButton);
      modeSwitch.appendChild(panelModeButton);

      const actions = document.createElement('div');
      actions.className = 'cloud-mobile-tree-actions';

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'cloud-mobile-tree-add';
      addButton.title = '新規作成';
      addButton.setAttribute('aria-label', '新規作成');
      addButton.innerHTML = _iconHtml('plus', 20, '+');
      _bindMobileControlActivation(addButton, (event) => {
        _openMobileTreeCreateMenu(event, addButton);
      });

      const refreshButton = document.createElement('button');
      refreshButton.type = 'button';
      refreshButton.className = 'cloud-mobile-tree-refresh';
      refreshButton.title = 'フォルダツリーを更新';
      refreshButton.setAttribute('aria-label', 'フォルダツリーを更新');
      refreshButton.innerHTML = _iconHtml('refreshCw', 20, '↻');
      _bindMobileControlActivation(refreshButton, (event) => {
        if (typeof refreshOutlinerFromButton === 'function') return refreshOutlinerFromButton(event);
        if (typeof refreshOutliner === 'function') return refreshOutliner();
      });

      actions.appendChild(addButton);
      actions.appendChild(refreshButton);
      header.appendChild(menuButton);
      header.appendChild(title);
      header.appendChild(modeSwitch);
      header.appendChild(actions);
    }
    _ensureSidebarDismissHandle(sidebar);
  }

  function _mobileTreeModeButton(label, mode, active) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cloud-mobile-tree-mode';
    button.dataset.mode = mode;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.textContent = label;
    return button;
  }

  function _activeTreeNodeData() {
    const selectors = [
      '#sidebar .tree-node-row.active',
      '#sidebar .tree-node-row.selected',
      '#sidebar .tree-node-row[data-active-workspace="true"]',
    ];
    for (const selector of selectors) {
      const row = document.querySelector(selector);
      const node = row?.closest?.('.tree-node');
      if (node?._nodeData) return { node, data: node._nodeData };
    }
    const firstRoot = document.querySelector('#outliner-tree > .tree-node');
    return firstRoot?._nodeData ? { node: firstRoot, data: firstRoot._nodeData } : null;
  }

  function _treeNodeCanActAsContainer(data, includeDatabase = false) {
    const type = String(data?.type || '').toLowerCase();
    return !!data?.path && (data._isRoot || type === 'folder' || (includeDatabase && type === 'database'));
  }

  function _treeNodeTargetFromData(data) {
    return { path: data.path, name: data.name || data.path.split(/[\\/]/).pop() || 'フォルダ' };
  }

  function _selectedFolderPathForTreeAction(options = {}) {
    const includeDatabase = options.includeDatabase === true;
    const active = _activeTreeNodeData();
    const data = active?.data || null;
    if (_treeNodeCanActAsContainer(data, includeDatabase)) {
      return _treeNodeTargetFromData(data);
    }
    let parent = active?.node?.parentElement?.closest?.('.tree-node') || null;
    while (parent) {
      const parentData = parent._nodeData || null;
      if (_treeNodeCanActAsContainer(parentData, includeDatabase)) {
        return _treeNodeTargetFromData(parentData);
      }
      parent = parent.parentElement?.closest?.('.tree-node') || null;
    }
    try {
      if (typeof _folderPath !== 'undefined' && _folderPath) {
        return { path: _folderPath, name: _folderPath.split(/[\\/]/).pop() || 'フォルダ' };
      }
    } catch {}
    const firstRoot = document.querySelector('#outliner-tree > .tree-node');
    if (firstRoot?._nodeData?.path) {
      const rootData = firstRoot._nodeData;
      return { path: rootData.path, name: rootData.name || rootData.path.split(/[\\/]/).pop() || 'フォルダ' };
    }
    return { path: '', name: '' };
  }

  function _openSelectedFolderPanelFromTree() {
    const target = _selectedFolderPathForTreeAction();
    if (!target.path || typeof openFolder !== 'function') {
      if (typeof showStatus === 'function') showStatus('表示するフォルダを選択してください', true);
      return false;
    }
    openFolder(target.name, target.path, { fromExplorer: true, noScrollHighlight: true });
    closeSidebarDrawer();
    return true;
  }

  function _openMobileTreeCreateMenu(event, anchor) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    document.querySelectorAll('.cloud-mobile-tree-create-menu').forEach(menu => menu.remove());
    const target = _selectedFolderPathForTreeAction({ includeDatabase: true });
    if (!target.path) {
      if (typeof showStatus === 'function') showStatus('作成先フォルダを選択してください', true);
      return false;
    }
    const items = [
      ['フォルダ', 'folder', 'folder'],
      ['ノート', 'page', 'fileText'],
      ['シナリオ', 'scriptnote', 'bookOpenText'],
      ['シート', 'database', 'table2'],
      ['ボード', 'board', 'presentation'],
      ['スマートシート', 'smart-db', 'database'],
    ];
    const filtered = window.MeldexCloudBootstrap?.filterPhase1CreateItems?.(items) || items;
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu cloud-mobile-tree-create-menu';
    menu.setAttribute('role', 'menu');
    filtered.forEach(([label, type, icon]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-context-menu-item cloud-mobile-tree-create-item';
      item.setAttribute('role', 'menuitem');
      item.innerHTML = '<span class="menu-icon">' + _iconHtml(icon, 14, '') + '</span><span>' + label + '</span>';
      item.addEventListener('click', async () => {
        menu.remove();
        if (typeof addItemAt === 'function') await addItemAt(target.path, type);
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    const rect = anchor?.getBoundingClientRect?.() || { left: 12, bottom: 54 };
    const z = parseFloat(document.documentElement.style.zoom) || 1;
    menu.style.left = (rect.left / z) + 'px';
    menu.style.top = (rect.bottom / z + 4) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    setTimeout(() => {
      const closer = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== anchor) {
          menu.remove();
          document.removeEventListener('pointerdown', closer, true);
        }
      };
      document.addEventListener('pointerdown', closer, true);
    }, 0);
    return true;
  }

  function _ensurePaneTreeBackButtons() {
    if (!document.body) return;
    document.querySelectorAll('.gb-pane-tabs').forEach((tabBar) => {
      let button = Array.from(tabBar.children).find(el => el.classList?.contains('cloud-mobile-pane-tree-back'));
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'cloud-mobile-pane-tree-back';
        button.title = 'フォルダツリーへ戻る';
        button.setAttribute('aria-label', 'フォルダツリーへ戻る');
        button.innerHTML = _iconHtml('chevronLeft', 20, '＜');
        button.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
        });
        _bindMobileControlActivation(button, _openSidebarFromMobileControl);
        tabBar.insertBefore(button, tabBar.firstChild);
      }
      const paneId = tabBar.closest?.('.gb-pane')?.dataset?.paneId || 'pane';
      button.dataset.e2eId = `cloud-mobile-pane-tree-back-${paneId}`;
      button.hidden = !shouldUseSidebarDrawer();
    });
    _syncPaneSafeTopBars();
  }

  function _syncPaneSafeTopBars() {
    const tabBars = Array.from(document.querySelectorAll('#gb-layout-root .gb-pane-tabs'));
    tabBars.forEach(tabBar => tabBar.classList.remove('cloud-mobile-safe-top-bar'));
    if (!shouldUseSidebarDrawer()) return;
    const visualTop = Math.max(0, Math.round(window.visualViewport?.offsetTop || 0));
    tabBars.forEach((tabBar) => {
      const rect = tabBar.getBoundingClientRect();
      const hasTreeBack = !!tabBar.querySelector('.cloud-mobile-pane-tree-back:not([hidden])');
      if (rect.width > 0 && rect.height > 0 && (hasTreeBack || rect.top <= visualTop + 2)) {
        tabBar.classList.add('cloud-mobile-safe-top-bar');
      }
    });
  }

  function _installPaneBackButtonObserver() {
    if (_paneBackObserverInstalled) return;
    _paneBackObserverInstalled = true;
    const root = document.getElementById('gb-layout-root') || document.body;
    if (!root) return;
    new MutationObserver(() => {
      if (shouldUseSidebarDrawer()) _ensurePaneTreeBackButtons();
    }).observe(root, { childList: true, subtree: true });
  }

  function _installEdgeSwipeBack() {
    if (document.__MeldexCloudMobileEdgeSwipeInstalled) return;
    document.__MeldexCloudMobileEdgeSwipeInstalled = true;
    let swipe = null;

    const reset = () => { swipe = null; };
    const isBlockedTarget = (target) => !!target?.closest?.('.modal-overlay, .gb-modal-overlay, .gb-cal-modal-overlay, .link-modal-overlay, .cloud-mobile-menu-overlay, .cloud-mobile-overflow-overlay, .cloud-conflict-resolver-overlay, [role="dialog"]');

    document.addEventListener('pointerdown', (event) => {
      if (!shouldUseSidebarDrawer() || _isTreeScreenOpen() || isBlockedTarget(event.target)) return;
      if (event.pointerType === 'mouse') return;
      if (event.clientX > EDGE_SWIPE_ZONE) return;
      swipe = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        tracking: true,
      };
    }, { capture: true });

    document.addEventListener('pointermove', (event) => {
      if (!swipe || event.pointerId !== swipe.id) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      if (dx > 16 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        event.preventDefault();
      }
    }, { capture: true });

    document.addEventListener('pointerup', (event) => {
      if (!swipe || event.pointerId !== swipe.id) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      const shouldOpen = dx >= EDGE_SWIPE_MIN_X && Math.abs(dy) <= EDGE_SWIPE_MAX_Y;
      reset();
      if (shouldOpen) _openSidebarFromMobileControl(event);
    }, { capture: true });

    document.addEventListener('pointercancel', reset, { capture: true });
  }

  function _installSidebarDismissGesture() {
    if (document.__MeldexCloudMobileSidebarDismissInstalled) return;
    document.__MeldexCloudMobileSidebarDismissInstalled = true;
    let drag = null;

    const reset = () => {
      if (drag?.active && drag.sidebar?.isConnected) _clearSidebarDragOffset(drag.sidebar);
      drag = null;
    };

    document.addEventListener('pointerdown', (event) => {
      if (!shouldUseSidebarDrawer()) return;
      const sidebar = document.getElementById('sidebar');
      if (!sidebar?.classList?.contains('cloud-mobile-tree-screen-open')) return;
      const handle = event.target?.closest?.('.cloud-mobile-left-drawer-handle');
      if (!handle) {
        if (event.pointerType === 'mouse') return;
        if (!sidebar.contains(event.target) || _isSidebarDismissBlockedTarget(event.target)) return;
      }
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastTime: performance.now(),
        velocityX: 0,
        active: false,
        sidebar,
      };
      if (handle) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, { capture: true });

    document.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const now = performance.now();
      const dt = Math.max(1, now - drag.lastTime);
      drag.velocityX = (event.clientX - drag.lastX) / dt;
      drag.lastX = event.clientX;
      drag.lastTime = now;
      if (!drag.active && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) drag.active = true;
      if (!drag.active) return;
      event.preventDefault();
      event.stopPropagation();
      _setSidebarDragOffset(drag.sidebar, Math.min(0, dx));
    }, { capture: true });

    document.addEventListener('pointerup', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const current = drag;
      drag = null;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      const draggedLeft = dx <= -MOBILE_DISMISS_MIN_X && Math.abs(dx) > Math.abs(dy) && Math.abs(dy) <= MOBILE_DISMISS_MAX_Y;
      const flickedLeft = current.velocityX < -0.55 && dx < -32 && Math.abs(dx) > Math.abs(dy);
      if (!current.active) return;
      event.preventDefault();
      event.stopPropagation();
      if (draggedLeft || flickedLeft) _animateCloseSidebarDrawerFromGesture(current.sidebar);
      else _clearSidebarDragOffset(current.sidebar);
    }, { capture: true });

    document.addEventListener('pointercancel', reset, { capture: true });
  }

  function _activePaneType(pane) {
    return pane?.tabs?.[pane.activeTabIndex]?.type || '';
  }

  function _isOutlinerPane(pane) {
    const tabs = pane?.tabs || [];
    return _activePaneType(pane) === 'outliner' || (tabs.length > 0 && tabs.every(tab => tab?.type === 'outliner'));
  }

  function _findMobileContentPane() {
    if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') return null;
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true });
    return panes.find(pane => !_isOutlinerPane(pane)) || panes[0] || null;
  }

  function _rememberMobileCollapsedTarget(target) {
    if (!target?.id || _mobileCollapsedColumns.has(target.id)) return;
    _mobileCollapsedColumns.set(target.id, { collapsed: !!target.collapsed });
  }

  function _setRememberedMobileCollapsedTargets(collapsed) {
    if (!_mobileCollapsedColumns.size || typeof GBLayout === 'undefined' || !GBLayout.root) return false;
    let changed = false;
    _mobileCollapsedColumns.forEach((state, id) => {
      const node = GBLayout.findNode?.(GBLayout.root, id)?.node || null;
      if (!node) return;
      const next = collapsed ? true : !!state.collapsed;
      if (node.collapsed !== next) {
        node.collapsed = next;
        changed = true;
      }
    });
    return changed;
  }

  function _restoreMobileCollapsedColumns(options = {}) {
    const changed = _setRememberedMobileCollapsedTargets(false);
    if (options.clear !== false) _mobileCollapsedColumns.clear();
    if (changed && !options.skipRender && typeof GBLayout !== 'undefined') GBLayout.render?.();
    return changed;
  }

  function _reapplyMobileCollapsedColumns() {
    if (!shouldUseSidebarDrawer()) return false;
    return _setRememberedMobileCollapsedTargets(true);
  }

  function _collapseOutlinerColumns() {
    if (!shouldUseSidebarDrawer()) return { changed: false, nextActivePaneId: '' };
    if (typeof GBLayout === 'undefined' || !GBLayout.root || typeof GBLayout.getAllPanes !== 'function') {
      return { changed: false, nextActivePaneId: '' };
    }
    const panes = GBLayout.getAllPanes(GBLayout.root);
    let changed = false;
    for (const pane of panes) {
      if (!_isOutlinerPane(pane)) continue;
      const columnId = typeof GBLayout._findColumnAncestorId === 'function'
        ? GBLayout._findColumnAncestorId(pane.id)
        : '';
      const targetInfo = columnId
        ? GBLayout.findNode?.(GBLayout.root, columnId)
        : GBLayout.findNode?.(GBLayout.root, pane.id);
      const target = targetInfo?.node;
      if (target && !target.collapsed) {
        _rememberMobileCollapsedTarget(target);
        target.collapsed = true;
        changed = true;
      }
    }
    let nextActivePaneId = '';
    const activeInfo = GBLayout.activePane ? GBLayout.findNode?.(GBLayout.root, GBLayout.activePane) : null;
    if (activeInfo?.node && _isOutlinerPane(activeInfo.node)) {
      const nextPane = _findMobileContentPane();
      if (nextPane && nextPane.id !== GBLayout.activePane) {
        nextActivePaneId = nextPane.id;
      }
    }
    return { changed, nextActivePaneId };
  }

  function sanitizeLayoutForMobile() {
    if (!shouldUseSidebarDrawer()) return;
    if (_sanitizingLayout) return;
    _sanitizingLayout = true;
    try {
      const keepSidebarOpen = document.getElementById('sidebar')?.classList?.contains('open');
      const result = _collapseOutlinerColumns();
      if (
        result.nextActivePaneId &&
        typeof GBLayout !== 'undefined' &&
        typeof GBLayout.exportLayout === 'function' &&
        typeof GBLayout.applyLayoutTree === 'function'
      ) {
        GBLayout.applyLayoutTree(GBLayout.exportLayout(), { activePaneId: result.nextActivePaneId, skipSave: true });
      } else if (result.changed && typeof GBLayout !== 'undefined') {
        GBLayout.render?.();
      }
      if (keepSidebarOpen) openSidebarDrawer(false);
    } finally {
      _sanitizingLayout = false;
    }
  }

  function _scheduleLayoutSanitize() {
    if (!shouldUseSidebarDrawer()) return;
    setTimeout(sanitizeLayoutForMobile, 0);
    setTimeout(sanitizeLayoutForMobile, 80);
  }

  function _installSidebarOverride() {
    if (window.toggleSidebar?.__cloudMobileSidebarWrapped) return;
    _desktopToggleSidebar = window.toggleSidebar || _desktopToggleSidebar;
    const wrapped = function (withFolderView) {
      if (toggleSidebarDrawer(withFolderView)) return;
      return _desktopToggleSidebar?.apply(this, arguments);
    };
    wrapped.__cloudMobileSidebarWrapped = true;
    window.toggleSidebar = wrapped;

    const backdrop = document.getElementById('sidebar-backdrop');
    backdrop?.addEventListener('click', (event) => {
      if (!shouldUseSidebarDrawer()) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      closeSidebarDrawer();
    }, true);
  }

  function _installLayoutSaveHook() {
    if (_layoutSaveHookInstalled || typeof GBLayout === 'undefined' || typeof GBLayout.saveLayout !== 'function') return;
    _layoutSaveHookInstalled = true;
    const originalSaveLayout = GBLayout.saveLayout;
    GBLayout.saveLayout = function (options) {
      if (_mobileCollapsedColumns.size && shouldUseSidebarDrawer()) {
        const restored = _restoreMobileCollapsedColumns({ skipRender: true, clear: false });
        try {
          return originalSaveLayout.call(this, { ...(options || {}), immediate: true });
        } finally {
          if (restored) _reapplyMobileCollapsedColumns();
        }
      }
      return originalSaveLayout.apply(this, arguments);
    };
  }

  function _installLayoutRenderHook() {
    if (_layoutHookInstalled || typeof GBLayout === 'undefined' || typeof GBLayout.render !== 'function') return;
    _layoutHookInstalled = true;
    const originalRender = GBLayout.render;
    GBLayout.render = function () {
      const result = originalRender.apply(this, arguments);
      _ensurePaneTreeBackButtons();
      _syncPaneSafeTopBars();
      if (!_sanitizingLayout) setTimeout(sanitizeLayoutForMobile, 0);
      return result;
    };
  }

  function _installTreeScreenAutoClose() {
    if (document.__MeldexCloudMobileTreeAutoCloseInstalled) return;
    document.__MeldexCloudMobileTreeAutoCloseInstalled = true;
    document.addEventListener('click', (event) => {
      if (!shouldUseSidebarDrawer()) return;
      const sidebar = document.getElementById('sidebar');
      if (!sidebar?.classList?.contains('cloud-mobile-tree-screen-open')) return;
      if (event.target?.closest?.('.tree-toggle, .tree-hover-btn, .tree-hover-btns, button, input, select, textarea')) return;
      const row = event.target?.closest?.('.tree-node-row, .fav-item, .sidebar-item');
      if (!row || !sidebar.contains(row)) return;
      const node = row.closest?.('.tree-node');
      const data = node?._nodeData || row._nodeData || null;
      const type = String(data?.type || '').toLowerCase();
      if (!data && !row.matches?.('.fav-item, .sidebar-item')) return;
      if (data && type === 'folder') return;
      setTimeout(closeSidebarDrawer, 180);
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (document.getElementById('sidebar')?.classList?.contains('cloud-mobile-tree-screen-open')) {
        closeSidebarDrawer();
      }
    });
  }

  function refreshCloudMobileViewport() {
    if (!document.body) return;
    const visualViewport = window.visualViewport || null;
    const visibleHeight = Math.max(1, Math.round(visualViewport?.height || window.innerHeight || 1));
    const offsetTop = Math.max(0, Math.round(visualViewport?.offsetTop || 0));
    const innerHeight = Math.max(1, Math.round(window.innerHeight || visibleHeight));
    const keyboardGap = visualViewport
      ? Math.max(0, Math.round(innerHeight - visibleHeight - offsetTop))
      : 0;
    document.documentElement.style.setProperty('--cloud-visual-vh', `${visibleHeight}px`);
    document.documentElement.style.setProperty('--cloud-visual-offset-top', `${offsetTop}px`);

    const dropboxMode = _isDropboxMode();
    const localMobileMode = !dropboxMode && _isLocalMobileUiAllowed();
    const mobile = (dropboxMode || localMobileMode) && _isMobileViewport() && !_isSingleWindow();
    const editingUiEnabled = isMobileEditingUiEnabled();
    _setDatasetFlag('cloudMobile', mobile);
    _setDatasetFlag('cloudMobileEditingUi', editingUiEnabled);
    _setDatasetFlag('mobileUi', mobile);
    _setDatasetFlag('mobileUiLocal', mobile && localMobileMode);
    _setDatasetFlag('mobileEditingUi', editingUiEnabled);
    _ensurePaneTreeBackButtons();
    _syncPaneSafeTopBars();
    const keyboardOpen = mobile && (
      visualViewport
        ? (keyboardGap > KEYBOARD_THRESHOLD || (_isFocusedTextInput() && keyboardGap > 40))
        : _isFocusedTextInput()
    );
    _setDatasetFlag('cloudMobileKeyboard', keyboardOpen);
    const detail = {
      mobile,
      editingUiEnabled,
      keyboardOpen,
      visualHeight: visibleHeight,
      offsetTop,
      innerHeight,
      keyboardGap,
      singleWindow: _isSingleWindow(),
      dropboxMode,
      localMobileMode,
    };
    window.MeldexCloudMobileState = detail;
    document.dispatchEvent(new CustomEvent('meldex-cloud-mobile-viewport', { detail }));
    if (mobile) _scheduleLayoutSanitize();
    else {
      closeSidebarDrawer();
      _restoreMobileCollapsedColumns();
    }
  }

  function _bind() {
    _ensureTreeScreenHeader();
    _ensurePaneTreeBackButtons();
    _installSidebarOverride();
    _installLayoutSaveHook();
    _installLayoutRenderHook();
    _installTreeScreenAutoClose();
    _installPaneBackButtonObserver();
    _installEdgeSwipeBack();
    _installSidebarDismissGesture();
    refreshCloudMobileViewport();
    window.addEventListener('resize', refreshCloudMobileViewport, { passive: true });
    window.addEventListener('orientationchange', refreshCloudMobileViewport, { passive: true });
    window.visualViewport?.addEventListener('resize', refreshCloudMobileViewport, { passive: true });
    window.visualViewport?.addEventListener('scroll', refreshCloudMobileViewport, { passive: true });
    if (media?.addEventListener) media.addEventListener('change', refreshCloudMobileViewport);
    else media?.addListener?.(refreshCloudMobileViewport);
    new MutationObserver(refreshCloudMobileViewport).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-cloud-mode'],
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bind, { once: true });
  else _bind();

  window.MeldexCloudMobile = {
    refresh: refreshCloudMobileViewport,
    shouldUseSidebarDrawer,
    isMobileEditingUiEnabled,
    isSingleWindow: _isSingleWindow,
    getState: () => ({ ...(window.MeldexCloudMobileState || {}) }),
    openSidebar: openSidebarDrawer,
    closeSidebar: closeSidebarDrawer,
    toggleSidebarDrawer,
    afterLayoutApplied: _scheduleLayoutSanitize,
  };
})();
