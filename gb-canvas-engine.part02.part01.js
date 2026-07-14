/* gb-canvas-engine.part02.js */

// --- フレーム描画 ---
function bdDrawFrames() {
  document.querySelectorAll('.bd-frame').forEach(f=>f.remove());
  const container = document.getElementById('bd-nodes');
  if (!bd.groups || !container) return;
  bd.groups.forEach(g => {
    const gNodes = g.nodeIds.map(id=>bd.nodes.find(n=>n.id===id)).filter(Boolean).filter(n => !n.contained);
    if (gNodes.length < 2) return;
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    gNodes.forEach(n => {
      const el=document.getElementById('bdn-'+n.id);
      x0=Math.min(x0,n.x); y0=Math.min(y0,n.y);
      x1=Math.max(x1,n.x+(el?el.offsetWidth:160)); y1=Math.max(y1,n.y+(el?el.offsetHeight:36));
    });
    const frame = document.createElement('div'); frame.className = 'bd-frame';
    frame.style.cssText = `left:${x0-12}px;top:${y0-22}px;width:${x1-x0+24}px;height:${y1-y0+34}px;`;
    const label = document.createElement('div'); label.className = 'bd-frame-label'; label.textContent = g.name;
    label.style.cursor = 'move';
    label.ondblclick = (ev) => {
      ev.stopPropagation();
      label.contentEditable = 'true'; label.focus();
      label.style.cursor = 'text';
      const s=window.getSelection(), r=document.createRange(); r.selectNodeContents(label); s.removeAllRanges(); s.addRange(r);
      const originalName = String(g.name || '');
      const finish = () => {
        if (label.contentEditable !== 'true') return;
        label.contentEditable='false'; label.style.cursor = 'move';
        const nextName = label.textContent.replace(/\s+/g, ' ').trim();
        if (!nextName) { label.textContent = originalName; return; }
        if (nextName === originalName) { label.textContent = originalName; return; }
        if (typeof bdPushUndo === 'function') bdPushUndo();
        g.name = nextName;
        label.textContent = g.name;
        bdDirty();
      };
      label.onblur = finish;
      label.onkeydown = (ke) => { if(ke.key==='Enter'){ke.preventDefault();label.blur();} if(ke.key==='Escape'){label.textContent=g.name;label.blur();} ke.stopPropagation(); };
    };
    // グループのドラッグ移動 (ユーザー要望)。label の pointerdown でドラッグ開始、
    // document の pointermove/up を使って group.nodeIds 内の全カードを移動する。
    // PDRAG_THRESHOLD を超えたら「ドラッグ」と判定し、それ未満のクリックは通常のクリック扱い。
    label.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      if (label.contentEditable === 'true') return; // ラベル編集中はドラッグしない
      ev.preventDefault(); ev.stopPropagation();
      const startX = ev.clientX, startY = ev.clientY;
      const zoom = Math.max(0.1, bd.zoom || 1);
      // 対象ノード (contained 以外のグループメンバー) の元座標を保存
      const targets = (g.nodeIds || [])
        .map(id => bd.nodes.find(n => n.id === id))
        .filter(Boolean)
        .filter(n => !n.contained && !n.locked);
      const startPositions = targets.map(n => ({ node: n, x: n.x, y: n.y }));
      let dragged = false;
      const THRESHOLD = 4;
      const onMove = (mv) => {
        const dx = (mv.clientX - startX) / zoom;
        const dy = (mv.clientY - startY) / zoom;
        if (!dragged) {
          if (Math.abs(mv.clientX - startX) + Math.abs(mv.clientY - startY) < THRESHOLD) return;
          dragged = true;
          bdPushUndo();
        }
        startPositions.forEach(p => {
          p.node.x = p.x + dx;
          p.node.y = p.y + dy;
          const el = document.getElementById('bdn-' + p.node.id);
          if (el) {
            el.style.left = p.node.x + 'px';
            el.style.top = p.node.y + 'px';
          }
        });
        const movedIds = startPositions.map(p => p.node.id);
        if (typeof bdDrawConns === 'function') bdDrawConns({ nodeIds: movedIds, reason: 'frame-drag' });
        movedIds.forEach(id => {
          if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
        });
        if (typeof bdDrawFrames === 'function') bdDrawFrames();
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (dragged) {
          const movedIds = startPositions.map(p => p.node.id);
          if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(movedIds, 'frame-drag-end');
          if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true }, 'frame-drag-end');
          bdDirty();
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
    frame.appendChild(label);
    container.appendChild(frame);
  });
}

// --- ライン描画 ---
let _bdConnActionBtnHideTimer = 0;

function _showConnActionBtn(conn, anchorPoint) {
  clearTimeout(_bdConnActionBtnHideTimer);
  _removeConnActionBtn();
  const container = document.getElementById('bd-nodes');
  if (!container || !anchorPoint) return;
  const btn = document.createElement('button');
  btn.id = 'bd-conn-action-btn';
  btn.type = 'button';
  btn.className = 'bd-conn-action-btn';
  btn.textContent = '...';
  btn.title = 'ラインメニュー';
  btn.setAttribute('aria-label', 'ラインメニュー');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.style.left = anchorPoint.x + 'px';
  btn.style.top = anchorPoint.y + 'px';
  btn.addEventListener('pointerenter', () => clearTimeout(_bdConnActionBtnHideTimer));
  btn.addEventListener('pointerleave', (e) => {
    if (e.relatedTarget && btn.contains(e.relatedTarget)) return;
    _bdConnActionBtnHideTimer = setTimeout(_removeConnActionBtn, 80);
  });
  // pointerdown 時点でメニューを開く。click まで待つとラベル無しのラインで
  // 不安定（hit stroke と button の境界でイベントが競合するケース）だったので、
  // pointerdown で確定させる。バブルも止めてキャンバスの bdSelect(null) を防ぐ。
  const openMenu = (e) => {
    clearTimeout(_bdConnActionBtnHideTimer);
    e.preventDefault();
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    bdConnContextMenu({
      clientX: rect.left + rect.width / 2,
      clientY: rect.bottom,
      trigger: btn,
      preventDefault() {},
      stopPropagation() {},
    }, conn);
  };
  btn.addEventListener('pointerdown', (e) => {
    // 左ボタン以外は無視し、その他は pointerdown でメニューを開く
    if (e.button !== undefined && e.button !== 0) { e.stopPropagation(); return; }
    openMenu(e);
  });
  btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  btn.addEventListener('pointerup', (e) => { e.stopPropagation(); });
  btn.addEventListener('mouseup', (e) => { e.stopPropagation(); });
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  container.appendChild(btn);
}
function _removeConnActionBtn() {
  clearTimeout(_bdConnActionBtnHideTimer);
  document.getElementById('bd-conn-action-btn')?.remove();
}

