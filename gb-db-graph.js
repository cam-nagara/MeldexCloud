/* ==============================
   gb-db-graph.js: リレーショングラフビュー
   エントリ間のリレーションをSVGノードグラフで可視化
   ============================== */

/* --- グラフ設定 --- */

function getGraphConfig(dbPath) {
  return getCurrentDbViewTypeSpecific(dbPath, 'graph') || {
    colorProperty: '',
    showExternalNodes: true,
    layout: 'force',
    showLabels: true,
    showEdgeLabels: false,
  };
}

function setGraphConfig(dbPath, config, options = {}) {
  const label = options.historyLabel || options.label || '';
  setCurrentDbViewTypeSpecific(dbPath, 'graph', config || {}, {
    historyLabel: label,
    detail: options.detail || '',
    skipHistory: options.skipHistory === true || !label,
  });
}

/* --- データ準備 --- */

function _graphNodeKey(dbPath, entityName) {
  return `${dbPath || ''}::${entityName || ''}`;
}

function _graphEntityPathForDb(pivotData, dbPath, entityName) {
  if (!dbPath || !entityName) return '';
  return pivotData?.new_format ? `${dbPath}/${entityName}.md` : `${dbPath}/${entityName}`;
}

function _graphRelationRawValues(entityData, propName, ptc) {
  const rawVals = entityData?.[propName] || [];
  const vals = typeof filterValues === 'function' ? filterValues(rawVals) : rawVals;
  const rawNames = [];
  vals.forEach(v => {
    if (!v?.value) return;
    if (ptc.type === 'multi-relation') {
      String(v.value).split(',').forEach(n => { const t = n.trim(); if (t) rawNames.push(t); });
    } else {
      const t = String(v.value).trim();
      if (t) rawNames.push(t);
    }
  });
  return rawNames;
}

async function _graphResolveRelationTargets(rawValues, sourceDbPath, ptc, entityIdToName) {
  const targetDbPath = (ptc.relationDb === '' || ptc.relationDb == null) ? sourceDbPath : ptc.relationDb;
  if (!targetDbPath) return [];
  if (targetDbPath === sourceDbPath) {
    return rawValues.map(raw => ({
      name: entityIdToName.get(raw) || raw,
      dbPath: targetDbPath,
      pivotData: null,
      known: true,
    }));
  }
  const map = typeof _getRelationMap === 'function' ? await _getRelationMap(targetDbPath) : null;
  return rawValues.map(raw => {
    const name = map?.idToName?.[raw] || raw;
    return {
      name,
      dbPath: targetDbPath,
      pivotData: { new_format: !!map?.new_format },
      known: !!map?.entities?.[name],
    };
  });
}

/**
 * pivotDataからグラフノード・エッジを構築する
 */
