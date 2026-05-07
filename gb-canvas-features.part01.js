/* gb-canvas-features.part01.js */
/* gb-canvas-features.js: Canvas Features & Context Menus (v5.0 Phase C) */

// --- 1. Layout Algorithms ---
// 2026-04-18: デフォルト値 (スタイルタブ未設定時)。実際の値は bdLayoutGaps() 経由で bd.gapSiblings / bd.gapLevels を優先参照する。
const BD_LAYOUT_GAP_SIBLINGS_DEFAULT = 10;
const BD_LAYOUT_GAP_LEVELS_DEFAULT = 30;
function bdLayoutGaps() {
  // 注意: null / undefined を明示的に除外する。+null === 0 かつ null >= 0 === true のため、
  // Number.isFinite(+v) && v >= 0 だけだと null が 0 として採用されてしまい gap=0 になる。
  // 参照優先順: bd.* (ファイル固有値) > テーマ :root 値 > デフォルト
  const hasBd = typeof bd !== 'undefined';
  const gs = hasBd ? bd.gapSiblings : undefined;
  const gl = hasBd ? bd.gapLevels : undefined;
  const themeGs = typeof getCssVar === 'function' ? parseFloat(getCssVar('--bd-gap-siblings')) : NaN;
  const themeGl = typeof getCssVar === 'function' ? parseFloat(getCssVar('--bd-gap-levels')) : NaN;
  const s = (gs !== null && gs !== undefined && Number.isFinite(+gs) && +gs >= 0) ? +gs
    : (Number.isFinite(themeGs) && themeGs >= 0) ? themeGs
    : BD_LAYOUT_GAP_SIBLINGS_DEFAULT;
  const l = (gl !== null && gl !== undefined && Number.isFinite(+gl) && +gl >= 0) ? +gl
    : (Number.isFinite(themeGl) && themeGl >= 0) ? themeGl
    : BD_LAYOUT_GAP_LEVELS_DEFAULT;
  return { sibling: s, level: l };
}

function _bdCreateLayoutContext() {
  const nodeById = new Map();
  const childrenByParent = new Map();
  bd.nodes.forEach(n => {
    nodeById.set(n.id, n);
    const parentId = n.parent || '';
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(n);
  });
  const children = id => childrenByParent.get(id) || [];
  const descendants = rootId => {
    const result = [];
    const collect = id => {
      children(id).forEach(child => {
        result.push(child.id);
        collect(child.id);
      });
    };
    collect(rootId);
    return result;
  };
  return {
    node: id => nodeById.get(id) || null,
    children,
    descendants,
  };
}

// 構造が設定された「中間カード」(= outermost 以外の structure-set ノード) を外側レイアウトから
// 見て「1 枚の箱」として扱うためのフラグ。bdAutoLayout が各レイアウト呼び出しの前後で set/clear する。
// _bdLayoutHorizontalTree / _bdLayoutVerticalTree / bdLayoutMindmap / bdLayoutTimeline がこの集合を
// 参照し、該当ノードへの再帰を打ち切って sizes[nid] (= サブツリー bounding box) をそのまま使う。
let _bdLayoutInnerStructureSet = null;
function _bdIsInnerStructureAtomic(nid, currentRootId) {
  return !!(_bdLayoutInnerStructureSet && nid !== currentRootId && _bdLayoutInnerStructureSet.has(nid));
}

// rootId サブツリー内で、rootId から子方向に辿って最初に遭遇する innerSet 要素 (= rootId にとっての
// 「直下レベル」の中間カード) の一覧を返す。より深い中間カードは直下の innerPositions.descendants に
// 既に最終位置で含まれているため、外側が再度翻訳するのは二重適用になる。本関数で得た直下レベル
// のみを翻訳することで二重適用を防ぐ。
function _bdDirectInnerDescendants(rootId, innerSet, layoutCtx) {
  const result = [];
  const seen = new Set([rootId]);
  const visit = (nid) => {
    layoutCtx.children(nid).forEach(ch => {
      if (seen.has(ch.id)) return;
      seen.add(ch.id);
      if (innerSet.has(ch.id)) result.push(ch.id);
      else visit(ch.id);
    });
  };
  visit(rootId);
  return result;
}

// 中間カード (sid) を仮ルート (0,0) としてサブツリーをレイアウトし、
// bounding box と 各ノードの bbox 相対位置を計測する。
// さらに深い中間カード (tid) が sid の子孫にあれば、それらは既に post-order で計測済みの前提で、
// sid のレイアウト後に「直下レベルの tid」だけ tid の位置に合わせてサブツリーを平行移動する。
// (深い tid は直下レベルの innerPositions.descendants に既に最終位置で含まれているので再翻訳しない)
function _bdMeasureInnerStructure(sid, sizes, layoutCtx, innerSet, innerPositions) {
  const snode = layoutCtx.node(sid); if (!snode) return;
  snode.x = 0; snode.y = 0;
  const prevSet = _bdLayoutInnerStructureSet;
  _bdLayoutInnerStructureSet = innerSet;
  try {
    if (snode.structure === 'mindmap') bdLayoutMindmap(snode, sizes, layoutCtx);
    else if (snode.structure === 'flowchart') bdLayoutFlowchart(snode, sizes, layoutCtx);
    else if (snode.structure === 'logic') bdLayoutLogic(snode, sizes, layoutCtx);
    else if (snode.structure === 'timeline') bdLayoutTimeline(snode, sizes, layoutCtx);
    else if (snode.structure === 'orgchart') bdLayoutOrgChart(snode, sizes, layoutCtx);
    else if (snode.structure === 'tree') bdLayoutTree(snode, sizes, layoutCtx);
  } finally {
    _bdLayoutInnerStructureSet = prevSet;
  }
  // sid の直下レベルの中間カード (tid) だけを、sid のレイアウトで設定された tid の位置に合わせて
  // サブツリーごと平行移動する。tid 内部のさらに深い中間カード (uid) は、tid の innerPositions
  // に最終位置で含まれているので、ここで tid を翻訳すると uid も一緒に正しい位置に動く。
  _bdDirectInnerDescendants(sid, innerSet, layoutCtx).forEach(tid => {
    const tnode = layoutCtx.node(tid);
    const tinfo = innerPositions.get(tid);
    if (!tinfo || !tnode) return;
    const tx = tnode.x, ty = tnode.y;
    tnode.x = tx + tinfo.self.x;
    tnode.y = ty + tinfo.self.y;
    tinfo.descendants.forEach((pos, did) => {
      const dn = layoutCtx.node(did);
      if (dn) { dn.x = tx + pos.x; dn.y = ty + pos.y; }
    });
  });
  // sid + その子孫の bbox を計測。
  const sidDescendants = layoutCtx.descendants(sid);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  [sid, ...sidDescendants].forEach(id => {
    const n = layoutCtx.node(id); if (!n) return;
    const w = sizes[id]?.w || 160, h = sizes[id]?.h || 36;
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + w > maxX) maxX = n.x + w;
    if (n.y + h > maxY) maxY = n.y + h;
  });
  const bboxW = Math.max(0, maxX - minX);
  const bboxH = Math.max(0, maxY - minY);
  // 各ノードの bbox 相対位置 (bbox 左上 = (0,0) とする座標系) を記録。
  const selfPos = { x: snode.x - minX, y: snode.y - minY };
  const descPos = new Map();
  sidDescendants.forEach(did => {
    const dn = layoutCtx.node(did);
    if (!dn) return;
    descPos.set(did, { x: dn.x - minX, y: dn.y - minY });
  });
  innerPositions.set(sid, { self: selfPos, descendants: descPos });
  // 外側から見た sid の「箱」サイズを上書きする。
  sizes[sid] = { w: bboxW, h: bboxH, _isSubtreeBox: true };
}

