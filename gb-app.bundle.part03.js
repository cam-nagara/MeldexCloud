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
  if (navState?.kind !== 'tab' || !navState.paneId || !navState.tabId || !entry) return true;
  if (typeof GBLayout === 'undefined') return true;
  const pane = GBLayout.findNode?.(GBLayout.root, navState.paneId)?.node;
  const tab = pane?.tabs?.find(candidate => candidate.id === navState.tabId);
  if (!tab) return true;
  const nextType = typeof _normalizeOpenTypeForNav === 'function'
    ? _normalizeOpenTypeForNav(entry.type)
    : entry.type;
  const typeChanged = tab.type !== nextType;
  const applyEntry = () => {
    tab.type = nextType;
    tab.label = entry.label || entry.path?.split('/').pop() || '(無題)';
    tab.path = entry.path || entry.dbPath || '';
    tab.icon = typeof GBTabs !== 'undefined' && typeof GBTabs.tabIcon === 'function'
      ? GBTabs.tabIcon(nextType)
      : tab.icon;
    tab.state = {
      ...(typeChanged ? {} : (tab.state || {})),
      ...(entry.viewMode ? { viewMode: entry.viewMode } : {}),
      ...(entry.mediaType ? { mediaType: entry.mediaType } : {}),
      ...(entry.viewerUrl ? { viewerUrl: entry.viewerUrl } : {}),
    };
    if (typeChanged) GBTabs.updateTab(navState.paneId, tab.id, {});
    else {
      const labelEl = GBLayout.paneMap?.[navState.paneId]?.el?.querySelector('.gb-tab.active .gb-tab-label');
      if (labelEl) labelEl.textContent = tab.label;
    }
    return true;
  };
  const formFileChanged = ['form-app', 'map'].includes(nextType) && tab.path !== (entry.path || entry.dbPath || '');
  if ((typeChanged || formFileChanged) && typeof removeComponentInstance === 'function') {
    const component = typeof getComponentInstance === 'function' ? getComponentInstance(tab.id) : null;
    if (component && typeof removeComponentInstanceSafely === 'function') {
      return removeComponentInstanceSafely(tab.id).then(ok => ok ? applyEntry() : false);
    }
    if (removeComponentInstance(tab.id) === false) return false;
  }
  return applyEntry();
}

function _finishPaneHistoryNavigation(navState, nextIndex, entry) {
  navState.index = nextIndex;
  navNavigating = true;
  if (navState.paneId && typeof GBLayout !== 'undefined') GBLayout.setActivePane(navState.paneId, { sync: true });
  _withNavFlag(navOpen(entry));
  if (navState.kind === 'legacy') {
    const tab = _tabs.find(t => t.path === entry.path && t.type === entry.type);
    if (tab) { _activeTabId = tab.id; renderTabs(); }
  }
  _refreshPaneNavUi(navState.paneId);
  _persistPaneNavState(navState);
  return true;
}

function _continuePaneHistoryAfterFlush(navState, nextIndex, entry, applied) {
  if (!applied || typeof applied.then !== 'function') {
    return applied === false ? false : _finishPaneHistoryNavigation(navState, nextIndex, entry);
  }
  navNavigating = true;
  applied.then((ok) => {
    if (!ok) {
      navNavigating = false;
      return;
    }
    _finishPaneHistoryNavigation(navState, nextIndex, entry);
  }).catch((error) => {
    navNavigating = false;
    if (typeof showStatus === 'function') showStatus('画面遷移前の保存に失敗しました: ' + (error?.message || error), true);
  });
  return true;
}

