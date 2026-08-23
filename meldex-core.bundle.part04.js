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

  function _ellipseData(points) {
    const rect = _rectData(points);
    return { cx: rect.x + rect.width / 2, cy: rect.y + rect.height / 2, rx: rect.width / 2, ry: rect.height / 2 };
  }

  function _applyMarkupShapeEl(el, type, data, color, opacity, preview) {
    const outlined = type === 'rect-line' || type === 'ellipse-line';
    const normalizedOpacity = _normalizeMarkupOpacity(opacity, 1);
    if (type.startsWith('ellipse')) {
      el.setAttribute('cx', Number(data?.cx) || 0); el.setAttribute('cy', Number(data?.cy) || 0);
      el.setAttribute('rx', Math.max(1, Number(data?.rx) || 0)); el.setAttribute('ry', Math.max(1, Number(data?.ry) || 0));
    } else {
      el.setAttribute('x', Number(data?.x) || 0); el.setAttribute('y', Number(data?.y) || 0);
      el.setAttribute('width', Math.max(1, Number(data?.width) || 0)); el.setAttribute('height', Math.max(1, Number(data?.height) || 0));
    }
    el.setAttribute('fill', outlined ? 'none' : color);
    el.setAttribute('fill-opacity', outlined ? '0' : String(normalizedOpacity * (preview ? .2 : .4)));
    el.setAttribute('stroke', color); el.setAttribute('stroke-opacity', String(normalizedOpacity));
    el.setAttribute('stroke-width', String(Math.max(1, Number(data?.lineWidth) || _ann.widths?.pen || 3)));
    if (preview) el.setAttribute('stroke-dasharray', '4,4'); else el.removeAttribute('stroke-dasharray');
    return el;
  }

  function _renderMarkupShape(type, data, color, opacity, annId) {
    if (type === 'rect') return _renderRect(data, color, opacity, annId);
    const el = _applyMarkupShapeEl(document.createElementNS(_svgNS, type.startsWith('ellipse') ? 'ellipse' : 'rect'), type, data, color, opacity, false);
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
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
        } else if (['rect', 'rect-line', 'ellipse-line', 'ellipse-fill'].includes(item.type)) {
          _renderMarkupShape(item.type, data, item.color, item.opacity, item.id);
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
        targetEl = Array.from(layer.querySelectorAll('path[data-ann-client-id], polygon[data-ann-client-id], rect[data-ann-client-id], ellipse[data-ann-client-id]'))
          .find(el => el.dataset.annClientId === msg.annClientId) || null;
      }
      const els = layer.querySelectorAll('path:not([data-ann-id]), polygon:not([data-ann-id]), rect:not([data-ann-id]), ellipse:not([data-ann-id])');
      if (!targetEl && els.length > 0) targetEl = els[els.length - 1];
      if (targetEl && msg.annId) {
        targetEl.dataset.annId = msg.annId;
        delete targetEl.dataset.annClientId;
      }
    }
    if (msg.type === 'ann-stroke-save-failed') {
      let targetEl = null;
      if (msg.annClientId) {
        targetEl = Array.from(layer.querySelectorAll('path[data-ann-client-id], polygon[data-ann-client-id], rect[data-ann-client-id], ellipse[data-ann-client-id]'))
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

/* === meldex-core.part03.js === */
/* meldex-core.part03.js */
        const avgP = pressures.reduce((a, b) => a + b, 0) / pressures.length;
        el.setAttribute('stroke-width', Math.max(1, avgP * 8));
      } else {
        el.setAttribute('stroke-width', isPen ? '3' : '12');
      }
      el.setAttribute('stroke-opacity', type === 'marker' ? String(normalizedOpacity * 0.5) : String(normalizedOpacity));
      el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    }
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    return el;
  }
  function _saRectData(pts) {
    const a = pts?.[0] || [0, 0], b = pts?.[pts.length - 1] || a;
    const x1 = Number(a[0]) || 0, y1 = Number(a[1]) || 0, x2 = Number(b[0]) || 0, y2 = Number(b[1]) || 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }
  function _saApplyRect(el, data, color, opacity, preview) {
    const normalizedOpacity = _saNormalizeOpacity(opacity, 1);
    el.setAttribute('x', Number(data?.x) || 0); el.setAttribute('y', Number(data?.y) || 0);
    el.setAttribute('width', Math.max(1, Number(data?.width) || 0)); el.setAttribute('height', Math.max(1, Number(data?.height) || 0));
    el.setAttribute('fill', color); el.setAttribute('fill-opacity', String(normalizedOpacity * (preview ? 0.2 : 0.4)));
    el.setAttribute('stroke', color); el.setAttribute('stroke-width', '1'); el.setAttribute('stroke-opacity', String(normalizedOpacity));
    if (preview) el.setAttribute('stroke-dasharray', '4,4'); else el.removeAttribute('stroke-dasharray');
    return el;
  }
  function _renderRect(data, color, opacity, annId) {
    const el = _saApplyRect(document.createElementNS(_svgNS, 'rect'), data, color, opacity, false);
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    return el;
  }

  function _saCurrentTargetPath() {
    return typeof getTargetPath === 'function' ? String(getTargetPath() || '') : '';
  }

  function _saParseAnnotationData(item, message = '一部の注釈データを読み込めませんでした') {
    const raw = item?.data;
    if (raw == null || raw === '') return {};
    if (typeof raw !== 'string') return raw || {};
    try {
      return JSON.parse(raw) || {};
    } catch (error) {
      _saReportSaveFailure(error, message);
      return null;
    }
  }

  function _syncStandaloneNoteInteractivity() {
    container.querySelectorAll('.sa-note').forEach(n => {
      n.style.pointerEvents = _ann.active ? 'auto' : 'none';
    });
  }

  function _saNotePayload(data, textarea, note) {
    const width = Math.max(
      120,
      Math.round(Math.max(note.offsetWidth || 0, (textarea.offsetWidth || 0) + 16, Number(data.width) || 180))
    );
    const height = Math.max(
      60,
      Math.round(Math.max(note.offsetHeight || 0, (textarea.offsetHeight || 0) + 16, Number(data.height) || 100))
    );
    return { ...data, text: textarea.value, width, height };
  }

  function _applyStandaloneNoteSize(note, textarea, data) {
    const width = Math.max(120, Number(data.width) || 180);
    const height = Math.max(60, Number(data.height) || 100);
    note.style.width = width + 'px';
    note.style.minHeight = height + 'px';
    textarea.style.height = Math.max(40, height - 16) + 'px';
  }

  svg.addEventListener('pointerdown', async (e) => {
    if (!_ann.active) return;
    const pt = _toCoords(e.clientX, e.clientY);
    if (_ann.tool === 'sticky') {
      const targetPath = _saCurrentTargetPath();
      if (!targetPath) {
        _saReportSaveFailure(new Error('missing target path'), '注釈の保存先を確認できませんでした');
        return;
      }
      const noteData = { x: pt.x, y: pt.y, width: 180, height: 100, text: '' };
      try {
        const res = await apiPost('/annotations', { target_path: targetPath, type: 'comment', shape: 'sticky', data: noteData, color: _ann.color, opacity: _ann.opacity, user: _getUser() });
        if (_saCurrentTargetPath() !== targetPath) return;
        _renderNote(res.id, noteData, _ann.color);
      } catch (error) { _saReportSaveFailure(error, '付箋作成に失敗しました'); }
      return;
    }
    if (_ann.tool === 'eraser') {
      const els = Array.from(layer.querySelectorAll('path, polygon, rect')).reverse();
      for (const el of els) {
        if (el.classList.contains('ann-preview')) continue;
        if (_saElementHit(el, pt.x, pt.y, 10)) {
          try {
            if (el.dataset.annId) await _saDeleteAnnotation(el.dataset.annId);
            el.remove();
          } catch (error) {
            _saReportSaveFailure(error, '注釈を削除できませんでした');
          }
          break;
        }
      }
      for (const n of container.querySelectorAll('.sa-note')) {
        const r = n.getBoundingClientRect(); const cr = container.getBoundingClientRect();
        const nx = r.left - cr.left, ny = r.top - cr.top;
        if (pt.x >= nx - 5 && pt.x <= nx + r.width + 5 && pt.y >= ny - 5 && pt.y <= ny + r.height + 5) {
          await _saDeleteNoteElement(n);
          break;
        }
      }
      return;
    }
    const targetPath = _saCurrentTargetPath();
    if (!targetPath) {
      _saReportSaveFailure(new Error('missing target path'), '注釈の保存先を確認できませんでした');
      return;
    }
    _ann.drawing = true;
    _ann.targetPath = targetPath;
    _ann.path = [[pt.x, pt.y]]; _ann.pressures = [e.pressure || 0.5];
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    if (!_ann.drawing) return;
    const pt = _toCoords(e.clientX, e.clientY);
    _ann.path.push([pt.x, pt.y]); _ann.pressures.push(e.pressure || 0.5);
    let preview = layer.querySelector('.ann-preview');
    const previewTag = _ann.tool === 'lasso' ? 'polygon' : (_ann.tool === 'rect' ? 'rect' : 'path');
    if (!preview || preview.tagName.toLowerCase() !== previewTag) { preview?.remove(); preview = document.createElementNS(_svgNS, previewTag); preview.classList.add('ann-preview'); layer.appendChild(preview); }
    if (_ann.tool === 'rect') {
      _saApplyRect(preview, _saRectData(_ann.path), _ann.color, _ann.opacity, true);
    } else if (_ann.tool === 'lasso') {
      preview.setAttribute('points', _ann.path.map(p => p.join(',')).join(' '));
      preview.setAttribute('fill', _ann.color); preview.setAttribute('fill-opacity', '0.2');
      preview.setAttribute('stroke', _ann.color); preview.setAttribute('stroke-width', '1'); preview.setAttribute('stroke-dasharray', '4,4');
    } else {
      preview.setAttribute('d', _pathD(_ann.path)); preview.setAttribute('fill', 'none'); preview.setAttribute('stroke', _ann.color);
      preview.setAttribute('stroke-width', _ann.tool === 'pen' ? '3' : '12');
      preview.setAttribute('stroke-opacity', _ann.tool === 'marker' ? String(_saNormalizeOpacity(_ann.opacity, 1) * 0.5) : String(_saNormalizeOpacity(_ann.opacity, 1))); preview.setAttribute('stroke-linecap', 'round');
    }
  });

  svg.addEventListener('pointerup', async () => {
    if (!_ann.drawing) return;
    _ann.drawing = false;
    layer.querySelector('.ann-preview')?.remove();
    if (_ann.path.length < 2) {
      _ann.path = []; _ann.pressures = []; _ann.targetPath = '';
      return;
    }
    const type = _ann.tool === 'rect' ? 'rect' : (_ann.tool === 'lasso' ? 'lasso' : (_ann.tool === 'marker' ? 'marker' : 'stroke'));
    const data = type === 'rect' ? _saRectData(_ann.path) : { points: _ann.path, pressures: _ann.pressures };
    const targetPath = _ann.targetPath || _saCurrentTargetPath();
    if (!targetPath || _saCurrentTargetPath() !== targetPath) {
      _ann.path = []; _ann.pressures = []; _ann.targetPath = '';
      return;
    }
    try {
      const res = await apiPost('/annotations', { target_path: targetPath, type, data, color: _ann.color, opacity: _ann.opacity, user: _getUser() });
      if (_saCurrentTargetPath() !== targetPath) return;
      if (type === 'rect') _renderRect(data, _ann.color, _ann.opacity, res.id);
      else _renderStroke(type, _ann.path, _ann.pressures, _ann.color, _ann.opacity, res.id);
    } catch (error) { _saReportSaveFailure(error); }
    finally { _ann.path = []; _ann.pressures = []; _ann.targetPath = ''; }
  });

  function _isStandaloneNoteAnnotation(item, data) {
    if (!item || data?.deleted) return false;
    const type = String(item.type || '');
    const shape = String(item.shape || data?.shape || '');
    const hasPosition = data && (data.x != null || data.y != null || data.width != null || data.height != null);
    if (type === 'comment') {
      return shape === 'sticky' || data?.noteType === 'sticky' || hasPosition;
    }
    return type === 'note' || type === 'sticky';
  }

  function _renderNote(annId, data, color) {
    const note = document.createElement('div');
    note.className = 'sa-note'; note.dataset.annId = annId;
    note.style.cssText = `position:absolute;left:${data.x}px;top:${data.y}px;width:${data.width||180}px;min-height:${data.height||100}px;background:${color};color:#333;padding:8px;border-radius:4px;font-size:12px;cursor:move;z-index:12;border:1px solid rgba(0,0,0,0.15);`;
    const textarea = document.createElement('textarea');
    textarea.value = data.text || '';
    textarea.style.cssText = 'width:100%;height:80px;background:transparent;border:none;color:#333;font-size:12px;resize:both;outline:none;';
    note.style.pointerEvents = _ann.active ? 'auto' : 'none';
    _applyStandaloneNoteSize(note, textarea, data);
    textarea.onblur = async () => {
      const previousData = { ...data };
      const previousStyle = {
        width: note.style.width,
        minHeight: note.style.minHeight,
        textareaHeight: textarea.style.height,
      };
      Object.assign(data, _saNotePayload(data, textarea, note));
      try {
        await _saUpdateAnnotation(annId, { data: { ...data } });
      } catch (error) {
        Object.keys(data).forEach(key => { delete data[key]; });
        Object.assign(data, previousData);
        note.style.width = previousStyle.width;
        note.style.minHeight = previousStyle.minHeight;
        textarea.style.height = previousStyle.textareaHeight;
        textarea.value = previousData.text || '';
        _saReportSaveFailure(error);
      }
    };
    note.appendChild(textarea);
    let dx = 0, dy = 0;
    note.addEventListener('pointerdown', (e) => {
      if (_ann.active && _ann.tool === 'eraser') {
        e.preventDefault();
        e.stopPropagation();
        _saDeleteNoteElement(note);
        return;
      }
      if (e.target === textarea) return; e.preventDefault();
      const rect = note.getBoundingClientRect();
      dx = e.clientX - rect.left; dy = e.clientY - rect.top;
      const previous = {
        x: data.x || 0,
        y: data.y || 0,
        text: data.text || '',
        width: data.width,
        height: data.height,
        left: note.style.left,
        top: note.style.top,
        noteWidth: note.style.width,
        noteMinHeight: note.style.minHeight,
        textareaHeight: textarea.style.height,
      };
      const onMove = (e2) => {
        const pt = _toCoords(e2.clientX - dx, e2.clientY - dy);
        note.style.left = pt.x + 'px';
        note.style.top = pt.y + 'px';
      };
      const onUp = async () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        Object.assign(data, _saNotePayload(data, textarea, note), {
          x: parseFloat(note.style.left) || 0,
          y: parseFloat(note.style.top) || 0,
        });
        try {
          await _saUpdateAnnotation(annId, { data: { ...data } });
        } catch (error) {
          data.x = previous.x;
          data.y = previous.y;
          data.text = previous.text;
          data.width = previous.width;
          data.height = previous.height;
          note.style.left = previous.left;
          note.style.top = previous.top;
          note.style.width = previous.noteWidth;
          note.style.minHeight = previous.noteMinHeight;
          textarea.style.height = previous.textareaHeight;
          textarea.value = previous.text;
          _saReportSaveFailure(error);
        }
      };
      document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
    });
    container.appendChild(note);
  }

  async function loadAnnotations(targetPath) {
    const requestSeq = ++_loadAnnotationsSeq;
    const requestedTarget = String(targetPath || '');
    layer.innerHTML = ''; container.querySelectorAll('.sa-note').forEach(n => n.remove());
    if (!requestedTarget) return;
    try {
      const items = await apiFetch('/annotations?target=' + encodeURIComponent(requestedTarget));
      const activeTarget = typeof getTargetPath === 'function' ? String(getTargetPath() || '') : requestedTarget;
      if (requestSeq !== _loadAnnotationsSeq || activeTarget !== requestedTarget) return;
      items.forEach(item => {
        const data = _saParseAnnotationData(item);
        if (!data) return;
        if (_isStandaloneNoteAnnotation(item, data)) _renderNote(item.id, data, item.color);
        else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') return;
        else if (item.type === 'rect' && data?.width != null && data?.height != null) _renderRect(data, item.color, item.opacity, item.id);
        else if (data.points) _renderStroke(item.type, data.points, data.pressures || [], item.color, item.opacity, item.id);
      });
      _syncStandaloneNoteInteractivity();
    } catch (error) {
      if (requestSeq === _loadAnnotationsSeq) _saReportSaveFailure(error, '注釈を読み込めませんでした');
    }
  }

  function toggle(active) {
    if (active === undefined) active = !_ann.active;
    _ann.active = active;
    svg.style.pointerEvents = active ? 'auto' : 'none';
    svg.style.cursor = active ? (_ann.tool === 'eraser' ? 'not-allowed' : _ann.tool === 'sticky' ? 'cell' : 'crosshair') : '';
    svg.style.outline = active ? '2px solid rgba(86,156,214,0.3)' : '';
    hitRect.setAttribute('pointer-events', active ? 'all' : 'none');
    _syncStandaloneNoteInteractivity();
  }
  function setTool(tool) { _ann.tool = tool; if (_ann.active) svg.style.cursor = tool === 'eraser' ? 'not-allowed' : tool === 'sticky' ? 'cell' : 'crosshair'; }
  function setColor(c) { _ann.color = c; }
  function setOpacity(o) {
    const opacity = _saNormalizeOpacity(o, 1);
    _ann.opacity = opacity;
    svg.style.opacity = opacity;
    container.querySelectorAll('.sa-note').forEach(n => { n.style.opacity = opacity; });
  }
  function destroy() { svg.remove(); container.querySelectorAll('.sa-note').forEach(n => n.remove()); }

  return { svg, layer, ann: _ann, toggle, loadAnnotations, setTool, setColor, setOpacity, destroy };
}

