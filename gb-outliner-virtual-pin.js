/**
 * gb-outliner-virtual-pin.js
 *
 * フォルダツリーの「固定される親階層行」（§2.3-1）と、補助導線「この階層を閉じる」
 * 「すべて閉じる」（§2.3 末尾）を担当する。
 *
 * 計画: app/docs/folder-tree-thumbnail-large-branch-interaction-plan-2026-07-31.md
 *       §2.3-1（固定される親階層行）、§2.3 補助導線、§4.1-5（スタイル/アクセシビリティ）
 *
 * 固定祖先の検出はDOMジオメトリベース（elementFromPoint→.closestチェーン）で行う。
 * 仮想化コンテナ（gb-outliner-virtual-render.js）内であっても「現在ビューポート上端に
 * 見えている行」は常に実DOM要素として存在するため、この方式は仮想化の有無に関わらず
 * 均一に動作する（仮想化専用の別経路を持たない）。
 *
 * 依存（実行時に参照する既存グローバル）:
 *   GBOutlinerVirtualRender（onScrollTick購読）、GBOutlinerInput（blank判定）、
 *   _outlinerCreateContextMenu, _outlinerAppendMenuItem, _outlinerPlaceContextMenu,
 *   closeTreeContextMenu, lucide, _getZoom
 */
