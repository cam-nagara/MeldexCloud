/* One-history batch operations for folder links. */
function _folderLinkRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function _folderLinkBatchItems(items) {
  const unique = new Map();
  (items || []).forEach(item => {
    const path = item?.file_path || item?.path || '';
    const fileId = item?.file_id || '';
    const key = fileId || path;
    if (key && !unique.has(key)) unique.set(key, { file_path: path, file_id: fileId });
  });
  return Array.from(unique.values());
}

function _refreshFolderLinkBatch(items, folderPath, tagsContainer) {
  items.forEach(item => {
    if (typeof _folderInvalidateMembershipsForPath === 'function') _folderInvalidateMembershipsForPath(item.file_path);
    if (typeof _refreshFolderLinkUi === 'function') _refreshFolderLinkUi(item.file_path, folderPath, tagsContainer);
  });
}

function _pushFolderLinkBatchHistory(label, undoPath, redoPath, items, folderPath, folderId, tagsContainer) {
  if (typeof historyPush !== 'function' || !items.length) return;
  let undoPending = _folderLinkBatchItems(items);
  let redoPending = [];
  const itemKey = item => String(item?.file_id || item?.file_path || item?.path || '');
  const appendUnique = (target, additions) => _folderLinkBatchItems(target.concat(additions));
  const run = async (path, takePending, setPending, addOpposite) => {
    const requested = takePending();
    if (!requested.length) return;
    const result = await apiPost(path, {
      items: requested,
      ...(folderId ? { folder_id: folderId } : { folder_path: folderPath }),
      request_id: _folderLinkRequestId('history'),
    });
    const rows = new Map((result?.results || []).map(row => [itemKey(row), row]));
    const failed = [];
    const transitioned = [];
    const ownedStatus = path.endsWith('/add') ? 'created' : 'removed';
    requested.forEach(item => {
      const row = rows.get(itemKey(item));
      if (!row || row.status === 'failed') failed.push(item);
      else if (row.status === ownedStatus) transitioned.push(item);
    });
    setPending(failed);
    addOpposite(transitioned);
    _refreshFolderLinkBatch(requested, folderPath, tagsContainer);
    if (failed.length) throw new Error(`${failed.length} 件のリンク操作に失敗しました。成功分を反映し、残りは再試行できます`);
  };
  historyPush(label, async () => run(
    undoPath,
    () => undoPending,
    value => { undoPending = value; },
    value => { redoPending = appendUnique(redoPending, value); },
  ), async () => run(
    redoPath,
    () => redoPending,
    value => { redoPending = value; },
    value => { undoPending = appendUnique(undoPending, value); },
  ), '', `${items.length} 件 → ${folderPath || folderId}`);
}

async function addFolderLinksBatchWithHistory(items, folderPath, options = {}) {
  const normalized = _folderLinkBatchItems(items);
  const folderId = options.folderId || '';
  const payload = {
    items: normalized,
    ...(folderId ? { folder_id: folderId } : { folder_path: folderPath }),
    request_id: options.requestId || _folderLinkRequestId('add'),
  };
  const result = await apiPost('/folder-links/batch/add', payload);
  const created = (result?.results || []).filter(row => row.status === 'created');
  _pushFolderLinkBatchHistory('所属フォルダリンク: 一括登録', '/folder-links/batch/remove', '/folder-links/batch/add', created, folderPath, folderId, options.tagsContainer || null);
  _refreshFolderLinkBatch(normalized, folderPath, options.tagsContainer || null);
  return result;
}

async function removeFolderLinksBatchWithHistory(items, folderPath, options = {}) {
  const normalized = _folderLinkBatchItems(items);
  const folderId = options.folderId || '';
  const payload = {
    items: normalized,
    ...(folderId ? { folder_id: folderId } : { folder_path: folderPath }),
    request_id: options.requestId || _folderLinkRequestId('remove'),
  };
  const result = await apiPost('/folder-links/batch/remove', payload);
  const removed = (result?.results || []).filter(row => row.status === 'removed');
  _pushFolderLinkBatchHistory('所属フォルダリンク: 一括解除', '/folder-links/batch/add', '/folder-links/batch/remove', removed, folderPath, folderId, options.tagsContainer || null);
  _refreshFolderLinkBatch(normalized, folderPath, options.tagsContainer || null);
  return result;
}

async function handleDisplayedFolderLinkDelete(items, fallbackFolderPath, options = {}) {
  const targets = Array.isArray(items) ? items : [];
  const linked = targets.filter(item => item?.linked);
  if (!linked.length) return { handled: false, result: null };
  if (linked.length !== targets.length) {
    showStatus('リンク解除と実ファイル削除は分けて実行してください', true);
    return { handled: true, result: null };
  }
  const folderPath = linked[0].link_folder_path || fallbackFolderPath || '';
  if (!folderPath || linked.some(item => (item.link_folder_path || folderPath) !== folderPath)) {
    showStatus('表示元フォルダを特定できないため、リンク解除を中止しました', true);
    return { handled: true, result: null };
  }
  const confirmed = await cfConfirm(`このフォルダから ${linked.length} 件のリンクを解除します。元ファイルは残ります。`);
  if (!confirmed) return { handled: true, result: null };
  const result = await removeFolderLinksBatchWithHistory(linked, folderPath);
  if (typeof options.refresh === 'function') await options.refresh();
  const removed = result?.removed_count || 0;
  showStatus(removed ? `${removed} 件のリンクを解除しました（元ファイルは残ります）` : 'リンクはすでに解除されています');
  return { handled: true, result };
}