async function buildGraphData(pivotData, dbPath, graphConfig) {
  const entities = pivotData.entities || {};
  const entityNames = Object.keys(entities);
  const propTypes = getPropertyTypes(dbPath);
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();
  const entityIdToName = new Map();
  entityNames.forEach(name => {
    const id = entities[name]?._id;
    if (id) entityIdToName.set(String(id), name);
  });

  // ノード作成
  entityNames.forEach(name => {
    const node = {
      id: _graphNodeKey(dbPath, name), x: 0, y: 0, vx: 0, vy: 0,
      color: _getNodeColor(name, entities[name], graphConfig.colorProperty),
      label: name, entityName: name, dbPath, isExternal: false,
      entityPath: _graphEntityPathForDb(pivotData, dbPath, name),
    };
    nodes.push(node);
    nodeMap.set(node.id, node);
  });

  // エッジ作成（リレーション型プロパティから）
  const externalNodes = new Map();
  for (const propName of Object.keys(propTypes)) {
    const ptc = propTypes[propName];
    if (!ptc || (ptc.type !== 'relation' && ptc.type !== 'multi-relation')) continue;

    for (const en of entityNames) {
      const rawValues = _graphRelationRawValues(entities[en], propName, ptc);
      const targets = await _graphResolveRelationTargets(rawValues, dbPath, ptc, entityIdToName);
      targets.forEach(target => {
        const targetName = target.name;
        const resolvedTargetDbPath = target.dbPath || dbPath || '';
        const targetKey = _graphNodeKey(resolvedTargetDbPath, targetName);
        edges.push({
          source: _graphNodeKey(dbPath, en),
          target: targetKey,
          label: propName,
          color: '#dcdcaa',
        });
        // 外部ノード（現在のDBに存在しない場合）
        if (!nodeMap.has(targetKey) && graphConfig.showExternalNodes) {
          if (!externalNodes.has(targetKey)) {
            const extNode = {
              id: targetKey, x: 0, y: 0, vx: 0, vy: 0,
              color: '#3e3e3e', label: targetName,
              entityName: targetName,
              dbPath: resolvedTargetDbPath,
              isExternal: true,
              entityPath: target.known ? _graphEntityPathForDb(target.pivotData, resolvedTargetDbPath, targetName) : '',
            };
            externalNodes.set(targetKey, extNode);
          }
        }
      });
    }
  }

  // 外部ノードを追加
  externalNodes.forEach(node => { nodes.push(node); nodeMap.set(node.id, node); });

  return { nodes, edges };
}

function _getNodeColor(name, entityData, colorProp) {
  if (!colorProp || !entityData || !entityData[colorProp]) return '#569cd6';
  const vals = filterValues(entityData[colorProp] || []);
  if (vals.length === 0) return '#569cd6';
  const v = vals[0].value;
  // ステータス色
  const statusColors = { '掲載済み': '#608b4e', '採用': '#569cd6', '案': '#ce9178', 'ボツ': '#3e3e3e' };
  return statusColors[v] || _hashColor(v);
}

function _hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return 'hsl(' + hue + ',55%,55%)';
}

/* --- Force-Directed レイアウト --- */

function layoutForceDirected(nodes, edges, w, h, iterations) {
  iterations = iterations || 100;
  const n = nodes.length;
  if (n === 0) return;

  const area = w * h;
  const k = 0.6 * Math.sqrt(area / n);

  // 初期位置（円形配置）
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n;
    node.x = w / 2 + (w * 0.35) * Math.cos(angle);
    node.y = h / 2 + (h * 0.35) * Math.sin(angle);
  });

  // エッジのインデックスマップ
  const edgeIndex = edges.map(e => ({
    si: nodes.findIndex(n => n.id === e.source),
    ti: nodes.findIndex(n => n.id === e.target),
  })).filter(e => e.si >= 0 && e.ti >= 0);

  let temperature = w / 10;

  for (let iter = 0; iter < iterations; iter++) {
    // 反発力
    for (let i = 0; i < n; i++) {
      nodes[i].vx = 0; nodes[i].vy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (k * k) / dist;
        nodes[i].vx += (dx / dist) * force;
        nodes[i].vy += (dy / dist) * force;
      }
    }
    // 引力
    edgeIndex.forEach(({ si, ti }) => {
      const dx = nodes[ti].x - nodes[si].x;
      const dy = nodes[ti].y - nodes[si].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (dist * dist) / k;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      nodes[si].vx += fx; nodes[si].vy += fy;
      nodes[ti].vx -= fx; nodes[ti].vy -= fy;
    });
    // 位置更新
    nodes.forEach(node => {
      const disp = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (disp > 0) {
        const capped = Math.min(disp, temperature);
        node.x += (node.vx / disp) * capped;
        node.y += (node.vy / disp) * capped;
      }
      node.x = Math.max(30, Math.min(w - 30, node.x));
      node.y = Math.max(30, Math.min(h - 30, node.y));
    });
    temperature *= 0.95;
  }
}

/* --- Hierarchical レイアウト --- */

