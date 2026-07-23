/* gb-canvas-features.part00.js: board theme color helpers */
(function (global) {
  'use strict';

  const FALLBACK_THEME_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

  function readableTextColor(bgColor) {
    const hex = typeof bgColor === 'string' && bgColor.match(/^#([0-9a-f]{6})$/i) ? bgColor : '';
    if (!hex) return '';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#1e1e1e' : '#ffffff';
  }

  function getThemeColorSet(board) {
    if (global.MeldexThemeManager && typeof global.MeldexThemeManager.getBoardThemeColorSet === 'function') {
      const palette = global.MeldexThemeManager.getBoardThemeColorSet(board);
      if (Array.isArray(palette) && palette.length) return palette;
    }
    return FALLBACK_THEME_COLORS.slice();
  }

  function buildDefaultDepthStyles(baseStyles, emptyDepthLine, board) {
    const palette = getThemeColorSet(board);
    const emptyLine = typeof emptyDepthLine === 'function' ? emptyDepthLine : () => ({});
    return (Array.isArray(baseStyles) ? baseStyles : []).map((style, index) => {
      const rawValue = style && style._themeColorIndex;
      const rawThemeIndex = Number.isFinite(+rawValue) ? +rawValue : index;
      const themeIndex = Math.max(0, Math.floor(rawThemeIndex));
      const color = palette[themeIndex % palette.length] || style.bgColor || '';
      const line = style?.line && typeof style.line === 'object' ? style.line : {};
      return {
        ...style,
        bgColor: color,
        textColor: readableTextColor(color) || style.textColor || '',
        borderColor: color,
        line: { ...emptyLine(), ...line, color: color || line.color || '' },
      };
    });
  }

  function parentChildHighlightPalette() {
    return getThemeColorSet(typeof bd !== 'undefined' ? bd : undefined);
  }

  function parentChildGroups(options = {}) {
    if (typeof bd === 'undefined' || !Array.isArray(bd.nodes)) return new Map();
    const palette = parentChildHighlightPalette();
    if (!palette.length) return new Map();
    const hiddenIds = options.hiddenIds instanceof Set ? options.hiddenIds : new Set();
    const drillRoot = options.drillRoot || '';
    const drillScope = new Set();
    if (drillRoot) {
      drillScope.add(drillRoot);
      if (typeof bdDescendants === 'function') bdDescendants(drillRoot).forEach(id => drillScope.add(id));
    }
    const isVisible = node => node && !hiddenIds.has(node.id) && (!drillRoot || drillScope.has(node.id));
    const rootOf = node => {
      let cur = node;
      let guard = 0;
      const guardLimit = Math.max(50, bd.nodes.length + 1);
      const seen = new Set();
      while (cur?.parent && guard < guardLimit) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        const parent = bd.nodes.find(v => v.id === cur.parent);
        if (!parent) break;
        cur = parent;
        guard += 1;
      }
      return cur?.id || '';
    };
    const groups = new Map();
    bd.nodes.forEach(node => {
      if (!isVisible(node)) return;
      const rootId = rootOf(node);
      if (!rootId) return;
      if (!groups.has(rootId)) groups.set(rootId, []);
      groups.get(rootId).push(node.id);
    });
    const result = new Map();
    [...groups.keys()].filter(rootId => (groups.get(rootId) || []).length >= 2).sort().forEach((rootId, index) => {
      const color = palette[index % palette.length];
      groups.get(rootId).forEach(id => result.set(id, color));
    });
    return result;
  }

  function normalizeConnectionArrow(conn) {
    const rawArrow = conn && Object.prototype.hasOwnProperty.call(conn, 'arrow')
      ? conn.arrow
      : (typeof global.bdGetConnectionStyle === 'function' ? global.bdGetConnectionStyle(conn)?.arrow : conn?.arrow);
    if (rawArrow === true) return 'end';
    if (rawArrow === 'end' || rawArrow === 'start' || rawArrow === 'both') return rawArrow;
    return '';
  }

  function defaultStructureArrow(structure) {
    return structure === 'flowchart' ? 'end' : '';
  }

  function createStructureConnection(fromId, toId, structure) {
    const arrow = defaultStructureArrow(structure);
    if (typeof global.bdCreateConnectionWithStyle === 'function') {
      return global.bdCreateConnectionWithStyle(fromId, toId, { arrow });
    }
    return {
      id: typeof global.bdId === 'function' ? global.bdId() : '',
      from: fromId || '',
      to: toId || '',
      label: '',
      style: '',
      arrow,
    };
  }

  function pickFallbackLinkifyRoot(selectedIds) {
    const indeg = new Map();
    selectedIds.forEach(id => indeg.set(id, 0));
    (bd.connections || []).forEach(conn => {
      if (!selectedIds.has(conn.from) || !selectedIds.has(conn.to)) return;
      const arrow = normalizeConnectionArrow(conn);
      if (arrow === 'end') indeg.set(conn.to, (indeg.get(conn.to) || 0) + 1);
      else if (arrow === 'start') indeg.set(conn.from, (indeg.get(conn.from) || 0) + 1);
    });
    const zeroIn = [...selectedIds].filter(id => (indeg.get(id) || 0) === 0);
    if (zeroIn.length === 1) return zeroIn[0];
    if (bd._activeNode && selectedIds.has(bd._activeNode)) return bd._activeNode;
    return [...selectedIds][0] || '';
  }

  async function linkifySelectionToTree(rootId) {
    if (typeof bd === 'undefined' || !bd.selected || bd.selected.size < 2) {
      showStatus('2枚以上選択してください', true);
      return { assigned: 0, unreachable: 0, skippedContained: 0, skippedUser: false };
    }
    const selectedIds = new Set([...bd.selected]);
    const containedIds = new Set([...selectedIds].filter(id => !!bd.nodes.find(v => v.id === id)?.contained));
    const eligibleIds = new Set([...selectedIds].filter(id => !containedIds.has(id)));
    if (eligibleIds.size < 2) {
      showStatus('内包カードはラインから親子化の対象外です', true);
      return { assigned: 0, unreachable: 0, skippedContained: containedIds.size, skippedUser: false };
    }
    if (!eligibleIds.has(rootId)) rootId = pickFallbackLinkifyRoot(eligibleIds);
    if (!rootId) {
      showStatus('ルート候補が見つかりません', true);
      return { assigned: 0, unreachable: 0, skippedContained: containedIds.size, skippedUser: false };
    }
    const hasExistingParent = [...eligibleIds].some(id => {
      const node = bd.nodes.find(v => v.id === id);
      return !!(node && node.parent);
    });
    if (hasExistingParent) {
      const ok = await cfConfirm('選択内に既に親子関係が設定されているカードがあります。ラインに基づき上書きしますか？');
      if (!ok) return { assigned: 0, unreachable: 0, skippedContained: 0, skippedUser: true };
    }
    const adjacency = new Map();
    eligibleIds.forEach(id => adjacency.set(id, []));
    (bd.connections || []).forEach(conn => {
      if (!eligibleIds.has(conn.from) || !eligibleIds.has(conn.to)) return;
      const arrow = normalizeConnectionArrow(conn);
      if (arrow === 'end' || arrow === '' || arrow === 'both') adjacency.get(conn.from)?.push(conn.to);
      if (arrow === 'start' || arrow === '' || arrow === 'both') adjacency.get(conn.to)?.push(conn.from);
    });
    if (![...adjacency.values()].some(list => list.length > 0)) {
      showStatus('選択内にラインがないため親子化できませんでした', true);
      return { assigned: 0, unreachable: eligibleIds.size - 1, skippedContained: containedIds.size, skippedUser: false };
    }

    bdPushUndo();
    eligibleIds.forEach(id => {
      const node = bd.nodes.find(v => v.id === id);
      if (node) node.parent = '';
    });
    const visited = new Set([rootId]);
    const queue = [rootId];
    let assigned = 0;
    let skippedContained = containedIds.size;
    while (queue.length) {
      const current = queue.shift();
      (adjacency.get(current) || []).forEach(next => {
        if (visited.has(next)) return;
        const node = bd.nodes.find(v => v.id === next);
        if (!node) return;
        visited.add(next);
        node.parent = current;
        assigned += 1;
        queue.push(next);
      });
    }
    const unreachable = Math.max(0, eligibleIds.size - visited.size);
    const hasConnEitherWay = (a, b) => (bd.connections || []).some(conn =>
      (conn.from === a && conn.to === b) || (conn.from === b && conn.to === a));
    visited.forEach(id => {
      const node = bd.nodes.find(v => v.id === id);
      if (!node?.parent) return;
      if (hasConnEitherWay(node.parent, node.id)) return;
      const conn = typeof bdCreateConnectionWithStyle === 'function'
        ? bdCreateConnectionWithStyle(node.parent, node.id, { arrow: '' })
        : { from: node.parent, to: node.id, arrow: '', label: '', style: '' };
      bd.connections.push(conn);
    });
    // ツリーに構造があれば整列 (ルートまたは中間カードいずれかに設定あり)
    const hasAnyStructure = [...visited].some(id => {
      const node = bd.nodes.find(v => v.id === id);
      if (!node) return false;
      if (node.structure) return true;
      return typeof bdStructureOf === 'function' && !!bdStructureOf(id);
    });
    if (bd.autoAlign !== false && hasAnyStructure && typeof bdAutoLayout === 'function') bdAutoLayout(rootId);
    bdRender();
    bdDirty();
    if (assigned === 0) {
      showStatus('選択内にラインがないため親子化できませんでした', true);
    } else {
      const parts = [`親子化: ${assigned} 件のカードに親を設定しました`];
      if (unreachable) parts.push(`到達不能 ${unreachable} 件`);
      if (skippedContained) parts.push(`内包カードスキップ ${skippedContained} 件`);
      showStatus(parts.join(' / '));
    }
    return { assigned, unreachable, skippedContained, skippedUser: false };
  }

  global.bdGetThemeColorSet = getThemeColorSet;
  global.bdReadableTextColor = readableTextColor;
  global.bdBuildDefaultDepthStyles = buildDefaultDepthStyles;
  global.bdDefaultStructureArrow = defaultStructureArrow;
  global.bdCreateStructureConnection = createStructureConnection;
  global._bdParentChildGroups = parentChildGroups;
  global.bdLinkifySelectionToTree = linkifySelectionToTree;
})(window);
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
    if (n.contained) return;
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
  const nodeW = nid => sizes[nid]?.w || 160;
  const nodeH = nid => sizes[nid]?.h || 36;
  const subtreeWidthCache = new Map();
  function subtreeW(nid) {
    if (subtreeWidthCache.has(nid)) return subtreeWidthCache.get(nid);
    let width = nodeW(nid);
    if (!_bdIsInnerStructureAtomic(nid, root.id)) {
      layoutCtx.children(nid).forEach(child => {
        width = Math.max(width, subtreeW(child.id));
      });
    }
    subtreeWidthCache.set(nid, width);
    return width;
  }
  function layoutDescendants(nid, x, y) {
    let cy = y;
    layoutCtx.children(nid).forEach(child => {
      const cn = layoutCtx.node(child.id);
      if (!cn) return;
      cn.x = x;
      cn.y = cy;
      if (_bdIsInnerStructureAtomic(child.id, root.id)) {
        cy += nodeH(child.id) + G.level;
        return;
      }
      cy = Math.max(
        cy + nodeH(child.id) + G.level,
        layoutDescendants(child.id, x, cy + nodeH(child.id) + G.level),
      );
    });
    return cy;
  }
  let x = root.x;
  root.y = root.y;
  ch.forEach(c => {
    const cn = layoutCtx.node(c.id);
    if(!cn) return;
    cn.x = x; cn.y = root.y + nodeH(root.id) + G.level;
    // 子タイムポイントが中間カードなら、bbox の左上を (x, cn.y) とみなして水平方向だけ進める。
    if (_bdIsInnerStructureAtomic(cn.id, root.id)) {
      x += Math.max(nodeW(cn.id), 120) + G.sibling;
      return;
    }
    layoutDescendants(cn.id, cn.x, cn.y + nodeH(cn.id) + G.level);
    x += Math.max(subtreeW(cn.id), 120) + G.sibling;
  });
}

function bdLayoutOrgChart(root, sizes, layoutCtx) { bdLayoutFlowchart(root, sizes, layoutCtx); }