// サブパネル（右側の独立したパネル）はタブ履歴を自前で持つ。戻る/進むボタンと同じ履歴を使う。
// 対象がサブパネルでなければ null を返し、通常のパネル履歴へ進ませる。
function _subpanelNavDelegate(paneId, direction) {
  const id = paneId || (typeof GBLayout !== 'undefined' ? GBLayout.activePane : null);
  if (!id || typeof GBLayout === 'undefined' || typeof GBLayout.findNode !== 'function') return null;
  const node = GBLayout.findNode(GBLayout.root, id)?.node;
  if (node?.meldexRole !== 'subpanel-workspace') return null;
  const sub = window.GBSubPanel;
  if (!sub || typeof sub.navState !== 'function') return false;
  const state = sub.navState() || {};
  if (direction < 0) {
    if (!state.canBack) return false;
    sub.navBack?.();
  } else {
    if (!state.canForward) return false;
    sub.navForward?.();
  }
  return true;
}

// ナビゲーション履歴の戻る/進む
function navBack(paneId) {
  const subpanelResult = _subpanelNavDelegate(paneId, -1);
  if (subpanelResult !== null) return subpanelResult;
  const railState = typeof GBPanelSet !== 'undefined' && typeof GBPanelSet.rightRailNavigationState === 'function'
    ? GBPanelSet.rightRailNavigationState(paneId)
    : null;
  if (railState) return GBPanelSet.navigateRightRail(paneId, -1);
  const navState = _getNavState(paneId);
  if (navState.index <= 0) return false;
  if (typeof _captureDbNavigationBeforeLeave === 'function') _captureDbNavigationBeforeLeave(navState.paneId);
  const nextIndex = navState.index - 1;
  const entry = navState.history[nextIndex];
  if (!entry) return false;
  try {
    return _continuePaneHistoryAfterFlush(
      navState, nextIndex, entry, _applyNavEntryToBoundTab(navState, entry),
    );
  } catch (e) {
    navNavigating = false;
    throw e;
  }
}
function navForward(paneId) {
  const subpanelResult = _subpanelNavDelegate(paneId, 1);
  if (subpanelResult !== null) return subpanelResult;
  const railState = typeof GBPanelSet !== 'undefined' && typeof GBPanelSet.rightRailNavigationState === 'function'
    ? GBPanelSet.rightRailNavigationState(paneId)
    : null;
  if (railState) return GBPanelSet.navigateRightRail(paneId, 1);
  const navState = _getNavState(paneId);
  if (navState.index < 0 || navState.index >= navState.history.length - 1) return false;
  if (typeof _captureDbNavigationBeforeLeave === 'function') _captureDbNavigationBeforeLeave(navState.paneId);
  const nextIndex = navState.index + 1;
  const entry = navState.history[nextIndex];
  if (!entry) return false;
  try {
    return _continuePaneHistoryAfterFlush(
      navState, nextIndex, entry, _applyNavEntryToBoundTab(navState, entry),
    );
  } catch (e) {
    navNavigating = false;
    throw e;
  }
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
  dd.setAttribute('role', 'menu');
  dd.setAttribute('aria-label', direction === 'back' ? '戻る履歴' : '進む履歴');
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:220px;max-width:360px;max-height:400px;overflow-y:auto;';
  items.forEach(({ index, entry }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ab-dropdown-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = entry.label || entry.path?.split('/').pop() || '(不明)';
    item.title = entry.path || '';
    item.addEventListener('click', async () => {
      try {
        if (typeof _captureDbNavigationBeforeLeave === 'function') _captureDbNavigationBeforeLeave(navState.paneId);
        navNavigating = true;
        const applied = await _applyNavEntryToBoundTab(navState, entry);
        if (!applied) { navNavigating = false; return; }
        _finishPaneHistoryNavigation(navState, index, entry);
      } catch (e) {
        navNavigating = false;
        throw e;
      }
      _refreshPaneNavUi(navState.paneId);
      _persistPaneNavState(navState);
      closeDropdown(false);
    });
    dd.appendChild(item);
  });
  const anchor = e.currentTarget || e.target?.closest?.('button') || e.target;
  const rect = anchor.getBoundingClientRect();
  document.body.appendChild(dd);
  if (typeof positionPopup === 'function') positionPopup(dd, rect, { prefer: 'bottom', gap: 2 });
  else {
    const z = _getZoom();
    dd.style.left = (rect.left / z) + 'px';
    dd.style.top = (rect.bottom / z + 2) + 'px';
    clampPopupToViewport(dd);
  }
  const firstItem = dd.querySelector('.ab-dropdown-item');
  let dropdownClosed = false;
  function closeDropdown(restoreFocus) {
    if (dropdownClosed) return;
    dropdownClosed = true;
    dd.remove();
    document.removeEventListener('pointerdown', closeOnPointer, true);
    document.removeEventListener('keydown', closeOnKey, true);
    if (restoreFocus && anchor?.focus) anchor.focus();
  }
  function closeOnPointer(ev) {
    if (!dd.contains(ev.target)) closeDropdown(false);
  }
  function closeOnKey(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeDropdown(true);
      return;
    }
    const menuItems = [...dd.querySelectorAll('.ab-dropdown-item')];
    const current = menuItems.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' && menuItems.length) {
      ev.preventDefault();
      menuItems[(current + 1 + menuItems.length) % menuItems.length].focus();
    } else if (ev.key === 'ArrowUp' && menuItems.length) {
      ev.preventDefault();
      menuItems[(current - 1 + menuItems.length) % menuItems.length].focus();
    } else if (ev.key === 'Home' && menuItems.length) {
      ev.preventDefault();
      menuItems[0].focus();
    } else if (ev.key === 'End' && menuItems.length) {
      ev.preventDefault();
      menuItems[menuItems.length - 1].focus();
    }
  }
  setTimeout(() => {
    if (dropdownClosed || !dd.isConnected) return;
    document.addEventListener('pointerdown', closeOnPointer, true);
    document.addEventListener('keydown', closeOnKey, true);
  }, 0);
  firstItem?.focus();
}