function bdAutoLayout(rootId) {
  const _bdLayoutPerf = typeof bdPerfStart === 'function' ? bdPerfStart('bdAutoLayout') : 0;
  const layoutCtx = _bdCreateLayoutContext();
  const root = layoutCtx.node(rootId);
  if (!root) {
    if (typeof bdPerfEnd === 'function') bdPerfEnd('bdAutoLayout', _bdLayoutPerf, 'skip');
    return;
  }
  // ツリー内 (ルート含む) で structure が明示設定されたノードを列挙。
  // 全ノードが '' なら「親に従う」= 自動整列なし → early return。
  const layoutIds = [rootId, ...layoutCtx.descendants(rootId)];
  const structureIds = layoutIds.filter(id => {
    const n = layoutCtx.node(id); return !!(n && n.structure);
  });
  if (!structureIds.length) {
    if (typeof bdPerfEnd === 'function') bdPerfEnd('bdAutoLayout', _bdLayoutPerf, 'skip');
    return;
  }
  // 自動スタイルが有効なら先にスタイル適用（サイズに影響するため）
  if (root._autoStyle) { bdApplyAutoStyle(rootId); bdRender(); }
  const sizes = {};
  layoutIds.forEach(id => {
    const el = document.getElementById('bdn-'+id);
    sizes[id] = { w: el?el.offsetWidth:160, h: el?el.offsetHeight:36 };
  });
  // 外側 structure-set ノード (= structureIds の中で、祖先に structure-set ノードがいないもの) を
  // 特定する。これが複数あれば各々独立に扱う。
  const structureIdSet = new Set(structureIds);
  // outermost = 祖先チェーンに別の structure-set ノードを含まないもの。
  // データ不整合で parent が循環している場合も無限ループしないよう seen で防御する。
  const outermostIds = structureIds.filter(id => {
    const seen = new Set([id]);
    let cur = layoutCtx.node(id)?.parent;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (structureIdSet.has(cur)) return false;
      cur = layoutCtx.node(cur)?.parent;
    }
    return true;
  });

  outermostIds.forEach(outermostId => {
    const outermost = layoutCtx.node(outermostId); if (!outermost) return;
    // 外側ノードから見て内側の structure-set ノード一覧 (= 中間カード) を pre-order で取得。
    const innerStructureIds = layoutCtx.descendants(outermostId).filter(id => structureIdSet.has(id));
    const innerSet = new Set(innerStructureIds);
    const innerPositions = new Map();
    // Pass 1 (post-order): 中間カードごとに、仮ルート (0,0) でサブツリーをレイアウトし bbox 計測。
    [...innerStructureIds].reverse().forEach(sid => {
      _bdMeasureInnerStructure(sid, sizes, layoutCtx, innerSet, innerPositions);
    });
    // Pass 2: 外側 structure のレイアウトを適用。中間カードは sizes[sid] = bbox を通じて
    // 「1 枚の箱」として扱われる。レイアウト前のルート位置は保存しておき、ルート自身が動いた場合は
    // サブツリー全体を平行移動して元の位置に戻す (下方ズレ防止)。
    const origX = outermost.x, origY = outermost.y;
    const prevSet = _bdLayoutInnerStructureSet;
    _bdLayoutInnerStructureSet = innerSet;
    try {
      if (outermost.structure === 'mindmap') bdLayoutMindmap(outermost, sizes, layoutCtx);
      else if (outermost.structure === 'flowchart') bdLayoutFlowchart(outermost, sizes, layoutCtx);
      else if (outermost.structure === 'logic') bdLayoutLogic(outermost, sizes, layoutCtx);
      else if (outermost.structure === 'timeline') bdLayoutTimeline(outermost, sizes, layoutCtx);
      else if (outermost.structure === 'orgchart') bdLayoutOrgChart(outermost, sizes, layoutCtx);
      else if (outermost.structure === 'tree') bdLayoutTree(outermost, sizes, layoutCtx);
    } finally {
      _bdLayoutInnerStructureSet = prevSet;
    }
    const dx = origX - outermost.x, dy = origY - outermost.y;
    if (dx || dy) {
      [outermostId, ...layoutCtx.descendants(outermostId)].forEach(id => {
        const n = layoutCtx.node(id); if (n) { n.x += dx; n.y += dy; }
      });
    }
    // Pass 3: outermost の直下レベルの中間カードだけを、bbox 左上 (= Pass 2 が設定した位置) から
    // bbox 相対位置で再配置する。それぞれの info.descendants には transitive な深い中間カードと
    // その子孫も既に最終位置で含まれているため、ここで Pass 3 を深い中間カードに再適用すると
    // info.self が二重適用されて位置がずれる。よって直下レベルに限定する。
    _bdDirectInnerDescendants(outermostId, innerSet, layoutCtx).forEach(sid => {
      const snode = layoutCtx.node(sid); if (!snode) return;
      const info = innerPositions.get(sid); if (!info) return;
      const sx = snode.x, sy = snode.y;
      snode.x = sx + info.self.x;
      snode.y = sy + info.self.y;
      info.descendants.forEach((pos, did) => {
        const dn = layoutCtx.node(did);
        if (dn) { dn.x = sx + pos.x; dn.y = sy + pos.y; }
      });
    });
  });
  layoutIds.forEach(id => {
    const n=layoutCtx.node(id), el=document.getElementById('bdn-'+id);
    if(n&&el){
      const left=n.x+'px', top=n.y+'px';
      if(el.style.left!==left) el.style.left=left;
      if(el.style.top!==top) el.style.top=top;
    }
  });
  const deferExtras = typeof bdShouldDeferBoardExtras === 'function' && bdShouldDeferBoardExtras();
  if (deferExtras) {
    if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(layoutIds, 'auto-layout');
    if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(layoutIds, 'auto-layout');
    if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true }, 'auto-layout');
    if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
    else if (typeof bdRequestBoardExtras === 'function') bdRequestBoardExtras();
  } else {
    bdDrawConns();
    // 選択中カードがレイアウトで動いた場合、`.bd-selection-rect` も追従させる
    if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
    bdDirty();
  }
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdAutoLayout', _bdLayoutPerf, `layoutNodes=${layoutIds.length}`);
}

// 水平ツリー (階層=水平、同階層=垂直)。logic レイアウトおよび mindmap 放射状の
// 各ブランチ (左右方向) で再利用する。
function _bdLayoutHorizontalTree(root, sizes, layoutCtx, opts) {
  const G = bdLayoutGaps();
  const direction = opts?.direction === 'left' ? -1 : 1; // 'right'=1, 'left'=-1
  const subtreeHeightCache = new Map();
  function subtreeH(nid) {
    if (subtreeHeightCache.has(nid)) return subtreeHeightCache.get(nid);
    // 中間カード (structure 設定済みの子孫) はサブツリー bbox サイズで atomic 扱い。
    if (_bdIsInnerStructureAtomic(nid, root.id)) {
      const leafH = sizes[nid]?.h || 36;
      subtreeHeightCache.set(nid, leafH);
      return leafH;
    }
    const ch = layoutCtx.children(nid);
    if (ch.length === 0) {
      const leafH = sizes[nid]?.h || 36;
      subtreeHeightCache.set(nid, leafH);
      return leafH;
    }
    let total = 0; ch.forEach(c => { total += subtreeH(c.id); });
    total += (ch.length - 1) * G.sibling;
    const value = Math.max(sizes[nid]?.h || 36, total);
    subtreeHeightCache.set(nid, value);
    return value;
  }
  function layout(nid, x, y) {
    const n = layoutCtx.node(nid); if (!n) return;
    const sh = subtreeH(nid);
    n.x = x; n.y = y + (sh - (sizes[nid]?.h || 36)) / 2;
    if (_bdIsInnerStructureAtomic(nid, root.id)) {
      // 中間カード: 「箱」の左上を (x, y) とし、中身 (子孫) への再帰はしない。
      // 最終位置は Pass 3 で bbox 相対位置から再配置される。
      return;
    }
    const ch = layoutCtx.children(nid);
    let cy = y;
    ch.forEach(c => {
      const childW = sizes[c.id]?.w || 160;
      const nextX = direction > 0
        ? x + (sizes[nid]?.w || 160) + G.level
        : x - G.level - childW;
      layout(c.id, nextX, cy);
      cy += subtreeH(c.id) + G.sibling;
    });
  }
  layout(root.id, root.x, root.y);
}

// 垂直ツリー (階層=垂直、同階層=水平)。flowchart レイアウトおよび mindmap 放射状の
// 各ブランチ (上下方向) で再利用する。
function _bdLayoutVerticalTree(root, sizes, layoutCtx, opts) {
  const G = bdLayoutGaps();
  const direction = opts?.direction === 'up' ? -1 : 1; // 'down'=1, 'up'=-1
  const subtreeWidthCache = new Map();
  function subtreeW(nid) {
    if (subtreeWidthCache.has(nid)) return subtreeWidthCache.get(nid);
    if (_bdIsInnerStructureAtomic(nid, root.id)) {
      const leafW = sizes[nid]?.w || 160;
      subtreeWidthCache.set(nid, leafW);
      return leafW;
    }
    const ch = layoutCtx.children(nid);
    if (ch.length === 0) {
      const leafW = sizes[nid]?.w || 160;
      subtreeWidthCache.set(nid, leafW);
      return leafW;
    }
    let total = 0; ch.forEach(c => { total += subtreeW(c.id); });
    total += (ch.length - 1) * G.sibling;
    const value = Math.max(sizes[nid]?.w || 160, total);
    subtreeWidthCache.set(nid, value);
    return value;
  }
  function layout(nid, x, y) {
    const n = layoutCtx.node(nid); if (!n) return;
    const sw = subtreeW(nid);
    n.x = x + (sw - (sizes[nid]?.w || 160)) / 2; n.y = y;
    if (_bdIsInnerStructureAtomic(nid, root.id)) {
      // 中間カード: sw == sizes[nid].w == bboxW なので n.x == x == bbox 左上。
      // Pass 3 が (sx, sy) = bbox 左上から bbox 相対位置で本来位置に再配置する。
      return;
    }
    const ch = layoutCtx.children(nid);
    let cx = x;
    ch.forEach(c => {
      const childH = sizes[c.id]?.h || 36;
      const nextY = direction > 0
        ? y + (sizes[nid]?.h || 36) + G.level
        : y - G.level - childH;
      layout(c.id, cx, nextY);
      cx += subtreeW(c.id) + G.sibling;
    });
  }
  layout(root.id, root.x, root.y);
}

