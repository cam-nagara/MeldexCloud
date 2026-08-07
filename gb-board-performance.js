/* gb-board-performance.js: board perf instrumentation and lightweight mutation helpers */

const BD_PERF_DEBUG_STORAGE_KEY = 'boardPerfDebug';
const BD_FAST_AUTO_LAYOUT_DELAY_MS = 220;
const BD_FAST_SIBLING_AUTO_LAYOUT_DELAY_MS = 420;
const BD_FAST_SIBLING_FULL_RENDER_DELAY_MS = 1800;
const BD_FAST_FULL_RENDER_DELAY_MS = 180;
const BD_FAST_CARD_RENDER_STORAGE_KEY = 'boardFastCardRender';
const BD_FAST_CARD_RENDER_MIN_NODES = 120;
const BD_FAST_CARD_RENDER_MIN_CONNECTIONS = 80;

let _bdFastMutationDepth = 0;
let _bdDeferredExtras = false;
let _bdDeferredExtrasTimer = 0;
let _bdDeferredExtrasRaf = 0;
let _bdDeferredAutoLayoutTimer = 0;
let _bdDeferredAutoLayoutRaf = 0;
let _bdDeferredAutoLayoutRoots = new Set();
let _bdDeferredAutoLayoutDelayMs = 0;
let _bdFullRenderTimer = 0;
let _bdFullRenderRaf = 0;
let _bdFastCardRenderUsed = false;
let _bdPreferredFullRenderDelayMs = 0;
let _bdUndoCoalesceKey = '';
let _bdUndoCoalesceUntil = 0;
let _bdUndoCoalesceTimer = 0;

function bdPerfEnabled() {
  try { return localStorage.getItem(BD_PERF_DEBUG_STORAGE_KEY) === '1'; }
  catch { return false; }
}

function bdPerfStart(label) {
  if (!label || !bdPerfEnabled() || typeof performance === 'undefined') return 0;
  return performance.now();
}

function bdPerfEnd(label, startedAt, meta) {
  if (!startedAt || !bdPerfEnabled() || typeof performance === 'undefined') return;
  const ms = performance.now() - startedAt;
  const counts = (typeof bd !== 'undefined')
    ? `cards=${bd.nodes?.length || 0} lines=${bd.connections?.length || 0}`
    : '';
  const suffix = meta ? ` ${meta}` : '';
  console.debug(`[board-perf] ${label}: ${ms.toFixed(1)}ms ${counts}${suffix}`);
}

function bdBeginFastBoardMutation() {
  _bdFastMutationDepth += 1;
}

function bdEndFastBoardMutation() {
  _bdFastMutationDepth = Math.max(0, _bdFastMutationDepth - 1);
  if (_bdFastMutationDepth !== 0) return;
  if (_bdDeferredAutoLayoutRoots.size > 0) {
    const delayMs = _bdDeferredAutoLayoutDelayMs || undefined;
    _bdDeferredAutoLayoutDelayMs = 0;
    bdScheduleAutoLayouts(delayMs);
  } else if (_bdFastCardRenderUsed) {
    _bdFastCardRenderUsed = false;
    if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates(bdConsumeFullBoardRenderDelay());
    else bdScheduleBoardExtras(bdConsumeFullBoardRenderDelay());
  } else if (_bdDeferredExtras) {
    bdScheduleBoardExtras();
  }
}

function bdShouldDeferBoardExtras() {
  return _bdFastMutationDepth > 0;
}

function bdShouldUseFastCardRender(options = {}) {
  if (typeof document === 'undefined') return false;
  if (typeof bd === 'undefined' || !Array.isArray(bd.nodes)) return false;
  let pref = '';
  try { pref = localStorage.getItem(BD_FAST_CARD_RENDER_STORAGE_KEY) || ''; }
  catch { pref = ''; }
  if (pref === '0') return false;
  if (pref === '1' || options.force === true) return true;
  const nodeCount = bd.nodes.length || 0;
  const connCount = Array.isArray(bd.connections) ? bd.connections.length : 0;
  if (nodeCount < BD_FAST_CARD_RENDER_MIN_NODES) return false;
  return _bdFastMutationDepth > 0 || connCount >= BD_FAST_CARD_RENDER_MIN_CONNECTIONS;
}

