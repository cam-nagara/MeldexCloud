/* gb-board-render-node.js: per-card board DOM rendering */

let _bdRenderNodeE2ESeq = 0;

function bdCreateRenderContext(options = {}) {
  const hiddenIds = options.hiddenIds instanceof Set ? options.hiddenIds : new Set();
  if (!(options.hiddenIds instanceof Set) && typeof bd !== 'undefined') {
    const hiddenTopicKeys = new Set((bd.hiddenTopicRefs || []).map(ref => JSON.stringify([
      String(ref?.sourceId || ''), String(ref?.topicId || ''),
    ])));
    bd.nodes.forEach(node => {
      const ref = node?.topicRef;
      if (ref && hiddenTopicKeys.has(JSON.stringify([String(ref.sourceId || ''), String(ref.topicId || '')]))) {
        hiddenIds.add(node.id);
      }
    });
    bd.nodes.forEach(node => {
      if (node?.collapsed && typeof bdDescendants === 'function') {
        bdDescendants(node.id).forEach(id => hiddenIds.add(id));
      }
    });
  }
  const drillRoot = options.drillRoot !== undefined
    ? options.drillRoot
    : ((typeof _bdDrillRoot !== 'undefined' && _bdDrillRoot) ? _bdDrillRoot : '');
  const drillIds = drillRoot && typeof bdDescendants === 'function'
    ? new Set([drillRoot, ...bdDescendants(drillRoot)])
    : null;
  const board = typeof bd !== 'undefined' ? bd : null;
  const autoDepthStyleMap = options.autoDepthStyleMap instanceof Map
    ? options.autoDepthStyleMap
    : bdBuildAutoDepthStyleMap(board);
  const parentChildGroupColors = options.parentChildGroupColors instanceof Map
    ? options.parentChildGroupColors
    : ((board?.displayFilters?.highlightParentChildGroups === true && typeof _bdParentChildGroups === 'function')
      ? _bdParentChildGroups({ hiddenIds, drillRoot: drillRoot || '' })
      : new Map());
  return {
    hiddenIds,
    drillRoot,
    drillIds,
    parentChildGroupColors,
    autoDepthStyleMap,
    fastCardRender: options.fastCardRender === true,
  };
}

function bdBuildAutoDepthStyleMap(board) {
  const target = board || (typeof bd !== 'undefined' ? bd : null);
  const nodes = Array.isArray(target?.nodes) ? target.nodes : [];
  const out = new Map();
  if (!nodes.length) return out;
  const roots = nodes.filter(node => node?._autoStyle);
  if (!roots.length) return out;
  const byParent = new Map();
  nodes.forEach(node => {
    const parentId = node?.parent || '';
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(node);
  });
  const styleCount = Math.max(1, Array.isArray(target.depthStyles) ? target.depthStyles.length : 0);
  const visit = (node, depth, rootId, seen) => {
    if (!node?.id || seen.has(node.id)) return;
    // 課題18-案A: 入れ子の起点 (自分以外の _autoStyle カード) には触れず、その起点自身の
    // visit(...,0,...) に任せる。roots.forEach の処理順に依存せず「近い方が勝つ」を保証する。
    if (node.id !== rootId && node._autoStyle) return;
    seen.add(node.id);
    out.set(node.id, { index: Math.min(Math.max(0, depth), styleCount - 1), rootId });
    (byParent.get(node.id) || []).forEach(child => visit(child, depth + 1, rootId, seen));
  };
  roots.forEach(root => visit(root, 0, root.id, new Set()));
  return out;
}

function bdGetAutoDepthStyleIndexForNode(node, depthMap) {
  const meta = node?.id ? depthMap?.get(node.id) : null;
  return meta ? String(meta.index) : '';
}

function bdGetAutoDepthLineStyleIndexForConnection(conn, depthMap) {
  const fromMeta = conn?.from ? depthMap?.get(conn.from) : null;
  const toMeta = conn?.to ? depthMap?.get(conn.to) : null;
  if (!fromMeta || !toMeta || fromMeta.rootId !== toMeta.rootId) return '';
  return String(fromMeta.index);
}

function bdIsNodeRenderable(node, renderContext) {
  if (!node || node.contained) return false;
  const ctx = renderContext || bdCreateRenderContext();
  if (ctx.hiddenIds?.has(node.id)) return false;
  if (ctx.drillIds && !ctx.drillIds.has(node.id)) return false;
  const board = typeof bd !== 'undefined' ? bd : null;
  if (board?.statusFilter && node.status !== board.statusFilter) return false;
  return true;
}

function bdIsContainedNodeRenderable(node, renderContext) {
  if (!node || !node.contained) return false;
  const ctx = renderContext || bdCreateRenderContext();
  if (ctx.hiddenIds?.has(node.id)) return false;
  if (ctx.drillIds && !ctx.drillIds.has(node.id)) return false;
  const board = typeof bd !== 'undefined' ? bd : null;
  if (board?.statusFilter && node.status !== board.statusFilter) return false;
  return true;
}

function bdFindRenderableContainerRoot(node) {
  if (!node || !node.contained || typeof bd === 'undefined') return null;
  let current = node;
  const seen = new Set();
  while (current?.contained && current.parent && !seen.has(current.id)) {
    seen.add(current.id);
    current = bd.nodes.find(item => item?.id === current.parent) || null;
  }
  return current && !current.contained ? current : null;
}

function bdNodeA11yLabel(node) {
  const text = String(node?.text || node?.link || node?.id || '').replace(/\s+/g, ' ').trim();
  return text ? `ボードトピック: ${text}` : 'ボードトピック';
}

function bdSelectNodeForKeyboard(nodeId) {
  if (!nodeId || typeof bd === 'undefined' || !(bd.selected instanceof Set)) return;
  const before = [...bd.selected, ...(bd.selectedConnIds instanceof Set ? bd.selectedConnIds : [])];
  bd.selected.clear();
  bd.selected.add(nodeId);
  if (bd.selectedConnIds instanceof Set) bd.selectedConnIds.clear();
  bd.selectedConnId = '';
  const after = [nodeId, ...before];
  if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(after, 'keyboard-focus');
  else if (typeof bdApplySelectionDomClass === 'function') bdApplySelectionDomClass();
}

