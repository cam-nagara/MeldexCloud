async function _duplicateCurrentFile(toolType) {
  const path = getCurrentFilePath();
  if (!path) return;
  const isForm = toolType === 'form-app';
  const progress = isForm ? window.MeldexOperationProgress?.begin?.({
    kind: 'file-duplicate', label: 'ファイルを複製しています',
    mode: 'indeterminate', showInTray: true, priority: 35,
  }) : null;
  let reservation;
  try {
    const copyOpen = isForm && typeof FormAppComponent !== 'undefined'
      ? FormAppComponent.prepareCopyOpen?.(path) : null;
    if (copyOpen?.flush && !await copyOpen.flush()) throw new Error('元のフォームを保存できないため、複製を中止しました');
    // 取り消しの記録は、操作した画面の履歴に積む（2026-11-21 ユーザー決定。取り消しは複製をゴミ箱へ移す）
    const historyScope = typeof _historyActiveScope !== 'undefined' ? _historyActiveScope : '';
    if (isForm && typeof historyReserve === 'function') reservation = historyReserve('ファイルを複製', historyScope, null, { preserveRedoOnCancel: true });
    const res = isForm && typeof FormAppComponent !== 'undefined' && typeof FormAppComponent.copyWithPreview === 'function'
      ? await FormAppComponent.copyWithPreview(path, copyOpen, { historyPending: reservation?.entry?._historyPending })
      : await apiPost('/outliner/duplicate', { path, ...(copyOpen ? { include_form_content: true } : {}) });
    if (!isForm) await _refreshWorkspaceAfterFileMutation();
    const duplicatedPath = res?.new_path || '';
    const duplicatedName = _toolMenuDisplayName(duplicatedPath || path, toolType, res?.new_name || '');
    if (duplicatedPath && typeof pushCreatedOutlinerItemHistory === 'function') {
      const register = () => pushCreatedOutlinerItemHistory({ path: duplicatedPath, type: toolType || 'page' }, 'ファイルを複製: ' + (duplicatedName || duplicatedPath), {
        scope: historyScope, refresh: () => _refreshWorkspaceAfterFileMutation(),
      });
      if (reservation?.capture) reservation.capture(register); else register();
      if (res.form_previewed && typeof historySetScope === 'function' && typeof _historyActiveScope !== 'undefined') historySetScope(_historyActiveScope);
    }
    if (duplicatedPath && !res.form_previewed && typeof navOpen === 'function') {
      const opened = navOpen({ type: _toolMenuNavType(toolType), label: duplicatedName, path: duplicatedPath },
        copyOpen ? { formCopyOpen: { ...copyOpen, file: res.form_content } } : undefined);
      if (isForm) await opened;
    }
    if (isForm) {
      // Opening resolves when the content is mounted, before its first paint.
      // Keep the unrelated tree rebuild out of that first visible frame.
      if (globalThis.requestAnimationFrame) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await _refreshWorkspaceAfterFileMutation();
    }
    progress?.succeed?.({ summary: 'ファイルを複製しました' });
    showStatus('ファイルを複製しました' + (duplicatedName ? ': ' + duplicatedName : ''));
  } catch (e) {
    progress?.fail?.({ error: 'ファイルの複製に失敗しました: ' + (e?.message || e || '') });
    showStatus('ファイルの複製に失敗しました: ' + (e?.message || e || ''), true);
  } finally {
    reservation?.cancel?.();
  }
}

