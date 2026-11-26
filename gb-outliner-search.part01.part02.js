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
// 起動直後は保存先の確認や背景処理と重なって一覧の取得が一時的に失敗することがある（2026-11-21 報告:
// 起動時にホームフォルダが「読み込みエラー」のまま）。以前は1秒で3回試して諦めていたため、間隔を広げて
// 約8秒まで試し、それでも失敗した時は理由と「再試行」を出し、15秒後にもう一度だけ自動で試す。
const _HOME_FOLDER_BROWSE_RETRY_DELAYS = [250, 750, 2000, 5000];
const _HOME_FOLDER_AUTO_RETRY_MS = 15000;
let _homeFolderAutoRetryTimer = null;

function _homeFolderErrorReason(error) {
  const detail = error?.detail && typeof error.detail === 'object' ? error.detail : null;
  return String(error?.userMessage || detail?.message || (typeof error?.detail === 'string' ? error.detail : '') || error?.message || '').trim();
}

function _logHomeFolderFailure(stage, error) {
  try {
    console.warn('[home-folder] ' + stage + ' failed', {
      status: error?.status ?? null,
      code: error?.detail?.code || error?.code || '',
      name: error?.name || '',
      message: _homeFolderErrorReason(error),
    });
  } catch (_) { /* 記録の失敗で表示を止めない */ }
}

function _renderHomeFolderError(container, error) {
  if (!container) return;
  container.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'home-folder-load-error';
  box.style.cssText = 'padding:4px 12px;font-size:11px;color:var(--fg2);display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;';
  const label = document.createElement('span');
  label.textContent = '読み込みエラー';
  const reason = _homeFolderErrorReason(error);
  if (reason) label.title = reason;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn-link home-folder-load-retry';
  retry.textContent = '再試行';
  retry.dataset.e2eId = 'home-folder-load-retry';
  retry.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    renderHomeFolderTree({ force: true, reason: 'home-folder-retry' });
  });
  box.append(label, retry);
  container.appendChild(box);
}

function _scheduleHomeFolderAutoRetry() {
  if (_homeFolderAutoRetryTimer) return;
  _homeFolderAutoRetryTimer = setTimeout(() => {
    _homeFolderAutoRetryTimer = null;
    const container = document.getElementById('body-home');
    if (!container || container.dataset.loaded === 'true' || !_homeFolderSectionExpanded()) return;
    if (!container.querySelector('.home-folder-load-error')) return;
    renderHomeFolderTree({ force: true, reason: 'home-folder-auto-retry', noAutoRetry: true });
  }, _HOME_FOLDER_AUTO_RETRY_MS);
}

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

async function _waitForHomeFolderTreeParts(timeoutMs = 15000) {
  const ready = () => typeof createTreeNodeFromBrowse === 'function' && typeof _pathToFileId === 'function'
    && typeof registerFileTypes === 'function';
  const started = Date.now();
  while (!ready() && Date.now() - started < timeoutMs) await _homeFolderRenderDelay(100);
}

