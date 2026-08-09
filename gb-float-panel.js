/* ==============================
   gb-float-panel.js: floating panel (formerly named "subpanel" internally;
   the "subpanel" name is now reserved for the persistent right-sidebar surface)
   ============================== */

const GBFloatPanel = (() => {
  const PANEL_ID = 'gb-float-panel';
  const PANE_ID = 'gb-float-panel-pane';
  const CONTENT_ID = 'gb-float-panel-content';
  const POS_KEY = 'float-panel-pos';
  const SIZE_KEY = 'float-panel-size';
  const STATE_KEY = 'float-panel-state';
  // 旧「サブパネル」時代のキー。一度だけ新キーへ移行する（_migrateLegacyStorage参照）。
  const LEGACY_POS_KEY = 'subpanel-pos';
  const LEGACY_SIZE_KEY = 'subpanel-size';
  const LEGACY_STATE_KEY = 'subpanel-state';
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
  let _backBtn = null;
  let _forwardBtn = null;
  let _openMainBtn = null;
  let _openWindowBtn = null;
  let _pathBarEl = null;
  let _pane = null;
  let _current = null;
  let _panelState = 'normal';
  let _restoreRect = null;
  let _drag = null;
  let _resize = null;
  let _entityRenderSeq = 0;
  let _navHistory = [];
  let _navIndex = -1;
  let _navNavigating = false;
  // 遷移の世代トークン（対象置換・戻る/進む・閉じるの追い越し防止）。
  // 計画: app/docs/subpanel-floatpanel-dialog-keyboard-plan_2026-07-31.md
  //   「閲覧・編集・保存」節。gb-subpanel.js の _opSeq と同じ設計。
  let _opSeq = 0;

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

  // 旧「サブパネル」キーから新「フロートパネル」キーへの一度だけの移行。
  // 新キーが既に存在する場合は何もしない（二重移行・上書きを防ぐ）。
  function _migrateLegacyStorageKey(legacyKey, newKey) {
    try {
      if (typeof localStorage === 'undefined') return;
      if (localStorage.getItem(newKey) !== null) return;
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue === null) return;
      localStorage.setItem(newKey, legacyValue);
      localStorage.removeItem(legacyKey);
    } catch (e) {
      // localStorage can be unavailable in private or constrained contexts.
    }
  }

  function _migrateLegacyStorage() {
    _migrateLegacyStorageKey(LEGACY_POS_KEY, POS_KEY);
    _migrateLegacyStorageKey(LEGACY_SIZE_KEY, SIZE_KEY);
    _migrateLegacyStorageKey(LEGACY_STATE_KEY, STATE_KEY);
  }
  _migrateLegacyStorage();

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
      calendar: 'スケジュール',
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

  async function _openMobileDrawer(toolType, options) {
    const drawer = window.MeldexCloudMobileSideDrawer;
    if (!_isMobileDrawerEnabled() || !options?.path) return false;
    const path = options.path;
    const label = options.label || _basename(path) || _toolLabel(toolType);
    const linkType = options.linkType || toolType;
    let opened = false;
    // スマートフォンでも旧プレビューではなく、サブパネルと同じ仮想ペインを
    // ドロワーへ移して対象アプリ本来の閲覧・編集UIを使う。
    if (typeof window.GBSubPanel?.open === 'function') {
      opened = await window.GBSubPanel.open({
        type: toolType,
        path,
        label,
        state: options.state || {},
        linkType,
      }) === true;
    } else if ((linkType === 'entity' || toolType === 'entity') && typeof drawer.openEntity === 'function') {
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
    if (!_pane || !_contentEl) return Promise.resolve();
    const pane = _pane;
    const content = _contentEl;
    const disposals = [...content.querySelectorAll('[data-meldex-entity-detail]')]
      .map(root => Promise.resolve(root._meldexEntityDetailController?.dispose?.()).catch(() => false));
    return Promise.allSettled(disposals).then(() => {
      if (!content.isConnected && _contentEl !== content) return;
      _registerPaneMap();
      try {
        if (typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.retractPaneContent === 'function') {
          GBPaneBridge.retractPaneContent(pane.id);
        }
        const tabId = pane.tabs?.[0]?.id || '';
        if (tabId && typeof removeComponentInstance === 'function') {
          removeComponentInstance(tabId);
        }
      } finally {
        if (typeof GBLayout !== 'undefined' && GBLayout.paneMap) delete GBLayout.paneMap[pane.id];
        content.innerHTML = '';
      }
      if (options.remount && typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.mountAllPanes === 'function') {
        GBPaneBridge.mountAllPanes();
      }
    });
  }

  function _titleFromOptions(toolType, options) {
    if (options?.label) return options.label;
    if (options?.path) return _basename(options.path) || _toolLabel(toolType);
    return _toolLabel(toolType);
  }

  function _floatPanelTitle(toolType) {
    const label = _toolLabel(toolType);
    return (label ? label + ' ' : '') + 'フロートパネル';
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
    parent.className = 'gb-float-panel-entity-parent';
    if (parentDb) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'gb-float-panel-link-button';
      link.dataset.e2eId = 'gb-float-panel-entity-parent';
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
      preview.className = 'gb-float-panel-webclip-html';

      const toolbar = document.createElement('div');
      toolbar.className = 'gb-float-panel-webclip-toolbar';

      const label = document.createElement('div');
      label.className = 'gb-float-panel-webclip-label';
      label.textContent = 'HTMLスナップショット';
      toolbar.appendChild(label);

      const openLink = document.createElement('a');
      openLink.className = 'gb-float-panel-webclip-open';
      openLink.href = _fileRawUrl(htmlPath);
      openLink.target = '_blank';
      openLink.rel = 'noopener noreferrer';
      openLink.textContent = '別画面で開く';
      toolbar.appendChild(openLink);

      const frame = document.createElement('iframe');
      frame.className = 'gb-float-panel-webclip-frame';
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
      empty.className = 'gb-float-panel-empty-note';
      empty.textContent = 'ノートはありません';
      noteEl.appendChild(empty);
      return;
    }
    if (typeof mdToHtml === 'function') {
      const html = mdToHtml(raw, { basePath: entityPath });
      noteEl.innerHTML = typeof applyAutoLinks === 'function' ? applyAutoLinks(html, entityPath) : html;
    } else {
      noteEl.textContent = raw;
    }
  }

  function _renderEntityData(root, data, entityPath, propTypes) {
    if (window.MeldexEntityDetail?.mount) {
      window.MeldexEntityDetail.mount({
        root,
        path: entityPath,
        surface: 'float',
        data,
        propTypes,
      });
      return;
    }
    root.innerHTML = '';
    root.dataset.path = entityPath;
    _appendEntityParentLink(root, entityPath);

    const title = document.createElement('h2');
    title.className = 'gb-float-panel-entity-title';
    title.textContent = _entityNameFromData(data, entityPath);
    root.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'gb-float-panel-entity-props';
    root.appendChild(grid);
    if (typeof renderEntityPropsGridInto === 'function') {
      renderEntityPropsGridInto(grid, data, entityPath, {
        parentDb: _entityParentDir(entityPath),
        surface: 'float',
        propTypes: propTypes || undefined,
      });
    } else {
      for (const [name, values] of Object.entries(data?.properties || {})) {
        const row = document.createElement('div');
        row.className = 'gb-float-panel-entity-prop-row';
        const label = document.createElement('div');
        label.className = 'gb-float-panel-entity-prop-name';
        label.textContent = name;
        const value = document.createElement('div');
        value.className = 'gb-float-panel-entity-prop-value';
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
    note.className = 'gb-float-panel-entity-note';
    _renderEntityNote(note, data, entityPath);
    root.appendChild(note);
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  async function _loadEntityIntoRoot(root, entityPath, seq) {
    if (!root || !entityPath) return;
    root.innerHTML = '<div class="gb-float-panel-empty">エントリを読み込み中...</div>';
    try {
      if (typeof apiFetch !== 'function') throw new Error('apiFetch is not available');
      const parentDb = _entityParentDir(entityPath);
      const [data, meta] = await Promise.all([
        apiFetch('/entity?path=' + encodeURIComponent(entityPath)),
        parentDb ? apiFetch('/db-metadata?path=' + encodeURIComponent(parentDb), { silentError: true }).catch(() => null) : null,
      ]);
      if (seq !== _entityRenderSeq || !root.isConnected || root.dataset.path !== entityPath) return;
      _renderEntityData(root, data, entityPath, meta?.property_types);
    } catch (e) {
      if (seq !== _entityRenderSeq || !root.isConnected) return;
      root.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'gb-float-panel-empty';
      empty.textContent = 'エントリを読み込めませんでした';
      root.appendChild(empty);
    }
  }

  function _mountEntityPane(options) {
    const entityPath = options?.path || '';
    _pane = _createPane('entity', options);
    _registerPaneMap();
    const root = document.createElement('div');
    root.className = 'gb-float-panel-entity-root';
    root.dataset.gbFloatPanelEntityRoot = 'true';
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
    if (_titleTextEl) _titleTextEl.textContent = title || _floatPanelTitle(toolType);
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
    _actionsEl.querySelectorAll('[data-gb-float-panel-context-action]').forEach(el => el.remove());
  }

  function _updateContextActions(toolType, options) {
    _clearContextActions();
    if (!_actionsEl || toolType !== 'entity' || !options?.path) return;
    // 副画面内では右サイドバー補助機能(チャット)を開くUIを表示しない
    // (計画書「右サイドバー操作の制限」。プログラム経路は GBPaneBridge.guardRightSidebarTool 側でも拒否される)
    if (typeof GBPaneBridge === 'undefined'
      || typeof GBPaneBridge.canUseRightSidebarTools !== 'function'
      || !GBPaneBridge.canUseRightSidebarTools('float')) {
      return;
    }
    const chatBtn = document.createElement('button');
    chatBtn.type = 'button';
    chatBtn.className = 'gb-float-panel-button';
    chatBtn.dataset.gbFloatPanelContextAction = 'entity-chat';
    chatBtn.dataset.e2eId = 'gb-float-panel-entity-chat';
    chatBtn.dataset.testid = 'gb-float-panel-entity-chat';
    chatBtn.title = 'チャットを開く';
    chatBtn.setAttribute('aria-label', 'チャットを開く');
    chatBtn.innerHTML = typeof lucide === 'function' ? lucide('messagesSquare', 16) : 'Chat';
    chatBtn.addEventListener('click', () => _openEntityChat(options.path));
    _actionsEl.insertBefore(chatBtn, _minimizeBtn || _actionsEl.firstChild);
  }

  function _onTitlePointerDown(e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    // native D&D見出しではブラウザにdragstartを任せ、パネル移動を開始しない。
    if (e.target.closest('[data-meldex-drag-surface]')) return;
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

  function _updateNavUi() {
    if (_backBtn) _backBtn.disabled = _navIndex <= 0;
    if (_forwardBtn) _forwardBtn.disabled = _navIndex >= _navHistory.length - 1;
    if (_pathBarEl) {
      const entry = _navHistory[_navIndex];
      _pathBarEl.textContent = entry?.path ? _basename(entry.path) : '';
      _pathBarEl.title = entry?.path || '';
      _pathBarEl.style.display = _navHistory.length > 1 ? '' : 'none';
    }
  }

  function _navPush(toolType, options) {
    if (_navNavigating) return;
    _navHistory.length = _navIndex + 1;
    _navHistory.push({
      toolType,
      path: options?.path || '',
      label: options?.label || _titleFromOptions(toolType, options),
      state: options?.state || null,
    });
    _navIndex = _navHistory.length - 1;
    _updateNavUi();
  }

  // 戻る/進むの前に、表示中の内容の保存flushを行う（失敗時は移動を中止し、
  // 現在の編集内容を保持したまま次に行う操作を通知する。_guardedTransition参照）。
  function _navBack() {
    if (_navIndex <= 0) return false;
    const seq = ++_opSeq;
    const targetIndex = _navIndex - 1;
    const entry = _navHistory[targetIndex];
    _guardedTransition(seq, () => {
      _navIndex = targetIndex;
      _navNavigating = true;
      try {
        _updateTitle(entry.toolType, _floatPanelTitle(entry.toolType));
        _updateContextActions(entry.toolType, entry);
        _mountPaneContent(entry.toolType, entry);
      } finally {
        _navNavigating = false;
      }
      _updateNavUi();
    }, { remount: true });
    return true;
  }

  function _navForward() {
    if (_navIndex >= _navHistory.length - 1) return false;
    const seq = ++_opSeq;
    const targetIndex = _navIndex + 1;
    const entry = _navHistory[targetIndex];
    _guardedTransition(seq, () => {
      _navIndex = targetIndex;
      _navNavigating = true;
      try {
        _updateTitle(entry.toolType, _floatPanelTitle(entry.toolType));
        _updateContextActions(entry.toolType, entry);
        _mountPaneContent(entry.toolType, entry);
      } finally {
        _navNavigating = false;
      }
      _updateNavUi();
    }, { remount: true });
    return true;
  }

  function _ensurePanel() {
    if (_panel) return;
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'gb-float-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'gb-float-panel-title-label');

    const titlebar = document.createElement('div');
    titlebar.className = 'gb-float-panel-titlebar';
    titlebar.addEventListener('pointerdown', _onTitlePointerDown);
    titlebar.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button')) _toggleMaximized();
    });

    const title = document.createElement('div');
    title.className = 'gb-float-panel-title';
    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'gb-float-panel-button gb-float-panel-target-drag-handle';
    dragHandle.dataset.testid = 'gb-float-panel-target-drag-handle';
    dragHandle.title = '表示対象をドラッグ';
    dragHandle.setAttribute('aria-label', '表示対象をドラッグ');
    const isCoarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches === true;
    const dragHandleSize = isCoarsePointer ? '44px' : '26px';
    dragHandle.style.width = dragHandleSize;
    dragHandle.style.minWidth = dragHandleSize;
    dragHandle.style.height = dragHandleSize;
    dragHandle.style.cursor = 'grab';
    if (isCoarsePointer) {
      titlebar.style.height = '44px';
      titlebar.style.flexBasis = '44px';
    }
    dragHandle.style.touchAction = 'none';
    dragHandle.innerHTML = typeof lucide === 'function' ? lucide('gripVertical', 16) : '';
    _titleIconEl = document.createElement('span');
    _titleIconEl.className = 'gb-float-panel-title-icon';
    _titleTextEl = document.createElement('span');
    _titleTextEl.id = 'gb-float-panel-title-label';
    _titleTextEl.className = 'gb-float-panel-title-text';
    title.appendChild(dragHandle);
    title.appendChild(_titleIconEl);
    title.appendChild(_titleTextEl);
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.installSurfaceDragSource) {
      MeldexDnD.installSurfaceDragSource(panel, dragHandle, () => _current, 'float-panel');
    }

    const actions = document.createElement('div');
    actions.className = 'gb-float-panel-actions';
    _actionsEl = actions;

    _backBtn = document.createElement('button');
    _backBtn.type = 'button';
    _backBtn.className = 'gb-float-panel-button gb-float-panel-nav-btn';
    _backBtn.dataset.testid = 'gb-float-panel-back';
    _backBtn.title = '戻る';
    _backBtn.setAttribute('aria-label', '戻る');
    _backBtn.innerHTML = typeof lucide === 'function' ? lucide('chevron-left', 16) : '←';
    _backBtn.disabled = true;
    _backBtn.addEventListener('click', () => _navBack());

    _forwardBtn = document.createElement('button');
    _forwardBtn.type = 'button';
    _forwardBtn.className = 'gb-float-panel-button gb-float-panel-nav-btn';
    _forwardBtn.dataset.testid = 'gb-float-panel-forward';
    _forwardBtn.title = '進む';
    _forwardBtn.setAttribute('aria-label', '進む');
    _forwardBtn.innerHTML = typeof lucide === 'function' ? lucide('chevron-right', 16) : '→';
    _forwardBtn.disabled = true;
    _forwardBtn.addEventListener('click', () => _navForward());

    // 「メインパネルで開く」: 表示中の対象をメインパネルの新規タブへ昇格する
    // （計画: app/docs/subpanel-floatpanel-dialog-keyboard-plan_2026-07-31.md
    //   「確定仕様>メインパネルで開く」節。基本UI共通ルールにより文字が見える
    //   ボタンにする＝アイコンのみは不可）。
    _openMainBtn = document.createElement('button');
    _openMainBtn.type = 'button';
    _openMainBtn.className = 'gb-float-panel-button gb-float-panel-open-main-btn';
    _openMainBtn.dataset.testid = 'gb-float-panel-open-main';
    _openMainBtn.title = 'メインパネルで開く';
    _openMainBtn.setAttribute('aria-label', 'メインパネルで開く');
    const openMainIcon = document.createElement('span');
    openMainIcon.className = 'gb-float-panel-open-main-icon';
    openMainIcon.innerHTML = typeof lucide === 'function' ? lucide('panelTop', 14) : '';
    const openMainLabel = document.createElement('span');
    openMainLabel.className = 'gb-float-panel-open-main-label';
    openMainLabel.textContent = 'メインパネルで開く';
    _openMainBtn.appendChild(openMainIcon);
    _openMainBtn.appendChild(openMainLabel);
    _openMainBtn.addEventListener('click', () => { _openInMainPane(); });

    // 「単独ウィンドウで開く」: フロートパネルはMeldexの画面の中の部品なので、
    // それ自体をOSレベルで最前面に固定することはできない。実ウィンドウで開き直せば
    // そのウィンドウ側の「常に最前面」で他のアプリより手前に置いておける。
    _openWindowBtn = document.createElement('button');
    _openWindowBtn.type = 'button';
    _openWindowBtn.className = 'gb-float-panel-button';
    _openWindowBtn.dataset.testid = 'gb-float-panel-open-window';
    _openWindowBtn.title = '単独ウィンドウで開く';
    _openWindowBtn.setAttribute('aria-label', '単独ウィンドウで開く');
    _openWindowBtn.innerHTML = typeof lucide === 'function' ? lucide('externalLink', 16) : '↗';
    _openWindowBtn.addEventListener('click', () => { _openInStandaloneWindow(); });

    _minimizeBtn = document.createElement('button');
    _minimizeBtn.type = 'button';
    _minimizeBtn.className = 'gb-float-panel-button';
    _minimizeBtn.dataset.testid = 'gb-float-panel-minimize';
    _minimizeBtn.addEventListener('click', _toggleMinimized);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'gb-float-panel-button';
    closeBtn.dataset.testid = 'gb-float-panel-close';
    closeBtn.title = '閉じる';
    closeBtn.setAttribute('aria-label', '閉じる');
    closeBtn.innerHTML = typeof lucide === 'function' ? lucide('x', 16) : 'x';
    closeBtn.addEventListener('click', () => close());
    actions.appendChild(_backBtn);
    actions.appendChild(_forwardBtn);
    actions.appendChild(_openMainBtn);
    actions.appendChild(_openWindowBtn);
    actions.appendChild(_minimizeBtn);
    actions.appendChild(closeBtn);

    _pathBarEl = document.createElement('div');
    _pathBarEl.className = 'gb-float-panel-pathbar';
    _pathBarEl.style.display = 'none';

    _contentEl = document.createElement('div');
    _contentEl.id = CONTENT_ID;
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.installSurfaceDropTarget) {
      MeldexDnD.installSurfaceDropTarget(panel, item => {
        const target = MeldexDnD.normalizeOpenTarget?.(item);
        if (!target) return false;
        return open(target.type, { path: target.path, label: target.label, state: target.state });
      });
    }
    _contentEl.className = 'gb-float-panel-content';

    titlebar.appendChild(title);
    titlebar.appendChild(actions);
    panel.appendChild(titlebar);
    panel.appendChild(_pathBarEl);
    panel.appendChild(_contentEl);

    RESIZE_DIRS.forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = 'gb-float-panel-resize gb-float-panel-resize-' + dir;
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
      : { id: 'float-panel-tab-' + Date.now(), label, type: toolType, path: options?.path || '', state: options?.state || null };
    return {
      id: PANE_ID,
      type: 'pane',
      tabs: [tab],
      activeTabIndex: 0,
    };
  }

  // 内容のマウントのみを行う（既存内容の破棄は呼び出し元の _guardedTransition が
  // 保存flush→中止判定を経てから行う。ここでは破棄しない）。
  function _mountPaneContent(toolType, options) {
    if (!_contentEl) return;
    if (toolType === 'entity' && options?.path) {
      _mountEntityPane(options);
      return;
    }
    _pane = _createPane(toolType, options);
    _registerPaneMap();
    const mounted = typeof GBPaneBridge !== 'undefined' && typeof GBPaneBridge.mountVirtualPane === 'function'
      ? GBPaneBridge.mountVirtualPane(_pane, _contentEl, { surface: 'float' })
      : false;
    if (!mounted) {
      const empty = document.createElement('div');
      empty.className = 'gb-float-panel-empty';
      empty.textContent = 'この内容はフロートパネルで表示できません';
      _contentEl.appendChild(empty);
    }
    _current = {
      toolType,
      path: options?.path || '',
      label: _titleFromOptions(toolType, options),
      tabId: _pane.tabs?.[0]?.id || '',
    };
    if (window.MeldexSetupEditableDropHandler) {
      _contentEl.querySelectorAll('#page-content, #entity-freetext, [contenteditable="true"]').forEach(el => {
        window.MeldexSetupEditableDropHandler(el);
      });
    }
  }

  // シート系ビュー（表・ツリー・ギャラリー・カンバン・タイムライン・チャート・グラフ・
  // フォーム）の保存キューflush対象タイプ。gb-current-reload.js の
  // DB_VIEW_TYPES / _flushPendingEditorBeforeReload と同じ発想（同ファイルは
  // 別レーン担当のため参照のみで踏襲し、ここでは独立実装する）。
  const _DB_VIEW_TYPES_FOR_FLUSH = new Set([
    'pivot', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'database',
  ]);

  // メインパネルの解決（gb-panelset.js の _openRailAppInMain と同じ優先順位）。
  function _resolveMainPaneId() {
    if (typeof GBPaneDefaultLayout !== 'undefined' && typeof GBPaneDefaultLayout.resolveMainPaneId === 'function') {
      const mainPaneId = GBPaneDefaultLayout.resolveMainPaneId({ contentOnly: true });
      if (mainPaneId) return mainPaneId;
    }
    if (typeof GBLayout !== 'undefined' && GBLayout.activePane) return GBLayout.activePane;
    if (typeof GBLayout !== 'undefined' && typeof GBLayout.findFirstPane === 'function') {
      const firstPane = GBLayout.findFirstPane(GBLayout.root);
      if (firstPane?.id) return firstPane.id;
    }
    return '';
  }

  // 保存flush本体（ノート/シート系ビュー/ボード/シナリオ）。「メインパネルで
  // 開く」昇格（_flushBeforeOpenMain）と、対象置換・戻る/進む・閉じる
  // （_flushBeforeTransition）の両方から共通で呼ばれる（gb-float-panel.js内で
  // 完結する統一。gb-subpanel.js側との横断共通化は行わない）。
  // ノートは既存の共通flush（flushPendingEditorAutosave、タブ/パネル切替と同じ経路）、
  // シート系ビューはgb-current-reload.jsと同じ3関数、ボードはbeforeunloadと同じ
  // タイマー直送りを踏襲する。シナリオは ScriptNoteComponent.flush()
  // （gb-tool-scriptnote.js が公開する遷移前flush契約、実体は
  // ScriptNoteEditor.prototype.flush()）を使う。
  // 戻り値 { ok } は「保存に失敗しなかったか」。呼び出し元ごとに扱いが異なる
  // （下記 _flushBeforeOpenMain / _flushBeforeTransition のコメント参照）。
  async function _performFlush(toolType, path, tabId) {
    try {
      if (toolType === 'page' && typeof flushPendingEditorAutosave === 'function') {
        const settled = await Promise.resolve(flushPendingEditorAutosave());
        const failed = Array.isArray(settled) && settled.some(item => item?.status === 'rejected');
        return { ok: !failed };
      }
      if (_DB_VIEW_TYPES_FOR_FLUSH.has(toolType) && path) {
        if (typeof waitForPendingDbValueMutations === 'function') await waitForPendingDbValueMutations(path);
        if (typeof flushPendingDbPropertySettings === 'function') await flushPendingDbPropertySettings(path);
        if (typeof flushPendingDbViewConfigBackendSave === 'function') await flushPendingDbViewConfigBackendSave(path);
        if (typeof waitForPendingDbValueMutations === 'function') await waitForPendingDbValueMutations(path);
        return { ok: true };
      }
      if (toolType === 'board' && typeof bd !== 'undefined' && bd?.dirty && bd?.path === path && typeof bdSave === 'function') {
        if (window._bdTimer) clearTimeout(window._bdTimer);
        window._bdTimer = null;
        const ok = await Promise.resolve(bdSave());
        return { ok: ok !== false };
      }
      if (toolType === 'scriptnote' && tabId && typeof getComponentInstance === 'function') {
        const comp = getComponentInstance(tabId);
        if (comp && typeof comp.flush === 'function') {
          const ok = await comp.flush();
          return { ok: ok !== false };
        }
      }
    } catch (e) {
      return { ok: false };
    }
    return { ok: true };
  }

  // 「メインパネルで開く」昇格前の入力確定と保存キューflush（既存動作を維持）。
  // エンティティ表示（_mountEntityPane）は読み取り描画のみのためflush不要。
  // 保存失敗時は元のフロートパネルを保持したまま昇格を中止する。
  async function _flushBeforeOpenMain(toolType, path, tabId) {
    if (toolType === 'entity') return { ok: true };
    return _performFlush(toolType, path, tabId);
  }

  // 対象置換・戻る/進む・閉じるの前に行う保存flush。gb-subpanel.js の
  // _flushBeforeTransition と同型: エンティティも明示的にflush()し、
  // 失敗時は遷移を中止する（_guardedTransition参照）。メイン昇格
  // （_flushBeforeOpenMain）とは異なり、entryが無い/pathが無い場合のみ
  // 無条件でokとする。
  async function _flushBeforeTransition(entry) {
    if (!entry || !entry.path) return { ok: true };
    if (entry.toolType === 'entity') {
      const entityRoot = _contentEl && typeof _contentEl.querySelector === 'function'
        ? _contentEl.querySelector('[data-meldex-entity-detail]')
        : null;
      const controller = entityRoot?._meldexEntityDetailController;
      if (controller && typeof controller.flush === 'function') {
        try {
          const ok = await controller.flush();
          return { ok: ok !== false };
        } catch (e) {
          return { ok: false };
        }
      }
      return { ok: true };
    }
    return _performFlush(entry.toolType, entry.path, entry.tabId || '');
  }

  // flush → 中断判定 → 既存内容の破棄、を経てから fn() で次の状態を描画する
  // 共通ガード（gb-subpanel.js の _guardedTransition と同型）。seq は
  // 「flush待ち中に別の遷移が始まった」場合に古い方の続きを打ち切るための
  // 世代トークン（追い越し防止）。retractOptions はそのまま _retractCurrentContent
  // へ渡す（close()は remount 不要、open()/nav系は既存動作どおり remount:true）。
  async function _guardedTransition(seq, fn, retractOptions) {
    const flushResult = await _flushBeforeTransition(_current);
    if (seq !== _opSeq) return false; // flush待ち中に別の遷移に追い越された
    if (!flushResult.ok) {
      if (typeof showStatus === 'function') showStatus('保存を確認できませんでした。もう一度お試しください', true);
      return false;
    }
    await _retractCurrentContent(retractOptions || {});
    if (seq !== _opSeq) return false; // 破棄待ち中に別の遷移に追い越された
    fn();
    return true;
  }

  // 表示中の対象を実ウィンドウ（単独ウィンドウ）で開く。開いたウィンドウ側には
  // 「常に最前面」ボタンがあるので、他のアプリより手前に置いたまま作業できる。
  async function _openInStandaloneWindow() {
    if (!_current) return false;
    const path = _current.path || '';
    const label = _current.label || _toolLabel(_current.toolType);
    if (!path || typeof buildSingleTabWindowUrl !== 'function') {
      if (typeof showStatus === 'function') showStatus('この内容は単独ウィンドウで開けません', true);
      return false;
    }
    // 未保存の入力を確定させてから別ウィンドウへ渡す
    const active = document.activeElement;
    if (active && _contentEl && _contentEl.contains(active) && typeof active.blur === 'function') {
      try { active.blur(); } catch (e) { /* ignore */ }
    }
    await _flushBeforeOpenMain(_current.toolType, path, _current.tabId || '');
    const opened = (typeof openItemsAsSingleTabWindows === 'function')
      ? openItemsAsSingleTabWindows([{ name: label, path, type: _current.toolType }])
      : 0;
    if (!opened && typeof showStatus === 'function') showStatus('単独ウィンドウを開けませんでした', true);
    return opened > 0;
  }

  async function _openInMainPane() {
    if (!_current) return false;
    const mainPaneId = _resolveMainPaneId();
    if (!mainPaneId) {
      if (typeof showStatus === 'function') showStatus('メインパネルが見つかりません', true);
      return false;
    }
    const toolType = _current.toolType;
    const path = _current.path || '';
    const label = _current.label || _toolLabel(toolType);
    const tabId = _current.tabId || '';
    const btn = _openMainBtn;
    if (btn) btn.disabled = true;
    try {
      // 現在表示中の対象の入力確定（フォーカスを外して確定させる）。
      const active = document.activeElement;
      if (active && _contentEl && _contentEl.contains(active) && typeof active.blur === 'function') {
        try { active.blur(); } catch (e) { /* ignore */ }
      }
      const flushResult = await _flushBeforeOpenMain(toolType, path, tabId);
      if (!flushResult.ok) {
        if (typeof showStatus === 'function') showStatus('保存を確認できませんでした。もう一度お試しください', true);
        return false;
      }

      let state = null;
      if (toolType !== 'entity' && tabId && typeof getComponentInstance === 'function') {
        const comp = getComponentInstance(tabId);
        if (comp && typeof comp.getState === 'function') {
          try { state = comp.getState(); } catch (e) { state = null; }
        }
      }

      if (typeof GBTabs === 'undefined' || typeof GBTabs.addTab !== 'function') {
        if (typeof showStatus === 'function') showStatus('メインパネルに開けませんでした', true);
        return false;
      }
      // 既存タブ・他ペインの同一ファイルタブを再利用せず、必ず新しいタブを作る。
      const newTabId = GBTabs.addTab(mainPaneId, label, toolType, path, state, { forceNewTab: true });
      if (!newTabId) {
        if (typeof showStatus === 'function') showStatus('メインパネルに開けませんでした（保存に失敗した可能性があります）', true);
        return false;
      }
      const actualPaneId = typeof GBTabs.findPaneIdForTab === 'function'
        ? (GBTabs.findPaneIdForTab(newTabId) || mainPaneId)
        : mainPaneId;
      if (typeof GBTabs.activateTab === 'function') GBTabs.activateTab(actualPaneId, newTabId);
      if (typeof GBLayout !== 'undefined' && typeof GBLayout.setActivePane === 'function') {
        GBLayout.setActivePane(actualPaneId);
      }
      // 保存flushは上で完了済み。通常の close() は遷移ガードとして同じ対象を再度
      // flushするため、ここでは位置だけ保存して直接後始末する。これにより、昇格時の
      // 二重保存と、2回目だけ失敗して新タブとフロートが重複する状態を防ぐ。
      _saveRect();
      ++_opSeq;
      _teardownPanel();
      return true;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // 対象置換の前に、表示中の内容の保存flushを行う（失敗時は置換を中止し、
  // 現在の編集内容を保持したまま次に行う操作を通知する）。呼び出し元への
  // 戻り値は「開く要求を受け付けたか」を表す従来どおりの同期値（モバイル
  // ドロワーへの委譲や、既存呼び出し元の同期判定と互換）。実際の置換の
  // 成否は _guardedTransition が非同期に判定し、失敗時は _mountPaneContent
  // 自体を呼ばない（既存表示を保持する）。
  function _mountFloatPanelContent(normalizedType, options) {
    _navPush(normalizedType, options);
    _updateTitle(normalizedType, _floatPanelTitle(normalizedType));
    _updateContextActions(normalizedType, options);
    _mountPaneContent(normalizedType, options);
    _panel.hidden = false;
    _panel.focus?.();
    if (typeof replaceIcons === 'function') replaceIcons();
  }

  function _openFloatPanelContent(normalizedType, options) {
    _ensurePanel();
    const seq = ++_opSeq;
    _guardedTransition(seq, () => _mountFloatPanelContent(normalizedType, options), { remount: true });
  }

  // モバイルドロワーへの委譲**前**に、フロートパネル自身が表示中の内容の保存flushを
  // 行う（計画書「flushガード」節）。委譲は即座に新しい内容へ切り替わる別画面
  // （MeldexCloudMobileSideDrawer）のため、flush前に委譲すると未保存の編集内容が
  // 通知なく失われ得る。失敗時は委譲せず中止する（既存ガードと同じ文言・世代トークン）。
  // 戻り値: 'stale'(別遷移に追い越された/何もしない) | 'flush-failed'(中止・通知済み) |
  //   'delegated'(委譲成立) | 'not-delegated'(flush成功だが委譲されなかった＝呼び出し元で
  //   フロートパネル自体の表示にフォールバックする)。
  async function _guardedOpenMobileDrawer(toolType, options) {
    const seq = ++_opSeq;
    const flushResult = await _flushBeforeTransition(_current);
    if (seq !== _opSeq) return 'stale';
    if (!flushResult.ok) {
      if (typeof showStatus === 'function') showStatus('保存を確認できませんでした。もう一度お試しください', true);
      return 'flush-failed';
    }
    return await _openMobileDrawer(toolType, options) ? 'delegated' : 'not-delegated';
  }

  function open(toolType, options = {}) {
    const normalizedType = toolType || options.toolType || options.type || 'preview';
    if (_isMobileDrawerEnabled() && options?.path) {
      _guardedOpenMobileDrawer(normalizedType, options).then((result) => {
        if (result === 'not-delegated') _openFloatPanelContent(normalizedType, options);
      });
      return true;
    }
    _openFloatPanelContent(normalizedType, options);
    return true;
  }

  // 閉じる前に、表示中の内容の保存flushを行う。失敗時は閉じる処理を中止し、
  // パネル・ボタン類はそのまま操作可能な状態を維持する。
  function _teardownPanel() {
    const panel = _panel;
    _pane = null;
    _current = null;
    _navHistory = [];
    _navIndex = -1;
    _navNavigating = false;
    document.removeEventListener('pointermove', _onPointerMove, true);
    document.removeEventListener('pointerup', _onPointerUp, true);
    window.removeEventListener('resize', _onWindowResize);
    if (panel) panel.remove();
    _panel = null;
    _contentEl = null;
    _titleIconEl = null;
    _titleTextEl = null;
    _actionsEl = null;
    _minimizeBtn = null;
    _backBtn = null;
    _forwardBtn = null;
    _openMainBtn = null;
    _pathBarEl = null;
    _drag = null;
    _resize = null;
  }

  function close(toolType) {
    if (toolType && _current?.toolType !== toolType) return false;
    if (!_panel) return false;
    _saveRect();
    const seq = ++_opSeq;
    _guardedTransition(seq, () => {
      _teardownPanel();
    });
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

  // 現在表示中の対象の読み取り専用スナップショット（テスト・診断向け。
  // gb-subpanel.js の getCurrentTarget と同型）。
  function getCurrentTarget() {
    return _current ? { ..._current } : null;
  }

  return {
    open,
    close,
    toggle,
    isOpen,
    navBack: _navBack,
    navForward: _navForward,
    openEntityChat: _openEntityChat,
    openInMainPane: _openInMainPane,
    openInStandaloneWindow: _openInStandaloneWindow,
    getCurrentTarget,
  };
})();

window.GBFloatPanel = GBFloatPanel;