function showNavHistoryDropdown(e, direction) {
  return showPaneNavHistoryDropdown(e, null, direction);
}

function updateNavBreadcrumb() {}

let _pointerNavTargetId = null;

function _subpanelWorkspacePaneId() {
  if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function') return null;
  return GBLayout.getAllPanes(GBLayout.root).find(pane => pane?.meldexRole === 'subpanel-workspace')?.id || null;
}

function _pointerNavigationTargetId(target) {
  const fixedRightDock = target?.closest?.('.gb-dock-fixed-right[data-panelset-id]');
  if (fixedRightDock?.dataset?.panelsetId) return fixedRightDock.dataset.panelsetId;
  // サブパネルの中身はパネルの枠の外に描かれることがあるため、先に判定する。
  if (target?.closest?.('#gb-subpanel-root')) {
    const subpanelPaneId = _subpanelWorkspacePaneId();
    if (subpanelPaneId) return subpanelPaneId;
  }
  return target?.closest?.('.gb-pane')?.dataset?.paneId || null;
}

// マウスの戻る(button 3)/進む(button 4)ボタン。押した場所のパネルのタブ履歴を動かす。
// ブラウザ既定の「ページ全体を戻る」は常に止める（止めないと Meldex 画面ごと遷移してしまう）。
function _pointerNavigate(paneId, direction) {
  return direction < 0 ? navBack(paneId || undefined) : navForward(paneId || undefined);
}

function _handlePointerNavigationButtons(e) {
  if (e.button !== 3 && e.button !== 4) return;
  e.preventDefault();
  const paneId = _pointerNavTargetId || _pointerNavigationTargetId(e.target) || undefined;
  _pointerNavTargetId = null;
  // 以前フォーカスしていた入力欄ではなく、実際にサイドボタンを押した場所で判定する。
  // 入力後に表や本文へマウスを移しても activeElement は入力欄のまま残るため、旧判定では
  // 戻る/進むが永続的に無効になっていた。入力要素そのものの上で押した時だけ保護する。
  const editableTarget = e.target?.closest?.('input, textarea, select, [contenteditable="true"]');
  if (editableTarget) return;
  _pointerNavigate(paneId, e.button === 3 ? -1 : 1);
}

