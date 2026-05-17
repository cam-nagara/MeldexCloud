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
  return {
    ...data,
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
  return { range, rect };
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
  const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
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

function renderNote(id, shape, data, color, opacity, user, created) {
  // v5.0: 付箋は現在の注釈ホスト（アクティブなペイン）に配置する
  const mainArea = _getStandaloneAnnotationHost();
  const note = document.createElement('div');
  note.className = 'ann-note ' + shape;
  note.dataset.annId = id;
  note._annData = data;
  note.dataset.baseY = data.y; // スクロール同期用の基準Y
  note.draggable = true;
  note.addEventListener('dragstart', (e) => {
    const text = data.text || '付箋注釈';
    e.dataTransfer.setData('text/plain', '[注釈: ' + text.substring(0, 30) + '](annotation:' + id + ')');
    e.dataTransfer.setData('application/x-annotation', JSON.stringify({ id, text, shape }));
  });
  note.dataset.baseX = data.x;
  // スクロール分を引いて画面上の位置を計算
  const scrollY = (_annScrollContainer && !_isIframeView(state.view)) ? _annScrollContainer.scrollTop : 0;
  const scrollX = (_annScrollContainer && !_isIframeView(state.view)) ? _annScrollContainer.scrollLeft : 0;
  note.style.left = (data.x - scrollX) + 'px';
  note.style.top = (data.y - scrollY) + 'px';
  note.style.width = (data.width || 180) + 'px';
  note.style.height = (data.height || 100) + 'px';
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
  const deleteBtn = document.createElement('span');
  deleteBtn.dataset.annDelete = '1';
  deleteBtn.style.cursor = 'pointer';
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
    return _putAnnotationWithHistory(id, { data: d }, '注釈: 付箋更新', id)
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
  const pointerCssPos = (ev) => {
    const z = (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
    return { x: ev.clientX / z, y: ev.clientY / z };
  };
  const onDragMove = (ev) => {
    if (!dragging) return;
    ev.preventDefault();
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
    const pos = _contentCoordsFromNoteOffset(note);
    data.x = pos.x;
    data.y = pos.y;
    note.dataset.baseX = String(pos.x);
    note.dataset.baseY = String(pos.y);
    persist();
  };
  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-action],[data-ann-delete]')) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    note.draggable = false;
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
    document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = '_note-ctx-menu';
    menu.style.cssText = 'position:fixed;z-index:210;background:var(--ui-popup-bg, var(--bg2));border:1px solid var(--border);border-radius:6px;padding:4px 0;box-shadow:0 4px 12px rgba(0,0,0,0.4);min-width:120px;';
    { const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
    const hasTail = !!noteEl.querySelector('.ann-tail,.ann-tail-shape');
    // 色を変更
    const colorItem = document.createElement('div');
    colorItem.className = '_ctx-item';
    colorItem.dataset.action = 'color';
    colorItem.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
    colorItem.innerHTML = lucide('palette',14) + ' 色を変更';
    menu.appendChild(colorItem);

    // フキダシのしっぽ サブメニュー
    const tailWrap = document.createElement('div');
    tailWrap.style.position = 'relative';
    const tailTrig = document.createElement('div');
    tailTrig.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;';
    tailTrig.innerHTML = lucide('messageSquare',14) + ' フキダシのしっぽ' + submenuArrow();
    tailTrig.onmouseenter = () => { tailTrig.style.background='var(--bg4)'; };
    tailTrig.onmouseleave = () => { tailTrig.style.background=''; };
    const tailPanel = document.createElement('div');
    tailPanel.className = '_note-ctx-menu';
    tailPanel.style.cssText = 'display:none;min-width:100px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:4px 0;box-shadow:0 4px 12px rgba(0,0,0,0.4);z-index:211;';
    attachHoverSubmenu(tailTrig, tailPanel);
    [['追加する', false], ['削除する', true]].forEach(([label, isRemove]) => {
      const si = document.createElement('div');
      si.innerHTML = radioMark(hasTail === isRemove) + label;
      si.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;' + (hasTail === isRemove ? 'color:var(--accent);' : '');
      si.onmouseenter = () => { si.style.background='var(--bg4)'; };
      si.onmouseleave = () => { si.style.background=''; };
      si.addEventListener('click', () => {
        document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
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
    tailWrap.appendChild(tailTrig);
    tailWrap.appendChild(tailPanel);
    menu.appendChild(tailWrap);

    // 削除
    const deleteItem = document.createElement('div');
    deleteItem.className = '_ctx-item';
    deleteItem.dataset.action = 'delete';
    deleteItem.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:12px;color:var(--red);display:flex;align-items:center;gap:6px;';
    deleteItem.innerHTML = lucide('trash2',14) + ' 削除';
    menu.appendChild(deleteItem);
    document.body.appendChild(menu);
    clampPopupToViewport(menu);
    colorItem.addEventListener('click', () => {
      menu.remove();
      openColorPalette(noteEl, color, (newColor) => {
        color = newColor;
        _applyAnnotationNoteColor(noteEl, newColor);
        _putAnnotationWithHistory(id, { color: newColor }, '注釈: 色変更', id)
          .catch(error => _reportAnnotationSaveFailure(error));
      });
    });
    deleteItem.addEventListener('click', () => {
      menu.remove();
      deleteNote(id, noteEl, { data, editor });
    });
    setTimeout(() => document.addEventListener('pointerdown', function h(ev) {
      const inAny = [...document.querySelectorAll('._note-ctx-menu')].some(m => m.contains(ev.target));
      if (!inAny) document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
      else document.addEventListener('pointerdown', h, {once:true});
    }, {once:true}), 0);
  }

  note.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _showAnnotationNoteContextMenu(e, note);
  });
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(note, (e) => _showAnnotationNoteContextMenu(e, note));
  }

  // メニューボタン追加
  const moreBtn = document.createElement('span');
  moreBtn.className = 'note-more-btn';
  moreBtn.textContent = '\u22ef';
  moreBtn.title = 'メニュー';
  moreBtn.style.cssText = 'position:absolute;top:2px;right:2px;cursor:pointer;font-size:12px;color:var(--fg2);padding:2px 4px;border-radius:3px;z-index:5;';
  moreBtn.addEventListener('click', (ev) => { ev.stopPropagation(); _showAnnotationNoteContextMenu(ev, note); });
  note.appendChild(moreBtn);

  mainArea.appendChild(note);
}

async function deleteNote(id, el, options = {}) {
  if (!options.skipConfirm && typeof cfConfirm === 'function' && !await cfConfirm('この注釈を削除しますか？')) return false;
  const isNote = el?.classList?.contains('ann-note');
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
      await apiPut('/annotations/' + encodeURIComponent(id), { data: payload });
      const after = await _fetchAnnotationHistoryRow(id).catch(() => null);
      _pushAnnotationHistory('注釈: 削除', before, after, id);
    } else {
      await apiDelete('/annotations/' + encodeURIComponent(id));
      _pushAnnotationHistory('注釈: 削除', before, null, id);
    }
    if (typeof showStatus === 'function') showStatus('削除しました');
    return true;
  } catch {
    if (typeof showStatus === 'function') showStatus('削除に失敗', true);
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
    const items = await apiFetch(_annotationTargetFetchUrl(targetPath));
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
    items.forEach(item => {
      const data = _parseAnnotationData(item);
      if (data == null) return;
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
      } else if (item.type === 'rect') {
        if (data && data.width != null && data.height != null) {
          const el = _createRectFillEl(data, item.color, item.opacity);
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

async function annClear() {
  if (!await cfConfirm('この画面の注釈をすべて削除しますか？')) return;
  const embedded = _usesEmbeddedAnnotationSurface(_getAnnotationViewName());
  const overlay = embedded ? null : document.getElementById('ann-overlay');
  const bridge = embedded ? _getBoardAnnotationControl() : null;
  let historyBefore = [];
  if (ann.targetPath) {
    try {
      historyBefore = await apiFetch(_annotationTargetFetchUrl(ann.targetPath));
    } catch {}
  }
  const ids = new Set();
  const softDeleted = new Map();
  overlay?.querySelectorAll('[data-ann-id],[data-ann-pending]').forEach(el => {
    if (el.dataset.annId) ids.add(el.dataset.annId);
    el.dataset.deleted = '1';
    el.remove();
  });
  bridge?.layer?.querySelectorAll('[data-ann-id],[data-ann-client-id]').forEach(el => {
    if (el.dataset.annId) ids.add(el.dataset.annId);
    el.dataset.deleted = '1';
    el.remove();
  });
  document.querySelectorAll(embedded ? '.ann-note.ann-note-embedded' : '.ann-note:not(.ann-note-embedded)').forEach(el => {
    if (el.dataset.annId) {
      const deletedData = { ...(el._annData || {}), deleted: true, deletedAt: new Date().toISOString() };
      if (el._annData) Object.assign(el._annData, deletedData);
      el.dataset.deleted = '1';
      el._annCancelPendingSave?.();
      softDeleted.set(el.dataset.annId, deletedData);
      ids.delete(el.dataset.annId);
    }
    el.remove();
  });
  if (embedded && ann.targetPath) {
    try {
      const items = await apiFetch(_annotationTargetFetchUrl(ann.targetPath));
      (items || []).forEach(item => {
        if (!item?.id) return;
        const data = _parseAnnotationData(item);
        if (data == null) return;
        if (_isStandaloneAnnotationNoteItem(item, data)) {
          softDeleted.set(item.id, { ...data, deleted: true, deletedAt: new Date().toISOString() });
          ids.delete(item.id);
        } else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') {
          return;
        } else {
          ids.add(item.id);
        }
      });
    } catch {}
  }
  const operations = [
    ...[...ids].filter(id => !softDeleted.has(id)).map(id => apiDelete('/annotations/' + encodeURIComponent(id))),
    ...[...softDeleted.entries()].map(([id, data]) => apiPut('/annotations/' + encodeURIComponent(id), { data })),
  ];
  const results = await Promise.allSettled(operations);
  const failedCount = results.filter(result => result.status === 'rejected').length;
  let historyAfter = [];
  if (ann.targetPath) {
    try {
      historyAfter = await apiFetch(_annotationTargetFetchUrl(ann.targetPath));
    } catch {}
  }
  if (typeof _pushAnnotationBatchHistory === 'function') {
    _pushAnnotationBatchHistory('注釈: 全削除', historyBefore, historyAfter, ann.targetPath);
  }
  _markAnnotationMutated(ann.targetPath);
  if (failedCount) {
    if (typeof loadAnnotations === 'function' && !embedded) loadAnnotations();
    else if (embedded && typeof _loadAnnotationsToIframe === 'function') _loadAnnotationsToIframe();
    showStatus(`注釈を一部削除できませんでした（${failedCount}件）`, true);
    return;
  }
  showStatus('注釈を全削除しました');
}

// Alt+A → gb-shortcuts.js の中央ハンドラに移行済み

// ==============================
// アノテーション管理ビュー
// ==============================
async function openAnnotationManager() {
  if (typeof openRightPanelTab === 'function') openRightPanelTab('annotation');
  else if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('annotation');
  if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
}

function jumpToAnnotation(targetPath) {
  // ターゲットパスからビューを推定して移動
  document.querySelector('.modal-overlay')?.remove();
  if (!targetPath) {
    showStatus('注釈の対象ファイルが見つかりません', true);
    return;
  }
  if (targetPath === 'calendar:panel') {
    if (typeof openCalendar === 'function') openCalendar();
    else if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('calendar');
  } else if (targetPath.startsWith('compare:')) {
    const pair = targetPath.slice('compare:'.length).split('|');
    if (pair[0] && pair[1] && typeof openCompareView === 'function') openCompareView(pair[0], pair[1]).catch?.(() => {});
    else showStatus('比較ビューの注釈対象が見つかりません', true);
  } else if (targetPath.endsWith('.smart-db.json')) {
    const label = targetPath.split('/').pop().replace(/\.smart-db\.json$/i, '');
    if (typeof openSmartDbFile === 'function') openSmartDbFile(label, targetPath);
    else selectDatabase(targetPath);
  } else if (targetPath.includes('/設定/') || targetPath.includes('/DB')) {
    selectDatabase(targetPath);
  } else if (targetPath.endsWith('.scriptnote.json') || targetPath.endsWith('.scenario.json')) {
    if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(targetPath, targetPath.split('/').pop());
  } else {
    openPage(targetPath.split('/').pop(), targetPath);
  }
}