function bdHandleNodeKeyboard(ev, nodeId) {
  if (!ev || ev.defaultPrevented || ev.isComposing || ev.keyCode === 229) return;
  if (ev.target?.closest?.('input,textarea,select,[contenteditable="true"],.bd-card-menu-btn')) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const dir = arrows[ev.key];
  if (!dir) return;
  ev.preventDefault();
  if (!(bd.selected instanceof Set) || !bd.selected.has(nodeId)) bdSelectNodeForKeyboard(nodeId);
  const ids = (bd.selected instanceof Set && bd.selected.size) ? [...bd.selected] : [nodeId];
  const movable = ids
    .map(id => bd.nodes.find(node => node?.id === id))
    .filter(node => node && !node.contained && !node.locked);
  if (!movable.length) {
    if (typeof showStatus === 'function') showStatus('ロック中のトピックは移動できません', true);
    return;
  }
  const step = ev.shiftKey ? 40 : 8;
  if (typeof bdPushUndo === 'function') bdPushUndo();
  movable.forEach(node => {
    node.x = Math.round((Number(node.x) || 0) + dir[0] * step);
    node.y = Math.round((Number(node.y) || 0) + dir[1] * step);
    if (typeof bdUpdateNodePosition === 'function') bdUpdateNodePosition(node);
  });
  const movedIds = movable.map(node => node.id);
  if (typeof bdDrawConns === 'function') bdDrawConns({ nodeIds: movedIds, reason: 'keyboard-move' });
  if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(movedIds, 'keyboard-move');
  if (typeof bdMarkExtrasDirty === 'function') {
    bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true, comments: movedIds }, 'keyboard-move');
  }
  if (typeof bdDirty === 'function') bdDirty();
  if (typeof showStatus === 'function') showStatus('トピックを移動しました');
}

function bdRenderNode(node, options = {}) {
  if (!node || !node.id || typeof bd === 'undefined' || typeof document === 'undefined') return null;
  const ctx = options.renderContext || bdCreateRenderContext(options);
  if (!options.skipVisibilityCheck && !bdIsNodeRenderable(node, ctx)) return null;
  const fastCardRender = options.fastCardRender === true || ctx.fastCardRender === true;
  const nodeStyle = typeof bdGetNodeStyle === 'function' ? bdGetNodeStyle(node) : node;
  const div = document.createElement('div');
  const showStatus = !bd.displayFilters || bd.displayFilters.showStatus !== false;
  const showMarkers = !fastCardRender && (!bd.displayFilters || bd.displayFilters.showMarkers !== false);
  const showLinkBadges = !bd.displayFilters || bd.displayFilters.showLinkBadges !== false;
  const showMenuButtons = !fastCardRender && (!bd.displayFilters || bd.displayFilters.showMenuButtons !== false);
  const showImageNames = !bd.displayFilters || bd.displayFilters.showImageNames !== false;

  div.className = 'bd-node';
  div.id = 'bdn-' + node.id;
  div.dataset.cardId = node.id;
  div.tabIndex = 0;
  div.setAttribute('role', 'button');
  div.setAttribute('aria-label', bdNodeA11yLabel(node));
  div.dataset.styleId = node.cardStyle || bd.cardStyles?.[0]?.id || 'default';
  const depthStyleIndex = bdGetAutoDepthStyleIndexForNode(node, ctx.autoDepthStyleMap);
  if (depthStyleIndex) div.dataset.depthStyleIndex = depthStyleIndex;
  if (node.img) div.classList.add('bd-image-node');
  div.dataset.shape = nodeStyle.shape || 'rect';
  div.oncontextmenu = (ev) => {
    ev.preventDefault();
    if (bd._rightPanMoved) { bd._rightPanMoved = false; return false; }
    bdContextMenu(ev, node.id);
    return false;
  };
  div.addEventListener('focus', () => bdSelectNodeForKeyboard(node.id));
  div.addEventListener('keydown', (ev) => bdHandleNodeKeyboard(ev, node.id));
  if (bd.selected.has(node.id)) div.classList.add('bd-selected');
  bdApplyNodeBaseStyles(div, node, nodeStyle, showStatus);
  const groupColor = ctx.parentChildGroupColors?.get(node.id);
  if (groupColor && typeof _bdApplyParentChildGroupHighlight === 'function') {
    _bdApplyParentChildGroupHighlight(div, nodeStyle.shape || '', groupColor);
  }
  bdAppendNodeHuds(div, node, {
    fastCardRender,
    nodeStyle,
    showStatus,
    showMarkers,
    showLinkBadges,
    showMenuButtons,
  });
  bdAppendNodeImage(div, node);
  bdAppendNodeText(div, node, nodeStyle, { fastCardRender, showImageNames });
  if (node.collapsed) div.classList.add('bd-collapsed');
  if (node.container) bdAppendContainedNodes(div, node, ctx, fastCardRender);
  // フキダシのしっぽ: 有無に関わらず毎回配線する (Alt+Shift+ドラッグでの新規作成を受け付けるため)。
  if (typeof bdInstallCardTail === 'function') bdInstallCardTail(div, node);
  return div;
}

function bdApplyNodeBaseStyles(div, node, nodeStyle, showStatus) {
  const isImageNode = !!node?.img;
  div.style.left = node.x + 'px';
  div.style.top = node.y + 'px';
  if (node.w) div.style.width = node.w + 'px';
  if (node.h) div.style.minHeight = node.h + 'px';
  if (isImageNode) {
    div.style.background = 'transparent';
    div.style.borderColor = 'transparent';
    div.style.borderWidth = '0px';
    div.style.borderStyle = 'solid';
  } else if (nodeStyle.bgColor) div.style.background = _bdColorWithOpacity(nodeStyle.bgColor, nodeStyle.bgOpacity);
  if (nodeStyle.textColor) div.style.color = nodeStyle.textColor;
  if (!isImageNode && (nodeStyle.borderColor || nodeStyle.borderWidth)) {
    div.style.borderColor = _bdColorWithOpacity(nodeStyle.borderColor || 'transparent', nodeStyle.borderOpacity);
    div.style.borderWidth = (nodeStyle.borderWidth || 0) + 'px';
    div.style.borderStyle = 'solid';
  }
  if (!isImageNode && nodeStyle.borderRadius != null) div.style.borderRadius = nodeStyle.borderRadius + 'px';
  const transforms = [];
  if (node.flipH) transforms.push('scaleX(-1)');
  if (node.flipV) transforms.push('scaleY(-1)');
  if (node.rotate) transforms.push('rotate(' + node.rotate + 'deg)');
  if (transforms.length) div.style.transform = transforms.join(' ');
  if (node.opacity != null && node.opacity < 1) div.style.opacity = node.opacity;
  if (node.locked) {
    div.style.cursor = 'not-allowed';
    div.style.outline = '1px dashed var(--fg2)';
    div.dataset.locked = '1';
  }
  if (node.minimized) div.classList.add('bd-minimized');
  if (node.container) div.classList.add('bd-container');
  const depth = typeof bdParentDepth === 'function' ? bdParentDepth(node) : 0;
  div.style.zIndex = 2 + depth;
  if (showStatus && node.status && typeof bdStatusDef === 'function') {
    const sd = bdStatusDef(node.status);
    if (sd.opacity < 1) div.style.opacity = sd.opacity;
    if (sd.border) div.style.border = sd.border;
  }
  bdApplyNodeShapeStyles(div, nodeStyle);
}

