    .filter(pair => pair.length === 2 && pair.every(Number.isFinite));
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (_annDistanceToSegment(x, y, a[0], a[1], b[0], b[1]) <= tolerance) return true;
  }
  return false;
}

// Pointer Events
const annOverlay = document.getElementById('ann-overlay');

function _preventAnnotationPointerDefault(e) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
}

function _resetAnnotationStrokeState() {
  ann.drawing = false;
  ann.strokeReady = false;
  ann.strokeEndRequested = false;
  ann.currentPointerId = null;
  ann.currentPath = [];
  ann.currentPressures = [];
  annOverlay?.querySelector('.ann-preview')?.remove();
}

function _annotationPointFromEvent(e) {
  const pt = _toContentCoords(e.clientX, e.clientY);
  return [pt.x, pt.y];
}

function _appendAnnotationStrokePointFromEvent(e) {
  const point = _annotationPointFromEvent(e);
  const last = ann.currentPath[ann.currentPath.length - 1] || null;
  if (last && Math.abs(last[0] - point[0]) < 0.5 && Math.abs(last[1] - point[1]) < 0.5) return false;
  ann.currentPath.push(point);
  ann.currentPressures.push(e.pressure || 0.5);
  return true;
}

function _appendAnnotationCoalescedStrokePoints(e) {
  const samples = typeof e?.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
  const ordered = samples?.length ? samples : [e];
  let appended = false;
  for (const sample of ordered) appended = _appendAnnotationStrokePointFromEvent(sample) || appended;
  // 一部ブラウザはcoalesced配列へ現在イベントを含めないため、末尾を必ず補完する。
  appended = _appendAnnotationStrokePointFromEvent(e) || appended;
  return appended;
}

function _renderAnnotationPreview() {
  if (!ann.drawing || !ann.strokeReady || ann.currentPath.length < 2) return;
  const ellipseTool = ann.tool === 'ellipse-line' || ann.tool === 'ellipse-fill';
  const rectTool = ann.tool === 'rect' || ann.tool === 'rect-line';
  const previewTag = ann.tool === 'lasso' ? 'polygon' : (ellipseTool ? 'ellipse' : (rectTool ? 'rect' : 'path'));
  let preview = annOverlay.querySelector('.ann-preview');
  if (!preview || preview.tagName.toLowerCase() !== previewTag) {
    preview?.remove(); preview = document.createElementNS(_annSvgNS, previewTag); preview.classList.add('ann-preview');
    (document.getElementById('ann-layer') || annOverlay).appendChild(preview);
  }
  if (ellipseTool || rectTool) {
    const data = ellipseTool ? _annotationEllipseDataFromPoints(ann.currentPath) : _annotationRectDataFromPoints(ann.currentPath);
    data.lineWidth = ann.widths?.pen;
    _updateAnnotationShapeEl(preview, ann.tool, data, ann.color, ann.opacity, true);
  }
  else if (ann.tool === 'lasso') {
    preview.setAttribute('points', ann.currentPath.map(p => p.join(',')).join(' '));
    preview.setAttribute('fill', ann.color);
    preview.setAttribute('fill-opacity', ann.opacity * 0.2);
    preview.setAttribute('stroke', ann.color);
    preview.setAttribute('stroke-width', '1');
    preview.setAttribute('stroke-dasharray', '4,4');
  } else {
    const d = _pointsToSvgPath(ann.currentPath, ann.currentPressures, ann.tool === 'pen');
    preview.setAttribute('d', d);
    preview.setAttribute('fill', 'none');
    preview.setAttribute('stroke', ann.color);
    preview.setAttribute('stroke-width', _annotationDrawWidth(ann.tool, ann.currentPressures, ann.widths?.[ann.tool]));
    preview.setAttribute('stroke-opacity', ann.tool === 'marker' ? 0.5 : ann.opacity);
    preview.setAttribute('stroke-linecap', ann.tool === 'marker' ? 'butt' : 'round');
    preview.setAttribute('stroke-linejoin', ann.tool === 'polyline' ? 'miter' : 'round');
  }
}

async function _finishAnnotationStroke() {
  if (!ann.drawing || !ann.strokeReady) return;
  const pathPoints = ann.currentPath.map(p => [p[0], p[1]]);
  const pressures = [...ann.currentPressures];
  const tool = ann.tool;
  const color = ann.color;
  const opacity = ann.opacity;
  const targetPath = _resolveAnnotationWriteTarget();
  const width = ann.widths?.[tool === 'marker' ? 'marker' : 'pen'];
  _resetAnnotationStrokeState();
  if (pathPoints.length < 2 || !targetPath) return;

  const shapeTypes = new Set(['rect', 'rect-line', 'ellipse-line', 'ellipse-fill']);
  const type = shapeTypes.has(tool) ? tool : (tool === 'lasso' ? 'lasso' : (tool === 'marker' ? 'marker' : (tool === 'polyline' ? 'polyline' : 'stroke')));
  const strokeData = type.startsWith('ellipse') ? _annotationEllipseDataFromPoints(pathPoints)
    : shapeTypes.has(type) ? _annotationRectDataFromPoints(pathPoints)
      : { points: pathPoints, pressures };
  if (shapeTypes.has(type)) strokeData.lineWidth = width;
  else if (type !== 'lasso') strokeData.width = width;
  const el = shapeTypes.has(type) ? _createAnnotationShapeEl(type, strokeData, color, opacity)
    : type === 'lasso' ? _createLassoEl(pathPoints, color, opacity)
      : _createStrokeEl(_pointsToSvgPath(pathPoints, pressures, tool === 'pen'), color, opacity, pressures, tool === 'pen', strokeData.width);
  el.dataset.annPending = '1';
  _setAnnotationRenderedTarget(targetPath);
  _markAnnotationMutated(targetPath);
  (document.getElementById('ann-layer') || annOverlay).appendChild(el);
  try {
    const res = await apiPost('/annotations', {
      target_path: targetPath,
      type,
      data: strokeData,
      color,
      opacity,
      user: getUsername(),
    });
    if (!el.isConnected || el.dataset.deleted === '1') {
      apiDelete('/annotations/' + encodeURIComponent(res.id)).catch(() => {});
      _markAnnotationMutated(targetPath);
      return;
    }
    delete el.dataset.annPending;
    el.dataset.annId = res.id;
    _markAnnotationMutated(targetPath);
    _pushAnnotationCreateHistory(res.id, '注釈: 描画追加', targetPath).catch(() => {});
  } catch(e) {
    el.remove();
    _markAnnotationMutated(targetPath);
    showStatus('注釈保存に失敗', true);
  }
}
