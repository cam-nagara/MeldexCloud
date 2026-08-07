      preview.classList.add('ann-preview');
      layer.appendChild(preview);
    }
    if (_ann.anchor) {
      const previewType = _ann.tool === 'rect' ? 'rect' : (_ann.tool === 'lasso' ? 'lasso' : (_ann.tool === 'marker' ? 'marker' : 'stroke'));
      const previewData = previewType === 'rect'
        ? { ..._rectData(_ann.path), anchor: _ann.anchor }
        : { points: _ann.path, pressures: _ann.pressures, width: _ann.widths?.[_ann.tool === 'marker' ? 'marker' : 'pen'], anchor: _ann.anchor };
      _applyAnchoredShape(preview, previewType, previewData, _ann.color, _ann.opacity, true);
    } else if (_ann.tool === 'rect') {
      _applyRectEl(preview, _rectData(_ann.path), _ann.color, _ann.opacity, true);
    } else if (_ann.tool === 'lasso') {
      preview.setAttribute('points', _ann.path.map(p => p.join(',')).join(' '));
      preview.setAttribute('fill', _ann.color); preview.setAttribute('fill-opacity', '0.2');
      preview.setAttribute('stroke', _ann.color); preview.setAttribute('stroke-dasharray', '4,4');
    } else {
      preview.setAttribute('d', _pathD(_ann.path));
      preview.setAttribute('fill', 'none'); preview.setAttribute('stroke', _ann.color);
      preview.setAttribute('stroke-width', _drawWidth(_ann.tool, _ann.pressures, _ann.widths?.[_ann.tool]));
      preview.setAttribute('stroke-opacity', _ann.tool === 'marker' ? String(_normalizeMarkupOpacity(_ann.opacity, 1) * 0.5) : String(_normalizeMarkupOpacity(_ann.opacity, 1)));
      preview.setAttribute('stroke-linecap', 'round'); preview.setAttribute('stroke-linejoin', 'round');
    }
  });

  svg.addEventListener('pointerup', (e) => {
    if (!_ann.drawing) return;
    _ann.drawing = false;
    layer.querySelector('.ann-preview')?.remove();
    if (_ann.path.length < 2) return;
    const type = _ann.tool === 'rect' ? 'rect' : (_ann.tool === 'lasso' ? 'lasso' : (_ann.tool === 'marker' ? 'marker' : 'stroke'));
    const annClientId = 'ann-client-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const strokeData = type === 'rect' ? _rectData(_ann.path) : { points: _ann.path, pressures: _ann.pressures };
    if (_ann.anchor) strokeData.anchor = { ..._ann.anchor };
    if (type !== 'lasso' && type !== 'rect') strokeData.width = _ann.widths?.[_ann.tool === 'marker' ? 'marker' : 'pen'];
    const savedEl = type === 'rect'
      ? _renderRect(strokeData, _ann.color, _ann.opacity, null)
      : _renderStroke(type, _ann.path, _ann.pressures, _ann.color, _ann.opacity, null, strokeData.width, strokeData);
    savedEl.dataset.annClientId = annClientId;
    if (_saveBoardAnnotation({
      target_path: _ann.targetPath,
      type,
      data: strokeData,
      color: _ann.color,
      opacity: _ann.opacity,
      user: _annotationUser(),
    }, (res) => {
      if (res?.id) savedEl.dataset.annId = res.id;
    }, () => { savedEl.remove(); })) {
      _ann.path = []; _ann.pressures = []; _ann.anchor = null;
      return;
    }
    // 親に保存依頼
    _postToParent({
      type: 'ann-save-stroke',
      annType: type,
      data: strokeData,
      color: _ann.color, opacity: _ann.opacity, targetPath: _ann.targetPath,
      annClientId,
    });
    // 確定描画
    _ann.path = []; _ann.pressures = []; _ann.anchor = null;
  });

  function _applyAnchoredShape(el, type, data, color, opacity, preview) {
    const normalizedOpacity = _normalizeMarkupOpacity(opacity, 1);
    const points = _anchoredWorldPoints(type, data);
    if (type === 'stroke' || type === 'marker') {
      el.setAttribute('d', _pathD(points));
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', _drawWidth(type, data.pressures || [], data.width) * _annotationAnchorScale(data.anchor));
      el.setAttribute('stroke-opacity', type === 'marker' ? String(normalizedOpacity * 0.5) : String(normalizedOpacity));
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
    } else {
      el.setAttribute('points', points.map(point => point.join(',')).join(' '));
      el.setAttribute('fill', color);
      el.setAttribute('fill-opacity', String(normalizedOpacity * (preview ? 0.2 : 0.4)));
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(_annotationAnchorScale(data.anchor)));
      el.setAttribute('stroke-opacity', String(normalizedOpacity));
      if (preview) el.setAttribute('stroke-dasharray', '4,4');
      else el.removeAttribute('stroke-dasharray');
    }
    return el;
  }

  const _anchoredAnnotationEntries = new Set();
  let _anchoredRefreshHandle = 0;
  const _anchoredResizeObserver = new ResizeObserver(() => _scheduleAnchoredAnnotationRefresh());
  let _anchoredMutationObserver = null;

  function _ensureAnchoredMutationObserver() {
    if (_anchoredMutationObserver) return;
    _anchoredMutationObserver = new MutationObserver(() => _scheduleAnchoredAnnotationRefresh());
    _anchoredMutationObserver.observe(wrapper, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  }

  function _releaseAnchoredMutationObserverIfIdle() {
    if (_anchoredAnnotationEntries.size || !_anchoredMutationObserver) return;
    _anchoredMutationObserver.disconnect();
    _anchoredMutationObserver = null;
  }

  function _trackAnchoredAnnotation(el, type, data, color, opacity) {
    if (!data?.anchor) return;
    const nodeEl = _boardAnnotationNode(data.anchor);
    _anchoredAnnotationEntries.add({
      el,
      type,
      data,
      color,
      opacity,
      detaching: false,
      lastWorldPoints: _anchoredWorldPoints(type, data),
      lastWorldWidth: (Number(data.width) || _widthDefaults[type === 'marker' ? 'marker' : 'pen']) * _annotationAnchorScale(data.anchor),
      observedNode: nodeEl,
    });
    _ensureAnchoredMutationObserver();
    if (nodeEl) _anchoredResizeObserver.observe(nodeEl);
    _scheduleAnchoredAnnotationRefresh();
  }

  function _boardStillHasNode(nodeId) {
    return typeof bd !== 'undefined' && Array.isArray(bd.nodes)
      ? bd.nodes.some(node => node?.id === nodeId)
      : !!document.getElementById('bdn-' + nodeId);
  }

  function _detachAnchoredAnnotation(entry) {
    if (entry.detaching || !entry.data?.anchor) return;
    entry.detaching = true;
    if (entry.observedNode) _anchoredResizeObserver.unobserve(entry.observedNode);
    const worldPoints = entry.lastWorldPoints || [];
    if (entry.type === 'rect') {
      entry.type = 'lasso';
      delete entry.data.x;
      delete entry.data.y;
      delete entry.data.height;
      entry.data.points = worldPoints;
    } else {
      entry.data.points = worldPoints;
      if (entry.type === 'stroke' || entry.type === 'marker') {
        entry.data.width = entry.lastWorldWidth;
      }
    }
    delete entry.data.anchor;
    const annId = entry.el?.dataset?.annId || '';
    const payload = { data: entry.data };
    if (entry.type === 'lasso' && entry.el?.tagName?.toLowerCase() === 'polygon') payload.type = 'lasso';
    const finish = () => { entry.detaching = false; };
    if (annId && _updateBoardAnnotation(annId, payload, finish, finish)) return;
    finish();
  }

  function _refreshAnchoredAnnotations() {
    _anchoredRefreshHandle = 0;
    _anchoredAnnotationEntries.forEach(entry => {
      if (!entry.el?.isConnected) {
        if (entry.observedNode) _anchoredResizeObserver.unobserve(entry.observedNode);
        _anchoredAnnotationEntries.delete(entry);
        return;
      }
      const anchor = entry.data?.anchor;
      if (!anchor) {
        if (entry.observedNode) _anchoredResizeObserver.unobserve(entry.observedNode);
        _anchoredAnnotationEntries.delete(entry);
        return;
      }
      const nodeEl = _boardAnnotationNode(anchor);
      if (!nodeEl) {
        if (!_boardStillHasNode(anchor.nodeId)) _detachAnchoredAnnotation(entry);
        return;
      }
      if (entry.observedNode !== nodeEl) {
        if (entry.observedNode) _anchoredResizeObserver.unobserve(entry.observedNode);
        entry.observedNode = nodeEl;
        _anchoredResizeObserver.observe(nodeEl);
      }
      entry.lastWorldPoints = _anchoredWorldPoints(entry.type, entry.data);
      entry.lastWorldWidth = (Number(entry.data.width) || _widthDefaults[entry.type === 'marker' ? 'marker' : 'pen'])
        * _annotationAnchorScale(anchor);
      _applyAnchoredShape(entry.el, entry.type, entry.data, entry.color, entry.opacity, false);
    });
    _releaseAnchoredMutationObserverIfIdle();
  }

  function _scheduleAnchoredAnnotationRefresh() {
    if (_anchoredRefreshHandle || !_anchoredAnnotationEntries.size) return;
    _anchoredRefreshHandle = requestAnimationFrame(_refreshAnchoredAnnotations);
  }

  function _renderStroke(type, points, pressures, color, opacity, annId, width, sourceData) {
    const normalizedOpacity = _normalizeMarkupOpacity(opacity, 1);
    const data = sourceData || { points, pressures, width };
    let el;
    if (data.anchor) {
      el = document.createElementNS(_svgNS, type === 'lasso' ? 'polygon' : 'path');
      _applyAnchoredShape(el, type, data, color, opacity, false);
    } else if (type === 'lasso') {
      el = document.createElementNS(_svgNS, 'polygon');
      el.setAttribute('points', points.map(p => p.join(',')).join(' '));
      el.setAttribute('fill', color); el.setAttribute('fill-opacity', normalizedOpacity * 0.4);
      el.setAttribute('stroke', color); el.setAttribute('stroke-width', '1');
    } else {
      el = document.createElementNS(_svgNS, 'path');
      el.setAttribute('d', _pathD(points));
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', _drawWidth(type, pressures, width));
      el.setAttribute('stroke-opacity', type === 'marker' ? String(normalizedOpacity * 0.5) : String(normalizedOpacity));
      el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    }
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    _trackAnchoredAnnotation(el, type, data, color, opacity);
    return el;
  }

  function _renderRect(data, color, opacity, annId) {
    const el = data?.anchor
      ? _applyAnchoredShape(document.createElementNS(_svgNS, 'polygon'), 'rect', data, color, opacity, false)
      : _applyRectEl(document.createElementNS(_svgNS, 'rect'), data, color, opacity, false);
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    _trackAnchoredAnnotation(el, 'rect', data, color, opacity);
    return el;
  }

  function _handleMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'ann-set-state') {
      _ann.active = msg.active;
      _ann.tool = msg.tool || 'pen';
      _ann.color = msg.color || '#c48080';
      _ann.opacity = msg.opacity ?? 1;
      _ann.widths = { ..._ann.widths, ...(msg.widths || {}) };
      _ann.targetPath = msg.targetPath || '';
      svg.style.pointerEvents = _ann.active ? 'auto' : 'none';
      svg.style.cursor = _ann.active ? (_ann.tool === 'eraser' ? 'not-allowed' : _ann.tool === 'sticky' ? 'cell' : 'crosshair') : '';
      if (_ann.active) svg.style.outline = '2px solid rgba(86,156,214,0.3)';
      else svg.style.outline = '';
      hitRect.setAttribute('pointer-events', _ann.active ? 'all' : 'none');
      _updateSize();
      _syncNoteInteractivity();
    }
    if (msg.type === 'ann-set-opacity') {
      const opacity = _normalizeMarkupOpacity(msg.opacity, _ann.opacity ?? 1);
      _ann.opacity = opacity;
      svg.style.opacity = opacity;
      notesLayer.style.opacity = opacity;
    }
    if (msg.type === 'ann-set-visibility') {
      svg.style.visibility = msg.visible ? '' : 'hidden';
      notesLayer.style.visibility = msg.visible ? '' : 'hidden';
    }
    if (msg.type === 'ann-add-note') {
      const item = msg.item || {};
      const data = _parseMarkupAnnotationData(item);
      if (!data) return;
      const annId = item.id || msg.annId || '';
      if (annId && [...notesLayer.querySelectorAll('.ann-note-embedded')].some(note => note.dataset.annId === annId)) return;
      _renderNote({ ...item, id: annId, shape: item.shape || 'sticky' }, data || {});
    }
    if (msg.type === 'ann-remove-note') {
      const annId = msg.annId || '';
      [...notesLayer.querySelectorAll('.ann-note-embedded')].forEach(note => {
        if (!annId || note.dataset.annId === annId) note.remove();
      });
    }
    if (msg.type === 'ann-load') {
      layer.innerHTML = '';
      notesLayer.innerHTML = '';
      (msg.items || []).forEach(item => {
        const data = _parseMarkupAnnotationData(item);
        if (!data) return;
        if (_isEmbeddedStandaloneNoteItem(item, data)) {
          _renderNote(item, data || {});
        } else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') {
          return;
        } else if (item.type === 'rect' && data?.width != null && data?.height != null) {
          _renderRect(data, item.color, item.opacity, item.id);
        } else if (data?.points) {
          _renderStroke(item.type, data.points, data.pressures || [], item.color, item.opacity, item.id, data.width, data);
        }
      });
      _syncNoteInteractivity();
      _updateSize();
    }
    if (msg.type === 'ann-stroke-saved') {
      // 親が保存したストロークにIDを付与
      let targetEl = null;
      if (msg.annClientId) {
        targetEl = Array.from(layer.querySelectorAll('path[data-ann-client-id], polygon[data-ann-client-id], rect[data-ann-client-id]'))
          .find(el => el.dataset.annClientId === msg.annClientId) || null;
      }
      const els = layer.querySelectorAll('path:not([data-ann-id]), polygon:not([data-ann-id]), rect:not([data-ann-id])');
      if (!targetEl && els.length > 0) targetEl = els[els.length - 1];
      if (targetEl && msg.annId) {
        targetEl.dataset.annId = msg.annId;
        delete targetEl.dataset.annClientId;
      }
    }
    if (msg.type === 'ann-stroke-save-failed') {
      let targetEl = null;
      if (msg.annClientId) {
        targetEl = Array.from(layer.querySelectorAll('path[data-ann-client-id], polygon[data-ann-client-id], rect[data-ann-client-id]'))
          .find(el => el.dataset.annClientId === msg.annClientId) || null;
      }
      if (targetEl) targetEl.remove();
    }
  }

  function _isTrustedParentMessageEvent(ev) {
    if (!ev) return false;
    if (typeof window !== 'undefined' && window.parent && ev.source !== window.parent) return false;
    try {
      const origin = window.location?.origin || '';
      if (origin && origin !== 'null' && ev.origin !== origin) return false;
    } catch {
      return false;
    }
    return true;
  }

  // 親からのpostMessageで同期
  window.addEventListener('message', (ev) => {
    if (!_isTrustedParentMessageEvent(ev)) return;
    const msg = ev.data;
    _handleMessage(msg);
  });

  const bridge = {
    svg,
    layer,
    notesLayer,
    ann: _ann,
    handleMessage: _handleMessage,
    updateSize: _updateSize,
    refreshAnchoredAnnotations: _refreshAnchoredAnnotations,
  };
  const e2eBridgeEnabled = (() => {
    if (typeof window === 'undefined') return false;
    if (window.GBE2EActions) return true;
    try {
      const params = new URLSearchParams(window.location?.search || '');
      return params.get('smoke') === '1' || params.get('e2e') === '1';
    } catch {
      return false;
    }
  })();
  if (e2eBridgeEnabled) {
    bridge.renderEmbeddedNoteForE2E = (options = {}) => {
      const item = {
        id: options.id || ('e2e-embedded-note-' + Date.now().toString(36)),
        type: 'comment',
        shape: 'sticky',
        color: options.color || _ann.color || '#c48080',
        opacity: options.opacity ?? _ann.opacity ?? 1,
        user: options.user || _annotationUser(),
        created: options.created || new Date().toISOString(),
      };
      const data = {
        x: Number(options.x) || 120,
        y: Number(options.y) || 120,
        width: Number(options.width) || 180,
        height: Number(options.height) || 100,
        text: options.text || '',
        html: options.html || '',
        user: item.user,
      };
      return _renderNote(item, data);
    };
  }
  wrapper._annBridge = bridge;
  if (host !== wrapper) host._annBridge = bridge;
  return bridge;
}

