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

  // === データモデル ===
  function createPaneNode(id, tabs, activeTabIndex) {
    return {
      type: 'pane',
      id: id || ('pane-' + (++_paneIdCounter)),
      tabs: tabs || [],
      activeTabIndex: activeTabIndex != null ? activeTabIndex : -1,
      locked: false,
      navHistory: [],
      navIndex: -1,
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
            return migrateLayoutToB(saved);
          } catch (err) {
            // マイグレーション失敗時はバックアップを維持し、デフォルトレイアウトを返す
            try { localStorage.setItem('gb:layout:migration-error', String(err?.message || err)); } catch (e) {}
            return null;
          }
        }
        return saved;
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
        // 詳細パネル → オプションパネル リネーム (v0.5.255/0.5.263) 以前のレイアウトに残る
        // 旧ラベル '詳細' / 旧アイコン 'info' を現行値に置換する
        if (tab.type === 'detail') {
          if (tab.label === '詳細') tab.label = 'オプション';
          if (tab.icon === 'info') tab.icon = 'panelRight';
        }
        // タブピン留め機能は廃止されたため、既存レイアウト JSON の pinned プロパティを除去
        if ('pinned' in tab) delete tab.pinned;
      });
      if (!Number.isInteger(node.activeTabIndex)) node.activeTabIndex = node.tabs.length ? 0 : -1;
      if (!Array.isArray(node.navHistory)) node.navHistory = [];
      if (!Number.isInteger(node.navIndex)) node.navIndex = node.navHistory.length ? node.navHistory.length - 1 : -1;
      if (node.navIndex >= node.navHistory.length) node.navIndex = node.navHistory.length - 1;
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
      dragHandle.draggable = true;
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
      bar.appendChild(dragHandle);

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
    if (!options?.skipRender) render();
  }

  function renderPane(node, depth) {
    const pane = document.createElement('div');
    pane.className = 'gb-pane' + (node.id === _activePane ? ' gb-pane-active' : '') + (node.locked ? ' gb-pane-locked' : '');
    pane.dataset.paneId = node.id;
    pane.dataset.paneLocked = node.locked ? '1' : '0';

    // タブバー
    const tabBar = document.createElement('div');
    tabBar.className = 'gb-pane-tabs';

    // ドラッグハンドル（先頭に配置）
    const dragHandle = document.createElement('span');
    dragHandle.className = 'gb-pane-drag-handle';
    dragHandle.draggable = !node.locked;
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
    tabBar.appendChild(dragHandle);

    const navCtrls = document.createElement('span');
    navCtrls.className = 'gb-pane-nav-ctrls';
    navCtrls.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'gb-pane-nav-btn gb-pane-nav-back';
    backBtn.dataset.e2eId = `pane-${node.id}-nav-back`;
    backBtn.title = '戻る履歴';
    backBtn.innerHTML = lucide('arrowLeft', 12);
    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof showPaneNavHistoryDropdown === 'function') showPaneNavHistoryDropdown(e, node.id, 'back');
    });
    const forwardBtn = document.createElement('button');
    forwardBtn.type = 'button';
    forwardBtn.className = 'gb-pane-nav-btn gb-pane-nav-forward';
    forwardBtn.dataset.e2eId = `pane-${node.id}-nav-forward`;
    forwardBtn.title = '進む履歴';
    forwardBtn.innerHTML = lucide('arrowRight', 12);
    forwardBtn.addEventListener('click', (e) => {
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
    ctrls.addEventListener('pointerdown', (e) => { e.stopPropagation(); });

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'gb-pane-btn gb-pane-more';
    moreBtn.dataset.e2eId = `pane-${node.id}-actions`;
    moreBtn.title = 'パネル操作';
    moreBtn.innerHTML = lucide('moreHorizontal', 12);
    // pointerdown で即反応（span だと click が拾われないケースがあったため button に変更）
    moreBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      _showPaneActionsMenu(e, node);
    });
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    ctrls.appendChild(moreBtn);

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
        tabEl.dataset.e2eId = `pane-${node.id}-tab-${tab.id}`;
        tabEl.draggable = true;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'gb-tab-icon';
        if (typeof lucide === 'function') iconSpan.innerHTML = lucide(tab.icon || 'page', 14);
        tabEl.appendChild(iconSpan);

        const labelSpan = document.createElement('span');
        labelSpan.className = 'gb-tab-label';
        labelSpan.textContent = tab.label || '';
        tabEl.appendChild(labelSpan);

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
          _showTabContextMenu(e, node.id, tab);
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
        tabEl.addEventListener('dragstart', (e) => {
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
          tabEl.classList.remove('dragging');
          window._gbTabDragSrcPaneId = '';
          // 全 tab bar の drop マーカーを念のためクリア (Esc キャンセル等の漏れ対策)
          document.querySelectorAll('.gb-tab.gb-tab-drop-before, .gb-tab.gb-tab-drop-after')
            .forEach(t => t.classList.remove('gb-tab-drop-before', 'gb-tab-drop-after'));
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
    tabsScroll.appendChild(addTabBtn);

    tabBar.appendChild(tabsScroll);
    tabBar.appendChild(ctrls);

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
      const isTab = types.includes('application/x-gb-tab');
      const isNode = types.includes('application/x-meldex-node');
      if (!isTab && !isNode) return;
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
      e.dataTransfer.dropEffect = isNode ? 'copy' : 'move';
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
    tabBar.addEventListener('drop', (e) => {
      const tabData = e.dataTransfer.getData('application/x-gb-tab');
      const nodeData = e.dataTransfer.getData('application/x-meldex-node');
      if (!tabData && !nodeData) return;
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
      let payload;
      try { payload = JSON.parse(nodeData); } catch (err) { return; }
      const items = Array.isArray(payload?.items) && payload.items.length
        ? payload.items
        : [{ name: payload?.name, path: payload?.path, type: payload?.type }];
      let insertIndex = _resolveInsertIndex();
      items.forEach((it) => {
        if (!it || !it.path) return;
        const openType = typeof _normalizeOpenTypeForNav === 'function'
          ? _normalizeOpenTypeForNav(it.type)
          : (it.type === 'database' ? 'pivot' : (it.type === 'scenario' ? 'scriptnote' : (it.type || 'page')));
        // addTab は dedup / ロックフォールバックで「別ペインへ移譲」する場合がある。
        // そのケースを node.tabs.length の差分で検出し、このペインに新規追加された時だけ
        // 挿入位置補正と insertIndex 前進を行う。
        const lenBefore = node.tabs.length;
        const tabId = GBTabs.addTab(node.id, it.name || '', openType, it.path);
        if (!tabId) return;
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
            { type: openType, label: it.name || '', path: it.path },
            { skipAutoAppLayout: true }
