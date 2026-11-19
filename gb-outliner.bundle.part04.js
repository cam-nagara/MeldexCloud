            const reusable = disposeOrReuse(n);
            childrenDiv.appendChild(reusable || createTreeNodeFromBrowse(data, rootPath));
          });
          if (toggle.dataset.expanded !== 'true') toggle.click();
          setSortSetting(item.path, 'manual', 'asc');
          saveManualOrderFromDOM(childrenDiv, item.path);
          if (!movedAcrossFolders) {
            pushOutlinerSettingsHistory('フォルダツリー: 並び順', orderBefore, item.path, [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);
          }
        }
      } else if (vr && vr.isVirtualContainer(targetParent)) {
        const movedPaths = moved.map(n => n._nodeData?.path).filter(Boolean);
        moved.forEach(n => { disposeOrReuse(n); });
        vr.reorderAround(targetParent, movedPaths, item.path, position);
      } else if (position === 'above') {
        moved.forEach(n => {
          const data = n._nodeData;
          const reusable = disposeOrReuse(n);
          targetParent.insertBefore(reusable || createTreeNodeFromBrowse(data, rootPath), div);
        });
      } else {
        let ref = div.nextSibling;
        moved.forEach(n => {
          const data = n._nodeData;
          const reusable = disposeOrReuse(n);
          targetParent.insertBefore(reusable || createTreeNodeFromBrowse(data, rootPath), ref);
        });
      }
      if (position !== 'inside') {
        const logicalParentPath = vr?.parentPathForItem(targetParent, item.path);
        const parentNode = targetParent.closest('.tree-node');
        const parentPath = logicalParentPath !== undefined
          ? (logicalParentPath || parentNode?._nodeData?.path || '_root')
          : (parentNode?._nodeData?.path || '_root');
        setSortSetting(parentPath, 'manual', 'asc');
        if (vr && vr.isVirtualContainer(targetParent)) {
          vr.saveManualOrderFromVirtualModel(targetParent, parentPath);
        } else {
          saveManualOrderFromDOM(targetParent, parentPath);
        }
        if (!movedAcrossFolders) {
          pushOutlinerSettingsHistory('フォルダツリー: 並び順', orderBefore, parentPath, [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);
        }
      }
      if (nodes.some(node => node._nodeData?._form_parent_path)) await loadOutliner();
    })();
  });

  _registerTreeNode(div);
  return div;
}

function clearDragIndicators() {
  const home = document.getElementById('body-home');
  if (home) home.style.outline = '';
  document.querySelectorAll('.drag-over-above,.drag-over-below,.drag-over-inside').forEach(el => {
    el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
  });
}

function _outlinerSheetTreeItems(item, pivotData) {
  const items = Object.keys(pivotData?.entities || {}).sort().map(name => ({
    name, type: 'entity',
    display_icon: pivotData.entities[name]?._display_icon || '',
    path: pivotData.entities[name]?._entry_path || (typeof _entityPath === 'function'
      ? _entityPath(item.path, name, pivotData) : item.path + '/' + name + (pivotData.new_format ? '.md' : '')),
    _dbPath: item.path,
    entityData: pivotData.entities[name],
  }));
  const attachmentFolder = String(pivotData?.attachment_folder || '').trim();
  if (attachmentFolder) items.unshift({ name: attachmentFolder, type: 'folder', path: item.path + '/' + attachmentFolder });
  return items;
}

const _outlinerWarmQueue = [];
const _outlinerWarmKeys = new Set();
let _outlinerWarmRunning = false;

