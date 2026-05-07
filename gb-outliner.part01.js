/**
 * Meldex Outliner
 * フォルダツリー、検索、フィルタ、お気に入り、サイドバー
 */

// サイドバー全体でブラウザ標準の右クリックメニューを抑制（captureフェーズで確実に）
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('#sidebar')) e.preventDefault();
}, true);

/* ==============================
   フォルダツリー
   ============================== */


// フォルダツリーの展開状態をlocalStorageで保持
function getExpandedPaths() {
  try { return JSON.parse(localStorage.getItem('outliner-expanded') || '[]'); } catch { return []; }
}
function saveExpandedState(path, expanded) {
  let paths = getExpandedPaths();
  const key = _pathToFileId(path) || path;
  if (expanded && !paths.includes(key)) paths.push(key);
  else if (!expanded) paths = paths.filter(p => p !== key && p !== path);
  localStorage.setItem('outliner-expanded', JSON.stringify(paths));
}
function isExpandedState(path) {
  const paths = getExpandedPaths();
  const fid = _pathToFileId(path);
  return (fid && paths.includes(fid)) || paths.includes(path);
}

const OUTLINER_AUTO_EXPAND_LIMIT = 40;
let _outlinerAutoExpandQueue = [];
let _outlinerAutoExpandRunning = false;
let _outlinerAutoExpandScheduled = 0;
let _outlinerAutoExpandOverflowNotified = false;
const _treeNodeCache = new Map();

function _treeNodeCacheKey(path) {
  return path == null ? '' : String(path);
}

function _compareTreeNodeDocumentOrder(a, b) {
  if (a === b) return 0;
  const pos = a.compareDocumentPosition(b);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function _registerTreeNode(el) {
  const path = _treeNodeCacheKey(el?._nodeData?.path || el?.dataset?.path || '');
  if (!path) return;
  let nodes = _treeNodeCache.get(path);
  if (!nodes) {
    nodes = new Set();
    _treeNodeCache.set(path, nodes);
  }
  nodes.add(el);
}

function _unregisterTreeNode(el, pathOverride) {
  const path = _treeNodeCacheKey(pathOverride || el?._nodeData?.path || el?.dataset?.path || '');
  if (!path) return;
  const nodes = _treeNodeCache.get(path);
  if (!nodes) return;
  nodes.delete(el);
  if (!nodes.size) _treeNodeCache.delete(path);
}

function _unregisterTreeSubtree(root) {
  if (!root) return;
  if (root.classList?.contains('tree-node')) _unregisterTreeNode(root);
  root.querySelectorAll?.('.tree-node').forEach(node => _unregisterTreeNode(node));
}

function _pruneTreeNodeCache(path) {
  const nodes = _treeNodeCache.get(path);
  if (!nodes) return [];
  const connected = [];
  for (const node of nodes) {
    if (node?.isConnected) connected.push(node);
    else nodes.delete(node);
  }
  if (!nodes.size) _treeNodeCache.delete(path);
  return connected;
}

function _findTreeNodeByPathFallback(path) {
  const found = [];
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node').forEach(node => {
    if (node._nodeData?.path === path) {
      _registerTreeNode(node);
      found.push(node);
    }
  });
  return found;
}

function _findTreeNodeByPath(path) {
  const key = _treeNodeCacheKey(path);
  if (!key) return null;
  let nodes = _pruneTreeNodeCache(key);
  if (!nodes.length) nodes = _findTreeNodeByPathFallback(key);
  if (!nodes.length) return null;
  nodes.sort(_compareTreeNodeDocumentOrder);
  return nodes.find(node => node.closest('#outliner-tree')) || nodes[0] || null;
}

function _isOutlinerDesktopLaunch() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('desktop') === '1' || document.documentElement?.dataset?.desktopLaunch === '1';
  } catch {
    return false;
  }
}

function _getOutlinerAutoExpandLimit() {
  return _isOutlinerDesktopLaunch() ? 0 : OUTLINER_AUTO_EXPAND_LIMIT;
}

