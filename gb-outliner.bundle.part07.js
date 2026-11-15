
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

async function _uploadOutlinerDroppedFile(file, parentPath) {
  try {
    const [result] = await MeldexDnD.uploadFiles([file], parentPath, { source: 'outliner-drop' });
    return result?.ok ? result : {
      ok: false,
      name: file?.name || 'ファイル',
      error: result?.error || '取り込みに失敗しました',
    };
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
  if (typeof _folderImportOsDrop === 'function') {
    await _folderImportOsDrop(e, { type: 'folder', path: parentPath || state.vaultPath });
    return;
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
  const results = await MeldexDnD.uploadFiles(files, parentPath, { source: 'outliner-drop' });
  results.forEach((result, index) => {
    progress?.update?.({ processed: index + 1, currentItem: result.name || files[index]?.name || '' });
  });
  try {
    progress?.update?.({ phase: '表示を更新しています', total: null, currentItem: '' });
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
