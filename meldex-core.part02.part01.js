/* meldex-core.part02.js */
function closeColHeaderMenu() {
  document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
}

function _normalizeCoreAnnotationOpacity(value, fallback = 1) {
  const opacity = Number(value);
  if (!Number.isFinite(opacity)) return fallback;
  return Math.max(0, Math.min(1, opacity));
}

function _coreAnnotationDistanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (!dx && !dy) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function _coreAnnotationElementHit(el, x, y, tolerance = 10) {
  try {
    const point = new DOMPoint(x, y);
    if (typeof el.isPointInStroke === 'function' && el.isPointInStroke(point)) return true;
    if (typeof el.isPointInFill === 'function' && el.isPointInFill(point)) return true;
  } catch {}
  if (el?.tagName?.toLowerCase?.() === 'rect') {
    const rx = Number(el.getAttribute('x')) || 0;
    const ry = Number(el.getAttribute('y')) || 0;
    const rw = Number(el.getAttribute('width')) || 0;
    const rh = Number(el.getAttribute('height')) || 0;
    return x >= rx - tolerance && x <= rx + rw + tolerance && y >= ry - tolerance && y <= ry + rh + tolerance;
  }
  if (typeof el.getTotalLength === 'function' && typeof el.getPointAtLength === 'function') {
    try {
      const total = el.getTotalLength();
      const step = Math.max(4, total / 80);
      for (let pos = 0; pos <= total; pos += step) {
        const a = el.getPointAtLength(pos);
        const b = el.getPointAtLength(Math.min(total, pos + step));
        if (_coreAnnotationDistanceToSegment(x, y, a.x, a.y, b.x, b.y) <= tolerance) return true;
      }
    } catch {}
  }
  const points = (el.getAttribute('points') || '').trim().split(/\s+/)
    .map(pair => pair.split(',').map(Number))
    .filter(pair => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (b && _coreAnnotationDistanceToSegment(x, y, a[0], a[1], b[0], b[1]) <= tolerance) return true;
  }
  return false;
}

// ============================================================
// iframe内蔵メモエンジン
// ============================================================

/**
 * initIframeMarkup(): iframe内にメモオーバーレイを設置
 * 親からpostMessageでツール状態を受信し、描画結果を親に送信
 * 親側は ann-markup-sync / ann-markup-save で同期
 */