function _bdLinePathType(connStyle, structure) {
  // マインドマップ構造ではライン形状を「直線」に強制する (色 / 太さ / 矢印 / 破線などの
  // その他のスタイル設定はユーザー指定通り維持する)。
  if (structure === 'mindmap') return 'straight';
  // v0.5.320: pathType は 3 種（curve / straight / orthogonal）に統合。旧 free-bezier / orthogonal-curve は
  // ロード時 _bdMigrateConnectionSchema で自動変換されるが、実行中にも防御的に解決する。
  if (connStyle?.pathType === 'free-bezier') return 'curve';
  if (connStyle?.pathType === 'curve') return 'curve';
  if (connStyle?.pathType === 'orthogonal' || connStyle?.pathType === 'orthogonal-curve') return 'orthogonal';
  if (connStyle?.pathType === 'straight' || connStyle?.straight) return 'straight';
  return 'curve';
}

// 旧 pathType を新体系 (curve / straight / orthogonal) に変換する。
// - free-bezier → curve (controlPoints があれば手動モード、なければ自動モード)
// - orthogonal-curve → orthogonal + cornerRadius: 12
// - straight: true → pathType: 'straight'
// 引数は conn / lineStyle / depthStyle.line いずれも同じ構造なので共通化。
// 冪等: 既に新形式のデータを渡しても破壊しない。
function _bdMigrateConnectionSchema(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.pathType === 'free-bezier') {
    obj.pathType = 'curve';
  } else if (obj.pathType === 'orthogonal-curve') {
    obj.pathType = 'orthogonal';
    if (!Number.isFinite(+obj.cornerRadius)) obj.cornerRadius = 12;
  } else if (obj.pathType === 'straight' || (!obj.pathType && obj.straight === true)) {
    obj.pathType = 'straight';
  }
  if (obj.pathType === 'curve' || obj.pathType === 'orthogonal') delete obj.straight;
  if (obj.pathType === 'straight') delete obj.straight;
  return obj;
}

// 端点接続アンカー名。
// BD_ANCHOR_NAMES: ユーザーが手動で設定できる辺中央 4 点。選択時の候補点表示・
//   端点ドロップ時の最近接スナップはこの 4 点に限定する。
// BD_ANCHOR_NAMES_ALL: _bdGetAnchorPointByShape / _bdAnchorOutwardVector で扱える全 8 点。
//   ライン経路の自動ルーティング (_bdAutoAnchorByVector) が斜め方向を使う場合に採用され、
//   矢印の向きも 8 方向対応になる。既存データの四隅アンカーもここで後方互換として受理する。
const BD_ANCHOR_NAMES = [
  'top-center', 'left-center', 'right-center', 'bottom-center',
];
const BD_ANCHOR_NAMES_ALL = [
  'top-left', 'top-center', 'top-right',
  'left-center', 'right-center',
  'bottom-left', 'bottom-center', 'bottom-right',
];

// アンカー HUD の短縮名 (top/bottom/left/right/tl/tr/bl/br) を内部アンカー名 (BD_ANCHOR_NAMES) に変換。
// カードHUD (gb-canvas-engine.part01.js) のクラス名とライン端点 (conn.fromAnchor/toAnchor) の
// 命名規約を橋渡しする。未定義の場合は空文字。
function _bdHudPosToAnchorName(pos) {
  return ({
    top: 'top-center',
    bottom: 'bottom-center',
    left: 'left-center',
    right: 'right-center',
    tl: 'top-left',
    tr: 'top-right',
    bl: 'bottom-left',
    br: 'bottom-right',
  })[pos] || '';
}
const BD_ELLIPSE_SHAPES = new Set(['ellipse', 'cloud', 'fluffy', 'thorn', 'thorn-curve']);

// カード形状・位置・サイズから指定アンカーの座標 (キャンバス座標系) を返す。
// 楕円ベース系は内接楕円の周上8点 (45°刻み) を使う。
// それ以外は bounding box の角・辺中点。
function _bdGetAnchorPointByShape(shape, x, y, w, h, anchorName) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (BD_ELLIPSE_SHAPES.has(shape)) {
    const rx = w / 2;
    const ry = h / 2;
    const INV_SQRT2 = 1 / Math.SQRT2;
    switch (anchorName) {
      case 'top-center':    return { x: cx, y: cy - ry };
      case 'top-right':     return { x: cx + rx * INV_SQRT2, y: cy - ry * INV_SQRT2 };
      case 'right-center':  return { x: cx + rx, y: cy };
      case 'bottom-right':  return { x: cx + rx * INV_SQRT2, y: cy + ry * INV_SQRT2 };
      case 'bottom-center': return { x: cx, y: cy + ry };
      case 'bottom-left':   return { x: cx - rx * INV_SQRT2, y: cy + ry * INV_SQRT2 };
      case 'left-center':   return { x: cx - rx, y: cy };
      case 'top-left':      return { x: cx - rx * INV_SQRT2, y: cy - ry * INV_SQRT2 };
      default:              return { x: cx, y: cy };
    }
  }
  // 矩形系 / 多角形系: bounding box の8点
  switch (anchorName) {
    case 'top-left':      return { x, y };
    case 'top-center':    return { x: cx, y };
    case 'top-right':     return { x: x + w, y };
    case 'left-center':   return { x, y: cy };
    case 'right-center':  return { x: x + w, y: cy };
    case 'bottom-left':   return { x, y: y + h };
    case 'bottom-center': return { x: cx, y: y + h };
    case 'bottom-right':  return { x: x + w, y: y + h };
    default:              return { x: cx, y: cy };
  }
}