function bdApplyNodeShapeStyles(div, nodeStyle) {
  if (nodeStyle.shape === 'ellipse') div.style.borderRadius = '50%';
  else if (nodeStyle.shape === 'cloud' || nodeStyle.shape === 'thorn' || nodeStyle.shape === 'thorn-curve' || nodeStyle.shape === 'fluffy') {
    div.style.borderRadius = '0';
    div.style.setProperty('--bd-base-filter', 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))');
  } else if (nodeStyle.shape === 'octagon') div.style.clipPath = 'polygon(12% 0%, 88% 0%, 100% 12%, 100% 88%, 88% 100%, 12% 100%, 0% 88%, 0% 12%)';
  else if (nodeStyle.shape === 'pill') div.style.borderRadius = '999px';
  if (nodeStyle.fontSize) div.style.fontSize = nodeStyle.fontSize + 'px';
  if (nodeStyle.fontBold) div.style.fontWeight = 'bold';
  if (nodeStyle.fontItalic) div.style.fontStyle = 'italic';
  if (!nodeStyle.shadow) return;
  const shp = nodeStyle.shape;
  const isClipPath = shp === 'cloud' || shp === 'thorn' || shp === 'thorn-curve' || shp === 'fluffy'
    || shp === 'octagon';
  if (isClipPath) {
    const base = div.style.getPropertyValue('--bd-base-filter') || '';
    const extra = 'drop-shadow(0 8px 16px var(--bd-shadow-color, rgba(0,0,0,0.25)))';
    div.style.setProperty('--bd-base-filter', (base ? base + ' ' : '') + extra);
  } else {
    div.style.boxShadow = '0 12px 24px var(--bd-shadow-color, rgba(0,0,0,0.18))';
  }
}

function bdAppendNodeHuds(div, node, opts) {
  if (opts.showStatus && !opts.fastCardRender) bdAppendStatusHud(div, node);
  if (opts.showMarkers && typeof BD_MARKERS !== 'undefined') bdAppendMarkerHud(div, node);
  if (!opts.fastCardRender) bdAppendCommentHud(div, node);
  if (node.link || node.imageSourcePath || node.img) bdAppendLinkBadge(div, node, opts.showStatus);
  if (opts.showMenuButtons) bdAppendCardMenuButton(div, node);
}

function bdAppendStatusHud(div, node) {
  const sd = node.status && typeof bdStatusDef === 'function' ? bdStatusDef(node.status) : null;
  if (!sd) return;
  const statusHud = document.createElement('div');
  statusHud.className = 'bd-status-hud bd-hud';
  statusHud.dataset.e2eId = `board-card-${node.id}-status-hud`;
  statusHud.style.background = sd.color || '#888';
  statusHud.title = node.status;
  statusHud.tabIndex = 0;
  statusHud.setAttribute('role', 'button');
  statusHud.setAttribute('aria-label', `ステータス: ${node.status}`);
  statusHud.setAttribute('aria-haspopup', 'menu');
  statusHud.setAttribute('aria-expanded', 'false');
  const openStatusMenu = ev => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (typeof bdStatusMenuFor === 'function') bdStatusMenuFor(node.id, statusHud.getBoundingClientRect(), statusHud);
  };
  statusHud.addEventListener('pointerdown', ev => { ev.stopPropagation(); });
  statusHud.addEventListener('click', openStatusMenu);
  statusHud.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') openStatusMenu(ev);
  });
  div.appendChild(statusHud);
}

function bdAppendMarkerHud(div, node) {
  const hasMarkers = node.markers && Object.keys(node.markers).length > 0;
  if (!hasMarkers) return;
  const markerHud = document.createElement('div');
  markerHud.className = 'bd-marker-hud bd-hud';
  markerHud.dataset.e2eId = `board-card-${node.id}-marker-hud`;
  for (const [cat, idx] of Object.entries(node.markers)) {
    const mk = BD_MARKERS[cat]?.[idx];
    if (!mk) continue;
    const s = document.createElement('span');
    s.className = 'mk';
    s.innerHTML = typeof bdMarkerIconHtml === 'function' ? bdMarkerIconHtml(mk, 14) : (typeof lucide === 'function' ? lucide(mk.icon, 14) : '');
    if (mk.color) s.style.color = mk.color;
    markerHud.appendChild(s);
  }
  markerHud.title = 'マーカーを変更';
  markerHud.tabIndex = 0;
  markerHud.setAttribute('role', 'button');
  markerHud.setAttribute('aria-label', 'マーカーを変更');
  markerHud.setAttribute('aria-haspopup', 'menu');
  markerHud.setAttribute('aria-expanded', 'false');
  const openMarkerMenu = ev => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (typeof bdMarkerMenuFor === 'function') bdMarkerMenuFor(node.id, markerHud.getBoundingClientRect(), markerHud);
  };
  markerHud.addEventListener('pointerdown', ev => { ev.stopPropagation(); });
  markerHud.addEventListener('click', openMarkerMenu);
  markerHud.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') openMarkerMenu(ev);
  });
  div.appendChild(markerHud);
}

function bdAppendCommentHud(div, node) {
  const commentHud = document.createElement('div');
  commentHud.className = 'bd-comment-hud bd-hud empty';
  commentHud.dataset.e2eId = `board-card-${node.id}-comment-hud`;
  commentHud.innerHTML = typeof lucide === 'function' ? lucide('messageSquarePlus', 10) : '+';
  commentHud.title = 'コメントを追加';
  commentHud.tabIndex = 0;
  commentHud.setAttribute('role', 'button');
  commentHud.setAttribute('aria-label', 'コメント');
  commentHud.setAttribute('aria-haspopup', 'menu');
  commentHud.setAttribute('aria-expanded', 'false');
  commentHud.addEventListener('pointerdown', ev => { ev.stopPropagation(); });
  let clickTimer = null;
  const openCommentMenu = ev => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      if (typeof bdCommentMenuFor === 'function') bdCommentMenuFor(node.id, commentHud.getBoundingClientRect(), commentHud);
    }, 250);
  };
  commentHud.addEventListener('click', openCommentMenu);
  commentHud.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') openCommentMenu(ev);
  });
  commentHud.addEventListener('dblclick', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    if (typeof addCommentHere !== 'function') return;
    const filePath = (bd?.path || '').trim();
    if (!filePath) return;
    const snap = (node.text || '').trim().slice(0, 120);
    addCommentHere({
      targetKind: 'board_card',
      filePath,
      targetRef: { file: filePath, cardId: node.id },
      snapshot: snap,
    }, { anchorEl: commentHud });
  });
  div.appendChild(commentHud);
}

