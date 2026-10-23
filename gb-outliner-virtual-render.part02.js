
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
