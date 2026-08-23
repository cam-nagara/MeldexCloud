  if (!toggle || toggle.dataset.expanded === undefined) return false;
  const expanded = toggle.dataset.expanded === 'true';
  if (expand === true && !expanded) { toggle.click(); return true; }
  if (expand === false && expanded) { toggle.click(); return true; }
  return false;
}

function _outlinerKeyboardIsExpandable(nodeEl) {
  const toggle = nodeEl?.querySelector?.(':scope > .tree-node-row .tree-toggle') || null;
  return !!toggle && toggle.dataset.expanded !== undefined;
}

function _outlinerKeyboardIsExpanded(nodeEl) {
  const toggle = nodeEl?.querySelector?.(':scope > .tree-node-row .tree-toggle') || null;
  return !!toggle && toggle.dataset.expanded === 'true';
}

// 標準Tree View操作（§2.4）: 閉じている子項目なら親へ選択を移す
function _outlinerKeyboardParentNode(nodeEl) {
  const container = nodeEl?.parentElement || null;
  return container?.closest?.('.tree-node') || null;
}

// 標準Tree View操作（§2.4）: 展開済みの親なら最初の子へ選択を移す
function _outlinerKeyboardFirstChildNode(nodeEl) {
  const childrenDiv = nodeEl?.querySelector?.(':scope > .tree-children') || null;
  return childrenDiv?.querySelector?.(':scope > .tree-node') || null;
}

function _handleOutlinerTreeKeydown(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'F2'].includes(event.key)) return;
  const target = event.target;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const scopeSelector = _outlinerKeyboardScopeFromTarget(target);
  if (!scopeSelector) return;
  const current = _outlinerKeyboardNodeFromTarget(target, scopeSelector);
  event.preventDefault();
  event.stopPropagation();
  _outlinerKeyboardMarkActive();
  if (event.key === 'ArrowLeft') {
    if (!current) return;
    if (_outlinerKeyboardIsExpandable(current) && _outlinerKeyboardIsExpanded(current)) {
      _outlinerKeyboardToggle(current, false);
      return;
    }
    // 展開中でない（閉じた子項目・葉）場合は親へ選択を移す
    const parent = _outlinerKeyboardParentNode(current);
    if (parent) _outlinerKeyboardSelectNode(parent);
    return;
  }
  if (event.key === 'ArrowRight') {
    if (!current) return;
    if (_outlinerKeyboardIsExpandable(current)) {
      if (!_outlinerKeyboardIsExpanded(current)) {
        _outlinerKeyboardToggle(current, true);
        return;
      }
      // 展開済みなら最初の子へ選択を移す
      const firstChild = _outlinerKeyboardFirstChildNode(current);
      if (firstChild) {
        _outlinerKeyboardSelectNode(firstChild);
      } else {
        // 展開直後（子の読み込み中）に2打目のArrowRightが押された場合、
        // まだ子ノードがDOMに存在せずno-opになってしまう。読み込み完了後に
        // 最初の子へフォーカス移動するデフォルト動作を予約しておく
        // （gb-outliner.part01.part02.js の読み込み完了処理が消化する）。
        const childrenDiv = current.querySelector?.(':scope > .tree-children') || null;
        if (childrenDiv && childrenDiv.dataset.loading === 'true') {
          childrenDiv._outlinerPendingArrowRightFocusNode = current;
        }
      }
    }
    return;
  }
  if (event.key === 'Enter') {
    if (current) _outlinerKeyboardActivateNode(current);
    return;
  }
  if (event.key === 'F2') {
    if (current) _outlinerKeyboardStartRename(current);
    return;
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    if (_outlinerKeyboardTryVirtualStep(current, event.key)) return;
  }
  const nodes = _getVisibleTreeNodes(scopeSelector);
  if (!nodes.length) return;
  const rawIndex = nodes.indexOf(current);
  const currentIndex = rawIndex >= 0 ? rawIndex : (event.key === 'ArrowUp' ? 0 : -1);
  const nextIndex = event.key === 'ArrowUp'
    ? Math.max(0, currentIndex - 1)
    : Math.min(nodes.length - 1, currentIndex + 1);
  _outlinerKeyboardSelectNode(nodes[nextIndex]);
}