// ノードオブジェクト + カードDOMから指定アンカー座標を取得するヘルパー。
// data-shape 属性を優先、なければノードの shape プロパティを使う。
function _bdGetCardAnchorPoint(cardNode, cardEl, pos, anchorName) {
  const w = cardEl?.offsetWidth ?? cardNode?.w ?? 160;
  const h = cardEl?.offsetHeight ?? cardNode?.h ?? 60;
  const shape = cardEl?.dataset?.shape || cardNode?.shape || '';
  return _bdGetAnchorPointByShape(shape, pos.x, pos.y, w, h, anchorName);
}

// conn から from/to のアンカー名を取得。ネスト形式 / 別プロパティの両方に対応。
// - 新形式: conn.fromAnchor / conn.toAnchor (string)
// - 未指定時: null を返して呼び出し側で自動算出にフォールバック
function _bdConnAnchorName(conn, side) {
  if (!conn) return null;
  const key = side === 'from' ? 'fromAnchor' : 'toAnchor';
  const v = conn[key];
  // 後方互換: 旧データ ('top-left' 等) も受理する。
  return (typeof v === 'string' && BD_ANCHOR_NAMES_ALL.includes(v)) ? v : null;
}

// controlPoints を取得 / 未指定時は自動初期化。
// v0.5.330: 保存値 > 外向きベクトル (連続角度対応) > 旧軸優勢 の順で決定する。
// fromOut / toOut は {x, y} 単位ベクトル (アンカー名 or 自動ルート結果から呼び出し側で解決)。
// 相対オフセット (dx, dy) を始点/終点アンカー基準で保持する。
function _bdResolveControlPoints(conn, start, end, fromOut, toOut) {
  const raw = conn?.controlPoints;
  const normalizedRaw = typeof bdNormalizeConnectionControlPoints === 'function'
    ? bdNormalizeConnectionControlPoints(raw)
    : null;
  if (normalizedRaw) return normalizedRaw;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy) || 1;
  const handleLen = Math.max(40, dist / 3);
  const hasFrom = fromOut && Number.isFinite(fromOut.x) && Number.isFinite(fromOut.y)
    && (fromOut.x !== 0 || fromOut.y !== 0);
  const hasTo = toOut && Number.isFinite(toOut.x) && Number.isFinite(toOut.y)
    && (toOut.x !== 0 || toOut.y !== 0);
  if (hasFrom && hasTo) {
    return [
      { dx: fromOut.x * handleLen, dy: fromOut.y * handleLen },
      { dx: toOut.x * handleLen, dy: toOut.y * handleLen },
    ];
  }
  if (hasFrom) {
    return [
      { dx: fromOut.x * handleLen, dy: fromOut.y * handleLen },
      { dx: -(dx) / dist * handleLen, dy: -(dy) / dist * handleLen },
    ];
  }
  if (hasTo) {
    return [
      { dx: dx / dist * handleLen, dy: dy / dist * handleLen },
      { dx: toOut.x * handleLen, dy: toOut.y * handleLen },
    ];
  }
  // 従来: 優勢軸に沿ってハンドルを配置 (ベクトル情報なしのフォールバック)
  if (Math.abs(dy) > Math.abs(dx)) {
    const sign = dy >= 0 ? 1 : -1;
    return [
      { dx: 0, dy: sign * handleLen },
      { dx: 0, dy: -sign * handleLen },
    ];
  }
  const sign = dx >= 0 ? 1 : -1;
  return [
    { dx: sign * handleLen, dy: 0 },
    { dx: -sign * handleLen, dy: 0 },
  ];
}

// 自己ループ時のデフォルトアンカーを決定する。
// v0.5.320: 形状別の最適既定（案 B）:
//   - curve / orthogonal: top-center → left-center（カード左上を回り込む美しいループ）
//   - straight は自己ループ作成時に curve に自動昇格するためここには来ない
//   - pathType 未指定（旧 API 呼び出し）: 互換性のため旧挙動 top-center → bottom-center
function _bdDefaultSelfLoopAnchors(pathType) {
  if (pathType === 'curve' || pathType === 'orthogonal') {
    return { from: 'top-center', to: 'left-center' };
  }
  return { from: 'top-center', to: 'bottom-center' };
}

// CubicBezier の t (0..1) における点を計算。
function _bdCubicBezierPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  const b0 = mt * mt * mt;
  const b1 = 3 * mt * mt * t;
  const b2 = 3 * mt * t * t;
  const b3 = t * t * t;
  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
  };
}

