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
    const linkLabel = item.type === 'folder' ? 'このフォルダへのリンクを作成...' : '所属フォルダを設定...';
    addItem(linkLabel, () => {
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
  addItem('パスをコピー', () => {
    const base = typeof state !== 'undefined' ? (state.vaultPath || '') : '';
    const copyPath = window.GBPathUtils?.resolveForClipboard?.(item.path, base) ?? item.path;
    navigator.clipboard.writeText(copyPath);
    showStatus('パスをコピーしました');
  }, null, 'clipboardList');
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
        }).catch((e) => {
          // 失敗理由（使用中・ロック中・タイムアウト等）を握りつぶさず表示する
          const reason = (e && (e.userMessage || e.message)) ? String(e.userMessage || e.message) : '';
          showStatus('リネームに失敗' + (reason ? `（${reason}）` : ''), true);
        });
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

  if (!blankTarget && item.type === 'database' && item.path && typeof isSplitActive === 'function' && _isFolderFreeLayoutUiEnabled()) {
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
  const menuAnchorRect = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
  if (typeof positionPopup === 'function') {
    positionPopup(menu, menuAnchorRect, { prefer: 'below', gap: 4 });
  } else {
    const z = _getZoom();
    menu.style.left = (e.clientX / z) + 'px';
    menu.style.top = (e.clientY / z) + 'px';
    document.body.appendChild(menu);
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  if (item.path && typeof appendShellVerbsToMenu === 'function') {
    appendShellVerbsToMenu(menu, item.path, { editingLocked: lockedForEdit });
    if (typeof positionPopup === 'function') positionPopup(menu, menuAnchorRect, { prefer: 'below', gap: 4 });
    else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  setTimeout(() => {
    const closer = (ev) => {
      const inAnyMenu = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAnyMenu) { closeMenu(); document.removeEventListener('pointerdown', closer); }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

const FOLDER_LIST_SORT_STORAGE_KEY = 'folder-list-sort';
const FOLDER_LIST_COLUMNS_STORAGE_KEY = 'folder-list-columns';
const FOLDER_LIST_COLUMN_WIDTHS_STORAGE_KEY = 'folder-list-column-widths';
const FOLDER_LIST_SORT_COLUMNS = [
  { key: 'name', label: '名前', width: 'minmax(220px, 2fr)', minWidth: 160, defaultOrder: 'asc' },
  { key: 'type', label: '種類', width: 'minmax(150px, 190px)', minWidth: 96, defaultOrder: 'asc' },
  { key: 'created', label: '作成日時', width: 'minmax(132px, 150px)', minWidth: 112, defaultOrder: 'desc' },
  { key: 'modified', label: '更新日時', width: 'minmax(132px, 150px)', minWidth: 112, defaultOrder: 'desc' },
  { key: 'createdBy', label: '作成者', width: 'minmax(96px, 128px)', minWidth: 80, defaultOrder: 'asc' },
  { key: 'modifiedBy', label: '更新者', width: 'minmax(96px, 128px)', minWidth: 80, defaultOrder: 'asc' },
  { key: 'size', label: 'サイズ', width: 'minmax(74px, 92px)', minWidth: 68, defaultOrder: 'desc' },
];
const FOLDER_LIST_COLLATOR = new Intl.Collator('ja', { numeric: true, sensitivity: 'base', ignorePunctuation: true });
let _folderListSuppressClickUntil = 0;
let _folderListResizeState = null;

function _folderReadListSort() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLDER_LIST_SORT_STORAGE_KEY) || '{}');
    const key = FOLDER_LIST_SORT_COLUMNS.some(col => col.key === parsed.key) ? parsed.key : 'name';
    const order = parsed.order === 'desc' ? 'desc' : 'asc';
    return { key, order };
  } catch {
    return { key: 'name', order: 'asc' };
  }
}

function _folderWriteListSort(sort) {
  try { localStorage.setItem(FOLDER_LIST_SORT_STORAGE_KEY, JSON.stringify(sort)); } catch {}
}

function _folderToggleListSort(key) {
  const current = _folderReadListSort();
  const column = FOLDER_LIST_SORT_COLUMNS.find(col => col.key === key);
  const order = current.key === key
    ? (current.order === 'asc' ? 'desc' : 'asc')
    : (column?.defaultOrder || 'asc');
  _folderWriteListSort({ key, order });
  const selectedPaths = _folderSelectedItems.map(item => item?.path).filter(Boolean);
  renderFolderGrid({ preserveSelectedPaths: selectedPaths, resetScrollTop: true });
}

function _folderListDateValue(item, key) {
  const raw = key === 'created'
    ? (item?.created || item?.created_at || item?.modified || item?.mtime || '')
    : (item?.modified || item?.mtime || item?.created || item?.created_at || '');
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? time : 0;
}

function _folderListDateText(item, key) {
  const raw = key === 'created'
    ? (item?.created || item?.created_at || item?.modified || item?.mtime || '')
    : (item?.modified || item?.mtime || item?.created || item?.created_at || '');
  return raw ? String(raw).substring(0, 16).replace('T', ' ') : '';
}

function _folderListTypeText(item) {
  return item?.os_type || item?.osType || item?.type_label || item?.typeLabel || FILE_TYPE_LABELS?.[item?.type] || item?.ext || '';
}

function _folderListNameSortText(item) {
  const raw = String(item?.name || '').toLowerCase();
  const stripped = raw.replace(/^[\s\[\]\(\)【】「」『』"'`_.,;:!！?？#＃*＊+＋\-－=＝~〜・･■□◆◇●○]+/, '');
  return stripped || raw;
}

function _folderListUserText(item, key) {
  const candidates = key === 'createdBy'
    ? [item?.created_by, item?.createdBy, item?.creator, item?.author, item?.owner, item?.user]
    : [item?.modified_by, item?.modifiedBy, item?.updated_by, item?.updatedBy, item?.updater, item?.editor, item?.user];
  return String(candidates.find(value => String(value || '').trim()) || '').trim();
}

function _folderListSortValue(item, key) {
  if (key === 'type') return _folderListTypeText(item).toLowerCase();
  if (key === 'created' || key === 'modified') return _folderListDateValue(item, key);
  if (key === 'createdBy' || key === 'modifiedBy') return _folderListUserText(item, key).toLowerCase();
  if (key === 'size') return Number.isFinite(Number(item?.size)) ? Number(item.size) : -1;
  return _folderListNameSortText(item);
}

function _folderCompareListItems(a, b, key, order) {
  const folderDiff = (a?.type === 'folder' ? 0 : 1) - (b?.type === 'folder' ? 0 : 1);
  if (folderDiff !== 0) return folderDiff;
  const av = _folderListSortValue(a, key);
  const bv = _folderListSortValue(b, key);
  let diff = 0;
  if (typeof av === 'number' || typeof bv === 'number') diff = Number(av || 0) - Number(bv || 0);
  else diff = FOLDER_LIST_COLLATOR.compare(String(av || ''), String(bv || ''));
  if (diff === 0 && key !== 'name') diff = FOLDER_LIST_COLLATOR.compare(String(a?.name || ''), String(b?.name || ''));
  if (diff === 0) diff = FOLDER_LIST_COLLATOR.compare(String(a?.path || ''), String(b?.path || ''));
  return order === 'desc' ? -diff : diff;
}

function _folderSortVisibleItems(items) {
  if (_folderLayout !== 'list') return items;
  const sort = _folderReadListSort();
  return [...items].sort((a, b) => _folderCompareListItems(a, b, sort.key, sort.order));
}

function _folderMetaSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text || '';
  return span;
}

function _folderListColumnValue(item, key) {
  if (key === 'name') return item?.name || '';
  if (key === 'type') return _folderListTypeText(item);
  if (key === 'created' || key === 'modified') return _folderListDateText(item, key);
  if (key === 'createdBy' || key === 'modifiedBy') return _folderListUserText(item, key);
  if (key === 'size') return item?.size != null ? formatFileSize(item.size) : '';
  return '';
}

function _folderReadListColumns() {
  const defaults = FOLDER_LIST_SORT_COLUMNS.map(column => column.key);
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLDER_LIST_COLUMNS_STORAGE_KEY) || '[]');
    const keys = Array.isArray(parsed) ? parsed.filter(key => defaults.includes(key)) : [];
    return [...keys, ...defaults.filter(key => !keys.includes(key))];
  } catch {
    return defaults;
  }
}