// ツール別メニュー項目
function buildToolMenuItems(toolType, component) {
  const registrationItems = [..._toolMenuRevealItems(toolType, component), ..._toolMenuFileRegistrationItems(toolType, component)];
  if (toolType === 'map' && component && window.MeldexMapChrome) {
    return [...MeldexMapChrome.menuItems(component), { separator: true }, ...registrationItems];
  }
  const currentPath = getCurrentFilePath();
  const hasFile = !!currentPath;
  const activeTab = typeof GBTabs !== 'undefined' && typeof GBLayout !== 'undefined' ? GBTabs.getActiveTab(GBLayout.activePane) : null;
  const formComponent = component || (activeTab && typeof getComponentInstance === 'function' ? getComponentInstance(activeTab.id) : null);
  const newItemType = {
    page: 'page', scriptnote: 'scriptnote', database: 'database',
    board: 'board', 'form-app': 'form-app', calendar: 'calendar', csv: 'page', folder: 'page'
  };
  const isFolderTool = toolType === 'folder';

  // --- インポート/エクスポートサブメニュー定義 ---
  const importExport = {
    // HTML 出力は全種別で公開機能に一本化 (メニューからは削除)。
    // 公開したい場合は「公開設定...」「公開を更新」を使う (specific[] 側で提供)。
    page: {
      import: [
        { label: 'Markdownファイルを開く...', action: () => {
          if (typeof importMarkdownFile === 'function') importMarkdownFile();
          else _showUnavailableToolMenuAction('Markdownファイルを開く');
        }, disabled: !hasFile },
      ],
      export: [
        { label: 'Markdownとして保存...', action: () => _exportFile('note', 'md'), disabled: !hasFile },
        { label: 'Wordとして保存...', action: () => _exportFile('note', 'docx'), disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('page'); }, disabled: !hasFile },
        { separator: true },
        { label: 'Markdownをコピー', action: () => {
          const pc = document.getElementById('page-content');
          if (!pc) return;
          const md = typeof htmlToMd === 'function' ? htmlToMd(pc.innerHTML) : pc.innerText;
          navigator.clipboard.writeText(md).then(() => showStatus('マークダウンをコピーしました'));
        }, disabled: !hasFile },
      ],
    },
    scriptnote: {
      import: [
        ...(!window.MeldexRuntimeAdapter?.isBrowserDataMode?.() ? [{ label: 'Excelからシナリオを作成...', action: () => {
          if (typeof importXlsxToOutliner === 'function') importXlsxToOutliner();
          else _showUnavailableToolMenuAction('Excelからシナリオを作成');
        } }] : []),
        { label: '旧シナリオからインポート...', action: context => showScriptNoteImportModal({ trigger: context?.trigger }) },
      ],
      export: [
        { label: '印刷...', action: () => {
          const editor = formComponent?._editor;
          if (editor?.doc && window.MeldexScriptNotePrint?.open) window.MeldexScriptNotePrint.open(editor);
          else _showUnavailableToolMenuAction('シナリオ印刷');
        }, disabled: !hasFile },
        { label: 'シナリオ形式として保存...', action: () => { if (typeof promptSaveCurrentScriptNoteAs === 'function') promptSaveCurrentScriptNoteAs(); }, disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('scriptnote'); }, disabled: !hasFile },
        { label: 'HTMLとして保存...', action: () => { if (typeof exportCurrentScriptNoteAsHtml === 'function') exportCurrentScriptNoteAsHtml(); }, disabled: !hasFile },
        { label: 'Markdownとして保存...', action: () => { if (typeof exportCurrentScriptNoteAsMarkdown === 'function') exportCurrentScriptNoteAsMarkdown(); }, disabled: !hasFile },
        { separator: true },
        { label: 'CLIP STUDIO PAINTへ送信', action: () => { if (typeof sn2CopyForClipStudio === 'function') sn2CopyForClipStudio(); }, disabled: !hasFile },
        ...(window.MeldexBManga?.isAvailable?.() ? [
          { label: 'B-MANGAへ送信...', action: () => window.MeldexBManga.sendActiveScenario(), disabled: !hasFile },
        ] : []),
      ],
    },
    database: {
      import: [
        { label: 'CSVからインポート...', action: () => {
          if (typeof importCsvToDb === 'function') importCsvToDb();
          else _showUnavailableToolMenuAction('CSVからインポート');
        }, disabled: !hasFile },
        { label: 'Excelからインポート...', action: () => {
          if (typeof importXlsxToDb === 'function') importXlsxToDb();
          else _showUnavailableToolMenuAction('Excelからインポート');
        }, disabled: !hasFile },
        ...(_toolMenuKindleImportAvailable() ? [{ label: 'Kindleの本棚を取り込む...', action: () => {
          if (typeof importKindleLibraryToDb === 'function') importKindleLibraryToDb();
          else _showUnavailableToolMenuAction('Kindleの本棚を取り込む');
        }, disabled: !hasFile }] : []),
      ],
      export: [
        { label: 'CSVとして保存...', action: () => _exportFile('db', 'csv'), disabled: !hasFile },
        { label: 'Excelとして保存...', action: () => _exportFile('db', 'xlsx'), disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('database'); }, disabled: !hasFile },
        { separator: true },
        { label: '辞書ファイルを出力', action: context => _exportDictFile({ trigger: context?.trigger }) },
      ],
    },
    board: {
      export: [
        { label: 'PNG画像として保存', action: () => { if (typeof bdExportImage === 'function') bdExportImage(); }, disabled: !hasFile },
        { label: 'HTMLとして保存...', action: () => { if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.exportCurrentView('board'); }, disabled: !hasFile },
        { label: 'SVG画像として保存...', action: () => _exportFile('canvas', 'svg'), disabled: !hasFile },
        { label: 'Markdownとして保存...', action: () => _exportFile('canvas', 'md'), disabled: !hasFile },
      ],
    },
    calendar: {
      import: [
        { label: 'シフト表を取り込む...', action: () => { if (typeof openProductionShiftImport === 'function') openProductionShiftImport(); } },
      ],
      export: [
        { label: '公開を更新', action: () => { if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('calendar'); }, disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('calendar'); }, disabled: !hasFile },
        { separator: true },
        ...(_toolMenuCanManageAttendance() ? [
          { label: '勤怠CSVとして保存...', action: () => { if (typeof exportAttendanceCsvFromMenu === 'function') exportAttendanceCsvFromMenu(); } },
        ] : []),
        { label: 'シフト、実績、作業予定を書き出す...', action: () => { if (typeof openProductionExport === 'function') openProductionExport(); } },
      ],
    },
    csv: {
      export: [
        { label: '名前を付けて保存...', action: () => _exportFile('file', 'csv'), disabled: !hasFile },
        { label: '公開を更新', action: () => { if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('csv'); }, disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('csv'); }, disabled: !hasFile },
      ],
    },
  };

  // --- サブメニュー組み立て ---
  const ie = importExport[toolType] || {};
  const submenus = [];
  if (ie.import && ie.import.length > 0) {
    submenus.push({ label: 'インポート', icon: (typeof uiTransferIconName === 'function' ? uiTransferIconName('import') : 'download'), submenu: ie.import });
  }
  if (ie.export && ie.export.length > 0) {
    submenus.push({ label: 'エクスポート', icon: (typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload'), submenu: ie.export });
  }
  const productionCalendarItems = toolType === 'calendar'
    ? (window.MeldexProductionManagementActions?.toolMenuItems?.() || [])
    : [];

  // --- ツール固有の項目（サブメニュー以外） ---
  const specific = {
    page: [
      { label: '現在のノートからテンプレートを作成...', action: () => MeldexNoteTemplates.show({ registerCurrent: true }).catch(error => showStatus(error.message, true)), disabled: !hasFile },
      { label: 'ノートテンプレート...', action: () => MeldexNoteTemplates.show().catch(error => showStatus(error.message, true)), disabled: !hasFile },
      { label: '検索・置換', action: context => { if (typeof openCurrentToolbarSearchReplace === 'function') openCurrentToolbarSearchReplace('page', { trigger: context?.trigger }); }, disabled: !hasFile },
      { label: 'オプションを表示', action: context => { if (typeof _openDetailRightPanel === 'function') _openDetailRightPanel(context?.trigger); else if (typeof openRightPanelTab === 'function') openRightPanelTab('detail', context?.trigger); }, disabled: !hasFile },
      { label: '公開設定...', action: context => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal({ returnFocus: context?.trigger }); }, disabled: !hasFile },
      { label: '公開を更新', action: () => { if (typeof publishCurrentPageView === 'function') publishCurrentPageView(); else if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('page'); }, disabled: !hasFile },
    ],
    'form-app': [
      { label: '公開設定...', action: context => showPublishSettingsModal({ returnFocus: context?.trigger }), disabled: !formComponent?.store },
      { label: '公開を更新', action: () => MeldexExportHtml.publishCurrentView('form-app'), disabled: !formComponent?.store },
      { label: 'テンプレートに登録', action: () => {
        return formComponent?.registerTemplate?.();
      }, disabled: !formComponent?.store },
    ],
    scriptnote: [
      { label: '開く...', action: context => showScriptNoteOpenModal('open', { trigger: context?.trigger }) },
      { label: 'テンプレート...', action: () => { const comp = formComponent; if (comp && typeof comp._showTemplatePicker === 'function') comp._showTemplatePicker(); else showStatus('シナリオを開いてから選んでください', true); }, disabled: !hasFile },
      { label: '現在のシナリオからテンプレートを作成...', action: () => { const comp = formComponent; if (comp && typeof comp._addTemplatePreset === 'function') comp._addTemplatePreset({ allowOverwrite: false, okText: '登録' }); else showStatus('シナリオを開いてから作成してください', true); }, disabled: !hasFile },
      { label: '検索・置換', action: context => { if (typeof openCurrentToolbarSearchReplace === 'function') openCurrentToolbarSearchReplace('scriptnote', { trigger: context?.trigger }); }, disabled: !hasFile },
      { label: '公開設定...', action: context => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal({ returnFocus: context?.trigger }); }, disabled: !hasFile },
      { label: '公開を更新', action: () => { if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('scriptnote'); }, disabled: !hasFile },
    ],
    database: [
      { label: 'シートテンプレート...', action: context => { if (typeof showTemplateGalleryModal === 'function') showTemplateGalleryModal(state.currentDbPath || currentPath, context?.trigger); }, disabled: !hasFile },
      { label: '現在のシートからテンプレートを作成...', action: context => { if (typeof showCreateTemplateModal === 'function') showCreateTemplateModal(state.currentDbPath || currentPath, context?.trigger); }, disabled: !hasFile },
      { label: '新規トピックのノートテンプレート...', action: () => MeldexNoteTemplates.show({ dbPath: currentPath }).catch(error => showStatus(error.message, true)), disabled: !hasFile },
      { label: '検索・置換', action: context => { if (typeof openCurrentToolbarSearchReplace === 'function') openCurrentToolbarSearchReplace('database', { trigger: context?.trigger }); }, disabled: !hasFile },
      { label: '列の表示と順序', action: () => { if (typeof showColumnDisplayOrderModal === 'function') showColumnDisplayOrderModal(); else if (typeof showColVisibilityModal === 'function') showColVisibilityModal(); }, disabled: !hasFile },
      { label: 'シート横断検索', action: context => { if (typeof showDbSearchModal === 'function') showDbSearchModal({ returnFocus: context?.trigger }); }, disabled: !hasFile },
      { label: '整合性検証', action: () => { if (typeof onValidateClick === 'function') onValidateClick(); }, disabled: !hasFile },
      { label: '検証ルール管理', action: () => { if (typeof showValidationRulesModal === 'function') showValidationRulesModal(state.currentDbPath || currentPath); }, disabled: !hasFile },
      { label: 'アーカイブ管理...', action: () => { if (typeof showSheetArchiveModal === 'function') showSheetArchiveModal(state.currentDbPath || currentPath); }, disabled: !hasFile },
      { separator: true },
      { label: '公開設定...', action: context => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal({ returnFocus: context?.trigger }); }, disabled: !hasFile },
    ],
    board: [
      { label: '検索・置換', action: context => { if (typeof openCurrentToolbarSearchReplace === 'function') openCurrentToolbarSearchReplace('board', { trigger: context?.trigger }); }, disabled: !hasFile },
      { label: 'テンプレート...', action: () => { if (!window.MeldexBoardTemplates) { showStatus('ボードテンプレートを読み込めませんでした', true); return; } MeldexBoardTemplates.open().catch?.(error => showStatus(error.message, true)); }, disabled: !hasFile },
      { label: '現在のボードからテンプレートを作成...', action: () => { if (!window.MeldexBoardTemplates) { showStatus('ボードテンプレートを読み込めませんでした', true); return; } MeldexBoardTemplates.registerCurrent().catch(error => showStatus(error.message, true)); }, disabled: !hasFile },
      { label: '新規リンクトピック: ノート', action: () => {
        if (typeof bdCreateLinkedFileCardAt !== 'function') { showStatus('リンクトピック追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdCreateLinkedFileCardAt(pos.x, pos.y, 'page');
      } },
      { label: '新規リンクトピック: シート', action: () => {
        if (typeof bdCreateLinkedFileCardAt !== 'function') { showStatus('リンクトピック追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdCreateLinkedFileCardAt(pos.x, pos.y, 'database');
      } },
      { label: '新規リンクトピック: ボード', action: () => {
        if (typeof bdCreateLinkedFileCardAt !== 'function') { showStatus('リンクトピック追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdCreateLinkedFileCardAt(pos.x, pos.y, 'board');
      } },
      { label: '既存ファイルへのリンクトピック...', action: () => {
        if (typeof bdPromptAddLinkCardAt !== 'function') { showStatus('リンクトピック追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdPromptAddLinkCardAt(pos.x, pos.y);
      } },
      { label: 'シートから一括読込...', action: () => {
        if (typeof bdOpenBulkLinkImport === 'function') bdOpenBulkLinkImport();
      }, disabled: !hasFile },
      { separator: true },
      { label: '公開設定...', action: context => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal({ returnFocus: context?.trigger }); }, disabled: !hasFile },
    ],
    calendar: [
      { label: '新規イベント', action: () => _openCalendarEventFromMenu() },
      { separator: true },
      ...productionCalendarItems,
      { separator: true },
      { label: '同期設定...', action: () => _openCalendarSyncFromMenu() },
      { label: '公開設定...', action: context => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal({ returnFocus: context?.trigger }); }, disabled: !hasFile },
    ],
    csv: [
      { label: '行を追加', action: () => { if (typeof addCsvRow === 'function') addCsvRow(); }, disabled: !hasFile },
      { label: '列を追加', action: () => { if (typeof addCsvColumn === 'function') addCsvColumn(); }, disabled: !hasFile },
      { separator: true },
      { label: 'シートに変換...', action: () => { if (typeof convertCsvToDb === 'function') convertCsvToDb(); }, disabled: !hasFile },
      { label: '公開設定...', action: context => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal({ returnFocus: context?.trigger }); }, disabled: !hasFile },
    ],
    folder: [
      { label: '検索・置換', action: context => { if (typeof openCurrentToolbarSearchReplace === 'function') openCurrentToolbarSearchReplace('folder', { trigger: context?.trigger }); } },
      { label: '現在のフォルダを開く', action: () => { const path = getCurrentFilePath(); if (path && typeof openNative === 'function') openNative(path); }, disabled: !hasFile },
      { label: 'スライドショー', action: () => { if (typeof openFolderSlideshow === 'function') openFolderSlideshow(); }, disabled: !hasFile },
      { separator: true },
      { label: '表示設定', action: () => { if (typeof showFolderDisplaySettings === 'function') showFolderDisplaySettings(); } },
      { label: 'オプションを表示', action: () => { if (typeof showFolderPanelSettings === 'function') showFolderPanelSettings(); } },
    ],
  };

  const folderCreateItems = [
    { label: 'フォルダ', icon: 'folder', action: () => _createFolderViewItem('folder') },
    { label: 'ノート', icon: 'page', action: () => _createFolderViewItem('page') },
    { label: 'シナリオ', icon: 'bookOpenText', action: () => _createFolderViewItem('scriptnote') },
    { label: 'シート', icon: 'db', action: () => _createFolderViewItem('database') },
    { label: 'ボード', icon: 'presentation', action: () => _createFolderViewItem('board') },
    { label: 'フォーム', icon: 'clipboardList', action: () => _createFolderViewItem('form-app') },
    { label: 'マップ', icon: 'map', action: () => _createFolderViewItem('map') },
    { label: 'カレンダー', icon: 'calendar', action: () => _createFolderViewItem('calendar') },
  ];
  const common = isFolderTool
    ? [{ label: '新規作成', icon: 'plus', submenu: folderCreateItems }]
    : [
      { label: '新規作成', action: () => { if (typeof showAddOutlinerItem === 'function') showAddOutlinerItem(newItemType[toolType] || 'page'); } },
    ];

  const fileActions = hasFile && !isFolderTool ? [
    { separator: true },
    { label: '別名で保存...', action: context => _showSaveAsModal(currentPath, { trigger: context?.trigger, toolType }) },
    { label: 'ファイルを複製', action: () => _duplicateCurrentFile(toolType) },
    { label: 'ファイルを削除', action: () => _deleteCurrentFile(toolType) },
  ] : [];

  const tailPre = [
    { separator: true },
    { label: 'バージョン管理', action: () => { if (typeof openCurrentVersionsTab === 'function') openCurrentVersionsTab(); }, disabled: !hasFile },
    { label: 'パスをコピー', action: () => _copyCurrentFilePath(), disabled: !hasFile },
  ];

  // 最近使ったファイル（サブメニュー化）
  const recentItem = {
    label: '最近使ったファイル',
    icon: 'clock',
    submenu: _buildRecentSubmenuItems(toolType),
  };

  // インポート / エクスポートを「閉じる」の上に配置
  const importExportBlock = submenus.length > 0
    ? [{ separator: true }, ...submenus]
    : [];

  const tailClose = [
    { separator: true },
    { label: '閉じる', action: () => closeCurrentView(), disabled: !hasFile },
  ];

  return [
    ...common,
    ...(specific[toolType] || []),
    { separator: true },
    ...registrationItems,
    ...fileActions,
    ...tailPre,
    { separator: true },
    recentItem,
    ...importExportBlock,
    ...tailClose,
  ];
}

// 「フォルダツリーで表示」はツールバーに独立のボタンを置かず、メインメニューの項目にする（UI共通ルール19）。
// フォルダツリーを持たない単独アプリ（共通の表示処理を読み込まない）では出さない。
function _toolMenuRevealItems(toolType, component) {
  if (typeof window.getCurrentFolderTreeRevealPath !== 'function' || typeof revealCurrentInFolderTree !== 'function') return [];
  const target = _toolMenuFileTarget(toolType, component);
  const hasTarget = !!target.path || (toolType === 'folder' && !!getCurrentFilePath());
  return [{
    label: 'フォルダツリーで表示', icon: 'folderTree', disabled: !hasTarget,
    action: context => {
      const trigger = context?.trigger || null;
      // パネルのツールバーから開いた時は従来のボタンと同じ解決（フォルダパネルの選択中の項目を含む）。
      // サブパネル等、パネルの外から開いた時はメニューを開いたファイル自身を表示する。
      const inPane = !!trigger?.closest?.('.gb-pane[data-pane-id]');
      if (toolType !== 'folder' && !inPane && target.path && typeof window.revealPathInFolderTree === 'function') {
        return window.revealPathInFolderTree(target.path);
      }
      return revealCurrentInFolderTree(toolType, { type: 'menu', target: trigger });
    },
  }];
}

function _toolMenuFileRegistrationItems(toolType, component) {
  const target = _toolMenuFileTarget(toolType, component);
  const registered = !!target.path && typeof getFavorites === 'function' && typeof _favExists === 'function'
    && _favExists(getFavorites(), target.path);
  const run = async (label, action) => {
    try { await action(); }
    catch (error) { if (typeof showStatus === 'function') showStatus(`${label}に失敗しました: ${error?.userMessage || error?.message || error}`, true); }
  };
  return [
    { label: registered ? 'お気に入りに登録済み' : 'お気に入りに登録', icon: 'star',
      disabled: !target.path || registered || typeof addToFavorites !== 'function',
      action: () => run('お気に入りへの登録', () => addToFavorites(target.label, target.path, target.type)) },
    { label: '指定フォルダにリンクファイルを追加...', icon: 'link2',
      disabled: !target.path || typeof showAddFolderLinkModal !== 'function',
      action: () => run('リンクファイルの追加', () => showAddFolderLinkModal(target.path, null)) },
  ];
}

function _toolMenuCanManageAttendance() {
  // スケジュールの管理者判定（出退勤状況のメンバー行・実績の修正と同じ判定）を優先する。チームの役割だけを見ると、
  // 管理者（所有者）にも「勤怠CSVとして保存...」が出なかった（M-014 スケジュール網羅で発見）。
  try { if (window.MeldexCalendarAttendanceAccess?.canManage?.()) return true; } catch {}
  let role = '';
  try {
    if (typeof getMyRoleForPath === 'function') role = String(getMyRoleForPath('') || '').toLowerCase();
  } catch {}
  try {
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    if (!role) role = String(state.access || state.role || '').toLowerCase();
    if (state.isOwner === true) return true;
  } catch {}
  return role === 'owner' || role === 'admin';
}

function _showUnavailableToolMenuAction(label) {
  if (typeof showStatus === 'function') showStatus(`${label}を実行できませんでした`, true);
}

// ノート: 「インポート」→「Markdownファイルを開く...」
async function importMarkdownFile() {
  let path = '';
  try {
    path = await openFileDialog('Markdownファイルを開く', '', [['Markdown', '*.md'], ['すべてのファイル', '*.*']]);
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('ファイル選択でエラーが発生しました: ' + (e?.userMessage || e?.message || e), true);
    return;
  }
  if (!path) return;
  if (typeof openPage !== 'function') { _showUnavailableToolMenuAction('Markdownファイルを開く'); return; }
  const normalized = String(path).replace(/\\/g, '/');
  const label = normalized.split('/').pop()?.replace(/\.md$/i, '') || 'Markdown';
  await openPage(label, normalized);
}

// データベース: 「インポート」→「CSVからインポート...」（現在開いているシートにCSVの行を取り込む）
async function importCsvToDb() {
  const dbPath = typeof getCurrentFilePath === 'function' ? getCurrentFilePath() : null;
  if (!dbPath) { _showUnavailableToolMenuAction('CSVからインポート'); return; }
  let path = '';
  try {
    path = await openFileDialog('CSVファイルを選択', '', [['CSV', '*.csv'], ['すべてのファイル', '*.*']]);
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('ファイル選択でエラーが発生しました: ' + (e?.userMessage || e?.message || e), true);
    return;
  }
  if (!path) return;
  try {
    const result = await runBackgroundJob('/import-csv', { csv_path: path, db_path: dbPath, background: true }, { operationLabel: 'CSVをシートに取り込んでいます' });
    const count = Number(result?.count || 0);
    if (typeof showStatus === 'function') showStatus('CSVインポート完了（' + count + '件）');
    if (typeof selectDatabase === 'function' && getCurrentFilePath() === dbPath) selectDatabase(dbPath);
  } catch (e) {
    if (e?.name === 'AbortError') {
      showStatus('CSV取り込みを停止しました。保存済みの行を保持し、同じCSVの再実行では残りを取り込みます。');
      if (getCurrentFilePath() === dbPath && typeof selectDatabase === 'function') selectDatabase(dbPath);
      return;
    }
    if (typeof showStatus === 'function') showStatus('CSVのインポートに失敗しました: ' + (e?.userMessage || e?.message || e), true);
  }
}

// シート: 「インポート」→「Excelからインポート...」
// Scenario用のブラウザーFile inputとは共有せず、現在のシート専用routeへ送る。
async function importXlsxToDb() {
  const dbPath = typeof getCurrentFilePath === 'function' ? getCurrentFilePath() : null;
  if (!dbPath) { _showUnavailableToolMenuAction('Excelからインポート'); return; }
  let path = '';
  try {
    path = await openFileDialog('Excelファイルを選択', '', [['Excel', '*.xlsx'], ['すべてのファイル', '*.*']]);
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('ファイル選択でエラーが発生しました: ' + (e?.userMessage || e?.message || e), true);
    return;
  }
  if (!path) return;
  try {
    const result = await runBackgroundJob('/import-xlsx', { xlsx_path: path, db_path: dbPath, background: true }, { operationLabel: 'Excelをシートに取り込んでいます' });
    const count = Number(result?.count || 0);
    if (typeof showStatus === 'function') showStatus('Excelインポート完了（' + count + '件）');
    if (typeof selectDatabase === 'function' && getCurrentFilePath() === dbPath) selectDatabase(dbPath);
  } catch (e) {
    if (e?.name === 'AbortError') {
      showStatus('Excel取り込みを停止しました。保存済みの行を保持し、同じExcelの再実行では残りを取り込みます。');
      if (getCurrentFilePath() === dbPath && typeof selectDatabase === 'function') selectDatabase(dbPath);
      return;
    }
    if (typeof showStatus === 'function') showStatus('Excelのインポートに失敗しました: ' + (e?.userMessage || e?.message || e), true);
  }
}

// シート: 「インポート」→「Kindleの本棚を取り込む...」
// Kindle for PC（Windows）がこのPCに残す本棚の記録を、開いているシートへ取り込む。Cloud・Windows以外では出さない。
function _toolMenuKindleImportAvailable() {
  if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) return false;
  const platform = String(navigator.userAgentData?.platform || navigator.platform || '');
  return /^win/i.test(platform);
}

async function importKindleLibraryToDb() {
  const label = 'Kindleの本棚を取り込む';
  const dbPath = typeof getCurrentFilePath === 'function' ? getCurrentFilePath() : null;
  if (!dbPath) { _showUnavailableToolMenuAction(label); return; }
  let status = null;
  try {
    status = await apiFetch('/import-kindle/status');
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('Kindleの本棚を確認できませんでした: ' + (e?.userMessage || e?.message || e), true);
    return;
  }
  if (!status?.available) {
    if (typeof showStatus === 'function') showStatus(status?.message || (label + 'を実行できませんでした'), true);
    return;
  }
  const count = Number(status.count || 0);
  const syncLine = status.sync_time ? 'Kindle for PCの最終同期: ' + status.sync_time : 'Kindle for PCの最終同期: 不明';
  const helpHost = document.createElement('div');
  helpHost.className = 'gb-kindle-import-help';
  helpHost.dataset.e2eId = 'kindle-import-help';
  helpHost.innerHTML = '最新の本棚にするには ' + (typeof fieldHelp === 'function' ? fieldHelp(
    '取り込まれるのは、Kindle for PCが最後に同期した時点の本棚です。最新にしたい時は、先にKindle for PCを開いて同期してから取り込んでください。'
    + '同じシートへもう一度取り込むと、ASINで照合して新しい本を追加し、変わった項目だけを更新します。'
    + '自分で足した列の値と、Kindleから無くなった本はそのまま残ります。'
  ) : '');
  const accepted = typeof cfConfirm === 'function'
    ? await cfConfirm('Kindleの本棚（' + count + '冊）をこのシートに取り込みます\n' + syncLine, { okLabel: '取り込む', extraNode: helpHost })
    : false;
  if (!accepted) return;
  try {
    const result = await runBackgroundJob('/import-kindle', { db_path: dbPath, background: true }, { operationLabel: 'Kindleの本棚を取り込んでいます' });
    const added = Number(result?.added || 0);
    const updated = Number(result?.updated || 0);
    const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    if (typeof showStatus === 'function') {
      showStatus('Kindleの本棚を取り込みました（追加 ' + added + '冊・更新 ' + updated + '冊）' + (warnings.length ? '。' + warnings[0] : ''), warnings.length > 0);
    }
    if (typeof selectDatabase === 'function' && getCurrentFilePath() === dbPath) selectDatabase(dbPath);
  } catch (e) {
    if (e?.name === 'AbortError') {
      if (typeof showStatus === 'function') showStatus('Kindleの本棚の取り込みを停止しました。取り込み済みの本は残り、もう一度取り込むと続きを反映します。');
      if (getCurrentFilePath() === dbPath && typeof selectDatabase === 'function') selectDatabase(dbPath);
      return;
    }
    if (typeof showStatus === 'function') showStatus('Kindleの本棚を取り込めませんでした: ' + (e?.userMessage || e?.message || e), true);
  }
}

function _getActiveToolComponent(toolType) {
  if (typeof GBTabs === 'undefined' || typeof getComponentInstance !== 'function') return null;
  const activeTab = typeof GBTabs.getActiveTab === 'function' ? GBTabs.getActiveTab() : null;
  if (!activeTab || activeTab.type !== toolType) return null;
  return getComponentInstance(activeTab.id) || null;
}

function _openCalendarEventFromMenu() {
  const comp = _getActiveToolComponent('calendar');
  if (comp && typeof comp._openEventInPanel === 'function') {
    // ショートカット N と同じく、表示中の日付に終日の予定を作る（今日に作ると、別の週・月を見ている時に
    // 作った予定が画面に出ず、作ったことが分からない。M-014 スケジュールの網羅テストで発見）。
    const date = comp._date instanceof Date && !Number.isNaN(comp._date.getTime()) ? comp._date : new Date();
    const dateStr = typeof comp._localDateStr === 'function' ? comp._localDateStr(date) : date.toISOString().slice(0, 10);
    comp._openEventInPanel(null, dateStr + 'T00:00', dateStr + 'T23:59', true);
    return;
  }
  if (typeof addCalendarEvent === 'function') {
    addCalendarEvent();
    return;
  }
  _showUnavailableToolMenuAction('新規イベント');
}

function _openCalendarSyncFromMenu() {
  const comp = _getActiveToolComponent('calendar');
  if (comp && typeof comp._showSyncModal === 'function') {
    comp._showSyncModal();
    return;
  }
  if (typeof showCalSyncModal === 'function') {
    showCalSyncModal();
    return;
  }
  _showUnavailableToolMenuAction('同期設定');
}

function _toolMenuDialogIcon(name, size) {
  return typeof lucide === 'function' ? lucide(name, size || 14) : '';
}

function _setSaveAsFolderTreeOpen(folderTree, folderDisplay, open) {
  folderTree.hidden = !open;
  folderDisplay.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// 別名で保存モーダル
async function _showSaveAsModal(srcPath, options = {}) {
  if (!srcPath) return;
  const trigger = options.trigger
    || document.activeElement?.closest?.('.tool-menu-btn, button, [role="button"], [tabindex]')
    || null;
  const srcName = srcPath.includes('/') ? srcPath.substring(srcPath.lastIndexOf('/') + 1) : srcPath;
  const srcFolder = srcPath.includes('/') ? srcPath.substring(0, srcPath.lastIndexOf('/')) : '';
  // 拡張子を除いた名前
  const baseName = srcName.includes('.') ? srcName.substring(0, srcName.lastIndexOf('.')) : srcName;

  const bodyContent = document.createElement('div');
  bodyContent.innerHTML = `<div class="field gb-tool-save-as-field">
      <label for="saveas-name" class="gb-tool-save-as-label">新しい名前</label>
      <input id="saveas-name" class="gb-input gb-tool-save-as-name" type="text" value="${esc(baseName)}" aria-label="新しい名前" data-e2e-id="tool-menu-save-as-name">
    </div>
    <div class="field gb-tool-save-as-field">
      <label id="saveas-folder-label-title" class="gb-tool-save-as-label">保存先フォルダ</label>
      <div id="saveas-folder-display" class="gb-tool-save-as-folder-display" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false" aria-labelledby="saveas-folder-label-title saveas-folder-label" data-e2e-id="tool-menu-save-as-folder-display">
        <span class="gb-tool-save-as-folder-icon" aria-hidden="true">${_toolMenuDialogIcon('folder', 14)}</span>
        <span id="saveas-folder-label" class="gb-tool-save-as-folder-label">${esc(srcFolder || '(ルート)')}</span>
        <span class="gb-tool-save-as-folder-chevron" aria-hidden="true">${_toolMenuDialogIcon('chevronDown', 12)}</span>
      </div>
      <div id="saveas-folder-tree" class="gb-tool-save-as-folder-tree" role="listbox" hidden data-e2e-id="tool-menu-save-as-folder-tree"></div>
    </div>
    <div class="gb-tool-save-as-status" data-e2e-id="tool-menu-save-as-status" role="status" aria-live="polite" hidden></div>`;
  const nameInput = bodyContent.querySelector('#saveas-name');
  const folderDisplay = bodyContent.querySelector('#saveas-folder-display');
  const folderTree = bodyContent.querySelector('#saveas-folder-tree');
  const folderLabel = bodyContent.querySelector('#saveas-folder-label');
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.id = 'saveas-cancel';
  cancelButton.className = 'gb-btn gb-btn-sm';
  cancelButton.textContent = 'キャンセル';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.id = 'saveas-ok';
  saveButton.className = 'gb-btn gb-btn-sm gb-btn-primary';
  saveButton.textContent = '保存';
  let selectedFolder = srcFolder;
  let actionBusy = false;
  let closed = false;
  const modalApi = window.GBUI.createModal({
    id: 'tool-menu-save-as-dialog',
    titleId: 'saveas-title',
    title: '別名で保存',
    body: [...bodyContent.childNodes],
    footer: [cancelButton, saveButton],
    variant: 'standard',
    extraClass: 'gb-tool-save-as-modal',
    geometryKey: 'tool-menu-save-as-dialog',
    minWidth: '0',
    initialFocus: nameInput,
    returnFocus: () => trigger,
    closeLabel: '別名で保存を閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
    onBeforeClose: reason => !actionBusy || ['saved', 'test-cleanup'].includes(reason),
    onClose: () => { closed = true; },
  });
  const overlay = modalApi.overlay;
  overlay.classList.add('modal-overlay', 'gb-tool-save-as-overlay');
  overlay.dataset.e2eId = 'tool-menu-save-as-overlay';
  overlay._toolMenuSaveAsModalApi = modalApi;
  modalApi.modal.dataset.e2eId = 'tool-menu-save-as-dialog';
  modalApi.modal.style.minHeight = '320px';
  modalApi.header.classList.add('gb-tool-save-as-header');
  modalApi.header.dataset.modalHeader = '1';
  modalApi.body.classList.add('gb-tool-save-as-body');
  modalApi.footer.classList.add('gb-tool-save-as-footer');
  modalApi.footer.dataset.modalFooter = '1';
  const titleElement = modalApi.header.querySelector('.gb-modal-title');
  titleElement?.classList.add('gb-tool-save-as-title');
  if (titleElement) {
    const titleIcon = document.createElement('span');
    titleIcon.className = 'gb-tool-save-as-title-icon';
    titleIcon.setAttribute('aria-hidden', 'true');
    titleIcon.innerHTML = _toolMenuDialogIcon('copy', 16);
    titleElement.prepend(titleIcon);
  }
  const closeButton = modalApi.header.querySelector('.gb-modal-close');
  if (closeButton) {
    closeButton.id = 'saveas-close';
    closeButton.classList.add('gb-tool-save-as-close');
    closeButton.dataset.e2eId = 'tool-menu-save-as-close';
  }
  const status = modalApi.body.querySelector('[data-e2e-id="tool-menu-save-as-status"]');
  const setStatus = (message, isError = false) => {
    status.textContent = String(message || '');
    status.hidden = !message;
    status.dataset.error = isError ? '1' : '0';
  };
  const setActionBusy = next => {
    actionBusy = !!next;
    overlay.setAttribute('aria-busy', actionBusy ? 'true' : 'false');
    nameInput.disabled = actionBusy;
    folderDisplay.setAttribute('aria-disabled', actionBusy ? 'true' : 'false');
    folderDisplay.tabIndex = actionBusy ? -1 : 0;
    cancelButton.disabled = actionBusy;
    saveButton.disabled = actionBusy;
    if (closeButton) closeButton.disabled = actionBusy;
  };

  // フォルダツリー表示/非表示
  folderDisplay.addEventListener('click', async () => {
    if (actionBusy) return;
    setStatus('');
    if (window.GBFolderPicker?.pickFolder) {
      setActionBusy(true);
      try {
        const selected = await window.GBFolderPicker.pickFolder({
          title: '保存先フォルダを選択',
          initialPath: selectedFolder,
        });
        if (selected?.path !== undefined) {
          selectedFolder = selected.path;
          folderLabel.textContent = selected.label || selected.name || selected.path || '(ルート)';
          _setSaveAsFolderTreeOpen(folderTree, folderDisplay, false);
        }
      } catch (error) {
        setStatus('保存先を選択できませんでした: ' + (error.message || error), true);
      } finally {
        if (!closed) setActionBusy(false);
      }
      return;
    }
    if (folderTree.hidden) {
      _setSaveAsFolderTreeOpen(folderTree, folderDisplay, true);
      setActionBusy(true);
      try {
        await _loadSaveAsFolderTree(folderTree, selectedFolder, (path, label) => {
          selectedFolder = path;
          folderLabel.textContent = label || '(ルート)';
          _setSaveAsFolderTreeOpen(folderTree, folderDisplay, false);
        });
      } finally {
        if (!closed) setActionBusy(false);
      }
    } else {
      _setSaveAsFolderTreeOpen(folderTree, folderDisplay, false);
    }
  });
  folderDisplay.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    folderDisplay.click();
  });

  // キャンセル
  cancelButton.addEventListener('click', () => modalApi.close('cancel'));

  // 保存実行
  saveButton.addEventListener('click', async () => {
    if (actionBusy) return;
    const newName = nameInput.value.trim();
    if (!newName) {
      setStatus('名前を入力してください', true);
      showStatus('名前を入力してください', true);
      nameInput.focus({ preventScroll: true });
      return;
    }
    setStatus('');
    setActionBusy(true);
    // 取り消しの記録は、操作した画面の履歴に積む（2026-11-21 ユーザー決定。取り消しは作ったコピーをゴミ箱へ移す）
    const historyScope = typeof _historyActiveScope !== 'undefined' ? _historyActiveScope : '';
    try {
      if (options.toolType === 'form-app' && typeof FormAppComponent !== 'undefined') {
        const source = FormAppComponent.prepareCopyOpen?.(srcPath, { preloadSheet: false });
        if (source?.flush && !await source.flush()) {
          throw new Error('元のフォームを保存できないため、別名での保存を中止しました');
        }
      }
      const res = await apiPost('/outliner/save-as', {
        path: srcPath,
        new_name: newName,
        dest_folder: selectedFolder,
      });
      modalApi.close('saved');
      // 成功は画面をふさがない短い通知で知らせる（UI共通ルールの状態表示。2026-11-21 予期しないダイアログの検査で検出）。
      showStatus('「' + (res.new_name || newName) + '」に保存しました');
      const createdPath = res?.new_path || res?.path || '';
      if (createdPath && typeof pushCreatedOutlinerItemHistory === 'function') {
        pushCreatedOutlinerItemHistory({ path: createdPath, type: options?.toolType || 'page' }, '別名で保存: ' + (res.new_name || newName), {
          scope: historyScope,
          refresh: async () => { if (typeof window.loadOutliner === 'function') await window.loadOutliner(); },
        });
      }
      if (typeof window.loadOutliner === 'function') window.loadOutliner();
    } catch (e) {
      const message = '保存に失敗: ' + (e.message || e);
      setStatus(message, true);
      showStatus(message, true);
      if (!closed) setActionBusy(false);
    }
  });

  // Enter で保存
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !actionBusy) saveButton.click();
  });
  modalApi.open();
  requestAnimationFrame(() => nameInput.select());
  return modalApi;
}

