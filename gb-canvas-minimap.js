/* gb-canvas-minimap.js: board preview minimap */
let _minimapRAF = 0;
// v0.5.318: ノード/接続線の描画を offscreen canvas にキャッシュし、パン/ズーム/回転時は
// ビューポート枠のみ再描画する。全ノード走査 (bdGetNodeStyle 呼び出しを含む) を毎フレーム避ける。
let _bdMinimapCacheOffscreen = null;
let _bdMinimapCacheKey = '';   // W x H x bounds ハッシュ
let _bdMinimapCacheDirty = true;

function bdInvalidateMinimapCache() { _bdMinimapCacheDirty = true; }

function bdShouldRenderMinimapInPreviewPane(pane) {
  if (!pane || typeof state === 'undefined' || state.view !== 'board') return false;
  const mode = String(pane.dataset?.previewMode || '');
  return !mode || mode === 'board';
}

function bdUpdateMinimap() {
  if (_minimapRAF) return;
  const started = typeof bdPerfStart === 'function' ? bdPerfStart('bdUpdateMinimap') : 0;
  _minimapRAF = requestAnimationFrame(() => {
    _minimapRAF = 0;
    _bdDrawPreviewMinimap();
    if (typeof bdPerfEnd === 'function') bdPerfEnd('bdUpdateMinimap', started);
  });
}