function _folderListColumns() {
  const defs = new Map(FOLDER_LIST_SORT_COLUMNS.map(column => [column.key, column]));
  return _folderReadListColumns().map(key => defs.get(key)).filter(Boolean);
}

function _folderWriteListColumns(keys) {
  try { localStorage.setItem(FOLDER_LIST_COLUMNS_STORAGE_KEY, JSON.stringify(keys)); } catch {}
}

function _folderReadListColumnWidths() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLDER_LIST_COLUMN_WIDTHS_STORAGE_KEY) || '{}');
    const widths = {};
    FOLDER_LIST_SORT_COLUMNS.forEach(column => {
      const value = Number(parsed?.[column.key]);
      if (Number.isFinite(value) && value > 0) widths[column.key] = Math.max(column.minWidth || 48, Math.min(1200, Math.round(value)));
    });
    return widths;
  } catch {
    return {};
  }
}

function _folderWriteListColumnWidths(widths) {
  try { localStorage.setItem(FOLDER_LIST_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(widths || {})); } catch {}
}

function _folderListColumnTrack(column) {
  const width = _folderReadListColumnWidths()[column.key];
  return Number.isFinite(width) ? Math.max(column.minWidth || 48, width) + 'px' : column.width;
}

function _folderApplyListColumnTemplate(container) {
  if (container) container.style.setProperty('--fv-list-grid-columns', '36px ' + _folderListColumns().map(_folderListColumnTrack).join(' '));
}