// 同じ画面内に埋め込んだ別ページ（ビューワー等）から、マウスの戻る/進むを受け取る。
// 埋め込み先の枠が置かれたパネルのタブ履歴を動かす。
function meldexPointerNavigateFromFrame(frameWindow, direction) {
  let frameEl = null;
  try {
    frameEl = Array.from(document.querySelectorAll('iframe')).find(el => el.contentWindow === frameWindow) || null;
  } catch { frameEl = null; }
  const paneId = frameEl ? _pointerNavigationTargetId(frameEl) : null;
  return !!_pointerNavigate(paneId, direction < 0 ? -1 : 1);
}
window.meldexPointerNavigateFromFrame = meldexPointerNavigateFromFrame;

window.addEventListener('mousedown', (e) => {
  if (e.button === 3 || e.button === 4) {
    _pointerNavTargetId = _pointerNavigationTargetId(e.target);
    e.preventDefault();
  }
}, true);
window.addEventListener('mouseup', _handlePointerNavigationButtons, true);
window.addEventListener('auxclick', (e) => {
  if (e.button === 3 || e.button === 4) e.preventDefault();
}, true);
window.addEventListener('pointercancel', () => { _pointerNavTargetId = null; }, true);

// esc() は meldex-core.js で定義済み
function saveLastView(obj) {
  try {
    if (typeof _chatSetCurrentTargetFromView === 'function') _chatSetCurrentTargetFromView(obj, { reason: 'last-view', deferAdoptSource: true });
  } catch {}
  // 単一タブポップアウト窓では元ウィンドウの lastView を汚染しないよう常にスキップ
  if (window._skipLastViewSave || window._gbSingleWindow) return;
  // file_id を付与
  const filePath = obj?.path || obj?.dbPath || obj?.entityPath || '';
  if (obj && filePath && !obj.file_id) {
    const fid = _pathToFileId(filePath);
    if (fid) obj.file_id = fid;
  }
  localStorage.setItem('lastView', JSON.stringify(obj));
  rememberRailAppFile(obj);
}

function _isCloudPhase1UnsupportedOpenType(type) {
  return !!window.MeldexCloudBootstrap?.isPhase1UnsupportedType?.(type);
}

function _showCloudPhase1UnsupportedOpen(type) {
  if (window.MeldexCloudBootstrap?.showPhase1Unsupported) return window.MeldexCloudBootstrap.showPhase1Unsupported(type);
  showStatus('ブラウザ版Meldexではまだ未対応のビューです', true);
  return false;
}

function _pathTailLabel(path, fallback) {
  const raw = String(path || '').replace(/[\\/]+$/, '');
  if (!raw) return fallback || '';
  return raw.split(/[\\/]/).filter(Boolean).pop() || fallback || raw;
}

function _startupFolderCandidate(roots, homeRes, vault) {
  if (homeRes?.exists && homeRes.path) {
    try {
      if (typeof _homeFolderPath !== 'undefined') _homeFolderPath = homeRes.path;
    } catch (e) {}
    return { label: (typeof HOME_FOLDER_DISPLAY_LABEL !== 'undefined' ? HOME_FOLDER_DISPLAY_LABEL : 'ホームフォルダ'), path: homeRes.path };
  }
  const root = Array.isArray(roots)
    ? roots.find(r => r && r.path && r.visible !== false)
    : null;
  if (root) return { label: root.name || _pathTailLabel(root.path, 'フォルダ'), path: root.path };
  if (vault?.path) {
    return { label: vault.name || _pathTailLabel(vault.path, 'フォルダ'), path: vault.path };
  }
  return null;
}

function _isDesktopStartupLaunch() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('desktop') === '1' || document.documentElement?.dataset?.desktopLaunch === '1';
  } catch {
    return false;
  }
}

function _paneLayoutHasAnyTabs() {
  try {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function' || !GBLayout.root) return false;
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    return panes.some(p => Array.isArray(p?.tabs) && p.tabs.length > 0);
  } catch {
    return false;
  }
}

