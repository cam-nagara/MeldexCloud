      // 親フォルダの移動/リネームでパスだけが変わった場合は除外される。
      if (editor && editor.doc && mapped === newPath && exactLabel != null && editor.doc.title !== exactLabel) {
        editor.doc.title = exactLabel;
        const scriptNoteRoot = editor.host && typeof editor.host.closest === 'function'
          ? editor.host.closest('.gb-scriptnote-root')
          : null;
        const titleInput = scriptNoteRoot ? scriptNoteRoot.querySelector('#title-input') : null;
        // プログラムによる value 代入は change イベントを発火しないため、
        // タイトル入力の change ハンドラ（リネームAPI再呼び出し）は起動しない。
        if (titleInput && titleInput.value !== exactLabel) titleInput.value = exactLabel;
      }
      if (editor && mapped === newPath && (options.etag || options.transport_revision)) {
        editor._lastSavedEtag = options.etag || options.transport_revision;
        if (editor._lastSavedTransportRevision) {
          editor._lastSavedTransportRevision = options.transport_revision || options.etag;
        }
      }
    });
  }

  if (legacyTabsChanged) renderTabs();
  if (layoutChanged && typeof GBLayout !== 'undefined') {
    if (typeof GBLayout.render === 'function') GBLayout.render();
    if (typeof GBLayout.saveLayout === 'function') GBLayout.saveLayout();
  }
  _refreshRenamedCurrentDatabase(previousDbPath, state.currentDbPath);
}