function _folderSetListColumnWidth(container, column, width) {
  if (!column) return;
  const widths = _folderReadListColumnWidths();
  widths[column.key] = Math.max(column.minWidth || 48, Math.min(1200, Math.round(Number(width) || 0)));
  _folderWriteListColumnWidths(widths);
  _folderApplyListColumnTemplate(container || document.getElementById('folder-grid'));
}

function _folderMoveListColumn(sourceKey, targetKey) {
  if (!sourceKey || !targetKey || sourceKey === targetKey) return;
  const keys = _folderReadListColumns();
  const from = keys.indexOf(sourceKey);
  const to = keys.indexOf(targetKey);
  if (from < 0 || to < 0) return;
  keys.splice(from, 1);
  keys.splice(to, 0, sourceKey);
  _folderWriteListColumns(keys);
  const selectedPaths = _folderSelectedItems.map(item => item?.path).filter(Boolean);
  renderFolderGrid({ preserveSelectedPaths: selectedPaths });
}

function _folderConfigureListLayout(container, isListLayout) {
  if (!container) return;
  if (!isListLayout) {
    container.style.removeProperty('--fv-list-grid-columns');
    container.style.padding = '12px';
    return;
  }
  container.style.padding = '0 12px 12px 12px';
  _folderApplyListColumnTemplate(container);
}

