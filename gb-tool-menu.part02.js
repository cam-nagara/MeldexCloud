// ツール別メニュー項目
function buildToolMenuItems(toolType) {
  const currentPath = getCurrentFilePath();
  const hasFile = !!currentPath;
  const newItemType = {
    page: 'page', scriptnote: 'scriptnote', database: 'database',
    board: 'board', calendar: 'calendar', csv: 'page',
    'smart-db': 'smart-db', folder: 'page'
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
        { label: '旧シナリオからインポート...', action: context => showScriptNoteImportModal({ trigger: context?.trigger }) },
      ],
      export: [
        { label: 'シナリオ形式として保存...', action: () => { if (typeof promptSaveCurrentScriptNoteAs === 'function') promptSaveCurrentScriptNoteAs(); }, disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('scriptnote'); }, disabled: !hasFile },
        { separator: true },
        { label: 'クリスタ送信', action: () => { if (typeof sn2CopyForClipStudio === 'function') sn2CopyForClipStudio(); }, disabled: !hasFile },
      ],
    },
    database: {
      import: [
        { label: 'CSVからインポート...', action: () => {
          if (typeof importCsvToDb === 'function') importCsvToDb();
          else _showUnavailableToolMenuAction('CSVからインポート');
        }, disabled: !hasFile },
      ],
      export: [
        { label: 'CSVとして保存...', action: () => _exportFile('db', 'csv'), disabled: !hasFile },
        { label: 'Excelとして保存...', action: () => _exportFile('db', 'xlsx'), disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('database'); }, disabled: !hasFile },
        { separator: true },
        { label: '辞書ファイルを出力', action: () => _exportDictFile() },
      ],
    },
    board: {
      export: [
        { label: 'PNG画像として保存', action: () => { if (typeof bdExportImage === 'function') bdExportImage(); }, disabled: !hasFile },
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
        { label: '勤怠CSVとして保存...', action: () => { if (typeof exportAttendanceCsvFromMenu === 'function') exportAttendanceCsvFromMenu(); } },
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
    'smart-db': {
      export: [
        { label: 'CSVとして保存...', action: () => _exportFile('db', 'csv'), disabled: !hasFile },
        { label: '公開を更新', action: () => { if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('smart-db'); }, disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('smart-db'); }, disabled: !hasFile },
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

  // --- ツール固有の項目（サブメニュー以外） ---
  const specific = {
    page: [
      { label: 'オプションを表示', action: () => { if (typeof toggleOptionPanel === 'function') toggleOptionPanel(); else if (typeof toggleDetailPanel === 'function') toggleDetailPanel(); }, disabled: !hasFile },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
      { label: '公開を更新', action: () => { if (typeof publishCurrentPageView === 'function') publishCurrentPageView(); else if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('page'); }, disabled: !hasFile },
    ],
    scriptnote: [
      { label: '開く...', action: context => showScriptNoteOpenModal('open', { trigger: context?.trigger }) },
    ],
    database: [
      { label: '列の表示と順序', action: () => { if (typeof showColumnDisplayOrderModal === 'function') showColumnDisplayOrderModal(); else if (typeof showColVisibilityModal === 'function') showColVisibilityModal(); }, disabled: !hasFile },
      { label: 'シート横断検索', action: () => { if (typeof showDbSearchModal === 'function') showDbSearchModal(); }, disabled: !hasFile },
      { label: '整合性検証', action: () => { if (typeof onValidateClick === 'function') onValidateClick(); }, disabled: !hasFile },
      { label: '検証ルール管理', action: () => { if (typeof showValidationRulesModal === 'function') showValidationRulesModal(state.currentDbPath || currentPath); }, disabled: !hasFile },
      { label: 'アーカイブ管理...', action: () => { if (typeof showSheetArchiveModal === 'function') showSheetArchiveModal(state.currentDbPath || currentPath); }, disabled: !hasFile },
      { separator: true },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
    board: [
      { label: '新規リンクカード: ノート', action: () => {
        if (typeof bdCreateLinkedFileCardAt !== 'function') { showStatus('リンクカード追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdCreateLinkedFileCardAt(pos.x, pos.y, 'page');
      } },
      { label: '新規リンクカード: シート', action: () => {
        if (typeof bdCreateLinkedFileCardAt !== 'function') { showStatus('リンクカード追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdCreateLinkedFileCardAt(pos.x, pos.y, 'database');
      } },
      { label: '新規リンクカード: ボード', action: () => {
        if (typeof bdCreateLinkedFileCardAt !== 'function') { showStatus('リンクカード追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdCreateLinkedFileCardAt(pos.x, pos.y, 'board');
      } },
      { label: '既存ファイルへのリンクカード...', action: () => {
        if (typeof bdPromptAddLinkCardAt !== 'function') { showStatus('リンクカード追加機能を読み込めませんでした', true); return; }
        const pos = typeof bdGetCanvasCenterWorld === 'function' ? bdGetCanvasCenterWorld() : { x: 120, y: 120 };
        bdPromptAddLinkCardAt(pos.x, pos.y);
      } },
      { label: 'シート / スマートシートから一括読込...', action: () => {
        if (typeof bdOpenBulkLinkImport === 'function') bdOpenBulkLinkImport();
      }, disabled: !hasFile },
    ],
    calendar: [
      { label: '新規イベント', action: () => _openCalendarEventFromMenu() },
      { separator: true },
      { label: '制作管理パネル...', action: () => { if (typeof openProductionManagementPanel === 'function') openProductionManagementPanel(); } },
      { separator: true },
      { label: '同期設定...', action: () => _openCalendarSyncFromMenu() },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
    csv: [
      { label: '行を追加', action: () => { if (typeof addCsvRow === 'function') addCsvRow(); }, disabled: !hasFile },
      { label: '列を追加', action: () => { if (typeof addCsvColumn === 'function') addCsvColumn(); }, disabled: !hasFile },
      { separator: true },
      { label: 'シートに変換...', action: () => { if (typeof convertCsvToDb === 'function') convertCsvToDb(); }, disabled: !hasFile },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
    folder: [
      { label: '現在のフォルダを開く', action: () => { const path = getCurrentFilePath(); if (path && typeof openNative === 'function') openNative(path); }, disabled: !hasFile },
      { label: 'スライドショー', action: () => { if (typeof openFolderSlideshow === 'function') openFolderSlideshow(); }, disabled: !hasFile },
      { separator: true },
      { label: '表示設定', action: () => { if (typeof showFolderDisplaySettings === 'function') showFolderDisplaySettings(); } },
      { label: 'オプションを表示', action: () => { if (typeof showFolderPanelSettings === 'function') showFolderPanelSettings(); } },
    ],
    'smart-db': [
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
  };

  const folderCreateItems = [
    { label: 'フォルダ', icon: 'folder', action: () => _createFolderViewItem('folder') },
    { label: 'ノート', icon: 'page', action: () => _createFolderViewItem('page') },
    { label: 'シナリオ', icon: 'bookOpenText', action: () => _createFolderViewItem('scriptnote') },
    { label: 'シート', icon: 'db', action: () => _createFolderViewItem('database') },
    { label: 'ボード', icon: 'presentation', action: () => _createFolderViewItem('board') },
    { label: 'カレンダー', icon: 'calendar', action: () => _createFolderViewItem('calendar') },
    { label: 'スマートシート', icon: 'databaseSearch', action: () => _createFolderViewItem('smart-db') },
  ];
  const common = isFolderTool
    ? [{ label: '新規作成', icon: 'plus', submenu: folderCreateItems }]
    : [
      { label: '新規作成', action: () => { if (typeof showAddOutlinerItem === 'function') showAddOutlinerItem(newItemType[toolType] || 'page'); } },
    ];

  const fileActions = hasFile && !isFolderTool ? [
    { separator: true },
    { label: '別名で保存...', action: context => _showSaveAsModal(currentPath, { trigger: context?.trigger }) },
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
    ...fileActions,
    ...tailPre,
    { separator: true },
    recentItem,
    ...importExportBlock,
    ...tailClose,
  ];
}

function _showUnavailableToolMenuAction(label) {
  if (typeof showStatus === 'function') showStatus(`${label}を実行できませんでした`, true);
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
    comp._openEventInPanel(null);
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

function _restoreToolMenuDialogFocus(trigger) {
  if (!trigger?.isConnected || typeof trigger.focus !== 'function') return;
  try { trigger.focus({ preventScroll: true }); } catch { try { trigger.focus(); } catch {} }
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

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay gb-tool-save-as-overlay';
  overlay.dataset.e2eId = 'tool-menu-save-as-overlay';
  overlay.innerHTML = `<div class="modal gb-tool-save-as-modal" role="dialog" aria-modal="true" aria-labelledby="saveas-title" tabindex="-1" data-e2e-id="tool-menu-save-as-dialog">
    <div class="gb-modal-header gb-tool-save-as-header" data-modal-header>
      <h3 id="saveas-title" class="gb-modal-title gb-tool-save-as-title"><span class="gb-tool-save-as-title-icon" aria-hidden="true">${_toolMenuDialogIcon('copy', 16)}</span><span>別名で保存</span></h3>
      <button type="button" id="saveas-close" class="gb-modal-close gb-tool-save-as-close" aria-label="別名で保存を閉じる" data-e2e-id="tool-menu-save-as-close">${_toolMenuDialogIcon('x', 14)}</button>
    </div>
    <div class="gb-modal-body gb-tool-save-as-body">
      <div class="field gb-tool-save-as-field">
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
    </div>
    <div class="gb-modal-footer gb-tool-save-as-footer" data-modal-footer>
      <button type="button" id="saveas-cancel" class="gb-btn gb-btn-sm">キャンセル</button>
      <button type="button" id="saveas-ok" class="gb-btn gb-btn-sm gb-btn-primary">保存</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  window.GBModalShell?.enhanceOverlay?.(overlay);

  const nameInput = overlay.querySelector('#saveas-name');
  const folderDisplay = overlay.querySelector('#saveas-folder-display');
  const folderTree = overlay.querySelector('#saveas-folder-tree');
  const folderLabel = overlay.querySelector('#saveas-folder-label');
  const cancelButton = overlay.querySelector('#saveas-cancel');
  const closeButton = overlay.querySelector('#saveas-close');
  const saveButton = overlay.querySelector('#saveas-ok');
  let selectedFolder = srcFolder;
  let saving = false;
  let closed = false;

  const closeDialog = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    overlay.remove();
    if (restoreFocus) _restoreToolMenuDialogFocus(trigger);
  };

  requestAnimationFrame(() => {
    nameInput.focus();
    nameInput.select();
  });

  // フォルダツリー表示/非表示
  folderDisplay.addEventListener('click', async () => {
    if (window.GBFolderPicker?.pickFolder) {
      const selected = await window.GBFolderPicker.pickFolder({
        title: '保存先フォルダを選択',
        initialPath: selectedFolder,
      });
      if (selected?.path !== undefined) {
        selectedFolder = selected.path;
        folderLabel.textContent = selected.label || selected.name || selected.path || '(ルート)';
        _setSaveAsFolderTreeOpen(folderTree, folderDisplay, false);
      }
      return;
    }
    if (folderTree.hidden) {
      _setSaveAsFolderTreeOpen(folderTree, folderDisplay, true);
      await _loadSaveAsFolderTree(folderTree, selectedFolder, (path, label) => {
        selectedFolder = path;
        folderLabel.textContent = label || '(ルート)';
        _setSaveAsFolderTreeOpen(folderTree, folderDisplay, false);
      });
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
  closeButton.addEventListener('click', () => closeDialog(true));
  cancelButton.addEventListener('click', () => closeDialog(true));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(true); });
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog(true);
    }
  }, true);

  // 保存実行
  saveButton.addEventListener('click', async () => {
    if (saving) return;
    const newName = nameInput.value.trim();
    if (!newName) { showStatus('名前を入力してください'); return; }
    saving = true;
    saveButton.disabled = true;
    try {
      const res = await apiPost('/outliner/save-as', {
        path: srcPath,
        new_name: newName,
        dest_folder: selectedFolder,
      });
      closeDialog(true);
      showStatus('「' + (res.new_name || newName) + '」に保存しました', false, { showSaveDialog: true });
      if (typeof loadOutliner === 'function') loadOutliner();
    } catch (e) {
      showStatus('保存に失敗: ' + (e.message || e), true);
      saving = false;
      saveButton.disabled = false;
    }
  });

  // Enter で保存
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveButton.click();
  });
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
    const parentRow = container.querySelector('[data-folder-path="' + CSS.escape(parentPath) + '"]');
    let insertAfter = parentRow;
    for (const item of folders) {
      if (container.querySelector('[data-folder-path="' + CSS.escape(item.path) + '"]')) continue;
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
