/* gb-outliner.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-outliner.part01.js */
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
  const rawType = String(type || '');
  const lowerPath = String(path || '').split(/[?#]/)[0].toLowerCase();
  if (!['folder', 'database', 'entity'].includes(rawType) && lowerPath.endsWith('.board.md')) return 'board';
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
  const visibleItems = (items || []).filter(item => !(typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(item?.path)));
  OUTLINER_CONFLICT_PATHS.clear();
  _registerOutlinerConflictPaths(visibleItems);
  visibleItems.forEach(item => el.appendChild(createTreeNodeFromBrowse(item)));
  // ルート直下のマニュアル並び順を復元（_root キーで保存される）
  applyManualSort(el, '_root');
}

function renderOutlinerMultiRoot(roots) {
  const el = document.getElementById('outliner-tree');
  _unregisterTreeSubtree(el);
  el.innerHTML = '';
  const visibleRoots = roots.filter(r => r.visible && !(typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(r.path)));
  OUTLINER_CONFLICT_PATHS.clear();
  _registerOutlinerConflictPaths(visibleRoots);

  // 各ルートを通常のフォルダノードとしてツリーに追加（_isRootフラグ付き）
  for (const root of visibleRoots) {
    const rootItem = {
      name: root.name,
      type: 'folder',
      path: root.path,
      sourceId: root.sourceId || root.id || '',
      provider: root.provider || '',
      dropboxPath: root.dropboxPath || '',
      needsMapping: root.needsMapping === true,
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
  if (typeof loadOutliner === 'function') refreshJobs.push(Promise.resolve().then(() => loadOutliner()));
  if (typeof renderFavorites === 'function') refreshJobs.push(Promise.resolve().then(() => renderFavorites()));
  if (typeof renderHomeFolderTree === 'function') refreshJobs.push(Promise.resolve().then(() => renderHomeFolderTree()));
  return Promise.allSettled(refreshJobs);
}

async function refreshOutlinerFromButton(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const btn = event?.target?.closest?.('.sidebar-section-btn, .cloud-mobile-tree-refresh') || null;
  if (btn?.disabled) return;
  if (btn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  try {
    const results = await refreshOutliner();
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
  if (item.file_id) _registerFileId(item.path, item.file_id);

  const row = document.createElement('div');
  row.className = 'tree-node-row';
  row.dataset.itemType = item.type || '';
  if (item.sourceId) row.dataset.sourceId = item.sourceId;
  const itemLocked = item.path && isItemLocked(item.path);
  row.draggable = !itemLocked;

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
    notice.style.cssText = 'margin-left:6px;color:var(--fg2);font-size:11px;white-space:nowrap;';
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
            const sourceParam = item.sourceId ? '&sourceId=' + encodeURIComponent(item.sourceId) : '';
            const children = await apiFetch('/browse?path=' + encodeURIComponent(item.path) + '&sort=' + apiSort + '&order=' + sortCfg.order + rootParam + sourceParam + '&all_files=true');
            const visibleChildren = children.filter(child => !(typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(child?.path)));
            registerFileTypes(visibleChildren);
            _registerOutlinerConflictPaths(visibleChildren);
            visibleChildren.forEach(child => {
              if (item.sourceId && !child.sourceId) child.sourceId = item.sourceId;
              childrenDiv.appendChild(createTreeNodeFromBrowse(child, rootPath));
            });
            // マニュアルソート適用
            if (sortCfg.sort === 'manual') applyManualSort(childrenDiv, item.path);
            // 非同期でDB/board判定（NAS高速化: browseは拡張子のみで判定し、後からcheck-typeで確定）
            const checkTargets = visibleChildren.filter(c => c.type === 'folder' || c.type === 'page' || c.type === 'scenario' || c.type === 'scriptnote');
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

/* Source chunk: gb-outliner.part02.js */
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

/* Source chunk: gb-outliner.part03.js */
  input.style.cssText = 'width:100%;background:var(--bg);color:var(--fg);border:1px solid var(--accent);border-radius:2px;padding:1px 4px;font-size:13px;outline:none;';
  labelEl.textContent = '';
  labelEl.appendChild(input);
  input.focus();
  // クリックがrowのclickイベントにバブルしてファイルを開くのを防止
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());

  const finish = async () => {
    const nv = input.value.trim() || '無題';
    labelEl.textContent = nv;

    // ファイル/フォルダの実体をリネーム
    if (nodeData.path && nv !== old) {
      try {
        const res = await apiPost('/outliner/rename', {
          old_path: nodeData.path,
          new_name: nv,
          type: nodeData.type || 'page'
        });
        if (!res || !res.new_path) throw new Error('rename failed');
        const oldPath = nodeData.path;
        // DOM・データ両方を更新（_renameTreeNodeで一括処理）
        _renameTreeNode(oldPath, res.new_path, nv, res.file_id);
        // アンドゥ対応
        historyPush(`リネーム: ${old} → ${nv}`,
          async () => {
            const r2 = await apiPost('/outliner/rename', { old_path: res.new_path, new_name: old, type: nodeData.type || 'page' });
            _renameTreeNode(res.new_path, oldPath, old, r2?.file_id);
            if (typeof renameAppPathReferences === 'function') renameAppPathReferences(res.new_path, oldPath, { label: old, fileId: r2?.file_id, type: nodeData.type || 'page' });
          },
          async () => {
            const r2 = await apiPost('/outliner/rename', { old_path: oldPath, new_name: nv, type: nodeData.type || 'page' });
            _renameTreeNode(oldPath, res.new_path, nv, r2?.file_id);
            if (typeof renameAppPathReferences === 'function') renameAppPathReferences(oldPath, res.new_path, { label: nv, fileId: r2?.file_id, type: nodeData.type || 'page' });
          }
        );
        if (typeof renameAppPathReferences === 'function') {
          renameAppPathReferences(oldPath, res.new_path, { label: nv, fileId: res.file_id, type: nodeData.type || 'page' });
        }
        showStatus(`「${old}」→「${nv}」にリネームしました`);
        if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
      } catch (e) {
        // API失敗時はラベルを元に戻す
        labelEl.textContent = old;
      }
    }
    if (onFinish) onFinish();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = old; input.blur(); }
  });
}

function backToPivot() {
  state.currentEntityPath = null;
  if (state.currentDbPath) {
    selectDatabase(state.currentDbPath);
  } else {
    showView('pivot');
  }
  document.querySelectorAll('.tree-node-row.active').forEach(el => el.classList.remove('active'));
}

// ツリーノードのパス・名前をDOM上で直接更新（リネーム後の即時反映用）
function _renameTreeNode(oldPath, newPath, newName, fileId) {
  const nodes = document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node');
  const oldPrefix = oldPath + '/';
  const expanded = getExpandedPaths();
  const colors = getNodeColors();
  let expandedChanged = false;
  let colorsChanged = false;

  // file_id キャッシュを更新
  if (fileId) {
    _registerFileId(newPath, fileId);
  }

  for (const node of nodes) {
    const d = node._nodeData;
    if (!d || !d.path) continue;

    if (d.path === oldPath) {
      // リネーム対象ノード自体
      if (typeof _unregisterTreeNode === 'function') _unregisterTreeNode(node, d.path);
      d.path = newPath;
      d.name = newName;
      if (fileId) d.file_id = fileId;
      node.dataset.path = newPath;
      const label = node.querySelector('.tree-label');
      if (label) label.textContent = newName;
      if (typeof _registerTreeNode === 'function') _registerTreeNode(node);
    } else if (d.path.startsWith(oldPrefix)) {
      // 子ノード: パスの接頭辞を書き換え
      const childOldPath = d.path;
      const childNewPath = newPath + d.path.substring(oldPath.length);
      if (typeof _unregisterTreeNode === 'function') _unregisterTreeNode(node, childOldPath);
      // 旧パスキーの色を新パスキーに移行（file_id キーがあればそちらは不変）
      if (colors[d.path]) { colors[childNewPath] = colors[d.path]; delete colors[d.path]; colorsChanged = true; }
      // 子ノードの file_id キャッシュも更新
      if (d.file_id) _registerFileId(childNewPath, d.file_id);
      d.path = childNewPath;
      node.dataset.path = childNewPath;
      if (typeof _registerTreeNode === 'function') _registerTreeNode(node);
    } else {
      continue;
    }
  }

  // localStorage展開状態: 旧パスキーを新パスキーに変換（file_idキーは不変なのでスキップ）
  let expChanged = false;
  for (let i = 0; i < expanded.length; i++) {
    if (expanded[i] === oldPath) { expanded[i] = newPath; expChanged = true; }
    else if (expanded[i].startsWith(oldPrefix)) { expanded[i] = newPath + expanded[i].substring(oldPath.length); expChanged = true; }
  }
  if (expChanged) localStorage.setItem('outliner-expanded', JSON.stringify(expanded));

  // ノード色: 旧パスキーを新パスキーに変換
  if (colors[oldPath]) { colors[newPath] = colors[oldPath]; delete colors[oldPath]; colorsChanged = true; }
  if (colorsChanged) localStorage.setItem(NODE_COLORS_KEY, JSON.stringify(colors));
  try {
    const manual = JSON.parse(localStorage.getItem(MANUAL_ORDER_KEY) || '{}');
    let manualChanged = false;
    const oldName = oldPath.split('/').pop() || oldPath;
    const oldParent = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '_root';
    const newParent = newPath.includes('/') ? newPath.substring(0, newPath.lastIndexOf('/')) : '_root';
    const renameOrderKeys = new Set([oldParent, newParent, _pathToFileId(oldParent), _pathToFileId(newParent)].filter(Boolean));
    Object.keys(manual).forEach(key => {
      const mappedKey = key === oldPath ? newPath : (key.startsWith(oldPrefix) ? newPath + key.substring(oldPath.length) : key);
      if (mappedKey !== key) {
        manual[mappedKey] = manual[key];
        delete manual[key];
        manualChanged = true;
      }
      if (renameOrderKeys.has(mappedKey) && Array.isArray(manual[mappedKey])) {
        const next = manual[mappedKey].map(name => name === oldName ? newName : name);
        if (next.some((name, idx) => name !== manual[mappedKey][idx])) {
          manual[mappedKey] = next;
          manualChanged = true;
        }
      }
    });
    if (manualChanged) localStorage.setItem(MANUAL_ORDER_KEY, JSON.stringify(manual));
  } catch {}
}

// フォルダツリーで対応ノードをハイライト（auto-link遷移・ページ復元等で使用）
function highlightOutlinerNode(targetPath, opts) {
  document.querySelectorAll('.tree-node-row.active').forEach(r => r.classList.remove('active'));
  if (!targetPath) return;
  const noScroll = opts && opts.noScroll;
  // まず既に表示されているノードを探す
  let found = _findAndHighlight(targetPath, noScroll);
  if (found) return;
  // 見つからない場合、パスを分解して親フォルダを順に展開
  _autoExpandToPath(targetPath);
}

function _findAndHighlight(targetPath, noScroll) {
  const nodes = document.querySelectorAll('#sidebar .tree-node, #body-home .tree-node');
  for (const node of nodes) {
    const data = node._nodeData;
    if (data && data.path === targetPath) {
      const row = node.querySelector('.tree-node-row');
      if (row) {
        row.classList.add('active');
        if (!noScroll) row.scrollIntoView({ block: 'nearest' });
      }
      return true;
    }
  }
  return false;
}

async function _autoExpandToPath(targetPath) {
  // パスの各階層を上から順に展開
  const parts = targetPath.replace(/\\/g, '/').split('/');
  for (let i = 1; i <= parts.length; i++) {
    const partial = parts.slice(0, i).join('/');
    const nodes = document.querySelectorAll('#sidebar .tree-node, #body-home .tree-node');
    let expanded = false;
    for (const node of nodes) {
      const data = node._nodeData;
      if (data && data.path === partial) {
        const toggle = node.querySelector('.tree-toggle');
        if (toggle && toggle.dataset.expanded !== 'true') {
          const childrenDiv = node.querySelector(':scope > .tree-children');
          toggle.click();
          // lazy load完了を待つ（子要素が追加されるか、最大2秒）
          for (let w = 0; w < 20; w++) {
            await new Promise(r => setTimeout(r, 100));
            if (childrenDiv && childrenDiv.dataset.loaded === 'true') break;
          }
          expanded = true;
        }
        break;
      }
    }
    // 展開したら次の階層でターゲットが見つかるかチェック
    if (expanded && _findAndHighlight(targetPath)) return;
  }
  _findAndHighlight(targetPath);
}

/* ==============================
   フォルダごとのファイル非表示
   ============================== */
/* フィルタ / 検索 / フォルダごとの非表示は gb-outliner-search.js に分離 */
document.getElementById('outliner-tree')?.addEventListener('dragover', e => e.preventDefault());

// ドラッグ中のホイールスクロール対応
(function() {
  let _isDragging = false;
  document.addEventListener('dragstart', () => { _isDragging = true; });
  document.addEventListener('dragend', () => { _isDragging = false; });
  document.addEventListener('drop', () => { _isDragging = false; });
  // ドラッグ中にホイールでスクロール可能にする
  const scrollTargets = ['tree-scroll-container'];
  scrollTargets.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('wheel', (e) => {
      if (!_isDragging) return;
      e.preventDefault();
      el.scrollTop += e.deltaY;
    }, { passive: false });
  });
})();