// フォルダツリーを読み込んで表示
async function _loadSaveAsFolderTree(container, currentFolder, onSelect) {
  container.innerHTML = '';

  // ルートフォルダ
  const rootItem = _createFolderRow('(ルート)', '', currentFolder === '', onSelect, 0, 'home');
  container.appendChild(rootItem);

  // ルート直下を読み込み
  await _expandSaveAsFolder(container, '', currentFolder, onSelect, 0);
}

async function _expandSaveAsFolder(container, parentPath, currentFolder, onSelect, depth) {
  try {
    const data = await apiFetch('/browse?path=' + encodeURIComponent(parentPath) + '&sort=name&order=asc');
    const items = Array.isArray(data) ? data : (data.items || []);
    const folders = items.filter(i => i.type === 'folder');
    // parentPathの行の直後に挿入
    const parentRow = container.querySelector('[data-folder-path="' + MeldexEscape.cssIdent(parentPath) + '"]');
    let insertAfter = parentRow;
    for (const item of folders) {
      if (container.querySelector('[data-folder-path="' + MeldexEscape.cssIdent(item.path) + '"]')) continue;
      const row = _createFolderRow(item.name, item.path, item.path === currentFolder, onSelect, depth + 1, 'folder');
      row.dataset.folderPath = item.path;
      row.dataset.depth = depth + 1;
      // 展開トグル
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'gb-tool-save-as-folder-toggle';
      toggle.setAttribute('aria-label', item.name + 'を展開');
      toggle.innerHTML = _toolMenuDialogIcon('chevronRight', 10);
      toggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const expanded = toggle.dataset.expanded === '1';
        if (expanded) {
          // 子行を削除
          const d = parseInt(row.dataset.depth);
          let next = row.nextElementSibling;
          while (next && parseInt(next.dataset.depth) > d) {
            const rm = next; next = next.nextElementSibling; rm.remove();
          }
          toggle.innerHTML = _toolMenuDialogIcon('chevronRight', 10);
          toggle.dataset.expanded = '0';
          toggle.setAttribute('aria-label', item.name + 'を展開');
        } else {
          await _expandSaveAsFolder(container, item.path, currentFolder, onSelect, depth + 1);
          toggle.innerHTML = _toolMenuDialogIcon('chevronDown', 10);
          toggle.dataset.expanded = '1';
          toggle.setAttribute('aria-label', item.name + 'を折りたたむ');
        }
      });
      row.prepend(toggle);
      if (insertAfter && insertAfter.nextSibling) {
        container.insertBefore(row, insertAfter.nextSibling);
      } else {
        container.appendChild(row);
      }
      insertAfter = row;
    }
  } catch (e) { /* ignore */ }
}

