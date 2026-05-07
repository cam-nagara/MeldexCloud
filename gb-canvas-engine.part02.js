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
      const finish = () => { label.contentEditable='false'; label.style.cursor = 'move'; g.name=label.textContent.trim()||g.name; bdDirty(); };
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
        .filter(n => !n.contained);
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
  } else if (obj.pathType === 'straight' || obj.straight === true) {
    obj.pathType = 'straight';
    delete obj.straight;
  }
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
  if (Array.isArray(raw) && raw.length === 2
      && raw[0] && Number.isFinite(raw[0].dx) && Number.isFinite(raw[0].dy)
      && raw[1] && Number.isFinite(raw[1].dx) && Number.isFinite(raw[1].dy)) {
    return [{ dx: raw[0].dx, dy: raw[0].dy }, { dx: raw[1].dx, dy: raw[1].dy }];
  }
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
function _bdAutoRouteByVector(fp, tp, fw, fh, tw, th, gap) {
  const fcx = fp.x + fw / 2, fcy = fp.y + fh / 2;
  const tcx = tp.x + tw / 2, tcy = tp.y + th / 2;
  const vx = tcx - fcx, vy = tcy - fcy;
  const vlen = Math.hypot(vx, vy);
  if (vlen < 0.5) return null;
  const ux = vx / vlen, uy = vy / vlen;
  // カード境界との交点を出す (矩形にベクトル方向で当てる)
  const borderHit = (cx, cy, w, h, dx, dy) => {
    const halfW = w / 2, halfH = h / 2;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    // 辺との衝突判定: (halfW / absDx) vs (halfH / absDy) で先に当たる辺を選ぶ
    const tX = absDx > 0 ? halfW / absDx : Infinity;
    const tY = absDy > 0 ? halfH / absDy : Infinity;
    const t = Math.min(tX, tY);
    return { x: cx + dx * t, y: cy + dy * t };
  };
  const fBorder = borderHit(fcx, fcy, fw, fh, ux, uy);
  const tBorder = borderHit(tcx, tcy, tw, th, -ux, -uy);
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
    let hoverCardEl = null;
    let moved = false;
    // 2026-04-18: ドラッグ中にライン本体を追従させるため、反対端 (動かさない側) の
    // アンカー座標を開始時に固定値として取得する。動かす側は現在のポインタ world 座標を使う。
    // 旧実装は handleEl (円) の cx/cy だけ更新していてライン本体がそのままだった。
    const otherSide = side === 'from' ? 'to' : 'from';
    const otherCardId = otherSide === 'from' ? conn.from : conn.to;
    const otherAnchorName = otherSide === 'from' ? conn.fromAnchor : conn.toAnchor;
    const otherFreePoint = bdNormalizeConnectionPoint(otherSide === 'from' ? conn.fromPoint : conn.toPoint);
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
    const onUp = (up) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (bdCanvasEl) bdCanvasEl.classList.remove('bd-endpoint-dragging');
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
          if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'endpoint-drop' });
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
          if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'endpoint-drop-free' });
          if (typeof bdDirty === 'function') bdDirty();
          return;
        }
      }
      // 移動なし: conn は未変更なので undo 不要、再描画で handle 位置を元に戻す
      if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'endpoint-drop-cancel' });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
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
  return `rgba(${r}, ${g}, ${b}, 0.7)`;
}