// 仮想化フォルダ(150件超)の直下の子は、表示範囲＋オーバースキャン分しか実DOM化されない
// （gb-outliner-virtual-render.js）。_getVisibleTreeNodes()はDOM実体限定のため、
// マウント範囲の境界（例: 220件中30件目で止まる）に達すると↓を押し続けても進めなくなり、
// 選択行がスクロールでアンマウント済みだとcurrent===nullになってnodes[0]（無関係な行）へ
// 飛んでしまう。この関数はUp/Downで「現在の選択が仮想化コンテナの内側にある」場合に、
// GBOutlinerVirtualの論理モデルを直接参照して次の論理行を求め、必要なら
// GBOutlinerVirtualRender.ensureLogicalIndexMounted()でスクロール補正+即時再マウントしてから
// 選択する。処理した場合はtrueを返し、呼び出し元はDOM実体限定のフォールバックへ進まない。
// 非仮想化フォルダ、または現在の選択が仮想化コンテナに属さない場合はfalseを返し、
// 既存の_getVisibleTreeNodes経路（親/兄弟への移動を含む）へそのまま委ねる
// （非仮想化フォルダの既存挙動は変更しない）。
function _outlinerKeyboardVirtualContainerFor(nodeEl) {
  const childrenDiv = nodeEl && nodeEl.parentElement;
  return (childrenDiv && childrenDiv.dataset && childrenDiv.dataset.virtual === 'true') ? childrenDiv : null;
}

function _outlinerKeyboardTryVirtualStep(current, key) {
  const vr = window.GBOutlinerVirtualRender;
  if (!vr || typeof vr.ensureLogicalIndexMounted !== 'function') return false;

  let childrenDiv = null;
  let path = null;
  let recoveringUnmounted = false;
  if (current) {
    childrenDiv = _outlinerKeyboardVirtualContainerFor(current);
    if (!childrenDiv) return false; // 非仮想化行の通常移動は既存経路(_getVisibleTreeNodes)に委ねる
    path = current._nodeData && current._nodeData.path;
  } else {
    // 選択行がアンマウント済み(current===null): treeSelection.lastClickedが保持する
    // 安定パス(._nodeData.path、DOM接続の有無に依存しない)から所属コンテナを復元する。
    const lastPath = treeSelection.lastClicked && treeSelection.lastClicked._nodeData && treeSelection.lastClicked._nodeData.path;
    if (!lastPath || typeof vr.containerForPath !== 'function') return false;
    childrenDiv = vr.containerForPath(lastPath);
    if (!childrenDiv) return false;
    path = lastPath;
    recoveringUnmounted = true;
  }

  const state = childrenDiv._virtualState;
  if (!state || !path) return false;
  const currentIndex = state.flat.findIndex(entry => entry.id === path);
  if (currentIndex < 0) return false;

  const delta = key === 'ArrowUp' ? -1 : 1;
  const nextIndex = Math.max(0, Math.min(state.flat.length - 1, currentIndex + delta));
  // コンテナの論理先頭/末尾に既に居て、これ以上コンテナ内側では動けない場合
  // （かつアンマウント復帰中でもない場合）は、親/兄弟への移動を含む既存経路に委ねる。
  if (nextIndex === currentIndex && !recoveringUnmounted) return false;

  const target = state.mountedByIndex.get(nextIndex) || vr.ensureLogicalIndexMounted(childrenDiv, nextIndex);
  if (!target) return false;
  _outlinerKeyboardSelectNode(target);
  return true;
}

(function initOutlinerTreeKeyboardNavigation() {
  const scroller = document.getElementById('tree-scroll-container');
  if (!scroller) return;
  if (!scroller.hasAttribute('tabindex')) scroller.tabIndex = 0;
  scroller.addEventListener('keydown', _handleOutlinerTreeKeydown);
})();