function _scheduleOutlinerChildWarmup(container, items, rootPath) {
  // Warm one level, at most four visible branches, one local read at a time.
  // Never initiate Dropbox API downloads/migrations while merely listing rows.
  if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) return;
  const nodes = new Map(Array.from(container.querySelectorAll(':scope > .tree-node'), node => [node._nodeData?.path, node]));
  let added = 0;
  for (const item of items) {
    if (added >= 4 || _outlinerWarmQueue.length >= 12) break;
    const node = nodes.get(item.path);
    if (!node || node.style.display === 'none' || item.needsMapping === true || !['folder', 'database'].includes(item.type)) continue;
    let path;
    if (item.type === 'database') path = '/pivot?path=' + encodeURIComponent(item.path) + '&tree_only=true';
    else {
      const sortCfg = getSortForFolder(item.path);
      const serverSorts = new Set(['name', 'modified', 'created']);
      const apiSort = serverSorts.has(sortCfg.sort) ? sortCfg.sort : 'name';
      const detail = !serverSorts.has(sortCfg.sort) && sortCfg.sort !== 'manual' ? '&detail=true' : '';
      path = '/browse?path=' + encodeURIComponent(item.path) + '&sort=' + apiSort + '&order=' + sortCfg.order
        + (rootPath ? '&root=' + encodeURIComponent(rootPath) : '')
        + (item.sourceId ? '&sourceId=' + encodeURIComponent(item.sourceId) : '') + detail + '&all_files=true&form_hierarchy=true';
    }
    if (_outlinerWarmKeys.has(path)) continue;
    _outlinerWarmKeys.add(path);
    _outlinerWarmQueue.push({ path, node });
    added++;
  }
  if (_outlinerWarmRunning) return;
  _outlinerWarmRunning = true;
  setTimeout(async () => {
    try {
      while (_outlinerWarmQueue.length) {
        const next = _outlinerWarmQueue.shift();
        try {
          if (next.node.isConnected && next.node.style.display !== 'none') await apiFetch(next.path, {
            background: true, silentError: true,
            ...(next.path.startsWith('/pivot?') ? { headers: { 'X-Meldex-Tree-Preload': 'true' } } : {}),
          });
        } catch (_) { /* A foreground click retries through the normal error path. */ }
        finally { _outlinerWarmKeys.delete(next.path); }
      }
    } finally { _outlinerWarmRunning = false; }
  }, 0);
}