function initIframeMarkup(scrollContainer) {
  const _svgNS = 'http://www.w3.org/2000/svg';
  const _widthDefaults = { pen: 3, marker: 12, eraser: 14 };
  function _loadToolWidths() {
    try {
      const saved = JSON.parse(localStorage.getItem('meldex-ann-tool-widths') || '{}');
      return {
        pen: Math.max(1, Math.min(16, Number(saved.pen) || _widthDefaults.pen)),
        marker: Math.max(4, Math.min(40, Number(saved.marker) || _widthDefaults.marker)),
        eraser: Math.max(4, Math.min(48, Number(saved.eraser) || _widthDefaults.eraser)),
      };
    } catch { return { ..._widthDefaults }; }
  }
  let _ann = { active: false, tool: 'pen', color: '#c48080', opacity: 1, widths: _loadToolWidths(), drawing: false, path: [], pressures: [], targetPath: '' };

  // オーバーレイSVG作成
  const host = scrollContainer || document.body;
  const boardWorld = (host?.id === 'bd-canvas' || host?.dataset?.bdRole === 'canvas')
    ? (host.querySelector('[data-bd-role="world"]') || host.querySelector('#bd-world'))
    : null;
  const wrapper = boardWorld || host;
  const boardMode = !!boardWorld || wrapper?.id === 'bd-world' || wrapper?.dataset?.bdRole === 'world';
  if (host._annBridge) return host._annBridge;
  if (wrapper._annBridge) {
    if (host !== wrapper) host._annBridge = wrapper._annBridge;
    return wrapper._annBridge;
  }
  wrapper.style.position = wrapper.style.position || 'relative';
  const svg = document.createElementNS(_svgNS, 'svg');
  svg.id = 'iframe-ann-overlay';
  svg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:9999;pointer-events:none;overflow:visible;');
  const hitRect = document.createElementNS(_svgNS, 'rect');
  hitRect.setAttribute('width', '100%'); hitRect.setAttribute('height', '100%');
  hitRect.setAttribute('fill', 'transparent');
  svg.appendChild(hitRect);
  const layer = document.createElementNS(_svgNS, 'g');
  layer.id = 'iframe-ann-layer';
  svg.appendChild(layer);
  const notesLayer = document.createElement('div');
  notesLayer.className = 'ann-note-layer';
  notesLayer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:10000;';
  wrapper.appendChild(svg);
  wrapper.appendChild(notesLayer);

  // SVGサイズ更新
  let _surfaceBounds = { left: 0, top: 0, width: 1, height: 1 };
  function _computeSurfaceBounds() {
    if (!boardMode) {
      return {
        left: 0,
        top: 0,
        width: Math.max(wrapper.scrollWidth || 0, wrapper.clientWidth || 0, 1),
        height: Math.max(wrapper.scrollHeight || 0, wrapper.clientHeight || 0, 1),
      };
    }
    const viewportW = Math.max(host.clientWidth || 0, host.offsetWidth || 0, 1);
    const viewportH = Math.max(host.clientHeight || 0, host.offsetHeight || 0, 1);
    const zoom = (typeof bd !== 'undefined') ? Math.max(0.1, bd.zoom || 1) : 1;
    const panX = (typeof bd !== 'undefined') ? (Number(bd.panX) || 0) : 0;
    const panY = (typeof bd !== 'undefined') ? (Number(bd.panY) || 0) : 0;
    let visibleLeft = -panX / zoom;
    let visibleTop = -panY / zoom;
    let visibleRight = visibleLeft + viewportW / zoom;
    let visibleBottom = visibleTop + viewportH / zoom;
    if (typeof host.getBoundingClientRect === 'function') {
      try {
        const r = host.getBoundingClientRect();
        const pts = [
          _boardClientToWorld(r.left, r.top),
          _boardClientToWorld(r.right, r.top),
          _boardClientToWorld(r.right, r.bottom),
          _boardClientToWorld(r.left, r.bottom),
        ].filter(pt => Number.isFinite(pt?.x) && Number.isFinite(pt?.y));
        if (pts.length) {
          visibleLeft = Math.min(...pts.map(pt => pt.x));
          visibleTop = Math.min(...pts.map(pt => pt.y));
          visibleRight = Math.max(...pts.map(pt => pt.x));
          visibleBottom = Math.max(...pts.map(pt => pt.y));
        }
      } catch (_) {}
    }
    const pad = 256;
    const left = Math.floor(Math.min(0, visibleLeft) - pad);
    const top = Math.floor(Math.min(0, visibleTop) - pad);
    const right = Math.ceil(Math.max(wrapper.scrollWidth || 0, wrapper.clientWidth || 0, visibleRight, viewportW / zoom) + pad);
    const bottom = Math.ceil(Math.max(wrapper.scrollHeight || 0, wrapper.clientHeight || 0, visibleBottom, viewportH / zoom) + pad);
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  }
  function _applyNotePosition(note, data) {
    if (!note || !data) return;
    note.style.left = ((Number(data.x) || 0) - _surfaceBounds.left) + 'px';
    note.style.top = ((Number(data.y) || 0) - _surfaceBounds.top) + 'px';
  }
  function _boardClientToWorld(clientX, clientY) {
    const targetCanvas = host || wrapper;
    if (!targetCanvas) return { x: clientX, y: clientY };
    const local = (typeof bdClientToCanvasLocal === 'function')
      ? bdClientToCanvasLocal(clientX, clientY, targetCanvas)
      : (() => {
          const r = targetCanvas.getBoundingClientRect();
          return { x: clientX - r.left, y: clientY - r.top };
        })();
    let lx = local.x;
    let ly = local.y;
    if (typeof bd !== 'undefined' && bd.rotation) {
      const cx = targetCanvas.clientWidth / 2;
      const cy = targetCanvas.clientHeight / 2;
      lx -= cx;
      ly -= cy;
      const rad = -bd.rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = lx * cos - ly * sin;
      const ry = lx * sin + ly * cos;
      lx = rx + cx;
      ly = ry + cy;
    }
    const zoom = (typeof bd !== 'undefined') ? Math.max(0.1, bd.zoom || 1) : 1;
    const panX = (typeof bd !== 'undefined') ? (Number(bd.panX) || 0) : 0;
    const panY = (typeof bd !== 'undefined') ? (Number(bd.panY) || 0) : 0;
    return { x: (lx - panX) / zoom, y: (ly - panY) / zoom };
  }
  function _updateSize() {
    _surfaceBounds = _computeSurfaceBounds();
    svg.style.left = _surfaceBounds.left + 'px';
    svg.style.top = _surfaceBounds.top + 'px';
    svg.style.width = _surfaceBounds.width + 'px';
    svg.style.height = _surfaceBounds.height + 'px';
    svg.setAttribute('viewBox', `${_surfaceBounds.left} ${_surfaceBounds.top} ${_surfaceBounds.width} ${_surfaceBounds.height}`);
    hitRect.setAttribute('x', _surfaceBounds.left);
    hitRect.setAttribute('y', _surfaceBounds.top);
    hitRect.setAttribute('width', _surfaceBounds.width);
    hitRect.setAttribute('height', _surfaceBounds.height);
    notesLayer.style.left = _surfaceBounds.left + 'px';
    notesLayer.style.top = _surfaceBounds.top + 'px';
    notesLayer.style.width = svg.style.width;
    notesLayer.style.height = svg.style.height;
    notesLayer.querySelectorAll('.ann-note-embedded').forEach(note => _applyNotePosition(note, note._annData));
  }
  const _resizeObs = new ResizeObserver(_updateSize);
  _resizeObs.observe(wrapper);
  if (host !== wrapper) _resizeObs.observe(host);
  _updateSize();

  // 描画関数
  function _pathD(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
    return d;
  }

  function _rectData(pts) {
    const a = pts?.[0] || [0, 0], b = pts?.[pts.length - 1] || a;
    const x1 = Number(a[0]) || 0, y1 = Number(a[1]) || 0, x2 = Number(b[0]) || 0, y2 = Number(b[1]) || 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }

  function _applyRectEl(el, data, color, opacity, preview) {
    const normalizedOpacity = _normalizeMarkupOpacity(opacity, 1);
    el.setAttribute('x', Number(data?.x) || 0);
    el.setAttribute('y', Number(data?.y) || 0);
    el.setAttribute('width', Math.max(1, Number(data?.width) || 0));
    el.setAttribute('height', Math.max(1, Number(data?.height) || 0));
    el.setAttribute('fill', color);
    el.setAttribute('fill-opacity', String(normalizedOpacity * (preview ? 0.2 : 0.4)));
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', '1');
    el.setAttribute('stroke-opacity', String(normalizedOpacity));
    if (preview) el.setAttribute('stroke-dasharray', '4,4');
    else el.removeAttribute('stroke-dasharray');
    return el;
  }

  function _toLocalCoords(clientX, clientY) {
    if (boardMode) {
      return _boardClientToWorld(clientX, clientY);
    }
    const r = wrapper.getBoundingClientRect();
    return { x: clientX - r.left + wrapper.scrollLeft, y: clientY - r.top + wrapper.scrollTop };
  }

  function _postToParent(message) {
    if (typeof window !== 'undefined' && window.parent) window.parent.postMessage(message, '*');
  }

  function _drawWidth(tool, pressures, width) {
    const normalized = tool === 'stroke' ? 'pen' : tool;
    const base = Math.max(1, Number(width) || _ann.widths?.[normalized] || _widthDefaults[normalized] || 3);
    if (normalized === 'pen' && Array.isArray(pressures) && pressures.length) {
      const avg = pressures.reduce((a, b) => a + (Number(b) || 0), 0) / pressures.length;
      return Math.max(1, base * (0.5 + Math.max(0, Math.min(1, avg))));
    }
    return base;
  }

  function _normalizeMarkupOpacity(value, fallback = 1) {
    return _normalizeCoreAnnotationOpacity(value, fallback);
  }

  let _annLastSaveFailureAt = 0;
  function _reportMarkupSaveFailure(error, message = '注釈の保存に失敗しました') {
    const now = Date.now();
    if (typeof showStatus === 'function' && now - _annLastSaveFailureAt > 1500) {
      showStatus(message, true);
      _annLastSaveFailureAt = now;
    }
    try { console.warn(message, error); } catch {}
  }

  function _markupElementHit(el, x, y, tolerance = 10) {
    return _coreAnnotationElementHit(el, x, y, tolerance);
  }

  function _safeAnnotationHtml(html) {
    if (typeof _sanitizeAnnotationHtml === 'function') return _sanitizeAnnotationHtml(html);
    const template = document.createElement('template');
    template.innerHTML = html || '';
    template.content.querySelectorAll('script,style,iframe,object,embed').forEach(el => el.remove());
    template.content.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if (/^on/i.test(attr.name) || attr.name === 'href' || attr.name === 'src') el.removeAttribute(attr.name);
      });
    });
    return template.innerHTML;
  }

  function _parseMarkupAnnotationData(item, message = '一部の注釈データを読み込めませんでした') {
    const raw = item?.data;
    if (raw == null || raw === '') return {};
    if (typeof raw !== 'string') return raw || {};
    try {
      return JSON.parse(raw) || {};
    } catch (error) {
      _reportMarkupSaveFailure(error, message);
      return null;
    }
  }

  function _annotationUser() {
    if (typeof getUsername === 'function') return getUsername();
    try { return JSON.parse(localStorage.getItem('meldex-user') || '{}').name || 'anonymous'; }
    catch { return 'anonymous'; }
  }

  function _saveBoardAnnotation(payload, onSaved, onError) {
    if (!boardMode || typeof apiPost !== 'function') return false;
    apiPost('/annotations', payload).then((res) => {
      if (res?.id && typeof _pushAnnotationCreateHistory === 'function') {
        const label = payload?.shape === 'sticky' || payload?.type === 'comment' ? '注釈: 付箋追加' : '注釈: 描画追加';
        _pushAnnotationCreateHistory(res.id, label, payload?.target_path || _ann.targetPath).catch(() => {});
      }
      onSaved?.(res);
    }).catch((error) => {
      _reportMarkupSaveFailure(error);
      onError?.(error);
    });
    return true;
  }

  function _updateBoardAnnotation(annId, payload, onSaved, onError) {
    if (!boardMode || !annId || typeof apiPut !== 'function') return false;
    const handleSaved = (res) => { onSaved?.(res); };
    const handleError = (error) => {
      _reportMarkupSaveFailure(error);
      onError?.(error);
    };
    if (typeof _putAnnotationWithHistory === 'function') {
      const label = Object.prototype.hasOwnProperty.call(payload || {}, 'color') ? '注釈: 色変更' : '注釈: 付箋更新';
      Promise.resolve(_putAnnotationWithHistory(annId, payload, label, annId)).then(handleSaved).catch(handleError);
    } else {
      apiPut('/annotations/' + encodeURIComponent(annId), payload).then(handleSaved).catch(handleError);
    }
    return true;
  }

  function _deleteBoardAnnotation(annId, onDeleted, onError) {
    if (!boardMode || !annId || typeof apiDelete !== 'function') return false;
    (async () => {
      const before = typeof _fetchAnnotationHistoryRow === 'function'
        ? await _fetchAnnotationHistoryRow(annId).catch(() => null)
        : null;
      await apiDelete('/annotations/' + encodeURIComponent(annId));
      if (typeof _pushAnnotationHistory === 'function') _pushAnnotationHistory('注釈: 削除', before, null, annId);
      onDeleted?.();
    })().catch((error) => {
      _reportMarkupSaveFailure(error, '注釈を削除できませんでした');
      onError?.(error);
    });
    return true;
  }

  function _noteText(editor) {
    return (editor?.innerText || '').replace(/\u00a0/g, ' ').trimEnd();
  }

  function _notePayload(data, editor, note) {
    return {
      ...data,
      text: _noteText(editor),
      html: _safeAnnotationHtml(editor?.innerHTML || ''),
      width: Math.max(120, Math.round(note.offsetWidth || data.width || 180)),
      height: Math.max(60, Math.round(note.offsetHeight || data.height || 100)),
    };
  }

  function _applyNoteColor(note, color) {
    const next = color || '#c48080';
    note.style.background = next;
    note.style.setProperty('--ann-note-color', next);
    note.style.setProperty('--ann-note-scroll-thumb', `color-mix(in srgb, ${next} 72%, var(--bg) 28%)`);
    note.style.setProperty('--ann-note-scroll-track', `color-mix(in srgb, ${next} 22%, transparent)`);
  }

  function _userIconHtml(username) {
    if (typeof getUserAvatarHtml === 'function') return getUserAvatarHtml(username || 'anonymous', 16);
    return typeof lucide === 'function' ? lucide('userRound', 12) : esc((username || '?').charAt(0).toUpperCase());
  }

  function _syncNoteInteractivity() {
    notesLayer.style.pointerEvents = 'none';
    notesLayer.querySelectorAll('.ann-note').forEach(note => {
      note.style.pointerEvents = _ann.active ? 'auto' : 'none';
    });
  }

  function _confirmEmbeddedNoteDelete(onOk) {
    const message = 'この付箋を削除しますか？';
    if (typeof showConfirmDialog === 'function') {
      showConfirmDialog(message, onOk);
      return;
    }
    if (typeof window.confirm !== 'function' || window.confirm(message)) onOk?.();
  }

  function _createNoteEditor(data, scheduleSave, noteId) {
    const editor = document.createElement('div');
    editor.className = 'ann-note-editor';
    editor.contentEditable = 'true';
    if (noteId) editor.dataset.e2eId = `embedded-annotation-note-${noteId}-editor`;
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    if (data.html) editor.innerHTML = _safeAnnotationHtml(data.html);
    else editor.textContent = data.text || '';
    editor.addEventListener('input', scheduleSave);
    editor.addEventListener('blur', scheduleSave);
    editor.addEventListener('mouseup', () => _scheduleNoteSelectionPopup(editor, scheduleSave));
    editor.addEventListener('pointerup', () => _scheduleNoteSelectionPopup(editor, scheduleSave));
    editor.addEventListener('keyup', (event) => {
      if (event.shiftKey || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'a', 'A'].includes(event.key)) {
        _scheduleNoteSelectionPopup(editor, scheduleSave);
      }
    });
    return editor;
  }

  let _noteSelectionPopupTimer = 0;

  function _scheduleNoteSelectionPopup(editor, scheduleSave) {
    clearTimeout(_noteSelectionPopupTimer);
    _noteSelectionPopupTimer = window.setTimeout(() => _showNoteSelectionPopup(editor, scheduleSave), 40);
  }

  function _noteSelectionRange(editor) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (!root || !editor.contains(root)) return null;
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width || rect.height);
    const rect = rects[0] || range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return null;
    return { range, rect };
  }

  function _restoreNoteSelection(range) {
    const selection = window.getSelection?.();
    if (!selection || !range) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function _noteSelectionValues(range) {
    let el = range?.startContainer || null;
    if (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentElement;
    const computed = el ? getComputedStyle(el) : null;
    const queryState = command => {
      try { return !!document.queryCommandState(command); } catch { return false; }
    };
    const queryValue = command => {
      try { return document.queryCommandValue(command) || ''; } catch { return ''; }
    };
    const fontWeight = computed?.fontWeight || '';
    return {
      textColor: queryValue('foreColor') || computed?.color || '',
      fontSize: parseInt(computed?.fontSize || '', 10) || '',
      fontFamily: computed?.fontFamily || '',
      fontWeight: queryState('bold') || fontWeight === 'bold' || Number(fontWeight) >= 600 ? 'bold' : '',
      fontStyle: queryState('italic') || computed?.fontStyle === 'italic' ? 'italic' : '',
      underline: queryState('underline') || /underline/.test(computed?.textDecorationLine || computed?.textDecoration || ''),
      strike: queryState('strikeThrough') || /line-through/.test(computed?.textDecorationLine || computed?.textDecoration || ''),
    };
  }

  function _setNoteCommandState(command, enabled) {
    try {
      const current = !!document.queryCommandState(command);
      if (current !== !!enabled && typeof document.execCommand === 'function') document.execCommand(command, false, null);
    } catch {}
  }

  function _wrapNoteSelectionStyle(styles) {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    Object.entries(styles || {}).forEach(([key, value]) => {
      if (value != null && value !== '') span.style[key] = value;
    });
    if (!span.getAttribute('style')) return;
    try {
      range.surroundContents(span);
    } catch {
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
    }
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }

  function _applyNoteSelectionFormat(range, prop, value) {
    _restoreNoteSelection(range);
    if (prop === 'fontWeight') _setNoteCommandState('bold', value === 'bold');
    else if (prop === 'fontStyle') _setNoteCommandState('italic', value === 'italic');
    else if (prop === 'underline') _setNoteCommandState('underline', !!value);
    else if (prop === 'strike') _setNoteCommandState('strikeThrough', !!value);
    else if (prop === 'textColor') { try { document.execCommand('foreColor', false, value || '#333333'); } catch {} }
    else if (prop === 'fontSize') {
      const size = Number(value);
      if (Number.isFinite(size) && size > 0) _wrapNoteSelectionStyle({ fontSize: Math.max(8, Math.min(96, size)) + 'px' });
    } else if (prop === 'fontFamily' && value) {
      _wrapNoteSelectionStyle({ fontFamily: value });
    }
  }

  function _showNoteSelectionPopup(editor, scheduleSave) {
    if (typeof openFormatPopup !== 'function') return;
    const info = _noteSelectionRange(editor);
    if (!info) return;
    const savedRange = info.range.cloneRange();
    const anchor = { getBoundingClientRect: () => info.rect };
    const values = _noteSelectionValues(info.range);
    // 文字色スウォッチのコントラスト背景に付箋本体の色 (--ann-note-color) を渡す。
    const noteEl = editor.closest?.('.ann-note');
    const noteColor = noteEl
      ? (noteEl.style.getPropertyValue('--ann-note-color')
         || noteEl.style.backgroundColor
         || getComputedStyle(noteEl).backgroundColor
         || '').trim()
      : '';
    if (noteColor) values.bgColor = noteColor;
    openFormatPopup(anchor, {
      positionAnchor: anchor,
      className: 'gb-fmt-popup--annotation-note',
      fields: ['textColor', 'fontSize', 'fontFamily', 'bold', 'italic', 'strike', 'underline'],
      values,
      onChange(prop, value) {
        _applyNoteSelectionFormat(savedRange, prop, value);
        scheduleSave();
      },
    });
  }

  function _installNoteResize(note, data, persist) {
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(dir => {
      const handle = document.createElement('span');
      handle.className = 'ann-note-resize-handle';
      handle.dataset.dir = dir;
      handle.addEventListener('pointerdown', (e) => {
        if (!_ann.active) return;
        e.preventDefault();
        e.stopPropagation();
        note.classList.add('ann-note-selected');
        const startPt = _toLocalCoords(e.clientX, e.clientY);
        const start = { x: startPt.x, y: startPt.y, left: note.offsetLeft, top: note.offsetTop, width: note.offsetWidth, height: note.offsetHeight };
        const minW = 120, minH = 60;
        const onMove = (ev) => {
          const pt = _toLocalCoords(ev.clientX, ev.clientY);
          const dx = pt.x - start.x;
          const dy = pt.y - start.y;
          let left = start.left, top = start.top, width = start.width, height = start.height;
          if (dir.includes('e')) width = start.width + dx;
          if (dir.includes('s')) height = start.height + dy;
          if (dir.includes('w')) { width = start.width - dx; left = start.left + dx; }
          if (dir.includes('n')) { height = start.height - dy; top = start.top + dy; }
          if (width < minW) { if (dir.includes('w')) left -= minW - width; width = minW; }
          if (height < minH) { if (dir.includes('n')) top -= minH - height; height = minH; }
          note.style.left = left + 'px';
          note.style.top = top + 'px';
          note.style.width = width + 'px';
          note.style.height = height + 'px';
          data.x = left + _surfaceBounds.left;
          data.y = top + _surfaceBounds.top;
          data.width = Math.max(minW, Math.round(width));
          data.height = Math.max(minH, Math.round(height));
        };
        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          data.width = Math.max(minW, Math.round(note.offsetWidth));
          data.height = Math.max(minH, Math.round(note.offsetHeight));
          persist();
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
      note.appendChild(handle);
    });
  }

  function _isEmbeddedStandaloneNoteItem(item, data) {
    if (!item || data?.deleted) return false;
    const type = String(item.type || '');
    const shape = String(item.shape || data?.shape || '');
    const hasPosition = data && (data.x != null || data.y != null || data.width != null || data.height != null);
    if (type === 'comment') {
      return shape === 'sticky' || data?.noteType === 'sticky' || hasPosition;
    }
    return type === 'note' || type === 'sticky';
  }

  function _renderNote(item, data) {
    if (!data) return null;
    const note = document.createElement('div');
    note.className = 'ann-note ann-note-embedded ' + (item.shape || 'sticky');
    note.dataset.annId = item.id || '';
    note._annData = data;
    _applyNotePosition(note, data);
    note.style.width = (data.width || 180) + 'px';
    note.style.height = (data.height || 100) + 'px';
    _applyNoteColor(note, item.color || '#c48080');
    note.style.opacity = item.opacity ?? 1;
    note.style.pointerEvents = _ann.active ? 'auto' : 'none';
    note.addEventListener('pointerdown', (e) => {
      // 右クリック/中クリックが bd-canvas の pointerdown ハンドラまで伝播すると
      // ボード側の右クリックメニュー (bdContextMenu) が付箋メニューと重なって
      // 出てしまうため、付箋内のポインター押下は親へ伝播させない。
      if (e.button !== 0) e.stopPropagation();
      notesLayer.querySelectorAll('.ann-note-selected').forEach(el => el.classList.remove('ann-note-selected'));
      note.classList.add('ann-note-selected');
    });

    const header = document.createElement('div');
    header.className = 'ann-note-header';
    const dateStr = item.created ? String(item.created).substring(0, 16).replace('T', ' ') : '';
    const displayUser = (item.user && item.user !== 'anonymous') ? item.user : (data.user || (typeof getUsername === 'function' ? getUsername() : item.user || 'anonymous'));
    header.innerHTML = `<span class="ann-note-user"><span class="ann-user-icon">${_userIconHtml(displayUser)}</span><span class="ann-user-name">${esc(displayUser || '')}${dateStr ? ' ' + esc(dateStr) : ''}</span></span><span data-ann-more style="cursor:pointer;margin-left:auto;padding:0 4px;">${lucide('moreHorizontal', 12)}</span><span data-ann-delete style="cursor:pointer;">${lucide('x', 12)}</span>`;
    note.appendChild(header);

    let saveTimer = null;
    let editor = null;
    const persist = () => {
      const next = _notePayload(data, editor, note);
      Object.assign(data, next);
      if (boardMode && String(item.id || '').startsWith('pending-note-')) {
        item._pendingData = next;
        return;
      }
      if (_updateBoardAnnotation(item.id, { data: next })) return;
      _postToParent({ type: 'ann-update-note', annId: item.id, data: next });
    };
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 400);
    };
    editor = _createNoteEditor(data, scheduleSave, item.id);
    note.appendChild(editor);

    let dragState = null;
    const onHeaderDragMove = (e) => {
      if (!dragState) return;
      e.preventDefault();
      const pt = _toLocalCoords(e.clientX, e.clientY);
      data.x = dragState.x + (pt.x - dragState.startX);
      data.y = dragState.y + (pt.y - dragState.startY);
      _applyNotePosition(note, data);
    };
    const onHeaderDragEnd = () => {
      if (!dragState) return;
      dragState = null;
      document.removeEventListener('pointermove', onHeaderDragMove);
      document.removeEventListener('pointerup', onHeaderDragEnd);
      document.removeEventListener('pointercancel', onHeaderDragEnd);
      persist();
    };
    header.addEventListener('pointerdown', (e) => {
      // 削除 (x) / メニュー (…) ボタン上ではドラッグ開始しない
      if (!_ann.active || e.target.closest('[data-ann-delete],[data-ann-more]')) return;
      e.preventDefault();
      e.stopPropagation();
      const pt = _toLocalCoords(e.clientX, e.clientY);
      dragState = { startX: pt.x, startY: pt.y, x: data.x || 0, y: data.y || 0 };
      document.addEventListener('pointermove', onHeaderDragMove, { passive: false });
      document.addEventListener('pointerup', onHeaderDragEnd);
      document.addEventListener('pointercancel', onHeaderDragEnd);
    });
    _installNoteResize(note, data, persist);
    if (typeof AnnotationStickyTail !== 'undefined') {
      AnnotationStickyTail.install(note, { data, persist, getColor: () => item.color || '#c48080' });
    }

    const _deleteEmbeddedNote = () => {
      const payload = _notePayload(data, editor, note);
      payload.deleted = true;
      payload.deletedAt = new Date().toISOString();
      if (boardMode && String(item.id || '').startsWith('pending-note-')) {
        item._pendingData = payload;
        note.remove();
        return;
      }
      if (_updateBoardAnnotation(item.id, { data: payload }, () => note.remove())) return;
      note.remove();
      _postToParent({ type: 'ann-delete-note', annId: item.id, data: payload });
    };

    header.querySelector('[data-ann-delete]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _confirmEmbeddedNoteDelete(_deleteEmbeddedNote);
    });

    // ヘッダー右端の「…」ボタン: 右クリックと同じメニューを開く
    const moreBtn = header.querySelector('[data-ann-more]');
    if (moreBtn) {
      // pointerdown も止めて、ボード側のハンドラに左クリックが伝播しないようにする
      moreBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      moreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _showEmbeddedNoteContextMenu(e);
      });
    }

    // 右クリックメニュー (色変更 / フキダシしっぽ / 削除)
    function _showEmbeddedNoteContextMenu(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
      const menu = document.createElement('div');
      menu.className = '_note-ctx-menu';
      menu.style.cssText = 'position:fixed;z-index:210;background:var(--ui-popup-bg, var(--bg2));border:1px solid var(--border);border-radius:6px;padding:4px 0;box-shadow:0 4px 12px rgba(0,0,0,0.4);min-width:120px;';
      const z = (typeof window._getZoom === 'function') ? window._getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
      menu.style.left = (ev.clientX / z) + 'px';
      menu.style.top = (ev.clientY / z) + 'px';
      const hasTail = !!note.querySelector('.ann-tail,.ann-tail-shape');
      const colorItem = document.createElement('div');
      colorItem.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
      colorItem.innerHTML = (typeof window.lucide === 'function' ? window.lucide('palette', 14) : '') + ' 色を変更';
      colorItem.onmouseenter = () => { colorItem.style.background = 'var(--bg4)'; };
      colorItem.onmouseleave = () => { colorItem.style.background = ''; };
      colorItem.addEventListener('click', () => {
        menu.remove();
        if (typeof window.openColorPalette === 'function') {
          window.openColorPalette(note, item.color || '', (newColor) => {
            item.color = newColor || item.color;
            _applyNoteColor(note, item.color);
            if (boardMode && String(item.id || '').startsWith('pending-note-')) return;
            if (_updateBoardAnnotation(item.id, { color: item.color })) return;
            _postToParent({ type: 'ann-update-note', annId: item.id, color: item.color });
          });
        }
      });
      menu.appendChild(colorItem);
      const tailItem = document.createElement('div');
      tailItem.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
      tailItem.innerHTML = (typeof window.lucide === 'function' ? window.lucide('messageSquare', 14) : '') + (hasTail ? ' しっぽを削除' : ' しっぽを追加');
      tailItem.onmouseenter = () => { tailItem.style.background = 'var(--bg4)'; };
      tailItem.onmouseleave = () => { tailItem.style.background = ''; };
      tailItem.addEventListener('click', () => {
        menu.remove();
        const hasTailMod = (typeof AnnotationStickyTail !== 'undefined');
        if (hasTail) {
          // しっぽ削除: data から消し、DOM からも消す
          if (hasTailMod && note._annTailCtx) {
            delete note._annTailCtx.data.tail;
            delete note._annTailCtx.data.tailX;
            delete note._annTailCtx.data.tailY;
          }
          note.querySelectorAll(':scope > .ann-tail, :scope > .ann-tail-line, :scope > .ann-tail-shape, :scope > .ann-tail-handle').forEach(el => el.remove());
          delete data.tail;
          delete data.tailX;
          delete data.tailY;
        } else if (hasTailMod) {
          // しっぽ追加: data.tail を設定、SVG/ハンドル描画
          const w = note.offsetWidth || data.width || 180;
          const h = note.offsetHeight || data.height || 100;
          const newTail = {
            startX: w / 2,
            startY: h / 2,
            endX: w / 2,
            endY: h + 40,
            target: null,
          };
          data.tail = newTail;
          delete data.tailX;
          delete data.tailY;
          // install 済みコンテキストの data も同じ参照なので追加は届くが、念のため同期
          if (note._annTailCtx) {
            note._annTailCtx.data.tail = newTail;
            delete note._annTailCtx.data.tailX;
            delete note._annTailCtx.data.tailY;
          }
          AnnotationStickyTail.setTail(note, newTail, null);
        }
        // バックエンドへ保存 (現在の data 全体を送る)
        const payload = _notePayload(data, editor, note);
        if (item.id && !String(item.id).startsWith('pending-note-') && typeof apiPut === 'function') {
          if (!_updateBoardAnnotation(item.id, { data: payload })) {
            apiPut('/annotations/' + encodeURIComponent(item.id), { data: payload })
              .catch(error => _reportMarkupSaveFailure(error));
          }
        } else {
          item._pendingData = payload;
        }
      });
      menu.appendChild(tailItem);
      const deleteItem = document.createElement('div');
      deleteItem.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;color:var(--red);display:flex;align-items:center;gap:6px;';
      deleteItem.innerHTML = (typeof window.lucide === 'function' ? window.lucide('trash2', 14) : '') + ' 削除';
      deleteItem.onmouseenter = () => { deleteItem.style.background = 'var(--bg4)'; };
      deleteItem.onmouseleave = () => { deleteItem.style.background = ''; };
      deleteItem.addEventListener('click', () => {
        menu.remove();
        _confirmEmbeddedNoteDelete(_deleteEmbeddedNote);
      });
      menu.appendChild(deleteItem);
      document.body.appendChild(menu);
      if (typeof window.clampPopupToViewport === 'function') window.clampPopupToViewport(menu);
      setTimeout(() => document.addEventListener('pointerdown', function h(e2) {
        const inAny = [...document.querySelectorAll('._note-ctx-menu')].some(m => m.contains(e2.target));
        if (!inAny) document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
        else document.addEventListener('pointerdown', h, { once: true });
      }, { once: true }), 0);
    }
    note.addEventListener('contextmenu', _showEmbeddedNoteContextMenu);
    if (typeof window.addLongPressHandler === 'function') {
      window.addLongPressHandler(note, _showEmbeddedNoteContextMenu);
    }

    notesLayer.appendChild(note);
    return note;
  }

  // ポインターイベント
  svg.addEventListener('pointerdown', (e) => {
    if (!_ann.active) return;
    if (boardMode && e.button !== 0) return;
    _updateSize();
    if (_ann.tool === 'sticky') {
      const pt = _toLocalCoords(e.clientX, e.clientY);
      const annClientId = 'pending-note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      const noteData = { x: pt.x, y: pt.y, width: 180, height: 100, text: '', html: '', user: _annotationUser() };
      let item = null;
      let note = null;
      if (_saveBoardAnnotation({
        target_path: _ann.targetPath,
        type: 'comment',
        shape: 'sticky',
        data: noteData,
        color: _ann.color,
        opacity: _ann.opacity,
        user: _annotationUser(),
      }, (res) => {
        if (!item || !note) return;
        item.id = res?.id || item.id;
        note.dataset.annId = item.id || '';
        if (item._pendingData && item.id) _updateBoardAnnotation(item.id, { data: item._pendingData });
      }, () => { note?.remove(); })) {
        item = {
          id: annClientId,
          type: 'comment',
          shape: 'sticky',
          color: _ann.color,
          opacity: _ann.opacity,
          user: _annotationUser(),
          created: new Date().toISOString(),
        };
        note = _renderNote(item, noteData);
        return;
      }
      _postToParent({ type: 'ann-create-note', x: pt.x, y: pt.y, color: _ann.color, targetPath: _ann.targetPath, annClientId });
      return;
    }
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
