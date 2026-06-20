/* ==============================
   gb-subpanel.js: persistent floating subpanel
   ============================== */

const GBSubPanel = (() => {
  const PANEL_ID = 'gb-subpanel';
  const PANE_ID = 'gb-subpanel-pane';
  const CONTENT_ID = 'gb-subpanel-content';
  const POS_KEY = 'subpanel-pos';
  const SIZE_KEY = 'subpanel-size';
  const STATE_KEY = 'subpanel-state';
  const MIN_W = 320;
  const MIN_H = 220;
  const EDGE = 8;
  const RESIZE_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

  let _panel = null;
  let _contentEl = null;
  let _titleIconEl = null;
  let _titleTextEl = null;
  let _actionsEl = null;
  let _minimizeBtn = null;
  let _pane = null;
  let _current = null;
  let _panelState = 'normal';
  let _restoreRect = null;
  let _drag = null;
  let _resize = null;
  let _entityRenderSeq = 0;

  function _readJson(key) {
    try {
      if (typeof localStorage === 'undefined') return null;
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (e) {
      return null;
    }
  }

  function _writeJson(key, value) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // localStorage can be unavailable in private or constrained contexts.
    }
  }

  function _writeState(state) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STATE_KEY, state);
    } catch (e) {
      // ignore
    }
  }

  function _storedState() {
    try {
      if (typeof localStorage === 'undefined') return 'normal';
      const state = localStorage.getItem(STATE_KEY);
      return ['normal', 'minimized', 'maximized'].includes(state) ? state : 'normal';
    } catch (e) {
      return 'normal';
    }
  }

  function _basename(path) {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || '';
  }

  function _toolLabel(toolType) {
    if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.toolLabel === 'function') {
      return GBPaneBridge.toolLabel(toolType);
    }
    const labels = {
      outliner: 'フォルダツリー',
      detail: 'オプション',
      preview: 'ビューワー',
      calendar: 'スケジューラー',
      timer: 'タイマー',
      chat: 'チャット',
      annotation: '注釈',
      history: 'ヒストリー',
      sticky: '付箋',
      scriptnote: 'シナリオ',
      search: '検索',
      version: 'バージョン管理',
      page: 'ノート',
      database: 'シート',
      pivot: 'シート',
      gallery: 'シート',
      kanban: 'シート',
      timeline: 'シート',
      chart: 'シート',
      graph: 'シート',
      form: 'シート',
      board: 'ボード',
      'smart-db': 'スマートシート',
      folder: 'フォルダ',
      entity: 'エントリ',
      media: 'メディア',
      html: 'HTML',
      csv: 'CSV',
      compare: '比較',
    };
    return labels[toolType] || toolType || '';
  }

  function _tabIcon(toolType) {
    if (typeof GBTabs !== 'undefined' && typeof GBTabs.tabIcon === 'function') return GBTabs.tabIcon(toolType);
    return 'layers-2';
  }

  function _isMobileDrawerEnabled() {
    const drawer = window.MeldexCloudMobileSideDrawer;
    return !!(drawer && typeof drawer.isEnabled === 'function' && drawer.isEnabled());
  }

  function _openMobileDrawer(toolType, options) {
    const drawer = window.MeldexCloudMobileSideDrawer;
    if (!_isMobileDrawerEnabled() || !options?.path) return false;
    const path = options.path;
    const label = options.label || _basename(path) || _toolLabel(toolType);
    const linkType = options.linkType || toolType;
    let opened = false;
    if ((linkType === 'entity' || toolType === 'entity') && typeof drawer.openEntity === 'function') {
      opened = drawer.openEntity(path, label) === true;
    } else if (typeof drawer.openBoardLink === 'function') {
      opened = drawer.openBoardLink(path, label, linkType) === true;
    }
    if (opened && _panel) close();
    return opened;
  }

  function _layoutZoom() {
    const zoom = typeof _getZoom === 'function'
      ? Number(_getZoom())
      : Number.parseFloat(document.documentElement?.style?.zoom || '1');
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  }

  function _viewport() {
    const zoom = _layoutZoom();
    return {
      width: Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0) / zoom,
      height: Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0) / zoom,
    };
  }

  function _rectSizeBounds() {
    const vp = _viewport();
    const maxW = Math.max(240, vp.width - EDGE * 2);
    const maxH = Math.max(180, vp.height - EDGE * 2);
    const minW = Math.min(MIN_W, maxW);
    const minH = Math.min(MIN_H, maxH);
    return { vp, maxW, maxH, minW, minH };
  }

  function _clampRect(rect) {
    const { vp, maxW, maxH, minW, minH } = _rectSizeBounds();
    const width = Math.min(Math.max(rect.width || MIN_W, minW), maxW);
    const height = Math.min(Math.max(rect.height || MIN_H, minH), maxH);
    const maxLeft = Math.max(EDGE, vp.width - width - EDGE);
    const maxTop = Math.max(EDGE, vp.height - height - EDGE);
    const left = Math.min(Math.max(EDGE, rect.left ?? EDGE), maxLeft);
    const top = Math.min(Math.max(EDGE, rect.top ?? EDGE), maxTop);
    return { left, top, width, height };
  }

  function _defaultRect() {
    const vp = _viewport();
    const width = Math.min(720, Math.max(MIN_W, Math.round(vp.width * 0.56)));
    const height = Math.min(520, Math.max(MIN_H, Math.round(vp.height * 0.62)));
    return _clampRect({
      left: Math.round((vp.width - width) / 2),
      top: Math.round((vp.height - height) / 2),
      width,
      height,
    });
  }

  function _loadRect() {
    const fallback = _defaultRect();
    const savedSize = _readJson(SIZE_KEY);
    const savedPos = _readJson(POS_KEY);
    const width = Number.isFinite(savedSize?.width) ? savedSize.width : fallback.width;
    const height = Number.isFinite(savedSize?.height) ? savedSize.height : fallback.height;
    const left = Number.isFinite(savedPos?.left)
      ? savedPos.left
      : Math.round((_viewport().width - width) / 2);
    const top = Number.isFinite(savedPos?.top)
      ? savedPos.top
      : Math.round((_viewport().height - height) / 2);
    return _clampRect({ left, top, width, height });
  }

  function _readRect() {
    if (!_panel) return _defaultRect();
    const rect = _panel.getBoundingClientRect();
    const zoom = _layoutZoom();
    return {
      left: rect.left / zoom,
      top: rect.top / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    };
  }

  function _layoutDelta(value) {
    return value / _layoutZoom();
  }

  function _applyRect(rect) {
    if (!_panel) return;
    const next = _clampRect(rect);
    _panel.style.left = next.left + 'px';
    _panel.style.top = next.top + 'px';
    _panel.style.width = next.width + 'px';
    _panel.style.height = next.height + 'px';
  }

  function _saveRect() {
    if (!_panel || _panelState !== 'normal') return;
    const rect = _readRect();
    _writeJson(POS_KEY, { left: Math.round(rect.left), top: Math.round(rect.top) });
    _writeJson(SIZE_KEY, { width: Math.round(rect.width), height: Math.round(rect.height) });
  }

  function _setPanelState(state, options = {}) {
    if (!_panel) return;
    _panelState = state;
    _panel.classList.toggle('is-minimized', state === 'minimized');
    _panel.classList.toggle('is-maximized', state === 'maximized');
    _panel.setAttribute('aria-expanded', state === 'minimized' ? 'false' : 'true');
    if (_minimizeBtn) {
      _minimizeBtn.title = state === 'minimized' ? '復元' : '最小化';
      _minimizeBtn.setAttribute('aria-label', _minimizeBtn.title);
      _minimizeBtn.innerHTML = typeof lucide === 'function'
        ? lucide(state === 'minimized' ? 'square' : 'minus', 16)
        : (state === 'minimized' ? '□' : '-');
    }
    if (options.save !== false) _writeState(state);
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  function _restoreNormal(options = {}) {
    _setPanelState('normal', options);
    if (_restoreRect) _applyRect(_restoreRect);
    _restoreRect = null;
    _saveRect();
  }

  function _toggleMinimized() {
    if (_panelState === 'minimized') {
      _restoreNormal();
      return;
    }
    if (_panelState === 'normal') _saveRect();
    _setPanelState('minimized');
  }

  function _toggleMaximized() {
    if (_panelState === 'maximized') {
      _restoreNormal();
      return;
    }
    if (_panelState === 'normal') {
      _saveRect();
      _restoreRect = _readRect();
    }
    _setPanelState('maximized');
    _applyRect({
      left: EDGE,
      top: EDGE,
      width: Math.max(240, _viewport().width - EDGE * 2),
      height: Math.max(180, _viewport().height - EDGE * 2),
    });
  }

  function _applyStoredGeometry() {
    _applyRect(_loadRect());
    const state = _storedState();
    if (state === 'maximized') {
      _restoreRect = _readRect();
      _setPanelState('maximized', { save: false });
      _applyRect({
        left: EDGE,
        top: EDGE,
        width: Math.max(240, _viewport().width - EDGE * 2),
        height: Math.max(180, _viewport().height - EDGE * 2),
      });
    } else if (state === 'minimized') {
      _setPanelState('minimized', { save: false });
    } else {
      _setPanelState('normal', { save: false });
    }
  }

  function _registerPaneMap() {
    if (!_pane || !_contentEl || typeof GBLayout === 'undefined' || !GBLayout.paneMap) return;
    GBLayout.paneMap[_pane.id] = { node: _pane, el: _panel, contentEl: _contentEl };
  }

  function _retractCurrentContent(options = {}) {
    if (!_pane || !_contentEl) return;
    _registerPaneMap();
    try {
      if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.retractPaneContent === 'function') {
        GBPaneBridge.retractPaneContent(_pane.id);
      }
      const tabId = _pane.tabs?.[0]?.id || '';
      if (tabId && typeof removeComponentInstance === 'function') {
        removeComponentInstance(tabId);
      }
    } finally {
      if (typeof GBLayout !== 'undefined' && GBLayout.paneMap) delete GBLayout.paneMap[_pane.id];
      _contentEl.innerHTML = '';
    }
    if (options.remount && typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.mountAllPanes === 'function') {
      GBPaneBridge.mountAllPanes();
    }
  }

  function _titleFromOptions(toolType, options) {
    if (options?.label) return options.label;
    if (options?.path) return _basename(options.path) || _toolLabel(toolType);
    return _toolLabel(toolType);
  }

  function _subpanelTitle(toolType) {
    const label = _toolLabel(toolType);
    return (label ? label + ' ' : '') + 'サブパネル';
  }

  function _entityParentDir(path) {
    const normalized = String(path || '').replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx > 0 ? normalized.slice(0, idx) : '';
  }

  function _entityNameFromData(data, path) {
    return data?.entity || _basename(path).replace(/\.md$/, '') || 'エントリ';
  }

  function _firstPropertyValue(data, propName) {
    const values = data?.properties?.[propName];
    if (!Array.isArray(values)) return '';
    for (const item of values) {
      const value = String(item?.value ?? '').trim();
      if (value) return value;
    }
    return '';
  }

  function _htmlSnapshotPathFromEntity(data) {
    const htmlPath = _firstPropertyValue(data, 'HTML');
    if (!htmlPath || !/\.html?(?:$|[?#])/i.test(htmlPath)) return '';
    return htmlPath.replace(/\\/g, '/');
  }

  function _fileRawUrl(path) {
    const value = String(path || '').trim();
    if (!value) return '';
    if (/^(?:https?:|data:|blob:|\/api\/)/i.test(value)) return value;
    if (window.MeldexResourceUrl && typeof window.MeldexResourceUrl.fileRaw === 'function') {
      return window.MeldexResourceUrl.fileRaw(value);
    }
    return '/api/file-raw?path=' + encodeURIComponent(value);
  }

  function _appendEntityParentLink(root, entityPath) {
    const parentDb = _entityParentDir(entityPath);
    const parent = document.createElement('div');
    parent.className = 'gb-subpanel-entity-parent';
    if (parentDb) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'gb-subpanel-link-button';
      link.dataset.e2eId = 'gb-subpanel-entity-parent';
      link.setAttribute('aria-label', '親シートを開く');
      link.textContent = '← ' + (_basename(parentDb) || parentDb);
      link.addEventListener('click', () => {
        if (typeof selectDatabase === 'function') selectDatabase(parentDb);
      });
      parent.appendChild(link);
    }
    root.appendChild(parent);
  }

  function _renderEntityNote(noteEl, data, entityPath) {
    const htmlPath = _htmlSnapshotPathFromEntity(data);
    const raw = String(data?.page_content || '');
    noteEl.innerHTML = '';
    if (htmlPath) {
      const preview = document.createElement('div');
      preview.className = 'gb-subpanel-webclip-html';

      const toolbar = document.createElement('div');
      toolbar.className = 'gb-subpanel-webclip-toolbar';

      const label = document.createElement('div');
      label.className = 'gb-subpanel-webclip-label';
      label.textContent = 'HTMLスナップショット';
      toolbar.appendChild(label);

      const openLink = document.createElement('a');
      openLink.className = 'gb-subpanel-webclip-open';
      openLink.href = _fileRawUrl(htmlPath);
      openLink.target = '_blank';
      openLink.rel = 'noopener noreferrer';
      openLink.textContent = '別画面で開く';
      toolbar.appendChild(openLink);

      const frame = document.createElement('iframe');
      frame.className = 'gb-subpanel-webclip-frame';
      frame.title = '保存したHTML';
      frame.src = _fileRawUrl(htmlPath);
      frame.setAttribute('sandbox', 'allow-same-origin allow-forms allow-popups');

      preview.appendChild(toolbar);
      preview.appendChild(frame);
      noteEl.appendChild(preview);
      return;
    }
    if (!raw.trim()) {
      const empty = document.createElement('div');
      empty.className = 'gb-subpanel-empty-note';
      empty.textContent = 'ノートはありません';
      noteEl.appendChild(empty);
      return;
    }
    if (typeof mdToHtml === 'function') {
      const html = mdToHtml(raw);
      noteEl.innerHTML = typeof applyAutoLinks === 'function' ? applyAutoLinks(html, entityPath) : html;
    } else {
      noteEl.textContent = raw;
    }
  }

  function _renderEntityData(root, data, entityPath) {
    root.innerHTML = '';
    root.dataset.path = entityPath;
    _appendEntityParentLink(root, entityPath);

    const title = document.createElement('h2');
    title.className = 'gb-subpanel-entity-title';
    title.textContent = _entityNameFromData(data, entityPath);
    root.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'gb-subpanel-entity-props';
    root.appendChild(grid);
    if (typeof renderEntityPropsGridInto === 'function') {
      renderEntityPropsGridInto(grid, data, entityPath, {
        parentDb: _entityParentDir(entityPath),
        subPanel: true,
      });
    } else {
      for (const [name, values] of Object.entries(data?.properties || {})) {
        const row = document.createElement('div');
        row.className = 'gb-subpanel-entity-prop-row';
        const label = document.createElement('div');
        label.className = 'gb-subpanel-entity-prop-name';
        label.textContent = name;
        const value = document.createElement('div');
        value.className = 'gb-subpanel-entity-prop-value';
        value.textContent = (Array.isArray(values) ? values : [])
          .map(item => item?.value ?? '')
          .filter(Boolean)
          .join(' / ');
        row.appendChild(label);
        row.appendChild(value);
        grid.appendChild(row);
      }
    }

    const note = document.createElement('div');
    note.className = 'gb-subpanel-entity-note';
    _renderEntityNote(note, data, entityPath);
    root.appendChild(note);
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  async function _loadEntityIntoRoot(root, entityPath, seq) {
    if (!root || !entityPath) return;
    root.innerHTML = '<div class="gb-subpanel-empty">エントリを読み込み中...</div>';
    try {
      if (typeof apiFetch !== 'function') throw new Error('apiFetch is not available');
      const data = await apiFetch('/entity?path=' + encodeURIComponent(entityPath));
      if (seq !== _entityRenderSeq || !root.isConnected || root.dataset.path !== entityPath) return;
      _renderEntityData(root, data, entityPath);
    } catch (e) {
      if (seq !== _entityRenderSeq || !root.isConnected) return;
      root.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'gb-subpanel-empty';
      empty.textContent = 'エントリを読み込めませんでした';
      root.appendChild(empty);
    }
  }

  function _mountEntityPane(options) {
    const entityPath = options?.path || '';
    _pane = _createPane('entity', options);
    _registerPaneMap();
    const root = document.createElement('div');
    root.className = 'gb-subpanel-entity-root';
    root.dataset.gbSubpanelEntityRoot = 'true';
    root.dataset.path = entityPath;
    _contentEl.appendChild(root);
    const tabId = _pane.tabs?.[0]?.id || '';
    _current = {
      toolType: 'entity',
      path: entityPath,
      label: _titleFromOptions('entity', options),
      tabId,
    };
    const seq = ++_entityRenderSeq;
    _loadEntityIntoRoot(root, entityPath, seq);
  }

  function _updateTitle(toolType, title) {
    if (_titleIconEl) {
      _titleIconEl.innerHTML = typeof lucide === 'function' ? lucide(_tabIcon(toolType), 16) : '';
    }
    if (_titleTextEl) _titleTextEl.textContent = title || _subpanelTitle(toolType);
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  function _openEntityChat(path) {
    if (!path) {
      if (typeof showStatus === 'function') showStatus('対象エントリが選択されていません', true);
      return;
    }
    if (typeof window.openEntityChatForPath === 'function') {
      window.openEntityChatForPath(path);
    } else if (typeof window.openEntityAiChat === 'function') {
      window.openEntityAiChat(path);
    } else if (typeof openFileChat === 'function') {
      openFileChat(path);
    } else if (typeof showStatus === 'function') {
      showStatus('チャットを開けません', true);
    }
  }

  function _clearContextActions() {
    if (!_actionsEl) return;
    _actionsEl.querySelectorAll('[data-gb-subpanel-context-action]').forEach(el => el.remove());
  }

  function _updateContextActions(toolType, options) {
    _clearContextActions();
    if (!_actionsEl || toolType !== 'entity' || !options?.path) return;
    const chatBtn = document.createElement('button');
    chatBtn.type = 'button';
    chatBtn.className = 'gb-subpanel-button';
    chatBtn.dataset.gbSubpanelContextAction = 'entity-chat';
    chatBtn.dataset.testid = 'gb-subpanel-entity-chat';
    chatBtn.title = 'チャットを開く';
    chatBtn.setAttribute('aria-label', 'チャットを開く');
    chatBtn.innerHTML = typeof lucide === 'function' ? lucide('messagesSquare', 16) : 'Chat';
    chatBtn.addEventListener('click', () => _openEntityChat(options.path));
    _actionsEl.insertBefore(chatBtn, _minimizeBtn || _actionsEl.firstChild);
  }

  function _onTitlePointerDown(e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    if (_panelState === 'maximized') return;
    _drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      rect: _readRect(),
    };
    document.addEventListener('pointermove', _onPointerMove, true);
    document.addEventListener('pointerup', _onPointerUp, true);
    e.preventDefault();
  }

  function _onResizePointerDown(e) {
    if (e.button !== 0 || _panelState !== 'normal') return;
    _resize = {
      pointerId: e.pointerId,
      dir: e.currentTarget.dataset.resizeDir || '',
      startX: e.clientX,
      startY: e.clientY,
      rect: _readRect(),
    };
    document.addEventListener('pointermove', _onPointerMove, true);
    document.addEventListener('pointerup', _onPointerUp, true);
    e.preventDefault();
  }

  function _resizeRect(session, dx, dy) {
    const dir = session.dir;
    const rect = { ...session.rect };
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;
    const { minW, minH, maxW, maxH } = _rectSizeBounds();
    if (dir.includes('e')) rect.width += dx;
    if (dir.includes('s')) rect.height += dy;
    if (dir.includes('w')) {
      rect.left += dx;
      rect.width = right - rect.left;
      rect.width = Math.min(Math.max(rect.width, minW), maxW);
      rect.left = right - rect.width;
    }
    if (dir.includes('n')) {
      rect.top += dy;
      rect.height = bottom - rect.top;
      rect.height = Math.min(Math.max(rect.height, minH), maxH);
      rect.top = bottom - rect.height;
    }
    return rect;
  }

  function _onPointerMove(e) {
    if (_drag && e.pointerId === _drag.pointerId) {
      _applyRect({
        ..._drag.rect,
        left: _drag.rect.left + _layoutDelta(e.clientX - _drag.startX),
        top: _drag.rect.top + _layoutDelta(e.clientY - _drag.startY),
      });
      e.preventDefault();
      return;
    }
    if (_resize && e.pointerId === _resize.pointerId) {
      _applyRect(_resizeRect(
        _resize,
        _layoutDelta(e.clientX - _resize.startX),
        _layoutDelta(e.clientY - _resize.startY)
      ));
      e.preventDefault();
    }
  }

  function _onPointerUp(e) {
    if (_drag && e.pointerId === _drag.pointerId) {
      _drag = null;
      _saveRect();
    }
    if (_resize && e.pointerId === _resize.pointerId) {
      _resize = null;
      _saveRect();
    }
    if (!_drag && !_resize) {
      document.removeEventListener('pointermove', _onPointerMove, true);
      document.removeEventListener('pointerup', _onPointerUp, true);
    }
  }

  function _onWindowResize() {
    if (!_panel) return;
    if (_panelState === 'maximized') {
      _applyRect({
        left: EDGE,
        top: EDGE,
        width: Math.max(240, _viewport().width - EDGE * 2),
        height: Math.max(180, _viewport().height - EDGE * 2),
      });
      return;
    }
    _applyRect(_readRect());
    _saveRect();
  }

  function _ensurePanel() {
    if (_panel) return;
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'gb-subpanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');

    const titlebar = document.createElement('div');
    titlebar.className = 'gb-subpanel-titlebar';
    titlebar.addEventListener('pointerdown', _onTitlePointerDown);
    titlebar.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button')) _toggleMaximized();
    });

    const title = document.createElement('div');
    title.className = 'gb-subpanel-title';
    _titleIconEl = document.createElement('span');
    _titleIconEl.className = 'gb-subpanel-title-icon';
    _titleTextEl = document.createElement('span');
    _titleTextEl.className = 'gb-subpanel-title-text';
    title.appendChild(_titleIconEl);
    title.appendChild(_titleTextEl);

    const actions = document.createElement('div');
    actions.className = 'gb-subpanel-actions';
    _actionsEl = actions;
    _minimizeBtn = document.createElement('button');
    _minimizeBtn.type = 'button';
    _minimizeBtn.className = 'gb-subpanel-button';
    _minimizeBtn.dataset.testid = 'gb-subpanel-minimize';
    _minimizeBtn.addEventListener('click', _toggleMinimized);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gb-subpanel-button';
    closeBtn.dataset.testid = 'gb-subpanel-close';
    closeBtn.title = '閉じる';
    closeBtn.setAttribute('aria-label', '閉じる');
    closeBtn.innerHTML = typeof lucide === 'function' ? lucide('x', 16) : 'x';
    closeBtn.addEventListener('click', () => close());
    actions.appendChild(_minimizeBtn);
    actions.appendChild(closeBtn);

    _contentEl = document.createElement('div');
    _contentEl.id = CONTENT_ID;
    _contentEl.className = 'gb-subpanel-content';

    titlebar.appendChild(title);
    titlebar.appendChild(actions);
    panel.appendChild(titlebar);
    panel.appendChild(_contentEl);

    RESIZE_DIRS.forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = 'gb-subpanel-resize gb-subpanel-resize-' + dir;
      handle.dataset.resizeDir = dir;
      handle.addEventListener('pointerdown', _onResizePointerDown);
      panel.appendChild(handle);
    });

    document.body.appendChild(panel);
    _panel = panel;
    _applyStoredGeometry();
    window.addEventListener('resize', _onWindowResize);
  }

  function _createPane(toolType, options) {
    const label = _titleFromOptions(toolType, options);
    const tab = typeof GBTabs !== 'undefined' && typeof GBTabs.createTab === 'function'
      ? GBTabs.createTab(label, toolType, options?.path || '', options?.state || null)
      : { id: 'subpanel-tab-' + Date.now(), label, type: toolType, path: options?.path || '', state: options?.state || null };
    return {
      id: PANE_ID,
      type: 'pane',
      tabs: [tab],
      activeTabIndex: 0,
    };
  }

  function _mountPane(toolType, options) {
    _retractCurrentContent({ remount: true });
    if (toolType === 'entity' && options?.path) {
      _mountEntityPane(options);
      return;
    }
    _pane = _createPane(toolType, options);
    _registerPaneMap();
    const mounted = typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.mountVirtualPane === 'function'
      ? GBPaneBridge.mountVirtualPane(_pane, _contentEl, { subPanel: true })
      : false;
    if (!mounted) {
      const empty = document.createElement('div');
      empty.className = 'gb-subpanel-empty';
      empty.textContent = 'この内容はサブパネルで表示できません';
      _contentEl.appendChild(empty);
    }
    _current = {
      toolType,
      path: options?.path || '',
      label: _titleFromOptions(toolType, options),
      tabId: _pane.tabs?.[0]?.id || '',
    };
  }

  function open(toolType, options = {}) {
    const normalizedType = toolType || options.toolType || options.type || 'preview';
    if (_openMobileDrawer(normalizedType, options)) return true;
    _ensurePanel();
    _updateTitle(normalizedType, _subpanelTitle(normalizedType));
    _updateContextActions(normalizedType, options);
    _mountPane(normalizedType, options);
    _panel.hidden = false;
    _panel.focus?.();
    if (typeof replaceIcons === 'function') replaceIcons();
    return true;
  }

  function close(toolType) {
    if (toolType && _current?.toolType !== toolType) return false;
    if (!_panel) return false;
    _saveRect();
    _retractCurrentContent();
    _pane = null;
    _current = null;
    document.removeEventListener('pointermove', _onPointerMove, true);
    document.removeEventListener('pointerup', _onPointerUp, true);
    window.removeEventListener('resize', _onWindowResize);
    _panel.remove();
    _panel = null;
    _contentEl = null;
    _titleIconEl = null;
    _titleTextEl = null;
    _actionsEl = null;
    _minimizeBtn = null;
    _drag = null;
    _resize = null;
    return true;
  }

  function toggle(toolType, options = {}) {
    const normalizedType = toolType || options.toolType || options.type || 'preview';
    const path = options.path || '';
    if (_panel && _current?.toolType === normalizedType && (_current.path || '') === path) {
      return close(normalizedType);
    }
    return open(normalizedType, options);
  }

  function isOpen(toolType) {
    if (!_panel) return false;
    if (!toolType) return true;
    return _current?.toolType === toolType;
  }

  return {
    open,
    close,
    toggle,
    isOpen,
    openEntityChat: _openEntityChat,
  };
})();

window.GBSubPanel = GBSubPanel;
