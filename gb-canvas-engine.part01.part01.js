/* gb-canvas-engine.part01.js */
/* gb-canvas-engine.js: Canvas Engine Core (v5.0 Phase C) */

/* ==============================
   ボードエンジン — 状態・解析・描画・選択・保存
   ============================== */

// --- ボード状態オブジェクト ---
const bd = {
  path:'', _loadedBoardPath:'', nodes:[], connections:[], llmSemantics:null, selected:new Set(), editing:null,
  dirty:false, zoom:1, panX:0, panY:0, rotation:0, _id:0,
  connecting:null, _activeNode:null, selectedConnId:'', selectedConnIds:new Set(),
  cardStyles:[], lineStyles:[], depthStyles:[], activeCardStyle:'', activeLineStyle:'',
  _stylePresetSeedVersion:0, themeId:'',
  tool:'select', displayFilters:{},
  // 2026-04-18: レイアウト隙間 / 自動整列 (スタイルタブで設定)
  gapSiblings: null, gapLevels: null, autoAlign: true,
};
// 選択色 / カーソル色はスタイルタブ (_FS_FIELDS.board.editOps) の
// `--bd-selection-color` / `--bd-caret-color` 経由で bd._fileStyle に保存され、
// frontmatter adapter がアクティブなボードキャンバス要素に CSS 変数をセットする。
// 構造タイプ: mindmap, flowchart, logic, timeline, orgchart, tree, none(親に従う = ルートのstructureを継承)
const BD_STRUCTURES = {mindmap:'マインドマップ', flowchart:'フローチャート', logic:'ロジック図', timeline:'タイムライン', orgchart:'組織図', tree:'ツリー'};