function _folderBeginListColumnResize(event, column, button, container) {
  if (event.button != null && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const startWidth = button.getBoundingClientRect().width || column.minWidth || 80;
  _folderListResizeState = { pointerId: event.pointerId, startX: event.clientX, startWidth };
  _folderListSuppressClickUntil = Date.now() + 500;
  button.draggable = false;
  button.classList.add('is-resizing');
  handle.classList.add('is-active');
  try { handle.setPointerCapture(event.pointerId); } catch {}
  const finish = (finishEvent) => {
    if (finishEvent.pointerId !== _folderListResizeState?.pointerId) return;
    finishEvent.preventDefault();
    finishEvent.stopPropagation();
    _folderListResizeState = null;
    _folderListSuppressClickUntil = Date.now() + 500;
    button.draggable = true;
    button.classList.remove('is-resizing');
    handle.classList.remove('is-active');
    handle.removeEventListener('pointermove', move);
    try { handle.releasePointerCapture(finishEvent.pointerId); } catch {}
  };
  const move = (moveEvent) => {
    if (moveEvent.pointerId !== _folderListResizeState?.pointerId) return;
    moveEvent.preventDefault();
    moveEvent.stopPropagation();
    const nextWidth = _folderListResizeState.startWidth + (moveEvent.clientX - _folderListResizeState.startX);
    _folderSetListColumnWidth(container, column, nextWidth);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', finish, { once: true });
  handle.addEventListener('pointercancel', finish, { once: true });
}

function _folderAppendListCells(el, item) {
  let nameCell = null;
  _folderListColumns().forEach((column, index) => {
    const gridColumn = String(index + 2);
    if (column.key === 'name') {
      const name = document.createElement('div');
      name.className = 'fv-name fv-list-cell fv-list-name';
      name.style.gridColumn = gridColumn;
      name.style.gridRow = '1';
      const nameText = document.createElement('span');
      nameText.className = 'fv-list-name-text';
      nameText.textContent = item.name;
      nameText.title = item.name;
      nameText.dataset.gbTooltip = item.name;
      name.appendChild(nameText);
      el.appendChild(name);
      nameCell = name;
      return;
    }
    const cell = _folderMetaSpan('fv-list-cell fv-list-' + column.key, _folderListColumnValue(item, column.key));
    cell.style.gridColumn = gridColumn;
    cell.style.gridRow = '1';
    el.appendChild(cell);
  });
  return nameCell;
}

function _folderRenderListHeader(container) {
  const sort = _folderReadListSort();
  let draggingKey = '';
  const stopHeaderEvent = (event) => event.stopPropagation();
  const header = document.createElement('div');
  header.className = 'fv-list-header';
  header.setAttribute('role', 'row');
  header.addEventListener('pointerdown', stopHeaderEvent);
  header.addEventListener('mousedown', stopHeaderEvent);
  header.addEventListener('click', stopHeaderEvent);
  header.addEventListener('dblclick', stopHeaderEvent);
  const iconHead = Object.assign(document.createElement('span'), { className: 'fv-list-icon-head' });
  iconHead.style.gridColumn = '1';
  iconHead.style.gridRow = '1';
  header.appendChild(iconHead);
  _folderListColumns().forEach((column, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fv-list-header-cell fv-list-header-' + column.key;
    button.style.gridColumn = String(index + 2);
    button.style.gridRow = '1';
    button.draggable = true;
    button.dataset.folderListSort = column.key;
    button.dataset.folderListColumn = column.key;
    button.dataset.e2eId = 'folder-list-header-' + column.key;
    button.setAttribute('role', 'columnheader');
    button.setAttribute('aria-sort', sort.key === column.key ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none');
    const label = Object.assign(document.createElement('span'), { className: 'fv-list-header-label', textContent: column.label });
    button.appendChild(label);
    if (sort.key === column.key) button.appendChild(Object.assign(document.createElement('span'), { className: 'fv-list-sort-mark', textContent: sort.order === 'asc' ? '▲' : '▼' }));
    const resizer = Object.assign(document.createElement('span'), { className: 'fv-list-col-resizer', title: '列幅を調整' });
    resizer.setAttribute('aria-hidden', 'true');
    resizer.addEventListener('pointerdown', (event) => _folderBeginListColumnResize(event, column, button, container));
    resizer.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); });
    button.appendChild(resizer);
    button.addEventListener('pointerdown', stopHeaderEvent);
    button.addEventListener('mousedown', stopHeaderEvent);
    button.addEventListener('dragstart', (event) => {
      if (_folderListResizeState || event.target?.closest?.('.fv-list-col-resizer')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      draggingKey = column.key;
      button.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', column.key);
    });
    button.addEventListener('dragover', (event) => {
      if (!draggingKey || draggingKey === column.key) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      button.classList.add('is-drop-target');
    });
    button.addEventListener('dragleave', () => button.classList.remove('is-drop-target'));
    button.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.classList.remove('is-drop-target');
      const sourceKey = event.dataTransfer.getData('text/plain') || draggingKey;
      _folderListSuppressClickUntil = Date.now() + 350;
      _folderMoveListColumn(sourceKey, column.key);
    });
    button.addEventListener('dragend', (event) => {
      event.stopPropagation();
      draggingKey = '';
      button.classList.remove('is-dragging');
      header.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() < _folderListSuppressClickUntil) return;
      _folderToggleListSort(column.key);
    });
    header.appendChild(button);
  });
  container.appendChild(header);
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
    } catch (e) {
      if (e?.status === 404) return { boardName, boardPath };
      throw e;
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
    const imgUrl = _folderItemRawUrl(item);
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
      const imgUrl = _folderItemRawUrl(it);
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

function _normalizeFolderSelectionForVisibleItems() {
  const grid = document.getElementById('folder-grid');
  if (!grid) {
    _folderSelectedItems = [];
    _folderSelected = null;
    return 0;
  }
  const visibleItems = _folderVisibleItems.length ? _folderVisibleItems : _getFolderFilteredItems();
  const byPath = new Map((visibleItems || [])
    .filter(item => item?.path)
    .map(item => [String(item.path), item]));
  const selectedPaths = [];
  grid.querySelectorAll('.fv-item.selected').forEach(el => {
    const path = String(el.dataset.path || '');
    if (!path || !byPath.has(path)) {
      el.classList.remove('selected');
      const chk = el.querySelector('.fv-check');
      if (chk) chk.checked = false;
      return;
    }
    selectedPaths.push(path);
  });
  _folderSelectedItems = selectedPaths.map(path => byPath.get(path)).filter(Boolean);
  _folderSelected = _folderSelectedItems[_folderSelectedItems.length - 1] || null;
  return _folderSelectedItems.length;
}

function _folderBulkAnchorElement() {
  const selectedEls = Array.from(document.querySelectorAll('#folder-grid .fv-item.selected'));
  return selectedEls[selectedEls.length - 1]
    || document.getElementById('folder-display-filter-btn')
    || document.getElementById('folder-grid');
}

function _folderBulkAnchorRect() {
  const anchor = _folderBulkAnchorElement();
  return anchor?.getBoundingClientRect?.() || { left: 16, right: 16, top: 48, bottom: 48 };
}

function _positionFolderBulkPopup() {
  const bar = document.getElementById('fv-bulk-bar');
  if (!bar || !bar.classList.contains('visible')) return;
  bar.style.maxHeight = '';
  bar.style.overflowY = '';
  const anchor = _folderBulkAnchorElement();
  const host = window.GBSelectionFloatMenu?.hostFor?.(anchor) || document.getElementById('folder-view') || document.body;
  if (window.GBSelectionFloatMenu) {
    window.GBSelectionFloatMenu.bindDrag(bar, { host });
    window.GBSelectionFloatMenu.resetPosition(bar, { host, anchor });
  } else if (typeof positionPopup === 'function') {
    positionPopup(bar, _folderBulkAnchorRect(), { prefer: 'below', gap: 6 });
  }
}

function _ensureFolderBulkBarChrome(bar) {
  if (!bar) return;
  bar.classList.add('gb-selection-float-bar');
  if (window.GBSelectionFloatMenu) {
    const host = window.GBSelectionFloatMenu?.hostFor?.(bar) || document.getElementById('folder-view') || document.body;
    if (!bar.querySelector('.gb-selection-float-drag')) {
      bar.insertBefore(window.GBSelectionFloatMenu.createDragHandle(), bar.firstChild);
    }
    window.GBSelectionFloatMenu.bindDrag(bar, { host });
    bar.querySelectorAll('button:not(.gb-selection-float-drag)').forEach(button => {
      if (button.dataset.selectionFloatActionBound === '1') return;
      button.dataset.selectionFloatActionBound = '1';
      button.classList.add('gb-selection-float-button');
      // bindDrag() が click をバブル段階で stopPropagation するため、data-action の
      // ドキュメント委譲(gb-events.js)へ届かない。各ボタンに実アクションを直接結線して回避する。
      button.addEventListener('click', (e) => {
        window.GBSelectionFloatMenu.pulseButton(button);
        if (button.disabled) return;
        const m = String(button.dataset.action || '').match(/^([a-zA-Z_$][\w$]*)\s*\(/);
        const fn = m ? window[m[1]] : null;
        if (typeof fn === 'function') { e.preventDefault(); fn(); }
      }, true);
    });
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
  const selectedCount = (state.view === 'folder') ? _normalizeFolderSelectionForVisibleItems() : 0;
  window.MeldexTagManagement?.setAutoTagTargets?.(selectedCount > 0 ? _folderSelectedItems : []);
  const bar = document.getElementById('fv-bulk-bar');
  if (!bar) return;
  _ensureFolderBulkBarChrome(bar);
  const autoTagButton = bar.querySelector('[data-action^="fvBulkAutoTag"]');
  if (autoTagButton) autoTagButton.hidden = window.isAutoTagRuntimeAvailable?.() !== true;
  if (selectedCount > 0) {
    bar.classList.add('visible');
    bar.hidden = false;
    bar.setAttribute('aria-hidden', 'false');
    const cnt = bar.querySelector('.fv-bulk-count');
    if (cnt) cnt.textContent = selectedCount + ' 件選択中';
    const readOnlyArchive = !!window._archiveBrowseContext;
    bar.querySelectorAll('[data-action^="fvBulkAutoTag"],[data-action^="fvBulkCompress"],[data-action^="fvBulkDelete"]').forEach(button => {
      button.disabled = readOnlyArchive;
      button.title = readOnlyArchive ? 'ZIP内は読み取り専用です' : '';
    });
    _positionFolderBulkPopup();
    _setFolderBulkPopupTracking(true);
  } else {
    bar.classList.remove('visible');
    bar.hidden = true;
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
  const base = typeof state !== 'undefined' ? (state.vaultPath || '') : '';
  const paths = _folderSelectedItems
    .map(i => window.GBPathUtils?.resolveForClipboard?.(i.path, base) ?? i.path)
    .join('\n');
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

function _folderKeyboardEventFromOutliner(event) {
  const target = event?.target instanceof Element ? event.target : null;
  const active = document.activeElement instanceof Element ? document.activeElement : null;
  if (target?.closest?.('#outliner-tree, #body-home, #tree-scroll-container')) return true;
  if (active?.closest?.('#outliner-tree, #body-home, #tree-scroll-container')) return true;
  return Number(window._outlinerKeyboardNavigationActiveUntil || 0) > Date.now();
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
  if (_folderKeyboardEventFromOutliner(e)) return;

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
    try { grid.setPointerCapture(e.pointerId); } catch {}
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

async function openFolderItem(item) {
  _folderSelectedItems = [];
  _folderSelected = null;
  _updateFolderBulkBar();
  const _expOpts = { fromExplorer: true };
  if (item?.archive_path && typeof openArchiveItem === 'function') {
    openArchiveItem(item);
    return;
  }
  const clickPaneSnapshot = typeof _captureBrowseItemPaneSnapshot === 'function'
    ? _captureBrowseItemPaneSnapshot('', { requirePath: false })
    : null;
  if (typeof _applyCachedBrowseItemType === 'function') _applyCachedBrowseItemType(item);
  if (item.type === 'folder' && item.needs_type_check === true && typeof _scheduleBrowseItemTypeResolution === 'function') {
    const mobileExplorer = window.MeldexCloudMobileExplorer;
    const handledByMobileExplorer = !!(
      window.MeldexCloudMobile?.shouldUseSidebarDrawer?.()
      && mobileExplorer?.selectFolderFromTree
    );
    const folderVisiblePromise = openFolder(item.name, item.path, _expOpts);
    const paneSnapshot = typeof _captureBrowseItemPaneSnapshot === 'function'
      ? _captureBrowseItemPaneSnapshot(item.path, { requirePath: !handledByMobileExplorer })
      : null;
    _scheduleBrowseItemTypeResolution(null, item, folderVisiblePromise, {
      paneSnapshot,
      isStillActive: handledByMobileExplorer
        ? () => mobileExplorer?.currentFolderTarget?.()?.path === item.path
        : undefined,
      onResolved: handledByMobileExplorer && typeof mobileExplorer?.handleResolvedItemType === 'function'
        ? payload => mobileExplorer.handleResolvedItemType(payload)
        : undefined,
    });
    return folderVisiblePromise;
  }
  if (typeof _resolveBrowseItemTypeOnDemand === 'function' && typeof _browseItemNeedsTypeCheck === 'function'
      && _browseItemNeedsTypeCheck(item)) {
    await _resolveBrowseItemTypeOnDemand(item);
    if (typeof _browseItemPaneSnapshotIsCurrent === 'function'
        && !_browseItemPaneSnapshotIsCurrent(clickPaneSnapshot)) return;
  }
  if (typeof _folderArchiveExtension === 'function'
      && _folderArchiveExtension(item?.path || item?.name || '') === '.zip'
      && typeof openArchiveFolder === 'function') {
    return openArchiveFolder(item.path, '');
  }
  if (item.type === 'folder') { openFolder(item.name, item.path, _expOpts); }
  else if (item.type === 'database') { selectDatabase(item.path, clickPaneSnapshot?.paneContext || null, _expOpts); }
  else if (item.type === 'page') { openPage(item.name, item.path, _expOpts); }
  else if (item.type === 'scriptnote' || item.type === 'scenario' || (typeof isScriptNotePath === 'function' && isScriptNotePath(item.path))) { if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(item.path, item.name || item.path, _expOpts); }
  else if (item.type === 'board') { openBoard(item.name, item.path, _expOpts); }
  else if (item.type === 'calendar') { openCalendarFile(item.name, item.path, { ..._expOpts, paneContext: clickPaneSnapshot?.paneContext || null }); }
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