function bdAppendAnchorHud(div, node, pos) {
  const anchor = document.createElement('div');
  anchor.className = 'bd-anchor-hud bd-hud ' + pos;
  anchor.title = 'クリックでトピック追加 / ドラッグでライン作成（何もない所へ落とすとトピックも追加）';
  if (typeof lucide === 'function') anchor.innerHTML = lucide('circlePlus', 18);
  anchor.addEventListener('pointerdown', ev => bdHandleAnchorPointerDown(ev, div, node, pos));
  anchor.addEventListener('click', ev => { ev.stopPropagation(); });
  div.appendChild(anchor);
}

function bdHandleAnchorPointerDown(ev, div, node, pos) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  const fromNid = node.id;
  const fromAnchor = (typeof _bdHudPosToAnchorName === 'function') ? _bdHudPosToAnchorName(pos) : '';
  const startX = ev.clientX;
  const startY = ev.clientY;
  let dragged = false;
  const getWorld = (cx, cy) => bdScreenToWorld(cx, cy);
  const onMove = (mv) => {
    if (!dragged && Math.abs(mv.clientX - startX) + Math.abs(mv.clientY - startY) < 4) return;
    dragged = true;
    bdUpdateAnchorPreview(div, node, fromAnchor, mv, getWorld);
  };
  const onUp = (up) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    document.getElementById('bd-conn-preview')?.remove();
    if (!dragged) {
      bdHandleAnchorClickAdd(fromNid, pos, fromAnchor);
      return;
    }
    bdHandleAnchorDrop(up, fromNid, fromAnchor, getWorld);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

function bdUpdateAnchorPreview(div, node, fromAnchor, mv, getWorld) {
  const svg = document.getElementById('bd-svg');
  if (!svg) return;
  let line = document.getElementById('bd-conn-preview');
  if (!line) {
    line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.id = 'bd-conn-preview';
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6,4');
    svg.appendChild(line);
  }
  line.setAttribute('stroke', 'var(--accent)');
  const w0 = div.offsetWidth || 160;
  const h0 = div.offsetHeight || 60;
  const startPt = (typeof _bdGetAnchorPointByShape === 'function')
    ? _bdGetAnchorPointByShape(div.dataset.shape || '', node.x, node.y, w0, h0, fromAnchor)
    : { x: node.x + w0 / 2, y: node.y + h0 / 2 };
  line.setAttribute('x1', startPt.x);
  line.setAttribute('y1', startPt.y);
  const w = getWorld(mv.clientX, mv.clientY);
  line.setAttribute('x2', w.x);
  line.setAttribute('y2', w.y);
}

function bdHandleAnchorClickAdd(fromNid, pos, fromAnchor) {
  const hasConnSel = (bd.selectedConnIds instanceof Set) && bd.selectedConnIds.size > 0;
  if (hasConnSel) {
    bd.connecting = fromNid;
    bd._connLabel = '';
    bd._connOrigin = 'anchor';
    bd._connFromAnchor = fromAnchor;
    if (typeof window.showStatus === 'function') window.showStatus('接続先トピックをクリック (空白クリックで新規トピック作成)');
    return;
  }
  if (typeof _bdAnchorAddCard === 'function') _bdAnchorAddCard(fromNid, pos);
}

function bdHandleAnchorDrop(up, fromNid, fromAnchor, getWorld) {
  const target = document.elementFromPoint(up.clientX, up.clientY);
  const cardEl = target?.closest?.('.bd-node');
  if (cardEl && typeof cardEl.id === 'string' && cardEl.id.startsWith('bdn-')) {
    bdCreateAnchorConnectionToCard(target, cardEl, fromNid, fromAnchor, up, getWorld);
  } else {
    // カードが無い場所へのドロップは、ラインの先へ新規カードを作る。
    // board-card-popup-redesign-plan.md §9.7 (2026-04-18 案α) で決めた挙動で、
    // 2026-05-04 の自由端ライン追加以降ドラッグ経路だけ自由端になっていたものを戻した
    // (2026-08-13 ユーザー指示)。端が浮いたラインは、ツールバーの「ライン追加」・
    // Alt+左ドラッグ・既存ラインの端点ドラッグから従来どおり作れる。
    bdCreateAnchorCardAndConnection(up, fromNid, fromAnchor, getWorld);
  }
  bd.connecting = null;
  bd._connLabel = '';
  bd._connOrigin = null;
  bd._connFromAnchor = null;
}

function bdCreateAnchorConnectionToCard(target, cardEl, fromNid, fromAnchor, up, getWorld) {
  const toId = cardEl.id.substring(4);
  // v0.5.332: 同一カード内のアンカー→アンカードラッグで自己ループを作成可能にする (旧仕様は一律弾いていた)。
  if (typeof bdCanCreateConnection === 'function' && !bdCanCreateConnection(fromNid, toId)) return;
  if (typeof bdPushUndo === 'function') bdPushUndo();
  const conn = (typeof bdCreateConnection === 'function') ? bdCreateConnection(fromNid, toId, { label: '' }) : null;
  if (!conn) return;
  const fromNode = bd.nodes.find(nn => nn.id === fromNid);
  const toNode = bd.nodes.find(nn => nn.id === toId);
  if (typeof _bdProjectCardOutlineEndpoint === 'function'
      && typeof _bdSetConnectionOutlineEndpoint === 'function' && fromNode && toNode) {
    const fromEl = document.getElementById('bdn-' + fromNid);
    const fromPos = typeof bdNodeCanvasPosition === 'function'
      ? bdNodeCanvasPosition(fromNode) : { x: fromNode.x, y: fromNode.y };
    const toPos = typeof bdNodeCanvasPosition === 'function'
      ? bdNodeCanvasPosition(toNode) : { x: toNode.x, y: toNode.y };
    const fromPoint = typeof _bdGetCardAnchorPoint === 'function'
      ? _bdGetCardAnchorPoint(fromNode, fromEl, fromPos, fromAnchor)
      : { x: fromPos.x, y: fromPos.y };
    const fromProjected = _bdProjectCardOutlineEndpoint(fromEl, fromNode, fromPos, fromPoint);
    const toProjected = _bdProjectCardOutlineEndpoint(
      cardEl, toNode, toPos, getWorld(up.clientX, up.clientY),
    );
    if (fromProjected) _bdSetConnectionOutlineEndpoint(conn, 'from', fromNid, fromNode, fromProjected);
    if (toProjected) {
      if (toId === fromNid && fromProjected?.outlinePosition
          && typeof _bdOutlinePathDistance === 'function'
          && _bdOutlinePathDistance(fromProjected.outlinePosition, toProjected.outlinePosition) < 0.001
          && typeof MeldexBoardOutlineEndpoints !== 'undefined') {
        toProjected.outlinePosition = MeldexBoardOutlineEndpoints.nudgeOutlinePosition(
          toProjected.outlinePosition, 'forward', { step: 0.25 },
        );
      }
      _bdSetConnectionOutlineEndpoint(conn, 'to', toId, toNode, toProjected);
    }
  } else {
    if (fromAnchor) conn.fromAnchor = fromAnchor;
    if (typeof _bdFindNearestAnchor === 'function' && toNode) {
      conn.toAnchor = _bdFindNearestAnchor(
        cardEl, toNode, { x: toNode.x, y: toNode.y }, getWorld(up.clientX, up.clientY),
      );
    }
  }
  if (typeof bdMarkConnectionDirty === 'function') bdMarkConnectionDirty(conn.id, 'anchor-connect');
  else if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'anchor-connect' });
  if (typeof bdDirty === 'function') bdDirty();
  if (typeof showStatus === 'function') showStatus(toId === fromNid ? '自己ループラインを追加しました' : 'ラインを追加しました');
}

