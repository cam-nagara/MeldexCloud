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
    rect.setAttribute('stroke-width', Math.max(1, 2 / bdSafeZoom(zoom)));
    svg.appendChild(rect);
    return rect;
  }
  const circle = document.createElementNS(ns, 'circle');
  circle.classList.add('bd-conn-selection-handle', 'bd-conn-selection-end');
  circle.setAttribute('cx', point.x);
  circle.setAttribute('cy', point.y);
  circle.setAttribute('r', size);
  circle.setAttribute('stroke-width', Math.max(1, 1.5 / bdSafeZoom(zoom)));
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
  const pathType = _bdLinePathType(connStyle, structure);
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
  const manualControlPoints = typeof bdNormalizeConnectionControlPoints === 'function'
    ? bdNormalizeConnectionControlPoints(conn?.controlPoints)
    : null;
  const applyCurveBulge = (cp1, cp2) => {
    if (!bulge) return { cp1, cp2, labelPoint: _bdCubicBezierPoint(start, cp1, cp2, end, 0.5) };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (!len) return { cp1, cp2, labelPoint: _bdCubicBezierPoint(start, cp1, cp2, end, 0.5) };
    let perpX = -dy / len;
    let perpY = dx / len;
    if (perpY < 0 || (perpY === 0 && perpX < 0)) { perpX = -perpX; perpY = -perpY; }
    const nextCp1 = { x: cp1.x + perpX * bulge, y: cp1.y + perpY * bulge };
    const nextCp2 = { x: cp2.x + perpX * bulge, y: cp2.y + perpY * bulge };
    const labelPoint = _bdCubicBezierPoint(start, nextCp1, nextCp2, end, 0.5);
    return { cp1: nextCp1, cp2: nextCp2, labelPoint };
  };
  // v0.5.320: 曲線で conn.controlPoints がある = 手動モード (旧 free-bezier 相当)。
  // 手動モード時はアンカーと controlPoints で経路を完全指定、bulge は無視する。
  if (pathType === 'curve' && manualControlPoints) {
    const cps = manualControlPoints;
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
        let fA = resolvedFromAnchor || '';
        let tA = resolvedToAnchor || '';
        if (!fA && !tA) {
          fA = 'top-center';
          tA = 'left-center';
        } else if (!fA) {
          fA = isTop(tA) ? 'bottom-center'
            : isBottom(tA) ? 'top-center'
            : isRight(tA) ? 'left-center'
            : 'right-center';
        } else if (!tA) {
          tA = isTop(fA) ? 'bottom-center'
            : isBottom(fA) ? 'top-center'
            : isLeft(fA) ? 'right-center'
            : 'left-center';
        }
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
        // v0.5.334: L 字 2 段迂回。ユーザーが選んだ自己ループ端点の外側を回る。
        // 迂回距離をカード寸法に応じて拡大。小さいカードでも最低 60px の隙間を確保。
        const LOOP_PAD = Math.max(60, Math.min(w, h) * 0.8);
        const x0 = node.x, y0 = node.y;
        const x1 = x0 + w, y1 = y0 + h;
        const fromVec = _bdAnchorOutwardVector(resolvedFromAnchor || 'top-center');
        const toVec = _bdAnchorOutwardVector(resolvedToAnchor || 'left-center');
        const primary = (vec) => Math.abs(vec.x) >= Math.abs(vec.y)
          ? { x: Math.sign(vec.x) || 1, y: 0 }
          : { x: 0, y: Math.sign(vec.y) || -1 };
        const fv = primary(fromVec);
        const tv = primary(toVec);
        const outside = (point, vec) => ({ x: point.x + vec.x * LOOP_PAD, y: point.y + vec.y * LOOP_PAD });
        const p1 = outside(start, fv);
        const p4 = outside(end, tv);
        const sameHorizontal = Math.abs(p1.y - p4.y) < 0.01;
        const sameVertical = Math.abs(p1.x - p4.x) < 0.01;
        let middle;
        if (sameHorizontal && p1.y > y0 - 1 && p1.y < y1 + 1) {
          const y = Math.min(y0 - LOOP_PAD, p1.y - LOOP_PAD);
          middle = [{ x: p1.x, y }, { x: p4.x, y }];
        } else if (sameVertical && p1.x > x0 - 1 && p1.x < x1 + 1) {
          const x = Math.min(x0 - LOOP_PAD, p1.x - LOOP_PAD);
          middle = [{ x, y: p1.y }, { x, y: p4.y }];
        } else if (sameHorizontal || sameVertical) {
          middle = [];
        } else {
          middle = [{ x: p4.x, y: p1.y }];
        }
        const pathPoints = [start, p1, ...middle, p4, end];
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
      const baseCp1 = { x: start.x + cps[0].dx, y: start.y + cps[0].dy };
      const baseCp2 = { x: end.x + cps[1].dx, y: end.y + cps[1].dy };
      const { cp1, cp2, labelPoint } = applyCurveBulge(baseCp1, baseCp2);
      return {
        d: `M${start.x},${start.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${end.x},${end.y}`,
        pathPoints: [start, end],
        labelPoint,
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