async function _browseHomeFolderChildren(homePath, renderSeq) {
  let lastError = null;
  const sortCfg = getSortForFolder(homePath);
  const serverSort = ['name', 'modified', 'created'].includes(sortCfg.sort) ? sortCfg.sort : 'name';
  const url = '/browse?path=' + encodeURIComponent(homePath) + '&root=' + encodeURIComponent(homePath)
    + '&all_files=true&form_hierarchy=true&sort=' + serverSort + '&order=' + sortCfg.order
    + (!['name', 'manual'].includes(sortCfg.sort) ? '&detail=true' : '');
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
    } catch (error) {
      _logHomeFolderFailure('home-folder metadata', error);
      if (!_homeFolderMetadataLoaded && (options.render === true || _homeFolderSectionExpanded())) {
        _renderHomeFolderError(document.getElementById('body-home'), error);
        if (!options.noAutoRetry) _scheduleHomeFolderAutoRetry();
      }
    }
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
    await loadHomeFolder({ render: true, force: opts.force === true, reason: opts.reason || 'render-home-folder', noAutoRetry: opts.noAutoRetry === true });
    return { rendered: !!_homeFolderPath };
  }
  if (!homePath) return;
  container.innerHTML = '<div style="padding:4px 12px;font-size:11px;color:var(--fg2);">読み込み中...</div>';
  try {
    // 起動直後は、一覧がツリーの部品（後から読み込まれる本体のスクリプトの関数）より先に届くことがある。
    // そのまま組み立てると「読み込みエラー」になっていたため、部品がそろうまで待つ（2026-11-21）。
    await _waitForHomeFolderTreeParts();
    if (!_isHomeFolderRenderCurrent(renderSeq, homePath)) return;
    if (typeof _primeFileLockCacheFromStorage === 'function') _primeFileLockCacheFromStorage();
    const children = await _browseHomeFolderChildren(homePath, renderSeq);
    if (!_isHomeFolderRenderCurrent(renderSeq, homePath)) return;
    if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(container);
    container.innerHTML = '';
    registerFileTypes(children);
    if (typeof _registerFileIds === 'function') _registerFileIds(children);
    if (typeof _registerOutlinerConflictPaths === 'function') _registerOutlinerConflictPaths(children);
    const sortCfg = getSortForFolder(homePath);
    const sortedChildren = sortCfg.sort === 'manual' ? _sortItemsByManualOrder(children, homePath)
      : [...children].sort((a, b) => compareItemsForFolderSort(a, b, sortCfg.sort, sortCfg.order));
    sortedChildren.forEach(child => {
      container.appendChild(createTreeNodeFromBrowse(child, homePath));
    });
    if (typeof applyGlobalFilter === 'function') applyGlobalFilter();
    if (typeof _scheduleFileLockRefreshForOutliner === 'function') _scheduleFileLockRefreshForOutliner();
    container.dataset.loaded = 'true';
  } catch (error) {
    if (!_isHomeFolderRenderCurrent(renderSeq, homePath)) return;
    _logHomeFolderFailure('home-folder list', error);
    if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(container);
    _renderHomeFolderError(container, error);
    container.dataset.loaded = 'false';
    if (!opts.noAutoRetry) _scheduleHomeFolderAutoRetry();
  }
}

// デスクトップ付箋の小窓にはフォルダツリーが無い。ホームフォルダの一覧取得は本体側だけで行う
// （付箋の枚数だけ保存フォルダ全体の走査が並走し、本体の起動が待たされる）。
if (!(typeof _isTrayAnnotationHost === 'function' && _isTrayAnnotationHost())) loadHomeFolder();

