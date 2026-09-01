  // === アクティブペイン管理 ===
  let _onActivePaneChange = null;
  let _isNavPaneType = null; // (type) => bool — ナビペイン判定（pane-bridge が設定）
  let _isPassivePaneType = null; // (type, tab, pane) => bool — 作業アクティブを奪わない補助ペイン判定

  function _isPassivePaneTab(tab, pane) {
    if (!tab || typeof _isPassivePaneType !== 'function') return false;
    try {
      return !!_isPassivePaneType(tab.type, tab, pane);
    } catch {
      return false;
    }
  }

  function _isPassivePaneActiveTab(pane) {
    const activeTab = pane?.tabs?.[pane?.activeTabIndex];
    return _isPassivePaneTab(activeTab, pane);
  }

  function _scrollSnapshotKey(el, fallbackIndex) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return 'id:' + el.id;
    const stable = ['data-pane-id', 'data-tab-id', 'data-bd-role', 'data-rp-tab', 'data-field', 'data-action']
      .map(name => el.getAttribute?.(name) ? `${name}=${el.getAttribute(name)}` : '')
      .filter(Boolean)
      .join('|');
    if (stable) {
      const parentId = el.parentElement?.id ? `#${el.parentElement.id}` : '';
      return `stable:${parentId}:${stable}`;
    }
    const path = [];
    let cur = el;
    let guard = 0;
    while (cur && cur !== document.body && cur !== _layoutEl && guard < 8) {
      let part = cur.tagName ? cur.tagName.toLowerCase() : 'el';
      if (cur.classList?.length) part += '.' + [...cur.classList].slice(0, 2).join('.');
      const parent = cur.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(item => item.tagName === cur.tagName);
        const idx = siblings.indexOf(cur);
        if (idx >= 0) part += `:nth-${idx}`;
      }
      path.unshift(part);
      cur = parent;
      guard += 1;
    }
    return 'path:' + path.join('>') + ':' + fallbackIndex;
  }

  function _addViewportSnapshotElement(result, seen, el) {
    if (!el || el.nodeType !== 1 || seen.has(el)) return;
    seen.add(el);
    result.push(el);
  }

  function _collectViewportSnapshotElements() {
    const result = [];
    const seen = new Set();
    _addViewportSnapshotElement(result, seen, document.scrollingElement || document.documentElement);
    _addViewportSnapshotElement(result, seen, document.body);
    const selectors = [
      '#gb-layout-root',
      '#legacy-views',
      '#main-views',
      '#right-panel',
      '.gb-pane-content',
      '.gb-pane-tabs-scroll',
      '#outliner-tree',
      '#folder-grid',
      '#page-content',
      '#entity-freetext',
      '#db-view-container',
      '#compare-view',
      '#media-view',
      '#html-view',
      '#csv-view',
      '#gb-preview-pane',
      '#rp-detail',
      '#rp-chat',
      '#rp-history',
      '#rp-annotation',
      '[data-bd-role]',
      '[data-scroll-key]',
      '[style*="overflow"]',
      '[class*="scroll"]'
    ];
    try {
      document.querySelectorAll(selectors.join(',')).forEach(el => _addViewportSnapshotElement(result, seen, el));
    } catch {}
    let cur = document.activeElement;
    let guard = 0;
    while (cur && cur !== document.body && guard < 8) {
      _addViewportSnapshotElement(result, seen, cur);
      cur = cur.parentElement;
      guard += 1;
    }
    return result;
  }

  function _captureViewportSnapshot() {
    const scroll = new Map();
    const entries = [];
    const nodes = _collectViewportSnapshotElements();
    nodes.forEach((el, index) => {
      if (!el || typeof el.scrollTop !== 'number' || typeof el.scrollLeft !== 'number') return;
      const canScroll = (el.scrollHeight > el.clientHeight + 1) || (el.scrollWidth > el.clientWidth + 1);
      if (!canScroll && !el.scrollTop && !el.scrollLeft) return;
      const key = _scrollSnapshotKey(el, index);
      if (key) {
        const pos = { top: el.scrollTop, left: el.scrollLeft };
        scroll.set(key, pos);
        entries.push({ key, id: el.id || '', el, top: pos.top, left: pos.left });
      }
    });
    let board = null;
    try {
      if (typeof bd !== 'undefined' && bd?.path) {
        board = { path: bd.path, zoom: bd.zoom, panX: bd.panX, panY: bd.panY, rotation: bd.rotation };
      }
    } catch {}
    return { scroll, entries, board };
  }

  function _restoreScrollSnapshotEntry(entry) {
    if (!entry) return false;
    let el = entry.el && entry.el.isConnected ? entry.el : null;
    if (!el && entry.id) el = document.getElementById(entry.id);
    if (!el) return false;
    if (typeof el.scrollTop === 'number') el.scrollTop = entry.top;
    if (typeof el.scrollLeft === 'number') el.scrollLeft = entry.left;
    return true;
  }

  function _restoreViewportSnapshot(snapshot) {
    if (!snapshot) return;
    const restoredKeys = new Set();
    if (Array.isArray(snapshot.entries)) {
      snapshot.entries.forEach(entry => {
        if (_restoreScrollSnapshotEntry(entry)) restoredKeys.add(entry.key);
      });
    }
    if (snapshot.scroll instanceof Map && restoredKeys.size < snapshot.scroll.size) {
      const nodes = _collectViewportSnapshotElements();
      nodes.forEach((el, index) => {
        const key = _scrollSnapshotKey(el, index);
        if (!key || restoredKeys.has(key)) return;
        const pos = snapshot.scroll.get(key);
        if (!pos) return;
        if (typeof el.scrollTop === 'number') el.scrollTop = pos.top;
        if (typeof el.scrollLeft === 'number') el.scrollLeft = pos.left;
        restoredKeys.add(key);
      });
    }
    try {
      if (snapshot.board && typeof bd !== 'undefined' && bd?.path === snapshot.board.path) {
        bd.zoom = snapshot.board.zoom;
        bd.panX = snapshot.board.panX;
        bd.panY = snapshot.board.panY;
        bd.rotation = snapshot.board.rotation;
        if (typeof bdTransform === 'function') bdTransform();
      }
    } catch {}
  }

  function _isPaneInteractivePointerTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest([
      'input',
      'textarea',
      'select',
      'button',
      'a[href]',
      '[contenteditable="true"]',
      '[role="button"]',
      '.gb-tab',
      '.gb-pane-tabs',
      '.gb-pane-ctrls',
      '.gb-pane-nav-ctrls',
      '.gb-context-menu',
      '.modal',
      '.cf-modal',
    ].join(','));
  }

  function _isChatInputFocusNode(node) {
    if (!node || !(node instanceof Element)) return false;
    return !!node.closest('#chat-rich-input, #chat-input, .chat-rich-input');
  }

  function _blurFocusedChatInputForWorkPanePointer(node, target) {
    if (!target || !(target instanceof Element)) return;
    if (!target.closest('.gb-pane-content')) return;
    const activeTab = node?.tabs?.[node?.activeTabIndex];
    if (!activeTab || activeTab.type === 'chat') return;
    if (_isNavPaneType && _isNavPaneType(activeTab.type)) return;
    const active = document.activeElement;
    if (!_isChatInputFocusNode(active)) return;
    active.blur?.();
  }

  function _isPaneWorkContentPointerTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest([
      '#db-view-container',
      '#pivot-view',
      '.pivot-view',
      '#tree-view',
      '.tree-view',
      '.pivot-table',
      'td[data-prop-name]',
      'td.col-entity',
      '.value-text',
      '.relation-link',
      '.multi-select-tag',
      '.cell-checkbox',
      '.cell-select-val',
      '.entity-row-more-btn',
      '.cell-add-btn',
      '.db-action-btn',
      '#timeline-view',
      '.tl-grid',
      '.tl-card',
      '#gallery-view',
      '.gallery-view',
      '.db-gallery-card',
      '#kanban-view',
      '.kanban-view',
      '.kanban-card',
      '#page-view',
      '#page-content',
      '#entity-view',
      '#entity-freetext',
      '.gb-scriptnote-root',
      '#board-view',
      '#bd-canvas',
      '#bd-world',
      '#folder-view',
      '#folder-grid',
    ].join(','));
  }

  function _shouldPreserveActivePaneForNavContentPointer(node, target) {
    if (!_activePane || !_paneMap[_activePane] || _activePane === node?.id) return false;
    if (!target || !(target instanceof Element)) return false;
    const activeTab = node?.tabs?.[node?.activeTabIndex];
    if (!(_isNavPaneType && _isNavPaneType(activeTab?.type))) return false;
    return !!target.closest('.gb-pane-content');
  }

  function _activatePaneAfterCurrentPointerClick(paneId) {
    setActivePane(paneId, { skipCallback: true });
    let done = false;
    let fallbackTimer = null;
    let pointerUpTimer = null;
    let pointerStillDown = true;
    const cleanup = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', finish, true);
      if (fallbackTimer != null) clearTimeout(fallbackTimer);
      if (pointerUpTimer != null) clearTimeout(pointerUpTimer);
    };
    const scheduleFallback = () => {
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (pointerStillDown) {
          scheduleFallback();
          return;
        }
        finish();
      }, 2000);
    };
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      setTimeout(() => {
        if (_activePane === paneId) setActivePane(paneId, { sync: true });
      }, 0);
    };
    const onClick = () => { pointerStillDown = false; finish(); };
    const onPointerMove = (e) => {
      pointerStillDown = !!(e && typeof e.buttons === 'number' ? (e.buttons & 1) : pointerStillDown);
    };
    const onPointerUp = () => {
      pointerStillDown = false;
      if (pointerUpTimer == null) pointerUpTimer = setTimeout(finish, 80);
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', finish, true);
    scheduleFallback();
  }

  function setActivePane(paneId, opts) {
    // unmount 済みペイン（他グループに属する等）への切替は無視する。
    // グループ切替直後の幽霊ID指し防止。
    if (paneId && !_paneMap[paneId]) return;
    const sync = !!(opts && opts.sync);
    const prev = _activePane;
    _activePane = paneId;
    _writeActivePaneToStorage();

    // CSSクラス更新（常に同期。青枠の視覚表示）
    if (prev && _paneMap[prev]) {
      _paneMap[prev].el.classList.remove('gb-pane-active');
    }
    if (_paneMap[paneId]) {
      _paneMap[paneId].el.classList.add('gb-pane-active');
    }
    if (opts && opts.skipCallback) return;

    // _onActivePaneChange → _mountAllPanes がスクロール位置を壊す可能性があるため、
    // 全ペインのスクロール位置を保存し、コールバック後に復元する。
    // pointerdown 経由のコンテンツクリックは _activatePaneAfterCurrentPointerClick で
    // click 配信後に同期コールバックへ進める。
    // navOpen 等の直後処理に依存する呼び出しは { sync: true } で同期実行する。
    const runCallback = () => {
      if (_activePane !== paneId) return;
      const viewportSnap = _captureViewportSnapshot();
      if (_onActivePaneChange) _onActivePaneChange(paneId, prev);
      _restoreViewportSnapshot(viewportSnap);
      queueMicrotask(() => _restoreViewportSnapshot(viewportSnap));
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => _restoreViewportSnapshot(viewportSnap));
      setTimeout(() => _restoreViewportSnapshot(viewportSnap), 80);
    };
    if (sync) runCallback();
    else queueMicrotask(runCallback);
  }
