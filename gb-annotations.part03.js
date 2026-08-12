// Audit-P2 H-7: view_lock 情報。
// state.view と getAnnotationTarget() から (view_key, kind, getState) を合成する。
function _getActiveViewLockInfo() {
  if (typeof ViewLock === 'undefined' || typeof state === 'undefined') return null;
  const viewName = (typeof _getAnnotationViewName === 'function') ? _getAnnotationViewName() : state.view;
  const target = (typeof getAnnotationTarget === 'function') ? getAnnotationTarget() : '';
  if (!target) return null;
  const kindMap = {
    page: 'page', entity: 'page',
    database: 'db', pivot: 'db', tree: 'db', gallery: 'db', kanban: 'db', timeline: 'db',
    chart: 'db', graph: 'db', form: 'db', 'smart-db': 'db',
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
  const zoom = (typeof _annotationUiZoom === 'function') ? _annotationUiZoom() : 1;
  const gutterX = Math.max(12, Math.min(24, (sc.offsetWidth || 0) - (sc.clientWidth || 0) || 17)) * zoom;
  const gutterY = Math.max(12, Math.min(24, (sc.offsetHeight || 0) - (sc.clientHeight || 0) || 17)) * zoom;
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
  const horizontalDelta = event.deltaX + (event.shiftKey ? event.deltaY : 0);
  const verticalDelta = event.shiftKey && canScrollX ? 0 : event.deltaY;
  if (canScrollX) sc.scrollLeft += horizontalDelta * unit;
  if (canScrollY) sc.scrollTop += verticalDelta * unit;
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
  const normalizedOpacity = _normalizeAnnotationOpacity(opacity, 1);
  rect.setAttribute('fill-opacity', String(normalizedOpacity * (preview ? 0.2 : 0.4)));
  rect.setAttribute('stroke', color);
  rect.setAttribute('stroke-width', '1');
  rect.setAttribute('stroke-opacity', String(normalizedOpacity));
  if (preview) rect.setAttribute('stroke-dasharray', '4,4');
  else rect.removeAttribute('stroke-dasharray');
  return rect;
}

function _createRectFillEl(data, color, opacity, preview) {
  return _updateRectFillEl(document.createElementNS(_annSvgNS, 'rect'), data, color, opacity, preview);
}

function _annotationEllipseDataFromPoints(points) {
  const rect = _annotationRectDataFromPoints(points);
  return { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, rx: rect.width / 2, ry: rect.height / 2 };
}

function _updateAnnotationShapeEl(el, type, data, color, opacity, preview) {
  const normalizedOpacity = _normalizeAnnotationOpacity(opacity, 1);
  const outlined = type === 'rect-line' || type === 'ellipse-line';
  if (type.startsWith('ellipse')) {
    el.setAttribute('cx', Number(data?.cx) || 0);
    el.setAttribute('cy', Number(data?.cy) || 0);
    el.setAttribute('rx', Math.max(1, Number(data?.rx) || 0));
    el.setAttribute('ry', Math.max(1, Number(data?.ry) || 0));
  } else {
    el.setAttribute('x', Number(data?.x) || 0);
    el.setAttribute('y', Number(data?.y) || 0);
    el.setAttribute('width', Math.max(1, Number(data?.width) || 0));
    el.setAttribute('height', Math.max(1, Number(data?.height) || 0));
  }
  el.setAttribute('fill', outlined ? 'none' : color);
  el.setAttribute('fill-opacity', outlined ? '0' : String(normalizedOpacity * (preview ? 0.2 : 0.4)));
  el.setAttribute('stroke', color);
  el.setAttribute('stroke-width', String(Math.max(1, Number(data?.lineWidth) || ann.widths?.pen || 3)));
  el.setAttribute('stroke-opacity', String(normalizedOpacity));
  if (preview) el.setAttribute('stroke-dasharray', '4,4'); else el.removeAttribute('stroke-dasharray');
  return el;
}

function _createAnnotationShapeEl(type, data, color, opacity, preview) {
  const tag = type.startsWith('ellipse') ? 'ellipse' : 'rect';
  return _updateAnnotationShapeEl(document.createElementNS(_annSvgNS, tag), type, data, color, opacity, preview);
}

annOverlay?.addEventListener('wheel', _routeAnnotationWheelToScrollContainer, { passive: false });

annOverlay.addEventListener('pointerdown', async (e) => {
  if (!ann.active) return;
  if (ann.drawing) return;
  if (e.button != null && e.button !== 0) return;
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
  if (ann.currentPointerId !== e.pointerId) return;
  _preventAnnotationPointerDefault(e);
  _appendAnnotationCoalescedStrokePoints(e);
  _renderAnnotationPreview();
});

annOverlay.addEventListener('pointerup', (e) => {
  if (!ann.drawing) return;
  if (ann.currentPointerId !== e.pointerId) return;
  _preventAnnotationPointerDefault(e);
  _appendAnnotationCoalescedStrokePoints(e);
  ann.strokeEndRequested = true;
  try { annOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
  if (ann.strokeReady) _finishAnnotationStroke();
});

annOverlay.addEventListener('pointercancel', (e) => {
  if (!ann.drawing) return;
  if (ann.currentPointerId !== e.pointerId) return;
  _preventAnnotationPointerDefault(e);
  try { annOverlay.releasePointerCapture(e.pointerId); } catch (_) {}
  _resetAnnotationStrokeState();
});

if (typeof _initTrayAnnotationHost === 'function') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => _initTrayAnnotationHost(), { once: true });
  } else {
    _initTrayAnnotationHost();
  }
}