function bdLayoutMindmap(root, sizes, layoutCtx) {
  // mindmap (放射状): 子カードを作成順に、時計回りで真右 (0°) 〜 真上の手前まで配置する。
  //   - 1 枚目は常に真右 (0°)
  //   - 2 枚目以降は、最後のカードが常に真上のちょうど手前 (360° の直前) に来るよう、
  //     N 枚あれば 0° から (360/N)° 刻みで時計回りに均等配置する。
  //     ( N=2:0°/180°、N=3:0°/120°/240°、… N=8:0°/45°/…/315°、N=9:0°/40°/…/320° )
  //   - 真右のカードは常に固定、カードごとの間隔を詰める形で右上 (ほぼ 360°) に向けて
  //     追加されていく。真上 (270°) 以降へ追加されて「二周目」に入ることはない。
  // 各子のサブツリーは方向に応じた水平/垂直ツリーで展開する。
  const G = bdLayoutGaps();
  const rootChildren = layoutCtx.children(root.id);
  if (rootChildren.length === 0) return;
  const rootW = sizes[root.id]?.w || 160;
  const rootH = sizes[root.id]?.h || 36;
  const rootCx = root.x + rootW / 2;
  const rootCy = root.y + rootH / 2;
  const N = rootChildren.length;

  // idx 番目 (0-indexed) の子カードの角度を算出する。
  // 最終インデックス (N-1) の角度が (N-1)/N * 360° = 360° - 360°/N となり、
  // 真上 (270°) を飛び越えて 360° = 0° の手前 (= 右上〜真右の間) に収まる。
  const ANGLE_STEP = N > 0 ? 360 / N : 0;
  function branchInfo(idx) {
    const angle = ANGLE_STEP * idx; // 0° = 真右、時計回り (下が +y)
    const rad = angle * Math.PI / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // サブツリー展開方向 (水平優勢 / 垂直優勢で 4 分割)。対角は水平側に倒す。
    const dir = (Math.abs(dx) >= Math.abs(dy))
      ? (dx >= 0 ? 'right' : 'left')
      : (dy >= 0 ? 'down' : 'up');
    return { dir, angle };
  }

  // 子中心までの距離（ルートエッジ〜子エッジ間に G.level の余白が入るよう計算）。
  // 長方形と原点からの半直線 (cos θ, sin θ) の交点距離は min(W/2/|cos|, H/2/|sin|)。
  // 真右 (θ=0) 等で sin=0 になる場合に備えて微小値でクランプする。
  function childCenterDistance(childId, angle) {
    const cw = sizes[childId]?.w || 160;
    const ch = sizes[childId]?.h || 36;
    const rad = angle * Math.PI / 180;
    const absDx = Math.max(Math.abs(Math.cos(rad)), 1e-3);
    const absDy = Math.max(Math.abs(Math.sin(rad)), 1e-3);
    const rootEdge = Math.min(rootW / 2 / absDx, rootH / 2 / absDy);
    const childEdge = Math.min(cw / 2 / absDx, ch / 2 / absDy);
    return rootEdge + G.level + childEdge;
  }

  // 角度差 ANGLE_STEP のときの 2 中心間距離 d* = 2 * r * sin(ANGLE_STEP/2) が
  // 両側のカード半対角の和 + gap を下回らない r を下限として確保する。
  // (全子カードのサイズのうち最大のものを基準にすることで、どの隣接ペアも重ならない)
  let maxHalfDiag = 0;
  rootChildren.forEach(c => {
    const cw = sizes[c.id]?.w || 160;
    const ch = sizes[c.id]?.h || 36;
    const hd = Math.hypot(cw, ch) / 2;
    if (hd > maxHalfDiag) maxHalfDiag = hd;
  });
  const halfStepRad = (ANGLE_STEP / 2) * Math.PI / 180;
  // N=1 のときは ANGLE_STEP=0 で sin(0)=0 になるため 0 除算回避で下限なし。
  const minRadiusForNoOverlap = (N >= 2)
    ? (maxHalfDiag + G.sibling / 2) / Math.sin(halfStepRad)
    : 0;

  rootChildren.forEach((child, idx) => {
    const { dir, angle } = branchInfo(idx);
    const rad = angle * Math.PI / 180;
    let dist = childCenterDistance(child.id, angle);
    // 隣接カード同士が重ならないよう、共通の下限半径を全カードに適用する
    // (真右のカードを固定しつつ、角度間隔が狭まる高 N でも重なりを回避する)。
    if (minRadiusForNoOverlap > dist) dist = minRadiusForNoOverlap;
    const cx = rootCx + Math.cos(rad) * dist;
    const cy = rootCy + Math.sin(rad) * dist;
    const cw = sizes[child.id]?.w || 160;
    const ch = sizes[child.id]?.h || 36;
    child.x = cx - cw / 2;
    child.y = cy - ch / 2;
    // 子が「中間カード」(= 独自 structure 設定済み) なら bbox サイズをここで
    // 配置しただけで打ち切る。中身は Pass 1 で計測済み、最終位置は Pass 3 で再配置される。
    if (_bdIsInnerStructureAtomic(child.id, root.id)) return;
    // 子サブツリーをブランチ方向に展開する（子自身を仮ルートとして使う）
    if (dir === 'right' || dir === 'left') {
      _bdLayoutHorizontalTree(child, sizes, layoutCtx, { direction: dir });
    } else {
      _bdLayoutVerticalTree(child, sizes, layoutCtx, { direction: dir });
    }
  });
}

function bdLayoutFlowchart(root, sizes, layoutCtx) {
  // flowchart / orgchart (垂直ツリー): 階層 = 垂直方向、同階層 = 水平方向
  _bdLayoutVerticalTree(root, sizes, layoutCtx, { direction: 'down' });
}

function bdLayoutLogic(root, sizes, layoutCtx) {
  // logic (水平ツリー): 階層 = 水平方向、同階層 = 垂直方向
  _bdLayoutHorizontalTree(root, sizes, layoutCtx, { direction: 'right' });
}

function bdLayoutTree(root, sizes, layoutCtx) {
  // tree: 親カードの直下に子カードを置き、階層ごとに右へインデントする。
  const G = bdLayoutGaps();
  const indent = Math.max(12, G.level);
  const rowGap = G.sibling;
  const subtreeHeightCache = new Map();
  function nodeH(nid) {
    return sizes[nid]?.h || 36;
  }
  function subtreeH(nid) {
    if (subtreeHeightCache.has(nid)) return subtreeHeightCache.get(nid);
    if (_bdIsInnerStructureAtomic(nid, root.id)) {
      const leafH = nodeH(nid);
      subtreeHeightCache.set(nid, leafH);
      return leafH;
    }
    const ch = layoutCtx.children(nid);
    let total = nodeH(nid);
    if (ch.length > 0) {
      total += rowGap;
      ch.forEach((child, idx) => {
        if (idx > 0) total += rowGap;
        total += subtreeH(child.id);
      });
    }
    subtreeHeightCache.set(nid, total);
    return total;
  }
  function layout(nid, x, y) {
    const n = layoutCtx.node(nid); if (!n) return;
    n.x = x; n.y = y;
    if (_bdIsInnerStructureAtomic(nid, root.id)) {
      return;
    }
    let cy = y + nodeH(nid) + rowGap;
    layoutCtx.children(nid).forEach(child => {
      layout(child.id, x + indent, cy);
      cy += subtreeH(child.id) + rowGap;
    });
  }
  layout(root.id, root.x, root.y);
}