function purgeAppPathReferences(paths) {
  const deletedPaths = (Array.isArray(paths) ? paths : [paths])
    .map(path => String(path || '').trim())
    .filter(Boolean);
  if (!deletedPaths.length) return;
  let recentChanged = false;
  let layoutChanged = false;
  let legacyTabsChanged = false;
  let clearedCurrentView = false;
  _cancelDeletedPathAutosaves(deletedPaths);
  const activePathKey = {
    pivot: 'currentDbPath',
    gallery: 'currentDbPath',
    kanban: 'currentDbPath',
    timeline: 'currentDbPath',
    calendar: 'currentDbPath',
    tasks: 'currentDbPath',
    shifts: 'currentDbPath',
    chart: 'currentDbPath',
    graph: 'currentDbPath',
    entity: 'currentEntityPath',
    page: 'currentPagePath',
    media: 'currentPagePath',
    board: 'currentBoardPath',
  }[state.view] || null;

  Object.keys(_fileIdCache).forEach(cachedPath => {
    if (!_matchesDeletedPaths(cachedPath, deletedPaths)) return;
    const fid = _fileIdCache[cachedPath];
    delete _fileIdCache[cachedPath];
    if (fid && _pathCache[fid] === cachedPath) delete _pathCache[fid];
  });
  _purgeStoredFileIdMapForDeletedPaths(deletedPaths);
  _purgeStoredPathSettingForDeletedPaths('outliner-work-folder', 'outliner-work-folder-id', deletedPaths);
  _purgeStoredPathSettingForDeletedPaths('main-calendar-path', 'main-calendar-id', deletedPaths);
  _purgePublishStorageForDeletedPaths(deletedPaths);

  try {
    const recent = _readStorageArray(RECENT_KEY);
    const nextRecent = recent.filter(entry => {
      return !_entryMatchesDeletedPaths(entry, deletedPaths);
    });
    if (nextRecent.length !== recent.length) {
      localStorage.setItem(RECENT_KEY, JSON.stringify(nextRecent));
      recentChanged = true;
    }
  } catch {}

  try {
    const lastView = JSON.parse(localStorage.getItem('lastView') || 'null');
    if (lastView) {
      if (_entryMatchesDeletedPaths(lastView, deletedPaths)) {
        localStorage.removeItem('lastView');
      }
    }
  } catch {}

  for (let i = _tabs.length - 1; i >= 0; i -= 1) {
    const tab = _tabs[i];
    if (!_entryMatchesDeletedPaths(tab, deletedPaths)) continue;
    if (_activeTabId === tab.id) _activeTabId = null;
    _tabs.splice(i, 1);
    legacyTabsChanged = true;
  }
  if (!_activeTabId && _tabs.length > 0) {
    _activeTabId = _tabs[0].id;
    legacyTabsChanged = true;
  }

  for (let i = _legacyNavHistory.length - 1; i >= 0; i -= 1) {
    const entry = _legacyNavHistory[i];
    if (_entryMatchesDeletedPaths(entry, deletedPaths)) {
      _legacyNavHistory.splice(i, 1);
      if (_legacyNavIndex >= i) _legacyNavIndex = Math.max(-1, _legacyNavIndex - 1);
    }
  }

  const tabsToClose = [];
  if (typeof GBLayout !== 'undefined' && typeof GBLayout.getAllPanes === 'function' && GBLayout.root) {
    GBLayout.getAllPanes(GBLayout.root).forEach(pane => {
      (pane.tabs || []).forEach(tab => {
        if (_entryMatchesDeletedPaths(tab, deletedPaths) || _entryMatchesDeletedPaths(tab.state, deletedPaths)) {
          tabsToClose.push({ paneId: pane.id, tabId: tab.id });
        }
        // タブ単位の戻る/進む履歴（②タブ別ナビ履歴、2026-07-21）: 削除済みパスを参照する履歴エントリを除去
        if (Array.isArray(tab.navHistory)) {
          const prevLen = tab.navHistory.length;
          tab.navHistory = tab.navHistory.filter(entry => !_entryMatchesDeletedPaths(entry, deletedPaths));
          if (tab.navHistory.length !== prevLen) {
            tab.navIndex = tab.navHistory.length ? Math.min(tab.navIndex, tab.navHistory.length - 1) : -1;
            layoutChanged = true;
          }
        }
      });
    });
  }
  tabsToClose.forEach(({ paneId, tabId }) => {
    if (typeof GBTabs !== 'undefined' && typeof GBTabs.closeTab === 'function') {
      GBTabs.closeTab(paneId, tabId);
    }
  });

  ['currentDbPath', 'currentEntityPath', 'currentPagePath', 'currentBoardPath'].forEach(key => {
    if (_matchesDeletedPaths(state[key], deletedPaths)) {
      state[key] = null;
      if (key === activePathKey) clearedCurrentView = true;
    }
  });
  const smartDbRuntimePath = state.currentSmartDb?._filePath || _smartDbIdPath(state.currentSmartDb?.id);
  if (smartDbRuntimePath && _matchesDeletedPaths(smartDbRuntimePath, deletedPaths)) {
    state.currentSmartDb = null;
    state.smartDbData = null;
    if (state.view === 'smart-db') clearedCurrentView = true;
  }
  if (!state.currentDbPath) {
    state.pivotData = null;
    state.dbMetadata = null;
  }
  if (_clearDeletedLegacyViewHosts(deletedPaths)) {
    clearedCurrentView = true;
  }

  const pageContent = document.getElementById('page-content');
  if (pageContent?.dataset?.path && _matchesDeletedPaths(pageContent.dataset.path, deletedPaths)) {
    pageContent.dataset.path = '';
    pageContent.contentEditable = 'false';
    pageContent.dataset.loadFailed = '1';
    clearedCurrentView = true;
  }
  const freeText = document.getElementById('entity-freetext');
  if (freeText?.dataset?.entityPath && _matchesDeletedPaths(freeText.dataset.entityPath, deletedPaths)) {
    freeText.dataset.entityPath = '';
    freeText.contentEditable = 'false';
    clearedCurrentView = true;
  }

  if (typeof _csvPath !== 'undefined' && _matchesDeletedPaths(_csvPath, deletedPaths)) {
    if (typeof _csvAutoSaveTimer !== 'undefined' && _csvAutoSaveTimer) {
      clearTimeout(_csvAutoSaveTimer);
      _csvAutoSaveTimer = null;
    }
    if (typeof _csvDirty !== 'undefined') _csvDirty = false;
    _csvPath = '';
    clearedCurrentView = true;
  }

  if (typeof _folderPath !== 'undefined' && _matchesDeletedPaths(_folderPath, deletedPaths)) {
    _folderPath = '';
    if (typeof _folderItems !== 'undefined') _folderItems = [];
    if (typeof _folderSelected !== 'undefined') _folderSelected = null;
    if (typeof _folderSelectedItems !== 'undefined') _folderSelectedItems = [];
    if (state.view === 'folder') clearedCurrentView = true;
  }

  const htmlIframe = document.getElementById('html-iframe');
  if (htmlIframe) {
    const src = htmlIframe.getAttribute('src') || '';
    const decodedSrc = (() => {
      try { return decodeURIComponent(src); } catch { return src; }
    })();
    if (deletedPaths.some(path => decodedSrc.includes(path))) {
      htmlIframe.removeAttribute('src');
      if (state.view === 'html' || state.view === 'media') clearedCurrentView = true;
    }
  }

  const mediaContent = document.getElementById('media-content');
  if (state.view === 'media' && _matchesDeletedPaths(state.currentPagePath, deletedPaths)) {
    if (mediaContent) mediaContent.replaceChildren();
    clearedCurrentView = true;
  }

  if (typeof _sn2Editors !== 'undefined' && _sn2Editors) {
    Object.keys(_sn2Editors).forEach(path => {
      if (!_matchesDeletedPaths(path, deletedPaths)) return;
      const editor = _sn2Editors[path];
      if (editor?._saveTimer) {
        clearTimeout(editor._saveTimer);
        editor._saveTimer = null;
      }
      if (editor) {
        editor._dirty = false;
        editor._path = '';
      }
      delete _sn2Editors[path];
    });
  }

  if (legacyTabsChanged) renderTabs();
  if (recentChanged && typeof updateRecentItems === 'function') updateRecentItems();
  if (layoutChanged && typeof GBLayout !== 'undefined' && typeof GBLayout.saveLayout === 'function') {
    GBLayout.saveLayout();
  }

  if (clearedCurrentView) {
    const fallbackLayoutTab = _findRemainingContentTabAfterDeletion(deletedPaths);
    if (fallbackLayoutTab && typeof GBTabs !== 'undefined' && typeof GBTabs.activateTab === 'function') {
      GBTabs.activateTab(fallbackLayoutTab.paneId, fallbackLayoutTab.tabId);
      return;
    }
    const fallbackTab = _tabs.find(tab => tab.id === _activeTabId) || _tabs[0];
    if (fallbackTab) activateTab(fallbackTab.id);
    else showView('welcome');
  }
}