// 指定アンカーの「反対側」アンカー名を返す (自己ループの縮退防止用)。
// v0.5.330: カード間の中心ベクトル (連続角度) からライン端点と外向き単位ベクトルを直接算出する。
// 量子化しない方式に変更したため、斜め配置のカード間では真の対角線方向に線が走り、
// 矢印も SVG auto-start-reverse の接線追従によって斜め方向を向く。
// 戻り値: { fromPt: {x,y}, toPt: {x,y}, fromOut: {x,y}, toOut: {x,y} } or null
function _bdAutoRouteByVector(fp, tp, fw, fh, tw, th, gap, fromShape, toShape) {
  const fcx = fp.x + fw / 2, fcy = fp.y + fh / 2;
  const tcx = tp.x + tw / 2, tcy = tp.y + th / 2;
  const vx = tcx - fcx, vy = tcy - fcy;
  const vlen = Math.hypot(vx, vy);
  if (vlen < 0.5) return null;
  const ux = vx / vlen, uy = vy / vlen;
  // カード境界との交点を出す (矩形にベクトル方向で当てる)
  const borderHit = (cx, cy, w, h, dx, dy, shape) => {
    const halfW = w / 2, halfH = h / 2;
    if (BD_ELLIPSE_SHAPES.has(shape)) {
      const denom = Math.sqrt((dx * dx) / Math.max(1, halfW * halfW) + (dy * dy) / Math.max(1, halfH * halfH));
      const t = denom > 0 ? 1 / denom : 0;
      return { x: cx + dx * t, y: cy + dy * t };
    }
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    // 辺との衝突判定: (halfW / absDx) vs (halfH / absDy) で先に当たる辺を選ぶ
    const tX = absDx > 0 ? halfW / absDx : Infinity;
    const tY = absDy > 0 ? halfH / absDy : Infinity;
    const t = Math.min(tX, tY);
    return { x: cx + dx * t, y: cy + dy * t };
  };
  const fBorder = borderHit(fcx, fcy, fw, fh, ux, uy, fromShape);
  const tBorder = borderHit(tcx, tcy, tw, th, -ux, -uy, toShape);
  const gapLen = Number.isFinite(gap) ? gap : 0;
  return {
    fromPt: { x: fBorder.x + ux * gapLen, y: fBorder.y + uy * gapLen },
    toPt:   { x: tBorder.x - ux * gapLen, y: tBorder.y - uy * gapLen },
    fromOut: { x: ux, y: uy },
    toOut:   { x: -ux, y: -uy },
  };
}

// v0.5.326: アンカー名から「カード外向き」の単位ベクトルを返す。
// 辺中央は垂直方向、四隅は対角方向 (正規化済み)。
// 未知のアンカー名は (0,0) を返し、呼び出し側でオフセットを適用しない。
function _bdAnchorOutwardVector(anchor) {
  switch (anchor) {
    case 'top-center':    return { x:  0, y: -1 };
    case 'bottom-center': return { x:  0, y:  1 };
    case 'left-center':   return { x: -1, y:  0 };
    case 'right-center':  return { x:  1, y:  0 };
    case 'top-left':      return { x: -0.7071, y: -0.7071 };
    case 'top-right':     return { x:  0.7071, y: -0.7071 };
    case 'bottom-left':   return { x: -0.7071, y:  0.7071 };
    case 'bottom-right':  return { x:  0.7071, y:  0.7071 };
    default:              return { x: 0, y: 0 };
  }
}

function _bdOppositeAnchor(anchor) {
  switch (anchor) {
    case 'top-left':      return 'bottom-right';
    case 'top-center':    return 'bottom-center';
    case 'top-right':     return 'bottom-left';
    case 'left-center':   return 'right-center';
    case 'right-center':  return 'left-center';
    case 'bottom-left':   return 'top-right';
    case 'bottom-center': return 'top-center';
    case 'bottom-right':  return 'top-left';
    default:              return 'bottom-center';
  }
}