function bdMarkFastCardRenderUsed() {
  _bdFastCardRenderUsed = true;
}

function bdAppendFastNodeAnchors(div, node) {
  if (!div || !node || !node.id || node.minimized || node.locked) return;
  ['top', 'bottom', 'left', 'right'].forEach(pos => {
    const anchor = document.createElement('div');
    anchor.className = 'bd-anchor-hud bd-hud ' + pos;
    anchor.title = 'クリックでカード追加 / ドラッグでライン作成';
    if (typeof lucide === 'function') anchor.innerHTML = lucide('circlePlus', 18);
    anchor.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const startX = ev.clientX;
      const startY = ev.clientY;
      let dragged = false;
      const onMove = (mv) => {
        if (Math.abs(mv.clientX - startX) + Math.abs(mv.clientY - startY) >= 4) dragged = true;
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (dragged) return;
        const hasConnSel = (typeof bd !== 'undefined' && bd.selectedConnIds instanceof Set && bd.selectedConnIds.size > 0);
        if (hasConnSel) {
          bd.connecting = node.id;
          bd._connLabel = '';
          bd._connOrigin = 'anchor';
          bd._connFromAnchor = (typeof _bdHudPosToAnchorName === 'function') ? _bdHudPosToAnchorName(pos) : '';
          if (typeof window.showStatus === 'function') {
            window.showStatus('接続先カードをクリック (空白クリックで新規カード作成)');
          }
          return;
        }
        if (typeof _bdAnchorAddCard === 'function') _bdAnchorAddCard(node.id, pos);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
    div.appendChild(anchor);
  });
}

function bdAppendFastNode(node) {
  if (!node || !node.id || typeof document === 'undefined') return false;
  const container = document.getElementById('bd-nodes');
  if (!container) return false;
  const started = bdPerfStart('bdAppendFastNode');
  const fastCardRender = bdShouldUseFastCardRender({ reason: 'append-fast-node' });
  const ok = typeof bdReplaceNodeElement === 'function'
    ? bdReplaceNodeElement(node, { fastCardRender })
    : false;
  if (ok && fastCardRender) bdMarkFastCardRenderUsed();
  bdPerfEnd('bdAppendFastNode', started, fastCardRender ? 'fast-card-render=1' : '');
  return !!ok;
}

function bdFastNodeById(nodeId) {
  if (typeof bd === 'undefined' || !nodeId) return null;
  return bd.nodes.find(node => node?.id === nodeId) || null;
}

function bdFastChildren(parentId) {
  if (typeof bd === 'undefined') return [];
  return bd.nodes.filter(node => node?.parent === parentId && !node.contained);
}

function bdFastSubtreeIds(rootId) {
  if (typeof bd === 'undefined' || !rootId) return [];
  const root = bdFastNodeById(rootId);
  if (!root || root.contained) return [];
  const result = [];
  const stack = [rootId];
  const seen = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = bdFastNodeById(id);
    if (!node || node.contained) continue;
    result.push(id);
    bdFastChildren(id).forEach(child => stack.push(child.id));
  }
  return result;
}

function bdFastNodeBounds(nodeOrId) {
  const node = typeof nodeOrId === 'string' ? bdFastNodeById(nodeOrId) : nodeOrId;
  if (!node || node.contained) return null;
  const el = typeof document !== 'undefined' ? document.getElementById('bdn-' + node.id) : null;
  const x = Number(node.x) || 0;
  const y = Number(node.y) || 0;
  const w = el?.offsetWidth || node._rw || node.w || 160;
  const h = el?.offsetHeight || node._rh || node.h || 36;
  return { x1: x, y1: y, x2: x + w, y2: y + h, w, h };
}

function bdFastSubtreeBounds(rootId) {
  const ids = bdFastSubtreeIds(rootId);
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  ids.forEach(id => {
    const b = bdFastNodeBounds(id);
    if (!b) return;
    x1 = Math.min(x1, b.x1);
    y1 = Math.min(y1, b.y1);
    x2 = Math.max(x2, b.x2);
    y2 = Math.max(y2, b.y2);
  });
  return Number.isFinite(x1) ? { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 } : null;
}

