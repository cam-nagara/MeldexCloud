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
    { id: 'paragraph', label: '本文', icon: 'type', action: () => _formatBlock('P') },
    { id: 'heading-1', label: '見出し1', icon: 'heading1', action: () => _formatBlock('H1') },
    { id: 'heading-2', label: '見出し2', icon: 'heading2', action: () => _formatBlock('H2') },
    { id: 'heading-3', label: '見出し3', icon: 'heading3', action: () => _formatBlock('H3') },
    { id: 'ordered-list', label: '番号付き', icon: 'listOrdered', action: () => _execTextCommand('insertOrderedList') },
    { id: 'strikethrough', label: '取り消し線', icon: 'strikethrough', action: () => _execTextCommand('strikeThrough') },
    { id: 'link', label: 'リンク', icon: 'link', action: () => _createLink() },
    { id: 'callout', label: 'コールアウト', icon: 'lightbulb', action: () => _insertCalloutFromMobile() },
    { id: 'clear-format', label: '書式クリア', icon: 'eraser', action: () => _execTextCommand('removeFormat') },
  ];
  const LAYOUT_ITEMS = [];
  const PANEL_ITEMS = [
    { id: 'folder-tree', label: 'フォルダツリー', icon: 'folderTree', action: () => window.MeldexCloudMobile?.openSidebar?.(true) },
    { id: 'preview', label: 'ビューワー', icon: 'monitor', action: () => _openPreviewPanel() },
    { id: 'options', label: 'オプション', icon: 'slidersHorizontal', action: () => _callGlobal('toggleOptionPanel') },
    { id: 'version', label: 'バージョン', icon: 'gitBranch', action: () => _openVersionPanel() },
    { id: 'annotation', label: '注釈', icon: 'messagesSquare', action: () => _openToolPanel('annotation') },
    { id: 'history', label: 'ヒストリー', icon: 'history', action: () => _openToolPanel('history') },
    { id: 'tags', label: 'タグ', icon: 'tags', action: () => _openToolPanel('tags') },
  ];
  const TOOL_ITEMS = [
    { id: 'create', label: '新規作成', icon: 'plus', action: () => _openNewItemSheet() },
    { id: 'command-palette', label: 'コマンドパレット', icon: 'command', action: () => _callGlobal('showCommandPalette') },
    { id: 'chat', label: 'チャット', icon: 'messageSquare', action: () => _openMobileChat() },
    { id: 'annotation-tool', label: '注釈ツール', icon: 'penLine', action: () => _callGlobal('toggleAnnotationToolbar') },
    { id: 'help', label: 'ヘルプ', icon: 'circleHelp', action: () => _openHelpMenu() },
    { id: 'settings', label: '設定', icon: 'settings', action: () => _openSettingsModal() },
  ];
  const NEW_ITEMS = [
    { label: 'フォルダ', icon: 'folderPlus', type: 'folder' },
    { label: 'ノート', icon: 'filePlus', type: 'page' },
    { label: 'シナリオ', icon: 'bookPlus', type: 'scriptnote' },
    { label: 'シート', icon: 'tableProperties', type: 'database' },
    { label: 'ボード', icon: 'presentation', type: 'board' },
    { label: 'スマートシート', icon: 'database', type: 'smart-db' },
    { label: 'カレンダー', icon: 'calendarPlus', type: 'calendar' },
  ];
  const DESKTOP_BACKED_TOOL_TYPES = new Set(['page', 'database', 'board', 'calendar', 'csv', 'smart-db']);
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
    { id: 'select', label: '選択', icon: 'mousePointer2', action: () => _boardSetTool('select') },
    { id: 'erase', label: '消しゴム', icon: 'eraser', action: () => _boardSetTool('erase') },
    { id: 'redo', label: 'Redo', icon: 'redo2', action: () => _callGlobal('bdRedo') },
    { id: 'delete', label: '削除', icon: 'trash2', action: () => _callGlobal('bdDeleteSelected') },
    { id: 'duplicate', label: '複製', icon: 'copy', action: () => _boardDuplicateSelected() },
    { id: 'reset-rotation', label: '回転リセット', icon: 'rotateCcw', action: () => _callGlobal('bdResetRotation') },
    { id: 'settings', label: '設定', icon: 'slidersHorizontal', action: () => _boardOpenDetail() },
  ];
  const ANNOTATION_ITEMS = [
    { id: 'stroke', label: 'ストローク', icon: 'pencil', group: 'stroke' },
    { id: 'line', label: 'ライン', icon: 'spline', group: 'line' },
    { id: 'fill', label: '塗りつぶし', icon: 'paintBucket', group: 'fill' },
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

  function _mobileWriteBlocked() {
    const dataset = document.body?.dataset || {};
    return dataset.cloudReadonly === '1' || dataset.cloudQuotaBlocked === '1';
  }

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
    if (typeof openVersionTab === 'function') return !!openVersionTab('', 'file', { follow: true });
    if (typeof addPanelMenuVersion === 'function') return !!addPanelMenuVersion();
    if (typeof showStatus === 'function') showStatus('バージョン管理を開けませんでした', true);
    return false;
  }

  function _openHelpMenu() {
    if (typeof showMeldexHelpMenu === 'function') {
      const anchor = document.getElementById('cloud-mobile-main-button')
        || document.getElementById('left-chrome-floating-help')
        || document.getElementById('left-chrome-help');
      showMeldexHelpMenu(anchor ? { currentTarget: anchor, target: anchor } : undefined);
      return true;
    }
    if (typeof showStatus === 'function') showStatus('ヘルプを開けませんでした', true);
    return false;
  }

  function _openSettingsModal(panel) {
    if (typeof showSettingsModal === 'function') {
      showSettingsModal(panel ? { panel } : undefined);
      return true;
    }
    if (typeof showStatus === 'function') showStatus('設定を開けませんでした', true);
    return false;
  }

  function _toolMenuTitle(toolType) {
    return ({
      folder: 'フォルダ',
      page: 'ノート',
      database: 'シート',
      board: 'ボード',
      scriptnote: 'シナリオ',
      calendar: 'スケジュール',
      csv: 'CSV',
      'smart-db': 'スマートシート',
    })[toolType] || 'メニュー';
  }

  function _desktopToolMenuItemsForMobile(toolType) {
    if (!DESKTOP_BACKED_TOOL_TYPES.has(toolType) || typeof buildToolMenuItems !== 'function') return [];
    try {
      return buildToolMenuItems(toolType) || [];
    } catch (_err) {
      return [];
    }
  }

  function _activeToolType() {
    try {
      if (typeof getActiveScriptNoteComponent === 'function' && getActiveScriptNoteComponent()?._editor?.doc) return 'scriptnote';
      const visibleScriptnote = document.querySelector('.gb-pane-active .gb-scriptnote-root, .gb-scriptnote-root');
      if (visibleScriptnote && _isVisibleElement(visibleScriptnote)) return 'scriptnote';
      const activePane = (typeof GBLayout !== 'undefined') ? GBLayout.activePane : undefined;
      const activeTab = (typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function')
        ? GBTabs.getActiveTab(activePane)
        : null;
      const rawType = activeTab?.type || '';
      if (rawType === 'scenario') return 'scriptnote';
      if (rawType === 'pivot') return 'database';
      return rawType;
    } catch (_err) {
      return '';
    }
  }

  function _activeScriptNoteComponent() {
    if (typeof getActiveScriptNoteComponent === 'function') {
      const comp = getActiveScriptNoteComponent();
      if (comp?._editor?.doc) return comp;
    }
    try {
      const activePane = (typeof GBLayout !== 'undefined') ? GBLayout.activePane : undefined;
      const activeTab = (typeof GBTabs !== 'undefined' && typeof GBTabs.getActiveTab === 'function')
        ? GBTabs.getActiveTab(activePane)
        : null;
      if (activeTab?.type !== 'scriptnote') return null;
      return (typeof getComponentInstance === 'function') ? getComponentInstance(activeTab.id) : null;
    } catch (_err) {
      return null;
    }
  }

  function _runScriptNoteToolbarAction(action) {
    const comp = _activeScriptNoteComponent();
    if (!comp) {
      if (typeof showStatus === 'function') showStatus('シナリオ操作を実行できませんでした', true);
      return false;
    }
    if (action === 'renameTitle' && typeof comp._showTitleRenameModal === 'function') {
      return !!comp._showTitleRenameModal();
    }
    if (action === 'chooseTemplate' && typeof comp._showTemplateSelectModal === 'function') {
      return !!comp._showTemplateSelectModal();
    }
    if (action === 'chooseFilterPreset' && typeof comp._showFilterPresetSelectModal === 'function') {
      return !!comp._showFilterPresetSelectModal();
    }
    const button = comp.el?.querySelector?.(`[data-sn-action="${action}"]`);
    if (action === 'filter' && comp._editor && typeof comp._editor._showFilterMenu === 'function') {
      const mobileAnchor = document.getElementById('cloud-mobile-main-button') || button;
      comp._editor._showFilterMenu(button || mobileAnchor, mobileAnchor);
      return true;
    }
    if (action === 'search' && comp._editor && typeof comp._editor._showSearchReplacePopup === 'function') {
      comp._editor._showSearchReplacePopup(button || document.getElementById('cloud-mobile-main-button'));
      return true;
    }
    if (action === 'detail' && typeof comp._openDetailPanel === 'function') {
      comp._openDetailPanel();
      const panel = document.getElementById('rp-detail');
      if (window.MeldexCloudMobileSideDrawer?.openElement?.('オプション', panel, { kind: 'detail' })) return true;
      return true;
    }
    if (button) {
      button.click();
      return true;
    }
    if (action === 'saveTemplate' && typeof comp._addTemplatePreset === 'function') {
      comp._addTemplatePreset({ allowOverwrite: true });
      return true;
    }
    if (action === 'manageTemplates' && typeof comp._showPresetManager === 'function') {
      comp._showPresetManager('template');
      return true;
    }
    if (action === 'saveFilter' && typeof comp._addFilterPreset === 'function') {
      comp._addFilterPreset({ allowOverwrite: true });
      return true;
    }
    if (action === 'manageFilters' && typeof comp._showPresetManager === 'function') {
      comp._showPresetManager('filter');
      return true;
    }
    if (typeof showStatus === 'function') showStatus('シナリオ操作を実行できませんでした', true);
    return false;
  }

  function _toolMenuItems(toolType) {
    if (toolType === 'folder') {
      return [
        { id: 'create', label: '新規作成', icon: 'plus', action: () => _openNewItemSheet() },
        { id: 'command-palette', label: 'コマンドパレット', icon: 'command', action: () => _callGlobal('showCommandPalette') },
        { id: 'folder-tree', label: 'フォルダツリー', icon: 'folderTree', action: () => window.MeldexCloudMobile?.openSidebar?.(true) },
        { id: 'reload', label: '再読み込み', icon: 'refreshCw', action: () => _callGlobal('reloadCurrentOpenFile') },
        { id: 'display-settings', label: '表示設定', icon: 'slidersHorizontal', action: () => _callGlobal('showFolderDisplaySettings') },
        { id: 'slideshow', label: 'スライドショー', icon: 'play', action: () => _callGlobal('openFolderSlideshow') },
        { id: 'search', label: '検索', icon: 'search', action: () => _callGlobal('openCurrentToolbarSearchReplace', 'folder') },
        { id: 'help', label: 'ヘルプ', icon: 'circleHelp', action: () => _openHelpMenu() },
        { id: 'settings', label: '設定', icon: 'settings', action: () => _openSettingsModal() },
      ];
    }
    if (toolType === 'scriptnote') {
      return [
        { id: 'open', label: '開く', icon: 'folderOpen', action: () => _callGlobal('showScriptNoteOpenModal') },
        { id: 'new-scriptnote', label: '新規作成', icon: 'plus', action: () => _callGlobal('showAddOutlinerItem', 'scriptnote') },
        { id: 'import-scriptnote', label: '旧シナリオからインポート', icon: 'download', action: () => _callGlobal('showScriptNoteImportModal') },
        { id: 'export-scriptnote', label: 'シナリオ形式として保存', icon: 'save', action: () => _callGlobal('promptSaveCurrentScriptNoteAs') },
        { id: 'export-image', label: '画像として保存', icon: 'image', action: () => {
          if (typeof MeldexExportImage !== 'undefined') return MeldexExportImage.exportCurrentView('scriptnote');
          if (typeof showStatus === 'function') showStatus('画像として保存できませんでした', true);
          return false;
        } },
        { id: 'rename-title', label: 'タイトル', icon: 'type', action: () => _runScriptNoteToolbarAction('renameTitle') },
        { id: 'choose-template', label: 'テンプレート', icon: 'layoutTemplate', action: () => _runScriptNoteToolbarAction('chooseTemplate') },
        { id: 'horizontal', label: '横書き', icon: 'textAlignStart', action: () => _runScriptNoteToolbarAction('horizontal') },
        { id: 'vertical', label: '縦書き', icon: 'kanban', action: () => _runScriptNoteToolbarAction('vertical') },
        { id: 'wrap', label: '折返し', icon: 'wrapText', action: () => _runScriptNoteToolbarAction('wrap') },
        { id: 'merge-display', label: 'まとめ表示', icon: 'rows3', action: () => _runScriptNoteToolbarAction('mergeDisplay') },
        { id: 'add-column', label: '列を追加', icon: 'plus', action: () => _runScriptNoteToolbarAction('addColumn') },
        { id: 'filter', label: 'フィルタ', icon: 'funnel', action: () => _runScriptNoteToolbarAction('filter') },
        { id: 'filter-preset', label: 'フィルタプリセット', icon: 'listFilter', action: () => _runScriptNoteToolbarAction('chooseFilterPreset') },
        { id: 'search', label: '検索・置換', icon: 'search', action: () => _runScriptNoteToolbarAction('search') },
        { id: 'detail', label: 'オプション', icon: 'slidersHorizontal', action: () => _runScriptNoteToolbarAction('detail') },
        { id: 'reload', label: '再読み込み', icon: 'refreshCw', action: () => _runScriptNoteToolbarAction('reload') },
        { id: 'save-template', label: 'テンプレートを登録', icon: 'save', action: () => _runScriptNoteToolbarAction('saveTemplate') },
        { id: 'manage-templates', label: 'テンプレートを管理', icon: 'listChecks', action: () => _runScriptNoteToolbarAction('manageTemplates') },
        { id: 'save-filter', label: 'フィルタを登録', icon: 'save', action: () => _runScriptNoteToolbarAction('saveFilter') },
        { id: 'manage-filters', label: 'フィルタを管理', icon: 'listChecks', action: () => _runScriptNoteToolbarAction('manageFilters') },
      ];
    }
    const desktopItems = _desktopToolMenuItemsForMobile(toolType);
    if (toolType !== 'calendar') return desktopItems;
    // 制作タスクリスト面では、汎用カレンダー操作を混在させず制作操作だけを表示する。
    // 「カレンダーに戻る」が同面を識別する安定した印になる。
    const productionTaskSurface = desktopItems.some(item => item?.id === 'production-calendar');
    return productionTaskSurface
      ? desktopItems.filter(item => String(item?.id || '').startsWith('production-'))
      : desktopItems;
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
    if (typeof _annotationSelectTool === 'function') {
      _annotationSelectTool(tool);
      _syncAnnotationBarState();
      return true;
    }
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

  function _openAnnotationMobileToolMenu(anchor, group) {
    const fallback = {
      stroke: [{ tool: 'pen', label: 'ペン' }, { tool: 'marker', label: 'マーカー' }],
      line: [{ tool: 'polyline', label: '折れ線' }, { tool: 'ellipse-line', label: '円形' }, { tool: 'rect-line', label: '矩形' }],
      fill: [{ tool: 'lasso', label: '囲い塗り' }, { tool: 'ellipse-fill', label: '円形塗り' }, { tool: 'rect', label: '矩形塗り' }],
    };
    const items = (typeof _ANN_TOOL_GROUPS !== 'undefined' && _ANN_TOOL_GROUPS[group]) || fallback[group] || [];
    document.querySelectorAll('.ann-tool-popup').forEach(menu => menu.remove());
    const menu = document.createElement('div');
    menu.className = 'ann-tool-popup'; menu.setAttribute('role', 'menu');
    items.forEach(item => {
      const option = document.createElement('button');
      option.type = 'button'; option.className = 'ann-tool-popup-item';
      option.dataset.annSelectTool = item.tool; option.textContent = item.label;
      option.addEventListener('click', () => { _setAnnotationTool(item.tool); menu.remove(); });
      menu.appendChild(option);
    });
    document.body.appendChild(menu);
    positionPopup(menu, anchor.getBoundingClientRect(), { prefer: 'above', gap: 6 });
    menu.querySelector('button')?.focus();
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
    _annotationBar.querySelectorAll('[data-ann-mobile-group]').forEach((button) => {
      const group = button.dataset.annMobileGroup;
      const members = group === 'stroke' ? ['pen', 'marker']
        : (group === 'line' ? ['polyline', 'ellipse-line', 'rect-line'] : ['lasso', 'ellipse-fill', 'rect']);
      button.classList.toggle('active', members.includes(tool));
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
        else item.action?.();
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
