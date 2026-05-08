/* gb-layout.part02.js */
  function _updatePaneNavButtons(paneId) {
    const paneInfo = _paneMap[paneId];
    const paneNode = paneInfo?.node || findNode(_root, paneId)?.node;
    const history = Array.isArray(paneNode?.navHistory) ? paneNode.navHistory : [];
    const navIndex = Number.isInteger(paneNode?.navIndex) ? paneNode.navIndex : (history.length ? history.length - 1 : -1);
    const backBtn = paneInfo?.el?.querySelector('.gb-pane-nav-back');
    const forwardBtn = paneInfo?.el?.querySelector('.gb-pane-nav-forward');
    const navCtrls = paneInfo?.el?.querySelector('.gb-pane-nav-ctrls');
    // 戻る/進むは遷移先が存在する場合のみ表示（履歴がない時は非表示で幅を節約）
    const backHidden = navIndex <= 0;
    const forwardHidden = navIndex < 0 || navIndex >= history.length - 1;
    if (backBtn) {
      backBtn.disabled = backHidden;
      backBtn.style.display = backHidden ? 'none' : '';
    }
    if (forwardBtn) {
      forwardBtn.disabled = forwardHidden;
      forwardBtn.style.display = forwardHidden ? 'none' : '';
    }
    if (navCtrls) {
      navCtrls.style.display = (backHidden && forwardHidden) ? 'none' : '';
    }
  }

  // 折りたたみバー内にアイコンを並べる。
  // - 通常 split: 配下の各 pane のすべてのタブのアイコンを順番通りに表示
  // - panelset: 各グループのアイコン（GBPanelSet.collectGroupTabTypes の最初の type）を縦並び表示
  function _appendCollapsedIcons(bar, node, onClick) {
    const addIcon = (iconName, title, onClickInner) => {
      const icon = document.createElement('span');
      icon.className = 'gb-split-collapsed-icon';
      icon.title = title || '';
      icon.innerHTML = typeof lucide === 'function' ? lucide(iconName || 'page', 16) : '';
      icon.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof onClickInner === 'function') onClickInner();
      });
      bar.appendChild(icon);
      return icon;
    };
    function walk(n) {
      if (!n) return;
      if (n.type === 'panelset' && Array.isArray(n.groups)) {
        // 通常のタブバーと同じ renderGroupIconButton を流用し、縦並びで全アイコンを表示
        n.groups.forEach((g) => {
          if (!g?.root) return;
          if (typeof GBPanelSet?.renderGroupIconButton === 'function') {
            const btn = GBPanelSet.renderGroupIconButton(n, g);
            // 折りたたみ時のクリックは「グループ切替 + 展開」をまとめて 1 回の render で処理する。
            // capture 段階で stopImmediatePropagation することで、renderGroupIconButton が登録した
            // click ハンドラ (switchGroup → render) の発火を抑止する。
            btn.addEventListener('click', (e) => {
              e.stopImmediatePropagation();
              e.preventDefault();
              if (n.activeGroupId !== g.id) n.activeGroupId = g.id;
              if (typeof onClick === 'function') onClick();
            }, true);
            bar.appendChild(btn);
          } else {
            // フォールバック
            const types = (typeof GBPanelSet?.collectGroupTabTypes === 'function')
              ? GBPanelSet.collectGroupTabTypes(g.root) : [];
            const firstType = types[0] || 'page';
            const iconName = (typeof GBTabs !== 'undefined' && typeof GBTabs.tabIcon === 'function')
              ? GBTabs.tabIcon(firstType) : 'page';
            addIcon(iconName, types.join(' / ') || '(空)', () => {
              n.activeGroupId = g.id;
              if (typeof onClick === 'function') onClick();
            });
          }
        });
        return;
      }
      if (n.type === 'split' && Array.isArray(n.children)) {
        n.children.forEach(walk);
        return;
      }
      if (n.type === 'pane') {
        const tabs = Array.isArray(n.tabs) ? n.tabs : [];
        tabs.forEach((tab, idx) => {
          if (!tab) return;
          const el = addIcon(tab.icon || 'page', tab.label || tab.type, () => {
            n.activeTabIndex = idx;
            if (typeof onClick === 'function') onClick();
          });
          if (idx === n.activeTabIndex) el.classList.add('active');
        });
      }
    }
    walk(node);
  }

  function renderSplit(node, depth) {
    // splitノード自体が折り畳まれている場合: 小さなバーとして描画
    if (node.collapsed) {
      const bar = document.createElement('div');
      bar.className = 'gb-split-collapsed';
      const parentInfo = findParent(_root, node.id);
      const parentDir = parentInfo ? parentInfo.node.direction : 'horizontal';
      bar.classList.add('gb-split-collapsed-' + parentDir);

      // カラム移動用のドラッグハンドル（バー先頭に配置）
      const dragHandle = document.createElement('span');
      dragHandle.className = 'gb-split-collapsed-drag-handle';
      dragHandle.draggable = true;
      dragHandle.title = 'ドラッグ: カラム移動';
      dragHandle.innerHTML = lucide('gripVertical', 12);
      dragHandle.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      dragHandle.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        const columnId = _findColumnAncestorId(node.id) || node.id;
        e.dataTransfer.setData('application/x-gb-column', JSON.stringify({ nodeId: columnId }));
        e.dataTransfer.effectAllowed = 'move';
      });
      dragHandle.addEventListener('dragend', () => {
        if (typeof GBDocking !== 'undefined' && typeof GBDocking.hideIndicator === 'function') {
          GBDocking.hideIndicator();
        }
      });
      bar.appendChild(dragHandle);

      // 「展開」ボタンは削除済み（境界線の◀▶ボタンで展開する）
      _appendCollapsedIcons(bar, node, () => {
        const before = captureLayoutSnapshot();
        node.collapsed = false;
        _adjustSplitForCollapse(node);
        saveLayout();
        pushLayoutHistory('レイアウト: 折りたたみ解除', before, captureLayoutSnapshot(), node.id || '');
      });
      return bar;
    }

    const split = document.createElement('div');
    split.className = 'gb-split gb-split-' + node.direction;
    split.dataset.ratio = node.ratio;
    split.dataset.splitId = node.id;

    const first = document.createElement('div');
    first.className = 'gb-split-child gb-split-first';
    const child0collapsed = node.children[0] && node.children[0].collapsed;
    const child1collapsed = node.children[1] && node.children[1].collapsed;
    if (child0collapsed) {
      // 折り畳まれた子は固定32pxにし、flex-growなし
      if (node.direction === 'horizontal') { first.style.width = '32px'; first.style.flexShrink = '0'; }
      else { first.style.height = '32px'; first.style.flexShrink = '0'; }
    } else if (child1collapsed) {
      // 相手が折り畳まれているなら自分がflex: 1で残り全部
      first.style.flex = '1';
    } else {
      const pct = (node.ratio * 100).toFixed(2);
      if (node.direction === 'horizontal') first.style.width = pct + '%';
      else first.style.height = pct + '%';
    }
    // 水平スプリットの各子 = 「列」としてラップ。垂直スプリットはそのまま再帰。
    first.appendChild(node.direction === 'horizontal'
      ? renderAsColumn(node.children[0], depth + 1)
      : renderNode(node.children[0], depth + 1));

    const handle = document.createElement('div');
    handle.className = 'gb-split-handle';
    handle.dataset.e2eId = `split-${node.id}-resize`;
    handle.dataset.splitId = node.id || '';
    _setupResizeHandle(handle, node, split, first);
    _setSplitHandleAnchor(handle, node.direction);
    _bindSplitHandleAnchor(handle, node.direction);
    handle.style.position = 'relative';
    // ハンドルから視覚的に最も近いパネル/サブツリーを見つけるヘルパー
    // - subtree: 探索対象 (split or pane)
    // - splitDir: 親 split の方向 ('horizontal'/'vertical')
    // - edge: 'last' (右/下端) or 'first' (左/上端)
    // 親 split と同じ方向の split ノードは更に潜って境界に最も近いパネルへ。
    // 異なる方向の split ノードはそれ自体を 1 単位として返す（縦分割は丸ごと 1 列扱い）。
    const _findAdjacentTarget = (subtree, splitDir, edge) => {
      if (!subtree) return null;
      if (!subtree.children || subtree.children.length === 0) return subtree; // pane
      if (subtree.direction === splitDir) {
        const next = edge === 'last' ? subtree.children[1] : subtree.children[0];
        return _findAdjacentTarget(next, splitDir, edge);
      }
      return subtree;
    };
    const _collapseTargetForButton = (childIdx) => (childIdx === 0
      ? _findAdjacentTarget(node.children[0], node.direction, 'last')
      : _findAdjacentTarget(node.children[1], node.direction, 'first'));
    const _oppositeTargetForButton = (childIdx) => (childIdx === 0
      ? _findAdjacentTarget(node.children[1], node.direction, 'first')
      : _findAdjacentTarget(node.children[0], node.direction, 'last'));
    const _collapseSideLabel = (childIdx) => {
      const isHorz = node.direction === 'horizontal';
      if (isHorz) return childIdx === 0 ? '左側' : '右側';
      return childIdx === 0 ? '上側' : '下側';
    };
    const _collapseDirectionIcon = (childIdx) => {
      const isHorz = node.direction === 'horizontal';
      if (isHorz) return childIdx === 0 ? '◀' : '▶';
      return childIdx === 0 ? '▲' : '▼';
    };
    const _isCollapsedDock = (target) => !!target?.collapsed;
    // ノードの DOM 要素を ID で探すヘルパー
    const findNodeEl = (n) =>
      document.querySelector(`[data-pane-id="${n.id}"]`) ||
      document.querySelector(`.gb-split[data-split-id="${n.id}"]`) ||
      document.querySelector(`.gb-column[data-column-node-id="${n.id}"]`);
    const _isImmediateSplitChild = (n) => n === node.children[0] || n === node.children[1];
    const _collapsedRatioLooksApplied = (target) => {
      const parentInfo = findParent(_root, target.id);
      const parent = parentInfo?.node;
      if (!parent || parent.type !== 'split' || !Array.isArray(parent.children)) return false;
      const childIndex = findNode(parent.children[0], target.id) ? 0 : 1;
      const tolerance = 0.002;
      return childIndex === 0
        ? parent.ratio <= COLLAPSE_SIZE + tolerance
        : parent.ratio >= 1 - COLLAPSE_SIZE - tolerance;
    };
    const _isDirectionSideAtOuterEdge = (target, childIdx) => {
      const isStructurallyOuterEdge = () => {
        let current = node;
        while (current?.id) {
          const parentInfo = findParent(_root, current.id);
          const parent = parentInfo?.node || null;
          if (!parent) return true;
          if (parent.type !== 'split' || !Array.isArray(parent.children)) return true;
          if (parent.direction === node.direction) {
            const currentIndex = findNode(parent.children[0], current.id) ? 0 : 1;
            if (currentIndex !== childIdx) return false;
          }
          current = parent;
        }
        return true;
      };
      return isStructurallyOuterEdge();
    };
    const _actionLabelForButton = (childIdx, directionTarget, oppositeTarget) => {
      const directionLabel = _collapseSideLabel(childIdx);
      const oppositeLabel = _collapseSideLabel(childIdx === 0 ? 1 : 0);
      const directionDock = _isCollapsedDock(directionTarget);
      const oppositeDock = _isCollapsedDock(oppositeTarget);
      if (!directionDock && !oppositeDock) return `${directionLabel}を折りたたみ`;
      if (!directionDock && oppositeDock) return `${oppositeLabel}のドックバーを${directionLabel}へ展開`;
      if (directionDock && oppositeDock) return `${oppositeLabel}のドックバーを${directionLabel}へ展開`;
      return `${directionLabel}がドックバーのため操作なし`;
    };
    const _expandCollapsedTarget = (target, before) => {
      if (!target?.collapsed) return false;
      const hadOuterCollapseSaved = !!(target._outerCollapseSaved && target._outerCollapseSaved.outerId === node.id);
      if (target._outerCollapseSaved && target._outerCollapseSaved.outerId === node.id) {
        node.ratio = target._outerCollapseSaved.ratio;
        delete target._outerCollapseSaved;
      }
      target.collapsed = false;
      if (target._savedRatio != null || hadOuterCollapseSaved || _hasDefaultExpandedWidth(target) || !_isImmediateSplitChild(target) || _collapsedRatioLooksApplied(target)) {
        _adjustSplitForCollapse(target);
      } else {
        render();
      }
      saveLayout();
      pushLayoutHistory('レイアウト: 折りたたみ解除', before, captureLayoutSnapshot(), target.id || '');
      return true;
    };
    const _collapseExpandedTarget = (target, childIdx, before) => {
      if (!target || target.collapsed) return false;
      const isHorz = node.direction === 'horizontal';
      const dimKey = isHorz ? 'width' : 'height';
      if (_isImmediateSplitChild(target)) {
        // 直接の子: 既存の _adjustSplitForCollapse で OK (この node の ratio を変える)
        target.collapsed = true;
        _adjustSplitForCollapse(target);
        saveLayout();
        pushLayoutHistory('レイアウト: 折りたたみ', before, captureLayoutSnapshot(), target.id || '');
        return true;
      }
      // 深いネスト: 外側 split (=node) の ratio も調整して、freed space を反対側へ伝達
      const targetEl = findNodeEl(target);
      const splitEl = split; // 外側 split の DOM
      const targetSize = targetEl?.getBoundingClientRect()?.[dimKey] || 0;
      const splitSize = splitEl?.getBoundingClientRect()?.[dimKey] || 0;
      if (targetSize > 32 && splitSize > 0) {
        const COLLAPSED_PX = 32;
        const deltaPx = targetSize - COLLAPSED_PX;
        const deltaRatio = deltaPx / splitSize;
        // 復元用に外側 ratio を保存
        target._outerCollapseSaved = { outerId: node.id, ratio: node.ratio };
        // childIdx=0: 左/上側を縮める → ratio を減らす
        // childIdx=1: 右/下側を縮める → ratio を増やす
        if (childIdx === 0) {
          node.ratio = Math.max(0.025, node.ratio - deltaRatio);
        } else {
          node.ratio = Math.min(0.975, node.ratio + deltaRatio);
        }
      }
      target.collapsed = true;
      _adjustSplitForCollapse(target); // 内側 split (target の親) の ratio も調整
      saveLayout();
      pushLayoutHistory('レイアウト: 折りたたみ', before, captureLayoutSnapshot(), target.id || '');
      return true;
    };
    // 境界線上に置く 2 方向の折り畳みボタン
    // childIdx=0: 左/上向き、childIdx=1: 右/下向き。アイコンは向き固定。
    // クリック時は三角の向き側と反対側の collapsed 状態を組み合わせて操作を決める。
    const _makeCollapseBtn = (childIdx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'split-collapse-btn split-collapse-btn-' + (childIdx === 0 ? 'prev' : 'next');
      btn.dataset.e2eId = `split-${node.id}-collapse-${childIdx === 0 ? 'prev' : 'next'}`;
      const directionAtRender = _collapseTargetForButton(childIdx);
      const oppositeAtRender = _oppositeTargetForButton(childIdx);
      const actionLabel = _actionLabelForButton(childIdx, directionAtRender, oppositeAtRender);
      btn.textContent = _collapseDirectionIcon(childIdx);
      btn.title = actionLabel;
      btn.setAttribute('aria-label', actionLabel);
      const runCollapseAction = (e) => {
        e.stopPropagation();
        e.preventDefault();
        // ハンドルに視覚的に隣接するノードを取得（深いネストでも 1 列分だけが対象）
        const directionTarget = _collapseTargetForButton(childIdx);
        const oppositeTarget = _oppositeTargetForButton(childIdx);
        if (!directionTarget || !oppositeTarget) return;
        const directionDock = _isCollapsedDock(directionTarget);
        const oppositeDock = _isCollapsedDock(oppositeTarget);
        const before = captureLayoutSnapshot();
        // === 4状態の仕様 ===
        // 1. 向き側=パネル / 反対側=パネル: 向き側を折りたたむ。
        // 2. 向き側=パネル / 反対側=ドックバー: 反対側ドックバーを向き側へ展開する。
        // 3. 向き側=ドックバー / 反対側=ドックバー: 反対側ドックバーを向き側へ展開する。
        //    ただし向き側ドックバーの外側がウィンドウ端なら何もしない。
        // 4. 向き側=ドックバー / 反対側=パネル: 何もしない。
        if (!directionDock && !oppositeDock) {
          _collapseExpandedTarget(directionTarget, childIdx, before);
          return;
        }
        if (!directionDock && oppositeDock) {
          _expandCollapsedTarget(oppositeTarget, before);
          return;
        }
        if (directionDock && oppositeDock) {
          if (_isDirectionSideAtOuterEdge(directionTarget, childIdx)) return;
          _expandCollapsedTarget(oppositeTarget, before);
          return;
        }
        if (directionDock && !oppositeDock) return;
      };
      btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
      btn.addEventListener('click', runCollapseAction);
      return btn;
    };
    handle.appendChild(_makeCollapseBtn(0));
    handle.appendChild(_makeCollapseBtn(1));
    if (node.direction === 'horizontal') {
      const leftBoundaryTarget = _findAdjacentTarget(node.children[0], node.direction, 'last');
      const rightBoundaryTarget = _findAdjacentTarget(node.children[1], node.direction, 'first');
      if (leftBoundaryTarget?.id && rightBoundaryTarget?.id) {
        handle.dataset.columnDropLeftId = leftBoundaryTarget.id;
        handle.dataset.columnDropRightId = rightBoundaryTarget.id;
      }
    }

    const second = document.createElement('div');
    second.className = 'gb-split-child gb-split-second';
    if (child1collapsed) {
      if (node.direction === 'horizontal') { second.style.width = '32px'; second.style.flexShrink = '0'; }
      else { second.style.height = '32px'; second.style.flexShrink = '0'; }
    } else if (child0collapsed) {
      second.style.flex = '1';
    } else {
      if (node.direction === 'horizontal') second.style.width = (100 - node.ratio * 100).toFixed(2) + '%';
      else second.style.height = (100 - node.ratio * 100).toFixed(2) + '%';
    }
    second.appendChild(node.direction === 'horizontal'
      ? renderAsColumn(node.children[1], depth + 1)
      : renderNode(node.children[1], depth + 1));

    split.appendChild(first);
    split.appendChild(handle);
    split.appendChild(second);

    return split;
  }

  // === リサイズハンドル ===
  function _splitZoom() {
    return (typeof _getZoom === 'function') ? Math.max(0.1, _getZoom()) : 1;
  }

  function _splitLogicalCoord(clientPos) {
    return clientPos / _splitZoom();
  }

  function _splitLogicalRect(rect) {
    const zoom = _splitZoom();
    return {
      left: rect.left / zoom,
      top: rect.top / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    };
  }

  function _setSplitHandleAnchor(handle, direction, clientX, clientY) {
    const rect = _splitLogicalRect(handle.getBoundingClientRect());
    if (direction === 'horizontal') {
      const minY = 14;
      const maxY = Math.max(minY, rect.height - 14);
      const nextY = clientY == null
        ? '50%'
        : `${Math.max(minY, Math.min(maxY, _splitLogicalCoord(clientY) - rect.top))}px`;
      handle.style.setProperty('--gb-split-anchor-y', nextY);
      handle.style.removeProperty('--gb-split-anchor-x');
      return;
    }
    const minX = 14;
    const maxX = Math.max(minX, rect.width - 14);
    const nextX = clientX == null
      ? '50%'
      : `${Math.max(minX, Math.min(maxX, _splitLogicalCoord(clientX) - rect.left))}px`;
    handle.style.setProperty('--gb-split-anchor-x', nextX);
    handle.style.removeProperty('--gb-split-anchor-y');
  }

  function _bindSplitHandleAnchor(handle, direction) {
    handle.addEventListener('pointerenter', (e) => {
      if (handle.classList.contains('active')) return;
      _setSplitHandleAnchor(handle, direction, e.clientX, e.clientY);
    });
  }

  function _setupResizeHandle(handle, node, splitEl, firstEl) {
    const _getSecondEl = () => firstEl.nextElementSibling?.nextElementSibling || null;
    const _sizeKey = node.direction === 'horizontal' ? 'width' : 'height';
    let resizeHistoryBefore = null;
    let resizeStartRatio = null;
    const _setChildPxSizes = (firstSize, secondSize) => {
      const secondEl = _getSecondEl();
      if (!secondEl) return;
      firstEl.style.flex = 'none';
      secondEl.style.flex = 'none';
      firstEl.style[_sizeKey] = `${firstSize}px`;
      secondEl.style[_sizeKey] = `${secondSize}px`;
    };
    const _setChildRatioSizes = (ratio) => {
      const secondEl = _getSecondEl();
      if (!secondEl) return;
      const firstPct = (ratio * 100).toFixed(2);
      const secondPct = (100 - ratio * 100).toFixed(2);
      firstEl.style.flex = 'none';
      secondEl.style.flex = 'none';
      firstEl.style[_sizeKey] = firstPct + '%';
      secondEl.style[_sizeKey] = secondPct + '%';
    };
    const _syncHandleA11y = () => {
      handle.tabIndex = 0;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', node.direction === 'horizontal' ? 'vertical' : 'horizontal');
      handle.setAttribute('aria-label', node.direction === 'horizontal' ? '左右パネル幅を調整' : '上下パネル高さを調整');
      handle.setAttribute('aria-valuemin', '5');
      handle.setAttribute('aria-valuemax', '95');
      handle.setAttribute('aria-valuenow', String(Math.round((node.ratio || 0.5) * 100)));
    };
    const _commitKeyboardResize = (delta) => {
      const secondEl = _getSecondEl();
      if (!secondEl || node.children?.[0]?.collapsed || node.children?.[1]?.collapsed) return;
      const before = captureLayoutSnapshot();
      const nextRatio = Math.max(0.05, Math.min(0.95, (node.ratio || 0.5) + delta));
      if (Math.abs(nextRatio - node.ratio) < 0.0001) return;
      node.ratio = nextRatio;
      _setChildRatioSizes(node.ratio);
      _syncHandleA11y();
      saveLayout();
      pushLayoutHistory('レイアウト: キーボードリサイズ', before, captureLayoutSnapshot(), node.id || '');
      if (typeof showStatus === 'function') showStatus('パネルサイズを変更しました');
    };
    _syncHandleA11y();
    handle.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const step = e.shiftKey ? 0.08 : 0.03;
      const isDecrease = (node.direction === 'horizontal' && e.key === 'ArrowLeft')
        || (node.direction === 'vertical' && e.key === 'ArrowUp');
      const isIncrease = (node.direction === 'horizontal' && e.key === 'ArrowRight')
        || (node.direction === 'vertical' && e.key === 'ArrowDown');
      if (isDecrease || isIncrease) {
        e.preventDefault();
        e.stopPropagation();
        _commitKeyboardResize(isIncrease ? step : -step);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        handle.blur();
      }
    });
    handle.addEventListener('focus', _syncHandleA11y);

    const onMouseMove = (e) => {
      const rect = _splitLogicalRect(splitEl.getBoundingClientRect());
      const handleRect = _splitLogicalRect(handle.getBoundingClientRect());
      const handleSize = node.direction === 'horizontal' ? handleRect.width : handleRect.height;
      const totalSize = node.direction === 'horizontal' ? rect.width : rect.height;
      const contentSize = totalSize - handleSize;
      if (contentSize <= 0) return;
      const pointerPos = node.direction === 'horizontal'
        ? _splitLogicalCoord(e.clientX)
        : _splitLogicalCoord(e.clientY);
      const pointerOffset = node.direction === 'horizontal'
        ? (pointerPos - rect.left)
        : (pointerPos - rect.top);
      let newRatio = (pointerOffset - handleSize / 2) / contentSize;
      newRatio = Math.max(0.05, Math.min(0.95, newRatio));

      // 最小ペインサイズチェック
      if (contentSize * newRatio < MIN_PANE_SIZE || contentSize * (1 - newRatio) < MIN_PANE_SIZE) return;

      node.ratio = newRatio;
      _setChildPxSizes(contentSize * newRatio, contentSize * (1 - newRatio));
    };

    const onPointerEnd = (e) => {
      document.removeEventListener('pointermove', onMouseMove);
      document.removeEventListener('pointerup', onPointerEnd);
      document.removeEventListener('pointercancel', onPointerEnd);
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
      if (e && handle.hasPointerCapture?.(e.pointerId)) {
        try { handle.releasePointerCapture(e.pointerId); } catch {}
      }
      _setChildRatioSizes(node.ratio);
      saveLayout();
      if (resizeHistoryBefore && Math.abs((resizeStartRatio ?? node.ratio) - node.ratio) > 0.0001) {
        pushLayoutHistory('レイアウト: リサイズ', resizeHistoryBefore, captureLayoutSnapshot(), node.id || '');
      }
      resizeHistoryBefore = null;
      resizeStartRatio = null;
    };

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizeHistoryBefore = null;
      resizeStartRatio = null;
      const secondEl = _getSecondEl();
      if (!secondEl || node.children?.[0]?.collapsed || node.children?.[1]?.collapsed) return;
      resizeHistoryBefore = captureLayoutSnapshot();
      resizeStartRatio = node.ratio;
      const zoom = _splitZoom();
      const firstRect = firstEl.getBoundingClientRect();
      const secondRect = secondEl.getBoundingClientRect();
      const firstSize = (node.direction === 'horizontal' ? firstRect.width : firstRect.height) / zoom;
      const secondSize = (node.direction === 'horizontal' ? secondRect.width : secondRect.height) / zoom;
      _setChildPxSizes(firstSize, secondSize);
      if (handle.setPointerCapture) {
        try { handle.setPointerCapture(e.pointerId); } catch {}
      }
      handle.classList.add('active');
      document.body.style.cursor = node.direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      // iframeがマウスイベントを奪うのを防止
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
      document.addEventListener('pointermove', onMouseMove);
      document.addEventListener('pointerup', onPointerEnd);
      document.addEventListener('pointercancel', onPointerEnd);
    });
  }

  // === アクティブペイン管理 ===
  let _onActivePaneChange = null;
  let _isNavPaneType = null; // (type) => bool — ナビペイン判定（pane-bridge が設定）
  let _isPassivePaneType = null; // (type, tab, pane) => bool — 作業アクティブを奪わない補助ペイン判定

  function _isPassivePaneTab(tab, pane) {
    if (!tab || typeof _isPassivePaneType !== 'function') return false;
    try {
      return !!_isPassivePaneType(tab.type, tab, pane);
    } catch {
      return false;
    }
  }

  function _isPassivePaneActiveTab(pane) {
    const activeTab = pane?.tabs?.[pane?.activeTabIndex];
    return _isPassivePaneTab(activeTab, pane);
  }

  function _scrollSnapshotKey(el, fallbackIndex) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return 'id:' + el.id;
    const stable = ['data-pane-id', 'data-tab-id', 'data-bd-role', 'data-rp-tab', 'data-field', 'data-action']
      .map(name => el.getAttribute?.(name) ? `${name}=${el.getAttribute(name)}` : '')
      .filter(Boolean)
      .join('|');
    if (stable) {
      const parentId = el.parentElement?.id ? `#${el.parentElement.id}` : '';
      return `stable:${parentId}:${stable}`;
    }
    const path = [];
    let cur = el;
    let guard = 0;
    while (cur && cur !== document.body && cur !== _layoutEl && guard < 8) {
      let part = cur.tagName ? cur.tagName.toLowerCase() : 'el';
      if (cur.classList?.length) part += '.' + [...cur.classList].slice(0, 2).join('.');
      const parent = cur.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(item => item.tagName === cur.tagName);
        const idx = siblings.indexOf(cur);
        if (idx >= 0) part += `:nth-${idx}`;
      }
      path.unshift(part);
      cur = parent;
      guard += 1;
    }
    return 'path:' + path.join('>') + ':' + fallbackIndex;
  }

  function _addViewportSnapshotElement(result, seen, el) {
    if (!el || el.nodeType !== 1 || seen.has(el)) return;
    seen.add(el);
    result.push(el);
  }

  function _collectViewportSnapshotElements() {
    const result = [];
    const seen = new Set();
    _addViewportSnapshotElement(result, seen, document.scrollingElement || document.documentElement);
    _addViewportSnapshotElement(result, seen, document.body);
    const selectors = [
      '#gb-layout-root',
      '#legacy-views',
      '#main-views',
      '#right-panel',
      '.gb-pane-content',
      '.gb-pane-tabs-scroll',
      '#outliner-tree',
      '#folder-grid',
      '#page-content',
      '#entity-freetext',
      '#db-view-container',
      '#compare-view',
      '#media-view',
      '#html-view',
      '#csv-view',
      '#gb-preview-pane',
      '#rp-detail',
      '#rp-chat',
      '#rp-history',
      '#rp-annotation',
      '[data-bd-role]',
      '[data-scroll-key]',
      '[style*="overflow"]',
      '[class*="scroll"]'
    ];
    try {
      document.querySelectorAll(selectors.join(',')).forEach(el => _addViewportSnapshotElement(result, seen, el));
    } catch {}
    let cur = document.activeElement;
    let guard = 0;
    while (cur && cur !== document.body && guard < 8) {
      _addViewportSnapshotElement(result, seen, cur);
      cur = cur.parentElement;
      guard += 1;
    }
    return result;
  }

  function _captureViewportSnapshot() {
    const scroll = new Map();
    const entries = [];
    const nodes = _collectViewportSnapshotElements();
    nodes.forEach((el, index) => {
      if (!el || typeof el.scrollTop !== 'number' || typeof el.scrollLeft !== 'number') return;
      const canScroll = (el.scrollHeight > el.clientHeight + 1) || (el.scrollWidth > el.clientWidth + 1);
      if (!canScroll && !el.scrollTop && !el.scrollLeft) return;
      const key = _scrollSnapshotKey(el, index);
      if (key) {
        const pos = { top: el.scrollTop, left: el.scrollLeft };
        scroll.set(key, pos);
        entries.push({ key, id: el.id || '', el, top: pos.top, left: pos.left });
      }
    });
    let board = null;
    try {
      if (typeof bd !== 'undefined' && bd?.path) {
        board = { path: bd.path, zoom: bd.zoom, panX: bd.panX, panY: bd.panY, rotation: bd.rotation };
      }
    } catch {}
    return { scroll, entries, board };
  }

  function _restoreScrollSnapshotEntry(entry) {
    if (!entry) return false;
    let el = entry.el && entry.el.isConnected ? entry.el : null;
    if (!el && entry.id) el = document.getElementById(entry.id);
    if (!el) return false;
    if (typeof el.scrollTop === 'number') el.scrollTop = entry.top;
    if (typeof el.scrollLeft === 'number') el.scrollLeft = entry.left;
    return true;
  }

  function _restoreViewportSnapshot(snapshot) {
    if (!snapshot) return;
    const restoredKeys = new Set();
    if (Array.isArray(snapshot.entries)) {
      snapshot.entries.forEach(entry => {
        if (_restoreScrollSnapshotEntry(entry)) restoredKeys.add(entry.key);
      });
    }
    if (snapshot.scroll instanceof Map && restoredKeys.size < snapshot.scroll.size) {
      const nodes = _collectViewportSnapshotElements();
      nodes.forEach((el, index) => {
        const key = _scrollSnapshotKey(el, index);
        if (!key || restoredKeys.has(key)) return;
        const pos = snapshot.scroll.get(key);
        if (!pos) return;
        if (typeof el.scrollTop === 'number') el.scrollTop = pos.top;
        if (typeof el.scrollLeft === 'number') el.scrollLeft = pos.left;
        restoredKeys.add(key);
      });
    }
    try {
      if (snapshot.board && typeof bd !== 'undefined' && bd?.path === snapshot.board.path) {
        bd.zoom = snapshot.board.zoom;
        bd.panX = snapshot.board.panX;
        bd.panY = snapshot.board.panY;
        bd.rotation = snapshot.board.rotation;
        if (typeof bdTransform === 'function') bdTransform();
      }
    } catch {}
  }

  function _isPaneInteractivePointerTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest([
      'input',
      'textarea',
      'select',
      'button',
      'a[href]',
      '[contenteditable="true"]',
      '[role="button"]',
      '.gb-tab',
      '.gb-pane-tabs',
      '.gb-pane-ctrls',
      '.gb-pane-nav-ctrls',
      '.gb-context-menu',
      '.modal',
      '.cf-modal',
    ].join(','));
  }

  function _isChatInputFocusNode(node) {
    if (!node || !(node instanceof Element)) return false;
    return !!node.closest('#chat-rich-input, #chat-input, .chat-rich-input');
  }

  function _blurFocusedChatInputForWorkPanePointer(node, target) {
    if (!target || !(target instanceof Element)) return;
    if (!target.closest('.gb-pane-content')) return;
    const activeTab = node?.tabs?.[node?.activeTabIndex];
    if (!activeTab || activeTab.type === 'chat') return;
    if (_isNavPaneType && _isNavPaneType(activeTab.type)) return;
    const active = document.activeElement;
    if (!_isChatInputFocusNode(active)) return;
    active.blur?.();
  }

  function _isPaneWorkContentPointerTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest([
      '#db-view-container',
      '#pivot-view',
      '.pivot-view',
      '.pivot-table',
      'td[data-prop-name]',
      'td.col-entity',
      '.value-text',
      '.relation-link',
      '.multi-select-tag',
      '.cell-checkbox',
      '.cell-select-val',
      '.entity-row-more-btn',
      '.cell-add-btn',
      '.db-action-btn',
      '#timeline-view',
      '.tl-grid',
      '.tl-card',
      '#gallery-view',
      '.gallery-view',
      '.db-gallery-card',
      '#kanban-view',
      '.kanban-view',
      '.kanban-card',
      '#smart-db-view',
      '#page-view',
      '#page-content',
      '#entity-view',
      '#entity-freetext',
      '.gb-scriptnote-root',
      '#board-view',
      '#bd-canvas',
      '#bd-world',
      '#folder-view',
      '#folder-grid',
    ].join(','));
  }

  function _shouldPreserveActivePaneForNavContentPointer(node, target) {
    if (!_activePane || !_paneMap[_activePane] || _activePane === node?.id) return false;
    if (!target || !(target instanceof Element)) return false;
    const activeTab = node?.tabs?.[node?.activeTabIndex];
    if (!(_isNavPaneType && _isNavPaneType(activeTab?.type))) return false;
    return !!target.closest('.gb-pane-content');
  }

  function _activatePaneAfterCurrentPointerClick(paneId) {
    setActivePane(paneId, { skipCallback: true });
    let done = false;
    let fallbackTimer = null;
    let pointerUpTimer = null;
    const cleanup = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', finish, true);
      if (fallbackTimer != null) clearTimeout(fallbackTimer);
      if (pointerUpTimer != null) clearTimeout(pointerUpTimer);
    };
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      setTimeout(() => {
        if (_activePane === paneId) setActivePane(paneId, { sync: true });
      }, 0);
    };
    const onClick = () => finish();
    const onPointerUp = () => {
      if (pointerUpTimer == null) pointerUpTimer = setTimeout(finish, 80);
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', finish, true);
    fallbackTimer = setTimeout(finish, 2000);
  }

  function setActivePane(paneId, opts) {
    // unmount 済みペイン（他グループに属する等）への切替は無視する。
    // グループ切替直後の幽霊ID指し防止。
    if (paneId && !_paneMap[paneId]) return;
    const sync = !!(opts && opts.sync);
    const prev = _activePane;
    _activePane = paneId;
    _writeActivePaneToStorage();

    // CSSクラス更新（常に同期。青枠の視覚表示）
    if (prev && _paneMap[prev]) {
      _paneMap[prev].el.classList.remove('gb-pane-active');
    }
    if (_paneMap[paneId]) {
      _paneMap[paneId].el.classList.add('gb-pane-active');
    }
    if (opts && opts.skipCallback) return;

    // _onActivePaneChange → _mountAllPanes がスクロール位置を壊す可能性があるため、
    // 全ペインのスクロール位置を保存し、コールバック後に復元する。
    // pointerdown 経由のコンテンツクリックは _activatePaneAfterCurrentPointerClick で
    // click 配信後に同期コールバックへ進める。
    // navOpen 等の直後処理に依存する呼び出しは { sync: true } で同期実行する。
    const runCallback = () => {
      if (_activePane !== paneId) return;
      const viewportSnap = _captureViewportSnapshot();
      if (_onActivePaneChange) _onActivePaneChange(paneId, prev);
      _restoreViewportSnapshot(viewportSnap);
      queueMicrotask(() => _restoreViewportSnapshot(viewportSnap));
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => _restoreViewportSnapshot(viewportSnap));
      setTimeout(() => _restoreViewportSnapshot(viewportSnap), 80);
    };
    if (sync) runCallback();
    else queueMicrotask(runCallback);
  }