function layoutHierarchical(nodes, edges, w, h) {
  if (nodes.length === 0) return;
  const nodeMap = new Map();
  nodes.forEach(n => nodeMap.set(n.id, n));

  // 入次数を計算
  const inDeg = new Map();
  nodes.forEach(n => inDeg.set(n.id, 0));
  edges.forEach(e => {
    if (inDeg.has(e.target)) inDeg.set(e.target, inDeg.get(e.target) + 1);
  });

  // BFS層分け
  const layers = [];
  const visited = new Set();
  let queue = nodes.filter(n => inDeg.get(n.id) === 0).map(n => n.id);
  if (queue.length === 0) queue = [nodes[0].id]; // 循環グラフ対策

  while (queue.length > 0) {
    const layer = [];
    queue.forEach(id => { if (!visited.has(id)) { visited.add(id); layer.push(id); } });
    if (layer.length === 0) break;
    layers.push(layer);
    const nextQueue = [];
    layer.forEach(id => {
      edges.forEach(e => {
        if (e.source === id && !visited.has(e.target)) nextQueue.push(e.target);
      });
    });
    queue = nextQueue;
  }
  // 未訪問ノードを最後の層に追加
  nodes.forEach(n => { if (!visited.has(n.id)) layers[layers.length - 1].push(n.id); });

  // 位置割り当て
  const layerH = h / (layers.length + 1);
  layers.forEach((layer, li) => {
    const layerW = w / (layer.length + 1);
    layer.forEach((id, ni) => {
      const node = nodeMap.get(id);
      if (node) { node.x = layerW * (ni + 1); node.y = layerH * (li + 1); }
    });
  });
}

/* --- SVG レンダリング --- */

function renderGraphSvg(nodes, edges, w, h, config) {
  const svg = svgCreate('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h });
  if (nodes.length === 0) {
    svg.appendChild(svgText(w / 2, h / 2, 'リレーションなし', { fill: 'var(--fg2)', fontSize: '14' }));
    return svg;
  }

  const nodeMap = new Map();
  nodes.forEach(n => nodeMap.set(n.id, n));

  // transform group（パン＆ズーム用）
  const g = svgCreate('g', { class: 'graph-transform' });
  svg.appendChild(g);

  // エッジ描画
  edges.forEach(e => {
    const src = nodeMap.get(e.source);
    const tgt = nodeMap.get(e.target);
    if (!src || !tgt) return;
    const path = svgLine(src.x, src.y, tgt.x, tgt.y, e.color || '#555', 1.5);
    path.setAttribute('stroke-opacity', '0.6');
    g.appendChild(path);

    // 矢印（エッジの終端に小さい三角形）
    const dx = tgt.x - src.x, dy = tgt.y - src.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 40) {
      const nx = dx / dist, ny = dy / dist;
      const ax = tgt.x - nx * 22, ay = tgt.y - ny * 22;
      const arrowSize = 6;
      const px = -ny * arrowSize, py = nx * arrowSize;
      const d = `M${ax + px},${ay + py} L${tgt.x - nx * 18},${tgt.y - ny * 18} L${ax - px},${ay - py}`;
      const arrow = svgPath(d, e.color || '#555');
      arrow.setAttribute('fill-opacity', '0.7');
      g.appendChild(arrow);
    }

    // エッジラベル
    if (config.showEdgeLabels && e.label) {
      const mx = (src.x + tgt.x) / 2, my = (src.y + tgt.y) / 2;
      g.appendChild(svgText(mx, my - 4, e.label, { fontSize: '9', fill: 'var(--fg2)', anchor: 'middle' }));
    }
  });

  // ノード描画
  nodes.forEach(node => {
    const r = node.isExternal ? 14 : 20;
    const unresolvedExternal = node.isExternal && !node.entityPath;
    const circle = svgCreate('circle', { cx: node.x, cy: node.y, r, fill: node.color, cursor: unresolvedExternal ? 'not-allowed' : 'pointer' });
    if (node.isExternal) {
      circle.setAttribute('stroke', '#666');
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('stroke-dasharray', '4,2');
    }
    const title = svgCreate('title');
    title.textContent = node.label + (unresolvedExternal ? ' (参照先未解決)' : node.isExternal ? ' (外部DB)' : '');
    circle.appendChild(title);
    circle.dataset.nodeId = node.id;
    circle.dataset.entityName = node.entityName || node.label || node.id;
    circle.dataset.dbPath = node.dbPath || '';
    circle.dataset.entityPath = node.entityPath || '';
    circle.dataset.isExternal = node.isExternal ? '1' : '0';
    g.appendChild(circle);

    if (config.showLabels) {
      const truncLabel = node.label.length > 10 ? node.label.slice(0, 9) + '…' : node.label;
      g.appendChild(svgText(node.x, node.y + r + 14, truncLabel, {
        fontSize: '11', fill: 'var(--fg)', anchor: 'middle',
      }));
    }
  });

  return svg;
}

