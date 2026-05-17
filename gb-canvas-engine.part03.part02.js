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
function bdFitAll() {
  if (!bd.nodes.length) { bd.zoom=1; bd.panX=bd.panY=0; bd.rotation=0; bdTransform(); return; }
  const c=document.getElementById('bd-canvas');
  if (!c) return; // ボード DOM 未生成時 (非同期タブ切替中など) はスキップ
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
  } catch(e) { showStatus('ボードの保存に失敗しました', true); return false; }
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
    const nn = bdNode(n.text, nextX, nextY, n.w, n.h, {...rest, markers: n.markers ? {...n.markers} : undefined});
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
