function _folderCurrentContextItem() {
  if (!_folderPath) return null;
  const title = document.getElementById('folder-title')?.textContent || _folderPath.split(/[\\/]/).pop() || _folderPath;
  return { name: title, path: _folderPath, type: 'folder' };
}

function _folderContextCreateParent(item) {
  if ((item?.type === 'folder' || item?.type === 'database') && item.path) return item.path;
  return _folderPath || '';
}

function _folderOpenType(item) {
  if (typeof _normalizeOpenTypeForNav === 'function') return _normalizeOpenTypeForNav(item?.type);
  if (item?.type === 'database') return 'pivot';
  if (item?.type === 'scenario') return 'scriptnote';
  return item?.type || 'page';
}

function _folderRefreshCurrentFolder() {
  if (_folderPath) return openFolder(_folderPath.split(/[\\/]/).pop() || _folderPath, _folderPath);
  return Promise.resolve();
}

function _folderCopyMeldexLink(item) {
  if (!item?.path) return;
  if (typeof MeldexBroadcast === 'undefined') {
    showStatus('リンクをコピーできませんでした', true);
    return;
  }
  const name = item.name || item.path.split(/[\\/]/).pop() || item.path;
  MeldexBroadcast.copyMeldexLink(name, item.path, item.type).then(ok => {
    if (ok) showStatus('リンクをコピーしました');
    else showStatus('リンクをコピーできませんでした', true);
  }).catch(() => showStatus('リンクをコピーできませんでした', true));
}

function _folderOpenItemInNewTab(item) {
  if (!item?.path) return;
  const openType = _folderOpenType(item);
  if (typeof _openInNewTab === 'function') _openInNewTab(item.name || '', item.path, openType);
}

function _folderOpenItemInNewWindow(item) {
  if (!item?.path) return;
  const openType = _folderOpenType(item);
  const openItem = { name: item.name || '', path: item.path, type: openType };
  const openUrl = typeof buildSingleTabWindowUrl === 'function'
    ? buildSingleTabWindowUrl(openItem)
    : (window.MeldexResourceUrl?.appEntry
      ? window.MeldexResourceUrl.appEntry({ single: 1, open: openType, path: item.path, label: item.name || '' })
      : '/Meldex.html?single=1&open=' + encodeURIComponent(openType) + '&path=' + encodeURIComponent(item.path) + '&label=' + encodeURIComponent(item.name || ''));
  if (typeof _open_app_window_js === 'function') _open_app_window_js(openUrl);
  else window.open(openUrl, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
}

function _folderApplyItemColor(item, color) {
  if (!item?.path || typeof setNodeColor !== 'function') return;
  const colorSettingsKey = typeof NODE_COLORS_KEY !== 'undefined' ? NODE_COLORS_KEY : 'outliner-node-colors';
  const before = typeof captureOutlinerSettingsHistory === 'function' ? captureOutlinerSettingsHistory([colorSettingsKey]) : null;
  setNodeColor(item.path, color || null);
  if (typeof pushOutlinerSettingsHistory === 'function') {
    pushOutlinerSettingsHistory(
      color ? 'フォルダツリー: 色設定' : 'フォルダツリー: 色リセット',
      before,
      item.path,
      [colorSettingsKey]
    );
  }
  if (typeof loadOutliner === 'function') loadOutliner();
  if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
  showStatus(color ? '色を設定しました' : '色をリセットしました');
}

function _folderExportItems(item) {
  const items = [];
  if (!item?.path) return items;
  const baseName = (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.guessNameFromPath === 'function')
    ? MeldexExportSave.guessNameFromPath(item.path, item.name || '無題')
    : (item.name || '無題');
  const stem = String(baseName || '無題').replace(/\.[^.]+$/, '') || '無題';
  const push = (label, url, extension, filetypes) => items.push({ label, url, filename: stem + extension, extension, filetypes });
  if (item.type === 'database') {
    push('CSV', '/export/db?path=' + encodeURIComponent(item.path) + '&format=csv', '.csv', [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']]);
    push('HTML', '/export/db?path=' + encodeURIComponent(item.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
    push('Excel', '/export/db?path=' + encodeURIComponent(item.path) + '&format=xlsx', '.xlsx', [['Excelファイル', '*.xlsx'], ['すべてのファイル', '*.*']]);
  } else if (item.type === 'board') {
    push('HTML', '/export/canvas?path=' + encodeURIComponent(item.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
    push('SVG画像', '/export/canvas?path=' + encodeURIComponent(item.path) + '&format=svg', '.svg', [['SVGファイル', '*.svg'], ['すべてのファイル', '*.*']]);
    push('Markdown', '/export/canvas?path=' + encodeURIComponent(item.path) + '&format=md', '.md', [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']]);
  } else if (item.type === 'page') {
    push('テキスト', '/export/note?path=' + encodeURIComponent(item.path) + '&format=txt', '.txt', [['テキストファイル', '*.txt'], ['すべてのファイル', '*.*']]);
    push('Markdown', '/export/note?path=' + encodeURIComponent(item.path) + '&format=md', '.md', [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']]);
    push('HTML', '/export/note?path=' + encodeURIComponent(item.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
    push('Word', '/export/note?path=' + encodeURIComponent(item.path) + '&format=docx', '.docx', [['Wordファイル', '*.docx'], ['すべてのファイル', '*.*']]);
  }
  return items;
}

function _installFolderBlankContextMenu(container) {
  if (!container || container.dataset.blankContextMenuBound === '1') return;
  container.dataset.blankContextMenuBound = '1';
  container.addEventListener('contextmenu', (e) => {
    if (e.target.closest?.('.fv-item')) return;
    if (e.target.closest?.('.gb-context-menu')) return;
    e.preventDefault();
    const item = _folderCurrentContextItem();
    if (item) showFolderItemContextMenu(e, item, { blankTarget: true });
  });
}
