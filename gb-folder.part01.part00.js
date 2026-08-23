/**
 * Folder view link and membership helpers.
 */

let _folderMembershipCache = new Map();
let _folderMembershipLoading = new Set();
let _folderTagCache = new Map();
let _folderTagLoading = new Set();
let _folderRenderSeq = 0;
const FOLDER_PANEL_RENDER_CHUNK_SIZE = 80;
const WEB_PREVIEWABLE_IMAGE = new Set(['image']);
let _folderPath = '';
let _folderItems = [];
let _folderUnifiedSearchPaths = new Set();
let _folderUnifiedSearchSeq = 0;
let _folderUnifiedSearchTimer = 0;

function _folderSearchHintEl() {
  return document.getElementById('folder-panel-search-hint');
}

function _refreshFolderUnifiedSearch(query) {
  const text = String(query || '').trim();
  const seq = ++_folderUnifiedSearchSeq;
  _folderUnifiedSearchPaths = new Set();
  const hasTagCondition = (window.MeldexUnifiedSearch?.readTagCondition?.().tagIds || []).length > 0;
  // クエリの言語チェックだけは通信を待たず即時に出す。使えない理由は
  // 検索結果が返ってから追加で反映する。
  window.MeldexUnifiedSearch?.updateHint?.(_folderSearchHintEl(), null, text);
  if ((!text && !hasTagCondition) || !window.MeldexUnifiedSearch?.search) return Promise.resolve();
  const scopes = window.MeldexUnifiedSearch.active();
  if (!hasTagCondition && !scopes.some(scope => scope !== 'name')) return Promise.resolve();
  return window.MeldexUnifiedSearch.search(text, { path: _folderPath || '', limit: 100 })
    .then(data => {
      if (seq !== _folderUnifiedSearchSeq) return;
      _folderUnifiedSearchPaths = new Set((data.results || []).map(item => String(item.path || '').replace(/\\/g, '/').toLowerCase()));
      if (typeof renderFolderGrid === 'function') renderFolderGrid();
      window.MeldexUnifiedSearch?.updateHint?.(_folderSearchHintEl(), data, text);
    })
    .catch(() => {});
}

function _scheduleFolderUnifiedSearch(query) {
  clearTimeout(_folderUnifiedSearchTimer);
  _folderUnifiedSearchTimer = setTimeout(() => {
    _folderUnifiedSearchTimer = 0;
    _refreshFolderUnifiedSearch(query);
  }, 240);
}

function _folderSearchRowHasTagCondition() {
  return (window.MeldexUnifiedSearch?.readTagCondition?.().tagIds || []).length > 0;
}

window.addEventListener('meldex:search-scopes-changed', () => {
  const cfg = typeof getFolderDisplayConfig === 'function' ? getFolderDisplayConfig() : {};
  const query = String(cfg.filterText || '');
  if (query.trim() || _folderSearchRowHasTagCondition()) _scheduleFolderUnifiedSearch(query);
});
let _folderSelected = null;
let _folderSelectedItems = []; // 複数選択
let _folderLayout = localStorage.getItem('folder-layout') || 'waterfall';
let _folderVisibleItems = [];
let _folderBulkPopupRaf = 0;
let _folderBulkPopupTracking = false;
// パネル表示状態は_getFvPanelCfg()で管理（旧_folderPreviewVisibleは廃止）
let _folderZoom = parseFloat(localStorage.getItem('folder-zoom') || '1');
// ボードのリンクカード計画 Phase B-2（縮小スコープ）: フォルダの状態
// （_folderPath/_folderItems/_folderSelected等）はシートのctxと違い、単一の
// グローバル変数のまま（CSVの_csvRenderContainerOverrideと同じ方針）。サブパネル等の
// 独立した描画先へ開く場合は _folderRenderContainerOverride を使い、共有の
// #folder-grid（および #folder-item-count・#folder-layout-select・一括操作バー・
// プレビューパネル・表示フィルタボタン等のメイン画面専用UI）は一切触らせず、専用DOMへ
// 直接描画する。状態自体は単一のままのため、直前の対象が今回とは別フォルダの場合、
// 直前の描画先（メイン or 以前のサブパネル）へ切り替え通知を出す。
let _folderRenderContainerOverride = null;
const HOME_FOLDER_DISPLAY_LABEL = 'ホームフォルダ';

