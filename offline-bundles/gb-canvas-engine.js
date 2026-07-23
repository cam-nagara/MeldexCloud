/* gb-canvas-engine.part00.js: board frontmatter compatibility helpers */

function bdYamlScalar(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value || value === 'null' || value === '~') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('{') && value.endsWith('}')) return bdYamlFlowMap(value);
  if (value.startsWith('[') && value.endsWith(']')) return bdYamlFlowList(value);
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    const inner = value.slice(1, -1);
    if (value.startsWith("'")) return inner.replace(/\\n/g, '\n').replace(/''/g, "'").replace(/\\'/g, "'");
    return inner
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\(["\\/bfnrt])/g, (_, ch) => ({
        '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t',
      }[ch] || ch));
  }
  return value;
}

const BD_MANAGED_FRONTMATTER_KEYS = new Set([
  'type', 'positions', 'ids', 'sizes', 'parents', 'structures', 'statuses', 'bgcolors',
  'balloons', 'containers', 'links', 'linkTypes', 'transforms', 'canvasBg', 'style',
  'theme', 'numbering', 'xmind', 'statusDefs', 'groups', 'cardStyles', 'lineStyles',
  'depthStyles', 'boardUi', 'connections', 'llmSemantics', 'tags',
]);

function bdPreserveUnknownFrontmatter(fm) {
  const blocks = [];
  let current = null;
  String(fm || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').forEach(line => {
    const key = bdFrontmatterTopLevelKey(line);
    if (key !== null) {
      if (current?.keep) blocks.push(current.lines.join('\n'));
      current = { keep: !BD_MANAGED_FRONTMATTER_KEYS.has(key), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else if (/^[^\s#]/.test(line)) {
      blocks.push(line);
    }
  });
  if (current?.keep) blocks.push(current.lines.join('\n'));
  return blocks.map(block => block.replace(/\n+$/, '')).filter(Boolean).join('\n');
}

function bdFrontmatterTopLevelKey(line) {
  const text = String(line || '').replace(/\s+$/, '');
  if (!text || /^[\s#%]/.test(text)) return null;
  if (text[0] === '?') return '';
  let quote = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (quote === '"' && char === '\\') index += 1;
      else if (char === quote) {
        if (quote === "'" && text[index + 1] === "'") index += 1;
        else quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char !== ':' || (text[index + 1] && !/\s/.test(text[index + 1]))) continue;
    const raw = text.slice(0, index).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try { return JSON.parse(raw); } catch { return raw.slice(1, -1); }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
    return raw;
  }
  return null;
}

function bdYamlSplitFlowItems(raw) {
  const parts = [];
  let buf = '';
  let quote = '';
  let depth = 0;
  const text = String(raw || '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      buf += ch;
      if ((quote === '"' || quote === "'") && ch === '\\' && i + 1 < text.length) {
        i += 1;
        buf += text[i];
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
          buf += text[i];
          continue;
        }
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function bdYamlSplitFlowPair(raw) {
  let quote = '';
  let depth = 0;
  const text = String(raw || '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if ((quote === '"' || quote === "'") && ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i += 1;
          continue;
        }
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === ':' && depth === 0) return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
  }
  return null;
}

function bdYamlFlowMap(raw) {
  const inner = String(raw || '').trim().slice(1, -1).trim();
  if (!inner) return {};
  const result = {};
  bdYamlSplitFlowItems(inner).forEach(item => {
    const pair = bdYamlSplitFlowPair(item);
    if (!pair || !pair[0]) return;
    const keyValue = bdYamlScalar(pair[0]);
    const key = String(keyValue == null ? '' : keyValue).trim();
    if (!key) return;
    result[key] = bdYamlScalar(pair[1]);
  });
  return result;
}

function bdYamlFlowList(raw) {
  const inner = String(raw || '').trim().slice(1, -1).trim();
  if (!inner) return [];
  return bdYamlSplitFlowItems(inner).map(item => bdYamlScalar(item));
}

function bdNormalizeConnectionControlPoints(raw) {
  if (Array.isArray(raw) && raw.length === 2
      && raw[0] && raw[1]
      && Number.isFinite(+raw[0].dx) && Number.isFinite(+raw[0].dy)
      && Number.isFinite(+raw[1].dx) && Number.isFinite(+raw[1].dy)) {
    return [
      { dx: +raw[0].dx, dy: +raw[0].dy },
      { dx: +raw[1].dx, dy: +raw[1].dy },
    ];
  }
  if (Array.isArray(raw) && raw.length === 4 && raw.every(value => Number.isFinite(+value))) {
    return [
      { dx: +raw[0], dy: +raw[1] },
      { dx: +raw[2], dy: +raw[3] },
    ];
  }
  return null;
}

function bdYamlTopLevelBlock(fm, key) {
  const lines = String(fm || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trim() === key + ':');
  if (start < 0) return [];
  const block = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[A-Za-z_][A-Za-z0-9_-]*:\s*/.test(line)) break;
    block.push(line);
  }
  return block;
}

function bdYamlNestedMap(fm, key) {
  const result = {};
  let current = '';
  for (const line of bdYamlTopLevelBlock(fm, key)) {
    let match = line.match(/^    ([^:\n]+):\s*(.*)$/);
    if (match && current && result[current] && typeof result[current] === 'object') {
      result[current][match[1].trim()] = bdYamlScalar(match[2]);
      continue;
    }
    match = line.match(/^  ([^:\n]+):\s*(.*)$/);
    if (match) {
      current = match[1].trim();
      const rest = match[2].trim();
      result[current] = rest ? bdYamlScalar(rest) : {};
      continue;
    }
  }
  return result;
}

function bdYamlListObjects(fm, key) {
  const list = [];
  let current = null;
  let nestedKey = '';
  const assignPair = (target, pairText) => {
    const match = String(pairText || '').match(/^([^:\n]+):\s*(.*)$/);
    if (!match || !target) return;
    const prop = match[1].trim();
    const rest = match[2].trim();
    target[prop] = rest ? bdYamlScalar(rest) : {};
    nestedKey = rest ? '' : prop;
  };
  for (const line of bdYamlTopLevelBlock(fm, key)) {
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item) {
      const rest = item[1].trim();
      const flowValue = bdYamlScalar(rest);
      if (flowValue && typeof flowValue === 'object' && !Array.isArray(flowValue)) {
        current = flowValue;
        nestedKey = '';
        list.push(current);
        continue;
      }
      if (Array.isArray(flowValue)) {
        current = null;
        nestedKey = '';
        continue;
      }
      current = {};
      nestedKey = '';
      list.push(current);
      assignPair(current, rest);
      continue;
    }
    if (!current) continue;
    let match = line.match(/^    ([^:\n]+):\s*(.*)$/);
    if (match && nestedKey) {
      if (!current[nestedKey] || typeof current[nestedKey] !== 'object') current[nestedKey] = {};
      current[nestedKey][match[1].trim()] = bdYamlScalar(match[2]);
      continue;
    }
    match = line.match(/^  ([^:\n]+):\s*(.*)$/);
    if (match) {
      assignPair(current, `${match[1]}: ${match[2]}`);
    }
  }
  return list;
}
/* gb-canvas-engine.part01.js */
/* gb-canvas-engine.js: Canvas Engine Core (v5.0 Phase C) */

/* ==============================
   ボードエンジン — 状態・解析・描画・選択・保存
   ============================== */