function _resolveNavHistoryPaneId(paneId) {
  if (typeof GBLayout === 'undefined' || !GBLayout.root) return null;
  // GBLayout に実在しないペインID（旧split用フォールバックctxの 'main'、制作管理
  // 埋め込みシートの未登録合成ID、閉じたペインの残存ID等）は、truthy のまま通すと
  // 後段の findNode 失敗でレガシー共有履歴へ静かに迷子になる。無指定と同じ扱いへ
  // 降格し、アクティブペイン（→先頭ペイン）で解決する。
  const paneExists = !!(paneId && typeof GBLayout.findNode === 'function' && GBLayout.findNode(GBLayout.root, paneId)?.node);
  return (paneExists ? paneId : null) || GBLayout.activePane || GBLayout.findFirstPane?.(GBLayout.root)?.id || null;
}

// タブ単位の履歴へ解決できない場合（GBLayout未初期化・対象ペイン無し・タブ0枚等）の
// フォールバック。旧フラットタブ配列（_tabs）時代の共有履歴を引き続き使う（現状維持）。
function _legacyNavState() {
  return {
    kind: 'legacy',
    paneId: null,
    tabId: null,
    history: _legacyNavHistory,
    get index() { return _legacyNavIndex; },
    set index(v) { _legacyNavIndex = v; },
  };
}

// 戻る/進む履歴はタブ単位（②タブ別ナビ履歴、2026-07-21）。ペインではなく
// 「対象ペインの、今アクティブなタブ」の navHistory/navIndex を解決して返す。
function _getNavState(paneId) {
  const resolvedPaneId = _resolveNavHistoryPaneId(paneId);
  if (!resolvedPaneId || typeof GBLayout === 'undefined' || !GBLayout.root) {
    return _legacyNavState();
  }
  const pane = GBLayout.findNode?.(GBLayout.root, resolvedPaneId)?.node || null;
  if (!pane || !Array.isArray(pane.tabs) || pane.tabs.length === 0) {
    return _legacyNavState();
  }
  const tabIndex = (Number.isInteger(pane.activeTabIndex) && pane.activeTabIndex >= 0 && pane.activeTabIndex < pane.tabs.length)
    ? pane.activeTabIndex
    : 0;
  const tab = pane.tabs[tabIndex];
  if (!tab) return _legacyNavState();
  if (!Array.isArray(tab.navHistory)) tab.navHistory = [];
  if (!Number.isInteger(tab.navIndex)) tab.navIndex = tab.navHistory.length ? tab.navHistory.length - 1 : -1;
  if (tab.navIndex >= tab.navHistory.length) tab.navIndex = tab.navHistory.length - 1;
  return {
    kind: 'tab',
    paneId: resolvedPaneId,
    tabId: tab.id,
    history: tab.navHistory,
    get index() { return tab.navIndex; },
    set index(v) { tab.navIndex = v; },
  };
}

function _refreshPaneNavUi(paneId) {
  if (typeof GBLayout !== 'undefined' && typeof GBLayout.updatePaneNavButtons === 'function') {
    if (paneId) GBLayout.updatePaneNavButtons(paneId);
    else {
      const allPanes = typeof GBLayout.getAllPanes === 'function' ? GBLayout.getAllPanes(GBLayout.root) : [];
      allPanes.forEach(pane => GBLayout.updatePaneNavButtons(pane.id));
    }
  }
}

function _persistPaneNavState(navState) {
  if (navState?.kind === 'tab' && typeof GBLayout !== 'undefined' && typeof GBLayout.saveLayout === 'function') {
    GBLayout.saveLayout();
  }
}

