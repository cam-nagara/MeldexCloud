/* gb-canvas-minimap.js: board preview minimap */
let _minimapRAF = 0;
// v0.5.318: ノード/接続線の描画を offscreen canvas にキャッシュし、パン/ズーム/回転時は
// ビューポート枠のみ再描画する。全ノード走査 (bdGetNodeStyle 呼び出しを含む) を毎フレーム避ける。
let _bdMinimapCacheOffscreen = null;
let _bdMinimapCacheKey = '';   // W x H x bounds ハッシュ
let _bdMinimapCacheDirty = true;

function bdInvalidateMinimapCache() { _bdMinimapCacheDirty = true; }

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
    w: node?._rw || node?.w || 160,
    h: node?._rh || node?.h || 40,
  };
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

function _bdDrawPreviewMinimap() {
  const pane = document.getElementById('gb-preview-pane');
  if (!pane || state.view !== 'board') return;
  if (!bd.nodes.length) {
    pane.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--fg2);font-size:13px;">カードがありません</div>';
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
    // クリック/ドラッグでパン
    let dragging = false;
    const panTo = (e) => {
      const r = canvas.getBoundingClientRect();
      const W = r.width, H = r.height;
      const bounds = _bdMinimapBounds();
      if (!bounds || bounds.w === 0 || bounds.h === 0) return;
      // 描画時と同じscale/offset（パネルにフィット、中心＝ボード全体の重心）
      const scale = _bdMinimapScale(W, H, bounds);
      const centerX = bounds.x0 + bounds.w / 2;
      const centerY = bounds.y0 + bounds.h / 2;
      const ox = W / 2 - centerX * scale;
      const oy = H / 2 - centerY * scale;
      const worldX = (e.clientX - r.left - ox) / scale;
      const worldY = (e.clientY - r.top - oy) / scale;
      const c = document.getElementById('bd-canvas');
      if (!c) return;
      const zoom = _bdSafeMinimapZoom();
      bd.panX = c.clientWidth / 2 - worldX * zoom;
      bd.panY = c.clientHeight / 2 - worldY * zoom;
      bdTransform();
    };
    canvas.addEventListener('pointerdown', (e) => { dragging = true; panTo(e); });
    canvas.addEventListener('pointermove', (e) => { if (dragging) panTo(e); });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('mouseleave', () => { dragging = false; });
  }
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
  const bounds = _bdMinimapBounds();
  if (!bounds || bounds.w === 0 || bounds.h === 0) return;
  const scale = _bdMinimapScale(W, H, bounds);
  const centerX = bounds.x0 + bounds.w / 2;
  const centerY = bounds.y0 + bounds.h / 2;
  const ox = W / 2 - centerX * scale;
  const oy = H / 2 - centerY * scale;

  // キャッシュキー: サイズ/bounds が変わったらキャッシュ無効化
  const cacheKey = `${pixelW}x${pixelH}|${bounds.x0.toFixed(1)},${bounds.y0.toFixed(1)},${bounds.w.toFixed(1)},${bounds.h.toFixed(1)}`;
  if (cacheKey !== _bdMinimapCacheKey) {
    _bdMinimapCacheKey = cacheKey;
    _bdMinimapCacheDirty = true;
  }

  if (_bdMinimapCacheDirty || !_bdMinimapCacheOffscreen) {
    _bdMinimapCacheOffscreen = _bdMinimapCacheOffscreen || document.createElement('canvas');
    _bdMinimapCacheOffscreen.width = pixelW;
    _bdMinimapCacheOffscreen.height = pixelH;
    const bgFallback = _cs.getPropertyValue('--bg2') || '#1e1e1e';
    _bdRenderMinimapCache(_bdMinimapCacheOffscreen, W, H, bounds, scale, ox, oy, accentColor, bgFallback);
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
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.fillStyle = _bdMinimapBackgroundColor(bgFallback);
  ctx.fillRect(0, 0, W, H);
  bd.nodes.forEach(n => {
    if (n.contained) return;
    const rect = _bdMinimapNodeRect(n);
    const x = rect.x * scale + ox;
    const y = rect.y * scale + oy;
    const statusDef = (n.status && typeof bdStatusDef === 'function') ? bdStatusDef(n.status) : null;
    ctx.fillStyle = _bdMinimapNodeFillColor(n, statusDef);
    ctx.globalAlpha = statusDef ? (statusDef.opacity ?? 1) : 1;
    ctx.fillRect(x, y, rect.w * scale, rect.h * scale);
    ctx.globalAlpha = 1;
  });
  bd.connections.forEach(c => {
    const fn = bd.nodes.find(n => n.id === c.from);
    const tn = bd.nodes.find(n => n.id === c.to);
    if (!fn || !tn) return;
    const fr = _bdMinimapNodeRect(fn);
    const tr = _bdMinimapNodeRect(tn);
    const style = (typeof bdGetConnectionStyle === 'function') ? bdGetConnectionStyle(c) : null;
    ctx.strokeStyle = c.color || style?.color || accentColor || '#888';
    ctx.lineWidth = Math.max(0.5, Math.min(2, (c.width || style?.width || 1) * 0.35));
    ctx.beginPath();
    ctx.moveTo((fr.x + fr.w / 2) * scale + ox, (fr.y + fr.h / 2) * scale + oy);
    ctx.lineTo((tr.x + tr.w / 2) * scale + ox, (tr.y + tr.h / 2) * scale + oy);
    ctx.stroke();
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
  bd.nodes.forEach(n => {
    if (n.contained) return; // 相対座標なので bounds に含めない
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + (n._rw || n.w || 160));
    y1 = Math.max(y1, n.y + (n._rh || 40));
  });
  if (!isFinite(x0)) return null;
  const pad = 50;
  return { x0: x0 - pad, y0: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}
