      if (item.id === 'visibility') button.dataset.annMobileVisibility = '1';
      row.appendChild(button);
    });
    _annotationBar.appendChild(row);
    document.body.appendChild(_annotationBar);
    _syncAnnotationBarState();
    return _annotationBar;
  }

  function _openOverflowSheet() {
    if (!_isEnabled()) return;
    _closeMenuSheet();
    _closeOverflowSheet();
    _overflowOverlay = document.createElement('div');
    _overflowOverlay.className = 'cloud-mobile-overflow-overlay';
    _fitOverlayToVisualViewport(_overflowOverlay);
    _overflowOverlay.setAttribute('role', 'presentation');
    const sheet = document.createElement('div');
    sheet.className = 'cloud-mobile-overflow-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '書式メニュー');
    _applySheetViewportLimit(sheet, _overflowOverlay);

    const header = document.createElement('div');
    header.className = 'cloud-mobile-sheet-header';
    const title = document.createElement('strong');
    title.textContent = '書式';
    header.appendChild(title);
    const closeButton = _button('cloud-mobile-sheet-close', '閉じる', 'x', _closeOverflowSheet);
    closeButton.dataset.cloudMobileMenuAction = 'close';
    closeButton.dataset.e2eId = 'cloud-mobile-overflow-close';
    header.appendChild(closeButton);
    sheet.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'cloud-mobile-menu-grid';
    OVERFLOW_ITEMS.forEach((item, index) => {
      const itemId = _stableItemId(item, index);
      const button = _button('cloud-mobile-menu-item', item.label, item.icon, () => {
        _closeOverflowSheet();
        item.action?.();
      });
      button.dataset.cloudMobileMenuAction = itemId;
      button.dataset.e2eId = `cloud-mobile-overflow-${itemId}`;
      grid.appendChild(button);
    });
    sheet.appendChild(grid);
    _overflowOverlay.appendChild(sheet);
    _overflowOverlay.addEventListener('pointerdown', (event) => {
      if (event.target === _overflowOverlay) _closeOverflowSheet();
    });
    document.body.appendChild(_overflowOverlay);
  }

  function _openNewItemSheet() {
    if (!_isEnabled()) return;
    if (_mobileWriteBlocked()) {
      if (typeof showStatus === 'function') showStatus('この保存先は閲覧のみです', true);
      return;
    }
    _closeMenuSheet();
    _closeOverflowSheet();
    _overflowOverlay = document.createElement('div');
    _overflowOverlay.className = 'cloud-mobile-overflow-overlay';
    _fitOverlayToVisualViewport(_overflowOverlay);
    _overflowOverlay.setAttribute('role', 'presentation');
    const sheet = document.createElement('div');
    sheet.className = 'cloud-mobile-overflow-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '新規作成メニュー');
    _applySheetViewportLimit(sheet, _overflowOverlay);

    const header = document.createElement('div');
    header.className = 'cloud-mobile-sheet-header';
    const title = document.createElement('strong');
    title.textContent = '新規作成';
    header.appendChild(title);
    const closeButton = _button('cloud-mobile-sheet-close', '閉じる', 'x', _closeOverflowSheet);
    closeButton.dataset.cloudMobileMenuAction = 'close';
    closeButton.dataset.e2eId = 'cloud-mobile-new-item-close';
    header.appendChild(closeButton);
    sheet.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'cloud-mobile-menu-grid';
    const items = window.MeldexCloudBootstrap?.filterPhase1CreateItems?.(NEW_ITEMS) || NEW_ITEMS;
    items.forEach((item, index) => {
      const itemId = _stableItemId(item, index);
      const button = _button('cloud-mobile-menu-item', item.label, item.icon, () => {
        _closeOverflowSheet();
        _createNewItemFromMobileSheet(item.type);
      });
      button.dataset.cloudMobileMenuAction = itemId;
      button.dataset.e2eId = `cloud-mobile-new-item-${itemId}`;
      grid.appendChild(button);
    });
    sheet.appendChild(grid);
    _overflowOverlay.appendChild(sheet);
    _overflowOverlay.addEventListener('pointerdown', (event) => {
      if (event.target === _overflowOverlay) _closeOverflowSheet();
    });
    document.body.appendChild(_overflowOverlay);
  }

  async function _createNewItemFromMobileSheet(type) {
    if (_mobileWriteBlocked()) {
      if (typeof showStatus === 'function') showStatus('この保存先は閲覧のみです', true);
      return;
    }
    const explorer = window.MeldexCloudMobileExplorer || null;
    const target = explorer?.currentFolderTarget?.()
      || explorer?.selectedFolderTarget?.()
      || null;
    if (target?.path && typeof addItemAt === 'function') {
      await addItemAt(target.path, type);
      if (explorer?.getMode?.() === 'list') explorer.renderCurrent?.({ force: true });
      return;
    }
    _callGlobal('showAddOutlinerItem', type);
  }

  function _openBoardOverflowSheet() {
    if (!_isEnabled()) return;
    _closeMenuSheet();
    _closeOverflowSheet();
    _overflowOverlay = document.createElement('div');
    _overflowOverlay.className = 'cloud-mobile-overflow-overlay';
    _fitOverlayToVisualViewport(_overflowOverlay);
    _overflowOverlay.setAttribute('role', 'presentation');
    const sheet = document.createElement('div');
    sheet.className = 'cloud-mobile-overflow-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'ボード操作メニュー');
    _applySheetViewportLimit(sheet, _overflowOverlay);

    const header = document.createElement('div');
    header.className = 'cloud-mobile-sheet-header';
    const title = document.createElement('strong');
    title.textContent = 'ボード';
    header.appendChild(title);
    const closeButton = _button('cloud-mobile-sheet-close', '閉じる', 'x', _closeOverflowSheet);
    closeButton.dataset.cloudMobileMenuAction = 'close';
    closeButton.dataset.e2eId = 'cloud-mobile-board-overflow-close';
    header.appendChild(closeButton);
    sheet.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'cloud-mobile-menu-grid';
    BOARD_OVERFLOW_ITEMS.forEach((item, index) => {
      const itemId = _stableItemId(item, index);
      const button = _button('cloud-mobile-menu-item', item.label, item.icon, () => {
        _closeOverflowSheet();
        item.action?.();
      });
      button.dataset.cloudMobileMenuAction = itemId;
      button.dataset.e2eId = `cloud-mobile-board-overflow-${itemId}`;
      grid.appendChild(button);
    });
    sheet.appendChild(grid);
    _overflowOverlay.appendChild(sheet);
    _overflowOverlay.addEventListener('pointerdown', (event) => {
      if (event.target === _overflowOverlay) _closeOverflowSheet();
    });
    document.body.appendChild(_overflowOverlay);
  }

  function _closeOverflowSheet() {
    _overflowOverlay?.remove();
    _overflowOverlay = null;
  }

  function _updateViewportVars(detail) {
    const state = detail || _viewportState || {};
    const vv = window.visualViewport || null;
    const bottom = vv
      ? Math.max(0, Math.round((window.innerHeight || state.innerHeight || vv.height) - vv.height - (vv.offsetTop || 0)))
      : 0;
    document.documentElement.style.setProperty('--cloud-mobile-editbar-bottom', `${bottom}px`);
  }

  // 同じ値の再設定も変更通知になり、ツールバーのあふれ判定を起こしてしまう。
  // 変わる時だけ書く（あふれ判定と互いに起こし合う無限ループの防止）。
  function _setHidden(el, hidden) {
    if (el && el.hidden !== !!hidden) el.hidden = !!hidden;
  }

  function _hasVisibleInlineMobileMenu() {
    const folderView = document.getElementById('folder-view');
    const folderToolbar = document.getElementById('folder-toolbar');
    return _isVisibleElement(folderView) && _isVisibleElement(folderToolbar)
      && !!folderToolbar.querySelector('.tool-menu-btn');
  }

  function _refresh() {
    if (!document.body) return;
    const enabled = _isEnabled();
    // 無効（パソコン表示）の時はどのバーも出さないため、文書全体からダイアログを探す重い判定を省く。
    // パネル幅の変更や大きなシートの描画のたびに走り、境界線ドラッグを重くしていた（2026-11-11）。
    const modalOpen = enabled && _hasBlockingModal();
    const keyboardOpen = document.body.dataset.cloudMobileKeyboard === '1';
    const annotationTextInput = _annotationTextInputFromNode(document.activeElement);
    const annotationActive = _isAnnotationActive();
    const annotationRequested = document.body.dataset.cloudMobileAnnotationRequested === '1';
    const editable = _getActiveEditable();
    const chatInput = _getActiveChatInput();
    const plainInput = _getActivePlainInput();
    const showEditBar = enabled && !modalOpen && keyboardOpen && !!editable && !annotationTextInput;
    const showChatBar = enabled && !modalOpen && keyboardOpen && !showEditBar && !!chatInput;
    const showInputBar = enabled && !modalOpen && keyboardOpen && !showEditBar && !showChatBar && !!plainInput;
    const showAnnotationBar = enabled && _isAnnotationPhoneViewport() && !modalOpen && !showEditBar && !showChatBar && !showInputBar && (annotationActive || annotationRequested) && (!keyboardOpen || !!annotationTextInput);
    const showBoardBar = enabled && !modalOpen && !showEditBar && !showChatBar && !showInputBar && !showAnnotationBar && !keyboardOpen && _isBoardActive();
    const treeOpen = document.body.classList.contains('cloud-mobile-tree-screen-active')
      || document.getElementById('sidebar')?.classList?.contains('cloud-mobile-tree-screen-open');
    const inlineMenuAvailable = _hasVisibleInlineMobileMenu();
    const chatPaneActive = typeof GBLayout !== 'undefined' && typeof GBTabs !== 'undefined'
      && GBTabs.getActiveTab?.(GBLayout.activePane)?.type === 'chat';
    _activeEditable = editable || _activeEditable;
    _activeChatInput = chatInput || (_activeChatInput?.isConnected ? _activeChatInput : null);
    _activePlainInput = plainInput || (_activePlainInput?.isConnected ? _activePlainInput : null);
    _updateViewportVars();
    _ensureMainButton();
    _ensureEditBar();
    _ensureInputBar();
    _ensureChatBar();
    _ensureBoardBar();
    _ensureAnnotationBar();
    _syncAnnotationBarState();
    _setHidden(_mainButton, !enabled || modalOpen || treeOpen || inlineMenuAvailable || chatPaneActive || keyboardOpen || showChatBar || showInputBar || showBoardBar || showAnnotationBar);
    _setHidden(_editBar, !showEditBar);
    _setHidden(_chatBar, !showChatBar);
    _setHidden(_inputBar, !showInputBar);
    _setHidden(_boardBar, !showBoardBar);
    _setHidden(_annotationBar, !showAnnotationBar);
    _setDatasetFlag('cloudMobileEditbarOpen', showEditBar || showInputBar);
    _setDatasetFlag('cloudMobileInputbarOpen', showInputBar);
    _setDatasetFlag('cloudMobileChatbarOpen', showChatBar);
    _setDatasetFlag('cloudMobileBoardbarOpen', showBoardBar);
    _setDatasetFlag('cloudMobileAnnotationbarOpen', showAnnotationBar);
    if (enabled && typeof window.GBTextSelectionFormat?.close === 'function') window.GBTextSelectionFormat.close();
    if (!enabled || modalOpen) {
      _closeMenuSheet();
      _closeOverflowSheet();
    }
  }

  function _setDatasetFlag(name, enabled) {
    if (!document.body) return;
    if (enabled) {
      if (document.body.dataset[name] !== '1') document.body.dataset[name] = '1';
    } else if (name in document.body.dataset) {
      delete document.body.dataset[name];
    }
  }

  const _TOOLBAR_OVERFLOW_HIDDEN_CLASS = 'gb-tbo-hidden';
  function _classWithoutToolbarOverflow(value) {
    return String(value || '').split(/\s+/).filter(name => name && name !== _TOOLBAR_OVERFLOW_HIDDEN_CLASS).sort().join(' ');
  }

  function _isToolbarOverflowClassToggle(record) {
    return record?.type === 'attributes' && record.attributeName === 'class'
      && _classWithoutToolbarOverflow(record.oldValue) === _classWithoutToolbarOverflow(record.target?.getAttribute?.('class'));
  }

  function _scheduleRefresh() {
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(_refresh, 0);
  }

  function _bind() {
    _ensureMainButton();
    _ensureEditBar();
    _ensureInputBar();
    _ensureChatBar();
    _ensureBoardBar();
    _ensureAnnotationBar();
    document.addEventListener('meldex-cloud-mobile-viewport', (event) => {
      _viewportState = event.detail || {};
      _updateViewportVars(_viewportState);
      _scheduleRefresh();
    });
    document.addEventListener('selectionchange', () => {
      _saveSelection();
      _scheduleRefresh();
    });
    document.addEventListener('focusin', () => {
      _saveSelection();
      _scheduleRefresh();
      setTimeout(_scheduleRefresh, 180);
      setTimeout(_scheduleRefresh, 420);
    });
    document.addEventListener('focusout', () => setTimeout(_scheduleRefresh, 80));
    document.addEventListener('input', (event) => {
      if (_editableFromNode(event.target)) _saveSelection();
      if (_chatInputFromNode(event.target)) _activeChatInput = event.target;
      if (_plainInputFromNode(event.target)) _activePlainInput = event.target;
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        _closeMenuSheet();
        _closeOverflowSheet();
      }
    });
    new MutationObserver(_scheduleRefresh).observe(document.body, {
      attributes: true,
      attributeFilter: ['data-cloud-mode', 'data-cloud-mobile', 'data-cloud-mobile-keyboard', 'data-cloud-mobile-editing-ui'],
      childList: true,
    });
    const mainViews = document.getElementById('main-views');
    if (mainViews) {
      // ツールバーのあふれ判定は測り直しのたびに隠しクラスを外して付け直す。
      // その出し入れだけでは更新しない（拾うとあふれ判定と互いに起こし合って止まらない）。
      new MutationObserver((records) => {
        if (records.some(record => !_isToolbarOverflowClassToggle(record))) _scheduleRefresh();
      }).observe(mainViews, {
        attributes: true,
        attributeFilter: ['style', 'class'],
        attributeOldValue: true,
        subtree: true,
      });
    }
    const annToolbar = document.getElementById('ann-toolbar');
    if (annToolbar) {
      annToolbar.addEventListener('click', () => setTimeout(_scheduleRefresh, 0), true);
      new MutationObserver((records) => {
        if (records.some(record => !_isToolbarOverflowClassToggle(record))) _scheduleRefresh();
      }).observe(annToolbar, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        attributeOldValue: true,
        subtree: true,
      });
    }
    document.getElementById('btn-overlay-toggle')?.addEventListener('click', () => setTimeout(_scheduleRefresh, 0), true);
    _scheduleRefresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bind, { once: true });
  else _bind();

  window.MeldexCloudMobileEditBar = {
    refresh: _refresh,
    openMenu: _openMenuSheet,
    openToolMenu: _openToolMenuSheet,
    closeMenu: _closeMenuSheet,
    closeOverflow: _closeOverflowSheet,
  };
})();
