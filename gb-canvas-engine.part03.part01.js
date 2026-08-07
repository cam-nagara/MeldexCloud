/* gb-canvas-engine.part03.js */
function _bdConnectionStrokeWidth(conn, connStyle, defaultWidth) {
  const fallback = Number.isFinite(+defaultWidth) ? Math.max(0, +defaultWidth) : 1;
  if (conn && Object.prototype.hasOwnProperty.call(conn, 'width') && Number.isFinite(+conn.width)) {
    return Math.max(0, +conn.width);
  }
  if (connStyle && Number.isFinite(+connStyle.width) && +connStyle.width !== 0) {
    return Math.max(0, +connStyle.width);
  }
  return fallback;
}

function _bdRemoveLineCommentBadge(connId) {
  document.querySelectorAll('.bd-line-comment-badge').forEach(el => {
    if (String(el.dataset.connId || '') === String(connId || '')) el.remove();
  });
}

function _bdAppendLineCommentBadge(conn, point) {
  if (!conn || !point) return;
  if (typeof CommentBadges === 'undefined' || typeof CommentBadges.getBoardLineCount !== 'function') return;
  const count = CommentBadges.getBoardLineCount(conn.id, bd?.path || '');
  if (!count) return;
  const layer = document.getElementById('bd-nodes') || document.getElementById('bd-world');
  if (!layer) return;
  const badge = document.createElement('div');
  badge.className = 'bd-line-comment-badge';
  badge.dataset.connId = conn.id;
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.title = count + '件のコメント';
  badge.style.cssText = [
    'position:absolute',
    `left:${point.x}px`,
    `top:${point.y}px`,
    'transform:translate(-50%,-50%)',
    'min-width:16px',
    'height:16px',
    'padding:0 4px',
    'border-radius:9px',
    'background:var(--accent,#4a90e2)',
    'color:var(--ui-fg-strong,#fff)',
    'font-size:10px',
    'line-height:16px',
    'text-align:center',
    'z-index:6',
    'cursor:pointer',
    'pointer-events:auto',
    'box-shadow:0 0 0 1px var(--bg2)',
  ].join(';');
  badge.addEventListener('pointerdown', ev => { ev.stopPropagation(); });
  badge.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof CommentBadges.openPanelForTarget === 'function') {
      const filePath = bd?.path || '';
      CommentBadges.openPanelForTarget(filePath, 'board_line', { file: filePath, lineId: conn.id });
    }
  });
  layer.appendChild(badge);
}