const STANDALONE_MARKUP_TOOLBAR_CSS = `
.sa-markup-toolbar {
  position: fixed;
  z-index: 55;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  border-bottom: 1px solid var(--border, #333);
  background: var(--ui-popup-bg, var(--bg2, #252525));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
}
.sa-markup-toolbar .sa-tb-btn,
.sa-markup-toolbar .sa-markup-color-btn,
.sa-markup-toolbar .sa-markup-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  background: transparent;
  color: var(--fg, #d4d4d4);
  cursor: pointer;
}
.sa-markup-toolbar .sa-tb-btn:hover,
.sa-markup-toolbar .sa-markup-color-btn:hover,
.sa-markup-toolbar .sa-markup-close-btn:hover {
  background: var(--bg3, #2d2d2d);
  border-color: var(--accent, #569cd6);
}
.sa-markup-toolbar .sa-tb-btn.active,
.sa-markup-toolbar .sa-tb-btn[aria-pressed="true"] {
  background: var(--accent, #569cd6);
  border-color: var(--accent, #569cd6);
  color: #fff;
}
.sa-markup-toolbar .sa-tb-btn svg {
  width: 18px;
  height: 18px;
}
.sa-markup-toolbar .sa-markup-close-btn svg {
  width: 14px;
  height: 14px;
}
.sa-markup-color-swatch {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border, #333);
  border-radius: 999px;
  pointer-events: none;
}
.sa-markup-palette {
  position: fixed;
  z-index: 56;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 188px;
  padding: 6px;
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  background: var(--ui-popup-bg, var(--bg2, #252525));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
.sa-markup-color-dot {
  width: 24px;
  min-width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 999px;
  cursor: pointer;
}
@media (max-width: 640px) {
  .sa-markup-toolbar {
    left: 8px;
    right: 8px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    transform: none;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    max-width: calc(100vw - 16px);
    padding: 6px;
  }
  .sa-markup-toolbar .sa-tb-btn,
  .sa-markup-toolbar .sa-markup-color-btn,
  .sa-markup-toolbar .sa-markup-close-btn {
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
  }
  .sa-markup-toolbar .sa-tb-btn svg {
    width: 20px;
    height: 20px;
  }
  .sa-markup-toolbar .sa-markup-close-btn svg {
    width: 18px;
    height: 18px;
  }
  .sa-markup-palette {
    width: min(260px, calc(100vw - 16px));
    gap: 6px;
    padding: 8px;
  }
  .sa-markup-color-dot {
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
  }
}`;

