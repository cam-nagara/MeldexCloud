/* gb-board-dirty.js: differential board update scheduler */

const BD_DIRTY_FULL_RENDER_NODE_RATIO = 0.30;
const BD_DIRTY_FULL_DRAW_CONN_RATIO = 0.30;

let _bdDirtyUpdateTimer = 0;
let _bdDirtyUpdateRaf = 0;
let _bdDirtyState = bdCreateEmptyDirtyState();

// DOM 上に .bd-selected を付与済みのノード ID を記録し、差分で class を付け外しする。
// v0.5.318: querySelectorAll('.bd-node').forEach(...) で全ノード走査していた箇所の置換用。
const _bdAppliedSelection = new Set();

function _bdSelectionIdFromNodeElement(el) {
  const raw = el?.dataset?.nodeId || el?.id || '';
  return String(raw).replace(/^bdn-/, '');
}

function bdApplySelectionDomClass() {
  if (typeof bd === 'undefined' || !bd) return;
  const next = new Set([...(bd.selected instanceof Set ? bd.selected : new Set())].map(id => String(id)));
  document.querySelectorAll('.bd-node.bd-selected').forEach(el => {
    const id = _bdSelectionIdFromNodeElement(el);
    if (!next.has(id)) el.classList.remove('bd-selected');
  });
  // 1) DOM から外すべきもの（以前付与されていたが now 解除）
  _bdAppliedSelection.forEach(id => {
    if (next.has(id)) return;
    const el = document.getElementById(`bdn-${id}`);
    if (el) el.classList.remove('bd-selected');
  });
  // 2) DOM へ付けるべきもの（新規選択）
  next.forEach(id => {
    if (_bdAppliedSelection.has(id)) return;
    const el = document.getElementById(`bdn-${id}`);
    if (el) el.classList.add('bd-selected');
  });
  _bdAppliedSelection.clear();
  next.forEach(id => _bdAppliedSelection.add(id));
}

function bdCreateEmptyDirtyState() {
  return {
    dirtyNodeIds: new Set(),
    dirtyMovedNodeIds: new Set(),
    dirtyConnIds: new Set(),
    dirtyConnNodeIds: new Set(),
    dirtySelectionIds: new Set(),
    dirtyCommentNodeIds: new Set(),
    dirtySelection: false,
    dirtyFrames: false,
    dirtyMinimap: false,
    dirtyBoardUi: false,
    dirtyCommentsAll: false,
    dirtyDetailPanel: false,
    needsFullRender: false,
    fullRenderReason: '',
    reasons: new Set(),
  };
}

function bdMarkNodeDirty(nodeId, reason) {
  if (!nodeId) return;
  _bdDirtyState.dirtyNodeIds.add(nodeId);
  _bdDirtyState.dirtySelectionIds.add(nodeId);
  _bdDirtyState.dirtyCommentNodeIds.add(nodeId);
  _bdDirtyState.dirtyFrames = true;
  _bdDirtyState.dirtyMinimap = true;
  bdDirtyRememberReason(reason || 'node');
  bdMarkConnectionsDirtyByNodes([nodeId], reason || 'node');
  bdScheduleBoardUpdates();
}

function bdMarkNodeMoved(nodeId, reason) {
  if (!nodeId) return;
  _bdDirtyState.dirtyMovedNodeIds.add(nodeId);
  _bdDirtyState.dirtySelectionIds.add(nodeId);
  _bdDirtyState.dirtyFrames = true;
  _bdDirtyState.dirtyMinimap = true;
  bdDirtyRememberReason(reason || 'move');
  bdMarkConnectionsDirtyByNodes([nodeId], reason || 'move');
  bdScheduleBoardUpdates();
}

function bdMarkNodesMoved(nodeIds, reason) {
  [...(nodeIds || [])].filter(Boolean).forEach(id => bdMarkNodeMoved(id, reason));
}