const STARTUP_LAYOUT_UTILITY_TAB_TYPES = new Set([
  'outliner',
  'detail',
  'preview',
  'chat',
  'calendar',
  'history',
  'annotation',
  'sticky',
  'search',
  'version',
]);

function _paneLayoutHasContentTabs() {
  try {
    if (typeof GBLayout === 'undefined' || typeof GBLayout.getAllPanes !== 'function' || !GBLayout.root) return false;
    const panes = GBLayout.getAllPanes(GBLayout.root, { activeOnly: true }) || [];
    return panes.some(pane => {
      if (typeof GBLayout.isPaneVisible === 'function' && !GBLayout.isPaneVisible(pane?.id)) return false;
      return (pane?.tabs || []).some(tab => !STARTUP_LAYOUT_UTILITY_TAB_TYPES.has(tab?.type));
    });
  } catch {
    return false;
  }
}

function _paneLayoutRestoredFromStorage() {
  return !!(typeof GBLayout !== 'undefined' && GBLayout.layoutLoadedFromStorage && _paneLayoutHasContentTabs());
}

/* ==============================
   API呼び出し
   ============================== */
function _perfNowMs() {
  return (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

function _perfElapsedMs(startedAt) {
  return Math.max(0, Math.round(_perfNowMs() - startedAt));
}

function _perfTargetLabelFromPath(path) {
  try {
    const url = new URL(String(path || ''), 'http://meldex.local');
    const rawPath = url.searchParams.get('path') || '';
    if (!rawPath) return '';
    return rawPath.split(/[\\/]/).filter(Boolean).pop() || rawPath;
  } catch {
    return '';
  }
}

const _apiFetchObservedGetEndpoints = new Set([
  '/outliner-roots',
  '/db-metadata',
  '/pivot',
  '/browse',
  '/check-type',
  '/file',
  '/file-meta',
  '/global-index',
]);

function _apiFetchPerfInfo(path) {
  try {
    const url = new URL(String(path || ''), 'http://meldex.local');
    const endpoint = url.pathname || '';
    if (!_apiFetchObservedGetEndpoints.has(endpoint)) return null;
    return {
      endpoint,
      label: 'api' + endpoint,
      targetLabel: _perfTargetLabelFromPath(path),
    };
  } catch {
    return null;
  }
}

const _apiFetchInFlightGets = new Map();
const GB_APP_API_FETCH_BROWSE_CACHE_TTL_MS = 2500;
const GB_APP_API_FETCH_BROWSE_CACHE_MAX_ENTRIES = 80;
// 通常の読取でもDropbox/NASやウイルススキャンの待機で15秒を超えることがある。
// 15秒を全APIへ一律適用すると、サーバー側では正常に継続している処理を失敗扱いに
// してしまうため、読取・更新・長時間処理を共通ポリシーで分ける。
const GB_APP_API_FETCH_TIMEOUT_MS = 60000;
const GB_APP_API_FETCH_MUTATION_TIMEOUT_MS = 120000;
const GB_APP_API_FETCH_MAX_TIMEOUT_MS = 330000;
// OSのフォルダ／ファイル選択は利用者の操作を待つため、通常APIの読取上限を使わない。
// サーバー側の待機上限（フォルダ120秒、ファイル300秒）より少し長くして、正常な
// 選択結果をフロント側が先に破棄しない。パスだけを入力する検証POSTも同じendpointを
// 使うが、長い上限は実際の処理時間を延ばさず、応答が止まった場合だけ作用する。
const GB_APP_API_FETCH_NATIVE_DIALOG_TIMEOUTS = new Map([
  ['/pick-folder', 135000],
  ['/add-outliner-root', 135000],
  ['/dropbox-link/pick-workspace-folder', 135000],
  ['/workspaces/pick-folder', 135000],
  ['/standalone/pick-folder', 135000],
  ['/save-file-dialog', 315000],
  ['/open-file-dialog', 315000],
  ['/settings-transfer/export', 315000],
]);
// シート系エンドポイント（セル値・列メタデータ）の保存先 per-sheet SQLite は Dropbox
// 同期フォルダ上にあり、書き込みロック待ちが最大 busy_timeout=30秒 かかり得る。
// サーバー処理中でもフロントが先に abort して「保存に失敗しました」の偽エラーにならない
// よう、これらは 30秒 を上回る既定タイムアウトにする（明示 timeoutMs があればそちら優先）。
const GB_APP_API_FETCH_SHEET_TIMEOUT_MS = 60000;
// 共有設定（プロフィール等）の読み書きも Dropbox 同期フォルダ上のファイルを触るため、
// 同じ理由で15秒では足りずに「通信に失敗しました」の偽エラーになることがある
// （実機で、プロフィール統合の直後に発生。処理自体は成功していた）。
const GB_APP_API_FETCH_SHEET_ENDPOINTS = new Set(['/value', '/db-metadata', '/dropbox-link/settings-file']);
const GB_APP_API_FETCH_FILE_OPERATIONS = new Set([
  '/outliner/add', '/outliner/rename', '/outliner/move', '/outliner/move-batch', '/outliner/duplicate', '/outliner/save-as',
  '/outliner/delete', '/outliner/delete-batch', '/outliner/restore', '/outliner/restore-batch',
  '/trash/restore', '/trash/delete', '/trash/empty',
  '/import-csv', '/import-xlsx', '/import-xlsx-scriptnote', '/export-to-db', '/export/html-to-png',
  '/version/save', '/version/restore', '/version/save-db', '/version/restore-db',
  '/version/save-folder', '/version/restore-folder', '/version/save-sqlite-db', '/version/restore-sqlite-db',
  '/sheet-archive/archive', '/sheet-archive/restore', '/data-protection/db-backup', '/data-protection/export-backup',
]);
const GB_APP_API_FETCH_STORAGE_WRITES = [
  '/value', '/db-metadata', '/entity', '/annotations', '/cal', '/calendar-db',
  '/chat/save', '/quick-memo', '/global-tags', '/global-tag-groups', '/folder-links',
  '/personal-preferences', '/workspace-preferences', '/dropbox-link/settings-file',
];
const GB_APP_API_FETCH_MAINTENANCE_TIMEOUT_MS = 300000;
const GB_APP_API_FETCH_MAINTENANCE_SEGMENT_RE = /(?:^|[\/-])(?:rebuild|reindex|rescan|scan|repair|migrat(?:e|ion)|gc|import|export|backup|restore|archive|compress|extract|convert|generate|install|upgrade|recalculate|resolve|enrich|cleanup|purge|compact|batch|refresh|retry|apply|upload|download)(?:$|[\/-])/i;
const GB_APP_API_FETCH_MUTATING_SYNC_SEGMENT_RE = /(?:^|[\/-])sync(?:$|[\/-])/i;
function _gbAppApiFetchIsMaintenanceOperation(path, options = {}) {
  const rawPath = String(path || '');
  const pathname = rawPath.split('?')[0].replace(/^\/api(?=\/)/, '');
  const method = String(options.method || 'GET').toUpperCase();
  if (GB_APP_API_FETCH_MAINTENANCE_SEGMENT_RE.test(pathname)) return true;
  // GET /.../sync/status のような軽い状態確認は通常上限のままにし、
  // 実際に同期を開始・変更する要求だけを長時間処理として扱う。
  if (method !== 'GET' && GB_APP_API_FETCH_MUTATING_SYNC_SEGMENT_RE.test(pathname)) return true;
  try {
    const params = new URL(rawPath, 'http://meldex.local').searchParams;
    const enabled = key => ['1', 'true', 'yes'].includes(String(params.get(key) || '').toLowerCase());
    return method === 'GET' && (
      enabled('refresh') || enabled('full_scan') || enabled('rescan')
      || enabled('rebuild') || enabled('reindex')
    );
  } catch {
    return false;
  }
}
function _gbAppApiFetchDefaultTimeout(path, options = {}) {
  const pathname = String(path || '').split('?')[0].replace(/^\/api(?=\/)/, '');
  const nativeDialogTimeout = GB_APP_API_FETCH_NATIVE_DIALOG_TIMEOUTS.get(pathname);
  if (nativeDialogTimeout) return nativeDialogTimeout;
  // ファイル操作は実体の変更後にもDB・参照・タグを更新する。通常の15秒で応答を捨てない。
  if (GB_APP_API_FETCH_FILE_OPERATIONS.has(pathname)) return 300000;
  // 全体再構築・再走査・修復・移行・同期は対象件数により15秒を超える。
  // 各ボタンを個別リストへ追加し忘れないよう、操作の意味で共通分類する。
  // ジョブ化済みのAPIは即時応答するため、この上限はハング時だけ作用する。
  if (_gbAppApiFetchIsMaintenanceOperation(path, options)) return GB_APP_API_FETCH_MAINTENANCE_TIMEOUT_MS;
  // 監査したSQLite・共有設定の書込経路は、30秒のロック待ちと付随更新を待つ。
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(options.method || 'GET').toUpperCase())
      && GB_APP_API_FETCH_STORAGE_WRITES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))) return 120000;
  // NASのSMB列挙・写真の詳細取得は15秒を超える。読み取りの完了を待ち、
  // 明示的な画面切替signalによる中断は引き続き尊重する。
  if (['/browse', '/images-in-folder', '/check-type', '/outliner-roots', '/file'].includes(pathname)
      || pathname.startsWith('/contained-files')) return 300000;
  if (['/upload-file', '/upload-files', '/upload-image', '/duplicate-resolve'].includes(pathname)) return 300000;
  // Cloud reads may include a large sheet and bounded Dropbox retry waits.
  if (window.MeldexRuntimeAdapter?.getMode?.() === 'dropbox'
      && ['/pivot', '/db-metadata', '/value', '/browse', '/check-type'].includes(pathname)) return 120000;
  // 未登録の更新APIも短い読取上限で打ち切らない。個別リストへの追加漏れが、
  // 処理済みなのに失敗表示して再実行を誘う事故へ戻らないための共通の下限である。
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(options.method || 'GET').toUpperCase())) {
    return GB_APP_API_FETCH_MUTATION_TIMEOUT_MS;
  }
  return GB_APP_API_FETCH_SHEET_ENDPOINTS.has(pathname)
    ? GB_APP_API_FETCH_SHEET_TIMEOUT_MS
    : GB_APP_API_FETCH_TIMEOUT_MS;
}
const _gbAppApiFetchBrowseCache = new Map();
let _gbAppApiFetchCacheGeneration = 0;

