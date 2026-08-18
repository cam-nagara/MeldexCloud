// Audit-P2 H-7: document キャプチャで UI 要素の click/change をガードする
// スクロールコンテナ内のインタラクティブ要素のみ対象（タブバー・ヘッダー等は除外）。
if (typeof ViewLock !== 'undefined' && typeof ViewLock.installInteractionInterceptor === 'function') {
  try {
    ViewLock.installInteractionInterceptor(
      () => _getActiveViewLockInfo(),
      () => (typeof state !== 'undefined' && typeof _getScrollContainerForView === 'function')
        ? _getScrollContainerForView(state.view)
        : null,
    );
  } catch (_) {}
}
// 消しゴム
async function eraseAtPoint(cx, cy) {
  const pt = _toContentCoords(cx, cy);
  const x = pt.x, y = pt.y;
  // SVG要素をヒットテスト
  const layer = document.getElementById('ann-layer') || annOverlay;
  const els = Array.from(layer.querySelectorAll('path, polygon, rect')).reverse();
  const tolerance = Math.max(8, ann.widths?.eraser || _ANN_WIDTH_LIMITS.eraser.fallback);
  for (const el of els) {
    if (el.classList.contains('ann-preview')) continue;
    if (_annElementHit(el, x, y, tolerance)) {
      const annId = el.dataset.annId;
      if (annId) {
        try {
          const before = await _fetchAnnotationHistoryRow(annId).catch(() => null);
          await apiDelete('/annotations/' + encodeURIComponent(annId));
          _pushAnnotationHistory('注釈: 消しゴム削除', before, null, annId);
        } catch {
          showStatus('削除に失敗', true);
          return;
        }
      }
      el.remove();
      _markAnnotationMutated(ann.targetPath);
      showStatus('削除しました');
      return;
    }
  }
}

// 付箋/コメント作成
async function createNote(cx, cy, shape) {
  const pt = _toContentCoords(cx, cy);
  const x = pt.x, y = pt.y;
  const targetPath = _resolveAnnotationWriteTarget();
  if (!targetPath) {
    showStatus('注釈の保存先が見つかりません', true);
    return;
  }

  const noteData = { x, y, width: 180, height: 100, text: '', html: '', user: getUsername() };
  try {
    const res = await apiPost('/annotations', {
      target_path: targetPath,
      type: 'comment',
      shape,
      data: noteData,
      color: ann.color,
      opacity: ann.opacity,
      user: getUsername(),
    });
    renderNote(res.id, shape, noteData, ann.color, ann.opacity, getUsername(), res.created);
    _setAnnotationRenderedTarget(targetPath);
    _markAnnotationMutated(targetPath);
    _pushAnnotationCreateHistory(res.id, '注釈: 付箋追加', targetPath).catch(() => {});
  } catch(e) { showStatus('付箋作成に失敗', true); }
}

function _annotationNoteUserName(user, data) {
  const local = (typeof getUsername === 'function') ? getUsername() : '';
  const saved = data?.user || '';
  if (user && user !== 'anonymous') return user;
  if (saved && saved !== 'anonymous') return saved;
  return local && local !== 'anonymous' ? local : (user || saved || 'anonymous');
}

function _annotationUserIconNode(username) {
  const wrap = document.createElement('span');
  wrap.className = 'ann-user-icon';
  if (typeof getUserAvatarHtml === 'function') {
    wrap.innerHTML = getUserAvatarHtml(username || 'anonymous', 16);
  } else if (typeof lucide === 'function') {
    wrap.innerHTML = lucide('userRound', 12);
  } else {
    wrap.textContent = (username || '?').charAt(0).toUpperCase();
  }
  return wrap;
}

function _annotationReadableTextFromEditor(editor) {
  return (editor?.innerText || '').replace(/\u00a0/g, ' ').trimEnd();
}