// 課題6・7・11: 深さ算出は共通ユーティリティ bdParentDepth (gb-canvas-engine.part01.part01.js、
// z-index計算等でも使用) へ一本化する。旧 _bdAnchorNodeDepth は絶対ルートからの深さという同じ
// 計算を重複実装していただけなので削除した。

// 課題7-1・課題18-案A: アンカーカードから新規カードを作成しラインで繋ぐ共通コア処理。
// 「＋」アンカーをドラッグして空白へ落とす経路 (bdCreateAnchorCardAndConnection) と、
// ラインを選択した状態で「＋」を2段階クリックする経路 (gb-canvas-interact.part01.js の
// pointerdown ハンドラ) の両方から呼ばれる。旧実装ではクリック経路だけが本関数を経由せず、
// parent すら指定しない bdCreateNodeWithStyle('', x, y, {}) を直接呼んでいたため、線では
// つながって見えても親子関係が作られない (折りたたみ・自動整列・階層別スタイルの対象外になる)
// 壊れたデータが生成されていた。
// wc: ワールド座標 {x, y}。戻り値は作成したカード (失敗時は null)。
function _bdCreateAnchorCardAndConnectionCore(fromNid, fromAnchor, wc) {
  const fromNode = bd.nodes.find(n => n.id === fromNid) || null;
  // コンテナ内包カードは親相対座標で扱うため、絶対座標で置く新規カードと親子付けしない。
  const canParent = !!fromNode && !fromNode.contained;
  // 課題18-案A: 絶対ルートではなく「最も近い起点」を参照する。入れ子の起点があれば
  // そちらが優先され、起点を共有しない別系統・祖先には影響しない。
  const anchor = (canParent && typeof _bdNearestAutoStyleAnchor === 'function') ? _bdNearestAutoStyleAnchor(fromNid) : null;
  // 階層別スタイルが効いているツリーなら、1つ下の階層のスタイルで作る。
  const useDepthStyle = !!anchor
    && typeof bdGetAutoStyleForDepth === 'function'
    && typeof _bdApplyDepthCardFieldsToNode === 'function';
  const fromDepth = (canParent && typeof _bdAnchorRelativeDepth === 'function') ? _bdAnchorRelativeDepth(fromNid, anchor) : 0;
  const depthStyle = useDepthStyle ? bdGetAutoStyleForDepth(fromDepth + 1, anchor) : null;
  if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
  try {
    if (typeof bdPushUndo === 'function') bdPushUndo();
    // 階層別スタイルが無いツリーでは、代わりに起点カードの見た目を引き継ぐ
    // (Tab / Ctrl+Enter の子カード追加と同じ扱い)。
    const opts = (!depthStyle && typeof bdInheritStyleOpts === 'function' && fromNode)
      ? bdInheritStyleOpts(fromNode)
      : {};
    if (canParent) opts.parent = fromNid;
    const newNode = (typeof bdCreateNodeWithStyle === 'function')
      ? bdCreateNodeWithStyle('', wc.x, wc.y, opts)
      : ((typeof bdNode === 'function') ? bdNode('', wc.x, wc.y, 160, 0, opts) : null);
    if (!newNode) return null;
    if (depthStyle) _bdApplyDepthCardFieldsToNode(newNode, depthStyle);
    bd.nodes.push(newNode);
    let conn = null;
    if (typeof bdCanCreateConnection !== 'function' || bdCanCreateConnection(fromNid, newNode.id)) {
      conn = (typeof bdCreateConnection === 'function') ? bdCreateConnection(fromNid, newNode.id, { label: '' }) : null;
      if (conn && fromAnchor) conn.fromAnchor = fromAnchor;
      // 親→子のラインは、親の階層のラインスタイルに合わせる (bdApplyAutoStyle と同じ規則)。
      if (conn && useDepthStyle && typeof _bdApplyDepthLineFieldsToConn === 'function') {
        _bdApplyDepthLineFieldsToConn(conn, bdGetAutoStyleForDepth(fromDepth, anchor));
      }
    }
    if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(newNode)) {
      if (typeof bdRequestFullRender === 'function') bdRequestFullRender('anchor-drop-add-fallback');
      else if (typeof bdRender === 'function') bdRender();
    }
    if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(newNode.id, 'anchor-drop-add');
    if (conn && typeof bdMarkConnectionDirty === 'function') bdMarkConnectionDirty(conn.id, 'anchor-drop-add');
    else if (typeof bdMarkConnectionsDirtyByNodes === 'function') bdMarkConnectionsDirtyByNodes([fromNid, newNode.id], 'anchor-drop-add');
    if (typeof bdSelect === 'function') bdSelect(newNode.id);
    if (typeof bdDirty === 'function') bdDirty();
    // 課題7-3: 新規カードが選択状態になるのに、オプションパネルの内容が追従していなかった。
    if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ boardUi: true }, 'anchor-drop-add');
    if (typeof showStatus === 'function') showStatus('トピックとラインを追加しました');
    return newNode;
  } finally {
    if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
  }
}

