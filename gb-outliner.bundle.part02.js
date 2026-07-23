}
function _readCachedFileLocks() {
  const data = _legacyLockedItems();
  return Array.isArray(data.entries) ? data.entries : [];
}
function _primeFileLockCacheFromStorage() {
  if (_fileLockLoaded || _fileLockEntries.length) return _fileLockEntries;
  _fileLockEntries = _readCachedFileLocks();
  return _fileLockEntries;
}
function _fileLockEntryFromEntries(entries, path) {
  const fid = typeof _pathToFileId === 'function' ? _pathToFileId(path) : '';
  const target = _normalizeLockedItemPath(path);
  return (entries || []).find(entry => {
    if (fid && entry?.file_id === fid) return true;
    const base = _normalizeLockedItemPath(entry?.normalized_path || entry?.path || '');
    return base && (target === base || target.startsWith(base + '/'));
  }) || null;
}
async function _migrateLegacyLocksToServerIfOwner() {
  if (_legacyFileLocksMigrated) return;
  _legacyFileLocksMigrated = true;
  await _ensureRoleLoaded();
  if (!isFileLockOwner()) return;
  const legacy = _legacyLockedItems();
  if (!legacy || Array.isArray(legacy.entries)) return;
  const pairs = Object.entries(legacy).filter(([, value]) => value === true);
  if (!pairs.length) return;
  for (const [key] of pairs) {
    const path = (typeof _fileIdToPath === 'function' && _fileIdToPath(key)) || key;
    if (!path || _isFileLockSystemExcluded(path)) continue;
    try {
      await _fileLockApi('/file-lock', {
        method: 'PUT',
        body: JSON.stringify({ path, file_id: path === key ? '' : key }),
      });
    } catch {}
  }
}
async function _ensureLocksLoaded(options = {}) {
  const force = !!options.force;
  if (_fileLockLoaded && !force) return _fileLockEntries;
  if (_fileLockLoadPromise && !force) return _fileLockLoadPromise;
  _fileLockLoadPromise = (async () => {
    await _ensureRoleLoaded();
    await _migrateLegacyLocksToServerIfOwner();
    try {
      const data = await _fileLockApi('/file-lock');
      _writeFileLockCache(data.entries || []);
    } catch {
      _writeFileLockCache(_readCachedFileLocks());
    }
    if (!_fileLockRefreshTimer) {
      _fileLockRefreshTimer = setInterval(() => {
        _ensureLocksLoaded({ force: true })
          .then(() => window.MeldexFileLockBadge?.refreshAll?.())
          .catch(() => {});
      }, 5 * 60 * 1000);
    }
    return _fileLockEntries;
  })();
  try { return await _fileLockLoadPromise; }
  finally { _fileLockLoadPromise = null; }
}
function getLockedItems() { return { entries: _fileLockEntries.slice() }; }
function _fileLockEntryForPath(path) {
  if (isSystemLockedItem(path)) return { system: true, path, lock_reason: 'システム保護' };
  const fid = typeof _pathToFileId === 'function' ? _pathToFileId(path) : '';
  if (_fileLockLoaded || _fileLockEntries.length) return _fileLockEntryFromEntries(_fileLockEntries, path);
  const legacy = _legacyLockedItems();
  if (fid && legacy[fid]) return { path, file_id: fid };
  return legacy[path] ? { path } : null;
}
function isItemLocked(path) {
  if (isSystemLockedItem(path)) return true;
  return !!_fileLockEntryForPath(path);
}
function getItemLockReason(path) {
  const entry = _fileLockEntryForPath(path);
  return String(entry?.lock_reason || '').trim();
}

function _fileLockHistorySnapshot(path) {
  const entry = _fileLockEntryForPath(path);
  if (!entry || entry.system) return null;
  return {
    path: entry.path || path,
    file_id: entry.file_id || ((typeof _pathToFileId === 'function' && _pathToFileId(path)) || ''),
    lock_reason: entry.lock_reason || entry.reason || '',
  };
}

function _sameFileLockHistorySnapshot(a, b) {
  try { return JSON.stringify(a || null) === JSON.stringify(b || null); }
  catch { return false; }
}

async function _restoreFileLockHistorySnapshot(path, snapshot) {
  await _ensureRoleLoaded();
  if (!isFileLockOwner()) {
    if (typeof showStatus === 'function') showStatus('編集ロックの履歴復元は管理者のみ可能です', true);
    return false;
  }
  if (snapshot) {
    await _fileLockApi('/file-lock', {
      method: 'PUT',
      body: JSON.stringify({
        path: snapshot.path || path,
        file_id: snapshot.file_id || ((typeof _pathToFileId === 'function' && _pathToFileId(path)) || ''),
        reason: snapshot.lock_reason || '',
      }),
    });
  } else {
    await _fileLockApi('/file-lock?path=' + encodeURIComponent(path), { method: 'DELETE' });
  }
  await _ensureLocksLoaded({ force: true });
  await refreshOutliner();
  if (typeof refreshVisibleFolderLockState === 'function') refreshVisibleFolderLockState();
  return true;
}