function _outlinerAutoExpandDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function _waitForOutlinerAutoExpandLoad(toggle) {
  const node = toggle?.closest?.('.tree-node');
  const childrenDiv = node?.querySelector?.(':scope > .tree-children');
  if (!childrenDiv || childrenDiv.dataset.loaded === 'true') {
    await _outlinerAutoExpandDelay(16);
    return;
  }
  for (let i = 0; i < 30; i++) {
    await _outlinerAutoExpandDelay(50);
    if (!toggle.isConnected || toggle.dataset.expanded !== 'true' || childrenDiv.dataset.loaded === 'true') return;
  }
}

function _notifyOutlinerAutoExpandLimit() {
  if (_outlinerAutoExpandOverflowNotified) return;
  _outlinerAutoExpandOverflowNotified = true;
  if (typeof showStatus === 'function') {
    showStatus('保存済みのフォルダ展開が多いため、一部だけ自動復元しました');
  }
}

async function _drainOutlinerAutoExpandQueue() {
  if (_outlinerAutoExpandRunning) return;
  _outlinerAutoExpandRunning = true;
  try {
    while (_outlinerAutoExpandQueue.length) {
      const toggle = _outlinerAutoExpandQueue.shift();
      if (toggle?.isConnected && toggle.dataset.expanded !== 'true') {
        toggle.click();
        await _waitForOutlinerAutoExpandLoad(toggle);
      } else {
        await _outlinerAutoExpandDelay(16);
      }
    }
  } finally {
    _outlinerAutoExpandRunning = false;
  }
}

function _queueSavedOutlinerExpansion(item, toggle) {
  if (!item?.path || !toggle || toggle.dataset.expanded === undefined) return;
  if (!isExpandedState(item.path)) return;
  const limit = _getOutlinerAutoExpandLimit();
  if (limit <= 0) return;
  if (_outlinerAutoExpandScheduled >= limit) {
    _notifyOutlinerAutoExpandLimit();
    return;
  }
  _outlinerAutoExpandScheduled++;
  _outlinerAutoExpandQueue.push(toggle);
  _drainOutlinerAutoExpandQueue();
}

function _outlinerResolvedType(type, path) {
  if (type === 'scriptnote' || (typeof isScriptNotePath === 'function' && isScriptNotePath(path))) return 'scriptnote';
  return type || 'page';
}

function _outlinerIconName(type, path, isSpecialFolder) {
  if (isSpecialFolder) return 'folderDot';
  const resolvedType = _outlinerResolvedType(type, path);
  if (resolvedType === 'folder') return 'folder';
  if (typeof uiTypeIconName === 'function') {
    const shared = uiTypeIconName(resolvedType);
    if (shared) return shared;
  }
  const fallback = {
    image: 'image',
    video: 'video',
    audio: 'audio',
    html: 'globe',
    csv: 'table',
    psd: 'brush',
    clip: 'penTool',
    '3d': 'box',
    document: 'fileText',
    archive: 'archive',
    app: 'settings',
    unknown: 'fileQuestion',
  };
  return fallback[resolvedType] || 'page';
}

function _outlinerIconMarkup(item, size) {
  return lucide(_outlinerIconName(item?.type, item?.path, item?.type === 'folder' && item?.path === getWorkFolder()), size || 18);
}

async function loadOutliner() {
  showLoading('フォルダを読み込み中...');
  try {
  if (typeof _primeFileLockCacheFromStorage === 'function') _primeFileLockCacheFromStorage();
  // スクロール位置を保存してから再読み込み
  const tree = document.getElementById('tree-scroll-container');
  const scrollTop = tree ? tree.scrollTop : 0;
  try {
    const roots = await apiFetch('/outliner-roots');
    renderOutlinerMultiRoot(roots);
  } catch (e) {
    // フォールバック: 従来のルートフォルダルート
    try {
      const items = await apiFetch('/browse?all_files=true');
      renderOutlinerLegacy(items);
    } catch (e2) { renderOutlinerLegacy([]); }
  }
  if (typeof applyGlobalFilter === 'function') applyGlobalFilter();
  // スクロール位置を復元（DOM再構築後も確実に復元）
  if (tree) {
    tree.scrollTop = scrollTop;
    requestAnimationFrame(() => { tree.scrollTop = scrollTop; });
  }
  if (typeof _scheduleFileLockRefreshForOutliner === 'function') _scheduleFileLockRefreshForOutliner();
  } finally { hideLoading(); }
}