function bdLayoutTimeline(root, sizes, layoutCtx) {
  // timeline: メインライン = 水平方向 (sibling)、各タイムポイント配下は垂直 (level)
  const G = bdLayoutGaps();
  const ch = layoutCtx.children(root.id);
  let x = root.x;
  root.y = root.y;
  ch.forEach(c => {
    const cn = layoutCtx.node(c.id);
    if(!cn) return;
    cn.x = x; cn.y = root.y + (sizes[root.id]?.h||36) + G.level;
    // 子タイムポイントが中間カードなら、bbox の左上を (x, cn.y) とみなして水平方向だけ進める。
    if (_bdIsInnerStructureAtomic(cn.id, root.id)) {
      x += Math.max(sizes[cn.id]?.w||160, 120) + G.sibling;
      return;
    }
    let cy = cn.y + (sizes[cn.id]?.h||36) + G.level;
    layoutCtx.children(cn.id).forEach(gc => {
      const gn=layoutCtx.node(gc.id);if(!gn)return;
      // 孫が中間カードの場合も、sizes[gn.id].h は bbox 高さなので同じ前進距離で OK。
      // 中身の再配置は Pass 3 が bbox 相対位置で行う。
      gn.x=cn.x; gn.y=cy; cy+=((sizes[gn.id]?.h||36)+G.level);
    });
    x += Math.max(sizes[cn.id]?.w||160, 120) + G.sibling;
  });
}

function bdLayoutOrgChart(root, sizes, layoutCtx) { bdLayoutFlowchart(root, sizes, layoutCtx); }

// 選択カードに対する Ctrl+矢印操作 (兄弟入れ替え / 子階層の折りたたみ展開) のため、
// ツリーの「展開方向」を判定する。返り値: 'right' | 'left' | 'down' | 'up'
//   1) ルート構造タイプから推定
//      - flowchart / orgchart / tree → 'down' 固定
//      - logic / timeline → 'right' 固定
//      - mindmap は放射状なので、ノード位置から動的判定（下の子/親ベクトル評価へフォールスルー）
//   2) 構造タイプ未設定 or mindmap の場合、子の平均位置と自分の位置の差分で判定
//   3) 子も無い場合は、親→自分のベクトルから判定
//   4) いずれも判定できない場合は 'right' を既定とする
function bdTreeDirection(nodeId) {
  if (typeof bd === 'undefined') return 'right';
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n) return 'right';
  const struct = (typeof bdStructureOf === 'function') ? bdStructureOf(nodeId) : '';
  if (struct === 'flowchart' || struct === 'orgchart' || struct === 'tree') return 'down';
  if (struct === 'logic' || struct === 'timeline') return 'right';
  // mindmap および構造未設定は位置から動的判定
  const children = (typeof bdChildren === 'function') ? bdChildren(nodeId) : [];
  if (children.length > 0) {
    let dx = 0, dy = 0;
    children.forEach(c => { dx += (c.x - n.x); dy += (c.y - n.y); });
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'down' : 'up';
  }
  if (n.parent) {
    const parent = bd.nodes.find(v => v.id === n.parent);
    if (parent) {
      const dx = n.x - parent.x;
      const dy = n.y - parent.y;
      if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
      return dy >= 0 ? 'down' : 'up';
    }
  }
  return 'right';
}

// 選択カードを同階層の前 / 後 兄弟と入れ替える。dir = 'prev' | 'next'。
// bd.nodes 上の兄弟順を入れ替え、ついで x/y も交換する。
// 構造タイプが設定されていれば bdAutoLayout で再配置されるので位置交換は事実上ノーオペになるが、
// 親に従う (ルートの構造未設定) のツリーでは位置交換が見た目に反映される。
function bdSwapSibling(nodeId, dir) {
  if (typeof bd === 'undefined') return false;
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !n.parent) return false;
  const siblings = (typeof bdChildren === 'function') ? bdChildren(n.parent) : [];
  const idx = siblings.findIndex(s => s.id === nodeId);
  if (idx < 0) return false;
  const otherIdx = dir === 'prev' ? idx - 1 : idx + 1;
  if (otherIdx < 0 || otherIdx >= siblings.length) return false;
  const other = siblings[otherIdx];
  if (typeof bdPushUndo === 'function') bdPushUndo();
  // bd.nodes 上で n と other を入れ替える
  const nGlobal = bd.nodes.findIndex(v => v.id === nodeId);
  const oGlobal = bd.nodes.findIndex(v => v.id === other.id);
  if (nGlobal >= 0 && oGlobal >= 0) {
    [bd.nodes[nGlobal], bd.nodes[oGlobal]] = [bd.nodes[oGlobal], bd.nodes[nGlobal]];
  }
  // 位置も入れ替える (親に従う / 自動整列なしツリー向け)
  const tx = n.x, ty = n.y;
  n.x = other.x; n.y = other.y;
  other.x = tx; other.y = ty;
  const root = (typeof bdRoot === 'function') ? bdRoot(nodeId) : null;
  [n.id, other.id].forEach(id => {
    if (typeof bdUpdateNodePosition === 'function') bdUpdateNodePosition(id);
  });
  if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved([n.id, other.id], 'swap-sibling');
  else if (typeof bdRender === 'function') bdRender();
  // 中間カード構造 (c33a3a6) も尊重: 兄弟の親に適用される structure があれば再整列。
  const effectiveStructure = (typeof bdStructureOf === 'function') ? bdStructureOf(nodeId) : (root?.structure || '');
  if (effectiveStructure && typeof bdAutoLayout === 'function' && root) bdAutoLayout(root.id);
  // 入れ替えた選択カードに resize ハンドル等を追従させる
  if (typeof bdSyncResizeHandleForNode === 'function') {
    bdSyncResizeHandleForNode(n.id);
    bdSyncResizeHandleForNode(other.id);
  } else if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
  if (typeof bdDirty === 'function') bdDirty();
  return true;
}

// 選択カードの子階層の表示を切り替える。value=true で折りたたみ、false で展開。
function bdSetCollapsed(nodeId, value) {
  if (typeof bd === 'undefined') return false;
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n) return false;
  const next = !!value;
  if (!!n.collapsed === next) return false;
  if (typeof bdPushUndo === 'function') bdPushUndo();
  n.collapsed = next;
  if (typeof bdRender === 'function') bdRender();
  if (typeof bdDirty === 'function') bdDirty();
  return true;
}

// Ctrl+矢印キーの統一ハンドラ。選択カードのツリー方向に応じて、
// 「展開方向の軸」では子階層の折りたたみ / 展開、
// 「兄弟が並ぶ軸」では直前 / 直後の兄弟と入れ替え、を行う。
// arrow = 'left' | 'right' | 'up' | 'down'
function bdHandleCtrlArrow(arrow) {
  if (typeof bd === 'undefined' || bd.editing) return false;
  if (bd.selected.size !== 1) return false;
  const nid = [...bd.selected][0];
  const dir = (typeof bdTreeDirection === 'function') ? bdTreeDirection(nid) : 'right';
  const struct = (typeof bdStructureOf === 'function') ? bdStructureOf(nid) : '';
  if (struct === 'tree') {
    if (arrow === 'up') return bdSwapSibling(nid, 'prev');
    if (arrow === 'down') return bdSwapSibling(nid, 'next');
    if (arrow === 'right') return bdSetCollapsed(nid, false);
    return bdSetCollapsed(nid, true);
  }
  // 展開方向: dir そのもの。反対方向: 折りたたみ。
  // 兄弟軸: 展開方向と直交する軸の上下 / 左右で前後の兄弟と入れ替え。
  if (dir === 'right' || dir === 'left') {
    // 兄弟軸 = 上下、展開軸 = 左右
    if (arrow === 'up') return bdSwapSibling(nid, 'prev');
    if (arrow === 'down') return bdSwapSibling(nid, 'next');
    if (arrow === dir) return bdSetCollapsed(nid, false);
    return bdSetCollapsed(nid, true);
  }
  // 'down' or 'up': 兄弟軸 = 左右、展開軸 = 上下
  if (arrow === 'left') return bdSwapSibling(nid, 'prev');
  if (arrow === 'right') return bdSwapSibling(nid, 'next');
  if (arrow === dir) return bdSetCollapsed(nid, false);
  return bdSetCollapsed(nid, true);
}