function bdFastMoveSubtree(rootId, dx, dy, movedIds) {
  const shiftX = Number(dx) || 0;
  const shiftY = Number(dy) || 0;
  if (Math.abs(shiftX) < 0.01 && Math.abs(shiftY) < 0.01) return;
  bdFastSubtreeIds(rootId).forEach(id => {
    const node = bdFastNodeById(id);
    if (!node) return;
    node.x = (Number(node.x) || 0) + shiftX;
    node.y = (Number(node.y) || 0) + shiftY;
    movedIds?.add(id);
    const el = typeof document !== 'undefined' ? document.getElementById('bdn-' + id) : null;
    if (el) {
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
    }
  });
}

function bdFastSiblingLayoutAxis(direction) {
  return (direction === 'down' || direction === 'up') ? 'x' : 'y';
}

function bdFastShiftFollowingSiblings(parentId, anchorId, axis, gap, movedIds) {
  const siblings = bdFastChildren(parentId);
  const anchorIndex = siblings.findIndex(node => node.id === anchorId);
  if (anchorIndex < 0) return false;
  const anchorBounds = bdFastSubtreeBounds(anchorId);
  if (!anchorBounds) return false;
  let cursor = (axis === 'y' ? anchorBounds.y2 : anchorBounds.x2) + gap;
  for (let i = anchorIndex + 1; i < siblings.length; i += 1) {
    const next = siblings[i];
    const bounds = bdFastSubtreeBounds(next.id);
    if (!bounds) continue;
    const start = axis === 'y' ? bounds.y1 : bounds.x1;
    const delta = cursor - start;
    if (delta > 0.01) {
      if (axis === 'y') bdFastMoveSubtree(next.id, 0, delta, movedIds);
      else bdFastMoveSubtree(next.id, delta, 0, movedIds);
    }
    const nextBounds = bdFastSubtreeBounds(next.id) || bounds;
    cursor = (axis === 'y' ? nextBounds.y2 : nextBounds.x2) + gap;
  }
  return true;
}

function bdFastPropagateSiblingExpansion(parentId, axis, gap, movedIds) {
  let branchId = parentId;
  let branch = bdFastNodeById(branchId);
  let guard = 0;
  while (branch?.parent && guard < 100) {
    bdFastShiftFollowingSiblings(branch.parent, branchId, axis, gap, movedIds);
    branchId = branch.parent;
    branch = bdFastNodeById(branchId);
    guard += 1;
  }
}

function bdApplySiblingDifferentialLayout(options = {}) {
  if (typeof bd === 'undefined' || typeof document === 'undefined') return { applied: false };
  const sibling = options.sibling || options.node || null;
  const selectedNode = options.selectedNode || null;
  const parentId = options.parentId || sibling?.parent || '';
  if (!sibling?.id || !selectedNode?.id || !parentId) return { applied: false };

  const started = bdPerfStart('bdSiblingDiffLayout');
  const axis = bdFastSiblingLayoutAxis(options.direction || 'right');
  const gap = Number.isFinite(+options.gap) ? Math.max(0, +options.gap) : 40;
  const movedIds = new Set();
  const selectedBounds = bdFastSubtreeBounds(selectedNode.id);
  let siblingBounds = bdFastSubtreeBounds(sibling.id);
  if (!selectedBounds || !siblingBounds) return { applied: false };

  if (axis === 'y') {
    bdFastMoveSubtree(sibling.id, 0, selectedBounds.y2 + gap - siblingBounds.y1, movedIds);
  } else {
    bdFastMoveSubtree(sibling.id, selectedBounds.x2 + gap - siblingBounds.x1, 0, movedIds);
  }

  bdFastShiftFollowingSiblings(parentId, sibling.id, axis, gap, movedIds);
  bdFastPropagateSiblingExpansion(parentId, axis, gap, movedIds);

  movedIds.add(sibling.id);
  if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved([...movedIds], 'sibling-diff');
  if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([sibling.id], 'sibling-diff');
  if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true, comments: [sibling.id] }, 'sibling-diff');
  if (typeof bdDrawConns === 'function') bdDrawConns({ nodeIds: [...movedIds], reason: 'sibling-diff' });
  if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(sibling.id);
  else if (typeof bdSyncSelectionRectForNode === 'function') bdSyncSelectionRectForNode(sibling.id);
  bdPerfEnd('bdSiblingDiffLayout', started, `moved=${movedIds.size}`);
  return { applied: true, movedIds: [...movedIds], axis };
}