// --- ID生成・親子ヘルパー ---
function bdId() { return 'b' + (++bd._id) + '_' + Date.now().toString(36); }
function bdNode(text, x, y, w, h, opts) {
  return { id: bdId(), text: text||'', x: x||0, y: y||0, w: w||160, h: h||0, img: opts?.img||'', parent: opts?.parent||'', structure: opts?.structure||'', collapsed: false, ...opts };
}
function bdGetAppZoom() {
  return (typeof _getZoom === 'function') ? Math.max(0.1, _getZoom()) : 1;
}
function bdClientToCanvasLocal(sx, sy, canvasEl) {
  const canvas = canvasEl || document.getElementById('bd-canvas');
  if (!canvas) return { x: sx, y: sy };
  const rect = canvas.getBoundingClientRect();
  const zoom = bdGetAppZoom();
  return {
    x: (sx - rect.left) / zoom,
    y: (sy - rect.top) / zoom,
  };
}
function bdEnsureConnectionRuntime(connections) {
  (connections || []).forEach(conn => {
    if (!conn.id) conn.id = bdId();
    if (conn.fromPoint) conn.fromPoint = bdNormalizeConnectionPoint(conn.fromPoint);
    if (conn.toPoint) conn.toPoint = bdNormalizeConnectionPoint(conn.toPoint);
  });
}
function bdNormalizeConnectionPoint(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  if (point && typeof point === 'object') {
    const x = Number(point.x);
    const y = Number(point.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  return null;
}
function bdConnectionHasEndpoint(conn, side) {
  if (!conn) return false;
  const nodeId = side === 'from' ? conn.from : conn.to;
  if (nodeId) return true;
  return !!bdNormalizeConnectionPoint(side === 'from' ? conn.fromPoint : conn.toPoint);
}
function bdConnectionEndpointKey(conn, side) {
  const nodeId = side === 'from' ? conn?.from : conn?.to;
  if (nodeId) return 'node:' + nodeId;
  const point = bdNormalizeConnectionPoint(side === 'from' ? conn?.fromPoint : conn?.toPoint);
  if (!point) return 'none';
  return `point:${Math.round(point.x * 100) / 100},${Math.round(point.y * 100) / 100}`;
}
function bdGetConnectionById(connId) {
  return bd.connections.find(conn => conn.id === connId) || null;
}
function bdEnsureConnectionSelectionState() {
  if (!(bd.selectedConnIds instanceof Set)) bd.selectedConnIds = new Set();
  if (bd.selectedConnId) bd.selectedConnIds.add(bd.selectedConnId);
}
function bdSetConnectionSelection(connIds) {
  bdEnsureConnectionSelectionState();
  if (!connIds || connIds.length === 0) {
    bd.selectedConnIds = new Set();
    bd.selectedConnId = '';
    return;
  }
  const existing = new Set(bd.connections.map(conn => conn.id));
  bd.selectedConnIds = new Set(connIds.filter(id => existing.has(id)));
  bd.selectedConnId = bd.selectedConnIds.size === 1 ? [...bd.selectedConnIds][0] : '';
}
function bdClearConnectionSelection() {
  bdSetConnectionSelection([]);
}
function bdRemoveConnectionFromSelection(connId) {
  bdEnsureConnectionSelectionState();
  bd.selectedConnIds.delete(connId);
  if (bd.selectedConnId === connId) bd.selectedConnId = '';
  if (!bd.selectedConnId && bd.selectedConnIds.size === 1) bd.selectedConnId = [...bd.selectedConnIds][0];
}
function bdPruneConnectionSelection() {
  bdSetConnectionSelection([...bd.selectedConnIds, bd.selectedConnId].filter(Boolean));
}
function bdGetSelectedConnectionIds() {
  bdEnsureConnectionSelectionState();
  bdPruneConnectionSelection();
  return [...bd.selectedConnIds];
}
function _bdPeekSelectedConnectionIds() {
  if (!(bd.selectedConnIds instanceof Set)) return [];
  const existing = new Set(bd.connections.map(conn => conn.id));
  const ids = [...bd.selectedConnIds].filter(id => existing.has(id));
  if (bd.selectedConnId && existing.has(bd.selectedConnId) && !ids.includes(bd.selectedConnId)) ids.push(bd.selectedConnId);
  return ids;
}
function bdIsConnectionSelected(connId) {
  bdEnsureConnectionSelectionState();
  return bd.selectedConnIds.has(connId);
}
function bdAreAllCardsSelected() {
  return bd.nodes.length > 0 && bd.selected.size === bd.nodes.length;
}
function bdAreAllLinesSelected() {
  return bd.connections.length > 0 && _bdPeekSelectedConnectionIds().length === bd.connections.length;
}
function bdSelectAllElements() {
  bd.selected = new Set(bd.nodes.map(node => node.id));
  bdSetConnectionSelection(bd.connections.map(conn => conn.id));
  bd._activeNode = null;
  document.querySelectorAll('.bd-node').forEach(el => {
    el.classList.add('bd-selected');
  });
  bdSyncResizeHandles();
  bdDrawConns();
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
}

function bdChildren(parentId) { return bd.nodes.filter(n => n.parent === parentId); }
function bdRoot(nodeId) {
  let n = bd.nodes.find(v=>v.id===nodeId); if (!n) return null;
  const seen = new Set();
  while (n.parent) {
    if (seen.has(n.id)) break;
    seen.add(n.id);
    const p = bd.nodes.find(v=>v.id===n.parent);
    if (!p || seen.has(p.id)) break;
    n=p;
  }
  return n;
}
// 指定ノードに適用される構造タイプを返す。
// 自分 → 親 → 親 → … と遡り、最初に見つかった非空の structure 値を返す (= 「親に従う」の継承)。
// 途中の中間カードで structure を明示設定していれば、そのカード配下のサブツリーはその
// 構造で扱われる。全ノードが空 ('') ならルートまで遡って '' (自動整列なし) を返す。
function bdStructureOf(nodeId) {
  let n = bd.nodes.find(v => v.id === nodeId); if (!n) return '';
  const seen = new Set();
  while (n) {
    if (seen.has(n.id)) break;
    seen.add(n.id);
    if (n.structure) return n.structure;
    if (!n.parent) break;
    n = bd.nodes.find(v => v.id === n.parent);
  }
  return '';
}
function bdDescendants(nodeId) {
  const result = [], seen = new Set([nodeId]);
  function collect(pid) {
    bdChildren(pid).forEach(c => {
      if (!c?.id || seen.has(c.id)) return;
      seen.add(c.id);
      result.push(c.id);
      collect(c.id);
    });
  }
  collect(nodeId); return result;
}
function bdNormalizeParentGraph(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return nodes || [];
  const byId = new Map(nodes.filter(n => n?.id).map(n => [n.id, n]));
  nodes.forEach(node => {
    if (!node?.parent) return;
    if (node.parent === node.id || !byId.has(node.parent)) {
      node.parent = '';
      node.contained = false;
      return;
    }
    const seen = new Set([node.id]);
    let cur = byId.get(node.parent);
    let guard = 0;
    while (cur?.parent && guard <= nodes.length) {
      if (seen.has(cur.id) || cur.parent === node.id) {
        node.parent = '';
        node.contained = false;
        return;
      }
      seen.add(cur.id);
      if (!byId.has(cur.parent)) {
        cur.parent = '';
        cur.contained = false;
        return;
      }
      cur = byId.get(cur.parent);
      guard += 1;
    }
    if (guard > nodes.length) {
      node.parent = '';
      node.contained = false;
    }
  });
  return nodes;
}
function bdParentDepth(nodeOrId, limit) {
  const maxDepth = Number.isFinite(limit) && limit > 0 ? limit : Math.max(50, (bd.nodes || []).length + 1);
  let cur = typeof nodeOrId === 'string' ? bd.nodes.find(v => v.id === nodeOrId) : nodeOrId;
  const seen = new Set();
  let depth = 0;
  while (cur?.parent && depth < maxDepth) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    const parent = bd.nodes.find(v => v.id === cur.parent);
    if (!parent || seen.has(parent.id)) break;
    depth += 1;
    cur = parent;
  }
  return depth;
}
function bdAbsolutePosition(node) {
  let x = Number(node?.x) || 0;
  let y = Number(node?.y) || 0;
  let cur = node;
  let guard = 0;
  while (cur?.contained && cur.parent && guard < 50) {
    const parent = bd.nodes.find(v => v.id === cur.parent);
    if (!parent) break;
    x += Number(parent.x) || 0;
    y += Number(parent.y) || 0;
    cur = parent;
    guard += 1;
  }
  return { x, y };
}
function bdNodeCanvasPosition(node) {
  return bdAbsolutePosition(node);
}
function bdNearestNodeFromPoint(x, y, excludeIds) {
  const blocked = new Set(excludeIds || []);
  let bestId = null;
  let bestDist = Infinity;
  bd.nodes.forEach(node => {
    if (!node || blocked.has(node.id)) return;
    const el = document.getElementById('bdn-' + node.id);
    const pos = bdNodeCanvasPosition(node);
    const centerX = pos.x + ((el?.offsetWidth || node.w || 160) / 2);
    const centerY = pos.y + ((el?.offsetHeight || node.h || 36) / 2);
    const dist = ((centerX - x) ** 2) + ((centerY - y) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = node.id;
    }
  });
  return bestId;
}

function bdSyncResizeHandles() {
  const _bdResizePerf = typeof bdPerfStart === 'function' ? bdPerfStart('bdSyncResizeHandles') : 0;
  const layer = document.getElementById('bd-resize-layer');
  if (!layer) return;
  const existingHandles = new Map();
  const existingRects = new Map();
  layer.querySelectorAll('.bd-resize[data-node-id]').forEach(handle => existingHandles.set(handle.dataset.nodeId, handle));
  layer.querySelectorAll('.bd-selection-rect[data-node-id]').forEach(rect => existingRects.set(rect.dataset.nodeId, rect));
  // 選択枠 (.bd-selection-rect) はカード形状 (clip-path) に依らず矩形で表示するため、
  // カード本体 (.bd-node) の中ではなく `#bd-resize-layer` 内の兄弟要素として配置し、
  // node.x/y + offsetWidth/Height からサイズ・位置を同期する。
  // `node.contained` (コンテナ内ノード) はワールド座標と関係しない相対位置のためスキップ。
  bd.nodes.forEach(node => {
    if (!node || node.contained) return;
    const el = document.getElementById('bdn-' + node.id);
    if (!el || !el.isConnected) return;
    const isSelected = bd.selected.has(node.id);
    const isEditing = el.classList.contains('bd-editing');

    // 選択枠 (常に同期、選択中のみ表示。編集中は非表示)
    let rect = existingRects.get(node.id);
    if (!rect) {
      rect = document.createElement('div');
      rect.className = 'bd-selection-rect';
      rect.dataset.nodeId = node.id;
      layer.appendChild(rect);
    }
    rect.classList.toggle('is-visible', isSelected);
    rect.classList.toggle('is-editing', isEditing);
    if (isSelected) {
      const offset = 4;
      rect.style.left = `${node.x - offset}px`;
      rect.style.top = `${node.y - offset}px`;
      rect.style.width = `${el.offsetWidth + offset * 2}px`;
      rect.style.height = `${el.offsetHeight + offset * 2}px`;
    }
    existingRects.delete(node.id);

    // リサイズハンドル (最小化ノードはハンドル不要)
    if (!node.minimized) {
      let handle = existingHandles.get(node.id);
      if (!handle) {
        handle = document.createElement('div');
        handle.className = 'bd-resize';
        handle.dataset.nodeId = node.id;
        layer.appendChild(handle);
      }
      handle.classList.toggle('is-visible', isSelected);
      handle.style.left = `${node.x + el.offsetWidth}px`;
      handle.style.top = `${node.y + el.offsetHeight}px`;
      existingHandles.delete(node.id);
    }
  });
  existingHandles.forEach(handle => handle.remove());
  existingRects.forEach(rect => rect.remove());

  // Gap-1 §9.6: マルチ選択時の統合グループアンカー（bbox の 4 辺中央 + 四隅）
  _bdSyncGroupAnchors(layer);
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdSyncResizeHandles', _bdResizePerf);
}

// マルチ選択時のグループアンカー同期。
//   - 選択 1 件以下: グループアンカー削除 + .bd-has-multi-selection クラス解除
//   - ロック混在: グループアンカー削除（意図しない接続を避けるため。本監査 §5 仕様4 で確定）
//   - 複数選択: bbox を計算してアンカー 8 点を配置
function _bdSyncGroupAnchors(layer) {
  const canvas = document.getElementById('bd-canvas');
  const selIds = [...(bd.selected || [])];
  const existingGroup = layer.querySelector(':scope > .bd-selection-group-anchors');
  if (selIds.length <= 1) {
    if (canvas) canvas.classList.remove('bd-has-multi-selection');
    if (existingGroup) existingGroup.remove();
    return;
  }
  const hasLocked = selIds.some(id => !!bd.nodes.find(n => n.id === id)?.locked);
  if (hasLocked) {
    if (canvas) canvas.classList.remove('bd-has-multi-selection');
    if (existingGroup) existingGroup.remove();
    return;
  }
  if (canvas) canvas.classList.add('bd-has-multi-selection');
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  selIds.forEach(id => {
    const n = bd.nodes.find(v => v.id === id);
    if (!n || n.contained) return;
    const el = document.getElementById('bdn-' + id);
    if (!el) return;
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + el.offsetWidth);
    y1 = Math.max(y1, n.y + el.offsetHeight);
  });
  if (!isFinite(x0)) {
    if (canvas) canvas.classList.remove('bd-has-multi-selection');
    if (existingGroup) existingGroup.remove();
    return;
  }
  let group = existingGroup;
  if (!group) {
    group = document.createElement('div');
    group.className = 'bd-selection-group-anchors';
    group.style.cssText = 'position:absolute;pointer-events:none;z-index:11;';
    layer.appendChild(group);
    // 2026-04-18: 四隅 (tl/tr/bl/br) を廃止して辺中央 4 点のみに統一。
    ['top', 'bottom', 'left', 'right'].forEach(pos => {
      const a = document.createElement('div');
      a.className = 'bd-group-anchor ' + pos;
      a.title = 'ドラッグでラインを作成 (選択カード群から)';
      a.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault(); ev.stopPropagation();
        // 選択カード群の代表 ID = 最後に選択された contained でないカード。
        // bbox 計算で除外したノードを代表にすると、接続開始位置が bbox から外れるため。
        const selected = [...(bd.selected || [])];
        let repId = '';
        for (let i = selected.length - 1; i >= 0; i--) {
          const cand = selected[i];
          const candNode = bd.nodes.find(v => v.id === cand);
          if (candNode && !candNode.contained) { repId = cand; break; }
        }
        if (!repId) return;
        bd.connecting = repId;
        bd._connLabel = '';
        bd._connOrigin = 'anchor';
        if (typeof window.showStatus === 'function') {
          window.showStatus('接続先カードをクリック (空白クリックで新規カード作成)');
        }
      });
      group.appendChild(a);
    });
  }
  group.style.left = x0 + 'px';
  group.style.top = y0 + 'px';
  group.style.width = (x1 - x0) + 'px';
  group.style.height = (y1 - y0) + 'px';
}

