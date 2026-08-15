            const attachmentFolder = String(pivotData?.attachment_folder || '').trim();
            if (attachmentFolder) {
              entityItems.unshift({ name: attachmentFolder, type: 'folder', path: item.path + '/' + attachmentFolder });
            }
            await _appendOrVirtualizeOutlinerChildren(childrenDiv, entityItems, rootPath, { folderItem: item, folderNode: div, kind: 'database' });
          } else if (currentIsFolder) {
            const sortCfg = getSortForFolder(item.path);
            const serverSorts = new Set(['name', 'modified', 'created']);
            const apiSort = serverSorts.has(sortCfg.sort) ? sortCfg.sort : 'name';
            const needsClientSort = sortCfg.sort === 'manual' || !serverSorts.has(sortCfg.sort);
            const rootParam = rootPath ? '&root=' + encodeURIComponent(rootPath) : '';
            const sourceParam = item.sourceId ? '&sourceId=' + encodeURIComponent(item.sourceId) : '';
            const detailParam = needsClientSort && sortCfg.sort !== 'manual' ? '&detail=true' : '';
            const children = await apiFetch('/browse?path=' + encodeURIComponent(item.path) + '&sort=' + apiSort + '&order=' + sortCfg.order + rootParam + sourceParam + detailParam + '&all_files=true');
            let visibleChildren = children.filter(child => !(typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(child?.path)));
            registerFileTypes(visibleChildren);
            // フィルタポップアップが開いている場合、新規判明タイプをチェック一覧へ即時反映する
            // （renderGlobalFilterUI自体はクリック時点で常に最新一覧を取り直すため必須ではないが、
            // 一覧の見た目を早めに追従させておく）。
            if (typeof renderGlobalFilterUI === 'function') renderGlobalFilterUI();
            _registerOutlinerConflictPaths(visibleChildren);
            visibleChildren.forEach(child => {
              if (item.sourceId && !child.sourceId) child.sourceId = item.sourceId;
            });
            // マニュアルソートは配列側で確定してから追加する（仮想化コンテナはDOM順を持たないため）
            if (sortCfg.sort === 'manual') visibleChildren = _sortItemsByManualOrder(visibleChildren, item.path);
            else if (needsClientSort) visibleChildren = [...visibleChildren].sort((a, b) => compareItemsForFolderSort(a, b, sortCfg.sort, sortCfg.order));
            await _appendOrVirtualizeOutlinerChildren(childrenDiv, visibleChildren, rootPath, { folderItem: item, folderNode: div, kind: 'folder' });
          }
          delete childrenDiv.dataset.loadError;
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
          childrenDiv.dataset.loaded = 'true';
          // 読み込み中にArrowRightの2打目が押されていた場合、最初の子へフォーカス
          // 移動する予約を消化する。フォーカスが別ノードへ移っていたら（選択が
          // このノード以外になっていたら）予約は破棄し、勝手にフォーカスを飛ばさない。
          if (childrenDiv._outlinerPendingArrowRightFocusNode === div) {
            delete childrenDiv._outlinerPendingArrowRightFocusNode;
            if (div.isConnected && toggle.dataset.expanded === 'true' && treeSelection.lastClicked === div
                && typeof _outlinerKeyboardFirstChildNode === 'function' && typeof _outlinerKeyboardSelectNode === 'function') {
              const pendingFirstChild = _outlinerKeyboardFirstChildNode(div);
              if (pendingFirstChild) _outlinerKeyboardSelectNode(pendingFirstChild);
            }
          }
        } catch (e) {
          // 握りつぶさず理由を表示する。部分的に追加済みの子ノードを取り除き、
          // 折りたたみ直して再クリックすればリロードが走る状態に戻す
          const reason = (e && (e.userMessage || e.message)) ? String(e.userMessage || e.message) : '';
          childrenDiv.dataset.loadError = reason || '不明なエラー';
          console.error('[フォルダツリー] 子項目の読み込みに失敗:', item.path, e);
          showStatus(`「${item.name}」の読み込みに失敗` + (reason ? `（${reason}）` : ''), true);
          childrenDiv.querySelectorAll(':scope > .tree-node').forEach(n => {
            if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(n);
            n.remove();
          });
          toggle.classList.remove('expanded');
          toggle.dataset.expanded = 'false';
          childrenDiv.classList.add('collapsed');
          saveExpandedState(item.path, false);
          // 失敗時は子が存在しないため、予約されていたフォーカス移動も破棄する
          delete childrenDiv._outlinerPendingArrowRightFocusNode;
        }
        finally {
          delete childrenDiv.dataset.loading;
          spinner.remove();
        }
      }
    } else {
      toggle.classList.remove('expanded');
      toggle.dataset.expanded = 'false';
      childrenDiv.classList.add('collapsed');
      saveExpandedState(item.path, false);
      if (parentVirtualContainer) {
        window.GBOutlinerVirtualRender?.collapseNested(parentVirtualContainer, item.path);
      }
      window.GBOutlinerVirtualRender?.syncMountForVisibility(childrenDiv);
      // 作品フォルダ動的アイコン切替（折畳み時）
      if (currentIsFolder) {
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
  if (!item._gbVirtualExpansionManaged) _queueSavedOutlinerExpansion(item, toggle);

  // Row click: 選択のみ（メインパネルの切替・展開／折りたたみは行わない。§2.4）
  row.addEventListener('click', (e) => {
    try { row.focus({ preventScroll: true }); } catch {}
    if (e.shiftKey) {
      // Shift+クリック: 範囲選択（開かない）
      e.preventDefault();
      treeSelection.rangeTo(div);
      treeSelection.lastClicked = div;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+クリック: トグル選択（開かない）
      treeSelection.toggle(div);
      treeSelection.lastClicked = div;
      return;
    }

    // 通常クリック: 選択・フォーカス・オプションパネル対象の更新のみ
    window.GBOutlinerActivation?.selectNodeOnly(div, { focus: false });

    // open* 呼び出しが無くなったため、スクロール位置保護（pointerdown起点のガード）を念押し復元
    _treeScrollGuardRestore();

    // 設定「クリックで開く」が単クリックの場合: 選択に続けてそのまま開く。
    // フォルダも含め全項目種別に一貫して適用する（フォルダだけ例外にすると
    // 「なぜこれだけ2回押さないと開かないのか」という不整合が生じるため）。
    // activateNode はフォルダなら開く+展開、ファイルなら対応するビューを開く。
    if (window.GBOutlinerActivation?.singleClickOpensItems?.()) {
      window.GBOutlinerActivation.activateNode(div);
    }
  });

  // --- ダブルクリック: 共通アクティベーション（一度だけ開く）。名前変更はF2/メニューへ移動 ---
  row.ondblclick = (e) => {
    e.stopPropagation();
    // 単クリックで開く設定の時は、直前の2回のclickで既にactivateNodeが呼ばれているため
    // ここでの追加呼び出しは行わない（3重起動防止）。
    if (window.GBOutlinerActivation?.singleClickOpensItems?.()) return;
    window.GBOutlinerActivation?.activateNode(div);
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
  row.addEventListener('dragstart', (e) => {
    if (item._isRoot) {
      e.preventDefault();
      return;
    }
    // 複数選択中にドラッグ開始: 選択に含まれていなければ単一選択に切り替え
    if (!treeSelection.has(div)) {
      treeSelection.clear();
      treeSelection.add(div);
      treeSelection.lastClicked = div;
    }
    draggedNode = div;
    // 仮想化コンテナのスクロール自動アンマウントから、ドラッグ中の元行を除外する
    if (item.path) window.GBOutlinerVirtualRender?.setDragExempt(item.path);
    // DOM順でソート（上から下の順序を維持）
    const allTreeNodes = [...document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node')];
    const selectedNodes = [...treeSelection.items].sort((a, b) => allTreeNodes.indexOf(a) - allTreeNodes.indexOf(b));
    // 開始行の祖先フォルダが古い選択に残っていても、画像等の子行を
    // ドラッグした操作で親フォルダごと昇格させない。その後、通常の
    // 親子de-dupを行い、同じ選択を2回移動しない。
    const withoutDragAncestors = selectedNodes.filter(n => n === div || !_treeNodeIsAncestor(n, div));
    draggedNodes = withoutDragAncestors.filter(n => !withoutDragAncestors.some(parent => _treeNodeIsAncestor(parent, n)));
    draggedNodes.forEach(n => n.querySelector('.tree-node-row')?.classList.add('dragging'));
    const payload = _treeDragPayload(item, draggedNodes);
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
    window._gbOutlinerDragNonce = typeof MeldexDnD !== 'undefined'
      ? MeldexDnD.beginCrossWindowDrag(e.dataTransfer, payload, 'node') : '';
    // 窓外ドロップ時の popout 用に payload を保持
    window._gbOutlinerDragPayload = payload;
    // ドロップインジケータが隠れないよう、プレビュー画像を低不透明度にする
    if (typeof setLowOpacityDragImage === 'function') {
      setLowOpacityDragImage(e, row, 0.35);
    }
  });

  row.addEventListener('dragend', async (e) => {
    (draggedNodes || []).forEach(n => n.querySelector('.tree-node-row')?.classList.remove('dragging'));
    clearDragIndicators();
    window.GBOutlinerVirtualRender?.clearDragExempt();
    // ペインタブバーに表示されている挿入位置マーカーを確実にクリア
    // （ESC キャンセル等でタブバー側の dragleave が発火しないケースの漏れ対策）
    document.querySelectorAll('.gb-tab.gb-tab-drop-before, .gb-tab.gb-tab-drop-after')
      .forEach(t => t.classList.remove('gb-tab-drop-before', 'gb-tab-drop-after'));
    // 窓外にドロップされた場合: 共通ヘルパーで単一窓として開く
    const shouldPopout = typeof shouldOpenDragPopout === 'function'
      ? await shouldOpenDragPopout(e, window._gbOutlinerDragNonce)
      : (typeof isDragDroppedOutsideWindow === 'function' && isDragDroppedOutsideWindow(e));
    if (shouldPopout) {
      const payload = window._gbOutlinerDragPayload;
      const items = payload && Array.isArray(payload.items) ? payload.items : [];
      if (typeof openItemsAsSingleTabWindows === 'function') openItemsAsSingleTabWindows(items);
    }
    if (window._gbOutlinerDragNonce && typeof MeldexDnD !== 'undefined') {
      MeldexDnD.cancelCrossWindowDrag(window._gbOutlinerDragNonce);
    }
    window._gbOutlinerDragPayload = null;
    window._gbOutlinerDragNonce = '';
    draggedNode = null;
    draggedNodes = null;
  });

  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedNode) {
      const externalItems = _outlinerExternalDragItems(e);
      const bridgeCandidate = typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(e, 'node');
      if ((!externalItems.length && !bridgeCandidate) || !(isFolder || isDB) || item._isRoot && !item.path
          || externalItems.some(source => source.type === 'entity') || isItemLocked(item.path)) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.dataTransfer.dropEffect = 'move';
      clearDragIndicators();
      row.classList.add('drag-over-inside');
      return;
    }
    if ((draggedNodes || [draggedNode]).some(node => node?._nodeData?.type === 'entity')) {
      e.dataTransfer.dropEffect = 'none';
      clearDragIndicators();
      return;
    }
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

  row.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedNode) {
      const resolved = typeof MeldexDnD !== 'undefined' ? await MeldexDnD.resolveDropData(e, 'node') : null;
      const externalItems = _outlinerExternalDragItems(e, resolved?.payload).filter(source => {
        const sourcePath = String(source.path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        const targetPath = String(item.path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        return source.type !== 'entity' && sourcePath !== targetPath && !targetPath.startsWith(sourcePath + '/');
      });
      clearDragIndicators();
      if (!(isFolder || isDB) || isItemLocked(item.path) || externalItems.length === 0) {
        if (resolved) MeldexDnD.failDrop(resolved);
        return;
      }
      const completed = await _moveExternalItemsIntoOutlinerFolder(externalItems, item);
      if (resolved && completed > 0) MeldexDnD.completeDrop(resolved);
      else if (resolved) MeldexDnD.failDrop(resolved);
      return;
    }
    if ((draggedNodes || [draggedNode]).some(node => node?._nodeData?.type === 'entity')) {
      clearDragIndicators();
      showStatus('シートのエントリはフォルダツリー内へ移動できません');
      return;
    }
    // Ctrl+ドロップ: ツリー内移動を行わない（ペインで開く操作に委ねる）
    if (e.ctrlKey) { clearDragIndicators(); return; }
    if (!draggedNode || draggedNode === div) return;
    const nodes = (draggedNodes || [draggedNode])
      .filter(n => n !== div && !_treeNodeIsAncestor(n, div) && !n._nodeData?._isRoot && !(n._nodeData?.path && isItemLocked(n._nodeData.path)));
    if (nodes.length === 0) return;
    const orderBefore = captureOutlinerSettingsHistory([SORT_SETTINGS_KEY, MANUAL_ORDER_KEY]);
    // 移動元コンテナが仮想化されていた場合、DOM移動だけでは配列側に残留するため
    // 事前に元の親コンテナを記録しておき、移動完了後に配列からも取り除く。
    const _dragSourceParents = new Map(nodes.map(n => [n, n.parentElement]));

    // Alt+D&D: フォルダリンク登録（移動ではなくリンク）
    if (e.altKey && (isFolder || isDB)) {
      const linkItems = nodes.map(n => n._nodeData).filter(d => d?.path);
      try {
        const result = typeof addFolderLinksBatchWithHistory === 'function'
          ? await addFolderLinksBatchWithHistory(linkItems, item.path)
          : await apiPost('/folder-links/batch/add', { items: linkItems.map(d => ({ file_path: d.path })), folder_path: item.path });
        const failed = result?.failed_count || 0;
        const changed = result?.created_count || 0;
        showStatus(`${changed} 件を「${item.name}」にも表示しました${failed ? `（${failed} 件失敗）` : ''}`, failed > 0 && changed === 0);
      } catch {
        showStatus('リンク登録に失敗', true);
      }
      clearDragIndicators();
      loadOutliner();
      return;
    }

    const position = row.classList.contains('drag-over-above') ? 'above'
      : row.classList.contains('drag-over-inside') ? 'inside'
      : 'below';
    clearDragIndicators();

    // ワークスペースセクションのルート行への上下ドロップは、並び替えではなく
    // ルートフォルダ外（vaultルート）への実移動になってしまうため受け付けない
    if (position !== 'inside' && item._isRoot && div.closest('#body-workspaces')) {
      showStatus('ワークスペースの中に移動する場合は、ワークスペース名の上にドロップしてください');
      return;
    }

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
    if (destFolder && isItemLocked(destFolder)) {
      showStatus('編集ロック中のフォルダには移動できません', true);
      return;
    }

    // シートの中に置けるのはエントリだけ。ボード・シナリオ・画像などを
    // 落とすと「シートの中にボードがある」状態になるため、ドロップ時点で止める。
    if (position === 'inside' && isDB) {
      const rejected = nodes.filter(n => !_outlinerItemFitsInSheet(n._nodeData));
      if (rejected.length) {
        const names = rejected.map(n => n._nodeData?.name || '').filter(Boolean);
        showStatus(
          'シートの中にはエントリだけを置けます（' + (names[0] || '対象') +
          (names.length > 1 ? ' ほか ' + (names.length - 1) + ' 件' : '') + '）',
          true
        );
        return;
      }
    }

    // API移動を先に実行し、成功したノードのみDOMを更新（失敗時にDOMが先行するのを防ぐ）
    (async () => {
      const moved = [];
      let movedAcrossFolders = false;
      let processed = 0;
      window.MeldexImportProgress?.beginOperation?.('ファイルを移動中', nodes.length);
      for (const n of nodes) {
        const dragData = n._nodeData;
        if (!dragData || !dragData.path) {
          moved.push(n);
          processed += 1;
          window.MeldexImportProgress?.updateOperation?.(processed);
          continue;
        }
        const srcFolder = dragData.path.includes('/') ? dragData.path.substring(0, dragData.path.lastIndexOf('/')) : '';
        if (destFolder === srcFolder) {
          moved.push(n);
          processed += 1;
          window.MeldexImportProgress?.updateOperation?.(processed);
          continue;
        }
        movedAcrossFolders = true;
        try {
          const oldPath = dragData.path;
          const res = await apiPost('/outliner/move', {
            path: dragData.path,
            dest_folder: destFolder,
            conflict_policy: 'error',
          });
          if (res.new_path) {
            if (typeof _renameTreeNode === 'function') {
              _renameTreeNode(oldPath, res.new_path, res.new_name || dragData.name, res.file_id);
            } else {
              dragData.path = res.new_path;
              dragData.name = res.new_name || dragData.name;
              const lbl = n.querySelector('.tree-label');
              if (lbl && res.new_name) lbl.textContent = res.new_name;
            }
            window.GBOutlinerVirtualRender?.renamePath(oldPath, res.new_path, res.new_name || dragData.name, res.file_id);
            if (typeof renameAppPathReferences === 'function') {
              renameAppPathReferences(oldPath, res.new_path, { label: res.new_name || dragData.name, fileId: res.file_id, type: dragData.type || 'page' });
            }
          }
          if (typeof handleRelocateResponse === 'function') handleRelocateResponse(res);
          moved.push(n);
        } catch (err) {
          // 失敗理由（移動先が無い・使用中・ロック中等）を握りつぶさず表示する
          const reason = (err && (err.userMessage || err.message)) ? String(err.userMessage || err.message) : '';
          showStatus(`${dragData.name} の移動に失敗` + (reason ? `（${reason}）` : ''), true);
        } finally {
          processed += 1;
          window.MeldexImportProgress?.updateOperation?.(processed);
        }
      }
      window.MeldexImportProgress?.finishOperation?.();
      if (moved.length === 0) return;
      // フォルダをまたぐ複数移動では、各API成功後のDOMを古い親要素へ順次
      // 付け替えると、途中の再描画や親フォルダ自身の移動で表示が欠落する。
      // サーバー上の確定状態を一度だけ読み直し、部分成功も含めてツリー全体を
      // 同じスナップショットへ揃える。同一フォルダ内の並べ替えは下の局所更新を維持する。
      if (movedAcrossFolders) {
        if (position === 'inside' && (isFolder || isDB)) saveExpandedState(item.path, true);
        await refreshOutliner({ force: true, reason: 'outliner-tree-drop-move' });
        return;
      }
      const vr = window.GBOutlinerVirtualRender;
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
          vr.saveManualOrderFromVirtualModel(childrenDiv, item.path);
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
    } catch {}
  }
  const results = [];
  for (const item of targets) {
    try {
      const value = await apiPost('/outliner/delete', {
        path: item.path,
        kind: item.kind === 'folder' || item.type === 'folder' ? 'folder' : 'file',
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
  const allTreeNodes = document.querySelectorAll('#outliner-tree .tree-node, #body-home .tree-node, #body-workspaces .tree-node');
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
  const restored = [];
  for (const ref of refs || []) {
    if (!ref?.trash_name) continue;
    try {
      const result = await apiPost('/outliner/restore', {
        trash_name: ref.trash_name,
        ...(ref.trash_root ? { trash_root: ref.trash_root } : {}),
      });
      restored.push(result);
    } catch (error) {
      const message = error?.message ? String(error.message) : '復元に失敗しました';
      throw new Error(ref.trash_name + ' の復元に失敗しました: ' + message);
    }
  }
  return restored;
}

async function _runOutlinerDeleteHistoryRefresh(refresh, phase, result) {
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