// ドラッグ中のホイールスクロール対応
(function() {
  let _isDragging = false;
  document.addEventListener('dragstart', () => { _isDragging = true; });
  document.addEventListener('dragend', () => { _isDragging = false; });
  document.addEventListener('drop', () => { _isDragging = false; });
  // ドラッグ中にホイールでスクロール可能にする
  const scrollTargets = ['tree-scroll-container'];
  scrollTargets.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('wheel', (e) => {
      if (!_isDragging) return;
      e.preventDefault();
      el.scrollTop += e.deltaY;
    }, { passive: false });
  });
})();

(function initOutlinerLassoSelection() {
  const scroller = document.getElementById('tree-scroll-container');
  if (!scroller) return;
  const LASSO_DRAG_THRESHOLD = 4;
  let active = false;
  let tracking = false;
  let box = null;
  let startX = 0;
  let startY = 0;
  let startClientX = 0;
  let startClientY = 0;
  let selectionMode = 'replace';
  let selectionScope = '#outliner-tree,#body-home';
  let baseSelection = [];
  let pointerId = null;
  let pointerCaptured = false;
  let _savedScrollerPosition = null;

  function _outlinerLassoMode(event) {
    if (event.ctrlKey || event.metaKey) return 'toggle';
    if (event.shiftKey) return 'add';
    return 'replace';
  }

  function _outlinerLassoScopeFromTarget(target) {
    if (target?.closest?.('#body-home')) return '#body-home';
    if (target?.closest?.('#body-workspaces')) return '#body-workspaces';
    if (target?.closest?.('#outliner-tree')) return '#outliner-tree';
    const section = target?.closest?.('.sidebar-section');
    if (section?.id === 'section-home') return '#body-home';
    if (section?.id === 'section-workspaces') return '#body-workspaces';
    if (section?.id === 'section-roots') return '#outliner-tree';
    return '#outliner-tree,#body-home';
  }

  // 空白ヒットテスト（§2.5・§4.1-2）: gb-outliner-input.js の共通入力判定モジュールへ委譲する。
  // 「明示コントロール」「項目行」のいずれでもない場合だけ矩形選択の待機対象にする。
  // 項目行（.tree-node-row）からの押下は、選択状態やmodifierキーに関わらず、
  // 矩形選択に一切入らない（ネイティブHTML5ドラッグ = 項目移動に判定を委ねる）。
  function _outlinerLassoIsBlankTarget(target) {
    if (window.GBOutlinerInput?.classifyPointerTarget) {
      return window.GBOutlinerInput.classifyPointerTarget(target) === 'blank';
    }
    // gb-outliner-input.js 未読込時のフォールバック（読み込み順に依存しないための保険）
    if (target?.closest?.('.tree-hover-btn, .tree-toggle, .tree-node-row, .sidebar-section-header, .fav-item, input, textarea, button, select, [contenteditable="true"]')) return false;
    if (target?.closest?.('#outliner-tree, #body-home, #body-workspaces')) return true;
    const section = target?.closest?.('.sidebar-section');
    if (section?.id === 'section-workspaces') return true;
    return section?.id === 'section-roots' || section?.id === 'section-home';
  }

  function _outlinerLassoRectForEvent(event) {
    const rect = scroller.getBoundingClientRect();
    const currentX = event.clientX - rect.left + scroller.scrollLeft;
    const currentY = event.clientY - rect.top + scroller.scrollTop;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  function _outlinerLassoRowRect(row) {
    const rowRect = row.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return {
      left: rowRect.left - scrollerRect.left + scroller.scrollLeft,
      top: rowRect.top - scrollerRect.top + scroller.scrollTop,
      right: rowRect.left - scrollerRect.left + scroller.scrollLeft + rowRect.width,
      bottom: rowRect.top - scrollerRect.top + scroller.scrollTop + rowRect.height,
    };
  }

  function _outlinerRectsOverlap(a, b) {
    return !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
  }

  const updateSelection = (lassoRect) => {
    const base = new Set(baseSelection.filter(node => node?.isConnected));
    const hitNodes = [];
    treeSelection.clear();
    base.forEach(node => treeSelection.add(node));
    _getVisibleTreeNodes(selectionScope).forEach(nodeEl => {
      const row = nodeEl.querySelector('.tree-node-row');
      if (!row) return;
      if (!_outlinerRectsOverlap(lassoRect, _outlinerLassoRowRect(row))) return;
      hitNodes.push(nodeEl);
      if (selectionMode === 'toggle' && base.has(nodeEl)) treeSelection.remove(nodeEl);
      else treeSelection.add(nodeEl);
    });
    treeSelection.lastClicked = hitNodes[hitNodes.length - 1] || [...treeSelection.items].pop() || treeSelection.lastClicked;
    if (treeSelection.items.size > 1) showStatus(treeSelection.items.size + ' 件選択中');
    // 仮想化コンテナ（フォルダツリー改修Phase3）: 現在マウントされていない行も、
    // 矩形の論理Y範囲から該当する表示モデルの行を求めて選択状態に反映する（§2.5）。
    if (window.GBOutlinerVirtualRender?.applyLassoSelection) {
      const basePaths = new Set([...base].map(node => node?._nodeData?.path).filter(Boolean));
      window.GBOutlinerVirtualRender.applyLassoSelection({
        lassoRect, scope: selectionScope, mode: selectionMode, basePaths,
      });
    }
  };

  const beginLasso = (event) => {
    if (active) return;
    active = true;
    if (!pointerCaptured && pointerId != null && scroller.setPointerCapture) {
      try {
        scroller.setPointerCapture(pointerId);
        pointerCaptured = true;
      } catch {}
    }
    box = document.createElement('div');
    box.className = 'outliner-lasso-box';
    _savedScrollerPosition = scroller.style.position;
    scroller.style.position = 'relative';
    scroller.appendChild(box);
    if (selectionMode === 'replace') treeSelection.clear();
    updateSelection(_outlinerLassoRectForEvent(event));
  };

  const endLasso = () => {
    if (!tracking && !active) return;
    const wasActive = active;
    active = false;
    tracking = false;
    removeDocumentPointerEndHandlers();
    box?.remove();
    box = null;
    if (pointerCaptured && pointerId != null && scroller.releasePointerCapture) {
      try { scroller.releasePointerCapture(pointerId); } catch {}
    }
    pointerId = null;
    pointerCaptured = false;
    // pointerdown で設定した inline position を元に戻す
    if (_savedScrollerPosition !== null) {
      scroller.style.position = _savedScrollerPosition;
      _savedScrollerPosition = null;
    }
    // 矩形選択は空白からしか開始しない（§2.5）ため、項目行クリックとの競合は起こらず、
    // 行クリック抑止のための暫定フラグ（フォルダツリー改修Phase 2で撤去済み）は不要になった。
    if (!wasActive && selectionMode === 'replace') treeSelection.clear();
  };

  function addDocumentPointerEndHandlers() {
    document.addEventListener('pointerup', endLasso, true);
    document.addEventListener('pointercancel', endLasso, true);
  }

  function removeDocumentPointerEndHandlers() {
    document.removeEventListener('pointerup', endLasso, true);
    document.removeEventListener('pointercancel', endLasso, true);
  }

  scroller.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.pointerType && e.pointerType !== 'mouse') return;
    // 空白ヒットテスト（§2.5）: 明示コントロール・項目行のいずれでもない場合だけ矩形選択を待機する。
    // 項目行から始まるドラッグは、選択状態やmodifierキーに関わらず矩形選択に一切入らない
    // （ネイティブHTML5ドラッグ = 項目移動にそのまま委ねる。行のdraggable属性を一時的に
    //   書き換えて競合を避ける旧来の暫定機構は撤去済み）。
    if (!_outlinerLassoIsBlankTarget(e.target)) return;
    selectionMode = _outlinerLassoMode(e);
    tracking = true;
    active = false;
    addDocumentPointerEndHandlers();
    pointerId = e.pointerId;
    pointerCaptured = false;
    selectionScope = _outlinerLassoScopeFromTarget(e.target);
    baseSelection = selectionMode === 'replace' ? [] : [...treeSelection.items];
    const rect = scroller.getBoundingClientRect();
    startX = e.clientX - rect.left + scroller.scrollLeft;
    startY = e.clientY - rect.top + scroller.scrollTop;
    startClientX = e.clientX;
    startClientY = e.clientY;
  });

  scroller.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    const distance = Math.max(Math.abs(e.clientX - startClientX), Math.abs(e.clientY - startClientY));
    if (!active && distance < LASSO_DRAG_THRESHOLD) return;
    beginLasso(e);
    const rect = _outlinerLassoRectForEvent(e);
    const { left, top, width, height } = rect;
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    updateSelection(rect);
    e.preventDefault();
  });
  scroller.addEventListener('pointerup', endLasso);
  scroller.addEventListener('pointercancel', endLasso);
})();