function _bdAppendConnectionSelectionHandle(svg, point, size, zoom, kind) {
  if (!svg || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const ns = 'http://www.w3.org/2000/svg';
  if (kind === 'mid') {
    const rect = document.createElementNS(ns, 'rect');
    rect.classList.add('bd-conn-selection-handle', 'bd-conn-selection-mid');
    rect.setAttribute('x', point.x - size);
    rect.setAttribute('y', point.y - size);
    rect.setAttribute('width', size * 2);
    rect.setAttribute('height', size * 2);
    rect.setAttribute('rx', size * 0.4);
    rect.setAttribute('transform', `rotate(45 ${point.x} ${point.y})`);
    rect.setAttribute('stroke-width', Math.max(1, 2 / Math.max(0.1, zoom || 1)));
    svg.appendChild(rect);
    return rect;
  }
  const circle = document.createElementNS(ns, 'circle');
  circle.classList.add('bd-conn-selection-handle', 'bd-conn-selection-end');
  circle.setAttribute('cx', point.x);
  circle.setAttribute('cy', point.y);
  circle.setAttribute('r', size);
  circle.setAttribute('stroke-width', Math.max(1, 1.5 / Math.max(0.1, zoom || 1)));
  svg.appendChild(circle);
  return circle;
}

function _bdPolylinePath(points) {
  if (!Array.isArray(points) || points.length < 2) return '';
  return `M${points[0].x},${points[0].y}` + points.slice(1).map(point => ` L${point.x},${point.y}`).join('');
}

// 直角ポリラインの各コーナーを 2 次ベジェで丸めた SVG パスを生成する。
// ポリラインの点列は直角線と共通。コーナー半径は両隣の辺長の半分以下に自動で収める。
// v0.5.320: radius を引数で受け取る (未指定は 12)。radius <= 0 は _bdPolylinePath に委譲しシャープ直角。
function _bdRoundedOrthogonalPath(points, radius) {
  if (!Array.isArray(points) || points.length < 2) return '';
  if (points.length === 2) return _bdPolylinePath(points);
  const RADIUS = Number.isFinite(+radius) ? Math.max(0, +radius) : 12;
  if (!(RADIUS > 0)) return _bdPolylinePath(points);
  const segLen = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const rIn = Math.min(RADIUS, segLen(prev, curr) / 2);
    const rOut = Math.min(RADIUS, segLen(curr, next) / 2);
    const r = Math.min(rIn, rOut);
    if (!(r > 0)) { d += ` L${curr.x},${curr.y}`; continue; }
    const inDx = curr.x - prev.x;
    const inDy = curr.y - prev.y;
    const inLen = Math.hypot(inDx, inDy) || 1;
    const entryX = curr.x - (inDx / inLen) * r;
    const entryY = curr.y - (inDy / inLen) * r;
    const outDx = next.x - curr.x;
    const outDy = next.y - curr.y;
    const outLen = Math.hypot(outDx, outDy) || 1;
    const exitX = curr.x + (outDx / outLen) * r;
    const exitY = curr.y + (outDy / outLen) * r;
    d += ` L${entryX},${entryY} Q${curr.x},${curr.y} ${exitX},${exitY}`;
  }
  const last = points[points.length - 1];
  d += ` L${last.x},${last.y}`;
  return d;
}