function _sanitizeAnnotationHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = html || '';
  const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'FONT', 'BR', 'DIV', 'P']);
  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    const tag = node.tagName;
    if (!allowed.has(tag)) {
      const frag = document.createDocumentFragment();
      node.childNodes.forEach(child => frag.appendChild(cleanNode(child)));
      return frag;
    }
    const out = document.createElement(tag === 'STRIKE' ? 's' : tag === 'FONT' ? 'span' : tag.toLowerCase());
    if (tag === 'SPAN' || tag === 'FONT') {
      const color = node.style?.color || node.getAttribute('color') || '';
      if (/^(#[0-9a-f]{3,8}|rgb[a]?\(|hsl[a]?\()/i.test(color)) out.style.color = color;
      const fontSize = node.style?.fontSize || '';
      if (/^\d{1,3}(\.\d{1,2})?px$/i.test(fontSize)) out.style.fontSize = fontSize;
      const fontFamily = node.style?.fontFamily || '';
      if (fontFamily && fontFamily.length < 120 && /^[\w\s"',.\-\u3040-\u30ff\u3400-\u9fff]+$/.test(fontFamily)) out.style.fontFamily = fontFamily;
      const fontWeight = node.style?.fontWeight || '';
      if (/^(bold|normal|[1-9]00)$/i.test(fontWeight)) out.style.fontWeight = fontWeight;
      const fontStyle = node.style?.fontStyle || '';
      if (/^(italic|normal)$/i.test(fontStyle)) out.style.fontStyle = fontStyle;
      const textDecoration = node.style?.textDecoration || '';
      if (/underline|line-through/i.test(textDecoration)) out.style.textDecoration = textDecoration;
      const textDecorationColor = node.style?.textDecorationColor || '';
      if (/^(#[0-9a-f]{3,8}|rgb[a]?\(|hsl[a]?\()/i.test(textDecorationColor)) out.style.textDecorationColor = textDecorationColor;
      const bg = node.style?.backgroundColor || '';
      if (/^(#[0-9a-f]{3,8}|rgb[a]?\(|hsl[a]?\()/i.test(bg)) out.style.backgroundColor = bg;
      const strokeColor = node.style?.webkitTextStrokeColor || node.style?.textStrokeColor || '';
      if (/^(#[0-9a-f]{3,8}|rgb[a]?\(|hsl[a]?\()/i.test(strokeColor)) out.style.webkitTextStrokeColor = strokeColor;
      const strokeWidth = node.style?.webkitTextStrokeWidth || '';
      if (/^\d{1,2}(\.\d{1,2})?px$/i.test(strokeWidth)) out.style.webkitTextStrokeWidth = strokeWidth;
      if (out.style.webkitTextStrokeColor || out.style.webkitTextStrokeWidth) out.style.paintOrder = 'stroke fill';
      const boxShadow = node.style?.boxShadow || '';
      const safeShadow = /inset/i.test(boxShadow)
        && /\d{1,2}px/i.test(boxShadow)
        && /(currentcolor|#[0-9a-f]{3,8}|rgb[a]?\(|hsl[a]?\()/i.test(boxShadow)
        && !/[;{}]|url\(|expression\(/i.test(boxShadow);
      if (safeShadow) {
        out.style.boxShadow = boxShadow;
        out.style.paddingLeft = node.style?.paddingLeft || '6px';
      }
    }
    node.childNodes.forEach(child => out.appendChild(cleanNode(child)));
    return out;
  };
  const out = document.createElement('div');
  template.content.childNodes.forEach(child => out.appendChild(cleanNode(child)));
  return out.innerHTML;
}

function _annotationNotePayload(data, editor, note) {
  const html = _sanitizeAnnotationHtml(editor?.innerHTML || '');
  const text = _annotationReadableTextFromEditor(editor);
  const persistedData = { ...(data || {}) };
  delete persistedData._desktop;
  return {
    ...persistedData,
    text,
    html,
    width: Math.max(120, Math.round(note.offsetWidth || parseFloat(note.style.width) || data.width || 180)),
    height: Math.max(60, Math.round(note.offsetHeight || parseFloat(note.style.height) || data.height || 100)),
  };
}

function _applyAnnotationNoteColor(note, color) {
  const next = color || '#c48080';
  note.style.background = next;
  note.style.setProperty('--ann-note-color', next);
  note.style.setProperty('--ann-note-scroll-thumb', `color-mix(in srgb, ${next} 72%, var(--bg) 28%)`);
  note.style.setProperty('--ann-note-scroll-track', `color-mix(in srgb, ${next} 22%, transparent)`);
  note.querySelectorAll('.ann-tail-line line, .ann-tail-line polygon').forEach(el => {
    el.setAttribute('stroke', next);
    el.setAttribute('fill', next);
  });
}

function _createAnnotationEditor(data, scheduleSave, noteId) {
  const editor = document.createElement('div');
  editor.className = 'ann-note-editor';
  editor.contentEditable = 'true';
  if (noteId) editor.dataset.e2eId = `annotation-note-${noteId}-editor`;
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-multiline', 'true');
  if (data.html) editor.innerHTML = _sanitizeAnnotationHtml(data.html);
  else editor.textContent = data.text || '';
  editor.addEventListener('input', scheduleSave);
  editor.addEventListener('blur', scheduleSave);
  editor.addEventListener('mouseup', () => _scheduleAnnotationSelectionPopup(editor, scheduleSave));
  editor.addEventListener('pointerup', () => _scheduleAnnotationSelectionPopup(editor, scheduleSave));
  editor.addEventListener('keyup', (event) => {
    if (event.shiftKey || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'a', 'A'].includes(event.key)) {
      _scheduleAnnotationSelectionPopup(editor, scheduleSave);
    }
  });
  return editor;
}

let _annSelectionPopupTimer = 0;

function _scheduleAnnotationSelectionPopup(editor, scheduleSave) {
  clearTimeout(_annSelectionPopupTimer);
  _annSelectionPopupTimer = window.setTimeout(() => _showAnnotationSelectionPopup(editor, scheduleSave), 40);
}

function _getAnnotationSelectionRange(editor) {
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
  const avoidRect = rects.length
    ? rects.reduce((acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
      width: Math.max(acc.right, r.right) - Math.min(acc.left, r.left),
      height: Math.max(acc.bottom, r.bottom) - Math.min(acc.top, r.top),
    }), {
      left: rects[0].left,
      top: rects[0].top,
      right: rects[0].right,
      bottom: rects[0].bottom,
      width: rects[0].width,
      height: rects[0].height,
    })
    : rect;
  return { range, rect, avoidRect };
}

function _annotationSelectionElement(range) {
  let node = range?.startContainer || null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  return node || null;
}

function _queryAnnotationSelectionValues(range) {
  const el = _annotationSelectionElement(range);
  const computed = el ? getComputedStyle(el) : null;
  const queryState = (command) => {
    try { return !!document.queryCommandState(command); } catch { return false; }
  };
  const queryValue = (command) => {
    try { return document.queryCommandValue(command) || ''; } catch { return ''; }
  };
  const fontWeight = computed?.fontWeight || '';
  return {
    textColor: queryValue('foreColor') || computed?.color || '',
    fontSize: parseInt(computed?.fontSize || '', 10) || '',
    fontFamily: computed?.fontFamily || '',
    fontWeight: queryState('bold') || fontWeight === 'bold' || Number(fontWeight) >= 600 ? 'bold' : '',
    fontStyle: queryState('italic') || computed?.fontStyle === 'italic' ? 'italic' : '',
    bgColor: computed && !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(computed.backgroundColor || '') ? computed.backgroundColor : '',
    textStrokeColor: computed?.webkitTextStrokeColor || '',
    textStrokeWidth: parseInt(computed?.webkitTextStrokeWidth || '', 10) || 0,
    leftAccent: /inset/i.test(computed?.boxShadow || ''),
    underline: queryState('underline') || /underline/.test(computed?.textDecorationLine || computed?.textDecoration || ''),
    accentColor: computed?.textDecorationColor || '',
    strike: queryState('strikeThrough') || /line-through/.test(computed?.textDecorationLine || computed?.textDecoration || ''),
  };
}

function _restoreAnnotationSelection(range) {
  if (!range) return;
  const selection = window.getSelection?.();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function _setAnnotationCommandState(command, enabled) {
  try {
    const current = !!document.queryCommandState(command);
    if (current !== !!enabled && typeof document.execCommand === 'function') {
      document.execCommand(command, false, null);
    }
  } catch {}
}

function _wrapAnnotationSelectionStyle(styles) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const entries = Object.entries(styles || {});
  const clearKeys = entries.filter(([, value]) => value === '').map(([key]) => key);
  if (clearKeys.length) {
    _clearAnnotationSelectionStyles(range, clearKeys);
  }
  const setEntries = entries.filter(([, value]) => value != null && value !== '');
  if (!setEntries.length) return;
  const span = document.createElement('span');
  setEntries.forEach(([key, value]) => { span.style[key] = value; });
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

function _clearAnnotationSelectionStyles(range, styleKeys) {
  if (!range || !styleKeys?.length) return;
  const roots = new Set();
  const addElement = node => {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (el) roots.add(el);
  };
  addElement(range.startContainer);
  addElement(range.endContainer);
  const common = range.commonAncestorContainer?.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer?.parentElement;
  if (common) {
    const walker = document.createTreeWalker(common, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      try {
        if (range.intersectsNode(el)) roots.add(el);
      } catch {}
    }
  }
  roots.forEach(el => {
    styleKeys.forEach(key => { try { el.style[key] = ''; } catch {} });
    if (!el.getAttribute('style')) el.removeAttribute('style');
  });
}

function _applyAnnotationSelectionFormat(range, prop, value) {
  _restoreAnnotationSelection(range);
  if (prop === 'fontWeight') {
    _setAnnotationCommandState('bold', value === 'bold');
  } else if (prop === 'fontStyle') {
    _setAnnotationCommandState('italic', value === 'italic');
  } else if (prop === 'underline') {
    _setAnnotationCommandState('underline', !!value);
  } else if (prop === 'strike') {
    _setAnnotationCommandState('strikeThrough', !!value);
  } else if (prop === 'textColor') {
    const color = value || '#333333';
    try { document.execCommand('foreColor', false, color); } catch {}
  } else if (prop === 'bgColor') {
    _wrapAnnotationSelectionStyle({ backgroundColor: value || '' });
  } else if (prop === 'textStrokeColor') {
    _wrapAnnotationSelectionStyle({ webkitTextStrokeColor: value || '', paintOrder: value ? 'stroke fill' : '' });
  } else if (prop === 'textStrokeWidth') {
    const size = Number(value);
    _wrapAnnotationSelectionStyle({ webkitTextStrokeWidth: Number.isFinite(size) && size >= 0 ? size + 'px' : '' });
  } else if (prop === 'leftAccent') {
    _wrapAnnotationSelectionStyle(value ? { boxShadow: 'inset 3px 0 0 currentColor', paddingLeft: '6px' } : { boxShadow: '', paddingLeft: '' });
  } else if (prop === 'accentColor') {
    _wrapAnnotationSelectionStyle({ textDecorationColor: value || '' });
  } else if (prop === 'fontSize') {
    const size = Number(value);
    if (Number.isFinite(size) && size > 0) _wrapAnnotationSelectionStyle({ fontSize: Math.max(8, Math.min(96, size)) + 'px' });
  } else if (prop === 'fontFamily') {
    if (value) _wrapAnnotationSelectionStyle({ fontFamily: value });
  }
}

function _showAnnotationSelectionPopup(editor, scheduleSave) {
  if (typeof openFormatPopup !== 'function') return;
  const selectionInfo = _getAnnotationSelectionRange(editor);
  if (!selectionInfo) return;
  const savedRange = selectionInfo.range.cloneRange();
  const anchor = { getBoundingClientRect: () => selectionInfo.rect };
  const values = _queryAnnotationSelectionValues(selectionInfo.range);
  // 文字色スウォッチは values.bgColor をコントラスト背景として使う。
  // 付箋では選択範囲自体には背景が付かないことが多いため、
  // 付箋本体の色 (--ann-note-color) で上書きして実際に見える背景と一致させる。
  const noteEl = editor.closest?.('.ann-note');
  const noteColor = noteEl ? (noteEl.style.getPropertyValue('--ann-note-color') || noteEl.style.backgroundColor || '').trim() : '';
  if (noteColor) values.bgColor = noteColor;
  openFormatPopup(anchor, {
    positionAnchor: anchor,
    className: 'gb-fmt-popup--annotation-note',
    fields: ['textColor', 'fontSize', 'fontFamily', 'bold', 'italic', 'bgColor', 'leftAccent', 'accentColor', 'strike', 'underline'],
    values,
    avoidRect: selectionInfo.avoidRect,
    onChange(prop, value) {
      _applyAnnotationSelectionFormat(savedRange, prop, value);
      scheduleSave();
    },
  });
}

function _contentCoordsFromNoteOffset(note) {
  let cx = note.offsetLeft;
  let cy = note.offsetTop;
  if (_annScrollContainer && !_isIframeView(state.view)) {
    cx += _annScrollContainer.scrollLeft;
    cy += _annScrollContainer.scrollTop;
  }
  return { x: cx, y: cy };
}

function _installAnnotationNoteResize(note, data, persist) {
  const dirs = (_isTrayAnnotationHost() && data?._desktop)
    ? ['se']
    : ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  dirs.forEach(dir => {
    const handle = document.createElement('span');
    handle.className = 'ann-note-resize-handle';
    handle.dataset.dir = dir;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      note.classList.add('ann-note-selected');
      const start = {
        x: e.clientX,
        y: e.clientY,
        left: note.offsetLeft,
        top: note.offsetTop,
        width: note.offsetWidth,
        height: note.offsetHeight,
      };
      const minW = 120;
      const minH = 60;
      const onMove = (ev) => {
        const zoom = _annotationUiZoom();
        const dx = (ev.clientX - start.x) / zoom;
        const dy = (ev.clientY - start.y) / zoom;
        let left = start.left;
        let top = start.top;
        let width = start.width;
        let height = start.height;
        if (dir.includes('e')) width = start.width + dx;
        if (dir.includes('s')) height = start.height + dy;
        if (dir.includes('w')) { width = start.width - dx; left = start.left + dx; }
        if (dir.includes('n')) { height = start.height - dy; top = start.top + dy; }
        if (width < minW) {
          if (dir.includes('w')) left -= minW - width;
          width = minW;
        }
        if (height < minH) {
          if (dir.includes('n')) top -= minH - height;
          height = minH;
        }
        note.style.left = left + 'px';
        note.style.top = top + 'px';
        note.style.width = width + 'px';
        note.style.height = height + 'px';
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        const pos = _contentCoordsFromNoteOffset(note);
        data.x = pos.x;
        data.y = pos.y;
        data.width = Math.max(minW, Math.round(note.offsetWidth));
        data.height = Math.max(minH, Math.round(note.offsetHeight));
        note.dataset.baseX = String(data.x);
        note.dataset.baseY = String(data.y);
        persist();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    note.appendChild(handle);
  });
}

// フキダシのしっぽを追加（ドラッグで位置調整可能）
function addNoteTail(note, annId, data, initTailX, initTailY) {
  if (typeof AnnotationStickyTail === 'undefined' || typeof AnnotationStickyTail.setTail !== 'function') return;
  AnnotationStickyTail.setTail(note, {
    startX: (note.offsetWidth || data.width || 180) / 2,
    startY: (note.offsetHeight || data.height || 100) / 2,
    endX: Number(initTailX) + 5,
    endY: Number(initTailY) + 5,
    target: null,
  }, () => {
    const editor = note.querySelector('.ann-note-editor');
    _putAnnotationWithHistory(annId, { data: _annotationNotePayload(data, editor, note) }, '注釈: 付箋更新', annId)
      .catch(error => _reportAnnotationSaveFailure(error));
  });
}

let _annLastSaveFailureAt = 0;
function _reportAnnotationSaveFailure(error, message = '注釈の保存に失敗しました') {
  const now = Date.now();
  if (typeof showStatus === 'function' && now - _annLastSaveFailureAt > 1500) {
    showStatus(message, true);
    _annLastSaveFailureAt = now;
  }
  try { console.warn(message, error); } catch {}
}

function _isStandaloneAnnotationNoteItem(item, data) {
  if (!item || data?.deleted) return false;
  const type = String(item.type || '');
  const shape = String(item.shape || data?.shape || '');
  const hasPosition = data && (data.x != null || data.y != null || data.width != null || data.height != null);
  if (type === 'comment') {
    return shape === 'sticky' || data?.noteType === 'sticky' || hasPosition;
  }
  return type === 'note' || type === 'sticky';
}

function _trayAnnotationData(item, parsedData) {
  const data = { ...(parsedData || {}) };
  data.x = 0;
  data.y = 0;
  data.width = Math.max(120, Number(item?.width) || Number(data.width) || 250);
  data.height = Math.max(60, Number(item?.height) || Number(data.height) || 200);
  data._desktop = {
    x: Number(item?.desktop_x) || 0,
    y: Number(item?.desktop_y) || 0,
    width: data.width,
    height: data.height,
    monitorId: String(item?.monitor_id || ''),
    monitorW: Number(item?.monitor_w) || 0,
    monitorH: Number(item?.monitor_h) || 0,
    alwaysOnTop: item?.always_on_top !== 0,
    zOrder: Number(item?.z_order) || 0,
    collapsed: !!item?.collapsed,
  };
  return data;
}

function _trayAnnotationUpdateBody(data, payload) {
  if (!_isTrayAnnotationHost() || !data?._desktop) return { data: payload };
  const desktop = data._desktop;
  desktop.width = payload.width;
  desktop.height = payload.height;
  return {
    data: payload,
    body: payload.text || '',
    desktop_x: Math.round(Number(desktop.x) || 0),
    desktop_y: Math.round(Number(desktop.y) || 0),
    width: Math.round(Number(desktop.width) || 250),
    height: Math.round(Number(desktop.height) || 200),
    monitor_id: desktop.monitorId || '',
    monitor_w: Math.round(Number(desktop.monitorW) || 0),
    monitor_h: Math.round(Number(desktop.monitorH) || 0),
    always_on_top: desktop.alwaysOnTop ? 1 : 0,
    z_order: Math.round(Number(desktop.zOrder) || 0),
    collapsed: desktop.collapsed ? 1 : 0,
  };
}

function _trayAnnotationBridgeCall(method, ...args) {
  if (!_isTrayAnnotationHost()) return Promise.resolve(false);
  try {
    const fn = window.pywebview?.api?.[method];
    if (typeof fn === 'function') return Promise.resolve(fn(...args)).catch(() => false);
  } catch {}
  return Promise.resolve(false);
}

function renderNote(id, shape, data, color, opacity, user, created) {
  // v5.0: 付箋は現在の注釈ホスト（アクティブなペイン）に配置する
  const mainArea = _getStandaloneAnnotationHost();
  const note = document.createElement('div');
  note.className = 'ann-note ' + shape;
  note.dataset.annId = id;
  note.dataset.e2eId = `annotation-note-${id}`;
  note._annData = data;
  // 座標欠落時のフォールバック（NaNpx 防止）
  const isTrayHostNote = _isTrayAnnotationHost() && String(id) === _trayAnnotationHost.annotationId;
  const baseX = isTrayHostNote ? 0 : (Number.isFinite(data.x) ? data.x : 0);
  const baseY = isTrayHostNote ? 0 : (Number.isFinite(data.y) ? data.y : 0);
  note.dataset.baseY = baseY; // スクロール同期用の基準Y
  note.draggable = true;
  note.addEventListener('dragstart', (e) => {
    const text = data.text || '付箋注釈';
    e.dataTransfer.setData('text/plain', '[注釈: ' + text.substring(0, 30) + '](annotation:' + id + ')');
    e.dataTransfer.setData('application/x-annotation', JSON.stringify({ id, text, shape }));
  });
  note.dataset.baseX = baseX;
  // スクロール分を引いて画面上の位置を計算
  const scrollY = (_annScrollContainer && !_isIframeView(state.view)) ? _annScrollContainer.scrollTop : 0;
  const scrollX = (_annScrollContainer && !_isIframeView(state.view)) ? _annScrollContainer.scrollLeft : 0;
  note.style.left = (baseX - scrollX) + 'px';
  note.style.top = (baseY - scrollY) + 'px';
  note.style.width = (data.width || 180) + 'px';
  note.style.height = (data.height || 100) + 'px';
  if (isTrayHostNote) {
    note.dataset.annotationTrayNote = '1';
    note.style.boxSizing = 'border-box';
  }
  _applyAnnotationNoteColor(note, color);
  note.style.opacity = String(_normalizeAnnotationOpacity(opacity, 1));
  note.addEventListener('pointerdown', () => {
    document.querySelectorAll('.ann-note-selected').forEach(el => el.classList.remove('ann-note-selected'));
    note.classList.add('ann-note-selected');
  });

  // ヘッダー（ユーザー名・日時・削除ボタン）
  const header = document.createElement('div');
  header.className = 'ann-note-header';
  const dateStr = created ? created.substring(0, 16).replace('T', ' ') : '';
  const headerLabel = document.createElement('span');
  headerLabel.className = 'ann-note-user';
  const displayUser = _annotationNoteUserName(user, data);
  headerLabel.appendChild(_annotationUserIconNode(displayUser));
  const userText = document.createElement('span');
  userText.className = 'ann-user-name';
  userText.textContent = `${displayUser || ''}${dateStr ? ' ' + dateStr : ''}`.trim();
  headerLabel.appendChild(userText);
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'ann-note-delete-btn';
  deleteBtn.dataset.annDelete = '1';
  deleteBtn.dataset.e2eId = `annotation-note-${id}-delete`;
  deleteBtn.setAttribute('aria-label', '注釈を削除');
  deleteBtn.title = '削除';
  deleteBtn.innerHTML = lucide('x', 12);
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    deleteNote(id, note, { data, editor });
  });
  header.appendChild(headerLabel);
  header.appendChild(deleteBtn);
  note.appendChild(header);

  let editor;
  let saveTimer;
  const cancelPendingSave = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
  };
  note._annCancelPendingSave = cancelPendingSave;
  const persist = () => {
    if (note.dataset.deleted === '1') return Promise.resolve(false);
    const d = _annotationNotePayload(data, editor, note);
    data.text = d.text;
    data.html = d.html;
    data.width = d.width;
    data.height = d.height;
    if (isTrayHostNote && data._desktop) {
      _trayAnnotationBridgeCall('tray_annotation_resize', d.width, d.height);
    }
    return _putAnnotationWithHistory(id, _trayAnnotationUpdateBody(data, d), '注釈: 付箋更新', id)
      .catch(error => {
        _reportAnnotationSaveFailure(error);
        return false;
      });
  };
  const scheduleSave = () => {
    cancelPendingSave();
    saveTimer = setTimeout(persist, 600);
  };
  editor = _createAnnotationEditor(data, scheduleSave, id);
  note.appendChild(editor);

  // ドラッグ移動
  let dragging = false, dragOff = { x: 0, y: 0 };
  let trayDragStart = null;
  const pointerCssPos = (ev) => {
    const z = (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
    return { x: ev.clientX / z, y: ev.clientY / z };
  };
  const onDragMove = (ev) => {
    if (!dragging) return;
    ev.preventDefault();
    if (isTrayHostNote && data._desktop && trayDragStart) {
      data._desktop.x = trayDragStart.x + (ev.screenX - trayDragStart.screenX);
      data._desktop.y = trayDragStart.y + (ev.screenY - trayDragStart.screenY);
      _trayAnnotationBridgeCall('tray_annotation_move', data._desktop.x, data._desktop.y);
      return;
    }
    const pt = pointerCssPos(ev);
    note.style.left = (pt.x - dragOff.x) + 'px';
    note.style.top = (pt.y - dragOff.y) + 'px';
  };
  const onDragEnd = () => {
    if (!dragging) return;
    dragging = false;
    note.draggable = true;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);
    if (isTrayHostNote && data._desktop) {
      trayDragStart = null;
    } else {
      const pos = _contentCoordsFromNoteOffset(note);
      data.x = pos.x;
      data.y = pos.y;
      note.dataset.baseX = String(pos.x);
      note.dataset.baseY = String(pos.y);
    }
    persist();
  };
  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-action],[data-ann-delete]')) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    note.draggable = false;
    if (isTrayHostNote && data._desktop) {
      trayDragStart = {
        screenX: e.screenX,
        screenY: e.screenY,
        x: Number(data._desktop.x) || 0,
        y: Number(data._desktop.y) || 0,
      };
    }
    const pt = pointerCssPos(e);
    dragOff.x = pt.x - note.offsetLeft;
    dragOff.y = pt.y - note.offsetTop;
    document.addEventListener('pointermove', onDragMove, { passive: false });
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  });

  _installAnnotationNoteResize(note, data, persist);
  if (typeof AnnotationStickyTail !== 'undefined') {
    AnnotationStickyTail.install(note, { data, persist, getColor: () => color });
  }

  // フキダシのしっぽ復元（保存データにtailがあれば）
  if (typeof AnnotationStickyTail === 'undefined' && data.tailX !== undefined && data.tailY !== undefined) {
    addNoteTail(note, id, data, data.tailX, data.tailY);
  }

  // 右クリックメニュー（色変更・フキダシしっぽ・削除）
  function _showAnnotationNoteContextMenu(e, noteEl) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
    const restoreTarget = e?.currentTarget instanceof HTMLElement ? e.currentTarget : null;
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu _note-ctx-menu annotation-note-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '注釈付箋メニュー');
    menu.style.position = 'fixed';
    menu.style.zIndex = '210';
    const hasTail = !!noteEl.querySelector('.ann-tail,.ann-tail-shape');
    let closeTimer = 0;
    let tailOpen = false;

    const removeMenus = () => document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
    const menuItems = (root) => [...root.querySelectorAll('button.gb-context-menu-item:not(.disabled)')];
    const focusMenuItem = (items, index) => {
      if (!items.length) return;
      const next = ((index % items.length) + items.length) % items.length;
      items[next].focus();
    };
    const closeMenu = (restoreFocus = false) => {
      clearTimeout(closeTimer);
      document.removeEventListener('pointerdown', onGlobalPointerDown, true);
      document.removeEventListener('keydown', onGlobalKeyDown, true);
      tailTrig?.setAttribute('aria-expanded', 'false');
      removeMenus();
      if (restoreFocus && restoreTarget?.isConnected) restoreTarget.focus?.();
    };
    const hideTailPanel = () => {
      clearTimeout(closeTimer);
      tailOpen = false;
      tailTrig.setAttribute('aria-expanded', 'false');
      tailPanel.hidden = true;
      tailPanel.style.display = 'none';
    };
    const showTailPanel = () => {
      clearTimeout(closeTimer);
      if (!tailPanel.isConnected) document.body.appendChild(tailPanel);
      tailOpen = true;
      tailTrig.setAttribute('aria-expanded', 'true');
      tailPanel.hidden = false;
      tailPanel.style.display = 'block';
      if (typeof positionPopup === 'function') {
        positionPopup(tailPanel, tailTrig.getBoundingClientRect(), { prefer: 'right', gap: 2, avoidRect: menu.getBoundingClientRect() });
      } else {
        const rect = tailTrig.getBoundingClientRect();
        tailPanel.style.left = rect.right + 2 + 'px';
        tailPanel.style.top = rect.top + 'px';
        if (typeof clampPopupToViewport === 'function') clampPopupToViewport(tailPanel);
      }
    };
    const scheduleTailClose = () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (!tailPanel.matches(':hover') && !tailTrig.matches(':hover') && !tailPanel.contains(document.activeElement)) hideTailPanel();
      }, 140);
    };
    function onGlobalPointerDown(ev) {
      const inMenu = menu.contains(ev.target) || tailPanel.contains(ev.target);
      if (!inMenu) closeMenu(false);
    }
    function onGlobalKeyDown(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu(true);
      }
    }
    const handleMenuKeydown = (ev, root, onArrowLeft = null) => {
      const items = menuItems(root);
      const currentIndex = items.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        focusMenuItem(items, currentIndex + 1);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        focusMenuItem(items, currentIndex - 1);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        focusMenuItem(items, 0);
      } else if (ev.key === 'End') {
        ev.preventDefault();
        focusMenuItem(items, items.length - 1);
      } else if (ev.key === 'ArrowLeft' && onArrowLeft) {
        ev.preventDefault();
        onArrowLeft();
      }
    };
    const createMenuButton = ({ label, icon, action, danger = false, role = 'menuitem', checked = null }) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-context-menu-item' + (danger ? ' danger' : '');
      item.dataset.action = action;
      item.setAttribute('role', role);
      if (checked != null) item.setAttribute('aria-checked', checked ? 'true' : 'false');
      const iconSlot = document.createElement('span');
      iconSlot.className = 'menu-icon';
      iconSlot.setAttribute('aria-hidden', 'true');
      iconSlot.innerHTML = icon ? lucide(icon, 16) : (checked ? lucide('check', 16) : '');
      const labelSlot = document.createElement('span');
      labelSlot.textContent = label;
      item.appendChild(iconSlot);
      item.appendChild(labelSlot);
      return item;
    };

    const colorItem = createMenuButton({ label: '色を変更', icon: 'palette', action: 'color' });
    menu.appendChild(colorItem);

    // フキダシのしっぽ サブメニュー
    const tailTrig = createMenuButton({ label: 'フキダシのしっぽ', icon: 'messageSquare', action: 'tail' });
    tailTrig.classList.add('has-submenu');
    tailTrig.setAttribute('aria-haspopup', 'menu');
    tailTrig.setAttribute('aria-expanded', 'false');
    const tailPanel = document.createElement('div');
    tailPanel.className = 'gb-context-menu _note-ctx-menu annotation-note-tail-menu';
    tailPanel.setAttribute('role', 'menu');
    tailPanel.setAttribute('aria-label', 'フキダシのしっぽ');
    tailPanel.hidden = true;
    tailPanel.style.position = 'fixed';
    tailPanel.style.zIndex = '211';
    tailPanel.style.display = 'none';
    [['追加する', false], ['削除する', true]].forEach(([label, isRemove]) => {
      const si = createMenuButton({ label, action: isRemove ? 'tail-remove' : 'tail-add', role: 'menuitemradio', checked: hasTail === isRemove });
      si.addEventListener('click', () => {
        closeMenu(false);
        if (isRemove) {
          if (typeof AnnotationStickyTail !== 'undefined') AnnotationStickyTail.removeTail(noteEl, null);
          noteEl.querySelectorAll('.ann-tail, .ann-tail-line, .ann-tail-shape, .ann-tail-handle').forEach(el => el.remove());
          delete data.tail;
          delete data.tailX;
          delete data.tailY;
          _putAnnotationWithHistory(id, { data: _annotationNotePayload(data, editor, noteEl) }, '注釈: 付箋更新', id)
            .catch(error => _reportAnnotationSaveFailure(error));
        } else {
          if (!noteEl.querySelector('.ann-tail,.ann-tail-shape')) {
            data.tailX = 0;
            data.tailY = 60;
            addNoteTail(noteEl, id, data, data.tailX, data.tailY);
            _putAnnotationWithHistory(id, { data: _annotationNotePayload(data, editor, noteEl) }, '注釈: 付箋更新', id)
              .catch(error => _reportAnnotationSaveFailure(error));
          }
        }
      });
      tailPanel.appendChild(si);
    });
    tailTrig.addEventListener('mouseenter', showTailPanel);
    tailTrig.addEventListener('mouseleave', scheduleTailClose);
    tailTrig.addEventListener('click', () => tailOpen ? hideTailPanel() : showTailPanel());
    tailTrig.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        showTailPanel();
        requestAnimationFrame(() => focusMenuItem(menuItems(tailPanel), 0));
      }
    });
    tailPanel.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    tailPanel.addEventListener('mouseleave', scheduleTailClose);
    tailPanel.addEventListener('keydown', (ev) => handleMenuKeydown(ev, tailPanel, () => {
      hideTailPanel();
      tailTrig.focus();
    }));
    menu.appendChild(tailTrig);

    // 削除
    const deleteItem = createMenuButton({ label: '削除', icon: 'trash2', action: 'delete', danger: true });
    menu.appendChild(deleteItem);
    document.body.appendChild(menu);
    if (restoreTarget && restoreTarget.classList?.contains('note-more-btn') && typeof positionPopup === 'function') {
      positionPopup(menu, restoreTarget.getBoundingClientRect(), { prefer: 'below', gap: 2 });
    } else if (typeof positionPopup === 'function') {
      positionPopup(menu, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }, { prefer: 'below', gap: 2 });
    } else {
      const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
      menu.style.left = ((e?.clientX || 0) / z) + 'px';
      menu.style.top = ((e?.clientY || 0) / z) + 'px';
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    menu.addEventListener('keydown', (ev) => handleMenuKeydown(ev, menu));
    colorItem.addEventListener('click', () => {
      closeMenu(false);
      openColorPalette(noteEl, color, (newColor) => {
        color = newColor;
        _applyAnnotationNoteColor(noteEl, newColor);
        if (isTrayHostNote) data.style = { ...(data.style || {}), color: newColor };
        const colorBody = isTrayHostNote
          ? { color: newColor, ..._trayAnnotationUpdateBody(data, _annotationNotePayload(data, editor, noteEl)) }
          : { color: newColor };
        _putAnnotationWithHistory(id, colorBody, '注釈: 色変更', id)
          .catch(error => _reportAnnotationSaveFailure(error));
      });
    });
    deleteItem.addEventListener('click', () => {
      closeMenu(false);
      deleteNote(id, noteEl, { data, editor });
    });
    setTimeout(() => {
      document.addEventListener('pointerdown', onGlobalPointerDown, true);
      document.addEventListener('keydown', onGlobalKeyDown, true);
      requestAnimationFrame(() => menuItems(menu)[0]?.focus());
    }, 0);
  }

  note.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _showAnnotationNoteContextMenu(e, note);
  });
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(note, (e) => _showAnnotationNoteContextMenu(e, note));
  }

  // メニューボタン追加
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'note-more-btn';
  moreBtn.dataset.e2eId = `annotation-note-${id}-menu`;
  moreBtn.setAttribute('aria-label', '注釈メニュー');
  moreBtn.title = 'メニュー';
  moreBtn.innerHTML = lucide('moreHorizontal', 16);
  moreBtn.addEventListener('click', (ev) => { ev.stopPropagation(); _showAnnotationNoteContextMenu(ev, note); });
  note.appendChild(moreBtn);

  mainArea.appendChild(note);
}