// ============================================================
// スタンドアロンメモ（viewer.html等で使用）
// ============================================================

function initStandaloneMarkup(container, getTargetPath) {
  const _svgNS = 'http://www.w3.org/2000/svg';
  const _ann = { active: false, tool: 'pen', color: PALETTE_COLORS[7] || '#c48080', opacity: 1, drawing: false, path: [], pressures: [] };
  let _loadAnnotationsSeq = 0;

  const svg = document.createElementNS(_svgNS, 'svg');
  svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:10;pointer-events:none;overflow:visible;';
  const hitRect = document.createElementNS(_svgNS, 'rect');
  hitRect.setAttribute('width', '100%'); hitRect.setAttribute('height', '100%');
  hitRect.setAttribute('fill', 'transparent'); hitRect.setAttribute('pointer-events', 'none');
  svg.appendChild(hitRect);
  const layer = document.createElementNS(_svgNS, 'g');
  svg.appendChild(layer);
  container.style.position = 'relative';
  container.appendChild(svg);

  function _pathD(pts) {
    if (pts.length < 2) return '';
    return 'M ' + pts[0][0] + ' ' + pts[0][1] + pts.slice(1).map(p => ' L ' + p[0] + ' ' + p[1]).join('');
  }
  function _toCoords(cx, cy) {
    const r = svg.getBoundingClientRect();
    return {
      x: cx - r.left + (container.scrollLeft || 0),
      y: cy - r.top + (container.scrollTop || 0),
    };
  }
  function _getUser() { try { return JSON.parse(localStorage.getItem('meldex-user') || '{}').name || 'anonymous'; } catch { return 'anonymous'; } }

  function _saNormalizeOpacity(value, fallback = 1) {
    return _normalizeCoreAnnotationOpacity(value, fallback);
  }

  let _saLastSaveFailureAt = 0;
  function _saReportSaveFailure(error, message = '注釈の保存に失敗しました') {
    const now = Date.now();
    if (typeof showStatus === 'function' && now - _saLastSaveFailureAt > 1500) {
      showStatus(message, true);
      _saLastSaveFailureAt = now;
    }
    try { console.warn(message, error); } catch {}
  }

  async function _saUpdateAnnotation(annId, payload) {
    if (!annId || typeof apiPut !== 'function') return null;
    return apiPut('/annotations/' + encodeURIComponent(annId), payload);
  }

  async function _saDeleteAnnotation(annId) {
    if (!annId || typeof apiDelete !== 'function') return null;
    return apiDelete('/annotations/' + encodeURIComponent(annId));
  }

  async function _saDeleteNoteElement(note) {
    const annId = note?.dataset?.annId || '';
    try {
      if (annId) await _saDeleteAnnotation(annId);
      note?.remove();
    } catch (error) {
      _saReportSaveFailure(error, '付箋を削除できませんでした');
    }
  }

  function _saElementHit(el, x, y, tolerance = 10) {
    return _coreAnnotationElementHit(el, x, y, tolerance);
  }

  function _renderStroke(type, points, pressures, color, opacity, annId) {
    const normalizedOpacity = _saNormalizeOpacity(opacity, 1);
    let el;
    if (type === 'lasso') {
      el = document.createElementNS(_svgNS, 'polygon');
      el.setAttribute('points', points.map(p => p.join(',')).join(' '));
      el.setAttribute('fill', color); el.setAttribute('fill-opacity', normalizedOpacity * 0.4);
      el.setAttribute('stroke', color); el.setAttribute('stroke-width', '1');
    } else {
      el = document.createElementNS(_svgNS, 'path');
      el.setAttribute('d', _pathD(points));
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', color);
      const isPen = type === 'stroke';
      if (isPen && pressures.length > 0) {