function bdDrawConns(options) {
  const _bdDrawPerf = typeof bdPerfStart === 'function' ? bdPerfStart('bdDrawConns') : 0;
  _removeConnActionBtn();
  const svg = document.getElementById('bd-svg');
  if (!svg) {
    if (typeof bdPerfEnd === 'function') bdPerfEnd('bdDrawConns', _bdDrawPerf, 'no-svg');
    return;
  }
  // defsを保持してpathをクリア + ラベルDOMもクリア
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);
  }
  bdEnsureConnectionRuntime(bd.connections);
  const partialConnIds = typeof bdNormalizePartialConnectionIds === 'function'
    ? bdNormalizePartialConnectionIds(options)
    : null;
  const drawMeta = partialConnIds
    ? `partial=${partialConnIds.size} reason=${options?.reason || ''}`
    : `full reason=${options?.reason || ''}`;
  if (partialConnIds && partialConnIds.size === 0) {
    if (typeof bdPerfEnd === 'function') bdPerfEnd('bdDrawConns', _bdDrawPerf, 'partial-empty');
    return;
  }
  if (partialConnIds) {
    partialConnIds.forEach(connId => {
      bdRemoveConnectionRender(svg, defs, connId);
      _bdRemoveLineCommentBadge(connId);
    });
  } else {
    defs.innerHTML = '';
    svg.querySelectorAll('.bd-conn-path, .bd-conn-hit, .bd-conn-arrow, .bd-conn-selection, .bd-conn-selection-dot, .bd-conn-selection-handle, .bd-anchor-candidate, .bd-curve-handle, .bd-curve-handle-line, .bd-conn-label-path').forEach(p => p.remove());
    document.querySelectorAll('.bd-conn-label,.bd-line-comment-badge').forEach(l => l.remove());
  }
  const autoDepthStyleMap = typeof bdBuildAutoDepthStyleMap === 'function'
    ? bdBuildAutoDepthStyleMap(bd)
    : new Map();
  bd.connections.forEach(c => {
    if (partialConnIds && !partialConnIds.has(c.id)) return;
    // 選択 UI (端点ハンドル / 中央ハンドル) を hit append の後に持ち上げるための一時バッファ。
    // 選択されていないラインでは空配列のままになる。
    let _lineSelTopRefs = [];
    const connStyle = typeof bdGetConnectionStyle === 'function' ? bdGetConnectionStyle(c) : c;
    const lineStyleId = c.styleRef || bd.lineStyles?.[0]?.id || 'default';
    const depthLineStyleIndex = typeof bdGetAutoDepthLineStyleIndexForConnection === 'function'
      ? bdGetAutoDepthLineStyleIndexForConnection(c, autoDepthStyleMap)
      : '';
    if (bd.displayFilters && bd.displayFilters.showConnections === false) return; // 非表示
    const fe = c.from ? document.getElementById('bdn-'+c.from) : null;
    const te = c.to ? document.getElementById('bdn-'+c.to) : null;
    const fn = c.from ? bd.nodes.find(n=>n.id===c.from) : null;
    const tn = c.to ? bd.nodes.find(n=>n.id===c.to) : null;
    const rawFromPoint = bdNormalizeConnectionPoint(c.fromPoint);
    const rawToPoint = bdNormalizeConnectionPoint(c.toPoint);
    if ((c.from && (!fe || !fn)) || (c.to && (!te || !tn))) return;
    if (!c.from && !rawFromPoint) return;
    if (!c.to && !rawToPoint) return;
    const fp = fn
      ? (typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(fn) : { x: fn.x, y: fn.y })
      : { x: rawFromPoint.x, y: rawFromPoint.y };
    const tp = tn
      ? (typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(tn) : { x: tn.x, y: tn.y })
      : { x: rawToPoint.x, y: rawToPoint.y };
    const st = bdStructureOf(c.from);
    const fw=fe?.offsetWidth || fn?.w || 0, fh=fe?.offsetHeight || fn?.h || 0, tw=te?.offsetWidth || tn?.w || 0, th=te?.offsetHeight || tn?.h || 0;
    let x1,y1,x2,y2,d;
    // 始点・終点: カード中心から中心を結ぶ直線を、両端のカード矩形で切り落とす (2026-04-18)
    // 旧: structure (flowchart / logic) に応じて上下端/左右端を選択していた
    const cx1 = fn ? fp.x + fw/2 : rawFromPoint.x, cy1 = fn ? fp.y + fh/2 : rawFromPoint.y;
    const cx2 = tn ? tp.x + tw/2 : rawToPoint.x, cy2 = tn ? tp.y + th/2 : rawToPoint.y;
    const ddx = cx2 - cx1, ddy = cy2 - cy1;

    const depth = typeof bdParentDepth === 'function' ? bdParentDepth(tn) : 0;
    // width: ユーザー指定値があればそれを使用、なければ深さに応じたデフォルト（旧値の約半分）
    const defaultW = Math.max(1, 7 - depth * 1.5);
    const strokeWidth = _bdConnectionStrokeWidth(c, connStyle, defaultW);
    const pathType = _bdLinePathType(connStyle, st);
    const arrow = connStyle.arrow || '';
    const hasArrow = !!arrow;
    const zoom = Math.max(0.1, bd.zoom || 1);

    // 曲線 / 直角線の場合は辺の中央を指す (2026-04-18 フィードバック)
    // 直線の場合は中心ベクトル方向でクリップ
    // NOTE: effectiveStructure は _bdBuildConnectionPathData で曲線/直角線の向き決定に使う。
    // 'logic' / 'orgchart' を渡すと L 字 (2 段階折れ曲がり) になってしまうため、
    // 水平方向は '' (auto: dx>=dy で水平選択) / 垂直方向は 'flowchart' を渡して曲線・直線を維持する。
    // カード端からの gap はパスタイプごとに別経路で適用する (2026-04-18):
    //   - L 字系 (curve / orthogonal): 軸方向のみ (y1=cy1 / x1=cx1 を維持して兄弟ラインの重なりを崩さない)
    //   - 直線系 (straight): 中心ベクトル沿い
    const GAP = Math.max(6, strokeWidth * 2);
    let effectiveStructure = st;
    let fromA = fn ? _bdConnAnchorName(c, 'from') : null;
    let toA = tn ? _bdConnAnchorName(c, 'to') : null;
    let hasUserAnchor = !!(fromA || toA);
    let autoFromOut = null, autoToOut = null, autoFromPt = null, autoToPt = null;
    const hasFreeEndpoint = !fn || !tn;
    if (hasFreeEndpoint) {
      const clipCardEndpoint = (node, el, pos, target, anchorName) => {
        if (!node) return target;
        if (anchorName) {
          const p = _bdGetCardAnchorPoint(node, el, pos, anchorName);
          const vOut = _bdAnchorOutwardVector(anchorName);
          return { x: p.x + vOut.x * GAP, y: p.y + vOut.y * GAP };
        }
        const w = el?.offsetWidth || node.w || 160;
        const h = el?.offsetHeight || node.h || 60;
        const cx = pos.x + w / 2;
        const cy = pos.y + h / 2;
        const vx = target.x - cx;
        const vy = target.y - cy;
        const len = Math.hypot(vx, vy) || 1;
        const ux = vx / len;
        const uy = vy / len;
        const tx = Math.abs(ux) > 0 ? (w / 2) / Math.abs(ux) : Infinity;
        const ty = Math.abs(uy) > 0 ? (h / 2) / Math.abs(uy) : Infinity;
        const t = Math.min(tx, ty);
        return { x: cx + ux * (t + GAP), y: cy + uy * (t + GAP) };
      };
      const freeFrom = rawFromPoint || { x: cx1, y: cy1 };
      const freeTo = rawToPoint || { x: cx2, y: cy2 };
      const fromEndpoint = fn ? clipCardEndpoint(fn, fe, fp, { x: cx2, y: cy2 }, fromA) : freeFrom;
      const toEndpoint = tn ? clipCardEndpoint(tn, te, tp, { x: cx1, y: cy1 }, toA) : freeTo;
      x1 = fromEndpoint.x; y1 = fromEndpoint.y;
      x2 = toEndpoint.x; y2 = toEndpoint.y;
      effectiveStructure = '';
    } else {
    // v0.5.320: アンカー指定を全形状で共通化。先にアンカー指定/自己ループを解決し、
    // 残った「未指定側の始終点」を形状別の既定ロジックで埋める。
    // v0.5.327: 両端アンカー未指定かつ structure 強制なしの場合、カード位置ベクトルから
    // 8 方向最適アンカーを自動算出する (矢印方向を自然にし、曲線もその方向へ素直に追従)。
    // 算出値は conn に保存しない (ユーザーがハンドルをドラッグした瞬間に保存される)。
    const selfLoop = c.from === c.to;
    // v0.5.327: ユーザー明示アンカーかどうかの判定を auto-assignment 前に記録しておく。
    hasUserAnchor = !!(fromA || toA);
    // v0.5.330: 連続角度ベースの自動ルート (矢印が斜め含む 8 方向に自然追従するため)。
    // 量子化アンカー名は使わず、実際のカード間ベクトルに沿って端点と外向き方向を直接算出。
    if (selfLoop && !fromA && !toA) {
      const def = _bdDefaultSelfLoopAnchors(pathType);
      fromA = def.from; toA = def.to;
    }
    if (!selfLoop && !fromA && !toA) {
      const HORIZONTAL_FORCED = new Set(['logic', 'timeline', 'mindmap']);
      const VERTICAL_FORCED = new Set(['orgchart', 'flowchart', 'tree']);
      if (!HORIZONTAL_FORCED.has(st) && !VERTICAL_FORCED.has(st)) {
        const fromShape = fe?.dataset?.shape || fn?.shape || '';
        const toShape = te?.dataset?.shape || tn?.shape || '';
        const auto = _bdAutoRouteByVector(fp, tp, fw, fh, tw, th, GAP, fromShape, toShape);
        if (auto) {
          autoFromPt = auto.fromPt;
          autoToPt = auto.toPt;
          autoFromOut = auto.fromOut;
          autoToOut = auto.toOut;
        }
      }
    }
    // v0.5.326: アンカー指定時は、アンカー座標 (カード境界上) からカード外向きに
    // GAP 分オフセットして端点を置く。これにより矢印がカードに隠れず、通常作成ラインと
    // 同等の見え方になる (GAP は上方で strokeWidth に応じて決定済み)。
    if (fromA) {
      const p = _bdGetCardAnchorPoint(fn, fe, fp, fromA);
      const vOut = _bdAnchorOutwardVector(fromA);
      x1 = p.x + vOut.x * GAP;
      y1 = p.y + vOut.y * GAP;
    } else if (autoFromPt) {
      // v0.5.330: 連続角度ベースの自動ルートで端点を置く (矢印方向を斜め含む 8+ 方向に)
      x1 = autoFromPt.x; y1 = autoFromPt.y;
    }
    if (toA) {
      const p = _bdGetCardAnchorPoint(tn, te, tp, toA);
      const vOut = _bdAnchorOutwardVector(toA);
      x2 = p.x + vOut.x * GAP;
      y2 = p.y + vOut.y * GAP;
    } else if (autoToPt) {
      x2 = autoToPt.x; y2 = autoToPt.y;
    }

    if (pathType === 'curve' && (fromA || toA)) {
      // アンカー指定あり: curve でもアンカー座標を厳密に使い、未指定側のみ自動補完
      if (!fromA || !toA) {
        const HORIZONTAL_STRUCTURES = new Set(['logic', 'timeline', 'mindmap']);
        const VERTICAL_STRUCTURES = new Set(['orgchart', 'flowchart', 'tree']);
        let useHorizontal;
        if (HORIZONTAL_STRUCTURES.has(st)) useHorizontal = true;
        else if (VERTICAL_STRUCTURES.has(st)) useHorizontal = false;
        else if (ddx === 0 && ddy === 0) useHorizontal = true;
        else {
          const hGap = ddx >= 0 ? tp.x - (fp.x + fw) : fp.x - (tp.x + tw);
          const vGap = ddy >= 0 ? tp.y - (fp.y + fh) : fp.y - (tp.y + th);
          useHorizontal = hGap >= vGap;
        }
        if (useHorizontal) {
          if (!fromA) { x1 = ddx >= 0 ? fp.x + fw + GAP : fp.x - GAP; y1 = cy1; }
          if (!toA)   { x2 = ddx >= 0 ? tp.x - GAP : tp.x + tw + GAP; y2 = cy2; }
        } else {
          if (!fromA) { y1 = ddy >= 0 ? fp.y + fh + GAP : fp.y - GAP; x1 = cx1; }
          if (!toA)   { y2 = ddy >= 0 ? tp.y - GAP : tp.y + th + GAP; x2 = cx2; }
        }
      }
      effectiveStructure = '';
    } else if (ddx === 0 && ddy === 0 && !fromA && !toA) {
      x1 = cx1; y1 = cy1; x2 = cx2; y2 = cy2;
    } else if (pathType === 'orthogonal' && (fromA || toA)) {
      // 直角線のアンカー指定: アンカー側はそのまま、未指定側は辺中央 + GAP で既定補完
      if (!fromA || !toA) {
        const HORIZONTAL_STRUCTURES = new Set(['logic', 'timeline', 'mindmap']);
        const VERTICAL_STRUCTURES = new Set(['orgchart', 'flowchart', 'tree']);
        let useHorizontal;
        if (HORIZONTAL_STRUCTURES.has(st)) useHorizontal = true;
        else if (VERTICAL_STRUCTURES.has(st)) useHorizontal = false;
        else {
          const hGap = ddx >= 0 ? tp.x - (fp.x + fw) : fp.x - (tp.x + tw);
          const vGap = ddy >= 0 ? tp.y - (fp.y + fh) : fp.y - (tp.y + th);
          useHorizontal = hGap >= vGap;
        }
        if (useHorizontal) {
          if (!fromA) { x1 = ddx >= 0 ? fp.x + fw + GAP : fp.x - GAP; y1 = cy1; }
          if (!toA)   { x2 = ddx >= 0 ? tp.x - GAP : tp.x + tw + GAP; y2 = cy2; }
        } else {
          if (!fromA) { y1 = ddy >= 0 ? fp.y + fh + GAP : fp.y - GAP; x1 = cx1; }
          if (!toA)   { y2 = ddy >= 0 ? tp.y - GAP : tp.y + th + GAP; x2 = cx2; }
        }
      }
      effectiveStructure = '';
    } else if (pathType === 'straight' && (fromA || toA)) {
      // 直線のアンカー指定: アンカー側はそのまま、未指定側は中心ベクトル沿いで矩形クリップ
      if (!fromA) {
        const adx = Math.abs(ddx), ady = Math.abs(ddy);
        const t1 = Math.min(
          adx > 0 ? (fw/2) / adx : Infinity,
          ady > 0 ? (fh/2) / ady : Infinity,
        );
        x1 = cx1 + t1 * ddx; y1 = cy1 + t1 * ddy;
      }
      if (!toA) {
        const adx = Math.abs(ddx), ady = Math.abs(ddy);
        const t2 = Math.min(
          adx > 0 ? (tw/2) / adx : Infinity,
          ady > 0 ? (th/2) / ady : Infinity,
        );
        x2 = cx2 - t2 * ddx; y2 = cy2 - t2 * ddy;
      }
      effectiveStructure = '';
    } else if (pathType !== 'straight') {
      // 構造ごとに固定方向を決定。構造なしの場合だけ gap ベースで自動判定。
      // logic / timeline / mindmap: 左右方向
      // orgchart / flowchart / tree: 上下方向
      // 構造なし: カード間 gap が大きい軸を採用
      const HORIZONTAL_STRUCTURES = new Set(['logic', 'timeline', 'mindmap']);
      const VERTICAL_STRUCTURES = new Set(['orgchart', 'flowchart', 'tree']);
      let useHorizontal;
      if (HORIZONTAL_STRUCTURES.has(st)) useHorizontal = true;
      else if (VERTICAL_STRUCTURES.has(st)) useHorizontal = false;
      else {
        const hGap = ddx >= 0 ? tp.x - (fp.x + fw) : fp.x - (tp.x + tw);
        const vGap = ddy >= 0 ? tp.y - (fp.y + fh) : fp.y - (tp.y + th);
        useHorizontal = hGap >= vGap;
      }
      if (useHorizontal) {
        // 左右辺の中央 + 水平方向に軸 gap を適用 (y はカード中心を維持)
        effectiveStructure = 'logic';
        if (ddx >= 0) { x1 = fp.x + fw + GAP; x2 = tp.x - GAP; }
        else { x1 = fp.x - GAP; x2 = tp.x + tw + GAP; }
        y1 = cy1; y2 = cy2;
      } else {
        // 上下辺の中央 + 垂直方向に軸 gap を適用 (x はカード中心を維持)
        effectiveStructure = 'flowchart';
        if (ddy >= 0) { y1 = fp.y + fh + GAP; y2 = tp.y - GAP; }
        else { y1 = fp.y - GAP; y2 = tp.y + th + GAP; }
        x1 = cx1; x2 = cx2;
      }
    } else {
      // 直線: カード中心を結ぶ直線を矩形でクリップ → 中心ベクトル沿いに gap
      const adx = Math.abs(ddx), ady = Math.abs(ddy);
      const t1 = Math.min(
        adx > 0 ? (fw/2) / adx : Infinity,
        ady > 0 ? (fh/2) / ady : Infinity,
      );
      const t2 = Math.min(
        adx > 0 ? (tw/2) / adx : Infinity,
        ady > 0 ? (th/2) / ady : Infinity,
      );
      x1 = cx1 + t1 * ddx;
      y1 = cy1 + t1 * ddy;
      x2 = cx2 - t2 * ddx;
      y2 = cy2 - t2 * ddy;
      const innerLen = Math.hypot(x2 - x1, y2 - y1);
      if (innerLen > 0) {
        const unitX = (x2 - x1) / innerLen;
        const unitY = (y2 - y1) / innerLen;
        const gap = Math.min(GAP, Math.max(0, innerLen / 2 - 2));
        x1 += unitX * gap;
        y1 += unitY * gap;
        x2 -= unitX * gap;
        y2 -= unitY * gap;
      }
    }
    }

    // v0.5.250: 同じカードペア間に複数ラインがある場合、各ラインを区別するためのオフセット。
    // - 曲線 (curve): 端点はカード側で固定し、制御点 c1/c2 を垂直にシフトして曲線を上下 (または左右) に膨らませる。
    //   反対向きのラインが単純に「双方向矢印」のように重なって見えないよう、反対向きは反対側に膨らむ。
    // - L 字 (orthogonal): 端点をカード出口方向の垂直軸にずらし、分岐部分が平行になるようにする。
    // - 直線 (straight): ライン方向に垂直な単位ベクトルで両端をシフトする。
    const sib = _bdConnSiblingInfo(c);
    let sibBulge = 0;
    // v0.5.320: アンカー指定あり or curve 手動モード (controlPoints あり) では兄弟オフセットを無効化
    // (アンカー + controlPoints で区別するため)。また自己ループもスキップ。
    // v0.5.327: 自動アンカーには sibling offset を適用 (hasUserAnchor を使う)。
    const curveManual = pathType === 'curve' && Array.isArray(c.controlPoints) && c.controlPoints.length === 2;
    if (sib.count > 1 && !(ddx === 0 && ddy === 0) && !hasUserAnchor && !curveManual) {
      const SIBLING_GAP = Math.max(14, strokeWidth * 3 + 6);
      const offsetAmount = (sib.index - (sib.count - 1) / 2) * SIBLING_GAP;
      if (pathType === 'curve') {
        // 曲線: 端点は動かさず、制御点を垂直方向に膨らませて区別する (index ベースで
        // 自然に反対方向に膨らむ)。オフセットは端点シフト (2倍) の半分で丁度良い見た目に。
        sibBulge = offsetAmount * 2;
      } else if (pathType === 'orthogonal') {
        if (effectiveStructure === 'logic') {
          y1 += offsetAmount; y2 += offsetAmount;
        } else {
          x1 += offsetAmount; x2 += offsetAmount;
        }
      } else {
        // straight: 直線の両端点をライン方向に垂直にシフトする。
        // ただし conn の向き (from→to) が逆だと perpendicular の符号が反転し、
        // offsetAmount も index で符号反転するため、結果として A→B と B→A が「同じ側」に
        // シフトして重なる。これを防ぐため、perpendicular を「世界座標で常に同じ向き」に正規化する
        // (perpY > 0 または perpY === 0 なら perpX > 0 を canonical とする)。
        const sdx = x2 - x1, sdy = y2 - y1;
        const slen = Math.hypot(sdx, sdy);
        if (slen > 0) {
          let perpX = -sdy / slen;
          let perpY = sdx / slen;
          if (perpY < 0 || (perpY === 0 && perpX < 0)) { perpX = -perpX; perpY = -perpY; }
          const ox = offsetAmount * perpX;
          const oy = offsetAmount * perpY;
          x1 += ox; y1 += oy; x2 += ox; y2 += oy;
        }
      }
    }

    // 始点・終点のみでパス生成 (曲げポイントは v0.5.177 で廃止)
    const pts = [{x:x1,y:y1}, {x:x2,y:y2}];
    const pathData = _bdBuildConnectionPathData(c, pts, effectiveStructure, connStyle, sibBulge, {
      from: fromA, to: toA,
      fromOut: autoFromOut, toOut: autoToOut,
    });
    d = pathData.d;

    const p = document.createElementNS('http://www.w3.org/2000/svg','path');
    p.classList.add('bd-conn-path');
    p.dataset.connId = c.id;
    if (bdIsConnectionSelected(c.id)) p.classList.add('bd-selected');
    p.setAttribute('d', d);
    p.setAttribute('id', `bd-path-${c.id}`);
    p.setAttribute('stroke-linecap', hasArrow ? 'butt' : 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.style.strokeWidth = strokeWidth + 'px';
    if (connStyle.style === 'dashed') p.style.strokeDasharray = '6 3';
    if (connStyle.color) p.style.stroke = connStyle.color;
    if (c.hidden) {
      p.classList.add('bd-conn-hidden');
      p.style.opacity = '0.18';
      if (!p.style.strokeDasharray) p.style.strokeDasharray = '3 5';
    }
    if (hasArrow) {
      const arrowColor = connStyle.color || 'var(--accent2, var(--accent))';
      // v0.5.331: 矢印は全 pathType で SVG の path 接線方向に自動追従 (auto-start-reverse)。
      // 旧実装では曲線/直角線/ベジェで「カード中心への固定角度」を使い、4 方向時代の見た目に
      // 揃えていたが、これが原因でハンドル調整や斜め配置時に矢印向きがラインと乖離していた。
      // auto-start-reverse に統一することで、曲線のベジェ接線・直角線の終端 segment 方向・
      // 直線の方向すべてに矢印がなめらかに追従する (= 8 方向含む任意方向に対応)。
      const markerRef = _bdEnsureArrowMarker(defs, `bd-arrow-${c.id}`, arrowColor, strokeWidth, undefined, c.id);
      if (arrow === 'start' || arrow === 'both') p.setAttribute('marker-start', markerRef);
      if (arrow === 'end' || arrow === 'both') p.setAttribute('marker-end', markerRef);
    }
    svg.appendChild(p);
    const centerMeta = _bdMeasureConnectionCenter(p, pathData.pathPoints, pathType, pathData.labelPoint);
    _bdAppendLineCommentBadge(c, centerMeta.point);
    if (bdIsConnectionSelected(c.id)) {
      const selectionBaseWidth = strokeWidth + 12 / zoom;
      const selectionAccentWidth = strokeWidth + 6 / zoom;
      // スタイルタブで設定されたボード全体の選択色 (bd._fileStyle['--bd-selection-color']) を取得し、
      // 70% 不透明度に変換して適用。未設定時は CSS フォールバック色が効くので stroke 属性はセットしない。
      const boardSelRaw = (bd._fileStyle && bd._fileStyle['--bd-selection-color']) || '';
      const lineSel = boardSelRaw ? _bdToSelectionRgba(boardSelRaw) : '';
      const selectionBase = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      selectionBase.classList.add('bd-conn-selection', 'bd-conn-selection-back');
      selectionBase.id = `bd-sel-back-${c.id}`;
      selectionBase.dataset.connId = c.id;
      selectionBase.setAttribute('d', d);
      selectionBase.setAttribute('stroke-width', selectionBaseWidth);
      selectionBase.setAttribute('stroke-linecap', hasArrow ? 'butt' : 'round');
      svg.appendChild(selectionBase);
      const selectionAccent = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      selectionAccent.classList.add('bd-conn-selection', 'bd-conn-selection-front');
      selectionAccent.id = `bd-sel-front-${c.id}`;
      selectionAccent.dataset.connId = c.id;
      selectionAccent.setAttribute('d', d);
      selectionAccent.setAttribute('stroke-width', selectionAccentWidth);
      selectionAccent.setAttribute('stroke-linecap', hasArrow ? 'butt' : 'round');
      selectionAccent.setAttribute('stroke-dasharray', `${10 / zoom} ${7 / zoom}`);
      if (lineSel) selectionAccent.setAttribute('stroke', lineSel);
      svg.appendChild(selectionAccent);
      const endpoints = [pathData.pathPoints[0], pathData.pathPoints[pathData.pathPoints.length - 1]];
      const endpointSize = Math.max(4 / zoom, strokeWidth * 0.45 + 4 / zoom);
      // ハンドル参照を保持しておき、hit 追加後に再 append してポインタ優先度を最前面に戻す。
      // SVG は後勝ちで描画・ヒットテストされるため、`.bd-conn-hit` (16px ストローク) を後から
      // append すると端点ハンドルを覆ってしまう。保存して後段で再 append する。
      const _selTopRefs = [];
      endpoints.forEach((point, idx) => {
        const handle = _bdAppendConnectionSelectionHandle(svg, point, endpointSize, zoom, 'end');
        if (handle) handle.dataset.connId = c.id;
        // Phase 3: 端点ドラッグで接続先カードを変更
        if (handle && typeof _bdBindConnectionEndpointDrag === 'function') {
          _bdBindConnectionEndpointDrag(handle, c, idx === 0 ? 'from' : 'to');
        }
        if (handle) _selTopRefs.push(handle);
      });
      // v0.5.325: 中心の ◇ 装飾ハンドルを削除。
      // ドラッグ機能は持たせていなかったため、ユーザーが誤って掴もうとすると
      // 代わりに「…」アクションボタンが出るだけで混乱を招いていた。
      // 選択状態は端点●ハンドルと選択ライン (破線オーバーレイ) で十分表現できる。
      // v0.5.320: 曲線選択時は常にアンカー候補 + 制御点ハンドルを表示。
      // controlPoints 未定義でも _bdResolveControlPoints で自動算出され、
      // ハンドルドラッグで _bdRenderFreeBezierEditOverlay 内の保存処理により手動モードへ自動切替。
      if (pathType === 'curve' && fn && tn) {
        _bdRenderFreeBezierEditOverlay(svg, c, pathData, fn, tn, fe, te, fp, tp, zoom, {
          from: fromA, to: toA,
          fromOut: autoFromOut, toOut: autoToOut,
        });
      }
      // hit append の後でこのスコープは閉じるので、re-append は後続 `svg.appendChild(hit)` の
      // 直後に行う (下の `_selTopRefs` 参照)。ブロック外に変数を持ち出せないため、var で
      // 宣言して巻き上げる必要がある。旧コードでは const だったが、下段で参照するため let に変更。
      _lineSelTopRefs = _selTopRefs;
    }

    // ヒット領域
    const hit = document.createElementNS('http://www.w3.org/2000/svg','path');
    hit.setAttribute('d', d);
    hit.classList.add('bd-conn-hit');
    hit.dataset.connId = c.id;
    if (bdIsConnectionSelected(c.id)) hit.classList.add('bd-selected');
    hit._connData = c; hit._connId = c.id; hit._x1=x1; hit._y1=y1; hit._x2=x2; hit._y2=y2;
    hit.addEventListener('contextmenu', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (bd._rightPanMoved) { bd._rightPanMoved = false; return; }
      bdConnContextMenu(ev, c);
    });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(hit, (ev) => bdConnContextMenu(ev, c));
    }
    hit.addEventListener('mouseenter', () => {
      _showConnActionBtn(c, centerMeta.point);
    });
    hit.addEventListener('mouseleave', (e) => {
      // マウスがボタン（またはその子）へ移動した場合は hide をスキップ。
      // 80ms タイマーとボタン pointerenter の順序によっては、先に timer がセットされた後
      // pointerenter が発火しないケースがあり得るため、移動先を事前に確認して防ぐ。
      const btn = document.getElementById('bd-conn-action-btn');
      if (btn && e.relatedTarget && (btn === e.relatedTarget || btn.contains(e.relatedTarget))) return;
      _bdConnActionBtnHideTimer = setTimeout(_removeConnActionBtn, 80);
    });
    hit.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // Phase 4: Ctrl/Meta + クリックで選択追加/削除
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey) {
        bdEnsureConnectionSelectionState();
        if (bd.selectedConnIds.has(c.id)) {
          bdRemoveConnectionFromSelection(c.id);
        } else {
          bd.selectedConnIds.add(c.id);
        }
        bdDrawConns({ connIds: [c.id], reason: 'conn-toggle-select' });
        if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(bd.selectedConnIds.size === 0 && bd.selected.size === 0);
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey) return;
      if (typeof bdSelectConnection === 'function') bdSelectConnection(c.id);
    });
    hit.addEventListener('dblclick', (ev) => {
      // Ctrl / Shift / Meta + ダブルクリックは編集に入らない (Phase 5-1)
      if (ev.ctrlKey || ev.shiftKey || ev.metaKey) return;
      // ラベル非表示中のラインはラベル編集不可
      if (connStyle.textVisible === false || (bd.displayFilters && bd.displayFilters.showConnLabels === false)) return;
      ev.stopPropagation();
      // 空ラベルの場合はプレースホルダだけ仮設定し、編集モードに入る。
      // ユーザーが ESC キャンセルしたときにプレースホルダが残らないよう、
      // bdEditConnLabel 側で「編集前の原値」を復元できるよう _labelWasEmpty を記録
      const wasEmpty = !c.label;
      if (wasEmpty) c.label = 'テキスト';
      c._labelWasEmpty = wasEmpty;
      c._labelPlaceholderUndoCaptured = false;
      bdDrawConns({ connIds: [c.id], reason: 'conn-dblclick-label' });
      // ユーザーが確定するまで永続化せず、編集後の bdEditConnLabel 内でのみ bdDirty を呼ぶ
      bdEditConnLabel(c);
    });
    svg.appendChild(hit);
    // 2026-04-18: hit は 16px 透明ストロークで端点位置も覆ってしまうため、選択 UI
    // (端点ハンドル / 中央ハンドル) は hit の後に re-append して最前面に持ち上げる。
    // これがないと端点ドラッグのポインターイベントを hit が奪って始点側がドラッグできない。
    _lineSelTopRefs.forEach(el => { try { svg.appendChild(el); } catch {} });

    // ラインテキスト — HTMLオーバーレイで配置（インライン編集対応）
    // textVisible=false の場合はラベルを描画しない (Phase 5-3)。
    // textAlongPath=true の時は SVG textPath モードで沿線回転させる (Phase 5-2)。
    // ただし編集中 (c._editingInline) は HTML モードに一時切替 (contentEditable は div のみ有効)。
    const labelVisible = (bd.displayFilters && bd.displayFilters.showConnLabels === false) !== true
      && !c.hidden
      && c.label
      && connStyle.textVisible !== false;
    if (labelVisible && connStyle.textAlongPath && !c._editingInline) {
      // --- SVG textPath モード ---
      const ns = 'http://www.w3.org/2000/svg';
      const textEl = document.createElementNS(ns, 'text');
      textEl.classList.add('bd-conn-label-path');
      textEl.dataset.connId = c.id;
      textEl.dataset.lineStyleId = lineStyleId;
      if (depthLineStyleIndex) textEl.dataset.depthLineStyleIndex = depthLineStyleIndex;
      textEl.setAttribute('text-anchor', 'middle');
      textEl.setAttribute('dominant-baseline', 'middle');
      textEl.style.fontSize = '13px';
      textEl.style.fontFamily = 'var(--bd-style-font-family, var(--bd-default-font-family, var(--bd-theme-font-family, var(--ui-font, inherit))))';
      textEl.style.cursor = 'text';
      if (connStyle.fontBold) textEl.style.fontWeight = 'bold';
      if (connStyle.fontItalic) textEl.style.fontStyle = 'italic';
      // 縁取り (paint-order stroke): textShadowWidth > 0 のときだけ描画。
      // 2026-04-18: SVG の `fill` 属性は CSS `#bd-svg .bd-conn-label-path { fill: var(--fg) }` に
      // 上書きされるため、`style.fill` (CSS ルール優先の inline スタイル) で設定する必要がある。
      // stroke も同様に CSS 経由で上書きされる可能性があるため、style 経由で設定する。
      const shadowW = Math.max(0, +connStyle.textShadowWidth || 0);
      if (shadowW > 0) {
        textEl.setAttribute('paint-order', 'stroke');
        textEl.style.stroke = connStyle.textShadowColor || 'rgba(255,255,255,0.85)';
        textEl.style.strokeWidth = String(shadowW * 2) + 'px';
        textEl.style.strokeLinejoin = 'round';
      }
      if (connStyle.labelTextColor) textEl.style.fill = connStyle.labelTextColor;
      const textPath = document.createElementNS(ns, 'textPath');
      textPath.setAttribute('href', `#bd-path-${c.id}`);
      textPath.setAttribute('startOffset', '50%');
      // textAutoFlip: ラインの中央接線角度が 90〜270° の時、side=right で逆向きに描画
      // SVG textPath の side 属性は大概の現行ブラウザで対応 (Chrome/Firefox/Safari)
      const angle = centerMeta?.angle ?? 0;
      const normalized = ((angle % 360) + 360) % 360;
      const isUpsideDown = normalized > 90 && normalized < 270;
      if (connStyle.textAutoFlip && isUpsideDown) {
        textPath.setAttribute('side', 'right');
      }
      // 複数行は 1 行目のみ表示 (計画書: 複数行非対応)
      const singleLine = c.label.split(/\r?\n/)[0];
      textPath.textContent = singleLine;
      textEl.appendChild(textPath);
      // インライン編集: ダブルクリックで HTML モードに切り替え → 編集 → SVG モードへ戻る
      textEl.addEventListener('dblclick', (ev) => {
        if (ev.ctrlKey || ev.shiftKey || ev.metaKey) return;
        ev.stopPropagation();
        c._editingInline = true;
        bdDrawConns({ connIds: [c.id], reason: 'conn-svg-label-edit' });
        if (typeof bdEditConnLabel === 'function') bdEditConnLabel(c);
      });
      svg.appendChild(textEl);
    } else if (labelVisible) {
      const lx = centerMeta.point?.x ?? pathData.labelPoint?.x ?? ((x1 + x2) / 2);
      const ly = centerMeta.point?.y ?? pathData.labelPoint?.y ?? ((y1 + y2) / 2);
      let labelAngle = connStyle.textRotate ? centerMeta.angle || 0 : 0;
      if (labelAngle > 90) labelAngle -= 180;
      if (labelAngle < -90) labelAngle += 180;
      const labelDiv = document.createElement('div');
      labelDiv.className = 'bd-conn-label';
      labelDiv.dataset.connId = c.id;
      labelDiv.dataset.lineStyleId = lineStyleId;
      if (depthLineStyleIndex) labelDiv.dataset.depthLineStyleIndex = depthLineStyleIndex;
      labelDiv.textContent = c.label;
      labelDiv.style.left = lx + 'px';
      labelDiv.style.top = ly + 'px';
      labelDiv.style.transform = `translate(-50%, -50%) rotate(${labelAngle}deg)`;
      // ラベルスタイル: 文字色 / 背景色 / 枠線色（未指定時は CSS デフォルト）
      // カスタム色を指定した場合、CSS の白縁 text-shadow とぶつかる（白文字が見えなくなる等）ため
      // 文字色または背景色が明示されたら text-shadow をクリアする。
      if (connStyle.labelTextColor) labelDiv.style.color = connStyle.labelTextColor;
      if (connStyle.labelBgColor) labelDiv.style.background = connStyle.labelBgColor;
      // labelBorderColor が明示指定されているときのみ borderColor / borderWidth を上書き。
      // labelBorderColor が空のときは CSS の `border: 1px solid transparent` を維持して
      // ホバー/編集中の border-color 切替が働くようにする。
      if (connStyle.labelBorderColor) {
        labelDiv.style.borderColor = connStyle.labelBorderColor;
        const borderW = Number.isFinite(+connStyle.labelBorderWidth)
          ? Math.max(0, Math.min(10, +connStyle.labelBorderWidth))
          : 1;
        labelDiv.style.borderWidth = borderW + 'px';
        labelDiv.style.borderStyle = borderW > 0 ? 'solid' : 'none';
      }
      if (connStyle.fontBold) labelDiv.style.fontWeight = 'bold';
      if (connStyle.fontItalic) labelDiv.style.fontStyle = 'italic';
      // 縁取 (text-shadow): textShadowWidth > 0 のときだけ 4 方向シャドウを適用。
      // 旧: labelTextColor / labelBgColor が設定されているとシャドウが消える挙動だったが、
      // ユーザーは 2 つの設定を独立して制御したいので、ガードを外す。
      // また旧 CSS 側の常時 8 方向 × 1px シャドウも削除済み (JS 側で一括管理)。
      const shadowW = Math.max(0, +connStyle.textShadowWidth || 0);
      if (shadowW > 0) {
        const w = shadowW;
        const sc = connStyle.textShadowColor || '#fff';
        labelDiv.style.textShadow = `-${w}px -${w}px 0 ${sc}, ${w}px -${w}px 0 ${sc}, -${w}px ${w}px 0 ${sc}, ${w}px ${w}px 0 ${sc}`;
      } else {
        labelDiv.style.textShadow = 'none';
      }
      const _enterLabelEditMode = () => {
        labelDiv.contentEditable = 'true';
        labelDiv.focus();
        const s = window.getSelection(), r = document.createRange();
        r.selectNodeContents(labelDiv); s.removeAllRanges(); s.addRange(r);
        labelDiv.style.pointerEvents = 'auto';
        const finish = () => {
          // 書式ポップアップ・カラーパレットが開いている間は編集を確定させない
          // (ポップアップ側の操作で一時的にラベルが blur しても編集継続)。
          if (document.querySelector('.gb-text-selection-fmt, .gb-fmt-popup, .gb-palette-popup')) {
            // 次回 blur に備えて再登録。ポップアップを閉じた後の blur で確定する。
            setTimeout(() => { if (labelDiv.isConnected) labelDiv.addEventListener('blur', finish, { once: true }); }, 0);
            return;
          }
          labelDiv.contentEditable = 'false';
          const beforeLabel = c.label || '';
          const nextLabel = labelDiv.textContent.trim() || '';
          if (nextLabel !== beforeLabel && typeof bdPushUndo === 'function') bdPushUndo();
          c.label = nextLabel;
          labelDiv.style.pointerEvents = '';
          if (nextLabel !== beforeLabel) bdDirty();
          if (!c.label) bdDrawConns({ connIds: [c.id], reason: 'conn-label-empty' });
        };
        labelDiv.onblur = finish;
        labelDiv.onkeydown = (ke) => { if (ke.key==='Enter'){ke.preventDefault();labelDiv.blur();} if(ke.key==='Escape'){labelDiv.textContent=c.label;labelDiv.blur();} ke.stopPropagation(); };
      };
      labelDiv.ondblclick = (ev) => {
        // Ctrl / Shift / Meta + ダブルクリックは編集に入らない (Phase 5-1 計画書: 複数選択モードを維持)
        if (ev.ctrlKey || ev.shiftKey || ev.metaKey) return;
        ev.stopPropagation();
        _enterLabelEditMode();
      };
      // 右クリックで編集モード + 全選択を発火し、選択範囲書式ポップアップを表示
      labelDiv.oncontextmenu = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _enterLabelEditMode();
        // 選択変更イベントで gb-text-selection-format のポップアップが開く
        setTimeout(() => {
          if (window.GBTextSelectionFormat?.openForSelection) {
            window.GBTextSelectionFormat.openForSelection();
          }
        }, 0);
      };
      document.getElementById('bd-nodes').appendChild(labelDiv);
    }
  });
  // 2026-04-18: 選択中ラインの始点/終点カードの .bd-anchor-hud を pointer-events: none にするため、
  // 該当カードに `bd-line-endpoint` クラスを同期付与する。これで新規ライン作成がスキップされ、
  // 端点ハンドルのドラッグが優先される。
  const _selConnIds = (bd.selectedConnIds instanceof Set) ? bd.selectedConnIds : new Set();
  const _endpointNodeIds = new Set();
  if (_selConnIds.size > 0) {
    bd.connections.forEach(c => {
      if (_selConnIds.has(c.id)) {
        if (c.from) _endpointNodeIds.add(c.from);
        if (c.to) _endpointNodeIds.add(c.to);
      }
    });
  }
  document.querySelectorAll('[data-bd-role="nodes"] .bd-node').forEach(el => {
    const id = (typeof el.id === 'string' && el.id.startsWith('bdn-')) ? el.id.slice(4) : '';
    el.classList.toggle('bd-line-endpoint', !!id && _endpointNodeIds.has(id));
  });
  // ライン選択中はアンカー内の「+」を隠す (アンカークリック = カード追加 ではなく元の接続モードに戻す)
  const _bdCanvasEl = document.getElementById('bd-canvas');
  if (_bdCanvasEl) _bdCanvasEl.classList.toggle('bd-has-conn-selection', _selConnIds.size > 0);
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdDrawConns', _bdDrawPerf, drawMeta);
}