// --- ボード状態オブジェクト ---
const bd = {
  path:'', _loadedBoardPath:'', _preservedFrontmatter:'', nodes:[], connections:[], llmSemantics:null, selected:new Set(), editing:null,
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
  const ext = _bdPathExtension(path);
  return ext === '.md' || ext === '.mel-board';
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
  let preservedFrontmatter = '';
  let positions = {}, nodeIds = {}, connections = [], sizes = {}, parents = {}, structures = {}, statuses = {}, bgcolors = {}, balloons = {}, containers = {}, links = {}, linkTypes = {}, tags = {}, groups = [], statusDefs = null, transforms = {}, canvasBg = '', fileTheme = null, cardStyles = [], lineStyles = [], depthStyles = [], boardUi = {}, llmSemantics = null;
  if (fmMatch) {
    const fm = fmMatch[1];
    if (typeof bdPreserveUnknownFrontmatter === 'function') preservedFrontmatter = bdPreserveUnknownFrontmatter(fm);
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
    // 共通タグ（タグID配列。タグ実体は .meldex/global-tags.json 側で一元管理）
    if (typeof bdYamlNestedMap === 'function') {
      Object.entries(bdYamlNestedMap(fm, 'tags')).forEach(([id, value]) => {
        const list = Array.isArray(value) ? value : [];
        const normalized = list.map(item => String(item == null ? '' : item).trim()).filter(Boolean);
        if (normalized.length) tags[id] = normalized;
      });
    }
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
      const ispm = props.match(/imageSourcePath:\s*("(?:(?:[^"\\]|\\.)*)"|'(?:(?:[^'\\]|\\.)*)')/);
      if (ispm) {
        try { t.imageSourcePath = String(bdYamlScalar(ispm[1]) || '').replace(/\\/g, '/'); }
        catch { t.imageSourcePath = ispm[1].slice(1, -1).replace(/\\/g, '/'); }
      }
      if (/autoStyle:\s*true/.test(props)) t._autoStyle = true;
      if (/followChildren:\s*true/.test(props)) t._followChildren = true;
      if (/userBgColor:\s*true/.test(props)) t._userBgColor = true;
      if (/userFontSize:\s*true/.test(props)) t._userFontSize = true;
      if (/userFontBold:\s*true/.test(props)) t._userFontBold = true;
      if (/userW:\s*true/.test(props)) t._userW = true;
      if (/userCardStyle:\s*true/.test(props)) t._userCardStyle = true;
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
        if (Object.prototype.hasOwnProperty.call(t, 'userBgColor')) {
          t._userBgColor = !!t.userBgColor;
          delete t.userBgColor;
        }
        if (Object.prototype.hasOwnProperty.call(t, 'userFontSize')) {
          t._userFontSize = !!t.userFontSize;
          delete t.userFontSize;
        }
        if (Object.prototype.hasOwnProperty.call(t, 'userFontBold')) {
          t._userFontBold = !!t.userFontBold;
          delete t.userFontBold;
        }
        if (Object.prototype.hasOwnProperty.call(t, 'userW')) {
          t._userW = !!t.userW;
          delete t.userW;
        }
        if (Object.prototype.hasOwnProperty.call(t, 'userCardStyle')) {
          t._userCardStyle = !!t.userCardStyle;
          delete t.userCardStyle;
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
      const tfm = boardUiBlock[1].match(/tagFilter:\s*(\[[^\n]*\])/);
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
      if (tfm) {
        try {
          const parsedTagFilter = JSON.parse(tfm[1]);
          if (Array.isArray(parsedTagFilter)) {
            boardUi.tagFilter = parsedTagFilter.map(id => String(id == null ? '' : id)).filter(Boolean);
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
        if (n.imageSourcePath) node.imageSourcePath = String(n.imageSourcePath).replace(/\\/g, '/');
        if (n.status) node.status = n.status;
        if (Array.isArray(n.tags) && n.tags.length) {
          node.tags = n.tags.map(t => String(t == null ? '' : t).trim()).filter(Boolean);
        }
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
    if (tags[nid]) n.tags = tags[nid];
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
  return { nodes, connections: mappedConnections, groups, statusDefs, fileTheme, cardStyles, lineStyles, depthStyles, boardUi, llmSemantics: parsedLlmSemantics, preservedFrontmatter };
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
  // 共通タグ（タグID配列。カード削除・複製と一緒に自然に付随/消滅させるため、
  // カード本体へ直接埋め込む。タグ名・色・グループは .meldex/global-tags.json 側で一元管理）
  const hasTags = bd.nodes.some(n => Array.isArray(n.tags) && n.tags.length);
  if (hasTags) {
    fm += 'tags:\n';
    bd.nodes.forEach((n,i) => {
      if (Array.isArray(n.tags) && n.tags.length) fm += `  n${i}: ${JSON.stringify(n.tags)}\n`;
    });
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
  const cardOverrideMetaKeys = [
    'shape', 'fontSize', 'fontBold', 'fontItalic', 'textColor', 'textStrokeColor',
    'textStrokeWidth', 'borderColor', 'borderWidth', 'borderRadius', 'cardStyle',
    'cloudBumpWidth', 'cloudBumpHeight', 'cloudSideWidth', 'cloudOffset',
    'cloudSubBumpRatio', 'cloudSubWidthRatio', 'cloudSubHeightRatio',
  ];
  const hasXmindMeta = bd.nodes.some(n =>
    (n.note != null && n.note !== '')
    || hasOwn(n, 'checked')
    || hasOwn(n, 'progress')
    || (n.markers && Object.keys(n.markers).length)
    || cardOverrideMetaKeys.some(key => hasOwn(n, key))
    || !!n.imageSourcePath
    || hasOwn(n, '_autoStyle')
    || hasOwn(n, '_followChildren')
    || hasOwn(n, '_userBgColor')
    || hasOwn(n, '_userFontSize')
    || hasOwn(n, '_userFontBold')
    || hasOwn(n, '_userW')
    || hasOwn(n, '_userCardStyle')
    || n.collapsed
    || n.minimized);
  if (hasXmindMeta) {
    fm += 'xmind:\n';
    bd.nodes.forEach((n,i) => {
      const parts = [];
      if (n.note != null && n.note !== '') parts.push('note: ' + fmtJsonString(n.note));
      if (hasOwn(n, 'checked')) parts.push('checked: ' + (n.checked ? 'true' : 'false'));
      if (hasOwn(n, 'progress')) parts.push('progress: ' + (+n.progress || 0));
      if (n.markers && Object.keys(n.markers).length) parts.push('markers: ' + JSON.stringify(n.markers));
      if (hasOwn(n, 'shape')) parts.push('shape: ' + fmtJsonString(n.shape));
      if (hasOwn(n, 'fontSize')) parts.push('fontSize: ' + (+n.fontSize || 0));
      if (hasOwn(n, 'fontBold')) parts.push('fontBold: ' + (n.fontBold ? 'true' : 'false'));
      if (hasOwn(n, 'fontItalic')) parts.push('fontItalic: ' + (n.fontItalic ? 'true' : 'false'));
      if (hasOwn(n, 'textColor')) parts.push('textColor: ' + fmtJsonString(n.textColor));
      if (hasOwn(n, 'textStrokeColor')) parts.push('textStrokeColor: ' + fmtJsonString(n.textStrokeColor));
      if (hasOwn(n, 'textStrokeWidth')) parts.push('textStrokeWidth: ' + (+n.textStrokeWidth || 0));
      if (hasOwn(n, 'borderColor')) parts.push('borderColor: ' + fmtJsonString(n.borderColor));
      if (hasOwn(n, 'borderWidth')) parts.push('borderWidth: ' + (+n.borderWidth || 0));
      if (hasOwn(n, 'borderRadius')) parts.push('borderRadius: ' + (+n.borderRadius || 0));
      if (hasOwn(n, 'cardStyle')) parts.push('cardStyle: ' + fmtJsonString(n.cardStyle));
      if (hasOwn(n, 'cloudBumpWidth')) parts.push('cloudBumpWidth: ' + (+n.cloudBumpWidth || 0));
      if (hasOwn(n, 'cloudBumpHeight')) parts.push('cloudBumpHeight: ' + (+n.cloudBumpHeight || 0));
      if (hasOwn(n, 'cloudSideWidth')) parts.push('cloudSideWidth: ' + (+n.cloudSideWidth || 0));
      if (hasOwn(n, 'cloudOffset')) parts.push('cloudOffset: ' + (+n.cloudOffset || 0));
      if (hasOwn(n, 'cloudSubBumpRatio')) parts.push('cloudSubBumpRatio: ' + (+n.cloudSubBumpRatio || 0));
      if (hasOwn(n, 'cloudSubWidthRatio')) parts.push('cloudSubWidthRatio: ' + (+n.cloudSubWidthRatio || 0));
      if (hasOwn(n, 'cloudSubHeightRatio')) parts.push('cloudSubHeightRatio: ' + (+n.cloudSubHeightRatio || 0));
      if (hasOwn(n, 'imageSourcePath') && n.imageSourcePath) parts.push('imageSourcePath: ' + fmtJsonString(n.imageSourcePath));
      if (hasOwn(n, '_autoStyle')) parts.push('autoStyle: ' + (n._autoStyle ? 'true' : 'false'));
      if (hasOwn(n, '_followChildren')) parts.push('followChildren: ' + (n._followChildren ? 'true' : 'false'));
      if (hasOwn(n, '_userBgColor')) parts.push('userBgColor: ' + (n._userBgColor ? 'true' : 'false'));
      if (hasOwn(n, '_userFontSize')) parts.push('userFontSize: ' + (n._userFontSize ? 'true' : 'false'));
      if (hasOwn(n, '_userFontBold')) parts.push('userFontBold: ' + (n._userFontBold ? 'true' : 'false'));
      if (hasOwn(n, '_userW')) parts.push('userW: ' + (n._userW ? 'true' : 'false'));
      if (hasOwn(n, '_userCardStyle')) parts.push('userCardStyle: ' + (n._userCardStyle ? 'true' : 'false'));
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
    bd.statuses.forEach(s => {
      fm += '  - ' + JSON.stringify({
        name: s.name || '',
        color: s.color || '#888',
        opacity: Number.isFinite(+s.opacity) ? +s.opacity : 1,
        border: s.border || '',
      }) + '\n';
    });
  }
  // グループ
  if (bd.groups && bd.groups.length) {
    fm += 'groups:\n';
    bd.groups.forEach(g => {
      fm += `  - {name: ${fmtJsonString(g.name)}, nodes: [${g.nodeIds.map(id=>m[id]).filter(Boolean).join(', ')}]}\n`;
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
  const displayFiltersForSave = typeof bdNormalizeDisplayFilters === 'function'
    ? bdNormalizeDisplayFilters(bd.displayFilters)
    : (bd.displayFilters || {});
  const defaultDisplayFilters = typeof BD_DEFAULT_DISPLAY_FILTERS !== 'undefined' ? BD_DEFAULT_DISPLAY_FILTERS : {};
  const hasDisplayFilterOverrides = !!displayFiltersForSave && Object.keys(displayFiltersForSave)
    .some(key => displayFiltersForSave[key] !== defaultDisplayFilters[key]);
  const tagFilterForSave = Array.isArray(bd.tagFilter) ? bd.tagFilter.map(id => String(id)).filter(Boolean) : [];
  if (bd.activeCardStyle || bd.activeLineStyle || bd._stylePresetSeedVersion || bd.themeId || bd._showShadow || bd._textRotateOnLine || hasDisplayFilterOverrides || tagFilterForSave.length) {
    fm += 'boardUi:\n';
    if (bd.activeCardStyle) fm += `  activeCardStyle: ${bd.activeCardStyle}\n`;
    if (bd.activeLineStyle) fm += `  activeLineStyle: ${bd.activeLineStyle}\n`;
    if (bd._stylePresetSeedVersion) fm += `  stylePresetSeedVersion: ${bd._stylePresetSeedVersion}\n`;
    if (bd.themeId) fm += `  themeId: ${bd.themeId}\n`;
    if (bd._showShadow) fm += `  showShadow: true\n`;
    if (bd._textRotateOnLine) fm += `  textRotateOnLine: true\n`;
    if (hasDisplayFilterOverrides) fm += `  displayFilters: ${JSON.stringify(displayFiltersForSave)}\n`;
    if (tagFilterForSave.length) fm += `  tagFilter: ${JSON.stringify(tagFilterForSave)}\n`;
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
      if (c.id) endpointParts.push(`id: ${fmtJsonString(c.id)}`);
      if (c.from && m[c.from]) endpointParts.push(`from: ${m[c.from]}`);
      else if (bdNormalizeConnectionPoint(c.fromPoint)) endpointParts.push(`fromPoint: ${fmtPoint(c.fromPoint)}`);
      if (c.to && m[c.to]) endpointParts.push(`to: ${m[c.to]}`);
      else if (bdNormalizeConnectionPoint(c.toPoint)) endpointParts.push(`toPoint: ${fmtPoint(c.toPoint)}`);
      if (endpointParts.length < 2) return;
      let s = `  - {${endpointParts.join(', ')}`;
      // arrow は明示的に設定されているときだけ書き出す。空文字列は「矢印なし」として保存する。
      if (hasOwn(c, 'arrow')) {
        const arrow = c.arrow === true ? 'end' : ((c.arrow === false || c.arrow === '') ? 'none' : String(c.arrow || 'none'));
        s += `, arrow: ${arrow}`;
      }
      if (c.label) s += `, label: ${fmtJsonString(c.label)}`;
      if (hasOwn(c, 'style')) s += `, style: ${fmtJsonString(c.style)}`;
      if (hasOwn(c, 'color')) s += `, color: ${fmtJsonString(c.color)}`;
      // v0.5.320: pathType を 3 種 (curve/straight/orthogonal) に統合して書き出す。
      // curve は既定のため省略、straight/orthogonal のみ明示。
      if (hasOwn(c, 'pathType') || hasOwn(c, 'straight')) {
        const pathType = c.pathType === 'free-bezier' ? 'curve'
          : c.pathType === 'orthogonal-curve' ? 'orthogonal'
          : c.pathType === 'orthogonal' ? 'orthogonal'
          : (c.pathType === 'straight' || c.straight) ? 'straight' : 'curve';
        s += `, pathType: ${pathType}`;
      }
      if (c.hidden) s += ', hidden: true';
      if (hasOwn(c, 'width') && Number.isFinite(+c.width)) s += ', width: ' + (+c.width);
      if (c.styleRef) s += ', styleRef: ' + c.styleRef;
      if (c.semanticId) s += ', semanticId: ' + c.semanticId;
      if (hasOwn(c, 'labelTextColor')) s += `, labelTextColor: ${fmtJsonString(c.labelTextColor)}`;
      if (hasOwn(c, 'labelBgColor')) s += `, labelBgColor: ${fmtJsonString(c.labelBgColor)}`;
      if (hasOwn(c, 'labelBorderColor')) s += `, labelBorderColor: ${fmtJsonString(c.labelBorderColor)}`;
      if (hasOwn(c, 'labelBorderWidth') && Number.isFinite(+c.labelBorderWidth)) s += `, labelBorderWidth: ${+c.labelBorderWidth}`;
      if (hasOwn(c, 'fontBold')) s += `, fontBold: ${c.fontBold ? 'true' : 'false'}`;
      if (hasOwn(c, 'fontItalic')) s += `, fontItalic: ${c.fontItalic ? 'true' : 'false'}`;
      // テキスト表示・沿線回転・自動反転・縁取り太さ (default と異なる場合のみ書き出し)
      if (hasOwn(c, 'textVisible')) s += `, textVisible: ${c.textVisible ? 'true' : 'false'}`;
      if (hasOwn(c, 'textAlongPath')) s += `, textAlongPath: ${c.textAlongPath ? 'true' : 'false'}`;
      if (hasOwn(c, 'textAutoFlip')) s += `, textAutoFlip: ${c.textAutoFlip ? 'true' : 'false'}`;
      if (hasOwn(c, 'textShadowWidth') && Number.isFinite(+c.textShadowWidth)) {
        const textShadowWidth = +c.textShadowWidth;
        if (textShadowWidth !== 0 || hasOwn(c, 'textShadowWidth')) s += `, textShadowWidth: ${textShadowWidth}`;
      }
      if (hasOwn(c, 'textShadowColor')) s += `, textShadowColor: ${fmtJsonString(c.textShadowColor)}`;
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
  if (typeof bdSerializeLlmSemanticsFrontmatter === 'function') {
    fm += bdSerializeLlmSemanticsFrontmatter(bd.llmSemantics, { nodeIdMap: m });
  }
  if (bd._preservedFrontmatter) fm += bd._preservedFrontmatter.replace(/\n+$/, '') + '\n';
  fm += '---\n';
  const _escapeBoardHeadingText = (s) => String(s == null ? '' : s).replace(/^(\[img\])/, '\\$1');
  const _escapeBody = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map(line => {
    if (line === '') return '\\';
    if (/^\\+$/.test(line)) return '\\' + line;
    return line.replace(/^(\\*#\s)/, '\\$1');
  }).join('\n');
  let body = '';
  bd.nodes.forEach(n => {
    if (n.img) { body += '# [img]' + n.img + '\n'; if (n.text) body += _escapeBody(n.text) + '\n'; }
    else {
      const lines = n.text.split('\n');
      body += '# ' + _escapeBoardHeadingText(lines[0]) + '\n';
      if (lines.length > 1) body += _escapeBody(lines.slice(1).join('\n')) + '\n';
    }
    body += '\n';
  });
  const llmContext = typeof bdBuildLlmContextMarkdown === 'function' ? bdBuildLlmContextMarkdown(bd, { nodeIdMap: m }) : '';
  return fm + body + llmContext;
}

// --- リンクツールチップ ---
let _linkTooltipEl = null;
let _linkTooltipOwnerNode = null;
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
      if (_linkTooltipOwnerNode && document.documentElement.contains(_linkTooltipOwnerNode)) {
        _linkTooltipOwnerNode.removeAttribute('aria-describedby');
      }
      _linkTooltipOwnerNode = null;
      if (_linkTooltipEl) { _linkTooltipEl.remove(); _linkTooltipEl = null; }
      const tip = document.createElement('div');
      tip.className = 'bd-link-tooltip';
      tip.id = 'bd-link-tooltip-' + token;
      tip.setAttribute('role', 'tooltip');
      tip.setAttribute('aria-hidden', 'false');
      tip.textContent = text || '(\u7a7a)';
      const rect = nodeDiv.getBoundingClientRect();
      const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
      tip.style.left = (rect.left / z) + 'px';
      tip.style.top = (rect.bottom / z + 4) + 'px';
      tip.style.maxWidth = Math.max(180, Math.min(400, window.innerWidth / z - rect.left / z - 20)) + 'px';
      document.body.appendChild(tip);
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(tip);
      _linkTooltipEl = tip;
      _linkTooltipOwnerNode = nodeDiv;
      nodeDiv.setAttribute('aria-describedby', tip.id);
    } catch {}
  }, 500);
}

function _isLinkTooltipVisible() {
  return !!(_linkTooltipEl && document.documentElement.contains(_linkTooltipEl));
}

function _hideLinkTooltip(options = {}) {
  _linkTooltipToken++;
  clearTimeout(_linkTooltipTimer);
  if (_linkTooltipOwnerNode && document.documentElement.contains(_linkTooltipOwnerNode)) {
    _linkTooltipOwnerNode.removeAttribute('aria-describedby');
  }
  _linkTooltipOwnerNode = null;
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
  const SUB_W_RATIO = SUB_W_PCT / 100;
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
  const subWidthShape = SUB_ENABLED ? Math.max(0.35, 2 - SUB_W_RATIO * 1.65) : 1;

  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = baseAngle + (i / steps) * 2 * Math.PI;
    const phase = t - baseAngle;
    let wave = Math.cos(numBumps * phase);
    if (subFreq > 0) {
      const subWave = Math.cos(subFreq * phase);
      wave += subAmpRatio * Math.sign(subWave) * Math.pow(Math.abs(subWave), subWidthShape);
    }
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
  // 共通タグによる絞り込み: 非該当カードを減光する（データそのものは変更しない）
  if (Array.isArray(bd.tagFilter) && bd.tagFilter.length) {
    const activeTagFilterIds = new Set(bd.tagFilter.map(String));
    renderedNodes.forEach(({ n, div }) => {
      const nodeTagIds = Array.isArray(n.tags) ? n.tags.map(String) : [];
      const matchesFilter = nodeTagIds.some(id => activeTagFilterIds.has(id));
      div.classList.toggle('bd-tag-filter-dim', !matchesFilter);
    });
  }
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
  if (id && !add) {
    const n = bd.nodes.find(v => v.id === id);
    if (n?.link) {
      const label = n.text || n.link.split(/[/\\]/).pop() || n.link;
      const handledByMobileDrawer = window.MeldexCloudMobileSideDrawer?.openBoardLink?.(n.link, label, n.linkType);
      if (!handledByMobileDrawer) {
        if (typeof bdShowLinkedSelectionPreview === 'function') bdShowLinkedSelectionPreview(n.link, n.linkType);
        if (typeof bdSyncLinkedSelectionToPane === 'function') bdSyncLinkedSelectionToPane(n.link, label, n.linkType);
      }
    }
    if (!n?.link) {
      if (typeof bdCancelLinkedSelectionPreview === 'function') bdCancelLinkedSelectionPreview();
      if (typeof bdCancelLinkedSelectionSync === 'function') bdCancelLinkedSelectionSync();
    }
  } else if (!add) {
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
      caret.style.top = ((rect.top - elRect.top) / zoom) + 'px';
      caret.style.height = (rect.height || 18) + 'px';
    }
    caret.style.display = '';
  };
  el._bdCaretUpdate = updateCaret;
  document.addEventListener('selectionchange', updateCaret);
  setTimeout(updateCaret, 0);
}
function bdFinishEdit() {
  if (!bd.editing) return;
  const el = document.querySelector('.bd-node.bd-editing');
  let editedNode = null;
  let changed = false;
  if (el) {
    el.classList.remove('bd-editing');
    const txt = el.querySelector('.bd-text');
    txt.contentEditable = 'false';
    editedNode = bd.nodes.find(v=>v.id===bd.editing);
    if (editedNode) {
      const beforeText = editedNode.text || '';
      const nextText = txt.innerText.trim();
      changed = nextText !== beforeText;
      if (changed) {
        bdPushUndo();
        editedNode.text = nextText;
      }
      txt.innerHTML = applyAutoLinks(esc(editedNode.text).replace(/\n/g,'<br>'), bd.path);
    }
    // カスタムキャレットを削除 + selectionchange リスナー解除
    if (el._bdCaretUpdate) { document.removeEventListener('selectionchange', el._bdCaretUpdate); el._bdCaretUpdate = null; }
    const caret = el.querySelector(':scope > .bd-custom-caret');
    if (caret) caret.remove();
  }
  bd.editing = null;
  if (changed) bdDirty();
  // 編集解除後も `.bd-selection-rect` の `is-editing` を外すため再同期
  if (editedNode && typeof bdMeasureNodeElement === 'function') bdMeasureNodeElement(editedNode, el);
  if (changed && editedNode && typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(editedNode.id, 'finish-edit');
  if (editedNode && typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([editedNode.id], 'finish-edit');
  if (changed && editedNode && typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [editedNode.id] }, 'finish-edit');
  if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(editedNode?.id || '');
  else if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
  // テキスト編集でカード高さが変わっていた場合は、構造ツリーの全体整列をリクエストする。
  // 高さ差で周囲のカードと重なるケースを救済するため、autoAlign が on かつ構造ありで実行。
  if (changed && editedNode && typeof bd !== 'undefined' && bd.autoAlign !== false) {
    const _editedRoot = (typeof bdRoot === 'function') ? bdRoot(editedNode.id) : null;
    if (_editedRoot?.structure) {
      if (typeof bdRequestAutoLayout === 'function') bdRequestAutoLayout(_editedRoot.id);
      else if (typeof bdAutoLayout === 'function') bdAutoLayout(_editedRoot.id);
    }
  }
  document.getElementById('bd-canvas').focus();
}

// --- 削除 ---
function _bdSelectedConnectionIdsForDelete() {
  return typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
}

async function _bdConfirmDeleteSelection() {
  const nodeCount = bd.selected?.size || 0;
  const lineCount = _bdSelectedConnectionIdsForDelete().length;
  let msg;
  if (nodeCount && lineCount) msg = `${nodeCount}件のカードと${lineCount}件のラインを削除しますか？`;
  else if (nodeCount > 1) msg = `${nodeCount}件のカードを削除しますか？`;
  else if (nodeCount === 1) msg = 'このカードを削除しますか？';
  else if (lineCount > 1) msg = `${lineCount}件のラインを削除しますか？`;
  else msg = 'このラインを削除しますか？';
  try {
    if (typeof cfConfirm === 'function') return !!(await cfConfirm(msg));
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') return !!window.confirm(msg);
  } catch (_err) {
    return false;
  }
  return true;
}

async function bdDeleteSelected(options = {}) {
  if (!_bdSelectedConnectionIdsForDelete().length && bd.selected.size===0) return;
  if (options.confirm !== false && !(await _bdConfirmDeleteSelection())) return;
  const selectedConnIdsBeforeDelete = _bdSelectedConnectionIdsForDelete();
  if (!selectedConnIdsBeforeDelete.length && bd.selected.size===0) return;
  bdPushUndo();
  if (bd.selected.size === 0 && selectedConnIdsBeforeDelete.length) {
    selectedConnIdsBeforeDelete.forEach(connId => {
      if (typeof bdRemoveConnection === 'function') bdRemoveConnection(connId, { skipRender: true, skipDirty: true, skipSelection: true });
    });
    bdClearConnectionSelection();
    bdDrawConns();
    bdDirty();
    if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    return;
  }
  const deletedIds = [...bd.selected];
  const anchorId = (bd._activeNode && bd.selected.has(bd._activeNode)) ? bd._activeNode : deletedIds[0];
  const anchorNode = anchorId ? bd.nodes.find(n => n.id === anchorId) : null;
  const anchorEl = anchorId ? document.getElementById('bdn-' + anchorId) : null;
  const anchorPoint = anchorNode ? {
    x: anchorNode.x + ((anchorEl?.offsetWidth || anchorNode.w || 160) / 2),
    y: anchorNode.y + ((anchorEl?.offsetHeight || anchorNode.h || 36) / 2),
  } : null;
  // Phase 4: カード/ライン混在選択時、単独選択されたラインも削除する
  const selectedConnIds = new Set(selectedConnIdsBeforeDelete);
  const removedConnIds = bd.connections
    .filter(c => !c || bd.selected.has(c.from) || bd.selected.has(c.to) || selectedConnIds.has(c.id))
    .map(c => c?.id)
    .filter(Boolean);
  if (removedConnIds.length && typeof apiPost === 'function' && bd?.path) {
    removedConnIds.forEach(connId => {
      apiPost('/annotations/orphan-by-target', {
        target_kind: 'board_line',
        target_file: bd.path,
        item_id: connId,
        cascade_container: true,
      }).catch(() => {});
    });
  }
  bd.connections = bd.connections.filter(c =>
    !bd.selected.has(c.from) && !bd.selected.has(c.to) && !selectedConnIds.has(c.id));
  // 削除されるコンテナノードに contained されていた子を外に出す
  // (contained のままだとレンダ時に非表示になるため)
  const _deletedContainers = bd.nodes.filter(n => bd.selected.has(n.id) && n.container);
  if (_deletedContainers.length) {
    bd.nodes.forEach(ch => {
      if (!ch.contained) return;
      const parent = _deletedContainers.find(p => p.id === ch.parent);
      if (parent) {
        const pos = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(ch) : { x: ch.x + parent.x, y: ch.y + parent.y };
        ch.contained = false;
        ch.x = pos.x;
        ch.y = pos.y;
      }
    });
  }
  // 削除されるノードを親に持つ子のparent参照をクリア
  bd.nodes.forEach(n => { if (n.parent && bd.selected.has(n.parent)) n.parent = ''; });
  // グループから削除ノードを除去
  if (bd.groups) bd.groups.forEach(g => { if (g.nodeIds) g.nodeIds = g.nodeIds.filter(id => !bd.selected.has(id)); });
  // ドリルダウン中のルートが削除対象なら解除（そのまま描画すると全カードが消える）
  if (typeof _bdDrillRoot !== 'undefined' && _bdDrillRoot && bd.selected.has(_bdDrillRoot)) {
    _bdDrillRoot = null;
  }
  bd.nodes = bd.nodes.filter(n => !bd.selected.has(n.id));
  // 空になったグループを除去
  if (bd.groups) bd.groups = bd.groups.filter(g => g.nodeIds && g.nodeIds.length > 0);
  bd.selected.clear();
  const nextSelectedId = anchorPoint ? bdNearestNodeFromPoint(anchorPoint.x, anchorPoint.y, deletedIds) : null;
  bd._activeNode = nextSelectedId || null;
  if (nextSelectedId) bd.selected.add(nextSelectedId);
  bdClearConnectionSelection();
  bdRender();
  bdDirty();
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
}

// --- ステータス定義 ---
const BD_DEFAULT_STATUSES = [
  {name:'\u6848', color:'#f97316', opacity:1, border:''},
  {name:'\u63a1\u7528', color:'#3b82f6', opacity:1, border:''},
  {name:'\u30dc\u30c4', color:'#666', opacity:0.4, border:''},
  {name:'\u63b2\u8f09\u6e08\u307f', color:'#22c55e', opacity:1, border:'2px solid #22c55e'},
];
if (!bd.statuses) bd.statuses = [...BD_DEFAULT_STATUSES];
function bdStatusDef(name) { return bd.statuses.find(s=>s.name===name) || {name, color:'#888', opacity:1, border:''}; }
function bdStatusNames() { return ['', ...bd.statuses.map(s=>s.name)]; }

// --- グループ管理 ---
if (!bd.groups) bd.groups = [];
bd.statusFilter = ''; // 空=全表示
bd.tagFilter = []; // 共通タグID配列。空=全表示（絞り込みは減光のみで、非表示にはしない）

// --- 整列関数 ---
function bdAlign(type) {
  const ids = [...bd.selected]; if (ids.length<2) return;
  // contained カードは相対座標で inline フロー表示されるため整列対象から除外
  const elems = ids.map(id=>({id, n:bd.nodes.find(n=>n.id===id), el:document.getElementById('bdn-'+id)})).filter(v=>v.n&&v.el&&!v.n.contained);
  if (elems.length < 2) return;
  if ((type === 'distributeH' || type === 'distributeV') && elems.length < 3) return;
  bdPushUndo();
  if (type==='left') { const min=Math.min(...elems.map(v=>v.n.x)); elems.forEach(v=>{v.n.x=min;}); }
  else if (type==='right') { const max=Math.max(...elems.map(v=>v.n.x+v.el.offsetWidth)); elems.forEach(v=>{v.n.x=max-v.el.offsetWidth;}); }
  else if (type==='top') { const min=Math.min(...elems.map(v=>v.n.y)); elems.forEach(v=>{v.n.y=min;}); }
  else if (type==='bottom') { const max=Math.max(...elems.map(v=>v.n.y+v.el.offsetHeight)); elems.forEach(v=>{v.n.y=max-v.el.offsetHeight;}); }
  else if (type==='centerH') { const avg=elems.reduce((s,v)=>s+v.n.x+v.el.offsetWidth/2,0)/elems.length; elems.forEach(v=>{v.n.x=avg-v.el.offsetWidth/2;}); }
  else if (type==='centerV') { const avg=elems.reduce((s,v)=>s+v.n.y+v.el.offsetHeight/2,0)/elems.length; elems.forEach(v=>{v.n.y=avg-v.el.offsetHeight/2;}); }
  else if (type==='distributeH') {
    elems.sort((a,b)=>a.n.x-b.n.x);
    const min=elems[0].n.x, max=elems[elems.length-1].n.x+elems[elems.length-1].el.offsetWidth;
    const totalW=elems.reduce((s,v)=>s+v.el.offsetWidth,0);
    const gap=Math.max(0,(max-min-totalW)/(elems.length-1));
    let x=min;
    elems.forEach(v=>{v.n.x=x; x+=v.el.offsetWidth+gap;});
  }
  else if (type==='distributeV') {
    elems.sort((a,b)=>a.n.y-b.n.y);
    const min=elems[0].n.y, max=elems[elems.length-1].n.y+elems[elems.length-1].el.offsetHeight;
    const totalH=elems.reduce((s,v)=>s+v.el.offsetHeight,0);
    const gap=Math.max(0,(max-min-totalH)/(elems.length-1));
    let y=min;
    elems.forEach(v=>{v.n.y=y; y+=v.el.offsetHeight+gap;});
  }
  const movedIds = elems.map(v => v.id);
  movedIds.forEach(id => { if (typeof bdUpdateNodePosition === 'function') bdUpdateNodePosition(id); });
  if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(movedIds, 'align');
  else bdRender();
  bdDirty();
}

// --- Normalize（サイズ整列）---
function _bdGetNormalizeMetrics(node, el) {
  const imgEl = el?.querySelector('.bd-img');
  const imgW = imgEl?.clientWidth || 0;
  const imgH = imgEl?.clientHeight || 0;
  const naturalW = imgEl?.naturalWidth || node?._imgNaturalW || 0;
  const naturalH = imgEl?.naturalHeight || node?._imgNaturalH || 0;
  const baseImageWidth = imgW || naturalW;
  const baseImageHeight = imgH || naturalH;
  const ratio = baseImageWidth && baseImageHeight ? baseImageWidth / baseImageHeight : 1;
  return {
    node,
    el,
    isImage: !!(node?.img && baseImageWidth && baseImageHeight),
    width: node?.img && baseImageWidth ? baseImageWidth : (el?.offsetWidth || node?.w || 160),
    height: node?.img && baseImageHeight ? baseImageHeight : (el?.offsetHeight || node?.h || 36),
    ratio: ratio > 0 ? ratio : 1,
  };
}

function _bdApplyNormalizedDimensions(metric, type, targetValue, targetArea) {
  const node = metric?.node;
  if (!node) return;
  if (metric.isImage) {
    const ratio = metric.ratio || 1;
    let nextImageWidth = metric.width;
    if (type === 'width') nextImageWidth = targetValue;
    else if (type === 'height') nextImageWidth = targetValue * ratio;
    else if (type === 'size') nextImageWidth = ratio >= 1 ? targetValue : targetValue * ratio;
    else if (type === 'area') nextImageWidth = Math.sqrt(targetArea * ratio);
    node.w = Math.max(40, Math.round(nextImageWidth));
    node.h = 0;
    return;
  }
  if (type === 'height') node.h = Math.max(28, Math.round(targetValue));
  else if (type === 'width') node.w = Math.max(40, Math.round(targetValue));
  else if (type === 'size') { node.w = Math.max(40, Math.round(targetValue)); node.h = Math.max(28, Math.round(targetValue)); }
  else if (type === 'area') {
    const ratio = metric.width / (metric.height || 1);
    const newH = Math.sqrt(targetArea / ratio);
    node.w = Math.max(40, Math.round(newH * ratio));
    node.h = Math.max(28, Math.round(newH));
  }
}

function bdNormalize(type) {
  const ids = [...bd.selected]; if (ids.length < 2) return;
  bdPushUndo();
  const elems = ids
    .map(id => ({ id, n: bd.nodes.find(n => n.id === id), el: document.getElementById('bdn-' + id) }))
    .filter(v => v.n && v.el)
    .map(v => _bdGetNormalizeMetrics(v.n, v.el));
  if (type === 'height') {
    const maxH = Math.max(...elems.map(v => v.height));
    elems.forEach(v => { _bdApplyNormalizedDimensions(v, 'height', maxH); });
  } else if (type === 'width') {
    const maxW = Math.max(...elems.map(v => v.width));
    elems.forEach(v => { _bdApplyNormalizedDimensions(v, 'width', maxW); });
  } else if (type === 'size') {
    const maxS = Math.max(...elems.map(v => Math.max(v.width, v.height)));
    elems.forEach(v => { _bdApplyNormalizedDimensions(v, 'size', maxS); });
  } else if (type === 'area') {
    const areas = elems.map(v => v.width * v.height);
    const avgArea = areas.reduce((s, a) => s + a, 0) / areas.length;
    elems.forEach(v => { _bdApplyNormalizedDimensions(v, 'area', 0, avgArea); });
  }
  const normalizedIds = elems.map(v => v.node?.id).filter(Boolean);
  normalizedIds.forEach(id => {
    if (typeof bdReplaceNodeElement === 'function') bdReplaceNodeElement(id);
  });
  if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(normalizedIds, 'normalize');
  else bdRender();
  bdDirty();
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
}

// --- Arrange Optimal（自動パッキング）---
function _bdArrangeItemsForSelection() {
  const ids = bd.selected.size > 1 ? [...bd.selected] : bd.nodes.map(n => n.id);
  const items = ids.map(id => {
    const n = bd.nodes.find(v => v.id === id);
    const el = document.getElementById('bdn-' + id);
    // contained カードは相対座標のため自動パッキング対象から除外
    return n && el && !n.contained ? { n, w: el.offsetWidth, h: el.offsetHeight } : null;
  }).filter(Boolean);
  if (items.length < 2) return null;
  const minX = Math.min(...items.map(item => item.n.x));
  const minY = Math.min(...items.map(item => item.n.y));
  const maxX = Math.max(...items.map(item => item.n.x + item.w));
  const maxY = Math.max(...items.map(item => item.n.y + item.h));
  return {
    items,
    minX,
    minY,
    spanW: Math.max(1, maxX - minX),
    spanH: Math.max(1, maxY - minY),
  };
}

function bdArrangeByWidth(padding, targetWidth) {
  const layout = _bdArrangeItemsForSelection();
  if (!layout) return;
  bdPushUndo();
  const gap = padding || 8;
  const canvasEl = document.getElementById('bd-canvas');
  const maxItemWidth = Math.max(...layout.items.map(item => item.w));
  const rowWidth = Math.max(
    maxItemWidth,
    Number.isFinite(+targetWidth) && +targetWidth > 0
      ? +targetWidth
      : (canvasEl ? canvasEl.offsetWidth / Math.max(0.1, bd.zoom || 1) : layout.spanW),
  );
  let x = 0;
  let y = 0;
  let rowH = 0;
  [...layout.items].sort((a, b) => b.h - a.h).forEach(item => {
    if (x + item.w > rowWidth && x > 0) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    item.n.x = layout.minX + x;
    item.n.y = layout.minY + y;
    x += item.w + gap;
    rowH = Math.max(rowH, item.h);
  });
  const movedIds = layout.items.map(item => item.n.id);
  movedIds.forEach(id => { if (typeof bdUpdateNodePosition === 'function') bdUpdateNodePosition(id); });
  if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(movedIds, 'arrange-width');
  else bdRender();
  bdDirty();
}

function bdArrangeByHeight(padding, targetHeight) {
  const layout = _bdArrangeItemsForSelection();
  if (!layout) return;
  bdPushUndo();
  const gap = padding || 8;
  const canvasEl = document.getElementById('bd-canvas');
  const maxItemHeight = Math.max(...layout.items.map(item => item.h));
  const columnHeight = Math.max(
    maxItemHeight,
    Number.isFinite(+targetHeight) && +targetHeight > 0
      ? +targetHeight
      : (canvasEl ? canvasEl.offsetHeight / Math.max(0.1, bd.zoom || 1) : layout.spanH),
  );
  let x = 0;
  let y = 0;
  let columnW = 0;
  [...layout.items].sort((a, b) => b.w - a.w).forEach(item => {
    if (y + item.h > columnHeight && y > 0) {
      y = 0;
      x += columnW + gap;
      columnW = 0;
    }
    item.n.x = layout.minX + x;
    item.n.y = layout.minY + y;
    y += item.h + gap;
    columnW = Math.max(columnW, item.w);
  });
  const movedIds = layout.items.map(item => item.n.id);
  movedIds.forEach(id => { if (typeof bdUpdateNodePosition === 'function') bdUpdateNodePosition(id); });
  if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(movedIds, 'arrange-height');
  else bdRender();
  bdDirty();
}

function bdArrangeOptimal(padding) {
  bdArrangeByWidth(padding);
}

// --- ノード追加 ---
// テキスト未指定時は階層別スタイル管理ダイアログで設定された深さ 0 の defaultText を使用する。
// カード追加直後の自動インライン入力は行わない（ユーザー要望: ダブルクリックで編集に入る方式）。
function bdAddAt(x, y, text, opts) {
  const _bdAddAtPerf = typeof bdPerfStart === 'function' ? bdPerfStart('bdAddAt') : 0;
  if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
  try {
    bdPushUndo();
    let resolvedText = text;
    if (resolvedText == null || resolvedText === '') {
      const depthStyles = typeof bdEnsureDepthStyles === 'function' ? bdEnsureDepthStyles() : (bd.depthStyles || []);
      resolvedText = depthStyles[0]?.defaultText || 'カード';
    }
    const n = typeof bdCreateNodeWithStyle === 'function'
      ? bdCreateNodeWithStyle(resolvedText, x, y, opts)
      : bdNode(resolvedText, x, y, 160, 0, opts);
    bd.nodes.push(n);
    if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(n)) {
      if (typeof bdRequestFullRender === 'function') bdRequestFullRender('add-at-fallback');
      else bdRender();
    }
    if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(n.id, 'add-at');
    if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [n.id] }, 'add-at');
    bdSelect(n.id);
    bdDirty();
    return n;
  } finally {
    if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
    if (typeof bdPerfEnd === 'function') bdPerfEnd('bdAddAt', _bdAddAtPerf);
  }
}

// --- ズーム/パン ---
function bdZoom(delta) {
  bd.zoom = Math.max(0.1, Math.min(5, bd.zoom+delta));
  bdTransform();
}
function bdTransform() {
  const w = typeof bdGetBoardElement === 'function'
    ? bdGetBoardElement('world')
    : document.getElementById('bd-world');
  const c = typeof bdGetBoardElement === 'function'
    ? bdGetBoardElement('canvas')
    : document.getElementById('bd-canvas');
  const zoom = Math.max(0.1, bd.zoom || 1);
  if (c) c.style.setProperty('--bd-current-zoom', String(zoom));
  if (w) w.style.setProperty('--bd-current-zoom', String(zoom));
  if (w) {
    if (bd.rotation && c) {
      // 回転あり: ビューポート中心を軸に回転（四隅の空白が出ない）
      const cx = c.clientWidth / 2, cy = c.clientHeight / 2;
      w.style.transform = `translate(${cx}px,${cy}px) rotate(${bd.rotation}deg) translate(${-cx}px,${-cy}px) translate(${bd.panX}px,${bd.panY}px) scale(${zoom})`;
    } else {
      w.style.transform = `translate(${bd.panX}px,${bd.panY}px) scale(${zoom})`;
    }
  }
  // スライダー・ラベル同期
  const zl = document.getElementById('bd-zoom-label');
  if (zl) zl.textContent = Math.round(bd.zoom * 100) + '%';
  const zs = document.getElementById('bd-zoom-slider');
  if (zs) {
    zs.value = Math.round(bd.zoom * 100);
    globalThis.GBUI?.refreshRangeFill?.(zs);
  }
  const rl = document.getElementById('bd-rot-label');
  if (rl) rl.textContent = Math.round(bd.rotation) + '°';
  const rs = document.getElementById('bd-rot-slider');
  if (rs) {
    rs.value = Math.round(bd.rotation);
    globalThis.GBUI?.refreshRangeFill?.(rs);
  }
  const annHost = (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas') : c) || c;
  if (annHost?._annBridge && typeof annHost._annBridge.updateSize === 'function') {
    annHost._annBridge.updateSize();
  }
  // パン/ズーム/回転に応じてビューワーパネルのミニマップ表示領域枠をリアルタイム同期する
  if (typeof bdUpdateMinimap === 'function') bdUpdateMinimap();
}
// スクリーン座標→ワールド座標変換（回転対応）
function bdScreenToWorld(sx, sy) {
  const canvas = typeof bdGetBoardElement === 'function'
    ? bdGetBoardElement('canvas')
    : document.getElementById('bd-canvas');
  if (!canvas) return { x: sx, y: sy };
  const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
  // スクリーン→キャンバスローカル座標
  const local = bdClientToCanvasLocal(sx, sy, canvas);
  let lx = local.x, ly = local.y;
  if (bd.rotation) {
    // ビューポート中心基準で逆回転
    lx -= cx; ly -= cy;
    const rad = -bd.rotation * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rx = lx * cos - ly * sin, ry = lx * sin + ly * cos;
    lx = rx + cx; ly = ry + cy;
  }
  return { x: (lx - bd.panX) / bd.zoom, y: (ly - bd.panY) / bd.zoom };
}
function bdResetRotation() { bd.rotation = 0; bdTransform(); showStatus('回転をリセット'); }
function bdFitAll(_retryCount) {
  if (!bd.nodes.length) { bd.zoom=1; bd.panX=bd.panY=0; bd.rotation=0; bdTransform(); return; }
  const c=document.getElementById('bd-canvas');
  if (!c) return; // ボード DOM 未生成時 (非同期タブ切替中など) はスキップ
  // キャンバスがまだレイアウト前 (clientWidth/Height が 0) の場合、
  // ズーム計算が 0 になり Math.max(0.1, 0) で 10% に張り付く不具合になる。
  // 次フレームで再試行する。最大 30 フレーム (約 500ms) で諦める。
  if (c.clientWidth <= 0 || c.clientHeight <= 0) {
    const next = (_retryCount || 0) + 1;
    if (next <= 30) requestAnimationFrame(() => bdFitAll(next));
    return;
  }
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  // contained カードは相対座標のため fit 計算から除外 (親の範囲は container の絶対座標で含まれる)
  bd.nodes.forEach(n => { if (n.contained) return; x0=Math.min(x0,n.x); y0=Math.min(y0,n.y); const el=document.getElementById('bdn-'+n.id); x1=Math.max(x1,n.x+(el?el.offsetWidth:160)); y1=Math.max(y1,n.y+(el?el.offsetHeight:40)); });
  if (!isFinite(x0) || !isFinite(y0)) { bd.zoom=1; bd.panX=bd.panY=0; bd.rotation=0; bdTransform(); return; }
  const cw=c.clientWidth, ch=c.clientHeight;
  const w=x1-x0+80, h=y1-y0+80;
  let fitW = w, fitH = h;
  if (bd.rotation) {
    const rad = Math.abs(bd.rotation) * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    fitW = w * cos + h * sin;
    fitH = w * sin + h * cos;
  }
  bd.zoom = Math.min(cw/fitW, ch/fitH, 1.5); bd.zoom = Math.max(0.1, bd.zoom);
  bd.panX = (cw-w*bd.zoom)/2 - x0*bd.zoom + 40*bd.zoom;
  bd.panY = (ch-h*bd.zoom)/2 - y0*bd.zoom + 40*bd.zoom;
  bdTransform();
}

// --- 保存 ---
function bdDirty() {
  const _bdDirtyPerf = typeof bdPerfStart === 'function' ? bdPerfStart('bdDirty') : 0;
  bd.dirty=true; markAutoVersionDirty(); clearTimeout(window._bdTimer); window._bdTimer=setTimeout(bdSave,500);
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdDirty', _bdDirtyPerf);
}
async function bdSave() {
  const savePath = bd.path;
  if (!savePath) return true;
  if (typeof _bdCanSaveCurrentBoardPath === 'function' && !_bdCanSaveCurrentBoardPath(savePath)) {
    showStatus('ボード保存を中止しました: ボードとして開いたMarkdownファイルではありません', true);
    return false;
  }
  const markdown = bdToMd();
  const prevIds = bd._lastSavedNodeIds || new Set();
  const currIds = new Set((bd.nodes || []).map(n => n.id));
  try {
    const saveResult = await apiPut('/file?path='+encodeURIComponent(savePath),{content:markdown, skip_if_missing:true});
    if (saveResult?.skipped || saveResult?.missing) {
      showStatus('ボード保存を中止しました: ファイルが見つかりません', true);
      return false;
    }
    if (bd.path !== savePath) return true;
    const unchanged = bdToMd() === markdown;
    if (unchanged) {
      bd.dirty=false;
    }
    bd._lastSavedNodeIds = currIds;
    showStatus('ボードを保存しました', false, { passiveSave: true });
    // カード削除検知 → 該当コメントを孤児化 (annotation_unification_plan.md §5.3)
    const removed = [...prevIds].filter(id => !currIds.has(id));
    if (removed.length > 0 && typeof apiPost === 'function') {
      const path = savePath;
      removed.forEach(id => {
        apiPost('/annotations/orphan-by-target', {
          target_kind: 'board_card',
          target_file: path,
          item_id: id,
          cascade_container: true,
        }).catch(() => {});
      });
    }
    return true;
  } catch(e) {
    const detail = String(e?.message || e || '不明なエラー');
    if (e?.code === 'etag_conflict' || /etag[_ -]?conflict|外部.*更新|競合/i.test(detail)) {
      showStatus('ボードは上書きされていません。別の端末で更新されています。最新のボードを開き直してから編集内容を反映してください', true);
    } else {
      showStatus('ボードを保存できません: ' + detail, true);
    }
    return false;
  }
}

// --- コピー&ペースト ---
let _bdClipboard = [];
let _bdClipboardConnections = [];
function bdCopy() {
  if (bd.selected.size===0) return;
  _bdClipboard = [...bd.selected].map(id => {
    const n = bd.nodes.find(v=>v.id===id); if (!n) return null;
    const copy = {...n}; // シャローコピー
    if (n.contained) {
      const pos = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(n) : null;
      if (pos) {
        copy._bdCopyAbsX = pos.x;
        copy._bdCopyAbsY = pos.y;
      }
    }
    return copy;
  }).filter(Boolean);
  const selIds = new Set(_bdClipboard.map(n => n.id));
  _bdClipboardConnections = bd.connections
    .filter(c => selIds.has(c.from) && selIds.has(c.to))
    .map(c => ({ ...c }));
  showStatus(_bdClipboard.length + '\u500b\u306e\u30ce\u30fc\u30c9\u3092\u30b3\u30d4\u30fc\u3057\u307e\u3057\u305f');
}
function bdCloneNodesWithOffset(sourceNodes, offset) {
  const idMap = {};
  const sourceIdSet = new Set((sourceNodes || []).map(n => n?.id).filter(Boolean));
  const newNodes = (sourceNodes || []).map(n => {
    const {id: _id, x: _x, y: _y, _bdCopyAbsX, _bdCopyAbsY, ...rest} = n;
    const parentCopied = !!(n.contained && n.parent && sourceIdSet.has(n.parent));
    const copyAbsX = Number.isFinite(+_bdCopyAbsX) ? +_bdCopyAbsX : null;
    const copyAbsY = Number.isFinite(+_bdCopyAbsY) ? +_bdCopyAbsY : null;
    const nextX = parentCopied ? n.x : ((n.contained && copyAbsX != null) ? copyAbsX + offset : n.x + offset);
    const nextY = parentCopied ? n.y : ((n.contained && copyAbsY != null) ? copyAbsY + offset : n.y + offset);
    const nn = bdNode(n.text, nextX, nextY, n.w, n.h, {...rest, markers: n.markers ? {...n.markers} : undefined, tags: Array.isArray(n.tags) ? [...n.tags] : undefined});
    idMap[n.id] = nn.id;
    return nn;
  });
  // parent参照を新IDにリマップ（コピー元に含まれない親は解除）
  newNodes.forEach((nn, idx) => {
    const source = sourceNodes[idx];
    const mappedParent = source?.parent ? (idMap[source.parent] || '') : '';
    const keepContained = !!(source?.contained && mappedParent);
    // 親が未コピーで contained を解除する場合、相対座標 → 絶対座標に変換
    if (source?.contained && !mappedParent) {
      const pos = Number.isFinite(+source._bdCopyAbsX) && Number.isFinite(+source._bdCopyAbsY)
        ? { x: +source._bdCopyAbsX, y: +source._bdCopyAbsY }
        : (typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(source) : null);
      if (pos) { nn.x = pos.x + offset; nn.y = pos.y + offset; }
    }
    nn.parent = mappedParent;
    nn.contained = keepContained;
  });
  return { newNodes, idMap };
}

function bdPaste() {
  if (!_bdClipboard.length) return;
  bdPushUndo();
  const offset = 30;
  const { newNodes, idMap } = bdCloneNodesWithOffset(_bdClipboard, offset);
  bd.nodes.push(...newNodes);
/* gb-canvas-engine.part04.js */
  // 接続線もコピー（選択ノード間のもの）
  (_bdClipboardConnections || []).forEach(c => {
    if (idMap[c.from] && idMap[c.to]) bd.connections.push({
      id: bdId(),
      from:idMap[c.from],
      to:idMap[c.to],
      arrow:c.arrow,
      label:c.label,
      style:c.style,
      semanticId:c.semanticId,
      styleRef:c.styleRef,
      width:c.width,
      straight:c.straight,
      pathType:c.pathType,
      hidden:c.hidden,
      color:c.color,
      labelTextColor:c.labelTextColor,
      labelBgColor:c.labelBgColor,
      labelBorderColor:c.labelBorderColor,
      labelBorderWidth:c.labelBorderWidth,
      fontBold:c.fontBold,
      fontItalic:c.fontItalic,
      fontFamily:c.fontFamily,
      textVisible:c.textVisible,
      textAlongPath:c.textAlongPath,
      textAutoFlip:c.textAutoFlip,
      textShadowWidth:c.textShadowWidth,
      textShadowColor:c.textShadowColor,
      fromAnchor:c.fromAnchor,
      toAnchor:c.toAnchor,
      branchRatio:c.branchRatio,
      cornerRadius:c.cornerRadius,
      controlPoints: Array.isArray(c.controlPoints) && c.controlPoints.length === 2
        ? [{ dx: c.controlPoints[0].dx, dy: c.controlPoints[0].dy },
           { dx: c.controlPoints[1].dx, dy: c.controlPoints[1].dy }]
        : undefined,
    });
  });
  // 新ノードを選択
  bd.selected = new Set(newNodes.map(n=>n.id));
  bdClearConnectionSelection();
  bdRender(); bdDirty();
  showStatus(newNodes.length + '\u500b\u306e\u30ce\u30fc\u30c9\u3092\u30da\u30fc\u30b9\u30c8\u3057\u307e\u3057\u305f');
}

// --- アンドゥ/リドゥ ---
// v0.6.198 フェーズ3-3: 本体アプリ（gb-history.js を読み込む環境）では bdPushUndo/bdUndo/
// bdRedo/bdClearUndoStacks は 'board:<パス>' スコープの共通履歴（historyPush/historyUndo/
// historyRedo）へ委譲し、履歴パネルとも連動する。単独起動アプリ（board-standalone.html 等、
// gb-history.js を読み込まない）では historyPush 等が未定義のため、従来どおり
// _bdUndoStack/_bdRedoStack の自己完結スタックにフォールバックする（挙動を変えない後方互換）。
const _bdUndoStack = [], _bdRedoStack = [], _BD_UNDO_MAX = 30;
function _bdHasCommonHistory() {
  return typeof historyPush === 'function' && typeof historyUndo === 'function' && typeof historyRedo === 'function';
}
function _bdHistoryScope(path) {
  const p = path != null ? path : (typeof bd !== 'undefined' ? bd.path : '');
  return 'board:' + String(p || '').replace(/\\/g, '/');
}
function _bdSnapshot() {
  return JSON.stringify({
    nodes: bd.nodes,
    connections: bd.connections,
    groups: bd.groups,
    cardStyles: bd.cardStyles,
    lineStyles: bd.lineStyles,
    depthStyles: bd.depthStyles,
    activeCardStyle: bd.activeCardStyle,
    activeLineStyle: bd.activeLineStyle,
    stylePresetSeedVersion: bd._stylePresetSeedVersion || 0,
    themeId: bd.themeId || '',
    statuses: bd.statuses,
    displayFilters: bd.displayFilters,
    tagFilter: bd.tagFilter,
    globalStyleDefaults: typeof bdCaptureGlobalStyleDefaults === 'function' ? bdCaptureGlobalStyleDefaults() : null,
    _numbering: bd._numbering || false,
    _bgColor: bd._bgColor || '',
    _fileStyle: bd._fileStyle || null,
    llmSemantics: bd.llmSemantics || (typeof bdDefaultLlmSemantics === 'function' ? bdDefaultLlmSemantics() : null),
    _showShadow: !!bd._showShadow,
    _textRotateOnLine: !!bd._textRotateOnLine,
    gapSiblings: bd.gapSiblings ?? null,
    gapLevels: bd.gapLevels ?? null,
    autoAlign: bd.autoAlign !== false,
  });
}
function bdPushUndo(label) {
  const _bdUndoPerf = typeof bdPerfStart === 'function' ? bdPerfStart('bdPushUndo') : 0;
  if (typeof bdClearUndoCoalesce === 'function') bdClearUndoCoalesce();
  if (_bdHasCommonHistory()) {
    const snap = _bdSnapshot();
    historyPush(label || 'ボード編集', () => {
      _bdApplySnapshot(JSON.parse(snap));
      if (typeof bdRender === 'function') bdRender();
      if (typeof bdDirty === 'function') bdDirty();
    }, null, _bdHistoryScope());
  } else {
    _bdUndoStack.push(_bdSnapshot()); if(_bdUndoStack.length>_BD_UNDO_MAX) _bdUndoStack.shift(); _bdRedoStack.length=0;
  }
  if (typeof bdPerfEnd === 'function') bdPerfEnd('bdPushUndo', _bdUndoPerf);
  if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
}
function bdClearUndoStacks(path) {
  if (_bdHasCommonHistory() && typeof _historyStacks !== 'undefined') {
    const stack = _historyStacks[_bdHistoryScope(path)];
    if (stack) { stack.undo.length = 0; stack.redo.length = 0; }
  }
  _bdUndoStack.length = 0; _bdRedoStack.length = 0;
  if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
}
function _bdApplySnapshot(s) {
  bd.nodes = s.nodes; bd.connections = s.connections; bd.groups = s.groups || [];
  bd.cardStyles = s.cardStyles || bd.cardStyles;
  bd.lineStyles = s.lineStyles || bd.lineStyles;
  bd.depthStyles = s.depthStyles || bd.depthStyles;
  bd.activeCardStyle = s.activeCardStyle || bd.activeCardStyle;
  bd.activeLineStyle = s.activeLineStyle || bd.activeLineStyle;
  bd._stylePresetSeedVersion = s.stylePresetSeedVersion || 0;
  bd.themeId = s.themeId || '';
  if (s.statuses !== undefined) bd.statuses = s.statuses;
  if (s.displayFilters !== undefined) bd.displayFilters = s.displayFilters || {};
  if (s.tagFilter !== undefined) bd.tagFilter = Array.isArray(s.tagFilter) ? s.tagFilter : [];
  if (s.globalStyleDefaults !== undefined && typeof bdRestoreGlobalStyleDefaults === 'function') {
    bdRestoreGlobalStyleDefaults(s.globalStyleDefaults);
  }
  if (s._numbering !== undefined) bd._numbering = !!s._numbering;
  if (s.llmSemantics !== undefined) bd.llmSemantics = s.llmSemantics || (typeof bdDefaultLlmSemantics === 'function' ? bdDefaultLlmSemantics() : null);
  if (s._showShadow !== undefined) bd._showShadow = !!s._showShadow;
  if (s._textRotateOnLine !== undefined) bd._textRotateOnLine = !!s._textRotateOnLine;
  if (s.gapSiblings !== undefined) bd.gapSiblings = s.gapSiblings;
  if (s.gapLevels !== undefined) bd.gapLevels = s.gapLevels;
  if (s.autoAlign !== undefined) bd.autoAlign = !!s.autoAlign;
  if (s._bgColor !== undefined) {
    bd._bgColor = s._bgColor || '';
  }
  // 後方互換: 旧スナップショットの _fileTheme も読み取る
  if (s._fileStyle !== undefined) bd._fileStyle = s._fileStyle || null;
  else if (s._fileTheme !== undefined) bd._fileStyle = s._fileTheme || null;
  if (typeof bdLoadBoardBackgroundFromStyle === 'function') bdLoadBoardBackgroundFromStyle();
  const canvasEl = document.getElementById('bd-canvas');
  if (typeof bdApplyBoardFileStyleAndTheme === 'function') {
    bdApplyBoardFileStyleAndTheme(canvasEl, document.getElementById('bd-world'));
  } else if (canvasEl) {
    if (typeof bdApplyCanvasBackground === 'function') bdApplyCanvasBackground(canvasEl);
    else canvasEl.style.background = bd._bgColor || '';
  }
  bd.selected = new Set(); bd.editing = null; bdClearConnectionSelection();
  bdEnsureConnectionRuntime(bd.connections);
}
function bdUndo() {
  if (_bdHasCommonHistory()) { historyUndo(_bdHistoryScope()); return; }
  if (!_bdUndoStack.length) return;
  _bdRedoStack.push(_bdSnapshot());
  _bdApplySnapshot(JSON.parse(_bdUndoStack.pop()));
  bdRender(); bdDirty();
  showStatus('\u5143\u306b\u623b\u3057\u307e\u3057\u305f');
  if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
}
function bdRedo() {
  if (_bdHasCommonHistory()) { historyRedo(_bdHistoryScope()); return; }
  if (!_bdRedoStack.length) return;
  _bdUndoStack.push(_bdSnapshot());
  _bdApplySnapshot(JSON.parse(_bdRedoStack.pop()));
  bdRender(); bdDirty();
  showStatus('\u3084\u308a\u76f4\u3057\u307e\u3057\u305f');
  if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates();
}

function bdIsCurrentBoardOpenRequest(path) {
  if (typeof state === 'undefined') return true;
  if (state.view && state.view !== 'board') return false;
  const currentPath = typeof _bdNormalizePathForGuard === 'function'
    ? _bdNormalizePathForGuard(state.currentBoardPath || '')
    : String(state.currentBoardPath || '').replace(/\\/g, '/');
  const requestedPath = typeof _bdNormalizePathForGuard === 'function'
    ? _bdNormalizePathForGuard(path || '')
    : String(path || '').replace(/\\/g, '/');
  return !currentPath || !requestedPath || currentPath === requestedPath;
}

const BD_BOARD_OPEN_IO_TIMEOUT_MS = 30000;
let _bdPendingOpenRollback = null;

function _bdTimeoutError(label, timeoutMs) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return new Error(label + 'がタイムアウトしました（' + seconds + '秒）');
}

function _bdAwaitWithTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(_bdTimeoutError(label, timeoutMs)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// --- ボード開閉 ---
async function bdOpenBoard(label, path, opts) {
  const openOpts = opts || {};
  const titleEl = document.getElementById('bd-title');
  const prevTitle = titleEl ? titleEl.textContent : '';
  const nextPath = path || '';
  const openSeq = (bd._openSeq || 0) + 1;
  bd._openSeq = openSeq;
  const isCurrentOpenRequest = () => bd._openSeq === openSeq && bdIsCurrentBoardOpenRequest(nextPath);
  clearTimeout(window._bdTimer);
  if (bd.dirty && bd.path && !openOpts.skipDirtySave) {
    let saved = false;
    try {
      saved = await _bdAwaitWithTimeout(bdSave(), BD_BOARD_OPEN_IO_TIMEOUT_MS, '切替前のボード保存');
    } catch (err) {
      if (!isCurrentOpenRequest()) return false;
      if (titleEl) titleEl.textContent = prevTitle;
      showStatus('ボード切替前の保存に失敗しました: ' + (err.message || err), true);
      return false;
    }
    if (!saved) {
      if (!isCurrentOpenRequest()) return false;
      if (titleEl) titleEl.textContent = prevTitle;
      return false;
    }
  }
  if (!isCurrentOpenRequest()) return false;
  const rollback = _bdPendingOpenRollback || {
    title: prevTitle,
    path: bd.path || '',
    loadedBoardPath: bd._loadedBoardPath || '',
    dump: typeof bdDumpState === 'function' ? bdDumpState() : null,
  };
  _bdPendingOpenRollback = rollback;
  if (titleEl) titleEl.textContent = label || '';
  const prevPath = rollback.path || '';
  const prevLoadedBoardPath = rollback.loadedBoardPath || '';
  const prevDump = rollback.dump || null;
  bdClearUndoStacks();
  bd.selected = new Set();
  if (typeof bdCancelLinkedSelectionPreview === 'function') bdCancelLinkedSelectionPreview();
  if (typeof bdCancelLinkedSelectionSync === 'function') bdCancelLinkedSelectionSync();
  bdClearConnectionSelection();
  bd.editing = null;
  bd.connecting = null;
  bd.tool = 'select';
  bd.displayFilters = {};
  bd._stylePresetSeedVersion = 0;
  bd.themeId = '';
  bd._showShadow = false;
  bd._textRotateOnLine = false;
  bd._numbering = false;
  bd.statuses = (typeof BD_DEFAULT_STATUSES !== 'undefined') ? [...BD_DEFAULT_STATUSES] : [];
  bd.statusFilter = '';
  bd.tagFilter = [];
  bd.zoom = 1;
  bd.panX = bd.panY = 0;
  bd.rotation = 0;
  // 前のボードの機能状態をリセット
  bd._bgColor = '';
  bd._bgImage = '';
  bd._bgImageFit = 'contain';
  bd._bgImageScale = 1;
  const _canvasEl = document.getElementById('bd-canvas');
  if (_canvasEl) {
    _canvasEl.style.background = '';
    _canvasEl.style.backgroundImage = '';
  }
  if (typeof _bdDrillRoot !== 'undefined') _bdDrillRoot = null;
  if (typeof _bdFocusSaved !== 'undefined') _bdFocusSaved = null;
  if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.applyBoardThemeRuntime === 'function') {
    MeldexThemeManager.applyBoardThemeRuntime(bd);
  }
  if (typeof _bdSlideshow !== 'undefined' && _bdSlideshow) { clearTimeout(_bdSlideshow.timer); _bdSlideshow = null; }
  bdTransform();
  try {
    const data = await _bdAwaitWithTimeout(
      apiFetch('/file?path=' + encodeURIComponent(nextPath)),
      BD_BOARD_OPEN_IO_TIMEOUT_MS,
      'ボードファイル読み込み'
    );
    if (bd._openSeq !== openSeq || !bdIsCurrentBoardOpenRequest(nextPath)) return false;
    const raw = data.content || '';
    if (typeof showLoadingBeforeHeavyWork === 'function') {
      await showLoadingBeforeHeavyWork(raw, '大きいボードを描画中...');
      if (bd._openSeq !== openSeq || !bdIsCurrentBoardOpenRequest(nextPath)) return false;
    }
    if (typeof _bdIsBoardWritablePath === 'function' && !_bdIsBoardWritablePath(nextPath)) {
      throw new Error('ボードとして開けない拡張子です: ' + nextPath);
    }
    if (typeof _bdRawLooksLikeBoardFile === 'function' && !_bdRawLooksLikeBoardFile(raw)) {
      throw new Error('ボード形式ファイルではありません');
    }
    const parsed = bdParseMd(raw);
    bd.path = nextPath;
    bd._loadedBoardPath = nextPath;
    // フェーズ3-3: 読み込み直後のパスで取り消し履歴スコープを確定させる
    // （読み込み前に呼んだ bdClearUndoStacks() は「切替前のボード」のスコープを掃除するだけ
    //  なので、ここで新パスのスコープも明示的に掃除し、履歴パネルのアクティブスコープを合わせる）。
    if (typeof bdClearUndoStacks === 'function') bdClearUndoStacks(nextPath);
    if (typeof historySetScope === 'function') {
      historySetScope(typeof _bdHistoryScope === 'function' ? _bdHistoryScope(nextPath) : ('board:' + String(nextPath || '').replace(/\\/g, '/')));
    }
    bd._preservedFrontmatter = parsed.preservedFrontmatter || '';
    window.MeldexFileLockBadge?.apply?.(titleEl, nextPath);
    bd.nodes = parsed.nodes || [];
    if (typeof bdNormalizeParentGraph === 'function') bdNormalizeParentGraph(bd.nodes);
    // 新規作成ボードの初期ルートカードには階層別スタイル (_autoStyle) とロジック図を既定で有効化する。
    // 「新規作成直後 = ノード 1 枚 / 親子関係・構造・コネクション・グループ無し / 追加メタ無し」
    // の形状にマッチする場合のみ true を立てる。親子・構造・スタイル等の付加情報が
    // すでに保存されているものには適用しない。
    if (
      bd.nodes.length === 1
      && (parsed.connections?.length || 0) === 0
      && (parsed.groups?.length || 0) === 0
    ) {
      const only = bd.nodes[0];
      const hasExplicitSize = (Number.isFinite(+only.w) && +only.w !== 160)
        || (Number.isFinite(+only.h) && +only.h !== 0);
      const hasBodyText = String(only.text || '').includes('\n');
      const hasAnyMeta = only.parent || only.structure || only.status || only.bgColor
        || only.container || only.contained || only.balloon || only.link || only.linkType || only.img
        || only.cardStyle || only.shape || only.note || only.progress || only.markers
        || only.fontSize || only.fontBold || only.fontItalic || only.textColor
        || only.textStrokeColor || only.borderColor || only.borderWidth || only.borderRadius
        || only.collapsed || only.minimized || only.flipH || only.flipV
        || only.rotate || only.opacity || only.locked
        || only._autoStyle || only._followChildren || hasExplicitSize || hasBodyText;
      if (!hasAnyMeta) {
        only._autoStyle = true;
        only.structure = 'logic';
      }
    }
    bd._lastSavedNodeIds = new Set(bd.nodes.map(n => n.id));
    bd.connections = parsed.connections || [];
    bd.llmSemantics = parsed.llmSemantics || (typeof bdDefaultLlmSemantics === 'function' ? bdDefaultLlmSemantics() : null);
    bdEnsureConnectionRuntime(bd.connections);
    bd.groups = parsed.groups || [];
    bd.statuses = parsed.statusDefs || ((typeof BD_DEFAULT_STATUSES !== 'undefined') ? [...BD_DEFAULT_STATUSES] : []);
    bd.cardStyles = parsed.cardStyles || [];
    bd.lineStyles = parsed.lineStyles || [];
    bd.depthStyles = parsed.depthStyles || [];
    // 新しいボードを開くたびにグローバルデフォルト適用フラグをリセット
    bd._globalStyleDefaultsApplied = false;
    bd._globalDepthStylesApplied = false;
    bd.activeCardStyle = parsed.boardUi?.activeCardStyle || '';
    bd.activeLineStyle = parsed.boardUi?.activeLineStyle || '';
    bd._stylePresetSeedVersion = parsed.boardUi?.stylePresetSeedVersion || 0;
    bd.themeId = parsed.boardUi?.themeId || '';
    bd.displayFilters = parsed.boardUi?.displayFilters || {};
    bd.tagFilter = Array.isArray(parsed.boardUi?.tagFilter) ? parsed.boardUi.tagFilter : [];
    bd._showShadow = !!parsed.boardUi?.showShadow;
    bd._textRotateOnLine = !!parsed.boardUi?.textRotateOnLine;
    if (typeof MeldexThemeMigration !== 'undefined' && typeof MeldexThemeMigration.migrateBoardState === 'function') {
      MeldexThemeMigration.migrateBoardState(bd, parsed.boardUi || {});
    }
    if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
    // テーマ適用: クリア → ファイルテーマ
    bd._fileStyle = parsed.fileTheme || null;
    if (typeof clearFileStyleForPanel === 'function') clearFileStyleForPanel('bd-canvas');
    else if (typeof clearFileStyle === 'function') clearFileStyle();
    if (parsed.fileTheme && typeof applyFileStyleToPanel === 'function') applyFileStyleToPanel(parsed.fileTheme, 'bd-canvas');
    if (typeof bdLoadBoardBackgroundFromStyle === 'function') bdLoadBoardBackgroundFromStyle();
    // スタイルタブ由来の --bd-shadow (新仕様) があれば bd._showShadow と同期。
    // ファイル側が未設定ならテーマ :root の値をフォールバック参照。
    if (bd._fileStyle && bd._fileStyle['--bd-shadow'] !== undefined) {
      const v = bd._fileStyle['--bd-shadow'];
      bd._showShadow = v !== '' && v !== '0';
    } else if (typeof getCssVar === 'function') {
      const t = (getCssVar('--bd-shadow') || '').trim();
      if (t !== '') bd._showShadow = t !== '0';
    }
    // 2026-04-18: レイアウト隙間 / 自動整列 設定の復元。未設定は null (= デフォルト)。
    // bd.gapSiblings/gapLevels が null のとき bdLayoutGaps() がテーマ値をフォールバック参照する。
    bd.gapSiblings = null; bd.gapLevels = null; bd.autoAlign = true;
    if (bd._fileStyle) {
      const gs = parseFloat(bd._fileStyle['--bd-gap-siblings']);
      if (Number.isFinite(gs) && gs >= 0) bd.gapSiblings = gs;
      const gl = parseFloat(bd._fileStyle['--bd-gap-levels']);
      if (Number.isFinite(gl) && gl >= 0) bd.gapLevels = gl;
      if (bd._fileStyle['--bd-auto-align'] !== undefined) {
        bd.autoAlign = bd._fileStyle['--bd-auto-align'] !== '0';
      } else if (typeof getCssVar === 'function') {
        const t = (getCssVar('--bd-auto-align') || '').trim();
        if (t !== '') bd.autoAlign = t !== '0';
      }
    } else if (typeof getCssVar === 'function') {
      const t = (getCssVar('--bd-auto-align') || '').trim();
      if (t !== '') bd.autoAlign = t !== '0';
    }
    bd._id = Math.max(0, ...bd.nodes.map(n => parseInt(n.id?.replace(/\D/g, '')) || 0));
    bd.dirty = false;
    if (typeof bdApplyBoardFileStyleAndTheme === 'function') {
      bdApplyBoardFileStyleAndTheme();
    } else if (typeof bdApplyCanvasBackground === 'function') {
      bdApplyCanvasBackground();
    } else if (bd._bgColor) {
      const canvasEl = document.getElementById('bd-canvas');
      if (canvasEl) canvasEl.style.background = bd._bgColor;
    }
    // _autoStyle が有効なルートカードには、レンダリング前に階層別スタイルを適用しておく。
    // (これをしないと、ボード読込直後は _autoStyle = true だがスタイルが未反映で、
    //  一度チェックを外して再度 ON にするまで反映されない)
    if (typeof bdApplyAutoStyle === 'function') {
      bd.nodes.forEach(n => { if (n._autoStyle) bdApplyAutoStyle(n.id); });
    }
    bdRender();
    bdDrawConns();
    bdDrawFrames();
    if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    // ノードが多い場合のみフィット（少ない場合はズーム100%で表示）
    if (bd.nodes.length > 5) bdFitAll();
    else bdTransform();
    showStatus('\u30ad\u30e3\u30f3\u30d0\u30b9: ' + label);
    _bdPendingOpenRollback = null;
    return true;
  } catch (err) {
    if (bd._openSeq !== openSeq || !bdIsCurrentBoardOpenRequest(nextPath)) return false;
    bd.path = prevPath;
    bd._loadedBoardPath = prevLoadedBoardPath;
    if (titleEl) titleEl.textContent = rollback.title || '';
    window.MeldexFileLockBadge?.apply?.(titleEl, prevPath);
    if (prevDump && typeof bdLoadState === 'function') {
      bdLoadState(prevDump);
      if (typeof bdRender === 'function') bdRender();
      if (typeof bdDrawConns === 'function') bdDrawConns();
      if (typeof bdDrawFrames === 'function') bdDrawFrames();
      if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    } else {
      const nodesEl = document.getElementById('bd-nodes');
      if (nodesEl) {
        nodesEl.replaceChildren();
        const msg = document.createElement('div');
        msg.style.cssText = 'padding:20px;color:var(--fg2);';
        msg.textContent = '読み込めませんでした: ' + (err.message || err);
        nodesEl.appendChild(msg);
      }
    }
    showStatus('ボード読み込みエラー: ' + (err.message || err), true);
    _bdPendingOpenRollback = null;
    return false;
  }
}

async function bdCloseBoard() {
  // 未保存があれば保存
  if (bd.dirty && bd.path) {
    await bdSave();
  }
}

// --- 複数ボードタブ対応: bd 全体の dump / restore ---
// 複数 CanvasComponent (multi:true) が1個のグローバル bd を共有しているため、
// タブ切替時にアクティブな state をコンポーネント側に dump / restore して独立性を保つ。
function bdDumpState() {
  const keys = Object.keys(bd);
  const snap = {};
  for (const k of keys) {
    const v = bd[k];
    if (v instanceof Set) snap[k] = [...v];
    else snap[k] = v;
  }
  // フェーズ3-3: 共通履歴が有効な環境（本体アプリ）では取り消し履歴は 'board:<パス>' スコープの
  // 共通履歴（グローバルな _historyStacks）に保持され、タブごとにダンプ/復元する必要がない
  // （スコープ文字列がボードごとに独立しているため、タブ切替時も自然に分離される）。
  // 単独起動アプリ（共通履歴なし）のみ、従来どおり自己完結スタックをダンプする。
  const hasCommonHistory = typeof historyPush === 'function' && typeof historyUndo === 'function' && typeof historyRedo === 'function';
  return {
    bd: snap,
    undoStack: hasCommonHistory ? [] : _bdUndoStack.slice(),
    redoStack: hasCommonHistory ? [] : _bdRedoStack.slice(),
    // gb-canvas-features.js のモジュールローカル state も dump
    drillRoot: (typeof _bdDrillRoot !== 'undefined') ? _bdDrillRoot : null,
    // v0.5.285: フォーカスモード廃止につき focusMode は捨てる。focusSaved はセッション内の復元用に残す。
    focusSaved: (typeof _bdFocusSaved !== 'undefined') ? _bdFocusSaved : null,
  };
}

function bdLoadState(dump) {
  if (!dump || !dump.bd) return;
  // 既存プロパティを落とし、dump で作られた set のみにする
  for (const k of Object.keys(bd)) delete bd[k];
  for (const [k, v] of Object.entries(dump.bd)) {
    if (k === 'selected' || k === 'selectedConnIds') {
      bd[k] = new Set(Array.isArray(v) ? v : []);
    } else {
      bd[k] = v;
    }
  }
  // bd の Set プロパティが dump 時に欠けていた場合のフォールバック
  if (!(bd.selected instanceof Set)) bd.selected = new Set();
  if (!(bd.selectedConnIds instanceof Set)) bd.selectedConnIds = new Set();
  if (typeof bdNormalizeParentGraph === 'function') bdNormalizeParentGraph(bd.nodes || []);
  bdEnsureConnectionRuntime(bd.connections || []);
  // undo/redo スタックを復元（共通履歴が有効な環境ではスコープ別に独立して保持されるため、
  // ここでは単独起動アプリ向けの自己完結スタックのみ復元する。dump.undoStack/redoStack は
  // 共通履歴が有効な環境では常に空配列なので forEach は何もしない）。
  _bdUndoStack.length = 0;
  (dump.undoStack || []).forEach(s => _bdUndoStack.push(s));
  _bdRedoStack.length = 0;
  (dump.redoStack || []).forEach(s => _bdRedoStack.push(s));
  // 共通履歴が有効な環境では、復元したボードのパスに合わせてアクティブスコープも切り替える
  // （タブ切替時に historySetScope が呼ばれず履歴パネルが直前のタブのスコープのままになるのを防ぐ）。
  if (typeof historySetScope === 'function' && bd.path) {
    historySetScope(typeof _bdHistoryScope === 'function' ? _bdHistoryScope(bd.path) : ('board:' + String(bd.path).replace(/\\/g, '/')));
  }
  // features.js 側の変数を復元
  if (typeof _bdDrillRoot !== 'undefined') _bdDrillRoot = dump.drillRoot || null;
  if (typeof _bdFocusSaved !== 'undefined') _bdFocusSaved = dump.focusSaved || null;
  if (!bd.themeId && dump.grayscale) bd.themeId = 'builtin-dark';
  if (typeof MeldexThemeMigration !== 'undefined' && typeof MeldexThemeMigration.migrateBoardState === 'function') {
    MeldexThemeMigration.migrateBoardState(bd, dump.bd?.boardUi || {});
  }
  // slideshow は復元しない（タイマー実体の管理が複雑なため、タブ切替で必ず停止する）
  if (typeof _bdSlideshow !== 'undefined' && _bdSlideshow) { clearTimeout(_bdSlideshow.timer); _bdSlideshow = null; }
  // DOM 反映
  const canvasEl = document.getElementById('bd-canvas');
  if (typeof bdLoadBoardBackgroundFromStyle === 'function') bdLoadBoardBackgroundFromStyle();
  if (typeof bdApplyBoardFileStyleAndTheme === 'function') {
    bdApplyBoardFileStyleAndTheme(canvasEl, document.getElementById('bd-world'));
  } else if (canvasEl) {
    if (typeof bdApplyCanvasBackground === 'function') bdApplyCanvasBackground(canvasEl);
    else canvasEl.style.background = bd._bgColor || '';
  }
  const titleEl = document.getElementById('bd-title');
  if (titleEl && bd.path) titleEl.textContent = bd.path.split('/').pop() || '';
  bdTransform();
  bdRender();
  bdDrawConns();
  if (typeof bdDrawFrames === 'function') bdDrawFrames();
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
}

// ==============================
// ミニマップ（ビューワーペイン連携）
// ==============================
/* ミニマップ描画は gb-canvas-minimap.js に分離 */
