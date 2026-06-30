    if (_ann.tool === 'eraser') {
      const pt = _toLocalCoords(e.clientX, e.clientY);
      const x = pt.x;
      const y = pt.y;
      // ヒットテスト
      const els = Array.from(layer.querySelectorAll('path, polygon, rect')).reverse();
      const tolerance = Math.max(8, _ann.widths?.eraser || _widthDefaults.eraser);
      for (const el of els) {
        if (_markupElementHit(el, x, y, tolerance)) {
          const annId = el.dataset.annId;
          if (annId) {
            if (_deleteBoardAnnotation(annId, () => el.remove())) return;
            el.remove();
            _postToParent({ type: 'ann-delete', annId });
            return;
          }
          el.remove();
          return;
        }
      }
      return;
    }
    _ann.drawing = true;
    const pt = _toLocalCoords(e.clientX, e.clientY);
    _ann.path = [[pt.x, pt.y]];
    _ann.pressures = [e.pressure || 0.5];
    try { svg.setPointerCapture?.(e.pointerId); } catch (_) {}
  });

  svg.addEventListener('pointermove', (e) => {
    if (!_ann.drawing) return;
    const pt = _toLocalCoords(e.clientX, e.clientY);
    _ann.path.push([pt.x, pt.y]);
    _ann.pressures.push(e.pressure || 0.5);
    let preview = layer.querySelector('.ann-preview');
    const previewTag = _ann.tool === 'lasso' ? 'polygon' : (_ann.tool === 'rect' ? 'rect' : 'path');
    if (!preview || preview.tagName.toLowerCase() !== previewTag) {
      preview?.remove();
      preview = document.createElementNS(_svgNS, previewTag);
      preview.classList.add('ann-preview');
      layer.appendChild(preview);
    }
    if (_ann.tool === 'rect') {
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
    if (type !== 'lasso' && type !== 'rect') strokeData.width = _ann.widths?.[_ann.tool === 'marker' ? 'marker' : 'pen'];
    const savedEl = type === 'rect' ? _renderRect(strokeData, _ann.color, _ann.opacity, null) : _renderStroke(type, _ann.path, _ann.pressures, _ann.color, _ann.opacity, null, strokeData.width);
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
      _ann.path = []; _ann.pressures = [];
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
    _ann.path = []; _ann.pressures = [];
  });

  function _renderStroke(type, points, pressures, color, opacity, annId, width) {
    const normalizedOpacity = _normalizeMarkupOpacity(opacity, 1);
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
      el.setAttribute('stroke-width', _drawWidth(type, pressures, width));
      el.setAttribute('stroke-opacity', type === 'marker' ? String(normalizedOpacity * 0.5) : String(normalizedOpacity));
      el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    }
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    return el;
  }

  function _renderRect(data, color, opacity, annId) {
    const el = _applyRectEl(document.createElementNS(_svgNS, 'rect'), data, color, opacity, false);
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
        } else if (item.type === 'rect' && data?.width != null && data?.height != null) {
          _renderRect(data, item.color, item.opacity, item.id);
        } else if (data?.points) {
          _renderStroke(item.type, data.points, data.pressures || [], item.color, item.opacity, item.id, data.width);
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

  // 親からのpostMessageで同期
  window.addEventListener('message', (ev) => {
    const msg = ev.data;
    _handleMessage(msg);
  });

  const bridge = { svg, layer, notesLayer, ann: _ann, handleMessage: _handleMessage, updateSize: _updateSize };
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

function createMarkupToolbar(markup, parentEl) {
  let tb = parentEl.querySelector('.sa-toolbar');
  if (tb) return tb;
  tb = document.createElement('div');
  tb.className = 'sa-toolbar';
  tb.style.cssText = 'position:fixed;z-index:55;background:var(--ui-popup-bg, var(--bg2,#252525));border:1px solid var(--border,#333);border-radius:8px;padding:4px 8px;display:flex;gap:4px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.4);bottom:60px;left:50%;transform:translateX(-50%);';
  [{ name:'pen',icon:'pencil',title:'ペン' },{ name:'marker',icon:'highlighter',title:'マーカー' },{ name:'lasso',icon:'lasso',title:'投げ縄' },{ name:'rect',icon:'square',title:'矩形塗り' },{ name:'eraser',icon:'eraser',title:'消しゴム' },{ name:'sticky',icon:'stickyNote',title:'付箋' }].forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'sa-tb-btn' + (t.name === 'pen' ? ' active' : '');
    btn.dataset.tool = t.name; btn.title = t.title; btn.innerHTML = lucide(t.icon, 18);
    btn.style.cssText = 'background:var(--bg3,#2d2d2d);border:1px solid var(--border,#333);border-radius:4px;cursor:pointer;padding:4px 6px;color:var(--fg,#d4d4d4);display:flex;align-items:center;';
    btn.onclick = () => { markup.setTool(t.name); tb.querySelectorAll('.sa-tb-btn').forEach(b => { b.style.background = b === btn ? 'var(--accent,#569cd6)' : 'var(--bg3,#2d2d2d)'; b.style.color = b === btn ? '#fff' : 'var(--fg,#d4d4d4)'; }); };
    tb.appendChild(btn);
  });
  const colorBtn = document.createElement('div');
  colorBtn.style.cssText = 'width:22px;height:22px;border-radius:50%;border:2px solid var(--border,#333);cursor:pointer;background:' + (markup.ann.color || PALETTE_COLORS[0]) + ';';
  colorBtn.title = '色';
  colorBtn.onclick = () => {
    let palette = tb.querySelector('.sa-palette');
    if (palette) { palette.remove(); return; }
    palette = document.createElement('div'); palette.className = 'sa-palette';
    palette.style.cssText = 'position:absolute;bottom:44px;left:0;background:var(--bg2,#252525);border:1px solid var(--border,#333);border-radius:6px;padding:6px;display:flex;flex-wrap:wrap;gap:3px;width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
    PALETTE_COLORS.forEach(c => { const dot = document.createElement('div'); dot.style.cssText = 'width:18px;height:18px;border-radius:50%;cursor:pointer;background:' + c + ';border:1px solid rgba(255,255,255,0.15);'; dot.onclick = () => { markup.setColor(c); colorBtn.style.background = c; palette.remove(); }; palette.appendChild(dot); });
    tb.appendChild(palette);
  };
  tb.appendChild(colorBtn);
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = lucide('x', 14); closeBtn.title = '閉じる';
  closeBtn.style.cssText = 'background:none;border:none;color:var(--fg2,#969696);cursor:pointer;font-size:14px;padding:2px 4px;';
  closeBtn.onclick = () => { markup.toggle(false); tb.style.display = 'none'; document.getElementById('btn-markup')?.classList.remove('active'); };
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
    { left: avoid.right + gap, top: yNearAnchor, side: 'right', space: vw - avoid.right - gap },
    { left: avoid.left - pw - gap, top: yNearAnchor, side: 'left', space: avoid.left - gap },
  ];

  for (const candidate of candidates) {
    const left = _popupClampValue(candidate.left, gap, maxLeft);
    const top = _popupClampValue(candidate.top, gap, maxTop);
    const rect = _popupCandidateRect(left, top, pw, ph);
    const fitsViewport = left >= gap && top >= gap && rect.right <= vw - gap && rect.bottom <= vh - gap;
    if (fitsViewport && !_popupRectsOverlap(rect, avoid, 0)) return { left, top };
  }

  const vertical = candidates
    .filter(c => c.side === 'below' || c.side === 'above')
    .filter(c => c.space >= 72)
    .sort((a, b) => b.space - a.space)[0];
  if (vertical) {
    const left = _popupClampValue(vertical.left, gap, maxLeft);
    const top = vertical.side === 'above'
      ? Math.max(gap, avoid.top - Math.min(ph, vertical.space) - gap)
      : avoid.bottom + gap;
    return { left, top, maxHeight: Math.max(72, vertical.space) };
  }

  const horizontal = candidates
    .filter(c => c.side === 'right' || c.side === 'left')
    .filter(c => c.space >= 72)
    .sort((a, b) => b.space - a.space)[0];
  if (horizontal) {
    const left = horizontal.side === 'left'
      ? Math.max(gap, avoid.left - Math.min(pw, horizontal.space) - gap)
      : avoid.right + gap;
    const top = _popupClampValue(horizontal.top, gap, maxTop);
    return { left, top, maxWidth: Math.max(72, horizontal.space) };
  }

  return {
    left: _popupClampValue(baseLeft, gap, maxLeft),
    top: _popupClampValue(baseTop, gap, maxTop),
  };
}