function bdRefreshNodesPartial(nodeIds, reason, options = {}) {
  const ids = [...new Set([...(nodeIds || [])].filter(Boolean))];
  ids.forEach(id => bdMarkNodeDirty(id, reason || 'partial-refresh'));
  if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(ids, reason || 'partial-refresh');
  bdMarkExtrasDirty({
    frames: options.frames !== false,
    minimap: options.minimap !== false,
    boardUi: options.boardUi !== false,
    detailPanel: options.detailPanel === true,
  }, reason || 'partial-refresh');
}

function bdMarkConnectionDirty(connId, reason) {
  if (!connId) return;
  _bdDirtyState.dirtyConnIds.add(connId);
  _bdDirtyState.dirtyMinimap = true;
  bdDirtyRememberReason(reason || 'connection');
  bdScheduleBoardUpdates();
}

function bdMarkConnectionsDirtyByNodes(nodeIds, reason) {
  const ids = new Set([...(nodeIds || [])].filter(Boolean));
  if (!ids.size || typeof bd === 'undefined') return;
  if (typeof bdEnsureConnectionRuntime === 'function') bdEnsureConnectionRuntime(bd.connections);
  ids.forEach(id => _bdDirtyState.dirtyConnNodeIds.add(id));
  (bd.connections || []).forEach(conn => {
    if ((ids.has(conn.from) || ids.has(conn.to)) && conn.id) _bdDirtyState.dirtyConnIds.add(conn.id);
  });
  _bdDirtyState.dirtyMinimap = true;
  bdDirtyRememberReason(reason || 'connection-by-node');
  bdScheduleBoardUpdates();
}

function bdMarkSelectionDirty(nodeIds, reason) {
  _bdDirtyState.dirtySelection = true;
  [...(nodeIds || [])].filter(Boolean).forEach(id => _bdDirtyState.dirtySelectionIds.add(id));
  bdDirtyRememberReason(reason || 'selection');
  bdScheduleBoardUpdates();
}

function bdMarkBoardUiDirty(reason) {
  _bdDirtyState.dirtyBoardUi = true;
  bdDirtyRememberReason(reason || 'board-ui');
  bdScheduleBoardUpdates();
}

function bdMarkExtrasDirty(flags = {}, reason) {
  if (flags === true) {
    _bdDirtyState.dirtySelection = true;
    _bdDirtyState.dirtyFrames = true;
    _bdDirtyState.dirtyMinimap = true;
    _bdDirtyState.dirtyBoardUi = true;
    _bdDirtyState.dirtyCommentsAll = true;
  } else {
    if (flags.selection) _bdDirtyState.dirtySelection = true;
    if (flags.frames) _bdDirtyState.dirtyFrames = true;
    if (flags.minimap) _bdDirtyState.dirtyMinimap = true;
    if (flags.boardUi) _bdDirtyState.dirtyBoardUi = true;
    if (flags.detailPanel) _bdDirtyState.dirtyDetailPanel = true;
    if (flags.comments === true) _bdDirtyState.dirtyCommentsAll = true;
    else if (Array.isArray(flags.comments) || flags.comments instanceof Set) {
      [...flags.comments].filter(Boolean).forEach(id => _bdDirtyState.dirtyCommentNodeIds.add(id));
    }
  }
  bdDirtyRememberReason(reason || 'extras');
  bdScheduleBoardUpdates();
}

function bdRequestFullRender(reason) {
  _bdDirtyState.needsFullRender = true;
  _bdDirtyState.fullRenderReason = reason || _bdDirtyState.fullRenderReason || 'unspecified';
  bdDirtyRememberReason('full:' + (_bdDirtyState.fullRenderReason || 'unspecified'));
  bdScheduleBoardUpdates();
}

function bdDirtyRememberReason(reason) {
  if (reason) _bdDirtyState.reasons.add(String(reason));
}