function _ensureStandaloneMarkupToolbarStyles() {
  if (document.getElementById('meldex-standalone-markup-toolbar-styles')) return;
  const style = document.createElement('style');
  style.id = 'meldex-standalone-markup-toolbar-styles';
  style.textContent = STANDALONE_MARKUP_TOOLBAR_CSS;
  document.head.appendChild(style);
}

function createMarkupToolbar(markup, parentEl) {
  _ensureStandaloneMarkupToolbarStyles();
  let tb = parentEl.querySelector('.sa-markup-toolbar');
  if (tb) return tb;
  tb = document.createElement('div');
  tb.className = 'sa-toolbar sa-markup-toolbar';
  tb.dataset.markupToolbar = '1';
  tb.setAttribute('role', 'toolbar');
  tb.setAttribute('aria-label', '注釈ツールバー');
  let palette = null;
  let closePaletteTimer = null;
  let paletteOutsideHandler = null;
  let paletteKeyHandler = null;
  const closePalette = () => {
    if (closePaletteTimer) clearTimeout(closePaletteTimer);
    closePaletteTimer = null;
    if (paletteOutsideHandler) document.removeEventListener('pointerdown', paletteOutsideHandler, true);
    if (paletteKeyHandler) document.removeEventListener('keydown', paletteKeyHandler, true);
    paletteOutsideHandler = null;
    paletteKeyHandler = null;
    palette?.remove();
    palette = null;
    colorBtn?.setAttribute?.('aria-expanded', 'false');
  };
  const updateToolButtons = (selectedBtn) => {
    tb.querySelectorAll('.sa-tb-btn').forEach(b => {
      const active = b === selectedBtn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };
  [{ name:'pen',icon:'pencil',title:'ペン' },{ name:'marker',icon:'highlighter',title:'マーカー' },{ name:'lasso',icon:'lasso',title:'投げ縄' },{ name:'rect',icon:'square',title:'矩形塗り' },{ name:'eraser',icon:'eraser',title:'消しゴム' },{ name:'sticky',icon:'stickyNote',title:'付箋' }].forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sa-tb-btn' + (t.name === 'pen' ? ' active' : '');
    btn.dataset.tool = t.name; btn.title = t.title; btn.setAttribute('aria-label', t.title); btn.setAttribute('aria-pressed', t.name === 'pen' ? 'true' : 'false'); btn.innerHTML = lucide(t.icon, 18);
    btn.onclick = () => { markup.setTool(t.name); updateToolButtons(btn); };
    tb.appendChild(btn);
  });
  const colorBtn = document.createElement('button');
  colorBtn.type = 'button';
  colorBtn.className = 'sa-markup-color-btn';
  colorBtn.title = '色';
  colorBtn.setAttribute('aria-label', '注釈色');
  colorBtn.setAttribute('aria-haspopup', 'dialog');
  colorBtn.setAttribute('aria-expanded', 'false');
  const colorSwatch = document.createElement('span');
  colorSwatch.className = 'sa-markup-color-swatch';
  colorSwatch.style.background = markup.ann.color || PALETTE_COLORS[0];
  colorBtn.appendChild(colorSwatch);
  colorBtn.onclick = () => {
    if (palette) { closePalette(); return; }
    palette = document.createElement('div');
    palette.className = 'sa-palette sa-markup-palette';
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-label', '注釈色');
    PALETTE_COLORS.forEach(c => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'sa-markup-color-dot';
      dot.title = c;
      dot.setAttribute('aria-label', `注釈色 ${c}`);
      dot.style.background = c;
      dot.onclick = () => { markup.setColor(c); colorSwatch.style.background = c; closePalette(); };
      palette.appendChild(dot);
    });
    document.body.appendChild(palette);
    colorBtn.setAttribute('aria-expanded', 'true');
    positionPopup(palette, colorBtn.getBoundingClientRect(), { prefer: 'right', gap: 8, avoidRect: tb.getBoundingClientRect() });
    paletteKeyHandler = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); closePalette(); colorBtn.focus(); } };
    paletteOutsideHandler = (ev) => { if (!palette?.contains(ev.target) && !colorBtn.contains(ev.target)) closePalette(); };
    closePaletteTimer = setTimeout(() => {
      document.addEventListener('pointerdown', paletteOutsideHandler, true);
      document.addEventListener('keydown', paletteKeyHandler, true);
    }, 0);
  };
  tb.appendChild(colorBtn);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sa-markup-close-btn';
  closeBtn.innerHTML = lucide('x', 14); closeBtn.title = '閉じる'; closeBtn.setAttribute('aria-label', '閉じる');
  closeBtn.onclick = () => { closePalette(); markup.toggle(false); tb.style.display = 'none'; const trigger = document.getElementById('btn-markup'); trigger?.classList.remove('active'); trigger?.setAttribute?.('aria-pressed', 'false'); };
  tb.appendChild(closeBtn);
  parentEl.appendChild(tb);
  return tb;
}

