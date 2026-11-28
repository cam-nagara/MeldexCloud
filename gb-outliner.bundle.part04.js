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
      const virtualParentPath = window.GBOutlinerVirtualRender?.parentPathForItem(div.parentElement, item.path);
      const parentNode = div.parentElement?.closest('.tree-node');
      if (virtualParentPath !== undefined) {
        destFolder = virtualParentPath || parentNode?._nodeData?.path || '';
      } else if (parentNode) {
        destFolder = parentNode._nodeData?.path || '';
      } else if (div.closest('#body-home') && _homeFolderPath) {
        destFolder = _homeFolderPath;
      } else {
        destFolder = '';
      }
    }
    // 移動先のフォルダの名前の変更が保存中なら、終わるのを待って新しい場所へ移動する（2026-11-24 利用者の報告）。
    if (destFolder && typeof _outlinerAwaitPendingRenameForTarget === 'function') {
      try { destFolder = await _outlinerAwaitPendingRenameForTarget(destFolder); }
      catch (error) { showStatus(String(error?.message || '移動先の名前の変更を確認できません'), true); return; }
    }
    if (destFolder && isItemLocked(destFolder)) {
      showStatus('編集ロック中のフォルダには移動できません', true);
      return;
    }

    // シートの中に置けるのはエントリだけ。ボード・シナリオ・画像などを
    // 落とすと「シートの中にボードがある」状態になるため、通常移動ではなく
    // シート全ファイル取込（MeldexSheetEntryAttachments）へルーティングしてエントリ化する。
    if (position === 'inside' && isDB) {
      const nonEntries = nodes.filter(n => !_outlinerItemFitsInSheet(n._nodeData));
      if (e.altKey || nonEntries.length > 0) {
        if (typeof MeldexSheetEntryAttachments !== 'undefined') {
          await MeldexSheetEntryAttachments.intakeDropToSheet(item.path, e);
          return;
        }
      }
    }


    // API移動を先に実行し、成功したノードのみDOMを更新（失敗時にDOMが先行するのを防ぐ）
    // フォルダをまたぐ移動の履歴の枠はドロップの時点で取る（移動の往復とツリーの読み直しの前に Ctrl+Z を押すと、
    // 移動ではなくその前の操作が取り消されていた: 2026-11-22 M-014 フォルダツリー網羅テスト）。
    const crossesFolders = nodes.some(n => {
      const path = n._nodeData?.path || '';
      return path && path.substring(0, Math.max(0, path.lastIndexOf('/'))) !== destFolder;
    });
    const moveReservation = crossesFolders && typeof historyReserve === 'function'
      ? historyReserve(`フォルダツリー: ${nodes.length} 件を移動`, '')
      : null;
    const pendingMoves = new Map();
    const finishPendingMove = (node, failed) => {
      const pending = pendingMoves.get(node);
      if (!pending) return;
      node.dataset.path = pending.path;
      node.inert = pending.inert;
      node.removeAttribute('aria-busy');
      if (failed && pending.parent?.isConnected) {
        pending.parent.insertBefore(node, pending.next?.parentElement === pending.parent ? pending.next : null);
      }
      pendingMoves.delete(node);
    };
    if (crossesFolders) nodes.forEach(node => pendingMoves.set(node, {
      path: node.dataset.path, parent: node.parentElement, next: node.nextSibling, inert: node.inert,
    }));
    // フォルダをまたぐ移動は、保存の往復を待たずに先に移動先へ行を移す（app/AGENTS.md の0.3秒。以前は保存の往復と
    // 読み直しの後に出て0.4秒を超えていた: 2026-11-22 M-014 横断の検査）。移動先が読み込み済みで仮想化していない時だけ。
    // 保存の後の差分の反映（下の _outlinerSyncFoldersOrReload）が、成功・失敗のどちらでも保存先の状態へ揃える。
    if (crossesFolders) {
      // フォルダの中へ落とした時は、そのフォルダを開く（以前の全体の読み直しと同じ見え方。閉じていれば開き、
      // 未読込なら読み込みを始める＝保存の往復と並行して読み込む）
      if (position === 'inside' && (isFolder || isDB) && toggle && childrenDiv) {
        if (childrenDiv.dataset.loaded === 'true') {
          childrenDiv.classList.remove('collapsed');
          toggle.classList.add('expanded');
          toggle.dataset.expanded = 'true';
          saveExpandedState(item.path, true);
        } else if (toggle.dataset.expanded !== 'true') {
          toggle.click();
        }
      }
      const optimisticContainer = position === 'inside' && (isFolder || isDB) ? childrenDiv : div.parentElement;
      const containerReady = () => optimisticContainer && optimisticContainer.isConnected && optimisticContainer.classList.contains('tree-children')
        && optimisticContainer.dataset.loaded === 'true' && optimisticContainer.dataset.virtual !== 'true'
        && !optimisticContainer.classList.contains('collapsed');
      const placeOptimistically = () => {
        nodes.forEach(n => {
          if (!pendingMoves.has(n)) return;
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

/// ---- 子が多いフォルダの分割読み込み（2026-11-24） ----
// 展開した時に全件を /browse で取らず、/browse-page でページごとに取る。読み込み済みの範囲は連続した1区間で、
// 見えている範囲がその端へ近づいたら前後のページを継ぎ足す。スクロールバーなどで遠くへ飛んだ時は、
// 間を順に読まず、飛んだ先のページを位置（at）で直接取って、読み込み済みの範囲を入れ替える（末尾へ飛んでも要求は1回）。
// 読み込んでいない前後の行は高さだけ確保する。並びはサーバーの順（名前・更新日時・作成日時。手動の並びは使えない）。
const OUTLINER_PAGED_CHILDREN_PAGE = 500;
const OUTLINER_PAGED_CHILDREN_AHEAD_PX = 1500;
// 見えている範囲が読み込み済みの範囲からこの行数より離れたら、継ぎ足しではなく飛んだ先を直接取る
const OUTLINER_PAGED_CHILDREN_JUMP_ROWS = 1000;
let _outlinerPagedChildrenThreshold = 2000;
const _outlinerPagedFolders = new Set();
let _outlinerPagedCheckQueued = false;
let _outlinerPagedScrollBound = false;
const _outlinerPagedStats = { requests: 0 };

function _outlinerPagedWait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function _outlinerFetchChildrenPage(url, isCurrent) {
  // 読み取り待ちの知らせの後は、最初は短い間隔で聞き直す（読み取りは 0.2〜0.3 秒で終わることが多い）
  for (let tries = 0; ; tries += 1) {
    _outlinerPagedStats.requests += 1;
    const result = await apiFetch(url, { silentError: true });
    if (!result || result.pending !== true) return result;
    await _outlinerPagedWait(tries === 0 ? 100 : tries === 1 ? 200 : 300);
    if (isCurrent && !isCurrent()) return null;
  }
}

function _outlinerPreparePagedChildren(record, items) {
  const list = (Array.isArray(items) ? items : [])
    .filter(child => child && !(typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(child.path)));
  registerFileTypes(list);
  _registerOutlinerConflictPaths(list);
  if (typeof _registerFileIds === 'function') _registerFileIds(list);
  list.forEach(child => { if (record.item.sourceId && !child.sourceId) child.sourceId = record.item.sourceId; });
  return list;
}

async function _outlinerLoadPagedFolderChildren(childrenDiv, item, folderNode, rootPath, apiSort, order) {
  if (window.MeldexRuntimeAdapter?.isDropboxMode?.() || !item?.path) return false;
  if (globalThis.localStorage?.getItem?.('tree-layout') === 'grid') return false;
  const base = '/browse-page?path=' + encodeURIComponent(item.path) + '&sort=' + apiSort + '&order=' + order
    + (rootPath ? '&root=' + encodeURIComponent(rootPath) : '') + '&all_files=true';
  const isCurrent = () => childrenDiv.isConnected;
  let probe;
  try { probe = await _outlinerFetchChildrenPage(base + '&limit=1&at=0', isCurrent); } catch { return false; }
  if (!probe || !(Number(probe.total) > _outlinerPagedChildrenThreshold)) return false;
  const first = await _outlinerFetchChildrenPage(base + '&limit=' + OUTLINER_PAGED_CHILDREN_PAGE + '&at=0', isCurrent);
  if (!first) return false;
  // start = 読み込み済みの範囲の先頭の位置（サーバーの並びでの番号）、fetched = サーバーから受け取った行数
  // （削除待ちで外した行も数える。次のページの位置の計算に使う）、loaded = ツリーへ足した行数。
  const record = {
    childrenDiv, item, rootPath, base, total: Number(first.total) || 0, start: 0, fetched: 0, loaded: 0,
    lastPath: '', loading: false, failedAt: 0, atEnd: false, signature: String(first.signature || ''),
  };
  const items = _outlinerPreparePagedChildren(record, first.items);
  await _appendOrVirtualizeOutlinerChildren(childrenDiv, items, rootPath, { folderItem: item, folderNode, kind: 'folder' });
  record.fetched = Array.isArray(first.items) ? first.items.length : 0;
  record.loaded = items.length;
  record.lastPath = items.length ? items[items.length - 1].path : '';
  _outlinerPagedUpdateRecord(record, first);
  childrenDiv._outlinerPagedRecord = record;
  _outlinerPagedFolders.forEach(other => { if (other.childrenDiv === childrenDiv) _outlinerPagedFolders.delete(other); });
  if (!record.atEnd) {
    _outlinerPagedFolders.add(record);
    _outlinerBindPagedScroll();
    _outlinerQueuePagedCheck();
  }
  return true;
}

// 読み込み済みの範囲の後ろに残っている行数
function _outlinerPagedTailRows(record) {
  return Math.max(0, record.total - (record.start + record.fetched));
}

function _outlinerPagedUpdateRecord(record, result) {
  if (result && Number.isFinite(Number(result.total))) record.total = Number(result.total);
  record.atEnd = record.start === 0 && _outlinerPagedTailRows(record) === 0;
  record.childrenDiv.dataset.pagedTotal = String(record.total);
  record.childrenDiv.dataset.pagedLoaded = String(record.loaded);
  record.childrenDiv.dataset.pagedStart = String(record.start);
  _outlinerReservePagedRows(record);
}

// まだ読み込んでいない続きの分の高さを確保する（スクロールバーが、読み込み済みの分ではなく全体の長さを表す）
function _outlinerReservePagedRows(record) {
  window.GBOutlinerVirtualRender?.setPendingRows?.(record.childrenDiv, _outlinerPagedTailRows(record));
}

function _outlinerBindPagedScroll() {
  if (_outlinerPagedScrollBound) return;
  const scroller = document.getElementById('tree-scroll-container');
  if (!scroller) return;
  _outlinerPagedScrollBound = true;
  scroller.addEventListener('scroll', _outlinerQueuePagedCheck, { passive: true });
  window.addEventListener('resize', _outlinerQueuePagedCheck, { passive: true });
}

function _outlinerQueuePagedCheck() {
  if (_outlinerPagedCheckQueued) return;
  _outlinerPagedCheckQueued = true;
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    _outlinerPagedCheckQueued = false;
    _outlinerCheckPagedFolders();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  setTimeout(run, 60);
}

function _outlinerPagedLoadedBottom(record) {
  const vr = window.GBOutlinerVirtualRender;
  if (vr?.isVirtualContainer?.(record.childrenDiv)) {
    const bottom = vr.bottomOfItem?.(record.childrenDiv, record.lastPath);
    if (bottom != null) return bottom;
  }
  return record.childrenDiv.getBoundingClientRect().bottom;
}

// 見えている範囲に対して、次に取るもの。null = 取るものは無い。
//   { kind: 'jump', at }      読み込み済みの範囲から遠い: 飛んだ先を直接取って、範囲を入れ替える
//   { kind: 'append' }        末尾へ近い: 続きを継ぎ足す
//   { kind: 'prepend' }       先頭へ近い（前に読み込んでいない行がある）: 前を継ぎ足す
function _outlinerPagedNextStep(record) {
  const vr = window.GBOutlinerVirtualRender;
  const virtual = !!vr?.isVirtualContainer?.(record.childrenDiv);
  const tail = _outlinerPagedTailRows(record);
  const metrics = virtual ? vr.windowMetrics?.(record.childrenDiv) : null;
  if (!metrics) {
    // 仮想の一覧でない時（絞り込みで件数が少ない等）は、従来どおり末尾へ近づいたら続きを足すだけ
    if (!tail) return null;
    const scroller = document.getElementById('tree-scroll-container');
    if (!scroller || virtual) return null;
    return _outlinerPagedLoadedBottom(record) - scroller.getBoundingClientRect().bottom > OUTLINER_PAGED_CHILDREN_AHEAD_PX
      ? null : { kind: 'append' };
  }
  const row = metrics.rowHeight || 22;
  if (metrics.viewBottom < 0 || metrics.viewTop > metrics.height) return null; // 一覧が画面に掛かっていない
  const viewTop = Math.max(0, metrics.viewTop), viewBottom = Math.min(metrics.height, metrics.viewBottom);
  const jumpPx = OUTLINER_PAGED_CHILDREN_JUMP_ROWS * row;
  const jumpTo = () => {
    // 入れ替えた後は、読み込んでいない行はすべて同じ高さで並ぶ。見えている範囲の少し上から1ページ取る。
    const index = Math.floor(viewTop / row) - Math.floor(OUTLINER_PAGED_CHILDREN_PAGE / 4);
    return { kind: 'jump', at: Math.max(0, Math.min(Math.max(0, record.total - OUTLINER_PAGED_CHILDREN_PAGE), index)) };
  };
  if (tail && viewTop - metrics.loadedBottom > jumpPx) return jumpTo();
  if (record.start > 0 && metrics.loadedTop - viewBottom > jumpPx) return jumpTo();
  if (tail && metrics.loadedBottom - viewBottom <= OUTLINER_PAGED_CHILDREN_AHEAD_PX) return { kind: 'append' };
  if (record.start > 0 && viewTop - metrics.loadedTop <= OUTLINER_PAGED_CHILDREN_AHEAD_PX) return { kind: 'prepend' };
  return null;
}

function _outlinerCheckPagedFolders() {
  const scroller = document.getElementById('tree-scroll-container');
  if (!scroller) return;
  _outlinerPagedFolders.forEach(record => {
    if (!record.childrenDiv.isConnected || record.childrenDiv._outlinerPagedRecord !== record || record.atEnd) {
      if (!record.childrenDiv.isConnected || record.atEnd) _outlinerPagedFolders.delete(record);
      return;
    }
    if (record.loading || (record.failedAt && Date.now() - record.failedAt < 2000)) return;
    if (record.childrenDiv.closest('.collapsed')) return;
    const step = _outlinerPagedNextStep(record);
    if (step) void _outlinerLoadChildrenStep(record, step);
  });
}

async function _outlinerLoadChildrenStep(record, step) {
  record.loading = true;
  try {
    const isCurrent = () => record.childrenDiv.isConnected && record.childrenDiv._outlinerPagedRecord === record;
    const vr = window.GBOutlinerVirtualRender;
    const page = OUTLINER_PAGED_CHILDREN_PAGE;
    let at, limit;
    if (step.kind === 'jump') { at = step.at; limit = page; }
    else if (step.kind === 'prepend') { at = Math.max(0, record.start - page); limit = record.start - at; }
    else { at = record.start + record.fetched; limit = page; }
    const result = await _outlinerFetchChildrenPage(record.base + '&limit=' + limit + '&at=' + at, isCurrent);
    if (!result || !isCurrent()) return;
    const received = Array.isArray(result.items) ? result.items.length : 0;
    const startAt = Number.isFinite(Number(result.start)) ? Number(result.start) : at;
    const items = _outlinerPreparePagedChildren(record, result.items);
    const virtual = !!vr?.isVirtualContainer?.(record.childrenDiv);
    // 一覧が変わっていたら（他の操作で項目が増減した）、継ぎ足す位置がずれるので、受け取ったページで範囲を入れ替える
    const signature = String(result.signature || '');
    const changed = !!signature && !!record.signature && signature !== record.signature;
    record.signature = signature || record.signature;
    if (Number.isFinite(Number(result.total))) record.total = Number(result.total);
    if (virtual && (step.kind === 'jump' || changed)) {
      record.start = startAt;
      record.fetched = received;
      record.loaded = items.length;
      vr.replaceWindow(record.childrenDiv, items, record.start, _outlinerPagedTailRows(record));
    } else if (step.kind === 'prepend' && virtual) {
      record.start = startAt;
      record.fetched += received;
      record.loaded += items.length;
      vr.prependItems(record.childrenDiv, items, record.start);
    } else if (step.kind !== 'jump' && step.kind !== 'prepend') {
      if (virtual) vr.appendItems(record.childrenDiv, items);
      else await _appendOutlinerChildrenChunked(record.childrenDiv, items, record.rootPath);
      record.fetched += received;
      record.loaded += items.length;
    }
    if (items.length && step.kind !== 'prepend') record.lastPath = items[items.length - 1].path;
    _outlinerPagedUpdateRecord(record, result);
    record.failedAt = 0;
  } catch (error) {
    record.failedAt = Date.now();
    console.warn('[フォルダツリー] 続きの読み込みに失敗:', record.item.path, error);
  } finally {
    record.loading = false;
    if (!record.atEnd) _outlinerQueuePagedCheck();
  }
}

if (typeof window !== 'undefined') {
  window.MeldexOutlinerPagedChildren = {
    threshold: () => _outlinerPagedChildrenThreshold,
    setThreshold(value) { _outlinerPagedChildrenThreshold = Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 2000; },
    check: _outlinerCheckPagedFolders,
    records: () => Array.from(_outlinerPagedFolders, record => ({ path: record.item.path, total: record.total, start: record.start,
      loaded: record.loaded, atEnd: record.atEnd, loading: record.loading })),
    requests: () => _outlinerPagedStats.requests,
  };
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
          // 子が多いフォルダは全件の読み取りを裏で始めない（開いた時にページごとに取る）
          if (next.path.startsWith('/browse?') && await _outlinerWarmTargetIsLarge(next.path)) continue;
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

async function _outlinerWarmTargetIsLarge(browsePath) {
  try {
    const query = new URLSearchParams(browsePath.slice(browsePath.indexOf('?') + 1));
    const probe = await apiFetch('/browse-page?path=' + encodeURIComponent(query.get('path') || '')
      + (query.get('root') ? '&root=' + encodeURIComponent(query.get('root')) : '')
      + '&sort=' + (query.get('sort') || 'name') + '&order=' + (query.get('order') || 'asc') + '&limit=1&at=0&all_files=true',
    { background: true, silentError: true });
    return probe?.pending === true || Number(probe?.total) > _outlinerPagedChildrenThreshold;
  } catch (_) { return false; }
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
      }, { silentError: options.silentError === true });
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