// 選択カードに対する Ctrl+矢印操作 (兄弟入れ替え / 子階層の折りたたみ展開) のため、
// ツリーの「展開方向」を判定する。返り値: 'right' | 'left' | 'down' | 'up'
//   1) ルート構造タイプから推定
//      - flowchart / orgchart / tree → 'down' 固定
//      - logic → 'right' 固定
//      - timeline → ルートは 'right'、配下カードは 'down'
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
  if (struct === 'logic') return 'right';
  if (struct === 'timeline') return n.parent ? 'down' : 'right';
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
  const ndx = other.x - n.x, ndy = other.y - n.y;
  const odx = n.x - other.x, ody = n.y - other.y;
  n.x = other.x; n.y = other.y;
  other.x = tx; other.y = ty;
  const movedIds = [n.id, other.id];
  const moveDescendants = (rootId, dx, dy) => {
    if (!dx && !dy) return;
    const ids = typeof bdDescendants === 'function' ? bdDescendants(rootId) : [];
    ids.forEach(id => {
      const node = bd.nodes.find(v => v.id === id);
      if (!node || node.contained) return;
      node.x += dx;
      node.y += dy;
      movedIds.push(id);
    });
  };
  moveDescendants(n.id, ndx, ndy);
  moveDescendants(other.id, odx, ody);
  const root = (typeof bdRoot === 'function') ? bdRoot(nodeId) : null;
  [...new Set(movedIds)].forEach(id => {
    if (typeof bdUpdateNodePosition === 'function') bdUpdateNodePosition(id);
  });
  if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved([...new Set(movedIds)], 'swap-sibling');
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
  const limit = Math.max(50, (bd.nodes || []).length + 1);
  while (cur && guard < limit) {
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
  const initialStructureRootId = (typeof _bdFindStructureRoot === 'function') ? _bdFindStructureRoot(fromNid) : '';
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
    const makeConnection = (fromId, toId, structure) => {
      const arrow = typeof bdDefaultStructureArrow === 'function'
        ? bdDefaultStructureArrow(structure)
        : (structure === 'flowchart' ? 'end' : '');
      if (typeof bdCreateStructureConnection === 'function') return bdCreateStructureConnection(fromId, toId, structure);
      if (typeof bdCreateConnectionWithStyle === 'function') return bdCreateConnectionWithStyle(fromId, toId, { arrow });
      return {
        id: typeof bdId === 'function' ? bdId() : '',
        from: fromId || '',
        to: toId || '',
        label: '',
        style: '',
        arrow,
      };
    };
    let newNode = null;
    if (action === 'child') {
      const nx = isTreeStructure ? n.x + G.level : (isVertical ? n.x : n.x + pw + G.level);
      const ny = isTreeStructure ? n.y + ph + G.sibling : (isVertical ? n.y + ph + G.level : n.y);
      newNode = makeNode('', nx, ny, { parent: fromNid });
      bd.nodes.push(newNode);
      bd.connections.push(makeConnection(fromNid, newNode.id, bdStructureOf(fromNid)));
      if (!initialStructureRootId) {
        const root = bdRoot(fromNid);
        if (root && !root.structure) root.structure = isVertical ? 'flowchart' : 'mindmap';
      }
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
      bd.connections.push(makeConnection(parentId, newNode.id, bdStructureOf(parentId)));
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
      if (!reused) bd.connections.push(makeConnection(oldParentId, newNode.id, bdStructureOf(oldParentId)));
      bd.connections.push(makeConnection(newNode.id, fromNid, bdStructureOf(oldParentId)));
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
    const layoutRootId = (typeof _bdFindStructureRoot === 'function')
      ? (_bdFindStructureRoot(newNode.id) || initialStructureRootId || _bdFindStructureRoot(fromNid))
      : '';
    const rootNode = layoutRootId ? bd.nodes.find(v => v.id === layoutRootId) : bdRoot(newNode.id);
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
  if (node._userCardStyle) return;
  const guardKey = (field) => '_user' + field.charAt(0).toUpperCase() + field.slice(1);
  _BD_DEPTH_CARD_FIELDS.forEach(field => {
    const guarded = field === 'width' ? node._userW : node[guardKey(field)];
    if (guarded) return;
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
// - style:'' は実線、arrow:'' は矢印なしとして明示適用する
// - 色などの空文字列 / undefined / width 0 の項目はスキップ (既存のラインの値を保持)
// - styleRef があるラインでも個別 override として書き込む (カードの depth 適用と同じ方針)
// - conn._userLineStyle が立っていればすべてスキップ
function _bdApplyDepthLineFieldsToConn(conn, depthStyle) {
  if (!conn || !depthStyle || !depthStyle.line) return;
  if (conn._userLineStyle) return;
  const L = depthStyle.line;
  if (L.color) conn.color = L.color;
  if (Number.isFinite(+L.width) && +L.width > 0) conn.width = +L.width;
  if (Object.prototype.hasOwnProperty.call(L, 'style') && (L.style === 'dashed' || L.style === '')) conn.style = L.style;
  if (Object.prototype.hasOwnProperty.call(L, 'arrow') && (L.arrow === 'end' || L.arrow === 'start' || L.arrow === 'both' || L.arrow === '')) conn.arrow = L.arrow;
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
  if (L.textAlongPath !== undefined) conn.textAlongPath = !!L.textAlongPath;
  if (L.textAutoFlip === false) conn.textAutoFlip = false;
  else if (L.textAutoFlip === true) conn.textAutoFlip = true;
  if (Number.isFinite(+L.textShadowWidth)) conn.textShadowWidth = Math.max(0, Math.min(10, +L.textShadowWidth));
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
  // 補助線・兄弟間ライン・参照線はユーザー個別線として保持する。
  if (Array.isArray(bd.connections)) {
    bd.connections.forEach(c => {
      if (!c) return;
      const d = nodeDepth.get(c.from);
      if (d === undefined) return;
      const toNode = bd.nodes.find(n => n.id === c.to);
      if (!toNode || toNode.parent !== c.from || !nodeDepth.has(c.to)) return;
      _bdApplyDepthLineFieldsToConn(c, bdGetAutoStyleForDepth(d));
    });
  }
}
/* gb-canvas-features.part02.js */
// --- 2. Focus (Space キーでフォーカス / 解除) ---
// v0.5.285: フォーカスモード (トグル ON/OFF) は廃止。Space キーを押すだけでフォーカス / 解除できる仕様に統一。
let _bdFocusSaved = null; // フォーカス前のzoom/pan状態
function bdFocusSelected(force) {
  const ids = [...bd.selected];
  if (ids.length !== 1) return;

  // フォーカス中なら解除（元の表示に戻す）
  if (_bdFocusSaved && !force) {
    bd.zoom = _bdFocusSaved.zoom;
    bd.panX = _bdFocusSaved.panX;
    bd.panY = _bdFocusSaved.panY;
    _bdFocusSaved = null;
    bdTransform();
    document.getElementById('bd-zoom-label').textContent = Math.round(bd.zoom * 100) + '%';
    showStatus('フォーカス解除');
    return;
  }

  const n = bd.nodes.find(v => v.id === ids[0]);
  const el = document.getElementById('bdn-' + ids[0]);
  if (!n || !el) return;

  // 現在の状態を保存
  if (!_bdFocusSaved) _bdFocusSaved = { zoom: bd.zoom, panX: bd.panX, panY: bd.panY };

  const canvasEl = document.getElementById('bd-canvas');
  const cw = canvasEl.offsetWidth, ch = canvasEl.offsetHeight;
  const nw = el.offsetWidth, nh = el.offsetHeight;
  const zoom = Math.min(cw / (nw + 40), ch / (nh + 40), 3);
  bd.zoom = zoom;
  bd.panX = cw / 2 - (n.x + nw / 2) * zoom;
  bd.panY = ch / 2 - (n.y + nh / 2) * zoom;
  bdTransform();
  document.getElementById('bd-zoom-label').textContent = Math.round(bd.zoom * 100) + '%';
}
// --- 3. Z-order ---
function bdMoveZ(direction) {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  if (direction === 'front') {
    ids.forEach(id => { const idx = bd.nodes.findIndex(n => n.id === id); if (idx >= 0) { const n = bd.nodes.splice(idx, 1)[0]; bd.nodes.push(n); } });
  } else {
    ids.reverse().forEach(id => { const idx = bd.nodes.findIndex(n => n.id === id); if (idx >= 0) { const n = bd.nodes.splice(idx, 1)[0]; bd.nodes.unshift(n); } });
  }
  bdRender(); bdDirty();
}
// --- 4. Lock ---
function bdToggleLock() {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  const anyLocked = ids.some(id => { const n = bd.nodes.find(v => v.id === id); return n && n.locked; });
  ids.forEach(id => { const n = bd.nodes.find(v => v.id === id); if (n) n.locked = !anyLocked; });
  bdRender(); bdDirty();
  showStatus(anyLocked ? 'ロック解除' : 'ロックしました');
}
// --- 5. Flip / Rotate / Opacity ---
function bdFlip(axis) {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  ids.forEach(id => {
    const n = bd.nodes.find(v => v.id === id); if (!n) return;
    if (axis === 'h') n.flipH = !n.flipH;
    else n.flipV = !n.flipV;
  });
  bdRender(); bdDirty();
}

function bdRotate(deg) {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  ids.forEach(id => {
    const n = bd.nodes.find(v => v.id === id); if (!n) return;
    n.rotate = ((n.rotate || 0) + deg) % 360;
  });
  bdRender(); bdDirty();
}

function bdSetOpacity(val) {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  ids.forEach(id => { const n = bd.nodes.find(v => v.id === id); if (n) n.opacity = val; });
  bdRender(); bdDirty();
}
// --- 8. Color Picker ---
function bdColorPicker() {
  showStatus('画像上をクリックして色を取得...');
  const handler = (e) => {
    const img = e.target.closest('.bd-img');
    if (!img) { document.removeEventListener('click', handler, true); return; }
    e.preventDefault(); e.stopPropagation();
    document.removeEventListener('click', handler, true);
    const canvas2 = document.createElement('canvas');
    const rect = img.getBoundingClientRect();
    canvas2.width = img.naturalWidth || img.width; canvas2.height = img.naturalHeight || img.height;
    const ctx2 = canvas2.getContext('2d'); ctx2.drawImage(img, 0, 0);
    const sx = (e.clientX - rect.left) / rect.width * canvas2.width;
    const sy = (e.clientY - rect.top) / rect.height * canvas2.height;
    const ix = Math.max(0, Math.min(canvas2.width - 1, Math.floor(sx)));
    const iy = Math.max(0, Math.min(canvas2.height - 1, Math.floor(sy)));
    let px;
    try {
      px = ctx2.getImageData(ix, iy, 1, 1).data;
    } catch {
      showStatus('色を取得できませんでした', true);
      return;
    }
    const hex = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    navigator.clipboard.writeText(hex).then(() => showStatus('色をコピー: ' + hex));
  };
  setTimeout(() => document.addEventListener('click', handler, true), 0);
}
// --- 9. Clipboard Paste Image ---
function bdPasteImage() {
  navigator.clipboard.read().then(items => {
    for (const item of items) {
      const imgType = item.types.find(t => t.startsWith('image/'));
      if (imgType) {
        item.getType(imgType).then(blob => {
          const reader = new FileReader();
          reader.onload = () => {
            bdPushUndo();
            const canvasEl = document.getElementById('bd-canvas');
            let pos = { x: 200, y: 160 };
            if (canvasEl && typeof bdScreenToWorld === 'function') {
              const rect = canvasEl.getBoundingClientRect();
              pos = bdScreenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
            } else if (canvasEl) {
              pos = {
                x: ((canvasEl.offsetWidth || 600) / 2 - (bd.panX || 0)) / (bd.zoom || 1),
                y: ((canvasEl.offsetHeight || 400) / 2 - (bd.panY || 0)) / (bd.zoom || 1),
              };
            }
            const n = bdNode('', pos.x - 150, pos.y - 100, 300, 0, { img: reader.result });
            bd.nodes.push(n);
            if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(n)) {
              if (typeof bdRequestFullRender === 'function') bdRequestFullRender('paste-image-fallback');
              else bdRender();
            }
            if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(n.id, 'paste-image');
            if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [n.id] }, 'paste-image');
            bdSelect(n.id); bdDirty();
            showStatus('画像を貼り付けました');
          };
          reader.readAsDataURL(blob);
        });
        return;
      }
    }
    showStatus('クリップボードに画像がありません', true);
  }).catch(() => showStatus('クリップボードアクセスに失敗', true));
}
// --- 10. Canvas Export as Image ---
function _bdExportImageBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const includeRect = (x, y, w, h) => {
    if (![x, y, w, h].every(Number.isFinite)) return;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  bd.nodes.forEach(n => {
    const el = document.getElementById('bdn-' + n.id);
    if (!el) return;
    const pos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(n) : { x: n.x, y: n.y };
    includeRect(pos.x, pos.y, el.offsetWidth || n.w || 160, el.offsetHeight || n.h || 40);
  });
  document.querySelectorAll('#bd-svg .bd-conn-path, #bd-svg .bd-conn-arrow, #bd-svg .bd-conn-label-path').forEach(path => {
    try {
      const b = path.getBBox();
      includeRect(b.x, b.y, b.width, b.height);
    } catch {}
  });
  document.querySelectorAll('.bd-frame, .bd-conn-label, .bd-line-comment-badge').forEach(el => {
    const x = parseFloat(el.style.left);
    const y = parseFloat(el.style.top);
    includeRect(x, y, el.offsetWidth || 0, el.offsetHeight || 0);
  });
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
  const pad = 40;
  return {
    x0: x0 - pad,
    y0: y0 - pad,
    x1: x1 + pad,
    y1: y1 + pad,
    width: Math.max(1, Math.ceil(x1 - x0 + pad * 2)),
    height: Math.max(1, Math.ceil(y1 - y0 + pad * 2)),
  };
}

function _bdLoadHtml2CanvasForExport() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-html2canvas-loader="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.html2canvas), { once: true });
      existing.addEventListener('error', () => reject(new Error('html2canvas の読み込みに失敗しました')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.dataset.html2canvasLoader = '1';
    script.src = 'vendor/html2canvas.min.js';
    script.onload = () => window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas を初期化できませんでした'));
    script.onerror = () => reject(new Error('html2canvas の読み込みに失敗しました'));
    document.head.appendChild(script);
  });
}

function _bdCreateExportStage(world, bounds) {
  const canvasEl = document.getElementById('bd-canvas');
  const bg = canvasEl ? (getComputedStyle(canvasEl).backgroundColor || '#1e1e1e') : '#1e1e1e';
  const stage = document.createElement('div');
  stage.className = 'bd-export-stage';
  stage.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    `width:${bounds.width}px`,
    `height:${bounds.height}px`,
    'overflow:hidden',
    `background:${bg}`,
    'pointer-events:none',
    'z-index:0',
  ].join(';');
  const clone = world.cloneNode(true);
  clone.style.position = 'absolute';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.transformOrigin = '0 0';
  clone.style.transform = `translate(${-bounds.x0}px, ${-bounds.y0}px)`;
  clone.style.minWidth = Math.max(bounds.width, bounds.x1 + Math.abs(bounds.x0)) + 'px';
  clone.style.minHeight = Math.max(bounds.height, bounds.y1 + Math.abs(bounds.y0)) + 'px';
  clone.querySelectorAll('[data-bd-role="svg"]').forEach(svg => {
    const svgWidth = Math.max(bounds.width, bounds.x1 + Math.abs(bounds.x0));
    const svgHeight = Math.max(bounds.height, bounds.y1 + Math.abs(bounds.y0));
    svg.setAttribute('width', String(svgWidth));
    svg.setAttribute('height', String(svgHeight));
    svg.style.width = svgWidth + 'px';
    svg.style.height = svgHeight + 'px';
    svg.style.overflow = 'visible';
  });
  stage.appendChild(clone);
  document.body.appendChild(stage);
  return stage;
}