function _createFolderRow(name, path, isSelected, onSelect, depth, icon) {
  const row = document.createElement('div');
  row.className = 'gb-tool-save-as-folder-row' + (isSelected ? ' is-selected' : '');
  row.dataset.folderPath = path;
  row.dataset.depth = depth;
  row.style.setProperty('--gb-saveas-indent', (8 + depth * 16) + 'px');
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  row.tabIndex = 0;
  if (isSelected) row.dataset.selected = '1';
  const iconEl = document.createElement('span');
  iconEl.className = 'gb-tool-save-as-folder-row-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.innerHTML = _toolMenuDialogIcon(icon || 'folder', 14);
  row.appendChild(iconEl);
  const labelEl = document.createElement('span');
  labelEl.className = 'gb-tool-save-as-folder-row-label';
  labelEl.textContent = name || '(ルート)';
  row.appendChild(labelEl);
  const selectRow = () => {
    // 選択状態を更新
    row.closest('#saveas-folder-tree').querySelectorAll('[data-folder-path]').forEach(d => {
      delete d.dataset.selected;
      d.classList.remove('is-selected');
      d.setAttribute('aria-selected', 'false');
    });
    row.dataset.selected = '1';
    row.classList.add('is-selected');
    row.setAttribute('aria-selected', 'true');
    onSelect(path, name || '(ルート)');
  };
  row.addEventListener('click', selectRow);
  row.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    selectRow();
  });
  return row;
}