// 「＋」アンカーをドラッグして空白へ落とした時の完了処理 (bdHandleAnchorDrop から呼ばれる)。
// pointerup イベントとワールド座標変換関数を受け取り、共通コアへ委譲する。
function bdCreateAnchorCardAndConnection(up, fromNid, fromAnchor, getWorld) {
  const wc = getWorld(up.clientX, up.clientY);
  return _bdCreateAnchorCardAndConnectionCore(fromNid, fromAnchor, wc);
}

function bdAppendLinkBadge(div, node, showStatus) {
  const resolved = typeof MeldexBoardOpenTarget !== 'undefined'
    ? MeldexBoardOpenTarget.resolve(node)
    : {
        path: String(node.link || node.imageSourcePath || node.img || ''),
        label: String(node.text || node.link || node.imageSourcePath || ''),
        linkType: String(node.linkType || (node.img ? 'image' : '')),
      };
  div.classList.add('bd-link-node');
  div.dataset.linkPath = resolved.path;
  div.dataset.linkType = resolved.linkType;
  div.draggable = !!node.link;
  div.addEventListener('dragstart', ev => {
    if (!node.link || !ev.dataTransfer) return;
    if (typeof bdSuppressNodeClickAfterDrag === 'function') bdSuppressNodeClickAfterDrag([node.id]);
    const label = String(node.text || node.link).trim() || String(node.link).split(/[\\/]/).filter(Boolean).pop() || '';
    ev.dataTransfer.effectAllowed = 'copyMove';
    ev.dataTransfer.setData('text/plain', label);
    const payload = {
      name: label,
      path: node.link,
      type: node.linkType || 'file',
    };
    const selectedNodes = typeof bd !== 'undefined' && bd.selected?.has?.(node.id)
      ? (bd.nodes || []).filter(candidate => bd.selected.has(candidate.id)) : [node];
    if (selectedNodes.length > 1 && window.MeldexBoardTransfer?.setBoardNodesDragData) {
      window.MeldexBoardTransfer.setBoardNodesDragData(ev.dataTransfer, selectedNodes);
    } else {
      ev.dataTransfer.setData('application/x-meldex-node', JSON.stringify(payload));
      window.MeldexDnD?.beginCrossWindowDrag?.(ev.dataTransfer, payload, 'node');
    }
  });
  div.addEventListener('dragend', () => {
    if (typeof bdSuppressNodeClickAfterDrag === 'function') bdSuppressNodeClickAfterDrag([node.id]);
  });
  div.addEventListener('dblclick', ev => {
    if (ev.button !== 0 || ev.target.closest('.bd-card-menu-btn,.bd-link-open-btn')) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof bdShouldSuppressNodeClickAfterDrag === 'function' && bdShouldSuppressNodeClickAfterDrag(node.id)) return;
    if (typeof MeldexBoardOpenTarget !== 'undefined') {
      MeldexBoardOpenTarget.open(node);
    } else if (typeof bdOpenLinkedPath === 'function') {
      bdOpenLinkedPath(resolved.path, resolved.label, { linkType: resolved.linkType });
    }
  });
  bdAppendLinkOpenButton(div, node, resolved);
  const showLinkTooltip = () => {
    if (node.link && typeof _showLinkTooltip === 'function') _showLinkTooltip(div, node.link, node.linkType);
  };
  div.addEventListener('mouseenter', showLinkTooltip);
  div.addEventListener('pointerenter', showLinkTooltip);
  div.addEventListener('pointermove', () => {
    if (node.link && typeof _isLinkTooltipVisible === 'function' && _isLinkTooltipVisible()) {
      _hideLinkTooltip({ suppressNode: div });
      _showLinkTooltip(div, node.link, node.linkType);
    }
  });
  div.addEventListener('mouseleave', _hideLinkTooltip);
}

function bdAppendLinkOpenButton(div, node, resolved) {
  if (!resolved?.path) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bd-link-open-btn';
  button.dataset.e2eId = `board-card-${node.id}-open-link`;
  button.title = 'リンク先を開く';
  button.setAttribute('aria-label', 'リンク先を開く');
  button.draggable = false;
  button.innerHTML = typeof lucide === 'function' ? lucide('externalLink', 14) : '↗';
  button.addEventListener('pointerdown', ev => ev.stopPropagation());
  button.addEventListener('mousedown', ev => ev.stopPropagation());
  button.addEventListener('dragstart', ev => {
    ev.preventDefault();
    ev.stopPropagation();
  });
  button.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof MeldexBoardOpenTarget !== 'undefined') {
      MeldexBoardOpenTarget.open(node);
    } else if (typeof bdOpenLinkedPath === 'function') {
      bdOpenLinkedPath(resolved.path, resolved.label, { linkType: resolved.linkType });
    }
  });
  div.appendChild(button);
}

function bdAppendCardMenuButton(div, node) {
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'bd-card-menu-btn';
  menuBtn.dataset.e2eId = `board-card-${node.id}-menu`;
  menuBtn.innerHTML = '<span></span><span></span><span></span>';
  menuBtn.title = 'トピックメニュー';
  menuBtn.setAttribute('aria-label', 'トピックメニュー');
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const rect = menuBtn.getBoundingClientRect();
    bdContextMenu({ clientX: rect.right - 8, clientY: rect.bottom, trigger: menuBtn, preventDefault() {}, stopPropagation() {} }, node.id);
  });
  div.appendChild(menuBtn);
}

function bdMissingImagePath(node) {
  if (typeof bdImageMissingPathLabel === 'function') return bdImageMissingPathLabel(node);
  return String(node?.link || node?.imageSourcePath || '').replace(/\\/g, '/');
}

function bdAppendMissingImagePlaceholder(div, node) {
  div.querySelectorAll?.('.bd-missing-image').forEach(el => el.remove());
  const box = document.createElement('div');
  box.className = 'bd-missing-image';
  const title = document.createElement('div');
  title.className = 'bd-missing-image-title';
  title.textContent = '画像ファイルが見つかりません';
  box.appendChild(title);
  const path = bdMissingImagePath(node);
  if (path) {
    const pathEl = document.createElement('div');
    pathEl.className = 'bd-missing-image-path';
    pathEl.textContent = path;
    box.appendChild(pathEl);
  }
  if (typeof bdRelocateImageNode === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bd-missing-image-action';
    button.dataset.e2eId = `board-missing-image-relocate-${node.id}`;
    button.textContent = '画像を再指定';
    button.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      bdRelocateImageNode(node.id);
    });
    box.appendChild(button);
  }
  div.appendChild(box);
}