function _gbAppApiFetchMethod(opts) {
  return String(opts?.method || 'GET').toUpperCase();
}

function _gbAppApiFetchClonePayload(payload) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(payload); } catch {}
  }
  try { return JSON.parse(JSON.stringify(payload)); } catch { return payload; }
}

function _gbAppApiFetchCanonicalGetPath(path) {
  try {
    const url = new URL(String(path || ''), 'http://meldex.local');
    const params = [...url.searchParams.entries()]
      .sort(([ak, av], [bk, bv]) => (ak + '=' + av).localeCompare(bk + '=' + bv));
    const query = params.map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&');
    return url.pathname + (query ? '?' + query : '');
  } catch {
    return String(path || '');
  }
}

function _apiFetchInFlightKey(path, opts) {
  if (_gbAppApiFetchMethod(opts) !== 'GET' || opts?.body != null || opts?.signal) return '';
  const nonBenignKeys = Object.keys(opts || {}).filter(key => !['method', 'silentError', 'skipBrowseCache'].includes(key));
  if (nonBenignKeys.length > 0) return '';
  return _gbAppApiFetchCanonicalGetPath(path)
    + '|silent=' + (opts?.silentError === true ? '1' : '0')
    + '|skipBrowseCache=' + (opts?.skipBrowseCache === true ? '1' : '0');
}

