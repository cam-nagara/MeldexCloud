/* gb-layout.part01.js */
/* ==============================
   gb-layout.js: レイアウトツリー管理（v5.0 ペインシステム）
   ============================== */

const GBLayout = (() => {
  const STORAGE_KEY = 'gb:layout';
  const ACTIVE_PANE_STORAGE_KEY = 'gb:layout:active-pane';
  const BACKUP_KEY = 'gb:layout:backup-pre-b';
  const MAX_DEPTH = 4;
  const MIN_PANE_SIZE = 32; // px（折り畳みボタン1つ分まで縮小可能）
  const FREE_LAYOUT_UI_ENABLED = false;
  const MAIN_TAB_REORDER_MIME = 'application/x-meldex-main-tab-reorder';

  let _root = null;       // LayoutNode (ツリーのルート)
  let _paneMap = {};       // paneId → { node, el, component }
  let _activePane = null;  // 現在フォーカスのあるペインID
  let _layoutEl = null;    // #gb-layout-root DOM要素
  let _paneIdCounter = 0;
  let _maximizedPaneId = null;    // 最大化中のペインID
  let _savedRootForMaximize = null; // 最大化前のルートツリー
  let _loadedLayoutFromStorage = false;
  const SAVE_LAYOUT_DEBOUNCE_MS = 80;
  let _saveLayoutTimer = null;
  let _saveLayoutPending = false;
  let _meldexNodeHoverTimer = null;
  let _meldexNodeHoverTabId = '';

  function _showFreeLayoutUi() {
    return FREE_LAYOUT_UI_ENABLED;
  }

  function _paneRoleName(node) {
    const role = String(node?.meldexRole || '').trim();
    if (role) return role;
    return node?.id === 'pane-main' ? 'main' : '';
  }

  function _paneRoleClassName(role) {
    return String(role || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown';
  }

  function _applyPaneRoleAttributes(pane, node) {
    const role = _paneRoleName(node);
    if (!pane || !role) return;
    pane.dataset.meldexRole = role;
    pane.classList.add('gb-pane-role-' + _paneRoleClassName(role));
  }

  function _isMainPaneNode(node) {
    return !!node && (node.id === 'pane-main' || _paneRoleName(node) === 'main');
  }

  function _canReorderMainPaneTabs(node) {
    return !_showFreeLayoutUi()
      && _isMainPaneNode(node)
      && !node?.locked
      && !node?.collapsed
      && Array.isArray(node?.tabs)
      && node.tabs.length > 1;
  }

  // ファイルdropは自由レイアウト用のドッキング操作とは別契約。
  // 固定レイアウトでも、利用者が日常的に使うメインタブ行は開く対象として受け入れる。
  function _canAcceptNodeDropOnTabBar(node) {
    return _showFreeLayoutUi() || _isMainPaneNode(node);
  }

  function _isSidebarPaneNode(node) {
    const role = _paneRoleName(node);
    return role === 'left-sidebar' || role === 'right-sidebar';
  }

  function _activeTabForPaneNode(node) {
    if (!node || !Array.isArray(node.tabs) || node.tabs.length === 0) return null;
    const index = Number.isInteger(node.activeTabIndex) ? node.activeTabIndex : -1;
    return node.tabs[index] || node.tabs[0] || null;
  }

  function _isCloudMobileLayout() {
    return document.body?.dataset?.cloudMobile === '1';
  }

  function _shouldShowMobileMainTabActions(node) {
    return !_showFreeLayoutUi()
      && (_isMobileLayout() || _isCloudMobileLayout())
      && _isMainPaneNode(node)
      && !!_activeTabForPaneNode(node);
  }

  function _shouldShowPaneActionsButton(node) {
    return _showFreeLayoutUi() || _shouldShowMobileMainTabActions(node);
  }

  function _isMobileMainTabActionsButton(node) {
    return _shouldShowMobileMainTabActions(node);
  }

  function _showPaneMoreButtonMenu(e, node) {
    if (_showFreeLayoutUi()) {
      _showPaneActionsMenu(e, node);
      return;
    }
    if (!_isMainPaneNode(node)) return;
    const activeTab = _activeTabForPaneNode(node);
    if (!activeTab) return;
    if (typeof setActivePane === 'function') setActivePane(node.id, { skipCallback: true });
    _showTabContextMenu(e, node.id, activeTab);
  }

  // === データモデル ===
  function createPaneNode(id, tabs, activeTabIndex) {
    return {
      type: 'pane',
      id: id || ('pane-' + (++_paneIdCounter)),
      tabs: tabs || [],
      activeTabIndex: activeTabIndex != null ? activeTabIndex : -1,
      locked: false,
      // 戻る/進む履歴はタブ単位（tab.navHistory/tab.navIndex）で持つ（②タブ別ナビ履歴、
      // 2026-07-21）。ペイン単位の navHistory/navIndex は廃止済み。旧形式の layout JSON に
      // 残る pane.navHistory は _normalizePaneNode でアクティブタブへ移譲してから削除する。
    };
  }

  function createSplitNode(direction, ratio, children) {
    return {
      type: 'split',
      id: 'split-' + (++_paneIdCounter),
      direction: direction || 'horizontal',
      ratio: ratio != null ? ratio : 0.5,
      children: children || [null, null],
    };
  }

  // === デフォルトレイアウト ===
  function defaultLayout() {
    return createPaneNode('pane-main', [], -1);
  }

  const FIXED_RAIL_LEFT_TYPES = new Set(['outliner']);
  const FIXED_RAIL_RIGHT_TYPES = new Set(['detail', 'preview', 'chat', 'timer', 'history', 'annotation', 'sticky', 'tags', 'version', 'subpanel']);
  const FIXED_RAIL_RIGHT_DEFAULTS = [
    ['オプション', 'detail'], ['ビューワー', 'preview'], ['サブパネル', 'subpanel'], ['バージョン管理', 'version'],
    ['チャット', 'chat'], ['タイマー', 'timer'],
    ['ヒストリー', 'history'], ['注釈', 'annotation'], ['タグ', 'tags'],
  ];

  function _fixedRailGeneratedId(prefix) {
    return `${prefix}-fixed-${Date.now().toString(36)}-${(++_paneIdCounter).toString(36)}`;
  }

  function _bumpCounterFromLayout(node) {
    if (!node) return;
    const n = parseInt(String(node.id || '').replace(/^(pane|split|panelset)-/, ''), 10);
    if (Number.isFinite(n) && n > _paneIdCounter) _paneIdCounter = n;
    if (node.type === 'split' && Array.isArray(node.children)) node.children.forEach(_bumpCounterFromLayout);
    if (node.type === 'panelset' && Array.isArray(node.groups)) node.groups.forEach(g => _bumpCounterFromLayout(g?.root));
  }

  function _fixedRailTab(label, type) {
    const icon = typeof uiTypeIconName === 'function' ? uiTypeIconName(type) : '';
    return { id: _fixedRailGeneratedId('tab'), type, label, path: '', icon: icon || type, state: {} };
  }

  function _collectFixedRailPanes(node, out = []) {
    if (!node) return out;
    if (node.type === 'pane') out.push(node);
    else if (node.type === 'split' && Array.isArray(node.children)) node.children.forEach(child => _collectFixedRailPanes(child, out));
    else if (node.type === 'panelset' && Array.isArray(node.groups)) node.groups.forEach(g => _collectFixedRailPanes(g?.root, out));
    return out;
  }

  function _hasFixedRailRoles(node) {
    const roles = new Set();
    (function walk(n) {
      if (!n) return;
      if (n.meldexRole) roles.add(n.meldexRole);
      if (n.type === 'split' && Array.isArray(n.children)) n.children.forEach(walk);
      if (n.type === 'panelset' && Array.isArray(n.groups)) n.groups.forEach(g => walk(g?.root));
    })(node);
    return roles.has('left-sidebar') && roles.has('main') && roles.has('right-sidebar');
  }

  function _findFixedRailPanelset(node, role) {
    if (!node) return null;
    if (node.type === 'panelset' && node.meldexRole === role) return node;
    if (node.type === 'split' && Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = _findFixedRailPanelset(child, role);
        if (found) return found;
      }
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      for (const group of node.groups) {
        const found = _findFixedRailPanelset(group?.root, role);
        if (found) return found;
      }
    }
    return null;
  }

  function _ensureFixedRightRailDefaults(node) {
    const rightDock = _findFixedRailPanelset(node, 'right-sidebar');
    if (!rightDock || !Array.isArray(rightDock.groups)) return node;
    rightDock.groups.forEach(group => {
      _collectFixedRailPanes(group?.root).forEach(pane => {
        if (!Array.isArray(pane.tabs)) return;
        pane.tabs = pane.tabs.filter(tab => !['calendar', 'search'].includes(tab?.type));
        if (pane.activeTabIndex >= pane.tabs.length) pane.activeTabIndex = pane.tabs.length ? 0 : -1;
      });
    });
    const originalGroupCount = rightDock.groups.length;
    rightDock.groups = rightDock.groups.filter(group => (
      _collectFixedRailPanes(group?.root).some(pane => (pane.tabs || []).length)
    ));
    if (rightDock.groups.length !== originalGroupCount) {
      if (!rightDock.groups.some(group => group.id === rightDock.activeGroupId)) {
        rightDock.activeGroupId = rightDock.groups[0]?.id || null;
      }
    }
    const seen = new Set();
    rightDock.groups.forEach(group => {
      _collectFixedRailPanes(group?.root).forEach(pane => (pane.tabs || []).forEach(tab => seen.add(tab?.type || '')));
    });
    FIXED_RAIL_RIGHT_DEFAULTS.forEach(([label, type]) => {
      if (seen.has(type)) return;
      const pane = createPaneNode(null, [_fixedRailTab(label, type)], 0);
      pane.meldexRole = 'right-sidebar';
      const group = { id: _fixedRailGeneratedId('group'), root: pane };
      rightDock.groups.push(group);
      if (!rightDock.activeGroupId) rightDock.activeGroupId = group.id;
      seen.add(type);
    });
    return node;
  }

  function _countFixedRailTabs(node) {
    const rightDock = _findFixedRailPanelset(node, 'right-sidebar');
    if (!rightDock || !Array.isArray(rightDock.groups)) return 0;
    let count = 0;
    rightDock.groups.forEach(group => {
      _collectFixedRailPanes(group?.root).forEach(pane => { count += (pane.tabs || []).length; });
    });
    return count;
  }

  // 固定レール（左右サイドバー）は「1パネル = 1タブ」構成のため、タブを1つ閉じると
  // パネルごと消え、レールのアイコンも一緒に消える。欠損の補填は起動時とレイアウト
  // 全差し替え時にしか走らないので、消えたまま次回起動まで戻らなかった。
  // 閉じる操作を入口で止めるための判定。
  function isFixedRailPane(paneId) {
    if (!paneId || window._gbSingleWindow) return false;
    const found = findNode(_root, paneId);
    return !!found?.node && found.node.type === 'pane' && _isSidebarPaneNode(found.node);
  }

  // どの経路で右レールの既定パネルが欠けても補填し、恒久的な消失を防ぐ安全網。
  // 追加が発生した場合だけ true を返す（呼び出し側で再描画するため）。
  function ensureFixedRailDefaults() {
    if (!_root || window._gbSingleWindow) return false;
    if (!_hasFixedRailRoles(_root)) return false;
    const before = _countFixedRailTabs(_root);
    _ensureFixedRightRailDefaults(_root);
    return _countFixedRailTabs(_root) !== before;
  }

  function _fixedRailPanelset(roots, role, activeIndex, popupWidth) {
    const groups = roots.map(root => ({ id: _fixedRailGeneratedId('group'), root }));
    const active = groups[Math.max(0, Math.min(groups.length - 1, activeIndex || 0))];
    const node = { type: 'panelset', id: _fixedRailGeneratedId('panelset'), groups, activeGroupId: active?.id || null, collapsed: false, meldexRole: role };
    if (popupWidth) node.defaultPopupWidth = popupWidth;
    return node;
  }

  function _fixedRailRatios() {
    const total = Math.max(1, _layoutEl?.clientWidth || window.innerWidth || 1600);
    const minWork = Math.min(400, Math.max(260, total * 0.25));
    let left = 260, right = 360;
    if (left + right + minWork > total) {
      const scale = Math.max(0.35, (total - minWork) / (left + right));
      left *= scale; right *= scale;
    }
    return { leftRatio: left / total, workRatio: Math.max(1, total - left - right) / Math.max(1, total - left), leftWidth: Math.round(left), rightWidth: Math.round(right) };
  }

  function _migrateLayoutToFixedRailsIfNeeded(node) {
    _bumpCounterFromLayout(node);
    if (!node || window._gbSingleWindow) return node;
    if (_hasFixedRailRoles(node)) return _ensureFixedRightRailDefaults(node);
    const storedActivePaneId = _readStoredActivePaneId();
    const leftTabs = [], rightTabs = [], contentTabs = [];
    let contentActiveIndex = -1;
    _collectFixedRailPanes(node).forEach((pane) => {
      const tabs = Array.isArray(pane.tabs) ? pane.tabs : [];
      if (!tabs.length) contentTabs.push(_fixedRailTab('フォルダ', 'folder'));
      tabs.forEach((tab, tabIdx) => {
        const type = tab?.type || '';
        if (type === 'search' || type === 'calendar') return;
        if (FIXED_RAIL_LEFT_TYPES.has(type)) leftTabs.push(tab);
        else if (FIXED_RAIL_RIGHT_TYPES.has(type)) rightTabs.push(tab);
        else {
          if (pane.id === storedActivePaneId && pane.activeTabIndex === tabIdx) contentActiveIndex = contentTabs.length;
          contentTabs.push(tab);
        }
      });
    });
    if (!contentTabs.length) contentTabs.push(_fixedRailTab('フォルダ', 'folder'));
    const mainPane = createPaneNode('pane-main', contentTabs, contentActiveIndex >= 0 ? contentActiveIndex : 0);
    mainPane.meldexRole = 'main';
    const leftPane = createPaneNode(null, [leftTabs[0] || _fixedRailTab('フォルダツリー', 'outliner')], 0);
    leftPane.meldexRole = 'left-sidebar';
    const seenRight = new Set(rightTabs.map(tab => tab?.type || '').filter(Boolean));
    FIXED_RAIL_RIGHT_DEFAULTS.forEach(([label, type]) => { if (!seenRight.has(type)) rightTabs.push(_fixedRailTab(label, type)); });
    const rightPanes = rightTabs.map(tab => {
      const pane = createPaneNode(null, [tab], 0);
      pane.meldexRole = 'right-sidebar';
      return pane;
    });
    const activeRightIndex = Math.max(0, rightPanes.findIndex(p => p.tabs?.[0]?.type === 'detail'));
    const ratios = _fixedRailRatios();
    const leftDock = _fixedRailPanelset([leftPane], 'left-sidebar', 0, ratios.leftWidth);
    const workDock = _fixedRailPanelset([mainPane], 'main', 0, 0);
    const rightDock = _fixedRailPanelset(rightPanes, 'right-sidebar', activeRightIndex, ratios.rightWidth);
    const contentSplit = createSplitNode('horizontal', ratios.workRatio, [workDock, rightDock]);
    return createSplitNode('horizontal', ratios.leftRatio, [leftDock, contentSplit]);
  }

  // === B案正規化: ドック = 水平split の子を常に panelset でラップ ===
  // マイグレーション規則（計画書 Phase 2 / §5.1）:
  //   1. 水平split の子は pane/split なら panelset でラップ、panelset ならそのまま
  //   2. 垂直split の子はラップしない（垂直split = 同ドック内の縦並び）
  //   3. panelset の groups[].root は再帰処理（内部に水平split がある場合のため）
  //   4. 旧 collapsed は panelset.collapsed へ移行する。
  //      _savedRatio は現在も折りたたみ復元幅として使うため、collapsed 中の有効値は保持する。
  function _wrapInPanelset(node) {
    if (!node) return node;
    if (node.type === 'panelset') return node;
    const collapsed = !!node.collapsed;
    const savedRatio = Number(node._savedRatio);
    const defaultPopupWidth = Number(node.defaultPopupWidth);
    delete node.collapsed;
    delete node._savedRatio;
    delete node.defaultPopupWidth;
    // GBPanelSet と同形式（panelset-<timestamp>-<counter>）で生成し、
    // 既存 panelset/group との ID 衝突を回避
    const ts = Date.now().toString(36);
    const n1 = ++_paneIdCounter;
    const n2 = ++_paneIdCounter;
    const groupId = 'group-' + ts + '-' + n2;
    const panelset = {
      type: 'panelset',
      id: 'panelset-' + ts + '-' + n1,
      groups: [{ id: groupId, root: node }],
      activeGroupId: groupId,
      collapsed,
    };
    if (collapsed && Number.isFinite(savedRatio) && savedRatio > 0 && savedRatio < 1) {
      panelset._savedRatio = savedRatio;
    }
    if (Number.isFinite(defaultPopupWidth) && defaultPopupWidth > 0) {
      panelset.defaultPopupWidth = Math.round(defaultPopupWidth);
    }
    return panelset;
  }

  function migrateLayoutToB(node) {
    if (!node) return node;
    // 単独 pane / split をルートに持つ場合もすべて panelset にラップ
    if (node.type === 'pane') {
      return _wrapInPanelset(migrateSubtree(node));
    }
    if (node.type === 'split') {
      const migrated = migrateSubtree(node);
      // split ノード自体は panelset でラップしない。描画時に水平split の子がすべて panelset の前提。
      return migrated;
    }
    if (node.type === 'panelset') {
      return migrateSubtree(node);
    }
    return node;
  }

  function _normalizeCollapseSavedRatio(node) {
    if (!node || !Object.prototype.hasOwnProperty.call(node, '_savedRatio')) return;
    const saved = Number(node._savedRatio);
    if (node.collapsed && Number.isFinite(saved) && saved > 0 && saved < 1) {
      node._savedRatio = saved;
      return;
    }
    delete node._savedRatio;
  }

  function migrateSubtree(node) {
    if (!node) return node;
    if (node.type === 'pane') {
      _normalizeCollapseSavedRatio(node);
      return node;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
      _normalizeCollapseSavedRatio(node);
      const isHorizontal = node.direction === 'horizontal';
      node.children = node.children.map((child) => {
        if (!child) return child;
        const processed = migrateSubtree(child);
        if (isHorizontal) {
          // 水平split の子は panelset でラップ必須
          return _wrapInPanelset(processed);
        }
        return processed;
      });
      return node;
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      // 旧 split.collapsed が panelset.collapsed に移行されている前提
      if (typeof node.collapsed !== 'boolean') node.collapsed = false;
      _normalizeCollapseSavedRatio(node);
      node.groups.forEach((g) => {
        if (g?.root) g.root = migrateSubtree(g.root);
      });
      const validIds = node.groups.map(g => g?.id).filter(Boolean);
      if (!validIds.includes(node.activeGroupId)) {
        node.activeGroupId = validIds[0] || null;
      }
      return node;
    }
    return node;
  }

  // === レイアウトの保存/復元 ===
  function _writeLayoutToStorage() {
    // 単一タブポップアウト窓 (?single=1) では localStorage を汚染しないよう保存を抑止
    if (window._gbSingleWindow) return false;
    try {
      // 保存前に B 案正規化を冪等適用（手動操作で水平split の子が panelset 以外になった場合の救済）
      if (_root) _root = migrateLayoutToB(_root);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_root));
      _writeActivePaneToStorage();
      if (typeof _autoSaveCurrentAppLayout === 'function') _autoSaveCurrentAppLayout();
      return true;
    } catch (e) {
      return false;
    }
  }

  function _readStoredActivePaneId() {
    if (window._gbSingleWindow) return '';
    try {
      return localStorage.getItem(ACTIVE_PANE_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function _writeActivePaneToStorage() {
    if (window._gbSingleWindow) return false;
    try {
      if (_activePane) localStorage.setItem(ACTIVE_PANE_STORAGE_KEY, _activePane);
      else localStorage.removeItem(ACTIVE_PANE_STORAGE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function _flushSaveLayout() {
    if (_saveLayoutTimer) {
      clearTimeout(_saveLayoutTimer);
      _saveLayoutTimer = null;
    }
    if (!_saveLayoutPending) return false;
    _saveLayoutPending = false;
    return _writeLayoutToStorage();
  }

  function saveLayout(options) {
    // 単一タブポップアウト窓 (?single=1) では localStorage を汚染しないよう保存を抑止
    if (window._gbSingleWindow) return;
    _saveLayoutPending = true;
    if (options?.immediate) {
      _flushSaveLayout();
      return;
    }
    if (_saveLayoutTimer) return;
    _saveLayoutTimer = setTimeout(_flushSaveLayout, SAVE_LAYOUT_DEBOUNCE_MS);
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', _flushSaveLayout);
    window.addEventListener('pagehide', _flushSaveLayout);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) _flushSaveLayout();
    });
  }

  function loadLayout() {
    // 単一タブポップアウト窓では保存済みレイアウトを読み込まず、最小レイアウトで起動
    if (window._gbSingleWindow) return null;
    try {
      const rawSaved = localStorage.getItem(STORAGE_KEY);
      const saved = JSON.parse(rawSaved);
      if (saved && (saved.type === 'pane' || saved.type === 'split' || saved.type === 'panelset')) {
        _normalizePaneNode(saved);
        // B 案マイグレーション: 水平split の子を panelset でラップ済みでなければバックアップしてから変換
        const needsMigration = _needsBMigration(saved);
        if (needsMigration) {
          try { if (rawSaved) localStorage.setItem(BACKUP_KEY, rawSaved); } catch (e) {}
          try {
            return _migrateLayoutToFixedRailsIfNeeded(migrateLayoutToB(saved));
          } catch (err) {
            // マイグレーション失敗時はバックアップを維持し、デフォルトレイアウトを返す
            try { localStorage.setItem('gb:layout:migration-error', String(err?.message || err)); } catch (e) {}
            return null;
          }
        }
        return _migrateLayoutToFixedRailsIfNeeded(saved);
      }
    } catch (e) {}
    return null;
  }

  function _needsBMigration(node, isRoot = true) {
    if (!node) return false;
    if (node.type === 'split' && node.direction === 'horizontal' && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child && child.type !== 'panelset') return true;
        if (child && _needsBMigration(child, false)) return true;
      }
      return false;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
      return node.children.some(child => _needsBMigration(child, false));
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      return node.groups.some(g => g?.root && _needsBMigration(g.root, false));
    }
    // ルート単独の pane → 要マイグレーション
    if (node.type === 'pane') return !!isRoot;
    return false;
  }

  function _normalizePaneNode(node) {
    if (!node) return;
    if (node.type === 'pane') {
      node.locked = !!node.locked;
      if (!Array.isArray(node.tabs)) node.tabs = [];
      node.tabs.forEach((tab) => {
        if (!tab || typeof tab !== 'object') return;
        if (tab.type === 'folder' && !tab.path && tab.label === 'エクスプローラー') {
          tab.label = 'フォルダ';
        }
        // アプリ名変更前の汎用スケジュールタブだけを現行名へ移行する。
        // パス付きのカレンダーファイルはユーザーが付けた名前なので変更しない。
        if (tab.type === 'calendar' && !tab.path && tab.label === 'スケジューラー') {
          tab.label = 'スケジュール';
        }
        // 詳細パネル → オプションパネル リネーム (v0.5.255/0.5.263) 以前のレイアウトに残る
        // 旧ラベル '詳細' / 旧アイコン 'info' を現行値に置換する
        if (tab.type === 'detail') {
          if (tab.label === '詳細') tab.label = 'オプション';
          if (tab.icon === 'info' || tab.icon === 'panelRight') tab.icon = 'slidersHorizontal';
        }
        if (tab.type === 'subpanel' && (!tab.icon || tab.icon === 'panelRight')) {
          tab.icon = 'panelRightDashed';
        }
        // タブピン留め機能は廃止されたため、既存レイアウト JSON の pinned プロパティを除去
        if ('pinned' in tab) delete tab.pinned;
        // タブ単位の戻る/進む履歴（②タブ別ナビ履歴、2026-07-21）: 各タブへ防御的に初期化する。
        if (!Array.isArray(tab.navHistory)) tab.navHistory = [];
        tab.navHistory.forEach((entry) => {
          if (entry?.type === 'calendar' && !entry.path && entry.label === 'スケジューラー') {
            entry.label = 'スケジュール';
          }
        });
        if (!Number.isInteger(tab.navIndex)) tab.navIndex = tab.navHistory.length ? tab.navHistory.length - 1 : -1;
        if (tab.navIndex >= tab.navHistory.length) tab.navIndex = tab.navHistory.length - 1;
      });
      if (!Number.isInteger(node.activeTabIndex)) node.activeTabIndex = node.tabs.length ? 0 : -1;
      // 旧形式マイグレーション: pane.navHistory/pane.navIndex（ペイン単位・廃止済み）が
      // 残っている場合、アクティブタブの navHistory が空ならそこへ移譲する。
      // アクティブタブが既に独自の履歴を持つ場合は上書きしない（新形式の値を優先）。
      if (Array.isArray(node.navHistory) && node.navHistory.length) {
        const activeTab = node.tabs[node.activeTabIndex];
        if (activeTab && Array.isArray(activeTab.navHistory) && activeTab.navHistory.length === 0) {
          activeTab.navHistory = node.navHistory;
          activeTab.navHistory.forEach((entry) => {
            if (entry?.type === 'calendar' && !entry.path && entry.label === 'スケジューラー') {
              entry.label = 'スケジュール';
            }
          });
          activeTab.navIndex = Number.isInteger(node.navIndex) ? node.navIndex : (activeTab.navHistory.length - 1);
          if (activeTab.navIndex >= activeTab.navHistory.length) activeTab.navIndex = activeTab.navHistory.length - 1;
        }
      }
      // pane.navHistory/navIndex は旧形式の名残。移譲の有無によらず常に除去する
      // （旧版ロールバック時は旧版の _normalizePaneNode が navHistory=[] を再生成するため
      // 追加のみ変更でスキーマ互換を保てる）。
      delete node.navHistory;
      delete node.navIndex;
      return;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
      node.children.forEach(_normalizePaneNode);
      return;
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      // 非アクティブグループの activeGroupId 補完＋各 group.root を再帰正規化
      const validIds = node.groups.map(g => g?.id).filter(Boolean);
      if (!validIds.includes(node.activeGroupId)) {
        node.activeGroupId = validIds[0] || null;
      }
      node.groups.forEach((g) => { if (g?.root) _normalizePaneNode(g.root); });
    }
  }

  function isPaneLocked(paneId) {
    const info = findNode(_root, paneId);
    return !!info?.node?.locked;
  }

  function hasLockedPane() {
    return getAllPanes(_root).some(pane => !!pane.locked);
  }

  function findFirstUnlockedPane(excludePaneId) {
    const panes = getAllPanes(_root, { activeOnly: true }).filter(pane => pane.id !== excludePaneId && !pane.locked);
    const contentPane = panes.find((pane) => {
      const activeTab = pane.tabs?.[pane.activeTabIndex];
      return !(_isNavPaneType && _isNavPaneType(activeTab?.type));
    });
    return contentPane || panes[0] || null;
  }

  function setPaneLocked(paneId, locked) {
    const info = findNode(_root, paneId);
    if (!info?.node || info.node.type !== 'pane') return false;
    info.node.locked = !!locked;
    render();
    saveLayout();
    return true;
  }

  function togglePaneLocked(paneId) {
    const info = findNode(_root, paneId);
    if (!info?.node || info.node.type !== 'pane') return false;
    return setPaneLocked(paneId, !info.node.locked);
  }

  // 任意のノード（pane/split/panelset）が属する「カラム」（= 最も近い水平スプリットの
  // 直接子ノード）の ID を返す。カラムが見つからなければ null（ルート直下の単独ノード等）。
  function _findColumnAncestorId(nodeId) {
    // walk は対象 nodeId が見つかれば true を返す。
    // 水平 split が子から true を受け取ったら、その子の ID を _result に保存。
    let _result = null;
    function walk(node) {
      if (!node) return false;
      if (node.id === nodeId) return true;
      if (node.type === 'split' && Array.isArray(node.children)) {
        for (const child of node.children) {
          if (walk(child)) {
            if (node.direction === 'horizontal' && !_result) {
              _result = child.id;
            }
            return true;
          }
        }
      }
      if (node.type === 'panelset' && Array.isArray(node.groups)) {
        for (const g of node.groups) {
          if (g?.root && walk(g.root)) return true;
        }
      }
      return false;
    }
    walk(_root);
    return _result;
  }

  // === DOM生成 ===
  function renderNode(node, depth) {
    if (!node) return document.createElement('div');
    depth = depth || 0;

    if (node.type === 'pane') {
      return renderPane(node, depth);
    } else if (node.type === 'split') {
      return renderSplit(node, depth);
    } else if (node.type === 'panelset') {
      // 通常 panelset は renderAsColumn 経由で描画される。ここはフォールバック。
      const active = Array.isArray(node.groups) ? node.groups.find(g => g && g.id === node.activeGroupId) : null;
      if (active?.root) return renderNode(active.root, depth);
      return document.createElement('div');
    }
    return document.createElement('div');
  }

  // 「列」= 水平スプリットの子 or 単独ルート。
  // B案: すべての水平split の子は panelset 化されているため、このパスは常に panelset を処理。
  // 新設計（Phase 3）: renderDock で左端ドックバー常設 + 本体の2カラム構造に統一。
  function renderAsColumn(node, depth) {
    const isPanelset = node?.type === 'panelset';
    const panelSetApi = typeof GBPanelSet !== 'undefined' ? GBPanelSet : null;

    // 通常列はラッパーなしで直接レンダリング（B案化前のレイアウトへのフォールバック）
    if (!isPanelset) return renderNode(node, depth);

    // Phase 3: renderDock に一本化（collapsed ⇔ 展開 の切替はノード内の `collapsed` で管理）
    if (typeof panelSetApi?.renderDock === 'function') {
      return panelSetApi.renderDock(node, depth);
    }

    // フォールバック（renderDock 未定義時、旧コード経路）
    if (node.collapsed) {
      const bar = document.createElement('div');
      bar.className = 'gb-split-collapsed gb-split-collapsed-horizontal';
      bar.dataset.columnNodeId = node.id || '';

      // カラム移動用ドラッグハンドル
      const dragHandle = document.createElement('span');
      dragHandle.className = 'gb-split-collapsed-drag-handle';
      dragHandle.draggable = _showFreeLayoutUi();
      dragHandle.title = 'ドラッグ: カラム移動';
      dragHandle.innerHTML = lucide('gripVertical', 12);
      dragHandle.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
      dragHandle.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        const columnId = _findColumnAncestorId(node.id) || node.id;
        e.dataTransfer.setData('application/x-gb-column', JSON.stringify({ nodeId: columnId }));
        e.dataTransfer.effectAllowed = 'move';
      });
      dragHandle.addEventListener('dragend', () => {
        if (typeof GBDocking !== 'undefined' && typeof GBDocking.hideIndicator === 'function') {
          GBDocking.hideIndicator();
        }
      });
      if (_showFreeLayoutUi()) bar.appendChild(dragHandle);

      _appendCollapsedIcons(bar, node, () => {
        node.collapsed = false;
        _adjustSplitForCollapse(node);
        saveLayout();
      });
      return bar;
    }

    // パネルセット列: タブバー + アクティブグループの中身
    const col = document.createElement('div');
    col.className = 'gb-column';
    col.dataset.columnNodeId = node?.id || '';

    if (typeof panelSetApi?.renderPanelSetTabbar === 'function') {
      col.appendChild(panelSetApi.renderPanelSetTabbar(node));
    }
    const body = document.createElement('div');
    body.className = 'gb-column-body';
    if (typeof panelSetApi?.renderActiveGroupContent === 'function') {
      body.appendChild(panelSetApi.renderActiveGroupContent(node, depth));
    } else {
      const active = Array.isArray(node.groups)
        ? node.groups.find(g => g && g.id === node.activeGroupId) : null;
      if (active?.root) body.appendChild(renderNode(active.root, depth));
    }
    col.appendChild(body);
    return col;
  }

  // 折り畳み時: 親splitの比率を操作して領域を最小化/復元
  const COLLAPSE_SIZE = 0.025; // 折り畳み時の比率（2.5%≒約34px @1400px幅）
  function _clampSplitRatio(value) {
    return Math.max(0.08, Math.min(0.92, value));
  }

  function _splitRatioLooksCollapsedForChild(splitNode, childIndex) {
    if (!splitNode || splitNode.type !== 'split') return false;
    const tolerance = 0.002;
    return childIndex === 0
      ? splitNode.ratio <= COLLAPSE_SIZE + tolerance
      : splitNode.ratio >= 1 - COLLAPSE_SIZE - tolerance;
  }

  function _splitRenderedContentSize(splitNode) {
    const fallback = splitNode?.direction === 'horizontal'
      ? (_layoutEl?.clientWidth || window.innerWidth || 1200)
      : (_layoutEl?.clientHeight || window.innerHeight || 800);
    if (!splitNode?.id || typeof document === 'undefined') return Math.max(1, fallback);
    const el = document.querySelector(`.gb-split[data-split-id="${splitNode.id}"]`);
    const rect = el?.getBoundingClientRect?.();
    const size = splitNode.direction === 'horizontal' ? rect?.width : rect?.height;
    const zoom = (typeof _getZoom === 'function' ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1)) || 1;
    return Math.max(1, Number(size) ? Number(size) / zoom : fallback);
  }

  function _fallbackExpandedSplitRatio(splitNode, childIndex, targetNode) {
    const requestedPx = splitNode?.direction === 'horizontal' ? Number(targetNode?.defaultPopupWidth || 0) : 0;
    const contentSize = _splitRenderedContentSize(splitNode);
    if (requestedPx > 0 && contentSize > 0) {
      const targetRatio = Math.min(0.75, requestedPx / contentSize);
      return _clampSplitRatio(childIndex === 0 ? targetRatio : 1 - targetRatio);
    }
    return childIndex === 0 ? 0.28 : 0.72;
  }

  function _hasDefaultExpandedWidth(targetNode) {
    return Number(targetNode?.defaultPopupWidth || 0) > 0;
  }

  // 左右レール導入後、内側の水平split（作業領域 | 右サイドバー）は panelset で
  // ラップされるため、split そのものでも panelset 越しでも取り出せるようにする。
  function _innerHorizontalSplit(node) {
    if (!node) return null;
    if (node.type === 'split' && node.direction === 'horizontal' && Array.isArray(node.children) && node.children.length === 2) {
      return node;
    }
    if (node.type === 'panelset' && Array.isArray(node.groups) && node.groups.length === 1) {
      const root = node.groups[0]?.root;
      if (root && root.type === 'split' && root.direction === 'horizontal' && Array.isArray(root.children) && root.children.length === 2) {
        return root;
      }
    }
    return null;
  }

  function _restoreExpandedSplitRatio(splitNode, childIndex, targetNode) {
    if (!splitNode || splitNode.type !== 'split') return;
    const saved = Number(targetNode?._savedRatio);
    if (Number.isFinite(saved) && saved > 0 && saved < 1) {
      splitNode.ratio = saved;
      delete targetNode._savedRatio;
      return;
    }
    if (_hasDefaultExpandedWidth(targetNode)) {
      splitNode.ratio = _fallbackExpandedSplitRatio(splitNode, childIndex, targetNode);
      if (targetNode && Object.prototype.hasOwnProperty.call(targetNode, '_savedRatio')) {
        delete targetNode._savedRatio;
      }
      return;
    }
    if (_splitRatioLooksCollapsedForChild(splitNode, childIndex)) {
      splitNode.ratio = _fallbackExpandedSplitRatio(splitNode, childIndex, targetNode);
    }
    if (targetNode && Object.prototype.hasOwnProperty.call(targetNode, '_savedRatio')) {
      delete targetNode._savedRatio;
    }
  }

  function _adjustSplitForCollapse(targetNode, options) {
    // targetNodeはペインまたはsplitノード
    const parentInfo = findParent(_root, targetNode.id);
    if (!parentInfo) return;
    const splitNode = parentInfo.node;
    if (splitNode.type !== 'split' || !Array.isArray(splitNode.children)) {
      if (!options?.skipRender) render();
      return;
    }
    const idx0has = findNode(splitNode.children[0], targetNode.id);
    const childIndex = idx0has ? 0 : 1;
    const otherChild = splitNode.children[childIndex === 0 ? 1 : 0];
    const otherCollapsed = otherChild && otherChild.collapsed;

    if (targetNode.collapsed) {
      if (targetNode._savedRatio == null) targetNode._savedRatio = splitNode.ratio;
      if (otherCollapsed) {
        // 両側が折りたたみでも比率は潰さない。再展開時に各ドックの記憶幅/高さへ戻す。
      } else {
        splitNode.ratio = childIndex === 0 ? COLLAPSE_SIZE : (1 - COLLAPSE_SIZE);
      }
    } else {
      if (otherCollapsed) {
        if (targetNode._savedRatio != null || _hasDefaultExpandedWidth(targetNode) || _splitRatioLooksCollapsedForChild(splitNode, childIndex)) {
          _restoreExpandedSplitRatio(splitNode, childIndex, targetNode);
        } else {
          // 初期折りたたみレイアウトは親 split の ratio 自体が展開幅を保持する。
          // ここで 0.975/0.025 に寄せると左 260px / 右 360px の初期幅を失う。
        }
      } else if (targetNode._savedRatio != null) {
        _restoreExpandedSplitRatio(splitNode, childIndex, targetNode);
      } else {
        // 初期折りたたみレイアウトは親 split の ratio 自体が展開幅を保持する。
        // ここで 0.5 に戻すと左 260px / 右 360px の初期幅を失う。
        if (_hasDefaultExpandedWidth(targetNode) || _splitRatioLooksCollapsedForChild(splitNode, childIndex)) {
          _restoreExpandedSplitRatio(splitNode, childIndex, targetNode);
        }
      }
    }

    // --- 左レール開閉で右サイドバーのピクセル幅を変えない ---
    // 内側の水平split（作業領域 | 右サイドバー）を panelset 越しでも取り出し、
    // その時点の比率から右サイドバーの実ピクセル幅を求め、コンテンツ領域幅が
    // 変わっても同じピクセル幅になるよう比率を再計算する。
    // スナップショット（_savedInnerRatio）は使わず毎回現在値から算出するため、
    // 折りたたみ中に右幅をドラッグ調整しても展開時に破棄されない。
    const innerSplit = _innerHorizontalSplit(otherChild);
    if (innerSplit) {
      const layoutW = _layoutEl?.clientWidth || window.innerWidth || 1600;
      const handlePx = 4;
      // 左レール展開時のルート比率（折りたたみ時は保存値、展開時は復元済みの現在値）
      const expandedRootRatio = targetNode.collapsed
        ? Number(targetNode._savedRatio)
        : Number(splitNode.ratio);
      const expandedPaneW = (childIndex === 0 ? (1 - expandedRootRatio) : expandedRootRatio) * (layoutW - handlePx);
      const expandedInnerW = expandedPaneW - handlePx;      // 左レール展開時の内側split外形
      const collapsedInnerW = (layoutW - 32 - handlePx) - handlePx; // 左レール折りたたみ時（左32px固定）
      const curRatio = Number(innerSplit.ratio);
      if (Number.isFinite(expandedRootRatio) && expandedRootRatio > 0 && expandedRootRatio < 1
          && Number.isFinite(curRatio) && expandedInnerW > 0 && collapsedInnerW > 0) {
        if (targetNode.collapsed) {
          // 展開→折りたたみ: 広がったコンテンツ幅でも右サイドバーのピクセル幅を維持
          const rightPx = (1 - curRatio) * expandedInnerW;
          innerSplit.ratio = Math.max(0.1, Math.min(0.95, 1 - rightPx / collapsedInnerW));
        } else {
          // 折りたたみ→展開: 狭まったコンテンツ幅でも右サイドバーのピクセル幅を維持
          const rightPx = (1 - curRatio) * collapsedInnerW;
          innerSplit.ratio = Math.max(0.1, Math.min(0.95, 1 - rightPx / expandedInnerW));
        }
      }
      // 旧実装が永続化した陳腐な保存値を掃除する
      if (Object.prototype.hasOwnProperty.call(innerSplit, '_savedInnerRatio')) delete innerSplit._savedInnerRatio;
      if (otherChild !== innerSplit && Object.prototype.hasOwnProperty.call(otherChild, '_savedInnerRatio')) delete otherChild._savedInnerRatio;
    }

    if (!options?.skipRender) render();
  }

  function setNodeCollapsed(nodeId, collapsed, options) {
    const info = findNode(_root, nodeId);
    const node = info?.node || null;
    if (!node || (node.type !== 'pane' && node.type !== 'split' && node.type !== 'panelset')) return false;
    const nextCollapsed = !!collapsed;
    if (node.collapsed === nextCollapsed) {
      if (options?.activePaneId && typeof setActivePane === 'function') {
        setActivePane(options.activePaneId, { skipCallback: !!options.skipActivePaneCallback });
      }
      return true;
    }
    node.collapsed = nextCollapsed;
    // 固定レール（フォルダツリー/右サイドバー）をユーザーが明示的に閉じたことを記録する。
    // この記録がある間、ファイルを開く等に伴う付随的な revealPane では開き直さない
    // （ユーザー操作起点の reveal だけがこの記録を解除して開く）。
    if (node.meldexRole === 'left-sidebar' || node.meldexRole === 'right-sidebar') {
      if (nextCollapsed) node._userCollapsed = true;
      else delete node._userCollapsed;
    }
    _adjustSplitForCollapse(node, { skipRender: true });
    if (options?.activePaneId && typeof setActivePane === 'function') {
      setActivePane(options.activePaneId, { skipCallback: !!options.skipActivePaneCallback });
    }
    render();
    if (!options?.skipSave) saveLayout({ immediate: true });
    return true;
  }

  function renderPane(node, depth) {
    const pane = document.createElement('div');
    pane.className = 'gb-pane' + (node.id === _activePane ? ' gb-pane-active' : '') + (node.locked ? ' gb-pane-locked' : '');
    pane.dataset.paneId = node.id;
    pane.dataset.paneLocked = node.locked ? '1' : '0';
    _applyPaneRoleAttributes(pane, node);

    // タブバー
    const tabBar = document.createElement('div');
    tabBar.className = 'gb-pane-tabs';

    // ドラッグハンドル（先頭に配置）
    const dragHandle = document.createElement('span');
    dragHandle.className = 'gb-pane-drag-handle';
    dragHandle.draggable = _showFreeLayoutUi() && !node.locked;
    dragHandle.title = node.locked ? 'ロック中のパネルは移動できません' : 'ドラッグ: パネル移動 / Alt+Shift+ドラッグ: カラム移動';
    dragHandle.innerHTML = lucide('gripVertical', 12);
    const isColumnDragModifier = (event) => !!(event?.altKey && event?.shiftKey);
    let _altHeld = false;
    dragHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      _altHeld = isColumnDragModifier(e);
    });
    dragHandle.addEventListener('mousedown', (e) => { _altHeld = isColumnDragModifier(e); });
    dragHandle.addEventListener('dragstart', (e) => {
      if (!_showFreeLayoutUi()) {
        e.preventDefault();
        return;
      }
      if (node.locked) {
        e.preventDefault();
        return;
      }
      const useColumn = _altHeld || isColumnDragModifier(e);
      _altHeld = false;
      if (useColumn) {
        const columnId = _findColumnAncestorId(node.id);
        if (columnId) {
          e.dataTransfer.setData('application/x-gb-column', JSON.stringify({ nodeId: columnId }));
          e.dataTransfer.effectAllowed = 'move';
          return;
        }
      }
      e.dataTransfer.setData('application/x-gb-pane', JSON.stringify({ paneId: node.id }));
      e.dataTransfer.effectAllowed = 'move';
    });
    // ドロップが受理されなかった場合（ESC キャンセルや無効ゾーン落下）でも
    // 残存しがちなドロップインジケータを確実に消す
    dragHandle.addEventListener('dragend', () => {
      if (typeof GBDocking !== 'undefined' && typeof GBDocking.hideIndicator === 'function') {
        GBDocking.hideIndicator();
      }
    });
    if (_showFreeLayoutUi()) tabBar.appendChild(dragHandle);

    const navCtrls = document.createElement('span');
    navCtrls.className = 'gb-pane-nav-ctrls';
    navCtrls.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'gb-pane-nav-btn gb-pane-nav-back';
    backBtn.dataset.e2eId = `pane-${node.id}-nav-back`;
    backBtn.title = '戻る (Alt+←) / 右クリックで履歴';
    backBtn.innerHTML = lucide('arrowLeft', 18);
    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof navBack === 'function') navBack(node.id);
    });
    backBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof showPaneNavHistoryDropdown === 'function') showPaneNavHistoryDropdown(e, node.id, 'back');
    });
    const forwardBtn = document.createElement('button');
    forwardBtn.type = 'button';
    forwardBtn.className = 'gb-pane-nav-btn gb-pane-nav-forward';
    forwardBtn.dataset.e2eId = `pane-${node.id}-nav-forward`;
    forwardBtn.title = '進む (Alt+→) / 右クリックで履歴';
    forwardBtn.innerHTML = lucide('arrowRight', 18);
    forwardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof navForward === 'function') navForward(node.id);
    });
    forwardBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof showPaneNavHistoryDropdown === 'function') showPaneNavHistoryDropdown(e, node.id, 'forward');
    });
    navCtrls.appendChild(backBtn);
    navCtrls.appendChild(forwardBtn);
    tabBar.appendChild(navCtrls);

    // 折り畳み状態の class 適用（ボタン本体は border 上のホバーボタンに移行）
    const hasSplit = !!findParent(_root, node.id);
    if (hasSplit) {
      const isCollapsed = !!node.collapsed;
      const parentSplit = findParent(_root, node.id);
      const splitDir = parentSplit ? parentSplit.node.direction : 'horizontal';
      if (isCollapsed) {
        pane.classList.add('gb-pane-collapsed');
        pane.classList.add('gb-pane-collapsed-' + splitDir);
      }
    }

    // パネル操作: 「…」ボタン1つに集約し、ドロップダウンメニューで表示
    // （以前は ロック/最小化/最大化/閉じる の4ボタンが横並びだった）
    const ctrls = document.createElement('span');
    ctrls.className = 'gb-pane-ctrls';
    const showPaneActionsButton = _shouldShowPaneActionsButton(node);
    const mobileMainTabActions = _isMobileMainTabActionsButton(node);
    if (mobileMainTabActions) ctrls.classList.add('gb-pane-mobile-main-tab-ctrls');
    ctrls.addEventListener('pointerdown', (e) => { e.stopPropagation(); });

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'gb-pane-btn gb-pane-more';
    if (mobileMainTabActions) moreBtn.classList.add('gb-pane-mobile-tab-more');
    moreBtn.dataset.e2eId = `pane-${node.id}-actions`;
    const activeTabTitle = node.tabs?.[node.activeTabIndex]?.label || 'タブ';
    moreBtn.title = mobileMainTabActions ? activeTabTitle : 'パネル操作';
    moreBtn.setAttribute('aria-label', mobileMainTabActions ? `${activeTabTitle}のタブ操作` : moreBtn.title);
    moreBtn.setAttribute('aria-haspopup', 'menu');
    moreBtn.setAttribute('aria-expanded', 'false');
    moreBtn.innerHTML = lucide('moreHorizontal', 12);
    // pointerdown で即反応（span だと click が拾われないケースがあったため button に変更）
    moreBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      _showPaneMoreButtonMenu(e, node);
    });
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    if (showPaneActionsButton) ctrls.appendChild(moreBtn);

    // タブ群のスクロールコンテナ: タブが多すぎても右端の ctrls が切れないよう、
    // タブ部分だけを横スクロール可能な中間コンテナに入れる
    const tabsScroll = document.createElement('div');
    tabsScroll.className = 'gb-pane-tabs-scroll';

    // タブ
    if (node.tabs && node.tabs.length > 0) {
      node.tabs.forEach((tab, i) => {
        const tabEl = document.createElement('div');
        tabEl.className = 'gb-tab' + (i === node.activeTabIndex ? ' active' : '');
        tabEl.dataset.tabId = tab.id;
        tabEl.dataset.tabTitle = tab.label || 'タブ';
        tabEl.dataset.e2eId = `pane-${node.id}-tab-${tab.id}`;
        const canReorderMainTab = _canReorderMainPaneTabs(node);
        tabEl.draggable = _showFreeLayoutUi() || canReorderMainTab;
        tabEl.tabIndex = -1;
        tabEl.setAttribute('aria-haspopup', 'menu');
        tabEl.setAttribute('aria-expanded', 'false');

        const iconSpan = document.createElement('span');
        iconSpan.className = 'gb-tab-icon';
        if (typeof lucide === 'function') iconSpan.innerHTML = lucide(tab.icon || 'page', 14);
        tabEl.appendChild(iconSpan);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'gb-tab-label';
        labelSpan.textContent = tab.label || '';
        tabEl.appendChild(labelSpan);

        if (_isMainPaneNode(node) && !node.collapsed) {
          const tabMoreBtn = document.createElement('button');
          tabMoreBtn.type = 'button';
          tabMoreBtn.className = 'gb-tab-more';
          tabMoreBtn.dataset.e2eId = `pane-${node.id}-tab-${tab.id}-actions`;
          tabMoreBtn.title = tab.label || 'タブ';
          tabMoreBtn.setAttribute('aria-label', `${tab.label || 'タブ'}のタブ操作`);
          tabMoreBtn.setAttribute('aria-haspopup', 'menu');
          tabMoreBtn.setAttribute('aria-expanded', 'false');
          tabMoreBtn.draggable = false;
          tabMoreBtn.innerHTML = lucide('moreHorizontal', 14);
          tabMoreBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
          });
          tabMoreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            _showTabContextMenu(e, node.id, tab);
          });
          tabEl.appendChild(tabMoreBtn);
        }

        // 閉じる操作は右クリックメニュー経由に統一（タブ内に × ボタンは置かない）

        tabEl.addEventListener('click', (e) => {
          // 折り畳み中ならクリックで展開 + クリックしたタブをアクティブ化
          if (node.collapsed) {
            node.collapsed = false;
            // クリックしたタブをアクティブに
            const tabIdx = node.tabs.findIndex(t => t.id === tab.id);
            if (tabIdx >= 0) node.activeTabIndex = tabIdx;
            _adjustSplitForCollapse(node);
            saveLayout();
            return;
          }
          GBTabs.activateTab(node.id, tab.id, { preserveActivePane: _isPassivePaneTab(tab, node) });
        });

        // ファイルをドラッグしたまま既存タブにホバーすると、
        // ドロップ先アプリを確認できるように切り替える。ドロップ自体は
        // 切り替え後のノート/ボード/フォルダ等の既存ハンドラに委ねる。
        tabEl.addEventListener('dragover', (e) => {
          if (!(typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(e, 'node'))
              && !Array.from(e.dataTransfer?.types || []).includes('application/x-meldex-node')) return;
          if (node.tabs[node.activeTabIndex]?.id === tab.id) return;
          e.preventDefault();
          if (_meldexNodeHoverTabId === tab.id && _meldexNodeHoverTimer) return;
          if (_meldexNodeHoverTimer) clearTimeout(_meldexNodeHoverTimer);
          _meldexNodeHoverTabId = tab.id;
          _meldexNodeHoverTimer = setTimeout(() => {
            _meldexNodeHoverTimer = null;
            _meldexNodeHoverTabId = '';
            GBTabs.activateTab(node.id, tab.id, { preserveActivePane: _isPassivePaneTab(tab, node) });
          }, 450);
        });
        tabEl.addEventListener('dragleave', (e) => {
          if (tabEl.contains(e.relatedTarget)) return;
          if (_meldexNodeHoverTabId !== tab.id) return;
          if (_meldexNodeHoverTimer) clearTimeout(_meldexNodeHoverTimer);
          _meldexNodeHoverTimer = null;
          _meldexNodeHoverTabId = '';
        });

        // 右クリックメニュー（デスクトップ）＋ 長押しで同メニュー（タッチ）
        tabEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          _showTabContextMenu(e, node.id, tab);
        });
        if (typeof addLongPressHandler === 'function') {
          addLongPressHandler(tabEl, (e) => _showTabContextMenu(e, node.id, tab));
        }

        // D&D
        let tabDragMode = '';
        tabEl.addEventListener('dragstart', (e) => {
          if (e.target?.closest?.('.gb-tab-more')) {
            e.preventDefault();
            return;
          }
          if (!_showFreeLayoutUi() && !canReorderMainTab) {
            e.preventDefault();
            return;
          }
          tabDragMode = _showFreeLayoutUi() ? 'free' : 'main-reorder';
          if (tabDragMode === 'main-reorder') {
            e.dataTransfer.setData(MAIN_TAB_REORDER_MIME, JSON.stringify({ tabId: tab.id, paneId: node.id }));
            e.dataTransfer.effectAllowed = 'move';
            if (typeof setLowOpacityDragImage === 'function') setLowOpacityDragImage(e, tabEl, 0.35);
            tabEl.classList.add('dragging');
            window._gbTabDragSrcPaneId = node.id;
            return;
          }
          e.dataTransfer.setData('application/x-gb-tab', JSON.stringify({ tabId: tab.id, paneId: node.id }));
          e.dataTransfer.effectAllowed = 'move';
          // text/uri-list を併せて入れておくと OS シェル側で「URL の D&D」として
          // 認識され、窓外ドロップ時の赤い禁止カーソルが出にくい。
          // path 無しの tool タブはポップアウト不可のため uri-list もセットしない
          // （空の relative URL から Meldex トップ URL が生成されるのを防ぐ）。
          try {
            if (tab.path && typeof buildSingleTabWindowUrl === 'function') {
              const rel = buildSingleTabWindowUrl({ name: tab.label, path: tab.path, type: tab.type });
              if (rel) {
                const uri = new URL(rel, location.origin).toString();
                e.dataTransfer.setData('text/uri-list', uri);
              }
            }
            e.dataTransfer.setData('text/plain', tab.label || '');
          } catch {}
          // ドロップインジケータが隠れないよう、プレビュー画像を低不透明度 + カーソルから離す
          if (typeof setLowOpacityDragImage === 'function') setLowOpacityDragImage(e, tabEl, 0.35);
          tabEl.classList.add('dragging');
          window._gbTabDragSrcPaneId = node.id;
        });
        tabEl.addEventListener('dragend', (e) => {
          if (_meldexNodeHoverTimer) clearTimeout(_meldexNodeHoverTimer);
          _meldexNodeHoverTimer = null;
          _meldexNodeHoverTabId = '';
          tabEl.classList.remove('dragging');
          window._gbTabDragSrcPaneId = '';
          // 全 tab bar の drop マーカーを念のためクリア (Esc キャンセル等の漏れ対策)
          document.querySelectorAll('.gb-tab.gb-tab-drop-before, .gb-tab.gb-tab-drop-after')
            .forEach(t => t.classList.remove('gb-tab-drop-before', 'gb-tab-drop-after'));
          if (tabDragMode === 'main-reorder') {
            tabDragMode = '';
            return;
          }
          tabDragMode = '';
          // ウィンドウ外にドロップ: 共通ヘルパーで単一窓として開く
          if (typeof isDragDroppedOutsideWindow !== 'function' || !isDragDroppedOutsideWindow(e)) return;
          // path 無しの tool タブは popout できないので、元タブも閉じない
          const opened = (typeof openItemsAsSingleTabWindows === 'function')
            ? openItemsAsSingleTabWindows([{ name: tab.label, path: tab.path, type: tab.type }])
            : 0;
          if (opened > 0) GBTabs.closeTab(node.id, tab.id);
        });

        tabsScroll.appendChild(tabEl);
      });
    }

    // 新規パネル追加ボタン（最後のタブの次に配置。パネルメニューと同じ項目を開く）
    const addTabBtn = document.createElement('button');
    addTabBtn.type = 'button';
    addTabBtn.className = 'gb-pane-btn gb-pane-add-tab';
    addTabBtn.dataset.e2eId = `pane-${node.id}-add-tab`;
    addTabBtn.title = node.locked ? 'ロック中のパネルには追加できません' : '新しいパネルを追加';
    addTabBtn.disabled = !!node.locked;
    addTabBtn.setAttribute('aria-disabled', node.locked ? 'true' : 'false');
    addTabBtn.innerHTML = lucide('plus', 12);
    addTabBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    addTabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (node.locked) {
        e.preventDefault();
        if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
        return;
      }
      // ＋ボタンを押したペインをアクティブにしてからメニューを開く
      // → パネルメニュー経由の追加先がこのペインになる
      if (typeof setActivePane === 'function') setActivePane(node.id);
      if (typeof showPanelMenu === 'function') showPanelMenu(e, { paneId: node.id });
    });
    if (!_isSidebarPaneNode(node)) tabsScroll.appendChild(addTabBtn);

    tabBar.appendChild(tabsScroll);
    if (showPaneActionsButton) tabBar.appendChild(ctrls);

    // タブバーの D&D 並び替え（同ペイン内のタブを並び替える）
    // 別ペインからのタブ移動は docking システム側が処理する
    // インジケータは DOM 要素ではなく target タブ自身の box-shadow inset で描く
    // (DOM 挿入だと bar のレイアウトが変動するため)
    const _clearDropMarkers = () => {
      tabBar.querySelectorAll('.gb-tab.gb-tab-drop-before, .gb-tab.gb-tab-drop-after')
        .forEach(t => t.classList.remove('gb-tab-drop-before', 'gb-tab-drop-after'));
    };
    tabBar.addEventListener('dragover', (e) => {
      const types = e.dataTransfer.types;
      const isMainReorder = types.includes(MAIN_TAB_REORDER_MIME);
      const isTab = types.includes('application/x-gb-tab');
      const isNode = types.includes('application/x-meldex-node')
        || (typeof MeldexDnD !== 'undefined' && MeldexDnD.hasDropKind(e, 'node'));
      if (!isMainReorder && ((!isTab || !_showFreeLayoutUi()) && (!isNode || !_canAcceptNodeDropOnTabBar(node)))) return;
      if (isMainReorder) {
        if (!_canReorderMainPaneTabs(node) || window._gbTabDragSrcPaneId !== node.id) return;
      }
      if (node.locked) {
        if (isTab) {
          const srcPaneId = window._gbTabDragSrcPaneId || '';
          if (srcPaneId && srcPaneId !== node.id) return;
        } else if (isNode) {
          return; // ロックペインにはフォルダツリーからも追加不可
        }
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = isNode && !isMainReorder ? 'copy' : 'move';
      // ペイン分割インジケータが表示中なら消す
      if (typeof GBDocking !== 'undefined') GBDocking.hideIndicator();
      _clearDropMarkers();
      const tabEls = Array.from(tabsScroll.querySelectorAll(':scope > .gb-tab'));
      if (!tabEls.length) return; // 空ペインは drop ハンドラ側で末尾挿入
      // カーソル位置から挿入位置を決定
      let insertBeforeEl = null;
      for (const el of tabEls) {
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) { insertBeforeEl = el; break; }
      }
      if (insertBeforeEl) {
        insertBeforeEl.classList.add('gb-tab-drop-before');
      } else {
        tabEls[tabEls.length - 1].classList.add('gb-tab-drop-after');
      }
    });
    tabBar.addEventListener('dragleave', (e) => {
      // 子要素間の dragleave で消さないように、related target が tabBar 内かチェック
      if (tabBar.contains(e.relatedTarget)) return;
      _clearDropMarkers();
    });
    tabBar.addEventListener('drop', async (e) => {
      const mainReorderData = e.dataTransfer.getData(MAIN_TAB_REORDER_MIME);
      const tabData = e.dataTransfer.getData('application/x-gb-tab');
      const hasNode = typeof MeldexDnD !== 'undefined'
        ? MeldexDnD.hasDropKind(e, 'node')
        : !!e.dataTransfer.getData('application/x-meldex-node');
      if (!mainReorderData && ((!tabData || !_showFreeLayoutUi()) && (!hasNode || !_canAcceptNodeDropOnTabBar(node)))) return;
      e.preventDefault();
      e.stopPropagation();
      _clearDropMarkers();
      // 挿入位置を計算 (タブ並び替えの安全性のため ID ベースで計算)
      const tabEls = Array.from(tabsScroll.querySelectorAll(':scope > .gb-tab'));
      let insertBeforeTabId = null;
      for (const el of tabEls) {
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) { insertBeforeTabId = el.dataset.tabId; break; }
      }
      const _resolveInsertIndex = () => {
        if (insertBeforeTabId) {
          const i = node.tabs.findIndex(t => t.id === insertBeforeTabId);
          return i < 0 ? node.tabs.length : i;
        }
        return node.tabs.length;
      };
      // === 固定レイアウトのメインパネル内だけで使う並べ替え ===
      if (mainReorderData) {
        let data;
        try { data = JSON.parse(mainReorderData); } catch (err) { return; }
        if (!_canReorderMainPaneTabs(node) || data.paneId !== node.id || !data.tabId) return;
        const insertIndex = _resolveInsertIndex();
        const fromIdx = node.tabs.findIndex(t => t.id === data.tabId);
        if (fromIdx < 0 || insertIndex === fromIdx || insertIndex === fromIdx + 1) return;
        GBTabs.moveTab(node.id, data.tabId, node.id, insertIndex);
        return;
      }
      // === パネルタブの D&D（既存処理） ===
      if (tabData) {
        let data;
        try { data = JSON.parse(tabData); } catch (err) { return; }
        if (!data.tabId || !data.paneId) return;
        if (node.locked && data.paneId !== node.id) {
          if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
          return;
        }
        const insertIndex = _resolveInsertIndex();
        // 同ペイン内: 並び替え。別ペイン: 指定位置に挿入
        if (data.paneId === node.id) {
          const fromIdx = node.tabs.findIndex(t => t.id === data.tabId);
          if (fromIdx < 0) return;
          if (insertIndex === fromIdx || insertIndex === fromIdx + 1) return; // 同位置
        }
        GBTabs.moveTab(data.paneId, data.tabId, node.id, insertIndex);
        return;
      }
      // === フォルダツリーからのファイル D&D（ペインのタブとして開く） ===
      if (node.locked) {
        if (typeof showStatus === 'function') showStatus('ロック中のパネルには新しいタブを追加できません', true);
        return;
      }
      const resolved = typeof MeldexDnD !== 'undefined' ? await MeldexDnD.resolveDropData(e, 'node') : null;
      let payload = resolved?.payload || null;
      if (!payload) {
        try { payload = JSON.parse(e.dataTransfer.getData('application/x-meldex-node')); } catch (err) { return; }
      }
      const items = Array.isArray(payload?.items) && payload.items.length
        ? payload.items
        : [{ name: payload?.name, path: payload?.path, type: payload?.type }];
      let insertIndex = _resolveInsertIndex();
      let openedFromDrop = 0;
      items.forEach((it) => {
        if (!it || !it.path) return;
        const normalizedTarget = typeof MeldexDnD !== 'undefined'
          ? MeldexDnD.normalizeOpenTarget?.(it)
          : null;
        const openType = normalizedTarget?.type || (typeof _normalizeOpenTypeForNav === 'function'
          ? _normalizeOpenTypeForNav(it.type)
          : (it.type === 'database' ? 'pivot' : (it.type === 'scenario' ? 'scriptnote' : (it.type || 'page'))));
        const openLabel = normalizedTarget?.label || it.name || '';
        const openState = normalizedTarget?.state || null;
        // addTab は dedup / ロックフォールバックで「別ペインへ移譲」する場合がある。
        // そのケースを node.tabs.length の差分で検出し、このペインに新規追加された時だけ
        // 挿入位置補正と insertIndex 前進を行う。
        const lenBefore = node.tabs.length;
        const tabId = GBTabs.addTab(node.id, openLabel, openType, it.path, openState, { preferTargetPane: true });
        if (!tabId) return;
        openedFromDrop += 1;
        const addedHere = node.tabs.length > lenBefore
          && node.tabs[node.tabs.length - 1]?.id === tabId;
        if (addedHere) {
          const endIdx = node.tabs.length - 1;
          if (endIdx > insertIndex) {
            GBTabs.moveTab(node.id, tabId, node.id, insertIndex);
          }
          insertIndex += 1;
        }
        if (typeof navOpen === 'function') {
          // skipAutoAppLayout は旧アプリ別レイアウト時代の互換オプション。
          // 現在は単一レイアウトなので、呼び出し側へ渡しても配置は変更しない。
          navOpen(
            normalizedTarget || { type: openType, label: openLabel, path: it.path, state: openState || {} },
            { skipAutoAppLayout: true }
