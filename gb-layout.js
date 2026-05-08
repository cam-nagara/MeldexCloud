/* gb-layout.js: flattened split script for static cloud hosting. */
/* Source chunk: gb-layout.part01.js */
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
    // GBPanelSet と同形式（panelset-<timestamp>-<counter>）で生成し、
    // 既存 panelset/group との ID 衝突を回避
    const ts = Date.now().toString(36);
    const n1 = ++_paneIdCounter;
    const n2 = ++_paneIdCounter;
    const groupId = 'group-' + ts + '-' + n2;
    return {
      type: 'panelset',
      id: 'panelset-' + ts + '-' + n1,
      groups: [{ id: groupId, root: node }],
      activeGroupId: groupId,
      collapsed: false,
    };
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

  function _needsBMigration(node) {
    if (!node) return false;
    if (node.type === 'split' && node.direction === 'horizontal' && Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child && child.type !== 'panelset') return true;
        if (child && _needsBMigration(child)) return true;
      }
      return false;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
      return node.children.some(_needsBMigration);
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      return node.groups.some(g => g?.root && _needsBMigration(g.root));
    }
    // ルート単独の pane → 要マイグレーション
    if (node.type === 'pane') return true;
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

    // 通常列はラッパーなしで直接レンダリング（B案化前のレイアウトへのフォールバック）
    if (!isPanelset) return renderNode(node, depth);

    // Phase 3: renderDock に一本化（collapsed ⇔ 展開 の切替はノード内の `collapsed` で管理）
    if (typeof GBPanelSet?.renderDock === 'function') {
      return GBPanelSet.renderDock(node, depth);
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

    if (typeof GBPanelSet?.renderPanelSetTabbar === 'function') {
      col.appendChild(GBPanelSet.renderPanelSetTabbar(node));
    }
    const body = document.createElement('div');
    body.className = 'gb-column-body';
    if (typeof GBPanelSet?.renderActiveGroupContent === 'function') {
      body.appendChild(GBPanelSet.renderActiveGroupContent(node, depth));
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
    let _altHeld = false;
    dragHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      _altHeld = e.altKey || e.shiftKey;
    });
    dragHandle.addEventListener('mousedown', (e) => { _altHeld = e.altKey || e.shiftKey; });
    dragHandle.addEventListener('dragstart', (e) => {
      if (node.locked) {
        e.preventDefault();
        return;
      }
      const useColumn = _altHeld || e.altKey || e.shiftKey;
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
        const openType = it.type === 'database' ? 'pivot' : (it.type || 'page');
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
          );
        }
      });
    });

    pane.appendChild(tabBar);

    // コンテンツエリア
    const content = document.createElement('div');
    content.className = 'gb-pane-content';
    pane.appendChild(content);

    // ペインクリックでアクティブ化。ナビペイン本文の通常クリックは作業ペインを保持する。
    // 通常の行クリック等は click 配信が終わるまで同期副作用を遅延し、
    // 同一クリック内でコンテンツDOMが差し替わらないようにする。
    pane.addEventListener('pointerdown', (e) => {
      if (e.button === 0) _blurFocusedChatInputForWorkPanePointer(node, e.target);
      if (e.button === 0 && _isPassivePaneActiveTab(node) && e.target.closest('.gb-pane-content, .gb-pane-tabs')) return;
      if (_activePane === node.id) return;
      if (e.target.closest('.gb-legacy-snapshot-host')) {
        _activatePaneAfterCurrentPointerClick(node.id);
        return;
      }
      if (e.button === 0 && _isPaneWorkContentPointerTarget(e.target)) {
        _activatePaneAfterCurrentPointerClick(node.id);
        return;
      }
      if (e.button === 0 && _isPaneInteractivePointerTarget(e.target)) {
        if (e.target.closest('.gb-pane-content')) {
          _activatePaneAfterCurrentPointerClick(node.id);
          return;
        }
        setActivePane(node.id, { skipCallback: true });
        return;
      }
      if (e.button === 0 && _shouldPreserveActivePaneForNavContentPointer(node, e.target)) return;
      if (e.button !== 0) { setActivePane(node.id, { sync: true }); return; }
      _activatePaneAfterCurrentPointerClick(node.id);
    }, true);

    // ペインマップに登録
    _paneMap[node.id] = { node, el: pane, contentEl: content };
    _updatePaneNavButtons(node.id);

    // タブ群が横方向に溢れたらラベルを隠してアイコン化
    // compact 化してもなお溢れる場合は tabsScroll が横スクロールで対応
    if (typeof ResizeObserver === 'function') {
      const updateCompact = () => {
        tabBar.classList.remove('gb-tabs-compact');
        // class 変更後のレイアウトを反映させるため強制 reflow
        void tabsScroll.offsetWidth;
        if (tabsScroll.scrollWidth > tabsScroll.clientWidth + 1) {
          tabBar.classList.add('gb-tabs-compact');
        }
      };
      const ro = new ResizeObserver(updateCompact);
      ro.observe(tabsScroll);
      _paneMap[node.id].observer = ro;
    }

    return pane;
  }

  function refreshPaneTabs(paneId) {
    if (!_layoutEl || !paneId) return false;
    if (_isMobileLayout() || _maximizedPaneId) return false;
    const currentInfo = _paneMap[paneId];
    const currentPaneEl = currentInfo?.el;
    const currentContentEl = currentInfo?.contentEl;
    if (!currentPaneEl || !currentContentEl || !currentPaneEl.isConnected) return false;
    const found = findNode(_root, paneId);
    const node = found?.node;
    if (!node || node.type !== 'pane') return false;
    const oldTabBar = currentPaneEl.querySelector(':scope > .gb-pane-tabs');
    if (!oldTabBar) return false;

    if (currentInfo.observer && typeof currentInfo.observer.disconnect === 'function') {
      currentInfo.observer.disconnect();
    }
    const renderedPane = renderPane(node, 0);
    const renderedInfo = _paneMap[paneId] || {};
    const newTabBar = renderedPane.querySelector(':scope > .gb-pane-tabs');
    if (!newTabBar) {
      _paneMap[paneId] = currentInfo;
      return false;
    }

    currentPaneEl.className = renderedPane.className;
    currentPaneEl.dataset.paneId = renderedPane.dataset.paneId || paneId;
    currentPaneEl.dataset.paneLocked = renderedPane.dataset.paneLocked || (node.locked ? '1' : '0');
    oldTabBar.replaceWith(newTabBar);
    _paneMap[paneId] = {
      ...renderedInfo,
      node,
      el: currentPaneEl,
      contentEl: currentContentEl,
      observer: renderedInfo.observer,
    };
    _updatePaneNavButtons(paneId);
    if (typeof replaceIcons === 'function') replaceIcons(currentPaneEl);
    return true;
  }