function positionPopup(popup, anchorRect, options = {}) {
  const z = _getZoom();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const gap = options.gap ?? 4;
  const preferDirection = options.prefer || 'below'; // 'below' | 'right'
  // anchorRectはgetBoundingClientRect()由来（viewport pixels）なのでCSS座標に変換
  const ar = _popupCssRect(anchorRect, z);
  const avoid = _popupCssRect(options.avoidRect, z);
  if (!ar) return;
  // 非表示でDOMに追加して測定
  popup.style.maxHeight = '';
  popup.style.maxWidth = '';
  popup.style.overflowY = '';
  popup.style.overflowX = '';
  popup.style.visibility = 'hidden';
  if (!popup.parentNode) document.body.appendChild(popup);
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  let left, top;
  if (preferDirection === 'right') {
    // 右に表示、収まらなければ左
    left = ar.right + gap;
    if (left + pw > vw) left = Math.max(gap, ar.left - pw - gap);
    if (left + pw > vw) left = Math.max(gap, vw - pw - gap);
    top = ar.top;
  } else {
    // 下に表示
    left = ar.left;
    top = ar.bottom + gap;
  }
  // 右端チェック
  if (left + pw > vw) left = Math.max(gap, vw - pw - gap);
  // 下端チェック
  const spaceBelow = vh - ar.bottom - gap;
  const spaceAbove = ar.top - gap;
  if (top + ph > vh) {
    if (ph <= spaceAbove) {
      top = ar.top - ph - gap;
    } else if (spaceBelow >= spaceAbove) {
      top = ar.bottom + gap;
      popup.style.maxHeight = Math.max(120, spaceBelow) + 'px';
      popup.style.overflowY = 'auto';
    } else {
      top = gap;
      popup.style.maxHeight = Math.max(120, spaceAbove) + 'px';
      popup.style.overflowY = 'auto';
    }
  }
  // 上端チェック
  if (top < gap) top = gap;
  if (avoid) {
    const fitted = _fitPopupAroundAvoidRect(left, top, pw, ph, vw, vh, gap, avoid);
    left = fitted.left;
    top = fitted.top;
    if (fitted.maxHeight != null) {
      popup.style.maxHeight = fitted.maxHeight + 'px';
      popup.style.overflowY = 'auto';
    }
    if (fitted.maxWidth != null) {
      popup.style.maxWidth = fitted.maxWidth + 'px';
      popup.style.overflowX = 'auto';
    }
  }
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.visibility = 'visible';
  // 最終安全策: clampPopupToViewportで確実にビューポート内に収める
  clampPopupToViewport(popup);
}

