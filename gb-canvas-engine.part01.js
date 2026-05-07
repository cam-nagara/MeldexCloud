/* gb-canvas-engine.part01.js */
/* gb-canvas-engine.js: Canvas Engine Core (v5.0 Phase C) */

/* ==============================
   ボードエンジン — 状態・解析・描画・選択・保存
   ============================== */

// --- ボード状態オブジェクト ---
const bd = {
  path:'', _loadedBoardPath:'', nodes:[], connections:[], selected:new Set(), editing:null,
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
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  let positions = {}, connections = [], sizes = {}, parents = {}, structures = {}, statuses = {}, bgcolors = {}, balloons = {}, containers = {}, links = {}, linkTypes = {}, groups = [], statusDefs = null, transforms = {}, canvasBg = '', fileTheme = null, cardStyles = [], lineStyles = [], depthStyles = [], boardUi = {};
  if (fmMatch) {
    const fm = fmMatch[1];
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
      if (acm) boardUi.activeCardStyle = acm[1].trim();
      if (alm) boardUi.activeLineStyle = alm[1].trim();
      if (pvm) boardUi.stylePresetSeedVersion = parseInt(pvm[1], 10) || 0;
      if (thm) boardUi.themeId = thm[1].trim();
      if (ssm) boardUi.showShadow = ssm[1] === 'true';
      if (trm) boardUi.textRotateOnLine = trm[1] === 'true';
    }
    const connBlock = fm.match(/connections:\n((?:\s+-.*\n?)*)/);
    if (connBlock) {
      // 各接続線を個別にパース
      const connLines = connBlock[1].match(/- \{.*\}/g) || [];
      connLines.forEach(cl => {
        const fmId = cl.match(/from:\s*(\w+)/);
        const tmId = cl.match(/to:\s*(\w+)/);
        const c = {from: fmId ? fmId[1] : '', to: tmId ? tmId[1] : '', label:'', style:'', color:''};
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
          else if (am[1] === 'false' || am[1] === 'none') { /* 明示指定なし: style から解決 */ }
          else c.arrow = am[1];
        }
        const lm = cl.match(/label:\s*"((?:[^"\\]|\\.)*)"/); if(lm) c.label = lm[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const sm = cl.match(/style:\s*(\w+)/); if(sm) c.style = sm[1];
        const cm = cl.match(/color:\s*([^\s,}]+)/); if(cm && cm[1]!=='true'&&cm[1]!=='false') c.color = cm[1];
        const hm = cl.match(/hidden:\s*(\w+)/); if(hm) c.hidden = hm[1]==='true';
        const stm = cl.match(/straight:\s*(\w+)/); if(stm) c.straight = stm[1]==='true';
        const ptm = cl.match(/pathType:\s*([^\s,}]+)/); if(ptm) c.pathType = ptm[1];
        const wm = cl.match(/width:\s*([\d.]+)/); if(wm) c.width = +wm[1];
        const srm = cl.match(/styleRef:\s*([^\s,}]+)/); if(srm) c.styleRef = srm[1];
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
            c.style = c.style == null ? '' : String(c.style);
            c.color = c.color == null ? '' : String(c.color);
            if (typeof _bdMigrateConnectionSchema === 'function') _bdMigrateConnectionSchema(c);
            return c;
          })
          .filter(c => bdConnectionHasEndpoint(c, 'from') && bdConnectionHasEndpoint(c, 'to'));
      }
    }
    raw = raw.substring(fmMatch[0].length);
  }
  // ```board JSON ブロック形式の検出
  const jsonBlockMatch = raw.match(/```board\s*\n([\s\S]*?)\n```/);
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
          style: c.style || '',
          color: c.color || '',
          styleRef: c.styleRef || '',
          width: c.width,
          pathType: c.pathType || (c.straight ? 'straight' : ''),
        };
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
      if (canvasBg) bd._bgColor = canvasBg;
      return { nodes: jNodes, connections: jConns, groups, statusDefs, fileTheme, cardStyles, lineStyles, depthStyles, boardUi };
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
      const isImg = hm[1].startsWith('[img]');
      cur = bdNode(isImg ? '' : hm[1], pos.x, pos.y, sz.w||160, sz.h||0, { img: isImg ? hm[1].replace('[img]','').trim() : '', parent: '', structure: '' });
      cur._nid = nid;
    } else if (cur && line.trim()) {
      const unescaped = line.replace(/^\\(\\*#\s)/, '$1');
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
  if (canvasBg) bd._bgColor = canvasBg;
  // グループのID変換
  groups.forEach(g => { g.nodeIds = g._nids.map(nid=>idMap[nid]).filter(Boolean); delete g._nids; });
  return { nodes, connections: connections.map(c => ({...c, from:idMap[c.from]||c.from, to:idMap[c.to]||c.to})).filter(c=>c.from&&c.to), groups, statusDefs, fileTheme, cardStyles, lineStyles, depthStyles, boardUi };
}

// --- Markdown書き出し ---
function bdToMd() {
  let fm = '---\ntype: board\npositions:\n';
  bd.nodes.forEach((n,i) => { fm += `  n${i}: {x: ${Math.round(n.x)}, y: ${Math.round(n.y)}}\n`; });
  fm += 'sizes:\n';
  bd.nodes.forEach((n,i) => { if (n.w || n.h) fm += `  n${i}: {w: ${Math.round(n.w||160)}, h: ${Math.round(n.h||0)}}\n`; });
  // 親子関係
  const m = {}; bd.nodes.forEach((n,i) => { m[n.id]='n'+i; });
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
    });
  }
  const hasLinks = bd.nodes.some(n => n.link);
  if (hasLinks) {
    fm += 'links:\n';
    bd.nodes.forEach((n,i) => { if (n.link) fm += `  n${i}: ${n.link}\n`; });
  }
  const hasLinkTypes = bd.nodes.some(n => n.link && n.linkType);
  if (hasLinkTypes) {
    fm += 'linkTypes:\n';
    bd.nodes.forEach((n,i) => { if (n.link && n.linkType) fm += `  n${i}: ${n.linkType}\n`; });
  }
  // PureRef属性
  const hasTransforms = bd.nodes.some(n => n.flipH || n.flipV || n.rotate || (n.opacity != null && n.opacity < 1) || n.locked);
  if (hasTransforms) {
    fm += 'transforms:\n';
    bd.nodes.forEach((n,i) => {
      const parts = [];
      if (n.flipH) parts.push('flipH: true');
      if (n.flipV) parts.push('flipV: true');
      if (n.rotate) parts.push('rotate: ' + n.rotate);
      if (n.opacity != null && n.opacity < 1) parts.push('opacity: ' + n.opacity);
      if (n.locked) parts.push('locked: true');
      if (parts.length) fm += `  n${i}: {${parts.join(', ')}}\n`;
    });
  }
  if (bd._bgColor) fm += 'canvasBg: "' + bd._bgColor + '"\n';
  if (bd._fileStyle && Object.keys(bd._fileStyle).length > 0) {
    fm += 'style:\n';
    for (const [k, v] of Object.entries(bd._fileStyle)) {
      fm += `  ${k}: ${JSON.stringify(String(v == null ? '' : v))}\n`;
    }
  }
  if (bd._numbering) fm += 'numbering: true\n';
  // Xmindメタ（note, checked, progress, markers, shape, font）
  const hasXmindMeta = bd.nodes.some(n => n.note || n.checked !== undefined || n.progress || n.markers && Object.keys(n.markers).length || n.shape || n.fontSize || n.fontBold || n.fontItalic || n.textColor || n.textStrokeColor || n.textStrokeWidth || n.borderColor || n.borderWidth || n.borderRadius || n.cardStyle || n._autoStyle || n._followChildren || n.collapsed || n.minimized);
  if (hasXmindMeta) {
    fm += 'xmind:\n';
    bd.nodes.forEach((n,i) => {
      const parts = [];
      if (n.note) parts.push("note: '" + n.note.replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'");
      if (n.checked !== undefined) parts.push('checked: ' + (n.checked ? 'true' : 'false'));
      if (n.progress) parts.push('progress: ' + n.progress);
      if (n.markers && Object.keys(n.markers).length) parts.push('markers: ' + JSON.stringify(n.markers));
      if (n.shape) parts.push('shape: ' + n.shape);
      if (n.fontSize && n.fontSize !== 13) parts.push('fontSize: ' + n.fontSize);
      if (n.fontBold) parts.push('fontBold: true');
      if (n.fontItalic) parts.push('fontItalic: true');
      if (n.textColor) parts.push("textColor: '" + n.textColor.replace(/'/g, "\\'") + "'");
      if (n.textStrokeColor) parts.push("textStrokeColor: '" + n.textStrokeColor.replace(/'/g, "\\'") + "'");
      if (n.textStrokeWidth) parts.push('textStrokeWidth: ' + n.textStrokeWidth);
      if (n.borderColor) parts.push("borderColor: '" + n.borderColor.replace(/'/g, "\\'") + "'");
      if (n.borderWidth) parts.push('borderWidth: ' + n.borderWidth);
      if (n.borderRadius) parts.push('borderRadius: ' + n.borderRadius);
      if (n.cardStyle) parts.push('cardStyle: ' + n.cardStyle);
      if (n._autoStyle) parts.push('autoStyle: true');
      if (n._followChildren) parts.push('followChildren: true');
      if (n.collapsed) parts.push('collapsed: true');
      if (n.minimized) parts.push('minimized: true');
      if (parts.length) fm += `  n${i}: {${parts.join(', ')}}\n`;
    });
  }
  // バルーン
  const hasBalloons = bd.nodes.some(n => n.balloon);
  if (hasBalloons) {
    fm += 'balloons:\n';
    bd.nodes.forEach((n,i) => { if (n.balloon) fm += `  n${i}: {tailX: ${n.tailX||0}, tailY: ${n.tailY||0}${n.balloonChild ? ', child: true' : ''}}\n`; });
  }
  // ステータス定義
  if (bd.statuses && bd.statuses.length) {
    fm += 'statusDefs:\n';
    bd.statuses.forEach(s => { fm += `  - {name: "${s.name}", color: "${s.color}", opacity: ${s.opacity}, border: "${s.border||''}"}\n`; });
  }
  // グループ
  if (bd.groups && bd.groups.length) {
    fm += 'groups:\n';
    bd.groups.forEach(g => {
      fm += `  - {name: "${g.name}", nodes: [${g.nodeIds.map(id=>m[id]).filter(Boolean).join(', ')}]}\n`;
    });
  }
  if (bd.cardStyles && bd.cardStyles.length) {
    fm += 'cardStyles:\n';
    bd.cardStyles.forEach(style => { fm += `  - ${JSON.stringify(style)}\n`; });
  }
  if (bd.lineStyles && bd.lineStyles.length) {
    fm += 'lineStyles:\n';
    bd.lineStyles.forEach(style => { fm += `  - ${JSON.stringify(style)}\n`; });
  }
  if (bd.depthStyles && bd.depthStyles.length) {
    fm += 'depthStyles:\n';
    bd.depthStyles.forEach(style => { fm += `  - ${JSON.stringify(style)}\n`; });
  }
  if (bd.activeCardStyle || bd.activeLineStyle || bd._stylePresetSeedVersion || bd.themeId || bd._showShadow || bd._textRotateOnLine) {
    fm += 'boardUi:\n';
    if (bd.activeCardStyle) fm += `  activeCardStyle: ${bd.activeCardStyle}\n`;
    if (bd.activeLineStyle) fm += `  activeLineStyle: ${bd.activeLineStyle}\n`;
    if (bd._stylePresetSeedVersion) fm += `  stylePresetSeedVersion: ${bd._stylePresetSeedVersion}\n`;
    if (bd.themeId) fm += `  themeId: ${bd.themeId}\n`;
    if (bd._showShadow) fm += `  showShadow: true\n`;
    if (bd._textRotateOnLine) fm += `  textRotateOnLine: true\n`;
  }
  if (bd.connections.length) {
    fm += 'connections:\n';
    bd.connections.forEach(c => {
      const fmt = (v) => Number.isFinite(+v) ? (+v).toFixed(2).replace(/\.?0+$/, '') : '0';
      const fmtPoint = (point) => {
        const p = bdNormalizeConnectionPoint(point);
        if (!p) return '[0,0]';
        return `[${fmt(p.x)},${fmt(p.y)}]`;
      };
      const endpointParts = [];
      if (c.from && m[c.from]) endpointParts.push(`from: ${m[c.from]}`);
      else if (bdNormalizeConnectionPoint(c.fromPoint)) endpointParts.push(`fromPoint: ${fmtPoint(c.fromPoint)}`);
      if (c.to && m[c.to]) endpointParts.push(`to: ${m[c.to]}`);
      else if (bdNormalizeConnectionPoint(c.toPoint)) endpointParts.push(`toPoint: ${fmtPoint(c.toPoint)}`);
      if (endpointParts.length < 2) return;
      let s = `  - {${endpointParts.join(', ')}`;
      // arrow は明示的に設定されているときだけ書き出す (空文字列や undefined は
      // 省略して style 側の arrow に委ねる)
      if (c.arrow === 'end' || c.arrow === 'both' || c.arrow === 'start') s += `, arrow: ${c.arrow}`;
      if (c.label) s += `, label: "${c.label.replace(/"/g,'\\"')}"`;
      if (c.style) s += `, style: ${c.style}`;
      if (c.color) s += `, color: ${c.color}`;
      // v0.5.320: pathType を 3 種 (curve/straight/orthogonal) に統合して書き出す。
      // curve は既定のため省略、straight/orthogonal のみ明示。
      if (c.pathType === 'orthogonal') s += ', pathType: orthogonal';
      else if (c.pathType === 'straight') s += ', pathType: straight';
      if (c.hidden) s += ', hidden: true';
      if (c.width) s += ', width: ' + c.width;
      if (c.styleRef) s += ', styleRef: ' + c.styleRef;
      if (c.labelTextColor) s += `, labelTextColor: "${c.labelTextColor.replace(/"/g, '\\"')}"`;
      if (c.labelBgColor) s += `, labelBgColor: "${c.labelBgColor.replace(/"/g, '\\"')}"`;
      if (c.labelBorderColor) s += `, labelBorderColor: "${c.labelBorderColor.replace(/"/g, '\\"')}"`;
      if (Number.isFinite(+c.labelBorderWidth) && +c.labelBorderWidth !== 0) s += `, labelBorderWidth: ${+c.labelBorderWidth}`;
      if (c.fontBold === true) s += ', fontBold: true';
      if (c.fontItalic === true) s += ', fontItalic: true';
      // テキスト表示・沿線回転・自動反転・縁取り太さ (default と異なる場合のみ書き出し)
      if (c.textVisible === false) s += ', textVisible: false';
      if (c.textAlongPath === true) s += ', textAlongPath: true';
      if (c.textAutoFlip === false) s += ', textAutoFlip: false';
      if (Number.isFinite(+c.textShadowWidth) && +c.textShadowWidth !== 0) s += `, textShadowWidth: ${+c.textShadowWidth}`;
      if (c.textShadowColor) s += `, textShadowColor: "${c.textShadowColor.replace(/"/g, '\\"')}"`;
      if (c.fromAnchor) s += `, fromAnchor: ${c.fromAnchor}`;
      if (c.toAnchor) s += `, toAnchor: ${c.toAnchor}`;
      if (Number.isFinite(+c.branchRatio)) s += `, branchRatio: ${+c.branchRatio}`;
      if (Number.isFinite(+c.cornerRadius)) s += `, cornerRadius: ${+c.cornerRadius}`;
      if (Array.isArray(c.controlPoints) && c.controlPoints.length === 2
          && c.controlPoints[0] && c.controlPoints[1]) {
        const cp = c.controlPoints;
        s += `, controlPoints: [${fmt(cp[0].dx)},${fmt(cp[0].dy)},${fmt(cp[1].dx)},${fmt(cp[1].dy)}]`;
      }
      fm += s + '}\n';
    });
  }
  fm += '---\n';
  const _escapeBody = (s) => s.replace(/^(\\*#\s)/gm, '\\$1');
  let body = '';
  bd.nodes.forEach(n => {
    if (n.img) { body += '# [img]' + n.img + '\n'; if (n.text) body += _escapeBody(n.text) + '\n'; }
    else {
      const lines = n.text.split('\n');
      body += '# ' + lines[0] + '\n';
      if (lines.length > 1) body += _escapeBody(lines.slice(1).join('\n')) + '\n';
    }
    body += '\n';
  });
  return fm + body;
}

// --- リンクツールチップ ---
let _linkTooltipEl = null;
let _linkTooltipTimer = null;
let _linkTooltipToken = 0;
let _linkTooltipSuppressedNode = null;

function _isLinkTooltipSuppressed(nodeDiv) {
  if (!_linkTooltipSuppressedNode) return false;
  if (!document.documentElement.contains(_linkTooltipSuppressedNode)) {
    _linkTooltipSuppressedNode = null;
    return false;
  }
  return nodeDiv === _linkTooltipSuppressedNode || _linkTooltipSuppressedNode.contains(nodeDiv);
}

function _showLinkTooltip(nodeDiv, linkPath, linkType) {
  if (_linkTooltipSuppressedNode && !_linkTooltipSuppressedNode.contains(nodeDiv)) _linkTooltipSuppressedNode = null;
  if (_isLinkTooltipSuppressed(nodeDiv)) return;
  const token = ++_linkTooltipToken;
  clearTimeout(_linkTooltipTimer);
  _linkTooltipTimer = setTimeout(async () => {
    try {
      const resp = await fetch(API_BASE + '/file?path=' + encodeURIComponent(linkPath));
      if (!resp.ok) return;
      const data = await resp.json();
      let text = typeof bdBuildPreviewSummary === 'function'
        ? bdBuildPreviewSummary(linkPath, data.content || '', linkType)
        : (data.content || '');
      text = text.substring(0, 300);
      if (text.length >= 300) text += '\u2026';

      if (token !== _linkTooltipToken || !document.documentElement.contains(nodeDiv)) return;
      if (_linkTooltipEl) { _linkTooltipEl.remove(); _linkTooltipEl = null; }
      const tip = document.createElement('div');
      tip.className = 'bd-link-tooltip';
      tip.textContent = text || '(\u7a7a)';
      const rect = nodeDiv.getBoundingClientRect();
      const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
      tip.style.left = (rect.left / z) + 'px';
      tip.style.top = (rect.bottom / z + 4) + 'px';
      tip.style.maxWidth = Math.min(400, window.innerWidth / z - rect.left / z - 20) + 'px';
      document.body.appendChild(tip);
      _linkTooltipEl = tip;
    } catch {}
  }, 500);
}

function _isLinkTooltipVisible() {
  return !!(_linkTooltipEl && document.documentElement.contains(_linkTooltipEl));
}

function _hideLinkTooltip(options = {}) {
  _linkTooltipToken++;
  clearTimeout(_linkTooltipTimer);
  if (_linkTooltipEl) { _linkTooltipEl.remove(); _linkTooltipEl = null; }
  if (options.suppressNode && document.documentElement.contains(options.suppressNode)) {
    _linkTooltipSuppressedNode = options.suppressNode;
  } else if (options.clearSuppression !== false) {
    _linkTooltipSuppressedNode = null;
  }
}

// --- 雲型のクリップパスを動的生成 (楕円ベース + 丸い山) ---
// カードの中心に楕円を配置し、その周囲に半円状の丸い山を並べる。
// 各山は cubic Bezier 1 本で描画。制御点は弦に対して純粋に垂直方向
// （外向き）に伸ばし、magnitude = (4/3) × BUMP_H とする。これにより:
//   - 山は弦に対して対称な半円状の膨らみになり、尖らない
//   - Bezier の t=0.5 の位置がちょうど「弦の中点 + BUMP_H × 垂直外向き」＝peak になる
//   - 隣接する山との間で接線が反転し、谷が自然な V 字の cusp になる（雲らしい境界）
// opts:
//   bumpW:  山の平均幅 (周長基準, px, default 40)。山の個数 = round(周長 / bumpW)
//   bumpH:  山の高さ (弦の中点から外向きの膨らみ, px, default 16)
//   offset: 山の位相ズラし量 (0.0〜1.0, default 0.5)
//   sideW / radius: 未使用 (楕円ベースでは意味を持たない)
function _bdCloudClipPath(width, height, opts) {
  if (!(width > 4) || !(height > 4)) return '';
  const BUMP_W = Math.max(8, opts?.bumpW || 40);
  const BUMP_H = Math.max(2, opts?.bumpH || 16);
  const OFFSET = Math.max(0, Math.min(1, opts?.offset ?? 0.5));
  // 小山比率 (0〜100%)。幅・高さを個別に設定。両方 > 0 のとき小山が現れる。
  const SUB_W_PCT = Math.max(0, Math.min(100, +opts?.subWidth || 0));
  const SUB_H_PCT = Math.max(0, Math.min(100, +opts?.subHeight || 0));
  const SUB_ENABLED = SUB_W_PCT > 0 && SUB_H_PCT > 0;
  const SUB_W_RATIO = SUB_W_PCT / 100;
  const SUB_H_RATIO = SUB_H_PCT / 100;

  const cx = width / 2;
  const cy = height / 2;
  const effBumpH = Math.min(BUMP_H, Math.min(cx, cy) - 2);
  if (effBumpH < 2) return '';
  const rx = cx - effBumpH;
  const ry = cy - effBumpH;

  const hVal = Math.pow((rx - ry) / (rx + ry), 2);
  const perim = Math.PI * (rx + ry) * (1 + 3 * hVal / (10 + Math.sqrt(4 - 3 * hVal)));

  // 1 スロット = メイン山 (+ 任意で小山)。メイン山は BUMP_W 幅を保ち、小山は BUMP_W*SUB_W_RATIO 幅。
  const slotWidth = SUB_ENABLED ? BUMP_W * (1 + SUB_W_RATIO) : BUMP_W;
  const numSlots = Math.max(SUB_ENABLED ? 3 : 6, Math.round(perim / slotWidth));
  const numBumps = SUB_ENABLED ? numSlots * 2 : numSlots;
  const periodAngle = (2 * Math.PI) / numSlots;
  const angleMain = SUB_ENABLED ? periodAngle / (1 + SUB_W_RATIO) : periodAngle;
  const angleSub = SUB_ENABLED ? angleMain * SUB_W_RATIO : 0;
  const baseAngle = -Math.PI / 2 + OFFSET * periodAngle;

  const ellipsePoint = (t) => ({
    x: cx + rx * Math.cos(t),
    y: cy + ry * Math.sin(t),
  });

  const fmt = (n) => n.toFixed(2);
  let angle = baseAngle;
  const v0 = ellipsePoint(angle);
  let d = `M ${fmt(v0.x)} ${fmt(v0.y)}`;

  for (let i = 0; i < numBumps; i++) {
    const isSub = SUB_ENABLED && (i % 2 === 1);
    const bumpAngle = isSub ? angleSub : angleMain;
    const hMul = isSub ? SUB_H_RATIO : 1;
    const mLen = (4 / 3) * effBumpH * hMul;

    const tStart = angle;
    const tEnd = angle + bumpAngle;
    angle = tEnd;
    const vStart = ellipsePoint(tStart);
    const vEnd = ellipsePoint(tEnd);

    const mx = (vStart.x + vEnd.x) / 2;
    const my = (vStart.y + vEnd.y) / 2;
    const chordX = vEnd.x - vStart.x;
    const chordY = vEnd.y - vStart.y;
    const chordLen = Math.hypot(chordX, chordY);
    if (chordLen < 0.001) continue;
    let perpX = -chordY / chordLen;
    let perpY = chordX / chordLen;
    if (perpX * (mx - cx) + perpY * (my - cy) < 0) { perpX = -perpX; perpY = -perpY; }

    const offX = mLen * perpX;
    const offY = mLen * perpY;
    const p1x = vStart.x + offX;
    const p1y = vStart.y + offY;
    const p2x = vEnd.x + offX;
    const p2y = vEnd.y + offY;

    d += ` C ${fmt(p1x)} ${fmt(p1y)}, ${fmt(p2x)} ${fmt(p2y)}, ${fmt(vEnd.x)} ${fmt(vEnd.y)}`;
  }
  d += ' Z';
  return `path('${d}')`;
}

// --- トゲ型 (直線) のクリップパスを動的生成 (楕円ベース) ---
// カードの中心に楕円を配置し、その周囲に放射状に尖った山を並べる形状。
// 雲型と同じパラメータを共有するが、ベース形状が矩形でなく楕円。
// opts:
//   bumpW:  山の平均幅 (周長基準, px, default 40)。山の個数 = round(周長 / bumpW)
//   bumpH:  トゲの高さ (楕円の外側に radial 方向で張り出す量, px, default 16)
//   offset: 山の位相ズラし量 (0.0〜1.0, default 0.5)。基準角度を stepAngle * OFFSET だけ回転
//   sideW / radius: 未使用 (楕円ベースでは左右辺区別も角丸も不要)
// path は valley と peak をアンカーに持つ直線 (L) の連続。完全な polygon 相当で、peak が鋭く尖り、
// 輪郭も曲線にならない。
function _bdThornClipPath(width, height, opts) {
  if (!(width > 4) || !(height > 4)) return '';
  const BUMP_W = Math.max(8, opts?.bumpW || 40);
  const BUMP_H = Math.max(2, opts?.bumpH || 16);
  const OFFSET = Math.max(0, Math.min(1, opts?.offset ?? 0.5));
  const SUB_W_PCT = Math.max(0, Math.min(100, +opts?.subWidth || 0));
  const SUB_H_PCT = Math.max(0, Math.min(100, +opts?.subHeight || 0));
  const SUB_ENABLED = SUB_W_PCT > 0 && SUB_H_PCT > 0;
  const SUB_W_RATIO = SUB_W_PCT / 100;
  const SUB_H_RATIO = SUB_H_PCT / 100;

  const cx = width / 2;
  const cy = height / 2;
  const effBumpH = Math.min(BUMP_H, Math.min(cx, cy) - 2);
  if (effBumpH < 2) return '';
  const rx = cx - effBumpH;
  const ry = cy - effBumpH;

  const hVal = Math.pow((rx - ry) / (rx + ry), 2);
  const perim = Math.PI * (rx + ry) * (1 + 3 * hVal / (10 + Math.sqrt(4 - 3 * hVal)));

  const slotWidth = SUB_ENABLED ? BUMP_W * (1 + SUB_W_RATIO) : BUMP_W;
  const numSlots = Math.max(SUB_ENABLED ? 3 : 6, Math.round(perim / slotWidth));
  const numBumps = SUB_ENABLED ? numSlots * 2 : numSlots;
  const periodAngle = (2 * Math.PI) / numSlots;
  const angleMain = SUB_ENABLED ? periodAngle / (1 + SUB_W_RATIO) : periodAngle;
  const angleSub = SUB_ENABLED ? angleMain * SUB_W_RATIO : 0;
  const baseAngle = -Math.PI / 2 + OFFSET * periodAngle;

  const ellipsePoint = (t) => ({
    x: cx + rx * Math.cos(t),
    y: cy + ry * Math.sin(t),
  });
  const peakAt = (t, hMul) => ({
    x: cx + (rx + effBumpH * hMul) * Math.cos(t),
    y: cy + (ry + effBumpH * hMul) * Math.sin(t),
  });

  const fmt = (n) => n.toFixed(2);
  let angle = baseAngle;
  const v0 = ellipsePoint(angle);
  let d = `M ${fmt(v0.x)} ${fmt(v0.y)}`;
  for (let i = 0; i < numBumps; i++) {
    const isSub = SUB_ENABLED && (i % 2 === 1);
    const bumpAngle = isSub ? angleSub : angleMain;
    const hMul = isSub ? SUB_H_RATIO : 1;
    const tMid = angle + bumpAngle / 2;
    angle += bumpAngle;
    const vEnd = ellipsePoint(angle);
    const peak = peakAt(tMid, hMul);
    d += ` L ${fmt(peak.x)} ${fmt(peak.y)} L ${fmt(vEnd.x)} ${fmt(vEnd.y)}`;
  }
  d += ' Z';
  return `path('${d}')`;
}

// --- トゲ型 (曲線) のクリップパスを動的生成 (楕円ベース) ---
// 既存のトゲ型 (直線) と違い、各トゲの左右側面が内向きにくぼむ曲線で鋭い先端を作る爆発フキダシ風。
//
// 設計方針 (peak アンカー方式):
//   - path のアンカーポイントは peak のみ。valley はアンカーを置かず、
//     隣接 peak 間を結ぶ cubic Bezier の「谷」として暗黙的に発生する。
//   - これで valley 近辺の接線問題 (連続・不連続どちらでも出る弊害) が構造的に発生しない。
//   - peak は path 上で接線不連続となり、必ず鋭い尖りになる。
//   - 隣接 peak 間 Bezier の制御点を「peak 相手方向 × TPULL + 中心方向 × DEPTH」で配置して
//     2 peak 間に内向きに凹む谷を自然に作る。
// パラメータは _bdThornClipPath と同一 (共通スタイル設定を流用)。
function _bdThornCurveClipPath(width, height, opts) {
  if (!(width > 4) || !(height > 4)) return '';
  const BUMP_W = Math.max(8, opts?.bumpW || 40);
  const BUMP_H = Math.max(2, opts?.bumpH || 16);
  const OFFSET = Math.max(0, Math.min(1, opts?.offset ?? 0.5));
  const SUB_W_PCT = Math.max(0, Math.min(100, +opts?.subWidth || 0));
  const SUB_H_PCT = Math.max(0, Math.min(100, +opts?.subHeight || 0));
  const SUB_ENABLED = SUB_W_PCT > 0 && SUB_H_PCT > 0;
  const SUB_W_RATIO = SUB_W_PCT / 100;
  const SUB_H_RATIO = SUB_H_PCT / 100;
  // 制御点を相手 peak 方向に引き寄せる距離比 (弦長 peak-peak × TPULL)。0.5 で cubic の定石位置に近い。
  const TPULL = 0.33;
  // 谷の深さ (effBumpH × DEPTH_RATIO)。制御点を中心方向にこの距離だけオフセットし、谷の底の深さを決める。
  const DEPTH_RATIO = 0.9;

  const cx = width / 2;
  const cy = height / 2;
  const effBumpH = Math.min(BUMP_H, Math.min(cx, cy) - 2);
  if (effBumpH < 2) return '';
  const rx = cx - effBumpH;
  const ry = cy - effBumpH;

  const hVal = Math.pow((rx - ry) / (rx + ry), 2);
  const perim = Math.PI * (rx + ry) * (1 + 3 * hVal / (10 + Math.sqrt(4 - 3 * hVal)));

  const slotWidth = SUB_ENABLED ? BUMP_W * (1 + SUB_W_RATIO) : BUMP_W;
  const numSlots = Math.max(SUB_ENABLED ? 3 : 6, Math.round(perim / slotWidth));
  const numBumps = SUB_ENABLED ? numSlots * 2 : numSlots;
  const periodAngle = (2 * Math.PI) / numSlots;
  const angleMain = SUB_ENABLED ? periodAngle / (1 + SUB_W_RATIO) : periodAngle;
  const angleSub = SUB_ENABLED ? angleMain * SUB_W_RATIO : 0;
  const baseAngle = -Math.PI / 2 + OFFSET * periodAngle;

  const peakAt = (t, hMul) => ({
    x: cx + (rx + effBumpH * hMul) * Math.cos(t),
    y: cy + (ry + effBumpH * hMul) * Math.sin(t),
  });

  // 各 peak の座標と個別の hMul を事前計算する。
  // 1 主山ごとのサイクル: 主山 peak → (小山 peak) → 次の主山 peak ...。
  // 角度の配置は直線トゲ / 雲型と同じ (角度的に等間隔なスロット。小山は主山の合間)。
  const peaks = [];
  let angle = baseAngle;
  for (let i = 0; i < numBumps; i++) {
    const isSub = SUB_ENABLED && (i % 2 === 1);
    const bumpAngle = isSub ? angleSub : angleMain;
    const hMul = isSub ? SUB_H_RATIO : 1;
    const tMid = angle + bumpAngle / 2;
    angle += bumpAngle;
    peaks.push(peakAt(tMid, hMul));
  }

  const fmt = (n) => n.toFixed(2);
  let d = `M ${fmt(peaks[0].x)} ${fmt(peaks[0].y)}`;
  for (let i = 0; i < numBumps; i++) {
    const p0 = peaks[i];
    const p1 = peaks[(i + 1) % numBumps];

    // 弦 p0 → p1 の中点から中心へ向かう単位ベクトル
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    const dxc = cx - mx;
    const dyc = cy - my;
    const lenc = Math.hypot(dxc, dyc);
    const inX = lenc > 0.001 ? dxc / lenc : 0;
    const inY = lenc > 0.001 ? dyc / lenc : 0;

    // 2 peak 間 cubic の制御点:
    //   c1 = p0 + (p1 - p0) × TPULL + inDir × depth
    //   c2 = p1 + (p0 - p1) × TPULL + inDir × depth
    // 両制御点を中心方向に depth ずつオフセットすることで、Bezier の中間が中心寄りに凹み、谷になる。
    const depth = effBumpH * DEPTH_RATIO;
    const c1x = p0.x + (p1.x - p0.x) * TPULL + inX * depth;
    const c1y = p0.y + (p1.y - p0.y) * TPULL + inY * depth;
    const c2x = p1.x + (p0.x - p1.x) * TPULL + inX * depth;
    const c2y = p1.y + (p0.y - p1.y) * TPULL + inY * depth;

    d += ` C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  d += ' Z';
  return `path('${d}')`;
}

// --- もやもや型 (雲型のバリアント、谷が丸くなだらかな波) のクリップパスを動的生成 ---
// v0.5.250 追加。雲型が「山:cubic Bezier / 谷:アンカー (接線不連続で鋭い凹み)」なのに対し、
// もやもやは山・谷ともに滑らかな曲線でつながる。
// 実装: 半径を r(θ) = rBase + amp * cos(numBumps * θ) で角度方向に波打たせ、周上を細かくサンプル。
// サンプル点列を閉じた Catmull-Rom → Cubic Bezier に変換して描画 (C1 連続 = 全アンカーで接線が一致)。
// opts: 雲型と共通 (bumpW, bumpH, offset, subWidth, subHeight)。小山はもやもやでは振幅を細かく変調する副波として扱う。
function _bdFluffyClipPath(width, height, opts) {
  if (!(width > 4) || !(height > 4)) return '';
  const BUMP_W = Math.max(8, opts?.bumpW || 40);
  const BUMP_H = Math.max(2, opts?.bumpH || 16);
  const OFFSET = Math.max(0, Math.min(1, opts?.offset ?? 0.5));
  const SUB_W_PCT = Math.max(0, Math.min(100, +opts?.subWidth || 0));
  const SUB_H_PCT = Math.max(0, Math.min(100, +opts?.subHeight || 0));
  const SUB_ENABLED = SUB_W_PCT > 0 && SUB_H_PCT > 0;
  const SUB_H_RATIO = SUB_H_PCT / 100;

  const cx = width / 2;
  const cy = height / 2;
  const effBumpH = Math.min(BUMP_H, Math.min(cx, cy) - 2);
  if (effBumpH < 2) return '';
  // 基礎楕円: 波の中心線。bumpH の半分だけ内側に置き、山は +amp、谷は -amp で対称に振らせる。
  const rxBase = cx - effBumpH / 2;
  const ryBase = cy - effBumpH / 2;
  if (rxBase <= 1 || ryBase <= 1) return '';
  const amp = effBumpH / 2;
  const rMin = Math.min(rxBase, ryBase);

  const hVal = Math.pow((rxBase - ryBase) / (rxBase + ryBase), 2);
  const perim = Math.PI * (rxBase + ryBase) * (1 + 3 * hVal / (10 + Math.sqrt(4 - 3 * hVal)));
  const numBumps = Math.max(6, Math.round(perim / BUMP_W));

  const periodAngle = (2 * Math.PI) / numBumps;
  const baseAngle = -Math.PI / 2 + OFFSET * periodAngle;
  // 山 1 つあたり 6 サンプル (山頂・谷の間も滑らかに描くため密に取る)
  const steps = numBumps * 6;

  // 副波: 小山設定があれば、主波 numBumps の 2 倍周波で副波を足し込み、輪郭を揺らす。
  const subFreq = SUB_ENABLED ? numBumps * 2 : 0;
  const subAmpRatio = SUB_ENABLED ? SUB_H_RATIO * 0.4 : 0;

  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = baseAngle + (i / steps) * 2 * Math.PI;
    const phase = t - baseAngle;
    let wave = Math.cos(numBumps * phase);
    if (subFreq > 0) wave += subAmpRatio * Math.cos(subFreq * phase);
    const rMul = 1 + (amp / rMin) * wave;
    pts.push({
      x: cx + rxBase * rMul * Math.cos(t),
      y: cy + ryBase * rMul * Math.sin(t),
    });
  }

  const fmt = (n) => n.toFixed(2);
  // 閉じた Catmull-Rom → Cubic Bezier (張力 k = 1/6)。全アンカーで接線が連続になるため山も谷も丸い。
  const n = pts.length;
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  d += ' Z';
  return `path('${d}')`;
}

// --- シェイプに応じたテキスト安全域のパディングを計算 ---
// 楕円・雲型・トゲ型 (直線/曲線) は矩形と違って内側にテキストを収める必要がある。
// 楕円に内接する矩形 (半径の 1/√2 倍) を基準に、bbox 端からの距離をパディングとして返す。
// returns { padX, padY } in px.
function _bdComputeShapePadding(shape, width, height, nodeStyle) {
  if (!(width > 0) || !(height > 0)) return null;
  const cx = width / 2;
  const cy = height / 2;
  let effBumpH = 0;
  if (shape === 'cloud' || shape === 'thorn' || shape === 'thorn-curve' || shape === 'fluffy') {
    const bh = Math.max(2, +(nodeStyle?.cloudBumpHeight) || 16);
    effBumpH = Math.min(bh, Math.min(cx, cy) - 2);
    if (effBumpH < 0) effBumpH = 0;
  }
  // 楕円半径 (cloud/thorn は山の分だけ内側、ellipse は bbox いっぱい)
  const rx = Math.max(1, cx - effBumpH);
  const ry = Math.max(1, cy - effBumpH);
  const SQRT2_INV = Math.SQRT1_2;
  // 内接矩形: 半径 * 1/√2。パディング = 中心との距離 - 内接矩形の半幅
  const padX = Math.max(8, Math.round(cx - rx * SQRT2_INV + 2));
  const padY = Math.max(6, Math.round(cy - ry * SQRT2_INV + 2));
  return { padX, padY };
}

// --- テキストに滑らかな丸フチを SVG filter で適用 ---
// feMorphology (dilate) は SVG 仕様上「矩形カーネル」で膨張するため、フチが太いと角が斜めに
// 切り落とされた (菱形 / 八角形っぽい) 見た目になる。代わりに feGaussianBlur + feComponentTransfer
// (discrete 閾値) の組合せで円形膨張を実現する。
// 流れ:
//   1. テキストアルファをガウシアンブラーで円形にぼかす (ブラーカーネルは等方ガウシアン = 円形)
//   2. feFuncA type="discrete" で閾値処理してぼかしを 2 値化 → 円形に膨張したマスクになる
//   3. マスクを指定色で塗りつぶし、元のテキストと合成
function _bdApplyTextOutline(txt, width, color, nodeKey) {
  if (!txt) return;
  const parent = txt.parentNode;
  if (parent) {
    const old = parent.querySelector(`:scope > svg.bd-txt-outline-svg[data-key="${nodeKey}"]`);
    if (old) old.remove();
  }
  const w = Math.max(0, +width || 0);
  if (w <= 0 || !color || !parent) {
    txt.style.filter = '';
    return;
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  const filterId = `bd-txt-outline-${nodeKey}`;
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'bd-txt-outline-svg');
  svg.setAttribute('data-key', String(nodeKey));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;';
  const defs = document.createElementNS(svgNS, 'defs');
  const filter = document.createElementNS(svgNS, 'filter');
  filter.setAttribute('id', filterId);
  // フチがぼかしで広がるため、filter region を広めに確保 (太いフチ対応)
  filter.setAttribute('x', '-50%');
  filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '200%');
  filter.setAttribute('height', '200%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  // 1. アルファを円形ガウシアンブラー
  //    stdDeviation を小さめに (w × 0.6) することで細いテキストでも中心アルファが残り、
  //    ブラー後に消えてしまうのを防ぐ。フチ厚さは下の閾値と組み合わせて w に近づくよう調整。
  const blur = document.createElementNS(svgNS, 'feGaussianBlur');
  blur.setAttribute('in', 'SourceAlpha');
  blur.setAttribute('stdDeviation', (w * 0.6).toFixed(3));
  blur.setAttribute('result', 'blurred');
  filter.appendChild(blur);
  // 2. 閾値処理で 2 値化。tableValues="0 1 1 1" → 4 セグメントで先頭のみ 0 → 閾値 0.25。
  //    閾値 0.5 (tableValues="0 1") だと細いテキストでブラー後に α が 0.5 未満になり、
  //    マスクが全て 0 になってフチが消失してしまう。閾値を 0.25 に下げて確実にマスクを残す。
  const threshold = document.createElementNS(svgNS, 'feComponentTransfer');
  threshold.setAttribute('in', 'blurred');
  threshold.setAttribute('result', 'mask');
  const funcA = document.createElementNS(svgNS, 'feFuncA');
  funcA.setAttribute('type', 'discrete');
  funcA.setAttribute('tableValues', '0 1 1 1');
  threshold.appendChild(funcA);
  filter.appendChild(threshold);
  // 3. マスクを指定色で塗りつぶし
  const flood = document.createElementNS(svgNS, 'feFlood');
  flood.setAttribute('flood-color', color);
  flood.setAttribute('result', 'color');
  filter.appendChild(flood);
  const comp = document.createElementNS(svgNS, 'feComposite');
  comp.setAttribute('in', 'color');
  comp.setAttribute('in2', 'mask');
  comp.setAttribute('operator', 'in');
  comp.setAttribute('result', 'outlined');
  filter.appendChild(comp);
  // 4. フチ (下) + 元のテキスト (上) を合成
  const merge = document.createElementNS(svgNS, 'feMerge');
  const mergeNode1 = document.createElementNS(svgNS, 'feMergeNode');
  mergeNode1.setAttribute('in', 'outlined');
  merge.appendChild(mergeNode1);
  const mergeNode2 = document.createElementNS(svgNS, 'feMergeNode');
  mergeNode2.setAttribute('in', 'SourceGraphic');
  merge.appendChild(mergeNode2);
  filter.appendChild(merge);
  defs.appendChild(filter);
  svg.appendChild(defs);
  parent.insertBefore(svg, txt);
  txt.style.filter = `url(#${filterId})`;
}

// --- 雲型のクリップパスと枠線を適用 ---
// カード本体の CSS 背景を透明化し、SVG オーバーレイで雲型の fill (背景色) と
// stroke (枠線) をまとめて描画する。stroke は stroke-width = 2 × borderWidth で
// 描画し、paint-order="stroke fill" で stroke の内側半分を fill が上書きする。
// 結果として stroke の外側半分 (= borderWidth px) だけが可視となり、
// 雲型の輪郭に沿った「外側の枠線」となる。
// clip-path はカード div にかけず、SVG の overflow: visible を利用して
// 外側 stroke がカードの矩形 bbox を超えて描画できるようにする。
function _bdApplyCloudShape(div, pathStr, borderColor, borderWidth, bgColor) {
  const svgNS = 'http://www.w3.org/2000/svg';
  let svg = div.querySelector(':scope > svg.bd-cloud-border-svg');
  const bw = Math.max(0, +borderWidth || 0);
  const bc = borderColor || '';
  const bg = bgColor || '';
  const w = div.offsetWidth || 1;
  const h = div.offsetHeight || 1;
  // clip-path / CSS border / bg は SVG に任せるので透明化・解除
  div.style.clipPath = '';
  div.style.background = 'transparent';
  div.style.borderWidth = '0';
  div.style.borderColor = 'transparent';
  div.style.borderStyle = 'none';
  // 外側 stroke が見切れないよう overflow を解除
  div.style.overflow = 'visible';
  if (bw > 0 && bc || bg) {
    if (!svg) {
      svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'bd-cloud-border-svg');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('overflow', 'visible');
      svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0;';
      const p = document.createElementNS(svgNS, 'path');
      // paint-order="stroke fill": stroke を先に描画 → fill が内側半分を上書き
      // → stroke の外側半分のみが残り、外側の枠線になる
      p.setAttribute('paint-order', 'stroke fill');
      svg.appendChild(p);
      div.insertBefore(svg, div.firstChild);
    }
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const p = svg.querySelector('path');
    const d = pathStr.replace(/^path\(['"]?/, '').replace(/['"]?\)$/, '');
    p.setAttribute('d', d);
    p.setAttribute('fill', bg || 'transparent');
    // 形状ごとの stroke 接続方式:
    //   - トゲ (直線/曲線): peak を鋭く尖らせたいので miter + 大きな miterlimit
    //     (鋭角で miterlimit を超えて自動 bevel にならないよう miterlimit=40)
    //     曲線トゲも peak がアンカーで接線不連続なので miter が効く。
    //   - その他 (雲など): 角を丸める round
    const shape = div.dataset.shape || '';
    if (shape === 'thorn' || shape === 'thorn-curve') {
      p.setAttribute('stroke-linejoin', 'miter');
      p.setAttribute('stroke-miterlimit', '40');
    } else {
      p.setAttribute('stroke-linejoin', 'round');
      p.removeAttribute('stroke-miterlimit');
    }
    if (bw > 0 && bc) {
      p.setAttribute('stroke', bc);
      // stroke-width = 2*bw → stroke の外側半分 (= bw px) のみが可視となる
      p.setAttribute('stroke-width', String(bw * 2));
    } else {
      p.setAttribute('stroke', 'none');
      p.removeAttribute('stroke-width');
    }
    // v0.5.244 で選択ハイライトを bbox 矩形 (`.bd-selection-rect`) に変更したため、
    // 旧 `.bd-selection-ring` への clipPath 同期は不要になった。
  } else if (svg) {
    svg.remove();
  }
}

// --- レンダリング ---
function bdGetRenderableNodesContainer() {
  const root = (typeof bdGetActiveBoardRoot === 'function') ? bdGetActiveBoardRoot() : null;
  const canvas = (typeof bdGetBoardElement === 'function')
    ? bdGetBoardElement('canvas', root)
    : document.getElementById('bd-canvas');
  const container = (typeof bdGetBoardElement === 'function')
    ? bdGetBoardElement('nodes', root)
    : document.getElementById('bd-nodes');
  if (!canvas || !container || !canvas.isConnected || !container.isConnected) return null;
  if (typeof getComputedStyle === 'function') {
    let el = canvas;
    let guard = 0;
    while (el && el !== document.body && guard < 8) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      el = el.parentElement;
      guard += 1;
    }
  }
  return container;
}

function bdRender() {
  const _bdRenderPerf = typeof bdPerfStart === 'function' ? bdPerfStart('bdRender') : 0;
  const container = bdGetRenderableNodesContainer();
  if (!container) {
    if (typeof bdPerfEnd === 'function') bdPerfEnd('bdRender', _bdRenderPerf, 'skip:no-active-board-dom');
    return false;
  }
  // 全再描画時はミニマップキャッシュも無効化 (ノード数/スタイルが変わっている可能性)
  if (typeof bdInvalidateMinimapCache === 'function') bdInvalidateMinimapCache();
  container.innerHTML = '';
  const boardRoot = container.closest?.('.gb-canvas-root') || null;
  const boardEl = (role, fallbackId) => boardRoot?.querySelector?.(`[data-bd-role="${role}"]`)
    || ((typeof bdGetBoardElement === 'function') ? bdGetBoardElement(role, boardRoot) : document.getElementById(fallbackId));
  // 影の有無でキャンバスにクラス付与 (ラインの SVG 影を CSS で制御するため)
  const canvasEl = boardEl('canvas', 'bd-canvas');
  if (canvasEl) canvasEl.classList.toggle('bd-shadow-on', !!bd._showShadow);
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyBoardThemeRuntime === 'function') {
    MeldexThemeManager.applyBoardThemeRuntime(bd, canvasEl, boardEl('world', 'bd-world'));
  }
  if (typeof bdApplyBoardFontVariables === 'function') bdApplyBoardFontVariables(canvasEl, boardEl('world', 'bd-world'));
  if (typeof bdScheduleFontStyleMapUpdate === 'function') bdScheduleFontStyleMapUpdate();
  // 折りたたまれた子孫のIDを収集
  const hiddenIds = new Set();
  bd.nodes.forEach(n => {
    if (n.collapsed) bdDescendants(n.id).forEach(id => hiddenIds.add(id));
  });
  const parentChildGroupColors = (bd.displayFilters?.highlightParentChildGroups === true && typeof _bdParentChildGroups === 'function')
    ? _bdParentChildGroups({
      hiddenIds,
      drillRoot: (typeof _bdDrillRoot !== 'undefined' && _bdDrillRoot) ? _bdDrillRoot : '',
    })
    : new Map();
  const renderContext = typeof bdCreateRenderContext === 'function'
    ? bdCreateRenderContext({ hiddenIds, parentChildGroupColors, fastCardRender: false })
    : { hiddenIds, parentChildGroupColors, fastCardRender: false };
  const renderFrag = document.createDocumentFragment();
  const renderedNodes = [];
  bd.nodes.forEach(n => {
    const div = typeof bdRenderNode === 'function'
      ? bdRenderNode(n, { renderContext })
      : null;
    if (!div) return;
    renderFrag.appendChild(div);
    renderedNodes.push({ n, div });
  });
  container.appendChild(renderFrag);
  renderedNodes.forEach(({ n, div }) => {
    if (typeof bdMeasureNodeElement === 'function') bdMeasureNodeElement(n, div);
    else { n._rw = div.offsetWidth; n._rh = div.offsetHeight; }
  });
  if (typeof bdShouldDeferBoardExtras === 'function' && bdShouldDeferBoardExtras()) {
    if (typeof bdMarkConnectionsDirtyByNodes === 'function') bdMarkConnectionsDirtyByNodes(renderedNodes.map(item => item.n.id), 'render-deferred');
    if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(renderedNodes.map(item => item.n.id));
    if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true, comments: renderedNodes.map(item => item.n.id) }, 'render-deferred');
    if (typeof bdScheduleBoardUpdates === 'function') bdScheduleBoardUpdates();
    else if (typeof bdRequestBoardExtras === 'function') bdRequestBoardExtras();
  } else {
    bdSyncResizeHandles();
    bdDrawConns();
    bdDrawFrames();
    if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi();
    if (typeof CommentBadges !== 'undefined' && bd.path) {
      try { CommentBadges.refreshBoard(bd.path, container); } catch {}
    }
  }
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdRender', _bdRenderPerf);
  return true;
}