function _dictReadingStatus(status) {
  const normalized = String(status || '').trim();
  return normalized || '(未設定)';
}

function _dictEntryReadings(entry) {
  if (!entry || !entry.text) return [];
  const candidates = Array.isArray(entry.readings) && entry.readings.length
    ? entry.readings
    : (entry.ruby ? [{ value: entry.ruby, status: entry.status }] : []);
  return candidates
    .map((reading) => ({
      value: String(reading?.value || reading?.ruby || '').trim(),
      status: _dictReadingStatus(reading?.status),
    }))
    .filter((reading) => reading.value);
}

function _prepareDictExport(entries, allowedStatuses) {
  const lines = [];
  const statuses = new Set();
  const pairs = new Set();
  let withoutReading = 0;
  let duplicateCount = 0;
  (entries || []).forEach((entry) => {
    const text = String(entry?.text || '').trim();
    if (!text) return;
    const readings = _dictEntryReadings(entry);
    if (!readings.length) {
      withoutReading += 1;
      return;
    }
    readings.forEach((reading) => statuses.add(reading.status));
    readings.forEach((reading) => {
      if (allowedStatuses && !allowedStatuses.has(reading.status)) return;
      const pairKey = reading.value + '\u0000' + text;
      if (pairs.has(pairKey)) {
        duplicateCount += 1;
        return;
      }
      pairs.add(pairKey);
      lines.push(reading.value + '\t' + text + '\t固有名詞');
    });
  });
  return { lines, statuses: [...statuses], withoutReading, duplicateCount };
}