// ナビゲーション履歴記録 + パネルタブ自動更新の起点
// gb-app.js の wrap1 と gb-pane-bridge.js の wrap2 でラップされる
function navPush(entry, paneId) {
  if (navNavigating) return;
  if (!entry || !entry.type) return;
  const navState = _getNavState(paneId);
  const top = navState.history[navState.index];
  if (top && top.type === entry.type && top.path === entry.path) return;
  navState.history.splice(navState.index + 1);
  navState.history.push(entry);
  if (navState.history.length > 50) {
    navState.history.shift();
  }
  navState.index = navState.history.length - 1;
  _refreshPaneNavUi(navState.paneId);
  _persistPaneNavState(navState);
}

function _forcedNavPush(entry, paneId) {
  if (!entry || !entry.type) return;
  const navState = _getNavState(paneId);
  navState.history.splice(navState.index + 1);
  navState.history.push(entry);
  if (navState.history.length > 50) navState.history.shift();
  navState.index = navState.history.length - 1;
  _refreshPaneNavUi(navState.paneId);
  _persistPaneNavState(navState);
}

function _getDbViewScrollContainer(ctx, viewMode) {
  const mode = ['calendar', 'tasks', 'shifts'].includes(viewMode) ? 'timeline' : (viewMode || 'pivot');
  const names = {
    pivot: 'pivot-view',
    tree: 'tree-view',
    gallery: 'gallery-view',
    kanban: 'kanban-view',
    timeline: 'timeline-view',
    chart: 'chart-view',
    graph: 'graph-view',
    form: 'form-view',
  };
  const name = names[mode] || 'pivot-view';
  // メイン画面のビューコンテナは ID（#pivot-view 等。Meldex.html はクラスを持たない）、
  // 制作管理の埋め込みシートはクラス（.pivot-view 等 + 接尾辞付きID）で識別される。
  // クラスだけで探すと本体側が一度もヒットしない（スクロール保存が常に0・復元が素通り）。
  // ctx.containerEl 内を ID→クラスの順で探し、document 全体へのフォールバックでも
  // 埋め込み側の同クラス要素を誤って掴まないよう ID を優先する。
  const scoped = typeof _paneEl === 'function'
    ? (_paneEl(ctx, '#' + name) || _paneEl(ctx, '.' + name))
    : null;
  return scoped || document.getElementById(name) || document.querySelector('.' + name);
}

function _navPushWithViewState(ctx, entityName) {
  ctx = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = ctx?.dbPath || state.currentDbPath;
  if (!dbPath) return;
  const cfg = getDbViewConfig(dbPath);
  const viewIdx = Number.isInteger(ctx?.currentViewIdx) ? ctx.currentViewIdx : cfg.currentViewIdx;
  const viewMode = getCurrentViewMode(dbPath, { ctx });
  const container = _getDbViewScrollContainer(ctx, viewMode);
  let savedView = null;
  try {
    const source = Array.isArray(cfg.savedViews) && Number.isInteger(viewIdx) ? cfg.savedViews[viewIdx] : null;
    savedView = source ? JSON.parse(JSON.stringify(source)) : null;
  } catch {}
  const snapshot = {
    type: 'pivot',
    path: dbPath,
    label: dbPath.split('/').pop() || dbPath,
    viewIdx,
    viewSnapshot: savedView ? { viewIdx, savedView } : null,
    scrollState: {
      scrollLeft: container?.scrollLeft || 0,
      scrollTop: container?.scrollTop || 0,
      focusedEntity: entityName || null,
    },
  };
  const navState = _getNavState(ctx?.paneId);
  const current = navState.history[navState.index];
  if (current && current.path === dbPath && ['pivot', 'database', 'tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph'].includes(current.type)) {
    navState.history[navState.index] = snapshot;
    _refreshPaneNavUi(navState.paneId);
    _persistPaneNavState(navState);
    return;
  }
  _forcedNavPush(snapshot, ctx?.paneId);
}