function bdExpandConnectionIdsForSharedPairs(connIds, previousEndpointPairs) {
  const ids = new Set(connIds || []);
  if (typeof bd === 'undefined' || !ids.size) return ids;
  const keyOf = (conn, side) => (typeof bdConnectionEndpointKey === 'function')
    ? bdConnectionEndpointKey(conn, side)
    : (side === 'from' ? ('node:' + (conn?.from || '')) : ('node:' + (conn?.to || '')));
  const pairKeys = new Set();
  const addPair = (a, b) => {
    if (!a || !b || a === 'none' || b === 'none') return;
    pairKeys.add(`${a}\u0000${b}`);
    pairKeys.add(`${b}\u0000${a}`);
  };
  const extraPairs = Array.isArray(previousEndpointPairs) || previousEndpointPairs instanceof Set ? [...previousEndpointPairs] : [];
  extraPairs.forEach(pair => {
    if (typeof pair === 'string') {
      pairKeys.add(pair);
      return;
    }
    addPair(pair?.fromKey || pair?.from, pair?.toKey || pair?.to);
  });
  bd.connections.forEach(conn => {
    if (!ids.has(conn.id)) return;
    const a = keyOf(conn, 'from');
    const b = keyOf(conn, 'to');
    addPair(a, b);
  });
  if (!pairKeys.size) return ids;
  bd.connections.forEach(conn => {
    if (pairKeys.has(`${keyOf(conn, 'from')}\u0000${keyOf(conn, 'to')}`)) ids.add(conn.id);
  });
  return ids;
}

function bdNormalizePartialConnectionIds(options) {
  if (typeof bd === 'undefined' || !options) return null;
  let connIds = [];
  let previousEndpointPairs = [];
  if (typeof options === 'string') connIds = [options];
  else if (Array.isArray(options)) connIds = options;
  else if (options instanceof Set) connIds = [...options];
  else {
    if (options.connIds instanceof Set) connIds = [...options.connIds];
    else if (Array.isArray(options.connIds)) connIds = options.connIds;
    else if (options.nodeIds instanceof Set || Array.isArray(options.nodeIds)) {
      const nodeIds = new Set([...(options.nodeIds || [])].filter(Boolean));
      bd.connections.forEach(conn => {
        if (nodeIds.has(conn.from) || nodeIds.has(conn.to)) connIds.push(conn.id);
      });
    } else {
      return null;
    }
    if (Array.isArray(options.previousEndpointPairs)) previousEndpointPairs = options.previousEndpointPairs;
    else if (options.previousEndpointPair) previousEndpointPairs = [options.previousEndpointPair];
  }
  const ids = new Set(connIds.filter(Boolean));
  if (!ids.size) return ids;
  return bdExpandConnectionIdsForSharedPairs(ids, previousEndpointPairs);
}

function bdRemoveConnectionRender(svg, defs, connId) {
  if (!svg || !connId) return;
  const id = String(connId);
  const renderClasses = '.bd-conn-path, .bd-conn-hit, .bd-conn-arrow, .bd-conn-selection, .bd-conn-selection-dot, .bd-conn-selection-handle, .bd-anchor-candidate, .bd-curve-handle, .bd-curve-handle-line, .bd-conn-label-path';
  svg.querySelectorAll(renderClasses).forEach(el => {
    if (el.dataset?.connId === id || el._connId === id || el._connData?.id === id
      || el.id === `bd-path-${id}` || el.id === `bd-sel-back-${id}` || el.id === `bd-sel-front-${id}`) {
      el.remove();
    }
  });
  document.querySelectorAll('.bd-conn-label').forEach(label => {
    if (label.dataset?.connId === id) label.remove();
  });
  if (defs) {
    defs.querySelectorAll('marker').forEach(marker => {
      if (marker.dataset?.connId === id
        || marker.id === `bd-arrow-${id}`
        || marker.id === `bd-arrow-start-${id}`
        || marker.id === `bd-arrow-end-${id}`) {
        marker.remove();
      }
    });
  }
}