(function initOutlinerLassoSelection() {
  const scroller = document.getElementById('tree-scroll-container');
  if (!scroller) return;
  const LASSO_DRAG_THRESHOLD = 4;
  let active = false;
  let tracking = false;
  let box = null;
  let startX = 0;
  let startY = 0;
  let startClientX = 0;
  let startClientY = 0;
  let selectionMode = 'replace';
  let selectionScope = '#outliner-tree,#body-home';
  let baseSelection = [];
  let candidateRow = null;
  let candidateRowDraggable = null;
  let pointerId = null;
  let pointerCaptured = false;
  let _savedScrollerPosition = null;

  function _outlinerLassoMode(event) {
    if (event.ctrlKey || event.metaKey) return 'toggle';
    if (event.shiftKey) return 'add';
    return 'replace';
  }

  function _outlinerLassoScopeFromTarget(target) {
    if (target?.closest?.('#body-home')) return '#body-home';
    if (target?.closest?.('#outliner-tree')) return '#outliner-tree';
    const section = target?.closest?.('.sidebar-section');
    if (section?.id === 'section-home') return '#body-home';
    if (section?.id === 'section-roots') return '#outliner-tree';
    return '#outliner-tree,#body-home';
  }

  function _outlinerLassoBlockedTarget(target) {
    return !!target?.closest?.('.tree-hover-btn, .tree-toggle, .sidebar-section-header, .fav-item, input, textarea, button, select, [contenteditable="true"]');
  }

  function _outlinerLassoAllowedTarget(target) {
    if (target?.closest?.('#outliner-tree, #body-home')) return true;
    const section = target?.closest?.('.sidebar-section');
    return section?.id === 'section-roots' || section?.id === 'section-home';
  }

  function _outlinerLassoCandidateRow(target, mode) {
    const row = target?.closest?.('.tree-node-row');
    if (!row) return null;
    const node = row.closest('.tree-node');
    if (!node) return null;
    if (mode === 'replace' && treeSelection.has(node)) return null;
    return row;
  }

  function _outlinerLassoRectForEvent(event) {
    const rect = scroller.getBoundingClientRect();
    const currentX = event.clientX - rect.left + scroller.scrollLeft;
    const currentY = event.clientY - rect.top + scroller.scrollTop;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  function _outlinerLassoRowRect(row) {
    const rowRect = row.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return {
      left: rowRect.left - scrollerRect.left + scroller.scrollLeft,
      top: rowRect.top - scrollerRect.top + scroller.scrollTop,
      right: rowRect.left - scrollerRect.left + scroller.scrollLeft + rowRect.width,
      bottom: rowRect.top - scrollerRect.top + scroller.scrollTop + rowRect.height,
    };
  }

  function _outlinerRectsOverlap(a, b) {
    return !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
  }

  const updateSelection = (lassoRect) => {
    const base = new Set(baseSelection.filter(node => node?.isConnected));
    const hitNodes = [];
    treeSelection.clear();
    base.forEach(node => treeSelection.add(node));
    _getVisibleTreeNodes(selectionScope).forEach(nodeEl => {
      const row = nodeEl.querySelector('.tree-node-row');
      if (!row) return;
      if (!_outlinerRectsOverlap(lassoRect, _outlinerLassoRowRect(row))) return;
      hitNodes.push(nodeEl);
      if (selectionMode === 'toggle' && base.has(nodeEl)) treeSelection.remove(nodeEl);
      else treeSelection.add(nodeEl);
    });
    treeSelection.lastClicked = hitNodes[hitNodes.length - 1] || [...treeSelection.items].pop() || treeSelection.lastClicked;
    if (treeSelection.items.size > 1) showStatus(treeSelection.items.size + ' 件選択中');
  };

  const beginLasso = (event) => {
    if (active) return;
    active = true;
    if (!pointerCaptured && pointerId != null && scroller.setPointerCapture) {
      try {
        scroller.setPointerCapture(pointerId);
        pointerCaptured = true;
      } catch {}
    }
    box = document.createElement('div');
    box.className = 'outliner-lasso-box';
    _savedScrollerPosition = scroller.style.position;
    scroller.style.position = 'relative';
    scroller.appendChild(box);
    if (selectionMode === 'replace') treeSelection.clear();
    updateSelection(_outlinerLassoRectForEvent(event));
  };

  const endLasso = () => {
    if (!tracking && !active) return;
    const wasActive = active;
    const hadCandidateRow = !!candidateRow;
    const suppressClickNode = candidateRow?.closest?.('.tree-node') || null;
    active = false;
    tracking = false;
    removeDocumentPointerEndHandlers();
    box?.remove();
    box = null;
    if (pointerCaptured && pointerId != null && scroller.releasePointerCapture) {
      try { scroller.releasePointerCapture(pointerId); } catch {}
    }
    pointerId = null;
    pointerCaptured = false;
    if (candidateRow) {
      candidateRow.draggable = candidateRowDraggable;
      candidateRow = null;
      candidateRowDraggable = null;
    }
    // pointerdown で設定した inline position を元に戻す
    if (_savedScrollerPosition !== null) {
      scroller.style.position = _savedScrollerPosition;
      _savedScrollerPosition = null;
    }
    if (!wasActive && !hadCandidateRow && selectionMode === 'replace') treeSelection.clear();
    if (wasActive && hadCandidateRow) {
      _outlinerSuppressNextTreeRowClick = true;
      _outlinerSuppressTreeRowClickNode = suppressClickNode;
      setTimeout(() => {
        _outlinerSuppressNextTreeRowClick = false;
        _outlinerSuppressTreeRowClickNode = null;
      }, 500);
    }
  };

  function addDocumentPointerEndHandlers() {
    document.addEventListener('pointerup', endLasso, true);
    document.addEventListener('pointercancel', endLasso, true);
  }

  function removeDocumentPointerEndHandlers() {
    document.removeEventListener('pointerup', endLasso, true);
    document.removeEventListener('pointercancel', endLasso, true);
  }

  scroller.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (_outlinerLassoBlockedTarget(e.target)) return;
    if (!_outlinerLassoAllowedTarget(e.target)) return;
    selectionMode = _outlinerLassoMode(e);
    candidateRow = _outlinerLassoCandidateRow(e.target, selectionMode);
    if (e.target.closest('.tree-node-row') && !candidateRow) return;
    tracking = true;
    active = false;
    addDocumentPointerEndHandlers();
    pointerId = e.pointerId;
    pointerCaptured = false;
    selectionScope = _outlinerLassoScopeFromTarget(e.target);
    baseSelection = selectionMode === 'replace' ? [] : [...treeSelection.items];
    const rect = scroller.getBoundingClientRect();
    startX = e.clientX - rect.left + scroller.scrollLeft;
    startY = e.clientY - rect.top + scroller.scrollTop;
    startClientX = e.clientX;
    startClientY = e.clientY;
    if (candidateRow) {
      candidateRowDraggable = candidateRow.draggable;
      candidateRow.draggable = false;
    }
  });

  scroller.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    const distance = Math.max(Math.abs(e.clientX - startClientX), Math.abs(e.clientY - startClientY));
    if (!active && distance < LASSO_DRAG_THRESHOLD) return;
    beginLasso(e);
    const rect = _outlinerLassoRectForEvent(e);
    const { left, top, width, height } = rect;
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    updateSelection(rect);
    e.preventDefault();
  });
  scroller.addEventListener('pointerup', endLasso);
  scroller.addEventListener('pointercancel', endLasso);
})();
document.getElementById('outliner-tree')?.addEventListener('drop', async e => {
  e.preventDefault();
  const files = e.dataTransfer.files; if (!files.length) return;
  let parentPath = '';
  // ドロップ先のフォルダを検出
  const nodeEl = e.target.closest('.tree-node');
  if (nodeEl && nodeEl._nodeData) {
    const nd = nodeEl._nodeData;
    if (nd.type === 'folder' || nd.type === 'database') parentPath = nd.path;
    else parentPath = nd.path.substring(0, nd.path.lastIndexOf('/'));
  }
  showStatus(`${files.length}個のファイルをインポート中...`);
  const promises = [];
  for (const f of files) {
    const p = new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = async ev => {
        try {
          await apiFetch('/upload-file?path=' + encodeURIComponent(parentPath), {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({data: ev.target.result, filename: f.name})
          });
        } catch(err) {}
        resolve();
      };
      reader.readAsDataURL(f);
    });
    promises.push(p);
  }
  await Promise.all(promises);
  await loadOutliner();
  showStatus(files.length + '個のファイルをインポートしました');
});