function pushOutlinerFileLockHistory(path, beforeSnapshot, afterSnapshot) {
  if (typeof historyPush !== 'function') return false;
  if (_sameFileLockHistorySnapshot(beforeSnapshot, afterSnapshot)) return false;
  const label = afterSnapshot ? 'フォルダツリー: 編集ロック' : 'フォルダツリー: 編集ロック解除';
  historyPush(
    label,
    () => _restoreFileLockHistorySnapshot(path, beforeSnapshot),
    () => _restoreFileLockHistorySnapshot(path, afterSnapshot),
    'outliner:file-lock',
    path || ''
  );
  return true;
}

async function toggleItemLock(path) {
  try {
    if (isSystemLockedItem(path)) return false;
    if (_isFileLockSystemExcluded(path)) {
      if (typeof showStatus === 'function') showStatus('システムフォルダは編集ロックできません', true);
      return false;
    }
    await _ensureRoleLoaded();
    if (!isFileLockOwner()) {
      if (typeof showStatus === 'function') showStatus('編集ロックの設定は管理者のみ可能です', true);
      return false;
    }
    await _ensureLocksLoaded();
    const locked = isItemLocked(path);
    const before = _fileLockHistorySnapshot(path);
    if (locked) {
      await _fileLockApi('/file-lock?path=' + encodeURIComponent(path), { method: 'DELETE' });
    } else {
      // ダイアログ禁止原則: window.prompt は使わない。
      // 編集ロックの理由は任意であり、後から付箋注釈・履歴ノートで補足できるため、
      // ロック取得時点では空でセットし、必要なら後段で編集する運用にする。
      await _fileLockApi('/file-lock', {
        method: 'PUT',
        body: JSON.stringify({ path, file_id: (typeof _pathToFileId === 'function' && _pathToFileId(path)) || '', reason: '' }),
      });
    }
    await _ensureLocksLoaded({ force: true });
    const after = _fileLockHistorySnapshot(path);
    pushOutlinerFileLockHistory(path, before, after);
    await refreshOutliner();
    window.MeldexFileLockBadge?.refreshAll?.();
    return true;
  } catch (error) {
    const message = error?.message ? String(error.message) : '更新に失敗しました';
    if (typeof showStatus === 'function') showStatus('編集ロックの更新に失敗しました: ' + message, true);
    try { await _ensureLocksLoaded({ force: true }); } catch {}
    if (typeof refreshVisibleOutlinerLockState === 'function') refreshVisibleOutlinerLockState();
    if (typeof refreshVisibleFolderLockState === 'function') refreshVisibleFolderLockState();
    return false;
  }
}

function _applyOutlinerLockStateToNode(nodeEl) {
  if (!nodeEl || !nodeEl._nodeData) return;
  const item = nodeEl._nodeData;
  const row = nodeEl.querySelector(':scope > .tree-node-row');
  const label = row?.querySelector('.tree-label');
  if (!row || !label || !item.path) return;
  row.querySelector('.tree-lock-badge')?.remove();
  const locked = isItemLocked(item.path);
  row.draggable = !locked && !item._isRoot && item.type !== 'entity';
  label.style.fontStyle = locked ? 'italic' : '';
  _syncOutlinerAddHoverButton(nodeEl, item, locked);
  if (!locked) {
    row.removeAttribute('title');
    delete row.dataset.gbTooltip;
    return;
  }
  const lockBadge = document.createElement('span');
  lockBadge.className = 'tree-lock-badge';
  lockBadge.innerHTML = lucide('lock', 12);
  const lockReason = typeof getItemLockReason === 'function' ? getItemLockReason(item.path) : '';
  lockBadge.title = isSystemLockedItem(item.path) ? 'システム保護中です' : ('編集ロック中' + (lockReason ? ': ' + lockReason : ''));
  lockBadge.dataset.gbTooltip = lockBadge.title;
  lockBadge.style.cssText = 'display:inline-flex;align-items:center;opacity:0.65;margin-left:4px;flex-shrink:0;';
  row.title = lockBadge.title;
  row.dataset.gbTooltip = lockBadge.title;
  row.appendChild(lockBadge);
}

const OUTLINER_CONFLICT_PATHS = new Set();

function _normalizeOutlinerConflictPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function _outlinerConflictBasename(path) {
  const normalized = _normalizeOutlinerConflictPath(path).replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function _isOutlinerDropboxConflictName(name) {
  const normalized = String(name || '').replace(/_/g, ' ');
  return /\bconflicted\s+copy\b/i.test(normalized) || /競合.*コピー/.test(normalized);
}

function _outlinerOriginalPathForConflictPath(path) {
  const normalized = _normalizeOutlinerConflictPath(path);
  const index = normalized.lastIndexOf('/');
  const dir = index >= 0 ? normalized.slice(0, index) : '';
  const name = index >= 0 ? normalized.slice(index + 1) : normalized;
  const match = /^(.*)\s+\((?:[^)]*conflicted\s+copy[^)]*|[^)]*競合[^)]*コピー[^)]*)\)(\.[^.]*)?$/i.exec(name);
  if (!match) return '';
  const originalName = `${match[1] || ''}${match[2] || ''}`.trim();
  if (!originalName) return '';
  return dir ? `${dir}/${originalName}` : originalName;
}