// 2026-04-18: 自動整列 (autoAlign) ヘルパー。
//   - _bdFindStructureRoot: ノードの祖先を辿って structure が設定されたルートを返す
//   - _bdSnapNodeToNeighbors: ドラッグ終了時に他カードの辺と位置を比較し、
//     閾値以下 (8px) のずれで x / y を吸着する。返り値は {dx, dy} の補正量 (未吸着時 0)。
// 2026-04-18: 全ての構造ツリールートに対して bdAutoLayout を再実行する。
// スタイルタブで隙間設定を変更した時 / 自動整列をオンにした時に呼び出して、
// 既存のカード群にも隙間変更が即座に反映されるようにする (bd.autoAlign が on のときのみ)。
// contained カードはスキップ (親相対座標のためワールド座標レイアウトと相性悪)。
function _bdRelayoutAllStructureTrees() {
  if (typeof bd === 'undefined' || typeof bdAutoLayout !== 'function') return;
  (bd.nodes || []).forEach(n => {
    if (n && n.structure && !n.contained) {
      bdAutoLayout(n.id);
    }
  });
}

function _bdFindStructureRoot(nodeId) {
  if (typeof bd === 'undefined') return null;
  let cur = bd.nodes.find(n => n.id === nodeId);
  let guard = 0;
  while (cur && guard < 50) {
    if (cur.structure) return cur.id;
    if (!cur.parent) break;
    cur = bd.nodes.find(n => n.id === cur.parent);
    guard += 1;
  }
  return null;
}

function _bdSnapNodeToNeighbors(nodeId, excludeIds) {
  if (typeof bd === 'undefined') return { dx: 0, dy: 0 };
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || n.contained) return { dx: 0, dy: 0 };
  const SNAP = 8;
  const el = document.getElementById('bdn-' + nodeId);
  const w = el?.offsetWidth || n.w || 160;
  const h = el?.offsetHeight || n.h || 36;
  const exclude = new Set(Array.isArray(excludeIds) ? excludeIds : [nodeId]);
  // 自身の 4 辺候補 (left, right, top, bottom)
  const selfXCandidates = [n.x, n.x + w];
  const selfYCandidates = [n.y, n.y + h];
  let bestDX = 0, bestDY = 0;
  let bestDXAbs = SNAP + 1, bestDYAbs = SNAP + 1;
  bd.nodes.forEach(other => {
    if (!other || exclude.has(other.id)) return;
    if (other.contained) return;
    const oel = document.getElementById('bdn-' + other.id);
    const ow = oel?.offsetWidth || other.w || 160;
    const oh = oel?.offsetHeight || other.h || 36;
    const otherXs = [other.x, other.x + ow];
    const otherYs = [other.y, other.y + oh];
    // x 軸 4 通りの組み合わせ (self left/right vs other left/right)
    selfXCandidates.forEach(sx => {
      otherXs.forEach(ox => {
        const d = ox - sx;
        if (Math.abs(d) < bestDXAbs) { bestDXAbs = Math.abs(d); bestDX = d; }
      });
    });
    selfYCandidates.forEach(sy => {
      otherYs.forEach(oy => {
        const d = oy - sy;
        if (Math.abs(d) < bestDYAbs) { bestDYAbs = Math.abs(d); bestDY = d; }
      });
    });
  });
  return {
    dx: bestDXAbs <= SNAP ? bestDX : 0,
    dy: bestDYAbs <= SNAP ? bestDY : 0,
  };
}

// アンカークリック (ラインを選択していない時) でカードを追加する。
// 位置 (hudPos) → 論理アクションの対応は、ルートの structure による展開方向で変わる:
//   - 水平展開 (mindmap / logic / timeline / structure なし):
//       right=子, left=親との間, top=同階層前, bottom=同階層後
//   - 垂直展開 (flowchart / orgchart / tree):
//       bottom=子, top=親との間, left=同階層前, right=同階層後
// 親必須のアクション (between / sibling-*) は n.parent がない場合は何もしない。
function _bdAnchorAddCard(fromNid, hudPos) {
  if (typeof bd === 'undefined') return false;
  const n = bd.nodes.find(v => v.id === fromNid);
  if (!n) return false;
  // コンテナ内包カードは親相対座標を使うため、絶対座標前提のツリー操作とは相容れない。no-op にする。
  if (n.contained) return false;
  const structure = (typeof bdStructureOf === 'function') ? bdStructureOf(fromNid) : '';
  const isTreeStructure = structure === 'tree';
  const isVertical = (structure === 'flowchart' || structure === 'orgchart' || structure === 'tree');
  let action = '';
  if (isVertical) {
    if (hudPos === 'bottom') action = 'child';
    else if (hudPos === 'top') action = 'between';
    else if (hudPos === 'left') action = 'sibling-before';
    else if (hudPos === 'right') action = 'sibling-after';
  } else {
    if (hudPos === 'right') action = 'child';
    else if (hudPos === 'left') action = 'between';
    else if (hudPos === 'top') action = 'sibling-before';
    else if (hudPos === 'bottom') action = 'sibling-after';
  }
  if (!action) return false;
  if ((action === 'between' || action === 'sibling-before' || action === 'sibling-after') && !n.parent) {
    return false;
  }
  if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
  try {
    // 前回操作で残っている可能性がある二段階接続モードの残骸をクリア (ユーザー操作混線防止)
    bd.connecting = null;
    bd._connLabel = '';
    bd._connOrigin = null;
    bd._connFromAnchor = null;
    if (typeof bdPushUndo === 'function') bdPushUndo();
    const el = document.getElementById('bdn-' + fromNid);
    const pw = el ? el.offsetWidth : (n.w || 160);
    const ph = el ? el.offsetHeight : (n.h || 36);
    const G = bdLayoutGaps();
    const makeNode = (text, x, y, opts) => (typeof bdCreateNodeWithStyle === 'function')
      ? bdCreateNodeWithStyle(text, x, y, opts)
      : bdNode(text, x, y, 160, 0, opts);
    let newNode = null;
    if (action === 'child') {
      const nx = isTreeStructure ? n.x + G.level : (isVertical ? n.x : n.x + pw + G.level);
      const ny = isTreeStructure ? n.y + ph + G.sibling : (isVertical ? n.y + ph + G.level : n.y);
      newNode = makeNode('', nx, ny, { parent: fromNid });
      bd.nodes.push(newNode);
      bd.connections.push({ from: fromNid, to: newNode.id, arrow: bdStructureOf(fromNid) === 'flowchart' });
      const root = bdRoot(fromNid);
      if (root && !root.structure) root.structure = isVertical ? 'flowchart' : 'mindmap';
    } else if (action === 'sibling-before' || action === 'sibling-after') {
      const parentId = n.parent;
      const siblings = bdChildren(parentId);
      const idx = siblings.findIndex(s => s.id === fromNid);
      let nx, ny;
      if (isTreeStructure) {
        nx = n.x;
        ny = action === 'sibling-before' ? n.y - ph - G.sibling : n.y + ph + G.sibling;
      } else if (isVertical) {
        ny = n.y;
        nx = action === 'sibling-before' ? n.x - pw - G.sibling : n.x + pw + G.sibling;
      } else {
        nx = n.x;
        ny = action === 'sibling-before' ? n.y - ph - G.sibling : n.y + ph + G.sibling;
      }
      newNode = makeNode('', nx, ny, { parent: parentId });
      if (action === 'sibling-before') {
        const g = bd.nodes.findIndex(v => v.id === fromNid);
        if (g >= 0) bd.nodes.splice(g, 0, newNode); else bd.nodes.push(newNode);
      } else {
        const nextSib = siblings[idx + 1];
        if (nextSib) {
          const g = bd.nodes.findIndex(v => v.id === nextSib.id);
          if (g >= 0) bd.nodes.splice(g, 0, newNode); else bd.nodes.push(newNode);
        } else {
          bd.nodes.push(newNode);
        }
      }
      bd.connections.push({ from: parentId, to: newNode.id, arrow: bdStructureOf(parentId) === 'flowchart' });
    } else if (action === 'between') {
      const oldParentId = n.parent;
      const nx = isTreeStructure ? n.x - G.level : (isVertical ? n.x : n.x - pw - G.level);
      const ny = isTreeStructure ? n.y - ph - G.sibling : (isVertical ? n.y - ph - G.level : n.y);
      newNode = makeNode('', nx, ny, { parent: oldParentId });
      const g = bd.nodes.findIndex(v => v.id === fromNid);
      if (g >= 0) bd.nodes.splice(g, 0, newNode); else bd.nodes.push(newNode);
      n.parent = newNode.id;
      let reused = false;
      bd.connections = bd.connections.filter(c => {
        if (c.from === oldParentId && c.to === fromNid) {
          if (!reused) { c.to = newNode.id; reused = true; return true; }
          return false;
        }
        return true;
      });
      if (!reused) bd.connections.push({ from: oldParentId, to: newNode.id, arrow: bdStructureOf(oldParentId) === 'flowchart' });
      bd.connections.push({ from: newNode.id, to: fromNid, arrow: bdStructureOf(oldParentId) === 'flowchart' });
    }
    if (!newNode) return false;
    if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(newNode)) {
      if (typeof bdRequestFullRender === 'function') bdRequestFullRender('anchor-add-card-fallback');
      else bdRender();
    }
    if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(newNode.id, 'anchor-add-card');
    if (typeof bdMarkConnectionsDirtyByNodes === 'function') bdMarkConnectionsDirtyByNodes([fromNid, newNode.id], 'anchor-add-card');
    if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([fromNid, newNode.id], 'anchor-add-card');
    if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [newNode.id] }, 'anchor-add-card');
    const rootNode = bdRoot(newNode.id);
    if (rootNode?.structure && typeof bdRequestAutoLayout === 'function') {
      const delay = action === 'child' ? undefined : BD_FAST_SIBLING_AUTO_LAYOUT_DELAY_MS;
      bdRequestAutoLayout(rootNode.id, delay);
    } else if (rootNode?.structure && typeof bdAutoLayout === 'function') bdAutoLayout(rootNode.id);
    if (typeof bdSelect === 'function') bdSelect(newNode.id);
    if (typeof bdDirty === 'function') bdDirty();
    if (typeof window.showStatus === 'function') {
      const msg = action === 'child' ? '子カードを追加しました'
                : action === 'between' ? '親カードとの間にカードを追加しました'
                : action === 'sibling-before' ? '同階層カードを前に追加しました'
                : '同階層カードを後に追加しました';
      window.showStatus(msg);
    }
    return true;
  } finally {
    if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
  }
}