// Free Bezier 編集オーバーレイ: 8 アンカー候補点 + 2 ハンドル + 接続線を描画。
// ライン選択中のみ表示する (非選択時は誤タップ事故防止のため一切描画しない)。
function _bdRenderFreeBezierEditOverlay(svg, conn, pathData, fn, tn, fe, te, fp, tp, zoom, anchorHints) {
  if (!svg || !conn || !pathData) return;
  const z = Math.max(0.1, zoom || 1);
  const r = Math.max(5 / z, 4);       // アンカー候補点半径
  const handleR = Math.max(6 / z, 5); // ハンドル半径

  const selfLoop = conn.from === conn.to;
  // v0.5.327: 自動アンカー (anchorHints) を取り入れ、選択表示でもアクティブな方向が見えるようにする。
  const fromA = _bdConnAnchorName(conn, 'from') || anchorHints?.from || (selfLoop ? 'top-center' : null);
  const toA = _bdConnAnchorName(conn, 'to') || anchorHints?.to || (selfLoop ? 'bottom-center' : null);
  // v0.5.330: ハンドルドラッグ初期化用の外向きベクトル。
  // ユーザー明示アンカー > ヒント (自動アンカー名/連続角度ベクトル) の優先度で解決する。
  const fromOutResolved = fromA ? _bdAnchorOutwardVector(fromA) : (anchorHints?.fromOut || null);
  const toOutResolved = toA ? _bdAnchorOutwardVector(toA) : (anchorHints?.toOut || null);

  // 自己ループ時は同一アンカー候補点を共有: クリック = from 変更、Shift+クリック = to 変更。
  // 通常接続は from 側カードと to 側カードそれぞれで 8 アンカー候補を描画。
  const applyAnchorClick = (ev, anchorName, defaultSide) => {
    ev.stopPropagation();
    if (typeof bdPushUndo === 'function') bdPushUndo();
    const side = (conn.from === conn.to && ev.shiftKey) ? 'to' : defaultSide;
    const key = side === 'from' ? 'fromAnchor' : 'toAnchor';
    conn[key] = anchorName;
    // 両端同一アンカーになる縮退を回避 — 自己ループ時のみ適用 (別カードなら同じ名前でも
    // 座標が異なるため縮退しない。非自己ループで強制補正するとユーザー意図に反する)
    if (conn.from === conn.to) {
      const otherKey = side === 'from' ? 'toAnchor' : 'fromAnchor';
      if (conn[otherKey] === anchorName) conn[otherKey] = _bdOppositeAnchor(anchorName);
    }
    if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'free-bezier-anchor' });
    if (typeof bdDirty === 'function') bdDirty();
  };

  const makeAnchorDot = (point, anchorName, side, activeClass) => {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.classList.add('bd-anchor-candidate');
    if (activeClass) dot.classList.add(activeClass);
    dot.dataset.connId = conn.id;
    dot.setAttribute('cx', point.x);
    dot.setAttribute('cy', point.y);
    dot.setAttribute('r', r);
    dot.dataset.side = side;
    dot.dataset.anchor = anchorName;
    // Phase 3 との共存: アクティブアンカーは端点ドラッグハンドルに重なるため、
    // アンカー候補点側でクリックを奪わないよう pointer-events を無効化する。
    if (activeClass) dot.style.pointerEvents = 'none';
    dot.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    dot.addEventListener('click', (ev) => applyAnchorClick(ev, anchorName, side));
    return dot;
  };

  // v0.5.329: ユーザーが手動で設定できるアンカー候補点は従来通り辺中央 4 点に維持。
  // (ライン経路の自動ルーティングが内部で 8 方向対応しているため、矢印は 8 方向に向くが、
  //  ユーザー明示のアンカーは 4 点で十分。ただし既存データで四隅アンカーが保存されている
  //  ラインの場合は、その位置でも bd-active ハイライトを出すため ALL で比較)
  const equalsAnchor = (a, b) => a && b && a === b;
  if (selfLoop) {
    BD_ANCHOR_NAMES.forEach(anchorName => {
      const p = _bdGetCardAnchorPoint(fn, fe, fp, anchorName);
      let activeClass = '';
      if (equalsAnchor(anchorName, fromA) && equalsAnchor(anchorName, toA)) activeClass = 'bd-active';
      else if (equalsAnchor(anchorName, fromA)) activeClass = 'bd-active';
      else if (equalsAnchor(anchorName, toA)) activeClass = 'bd-active-to';
      svg.appendChild(makeAnchorDot(p, anchorName, 'from', activeClass));
    });
  } else {
    BD_ANCHOR_NAMES.forEach(anchorName => {
      const p1 = _bdGetCardAnchorPoint(fn, fe, fp, anchorName);
      svg.appendChild(makeAnchorDot(p1, anchorName, 'from', equalsAnchor(anchorName, fromA) ? 'bd-active' : ''));
      const p2 = _bdGetCardAnchorPoint(tn, te, tp, anchorName);
      svg.appendChild(makeAnchorDot(p2, anchorName, 'to', equalsAnchor(anchorName, toA) ? 'bd-active-to' : ''));
    });
  }

  // 2 ハンドル + 接続線
  const start = pathData.pathPoints?.[0];
  const end = pathData.pathPoints?.[pathData.pathPoints.length - 1];
  const cp1 = pathData.cp1 || start;
  const cp2 = pathData.cp2 || end;
  if (!start || !end) return;

  const drawLine = (a, b) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.classList.add('bd-curve-handle-line');
    line.dataset.connId = conn.id;
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    svg.appendChild(line);
  };
  drawLine(start, cp1);
  drawLine(end, cp2);

  const makeHandle = (point, cpIndex, anchorPoint, otherAnchor) => {
    const h = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    h.classList.add('bd-curve-handle');
    h.dataset.connId = conn.id;
    h.setAttribute('cx', point.x);
    h.setAttribute('cy', point.y);
    h.setAttribute('r', handleR);
    h.dataset.cpIndex = String(cpIndex);
    // v0.5.330: 外向きベクトル (連続角度対応) を _bdBindCurveHandleDrag へ引き渡し、
    // 自動モードから手動化する瞬間の初期 cp を自然な方向から算出できるようにする。
    _bdBindCurveHandleDrag(h, conn, anchorPoint, cpIndex, otherAnchor, fromOutResolved, toOutResolved);
    return h;
  };
  svg.appendChild(makeHandle(cp1, 0, start, end));
  svg.appendChild(makeHandle(cp2, 1, end, start));
}

// 指定ポイントから最近接のアンカーを返す (Phase 3: 端点ドロップ時の anchor 自動算出)
// v0.5.329: ユーザー操作で設定するアンカーは辺中央 4 点に戻す。ライン経路の 8 方向対応は
// 内部 _bdAutoAnchorByVector が担当する。
function _bdFindNearestAnchor(cardEl, node, pos, target) {
  const w = cardEl?.offsetWidth ?? node?.w ?? 160;
  const h = cardEl?.offsetHeight ?? node?.h ?? 60;
  const shape = cardEl?.dataset?.shape || node?.shape || '';
  let best = 'left-center';
  let bestDist = Infinity;
  for (const a of BD_ANCHOR_NAMES) {
    const p = _bdGetAnchorPointByShape(shape, pos.x, pos.y, w, h, a);
    const dx = p.x - target.x;
    const dy = p.y - target.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = a; }
  }
  return best;
}