async function deleteNote(id, el, options = {}) {
  if (!options.skipConfirm && typeof cfConfirm === 'function' && !await cfConfirm('この注釈を削除しますか？')) return false;
  const isNote = el?.classList?.contains('ann-note');
  const previousParent = el?.parentNode || null;
  const previousNextSibling = el?.nextSibling || null;
  const before = await _fetchAnnotationHistoryRow(id).catch(() => null);
  if (el) {
    el.dataset.deleted = '1';
    el.remove();
    _markAnnotationMutated(ann.targetPath);
  }
  try {
    const data = options.data || el?._annData || {};
    const editor = options.editor || el?.querySelector?.('.ann-note-editor') || null;
    if (isNote) {
      const payload = _annotationNotePayload(data, editor, el);
      payload.deleted = true;
      payload.deletedAt = new Date().toISOString();
      if (_isTrayAnnotationHost()) {
        const expectedModified = _trayAnnotationHost.modified || before?.modified || '';
        const update = { data: payload };
        if (expectedModified) update.expected_modified = expectedModified;
        await _trayAnnotationApiPut('/annotations/' + encodeURIComponent(id), update);
      } else {
        await apiPut('/annotations/' + encodeURIComponent(id), { data: payload });
      }
      const after = await _fetchAnnotationHistoryRow(id).catch(() => null);
      _pushAnnotationHistory('注釈: 削除', before, after, id);
    } else {
      await apiDelete('/annotations/' + encodeURIComponent(id));
      _pushAnnotationHistory('注釈: 削除', before, null, id);
    }
    if (typeof showStatus === 'function') showStatus('削除しました');
    if (_isTrayAnnotationHost() && String(id) === _trayAnnotationHost.annotationId) {
      _trayAnnotationBridgeCall('tray_annotation_close');
    }
    return true;
  } catch (error) {
    if (el && previousParent && !el.isConnected) {
      delete el.dataset.deleted;
      try { previousParent.insertBefore(el, previousNextSibling); }
      catch { try { previousParent.appendChild(el); } catch {} }
    }
    if (_isTrayAnnotationHost()) {
      await loadAnnotations().catch(() => null);
      const conflict = Number(error?.status || error?.response?.status || 0) === 409
        || /(?:HTTP\s*)?409|競合/.test(String(error?.message || ''));
      if (typeof showStatus === 'function') {
        showStatus(conflict
          ? '他の場所で更新されたため削除せず、最新の付箋を再読み込みしました'
          : '削除できなかったため、最新の付箋を再読み込みしました', true);
      }
    } else if (typeof showStatus === 'function') showStatus('削除に失敗', true);
    return false;
  }
}