/* Source chunk: gb-layout.part02.js */
/* gb-layout.part02.js */
  function _updatePaneNavButtons(paneId) {
    const paneInfo = _paneMap[paneId];
    const paneNode = paneInfo?.node || findNode(_root, paneId)?.node;
    const history = Array.isArray(paneNode?.navHistory) ? paneNode.navHistory : [];
    const navIndex = Number.isInteger(paneNode?.navIndex) ? paneNode.navIndex : (history.length ? history.length - 1 : -1);
    const backBtn = paneInfo?.el?.querySelector('.gb-pane-nav-back');
    const forwardBtn = paneInfo?.el?.querySelector('.gb-pane-nav-forward');
    const navCtrls = paneInfo?.el?.querySelector('.gb-pane-nav-ctrls');
    // 戻る/進むは遷移先が存在する場合のみ表示（履歴がない時は非表示で幅を節約）
    const backHidden = navIndex <= 0;
    const forwardHidden = navIndex < 0 || navIndex >= history.length - 1;
    if (backBtn) {
      backBtn.disabled = backHidden;
      backBtn.style.display = backHidden ? 'none' : '';
    }
    if (forwardBtn) {
      forwardBtn.disabled = forwardHidden;
      forwardBtn.style.display = forwardHidden ? 'none' : '';
    }
    if (navCtrls) {
      navCtrls.style.display = (backHidden && forwardHidden) ? 'none' : '';
    }
  }

  // 折りたたみバー内にアイコンを並べる。
  // - 通常 split: 配下の各 pane のすべてのタブのアイコンを順番通りに表示
  // - panelset: 各グループのアイコン（GBPanelSet.collectGroupTabTypes の最初の type）を縦並び表示
  function _appendCollapsedIcons(bar, node, onClick) {
    const addIcon = (iconName, title, onClickInner) => {
      const icon = document.createElement('span');
      icon.className = 'gb-split-collapsed-icon';
      icon.title = title || '';
      icon.innerHTML = typeof lucide === 'function' ? lucide(iconName || 'page', 16) : '';
      icon.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof onClickInner === 'function') onClickInner();
      });
      bar.appendChild(icon);
      return icon;
    };
    function walk(n) {
      if (!n) return;
      if (n.type === 'panelset' && Array.isArray(n.groups)) {
        // 通常のタブバーと同じ renderGroupIconButton を流用し、縦並びで全アイコンを表示
        n.groups.forEach((g) => {
          if (!g?.root) return;
          if (typeof GBPanelSet?.renderGroupIconButton === 'function') {
            const btn = GBPanelSet.renderGroupIconButton(n, g);
            // 折りたたみ時のクリックは「グループ切替 + 展開」をまとめて 1 回の render で処理する。
            // capture 段階で stopImmediatePropagation することで、renderGroupIconButton が登録した
            // click ハンドラ (switchGroup → render) の発火を抑止する。
            btn.addEventListener('click', (e) => {
              e.stopImmediatePropagation();
              e.preventDefault();
              if (n.activeGroupId !== g.id) n.activeGroupId = g.id;
              if (typeof onClick === 'function') onClick();
            }, true);
            bar.appendChild(btn);
          } else {
            // フォールバック
            const types = (typeof GBPanelSet?.collectGroupTabTypes === 'function')
              ? GBPanelSet.collectGroupTabTypes(g.root) : [];
            const firstType = types[0] || 'page';
            const iconName = (typeof GBTabs !== 'undefined' && typeof GBTabs.tabIcon === 'function')
              ? GBTabs.tabIcon(firstType) : 'page';
            addIcon(iconName, types.join(' / ') || '(空)', () => {
              n.activeGroupId = g.id;
              if (typeof onClick === 'function') onClick();
            });
          }
        });
        return;
      }
      if (n.type === 'split' && Array.isArray(n.children)) {
        n.children.forEach(walk);
        return;
      }
      if (n.type === 'pane') {
        const tabs = Array.isArray(n.tabs) ? n.tabs : [];
        tabs.forEach((tab, idx) => {
          if (!tab) return;
          const el = addIcon(tab.icon || 'page', tab.label || tab.type, () => {
            n.activeTabIndex = idx;
            if (typeof onClick === 'function') onClick();
          });
          if (idx === n.activeTabIndex) el.classList.add('active');
        });
      }
    }
    walk(node);
  }

  function renderSplit(node, depth) {
    // splitノード自体が折り畳まれている場合: 小さなバーとして描画
    if (node.collapsed) {
      const bar = document.createElement('div');
      bar.className = 'gb-split-collapsed';
      const parentInfo = findParent(_root, node.id);
      const parentDir = parentInfo ? parentInfo.node.direction : 'horizontal';
      bar.classList.add('gb-split-collapsed-' + parentDir);

      // カラム移動用のドラッグハンドル（バー先頭に配置）
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

      // 「展開」ボタンは削除済み（境界線の◀▶ボタンで展開する）
      _appendCollapsedIcons(bar, node, () => {
        const before = captureLayoutSnapshot();
        node.collapsed = false;
        _adjustSplitForCollapse(node);
        saveLayout();
        pushLayoutHistory('レイアウト: 折りたたみ解除', before, captureLayoutSnapshot(), node.id || '');
      });
      return bar;
    }

    const split = document.createElement('div');
    split.className = 'gb-split gb-split-' + node.direction;
    split.dataset.ratio = node.ratio;
    split.dataset.splitId = node.id;

    const first = document.createElement('div');
    first.className = 'gb-split-child gb-split-first';
    const child0collapsed = node.children[0] && node.children[0].collapsed;
    const child1collapsed = node.children[1] && node.children[1].collapsed;
    if (child0collapsed) {
      // 折り畳まれた子は固定32pxにし、flex-growなし
      if (node.direction === 'horizontal') { first.style.width = '32px'; first.style.flexShrink = '0'; }
      else { first.style.height = '32px'; first.style.flexShrink = '0'; }
    } else if (child1collapsed) {
      // 相手が折り畳まれているなら自分がflex: 1で残り全部
      first.style.flex = '1';
    } else {
      const pct = (node.ratio * 100).toFixed(2);
      if (node.direction === 'horizontal') first.style.width = pct + '%';
      else first.style.height = pct + '%';
    }
    // 水平スプリットの各子 = 「列」としてラップ。垂直スプリットはそのまま再帰。
    first.appendChild(node.direction === 'horizontal'
      ? renderAsColumn(node.children[0], depth + 1)
      : renderNode(node.children[0], depth + 1));

    const handle = document.createElement('div');
    handle.className = 'gb-split-handle';
    handle.dataset.e2eId = `split-${node.id}-resize`;
    handle.dataset.splitId = node.id || '';
    _setupResizeHandle(handle, node, split, first);
    _setSplitHandleAnchor(handle, node.direction);
    _bindSplitHandleAnchor(handle, node.direction);
    handle.style.position = 'relative';
    // ハンドルから視覚的に最も近いパネル/サブツリーを見つけるヘルパー
    // - subtree: 探索対象 (split or pane)
    // - splitDir: 親 split の方向 ('horizontal'/'vertical')
    // - edge: 'last' (右/下端) or 'first' (左/上端)
    // 親 split と同じ方向の split ノードは更に潜って境界に最も近いパネルへ。
    // 異なる方向の split ノードはそれ自体を 1 単位として返す（縦分割は丸ごと 1 列扱い）。
    const _findAdjacentTarget = (subtree, splitDir, edge) => {
      if (!subtree) return null;
      if (!subtree.children || subtree.children.length === 0) return subtree; // pane
      if (subtree.direction === splitDir) {
        const next = edge === 'last' ? subtree.children[1] : subtree.children[0];
        return _findAdjacentTarget(next, splitDir, edge);
      }
      return subtree;
    };
    const _collapseTargetForButton = (childIdx) => (childIdx === 0
      ? _findAdjacentTarget(node.children[0], node.direction, 'last')
      : _findAdjacentTarget(node.children[1], node.direction, 'first'));
    const _oppositeTargetForButton = (childIdx) => (childIdx === 0
      ? _findAdjacentTarget(node.children[1], node.direction, 'first')
      : _findAdjacentTarget(node.children[0], node.direction, 'last'));
    const _collapseSideLabel = (childIdx) => {
      const isHorz = node.direction === 'horizontal';
      if (isHorz) return childIdx === 0 ? '左側' : '右側';
      return childIdx === 0 ? '上側' : '下側';
    };
    const _collapseDirectionIcon = (childIdx) => {
      const isHorz = node.direction === 'horizontal';
      if (isHorz) return childIdx === 0 ? '◀' : '▶';
      return childIdx === 0 ? '▲' : '▼';
    };
    const _isCollapsedDock = (target) => !!target?.collapsed;
    // ノードの DOM 要素を ID で探すヘルパー
    const findNodeEl = (n) =>
      document.querySelector(`[data-pane-id="${n.id}"]`) ||
      document.querySelector(`.gb-split[data-split-id="${n.id}"]`) ||
      document.querySelector(`.gb-column[data-column-node-id="${n.id}"]`);
    const _isImmediateSplitChild = (n) => n === node.children[0] || n === node.children[1];
    const _collapsedRatioLooksApplied = (target) => {
      const parentInfo = findParent(_root, target.id);
      const parent = parentInfo?.node;
      if (!parent || parent.type !== 'split' || !Array.isArray(parent.children)) return false;
      const childIndex = findNode(parent.children[0], target.id) ? 0 : 1;
      const tolerance = 0.002;
      return childIndex === 0
        ? parent.ratio <= COLLAPSE_SIZE + tolerance
        : parent.ratio >= 1 - COLLAPSE_SIZE - tolerance;
    };
    const _isDirectionSideAtOuterEdge = (target, childIdx) => {
      const isStructurallyOuterEdge = () => {
        let current = node;
        while (current?.id) {
          const parentInfo = findParent(_root, current.id);
          const parent = parentInfo?.node || null;
          if (!parent) return true;
          if (parent.type !== 'split' || !Array.isArray(parent.children)) return true;
          if (parent.direction === node.direction) {
            const currentIndex = findNode(parent.children[0], current.id) ? 0 : 1;
            if (currentIndex !== childIdx) return false;
          }
          current = parent;
        }
        return true;
      };
      return isStructurallyOuterEdge();
    };
    const _actionLabelForButton = (childIdx, directionTarget, oppositeTarget) => {
      const directionLabel = _collapseSideLabel(childIdx);
      const oppositeLabel = _collapseSideLabel(childIdx === 0 ? 1 : 0);
      const directionDock = _isCollapsedDock(directionTarget);
      const oppositeDock = _isCollapsedDock(oppositeTarget);
      if (!directionDock && !oppositeDock) return `${directionLabel}を折りたたみ`;
      if (!directionDock && oppositeDock) return `${oppositeLabel}のドックバーを${directionLabel}へ展開`;
      if (directionDock && oppositeDock) return `${oppositeLabel}のドックバーを${directionLabel}へ展開`;
      return `${directionLabel}がドックバーのため操作なし`;
    };
    const _expandCollapsedTarget = (target, before) => {
      if (!target?.collapsed) return false;
      const hadOuterCollapseSaved = !!(target._outerCollapseSaved && target._outerCollapseSaved.outerId === node.id);
      if (target._outerCollapseSaved && target._outerCollapseSaved.outerId === node.id) {
        node.ratio = target._outerCollapseSaved.ratio;
        delete target._outerCollapseSaved;
      }
      target.collapsed = false;
      if (target._savedRatio != null || hadOuterCollapseSaved || _hasDefaultExpandedWidth(target) || !_isImmediateSplitChild(target) || _collapsedRatioLooksApplied(target)) {
        _adjustSplitForCollapse(target);
      } else {
        render();
      }
      saveLayout();
      pushLayoutHistory('レイアウト: 折りたたみ解除', before, captureLayoutSnapshot(), target.id || '');
      return true;
    };
    const _collapseExpandedTarget = (target, childIdx, before) => {
      if (!target || target.collapsed) return false;
      const isHorz = node.direction === 'horizontal';
      const dimKey = isHorz ? 'width' : 'height';
      if (_isImmediateSplitChild(target)) {
        // 直接の子: 既存の _adjustSplitForCollapse で OK (この node の ratio を変える)
        target.collapsed = true;
        _adjustSplitForCollapse(target);
        saveLayout();
        pushLayoutHistory('レイアウト: 折りたたみ', before, captureLayoutSnapshot(), target.id || '');
        return true;
      }
      // 深いネスト: 外側 split (=node) の ratio も調整して、freed space を反対側へ伝達
      const targetEl = findNodeEl(target);
      const splitEl = split; // 外側 split の DOM
      const targetSize = targetEl?.getBoundingClientRect()?.[dimKey] || 0;
      const splitSize = splitEl?.getBoundingClientRect()?.[dimKey] || 0;
      if (targetSize > 32 && splitSize > 0) {
        const COLLAPSED_PX = 32;
        const deltaPx = targetSize - COLLAPSED_PX;
        const deltaRatio = deltaPx / splitSize;
        // 復元用に外側 ratio を保存
        target._outerCollapseSaved = { outerId: node.id, ratio: node.ratio };
        // childIdx=0: 左/上側を縮める → ratio を減らす
        // childIdx=1: 右/下側を縮める → ratio を増やす
        if (childIdx === 0) {
          node.ratio = Math.max(0.025, node.ratio - deltaRatio);
        } else {
          node.ratio = Math.min(0.975, node.ratio + deltaRatio);
        }
      }
      target.collapsed = true;
      _adjustSplitForCollapse(target); // 内側 split (target の親) の ratio も調整
      saveLayout();
      pushLayoutHistory('レイアウト: 折りたたみ', before, captureLayoutSnapshot(), target.id || '');
      return true;
    };
    // 境界線上に置く 2 方向の折り畳みボタン
    // childIdx=0: 左/上向き、childIdx=1: 右/下向き。アイコンは向き固定。
    // クリック時は三角の向き側と反対側の collapsed 状態を組み合わせて操作を決める。
    const _makeCollapseBtn = (childIdx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'split-collapse-btn split-collapse-btn-' + (childIdx === 0 ? 'prev' : 'next');
      btn.dataset.e2eId = `split-${node.id}-collapse-${childIdx === 0 ? 'prev' : 'next'}`;
      const directionAtRender = _collapseTargetForButton(childIdx);
      const oppositeAtRender = _oppositeTargetForButton(childIdx);
      const actionLabel = _actionLabelForButton(childIdx, directionAtRender, oppositeAtRender);
      btn.textContent = _collapseDirectionIcon(childIdx);
      btn.title = actionLabel;
      btn.setAttribute('aria-label', actionLabel);
      const runCollapseAction = (e) => {
        e.stopPropagation();
        e.preventDefault();
        // ハンドルに視覚的に隣接するノードを取得（深いネストでも 1 列分だけが対象）
        const directionTarget = _collapseTargetForButton(childIdx);
        const oppositeTarget = _oppositeTargetForButton(childIdx);
        if (!directionTarget || !oppositeTarget) return;
        const directionDock = _isCollapsedDock(directionTarget);
        const oppositeDock = _isCollapsedDock(oppositeTarget);
        const before = captureLayoutSnapshot();
        // === 4状態の仕様 ===
        // 1. 向き側=パネル / 反対側=パネル: 向き側を折りたたむ。
        // 2. 向き側=パネル / 反対側=ドックバー: 反対側ドックバーを向き側へ展開する。
        // 3. 向き側=ドックバー / 反対側=ドックバー: 反対側ドックバーを向き側へ展開する。
        //    ただし向き側ドックバーの外側がウィンドウ端なら何もしない。
        // 4. 向き側=ドックバー / 反対側=パネル: 何もしない。
        if (!directionDock && !oppositeDock) {
          _collapseExpandedTarget(directionTarget, childIdx, before);
          return;
        }
        if (!directionDock && oppositeDock) {
          _expandCollapsedTarget(oppositeTarget, before);
          return;
        }
        if (directionDock && oppositeDock) {
          if (_isDirectionSideAtOuterEdge(directionTarget, childIdx)) return;
          _expandCollapsedTarget(oppositeTarget, before);
          return;
        }
        if (directionDock && !oppositeDock) return;
      };
      btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
      btn.addEventListener('click', runCollapseAction);
      return btn;
    };
    handle.appendChild(_makeCollapseBtn(0));
    handle.appendChild(_makeCollapseBtn(1));
    if (node.direction === 'horizontal') {
      const leftBoundaryTarget = _findAdjacentTarget(node.children[0], node.direction, 'last');
      const rightBoundaryTarget = _findAdjacentTarget(node.children[1], node.direction, 'first');
      if (leftBoundaryTarget?.id && rightBoundaryTarget?.id) {
        handle.dataset.columnDropLeftId = leftBoundaryTarget.id;
        handle.dataset.columnDropRightId = rightBoundaryTarget.id;
      }
    }

    const second = document.createElement('div');
    second.className = 'gb-split-child gb-split-second';
    if (child1collapsed) {
      if (node.direction === 'horizontal') { second.style.width = '32px'; second.style.flexShrink = '0'; }
      else { second.style.height = '32px'; second.style.flexShrink = '0'; }
    } else if (child0collapsed) {
      second.style.flex = '1';
    } else {
      if (node.direction === 'horizontal') second.style.width = (100 - node.ratio * 100).toFixed(2) + '%';
      else second.style.height = (100 - node.ratio * 100).toFixed(2) + '%';
    }
    second.appendChild(node.direction === 'horizontal'
      ? renderAsColumn(node.children[1], depth + 1)
      : renderNode(node.children[1], depth + 1));

    split.appendChild(first);
    split.appendChild(handle);
    split.appendChild(second);

    return split;
  }

  // === リサイズハンドル ===
  function _splitZoom() {
    return (typeof _getZoom === 'function') ? Math.max(0.1, _getZoom()) : 1;
  }

  function _splitLogicalCoord(clientPos) {
    return clientPos / _splitZoom();
  }

  function _splitLogicalRect(rect) {
    const zoom = _splitZoom();
    return {
      left: rect.left / zoom,
      top: rect.top / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    };
  }

  function _setSplitHandleAnchor(handle, direction, clientX, clientY) {
    const rect = _splitLogicalRect(handle.getBoundingClientRect());
    if (direction === 'horizontal') {
      const minY = 14;
      const maxY = Math.max(minY, rect.height - 14);
      const nextY = clientY == null
        ? '50%'
        : `${Math.max(minY, Math.min(maxY, _splitLogicalCoord(clientY) - rect.top))}px`;
      handle.style.setProperty('--gb-split-anchor-y', nextY);
      handle.style.removeProperty('--gb-split-anchor-x');
      return;
    }
    const minX = 14;
    const maxX = Math.max(minX, rect.width - 14);
    const nextX = clientX == null
      ? '50%'
      : `${Math.max(minX, Math.min(maxX, _splitLogicalCoord(clientX) - rect.left))}px`;
    handle.style.setProperty('--gb-split-anchor-x', nextX);
    handle.style.removeProperty('--gb-split-anchor-y');
  }

  function _bindSplitHandleAnchor(handle, direction) {
    handle.addEventListener('pointerenter', (e) => {
      if (handle.classList.contains('active')) return;
      _setSplitHandleAnchor(handle, direction, e.clientX, e.clientY);
    });
  }

  function _setupResizeHandle(handle, node, splitEl, firstEl) {
    const _getSecondEl = () => firstEl.nextElementSibling?.nextElementSibling || null;
    const _sizeKey = node.direction === 'horizontal' ? 'width' : 'height';
    let resizeHistoryBefore = null;
    let resizeStartRatio = null;
    const _setChildPxSizes = (firstSize, secondSize) => {
      const secondEl = _getSecondEl();
      if (!secondEl) return;
      firstEl.style.flex = 'none';
      secondEl.style.flex = 'none';
      firstEl.style[_sizeKey] = `${firstSize}px`;
      secondEl.style[_sizeKey] = `${secondSize}px`;
    };
    const _setChildRatioSizes = (ratio) => {
      const secondEl = _getSecondEl();
      if (!secondEl) return;
      const firstPct = (ratio * 100).toFixed(2);
      const secondPct = (100 - ratio * 100).toFixed(2);
      firstEl.style.flex = 'none';
      secondEl.style.flex = 'none';
      firstEl.style[_sizeKey] = firstPct + '%';
      secondEl.style[_sizeKey] = secondPct + '%';
    };
    const _syncHandleA11y = () => {
      handle.tabIndex = 0;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', node.direction === 'horizontal' ? 'vertical' : 'horizontal');
      handle.setAttribute('aria-label', node.direction === 'horizontal' ? '左右パネル幅を調整' : '上下パネル高さを調整');
      handle.setAttribute('aria-valuemin', '5');
      handle.setAttribute('aria-valuemax', '95');
      handle.setAttribute('aria-valuenow', String(Math.round((node.ratio || 0.5) * 100)));
    };
    const _commitKeyboardResize = (delta) => {
      const secondEl = _getSecondEl();
      if (!secondEl || node.children?.[0]?.collapsed || node.children?.[1]?.collapsed) return;
      const before = captureLayoutSnapshot();
      const nextRatio = Math.max(0.05, Math.min(0.95, (node.ratio || 0.5) + delta));
      if (Math.abs(nextRatio - node.ratio) < 0.0001) return;
      node.ratio = nextRatio;
      _setChildRatioSizes(node.ratio);
      _syncHandleA11y();
      saveLayout();
      pushLayoutHistory('レイアウト: キーボードリサイズ', before, captureLayoutSnapshot(), node.id || '');
      if (typeof showStatus === 'function') showStatus('パネルサイズを変更しました');
    };
    _syncHandleA11y();
    handle.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const step = e.shiftKey ? 0.08 : 0.03;
      const isDecrease = (node.direction === 'horizontal' && e.key === 'ArrowLeft')
        || (node.direction === 'vertical' && e.key === 'ArrowUp');
      const isIncrease = (node.direction === 'horizontal' && e.key === 'ArrowRight')
        || (node.direction === 'vertical' && e.key === 'ArrowDown');
      if (isDecrease || isIncrease) {
        e.preventDefault();
        e.stopPropagation();
        _commitKeyboardResize(isIncrease ? step : -step);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        handle.blur();
      }
    });
    handle.addEventListener('focus', _syncHandleA11y);

    const onMouseMove = (e) => {
      const rect = _splitLogicalRect(splitEl.getBoundingClientRect());
      const handleRect = _splitLogicalRect(handle.getBoundingClientRect());
      const handleSize = node.direction === 'horizontal' ? handleRect.width : handleRect.height;
      const totalSize = node.direction === 'horizontal' ? rect.width : rect.height;
      const contentSize = totalSize - handleSize;
      if (contentSize <= 0) return;
      const pointerPos = node.direction === 'horizontal'
        ? _splitLogicalCoord(e.clientX)
        : _splitLogicalCoord(e.clientY);
      const pointerOffset = node.direction === 'horizontal'
        ? (pointerPos - rect.left)
        : (pointerPos - rect.top);
      let newRatio = (pointerOffset - handleSize / 2) / contentSize;
      newRatio = Math.max(0.05, Math.min(0.95, newRatio));

      // 最小ペインサイズチェック
      if (contentSize * newRatio < MIN_PANE_SIZE || contentSize * (1 - newRatio) < MIN_PANE_SIZE) return;

      node.ratio = newRatio;
      _setChildPxSizes(contentSize * newRatio, contentSize * (1 - newRatio));
    };

    const onPointerEnd = (e) => {
      document.removeEventListener('pointermove', onMouseMove);
      document.removeEventListener('pointerup', onPointerEnd);
      document.removeEventListener('pointercancel', onPointerEnd);
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
      if (e && handle.hasPointerCapture?.(e.pointerId)) {
        try { handle.releasePointerCapture(e.pointerId); } catch {}
      }
      _setChildRatioSizes(node.ratio);
      saveLayout();
      if (resizeHistoryBefore && Math.abs((resizeStartRatio ?? node.ratio) - node.ratio) > 0.0001) {
        pushLayoutHistory('レイアウト: リサイズ', resizeHistoryBefore, captureLayoutSnapshot(), node.id || '');
      }
      resizeHistoryBefore = null;
      resizeStartRatio = null;
    };

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizeHistoryBefore = null;
      resizeStartRatio = null;
      const secondEl = _getSecondEl();
      if (!secondEl || node.children?.[0]?.collapsed || node.children?.[1]?.collapsed) return;
      resizeHistoryBefore = captureLayoutSnapshot();
      resizeStartRatio = node.ratio;
      const zoom = _splitZoom();
      const firstRect = firstEl.getBoundingClientRect();
      const secondRect = secondEl.getBoundingClientRect();
      const firstSize = (node.direction === 'horizontal' ? firstRect.width : firstRect.height) / zoom;
      const secondSize = (node.direction === 'horizontal' ? secondRect.width : secondRect.height) / zoom;
      _setChildPxSizes(firstSize, secondSize);
      if (handle.setPointerCapture) {
        try { handle.setPointerCapture(e.pointerId); } catch {}
      }
      handle.classList.add('active');
      document.body.style.cursor = node.direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      // iframeがマウスイベントを奪うのを防止
      document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
      document.addEventListener('pointermove', onMouseMove);
      document.addEventListener('pointerup', onPointerEnd);
      document.addEventListener('pointercancel', onPointerEnd);
    });
  }

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
      '#smart-db-view',
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
    const cleanup = () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', finish, true);
      if (fallbackTimer != null) clearTimeout(fallbackTimer);
      if (pointerUpTimer != null) clearTimeout(pointerUpTimer);
    };
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      setTimeout(() => {
        if (_activePane === paneId) setActivePane(paneId, { sync: true });
      }, 0);
    };
    const onClick = () => finish();
    const onPointerUp = () => {
      if (pointerUpTimer == null) pointerUpTimer = setTimeout(finish, 80);
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', finish, true);
    fallbackTimer = setTimeout(finish, 2000);
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

/* Source chunk: gb-layout.part03.js */
/* gb-layout.part03.js */
  // === ペイン分割 ===
  function splitPane(paneId, direction, position, newPaneNode, options) {
    const opts = options || {};
    const target = findNode(_root, paneId);
    if (!target) return null;
    if (target.node?.locked) {
      if (typeof showStatus === 'function') showStatus('ロック中のパネルは分割できません', true);
      return null;
    }

    const depth = getNodeDepth(_root, paneId);
    if (depth >= MAX_DEPTH) return null;

    newPaneNode = newPaneNode || createPaneNode();
    const before = !opts.skipHistory ? (opts.historyBefore || captureLayoutSnapshot()) : null;

    const isFirst = (position === 'left' || position === 'top');
    const splitDir = (position === 'left' || position === 'right') ? 'horizontal' : 'vertical';

    const newSplit = createSplitNode(splitDir, isFirst ? 0.3 : 0.7,
      isFirst ? [newPaneNode, target.node] : [target.node, newPaneNode]
    );

    if (!_replaceNodeById(paneId, newSplit)) return null;

    render();
    saveLayout();
    if (before) {
      pushLayoutHistory(
        opts.historyLabel || 'レイアウト: パネル分割',
        before,
        captureLayoutSnapshot(),
        opts.historyDetail || position || newPaneNode.id || ''
      );
    }
    return newPaneNode.id;
  }

  // === ペイン除去（空になったペインを閉じる） ===
  function removePane(paneId, options) {
    const opts = options || {};
    // ルートペイン自身は除去不可
    if (_root && _root.id === paneId) return;
    const parentInfo = findParent(_root, paneId);
    if (!parentInfo) return;
    const before = !opts.skipHistory ? (opts.historyBefore || captureLayoutSnapshot()) : null;

    // split/panelset どちらの親でも _detachNodeById が一括処理
    // （単一化した split を兄弟で置換、panelset なら groups から除去し
    //  1 件なら自動解体、0 件なら親から除去を再帰）
    _detachNodeById(paneId);

    if (_activePane === paneId) {
      const firstPane = findFirstPane(_root);
      if (firstPane) setActivePane(firstPane.id);
    }

    delete _paneMap[paneId];
    render();
    saveLayout();
    if (before) {
      pushLayoutHistory(
        opts.historyLabel || 'レイアウト: パネルを閉じる',
        before,
        captureLayoutSnapshot(),
        opts.historyDetail || paneId || ''
      );
    }
  }

  // ルートレベルで横断パネルを追加（ウィンドウ端へのドロップ用）
  const MAX_ROOT_DEPTH = 6; // ルートラップ専用の制限（通常のsplitPaneより緩い）
  function splitRoot(position, newPaneNode, options) {
    const opts = options || {};
    if (hasLockedPane()) {
      if (typeof showStatus === 'function') showStatus('ロック中のパネルがあるため外側へ新しいパネルを追加できません', true);
      return null;
    }
    const maxDepth = _getMaxDepth(_root, 0);
    if (maxDepth + 1 >= MAX_ROOT_DEPTH) return null;
    newPaneNode = newPaneNode || createPaneNode();
    const before = !opts.skipHistory ? (opts.historyBefore || captureLayoutSnapshot()) : null;
    const isFirst = (position === 'left' || position === 'top');
    const splitDir = (position === 'left' || position === 'right') ? 'horizontal' : 'vertical';
    const newSplit = createSplitNode(splitDir, isFirst ? 0.2 : 0.8,
      isFirst ? [newPaneNode, _root] : [_root, newPaneNode]
    );
    _root = newSplit;
    render();
    saveLayout();
    if (before) {
      pushLayoutHistory(
        opts.historyLabel || 'レイアウト: 外側パネル追加',
        before,
        captureLayoutSnapshot(),
        opts.historyDetail || position || newPaneNode.id || ''
      );
    }
    return newPaneNode.id;
  }

  function _getMaxDepth(node, depth) {
    if (!node) return depth;
    if (node.type === 'pane') return depth;
    if (node.type === 'split') return Math.max(_getMaxDepth(node.children[0], depth + 1), _getMaxDepth(node.children[1], depth + 1));
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      // パネルセットは自身で1階層消費せず、アクティブグループの深度のみ評価
      // （MAX_DEPTH 制約はアクティブ表示中のネスト深度に対して適用）
      const active = node.groups.find(g => g && g.id === node.activeGroupId);
      return active?.root ? _getMaxDepth(active.root, depth) : depth;
    }
    return depth;
  }

  // splitノードの子からpaneIdを持つ子のインデックスを返す（ID比較）
  function _getChildIndex(splitNode, paneId) {
    for (let i = 0; i < splitNode.children.length; i++) {
      const child = splitNode.children[i];
      if (!child) continue;
      if (child.type === 'pane' && child.id === paneId) return i;
      // childがsplit/panelsetノードで、その中にpaneIdがある場合もこの子
      if ((child.type === 'split' || child.type === 'panelset') && findNode(child, paneId)) return i;
    }
    return -1;
  }

  // === ツリー探索ヘルパー ===
  function findNode(root, nodeId) {
    if (!root) return null;
    if (root.id === nodeId) return { node: root };
    if (root.type === 'split' && Array.isArray(root.children)) {
      for (const child of root.children) {
        const found = findNode(child, nodeId);
        if (found) return found;
      }
    } else if (root.type === 'panelset' && Array.isArray(root.groups)) {
      // 非アクティブグループ内のノードも検索対象にする（ID探索はグループをまたぐ）
      for (const group of root.groups) {
        const found = group?.root ? findNode(group.root, nodeId) : null;
        if (found) return found;
      }
    }
    return null;
  }

  // nodeIdの直接の親split/panelsetノードを返す（pane/split両対応）
  function findParent(root, nodeId) {
    if (!root) return null;
    if (root.type === 'split' && Array.isArray(root.children)) {
      for (const child of root.children) {
        if (!child) continue;
        if (child.id === nodeId) return { node: root };
        if (child.type === 'split' || child.type === 'panelset') {
          const found = findParent(child, nodeId);
          if (found) return found;
        }
      }
      return null;
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      for (const group of root.groups) {
        const grRoot = group?.root;
        if (!grRoot) continue;
        if (grRoot.id === nodeId) return { node: root };
        if (grRoot.type === 'split' || grRoot.type === 'panelset') {
          const found = findParent(grRoot, nodeId);
          if (found) return found;
        }
      }
    }
    return null;
  }

  function _collectNodePath(root, targetId, path) {
    if (!root) return null;
    const nextPath = path ? [...path, root] : [root];
    if (root.id === targetId) return nextPath;
    if (root.type === 'split' && Array.isArray(root.children)) {
      for (const child of root.children) {
        const found = _collectNodePath(child, targetId, nextPath);
        if (found) return found;
      }
      return null;
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      // 可視性判定に使われるため、非アクティブグループ内は到達不可とみなす
      const active = root.groups.find(g => g && g.id === root.activeGroupId);
      if (active?.root) {
        const found = _collectNodePath(active.root, targetId, nextPath);
        if (found) return found;
      }
    }
    return null;
  }

  function isPaneVisible(paneId) {
    if (!paneId) return false;
    const path = _collectNodePath(_root, paneId);
    if (!path || !path.length) return false;
    return path.every((node) => !node?.collapsed);
  }

  function revealPane(paneId, options) {
    if (!paneId) return false;
    const path = _collectNodePath(_root, paneId);
    if (!path || !path.length) return false;
    let activated = false;
    if (options?.activate && findNode(_root, paneId)?.node?.type === 'pane' && _activePane !== paneId) {
      _activePane = paneId;
      activated = true;
    }
    let changed = false;
    path.forEach((node) => {
      if (!node?.collapsed) return;
      node.collapsed = false;
      _adjustSplitForCollapse(node, { skipRender: true });
      changed = true;
    });
    if (!changed) return activated;
    if (!options?.deferRender) {
      render();
      saveLayout();
    }
    return true;
  }

  // splitノードの親を検索（参照比較だがrender前の同一オブジェクト内で使用）
  function findParentOfSplit(root, targetSplit) {
    if (!root) return null;
    if (root.type === 'split' && Array.isArray(root.children)) {
      for (const child of root.children) {
        if (child === targetSplit) return { node: root };
        if (child && (child.type === 'split' || child.type === 'panelset')) {
          const found = findParentOfSplit(child, targetSplit);
          if (found) return found;
        }
      }
      return null;
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      for (const group of root.groups) {
        const grRoot = group?.root;
        if (!grRoot) continue;
        if (grRoot === targetSplit) return { node: root };
        if (grRoot.type === 'split' || grRoot.type === 'panelset') {
          const found = findParentOfSplit(grRoot, targetSplit);
          if (found) return found;
        }
      }
    }
    return null;
  }

  function findFirstPane(root) {
    if (!root) return null;
    if (root.type === 'pane') return root;
    if (root.type === 'split') {
      return findFirstPane(root.children[0]) || findFirstPane(root.children[1]);
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      // アクティブグループから優先的に探索（初期フォーカス対象を可視ペインに限定）
      const active = root.groups.find(g => g && g.id === root.activeGroupId);
      if (active?.root) {
        const p = findFirstPane(active.root);
        if (p) return p;
      }
      for (const group of root.groups) {
        if (!group || group.id === root.activeGroupId || !group.root) continue;
        const p = findFirstPane(group.root);
        if (p) return p;
      }
    }
    return null;
  }

  function getNodeDepth(root, paneId, depth) {
    depth = depth || 0;
    if (!root) return -1;
    if (root.type === 'pane' && root.id === paneId) return depth;
    if (root.type === 'split') {
      const d1 = getNodeDepth(root.children[0], paneId, depth + 1);
      if (d1 >= 0) return d1;
      return getNodeDepth(root.children[1], paneId, depth + 1);
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      // panelset は自身で1階層消費しない（MAX_DEPTH とレイアウト深度の整合）
      for (const group of root.groups) {
        if (!group?.root) continue;
        const d = getNodeDepth(group.root, paneId, depth);
        if (d >= 0) return d;
      }
    }
    return -1;
  }

  // getAllPanes(root) / getAllPanes(root, result) / getAllPanes(root, opts) / getAllPanes(root, result, opts)
  //   opts.activeOnly: true なら panelset の非アクティブグループを除外（表示中のペインのみ収集）
  function getAllPanes(root, resultOrOpts, maybeOpts) {
    let result, opts;
    if (Array.isArray(resultOrOpts)) { result = resultOrOpts; opts = maybeOpts || {}; }
    else { result = []; opts = resultOrOpts || {}; }
    if (!root) return result;
    if (root.type === 'pane') { result.push(root); return result; }
    if (root.type === 'split') {
      getAllPanes(root.children[0], result, opts);
      getAllPanes(root.children[1], result, opts);
      return result;
    }
    if (root.type === 'panelset' && Array.isArray(root.groups)) {
      const targets = opts.activeOnly
        ? root.groups.filter(g => g && g.id === root.activeGroupId)
        : root.groups;
      targets.forEach(g => { if (g?.root) getAllPanes(g.root, result, opts); });
    }
    return result;
  }

  // === レンダリングフック ===
  let _preRender = null;
  let _postRender = null;

  // モバイルモード判定
  function _isMobileLayout() { return window.innerWidth <= 768; }
  let _wasMobileLayout = false;

  // 古いペインに紐付いた ResizeObserver を解放する。
  // render() 再呼び出しで _paneMap が差し替わる前に呼ぶこと。
  function _disconnectPaneObservers() {
    for (const id in _paneMap) {
      const info = _paneMap[id];
      if (info?.observer && typeof info.observer.disconnect === 'function') {
        info.observer.disconnect();
      }
    }
  }

  // モバイルモード: アクティブペインのみ描画
  function _renderMobile() {
    if (!_layoutEl) return;
    _disconnectPaneObservers();
    _paneMap = {};
    _layoutEl.innerHTML = '';
    // アクティブペインを検索
    let targetPane = _activePane ? findNode(_root, _activePane)?.node : null;
    if (!targetPane) targetPane = findFirstPane(_root);
    if (targetPane) {
      _layoutEl.appendChild(renderPane(targetPane, 0));
      if (!_activePane) _activePane = targetPane.id;
    }
  }

  // === レンダリング ===
  // _preRender (pane-bridge._beforeRender) がレガシーコンテナを display:none の
  // ストレージに退避するため、その中のスクロールコンテナの scrollTop がリセットされる。
  // render() 全体をスクロール保護で囲み、_postRender 完了後に復元する。
  function _saveAllScrollPositions() {
    if (typeof _captureViewportSnapshot === 'function') return _captureViewportSnapshot();
    const snap = new Map();
    document.querySelectorAll('#legacy-views [style*="overflow"], #gb-layout-root [style*="overflow"]').forEach(el => {
      if (el.scrollTop > 0) snap.set(el, el.scrollTop);
    });
    return snap;
  }
  function _restoreAllScrollPositions(snap) {
    if (snap && snap.scroll instanceof Map && typeof _restoreViewportSnapshot === 'function') {
      _restoreViewportSnapshot(snap);
      return;
    }
    snap.forEach((v, el) => { el.scrollTop = v; });
  }
  // ルート描画: ルートが水平スプリットの場合は子ごとに renderAsColumn される。
  // それ以外（垂直スプリット / 単独ペイン / panelset）の場合はルート全体を 1 列としてラップ。
  function _renderRoot() {
    if (!_root) return document.createElement('div');
    if (_root.type === 'split' && _root.direction === 'horizontal') {
      return renderNode(_root, 0);
    }
    return renderAsColumn(_root, 0);
  }

  function render() {
    if (!_layoutEl) return;
    // Phase 5 安全策: ポップアップ表示中に再レンダリングすると、ポップアップ内に
    // 移動した pane DOM が innerHTML = '' で消える一方、_state.originalParent が
    // 新しい DOM に差し替わってしまい孤立する。事前にポップアップを閉じて pane DOM
    // を元位置に戻してから再描画する。
    if (typeof GBDockPopup !== 'undefined' && typeof GBDockPopup.isOpen === 'function'
        && GBDockPopup.isOpen() && typeof GBDockPopup.close === 'function') {
      GBDockPopup.close();
    }
    const scrollSnap = _saveAllScrollPositions();
    if (_preRender) _preRender();
    _disconnectPaneObservers();
    _paneMap = {};
    _layoutEl.innerHTML = '';

    if (_isMobileLayout()) {
      // モバイル: アクティブペインのみ
      _renderMobile();
    } else if (_maximizedPaneId) {
      // 最大化モード: 対象ペインの実ノードをツリーから探して描画
      const info = findNode(_root, _maximizedPaneId);
      if (info) {
        _layoutEl.appendChild(renderPane(info.node, 0));
      } else {
        _maximizedPaneId = null;
        _savedRootForMaximize = null;
        _setMaximizeChrome(false);
        _layoutEl.appendChild(_renderRoot());
      }
    } else {
      _layoutEl.appendChild(_renderRoot());
    }

    if (!_activePane || !_paneMap[_activePane]) {
      const firstPane = _maximizedPaneId ? findNode(_root, _maximizedPaneId)?.node : findFirstPane(_root);
      if (firstPane) setActivePane(firstPane.id);
    }

    if (typeof GBDocking !== 'undefined' && !_isMobileLayout()) {
      GBDocking.setupDropTargets();
    }
    if (_postRender) _postRender();
    _restoreAllScrollPositions(scrollSnap);
    queueMicrotask(() => _restoreAllScrollPositions(scrollSnap));
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => _restoreAllScrollPositions(scrollSnap));
    setTimeout(() => _restoreAllScrollPositions(scrollSnap), 80);
  }

  // === 初期化 ===
  const STARTUP_ACTIVE_PANE_AVOID_TYPES = new Set([
    'outliner',
    'detail',
    'preview',
    'chat',
    'calendar',
    'timer',
    'history',
    'annotation',
    'sticky',
    'search',
    'version',
  ]);

  function _activeTabTypeForStartupPane(pane) {
    if (!pane || pane.type !== 'pane') return '';
    const tabs = Array.isArray(pane.tabs) ? pane.tabs : [];
    const index = Number.isInteger(pane.activeTabIndex) ? pane.activeTabIndex : -1;
    return String(tabs[index]?.type || tabs[0]?.type || '');
  }

  function _isStartupUtilityPane(pane) {
    return STARTUP_ACTIVE_PANE_AVOID_TYPES.has(_activeTabTypeForStartupPane(pane));
  }

  function _isStartupVisiblePane(pane) {
    return !!(pane?.id && isPaneVisible(pane.id));
  }

  function _findStartupContentPane(root) {
    const activePanes = getAllPanes(root, { activeOnly: true });
    const allPanes = getAllPanes(root);
    return activePanes.find(pane => _isStartupVisiblePane(pane) && !_isStartupUtilityPane(pane))
      || allPanes.find(pane => _isStartupVisiblePane(pane) && !_isStartupUtilityPane(pane))
      || activePanes.find(pane => !_isStartupUtilityPane(pane))
      || allPanes.find(pane => !_isStartupUtilityPane(pane))
      || null;
  }

  function _resolveStartupActivePaneId(storedActivePaneId) {
    const stored = storedActivePaneId ? findNode(_root, storedActivePaneId)?.node : null;
    if (stored && _isStartupVisiblePane(stored) && !_isStartupUtilityPane(stored)) return stored.id;
    const contentPane = _findStartupContentPane(_root);
    if (contentPane) return contentPane.id;
    if (stored && _isStartupVisiblePane(stored)) return stored.id;
    const visiblePane = getAllPanes(_root, { activeOnly: true }).find(_isStartupVisiblePane)
      || getAllPanes(_root).find(_isStartupVisiblePane);
    if (visiblePane) return visiblePane.id;
    return stored?.id || null;
  }

  function init(containerEl) {
    _layoutEl = containerEl || document.getElementById('gb-layout-root');
    if (!_layoutEl) return;

    // 保存されたレイアウトを復元、なければデフォルト
    const loadedRoot = loadLayout();
    _loadedLayoutFromStorage = !!loadedRoot;
    _root = loadedRoot || defaultLayout();
    const storedActivePaneId = _loadedLayoutFromStorage ? _readStoredActivePaneId() : '';
    const startupActivePaneId = _loadedLayoutFromStorage ? _resolveStartupActivePaneId(storedActivePaneId) : null;
    _activePane = startupActivePaneId;
    if (_loadedLayoutFromStorage && _activePane !== storedActivePaneId) {
      _writeActivePaneToStorage();
    }

    // paneIdCounter と tabIdCounter を復元（ID衝突防止）
    // splitノードのIDも走査する
    let maxTabId = 0;
    function _scanIds(node) {
      if (!node) return;
      if (node.id) {
        const num = parseInt(node.id.replace(/^(pane|split)-/, ''));
        if (!isNaN(num) && num > _paneIdCounter) _paneIdCounter = num;
      }
      if (node.type === 'pane' && node.tabs) {
        node.tabs.forEach(t => {
          const tnum = parseInt((t.id || '').replace('tab-', ''));
          if (!isNaN(tnum) && tnum > maxTabId) maxTabId = tnum;
        });
      }
      if (node.type === 'split' && node.children) {
        node.children.forEach(c => _scanIds(c));
      }
      if (node.type === 'panelset' && Array.isArray(node.groups)) {
        node.groups.forEach(g => { if (g?.root) _scanIds(g.root); });
      }
    }
    _scanIds(_root);
    // GBTabsのカウンター復元
    if (typeof GBTabs !== 'undefined' && maxTabId > 0) {
      GBTabs._restoreCounter(maxTabId);
    }

    render();

    // リサイズでモバイル↔デスクトップ切替時に再描画
    _wasMobileLayout = _isMobileLayout();
    let resizeRenderTimer = 0;
    const scheduleResizeRender = () => {
      clearTimeout(resizeRenderTimer);
      resizeRenderTimer = setTimeout(() => {
        resizeRenderTimer = 0;
        render();
      }, 80);
    };
    window.addEventListener('resize', () => {
      const now = _isMobileLayout();
      if (now !== _wasMobileLayout) {
        _wasMobileLayout = now;
        render();
        return;
      }
      scheduleResizeRender();
    });
    window.visualViewport?.addEventListener('resize', scheduleResizeRender, { passive: true });
  }

  // === パネル操作メニュー（…ボタン経由: ロック/折りたたみ/最大化/閉じる） ===
  function _showPaneActionsMenu(e, node) {
    if (typeof closeMeldexDropdowns === 'function') {
      closeMeldexDropdowns({ exceptTarget: e.currentTarget });
    }
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    menu.style.cssText = 'position:fixed;z-index:10000;';
    const isMaxed = _maximizedPaneId === node.id;
    const hasParent = !!findParent(_root, node.id);

    function addItem(label, fn, icon) {
      const mi = document.createElement('div');
      if (icon && typeof lucide === 'function') {
        mi.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' + label;
      } else {
        mi.textContent = label;
      }
      mi.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
      mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; };
      mi.onmouseleave = () => { mi.style.background = ''; };
      mi.addEventListener('click', () => {
        document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
        fn();
      });
      menu.appendChild(mi);
    }

    // ロック: サブメニューで現在の状態が一目で分かるよう「ロック」「ロック解除」両方を表示。
    // 選択中の状態には Lucide の check を表示し、クリックで対応する状態へ遷移。
    (function _addLockSubmenu() {
      const wrap = document.createElement('div');
      wrap.style.position = 'relative';
      const trigger = document.createElement('div');
      trigger.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
      trigger.innerHTML =
        '<span style="margin-right:6px;opacity:0.7;">'
        + (typeof lucide === 'function' ? lucide(node.locked ? 'lock' : 'unlock', 14) : '')
        + '</span>ロック'
        + (typeof submenuArrow === 'function' ? submenuArrow() : ' ▸');
      trigger.onmouseenter = () => { trigger.style.background = 'var(--bg4)'; };
      trigger.onmouseleave = () => { trigger.style.background = ''; };
      const panel = document.createElement('div');
      panel.className = 'gb-context-menu';
      panel.style.cssText = 'display:none;';
      function addLockSub(label, iconName, isActive, desired) {
        const si = document.createElement('div');
        si.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
        const iconHtml = (typeof lucide === 'function') ? lucide(iconName, 14) : '';
        const check = isActive
          ? '<span class="gb-menu-check-icon" style="display:inline-flex;width:1em;margin-right:4px;color:var(--accent);vertical-align:middle;">' + (typeof lucide === 'function' ? lucide('check', 14) : '') + '</span>'
          : '<span class="gb-menu-check-icon" style="display:inline-block;width:1em;margin-right:4px;"></span>';
        si.innerHTML = check
          + '<span style="margin-right:6px;opacity:0.7;">' + iconHtml + '</span>'
          + label;
        si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
        si.onmouseleave = () => { si.style.background = ''; };
        si.addEventListener('click', () => {
          document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
          if (!isActive) setPaneLocked(node.id, desired);
        });
        panel.appendChild(si);
      }
      addLockSub('ロック', 'lock', !!node.locked, true);
      addLockSub('ロック解除', 'unlock', !node.locked, false);
      if (typeof attachHoverSubmenu === 'function') attachHoverSubmenu(trigger, panel);
      wrap.appendChild(trigger);
      wrap.appendChild(panel);
      menu.appendChild(wrap);
    })();
    if (hasParent) {
      addItem(node.collapsed ? '折りたたみを解除' : '最小化（折りたたみ）', () => {
        if (isMaxed) { restoreMaximizedPane(); return; }
        const before = captureLayoutSnapshot();
        node.collapsed = !node.collapsed;
        _adjustSplitForCollapse(node);
        saveLayout();
        render();
        pushLayoutHistory(
          node.collapsed ? 'レイアウト: 折りたたみ' : 'レイアウト: 折りたたみ解除',
          before,
          captureLayoutSnapshot(),
          node.id || ''
        );
      }, node.collapsed ? 'maximize2' : 'minus');
    }
    addItem(isMaxed ? '元のサイズに戻す' : '最大化', () => {
      if (isMaxed) restoreMaximizedPane();
      else maximizePane(node.id);
    }, isMaxed ? 'copy' : 'square');
    if (hasParent) {
      addItem('パネルを閉じる', () => {
        if (isMaxed) restoreMaximizedPane();
        removePane(node.id);
      }, 'x');
    }

    document.body.appendChild(menu);
    const anchor = e.currentTarget?.getBoundingClientRect
      ? e.currentTarget.getBoundingClientRect()
      : { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 };
    if (typeof positionPopup === 'function') {
      positionPopup(menu, anchor);
    } else {
      const z = (typeof _getZoom === 'function') ? _getZoom() : 1;
      menu.style.left = (e.clientX / z) + 'px';
      menu.style.top = (e.clientY / z) + 'px';
    }

    setTimeout(() => {
      const close = (ev) => {
        // 自分のメニューが既に DOM から外されている場合は、このリスナー自身を破棄して終了
        // （mi.click で removeAll した後に古いクロージャが残ると、次回開いた別メニューを
        //   「外側クリック」と誤判定して破壊してしまうため）
        if (!menu.isConnected) {
          document.removeEventListener('pointerdown', close);
          return;
        }
        // 現在開いているどのコンテキストメニュー内にも該当しない場合のみ閉じる
        const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
        if (!inAny) {
          document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
          document.removeEventListener('pointerdown', close);
        }
      };
      document.addEventListener('pointerdown', close);
    }, 0);
  }

  // === ペインタブ右クリックメニュー ===
  function _showTabContextMenu(e, paneId, tab) {
    // 既存メニューを除去
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    { const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
    function addItem(label, fn, icon) {
      const mi = document.createElement('div');
      if (icon && typeof lucide === 'function') {
        mi.innerHTML = '<span style="margin-right:6px;opacity:0.7;">' + lucide(icon, 14) + '</span>' + label;
      } else {
        mi.textContent = label;
      }
      mi.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
      mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; };
      mi.onmouseleave = () => { mi.style.background = ''; };
      mi.addEventListener('click', () => { document.querySelectorAll('.gb-context-menu').forEach(m => m.remove()); fn(); });
      menu.appendChild(mi);
    }
    // 新しいウィンドウで開く
    addItem('新しいウィンドウで開く', () => {
      const t = tab.type === 'database' ? 'pivot' : (tab.type || 'page');
      const url = '/?open=' + encodeURIComponent(t) + '&path=' + encodeURIComponent(tab.path || '') + '&label=' + encodeURIComponent(tab.label || '');
      if (typeof _open_app_window_js === 'function') _open_app_window_js(url);
      else window.open(url, '_blank', 'width=1200,height=800,menubar=no,toolbar=no,location=no');
      GBTabs.closeTab(paneId, tab.id);
    }, 'monitor');
    addItem('タブを閉じる', () => GBTabs.closeTab(paneId, tab.id), 'x');
    addItem('他のタブをすべて閉じる', () => {
      const paneInfo = findNode(_root, paneId);
      if (!paneInfo) return;
      const pane = paneInfo.node;
      const keep = pane.tabs.find(t => t.id === tab.id);
      if (!keep) return;
      const before = captureLayoutSnapshot();
      pane.tabs.forEach(t => {
        if (t.id !== tab.id && typeof removeComponentInstance === 'function') {
          removeComponentInstance(t.id);
        }
      });
      pane.tabs = [keep];
      pane.activeTabIndex = 0;
      render();
      saveLayout();
      pushLayoutHistory('レイアウト: 他のタブを閉じる', before, captureLayoutSnapshot(), keep.label || keep.path || '');
    }, 'x');
    addItem(isPaneLocked(paneId) ? 'パネルロックを解除' : 'パネルをロック', () => {
      togglePaneLocked(paneId);
    }, isPaneLocked(paneId) ? 'unlock' : 'lock');
    // ペイン最大化サブメニュー
    {
      const maxWrap = document.createElement('div');
      maxWrap.style.position = 'relative';
      const maxTrigger = document.createElement('div');
      maxTrigger.innerHTML = (typeof lucide === 'function' ? '<span style="margin-right:6px;opacity:0.7;">' + lucide('maximize2', 14) + '</span>' : '') + '表示モード' + submenuArrow();
      maxTrigger.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
      maxTrigger.onmouseenter = () => { maxTrigger.style.background = 'var(--bg4)'; };
      maxTrigger.onmouseleave = () => { maxTrigger.style.background = ''; };
      const maxPanel = document.createElement('div');
      maxPanel.className = 'gb-context-menu';
      maxPanel.style.cssText = 'display:none;min-width:120px;';
      attachHoverSubmenu(maxTrigger, maxPanel);
      const isMax = _maximizedPaneId === paneId;
      [['最大化', true], ['通常表示', false]].forEach(([label, val]) => {
        const si = document.createElement('div');
        si.innerHTML = radioMark(isMax === val) + label;
        si.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;' + (isMax === val ? 'color:var(--accent);' : '');
        si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
        si.onmouseleave = () => { si.style.background = ''; };
        si.addEventListener('click', () => { document.querySelectorAll('.gb-context-menu').forEach(m => m.remove()); if (val) maximizePane(paneId); else restoreMaximizedPane(); });
        maxPanel.appendChild(si);
      });
      maxWrap.appendChild(maxTrigger);
      maxWrap.appendChild(maxPanel);
      menu.appendChild(maxWrap);
    }
    // 別のペインで開く（分割）
    addItem('右の作業領域で開く', () => {
      const tabCopy = { ...tab, id: 'tab-' + Date.now() };
      const newPane = createPaneNode(null, [tabCopy], 0);
      const newPaneId = splitPane(paneId, 'horizontal', 'right', newPane);
      if (newPaneId) setActivePane(newPaneId);
    }, 'columns');
    document.body.appendChild(menu);
    clampPopupToViewport(menu);
    setTimeout(() => {
      const close = (ev) => {
        const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
        if (!inAny) { document.querySelectorAll('.gb-context-menu').forEach(m => m.remove()); document.removeEventListener('pointerdown', close); }
      };
      document.addEventListener('pointerdown', close);
    }, 0);
  }

  // === レイアウトリセット ===
  function resetLayout(options) {
    const opts = options || {};
    const before = !opts.skipHistory ? captureLayoutSnapshot() : null;
    _root = defaultLayout();
    _activePane = null;
    render();
    saveLayout();
    if (before) {
      const after = captureLayoutSnapshot();
      pushLayoutHistory('レイアウト: 初期化', before, after, '標準レイアウトへ戻す');
    }
  }

  function _cloneLayoutTree(layout) {
    if (!layout) return null;
    try {
      return JSON.parse(JSON.stringify(layout));
    } catch {
      return null;
    }
  }

  function _collectLayoutCounters(node, state) {
    if (!node || !state) return;
    if (node.id) {
      const paneNum = parseInt(String(node.id).replace(/^(pane|split)-/, ''), 10);
      if (!isNaN(paneNum) && paneNum > state.maxPaneId) state.maxPaneId = paneNum;
    }
    if (node.type === 'pane' && Array.isArray(node.tabs)) {
      node.tabs.forEach((tab) => {
        const tabNum = parseInt(String(tab?.id || '').replace(/^tab-/, ''), 10);
        if (!isNaN(tabNum) && tabNum > state.maxTabId) state.maxTabId = tabNum;
      });
      return;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
      node.children.forEach((child) => _collectLayoutCounters(child, state));
      return;
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      node.groups.forEach((g) => { if (g?.root) _collectLayoutCounters(g.root, state); });
    }
  }

  function _collectTabIds(node, ids) {
    if (!node || !ids) return ids;
    if (node.type === 'pane' && Array.isArray(node.tabs)) {
      node.tabs.forEach((tab) => {
        if (tab?.id) ids.add(tab.id);
      });
      return ids;
    }
    if (node.type === 'split' && Array.isArray(node.children)) {
      node.children.forEach((child) => _collectTabIds(child, ids));
      return ids;
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      node.groups.forEach((g) => { if (g?.root) _collectTabIds(g.root, ids); });
    }
    return ids;
  }

  function _syncLayoutCounters(root) {
    const state = { maxPaneId: _paneIdCounter, maxTabId: 0 };
    _collectLayoutCounters(root, state);
    if (state.maxPaneId > _paneIdCounter) _paneIdCounter = state.maxPaneId;
    if (typeof GBTabs !== 'undefined' && typeof GBTabs._restoreCounter === 'function') {
      GBTabs._restoreCounter(state.maxTabId);
    }
  }

  function _removeOrphanComponentInstances(prevRoot, nextRoot) {
    if (typeof removeComponentInstance !== 'function') return;
    const prevIds = _collectTabIds(prevRoot, new Set());
    const nextIds = _collectTabIds(nextRoot, new Set());
    prevIds.forEach((tabId) => {
      if (!nextIds.has(tabId)) removeComponentInstance(tabId);
    });
  }

  function exportLayout() {
    return _cloneLayoutTree(_root);
  }

  function captureLayoutSnapshot() {
    return {
      layout: exportLayout(),
      activePaneId: _activePane || '',
    };
  }

  function restoreLayoutSnapshot(snapshot) {
    if (!snapshot?.layout) return false;
    applyLayoutTree(snapshot.layout, {
      activePaneId: snapshot.activePaneId || '',
      skipSave: true,
    });
    saveLayout({ immediate: true });
    return true;
  }

  function pushLayoutHistory(label, beforeSnapshot, afterSnapshot, detail) {
    if (typeof historyPush !== 'function' || !beforeSnapshot?.layout || !afterSnapshot?.layout) return false;
    let beforeKey = '';
    let afterKey = '';
    try {
      beforeKey = JSON.stringify(beforeSnapshot);
      afterKey = JSON.stringify(afterSnapshot);
    } catch {}
    if (beforeKey && beforeKey === afterKey) return false;
    const scope = (typeof _historyActiveScope !== 'undefined') ? _historyActiveScope : '';
    historyPush(
      label,
      () => restoreLayoutSnapshot(beforeSnapshot),
      () => restoreLayoutSnapshot(afterSnapshot),
      scope,
      detail || ''
    );
    saveLayout({ immediate: true });
    return true;
  }

  function applyLayoutTree(layout, options) {
    const nextRoot = _cloneLayoutTree(layout);
    if (!nextRoot || (nextRoot.type !== 'pane' && nextRoot.type !== 'split' && nextRoot.type !== 'panelset')) return null;
    _normalizePaneNode(nextRoot);
    _removeOrphanComponentInstances(_root, nextRoot);
    _root = nextRoot;
    _savedRootForMaximize = null;
    _maximizedPaneId = null;
    _setMaximizeChrome(false);
    _syncLayoutCounters(_root);
    const requestedPaneId = options?.activePaneId || '';
    _activePane = requestedPaneId && findNode(_root, requestedPaneId)?.node
      ? requestedPaneId
      : (findFirstPane(_root)?.id || null);
    render();
    if (_activePane && _paneMap[_activePane]) setActivePane(_activePane);
    if (!options?.skipSave) saveLayout({ immediate: true });
    return _activePane;
  }

  // === ペイン最大化/復元 ===
  function _setMaximizeChrome(hidden) {
    const statusBar = document.getElementById('status-bar');
    const sidebar = document.getElementById('sidebar');
    const sidebarResize = document.getElementById('sidebar-resize');
    if (document.body) {
      if (hidden) document.body.dataset.paneMaximized = '1';
      else delete document.body.dataset.paneMaximized;
    }
    if (statusBar) statusBar.style.display = hidden ? 'none' : '';
    if (hidden) {
      // サイドバーが表示中なら一時的に隠す（復元時に元に戻す）
      _sidebarWasVisible = sidebar && sidebar.style.display !== 'none';
      if (_sidebarWasVisible) {
        sidebar.style.display = 'none';
        if (sidebarResize) sidebarResize.style.display = 'none';
      }
    } else if (_sidebarWasVisible) {
      if (sidebar) sidebar.style.display = '';
      if (sidebarResize) sidebarResize.style.display = '';
    }
  }
  let _sidebarWasVisible = false;
  function maximizePane(paneId) {
    if (_maximizedPaneId) { restoreMaximizedPane(); return; }
    const info = findNode(_root, paneId);
    if (!info) return;
    _savedRootForMaximize = JSON.parse(JSON.stringify(_root));
    _maximizedPaneId = paneId;
    _setMaximizeChrome(true);
    render();
    saveLayout();
  }
  function restoreMaximizedPane() {
    if (!_savedRootForMaximize) return;
    // 最大化中にタブ変更があった場合、現在の状態をsavedRootにマージ
    const currentPane = findNode(_root, _maximizedPaneId);
    if (currentPane) {
      const savedPane = findNode(_savedRootForMaximize, _maximizedPaneId);
      if (savedPane) {
        savedPane.node.tabs = currentPane.node.tabs;
        savedPane.node.activeTabIndex = currentPane.node.activeTabIndex;
        savedPane.node.locked = !!currentPane.node.locked;
        savedPane.node.navHistory = Array.isArray(currentPane.node.navHistory) ? currentPane.node.navHistory : [];
        savedPane.node.navIndex = Number.isInteger(currentPane.node.navIndex) ? currentPane.node.navIndex : (savedPane.node.navHistory.length ? savedPane.node.navHistory.length - 1 : -1);
      }
    }
    _root = _savedRootForMaximize;
    _savedRootForMaximize = null;
    _maximizedPaneId = null;
    _setMaximizeChrome(false);
    _restoreCounters(_root);
    render();
    saveLayout();
  }
  function _restoreCounters(node) {
    if (!node) return;
    if (node.id) {
      const n = parseInt(node.id.replace(/^(pane|split)-/, ''));
      if (!isNaN(n) && n > _paneIdCounter) _paneIdCounter = n;
    }
    if (node.children) node.children.forEach(c => _restoreCounters(c));
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      node.groups.forEach(g => { if (g?.root) _restoreCounters(g.root); });
    }
  }
  function isMaximized() { return !!_maximizedPaneId; }

  // === 列 D&D 操作 ===
  // 任意のノード ID を指定位置で置換。ルート自身ならルートを差し替える。
  function _replaceNodeById(targetId, newNode) {
    if (!_root) return false;
    if (_root.id === targetId) { _root = newNode; return true; }
    function walk(n) {
      if (!n) return false;
      if (n.type === 'split' && Array.isArray(n.children)) {
        for (let i = 0; i < n.children.length; i++) {
          if (n.children[i]?.id === targetId) { n.children[i] = newNode; return true; }
          if (walk(n.children[i])) return true;
        }
      } else if (n.type === 'panelset' && Array.isArray(n.groups)) {
        for (const g of n.groups) {
          if (g?.root?.id === targetId) { g.root = newNode; return true; }
          if (g?.root && walk(g.root)) return true;
        }
      }
      return false;
    }
    return walk(_root);
  }

  // ノードを親から取り除く。親 split が単一子になった場合、その子で親を置換（平坦化）。
  function _detachNodeById(targetId) {
    if (!_root || _root.id === targetId) { _root = null; return; }
    function walk(n, parent, parentKey, parentIdx) {
      if (!n) return false;
      if (n.type === 'split' && Array.isArray(n.children)) {
        for (let i = 0; i < n.children.length; i++) {
          if (n.children[i]?.id === targetId) {
            // 兄弟のみ残る → split を兄弟で置換（平坦化）
            const sibling = n.children[1 - i];
            if (parent === null) { _root = sibling; return true; }
            if (parentKey === 'children') parent.children[parentIdx] = sibling;
            else if (parentKey === 'group') parent.root = sibling;
            return true;
          }
          if (walk(n.children[i], n, 'children', i)) return true;
        }
      } else if (n.type === 'panelset' && Array.isArray(n.groups)) {
        for (let gi = 0; gi < n.groups.length; gi++) {
          const g = n.groups[gi];
          if (!g?.root) continue;
          if (g.root.id === targetId) {
            // panelset から該当 group を除去。B 案では groups.length === 1 でも解体しない
            n.groups.splice(gi, 1);
            if (n.groups.length === 0) {
              // 空 panelset → 親から除去（再帰）
              _detachNodeById(n.id);
            } else {
              // activeGroupId が消えた group を指していた場合、先頭に差し替え
              if (!n.groups.some(x => x && x.id === n.activeGroupId)) {
                n.activeGroupId = n.groups[0].id;
              }
            }
            return true;
          }
          if (walk(g.root, g, 'group')) return true;
        }
      }
      return false;
    }
    walk(_root, null, null, 0);
  }

  // 未アタッチの自由ノード（例: panelset から取り出した group.root）を
  // target の左/右に新カラムとして挿入。
  function insertFreeNodeAsColumn(newNode, targetId, position) {
    if (!newNode || !targetId) return false;
    if (position !== 'left' && position !== 'right') return false;
    const targetInfo = findNode(_root, targetId);
    if (!targetInfo) return false;
    const first = position === 'left' ? newNode : targetInfo.node;
    const second = position === 'left' ? targetInfo.node : newNode;
    const newSplit = createSplitNode('horizontal', 0.5, [first, second]);
    if (_root === targetInfo.node) {
      _root = newSplit;
    } else {
      _replaceNodeById(targetId, newSplit);
    }
    render();
    saveLayout();
    return true;
  }

  // 列 D&D の適用: source を target の左/右に新カラムとして挿入。
  // 同一ノードや包含関係では何もしない。
  // position: 'left' | 'right'
  function insertColumnAround(sourceId, targetId, position, options) {
    const opts = options || {};
    if (!sourceId || !targetId || sourceId === targetId) return false;
    if (position !== 'left' && position !== 'right') return false;
    const sourceInfo = findNode(_root, sourceId);
    const targetInfo = findNode(_root, targetId);
    if (!sourceInfo || !targetInfo) return false;
    // target が source のサブツリー内にある場合は不可
    if (findNode(sourceInfo.node, targetId)) return false;
    const before = !opts.skipHistory ? (opts.historyBefore || captureLayoutSnapshot()) : null;

    let sourceClone;
    try { sourceClone = JSON.parse(JSON.stringify(sourceInfo.node)); } catch { return false; }
    _detachNodeById(sourceId);

    const targetInfo2 = findNode(_root, targetId);
    if (!targetInfo2) return false;

    // target を新しい水平 split でラップ: [source, target] または [target, source]
    const first = position === 'left' ? sourceClone : targetInfo2.node;
    const second = position === 'left' ? targetInfo2.node : sourceClone;
    const newSplit = createSplitNode('horizontal', 0.5, [first, second]);

    if (_root === targetInfo2.node) {
      _root = newSplit;
    } else {
      _replaceNodeById(targetId, newSplit);
    }
    render();
    saveLayout();
    if (before) {
      pushLayoutHistory(
        opts.historyLabel || 'レイアウト: カラム移動',
        before,
        captureLayoutSnapshot(),
        opts.historyDetail || position || sourceId || ''
      );
    }
    return true;
  }

  // 列 D&D の適用: source を target の位置に合流させてパネルセット化。
  // 同一ノードや包含関係では何もしない。
  function applyColumnDrop(sourceId, targetId, options) {
    const opts = options || {};
    if (!sourceId || !targetId || sourceId === targetId) return false;
    if (typeof GBPanelSet === 'undefined') return false;
    const sourceInfo = findNode(_root, sourceId);
    const targetInfo = findNode(_root, targetId);
    if (!sourceInfo || !targetInfo) return false;
    // target が source のサブツリー内にある場合は不可
    if (findNode(sourceInfo.node, targetId)) return false;
    const before = !opts.skipHistory ? (opts.historyBefore || captureLayoutSnapshot()) : null;
    // source のツリーコピーを作ってから切り離し
    let sourceClone;
    try { sourceClone = JSON.parse(JSON.stringify(sourceInfo.node)); } catch { return false; }
    _detachNodeById(sourceId);
    // target が detach によって位置変化する可能性があるため再取得
    const targetInfo2 = findNode(_root, targetId);
    if (!targetInfo2) return false;
    const merged = GBPanelSet.mergeColumns(targetInfo2.node, sourceClone);
    if (!merged) return false;
    if (merged !== targetInfo2.node) {
      _replaceNodeById(targetId, merged);
    }
    render();
    saveLayout();
    if (before) {
      pushLayoutHistory(
        opts.historyLabel || 'レイアウト: カラム結合',
        before,
        captureLayoutSnapshot(),
        opts.historyDetail || sourceId || ''
      );
    }
    return true;
  }

  // === Public API ===
  return {
    init,
    render,
    renderNode,
    refreshPaneTabs,
    resetLayout,
    saveLayout,
    exportLayout,
    captureLayoutSnapshot,
    restoreLayoutSnapshot,
    pushLayoutHistory,
    applyLayoutTree,
    createPaneNode,
    createSplitNode,
    splitPane,
    splitRoot,
    removePane,
    setActivePane,
    findNode,
    findFirstPane,
    getAllPanes,
    isPaneVisible,
    isPaneLocked,
    hasLockedPane,
    findFirstUnlockedPane,
    revealPane,
    setPaneLocked,
    togglePaneLocked,
    updatePaneNavButtons: _updatePaneNavButtons,
    maximizePane,
    restoreMaximizedPane,
    isMaximized,
    applyColumnDrop,
    insertColumnAround,
    insertFreeNodeAsColumn,
    _findColumnAncestorId,
    _layoutInternal: {
      detachNodeById: _detachNodeById,
      replaceNodeById: _replaceNodeById,
    },
    get root() { return _root; },
    set root(v) { _root = v; },
    get activePane() { return _activePane; },
    get layoutLoadedFromStorage() { return _loadedLayoutFromStorage; },
    get paneMap() { return _paneMap; },
    get layoutEl() { return _layoutEl; },
    set onPreRender(fn) { _preRender = fn; },
    set onPostRender(fn) { _postRender = fn; },
    set onActivePaneChange(fn) { _onActivePaneChange = fn; },
    get isNavPaneType() { return _isNavPaneType; },
    set isNavPaneType(fn) { _isNavPaneType = fn; },
    get isPassivePaneType() { return _isPassivePaneType; },
    set isPassivePaneType(fn) { _isPassivePaneType = fn; },
    isMobileLayout: _isMobileLayout,
  };
})();