function bdDetachParentChildRelation(parentId, childId) {
  const child = bd.nodes.find(node => node.id === childId);
  if (!child || child.parent !== parentId) return false;
  if (child.contained) {
    const pos = bdAbsolutePosition(child);
    child.x = pos.x;
    child.y = pos.y;
    child.contained = false;
  }
  child.parent = '';
  return true;
}

function bdRemoveConnection(connOrId, options = {}) {
  const conn = typeof connOrId === 'string' ? bdGetConnectionById(connOrId) : connOrId;
  if (!conn) return false;
  bd.connections = bd.connections.filter(item => item !== conn && item.id !== conn.id);
  if (!options.skipOrphan && conn.id && typeof apiPost === 'function' && bd?.path) {
    apiPost('/annotations/orphan-by-target', {
      target_kind: 'board_line',
      target_file: bd.path,
      item_id: conn.id,
      cascade_container: true,
    }).catch(() => {});
  }
  if (!options.skipSelection) bdRemoveConnectionFromSelection(conn.id);
  if (!options.skipRender) bdDrawConns();
  if (!options.skipDirty) bdDirty();
  return true;
}

function _bdIsClipPathHighlightShape(shape) {
  return shape === 'cloud' || shape === 'thorn' || shape === 'thorn-curve' || shape === 'fluffy'
    || shape === 'octagon';
}

function _bdApplyParentChildGroupHighlight(el, shape, color) {
  if (!el || !color) return;
  el.dataset.bdGroupColor = color;
  el.style.setProperty('--bd-group-hi', color);
  if (_bdIsClipPathHighlightShape(shape)) {
    el.classList.add('bd-group-hi-clip');
    el.style.setProperty('--bd-group-hi-filter', `drop-shadow(0 0 0 3px ${color})`);
  }
}

function _bdNormalizePathForGuard(path) {
  return String(path || '').trim().replace(/\\/g, '/');
}