(function () {
  'use strict';

  var MAX_PINNED = 3;
  var _bar = null;
  var _lastAncestorKey = '';

  function _scroller() { return document.getElementById('tree-scroll-container'); }

  function _stablePinnedControlId(prefix, path) {
    var value = String(path || 'unknown');
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return prefix + '-' + (hash >>> 0).toString(36);
  }

  function _ensureBar() {
    if (_bar && _bar.isConnected) return _bar;
    var scroller = _scroller();
    if (!scroller) return null;
    var bar = document.createElement('div');
    bar.id = 'tree-pinned-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '現在の階層（固定表示）');
    bar.style.display = 'none';
    scroller.insertBefore(bar, scroller.firstChild);
    _bar = bar;
    return bar;
  }

  // ------------------------------------------------------------
  // この階層を閉じる（§2.3-1）
  // 閉じた後は当該フォルダ行へフォーカスを戻し、スクロール位置を不自然に先頭へ
  // 飛ばさない（現在深く潜っていた場合は、閉じたフォルダ行がその場で新しい上端になる）。
  // ------------------------------------------------------------
  function _virtualOwnerFor(nodeRef) {
    if (nodeRef && nodeRef._virtualOwnerContainer) return nodeRef._virtualOwnerContainer;
    var parent = nodeRef && nodeRef.parentElement;
    return parent && parent._virtualState ? parent : null;
  }

  function _virtualEntryFor(owner, path) {
    var state = owner && owner._virtualState;
    if (!state || !Array.isArray(state.flat) || !path) return null;
    return state.flat.find(function (entry) { return entry && entry.id === path; }) || null;
  }

  function _logicalNodeRef(owner, entry) {
    return {
      _nodeData: entry.data || {},
      _virtualOwnerContainer: owner,
      _virtualPath: entry.id,
    };
  }

  function _resolveNodeElement(nodeRef) {
    if (nodeRef && typeof nodeRef.querySelector === 'function') return nodeRef;
    var owner = _virtualOwnerFor(nodeRef);
    var state = owner && owner._virtualState;
    var path = nodeRef && (nodeRef._virtualPath || (nodeRef._nodeData && nodeRef._nodeData.path));
    var entry = _virtualEntryFor(owner, path);
    if (!state || !entry) return null;
    var mounted = state.mountedById && state.mountedById.get(path);
    if (mounted && mounted.isConnected) return mounted;
    var index = state.flat.indexOf(entry);
    var renderer = window.GBOutlinerVirtualRender;
    return renderer && typeof renderer.ensureLogicalIndexMounted === 'function'
      ? renderer.ensureLogicalIndexMounted(owner, index)
      : null;
  }

  function _offsetWithinScroller(el, scroller) {
    var elRect = el.getBoundingClientRect();
    var scRect = scroller.getBoundingClientRect();
    return (elRect.top - scRect.top) + scroller.scrollTop;
  }

  function _focusRowWithoutScrolling(row) {
    if (!row) return;
    try { row.focus({ preventScroll: true }); } catch (e) { row.focus(); }
  }

  function _returnToSourceRow(nodeEl) {
    var resolvedNode = _resolveNodeElement(nodeEl);
    var row = resolvedNode && resolvedNode.querySelector(':scope > .tree-node-row');
    if (!row) return false;
    var virtualOwner = _virtualOwnerFor(resolvedNode);
    var virtualEntry = _virtualEntryFor(
      virtualOwner,
      resolvedNode._nodeData && resolvedNode._nodeData.path
    );
    var stableNodeRef = virtualEntry ? _logicalNodeRef(virtualOwner, virtualEntry) : resolvedNode;
    var scroller = _scroller();
    if (scroller) {
      var pinnedHeight = _bar && _bar.isConnected && _bar.style.display !== 'none'
        ? _bar.offsetHeight
        : 0;
      scroller.scrollTop = Math.max(0, _offsetWithinScroller(row, scroller) - pinnedHeight);
    } else {
      row.scrollIntoView({ block: 'start', inline: 'nearest' });
    }
    _focusRowWithoutScrolling(row);
    requestAnimationFrame(function () {
      var latestNode = _resolveNodeElement(stableNodeRef);
      var latestRow = latestNode && latestNode.querySelector(':scope > .tree-node-row');
      if (latestRow && latestRow.isConnected) _focusRowWithoutScrolling(latestRow);
    });
    return true;
  }

  function closeBranch(nodeEl) {
    var resolvedNode = _resolveNodeElement(nodeEl);
    if (!resolvedNode) return false;
    var row = resolvedNode.querySelector(':scope > .tree-node-row');
    var toggle = row && row.querySelector('.tree-toggle');
    if (!toggle || toggle.dataset.expanded !== 'true') return false;
    var virtualOwner = _virtualOwnerFor(resolvedNode);
    var virtualEntry = _virtualEntryFor(
      virtualOwner,
      resolvedNode._nodeData && resolvedNode._nodeData.path
    );
    var stableNodeRef = virtualEntry ? _logicalNodeRef(virtualOwner, virtualEntry) : resolvedNode;
    var scroller = _scroller();
    var wasDeep = false;
    if (scroller) {
      var rowRect = row.getBoundingClientRect();
      var scRect = scroller.getBoundingClientRect();
      wasDeep = rowRect.top < scRect.top || rowRect.bottom > scRect.bottom;
    }
    toggle.click(); // 折りたたみは同期処理（part01.part02.js側のelse分岐）
    // ネスト仮想行はcollapseNested→refreshで同じ論理親のDOM自体が同期再生成される。
    // click前のdetached行へfocusせず、安定パスから再マウント後の行を取り直す。
    var focusNode = _resolveNodeElement(stableNodeRef) || resolvedNode;
    var focusRow = focusNode.querySelector(':scope > .tree-node-row') || row;
    if (scroller && wasDeep && focusRow.isConnected) {
      var target = Math.max(0, _offsetWithinScroller(focusRow, scroller));
      scroller.scrollTop = target;
    }
    _focusRowWithoutScrolling(focusRow);
    return true;
  }

  function collapseAll(scopeSelector) {
    var scope = scopeSelector || '#outliner-tree, #body-home, #body-workspaces';
    var toggles = Array.from(document.querySelectorAll(scope))
      .flatMap(function (root) { return Array.from(root.querySelectorAll('.tree-toggle[data-expanded="true"]')); })
      .filter(function (toggle) { return !_virtualOwnerFor(toggle.closest('.tree-node')); });
    var virtualCollapsedCount = 0;
    var renderer = window.GBOutlinerVirtualRender;
    if (renderer && typeof renderer.activeContainers === 'function') {
      renderer.activeContainers().forEach(function (owner) {
        var state = owner && owner._virtualState;
        if (!state || !state.expandedIds || !state.expandedIds.size) return;
        virtualCollapsedCount += state.expandedIds.size;
        if (typeof saveExpandedState === 'function') {
          state.expandedIds.forEach(function (path) { saveExpandedState(path, false); });
        }
        state.expandedIds.clear();
        if (typeof renderer.refresh === 'function') renderer.refresh(owner);
      });
    }
    // 深い階層から閉じる（子の後始末を先に済ませてから親を閉じるほうが安全）
    var withDepth = toggles.map(function (t) {
      var depth = 0;
      var el = t.closest('.tree-node');
      while (el && el.parentElement) {
        var parentNode = el.parentElement.closest('.tree-node');
        if (!parentNode) break;
        depth++;
        el = parentNode;
      }
      return { toggle: t, depth: depth };
    });
    withDepth.sort(function (a, b) { return b.depth - a.depth; });
    withDepth.forEach(function (entry) {
      if (entry.toggle.isConnected && entry.toggle.dataset.expanded === 'true') entry.toggle.click();
    });
    var collapsedCount = withDepth.length + virtualCollapsedCount;
    if (typeof showStatus === 'function' && collapsedCount) {
      showStatus(collapsedCount + ' 件のフォルダを閉じました');
    }
  }

  // ------------------------------------------------------------
  // 固定祖先バーの描画
  // ------------------------------------------------------------
  function _ancestorChain(fromNode) {
    var chain = [];
    var seenPaths = new Set();
    function appendUnique(nodeRef) {
      var nodePath = nodeRef && nodeRef._nodeData && nodeRef._nodeData.path;
      if (nodePath && seenPaths.has(nodePath)) return;
      if (nodePath) seenPaths.add(nodePath);
      chain.push(nodeRef);
    }
    var owner = _virtualOwnerFor(fromNode);
    var path = fromNode && (fromNode._virtualPath || (fromNode._nodeData && fromNode._nodeData.path));
    var entry = _virtualEntryFor(owner, path);
    var state = owner && owner._virtualState;
    while (entry && entry.parentId != null && chain.length < MAX_PINNED) {
      var parentEntry = _virtualEntryFor(owner, entry.parentId);
      if (!parentEntry) break;
      var mountedParent = state.mountedById && state.mountedById.get(parentEntry.id);
      appendUnique(mountedParent && mountedParent.isConnected
        ? mountedParent
        : _logicalNodeRef(owner, parentEntry));
      entry = parentEntry;
    }

    // 仮想コンテナ自体の外側にある通常DOM祖先も同じ近傍3件へ接続する。
    var cur = owner
      ? owner.closest('.tree-node')
      : (fromNode && fromNode.parentElement ? fromNode.parentElement.closest('.tree-node') : null);
    while (cur && chain.length < MAX_PINNED) {
      appendUnique(cur);
      cur = cur.parentElement ? cur.parentElement.closest('.tree-node') : null;
    }
    return chain.reverse(); // root寄り → 直近の順
  }

  function _topVisibleTreeNode(scroller, barHeight) {
    var rect = scroller.getBoundingClientRect();
    // 深いネスト（インデント）だと左寄りの座標は行の外側（親コンテナの余白）に落ちて
    // ヒットテストに失敗するため、行が確実にかぶる右寄りを第一候補にする
    // （行は right:0 で右端まで伸びるため、ネスト深さに関わらず安定する）。
    var y = rect.top + barHeight + 2;
    if (y >= rect.bottom) return null;
    // モバイルドロワーでは右端に閉じハンドル等が重なることがあるため、単一の最前面要素
    // だけでなく下層スタックと中央寄りの点も調べる。深いネストの左余白を避けつつ、
    // オーバーレイの有無に左右されず実際のツリー行を取得する。
    var xs = [rect.right - 20, rect.left + rect.width * 0.75, rect.left + rect.width * 0.5];
    for (var i = 0; i < xs.length; i++) {
      var stack = typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(xs[i], y)
        : [document.elementFromPoint(xs[i], y)];
      for (var j = 0; j < stack.length; j++) {
        var node = stack[j] && stack[j].closest ? stack[j].closest('.tree-node') : null;
        if (node && scroller.contains(node)) return node;
      }
    }
    return null;
  }

  function _renderPinnedRow(nodeEl) {
    var data = nodeEl._nodeData || {};
    var name = data.name || 'この階層';
    var row = document.createElement('div');
    row.className = 'tree-pinned-row';
    row.title = data.name || '';
    var label = document.createElement('button');
    label.type = 'button';
    label.className = 'tree-pinned-label';
    label.textContent = data.name || '';
    label.dataset.e2eId = _stablePinnedControlId('tree-pinned-return', data.path);
    if (data.path) label.dataset.treePath = data.path;
    label.setAttribute('aria-label', name + 'の元の位置へ移動');
    label.title = '元の位置へ移動';
    label.addEventListener('click', function () {
      _returnToSourceRow(nodeEl);
    });
    row.appendChild(label);
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tree-pinned-close';
    closeBtn.dataset.e2eId = _stablePinnedControlId('tree-pinned-close', data.path);
    if (data.path) closeBtn.dataset.treePath = data.path;
    closeBtn.setAttribute('aria-label', name + 'を閉じる');
    closeBtn.title = 'この階層を閉じる';
    closeBtn.innerHTML = typeof lucide === 'function' ? lucide('x', 12) : '×';
    var closeIcon = closeBtn.querySelector('svg');
    if (closeIcon) {
      closeIcon.setAttribute('aria-hidden', 'true');
      closeIcon.setAttribute('focusable', 'false');
    }
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeBranch(nodeEl);
    });
    row.appendChild(closeBtn);
    return row;
  }

  function _refreshPinnedBar() {
    var scroller = _scroller();
    var bar = _ensureBar();
    if (!scroller || !bar) return;
    var currentBarHeight = bar.style.display === 'none' ? 0 : bar.offsetHeight;
    var topNode = _topVisibleTreeNode(scroller, currentBarHeight);
    var chain = topNode ? _ancestorChain(topNode) : [];
    if (!chain.length) {
      if (bar.style.display !== 'none') { bar.style.display = 'none'; bar.innerHTML = ''; }
      _lastAncestorKey = '';
      return;
    }
    var key = chain.map(function (n) { return n._nodeData && n._nodeData.path; }).join('|');
    if (key === _lastAncestorKey && bar.style.display !== 'none') return; // 変化なし
    _lastAncestorKey = key;
    bar.innerHTML = '';
    chain.forEach(function (nodeEl) { bar.appendChild(_renderPinnedRow(nodeEl)); });
    bar.style.display = '';
  }

  // ------------------------------------------------------------
  // 補助導線メニュー配線
  // ------------------------------------------------------------
  function _blankMenuScopeFromTarget(target) {
    if (target && target.closest) {
      if (target.closest('#body-home')) return '#body-home';
      if (target.closest('#body-workspaces')) return '#body-workspaces';
      if (target.closest('#outliner-tree')) return '#outliner-tree';
    }
    return '#outliner-tree, #body-home, #body-workspaces';
  }

  function _wireBlankContextMenu() {
    // 注意: gb-outliner.part01.part01.js冒頭のcaptureフェーズリスナーが、#sidebar内の
    // 右クリックであれば（ブラウザ標準メニュー抑制のためだけに）無条件でpreventDefault()する。
    // そのリスナーはこのbubbleフェーズの本リスナーより先に実行されるため、
    // event.defaultPreventedを早期returnの条件にしてはいけない
    // （常にtrueになってしまい、ここへ到達する前に毎回抜けてしまう）。
    document.addEventListener('contextmenu', function (event) {
      var classify = window.GBOutlinerInput && window.GBOutlinerInput.classifyPointerTarget;
      if (!classify || classify(event.target) !== 'blank') return;
      if (typeof closeTreeContextMenu !== 'function' || typeof _outlinerCreateContextMenu !== 'function') return;
      event.preventDefault();
      closeTreeContextMenu();
      var scope = _blankMenuScopeFromTarget(event.target);
      var z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
      var menu = _outlinerCreateContextMenu('フォルダツリー全体メニュー', event.clientX / z, event.clientY / z);
      _outlinerAppendMenuItem(menu, {
        label: 'すべて閉じる',
        icon: 'chevronsUp',
        action: function () {
          closeTreeContextMenu();
          collapseAll(scope);
        },
      });
      _outlinerPlaceContextMenu(menu);
    }, false);
  }

  function init() {
    _ensureBar();
    // 仮想化コンテナが1つも無い（=render.js が自前ではscrollリスナーを登録しない）状態でも
    // 固定祖先バーは深いツリーで機能する必要があるため、ensureScrollListener()を無条件で呼び、
    // render.js側の共有rAFスロットル済みスクロールリスナーへ相乗りする。
    // かつてはここに専用の2本目のscrollリスナーを持っていたが、仮想化中は毎フレーム
    // _refreshPinnedBar()が二重に呼ばれ（elementFromPoint等のレイアウト強制読み取りが
    // 二重化し）50ms超のロングタスクの一因になっていたため撤去した（§7）。
    if (window.GBOutlinerVirtualRender) {
      if (typeof window.GBOutlinerVirtualRender.onScrollTick === 'function') {
        window.GBOutlinerVirtualRender.onScrollTick(_refreshPinnedBar);
      }
      if (typeof window.GBOutlinerVirtualRender.ensureScrollListener === 'function') {
        window.GBOutlinerVirtualRender.ensureScrollListener();
      }
    }
    _wireBlankContextMenu();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GBOutlinerVirtualPin = {
    closeBranch: closeBranch,
    collapseAll: collapseAll,
    refresh: _refreshPinnedBar,
  };
})();
