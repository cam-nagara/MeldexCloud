/**
 * Folder view link and membership helpers.
 */

let _folderMembershipCache = new Map();
let _folderMembershipLoading = new Set();
let _folderRenderSeq = 0;
const FOLDER_PANEL_RENDER_CHUNK_SIZE = 80;
const WEB_PREVIEWABLE_IMAGE = new Set(['image']);
let _folderPath = '';
let _folderItems = [];
let _folderSelected = null;
let _folderSelectedItems = []; // 複数選択
let _folderLayout = localStorage.getItem('folder-layout') || 'waterfall';
let _folderVisibleItems = [];
let _folderBulkPopupRaf = 0;
let _folderBulkPopupTracking = false;
// パネル表示状態は_getFvPanelCfg()で管理（旧_folderPreviewVisibleは廃止）
let _folderZoom = parseFloat(localStorage.getItem('folder-zoom') || '1');
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

function _folderMembershipFolderLabel(folder) {
  const normalized = _folderMembershipKey(folder);
  if (!normalized) return '';
  if (_isHomeFolderPath(normalized)) return HOME_FOLDER_DISPLAY_LABEL;
  const parts = normalized.split('/').filter(Boolean);
  const name = parts[parts.length - 1] || normalized;
  return name === normalized ? normalized : `${name} - ${normalized}`;
}

function _folderDragPayloadItemsFromEvent(event) {
  let payload = null;
  try {
    const raw = event?.dataTransfer?.getData?.('application/x-meldex-node') || '';
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  if (!payload) {
    payload = window._gbOutlinerDragPayload || window._gbFolderViewDragPayload || null;
  }
  const rows = Array.isArray(payload?.items) ? payload.items : (payload?.path ? [payload] : []);
  const seen = new Set();
  return rows.map(row => ({
    name: row?.name || '',
    path: row?.path || '',
    type: row?.type || 'file',
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
  return types.includes('application/x-meldex-node');
}

async function _folderCreateLinksFromDrop(event, targetItem) {
  const targetPath = targetItem?.path || '';
  const targetKey = _folderMembershipKey(targetPath);
  const items = _folderDragPayloadItemsFromEvent(event)
    .filter(row => _folderMembershipKey(row.path) !== targetKey);
  if (!targetPath || items.length === 0) {
    showStatus('リンク登録できる項目がありません', true);
    return;
  }
  let ok = 0;
  let failed = 0;
  for (const source of items) {
    try {
      if (typeof addFolderLinkWithHistory === 'function') {
        await addFolderLinkWithHistory(source.path, targetPath);
      } else {
        await apiPost('/folder-links/add', { file_path: source.path, folder_path: targetPath });
      }
      _folderInvalidateMembershipsForPath(source.path);
      ok += 1;
    } catch {
      failed += 1;
    }
  }
  if (ok > 0 && typeof _folderEnsureMemberships === 'function') {
    _folderEnsureMemberships(_folderItems, { rerender: _folderHasActiveFolderFilter(getFolderDisplayConfig()) });
  }
  const suffix = failed > 0 ? `（${failed} 件失敗）` : '';
  showStatus(ok > 0 ? `${ok} 件を「${targetItem.name || targetPath}」にリンク登録しました${suffix}` : 'リンク登録に失敗しました', failed > 0 && ok === 0);
}
