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
        { label: 'Markdownファイルを開く...', action: () => { if (typeof importMarkdownFile === 'function') importMarkdownFile(); }, disabled: !hasFile },
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
        { label: '旧シナリオからインポート...', action: () => showScriptNoteImportModal() },
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
        { label: 'CSVからインポート...', action: () => { if (typeof importCsvToDb === 'function') importCsvToDb(); }, disabled: !hasFile },
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
      export: [
        { label: '公開を更新', action: () => { if (typeof MeldexExportHtml !== 'undefined') MeldexExportHtml.publishCurrentView('calendar'); }, disabled: !hasFile },
        { label: '画像（PNG）として保存...', action: () => { if (typeof MeldexExportImage !== 'undefined') MeldexExportImage.exportCurrentView('calendar'); }, disabled: !hasFile },
        { separator: true },
        { label: '勤怠CSVとして保存...', action: () => { if (typeof exportAttendanceCsvFromMenu === 'function') exportAttendanceCsvFromMenu(); } },
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
      { label: '開く...', action: () => showScriptNoteOpenModal() },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
    database: [
      { label: 'プロパティ管理', action: () => { if (typeof showColVisibilityModal === 'function') showColVisibilityModal(); }, disabled: !hasFile },
      { label: 'シート横断検索', action: () => { if (typeof showDbSearchModal === 'function') showDbSearchModal(); }, disabled: !hasFile },
      { label: '整合性検証', action: () => { if (typeof onValidateClick === 'function') onValidateClick(); }, disabled: !hasFile },
      { label: '検証ルール管理', action: () => { if (typeof showValidationRulesModal === 'function') showValidationRulesModal(state.currentDbPath || currentPath); }, disabled: !hasFile },
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
      { separator: true },
      { label: '公開設定...', action: () => { if (typeof showPublishSettingsModal === 'function') showPublishSettingsModal(); }, disabled: !hasFile },
    ],
    calendar: [
      { label: '新規イベント', action: () => { if (typeof addCalendarEvent === 'function') addCalendarEvent(); } },
      { separator: true },
      { label: '同期設定...', action: () => { if (typeof showCalSyncModal === 'function') showCalSyncModal(); } },
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
    { label: '別名で保存...', action: () => _showSaveAsModal(currentPath) },
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

// 別名で保存モーダル
async function _showSaveAsModal(srcPath) {
  if (!srcPath) return;
  const srcName = srcPath.includes('/') ? srcPath.substring(srcPath.lastIndexOf('/') + 1) : srcPath;
  const srcFolder = srcPath.includes('/') ? srcPath.substring(0, srcPath.lastIndexOf('/')) : '';
  // 拡張子を除いた名前
  const baseName = srcName.includes('.') ? srcName.substring(0, srcName.lastIndexOf('.')) : srcName;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:420px;max-width:520px;">
    <h3>${lucide('copy', 18)} 別名で保存</h3>
    <div class="field"><label>新しい名前</label><input id="saveas-name" type="text" value="${esc(baseName)}" style="width:100%;"></div>
    <div class="field"><label>保存先フォルダ</label>
      <div id="saveas-folder-display" style="padding:6px 8px;background:var(--bg2);border:1px solid var(--border);border-radius:4px;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:4px;">
        ${lucide('folder', 14)} <span id="saveas-folder-label">${esc(srcFolder || '(ルート)')}</span>
        <span style="margin-left:auto;opacity:0.5;">${lucide('chevronDown', 12)}</span>
      </div>
      <div id="saveas-folder-tree" style="display:none;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;margin-top:4px;background:var(--bg);"></div>
    </div>
    <div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
      <button id="saveas-cancel" class="btn">キャンセル</button>
      <button id="saveas-ok" class="btn btn-primary">保存</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector('#saveas-name');
  const folderDisplay = overlay.querySelector('#saveas-folder-display');
  const folderTree = overlay.querySelector('#saveas-folder-tree');
  const folderLabel = overlay.querySelector('#saveas-folder-label');
  let selectedFolder = srcFolder;

  nameInput.focus();
  nameInput.select();

  // フォルダツリー表示/非表示
  folderDisplay.addEventListener('click', async () => {
    if (folderTree.style.display === 'none') {
      folderTree.style.display = '';
      await _loadSaveAsFolderTree(folderTree, selectedFolder, (path, label) => {
        selectedFolder = path;
        folderLabel.textContent = label || '(ルート)';
        folderTree.style.display = 'none';
      });
    } else {
      folderTree.style.display = 'none';
    }
  });

  // キャンセル
  overlay.querySelector('#saveas-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // 保存実行
  overlay.querySelector('#saveas-ok').addEventListener('click', async () => {
    const newName = nameInput.value.trim();
    if (!newName) { showStatus('名前を入力してください'); return; }
    try {
      const res = await apiPost('/outliner/save-as', {
        path: srcPath,
        new_name: newName,
        dest_folder: selectedFolder,
      });
      overlay.remove();
      showStatus('「' + (res.new_name || newName) + '」に保存しました', false, { showSaveDialog: true });
      if (typeof loadOutliner === 'function') loadOutliner();
    } catch (e) {
      showStatus('保存に失敗: ' + (e.message || e), true);
    }
  });

  // Enter で保存
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') overlay.querySelector('#saveas-ok').click();
    if (e.key === 'Escape') overlay.remove();
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
      const toggle = document.createElement('span');
      toggle.style.cssText = 'cursor:pointer;opacity:0.5;flex-shrink:0;';
      toggle.innerHTML = lucide('chevronRight', 10);
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
          toggle.innerHTML = lucide('chevronRight', 10);
          toggle.dataset.expanded = '0';
        } else {
          await _expandSaveAsFolder(container, item.path, currentFolder, onSelect, depth + 1);
          toggle.innerHTML = lucide('chevronDown', 10);
          toggle.dataset.expanded = '1';
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
  row.dataset.folderPath = path;
  row.dataset.depth = depth;
  if (isSelected) row.dataset.selected = '1';
  row.style.cssText = 'padding:4px 8px;padding-left:' + (8 + depth * 16) + 'px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;border-radius:3px;' +
    (isSelected ? 'background:var(--accent);color:var(--ui-fg-strong);' : '');
  row.innerHTML += lucide(icon || 'folder', 14) + ' ' + esc(name);
  row.addEventListener('click', () => {
    // 選択状態を更新
    row.closest('#saveas-folder-tree').querySelectorAll('[data-folder-path]').forEach(d => {
      delete d.dataset.selected; d.style.background = ''; d.style.color = '';
    });
    row.dataset.selected = '1';
    row.style.background = 'var(--accent)'; row.style.color = 'var(--ui-fg-strong)';
    onSelect(path, name || '(ルート)');
  });
  row.addEventListener('mouseenter', () => { if (!row.dataset.selected) row.style.background = 'var(--bg3)'; });
  row.addEventListener('mouseleave', () => { if (!row.dataset.selected) row.style.background = ''; });
  return row;
}
