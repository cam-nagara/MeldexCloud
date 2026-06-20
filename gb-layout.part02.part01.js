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
    const panelSetApi = typeof GBPanelSet !== 'undefined' ? GBPanelSet : null;
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
          if (typeof panelSetApi?.renderGroupIconButton === 'function') {
            const btn = panelSetApi.renderGroupIconButton(n, g);
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
            const types = (typeof panelSetApi?.collectGroupTabTypes === 'function')
              ? panelSetApi.collectGroupTabTypes(g.root) : [];
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
      dragHandle.draggable = _showFreeLayoutUi();
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
      if (_showFreeLayoutUi()) bar.appendChild(dragHandle);

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
    if (!_showFreeLayoutUi()) {
      handle.classList.add('gb-split-handle-resize-only');
    }
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
    if (_showFreeLayoutUi()) {
      handle.appendChild(_makeCollapseBtn(0));
      handle.appendChild(_makeCollapseBtn(1));
    }
    if (_showFreeLayoutUi() && node.direction === 'horizontal') {
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

  function _layoutAttrEscape(value) {
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  function _axisSplitElement(splitNode) {
    if (!splitNode?.id) return null;
    const candidates = Array.from(document.querySelectorAll(`.gb-split[data-split-id="${_layoutAttrEscape(splitNode.id)}"]`))
      .filter(el => !el.closest?.('[data-gb-snapshot="true"]'));
    return candidates.find((el) => {
      const rect = el.getBoundingClientRect?.();
      return rect && rect.width > 0 && rect.height > 0;
    }) || candidates[0] || null;
  }

  function _axisElementSize(el, direction) {
    const rect = el?.getBoundingClientRect?.();
    if (!rect) return 0;
    return (direction === 'horizontal' ? rect.width : rect.height) / _splitZoom();
  }

  function _axisPickElement(selector, direction) {
    const candidates = Array.from(document.querySelectorAll(selector))
      .filter(el => !el.closest?.('[data-gb-snapshot="true"]'));
    const renderedSize = el => Math.max(_axisElementSize(el, direction), _axisElementSize(el?.closest?.('.gb-split-child'), direction));
    return candidates.find(el => renderedSize(el) > 0) || candidates[0] || null;
  }
  function _axisNodeElement(node, direction) {
    if (!node?.id) return null;
    const id = _layoutAttrEscape(node.id);
    if (node.type === 'pane') return _axisPickElement(`[data-pane-id="${id}"]`, direction);
    if (node.type === 'panelset') return _axisPickElement(`[data-column-node-id="${id}"]`, direction);
    if (node.type === 'split') return _axisSplitElement(node);
    return null;
  }

  function _axisInlineRoot(node, direction) {
    if (!node || node.type !== 'panelset' || node.collapsed) return null;
    const active = Array.isArray(node.groups) ? node.groups.find(g => g && g.id === node.activeGroupId) : null;
    const root = active?.root || null;
    return root?.type === 'split' && root.direction === direction && !root.collapsed ? root : null;
  }

  function _axisPanelsetExtra(node, direction) {
    if (direction !== 'horizontal' || !_axisInlineRoot(node, direction)) return 0;
    const col = _axisNodeElement(node, direction);
    const body = col?.querySelector?.(':scope > .gb-dock-body');
    return Math.max(0, _axisElementSize(col, direction) - _axisElementSize(body, direction));
  }

  function _axisSegmentSize(node, direction) {
    const el = _axisNodeElement(node, direction);
    const parent = node?.id ? findParent(_root, node.id)?.node : null;
    let wrapper = null;
    if (parent?.type === 'split' && parent.direction === direction) {
      const splitEl = _axisSplitElement(parent);
      const firstHasNode = !!findNode(parent.children?.[0], node.id);
      wrapper = splitEl?.querySelector?.(firstHasNode ? ':scope > .gb-split-first' : ':scope > .gb-split-second') || null;
    }
    return Math.max(
      _axisElementSize(wrapper, direction),
      _axisElementSize(el, direction),
      _axisElementSize(el?.closest?.('.gb-split-child'), direction)
    );
  }

  function _collectAxisSegments(node, direction, out = []) {
    const inlineRoot = _axisInlineRoot(node, direction);
    if (inlineRoot) return _collectAxisSegments(inlineRoot, direction, out);
    if (node?.type === 'split' && node.direction === direction && !node.collapsed && Array.isArray(node.children)) {
      _collectAxisSegments(node.children[0], direction, out);
      _collectAxisSegments(node.children[1], direction, out);
      return out;
    }
    if (node) out.push(node);
    return out;
  }

  function _collectAxisSplits(node, direction, out = []) {
    const inlineRoot = _axisInlineRoot(node, direction);
    if (inlineRoot) return _collectAxisSplits(inlineRoot, direction, out);
    if (node?.type === 'split' && node.direction === direction && !node.collapsed && Array.isArray(node.children)) {
      out.push(node);
      _collectAxisSplits(node.children[0], direction, out);
      _collectAxisSplits(node.children[1], direction, out);
    }
    return out;
  }

  function _findAxisEdgeSegment(node, direction, edge) {
    const inlineRoot = _axisInlineRoot(node, direction);
    if (inlineRoot) return _findAxisEdgeSegment(inlineRoot, direction, edge);
    if (node?.type === 'split' && node.direction === direction && !node.collapsed && Array.isArray(node.children)) {
      return _findAxisEdgeSegment(edge === 'last' ? node.children[1] : node.children[0], direction, edge);
    }
    return node || null;
  }

  function _axisSpan(node, direction, segmentSizes, handleSizes) {
    const inlineRoot = _axisInlineRoot(node, direction);
    if (inlineRoot) return _axisSpan(inlineRoot, direction, segmentSizes, handleSizes) + _axisPanelsetExtra(node, direction);
    if (node?.type === 'split' && node.direction === direction && !node.collapsed && Array.isArray(node.children)) {
      return _axisSpan(node.children[0], direction, segmentSizes, handleSizes)
        + _axisSpan(node.children[1], direction, segmentSizes, handleSizes)
        + (handleSizes.get(node.id) || 0);
    }
    return segmentSizes.get(node?.id) || 0;
  }

  function _setAxisSplitChildSizes(splitNode, direction, firstSize, secondSize, unit) {
    const splitEl = _axisSplitElement(splitNode);
    const first = splitEl?.querySelector?.(':scope > .gb-split-first');
    const second = splitEl?.querySelector?.(':scope > .gb-split-second');
    if (!first || !second) return;
    const key = direction === 'horizontal' ? 'width' : 'height';
    first.style.flex = 'none';
    second.style.flex = 'none';
    first.style[key] = `${firstSize}${unit}`;
    second.style[key] = `${secondSize}${unit}`;
  }

  function _applyAxisResizeTree(node, direction, segmentSizes, handleSizes, unit) {
    const inlineRoot = _axisInlineRoot(node, direction);
    if (inlineRoot) return _applyAxisResizeTree(inlineRoot, direction, segmentSizes, handleSizes, unit);
    if (node?.type !== 'split' || node.direction !== direction || node.collapsed || !Array.isArray(node.children)) return;
    const firstSpan = _axisSpan(node.children[0], direction, segmentSizes, handleSizes);
    const secondSpan = _axisSpan(node.children[1], direction, segmentSizes, handleSizes);
    const total = firstSpan + secondSpan;
    if (total > 0) node.ratio = Math.max(0.01, Math.min(0.99, firstSpan / total));
    if (unit === '%') {
      const containerSpan = total + (handleSizes.get(node.id) || 0);
      const firstPct = containerSpan > 0 ? (firstSpan / containerSpan) * 100 : node.ratio * 100;
      const secondPct = containerSpan > 0 ? (secondSpan / containerSpan) * 100 : (100 - node.ratio * 100);
      _setAxisSplitChildSizes(node, direction, firstPct.toFixed(2), secondPct.toFixed(2), '%');
    }
    else _setAxisSplitChildSizes(node, direction, firstSpan, secondSpan, 'px');
    _applyAxisResizeTree(node.children[0], direction, segmentSizes, handleSizes, unit);
    _applyAxisResizeTree(node.children[1], direction, segmentSizes, handleSizes, unit);
  }

  function _createBoundaryResizeSession(e, node) {
    const direction = node.direction;
    let axisRoot = node;
    let parent = findParent(_root, axisRoot.id)?.node;
    while (parent?.type === 'split' && parent.direction === direction) {
      axisRoot = parent;
      parent = findParent(_root, axisRoot.id)?.node;
    }
    const left = _findAxisEdgeSegment(node.children?.[0], direction, 'last');
    const right = _findAxisEdgeSegment(node.children?.[1], direction, 'first');
    const segments = _collectAxisSegments(axisRoot, direction);
    const leftIndex = segments.indexOf(left);
    if (!left?.id || !right?.id || leftIndex < 0 || segments[leftIndex + 1] !== right) {
      return null;
    }
    const segmentSizes = new Map();
    const handleSizes = new Map();
    for (const segment of segments) {
      const size = _axisSegmentSize(segment, direction);
      if (!Number.isFinite(size) || size <= 0) {
        return null;
      }
      segmentSizes.set(segment.id, size);
    }
    _collectAxisSplits(axisRoot, direction).forEach(split => {
      const rect = _axisSplitElement(split)?.querySelector?.(':scope > .gb-split-handle')?.getBoundingClientRect?.();
      handleSizes.set(split.id, rect ? ((direction === 'horizontal' ? rect.width : rect.height) / _splitZoom()) : 0);
    });
    const leftStart = segmentSizes.get(left.id) || 0;
    const rightStart = segmentSizes.get(right.id) || 0;
    const pairTotal = leftStart + rightStart;
    if (pairTotal < MIN_PANE_SIZE * 2) return null;
    const startPos = direction === 'horizontal' ? _splitLogicalCoord(e.clientX) : _splitLogicalCoord(e.clientY);
    const clampLeft = value => Math.max(MIN_PANE_SIZE, Math.min(pairTotal - MIN_PANE_SIZE, value));
    _applyAxisResizeTree(axisRoot, direction, segmentSizes, handleSizes, 'px');
    return {
      move(ev) {
        const pos = direction === 'horizontal' ? _splitLogicalCoord(ev.clientX) : _splitLogicalCoord(ev.clientY);
        const leftSize = clampLeft(leftStart + pos - startPos);
        segmentSizes.set(left.id, leftSize);
        segmentSizes.set(right.id, pairTotal - leftSize);
        _applyAxisResizeTree(axisRoot, direction, segmentSizes, handleSizes, 'px');
      },
      finish() {
        _applyAxisResizeTree(axisRoot, direction, segmentSizes, handleSizes, '%');
      },
    };
  }

  function _setupResizeHandle(handle, node, splitEl, firstEl) {
    const _getSecondEl = () => firstEl.nextElementSibling?.nextElementSibling || null;
    const _sizeKey = node.direction === 'horizontal' ? 'width' : 'height';
    let resizeHistoryBefore = null;
    let resizeStartRatio = null;
    let boundaryResizeSession = null;
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
      const bounds = _keyboardResizeRatioBounds();
      handle.tabIndex = 0;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', node.direction === 'horizontal' ? 'vertical' : 'horizontal');
      handle.setAttribute('aria-label', node.direction === 'horizontal' ? '左右パネル幅を調整' : '上下パネル高さを調整');
      handle.setAttribute('aria-valuemin', String(Math.round(bounds.min * 100)));
      handle.setAttribute('aria-valuemax', String(Math.round(bounds.max * 100)));
      handle.setAttribute('aria-valuenow', String(Math.round((node.ratio || 0.5) * 100)));
    };
    const _keyboardResizeRatioBounds = () => {
      let min = 0.05;
      let max = 0.95;
      const secondEl = _getSecondEl();
      if (!secondEl) return { min, max, canResize: false };
      const splitRect = _splitLogicalRect(splitEl.getBoundingClientRect());
      const handleRect = _splitLogicalRect(handle.getBoundingClientRect());
      const totalSize = node.direction === 'horizontal' ? splitRect.width : splitRect.height;
      const handleSize = node.direction === 'horizontal' ? handleRect.width : handleRect.height;
      const contentSize = totalSize - handleSize;
      if (contentSize > 0) {
        const minByPx = MIN_PANE_SIZE / contentSize;
        if (minByPx > 0.5) return { min: 0.5, max: 0.5, canResize: false };
        min = Math.max(min, minByPx);
        max = Math.min(max, 1 - minByPx);
      }
      return { min, max, canResize: min <= max };
    };
    const _commitKeyboardResize = (delta) => {
      const secondEl = _getSecondEl();
      if (!secondEl || node.children?.[0]?.collapsed || node.children?.[1]?.collapsed) return;
      const before = captureLayoutSnapshot();
      const bounds = _keyboardResizeRatioBounds();
      if (!bounds.canResize) return;
      const nextRatio = Math.max(bounds.min, Math.min(bounds.max, (node.ratio || 0.5) + delta));
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
      if (boundaryResizeSession) {
        boundaryResizeSession.move(e);
        return;
      }
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
      if (boundaryResizeSession) {
        boundaryResizeSession.finish();
        boundaryResizeSession = null;
      } else {
        _setChildRatioSizes(node.ratio);
      }
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
      boundaryResizeSession = null;
      const secondEl = _getSecondEl();
      if (!secondEl || node.children?.[0]?.collapsed || node.children?.[1]?.collapsed) return;
      resizeHistoryBefore = captureLayoutSnapshot();
      resizeStartRatio = node.ratio;
      boundaryResizeSession = _createBoundaryResizeSession(e, node);
      if (!boundaryResizeSession) {
        const zoom = _splitZoom();
        const firstRect = firstEl.getBoundingClientRect();
        const secondRect = secondEl.getBoundingClientRect();
        const firstSize = (node.direction === 'horizontal' ? firstRect.width : firstRect.height) / zoom;
        const secondSize = (node.direction === 'horizontal' ? secondRect.width : secondRect.height) / zoom;
        _setChildPxSizes(firstSize, secondSize);
      }
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