// --- 階層別自動スタイル ---
// ルートノードに _autoStyle = true が設定されている場合、子孫ノードに深さベースのスタイルを適用。
// defaultText は「新規カードを追加したときに自動で入るテキスト」で、深さごとに切り替わる。
// line サブオブジェクトは、この階層のカードから子カードへ伸びるラインのスタイル。
// _BD_EMPTY_DEPTH_LINE は「個別ライン設定」を選んだ階層や空値の正規化に使う。
// 初期搭載の階層別スタイルはテーマカラーと標準ライン値を明示的に持つ。
const _BD_EMPTY_DEPTH_LINE = () => ({ color: '', width: 0, style: '', arrow: '', pathType: '', labelBgColor: '', labelBorderColor: '', labelTextColor: '', fontFamily: '', textShadowColor: '' });
const _BD_DEPTH_THEME_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
function _bdDepthThemeColor(index) {
  return _BD_DEPTH_THEME_COLORS[Math.abs(index | 0) % _BD_DEPTH_THEME_COLORS.length] || '#3b82f6';
}
function _bdDepthReadableTextColor(color) {
  if (typeof bdReadableTextColor === 'function') return bdReadableTextColor(color);
  const hex = typeof color === 'string' && color.match(/^#([0-9a-f]{6})$/i) ? color : '';
  if (!hex) return '';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#1e1e1e' : '#ffffff';
}
function _BD_DEPTH_LINE(themeIndex, overrides = {}) {
  const color = _bdDepthThemeColor(themeIndex);
  return {
    ..._BD_EMPTY_DEPTH_LINE(),
    color,
    width: 3,
    style: '',
    arrow: 'end',
    pathType: 'orthogonal',
    branchRatio: 0.3,
    cornerRadius: 5,
    labelBorderWidth: 0,
    textShadowWidth: 0,
    textShadowColor: '',
    ...overrides,
  };
}
function _BD_DEPTH_CARD(themeIndex, overrides = {}) {
  const color = _bdDepthThemeColor(themeIndex);
  return {
    _themeColorIndex: themeIndex,
    bgColor: color,
    textColor: _bdDepthReadableTextColor(color),
    borderColor: color,
    borderWidth: 2,
    borderRadius: 8,
    fontItalic: false,
    textStrokeColor: '',
    textStrokeWidth: 0,
    ...overrides,
  };
}
const BD_DEFAULT_DEPTH_STYLES = [
  _BD_DEPTH_CARD(5, { name: '階層1 矩形', cardStyleRef: 'card-theme-rect', lineStyleRef: 'line-theme-standard', fontSize: 16, fontBold: true, width: 200, shape: 'rect', defaultText: 'カード', line: _BD_DEPTH_LINE(5) }),
  _BD_DEPTH_CARD(3, { name: '階層2 楕円', cardStyleRef: 'card-theme-ellipse', lineStyleRef: 'line-theme-standard', fontSize: 14, fontBold: true, width: 180, shape: 'ellipse', borderRadius: 999, defaultText: 'サブカード', line: _BD_DEPTH_LINE(3) }),
  _BD_DEPTH_CARD(0, { name: '階層3 矩形強調', cardStyleRef: 'card-theme-rect', lineStyleRef: 'line-theme-alert', fontSize: 13, fontBold: true, width: 180, shape: 'rect', borderRadius: 8, defaultText: '項目', line: _BD_DEPTH_LINE(0, { width: 4 }) }),
  _BD_DEPTH_CARD(1, { name: '階層4 八角', cardStyleRef: 'card-theme-octagon', lineStyleRef: 'line-theme-dashed', fontSize: 13, fontBold: false, width: 180, shape: 'octagon', borderRadius: 0, defaultText: '詳細', line: _BD_DEPTH_LINE(1, { width: 2, style: 'dashed' }) }),
  _BD_DEPTH_CARD(4, { name: '階層5 ピル', cardStyleRef: 'card-theme-pill', lineStyleRef: 'line-theme-straight', fontSize: 12, fontBold: true, width: 180, shape: 'pill', borderRadius: 999, defaultText: 'メモ', line: _BD_DEPTH_LINE(4, { pathType: 'straight' }) }),
  _BD_DEPTH_CARD(6, { name: '階層6 八角', cardStyleRef: 'card-theme-octagon', lineStyleRef: 'line-theme-emphasis', fontSize: 12, fontBold: true, width: 180, shape: 'octagon', borderRadius: 0, defaultText: '補足', line: _BD_DEPTH_LINE(6, { width: 5, arrow: 'both' }) }),
  _BD_DEPTH_CARD(2, { name: '階層7 雲', cardStyleRef: 'card-theme-cloud', lineStyleRef: 'line-theme-thin', fontSize: 12, fontBold: true, width: 190, shape: 'cloud', borderRadius: 0, defaultText: '注目', cloudBumpWidth: 44, cloudBumpHeight: 16, cloudSideWidth: 14, cloudOffset: 0.45, cloudSubWidthRatio: 55, cloudSubHeightRatio: 50, line: _BD_DEPTH_LINE(2, { width: 1, arrow: '', pathType: 'straight' }) }),
  _BD_DEPTH_CARD(7, { name: '階層8 雲', cardStyleRef: 'card-theme-cloud', lineStyleRef: 'line-theme-reference', fontSize: 12, fontBold: false, width: 190, shape: 'cloud', borderRadius: 0, defaultText: 'メモ', cloudBumpWidth: 44, cloudBumpHeight: 16, cloudSideWidth: 14, cloudOffset: 0.45, cloudSubWidthRatio: 55, cloudSubHeightRatio: 50, line: _BD_DEPTH_LINE(7, { width: 2, style: 'dashed', arrow: 'start', pathType: 'straight' }) }),
  _BD_DEPTH_CARD(4, { name: '階層9 もやもや', cardStyleRef: 'card-theme-fluffy', lineStyleRef: 'line-theme-curve', fontSize: 12, fontBold: false, width: 190, shape: 'fluffy', borderRadius: 0, defaultText: '補足', cloudBumpWidth: 38, cloudBumpHeight: 14, cloudSideWidth: 12, cloudOffset: 0.5, cloudSubWidthRatio: 45, cloudSubHeightRatio: 45, line: _BD_DEPTH_LINE(4, { pathType: 'curve' }) }),
  _BD_DEPTH_CARD(0, { name: '階層10 トゲ直線', cardStyleRef: 'card-theme-thorn', lineStyleRef: 'line-theme-alert', fontSize: 12, fontBold: true, width: 190, shape: 'thorn', borderRadius: 0, defaultText: '注意', cloudBumpWidth: 28, cloudBumpHeight: 18, cloudSideWidth: 10, cloudOffset: 0.5, cloudSubWidthRatio: 0, cloudSubHeightRatio: 0, line: _BD_DEPTH_LINE(0, { width: 4 }) }),
  _BD_DEPTH_CARD(6, { name: '階層11 トゲ曲線', cardStyleRef: 'card-theme-thorn-curve', lineStyleRef: 'line-theme-loop', fontSize: 12, fontBold: true, width: 190, shape: 'thorn-curve', borderRadius: 0, defaultText: '分岐', cloudBumpWidth: 30, cloudBumpHeight: 18, cloudSideWidth: 10, cloudOffset: 0.5, cloudSubWidthRatio: 0, cloudSubHeightRatio: 0, line: _BD_DEPTH_LINE(6, { arrow: 'both', pathType: 'curve' }) }),
];

function _bdDefaultDepthStyles() {
  if (typeof bdBuildDefaultDepthStyles === 'function') {
    return bdBuildDefaultDepthStyles(BD_DEFAULT_DEPTH_STYLES, _BD_EMPTY_DEPTH_LINE, typeof bd !== 'undefined' ? bd : undefined);
  }
  return BD_DEFAULT_DEPTH_STYLES.map(style => ({ ...style, line: { ..._BD_EMPTY_DEPTH_LINE() } }));
}

// 階層別スタイルで扱うカード全項目 (オプションパネル基本タブと同じ項目セット)
// 雲型 / トゲ型 のシェイプ固有パラメータ (cloudBumpWidth 等) は depth.shape が cloud 系のときのみ
// _bdApplyDepthCardFieldsToNode 内で追加適用するため、ここには含めない。
const _BD_DEPTH_CARD_FIELDS = [
  'bgColor', 'textColor', 'borderColor', 'borderWidth', 'borderRadius',
  'fontSize', 'fontBold', 'fontItalic', 'textStrokeColor', 'textStrokeWidth',
  'shape', 'width',
];
const _BD_DEPTH_CLOUD_FIELDS = [
  'cloudBumpWidth', 'cloudBumpHeight', 'cloudOffset',
  'cloudSubWidthRatio', 'cloudSubHeightRatio',
];
const _BD_CLOUD_SHAPES = new Set(['cloud', 'thorn', 'thorn-curve', 'fluffy']);
const _BD_REMOVED_DEPTH_CARD_STYLE_REFS = {
  'card-theme-diamond': 'card-theme-rect',
  'card-theme-hexagon': 'card-theme-octagon',
  'card-theme-star': 'card-theme-cloud',
};

function _bdNormalizeDepthCardStyleRef(value) {
  const id = String(value || '').trim();
  if (!id) return '';
  if (typeof _bdMapLegacyStyleId === 'function' && typeof BD_LEGACY_CARD_STYLE_ID_MAP !== 'undefined') {
    return _bdMapLegacyStyleId(id, BD_LEGACY_CARD_STYLE_ID_MAP);
  }
  return _BD_REMOVED_DEPTH_CARD_STYLE_REFS[id] || id;
}

function _bdNormalizeDepthCardShape(value) {
  const shape = String(value || '').trim();
  if (!shape || shape === 'rect') return shape;
  if (typeof BD_SHAPES !== 'undefined' && BD_SHAPES.includes(shape)) return shape;
  return '';
}
const _BD_DEPTH_LINE_FIELDS = [
  'color', 'width', 'style', 'arrow', 'pathType',
  'branchRatio', 'cornerRadius',
  'labelBgColor', 'labelBorderColor', 'labelBorderWidth', 'labelTextColor',
  'fontBold', 'fontItalic', 'fontFamily',
  'textVisible', 'textAlongPath', 'textAutoFlip', 'textShadowWidth', 'textShadowColor',
];

// depth.line は「指定なし」(空 / 0 / undefined) を保持する。空値のフィールドは
// _bdApplyDepthLineFieldsToConn でスキップされ、ツリー内のラインは既存値を保ったままになる。
function _bdNormalizeDepthLine(raw, _fallback) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {
    color: src.color != null ? String(src.color) : '',
    width: Number.isFinite(+src.width) ? Math.max(0, Math.min(20, +src.width)) : 0,
    style: src.style === 'dashed' ? 'dashed' : '',
    arrow: ['end', 'start', 'both'].includes(src.arrow) ? src.arrow : '',
    // v0.5.320: pathType を 3 種 (curve/straight/orthogonal) に統合。旧 free-bezier は curve、
    // 旧 orthogonal-curve は orthogonal に自動変換。
    pathType: (() => {
      const pt = src.pathType;
      if (pt === 'free-bezier') return 'curve';
      if (pt === 'orthogonal-curve') return 'orthogonal';
      if (['curve', 'straight', 'orthogonal'].includes(pt)) return pt;
      return '';
    })(),
    labelBgColor: src.labelBgColor != null ? String(src.labelBgColor) : '',
    labelBorderColor: src.labelBorderColor != null ? String(src.labelBorderColor) : '',
    labelTextColor: src.labelTextColor != null ? String(src.labelTextColor) : '',
    fontFamily: typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(src.fontFamily) : String(src.fontFamily || ''),
    textShadowColor: src.textShadowColor != null ? String(src.textShadowColor) : '',
  };
  if (src.fontBold !== undefined) out.fontBold = !!src.fontBold;
  if (src.fontItalic !== undefined) out.fontItalic = !!src.fontItalic;
  // boolean / 数値の「未指定」は undefined のまま残す (指定時のみキーを持たせる)
  if (src.textVisible !== undefined) out.textVisible = !!src.textVisible;
  if (src.textAlongPath !== undefined) out.textAlongPath = !!src.textAlongPath;
  if (src.textAutoFlip !== undefined) out.textAutoFlip = !!src.textAutoFlip;
  if (Number.isFinite(+src.textShadowWidth)) out.textShadowWidth = Math.max(0, Math.min(10, +src.textShadowWidth));
  if (Number.isFinite(+src.labelBorderWidth)) out.labelBorderWidth = Math.max(0, Math.min(10, +src.labelBorderWidth));
  // v0.5.324: 直角線パラメータを保持
  if (Number.isFinite(+src.branchRatio)) out.branchRatio = Math.max(0.05, Math.min(0.95, +src.branchRatio));
  if (Number.isFinite(+src.cornerRadius)) out.cornerRadius = Math.max(0, Math.min(40, +src.cornerRadius));
  return out;
}