function navOpen(entry, opts) {
  if (!entry) return;
  const o = opts || undefined;
  if (entry.type === 'page') return openPage(entry.label, entry.path, o);
  if (entry.type === 'csv') return (typeof openCsvFile === 'function') ? openCsvFile(entry.label, entry.path, o) : openPage(entry.label, entry.path, o);
  if (entry.type === 'board') return openBoard(entry.label, entry.path, o);
  if (entry.type === 'entity') return selectEntity(entry.path, o);
  if (entry.type === 'pivot' || entry.type === 'database' || ['tree', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form'].includes(entry.type)) {
    if (entry.calendarFile && entry.type === 'timeline' && typeof openCalendarFile === 'function') return openCalendarFile(entry.label, entry.path, o);
    return selectDatabase(entry.path, null, {
      ...(o || {}),
      restoreViewIdx: entry.viewIdx,
      restoreViewSnapshot: entry.viewSnapshot,
      restoreScrollState: entry.scrollState,
      requestedViewMode: entry.viewMode || (!['database'].includes(entry.type) ? entry.type : ''),
    });
  }
  if (entry.type === 'scriptnote' && typeof openScenarioInScriptNote === 'function') return openScenarioInScriptNote(entry.path, entry.label, o);
  if (entry.type === 'media' || entry.type === 'image' || entry.type === 'video' || entry.type === 'audio') {
    return openMedia(
      entry.label,
      entry.path,
      entry.mediaType || (entry.type === 'media' ? 'image' : entry.type),
      { ...(o || {}), viewerUrl: entry.viewerUrl || o?.viewerUrl },
    );
  }
  if (entry.type === 'html') {
    if (entry.urlExternal && typeof openViewer === 'function') return openViewer(entry.path);
    return openHtmlFile(entry.label, entry.path, o);
  }
  if (entry.type === 'folder') return openFolder(entry.label, entry.path, o);
  if (entry.type === 'archive' && typeof openArchiveFolder === 'function') {
    return openArchiveFolder(entry.archivePath, entry.member || '', o);
  }
  if (entry.type === 'calendar') return openCalendarFile(entry.label, entry.path, o);
  if (entry.type === 'smart-db' && typeof openSmartDbFile === 'function') return openSmartDbFile(entry.label, entry.path, o);
}
function _withNavFlag(result) {
  if (result && typeof result.then === 'function') {
    return result.finally(() => { navNavigating = false; });
  }
  navNavigating = false;
  return result;
}

// Phase 1: ブラウザ履歴 API（pushState/popstate/back/forward）の利用を廃止
// 戻る/進むは Alt+←/→ ショートカット、マウス戻る/進むボタン、
// 各パネルのタブバー上の履歴ボタンから呼ぶ
let state = {
  vaultPath: null,
  currentDbPath: null,   // 現在選択中のDBフォルダパス
  currentEntityPath: null, // 現在選択中のエントリパス
  currentPagePath: null, // 現在選択中のページパス
  currentBoardPath: null, // 現在選択中のボードパス
  currentSmartDb: null, // 現在選択中のスマートDB定義
  smartDbData: null, // スマートDBのAPIレスポンス
  pivotData: null,
  filter: 'disabled', // 'disabled' | 'all' | 'adopted' | 'nobotsu'
  view: 'pivot', // 'pivot' | 'entity' | 'page'
};

/* ==============================
   タブシステム
   ============================== */
const _tabs = []; // {id, label, type, path, icon}
let _activeTabId = null;
let _tabIdCounter = 0;

function _tabIcon(type) {
  if (typeof uiTypeIconName === 'function') {
    const shared = uiTypeIconName(type);
    if (shared) return shared;
  }
  const icons = {pivot:'db',tree:'listTree',gallery:'db',kanban:'db',timeline:'db',media:'galleryThumbnails',html:'globe'};
  return icons[type] || 'page';
}

function addTab(label, type, path) {
  // 同じパス+タイプのタブがあればそちらをアクティブに
  const existing = _tabs.find(t => t.path === path && t.type === type);
  if (existing) { activateTab(existing.id); return existing.id; }
  const id = 'tab-' + (++_tabIdCounter);
  _tabs.push({ id, label: label || '(無題)', type, path, icon: _tabIcon(type) });
  renderTabs();
  activateTab(id);
  return id;
}

function activateTab(tabId) {
  const tab = _tabs.find(t => t.id === tabId);
  if (!tab) return;
  _activeTabId = tabId;
  renderTabs();
  // タブの内容を表示
  navNavigating = true;
  _withNavFlag(navOpen({ type: tab.type, label: tab.label, path: tab.path }));
}

function closeTab(tabId) {
  const idx = _tabs.findIndex(t => t.id === tabId);
  if (idx < 0) return;
  _tabs.splice(idx, 1);
  if (_activeTabId === tabId) {
    // 隣のタブをアクティブに
    if (_tabs.length > 0) {
      const newIdx = Math.min(idx, _tabs.length - 1);
      activateTab(_tabs[newIdx].id);
    } else {
      _activeTabId = null;
      showView('welcome');
    }
  }
  renderTabs();
}

function renderTabs() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  _tabs.forEach((tab, i) => {
    const el = document.createElement('div');
    el.className = 'tab-item' + (tab.id === _activeTabId ? ' active' : '');
    el.dataset.tabIdx = i;
    el.addEventListener('click', (e) => { if (!e.target.closest('.tab-close')) activateTab(tab.id); });
    el.onpointerdown = (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } };
    const iconSvg = typeof lucide === 'function' ? lucide(tab.icon, 14) : '';
    el.innerHTML = `${iconSvg}<span class="tab-label">${esc(tab.label)}</span><span class="tab-close" data-action="closeTab('${tab.id}')">${lucide('x', 12)}</span>`;

    // D&D: タブ順序入替+ウィンドウ分離
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-tab-idx', String(i));
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); _clearTabDragIndicators(); });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      _clearTabDragIndicators();
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) el.classList.add('drag-over-left');
      else el.classList.add('drag-over-right');
    });
    el.addEventListener('dragleave', () => { el.classList.remove('drag-over-left', 'drag-over-right'); });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      _clearTabDragIndicators();
      const fromIdx = parseInt(e.dataTransfer.getData('application/x-tab-idx'));
      if (isNaN(fromIdx) || fromIdx === i) return;
      const rect = el.getBoundingClientRect();
      const insertBefore = e.clientX < rect.left + rect.width / 2;
      const moved = _tabs.splice(fromIdx, 1)[0];
      let toIdx = insertBefore ? i : i + 1;
      if (fromIdx < i) toIdx--;
      _tabs.splice(toIdx, 0, moved);
      renderTabs();
    });

    bar.appendChild(el);
  });
}

