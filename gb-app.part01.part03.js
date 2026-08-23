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
