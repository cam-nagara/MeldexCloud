(function () {
  if (window.__MeldexCloudMobileEditBarInstalled) return;
  window.__MeldexCloudMobileEditBarInstalled = true;

  const EDITABLE_SELECTOR = [
    '#page-content',
    '#entity-freetext',
    '#dp-editable',
    '#board-note-editable',
    '.sn2-text[contenteditable="true"]',
    '.value-rich-editor[contenteditable="true"]',
    '.bd-node.bd-editing .bd-text[contenteditable="true"]',
    '.bd-conn-label[contenteditable="true"]',
  ].join(',');
  const PLAIN_INPUT_SELECTOR = [
    '.value-input:not(.value-rich-editor)',
    '.cell-inline-input',
    '.entity-rename-input',
    '.th-rename-input',
    'input.cell-edit',
    'textarea.cell-edit',
  ].join(',');
  const CHAT_INPUT_SELECTOR = [
    '#chat-input',
    '#chat-rich-input',
    '#team-input',
  ].join(',');
  const ANNOTATION_TEXT_SELECTOR = '.ann-note-editor[contenteditable="true"]';
  const MODAL_SELECTOR = [
    '.modal-overlay',
    '.gb-modal-overlay',
    '.link-modal-overlay',
    '.cloud-conflict-resolver-overlay',
    '.gb-cal-modal-overlay',
  ].join(',');
  const OVERFLOW_ITEMS = [
    { label: '本文', icon: 'type', action: () => _formatBlock('P') },
    { label: '見出し1', icon: 'heading1', action: () => _formatBlock('H1') },
    { label: '見出し2', icon: 'heading2', action: () => _formatBlock('H2') },
    { label: '見出し3', icon: 'heading3', action: () => _formatBlock('H3') },
    { label: '番号付き', icon: 'listOrdered', action: () => _execTextCommand('insertOrderedList') },
    { label: '取り消し線', icon: 'strikethrough', action: () => _execTextCommand('strikeThrough') },
    { label: 'リンク', icon: 'link', action: () => _createLink() },
    { label: '書式クリア', icon: 'eraser', action: () => _execTextCommand('removeFormat') },
  ];
  const LAYOUT_ITEMS = [];
  const PANEL_ITEMS = [
    { label: 'フォルダツリー', icon: 'folderTree', action: () => window.MeldexCloudMobile?.openSidebar?.(true) },
    { label: 'ビューワー', icon: 'monitor', action: () => _openPreviewPanel() },
    { label: 'オプション', icon: 'slidersHorizontal', action: () => _callGlobal('toggleOptionPanel') },
    { label: 'バージョン', icon: 'gitBranch', action: () => _openVersionPanel() },
    { label: '注釈', icon: 'messagesSquare', action: () => _openToolPanel('annotation') },
    { label: 'ヒストリー', icon: 'history', action: () => _openToolPanel('history') },
  ];
  const TOOL_ITEMS = [
    { label: '新規作成', icon: 'plus', action: () => _openNewItemSheet() },
    { label: 'チャット', icon: 'messageSquare', action: () => _openMobileChat() },
    { label: '注釈ツール', icon: 'penLine', action: () => _callGlobal('toggleAnnotationToolbar') },
    { label: 'ヘルプ', icon: 'circleHelp', action: () => _openHelpMenu() },
    { label: '設定', icon: 'settings', action: () => _callGlobal('showSettingsModal') },
  ];
  const NEW_ITEMS = [
    { label: 'フォルダ', icon: 'folderPlus', type: 'folder' },
    { label: 'ノート', icon: 'filePlus', type: 'page' },
    { label: 'シナリオ', icon: 'bookPlus', type: 'scriptnote' },
    { label: 'シート', icon: 'tableProperties', type: 'database' },
    { label: 'ボード', icon: 'presentation', type: 'board' },
    { label: 'カレンダー', icon: 'calendarPlus', type: 'calendar' },
  ];
  const EDITBAR_ITEMS = [
    { id: 'bold', label: '太字', icon: 'bold', action: () => _execTextCommand('bold') },
    { id: 'italic', label: '斜体', icon: 'italic', action: () => _execTextCommand('italic') },
    { id: 'underline', label: '下線', icon: 'underline', action: () => _execTextCommand('underline') },
    { id: 'list', label: '箇条書き', icon: 'list', action: () => _execTextCommand('insertUnorderedList') },
    { id: 'text-color', label: '文字色', icon: 'palette', action: (event) => _openColor(event.currentTarget, 'foreColor') },
    { id: 'background-color', label: '背景色', icon: 'highlighter', action: (event) => _openColor(event.currentTarget, 'hiliteColor') },
    { id: 'more', label: 'その他', icon: 'moreHorizontal', action: _openOverflowSheet },
  ];
  const INPUTBAR_ITEMS = [
    { id: 'previous', label: '前', icon: 'chevronUp', action: () => _focusPlainInput(-1) },
    { id: 'next', label: '次', icon: 'chevronDown', action: () => _focusPlainInput(1) },
    { id: 'cancel', label: 'キャンセル', icon: 'x', action: () => _finishPlainInput(true) },
    { id: 'done', label: '完了', icon: 'check', action: () => _finishPlainInput(false) },
    { id: 'menu', label: 'メニュー', icon: 'menu', action: _openMenuSheet },
  ];
  const CHATBAR_ITEMS = [
    { id: 'attach', label: '添付', icon: 'paperclip', action: _pickChatAttachment },
    { id: 'send', label: '送信', icon: 'send', className: 'cloud-mobile-chatbar-btn cloud-mobile-chatbar-send', action: _sendChatInput },
    { id: 'done', label: '完了', icon: 'check', action: _finishChatInput },
    { id: 'menu', label: 'メニュー', icon: 'menu', action: _openMenuSheet },
  ];
  const BOARD_ITEMS = [
    { id: 'add', label: '追加', icon: 'plus', action: () => _boardAddAtCenter() },
    { id: 'child', label: '子', icon: 'cornerDownRight', action: () => _boardAddChild() },
    { id: 'line', label: 'ライン', icon: 'gitBranchPlus', action: () => _boardSetTool('add-line') },
    { id: 'style', label: 'スタイル', icon: 'palette', action: () => _boardOpenDetail() },
    { id: 'sibling', label: '兄弟', icon: 'listPlus', action: () => _boardAddSibling() },
    { id: 'undo', label: '戻す', icon: 'undo2', action: () => _callGlobal('bdUndo') },
    { id: 'fit-all', label: '全体', icon: 'scan', action: () => _callGlobal('bdFitAll') },
    { id: 'more', label: 'その他', icon: 'moreHorizontal', action: () => _openBoardOverflowSheet() },
    { id: 'menu', label: 'メニュー', icon: 'menu', action: () => _openMenuSheet() },
  ];
  const BOARD_OVERFLOW_ITEMS = [
    { label: '選択', icon: 'mousePointer2', action: () => _boardSetTool('select') },
    { label: '消しゴム', icon: 'eraser', action: () => _boardSetTool('erase') },
    { label: 'Redo', icon: 'redo2', action: () => _callGlobal('bdRedo') },
    { label: '削除', icon: 'trash2', action: () => _callGlobal('bdDeleteSelected') },
    { label: '複製', icon: 'copy', action: () => _boardDuplicateSelected() },
    { label: '回転リセット', icon: 'rotateCcw', action: () => _callGlobal('bdResetRotation') },
    { label: '設定', icon: 'slidersHorizontal', action: () => _boardOpenDetail() },
  ];
  const ANNOTATION_ITEMS = [
    { id: 'pen', label: 'ペン', icon: 'pencil', tool: 'pen' },
    { id: 'marker', label: 'マーカー', icon: 'highlighter', tool: 'marker' },
    { id: 'lasso', label: '投げ縄', icon: 'lasso', tool: 'lasso' },
    { id: 'eraser', label: '消しゴム', icon: 'eraser', tool: 'eraser' },
    { id: 'sticky', label: '付箋', icon: 'stickyNote', tool: 'sticky' },
    { id: 'width-down', label: '細く', icon: 'minus', action: () => _stepAnnotationWidth(-1) },
    { id: 'width-up', label: '太く', icon: 'plus', action: () => _stepAnnotationWidth(1) },
    { id: 'color', label: '色', icon: 'palette', action: () => _openAnnotationColor() },
    { id: 'visibility', label: '表示', icon: 'eye', action: () => _toggleAnnotationVisibility() },
    { id: 'list', label: '一覧', icon: 'messagesSquare', action: () => _openToolPanel('annotation') },
    { id: 'close', label: '閉じる', icon: 'x', action: () => _closeAnnotationToolbar() },
  ];

  let _mainButton = null;
  let _editBar = null;
  let _inputBar = null;
  let _boardBar = null;
  let _annotationBar = null;
  let _chatBar = null;
  let _menuOverlay = null;
  let _overflowOverlay = null;
  let _activeEditable = null;
  let _activePlainInput = null;
  let _activeChatInput = null;
  let _savedRange = null;
  let _refreshTimer = 0;
  let _viewportState = {};

  function _isEnabled() {
    return !!window.MeldexCloudMobile?.isMobileEditingUiEnabled?.()
      || document.body?.dataset?.cloudMobileEditingUi === '1';
  }

  function _isVisibleElement(el) {
    if (!el || el.hidden) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    if (typeof el.getBoundingClientRect !== 'function') return true;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function _hasBlockingModal() {
    const modalClassOpen = Array.from(document.querySelectorAll(MODAL_SELECTOR)).some((el) => {
      if (el.closest?.('.cloud-mobile-menu-overlay, .cloud-mobile-overflow-overlay')) return false;
      return _isVisibleElement(el);
    });
    if (modalClassOpen) return true;
    return Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some((el) => {
      if (el.closest?.('.cloud-mobile-menu-overlay, .cloud-mobile-overflow-overlay')) return false;
      return _isVisibleElement(el);
    });
  }

  function _icon(name, size) {
    const span = document.createElement('span');
    span.className = 'cloud-mobile-icon';
    span.setAttribute('aria-hidden', 'true');
    if (typeof lucide === 'function') span.innerHTML = lucide(name, size || 18);
    else span.textContent = '';
    return span;
  }

  function _button(className, label, iconName, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('aria-label', label);
    if (iconName) button.appendChild(_icon(iconName, 18));
    const text = document.createElement('span');
    text.className = 'cloud-mobile-label';
    text.textContent = label;
    button.appendChild(text);
    _bindPressAction(button, action);
    return button;
  }

  function _bindPressAction(el, action) {
    el.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      _saveSelection();
      event.preventDefault();
    });
    el.addEventListener('mousedown', (event) => {
      _saveSelection();
      event.preventDefault();
    });
    el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      _saveSelection();
      action?.(event);
      _scheduleRefresh();
    });
  }

  function _callGlobal(name, arg) {
    const fn = window[name];
    if (typeof fn !== 'function') return false;
    const result = fn(arg);
    return result !== false && result !== null;
  }

  function _activateExistingPaneTab(type, path) {
    try {
      if (typeof GBTabs === 'undefined' || typeof GBTabs.findPaneWithTab !== 'function') return false;
      const found = GBTabs.findPaneWithTab(type, path || '');
      if (!found || typeof GBTabs.activateTab !== 'function') return false;
      GBTabs.activateTab(found.paneId, found.tabId);
      return true;
    } catch (_err) {
      return false;
    }
  }

  function _openPaneTool(type) {
    if (_activateExistingPaneTab(type, '')) return true;
    if (typeof openToolTab === 'function') {
      openToolTab(type);
      return true;
    }
    if (typeof addPanelMenuTool === 'function') return !!addPanelMenuTool(type);
    return false;
  }

  function _openToolPanel(type) {
    if (_openPaneTool(type)) return true;
    return _callGlobal('openRightPanelTab', type);
  }

  function _openPreviewPanel() {
    if (_openPaneTool('preview')) return true;
    if (typeof showStatus === 'function') showStatus('ビューワーを開けませんでした', true);
    return false;
  }

  function _openVersionPanel() {
    if (_activateExistingPaneTab('version', '')) return true;
    if (typeof openVersionTab === 'function') return !!openVersionTab('', 'file');
    if (typeof addPanelMenuVersion === 'function') return !!addPanelMenuVersion();
    if (typeof showStatus === 'function') showStatus('バージョン管理を開けませんでした', true);
    return false;
  }

  function _openHelpMenu() {
    if (typeof showMeldexHelpMenu === 'function') {
      showMeldexHelpMenu();
      return true;
    }
    if (typeof showStatus === 'function') showStatus('ヘルプを開けませんでした', true);
    return false;
  }

  function _toolMenuTitle(toolType) {
    return ({
      folder: 'フォルダ',
      page: 'ノート',
      database: 'シート',
      board: 'ボード',
      scriptnote: 'シナリオ',
      csv: 'CSV',
      'smart-db': 'スマートシート',
    })[toolType] || 'メニュー';
  }

  function _toolMenuItems(toolType) {
    if (toolType === 'folder') {
      return [
        { label: '新規作成', icon: 'plus', action: () => _openNewItemSheet() },
        { label: 'フォルダツリー', icon: 'folderTree', action: () => window.MeldexCloudMobile?.openSidebar?.(true) },
        { label: '再読み込み', icon: 'refreshCw', action: () => _callGlobal('reloadCurrentOpenFile') },
        { label: '表示設定', icon: 'slidersHorizontal', action: () => _callGlobal('showFolderDisplaySettings') },
        { label: 'スライドショー', icon: 'play', action: () => _callGlobal('openFolderSlideshow') },
        { label: '検索', icon: 'search', action: () => _callGlobal('openCurrentToolbarSearchReplace', 'folder') },
        { label: 'オプション', icon: 'slidersHorizontal', action: () => _callGlobal('showFolderPanelSettings') },
        { label: 'ヘルプ', icon: 'circleHelp', action: () => _openHelpMenu() },
        { label: '設定', icon: 'settings', action: () => _callGlobal('showSettingsModal') },
      ];
    }
    return [];
  }

  function _editableFromNode(node) {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element?.closest?.(EDITABLE_SELECTOR) || null;
  }

  function _plainInputFromNode(node) {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const input = element?.closest?.(PLAIN_INPUT_SELECTOR) || null;
    if (!input || input.disabled || input.readOnly) return null;
    if (input.closest?.('.cloud-mobile-editbar, .cloud-mobile-inputbar, .cloud-mobile-boardbar, .cloud-mobile-menu-overlay, .cloud-mobile-overflow-overlay')) {
      return null;
    }
    return input;
  }

  function _chatInputFromNode(node) {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const input = element?.closest?.(CHAT_INPUT_SELECTOR) || null;
    if (!input || input.disabled || input.readOnly) return null;
    if (input.closest?.('.cloud-mobile-editbar, .cloud-mobile-inputbar, .cloud-mobile-chatbar, .cloud-mobile-boardbar, .cloud-mobile-annotationbar, .cloud-mobile-menu-overlay, .cloud-mobile-overflow-overlay')) {
      return null;
    }
    return input;
  }

  function _annotationTextInputFromNode(node) {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const editor = element?.closest?.(ANNOTATION_TEXT_SELECTOR) || null;
    if (!editor || editor.getAttribute('contenteditable') === 'false') return null;
    if (editor.closest?.('.cloud-mobile-editbar, .cloud-mobile-inputbar, .cloud-mobile-chatbar, .cloud-mobile-boardbar, .cloud-mobile-annotationbar, .cloud-mobile-menu-overlay, .cloud-mobile-overflow-overlay')) {
      return null;
    }
    return editor;
  }

  function _isFocusedNonToolbarInput() {
    const active = document.activeElement;
    if (!active?.matches?.('input, textarea, select, [contenteditable="true"]')) return false;
    if (_editableFromNode(active)) return false;
    if (_plainInputFromNode(active)) return false;
    if (_chatInputFromNode(active)) return false;
    if (_annotationTextInputFromNode(active)) return false;
    return !active.closest?.('.cloud-mobile-editbar, .cloud-mobile-inputbar, .cloud-mobile-chatbar, .cloud-mobile-boardbar, .cloud-mobile-annotationbar, .cloud-mobile-menu-overlay, .cloud-mobile-overflow-overlay');
  }

  function _getActiveEditable() {
    if (_plainInputFromNode(document.activeElement)) return null;
    if (_chatInputFromNode(document.activeElement)) return null;
    if (_annotationTextInputFromNode(document.activeElement)) return null;
    const focused = _editableFromNode(document.activeElement);
    if (focused) return focused;
    if (_isFocusedNonToolbarInput()) return null;
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount) return _activeEditable;
    return _editableFromNode(sel.getRangeAt(0).commonAncestorContainer) || _activeEditable;
  }

  function _getActivePlainInput() {
    if (_chatInputFromNode(document.activeElement)) return null;
    const focused = _plainInputFromNode(document.activeElement);
    if (focused) return focused;
    if (_activePlainInput?.isConnected && _isVisibleElement(_activePlainInput)) return _activePlainInput;
    return null;
  }

  function _getActiveChatInput() {
    const focused = _chatInputFromNode(document.activeElement);
    if (focused) return focused;
    if (_activeChatInput?.isConnected && _isVisibleElement(_activeChatInput)) return _activeChatInput;
    return null;
  }

  function _plainInputScope(input) {
    return input?.closest?.('.gb-pane-content, #main-views, #pivot-view, table') || document;
  }

  function _visiblePlainInputs(input) {
    return Array.from(_plainInputScope(input).querySelectorAll(PLAIN_INPUT_SELECTOR))
      .filter(el => _plainInputFromNode(el) && _isVisibleElement(el));
  }

  function _focusPlainInput(offset) {
    const active = _activePlainInput || _getActivePlainInput();
    if (!active) return false;
    const inputs = _visiblePlainInputs(active);
    if (!inputs.length) return false;
    const currentIndex = Math.max(0, inputs.indexOf(active));
    const next = inputs[(currentIndex + offset + inputs.length) % inputs.length];
    next?.focus?.({ preventScroll: true });
    if (typeof next?.select === 'function') next.select();
    _activePlainInput = next || active;
    _scheduleRefresh();
    return !!next;
  }

  function _finishPlainInput(cancel) {
    const input = _activePlainInput || _getActivePlainInput();
    if (!input) return false;
    if (cancel) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }
    if (document.activeElement === input) input.blur?.();
    _activePlainInput = null;
    _scheduleRefresh();
    return true;
  }

  function _sendChatInput() {
    const input = _activeChatInput || _getActiveChatInput();
    if (!input) return false;
    if (input.id === 'team-input') return _callGlobal('teamSend');
    return _callGlobal('chatSend');
  }

  function _pickChatAttachment() {
    const input = _activeChatInput || _getActiveChatInput();
    if (input?.id === 'team-input') return _callGlobal('teamAttachmentPick');
    return _callGlobal('chatAttachmentPick');
  }

  function _finishChatInput() {
    const input = _activeChatInput || _getActiveChatInput();
    if (!input) return false;
    if (document.activeElement === input) input.blur?.();
    _activeChatInput = null;
    _scheduleRefresh();
    return true;
  }

  function _openMobileChat() {
    const opened = _openToolPanel('chat');
    setTimeout(() => {
      const mode = localStorage.getItem('chat-mode') || 'team';
      if (typeof switchChatMode === 'function') switchChatMode(mode);
      if (mode === 'team' && typeof loadTeamRooms === 'function') loadTeamRooms();
    }, 0);
    return opened;
  }

  function _isBoardActive() {
    try {
      const activeTab = (typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined') ? GBTabs.getActiveTab?.(GBLayout.activePane) : null;
      if (activeTab && activeTab.type !== 'board') return false;
    } catch (_err) {}
    try {
      if (typeof state !== 'undefined' && state?.view === 'board') return true;
    } catch (_err) {
      // state is defined by the app bundle after this mobile module is loaded.
    }
    const canvas = document.getElementById('bd-canvas');
    return !!canvas && _isVisibleElement(canvas);
  }

  function _boardSelectionCount() {
    try {
      if (typeof bd !== 'undefined' && bd?.selected instanceof Set) return bd.selected.size;
    } catch (_err) {
      // bd is a global lexical binding in the board engine when available.
    }
    return 0;
  }

  function _boardCenterWorldPoint() {
    const canvas = document.getElementById('bd-canvas');
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + rect.width / 2;
    const sy = rect.top + rect.height / 2;
    if (typeof bdScreenToWorld === 'function') return bdScreenToWorld(sx, sy);
    try {
      if (typeof bd !== 'undefined') return {
        x: (canvas.clientWidth / 2 - (bd.panX || 0)) / (bd.zoom || 1),
        y: (canvas.clientHeight / 2 - (bd.panY || 0)) / (bd.zoom || 1),
      };
    } catch (_err) {
      // Fall through to the safe default.
    }
    return { x: 0, y: 0 };
  }

  function _boardAddAtCenter() {
    if (typeof bdAddAt !== 'function') return false;
    const point = _boardCenterWorldPoint();
    bdAddAt(point.x, point.y);
    _scheduleRefresh();
    return true;
  }

  function _boardAddChild() {
    if (_boardSelectionCount() === 1 && typeof bdAddChildToSelected === 'function') {
      const child = bdAddChildToSelected();
      if (child) {
        _scheduleRefresh();
        return true;
      }
    }
    return _boardAddAtCenter();
  }

  function _boardAddSibling() {
    if (_boardSelectionCount() === 1 && typeof bdAddSiblingToSelected === 'function') {
      const sibling = bdAddSiblingToSelected();
      if (sibling) {
        _scheduleRefresh();
        return true;
      }
    }
    return _boardAddChild();
  }

  function _boardSetTool(tool) {
    if (typeof bdSetTool === 'function') {
      bdSetTool(tool);
      _scheduleRefresh();
      return true;
    }
    try {
      if (typeof bd !== 'undefined') {
        bd.tool = tool || 'select';
        if (typeof bdRefreshBoardToolbar === 'function') bdRefreshBoardToolbar();
        _scheduleRefresh();
        return true;
      }
    } catch (_err) {
      // No board state available.
    }
    return false;
  }

  function _boardOpenDetail() {
    if (window.MeldexCloudMobileBoardActions?.openStyle) return window.MeldexCloudMobileBoardActions.openStyle();
    const opened = _openToolPanel('detail') || _callGlobal('toggleOptionPanel');
    setTimeout(() => {
      const hasLine = (() => {
        try {
          return typeof bdGetSelectedConnectionIds === 'function' && bdGetSelectedConnectionIds().length > 0;
        } catch (_err) {
          return false;
        }
      })();
      if (hasLine && typeof bdOpenLineStyleManager === 'function') {
        bdOpenLineStyleManager();
      } else if (typeof bdOpenCardStyleManager === 'function') {
        bdOpenCardStyleManager();
      } else if (typeof showBoardTabs === 'function' && typeof switchDetailTab === 'function') {
        showBoardTabs({ cardStyle: true, lineStyle: true, depthStyle: true });
        switchDetailTab(hasLine ? 'board-line-style' : 'board-card-style');
      }
    }, 0);
    return opened;
  }

  function _openBoardAnnotation() {
    if (window.MeldexCloudMobileBoardActions?.openAnnotation) return window.MeldexCloudMobileBoardActions.openAnnotation();
    if (!_isAnnotationActive()) _callGlobal('toggleAnnotationToolbar');
    _scheduleRefresh();
    setTimeout(_scheduleRefresh, 80);
    return true;
  }

  function _boardDuplicateSelected() {
    try {
      if (typeof bd === 'undefined' || !bd?.selected?.size) return false;
      const ids = [...bd.selected];
      const sourceNodes = ids.map(id => bd.nodes.find(node => node.id === id)).filter(Boolean);
      if (!sourceNodes.length || typeof bdCloneNodesWithOffset !== 'function') return false;
      if (typeof bdPushUndo === 'function') bdPushUndo();
      const result = bdCloneNodesWithOffset(sourceNodes, 30);
      const newNodes = result?.newNodes || [];
      if (!newNodes.length) return false;
      const idMap = result?.idMap || {};
      const sourceIdSet = new Set(sourceNodes.map(node => node.id));
      const newConnections = (bd.connections || [])
        .filter(conn => conn && sourceIdSet.has(conn.from) && sourceIdSet.has(conn.to) && idMap[conn.from] && idMap[conn.to])
        .map(conn => {
          const cloned = { ...conn, id: typeof bdId === 'function' ? bdId() : ('conn-' + Date.now() + '-' + Math.random().toString(36).slice(2)), from: idMap[conn.from], to: idMap[conn.to] };
          if (Array.isArray(conn.controlPoints) && conn.controlPoints.length === 2) {
            cloned.controlPoints = conn.controlPoints.map(point => ({ ...point }));
          }
          return cloned;
        });
      bd.nodes.push(...newNodes);
      if (newConnections.length) bd.connections.push(...newConnections);
      bd.selected = new Set(newNodes.map(node => node.id));
      if (typeof bdRender === 'function') bdRender();
      if (typeof bdDirty === 'function') bdDirty();
      _scheduleRefresh();
      return true;
    } catch (_err) {
      return false;
    }
  }

  function _isAnnotationActive() {
    if (document.body?.classList?.contains('ann-toolbar-active')) return true;
    if (document.getElementById('ann-toolbar')?.classList?.contains('visible')) return true;
    try {
      return typeof ann !== 'undefined' && !!ann?.active;
    } catch (_err) {
      return false;
    }
  }

  function _currentAnnotationTool() {
    const active = document.querySelector('#ann-toolbar .ann-tool.active[data-tool]');
    if (active?.dataset?.tool) return active.dataset.tool;
    try {
      if (typeof ann !== 'undefined' && ann?.tool) return ann.tool;
    } catch (_err) {
      // ann is owned by the annotation module.
    }
    return 'pen';
  }

  function _setAnnotationTool(tool) {
    const button = Array.from(document.querySelectorAll('#ann-toolbar .ann-tool[data-tool]'))
      .find(el => el.dataset.tool === tool);
    if (button) {
      button.click();
    } else {
      try {
        if (typeof ann !== 'undefined') ann.tool = tool;
      } catch (_err) {}
    }
    _syncAnnotationBarState();
    return true;
  }

  function _annotationWidthInput() {
    const tool = _currentAnnotationTool();
    return document.querySelector(`[data-ann-width-tool="${tool}"]`)
      || document.querySelector('[data-ann-width-tool="pen"]');
  }

  function _stepAnnotationWidth(delta) {
    const input = _annotationWidthInput();
    if (!input) return false;
    const step = Number(input.step || 1) || 1;
    const min = Number(input.min || 1);
    const max = Number(input.max || 64);
    const current = Number(input.value || input.defaultValue || min);
    const next = Math.max(min, Math.min(max, current + (delta || 0) * step));
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function _openAnnotationColor() {
    const swatch = document.getElementById('ann-color-swatch');
    if (!swatch) return false;
    swatch.click();
    return true;
  }

  function _toggleAnnotationVisibility() {
    if (_callGlobal('toggleOverlayVisibility')) {
      _syncAnnotationBarState();
      return true;
    }
    document.getElementById('btn-overlay-toggle')?.click?.();
    _syncAnnotationBarState();
    return true;
  }

  function _closeAnnotationToolbar() {
    if (document.body?.dataset) delete document.body.dataset.cloudMobileAnnotationRequested;
    return _callGlobal('closeAnnotationToolbar');
  }

  function _syncAnnotationBarState() {
    if (!_annotationBar) return;
    const tool = _currentAnnotationTool();
    _annotationBar.querySelectorAll('[data-ann-mobile-tool]').forEach((button) => {
      button.classList.toggle('active', button.dataset.annMobileTool === tool);
    });
    const visible = document.getElementById('btn-overlay-toggle')?.classList?.contains('active') !== false;
    _annotationBar.querySelector('[data-ann-mobile-visibility]')?.classList?.toggle('active', visible);
  }

  function _saveSelection() {
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount) return false;
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

  function _appendSheetSection(sheet, title, items) {
    const section = document.createElement('section');
    section.className = 'cloud-mobile-menu-section';
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.appendChild(heading);
    const grid = document.createElement('div');
    grid.className = 'cloud-mobile-menu-grid';
    items.forEach((item) => {
      grid.appendChild(_button('cloud-mobile-menu-item', item.label, item.icon, () => {
        _closeMenuSheet();
        item.action?.();
      }));
    });
    section.appendChild(grid);
    sheet.appendChild(section);
  }

  function _openMenuSheet() {
    if (!_isEnabled() || _hasBlockingModal()) return;
    _closeOverflowSheet();
    _closeMenuSheet();
    _menuOverlay = document.createElement('div');
    _menuOverlay.className = 'cloud-mobile-menu-overlay';
    _menuOverlay.setAttribute('role', 'presentation');

    const sheet = document.createElement('div');
    sheet.className = 'cloud-mobile-menu-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'スマホ用メニュー');

    const header = document.createElement('div');
    header.className = 'cloud-mobile-sheet-header';
    const title = document.createElement('strong');
    title.textContent = 'メニュー';
    header.appendChild(title);
    header.appendChild(_button('cloud-mobile-sheet-close', '閉じる', 'x', _closeMenuSheet));
    sheet.appendChild(header);

    if (LAYOUT_ITEMS.length) _appendSheetSection(sheet, 'レイアウト', LAYOUT_ITEMS);
    _appendSheetSection(sheet, 'パネル', PANEL_ITEMS);
    _appendSheetSection(sheet, 'ツール', TOOL_ITEMS);

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
    _menuOverlay.setAttribute('role', 'presentation');

    const sheet = document.createElement('div');
    sheet.className = 'cloud-mobile-menu-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', `${_toolMenuTitle(toolType)}メニュー`);

    const header = document.createElement('div');
    header.className = 'cloud-mobile-sheet-header';
    const title = document.createElement('strong');
    title.textContent = _toolMenuTitle(toolType);
    header.appendChild(title);
    header.appendChild(_button('cloud-mobile-sheet-close', '閉じる', 'x', _closeMenuSheet));
    sheet.appendChild(header);

    _appendSheetSection(sheet, '操作', toolItems);
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
      const button = _button('cloud-mobile-annotationbar-btn', item.label, item.icon, item.tool
        ? () => _setAnnotationTool(item.tool)
        : item.action);
      if (item.id) button.dataset.e2eId = 'cloud-mobile-annotationbar-' + item.id;
      if (item.tool) button.dataset.annMobileTool = item.tool;
