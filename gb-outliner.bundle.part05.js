  if (active?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  _outlinerKeyboardMarkActive();
  try { row.focus({ preventScroll: true }); } catch {}
}

function _outlinerKeyboardNodePathExt(path) {
  const name = String(path || '').replace(/\\/g, '/').split('/').pop() || '';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function _outlinerKeyboardMediaType(item) {
  const type = item?.type || '';
  if (type === 'image' || type === 'video' || type === 'audio' || type === 'pdf') return type;
  const ext = _outlinerKeyboardNodePathExt(item?.path || item?.name || '');
  if (ext === '.pdf') return 'pdf';
  if (OUTLINER_KEYBOARD_IMAGE_EXTS.has(ext)) return 'image';
  if (OUTLINER_KEYBOARD_VIDEO_EXTS.has(ext)) return 'video';
  if (OUTLINER_KEYBOARD_AUDIO_EXTS.has(ext)) return 'audio';
  return '';
}

async function _outlinerKeyboardOpenNode(nodeEl) {
  const item = nodeEl?._nodeData || null;
  if (!item || !item.path || item.needsMapping === true) return false;
  const paneSnapshot = typeof _captureBrowseItemPaneSnapshot === 'function'
    ? _captureBrowseItemPaneSnapshot('', { requirePath: false })
    : null;
  if (typeof _applyCachedBrowseItemType === 'function') _applyCachedBrowseItemType(item);
  if (typeof _resolveBrowseItemTypeOnDemand === 'function'
      && typeof _browseItemNeedsTypeCheck === 'function' && _browseItemNeedsTypeCheck(item)) {
    await _resolveBrowseItemTypeOnDemand(item);
    if (typeof _browseItemPaneSnapshotIsCurrent === 'function'
        && !_browseItemPaneSnapshotIsCurrent(paneSnapshot)) return false;
    if (typeof _syncOutlinerResolvedItemType === 'function') _syncOutlinerResolvedItemType(nodeEl, item);
  }
  const opts = { fromExplorer: true, skipHighlight: true, noScrollHighlight: true };
  const type = item.type || '';
  const mediaType = _outlinerKeyboardMediaType(item);
  if (type === 'folder' || item._isRoot) {
    if (
      window.MeldexCloudMobile?.shouldUseSidebarDrawer?.()
      && window.MeldexCloudMobileExplorer?.selectFolderFromTree?.(item, { syncSelection: false })
    ) {
      return true;
    }
    return openFolder(item.name, item.path, opts);
  }
  if (type === 'database') return selectDatabase(item.path, paneSnapshot?.paneContext || null, opts);
  if (type === 'entity') return selectEntity(item.path, opts);
  if (type === 'page') return openPage(item.name, item.path, opts);
  if (type === 'scriptnote' || type === 'scenario' || (typeof isScriptNotePath === 'function' && isScriptNotePath(item.path))) {
    return typeof openScenarioInScriptNote === 'function' ? openScenarioInScriptNote(item.path, item.name, opts) : false;
  }
  if (type === 'board') return openBoard(item.name, item.path, opts);
  if (type === 'calendar') return openCalendarFile(item.name, item.path, { ...opts, paneContext: paneSnapshot?.paneContext || null });
  if (mediaType) return openMedia(item.name, item.path, mediaType, opts);
  if (type === 'html') return openHtmlFile(item.name, item.path, opts);
  if (type === 'csv') {
    return typeof openCsvFile === 'function' ? openCsvFile(item.name, item.path, opts) : openPage(item.name, item.path, opts);
  }
  if (type === 'smart-db' && typeof openSmartDbFile === 'function') {
    return openSmartDbFile(item.name, item.path, opts);
  }
  if (!(typeof NATIVE_TYPES !== 'undefined' && NATIVE_TYPES.has(type)) && typeof showStatus === 'function') {
    showStatus((item.name || item.path) + ' — 「…」または長押しメニューからアプリで開く');
  }
  return false;
}

function _outlinerKeyboardSelectNode(nodeEl, options = {}) {
  const row = _outlinerKeyboardRow(nodeEl);
  if (!nodeEl || !row) return false;
  const focusSeq = ++_outlinerKeyboardFocusSeq;
  treeSelection.clear();
  treeSelection.add(nodeEl);
  treeSelection.lastClicked = nodeEl;
  document.querySelectorAll('.tree-node-row.active').forEach(r => r.classList.remove('active'));
  row.classList.add('active');
  _outlinerKeyboardRestoreFocus(row, focusSeq);
  row.scrollIntoView({ block: 'nearest' });
  if (options.openPanel !== false) {
    try {
      const opened = _outlinerKeyboardOpenNode(nodeEl);
      Promise.resolve(opened).finally(() => _outlinerKeyboardRestoreFocus(row, focusSeq));
    } catch (err) {
      _outlinerKeyboardRestoreFocus(row, focusSeq);
      throw err;
    }
  }
  return true;
}

function _outlinerKeyboardScopeFromTarget(target) {
  if (target?.closest?.('#body-home')) return '#body-home';
  if (target?.closest?.('#body-workspaces')) return '#body-workspaces';
  if (target?.closest?.('#outliner-tree')) return '#outliner-tree';
  if (target?.id === 'tree-scroll-container') return '#outliner-tree';
  return '';
}

function _outlinerKeyboardNodeFromTarget(target, scopeSelector) {
  const direct = target?.closest?.('.tree-node') || null;
  if (direct && (!scopeSelector || direct.closest(scopeSelector))) return direct;
  if (treeSelection.lastClicked && (!scopeSelector || treeSelection.lastClicked.closest(scopeSelector))) return treeSelection.lastClicked;
  const activeRow = document.querySelector(`${scopeSelector || '#outliner-tree'} .tree-node-row.active`);
  return activeRow?.closest?.('.tree-node') || null;
}

function _outlinerKeyboardToggle(nodeEl, expand) {
  const toggle = nodeEl?.querySelector?.(':scope > .tree-node-row .tree-toggle') || null;
  if (!toggle || toggle.dataset.expanded === undefined) return false;
  const expanded = toggle.dataset.expanded === 'true';
  if (expand === true && !expanded) { toggle.click(); return true; }
  if (expand === false && expanded) { toggle.click(); return true; }
  return false;
}

function _handleOutlinerTreeKeydown(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const target = event.target;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const scopeSelector = _outlinerKeyboardScopeFromTarget(target);
  if (!scopeSelector) return;
  const current = _outlinerKeyboardNodeFromTarget(target, scopeSelector);
  event.preventDefault();
  event.stopPropagation();
  _outlinerKeyboardMarkActive();
  if (event.key === 'ArrowLeft') { _outlinerKeyboardToggle(current, false); return; }
  if (event.key === 'ArrowRight') { _outlinerKeyboardToggle(current, true); return; }
  const nodes = _getVisibleTreeNodes(scopeSelector);
  if (!nodes.length) return;
  const rawIndex = nodes.indexOf(current);
  const currentIndex = rawIndex >= 0 ? rawIndex : (event.key === 'ArrowUp' ? 0 : -1);
  const nextIndex = event.key === 'ArrowUp'
    ? Math.max(0, currentIndex - 1)
    : Math.min(nodes.length - 1, currentIndex + 1);
  _outlinerKeyboardSelectNode(nodes[nextIndex], { openPanel: true });
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
  let candidateRow = null;
  let candidateRowDraggable = null;
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

  function _outlinerLassoBlockedTarget(target) {
    return !!target?.closest?.('.tree-hover-btn, .tree-toggle, .sidebar-section-header, .fav-item, input, textarea, button, select, [contenteditable="true"]');
  }

  function _outlinerLassoAllowedTarget(target) {
    if (target?.closest?.('#outliner-tree, #body-home, #body-workspaces')) return true;
    const section = target?.closest?.('.sidebar-section');
    if (section?.id === 'section-workspaces') return true;
    return section?.id === 'section-roots' || section?.id === 'section-home';
  }

  function _outlinerLassoCandidateRow(target, mode) {
    const row = target?.closest?.('.tree-node-row');
    if (!row) return null;
    const node = row.closest('.tree-node');
    if (!node) return null;
    if (mode === 'replace' && treeSelection.has(node)) return null;
    return row;
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
    const hadCandidateRow = !!candidateRow;
    const suppressClickNode = candidateRow?.closest?.('.tree-node') || null;
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
    if (candidateRow) {
      candidateRow.draggable = candidateRowDraggable;
      candidateRow = null;
      candidateRowDraggable = null;
    }
    // pointerdown で設定した inline position を元に戻す
    if (_savedScrollerPosition !== null) {
      scroller.style.position = _savedScrollerPosition;
      _savedScrollerPosition = null;
    }
    if (!wasActive && !hadCandidateRow && selectionMode === 'replace') treeSelection.clear();
    if (wasActive && hadCandidateRow) {
      _outlinerSuppressNextTreeRowClick = true;
      _outlinerSuppressTreeRowClickNode = suppressClickNode;
      setTimeout(() => {
        _outlinerSuppressNextTreeRowClick = false;
        _outlinerSuppressTreeRowClickNode = null;
      }, 500);
    }
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
    if (_outlinerLassoBlockedTarget(e.target)) return;
    if (!_outlinerLassoAllowedTarget(e.target)) return;
    selectionMode = _outlinerLassoMode(e);
    candidateRow = _outlinerLassoCandidateRow(e.target, selectionMode);
    if (e.target.closest('.tree-node-row') && !candidateRow) return;
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
    if (candidateRow) {
      candidateRowDraggable = candidateRow.draggable;
      candidateRow.draggable = false;
    }
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
  showStatus(`${files.length}個のファイルをインポート中...`);
  const results = await Promise.all(files.map(file => _uploadOutlinerDroppedFile(file, parentPath)));
  await loadOutliner();
  const succeeded = results.filter(result => result.ok);
  const failed = results.filter(result => !result.ok);
  if (failed.length) {
    const names = failed.slice(0, 3).map(result => result.name).join('、');
    const suffix = failed.length > 3 ? ` ほか${failed.length - 3}件` : '';
    showStatus(`${succeeded.length}個をインポート、${failed.length}個は失敗しました: ${names}${suffix}`, true);
  } else {
    showStatus(files.length + '個のファイルをインポートしました');
  }
});
