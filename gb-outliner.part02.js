      }
    } else if (data.children) {
      node.children = data.children;
    }
    if (data.type !== 'entity') {
      tree.push(node);
    }
  });
  return tree;
}

async function saveOutlinerTree() {
  // ルートフォルダベースではファイルシステムがツリー構造そのもの。
  // D&Dによる並べ替えは localStorage のマニュアル順として永続化する。
}

function _normalizeOutlinerPathForCompare(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _isOutlinerPathWithin(path, basePath) {
  const normalizedPath = _normalizeOutlinerPathForCompare(path);
  const normalizedBase = _normalizeOutlinerPathForCompare(basePath);
  if (!normalizedPath || !normalizedBase) return false;
  if (normalizedPath === normalizedBase || normalizedPath.startsWith(normalizedBase + '/')) return true;
  const pathParts = normalizedPath.split('/').filter(Boolean);
  const baseParts = normalizedBase.split('/').filter(Boolean);
  if (!pathParts.length || !baseParts.length || pathParts.length < baseParts.length) return false;
  for (let i = 0; i <= pathParts.length - baseParts.length; i++) {
    let matches = true;
    for (let j = 0; j < baseParts.length; j++) {
      if (pathParts[i + j] !== baseParts[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

const _outlinerPendingDeletePaths = new Set();

function isOutlinerDeletePendingPath(path) {
  const normalizedPath = _normalizeOutlinerPathForCompare(path);
  if (!normalizedPath || !_outlinerPendingDeletePaths.size) return false;
  for (const pendingPath of _outlinerPendingDeletePaths) {
    if (_isOutlinerPathWithin(normalizedPath, pendingPath)) return true;
  }
  return false;
}

function _setOutlinerDeletePending(paths, pending) {
  const normalizedPaths = (paths || []).map(_normalizeOutlinerPathForCompare).filter(Boolean);
  normalizedPaths.forEach(path => {
    if (pending) _outlinerPendingDeletePaths.add(path);
    else _outlinerPendingDeletePaths.delete(path);
  });
  return normalizedPaths;
}

function _prepareOutlinerDeleteTargets(items) {
  const seen = new Set();
  const unique = (Array.isArray(items) ? items : [])
    .filter(item => item && item.path)
    .map(item => ({
      name: item.name || item.label || String(item.path).split('/').pop() || '',
      path: item.path,
      type: item.type || 'page',
      _comparePath: _normalizeOutlinerPathForCompare(item.path),
    }))
    .filter(item => {
      if (!item._comparePath || seen.has(item._comparePath)) return false;
      seen.add(item._comparePath);
      return true;
    })
    .sort((a, b) => a._comparePath.split('/').length - b._comparePath.split('/').length);
  const roots = [];
  unique.forEach(item => {
    if (roots.some(root => _isOutlinerPathWithin(item._comparePath, root._comparePath))) return;
    roots.push(item);
  });
  return roots.map(({ _comparePath, ...item }) => item);
}

async function _deleteOutlinerTargetsSequentially(targets, options = {}) {
  const results = [];
  for (const item of targets) {
    try {
      const value = await apiPost('/outliner/delete', { path: item.path });
      results.push({ status: 'fulfilled', value });
      const trashRef = _outlinerTrashRefFromResponse(value);
      if (trashRef && typeof options.onSuccess === 'function') {
        try { options.onSuccess(item, value); } catch {}
      }
    } catch (reason) {
      results.push({ status: 'rejected', reason });
      if (typeof options.onFailure === 'function') {
        try { options.onFailure(item, reason); } catch {}
      }
    }
  }
  return results;
}

function _removeOutlinerNodesForPaths(paths) {
  const deletedPaths = (paths || []).map(_normalizeOutlinerPathForCompare).filter(Boolean);
  if (!deletedPaths.length) return;
  const allTreeNodes = document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node');
  allTreeNodes.forEach(nodeEl => {
    const path = nodeEl?._nodeData?.path;
    if (!path) return;
    if (deletedPaths.some(dp => _isOutlinerPathWithin(path, dp))) {
      if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(nodeEl);
      nodeEl.remove();
    }
  });
}

function _removeFolderItemsForPaths(paths) {
  const deletedPaths = (paths || []).map(_normalizeOutlinerPathForCompare).filter(Boolean);
  if (!deletedPaths.length) return;
  const matches = path => deletedPaths.some(dp => _isOutlinerPathWithin(path, dp));

  document.querySelectorAll('#folder-grid .fv-item').forEach(itemEl => {
    const path = itemEl?.dataset?.path || '';
    if (path && matches(path)) itemEl.remove();
  });

  if (typeof _folderItems !== 'undefined' && Array.isArray(_folderItems)) {
    _folderItems = _folderItems.filter(item => !matches(item?.path));
  }
  if (typeof _folderVisibleItems !== 'undefined' && Array.isArray(_folderVisibleItems)) {
    _folderVisibleItems = _folderVisibleItems.filter(item => !matches(item?.path));
  }
  if (typeof _folderSelectedItems !== 'undefined' && Array.isArray(_folderSelectedItems)) {
    _folderSelectedItems = _folderSelectedItems.filter(item => !matches(item?.path));
  }
  if (typeof _folderSelected !== 'undefined' && _folderSelected && matches(_folderSelected.path)) {
    _folderSelected = _folderSelectedItems?.[_folderSelectedItems.length - 1] || null;
  }

  const countEl = document.getElementById('folder-item-count');
  if (countEl && typeof _folderVisibleItems !== 'undefined' && typeof _folderItems !== 'undefined') {
    countEl.textContent = _folderVisibleItems.length + (_folderItems.length !== _folderVisibleItems.length ? ' / ' + _folderItems.length : '') + ' 項目';
  }
  if (typeof _syncFolderCheckboxes === 'function') _syncFolderCheckboxes();
  if (typeof _updateFolderBulkBar === 'function') _updateFolderBulkBar();
  if (typeof _scheduleWaterfallLayout === 'function') _scheduleWaterfallLayout();
}

function _markOutlinerDeletePending(paths) {
  const pendingPaths = _setOutlinerDeletePending(paths, true);
  if (!pendingPaths.length) return pendingPaths;
  _removeOutlinerNodesForPaths(pendingPaths);
  _removeFolderItemsForPaths(pendingPaths);
  if (typeof purgeAppPathReferences === 'function') {
    purgeAppPathReferences(pendingPaths);
  }
  return pendingPaths;
}

function _clearOutlinerDeletePending(paths) {
  return _setOutlinerDeletePending(paths, false);
}

function _outlinerTrashRefFromResponse(response) {
  if (!response?.trash_name) return null;
  return { trash_name: response.trash_name, trash_root: response.trash_root || '' };
}

function _outlinerTrashRefsToNames(refs) {
  return (refs || []).map(ref => ref?.trash_name).filter(Boolean);
}

async function _restoreOutlinerTrashRefs(refs) {
  for (const ref of refs || []) {
    if (!ref?.trash_name) continue;
    await apiPost('/outliner/restore', {
      trash_name: ref.trash_name,
      ...(ref.trash_root ? { trash_root: ref.trash_root } : {}),
    }).catch(() => {});
  }
}

async function _runOutlinerDeleteHistoryRefresh(refresh, phase, result) {
  if (typeof refresh === 'function') {
    await refresh(phase, result);
    return;
  }
  const jobs = [];
  if (typeof loadOutliner === 'function') jobs.push(Promise.resolve(loadOutliner()).catch(() => {}));
  if (typeof renderHomeFolderTree === 'function') jobs.push(Promise.resolve(renderHomeFolderTree()).catch(() => {}));
  if (typeof _folderPath !== 'undefined' && _folderPath && typeof openFolder === 'function') {
    jobs.push(Promise.resolve(openFolder(_folderPath.split('/').pop() || _folderPath, _folderPath, {
      skipShowView: true,
      skipSaveLastView: true,
      skipNavPush: true,
      skipHighlight: true,
      skipGlobalUi: true,
    })).catch(() => {}));
  }
  await Promise.allSettled(jobs);
}

async function deleteOutlinerItemsWithHistory(items, options = {}) {
  const requestedTargets = (Array.isArray(items) ? items : []).filter(item => item && item.path);
  const targets = _prepareOutlinerDeleteTargets(requestedTargets);
  if (!targets.length) {
    return { targets: [], requestedTargets, succeeded: [], skipped: [], failedCount: 0, deletedCount: 0, deletedPaths: [], trashNames: [] };
  }

  const targetPaths = targets.map(item => item.path).filter(Boolean);
  _markOutlinerDeletePending(targetPaths);
  if (typeof options.onOptimisticDelete === 'function') {
    try { options.onOptimisticDelete(targets); } catch {}
  }

  const results = await _deleteOutlinerTargetsSequentially(targets, {
    onSuccess: (item, response) => {
      if (typeof options.onItemDeleted === 'function') options.onItemDeleted(item, response);
    },
    onFailure: (item, reason) => {
      if (typeof options.onItemDeleteFailed === 'function') options.onItemDeleteFailed(item, reason);
    },
  });
  const succeeded = [];
  const skipped = [];
  const failed = [];
  results.forEach((result, index) => {
    const trashRef = result.status === 'fulfilled' ? _outlinerTrashRefFromResponse(result.value) : null;
    if (!trashRef) {
      if (result.status === 'fulfilled' && result.value?.ok) skipped.push(targets[index]);
      else failed.push(targets[index]);
      return;
    }
    succeeded.push({ ...targets[index], ...trashRef });
  });
  const deletedPaths = succeeded.map(item => item.path);
  const deletedCount = requestedTargets.filter(item => deletedPaths.some(path => _isOutlinerPathWithin(item.path, path))).length || succeeded.length;
  const failedCount = targets.length - succeeded.length - skipped.length;
  _clearOutlinerDeletePending(targetPaths);
  if (deletedPaths.length && typeof purgeAppPathReferences === 'function') {
    purgeAppPathReferences(deletedPaths);
  }
  if (failed.length) {
    await _runOutlinerDeleteHistoryRefresh(options.refresh, 'failure', {
      succeeded,
      skipped,
      failed,
      deletedPaths,
      failedPaths: failed.map(item => item.path),
    });
  }

  let trashRefs = succeeded.map(_outlinerTrashRefFromResponse).filter(Boolean);
  let trashNames = _outlinerTrashRefsToNames(trashRefs);
  if (succeeded.length && typeof historyPush === 'function') {
    const label = options.label || (succeeded.length + ' 件を削除');
    const detail = options.detail || succeeded.map(item => item.path).join(', ');
    historyPush(
      label,
      async () => {
        await _restoreOutlinerTrashRefs(trashRefs);
        await _runOutlinerDeleteHistoryRefresh(options.refresh, 'undo', { succeeded, deletedPaths, trashNames });
        if (typeof showStatus === 'function') showStatus(trashNames.length + ' 件を復元しました');
      },
      async () => {
        const nextTrashRefs = [];
        if (deletedPaths.length) _markOutlinerDeletePending(deletedPaths);
        for (const item of succeeded) {
          const res = await apiPost('/outliner/delete', { path: item.path }).catch(() => null);
          const ref = _outlinerTrashRefFromResponse(res);
          if (ref) nextTrashRefs.push(ref);
        }
        if (deletedPaths.length) _clearOutlinerDeletePending(deletedPaths);
        trashRefs = nextTrashRefs;
        trashNames = _outlinerTrashRefsToNames(trashRefs);
        if (deletedPaths.length && typeof purgeAppPathReferences === 'function') {
          purgeAppPathReferences(deletedPaths);
        }
        await _runOutlinerDeleteHistoryRefresh(options.refresh, 'redo', { succeeded, deletedPaths, trashNames });
        if (typeof showStatus === 'function') showStatus(trashNames.length + ' 件を削除しました');
      },
      options.scope || '',
      detail
    );
  }

  return { targets, requestedTargets, succeeded, skipped, failed, failedCount, deletedCount, deletedPaths, trashNames, trashRefs };
}

const MAIN_CALENDAR_SETTINGS_KEYS = ['main-calendar-path', 'main-calendar-id'];

function _refreshMainCalendarSettingAfterHistory() {
  if (typeof loadOutliner === 'function') loadOutliner();
  if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
}

function _captureMainCalendarSettingsHistory() {
  if (typeof captureLocalStorageSettings !== 'function') return null;
  if (typeof isLocalStorageSettingsHistorySuppressed === 'function'
    && isLocalStorageSettingsHistorySuppressed()) return null;
  return captureLocalStorageSettings(MAIN_CALENDAR_SETTINGS_KEYS);
}

function _pushMainCalendarSettingsHistory(label, beforeSnapshot, detail) {
  if (!beforeSnapshot || typeof historyPush !== 'function'
    || typeof captureLocalStorageSettings !== 'function'
    || typeof restoreLocalStorageSettings !== 'function'
    || typeof _normalizeLocalStorageSettingsSnapshots !== 'function') return false;
  const snapshots = _normalizeLocalStorageSettingsSnapshots(
    beforeSnapshot,
    captureLocalStorageSettings(MAIN_CALENDAR_SETTINGS_KEYS)
  );
  let beforeKey = '';
  let afterKey = '';
  try {
    beforeKey = JSON.stringify(snapshots.before);
    afterKey = JSON.stringify(snapshots.after);
  } catch {}
  if (beforeKey && beforeKey === afterKey) return false;
  historyPush(
    label || 'カレンダー: メインカレンダー設定',
    () => restoreLocalStorageSettings(snapshots.before, _refreshMainCalendarSettingAfterHistory),
    () => restoreLocalStorageSettings(snapshots.after, _refreshMainCalendarSettingAfterHistory),
    'calendar:settings',
    detail || ''
  );
  return true;
}

// --- ホバー追加メニュー ---
function _cloudPhase1CreateItems(items) {
  return window.MeldexCloudBootstrap?.filterPhase1CreateItems?.(items) || items;
}

function _isCloudPhase1BlockedCreateType(type) {
  return !!window.MeldexCloudBootstrap?.isPhase1UnsupportedCreateType?.(type);
}

function _showCloudPhase1BlockedCreate(type) {
  if (window.MeldexCloudBootstrap?.showPhase1Unsupported) return window.MeldexCloudBootstrap.showPhase1Unsupported(type);
  showStatus('ブラウザ版Meldexではまだ未対応の作成タイプです', true);
  return false;
}

function _showTreeAddMenu(x, y, nodeEl, nodeData) {
  closeTreeContextMenu();
  const addParent = getAddParentPath(nodeEl, nodeData, { insideTarget: true });
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  _cloudPhase1CreateItems([['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['スマートシート','smart-db','databaseSearch']]).forEach(([label,type,icon]) => {
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
    el.innerHTML = '<span class="menu-icon">' + lucide(icon, 14) + '</span>' + label;
    el.addEventListener('click', async () => { menu.remove(); await addItemAt(addParent, type); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  { const rect = menu.getBoundingClientRect(); const z = _getZoom();
  if (rect.right > window.innerWidth) menu.style.left = ((window.innerWidth - rect.width - 4) / z) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - rect.height - 4) / z) + 'px'; }
  setTimeout(() => {
    const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closer); } };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

// --- 右クリックメニュー ---
function closeTreeContextMenu() {
  document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
}

function _outlinerPathIsAbsolute(path) {
  const value = String(path || '');
  return /^[a-zA-Z]:[\\/]/.test(value) || /^[/\\]{2}/.test(value) || value.startsWith('/');
}

function _outlinerJoinPath(base, rel) {
  const left = String(base || '').replace(/[\\/]+$/, '');
  const right = String(rel || '').replace(/^[\\/]+/, '');
  if (!left) return right;
  if (!right) return left;
  return left + '/' + right;
}

function _outlinerNativeClipboardPath(path) {
  const value = String(path || '');
  if (/^[a-zA-Z]:\//.test(value)) return value.replace(/\//g, '\\');
  if (value.startsWith('//')) return '\\\\' + value.replace(/^\/+/, '').replace(/\//g, '\\');
  return value;
}

function _outlinerLocalCopyPath(nodeEl, nodeData) {
  let path = String(nodeData?.path || '');
  if (!path) return '';
  if (!_outlinerPathIsAbsolute(path)) {
    const rootNode = nodeEl?.closest?.('#outliner-tree > .tree-node');
    const rootPath = rootNode?._nodeData?.path || '';
    const base = nodeEl?.closest?.('#body-home') && _homeFolderPath
      ? _homeFolderPath
      : (rootPath || (typeof state !== 'undefined' ? state.vaultPath : ''));
    if (base && _outlinerPathIsAbsolute(base)) path = _outlinerJoinPath(base, path);
  }
  return _outlinerNativeClipboardPath(path);
}

function showTreeContextMenu(x, y, nodeEl, nodeData, labelEl) {
  closeTreeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const selectedCount = treeSelection.items.size;
  const isMulti = selectedCount > 1;
  const isFolder = nodeData.type === 'folder';
  const isDB = nodeData.type === 'database';
  const isEntity = nodeData.type === 'entity';

  function addMenuItem(text, onclick, cls, icon) {
    const item = document.createElement('div');
    if (icon) {
      item.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' + text;
    } else {
      item.textContent = text;
    }
    if (cls) item.className = cls;
    item.addEventListener('click', onclick);
    menu.appendChild(item);
    return item;
  }
  function addSep() {
    const s = document.createElement('div');
    s.className = 'cm-sep';
    menu.appendChild(s);
  }

  // --- 新規作成サブメニュー ---
  const addParent = getAddParentPath(nodeEl, nodeData, { insideTarget: true });
  if (!(addParent && isItemLocked(addParent))) {
    const createWrap = document.createElement('div');
    createWrap.style.position = 'relative';
    const createTrigger = document.createElement('div');
    createTrigger.className = 'tree-ctx-item';
    createTrigger.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide('plus', 14) + '</span>新規作成' + submenuArrow();
    createTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;';
    const createPanel = document.createElement('div');
    createPanel.className = 'gb-context-menu';
    createPanel.style.cssText = 'display:none;min-width:140px;';
    attachHoverSubmenu(createTrigger, createPanel);
    _cloudPhase1CreateItems([['フォルダ','folder','folder'],['ノート','page','page'],['シナリオ','scriptnote','bookOpenText'],['シート','database','db'],['ボード','board','presentation'],['スマートシート','smart-db','databaseSearch']]).forEach(([label,type,icon]) => {
      const ci = document.createElement('div');
      ci.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' + label;
      ci.style.cssText = 'padding:4px 12px;cursor:pointer;display:flex;align-items:center;';
      ci.addEventListener('click', async () => { closeTreeContextMenu(); await addItemAt(addParent, type); });
      ci.onmouseenter = () => { ci.style.background = 'var(--bg4)'; };
      ci.onmouseleave = () => { ci.style.background = ''; };
      createPanel.appendChild(ci);
    });
    createWrap.appendChild(createTrigger);
    createWrap.appendChild(createPanel);
    menu.appendChild(createWrap);
  }
  addSep();

  // --- 編集ロック ---
  if (!isMulti && nodeData.path && !isEntity) {
    const locked = isItemLocked(nodeData.path);
    const systemLocked = typeof isSystemLockedItem === 'function' && isSystemLockedItem(nodeData.path);
    const canEditLock = typeof isFileLockOwner === 'function' && isFileLockOwner();
    if (systemLocked) {
      const lockedItem = addMenuItem('システム保護', () => {}, null, 'lock');
      lockedItem.style.opacity = '0.65';
      lockedItem.style.cursor = 'default';
      lockedItem.title = 'システム保護中です';
      lockedItem.dataset.gbTooltip = lockedItem.title;
    } else if (!canEditLock) {
      const lockedItem = addMenuItem(locked ? '編集ロック中' : '編集ロック（管理者のみ）', () => {}, null, 'lock');
      lockedItem.style.opacity = '0.65';
      lockedItem.style.cursor = 'default';
      lockedItem.title = '編集ロックの設定は管理者のみ可能です';
      lockedItem.dataset.gbTooltip = lockedItem.title;
    } else {
      const lockWrap = document.createElement('div');
      lockWrap.style.position = 'relative';
      const lockTrigger = document.createElement('div');
      lockTrigger.className = 'tree-ctx-item';
      lockTrigger.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide('lock', 14) + '</span>編集ロック' + submenuArrow();
      lockTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;';
      const lockPanel = document.createElement('div');
      lockPanel.className = 'gb-context-menu';
      lockPanel.style.cssText = 'display:none;min-width:120px;';
      attachHoverSubmenu(lockTrigger, lockPanel);
      [[lucide('lock', 12) + ' 編集ロックする', true], [lucide('unlock', 12) + ' 編集ロック解除', false]].forEach(([label, val]) => {
        const si = document.createElement('div');
        si.innerHTML = radioMark(locked === val) + label;
        si.style.cssText = 'padding:4px 12px;cursor:pointer;' + (locked === val ? 'color:var(--accent);' : '');
        si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
        si.onmouseleave = () => { si.style.background = ''; };
        si.addEventListener('click', async () => {
          closeTreeContextMenu();
          const changed = locked !== val ? await toggleItemLock(nodeData.path) : true;
          if (!changed) return;
          const lbl = nodeEl.querySelector('.tree-label');
          if (lbl) lbl.style.fontStyle = isItemLocked(nodeData.path) ? 'italic' : '';
          showStatus(val ? '編集ロックしました' : '編集ロックを解除しました');
        });
        lockPanel.appendChild(si);
      });
      lockWrap.appendChild(lockTrigger);
      lockWrap.appendChild(lockPanel);
      menu.appendChild(lockWrap);
    }
  }

  const _locked = nodeData.path ? isItemLocked(nodeData.path) : false;

  // --- メインカレンダーに設定（calendarタイプのみ） ---
  if (!isMulti && nodeData.type === 'calendar' && nodeData.path) {
    const mainCalId = localStorage.getItem('main-calendar-id');
    const mainCalPath = localStorage.getItem('main-calendar-path');
    const nodeFid = _pathToFileId(nodeData.path);
    const isMain = (mainCalId && nodeFid && mainCalId === nodeFid) || mainCalPath === nodeData.path;
    const calWrap = document.createElement('div');
    calWrap.style.position = 'relative';
    const calTrigger = document.createElement('div');
    calTrigger.className = 'tree-ctx-item';
    calTrigger.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide('calendar', 14) + '</span>メインカレンダー' + submenuArrow();
    calTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;';
    const calPanel = document.createElement('div');
    calPanel.className = 'gb-context-menu';
    calPanel.style.cssText = 'display:none;min-width:140px;';
    attachHoverSubmenu(calTrigger, calPanel);
    [['設定する', true], ['解除する', false]].forEach(([label, val]) => {
      const si = document.createElement('div');
      si.innerHTML = radioMark(isMain === val) + label;
      si.style.cssText = 'padding:4px 12px;cursor:pointer;' + (isMain === val ? 'color:var(--accent);' : '');
      si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
      si.onmouseleave = () => { si.style.background = ''; };
      si.addEventListener('click', () => {
        closeTreeContextMenu();
        const before = _captureMainCalendarSettingsHistory();
        if (val) {
          localStorage.setItem('main-calendar-path', nodeData.path);
          const mcFid = _pathToFileId(nodeData.path);
          if (mcFid) localStorage.setItem('main-calendar-id', mcFid);
          showStatus(`「${nodeData.name}」をメインカレンダーに設定しました`);
          _pushMainCalendarSettingsHistory('カレンダー: メインカレンダー設定', before, nodeData.path);
        } else {
          localStorage.removeItem('main-calendar-path');
          localStorage.removeItem('main-calendar-id');
          showStatus('メインカレンダー設定を解除しました');
          _pushMainCalendarSettingsHistory('カレンダー: メインカレンダー解除', before, nodeData.path);
        }
      });
      calPanel.appendChild(si);
    });
    calWrap.appendChild(calTrigger);
    calWrap.appendChild(calPanel);
    menu.appendChild(calWrap);
  }

  // --- バージョン管理（フォルダのみ） ---
  if (!isMulti && (isFolder || isDB) && nodeData.path) {
    addSep();
    addMenuItem('バージョンを保存', () => {
      closeTreeContextMenu();
      if (typeof saveFolderVersion === 'function') saveFolderVersion(nodeData.path);
    }, null, 'save');
    addMenuItem('バージョン管理', () => {
      closeTreeContextMenu();
      if (typeof openFolderVersionTab === 'function') openFolderVersionTab(nodeData.path);
      else if (typeof openVersionTab === 'function') openVersionTab(nodeData.path, 'folder');
    }, null, 'gitBranch');
  }

  // --- Notion同期（フォルダのみ） ---
  if (!isMulti && isFolder && nodeData.path && typeof addNotionSyncFolder === 'function') {
    addMenuItem('Notion同期フォルダに追加', () => {
      closeTreeContextMenu();
      addNotionSyncFolder(nodeData.path);
    }, null, 'sync');
  }

  // --- 画像ツール（フォルダのみ） ---
  if (!isMulti && (nodeData.type === 'folder' || nodeData._isRoot) && nodeData.path) {
    addMenuItem('重複画像を検出', () => {
      closeTreeContextMenu();
      showDuplicateScanModal(nodeData.path);
    }, null, 'search');
    addMenuItem('画像インデックスを作成', () => {
      closeTreeContextMenu();
      clipIndexFolder(nodeData.path);
    }, null, 'image');
  }

  // --- 台本で開く（シナリオのみ） ---
  if (!isMulti && nodeData.path && ((nodeData.type === 'scriptnote') || (typeof isScriptNotePath === 'function' && isScriptNotePath(nodeData.path)))) {
    addMenuItem('シナリオで開く', () => {
      closeTreeContextMenu();
      if (typeof openScenarioInScriptNote === 'function' && openScenarioInScriptNote(nodeData.path, nodeData.name || '', { fromExplorer: true })) return;
      showStatus('シナリオエディタを開けませんでした', true);
    }, null, 'fileText');
  }

  if (!isMulti && nodeData.type === 'scenario' && nodeData.path && !(typeof isScriptNotePath === 'function' && isScriptNotePath(nodeData.path))) {
    addMenuItem('シナリオへインポートして開く', () => {
      closeTreeContextMenu();
      if (typeof openScenarioInScriptNote === 'function' && openScenarioInScriptNote(nodeData.path, nodeData.name || '', { fromExplorer: true })) return;
      showStatus('シナリオエディタを開けませんでした', true);
    }, null, 'fileText');
  }

  // --- ファイルのチャット（ファイル/DB/エントリのみ） ---
  if (!isMulti && nodeData.path && nodeData.type !== 'folder' && !nodeData._isRoot) {
    addMenuItem('チャットを開く', () => {
      closeTreeContextMenu();
      openFileChat(nodeData.path);
    }, null, 'messageSquare');
  }

  // --- 比較（ファイル全般） ---
  if (!isMulti && nodeData.path && nodeData.type !== 'folder' && !nodeData._isRoot && typeof showCompareModal === 'function') {
    addMenuItem('比較...', () => {
      closeTreeContextMenu();
      showCompareModal(nodeData.path);
    }, null, 'columns');
  }

  // --- リンクをコピー ---
  if (!isMulti && nodeData.path) {
    addMenuItem('リンクをコピー', () => {
      closeTreeContextMenu();
      const linkPath = nodeData.path;
      const linkName = nodeData.name || linkPath.split(/[/\\]/).pop() || linkPath;
      if (typeof MeldexBroadcast !== 'undefined') {
        MeldexBroadcast.copyMeldexLink(linkName, linkPath, nodeData.type).then(ok => {
          if (ok) showStatus('リンクをコピーしました');
        });
      }
    }, null, 'link');
  }

  // --- リネーム（単一選択時のみ、エントリ以外、ロック中は無効） ---
  if (!isMulti && !isEntity && !_locked && !nodeData._isRoot) {
    addMenuItem('リネーム', () => {
      closeTreeContextMenu();
      startTreeLabelEdit(labelEl, nodeData);
    }, null, 'pencil');
  }

  // --- 複製 ---
  {
    // nodeDataとnodeElをペアで保持し、フィルタ後もインデックスがずれないようにする
    const dupPairs = isMulti
      ? [...treeSelection.items].filter(n => n._nodeData && n._nodeData.path && !n._nodeData._isRoot).map(n => ({ data: n._nodeData, el: n }))
      : (nodeData.path && !nodeData._isRoot ? [{ data: nodeData, el: nodeEl }] : []);
    if (dupPairs.length > 0) {
      const dupLabel = isMulti ? `複製（${dupPairs.length}件）` : '複製';
      addMenuItem(dupLabel, async () => {
        closeTreeContextMenu();
        let count = 0;
        for (const { data: d, el: srcEl } of dupPairs) {
          try {
            const res = await apiPost('/outliner/duplicate', { path: d.path });
            count++;
            const newItem = { ...d, name: res.new_name, path: res.new_path };
            if (res.file_id) newItem.file_id = res.file_id;
            else delete newItem.file_id;
            const parentChildren = srcEl?.parentElement;
            if (parentChildren) {
              const rootPath = srcEl.closest('#outliner-tree > .tree-node')?._nodeData?.path;
              const newNode = createTreeNodeFromBrowse(newItem, rootPath);
              srcEl.nextSibling ? parentChildren.insertBefore(newNode, srcEl.nextSibling) : parentChildren.appendChild(newNode);
            }
          } catch {}
        }
        if (count > 0) showStatus(`${count}件を複製しました`);
        else showStatus('複製に失敗しました', true);
      }, null, 'copy');
    }
  }

  // --- パスをコピー ---
  {
    const pathTargets = isMulti
      ? [...treeSelection.items]
          .map(node => ({ node, data: node._nodeData }))
          .filter(item => item.data?.path)
      : (nodeData.path ? [{ node: nodeEl, data: nodeData }] : []);
    if (pathTargets.length > 0) {
      const pathLabel = isMulti ? `パスをコピー（${pathTargets.length}件）` : 'パスをコピー';
      addMenuItem(pathLabel, () => {
        closeTreeContextMenu();
        const copyPaths = pathTargets.map(item => _outlinerLocalCopyPath(item.node, item.data)).filter(Boolean);
        const paths = copyPaths.join('\n');
        const msg = pathTargets.length === 1
          ? 'パスをコピーしました: ' + copyPaths[0]
          : `パスをコピーしました（${pathTargets.length}件）`;
        navigator.clipboard.writeText(paths).then(() => {
          showStatus(msg);
        }).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = paths; document.body.appendChild(ta);
          ta.select(); document.execCommand('copy'); ta.remove();
          showStatus(msg);
        });
      }, null, 'clipboardList');
    }
  }

  // --- 新しいウィンドウ/タブで開く ---
  if (!isMulti && nodeData.path) {
    const openType = nodeData.type === 'database' ? 'pivot' : (nodeData.type || 'page');
    const openUrl = '/?open=' + encodeURIComponent(openType) + '&path=' + encodeURIComponent(nodeData.path) + '&label=' + encodeURIComponent(nodeData.name || '');
    addMenuItem('新しいタブで開く', () => {
      closeTreeContextMenu();
      _openInNewTab(nodeData.name || '', nodeData.path, openType);
    }, null, 'externalLink');
    addMenuItem('新しいウィンドウで開く', () => {
      closeTreeContextMenu();
      // Chrome --app モードの独立ウィンドウとして開く（Meldex の UI チェーン全体が載る）
      // 通常の window.open だとブラウザのタブバー等が付いて「UI が古く見える」問題になるため、
      // バックエンド経由の _open_app_window_js を優先利用する。
      if (typeof _open_app_window_js === 'function') _open_app_window_js(openUrl);
      else window.open(openUrl, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
    }, null, 'monitor');
  }

  // --- お気に入り ---
  if (!isEntity && nodeData.path) {
    const isFav = getFavorites().some(f => f.path === nodeData.path);
    addMenuItem(isFav ? 'お気に入りを外す' : 'お気に入りに追加', () => {
      closeTreeContextMenu();
      if (isFav) removeFromFavorites(nodeData.path);
      else addToFavorites(nodeData.name, nodeData.path, nodeData.type);
    }, null, isFav ? 'starOff' : 'star');
  }

  // --- エクスポート ---
  if (!isMulti && nodeData.path) {
    const _expItems = [];
    const pushExportItem = (label, url, extension, filetypes) => {
      const baseName = (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.guessNameFromPath === 'function')
        ? MeldexExportSave.guessNameFromPath(nodeData.path, nodeData.name || '無題')
        : (nodeData.name || '無題');
      const stem = String(baseName || '無題').replace(/\.[^.]+$/, '') || '無題';
      _expItems.push({
        label,
        url,
        filename: stem + extension,
        extension,
        filetypes,
      });
    };
    if (nodeData.type === 'database') {
      pushExportItem('CSV', '/export/db?path=' + encodeURIComponent(nodeData.path) + '&format=csv', '.csv', [['CSVファイル', '*.csv'], ['すべてのファイル', '*.*']]);
      pushExportItem('HTML', '/export/db?path=' + encodeURIComponent(nodeData.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
      pushExportItem('Excel', '/export/db?path=' + encodeURIComponent(nodeData.path) + '&format=xlsx', '.xlsx', [['Excelファイル', '*.xlsx'], ['すべてのファイル', '*.*']]);
    } else if (nodeData.type === 'board') {
      pushExportItem('HTML', '/export/canvas?path=' + encodeURIComponent(nodeData.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
      pushExportItem('SVG画像', '/export/canvas?path=' + encodeURIComponent(nodeData.path) + '&format=svg', '.svg', [['SVGファイル', '*.svg'], ['すべてのファイル', '*.*']]);
      pushExportItem('Markdown', '/export/canvas?path=' + encodeURIComponent(nodeData.path) + '&format=md', '.md', [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']]);
    } else if (nodeData.type === 'page') {
      pushExportItem('テキスト', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=txt', '.txt', [['テキストファイル', '*.txt'], ['すべてのファイル', '*.*']]);
      pushExportItem('Markdown', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=md', '.md', [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']]);
      pushExportItem('HTML', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=html', '.html', [['HTMLファイル', '*.html'], ['すべてのファイル', '*.*']]);
      pushExportItem('Word', '/export/note?path=' + encodeURIComponent(nodeData.path) + '&format=docx', '.docx', [['Wordファイル', '*.docx'], ['すべてのファイル', '*.*']]);
    }
    if (_expItems.length > 0) {
      // エクスポートサブメニュー
      const expWrap = document.createElement('div');
      expWrap.style.position = 'relative';
      const expTrigger = document.createElement('div');
      const exportIconName = typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload';
      expTrigger.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(exportIconName, 14) + '</span>エクスポート' + submenuArrow();
      expTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;';
      expTrigger.onmouseenter = () => { expTrigger.style.background = 'var(--bg4)'; };
      expTrigger.onmouseleave = () => { expTrigger.style.background = ''; };
      const expPanel = document.createElement('div');
      expPanel.className = 'gb-context-menu';
      expPanel.style.cssText = 'display:none;min-width:140px;';
      attachHoverSubmenu(expTrigger, expPanel);
      _expItems.forEach(ei => {
        const ei2 = document.createElement('div');
        ei2.textContent = ei.label;
        ei2.style.cssText = 'padding:4px 12px;cursor:pointer;';
        ei2.addEventListener('click', async () => {
          closeTreeContextMenu();
          if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
            showStatus('保存ダイアログを初期化できませんでした', true);
            return;
          }
          await MeldexExportSave.saveUrl(ei.url, {
            filename: ei.filename,
            extension: ei.extension,
            dialogTitle: `${ei.label}として保存`,
            filetypes: ei.filetypes,
            okMessage: `${ei.label} として保存しました`,
            errorMessage: `${ei.label} の保存に失敗しました`,
            path: nodeData.path,
            title: nodeData.name || '無題',
          });
        });
        ei2.onmouseenter = () => { ei2.style.background = 'var(--bg4)'; };
        ei2.onmouseleave = () => { ei2.style.background = ''; };
        expPanel.appendChild(ei2);
      });
      expWrap.appendChild(expTrigger);
      expWrap.appendChild(expPanel);
      addSep();
      menu.appendChild(expWrap);
    }
  }

  // --- 所属フォルダ（リンク登録） ---
  if (!isEntity && nodeData.path) {
    addMenuItem('所属フォルダを設定...', () => {
      closeTreeContextMenu();
      showAddFolderLinkModal(nodeData.path, null);
    }, null, 'link2');
  }

  // --- 色設定 ---
  addSep();
  {
    const currentColor = getNodeColor(nodeData.path);
    const colorItem = document.createElement('div');
    colorItem.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 12px;cursor:pointer;';
    colorItem.onmouseenter = () => { colorItem.style.background = 'var(--bg4)'; };
    colorItem.onmouseleave = () => { colorItem.style.background = ''; };
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'gb-color-swatch gb-color-swatch--inline';
    setColorSwatchValue(swatch, currentColor || 'var(--fg)');
    colorItem.appendChild(swatch);
    const clbl = document.createElement('span');
    clbl.textContent = isMulti ? `色設定（${selectedCount}件）` : '色設定';
    colorItem.appendChild(clbl);
    colorItem.addEventListener('click', () => {
      openColorPalette(swatch, currentColor, (c) => {
        closeTreeContextMenu();
        applyColorToSelection(c || null);
      });
    });
    menu.appendChild(colorItem);
  }

  // --- ルートフォルダのパス変更 ---
  if (nodeData._isRoot && !isMulti) {
    addSep();
    addMenuItem('パスを変更...', async () => {
      closeTreeContextMenu();
      showStatus('フォルダ選択ダイアログを開いています...');
      try {
        const res = await apiFetch('/pick-folder');
        if (!res.path) { showStatus('キャンセルされました'); return; }
        // outliner_rootsを更新
        const roots = await apiFetch('/outliner-roots');
        const root = roots.find(r => r.path === nodeData.path);
        if (root) {
          root.path = res.path;
          root.name = res.path.split(/[/\\]/).pop();
          await apiPut('/outliner-roots', { roots });
          await loadOutliner();
          showStatus('パスを変更しました: ' + res.path);
        }
      } catch (e) { showStatus('パス変更に失敗しました', true); }
    }, null, 'folderPen');
    addMenuItem('名前を変更...', async () => {
      closeTreeContextMenu();
      const roots = await apiFetch('/outliner-roots');
      const root = roots.find(r => r.path === nodeData.path);
      if (!root) return;
      const newName = await cfPrompt('表示名を入力:', root.name);
      if (!newName) return;
      root.name = newName;
      await apiPut('/outliner-roots', { roots });
      await loadOutliner();
      showStatus('名前を変更しました');
    }, null, 'pencil');
    addMenuItem('チーム管理...', async () => {
      closeTreeContextMenu();
      showSettingsModal({ panel: 'ユーザー', teamFolder: nodeData.path });
    }, null, 'users');
    addSep();
    addMenuItem('このソースフォルダを削除', async () => {
      closeTreeContextMenu();
      if (!await cfConfirm('ソースフォルダ「' + nodeData.name + '」をフォルダツリーから削除しますか？\n（ファイルは削除されません）')) return;
      const roots = await apiFetch('/outliner-roots');
      const newRoots = roots.filter(r => r.path !== nodeData.path);
      await apiPut('/outliner-roots', { roots: newRoots });
      await loadOutliner();
      showStatus('ソースフォルダを削除しました');
    }, null, 'trash2');
  }

  // --- 作品フォルダ設定（フォルダのみ） ---
  if (isFolder && !isMulti) {
    const curWork = getWorkFolder();
    const isWork = curWork === nodeData.path;
    const wfWrap = document.createElement('div');
    wfWrap.style.position = 'relative';
    const wfTrigger = document.createElement('div');
    wfTrigger.className = 'tree-ctx-item';
    wfTrigger.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide('folder', 14) + '</span>作品フォルダ' + submenuArrow();
    wfTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;';
    const wfPanel = document.createElement('div');
    wfPanel.className = 'gb-context-menu';
    wfPanel.style.cssText = 'display:none;min-width:140px;';
    attachHoverSubmenu(wfTrigger, wfPanel);
    [['設定する', true], ['解除する', false]].forEach(([label, setIt]) => {
      const si = document.createElement('div');
      si.innerHTML = radioMark(isWork === setIt) + label;
      si.style.cssText = 'padding:4px 12px;cursor:pointer;' + (isWork === setIt ? 'color:var(--accent);' : '');
      si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
      si.onmouseleave = () => { si.style.background = ''; };
      si.addEventListener('click', async () => {
        closeTreeContextMenu();
        if (setIt) {
          setWorkFolder(nodeData.path);
          showStatus(`「${nodeData.name}」を作品フォルダに設定しました`);
        } else {
          setWorkFolder('');
          showStatus('作品フォルダの設定を解除しました');
        }
        await loadLinkDict();
        tooltipCache = {};
        await loadOutliner();
      });
      wfPanel.appendChild(si);
    });
    wfWrap.appendChild(wfTrigger);
    wfWrap.appendChild(wfPanel);
    menu.appendChild(wfWrap);
  }

  // --- 並び替え（フォルダ・DB） ---
  if ((isFolder || isDB || isEntity) && !isMulti) {
    const sortPath = nodeData.path;
    const curSort = getSortForFolder(sortPath);
    // サブメニュー風: 1項目でクリック→展開
    const sortWrap = document.createElement('div');
    sortWrap.style.position = 'relative';
    const sortTrigger = document.createElement('div');
    sortTrigger.className = 'tree-ctx-item';
    sortTrigger.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide('arrowUpDown', 14) + '</span>並び替え' + submenuArrow();
    sortTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;';
    const sortPanel = document.createElement('div');
    sortPanel.className = 'gb-context-menu';
    sortPanel.style.cssText = 'display:none;min-width:140px;';
    attachHoverSubmenu(sortTrigger, sortPanel);
    const sortOpts = [
      { label: 'マニュアル', sort: 'manual', order: 'asc' },
      { label: '名前 ↑', sort: 'name', order: 'asc' },
      { label: '名前 ↓', sort: 'name', order: 'desc' },
      { label: '更新日時 ↑', sort: 'modified', order: 'asc' },
      { label: '更新日時 ↓', sort: 'modified', order: 'desc' },
      { label: '作成日時 ↑', sort: 'created', order: 'asc' },
      { label: '作成日時 ↓', sort: 'created', order: 'desc' },
    ];
    sortOpts.forEach(o => {
      const active = curSort.sort === o.sort && curSort.order === o.order;
      const si = document.createElement('div');
      si.innerHTML = radioMark(active) + o.label;
      si.style.cssText = 'padding:4px 12px;cursor:pointer;' + (active ? 'color:var(--accent);' : '');
      si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
      si.onmouseleave = () => { si.style.background = ''; };
      si.addEventListener('click', async () => {
        closeTreeContextMenu();
        const before = captureOutlinerSettingsHistory([SORT_SETTINGS_KEY]);
        setSortSetting(sortPath, o.sort, o.order);
        pushOutlinerSettingsHistory(
          'フォルダツリー: 並び替え設定',
          before,
          sortPath + ' / ' + o.label,
          [SORT_SETTINGS_KEY]
        );
        const childrenDiv = nodeEl.querySelector(':scope > .tree-children');
        if (childrenDiv) {
          if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(childrenDiv);
          childrenDiv.innerHTML = '';
          childrenDiv.dataset.loaded = 'false';
        }
        const toggle = nodeEl.querySelector('.tree-toggle');
        if (toggle && toggle.dataset.expanded === 'true') {
          toggle.dataset.expanded = 'false'; toggle.click();
        }
      });
      sortPanel.appendChild(si);
    });
    sortWrap.appendChild(sortTrigger);
    sortWrap.appendChild(sortPanel);
    addSep();
    menu.appendChild(sortWrap);
  }

  // --- 削除（エントリ以外、ロック中は無効） ---
  if (!isEntity && !_locked && !nodeData._isRoot) {
    addSep();
    const delLabel = isMulti ? `削除（${selectedCount}件）` : '削除';
    addMenuItem(delLabel, async () => {
      closeTreeContextMenu();
      const targets = treeSelection.getNodeData().filter(d => {
        if (d.type === 'entity' || d._isRoot) return false;
        if (!d.path || typeof isItemLocked !== 'function') return true;
        return !isItemLocked(d.path);
      });
      if (!targets.length) {
        showStatus('削除できる項目がありません', true);
        return;
      }
      const names = targets.map(d => d.name).join('、');
      if (!await cfConfirm(`「${names}」を削除しますか？`)) return;
      treeSelection.clear();
      const result = await deleteOutlinerItemsWithHistory(targets, {
        label: targets.length + ' 件を削除',
        detail: names,
        onItemDeleted: (item) => {
          _removeOutlinerNodesForPaths([item.path]);
        },
        refresh: async () => {
          if (typeof loadOutliner === 'function') await loadOutliner();
          if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
        },
      });
      _removeOutlinerNodesForPaths(result.deletedPaths);
      if (result.failedCount) {
        showStatus(`${result.deletedCount || result.succeeded.length}件を削除、${result.failedCount}件は失敗しました`, true);
        loadOutliner();
      } else if (result.succeeded.length) {
        showStatus(`${result.deletedCount || result.succeeded.length}件を削除しました（Undoで戻せます）`);
      } else if (result.skipped.length) {
        showStatus('削除対象が見つからなかったため、表示を更新しました', true);
        loadOutliner();
      }
    }, 'danger', 'trash2');
  }

  // --- スプリットビュー ---
  if (!isMulti && isDB && nodeData.path && typeof isSplitActive === 'function') {
    addSep();
    if (isSplitActive()) {
      addMenuItem('別の作業領域で開く', () => { closeTreeContextMenu(); openDbInOtherPane(nodeData.path); }, null, 'columns');
    } else {
      addMenuItem('スプリットで開く', () => { closeTreeContextMenu(); openInNewSplit(nodeData.path); }, null, 'columns');
    }
  }

  document.body.appendChild(menu);
  { const rect = menu.getBoundingClientRect(); const z = _getZoom();
  if (rect.right > window.innerWidth) menu.style.left = ((window.innerWidth - rect.width - 4) / z) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - rect.height - 4) / z) + 'px'; }

  // OSシェルメニュー項目を非同期追加
  if (nodeData.path && typeof appendShellVerbsToMenu === 'function') {
    appendShellVerbsToMenu(menu, nodeData.path);
  }

  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(e) {
      // body 直下に分離したサブメニューも考慮
      const inAnyMenu = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(e.target));
      if (!inAnyMenu) { closeTreeContextMenu(); document.removeEventListener('pointerdown', closer); }
    });
  }, 0);
}

// 追加先の親パスを決定
function getAddParentPath(nodeEl, nodeData, options = {}) {
  const isContainer = nodeData.type === 'folder' || nodeData.type === 'database';
  if (isContainer && options.insideTarget && nodeData.path) return nodeData.path;
  if (nodeData._isRoot && nodeData.path) return nodeData.path;
  if (isContainer) {
    // フォルダ/DBが展開中ならその中、閉じているなら同階層
    const toggle = nodeEl.querySelector('.tree-toggle');
    if (toggle && toggle.dataset.expanded === 'true') return nodeData.path;
  }
  // ファイルやエントリ、閉じたフォルダ → 親フォルダのパス
  const parentContainer = nodeEl.parentElement;
  const parentNode = parentContainer?.closest('.tree-node');
  if (parentNode && parentNode._nodeData) return parentNode._nodeData.path;
  // ホーム内のルート直下ノード → ホームフォルダパスを返す
  if (nodeEl.closest('#body-home') && _homeFolderPath) return _homeFolderPath;
  return ''; // ソースフォルダルート
}

// 選択中の全ノードに色を適用
function applyColorToSelection(color) {
  const before = captureOutlinerSettingsHistory([NODE_COLORS_KEY]);
  const detail = [...treeSelection.items]
    .map(nodeEl => nodeEl._nodeData?.path || nodeEl._nodeData?.name || '')
    .filter(Boolean)
    .join(', ');
  treeSelection.items.forEach(nodeEl => {
    const data = nodeEl._nodeData;
    if (!data) return;
    const row = nodeEl.querySelector('.tree-node-row');
    if (row) applyNodeColor(row, color);
    if (data.path) setNodeColor(data.path, color);
  });
  pushOutlinerSettingsHistory(
    color ? 'フォルダツリー: 色設定' : 'フォルダツリー: 色リセット',
    before,
    detail,
    [NODE_COLORS_KEY]
  );
  showStatus(color ? '色を設定しました' : '色をリセットしました');
}

function _resolveOutlinerCreateInsertTarget(parentPath, options) {
  const expandUnloaded = options?.expandUnloaded !== false;
  let container;
  let deferTreeInsert = false;
  if (parentPath) {
    const parentNode = typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(parentPath) : null;
    if (parentNode) {
      const childrenDiv = parentNode.querySelector(':scope > .tree-children');
      if (childrenDiv) {
        const toggle = parentNode.querySelector('.tree-toggle');
        if (childrenDiv.dataset.loaded === 'false') {
          deferTreeInsert = true;
          if (expandUnloaded && toggle && toggle.dataset.expanded !== 'true') toggle.click();
        } else {
          childrenDiv.classList.remove('collapsed');
          if (toggle) { toggle.classList.add('expanded'); toggle.dataset.expanded = 'true'; }
          container = childrenDiv;
        }
      }
    }
    if (!container && _homeFolderPath && parentPath === _homeFolderPath) {
      container = document.getElementById('body-home');
    }
  }
  if (!container && !deferTreeInsert) container = document.getElementById('outliner-tree');
  return { container, deferTreeInsert };
}

function _insertOutlinerCreateNode(container, newNode) {
  if (!container || !newNode) return;
  const sel = treeSelection.lastClicked;
  if (sel && sel._nodeData && sel.parentElement === container) {
    const selType = sel._nodeData.type;
    if (selType !== 'folder' && selType !== 'database') {
      container.insertBefore(newNode, sel.nextSibling);
      return;
    }
  }
  container.appendChild(newNode);
}

function _selectOutlinerCreateNode(newNode) {
  if (!newNode) return;
  treeSelection.clear();
  treeSelection.add(newNode);
  treeSelection.lastClicked = newNode;
  document.querySelectorAll('.tree-node-row.active').forEach(r => r.classList.remove('active'));
  newNode.querySelector('.tree-node-row')?.classList.add('active');
}

function _createOutlinerPendingCreateNode(type, label) {
  const item = {
    name: label || '無題',
    type,
    path: '__meldex_pending_create_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    _pendingCreate: true,
  };
  const node = createTreeNodeFromBrowse(item);
  node.classList.add('tree-node-pending-create');
  const row = node.querySelector(':scope > .tree-node-row');
  const labelEl = node.querySelector(':scope > .tree-node-row .tree-label');
  if (row) {
    row.draggable = false;
    row.style.opacity = '0.62';
    row.style.fontStyle = 'italic';
  }
  if (labelEl) labelEl.textContent = (label || '無題') + '（作成中）';
  const block = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['click', 'dblclick', 'contextmenu', 'dragstart'].forEach(eventName => {
    node.addEventListener(eventName, block, true);
  });
  return node;
}

function _openOutlinerCreatedNode(nd, name) {
  const _expOpts = { fromExplorer: true };
  if (nd.type === 'page') openPage(name, nd.path, _expOpts);
  else if (nd.type === 'board') openBoard(name, nd.path, _expOpts);
  else if (nd.type === 'scriptnote' || (typeof isScriptNotePath === 'function' && isScriptNotePath(nd.path))) {
    if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(nd.path, name, _expOpts);
  }
  else if (nd.type === 'scenario') { if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(nd.path, name, _expOpts); }
  else if (nd.type === 'database') selectDatabase(nd.path, null, _expOpts);
  else if (nd.type === 'smart-db') { if (typeof openSmartDbFile === 'function') openSmartDbFile(name, nd.path, _expOpts); }
}

// アイテムを指定パス配下に追加（部分更新、チラつき防止）
async function addItemAt(parentPath, type) {
  if (_isCloudPhase1BlockedCreateType(type)) {
    _showCloudPhase1BlockedCreate(type);
    return;
  }
  const label = '無題';
  const target = _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: false });
  let pendingNode = null;
  if (!target.deferTreeInsert && target.container) {
    pendingNode = _createOutlinerPendingCreateNode(type, label);
    _insertOutlinerCreateNode(target.container, pendingNode);
    pendingNode.scrollIntoView({ block: 'nearest' });
  }
  try {
    const res = await apiPost('/outliner/add', { type, label, parent: parentPath });
    // サーバーはlabelを返すが、createTreeNodeFromBrowseはnameを使う
    if (!res.node.name) res.node.name = res.node.label;

    const insertTarget = target.deferTreeInsert
      ? _resolveOutlinerCreateInsertTarget(parentPath, { expandUnloaded: true })
      : target;
    const newNode = insertTarget.deferTreeInsert ? null : createTreeNodeFromBrowse(res.node);

    if (!insertTarget.deferTreeInsert && newNode) {
      if (pendingNode && pendingNode.parentNode) pendingNode.replaceWith(newNode);
      else _insertOutlinerCreateNode(insertTarget.container, newNode);
    }

    if (!insertTarget.deferTreeInsert) newNode.scrollIntoView({ block: 'nearest' });
    const nd = res.node;
    const name = nd.name || nd.label || label;
    // 選択状態にする
    if (!insertTarget.deferTreeInsert) _selectOutlinerCreateNode(newNode);
    // コンテンツを開く
    _openOutlinerCreatedNode(nd, name);
  } catch (e) {
    if (pendingNode && pendingNode.parentNode) pendingNode.remove();
    showStatus((e && e.message) || '追加に失敗しました', true);
  }
}

// ヘッダーボタンからの追加（選択中アイテムのコンテキストを考慮）
async function showAddOutlinerItem(type) {
  // 選択中のアイテムから追加先を決定
  let parentPath = '';
  if (treeSelection.lastClicked && treeSelection.lastClicked._nodeData) {
    // ホーム内のノードが選択されている場合
    if (treeSelection.lastClicked.closest('#body-home') && _homeFolderPath) {
      const nd = treeSelection.lastClicked._nodeData;
      if (nd.type === 'folder' || nd.type === 'database') {
        const toggle = treeSelection.lastClicked.querySelector('.tree-toggle');
        parentPath = (toggle && toggle.dataset.expanded === 'true') ? nd.path : _homeFolderPath;
      } else {
        const pn = treeSelection.lastClicked.parentElement?.closest('.tree-node');
        parentPath = pn?._nodeData?.path || _homeFolderPath;
      }
    } else {
      parentPath = getAddParentPath(treeSelection.lastClicked, treeSelection.lastClicked._nodeData);
    }
  }
  // 何も選択されていない場合、ホームフォルダにフォールバック
  if (!parentPath && _homeFolderPath) {
    parentPath = _homeFolderPath;
  }
  await addItemAt(parentPath, type);
}

// フォルダツリーのラベルをインライン編集
function startTreeLabelEdit(labelEl, nodeData, onFinish) {
  const old = labelEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = old === '無題' ? '' : old;
  input.placeholder = '名前を入力';
