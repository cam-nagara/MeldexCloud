    };
  }
  const pane = GBLayout.findNode?.(GBLayout.root, resolvedPaneId)?.node || null;
  if (!pane) {
    return {
      kind: 'legacy',
      paneId: null,
      history: _legacyNavHistory,
      get index() { return _legacyNavIndex; },
      set index(v) { _legacyNavIndex = v; },
    };
  }
  if (!Array.isArray(pane.navHistory)) pane.navHistory = [];
  if (!Number.isInteger(pane.navIndex)) pane.navIndex = pane.navHistory.length ? pane.navHistory.length - 1 : -1;
  if (pane.navIndex >= pane.navHistory.length) pane.navIndex = pane.navHistory.length - 1;
  return {
    kind: 'pane',
    paneId: resolvedPaneId,
    history: pane.navHistory,
    get index() { return pane.navIndex; },
    set index(v) { pane.navIndex = v; },
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
  if (navState?.kind === 'pane' && typeof GBLayout !== 'undefined' && typeof GBLayout.saveLayout === 'function') {
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
  const selectors = {
    pivot: '.pivot-view',
    gallery: '.gallery-view',
    kanban: '.kanban-view',
    timeline: '.timeline-view',
    chart: '.chart-view',
    graph: '.graph-view',
    form: '.form-view',
  };
  const selector = selectors[mode] || '.pivot-view';
  return (typeof _paneEl === 'function' ? _paneEl(ctx, selector) : null) || document.querySelector(selector);
}

function _navPushWithViewState(ctx, entityName) {
  ctx = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const dbPath = ctx?.dbPath || state.currentDbPath;
  if (!dbPath) return;
  const cfg = getDbViewConfig(dbPath);
  const viewMode = getCurrentViewMode(dbPath, { ctx });
  const container = _getDbViewScrollContainer(ctx, viewMode);
  _forcedNavPush({
    type: 'pivot',
    path: dbPath,
    label: dbPath.split('/').pop() || dbPath,
    viewIdx: Number.isInteger(ctx?.currentViewIdx) ? ctx.currentViewIdx : cfg.currentViewIdx,
    scrollState: {
      scrollLeft: container?.scrollLeft || 0,
      scrollTop: container?.scrollTop || 0,
      focusedEntity: entityName || null,
    },
  }, ctx?.paneId);
}

function navOpen(entry, opts) {
  if (!entry) return;
  const o = opts || undefined;
  if (entry.type === 'page') return openPage(entry.label, entry.path, o);
  if (entry.type === 'csv') return (typeof openCsvFile === 'function') ? openCsvFile(entry.label, entry.path, o) : openPage(entry.label, entry.path, o);
  if (entry.type === 'board') return openBoard(entry.label, entry.path, o);
  if (entry.type === 'entity') return selectEntity(entry.path, o);
  if (entry.type === 'pivot' || entry.type === 'database' || ['gallery', 'kanban', 'timeline', 'chart', 'graph'].includes(entry.type)) {
    if (entry.calendarFile && entry.type === 'timeline' && typeof openCalendarFile === 'function') return openCalendarFile(entry.label, entry.path, o);
    return selectDatabase(entry.path, null, {
      ...(o || {}),
      restoreViewIdx: entry.viewIdx,
      restoreScrollState: entry.scrollState,
    });
  }
  if (entry.type === 'scriptnote' && typeof openScenarioInScriptNote === 'function') return openScenarioInScriptNote(entry.path, entry.label, o);
  if (entry.type === 'media' || entry.type === 'image' || entry.type === 'video' || entry.type === 'audio') return openMedia(entry.label, entry.path, entry.mediaType || (entry.type === 'media' ? 'image' : entry.type), o);
  if (entry.type === 'html') {
    if (entry.urlExternal && typeof openViewer === 'function') return openViewer(entry.path);
    return openHtmlFile(entry.label, entry.path, o);
  }
  if (entry.type === 'folder') return openFolder(entry.label, entry.path, o);
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
  const icons = {pivot:'db',gallery:'db',kanban:'db',timeline:'db',media:'galleryThumbnails',html:'globe'};
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

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  { const z = _getZoom(); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
  function addMI(label, fn) {
    const mi = document.createElement('div');
    mi.textContent = label;
    mi.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
    mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; };
    mi.onmouseleave = () => { mi.style.background = ''; };
    mi.addEventListener('click', () => { menu.remove(); fn(); });
    menu.appendChild(mi);
  }
  addMI('新しいウィンドウで開く', () => {
    const openType = _normalizeOpenTypeForNav(tab.type);
    const url = '/?open=' + encodeURIComponent(openType) + '&path=' + encodeURIComponent(tab.path || '') + '&label=' + encodeURIComponent(tab.label || '');
    Promise.resolve(_open_app_window_js(url)).then((ok) => {
      if (ok) closeTab(tab.id);
      else if (typeof showStatus === 'function') showStatus('新しいウィンドウを開けませんでした', true);
    });
  });

/* === gb-app.part02.js === */
  addMI('タブを閉じる', () => closeTab(tab.id));
  addMI('他のタブをすべて閉じる', () => {
    _tabs.splice(0, _tabs.length, tab);
    activateTab(tab.id);
  });
  document.body.appendChild(menu);
  clampPopupToViewport(menu);
  setTimeout(() => {
    document.addEventListener('pointerdown', function cl(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', cl); } });
  }, 0);
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

// ナビゲーション履歴の戻る/進む
function navBack(paneId) {
  const navState = _getNavState(paneId);
  if (navState.index <= 0) return false;
  navState.index -= 1;
  const entry = navState.history[navState.index];
  if (!entry) return false;
  if (navState.paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(navState.paneId, { sync: true });
  navNavigating = true;
  _withNavFlag(navOpen(entry));
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
  if (navState.paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(navState.paneId, { sync: true });
  navNavigating = true;
  _withNavFlag(navOpen(entry));
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
    for (let i = navState.index - 1; i >= Math.max(0, navState.index - 15); i--) items.push({ index: i, entry: navState.history[i] });
  } else {
    for (let i = navState.index + 1; i <= Math.min(navState.history.length - 1, navState.index + 15); i++) items.push({ index: i, entry: navState.history[i] });
  }
  if (items.length === 0) return;

  const dd = document.createElement('div');
  dd.className = 'ab-dropdown nav-history-dropdown';
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:220px;max-width:360px;max-height:400px;overflow-y:auto;';
  items.forEach(({ index, entry }) => {
    const item = document.createElement('div');
    item.className = 'ab-dropdown-item';
    item.textContent = entry.label || entry.path?.split('/').pop() || '(不明)';
    item.title = entry.path || '';
    item.addEventListener('click', () => {
      navState.index = index;
      if (navState.paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(navState.paneId, { sync: true });
      navNavigating = true;
      _withNavFlag(navOpen(entry));
      _refreshPaneNavUi(navState.paneId);
      _persistPaneNavState(navState);
      dd.remove();
    });
    dd.appendChild(item);
  });
  const anchor = e.currentTarget || e.target?.closest?.('button') || e.target;
  const rect = anchor.getBoundingClientRect();
  { const z = _getZoom(); dd.style.left = (rect.left / z) + 'px'; dd.style.top = (rect.bottom / z + 2) + 'px'; }
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  setTimeout(() => {
    const close = (ev) => { if (!dd.contains(ev.target)) { dd.remove(); document.removeEventListener('pointerdown', close, true); } };
    document.addEventListener('pointerdown', close, true);
  }, 0);
}

function showNavHistoryDropdown(e, direction) {
  return showPaneNavHistoryDropdown(e, null, direction);
}

function updateNavBreadcrumb() {}

let _pointerNavPaneId = null;

function _handlePointerNavigationButtons(e) {
  if (e.button !== 3 && e.button !== 4) return;
  const ae = document.activeElement;
  if (ae && (ae.contentEditable === 'true' || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
  const paneId = _pointerNavPaneId || e.target?.closest?.('.gb-pane')?.dataset?.paneId || undefined;
  _pointerNavPaneId = null;
  if (e.button === 3) {
    if (navBack(paneId)) e.preventDefault();
  } else if (e.button === 4) {
    if (navForward(paneId)) e.preventDefault();
  }
}

window.addEventListener('mousedown', (e) => {
  if (e.button === 3 || e.button === 4) {
    _pointerNavPaneId = e.target?.closest?.('.gb-pane')?.dataset?.paneId || null;
    e.preventDefault();
  }
}, true);
window.addEventListener('mouseup', _handlePointerNavigationButtons, true);
window.addEventListener('pointercancel', () => { _pointerNavPaneId = null; }, true);

// DB表示設定（シートメタデータを正、localStorageを即時キャッシュとして使う）
const _dbViewConfigBackendSaveTimers = new Map();

function getDbViewConfigStorageKey(dbPath) {
  const fileId = _pathToFileId(dbPath);
  return 'dbViewConfig:' + (fileId || dbPath || '');
}
function _isDbViewPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function _cloneDbViewValue(value, fallback) {
  if (value == null) return fallback;
  try {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  } catch {
    try { return JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }
}
function _cloneDbViewArray(value) {
  return Array.isArray(value) ? _cloneDbViewValue(value, []) : [];
}
function _cloneDbViewObject(value) {
  return _isDbViewPlainObject(value) ? _cloneDbViewValue(value, {}) : {};
}
function _hasDbViewArrayState(value) {
  return Array.isArray(value) && value.length > 0;
}
function _hasDbViewObjectState(value) {
  return _isDbViewPlainObject(value) && Object.keys(value).length > 0;
}
function _normalizeDbViewModeValue(mode) {
  const value = String(mode || '').trim();
  return ['pivot', 'gallery', 'kanban', 'calendar', 'timeline', 'chart', 'graph', 'form'].includes(value)
    ? value
    : 'pivot';
}
function _normalizeDbTimelineTypeSpecific(timeline) {
  const src = _cloneDbViewObject(timeline);
  const out = {
    timeProp: String(src.timeProp || ''),
    endProp: String(src.endProp || ''),
    rowProp: String(src.rowProp || '_entity'),
    scale: String(src.scale || 'day'),
    direction: String(src.direction || 'horizontal'),
    displayStart: String(src.displayStart || ''),
    displayEnd: String(src.displayEnd || ''),
    timeStepMinutes: Math.max(1, Math.round(Number(src.timeStepMinutes || 1) || 1)),
    calendarSystemId: String(src.calendarSystemId || 'gregorian'),
    ...src,
  };
  out.colWidths = _cloneDbViewObject(src.colWidths);
  out.rowHeights = _cloneDbViewObject(src.rowHeights);
  out.cardProps = _cloneDbViewArray(src.cardProps);
  out.calendarSystems = _cloneDbViewArray(src.calendarSystems);
  out.displayStart = String(out.displayStart || '');
  out.displayEnd = String(out.displayEnd || '');
  out.timeStepMinutes = Math.max(1, Math.round(Number(out.timeStepMinutes || 1) || 1));
  out.calendarSystemId = String(out.calendarSystemId || 'gregorian');
  return out;
}
function _makeLegacyDbSavedView(cfg) {
  const viewMode = _normalizeDbViewModeValue(cfg.currentViewMode || 'pivot');
  return {
    name: typeof _defaultDbSavedViewName === 'function' ? _defaultDbSavedViewName(viewMode, 0) : 'テーブル',
    viewMode,
    hiddenCols: _cloneDbViewArray(cfg.hiddenCols),
    pinnedCols: _cloneDbViewArray(cfg.pinnedCols),
    colOrder: cfg.colOrder == null ? null : _cloneDbViewValue(cfg.colOrder, null),
    advancedFilters: _cloneDbViewArray(cfg.advancedFilters),
    conditionalFormat: !!cfg.conditionalFormat,
    conditionalColors: _cloneDbViewObject(cfg.conditionalColors),
    filter: 'disabled',
    sortConfig: cfg.sortConfig == null ? null : _cloneDbViewValue(cfg.sortConfig, null),
    manualOrder: cfg.manualOrder == null ? null : _cloneDbViewValue(cfg.manualOrder, null),
    showFooter: !!cfg.showFooter,
    entityColumnPinned: cfg.entityColumnPinned !== false,
    countTypes: _cloneDbViewObject(cfg.countTypes),
    colWidths: _cloneDbViewObject(cfg.colWidths),
    thumbnailSize: cfg.thumbnailSize || 'small',
    typeSpecific: {
      pivot: { groupBy: cfg.groupBy || null },
      gallery: {},
      kanban: { groupBy: cfg.kanbanGroupBy || '_status' },
      calendar: { mapping: _cloneDbViewObject(cfg.calendarMapping) },
      timeline: _normalizeDbTimelineTypeSpecific(cfg.timeline),
      chart: _cloneDbViewObject(cfg.chartConfig),
      graph: _cloneDbViewObject(cfg.graphConfig),
      form: { formConfig: cfg.formConfig == null ? null : _cloneDbViewValue(cfg.formConfig, null) },
    },
  };
}
function _ensureDbViewTypeSpecific(view, cfg) {
  const current = _isDbViewPlainObject(view.typeSpecific) ? view.typeSpecific : {};
  view.typeSpecific = current;
  if (!_isDbViewPlainObject(current.pivot)) current.pivot = {};
  if (current.pivot.groupBy == null) current.pivot.groupBy = view.groupBy || cfg.groupBy || null;
  if (!_isDbViewPlainObject(current.gallery)) current.gallery = {};
  if (!_isDbViewPlainObject(current.kanban)) current.kanban = {};
  if (current.kanban.groupBy == null) current.kanban.groupBy = view.kanbanGroupBy || cfg.kanbanGroupBy || '_status';
  if (!_isDbViewPlainObject(current.calendar)) current.calendar = {};
  if (!_isDbViewPlainObject(current.calendar.mapping)) current.calendar.mapping = _cloneDbViewObject(cfg.calendarMapping);
  current.timeline = _normalizeDbTimelineTypeSpecific(current.timeline || cfg.timeline);
  if (!_isDbViewPlainObject(current.chart)) current.chart = _cloneDbViewObject(cfg.chartConfig);
  if (!_isDbViewPlainObject(current.graph)) current.graph = _cloneDbViewObject(cfg.graphConfig);
  if (!_isDbViewPlainObject(current.form)) current.form = {};
  if (current.form.formConfig == null) {
    current.form.formConfig = view.formConfig != null
      ? _cloneDbViewValue(view.formConfig, null)
      : (cfg.formConfig != null ? _cloneDbViewValue(cfg.formConfig, null) : null);
  }
}
function _normalizeSavedDbViewForV2(view, cfg, index) {
  const v = _isDbViewPlainObject(view) ? view : {};
  v.viewMode = _normalizeDbViewModeValue(v.viewMode || cfg.currentViewMode || 'pivot');
  if (!String(v.name || '').trim()) {
    v.name = typeof _defaultDbSavedViewName === 'function'
      ? _defaultDbSavedViewName(v.viewMode, index)
      : (index === 0 ? 'テーブル' : 'テーブル ' + (index + 1));
  }
  if (v.hiddenCols == null) v.hiddenCols = _cloneDbViewArray(cfg.hiddenCols);
  else v.hiddenCols = _cloneDbViewArray(v.hiddenCols);
  if (v.pinnedCols == null) v.pinnedCols = _cloneDbViewArray(cfg.pinnedCols);
  else v.pinnedCols = _cloneDbViewArray(v.pinnedCols);
  if (v.colOrder == null) v.colOrder = cfg.colOrder == null ? null : _cloneDbViewValue(cfg.colOrder, null);
  else v.colOrder = _cloneDbViewValue(v.colOrder, null);
  if (v.advancedFilters == null) v.advancedFilters = _cloneDbViewArray(cfg.advancedFilters);
  else v.advancedFilters = _cloneDbViewArray(v.advancedFilters);
  if (v.conditionalFormat == null) v.conditionalFormat = !!cfg.conditionalFormat;
  else v.conditionalFormat = !!v.conditionalFormat;
  if (v.conditionalColors == null) v.conditionalColors = _cloneDbViewObject(cfg.conditionalColors);
  else v.conditionalColors = _cloneDbViewObject(v.conditionalColors);
  if (v.filter == null) v.filter = 'disabled';
  if (v.sortConfig == null) v.sortConfig = cfg.sortConfig == null ? null : _cloneDbViewValue(cfg.sortConfig, null);
  else v.sortConfig = _cloneDbViewValue(v.sortConfig, null);
  if (v.manualOrder == null) v.manualOrder = cfg.manualOrder == null ? null : _cloneDbViewValue(cfg.manualOrder, null);
  else v.manualOrder = _cloneDbViewValue(v.manualOrder, null);
  if (v.showFooter == null) v.showFooter = !!cfg.showFooter;
  else v.showFooter = !!v.showFooter;
  if (v.entityColumnPinned == null) v.entityColumnPinned = cfg.entityColumnPinned !== false;
  else v.entityColumnPinned = v.entityColumnPinned !== false;
  if (v.countTypes == null) v.countTypes = _cloneDbViewObject(cfg.countTypes);
  else v.countTypes = _cloneDbViewObject(v.countTypes);
  if (v.colWidths == null) v.colWidths = _cloneDbViewObject(cfg.colWidths);
  else v.colWidths = _cloneDbViewObject(v.colWidths);
  if (v.thumbnailSize == null) v.thumbnailSize = cfg.thumbnailSize || 'small';
  _ensureDbViewTypeSpecific(v, cfg);
  return v;
}
function _hasLegacyDbViewState(cfg) {
  return _hasDbViewArrayState(cfg.hiddenCols)
    || _hasDbViewArrayState(cfg.pinnedCols)
    || _hasDbViewArrayState(cfg.colOrder)
    || _hasDbViewArrayState(cfg.advancedFilters)
    || _hasDbViewObjectState(cfg.conditionalColors)
    || _hasDbViewObjectState(cfg.countTypes)
    || _hasDbViewObjectState(cfg.colWidths)
    || !!cfg.conditionalFormat
    || !!cfg.groupBy
    || !!cfg.kanbanGroupBy
    || !!cfg.chartConfig
    || !!cfg.graphConfig
    || !!cfg.timeline
    || !!cfg.formConfig
    || !!cfg.calendarMapping
    || !!cfg.sortConfig
    || !!cfg.manualOrder
    || cfg.showFooter === true
    || cfg.entityColumnPinned === false
    || (cfg.thumbnailSize && cfg.thumbnailSize !== 'small')
    || (cfg.currentViewMode && cfg.currentViewMode !== 'pivot');
}
function _hasDbViewMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (_isDbViewPlainObject(value)) return Object.values(value).some(_hasDbViewMeaningfulValue);
  return value !== null && value !== undefined && value !== '' && value !== false;
}
function _hasMeaningfulDbTimelineState(timeline) {
  if (!_isDbViewPlainObject(timeline)) return false;
  if (String(timeline.timeProp || '')) return true;
  if (String(timeline.endProp || '')) return true;
  if (String(timeline.rowProp || '_entity') !== '_entity') return true;
  if (String(timeline.scale || 'day') !== 'day') return true;
  if (String(timeline.direction || 'horizontal') !== 'horizontal') return true;
  if (String(timeline.displayStart || '')) return true;
  if (String(timeline.displayEnd || '')) return true;
  if (Math.max(1, Math.round(Number(timeline.timeStepMinutes || 1) || 1)) !== 1) return true;
  if (String(timeline.calendarSystemId || 'gregorian') !== 'gregorian') return true;
  if (_hasDbViewObjectState(timeline.colWidths)) return true;
  if (_hasDbViewObjectState(timeline.rowHeights)) return true;
  if (_hasDbViewArrayState(timeline.cardProps)) return true;
  if (_hasDbViewArrayState(timeline.calendarSystems)) return true;
  const defaults = new Set([
    'timeProp', 'endProp', 'rowProp', 'scale', 'direction', 'displayStart', 'displayEnd',
    'timeStepMinutes', 'calendarSystemId', 'colWidths', 'rowHeights', 'cardProps', 'calendarSystems',
  ]);
  return Object.keys(timeline).some((key) => !defaults.has(key) && _hasDbViewMeaningfulValue(timeline[key]));
}
function _hasMeaningfulDbSavedViewState(view, index) {
  if (!_isDbViewPlainObject(view)) return false;
  const viewMode = _normalizeDbViewModeValue(view.viewMode || 'pivot');
  if (viewMode !== 'pivot') return true;
  const defaultName = typeof _defaultDbSavedViewName === 'function'
    ? _defaultDbSavedViewName(viewMode, index)
    : (index === 0 ? 'テーブル' : 'テーブル ' + (index + 1));
  const name = String(view.name || '').trim();
  if (name && name !== defaultName) return true;
  if (_hasDbViewArrayState(view.hiddenCols) || _hasDbViewArrayState(view.pinnedCols)) return true;
  if (_hasDbViewArrayState(view.colOrder) || _hasDbViewObjectState(view.colOrder)) return true;
  if (_hasDbViewArrayState(view.advancedFilters)) return true;
  if (view.conditionalFormat === true || _hasDbViewObjectState(view.conditionalColors)) return true;
  if (view.filter && view.filter !== 'disabled') return true;
  if (_hasDbViewMeaningfulValue(view.sortConfig) || _hasDbViewMeaningfulValue(view.manualOrder)) return true;
  if (view.showFooter === true || view.entityColumnPinned === false) return true;
  if (_hasDbViewObjectState(view.countTypes) || _hasDbViewObjectState(view.colWidths)) return true;
  if (view.thumbnailSize && view.thumbnailSize !== 'small') return true;
  const typeSpecific = _isDbViewPlainObject(view.typeSpecific) ? view.typeSpecific : {};
  if (typeSpecific.pivot?.groupBy) return true;
  if (typeSpecific.kanban?.groupBy && typeSpecific.kanban.groupBy !== '_status') return true;
  if (_hasDbViewObjectState(typeSpecific.calendar?.mapping)) return true;
  if (_hasMeaningfulDbTimelineState(typeSpecific.timeline)) return true;
  if (_hasDbViewObjectState(typeSpecific.chart) || _hasDbViewObjectState(typeSpecific.graph)) return true;
  return typeSpecific.form?.formConfig != null;
}
function _hasMeaningfulDbViewConfigState(cfg) {
  if (!_isDbViewPlainObject(cfg)) return false;
  if (_hasDbViewArrayState(cfg.deletedProps)) return true;
  if (_hasLegacyDbViewState(cfg)) return true;
  const views = Array.isArray(cfg.savedViews) ? cfg.savedViews : [];
  if (views.length > 1) return true;
  if (Number.isInteger(cfg.currentViewIdx) && cfg.currentViewIdx > 0) return true;
  return views.some((view, index) => _hasMeaningfulDbSavedViewState(view, index));
}
function _migrateLegacyViewConfig(dbPath, cfg) {
  const config = _isDbViewPlainObject(cfg) ? cfg : {};
  if (!dbPath) return { cfg: config, changed: false };
  if (config._viewMigrationV2Done === true) {
    if (!Array.isArray(config.savedViews)) config.savedViews = [];
    if (config.savedViews.length > 0
      && (!Number.isInteger(config.currentViewIdx)
        || config.currentViewIdx < 0
        || config.currentViewIdx >= config.savedViews.length)) {
      config.currentViewIdx = 0;
      return { cfg: config, changed: true };
    }
    return { cfg: config, changed: false };
  }

  const legacyView = _makeLegacyDbSavedView(config);
  const existingViews = Array.isArray(config.savedViews) ? config.savedViews : [];
  config.savedViews = existingViews.map((view, index) => _normalizeSavedDbViewForV2(view, config, index));
  if (config.savedViews.length === 0) {
    config.savedViews.push(legacyView);
    config.currentViewIdx = 0;
  } else {
    if (_hasLegacyDbViewState(config) && config.currentViewIdx === -1) {
      config.savedViews.unshift(legacyView);
      config.currentViewIdx = 0;
    } else if (config.currentViewIdx === -1 || config.currentViewIdx == null) {
      config.currentViewIdx = 0;
    }
    if (config.currentViewIdx < 0 || config.currentViewIdx >= config.savedViews.length) {
      config.currentViewIdx = 0;
    }
  }
  config._viewMigrationV2Done = true;
  return { cfg: config, changed: true };
}
function _persistMigratedDbViewConfig(dbPath, cfg) {
  try { localStorage.setItem(getDbViewConfigStorageKey(dbPath), JSON.stringify(cfg || {})); } catch {}
}
function _sanitizeDbViewConfigForBackend(cfg) {
  const cleaned = _cloneDbViewObject(cfg);
  // プロパティ型は property_types として別保存される。重複保存すると新旧形式がずれやすい。
  if (Object.prototype.hasOwnProperty.call(cleaned, 'propertyTypes')) delete cleaned.propertyTypes;
  return cleaned;
}
function _hasLocalDbViewConfigCache(dbPath) {
  const fileId = _pathToFileId(dbPath);
  const keys = [];
  if (fileId) keys.push('dbViewConfig:' + fileId);
  keys.push('dbViewConfig:' + (dbPath || ''));
  return [...new Set(keys)].some((key) => {
    try {
      const value = localStorage.getItem(key);
      if (value == null || String(value).trim() === '') return false;
      return _hasMeaningfulDbViewConfigState(JSON.parse(value));
    } catch {
      return false;
    }
  });
}
function _persistDbViewConfigToBackend(dbPath, cfg, options = {}) {
  if (!dbPath || typeof apiPut !== 'function') return Promise.resolve(false);
  const payload = _sanitizeDbViewConfigForBackend(cfg);
  const key = String(dbPath || '');
  const run = () => apiPut('/db-metadata?path=' + encodeURIComponent(dbPath), { view_config: payload })
    .then(() => true)
    .catch((error) => {
      console.warn('[Meldex] シート表示設定を保存できませんでした', error);
      return false;
    });
  if (_dbViewConfigBackendSaveTimers.has(key)) {
    clearTimeout(_dbViewConfigBackendSaveTimers.get(key));
    _dbViewConfigBackendSaveTimers.delete(key);
  }
  if (options.immediate === true) return run();
  const timer = setTimeout(() => {
    _dbViewConfigBackendSaveTimers.delete(key);
    run();
  }, 180);
  _dbViewConfigBackendSaveTimers.set(key, timer);
  return Promise.resolve(true);
}
function _hasPendingDbViewConfigBackendSave(dbPath) {
  return _dbViewConfigBackendSaveTimers.has(String(dbPath || ''));
}
function getDbViewConfig(dbPath) {
  const fileId = _pathToFileId(dbPath);
  let cfg = {};
  if (fileId) {
    try { const v = localStorage.getItem('dbViewConfig:' + fileId); if (v) cfg = JSON.parse(v) || {}; } catch { cfg = {}; }
  }
  if (!fileId || Object.keys(cfg).length === 0) {
    try {
      const v = localStorage.getItem('dbViewConfig:' + (dbPath || ''));
      if (v) cfg = JSON.parse(v) || {};
    } catch {}
  }
  const migrated = _migrateLegacyViewConfig(dbPath, cfg);
  if (migrated.changed) _persistMigratedDbViewConfig(dbPath, migrated.cfg);
  return migrated.cfg;
}
function _dbViewConfigHistoryScope(dbPath) {
  const fileId = _pathToFileId(dbPath);