function _folderScheduleRenderFrame(callback) {
  if (typeof requestAnimationFrame === 'function' && document.visibilityState !== 'hidden') {
    requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

function _folderPanelRenderChunkSize(total) {
  return total > FOLDER_PANEL_RENDER_CHUNK_SIZE ? FOLDER_PANEL_RENDER_CHUNK_SIZE : Math.max(1, total || 1);
}

function _normalizeFolderPathForCompare(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _folderDndPathKey(path) {
  const value = String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/');
  const prefix = value.startsWith('/') ? '/' : '';
  const segments = [];
  value.split('/').forEach(segment => {
    if (!segment || segment === '.') return;
    if (segment === '..') {
      if (segments.length && segments[segments.length - 1] !== '..') segments.pop();
      else if (!prefix) segments.push(segment);
      return;
    }
    segments.push(segment);
  });
  return (prefix + segments.join('/')).replace(/\/+$/, '').toLowerCase();
}

function _folderDndPathIsAncestor(parentPath, childPath) {
  const parentKey = _folderDndPathKey(parentPath);
  const childKey = _folderDndPathKey(childPath);
  return !!parentKey && !!childKey && parentKey !== childKey && childKey.startsWith(parentKey + '/');
}

function _folderDragItemsForStart(primaryItem, selectedItems) {
  const primaryKey = _folderDndPathKey(primaryItem?.path);
  const candidates = (selectedItems || []).filter(item => item?.path);
  const withoutPrimaryAncestors = candidates.filter(item => {
    const key = _folderDndPathKey(item.path);
    return key === primaryKey || !_folderDndPathIsAncestor(item.path, primaryItem?.path);
  });
  const seen = new Set();
  return withoutPrimaryAncestors.filter(item => {
    const key = _folderDndPathKey(item.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !withoutPrimaryAncestors.some(parent => parent !== item && _folderDndPathIsAncestor(parent.path, item.path));
  });
}

function _isHomeFolderPath(path) {
  try {
    return !!_homeFolderPath && _normalizeFolderPathForCompare(path) === _normalizeFolderPathForCompare(_homeFolderPath);
  } catch {
    return false;
  }
}

function _folderDisplayLabel(label, path) {
  if (_isHomeFolderPath(path)) return HOME_FOLDER_DISPLAY_LABEL;
  return String(label || '').trim();
}

function _folderItemRawUrl(item) {
  if (item?.archive_path && item?.archive_member) {
    return '/api/archive/file?path=' + encodeURIComponent(item.archive_path)
      + '&member=' + encodeURIComponent(item.archive_member);
  }
  if (item?.external_reference) {
    return item.external_raw_url || ('/api/external-reference/raw?path=' + encodeURIComponent(item.path));
  }
  return '/api/file-raw?path=' + encodeURIComponent(item.path);
}

function _folderItemThumbnailUrl(item, size = 384) {
  return '/api/thumbnail?path=' + encodeURIComponent(item.path) + '&size=' + encodeURIComponent(size);
}

function _folderItemViewerUrl(item, embed) {
  const suffix = embed ? '&embed=1' : '';
  if (item?.archive_path && item?.archive_member) {
    return '/viewer?archive=' + encodeURIComponent(item.archive_path)
      + '&member=' + encodeURIComponent(item.archive_member) + suffix;
  }
  return '/viewer?file=' + encodeURIComponent(item.path) + suffix;
}

function _syncFolderPanelPathToOutliner(path, opts) {
  if (!path || typeof highlightOutlinerNode !== 'function') return;
  highlightOutlinerNode(path, opts || {});
}

function _syncFolderSelectionToOutliner(item) {
  _syncFolderPanelPathToOutliner(item?.path || _folderPath || '');
}

function _folderMembershipKey(path) {
  return _normalizeFolderPathForCompare(path);
}

function _folderNormalizeMemberships(rows) {
  const source = Array.isArray(rows) ? rows : (Array.isArray(rows?.folders) ? rows.folders : []);
  return source.map(row => {
    if (typeof row === 'string') return { folder: _folderMembershipKey(row), type: '' };
    return {
      folder: _folderMembershipKey(row?.folder || row?.path || row?.folder_path || ''),
      type: String(row?.type || ''),
      file_id: row?.file_id || '',
      added_at: row?.added_at || '',
    };
  }).filter(row => row.folder);
}

function _folderStoreMembershipsForPath(path, rows) {
  const key = _folderMembershipKey(path);
  if (!key) return [];
  const normalized = _folderNormalizeMemberships(rows);
  _folderMembershipCache.set(key, normalized);
  (_folderItems || []).forEach(item => {
    if (_folderMembershipKey(item?.path) === key) item._folderMemberships = normalized;
  });
  return normalized;
}

function _folderInvalidateMembershipsForPath(path) {
  const key = _folderMembershipKey(path);
  if (!key) return;
  _folderMembershipCache.delete(key);
  (_folderItems || []).forEach(item => {
    if (_folderMembershipKey(item?.path) === key) delete item._folderMemberships;
  });
}

function _folderItemMemberships(item) {
  const key = _folderMembershipKey(item?.path);
  if (!key) return [];
  if (Array.isArray(item?._folderMemberships)) return item._folderMemberships;
  if (_folderMembershipCache.has(key)) {
    item._folderMemberships = _folderMembershipCache.get(key);
    return item._folderMemberships;
  }
  return [];
}

function _folderMembershipsAreLoading(items) {
  return (items || []).some(item => _folderMembershipLoading.has(_folderMembershipKey(item?.path)));
}

function _folderWaitForMembershipLoads(items) {
  return new Promise(resolve => {
    let ticks = 0;
    const check = () => {
      if (!_folderMembershipsAreLoading(items) || ticks >= 200) {
        resolve(true);
        return;
      }
      ticks += 1;
      setTimeout(check, 50);
    };
    check();
  });
}

function _folderHasActiveFolderFilter(cfg) {
  return _folderFilterArray(cfg?.filterFolders).length > 0;
}

function _folderTagKey(path) {
  return _folderMembershipKey(path);
}

function _folderNormalizeTags(rows) {
  const source = Array.isArray(rows) ? rows : (Array.isArray(rows?.tags) ? rows.tags : []);
  return source.map(row => {
    if (typeof row === 'string') return { id: '', name: String(row || '') };
    return {
      id: String(row?.id || ''),
      name: String(row?.name || ''),
      color: String(row?.color || ''),
      group_id: row?.group_id || null,
      sort_index: Number(row?.sort_index || 0),
    };
  }).filter(row => row.id || row.name);
}

function _folderStoreTagsForPath(path, rows) {
  const key = _folderTagKey(path);
  if (!key) return [];
  const normalized = _folderNormalizeTags(rows);
  _folderTagCache.set(key, normalized);
  window.MeldexGlobalTags?.primeTargetTagsCache?.(path, normalized);
  (_folderItems || []).forEach(item => {
    if (_folderTagKey(item?.path) === key) item._folderTags = normalized;
  });
  return normalized;
}

function _folderInvalidateTagsForPath(path) {
  const key = _folderTagKey(path);
  if (!key) return;
  _folderTagCache.delete(key);
  window.MeldexGlobalTags?.invalidateTargetTagsCache?.(path);
  (_folderItems || []).forEach(item => {
    if (_folderTagKey(item?.path) === key) delete item._folderTags;
  });
}

function _folderInvalidateTagsForItems(items, options = {}) {
  const rows = Array.isArray(items) ? items : [];
  if (options.all === true) {
    _folderTagCache.clear();
    window.MeldexGlobalTags?.invalidateTargetTagsCache?.();
    rows.forEach(item => {
      if (item) delete item._folderTags;
    });
    return;
  }
  rows.forEach(item => _folderInvalidateTagsForPath(item?.path));
}

async function _folderRefreshTags(items, options = {}) {
  const rows = Array.isArray(items) ? items : [];
  if (_folderTagsAreLoading(rows)) await _folderWaitForTagLoads(rows);
  _folderInvalidateTagsForItems(rows, { all: options.all === true });
  return _folderEnsureTags(rows, { rerender: options.rerender === true });
}

function _folderItemTags(item) {
  const key = _folderTagKey(item?.path);
  if (!key) return [];
  if (Array.isArray(item?._folderTags)) return item._folderTags;
  if (_folderTagCache.has(key)) {
    item._folderTags = _folderTagCache.get(key);
    return item._folderTags;
  }
  return [];
}

function _folderTagsAreLoading(items) {
  return (items || []).some(item => _folderTagLoading.has(_folderTagKey(item?.path)));
}

function _folderWaitForTagLoads(items) {
  return new Promise(resolve => {
    let ticks = 0;
    const check = () => {
      if (!_folderTagsAreLoading(items) || ticks >= 200) {
        resolve(true);
        return;
      }
      ticks += 1;
      setTimeout(check, 50);
    };
    check();
  });
}

function _folderHasActiveTagFilter(cfg) {
  return _folderFilterArray(cfg?.filterTags).length > 0;
}

function _folderTagResultKey(path, sourceFolder) {
  const normalized = _folderTagKey(path);
  const source = _folderTagKey(sourceFolder);
  if (!normalized || !source) return normalized;
  if (normalized === source) return '.';
  return normalized.startsWith(source + '/') ? normalized.slice(source.length + 1) : normalized;
}

async function _folderEnsureTagsIndividually(targets) {
  let changed = false;
  for (let i = 0; i < targets.length; i += 8) {
    const batch = targets.slice(i, i + 8);
    await Promise.all(batch.map(async target => {
      try {
        const data = await apiFetch('/global-tags/target?path=' + encodeURIComponent(target.path), { silentError: true });
        _folderStoreTagsForPath(target.path, data?.tags || []);
        changed = true;
      } catch {
        _folderTagCache.set(target.key, []);
      } finally {
        _folderTagLoading.delete(target.key);
      }
    }));
  }
  return changed;
}

function _folderEnsureTags(items, options = {}) {
  const currentPath = _folderPath;
  const targets = [];
  const seen = new Set();
  (items || []).forEach(item => {
    const key = _folderTagKey(item?.path);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (_folderTagCache.has(key)) {
      item._folderTags = _folderTagCache.get(key);
      return;
    }
    if (!_folderTagLoading.has(key)) targets.push({ key, path: item.path });
  });
  if (targets.length === 0) {
    return _folderTagsAreLoading(items) ? _folderWaitForTagLoads(items) : Promise.resolve(false);
  }
  targets.forEach(target => _folderTagLoading.add(target.key));
  return (async () => {
    let changed = false;
    try {
      const data = await apiFetch(
        '/global-tags/search?tag=&path=' + encodeURIComponent(currentPath),
        { silentError: true },
      );
      if (!Array.isArray(data?.results)) throw new Error('タグ一覧の形式が不正です');
      const byPath = new Map();
      data.results.forEach(result => {
        byPath.set(_folderTagKey(result?.path), result?.tags || []);
      });
      targets.forEach(target => {
        const resultKey = _folderTagResultKey(target.path, data.source_folder);
        _folderStoreTagsForPath(target.path, byPath.get(resultKey) || []);
        _folderTagLoading.delete(target.key);
      });
      changed = true;
    } catch {
      changed = await _folderEnsureTagsIndividually(targets);
    }
    if (changed && options.rerender && _folderPath === currentPath) {
      renderFolderGrid({
        preserveSelectedPaths: (_folderSelectedItems || []).map(item => item?.path).filter(Boolean),
      });
    }
    return changed;
  })();
}

function _folderEnsureMemberships(items, options = {}) {
  const currentPath = _folderPath;
  const targets = [];
  const seen = new Set();
  (items || []).forEach(item => {
    const key = _folderMembershipKey(item?.path);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (_folderMembershipCache.has(key)) {
      item._folderMemberships = _folderMembershipCache.get(key);
      return;
    }
    if (!_folderMembershipLoading.has(key)) targets.push({ key, path: item.path });
  });
  if (targets.length === 0) {
    return _folderMembershipsAreLoading(items) ? _folderWaitForMembershipLoads(items) : Promise.resolve(false);
  }
  targets.forEach(target => _folderMembershipLoading.add(target.key));
  return (async () => {
    let changed = false;
    for (let i = 0; i < targets.length; i += 8) {
      const batch = targets.slice(i, i + 8);
      await Promise.all(batch.map(async target => {
        try {
          const folders = await apiFetch('/file-folders?path=' + encodeURIComponent(target.path));
          _folderStoreMembershipsForPath(target.path, folders);
          changed = true;
        } catch {
          _folderMembershipCache.set(target.key, []);
        } finally {
          _folderMembershipLoading.delete(target.key);
        }
      }));
    }
    if (changed && options.rerender && _folderPath === currentPath) renderFolderGrid();
    return changed;
  })();
}

function _folderFilterFolderKeys(cfg) {
  return _folderFilterArray(cfg?.filterFolders).map(_folderMembershipKey).filter(Boolean);
}

function _folderMatchesFolderFilter(item, selectedFolders) {
  if (!selectedFolders || selectedFolders.size === 0) return true;
  return _folderItemMemberships(item).some(row => selectedFolders.has(_folderMembershipKey(row.folder)));
}

function _folderFilterTagKeys(cfg) {
  return _folderFilterArray(cfg?.filterTags).map(value => String(value || '').toLowerCase()).filter(Boolean);
}

// タグの判定方法（すべて含む=AND / どれかを含む=OR）。既定は「すべて含む」。
// 2026-08系のタグ選択フロートパネル導入までは常にOR固定だった。タグを2件以上
// 保存していた既存フィルタだけ結果が変わる（CHANGELOGへ明記）。
function _folderTagFilterMode(cfg) {
  return (cfg && cfg.filterTagMode === 'any') ? 'any' : 'all';
}

function _folderMatchesTagFilter(item, selectedTags, mode) {
  if (!selectedTags || selectedTags.size === 0) return true;
  const itemKeys = new Set();
  _folderItemTags(item).forEach(tag => {
    const id = String(tag.id || '').toLowerCase();
    const name = String(tag.name || '').toLowerCase();
    if (id) itemKeys.add(id);
    if (name) itemKeys.add(name);
  });
  if (mode === 'any') {
    for (const key of selectedTags) {
      if (itemKeys.has(key)) return true;
    }
    return false;
  }
  for (const key of selectedTags) {
    if (!itemKeys.has(key)) return false;
  }
  return true;
}

function _folderTagLabel(value) {
  const key = String(value || '').toLowerCase();
  for (const item of _folderItems || []) {
    for (const tag of _folderItemTags(item)) {
      if (String(tag.id || '').toLowerCase() === key || String(tag.name || '').toLowerCase() === key) {
        return tag.name || value;
      }
    }
  }
  return value;
}

function _folderMembershipFolderLabel(folder) {
  const normalized = _folderMembershipKey(folder);
  if (!normalized) return '';
  if (_isHomeFolderPath(normalized)) return HOME_FOLDER_DISPLAY_LABEL;
  const parts = normalized.split('/').filter(Boolean);
  const name = parts[parts.length - 1] || normalized;
  return name === normalized ? normalized : `${name} - ${normalized}`;
}

function _folderDragPayloadItemsFromEvent(event, payloadOverride) {
  let payload = payloadOverride || null;
  try {
    if (!payload) {
      const raw = event?.dataTransfer?.getData?.('application/x-meldex-node') || '';
      payload = raw ? JSON.parse(raw) : null;
    }
  } catch {
    payload = null;
  }
  if (!payload) {
    payload = window._gbOutlinerDragPayload || window._gbFolderViewDragPayload || null;
  }
  const rows = Array.isArray(payload?.items) ? payload.items : (payload?.path ? [payload] : []);
  const sourceSurface = payload?.sourceSurface || '';
  const seen = new Set();
  return rows.map(row => ({
    name: row?.name || '',
    path: row?.path || '',
    type: row?.type || 'file',
    sourceSurface: row?.sourceSurface || sourceSurface || 'main',
  })).filter(row => {
    const key = _folderMembershipKey(row.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function _folderCanAcceptLinkDrop(event, targetItem) {
  if (!event?.altKey || !targetItem?.path) return false;
  if (targetItem.type !== 'folder' && targetItem.type !== 'database') return false;
  if (typeof isItemLocked === 'function' && isItemLocked(targetItem.path)) return false;
  const types = Array.from(event?.dataTransfer?.types || []);
  return types.includes('application/x-meldex-node')
    || (typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(event, 'node'));
}

async function _folderCreateLinksFromDrop(event, targetItem, payloadOverride) {
  const targetPath = targetItem?.path || '';
  const targetKey = _folderMembershipKey(targetPath);
  const items = _folderDragPayloadItemsFromEvent(event, payloadOverride)
    .filter(row => _folderMembershipKey(row.path) !== targetKey);
  if (!targetPath || items.length === 0) {
    showStatus('リンク登録できる項目がありません', true);
    return 0;
  }
  let result;
  try {
    result = typeof addFolderLinksBatchWithHistory === 'function'
      ? await addFolderLinksBatchWithHistory(items, targetPath)
      : await apiPost('/folder-links/batch/add', { items: items.map(source => ({ file_path: source.path })), folder_path: targetPath });
  } catch {
    showStatus('リンク登録に失敗しました', true);
    return 0;
  }
  items.forEach(source => _folderInvalidateMembershipsForPath(source.path));
  const ok = result?.created_count || 0;
  const failed = result?.failed_count || 0;
  if (ok > 0 && typeof _folderEnsureMemberships === 'function') {
    _folderEnsureMemberships(_folderItems, { rerender: _folderHasActiveFolderFilter(getFolderDisplayConfig()) });
  }
  const suffix = failed > 0 ? `（${failed} 件失敗）` : '';
  showStatus(ok > 0 ? `${ok} 件を「${targetItem.name || targetPath}」にも表示しました${suffix}` : (failed ? 'リンク登録に失敗しました' : 'すでに表示されています'), failed > 0 && ok === 0);
  return ok;
}

function _folderCanAcceptOsDrop(event, targetItem) {
  if (!event?.dataTransfer || !targetItem?.path) return false;
  if (targetItem.type !== 'folder' && targetItem.type !== 'database') return false;
  if (typeof isItemLocked === 'function' && isItemLocked(targetItem.path)) return false;
  const types = Array.from(event.dataTransfer.types || []);
  return types.includes('Files') && !types.includes('application/x-meldex-node');
}

function _folderReadDroppedFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => resolve(event.target.result);
    reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めませんでした'));
    reader.onabort = () => reject(new Error('ファイルの読み込みが中断されました'));
    reader.readAsDataURL(file);
  });
}

async function _folderUploadDroppedFile(file, parentPath) {
  if (typeof _uploadOutlinerDroppedFile === 'function') return _uploadOutlinerDroppedFile(file, parentPath);
  try {
    const data = await _folderReadDroppedFile(file);
    await apiFetch('/upload-file?path=' + encodeURIComponent(parentPath), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, filename: file.name }),
    });
    return { ok: true, name: file.name };
  } catch (error) {
    return { ok: false, name: file?.name || 'ファイル', error: error?.userMessage || error?.message || String(error) };
  }
}

function _folderReadFileEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function _folderReadDirectoryEntries(entry) {
  const reader = entry.createReader();
  const rows = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return rows;
    rows.push(...batch);
  }
}

async function _folderReadOsDropNode(entry) {
  if (entry.isFile) return { kind: 'file', name: entry.name, file: await _folderReadFileEntry(entry) };
  if (!entry.isDirectory) return null;
  const children = [];
  for (const child of await _folderReadDirectoryEntries(entry)) {
    const node = await _folderReadOsDropNode(child);
    if (node) children.push(node);
  }
  return { kind: 'folder', name: entry.name, children };
}

async function _folderOsDropNodes(dataTransfer) {
  const entries = Array.from(dataTransfer?.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (entries.length) {
    const nodes = [];
    for (const entry of entries) {
      const node = await _folderReadOsDropNode(entry);
      if (node) nodes.push(node);
    }
    return nodes;
  }
  return Array.from(dataTransfer?.files || []).map(file => ({ kind: 'file', name: file.name, file }));
}

function _folderCountOsDropFiles(nodes) {
  return nodes.reduce((count, node) => count + (node.kind === 'file' ? 1 : _folderCountOsDropFiles(node.children || [])), 0);
}

async function _folderImportOsNode(node, parentPath, result, progress) {
  if (node.kind === 'folder') {
    try {
      const created = await apiPost('/outliner/add', { type: 'folder', label: node.name, parent: parentPath });
      const childParent = created?.node?.path || [parentPath, created?.node?.label || node.name].filter(Boolean).join('/');
      for (const child of node.children || []) await _folderImportOsNode(child, childParent, result, progress);
    } catch (error) {
      const skipped = _folderCountOsDropFiles(node.children || []);
      result.failed += Math.max(1, skipped);
      result.failures.push({ name: node.name, error });
      progress?.updateOperation?.(result.ok + result.failed);
    }
    return;
  }
  const uploaded = await _folderUploadDroppedFile(node.file, parentPath);
  if (uploaded.ok) result.ok += 1;
  else { result.failed += 1; result.failures.push(uploaded); }
  progress?.updateOperation?.(result.ok + result.failed);
}

async function _folderImportOsDrop(event, targetItem) {
  if (!_folderCanAcceptOsDrop(event, targetItem)) return 0;
  if (targetItem?.type === 'database' && typeof MeldexSheetEntryAttachments !== 'undefined') {
    return MeldexSheetEntryAttachments.intakeDropToSheet(targetItem.path, event);
  }
  const nodes = await _folderOsDropNodes(event.dataTransfer);
  const total = _folderCountOsDropFiles(nodes);
  if (!total && !nodes.some(node => node.kind === 'folder')) {
    showStatus('取り込めるファイルまたはフォルダがありません', true);
    return 0;
  }
  const progress = window.MeldexImportProgress;
  const result = { ok: 0, failed: 0, failures: [] };
  progress?.beginOperation?.('ファイルを取り込み中', Math.max(1, total));
  try {
    for (const node of nodes) await _folderImportOsNode(node, targetItem.path, result, progress);
  } finally {
    progress?.finishOperation?.();
  }
  if (typeof loadOutliner === 'function') await loadOutliner({ force: true, reason: 'folder-panel-os-drop' });
  if (_folderPath && typeof openFolder === 'function') {
    await openFolder(document.getElementById('folder-title')?.textContent || _folderPath, _folderPath, {
      silent: true, skipShowView: true, skipNavPush: true, skipSaveLastView: true, skipHighlight: true, skipGlobalUi: true,
    });
  }
  const first = result.failures[0];
  const reason = String(first?.error?.userMessage || first?.error?.message || first?.error || '');
  showStatus(result.failed
    ? `${result.ok}件を取り込み、${result.failed}件は失敗しました${reason ? `（${reason}）` : ''}`
    : `${result.ok}件を取り込みました`, result.failed > 0 && result.ok === 0);
  return result.ok;
}

function _folderCanAcceptMoveDrop(event, targetItem) {
  if (!event || event.altKey || !targetItem?.path) return false;
  if (targetItem.type !== 'folder' && targetItem.type !== 'database') return false;
  if (typeof isItemLocked === 'function' && isItemLocked(targetItem.path)) return false;
  return Array.from(event.dataTransfer?.types || []).includes('application/x-meldex-node')
    || (typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(event, 'node'));
}

async function _folderMoveItemsFromDrop(event, targetItem, payloadOverride) {
  const targetPath = targetItem?.path || '';
  const targetKey = _folderMembershipKey(targetPath);
  const items = _folderDragPayloadItemsFromEvent(event, payloadOverride).filter(source => {
    const sourceKey = _folderMembershipKey(source.path);
    return sourceKey && sourceKey !== targetKey && !targetKey.startsWith(sourceKey + '/');
  });
  if (!targetPath || items.length === 0) {
    showStatus('移動できる項目がありません', true);
    return 0;
  }
  // シートへのドロップ: Altキー押下時、またはエントリ以外のファイル/ボード/画像等は
  // シート全ファイル取込（MeldexSheetEntryAttachments）へルーティングしてエントリ化する。
  if (targetItem?.type === 'database') {
    const nonEntries = items.filter(source => !(window.MeldexSheetAttachments?.itemFitsInSheet?.(source) ?? false));
    if (event?.altKey || nonEntries.length > 0) {
      if (typeof MeldexSheetEntryAttachments !== 'undefined') {
        return MeldexSheetEntryAttachments.intakeDropToSheet(targetPath, event, { payloadOverride });
      }
    }
  }
  // シートの中に置けるのはエントリだけ。ボード等を落とすと
  // 「シートの中にボードがある」状態になるため、ドロップ時点で止める。
  if (targetItem?.type === 'database') {
    const rejected = items.filter(source => !(window.MeldexSheetAttachments?.itemFitsInSheet?.(source) ?? true));
    if (rejected.length) {
      const first = rejected[0]?.name || rejected[0]?.path || '対象';
      showStatus(
        'シートの中にはエントリだけを置けます（' + first +
        (rejected.length > 1 ? ' ほか ' + (rejected.length - 1) + ' 件' : '') + '）',
        true
      );
      return 0;
    }
  }
  const progress = window.MeldexImportProgress;
  progress?.beginOperation?.('ファイルを移動中', items.length);
  let ok = 0;
  const failures = [];
  try {
    for (const source of items) {
      try {
        const oldPath = source.path;
        const copySource = source.sourceSurface === 'sheet-image';
        const res = await apiPost(copySource ? '/outliner/save-as' : '/outliner/move', copySource ? {
          path: oldPath,
          dest_folder: targetPath,
        } : {
          path: oldPath,
          dest_folder: targetPath,
          conflict_policy: 'error',
        });
        if (!copySource && typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
        if (!copySource && res?.new_path && typeof renameAppPathReferences === 'function') {
          renameAppPathReferences(oldPath, res.new_path, {
            label: res.new_name || source.name,
            fileId: res.file_id,
            type: source.type || 'file',
          });
        }
        ok += 1;
      } catch (error) {
        failures.push({ name: source.name || source.path, error });
      }
      progress?.updateOperation?.(ok + failures.length);
    }
  } finally {
    progress?.finishOperation?.();
  }
  if (typeof loadOutliner === 'function') {
    await loadOutliner({ force: true, reason: 'folder-panel-drop-move' });
  }
  if (_folderPath && typeof openFolder === 'function') {
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
    const first = failures[0];
    const reason = String(first.error?.userMessage || first.error?.message || '');
    showStatus(`${ok}件を移動、${failures.length}件は失敗しました${reason ? `（${reason}）` : ''}`, true);
  } else {
    showStatus(`${ok}件を「${targetItem.name || targetPath}」へ移動しました`);
  }
  return ok;
}

function _folderDirectParentKey(path) {
  const normalized = _normalizeFolderPathForCompare(path);
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(0, slash) : '';
}

function _folderManualDropIntent(event, targetElement, targetItem) {
  if (!event || !targetElement || !targetItem?.path || event.altKey) return null;
  if (typeof getSortForFolder !== 'function' || getSortForFolder(_folderPath || '').sort !== 'manual') return null;
  const currentKey = _normalizeFolderPathForCompare(_folderPath || '');
  const sources = _folderDragPayloadItemsFromEvent(event).filter(source => (
    _folderDirectParentKey(source.path) === currentKey && source.path !== targetItem.path
  ));
  if (!sources.length || _folderDirectParentKey(targetItem.path) !== currentKey) return null;
  const rect = targetElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  let position;
  if (_folderLayout === 'list') {
    const ratio = (event.clientY - rect.top) / rect.height;
    if ((targetItem.type === 'folder' || targetItem.type === 'database') && ratio > 0.28 && ratio < 0.72) return null;
    position = ratio < 0.5 ? 'before' : 'after';
  } else {
    const ratio = (event.clientX - rect.left) / rect.width;
    if ((targetItem.type === 'folder' || targetItem.type === 'database') && ratio > 0.28 && ratio < 0.72) return null;
    position = ratio < 0.5 ? 'before' : 'after';
  }
  return { position, sources };
}

function _folderClearManualDropIndicators() {
  document.querySelectorAll('.fv-item.fv-manual-before,.fv-item.fv-manual-after').forEach(element => {
    element.classList.remove('fv-manual-before', 'fv-manual-after');
  });
}

function _folderApplyManualDrop(intent, targetItem) {
  if (!intent || !targetItem?.name) return false;
  const currentKey = _normalizeFolderPathForCompare(_folderPath || '');
  const directItems = (_folderItems || []).filter(item => _folderDirectParentKey(item?.path) === currentKey);
  const ordered = typeof _sortItemsByManualOrder === 'function'
    ? _sortItemsByManualOrder([...directItems], _folderPath || '')
    : [...directItems];
  const sourceNames = new Set(intent.sources.map(source => source.name).filter(Boolean));
  const movedNames = ordered.filter(item => sourceNames.has(item?.name)).map(item => item.name);
  const remaining = ordered.map(item => item?.name).filter(name => name && !sourceNames.has(name));
  const targetIndex = remaining.indexOf(targetItem.name);
  if (!movedNames.length || targetIndex < 0) return false;
  const insertIndex = targetIndex + (intent.position === 'after' ? 1 : 0);
  remaining.splice(insertIndex, 0, ...movedNames);
  const historyKeys = [
    typeof SORT_SETTINGS_KEY !== 'undefined' ? SORT_SETTINGS_KEY : 'outliner-sort',
    typeof MANUAL_ORDER_KEY !== 'undefined' ? MANUAL_ORDER_KEY : 'outliner-manual-order',
  ];
  const before = typeof captureOutlinerSettingsHistory === 'function' ? captureOutlinerSettingsHistory(historyKeys) : null;
  setSortSetting(_folderPath || '', 'manual', 'asc');
  setManualOrder(_folderPath || '', remaining);
  if (typeof pushOutlinerSettingsHistory === 'function') {
    pushOutlinerSettingsHistory('フォルダ: マニュアル並び替え', before, targetItem.name, historyKeys);
  }
  const selectedPaths = (_folderSelectedItems || []).map(item => item?.path).filter(Boolean);
  renderFolderGrid({ preserveSelectedPaths: selectedPaths });
  if (typeof loadOutliner === 'function') void loadOutliner({ force: true, reason: 'folder-panel-manual-sort' });
  showStatus('並び順を変更しました');
  return true;
}

const FOLDER_SUBFOLDER_CONTENTS_KEY = 'gb:folder-include-subfolders';

function isFolderSubfolderContentsEnabled() {
  try { return localStorage.getItem(FOLDER_SUBFOLDER_CONTENTS_KEY) === '1'; } catch { return false; }
}

function setFolderSubfolderContentsEnabled(enabled) {
  try { localStorage.setItem(FOLDER_SUBFOLDER_CONTENTS_KEY, enabled ? '1' : '0'); } catch {}
  if (typeof syncFolderSubfolderContentsButtons === 'function') syncFolderSubfolderContentsButtons();
}

async function _folderFetchBrowseItems(path) {
  const direct = await apiFetch('/browse?path=' + encodeURIComponent(path) + '&detail=true&all_files=true');
  if (!isFolderSubfolderContentsEnabled()) return direct;
  const result = [...direct];
  const seenItems = new Set(direct.map(item => _normalizeFolderPathForCompare(item?.path)).filter(Boolean));
  const queue = direct.filter(item => item?.type === 'folder' && item.path).map(item => item.path);
  const visited = new Set([_normalizeFolderPathForCompare(path)]);
  while (queue.length && visited.size < 5000) {
    const folderPath = queue.shift();
    const key = _normalizeFolderPathForCompare(folderPath);
    if (!key || visited.has(key)) continue;
    visited.add(key);
    try {
      const children = await apiFetch('/browse?path=' + encodeURIComponent(folderPath) + '&detail=true&all_files=true');
      children.forEach(child => {
        if (child?.type === 'folder' && child.path) queue.push(child.path);
        else if (child?.path) {
          const childKey = _normalizeFolderPathForCompare(child.path);
          if (!seenItems.has(childKey)) {
            seenItems.add(childKey);
            result.push({ ...child, _subfolderContent: true, _subfolderParentPath: folderPath });
          }
        }
      });
    } catch (error) {
      console.warn('サブフォルダの読み込みに失敗しました', folderPath, error);
    }
  }
  return result;
}