// 辞書出力で出力ステータスを選ぶダイアログ。
// 戻り値: Set=書き出し、null=キャンセル。
function _showDictStatusDialog(statuses, summary, options = {}) {
  return new Promise((resolve) => {
  const trigger = options.trigger
    || document.activeElement?.closest?.('.tool-menu-btn, button, [role="button"], [tabindex]')
    || null;
  const body = document.createElement('div');
  body.className = 'gb-tool-dict-status-content';
  const toggleRow = document.createElement('div');
  toggleRow.className = 'gb-tool-dict-status-toggle-row';
  const selectAllBtn = document.createElement('button');
  selectAllBtn.type = 'button';
  selectAllBtn.className = 'gb-btn gb-btn-sm';
  selectAllBtn.textContent = 'すべて選択';
  selectAllBtn.dataset.e2eId = 'dict-status-select-all';
  const clearAllBtn = document.createElement('button');
  clearAllBtn.type = 'button';
  clearAllBtn.className = 'gb-btn gb-btn-sm';
  clearAllBtn.textContent = 'すべて解除';
  clearAllBtn.dataset.e2eId = 'dict-status-clear-all';
  toggleRow.append(selectAllBtn, clearAllBtn);
  body.appendChild(toggleRow);
  const listWrap = document.createElement('div');
  listWrap.className = 'gb-tool-dict-status-list';
  listWrap.setAttribute('role', 'group');
  listWrap.setAttribute('aria-label', '辞書に出力するステータス');
  listWrap.dataset.e2eId = 'dict-status-options';
  listWrap.dataset.smallList = (statuses || []).length <= 3 ? '1' : '0';
  const boxes = [];
  (statuses || []).forEach((st, index) => {
    const row = document.createElement('label');
    row.className = 'gb-tool-dict-status-option';
    row.dataset.status = st;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = st === '採用';
    cb.dataset.status = st;
    cb.dataset.e2eId = `dict-status-option-${index + 1}`;
    boxes.push(cb);
    row.appendChild(cb);
    const labelText = document.createElement('span');
    labelText.textContent = st;
    row.appendChild(labelText);
    listWrap.appendChild(row);
  });
  body.appendChild(listWrap);
  const reason = document.createElement('div');
  reason.className = 'gb-tool-dict-status-reason';
  reason.dataset.e2eId = 'dict-status-selection-reason';
  reason.setAttribute('role', 'status');
  reason.setAttribute('aria-live', 'polite');
  const excluded = Number(summary?.withoutReading) || 0;
  reason.textContent = excluded > 0 ? `ルビのない${excluded}件は除外されます。` : '';
  body.appendChild(reason);
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'gb-btn gb-btn-sm';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.dataset.e2eId = 'dict-status-cancel';
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
  okBtn.textContent = '書き出し';
  okBtn.dataset.e2eId = 'dict-status-export';
  let closeValue = null;
  let settled = false;
  const initialFocus = boxes.find((box) => box.checked) || boxes[0] || cancelBtn;
  const modalApi = window.GBUI.createModal({
    id: 'tool-menu-dict-status-dialog',
    titleId: 'tool-menu-dict-status-title',
    title: '辞書に出力するステータス',
    body,
    footer: [cancelBtn, okBtn],
    variant: 'standard',
    extraClass: 'gb-tool-dict-status-modal',
    geometryKey: 'tool-menu-dict-status-dialog',
    minWidth: '0',
    initialFocus,
    returnFocus: () => trigger,
    closeLabel: '辞書の出力対象選択を閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
    onClose: () => {
      if (settled) return;
      settled = true;
      resolve(closeValue);
    },
  });
  const overlay = modalApi.overlay;
  overlay.classList.add('modal-overlay', 'gb-tool-dict-status-overlay');
  overlay.dataset.e2eId = 'dict-status-dialog-overlay';
  overlay._toolMenuDictStatusModalApi = modalApi;
  modalApi.modal.classList.add('modal');
  modalApi.modal.dataset.e2eId = 'dict-status-dialog';
  modalApi.modal.style.minHeight = '320px';
  modalApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'dict-status-header-close');
  modalApi.footer.dataset.e2eId = 'dict-status-footer';
  const updateState = () => {
    const selectedCount = boxes.filter((box) => box.checked).length;
    okBtn.disabled = selectedCount === 0;
    if (!selectedCount) reason.textContent = '出力するステータスを1つ以上選択してください。';
    else reason.textContent = excluded > 0 ? `ルビのない${excluded}件は除外されます。` : '';
  };
  const close = (result, reason) => {
    closeValue = result;
    modalApi.close(reason || 'programmatic');
  };
  boxes.forEach((box) => box.addEventListener('change', updateState));
  selectAllBtn.addEventListener('click', () => {
    boxes.forEach((box) => { box.checked = true; });
    updateState();
  });
  clearAllBtn.addEventListener('click', () => {
    boxes.forEach((box) => { box.checked = false; });
    updateState();
  });
  cancelBtn.addEventListener('click', () => close(null, 'cancel'));
  okBtn.addEventListener('click', () => {
    const allowed = new Set(boxes.filter(b => b.checked).map(b => b.dataset.status));
    if (!allowed.size) return;
    close(allowed, 'export');
  });
  updateState();
  modalApi.open();
  });
}