function _clearTabDragIndicators() {
  document.querySelectorAll('.tab-item.drag-over-left,.tab-item.drag-over-right').forEach(el => {
    el.classList.remove('drag-over-left', 'drag-over-right');
  });
}

// Meldex内部タブとして開く
function _normalizeOpenTypeForNav(type) {
  if (type === 'database') return 'pivot';
  if (type === 'scenario') return 'scriptnote';
  return type || 'page';
}

function _openInNewTab(label, path, type) {
  const openType = _normalizeOpenTypeForNav(type);
  const id = 'tab-' + (++_tabIdCounter);
  _tabs.push({ id, label: label || '(無題)', type: openType, path: path || '', icon: _tabIcon(openType) });
  _activeTabId = id;
  renderTabs();
  // コンテンツを開く
  _addingTab = true;
  try {
    return navOpen({ type: openType, label, path });
  } finally {
    _addingTab = false;
  }
}

// タブバーへのフォルダツリーD&Dドロップ
(function() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.addEventListener('dragover', (e) => {
    // Meldexノードまたはタブ移動のみ受け入れ
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
    // ドロップ位置のインジケーター表示
    _clearTabDragIndicators();
    const tabEls = [...bar.querySelectorAll('.tab-item')];
    for (const tabEl of tabEls) {
      const rect = tabEl.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width / 2) {
        tabEl.classList.add('drag-over-left');
        return;
      } else if (e.clientX < rect.right) {
        tabEl.classList.add('drag-over-right');
        return;
      }
    }
    // 全タブの右側
    if (tabEls.length > 0) tabEls[tabEls.length - 1].classList.add('drag-over-right');
  });
  bar.addEventListener('dragleave', (e) => {
    if (!bar.contains(e.relatedTarget)) _clearTabDragIndicators();
  });
  bar.addEventListener('drop', (e) => {
    e.preventDefault();
    _clearTabDragIndicators();
    const draggedTabIndex = e.dataTransfer.getData('application/x-tab-idx');
    if (draggedTabIndex) {
      if (e.target.closest?.('.tab-item')) return;
      const fromIdx = parseInt(draggedTabIndex);
      if (isNaN(fromIdx) || fromIdx < 0 || fromIdx >= _tabs.length || fromIdx === _tabs.length - 1) return;
      const moved = _tabs.splice(fromIdx, 1)[0];
      _tabs.push(moved);
      renderTabs();
      return;
    }
    // Meldexノードのドロップ
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (!cfData) return;
    try {
      const { name, path, type } = JSON.parse(cfData);
      const openType = _normalizeOpenTypeForNav(type);
      // 挿入位置を決定
      const tabEls = [...bar.querySelectorAll('.tab-item')];
      let insertIdx = _tabs.length;
      for (let i = 0; i < tabEls.length; i++) {
        const rect = tabEls[i].getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) { insertIdx = i; break; }
      }
      const id = 'tab-' + (++_tabIdCounter);
      const newTab = { id, label: name || '(無題)', type: openType, path: path || '', icon: _tabIcon(openType) };
      _tabs.splice(insertIdx, 0, newTab);
      _activeTabId = id;
      renderTabs();
      _addingTab = true;
      try {
        navOpen({ type: openType, label: name, path });
      } finally {
        _addingTab = false;
      }
    } catch {}
  });
})();

