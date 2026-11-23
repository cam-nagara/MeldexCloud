
      const colorItem = createMenuButton({ label: '色を変更', icon: 'palette', action: 'color' });
      colorItem.addEventListener('click', () => {
        closeMenu(false);
        if (typeof window.openColorPalette === 'function') {
          window.openColorPalette(note, item.color || '', (newColor) => {
            item.color = newColor || item.color;
            _applyNoteColor(note, item.color);
            if ((boardMode || options.localSurface) && String(item.id || '').startsWith('pending-note-')) return;
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
      attachHoverSubmenu(tailTrig, tailPanel, { onShow: showTailPanel, onHide: hideTailPanel });
      tailTrig.addEventListener('click', () => tailOpen ? hideTailPanel() : showTailPanel());
      tailTrig.addEventListener('keydown', (e2) => {
        if (e2.key === 'ArrowRight' || e2.key === 'Enter' || e2.key === ' ') {
          e2.preventDefault();
          showTailPanel();
          requestAnimationFrame(() => focusMenuItem(menuItems(tailPanel), 0));
        }
      });
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
    moreBtn.setAttribute('aria-label', 'アノテートメニュー');
    moreBtn.title = 'メニュー';
    moreBtn.innerHTML = lucide('moreHorizontal', 16);
    _normalizeEmbeddedNoteIcon(moreBtn, 16);
    moreBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    moreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _showEmbeddedNoteContextMenu(e);
    });
    actions.appendChild(moreBtn);

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
    options.onPointer?.();
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

  svg.addEventListener('pointercancel', () => { _ann.drawing = false; _ann.path = []; _ann.pressures = []; layer.querySelector('.ann-preview')?.remove(); });

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
      if (_ann.active && !options.localSurface) svg.style.outline = '2px solid rgba(86,156,214,0.3)';
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
  const onParentMessage = (ev) => {
    if (options.localSurface || !_isTrustedParentMessageEvent(ev)) return;
    const msg = ev.data;
    _handleMessage(msg);
  };
  if (!options.localSurface) window.addEventListener('message', onParentMessage);

  const bridge = {
    options,
    hasPendingWrites: () => pendingWrites.size > 0,
    flush: async () => { while (pendingWrites.size) await Promise.allSettled([...pendingWrites]); },
    svg,
    layer,
    notesLayer,
    ann: _ann,
    handleMessage: _handleMessage,
    updateSize: _updateSize,
    dispose() {
      _resizeObs.disconnect();
      options.scrollContainer?.removeEventListener('scroll', syncSurfaceScroll);
      _anchoredResizeObserver.disconnect();
      _anchoredMutationObserver?.disconnect();
      if (_anchoredRefreshHandle) cancelAnimationFrame(_anchoredRefreshHandle);
      window.removeEventListener('message', onParentMessage);
      svg.remove(); notesLayer.remove();
      delete wrapper._annBridge;
      if (host !== wrapper) delete host._annBridge;
    },
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
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
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
  function _saReportSaveFailure(error, message = 'アノテートの保存に失敗しました') {
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

  function _saParseAnnotationData(item, message = '一部のアノテートデータを読み込めませんでした') {
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

  function _saClampNotePosition(x, y, width, height) {
    const scrollLeft = container.scrollLeft || 0;
    const scrollTop = container.scrollTop || 0;
    const viewportWidth = Math.max(0, container.clientWidth || 0);
    const viewportHeight = Math.max(0, container.clientHeight || 0);
    const maxX = scrollLeft + Math.max(0, viewportWidth - Math.max(0, width || 0));
    const maxY = scrollTop + Math.max(0, viewportHeight - Math.max(0, height || 0));
    return {
      x: Math.min(Math.max(Number(x) || 0, scrollLeft), maxX),
      y: Math.min(Math.max(Number(y) || 0, scrollTop), maxY),
    };
  }

  function _saFitNoteData(data) {
    const viewportWidth = Math.max(120, container.clientWidth || 180);
    const viewportHeight = Math.max(60, container.clientHeight || 100);
    data.width = Math.min(viewportWidth, Math.max(120, Number(data.width) || 180));
    data.height = Math.min(viewportHeight, Math.max(60, Number(data.height) || 100));
    Object.assign(data, _saClampNotePosition(data.x, data.y, data.width, data.height));
    return data;
  }

  function _applyStandaloneNoteSize(note, textarea, data) {
    _saFitNoteData(data);
    const width = data.width;
    const height = data.height;
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
        _saReportSaveFailure(new Error('missing target path'), 'アノテートの保存先を確認できませんでした');
        return;
      }
      const noteData = _saFitNoteData({ x: pt.x, y: pt.y, width: 180, height: 100, text: '' });
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
            _saReportSaveFailure(error, 'アノテートを削除できませんでした');
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
      _saReportSaveFailure(new Error('missing target path'), 'アノテートの保存先を確認できませんでした');
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