// ホームフォルダへのドロップ対応
(function() {
  const homeBody = document.getElementById('body-home');
  if (!homeBody) return;
  // 行と行の間・字下げの余白（.tree-node 内で行以外の所）はホーム直下への移動先にしない。
  // ここで枠を出すとセクション全体を囲む枠が行の間で点滅し、ドロップ先を誤読させる。
  const overTreeGutter = (e) => !!(e.target && e.target !== homeBody && e.target.closest?.('.tree-node'));
  homeBody.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (overTreeGutter(e)) {
      homeBody.style.outline = '';
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    const external = !draggedNode && (_outlinerExternalDragItems(e).length
      || (typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(e, 'node')));
    if (!draggedNode && !external) return;
    e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
    homeBody.style.outline = '2px solid var(--accent)';
  });
  homeBody.addEventListener('dragleave', () => { homeBody.style.outline = ''; });
  homeBody.addEventListener('drop', async (e) => {
    e.preventDefault();
    homeBody.style.outline = '';
    if (overTreeGutter(e)) { if (typeof clearDragIndicators === 'function') clearDragIndicators(); return; }
    if (!draggedNode && _homeFolderPath) {
      const resolved = typeof MeldexDnD !== 'undefined' ? await MeldexDnD.resolveDropData(e, 'node') : null;
      const items = _outlinerExternalDragItems(e, resolved?.payload).filter(source =>
        source.type !== 'entity' && !source.linked && source.path !== _homeFolderPath
        && !_treeNodeIsAncestor({ _nodeData: source }, { _nodeData: { path: _homeFolderPath } }));
      const target = { path: _homeFolderPath, name: 'ホームフォルダ', position: 'inside' };
      const completed = e.altKey ? await _linkExternalItemsIntoOutlinerFolder(items, target)
        : await _moveExternalItemsIntoOutlinerFolder(items, target);
      if (resolved && completed > 0) MeldexDnD.completeDrop(resolved);
      else if (resolved) MeldexDnD.failDrop(resolved);
      return;
    }
    if (!draggedNode || !_homeFolderPath) return;
    if (typeof isItemLocked === 'function' && isItemLocked(_homeFolderPath)) {
      showStatus('編集ロック中のフォルダには移動できません', true); return;
    }
    const nodes = (draggedNodes || [draggedNode]).filter(Boolean);
    const reservation = typeof historyReserve === 'function' ? historyReserve(`ホームフォルダへ ${nodes.length} 件を移動`, '') : null;
    try {
    let movedCount = 0;
    let skippedCount = 0;
    const movedItems = [];
    const progressToken = window.MeldexImportProgress?.beginOperation?.('ファイルを移動中', nodes.length, { delayMs: 0, kind: 'file-move' });
    let processed = 0;
    for (const n of nodes) {
      const dragData = n._nodeData;
      if (!dragData || !dragData.path) {
        skippedCount++; processed++; window.MeldexImportProgress?.updateOperation?.(processed, null, progressToken); continue;
      }
      if (typeof isItemLocked === 'function' && isItemLocked(dragData.path)) {
        skippedCount++; processed++; window.MeldexImportProgress?.updateOperation?.(processed, null, progressToken);
        showStatus('編集ロック中の項目は移動できません', true); continue;
      }
      if (dragData.linked) {
        skippedCount++; processed++; window.MeldexImportProgress?.updateOperation?.(processed, null, progressToken);
        showStatus('リンクファイルは移動できません'); continue;
      }
      if (typeof _outlinerAwaitPendingRename === 'function') await _outlinerAwaitPendingRename(dragData);
      const finishPending = _stageOutlinerMovePreview(n, homeBody, _homeFolderPath);
      try {
        const oldPath = dragData.path;
        const _res = await apiPost('/outliner/move', {
          path: oldPath,
          dest_folder: _homeFolderPath,
          conflict_policy: 'error',
        });
        finishPending(false);
        movedCount++;
        movedItems.push({
          oldPath,
          newPath: _res?.new_path || oldPath,
          currentPath: _res?.new_path || oldPath,
          name: _res?.new_name || dragData.name,
          type: dragData.type,
          fileId: _res?.file_id || dragData.file_id,
        });
        try {
          if (_res?.new_path && typeof renameAppPathReferences === 'function') renameAppPathReferences(oldPath, _res.new_path, { label: _res.new_name || dragData.name, fileId: _res.file_id, type: dragData.type || 'page' });
        } catch (error) { console.warn('[Meldex] 移動後のパス更新に失敗しました', error); }
        try { if (typeof handleRelocateResponse === 'function') handleRelocateResponse(_res); }
        catch (error) { console.warn('[Meldex] 移動後の表示更新に失敗しました', error); }
      } catch (error) { finishPending(true); skippedCount++; showStatus('移動に失敗: ' + (error?.message || error), true); }
      processed += 1;
      window.MeldexImportProgress?.updateOperation?.(processed, null, progressToken);
    }
    window.MeldexImportProgress?.finishOperation?.(progressToken, { failed: skippedCount, summary: `${movedCount}件移動・${skippedCount}件失敗` });
    await renderHomeFolderTree({ force: true, reason: 'home-drop' });
    await loadOutliner();
    const registerMove = () => window.MeldexFileMoveHistory?.register?.(movedItems, {
      label: `ホームフォルダへ ${movedItems.length} 件を移動`,
      detail: `→ ${_homeFolderPath}`,
      refresh: async () => {
        await renderHomeFolderTree({ force: true, reason: 'home-drop-history' });
        await loadOutliner();
      },
    });
    if (reservation) reservation.capture(registerMove); else registerMove();
    const statusText = skippedCount
      ? movedCount + ' 件をホームフォルダに移動しました。' + skippedCount + ' 件は移動できませんでした'
      : movedCount + ' 件をホームフォルダに移動しました';
    showStatus(statusText, skippedCount > 0);
    } finally { reservation?.cancel(); }
  });
})();

// ホームへの移動も、保存先が確定するまでは表示だけを移し、失敗時に元の位置へ戻す。
function _stageOutlinerMovePreview(node, homeBody, destination) {
  const before = { parent: node.parentElement, next: node.nextSibling, path: node.dataset.path, inert: node.inert };
  homeBody.appendChild(node);
  node.dataset.path = destination + '/' + String(before.path || '').split('/').pop();
  node.inert = true;
  node.setAttribute('aria-busy', 'true');
  if (!node._outlinerPendingHomeMoveGuard) {
    node._outlinerPendingHomeMoveGuard = true;
    const guard = event => {
      if (!node.inert || node.getAttribute('aria-busy') !== 'true') return;
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && /^[zy]$/i.test(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    ['click', 'dblclick', 'contextmenu', 'dragstart', 'keydown'].forEach(type => node.addEventListener(type, guard, true));
  }
  return failed => {
    node.dataset.path = before.path;
    node.inert = before.inert;
    node.removeAttribute('aria-busy');
    if (failed && before.parent?.isConnected) {
      before.parent.insertBefore(node, before.next?.parentElement === before.parent ? before.next : null);
    }
  };
}

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
