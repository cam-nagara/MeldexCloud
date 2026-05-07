/* meldex-core.part02.js */
function closeColHeaderMenu() {
  document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
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
    el.setAttribute('x', Number(data?.x) || 0);
    el.setAttribute('y', Number(data?.y) || 0);
    el.setAttribute('width', Math.max(1, Number(data?.width) || 0));
    el.setAttribute('height', Math.max(1, Number(data?.height) || 0));
    el.setAttribute('fill', color);
    el.setAttribute('fill-opacity', String((Number(opacity) || 1) * (preview ? 0.2 : 0.4)));
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', '1');
    el.setAttribute('stroke-opacity', String(Number(opacity) || 1));
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
    }).catch(onError || (() => {}));
    return true;
  }

  function _updateBoardAnnotation(annId, payload) {
    if (!boardMode || !annId || typeof apiPut !== 'function') return false;
    if (typeof _putAnnotationWithHistory === 'function') {
      const label = Object.prototype.hasOwnProperty.call(payload || {}, 'color') ? '注釈: 色変更' : '注釈: 付箋更新';
      _putAnnotationWithHistory(annId, payload, label, annId).catch(() => {});
    } else {
      apiPut('/annotations/' + encodeURIComponent(annId), payload).catch(() => {});
    }
    return true;
  }

  function _deleteBoardAnnotation(annId) {
    if (!boardMode || !annId || typeof apiDelete !== 'function') return false;
    (async () => {
      const before = typeof _fetchAnnotationHistoryRow === 'function'
        ? await _fetchAnnotationHistoryRow(annId).catch(() => null)
        : null;
      await apiDelete('/annotations/' + encodeURIComponent(annId));
      if (typeof _pushAnnotationHistory === 'function') _pushAnnotationHistory('注釈: 削除', before, null, annId);
    })().catch(() => {});
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
        const start = { x: e.clientX, y: e.clientY, left: note.offsetLeft, top: note.offsetTop, width: note.offsetWidth, height: note.offsetHeight };
        const minW = 120, minH = 60;
        const onMove = (ev) => {
          const dx = ev.clientX - start.x;
          const dy = ev.clientY - start.y;
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
      note.remove();
      const payload = _notePayload(data, editor, note);
      payload.deleted = true;
      payload.deletedAt = new Date().toISOString();
      if (boardMode && String(item.id || '').startsWith('pending-note-')) {
        item._pendingData = payload;
        return;
      }
      if (_updateBoardAnnotation(item.id, { data: payload })) return;
      _postToParent({ type: 'ann-delete-note', annId: item.id, data: payload });
    };

    header.querySelector('[data-ann-delete]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _deleteEmbeddedNote();
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
            apiPut('/annotations/' + encodeURIComponent(item.id), { data: payload }).catch(() => {});
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
        _deleteEmbeddedNote();
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
        opacity: 1,
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
          opacity: 1,
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
        const bbox = el.getBBox();
        if (x >= bbox.x - tolerance && x <= bbox.x + bbox.width + tolerance && y >= bbox.y - tolerance && y <= bbox.y + bbox.height + tolerance) {
          const annId = el.dataset.annId;
          el.remove();
          if (annId && !_deleteBoardAnnotation(annId)) _postToParent({ type: 'ann-delete', annId });
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
      preview.setAttribute('stroke-opacity', _ann.tool === 'marker' ? '0.5' : '1');
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
    })) {
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
    let el;
    if (type === 'lasso') {
      el = document.createElementNS(_svgNS, 'polygon');
      el.setAttribute('points', points.map(p => p.join(',')).join(' '));
      el.setAttribute('fill', color); el.setAttribute('fill-opacity', opacity * 0.4);
      el.setAttribute('stroke', color); el.setAttribute('stroke-width', '1');
    } else {
      el = document.createElementNS(_svgNS, 'path');
      el.setAttribute('d', _pathD(points));
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', _drawWidth(type, pressures, width));
      el.setAttribute('stroke-opacity', type === 'marker' ? '0.5' : String(opacity));
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
      svg.style.opacity = msg.opacity ?? 1;
      notesLayer.style.opacity = msg.opacity ?? 1;
    }
    if (msg.type === 'ann-set-visibility') {
      svg.style.visibility = msg.visible ? '' : 'hidden';
      notesLayer.style.visibility = msg.visible ? '' : 'hidden';
    }
    if (msg.type === 'ann-add-note') {
      const item = msg.item || {};
      const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
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
        const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
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

  function _renderStroke(type, points, pressures, color, opacity, annId) {
    let el;
    if (type === 'lasso') {
      el = document.createElementNS(_svgNS, 'polygon');
      el.setAttribute('points', points.map(p => p.join(',')).join(' '));
      el.setAttribute('fill', color); el.setAttribute('fill-opacity', opacity * 0.4);
      el.setAttribute('stroke', color); el.setAttribute('stroke-width', '1');
    } else {
      el = document.createElementNS(_svgNS, 'path');
      el.setAttribute('d', _pathD(points));
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', color);
      const isPen = type === 'stroke';
      if (isPen && pressures.length > 0) {