function renderOutlinerLegacy(items) {
  const el = document.getElementById('outliner-tree');
  _unregisterTreeSubtree(el);
  el.innerHTML = '';
  OUTLINER_CONFLICT_PATHS.clear();
  _registerOutlinerConflictPaths(items);
  items.forEach(item => el.appendChild(createTreeNodeFromBrowse(item)));
  // ルート直下のマニュアル並び順を復元（_root キーで保存される）
  applyManualSort(el, '_root');
}

function renderOutlinerMultiRoot(roots) {
  const el = document.getElementById('outliner-tree');
  _unregisterTreeSubtree(el);
  el.innerHTML = '';
  const visibleRoots = roots.filter(r => r.visible);
  OUTLINER_CONFLICT_PATHS.clear();
  _registerOutlinerConflictPaths(visibleRoots);

  // 各ルートを通常のフォルダノードとしてツリーに追加（_isRootフラグ付き）
  for (const root of visibleRoots) {
    const rootItem = {
      name: root.name,
      type: 'folder',
      path: root.path,
      _isRoot: true,
    };
    el.appendChild(createTreeNodeFromBrowse(rootItem, root.path));
  }
  // ルート直下のマニュアル並び順を復元
  applyManualSort(el, '_root');
}

let draggedNode = null;
let draggedNodes = null; // 複数選択D&D用
let _treeClickScrollLock = 0; // ツリークリック中のスクロール復元抑止（参照カウント）
let _outlinerSuppressNextTreeRowClick = false;
let _outlinerSuppressTreeRowClickNode = null;

// === ツリーノードクリック時のスクロール位置保護 ===
// ツリークリックでフォルダツリーペインがアクティブ化されても、
// navPush → render() でタイプ変更時にスクロールがリセットされる可能性がある。
// render() 内の _saveAllScrollPositions で保護済みだが、念押しで非同期復元も行う。
function _treeScrollGuardRestore() {
  const el = document.getElementById('tree-scroll-container');
  if (!el || el.scrollTop > 0) return; // 既に正しい位置ならスキップ
  // scrollTop が 0 に落ちた場合のみ、保存値から復元を試みる
  const saved = el._savedScrollTop;
  if (saved > 0) {
    el.scrollTop = saved;
    requestAnimationFrame(() => { if (el.scrollTop === 0 && saved > 0) el.scrollTop = saved; });
  }
}
// pointerdown 時にスクロール位置を保存（render() の保護と二重だが安全網）
(function initTreeScrollGuard() {
  const scroller = document.getElementById('tree-scroll-container');
  if (!scroller) return;
  scroller.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (!e.target.closest('.tree-node-row, .fav-item')) return;
    if (scroller.scrollTop > 0) scroller._savedScrollTop = scroller.scrollTop;
    _treeClickScrollLock++;
    setTimeout(() => { _treeClickScrollLock = Math.max(0, _treeClickScrollLock - 1); }, 1500);
  });
})();

function _getTreeSelectionScope(nodeEl) {
  if (nodeEl?.closest('#body-home')) return '#body-home';
  return '#outliner-tree';
}

function _getVisibleTreeNodes(scopeSelector) {
  return String(scopeSelector || '#outliner-tree')
    .split(',')
    .map(scope => scope.trim())
    .filter(Boolean)
    .flatMap(scope => [...document.querySelectorAll(`${scope} .tree-node`)])
    .filter((node, index, nodes) => nodes.indexOf(node) === index && node.getClientRects().length > 0);
}