function _gbAppApiFetchBrowseCacheKey(path, opts) {
  if (_gbAppApiFetchMethod(opts) !== 'GET' || opts?.body != null || opts?.skipBrowseCache === true || opts?.cache === 'reload') return '';
  try {
    const url = new URL(String(path || ''), 'http://meldex.local');
    return (url.pathname === '/browse' || (url.pathname === '/pivot' && url.searchParams.get('tree_only') === 'true'))
      ? _gbAppApiFetchCanonicalGetPath(path) : '';
  } catch {
    return '';
  }
}

function _gbAppApiFetchInvalidateReadCaches() {
  _gbAppApiFetchCacheGeneration += 1;
  _gbAppApiFetchBrowseCache.clear();
  _apiFetchInFlightGets.clear();
  if (typeof _clearBrowseItemResolvedTypeCache === 'function') _clearBrowseItemResolvedTypeCache();
}

function _gbAppApiFetchRememberBrowse(cacheKey, payload) {
  if (cacheKey.startsWith('/pivot?') && payload?.tree_only !== true) return;
  _gbAppApiFetchBrowseCache.set(cacheKey, {
    at: Date.now(),
    payload: _gbAppApiFetchClonePayload(payload),
  });
  while (_gbAppApiFetchBrowseCache.size > GB_APP_API_FETCH_BROWSE_CACHE_MAX_ENTRIES) {
    const oldestKey = _gbAppApiFetchBrowseCache.keys().next().value;
    if (!oldestKey) break;
    _gbAppApiFetchBrowseCache.delete(oldestKey);
  }
}