/* --- パン＆ズーム --- */

function addGraphPanZoom(svg, container) {
  const g = svg.querySelector('.graph-transform');
  if (!g) return;

  let scale = 1, tx = 0, ty = 0;
  let dragging = false, startX = 0, startY = 0;

  const updateTransform = () => {
    g.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
  };

  // 前回のwheelリスナーを除去（リーク防止）
  if (container._graphWheelHandler) {
    container.removeEventListener('wheel', container._graphWheelHandler);
  }
  container._graphWheelHandler = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scale = Math.max(0.2, Math.min(5, scale * delta));
    updateTransform();
  };
  container.addEventListener('wheel', container._graphWheelHandler, { passive: false });

  svg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('circle')) return; // ノードクリックは別処理
    dragging = true; startX = e.clientX - tx; startY = e.clientY - ty;
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    tx = e.clientX - startX; ty = e.clientY - startY;
    updateTransform();
  });
  svg.addEventListener('pointerup', (e) => {
    dragging = false;
    svg.releasePointerCapture(e.pointerId);
  });
}

/* --- 設定バー --- */

function _buildGraphSettingsBar(dbPath, config, allProps, ctx) {
  const bar = document.createElement('div');
  bar.className = 'chart-settings-bar'; // チャートと同じスタイル再利用
  const graphScope = 'graph-' + ((ctx && ctx.paneId) || 'main');

  bar.appendChild(_chartLabel('レイアウト'));
  const layoutSel = _chartSelect([
    { key: 'force', label: '力学モデル' },
    { key: 'hierarchical', label: '階層' },
  ], config.layout, graphScope + '-layout', 'グラフレイアウト');
  layoutSel.addEventListener('change', () => {
    config.layout = layoutSel.value;
    setGraphConfig(dbPath, config, { label: 'シート表示: グラフ設定', detail: 'レイアウト' });
    renderGraph(ctx);
  });
  bar.appendChild(layoutSel);

  bar.appendChild(_chartLabel('色分け'));
  const colorOpts = [{ key: '', label: 'なし' }].concat(allProps.map(p => ({ key: p, label: p })));
  const colorSel = _chartSelect(colorOpts, config.colorProperty || '', graphScope + '-color-property', 'グラフ色分けプロパティ');
  colorSel.addEventListener('change', () => {
    config.colorProperty = colorSel.value;
    setGraphConfig(dbPath, config, { label: 'シート表示: グラフ設定', detail: '色分け' });
    renderGraph(ctx);
  });
  bar.appendChild(colorSel);

  // ラベル表示トグル
  const labelCb = document.createElement('label');
  labelCb.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:var(--fg2);margin-left:12px;cursor:pointer;';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.dataset.e2eId = graphScope + '-show-labels';
  cb.setAttribute('aria-label', 'グラフラベル表示');
  cb.checked = config.showLabels;
  cb.addEventListener('change', () => {
    config.showLabels = cb.checked;
    setGraphConfig(dbPath, config, { label: 'シート表示: グラフ設定', detail: 'ラベル' });
    renderGraph(ctx);
  });
  labelCb.appendChild(cb);
  labelCb.appendChild(document.createTextNode('ラベル'));
  bar.appendChild(labelCb);

  // 外部ノード表示トグル
  const extCb = document.createElement('label');
  extCb.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:12px;color:var(--fg2);margin-left:8px;cursor:pointer;';
  const ecb = document.createElement('input');
  ecb.type = 'checkbox';
  ecb.dataset.e2eId = graphScope + '-show-external-nodes';
  ecb.setAttribute('aria-label', 'グラフ外部ノード表示');
  ecb.checked = config.showExternalNodes;
  ecb.addEventListener('change', () => {
    config.showExternalNodes = ecb.checked;
    setGraphConfig(dbPath, config, { label: 'シート表示: グラフ設定', detail: '外部ノード' });
    renderGraph(ctx);
  });
  extCb.appendChild(ecb);
  extCb.appendChild(document.createTextNode('外部ノード'));
  bar.appendChild(extCb);

  return bar;
}