async function bdExportImage() {
  const world = document.getElementById('bd-world');
  if (!world) return;
  const bounds = _bdExportImageBounds();
  if (!bounds) return;
  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveBlob !== 'function') {
    showStatus('保存ダイアログを初期化できませんでした', true);
    return;
  }
  let stage = null;
  try {
    showStatus('ボード画像を生成中...');
    if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
    stage = _bdCreateExportStage(world, bounds);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const html2canvas = await _bdLoadHtml2CanvasForExport();
    const stageRect = stage.getBoundingClientRect();
    // html2canvasが複雑な内容で極端に時間がかかる／返ってこないことがあるため、
    // 単独版など無期限に固まって見えるのを避ける上限時間を設ける
    // （gb-export-image.js の同種フォールバックと同じ考え方）。
    const canvas = await Promise.race([
      html2canvas(stage, {
        backgroundColor: getComputedStyle(stage).backgroundColor || '#1e1e1e',
        scale: window.devicePixelRatio || 1,
        useCORS: true,
        logging: false,
        x: -stageRect.left,
        y: -stageRect.top,
        width: bounds.width,
        height: bounds.height,
        windowWidth: bounds.width,
        windowHeight: bounds.height,
      }),
      new Promise((_resolve, reject) => setTimeout(
        () => reject(new Error('画像生成がタイムアウトしました（内容が複雑すぎる可能性があります）')),
        25000,
      )),
    ]);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      showStatus('ボードの画像化に失敗しました', true);
      return;
    }
    const path = typeof getCurrentFilePath === 'function' ? getCurrentFilePath() : '';
    const baseName = (typeof MeldexExportSave.guessNameFromPath === 'function')
      ? MeldexExportSave.guessNameFromPath(path, 'board')
      : 'board';
    const stem = String(baseName || 'board').replace(/\.[^.]+$/, '') || 'board';
    MeldexExportSave.saveBlob(blob, {
      filename: stem + '.png',
      extension: '.png',
      dialogTitle: 'ボード画像として保存',
      filetypes: [['PNGファイル', '*.png'], ['すべてのファイル', '*.*']],
      okMessage: 'ボードをエクスポートしました',
      errorMessage: 'ボードの保存に失敗しました',
    });
  } catch (err) {
    showStatus('ボードの画像化に失敗しました: ' + (err?.message || err), true);
  } finally {
    if (stage) stage.remove();
  }
}
// --- 11. Slideshow ---
let _bdSlideshow = null;
function bdStartSlideshow(interval) {
  const imgNodes = bd.nodes.filter(n => n.img);
  if (!imgNodes.length) { showStatus('画像カードがありません', true); return; }
  let idx = 0;
  _bdSlideshow = { nodes: imgNodes, interval: interval || 5000 };
  const show = () => {
    if (!_bdSlideshow) return;
    const n = imgNodes[idx];
    bd.selected = new Set([n.id]);
    bdFocusSelected(true);
    document.querySelectorAll('.bd-node').forEach(el => el.classList.toggle('bd-selected', bd.selected.has(el.id.replace('bdn-', ''))));
    if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
    idx = (idx + 1) % imgNodes.length;
    _bdSlideshow.timer = setTimeout(show, _bdSlideshow.interval);
  };
  show();
  showStatus('スライドショー開始（Escで停止）');
}
function bdStopSlideshow() {
  if (_bdSlideshow) { clearTimeout(_bdSlideshow.timer); _bdSlideshow = null; showStatus('スライドショー停止'); }
}
// --- 12. Background Color ---
function bdSetBackground(color) {
  document.getElementById('bd-canvas').style.background = color;
  bd._bgColor = color;
  bdDirty();
}
// --- Find & Replace は gb-board-find.js に分離済み (v0.5.287) ---

// --- Numbering ---
function bdToggleNumbering() {
  bd._numbering = !bd._numbering;
  bdRender(); bdDirty();
  showStatus(bd._numbering ? '番号付けON' : '番号付けOFF');
}
function _bdGetNumber(nodeId) {
  if (!bd._numbering) return '';
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n) return '';
  const lineage = [];
  let cur = n;
  const seen = new Set();
  const limit = Math.max(50, (bd.nodes || []).length + 1);
  let guard = 0;
  while (cur && !seen.has(cur.id) && guard < limit) {
    seen.add(cur.id);
    lineage.unshift(cur);
    if (!cur.parent) break;
    const parentId = cur.parent;
    cur = bd.nodes.find(v => v.id === parentId);
    guard += 1;
  }
  if (!lineage.length) return '';
  const nums = [];
  lineage.forEach((node, index) => {
    if (index === 0) {
      const roots = bd.nodes.filter(v => !v.parent);
      const idx = roots.findIndex(v => v.id === node.id);
      if (idx >= 0) nums.push(idx + 1);
      return;
    }
    const parentNode = lineage[index - 1];
    const siblings = bdChildren(parentNode.id);
    const idx = siblings.findIndex(s => s.id === node.id);
    if (idx >= 0) nums.push(idx + 1);
  });
  return nums.length ? nums.join('.') + '. ' : '';
}

// --- Note Panel ---
function bdEditNote(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const o = document.createElement('div'); o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="min-width:500px;">
    <h3>ノート: ${esc((n.text||'').split('\n')[0].slice(0,30))}</h3>
    <textarea id="bd-note-text" rows="12" style="width:100%;font-size:13px;padding:8px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;resize:vertical;">${esc(n.note || '')}</textarea>
    <div class="btn-row">
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" data-action="_bdSaveNote('${nodeId}')">保存</button>
    </div>
  </div>`;
  document.body.appendChild(o);
}
function _bdSaveNote(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  n.note = document.getElementById('bd-note-text').value;
  document.querySelector('.modal-overlay').remove();
  bdRender(); bdDirty();
  showStatus('ノートを保存しました');
}

// --- Checkbox + Progress ---
function bdToggleCheck(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  if (n.checked === undefined) n.checked = false;
  n.checked = !n.checked;
  bdRender(); bdDirty();
}
function bdSetProgress(nodeId, pct) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  n.progress = pct;
  bdRender(); bdDirty();
}

// --- Summary ---
function bdAddSummary() {
  const ids = [...bd.selected]; if (ids.length < 2) { showStatus('2つ以上のカードを選択してください', true); return; }
  bdPushUndo();
  let maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  ids.forEach(id => {
    const n = bd.nodes.find(v => v.id === id);
    if (!n) return;
    const el = document.getElementById('bdn-' + id);
    if (n && el) {
      const pos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(n) : { x: n.x, y: n.y };
      maxX = Math.max(maxX, pos.x + el.offsetWidth);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y + el.offsetHeight);
    }
  });
  if (!Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    showStatus('表示中のカードを選択してください', true);
    return;
  }
  const summary = (typeof bdCreateNodeWithStyle === 'function')
    ? bdCreateNodeWithStyle('集約', maxX + 40, (minY + maxY) / 2 - 18, { w: 120 })
    : bdNode('集約', maxX + 40, (minY + maxY) / 2 - 18, 120, 0, {});
  summary._summaryOf = ids.slice();
  bd.nodes.push(summary);
  ids.forEach(id => {
    const conn = typeof bdCreateConnectionWithStyle === 'function'
      ? bdCreateConnectionWithStyle(id, summary.id, { arrow: 'end', style: 'dashed' })
      : { from: id, to: summary.id, arrow: 'end', label: '', style: 'dashed' };
    bd.connections.push(conn);
  });
  // 追加直後のインライン編集は発火させない (F2 / ダブルクリックで編集開始)
  bdRender(); bdSelect(summary.id); bdDirty();
}

// --- Drill Down ---
let _bdDrillRoot = null;
function bdDrillDown(nodeId) {
  _bdDrillRoot = nodeId;
  bdRender();
  showStatus('ドリルダウン表示中（カードまたはボードのメニューから「ドリルダウン解除」で戻れます）');
}
function bdDrillUp() {
  _bdDrillRoot = null;
  bdRender();
  showStatus('全体表示に戻りました');
}

// --- Markers ---
// 2026-04-18: board-card-popup-redesign-plan.md §3.3/§4.2 に沿って progress カテゴリを廃止。
// ステータスと役割が重複するため priority / flag のみ残す。既存の n.markers.progress は
// 参照されなくなる (廃止されたカテゴリは HUD / サブメニューから出ない) が、保存データ上は
// 後方互換のため保持される (bdSetMarker で progress を指定しても BD_MARKERS[category] が
// undefined になり、既存 n.markers[progress] が delete される挙動も従来通り)。
const BD_MARKERS = {
  priority: [{icon:'circle',color:'#e74c3c',label:'最優先'},{icon:'circle',color:'#e67e22',label:'高'},{icon:'circle',color:'#f1c40f',label:'中'},{icon:'circle',color:'#2ecc71',label:'低'}],
  flag: [{icon:'flag',color:'#e74c3c',label:'フラグ'},{icon:'star',color:'#f39c12',label:'スター'},{icon:'lightbulb',color:'#f1c40f',label:'アイデア'},{icon:'alertTriangle',color:'#e67e22',label:'注意'},{icon:'helpCircle',color:'#9b59b6',label:'要確認'}],
};
function bdSetMarker(nodeId, category, markerIdx) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  if (!n.markers) n.markers = {};
  const markers = BD_MARKERS[category];
  if (!markers || markerIdx < 0 || markerIdx >= markers.length) { delete n.markers[category]; }
  else { n.markers[category] = markerIdx; }
  bdRender(); bdDirty();
}

// --- カードHUD クリック時のサブメニュー (board-card-popup-redesign-plan.md §7) ---
// カードHUDの左上ステータス/右下マーカー/左下コメントをクリックしたときに、その要素位置に
// ポップアップを開く。既存の .gb-context-menu を流用し、bdContextMenu と共存可能にする。
function _bdCreateHudMenu(rect, options) {
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  if (options?.label) menu.setAttribute('aria-label', options.label);
  menu.style.position = 'fixed';
  menu.style.minWidth = '180px';
  const trigger = options?.trigger || null;
  if (typeof _bdTrackContextMenuTrigger === 'function') _bdTrackContextMenuTrigger(menu, trigger);
  const closeMenu = (restoreFocus = false) => {
    menu.remove();
    if (trigger?.setAttribute) trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && trigger && typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(trigger);
  };
  document.body.appendChild(menu);
  if (typeof positionPopup === 'function') {
    positionPopup(menu, rect);
  } else {
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = (rect.left / z) + 'px';
    menu.style.top = ((rect.bottom + 4) / z) + 'px';
  }
  // 外側クリックで閉じる。bdContextMenu と同じパターン
  setTimeout(() => {
    document.addEventListener('pointerdown', function h(ev) {
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAny) {
        closeMenu(false);
        document.removeEventListener('pointerdown', h);
      }
    }, { once: false });
  }, 0);
  menu.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu(true);
    }
  });
  return menu;
}
function _bdHudMenuItem(htmlLabel, onClick, opts) {
  const d = document.createElement('div');
  d.className = 'gb-context-menu-item';
  d.tabIndex = 0;
  d.setAttribute('role', opts?.role || 'menuitem');
  if (opts?.checked !== undefined) d.setAttribute('aria-checked', opts.checked ? 'true' : 'false');
  d.innerHTML = htmlLabel;
  if (opts?.danger) d.classList.add('danger');
  d.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    try { onClick?.(); } catch {}
  });
  d.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      d.click();
    }
  });
  return d;
}
function _bdHudMenuSep() {
  const d = document.createElement('div');
  d.className = 'gb-context-menu-sep';
  return d;
}
function _bdRepositionHudMenu(menu, rect) {
  if (!menu || !rect) return;
  if (typeof positionPopup === 'function') {
    positionPopup(menu, rect);
  } else if (typeof clampPopupToViewport === 'function') {
    clampPopupToViewport(menu);
  }
}
function _bdCheckMark(isActive) {
  return isActive ? lucide('check', 12) + ' ' : '<span style="display:inline-block;width:14px;"></span>';
}

function bdStatusMenuFor(nodeId, rect, trigger) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const menu = _bdCreateHudMenu(rect, { label: 'ステータス', trigger });
  const targetIds = bd.selected.has(nodeId) ? [...bd.selected] : [nodeId];
  const setStatus = (st) => {
    bdPushUndo();
    targetIds.forEach(id => { const nd = bd.nodes.find(v => v.id === id); if (nd) nd.status = st; });
    bdRender(); bdDirty();
  };
  const curStatus = n.status || '';
  // 「なし」項目
  menu.appendChild(_bdHudMenuItem(_bdCheckMark(!curStatus) + 'なし', () => setStatus(''), { role: 'menuitemradio', checked: !curStatus }));
  bdStatusNames().filter(s => !!s).forEach(st => {
    const sd = bdStatusDef(st);
    const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${sd.color};margin-right:4px;vertical-align:middle;"></span>`;
    menu.appendChild(_bdHudMenuItem(_bdCheckMark(curStatus === st) + dot + esc(st), () => setStatus(st), { role: 'menuitemradio', checked: curStatus === st }));
  });
  menu.appendChild(_bdHudMenuSep());
  menu.appendChild(_bdHudMenuItem('ステータスを管理...', () => {
    if (typeof bdManageStatuses === 'function') bdManageStatuses();
  }));
  _bdRepositionHudMenu(menu, rect);
  requestAnimationFrame(() => _bdFocusContextMenuItem(menu, 'first'));
}

