// Audit-P2 H-7: view_lock 情報。
// state.view と getAnnotationTarget() から (view_key, kind, getState) を合成する。
function _getActiveViewLockInfo() {
  if (typeof ViewLock === 'undefined' || typeof state === 'undefined') return null;
  const viewName = (typeof _getAnnotationViewName === 'function') ? _getAnnotationViewName() : state.view;
  const target = (typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : '';
  if (!target || !target.includes('/')) return null;
  const kindMap = {
    page: 'page', entity: 'page',
    database: 'db', pivot: 'db', gallery: 'db', kanban: 'db', timeline: 'db',
    chart: 'db', graph: 'db', 'smart-db': 'db',
    scriptnote: 'scriptnote', calendar: 'calendar',
    media: 'media', folder: 'folder',
    compare: 'compare',
  };
  const kind = kindMap[viewName];
  if (!kind || !ViewLock.isSupported(kind)) return null;
  const paneEl = document.querySelector('.gb-pane-active');
  const paneId = paneEl?.id || paneEl?.dataset?.paneId || '';
  const vk = ViewLock.viewKey(target, paneId);
  if (!vk) return null;
  const getState = () => {
    const sc = (typeof _getScrollContainerForView === 'function') ? _getScrollContainerForView(viewName) : null;
    const out = { view: viewName };
    if (sc) { out.scrollX = sc.scrollLeft; out.scrollY = sc.scrollTop; }
    return out;
  };
  return { viewKey: vk, kind, getState };
}

async function _maybeEngageViewLockForStroke() {
  // 表示ロックは既定OFF。ユーザーがロックアイコンを押した時点でのみ固定する。
  // 描画開始時の自動ロックや確認ダイアログは出さない。
  return true;
}

function _annotationScrollbarHitTest(clientX, clientY) {
  const sc = _annScrollContainer;
  if (!sc || typeof sc.getBoundingClientRect !== 'function') return false;
  const rect = sc.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
  const vertical = sc.scrollHeight > sc.clientHeight;
  const horizontal = sc.scrollWidth > sc.clientWidth;
  const gutterX = Math.max(12, Math.min(24, (sc.offsetWidth || 0) - (sc.clientWidth || 0) || 17));
  const gutterY = Math.max(12, Math.min(24, (sc.offsetHeight || 0) - (sc.clientHeight || 0) || 17));
  if (vertical && clientX >= rect.right - gutterX) return true;
  if (horizontal && clientY >= rect.bottom - gutterY) return true;
  return false;
}

function _updateAnnotationOverlayScrollPassthrough(clientX, clientY) {
  const overlay = document.getElementById('ann-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  overlay.classList.toggle('ann-scrollbar-passthrough', _annotationScrollbarHitTest(clientX, clientY));
}

function _routeAnnotationWheelToScrollContainer(event) {
  if (typeof ann === 'undefined' || !ann.active || !_annScrollContainer) return;
  if (event.ctrlKey || _isIframeView(_getAnnotationViewName())) return;
  const sc = _annScrollContainer;
  const canScrollY = sc.scrollHeight > sc.clientHeight;
  const canScrollX = sc.scrollWidth > sc.clientWidth;
  if (!canScrollY && !canScrollX) return;
  const line = 16;
  const page = Math.max(1, sc.clientHeight || 1);
  const unit = event.deltaMode === 1 ? line : (event.deltaMode === 2 ? page : 1);
  if (canScrollX) sc.scrollLeft += event.deltaX * unit;
  if (canScrollY) sc.scrollTop += event.deltaY * unit;
  event.preventDefault();
  event.stopPropagation();
}

document.addEventListener('pointermove', (event) => {
  if (typeof ann === 'undefined' || !ann.active || ann.drawing) return;
  _updateAnnotationOverlayScrollPassthrough(event.clientX, event.clientY);
}, { passive: true });

function _annotationRectDataFromPoints(points) {
  const first = points?.[0] || [0, 0];
  const last = points?.[points.length - 1] || first;
  const x1 = Number(first[0]) || 0, y1 = Number(first[1]) || 0;
  const x2 = Number(last[0]) || 0, y2 = Number(last[1]) || 0;
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

function _updateRectFillEl(rect, data, color, opacity, preview) {
  const x = Number(data?.x) || 0, y = Number(data?.y) || 0;
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', Math.max(1, Number(data?.width) || 0));
  rect.setAttribute('height', Math.max(1, Number(data?.height) || 0));
  rect.setAttribute('fill', color);
  rect.setAttribute('fill-opacity', String((Number(opacity) || 1) * (preview ? 0.2 : 0.4)));
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', '1');
  rect.setAttribute('stroke-opacity', String(Number(opacity) || 1));
  if (preview) rect.setAttribute('stroke-dasharray', '4,4');
  else rect.removeAttribute('stroke-dasharray');
  return rect;
}

function _createRectFillEl(data, color, opacity, preview) {
  return _updateRectFillEl(document.createElementNS(_annSvgNS, 'rect'), data, color, opacity, preview);
}

annOverlay?.addEventListener('wheel', _routeAnnotationWheelToScrollContainer, { passive: false });

annOverlay.addEventListener('pointerdown', async (e) => {
  if (!ann.active) return;
  if (typeof _annotationScrollbarHitTest === 'function' && _annotationScrollbarHitTest(e.clientX, e.clientY)) {
    if (typeof _updateAnnotationOverlayScrollPassthrough === 'function') {
      _updateAnnotationOverlayScrollPassthrough(e.clientX, e.clientY);
    }
    return;
  }
  _preventAnnotationPointerDefault(e);
  if (ann.tool === 'sticky') {
    // Audit-P2 H-7: 付箋も表示状態を変えるとズレる → 誘導対象
    const ok = await _maybeEngageViewLockForStroke();
    if (!ok) return;
    createNote(e.clientX, e.clientY, 'sticky');
    return;
  }
  if (ann.tool === 'eraser') {
    await eraseAtPoint(e.clientX, e.clientY);
    return;
  }
  _resetAnnotationStrokeState();
  ann.drawing = true;
  ann.strokeReady = false;
  ann.strokeEndRequested = false;
  ann.currentPointerId = e.pointerId;
  ann.currentPath = [_annotationPointFromEvent(e)];
  ann.currentPressures = [e.pressure || 0.5];
  try { annOverlay.setPointerCapture(e.pointerId); } catch (_) {}
  // 表示ロックは自動では有効化しない。ロック中は別途 ViewLock の操作ガードだけが働く。
  const ok = await _maybeEngageViewLockForStroke();
  if (ann.currentPointerId !== e.pointerId) return;
  if (!ok) {
    _resetAnnotationStrokeState();
    return;
  }
  ann.strokeReady = true;
  _renderAnnotationPreview();
  if (ann.strokeEndRequested) _finishAnnotationStroke();
});

annOverlay.addEventListener('pointermove', (e) => {
  if (!ann.drawing) return;
  _preventAnnotationPointerDefault(e);
  ann.currentPath.push(_annotationPointFromEvent(e));
  ann.currentPressures.push(e.pressure || 0.5);
  _renderAnnotationPreview();
});

annOverlay.addEventListener('pointerup', (e) => {
  if (!ann.drawing) return;
  _preventAnnotationPointerDefault(e);
  ann.strokeEndRequested = true;
  try { annOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
  if (ann.strokeReady) _finishAnnotationStroke();
});

annOverlay.addEventListener('pointercancel', (e) => {
  if (!ann.drawing) return;
  _preventAnnotationPointerDefault(e);
  ann.strokeEndRequested = true;
  if (ann.strokeReady) _finishAnnotationStroke();
});