function _apiFetchBackendPerf(res) {
  try {
    const raw = res?.headers?.get?.('x-meldex-perf') || '';
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function _logPerfEvent(label, startedAt, detail) {
  try {
    const durationMs = _perfElapsedMs(startedAt);
    const payload = {
      ...(detail || {}),
      message: `[perf] ${label}: ${durationMs}ms`,
      perf: true,
      label,
      durationMs,
    };
    if (typeof console !== 'undefined' && typeof console.info === 'function') {
      console.info('[Meldex perf] ' + payload.message, payload);
    }
    if (typeof _sendLog === 'function') _sendLog('info', payload);
    return payload;
  } catch {
    return null;
  }
}

function _gbAppApiFetchIsAbortError(e) {
  return !!e && (e.name === 'AbortError' || e.code === 20);
}

// 呼び出し元のsignalを尊重しつつ、一定時間で自動中断するfetchラッパー。
// タイムアウトで中断した場合はisTimeout=trueを付与し、呼び出し元キャンセルと区別できるようにする。
async function _gbAppApiFetchDoFetch(url, requestOpts, timeoutMs, consumeResponse) {
  const controller = new AbortController();
  const externalSignal = requestOpts?.signal || null;
  const fetchOpts = { ...(requestOpts || {}) };
  delete fetchOpts.timeoutMs;
  let timedOut = false;
  let onExternalAbort = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      // 理由付きabortはfetchが通常Errorを投げるため、呼び出し元キャンセルを
      // 通信障害と誤判定しないよう内部signalは標準AbortErrorへ正規化する。
      controller.abort();
    } else {
      onExternalAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, { ...fetchOpts, signal: controller.signal });
    return consumeResponse ? await consumeResponse(response) : response;
  } catch (e) {
    if (_gbAppApiFetchIsAbortError(e) && timedOut) {
      const timeoutErr = new Error(`HTTPリクエストがタイムアウトしました(${Math.round(timeoutMs / 1000)}秒): ${url}`);
      timeoutErr.name = 'AbortError';
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal && onExternalAbort) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

// Leave HTTP/1 connection slots for saves and the newly opened document.