function bdAppendNodeImage(div, node) {
  if (!node.img) return;
  const img = document.createElement('img');
  img.className = 'bd-img';
  img.draggable = false;
  img.onload = () => {
    div.classList.remove('bd-image-missing');
    div.querySelectorAll?.('.bd-missing-image').forEach(el => el.remove());
    node._imageLoadError = false;
    delete node._imageLoadErrorAt;
    node._imgNaturalW = img.naturalWidth || 0;
    node._imgNaturalH = img.naturalHeight || 0;
    if (typeof bdMeasureNodeElement === 'function') bdMeasureNodeElement(node, div);
    if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(node.id);
    else if (typeof bdSyncSelectionRectForNode === 'function') bdSyncSelectionRectForNode(node.id);
    if (typeof bdDrawConns === 'function') bdDrawConns({ nodeIds: [node.id], reason: 'image-load' });
  };
  img.onerror = () => {
    img.style.display = 'none';
    div.classList.add('bd-image-missing');
    node._imageLoadError = true;
    node._imageLoadErrorAt = Date.now();
    bdAppendMissingImagePlaceholder(div, node);
    if (typeof bdMeasureNodeElement === 'function') bdMeasureNodeElement(node, div);
    if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(node.id);
  };
  div.appendChild(img);
  img.src = node.img;
  window.MeldexImageLoading?.track?.(img, { host: div, label: 'ボードの画像を読み込んでいます', errorMode: 'silent' });
}

function bdAppendNodeText(div, node, nodeStyle, options = {}) {
  const txt = document.createElement('div');
  txt.className = 'bd-text';
  const numPrefix = (typeof _bdGetNumber === 'function') ? _bdGetNumber(node.id) : '';
  const rawText = (node.img && !options.showImageNames) ? '' : (node.minimized ? String(node.text || '').split('\n')[0] : node.text);
  const displayText = numPrefix + (rawText || '');
  const findBar = document.getElementById('bd-find-bar');
  const findActive = !!(findBar && findBar.style.display !== 'none' && bd?._findQuery
    && typeof _bdRenderTextWithHighlight === 'function');
  const currentMatch = findActive && Array.isArray(bd._findMatches) ? bd._findMatches[bd._findIndex] : null;
  const currentOccurrence = currentMatch?.type === 'node' && currentMatch?.id === node.id
    ? (currentMatch.occurrence || 0)
    : -1;
  const textHtml = findActive
    ? _bdRenderTextWithHighlight(displayText, bd._findQuery, currentOccurrence)
    : esc(displayText).replace(/\n/g, '<br>');
  if (node.link && !node.img) {
    const content = document.createElement('span');
    content.className = 'bd-link-card-content';
    const icon = document.createElement('span');
    icon.className = 'bd-link-card-icon';
    const linkExt = typeof _bdLinkExt === 'function' ? _bdLinkExt(node.link) : '';
    const iconName = typeof _bdFileIcon === 'function' ? _bdFileIcon(linkExt, node.link, node.linkType) : 'link2';
    icon.innerHTML = typeof _bdIcon === 'function'
      ? _bdIcon(iconName, 18)
      : (typeof lucide === 'function' ? lucide(iconName, 18) : '');
    const label = document.createElement('span');
    label.className = 'bd-link-card-label';
    label.innerHTML = textHtml;
    content.appendChild(icon);
    content.appendChild(label);
    txt.appendChild(content);
  } else {
    txt.innerHTML = options.fastCardRender ? textHtml : applyAutoLinks(textHtml, bd.path);
  }
  if (nodeStyle.textColor) txt.style.color = nodeStyle.textColor;
  txt.style.position = 'relative';
  txt.style.zIndex = '9';
  const textStrokeWidth = Math.max(0, +nodeStyle.textStrokeWidth || 0);
  if (typeof _bdApplyTextOutline === 'function') _bdApplyTextOutline(txt, 0, '', node.id);
  txt.style.filter = '';
  txt.style.webkitTextStroke = '';
  txt.style.paintOrder = '';
  if (textStrokeWidth && typeof _bdTextOutlineShadow === 'function') {
    const strokeColor = nodeStyle.textStrokeColor || 'rgba(15,23,42,0.9)';
    txt.style.textShadow = _bdTextOutlineShadow(textStrokeWidth, strokeColor);
  } else {
    txt.style.textShadow = '';
  }
  div.appendChild(txt);
}

function bdAppendContainedNodes(div, node, ctx, fastCardRender) {
  const innerDiv = document.createElement('div');
  innerDiv.className = 'bd-inner-nodes';
  bd.nodes.filter(ch => ch.parent === node.id && ch.contained).forEach(ch => {
    if (!bdIsContainedNodeRenderable(ch, ctx)) return;
    const chDiv = bdRenderContainedNode(ch, ctx, fastCardRender);
    if (chDiv) innerDiv.appendChild(chDiv);
  });
  div.appendChild(innerDiv);
}

function bdRenderContainedNode(ch, ctx, fastCardRender) {
  const chStyle = typeof bdGetNodeStyle === 'function' ? bdGetNodeStyle(ch) : ch;
  const chDiv = document.createElement('div');
  chDiv.className = 'bd-node';
  chDiv.id = 'bdn-' + ch.id;
  chDiv.dataset.cardId = ch.id;
  chDiv.dataset.styleId = ch.cardStyle || bd.cardStyles?.[0]?.id || 'default';
  chDiv.tabIndex = 0;
  chDiv.setAttribute('role', 'button');
  chDiv.setAttribute('aria-label', bdNodeA11yLabel(ch));
  const depthStyleIndex = bdGetAutoDepthStyleIndexForNode(ch, ctx.autoDepthStyleMap);
  if (depthStyleIndex) chDiv.dataset.depthStyleIndex = depthStyleIndex;
  if (ch.img) chDiv.classList.add('bd-image-node');
  chDiv.oncontextmenu = ev => {
    ev.preventDefault();
    ev.stopPropagation();
    if (bd._rightPanMoved) { bd._rightPanMoved = false; return false; }
    bdContextMenu(ev, ch.id);
    return false;
  };
  chDiv.addEventListener('focus', () => bdSelectNodeForKeyboard(ch.id));
  chDiv.addEventListener('keydown', (ev) => bdHandleNodeKeyboard(ev, ch.id));
  if (bd.selected.has(ch.id)) chDiv.classList.add('bd-selected');
  chDiv.dataset.shape = chStyle.shape || 'rect';
  const chGroupColor = ctx.parentChildGroupColors?.get(ch.id);
  if (chGroupColor && typeof _bdApplyParentChildGroupHighlight === 'function') _bdApplyParentChildGroupHighlight(chDiv, chStyle.shape || '', chGroupColor);
  const showStatus = !bd.displayFilters || bd.displayFilters.showStatus !== false;
  const showMarkers = !fastCardRender && (!bd.displayFilters || bd.displayFilters.showMarkers !== false);
  const showLinkBadges = !bd.displayFilters || bd.displayFilters.showLinkBadges !== false;
  const showMenuButtons = !fastCardRender && (!bd.displayFilters || bd.displayFilters.showMenuButtons !== false);
  const showImageNames = !bd.displayFilters || bd.displayFilters.showImageNames !== false;
  bdApplyNodeBaseStyles(chDiv, ch, chStyle, showStatus);
  chDiv.style.position = 'relative';
  chDiv.style.display = 'inline-block';
  chDiv.style.margin = '4px';
  chDiv.style.left = '';
  chDiv.style.top = '';
  bdAppendNodeHuds(chDiv, ch, {
    fastCardRender,
    nodeStyle: chStyle,
    showStatus,
    showMarkers,
    showLinkBadges,
    showMenuButtons,
    showAnchors: false,
  });
  bdAppendNodeImage(chDiv, ch);
  bdAppendNodeText(chDiv, ch, chStyle, { fastCardRender, showImageNames });
  if (ch.collapsed) chDiv.classList.add('bd-collapsed');
  if (ch.container) bdAppendContainedNodes(chDiv, ch, ctx, fastCardRender);
  // フキダシのしっぽ: bdRenderNode() と同じく、コンテナ内カードにも配線する。
  // ここが抜けていると、コンテナ内カードは右クリックメニューに「フキダシのしっぽ」が
  // 出ても _annTailCtx が無いため何も起きない (AnnotationStickyTail.setTail が無音で no-op する)。
  if (typeof bdInstallCardTail === 'function') bdInstallCardTail(chDiv, ch);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (chDiv.isConnected && typeof bdMeasureNodeElement === 'function') bdMeasureNodeElement(ch, chDiv);
    });
  }
  const chRing = document.createElement('div');
  chRing.className = 'bd-selection-ring';
  chDiv.appendChild(chRing);
  return chDiv;
}

