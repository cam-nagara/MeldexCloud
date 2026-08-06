/* gb-canvas-interact.js: Canvas Mouse & Keyboard Interaction (v5.0 Phase C) */

// ============================================================
//  Mouse Interaction
// ============================================================

/**
 * Set up all mouse event handlers on the bd-canvas element.
 * Call after the canvas DOM is ready.
 * @returns {Function} cleanup - removes all event listeners
 */
function bdIsInteractiveCanvas(canvas) {
  if (!canvas || !canvas.isConnected) return false;
  const canvasStyle = window.getComputedStyle(canvas);
  if (canvasStyle.display === 'none' || canvasStyle.visibility === 'hidden') return false;
  const root = canvas.closest?.('.gb-canvas-root') || canvas;
  const rootStyle = window.getComputedStyle(root);
  if (rootStyle.display === 'none' || rootStyle.visibility === 'hidden') return false;
  return true;
}

function bdEnsureInteractiveCanvas(canvas) {
  if (!bdIsInteractiveCanvas(canvas)) return false;
  if (typeof state !== 'undefined') {
    state.view = 'board';
    if (bd.path) state.currentBoardPath = bd.path;
  }
  return true;
}

function _bdPointerZoom() {
  if (typeof bdGetAppZoom === 'function') return bdGetAppZoom();
  return (typeof _getZoom === 'function') ? Math.max(0.1, _getZoom()) : 1;
}

function _bdPointerDelta(value) {
  return value / _bdPointerZoom();
}

let _bdDragClickSuppressUntil = 0;
let _bdDragClickSuppressNodeIds = new Set();

function bdSuppressNodeClickAfterDrag(nodeIds, ttlMs = 700) {
  const ids = (Array.isArray(nodeIds) ? nodeIds : [nodeIds]).filter(Boolean);
  if (!ids.length) return;
  _bdDragClickSuppressNodeIds = new Set(ids);
  _bdDragClickSuppressUntil = Date.now() + Math.max(0, ttlMs);
}

function bdShouldSuppressNodeClickAfterDrag(nodeId) {
  if (!_bdDragClickSuppressUntil || Date.now() > _bdDragClickSuppressUntil) {
    _bdDragClickSuppressUntil = 0;
    _bdDragClickSuppressNodeIds.clear();
    return false;
  }
  return _bdDragClickSuppressNodeIds.has(nodeId);
}

function bdDragMovedBeyondClickThreshold(dragOffsets, event, threshold = 4) {
  if (!dragOffsets || !event) return false;
  return Object.values(dragOffsets).some(offset => {
    if (!offset) return false;
    return Math.abs(event.clientX - offset.sx) + Math.abs(event.clientY - offset.sy) >= threshold;
  });
}

function bdSegmentIntersectsRect(x1, y1, x2, y2, l, t, w, h) {
  const r = l + w;
  const b = t + h;
  if ((x1 >= l && x1 <= r && y1 >= t && y1 <= b) || (x2 >= l && x2 <= r && y2 >= t && y2 <= b)) return true;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  if (maxX < l || minX > r || maxY < t || minY > b) return false;
  const intersectsVertical = (x) => {
    if (x1 === x2) return x >= minX && x <= maxX && maxY >= t && minY <= b;
    const ratio = (x - x1) / (x2 - x1);
    if (ratio < 0 || ratio > 1) return false;
    const y = y1 + (y2 - y1) * ratio;
    return y >= t && y <= b;
  };
  const intersectsHorizontal = (y) => {
    if (y1 === y2) return y >= minY && y <= maxY && maxX >= l && minX <= r;
    const ratio = (y - y1) / (y2 - y1);
    if (ratio < 0 || ratio > 1) return false;
    const x = x1 + (x2 - x1) * ratio;
    return x >= l && x <= r;
  };
  return intersectsVertical(l) || intersectsVertical(r) || intersectsHorizontal(t) || intersectsHorizontal(b);
}

function bdFindNodeDropTargetAtPoint(clientX, clientY, dragIds) {
  if (typeof document === 'undefined') return null;
  const ids = [...new Set((dragIds || []).filter(Boolean))];
  if (!ids.length) return null;
  const idSet = new Set(ids);
  const dragEls = ids.map(id => document.getElementById('bdn-' + id)).filter(Boolean);
  const selectionOverlays = typeof document.querySelectorAll === 'function'
    ? [...document.querySelectorAll('.bd-resize, .bd-selection-rect')]
    : [];
  const hitTestBlockers = [...new Set([...dragEls, ...selectionOverlays])];
  const prevHitTestStyles = hitTestBlockers.map(el => [el, el.style.pointerEvents, el.style.visibility]);
  hitTestBlockers.forEach(el => {
    el.style.pointerEvents = 'none';
    el.style.visibility = 'hidden';
  });
  const underEl = document.elementFromPoint(clientX, clientY)?.closest?.('.bd-node') || null;
  prevHitTestStyles.forEach(([el, pointerEvents, visibility]) => {
    el.style.pointerEvents = pointerEvents;
    el.style.visibility = visibility;
  });
  if (!underEl || typeof underEl.id !== 'string' || !underEl.id.startsWith('bdn-')) return null;
  const underId = underEl.id.substring(4);
  if (!underId || idSet.has(underId)) return null;
  if (typeof bdDescendants === 'function') {
    for (const id of ids) {
      if (bdDescendants(id).includes(underId)) return null;
    }
  }
  return underEl;
}

function bdIsNodeVisibleForInteraction(nodeId) {
  const el = document.getElementById('bdn-' + nodeId);
  return !!(el && el.isConnected);
}

function bdCanCreateConnection(fromId, toId) {
  // v0.5.332: 自己ループ (同じカード → 同じカード) も許可。
  // 自己ループは形状別に最適な既定経路 (曲線: 左上象限ループ / 直角線: L 字 2 段迂回) で描画される。
  return !!fromId && !!toId;
}

function bdIsAnnotationModeActive() {
  return typeof ann !== 'undefined' && !!ann.active && typeof state !== 'undefined' && state.view === 'board';
}

