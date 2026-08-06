/**
 * gb-outliner-virtual-render.js
 *
 * フォルダツリーの大量項目向け仮想スクロール DOM 統合レイヤー。
 * gb-outliner-virtual.js（純粋計算エンジン）を使い、既定のしきい値（VIRTUAL_THRESHOLD件）を
 * 超える子項目を持つフォルダ／シートの子コンテナ（.tree-children）を、表示範囲＋
 * オーバースキャン分だけ実DOM化する。行の生成自体は既存の createTreeNodeFromBrowse を
 * そのまま再利用するため、クリック／ダブルクリック／右クリック／ドラッグ等の挙動は
 * 変更せずに継承する（本モジュールが持つのは「どの範囲を実DOM化するか」の管理のみ）。
 *
 * 計画: app/docs/folder-tree-thumbnail-large-branch-interaction-plan-2026-07-31.md
 *       §2.3-4（仮想スクロール）、§2.5（矩形選択・ドラッグとの両立）、§4.1-3
 *
 * スコープ上の重要な設計判断:
 * - 仮想化は「大量の直下項目」を起点にするが、その中で展開したフォルダ／シートの子孫も
 *   同じ論理モデルへ接続する。親の全項目をDOM化せず、深さ・22/50px行高を含むDFSリストを
 *   表示範囲＋オーバースキャンだけ実DOM化する。
 * - 選択状態は安定ID（パス）を正本とし、DOM要素ベースの treeSelection とは
 *   _syncVirtualSelectedId() で同期する（treeSelection.add/remove/clear をラップ）。
 *
 * 依存（実行時に参照する既存グローバル。読み込み順は gb-outliner.js より後であること）:
 *   GBOutlinerVirtual, treeSelection, createTreeNodeFromBrowse, _appendOutlinerChildrenChunked,
 *   _unregisterTreeSubtree, _registerFileIds, registerFileTypes, _registerOutlinerConflictPaths,
 *   isOutlinerDeletePendingPath, getSortForFolder, setSortSetting, setManualOrder,
 *   apiFetch, showStatus, _isGlobalFilterEnabled, _hasAllGlobalTypesSelected, _globalFilter,
 *   _showDatabaseByGlobalFilter, _showEntityByGlobalFilter, _showRegularNodeByGlobalFilter,
 *   _treeSearchQuery, _getTreeSearchIncludeEntities
 */