function _bdSafeMinimapZoom() {
  const zoom = Number(bd.zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function _bdMinimapNodeRect(node) {
  const pos = (typeof bdNodeCanvasPosition === 'function') ? bdNodeCanvasPosition(node) : { x: Number(node?.x) || 0, y: Number(node?.y) || 0 };
  return {
    x: pos.x,
    y: pos.y,
    w: node?.w || node?._rw || 160,
    h: node?.h || node?._rh || 40,
  };
}

function _bdMinimapRenderContext() {
  return typeof bdCreateRenderContext === 'function' ? bdCreateRenderContext() : null;
}

function _bdMinimapNodeById(nodeId) {
  return (bd.nodes || []).find(node => node?.id === nodeId) || null;
}

function _bdMinimapIsNodeVisible(node, renderContext) {
  if (!node) return false;
  if (node.contained) {
    return typeof bdIsContainedNodeRenderable === 'function'
      ? bdIsContainedNodeRenderable(node, renderContext)
      : !(renderContext?.hiddenIds?.has(node.id));
  }
  if (typeof bdIsNodeRenderable === 'function') return bdIsNodeRenderable(node, renderContext);
  if (renderContext?.hiddenIds?.has(node.id)) return false;
  if (renderContext?.drillIds && !renderContext.drillIds.has(node.id)) return false;
  if (bd?.statusFilter && node.status !== bd.statusFilter) return false;
  return true;
}

function _bdMinimapConnectionEndpointPoint(conn, side, renderContext) {
  const nodeId = side === 'from' ? conn?.from : conn?.to;
  if (nodeId) {
    const node = _bdMinimapNodeById(nodeId);
    if (!_bdMinimapIsNodeVisible(node, renderContext)) return null;
    const rect = _bdMinimapNodeRect(node);
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  }
  const point = typeof bdNormalizeConnectionPoint === 'function'
    ? bdNormalizeConnectionPoint(side === 'from' ? conn?.fromPoint : conn?.toPoint)
    : null;
  return point ? { x: point.x, y: point.y } : null;
}

function _bdMinimapIsConnectionVisible(conn, renderContext) {
  if (!conn) return false;
  if (bd?.displayFilters?.showConnections === false) return false;
  return !!_bdMinimapConnectionEndpointPoint(conn, 'from', renderContext)
    && !!_bdMinimapConnectionEndpointPoint(conn, 'to', renderContext);
}

function _bdMinimapVisibilityCacheKey() {
  const drillRoot = (typeof _bdDrillRoot !== 'undefined' && _bdDrillRoot) ? _bdDrillRoot : '';
  const normPoint = point => {
    const normalized = typeof bdNormalizeConnectionPoint === 'function' ? bdNormalizeConnectionPoint(point) : null;
    return normalized ? `${normalized.x},${normalized.y}` : '';
  };
  const nodeKey = (bd.nodes || []).map(node => [
    node?.id, node?.x, node?.y, node?.w, node?.h, node?._rw, node?._rh,
    node?.status, node?.collapsed, node?.contained, node?.parent, node?.cardStyle, node?.bgColor,
  ].join(':')).join('|');
  const connKey = (bd.connections || []).map(conn => [
    conn?.id, conn?.from, conn?.to, normPoint(conn?.fromPoint),
    normPoint(conn?.toPoint), conn?.hidden, conn?.color, conn?.width, conn?.styleRef,
  ].join(':')).join('|');
  return `${bd?.statusFilter || ''}|${drillRoot}|${JSON.stringify(bd?.displayFilters || {})}|${nodeKey}|${connKey}`;
}

function _bdMinimapNodeFillColor(node, statusDef) {
  const eff = (typeof bdGetNodeStyle === 'function') ? bdGetNodeStyle(node) : null;
  if (eff?.bgColor) return eff.bgColor;
  if (node?.bgColor) return node.bgColor;
  if (statusDef?.color) return statusDef.color;
  return '#555';
}

function _bdMinimapBackgroundColor(bgFallback) {
  const cv = document.getElementById('bd-canvas');
  if (cv) {
    const cs = getComputedStyle(cv);
    const bg = cs.backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
    if (bd && bd._bgColor) return bd._bgColor;
  }
  return bgFallback;
}

function _bdMinimapViewportWorldPoints(canvasEl, zoom) {
  const cw = canvasEl.clientWidth;
  const ch = canvasEl.clientHeight;
  const cx = cw / 2;
  const cy = ch / 2;
  const rotation = Number(bd.rotation) || 0;
  const rad = -rotation * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(([sx, sy]) => {
    let lx = sx;
    let ly = sy;
    if (rotation) {
      lx -= cx;
      ly -= cy;
      const rx = lx * cos - ly * sin;
      const ry = lx * sin + ly * cos;
      lx = rx + cx;
      ly = ry + cy;
    }
    return { x: (lx - bd.panX) / zoom, y: (ly - bd.panY) / zoom };
  });
}

function _bdDrawMinimapViewport(ctx, canvasEl, scale, ox, oy, accentColor, zoom) {
  const points = _bdMinimapViewportWorldPoints(canvasEl, zoom);
  if (!points.length) return;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = point.x * scale + ox;
    const y = point.y * scale + oy;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
}

function _bdBindPreviewMinimapInteraction(canvas) {
  // ペインのsnapshotはcanvas要素をcloneするがイベントリスナーは複製しない。
  // DOM属性ではなくexpandoで実要素ごとの接続状態を判定し、clone側にも再接続する。
  if (!canvas || canvas._bdMinimapInteractionBound) return;
  canvas._bdMinimapInteractionBound = true;
  let dragging = false;
  const panTo = (event) => {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const bounds = _bdMinimapBounds();
    if (!bounds || bounds.w === 0 || bounds.h === 0) return;
    const scale = _bdMinimapScale(width, height, bounds);
    const centerX = bounds.x0 + bounds.w / 2;
    const centerY = bounds.y0 + bounds.h / 2;
    const offsetX = width / 2 - centerX * scale;
    const offsetY = height / 2 - centerY * scale;
    const worldX = (event.clientX - rect.left - offsetX) / scale;
    const worldY = (event.clientY - rect.top - offsetY) / scale;
    const boardCanvas = document.getElementById('bd-canvas');
    if (!boardCanvas) return;
    const zoom = _bdSafeMinimapZoom();
    bd.panX = boardCanvas.clientWidth / 2 - worldX * zoom;
    bd.panY = boardCanvas.clientHeight / 2 - worldY * zoom;
    bdTransform();
  };
  canvas.addEventListener('pointerdown', event => { dragging = true; panTo(event); });
  canvas.addEventListener('pointermove', event => { if (dragging) panTo(event); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('mouseleave', () => { dragging = false; });
  // legacy snapshotは実ペインへ切り替えた後にclickを再送するため、click単独でも
  // パンできる契約を持たせる。ライブ面ではpointerdownと同じ地点なので冪等。
  canvas.addEventListener('click', panTo);
}

function _bdDrawPreviewMinimap() {
  const pane = document.getElementById('gb-preview-pane');
  if (!bdShouldRenderMinimapInPreviewPane(pane)) return;
  if (!bd.nodes.length) {
    pane.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--fg2);font-size:13px;">トピックがありません</div>';
    return;
  }
  let canvas = pane.querySelector('.bd-minimap');
  if (!canvas) {
    pane.innerHTML = '';
    canvas = document.createElement('canvas');
    canvas.className = 'bd-minimap';
    canvas.style.cssText = 'width:100%;height:100%;cursor:crosshair;';
    pane.appendChild(canvas);
    // パネルサイズ変化に追従（フィット倍率がパネルサイズに依存するため必須）
    if (typeof ResizeObserver === 'function' && !pane._bdMinimapRO) {
      pane._bdMinimapRO = new ResizeObserver(() => {
        if (state.view === 'board') bdUpdateMinimap();
      });
      pane._bdMinimapRO.observe(pane);
    }
  }
  _bdBindPreviewMinimapInteraction(canvas);
  const rect = pane.getBoundingClientRect();
  const pixelW = Math.max(1, Math.round(rect.width * devicePixelRatio));
  const pixelH = Math.max(1, Math.round(rect.height * devicePixelRatio));
  canvas.width = pixelW;
  canvas.height = pixelH;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const W = rect.width, H = rect.height;
  const _cs = getComputedStyle(document.documentElement);
  const accentColor = _cs.getPropertyValue('--accent') || '#569cd6';
  const bgFallback = _cs.getPropertyValue('--bg2') || '#1e1e1e';
  const bgColor = _bdMinimapBackgroundColor(bgFallback);
  const bounds = _bdMinimapBounds();
  if (!bounds || bounds.w === 0 || bounds.h === 0) return;
  const scale = _bdMinimapScale(W, H, bounds);
  const centerX = bounds.x0 + bounds.w / 2;
  const centerY = bounds.y0 + bounds.h / 2;
  const ox = W / 2 - centerX * scale;
  const oy = H / 2 - centerY * scale;

  // キャッシュキー: サイズ/bounds が変わったらキャッシュ無効化
  const cacheKey = `${pixelW}x${pixelH}|${bounds.x0.toFixed(1)},${bounds.y0.toFixed(1)},${bounds.w.toFixed(1)},${bounds.h.toFixed(1)}|${bgColor}|${_bdMinimapVisibilityCacheKey()}`;
  if (cacheKey !== _bdMinimapCacheKey) {
    _bdMinimapCacheKey = cacheKey;
    _bdMinimapCacheDirty = true;
  }

  if (_bdMinimapCacheDirty || !_bdMinimapCacheOffscreen) {
    _bdMinimapCacheOffscreen = _bdMinimapCacheOffscreen || document.createElement('canvas');
    _bdMinimapCacheOffscreen.width = pixelW;
    _bdMinimapCacheOffscreen.height = pixelH;
    _bdRenderMinimapCache(_bdMinimapCacheOffscreen, W, H, bounds, scale, ox, oy, accentColor, bgColor);
    _bdMinimapCacheDirty = false;
  }

  // 合成: ノード/接続線キャッシュを転写 → ビューポート枠を重ねる
  ctx.drawImage(_bdMinimapCacheOffscreen, 0, 0, pixelW, pixelH, 0, 0, W, H);
  const cv = document.getElementById('bd-canvas');
  if (cv) {
    _bdDrawMinimapViewport(ctx, cv, scale, ox, oy, accentColor, _bdSafeMinimapZoom());
  }
}

// ノード/接続線の静的レイヤをオフスクリーンへ描画 (bd.nodes 変化時のみ呼ばれる)
function _bdRenderMinimapCache(offscreen, W, H, bounds, scale, ox, oy, accentColor, bgFallback) {
  const ctx = offscreen.getContext('2d');
  const renderContext = _bdMinimapRenderContext();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.fillStyle = bgFallback;
  ctx.fillRect(0, 0, W, H);
  bd.nodes.forEach(n => {
    if (n.contained || !_bdMinimapIsNodeVisible(n, renderContext)) return;
    const rect = _bdMinimapNodeRect(n);
    const x = rect.x * scale + ox;
    const y = rect.y * scale + oy;
    const statusDef = (n.status && typeof bdStatusDef === 'function') ? bdStatusDef(n.status) : null;
    const nodeStyle = (typeof bdGetNodeStyle === 'function') ? bdGetNodeStyle(n) : null;
    ctx.fillStyle = _bdMinimapNodeFillColor(n, statusDef);
    ctx.globalAlpha = (statusDef ? (statusDef.opacity ?? 1) : 1) * _bdNormalizeStyleOpacity(nodeStyle?.bgOpacity, 1);
    ctx.fillRect(x, y, rect.w * scale, rect.h * scale);
    ctx.globalAlpha = 1;
  });
  bd.connections.forEach(c => {
    if (!_bdMinimapIsConnectionVisible(c, renderContext)) return;
    const fromPoint = _bdMinimapConnectionEndpointPoint(c, 'from', renderContext);
    const toPoint = _bdMinimapConnectionEndpointPoint(c, 'to', renderContext);
    if (!fromPoint || !toPoint) return;
    const style = (typeof bdGetConnectionStyle === 'function') ? bdGetConnectionStyle(c) : null;
    ctx.strokeStyle = c.color || style?.color || accentColor || '#888';
    ctx.lineWidth = Math.max(0.5, Math.min(2, (c.width || style?.width || 1) * 0.35));
    ctx.globalAlpha = (c.hidden ? 0.18 : 1) * _bdNormalizeStyleOpacity(style?.colorOpacity, 1);
    if (c.hidden) ctx.setLineDash([3, 5]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(fromPoint.x * scale + ox, fromPoint.y * scale + oy);
    ctx.lineTo(toPoint.x * scale + ox, toPoint.y * scale + oy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  });
}

// ミニマップはパネルにフィット（アスペクト比維持）。わずかな余白を残す。
function _bdMinimapScale(paneW, paneH, bounds) {
  const b = bounds || _bdMinimapBounds();
  if (!b || !(b.w > 0) || !(b.h > 0)) return 0.12;
  if (!(paneW > 0) || !(paneH > 0)) return 0.12;
  const margin = 0.92; // パネル端のクリッピングを避けるための余白係数
  return Math.min(paneW / b.w, paneH / b.h) * margin;
}
function _bdMinimapBounds() {
  if (!bd.nodes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const renderContext = _bdMinimapRenderContext();
  const includePoint = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  bd.nodes.forEach(n => {
    if (n.contained || !_bdMinimapIsNodeVisible(n, renderContext)) return;
    const rect = _bdMinimapNodeRect(n);
    includePoint(rect.x, rect.y);
    includePoint(rect.x + rect.w, rect.y + rect.h);
  });
  bd.connections.forEach(conn => {
    if (!_bdMinimapIsConnectionVisible(conn, renderContext)) return;
    const fromPoint = _bdMinimapConnectionEndpointPoint(conn, 'from', renderContext);
    const toPoint = _bdMinimapConnectionEndpointPoint(conn, 'to', renderContext);
    if (fromPoint) includePoint(fromPoint.x, fromPoint.y);
    if (toPoint) includePoint(toPoint.x, toPoint.y);
  });
  if (!isFinite(x0)) return null;
  const pad = 50;
  return { x0: x0 - pad, y0: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}