// アノテーション読み込み
async function loadAnnotations() {
  const layer = document.getElementById('ann-layer');
  const targetPath = ann.targetPath;
  const loadSeq = ++_annLoadSeq;
  const mutationSeq = _annMutationSeq;
  const targetKey = _normalizeAnnotationTargetPath(targetPath);
  if (!targetPath) {
    _clearStandaloneAnnotations();
    _setAnnotationRenderedTarget('');
    return;
  }
  if (_normalizeAnnotationTargetPath(_annRenderedTargetPath) !== targetKey) {
    _clearStandaloneAnnotations();
    _setAnnotationRenderedTarget(targetPath);
  }
  try {
    const items = await _trayAnnotationApiFetch(_annotationTargetFetchUrl(targetPath));
    if (
      loadSeq !== _annLoadSeq ||
      targetPath !== ann.targetPath ||
      (mutationSeq !== _annMutationSeq && _annotationMutationAffectsTarget(targetPath)) ||
      ann.drawing
    ) {
      return;
    }
    if (layer) layer.innerHTML = '';
    _forEachStandaloneAnnotationNote(el => el.remove());
    _setAnnotationRenderedTarget(targetPath);
    const visibleItems = _isTrayAnnotationHost()
      ? items.filter(item => String(item?.id || '') === _trayAnnotationHost.annotationId)
      : items;
    visibleItems.forEach(item => {
      const parsedData = _parseAnnotationData(item);
      const data = _isTrayAnnotationHost() ? _trayAnnotationData(item, parsedData) : parsedData;
      if (data == null) return;
      if (_isTrayAnnotationHost()) _trayAnnotationHost.modified = String(item?.modified || '');
      if (_isStandaloneAnnotationNoteItem(item, data)) {
        renderNote(item.id, item.shape || 'sticky', data, item.color, item.opacity, item.user, item.created);
      } else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') {
        return;
      } else if (item.type === 'lasso') {
        if (data.points) {
          const el = _createLassoEl(data.points, item.color, item.opacity);
          el.dataset.annId = item.id;
          layer.appendChild(el);
        }
      } else if (['rect', 'rect-line', 'ellipse-line', 'ellipse-fill'].includes(item.type)) {
        if (data && data.width != null && data.height != null) {
          const el = _createAnnotationShapeEl(item.type, data, item.color, item.opacity);
          el.dataset.annId = item.id;
          layer.appendChild(el);
        } else if (data && data.rx != null && data.ry != null) {
          const el = _createAnnotationShapeEl(item.type, data, item.color, item.opacity);
          el.dataset.annId = item.id;
          layer.appendChild(el);
        }
      } else {
        if (data.points) {
          const pathD = _pointsToSvgPath(data.points, data.pressures || [], item.type === 'stroke');
          const el = _createStrokeEl(pathD, item.color, item.opacity, data.pressures || [], item.type === 'stroke', data.width);
          el.dataset.annId = item.id;
          layer.appendChild(el);
        }
      }
    });
  } catch(e) {}
}