// --- 選択 ---
function bdSelect(id, add) {
  const _bdSelectPerf = typeof bdPerfStart === 'function' ? bdPerfStart('bdSelect') : 0;
  const deferExtras = typeof bdShouldDeferBoardExtras === 'function' && bdShouldDeferBoardExtras();
  const previousSelected = new Set(bd.selected);
  const previousConnIds = (bd.selectedConnIds instanceof Set) ? [...bd.selectedConnIds] : [];
  _removeConnActionBtn();
  bdClearConnectionSelection();
  if (!add) bd.selected.clear();
  if (id) bd.selected.add(id);
  bd._activeNode = id || null;
  if (deferExtras) {
    const touched = previousSelected || new Set();
    if (id) touched.add(id);
    touched.forEach(nodeId => {
      const el = document.getElementById('bdn-' + nodeId);
      if (el) el.classList.toggle('bd-selected', bd.selected.has(nodeId));
    });
    if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([...touched], 'select');
    previousConnIds.forEach(connId => {
      if (typeof bdMarkConnectionDirty === 'function') bdMarkConnectionDirty(connId, 'select-clear-conn');
    });
  } else {
    document.querySelectorAll('.bd-node').forEach(el => {
      el.classList.toggle('bd-selected', bd.selected.has(el.id.replace('bdn-','')));
    });
  }
  if (deferExtras) {
    if (id && typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
    else if (id && typeof bdSyncSelectionRectForNode === 'function') bdSyncSelectionRectForNode(id);
  } else {
    const touched = new Set(previousSelected || []);
    if (id) touched.add(id);
    if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([...touched], 'select');
    else if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
    if (typeof bdSyncResizeHandleForNode === 'function') [...touched].forEach(nodeId => bdSyncResizeHandleForNode(nodeId));
    if (previousConnIds.length && typeof bdDrawConns === 'function') {
      bdDrawConns({ connIds: previousConnIds, reason: 'select-clear-conn' });
    }
  }
  if (!id && !add) {
    if (typeof bdCancelLinkedSelectionPreview === 'function') bdCancelLinkedSelectionPreview();
    if (typeof bdCancelLinkedSelectionSync === 'function') bdCancelLinkedSelectionSync();
  }
  if (add && bd.selected instanceof Set && bd.selected.size !== 1) {
    if (typeof bdCancelLinkedSelectionPreview === 'function') bdCancelLinkedSelectionPreview();
    if (typeof bdCancelLinkedSelectionSync === 'function') bdCancelLinkedSelectionSync();
  }
  if (deferExtras) {
    if (typeof bdMarkBoardUiDirty === 'function') bdMarkBoardUiDirty('select');
    else if (typeof bdRequestBoardExtras === 'function') bdRequestBoardExtras();
  } else if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(!id);
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdSelect', _bdSelectPerf);
}

function bdSelectConnection(connId) {
  if (bd.editing && typeof bdFinishEdit === 'function') bdFinishEdit();
  _removeConnActionBtn();
  const previousNodeIds = [...bd.selected];
  const previousConnIds = (bd.selectedConnIds instanceof Set) ? [...bd.selectedConnIds] : [];
  bd.selected.clear();
  bdSetConnectionSelection(connId ? [connId] : []);
  bd._activeNode = null;
  document.querySelectorAll('.bd-node').forEach(el => {
    el.classList.remove('bd-selected');
  });
  if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(previousNodeIds, 'select-connection');
  previousNodeIds.forEach(nodeId => {
    if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(nodeId);
  });
  if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
  const dirtyConnIds = [...new Set([...previousConnIds, connId].filter(Boolean))];
  if (dirtyConnIds.length && typeof bdDrawConns === 'function') bdDrawConns({ connIds: dirtyConnIds, reason: 'select-connection' });
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(!connId);
}

// --- 編集 ---
function bdEditNode(id) {
  const n = bd.nodes.find(v=>v.id===id); if (!n) return;
  bdSelect(id); bd.editing = id;
  const el = document.getElementById('bdn-'+id); if (!el) return;
  el.classList.add('bd-editing');
  // 編集中は `.bd-selection-rect` を `is-editing` 経由で隠すため、bd-editing クラス追加後に同期する
  if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
  else if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
  // 選択色・カーソル色はボード全体の CSS 変数が継承されるので、個別セット不要。
  const txt = el.querySelector('.bd-text');
  txt.innerHTML = esc(n.text).replace(/\n/g,'<br>');
  txt.contentEditable = 'true'; txt.focus();
  const s = window.getSelection(), r = document.createRange();
  r.selectNodeContents(txt); s.removeAllRanges(); s.addRange(r);
  // カスタムキャレット: ネイティブキャレットを透明化 (CSS) し、カーソル太さを変えられる擬似キャレットを重ねる。
  let caret = el.querySelector(':scope > .bd-custom-caret');
  if (!caret) { caret = document.createElement('div'); caret.className = 'bd-custom-caret'; el.appendChild(caret); }
  let _caretMeasuring = false;
  const updateCaret = () => {
    if (_caretMeasuring) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { caret.style.display = 'none'; return; }
    const origRange = sel.getRangeAt(0);
    if (!txt.contains(origRange.endContainer) && origRange.endContainer !== txt) {
      caret.style.display = 'none'; return;
    }
    const range = origRange.cloneRange();
    range.collapse(false);
    let rect = range.getClientRects()[0];
    if (!rect || (rect.width === 0 && rect.height === 0)) rect = range.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const zoom = (typeof bd !== 'undefined' && bd.zoom) ? bd.zoom : 1;
    if (!rect || (!rect.height && !rect.width)) {
      // <br> 直後など collapsed range が矩形を返さないケース: ゼロ幅マーカーを一瞬挿入して測定
      _caretMeasuring = true;
      const savedStart = { c: origRange.startContainer, o: origRange.startOffset };
      const savedEnd = { c: origRange.endContainer, o: origRange.endOffset };
      const marker = document.createTextNode('\u200b');
      let measured = null;
      try {
        range.insertNode(marker);
        const mRange = document.createRange();
        mRange.selectNode(marker);
        measured = mRange.getBoundingClientRect();
      } catch {}
      const parent = marker.parentNode;
      if (parent) parent.removeChild(marker);
      try {
        const restored = document.createRange();
        restored.setStart(savedStart.c, savedStart.o);
        restored.setEnd(savedEnd.c, savedEnd.o);
        sel.removeAllRanges();
        sel.addRange(restored);
      } catch {}
      _caretMeasuring = false;
      if (measured && (measured.height || measured.width)) {
        caret.style.left = ((measured.left - elRect.left) / zoom) + 'px';
        caret.style.top = ((measured.top - elRect.top) / zoom) + 'px';
        caret.style.height = (measured.height || 18) + 'px';
      } else {
        const tr = txt.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(txt).lineHeight) || 20;
        caret.style.left = ((tr.left - elRect.left) / zoom) + 'px';
        caret.style.top = ((tr.top - elRect.top) / zoom) + 'px';
        caret.style.height = lh + 'px';
      }
    } else {
      caret.style.left = ((rect.left - elRect.left) / zoom) + 'px';
