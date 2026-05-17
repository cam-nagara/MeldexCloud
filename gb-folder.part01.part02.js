      else if (!isFav && typeof addToFavorites === 'function') addToFavorites(item.name, item.path, item.type);
    }, null, isFav ? 'starOff' : 'star');
  }

  const exportItems = _folderExportItems(item);
  if (exportItems.length > 0) {
    const exportSub = addSub('エクスポート', typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload');
    exportItems.forEach(exportItem => {
      exportSub.item(exportItem.label, async () => {
        if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
          showStatus('保存ダイアログを初期化できませんでした', true);
          return;
        }
        await MeldexExportSave.saveUrl(exportItem.url, {
          filename: exportItem.filename,
          extension: exportItem.extension,
          dialogTitle: `${exportItem.label}として保存`,
          filetypes: exportItem.filetypes,
          okMessage: `${exportItem.label} として保存しました`,
          errorMessage: `${exportItem.label} の保存に失敗しました`,
          path: item.path,
          title: item.name || '無題',
        });
      });
    });
  }

  if (!blankTarget && item.path) {
    addItem('所属フォルダを設定...', () => {
      if (typeof showAddFolderLinkModal === 'function') showAddFolderLinkModal(item.path, null);
    }, null, 'link2');
  }

  if (!blankTarget && item.path && typeof getNodeColor === 'function' && typeof setNodeColor === 'function' && typeof openColorPalette === 'function') {
    addSep();
    const currentColor = getNodeColor(item.path);
    const colorItem = document.createElement('div');
    colorItem.className = 'gb-context-menu-item';
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'gb-color-swatch gb-color-swatch--inline';
    if (typeof setColorSwatchValue === 'function') setColorSwatchValue(swatch, currentColor || 'var(--fg)');
    colorItem.appendChild(swatch);
    const clbl = document.createElement('span');
    clbl.textContent = '色設定';
    colorItem.appendChild(clbl);
    colorItem.addEventListener('click', () => {
      openColorPalette(swatch, currentColor, (color) => {
        _folderApplyItemColor(item, color || null);
        closeMenu();
      });
    });
    menu.appendChild(colorItem);
  }

  if (!blankTarget && item.type === 'folder' && item.path && typeof getWorkFolder === 'function' && typeof setWorkFolder === 'function') {
    const curWork = getWorkFolder();
    const isWork = curWork === item.path;
    const wfSub = addSub('作品フォルダ', 'folder');
    wfSub.item((isWork ? '✓ ' : '') + '設定する', async () => {
      setWorkFolder(item.path);
      showStatus(`「${item.name}」を作品フォルダに設定しました`);
      if (typeof loadLinkDict === 'function') await loadLinkDict();
      if (typeof tooltipCache !== 'undefined') tooltipCache = {};
      if (typeof loadOutliner === 'function') await loadOutliner();
    });
    if (isWork) {
      wfSub.item('解除する', async () => {
        setWorkFolder('');
        showStatus('作品フォルダの設定を解除しました');
        if (typeof loadLinkDict === 'function') await loadLinkDict();
        if (typeof tooltipCache !== 'undefined') tooltipCache = {};
        if (typeof loadOutliner === 'function') await loadOutliner();
      });
    }
  }

  if ((item.type === 'folder' || item.type === 'database') && item.path && typeof getSortForFolder === 'function') {
    const sortSub = addSub('並び替え', 'arrowUpDown');
    const curSort = getSortForFolder(item.path);
    const sortSettingsKey = typeof SORT_SETTINGS_KEY !== 'undefined' ? SORT_SETTINGS_KEY : 'outliner-sort';
    [
      { label: 'マニュアル', sort: 'manual', order: 'asc' },
      { label: '名前 ↑', sort: 'name', order: 'asc' },
      { label: '名前 ↓', sort: 'name', order: 'desc' },
      { label: '更新日時 ↑', sort: 'modified', order: 'asc' },
      { label: '更新日時 ↓', sort: 'modified', order: 'desc' },
      { label: '作成日時 ↑', sort: 'created', order: 'asc' },
      { label: '作成日時 ↓', sort: 'created', order: 'desc' },
    ].forEach(option => {
      const active = curSort.sort === option.sort && curSort.order === option.order;
      sortSub.item((active ? '✓ ' : '') + option.label, async () => {
        const before = typeof captureOutlinerSettingsHistory === 'function' ? captureOutlinerSettingsHistory([sortSettingsKey]) : null;
        setSortSetting(item.path, option.sort, option.order);
        if (typeof pushOutlinerSettingsHistory === 'function') {
          pushOutlinerSettingsHistory('フォルダツリー: 並び替え設定', before, item.path + ' / ' + option.label, [sortSettingsKey]);
        }
        if (item.path === _folderPath) await _folderRefreshCurrentFolder();
        if (typeof loadOutliner === 'function') loadOutliner();
      });
    });
  }

  // --- 管理 ---
  addSep();
  addItem('パスをコピー', () => { navigator.clipboard.writeText(item.path); showStatus('パスをコピーしました'); }, null, 'clipboardList');
  const lockedForEdit = _folderMenuItemLocked(item);
  if (!blankTarget && !lockedForEdit) {
    addItem('リネーム', async () => {
      const newName = await cfPrompt('新しい名前:', item.name);
      if (newName && newName !== item.name) {
        apiPost('/outliner/rename', { old_path: item.path, new_name: newName, type: item.type || 'page' }).then((res) => {
          showStatus('リネーム: ' + newName);
          if (res?.new_path && typeof _renameTreeNode === 'function') _renameTreeNode(item.path, res.new_path, newName);
          if (res?.new_path && typeof renameAppPathReferences === 'function') {
            renameAppPathReferences(item.path, res.new_path, { label: newName, fileId: res.file_id, type: item.type || 'page' });
          }
          // 開いているフォルダ自体をリネームした場合は_folderPathを更新
          if (_folderPath && item.type === 'folder' && item.path === _folderPath && res?.new_path) {
            _folderPath = res.new_path;
          }
          if (_folderPath) openFolder(_folderPath.split('/').pop(), _folderPath);
          if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
        }).catch(() => showStatus('リネームに失敗', true));
      }
    }, null, 'pencil');
    addItem('複製', async () => {
      try {
        const res = await apiPost('/outliner/duplicate', { path: item.path });
        showStatus('複製しました: ' + (res.new_name || ''));
        if (_folderPath) openFolder(_folderPath.split('/').pop(), _folderPath);
      } catch { showStatus('複製に失敗しました', true); }
    }, null, 'copy');
    addItem('削除', async () => {
      const targets = (_folderSelectedItems.length > 1 ? _folderSelectedItems : [item])
        .filter(target => !_folderMenuItemLocked(target));
      if (!targets.length) {
        showStatus('編集ロック中の項目は削除できません', true);
        return;
      }
      if (!await cfConfirm(targets.length + ' 件を削除しますか？')) return;
      const result = await deleteOutlinerItemsWithHistory(targets, {
        label: targets.length + ' 件を削除',
        refresh: async () => {
          if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath);
        },
      });
      _folderSelectedItems = [];
      _folderSelected = null;
      _updateFolderBulkBar();
      if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath);
      const deletedCount = result.deletedCount || result.succeeded.length;
      if (result.failedCount > 0) showStatus(`${deletedCount} 件を削除、${result.failedCount} 件は失敗しました`, true);
      else if (deletedCount > 0) showStatus(deletedCount + ' 件を削除しました（Undoで戻せます）');
      else showStatus('削除対象が見つからなかったため、表示を更新しました', true);
    }, 'red', 'trash2');
  }

  if (!blankTarget && item.type === 'database' && item.path && typeof isSplitActive === 'function') {
    addSep();
    if (isSplitActive()) {
      addItem('別の作業領域で開く', () => {
        if (typeof openDbInOtherPane === 'function') openDbInOtherPane(item.path);
      }, null, 'columns');
    } else {
      addItem('スプリットで開く', () => {
        if (typeof openInNewSplit === 'function') openInNewSplit(item.path);
      }, null, 'columns');
    }
  }
  { const z = _getZoom(); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
  document.body.appendChild(menu);
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  if (item.path && typeof appendShellVerbsToMenu === 'function') appendShellVerbsToMenu(menu, item.path);
  setTimeout(() => {
    const closer = (ev) => {
      const inAnyMenu = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAnyMenu) { closeMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function _folderBoardPathForName(dir, boardName) {
  return String(dir || '') + '/' + boardName + '.md';
}

async function _findAvailableFolderBoardPath(dir, baseBoardName) {
  const baseName = String(baseBoardName || 'images_canvas').trim() || 'images_canvas';
  for (let i = 0; i <= 100; i++) {
    const boardName = i === 0 ? baseName : baseName + '_' + i;
    const boardPath = _folderBoardPathForName(dir, boardName);
    try {
      await apiFetch('/file?path=' + encodeURIComponent(boardPath));
    } catch {
      return { boardName, boardPath };
    }
  }
  throw new Error('同名のボードが多すぎるため、新しいボードを作成できません');
}

// 画像をキャンバスで開く（リンクのみ保存）
async function openImageInCanvas(item) {
  const dir = _folderPath || (item.path.includes('/') ? item.path.substring(0, item.path.lastIndexOf('/')) : '');
  try {
    const itemName = item?.name || item?.path?.split(/[\\/]/).pop() || 'image';
    const { boardName, boardPath } = await _findAvailableFolderBoardPath(dir, itemName.replace(/\.[^.]+$/, '') + '_canvas');
    const imgUrl = '/api/file-raw?path=' + encodeURIComponent(item.path);
    const content = '---\ntype: board\npositions:\n  n0: {x: 100, y: 100}\nsizes:\n  n0: {w: 400, h: 0}\n---\n# [img]' + imgUrl + '\n';
    await apiPut('/file?path=' + encodeURIComponent(boardPath), { content });
    openBoard(boardName, boardPath, { fromExplorer: true });
    showStatus('ボードを作成しました');
  } catch (e) { showStatus(e?.message || 'ボード作成に失敗', true); }
}

// 複数画像をキャンバスに並べて開く
async function openImagesInCanvas(items) {
  const dir = _folderPath || '';
  try {
    const { boardName, boardPath } = await _findAvailableFolderBoardPath(dir, 'images_canvas_' + new Date().toISOString().substring(0,10));

    // グリッド配置: 1行あたり4枚、300px間隔
    const cols = 4, gapX = 320, gapY = 280;
    let fm = '---\ntype: board\npositions:\n';
    items.forEach((it, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      fm += `  n${i}: {x: ${100 + col * gapX}, y: ${100 + row * gapY}}\n`;
    });
    fm += 'sizes:\n';
    items.forEach((it, i) => { fm += `  n${i}: {w: 280, h: 0}\n`; });
    fm += '---\n';
    items.forEach((it, i) => {
      const imgUrl = '/api/file-raw?path=' + encodeURIComponent(it.path);
      fm += `# [img]${imgUrl}\n${it.name}\n`;
    });

    await apiPut('/file?path=' + encodeURIComponent(boardPath), { content: fm });
    openBoard(boardName, boardPath, { fromExplorer: true });
    showStatus(items.length + '枚の画像をボードに配置しました');
  } catch (e) { showStatus(e?.message || 'ボード作成に失敗', true); }
}

// チェックボックスの状態を選択状態と同期
function _syncFolderCheckboxes() {
  const grid = document.getElementById('folder-grid');
  if (!grid) return;
  grid.querySelectorAll('.fv-item').forEach(el => {
    const chk = el.querySelector('.fv-check');
    if (chk) chk.checked = el.classList.contains('selected');
  });
}

function _folderBulkAnchorRect() {
  const selectedEls = Array.from(document.querySelectorAll('#folder-grid .fv-item.selected'));
  const lastSelected = selectedEls[selectedEls.length - 1] || null;
  const anchor = lastSelected || document.getElementById('folder-display-filter-btn') || document.getElementById('folder-grid');
  return anchor?.getBoundingClientRect?.() || { left: 16, right: 16, top: 48, bottom: 48 };
}

function _positionFolderBulkPopup() {
  const bar = document.getElementById('fv-bulk-bar');
  if (!bar || !bar.classList.contains('visible')) return;
  bar.style.maxHeight = '';
  bar.style.overflowY = '';
  if (typeof positionPopup === 'function') {
    positionPopup(bar, _folderBulkAnchorRect(), { prefer: 'below', gap: 6 });
  } else if (typeof clampPopupToViewport === 'function') {
    const rect = _folderBulkAnchorRect();
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    bar.style.left = (rect.left / z) + 'px';
    bar.style.top = (rect.bottom / z + 6) + 'px';
    clampPopupToViewport(bar);
  }
}

function _scheduleFolderBulkPopupPosition() {
  if (_folderBulkPopupRaf) return;
  _folderBulkPopupRaf = requestAnimationFrame(() => {
    _folderBulkPopupRaf = 0;
    _positionFolderBulkPopup();
  });
}

function _setFolderBulkPopupTracking(enabled) {
  if (enabled && !_folderBulkPopupTracking) {
    _folderBulkPopupTracking = true;
    window.addEventListener('resize', _scheduleFolderBulkPopupPosition);
    document.addEventListener('scroll', _scheduleFolderBulkPopupPosition, true);
  } else if (!enabled && _folderBulkPopupTracking) {
    _folderBulkPopupTracking = false;
    window.removeEventListener('resize', _scheduleFolderBulkPopupPosition);
    document.removeEventListener('scroll', _scheduleFolderBulkPopupPosition, true);
    if (_folderBulkPopupRaf) {
      cancelAnimationFrame(_folderBulkPopupRaf);
      _folderBulkPopupRaf = 0;
    }
  }
}

// 一括操作ポップアップの表示/非表示更新
function _updateFolderBulkBar() {
  const bar = document.getElementById('fv-bulk-bar');
  if (!bar) return;
  if (_folderSelectedItems.length > 0) {
    bar.classList.add('visible');
    bar.setAttribute('aria-hidden', 'false');
    const cnt = bar.querySelector('.fv-bulk-count');
    if (cnt) cnt.textContent = _folderSelectedItems.length + ' 件選択中';
    _positionFolderBulkPopup();
    _setFolderBulkPopupTracking(true);
  } else {
    bar.classList.remove('visible');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.left = '';
    bar.style.top = '';
    bar.style.maxHeight = '';
    bar.style.overflowY = '';
    _setFolderBulkPopupTracking(false);
  }
}

// 一括操作: スライドショー
function fvBulkSlideshow() {
  const imgItems = _folderSelectedItems.filter(i => i.type === 'image');
  if (imgItems.length === 0) { showStatus('画像が選択されていません', true); return; }
  openViewer('/viewer?files=' + encodeURIComponent(JSON.stringify(imgItems.map(i => i.path))));
}

// 一括操作: ボードに並べる
function fvBulkBoard() {
  const imgItems = _folderSelectedItems.filter(i => i.type === 'image');
  if (imgItems.length === 0) { showStatus('画像が選択されていません', true); return; }
  openImagesInCanvas(imgItems);
}

// 一括操作: 削除
async function fvBulkDelete() {
  const targets = _folderSelectedItems.filter(item => !_folderMenuItemLocked(item));
  if (targets.length === 0) {
    showStatus('編集ロック中の項目は削除できません', true);
    return;
  }
  if (!await cfConfirm(targets.length + ' 件を削除しますか？')) return;
  const result = await deleteOutlinerItemsWithHistory(targets, {
    label: targets.length + ' 件を削除',
    refresh: async () => {
      if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath);
    },
  });
  _folderSelectedItems = [];
  _folderSelected = null;
  _updateFolderBulkBar();
  if (_folderPath) await openFolder(_folderPath.split('/').pop(), _folderPath);
  const deletedCount = result.deletedCount || result.succeeded.length;
  if (result.failedCount > 0) showStatus(`${deletedCount} 件を削除、${result.failedCount} 件は失敗しました`, true);
  else if (deletedCount > 0) showStatus(deletedCount + ' 件を削除しました（Undoで戻せます）');
  else showStatus('削除対象が見つからなかったため、表示を更新しました', true);
}

// 一括操作: パスをコピー
function fvBulkCopyPath() {
  const paths = _folderSelectedItems.map(i => i.path).join('\n');
  navigator.clipboard.writeText(paths);
  showStatus(_folderSelectedItems.length + ' 件のパスをコピーしました');
}

// 一括操作: 選択解除
function fvBulkDeselect() {
  document.querySelectorAll('.fv-item.selected').forEach(s => s.classList.remove('selected'));
  _folderSelectedItems = [];
  _folderSelected = null;
  _syncFolderCheckboxes();
  _updateFolderBulkBar();
}

function _folderKeyboardEventFromTextEditor(event) {
  const target = event?.target instanceof Element ? event.target : document.activeElement;
  const active = document.activeElement instanceof Element ? document.activeElement : target;
  return !!(
    target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]') ||
    active?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')
  );
}

// フォルダビュー: 空域クリックで選択解除
document.getElementById('folder-grid').addEventListener('click', function(e) {
  // ラッソドラッグ直後の合成 click はスキップ（せっかく選択したものを解除させない）
  if (_lassoJustCompleted) return;
  if (e.target === this) {
    document.querySelectorAll('.fv-item.selected').forEach(s => s.classList.remove('selected'));
    _folderSelectedItems = [];
    _folderSelected = null;
    _syncFolderCheckboxes();
    _updateFolderBulkBar();
  }
});

// フォルダビュー: キーボード操作
// 離散ショートカット（Ctrl+A, Delete, F2, Enter）→ gb-shortcuts.js に移行済み
// 矢印キーのグリッドナビゲーションのみ残存
document.addEventListener('keydown', function(e) {
  if (e.defaultPrevented) return;
  if (state.view !== 'folder') return;
  if (_folderKeyboardEventFromTextEditor(e)) return;

  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const grid = document.getElementById('folder-grid');
    const items = Array.from(grid.querySelectorAll('.fv-item'));
    if (items.length === 0) return;
    const curIdx = _folderSelected ? items.findIndex(el => el.classList.contains('selected')) : -1;
    let cols = 1;
    if (items.length > 1) {
      const firstTop = items[0].getBoundingClientRect().top;
      for (let i = 1; i < items.length; i++) {
        if (items[i].getBoundingClientRect().top > firstTop + 5) { cols = i; break; }
      }
      if (cols === 1 && items.length > 1 && items[1].getBoundingClientRect().top <= firstTop + 5) cols = items.length;
    }
    let nextIdx = curIdx;
    if (e.key === 'ArrowRight') nextIdx = Math.min(items.length - 1, curIdx + 1);
    else if (e.key === 'ArrowLeft') nextIdx = Math.max(0, curIdx - 1);
    else if (e.key === 'ArrowDown') nextIdx = Math.min(items.length - 1, curIdx + cols);
    else if (e.key === 'ArrowUp') nextIdx = Math.max(0, curIdx - cols);
    if (nextIdx < 0) nextIdx = 0;
    const filteredItems = _folderVisibleItems.length ? _folderVisibleItems : _getFolderFilteredItems();
    items.forEach(el => el.classList.remove('selected'));
    items[nextIdx].classList.add('selected');
    items[nextIdx].scrollIntoView({ block: 'nearest' });
    const item = filteredItems[parseInt(items[nextIdx].dataset.idx)];
    if (item) { _folderSelected = item; _folderSelectedItems = [item]; }
    _syncFolderCheckboxes();
    _updateFolderBulkBar();
    showStatus(item ? item.name : '');
  }
});

// ラッソ（矩形ドラッグ）選択
let _lassoJustCompleted = false;
{
  const grid = document.getElementById('folder-grid');
  let _lassoActive = false, _lassoRect = null, _lassoStartX = 0, _lassoStartY = 0;
  let _lassoPreSelected = []; // ラッソ開始前の選択状態
  let _lassoMoved = false;
  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.fv-item')) return;
    _lassoActive = true;
    _lassoMoved = false;
    // Ctrl+ドラッグ: 既存選択を保持
    _lassoPreSelected = (e.ctrlKey || e.metaKey) ? [..._folderSelectedItems] : [];
    const gr = grid.getBoundingClientRect();
    _lassoStartX = e.clientX - gr.left + grid.scrollLeft;
    _lassoStartY = e.clientY - gr.top + grid.scrollTop;
    _lassoRect = document.createElement('div');
    _lassoRect.style.cssText = 'position:absolute;border:1px solid var(--accent);background:rgba(86,156,214,0.15);pointer-events:none;z-index:10;';
    grid.style.position = 'relative';
    grid.appendChild(_lassoRect);
    grid.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grid.addEventListener('pointermove', (e) => {
    if (!_lassoActive || !_lassoRect) return;
    const gr = grid.getBoundingClientRect();
    const curX = e.clientX - gr.left + grid.scrollLeft;
    const curY = e.clientY - gr.top + grid.scrollTop;
    const x = Math.min(_lassoStartX, curX), y = Math.min(_lassoStartY, curY);
    const w = Math.abs(curX - _lassoStartX), h = Math.abs(curY - _lassoStartY);
    if (w > 2 || h > 2) _lassoMoved = true;
    _lassoRect.style.left = x + 'px'; _lassoRect.style.top = y + 'px';
    _lassoRect.style.width = w + 'px'; _lassoRect.style.height = h + 'px';
    const selRect = { left: x, top: y, right: x + w, bottom: y + h };
    // 既存選択 + ラッソ矩形内のアイテムを合算
    _folderSelectedItems = [..._lassoPreSelected];
    grid.querySelectorAll('.fv-item').forEach(el => {
      const er = el.getBoundingClientRect();
      const elX = er.left - gr.left + grid.scrollLeft, elY = er.top - gr.top + grid.scrollTop;
      const overlap = !(elX + er.width < selRect.left || elX > selRect.right || elY + er.height < selRect.top || elY > selRect.bottom);
      const visibleItems = _folderVisibleItems.length ? _folderVisibleItems : _getFolderFilteredItems();
      const it = visibleItems?.[parseInt(el.dataset.idx)];
      const wasPreSelected = it && _lassoPreSelected.includes(it);
      el.classList.toggle('selected', overlap || wasPreSelected);
      if (overlap && it && !_folderSelectedItems.includes(it)) _folderSelectedItems.push(it);
    });
    if (_folderSelectedItems.length > 1) showStatus(_folderSelectedItems.length + ' 件選択中');
  });
  const _endLasso = () => {
    if (!_lassoActive) return;
    _lassoActive = false;
    if (_lassoRect) { _lassoRect.remove(); _lassoRect = null; }
    _syncFolderCheckboxes();
    _updateFolderBulkBar();
    // 直後に発火する click イベントで「空域クリック → 選択解除」が走るのを抑止するため、
    // ラッソでドラッグが発生した場合はフラグを立てて 1 ティック保持する。
    if (_lassoMoved) {
      _lassoJustCompleted = true;
      setTimeout(() => { _lassoJustCompleted = false; }, 0);
    }
    _lassoMoved = false;
  };
  grid.addEventListener('pointerup', _endLasso);
  grid.addEventListener('pointercancel', _endLasso);
}

// Ctrl+ホイールでフォルダビューのズーム
document.getElementById('folder-grid').addEventListener('wheel', function(e) {
  if (!e.ctrlKey) return;
  e.preventDefault();
  _folderZoom = Math.max(0.5, Math.min(3, _folderZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
  localStorage.setItem('folder-zoom', _folderZoom);
  applyFolderZoom();
}, {passive: false});

function openFolderItem(item) {
  const _expOpts = { fromExplorer: true };
  if (item.type === 'folder') { openFolder(item.name, item.path, _expOpts); }
  else if (item.type === 'database') { selectDatabase(item.path, null, _expOpts); }
  else if (item.type === 'page') { openPage(item.name, item.path, _expOpts); }
  else if (item.type === 'scriptnote' || item.type === 'scenario' || (typeof isScriptNotePath === 'function' && isScriptNotePath(item.path))) { if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(item.path, item.name || item.path, _expOpts); }
  else if (item.type === 'board') { openBoard(item.name, item.path, _expOpts); }
  else if (item.type === 'calendar') { openCalendarFile(item.name, item.path, _expOpts); }
  else if (item.type === 'chat') { openSavedChat(item.path); }
  else if (item.type === 'smart-db') { if (typeof openSmartDbFile === 'function') openSmartDbFile(item.name, item.path, _expOpts); }
  else if (item.type === 'image' || item.type === 'video' || item.type === 'audio') { openMedia(item.name, item.path, item.type, _expOpts); }
  else if (item.type === 'html') { openHtmlFile(item.name, item.path, _expOpts); }
  else if (item.type === 'csv') { if (typeof openCsvFile === 'function') openCsvFile(item.name, item.path, _expOpts); else openPage(item.name, item.path, _expOpts); }
  else if (item.type === 'document' && item.name && item.name.toLowerCase().endsWith('.pdf')) {
    openViewer('/viewer?pdf=' + encodeURIComponent(item.path));
  }
  else { openNative(item.path); }
}

// パネル配置設定（フォルダごとに保存、子フォルダに継承）
function _getFvPanelCfg() {
  // 現在のフォルダ→親フォルダ→ルートの順で設定を探す
  let path = _folderPath || '';
  while (path) {
    // file_id キーを優先
    const fid = _pathToFileId(path);
    if (fid) { try { const cfg = JSON.parse(localStorage.getItem('fv-panel-cfg:' + fid)); if (cfg && Object.keys(cfg).length > 0) return cfg; } catch {} }
    try { const cfg = JSON.parse(localStorage.getItem('fv-panel-cfg:' + path)); if (cfg && Object.keys(cfg).length > 0) return cfg; } catch {}
    // 親パスへ
    const lastSlash = path.replace(/\\/g, '/').lastIndexOf('/');
    path = lastSlash > 0 ? path.substring(0, lastSlash) : '';
  }
  // デフォルト
  try { const cfg = JSON.parse(localStorage.getItem('fv-panel-cfg:')); if (cfg) return cfg; } catch {}
  return {};
}
function _saveFvPanelCfg(cfg) {
  const fid = _pathToFileId(_folderPath);
  localStorage.setItem('fv-panel-cfg:' + (fid || _folderPath || ''), JSON.stringify(cfg));
}
function _getFvPanelPos(type) {
  const cfg = _getFvPanelCfg();
  if (type === 'preview') return cfg.previewPos || 'right';
  return cfg.detailPos || 'right';
}
function _getFvPanelSize(type) {
  const cfg = _getFvPanelCfg();
  return (type === 'preview' ? cfg.previewSize : cfg.detailSize) || 300;
}
function _getFvPanelVisible(type) {
  const cfg = _getFvPanelCfg();
  return type === 'preview' ? (cfg.previewVisible ?? false) : (cfg.detailVisible ?? false);
}

// パネルID → DOM要素
function _panelEl(pos) { return document.getElementById('fv-panel-' + pos); }
function _resizeEl(pos) { return document.getElementById('fv-resize-' + pos); }

// パネルレイアウトを適用
function applyFvPanelLayout() {
  const previewPos = _getFvPanelPos('preview');
  const detailPos = _getFvPanelPos('detail');
  const previewVisible = _getFvPanelVisible('preview');
  const detailVisible = _getFvPanelVisible('detail');
  const previewSize = _getFvPanelSize('preview');
  const detailSize = _getFvPanelSize('detail');

  // 全パネル・リサイズハンドルを非表示
  ['top','bottom','left','right'].forEach(pos => {
    const p = _panelEl(pos); if (p) { p.style.display = 'none'; p.innerHTML = ''; p._panelType = null; }
    const r = _resizeEl(pos); if (r) r.style.display = 'none';
  });

  // 同じ場所の場合は統合（プレビューが先）
  const sameSide = previewPos === detailPos;

  // プレビューパネル配置
  if (previewVisible) {
    const el = _panelEl(previewPos);
    if (el) {
      el.style.display = '';
      el._panelType = sameSide ? 'both' : 'preview';
      _applyPanelSize(el, previewPos, previewSize);
      const r = _resizeEl(previewPos); if (r) r.style.display = '';
    }
  }

  // 詳細パネル配置
  if (detailVisible) {
    if (sameSide && previewVisible) {
      // 統合: プレビューパネルに追加
      const el = _panelEl(detailPos);
      if (el) el._panelType = 'both';
    } else {
      const el = _panelEl(detailPos);
      if (el) {
        el.style.display = '';
        el._panelType = 'detail';
        _applyPanelSize(el, detailPos, detailSize);
        const r = _resizeEl(detailPos); if (r) r.style.display = '';