// Phase 3: 接続線の端点ハンドルドラッグで from/to カードまたは固定座標を変更する。
// カード上にドロップすると接続先更新 + 最近接アンカーに自動設定。空白へのドロップは自由端として固定する。
// 座標変換は bdScreenToWorld を使い、pan/回転/アプリ zoom に追従。undo はカード変更確定時のみ push する。
function _bdBindConnectionEndpointDrag(handleEl, conn, side) {
  handleEl.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    const startClientX = ev.clientX;
    const startClientY = ev.clientY;
    let hoverCardEl = null;
    let moved = false;
    // 2026-04-18: ドラッグ中にライン本体を追従させるため、反対端 (動かさない側) の
    // アンカー座標を開始時に固定値として取得する。動かす側は現在のポインタ world 座標を使う。
    // 旧実装は handleEl (円) の cx/cy だけ更新していてライン本体がそのままだった。
    const otherSide = side === 'from' ? 'to' : 'from';
    const otherCardId = otherSide === 'from' ? conn.from : conn.to;
    const otherAnchorName = otherSide === 'from' ? conn.fromAnchor : conn.toAnchor;
    const otherFreePoint = bdNormalizeConnectionPoint(otherSide === 'from' ? conn.fromPoint : conn.toPoint);
    const previousEndpointPair = typeof bdConnectionEndpointKey === 'function'
      ? {
        fromKey: bdConnectionEndpointKey(conn, 'from'),
        toKey: bdConnectionEndpointKey(conn, 'to'),
      }
      : null;
    const otherNode = bd.nodes.find(n => n.id === otherCardId);
    let otherPt = otherFreePoint || { x: 0, y: 0 };
    if (otherNode) {
      const otherEl = document.getElementById('bdn-' + otherCardId);
      const otherPos = typeof bdNodeCanvasPosition === 'function'
        ? bdNodeCanvasPosition(otherNode)
        : { x: otherNode.x, y: otherNode.y };
      const ow = otherEl?.offsetWidth ?? otherNode.w ?? 160;
      const oh = otherEl?.offsetHeight ?? otherNode.h ?? 60;
      if (otherAnchorName && typeof _bdGetCardAnchorPoint === 'function') {
        otherPt = _bdGetCardAnchorPoint(otherNode, otherEl, otherPos, otherAnchorName);
      } else {
        otherPt = { x: otherPos.x + ow / 2, y: otherPos.y + oh / 2 };
      }
    }
    const pathEl = document.getElementById(`bd-path-${conn.id}`);
    const selBackEl = document.getElementById(`bd-sel-back-${conn.id}`);
    const selFrontEl = document.getElementById(`bd-sel-front-${conn.id}`);
    // 2026-04-18: ドラッグ中は全カードのアンカー HUD を隠す。ドラッグ中のハンドル円と
    // 移動先カードのアンカー HUD が同じ位置で重なって二重丸に見える問題を防ぐため。
    const bdCanvasEl = document.getElementById('bd-canvas');
    if (bdCanvasEl) bdCanvasEl.classList.add('bd-endpoint-dragging');
    const clearHover = () => {
      document.querySelectorAll('.bd-node.bd-drop-target').forEach(el => el.classList.remove('bd-drop-target'));
      hoverCardEl = null;
    };
    const updateLive = (worldPoint) => {
      // ドラッグプレビューは直線近似。ドロップ時に bdDrawConns が本来の曲線/直角/Free Bezier で再描画する。
      const s = side === 'from' ? worldPoint : otherPt;
      const e = side === 'from' ? otherPt : worldPoint;
      const d2 = `M${s.x},${s.y}L${e.x},${e.y}`;
      if (pathEl) pathEl.setAttribute('d', d2);
      if (selBackEl) selBackEl.setAttribute('d', d2);
      if (selFrontEl) selFrontEl.setAttribute('d', d2);
    };
    const onMove = (mv) => {
      const dragDistance = Math.hypot(mv.clientX - startClientX, mv.clientY - startClientY);
      if (!moved && dragDistance < 4) return;
      moved = true;
      const target = document.elementFromPoint(mv.clientX, mv.clientY);
      const cardEl = target?.closest?.('.bd-node');
      if (hoverCardEl && hoverCardEl !== cardEl) hoverCardEl.classList.remove('bd-drop-target');
      hoverCardEl = cardEl || null;
      if (cardEl) cardEl.classList.add('bd-drop-target');
      const w = typeof bdScreenToWorld === 'function'
        ? bdScreenToWorld(mv.clientX, mv.clientY)
        : { x: mv.clientX, y: mv.clientY };
      handleEl.setAttribute('cx', w.x);
      handleEl.setAttribute('cy', w.y);
      updateLive(w);
    };
    const onUp = (up, options = {}) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      if (bdCanvasEl) bdCanvasEl.classList.remove('bd-endpoint-dragging');
      if (options.cancelled) {
        clearHover();
        if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'endpoint-drag-cancel' });
        return;
      }
      const target = document.elementFromPoint(up.clientX, up.clientY);
      const cardEl = target?.closest?.('.bd-node');
      clearHover();
      const dropW = typeof bdScreenToWorld === 'function'
        ? bdScreenToWorld(up.clientX, up.clientY)
        : { x: up.clientX, y: up.clientY };
      if (moved && cardEl && typeof cardEl.id === 'string' && cardEl.id.startsWith('bdn-')) {
        const newCardId = cardEl.id.substring(4);
        const newNode = bd.nodes.find(n => n.id === newCardId);
        if (newNode) {
          const pos = typeof bdNodeCanvasPosition === 'function'
            ? bdNodeCanvasPosition(newNode)
            : { x: newNode.x, y: newNode.y };
          // 2026-04-18: ドロップ先がアンカー HUD の場合、最近接計算ではなくその HUD の
          // 示すアンカー名を直接採用する。楕円形状などで HUD 位置と最近接アンカーが
          // 食い違うケースに対応するため。
          const hitHud = target?.closest?.('.bd-anchor-hud');
          const hudPos = hitHud
            ? ['top','bottom','left','right'].find(p => hitHud.classList.contains(p))
            : null;
          const newAnchor = (hudPos && typeof _bdHudPosToAnchorName === 'function')
            ? _bdHudPosToAnchorName(hudPos)
            : _bdFindNearestAnchor(cardEl, newNode, pos, dropW);
          // 同じカード・同じアンカーへ戻す場合は変更不要 (undo を積まない)
          const oldCardId = side === 'from' ? conn.from : conn.to;
          const oldAnchor = side === 'from' ? conn.fromAnchor : conn.toAnchor;
          if (oldCardId === newCardId && oldAnchor === newAnchor) {
            if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'endpoint-drop-unchanged' });
            return;
          }
          // 実際に変更するのでここで undo push
          if (typeof bdPushUndo === 'function') bdPushUndo();
          if (side === 'from') {
            conn.from = newCardId;
            conn.fromAnchor = newAnchor;
            delete conn.fromPoint;
          } else {
            conn.to = newCardId;
            conn.toAnchor = newAnchor;
            delete conn.toPoint;
          }
          // 自己ループ同一アンカー縮退防止
          if (conn.from === conn.to && conn.fromAnchor && conn.fromAnchor === conn.toAnchor) {
            const otherKey = side === 'from' ? 'toAnchor' : 'fromAnchor';
            conn[otherKey] = _bdOppositeAnchor(newAnchor);
          }
          if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], previousEndpointPair, reason: 'endpoint-drop' });
          if (typeof bdDirty === 'function') bdDirty();
          return;
        }
      }
      if (moved) {
        const oldPoint = bdNormalizeConnectionPoint(side === 'from' ? conn.fromPoint : conn.toPoint);
        const oldCardId = side === 'from' ? conn.from : conn.to;
        const unchanged = !oldCardId && oldPoint
          && Math.abs(oldPoint.x - dropW.x) < 0.01
          && Math.abs(oldPoint.y - dropW.y) < 0.01;
        if (!unchanged) {
          if (typeof bdPushUndo === 'function') bdPushUndo();
          if (side === 'from') {
            conn.from = '';
            conn.fromPoint = { x: dropW.x, y: dropW.y };
            delete conn.fromAnchor;
          } else {
            conn.to = '';
            conn.toPoint = { x: dropW.x, y: dropW.y };
            delete conn.toAnchor;
          }
          if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], previousEndpointPair, reason: 'endpoint-drop-free' });
          if (typeof bdDirty === 'function') bdDirty();
          return;
        }
      }
      // 移動なし: conn は未変更なので undo 不要、再描画で handle 位置を元に戻す
      if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'endpoint-drop-cancel' });
    };
    const onCancel = (ev) => onUp(ev, { cancelled: true });
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  });
}

