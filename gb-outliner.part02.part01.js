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
  const batchTargets = (Array.isArray(targets) ? targets : []).filter(item => item && item.path);
  if (batchTargets.length) {
    try {
      const payload = await apiPost('/outliner/delete-batch', {
        items: batchTargets.map(item => ({ path: item.path })),
      });
      const batchResults = Array.isArray(payload?.results) ? payload.results : [];
      if (batchResults.length === batchTargets.length) {
        return batchResults.map((entry, index) => {
          const item = batchTargets[index];
          if (entry?.ok) {
            const value = entry.value || { ok: true };
            const trashRef = _outlinerTrashRefFromResponse(value);
            if (trashRef && typeof options.onSuccess === 'function') {
              try { options.onSuccess(item, value); } catch {}
            }
            return { status: 'fulfilled', value };
          }
          const reason = entry?.detail || entry?.error || '削除に失敗しました';
          if (typeof options.onFailure === 'function') {
            try { options.onFailure(item, reason); } catch {}
          }
          return { status: 'rejected', reason };
        });
      }
    } catch {}
  }
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
  const restored = [];
  for (const ref of refs || []) {
    if (!ref?.trash_name) continue;
    try {
      const result = await apiPost('/outliner/restore', {
        trash_name: ref.trash_name,
        ...(ref.trash_root ? { trash_root: ref.trash_root } : {}),
      });
      restored.push(result);
    } catch (error) {
      const message = error?.message ? String(error.message) : '復元に失敗しました';
      throw new Error(ref.trash_name + ' の復元に失敗しました: ' + message);
    }
  }
  return restored;
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
        const restored = await _restoreOutlinerTrashRefs(trashRefs);
        await _runOutlinerDeleteHistoryRefresh(options.refresh, 'undo', { succeeded, deletedPaths, trashNames });
        if (typeof showStatus === 'function') showStatus((restored.length || trashNames.length) + ' 件を復元しました');
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
    const openType = typeof _normalizeOpenTypeForNav === 'function'
      ? _normalizeOpenTypeForNav(nodeData.type)
      : (nodeData.type === 'database' ? 'pivot' : (nodeData.type === 'scenario' ? 'scriptnote' : (nodeData.type || 'page')));
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