function _bdBuildConnectionPathData(conn, pts, structure, connStyle, bulgeOffset, anchorHints) {
  const start = pts[0];
  const end = pts[pts.length - 1];
  // マインドマップ構造のラインは常に直線形状にする (呼び出し側で effectiveStructure が ''
  // に落とされている場合に備え、conn.from の構造もフォールバックで参照する)。
  const rootStruct = (structure === 'mindmap')
    ? 'mindmap'
    : ((typeof bdStructureOf === 'function' && conn?.from) ? bdStructureOf(conn.from) : '');
  const pathType = _bdLinePathType(connStyle, rootStruct);
  // v0.5.250: bulgeOffset は同じカードペア間の複数ライン (相関図) で、曲線を反対方向に
  // 膨らませて区別するためのオフセット値 (px)。曲線以外 (直線 / 直角) は無視する。
  const bulge = Number.isFinite(bulgeOffset) ? bulgeOffset : 0;
  // v0.5.330: anchorHints は fromOut/toOut (連続角度ベクトル) または from/to (アンカー名)
  // を持つ。ユーザー指定 conn.fromAnchor/toAnchor を最優先、なければ anchorHints を使う。
  const userFromName = (conn?.fromAnchor && typeof conn.fromAnchor === 'string') ? conn.fromAnchor : null;
  const userToName = (conn?.toAnchor && typeof conn.toAnchor === 'string') ? conn.toAnchor : null;
  const hintFromName = anchorHints?.from || null;
  const hintToName = anchorHints?.to || null;
  const resolvedFromAnchor = userFromName || hintFromName;
  const resolvedToAnchor = userToName || hintToName;
  // 外向きベクトル: ユーザー/ヒントのアンカー名から算出 or 連続角度の fromOut/toOut を使用
  const fromOut = userFromName ? _bdAnchorOutwardVector(userFromName)
    : (anchorHints?.fromOut || (hintFromName ? _bdAnchorOutwardVector(hintFromName) : null));
  const toOut = userToName ? _bdAnchorOutwardVector(userToName)
    : (anchorHints?.toOut || (hintToName ? _bdAnchorOutwardVector(hintToName) : null));
  // v0.5.320: 曲線で conn.controlPoints がある = 手動モード (旧 free-bezier 相当)。
  // 手動モード時はアンカーと controlPoints で経路を完全指定、bulge は無視する。
  if (pathType === 'curve' && Array.isArray(conn?.controlPoints) && conn.controlPoints.length === 2) {
    const cps = _bdResolveControlPoints(conn, start, end, fromOut, toOut);
    const cp1 = { x: start.x + cps[0].dx, y: start.y + cps[0].dy };
    const cp2 = { x: end.x + cps[1].dx, y: end.y + cps[1].dy };
    return {
      d: `M${start.x},${start.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${end.x},${end.y}`,
      pathPoints: [start, end],
      labelPoint: _bdCubicBezierPoint(start, cp1, cp2, end, 0.5),
      controlPoints: cps,
      cp1, cp2,
    };
  }
  // v0.5.320: 自己ループ (from === to) を形状別に最適化 (案 B)。
  // 曲線: 左上象限に膨らむベジェループ、直角線: L 字 2 段迂回。
  if (conn && conn.from && conn.from === conn.to && typeof bd !== 'undefined') {
    const node = bd.nodes?.find?.(n => n.id === conn.from);
    if (node) {
      const w = node._rw || node.w || 160;
      const h = node._rh || node.h || 40;
      if (pathType === 'curve') {
        // v0.5.336: ユーザー指定の仕様に基づき、アンカーペアごとにハンドルの向きを決める。
        // - 上下同士 (top ↔ bottom): 上側=左上、下側=左下
        // - 左右同士 (left ↔ right): 左側=左上、右側=右上
        // - それ以外: 各アンカーの外向き (top=上, bottom=下, left=左, right=右)
        const handleLen = Math.max(100, Math.max(w, h) * 1.0);
        const isTop = (a) => a === 'top-center';
        const isBottom = (a) => a === 'bottom-center';
        const isLeft = (a) => a === 'left-center';
        const isRight = (a) => a === 'right-center';
        const fA = resolvedFromAnchor;
        const tA = resolvedToAnchor;
        const verticalPair = (isTop(fA) && isBottom(tA)) || (isBottom(fA) && isTop(tA));
        const horizontalPair = (isLeft(fA) && isRight(tA)) || (isRight(fA) && isLeft(tA));
        const dirOf = (anchor) => {
          if (verticalPair) {
            if (isTop(anchor)) return { x: -1, y: -1 };     // 左上
            if (isBottom(anchor)) return { x: -1, y: 1 };   // 左下
          } else if (horizontalPair) {
            if (isLeft(anchor)) return { x: -1, y: -1 };    // 左上
            if (isRight(anchor)) return { x: 1, y: -1 };    // 右上
          }
          // mixed / その他: 各アンカーの外向き
          if (isTop(anchor)) return { x: 0, y: -1 };
          if (isBottom(anchor)) return { x: 0, y: 1 };
          if (isLeft(anchor)) return { x: -1, y: 0 };
          if (isRight(anchor)) return { x: 1, y: 0 };
          // 四隅 (旧データ互換): 対角方向
          const diag = _bdAnchorOutwardVector(anchor);
          return diag || { x: 0, y: 0 };
        };
        const norm = (v) => {
          const L = Math.hypot(v.x, v.y) || 1;
          return { x: v.x / L, y: v.y / L };
        };
        const fd = norm(dirOf(fA));
        const td = norm(dirOf(tA));
        const cp1 = { x: start.x + fd.x * handleLen, y: start.y + fd.y * handleLen };
        const cp2 = { x: end.x + td.x * handleLen, y: end.y + td.y * handleLen };
        return {
          d: `M${start.x},${start.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${end.x},${end.y}`,
          pathPoints: [start, end],
          labelPoint: _bdCubicBezierPoint(start, cp1, cp2, end, 0.5),
          controlPoints: [{ dx: cp1.x - start.x, dy: cp1.y - start.y }, { dx: cp2.x - end.x, dy: cp2.y - end.y }],
          cp1, cp2,
        };
      }
      if (pathType === 'orthogonal') {
        // v0.5.334: L 字 2 段迂回 (top-center → 左上象限 → left-center)
        // 迂回距離をカード寸法に応じて拡大。小さいカードでも最低 60px の隙間を確保。
        const LOOP_PAD = Math.max(60, Math.min(w, h) * 0.8);
        const x0 = node.x, y0 = node.y;
        const pathPoints = [
          start,
          { x: start.x, y: y0 - LOOP_PAD },
          { x: x0 - LOOP_PAD, y: y0 - LOOP_PAD },
          { x: x0 - LOOP_PAD, y: end.y },
          end,
        ];
        const ratioRaw = Number.isFinite(+conn?.cornerRadius) ? +conn.cornerRadius
          : (Number.isFinite(+connStyle?.cornerRadius) ? +connStyle.cornerRadius : 0);
        const label = _bdPolylineMidpoint(pathPoints).point;
        if (ratioRaw > 0) {
          return { d: _bdRoundedOrthogonalPath(pathPoints, ratioRaw), pathPoints, labelPoint: label };
        }
        return { d: _bdPolylinePath(pathPoints), pathPoints, labelPoint: label };
      }
    }
  }
  if (pathType === 'orthogonal') {
    // 「直角線」は常に 2 段階折れ曲がり（コの字）。structure が指定されていれば方向を強制、
    // なければ start-end ベクトルの優勢方向で自動選択する。
    // v0.5.320: cornerRadius が >0 なら角丸に描画 (旧 orthogonal-curve を吸収)。
    //          branchRatio で折れ曲がり位置を可変 (既定 0.3)。
    //          conn 個別設定 > connStyle > デフォルトの順に解決。
    const ratioRaw = Number.isFinite(+conn?.branchRatio) ? +conn.branchRatio
      : (Number.isFinite(+connStyle?.branchRatio) ? +connStyle.branchRatio : 0.3);
    const branchRatio = Math.max(0.05, Math.min(0.95, ratioRaw));
    const radius = Number.isFinite(+conn?.cornerRadius) ? +conn.cornerRadius
      : (Number.isFinite(+connStyle?.cornerRadius) ? +connStyle.cornerRadius : 0);
    const buildPoints = () => {
      if (pts.length !== 2) return _bdOrthogonalizePoints(pts, structure);
      const dx = Math.abs(end.x - start.x);
      const dy = Math.abs(end.y - start.y);
      const useHorizontal =
        structure === 'logic' ||
        (structure !== 'flowchart' && structure !== 'orgchart' && structure !== 'tree' && dx >= dy);
      if (useHorizontal) {
        const branchX = start.x + (end.x - start.x) * branchRatio;
        return [start, { x: branchX, y: start.y }, { x: branchX, y: end.y }, end];
      }
      const branchY = start.y + (end.y - start.y) * branchRatio;
      return [start, { x: start.x, y: branchY }, { x: end.x, y: branchY }, end];
    };
    const pathPoints = buildPoints();
    const label = _bdPolylineMidpoint(pathPoints).point;
    if (radius > 0) {
      return { d: _bdRoundedOrthogonalPath(pathPoints, radius), pathPoints, labelPoint: label };
    }
    return { d: _bdPolylinePath(pathPoints), pathPoints, labelPoint: label };
  }
  // 2026-04-18: curve pathType のときに structure='logic'/'orgchart' で強制 L 字化していた分岐を削除。
  // L 字形状は pathType='orthogonal' 専用にして、curve は常にベジェを維持する。
  if (pathType === 'straight') {
    return { d: _bdPolylinePath(pts), pathPoints: pts, labelPoint: _bdPolylineMidpoint(pts).point };
  }
  if (pts.length === 2) {
    // v0.5.330: 外向きベクトル (連続角度) または名前ベースのアンカー情報があれば
    // _bdResolveControlPoints の方向追従ロジックでハンドルを決める。
    if (fromOut || toOut) {
      const cps = _bdResolveControlPoints({}, start, end, fromOut, toOut);
      const cp1 = { x: start.x + cps[0].dx, y: start.y + cps[0].dy };
      const cp2 = { x: end.x + cps[1].dx, y: end.y + cps[1].dy };
      return {
        d: `M${start.x},${start.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${end.x},${end.y}`,
        pathPoints: [start, end],
        labelPoint: _bdCubicBezierPoint(start, cp1, cp2, end, 0.5),
        controlPoints: cps,
        cp1, cp2,
      };
    }
    // v0.5.320: auto 曲線でも cp1/cp2/controlPoints を返し、_bdRenderFreeBezierEditOverlay
    // が常にハンドル描画できるようにする (手動モードへの切替対応)。
    if (structure === 'flowchart' || structure === 'tree') {
      const dy = Math.max(24, Math.abs(end.y - start.y) * 0.5);
      const sign = end.y >= start.y ? 1 : -1;
      const cp1 = { x: start.x + bulge, y: start.y + sign * dy };
      const cp2 = { x: end.x + bulge, y: end.y - sign * dy };
      const labelX = (start.x + end.x) / 2 + bulge;
      return {
        d: `M${start.x},${start.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${end.x},${end.y}`,
        pathPoints: [start, end],
        labelPoint: { x: labelX, y: (start.y + end.y) / 2 },
        cp1, cp2,
        controlPoints: [{ dx: cp1.x - start.x, dy: cp1.y - start.y }, { dx: cp2.x - end.x, dy: cp2.y - end.y }],
      };
    }
    const dx = Math.max(24, Math.abs(end.x - start.x) * 0.45);
    const sign = end.x >= start.x ? 1 : -1;
    const cp1 = { x: start.x + sign * dx, y: start.y + bulge };
    const cp2 = { x: end.x - sign * dx, y: end.y + bulge };
    const labelY = (start.y + end.y) / 2 + bulge;
    return {
      d: `M${start.x},${start.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${end.x},${end.y}`,
      pathPoints: [start, end],
      labelPoint: { x: (start.x + end.x) / 2, y: labelY },
      cp1, cp2,
      controlPoints: [{ dx: cp1.x - start.x, dy: cp1.y - start.y }, { dx: cp2.x - end.x, dy: cp2.y - end.y }],
    };
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const mx = (prev.x + cur.x) / 2;
    const my = (prev.y + cur.y) / 2;
    d += ` Q${prev.x + (cur.x - prev.x) * 0.5},${prev.y} ${mx},${my}`;
  }
  d += ` L${end.x},${end.y}`;
  return { d, pathPoints: pts, labelPoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
}