// 複数選択管理
const treeSelection = {
  items: new Set(),  // Set of .tree-node elements
  lastClicked: null, // 最後にクリックした .tree-node（Shift用）
  clear() {
    this.items.forEach(n => n.querySelector('.tree-node-row')?.classList.remove('selected'));
    this.items.clear();
  },
  add(nodeEl) {
    this.items.add(nodeEl);
    nodeEl.querySelector('.tree-node-row')?.classList.add('selected');
  },
  remove(nodeEl) {
    this.items.delete(nodeEl);
    nodeEl.querySelector('.tree-node-row')?.classList.remove('selected');
  },
  has(nodeEl) { return this.items.has(nodeEl); },
  toggle(nodeEl) { this.has(nodeEl) ? this.remove(nodeEl) : this.add(nodeEl); },
  // Shiftクリック: 同じツリー内の可視ノードだけを対象に範囲選択
  rangeTo(nodeEl) {
    const scopeSelector = _getTreeSelectionScope(nodeEl);
    if (!this.lastClicked || _getTreeSelectionScope(this.lastClicked) !== scopeSelector) {
      this.clear();
      this.add(nodeEl);
      return;
    }
    const allRows = _getVisibleTreeNodes(scopeSelector);
    const from = allRows.indexOf(this.lastClicked);
    const to = allRows.indexOf(nodeEl);
    if (from < 0 || to < 0) {
      this.clear();
      this.add(nodeEl);
      return;
    }
    this.clear();
    const [start, end] = from < to ? [from, to] : [to, from];
    for (let i = start; i <= end; i++) this.add(allRows[i]);
  },
  getNodeData() { return [...this.items].map(n => n._nodeData).filter(Boolean); },
};

