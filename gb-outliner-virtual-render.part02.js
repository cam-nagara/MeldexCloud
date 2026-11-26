
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

  // Delete offscreen/collapsed entries too: removing DOM alone lets refresh resurrect them.
  function removeMatchingPaths(matches) {
    if (typeof matches !== 'function') return;
    _activeContainers.forEach(function (owner) {
      var state = owner._virtualState;
      if (!state) return;
      var removed = new Set();
      function keep(items) {
        return (items || []).filter(function (item) {
          if (!item || !item.path || !matches(item.path)) return true;
          removed.add(item.path);
          return false;
        });
      }
      state.allItems = keep(state.allItems);
      state.childrenByParent.forEach(function (items, parentPath) {
        var remaining = keep(items);
        if (matches(parentPath)) {
          removed.add(parentPath);
          state.childrenByParent.delete(parentPath);
        } else state.childrenByParent.set(parentPath, remaining);
      });
      if (!removed.size) return;
      removed.forEach(function (path) {
        state.selectedIds.remove(path);
        state.expandedIds.delete(path);
        if (state.heightsByPath) state.heightsByPath.delete(path);
        _pathToContainer.delete(path);
      });
      refresh(owner);
    });
  }

  function parentPathForItem(childrenDiv, path) {
    var owner = _resolvedVirtualContainer(childrenDiv);
    var state = owner && owner._virtualState;
    if (!state) return undefined;
    var entry = state.flat.find(function (candidate) { return candidate.id === path; });
    return entry ? entry.parentId : undefined;
  }

  // フォルダパネルはソースルート相対、ツリーは絶対パスを保持する場合がある。
  // 同名フォルダを誤って選ばないよう、全仮想モデルで一意に解決できる時だけ返す。
  function resolveUniquePath(path) {
    var wanted = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (!wanted) return '';
    var matches = new Set();
    _activeContainers.forEach(function (container) {
      var state = container && container._virtualState;
      if (!state) return;
      function collect(item) {
        var candidate = String(item && item.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
        var key = candidate.toLowerCase();
        if (key === wanted || key.endsWith('/' + wanted)) matches.add(candidate);
      }
      state.allItems.forEach(collect);
      state.childrenByParent.forEach(function (items) { items.forEach(collect); });
    });
    return matches.size === 1 ? Array.from(matches)[0] : '';
  }

  function renamePath(oldPath, newPath, newName, fileId) {
    if (!oldPath || !newPath) return false;
    var containers = new Set(_activeContainers);
    var mapped = _pathToContainer.get(oldPath);
    if (mapped && mapped.childrenDiv) containers.add(mapped.childrenDiv);
    if (oldPath === newPath) {
      containers.forEach(function (container) {
        var state = container._virtualState;
        if (!state) return;
        function update(item) {
          if (item.path !== oldPath) return;
          item.name = newName;
          if (fileId) item.file_id = fileId;
        }
        state.allItems.forEach(update);
        state.childrenByParent.forEach(function (items) { items.forEach(update); });
        refresh(container);
      });
      return true;
    }
    var oldPrefix = oldPath + '/';
    _pathToContainer.delete(oldPath);
    containers.forEach(function (childrenDiv) {
      var state = childrenDiv._virtualState;
      if (!state) return;
      function mapParent(path) {
        if (path === oldPath) return newPath;
        return path && path.startsWith(oldPrefix) ? newPath + path.substring(oldPath.length) : path;
      }
      state.rootPath = mapParent(state.rootPath);
      state.lastOrderParentPath = mapParent(state.lastOrderParentPath);
      childrenDiv._virtualParentPath = mapParent(childrenDiv._virtualParentPath);
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
        if (previous !== item.path && state.heightsByPath && state.heightsByPath.has(previous)) {
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

  // 作成した項目だけを加える。既存の表示行を取り外さず、索引と位置だけ更新する。
  function insertItems(childrenDiv, newItems) {
    var owner = _resolvedVirtualContainer(childrenDiv);
    var state = owner && owner._virtualState;
    if (!state) return false;
    var parentPath = childrenDiv._virtualParentPath || null;
    var target = _siblingListFor(state, parentPath).slice();
    var known = new Set(target.map(function (item) { return item.path; }));
    var added = (newItems || []).filter(function (item) { return item && item.path && !known.has(item.path); });
    if (!added.length) return true;
    target.push.apply(target, added);
    var folderPath = parentPath || (state.folderItem && state.folderItem.path) || state.rootPath;
    if (typeof getSortForFolder === 'function') {
      var sort = getSortForFolder(folderPath);
      if (sort.sort === 'manual' && typeof _sortItemsByManualOrder === 'function') target = _sortItemsByManualOrder(target, folderPath);
      else if (typeof compareItemsForFolderSort === 'function') target.sort(function (a, b) { return compareItemsForFolderSort(a, b, sort.sort, sort.order); });
    }
    var oldFlat = state.flat, oldOffsets = state.offsets;
    var anchor = oldFlat[state.rangeStart];
    var beforeOffset = oldOffsets[state.rangeStart] || 0;
    var mounted = Array.from(state.mountedByIndex.entries());
    if (parentPath) state.childrenByParent.set(parentPath, target); else state.allItems = target;
    added.forEach(function (item) { _pathToContainer.set(item.path, { childrenDiv: owner, state: state }); });
    _rebuildModel(state);
    var indices = new Map(state.flat.map(function (entry, index) { return [entry.id, index]; }));
    var remapped = new Map();
    mounted.forEach(function (pair) {
      var index = indices.get(oldFlat[pair[0]].id), node = pair[1];
      if (index === undefined) {
        var currentFlat = state.flat;
        state.flat = oldFlat;
        try { _unmountRow(state, pair[0]); } finally { state.flat = currentFlat; }
        return;
      }
      node.dataset.gbVirtualIndex = String(index);
      node.style.top = state.offsets[index] + 'px';
      remapped.set(index, node);
    });
    state.mountedByIndex = remapped;
    _applyContainerHeight(owner, state);
    var scroller = _scroller(), anchorIndex = anchor && indices.get(anchor.id);
    if (scroller && anchorIndex !== undefined) scroller.scrollTop += (state.offsets[anchorIndex] || 0) - beforeOffset;
    _remountVisible(owner);
    return true;
  }

  // 大きなフォルダの続きのページを末尾へ足す（並べ替えはサーバーの順のまま）。表示中の行は取り外さず、
  // 索引と位置だけ更新する。
  function appendItems(childrenDiv, newItems) {
    var owner = _resolvedVirtualContainer(childrenDiv);
    var state = owner && owner._virtualState;
    if (!state) return false;
    var parentPath = childrenDiv._virtualParentPath || null;
    var current = _siblingListFor(state, parentPath) || [];
    var cacheKey = parentPath || '';
    state.appendKnown = state.appendKnown || new Map();
    var cached = state.appendKnown.get(cacheKey);
    var known = cached && cached.list === current ? cached.paths : new Set(current.map(function (item) { return item.path; }));
    var added = (newItems || []).filter(function (item) { return item && item.path && !known.has(item.path); });
    if (!added.length) return true;
    if (_appendItemsAtEnd(owner, state, parentPath, current, known, added)) return true;
    var target = current.concat(added);
    added.forEach(function (item) { known.add(item.path); });
    state.appendKnown.set(cacheKey, { list: target, paths: known });
    var oldFlat = state.flat, oldOffsets = state.offsets;
    var anchor = oldFlat[state.rangeStart];
    var beforeOffset = oldOffsets[state.rangeStart] || 0;
    var mounted = Array.from(state.mountedByIndex.entries());
    if (parentPath) state.childrenByParent.set(parentPath, target); else state.allItems = target;
    added.forEach(function (item) { _pathToContainer.set(item.path, { childrenDiv: owner, state: state }); });
    _rebuildModel(state);
    var indices = new Map();
    for (var i = 0; i < state.flat.length; i++) indices.set(state.flat[i].id, i);
    var remapped = new Map();
    mounted.forEach(function (pair) {
      var index = indices.get(oldFlat[pair[0]].id), node = pair[1];
      if (index === undefined) {
        var currentFlat = state.flat;
        state.flat = oldFlat;
        try { _unmountRow(state, pair[0]); } finally { state.flat = currentFlat; }
        return;
      }
      node.dataset.gbVirtualIndex = String(index);
      node.style.top = state.offsets[index] + 'px';
      remapped.set(index, node);
    });
    state.mountedByIndex = remapped;
    _applyContainerHeight(owner, state);
    var scroller = _scroller(), anchorIndex = anchor && indices.get(anchor.id);
    if (scroller && anchorIndex !== undefined) {
      var delta = (state.offsets[anchorIndex] || 0) - beforeOffset;
      if (delta) scroller.scrollTop += delta;
    }
    _remountVisible(owner);
    return true;
  }

  // 続きのページを一覧の末尾へ足すだけで済む時（一番上の階層・名前検索なし・足す項目が展開済みでない）は、
  // 一覧を作り直さず、足す分だけ索引と位置を伸ばす（1回の時間が読み込み済みの件数に比例しない）。
  function _appendItemsAtEnd(owner, state, parentPath, current, known, added) {
    if (parentPath || current !== state.allItems || state.flat.length + 1 !== state.offsets.length) return false;
    var q = '';
    try { q = typeof _treeSearchQuery !== 'undefined' ? _treeSearchQuery : ''; } catch (e) { q = ''; }
    if (q) return false;
    var engine = _engine();
    if (!engine || state.compactRowHeight !== _compactRowHeight(engine)) return false;
    for (var i = 0; i < added.length; i++) {
      if (state.expandedIds && state.expandedIds.has(added[i].path)) return false;
    }
    var heights = state.heightsByPath;
    var total = state.totalHeight;
    for (var j = 0; j < added.length; j++) {
      var item = added[j];
      known.add(item.path);
      state.allItems.push(item);
      _pathToContainer.set(item.path, { childrenDiv: owner, state: state });
      if (!_itemPassesFilters(item)) continue;
      if (state.effectiveItems && state.effectiveItems !== state.allItems) state.effectiveItems.push(item);
      var height = (heights && heights.get(item.path)) || state.compactRowHeight;
      state.flat.push({ id: item.path, parentId: null, depth: 0, height: height, data: item });
      total += height;
      state.offsets.push(total);
    }
    state.totalHeight = total;
    state.appendKnown.set('', { list: state.allItems, paths: known });
    _applyContainerHeight(owner, state);
    _remountVisible(owner);
    return true;
  }

  // ---- 大きなフォルダの分割読み込み: 読み込み済みの範囲（連続した1区間）の入れ替え・前への継ぎ足し ----
  // 一覧の途中の位置へ直接飛んだ時に使う。読み込み済みの範囲より前の行数（leadRows）と後ろの行数（pendingRows）は
  // 高さだけ確保する（スクロールバーは全体の長さを表す）。

  // 読み込み済みの範囲を丸ごと入れ替える（遠くへ飛んだ時）。前の範囲の行・選択の控えは手放す。
  function replaceWindow(childrenDiv, items, leadRows, pendingRows) {
    var state = childrenDiv && childrenDiv._virtualState;
    var engine = _engine();
    if (!state || !engine) return false;
    Array.from(state.mountedByIndex.keys()).forEach(function (index) { _unmountRow(state, index); });
    (state.allItems || []).forEach(function (item) {
      if (!item || !item.path) return;
      _deleteCachedBranch(state, item.path);
      _pathToContainer.delete(item.path);
      if (state.selectedIds) state.selectedIds.remove(item.path);
      if (state.expandedIds) state.expandedIds.delete(item.path);
      if (state.heightsByPath) state.heightsByPath.delete(item.path);
    });
    var list = (items || []).filter(function (item) { return item && item.path; });
    state.allItems = list;
    state.appendKnown = new Map();
    list.forEach(function (item) { _pathToContainer.set(item.path, { childrenDiv: childrenDiv, state: state }); });
    var rowHeight = _compactRowHeight(engine);
    state.leadHeight = Math.max(0, Number(leadRows) || 0) * rowHeight;
    state.reserveHeight = Math.max(0, Number(pendingRows) || 0) * rowHeight;
    _rebuildModel(state);
    _applyContainerHeight(childrenDiv, state);
    _remountVisible(childrenDiv);
    return true;
  }

  // 読み込み済みの範囲の前へページを継ぎ足す（上へスクロールした時）。leadRows は継ぎ足した後の、前に残る行数。
  // 表示中の行は取り外さず、索引と位置だけ更新する。足した行の高さの合計が、減らした確保分と違う時だけスクロール位置を直す。
  function prependItems(childrenDiv, newItems, leadRows) {
    var state = childrenDiv && childrenDiv._virtualState;
    var engine = _engine();
    if (!state || !engine) return false;
    var known = new Set((state.allItems || []).map(function (item) { return item.path; }));
    var added = (newItems || []).filter(function (item) { return item && item.path && !known.has(item.path); });
    var oldFlat = state.flat, oldOffsets = state.offsets;
    var anchor = oldFlat[state.rangeStart];
    var beforeOffset = oldOffsets[state.rangeStart] || 0;
    var mounted = Array.from(state.mountedByIndex.entries());
    state.allItems = added.concat(state.allItems || []);
    state.appendKnown = new Map();
    added.forEach(function (item) { _pathToContainer.set(item.path, { childrenDiv: childrenDiv, state: state }); });
    state.leadHeight = Math.max(0, Number(leadRows) || 0) * _compactRowHeight(engine);
    _rebuildModel(state);
    var indices = new Map();
    for (var i = 0; i < state.flat.length; i++) indices.set(state.flat[i].id, i);
    var remapped = new Map();
    mounted.forEach(function (pair) {
      var index = indices.get(oldFlat[pair[0]].id), node = pair[1];
      if (index === undefined) {
        var currentFlat = state.flat;
        state.flat = oldFlat;
        try { _unmountRow(state, pair[0]); } finally { state.flat = currentFlat; }
        return;
      }
      node.dataset.gbVirtualIndex = String(index);
      node.style.top = state.offsets[index] + 'px';
      remapped.set(index, node);
    });
    state.mountedByIndex = remapped;
    _applyContainerHeight(childrenDiv, state);
    var scroller = _scroller(), anchorIndex = anchor && indices.get(anchor.id);
    if (scroller && anchorIndex !== undefined) {
      var delta = (state.offsets[anchorIndex] || 0) - beforeOffset;
      if (delta) scroller.scrollTop += delta * _zoomFactor();
    }
    _remountVisible(childrenDiv);
    return true;
  }

  // 見えている範囲と読み込み済みの範囲（一覧の中の位置・px）。続きや途中のページを取る判断に使う。
  // 折りたたみ中・画面から外れている時は null。
  function windowMetrics(childrenDiv) {
    var state = childrenDiv && childrenDiv._virtualState;
    var scroller = _scroller();
    var engine = _engine();
    if (!state || !scroller || !engine || !childrenDiv.isConnected || childrenDiv.closest('.collapsed')) return null;
    var zoom = _zoomFactor();
    var spacerRect = childrenDiv.getBoundingClientRect();
    var scrollerRect = scroller.getBoundingClientRect();
    return {
      viewTop: (scrollerRect.top - spacerRect.top) / zoom,
      viewBottom: (scrollerRect.bottom - spacerRect.top) / zoom,
      loadedTop: state.leadHeight || 0,
      loadedBottom: state.totalHeight,
      height: state.totalHeight + (state.reserveHeight || 0),
      rowHeight: state.compactRowHeight || _compactRowHeight(engine),
    };
  }

  // まだ読み込んでいない続きの件数。その分の高さを確保して、スクロールバーが全体の長さを表すようにする。
  function setPendingRows(childrenDiv, rows) {
    var state = childrenDiv && childrenDiv._virtualState;
    if (!state) return false;
    var engine = _engine();
    var rowHeight = state.compactRowHeight || (engine ? _compactRowHeight(engine) : 22);
    var reserve = Math.max(0, Number(rows) || 0) * rowHeight;
    if (reserve === (state.reserveHeight || 0)) return true;
    state.reserveHeight = reserve;
    _applyContainerHeight(childrenDiv, state);
    return true;
  }

  // 読み込み済みの最後の子の下端（画面の座標）。続きを取る合図に使う。
  function bottomOfItem(childrenDiv, path) {
    var owner = _resolvedVirtualContainer(childrenDiv);
    var state = owner && owner._virtualState;
    if (!state || !owner.isConnected) return null;
    var index = -1;
    for (var i = state.flat.length - 1; i >= 0; i--) { if (state.flat[i].id === path) { index = i; break; } }
    if (index < 0) return null;
    var bottom = index + 1 < state.offsets.length ? state.offsets[index + 1] : state.totalHeight;
    return owner.getBoundingClientRect().top + bottom * _zoomFactor();
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
    var saved = setManualOrder(folderPath, names);
    state.lastOrderParentPath = null;
    return saved;
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

  // Grid needs ordinary nested DOM. Reuse loaded items, including offscreen branches,
  // rather than fetching roots again and relying on startup auto-expansion limits.
  function materializeForGrid(root) {
    _activeContainers.forEach(function (container) {
      if (!root || !root.contains(container)) return;
      var state = container._virtualState;
      if (!state) return;
      var lastClickedPath = typeof treeSelection !== 'undefined' ? treeSelection.lastClicked?._nodeData?.path : '';
      var focusedPath = document.activeElement?.closest?.('.tree-node')?._nodeData?.path;
      unmountContainer(container);
      container.style.display = '';
      function append(items, target) {
        (items || []).forEach(function (item) {
          if (item.path) _pathToContainer.delete(item.path);
          var node = createTreeNodeFromBrowse({ ...item, _gbVirtualExpansionManaged: true }, state.rootPath);
          // Future manually loaded children use normal expansion handling.
          delete node._nodeData._gbVirtualExpansionManaged;
          target.appendChild(node);
          var children = node.querySelector(':scope > .tree-children');
          var toggle = node.querySelector(':scope > .tree-node-row .tree-toggle');
          var cached = state.childrenByParent.get(item.path);
          var expanded = state.expandedIds.has(item.path);
          if (cached) {
            append(cached, children);
            children.dataset.loaded = 'true';
          }
          if (toggle && toggle.dataset.expanded !== undefined) {
            toggle.dataset.expanded = expanded ? 'true' : 'false';
            toggle.classList.toggle('expanded', expanded);
            children.classList.toggle('collapsed', !expanded);
            if (expanded && item.type === 'folder') {
              var icon = node.querySelector(':scope > .tree-node-row .tree-icon');
              if (icon) {
                icon.innerHTML = lucide(typeof getWorkFolder === 'function' && isWorkFolder(item.path) ? 'folderOpenDot' : 'folderOpen', 18);
                if (item.linked) icon.innerHTML += '<span style="position:relative;top:-4px;left:-2px;">' + lucide('externalLink', 8) + '</span>';
              }
            }
          }
          if (state.selectedIds.has(item.path) && typeof treeSelection !== 'undefined') treeSelection.add(node);
          if (item.path === lastClickedPath) treeSelection.lastClicked = node;
          if (item.path === focusedPath) node.querySelector(':scope > .tree-node-row')?.focus({ preventScroll: true });
        });
      }
      append(state.allItems, container);
    });
    if (typeof applyGlobalFilter === 'function') applyGlobalFilter();
  }

  window.GBOutlinerVirtualRender = {
    VIRTUAL_THRESHOLD: VIRTUAL_THRESHOLD,
    OVERSCAN_ROWS: OVERSCAN_ROWS,
    mount: mount,
    materializeForGrid: materializeForGrid,
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
    resolveUniquePath: resolveUniquePath,
    stateChildItemsFor: stateChildItemsFor,
    renamePath: renamePath,
    depthLineLocalOffsets: depthLineLocalOffsets,
    setDragExempt: setDragExempt,
    clearDragExempt: clearDragExempt,
    dropInto: dropInto,
    insertItems: insertItems,
    appendItems: appendItems,
    prependItems: prependItems,
    replaceWindow: replaceWindow,
    windowMetrics: windowMetrics,
    bottomOfItem: bottomOfItem,
    setPendingRows: setPendingRows,
    removeFromContainer: removeFromContainer,
    removeMatchingPaths: removeMatchingPaths,
    reorderAround: reorderAround,
    saveManualOrderFromVirtualModel: saveManualOrderFromVirtualModel,
    applyLassoSelection: applyLassoSelection,
    onScrollTick: onScrollTick,
    activeContainers: activeContainers,
    ensureScrollListener: _ensureScrollListener,
  };
})();
