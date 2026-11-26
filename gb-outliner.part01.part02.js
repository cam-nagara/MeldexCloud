  row.draggable = !itemLocked && !item._isRoot;
  row.tabIndex = -1;

  const isFolder = item.type === 'folder';
  const isDB = item.type === 'database';
  const isUnavailableRoot = item.needsMapping === true;
  const isExpandable = !isUnavailableRoot && (isFolder || isDB || item.type === 'form-app');

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
    // フォルダツリー改修Phase4: 軽量サムネイル表示・OS登録形式アイコン（対象外/OFF時は何もしない）
    if (!item.display_icon) window.GBOutlinerThumbnails?.attachToRow(row, item, icon);
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
    notice.style.cssText = 'margin-left:6px;color:var(--fg2);font-size:11px;white-space:nowrap;cursor:pointer;';
    notice.addEventListener('click', (e) => {
      e.stopPropagation();
      window.MeldexSettingsCloudLink?.confirmSourceFolderLocation?.(item);
    });
    row.title = notice.title;
    row.dataset.gbTooltip = notice.title;
    row.appendChild(notice);
  }
  if (Array.isArray(item.feature_labels) && item.feature_labels.length) {
    const badge = document.createElement('span');
    badge.className = 'tree-feature-badge';
    badge.innerHTML = lucide('link', 12);
    badge.title = 'Meldex連携: ' + item.feature_labels.join('、');
    badge.dataset.gbTooltip = badge.title;
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', badge.title);
    badge.style.cssText = 'display:inline-flex;align-items:center;opacity:0.65;margin-left:auto;flex-shrink:0;';
    row.appendChild(badge);
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
    // クリック前のホバー中にOS項目を先読みし、開いた時点で揃っている状態にする。
    menuBtn.addEventListener('pointerenter', () => {
      if (item.path && typeof prefetchShellVerbs === 'function') prefetchShellVerbs(item.path);
    });
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 選択内の「…」は右クリックと同様に複数選択を保ち、一括メニューへ渡す。
      if (!treeSelection.has(div)) {
        treeSelection.clear(); treeSelection.add(div); treeSelection.lastClicked = div;
        document.querySelectorAll('.tree-node-row.active').forEach(node => node.classList.remove('active'));
        row.classList.add('active');
      }
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
    // 仮想化中の親に属する行は、子孫も同じ論理モデルへ接続する。
    // 親コンテナ全件をDOM化せず、表示範囲＋オーバースキャンだけを維持する。
    const parentVirtualContainer = div.parentElement && div.parentElement.dataset && div.parentElement.dataset.virtual === 'true'
      ? div.parentElement : null;
    if (parentVirtualContainer) {
      childrenDiv._virtualOwnerContainer = parentVirtualContainer;
      childrenDiv._virtualParentPath = item.path;
    }
    if (_applyCachedBrowseItemType(item)) _syncOutlinerResolvedItemType(div, item);
    const currentIsFolder = item.type === 'folder';
    const currentIsDB = item.type === 'database';
    const currentIsForm = item.type === 'form-app';
    if (!currentIsFolder && !currentIsDB && !currentIsForm) {
      row.click();
      return;
    }
    const expanded = toggle.dataset.expanded === 'true';
    if (!expanded) {
      toggle.classList.add('expanded');
      toggle.dataset.expanded = 'true';
      // 作品フォルダ動的アイコン切替（icon-implementation-plan §D）
      if (currentIsFolder && !item.display_icon) {
        const iconEl = row.querySelector('.tree-icon');
        if (iconEl) {
          const isWork = isWorkFolder(item.path);
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
      window.GBOutlinerVirtualRender?.syncMountForVisibility(childrenDiv);
      if (parentVirtualContainer && window.GBOutlinerVirtualRender?.expandCachedNested(parentVirtualContainer, item.path)) {
        return;
      }

      // Lazy load children
      if (childrenDiv.dataset.loaded === 'false' && childrenDiv.dataset.loading !== 'true') {
        childrenDiv.dataset.loading = 'true';
        // スピナー表示
        const spinner = document.createElement('div');
        spinner.className = 'tree-spinner';
        spinner.innerHTML = '<span style="color:var(--fg2);font-size:11px;padding:4px 24px;">読み込み中...</span>';
        const spinnerTimer = setTimeout(() => {
          if (childrenDiv.isConnected && childrenDiv.dataset.loading === 'true') childrenDiv.appendChild(spinner);
        }, 150);
        const loadToken = {};
        childrenDiv._outlinerLoadToken = loadToken;
        let warmItems = [];
        try {
          if (currentIsForm) {
            const children = Array.isArray(item.children) ? item.children : [];
            await _appendOrVirtualizeOutlinerChildren(childrenDiv, children, rootPath, { folderItem: item, folderNode: div, kind: 'form-app' });
            warmItems = children;
          } else if (currentIsDB) {
            const pivotData = await apiFetch('/pivot?path=' + encodeURIComponent(item.path) + '&tree_only=true', { foreground: true });
            window.MeldexTopicPlacementUI?.projectSheetPivot?.(item.path, pivotData);
            const entityItems = _outlinerSheetTreeItems(item, pivotData);
            warmItems = entityItems;
            await _appendOrVirtualizeOutlinerChildren(childrenDiv, entityItems, rootPath, { folderItem: item, folderNode: div, kind: 'database' });
            _scheduleOutlinerSheetProjection(childrenDiv, item, pivotData, rootPath, loadToken);
          } else if (currentIsFolder) {
            const sortCfg = getSortForFolder(item.path);
            const serverSorts = new Set(['name', 'modified', 'created']);
            const apiSort = serverSorts.has(sortCfg.sort) ? sortCfg.sort : 'name';
            const needsClientSort = sortCfg.sort === 'manual' || !serverSorts.has(sortCfg.sort);
            const rootParam = rootPath ? '&root=' + encodeURIComponent(rootPath) : '';
            const sourceParam = item.sourceId ? '&sourceId=' + encodeURIComponent(item.sourceId) : '';
            const detailParam = needsClientSort && sortCfg.sort !== 'manual' ? '&detail=true' : '';
            // 子が多いフォルダは全件を取らず、ページごとに取って、見えている範囲が末尾へ近づいたら続きを取る
            const pagedChildren = await _outlinerLoadPagedFolderChildren(childrenDiv, item, div, rootPath, apiSort, sortCfg.order);
            if (pagedChildren) warmItems = [];
            else {
            const children = await apiFetch('/browse?path=' + encodeURIComponent(item.path) + '&sort=' + apiSort + '&order=' + sortCfg.order + rootParam + sourceParam + detailParam + '&all_files=true&form_hierarchy=true');
            const childList = Array.isArray(children) ? children : (Array.isArray(children?.items) ? children.items : []);
            let visibleChildren = childList.filter(child => !(typeof isOutlinerDeletePendingPath === 'function' && isOutlinerDeletePendingPath(child?.path)));
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
            warmItems = visibleChildren;
            }
          }
          delete childrenDiv.dataset.loadError;
          childrenDiv.dataset.loaded = 'true';
          _scheduleOutlinerChildWarmup(childrenDiv, warmItems, rootPath);
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
              if (!match && d.type !== 'folder' && d.type !== 'database' && d.type !== 'form-app' && !d._isRoot) {
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
          clearTimeout(spinnerTimer);
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
      if (currentIsFolder && !item.display_icon) {
        const iconEl = row.querySelector('.tree-icon');
        if (iconEl) {
          const isWork = isWorkFolder(item.path);
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
      window.MeldexVisibleSelection?.beginTree?.({ preserveTreeSelection: true });
      // Shift+クリック: 範囲選択（開かない）
      e.preventDefault();
      treeSelection.rangeTo(div);
      treeSelection.lastClicked = div;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      window.MeldexVisibleSelection?.beginTree?.({ preserveTreeSelection: true });
      // Ctrl+クリック: トグル選択（開かない）
      treeSelection.toggle(div);
      treeSelection.lastClicked = div;
      return;
    }

    if (e.detail < 2 && e.target.closest('.tree-label') === label && treeSelection.has(div)
        && window.GBOutlinerActivation?.startRenameForNode(div, label, item)) {
      e.stopPropagation();
      return;
    }

    // 通常クリック: 選択・フォーカス・オプションパネル対象の更新のみ
    window.MeldexVisibleSelection?.beginTree?.();
    window.GBOutlinerActivation?.selectNodeOnly(div, { focus: false });

    // open* 呼び出しが無くなったため、スクロール位置保護（pointerdown起点のガード）を念押し復元
    _treeScrollGuardRestore();

    // 設定「クリックで開く」が単クリックの場合: 選択に続けてそのまま開く。
    // フォルダも含め全項目種別に一貫して適用する（フォルダだけ例外にすると
    // 「なぜこれだけ2回押さないと開かないのか」という不整合が生じるため）。
    // activateNode は対応するビューを開く。フォルダのツリー展開状態は変えない。
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
    _cancelOutlinerDragExpand();
    clearDragIndicators();
    window.GBOutlinerVirtualRender?.clearDragExempt();
    draggedNode = null;
    draggedNodes = null;
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
  });

  row.addEventListener('dragover', (e) => {
    if (typeof _folderCanAcceptOsDrop === 'function' && _folderCanAcceptOsDrop(e, item)) {
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      clearDragIndicators(); row.classList.add('drag-over-inside');
      _scheduleOutlinerDragExpand(row, toggle, 'inside');
      return;
    }
    const topicMime = window.MeldexTopicPlacementUI?.MIME;
    if (topicMime && e.dataTransfer?.types?.includes(topicMime)) {
      if (item.type === 'database' || item.type === 'board') {
        e.preventDefault();
        e.dataTransfer.dropEffect = e.ctrlKey || e.metaKey ? 'copy' : 'move';
        clearDragIndicators();
        row.classList.add('drag-over-inside');
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!draggedNode) {
      const externalItems = _outlinerExternalDragItems(e);
      const bridgeCandidate = typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(e, 'node');
      const position = _outlinerRowDropPosition(e, row, item);
      const target = _outlinerRowDropTarget(div, item, position, rootPath);
      clearDragIndicators();
      if ((!externalItems.length && !bridgeCandidate) || !target || (e.altKey && position !== 'inside') || isItemLocked(target.path)
          || externalItems.some(source => source.type === 'entity' || source.linked || source.path === item.path
            || _treeNodeIsAncestor({ _nodeData: source }, { _nodeData: target }))) {
        e.dataTransfer.dropEffect = 'none';
        _cancelOutlinerDragExpand(row);
        return;
      }
      e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
      row.classList.add('drag-over-' + position);
      _scheduleOutlinerDragExpand(row, toggle, position);
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

    if (item._form_parent_path) {
      row.classList.add('drag-over-inside');
      _cancelOutlinerDragExpand(row);
      return;
    }

    const position = _outlinerRowDropPosition(e, row, item);
    row.classList.add('drag-over-' + position);
    _scheduleOutlinerDragExpand(row, toggle, position);
  });

  row.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && row.contains(e.relatedTarget)) return;
    row.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
    _cancelOutlinerDragExpand(row);
  });

  row.addEventListener('drop', async (e) => {
    _cancelOutlinerDragExpand();
    if (typeof _folderCanAcceptOsDrop === 'function' && _folderCanAcceptOsDrop(e, item)) {
      e.preventDefault(); e.stopPropagation(); clearDragIndicators();
      await _outlinerImportOsDropSafely(e, item);
      return;
    }
    const topicMime = window.MeldexTopicPlacementUI?.MIME;
    if (topicMime && e.dataTransfer?.types?.includes(topicMime)) {
      e.preventDefault();
      e.stopPropagation();
      clearDragIndicators();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!draggedNode) {
      const dropTransfer = typeof MeldexDnD !== 'undefined' && MeldexDnD.snapshotDataTransfer
        ? MeldexDnD.snapshotDataTransfer(e.dataTransfer)
        : e.dataTransfer;
      // Capture the indicated position before asynchronous payload resolution or
      // dragend clears the marker. The same geometry drives dragover and drop.
      const position = _outlinerRowDropPosition(e, row, item);
      const target = _outlinerRowDropTarget(div, item, position, rootPath);
      clearDragIndicators();
      if (!target || isItemLocked(target.path)) return;
      if (position === 'inside' && isDB && typeof MeldexSheetEntryAttachments !== 'undefined') {
        clearDragIndicators();
        const handled = await MeldexSheetEntryAttachments.intakeDropToSheet(item.path, e);
        if (handled > 0) return;
      }
      const resolved = typeof MeldexDnD !== 'undefined' ? await MeldexDnD.resolveDropData(dropTransfer, 'node') : null;
      const externalItems = _outlinerExternalDragItems({ dataTransfer: dropTransfer }, resolved?.payload).filter(source => {
        const sourcePath = String(source.path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        const targetPath = String(target.path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        return source.type !== 'entity' && !source.linked && sourcePath !== String(item.path || '').replace(/\\/g, '/').toLowerCase()
          && sourcePath !== targetPath && !targetPath.startsWith(sourcePath + '/');
      });
      clearDragIndicators();
      if (externalItems.length === 0) {
        if (resolved) MeldexDnD.failDrop(resolved);
        return;
      }
      const completed = e.altKey
        ? (position === 'inside' ? await _linkExternalItemsIntoOutlinerFolder(externalItems, item) : 0)
        : await _moveExternalItemsIntoOutlinerFolder(externalItems, target);
      if (resolved && completed > 0) MeldexDnD.completeDrop(resolved);
      else if (resolved) MeldexDnD.failDrop(resolved);
      return;
    }
    if ((draggedNodes || [draggedNode]).some(node => node?._nodeData?.type === 'entity')) {
      clearDragIndicators();
      showStatus('シートのトピックはフォルダツリー内へ移動できません');
      return;
    }
    // Ctrl+ドロップ: ツリー内移動を行わない（ペインで開く操作に委ねる）
    if (e.ctrlKey) { clearDragIndicators(); return; }
    if (!draggedNode || draggedNode === div) return;
    const nodes = (draggedNodes || [draggedNode])
      .filter(n => n !== div && !_treeNodeIsAncestor(n, div) && !n._nodeData?._isRoot && !(n._nodeData?.path && isItemLocked(n._nodeData.path)));
    if (nodes.length === 0) {
      // 断った理由を出す（マニュアル: ドロップできない時は理由がステータス表示される。以前は何も出なかった: 2026-11-22 M-014）
      clearDragIndicators();
      const all = draggedNodes || [draggedNode];
      const reason = all.some(n => n === div || _treeNodeIsAncestor(n, div)) ? 'フォルダをそれ自身の中へは移動できません'
        : all.some(n => n._nodeData?._isRoot) ? 'ソースフォルダそのものは移動できません'
          : all.some(n => n._nodeData?.path && isItemLocked(n._nodeData.path)) ? '編集ロック中の項目は移動できません'
            : '移動できる項目がありません';
      showStatus(reason, true);
      return;
    }
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
      } catch (error) {
        showStatus('リンク登録に失敗しました' + (error?.userMessage || error?.message ? '：' + (error.userMessage || error.message) : ''), true);
      }
      clearDragIndicators();
      // リンクを置いたフォルダだけを差分で反映する（全体の読み直しをしない）
      await _outlinerSyncFoldersOrReload([item.path]);
      return;
    }

    const position = row.classList.contains('drag-over-above') ? 'above'
      : row.classList.contains('drag-over-inside') ? 'inside'
      : 'below';
    clearDragIndicators();

    if (item._form_parent_path && position !== 'inside') {
      showStatus('このシートの中、または移動先のフォルダへドロップしてください');
      return;
    }

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