function bdMarkerMenuFor(nodeId, rect, trigger) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const menu = _bdCreateHudMenu(rect, { label: 'マーカー', trigger });
  const markers = n.markers || {};
  // 2026-04-18: BD_MARKERS.progress 廃止に伴い progress ラベルは不要。priority / flag のみ保持。
  const categoryLabels = { priority: '優先度', flag: 'フラグ' };
  const entries = Object.entries(BD_MARKERS);
  entries.forEach(([cat, list], catIdx) => {
    if (catIdx > 0) menu.appendChild(_bdHudMenuSep());
    _bdContextMenuLabel(menu, categoryLabels[cat] || cat);
    list.forEach((mk, idx) => {
      const isActive = markers[cat] === idx;
      const iconHtml = typeof bdMarkerIconHtml === 'function' ? bdMarkerIconHtml(mk, 12) : lucide(mk.icon, 12);
      const iconSpan = `<span style="color:${mk.color};margin-right:4px;vertical-align:middle;">${iconHtml}</span>`;
      menu.appendChild(_bdHudMenuItem(
        _bdCheckMark(isActive) + iconSpan + esc(mk.label),
        () => { bdPushUndo(); bdSetMarker(nodeId, cat, isActive ? -1 : idx); },
        { role: 'menuitemcheckbox', checked: isActive }
      ));
    });
  });
  if (markers && Object.keys(markers).length > 0) {
    menu.appendChild(_bdHudMenuSep());
    menu.appendChild(_bdHudMenuItem('すべてクリア', () => {
      bdPushUndo();
      const n2 = bd.nodes.find(v => v.id === nodeId);
      if (n2) n2.markers = {};
      bdRender(); bdDirty();
    }));
  }
  _bdRepositionHudMenu(menu, rect);
  requestAnimationFrame(() => _bdFocusContextMenuItem(menu, 'first'));
}

function bdCommentMenuFor(nodeId, rect, trigger) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const menu = _bdCreateHudMenu(rect, { label: 'コメント', trigger });
  const filePath = (bd?.path || '').trim();
  // Audit-P1 H-5: HUD の rect を仮想アンカーとしてインライン textarea を配置する
  const anchorRect = rect || (menu && menu.getBoundingClientRect ? menu.getBoundingClientRect() : null);
  const anchorEl = anchorRect ? { getBoundingClientRect: () => anchorRect } : null;
  menu.appendChild(_bdHudMenuItem('コメントを追加', () => {
    if (typeof addCommentHere !== 'function') return;
    if (!filePath) {
      if (typeof showStatus === 'function') showStatus('コメント対象のボードパスを取得できませんでした', true);
      return;
    }
    const snap = (n.text || '').trim().slice(0, 120);
    addCommentHere({
      targetKind: 'board_card', filePath,
      targetRef: { file: filePath, cardId: nodeId },
      snapshot: snap,
    }, anchorEl ? { anchorEl } : undefined);
  }));
  menu.appendChild(_bdHudMenuItem('コメント一覧を開く', () => {
    // 注釈パネルを開き、このカードに絞り込んだフィルタを設定 (CommentBadges._openPanelForTarget 相当)
    if (typeof openRightPanelTab === 'function') openRightPanelTab('annotation');
    else if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('annotation');
    const typeSel = document.getElementById('rp-ann-type'); if (typeSel) typeSel.value = 'comment';
    const scopeSel = document.getElementById('rp-ann-scope'); if (scopeSel) scopeSel.value = 'current';
    const searchEl = document.getElementById('rp-ann-search');
    if (searchEl) {
      searchEl.value = '';
      searchEl.dataset.targetFilter = JSON.stringify({
        targetPath: filePath, targetKind: 'board_card',
        targetRef: { file: filePath, cardId: nodeId },
      });
    }
    if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
  }));
  _bdRepositionHudMenu(menu, rect);
  requestAnimationFrame(() => _bdFocusContextMenuItem(menu, 'first'));
}

// --- 下部ツールバーのズーム倍率ラベルをクリックしたときのドロップダウン ---
// プリセット倍率 + フィットマップを選択可能にする。
function bdShowZoomMenu(anchor) {
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  anchor.setAttribute('aria-haspopup', 'menu');
  const menu = _bdCreateHudMenu(rect, { trigger: anchor });
  menu.setAttribute('aria-label', '表示倍率');
  menu.style.minWidth = '120px';
  const levels = [500, 400, 300, 200, 150, 120, 100, 80, 50, 20, 10];
  const currentPct = Math.round((bd.zoom || 1) * 100);
  const applyZoom = (pct) => {
    const oz = bd.zoom || 1;
    bd.zoom = pct / 100;
    // ビューポート中心を軸にズーム (ラベルからの操作はカーソル位置ではなく中心基準)
    const canvas = document.getElementById('bd-canvas');
    if (canvas) {
      const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
      bd.panX = cx - (cx - bd.panX) * (bd.zoom / oz);
      bd.panY = cy - (cy - bd.panY) * (bd.zoom / oz);
    }
    bdTransform();
  };
  levels.forEach(pct => {
    menu.appendChild(_bdHudMenuItem(_bdCheckMark(pct === currentPct) + pct + '%', () => applyZoom(pct)));
  });
  menu.appendChild(_bdHudMenuSep());
  menu.appendChild(_bdHudMenuItem('<span style="display:inline-block;width:14px;"></span>フィットマップ', () => {
    if (typeof bdFitAll === 'function') bdFitAll();
  }));
  if (typeof positionPopup === 'function') {
    positionPopup(menu, rect);
  } else if (typeof clampPopupToViewport === 'function') {
    clampPopupToViewport(menu);
  }
  requestAnimationFrame(() => {
    if (menu.isConnected) menu.querySelector('.gb-context-menu-item')?.focus?.();
  });
}

// v0.5.285 でフローティングミニマップ (bdToggleMinimap / _bdDrawFloatingMinimap /
// _bdMinimapVisible) を削除。ビューワーパネル側のミニマップ (gb-canvas-minimap.js
// `_bdDrawPreviewMinimap`) で同じ目的を達成するため。

// --- Node Shapes ---
const BD_SHAPES = ['rect','ellipse','pill','octagon','cloud','fluffy','thorn','thorn-curve'];
const BD_SHAPE_LABELS = {rect:'矩形',ellipse:'楕円',pill:'ピル',octagon:'八角形',cloud:'雲',fluffy:'もやもや',thorn:'トゲ（直線）','thorn-curve':'トゲ（曲線）'};
function bdSetShape(nodeId, shape) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  n.shape = BD_SHAPES.includes(shape) && shape !== 'rect' ? shape : '';
  bdRender(); bdDirty();
}

// --- Font Settings ---
async function bdSetFont(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const size = await cfPrompt('フォントサイズ (px)', n.fontSize || '13');
  if (size === null) return;
  n.fontSize = parseInt(size) || 13;
  const bold = await cfConfirm('太字にしますか？');
  n.fontBold = bold;
  bdRender(); bdDirty();
}

// --- Resize Selected ---
async function bdResizeSelected() {
  const ids=[...bd.selected]; if(!ids.length) return;
  const first=bd.nodes.find(n=>n.id===ids[0]);
  const w=await cfPrompt('幅 (px)', Math.round(first?.w||160));
  const h=await cfPrompt('高さ (px, 0=自動)', Math.round(first?.h||0));
  if(w===null || h===null) return;
  bdPushUndo();
  ids.forEach(id=>{ const n=bd.nodes.find(v=>v.id===id); if(n){n.w=parseInt(w)||160; n.h=parseInt(h)||0;} });
  bdRender(); bdDirty();
}

// --- 14. Context Menus ---
function _bdCloseAllContextMenus() {
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
}

function _bdTrackContextMenuTrigger(menu, trigger) {
  if (!menu || !trigger?.setAttribute) return;
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'true');
  if (typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(() => {
    if (menu.isConnected) return;
    trigger.setAttribute('aria-expanded', 'false');
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true });
}

function _bdVisibleContextMenuItems(menu) {
  return [...(menu?.querySelectorAll?.('.gb-context-menu-item') || [])]
    .filter(item => !item.classList.contains('disabled')
      && item.getAttribute('aria-disabled') !== 'true'
      && item.offsetParent !== null);
}

function _bdFocusContextMenuItem(menu, direction) {
  const items = _bdVisibleContextMenuItems(menu);
  if (!items.length) return;
  const current = document.activeElement;
  const idx = Math.max(0, items.indexOf(current));
  const nextIdx = direction === 'first' ? 0
    : direction === 'last' ? items.length - 1
    : (idx + direction + items.length) % items.length;
  items[nextIdx]?.focus?.();
}

function _bdEnhanceContextMenu(menu, label) {
  if (!menu) return menu;
  menu.classList.add('gb-context-menu');
  menu.setAttribute('role', 'menu');
  if (label) menu.setAttribute('aria-label', label);
  if (menu.dataset.bdMenuEnhanced === '1') return menu;
  menu.dataset.bdMenuEnhanced = '1';
  menu.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      _bdCloseAllContextMenus();
      return;
    }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); _bdFocusContextMenuItem(menu, 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); _bdFocusContextMenuItem(menu, -1); }
    else if (ev.key === 'Home') { ev.preventDefault(); _bdFocusContextMenuItem(menu, 'first'); }
    else if (ev.key === 'End') { ev.preventDefault(); _bdFocusContextMenuItem(menu, 'last'); }
  });
  return menu;
}

function _bdContextMenuItem(parent, label, fn, opts) {
  const options = opts || {};
  const item = document.createElement('div');
  item.className = 'gb-context-menu-item';
  item.tabIndex = options.disabled ? -1 : 0;
  item.setAttribute('role', options.role || 'menuitem');
  if (options.checked !== undefined) item.setAttribute('aria-checked', options.checked ? 'true' : 'false');
  if (options.disabled) {
    item.classList.add('disabled');
    item.setAttribute('aria-disabled', 'true');
  }
  if (options.danger) item.classList.add('danger');
  if (options.html === false) item.textContent = String(label || '');
  else item.innerHTML = label;
  const activate = ev => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (options.disabled) return;
    _bdCloseAllContextMenus();
    fn?.();
  };
  item.addEventListener('click', activate);
  item.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') activate(ev);
  });
  parent?.appendChild?.(item);
  return item;
}

function _bdContextMenuLabel(parent, label) {
  const item = document.createElement('div');
  item.className = 'gb-context-menu-label';
  item.textContent = label;
  item.setAttribute('role', 'presentation');
  parent?.appendChild?.(item);
  return item;
}

function _bdContextMenuSep(parent) {
  const sep = document.createElement('div');
  sep.className = 'gb-context-menu-sep bd-cm-sep';
  sep.setAttribute('role', 'separator');
  parent?.appendChild?.(sep);
  return sep;
}

function _bdCreateContextSubmenu(menu, label, minWidth) {
  const wrap = document.createElement('div');
  wrap.className = 'gb-context-menu-submenu';
  const trigger = document.createElement('div');
  trigger.className = 'gb-context-menu-item has-submenu';
  trigger.innerHTML = esc(label);
  trigger.tabIndex = 0;
  trigger.setAttribute('role', 'menuitem');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const panel = _bdEnhanceContextMenu(document.createElement('div'), label);
  panel.style.cssText = `display:none;min-width:${minWidth || 120}px;`;
  attachHoverSubmenu(trigger, panel);
  trigger.addEventListener('mouseenter', () => trigger.setAttribute('aria-expanded', 'true'));
  trigger.addEventListener('mouseleave', () => setTimeout(() => {
    if (panel.style.display === 'none') trigger.setAttribute('aria-expanded', 'false');
  }, 220));
  panel.addEventListener('mouseleave', () => setTimeout(() => {
    if (panel.style.display === 'none') trigger.setAttribute('aria-expanded', 'false');
  }, 220));
  trigger.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => _bdFocusContextMenuItem(panel, 'first'));
  });
  panel.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowLeft') return;
    ev.preventDefault();
    panel.style.display = 'none';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus?.();
  });
  wrap.appendChild(trigger);
  wrap.appendChild(panel);
  menu.appendChild(wrap);
  return panel;
}

function _bdApplyCardStyleFromMenu(nodeIds, styleId) {
  const ids = [...new Set((nodeIds || []).filter(Boolean))];
  if (!ids.length) return;
  bdPushUndo();
  if (typeof _bdAssignCardStyleToNodes === 'function') _bdAssignCardStyleToNodes(ids, styleId);
  else ids.forEach(nodeId => {
    const node = bd.nodes.find(item => item.id === nodeId);
    if (!node) return;
    node.cardStyle = styleId || '';
    if (styleId) node._userCardStyle = true;
    else delete node._userCardStyle;
  });
  bdRender();
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
}

// ノードを「階層別スタイル」に戻す。
// - cardStyle (個別カードスタイル参照) をクリア
// - bdClearCardStyleOverrides で per-node 視覚 override を削除
// - _userCardStyle / _userBgColor / _userFontSize / _userFontBold / _userW フラグを削除
//   （これらが立っていると bdApplyAutoStyle が深さ別の値で上書きしないため、
//    フラグを消して階層スタイルが効くようにする）
// - 対象ノードからルートまで遡り、ルートに _autoStyle: true があれば
//   bdApplyAutoStyle を再実行して深さ別スタイルを再適用する。
function _bdRestoreCardToHierarchy(nodeIds) {
  const ids = [...new Set((nodeIds || []).filter(Boolean))];
  if (!ids.length) return;
  bdPushUndo();
  const rootsToReapply = new Set();
  ids.forEach(nodeId => {
    const node = bd.nodes.find(item => item.id === nodeId);
    if (!node) return;
    node.cardStyle = '';
    if (typeof bdClearCardStyleOverrides === 'function') bdClearCardStyleOverrides(node);
    delete node._userCardStyle;
    delete node._userBgColor;
    delete node._userFontSize;
    delete node._userFontBold;
    delete node._userW;
    let cur = node;
    const guard = new Set();
    while (cur && cur.parent && !guard.has(cur.id)) {
      guard.add(cur.id);
      const parent = bd.nodes.find(n => n.id === cur.parent);
      if (!parent) break;
      cur = parent;
    }
    if (cur && cur._autoStyle) rootsToReapply.add(cur.id);
  });
  if (typeof bdApplyAutoStyle === 'function') {
    rootsToReapply.forEach(rid => bdApplyAutoStyle(rid));
  }
  bdRender();
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  if (typeof showStatus === 'function') {
    showStatus(rootsToReapply.size
      ? '階層別スタイルに戻しました'
      : '個別スタイルを解除しました（ルートカードで「階層別スタイル」を有効にすると深さ別スタイルが反映されます）');
  }
}

