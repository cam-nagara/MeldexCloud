(function () {
  if (window.__MeldexCloudMobileSideDrawerInstalled) return;
  window.__MeldexCloudMobileSideDrawerInstalled = true;

  const BACKDROP_ID = 'cloud-mobile-side-drawer-backdrop';
  const DRAWER_ID = 'cloud-mobile-side-drawer';
  const TITLE_ID = 'cloud-mobile-side-drawer-title';
  const BODY_ID = 'cloud-mobile-side-drawer-body';
  const DISMISS_MIN_X = 78;
  const DISMISS_MAX_Y = 72;
  let _activeEditor = null;
  let _currentTarget = null;
  let _openingTarget = false;
  let _renderSeq = 0;
  let _portedPanel = null;

  function _isEnabled() {
    return document.body?.dataset?.cloudMobile === '1'
      && !window.MeldexCloudMobile?.isSingleWindow?.();
  }

  function _iconHtml(name, size, fallback) {
    return typeof lucide === 'function'
      ? lucide(name, size || 18)
      : `<span aria-hidden="true">${fallback || ''}</span>`;
  }

  function _isDismissBlockedTarget(target) {
    return !!target?.closest?.('button, a, input, select, textarea, iframe, video, [contenteditable="true"], [role="button"], [role="menu"]');
  }

  function _setDismissDrag(drawer, offsetX) {
    if (!drawer) return;
    drawer.style.setProperty('transition', 'none', 'important');
    drawer.style.setProperty('transform', `translateX(${Math.max(0, Math.round(offsetX))}px)`, 'important');
  }

  function _clearDismissDrag(drawer) {
    if (!drawer) return;
    drawer.style.removeProperty('transition');
    drawer.style.removeProperty('transform');
  }

  function _installDismissGesture(drawer) {
    if (!drawer || drawer.__MeldexCloudMobileSideDismissInstalled) return;
    drawer.__MeldexCloudMobileSideDismissInstalled = true;
    let drag = null;

    const reset = () => {
      if (drag?.active && drag.drawer?.isConnected) _clearDismissDrag(drag.drawer);
      drag = null;
    };

    document.addEventListener('pointerdown', (event) => {
      if (!isOpen() || !drawer.classList.contains('open')) return;
      const handle = event.target?.closest?.('.cloud-mobile-right-drawer-handle');
      if (!handle) {
        if (event.pointerType === 'mouse') return;
        if (!drawer.contains(event.target) || _isDismissBlockedTarget(event.target)) return;
      }
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastTime: performance.now(),
        velocityX: 0,
        active: false,
        drawer,
      };
      if (handle) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, { capture: true });

    document.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const now = performance.now();
      const dt = Math.max(1, now - drag.lastTime);
      drag.velocityX = (event.clientX - drag.lastX) / dt;
      drag.lastX = event.clientX;
      drag.lastTime = now;
      if (!drag.active && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) drag.active = true;
      if (!drag.active) return;
      event.preventDefault();
      event.stopPropagation();
      _setDismissDrag(drag.drawer, Math.max(0, dx));
    }, { capture: true });

    document.addEventListener('pointerup', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const current = drag;
      drag = null;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      const draggedRight = dx >= DISMISS_MIN_X && Math.abs(dx) > Math.abs(dy) && Math.abs(dy) <= DISMISS_MAX_Y;
      const flickedRight = current.velocityX > 0.55 && dx > 32 && Math.abs(dx) > Math.abs(dy);
      if (!current.active) return;
      event.preventDefault();
      event.stopPropagation();
      _clearDismissDrag(current.drawer);
      if (draggedRight || flickedRight) close();
    }, { capture: true });

    document.addEventListener('pointercancel', reset, { capture: true });
  }

  function _installHandleDismissGesture(handle, drawer) {
    if (!handle || !drawer || handle.__MeldexCloudMobileSideHandleDismissInstalled) return;
    handle.__MeldexCloudMobileSideHandleDismissInstalled = true;
    let drag = null;

    const reset = () => {
      if (drag?.active) _clearDismissDrag(drawer);
      drag = null;
    };

    handle.addEventListener('pointerdown', (event) => {
      if (!isOpen() || !drawer.classList.contains('open')) return;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastTime: performance.now(),
        velocityX: 0,
        active: false,
      };
      try { handle.setPointerCapture?.(event.pointerId); } catch {}
      event.preventDefault();
      event.stopPropagation();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const now = performance.now();
      const dt = Math.max(1, now - drag.lastTime);
      drag.velocityX = (event.clientX - drag.lastX) / dt;
      drag.lastX = event.clientX;
      drag.lastTime = now;
      if (!drag.active && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) drag.active = true;
      if (!drag.active) return;
      event.preventDefault();
      event.stopPropagation();
      _setDismissDrag(drawer, Math.max(0, dx));
    });

    handle.addEventListener('pointerup', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const current = drag;
      drag = null;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      const draggedRight = dx >= DISMISS_MIN_X && Math.abs(dx) > Math.abs(dy) && Math.abs(dy) <= DISMISS_MAX_Y;
      const flickedRight = current.velocityX > 0.55 && dx > 32 && Math.abs(dx) > Math.abs(dy);
      event.preventDefault();
      event.stopPropagation();
      _clearDismissDrag(drawer);
      if ((current.active && draggedRight) || flickedRight) close();
    });

    handle.addEventListener('pointercancel', reset);
  }

  function _fileName(path) {
    return String(path || '').split(/[/\\]/).pop() || String(path || '');
  }

  function _entityNoteTarget(entityPath, entityName) {
    const path = String(entityPath || '');
    if (!path) return { path: '', mode: 'file' };
    if (path.endsWith('.md')) return { path, mode: 'value' };
    return { path: path + '/_freetext.md', mode: 'file' };
  }

  function _parentDb(entityPath) {
    if (typeof _entityParentDir === 'function') return _entityParentDir(entityPath);
    const path = String(entityPath || '').replace(/\\/g, '/');
    const index = path.lastIndexOf('/');
    return index >= 0 ? path.slice(0, index) : '';
  }

  function _isPlaceholderOnly(el) {
    if (el?.querySelector?.('[data-cloud-mobile-placeholder="1"]')) return true;
    if (typeof _dpIsPlaceholderOnly === 'function') return _dpIsPlaceholderOnly(el);
    return false;
  }

  function _bindEditorHelpers(el) {
    if (typeof setupEditableDropHandler === 'function') setupEditableDropHandler(el);
    if (typeof bindNoteEditorContextMenu === 'function') bindNoteEditorContextMenu(el);
    if (typeof bindTableCellContextMenu === 'function') bindTableCellContextMenu(el);
  }

  function _bindAutoLinkClick(el) {
    if (!el) return;
    if (el._cloudMobileAutoLinkHandler) el.removeEventListener('click', el._cloudMobileAutoLinkHandler);
    el._cloudMobileAutoLinkHandler = (event) => {
      const link = event.target?.closest?.('.auto-link');
      if (!link || !el.contains(link) || typeof onAutoLinkClick !== 'function') return;
      event.preventDefault();
      onAutoLinkClick(link, event);
    };
    el.addEventListener('click', el._cloudMobileAutoLinkHandler);
  }

  async function _openParentDatabase(parentDb) {
    try {
      const ok = await _flushActiveEditor();
      if (!ok) return;
      if (typeof selectDatabase === 'function') await Promise.resolve(selectDatabase(parentDb));
      _renderSeq += 1;
      _hideDrawerNow();
    } catch {
      if (typeof showStatus === 'function') showStatus('親シートを開けませんでした', true);
    }
  }

  function _syncOpenButton() {
    const btn = document.querySelector('#' + DRAWER_ID + ' .cloud-mobile-side-drawer-open');
    if (!btn) return;
    const canOpen = !!_currentTarget && !_openingTarget;
    btn.hidden = !_currentTarget;
    btn.disabled = !canOpen;
    btn.setAttribute('aria-disabled', canOpen ? 'false' : 'true');
  }

  function _syncEntityChatButton() {
    const btn = document.querySelector('#' + DRAWER_ID + ' .cloud-mobile-side-drawer-chat');
    if (!btn) return;
    const canChat = _currentTarget?.kind === 'entity' && !!_currentTarget.entityPath;
    btn.hidden = !canChat;
    btn.disabled = !canChat;
    btn.setAttribute('aria-disabled', canChat ? 'false' : 'true');
  }

  function _syncHeaderButtons() {
    _syncOpenButton();
    _syncEntityChatButton();
  }

  function _setCurrentTarget(target) {
    _currentTarget = target || null;
    _syncHeaderButtons();
  }

  function _isVisible(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function _focusEditable(el) {
    if (!el || typeof el.focus !== 'function' || !_isVisible(el)) return false;
    try {
      el.focus({ preventScroll: false });
    } catch {
      el.focus();
    }
    if (el.isContentEditable && typeof document.createRange === 'function') {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    return true;
  }

  function _focusEntityEditor() {
    const ft = document.getElementById('entity-freetext');
    if (_focusEditable(ft)) return true;
    const createBtn = document.querySelector('#entity-create-note-btn button');
    if (createBtn && _isVisible(createBtn)) {
      createBtn.click();
      return true;
    }
    return false;
  }

  function _focusActualEditor(type) {
    const focusOnce = () => {
      if (type === 'entity' && _focusEntityEditor()) return true;
      const selectors = type === 'page'
        ? ['#page-content']
        : type === 'scriptnote'
          ? ['.sn2-text[contenteditable="true"]', '.sn2-text[contenteditable]']
          : type === 'board'
            ? ['#bd-canvas']
            : ['#page-content', '#entity-freetext', '.sn2-text[contenteditable="true"]', '.sn2-text[contenteditable]', '#board-note-editable', '[contenteditable="true"]'];
      for (const selector of selectors) {
        if (_focusEditable(document.querySelector(selector))) return true;
      }
      return false;
    };
    window.setTimeout(focusOnce, 80);
    window.setTimeout(focusOnce, 260);
  }

  function _hideDrawerNow() {
    const backdrop = document.getElementById(BACKDROP_ID);
    const drawer = document.getElementById(DRAWER_ID);
    _restorePortedPanel();
    backdrop?.classList?.remove('open');
    _clearDismissDrag(drawer);
    drawer?.classList?.remove('open');
    drawer?.setAttribute('aria-hidden', 'true');
    if (document.body) delete document.body.dataset.cloudMobileSideDrawerOpen;
    _setCurrentTarget(null);
  }

  function _restorePortedPanel() {
    const ported = _portedPanel;
    _portedPanel = null;
    if (!ported?.element) return;
    ported.element.classList.remove('cloud-mobile-side-drawer-panel-content');
    if (ported.placeholder?.parentNode) {
      ported.placeholder.parentNode.insertBefore(ported.element, ported.placeholder);
      ported.placeholder.remove();
    }
  }

  function _fallbackLinkEntry(target) {
    const path = String(target?.path || '').trim();
    const label = String(target?.label || _fileName(path) || path).trim() || path;
    const rawType = String(target?.linkType || '').trim();
    const type = typeof _bdResolveOpenType === 'function'
      ? _bdResolveOpenType(rawType)
      : (rawType === 'database' || rawType === 'sheet' ? 'pivot'
        : rawType === 'scenario' ? 'scriptnote'
          : rawType || 'page');
    return { type, label, path };
  }

  async function _resolveTargetEntry(target) {
    if (!target) return null;
    if (target.kind === 'entity') {
      return { type: 'entity', label: target.entityName || _fileName(target.entityPath), path: target.entityPath };
    }
    if (target.kind !== 'board-link') return null;
    if (typeof _bdResolveLinkedEntryAsync === 'function') {
      return _bdResolveLinkedEntryAsync(target.path, target.label, target.linkType);
    }
    return _fallbackLinkEntry(target);
  }

  async function _openCurrentTargetForEdit() {
    const target = _currentTarget;
    if (!target || _openingTarget) return;
    const actionSeq = _renderSeq;
    _openingTarget = true;
    _syncOpenButton();
    try {
      const ok = await _flushActiveEditor();
      if (!ok) return;
      if (actionSeq !== _renderSeq || target !== _currentTarget || !isOpen()) return;
      const entry = await _resolveTargetEntry(target);
      if (actionSeq !== _renderSeq || target !== _currentTarget || !isOpen()) return;
      if (!entry?.path && entry?.type !== 'html') return;
      _renderSeq += 1;
      _hideDrawerNow();
      if (typeof navOpen === 'function') {
        await Promise.resolve(navOpen(entry));
      } else if (entry.type === 'entity' && typeof selectEntity === 'function') {
        await Promise.resolve(selectEntity(entry.path));
      } else if (target.kind === 'board-link' && typeof bdOpenLinkedPath === 'function') {
        await Promise.resolve(bdOpenLinkedPath(target.path, target.label, { linkType: target.linkType }));
      } else {
        return;
      }
      _focusActualEditor(entry.type);
    } catch {
      if (typeof showStatus === 'function') showStatus('リンク先を開けませんでした', true);
    } finally {
      _openingTarget = false;
      _syncHeaderButtons();
    }
  }

  async function _openCurrentTargetChat() {
    const target = _currentTarget;
    if (target?.kind !== 'entity' || !target.entityPath) return;
    try {
      const ok = await _flushActiveEditor();
      if (!ok || target !== _currentTarget || !isOpen()) return;
      const path = String(target.entityPath);
      if (typeof window.openEntityChatForPath === 'function') {
        window.openEntityChatForPath(path);
      } else if (typeof window.openEntityAiChat === 'function') {
        window.openEntityAiChat(path);
      } else if (typeof openFileChat === 'function') {
        openFileChat(path);
      } else if (typeof showStatus === 'function') {
        showStatus('チャットを開けません', true);
      }
    } catch {
      if (typeof showStatus === 'function') showStatus('チャットを開けません', true);
    }
  }

  function _scheduleEditorSave(editorState) {
    if (!editorState) return;
    editorState.dirty = true;
    clearTimeout(editorState.timer);
    editorState.timer = setTimeout(() => { _saveEditor(editorState); }, 1800);
  }

  function _editorPayload(editorState) {
    const el = editorState?.el;
    if (!el || !editorState.path || _isPlaceholderOnly(el)) return null;
    const html = el.innerHTML;
    const bodyMd = typeof htmlToMd === 'function' ? htmlToMd(html) : el.textContent || '';
    return {
      path: editorState.path,
      mode: editorState.mode || 'file',
      html,
      content: (el.dataset.frontmatter || '') + bodyMd,
      bodyMd,
    };
  }

  async function _saveEditor(editorState) {
    if (!editorState) return true;
    clearTimeout(editorState.timer);
    editorState.timer = null;
    editorState.saveRequested = true;
    if (editorState.saving) return editorState.saving;

    editorState.saving = (async () => {
      let ok = true;
      while (editorState.saveRequested) {
        editorState.saveRequested = false;
        if (!editorState.dirty) continue;
        const payload = _editorPayload(editorState);
        if (!payload) {
          editorState.dirty = false;
          continue;
        }
        try {
          if (payload.mode === 'value') {
            await apiPut('/value?path=' + encodeURIComponent(payload.path), { new_body: payload.bodyMd });
          } else {
            await apiPut('/file?path=' + encodeURIComponent(payload.path), { content: payload.content });
          }
          if (editorState.el?.innerHTML === payload.html) {
            editorState.dirty = false;
          } else {
            editorState.dirty = true;
            editorState.saveRequested = true;
          }
        } catch {
          if (typeof showStatus === 'function') showStatus('エントリ本文の保存に失敗しました', true);
          ok = false;
          break;
        }
      }
      return ok;
    })();
    try {
      return await editorState.saving;
    } finally {
      editorState.saving = null;
    }
  }

  function _flushActiveEditor() {
    const editor = _activeEditor;
    if (!editor) return Promise.resolve(true);
    clearTimeout(editor.timer);
    editor.timer = null;
    return _saveEditor(editor).then((ok) => {
      if (ok || !editor.dirty) _activeEditor = null;
      return ok;
    });
  }

  function _ensureDrawer() {
    if (!document.body) return null;
    let backdrop = document.getElementById(BACKDROP_ID);
    let drawer = document.getElementById(DRAWER_ID);
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = BACKDROP_ID;
      backdrop.className = 'cloud-mobile-side-drawer-backdrop';
      backdrop.addEventListener('click', close);
      document.body.appendChild(backdrop);
    }
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.id = DRAWER_ID;
      drawer.className = 'cloud-mobile-side-drawer';
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'false');
      drawer.setAttribute('aria-labelledby', TITLE_ID);
      drawer.innerHTML = `
        <button type="button" class="cloud-mobile-drawer-handle cloud-mobile-right-drawer-handle" data-e2e-id="cloud-mobile-side-drawer-dismiss-handle" aria-label="詳細ドロワーを右へ閉じる" title="詳細ドロワーを右へ閉じる">${_iconHtml('chevronsRight', 20, '›')}</button>
        <div class="cloud-mobile-side-drawer-header">
          <strong id="${TITLE_ID}" class="cloud-mobile-side-drawer-title"></strong>
          <button type="button" class="cloud-mobile-side-drawer-chat" data-e2e-id="cloud-mobile-side-drawer-entity-chat" aria-label="チャットを開く" title="チャットを開く" hidden>${_iconHtml('messagesSquare', 20, 'Chat')}</button>
          <button type="button" class="cloud-mobile-side-drawer-open" data-e2e-id="cloud-mobile-side-drawer-open-main" aria-label="本画面で開いて編集" title="本画面で開いて編集">${_iconHtml('externalLink', 20, '↗')}</button>
          <button type="button" class="cloud-mobile-side-drawer-close" data-e2e-id="cloud-mobile-side-drawer-close" aria-label="閉じる" title="閉じる">${_iconHtml('x', 20, '×')}</button>
        </div>
        <div id="${BODY_ID}" class="cloud-mobile-side-drawer-body"></div>`;
      drawer.querySelector('.cloud-mobile-right-drawer-handle')?.addEventListener('click', close);
      drawer.querySelector('.cloud-mobile-side-drawer-chat')?.addEventListener('click', _openCurrentTargetChat);
      drawer.querySelector('.cloud-mobile-side-drawer-open')?.addEventListener('click', _openCurrentTargetForEdit);
      drawer.querySelector('.cloud-mobile-side-drawer-close')?.addEventListener('click', close);
      document.body.appendChild(drawer);
      _installDismissGesture(drawer);
      _installHandleDismissGesture(drawer.querySelector('.cloud-mobile-right-drawer-handle'), drawer);
      _syncHeaderButtons();
    }
    _installDismissGesture(drawer);
    _installHandleDismissGesture(drawer.querySelector('.cloud-mobile-right-drawer-handle'), drawer);
    return {
      backdrop,
      drawer,
      title: drawer.querySelector('#' + TITLE_ID),
      body: drawer.querySelector('#' + BODY_ID),
    };
  }

  function _openShellNow(title, kind) {
    if (!_isEnabled()) return null;
    const refs = _ensureDrawer();
    if (!refs?.body) return null;
    _restorePortedPanel();
    _renderSeq += 1;
    refs.title.textContent = title || '';
    refs.drawer.dataset.drawerKind = kind || '';
    refs.body.className = 'cloud-mobile-side-drawer-body';
    delete refs.body.dataset.previewPath;
    delete refs.body.dataset.previewMode;
    delete refs.body.dataset.previewRequestToken;
    refs.body.replaceChildren();
    document.body.dataset.cloudMobileSideDrawerOpen = '1';
    refs.backdrop.classList.add('open');
    refs.drawer.classList.add('open');
    refs.drawer.setAttribute('aria-hidden', 'false');
    _syncOpenButton();
    return refs.body;
  }

  function openElement(title, element, options) {
    if (!_isEnabled() || !element?.parentNode) return false;
    const parent = element.parentNode;
    const placeholder = document.createComment('cloud-mobile-side-drawer-panel-placeholder');
    _setCurrentTarget(null);
    const body = _openShellNow(title || '', options?.kind || 'panel');
    if (!body) return false;
    body.classList.add('cloud-mobile-side-drawer-body--panel');
    parent.insertBefore(placeholder, element);
    element.classList.add('cloud-mobile-side-drawer-panel-content');
    body.appendChild(element);
    _portedPanel = { element, placeholder };
    _syncHeaderButtons();
    return true;
  }

  function close() {
    _renderSeq += 1;
    const closeSeq = _renderSeq;
    _flushActiveEditor().then((ok) => {
      if (!ok || closeSeq !== _renderSeq) return;
      _hideDrawerNow();
    });
  }

  function _setLoading(body, text) {
    body.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'cloud-mobile-side-drawer-loading';
    loading.textContent = text || '読み込み中...';
    body.appendChild(loading);
  }

  function _setError(body, text) {
    body.replaceChildren();
    const error = document.createElement('div');
    error.className = 'cloud-mobile-side-drawer-error';
    error.textContent = text || '読み込みに失敗しました';
    body.appendChild(error);
  }

  function openBoardLink(path, label, linkType) {
    if (!_isEnabled() || !path) return false;
    const openSeq = ++_renderSeq;
    _flushActiveEditor().then((ok) => {
      if (!ok || openSeq !== _renderSeq) return;
      _setCurrentTarget({
        kind: 'board-link',
        path: String(path),
        label: label || _fileName(path),
        linkType: linkType || '',
      });
      const body = _openShellNow(label || _fileName(path), 'board-link');
      if (!body) {
        _setCurrentTarget(null);
        return;
      }
      body.classList.add('cloud-mobile-side-drawer-body--preview');
      _setLoading(body, 'リンク先を読み込み中...');
      if (typeof bdRenderLinkedPreview === 'function') {
        const renderSeq = _renderSeq;
        bdRenderLinkedPreview(String(path), body, linkType).catch(() => {
          if (renderSeq === _renderSeq) _setError(body, 'リンク先の表示に失敗しました');
        });
      } else {
        const pathEl = document.createElement('div');
        pathEl.className = 'cloud-mobile-side-drawer-path';
        pathEl.textContent = String(path);
        body.replaceChildren(pathEl);
      }
    });
    return true;
  }

  async function _renderEntity(body, entityPath, entityName, seq) {
    const name = entityName || _fileName(entityPath).replace(/\.md$/i, '');
    const noteTarget = _entityNoteTarget(entityPath, name);
    const parentDb = _parentDb(entityPath);
    try {
      const data = await apiFetch('/entity?path=' + encodeURIComponent(entityPath));
      if (seq !== _renderSeq) return;
      body.replaceChildren();

      const props = document.createElement('section');
      props.className = 'cloud-mobile-side-drawer-section cloud-mobile-side-drawer-props';
      const propsTitle = document.createElement('h3');
      propsTitle.textContent = '列';
      props.appendChild(propsTitle);
      if (parentDb) {
        const parent = document.createElement('button');
        parent.type = 'button';
        parent.className = 'cloud-mobile-side-drawer-parent';
        parent.dataset.e2eId = 'cloud-mobile-side-drawer-parent-db';
        parent.textContent = '← ' + (_fileName(parentDb) || parentDb);
        parent.title = parentDb;
        parent.addEventListener('click', () => { _openParentDatabase(parentDb); });
        props.appendChild(parent);
      }
      const grid = document.createElement('div');
      grid.className = 'cloud-mobile-side-drawer-props-grid';
      props.appendChild(grid);
      if (typeof renderEntityPropsGridInto === 'function') {
        renderEntityPropsGridInto(grid, data, entityPath, { parentDb });
      } else {
        grid.textContent = '列を表示できません';
      }
      body.appendChild(props);

      const page = document.createElement('section');
      page.className = 'cloud-mobile-side-drawer-section cloud-mobile-side-drawer-page';
      const pageTitle = document.createElement('h3');
      pageTitle.textContent = '本文';
      page.appendChild(pageTitle);
      const editor = document.createElement('div');
      editor.className = 'cloud-mobile-side-drawer-editable';
      editor.dataset.e2eId = 'cloud-mobile-side-drawer-entity-body';
      editor.setAttribute('role', 'textbox');
      editor.setAttribute('aria-label', name + 'の本文');
      editor.contentEditable = 'true';
      editor.dataset.path = noteTarget.path;
      editor.dataset.frontmatter = '';
      const rawContent = data.page_content || '';
      const fmMatch = rawContent.match(/^---\n[\s\S]*?\n---\n?/);
      const fm = fmMatch ? fmMatch[0] : '';
      const mdBody = fm ? rawContent.substring(fm.length) : rawContent;
      editor.dataset.frontmatter = fm;
      if (typeof _dpApplyNoteFileStyle === 'function') _dpApplyNoteFileStyle(editor, fm);
      if (mdBody.trim()) {
        editor.innerHTML = typeof applyAutoLinks === 'function' && typeof mdToHtml === 'function'
          ? applyAutoLinks(mdToHtml(mdBody, { basePath: entityPath }), entityPath)
          : mdBody;
      } else {
        const placeholder = document.createElement('span');
        placeholder.dataset.cloudMobilePlaceholder = '1';
        placeholder.style.color = 'var(--fg2)';
        placeholder.textContent = 'タップして本文を編集';
        editor.appendChild(placeholder);
      }
      const editorState = { el: editor, path: noteTarget.path, mode: noteTarget.mode, dirty: false, timer: null, saving: null, saveRequested: false };
      editor.addEventListener('focus', () => {
        const placeholder = editor.querySelector('[data-cloud-mobile-placeholder="1"]');
        if (placeholder) editor.replaceChildren();
      });
      editor.addEventListener('input', () => _scheduleEditorSave(editorState));
      editor.addEventListener('blur', () => { _saveEditor(editorState); });
      _bindAutoLinkClick(editor);
      _bindEditorHelpers(editor);
      _activeEditor = editorState;
      page.appendChild(editor);
      body.appendChild(page);
    } catch {
      if (seq !== _renderSeq) return;
      _setError(body, 'エントリの表示に失敗しました');
    }
  }

  function openEntity(entityPath, entityName) {
    if (!_isEnabled() || !entityPath) return false;
    const name = entityName || _fileName(entityPath).replace(/\.md$/i, '');
    const openSeq = ++_renderSeq;
    _flushActiveEditor().then((ok) => {
      if (!ok || openSeq !== _renderSeq) return;
      _setCurrentTarget({
        kind: 'entity',
        entityPath: String(entityPath),
        entityName: name,
      });
      const body = _openShellNow(name, 'entity');
      if (!body) {
        _setCurrentTarget(null);
        return;
      }
      const seq = _renderSeq;
      _setLoading(body, 'エントリを読み込み中...');
      _renderEntity(body, String(entityPath), name, seq);
    });
    return true;
  }

  function isOpen() {
    return document.body?.dataset?.cloudMobileSideDrawerOpen === '1';
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) close();
  });
  document.addEventListener('meldex-cloud-mobile-viewport', () => {
    if (!_isEnabled() && isOpen()) close();
  });

  window.MeldexCloudMobileSideDrawer = {
    isEnabled: _isEnabled,
    isOpen,
    openBoardLink,
    openEntity,
    openElement,
    close,
  };
})();