function _scheduleOutlinerSheetProjection(container, item, pivotData, rootPath, loadToken) {
  const signature = items => JSON.stringify(items.map(child => [child.path, child.type,
    child.entityData?._id || child.entityData?.topicRef || null]).sort((a, b) => a[0].localeCompare(b[0])));
  const initialSignature = signature(_outlinerSheetTreeItems(item, pivotData));
  // Navigation must paint before a migration reads/writes the entire Topic store.
  setTimeout(async () => {
    if (!container.isConnected || container._outlinerLoadToken !== loadToken) return;
    try {
      const result = await window.GbTopicLiveBridge?.migrateOpenedSheet?.(item.path, { reason: 'outliner-expand' });
      const refresh = () => {
      if (result?.ok === false || !container.isConnected || container._outlinerLoadToken !== loadToken
          || container.dataset.loaded !== 'true') return;
      if (container.querySelector('input, [contenteditable="true"]')) {
        container.addEventListener('focusout', () => setTimeout(refresh, 0), { once: true });
        return;
      }
      const lastClickedPath = treeSelection.lastClicked?._nodeData?.path;
      const restoreFocus = container.contains(document.activeElement);
      const vr = window.GBOutlinerVirtualRender;
      const currentItems = vr?.stateChildItemsFor?.(container, item.path)
        || Array.from(container.querySelectorAll(':scope > .tree-node'), node => node._nodeData).filter(Boolean);
      // A user rename/add/delete while migration was pending takes precedence.
      if (signature(currentItems) !== initialSignature) return;
      window.MeldexTopicPlacementUI?.projectSheetPivot?.(item.path, pivotData);
      const nextItems = _outlinerSheetTreeItems(item, pivotData);
      const byPath = new Map(currentItems.map(child => [child.path, child]));
      const nextPaths = new Set(nextItems.map(child => child.path));
      const merged = nextItems.map(child => {
        const existing = byPath.get(child.path);
        if (existing) { Object.assign(existing, child); return existing; }
        return child;
      });
      if (vr?.isVirtualContainer?.(container)) {
        currentItems.forEach(child => {
          if (!nextPaths.has(child.path)) vr.removeFromContainer(container, child.path);
        });
        vr.dropInto(container, merged);
      } else {
        const nodes = new Map(Array.from(container.querySelectorAll(':scope > .tree-node'), node => [node._nodeData?.path, node]));
        nodes.forEach((node, path) => {
          if (nextPaths.has(path)) return;
          treeSelection.remove(node);
          if (treeSelection.lastClicked === node) treeSelection.lastClicked = container.parentElement;
          _unregisterTreeSubtree(node);
          node.remove();
        });
        // Moving an existing row to the same parent still detaches it. Keep
        // unchanged rows in place so read-time projection preserves focus.
        let nextNode = container.querySelector(':scope > .tree-node');
        merged.forEach(child => {
          const node = nodes.get(child.path) || createTreeNodeFromBrowse(child, rootPath);
          if (node === nextNode) {
            nextNode = node.nextElementSibling;
            while (nextNode && !nextNode.matches('.tree-node')) nextNode = nextNode.nextElementSibling;
          } else {
            container.insertBefore(node, nextNode);
          }
        });
      }
      applyGlobalFilter();
      _snapshotBaseTreeVisibility();
      if (typeof applyTreeNameSearch === 'function') applyTreeNameSearch();
      const selectedNode = Array.from(container.querySelectorAll(':scope > .tree-node')).find(node => node._nodeData?.path === lastClickedPath);
      if (selectedNode) {
        treeSelection.lastClicked = selectedNode;
        if (restoreFocus) selectedNode.querySelector(':scope > .tree-node-row')?.focus({ preventScroll: true });
      }
      };
      refresh();
    } catch (error) {
      console.warn('[フォルダツリー] トピック情報の後追い読込に失敗:', item.path, error);
    }
  }, 0);
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

/* === gb-outliner.part02.js === */
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

// /outliner-roots のGET直後に呼び、以後の in-place 書き換え（名前変更・パス変更）に
// 影響されないディープコピーの控えを作る。フォルダツリー右クリックの「名前を変更」
// 「パスを変更」は取得した root オブジェクトを直接書き換えるため、浅いコピーでは
// baseRoots が変更後の値と同じになってしまい、サーバー側の台帳削除印(tombstone)
// 判定の基準として使えない。
function _cloneOutlinerRootsForBase(roots) {
  try {
    return JSON.parse(JSON.stringify(Array.isArray(roots) ? roots : []));
  } catch {
    return [];
  }
}

// フォルダツリー右クリック（名前を変更・このソースフォルダの登録を解除・パスを変更）から
// /outliner-roots を保存する共通ヘルパー。baseRoots には直前のGETで実際に見ていた
// 一覧のディープコピー（_cloneOutlinerRootsForBase の戻り値）を渡すこと。
// これを送らないと、共有台帳合流分（他端末・クラウド版が追加したroot）の削除が
// サーバー側で検出できず、次回のフォルダツリー読み込みで復活してしまう。
async function _putOutlinerRootsWithBase(nextRoots, baseRoots) {
  return apiPut('/outliner-roots', { roots: nextRoots, baseRoots });
}

const _outlinerPendingDeletePaths = new Set();

function _isOutlinerFreeLayoutUiEnabled() {
  if (typeof GBLayout === 'undefined') return true;
  return typeof GBLayout.isFreeLayoutUiEnabled === 'function'
    ? !!GBLayout.isFreeLayoutUiEnabled()
    : true;
}

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
      ...((item.assetId || item.asset_id) ? { assetId: String(item.assetId || item.asset_id) } : {}),
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
  const confirmationPayload = typeof MeldexDeleteImpactWarning !== 'undefined'
    ? MeldexDeleteImpactWarning.confirmationPayload(options.confirmation)
    : {};
  if (batchTargets.length) {
    try {
      const payload = await apiPost('/outliner/delete-batch', {
        items: batchTargets.map(item => ({
          path: item.path,
          kind: item.kind === 'folder' || item.type === 'folder' ? 'folder' : 'file',
          ...(item.assetId ? { assetId: item.assetId } : {}),
        })),
        ...confirmationPayload,
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
      throw new Error('削除結果を確認できませんでした。フォルダツリーを更新して状態を確認してください。');
    } catch (reason) {
      // Only an absent legacy endpoint permits a single-item fallback. A token
      // may already be consumed after a conflict, timeout or uncertain response.
      if (![404, 405].includes(Number(reason?.status))) {
        return batchTargets.map(item => {
          try { options.onFailure?.(item, reason); } catch {}
          return { status: 'rejected', reason };
        });
      }
    }
  }
  const results = [];
  for (const item of targets) {
    try {
      const value = await apiPost('/outliner/delete', {
        path: item.path,
        kind: item.kind === 'folder' || item.type === 'folder' ? 'folder' : 'file',
        ...(item.assetId ? { assetId: item.assetId } : {}),
        ...confirmationPayload,
      });
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
  // 同じ項目はホーム、ワークスペース、固定ソース、仮想化ツリーなど複数面に
  // 現れ得る。コンテナIDを限定すると削除中の複製だけが残るため、安定pathを
  // 持つ全ツリーノードを同時に隠す。
  if (typeof GBOutlinerVirtualRender !== 'undefined') {
    GBOutlinerVirtualRender.removeMatchingPaths?.(path => {
      const normalizedPath = _normalizeOutlinerPathForCompare(path);
      return deletedPaths.some(dp => _isOutlinerPathWithin(normalizedPath, dp)
        || normalizedPath.endsWith('/' + dp) || normalizedPath.includes('/' + dp + '/'));
    });
  }
  const allTreeNodes = document.querySelectorAll('.tree-node');
  allTreeNodes.forEach(nodeEl => {
    const path = nodeEl?._nodeData?.path || nodeEl?.dataset?.path || nodeEl?._virtualPath || '';
    if (!path) return;
    const normalizedPath = _normalizeOutlinerPathForCompare(path);
    if (deletedPaths.some(dp => (
      _isOutlinerPathWithin(normalizedPath, dp)
      || normalizedPath.endsWith('/' + dp)
      || normalizedPath.includes('/' + dp + '/')
    ))) {
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

async function _restoreOutlinerDeleteRecords(records) {
  const restored = [];
  const failures = [];
  for (const record of records || []) {
    if (!record?.deleted || !record.trashRef?.trash_name) continue;
    try {
      const result = await apiPost('/outliner/restore', {
        trash_name: record.trashRef.trash_name,
        ...(record.trashRef.trash_root ? { trash_root: record.trashRef.trash_root } : {}),
      });
      record.currentPath = result?.restored_to || result?.restored_path || record.item.path;
      record.deleted = false;
      restored.push(result);
    } catch (error) {
      failures.push({ record, error });
    }
  }
  return { restored, failures };
}

async function _runOutlinerDeleteHistoryRefresh(refresh, phase, result, refreshSuccessfulRedo = false) {
  // Successful Redo already updated the tree model and DOM through pending deletion.
  if (phase === 'redo' && !result?.failedCount && !result?.skippedCount && !refreshSuccessfulRedo) return;
  if (typeof refresh === 'function') {
    await refresh(phase, result);
    return;
  }
  const jobs = [];
  if (typeof loadOutliner === 'function') jobs.push(Promise.resolve(loadOutliner()).catch(() => {}));
  if (typeof renderHomeFolderTree === 'function') jobs.push(Promise.resolve(renderHomeFolderTree()).catch(() => {}));
  if (typeof renderWorkspaceSidebar === 'function') jobs.push(Promise.resolve(renderWorkspaceSidebar()).catch(() => {}));
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
  if (requestedTargets.some(item => item.linked)) {
    if (typeof showStatus === 'function') showStatus('リンク表示中の項目は実ファイルとして削除できません。表示中のフォルダからリンク解除してください', true);
    return { targets: [], requestedTargets, succeeded: [], skipped: requestedTargets, failed: [], failedCount: 0, deletedCount: 0, deletedPaths: [], trashNames: [], trashRefs: [] };
  }
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
    confirmation: options.confirmation,
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
      else failed.push({ ...targets[index], error: result.reason });
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

  const deleteRecords = succeeded.map(item => ({
    item,
    currentPath: item.path,
    deleted: true,
    trashRef: _outlinerTrashRefFromResponse(item),
  }));
  let trashRefs = deleteRecords.filter(record => record.deleted).map(record => record.trashRef).filter(Boolean);
  let trashNames = _outlinerTrashRefsToNames(trashRefs);
  if (succeeded.length && typeof historyPush === 'function') {
    const label = options.label || (succeeded.length + ' 件を削除');
    const detail = options.detail || succeeded.map(item => item.path).join(', ');
    historyPush(
      label,
      async () => {
        const { restored, failures: restoreFailures } = await _restoreOutlinerDeleteRecords(deleteRecords);
        trashRefs = deleteRecords.filter(record => record.deleted).map(record => record.trashRef).filter(Boolean);
        trashNames = _outlinerTrashRefsToNames(trashRefs);
        await _runOutlinerDeleteHistoryRefresh(options.refresh, 'undo', {
          succeeded,
          deletedPaths: deleteRecords.filter(record => record.deleted).map(record => record.currentPath),
          trashNames,
          failedCount: restoreFailures.length,
        });
        if (restoreFailures.length) {
          throw new Error(`${restoreFailures.length} 件を復元できませんでした。成功した項目は再試行しません`);
        }
        if (typeof showStatus === 'function') showStatus(restored.length + ' 件を復元しました');
      },
      async () => {
        const pendingRecords = deleteRecords.filter(record => !record.deleted);
        if (!pendingRecords.length) return true;
        const redoTargets = pendingRecords.map(record => ({
          path: record.currentPath,
          kind: record.item.type === 'folder' || record.item.kind === 'folder' ? 'folder' : 'file',
          ...(record.item.assetId ? { assetId: record.item.assetId } : {}),
        }));
        const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
          ? await MeldexDeleteImpactWarning.authorizeReversibleDelete(redoTargets)
          : { confirmed: true, operation: 'trash' };
        if (!confirmed) throw new Error('削除の参照確認に失敗しました');
        const confirmationPayload = typeof MeldexDeleteImpactWarning !== 'undefined'
          ? MeldexDeleteImpactWarning.confirmationPayload(confirmed)
          : {};
        const redoFailures = [];
        let redoSkippedCount = 0;
        const pendingPaths = pendingRecords.map(record => record.currentPath);
        if (pendingPaths.length) _markOutlinerDeletePending(pendingPaths);
        for (const record of pendingRecords) {
          const item = record.item;
          const res = await apiPost('/outliner/delete', {
            path: record.currentPath,
            kind: item.type === 'folder' || item.kind === 'folder' ? 'folder' : 'file',
            ...(item.assetId ? { assetId: item.assetId } : {}),
            ...confirmationPayload,
          }).catch(error => {
            redoFailures.push({ item, error });
            return null;
          });
          const ref = _outlinerTrashRefFromResponse(res);
          if (ref) {
            record.trashRef = ref;
            record.deleted = true;
          }
          else if (res) redoFailures.push({ item, error: new Error('取り消しに必要なゴミ箱情報がありません') });
        }
        if (pendingPaths.length) _clearOutlinerDeletePending(pendingPaths);
        trashRefs = deleteRecords.filter(record => record.deleted).map(record => record.trashRef).filter(Boolean);
        trashNames = _outlinerTrashRefsToNames(trashRefs);
        const redonePaths = pendingRecords.filter(record => record.deleted).map(record => record.currentPath);
        if (redonePaths.length && typeof purgeAppPathReferences === 'function') {
          purgeAppPathReferences(redonePaths);
        }
        await _runOutlinerDeleteHistoryRefresh(options.refresh, 'redo', { succeeded, deletedPaths: redonePaths, trashNames, failedCount: redoFailures.length, skippedCount: redoSkippedCount }, !!options.refreshSuccessfulRedo);
        if (redoFailures.length) {
          throw new Error(`${redoFailures.length} 件の削除をやり直せませんでした。成功した項目は再試行しません`);
        }
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
  items = (items || []).filter(item => (Array.isArray(item) ? item[1] : item?.type) !== 'map'
    || typeof MeldexMapDocument !== 'undefined' && MeldexMapDocument.isAvailable());
  return window.MeldexCloudBootstrap?.filterPhase1CreateItems?.(items) || items;
}

function _isCloudPhase1BlockedCreateType(type) {
  if (type === 'map' && (typeof MeldexMapDocument === 'undefined' || !MeldexMapDocument.isAvailable())) return true;
  return !!window.MeldexCloudBootstrap?.isPhase1UnsupportedCreateType?.(type);
}

function _showCloudPhase1BlockedCreate(type) {
  if (window.MeldexCloudBootstrap?.showPhase1Unsupported) return window.MeldexCloudBootstrap.showPhase1Unsupported(type);
  showStatus('ブラウザ版Meldexではまだ未対応の作成タイプです', true);
  return false;
}

const _outlinerContextMenuCleanups = new Set();
let _outlinerContextMenuOpenSeq = 0;

function _outlinerEscHtml(value) {
  return MeldexEscape.html(value);
}

function _outlinerMenuIconHtml(icon, size = 14) {
  if (!icon || typeof lucide !== 'function') return '';
  return '<span class="menu-icon">' + lucide(icon, size) + '</span>';
}

function _outlinerCreateContextMenu(label, x, y) {
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  return menu;
}

function _outlinerCreateSubmenu(label) {
  const panel = document.createElement('div');
  panel.className = 'gb-context-menu';
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', label);
  panel.style.cssText = 'display:none;min-width:140px;';
  return panel;
}

function _outlinerAppendMenuItem(menu, options) {
  const item = document.createElement('button');
  item.type = 'button';
  item.dataset.e2eId = options?.e2eId || ('outliner-menu-' + encodeURIComponent(String(options?.label || options?.title || options?.icon || 'item')));
  item.className = 'gb-context-menu-item' + (options?.danger ? ' danger' : '') + (options?.className ? ' ' + options.className : '');
  item.setAttribute('role', options?.role || 'menuitem');
  if (options?.disabled) {
    item.disabled = true;
    item.classList.add('disabled');
  }
  if (options?.title) {
    item.title = options.title;
    item.dataset.gbTooltip = options.title;
  }
  if (options?.checked) {
    item.classList.add('active');
    item.setAttribute('aria-checked', 'true');
  }
  if (options?.html != null) {
    item.innerHTML = options.html;
  } else {
    item.innerHTML = _outlinerMenuIconHtml(options?.icon) + '<span>' + _outlinerEscHtml(options?.label || '') + '</span>';
  }
  if (options?.hasSubmenu) {
    item.classList.add('has-submenu');
    item.setAttribute('aria-haspopup', 'menu');
    item.setAttribute('aria-expanded', 'false');
  }
  item.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (item.disabled) return;
    if (typeof options?.action === 'function') {
      void _outlinerRunMenuAction(options.action, event, options?.label || options?.title || '');
    }
  });
  menu.appendChild(item);
  return item;
}

// 失敗の理由を、利用者向けの短い文に整える（通信の状態コードや内部の例外名は出さない）。
function _outlinerFailureReason(error) {
  if (!error) return '';
  if (error.name === 'AbortError') return '中断されました';
  const raw = String(error?.userMessage || error?.message || (typeof error === 'string' ? error : '') || '').trim();
  if (/failed to fetch|networkerror|load failed/i.test(raw)) return 'サーバーに接続できませんでした';
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError || error instanceof RangeError) {
    return '予期しないエラーが発生しました';
  }
  let text = raw
    .replace(/^HTTP\s*\d+\s*:\s*/i, '')
    .replace(/\(\d+秒\)\s*:\s*\S+$/, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
  if (text.length > 120) text = text.slice(0, 120) + '…';
  return text;
}

function _outlinerReportFailure(message, error) {
  const reason = _outlinerFailureReason(error);
  if (typeof showStatus === 'function') showStatus(reason ? `${message}：${reason}` : message, true);
}

// 右クリックメニューの実行。非同期の処理も待ち、失敗を握り潰さずに原因つきで表示する。
async function _outlinerRunMenuAction(action, event, label) {
  try {
    return await action(event);
  } catch (error) {
    if (typeof console !== 'undefined') console.error('[outliner menu] 実行に失敗', error);
    _outlinerReportFailure(label ? `「${label}」を実行できませんでした` : '操作を実行できませんでした', error);
    return undefined;
  }
}

// 複数項目の複製。部分失敗も件数と最初の原因を返し、表示で握り潰さない。
async function _outlinerDuplicateItems(items) {
  const result = { ok: 0, failed: 0, error: null };
  for (const target of items || []) {
    try {
      await apiPost('/outliner/duplicate', { path: target.path });
      result.ok += 1;
    } catch (error) {
      result.failed += 1;
      if (!result.error) result.error = error;
    }
  }
  return result;
}

function _outlinerReportBatchResult(result, verbDone, failMessage) {
  const reason = result.failed ? _outlinerFailureReason(result.error) : '';
  const suffix = reason ? `：${reason}` : '';
  if (!result.failed) {
    showStatus(`${result.ok}件を${verbDone}`);
  } else if (!result.ok) {
    showStatus(`${failMessage}${suffix}`, true);
  } else {
    showStatus(`${result.ok}件を${verbDone}。${result.failed}件は失敗しました${suffix}`, true);
  }
}

async function _outlinerRunDuplicate(items) {
  const result = await _outlinerDuplicateItems(items);
  if (result.ok > 0 && typeof loadOutliner === 'function') {
    try { await loadOutliner(); } catch (error) { console.error('[outliner duplicate] 表示の更新に失敗', error); }
  }
  _outlinerReportBatchResult(result, '複製しました', '複製に失敗しました');
  return result;
}

// ソースフォルダの表示名変更。失敗は原因つきで表示し、成功表示は保存と再読込の後だけ。
async function _outlinerRenameSourceFolder(nodeData) {
  try {
    const roots = await apiFetch('/outliner-roots');
    const baseRoots = _cloneOutlinerRootsForBase(roots);
    const root = roots.find(r => r.path === nodeData.path);
    if (!root) {
      showStatus('名前を変更できませんでした：ソースフォルダの登録が見つかりません', true);
      return false;
    }
    const newName = await cfPrompt('表示名を入力:', root.name);
    if (!newName) return false;
    root.name = newName;
    await _putOutlinerRootsWithBase(roots, baseRoots);
    await loadOutliner();
    showStatus('名前を変更しました');
    return true;
  } catch (error) {
    console.error('[outliner source folder] 名前の変更に失敗', error);
    _outlinerReportFailure('名前を変更できませんでした', error);
    return false;
  }
}

async function _outlinerUnregisterSourceFolder(nodeData) {
  try {
    // 実際に消えるのはフォルダツリーの一覧からだけ。フォルダ本体とファイルは
    // 消えない（gb-settings-cloud-link.js の confirmDeleteSourceFolder と同じ言い回しに揃える）。
    if (!await cfConfirm('ソースフォルダ「' + nodeData.name + '」の登録を解除しますか？\n（フォルダとファイルはそのまま残ります。フォルダツリーの一覧から外れるだけです）', { okLabel: '登録解除' })) return false;
    const roots = await apiFetch('/outliner-roots');
    const baseRoots = _cloneOutlinerRootsForBase(roots);
    const newRoots = roots.filter(r => r.path !== nodeData.path);
    if (newRoots.length === roots.length) {
      showStatus('登録を解除できませんでした：ソースフォルダの登録が見つかりません', true);
      return false;
    }
    await _putOutlinerRootsWithBase(newRoots, baseRoots);
    await loadOutliner();
    showStatus('ソースフォルダの登録を解除しました');
    return true;
  } catch (error) {
    console.error('[outliner source folder] 登録解除に失敗', error);
    _outlinerReportFailure('ソースフォルダの登録を解除できませんでした', error);
    return false;
  }
}

async function _outlinerCopyLink(nodeData) {
  const linkPath = nodeData?.path;