// ハンドルドラッグ: クライアント座標 → ワールド座標に変換して controlPoints を更新。
// pointermove 中に bdDrawConns で handleEl が再生成されるため、リスナーは document にバインドする。
// 座標変換は bdScreenToWorld を使い、bd.panX/Y / 回転 / アプリ zoom に追従させる。
function _bdBindCurveHandleDrag(handleEl, conn, anchorPoint, cpIndex, otherAnchor, fromOut, toOut) {
  handleEl.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    ev.preventDefault();
    let pushedUndo = false;
    let moved = false;
    const onMove = (mv) => {
      if (!moved) {
        moved = true;
        if (typeof bdPushUndo === 'function') { bdPushUndo(); pushedUndo = true; }
      }
      const w = typeof bdScreenToWorld === 'function'
        ? bdScreenToWorld(mv.clientX, mv.clientY)
        : { x: mv.clientX, y: mv.clientY };
      // v0.5.322: 自動モードから手動モードへ切替える際、もう片方のハンドル位置を
      // 現在の自動算出値で初期化する。{0,0} で初期化すると未ドラッグ側の cp が端点に
      // 張り付いてハンドルが消えたように見えてしまうため、_bdResolveControlPoints の
      // 自動値を採用する。otherAnchor は _bdRenderFreeBezierEditOverlay からクロージャで渡される。
      let cps;
      if (Array.isArray(conn.controlPoints) && conn.controlPoints.length === 2) {
        cps = [{ dx: conn.controlPoints[0].dx, dy: conn.controlPoints[0].dy },
               { dx: conn.controlPoints[1].dx, dy: conn.controlPoints[1].dy }];
      } else if (otherAnchor) {
        // v0.5.330: 自動モードで手動化する瞬間: 外向きベクトルを反映した自動 cps をベースラインに採用。
        const startPt = cpIndex === 0 ? anchorPoint : otherAnchor;
        const endPt = cpIndex === 0 ? otherAnchor : anchorPoint;
        const auto = _bdResolveControlPoints({}, startPt, endPt, fromOut, toOut);
        cps = [{ dx: auto[0].dx, dy: auto[0].dy }, { dx: auto[1].dx, dy: auto[1].dy }];
      } else {
        cps = [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }];
      }
      cps[cpIndex] = { dx: w.x - anchorPoint.x, dy: w.y - anchorPoint.y };
      conn.controlPoints = cps;
      // v0.5.328: ユーザー意図に合わせ、ハンドル操作時はハンドル (controlPoints) のみを手動化し、
      // アンカー方向は自動調整を継続する。アンカーをユーザーが明示的に設定したい場合は、
      // 選択時オーバーレイのアンカー候補点クリック or 端点ドラッグで行う。
      if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'free-bezier-handle' });
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (pushedUndo && typeof bdDirty === 'function') bdDirty();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
}

// v0.5.250: 同じカードペア間の複数ライン (相関図用) で、各ラインを中心線から
// 平行にズラすためのインデックス / 総数を算出する。方向違い (A→B と B→A) も
// 同じペアとして束ねて数える。
function _bdConnSiblingInfo(conn) {
  if (!conn || !Array.isArray(bd?.connections)) return { index: 0, count: 1 };
  const keyOf = (item, side) => (typeof bdConnectionEndpointKey === 'function')
    ? bdConnectionEndpointKey(item, side)
    : (side === 'from' ? ('node:' + (item?.from || '')) : ('node:' + (item?.to || '')));
  const fromKey = keyOf(conn, 'from');
  const toKey = keyOf(conn, 'to');
  const siblings = bd.connections.filter(o => o
    && !o.hidden
    && ((keyOf(o, 'from') === fromKey && keyOf(o, 'to') === toKey)
     || (keyOf(o, 'from') === toKey && keyOf(o, 'to') === fromKey)));
  const index = siblings.findIndex(o => o.id === conn.id);
  return { index: index < 0 ? 0 : index, count: siblings.length || 1 };
}