/* --- メインレンダラ --- */

async function renderGraph(ctx) {
  ctx = ctx || _currentPaneState();
  const container = _paneEl(ctx, '.graph-view') || document.getElementById('graph-view');
  if (!container) return;
  container.innerHTML = '';

  const dbPath = ctx.dbPath || state.currentDbPath;
  const pivotData = ctx.pivotData || state.pivotData;
  if (!dbPath || !pivotData) {
    container.textContent = 'シートを選択してください';
    return;
  }

  const entities = pivotData.entities || {};
  if (Object.keys(entities).length === 0) {
    renderEmptyState(container, 'share2', 'データがありません', 'リレーションを設定するとグラフが表示されます');
    return;
  }

  const config = getGraphConfig(dbPath);
  const allProps = pivotData.properties || [];

  // 設定バー
  const bar = _buildGraphSettingsBar(dbPath, config, allProps, ctx);
  container.appendChild(bar);

  // グラフエリア
  const graphArea = document.createElement('div');
  graphArea.style.cssText = 'flex:1;overflow:hidden;position:relative;';
  container.appendChild(graphArea);

  // データ構築＆レイアウト
  const { nodes, edges } = await buildGraphData(pivotData, dbPath, config);
  const rect = container.getBoundingClientRect();
  const w = Math.max(rect.width || 600, 400);
  const h = Math.max(rect.height - 40 || 400, 300);

  if (config.layout === 'hierarchical') layoutHierarchical(nodes, edges, w, h);
  else layoutForceDirected(nodes, edges, w, h);

  const svg = renderGraphSvg(nodes, edges, w, h, config);
  graphArea.appendChild(svg);

  // パン＆ズーム
  addGraphPanZoom(svg, graphArea);

  // ノードクリック
  svg.addEventListener('click', (e) => {
    const circle = e.target.closest('circle[data-node-id]');
    if (!circle) return;
    const nodeName = circle.dataset.entityName || circle.dataset.nodeId;
    const nodeDbPath = circle.dataset.dbPath;
    const entityPath = circle.dataset.entityPath;
    const isExt = circle.dataset.isExternal === '1';
    if (entityPath) {
      if (typeof openEntityInSplit === 'function') openEntityInSplit(entityPath, nodeName);
      else selectEntity(entityPath);
    } else if (isExt) {
      if (typeof showStatus === 'function') showStatus('参照先エントリが見つかりません: ' + nodeName, true);
    } else {
      const fallbackPath = _entityPath(nodeDbPath || dbPath, nodeName);
      if (typeof openEntityInSplit === 'function') openEntityInSplit(fallbackPath, nodeName);
      else selectEntity(fallbackPath);
    }
  });
  svg.addEventListener('dblclick', (e) => {
    const circle = e.target.closest('circle[data-node-id]');
    if (!circle) return;
    e.stopPropagation();
    const nodeName = circle.dataset.entityName || circle.dataset.nodeId;
    const nodeDbPath = circle.dataset.dbPath || dbPath;
    const entityPath = circle.dataset.entityPath || _entityPath(nodeDbPath, nodeName);
    if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, nodeName);
    selectEntity(entityPath);
  });
}
