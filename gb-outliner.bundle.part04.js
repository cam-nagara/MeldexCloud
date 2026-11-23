          if (!n.isConnected || !n.parentElement || n.parentElement.dataset.virtual === 'true' || n.contains(optimisticContainer)) return;
          if (n.parentElement === optimisticContainer) return;
          // 開いたフォルダの一覧に同じ名前の行が既に出ていれば（保存の往復が先に終わった）、重ねて置かない
          const name = n._nodeData?.name;
          if (name && Array.from(optimisticContainer.children).some(child => child !== n && child._nodeData?.name === name)) return;
          if (position === 'inside') optimisticContainer.appendChild(n);
          else if (position === 'above') optimisticContainer.insertBefore(n, div);
          else optimisticContainer.insertBefore(n, div.nextSibling);
          // 表示だけを先に移す。保存先や開いたエディタの参照は成功後に更新する。
          // 確定前の行は操作不可にし、失敗時は元の位置とパスへ戻す。
          const oldPath = pendingMoves.get(n).path || '';
          n.dataset.path = destFolder + '/' + oldPath.slice(oldPath.lastIndexOf('/') + 1);
          n.inert = true;
          n.setAttribute('aria-busy', 'true');
          if (!n._outlinerPendingMoveGuard) {
            n._outlinerPendingMoveGuard = true;
            const guard = event => {
              if (!n.inert || n.getAttribute('aria-busy') !== 'true') return;
              if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && /^[zy]$/i.test(event.key)) return;
              event.preventDefault(); event.stopImmediatePropagation();
            };
            ['click', 'dblclick', 'contextmenu', 'dragstart', 'keydown'].forEach(type => n.addEventListener(type, guard, true));
          }
        });
      };
      if (containerReady()) {
        placeOptimistically();
      } else if (position === 'inside' && optimisticContainer && optimisticContainer.dataset.virtual !== 'true') {
        // 閉じていた・未読込のフォルダの中へ落とした時は、開いて一覧が出た時点で先に置く（保存の往復を待たない。
        // 以前はフォルダの読み込みと保存の往復の両方を待って0.3秒を超えていた: 2026-11-22 M-014）。
        const watcher = new MutationObserver(() => {
          if (!containerReady()) return;
          watcher.disconnect();
          placeOptimistically();
        });
        watcher.observe(optimisticContainer, { attributes: true, attributeFilter: ['data-loaded', 'class', 'data-virtual'] });
        setTimeout(() => watcher.disconnect(), 3000);
      }
    }
    (async () => {
      const placement = { ..._outlinerRowDropTarget(div, item, position, rootPath), path: destFolder };
      let siblings = null;
      if (crossesFolders) {
        try { siblings = await _outlinerDropSiblings(placement); }
        catch (error) { [...pendingMoves.keys()].forEach(n => finishPendingMove(n, true)); showStatus('移動先を確認できませんでした: ' + error.message, true); return; }
      }
      const moved = [];
      const movedItems = [];
      let movedAcrossFolders = false;
      let processed = 0;
      const failures = [];
      const progressToken = window.MeldexImportProgress?.beginOperation?.('ファイルを移動中', nodes.length, { delayMs: 0, kind: 'file-move' });
      for (const n of nodes) {
        const dragData = n._nodeData;
        if (!dragData || !dragData.path) {
          finishPendingMove(n, true);
          moved.push(n);
          processed += 1;
          window.MeldexImportProgress?.updateOperation?.(processed, null, progressToken);
          continue;
        }
        const srcFolder = dragData.path.includes('/') ? dragData.path.substring(0, dragData.path.lastIndexOf('/')) : '';
        if (destFolder === srcFolder) {
          finishPendingMove(n, false);
          moved.push(n);
          movedItems.push({ ...dragData, oldPath: dragData.path });
          processed += 1;
          window.MeldexImportProgress?.updateOperation?.(processed, null, progressToken);
          continue;
        }
        movedAcrossFolders = true;
        let moveCommitted = false;
        try {
          await _outlinerAwaitPendingRename(dragData);
          const oldPath = dragData.path;
          const res = await apiPost('/outliner/move', {
            path: dragData.path,
            dest_folder: destFolder,
            conflict_policy: 'error',
          });
          moveCommitted = true;
          finishPendingMove(n, false);
          moved.push(n);
          movedItems.push({ ...dragData, oldPath, path: res.new_path || oldPath, name: res.new_name || dragData.name });
          if (res.new_path) {
            // Rebind save targets before any fallible DOM/view callbacks.
            if (typeof renameAppPathReferences === 'function') {
              renameAppPathReferences(oldPath, res.new_path, { preserveMountedViews: true, label: res.new_name || dragData.name, fileId: res.file_id, type: dragData.type || 'page' });
            }
            if (typeof _renameTreeNode === 'function') {
              _renameTreeNode(oldPath, res.new_path, res.new_name || dragData.name, res.file_id);
            } else {
              dragData.path = res.new_path;
              dragData.name = res.new_name || dragData.name;
              const lbl = n.querySelector('.tree-label');
              if (lbl && res.new_name) lbl.textContent = res.new_name;
            }
            window.GBOutlinerVirtualRender?.renamePath?.(oldPath, res.new_path, res.new_name || dragData.name, res.file_id);
          }
          if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
        } catch (err) {
          if (moveCommitted) {
            // The filesystem is already committed. Do not report a failed move
            // or skip the authoritative refresh because a view callback failed.
            console.warn('[Meldex] 移動後の表示を再読み込みします', err);
            continue;
          }
          // 失敗理由（移動先が無い・使用中・ロック中等）を握りつぶさず表示する
          const reason = (err && (err.userMessage || err.message)) ? String(err.userMessage || err.message) : '';
          failures.push({ path: dragData.path, message: reason || '移動に失敗しました' });
          showStatus(`${dragData.name} の移動に失敗` + (reason ? `（${reason}）` : ''), true);
        } finally {
          finishPendingMove(n, !moveCommitted);
          processed += 1;
          window.MeldexImportProgress?.updateOperation?.(processed, null, progressToken);
        }
      }
      window.MeldexImportProgress?.finishOperation?.(progressToken, { failed: failures.length, summary: `${moved.length}件移動・${failures.length}件失敗`, details: failures });
      // フォルダをまたぐ複数移動では、各API成功後のDOMを古い親要素へ順次
      // 付け替えると、途中の再描画や親フォルダ自身の移動で表示が欠落する。
      // サーバー上の確定状態を一度だけ読み直し、部分成功も含めてツリー全体を
      // 同じスナップショットへ揃える。同一フォルダ内の並べ替えは下の局所更新を維持する。
      if (movedAcrossFolders) {
        try { _saveOutlinerDropPlacement(placement, siblings || [], movedItems); }
        catch (error) { showStatus('移動後の挿入位置を保存できませんでした: ' + error.message, true); }
        if (position === 'inside' && (isFolder || isDB)) saveExpandedState(item.path, true);
        // 移動先と移動元のフォルダだけを保存先の一覧に合わせる（全体の読み直しは差分で反映できない時だけ）。
        // 以前は毎回ツリー全体を読み直し、2件の移動で0.6秒を超えていた（2026-11-22 M-014）。
        await _outlinerSyncFoldersOrReload([destFolder, ...movedItems.map(movedItem => _outlinerParentPath(movedItem.oldPath))]);
        // ドロップで読み込みを始めた移動先は、読み込みが移動の前の一覧のことがあるので、読み終えてからもう一度合わせる
        const destChildren = typeof _findTreeNodeByPath === 'function' ? _findTreeNodeByPath(destFolder)?.querySelector(':scope > .tree-children') : null;
        if (destChildren && destChildren.dataset.loaded !== 'true') {
          for (let waited = 0; waited < 3000 && destChildren.dataset.loaded !== 'true'; waited += 50) await new Promise(r => setTimeout(r, 50));
          if (destChildren.dataset.loaded === 'true') await _outlinerSyncFolderChildren(destFolder);
        }
        const registerMove = () => window.MeldexFileMoveHistory?.register?.(
          movedItems.map(movedItem => ({
            oldPath: movedItem.oldPath,
            newPath: movedItem.path,
            currentPath: movedItem.path,
            name: movedItem.name,
            type: movedItem.type,
            fileId: movedItem.file_id || movedItem.fileId,
          })),
          {
            label: `フォルダツリー: ${movedItems.length} 件を移動`,
            detail: `→ ${destFolder}`,
            refresh: () => refreshOutliner({ force: true, reason: 'outliner-tree-move-history' }),
          },
        );
        if (moveReservation) moveReservation.capture(registerMove); else registerMove();
        return;
      }
      if (moved.length === 0) return;
      const vr = window.GBOutlinerVirtualRender;
      const ensureManualSaved = saved => {
        if (saved === false) throw Object.assign(new Error('並び順を保存できませんでした。この端末の保存領域を確認してください'), { manualOrderFailure: true });
      };
      // 移動元が仮想化コンテナだった項目のDOM要素は、直接の再利用をやめて配列側から
      // 適切に後始末する（refresh()側の再マウントに新しい行要素の生成を任せる）。
      // 戻り値: 非仮想な移動先で使い回せる場合は元のDOM要素、それ以外はnull
      //         （nullの場合は呼び出し側が createTreeNodeFromBrowse で作り直す）。
      function disposeOrReuse(n) {
        const srcParent = _dragSourceParents.get(n);
        if (srcParent === targetParent) return n; // 同一コンテナ内の並べ替え: refresh()が丸ごと作り直す
        if (srcParent && vr && vr.isVirtualContainer(srcParent)) {
          const path = n._nodeData?.path;
          if (path) vr.removeFromContainer(srcParent, path);
          else { if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(n); n.remove(); }
          return null;
        }
        if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(n);
        n.remove();
        return n;
      }
      // DOM上の移動（ドロップ位置に順番通り挿入）
      if (position === 'inside' && (isFolder || isDB)) {
        if (childrenDiv.dataset.loaded === 'false') {
          moved.forEach(n => { disposeOrReuse(n); });
          if (toggle.dataset.expanded !== 'true') toggle.click();
        } else if (vr && vr.isVirtualContainer(childrenDiv)) {
          const movedData = moved.map(n => n._nodeData).filter(Boolean);
          moved.forEach(n => { disposeOrReuse(n); });
          vr.dropInto(childrenDiv, movedData);
          if (toggle.dataset.expanded !== 'true') toggle.click();
          setSortSetting(item.path, 'manual', 'asc');
          ensureManualSaved(vr.saveManualOrderFromVirtualModel(childrenDiv, item.path));
          if (!movedAcrossFolders) {
            pushOutlinerSettingsHistory('フォルダツリー: 並び順', orderBefore, item.path, [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);
          }
        } else {
          moved.forEach(n => {
            const data = n._nodeData;
            const reusable = disposeOrReuse(n);
            childrenDiv.appendChild(reusable || createTreeNodeFromBrowse(data, rootPath));
          });
          if (toggle.dataset.expanded !== 'true') toggle.click();
          setSortSetting(item.path, 'manual', 'asc');
          ensureManualSaved(saveManualOrderFromDOM(childrenDiv, item.path));
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
          ensureManualSaved(vr.saveManualOrderFromVirtualModel(targetParent, parentPath));
        } else {
          ensureManualSaved(saveManualOrderFromDOM(targetParent, parentPath));
        }
        if (!movedAcrossFolders) {
          pushOutlinerSettingsHistory('フォルダツリー: 並び順', orderBefore, parentPath, [SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);
        }
      }
      if (nodes.some(node => node._nodeData?._form_parent_path)) await loadOutliner();
    })().catch(async error => {
      if (error?.manualOrderFailure && !crossesFolders) {
        for (const key of orderBefore.keys || []) {
          const value = orderBefore.storage?.[key];
          if (localStorage.getItem(key) === value) continue;
          try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {}
        }
        await refreshOutliner({ force: true, reason: 'manual-sort-save-failed' });
      }
      // 移動の後始末（表示の読み直し・並び順の保存）の失敗も、黙らせずに原因つきで表示する
      if (typeof console !== 'undefined') {
        if (error?.manualOrderFailure) console.warn('[outliner] 並び順の保存に失敗', error);
        else console.error('[outliner] ドロップの処理に失敗', error);
      }
      if (typeof showStatus === 'function') showStatus('移動の処理に失敗しました: ' + (error?.userMessage || error?.message || error), true);
    }).finally(() => { moveReservation?.cancel(); });
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
          ...((item.entry_id || item.entryId) ? { expected_entry_id: item.entry_id || item.entryId,
            expected_entry_name: item.name || undefined } : {}),
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
        ...((item.entry_id || item.entryId) ? { expected_entry_id: item.entry_id || item.entryId,
          expected_entry_name: item.name || undefined } : {}),
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
  const canonical = value => {
    const path = _normalizeOutlinerPathForCompare(value);
    const absolute = input => /^(?:[a-z]:\/|\/)/i.test(input);
    const base = _normalizeOutlinerPathForCompare(typeof state !== 'undefined' ? state.vaultPath : '');
    const resolved = path && !absolute(path) && base && absolute(base) ? base + '/' + path : path;
    return /^[a-z]:\//i.test(resolved) ? resolved.toLowerCase() : resolved;
  };
  const deletedPaths = (paths || []).map(canonical).filter(Boolean);
  if (!deletedPaths.length) return;
  const matches = path => deletedPaths.some(dp => _isOutlinerPathWithin(canonical(path), dp));

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

function _markOutlinerDeletePending(paths, options = {}) {
  const pendingPaths = _setOutlinerDeletePending(paths, true);
  if (!pendingPaths.length) return pendingPaths;
  _removeOutlinerNodesForPaths(pendingPaths);
  _removeFolderItemsForPaths(pendingPaths);
  if (!options.preserveReferences && typeof purgeAppPathReferences === 'function') {
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

// ファイル・フォルダ・シートを作る操作（新規作成・別名で保存・複製）を取り消せるようにする（2026-11-21 ユーザー決定）。
// 取り消しは作ったものをゴミ箱へ移し、やり直しはゴミ箱から戻す（通常の削除と同じ参照の確認を通す）。
function pushCreatedOutlinerItemHistory(item, label, options = {}) {
  if (typeof historyPush !== 'function' || !item?.path) return null;
  const current = { ...item };
  let trashRef = null;
  // 種類の決め方は通常の削除（_deleteOutlinerTargetsSequentially）と同じ（シートは file として扱う）
  const kind = current.kind === 'folder' || current.type === 'folder' ? 'folder' : 'file';
  const refresh = async (phase) => {
    if (typeof options.refresh === 'function') { await options.refresh(phase, current); return; }
    await _runOutlinerDeleteHistoryRefresh(null, 'undo', {});
  };
  const entry = historyPush(label,
    async () => {
      const warning = typeof MeldexDeleteImpactWarning !== 'undefined' ? MeldexDeleteImpactWarning : null;
      const confirmation = warning?.authorizeReversibleDelete
        ? await warning.authorizeReversibleDelete([{ path: current.path, kind }])
        : { confirmed: true, operation: 'trash' };
      if (!confirmation) throw new Error('参照の確認ができなかったため取り消しを中止しました');
      const [result] = await _deleteOutlinerTargetsSequentially([{ ...current, kind }], { confirmation });
      if (result?.status !== 'fulfilled') throw new Error(String(result?.reason?.message || result?.reason || '作ったものをゴミ箱へ移せませんでした'));
      trashRef = _outlinerTrashRefFromResponse(result.value);
      if (!trashRef) throw new Error('作ったものをゴミ箱へ移せませんでした');
      if (typeof options.onUndo === 'function') { try { await options.onUndo(current); } catch {} }
      await refresh('undo');
    },
    async () => {
      if (!trashRef) throw new Error('ゴミ箱の項目が見つかりません');
      const restored = await apiPost('/outliner/restore', {
        trash_name: trashRef.trash_name,
        ...(trashRef.trash_root ? { trash_root: trashRef.trash_root } : {}),
      });
      current.path = restored?.restored_to || restored?.restored_path || current.path;
      trashRef = null;
      await refresh('redo');
    },
    options.scope ?? (typeof _historyActiveScope !== 'undefined' ? _historyActiveScope : ''));
  // 取り消すと作ったファイルを消す。別の画面からの Ctrl+Z で消さないための印（共通履歴の守りが使う）。
  if (typeof historyMarkFileEffects === 'function') historyMarkFileEffects(entry, { undoDeletes: [current.path] });
  return entry;
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
  // 履歴の枠は操作の時点で取る（画面からは先に消えるので、保存の完了を待たずに Ctrl+Z を押すと、
  // 削除ではなくその前の操作が取り消されていた: 2026-11-22 M-014 フォルダツリー網羅テスト。v0.7.529 のシートと同じ型）。
  // 枠は取り消し・やり直しの側で中身が入るまで待たれる。削除できなかった時は枠を外す。
  const historyReservation = typeof historyReserve === 'function'
    ? historyReserve(options.label || (targets.length + ' 件を削除'), options.scope || '', options.detail || targetPaths.join(', '))
    : null;
  try {
  _markOutlinerDeletePending(targetPaths, { preserveReferences: true });
  if (typeof options.onOptimisticDelete === 'function') {
    try { options.onOptimisticDelete(targets); } catch {}
  }

  const confirmation = options.confirmation || (typeof MeldexDeleteImpactWarning !== 'undefined'
    ? await MeldexDeleteImpactWarning.authorizeReversibleDelete(targets.map(item => ({
      path: item.path, kind: item.type === 'folder' || item.kind === 'folder' ? 'folder' : 'file',
      ...(item.assetId ? { assetId: item.assetId } : {}),
    }))) : { confirmed: true, operation: 'trash' });
  if (!confirmation) {
    _clearOutlinerDeletePending(targetPaths);
    const failed = targets.map(item => ({ ...item, error: '参照の確認に失敗したため削除を中止しました' }));
    await _runOutlinerDeleteHistoryRefresh(options.refresh, 'failure', { failed, failedPaths: targetPaths });
    historyReservation?.cancel();
    return { targets, requestedTargets, succeeded: [], skipped: [], failed, failedCount: targets.length, deletedCount: 0, deletedPaths: [], trashNames: [], trashRefs: [] };
  }
  // 確認が済むまでは、未保存のエディタやタブの参照を保つ。
  if (typeof purgeAppPathReferences === 'function') purgeAppPathReferences(targetPaths);

  const results = await _deleteOutlinerTargetsSequentially(targets, {
    confirmation,
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
    const pushDeleteEntry = () => historyPush(
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