// === ポップアップ位置制御（共通ヘルパー） ===
// pywebview/WebView2環境ではwindow.innerWidth/Heightが不正確な場合があるため
// document.documentElement.clientWidth/Heightを使用する
function _popupCssRect(rect, z) {
  if (!rect) return null;
  const left = Number(rect.left);
  const right = Number(rect.right);
  const top = Number(rect.top);
  const bottom = Number(rect.bottom);
  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  return { left: left / z, right: right / z, top: top / z, bottom: bottom / z };
}

function _popupClampValue(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function _popupRectsOverlap(a, b, gap = 0) {
  if (!a || !b) return false;
  return !(
    a.right <= b.left - gap
    || a.left >= b.right + gap
    || a.bottom <= b.top - gap
    || a.top >= b.bottom + gap
  );
}

function _popupCandidateRect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height };
}

function _fitPopupAroundAvoidRect(baseLeft, baseTop, pw, ph, vw, vh, gap, avoid) {
  if (!avoid) return { left: baseLeft, top: baseTop };
  const maxLeft = vw - pw - gap;
  const maxTop = vh - ph - gap;
  const xNearAnchor = _popupClampValue(baseLeft, gap, maxLeft);
  const yNearAnchor = _popupClampValue(baseTop, gap, maxTop);
  const candidates = [
    { left: xNearAnchor, top: avoid.bottom + gap, side: 'below', space: vh - avoid.bottom - gap },
    { left: xNearAnchor, top: avoid.top - ph - gap, side: 'above', space: avoid.top - gap },
