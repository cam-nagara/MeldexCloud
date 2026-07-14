}

try { renderFavorites(); } catch (e) { console.warn('renderFavorites failed during startup', e); }
try { updateRecentItems(); } catch (e) { console.warn('updateRecentItems failed during startup', e); }

// ==============================
// スマートDB
// ==============================
/* DB: スマートDB → gb-database.js に移動 */

// ==============================
// ホームフォルダ
// ==============================
let _homeFolderPath = '';
let _homeFolderRenderSeq = 0;
let _homeFolderMetadataLoaded = false;
let _homeFolderLoadPromise = null;
const _HOME_FOLDER_BROWSE_RETRY_DELAYS = [250, 750];

function _homeFolderRenderDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _isHomeFolderRenderCurrent(renderSeq, homePath) {
  return renderSeq === _homeFolderRenderSeq && homePath === _homeFolderPath;
}

function _homeFolderSectionExpanded() {
  const body = document.getElementById('body-home');
  return !!body && !body.classList.contains('collapsed');
}

async function _browseHomeFolderChildren(homePath, renderSeq) {
  let lastError = null;
  const url = '/browse?path=' + encodeURIComponent(homePath) + '&root=' + encodeURIComponent(homePath) + '&all_files=true';
  for (let attempt = 0; attempt <= _HOME_FOLDER_BROWSE_RETRY_DELAYS.length; attempt++) {
    if (!_isHomeFolderRenderCurrent(renderSeq, homePath)) return null;
    try {
      return await apiFetch(url, { silentError: attempt < _HOME_FOLDER_BROWSE_RETRY_DELAYS.length });
    } catch (e) {
      lastError = e;
      const delay = _HOME_FOLDER_BROWSE_RETRY_DELAYS[attempt];
      if (delay == null) break;
      await _homeFolderRenderDelay(delay);
    }
  }
  throw lastError;
}

async function loadHomeFolder(options = {}) {
  if (_homeFolderLoadPromise) return _homeFolderLoadPromise;
  _homeFolderLoadPromise = (async () => {
    try {
      const res = await apiFetch('/home-folder');
      _homeFolderPath = res.path || '';
      _homeFolderMetadataLoaded = true;
      if (typeof setSystemLockedItems === 'function') {
        setSystemLockedItems(res.locked_paths || []);
      }
      if (typeof _primeFileLockCacheFromStorage === 'function') _primeFileLockCacheFromStorage();
      if (options.render === true || _homeFolderSectionExpanded()) {
        await renderHomeFolderTree({ force: options.force === true, reason: options.reason || 'home-folder-load', skipMetadataLoad: true });
      }
      if (typeof _scheduleFileLockRefreshForOutliner === 'function') _scheduleFileLockRefreshForOutliner();
    } catch {}
  })();
  try {
    return await _homeFolderLoadPromise;
  } finally {
    _homeFolderLoadPromise = null;
  }
}

async function renderHomeFolderTree(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const container = document.getElementById('body-home');
  if (!container) return;
  const renderSeq = ++_homeFolderRenderSeq;
  const homePath = _homeFolderPath;
  if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(container);
  container.innerHTML = '';
  if (!opts.force && !_homeFolderSectionExpanded()) {
    container.dataset.loaded = 'false';
    return { skipped: true, reason: 'collapsed' };
  }
  if (!homePath && !_homeFolderMetadataLoaded && opts.skipMetadataLoad !== true) {
    await loadHomeFolder({ render: true, force: opts.force === true, reason: opts.reason || 'render-home-folder' });
    return { rendered: !!_homeFolderPath };
  }
  if (!homePath) return;
  container.innerHTML = '<div style="padding:4px 12px;font-size:11px;color:var(--fg2);">読み込み中...</div>';
  try {
    if (typeof _primeFileLockCacheFromStorage === 'function') _primeFileLockCacheFromStorage();
    const children = await _browseHomeFolderChildren(homePath, renderSeq);
    if (!_isHomeFolderRenderCurrent(renderSeq, homePath)) return;
    if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(container);
    container.innerHTML = '';
    registerFileTypes(children);
    if (typeof _registerFileIds === 'function') _registerFileIds(children);
    if (typeof _registerOutlinerConflictPaths === 'function') _registerOutlinerConflictPaths(children);
    children.forEach(child => {
      container.appendChild(createTreeNodeFromBrowse(child, homePath));
    });
    if (typeof applyGlobalFilter === 'function') applyGlobalFilter();
    if (typeof _scheduleFileLockRefreshForOutliner === 'function') _scheduleFileLockRefreshForOutliner();
    container.dataset.loaded = 'true';
  } catch {
    if (!_isHomeFolderRenderCurrent(renderSeq, homePath)) return;
    if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(container);
    container.innerHTML = '<div style="padding:4px 12px;font-size:11px;color:var(--fg2);">読み込みエラー</div>';
    container.dataset.loaded = 'false';
  }
}

loadHomeFolder();