function bdScheduleBoardUpdates(delayMs) {
  const delay = Number.isFinite(+delayMs) ? Math.max(0, +delayMs) : 0;
  clearTimeout(_bdDirtyUpdateTimer);
  if (_bdDirtyUpdateRaf) {
    cancelAnimationFrame(_bdDirtyUpdateRaf);
    _bdDirtyUpdateRaf = 0;
  }
  _bdDirtyUpdateTimer = setTimeout(() => {
    _bdDirtyUpdateTimer = 0;
    _bdDirtyUpdateRaf = requestAnimationFrame(() => {
      _bdDirtyUpdateRaf = 0;
      bdFlushBoardUpdates();
    });
  }, delay);
}

function bdFlushBoardUpdates() {
  if (typeof bdShouldDeferBoardExtras === 'function' && bdShouldDeferBoardExtras()) {
    bdScheduleBoardUpdates(16);
    return;
  }
  const state = _bdDirtyState;
  if (!bdDirtyHasWork(state)) return;
  _bdDirtyState = bdCreateEmptyDirtyState();
  const started = typeof bdPerfStart === 'function' ? bdPerfStart('bdFlushBoardUpdates') : 0;
  if (state.needsFullRender) {
    bdFlushDirtyFullRender(state, started);
    return;
  }
  if (bdDirtyShouldUseFullRender(state)) {
    state.fullRenderReason = state.fullRenderReason || 'dirty-node-threshold';
    bdFlushDirtyFullRender(state, started);
    return;
  }
  const rendered = bdFlushDirtyNodes(state);
  bdFlushDirtyMovedNodes(state, rendered);
  bdFlushDirtySelection(state, rendered);
  bdFlushDirtyConnections(state);
  bdFlushDirtyFrames(state);
  bdFlushDirtyComments(state);
  bdFlushDirtyMinimap(state);
  bdFlushDirtyBoardUi(state);
  if (typeof bdPerfEnd === 'function') {
    bdPerfEnd('bdFlushBoardUpdates', started, bdDirtyMeta(state));
  }
}

function bdDirtyHasWork(state) {
  return state.needsFullRender
    || state.dirtyNodeIds.size
    || state.dirtyMovedNodeIds.size
    || state.dirtyConnIds.size
    || state.dirtyConnNodeIds.size
    || state.dirtySelectionIds.size
    || state.dirtyCommentNodeIds.size
    || state.dirtySelection
    || state.dirtyFrames
    || state.dirtyMinimap
    || state.dirtyBoardUi
    || state.dirtyCommentsAll
    || state.dirtyDetailPanel;
}

function bdDirtyShouldUseFullRender(state) {
  const total = (typeof bd !== 'undefined' && bd?.nodes) ? bd.nodes.length : 0;
  if (!total) return false;
  return state.dirtyNodeIds.size > Math.max(40, Math.ceil(total * BD_DIRTY_FULL_RENDER_NODE_RATIO));
}

function bdFlushDirtyFullRender(state, started) {
  const reason = state.fullRenderReason || [...state.reasons][0] || 'dirty-fallback';
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdFlushBoardUpdates', started, 'full-render reason=' + reason);
  const renderStarted = typeof bdPerfStart === 'function' ? bdPerfStart('bdRequestFullRender:' + reason) : 0;
  if (typeof bdRender === 'function') bdRender();
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdRequestFullRender:' + reason, renderStarted);
}

function bdFlushDirtyNodes(state) {
  const rendered = new Set();
  if (!state.dirtyNodeIds.size) return rendered;
  const ctx = typeof bdCreateRenderContext === 'function' ? bdCreateRenderContext() : null;
  for (const nodeId of state.dirtyNodeIds) {
    const ok = typeof bdReplaceNodeElement === 'function'
      ? bdReplaceNodeElement(nodeId, { renderContext: ctx })
      : false;
    if (!ok) {
      state.needsFullRender = true;
      state.fullRenderReason = 'node-replace-fallback:' + nodeId;
      bdRequestFullRender(state.fullRenderReason);
      continue;
    }
    rendered.add(nodeId);
  }
  return rendered;
}