function _bdOrthogonalizePoints(points, structure) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const routed = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const prev = routed[routed.length - 1];
    const next = points[i];
    if (!prev || !next) continue;
    if (prev.x === next.x || prev.y === next.y) {
      routed.push(next);
      continue;
    }
    let corner;
    if (structure === 'logic') corner = { x: next.x, y: prev.y };
    else if (structure === 'flowchart' || structure === 'orgchart' || structure === 'tree') corner = { x: prev.x, y: next.y };
    else if (Math.abs(next.x - prev.x) >= Math.abs(next.y - prev.y)) corner = { x: next.x, y: prev.y };
    else corner = { x: prev.x, y: next.y };
    routed.push(corner, next);
  }
  return routed.filter((point, index, list) => {
    if (index === 0) return true;
    const prev = list[index - 1];
    return prev.x !== point.x || prev.y !== point.y;
  });
}

function _bdPolylineMidpoint(points) {
  if (!Array.isArray(points) || points.length < 2) return { point: points?.[0] || { x: 0, y: 0 }, angle: 0 };
  const segments = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!length) continue;
    segments.push({ start, end, length });
    total += length;
  }
  if (!segments.length) return { point: points[0], angle: 0 };
  const half = total / 2;
  let acc = 0;
  for (const segment of segments) {
    if (acc + segment.length >= half) {
      const ratio = (half - acc) / segment.length;
      const x = segment.start.x + (segment.end.x - segment.start.x) * ratio;
      const y = segment.start.y + (segment.end.y - segment.start.y) * ratio;
      const angle = Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x) * 180 / Math.PI;
      return { point: { x, y }, angle };
    }
    acc += segment.length;
  }
  const last = segments[segments.length - 1];
  return {
    point: { x: last.end.x, y: last.end.y },
    angle: Math.atan2(last.end.y - last.start.y, last.end.x - last.start.x) * 180 / Math.PI,
  };
}

function _bdMeasureConnectionCenter(pathEl, pathPoints, pathType, fallbackPoint) {
  if (pathType === 'straight' || pathType === 'orthogonal') {
    return _bdPolylineMidpoint(pathPoints);
  }
  try {
    const totalLength = pathEl?.getTotalLength?.() || 0;
    if (totalLength > 0) {
      const center = pathEl.getPointAtLength(totalLength / 2);
      const before = pathEl.getPointAtLength(Math.max(0, totalLength / 2 - 1));
      const after = pathEl.getPointAtLength(Math.min(totalLength, totalLength / 2 + 1));
      return {
        point: { x: center.x, y: center.y },
        angle: Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI,
      };
    }
  } catch {}
  return { point: fallbackPoint || { x: 0, y: 0 }, angle: 0 };
}

function _bdBuildArrowSpec(tip, neighbor, strokeWidth) {
  const dx = tip.x - neighbor.x;
  const dy = tip.y - neighbor.y;
  const segLength = Math.hypot(dx, dy);
  if (!segLength || !Number.isFinite(segLength)) return null;
  const ux = dx / segLength;
  const uy = dy / segLength;
  const maxUsableLength = Math.max(4, segLength - 1);
  const arrowLength = Math.min(Math.max(12, strokeWidth * 4 + 2), maxUsableLength);
  const centerOffset = Math.min(Math.max(2, arrowLength * 0.5), Math.max(2, segLength - 1));
  const baseCenterX = tip.x - ux * arrowLength;
  const baseCenterY = tip.y - uy * arrowLength;
  const halfWidth = Math.max(5, strokeWidth * 1.8 + 1.5);
  const px = -uy;
  const py = ux;
  const leftX = baseCenterX + px * halfWidth;
  const leftY = baseCenterY + py * halfWidth;
  const rightX = baseCenterX - px * halfWidth;
  const rightY = baseCenterY - py * halfWidth;
  return {
    lineEnd: {
      x: tip.x - ux * centerOffset,
      y: tip.y - uy * centerOffset,
    },
    path: `M${tip.x},${tip.y} L${leftX},${leftY} L${rightX},${rightY} Z`,
  };
}

function _bdEnsureArrowMarker(defs, markerId, color, strokeWidth, orientDeg, connId) {
  if (!defs || !markerId) return '';
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  const size = Math.max(8, Math.min(16, strokeWidth * 2.6 + 2));
  const refX = Math.max(1, Math.min(size * 0.25, Math.max(1.4, strokeWidth * 0.8)));
  marker.setAttribute('id', markerId);
  if (connId) marker.dataset.connId = connId;
  marker.setAttribute('markerWidth', size);
  marker.setAttribute('markerHeight', size);
  marker.setAttribute('refX', refX);
  marker.setAttribute('refY', size / 2);
  // orientDeg が数値なら固定角度、未指定なら path の接線方向に自動 (start/end で逆転)
  if (Number.isFinite(+orientDeg)) {
    marker.setAttribute('orient', String(+orientDeg));
  } else {
    marker.setAttribute('orient', 'auto-start-reverse');
  }
  marker.setAttribute('markerUnits', 'userSpaceOnUse');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M0,0 L${size - 1},${size / 2} L0,${size} Z`);
  path.setAttribute('fill', color);
  marker.appendChild(path);
  defs.appendChild(marker);
  return `url(#${markerId})`;
}

// 選択色 (純色) を 70% 不透明度の rgba に変換する。#RGB / #RRGGBB 形式のみ対応、他はそのまま返す。
// SVG の stroke 属性は color-mix を確実にサポートしないため、SVG 用には JS で rgba 化する必要がある。
function _bdToSelectionRgba(color) {
  if (!color) return '';
  const m = String(color).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