// ホームフォルダへのドロップ対応
(function() {
  const homeBody = document.getElementById('body-home');
  if (!homeBody) return;
  homeBody.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedNode) return;
    e.dataTransfer.dropEffect = 'move';
    homeBody.style.outline = '2px solid var(--accent)';
  });
  homeBody.addEventListener('dragleave', () => { homeBody.style.outline = ''; });
  homeBody.addEventListener('drop', async (e) => {
    e.preventDefault();
    homeBody.style.outline = '';
    if (!draggedNode || !_homeFolderPath) return;
    const nodes = (draggedNodes || [draggedNode]).filter(Boolean);
    let movedCount = 0;
    let skippedCount = 0;
    for (const n of nodes) {
      const dragData = n._nodeData;
      if (!dragData || !dragData.path) { skippedCount++; continue; }
      if (typeof isItemLocked === 'function' && isItemLocked(dragData.path)) { skippedCount++; showStatus('編集ロック中の項目は移動できません', true); continue; }
      if (dragData.linked) { skippedCount++; showStatus('リンクファイルは移動できません'); continue; }
      try {
        const oldPath = dragData.path;
        const _res = await apiPost('/outliner/move', { path: oldPath, dest_folder: _homeFolderPath });
        if (_res?.new_path && typeof renameAppPathReferences === 'function') {
          renameAppPathReferences(oldPath, _res.new_path, { label: _res.new_name || dragData.name, fileId: _res.file_id, type: dragData.type || 'page' });
        }
        if (typeof handleRelocateResponse === 'function') handleRelocateResponse(_res);
        movedCount++;
      } catch { skippedCount++; showStatus('移動に失敗', true); }
    }
    await renderHomeFolderTree({ force: true, reason: 'home-drop' });
    await loadOutliner();
    const statusText = skippedCount
      ? movedCount + ' 件をホームフォルダに移動しました。' + skippedCount + ' 件は移動できませんでした'
      : movedCount + ' 件をホームフォルダに移動しました';
    showStatus(statusText, skippedCount > 0);
  });
})();

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const resize = document.getElementById('sidebar-resize');
  const btn = document.getElementById('btn-sidebar-toggle');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.classList.remove('open');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.style.setProperty('display', 'none', 'important');
    }
  } else {
    sidebar.style.display = 'none';
    if (resize) resize.style.display = 'none';
    if (btn) btn.classList.remove('active');
  }
}
function toggleSidebar(withFolderView) {
  const sidebar = document.getElementById('sidebar');
  const resize = document.getElementById('sidebar-resize');
  const btn = document.getElementById('btn-sidebar-toggle');
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    sidebar.style.display = '';
    if (resize) resize.style.display = 'none';
    const opening = !sidebar.classList.contains('open');
    const backdrop = document.getElementById('sidebar-backdrop');
    sidebar.classList.toggle('open', opening);
    if (backdrop) {
      backdrop.classList.toggle('open', opening);
      backdrop.style.setProperty('display', opening ? 'block' : 'none', 'important');
    }
    if (opening && withFolderView) showFolderViewForSidebar();
  } else {
    if (sidebar.style.display === 'none') {
      sidebar.style.display = '';
      if (resize) resize.style.display = '';
      if (btn) btn.classList.add('active');
      if (withFolderView) showFolderViewForSidebar();
    } else {
      sidebar.style.display = 'none';
      if (resize) resize.style.display = 'none';
      if (btn) btn.classList.remove('active');
    }
  }
}
// サイドバー表示時にメインパネルをフォルダビューに切り替える
function showFolderViewForSidebar() {
  // すでにコンテンツを表示中（ページ/シナリオ/DB等）ならそのまま維持
  if (state.view && state.view !== 'welcome') return;
  const _expOpts = { fromExplorer: true };
  // フォルダビューを表示: 前回のフォルダがあればそれを、なければルートフォルダを開く
  if (_folderPath) {
    openFolder(_folderPath.split('/').pop(), _folderPath, _expOpts);
  } else {
    // ツリーの最初のルートフォルダを開く
    const firstRoot = document.querySelector('#outliner-tree > .tree-node');
    if (firstRoot && firstRoot._nodeData) {
      openFolder(firstRoot._nodeData.name, firstRoot._nodeData.path, _expOpts);
    }
  }
}
// 起動時のサイドバー状態を反映
document.getElementById('btn-sidebar-toggle')?.classList.add('active');
// ブラウザ自動補完をクリア
document.getElementById('sidebar-search-input').value = '';

function _removeAppBarDropdowns(selector) {
  const menus = document.querySelectorAll(selector || '.ab-dropdown');
  menus.forEach((menu) => {
    if (typeof menu._cleanupActivityMenu === 'function') menu._cleanupActivityMenu();
    if (typeof menu._cleanupPanelMenu === 'function') menu._cleanupPanelMenu();
    menu.remove();
  });
}

function _isAppBarDropdownTarget(target, rootMenu, button) {
  if (!target) return false;
  if (rootMenu?.contains?.(target)) return true;
  if (button?.contains?.(target)) return true;
  return !!target.closest?.('.ab-dropdown.ab-sub-menu');
}

function _resolveAppBarButton(event) {
  const button = event?.target?.closest?.('button');
  if (button) return button;
  return null;
}

// アクティビティバー: ハンバーガーメニュー
function toggleActivityMenu(e) {
  const closeMenu = () => {
    _removeAppBarDropdowns();
  };
  // 既存メニューがあれば閉じる
  const existing = document.querySelector('.ab-dropdown.ab-activity-menu');
  if (existing) { closeMenu(); return; }
  _removeAppBarDropdowns();

  const menu = document.createElement('div');
  menu.className = 'ab-dropdown ab-activity-menu';
  menu.style.cssText = 'position:fixed;z-index:999;';

  function addItem(label, icon, fn) {
    const item = document.createElement('div');
    item.className = 'ab-dropdown-item';
    item.innerHTML = lucide(icon, 16) + ' ' + label;
    item.addEventListener('click', () => { closeMenu(); fn(); });