function _bdPathExtension(path) {
  const cleanPath = _bdNormalizePathForGuard(path).split(/[?#]/)[0];
  const name = cleanPath.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function _bdIsBoardWritablePath(path) {
  return _bdPathExtension(path) === '.md';
}

function _bdRawLooksLikeBoardFile(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return !!fmMatch && /^\s*type:\s*board\s*$/m.test(fmMatch[1]);
}

function _bdCanSaveCurrentBoardPath(path) {
  const savePath = _bdNormalizePathForGuard(path);
  const loadedPath = _bdNormalizePathForGuard(bd._loadedBoardPath || '');
  return !!savePath && _bdIsBoardWritablePath(savePath) && !!loadedPath && savePath === loadedPath;
}

// --- Markdown解析 ---
function bdParseMd(raw) {
  raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n'); // 改行コード統一
  if (typeof bdStripLlmContextBlock === 'function') raw = bdStripLlmContextBlock(raw);
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  let positions = {}, nodeIds = {}, connections = [], sizes = {}, parents = {}, structures = {}, statuses = {}, bgcolors = {}, balloons = {}, containers = {}, links = {}, linkTypes = {}, groups = [], statusDefs = null, transforms = {}, canvasBg = '', fileTheme = null, cardStyles = [], lineStyles = [], depthStyles = [], boardUi = {}, llmSemantics = null;
  if (fmMatch) {
    const fm = fmMatch[1];
    if (typeof bdParseLlmSemanticsFrontmatter === 'function') llmSemantics = bdParseLlmSemanticsFrontmatter(fm);
    if (typeof bdYamlNestedMap === 'function') {
      Object.entries(bdYamlNestedMap(fm, 'ids')).forEach(([id, value]) => {
        const stableId = String(value == null ? '' : value).trim();
        if (stableId) nodeIds[id] = stableId;
      });
    }
    const posBlock = fm.match(/positions:\n((?:\s+\w+:.*\n?)*)/);
    if (posBlock) posBlock[1].replace(/(\w+):\s*\{x:\s*([\d.-]+),\s*y:\s*([\d.-]+)\}/g, (_, id, x, y) => { positions[id] = {x:+x, y:+y}; });
    if (typeof bdYamlNestedMap === 'function') {
      Object.entries(bdYamlNestedMap(fm, 'positions')).forEach(([id, pos]) => {
        if (pos && typeof pos === 'object' && Number.isFinite(+pos.x) && Number.isFinite(+pos.y)) positions[id] = { x: +pos.x, y: +pos.y };
      });
    }
    const szBlock = fm.match(/sizes:\n((?:\s+\w+:.*\n?)*)/);
    if (szBlock) szBlock[1].replace(/(\w+):\s*\{w:\s*([\d.-]+),\s*h:\s*([\d.-]+)\}/g, (_, id, w, h) => { sizes[id] = {w:+w, h:+h}; });
    if (typeof bdYamlNestedMap === 'function') {
      Object.entries(bdYamlNestedMap(fm, 'sizes')).forEach(([id, size]) => {
        if (size && typeof size === 'object') sizes[id] = { w: +size.w || 0, h: +size.h || 0 };
      });
    }
    const parBlock = fm.match(/parents:\n((?:\s+\w+:.*\n?)*)/);
    if (parBlock) parBlock[1].replace(/(\w+):\s*(\w+)/g, (_, id, pid) => { parents[id] = pid; });
    const strBlock = fm.match(/structures:\n((?:\s+\w+:.*\n?)*)/);
    if (strBlock) strBlock[1].replace(/(\w+):\s*(\w+)/g, (_, id, s) => { structures[id] = s; });
    const stBlock = fm.match(/statuses:\n((?:\s+\w+:.*\n?)*)/);
    if (stBlock) stBlock[1].replace(/(\w+):\s*(.+)/g, (_, id, s) => { statuses[id] = s.trim(); });
    const bgBlock = fm.match(/bgcolors:\n((?:\s+\w+:.*\n?)*)/);
    if (bgBlock) bgBlock[1].replace(/(\w+):\s*(.+)/g, (_, id, c) => { bgcolors[id] = c.trim(); });
    if (typeof bdYamlNestedMap === 'function') {
      Object.entries(bdYamlNestedMap(fm, 'bgcolors')).forEach(([id, value]) => {
        const color = value == null ? '' : String(value).trim();
        if (color && color !== 'null') bgcolors[id] = color;
      });
    }
    const balBlock = fm.match(/balloons:\n((?:\s+\w+:.*\n?)*)/);
    if (balBlock) balBlock[1].replace(/(\w+):\s*\{tailX:\s*([\d.-]+),\s*tailY:\s*([\d.-]+)(?:,\s*child:\s*(\w+))?\}/g, (_, id, tx, ty, ch) => { balloons[id] = {tailX:+tx, tailY:+ty, child:ch==='true'}; });
    const ctnBlock = fm.match(/containers:\n((?:\s+\w+:.*\n?)*)/);
    if (ctnBlock) ctnBlock[1].replace(/(\w+):\s*(\w+)/g, (_, id, val) => { containers[id] = val; });
    const lnkBlock = fm.match(/links:\n((?:\s+\w+:.*\n?)*)/);
    if (lnkBlock) lnkBlock[1].replace(/(\w+):\s*(.+)/g, (_, id, p) => { links[id] = p.trim(); });
    const lnkTypeBlock = fm.match(/linkTypes:\n((?:\s+\w+:.*\n?)*)/);
    if (lnkTypeBlock) lnkTypeBlock[1].replace(/(\w+):\s*([^\s]+)/g, (_, id, value) => { linkTypes[id] = value.trim(); });
    // PureRef属性（transforms）
    const tfBlock = fm.match(/transforms:\n((?:\s+\w+:.*\n?)*)/);
    if (tfBlock) tfBlock[1].replace(/(\w+):\s*\{([^}]+)\}/g, (_, id, props) => {
      const t = {};
      if (/flipH:\s*true/.test(props)) t.flipH = true;
      if (/flipV:\s*true/.test(props)) t.flipV = true;
      const rm = props.match(/rotate:\s*([\d.-]+)/); if (rm) t.rotate = +rm[1];
      const om = props.match(/opacity:\s*([\d.]+)/); if (om) t.opacity = +om[1];
      if (/locked:\s*true/.test(props)) t.locked = true;
      if (/collapsed:\s*true/.test(props)) t.collapsed = true;
      if (/minimized:\s*true/.test(props)) t.minimized = true;
      transforms[id] = t;
    });
    const bgMatch = fm.match(/canvasBg:\s*"([^"]+)"/);
    if (bgMatch) canvasBg = bgMatch[1];
    // ファイルスタイル（style: 優先、旧 theme: は後方互換で読む）
    const styleLines = typeof bdYamlTopLevelBlock === 'function'
      ? (bdYamlTopLevelBlock(fm, 'style').length ? bdYamlTopLevelBlock(fm, 'style') : bdYamlTopLevelBlock(fm, 'theme'))
      : [];
    const styleBlock = !styleLines.length
      ? (fm.match(/style:\n((?:\s+(?:--[\w-]+|__[A-Za-z0-9_-]+)[^\n]*\n?)*)/) || fm.match(/theme:\n((?:\s+--[^\n]+\n?)*)/))
      : null;
    if (styleLines.length || styleBlock) {
      fileTheme = {};
      if (styleLines.length && typeof bdYamlScalar === 'function') {
        styleLines.forEach(line => {
          const match = line.match(/^\s+((?:--[\w-]+)|__[A-Za-z0-9_-]+):\s*(.*)$/);
          if (match) fileTheme[match[1]] = bdYamlScalar(match[2]);
        });
      } else {
        styleBlock[1].replace(/^\s+((?:--[\w-]+)|__[A-Za-z0-9_-]+):\s*(.*)$/gm, (_, k, v) => { fileTheme[k] = v.trim().replace(/^"|"$/g, ''); });
      }
    }
    if (/numbering:\s*true/.test(fm)) bd._numbering = true;
    // Xmindメタ
    const xmBlock = fm.match(/xmind:\n((?:\s+\w+:.*\n?)*)/);
    if (xmBlock) xmBlock[1].replace(/(\w+):\s*\{([^}]+)\}/g, (_, id, props) => {
      const t = {};
      const nm = props.match(/note:\s*'((?:[^'\\]|\\.)*)'/); if (nm) t.note = nm[1].replace(/\\n/g, '\n').replace(/\\'/g, "'");
      if (/checked:\s*true/.test(props)) t.checked = true;
      else if (/checked:\s*false/.test(props)) t.checked = false;
      const pm = props.match(/progress:\s*(\d+)/); if (pm) t.progress = +pm[1];
      const mm = props.match(/markers:\s*(\{[^}]+\})/); if (mm) { try { t.markers = JSON.parse(mm[1]); } catch {} }
      const sm = props.match(/shape:\s*(\w+)/); if (sm) t.shape = sm[1];
      const fsm = props.match(/fontSize:\s*(\d+)/); if (fsm) t.fontSize = +fsm[1];
      if (/fontBold:\s*true/.test(props)) t.fontBold = true;
      if (/fontItalic:\s*true/.test(props)) t.fontItalic = true;
      const tcm = props.match(/textColor:\s*'((?:[^'\\]|\\.)*)'/); if (tcm) t.textColor = tcm[1].replace(/\\'/g, "'");
      const tscm = props.match(/textStrokeColor:\s*'((?:[^'\\]|\\.)*)'/); if (tscm) t.textStrokeColor = tscm[1].replace(/\\'/g, "'");
      const tswm = props.match(/textStrokeWidth:\s*(\d+)/); if (tswm) t.textStrokeWidth = +tswm[1];
      const bcm = props.match(/borderColor:\s*'((?:[^'\\]|\\.)*)'/); if (bcm) t.borderColor = bcm[1].replace(/\\'/g, "'");
      const bwm = props.match(/borderWidth:\s*(\d+)/); if (bwm) t.borderWidth = +bwm[1];
      const brm = props.match(/borderRadius:\s*(\d+)/); if (brm) t.borderRadius = +brm[1];
      const csm = props.match(/cardStyle:\s*([^\s,}]+)/); if (csm) t.cardStyle = csm[1];
      if (/autoStyle:\s*true/.test(props)) t._autoStyle = true;
      if (/followChildren:\s*true/.test(props)) t._followChildren = true;
      if (/collapsed:\s*true/.test(props)) t.collapsed = true;
      if (/minimized:\s*true/.test(props)) t.minimized = true;
      if (!transforms[id]) transforms[id] = {};
      Object.assign(transforms[id], t);
    });
    if (typeof bdYamlNestedMap === 'function') {
      Object.entries(bdYamlNestedMap(fm, 'xmind')).forEach(([id, props]) => {
        if (!props || typeof props !== 'object') return;
        const t = { ...props };
        if (Object.prototype.hasOwnProperty.call(t, 'autoStyle')) {
          t._autoStyle = !!t.autoStyle;
          delete t.autoStyle;
        }
        if (Object.prototype.hasOwnProperty.call(t, 'followChildren')) {
          t._followChildren = !!t.followChildren;
          delete t.followChildren;
        }
        if (!transforms[id]) transforms[id] = {};
        Object.assign(transforms[id], t);
      });
    }
    // ステータス定義
    const sdBlock = fm.match(/statusDefs:\n((?:\s+-.*\n?)*)/);
    if (sdBlock) {
      statusDefs = [];
      sdBlock[1].replace(/\{name:\s*"([^"]*)",\s*color:\s*"([^"]*)",\s*opacity:\s*([\d.]+),\s*border:\s*"([^"]*)"\}/g, (_,n,c,o,b) => { statusDefs.push({name:n,color:c,opacity:+o,border:b}); });
    }
    if (typeof bdYamlListObjects === 'function') {
      const parsedStatusDefs = bdYamlListObjects(fm, 'statusDefs');
      if (parsedStatusDefs.length) statusDefs = parsedStatusDefs;
    }
    const grpBlock = fm.match(/groups:\n((?:\s+-.*\n?)*)/);
    if (grpBlock) grpBlock[1].replace(/\{name:\s*"([^"]*)",\s*nodes:\s*\[([^\]]*)\]\}/g, (_, name, nodes) => {
      groups.push({id:bdId(), name, _nids: nodes.split(',').map(s=>s.trim()).filter(Boolean)});
    });
    if (typeof bdYamlListObjects === 'function') {
      const parsedGroups = bdYamlListObjects(fm, 'groups');
      if (parsedGroups.length) {
        groups = parsedGroups.map(item => {
          const nodeIds = Array.isArray(item.nodes)
            ? item.nodes
            : String(item.nodes || '').split(',');
          return {
            id: bdId(),
            name: item.name == null ? '' : String(item.name),
            _nids: nodeIds.map(id => String(id).trim()).filter(Boolean),
          };
        }).filter(g => g._nids.length);
      }
    }
    const cardStyleBlock = fm.match(/cardStyles:\n((?:\s+-.*\n?)*)/);
    if (cardStyleBlock) {
      cardStyles = [];
      (cardStyleBlock[1].match(/- \{.*\}/g) || []).forEach(line => {
        try { cardStyles.push(JSON.parse(line.replace(/^\s*-\s*/, ''))); } catch {}
      });
    }
    if (typeof bdYamlListObjects === 'function') {
      const parsedCardStyles = bdYamlListObjects(fm, 'cardStyles');
      if (parsedCardStyles.length) cardStyles = parsedCardStyles;
    }
    const lineStyleBlock = fm.match(/lineStyles:\n((?:\s+-.*\n?)*)/);
    if (lineStyleBlock) {
      lineStyles = [];
      (lineStyleBlock[1].match(/- \{.*\}/g) || []).forEach(line => {
        try {
          const ls = JSON.parse(line.replace(/^\s*-\s*/, ''));
          if (typeof _bdMigrateConnectionSchema === 'function') _bdMigrateConnectionSchema(ls);
          lineStyles.push(ls);
        } catch {}
      });
    }
    if (typeof bdYamlListObjects === 'function') {
      const parsedLineStyles = bdYamlListObjects(fm, 'lineStyles');
      if (parsedLineStyles.length) {
        parsedLineStyles.forEach(ls => { if (typeof _bdMigrateConnectionSchema === 'function') _bdMigrateConnectionSchema(ls); });
        lineStyles = parsedLineStyles;
      }
    }
    const depthStyleBlock = fm.match(/depthStyles:\n((?:\s+-.*\n?)*)/);
    if (depthStyleBlock) {
      depthStyles = [];
      (depthStyleBlock[1].match(/- \{.*\}/g) || []).forEach(line => {
        try {
          const ds = JSON.parse(line.replace(/^\s*-\s*/, ''));
          if (ds?.line && typeof _bdMigrateConnectionSchema === 'function') _bdMigrateConnectionSchema(ds.line);
          depthStyles.push(ds);
        } catch {}
      });
    }
    if (typeof bdYamlListObjects === 'function') {
      const parsedDepthStyles = bdYamlListObjects(fm, 'depthStyles');
      if (parsedDepthStyles.length) {
        parsedDepthStyles.forEach(ds => { if (ds?.line && typeof _bdMigrateConnectionSchema === 'function') _bdMigrateConnectionSchema(ds.line); });
        depthStyles = parsedDepthStyles;
      }
    }
    const boardUiBlock = fm.match(/boardUi:\n((?:\s+\w+:.*\n?)*)/);
    if (boardUiBlock) {
      const acm = boardUiBlock[1].match(/activeCardStyle:\s*([^\n]+)/);
      const alm = boardUiBlock[1].match(/activeLineStyle:\s*([^\n]+)/);
      const pvm = boardUiBlock[1].match(/stylePresetSeedVersion:\s*([^\n]+)/);
      const thm = boardUiBlock[1].match(/themeId:\s*([^\n]+)/);
      const ssm = boardUiBlock[1].match(/showShadow:\s*(true|false)/);
      const trm = boardUiBlock[1].match(/textRotateOnLine:\s*(true|false)/);
      const dfm = boardUiBlock[1].match(/displayFilters:\s*(\{[^\n]*\})/);
      if (acm) boardUi.activeCardStyle = acm[1].trim();
      if (alm) boardUi.activeLineStyle = alm[1].trim();
      if (pvm) boardUi.stylePresetSeedVersion = parseInt(pvm[1], 10) || 0;
      if (thm) boardUi.themeId = thm[1].trim();
      if (ssm) boardUi.showShadow = ssm[1] === 'true';
      if (trm) boardUi.textRotateOnLine = trm[1] === 'true';
      if (dfm) {
        try {
          const parsedFilters = JSON.parse(dfm[1]);
          if (parsedFilters && typeof parsedFilters === 'object' && !Array.isArray(parsedFilters)) {
            boardUi.displayFilters = parsedFilters;
          }
        } catch {}
      }
    }
    const connBlock = fm.match(/connections:\n((?:\s+-.*\n?)*)/);
    if (connBlock) {
      // 各接続線を個別にパース
      const connLines = connBlock[1].match(/- \{.*\}/g) || [];
      const parseConnScalar = (rawValue) => {
        if (typeof bdYamlScalar === 'function') return bdYamlScalar(rawValue);
        try { return JSON.parse(rawValue); } catch {}
        return String(rawValue || '').replace(/^"|"$/g, '');
      };
      connLines.forEach(cl => {
        const fmId = cl.match(/from:\s*(\w+)/);
        const tmId = cl.match(/to:\s*(\w+)/);
        const c = {from: fmId ? fmId[1] : '', to: tmId ? tmId[1] : '', label:''};
        const im = cl.match(/id:\s*("(?:(?:[^"\\]|\\.)*)"|[^\s,}]+)/); if(im) c.id = String(parseConnScalar(im[1]) ?? '');
        const fpm = cl.match(/fromPoint:\s*\[([-\d.]+),\s*([-\d.]+)\]/);
        const tpm = cl.match(/toPoint:\s*\[([-\d.]+),\s*([-\d.]+)\]/);
        if (fpm) c.fromPoint = { x: +fpm[1], y: +fpm[2] };
        if (tpm) c.toPoint = { x: +tpm[1], y: +tpm[2] };
        if (!bdConnectionHasEndpoint(c, 'from') || !bdConnectionHasEndpoint(c, 'to')) return;
        // arrow: プロパティが存在するときのみ c.arrow を設定。'none'/'false' の場合は
        // 明示的「矢印なし」として空文字列を設定（bdGetConnectionStyle は arrow プロパティの
        // 有無で style からの fallback を決めるため、プロパティ不在なら style の矢印が有効）
        const am = cl.match(/arrow:\s*(\w+)/);
        if (am) {
          if (am[1] === 'true') c.arrow = 'end';
          else if (am[1] === 'false' || am[1] === 'none') c.arrow = '';
          else c.arrow = am[1];
        }
        const lm = cl.match(/label:\s*"((?:[^"\\]|\\.)*)"/); if(lm) c.label = lm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const sm = cl.match(/style:\s*("(?:(?:[^"\\]|\\.)*)"|[^\s,}]+)/); if(sm) c.style = String(parseConnScalar(sm[1]) ?? '');
        const cm = cl.match(/color:\s*("(?:(?:[^"\\]|\\.)*)"|[^\s,}]+)/); if(cm && cm[1]!=='true'&&cm[1]!=='false') c.color = String(parseConnScalar(cm[1]) ?? '');
        const hm = cl.match(/hidden:\s*(\w+)/); if(hm) c.hidden = hm[1]==='true';
        const stm = cl.match(/straight:\s*(\w+)/); if(stm) c.straight = stm[1]==='true';
        const ptm = cl.match(/pathType:\s*([^\s,}]+)/); if(ptm) c.pathType = ptm[1];
        const wm = cl.match(/width:\s*([\d.]+)/); if(wm) c.width = +wm[1];
        const srm = cl.match(/styleRef:\s*([^\s,}]+)/); if(srm) c.styleRef = srm[1];
        const semm = cl.match(/semanticId:\s*([^\s,}]+)/); if(semm) c.semanticId = semm[1];
        const ltc = cl.match(/labelTextColor:\s*"((?:[^"\\]|\\.)*)"/); if(ltc) c.labelTextColor = ltc[1];
        const lbc = cl.match(/labelBgColor:\s*"((?:[^"\\]|\\.)*)"/); if(lbc) c.labelBgColor = lbc[1];
        const ldc = cl.match(/labelBorderColor:\s*"((?:[^"\\]|\\.)*)"/); if(ldc) c.labelBorderColor = ldc[1];
        const lbw = cl.match(/labelBorderWidth:\s*([\d.]+)/); if(lbw) c.labelBorderWidth = +lbw[1];
        const fbm = cl.match(/fontBold:\s*(true|false)/); if(fbm) c.fontBold = fbm[1] === 'true';
        const fim = cl.match(/fontItalic:\s*(true|false)/); if(fim) c.fontItalic = fim[1] === 'true';
        // テキスト表示・沿線回転・自動反転・縁取り太さ (Phase 5-3/5-4)
        const tvm = cl.match(/textVisible:\s*(true|false)/); if(tvm) c.textVisible = tvm[1] === 'true';
        const tapm = cl.match(/textAlongPath:\s*(true|false)/); if(tapm) c.textAlongPath = tapm[1] === 'true';
        const tafm = cl.match(/textAutoFlip:\s*(true|false)/); if(tafm) c.textAutoFlip = tafm[1] === 'true';
        const tswm = cl.match(/textShadowWidth:\s*([\d.]+)/); if(tswm) c.textShadowWidth = +tswm[1];
        const tscm = cl.match(/textShadowColor:\s*"((?:[^"\\]|\\.)*)"/); if(tscm) c.textShadowColor = tscm[1];
        // 曲線手動モード用: アンカー名と制御点 (始点/終点アンカー基準の相対オフセット)
        const fam = cl.match(/fromAnchor:\s*([a-z-]+)/); if(fam) c.fromAnchor = fam[1];
        const tam = cl.match(/toAnchor:\s*([a-z-]+)/); if(tam) c.toAnchor = tam[1];
        // controlPoints: [dx1,dy1,dx2,dy2] のフラット配列で保存。
        const cpm = cl.match(/controlPoints:\s*\[([-\d.,\s]+)\]/);
        if (cpm) {
          const parts = cpm[1].split(',').map(s => parseFloat(s.trim())).filter(v => Number.isFinite(v));
          if (parts.length === 4) c.controlPoints = [{ dx: parts[0], dy: parts[1] }, { dx: parts[2], dy: parts[3] }];
        }
        // v0.5.320: 直角線の分岐位置 / コーナー半径 (ライン個別設定)
        const brm = cl.match(/branchRatio:\s*([\d.]+)/); if (brm) c.branchRatio = +brm[1];
        const crm = cl.match(/cornerRadius:\s*([\d.]+)/); if (crm) c.cornerRadius = +crm[1];
        // 曲げポイント (bends / 旧 cx,cy) は v0.5.177 で廃止。旧データがあっても無視する
        if (typeof _bdMigrateConnectionSchema === 'function') _bdMigrateConnectionSchema(c);
        connections.push(c);
      });
    }
    if (typeof bdYamlListObjects === 'function') {
      const yamlConnections = bdYamlListObjects(fm, 'connections');
      if (yamlConnections.length) {
        connections = yamlConnections
          .map(item => {
            const c = { ...item };
            c.from = String(c.from || '');
            c.to = String(c.to || '');
            c.label = c.label == null ? '' : String(c.label);
            if (Object.prototype.hasOwnProperty.call(item, 'style')) c.style = c.style == null ? '' : String(c.style);
            else delete c.style;
            if (Object.prototype.hasOwnProperty.call(item, 'color')) c.color = c.color == null ? '' : String(c.color);
            else delete c.color;
            if (typeof _bdMigrateConnectionSchema === 'function') _bdMigrateConnectionSchema(c);
            if (c.fromPoint) c.fromPoint = bdNormalizeConnectionPoint(c.fromPoint);
            if (c.toPoint) c.toPoint = bdNormalizeConnectionPoint(c.toPoint);
            if (typeof bdNormalizeConnectionControlPoints === 'function') {
              const normalizedControlPoints = bdNormalizeConnectionControlPoints(c.controlPoints);
              if (normalizedControlPoints) c.controlPoints = normalizedControlPoints;
            }
            if (c.arrow === true) c.arrow = 'end';
            else if (c.arrow === false || c.arrow === 'false' || c.arrow === 'none') c.arrow = '';
            else if (c.arrow != null) c.arrow = String(c.arrow);
            if (c.semanticId != null) c.semanticId = String(c.semanticId);
            return c;
          })
          .filter(c => bdConnectionHasEndpoint(c, 'from') && bdConnectionHasEndpoint(c, 'to'));
      }
    }
    raw = raw.substring(fmMatch[0].length);
  }
  // ```board JSON ブロック形式の検出
  const jsonBlockMatch = raw.match(/^\s*```board\s*\n([\s\S]*?)\n```\s*$/);
  if (jsonBlockMatch) {
    try {
      const json = JSON.parse(jsonBlockMatch[1]);
      const jNodes = (json.nodes || []).map(n => {
        const node = bdNode(n.text || '', n.x || 0, n.y || 0, n.w || 160, n.h || 0, {
          img: n.img || '', parent: '', structure: n.structure || '',
        });
        node._jsonId = n.id || '';
        if (n.bgColor) node.bgColor = n.bgColor;
        if (n.shape) node.shape = n.shape;
        if (n.link) node.link = n.link;
        if (n.linkType) node.linkType = n.linkType;
        if (n.status) node.status = n.status;
        if (n.parent) node._jsonParent = n.parent;
        if (n.container) node.container = true;
        if (n.contained) node.contained = true;
        return node;
      });
      // ID マッピング（JSON id → 内部ID）
      const jIdMap = {};
      jNodes.forEach(n => { jIdMap[n._jsonId] = n.id; delete n._jsonId; });
      // 親子関係を解決
      jNodes.forEach(n => {
        if (n._jsonParent) { n.parent = jIdMap[n._jsonParent] || ''; delete n._jsonParent; }
      });
      // 接続線
      const jConns = (json.connections || []).map(c => {
        const conn = {
          from: c.from ? (jIdMap[c.from] || c.from) : '',
          to: c.to ? (jIdMap[c.to] || c.to) : '',
          label: c.label || '',
          styleRef: c.styleRef || '',
          width: c.width,
          pathType: c.pathType || (c.straight ? 'straight' : ''),
        };
        if (Object.prototype.hasOwnProperty.call(c, 'style')) conn.style = c.style == null ? '' : String(c.style);
        if (Object.prototype.hasOwnProperty.call(c, 'color')) conn.color = c.color == null ? '' : String(c.color);
        if (c.semanticId) conn.semanticId = String(c.semanticId);
        if (c.fromPoint) conn.fromPoint = bdNormalizeConnectionPoint(c.fromPoint);
        if (c.toPoint) conn.toPoint = bdNormalizeConnectionPoint(c.toPoint);
        // arrow は明示指定時のみプロパティとして設定し、style ベースの解決を残す
        if (c.arrow === 'end' || c.arrow === 'both' || c.arrow === 'start') conn.arrow = c.arrow;
        else if (c.arrow === true) conn.arrow = 'end';
        if (c.labelTextColor) conn.labelTextColor = c.labelTextColor;
        if (c.labelBgColor) conn.labelBgColor = c.labelBgColor;
        if (c.labelBorderColor) conn.labelBorderColor = c.labelBorderColor;
        if (typeof c.textVisible === 'boolean') conn.textVisible = c.textVisible;
        if (typeof c.textAlongPath === 'boolean') conn.textAlongPath = c.textAlongPath;
        if (typeof c.textAutoFlip === 'boolean') conn.textAutoFlip = c.textAutoFlip;
        if (Number.isFinite(+c.textShadowWidth)) conn.textShadowWidth = +c.textShadowWidth;
        if (c.textShadowColor) conn.textShadowColor = c.textShadowColor;
        if (typeof c.fromAnchor === 'string') conn.fromAnchor = c.fromAnchor;
        if (typeof c.toAnchor === 'string') conn.toAnchor = c.toAnchor;
        if (Array.isArray(c.controlPoints) && c.controlPoints.length === 2
            && c.controlPoints[0] && c.controlPoints[1]
            && Number.isFinite(+c.controlPoints[0].dx) && Number.isFinite(+c.controlPoints[0].dy)
            && Number.isFinite(+c.controlPoints[1].dx) && Number.isFinite(+c.controlPoints[1].dy)) {
          conn.controlPoints = [
            { dx: +c.controlPoints[0].dx, dy: +c.controlPoints[0].dy },
            { dx: +c.controlPoints[1].dx, dy: +c.controlPoints[1].dy },
          ];
        }
        if (Number.isFinite(+c.branchRatio)) conn.branchRatio = +c.branchRatio;
        if (Number.isFinite(+c.cornerRadius)) conn.cornerRadius = +c.cornerRadius;
        if (typeof _bdMigrateConnectionSchema === 'function') _bdMigrateConnectionSchema(conn);
        return conn;
      }).filter(c => bdConnectionHasEndpoint(c, 'from') && bdConnectionHasEndpoint(c, 'to'));
      if (typeof bdNormalizeParentGraph === 'function') bdNormalizeParentGraph(jNodes);
      if (canvasBg) bd._bgColor = canvasBg;
      const parsedLlmSemantics = typeof bdNormalizeLoadedLlmSemantics === 'function'
        ? bdNormalizeLoadedLlmSemantics(json.llmSemantics || llmSemantics, jIdMap)
        : (json.llmSemantics || llmSemantics);
      if (typeof bdEnsureConnectionSemanticIds === 'function') bdEnsureConnectionSemanticIds(jConns, null, parsedLlmSemantics);
      return { nodes: jNodes, connections: jConns, groups, statusDefs, fileTheme, cardStyles, lineStyles, depthStyles, boardUi, llmSemantics: parsedLlmSemantics };
    } catch (e) {
      console.warn('[bdParseMd] JSON board parse error:', e);
    }
  }
  // ノード解析: # で始まる行 = ノード
  const nodes = []; let cur = null;
  for (const line of raw.split('\n')) {
    const hm = line.match(/^#\s+(.*)/);
    if (hm) {
      if (cur) nodes.push(cur);
      const nid = 'n' + nodes.length;
      const pos = positions[nid] || {x: 100 + nodes.length * 200, y: 100 + (nodes.length % 4) * 120};
      const sz = sizes[nid] || {};
      const heading = hm[1];
      const isImg = heading.startsWith('[img]');
      const text = isImg ? '' : heading.replace(/^\\(\[img\])/, '$1');
      cur = bdNode(text, pos.x, pos.y, sz.w||160, sz.h||0, { id: nodeIds[nid] || undefined, img: isImg ? heading.replace('[img]','').trim() : '', parent: '', structure: '' });
      cur._nid = nid;
    } else if (cur) {
      if (!line.trim()) continue;
      const unescaped = line === '\\' ? ''
        : (/^\\{2,}$/.test(line) ? line.slice(1) : line.replace(/^\\(\\*#\s)/, '$1'));
      if (cur.img && !cur.text) cur.text = unescaped.trim();
      else cur.text += (cur.text ? '\n' : '') + unescaped;
    }
  }
  if (cur) nodes.push(cur);
  const idMap = {}; nodes.forEach(n => { idMap[n._nid] = n.id; delete n._nid; });
  // メタデータ復元
  nodes.forEach((n,i) => {
    const nid = 'n'+i;
    if (parents[nid]) n.parent = idMap[parents[nid]] || '';
    if (structures[nid]) n.structure = structures[nid];
    if (statuses[nid]) n.status = statuses[nid];
    if (bgcolors[nid]) n.bgColor = bgcolors[nid];
    if (containers[nid] === 'container') n.container = true;
    if (containers[nid] === 'contained') n.contained = true;
    if (balloons[nid]) { n.balloon = true; n.tailX = balloons[nid].tailX; n.tailY = balloons[nid].tailY; n.balloonChild = balloons[nid].child; }
    if (links[nid]) n.link = links[nid];
    if (linkTypes[nid]) n.linkType = linkTypes[nid];
    if (transforms[nid]) Object.assign(n, transforms[nid]);
  });
  if (typeof bdNormalizeParentGraph === 'function') bdNormalizeParentGraph(nodes);
  if (canvasBg) bd._bgColor = canvasBg;
  // グループのID変換
  groups.forEach(g => { g.nodeIds = g._nids.map(nid=>idMap[nid]).filter(Boolean); delete g._nids; });
  const mappedConnections = connections
    .map(c => ({...c, from:idMap[c.from]||c.from, to:idMap[c.to]||c.to}))
    .filter(c => bdConnectionHasEndpoint(c, 'from') && bdConnectionHasEndpoint(c, 'to'));
  const parsedLlmSemantics = typeof bdNormalizeLoadedLlmSemantics === 'function'
    ? bdNormalizeLoadedLlmSemantics(llmSemantics, idMap)
    : llmSemantics;
  if (typeof bdEnsureConnectionSemanticIds === 'function') bdEnsureConnectionSemanticIds(mappedConnections, null, parsedLlmSemantics);
  return { nodes, connections: mappedConnections, groups, statusDefs, fileTheme, cardStyles, lineStyles, depthStyles, boardUi, llmSemantics: parsedLlmSemantics };
}

// --- Markdown書き出し ---
function bdToMd() {
  const hasOwn = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  const fmtJsonString = (value) => JSON.stringify(String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  let fm = '---\ntype: board\npositions:\n';
  bd.nodes.forEach((n,i) => { fm += `  n${i}: {x: ${Math.round(n.x)}, y: ${Math.round(n.y)}}\n`; });
  fm += 'ids:\n';
  bd.nodes.forEach((n,i) => { if (n.id) fm += `  n${i}: ${fmtJsonString(n.id)}\n`; });
  fm += 'sizes:\n';
  bd.nodes.forEach((n,i) => { if (n.w || n.h) fm += `  n${i}: {w: ${Math.round(n.w||160)}, h: ${Math.round(n.h||0)}}\n`; });
  // 親子関係
  const m = {}; bd.nodes.forEach((n,i) => { m[n.id]='n'+i; });
  if (typeof bdEnsureConnectionSemanticIds === 'function') bdEnsureConnectionSemanticIds(bd.connections, m, bd.llmSemantics);
  const hasParents = bd.nodes.some(n => n.parent);
  if (hasParents) {
    fm += 'parents:\n';
    bd.nodes.forEach((n,i) => { if (n.parent) fm += `  n${i}: ${m[n.parent]}\n`; });
  }
  // 構造タイプ
  const hasStructures = bd.nodes.some(n => n.structure);
  if (hasStructures) {
    fm += 'structures:\n';
    bd.nodes.forEach((n,i) => { if (n.structure) fm += `  n${i}: ${n.structure}\n`; });
  }
  // ステータス
  const hasStatuses = bd.nodes.some(n => n.status);
  if (hasStatuses) {
    fm += 'statuses:\n';
    bd.nodes.forEach((n,i) => { if (n.status) fm += `  n${i}: ${n.status}\n`; });
  }
  const hasBgColors = bd.nodes.some(n => n.bgColor);
  if (hasBgColors) {
    fm += 'bgcolors:\n';
    bd.nodes.forEach((n,i) => { if (n.bgColor) fm += `  n${i}: ${n.bgColor}\n`; });
  }
  const hasContainers = bd.nodes.some(n => n.container || n.contained);
  if (hasContainers) {
    fm += 'containers:\n';
    bd.nodes.forEach((n,i) => {
      if (n.container) fm += `  n${i}: container\n`;
      else if (n.contained) fm += `  n${i}: contained\n`;
