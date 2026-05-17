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

function _renderAnnotationPreview() {
  if (!ann.drawing || !ann.strokeReady || ann.currentPath.length < 2) return;
  const previewTag = ann.tool === 'lasso' ? 'polygon' : (ann.tool === 'rect' ? 'rect' : 'path');
  let preview = annOverlay.querySelector('.ann-preview');
  if (!preview || preview.tagName.toLowerCase() !== previewTag) {
    preview?.remove(); preview = document.createElementNS(_annSvgNS, previewTag); preview.classList.add('ann-preview');
    (document.getElementById('ann-layer') || annOverlay).appendChild(preview);
  }
  if (ann.tool === 'rect') _updateRectFillEl(preview, _annotationRectDataFromPoints(ann.currentPath), ann.color, ann.opacity, true);
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
    preview.setAttribute('stroke-linecap', 'round');
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

  const type = tool === 'rect' ? 'rect' : (tool === 'lasso' ? 'lasso' : (tool === 'marker' ? 'marker' : 'stroke'));
  const strokeData = type === 'rect' ? _annotationRectDataFromPoints(pathPoints) : { points: pathPoints, pressures };
  if (type !== 'lasso' && type !== 'rect') strokeData.width = width;
  const el = type === 'rect' ? _createRectFillEl(strokeData, color, opacity)
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