function bdSyncSelectionRectForNode(nodeOrId) {
  const node = typeof nodeOrId === 'string'
    ? (typeof bd !== 'undefined' ? bd.nodes.find(n => n.id === nodeOrId) : null)
    : nodeOrId;
  if (!node || !node.id || node.contained || typeof document === 'undefined') return false;
  const layer = document.getElementById('bd-resize-layer');
  const el = document.getElementById('bdn-' + node.id);
  if (!layer || !el || !el.isConnected) return false;
  const started = bdPerfStart('bdSyncSelectionRectForNode');
  const safeId = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
    ? CSS.escape(node.id)
    : String(node.id).replace(/"/g, '\\"');
  let rect = layer.querySelector(`.bd-selection-rect[data-node-id="${safeId}"]`);
  if (!rect) {
    rect = document.createElement('div');
    rect.className = 'bd-selection-rect';
    rect.dataset.nodeId = node.id;
    layer.appendChild(rect);
  }
  const isSelected = typeof bd !== 'undefined' && bd.selected && bd.selected.has(node.id);
  const isEditing = el.classList.contains('bd-editing');
  rect.classList.toggle('is-visible', isSelected);
  rect.classList.toggle('is-editing', isEditing);
  if (isSelected) {
    const offset = 4;
    rect.style.left = `${node.x - offset}px`;
    rect.style.top = `${node.y - offset}px`;
    rect.style.width = `${el.offsetWidth + offset * 2}px`;
    rect.style.height = `${el.offsetHeight + offset * 2}px`;
  }
  bdPerfEnd('bdSyncSelectionRectForNode', started);
  return true;
}

function bdSyncResizeHandleForNode(nodeOrId) {
  const node = typeof nodeOrId === 'string'
    ? (typeof bd !== 'undefined' ? bd.nodes.find(n => n.id === nodeOrId) : null)
    : nodeOrId;
  if (!node || !node.id || node.contained || typeof document === 'undefined') return false;
  const layer = document.getElementById('bd-resize-layer');
  const el = document.getElementById('bdn-' + node.id);
  if (!layer || !el || !el.isConnected) return false;
  const started = bdPerfStart('bdSyncResizeHandleForNode');
  bdSyncSelectionRectForNode(node);
  const safeId = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
    ? CSS.escape(node.id)
    : String(node.id).replace(/"/g, '\\"');
  let handle = layer.querySelector(`.bd-resize[data-node-id="${safeId}"]`);
  if (node.minimized) {
    if (handle) handle.remove();
    bdPerfEnd('bdSyncResizeHandleForNode', started);
    return true;
  }
  if (!handle) {
    handle = document.createElement('div');
    handle.className = 'bd-resize';
    handle.dataset.nodeId = node.id;
    layer.appendChild(handle);
  }
  const isSelected = typeof bd !== 'undefined' && bd.selected && bd.selected.has(node.id);
  handle.classList.toggle('is-visible', isSelected);
  handle.style.left = `${node.x + el.offsetWidth}px`;
  handle.style.top = `${node.y + el.offsetHeight}px`;
  bdPerfEnd('bdSyncResizeHandleForNode', started);
  return true;
}

function bdRemoveSelectionUiForMissingNodes() {
  const layer = document.getElementById('bd-resize-layer');
  if (!layer || typeof bd === 'undefined') return;
  const liveIds = new Set((bd.nodes || []).filter(node => node && !node.contained).map(node => node.id));
  layer.querySelectorAll('.bd-resize[data-node-id], .bd-selection-rect[data-node-id]').forEach(el => {
    if (!liveIds.has(el.dataset.nodeId) || !document.getElementById('bdn-' + el.dataset.nodeId)) el.remove();
  });
}

function bdRequestBoardExtras(delayMs) {
  _bdDeferredExtras = true;
  if (_bdFastMutationDepth > 0) return;
  bdScheduleBoardExtras(delayMs);
}

function bdPreferFullBoardRenderDelay(delayMs) {
  const delay = Number.isFinite(+delayMs) ? Math.max(0, +delayMs) : 0;
  if (delay > _bdPreferredFullRenderDelayMs) _bdPreferredFullRenderDelayMs = delay;
}

function bdConsumeFullBoardRenderDelay(fallbackDelayMs) {
  const delay = _bdPreferredFullRenderDelayMs || fallbackDelayMs;
  _bdPreferredFullRenderDelayMs = 0;
  return delay;
}

function bdClearBoardExtrasTimer() {
  clearTimeout(_bdDeferredExtrasTimer);
  _bdDeferredExtrasTimer = 0;
  if (_bdDeferredExtrasRaf) {
    cancelAnimationFrame(_bdDeferredExtrasRaf);
    _bdDeferredExtrasRaf = 0;
  }
}

function bdScheduleBoardExtras(delayMs) {
  const delay = Number.isFinite(+delayMs) ? Math.max(0, +delayMs) : 120;
  bdClearBoardExtrasTimer();
  _bdDeferredExtrasTimer = setTimeout(() => {
    _bdDeferredExtrasTimer = 0;
    _bdDeferredExtrasRaf = requestAnimationFrame(() => {
      _bdDeferredExtrasRaf = 0;
      bdFlushBoardExtras();
    });
  }, delay);
}

function bdFlushBoardExtras() {
  if (_bdFastMutationDepth > 0) {
    bdRequestBoardExtras();
    return;
  }
  _bdDeferredExtras = false;
  const started = bdPerfStart('bdFlushBoardExtras');
  const container = document.getElementById('bd-nodes');
  if (typeof bdMarkExtrasDirty === 'function') {
    const selectedIds = bd?.selected ? [...bd.selected] : [];
    if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(selectedIds, 'legacy-extras');
    bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true, comments: selectedIds }, 'legacy-extras');
    if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
    bdPerfEnd('bdFlushBoardExtras', started, 'delegated');
    return;
  }
  if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
  if (typeof bdDrawConns === 'function') bdDrawConns();
  if (typeof bdDrawFrames === 'function') bdDrawFrames();
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi();
  if (typeof CommentBadges !== 'undefined' && typeof bd !== 'undefined' && bd.path && container) {
    try { CommentBadges.refreshBoard(bd.path, container); } catch {}
  }
  bdPerfEnd('bdFlushBoardExtras', started);
}