function _registerOutlinerConflictPaths(items) {
  if (!Array.isArray(items)) return;
  const paths = new Set(items.map(item => _normalizeOutlinerConflictPath(item?.path)).filter(Boolean));
  items.forEach(item => {
    const path = _normalizeOutlinerConflictPath(item?.path);
    if (!path || !_isOutlinerDropboxConflictName(_outlinerConflictBasename(path))) return;
    OUTLINER_CONFLICT_PATHS.add(path);
    const originalPath = _outlinerOriginalPathForConflictPath(path);
    if (originalPath && paths.has(originalPath)) OUTLINER_CONFLICT_PATHS.add(originalPath);
  });
}

function _isOutlinerConflictPath(path) {
  const normalized = _normalizeOutlinerConflictPath(path);
  if (!normalized) return false;
  return OUTLINER_CONFLICT_PATHS.has(normalized)
    || _isOutlinerDropboxConflictName(_outlinerConflictBasename(normalized))
    || !!window.MeldexSaveSafety?.isConflictPath?.(normalized);
}

function _syncOutlinerConflictBadgeToNode(nodeEl) {
  if (!nodeEl || !nodeEl._nodeData) return;
  const row = nodeEl.querySelector(':scope > .tree-node-row');
  const label = row?.querySelector('.tree-label');
  if (!row || !label) return;
  row.querySelector('.tree-conflict-badge')?.remove();
  row.classList.remove('has-conflict');
  if (!_isOutlinerConflictPath(nodeEl._nodeData.path)) return;
  row.classList.add('has-conflict');
  const badge = document.createElement('span');
  badge.className = 'tree-conflict-badge';
  badge.innerHTML = lucide('triangleAlert', 12);
  badge.title = '競合が発生しています。比較ビューまたは競合解消ダイアログで確認してください';
  badge.dataset.gbTooltip = badge.title;
  label.insertAdjacentElement('afterend', badge);
}

function refreshVisibleOutlinerConflictState() {
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node')
    .forEach(node => _syncOutlinerConflictBadgeToNode(node));
}

window.addEventListener('meldex-save-conflicts-change', () => {
  refreshVisibleOutlinerConflictState();
});

function _createOutlinerAddHoverButton(nodeEl, item) {
  const addBtn = document.createElement('span');
  addBtn.className = 'tree-hover-btn';
  addBtn.innerHTML = lucide('plus', 14);
  addBtn.title = '追加';
  addBtn.dataset.gbTooltip = 'このフォルダ内に項目を追加します';
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = addBtn.getBoundingClientRect();
    const z = parseFloat(document.documentElement.style.zoom) || 1;
    _showTreeAddMenu(r.left / z, r.bottom / z, nodeEl, item);
  });
  return addBtn;
}

function _syncOutlinerAddHoverButton(nodeEl, item, locked) {
  const row = nodeEl?.querySelector?.(':scope > .tree-node-row');
  const hoverBtns = row?.querySelector?.('.tree-hover-btns');
  if (!hoverBtns || item?.type === 'entity') return;
  const addButton = hoverBtns.querySelector('.tree-hover-btn[title="追加"]');
  if (locked) {
    addButton?.remove();
    return;
  }
  if (!addButton) hoverBtns.appendChild(_createOutlinerAddHoverButton(nodeEl, item));
}

function refreshVisibleOutlinerLockState() {
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node')
    .forEach(node => _applyOutlinerLockStateToNode(node));
}

let _fileLockOutlinerRefreshPending = false;
function _scheduleFileLockRefreshForOutliner() {
  if (_fileLockOutlinerRefreshPending || typeof _ensureLocksLoaded !== 'function') return;
  _fileLockOutlinerRefreshPending = true;
  Promise.resolve(_ensureLocksLoaded({ force: !_fileLockLoaded }))
    .then(() => {
      refreshVisibleOutlinerLockState();
      if (typeof refreshVisibleFolderLockState === 'function') refreshVisibleFolderLockState();
      window.MeldexFileLockBadge?.refreshAll?.();
    })
    .catch(() => {})
    .finally(() => { _fileLockOutlinerRefreshPending = false; });
}

const NODE_COLORS_KEY = 'outliner-node-colors';
function getNodeColors() {
  try { return JSON.parse(localStorage.getItem(NODE_COLORS_KEY)) || {}; } catch { return {}; }
}
function getNodeColor(path) {
  const colors = getNodeColors();
  const fid = _pathToFileId(path);
  return (fid && colors[fid]) || colors[path] || '';
}
function setNodeColor(path, color) {
  const colors = getNodeColors();
  const key = _pathToFileId(path) || path;
  if (color) colors[key] = color; else delete colors[key];
  try { localStorage.setItem(NODE_COLORS_KEY, JSON.stringify(colors)); } catch {}
}

const OUTLINER_SETTINGS_HISTORY_KEYS = [
  SORT_SETTINGS_KEY,
  MANUAL_ORDER_KEY,
  LOCKED_ITEMS_KEY,
  NODE_COLORS_KEY,
  'meldex-favorites',
];

