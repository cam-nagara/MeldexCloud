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

  const bridge = { svg, layer, notesLayer, ann: _ann, handleMessage: _handleMessage, updateSize: _updateSize };
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