function _installTrayAnnotationHostStyles(host) {
  document.body.dataset.annotationTrayHost = '1';
  document.body.classList.add('ann-toolbar-active');
  document.documentElement.style.background = 'transparent';
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.background = 'transparent';
  [...document.body.children].forEach(child => {
    if (child === host || ['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)) return;
    child.style.setProperty('display', 'none', 'important');
  });
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    overflow: 'hidden',
    background: 'transparent',
    zIndex: '2147483000',
  });
}

async function _pollTrayAnnotationHost() {
  if (!_isTrayAnnotationHost() || !_trayAnnotationHost.initialized) return;
  try {
    const items = await _trayAnnotationApiFetch('/annotations?ann_id=' + encodeURIComponent(_trayAnnotationHost.annotationId) + '&limit=1');
    const item = Array.isArray(items) ? items[0] : null;
    const modified = String(item?.modified || '');
    const editorActive = !!document.activeElement?.closest?.('[data-annotation-tray-note="1"] .ann-note-editor');
    if (item && modified && modified !== _trayAnnotationHost.modified && !editorActive && !ann.drawing) {
      await loadAnnotations();
    }
  } catch (error) {
    _reportAnnotationSaveFailure(error, 'デスクトップ付箋を同期できませんでした');
  } finally {
    clearTimeout(_trayAnnotationHost.pollTimer);
    _trayAnnotationHost.pollTimer = setTimeout(_pollTrayAnnotationHost, 1000);
  }
}

async function _initTrayAnnotationHost() {
  if (!_isTrayAnnotationHost() || _trayAnnotationHost.initialized) return false;
  _trayAnnotationHost.initialized = true;
  const host = document.createElement('main');
  host.id = 'ann-desktop-host';
  host.dataset.e2eId = 'tray-annotation-host';
  host.setAttribute('aria-label', 'デスクトップ付箋');
  document.body.appendChild(host);
  _installTrayAnnotationHostStyles(host);
  ann.targetPath = _trayAnnotationHost.targetPath;
  ann.active = true;
  await loadAnnotations();
  _trayAnnotationHost.pollTimer = setTimeout(_pollTrayAnnotationHost, 1000);
  return true;
}
