      const raw = event?.dataTransfer?.getData?.('application/x-meldex-node') || '';
      payload = raw ? JSON.parse(raw) : null;
    }
  } catch {
    payload = null;
  }
  if (!payload) payload = window._gbFolderViewDragPayload || null;
  const rows = Array.isArray(payload?.items) ? payload.items : (payload?.path ? [payload] : []);
  const sourceSurface = payload?.sourceSurface || '';
  const seen = new Set();
  return rows.map(row => ({
    name: row?.name || '',
    path: row?.path || '',
    type: row?.type || 'file',
    sourceSurface: row?.sourceSurface || sourceSurface || 'main',
  })).filter(row => {
    const key = String(row.path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function _moveExternalItemsIntoOutlinerFolder(items, targetItem) {
  const targetPath = targetItem?.path || '';
  if (!targetPath || !Array.isArray(items) || items.length === 0) return;
  const progress = window.MeldexImportProgress;
  progress?.beginOperation?.('ファイルを移動中', items.length);
  let processed = 0;
  let succeeded = 0;
  const failures = [];
  try {
    for (const source of items) {
      try {
        const copySource = source.sourceSurface === 'sheet-image';
        const res = await apiPost(copySource ? '/outliner/save-as' : '/outliner/move', copySource ? {
          path: source.path,
          dest_folder: targetPath,
        } : {
          path: source.path,
          dest_folder: targetPath,
          conflict_policy: 'error',
        });
        if (!copySource && typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
        if (!copySource && res?.new_path && typeof renameAppPathReferences === 'function') {
          renameAppPathReferences(source.path, res.new_path, {
            label: res.new_name || source.name,
            fileId: res.file_id,
            type: source.type || 'file',
          });
        }
        succeeded += 1;
      } catch (error) {
        failures.push({ source, error });
      }
      processed += 1;
      progress?.updateOperation?.(processed);
    }
  } finally {
    progress?.finishOperation?.();
  }
  await loadOutliner({ force: true, reason: 'external-drop-move' });
  if (typeof _folderPath !== 'undefined' && _folderPath && typeof openFolder === 'function') {
    const label = document.getElementById('folder-title')?.textContent || _folderPath;
    await openFolder(label, _folderPath, {
      silent: true,
      skipShowView: true,
      skipNavPush: true,
      skipSaveLastView: true,
      skipHighlight: true,
      skipGlobalUi: true,
    });
  }
  if (failures.length) {
    const reason = String(failures[0].error?.userMessage || failures[0].error?.message || '');
    showStatus(`${succeeded}件を移動、${failures.length}件は失敗しました${reason ? `（${reason}）` : ''}`, true);
  } else {
    showStatus(`${succeeded}件を「${targetItem.name || targetPath}」へ移動しました`);
  }
  return succeeded;
}

function _treeDragPayload(primaryItem, actualNodes) {
  const sourceItems = Array.isArray(actualNodes)
    ? actualNodes.map(node => node?._nodeData).filter(Boolean)
    : treeSelection.getNodeData();
  const items = sourceItems
    .filter(item => item && item.path && !item._isRoot)
    .map(item => ({ name: item.name || '', path: item.path || '', type: item.type || '', sourceSurface: 'folder-tree' }));
  const fallback = primaryItem && primaryItem.path && !primaryItem._isRoot
    ? [{ name: primaryItem.name || '', path: primaryItem.path || '', type: primaryItem.type || '', sourceSurface: 'folder-tree' }]
    : [];
  const normalizedItems = items.length ? items : fallback;
  const primary = normalizedItems[0] || { name: primaryItem?.name || '', path: primaryItem?.path || '', type: primaryItem?.type || '' };
  return {
    name: primary.name || '',
    path: primary.path || '',
    type: primary.type || '',
    items: normalizedItems,
    sourceSurface: 'folder-tree',
  };
}

// ノードの色情報（localStorage で永続化）
// フォルダごとのソート設定
const SORT_SETTINGS_KEY = 'outliner-sort';
function getSortSettings() {
  try { return JSON.parse(localStorage.getItem(SORT_SETTINGS_KEY)) || {}; } catch { return {}; }
}
function setSortSetting(folderPath, sort, order) {
  const s = getSortSettings();
  const key = _pathToFileId(folderPath) || folderPath;
  if (sort === 'name' && order === 'asc') delete s[key]; // デフォルトなら削除
  else s[key] = { sort, order };
  try { localStorage.setItem(SORT_SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
function getSortForFolder(folderPath) {
  const s = getSortSettings();
  const fid = _pathToFileId(folderPath);
  return (fid && s[fid]) || s[folderPath] || { sort: 'name', order: 'asc' };
}
// マニュアルソート順の保存/読込
const MANUAL_ORDER_KEY = 'outliner-manual-order';
function getManualOrder(folderPath) {
  try {
    const all = JSON.parse(localStorage.getItem(MANUAL_ORDER_KEY) || '{}');
    const fid = _pathToFileId(folderPath);
    return (fid && all[fid]) || all[folderPath] || [];
  } catch { return []; }
}
function setManualOrder(folderPath, names) {
  try {
    const all = JSON.parse(localStorage.getItem(MANUAL_ORDER_KEY) || '{}');
    const key = _pathToFileId(folderPath) || folderPath;
    all[key] = names;
    localStorage.setItem(MANUAL_ORDER_KEY, JSON.stringify(all));
  } catch {}
}
// 保存済みの手動並び順を破棄する。ルート直下（folderPath='_root'）はマニュアル順が
// 設定側（ソースフォルダの並べ替え）より優先されるため、設定側で並べ替えを保存した際に
// 呼び出して古い手動順を無効化する（呼び出さないと設定側の新しい順序がツリーへ反映されない）。
function clearManualOrder(folderPath) {
  try {
    const all = JSON.parse(localStorage.getItem(MANUAL_ORDER_KEY) || '{}');
    const key = _pathToFileId(folderPath) || folderPath;
    if (key in all) {
      delete all[key];
      localStorage.setItem(MANUAL_ORDER_KEY, JSON.stringify(all));
    }
  } catch {}
}
function applyManualSort(container, folderPath) {
  const order = getManualOrder(folderPath);
  if (order.length === 0) return;
  const nodes = [...container.querySelectorAll(':scope > .tree-node')];
  const map = new Map(nodes.map(n => [n._nodeData?.name, n]));
  // 保存順にソート、未知のアイテムは末尾
  const sorted = [];
  order.forEach(name => { const n = map.get(name); if (n) { sorted.push(n); map.delete(name); } });
  map.forEach(n => sorted.push(n));
  sorted.forEach(n => container.appendChild(n));
}
function saveManualOrderFromDOM(container, folderPath) {
  const names = [...container.querySelectorAll(':scope > .tree-node')].map(n => n._nodeData?.name).filter(Boolean);
  setManualOrder(folderPath, names);
}

// 配列そのものを保存済み手動順で並べ替える（仮想化コンテナはDOM順ではなく配列順が正なので、
// DOM追加前にこちらで確定させる。非仮想コンテナでも同じ結果になるため共通で使ってよい）。
function _sortItemsByManualOrder(items, folderPath) {
  const order = getManualOrder(folderPath);
  if (!Array.isArray(items) || !items.length || !order.length) return items;
  const map = new Map(items.map(it => [it?.name, it]));
  const sorted = [];
  order.forEach(name => { const it = map.get(name); if (it) { sorted.push(it); map.delete(name); } });
  map.forEach(it => sorted.push(it));
  return sorted;
}


// 編集ロック
const LOCKED_ITEMS_KEY = 'outliner-locked-items';
let _systemLockedItemPaths = [];
let _fileLockEntries = [];
let _fileLockLoaded = false;
let _fileLockLoadPromise = null;
let _fileLockRoleLoaded = false;
let _fileLockRolePromise = null;
let _currentRoleCache = null;
let _legacyFileLocksMigrated = false;
let _fileLockRefreshTimer = null;
const FILE_LOCK_SYSTEM_EXCLUDED = ['_chat', '_skills', '_models', '_knowledge', '.meldex', '_meldex', '.trash', '_trash'];

function _normalizeLockedItemPath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
function _pathOrAncestorIn(entries, targetPath) {
  const target = _normalizeLockedItemPath(targetPath);
  if (!target) return false;
  return (entries || []).some(entry => {
    const raw = typeof entry === 'string' ? entry : (entry?.normalized_path || entry?.path || '');
    const base = _normalizeLockedItemPath(raw);
    return base && (target === base || target.startsWith(base + '/'));
  });
}
function setSystemLockedItems(paths) {
  _systemLockedItemPaths = Array.isArray(paths)
    ? paths.map(_normalizeLockedItemPath).filter(Boolean)
    : [];
  // ロック一覧が確定した時点で、閲覧専用ファイルに残っている未保存ドラフトを掃除する。
  // 起動直後（1.8秒）の時点ではまだここに到達していないことがあり、掃除が空振りしたまま
  // 「未保存の編集があります」が出ていた。
  try { window.MeldexDraftRecovery?.notifySystemLocksLoaded?.(); } catch (_) {}
}
function isSystemLockedItem(path) {
  return _pathOrAncestorIn(_systemLockedItemPaths, path);
}
function _legacyLockedItems() {
  try {
    const data = JSON.parse(localStorage.getItem(LOCKED_ITEMS_KEY) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}
function _isFileLockSystemExcluded(path) {
  const parts = _normalizeLockedItemPath(path).split('/').filter(Boolean);
  return parts.some(part => FILE_LOCK_SYSTEM_EXCLUDED.includes(part));
}
function _fileLockAuthHeaders() {
  let token = '';
  try { token = localStorage.getItem('meldex-auth-token') || localStorage.getItem('crossfolio-auth-token') || ''; } catch {}
  return token ? { Authorization: 'Bearer ' + token } : {};
}
async function _fileLockApi(path, opts = {}) {
  const headers = { ..._fileLockAuthHeaders(), ...(opts.headers || {}) };
  if (opts.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_BASE + path, { ...opts, headers });
  const text = await res.text();
  let payload = {};
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { detail: text }; }
  }
  if (!res.ok) {
    const detail = payload?.detail?.message || payload?.detail || payload?.error || res.statusText;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return payload;
}
async function _ensureRoleLoaded(force = false) {
  if (_fileLockRoleLoaded && !force) return _currentRoleCache;
  if (_fileLockRolePromise && !force) return _fileLockRolePromise;
  _fileLockRolePromise = (async () => {
    try {
      const me = await _fileLockApi('/auth/me');
      _currentRoleCache = me?.role || 'viewer';
    } catch {
      _currentRoleCache = 'viewer';
    }
    _fileLockRoleLoaded = true;
    return _currentRoleCache;
  })();
  try { return await _fileLockRolePromise; }
  finally { _fileLockRolePromise = null; }
}
function isFileLockOwner() {
  return _currentRoleCache === 'owner';
}
function _writeFileLockCache(entries) {
  _fileLockEntries = Array.isArray(entries) ? entries : [];
  _fileLockLoaded = true;
  try {
    localStorage.setItem(LOCKED_ITEMS_KEY, JSON.stringify({ entries: _fileLockEntries, cachedAt: Date.now() }));
  } catch {}
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
      // 編集ロックの理由は任意であり、後から付箋アノテート・履歴ノートで補足できるため、
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
  row.draggable = !locked && !item._isRoot;
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

let _topicRecordsOutlinerRefreshTimer = null;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('meldex:topic-records-updated', () => {
    clearTimeout(_topicRecordsOutlinerRefreshTimer);
    _topicRecordsOutlinerRefreshTimer = setTimeout(async () => {
      const settled = await refreshOutliner({ force: true, reason: 'topic-records-updated' });
      const failures = settled.filter(result => result.status === 'rejected');
      if (!failures.length) return;
      const detail = {
        failures: failures.map(result => String(result.reason?.message || result.reason || '再読込に失敗しました')),
        retry: () => refreshOutliner({ force: true, reason: 'topic-records-retry' }),
      };
      window.dispatchEvent(new CustomEvent('meldex:topic-outliner-refresh-failed', { detail }));
      if (typeof showStatus === 'function') {
        showStatus('保存は完了しましたが、フォルダ／トピック一覧を更新できませんでした。更新ボタンで再試行してください', true);
      }
    }, 40);
  });
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
  row.draggable = !itemLocked && !item._isRoot;
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
    // フォルダツリー改修Phase4: 軽量サムネイル表示・OS登録形式アイコン（対象外/OFF時は何もしない）
    window.GBOutlinerThumbnails?.attachToRow(row, item, icon);
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
    // 仮想化中の親に属する行は、子孫も同じ論理モデルへ接続する。
    // 親コンテナ全件をDOM化せず、表示範囲＋オーバースキャンだけを維持する。
    const parentVirtualContainer = div.parentElement && div.parentElement.dataset && div.parentElement.dataset.virtual === 'true'
      ? div.parentElement : null;
    if (parentVirtualContainer) {
      childrenDiv._virtualOwnerContainer = parentVirtualContainer;
      childrenDiv._virtualParentPath = item.path;
    }
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
