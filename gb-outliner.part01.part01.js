/**
 * Meldex Outliner
 * フォルダツリー、検索、フィルタ、お気に入り、サイドバー
 */

// サイドバー全体でブラウザ標準の右クリックメニューを抑制（captureフェーズで確実に）
document.addEventListener('contextmenu', (e) => {
  if (e.target?.closest?.('#sidebar')) e.preventDefault();
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
  try { localStorage.setItem('outliner-expanded', JSON.stringify(paths)); } catch {}
}
function isExpandedState(path) {
  const paths = getExpandedPaths();
  const fid = _pathToFileId(path);
  return (fid && paths.includes(fid)) || paths.includes(path);
}

const OUTLINER_AUTO_EXPAND_LIMIT = 40;
const OUTLINER_CHILD_RENDER_CHUNK_SIZE = 120;
let _outlinerAutoExpandQueue = [];
let _outlinerAutoExpandRunning = false;
let _outlinerAutoExpandScheduled = 0;
let _outlinerAutoExpandOverflowNotified = false;
// デスクトップ起動時は初回のみ自動展開を抑制するが、
// ユーザー操作の更新では直前の展開状態を必ず復元する
let _outlinerForceExpansionMode = false;
let _outlinerLoadGeneration = 0;
let _outlinerLoadInFlight = null;
let _outlinerLastLoadCompletedAt = 0;
const OUTLINER_RECENT_LOAD_REUSE_MS = 4000;
const _treeNodeCache = new Map();

function _outlinerNowMs() {
  return typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
}

function _outlinerHasRenderedTree() {
  const el = document.getElementById('outliner-tree');
  return !!el?.querySelector?.(':scope > .tree-node');
}

function _outlinerScheduleRenderFrame(callback) {
  if (typeof requestAnimationFrame === 'function' && document.visibilityState !== 'hidden') {
    requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

function _outlinerChildRenderChunkSize(total) {
  return total > OUTLINER_CHILD_RENDER_CHUNK_SIZE ? OUTLINER_CHILD_RENDER_CHUNK_SIZE : Math.max(1, total || 1);
}

function _outlinerNextFrame() {
  return new Promise(resolve => _outlinerScheduleRenderFrame(resolve));
}

async function _appendOutlinerChildrenChunked(container, children, rootPath) {
  if (!container || !Array.isArray(children) || !children.length) return;
  const chunkSize = _outlinerChildRenderChunkSize(children.length);
  for (let i = 0; i < children.length; i += chunkSize) {
    const fragment = document.createDocumentFragment();
    children.slice(i, i + chunkSize).forEach(child => {
      fragment.appendChild(createTreeNodeFromBrowse(child, rootPath));
    });
    container.appendChild(fragment);
    if (i + chunkSize < children.length) await _outlinerNextFrame();
  }
}

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
  document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node').forEach(node => {
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
  if (_outlinerForceExpansionMode) return OUTLINER_AUTO_EXPAND_LIMIT;
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
    _outlinerForceExpansionMode = false;
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
  if (!['folder', 'database', 'entity'].includes(rawType) && (lowerPath.endsWith('.mel-board') || lowerPath.endsWith('.board.md'))) return 'board';
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

async function loadOutliner(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const perfStartedAt = _outlinerNowMs();
  if (!opts.force && opts.coalesce && _outlinerLoadInFlight) {
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('outliner.load.coalesced', perfStartedAt, { reason: opts.reason || '' });
    }
    return _outlinerLoadInFlight;
  }
  const recentMs = Number.isFinite(opts.recentMs) ? opts.recentMs : OUTLINER_RECENT_LOAD_REUSE_MS;
  if (!opts.force && opts.skipIfRecentlyLoaded && _outlinerLastLoadCompletedAt
      && (perfStartedAt - _outlinerLastLoadCompletedAt) < recentMs && _outlinerHasRenderedTree()) {
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('outliner.load.skip.recent', perfStartedAt, {
        ageMs: Math.round(perfStartedAt - _outlinerLastLoadCompletedAt),
        reason: opts.reason || '',
      });
    }
    return { skipped: true, reason: 'recent' };
  }

  const loadGeneration = ++_outlinerLoadGeneration;
  const loadPromise = (async () => {
    showLoading('フォルダを読み込み中...');
    let rendered = false;
    try {
      if (typeof _primeFileLockCacheFromStorage === 'function') _primeFileLockCacheFromStorage();
      // スクロール位置を保存してから再読み込み
      const tree = document.getElementById('tree-scroll-container');
      const scrollTop = tree ? tree.scrollTop : 0;
      try {
        const roots = await apiFetch('/outliner-roots');
        if (loadGeneration !== _outlinerLoadGeneration) {
          if (typeof _logPerfEvent === 'function') {
            _logPerfEvent('outliner.load.stale', perfStartedAt, { stage: 'roots', reason: opts.reason || '' });
          }
          return { stale: true };
        }
        renderOutlinerMultiRoot(Array.isArray(roots) ? roots : []);
        rendered = true;
        if (typeof _logPerfEvent === 'function') {
          _logPerfEvent('outliner.load.roots', perfStartedAt, {
            rootsCount: Array.isArray(roots) ? roots.length : 0,
          });
        }
      } catch (e) {
        // フォールバック: 従来のルートフォルダルート
        try {
          const items = await apiFetch('/browse?all_files=true');
          if (loadGeneration !== _outlinerLoadGeneration) {
            if (typeof _logPerfEvent === 'function') {
              _logPerfEvent('outliner.load.stale', perfStartedAt, { stage: 'legacy', reason: opts.reason || '' });
            }
            return { stale: true };
          }
          renderOutlinerLegacy(items);
          rendered = true;
          if (typeof _logPerfEvent === 'function') {
            _logPerfEvent('outliner.load.legacy', perfStartedAt, {
              itemCount: Array.isArray(items) ? items.length : 0,
              fallback: true,
            });
          }
        } catch (e2) {
          if (loadGeneration === _outlinerLoadGeneration) {
            renderOutlinerLegacy([]);
            rendered = true;
          }
        }
      }
      if (loadGeneration !== _outlinerLoadGeneration) return { stale: true };
      if (typeof applyGlobalFilter === 'function') applyGlobalFilter();
      // スクロール位置を復元（DOM再構築後も確実に復元）
      if (tree) {
        tree.scrollTop = scrollTop;
        requestAnimationFrame(() => { tree.scrollTop = scrollTop; });
      }
      if (typeof _scheduleFileLockRefreshForOutliner === 'function') _scheduleFileLockRefreshForOutliner();
      if (rendered) _outlinerLastLoadCompletedAt = _outlinerNowMs();
      return { rendered };
    } finally {
      if (typeof _logPerfEvent === 'function') _logPerfEvent('outliner.load.total', perfStartedAt);
      hideLoading();
    }
  })();
  _outlinerLoadInFlight = loadPromise;
  try {
    return await loadPromise;
  } finally {
    if (_outlinerLoadInFlight === loadPromise) _outlinerLoadInFlight = null;
  }
}

function renderOutlinerLegacy(items) {
  const el = document.getElementById('outliner-tree');
  _unregisterTreeSubtree(el);
  el.innerHTML = '';
  const visibleItems = (items || []).filter(item => !(typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(item?.path)));
  OUTLINER_CONFLICT_PATHS.clear();
  _registerOutlinerConflictPaths(visibleItems);
  const fragment = document.createDocumentFragment();
  visibleItems.forEach(item => fragment.appendChild(createTreeNodeFromBrowse(item)));
  el.appendChild(fragment);
  // ルート直下のマニュアル並び順を復元（_root キーで保存される）
  applyManualSort(el, '_root');
}

function renderOutlinerMultiRoot(roots) {
  const el = document.getElementById('outliner-tree');
  _unregisterTreeSubtree(el);
  el.innerHTML = '';
  // ワークスペース由来のルートはワークスペースセクション側で表示するため、ソースフォルダセクションには描画しない
  const visibleRoots = roots.filter(r => r.visible
    && !(r.kind === 'workspace' || r.workspaceId)
    && !(typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(r.path)));
  OUTLINER_CONFLICT_PATHS.clear();
  _registerOutlinerConflictPaths(visibleRoots);

  // 各ルートを通常のフォルダノードとしてツリーに追加（_isRootフラグ付き）
  const fragment = document.createDocumentFragment();
  for (const root of visibleRoots) {
    const isWorkspaceRoot = root.kind === 'workspace' || !!root.workspaceId;
    const rootItem = {
      name: root.name,
      type: 'folder',
      path: root.path,
      sourceId: isWorkspaceRoot ? '' : (root.sourceId || root.id || ''),
      provider: root.provider || '',
      dropboxPath: root.dropboxPath || '',
      needsMapping: root.needsMapping === true,
      rootKind: root.kind || '',
      workspaceId: root.workspaceId || '',
      _isRoot: true,
    };
    fragment.appendChild(createTreeNodeFromBrowse(rootItem, root.path));
  }
  el.appendChild(fragment);
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
  if (nodeEl?.closest('#body-workspaces')) return '#body-workspaces';
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
  const fallback = primaryItem && primaryItem.path && !primaryItem._isRoot
    ? [{ name: primaryItem.name || '', path: primaryItem.path || '', type: primaryItem.type || '' }]
    : [];
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
  if (typeof renderWorkspaceSidebar === 'function') renderWorkspaceSidebar();
}

async function refreshOutliner(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const refreshJobs = [];
  if (typeof loadOutliner === 'function') refreshJobs.push(Promise.resolve().then(() => loadOutliner(opts)));
  if (typeof renderFavorites === 'function') refreshJobs.push(Promise.resolve().then(() => renderFavorites()));
  if (typeof renderHomeFolderTree === 'function') refreshJobs.push(Promise.resolve().then(() => renderHomeFolderTree()));
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
