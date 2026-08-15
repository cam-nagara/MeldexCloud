    const range = sel.getRangeAt(0);
    const editable = _editableFromNode(range.commonAncestorContainer);
    if (!editable) return false;
    _activeEditable = editable;
    _savedRange = range.cloneRange();
    try {
      if (typeof rtTarget !== 'undefined') rtTarget = editable;
      if (typeof rtSavedSelection !== 'undefined') rtSavedSelection = _savedRange.cloneRange();
    } catch (_err) {
      // rtTarget is a global lexical binding in the legacy editor bundle when available.
    }
    return true;
  }

  function _restoreSelection() {
    const editable = _activeEditable || _getActiveEditable();
    if (!editable) return false;
    editable.focus?.({ preventScroll: true });
    if (!_savedRange) return true;
    const sel = window.getSelection?.();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(_savedRange.cloneRange());
    try {
      if (typeof rtTarget !== 'undefined') rtTarget = editable;
      if (typeof rtSavedSelection !== 'undefined') rtSavedSelection = _savedRange.cloneRange();
    } catch (_err) {
      // See _saveSelection().
    }
    return true;
  }

  function _dispatchInput() {
    const editable = _activeEditable || _getActiveEditable();
    editable?.dispatchEvent?.(new Event('input', { bubbles: true }));
  }

  function _isLegacyRichTextEditable(editable) {
    return !!editable?.matches?.('#page-content, #entity-freetext, #dp-editable');
  }

  function _execTextCommand(command, value) {
    _restoreSelection();
    const editable = _activeEditable || _getActiveEditable();
    if (_isLegacyRichTextEditable(editable) && typeof rtCmd === 'function') {
      rtCmd(command, value);
    } else {
      document.execCommand(command, false, value || null);
    }
    _dispatchInput();
    _saveSelection();
  }

  function _formatBlock(tag) {
    _restoreSelection();
    const editable = _activeEditable || _getActiveEditable();
    if (_isLegacyRichTextEditable(editable) && typeof rtHeading === 'function' && tag !== 'P') rtHeading(tag);
    else document.execCommand('formatBlock', false, tag);
    _dispatchInput();
    _saveSelection();
  }

  function _openColor(anchor, command) {
    _restoreSelection();
    if (typeof openColorPalette !== 'function') return;
    const fallback = command === 'hiliteColor' ? '#ffff88' : '#ffffff';
    openColorPalette(anchor, anchor?.dataset?.color || '', (color) => {
      const next = color || fallback;
      if (anchor?.dataset) anchor.dataset.color = next;
      _execTextCommand(command, next);
    });
  }

  function _normalizeSafeMobileUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) return null;
    let candidate = raw;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
      if (!/^[^\s/@]+\.[^\s/]{2,}([/?#].*)?$/i.test(candidate)) return null;
      candidate = 'https://' + candidate;
    }
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return null;
      return candidate;
    } catch (_err) {
      return null;
    }
  }

  function _createLink() {
    _restoreSelection();
    const url = window.prompt?.('リンク先URL');
    if (!url) return;
    const safeUrl = _normalizeSafeMobileUrl(url);
    if (!safeUrl) {
      if (typeof showStatus === 'function') showStatus('安全なURLを入力してください', true);
      return;
    }
    _execTextCommand('createLink', safeUrl);
  }

  function _insertCalloutFromMobile() {
    _restoreSelection();
    if (typeof insertCallout === 'function') {
      insertCallout();
      _saveSelection();
      return true;
    }
    if (typeof showStatus === 'function') showStatus('コールアウトを挿入できませんでした', true);
    return false;
  }

  function _ensureMainButton() {
    if (_mainButton?.isConnected) return _mainButton;
    if (!document.body) return null;
    const existing = document.getElementById('cloud-mobile-main-button');
    if (existing) {
      _mainButton = existing;
      return _mainButton;
    }
    _mainButton = document.createElement('button');
    _mainButton.type = 'button';
    _mainButton.id = 'cloud-mobile-main-button';
    _mainButton.className = 'cloud-mobile-main-button';
    _mainButton.title = 'メニュー';
    _mainButton.setAttribute('aria-label', 'メニューを開く');
    _mainButton.appendChild(_icon('menu', 20));
    const label = document.createElement('span');
    label.className = 'cloud-mobile-label';
    label.textContent = 'メニュー';
    _mainButton.appendChild(label);
    _mainButton.hidden = true;
    _bindPressAction(_mainButton, _openMenuSheet);
    document.body.appendChild(_mainButton);
    return _mainButton;
  }

  function _stableItemId(item, index) {
    return String(item?.id || item?.type || `item-${index + 1}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `item-${index + 1}`;
  }

  function _appendSheetSection(sheet, title, items, sectionId) {
    const section = document.createElement('section');
    section.className = 'cloud-mobile-menu-section';
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.appendChild(heading);
    const grid = document.createElement('div');
    grid.className = 'cloud-mobile-menu-grid';
    items.forEach((item, index) => {
      if (!item || item.separator) return;
      const itemId = _stableItemId(item, index);
      const button = _button('cloud-mobile-menu-item', item.label, item.icon, () => {
        _closeMenuSheet();
        if (item.submenu) _openToolSubmenuSheet(item.label, item.submenu, `${sectionId || 'section'}-${itemId}`);
        else item.action?.({ trigger: _mainButton?.isConnected ? _mainButton : null });
      });
      if (item.submenu) button.setAttribute('aria-haspopup', 'dialog');
      if (item.disabled) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
      }
      button.dataset.cloudMobileMenuAction = itemId;
      button.dataset.e2eId = `cloud-mobile-menu-${sectionId || 'section'}-${itemId}`;
      grid.appendChild(button);
    });
    section.appendChild(grid);
    sheet.appendChild(section);
  }

  function _openToolSubmenuSheet(titleText, items, sectionId) {
    if (!items?.length) return false;
    _closeOverflowSheet();
    _closeMenuSheet();
    _menuOverlay = document.createElement('div');
    _menuOverlay.className = 'cloud-mobile-menu-overlay';
    _fitOverlayToVisualViewport(_menuOverlay);
    _menuOverlay.setAttribute('role', 'presentation');

    const sheet = document.createElement('div');
    sheet.className = 'cloud-mobile-menu-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', titleText || 'サブメニュー');
    _applySheetViewportLimit(sheet, _menuOverlay);

    const header = document.createElement('div');
    header.className = 'cloud-mobile-sheet-header';
    const title = document.createElement('strong');
    title.textContent = titleText || 'メニュー';
    header.appendChild(title);
    const closeButton = _button('cloud-mobile-sheet-close', '閉じる', 'x', _closeMenuSheet);
    closeButton.dataset.cloudMobileMenuAction = 'close';
    closeButton.dataset.e2eId = 'cloud-mobile-tool-submenu-close';
    header.appendChild(closeButton);
    sheet.appendChild(header);

    _appendSheetSection(sheet, titleText || 'メニュー', items, sectionId || 'tool-submenu');
    _menuOverlay.appendChild(sheet);
    _menuOverlay.addEventListener('pointerdown', (event) => {
      if (event.target === _menuOverlay) _closeMenuSheet();
    });
    document.body.appendChild(_menuOverlay);
    return true;
  }

  function _fitOverlayToVisualViewport(overlay) {
    if (!overlay?.style) return;
    const vv = window.visualViewport;
    const heights = [
      Number(window.innerHeight || 0),
      Number(document.documentElement?.clientHeight || 0),
      Number(vv?.height || 0),
    ].filter(value => Number.isFinite(value) && value > 0);
    const viewportHeight = Math.max(1, Math.min(...(heights.length ? heights : [window.innerHeight || 1])));
    const top = Math.max(0, Math.min(Number(vv?.offsetTop || 0) || 0, viewportHeight - 1));
    const zoomRaw = getComputedStyle(document.documentElement).getPropertyValue('--meldex-ui-zoom')
      || document.documentElement.style.zoom
      || '1';
    const zoomValue = Number.parseFloat(String(zoomRaw).trim());
    const zoom = Number.isFinite(zoomValue) && zoomValue > 0 ? zoomValue : 1;
    const height = Math.max(1, (viewportHeight - top) / zoom);
    overlay.style.boxSizing = 'border-box';
    overlay.style.top = top + 'px';
    overlay.style.height = height + 'px';
    overlay.style.maxHeight = height + 'px';
    overlay.style.setProperty('--cloud-mobile-sheet-max-height', Math.max(1, height - 20) + 'px');
  }

  function _applySheetViewportLimit(sheet, overlay) {
    if (!sheet?.style) return;
    const maxHeight = overlay?.style?.getPropertyValue('--cloud-mobile-sheet-max-height') || '';
    if (!maxHeight) return;
    sheet.style.boxSizing = 'border-box';
    sheet.style.maxHeight = maxHeight;
    sheet.style.overflow = 'auto';
  }

  function _openMenuSheet() {
    if (!_isEnabled() || _hasBlockingModal()) return;
    _closeOverflowSheet();
    _closeMenuSheet();
    _menuOverlay = document.createElement('div');
    _menuOverlay.className = 'cloud-mobile-menu-overlay';
    _fitOverlayToVisualViewport(_menuOverlay);
    _menuOverlay.setAttribute('role', 'presentation');

    const sheet = document.createElement('div');
    sheet.className = 'cloud-mobile-menu-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'スマホ用メニュー');
    _applySheetViewportLimit(sheet, _menuOverlay);

    const header = document.createElement('div');
    header.className = 'cloud-mobile-sheet-header';
    const title = document.createElement('strong');
    title.textContent = 'メニュー';
    header.appendChild(title);
    const closeButton = _button('cloud-mobile-sheet-close', '閉じる', 'x', _closeMenuSheet);
    closeButton.dataset.cloudMobileMenuAction = 'close';
    closeButton.dataset.e2eId = 'cloud-mobile-menu-close';
    header.appendChild(closeButton);
    sheet.appendChild(header);

    const activeToolType = _activeToolType();
    const activeToolItems = _toolMenuItems(activeToolType);
    if (activeToolItems.length) _appendSheetSection(sheet, _toolMenuTitle(activeToolType), activeToolItems, `active-${activeToolType}`);
    if (LAYOUT_ITEMS.length) _appendSheetSection(sheet, 'レイアウト', LAYOUT_ITEMS, 'layout');
    _appendSheetSection(sheet, 'パネル', PANEL_ITEMS, 'panel');
    _appendSheetSection(sheet, 'ツール', _mobileWriteBlocked()
      ? TOOL_ITEMS.filter(item => item.label !== '新規作成')
      : TOOL_ITEMS, 'tool');

    _menuOverlay.appendChild(sheet);
    _menuOverlay.addEventListener('pointerdown', (event) => {
      if (event.target === _menuOverlay) _closeMenuSheet();
    });
    document.body.appendChild(_menuOverlay);
  }

  function _openToolMenuSheet(toolType) {
    if (!_isEnabled() || _hasBlockingModal()) return false;
    const toolItems = _toolMenuItems(toolType);
    if (!toolItems.length) return false;
    _closeOverflowSheet();
    _closeMenuSheet();
    _menuOverlay = document.createElement('div');
    _menuOverlay.className = 'cloud-mobile-menu-overlay';
    _fitOverlayToVisualViewport(_menuOverlay);
    _menuOverlay.setAttribute('role', 'presentation');

    const sheet = document.createElement('div');
    sheet.className = 'cloud-mobile-menu-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', `${_toolMenuTitle(toolType)}メニュー`);
    _applySheetViewportLimit(sheet, _menuOverlay);

    const header = document.createElement('div');
    header.className = 'cloud-mobile-sheet-header';
    const title = document.createElement('strong');
    title.textContent = _toolMenuTitle(toolType);
    header.appendChild(title);
    const closeButton = _button('cloud-mobile-sheet-close', '閉じる', 'x', _closeMenuSheet);
    closeButton.dataset.cloudMobileMenuAction = 'close';
    closeButton.dataset.e2eId = 'cloud-mobile-tool-menu-close';
    header.appendChild(closeButton);
    sheet.appendChild(header);

    _appendSheetSection(sheet, '操作', toolItems, `tool-${toolType || 'current'}`);
    _menuOverlay.appendChild(sheet);
    _menuOverlay.addEventListener('pointerdown', (event) => {
      if (event.target === _menuOverlay) _closeMenuSheet();
    });
    document.body.appendChild(_menuOverlay);
    return true;
  }

  function _closeMenuSheet() {
    _menuOverlay?.remove();
    _menuOverlay = null;
  }

  function _ensureEditBar() {
    if (_editBar || !document.body) return _editBar;
    _editBar = document.createElement('div');
    _editBar.id = 'cloud-mobile-editbar';
    _editBar.className = 'cloud-mobile-editbar';
    _editBar.setAttribute('role', 'toolbar');
    _editBar.setAttribute('aria-label', 'スマホ用書式ツールバー');
    _editBar.hidden = true;

    const row = document.createElement('div');
    row.className = 'cloud-mobile-editbar-row';
    EDITBAR_ITEMS.forEach((item) => {
      const button = _button('cloud-mobile-editbar-btn', item.label, item.icon, item.action);
      if (item.id) {
        button.dataset.cloudMobileEditbarAction = item.id;
        button.dataset.e2eId = 'cloud-mobile-editbar-' + item.id;
      }
      row.appendChild(button);
    });
    _editBar.appendChild(row);
    document.body.appendChild(_editBar);
    return _editBar;
  }

  function _ensureInputBar() {
    if (_inputBar || !document.body) return _inputBar;
    _inputBar = document.createElement('div');
    _inputBar.id = 'cloud-mobile-inputbar';
    _inputBar.className = 'cloud-mobile-inputbar';
    _inputBar.setAttribute('role', 'toolbar');
    _inputBar.setAttribute('aria-label', 'スマホ用入力ツールバー');
    _inputBar.hidden = true;
    const row = document.createElement('div');
    row.className = 'cloud-mobile-inputbar-row';
    INPUTBAR_ITEMS.forEach((item) => {
      const button = _button('cloud-mobile-inputbar-btn', item.label, item.icon, item.action);
      if (item.id) {
        button.dataset.cloudMobileInputbarAction = item.id;
        button.dataset.e2eId = 'cloud-mobile-inputbar-' + item.id;
      }
      row.appendChild(button);
    });
    _inputBar.appendChild(row);
    document.body.appendChild(_inputBar);
    return _inputBar;
  }

  function _ensureChatBar() {
    if (_chatBar || !document.body) return _chatBar;
    _chatBar = document.createElement('div');
    _chatBar.id = 'cloud-mobile-chatbar';
    _chatBar.className = 'cloud-mobile-chatbar';
    _chatBar.setAttribute('role', 'toolbar');
    _chatBar.setAttribute('aria-label', 'スマホ用チャット入力ツールバー');
    _chatBar.hidden = true;
    const row = document.createElement('div');
    row.className = 'cloud-mobile-chatbar-row';
    CHATBAR_ITEMS.forEach((item) => {
      const button = _button(item.className || 'cloud-mobile-chatbar-btn', item.label, item.icon, item.action);
      if (item.id) {
        button.dataset.cloudMobileChatbarAction = item.id;
        button.dataset.e2eId = 'cloud-mobile-chatbar-' + item.id;
      }
      row.appendChild(button);
    });
    _chatBar.appendChild(row);
    document.body.appendChild(_chatBar);
    return _chatBar;
  }

  function _ensureBoardBar() {
    if (_boardBar || !document.body) return _boardBar;
    _boardBar = document.createElement('div');
    _boardBar.id = 'cloud-mobile-boardbar';
    _boardBar.className = 'cloud-mobile-boardbar';
    _boardBar.setAttribute('role', 'toolbar');
    _boardBar.setAttribute('aria-label', 'スマホ用ボードツールバー');
    _boardBar.hidden = true;
    const row = document.createElement('div');
    row.className = 'cloud-mobile-boardbar-row';
    BOARD_ITEMS.forEach((item) => {
      const button = _button('cloud-mobile-boardbar-btn', item.label, item.icon, item.action);
      if (item.id) {
        button.dataset.cloudMobileBoardAction = item.id;
        button.dataset.e2eId = 'cloud-mobile-boardbar-' + item.id;
      }
      row.appendChild(button);
    });
    _boardBar.appendChild(row);
    document.body.appendChild(_boardBar);
    return _boardBar;
  }

  function _ensureAnnotationBar() {
    if (_annotationBar || !document.body) return _annotationBar;
    _annotationBar = document.createElement('div');
    _annotationBar.id = 'cloud-mobile-annotationbar';
    _annotationBar.className = 'cloud-mobile-annotationbar';
    _annotationBar.setAttribute('role', 'toolbar');
    _annotationBar.setAttribute('aria-label', 'スマホ用注釈ツールバー');
    _annotationBar.hidden = true;
    const row = document.createElement('div');
    row.className = 'cloud-mobile-annotationbar-row';
    ANNOTATION_ITEMS.forEach((item) => {
      const button = _button('cloud-mobile-annotationbar-btn', item.label, item.icon, item.group
        ? (event) => _openAnnotationMobileToolMenu(event.currentTarget, item.group)
        : (item.tool ? () => _setAnnotationTool(item.tool) : item.action));
      if (item.id) button.dataset.e2eId = 'cloud-mobile-annotationbar-' + item.id;
      if (item.tool) button.dataset.annMobileTool = item.tool;
      if (item.group) button.dataset.annMobileGroup = item.group;

/* === gb-cloud-mobile-editbar.part02.js === */
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

  function _setHidden(el, hidden) {
    if (el) el.hidden = !!hidden;
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
    const modalOpen = _hasBlockingModal();
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
    const showAnnotationBar = enabled && !modalOpen && !showEditBar && !showChatBar && !showInputBar && (annotationActive || annotationRequested) && (!keyboardOpen || !!annotationTextInput);
    const showBoardBar = enabled && !modalOpen && !showEditBar && !showChatBar && !showInputBar && !showAnnotationBar && !keyboardOpen && _isBoardActive();
    const treeOpen = document.body.classList.contains('cloud-mobile-tree-screen-active')
      || document.getElementById('sidebar')?.classList?.contains('cloud-mobile-tree-screen-open');
    const inlineMenuAvailable = _hasVisibleInlineMobileMenu();
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
    _setHidden(_mainButton, !enabled || modalOpen || treeOpen || inlineMenuAvailable || keyboardOpen || showChatBar || showInputBar || showBoardBar || showAnnotationBar);
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
    if (enabled) document.body.dataset[name] = '1';
    else delete document.body.dataset[name];
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
      new MutationObserver(_scheduleRefresh).observe(mainViews, {
        attributes: true,
        attributeFilter: ['style', 'class'],
        subtree: true,
      });
    }
    const annToolbar = document.getElementById('ann-toolbar');
    if (annToolbar) {
      annToolbar.addEventListener('click', () => setTimeout(_scheduleRefresh, 0), true);
      new MutationObserver(_scheduleRefresh).observe(annToolbar, {
        attributes: true,
        attributeFilter: ['class', 'style'],
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