function bdInitInteraction(root) {
  const canvas = root?.querySelector?.('[data-bd-role="canvas"]')
    || (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas', root) : null)
    || document.getElementById('bd-canvas');
  if (!canvas) return () => {};
  let drag=null, dragOffsets=null, pan=false, panSX, panSY, panOX, panOY;
  let dragMoved = false;
  let touchPanPointerId = null, touchPanMoved = false;
  let touchPinch = null;
  const TOUCH_ROTATION_DEADZONE_DEG = 18;
  const TOUCH_ROTATION_RELEASE_DEG = 10;
  const touchPointers = new Map();
  let resizing=null, resizeNode=null, resizeSX, resizeSY, resizeOW, resizeOH;
  let resizeSelection=null;
  let selRect=null, selStart=null;
  let dragUndoCaptured = false;
  // CSP互換: Space+ドラッグでパン、Ctrl+Space+ドラッグでズーム、Shift+Space+ドラッグで回転
  let _spaceDown = false, _cspZoom = false, _cspZoomSX = 0, _cspZoomOZ = 1, _cspZoomMX = 0, _cspZoomMY = 0, _cspZoomOPX = 0, _cspZoomOPY = 0;
  let _cspRotate = false, _cspRotStartAngle = 0, _cspRotOR = 0, _cspRotCX = 0, _cspRotCY = 0;
  let erasing = false, eraseUndoCaptured = false, erasedNodeIds = null, erasedConnRefs = null;

  function normalizedAngleDeltaRadians(currentAngle, startAngle) {
    let delta = currentAngle - startAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function pointerWorldDelta(startEvent, currentEvent) {
    let dx = _bdPointerDelta(currentEvent.clientX - startEvent.sx);
    let dy = _bdPointerDelta(currentEvent.clientY - startEvent.sy);
    if (bd.rotation) {
      const rad = -bd.rotation * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
      dx = rx; dy = ry;
    }
    const zoom = Math.max(0.1, bd.zoom || 1);
    return { dx: dx / zoom, dy: dy / zoom };
  }

  function ensureDragUndoCaptured() {
    if (!dragUndoCaptured && typeof bdPushUndo === 'function') {
      bdPushUndo();
      dragUndoCaptured = true;
    }
  }

  function ensureEraseUndoCaptured() {
    if (!eraseUndoCaptured && typeof bdPushUndo === 'function') {
      bdPushUndo();
      eraseUndoCaptured = true;
    }
  }

  function ensureConnPreview() {
    let preview = document.getElementById('bd-conn-preview');
    if (!preview) {
      preview = document.createElementNS('http://www.w3.org/2000/svg','line');
      preview.id = 'bd-conn-preview';
      preview.setAttribute('stroke-width','2');
      preview.setAttribute('stroke-dasharray','6,4');
      document.getElementById('bd-svg')?.appendChild(preview);
    }
    const style = typeof bdGetLineStyleById === 'function' ? bdGetLineStyleById(bd.activeLineStyle) : null;
    preview.setAttribute('stroke', style?.color || 'var(--accent)');
    preview.setAttribute('stroke-width', String(style?.width || 2));
    preview.setAttribute('stroke-dasharray', style?.style === 'dashed' ? '6,4' : '');
    return preview;
  }

  function lineToolStartPoint(start) {
    if (!start) return null;
    if (start.fromPoint && typeof bdNormalizeConnectionPoint === 'function') {
      const point = bdNormalizeConnectionPoint(start.fromPoint);
      if (point) return point;
    }
    if (start.nid) {
      const n = bd.nodes.find(v => v.id === start.nid);
      if (!n) return null;
      const el = start.nodeEl || document.getElementById('bdn-' + start.nid);
      const pos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(n) : { x: n.x, y: n.y };
      return {
        x: pos.x + ((el?.offsetWidth || n.w || 100) / 2),
        y: pos.y + ((el?.offsetHeight || n.h || 60) / 2),
      };
    }
    return null;
  }

  function eraseConnection(conn) {
    if (!conn || erasedConnRefs.has(conn)) return;
    erasedConnRefs.add(conn);
    ensureEraseUndoCaptured();
    if (typeof bdRemoveConnection === 'function') {
      bdRemoveConnection(conn, { skipRender: true, skipDirty: true, skipSelection: true });
    } else {
      bd.connections = bd.connections.filter(item => item !== conn);
    }
    if (typeof bdRemoveConnectionFromSelection === 'function') bdRemoveConnectionFromSelection(conn.id);
    bdDrawConns();
    if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    bdDirty();
  }

  function boardNodeFromTarget(target) {
    const node = target?.closest?.('.bd-node');
    if (node) return node;
    const handle = target?.closest?.('.bd-resize[data-node-id]');
    return handle?.dataset?.nodeId ? document.getElementById('bdn-' + handle.dataset.nodeId) : null;
  }

  function bdIsTouchPointer(e) {
    return e?.pointerType === 'touch';
  }

  function shouldPanTouchCanvas(e, nodeEl) {
    if (!bdIsTouchPointer(e) || nodeEl || bd.editing || bd.connecting) return false;
    if (drag || resizing || erasing || touchPinch || bd._lineToolDrag || bd._rightDragNode) return false;
    return !['add-card', 'add-line', 'erase'].includes(bd.tool || 'select');
  }

  function startTouchCanvasPan(e) {
    pan = true;
    touchPanPointerId = e.pointerId;
    touchPanMoved = false;
    canvas.classList.add('bd-panning');
    panSX = e.clientX;
    panSY = e.clientY;
    panOX = bd.panX;
    panOY = bd.panY;
    try { canvas.setPointerCapture?.(e.pointerId); } catch (_) {}
  }

  function touchPointerPair() {
    return [...touchPointers.values()].slice(0, 2);
  }

  function touchDistance(a, b) {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.max(1, Math.hypot(dx, dy));
  }

  function touchAngle(a, b) {
    return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);
  }

  function touchMidpoint(a, b) {
    return { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
  }

  function beginTouchPinch() {
    const [a, b] = touchPointerPair();
    if (!a || !b) return false;
    const mid = touchMidpoint(a, b);
    const midLocal = (typeof bdClientToCanvasLocal === 'function')
      ? bdClientToCanvasLocal(mid.clientX, mid.clientY, canvas)
      : { x: mid.clientX, y: mid.clientY };
    touchPinch = {
      startDist: touchDistance(a, b),
      startZoom: bd.zoom || 1,
      startAngle: touchAngle(a, b),
      startRotation: bd.rotation || 0,
      rotationEngaged: false,
      startPanX: bd.panX || 0,
      startPanY: bd.panY || 0,
      midLocal,
    };
    pan = false;
    touchPanPointerId = null;
    touchPanMoved = false;
    canvas.classList.add('bd-panning');
    return true;
  }

  function updateTouchPinch(e) {
    const [a, b] = touchPointerPair();
    if (!touchPinch || !a || !b) return false;
    e.preventDefault();
    const mid = touchMidpoint(a, b);
    const midLocal = (typeof bdClientToCanvasLocal === 'function')
      ? bdClientToCanvasLocal(mid.clientX, mid.clientY, canvas)
      : { x: mid.clientX, y: mid.clientY };
    const newZoom = Math.max(0.1, Math.min(5, touchPinch.startZoom * (touchDistance(a, b) / touchPinch.startDist)));
    const scale = newZoom / touchPinch.startZoom;
    bd.panX = midLocal.x - (touchPinch.midLocal.x - touchPinch.startPanX) * scale;
    bd.panY = midLocal.y - (touchPinch.midLocal.y - touchPinch.startPanY) * scale;
    bd.zoom = newZoom;
    const angleDelta = normalizedAngleDeltaRadians(touchAngle(a, b), touchPinch.startAngle) * (180 / Math.PI);
    const absAngleDelta = Math.abs(angleDelta);
    if (!touchPinch.rotationEngaged && absAngleDelta >= TOUCH_ROTATION_DEADZONE_DEG) {
      touchPinch.rotationEngaged = true;
    } else if (touchPinch.rotationEngaged && absAngleDelta <= TOUCH_ROTATION_RELEASE_DEG) {
      touchPinch.rotationEngaged = false;
    }
    if (touchPinch.rotationEngaged) {
      const adjustedAngle = Math.max(0, absAngleDelta - TOUCH_ROTATION_DEADZONE_DEG) * Math.sign(angleDelta);
      bd.rotation = touchPinch.startRotation + adjustedAngle;
    } else {
      bd.rotation = touchPinch.startRotation;
    }
    bdTransform();
    const zoomLabel = document.getElementById('bd-zoom-label');
    if (zoomLabel) zoomLabel.textContent = Math.round(bd.zoom * 100) + '%';
    return true;
  }

  function eraseNodeById(nodeId) {
    if (!nodeId || erasedNodeIds.has(nodeId)) return;
    erasedNodeIds.add(nodeId);
    ensureEraseUndoCaptured();
    bd.connections = bd.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
    bd.nodes.forEach(n => {
      if (n.parent !== nodeId) return;
      if (n.contained) {
        const pos = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(n) : { x: n.x, y: n.y };
        n.x = pos.x;
        n.y = pos.y;
        n.contained = false;
      }
      n.parent = '';
    });
    if (bd.groups) bd.groups.forEach(g => { if (g.nodeIds) g.nodeIds = g.nodeIds.filter(id => id !== nodeId); });
    bd.nodes = bd.nodes.filter(n => n.id !== nodeId);
    if (typeof bdPruneConnectionSelection === 'function') bdPruneConnectionSelection();
    if (bd.groups) bd.groups = bd.groups.filter(g => g.nodeIds && g.nodeIds.length > 0);
    bd.selected.delete(nodeId);
    bdRender();
    if (!bd.selected.size && typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    bdDirty();
  }

  function eraseAtClientPoint(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY);
    const node = boardNodeFromTarget(target);
    if (node) {
      eraseNodeById(node.id.replace('bdn-',''));
      return;
    }
    const conn = target?.classList?.contains('bd-conn-hit') ? target._connData : target?.closest?.('.bd-conn-hit')?._connData;
    if (conn) eraseConnection(conn);
  }

  function captureResizeSelection(nodeIds) {
    const ids = [...new Set((nodeIds || []).filter(Boolean))];
    const items = ids.map(id => {
      const node = bd.nodes.find(n => n.id === id);
      const el = document.getElementById('bdn-' + id);
      if (!node || !el || node.contained || node.locked) return null;
      const imgEl = el.querySelector('.bd-img');
      const imgW = imgEl?.clientWidth || node._imgNaturalW || el.offsetWidth || node.w || 160;
      const imgH = imgEl?.clientHeight || node._imgNaturalH || el.offsetHeight || node.h || 36;
      return {
        id,
        node,
        x: node.x,
        y: node.y,
        w: el.offsetWidth || node.w || 160,
        h: el.offsetHeight || node.h || 36,
        isImage: !!(node.img && (imgW || imgH)),
      };
    }).filter(Boolean);
    if (!items.length) return null;
    const x0 = Math.min(...items.map(item => item.x));
    const y0 = Math.min(...items.map(item => item.y));
    const x1 = Math.max(...items.map(item => item.x + item.w));
    const y1 = Math.max(...items.map(item => item.y + item.h));
    return { items, x0, y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
  }

  function applyResizeSelection(snapshot, scaleX, scaleY, imageScale) {
    if (!snapshot) return;
    const uniformScale = Math.max(0.1, imageScale || Math.sqrt(Math.max(0.01, scaleX * scaleY)));
    snapshot.items.forEach(item => {
      const node = item.node;
      node.x = snapshot.x0 + (item.x - snapshot.x0) * scaleX;
      node.y = snapshot.y0 + (item.y - snapshot.y0) * scaleY;
      if (item.isImage) {
        node.w = Math.max(40, Math.round(item.w * uniformScale));
        node.h = 0;
      } else {
        node.w = Math.max(40, Math.round(item.w * scaleX));
        node.h = Math.max(28, Math.round(item.h * scaleY));
      }
      node._userW = true;
      const el = document.getElementById('bdn-' + item.id);
      if (!el) return;
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
      el.style.width = node.w + 'px';
      el.style.minHeight = node.h ? (node.h + 'px') : '';
      // 雲型・トゲ型 (直線/曲線)・もやもや はサイズに応じて山の個数と clip-path を再計算する
      if (el.dataset.shape === 'cloud' || el.dataset.shape === 'thorn' || el.dataset.shape === 'thorn-curve' || el.dataset.shape === 'fluffy') {
        const ns = typeof bdGetNodeStyle === 'function' ? bdGetNodeStyle(node) : null;
        const fn = el.dataset.shape === 'thorn-curve' ? _bdThornCurveClipPath
                 : el.dataset.shape === 'thorn' ? _bdThornClipPath
                 : el.dataset.shape === 'fluffy' ? _bdFluffyClipPath
                 : _bdCloudClipPath;
        if (typeof fn === 'function') {
          const path = fn(el.offsetWidth, el.offsetHeight, ns ? {
            bumpW: ns.cloudBumpWidth, bumpH: ns.cloudBumpHeight, sideW: ns.cloudSideWidth,
            offset: ns.cloudOffset, radius: ns.borderRadius,
            subWidth: ns.cloudSubWidthRatio, subHeight: ns.cloudSubHeightRatio,
          } : undefined);
          if (path && typeof _bdApplyCloudShape === 'function') {
            _bdApplyCloudShape(el, path, ns?.borderColor || '', ns?.borderWidth || 0, ns?.bgColor || '');
          }
        }
      }
      // シェイプに応じたテキスト安全域のパディングも再計算
      if (el.dataset.shape === 'ellipse' || el.dataset.shape === 'cloud' || el.dataset.shape === 'thorn' || el.dataset.shape === 'thorn-curve' || el.dataset.shape === 'fluffy') {
        if (typeof _bdComputeShapePadding === 'function') {
          const ns = typeof bdGetNodeStyle === 'function' ? bdGetNodeStyle(node) : null;
          const pad = _bdComputeShapePadding(el.dataset.shape, el.offsetWidth, el.offsetHeight, ns);
          if (pad) el.style.padding = `${pad.padY}px ${pad.padX}px`;
        }
      }
    });
    const resizedIds = snapshot.items.map(item => item.id);
    resizedIds.forEach(id => {
      if (typeof bdMeasureNodeElement === 'function') bdMeasureNodeElement(id);
      if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
    });
    if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
    bdDrawConns({ nodeIds: resizedIds, reason: 'resize' });
    if (typeof bdDrawFrames === 'function') bdDrawFrames();
  }

  // --- pointerdown on canvas ---
  function onCanvasPointerdown(e) {
    if (!bdEnsureInteractiveCanvas(canvas)) return;
    const annotationMode = bdIsAnnotationModeActive();
    if (annotationMode && !(e.button === 1 || e.button === 2 || (_spaceDown && e.button === 0))) return;
    if (bdIsTouchPointer(e)) {
      touchPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (
        touchPointers.size >= 2 &&
        !bd.editing &&
        !drag &&
        !resizing &&
        !erasing &&
        !bd._lineToolDrag &&
        !bd._rightDragNode
      ) {
        e.preventDefault();
        if (beginTouchPinch()) return;
      }
    }

    // Space押下中: パン/ズーム/回転のみ（カード・ライン操作を無効化）
    if (_spaceDown && e.button === 0) {
      e.preventDefault();
      if (e.ctrlKey) {
        _cspZoom = true; _cspZoomSX = e.clientX; _cspZoomOZ = bd.zoom;
        _cspZoomOPX = bd.panX; _cspZoomOPY = bd.panY;
        const local = (typeof bdClientToCanvasLocal === 'function')
          ? bdClientToCanvasLocal(e.clientX, e.clientY, canvas)
          : { x: e.clientX, y: e.clientY };
        _cspZoomMX = local.x; _cspZoomMY = local.y;
        canvas.classList.add('bd-panning');
      } else if (e.shiftKey) {
        _cspRotate = true; _cspRotOR = bd.rotation;
        const r = canvas.getBoundingClientRect();
        _cspRotCX = r.left + r.width / 2; _cspRotCY = r.top + r.height / 2;
        _cspRotStartAngle = Math.atan2(e.clientY - _cspRotCY, e.clientX - _cspRotCX);
        canvas.classList.add('bd-panning');
      } else {
        pan = true; canvas.classList.add('bd-panning');
        panSX = e.clientX; panSY = e.clientY; panOX = bd.panX; panOY = bd.panY;
      }
      return;
    }

    const nodeEl = e.target.closest('.bd-node');
    const isResize = e.target.classList.contains('bd-resize');
    const resizeNodeId = isResize ? (e.target.dataset.nodeId || '') : '';
    const resizeNodeEl = (!nodeEl && resizeNodeId) ? document.getElementById('bdn-' + resizeNodeId) : nodeEl;

    if (e.button===0 && bd.tool === 'erase') {
      e.preventDefault();
      if (!erasing) {
        erasing = true;
        eraseUndoCaptured = false;
        erasedNodeIds = new Set();
        erasedConnRefs = new Set();
      }
      eraseAtClientPoint(e.clientX, e.clientY);
      return;
    }

    if (e.button===0 && bd.tool === 'add-line' && nodeEl) {
      e.preventDefault();
      const nid = nodeEl.id.replace('bdn-','');
      bdSelect(nid);
      bd._lineToolDrag = { nid, nodeEl, startX: e.clientX, startY: e.clientY, dragged: false };
      ensureConnPreview();
      return;
    }

    if (e.button===0 && bd.tool === 'add-line' && !nodeEl) {
      e.preventDefault();
      const fromPoint = typeof bdScreenToWorld === 'function'
        ? bdScreenToWorld(e.clientX, e.clientY)
        : { x: e.clientX, y: e.clientY };
      bdSelect(null);
      bd._lineToolDrag = { fromPoint, startX: e.clientX, startY: e.clientY, dragged: false };
      ensureConnPreview();
      return;
    }

    // ライン左クリック: ライン選択
    if (e.button===0 && e.target.classList.contains('bd-conn-hit')) {
      e.preventDefault(); e.stopPropagation();
      const connId = e.target._connId || e.target._connData?.id || '';
      const conn = e.target._connData || (typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : null);
      if (e.ctrlKey && e.shiftKey && conn) {
        // Ctrl+Shift+クリック: ラインに属するツリー全体 (ルート＋全子孫) のカードを選択に追加
        const anchorId = conn.from || conn.to;
        const root = (typeof bdRoot === 'function') ? bdRoot(anchorId) : null;
        const treeIds = root
          ? [root.id, ...((typeof bdDescendants === 'function') ? bdDescendants(root.id) : [])]
          : (anchorId ? [anchorId] : []);
        treeIds.forEach(id => bd.selected.add(id));
        bdApplySelectionDomClass();
        if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(treeIds, 'line-tree-select');
        treeIds.forEach(id => {
          if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
        });
        if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
        if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
        else if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(false);
        canvas.focus();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        canvas.focus();
        return;
      }
      if (typeof bdSelectConnection === 'function') bdSelectConnection(connId);
      return;
    }

    // 編集中にノード外クリック -> 編集完了
    if (bd.editing && (!nodeEl || nodeEl.id.replace('bdn-','') !== bd.editing)) { bdFinishEdit(); }

    // 右ボタン: 常にパン。静止時はノード上ならノードメニュー、空白なら空白メニュー。
    if (e.button===2) { e.preventDefault();
      pan=true; canvas.classList.add('bd-panning');
      panSX=e.clientX; panSY=e.clientY; panOX=bd.panX; panOY=bd.panY;
      const menuNid = nodeEl ? nodeEl.id.replace('bdn-','') : null;
      bd._rightClickPos = {x:e.clientX, y:e.clientY, e:e, nid: menuNid};
      // 右ドラッグで一定以上動いたかのフラグ。直後に発火する contextmenu イベントで参照して
      // カード/ライン個別の contextmenu ハンドラーからメニューが開くのを抑止するために使う。
      bd._rightPanMoved = false;
      return;
    }

    // ホイールボタン（中ボタン）: パン
    if (e.button===1) { e.preventDefault();
      pan=true; canvas.classList.add('bd-panning');
      panSX=e.clientX; panSY=e.clientY; panOX=bd.panX; panOY=bd.panY;
      return;
    }

    if (e.button!==0) return;

    // Alt + 左ドラッグ (ノード上): 旧・右ドラッグと同じ接続線作成モード
    if (e.altKey && nodeEl) {
      e.preventDefault();
      const nid = nodeEl.id.replace('bdn-','');
      if (!bd.selected.has(nid) && !e.shiftKey) bdSelect(nid);
      bd._rightDragNode = { nid, startX: e.clientX, startY: e.clientY, nodeEl, dragged: false };
      return;
    }

    // 接続モード
    if (bd.connecting && nodeEl) {
      const toId = nodeEl.id.replace('bdn-','');
      if (bdCanCreateConnection(bd.connecting, toId)) { bdPushUndo(); bdCreateConnection(bd.connecting, toId, { label: bd._connLabel||'' }); }
      bd.connecting=null; bd._connLabel=''; bd._connOrigin=null; showStatus('ラインを追加しました'); return;
    }
    // Gap-2 §9.7: アンカー由来の接続モードで空白にドロップ → 新規カード作成 + 接続を
    // 1 操作としてまとめる（bdPushUndo 1 回で undo が両方戻る）。
    if (bd.connecting && !nodeEl && bd._connOrigin === 'anchor') {
      const fromId = bd.connecting;
      const wc = bdScreenToWorld(e.clientX, e.clientY);
      bdPushUndo();
      const newNode = (typeof bdCreateNodeWithStyle === 'function')
        ? bdCreateNodeWithStyle('', wc.x, wc.y, {})
        : (typeof bdNode === 'function' ? bdNode('', wc.x, wc.y, 160, 0, {}) : null);
      if (newNode) {
        bd.nodes.push(newNode);
        if (bdCanCreateConnection(fromId, newNode.id)) {
          bdCreateConnection(fromId, newNode.id, { label: bd._connLabel || '' });
        }
      }
      bd.connecting=null; bd._connLabel=''; bd._connOrigin=null;
      if (newNode) {
        if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(newNode)) {
          if (typeof bdRequestFullRender === 'function') bdRequestFullRender('anchor-mode-empty-add-fallback');
          else bdRender();
        }
        if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(newNode.id, 'anchor-mode-empty-add');
        if (typeof bdMarkConnectionsDirtyByNodes === 'function') bdMarkConnectionsDirtyByNodes([fromId, newNode.id], 'anchor-mode-empty-add');
        if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [newNode.id] }, 'anchor-mode-empty-add');
        bdSelect(newNode.id);
        // 追加直後のインライン編集は発火させない (F2 / ダブルクリックで編集開始)
      }
      bdDirty();
      showStatus('カードとラインを追加しました');
      e.preventDefault();
      return;
    }
    // ツールバー「ラインを引く」由来で空白にドロップ → 案β通り接続をキャンセル。
    if (bd.connecting && !nodeEl && bd._connOrigin !== 'anchor') {
      bd.connecting=null; bd._connLabel=''; bd._connOrigin=null;
      showStatus('ラインの作成をキャンセル');
      return;
    }

    // リサイズ
    if (isResize && resizeNodeEl) {
      const nid = resizeNodeId || resizeNodeEl.id.replace('bdn-','');
      if (!bd.selected.has(nid)) bdSelect(nid);
      resizeNode = bd.nodes.find(n=>n.id===nid);
      if (resizeNode?.locked) { resizeNode = null; e.preventDefault(); return; }
      resizeSelection = captureResizeSelection(bd.selected.has(nid) ? [...bd.selected] : [nid]);
      if (resizeNode && resizeSelection) {
        resizing=nid;
        resizeSX=e.clientX;
        resizeSY=e.clientY;
        resizeOW=resizeSelection.width;
        resizeOH=resizeSelection.height;
        bdPushUndo();
      }
      e.preventDefault(); return;
    }

    // ノードクリック
    if (nodeEl && !bd.editing) {
      const nid = nodeEl.id.replace('bdn-','');
      const clickedNode = bd.nodes.find(v => v.id === nid);
      if (e.target.closest('.auto-link')) { if (typeof onAutoLinkClick === 'function') onAutoLinkClick(e.target.closest('.auto-link'), e); return; }
      if (e.ctrlKey && e.shiftKey) {
        // Ctrl+Shift+クリック: クリックしたカードと親子関係にあるツリー全体 (ルート＋全子孫) を選択に追加
        const root = (typeof bdRoot === 'function') ? bdRoot(nid) : null;
        const treeIds = root
          ? [root.id, ...((typeof bdDescendants === 'function') ? bdDescendants(root.id) : [])]
          : [nid];
        treeIds.forEach(id => bd.selected.add(id));
        bd._activeNode = nid;
        bdApplySelectionDomClass();
        if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(treeIds, 'tree-select');
        treeIds.forEach(id => {
          if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
        });
        if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
        if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
        else if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(false);
        canvas.focus();
        e.preventDefault();
        return;
      }
      if (e.ctrlKey) {
        const touched = [nid];
        if (bd.selected.has(nid)) bd.selected.delete(nid); else bd.selected.add(nid);
        bdApplySelectionDomClass();
        if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(touched, 'toggle-select');
        if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(nid);
        else if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
        if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
        else if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(false);
      }
      else { if (!bd.selected.has(nid)) bdSelect(nid); }
      // v0.5.285: フォーカスモード廃止 — クリックでの自動ズームは廃止、Space キーで手動フォーカス。
      canvas.focus();
      // ロックされたノードはドラッグ不可
      if (clickedNode && clickedNode.locked) { e.preventDefault(); return; }
      // ドラッグ開始（選択中の全ノード）
      drag = nid; canvas.classList.add('bd-node-dragging');
      dragUndoCaptured = false;
      dragOffsets = {};
      // ox/oy は絶対座標で保存する。contained ノードは親の絶対座標を足してから保存。
      // 多段ネスト (contained の中の contained) にも対応するため、連鎖を最深部まで辿る。
      // これによりドラッグ閾値を超えた時点で contained を解除しても座標の整合性を保てる。
      const dragOffsetEntry = (n) => {
        let ox = n.x, oy = n.y;
        let cur = n;
        while (cur.contained && cur.parent) {
          const p = bd.nodes.find(v => v.id === cur.parent);
          if (!p) break;
          ox += p.x; oy += p.y;
          cur = p;
        }
        return { sx: e.clientX, sy: e.clientY, ox, oy };
      };
      bd.selected.forEach(id => { const n=bd.nodes.find(v=>v.id===id); if(n && !n.locked) dragOffsets[id]=dragOffsetEntry(n); });
      if (!dragOffsets[nid]) { const n=bd.nodes.find(v=>v.id===nid); if(n && !n.locked) dragOffsets[nid]=dragOffsetEntry(n); }
      // 追従モード: 親ノードの子孫もdragOffsetsに追加
      Object.keys({...dragOffsets}).forEach(id => {
        const pn = bd.nodes.find(v=>v.id===id);
        if (pn && pn._followChildren) {
          bdDescendants(id).forEach(did => {
            if (!dragOffsets[did]) {
              const dn=bd.nodes.find(v=>v.id===did);
              if(dn && !dn.locked) dragOffsets[did]={...dragOffsetEntry(dn), followOnly:true, followParent:id};
            }
          });
        }
      });
      // ドラッグ閾値超過時に contained ノードをコンテナから取り出す判定用フラグ
      bd._dragExtracted = false;
      dragMoved = false;
      e.preventDefault(); return;
    }

    if (!nodeEl && bd.tool === 'add-card') {
      const wc = bdScreenToWorld(e.clientX, e.clientY);
      bdAddAt(wc.x, wc.y);
      return;
    }
    if (!nodeEl && bd.tool === 'add-line') {
      e.preventDefault();
      return;
    }

    // タッチ端末では、空白ドラッグは範囲選択ではなくボード移動として扱う。
    if (!nodeEl && shouldPanTouchCanvas(e, nodeEl)) {
      e.preventDefault();
      canvas.focus();
      startTouchCanvasPan(e);
      return;
    }

    // 空白左クリック: 範囲選択（ワールド座標で記録）
    if (!nodeEl) {
      if (!e.ctrlKey) bdSelect(null);
      canvas.focus();
      const startPoint = (typeof bdScreenToWorld === 'function')
        ? bdScreenToWorld(e.clientX, e.clientY)
        : (() => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - bd.panX) / bd.zoom, y: (e.clientY - r.top - bd.panY) / bd.zoom }; })();
      selStart = {
        ...startPoint,
        additive: !!e.ctrlKey,
        baseSelection: new Set(bd.selected),
        // Phase 4: ライン混在選択対応 — 矩形選択開始時のライン選択状態を記録
        baseSelConnIds: new Set(typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : []),
      };
      e.preventDefault();
    }
  }

  // --- pointermove on document (global) ---
  function onDocPointermove(e) {
    if (bdIsTouchPointer(e) && touchPointers.has(e.pointerId)) {
      touchPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (touchPinch && updateTouchPinch(e)) return;
    }
    if (pan) {
      if (touchPanPointerId !== null) {
        if (e.pointerId !== touchPanPointerId) return;
        e.preventDefault();
      }
      let dx = _bdPointerDelta(e.clientX - panSX), dy = _bdPointerDelta(e.clientY - panSY);
      if (touchPanPointerId !== null && !touchPanMoved) {
        touchPanMoved = Math.abs(e.clientX - panSX) >= 4 || Math.abs(e.clientY - panSY) >= 4;
      }
      // 回転中はドラッグ方向を逆回転して補正
      if (bd.rotation) {
        const rad = -bd.rotation * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
        dx = rx; dy = ry;
      }
      bd.panX = panOX + dx; bd.panY = panOY + dy;
      bdTransform();
      // 右ドラッグパン中は、移動量が閾値を超えたら「メニュー抑止フラグ」を立てる。
      // pointerup 直後に発火する contextmenu イベントで参照される。
      if (bd._rightClickPos && !bd._rightPanMoved) {
        if (Math.abs(e.clientX - bd._rightClickPos.x) >= 4 || Math.abs(e.clientY - bd._rightClickPos.y) >= 4) {
          bd._rightPanMoved = true;
        }
      }
    }
    // Ctrl+Space+ドラッグ: 左右でズーム（ドラッグ開始地点を軸）
    if (_cspZoom) {
      const delta = _bdPointerDelta(e.clientX - _cspZoomSX) * 0.005;
      const newZoom = Math.max(0.1, Math.min(5, _cspZoomOZ + delta));
      // ドラッグ開始地点を軸にズーム（ホイールズームと同じ原理）
      bd.panX = _cspZoomMX - (_cspZoomMX - _cspZoomOPX) * (newZoom / _cspZoomOZ);
      bd.panY = _cspZoomMY - (_cspZoomMY - _cspZoomOPY) * (newZoom / _cspZoomOZ);
      bd.zoom = newZoom;
      bdTransform();
    }
    // Shift+Space+ドラッグ: キャンバス中心を軸に回転
    if (_cspRotate) {
      const curAngle = Math.atan2(e.clientY - _cspRotCY, e.clientX - _cspRotCX);
      const delta = normalizedAngleDeltaRadians(curAngle, _cspRotStartAngle) * (180 / Math.PI);
      bd.rotation = _cspRotOR + delta;
      bdTransform();
    }
    if (bd._lineToolDrag) {
      const preview = ensureConnPreview();
      const start = bd._lineToolDrag;
      const dx = e.clientX - (start.startX || e.clientX);
      const dy = e.clientY - (start.startY || e.clientY);
      if (!start.dragged && Math.sqrt(dx*dx+dy*dy) > 4) start.dragged = true;
      const startPt = lineToolStartPoint(start);
      if (startPt) {
        const _w = typeof bdScreenToWorld === 'function' ? bdScreenToWorld(e.clientX, e.clientY) : { x: (e.clientX - canvas.getBoundingClientRect().left - bd.panX) / bd.zoom, y: (e.clientY - canvas.getBoundingClientRect().top - bd.panY) / bd.zoom };
        preview.setAttribute('x1', startPt.x);
        preview.setAttribute('y1', startPt.y);
        preview.setAttribute('x2', _w.x);
        preview.setAttribute('y2', _w.y);
      }
    }
    if (erasing) eraseAtClientPoint(e.clientX, e.clientY);
    // 右ドラッグ接続線
    if (bd._rightDragNode) {
      const rd = bd._rightDragNode;
      const dx = e.clientX - rd.startX, dy = e.clientY - rd.startY;
      if (!rd.dragged && Math.sqrt(dx*dx+dy*dy) > 8) {
        rd.dragged = true;
        ensureConnPreview();
      }
      if (rd.dragged) {
        const preview = ensureConnPreview();
        if (preview) {
          const n = bd.nodes.find(v=>v.id===rd.nid);
          if (n) {
            const _w = typeof bdScreenToWorld === 'function' ? bdScreenToWorld(e.clientX, e.clientY) : { x: (e.clientX - canvas.getBoundingClientRect().left - bd.panX) / bd.zoom, y: (e.clientY - canvas.getBoundingClientRect().top - bd.panY) / bd.zoom };
            const pos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(n) : { x: n.x, y: n.y };
            preview.setAttribute('x1', pos.x + (rd.nodeEl.offsetWidth||100)/2);
            preview.setAttribute('y1', pos.y + (rd.nodeEl.offsetHeight||60)/2);
            preview.setAttribute('x2', _w.x);
            preview.setAttribute('y2', _w.y);
          }
        }
      }
    }
    // ドラッグ閾値超過時、contained ノードをコンテナから取り出す (独立カード化)
    if (drag && dragOffsets && !dragMoved && bdDragMovedBeyondClickThreshold(dragOffsets, e)) {
      dragMoved = true;
      ensureDragUndoCaptured();
    }
    if (drag && dragOffsets && !bd._dragExtracted) {
      if (!dragMoved) return;
      let extractedAny = false;
      Object.keys(dragOffsets).forEach(id => {
        if (dragOffsets[id]?.followOnly) return;
        const n = bd.nodes.find(v => v.id === id);
        if (n && n.contained) {
          n.contained = false;
          n.parent = '';
          extractedAny = true;
        }
      });
      bd._dragExtracted = true;
      if (extractedAny && typeof bdRender === 'function') bdRender();
    }
    if (drag && dragOffsets) {
      if (!dragMoved) return;
      const firstOffset = dragOffsets[Object.keys(dragOffsets)[0]];
      const firstDelta = firstOffset ? pointerWorldDelta(firstOffset, e) : { dx: 0, dy: 0 };
      let rawDx = firstDelta.dx;
      let rawDy = firstDelta.dy;
      // Shift軸固定: 大きい方の軸のみ移動
      if (e.shiftKey) { if (Math.abs(rawDx) > Math.abs(rawDy)) rawDy = 0; else rawDx = 0; }
      for (const [id, o] of Object.entries(dragOffsets)) {
        const n=bd.nodes.find(v=>v.id===id);
        const delta = e.shiftKey ? { dx: rawDx, dy: rawDy } : pointerWorldDelta(o, e);
        const dx = delta.dx;
        const dy = delta.dy;
        if(n) {
          if (o.followOnly && n.contained) continue;
          // contained カードは親基準の inline フロー。x/y は相対座標で更新するが、
          // 直接 style.left/top を書くとインライン配置と競合するため DOM 更新は抑止。
          n.x=o.ox+dx; n.y=o.oy+dy;
          if (n.contained) continue;
          const el=document.getElementById('bdn-'+id); if(el){el.style.left=n.x+'px';el.style.top=n.y+'px';}
        }
      }
      const movedIds = Object.keys(dragOffsets);
      movedIds.forEach(id => {
        if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
      });
      if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
      bdDrawConns({ nodeIds: movedIds, reason: 'drag-move' });
      bdDrawFrames();
      // ドロップターゲットのハイライト（ドラッグ中のノードの下にあるノードを検出）
      document.querySelectorAll('.bd-node.bd-drop-target').forEach(el => el.classList.remove('bd-drop-target'));
      const underEl = bdFindNodeDropTargetAtPoint(e.clientX, e.clientY, Object.keys(dragOffsets));
      if (underEl) {
        const underId = underEl.id.replace('bdn-','');
        if (!dragOffsets[underId]) underEl.classList.add('bd-drop-target');
      }
    }
    if (resizing && resizeSelection) {
      const resizeDelta = pointerWorldDelta({ sx: resizeSX, sy: resizeSY }, e);
      const nextW = Math.max(40, resizeOW + resizeDelta.dx);
      const nextH = Math.max(28, resizeOH + resizeDelta.dy);
      const scaleX = nextW / Math.max(1, resizeOW);
      const scaleY = nextH / Math.max(1, resizeOH);
      const imageScale = Math.abs(e.clientX - resizeSX) >= Math.abs(e.clientY - resizeSY) ? scaleX : scaleY;
      applyResizeSelection(resizeSelection, scaleX, scaleY, imageScale);
    }
    if (selStart) {
      // ワールド座標で矩形選択を計算（bd-world にappendしてズーム/パンに追従）
      const wp = (typeof bdScreenToWorld === 'function')
        ? bdScreenToWorld(e.clientX, e.clientY)
        : (() => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - bd.panX) / bd.zoom, y: (e.clientY - r.top - bd.panY) / bd.zoom }; })();
      if (!selRect) {
        selRect = document.createElement('div');
        selRect.className = 'bd-select-rect';
        const world = document.getElementById('bd-world') || canvas;
        world.appendChild(selRect);
      }
      const l = Math.min(selStart.x, wp.x), t = Math.min(selStart.y, wp.y);
      const w = Math.abs(wp.x - selStart.x), h = Math.abs(wp.y - selStart.y);
      // 線幅をズームに合わせて補正（見た目を一定に保つ）
      const zInv = 1 / Math.max(0.1, bd.zoom || 1);
      selRect.style.cssText = `left:${l}px;top:${t}px;width:${w}px;height:${h}px;position:absolute;border-width:${zInv}px;`;
      // 範囲内のノード / ライン を判定（ワールド座標で判定）
      // Ctrl+ドラッグ (additive): baseSelection XOR rect_items （矩形内のうち既に選択済みだったものは外れ、選択されていなかったものは加わる = トグル）
      // 通常ドラッグ: rect_items のみ （baseSelection は捨てる）
      const rectNodeIds = new Set();
      bd.nodes.forEach(n => {
        const el = document.getElementById('bdn-'+n.id);
        if (!el || !el.isConnected) return;
        const nw = el.offsetWidth || 100, nh = el.offsetHeight || 30;
        const pos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(n) : { x: n.x, y: n.y };
        if (pos.x + nw > l && pos.x < l + w && pos.y + nh > t && pos.y < t + h) rectNodeIds.add(n.id);
      });
      if (selStart.additive) {
        const base = selStart.baseSelection || new Set();
        bd.selected = new Set(base);
        rectNodeIds.forEach(id => {
          if (base.has(id)) bd.selected.delete(id); // 既に選択中 → 外す
          else bd.selected.add(id);                 // 未選択 → 加える
        });
      } else {
        bd.selected = rectNodeIds;
      }
      bdApplySelectionDomClass();
      if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
      // Phase 4: 矩形選択でライン (connection) も判定 — 曲線サンプリング方式で矩形内に1点でも入れば選択
      const rectConnIds = new Set();
      (bd.connections || []).forEach(c => {
        if (c.hidden) return;
        const pathEl = document.getElementById(`bd-path-${c.id}`);
        if (!pathEl || typeof pathEl.getTotalLength !== 'function') return;
        try {
          const total = pathEl.getTotalLength();
          if (!total) return;
          const samples = Math.min(240, Math.max(24, Math.ceil(total / Math.max(6, Math.min(24, w || 6, h || 6)))));
          let prev = null;
          for (let i = 0; i <= samples; i++) {
            const pt = pathEl.getPointAtLength((total * i) / samples);
            if (
              (pt.x >= l && pt.x <= l + w && pt.y >= t && pt.y <= t + h) ||
              (prev && typeof bdSegmentIntersectsRect === 'function' && bdSegmentIntersectsRect(prev.x, prev.y, pt.x, pt.y, l, t, w, h))
            ) { rectConnIds.add(c.id); break; }
            prev = pt;
          }
        } catch (_) {}
      });
      let nextConnIds;
      if (selStart.additive) {
        const baseConn = selStart.baseSelConnIds || new Set();
        nextConnIds = new Set(baseConn);
        rectConnIds.forEach(id => {
          if (baseConn.has(id)) nextConnIds.delete(id);
          else nextConnIds.add(id);
        });
      } else {
        nextConnIds = rectConnIds;
      }
      const prevConnIds = (bd.selectedConnIds instanceof Set) ? [...bd.selectedConnIds] : [];
      if (typeof bdSetConnectionSelection === 'function') bdSetConnectionSelection([...nextConnIds]);
      if (typeof bdDrawConns === 'function') {
        const dirtyConnIds = [...new Set([...prevConnIds, ...nextConnIds])];
        if (dirtyConnIds.length) bdDrawConns({ connIds: dirtyConnIds, reason: 'rect-select' });
      }
      if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
      else if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(false);
    }
  }

  // --- pointerup on document (global) ---
  function onDocPointerup(e) {
    const wasTouchPinch = !!touchPinch;
    if (bdIsTouchPointer(e)) {
      touchPointers.delete(e.pointerId);
      if (wasTouchPinch) {
        if (touchPointers.size < 2) {
          touchPinch = null;
          canvas.classList.remove('bd-panning');
        }
        return;
      }
    }
    if (bd._lineToolDrag) {
      const start = bd._lineToolDrag;
      document.getElementById('bd-conn-preview')?.remove();
      const targetEl = boardNodeFromTarget(document.elementFromPoint(e.clientX, e.clientY));
      const dropW = typeof bdScreenToWorld === 'function'
        ? bdScreenToWorld(e.clientX, e.clientY)
        : { x: e.clientX, y: e.clientY };
      let created = null;
      if (targetEl) {
        const toId = targetEl.id.replace('bdn-','');
        if (start.nid) {
          if ((start.dragged || toId !== start.nid) && bdCanCreateConnection(start.nid, toId)) {
            bdPushUndo();
            created = bdCreateConnection(start.nid, toId);
          }
        } else if (start.fromPoint) {
          bdPushUndo();
          created = bdCreateConnection('', toId, { fromPoint: start.fromPoint });
        }
      } else if (start.dragged || start.nid) {
        bdPushUndo();
        if (start.nid) created = bdCreateConnection(start.nid, '', { toPoint: dropW });
        else created = bdCreateConnection('', '', { fromPoint: start.fromPoint, toPoint: dropW });
      }
      if (created) showStatus('ラインを追加しました');
      bd._lineToolDrag = null;
    }
    // Alt+左ドラッグ接続線の完了
    if (bd._rightDragNode) {
      const rd = bd._rightDragNode;
      document.getElementById('bd-conn-preview')?.remove();
      if (rd.dragged) {
        // ドロップ先ノードを検出してライン作成
        const targetEl = boardNodeFromTarget(document.elementFromPoint(e.clientX, e.clientY));
        if (targetEl) {
          const toId = targetEl.id.replace('bdn-','');
          if (bdCanCreateConnection(rd.nid, toId)) { bdPushUndo(); if (bdCreateConnection(rd.nid, toId)) showStatus('ラインを追加しました'); }
        } else {
          const dropW = typeof bdScreenToWorld === 'function'
            ? bdScreenToWorld(e.clientX, e.clientY)
            : { x: e.clientX, y: e.clientY };
          bdPushUndo();
          if (bdCreateConnection(rd.nid, '', { toPoint: dropW })) showStatus('ラインを追加しました');
        }
      }
      // ドラッグしなかった場合は何もしない (ノード選択は pointerdown 時に済んでいる)
      bd._rightDragNode = null;
    }
    if (erasing) {
      erasing = false;
      eraseUndoCaptured = false;
      erasedNodeIds = null;
      erasedConnRefs = null;
    }
    if (_cspZoom) { _cspZoom = false; canvas.classList.remove('bd-panning'); }
    if (_cspRotate) { _cspRotate = false; canvas.classList.remove('bd-panning'); }
    if (pan) {
      if (touchPanPointerId !== null && e.pointerId !== touchPanPointerId) return;
      const wasTouchCanvasPan = touchPanPointerId !== null;
      const touchMoved = e.type === 'pointercancel' || touchPanMoved || Math.abs(e.clientX - panSX) >= 6 || Math.abs(e.clientY - panSY) >= 6;
      pan=false; canvas.classList.remove('bd-panning');
      if (wasTouchCanvasPan) {
        try { canvas.releasePointerCapture?.(touchPanPointerId); } catch (_) {}
        if (!touchMoved && !bdIsAnnotationModeActive()) {
          bdSelect(null);
          if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
        }
        touchPanPointerId = null;
        touchPanMoved = false;
      }
      // 移動量が小さければ右クリックメニュー。nid があればノードメニュー、なければ空白メニュー
      if (bd._rightClickPos) {
        const dx=Math.abs(e.clientX-bd._rightClickPos.x), dy=Math.abs(e.clientY-bd._rightClickPos.y);
        // 注釈ツールバーオン時はボードの右クリックメニューを出さない (注釈描画の邪魔になるため)
        if (dx<15 && dy<15 && !bdIsAnnotationModeActive()) {
          const menuNid = bd._rightClickPos.nid;
          // ノード上で右クリックした場合、そのノードが未選択なら選択してからメニューを出す
          // (メニュー項目の多くは選択中カードを対象にするため)
          if (menuNid && typeof bdSelect === 'function' && !bd.selected.has(menuNid) && !bd._rightClickPos.e.shiftKey) {
            bdSelect(menuNid);
          }
          bdContextMenu(bd._rightClickPos.e, menuNid || null);
        }
        bd._rightClickPos=null;
      }
    }
    if (drag) {
      canvas.classList.remove('bd-node-dragging');
      // 2026-04-18: 自動整列がオンで、ドラッグ量が小さい場合に上下左右のカードへ吸着する。
      // bd.autoAlign は未定義時も true として扱う (defaultOn)。
      const autoAlignOn = typeof bd !== 'undefined' && bd.autoAlign !== false;
      const _draggedId = drag;
      const _draggedOffsets = dragOffsets;
      const dragIdsAtDrop = Object.keys(dragOffsets || {});
      const dragIdsForContainer = dragIdsAtDrop.filter(id => !_draggedOffsets?.[id]?.followOnly);
      const didDragMove = dragMoved || bdDragMovedBeyondClickThreshold(dragOffsets, e);
      if (!didDragMove) {
        document.querySelectorAll('.bd-node.bd-drop-target').forEach(el => el.classList.remove('bd-drop-target'));
        drag=null; dragOffsets=null; dragMoved=false; dragUndoCaptured=false; bd._dragExtracted=false;
        return;
      }
      ensureDragUndoCaptured();
      // ドロップターゲットがあればコンテナ内包を実行
      const dropTarget = didDragMove
        ? (bdFindNodeDropTargetAtPoint(e.clientX, e.clientY, dragIdsAtDrop)
          || document.querySelector('.bd-node.bd-drop-target'))
        : null;
      let containerized = false;
      if (dropTarget && dragOffsets) {
        const parentId = dropTarget.id.replace('bdn-','');
        const parentNode = bd.nodes.find(v => v.id === parentId);
        const dragIds = dragIdsForContainer.length ? dragIdsForContainer : dragIdsAtDrop;
        // 循環防止: ドロップ先がドラッグ中のノードの子孫でないこと
        const descendants = new Set();
        dragIds.forEach(id => bdDescendants(id).forEach(d => descendants.add(d)));
        if (parentNode && !dragIds.includes(parentId) && !descendants.has(parentId)) {
          // contained 連鎖を辿って絶対座標を算出するヘルパー
          // (parentNode や dragIds のノードが多段 contained の場合、相対座標のままでは差分が正しく取れない)
          const getAbs = (n) => {
            let ax = n.x, ay = n.y;
            let cur = n;
            while (cur.contained && cur.parent) {
              const p = bd.nodes.find(v => v.id === cur.parent);
              if (!p) break;
              ax += p.x; ay += p.y;
              cur = p;
            }
            return { x: ax, y: ay };
          };
          const parentAbs = getAbs(parentNode);
          // ドロップ先カードをコンテナ化し、ドラッグしたカードを contained として取り込む
          parentNode.container = true;
          dragIds.forEach(id => {
            const n = bd.nodes.find(v => v.id === id);
            if (!n) return;
            const nAbs = getAbs(n);
            // 新親 (parentNode) 相対座標に変換 (parentNode が contained でも絶対座標基準なので正しい)
            n.x = nAbs.x - parentAbs.x;
            n.y = nAbs.y - parentAbs.y;
            n.parent = parentId;
            n.contained = true;
          });
          bdRender();
          containerized = true;
          showStatus('コンテナに内包しました');
        }
        dropTarget.classList.remove('bd-drop-target');
      }
      document.querySelectorAll('.bd-node.bd-drop-target').forEach(el => el.classList.remove('bd-drop-target'));
      // 2026-04-18: 自動整列がオンで、ドラッグ量が小さい場合に上下左右のカードへ吸着する。
      // _dropTarget が処理された (コンテナ化) 時は吸着しない。
      if (autoAlignOn && _draggedId && _draggedOffsets && !containerized && !dropTarget
          && typeof _bdSnapNodeToNeighbors === 'function') {
        const o = _draggedOffsets[_draggedId];
        const n = bd.nodes.find(v => v.id === _draggedId);
        if (n && o) {
          const moveAbs = Math.abs(n.x - o.ox) + Math.abs(n.y - o.oy);
          const SMALL_DRAG_THRESHOLD = 40; // 40px 未満の小さなドラッグは吸着対象
          // 1px 以下 (= ほぼクリック) のときは吸着しない。微小なドラッグで勝手にカードが動くのを防ぐ。
          if (moveAbs > 1 && moveAbs < SMALL_DRAG_THRESHOLD) {
            // 選択中のカード全ての位置に snap delta を一括適用
            const delta = _bdSnapNodeToNeighbors(_draggedId, Object.keys(_draggedOffsets));
            if (delta && (delta.dx !== 0 || delta.dy !== 0)) {
              Object.keys(_draggedOffsets).forEach(id => {
                const nn = bd.nodes.find(v => v.id === id);
                if (nn && !nn.locked) { nn.x += delta.dx; nn.y += delta.dy; }
                const el = document.getElementById('bdn-' + id);
                if (el && nn && !nn.contained) { el.style.left = nn.x + 'px'; el.style.top = nn.y + 'px'; }
              });
              const snapIds = Object.keys(_draggedOffsets);
              bdDrawConns({ nodeIds: snapIds, reason: 'drag-snap' });
              snapIds.forEach(id => {
                if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
              });
              if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
            }
          }
        }
      }
      const movedIds = Object.keys(dragOffsets || {});
      if (didDragMove) bdSuppressNodeClickAfterDrag(movedIds);
      if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(movedIds, 'drag-end');
      if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(movedIds, 'drag-end');
      if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true }, 'drag-end');
      drag=null; dragOffsets=null; dragMoved=false; dragUndoCaptured=false; bd._dragExtracted=false; bdDirty();
    }
    if (resizing) {
      const _resizedId = resizing;
      const finishedResizeSelection = resizeSelection;
      resizing=null;
      resizeNode=null;
      resizeSelection=null;
      if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
      // 2026-04-18: 自動整列がオン && リサイズしたカードが構造ツリーに属するなら、
      // サイズ変化に合わせて周囲カードを再配置する (bdAutoLayout をルートに対して実行)。
      // contained カード (コンテナ内のカード) はワールド座標レイアウトと相性が悪いため対象外。
      if (typeof bd !== 'undefined' && bd.autoAlign !== false && _resizedId) {
        const _resizedNode = bd.nodes.find(v => v.id === _resizedId);
        if (_resizedNode && !_resizedNode.contained) {
          const rootId = (typeof _bdFindStructureRoot === 'function') ? _bdFindStructureRoot(_resizedId) : null;
          if (rootId && typeof bdAutoLayout === 'function') bdAutoLayout(rootId);
        }
      }
      if (finishedResizeSelection && typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(finishedResizeSelection.items.map(item => item.id), 'resize-end');
      if (finishedResizeSelection && typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true }, 'resize-end');
      bdDirty();
    }
    if (selRect) { selRect.remove(); selRect=null; selStart=null; }
    else if (selStart) { selStart=null; }
  }

  // --- contextmenu on canvas ---
  function onCanvasContextmenu(e) { e.preventDefault(); e.stopPropagation(); }

  // --- dblclick on canvas ---
  function onCanvasDblclick(e) {
    if (!bdEnsureInteractiveCanvas(canvas)) return;
    if (bdIsAnnotationModeActive()) return;
    // Space+ダブルクリック: 表示リセット（Shift併用で回転のみリセット）
    if (_spaceDown) {
      if (e.shiftKey) { bdResetRotation(); }
      else { bd.zoom = 1; bd.panX = 0; bd.panY = 0; bd.rotation = 0; bdTransform(); showStatus('表示をリセット'); }
      return;
    }
    const ne = e.target.closest('.bd-node');
    if (ne) {
      const nid = ne.id.replace('bdn-','');
      // リンク付きカードはリンク先を開く。Ctrl+ダブルクリックはテキスト編集。
      if (!e.ctrlKey && bdOpenNodeLink(nid)) return;
      bdEditNode(nid);
    }
    else { const wc=bdScreenToWorld(e.clientX,e.clientY); bdAddAt(wc.x,wc.y); }
  }

  // --- wheel on canvas ---
  function onCanvasWheel(e) {
    if (!bdEnsureInteractiveCanvas(canvas)) return; e.preventDefault();
    const local = (typeof bdClientToCanvasLocal === 'function')
      ? bdClientToCanvasLocal(e.clientX, e.clientY, canvas)
      : { x: e.clientX, y: e.clientY };
    const rotation = Number(bd.rotation) || 0;
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;
    let mx = local.x, my = local.y;
    if (rotation) {
      const rad = -rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = mx - centerX;
      const dy = my - centerY;
      mx = dx * cos - dy * sin + centerX;
      my = dx * sin + dy * cos + centerY;
    }
    const oz = bd.zoom;
    const anchorWorldX = (mx - bd.panX) / oz;
    const anchorWorldY = (my - bd.panY) / oz;
    // v0.5.319: ホイールズームを 10% 刻み (0.1 単位) にスナップ
    const step = 0.1;
    const dir = e.deltaY > 0 ? -1 : 1;
    let newZoom = Math.round(oz / step) * step + dir * step;
    newZoom = Math.round(newZoom / step) * step;  // 浮動小数点誤差の正規化
    newZoom = Math.max(0.1, Math.min(5, newZoom));
    bd.zoom = newZoom;
    bd.panX = mx - anchorWorldX * bd.zoom;
    bd.panY = my - anchorWorldY * bd.zoom;
    bdTransform();
  }

  // --- dragover on canvas ---
  function onCanvasDragover(e) {
    // パネル/タブ操作系の D&D はキャンバスではなくペイン側で処理させる
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.isPanelDnD(e.dataTransfer.types, e.ctrlKey)) return;
    if (bdIsInteractiveCanvas(canvas)) e.preventDefault();
  }

  function droppedExternalImageUrl(dataTransfer) {
    const uriList = String(dataTransfer?.getData?.('text/uri-list') || '')
      .split(/\r?\n/)
      .map(value => value.trim())
      .find(value => value && !value.startsWith('#'));
    let candidate = uriList || '';
    if (!candidate) {
      const html = String(dataTransfer?.getData?.('text/html') || '');
      if (html) {
        try {
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          candidate = parsed.querySelector('img[src]')?.getAttribute('src') || '';
        } catch {}
      }
    }
    if (!candidate) return '';
    try {
      const url = new URL(candidate, location.href);
      if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) return '';
      const host = url.hostname.toLowerCase();
      const privateHost = host === 'localhost' || host === '::1' || host === '0.0.0.0'
        || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
        || /^169\.254\./.test(host)
        || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
      return privateHost ? '' : url.href;
    } catch {
      return '';
    }
  }

  function blobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('画像を読み込めませんでした'));
      reader.readAsDataURL(blob);
    });
  }

  async function addExternalImageDrop(url, wx, wy) {
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
      if (!response.ok) throw new Error('画像を取得できませんでした');
      const blob = await response.blob();
      if (!String(blob.type || '').toLowerCase().startsWith('image/')) throw new Error('画像ではありません');
      if (blob.size > 25 * 1024 * 1024) throw new Error('画像が25MBを超えています');
      const dataUrl = await blobAsDataUrl(blob);
      const node = typeof bdCreateNodeWithStyle === 'function'
        ? bdCreateNodeWithStyle('', wx, wy, { img: dataUrl, w: 250, text: '' })
        : bdNode('', wx, wy, 250, 0, { img: dataUrl, text: '' });
      bdPushUndo();
      bd.nodes.push(node);
      if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(node)) {
        if (typeof bdRequestFullRender === 'function') bdRequestFullRender('drop-external-image');
        else bdRender();
      }
      bd.selected = new Set([node.id]);
      bd._activeNode = node.id;
      if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(node.id, 'drop-external-image');
      if (typeof bdMarkExtrasDirty === 'function') {
        bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [node.id] }, 'drop-external-image');
      }
      if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
      if (typeof bdApplySelectionDomClass === 'function') bdApplySelectionDomClass();
      if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(node.id);
      if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
      bdDirty();
      window.MeldexBoardImmersive?.updateEmptyGuide?.();
      if (typeof showStatus === 'function') showStatus('ブラウザから画像を追加しました');
    } catch {
      if (typeof showStatus === 'function') {
        showStatus('画像を保存してからドラッグ＆ドロップしてください', true);
      }
    }
  }

  // --- drop on canvas ---
  function onCanvasDrop(e) {
    // パネル/タブ操作系の D&D はキャンバスではなくペイン側で処理させる
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.isPanelDnD(e.dataTransfer.types, e.ctrlKey)) return;
    if (!bdEnsureInteractiveCanvas(canvas)) return;
    e.preventDefault(); e.stopPropagation();
    const {x: wx, y: wy} = bdScreenToWorld(e.clientX, e.clientY);

    // フォルダツリーからのドロップ
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    const meldexTextData = e.dataTransfer.getData('application/x-meldex-text');
    if ((cfData || meldexTextData) && window.MeldexBoardTransfer?.processTransfer) {
      window.MeldexBoardTransfer.processTransfer(e.dataTransfer, { x: wx, y: wy }, {})
        .catch(err => {
          console.error('[board] common transfer drop failed:', err);
          if (typeof showStatus === 'function') showStatus('ドロップ処理に失敗しました', true);
        });
      return;
    }
    if (cfData) {
      try {
        const parsed = JSON.parse(cfData);
        const items = Array.isArray(parsed?.items) && parsed.items.length
          ? parsed.items
          : [{ name: parsed?.name || '', path: parsed?.path || '', type: parsed?.type || '' }];
        const extIsImage = lowerPath => ['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.avif','.ico'].some(ext => lowerPath.endsWith(ext));
        const extIsVideo = lowerPath => ['.mp4','.m4v','.mov','.webm','.ogv','.avi','.mkv','.wmv','.mpg','.mpeg'].some(ext => lowerPath.endsWith(ext));
        const pendingNodes = [];
        const addedIds = [];
        items.forEach((item, index) => {
          const path = String(item?.path || '').trim();
          if (!path) return;
          const name = String(item?.name || path.split(/[/\\]/).pop() || path).trim() || path;
          const lower = path.toLowerCase();
          const isImage = item?.type === 'image' || extIsImage(lower);
          const isVideo = item?.type === 'video' || extIsVideo(lower);
          const imgUrl = isImage
            ? API_BASE + '/file-raw?path=' + encodeURIComponent(path)
            : (isVideo ? API_BASE + '/thumbnail?path=' + encodeURIComponent(path) + '&size=512' : '');
          const linkType = item?.type || (typeof _bdInferLinkType === 'function' ? _bdInferLinkType(path, '') : '');
          const offsetX = (index % 4) * 260;
          const offsetY = Math.floor(index / 4) * 220;
          const node = typeof bdCreateNodeWithStyle === 'function'
            ? bdCreateNodeWithStyle(name, wx + offsetX, wy + offsetY, { link: path, linkType, img: imgUrl, w: imgUrl ? 240 : 200 })
            : bdNode(name, wx + offsetX, wy + offsetY, imgUrl ? 240 : 200, 0, { link: path, linkType, img: imgUrl });
          pendingNodes.push(node);
        });
        if (pendingNodes.length) {
          bdPushUndo();
          pendingNodes.forEach(node => {
            bd.nodes.push(node);
            addedIds.push(node.id);
          });
        }
        if (addedIds.length) {
          const activeId = addedIds.length === 1 ? addedIds[0] : null;
          if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
          try {
            addedIds.forEach(id => {
              const node = bd.nodes.find(n => n.id === id);
              if (node && typeof bdAppendFastNode === 'function') bdAppendFastNode(node);
              if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(id, 'drop-cards');
            });
            if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: addedIds }, 'drop-cards');
          } finally {
            if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
          }
          bd.selected = new Set(addedIds);
          bd._activeNode = activeId;
          bdClearConnectionSelection();
          bdApplySelectionDomClass();
          addedIds.forEach(id => {
            if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
          });
          if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
          if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
          bdDirty();
          showStatus(addedIds.length > 1 ? `${addedIds.length}件のカードを追加しました` : 'カードを追加しました');
        }
      } catch(err) {
        console.error('[board] meldex-node drop failed:', err);
        if (typeof showStatus === 'function') showStatus('ドロップ処理に失敗: ' + (err?.message || err), true);
      }
      return;
    }

    // ノートからのテキストドロップ → テキストカード追加
    const meldexText = meldexTextData;
    if (meldexText) {
      try {
        const { text } = JSON.parse(meldexText);
        if (text) {
          bdPushUndo();
          const label = String(text);
          const node = typeof bdCreateNodeWithStyle === 'function'
            ? bdCreateNodeWithStyle(label, wx, wy, { w: 240 })
            : bdNode(label, wx, wy, 240, 0, {});
          bd.nodes.push(node);
          if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(node)) {
            if (typeof bdRequestFullRender === 'function') bdRequestFullRender('drop-text-fallback');
            else bdRender();
          }
          if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(node.id, 'drop-text');
          if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [node.id] }, 'drop-text');
          bd.selected = new Set([node.id]);
          bd._activeNode = node.id;
          bdClearConnectionSelection();
          bdApplySelectionDomClass();
          if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(node.id);
          else if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
          if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
          bdDirty();
          showStatus('テキストカードを追加しました');
        }
      } catch {}
      return;
    }

    // ファイルドロップ
    const files = e.dataTransfer.files;
    if (!files.length) {
      const externalImageUrl = droppedExternalImageUrl(e.dataTransfer);
      if (externalImageUrl) addExternalImageDrop(externalImageUrl, wx, wy);
      return;
    }
    const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const isImageFile = (file) => {
      const name = String(file?.name || '').toLowerCase();
      return String(file?.type || '').startsWith('image/')
        || /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(name);
    };
    const gridOffsetFor = (index, imageOnly) => {
      const cols = imageOnly ? 4 : 3;
      const gapX = imageOnly ? 280 : 220;
      const gapY = imageOnly ? 220 : 150;
      return { x: (index % cols) * gapX, y: Math.floor(index / cols) * gapY };
    };
    const boardDir = bd.path ? bd.path.substring(0, bd.path.lastIndexOf('/')) : '';
    const dropBoardPath = bd.path;
    const dropOpenSeq = Number(bd._openSeq) || 0;
    const imageDropMode = typeof bdGetImageDropMode === 'function' ? bdGetImageDropMode() : 'link';
    const dropStillTargetsCurrentBoard = () => (
      bd.path === dropBoardPath && (!dropOpenSeq || Number(bd._openSeq) === dropOpenSeq)
    );
    const cleanupAbandonedUploads = (items) => {
      const uploadedPaths = (items || []).map(item => item?.path).filter(Boolean);
      if (!uploadedPaths.length || typeof apiPost !== 'function') return;
      Promise.allSettled(uploadedPaths.map(path => apiPost('/outliner/delete', { path }, { silentError: true }))).catch(() => {});
    };
    const jobs = [];
    const droppedFiles = [...files];
    const imageOnlyDrop = droppedFiles.every(isImageFile);
    droppedFiles.forEach((f, index) => {
      const offset = gridOffsetFor(index, imageOnlyDrop);
      const isImage = isImageFile(f);
      jobs.push((async () => {
        try {
          const data = await readFileAsDataURL(f);
          if (!dropStillTargetsCurrentBoard()) return null;
          if (isImage && imageDropMode === 'embed') {
            // 過大な画像はダイアログでユーザーに埋め込み/リンクを選ばせる（既定は埋め込み）
            const choice = typeof bdResolveImageEmbedChoice === 'function'
              ? await bdResolveImageEmbedChoice(f.size, f.name)
              : 'embed';
            if (!dropStillTargetsCurrentBoard()) return null;
            if (choice === 'embed') {
              return { name: f.name, path: '', isImage, dataUrl: data, offset, embedded: true };
            }
          }
          try {
            const res = await apiFetch('/upload-file?path=' + encodeURIComponent(boardDir), {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              silentError: isImage && !bd.path,
              body: JSON.stringify({data, filename: f.name}),
            });
            if (res?.ok) return { name: f.name, path: res.path || '', isImage, dataUrl: '', offset };
          } catch (uploadErr) {
            if (!isImage) throw uploadErr;
          }
          if (isImage) return { name: f.name, path: '', isImage, dataUrl: data, offset, embedded: true, linkFallback: true };
          return null;
        } catch (err) {
          showStatus('ファイルの保存に失敗しました', true);
          return null;
        }
      })());
    });
    Promise.all(jobs).then(results => {
      if (!dropStillTargetsCurrentBoard()) {
        cleanupAbandonedUploads(results);
        if (typeof showStatus === 'function') showStatus('別のボードに切り替わったため、ファイルカードの追加を中止しました', true);
        return;
      }
      const nodes = results.filter(Boolean).map(item => {
        const x = wx + (item.offset?.x || 0);
        const y = wy + (item.offset?.y || 0);
        if (item.isImage && (item.path || item.dataUrl)) {
          const imgUrl = item.path ? API_BASE + '/file-raw?path=' + encodeURIComponent(item.path) : item.dataUrl;
          const linkType = item.path && typeof _bdInferLinkType === 'function' ? _bdInferLinkType(item.path, 'image') : 'image';
          const opts = { img: imgUrl, linkType, w: 250 };
          if (item.path) opts.link = item.path;
          if (item.path) opts.imageSourcePath = String(item.path).replace(/\\/g, '/');
          else opts.text = item.name || '';
          return typeof bdCreateNodeWithStyle === 'function'
            ? bdCreateNodeWithStyle(item.path ? '' : (item.name || ''), x, y, opts)
            : bdNode(item.path ? '' : (item.name || ''), x, y, 250, 0, opts);
        }
        const linkType = typeof _bdInferLinkType === 'function' ? _bdInferLinkType(item.path || '', '') : '';
        return typeof bdCreateNodeWithStyle === 'function'
          ? bdCreateNodeWithStyle(item.name, x, y, { link: item.path || '', linkType, w: 200 })
          : bdNode(item.name, x, y, 200, 0, { link: item.path || '', linkType });
      });
      if (!nodes.length) {
        return;
      }
      bdPushUndo();
      nodes.forEach(n => bd.nodes.push(n));
      const ids = nodes.map(n => n.id);
      const activeId = ids.length === 1 ? ids[0] : null;
      if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
      try {
        nodes.forEach(n => {
          if (typeof bdAppendFastNode === 'function') bdAppendFastNode(n);
          if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(n.id, 'drop-files');
        });
        if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: ids }, 'drop-files');
      } finally {
        if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
      }
      bd.selected = new Set(ids);
      bd._activeNode = activeId;
      if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
      if (typeof bdApplySelectionDomClass === 'function') bdApplySelectionDomClass();
      ids.forEach(id => {
        if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
      });
      if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
      if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
      bdDirty();
      if (typeof showStatus === 'function') {
        const addedImages = nodes.filter(node => node.img).length;
        const label = addedImages === nodes.length ? '画像' : 'ファイル';
        // サイズ確認ダイアログで一部だけリンクを選べるため、実際のノード内容から表示を決める
        // （imageDropMode は既定値であり、個々の選択結果とは限らない）
        const embeddedImages = nodes.filter(node => node.img && !node.link).length;
        const linkedImages = addedImages - embeddedImages;
        const modeLabel = !addedImages
          ? ''
          : (embeddedImages && linkedImages ? '（埋め込み/リンク混在）' : (linkedImages ? '（リンク）' : '（埋め込み）'));
        const hasFallback = results.filter(Boolean).some(item => item.linkFallback);
        const fallbackLabel = hasFallback ? '（リンク保存できなかった画像は埋め込み）' : modeLabel;
        showStatus(nodes.length > 1 ? `${nodes.length}件の${label}カードを追加しました${fallbackLabel}` : `${label}カードを追加しました${fallbackLabel}`);
      }
    });
  }

  // --- Space key tracking (CSP-compatible pan/zoom/rotate) ---
  const _rotateCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3C/svg%3E") 12 12, crosshair`;
  function _updateSpaceCursor(e) {
    if (!_spaceDown) return;
    canvas.style.cursor = e.ctrlKey ? 'zoom-in' : e.shiftKey ? _rotateCursor : 'grab';
  }
  function onKeydownSpace(e) {
    if (!bdIsInteractiveCanvas(canvas)) return;
    if (e.code === 'Space' && !e.repeat && !bd.editing) {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      _spaceDown = true;
      _updateSpaceCursor(e);
      // ノード・ラインのポインタイベントを無効化（カーソル変化防止）
      const world = document.getElementById('bd-world');
      if (world) world.style.pointerEvents = 'none';
      e.preventDefault();
    }
    // Space押下中にCtrl/Shiftが変わったらカーソル更新
    if (_spaceDown && (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
      _updateSpaceCursor(e);
    }
  }
  function onKeyupSpace(e) {
    if (e.code === 'Space') {
      _resetSpaceState();
    }
    // Space押下中にCtrl/Shiftを離したらカーソル更新
    if (_spaceDown && (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
      _updateSpaceCursor(e);
    }
  }

  // blur / visibilitychange で Space keyup を取りこぼしたときの復旧
  function _resetSpaceState() {
    _spaceDown = false;
    bd._spaceHeld = false;
    if (pan) pan = false;
    if (_cspZoom) _cspZoom = false;
    if (_cspRotate) _cspRotate = false;
    touchPanPointerId = null;
    touchPanMoved = false;
    touchPinch = null;
    touchPointers.clear();
    canvas.style.cursor = '';
    canvas.classList.remove('bd-panning');
    const world = document.getElementById('bd-world');
    if (world) world.style.pointerEvents = '';
  }
  function onWindowBlurSpace() { _resetSpaceState(); }
  function onVisibilityChangeSpace() {
    if (document.hidden) _resetSpaceState();
  }

  // --- Attach listeners ---
  canvas.addEventListener('pointerdown', onCanvasPointerdown);
  canvas.addEventListener('contextmenu', onCanvasContextmenu);
  canvas.addEventListener('dblclick', onCanvasDblclick);
  canvas.addEventListener('wheel', onCanvasWheel, {passive:false});
  canvas.addEventListener('dragover', onCanvasDragover);
  canvas.addEventListener('drop', onCanvasDrop);
  document.addEventListener('pointermove', onDocPointermove);
  document.addEventListener('pointerup', onDocPointerup);
  document.addEventListener('pointercancel', onDocPointerup);
  document.addEventListener('keydown', onKeydownSpace);
  document.addEventListener('keyup', onKeyupSpace);
  window.addEventListener('blur', onWindowBlurSpace);
  document.addEventListener('visibilitychange', onVisibilityChangeSpace);

  // --- Cleanup ---
  return function bdCleanupInteraction() {
    canvas.removeEventListener('pointerdown', onCanvasPointerdown);
    canvas.removeEventListener('contextmenu', onCanvasContextmenu);
    canvas.removeEventListener('dblclick', onCanvasDblclick);
    canvas.removeEventListener('wheel', onCanvasWheel);
    canvas.removeEventListener('dragover', onCanvasDragover);
    canvas.removeEventListener('drop', onCanvasDrop);
    document.removeEventListener('pointermove', onDocPointermove);
    document.removeEventListener('pointerup', onDocPointerup);
    document.removeEventListener('pointercancel', onDocPointerup);
    document.removeEventListener('keydown', onKeydownSpace);
    document.removeEventListener('keyup', onKeyupSpace);
    window.removeEventListener('blur', onWindowBlurSpace);
    document.removeEventListener('visibilitychange', onVisibilityChangeSpace);
    _resetSpaceState();
  };
}

// ============================================================
//  Keyboard Interaction
// ============================================================

/**
 * Direction-based nearest node search.
 */
function bdFindNearest(fromId, dir) {
  const fn = bd.nodes.find(n=>n.id===fromId); if (!fn) return null;
  const fe = document.getElementById('bdn-'+fromId);
  if (!fe || !fe.isConnected) return null;
  const fromPos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(fn) : { x: fn.x, y: fn.y };
  const fx = fromPos.x + (fe?fe.offsetWidth/2:80), fy = fromPos.y + (fe?fe.offsetHeight/2:20);
  let best = null, bestDist = Infinity;
  bd.nodes.forEach(n => {
    if (n.id===fromId) return;
    const ne = document.getElementById('bdn-'+n.id);
    if (!ne || !ne.isConnected) return;
    const pos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(n) : { x: n.x, y: n.y };
    const nx = pos.x + (ne?ne.offsetWidth/2:80), ny = pos.y + (ne?ne.offsetHeight/2:20);
    const dx = nx-fx, dy = ny-fy;
    // 方向フィルタ
    if (dir==='left' && dx>=0) return;
    if (dir==='right' && dx<=0) return;
    if (dir==='up' && dy>=0) return;
    if (dir==='down' && dy<=0) return;
    const dist = dx*dx + dy*dy;
    if (dist<bestDist) { bestDist=dist; best=n.id; }
  });
  return best;
}

/**
 * Set up keyboard event handlers for the canvas.
 * Call after the canvas DOM is ready.
 * @returns {Function} cleanup - removes all event listeners
 */
function bdInitKeyboard(root) {
  const canvas = root?.querySelector?.('[data-bd-role="canvas"]')
    || (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas', root) : null)
    || document.getElementById('bd-canvas');
  if (!canvas) return () => {};

  // Space押下状態トラッキング
  bd._spaceHeld = false;
  function onDocKeydown(e) { if (e.key===' ' && bdIsInteractiveCanvas(canvas) && !bd.editing) bd._spaceHeld=true; }
  function onDocKeyup(e) { if (e.key===' ') bd._spaceHeld=false; }

  // 離散ショートカット（Delete, Ctrl+A/D/S/C/X/Z/Y, F2, Enter, Tab等）
  // → gb-shortcuts.js の中央ハンドラに移行済み
  // 残存: 矢印キーナビゲーション、Space操作、編集モードキー
  function onCanvasKeydown(e) {
    if (!bdEnsureInteractiveCanvas(canvas)) return;
    if (bdIsAnnotationModeActive()) return;
    if (e.defaultPrevented) return;

    // --- 編集中 ---
    if (bd.editing) {
      // Enter (修飾キーなし) で編集確定。Shift+Enter は改行を許可するためデフォルト挙動を残す。
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey)) {
        bdFinishEdit();
        e.preventDefault();
      } else if (e.key === 'Tab' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        // Tab / Ctrl+Enter: 編集を確定して子カードを追加
        e.preventDefault();
        bdFinishEdit();
        setTimeout(() => {
          if (typeof bdAddChildToSelected === 'function') bdAddChildToSelected();
        }, 0);
      }
      return;
    }

    // --- 非編集 ---

    // Ctrl+F: 検索バー / Ctrl+H: 置換バー (モーダルダイアログではなく上書き表示)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const lk = (e.key || '').toLowerCase();
      if (lk === 'f' && typeof bdOpenFindBar === 'function') { e.preventDefault(); bdOpenFindBar('find'); return; }
      if (lk === 'h' && typeof bdOpenFindBar === 'function') { e.preventDefault(); bdOpenFindBar('replace'); return; }
    }

    if (e.key === 'Escape' && bd.tool && bd.tool !== 'select') {
      e.preventDefault();
      bdSetTool('select');
      return;
    }

    const arrow = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[e.key];

    if (arrow) {
      // Ctrl+矢印 (Shift / Alt 修飾なし): 中央ハンドラ (gb-shortcuts.js board.ctrlArrow*) に委譲する。
      // ここで preventDefault せず、なおかつ canvas-interact 側の処理もスキップする。
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        return;
      }

      e.preventDefault();

      // Space+矢印: ボード全体をパン
      if (bd._spaceHeld) {
        const panStep = 50;
        if (arrow==='left') bd.panX+=panStep;
        else if (arrow==='right') bd.panX-=panStep;
        else if (arrow==='up') bd.panY+=panStep;
        else if (arrow==='down') bd.panY-=panStep;
        bdTransform();
        return;
      }

      // Shift+矢印: 方向のノードを選択に追加
      if (e.shiftKey && !e.ctrlKey) {
        const active = bd._activeNode || (bd.selected.size===1 ? [...bd.selected][0] : null);
        if (!active) return;
        const next = bdFindNearest(active, arrow);
        if (next) {
          if (bd.selected.has(next)) bd.selected.delete(active);
          else bd.selected.add(next);
          bd._activeNode = next;
          bdApplySelectionDomClass();
          if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
        }
        return;
      }

      // 矢印のみ: アクティブノード移動
      const active = bd._activeNode || (bd.selected.size===1 ? [...bd.selected][0] : null);
      const next = bdFindNearest(active || (bd.nodes[0]?.id), arrow);
      if (next) { bdSelect(next); bd._activeNode = next; }
      return;
    }

    // Space: フォーカス/復元（矢印なし）
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) {
        if (bd.selected.size===1) bdFocusSelected();
        else if (_bdFocusSaved) { bd.zoom=_bdFocusSaved.zoom; bd.panX=_bdFocusSaved.panX; bd.panY=_bdFocusSaved.panY; _bdFocusSaved=null; bdTransform(); document.getElementById('bd-zoom-label').textContent=Math.round(bd.zoom*100)+'%'; }
      }
      return;
    }

    // Escape: スライドショー停止 + 選択解除
    if (e.key === 'Escape') {
      if(typeof _bdSlideshow !== 'undefined' && _bdSlideshow) bdStopSlideshow();
      bdSelect(null); bd.connecting=null; bd._connOrigin=null; bd._activeNode=null;
      e.preventDefault();
      return;
    }

    // --- 印字可能文字によるクイック編集開始 ---
    // 1枚選択中に a/s/あ など印字可能な1文字キーを押したら、そのカードの編集を開始して
    // 既存テキストの末尾にその文字を追記する。IME 変換中 (isComposing / keyCode 229) は対象外。
    if (
      bd.selected.size === 1
      && !e.ctrlKey && !e.metaKey && !e.altKey
      && !e.isComposing && e.keyCode !== 229
      && typeof e.key === 'string' && e.key.length === 1
    ) {
      const id = [...bd.selected][0];
      e.preventDefault();
      const typed = e.key;
      bdEditNode(id);
      setTimeout(() => {
        const el = document.getElementById('bdn-' + id);
        const txt = el?.querySelector('.bd-text');
        if (!txt) return;
        txt.innerText = (txt.innerText || '') + typed;
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(txt);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        if (typeof el._bdCaretUpdate === 'function') el._bdCaretUpdate();
      }, 0);
      return;
    }
  }

  // --- Attach listeners ---
  document.addEventListener('keydown', onDocKeydown);
  document.addEventListener('keyup', onDocKeyup);
  canvas.addEventListener('keydown', onCanvasKeydown);

  // --- Cleanup ---
  return function bdCleanupKeyboard() {
    document.removeEventListener('keydown', onDocKeydown);
    document.removeEventListener('keyup', onDocKeyup);
    canvas.removeEventListener('keydown', onCanvasKeydown);
  };
}

// ============================================================
//  Link helpers
// ============================================================

/**
 * Open a node's link with the appropriate opener. Returns true if the node had a link.
 */
function bdOpenNodeLink(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !n.link) return false;
  if (typeof _bdOpenLinkedTarget === 'function') _bdOpenLinkedTarget(n);
  return true;
}

/**
 * Handle click on an auto-detected link inside a node.
 */
function onAutoLinkClick(el, e) {
  const path = el.dataset?.path || el.getAttribute('href') || '';
  if (!path) return;
  if (path.replace(/\\/g, '/').includes('_chat/llm/') && path.includes('#')) {
    const hashIndex = path.indexOf('#');
    if (typeof openSavedChat === 'function') {
      openSavedChat(path.slice(0, hashIndex), path.slice(hashIndex + 1));
      return;
    }
  }
  const name = el.textContent?.trim() || path.split('/').pop();
  if (typeof openLink === 'function') openLink(path, name, { ctrlKey: e?.ctrlKey });
  else if (typeof openPage === 'function') openPage(name, path);
}
