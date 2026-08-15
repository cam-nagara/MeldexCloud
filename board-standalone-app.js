/* board-standalone-app.js
 * 単独ボードアプリのブートストラップ。
 *
 * 役割:
 *  - ファイル選択/保存ダイアログを開く
 *  - 選択フォルダ内のボードファイルを一覧表示
 *  - ファイルを選ぶと、本体の bdOpenBoard() で読み込んで表示
 *  - 前回フォルダを記憶し、起動時に再アクセスする
 *
 * 読み込み順: 全てのボード関連スクリプトの読み込み完了後に呼ばれる前提（HTML の末尾で実行）。
 */
(function () {
  'use strict';

  const FS = window.BoardStandaloneFS;
  if (!FS) {
    console.error('board-standalone-fs.js が先に読み込まれていません');
    return;
  }
  const OPTIONS_COLLAPSED_KEY = 'meldex-board-options-collapsed';
  const SIDEBAR_WIDTH_KEY = 'meldex-board-right-sidebar-width';
  const VIEWER_HEIGHT_KEY = 'meldex-board-viewer-height';
  const TOP_TOOLBAR_HIDDEN_KEY = 'meldex-board-toolbar-top-hidden';
  const BOTTOM_TOOLBAR_HIDDEN_KEY = 'meldex-board-toolbar-bottom-hidden';
  const BOARD_FILE_EXTENSION = '.mel-board';
  let localDrafts = null;
  let boardViewportRefreshRaf = 0;

  // -------------------------------------------------------------------------
  // ブラウザ互換性チェック
  // -------------------------------------------------------------------------
  function _isSupportedBrowser() {
    return FS.isFileSystemAccessSupported();
  }

  function _setRootUi(hasRoot) {
    document.body.classList.toggle('bsa-has-root', !!hasRoot);
  }

  // -------------------------------------------------------------------------
  // 保存場所・ファイル選択
  // -------------------------------------------------------------------------
  async function _pickRootFolder() {
    if (FS.isNativeMode?.()) {
      try {
        const handle = await FS.pickRootFolder();
        if (!handle) return null;
        FS.setRootHandle(handle);
        return handle;
      } catch (e) {
        if (e?.message) _showError(e.message);
        return null;
      }
    }
    if (!_isSupportedBrowser()) {
      _showCompatNotice();
      return null;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
      if (e?.name === 'AbortError') return null;
      _showError('フォルダ選択がキャンセルされました');
      return null;
    }
    if (!(await FS.verifyPermission(handle, { mode: 'readwrite' }))) {
      _showError('フォルダの書き込み許可が得られませんでした');
      return null;
    }
    FS.setRootHandle(handle);
    await FS.saveRootHandle(handle);
    return handle;
  }

  async function _tryRestoreSavedFolder() {
    if (FS.isNativeMode?.()) {
      const saved = await FS.loadSavedRootHandle();
      if (saved) FS.setRootHandle(saved);
      return saved;
    }
    if (!_isSupportedBrowser()) return null;
    const saved = await FS.loadSavedRootHandle();
    if (!saved) return null;
    // 権限再要求はユーザージェスチャ不要では「自動再付与」されない場合もある。
    // queryPermission で 'granted' のときだけ自動復元、それ以外は再選択を促す。
    const opts = { mode: 'readwrite' };
    try {
      const state = await saved.queryPermission(opts);
      if (state === 'granted') {
        FS.setRootHandle(saved);
        return saved;
      }
    } catch (e) {}
    return null; // 再選択が必要
  }

  // -------------------------------------------------------------------------
  // ファイル一覧 UI
  // -------------------------------------------------------------------------
  async function _loadBoardEntries() {
    return FS.listBoardFiles();
  }

  async function _renderFileList() {
    try {
      await _loadBoardEntries();
      return true;
    } catch (e) {
      _showError('ボード一覧を読み込めませんでした');
      return false;
    }
  }

  function _boardState() {
    return (typeof bd === 'undefined') ? null : bd;
  }

  function _hasUnsavedBoard() {
    const state = _boardState();
    return !!(state && !state.path && Array.isArray(state.nodes) && state.nodes.length > 0);
  }

  function _confirmDiscardUnsavedBoard() {
    const state = _boardState();
    if (!(state && state.dirty && !state.path && Array.isArray(state.nodes) && state.nodes.length > 0)) return true;
    return window.confirm('未保存の新規ボードを破棄して、別のボードを開きますか？');
  }

  function _confirmResetCurrentBoard() {
    const state = _boardState();
    if (!(state && state.dirty)) return true;
    return window.confirm('未保存の変更を破棄して、新規ボードを作成しますか？');
  }

  function _canReplaceCurrentBoard() {
    const state = _boardState();
    if (!(state && state.dirty)) return true;
    return window.confirm('未保存の変更を破棄して、別のボードを現在の画面で開きますか？');
  }

  function _resetBoardForStarter() {
    const state = _boardState();
    if (!state) return null;
    if (typeof closeAnnotationToolbar === 'function') closeAnnotationToolbar();
    clearTimeout(window._bdTimer);
    state.path = '';
    FS.setCurrentPath?.('');
    window.MeldexStandaloneTags?.setTargetPath?.('');
    state._preservedFrontmatter = '';
    state._loadedBoardPath = '';
    state.nodes = [];
    state.connections = [];
    state.llmSemantics = typeof bdDefaultLlmSemantics === 'function' ? bdDefaultLlmSemantics() : null;
    state.selected = new Set();
    state.editing = null;
    state.dirty = false;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.rotation = 0;
    state.connecting = null;
    state._activeNode = null;
    state.selectedConnId = '';
    state.selectedConnIds = new Set();
    state.tool = 'select';
    state.displayFilters = {};
    state.cardStyles = [];
    state.lineStyles = [];
    state.depthStyles = [];
    state.activeCardStyle = '';
    state.activeLineStyle = '';
    state._stylePresetSeedVersion = 0;
    state.themeId = '';
    state._showShadow = false;
    state._textRotateOnLine = false;
    state._numbering = false;
    state._fileStyle = null;
    state._bgColor = '';
    state._bgImage = '';
    state._bgImageFit = 'contain';
    state._bgImageScale = 1;
    state.gapSiblings = null;
    state.gapLevels = null;
    state.autoAlign = true;
    state.statuses = (typeof BD_DEFAULT_STATUSES !== 'undefined') ? [...BD_DEFAULT_STATUSES] : [];
    state.statusFilter = '';
    if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
    if (typeof bdClearUndoStacks === 'function') bdClearUndoStacks();
    if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
    if (window.state) window.state.currentBoardPath = '';
    return state;
  }

  let _starterBoardCreated = false;
  function _renderBlankBoard() {
    if (!_initBoardShell()) return false;
    if (typeof bdRender !== 'function') {
      _showError('ボードエンジンが読み込まれていません');
      return false;
    }
    const state = _resetBoardForStarter();
    if (!state) {
      _showError('ボード状態を初期化できません');
      return false;
    }
    const titleEl = document.getElementById('bd-title');
    if (titleEl) titleEl.textContent = '新規ボード';
    bdRender();
    if (typeof bdDrawConns === 'function') bdDrawConns();
    if (typeof bdDrawFrames === 'function') bdDrawFrames();
    if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    requestAnimationFrame(() => _refreshBoardViewport());
    _starterBoardCreated = true;
    return true;
  }

  function _createStarterBoard() {
    if (_starterBoardCreated) return true;
    return _renderBlankBoard();
  }

  function _ensureStarterBoard() {
    const state = _boardState();
    if (_starterBoardCreated || state?.path || (Array.isArray(state?.nodes) && state.nodes.length > 0)) return true;
    return _createStarterBoard();
  }

  async function _createNewBoard() {
    if (FS.isNativeMode?.()) {
      if (!_confirmResetCurrentBoard()) return;
      _starterBoardCreated = false;
      if (_renderBlankBoard()) _showStatus('新規ボードを作成しました');
      return;
    }
    if (!FS.getRootHandle?.()) {
      const handle = await _pickRootFolder();
      if (!handle) return;
      _setRootUi(true);
      _initBoardShell();
      await _renderFileList();
    }
    try {
      const currentPath = String(window.state?.currentBoardPath || '');
      const slash = currentPath.lastIndexOf('/');
      const parent = slash > 0 ? currentPath.slice(0, slash) : '';
      const shouldSaveStarter = _hasUnsavedBoard();
      const content = shouldSaveStarter && typeof bdToMd === 'function' ? bdToMd() : '';
      const result = await apiPost('/outliner/add', { type: 'board', label: '無題', parent });
      const path = result?.node?.path || '';
      if (path && shouldSaveStarter && content) {
        const metadata = await apiFetch('/file?path=' + encodeURIComponent(path) + '&metadata_only=1');
        await apiPut('/file?path=' + encodeURIComponent(path), {
          content,
          if_match_etag: metadata?.etag || '',
          transport_revision: metadata?.transport_revision || '',
        });
      }
      await _renderFileList();
      if (path) await _openBoard(path, { skipDiscardConfirm: shouldSaveStarter });
    } catch (e) {
      _showError('ボードを作成できませんでした: ' + (e?.message || e));
    }
  }

  async function _saveCurrentBoard() {
    const state = _boardState();
    if (!state) return false;
    if (state.path) {
      if (typeof bdSave === 'function') {
        await bdSave();
        await _renderFileList();
      }
      return true;
    }
    return _saveCurrentBoardAsNewFile();
  }

  async function _saveCurrentBoardAsNewFile() {
    const content = typeof bdToMd === 'function' ? bdToMd() : '';
    if (!content) {
      _showError('保存するボード内容を作成できませんでした');
      return false;
    }
    if (FS.isNativeMode?.() && typeof FS.saveBoardAs === 'function') {
      try {
        const title = (document.getElementById('bd-title')?.textContent || '無題').trim() || '無題';
        const saved = await FS.saveBoardAs(content, title + BOARD_FILE_EXTENSION);
        if (!saved) return false;
        _setRootUi(true);
        _initBoardShell();
        await _renderFileList();
        if (saved.path) await _openBoard(saved.path, { skipDiscardConfirm: true });
        return !!saved.path;
      } catch (e) {
        _showError('ボードを保存できませんでした: ' + (e?.message || e));
        return false;
      }
    }
    if (!FS.getRootHandle?.()) {
      const handle = await _pickRootFolder();
      if (!handle) return false;
      _setRootUi(true);
      _initBoardShell();
    }
    try {
      const result = await apiPost('/outliner/add', { type: 'board', label: '無題', parent: '' });
      const path = result?.node?.path || '';
      if (!path) {
        _showError('保存先ファイルを作成できませんでした');
        return false;
      }
      const metadata = await apiFetch('/file?path=' + encodeURIComponent(path) + '&metadata_only=1');
      await apiPut('/file?path=' + encodeURIComponent(path), {
        content,
        if_match_etag: metadata?.etag || '',
        transport_revision: metadata?.transport_revision || '',
      });
      await _renderFileList();
      await _openBoard(path, { skipDiscardConfirm: true });
      return true;
    } catch (e) {
      _showError('ボードを保存できませんでした: ' + (e?.message || e));
      return false;
    }
  }

  async function _changeRootFolder() {
    const handle = await _pickRootFolder();
    if (!handle) return;
    _setRootUi(true);
    _initBoardShell();
    _ensureStarterBoard();
    await _renderFileList();
  }

  async function _refreshBoardList() {
    if (!FS.getRootHandle?.()) {
      _showStatus('保存先が未選択です');
      return;
    }
    if (await _renderFileList()) _showStatus('ボード一覧を更新しました');
  }

  async function _openBoardFromMenu() {
    const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (FS.isNativeMode?.() && typeof FS.openBoardFile === 'function') {
      if (!_confirmDiscardUnsavedBoard()) {
        FS.discardQueuedOpen?.();
        return;
      }
      let loading = false;
      try {
        const opened = await FS.openBoardFile();
        if (!opened?.path) return;
        _setRootUi(true);
        _initBoardShell();
        _setBoardLoading(true, 'ボードを読み込んでいます: ' + (String(opened.path).split('/').pop() || opened.path));
        loading = true;
        await _renderFileList();
        await _openBoard(opened.path, { skipDiscardConfirm: true });
      } catch (e) {
        _showError('ボードを開けませんでした: ' + (e?.message || e));
      } finally {
        if (loading) _setBoardLoading(false);
      }
      return;
    }
    if (!FS.getRootHandle?.()) {
      const handle = await _pickRootFolder();
      if (!handle) return;
      _setRootUi(true);
      _initBoardShell();
    }
    if (!window.BoardStandaloneOpenDialog?.open) {
      _showError('ボードを開く画面を初期化できませんでした');
      return;
    }
    window.BoardStandaloneOpenDialog.open({
      trigger: restoreFocusTo,
      loadEntries: _loadBoardEntries,
      onOpen: async path => {
        if (!_confirmDiscardUnsavedBoard()) return { cancelled: true };
        const opened = await _openBoard(path, { skipDiscardConfirm: true });
        return { opened };
      },
    });
  }

  function _bindCloudPathChanges() {
    window.addEventListener('meldex:file-path-renamed', event => {
      const oldPath = String(event?.detail?.oldPath || '').replace(/\\/g, '/');
      const newPath = String(event?.detail?.newPath || '').replace(/\\/g, '/');
      const state = _boardState();
      if (!state || !oldPath || !newPath || String(state.path || '').replace(/\\/g, '/') !== oldPath) return;
      state.path = newPath;
      state._loadedBoardPath = newPath;
      if (window.state) window.state.currentBoardPath = newPath;
      FS.setCurrentPath?.(newPath);
      window.MeldexStandaloneTags?.setTargetPath?.(newPath);
    });
  }

  // -------------------------------------------------------------------------
  // ボードを開く
  // -------------------------------------------------------------------------
  async function _openBoard(path, options = {}) {
    if (!path) return false;
    const previousPath = FS.currentPath?.() || String(window.state?.currentBoardPath || '');
    if (!options.skipDiscardConfirm && !_confirmDiscardUnsavedBoard()) return false;
    if (typeof window.bdOpenBoard !== 'function') {
      _showError('ボードエンジンが読み込まれていません');
      return false;
    }
    try {
      if (typeof closeAnnotationToolbar === 'function') closeAnnotationToolbar();
      await FS.ensureEditLock?.(path);
      if (window.state) window.state.currentBoardPath = path;
      const label = path.split('/').pop() || path;
      const opened = await _withBoardLoading('ボードを読み込んでいます: ' + label, () => window.bdOpenBoard(label, path));
      if (!opened) {
        if (window.state) window.state.currentBoardPath = previousPath;
        if (previousPath !== path) {
          await FS.releaseEditLock?.(path);
          FS.discardRememberedPath?.(path);
        }
        return false;
      }
      FS.setCurrentPath?.(path);
      window.MeldexStandaloneTags?.setTargetPath?.(path);
      _showStatus('開きました: ' + path);
      // 選択中ファイルをハイライト
      document.querySelectorAll('.bsa-file-row.active').forEach((el) => el.classList.remove('active'));
      const row = document.querySelector('.bsa-file-row[data-path="' + CSS.escape(path) + '"]');
      row?.classList.add('active');
      return true;
    } catch (e) {
      if (window.state) window.state.currentBoardPath = previousPath;
      if (previousPath !== path) {
        await FS.releaseEditLock?.(path);
        FS.discardRememberedPath?.(path);
      }
      _showError('ボードを開けませんでした: ' + (e?.message || e));
      return false;
    }
  }

  async function _openLinkedPathExternally(path, label, options) {
    const targetPath = String(path || '').trim();
    if (!targetPath) return false;
    if (!FS.isNativeMode?.()) return false;
    try {
      const payload = {
        path: targetPath,
        label: String(label || ''),
        linkType: String(options?.linkType || options?.type || ''),
      };
      const res = await apiPost('/board-app/open-link', payload);
      if (res?.ok) {
        _showStatus((label || targetPath) + ' を開きました');
        return true;
      }
    } catch (e) {
      _showError('リンク先を単独アプリで開けませんでした: ' + (e?.message || e || ''));
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // 画面切り替え
  // -------------------------------------------------------------------------
  function _showCompatNotice() {
    const el = document.getElementById('board-compat-notice');
    document.getElementById('board-start-screen')?.classList.remove('bsa-hidden');
    if (el) el.classList.remove('bsa-hidden');
  }

  function _showError(msg) {
    if (typeof window.showStatus === 'function') window.showStatus(msg, true);
    else console.error(msg);
  }
  function _showStatus(msg) {
    if (typeof window.showStatus === 'function') window.showStatus(msg, false);
  }

  // -------------------------------------------------------------------------
  // 読み込み中表示
  // -------------------------------------------------------------------------
  let _boardLoadingToken = 0;

  function _setBoardLoading(active, message) {
    const overlay = document.getElementById('board-loading-overlay');
    if (!overlay) return;
    const label = overlay.querySelector('.bsa-loading-text');
    if (label && message) label.textContent = message;
    overlay.classList.toggle('bsa-hidden', !active);
    document.body.classList.toggle('bsa-loading-board', !!active);
  }

  function _nextFrame() {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }

  async function _withBoardLoading(message, work) {
    const token = ++_boardLoadingToken;
    _setBoardLoading(true, message);
    await _nextFrame();
    try {
      return await work();
    } finally {
      if (token === _boardLoadingToken) _setBoardLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // 画像追加方式
  // -------------------------------------------------------------------------
  function _imageDropMode() {
    if (typeof window.bdGetImageDropMode === 'function') return window.bdGetImageDropMode();
    return 'embed';
  }

  function _imageDropModeLabel() {
    return _imageDropMode() === 'embed'
      ? '画像追加方式: ファイルに埋め込む'
      : '画像追加方式: 画像ファイルへのリンク';
  }

  function _toggleImageDropMode() {
    if (typeof window.bdToggleImageDropMode === 'function') window.bdToggleImageDropMode();
  }

  // -------------------------------------------------------------------------
  // エクスポート（PNG / HTML）
  // 本体と同じ bdExportImage() / MeldexExportHtml.exportCurrentView('board') を
  // そのまま使う。保存はサーバーのネイティブダイアログの代わりに
  // gb-export-save.js の単独アプリ用フォールバック（File System Access API /
  // ブラウザダウンロード）へ委譲される。
  // -------------------------------------------------------------------------
  async function _exportBoardPng() {
    if (typeof window.bdExportImage !== 'function') {
      _showError('PNG出力エンジンを読み込めませんでした');
      return;
    }
    await window.bdExportImage();
  }

  async function _exportBoardHtml() {
    if (typeof MeldexExportHtml === 'undefined' || typeof MeldexExportHtml.exportCurrentView !== 'function') {
      _showError('HTML出力エンジンを読み込めませんでした');
      return;
    }
    await MeldexExportHtml.exportCurrentView('board');
  }

  // -------------------------------------------------------------------------
  // 右サイドバー / ツールバーの単独アプリ用レイアウト
  // -------------------------------------------------------------------------
  function _clampNumber(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.max(min, Math.min(max, num));
  }

  function _storedNumber(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      // localStorageに未保存（null）の場合に Number(null) === 0 を「保存済みの0」と
      // 誤認しないよう、raw が無い場合は明示的に fallback を返す
      // （P2バグ: 初回起動時にサイドバー幅/ビューワー高さが既定値ではなく最小幅へ
      // 縮む不具合。standalone-option-panel.js の同名ヘルパーで先に修正済みの
      // 同型バグをこちらにも適用する）。
      if (raw === null || raw === '') return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function _rightSidebarMaxWidth() {
    return Math.max(280, Math.min(760, window.innerWidth - 320));
  }

  function _viewerMaxHeight() {
    const sidebar = document.getElementById('board-right-sidebar');
    const total = sidebar?.clientHeight || window.innerHeight;
    return Math.max(140, total - 170);
  }

  function _setRightSidebarWidth(width, persist) {
    const shell = document.getElementById('board-standalone-shell');
    if (!shell) return;
    const next = _clampNumber(width, 260, _rightSidebarMaxWidth());
    shell.style.setProperty('--bsa-sidebar-width', `${Math.round(next)}px`);
    if (persist) {
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(next))); } catch (e) {}
    }
    _refreshBoardViewport();
  }

  function _setViewerHeight(height, persist) {
    const shell = document.getElementById('board-standalone-shell');
    if (!shell) return;
    const next = _clampNumber(height, 120, _viewerMaxHeight());
    shell.style.setProperty('--bsa-viewer-height', `${Math.round(next)}px`);
    if (persist) {
      try { localStorage.setItem(VIEWER_HEIGHT_KEY, String(Math.round(next))); } catch (e) {}
    }
    _refreshBoardViewport();
  }

  function _refreshBoardViewport() {
    if (boardViewportRefreshRaf) return;
    boardViewportRefreshRaf = requestAnimationFrame(() => {
      boardViewportRefreshRaf = 0;
      if (typeof bdTransform === 'function') bdTransform();
      if (typeof bdUpdateMinimap === 'function') bdUpdateMinimap();
    });
  }

  function _applyStoredSidebarLayout() {
    _setRightSidebarWidth(_storedNumber(SIDEBAR_WIDTH_KEY, 360), false);
    _setViewerHeight(_storedNumber(VIEWER_HEIGHT_KEY, 240), false);
  }

  function _toolbarClass(position) {
    return position === 'bottom' ? 'bsa-hide-bottom-toolbar' : 'bsa-hide-top-toolbar';
  }

  function _toolbarStorageKey(position) {
    return position === 'bottom' ? BOTTOM_TOOLBAR_HIDDEN_KEY : TOP_TOOLBAR_HIDDEN_KEY;
  }

  function _isToolbarVisible(position) {
    if (window.MeldexBoardImmersive?.getMode) {
      return window.MeldexBoardImmersive.getMode(position) === 'pinned';
    }
    const shell = document.getElementById('board-standalone-shell');
    return !shell?.classList.contains(_toolbarClass(position));
  }

  function _setToolbarVisible(position, visible) {
    const shell = document.getElementById('board-standalone-shell');
    if (!shell) return;
    if (window.MeldexBoardImmersive?.setMode) {
      shell.classList.remove(_toolbarClass(position));
      window.MeldexBoardImmersive.setMode(position, visible ? 'pinned' : 'auto');
      return;
    }
    shell.classList.toggle(_toolbarClass(position), !visible);
    try { localStorage.setItem(_toolbarStorageKey(position), visible ? '0' : '1'); } catch (e) {}
    _refreshBoardViewport();
  }

  function _applyStoredToolbarState() {
    if (window.MeldexBoardImmersive?.scan) {
      document.getElementById('board-standalone-shell')?.classList.remove(
        _toolbarClass('top'),
        _toolbarClass('bottom')
      );
      window.MeldexBoardImmersive.scan();
      return;
    }
    [['top', TOP_TOOLBAR_HIDDEN_KEY], ['bottom', BOTTOM_TOOLBAR_HIDDEN_KEY]].forEach(([position, key]) => {
      let hidden = false;
      try { hidden = localStorage.getItem(key) === '1'; } catch (e) {}
      _setToolbarVisible(position, !hidden);
    });
  }

  let _layoutControlsInitialized = false;
  // 単独アプリはメインパネルのアプリが固定なので、ショートカット一覧の初期絞り込みを宣言する
  window.__meldexAppShortcutScope = 'board';

  function _initStandaloneLayoutControls() {
    if (_layoutControlsInitialized) return;
    const widthHandle = document.getElementById('board-sidebar-resizer');
    const heightHandle = document.getElementById('board-sidebar-splitter');
    widthHandle?.addEventListener('pointerdown', event => {
      if (!_isOptionsPanelVisible()) return;
      event.preventDefault();
      const sidebar = document.getElementById('board-right-sidebar');
      const startWidth = sidebar?.getBoundingClientRect().width || 360;
      const startX = event.clientX;
      const onMove = moveEvent => _setRightSidebarWidth(startWidth + startX - moveEvent.clientX, false);
      const onUp = upEvent => {
        document.body.classList.remove('bsa-resizing-sidebar');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        _setRightSidebarWidth(startWidth + startX - upEvent.clientX, true);
      };
      document.body.classList.add('bsa-resizing-sidebar');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    widthHandle?.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const sidebar = document.getElementById('board-right-sidebar');
      const current = sidebar?.getBoundingClientRect().width || _storedNumber(SIDEBAR_WIDTH_KEY, 360);
      _setRightSidebarWidth(current + (event.key === 'ArrowLeft' ? 16 : -16), true);
    });
    heightHandle?.addEventListener('pointerdown', event => {
      if (!_isOptionsPanelVisible()) return;
      event.preventDefault();
      const viewer = document.getElementById('board-viewer');
      const startHeight = viewer?.getBoundingClientRect().height || 240;
      const startY = event.clientY;
      const onMove = moveEvent => _setViewerHeight(startHeight + moveEvent.clientY - startY, false);
      const onUp = upEvent => {
        document.body.classList.remove('bsa-resizing-sidebar');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        _setViewerHeight(startHeight + upEvent.clientY - startY, true);
      };
      document.body.classList.add('bsa-resizing-sidebar');
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    heightHandle?.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const viewer = document.getElementById('board-viewer');
      const current = viewer?.getBoundingClientRect().height || _storedNumber(VIEWER_HEIGHT_KEY, 240);
      _setViewerHeight(current + (event.key === 'ArrowDown' ? 16 : -16), true);
    });
    window.addEventListener('resize', () => {
      _setRightSidebarWidth(_storedNumber(SIDEBAR_WIDTH_KEY, 360), false);
      _setViewerHeight(_storedNumber(VIEWER_HEIGHT_KEY, 240), false);
    });
    document.getElementById('board-canvas-root')?.addEventListener('contextmenu', event => {
      if (!event.target?.closest?.('[data-bd-role="toolbar-top"], [data-bd-role="toolbar-bottom"]')) return;
      if (typeof bdContextMenu !== 'function') return;
      event.preventDefault();
      event.stopPropagation();
      bdContextMenu(event, null);
    }, true);
    _layoutControlsInitialized = true;
  }

  function _appendStandaloneDisplayContextMenuItems(target) {
    if (!target?.item) return;
    const visible = _isOptionsPanelVisible();
    const mark = typeof radioMark === 'function' ? radioMark(visible) : (visible ? '✓ ' : '');
    target.item(mark + (visible ? '右サイドバーを閉じる' : '右サイドバーを開く'), () => _toggleOptionsPanel(), {
      role: 'menuitemcheckbox',
      checked: visible,
    });
  }

  // スマホ幅（≤820px）で優先操作だけを常時表示し、残りを「その他」ボトムシートへ畳む
  // （計画書: standalone-mobile-toolbar_plan_2026-07-20.md §4）。
  // 上段ツールバー（toolbar-top）のみ対象。gb-board-presets.js の
  // bdBuildBoardShellMarkup() は本体共用のため無改変のまま、生成後にここから設定する。
  //
  // 計画書は「オプションを開く」(data-bd-action="detail") も優先ボタンに挙げているが、
  // このボタンは gb-layout.part01.css の
  // `html:not([data-single-window="1"]) .gb-toolbar-option-panel-btn { display: none !important; }`
  // により幅に関係なく常時非表示（単独版は data-single-window を付与しない）。
  // 既に機能していないボタンのため優先リストへは含めない（右サイドバー開閉は
  // 標準メニューの「右サイドバーを開く/閉じる」から到達できる）。
  // 「常に最前面」ボタン。Windowsデスクトップ版だけで有効で、非対応環境では出さない
  // （standalone-always-on-top.js がサーバーの supported を見て判断する）。
  function _initAlwaysOnTopButton(host) {
    const toolbar = host.querySelector('[data-bd-role="toolbar-top"]');
    if (!toolbar) return;
    window.MeldexAlwaysOnTop?.install({
      appId: 'board',
      host: toolbar,
      buttonClass: 'tb-icon-btn bd-toolbar-btn bd-toolbar-icon-btn',
    });
  }

  function _initMobileToolbar(host) {
    _initAlwaysOnTopButton(host);
    const toolbar = host.querySelector('[data-bd-role="toolbar-top"]');
    if (!toolbar || !window.MeldexStandaloneMobileToolbar) return;
    window.MeldexStandaloneMobileToolbar.setup({
      toolbar,
      priority: ['.tool-menu-btn', '[data-bd-action="undo"]', '[data-bd-action="redo"]', '[data-bd-tool="add-card"]', '[data-bd-tool="add-line"]'],
      // [data-sa-profile-badge] はユーザー名・アイコンバッジ（standalone-profile.js が
      // 挿入。gb-board-presets.js の生成markupには含まれず、後から追記されるため
      // 初回 _classify() 実行後の挿入なら未分類のまま常時表示になるが、将来
      // MeldexStandaloneMobileToolbar.refresh() が呼ばれた場合の保険として keep に含める。
      keep: ['[data-bd-control="title"]', '[data-sa-profile-badge]'],
      sheetTitle: 'その他',
    });
  }

  // -------------------------------------------------------------------------
  // ボードの DOM を初期化
  // -------------------------------------------------------------------------
  let _boardShellInitialized = false;
  function _initBoardShell() {
    if (_boardShellInitialized) return true;
    const host = document.getElementById('board-canvas-root');
    if (!host) return false;
    if (typeof window.bdBuildBoardShellMarkup !== 'function') {
      _showError('ボードシェル構築関数が見つかりません');
      return false;
    }
    host.classList.add('gb-canvas-root');
    host.dataset.bdIdSuffix = 'standalone';
    host.innerHTML = window.bdBuildBoardShellMarkup('standalone');
    // 「アクティブボード」として正規 ID（bd-canvas / bd-world / bd-nodes 等）を
    // この root の要素に付与する。これをしないと bdFitAll や bdRender の中の
    // getElementById('bd-canvas') / getElementById('bd-nodes') が見つからず、
    // 描画ゼロ・10%ズームに張り付くなどの不具合が起きる。
    if (typeof window._bdSetActiveBoardRootIds === 'function') {
      window._bdSetActiveBoardRootIds(host, 'standalone');
    }
    if (typeof window.bdInitBoardShell === 'function') {
      window.bdInitBoardShell(host);
    }
    const title = host.querySelector('[data-bd-control="title"]');
    if (title && title.dataset.bsaEditableTitle !== '1') {
      title.dataset.bsaEditableTitle = '1';
      title.title = 'クリックしてボード名を編集';
      title.setAttribute('role', 'button');
      title.tabIndex = 0;
      const edit = () => window._bdStartInlineBoardTitleEdit?.(title);
      title.addEventListener('click', edit);
      title.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        edit();
      });
      const syncStatus = document.createElement('span');
      syncStatus.id = 'board-sync-status';
      syncStatus.className = 'sa-sync-status';
      syncStatus.setAttribute('aria-live', 'polite');
      title.insertAdjacentElement('afterend', syncStatus);
    }
    if (typeof window.bdInitInteraction === 'function') {
      window.bdInitInteraction(host);
    }
    if (typeof window.bdInitKeyboard === 'function') {
      window.bdInitKeyboard(host);
    }
    if (typeof window.initIframeMarkup === 'function') {
      const canvas = host.querySelector('[data-bd-role="canvas"]');
      if (canvas) window.initIframeMarkup(canvas);
    }
    _initMobileToolbar(host);
    // フォルダを選んだ時点で起動画面を消し、ボード本体（ツールバー含む）を表示する。
    // ファイルを未選択でもツールバーは出しておく。
    host.classList.remove('bsa-hidden');
    document.body.classList.add('bsa-board-ready');
    document.getElementById('board-start-screen')?.classList.add('bsa-hidden');
    _initStandaloneLayoutControls();
    _applyStoredSidebarLayout();
    _applyStoredToolbarState();
    _applyStoredOptionsPanelState();
    _boardShellInitialized = true;
    return true;
  }

  function _isOptionsPanelVisible() {
    return !document.getElementById('board-standalone-shell')?.classList.contains('bsa-options-collapsed');
  }

  function _setOptionsPanelVisible(visible, persist = true) {
    const shell = document.getElementById('board-standalone-shell');
    if (!shell) return;
    shell.classList.toggle('bsa-options-collapsed', !visible);
    if (window.MeldexBoardImmersive) {
      if (visible) window.MeldexBoardImmersive.reveal?.('right');
      else {
        window.MeldexBoardImmersive.setMode?.('right', 'auto');
        window.MeldexBoardImmersive.hide?.('right', true);
      }
    }
    if (persist) {
      try { localStorage.setItem(OPTIONS_COLLAPSED_KEY, visible ? '0' : '1'); } catch (e) {}
    }
    const detailBtn = document.querySelector('[data-bd-action="detail"]');
    if (detailBtn) {
      detailBtn.title = visible ? '右サイドバーを閉じる' : '右サイドバーを開く';
      detailBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
    }
    requestAnimationFrame(() => {
      if (typeof bdTransform === 'function') bdTransform();
      if (typeof bdUpdateMinimap === 'function') bdUpdateMinimap();
    });
  }

  function _toggleOptionsPanel() {
    _setOptionsPanelVisible(!_isOptionsPanelVisible());
  }

  function _applyStoredOptionsPanelState() {
    if (window.MeldexBoardImmersive?.scan) {
      _setOptionsPanelVisible(false, false);
      window.MeldexBoardImmersive.scan();
      return;
    }
    let stored = null;
    try { stored = localStorage.getItem(OPTIONS_COLLAPSED_KEY); } catch (e) {}
    const narrow = window.matchMedia?.('(max-width: 820px)')?.matches === true;
    const collapsed = narrow || stored === '1';
    _setOptionsPanelVisible(!collapsed, false);
  }

  function _closeStandaloneMenu() {
    document.querySelectorAll('.bsa-menu-dropdown').forEach(el => el.remove());
  }

  function _menuItem(label, action, options = {}) {
    return { label, action, disabled: !!options.disabled, separator: !!options.separator };
  }

  function _standaloneMenuItems() {
    const native = !!FS.isNativeMode?.();
    const cloud = window.MeldexStandaloneCloud?.isCloudMode?.() === true;
    const hasRoot = !!FS.getRootHandle?.();
    const hasPath = !!_boardState()?.path;
    const items = [
      _menuItem('新規ボード', () => _createNewBoard()),
      _menuItem(hasPath ? '保存' : '名前を付けて保存', () => _saveCurrentBoard()),
      _menuItem('ボードを開く...', () => _openBoardFromMenu()),
      _menuItem('シート / スマートシートから一括読込...', () => _openStandaloneBulkImport(), { disabled: !hasPath }),
    ];
    if (!native) {
      items.push(
        _menuItem(hasRoot ? '保存場所を変更...' : '保存場所を選ぶ...', () => _changeRootFolder()),
        _menuItem('一覧を更新', () => _refreshBoardList(), { disabled: !hasRoot }),
      );
    }
    if (cloud) {
      items.push(_menuItem('Meldexファイル', () => window.MeldexStandaloneWorkspaceTree?.open?.()));
    }
    items.push(
      _menuItem('', null, { separator: true }),
      _menuItem('Meldexのチャットで続ける', () => window.open(new URL('/?continue=chat', window.location.origin).href, '_blank', 'noopener')),
      _menuItem('画像（PNG）として保存', () => _exportBoardPng(), { disabled: !hasPath }),
      _menuItem('HTMLとして保存...', () => _exportBoardHtml(), { disabled: !hasPath }),
      _menuItem('', null, { separator: true }),
      _menuItem(_imageDropModeLabel(), () => _toggleImageDropMode()),
      _menuItem(_isOptionsPanelVisible() ? '右サイドバーを閉じる' : '右サイドバーを開く', () => _toggleOptionsPanel()),
    );
    if (!cloud) {
      items.push(
        _menuItem('', null, { separator: true }),
        _menuItem('既定アプリに設定...', () => window.MeldexStandaloneDefaultApps?.openDialog?.({ source: 'menu' })),
      );
    }
    return items;
  }

  async function _openStandaloneBulkImport() {
    if (typeof window.bdOpenBulkLinkImport !== 'function') {
      _showError('一括読込機能を読み込めませんでした。アプリを再読み込みしてください');
      return;
    }
    const path = String(await window.cfPrompt?.(
      '読み込むシートまたはスマートシートのMeldex内パスを入力してください',
      '',
      { okLabel: '選択へ進む' },
    ) || '').trim().replace(/\\/g, '/');
    if (!path) return;
    const type = /\.smart-db(?:\.json)?$/i.test(path) ? 'smart-db' : 'database';
    const pane = typeof window._bsaSetBulkSourceTab === 'function'
      ? window._bsaSetBulkSourceTab({
        id: 'board-standalone-bulk-source',
        path,
        type,
        label: path.split('/').pop() || path,
        state: {},
      })
      : window.GBLayout?.getAllPanes?.(window.GBLayout.root)?.[0];
    if (!pane || !Array.isArray(pane.tabs)) {
      _showError('一括読込元を準備できませんでした');
      return;
    }
    if (typeof window._bsaSetBulkSourceTab !== 'function') {
      pane.tabs = pane.tabs.filter(tab => !tab?._standaloneBulkSource);
      pane.tabs.push({
        id: 'board-standalone-bulk-source',
        path,
        type,
        label: path.split('/').pop() || path,
        state: {},
        _standaloneBulkSource: true,
      });
    }
    try {
      await window.bdOpenBulkLinkImport();
    } catch (error) {
      _showError('一括読込を開始できませんでした: ' + (error?.message || error));
    }
  }

  function _showStandaloneMenu(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    _closeStandaloneMenu();
    const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = document.createElement('div');
    menu.className = 'bsa-menu-dropdown';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'ボードメニュー');
    _standaloneMenuItems().forEach(item => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'bsa-menu-separator';
        sep.setAttribute('role', 'separator');
        menu.appendChild(sep);
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bsa-menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = item.label;
      btn.disabled = item.disabled;
      btn.addEventListener('click', () => {
        dismissStandaloneMenu();
        item.action?.();
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const anchor = event?.target?.closest?.('.tool-menu-btn') || event?.target;
    const rect = anchor?.getBoundingClientRect?.() || { left: event?.clientX || 8, bottom: event?.clientY || 8 };
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';
    const box = menu.getBoundingClientRect();
    if (box.right > window.innerWidth) menu.style.left = Math.max(4, window.innerWidth - box.width - 4) + 'px';
    if (box.bottom > window.innerHeight) menu.style.top = Math.max(4, rect.top - box.height - 4) + 'px';
    const restoreFocus = () => {
      if (restoreFocusTo?.isConnected && !menu.contains(restoreFocusTo)) restoreFocusTo.focus?.();
    };
    let menuClosed = false;
    let closeOnPointerDown = null;
    const dismissStandaloneMenu = (options = {}) => {
      if (menuClosed) return;
      menuClosed = true;
      _closeStandaloneMenu();
      if (closeOnPointerDown) document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', onKeydown, true);
      if (options.restore !== false) restoreFocus();
    };
    const onKeydown = ev => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      dismissStandaloneMenu();
    };
    document.addEventListener('keydown', onKeydown, true);
    setTimeout(() => {
      if (menuClosed || !menu.isConnected) return;
      closeOnPointerDown = ev => {
        if (!menu.contains(ev.target)) {
          dismissStandaloneMenu();
        }
      };
      document.addEventListener('pointerdown', closeOnPointerDown);
    }, 0);
    menu.querySelector('.bsa-menu-item:not(:disabled)')?.focus?.();
  }

  window.MeldexBoardStandalone = {
    createNewBoard: _createNewBoard,
    saveCurrentBoard: _saveCurrentBoard,
    openBoardFromMenu: _openBoardFromMenu,
    openLinkedPathExternally: _openLinkedPathExternally,
    changeRootFolder: _changeRootFolder,
    refreshBoardList: _refreshBoardList,
    toggleOptionsPanel: _toggleOptionsPanel,
    isOptionsPanelVisible: _isOptionsPanelVisible,
    appendDisplayContextMenuItems: _appendStandaloneDisplayContextMenuItems,
    setToolbarVisible: _setToolbarVisible,
    isToolbarVisible: _isToolbarVisible,
  };

  // gb-right-panel.js（本体のコメント一覧ロジック目的で同梱）が
  // toggleRightPanelTab/openRightPanelTab を本体の3カラム右パネル前提で
  // 上書きしてしまうため、単独版ボードの右サイドバー実装へ差し戻す
  // （board-standalone-stubs.js は先に読み込まれるため、そちらでの
  // 上書きだけでは gb-right-panel.js 側に負けてしまう。最後に読み込まれる
  // このファイルで確定させる）。
  function _restoreStandaloneRightPanelDispatch() {
    if (typeof window._bsaOpenStandalonePanel !== 'function') return;
    window.openRightPanelTab = function (tabName) { return window._bsaOpenStandalonePanel(tabName); };
    window.toggleRightPanelTab = window.openRightPanelTab;
  }
  _restoreStandaloneRightPanelDispatch();

  function _annotationTargetPath() {
    const state = _boardState();
    return String(state?.path || window.state?.currentBoardPath || '').trim();
  }

  function _installStandaloneAnnotationGuard() {
    if (typeof window.toggleAnnotationToolbar !== 'function') return;
    if (window.toggleAnnotationToolbar._bsaGuarded) return;
    const originalToggle = window.toggleAnnotationToolbar;
    const guardedToggle = function (...args) {
      if (!_annotationTargetPath()) {
        _showError('注釈を使う前に、ボードを保存するか既存のボードを開いてください');
        return null;
      }
      return originalToggle.apply(this, args);
    };
    guardedToggle._bsaGuarded = true;
    window.toggleAnnotationToolbar = guardedToggle;
    window.toggleAnnotation = function () { return guardedToggle(); };
  }

  window.showToolMenu = function (event, toolType) {
    if (toolType === 'board') {
      _showStandaloneMenu(event);
    }
  };

  function _standaloneShortcutIntent(event) {
    const key = String(event.key || '').toLowerCase();
    const code = String(event.code || '');
    const hasMainModifier = event.ctrlKey || event.metaKey;
    if (!hasMainModifier || event.shiftKey || event.altKey) return '';
    if (key === 's' || code === 'KeyS' || event.keyCode === 83) return 'save';
    if (key === 'o' || code === 'KeyO' || event.keyCode === 79) return 'open';
    if (key === 'p' || code === 'KeyP' || event.keyCode === 80) return 'open';
    if (key === 'n' || code === 'KeyN' || event.keyCode === 78) return 'new';
    return '';
  }

  function _runStandaloneShortcut(intent) {
    const action = intent === 'save' ? _saveCurrentBoard
      : intent === 'open' ? _openBoardFromMenu
        : intent === 'new' ? _createNewBoard : null;
    if (!action) return null;
    const labels = { save: '保存', open: 'ボードを開くことが', new: '新規作成' };
    return window.MeldexStandaloneBoot?.run
      ? window.MeldexStandaloneBoot.run(labels[intent], action)
      : action();
  }

  function _initStandaloneShortcuts() {
    document.addEventListener('keydown', event => {
      const intent = _standaloneShortcutIntent(event);
      if (!intent) return;
      if (intent !== 'save' && document.querySelector('.modal-overlay')) return;
      event.preventDefault();
      event.stopPropagation();
      _runStandaloneShortcut(intent);
    }, true);
  }

  // -------------------------------------------------------------------------
  // 起動シーケンス
  // -------------------------------------------------------------------------
  function _bindBootUi() {
    if (!_isSupportedBrowser()) {
      _showCompatNotice();
      return;
    }
    window.MeldexStandaloneParity?.init?.({
      appId: 'board',
      getPath: () => String(_boardState()?.path || window.state?.currentBoardPath || ''),
      getLabel: () => document.getElementById('bd-title')?.textContent || '',
      openCurrent: path => _openBoard(path, { skipDiscardConfirm: true }),
      canReplaceCurrent: _canReplaceCurrentBoard,
      openFloat: (target) => window._bsaOpenLinkedPathInSidebar?.(
        target.path,
        target.label,
        { linkType: target.type },
      ) === true,
    });
    if (typeof window._bsaShowLinkDestinationDialog === 'function') {
      window.openLinkInFloatPanel = window._bsaShowLinkDestinationDialog;
    }
    // 「フォルダを選ぶ」ボタン
    const pickBtn = document.getElementById('board-pick-folder');
    pickBtn?.addEventListener('click', async () => {
      const pick = async () => {
        const handle = await _pickRootFolder();
        if (handle) {
          _setRootUi(true);
          _initBoardShell();
          _ensureStarterBoard();
          await _renderFileList();
        }
      };
      if (window.MeldexStandaloneBoot?.run) {
        await window.MeldexStandaloneBoot.run('フォルダを選ぶことが', pick);
      } else {
        await pick();
      }
    });
  }

  async function _initializeBoardData() {
    if (typeof FS.initNativeIfAvailable === 'function') {
      await FS.initNativeIfAvailable();
    }
    if (!_isSupportedBrowser()) return;
    // 起動時に前回フォルダの復元を試みる
    const restored = await _tryRestoreSavedFolder();
    if (restored) {
      _setRootUi(true);
      _initBoardShell();
      // 固有形式付随物廃止・管理データ一元化計画 Phase 5: 起動後のバックグラウンド
      // 保守として1回実行する。ユーザー操作はブロックしない(失敗しても無視)。
      if (typeof FS.runSidecarMigrationIfSupported === 'function') {
        FS.runSidecarMigrationIfSupported().catch(() => {});
      }
      if (typeof FS.runRetentionCleanupIfSupported === 'function') {
        FS.runRetentionCleanupIfSupported().catch(() => {});
      }
      const initialPath = typeof FS.nativeInitialPath === 'function' ? FS.nativeInitialPath() : '';
      let loading = false;
      try {
        if (initialPath) {
          _setBoardLoading(true, 'ボードを読み込んでいます: ' + (initialPath.split('/').pop() || initialPath));
          loading = true;
        }
        await _renderFileList();
        if (initialPath) {
          const opened = await _openBoard(initialPath, { skipDiscardConfirm: true });
          if (!opened) _ensureStarterBoard();
        } else _ensureStarterBoard();
      } catch (e) {
        _showError('起動時のボードを開けませんでした: ' + (e?.message || e));
        _ensureStarterBoard();
      } finally {
        if (loading) _setBoardLoading(false);
      }
    } else {
      _setRootUi(false);
      _createStarterBoard();
    }
    await _initLocalDrafts();
  }

  async function _initLocalDrafts() {
    if (!window.MeldexStandaloneLocalDrafts) return;
    localDrafts = window.MeldexStandaloneLocalDrafts.create({
      appId: 'board',
      getPath: () => String(_boardState()?.path || ''),
      capture: () => ({
        title: (document.getElementById('bd-title')?.textContent || '新規ボード').trim(),
        content: typeof bdToMd === 'function' ? bdToMd() : '',
      }),
      restore: async (snapshot, record) => {
        if (typeof bdOpenBoard !== 'function') return;
        const loadPath = record.remotePath
          || `__local__/${record.localDocumentId || 'draft'}.mel-board`;
        const originalFetch = window.apiFetch;
        window.apiFetch = async (url, options) => {
          const requested = new URL(String(url || ''), location.href).searchParams.get('path') || '';
          if (requested.replace(/\\/g, '/') === loadPath) {
            return { path: loadPath, content: snapshot.content || '', etag: record.baseRevision || '' };
          }
          return originalFetch(url, options);
        };
        try {
          await bdOpenBoard(snapshot.title || '端末内のボード', loadPath);
          const board = _boardState();
          if (board) {
            if (!record.remotePath) {
              board.path = '';
              board._loadedBoardPath = '';
              if (window.state) window.state.currentBoardPath = '';
              FS.setCurrentPath?.('');
            }
            board.dirty = true;
          }
        } finally {
          window.apiFetch = originalFetch;
        }
      },
      sync: async (snapshot, record) => {
        const result = await apiPut('/file?path=' + encodeURIComponent(record.remotePath), {
          content: snapshot.content || '',
          skip_if_missing: true,
          if_match_etag: record.baseRevision || '',
        });
        if (result?.queued) throw new Error('接続後に再試行します');
        if (result?.missing || result?.skipped) throw new Error('保存先が見つかりません');
        const board = _boardState();
        if (board?.path === record.remotePath && typeof bdToMd === 'function' && bdToMd() === snapshot.content) {
          board.dirty = false;
        }
      },
      onStatus: (state, message) => {
        const label = document.getElementById('board-sync-status');
        if (label) {
          label.textContent = message || (state === 'synced' ? '同期済み' : '');
          label.dataset.status = state;
        }
        if (['conflict', 'error', 'destination-check'].includes(state)) _showError(message);
      },
    });
    localDrafts.start();
    window.MeldexStandaloneCloseGuard?.register?.({
      appId: 'board',
      saveAs: _saveCurrentBoard,
      prepareClose: async () => {
        if (document.body.classList.contains('bsa-resizing-sidebar')) return false;
        document.activeElement?.blur?.();
        return true;
      },
    });
    const boardDirty = window.bdDirty;
    if (typeof boardDirty === 'function' && boardDirty._meldexLocalDraftCapture !== true) {
      const wrappedBoardDirty = function (...args) {
        localDrafts?.schedule?.();
        return boardDirty.apply(this, args);
      };
      wrappedBoardDirty._meldexLocalDraftCapture = true;
      window.bdDirty = wrappedBoardDirty;
    }
    await localDrafts.restoreLatest();
    localDrafts.flush();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.MeldexStandaloneBoot = window.MeldexStandaloneBootstrap.create({
        appId: 'board',
        bindUi: _bindBootUi,
        initialize: _initializeBoardData,
        onError: error => _showError('ボードの保存先へ接続できません: ' + (error?.message || error) + '。操作すると再試行します。'),
      });
      window.MeldexStandaloneBoot.start().catch(() => {});
    });
  } else {
    window.MeldexStandaloneBoot = window.MeldexStandaloneBootstrap.create({
      appId: 'board',
      bindUi: _bindBootUi,
      initialize: _initializeBoardData,
      onError: error => _showError('ボードの保存先へ接続できません: ' + (error?.message || error) + '。操作すると再試行します。'),
    });
    window.MeldexStandaloneBoot.start().catch(() => {});
  }
  _bindCloudPathChanges();
  _installStandaloneAnnotationGuard();
  _initStandaloneShortcuts();
})();
