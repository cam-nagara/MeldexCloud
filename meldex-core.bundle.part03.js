    svgIcon.style.display = 'block';
    svgIcon.style.flex = '0 0 ' + size + 'px';
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
      bgColor: computed && !/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(computed.backgroundColor || '') ? computed.backgroundColor : '',
      leftAccent: /inset/i.test(computed?.boxShadow || ''),
      accentColor: computed?.textDecorationColor || '',
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
    const entries = Object.entries(styles || {});
    const clearKeys = entries.filter(([, value]) => value === '').map(([key]) => key);
    if (clearKeys.length) _clearNoteSelectionStyles(range, clearKeys);
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

  function _clearNoteSelectionStyles(range, styleKeys) {
    if (!range || !styleKeys?.length) return;
    const roots = new Set();
    const addElement = (node) => {
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
      styleKeys.forEach(key => {
        try { el.style[key] = ''; } catch {}
      });
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
  }

  function _applyNoteSelectionFormat(range, prop, value) {
    _restoreNoteSelection(range);
    if (prop === 'fontWeight') _setNoteCommandState('bold', value === 'bold');
    else if (prop === 'fontStyle') _setNoteCommandState('italic', value === 'italic');
    else if (prop === 'underline') _setNoteCommandState('underline', !!value);
    else if (prop === 'strike') _setNoteCommandState('strikeThrough', !!value);
    else if (prop === 'textColor') { try { document.execCommand('foreColor', false, value || '#333333'); } catch {} }
    else if (prop === 'bgColor') _wrapNoteSelectionStyle({ backgroundColor: value || '' });
    else if (prop === 'leftAccent') _wrapNoteSelectionStyle(value ? { boxShadow: 'inset 3px 0 0 currentColor', paddingLeft: '6px' } : { boxShadow: '', paddingLeft: '' });
    else if (prop === 'accentColor') _wrapNoteSelectionStyle({ textDecorationColor: value || '' });
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
      fields: ['textColor', 'fontSize', 'fontFamily', 'bold', 'italic', 'bgColor', 'leftAccent', 'accentColor', 'strike', 'underline'],
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
    const headerLabel = document.createElement('span');
    headerLabel.className = 'ann-note-user';
    const userIcon = document.createElement('span');
    userIcon.className = 'ann-user-icon';
    userIcon.innerHTML = _userIconHtml(displayUser);
    const userText = document.createElement('span');
    userText.className = 'ann-user-name';
    userText.textContent = `${displayUser || ''}${dateStr ? ' ' + dateStr : ''}`.trim();
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'ann-note-delete-btn';
    deleteBtn.dataset.annDelete = '1';
    deleteBtn.dataset.e2eId = `embedded-annotation-note-${item.id || 'pending'}-delete`;
    deleteBtn.setAttribute('aria-label', '注釈を削除');
    deleteBtn.title = '削除';
    deleteBtn.innerHTML = lucide('x', 12);
    _normalizeEmbeddedNoteIcon(deleteBtn, 12);
    headerLabel.appendChild(userIcon);
    headerLabel.appendChild(userText);
    header.appendChild(headerLabel);
    header.appendChild(deleteBtn);
    note.tabIndex = -1;
    note.setAttribute('aria-haspopup', 'menu');
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
      if (!_ann.active || e.target.closest('[data-ann-delete],button,.ann-note-resize-handle,.gb-fmt-popup')) return;
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

    deleteBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _confirmEmbeddedNoteDelete(_deleteEmbeddedNote);
    });

    // 右クリックメニュー (色変更 / フキダシしっぽ / 削除)
    function _showEmbeddedNoteContextMenu(ev) {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      document.querySelectorAll('._note-ctx-menu').forEach(m => m.remove());
      const restoreTarget = ev?.currentTarget instanceof HTMLElement ? ev.currentTarget : null;
      const fallbackRect = (restoreTarget || note).getBoundingClientRect();
      const clientX = Number.isFinite(ev?.clientX) ? ev.clientX : fallbackRect.left + Math.min(32, Math.max(8, fallbackRect.width / 2));
      const clientY = Number.isFinite(ev?.clientY) ? ev.clientY : fallbackRect.top + Math.min(32, Math.max(8, fallbackRect.height / 2));
      const menu = document.createElement('div');
      menu.className = 'gb-context-menu _note-ctx-menu embedded-annotation-note-context-menu annotation-note-context-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', '注釈付箋メニュー');
      menu.style.position = 'fixed';
      menu.style.zIndex = '210';
      const hasTail = !!note.querySelector('.ann-tail,.ann-tail-shape');
      let closeTimer = 0;
      let tailOpen = false;
      let tailTrig = null;
      let tailPanel = null;

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
        tailTrig?.setAttribute('aria-expanded', 'false');
        if (tailPanel) {
          tailPanel.hidden = true;
          tailPanel.style.display = 'none';
        }
      };
      const showTailPanel = () => {
        clearTimeout(closeTimer);
        if (!tailPanel) return;
        if (!tailPanel.isConnected) document.body.appendChild(tailPanel);
        tailOpen = true;
        tailTrig?.setAttribute('aria-expanded', 'true');
        tailPanel.hidden = false;
        tailPanel.style.display = 'block';
        if (typeof window.positionPopup === 'function') {
          window.positionPopup(tailPanel, tailTrig.getBoundingClientRect(), { prefer: 'right', gap: 2, avoidRect: menu.getBoundingClientRect() });
        } else {
          const rect = tailTrig.getBoundingClientRect();
          tailPanel.style.left = rect.right + 2 + 'px';
          tailPanel.style.top = rect.top + 'px';
          if (typeof window.clampPopupToViewport === 'function') window.clampPopupToViewport(tailPanel);
        }
      };
      const scheduleTailClose = () => {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
          if (!tailPanel?.matches(':hover') && !tailTrig?.matches(':hover') && !tailPanel?.contains(document.activeElement)) hideTailPanel();
        }, 140);
      };
      function onGlobalPointerDown(e2) {
        const inAny = menu.contains(e2.target) || !!tailPanel?.contains(e2.target);
        if (!inAny) closeMenu(false);
      }
      function onGlobalKeyDown(e2) {
        if (e2.key === 'Escape') {
          e2.preventDefault();
          e2.stopPropagation();
          closeMenu(true);
        }
      }
      const handleMenuKeydown = (e2, root, onArrowLeft = null) => {
        const items = menuItems(root);
        const currentIndex = items.indexOf(document.activeElement);
        if (e2.key === 'ArrowDown') {
          e2.preventDefault();
          focusMenuItem(items, currentIndex + 1);
        } else if (e2.key === 'ArrowUp') {
          e2.preventDefault();
          focusMenuItem(items, currentIndex - 1);
        } else if (e2.key === 'Home') {
          e2.preventDefault();
          focusMenuItem(items, 0);
        } else if (e2.key === 'End') {
          e2.preventDefault();
          focusMenuItem(items, items.length - 1);
        } else if (e2.key === 'ArrowLeft' && onArrowLeft) {
          e2.preventDefault();
          onArrowLeft();
        }
      };
      const createMenuButton = ({ label, icon, action, danger = false, role = 'menuitem', checked = null }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'gb-context-menu-item' + (danger ? ' danger' : '');
        button.dataset.action = action;
        button.setAttribute('role', role);
        if (checked != null) button.setAttribute('aria-checked', checked ? 'true' : 'false');
        const iconSlot = document.createElement('span');
        iconSlot.className = 'menu-icon';
        iconSlot.setAttribute('aria-hidden', 'true');
        iconSlot.innerHTML = typeof window.lucide === 'function' && icon ? window.lucide(icon, 16) : '';
        const labelSlot = document.createElement('span');
        labelSlot.textContent = label;
        button.appendChild(iconSlot);
        button.appendChild(labelSlot);
        return button;
      };
      const persistTailState = () => {
        const payload = _notePayload(data, editor, note);
        if (item.id && !String(item.id).startsWith('pending-note-') && typeof apiPut === 'function') {
          if (!_updateBoardAnnotation(item.id, { data: payload })) {
            apiPut('/annotations/' + encodeURIComponent(item.id), { data: payload })
              .catch(error => _reportMarkupSaveFailure(error));
          }
        } else {
          item._pendingData = payload;
        }
      };
      const applyTailOperation = (isRemove) => {
        const hasTailMod = (typeof AnnotationStickyTail !== 'undefined');
        if (isRemove) {
          if (hasTailMod && note._annTailCtx) {
            delete note._annTailCtx.data.tail;
            delete note._annTailCtx.data.tailX;
            delete note._annTailCtx.data.tailY;
          }
          note.querySelectorAll(':scope > .ann-tail, :scope > .ann-tail-line, :scope > .ann-tail-shape, :scope > .ann-tail-handle').forEach(el => el.remove());
          delete data.tail;
          delete data.tailX;
          delete data.tailY;
        } else if (hasTailMod && !note.querySelector('.ann-tail,.ann-tail-shape')) {
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
          if (note._annTailCtx) {
            note._annTailCtx.data.tail = newTail;
            delete note._annTailCtx.data.tailX;
            delete note._annTailCtx.data.tailY;
          }
          AnnotationStickyTail.setTail(note, newTail, null);
        }
        persistTailState();
      };

      const colorItem = createMenuButton({ label: '色を変更', icon: 'palette', action: 'color' });
      colorItem.addEventListener('click', () => {
        closeMenu(false);
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

      tailTrig = createMenuButton({ label: 'フキダシのしっぽ', icon: 'messageSquare', action: 'tail' });
      tailTrig.classList.add('has-submenu');
      tailTrig.setAttribute('aria-haspopup', 'menu');
      tailTrig.setAttribute('aria-expanded', 'false');
      tailPanel = document.createElement('div');
      tailPanel.className = 'gb-context-menu _note-ctx-menu embedded-annotation-note-tail-menu annotation-note-tail-menu';
      tailPanel.setAttribute('role', 'menu');
      tailPanel.setAttribute('aria-label', 'フキダシのしっぽ');
      tailPanel.hidden = true;
      tailPanel.style.position = 'fixed';
      tailPanel.style.zIndex = '211';
      tailPanel.style.display = 'none';
      [['追加する', false], ['削除する', true]].forEach(([label, isRemove]) => {
        const tailButton = createMenuButton({ label, action: isRemove ? 'tail-remove' : 'tail-add', role: 'menuitemradio', checked: hasTail === isRemove });
        tailButton.addEventListener('click', () => {
          closeMenu(false);
          applyTailOperation(isRemove);
        });
        tailPanel.appendChild(tailButton);
      });
      tailTrig.addEventListener('mouseenter', showTailPanel);
      tailTrig.addEventListener('mouseleave', scheduleTailClose);
      tailTrig.addEventListener('click', () => tailOpen ? hideTailPanel() : showTailPanel());
      tailTrig.addEventListener('keydown', (e2) => {
        if (e2.key === 'ArrowRight' || e2.key === 'Enter' || e2.key === ' ') {
          e2.preventDefault();
          showTailPanel();
          requestAnimationFrame(() => focusMenuItem(menuItems(tailPanel), 0));
        }
      });
      tailPanel.addEventListener('mouseenter', () => clearTimeout(closeTimer));
      tailPanel.addEventListener('mouseleave', scheduleTailClose);
      tailPanel.addEventListener('keydown', (e2) => handleMenuKeydown(e2, tailPanel, () => {
        hideTailPanel();
        tailTrig.focus();
      }));
      menu.appendChild(tailTrig);

      const deleteItem = createMenuButton({ label: '削除', icon: 'trash2', action: 'delete', danger: true });
      deleteItem.addEventListener('click', () => {
        closeMenu(false);
        _confirmEmbeddedNoteDelete(_deleteEmbeddedNote);
      });
      menu.appendChild(deleteItem);
      document.body.appendChild(menu);
      if (restoreTarget && restoreTarget.classList?.contains('note-more-btn') && typeof window.positionPopup === 'function') {
        window.positionPopup(menu, restoreTarget.getBoundingClientRect(), { prefer: 'below', gap: 2 });
      } else if (typeof window.positionPopup === 'function') {
        window.positionPopup(menu, { left: clientX, right: clientX, top: clientY, bottom: clientY }, { prefer: 'below', gap: 2 });
      } else {
        const z = (typeof window._getZoom === 'function') ? window._getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
        menu.style.left = (clientX / z) + 'px';
        menu.style.top = (clientY / z) + 'px';
        if (typeof window.clampPopupToViewport === 'function') window.clampPopupToViewport(menu);
      }
      menu.addEventListener('keydown', (e2) => handleMenuKeydown(e2, menu));
      setTimeout(() => {
        document.addEventListener('pointerdown', onGlobalPointerDown, true);
        document.addEventListener('keydown', onGlobalKeyDown, true);
        requestAnimationFrame(() => menuItems(menu)[0]?.focus());
      }, 0);
    }

    // ヘッダー右端の「…」ボタン: 右クリックと同じメニューを開く
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'note-more-btn';
    moreBtn.dataset.annMore = '1';
    moreBtn.dataset.e2eId = `embedded-annotation-note-${item.id || 'pending'}-menu`;
    moreBtn.setAttribute('aria-label', '注釈メニュー');
    moreBtn.title = 'メニュー';
    moreBtn.innerHTML = lucide('moreHorizontal', 16);
    _normalizeEmbeddedNoteIcon(moreBtn, 16);
    moreBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    moreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _showEmbeddedNoteContextMenu(e);
    });
    note.appendChild(moreBtn);

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
      const els = Array.from(layer.querySelectorAll('path, polygon, rect, ellipse')).reverse();
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
    const anchorHit = _annotationAnchorAt(e.clientX, e.clientY, pt);
    _ann.anchor = ['rect-line', 'ellipse-line', 'ellipse-fill'].includes(_ann.tool) ? null : (anchorHit?.data || null);
    _ann.path = [_ann.anchor
      ? _annotationPointToLocal(_ann.anchor, [pt.x, pt.y])
      : [pt.x, pt.y]];
    _ann.pressures = [e.pressure || 0.5];
    try { svg.setPointerCapture?.(e.pointerId); } catch (_) {}
  });

  svg.addEventListener('pointermove', (e) => {
    if (!_ann.drawing) return;
    const pt = _toLocalCoords(e.clientX, e.clientY);
    _ann.path.push(_ann.anchor
      ? _annotationPointToLocal(_ann.anchor, [pt.x, pt.y])
      : [pt.x, pt.y]);
    _ann.pressures.push(e.pressure || 0.5);
    let preview = layer.querySelector('.ann-preview');
    const ellipseTool = _ann.tool === 'ellipse-line' || _ann.tool === 'ellipse-fill';
    const rectTool = _ann.tool === 'rect' || _ann.tool === 'rect-line';
    const previewTag = (_ann.tool === 'lasso' || (rectTool && _ann.anchor)) ? 'polygon' : (ellipseTool ? 'ellipse' : (rectTool ? 'rect' : 'path'));
    if (!preview || preview.tagName.toLowerCase() !== previewTag) {
      preview?.remove();
      preview = document.createElementNS(_svgNS, previewTag);
      preview.classList.add('ann-preview');
      layer.appendChild(preview);
    }
    if (_ann.anchor) {
      const previewType = _ann.tool === 'rect' ? 'rect' : (_ann.tool === 'lasso' ? 'lasso' : (_ann.tool === 'marker' ? 'marker' : 'stroke'));
      const previewData = previewType === 'rect'
        ? { ..._rectData(_ann.path), anchor: _ann.anchor }
        : { points: _ann.path, pressures: _ann.pressures, width: _ann.widths?.[_ann.tool === 'marker' ? 'marker' : 'pen'], anchor: _ann.anchor };
      _applyAnchoredShape(preview, previewType, previewData, _ann.color, _ann.opacity, true);
    } else if (['rect', 'rect-line', 'ellipse-line', 'ellipse-fill'].includes(_ann.tool)) {
      const data = _ann.tool.startsWith('ellipse') ? _ellipseData(_ann.path) : _rectData(_ann.path);
      data.lineWidth = _ann.widths?.pen;
      _applyMarkupShapeEl(preview, _ann.tool, data, _ann.color, _ann.opacity, true);
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
    const shapeTypes = new Set(['rect', 'rect-line', 'ellipse-line', 'ellipse-fill']);
    const type = shapeTypes.has(_ann.tool) ? _ann.tool : (_ann.tool === 'lasso' ? 'lasso' : (_ann.tool === 'marker' ? 'marker' : (_ann.tool === 'polyline' ? 'polyline' : 'stroke')));
    const annClientId = 'ann-client-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const strokeData = type.startsWith('ellipse') ? _ellipseData(_ann.path) : (shapeTypes.has(type) ? _rectData(_ann.path) : { points: _ann.path, pressures: _ann.pressures });
    if (_ann.anchor) strokeData.anchor = { ..._ann.anchor };
    if (shapeTypes.has(type)) strokeData.lineWidth = _ann.widths?.pen;
    else if (type !== 'lasso') strokeData.width = _ann.widths?.[_ann.tool === 'marker' ? 'marker' : 'pen'];
    const savedEl = shapeTypes.has(type)
      ? _renderMarkupShape(type, strokeData, _ann.color, _ann.opacity, null)
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