function bdRememberAutoLayoutDelay(delayMs) {
  const delay = Number.isFinite(+delayMs) ? Math.max(0, +delayMs) : 0;
  if (delay > _bdDeferredAutoLayoutDelayMs) _bdDeferredAutoLayoutDelayMs = delay;
}

function bdRequestAutoLayout(rootId, delayMs) {
  if (rootId) _bdDeferredAutoLayoutRoots.add(rootId);
  if (_bdFastMutationDepth > 0) {
    bdRememberAutoLayoutDelay(delayMs);
    return;
  }
  bdScheduleAutoLayouts(delayMs);
}

function bdScheduleAutoLayouts(delayMs) {
  const delay = Number.isFinite(+delayMs) ? Math.max(0, +delayMs) : BD_FAST_AUTO_LAYOUT_DELAY_MS;
  clearTimeout(_bdDeferredAutoLayoutTimer);
  if (_bdDeferredAutoLayoutRaf) {
    cancelAnimationFrame(_bdDeferredAutoLayoutRaf);
    _bdDeferredAutoLayoutRaf = 0;
  }
  _bdDeferredAutoLayoutTimer = setTimeout(() => {
    _bdDeferredAutoLayoutTimer = 0;
    _bdDeferredAutoLayoutRaf = requestAnimationFrame(() => {
      _bdDeferredAutoLayoutRaf = 0;
      bdFlushAutoLayouts();
    });
  }, delay);
}