function refreshOutlinerSettingsAfterHistory() {
  if (typeof refreshOutliner === 'function') {
    refreshOutliner();
    return;
  }
  if (typeof loadOutliner === 'function') loadOutliner();
  if (typeof renderFavorites === 'function') renderFavorites();
  if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree({ reason: 'settings-history' });
  if (typeof renderWorkspaceSidebar === 'function') renderWorkspaceSidebar();
}

async function refreshOutliner(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const refreshJobs = [];
  if (typeof loadOutliner === 'function') refreshJobs.push(Promise.resolve().then(() => loadOutliner(opts)));
  if (typeof renderFavorites === 'function') refreshJobs.push(Promise.resolve().then(() => renderFavorites()));
  if (typeof renderHomeFolderTree === 'function') refreshJobs.push(Promise.resolve().then(() => renderHomeFolderTree({ reason: opts.reason || 'refresh-outliner' })));
  if (typeof renderWorkspaceSidebar === 'function') refreshJobs.push(Promise.resolve().then(() => renderWorkspaceSidebar()));
  return Promise.allSettled(refreshJobs);
}

async function refreshOutlinerFromButton(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const btn = event?.currentTarget?.closest?.('.sidebar-section-btn, .cloud-mobile-tree-refresh')
    || event?.target?.closest?.('.sidebar-section-btn, .cloud-mobile-tree-refresh')
    || null;
  if (btn?.disabled) return;
  if (btn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  // 更新前の展開状態を維持するため、自動展開の制限とカウンタを初期化する
  _outlinerForceExpansionMode = true;
  _outlinerAutoExpandScheduled = 0;
  _outlinerAutoExpandOverflowNotified = false;
  try {
    const results = await refreshOutliner({ force: true, reason: 'manual-refresh' });
    const failedCount = (results || []).filter(result => result?.status === 'rejected').length;
    if (typeof showStatus === 'function') {
      showStatus(failedCount ? 'フォルダツリーの一部更新に失敗しました' : 'フォルダツリーを更新しました', !!failedCount);
    }
  } catch (error) {
    if (typeof showStatus === 'function') showStatus('フォルダツリーの更新に失敗しました', true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
    if (!_outlinerAutoExpandQueue.length && !_outlinerAutoExpandRunning) {
      _outlinerForceExpansionMode = false;
    }
  }
}

function captureOutlinerSettingsHistory(keys) {
  const targetKeys = keys && keys.length ? keys : OUTLINER_SETTINGS_HISTORY_KEYS;
  if (typeof captureLocalStorageSettings === 'function') {
    return captureLocalStorageSettings(targetKeys);
  }
  const storage = {};
  targetKeys.forEach(key => {
    try { storage[key] = localStorage.getItem(key); }
    catch { storage[key] = null; }
  });
  return { keys: targetKeys.slice(), storage };
}

function pushOutlinerSettingsHistory(label, beforeSnapshot, detail, keys) {
  if (typeof pushLocalStorageSettingsHistory !== 'function') return false;
  const afterSnapshot = captureOutlinerSettingsHistory(keys);
  return pushLocalStorageSettingsHistory(
    label || 'フォルダツリー: 設定変更',
    beforeSnapshot,
    afterSnapshot,
    detail || '',
    refreshOutlinerSettingsAfterHistory
  );
}

function applyNodeColor(row, color) {
  const label = row.querySelector('.tree-label');
  const icon = row.querySelector('.tree-icon');
  if (color) {
    if (label) label.style.color = color;
    if (icon) icon.style.color = color;
  } else {
    if (label) label.style.color = '';
    if (icon) icon.style.color = '';
  }
}

function createTreeNodeFromBrowse(item, rootPath) {
  // item: {name, type: "folder"|"database"|"page"|"scenario", path}
  const div = document.createElement('div');
  div.className = 'tree-node';
  div._nodeData = item;
  if (item.path) div.dataset.path = item.path;
  if (item.sourceId) div.dataset.sourceId = item.sourceId;
  if (item.rootKind) div.dataset.rootKind = item.rootKind;
  if (item.workspaceId) div.dataset.workspaceId = item.workspaceId;
  if (item.file_id) _registerFileId(item.path, item.file_id);

  const row = document.createElement('div');
  row.className = 'tree-node-row';
  row.dataset.itemType = item.type || '';
  if (item.sourceId) row.dataset.sourceId = item.sourceId;
  if (item.rootKind) row.dataset.rootKind = item.rootKind;
  if (item.workspaceId) row.dataset.workspaceId = item.workspaceId;
  const itemLocked = item.path && isItemLocked(item.path);
  row.draggable = !itemLocked && !item._isRoot && item.type !== 'entity';
  row.tabIndex = -1;

  const isFolder = item.type === 'folder';
  const isDB = item.type === 'database';
  const isUnavailableRoot = item.needsMapping === true;
  const isExpandable = !isUnavailableRoot && (isFolder || isDB);

  // Toggle arrow
  const toggle = document.createElement('span');
  toggle.className = 'tree-toggle';
  if (isExpandable) {
    toggle.innerHTML = lucide('chevronRight', 16);
    toggle.dataset.expanded = 'false';
  }
  row.appendChild(toggle);

  // Icon（ルートフォルダにはアイコンを表示しない）
  if (!item._isRoot) {
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    icon.innerHTML = _outlinerIconMarkup(item, 18);
    // リンクファイルマーク
    if (item.linked) {
      icon.innerHTML += '<span style="position:relative;top:-4px;left:-2px;">' + lucide('externalLink', 8) + '</span>';
    }
    row.appendChild(icon);
  }

  // Label
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = item.name || '';
  if (item._isRoot) label.style.fontWeight = 'bold';
  row.appendChild(label);
  if (isUnavailableRoot) {
    const notice = document.createElement('span');
    notice.className = 'tree-source-mapping-badge';
    notice.textContent = '場所を確認';
    notice.title = 'このPCでDropbox同期フォルダの場所を確認してください';
    notice.style.cssText = 'margin-left:6px;color:var(--fg2);font-size:11px;white-space:nowrap;cursor:pointer;';
    notice.addEventListener('click', (e) => {
      e.stopPropagation();
      window.MeldexSettingsCloudLink?.confirmSourceFolderLocation?.(item);
    });
    row.title = notice.title;
    row.dataset.gbTooltip = notice.title;
    row.appendChild(notice);
  }
  if (itemLocked) {
    const lockBadge = document.createElement('span');
    lockBadge.className = 'tree-lock-badge';
    lockBadge.innerHTML = lucide('lock', 12);
    const lockReason = typeof getItemLockReason === 'function' ? getItemLockReason(item.path) : '';
    lockBadge.title = isSystemLockedItem(item.path) ? 'システム保護中です' : ('編集ロック中' + (lockReason ? ': ' + lockReason : ''));
    lockBadge.dataset.gbTooltip = lockBadge.title;
    lockBadge.style.cssText = 'display:inline-flex;align-items:center;opacity:0.65;margin-left:4px;flex-shrink:0;';
    row.title = lockBadge.title;
    row.dataset.gbTooltip = lockBadge.title;
    row.appendChild(lockBadge);
  }
  // ホバーアクションボタン（Notion風: メニュー + 追加）
  if (item.type !== 'entity') {
    const hoverBtns = document.createElement('span');
    hoverBtns.className = 'tree-hover-btns';
    hoverBtns.draggable = false;
    hoverBtns.addEventListener('dragstart', (e) => e.preventDefault());
    // メニューボタン
    const menuBtn = document.createElement('span');
    menuBtn.className = 'tree-hover-btn';
    menuBtn.innerHTML = lucide('ellipsis', 14);
    menuBtn.title = 'メニュー';
    menuBtn.dataset.gbTooltip = 'この項目のメニューを開きます';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!treeSelection.has(div)) { treeSelection.clear(); treeSelection.add(div); treeSelection.lastClicked = div; }
      const r = menuBtn.getBoundingClientRect();
      const z = parseFloat(document.documentElement.style.zoom) || 1;
      showTreeContextMenu(r.left / z, r.bottom / z, div, item, label);
    });
    hoverBtns.appendChild(menuBtn);
    // 追加ボタン
    if (!itemLocked) {
      hoverBtns.appendChild(_createOutlinerAddHoverButton(div, item));
    }
    row.appendChild(hoverBtns);
  }

  // ルートフォルダの背景色
  if (item._isRoot) row.classList.add('tree-root-row');

  div.appendChild(row);
  _syncOutlinerConflictBadgeToNode(div);

  // Children container (lazy-loaded)
  const childrenDiv = document.createElement('div');
  childrenDiv.className = 'tree-children collapsed';
  childrenDiv.dataset.loaded = 'false';
  div.appendChild(childrenDiv);

  // 保存済み色を適用
  const savedColor = getNodeColor(item.path);
  if (savedColor) applyNodeColor(row, savedColor);
  // ロック状態を反映
  if (itemLocked) {
    label.style.fontStyle = 'italic';
  }

  // Toggle click — lazy load children
  toggle.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!isExpandable) return;
    if (_applyCachedBrowseItemType(item)) _syncOutlinerResolvedItemType(div, item);
    const currentIsFolder = item.type === 'folder';
    const currentIsDB = item.type === 'database';
    if (!currentIsFolder && !currentIsDB) {
      row.click();
      return;
    }
    const expanded = toggle.dataset.expanded === 'true';
    if (!expanded) {
      toggle.classList.add('expanded');
      toggle.dataset.expanded = 'true';
      // 作品フォルダ動的アイコン切替（icon-implementation-plan §D）
      if (currentIsFolder) {
        const iconEl = row.querySelector('.tree-icon');
        if (iconEl) {
          const isWork = item.path === getWorkFolder();
          iconEl.innerHTML = lucide(isWork ? 'folderOpenDot' : 'folderOpen', 18);
          if (item.linked) iconEl.innerHTML += '<span style="position:relative;top:-4px;left:-2px;">' + lucide('externalLink', 8) + '</span>';
        }
      }
      // 展開前に既存子ノードにフィルタを適用（チラつき防止）
      childrenDiv.querySelectorAll(':scope > .tree-node').forEach(cn => {
        const d = cn._nodeData;
        if (!d || d._isRoot || d.type === 'folder') return;
        if (d.type === 'database') { cn.style.display = _showDatabaseByGlobalFilter() ? '' : 'none'; return; }
        if (d.type === 'entity') { cn.style.display = _showEntityByGlobalFilter() ? '' : 'none'; return; }
        cn.style.display = _showRegularNodeByGlobalFilter(d) ? '' : 'none';
      });
      childrenDiv.classList.remove('collapsed');
      saveExpandedState(item.path, true);

      // Lazy load children
      if (childrenDiv.dataset.loaded === 'false' && childrenDiv.dataset.loading !== 'true') {
        childrenDiv.dataset.loading = 'true';
        // スピナー表示
        const spinner = document.createElement('div');
        spinner.className = 'tree-spinner';
        spinner.innerHTML = '<span style="color:var(--fg2);font-size:11px;padding:4px 24px;">読み込み中...</span>';
        childrenDiv.appendChild(spinner);
        try {
          if (currentIsDB) {
            const pivotData = await apiFetch('/pivot?path=' + encodeURIComponent(item.path));
            // entities が undefined でも TypeError にならないようガード
            const entityNames = Object.keys(pivotData?.entities || {}).sort();
            const entityItems = entityNames.map(name => ({ name, type: 'entity', path: item.path + '/' + name, _dbPath: item.path }));
            await _appendOutlinerChildrenChunked(childrenDiv, entityItems, rootPath);
          } else if (currentIsFolder) {
            const sortCfg = getSortForFolder(item.path);
            const apiSort = sortCfg.sort === 'manual' ? 'name' : sortCfg.sort;
            const rootParam = rootPath ? '&root=' + encodeURIComponent(rootPath) : '';
            const sourceParam = item.sourceId ? '&sourceId=' + encodeURIComponent(item.sourceId) : '';
            const children = await apiFetch('/browse?path=' + encodeURIComponent(item.path) + '&sort=' + apiSort + '&order=' + sortCfg.order + rootParam + sourceParam + '&all_files=true');
            const visibleChildren = children.filter(child => !(typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(child?.path)));
            registerFileTypes(visibleChildren);
            _registerOutlinerConflictPaths(visibleChildren);
            visibleChildren.forEach(child => {
              if (item.sourceId && !child.sourceId) child.sourceId = item.sourceId;
            });
            await _appendOutlinerChildrenChunked(childrenDiv, visibleChildren, rootPath);
            // マニュアルソート適用
            if (sortCfg.sort === 'manual') applyManualSort(childrenDiv, item.path);
          }
          childrenDiv.dataset.loaded = 'true';
          // グローバルフィルタを新規読み込みノードに適用（常時）
          childrenDiv.querySelectorAll(':scope > .tree-node').forEach(node => {
            const d = node._nodeData;
            if (!d || d._isRoot) return;
            if (d.type === 'folder') return; // フォルダは_hideEmptyFilteredFoldersで処理
            if (d.type === 'database') { node.style.display = _showDatabaseByGlobalFilter() ? '' : 'none'; return; }
            if (d.type === 'entity') { node.style.display = _showEntityByGlobalFilter() ? '' : 'none'; return; }
            node.style.display = _showRegularNodeByGlobalFilter(d) ? '' : 'none';
          });
          // 空フォルダの非表示（新規読み込み分を含む）
          _hideEmptyFilteredFolders();
          _snapshotBaseTreeVisibility();
          // 検索中なら新ノードに検索フィルタも適用
          if (_treeSearchQuery) {
            const q = _treeSearchQuery;
            const includeEntities = typeof _getTreeSearchIncludeEntities === 'function'
              ? _getTreeSearchIncludeEntities()
              : localStorage.getItem('tree-search-include-entities') === 'true';
            childrenDiv.querySelectorAll(':scope > .tree-node').forEach(node => {
              const d = node._nodeData;
              if (!d) return;
              let match = false;
              if (d.type === 'entity') match = includeEntities && d.name && d.name.toLowerCase().includes(q);
              else match = d.name && d.name.toLowerCase().includes(q);
              if (!match && d.type !== 'folder' && d.type !== 'database' && !d._isRoot) {
                node.style.display = 'none';
              }
            });
          }
          childrenDiv.dataset.loaded = 'true';
        } catch (e) {
          // 握りつぶさず理由を表示する。部分的に追加済みの子ノードを取り除き、
          // 折りたたみ直して再クリックすればリロードが走る状態に戻す
          const reason = (e && (e.userMessage || e.message)) ? String(e.userMessage || e.message) : '';
          showStatus(`「${item.name}」の読み込みに失敗` + (reason ? `（${reason}）` : ''), true);
          childrenDiv.querySelectorAll(':scope > .tree-node').forEach(n => {
            if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(n);
            n.remove();
          });
          toggle.classList.remove('expanded');
          toggle.dataset.expanded = 'false';
          childrenDiv.classList.add('collapsed');
          saveExpandedState(item.path, false);
        }
        finally {
          delete childrenDiv.dataset.loading;
          spinner.remove();
        }
      }
    } else {
      toggle.classList.remove('expanded');
      toggle.dataset.expanded = 'false';
      childrenDiv.classList.add('collapsed');
      saveExpandedState(item.path, false);
      // 作品フォルダ動的アイコン切替（折畳み時）
      if (currentIsFolder) {
        const iconEl = row.querySelector('.tree-icon');
        if (iconEl) {
          const isWork = item.path === getWorkFolder();
          iconEl.innerHTML = lucide(isWork ? 'folderDot' : 'folder', 18);
          if (item.linked) iconEl.innerHTML += '<span style="position:relative;top:-4px;left:-2px;">' + lucide('externalLink', 8) + '</span>';
        }
      }
    }
  });

  // 前回展開されていたら自動展開
  _queueSavedOutlinerExpansion(item, toggle);

  // Row click: 選択＋コンテンツ表示
  row.addEventListener('click', async (e) => {
    try { row.focus({ preventScroll: true }); } catch {}
    if (_outlinerSuppressNextTreeRowClick && (!_outlinerSuppressTreeRowClickNode || _outlinerSuppressTreeRowClickNode === div)) {
      _outlinerSuppressNextTreeRowClick = false;
      _outlinerSuppressTreeRowClickNode = null;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.shiftKey) {
      // Shift+クリック: 範囲選択
      e.preventDefault();
      treeSelection.rangeTo(div);
      treeSelection.lastClicked = div;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+クリック: トグル選択
      treeSelection.toggle(div);
      treeSelection.lastClicked = div;
      return;
    }

    // 通常クリック: 単一選択 + コンテンツ表示
    treeSelection.clear();
    treeSelection.add(div);
    treeSelection.lastClicked = div;

    document.querySelectorAll('.tree-node-row.active').forEach(r => r.classList.remove('active'));
    row.classList.add('active');

    const clickPaneSnapshot = typeof _captureBrowseItemPaneSnapshot === 'function'
      ? _captureBrowseItemPaneSnapshot('', { requirePath: false })
      : null;
    if (_applyCachedBrowseItemType(item)) _syncOutlinerResolvedItemType(div, item);
    if (_browseItemNeedsTypeCheck(item) && item.type !== 'folder') {
      await _resolveBrowseItemTypeOnDemand(item);
      // 型判定待ちの間に別項目へ移動した場合、古いクリックを開かない。
      if (!row.isConnected || !row.classList.contains('active')) return;
      if (typeof _browseItemPaneSnapshotIsCurrent === 'function'
          && !_browseItemPaneSnapshotIsCurrent(clickPaneSnapshot)) return;
      if (!_browseItemNeedsTypeCheck(item)) _syncOutlinerResolvedItemType(div, item);
    }
    const currentIsFolder = item.type === 'folder';
    const currentIsDB = item.type === 'database';

    // スクロール位置保護は pointerdown 時点のグローバルガード (_treeScrollGuard) に委ねる

    // skipHighlight: クリック側で既に active クラスを付け終えているので、
    // open* 関数内の highlightOutlinerNode → scrollIntoView は不要かつスクロールジャンプ源。
    const _expOpts = { fromExplorer: true, skipHighlight: true };
    if (typeof _chatSetCurrentTargetPath === 'function' && item.path) {
      _chatSetCurrentTargetPath(item.path, currentIsFolder || currentIsDB ? 'folder' : 'file', { reason: 'tree-click', deferAdoptSource: true });
    }
    if (currentIsDB) {
      selectDatabase(item.path, clickPaneSnapshot?.paneContext || null, _expOpts);
    } else if (item.type === 'entity') {
      selectEntity(item.path, _expOpts);
    } else if (item.type === 'page') {
      openPage(item.name, item.path, _expOpts);
    } else if (item.type === 'scriptnote' || item.type === 'scenario' || (typeof isScriptNotePath === 'function' && isScriptNotePath(item.path))) {
      if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(item.path, item.name, _expOpts);
    } else if (item.type === 'board') {
      openBoard(item.name, item.path, _expOpts);
    } else if (item.type === 'calendar') {
      openCalendarFile(item.name, item.path, { ..._expOpts, paneContext: clickPaneSnapshot?.paneContext || null });
    } else if (item.type === 'image' || item.type === 'video' || item.type === 'audio') {
      openMedia(item.name, item.path, item.type, _expOpts);
    } else if (item.type === 'html') {
      openHtmlFile(item.name, item.path, _expOpts);
    } else if (item.type === 'csv') {
      if (typeof openCsvFile === 'function') openCsvFile(item.name, item.path, _expOpts);
      else openPage(item.name, item.path, _expOpts);
    } else if (item.type === 'smart-db') {
      if (typeof openSmartDbFile === 'function') openSmartDbFile(item.name, item.path, _expOpts);
    } else if (currentIsFolder) {
      let folderVisiblePromise = null;
      const mobileExplorer = window.MeldexCloudMobileExplorer;
      const handledByMobileExplorer = !!(
        window.MeldexCloudMobile?.shouldUseSidebarDrawer?.()
        && mobileExplorer?.selectFolderFromTree?.(item, { syncSelection: false })
      );
      if (!handledByMobileExplorer) folderVisiblePromise = openFolder(item.name, item.path, _expOpts);
      if (toggle && toggle.dataset.expanded !== 'true') toggle.click();
      const paneSnapshot = typeof _captureBrowseItemPaneSnapshot === 'function'
        ? _captureBrowseItemPaneSnapshot(item.path, { requirePath: !handledByMobileExplorer })
        : null;
      _scheduleBrowseItemTypeResolution(div, item, folderVisiblePromise, {
        paneSnapshot,
        isStillActive: handledByMobileExplorer
          ? () => mobileExplorer?.currentFolderTarget?.()?.path === item.path
          : undefined,
        onResolved: handledByMobileExplorer && typeof mobileExplorer?.handleResolvedItemType === 'function'
          ? payload => mobileExplorer.handleResolvedItemType(payload)
          : undefined,
      });
    } else if (!NATIVE_TYPES.has(item.type)) {
      // ネイティブアプリ専用ファイル（psd, clip, 3d等）: メニューから開く案内
      showStatus(item.name + ' — 「…」または長押しメニューからアプリで開く');
    }

    // open* 呼び出し後の念押し復元（ガードは pointerdown で既に張っている）
    _treeScrollGuardRestore();
  });

  // --- ダブルクリック: インラインリネーム ---
  row.ondblclick = (e) => {
    e.stopPropagation();
    if (item.type === 'entity' || item._isRoot) return;
    if (item.path && isItemLocked(item.path)) return;
    // 既にリネーム中なら無視
    if (label.querySelector('input')) return;
    startTreeLabelEdit(label, item);
  };

  // --- 右クリックメニュー ＋ 長押しで同メニュー（タッチ/ペン） ---
  const _openTreeRowCtxMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 右クリックしたノードが選択に含まれていなければ、単一選択に切り替え
    if (!treeSelection.has(div)) {
      treeSelection.clear();
      treeSelection.add(div);
      treeSelection.lastClicked = div;
    }
    const z = parseFloat(document.documentElement.style.zoom) || 1;
    showTreeContextMenu(e.clientX / z, e.clientY / z, div, item, label);
  };
  row.addEventListener('contextmenu', _openTreeRowCtxMenu);
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(row, _openTreeRowCtxMenu);
  }

  // --- ドラッグ&ドロップ ---
  if (item.type === 'entity') {
    row.draggable = false;
  }

  row.addEventListener('dragstart', (e) => {
    if (item._isRoot) {
      e.preventDefault();
      return;
    }
    // 複数選択中にドラッグ開始: 選択に含まれていなければ単一選択に切り替え
    if (!treeSelection.has(div)) {
      treeSelection.clear();
      treeSelection.add(div);
      treeSelection.lastClicked = div;
    }
    draggedNode = div;
    // DOM順でソート（上から下の順序を維持）
    const allTreeNodes = [...document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node')];
    const selectedNodes = [...treeSelection.items].sort((a, b) => allTreeNodes.indexOf(a) - allTreeNodes.indexOf(b));
    draggedNodes = selectedNodes.filter(n => !selectedNodes.some(parent => parent !== n && parent.contains(n)));
    draggedNodes.forEach(n => n.querySelector('.tree-node-row')?.classList.add('dragging'));
    const payload = _treeDragPayload(item);
    e.dataTransfer.effectAllowed = 'copyMove';
    // text/uri-list を入れておくと OS シェル（窓外）が「URL のドラッグ」として
    // 認識し、赤い禁止カーソルが出にくくなる
    try {
      const firstItem = (payload.items && payload.items[0]) || null;
      if (firstItem && firstItem.path && typeof buildSingleTabWindowUrl === 'function') {
        const uri = new URL(buildSingleTabWindowUrl(firstItem), location.origin).toString();
        e.dataTransfer.setData('text/uri-list', uri);
      }
    } catch {}
    e.dataTransfer.setData('text/plain', (payload.items || []).map(entry => entry.name).filter(Boolean).join(', ') || item.name || '');
    e.dataTransfer.setData('application/x-meldex-node', JSON.stringify(payload));
    // 窓外ドロップ時の popout 用に payload を保持
    window._gbOutlinerDragPayload = payload;
    // ドロップインジケータが隠れないよう、プレビュー画像を低不透明度にする
    if (typeof setLowOpacityDragImage === 'function') {
      setLowOpacityDragImage(e, row, 0.35);
    }
  });

  row.addEventListener('dragend', (e) => {
    (draggedNodes || []).forEach(n => n.querySelector('.tree-node-row')?.classList.remove('dragging'));
    clearDragIndicators();
    // ペインタブバーに表示されている挿入位置マーカーを確実にクリア
    // （ESC キャンセル等でタブバー側の dragleave が発火しないケースの漏れ対策）
    document.querySelectorAll('.gb-tab.gb-tab-drop-before, .gb-tab.gb-tab-drop-after')
      .forEach(t => t.classList.remove('gb-tab-drop-before', 'gb-tab-drop-after'));
    // 窓外にドロップされた場合: 共通ヘルパーで単一窓として開く
    if (typeof isDragDroppedOutsideWindow === 'function' && isDragDroppedOutsideWindow(e)) {
      const payload = window._gbOutlinerDragPayload;
      const items = payload && Array.isArray(payload.items) ? payload.items : [];
      if (typeof openItemsAsSingleTabWindows === 'function') openItemsAsSingleTabWindows(items);
    }
    window._gbOutlinerDragPayload = null;
    draggedNode = null;
    draggedNodes = null;
  });

  row.addEventListener('dragover', (e) => {