function _bdApplyLineStyleFromMenu(connIds, styleId) {
  const ids = [...new Set((connIds || []).filter(Boolean))];
  if (!ids.length) return;
  bdPushUndo();
  if (typeof _bdAssignLineStyleToConnections === 'function') _bdAssignLineStyleToConnections(ids, styleId);
  else ids.forEach(connId => {
    const target = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : bd.connections.find(conn => conn.id === connId);
    if (!target) return;
    target.styleRef = styleId || '';
  });
  bdDrawConns({ connIds: ids, reason: 'line-style-menu' });
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
}

// 2026-04-18: board-card-popup-redesign-plan.md §5.2 に沿って再構築。
//   色 / ラインスタイル(実線/破線) / ラインの太さ / 矢印 / ライン形状 / ラベル色 は
//   オプションパネル側に一本化。ポップアップは切替と状態トグルに専念する。
function bdConnContextMenu(e, conn) {
  _bdCloseAllContextMenus();
  const menu = _bdEnhanceContextMenu(document.createElement('div'), 'ラインメニュー');
  _bdTrackContextMenuTrigger(menu, e?.trigger || null);
  {
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    menu.style.left = (e.clientX / z) + 'px';
    menu.style.top = (e.clientY / z) + 'px';
  }
  function item(label, fn) { return _bdContextMenuItem(menu, label, fn); }
  function dangerItem(label, fn) { return _bdContextMenuItem(menu, label, fn, { danger: true }); }
  function sep() { return _bdContextMenuSep(menu); }

  const fromN = bd.nodes.find(n => n.id === conn.from);
  const toN = bd.nodes.find(n => n.id === conn.to);
  const fromLbl = fromN ? fromN.text.split('\n')[0].slice(0, 12) : '?';
  const toLbl = toN ? toN.text.split('\n')[0].slice(0, 12) : '?';
  _bdContextMenuLabel(menu, `${fromLbl} → ${toLbl}`);
  sep();
  item('テキスト編集', () => {
    if (!conn.label) { bdPushUndo(); conn.label = 'テキスト'; conn._labelWasEmpty = true; conn._labelPlaceholderUndoCaptured = true; bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-label-edit' }); bdDirty(); }
    if (typeof bdEditConnLabel === 'function') bdEditConnLabel(conn);
  });
  if (conn.label) {
    item('テキストを削除', () => { bdPushUndo(); conn.label = ''; bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-label-delete' }); bdDirty(); });
  } else {
    item('テキストを追加', () => { bdPushUndo(); conn.label = 'テキスト'; conn._labelWasEmpty = true; conn._labelPlaceholderUndoCaptured = true; bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-label-add' }); bdDirty(); if (typeof bdEditConnLabel === 'function') bdEditConnLabel(conn); });
  }
  item('反転 (from / to 入替)', () => {
    bdPushUndo();
    const tmp = conn.from; conn.from = conn.to; conn.to = tmp;
    const tmpFromPoint = conn.fromPoint;
    const tmpToPoint = conn.toPoint;
    if (tmpToPoint !== undefined) conn.fromPoint = tmpToPoint; else delete conn.fromPoint;
    if (tmpFromPoint !== undefined) conn.toPoint = tmpFromPoint; else delete conn.toPoint;
    const tmpFromAnchor = conn.fromAnchor;
    const tmpToAnchor = conn.toAnchor;
    if (tmpToAnchor !== undefined) conn.fromAnchor = tmpToAnchor; else delete conn.fromAnchor;
    if (tmpFromAnchor !== undefined) conn.toAnchor = tmpFromAnchor; else delete conn.toAnchor;
    if (Array.isArray(conn.controlPoints) && conn.controlPoints.length === 2) {
      conn.controlPoints = [{ ...conn.controlPoints[1] }, { ...conn.controlPoints[0] }];
    }
    if (conn.arrow === 'start') conn.arrow = 'end';
    else if (conn.arrow === 'end') conn.arrow = 'start';
    bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-reverse' }); bdDirty();
  });
  item('複製', () => {
    bdPushUndo();
    const duplicated = { ...conn };
    duplicated.id = typeof bdId === 'function' ? bdId() : ('conn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    // ラベル重複を避けるため clone に「 (コピー)」を付けない。from/to が同じなので別配線として識別できる。
    bd.connections.push(duplicated);
    bdDrawConns({ connIds: [conn.id, duplicated.id], reason: 'conn-menu-duplicate' }); bdDirty();
  });
  // ライン上コメント追加導線。カードとは別の board_line target_kind として保存する。
  item('コメントを追加', () => {
    if (typeof addCommentHere !== 'function') return;
    const filePath = (typeof bd !== 'undefined' && bd?.path) || '';
    const snippet = (conn.label || '').trim().slice(0, 120);
    // 右クリック座標を仮想アンカーとする
    const cx = e.clientX, cy = e.clientY;
    const anchorEl = { getBoundingClientRect: () => ({ left: cx, top: cy, right: cx, bottom: cy, width: 0, height: 0, x: cx, y: cy }) };
    addCommentHere({
      targetKind: 'board_line',
      filePath,
      targetRef: { file: filePath, lineId: conn.id },
      snapshot: snippet || 'ライン',
    }, { anchorEl });
  });
  sep();
  // ラインスタイル サブ (切替のみ。編集はオプションパネル)
  {
    const stylePanel = _bdCreateContextSubmenu(menu, 'ラインスタイル', 140);
    const selectedConnIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
    const targetConnIds = selectedConnIds.includes(conn.id) && selectedConnIds.length > 1 ? selectedConnIds : [conn.id];
    const currentStyleId = conn.styleRef || bd.activeLineStyle || '';
    (bd.lineStyles || []).forEach(style => {
      const si = _bdContextMenuItem(stylePanel, radioMark(currentStyleId === style.id) + esc(style.name || ''), () => {
        if (typeof _bdApplyLineStyleFromMenu === 'function') _bdApplyLineStyleFromMenu(targetConnIds, style.id);
      }, {
        role: 'menuitemradio',
        checked: currentStyleId === style.id,
      });
      if (currentStyleId === style.id) si.style.color = 'var(--accent)';
    });
    if (stylePanel.childElementCount) {
      _bdContextMenuSep(stylePanel);
    }
    _bdContextMenuItem(stylePanel, 'スタイル管理...', () => {
      if (typeof bdOpenLineStyleManager === 'function') bdOpenLineStyleManager();
    });
  }
  // 表示 サブ (非表示/表示 + 前面/背面)
  {
    const viewPanel = _bdCreateContextSubmenu(menu, '表示', 140);
    const isHidden = !!conn.hidden;
    _bdContextMenuItem(viewPanel, isHidden ? '表示する' : '非表示にする', () => {
      bdPushUndo();
      conn.hidden = !isHidden;
      bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-hidden' }); bdDirty();
    });
    _bdContextMenuItem(viewPanel, '前面に移動', () => {
      bdPushUndo();
      const idx = bd.connections.indexOf(conn);
      if (idx >= 0 && idx < bd.connections.length - 1) {
        bd.connections.splice(idx, 1);
        bd.connections.push(conn);
        bdDrawConns(); bdDirty();
      }
    });
    _bdContextMenuItem(viewPanel, '背面に移動', () => {
      bdPushUndo();
      const idx = bd.connections.indexOf(conn);
      if (idx > 0) {
        bd.connections.splice(idx, 1);
        bd.connections.unshift(conn);
        bdDrawConns(); bdDirty();
      }
    });
  }
  // v0.5.320: ライン形状の個別オーバーライドを既定値 (スタイル継承) に戻す
  const hasOverride = !!(conn.fromAnchor || conn.toAnchor
    || (Array.isArray(conn.controlPoints) && conn.controlPoints.length === 2)
    || Number.isFinite(+conn.branchRatio) || Number.isFinite(+conn.cornerRadius));
  if (hasOverride) {
    item('形状を既定にリセット', () => {
      bdPushUndo();
      delete conn.fromAnchor;
      delete conn.toAnchor;
      delete conn.controlPoints;
      delete conn.branchRatio;
      delete conn.cornerRadius;
      bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-reset' });
      bdDirty();
    });
  }
  sep();
  dangerItem('削除', async () => {
    if (!(await cfConfirm('このラインを削除しますか？'))) return;
    bdPushUndo();
    if (typeof bdRemoveConnection === 'function') bdRemoveConnection(conn);
    else { bd.connections = bd.connections.filter(c => c !== conn); bdDrawConns(); bdDirty(); }
  });
  document.body.appendChild(menu);
  if (typeof positionPopup === 'function') {
    positionPopup(menu, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
  } else {
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    const r = menu.getBoundingClientRect();
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    if (r.right / z > vw) menu.style.left = Math.max(4, vw - (r.width / z) - 4) + 'px';
    if (r.bottom / z > vh) menu.style.top = Math.max(4, vh - (r.height / z) - 4) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  setTimeout(() => document.addEventListener('pointerdown', function h(ev) {
    const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
    if (!inAny) {
      document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
      document.removeEventListener('pointerdown', h);
    }
  }, { once: false }), 0);
}
/* gb-canvas-features.part03.js */
// 2026-04-18: 旧 bdConnContextMenu の続き (ライン形状/ラインの太さ/矢印/重複ラインスタイル
//   サブ/削除 と、関数末尾のポジション補正 + 外クリックで閉じる) は part01.js 側の新実装で
//   完結したため、ここでは削除のみ行う。関数定義そのものは part01.js:1109 以降に移設済み。
function bdEditConnLabel(conn) {
  setTimeout(() => {
    if (!conn || !conn.id) return;
    let lbl = document.querySelector(`.bd-conn-label[data-conn-id="${conn.id}"]`);
    if (!lbl && typeof bdDrawConns === 'function') {
      conn._editingInline = true;
      bdDrawConns({ connIds: [conn.id], reason: 'conn-label-edit-html-fallback' });
      lbl = document.querySelector(`.bd-conn-label[data-conn-id="${conn.id}"]`);
    }
    if (!lbl) return;
    lbl.contentEditable = 'true'; lbl.focus();
    const s=window.getSelection(), r=document.createRange();
    r.selectNodeContents(lbl); s.removeAllRanges(); s.addRange(r);
    lbl.style.pointerEvents = 'auto';
    const originalLabel = conn._labelWasEmpty ? '' : (conn.label || '');
    conn._labelEditOriginalLabel = originalLabel;
    const cleanupLabelEditFlags = () => {
      delete conn._labelWasEmpty;
      delete conn._labelPlaceholderUndoCaptured;
      delete conn._labelEditOriginalLabel;
      delete conn._editingInline;
    };
    const finish = () => {
      lbl.contentEditable = 'false';
      const text = lbl.textContent.trim() || '';
      const beforeLabel = conn.label || '';
      const labelBeforePlaceholder = conn._labelEditOriginalLabel || '';
      const placeholderAdd = !!conn._labelWasEmpty && beforeLabel === 'テキスト';
      const nextLabel = (conn._labelWasEmpty && (text === 'テキスト' || text === '')) ? '' : text;
      const changedFromOriginal = nextLabel !== labelBeforePlaceholder;
      if (nextLabel === beforeLabel) {
        const wasInlineNoChange = !!conn._editingInline;
        lbl.style.pointerEvents = '';
        cleanupLabelEditFlags();
        if (wasInlineNoChange && typeof bdDrawConns === 'function') bdDrawConns();
        return;
      }
      if (placeholderAdd && !changedFromOriginal) {
        conn.label = labelBeforePlaceholder;
        lbl.style.pointerEvents = '';
        cleanupLabelEditFlags();
        if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'conn-label-placeholder-cancel' });
        return;
      }
      if ((!placeholderAdd || !conn._labelPlaceholderUndoCaptured) && typeof bdPushUndo === 'function') bdPushUndo();
      // 元々空ラベルだった場合にプレースホルダ「テキスト」のまま確定されたら空に戻す
      conn.label = nextLabel;
      lbl.style.pointerEvents = '';
      // textPath モードから一時的に HTML モードへ切り替えていた場合、編集完了で textPath モードに戻す (Phase 5-2)
      const wasInline = !!conn._editingInline;
      cleanupLabelEditFlags();
      bdDirty();
      if (!conn.label || wasInline) bdDrawConns();
    };
    lbl.onblur = finish;
    lbl.onkeydown = (ke) => {
      if (ke.key === 'Enter') { ke.preventDefault(); lbl.blur(); }
      if (ke.key === 'Escape') {
        lbl.textContent = conn._labelEditOriginalLabel || '';
        lbl.blur();
      }
      ke.stopPropagation();
    };
  }, 50);
}

function _bdSafeInlineColor(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text || /["'<>;]/.test(text)) return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (/^var\(--[a-z0-9_-]+\)$/i.test(text)) return text;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(text)) return text;
  return fallback;
}

function _bdPrepareContextMenuSelection(nodeId) {
  if (!nodeId || !bd.nodes.some(n => n.id === nodeId)) return;
  if (bd.selected instanceof Set && bd.selected.has(nodeId)) return;
  const previous = new Set(bd.selected || []);
  bd.selected = new Set([nodeId]);
  bd._activeNode = nodeId;
  if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
  previous.add(nodeId);
  previous.forEach(id => {
    const el = document.getElementById('bdn-' + id);
    if (el) el.classList.toggle('bd-selected', id === nodeId);
  });
  if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([...previous], 'context-menu');
  if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
}

function bdContextMenu(e, nodeId) {
  _bdCloseAllContextMenus();
  const menu = _bdEnhanceContextMenu(document.createElement('div'), nodeId ? 'カードメニュー' : 'ボードメニュー');
  _bdTrackContextMenuTrigger(menu, e?.trigger || null);
  { const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1); menu.style.left = (e.clientX/z)+'px'; menu.style.top = (e.clientY/z)+'px'; }
  const contextAnchorEl = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) };
  function item(label, fn) { return _bdContextMenuItem(menu, label, fn); }
  function dangerItem(label, fn) { return _bdContextMenuItem(menu, label, fn, { danger: true }); }
  function sep() { return _bdContextMenuSep(menu); }
  function sub(label) {
    const panel = _bdCreateContextSubmenu(menu, label, 140);
    return {
      item(l, fn, opts) { return _bdContextMenuItem(panel, l, fn, opts); },
      sep() { return _bdContextMenuSep(panel); },
      label(text) { return _bdContextMenuLabel(panel, text); },
      raw(el) { panel.appendChild(el); return el; },
      panel,
    };
  }

  if (nodeId) _bdPrepareContextMenuSelection(nodeId);
  const multi = !!(nodeId && bd.selected instanceof Set && bd.selected.has(nodeId) && bd.selected.size > 1);
  const nd = nodeId ? bd.nodes.find(n=>n.id===nodeId) : null;
  const connColors = ['','#ef4444','#3b82f6','#22c55e','#f97316','#8b5cf6','#ec4899','#eab308'];
  const colorLabels = {'':'デフォルト','#ef4444':'赤','#3b82f6':'青','#22c55e':'緑','#f97316':'橙','#8b5cf6':'紫','#ec4899':'桃','#eab308':'黄'};
  const currentImageDropMode = typeof bdGetImageDropMode === 'function' ? bdGetImageDropMode() : 'link';
  const imageDropCheck = mode => currentImageDropMode === mode ? (typeof lucide === 'function' ? lucide('checkSquare', 12) + ' ' : '') : '';
  const imageDropLabel = mode => typeof bdImageDropModeLabel === 'function'
    ? bdImageDropModeLabel(mode)
    : (mode === 'embed' ? 'ファイルに埋め込む' : '画像ファイルへのリンク');

  if (nodeId) {
    // 2026-04-18: board-card-popup-redesign-plan.md §4 に沿って再構築。
    //   - 色スウォッチ / 「コメントを追加」 / 「ノートを作成」 / 「ライン」サブ / 「外観」サブ /
    //     「拡張」サブ / 「サイズ設定」/「表示サイズ」 はすべて廃止または移設。
    //   - 編集 UI はオプションパネルへ一本化、ポップアップは切替と状態トグルに専念する。
    const targetNodeIds = multi ? [...bd.selected] : [nodeId];
    const isLinkCard = nd && !!nd.link;
    const isImageCard = nd && !!nd.img;
    const isRootCard = nd && !nd.parent;
    if (isLinkCard && !multi) {
      item('リンク先を開く', () => {
        if (typeof _bdOpenLinkedTarget === 'function') _bdOpenLinkedTarget(nd);
      });
      item('サブパネルで開く', () => {
        const linkPath = nd.link;
        const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
        if (typeof openLinkInSubPanel === 'function') openLinkInSubPanel(linkPath, linkName, { linkType: nd.linkType });
        else if (typeof bdOpenLinkedPath === 'function') bdOpenLinkedPath(linkPath, linkName, { linkType: nd.linkType, rightOfBoard: true });
      });
      item('メインパネルで開く', () => {
        const linkPath = nd.link;
        const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
        if (typeof openLinkedPathInMainPane === 'function') openLinkedPathInMainPane(linkPath, linkName, { linkType: nd.linkType });
        else if (typeof openLink === 'function') openLink(linkPath, linkName);
      });
      item('右サイドバーで開く', () => {
        const linkPath = nd.link;
        const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
        if (typeof openLinkedPathInRightPane === 'function') openLinkedPathInRightPane(linkPath, linkName, { linkType: nd.linkType });
        else if (typeof openLinkInSubPanel === 'function') openLinkInSubPanel(linkPath, linkName, { linkType: nd.linkType });
      });
      if (typeof canOpenLinkedPathStandalone !== 'function' || canOpenLinkedPathStandalone(nd.link, nd.linkType || '')) {
        item('単独アプリで開く', () => {
          const linkPath = nd.link;
          const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
          if (typeof openLinkedPathStandalone === 'function') openLinkedPathStandalone(linkPath, linkName, { linkType: nd.linkType });
        });
      }
      item('リンクをコピー', () => {
        const linkPath = nd.link;
        const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
        if (typeof MeldexBroadcast !== 'undefined') {
          MeldexBroadcast.copyMeldexLink(linkName, linkPath, 'page').then(ok => {
            if (ok) showStatus('リンクをコピーしました');
          });
        }
      });
      sep();
    }
    if (!multi) {
      item('テキスト編集 (F2)', () => bdEditNode(nodeId));
      // 「同階層カード追加 (Enter)」: ルートカード (親なし) では追加先の階層が不定のため disabled。
      if (isRootCard) {
        const disabled = _bdContextMenuItem(menu, '同階層カード追加 (Enter)', null, { disabled: true, html: false });
        disabled.title = 'ルートカードは親が無いため、同階層追加できません';
      } else {
        item('同階層カード追加 (Enter)', () => {
          bdSelect(nodeId);
          if (typeof bdAddSiblingToSelected === 'function') bdAddSiblingToSelected();
        });
      }
      item('子カード追加 (Ctrl+Enter)', () => {
        bdSelect(nodeId);
        if (typeof bdAddChildToSelected === 'function') bdAddChildToSelected();
      });
      const linkifySub = sub('リンクカード化');
      linkifySub.item('ノート', () => bdLinkifyCardAs(nodeId, 'page'));
      linkifySub.item('シート', () => bdLinkifyCardAs(nodeId, 'smart-db'));
      linkifySub.item('シナリオ', () => bdLinkifyCardAs(nodeId, 'scriptnote'));
      linkifySub.item('ボード', () => bdLinkifyCardAs(nodeId, 'board'));
      linkifySub.item('タイマー', () => bdLinkifyCardAs(nodeId, 'timer'));
      linkifySub.sep();
      linkifySub.item('既存ファイル...', () => bdLinkifyCardFromExisting(nodeId));
      item('接続カードを全選択', () => {
        const ids = new Set([nodeId]); let ch = true;
        while (ch) {
          ch = false;
          bd.connections.forEach(c => {
            if (ids.has(c.from) && !ids.has(c.to)) { ids.add(c.to); ch = true; }
            if (ids.has(c.to) && !ids.has(c.from)) { ids.add(c.from); ch = true; }
          });
        }
        bdDescendants(nodeId).forEach(id => ids.add(id));
        bd.selected = ids;
        document.querySelectorAll('.bd-node').forEach(el => el.classList.toggle('bd-selected', bd.selected.has(el.id.replace('bdn-', ''))));
        if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
        if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi();
      });
    }
    item('複製', () => {
      bdPushUndo();
      const ids = multi ? [...bd.selected] : [nodeId];
      const sourceNodes = ids.map(id => bd.nodes.find(v => v.id === id)).filter(Boolean);
      const { newNodes, idMap } = typeof bdCloneNodesWithOffset === 'function'
        ? bdCloneNodesWithOffset(sourceNodes, 30)
        : { newNodes: [], idMap: {} };
      bd.nodes.push(...newNodes);
      const sourceIdSet = new Set(sourceNodes.map(node => node.id));
      const newConnections = (bd.connections || [])
        .filter(conn => conn && sourceIdSet.has(conn.from) && sourceIdSet.has(conn.to) && idMap[conn.from] && idMap[conn.to])
        .map(conn => {
          const cloned = { ...conn, id: bdId(), from: idMap[conn.from], to: idMap[conn.to] };
          if (Array.isArray(conn.controlPoints) && conn.controlPoints.length === 2) {
            cloned.controlPoints = conn.controlPoints.map(point => ({ ...point }));
          }
          return cloned;
        });
      bd.connections.push(...newConnections);
      bd.selected = new Set(newNodes.map(node => node.id));
      bdRender();
      bdDirty();
    });
    if (multi && nd) {
      item('選択カードをこのカードに内包', () => {
        const parentAbs = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(nd) : { x: nd.x, y: nd.y };
        const isAncestorOfTarget = (id) => {
          if (typeof bdDescendants === 'function') return bdDescendants(id).includes(nodeId);
          let cur = nd;
          const seen = new Set();
          while (cur?.parent && !seen.has(cur.id)) {
            if (cur.parent === id) return true;
            seen.add(cur.id);
            cur = bd.nodes.find(v => v.id === cur.parent);
          }
          return false;
        };
        const targetIds = [...bd.selected].filter(id => id !== nodeId && !isAncestorOfTarget(id));
        if (!targetIds.length) {
          if (typeof showStatus === 'function') showStatus('内包できるカードがありません', true);
          return;
        }
        bdPushUndo();
        nd.container = true;
        targetIds.forEach(id => {
          const ch = bd.nodes.find(v => v.id === id);
          if (ch) {
            const childAbs = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(ch) : { x: ch.x, y: ch.y };
            ch.x = childAbs.x - parentAbs.x; ch.y = childAbs.y - parentAbs.y;
            ch.parent = nodeId; ch.contained = true;
          }
        });
        bdRender(); bdDirty();
      });
    }
    const hasParentTarget = targetNodeIds.some(id => !!bd.nodes.find(v => v.id === id)?.parent);
    if (nd && hasParentTarget) {
      item('親から切り離す', () => {
        bdPushUndo();
        const depthOf = (id) => (typeof bdParentDepth === 'function') ? bdParentDepth(id) : (() => {
          let depth = 0;
          let cur = bd.nodes.find(v => v.id === id);
          const seen = new Set();
          const limit = Math.max(50, (bd.nodes || []).length + 1);
          while (cur?.parent && depth < limit && !seen.has(cur.id)) {
            seen.add(cur.id);
            cur = bd.nodes.find(v => v.id === cur.parent);
            depth += 1;
          }
          return depth;
        })();
        const ids = (multi ? [...bd.selected] : [nodeId]).sort((a, b) => depthOf(b) - depthOf(a));
        ids.forEach(id => {
          const n = bd.nodes.find(v => v.id === id); if (!n || !n.parent) return;
          const parentId = n.parent;
          if (typeof bdDetachParentChildRelation === 'function') bdDetachParentChildRelation(parentId, id);
          else n.parent = '';
        });
        bdRender(); bdDirty();
      });
    }
    // ロックはトグル項目として「複製」の直下に置く
    if (nd) {
      const lockLabel = nd.locked ? 'ロック解除' : 'ロック';
      item(lockLabel, () => {
        bdPushUndo();
        const ids = multi ? [...bd.selected] : [nodeId];
        const next = !nd.locked;
        ids.forEach(id => { const n = bd.nodes.find(v => v.id === id); if (n) n.locked = next; });
        bdRender(); bdDirty();
      });
    }
    sep();

    // --- カードスタイル サブ (旧「外観 > カードスタイル」を昇格。切替と管理のみ) ---
    //   書式編集 (色・フォントサイズ・太字/斜体・形状・角丸・影・雲型等) はオプションパネルに一本化。
    //   ここでは「スタイル選択」「階層別スタイル on/off」「スタイル管理」のみ扱う。
    {
      const cardStylePanel = _bdCreateContextSubmenu(menu, 'カードスタイル', 160);
      const currentStyleId = nd?.cardStyle || bd.activeCardStyle || '';
      const isHierarchical = !nd?.cardStyle;
      const restoreItem = _bdContextMenuItem(cardStylePanel, radioMark(isHierarchical) + esc('階層別スタイルに戻す'), () => {
        if (typeof _bdRestoreCardToHierarchy === 'function') _bdRestoreCardToHierarchy(targetNodeIds);
      }, {
        role: 'menuitemradio',
        checked: isHierarchical,
      });
      if (isHierarchical) restoreItem.style.color = 'var(--accent)';
      _bdContextMenuSep(cardStylePanel);
      (bd.cardStyles || []).forEach(style => {
        if (typeof _bdIsCustomStyleId === 'function' && _bdIsCustomStyleId('card', style.id)) return;
        const si = _bdContextMenuItem(cardStylePanel, radioMark(currentStyleId === style.id) + esc(style.name || ''), () => {
          _bdApplyCardStyleFromMenu(targetNodeIds, style.id);
        }, {
          role: 'menuitemradio',
          checked: currentStyleId === style.id,
        });
        if (currentStyleId === style.id) si.style.color = 'var(--accent)';
      });
      _bdContextMenuSep(cardStylePanel);
      // 階層別スタイル サブのサブ (有効/無効)
      if (nd) {
        const autoPanel = _bdCreateContextSubmenu(cardStylePanel, '階層別スタイル', 120);
        [['有効', true], ['無効', false]].forEach(([label, val]) => {
          const si = _bdContextMenuItem(autoPanel, radioMark(!!nd._autoStyle === val) + label, () => {
            nd._autoStyle = val;
            if (val) delete nd._userCardStyle;
            if (val && typeof bdApplyAutoStyle === 'function') bdApplyAutoStyle(nd.id);
            bdRender(); bdDirty();
            if (nd.structure && typeof bdAutoLayout === 'function') bdAutoLayout(nd.id);
          }, {
            role: 'menuitemradio',
            checked: !!nd._autoStyle === val,
          });
          if (!!nd._autoStyle === val) si.style.color = 'var(--accent)';
        });
      }
      _bdContextMenuItem(cardStylePanel, 'スタイル管理...', () => {
        if (typeof bdOpenCardStyleManager === 'function') bdOpenCardStyleManager();
      });
    }

    // --- 画像操作 サブ (画像カード時のみルート直下) ---
    if (isImageCard) {
      const imgSub = sub('画像操作');
      imgSub.item('画像ファイルを再指定...', () => {
        if (typeof bdRelocateImageNode === 'function') bdRelocateImageNode(nodeId);
      });
      imgSub.sep();
      imgSub.item('水平反転', () => bdFlip('h'));
      imgSub.item('垂直反転', () => bdFlip('v'));
      imgSub.item('90°回転', () => bdRotate(90));
      imgSub.item('-90°回転', () => bdRotate(-90));
      imgSub.sep();
      // 不透明度サブのサブ
      {
        const opPanel = _bdCreateContextSubmenu(imgSub.panel, '不透明度', 100);
        [[1, '100%'], [0.75, '75%'], [0.5, '50%'], [0.25, '25%']].forEach(([val, label]) => {
          const curOp = nd.opacity != null ? nd.opacity : 1;
          const active = Math.abs(curOp - val) < 0.01;
          const si = _bdContextMenuItem(opPanel, radioMark(active) + label, () => {
            bdSetOpacity(val);
          }, {
            role: 'menuitemradio',
            checked: active,
          });
          if (active) si.style.color = 'var(--accent)';
        });
      }
      imgSub.item('カラーピッカー', () => bdColorPicker());
    }

    // --- 表示 サブ (新設。折りたたみ/フォーカス/ドリルダウン/Z 順序) ---
    {
      const viewSub = sub('表示');
      const childNodesForView = typeof bdChildren === 'function' ? bdChildren(nodeId) : [];
      if (!multi && nd && childNodesForView.length > 0) {
        const collapseLabel = nd.collapsed ? '子カードを展開' : '子カードを折りたたむ';
        viewSub.item(collapseLabel, () => {
          bdPushUndo();
          nd.collapsed = !nd.collapsed;
          bdRender(); bdDirty();
        });
      }
      viewSub.item('フォーカス (Space)', () => bdFocusSelected());
      if (!multi && nd) {
        viewSub.item('ドリルダウン', () => bdDrillDown(nodeId));
      }
      if (typeof _bdDrillRoot !== 'undefined' && _bdDrillRoot) {
        viewSub.item('ドリルダウン解除', () => bdDrillUp());
      }
      viewSub.sep();
      viewSub.item('前面に移動', () => bdMoveZ('front'));
      viewSub.item('背面に移動', () => bdMoveZ('back'));
    }

    // --- 構造サブメニュー（コンテナ・子ライン・構造タイプ・グループ） ---
    // --- 構造 サブ (コンテナ切替 + 構造タイプのみ。子ライン操作 / 追従モード / 階層別スタイル は廃止) ---
    //   「子ラインスタイル/子ライン表示/子ライン形状」はライン側の編集に一本化し、
    //   「追従モード」は選択 + ドラッグで代替可能なため廃止。
    //   「階層別スタイル」はカードスタイル サブ内に移動済み。
    if (nd) {
      const strSub = sub('構造');
      if (!multi) {
        // コンテナ切替 (ルート直下はトグル式だが、サブ内では現在値の確認を兼ねてラジオで並べる)
        const ctPanel = _bdCreateContextSubmenu(strSub.panel, 'コンテナ', 120);
        [['コンテナにする', true], ['コンテナ解除', false]].forEach(([label, val]) => {
          const active = !!nd.container === val;
          const si = _bdContextMenuItem(ctPanel, radioMark(active) + label, () => {
            bdPushUndo();
            nd.container = val;
            if (!val) {
              bd.nodes.forEach(ch => {
                if (ch.parent === nodeId && ch.contained) {
                  const pos = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(ch) : { x: ch.x + nd.x, y: ch.y + nd.y };
                  ch.contained = false; ch.x = pos.x; ch.y = pos.y;
                }
              });
            }
            bdRender(); bdDirty();
          }, {
            role: 'menuitemradio',
            checked: active,
          });
          if (active) si.style.color = 'var(--accent)';
        });
      }
      // 構造タイプ: 選択中のすべてのカードに一括適用する (親子関係にあってもまとめて設定可能)。
      // c33a3a6 以降、中間カードに設定した structure もそのカード配下のサブツリーに適用される。
      // bdAutoLayout が DFS でサブルートを個別レイアウトするので、ルート以外でも有効。
      strSub.sep();
      const targetStructures = targetNodeIds.map(id => bd.nodes.find(v => v.id === id)?.structure || '');
      const mixedStructure = targetStructures.some(st => st !== targetStructures[0]);
      const curSt = mixedStructure ? '' : (targetStructures[0] || '');
      const applyStructure = (key) => {
        bdPushUndo();
        const allTargetsAlreadyUseKey = key && targetNodeIds.every(id => (bd.nodes.find(v => v.id === id)?.structure || '') === key);
        const nextValue = allTargetsAlreadyUseKey ? '' : key;
        targetNodeIds.forEach(id => {
          const n2 = bd.nodes.find(v => v.id === id);
          if (!n2) return;
          n2.structure = nextValue;
          if (nextValue) {
            // このノード (サブルート扱い) とその descendants について、欠けている親子接続を補充。
            // flowchart なら矢印付きで生成する。
            const descIds = typeof bdDescendants === 'function' ? bdDescendants(id) : [];
            descIds.forEach(cid => {
              const cn = bd.nodes.find(v => v.id === cid);
              if (cn && cn.parent && !bd.connections.some(c => c.from === cn.parent && c.to === cn.id)) {
                const conn = typeof bdCreateConnectionWithStyle === 'function'
                  ? bdCreateConnectionWithStyle(cn.parent, cn.id, { arrow: nextValue === 'flowchart' ? 'end' : '' })
                  : { from: cn.parent, to: cn.id, arrow: nextValue === 'flowchart' ? 'end' : '', label: '', style: '' };
                bd.connections.push(conn);
              }
            });
          }
          // このカードを subroot とする再レイアウト (空への変更でも、ルートから再整列するため呼ぶ)。
          if (typeof bdAutoLayout === 'function') {
            const targetId = nextValue ? id : (typeof bdRoot === 'function' ? bdRoot(id)?.id : id);
            if (targetId) bdAutoLayout(targetId);
          }
        });
        bdRender(); bdDirty();
      };
      if (multi && typeof bdLinkifySelectionToTree === 'function') {
        strSub.item('ラインから親子化', () => { bdLinkifySelectionToTree(nodeId); });
        strSub.sep();
      }
      strSub.item((!mixedStructure && !curSt ? lucide('checkSquare', 12) + ' ' : '') + '親に従う', () => applyStructure(''));
      Object.entries(BD_STRUCTURES).forEach(([key, label]) => {
        strSub.item((!mixedStructure && curSt === key ? lucide('checkSquare', 12) + ' ' : '') + label, () => applyStructure(key));
      });
    }

    // --- ステータス/マーカー/コメント サブメニュー (HUD の空状態ボタンから移設) ---
    if (nd && !multi) {
      // ステータス
      const statusSub = sub('ステータス');
      const curStatus = nd.status || '';
      const setStatus = (st) => {
        bdPushUndo();
        const targets = bd.selected.has(nodeId) ? [...bd.selected] : [nodeId];
        targets.forEach(id => { const n2 = bd.nodes.find(v => v.id === id); if (n2) n2.status = st; });
        bdRender(); bdDirty();
      };
      statusSub.item(radioMark(!curStatus) + 'なし', () => setStatus(''));
      if (typeof bdStatusNames === 'function') {
        bdStatusNames().filter(s => !!s).forEach(st => {
          const sd = typeof bdStatusDef === 'function' ? bdStatusDef(st) : null;
          const dot = sd ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${_bdSafeInlineColor(sd.color, '#888')};margin-right:4px;vertical-align:middle;"></span>` : '';
          statusSub.item(radioMark(curStatus === st) + dot + esc(st), () => setStatus(st));
        });
      }
      statusSub.sep();
      statusSub.item('ステータスを管理...', () => {
        if (typeof bdManageStatuses === 'function') bdManageStatuses();
      });

      // マーカー
      if (typeof BD_MARKERS !== 'undefined') {
        const markerSub = sub('マーカー');
        const markers = nd.markers || {};
        const categoryLabels = { priority: '優先度', flag: 'フラグ' };
        let firstCat = true;
        Object.entries(BD_MARKERS).forEach(([cat, list]) => {
          if (!firstCat) markerSub.sep();
          firstCat = false;
          markerSub.label(categoryLabels[cat] || cat);
          list.forEach((mk, idx) => {
            const isActive = markers[cat] === idx;
            const iconHtml = typeof bdMarkerIconHtml === 'function' ? bdMarkerIconHtml(mk, 12) : (typeof lucide === 'function' ? lucide(mk.icon, 12) : '');
            const iconSpan = `<span style="color:${_bdSafeInlineColor(mk.color, 'var(--fg2)')};margin-right:4px;vertical-align:middle;">${iconHtml}</span>`;
            markerSub.item(radioMark(isActive) + iconSpan + esc(mk.label), () => {
              bdPushUndo();
              if (typeof bdSetMarker === 'function') bdSetMarker(nodeId, cat, isActive ? -1 : idx);
            });
          });
        });
        if (markers && Object.keys(markers).length > 0) {
          markerSub.sep();
          markerSub.item('すべてクリア', () => {
            bdPushUndo();
            const n2 = bd.nodes.find(v => v.id === nodeId);
            if (n2) n2.markers = {};
            bdRender(); bdDirty();
          });
        }
      }

      // コメント
      const commentSub = sub('コメント');
      const filePath = (bd?.path || '').trim();
      commentSub.item('コメントを追加', () => {
        if (typeof addCommentHere !== 'function') return;
        if (!filePath) {
          if (typeof showStatus === 'function') showStatus('コメント対象のボードパスを取得できませんでした', true);
          return;
        }
        const snap = (nd.text || '').trim().slice(0, 120);
        addCommentHere({
          targetKind: 'board_card', filePath,
          targetRef: { file: filePath, cardId: nodeId },
          snapshot: snap,
        }, { anchorEl: contextAnchorEl });
      });
      commentSub.item('コメント一覧を開く', () => {
        if (typeof openRightPanelTab === 'function') openRightPanelTab('annotation');
        else if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('annotation');
        const typeSel = document.getElementById('rp-ann-type'); if (typeSel) typeSel.value = 'comment';
        const scopeSel = document.getElementById('rp-ann-scope'); if (scopeSel) scopeSel.value = 'current';
        const searchEl = document.getElementById('rp-ann-search');
        if (searchEl) {
          searchEl.value = '';
          searchEl.dataset.targetFilter = JSON.stringify({
            targetPath: filePath, targetKind: 'board_card',
            targetRef: { file: filePath, cardId: nodeId },
          });
        }
        if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
      });
    }

    // --- Multi-select: 整列・サイズ・集約・グループ化 ---
    if (multi) {
      sep();
      item('集約カードを追加', () => bdAddSummary());
      const alSub = sub('整列');
      alSub.item('左揃え', () => bdAlign('left')); alSub.item('右揃え', () => bdAlign('right'));
      alSub.item('上揃え', () => bdAlign('top')); alSub.item('下揃え', () => bdAlign('bottom'));
      alSub.item('水平中央', () => bdAlign('centerH')); alSub.item('垂直中央', () => bdAlign('centerV'));
      alSub.item('水平等間隔', () => bdAlign('distributeH')); alSub.item('垂直等間隔', () => bdAlign('distributeV'));
      alSub.sep();
      alSub.item('自動整列（横幅）', () => bdArrangeByWidth());
      alSub.item('自動整列（縦幅）', () => bdArrangeByHeight());
      const nrmSub = sub('サイズ正規化');
      nrmSub.item('高さを揃える', () => bdNormalize('height'));
      nrmSub.item('幅を揃える', () => bdNormalize('width'));
      nrmSub.item('サイズを揃える', () => bdNormalize('size'));
      nrmSub.item('面積を揃える', () => bdNormalize('area'));
      item('グループ化', () => {
        bdPushUndo();
        bd.groups.push({ id: bdId(), name: 'グループ' + (bd.groups.length + 1), nodeIds: [...bd.selected] });
        bdRender(); bdDirty();
      });
    }
    // 注: ルート直下の「フォーカス (Space)」および「拡張」サブ全体 (ノート編集/チェックボックス/
    // 進捗/フォント設定/マーカー/ドリルダウン/ステータス) は廃止。
    //   - フォーカス / ドリルダウン → 「表示」サブへ移設済み
    //   - ステータス / マーカー → カード HUD の左上・右下クリックから直接選択
    //   - ノート編集 / チェックボックス / 進捗 / フォント設定 → 廃止 (機能自体の削除)

    // --- Groups ---
    const nodeGroups = bd.groups.filter(g=>g.nodeIds.includes(nodeId));
    if (nodeGroups.length) {
      nodeGroups.forEach(g => {
        item('グループ「'+esc(g.name)+'」を選択', () => { g.nodeIds.forEach(id=>bd.selected.add(id)); document.querySelectorAll('.bd-node').forEach(el=>el.classList.toggle('bd-selected',bd.selected.has(el.id.replace('bdn-','')))); if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles(); });
        item('グループ「'+esc(g.name)+'」を解除', () => { bd.groups=bd.groups.filter(gg=>gg.id!==g.id); bdRender(); bdDirty(); showStatus('グループ解除'); });
      });
    }
    sep();
    dangerItem('削除 (Del)', async () => {
      if (!multi) bdSelect(nodeId);
      const count = bd.selected.size;
      const msg = count > 1 ? `${count}件のカードを削除しますか？` : 'このカードを削除しますか？';
      if (!(await cfConfirm(msg))) return;
      await bdDeleteSelected({ confirm: false });
    });

  } else {
    // --- Blank area menu ---
    const _stw = typeof bdScreenToWorld === 'function' ? bdScreenToWorld(e.clientX, e.clientY) : { x: e.clientX, y: e.clientY };
    const clickWx = _stw.x, clickWy = _stw.y;
    item('カードを追加', () => { bdAddAt(clickWx, clickWy); });
    const newLinkSub = sub('新規リンクカード');
    [
      ['ノート', 'page'],
      ['シート', 'smart-db'],
      ['シナリオ', 'scriptnote'],
      ['ボード', 'board'],
      ['タイマー', 'timer'],
    ].forEach(([label, type]) => {
      newLinkSub.item(label, () => {
        if (typeof bdCreateLinkedFileCardAt === 'function') bdCreateLinkedFileCardAt(clickWx, clickWy, type);
        else showStatus('リンクカード追加機能を読み込めませんでした', true);
      });
    });
    newLinkSub.sep();
    newLinkSub.item('既存ファイルへのリンク...', () => {
      if (typeof bdPromptAddLinkCardAt === 'function') bdPromptAddLinkCardAt(clickWx, clickWy);
      else showStatus('リンクカード追加機能を読み込めませんでした', true);
    });
    if (_bdClipboard && _bdClipboard.length > 0) {
      item('貼り付け (Ctrl+V)', () => { bdPaste(); });
    }
    item('画像を貼り付け (Ctrl+Shift+V)', () => bdPasteImage());
    sep();
    item('自動整列（横幅）', () => bdArrangeByWidth());
    item('自動整列（縦幅）', () => bdArrangeByHeight());
    sep();
    item('検索と置換...', () => bdFindReplace());
    sep();
    // 2026-04-18: 「表示設定」→「ボード設定」にリネーム (カード側の「表示」サブと用語が衝突するため、§6.2)。
    // 「全体表示に戻る」→「ドリルダウン解除」に統一 (カード側「表示」サブと用語を揃える)。
    const boardSettingsSub = sub('ボード設定');
    boardSettingsSub.item(bd._numbering ? lucide('checkSquare', 12) + ' 番号付け' : '番号付け', () => bdToggleNumbering());
    // v0.5.285: フローティングミニマップ項目とフォーカスモード項目を削除。
    //   ミニマップはビューワーパネル側 (gb-canvas-minimap.js) で置換済み。
    //   フォーカスモードは Space キー直押しでフォーカス / 解除できるため不要。
    boardSettingsSub.sep();
    const thmSub = sub('テーマ');
    if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getAllThemes === 'function') {
      const activeThemeId = bd.themeId || '';
      thmSub.item(!activeThemeId ? lucide('checkSquare', 12) + ' アプリ設定に追従' : 'アプリ設定に追従', () => MeldexThemeManager.setBoardTheme(bd, ''));
      thmSub.sep();
      MeldexThemeManager.getAllThemes().forEach(theme => {
        thmSub.item(activeThemeId === theme.id ? lucide('checkSquare', 12) + ' ' + esc(theme.name) : esc(theme.name), () => MeldexThemeManager.setBoardTheme(bd, theme.id));
      });
    }
    if (_bdDrillRoot) item('ドリルダウン解除', () => bdDrillUp());
    if (bd.selected.size > 1) {
      item('集約カードを追加', () => bdAddSummary());
    }
  }

  sep();
  const imageDropSub = sub('画像追加方式');
  imageDropSub.item(imageDropCheck('embed') + esc(imageDropLabel('embed')), () => {
    if (typeof bdSetImageDropMode === 'function') bdSetImageDropMode('embed');
  });
  imageDropSub.item(imageDropCheck('link') + esc(imageDropLabel('link')), () => {
    if (typeof bdSetImageDropMode === 'function') bdSetImageDropMode('link');
  });

  if (typeof window !== 'undefined' && window.MeldexBoardStandalone?.appendContextMenuItems) {
    try {
      window.MeldexBoardStandalone.appendContextMenuItems(menu);
    } catch (err) {
      console.warn('[board] standalone context menu extension failed', err);
    }
  }

  document.body.appendChild(menu);
  if (typeof positionPopup === 'function') {
    positionPopup(menu, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
  } else {
    const r=menu.getBoundingClientRect();
    if(r.right>window.innerWidth) menu.style.left=(window.innerWidth-r.width-4)+'px';
    if(r.bottom>window.innerHeight) menu.style.top=(window.innerHeight-r.height-4)+'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  setTimeout(()=>document.addEventListener('pointerdown',function h(ev){const inAny=[...document.querySelectorAll('.gb-context-menu')].some(m=>m.contains(ev.target));if(!inAny){document.querySelectorAll('.gb-context-menu').forEach(m=>m.remove());document.removeEventListener('pointerdown',h);}},{once:false}),0);
}

// --- 15. Status Management ---
function _bdUniqueStatusName(baseName, skipIndex) {
  const base = String(baseName || '').replace(/[\r\n]+/g, ' ').trim() || '新規';
  const names = new Set((bd.statuses || [])
    .map((status, index) => index === skipIndex ? '' : (status?.name || '').trim())
    .filter(Boolean));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(base + ' ' + suffix)) suffix += 1;
  return base + ' ' + suffix;
}

function _bdRenameStatusOnNodes(oldName, nextName) {
  if (!oldName || oldName === nextName) return;
  (bd.nodes || []).forEach(node => {
    if (node.status === oldName) node.status = nextName;
  });
}

function _bdClearStatusOnNodes(statusName) {
  if (!statusName) return;
  (bd.nodes || []).forEach(node => {
    if (node.status === statusName) node.status = '';
  });
}

function bdManageStatuses() {
  const o = document.createElement('div'); o.className = 'modal-overlay';
  let undoCaptured = false;
  const captureUndo = () => {
    if (undoCaptured) return;
    undoCaptured = true;
    if (typeof bdPushUndo === 'function') bdPushUndo();
  };
  const bindStatusSwatches = () => {
    o.querySelectorAll('.bd-status-color').forEach((swatch) => {
      const idx = parseInt(swatch.dataset.i, 10);
      bindColorSwatch(swatch, () => getColorSwatchValue(swatch, bd.statuses[idx]?.color || '#888'), (nextColor) => {
        const appliedColor = nextColor || '#888';
        captureUndo();
        setColorSwatchValue(swatch, appliedColor);
        if (Number.isFinite(idx) && bd.statuses[idx]) bd.statuses[idx].color = appliedColor;
        bdDirty();
      });
    });
  };
  function render() {
    let html = '<div class="modal" style="min-width:400px;"><h3>ステータス管理</h3>';
    bd.statuses.forEach((s,i) => {
      html += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
        <input type="text" value="${esc(s.name)}" data-i="${i}" data-f="name" style="width:80px;font-size:13px;padding:2px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
        <button type="button" class="bd-status-color gb-color-swatch gb-color-swatch--status" data-i="${i}" data-f="color" data-color="${esc(s.color)}" title="色"></button>
        <label style="font-size:11px;color:var(--fg2);">透過<input type="range" min="0" max="1" step="0.1" value="${s.opacity}" data-i="${i}" data-f="opacity" style="width:50px;vertical-align:middle;"></label>
        <label style="font-size:11px;color:var(--fg2);">枠<input type="text" value="${esc(s.border||'')}" data-i="${i}" data-f="border" placeholder="例: 2px solid #22c55e" style="width:100px;font-size:11px;padding:1px 3px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:2px;"></label>
        <button data-del="${i}" style="font-size:11px;padding:1px 6px;color:var(--fg2);">${lucide('x', 12)}</button>
      </div>`;
    });
    html += `<div style="margin-top:8px;"><button id="bd-st-add" style="font-size:12px;padding:3px 10px;">+ ステータスを追加</button></div>`;
    html += '<div class="btn-row"><button id="bd-st-close">閉じる</button></div></div>';
    o.innerHTML = html;
    bindStatusSwatches();
  }
  render(); document.body.appendChild(o);
  o.addEventListener('input', (ev) => {
    const i = parseInt(ev.target.dataset.i, 10), f = ev.target.dataset.f;
    if (!Number.isFinite(i) || !f || !bd.statuses[i]) return;
    if (f === 'name') {
      const oldName = bd.statuses[i].name || '';
      const nextName = _bdUniqueStatusName(ev.target.value, i);
      if (ev.target.value !== nextName) ev.target.value = nextName;
      if (nextName === oldName) return;
      captureUndo();
      _bdRenameStatusOnNodes(oldName, nextName);
      bd.statuses[i].name = nextName;
      bdRender();
      bdDirty();
      return;
    }
    captureUndo();
    if (f === 'opacity') {
      bd.statuses[i][f] = +ev.target.value;
    } else if (f === 'border') {
      const nextBorder = String(ev.target.value || '').replace(/[\r\n]+/g, ' ').trim();
      if (ev.target.value !== nextBorder) ev.target.value = nextBorder;
      bd.statuses[i][f] = nextBorder;
    } else {
      bd.statuses[i][f] = ev.target.value;
    }
    bdRender();
    bdDirty();
  });
  o.addEventListener('click', async (ev) => {
    const delBtn = ev.target.closest?.('[data-del]');
    if (delBtn?.dataset?.del!==undefined) {
      const idx = +delBtn.dataset.del;
      if (!Number.isFinite(idx) || !bd.statuses[idx]) return;
      const label = bd.statuses[idx].name || 'このステータス';
      if (typeof cfConfirm === 'function' && !(await cfConfirm(`ステータス「${label}」を削除しますか？`))) return;
      captureUndo();
      bd.statuses.splice(idx,1);
      _bdClearStatusOnNodes(label);
      bdRender();
      bdDirty();
      render();
      return;
    }
    if (ev.target.id==='bd-st-add') {
      captureUndo();
      bd.statuses.push({name:_bdUniqueStatusName('新規'),color:'#888',opacity:1,border:''});
      bdDirty();
      render();
    }
    if (ev.target.id==='bd-st-close') { o.remove(); bdRender(); bdDirty(); }
  });
}

// --- 16. Help Dialog ---
function bdShowHelp() {
  const o = document.createElement('div'); o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="max-width:500px;">
    <h3>ボード ショートカット</h3>
    <div style="font-size:13px;line-height:2;columns:2;column-gap:24px;">
      <div><kbd>ダブルクリック</kbd> カード追加/編集</div>
      <div><kbd>左ドラッグ (空白)</kbd> 範囲選択</div>
      <div><kbd>左ドラッグ (カード)</kbd> 移動</div>
      <div><kbd>右ドラッグ (空白)</kbd> パン</div>
      <div><kbd>右ドラッグ (カード)</kbd> ライン</div>
      <div><kbd>ホイール</kbd> ズーム</div>
      <div><kbd>中ボタンドラッグ</kbd> パン</div>
      <div><kbd>Space+矢印</kbd> パン</div>
      <div><kbd>Ctrl++/-</kbd> ズーム</div>
      <div><kbd>Tab</kbd> 子カード追加</div>
      <div><kbd>Enter</kbd> 同階層カード追加</div>
      <div><kbd>Shift+Enter</kbd> カード内改行 (編集中)</div>
      <div><kbd>F2</kbd> テキスト編集</div>
      <div><kbd>Esc</kbd> 編集完了/選択解除</div>
      <div><kbd>Delete</kbd> 削除</div>
      <div><kbd>矢印</kbd> カード間移動</div>
      <div><kbd>Ctrl+矢印</kbd> 位置微調整</div>
      <div><kbd>Shift+矢印</kbd> 方向選択追加</div>
      <div><kbd>Ctrl+A</kbd> 全選択</div>
      <div><kbd>Ctrl+D</kbd> 全解除</div>
      <div><kbd>Ctrl+C/V</kbd> コピー/ペースト</div>
      <div><kbd>Ctrl+Z/Y</kbd> 元に戻す/やり直し</div>
      <div><kbd>自動保存</kbd> 編集内容を保存</div>
    </div>
    <div class="btn-row"><button data-action="this.closest('.modal-overlay').remove()">閉じる</button></div>
  </div>`;
  document.body.appendChild(o);
}


// 2026-04-18: 旧 _bdCreateNoteForNode (未完成で末尾切れていた) を廃止し、
// 「リンクカード化」メニュー用の汎用関数に置き換え。対象は既存カード 1 件。
//   - bdLinkifyCardAs(nodeId, type)   新規ファイルを作成してリンク化 ('page'|'database'|'board')
//   - bdLinkifyCardFromExisting(nodeId) 既存ファイル選択ダイアログから選んでリンク化
async function bdLinkifyCardAs(nodeId, type) {
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !bd.path) { showStatus('先にボードを保存してください', true); return; }
  if (n.link) {
    if (!(await cfConfirm('このカードには既にリンクが設定されています。上書きしますか？'))) return;
  }
  const parentDir = typeof _bdBoardDir === 'function' ? _bdBoardDir() : bd.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const baseLabel = (n.text || '無題').trim() || '無題';
  try {
    const res = await apiPost('/outliner/add', { type, label: baseLabel, parent: parentDir });
    const nodeData = res?.node || {};
    const label = nodeData.name || nodeData.label || baseLabel;
    const path = nodeData.path || '';
    if (!path) throw new Error('path missing');
    bdPushUndo();
    n.link = path;
    n.linkType = nodeData.type || type;
    n.text = label;
    bdRender();
    bdDirty();
    if (typeof _bdOpenEntryInSubPanel === 'function') _bdOpenEntryInSubPanel(label, path, n.linkType);
    showStatus('リンクカード化: ' + label);
  } catch {
    showStatus('リンクカード化に失敗しました', true);
  }
}

async function bdLinkifyCardFromExisting(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !bd.path) { showStatus('先にボードを保存してください', true); return; }
  if (n.link) {
    if (!(await cfConfirm('このカードには既にリンクが設定されています。上書きしますか？'))) return;
  }
  const applyLink = (linkPath, maybeLabel, linkType) => {
    if (!linkPath) return;
    bdPushUndo();
    n.link = linkPath;
    n.linkType = linkType || '';
    const fallback = linkPath.split(/[/\\]/).pop() || linkPath;
    const label = (maybeLabel && maybeLabel.trim()) || fallback;
    if (!n.text || n.text === '無題') n.text = label;
    bdRender();
    bdDirty();
    showStatus('リンクカード化: ' + label);
  };
  if (typeof showLinkInsertModal === 'function') {
    showLinkInsertModal(null, (result) => {
      if (!result) return;
      if (result.type === 'file') applyLink(result.path, result.name, result.fileType || '');
      else if (result.type === 'url') applyLink(result.url, result.url.split('/').pop(), '');
    });
    return;
  }
  // フォールバック: リンクモーダルが未ロードなら直接入力
  const rawPath = await cfPrompt('リンク先のパスを入力', '');
  if (rawPath == null || !rawPath.trim()) return;
  applyLink(rawPath.trim(), null);
}
/* gb-canvas-features.part04.js */
// gb-canvas-features.part04.js: 旧 _bdCreateNoteForNode の関数末尾 (孤立文) を削除済み。
// 本体は 2026-04-18 に bdLinkifyCardAs / bdLinkifyCardFromExisting (旧 part02) に置き換えたが、
// その際に旧 part03 の末尾残骸を消し忘れており、連結実行時に SyntaxError を起こしていた。
// 空ファイルに戻すと gb-canvas-features.js 全体が実行できなくなる機能連鎖不全を回避する。