function _treeDragPayload(primaryItem) {
  const items = treeSelection.getNodeData()
    .filter(item => item && item.path && !item._isRoot)
    .map(item => ({ name: item.name || '', path: item.path || '', type: item.type || '' }));
  const fallback = primaryItem && primaryItem.path ? [{ name: primaryItem.name || '', path: primaryItem.path || '', type: primaryItem.type || '' }] : [];
  const normalizedItems = items.length ? items : fallback;
  const primary = normalizedItems[0] || { name: primaryItem?.name || '', path: primaryItem?.path || '', type: primaryItem?.type || '' };
  return {
    name: primary.name || '',
    path: primary.path || '',
    type: primary.type || '',
    items: normalizedItems,
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
        _ensureLocksLoaded({ force: true }).catch(() => {});
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
async function toggleItemLock(path) {
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
  const before = captureOutlinerSettingsHistory([LOCKED_ITEMS_KEY]);
  const locked = isItemLocked(path);
  if (locked) {
    await _fileLockApi('/file-lock?path=' + encodeURIComponent(path), { method: 'DELETE' });
  } else {
    const reasonInput = window.prompt('編集ロックの理由（任意）', '');
    if (reasonInput == null) return false;
    const reason = reasonInput || '';
    await _fileLockApi('/file-lock', {
      method: 'PUT',
      body: JSON.stringify({ path, file_id: (typeof _pathToFileId === 'function' && _pathToFileId(path)) || '', reason }),
    });
  }
  await _ensureLocksLoaded({ force: true });
  pushOutlinerSettingsHistory('フォルダツリー: 編集ロック', before, path, [LOCKED_ITEMS_KEY]);
  await refreshOutliner();
  return true;
}

function _applyOutlinerLockStateToNode(nodeEl) {
  if (!nodeEl || !nodeEl._nodeData) return;
  const item = nodeEl._nodeData;
  const row = nodeEl.querySelector(':scope > .tree-node-row');
  const label = row?.querySelector('.tree-label');
  if (!row || !label || !item.path) return;
  row.querySelector('.tree-lock-badge')?.remove();
  const locked = isItemLocked(item.path);
  row.draggable = !locked && item.type !== 'entity';
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
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node')
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
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node')
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
  if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
}

async function refreshOutliner() {
  const refreshJobs = [];
  if (typeof loadOutliner === 'function') refreshJobs.push(Promise.resolve(loadOutliner()).catch(() => {}));
  if (typeof renderFavorites === 'function') refreshJobs.push(Promise.resolve(renderFavorites()).catch(() => {}));
  if (typeof renderHomeFolderTree === 'function') refreshJobs.push(Promise.resolve(renderHomeFolderTree()).catch(() => {}));
  await Promise.allSettled(refreshJobs);
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
  if (item.file_id) _registerFileId(item.path, item.file_id);

  const row = document.createElement('div');
  row.className = 'tree-node-row';
  row.dataset.itemType = item.type || '';
  const itemLocked = item.path && isItemLocked(item.path);
  row.draggable = !itemLocked;

  const isFolder = item.type === 'folder';
  const isDB = item.type === 'database';
  const isExpandable = isFolder || isDB;

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
    const expanded = toggle.dataset.expanded === 'true';
    if (!expanded) {
      toggle.classList.add('expanded');
      toggle.dataset.expanded = 'true';
      // 作品フォルダ動的アイコン切替（icon-implementation-plan §D）
      if (isFolder) {
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
      if (childrenDiv.dataset.loaded === 'false') {
        // スピナー表示
        const spinner = document.createElement('div');
        spinner.className = 'tree-spinner';
        spinner.innerHTML = '<span style="color:var(--fg2);font-size:11px;padding:4px 24px;">読み込み中...</span>';
        childrenDiv.appendChild(spinner);
        try {
          if (isDB) {
            const pivotData = await apiFetch('/pivot?path=' + encodeURIComponent(item.path));
            const entityNames = Object.keys(pivotData.entities).sort();
            entityNames.forEach(name => {
              const entityItem = { name, type: 'entity', path: item.path + '/' + name, _dbPath: item.path };
              childrenDiv.appendChild(createTreeNodeFromBrowse(entityItem, rootPath));
            });
          } else if (isFolder) {
            const sortCfg = getSortForFolder(item.path);
            const apiSort = sortCfg.sort === 'manual' ? 'name' : sortCfg.sort;
            const rootParam = rootPath ? '&root=' + encodeURIComponent(rootPath) : '';
            const children = await apiFetch('/browse?path=' + encodeURIComponent(item.path) + '&sort=' + apiSort + '&order=' + sortCfg.order + rootParam + '&all_files=true');
            registerFileTypes(children);
            _registerOutlinerConflictPaths(children);
            children.forEach(child => {
              childrenDiv.appendChild(createTreeNodeFromBrowse(child, rootPath));
            });
            // マニュアルソート適用
            if (sortCfg.sort === 'manual') applyManualSort(childrenDiv, item.path);
            // 非同期でDB/board判定（NAS高速化: browseは拡張子のみで判定し、後からcheck-typeで確定）
            const checkTargets = children.filter(c => c.type === 'folder' || c.type === 'page' || c.type === 'scenario' || c.type === 'scriptnote');
            // NAS負荷軽減: 5件ずつバッチ処理
            (async () => {
              for (let i = 0; i < checkTargets.length; i += 5) {
                const batch = checkTargets.slice(i, i + 5);
                await Promise.all(batch.map(async child => {
                  try {
                    const res = await apiFetch('/check-type?path=' + encodeURIComponent(child.path));
                    if (res.type !== child.type) {
                      // タイプが変わった → ノードを再作成
                      const oldNode = childrenDiv.querySelector(`[data-path="${child.path.replace(/"/g, '\\"')}"]`);
                      if (oldNode) {
                        child.type = res.type;
                        const newNode = createTreeNodeFromBrowse(child, rootPath);
                        oldNode.replaceWith(newNode);
                        // 置換後のノードにグローバルフィルタを適用（常時）
                        if (res.type === 'database') {
                          newNode.style.display = _showDatabaseByGlobalFilter() ? '' : 'none';
                        } else if (res.type !== 'folder') {
                          newNode.style.display = _showRegularNodeByGlobalFilter(child) ? '' : 'none';
                        }
                      }
                    }
                  } catch(e) {}
                }));
              }
            })();
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
        } catch (e) { /* error shown */ }
        spinner.remove();
      }
    } else {
      toggle.classList.remove('expanded');
      toggle.dataset.expanded = 'false';
      childrenDiv.classList.add('collapsed');
      saveExpandedState(item.path, false);
      // 作品フォルダ動的アイコン切替（折畳み時）
      if (isFolder) {
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
  row.addEventListener('click', (e) => {
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

    // スクロール位置保護は pointerdown 時点のグローバルガード (_treeScrollGuard) に委ねる

    // skipHighlight: クリック側で既に active クラスを付け終えているので、
    // open* 関数内の highlightOutlinerNode → scrollIntoView は不要かつスクロールジャンプ源。
    const _expOpts = { fromExplorer: true, skipHighlight: true };
    if (isDB) {
      selectDatabase(item.path, null, _expOpts);
    } else if (item.type === 'entity') {
      selectEntity(item.path, _expOpts);
    } else if (item.type === 'page') {
      openPage(item.name, item.path, _expOpts);
    } else if (item.type === 'scriptnote' || item.type === 'scenario' || (typeof isScriptNotePath === 'function' && isScriptNotePath(item.path))) {
      if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(item.path, item.name, _expOpts);
    } else if (item.type === 'board') {
      openBoard(item.name, item.path, _expOpts);
    } else if (item.type === 'calendar') {
      openCalendarFile(item.name, item.path, _expOpts);
    } else if (item.type === 'image' || item.type === 'video' || item.type === 'audio') {
      openMedia(item.name, item.path, item.type, _expOpts);
    } else if (item.type === 'html') {
      openHtmlFile(item.name, item.path, _expOpts);
    } else if (item.type === 'csv') {
      if (typeof openCsvFile === 'function') openCsvFile(item.name, item.path, _expOpts);
      else openPage(item.name, item.path, _expOpts);
    } else if (item.type === 'smart-db') {
      if (typeof openSmartDbFile === 'function') openSmartDbFile(item.name, item.path, _expOpts);
    } else if (isFolder) {
      openFolder(item.name, item.path, _expOpts);
      toggle.click(); // 展開/折りたたみをトグル
    } else if (!NATIVE_TYPES.has(item.type)) {
      // ネイティブアプリ専用ファイル（psd, clip, 3d等）: 右クリックで開く案内
      showStatus(item.name + ' — 右クリックメニューからアプリで開く');
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
    // 複数選択中にドラッグ開始: 選択に含まれていなければ単一選択に切り替え
    if (!treeSelection.has(div)) {
      treeSelection.clear();
      treeSelection.add(div);
      treeSelection.lastClicked = div;
    }
    draggedNode = div;
    // DOM順でソート（上から下の順序を維持）
    const allTreeNodes = [...document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node')];
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
    e.preventDefault();
    if (!draggedNode) return;
    // Ctrl+ドラッグ中はツリー内移動を行わない（ペインで開く操作に委ねる）
    if (e.ctrlKey) { e.dataTransfer.dropEffect = 'copy'; return; }
    // ドラッグ中のノード自体（複数選択含む）へのドロップを防止
    if (draggedNodes && draggedNodes.includes(div) || draggedNode === div) return;
    e.dataTransfer.dropEffect = 'move';
    clearDragIndicators();

    const rect = row.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    if (isFolder || isDB) {
      if (y < h * 0.25) row.classList.add('drag-over-above');
      else if (y > h * 0.75) row.classList.add('drag-over-below');
      else row.classList.add('drag-over-inside');
    } else {
      if (y < h * 0.5) row.classList.add('drag-over-above');
      else row.classList.add('drag-over-below');
    }
  });

  row.addEventListener('dragleave', () => {
    row.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
  });

  row.addEventListener('drop', (e) => {
    e.preventDefault();
    // Ctrl+ドロップ: ツリー内移動を行わない（ペインで開く操作に委ねる）
    if (e.ctrlKey) { clearDragIndicators(); return; }
    if (!draggedNode || draggedNode === div) return;
    const nodes = (draggedNodes || [draggedNode]).filter(n => n !== div && !n.contains(div) && !(n._nodeData?.path && isItemLocked(n._nodeData.path)));
    if (nodes.length === 0) return;
    const orderBefore = captureOutlinerSettingsHistory([SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);

    // Alt+D&D: フォルダリンク登録（移動ではなくリンク）
    if (e.altKey && (isFolder || isDB)) {
      for (const n of nodes) {
        const d = n._nodeData;
        if (d && d.path) {
          const addLink = typeof addFolderLinkWithHistory === 'function'
            ? addFolderLinkWithHistory(d.path, item.path)
            : apiPost('/folder-links/add', { file_path: d.path, folder_path: item.path });
          Promise.resolve(addLink).then(() => {
            showStatus(d.name + ' → ' + item.name + ' にリンク登録');
          }).catch(() => showStatus('リンク登録に失敗', true));
        }
      }
      clearDragIndicators();
      loadOutliner();
      return;
    }

    const position = row.classList.contains('drag-over-above') ? 'above'
      : row.classList.contains('drag-over-inside') ? 'inside'
      : 'below';
    clearDragIndicators();

    const targetParent = div.parentElement;

    // リンクファイルチェック
    const hasLinked = nodes.some(n => n._nodeData && n._nodeData.linked);
    if (hasLinked) {
      showStatus('リンクファイルは移動できません（Alt+D&Dでリンク先を変更）');
      return;
    }

    // 移動先フォルダを決定
    let destFolder = '';
    if (position === 'inside' && (isFolder || isDB)) {
      destFolder = item.path;
    } else {
      const parentNode = div.parentElement?.closest('.tree-node');
      if (parentNode) {
        destFolder = parentNode._nodeData?.path || '';
      } else if (div.closest('#body-home') && _homeFolderPath) {
        destFolder = _homeFolderPath;
      } else {
        destFolder = '';
      }
    }
    if (destFolder && isItemLocked(destFolder)) {
      showStatus('編集ロック中のフォルダには移動できません', true);
      return;
    }

    // API移動を先に実行し、成功したノードのみDOMを更新（失敗時にDOMが先行するのを防ぐ）
    (async () => {
      const moved = [];
      let movedAcrossFolders = false;
      for (const n of nodes) {
        const dragData = n._nodeData;
        if (!dragData || !dragData.path) { moved.push(n); continue; }
        const srcFolder = dragData.path.includes('/') ? dragData.path.substring(0, dragData.path.lastIndexOf('/')) : '';
        if (destFolder === srcFolder) { moved.push(n); continue; }
        movedAcrossFolders = true;
        try {
          const oldPath = dragData.path;
          const res = await apiPost('/outliner/move', { path: dragData.path, dest_folder: destFolder });
          if (res.new_path) {
            if (typeof _renameTreeNode === 'function') {
              _renameTreeNode(oldPath, res.new_path, res.new_name || dragData.name, res.file_id);
            } else {
              dragData.path = res.new_path;
              dragData.name = res.new_name || dragData.name;
              const lbl = n.querySelector('.tree-label');
              if (lbl && res.new_name) lbl.textContent = res.new_name;
            }
            if (typeof renameAppPathReferences === 'function') {
              renameAppPathReferences(oldPath, res.new_path, { label: res.new_name || dragData.name, fileId: res.file_id, type: dragData.type || 'page' });
            }
          }
          if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
          moved.push(n);
        } catch {
          showStatus(`${dragData.name} の移動に失敗`, true);
        }
      }
      if (moved.length === 0) return;
      // DOM上の移動（ドロップ位置に順番通り挿入）
      if (position === 'inside' && (isFolder || isDB)) {
        if (childrenDiv.dataset.loaded === 'false') {
          if (toggle.dataset.expanded !== 'true') toggle.click();
        } else {
          moved.forEach(n => childrenDiv.appendChild(n));
          if (toggle.dataset.expanded !== 'true') toggle.click();
          setSortSetting(item.path, 'manual', 'asc');
          saveManualOrderFromDOM(childrenDiv, item.path);
          if (!movedAcrossFolders) {
            pushOutlinerSettingsHistory('フォルダツリー: 並び順', orderBefore, item.path, [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);
          }
        }
      } else if (position === 'above') {
        moved.forEach(n => targetParent.insertBefore(n, div));
      } else {
        let ref = div.nextSibling;
        moved.forEach(n => { targetParent.insertBefore(n, ref); });
      }
      if (position !== 'inside') {
        const parentNode = targetParent.closest('.tree-node');
        const parentPath = parentNode?._nodeData?.path || '_root';
        setSortSetting(parentPath, 'manual', 'asc');
        saveManualOrderFromDOM(targetParent, parentPath);
        if (!movedAcrossFolders) {
          pushOutlinerSettingsHistory('フォルダツリー: 並び順', orderBefore, parentPath, [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);
        }
      }
    })();
  });

  _registerTreeNode(div);
  return div;
}

function clearDragIndicators() {
  document.querySelectorAll('.drag-over-above,.drag-over-below,.drag-over-inside').forEach(el => {
    el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
  });
}

// DOMからツリー構造をJSON化
function domToTree(container) {
  const tree = [];
  container.querySelectorAll(':scope > .tree-node').forEach(nodeEl => {
    const data = nodeEl._nodeData;
    if (!data) return;
    const childrenContainer = nodeEl.querySelector(':scope > .tree-children');
    const node = { ...data };
    if (childrenContainer && childrenContainer.children.length > 0) {
      const childNodes = domToTree(childrenContainer).filter(c => c.type !== 'entity');
      if (data.type === 'folder' || data.type === 'database') {
        node.children = childNodes;