function bdMeasureNodeElement(nodeOrId, element) {
  const node = typeof nodeOrId === 'string' ? bd.nodes.find(n => n.id === nodeOrId) : nodeOrId;
  const div = element || (node?.id ? document.getElementById('bdn-' + node.id) : null);
  if (!node || !div) return false;
  node._rw = div.offsetWidth;
  node._rh = div.offsetHeight;
  bdApplyNodeDynamicShape(div, node);
  return true;
}

function bdApplyNodeDynamicShape(div, node) {
  const shape = div.dataset.shape || '';
  if (shape === 'cloud' || shape === 'thorn' || shape === 'thorn-curve' || shape === 'fluffy') {
    const ns = typeof bdGetNodeStyle === 'function' ? bdGetNodeStyle(node) : null;
    const fn = shape === 'thorn-curve' ? _bdThornCurveClipPath
             : shape === 'thorn' ? _bdThornClipPath
             : shape === 'fluffy' ? _bdFluffyClipPath
             : _bdCloudClipPath;
    if (typeof fn === 'function') {
      const path = fn(div.offsetWidth, div.offsetHeight, ns ? {
        bumpW: ns.cloudBumpWidth,
        bumpH: ns.cloudBumpHeight,
        sideW: ns.cloudSideWidth,
        offset: ns.cloudOffset,
        radius: ns.borderRadius,
        subWidth: ns.cloudSubWidthRatio,
        subHeight: ns.cloudSubHeightRatio,
      } : undefined);
      if (path && typeof _bdApplyCloudShape === 'function') _bdApplyCloudShape(div, path, ns?.borderColor || '', ns?.borderWidth || 0, ns?.bgColor || '', ns?.borderOpacity, ns?.bgOpacity);
    }
  }
  if ((shape === 'ellipse' || shape === 'cloud' || shape === 'thorn' || shape === 'thorn-curve' || shape === 'fluffy') && typeof _bdComputeShapePadding === 'function') {
    const ns = typeof bdGetNodeStyle === 'function' ? bdGetNodeStyle(node) : null;
    const pad = _bdComputeShapePadding(shape, div.offsetWidth, div.offsetHeight, ns);
    if (pad) div.style.padding = `${pad.padY}px ${pad.padX}px`;
  }
}

function bdUpdateNodePosition(nodeOrId) {
  const node = typeof nodeOrId === 'string' ? bd.nodes.find(n => n.id === nodeOrId) : nodeOrId;
  if (!node || node.contained) return false;
  const el = document.getElementById('bdn-' + node.id);
  if (!el) return false;
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';
  return true;
}

function bdSyncNodeDomOrder() {
  const container = document.getElementById('bd-nodes');
  if (!container || typeof bd === 'undefined') return;
  bd.nodes.forEach(node => {
    if (!node || node.contained) return;
    const el = document.getElementById('bdn-' + node.id);
    if (el?.parentNode === container) container.appendChild(el);
  });
}

function bdReplaceNodeElement(nodeOrId, options = {}) {
  const node = typeof nodeOrId === 'string' ? bd.nodes.find(n => n.id === nodeOrId) : nodeOrId;
  if (!node || !node.id || typeof document === 'undefined') return false;
  if (node.contained) {
    const renderRoot = bdFindRenderableContainerRoot(node);
    if (renderRoot) return bdReplaceNodeElement(renderRoot, options);
    const existingContained = document.getElementById('bdn-' + node.id);
    if (existingContained) existingContained.remove();
    if (typeof bdRemoveSelectionUiForMissingNodes === 'function') bdRemoveSelectionUiForMissingNodes();
    return true;
  }
  const container = document.getElementById('bd-nodes');
  if (!container) return false;
  const ctx = options.renderContext || bdCreateRenderContext(options);
  const existing = document.getElementById('bdn-' + node.id);
  if (!bdIsNodeRenderable(node, ctx)) {
    if (existing) existing.remove();
    if (typeof bdRemoveSelectionUiForMissingNodes === 'function') bdRemoveSelectionUiForMissingNodes();
    return true;
  }
  const div = bdRenderNode(node, { ...options, renderContext: ctx });
  if (!div) return false;
  if (existing && existing.parentNode) existing.replaceWith(div);
  else bdInsertNodeElement(container, node, div, ctx);
  bdMeasureNodeElement(node, div);
  return true;
}

function bdInsertNodeElement(container, node, div, ctx) {
  const index = bd.nodes.findIndex(item => item.id === node.id);
  if (index >= 0) {
    for (let i = index + 1; i < bd.nodes.length; i += 1) {
      const next = bd.nodes[i];
      if (!bdIsNodeRenderable(next, ctx)) continue;
      const ref = document.getElementById('bdn-' + next.id);
      if (ref && ref.parentNode === container) {
        container.insertBefore(div, ref);
        return;
      }
    }
  }
  container.appendChild(div);
}