function _readOutlinerDroppedFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めませんでした'));
    reader.onabort = () => reject(new Error('ファイルの読み込みが中断されました'));
    reader.readAsDataURL(file);
  });
}

async function _uploadOutlinerDroppedFile(file, parentPath) {
  try {
    const data = await _readOutlinerDroppedFile(file);
    await apiFetch('/upload-file?path=' + encodeURIComponent(parentPath), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, filename: file.name }),
    });
    return { ok: true, name: file.name };
  } catch (error) {
    return {
      ok: false,
      name: file?.name || 'ファイル',
      error: error?.message ? String(error.message) : '取り込みに失敗しました',
    };
  }
}

document.getElementById('outliner-tree')?.addEventListener('drop', async e => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files || []); if (!files.length) return;
  let parentPath = '';
  // ドロップ先のフォルダを検出
  const nodeEl = e.target?.closest?.('.tree-node');
  if (nodeEl && nodeEl._nodeData) {
    const nd = nodeEl._nodeData;
    if (nd.type === 'folder' || nd.type === 'database') parentPath = nd.path;
    else parentPath = nd.path.substring(0, nd.path.lastIndexOf('/'));
  }
  const progress = window.MeldexOperationProgress?.begin?.({
    kind: 'file-import',
    label: `${files.length}個のファイルをインポートしています`,
    mode: 'determinate',
    total: files.length,
    processed: 0,
    origin: document.getElementById('outliner-tree'),
    showInTray: true,
    priority: 40,
  });
  if (!progress) showStatus(`${files.length}個のファイルをインポート中...`);
  let processed = 0;
  const results = await Promise.all(files.map(async file => {
    const result = await _uploadOutlinerDroppedFile(file, parentPath);
    processed += 1;
    progress?.update?.({ processed: processed, currentItem: file.name });
    return result;
  }));
  try {
    progress?.update?.({ phase: '表示を更新しています', currentItem: '' });
    await loadOutliner();
  } catch (error) {
    progress?.fail?.({ error: error });
    throw error;
  }
  const succeeded = results.filter(result => result.ok);
  const failed = results.filter(result => !result.ok);
  if (failed.length) {
    const names = failed.slice(0, 3).map(result => result.name).join('、');
    const suffix = failed.length > 3 ? ` ほか${failed.length - 3}件` : '';
    const summary = `${succeeded.length}個をインポート、${failed.length}個は失敗しました: ${names}${suffix}`;
    if (progress) {
      progress.partial({
        summary: summary,
        detailCount: failed.length,
        details: failed.map(result => ({ path: result.name, message: result.error })),
      });
    } else showStatus(summary, true);
  } else {
    if (progress) progress.succeed({ summary: files.length + '個のファイルをインポートしました' });
    else showStatus(files.length + '個のファイルをインポートしました');
  }
});