function bdFlushDirtyMovedNodes(state, rendered) {
  state.dirtyMovedNodeIds.forEach(nodeId => {
    if (rendered.has(nodeId)) return;
    if (typeof bdUpdateNodePosition === 'function') bdUpdateNodePosition(nodeId);
  });
}

function bdFlushDirtySelection(state, rendered) {
  const ids = new Set([...state.dirtySelectionIds, ...rendered]);
  if (state.dirtySelection && bd?.selected) bd.selected.forEach(id => ids.add(id));
  if (!ids.size && !state.dirtySelection) return;
  bdApplySelectionDomClass();
  if (typeof bdRemoveSelectionUiForMissingNodes === 'function') bdRemoveSelectionUiForMissingNodes();
  ids.forEach(id => {
    if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
    else if (typeof bdSyncSelectionRectForNode === 'function') bdSyncSelectionRectForNode(id);
  });
  const layer = document.getElementById('bd-resize-layer');
  if (layer && typeof _bdSyncGroupAnchors === 'function') _bdSyncGroupAnchors(layer);
}

function bdFlushDirtyConnections(state) {
  const connCount = (typeof bd !== 'undefined' && bd?.connections) ? bd.connections.length : 0;
  const connIds = new Set(state.dirtyConnIds);
  if (connIds.size && connCount && connIds.size > Math.max(50, Math.ceil(connCount * BD_DIRTY_FULL_DRAW_CONN_RATIO))) {
    if (typeof bdDrawConns === 'function') bdDrawConns({ reason: 'dirty-conn-threshold' });
    return;
  }
  if (connIds.size && typeof bdDrawConns === 'function') {
    bdDrawConns({ connIds: [...connIds], reason: 'dirty' });
    return;
  }
  if (state.dirtyConnNodeIds.size && typeof bdDrawConns === 'function') {
    bdDrawConns({ nodeIds: [...state.dirtyConnNodeIds], reason: 'dirty-nodes' });
  }
}

function bdFlushDirtyFrames(state) {
  if (state.dirtyFrames && typeof bdDrawFrames === 'function') bdDrawFrames();
}

function bdFlushDirtyComments(state) {
  const container = document.getElementById('bd-nodes');
  if (typeof CommentBadges === 'undefined' || !bd?.path || !container) return;
  if (state.dirtyCommentsAll) {
    try { CommentBadges.refreshBoard(bd.path, container); } catch {}
    return;
  }
  if (!state.dirtyCommentNodeIds.size) return;
  try {
    CommentBadges.refreshBoard(bd.path, container, { cardIds: [...state.dirtyCommentNodeIds] });
  } catch {}
}

function bdFlushDirtyMinimap(dirtyState) {
  if (!dirtyState.dirtyMinimap || typeof bdUpdateMinimap !== 'function') return;
  const pane = document.getElementById('gb-preview-pane');
  if (!pane || (typeof state !== 'undefined' && state.view !== 'board')) return;
  if (typeof bdShouldRenderMinimapInPreviewPane === 'function' && !bdShouldRenderMinimapInPreviewPane(pane)) return;
  // ノード/接続/スタイル更新系の dirty はキャッシュも無効化 (bdTransform からの pure transform 呼び出しと区別する)
  if (typeof bdInvalidateMinimapCache === 'function') bdInvalidateMinimapCache();
  bdUpdateMinimap();
}

function bdFlushDirtyBoardUi(state) {
  if (!state.dirtyBoardUi && !state.dirtyDetailPanel) return;
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
}

function bdDirtyMeta(state) {
  const reasons = [...state.reasons].slice(0, 5).join(',');
  return `nodes=${state.dirtyNodeIds.size} moved=${state.dirtyMovedNodeIds.size} conns=${state.dirtyConnIds.size} selection=${state.dirtySelectionIds.size} reasons=${reasons}`;
}