function bdFlushAutoLayouts() {
  if (_bdFastMutationDepth > 0) {
    const delayMs = _bdDeferredAutoLayoutDelayMs || undefined;
    _bdDeferredAutoLayoutDelayMs = 0;
    bdScheduleAutoLayouts(delayMs);
    return;
  }
  const roots = [..._bdDeferredAutoLayoutRoots].filter(Boolean);
  _bdDeferredAutoLayoutRoots.clear();
  _bdDeferredAutoLayoutDelayMs = 0;
  if (!roots.length) {
    if (_bdFastCardRenderUsed) {
      _bdFastCardRenderUsed = false;
      if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates(bdConsumeFullBoardRenderDelay(40));
      else bdScheduleBoardExtras();
    }
    else if (_bdDeferredExtras) bdScheduleBoardExtras();
    return;
  }
  const started = bdPerfStart('bdFlushAutoLayouts');
  if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
  try {
    roots.forEach(rootId => {
      const layoutIds = typeof bdFastSubtreeIds === 'function' ? bdFastSubtreeIds(rootId) : [rootId];
      if (typeof bdAutoLayout === 'function') bdAutoLayout(rootId);
      if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(layoutIds, 'auto-layout');
    });
  } finally {
    if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
  }
  if (typeof bdDirty === 'function') bdDirty();
  if (_bdFastCardRenderUsed) {
    _bdFastCardRenderUsed = false;
    if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates(bdConsumeFullBoardRenderDelay(40));
    else bdScheduleBoardExtras();
  }
  else if (_bdDeferredExtras) bdScheduleBoardExtras();
  bdPerfEnd('bdFlushAutoLayouts', started, `roots=${roots.length}`);
}

function bdScheduleFullBoardRender(delayMs) {
  const delay = Number.isFinite(+delayMs) ? Math.max(0, +delayMs) : BD_FAST_FULL_RENDER_DELAY_MS;
  bdClearBoardExtrasTimer();
  clearTimeout(_bdFullRenderTimer);
  if (_bdFullRenderRaf) {
    cancelAnimationFrame(_bdFullRenderRaf);
    _bdFullRenderRaf = 0;
  }
  _bdFullRenderTimer = setTimeout(() => {
    _bdFullRenderTimer = 0;
    _bdFullRenderRaf = requestAnimationFrame(() => {
      _bdFullRenderRaf = 0;
      bdFlushFullBoardRender();
    });
  }, delay);
}

function bdFlushFullBoardRender() {
  if (_bdFastMutationDepth > 0) {
    bdScheduleFullBoardRender();
    return;
  }
  if (_bdDeferredAutoLayoutRoots.size > 0) {
    if (!_bdDeferredAutoLayoutTimer && !_bdDeferredAutoLayoutRaf) {
      const delayMs = _bdDeferredAutoLayoutDelayMs || BD_FAST_AUTO_LAYOUT_DELAY_MS;
      _bdDeferredAutoLayoutDelayMs = 0;
      bdScheduleAutoLayouts(delayMs);
    }
    return;
  }
  _bdFastCardRenderUsed = false;
  _bdDeferredExtras = false;
  const started = bdPerfStart('bdFlushFullBoardRender');
  if (typeof bdRender === 'function') bdRender();
  bdPerfEnd('bdFlushFullBoardRender', started);
}

function bdClearUndoCoalesce() {
  _bdUndoCoalesceKey = '';
  _bdUndoCoalesceUntil = 0;
  clearTimeout(_bdUndoCoalesceTimer);
  _bdUndoCoalesceTimer = 0;
}

function bdPushUndoCoalesced(key, windowMs) {
  const coalesceKey = String(key || 'default');
  const span = Number.isFinite(+windowMs) ? Math.max(0, +windowMs) : 700;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  if (_bdUndoCoalesceKey === coalesceKey && now <= _bdUndoCoalesceUntil) {
    _bdUndoCoalesceUntil = now + span;
    clearTimeout(_bdUndoCoalesceTimer);
    _bdUndoCoalesceTimer = setTimeout(bdClearUndoCoalesce, span + 20);
    return false;
  }
  if (typeof bdPushUndo === 'function') bdPushUndo();
  _bdUndoCoalesceKey = coalesceKey;
  _bdUndoCoalesceUntil = now + span;
  clearTimeout(_bdUndoCoalesceTimer);
  _bdUndoCoalesceTimer = setTimeout(bdClearUndoCoalesce, span + 20);
  return true;
}