function bdNormalizeDepthStyles(styles) {
  const defaults = _bdDefaultDepthStyles();
  const source = Array.isArray(styles) && styles.length ? styles : defaults;
  const normalized = source.map((entry, index) => {
    const fallback = defaults[Math.min(index, defaults.length - 1)] || defaults[0];
    const raw = entry || fallback;
    const out = {
      name: raw.name != null ? String(raw.name).trim() : (fallback.name || ''),
      cardStyleRef: raw.cardStyleRef != null ? _bdNormalizeDepthCardStyleRef(raw.cardStyleRef) : '',
      lineStyleRef: raw.lineStyleRef != null ? String(raw.lineStyleRef) : '',
      fontSize: Number.isFinite(+raw.fontSize) ? Math.max(8, Math.min(72, +raw.fontSize)) : fallback.fontSize,
      fontBold: raw.fontBold !== undefined ? !!raw.fontBold : fallback.fontBold,
      fontItalic: raw.fontItalic !== undefined ? !!raw.fontItalic : !!fallback.fontItalic,
      fontFamily: typeof normalizeFontFamilyValue === 'function' ? normalizeFontFamilyValue(raw.fontFamily) : String(raw.fontFamily || ''),
      width: Number.isFinite(+raw.width) ? Math.max(40, Math.min(600, +raw.width)) : fallback.width,
      bgColor: raw.bgColor != null ? String(raw.bgColor) : fallback.bgColor,
      textColor: raw.textColor != null ? String(raw.textColor) : (fallback.textColor || ''),
      borderColor: raw.borderColor != null ? String(raw.borderColor) : (fallback.borderColor || ''),
      borderWidth: Number.isFinite(+raw.borderWidth) ? Math.max(0, Math.min(20, +raw.borderWidth)) : (Number.isFinite(+fallback.borderWidth) ? +fallback.borderWidth : 0),
      borderRadius: Number.isFinite(+raw.borderRadius) ? Math.max(0, Math.min(64, +raw.borderRadius)) : (Number.isFinite(+fallback.borderRadius) ? +fallback.borderRadius : 6),
      textStrokeColor: raw.textStrokeColor != null ? String(raw.textStrokeColor) : '',
      textStrokeWidth: Number.isFinite(+raw.textStrokeWidth) ? Math.max(0, Math.min(12, +raw.textStrokeWidth)) : 0,
      shape: raw.shape != null ? _bdNormalizeDepthCardShape(raw.shape) : '',
      // 雲型 / トゲ型 / もやもや型で使われるパラメータ (shape が 'cloud' 等のときのみ意味を持つ)
      cloudBumpWidth: Number.isFinite(+raw.cloudBumpWidth) ? Math.max(8, Math.min(200, +raw.cloudBumpWidth)) : 40,
      cloudBumpHeight: Number.isFinite(+raw.cloudBumpHeight) ? Math.max(2, Math.min(100, +raw.cloudBumpHeight)) : 16,
      cloudOffset: Number.isFinite(+raw.cloudOffset) ? Math.max(0, Math.min(1, +raw.cloudOffset)) : 0.5,
      cloudSubWidthRatio: Number.isFinite(+raw.cloudSubWidthRatio) ? Math.max(0, Math.min(100, +raw.cloudSubWidthRatio)) : 0,
      cloudSubHeightRatio: Number.isFinite(+raw.cloudSubHeightRatio) ? Math.max(0, Math.min(100, +raw.cloudSubHeightRatio)) : 0,
      defaultText: raw.defaultText != null ? String(raw.defaultText) : (fallback.defaultText || 'カード'),
      line: _bdNormalizeDepthLine(raw.line, fallback.line),
    };
    return out;
  });
  return normalized.length ? normalized : defaults.map(style => ({ ...style, line: { ..._bdNormalizeDepthLine(style.line, style.line) } }));
}