(function () {
  'use strict';

  var VIRTUAL_THRESHOLD = 150; // これ未満は従来通り全件DOM化（既存の小規模フォルダ／テストに影響を与えない）
  var OVERSCAN_ROWS = 6; // 大きすぎるとスクロール毎の再マウント件数が増え、50ms超のロングタスクを招く（§7）

  /** @type {Set<HTMLElement>} 現在アクティブな仮想化コンテナ（.tree-children[data-virtual="true"]） */
  var _activeContainers = new Set();
  /** @type {Map<string, {childrenDiv: HTMLElement}>} パス → 所属コンテナの逆引き（unmount後も残す） */
  var _pathToContainer = new Map();
  /** スクロール毎に呼ばれるサブスクライバ（固定祖先バー等が購読する） */
  var _scrollTickSubscribers = [];
  var _scrollTickScheduled = false;
  var _scrollListenerBound = false;
  var _viewportTickScheduled = false;
  var _viewportListenerBound = false;
  /** ドラッグ中の行は仮想化のアンマウント対象から除外する（HTML5ドラッグの継続性を守るため） */
  var _dragExemptPath = null;

  function _engine() { return window.GBOutlinerVirtual; }

  function _scroller() { return document.getElementById('tree-scroll-container'); }

  function _compactRowHeight(engine) {
    var body = document.body;
    var mobileLayout = !!(body && body.dataset && body.dataset.cloudMobile === '1' &&
      (body.dataset.cloudMode === 'dropbox' || body.dataset.mobileUiLocal === '1'));
    var coarseOrNarrow = typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
    return mobileLayout && coarseOrNarrow ? 44 : engine.ROW_HEIGHT_COMPACT;
  }

  // ------------------------------------------------------------
  // フィルタ述語（既存の gb-outliner-search.*.js のグローバル関数を再利用する）
  // ------------------------------------------------------------
  function _itemPassesFilters(item) {
    if (!item) return false;
    // グローバル種別フィルタ
    if (typeof _isGlobalFilterEnabled === 'function' && _isGlobalFilterEnabled()) {
      if (item.type === 'database') {
        if (typeof _showDatabaseByGlobalFilter === 'function' && !_showDatabaseByGlobalFilter()) return false;
      } else if (item.type === 'entity') {
        if (typeof _showEntityByGlobalFilter === 'function' && !_showEntityByGlobalFilter()) return false;
      } else if (item.type !== 'folder') {
        if (typeof _showRegularNodeByGlobalFilter === 'function' && !_showRegularNodeByGlobalFilter(item)) return false;
      }
    }
    // 名前検索
    var q = '';
    try { q = typeof _treeSearchQuery !== 'undefined' ? _treeSearchQuery : ''; } catch (e) { q = ''; }
    if (q) {
      if (item.type === 'entity') {
        var includeEntities = typeof _getTreeSearchIncludeEntities === 'function'
          ? _getTreeSearchIncludeEntities()
          : (localStorage.getItem('tree-search-include-entities') === 'true');
        if (!includeEntities) return false;
        if (!(item.name && item.name.toLowerCase().includes(q))) return false;
      } else if (!(item.name && item.name.toLowerCase().includes(q))) {
        return false;
      }
    }
    return true;
  }

  function _computeEffectiveItems(state) {
    return (state.allItems || []).filter(_itemPassesFilters);
  }

  // 名前検索併用時のバグ修正: _itemPassesFilters は各アイテム自身の名前一致のみで判定するため、
  // 「自分の名前は一致しないが子孫に一致がある」フォルダ/シートがflatモデルから丸ごと除外されて
  // しまう（非仮想DOM側のapplyTreeNameSearchは祖先フォルダを_searchAncestorフラグで別途救って
  // いるが、仮想化ブランチは常にフラットマウントのためこの経路を持たない）。検索語がある時だけ、
  // 既に読み込み済みの子孫（state.childrenByParentにキャッシュ済みのもの。非仮想側が
  // 「一度でも展開されてDOMに載ったことのある内容だけを検索対象にする」のと同じ範囲）を
  // 辿って一致を含むフォルダパスを洗い出す。
  function _searchMatchesItem(item) {
    if (!item) return false;
    var q = '';
    try { q = typeof _treeSearchQuery !== 'undefined' ? _treeSearchQuery : ''; } catch (e) { q = ''; }
    if (!q) return true;
    if (item.type === 'entity') {
      var includeEntities = typeof _getTreeSearchIncludeEntities === 'function'
        ? _getTreeSearchIncludeEntities()
        : (localStorage.getItem('tree-search-include-entities') === 'true');
      return includeEntities && !!(item.name && item.name.toLowerCase().includes(q));
    }
    return !!(item.name && item.name.toLowerCase().includes(q));
  }

  function _collectSearchAncestorPaths(state) {
    var q = '';
    try { q = typeof _treeSearchQuery !== 'undefined' ? _treeSearchQuery : ''; } catch (e) { q = ''; }
    var result = new Set();
    if (!q) return result;
    var seen = new Set();
    function walk(items) {
      var anyMatch = false;
      (items || []).forEach(function (item) {
        if (!item || !item.path || seen.has(item.path)) return;
        seen.add(item.path);
        var childItems = state.childrenByParent && state.childrenByParent.get(item.path);
        var childHasMatch = childItems ? walk(childItems) : false;
        if (childHasMatch) result.add(item.path);
        if (childHasMatch || _searchMatchesItem(item)) anyMatch = true;
      });
      return anyMatch;
    }
    walk(state.allItems);
    return result;
  }

  function _childrenFor(state, parentPath) {
    return state.childrenByParent && state.childrenByParent.get(parentPath) || [];
  }

  function _siblingListFor(state, parentPath) {
    return parentPath ? _childrenFor(state, parentPath) : state.allItems;
  }

  function _removePathsFromAllLists(state, paths) {
    var removed = [];
    function withoutMoved(items) {
      return items.filter(function (item) {
        if (!item || !item.path || !paths.has(item.path)) return true;
        removed.push(item);
        return false;
      });
    }
    state.allItems = withoutMoved(state.allItems);
    if (state.childrenByParent) {
      state.childrenByParent.forEach(function (items, parentPath) {
        state.childrenByParent.set(parentPath, withoutMoved(items));
      });
    }
    return removed;
  }

  function _deleteCachedBranch(state, parentPath) {
    _childrenFor(state, parentPath).forEach(function (child) {
      if (!child || !child.path) return;
      _deleteCachedBranch(state, child.path);
      _pathToContainer.delete(child.path);
      if (state.heightsByPath) state.heightsByPath.delete(child.path);
      if (state.selectedIds) state.selectedIds.remove(child.path);
      if (state.expandedIds) state.expandedIds.delete(child.path);
    });
    if (state.childrenByParent) state.childrenByParent.delete(parentPath);
  }

  function depthLineLocalOffsets(depth) {
    var offsets = [];
    for (var level = 0; level < depth; level++) {
      offsets.push(7 - (depth - 1) * 14 + level * 14);
    }
    return offsets;
  }

  function _appendDepthLines(rowEl, depth) {
    rowEl.dataset.gbVirtualDepth = String(depth);
    depthLineLocalOffsets(depth).forEach(function (left) {
      var line = document.createElement('span');
      line.className = 'tree-virtual-depth-line';
      line.setAttribute('aria-hidden', 'true');
      line.style.cssText = 'position:absolute;top:0;bottom:0;left:' + left +
        'px;width:1px;background:var(--outliner-border,var(--border));opacity:.6;pointer-events:none;';
      rowEl.appendChild(line);
    });
  }

  // ------------------------------------------------------------
  // treeSelection モンキーパッチ（安定IDシャドウとの同期。1回だけ適用）
  // ------------------------------------------------------------
  function _syncVirtualSelectedId(nodeEl, selected) {
    var path = nodeEl && nodeEl._nodeData && nodeEl._nodeData.path;
    if (!path) return;
    var entry = _pathToContainer.get(path);
    if (!entry || !entry.state || !entry.state.selectedIds) return;
    if (selected) entry.state.selectedIds.add(path);
    else entry.state.selectedIds.remove(path);
  }

  function _patchTreeSelectionOnce() {
    if (typeof treeSelection === 'undefined' || !treeSelection || treeSelection.__gbVirtualPatched) return;
    var origAdd = treeSelection.add.bind(treeSelection);
    var origRemove = treeSelection.remove.bind(treeSelection);
    var origClear = treeSelection.clear.bind(treeSelection);
    treeSelection.add = function (nodeEl) {
      origAdd(nodeEl);
      _syncVirtualSelectedId(nodeEl, true);
    };
    treeSelection.remove = function (nodeEl) {
      origRemove(nodeEl);
      _syncVirtualSelectedId(nodeEl, false);
    };
    treeSelection.clear = function () {
      _activeContainers.forEach(function (cd) {
        if (cd._virtualState && cd._virtualState.selectedIds) cd._virtualState.selectedIds.clear();
      });
      origClear();
    };
    treeSelection.__gbVirtualPatched = true;
  }

  // ------------------------------------------------------------
  // マウント／アンマウント
  // ------------------------------------------------------------
  // path(安定ID)→行高(px)の永続Map。検索/フィルタ/D&Dによるrefresh()やmount()直後の
  // 再構築のたびにモデル(state.flat)を作り直すが、ここに記録済みの行高があれば
  // それを引き継ぐ。持たないと、サムネイル取得成功による50pxへの昇格
  // (updateRowHeightが記録)がrefresh()のたびにROW_HEIGHT_COMPACT(22px)へ巻き戻り、
  // 累積オフセットがずれてスクロール位置と表示内容が食い違うバグになる。
  function _rebuildModel(state) {
    var engine = _engine();
    var compactHeight = _compactRowHeight(engine);
    state.compactRowHeight = compactHeight;
    state.effectiveItems = _computeEffectiveItems(state);
    var heights = state.heightsByPath;
    // 検索語がある時だけ「子孫に一致を含むフォルダ」を洗い出し、そのフォルダ自身の名前一致
    // 判定に関わらず通過・展開させる（このファイル上部のコメント参照）。空Setなら以降の
    // 判定は既存どおり_itemPassesFilters単体に一致する。
    var searchAncestorPaths = _collectSearchAncestorPaths(state);
    if (searchAncestorPaths.size && state.expandedIds) {
      searchAncestorPaths.forEach(function (path) {
        if (state.expandedIds.has(path)) return;
        state.expandedIds.add(path);
        if (typeof saveExpandedState === 'function') saveExpandedState(path, true);
      });
    }
    var flat = [];
    function append(item, parentId, depth) {
      if (!_itemPassesFilters(item) && !searchAncestorPaths.has(item.path)) return;
      var known = heights && item && item.path && heights.has(item.path) ? heights.get(item.path) : null;
      flat.push({
        id: item.path,
        parentId: parentId,
        depth: depth,
        height: known || compactHeight,
        data: item,
      });
      if (!state.expandedIds || !state.expandedIds.has(item.path)) return;
      _childrenFor(state, item.path).forEach(function (child) {
        append(child, item.path, depth + 1);
      });
    }
    state.allItems.forEach(function (item) { append(item, null, 0); });
    state.flat = flat;
    var built = engine.buildOffsets(flat);
    state.offsets = built.offsets;
    state.totalHeight = built.totalHeight;
  }

  // 仮想化管理下の「読み込み済みの子項目一覧」への読み取り専用アクセサ。
  // childrenDivは対象フォルダ/シート自身の内部.tree-children（トップ仮想オーナーなら
  // dataset.virtual==='true'、ネスト行ならmountRowが設定する_virtualOwnerContainer経由で
  // 実オーナーへ解決する）。戻り値:
  //   配列       … 読み込み済み（呼び出し側で自由に読める。ミューテーションしないこと）
  //   null       … 仮想化管理下だが未読込（展開されたことがない=不明）
  //   undefined  … そもそも仮想化管理下ではない
  // フィルタ表示異常 症状b「フォルダ自体が非表示になる」の修正
  // （gb-outliner-search.part01.part01.js の _folderHasFilterVisibleDescendant）から使う。
  function stateChildItemsFor(childrenDiv, path) {
    var owner = _resolvedVirtualContainer(childrenDiv);
    var state = owner && owner._virtualState;
    if (!state) return undefined;
    if (state.folderItem && state.folderItem.path === path) return (state.allItems || []).slice();
    if (state.childrenByParent && state.childrenByParent.has(path)) return state.childrenByParent.get(path).slice();
    return null;
  }

  function mount(childrenDiv, items, rootPath, meta) {
    var engine = _engine();
    if (!engine || !childrenDiv || !Array.isArray(items)) return false;
    if (items.length < VIRTUAL_THRESHOLD) return false;

    _patchTreeSelectionOnce();

    var state = {
      allItems: items.slice(),
      effectiveItems: items,
      rootPath: rootPath || '',
      folderItem: (meta && meta.folderItem) || null,
      folderNode: (meta && meta.folderNode) || null,
      flat: [],
      offsets: [0],
      totalHeight: 0,
      mountedByIndex: new Map(),
      mountedById: new Map(),
      selectedIds: engine.createStableIdSet(),
      heightsByPath: new Map(), // 昇格済み行高(50px等)の永続記録。_rebuildModelが再構築のたびに参照する
      childrenByParent: new Map(),
      expandedIds: new Set(),
      rangeStart: 0,
      rangeEnd: 0,
    };
    childrenDiv._virtualState = state;
    childrenDiv.dataset.virtual = 'true';
    childrenDiv.style.position = 'relative';
    childrenDiv.style.display = 'block';

    items.forEach(function (item) {
      if (item && item.path) _pathToContainer.set(item.path, { childrenDiv: childrenDiv, state: state });
    });

    _rebuildModel(state);
    childrenDiv.style.height = state.totalHeight + 'px';
    _activeContainers.add(childrenDiv);
    _ensureScrollListener();
    _ensureViewportListener();
    _remountVisible(childrenDiv);
    return true;
  }

  // CSS zoom（document.documentElement.style.zoom）はgetBoundingClientRect/scrollTop等の
  // 実測値をズーム後の物理px単位で返すが、state.offsets（累積行高）はROW_HEIGHT_COMPACT等の
  // 論理px単位で作られている。実測値どうしの差分計算はズーム後px同士で一貫しているため
  // そのままでよいが、offsetsと比較する直前に必ずズーム係数で割って論理pxへ揃える
  // （プロジェクト共通ルール: getBoundingClientRect()/e.clientX,Yはstyle.left/topへ入れる際に
  // 必ず_getZoom()で割る、と同じ理由）。
  function _zoomFactor() {
    return typeof _getZoom === 'function' ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
  }

  function _localRangeFor(childrenDiv) {
    var scroller = _scroller();
    if (!scroller || !childrenDiv.isConnected) return null;
    // 折りたたみ中（自身または祖先が .collapsed）は非表示のため、マウント範囲ゼロとして扱う。
    // state（allItems等）は保持したままなので、再展開時は再フェッチ無しでそのまま再マウントできる。
    if (childrenDiv.closest('.collapsed')) return { top: 0, height: 0, farAway: true };
    var spacerRect = childrenDiv.getBoundingClientRect();
    var scrollerRect = scroller.getBoundingClientRect();
    if (spacerRect.bottom < scrollerRect.top - 400 || spacerRect.top > scrollerRect.bottom + 400) {
      // 表示範囲から大きく離れている: マウント範囲ゼロとして扱う
      return { top: 0, height: 0, farAway: true };
    }
    var zoom = _zoomFactor();
    var localTop = Math.max(0, (scrollerRect.top - spacerRect.top) / zoom);
    var visibleBottom = Math.min(spacerRect.height / zoom, (scrollerRect.bottom - spacerRect.top) / zoom);
    var height = Math.max(0, visibleBottom - localTop);
    return { top: localTop, height: height, farAway: false };
  }

  function _remountVisible(childrenDiv) {
    var state = childrenDiv._virtualState;
    var engine = _engine();
    if (!state || !engine) return;
    var local = _localRangeFor(childrenDiv);
    var range = local && !local.farAway
      ? engine.computeVisibleRange({ offsets: state.offsets, scrollTop: local.top, viewportHeight: local.height, overscan: OVERSCAN_ROWS })
      : { start: 0, end: 0 };
    state.rangeStart = range.start;
    state.rangeEnd = range.end;

    // 範囲外を先にアンマウント（ドラッグ中の元行は除外）
    state.mountedByIndex.forEach(function (rowEl, index) {
      if (index >= range.start && index < range.end) return;
      var item = state.flat[index] && state.flat[index].data;
      if (item && item.path && item.path === _dragExemptPath) return;
      _unmountRow(state, index);
    });
    // 範囲内を必要な分だけマウント
    for (var i = range.start; i < range.end; i++) {
      if (state.mountedByIndex.has(i)) continue;
      _mountRow(childrenDiv, state, i);
    }
  }

  function _mountRow(childrenDiv, state, index) {
    var entry = state.flat[index];
    if (!entry) return;
    var item = entry.data;
    var managesExpansion = state.childrenByParent && state.childrenByParent.has(item.path);
    if (managesExpansion) item._gbVirtualExpansionManaged = true;
    var rowEl = createTreeNodeFromBrowse(item, state.rootPath);
    if (managesExpansion) delete item._gbVirtualExpansionManaged;
    rowEl.style.position = 'absolute';
    rowEl.style.top = state.offsets[index] + 'px';
    rowEl.style.left = (entry.depth * 14) + 'px';
    rowEl.style.right = '0';
    rowEl.dataset.gbVirtualIndex = String(index);
    _appendDepthLines(rowEl, entry.depth);
    childrenDiv.appendChild(rowEl);
    state.mountedByIndex.set(index, rowEl);
    if (item.path) state.mountedById.set(item.path, rowEl);
    if (managesExpansion) {
      var expanded = state.expandedIds.has(item.path);
      var toggle = rowEl.querySelector(':scope > .tree-node-row .tree-toggle');
      var nestedChildren = rowEl.querySelector(':scope > .tree-children');
      if (toggle) {
        toggle.dataset.expanded = expanded ? 'true' : 'false';
        toggle.classList.toggle('expanded', expanded);
      }
      if (nestedChildren) {
        nestedChildren.dataset.loaded = 'true';
        nestedChildren.classList.toggle('collapsed', !expanded);
        nestedChildren._virtualOwnerContainer = childrenDiv;
        nestedChildren._virtualParentPath = item.path;
      }
      if (expanded && item.type === 'folder') {
        var iconEl = rowEl.querySelector(':scope > .tree-node-row .tree-icon');
        if (iconEl && typeof lucide === 'function') {
          var isWork = typeof getWorkFolder === 'function' && item.path === getWorkFolder();
          iconEl.innerHTML = lucide(isWork ? 'folderOpenDot' : 'folderOpen', 18);
          if (item.linked) iconEl.innerHTML += '<span style="position:relative;top:-4px;left:-2px;">' + lucide('externalLink', 8) + '</span>';
        }
      }
    }
    if (item.path && state.selectedIds.has(item.path) && typeof treeSelection !== 'undefined') {
      treeSelection.add(rowEl);
    }
  }

  function _unmountRow(state, index) {
    var rowEl = state.mountedByIndex.get(index);
    if (!rowEl) return;
    var item = state.flat[index] && state.flat[index].data;
    if (typeof treeSelection !== 'undefined' && treeSelection.has && treeSelection.has(rowEl)) {
      // 安定IDシャドウは保持したまま、DOM要素だけをtreeSelectionから外す
      var keepPath = item && item.path;
      treeSelection.remove(rowEl);
      if (keepPath) state.selectedIds.add(keepPath); // removeのモンキーパッチが消すため直後に戻す
    }
    if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(rowEl);
    // フォルダツリー改修Phase4: 未開始のサムネイル/形式アイコン取得を後始末してから破棄する
    if (window.GBOutlinerThumbnails) {
      var innerRow = rowEl.querySelector(':scope > .tree-node-row');
      if (innerRow) window.GBOutlinerThumbnails.detachRow(innerRow);
    }
    rowEl.remove();
    state.mountedByIndex.delete(index);
    if (item && item.path) state.mountedById.delete(item.path);
  }

  function unmountContainer(childrenDiv) {
    var state = childrenDiv && childrenDiv._virtualState;
    if (!state) return;
    state.mountedByIndex.forEach(function (rowEl, index) { _unmountRow(state, index); });
    _activeContainers.delete(childrenDiv);
    childrenDiv.style.height = '';
    childrenDiv.style.position = '';
    delete childrenDiv.dataset.virtual;
    delete childrenDiv._virtualState;
  }

  // 検索/絞り込み/D&Dなどでモデルを丸ごと作り直す。行高は_rebuildModelがheightsByPath経由で
  // 引き継ぐため、対象自体が変わらない限りoffsetsは再構築前後で一致するが、フィルタ/削除/追加で
  // 可視範囲より上にある項目の件数・高さが変わると、素朴に作り直すだけではscrollTopの指す
  // 論理位置がずれ、画面内容が無関係な位置へジャンプして見える。これを防ぐため、再構築前の
  // 可視範囲の先頭項目(rangeStartが指す項目)を安定パスで覚えておき、再構築後に同じ項目の
  // 新しい累積オフセットとの差分だけscrollTopを補正する（可視範囲上方の高さ合計差分の補正）。
  // 対象項目自体が消えた(フィルタで除外された等)場合は補正せず、そのままの位置で構わない。
  function refresh(childrenDiv) {
    var state = childrenDiv && childrenDiv._virtualState;
    var engine = _engine();
    if (!state || !engine) return;
    var scroller = _scroller();
    // アンカー（現在の表示範囲先頭項目）でスクロール位置を維持する。フィルタ変更で
    // アンカー自身が新モデルから除外される（例: 表示中の画像ファイルをフィルタでOFFにした）
    // ケースでは、旧実装は「見つからなければ補正しない」だったため、スクロール位置は
    // そのまま・裏側のモデルだけ丸ごと入れ替わり、たまたま同じオフセットに来た無関係な
    // 項目（別フォルダの内容等）が画面上に表示されてしまっていた（フィルタ表示異常
    // 症状a「次のフォルダが展開されてその中のファイルが表示されたように見える」の一因）。
    // アンカー自身が消える場合は、rebuild前のflat上でアンカーより後方へ順に探索し、
    // 新モデルでも生き残る最初の項目を代替アンカーとして使う。
    var beforeFlat = state.flat;
    var anchorIndex = state.rangeStart;
    var anchorPath = null;
    var beforeOffset = 0;
    for (var i = anchorIndex; i < beforeFlat.length; i++) {
      var candidate = beforeFlat[i] && beforeFlat[i].data;
      var candidatePath = candidate && candidate.path;
      if (candidatePath && _itemPassesFilters(candidate)) {
        anchorPath = candidatePath;
        beforeOffset = state.offsets[i] || 0;
        break;
      }
    }

    var previouslyMounted = new Map(state.mountedByIndex);
    previouslyMounted.forEach(function (rowEl, index) { _unmountRow(state, index); });
    _rebuildModel(state);
    childrenDiv.style.height = state.totalHeight + 'px';

    if (scroller && anchorPath) {
      var newIndex = state.flat.findIndex(function (entry) { return entry.id === anchorPath; });
      if (newIndex >= 0) {
        var afterOffset = state.offsets[newIndex] || 0;
        var delta = afterOffset - beforeOffset;
        if (delta) scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
      }
    }
    _remountVisible(childrenDiv);
  }

  // フォルダツリー改修Phase4: サムネイル取得成功による行高昇格（22px→50px）を仮想モデルへ
  // 反映する。累積オフセットを再計算し、マウント済み行のtopを再配置する。変更行が現在の
  // 表示範囲より上（rangeStartより手前）の場合だけscrollTopを差分補正し、
  // 「行高変更時にスクロール位置が跳ねない」契約を満たす（表示範囲内/下方の変更は
  // 画面上の見た目を動かさないため補正不要）。
  // nodeEl: createTreeNodeFromBrowse が返す .tree-node 要素（.tree-node-row の親）。
  function updateRowHeight(nodeEl, newHeight) {
    var childrenDiv = nodeEl && nodeEl.parentElement;
    var state = childrenDiv && childrenDiv._virtualState;
    var engine = _engine();
    if (!state || !engine) return false;
    var index = Number(nodeEl.dataset.gbVirtualIndex);
    var entry = state.flat[index];
    if (!entry || entry.data !== nodeEl._nodeData) return false; // 別行に再利用済み（仮想化の行再生成）
    var oldHeight = entry.height;
    var delta = Number(newHeight) - oldHeight;
    if (!delta) return true;
    entry.height = newHeight;
    if (!state.heightsByPath) state.heightsByPath = new Map(); // 念のための防御(mount経由以外からの呼び出し向け)
    if (entry.id) state.heightsByPath.set(entry.id, newHeight);
    var built = engine.buildOffsets(state.flat);
    state.offsets = built.offsets;
    state.totalHeight = built.totalHeight;
    childrenDiv.style.height = state.totalHeight + 'px';
    // マウント済みの行だけ位置を再計算する（表示範囲＋オーバースキャン分のみ。全件走査ではない）
    state.mountedByIndex.forEach(function (el, idx) {
      el.style.top = state.offsets[idx] + 'px';
    });
    if (index < state.rangeStart) {
      var scroller = _scroller();
      if (scroller) scroller.scrollTop += delta;
    }
    return true;
  }

  // path(安定ID)から、その項目が属する仮想化コンテナ(.tree-children)を逆引きする。
  // gb-outliner.part03.js の矢印キー上下・gb-outliner.part01.part01.js のShift範囲選択が、
  // 選択中の行がスクロールでアンマウント済み（DOM当たり判定で見つからない）場合に、
  // 安定パス経由で所属コンテナと論理モデル(state)を復元するために使う。
  function containerForPath(path) {
    var entry = path && _pathToContainer.get(path);
    return (entry && entry.childrenDiv) || null;
  }

  // 指定した論理行(index)が現在マウントされていなければ、その行が可視範囲に入るよう
  // スクロール位置を補正してから即座に再マウントする。マウント済みならそのまま返す。
  // 矢印キー上下で「表示範囲＋オーバースキャン分しかDOMに無いため、マウント末尾で
  // クランプされてそれ以上進めない」問題を解消するために使う
  // (呼び出し元: gb-outliner.part03.js _outlinerKeyboardTryVirtualStep)。
  function ensureLogicalIndexMounted(childrenDiv, index) {
    var state = childrenDiv && childrenDiv._virtualState;
    if (!state || index == null || index < 0 || index >= state.flat.length) return null;
    var mounted = state.mountedByIndex.get(index);
    if (mounted) return mounted;
    var scroller = _scroller();
    if (!scroller || !childrenDiv.isConnected || childrenDiv.closest('.collapsed')) return null;

    var spacerRect = childrenDiv.getBoundingClientRect();
    var scrollerRect = scroller.getBoundingClientRect();
    var zoom = _zoomFactor();
    // childrenDivの上端がドキュメント座標(scrollTop基準・論理px)でどこにあるか
    // (_localRangeFor/applyLassoSelectionと同じ変換。CSS zoom下ではgetBoundingClientRect/
    // scrollTopが物理pxを返すため、論理px単位のstate.offsetsと比較する前に必ずzoomで割る)。
    var containerLocalTop = ((spacerRect.top - scrollerRect.top) + scroller.scrollTop) / zoom;
    var rowTop = state.offsets[index];
    var rowHeight = state.offsets[index + 1] - rowTop;
    var viewportHeight = scroller.clientHeight / zoom;
    // 対象行をビューポート中央付近へ置く（端ぎりぎりだと次のキー操作で即座にまた
    // 境界へ達してしまうため、ある程度の余裕を残す）。
    var targetLogicalTop = containerLocalTop + rowTop - Math.max(0, (viewportHeight - rowHeight) / 2);
    scroller.scrollTop = Math.max(0, targetLogicalTop * zoom);
    scroller.dispatchEvent(new Event('scroll'));
    forceRefreshVisible();
    return state.mountedByIndex.get(index) || null;
  }

  function refreshAllFilters() {
    _activeContainers.forEach(function (childrenDiv) {
      if (childrenDiv.isConnected) refresh(childrenDiv);
    });
  }

  // 仮想行の子コンテナへ遅延取得結果を接続する。親の全項目をDOM化せず、
  // 同じstate.flatへ子孫を挿入して表示範囲だけを再マウントする。
  function attachNested(childrenDiv, items) {
    var owner = _resolvedVirtualContainer(childrenDiv)
      || (childrenDiv && childrenDiv.parentElement && childrenDiv.parentElement.parentElement);
    var state = owner && owner._virtualState;
    var parentItem = childrenDiv && childrenDiv.parentElement && childrenDiv.parentElement._nodeData;
    var parentPath = childrenDiv && childrenDiv._virtualParentPath || (parentItem && parentItem.path);
    if (!state || !parentPath || !Array.isArray(items)) return false;
    state.childrenByParent.set(parentPath, items.slice());
    state.expandedIds.add(parentPath);
    items.forEach(function (item) {
      if (item && item.path) _pathToContainer.set(item.path, { childrenDiv: owner, state: state });
    });
    refresh(owner);
    return true;
  }

  function expandCachedNested(childrenDiv, parentPath) {
    var state = childrenDiv && childrenDiv._virtualState;
    if (!state || !state.childrenByParent || !state.childrenByParent.has(parentPath)) return false;
    state.expandedIds.add(parentPath);
    refresh(childrenDiv);
    return true;
  }

  function collapseNested(childrenDiv, parentPath) {
    var state = childrenDiv && childrenDiv._virtualState;
    if (!state || !state.childrenByParent || !state.childrenByParent.has(parentPath)) return false;
    state.expandedIds.delete(parentPath);
    refresh(childrenDiv);
    return true;
  }

  function _resolvedVirtualContainer(childrenDiv) {
    if (childrenDiv && childrenDiv._virtualState) return childrenDiv;
    return childrenDiv && childrenDiv._virtualOwnerContainer || null;
  }

  function isVirtualContainer(childrenDiv) {
    return !!_resolvedVirtualContainer(childrenDiv);
  }

  // ------------------------------------------------------------
  // ドラッグ&ドロップとの両立（データ配列側での並べ替え・追加）
  // ------------------------------------------------------------
  function setDragExempt(path) { _dragExemptPath = path || null; }
  function clearDragExempt() { _dragExemptPath = null; }

  // 別コンテナへ移動した項目を、移動元の仮想化配列・マウント状態・DOMからまとめて取り除く。
  // ドラッグ&ドロップで「移動元が仮想化コンテナだった」場合に呼ばれる（gb-outliner.part01.part02.js）。
  function removeFromContainer(childrenDiv, path) {
    var owner = _resolvedVirtualContainer(childrenDiv);
    var state = owner && owner._virtualState;
    if (!state || !path) return false;
    _deleteCachedBranch(state, path);
    state.allItems = state.allItems.filter(function (it) { return it.path !== path; });
    state.childrenByParent.forEach(function (items, parentPath) {
      state.childrenByParent.set(parentPath, items.filter(function (it) { return it.path !== path; }));
    });
    state.selectedIds.remove(path);
    if (state.heightsByPath) state.heightsByPath.delete(path); // 移動元に残る昇格記録を残さない
    _pathToContainer.delete(path);
    refresh(owner);
    return true;
  }

  function parentPathForItem(childrenDiv, path) {
    var owner = _resolvedVirtualContainer(childrenDiv);
    var state = owner && owner._virtualState;
    if (!state) return undefined;
    var entry = state.flat.find(function (candidate) { return candidate.id === path; });
    return entry ? entry.parentId : undefined;
  }

  function renamePath(oldPath, newPath, newName, fileId) {
    if (!oldPath || !newPath || oldPath === newPath) return false;
    var oldPrefix = oldPath + '/';
    var containers = new Set(_activeContainers);
    var mapped = _pathToContainer.get(oldPath);
    if (mapped && mapped.childrenDiv) containers.add(mapped.childrenDiv);
    _pathToContainer.delete(oldPath);
    containers.forEach(function (childrenDiv) {
      var state = childrenDiv._virtualState;
      if (!state) return;
      if (state.heightsByPath && state.heightsByPath.has(oldPath)) {
        state.heightsByPath.set(newPath, state.heightsByPath.get(oldPath));
        state.heightsByPath.delete(oldPath);
      }
      if (state.selectedIds && state.selectedIds.has(oldPath)) {
        state.selectedIds.remove(oldPath);
        state.selectedIds.add(newPath);
      }
      if (state.expandedIds && state.expandedIds.has(oldPath)) {
        state.expandedIds.delete(oldPath);
        state.expandedIds.add(newPath);
      }
      var seen = new Set();
      function rewriteItem(item) {
        if (!item || !item.path || seen.has(item)) return;
        seen.add(item);
        var previous = item.path;
        var alreadyRenamedRoot = previous === newPath;
        if (!alreadyRenamedRoot && previous !== oldPath && !previous.startsWith(oldPrefix)) return;
        item.path = alreadyRenamedRoot || previous === oldPath
          ? newPath
          : newPath + previous.substring(oldPath.length);
        if ((previous === oldPath || alreadyRenamedRoot) && newName) item.name = newName;
        if ((previous === oldPath || alreadyRenamedRoot) && fileId) item.file_id = fileId;
        if (item._dbPath === oldPath || String(item._dbPath || '').startsWith(oldPrefix)) {
          item._dbPath = item._dbPath === oldPath ? newPath : newPath + item._dbPath.substring(oldPath.length);
        }
        if (!alreadyRenamedRoot) _pathToContainer.delete(previous);
        _pathToContainer.set(item.path, { childrenDiv: childrenDiv, state: state });
        if (state.heightsByPath && state.heightsByPath.has(previous)) {
          state.heightsByPath.set(item.path, state.heightsByPath.get(previous));
          state.heightsByPath.delete(previous);
        }
        if (state.selectedIds && state.selectedIds.has(previous)) {
          state.selectedIds.remove(previous);
          state.selectedIds.add(item.path);
        }
        if (state.expandedIds && state.expandedIds.has(previous)) {
          state.expandedIds.delete(previous);
          state.expandedIds.add(item.path);
        }
      }
      state.allItems.forEach(rewriteItem);
      state.childrenByParent.forEach(function (items) { items.forEach(rewriteItem); });
      var remapped = new Map();
      state.childrenByParent.forEach(function (items, parentPath) {
        var mappedParent = parentPath === oldPath
          ? newPath
          : (parentPath.startsWith(oldPrefix) ? newPath + parentPath.substring(oldPath.length) : parentPath);
        remapped.set(mappedParent, items);
      });
      state.childrenByParent = remapped;
      refresh(childrenDiv);
    });
    return true;
  }

  // フォルダ内(inside)へドロップされた項目を末尾へ追加する
  function dropInto(childrenDiv, newItems) {
    var owner = _resolvedVirtualContainer(childrenDiv);
    var state = owner && owner._virtualState;
    if (!state) return false;
    var parentPath = childrenDiv._virtualParentPath || null;
    var incomingPaths = new Set((newItems || []).map(function (item) { return item && item.path; }).filter(Boolean));
    _removePathsFromAllLists(state, incomingPaths);
    var target = _siblingListFor(state, parentPath).slice();
    (newItems || []).forEach(function (item) {
      if (!item || !item.path) return;
      target = target.filter(function (existing) { return existing.path !== item.path; });
      target.push(item);
      _pathToContainer.set(item.path, { childrenDiv: owner, state: state });
    });
    if (parentPath) state.childrenByParent.set(parentPath, target);
    else state.allItems = target;
    refresh(owner);
    return true;
  }

  // 同一コンテナ内でのabove/below並べ替え（movedPaths を targetPath の前後へ移動）
  function reorderAround(childrenDiv, movedPaths, targetPath, position) {
    var owner = _resolvedVirtualContainer(childrenDiv);
    var state = owner && owner._virtualState;
    if (!state) return false;
    var targetEntry = state.flat.find(function (entry) { return entry.id === targetPath; });
    var parentPath = targetEntry && targetEntry.parentId;
    var movedSet = new Set(movedPaths || []);
    var moving = _removePathsFromAllLists(state, movedSet);
    var rest = _siblingListFor(state, parentPath).slice();
    var targetIndex = rest.findIndex(function (it) { return it.path === targetPath; });
    if (targetIndex < 0) {
      // ターゲットが移動対象に含まれていた等: 末尾に追加してフェイルセーフ
      rest = rest.concat(moving);
    } else {
      var insertAt = position === 'above' ? targetIndex : targetIndex + 1;
      rest.splice.apply(rest, [insertAt, 0].concat(moving));
    }
    if (parentPath) state.childrenByParent.set(parentPath, rest);
    else state.allItems = rest;
    state.lastOrderParentPath = parentPath || null;
    refresh(owner);
    return true;
  }

  function saveManualOrderFromVirtualModel(childrenDiv, folderPath) {
    var owner = _resolvedVirtualContainer(childrenDiv);
    var state = owner && owner._virtualState;
    if (!state || typeof setManualOrder !== 'function') return;
    var parentPath = childrenDiv._virtualParentPath || state.lastOrderParentPath;
    if (!parentPath && state.childrenByParent && state.childrenByParent.has(folderPath)) parentPath = folderPath;
    var names = _siblingListFor(state, parentPath || null)
      .map(function (it) { return it && it.name; }).filter(Boolean);
    setManualOrder(folderPath, names);
    state.lastOrderParentPath = null;
  }

  // ------------------------------------------------------------
  // 矩形選択との両立（論理Y範囲 → 未マウント行への選択反映）
  // gb-outliner.part03.js の updateSelection() 末尾から呼ばれる。
  // ------------------------------------------------------------
  function _scopeMatches(childrenDiv, scope) {
    if (!scope) return true;
    var parts = String(scope).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return parts.some(function (sel) {
      try { return !!childrenDiv.closest(sel); } catch (e) { return false; }
    });
  }

  function applyLassoSelection(params) {
    var p = params || {};
    var engine = _engine();
    var scroller = _scroller();
    if (!engine || !scroller || !p.lassoRect) return;
    _activeContainers.forEach(function (childrenDiv) {
      if (!childrenDiv.isConnected) return;
      if (!_scopeMatches(childrenDiv, p.scope)) return;
      var state = childrenDiv._virtualState;
      if (!state) return;
      var spacerRect = childrenDiv.getBoundingClientRect();
      var scrollerRect = scroller.getBoundingClientRect();
      // lassoRect はスクロールコンテナ基準のローカル座標（scroller.scrollLeft/Top込み、
      // event.clientX/Yベース）で、getBoundingClientRect/scrollTopと同じズーム後px単位。
      // state.offsets（論理px）と比較する直前にズーム係数で割る。
      var zoom = _zoomFactor();
      var containerLocalTop = ((spacerRect.top - scrollerRect.top) + scroller.scrollTop) / zoom;
      var yStart = p.lassoRect.top / zoom - containerLocalTop;
      var yEnd = p.lassoRect.bottom / zoom - containerLocalTop;
      if (yEnd < 0 || yStart > state.totalHeight) return; // 交差なし
      var range = engine.rowsInLogicalYRange(state.offsets, yStart, yEnd);
      for (var i = range.start; i < range.end; i++) {
        var item = state.flat[i] && state.flat[i].data;
        if (!item || !item.path) continue;
        var path = item.path;
        var shouldSelect;
        if (p.mode === 'toggle') shouldSelect = !(p.basePaths && p.basePaths.has(path));
        else shouldSelect = true; // replace/add はどちらも矩形内は選択
        var mountedEl = state.mountedById.get(path);
        if (mountedEl) {
          if (shouldSelect) treeSelection.add(mountedEl); else treeSelection.remove(mountedEl);
        } else if (shouldSelect) {
          state.selectedIds.add(path);
        } else {
          state.selectedIds.remove(path);
        }
      }
    });
  }

  // 折りたたみ/再展開の直後に即座にマウント状態を同期する（次のscrollイベント待ちにしない）。
  // 折りたたみ時: 表示範囲ゼロとして全アンマウント。再展開時: 現在の表示範囲を再マウント。
  // どちらの場合もstateは保持されるため、再フェッチ無しで完結する。
  function syncMountForVisibility(childrenDiv) {
    if (childrenDiv && childrenDiv._virtualState) _remountVisible(childrenDiv);
  }

  // ------------------------------------------------------------
  // 共有スクロールリスナー（rAFスロットル）
  // ------------------------------------------------------------
  function _onScrollFrame() {
    _scrollTickScheduled = false;
    _activeContainers.forEach(function (childrenDiv) {
      if (!childrenDiv.isConnected) {
        _activeContainers.delete(childrenDiv);
        return;
      }
      _remountVisible(childrenDiv);
    });
    _scrollTickSubscribers.forEach(function (cb) { try { cb(); } catch (e) {} });
  }

  // requestAnimationFrameのみに頼ると、バックグラウンドタブや仮想時間制御下の
  // 自動テスト環境でコールバックが遅延/停止することがある（Phase 0監査で既知）。
  // rAFとsetTimeoutの両方を仕掛け、どちらか早く発火した方だけを実行する。
  function _scheduleScrollFrame(callback) {
    var done = false;
    var run = function () {
      if (done) return;
      done = true;
      callback();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 32);
  }

  function _ensureScrollListener() {
    if (_scrollListenerBound) return;
    var scroller = _scroller();
    if (!scroller) return;
    scroller.addEventListener('scroll', function () {
      if (_scrollTickScheduled) return;
      _scrollTickScheduled = true;
      _scheduleScrollFrame(_onScrollFrame);
    }, { passive: true });
    _scrollListenerBound = true;
  }

  function _onViewportFrame() {
    _viewportTickScheduled = false;
    var engine = _engine();
    if (!engine) return;
    _activeContainers.forEach(function (childrenDiv) {
      if (!childrenDiv.isConnected) {
        _activeContainers.delete(childrenDiv);
        return;
      }
      var state = childrenDiv._virtualState;
      if (state && state.compactRowHeight !== _compactRowHeight(engine)) refresh(childrenDiv);
      else _remountVisible(childrenDiv);
    });
    _scrollTickSubscribers.forEach(function (cb) { try { cb(); } catch (e) {} });
  }

  function _scheduleViewportFrame() {
    if (_viewportTickScheduled) return;
    _viewportTickScheduled = true;
    _scheduleScrollFrame(_onViewportFrame);
  }

  function _ensureViewportListener() {
    if (_viewportListenerBound || typeof window.addEventListener !== 'function') return;
    window.addEventListener('resize', _scheduleViewportFrame, { passive: true });
    window.addEventListener('orientationchange', _scheduleViewportFrame, { passive: true });
    _viewportListenerBound = true;
  }

  function onScrollTick(callback) {
    if (typeof callback === 'function') _scrollTickSubscribers.push(callback);
  }

  // rAF/scrollイベントを待たず、現在のスクロール位置で即座に全コンテナを再同期する。
  // 決定的E2E・単体検証など、タイミングに依存させたくない呼び出し元向け。
  function forceRefreshVisible() {
    _scrollTickScheduled = false;
    _onScrollFrame();
  }

  function activeContainers() { return Array.from(_activeContainers); }

  window.GBOutlinerVirtualRender = {
    VIRTUAL_THRESHOLD: VIRTUAL_THRESHOLD,
    OVERSCAN_ROWS: OVERSCAN_ROWS,
    mount: mount,
    refresh: refresh,
    updateRowHeight: updateRowHeight,
    containerForPath: containerForPath,
    ensureLogicalIndexMounted: ensureLogicalIndexMounted,
    refreshAllFilters: refreshAllFilters,
    unmountContainer: unmountContainer,
    syncMountForVisibility: syncMountForVisibility,
    forceRefreshVisible: forceRefreshVisible,
    attachNested: attachNested,
    expandCachedNested: expandCachedNested,
    collapseNested: collapseNested,
    isVirtualContainer: isVirtualContainer,
    parentPathForItem: parentPathForItem,
    stateChildItemsFor: stateChildItemsFor,
    renamePath: renamePath,
    depthLineLocalOffsets: depthLineLocalOffsets,
    setDragExempt: setDragExempt,
    clearDragExempt: clearDragExempt,
    dropInto: dropInto,
    removeFromContainer: removeFromContainer,
    reorderAround: reorderAround,
    saveManualOrderFromVirtualModel: saveManualOrderFromVirtualModel,
    applyLassoSelection: applyLassoSelection,
    onScrollTick: onScrollTick,
    activeContainers: activeContainers,
    ensureScrollListener: _ensureScrollListener,
  };
})();