// ============================================================
// 長押し検知ヘルパー: iPad など contextmenu が安定しない環境向けに、
// タッチ/ペン入力の長押しで handler を発火させる。マウスは触らない
// （従来の contextmenu で右クリックメニューがそのまま使える）。
//
// 使い方:
//   addLongPressHandler(el, (ev) => { myMenuFn(ev, ...); });
//   ev は clientX/Y/target/currentTarget/preventDefault/stopPropagation を
//   持つ合成オブジェクト。既存の contextmenu ハンドラにそのまま渡せる。
// ============================================================
function addLongPressHandler(el, handler, opts = {}) {
  const DURATION = opts.duration ?? 500;
  const MOVE_THRESHOLD = opts.moveThreshold ?? 10;
  let timer = null;
  let startX = 0, startY = 0;
  let fired = false;
  let touchStartEv = null;

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  el.addEventListener('pointerdown', (e) => {
    // タッチと Apple Pencil 等のペン入力のみ対象。マウスは無視
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (e.button !== 0 && e.button !== undefined && e.button !== -1) return;
    cancel();
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    touchStartEv = e;
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      handler({
        clientX: startX,
        clientY: startY,
        target: touchStartEv?.target || el,
        currentTarget: el,
        pointerType: touchStartEv?.pointerType || 'touch',
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    }, DURATION);
  });

  el.addEventListener('pointermove', (e) => {
    if (!timer) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) cancel();
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
    el.addEventListener(ev, cancel);
  });

  // 長押し発火後の click / contextmenu は同ノードの他リスナーも含めて抑止
  // （stopPropagation だと同ノードの bubble リスナーが走る可能性があるため
  //  stopImmediatePropagation を使う）
  el.addEventListener('click', (e) => {
    if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
  }, true);
  el.addEventListener('contextmenu', (e) => {
    if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
  }, true);
}

function _isNativeContextMenuSurface(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('#html-view, #html-iframe');
}

// Meldex 全域でブラウザ標準右クリックメニューを抑止（input / textarea / HTMLビューワー は除外）。
// 旧 gb-editor.part04.js のルビハンドラ冒頭にあった同処理をここへ移管（capture phase）。
document.addEventListener('contextmenu', (e) => {
  if (_isNativeContextMenuSurface(e.target)) return;
  if (!e.target.matches('input, textarea')) e.preventDefault();
}, true);

// ============================================================
// 確認ダイアログ（モーダル）
// ============================================================
function showConfirmDialog(message, onOk, onCancel) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:320px;max-width:480px;">
    <div class="modal-body" style="padding:16px 20px;font-size:13px;white-space:pre-wrap;color:var(--fg);">${typeof esc === 'function' ? esc(message) : message}</div>
    <div class="btn-row" style="display:flex;gap:8px;justify-content:flex-end;padding:8px 16px 16px;">
      <button type="button" class="cancel-btn">キャンセル</button>
      <button type="button" class="primary ok-btn">OK</button>
    </div>