function bdEnsureDepthStyles() {
  if (!Array.isArray(bd.depthStyles) || !bd.depthStyles.length) {
    // 空の場合は、ユーザーが「デフォルトとして保存」していればそれを、なければ BD_DEFAULT を使う
    const globalDepth = typeof _bdReadGlobalDepthStyles === 'function' ? _bdReadGlobalDepthStyles() : null;
    const globalIsLegacy = typeof _bdIsLegacyDefaultDepthStyles === 'function' && _bdIsLegacyDefaultDepthStyles(globalDepth);
    if (Array.isArray(globalDepth) && globalDepth.length && !globalIsLegacy) {
      bd.depthStyles = bdNormalizeDepthStyles(globalDepth);
      bd._globalDepthStylesApplied = true;
    } else {
      bd.depthStyles = bdNormalizeDepthStyles([]);
    }
  } else {
    bd.depthStyles = bdNormalizeDepthStyles(bd.depthStyles);
  }
  return bd.depthStyles;
}

function bdGetAutoStyleForDepth(depth) {
  const styles = bdEnsureDepthStyles();
  const idx = Math.min(Math.max(0, depth), styles.length - 1);
  const defaults = _bdDefaultDepthStyles();
  return styles[idx] || defaults[defaults.length - 1];
}

function bdApplyThemeColorsToDepthStyles(options = {}) {
  const styles = bdNormalizeDepthStyles(bd.depthStyles || []);
  const defaults = _bdDefaultDepthStyles();
  const rawPalette = typeof bdGetThemeColorSet === 'function' ? bdGetThemeColorSet(bd) : [];
  const palette = Array.isArray(rawPalette) ? rawPalette : [];
  const applyLineColor = options.applyLineColor !== false;
  styles.forEach((style, index) => {
    const fallback = defaults[Math.min(index, defaults.length - 1)] || defaults[0] || {};
    const color = palette[index % Math.max(1, palette.length)] || fallback.bgColor || '';
    if (!color) return;
    style.bgColor = color;
    style.borderColor = color;
    const textColor = typeof bdReadableTextColor === 'function' ? bdReadableTextColor(color) : '';
    if (textColor) style.textColor = textColor;
    if (applyLineColor) {
      if (!style.line || typeof style.line !== 'object') style.line = _BD_EMPTY_DEPTH_LINE();
      style.line.color = color;
    }
  });
  bd.depthStyles = bdNormalizeDepthStyles(styles);
  return bd.depthStyles;
}

// 階層別カードフィールドを node に適用する。
// - レガシーの 4 フィールド (fontSize/fontBold/bgColor/width) は従来通り常に上書き
//   (既存動作の互換性維持。_userXxx フラグが立っていればスキップ)
// - 新規フィールド (textColor, borderColor, ..., shape) は「指定なし」(空文字列 / undefined)
//   なら触らない。既存のカード個別設定を保持する
function _bdApplyDepthCardFieldsToNode(node, depthStyle) {
  if (!node || !depthStyle) return;
  const guardKey = (field) => '_user' + field.charAt(0).toUpperCase() + field.slice(1);
  _BD_DEPTH_CARD_FIELDS.forEach(field => {
    if (node[guardKey(field)]) return;
    const v = depthStyle[field];
    if (field === 'width') {
      if (Number.isFinite(+v)) node.w = +v;
      return;
    }
    // レガシー 4 フィールド: 従来通り空文字列でも上書き
    if (field === 'fontSize' || field === 'fontBold' || field === 'bgColor') {
      if (v !== undefined) node[field] = v;
      return;
    }
    // 新規フィールド: 「指定なし」なら触らない
    if (v === undefined || v === null) return;
    if (typeof v === 'string' && v === '') return;
    node[field] = v;
  });
  // depth が雲型系シェイプを明示しているときのみ、雲型パラメータも適用する
  if (_BD_CLOUD_SHAPES.has(depthStyle.shape)) {
    _BD_DEPTH_CLOUD_FIELDS.forEach(field => {
      const v = depthStyle[field];
      if (!Number.isFinite(+v)) return;
      node[field] = +v;
    });
  }
}

// 階層別ラインスタイルを conn に適用する。
// - 「指定なし」(空文字列 / undefined / width 0) の項目はスキップ (既存のラインの値を保持)
// - styleRef があるラインでも個別 override として書き込む (カードの depth 適用と同じ方針)
// - conn._userLineStyle が立っていればすべてスキップ
function _bdApplyDepthLineFieldsToConn(conn, depthStyle) {
  if (!conn || !depthStyle || !depthStyle.line) return;
  if (conn._userLineStyle) return;
  const L = depthStyle.line;
  if (L.color) conn.color = L.color;
  if (Number.isFinite(+L.width) && +L.width > 0) conn.width = +L.width;
  if (L.style === 'dashed' || L.style === '') {
    // 破線は明示指定、実線 ('') は「指定なし扱い」でスキップ
    if (L.style === 'dashed') conn.style = 'dashed';
  }
  if (L.arrow === 'end' || L.arrow === 'start' || L.arrow === 'both') conn.arrow = L.arrow;
  if (L.pathType) {
    conn.pathType = L.pathType;
    delete conn.straight;
  }
  if (Number.isFinite(+L.branchRatio)) conn.branchRatio = Math.max(0.05, Math.min(0.95, +L.branchRatio));
  if (Number.isFinite(+L.cornerRadius)) conn.cornerRadius = Math.max(0, Math.min(40, +L.cornerRadius));
  if (L.labelBgColor) conn.labelBgColor = L.labelBgColor;
  if (L.labelBorderColor) conn.labelBorderColor = L.labelBorderColor;
  if (Number.isFinite(+L.labelBorderWidth)) conn.labelBorderWidth = +L.labelBorderWidth;
  if (L.labelTextColor) conn.labelTextColor = L.labelTextColor;
  if (L.fontBold !== undefined) conn.fontBold = !!L.fontBold;
  if (L.fontItalic !== undefined) conn.fontItalic = !!L.fontItalic;
  if (L.textVisible === false) conn.textVisible = false;
  else if (L.textVisible === true) conn.textVisible = true;
  if (L.textAlongPath === true) conn.textAlongPath = true;
  if (L.textAutoFlip === false) conn.textAutoFlip = false;
  else if (L.textAutoFlip === true) conn.textAutoFlip = true;
  if (Number.isFinite(+L.textShadowWidth) && +L.textShadowWidth > 0) conn.textShadowWidth = +L.textShadowWidth;
  if (L.textShadowColor) conn.textShadowColor = L.textShadowColor;
}

function bdApplyAutoStyle(rootId) {
  const root = bd.nodes.find(n => n.id === rootId);
  if (!root || !root._autoStyle) return;
  const nodeDepth = new Map();
  function apply(nid, depth) {
    const n = bd.nodes.find(v => v.id === nid); if (!n) return;
    nodeDepth.set(nid, depth);
    _bdApplyDepthCardFieldsToNode(n, bdGetAutoStyleForDepth(depth));
    bdChildren(nid).forEach(c => apply(c.id, depth + 1));
  }
  apply(rootId, 0);
  // ライン (親→子) に深さベースのラインスタイルを適用。
  // 対象: from ノードがこの _autoStyle ツリー内にあり、かつ to もツリー内にあるライン (= 階層間のライン)。
  // ツリー内から外部 / 外部からツリー内のラインはスキップ。
  if (Array.isArray(bd.connections)) {
    bd.connections.forEach(c => {
      if (!c) return;
      const d = nodeDepth.get(c.from);
      if (d === undefined) return;
      if (!nodeDepth.has(c.to)) return;
      _bdApplyDepthLineFieldsToConn(c, bdGetAutoStyleForDepth(d));
    });
  }
}