// タブ右クリックメニュー（＋長押しでも同メニュー）
function _handleTabBarContextmenu(e) {
  const tabEl = e.target.closest('.tab-item');
  if (!tabEl) return;
  e.preventDefault();
  const idx = parseInt(tabEl.dataset.tabIdx);
  const tab = _tabs[idx];
  if (!tab) return;

  document.querySelectorAll('.tab-context-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu tab-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'タブ操作');
  if (!tabEl.hasAttribute('tabindex')) tabEl.tabIndex = -1;
  let menuClosed = false;
  let closeOnPointer = null;
  let closeOnKey = null;
  function closeMenu(restoreFocus = false) {
    if (menuClosed) return;
    menuClosed = true;
    document.removeEventListener('pointerdown', closeOnPointer, true);
    document.removeEventListener('keydown', closeOnKey, true);
    menu.remove();
    if (restoreFocus && typeof tabEl.focus === 'function') {
      try { tabEl.focus({ preventScroll: true }); } catch { tabEl.focus(); }
    }
  }
  { const z = _getZoom(); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
  function addMI(label, fn, disabled = false, e2eId = '') {
    const mi = document.createElement('button');
    mi.type = 'button';
    mi.className = 'gb-context-menu-item';
    mi.setAttribute('role', 'menuitem');
    mi.textContent = label;
    mi.disabled = !!disabled;
    if (disabled) mi.setAttribute('aria-disabled', 'true');
    if (e2eId) mi.dataset.e2eId = e2eId;
    mi.addEventListener('click', () => { closeMenu(false); fn(); });
    menu.appendChild(mi);
  }
  function closeTabsOnSide(side) {
    const targetIndex = _tabs.findIndex(item => item.id === tab.id);
    if (targetIndex < 0) return;
    const shouldClose = (_, index) => side === 'left' ? index < targetIndex : index > targetIndex;
    const activeWillClose = _tabs.some((item, index) => item.id === _activeTabId && shouldClose(item, index));
    const remaining = _tabs.filter((item, index) => !shouldClose(item, index));
    if (remaining.length === _tabs.length) return;
    _tabs.splice(0, _tabs.length, ...remaining);
    activateTab(activeWillClose ? tab.id : (_activeTabId || tab.id));
  }
  addMI('新しいウィンドウで開く', () => {
    const openType = _normalizeOpenTypeForNav(tab.type);
    const url = '/?open=' + encodeURIComponent(openType) + '&path=' + encodeURIComponent(tab.path || '') + '&label=' + encodeURIComponent(tab.label || '');
    Promise.resolve(_open_app_window_js(url)).then((ok) => {
      if (ok) closeTab(tab.id);
      else if (typeof showStatus === 'function') showStatus('新しいウィンドウを開けませんでした', true);
    });
  }, false, 'tab-menu-new-window');

/* === gb-app.part02.js === */
  addMI('タブを閉じる', () => closeTab(tab.id), false, 'tab-menu-close');
  addMI('左のタブを閉じる', () => closeTabsOnSide('left'), idx <= 0, 'tab-menu-close-left');
  addMI('右のタブを閉じる', () => closeTabsOnSide('right'), idx >= _tabs.length - 1, 'tab-menu-close-right');
  addMI('他のタブをすべて閉じる', () => {
    _tabs.splice(0, _tabs.length, tab);
    activateTab(tab.id);
  }, false, 'tab-menu-close-others');
  document.body.appendChild(menu);
  clampPopupToViewport(menu);
  const focusableItems = () => [...menu.querySelectorAll('.gb-context-menu-item')];
  closeOnPointer = function closeTabContextMenuOnPointer(ev) {
    if (!menu.contains(ev.target)) closeMenu(false);
  };
  closeOnKey = function closeTabContextMenuOnKey(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMenu(true);
      return;
    }
    const items = focusableItems();
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement));
    let nextIndex = currentIndex;
    if (ev.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    else if (ev.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (ev.key === 'Home') nextIndex = 0;
    else if (ev.key === 'End') nextIndex = items.length - 1;
    else return;
    ev.preventDefault();
    items[nextIndex]?.focus();
  };
  setTimeout(() => {
    if (menuClosed || !menu.isConnected) return;
    document.addEventListener('pointerdown', closeOnPointer, true);
    document.addEventListener('keydown', closeOnKey, true);
  }, 0);
  menu.querySelector('.gb-context-menu-item')?.focus();
}
{
  const _tabBar = document.getElementById('tab-bar');
  _tabBar?.addEventListener('contextmenu', _handleTabBarContextmenu);
  if (_tabBar && typeof addLongPressHandler === 'function') {
    addLongPressHandler(_tabBar, _handleTabBarContextmenu);
  }
}

// Chrome --appモードで新しいウィンドウを開く（JS版）
async function _open_app_window_js(url) {
  const resolvedUrl = new URL(url, location.origin).toString();
  try {
    const res = await fetch(API_BASE + '/open-app-window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: resolvedUrl }),
    });
    if (res.ok) return true;
  } catch {}
  const opened = window.open(resolvedUrl, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
  return !!opened;
}

// 既存のopen関数をフックしてタブを追加（再帰防止付き）
let _addingTab = false;
const _origNavPush = navPush;
navPush = function(entry, paneId) {
  _origNavPush(entry, paneId);
  if (_addingTab || navNavigating) return; // activateTab→navOpen→openX→navPush の再帰を防止
  if (entry && entry.type) {
    const label = entry.label || entry.path?.split('/').pop() || '(無題)';
    if (entry.type === 'welcome') return;
    _addingTab = true;
    try {
      // タブを追加（既存ならアクティブ化のみ、navOpenは呼ばない）
      const path = entry.path || entry.dbPath || '';
      const type = typeof _normalizeOpenTypeForNav === 'function' ? _normalizeOpenTypeForNav(entry.type) : entry.type;
      const existing = _tabs.find(t => t.path === path && t.type === type);
      if (existing) {
        _activeTabId = existing.id;
        renderTabs();
      } else {
        // 現在のアクティブタブを上書き（新しいタブを追加しない）
        const activeTab = _tabs.find(t => t.id === _activeTabId);
        if (activeTab) {
          activeTab.label = label || '(無題)';
          activeTab.type = type;
          activeTab.path = path;
          activeTab.icon = _tabIcon(type);
          renderTabs();
        } else {
          const id = 'tab-' + (++_tabIdCounter);
          _tabs.push({ id, label: label || '(無題)', type, path, icon: _tabIcon(type) });
          _activeTabId = id;
          renderTabs();
        }
      }
    } finally {
      _addingTab = false;
    }
  }
};

// 履歴再生では navPush() が navNavigating により記録を抑止するため、同じタブの
// 表示先は履歴エントリから先に確定する。これにより、読み込み側の非同期処理や
// ペインブリッジ初期化状態に左右されず、戻る/進むが別タブを汚さない。
function _applyNavEntryToBoundTab(navState, entry) {
  if (navState?.kind !== 'tab' || !navState.paneId || !navState.tabId || !entry) return;
  if (typeof GBLayout === 'undefined') return;
  const pane = GBLayout.findNode?.(GBLayout.root, navState.paneId)?.node;
  const tab = pane?.tabs?.find(candidate => candidate.id === navState.tabId);
  if (!tab) return;
  const nextType = typeof _normalizeOpenTypeForNav === 'function'
    ? _normalizeOpenTypeForNav(entry.type)
    : entry.type;
  const typeChanged = tab.type !== nextType;
  if (typeChanged && typeof removeComponentInstance === 'function') {
    removeComponentInstance(tab.id);
  }
  tab.type = nextType;
  tab.label = entry.label || entry.path?.split('/').pop() || '(無題)';
  tab.path = entry.path || entry.dbPath || '';
  tab.icon = typeof GBTabs !== 'undefined' && typeof GBTabs.tabIcon === 'function'
    ? GBTabs.tabIcon(nextType)
    : tab.icon;
  tab.state = {
    ...(typeChanged ? {} : (tab.state || {})),
    ...(entry.mediaType ? { mediaType: entry.mediaType } : {}),
    ...(entry.viewerUrl ? { viewerUrl: entry.viewerUrl } : {}),
  };
  if (typeChanged) GBLayout.render();
  else {
    const labelEl = GBLayout.paneMap?.[navState.paneId]?.el?.querySelector('.gb-tab.active .gb-tab-label');
    if (labelEl) labelEl.textContent = tab.label;
  }
}

// ナビゲーション履歴の戻る/進む
function navBack(paneId) {
  const navState = _getNavState(paneId);
  if (navState.index <= 0) return false;
  navState.index -= 1;
  const entry = navState.history[navState.index];
  if (!entry) return false;
  navNavigating = true;
  try {
    if (navState.paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(navState.paneId, { sync: true });
    _applyNavEntryToBoundTab(navState, entry);
    _withNavFlag(navOpen(entry));
  } catch (e) {
    navNavigating = false;
    throw e;
  }
  if (navState.kind === 'legacy') {
    const tab = _tabs.find(t => t.path === entry.path && t.type === entry.type);
    if (tab) { _activeTabId = tab.id; renderTabs(); }
  }
  _refreshPaneNavUi(navState.paneId);
  _persistPaneNavState(navState);
  return true;
}
function navForward(paneId) {
  const navState = _getNavState(paneId);
  if (navState.index < 0 || navState.index >= navState.history.length - 1) return false;
  navState.index += 1;
  const entry = navState.history[navState.index];
  if (!entry) return false;
  navNavigating = true;
  try {
    if (navState.paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(navState.paneId, { sync: true });
    _applyNavEntryToBoundTab(navState, entry);
    _withNavFlag(navOpen(entry));
  } catch (e) {
    navNavigating = false;
    throw e;
  }
  if (navState.kind === 'legacy') {
    const tab = _tabs.find(t => t.path === entry.path && t.type === entry.type);
    if (tab) { _activeTabId = tab.id; renderTabs(); }
  }
  _refreshPaneNavUi(navState.paneId);
  _persistPaneNavState(navState);
  return true;
}

function showPaneNavHistoryDropdown(e, paneId, direction) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.nav-history-dropdown').forEach(el => el.remove());
  const navState = _getNavState(paneId);
  const items = [];
  if (direction === 'back') {
