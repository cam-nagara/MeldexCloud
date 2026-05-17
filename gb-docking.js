/* ==============================
   gb-docking.js: D&Dドッキングシステム（v5.0）
   5ゾーンドロップインジケータ
   ============================== */

const GBDocking = (() => {
  let _indicator = null;
  let _currentZone = null;
  let _currentTarget = null;
  let _rootListenersAttached = false;
  const TOOL_DROP_LABELS = {
    page: 'ノート',
    database: 'シート',
    scriptnote: 'シナリオ',
    board: 'ボード',
    calendar: 'カレンダー',
    preview: 'ビューワー',
    'smart-db': 'スマートシート',
    folder: 'フォルダ',
    outliner: 'フォルダツリー',
    chat: 'チャット',
    history: 'ヒストリー',
    annotation: '注釈',
    detail: 'オプション',
    search: '検索',
  };

  function _hasLockedPane() {
    return typeof GBLayout.hasLockedPane === 'function' && GBLayout.hasLockedPane();
  }

  function _isLockedPane(paneId) {
    return typeof GBLayout.isPaneLocked === 'function' && GBLayout.isPaneLocked(paneId);
  }

  function _showLayoutLockedStatus(message) {
    if (typeof showStatus === 'function') showStatus(message || 'ロック中のパネルは移動できません', true);
  }

  function _findLayoutNode(nodeId) {
    return (nodeId && typeof GBLayout?.findNode === 'function')
      ? GBLayout.findNode(GBLayout.root, nodeId)?.node
      : null;
  }

  function _layoutNodeHasLockedPane(nodeId) {
    return _nodeHasLockedPane(_findLayoutNode(nodeId));
  }

  function _groupHasLockedPane(panelsetId, groupId) {
    const panelset = _findLayoutNode(panelsetId);
    if (!panelset || panelset.type !== 'panelset') return false;
    const group = (panelset.groups || []).find(g => g && g.id === groupId);
    return _nodeHasLockedPane(group?.root);
  }

  function _targetColumnIdForPane(paneId) {
    return (typeof GBLayout?._findColumnAncestorId === 'function')
      ? GBLayout._findColumnAncestorId(paneId)
      : null;
  }

  function _parseDropJson(e, type) {
    try { return JSON.parse(e.dataTransfer.getData(type) || '{}'); } catch { return {}; }
  }

  // ドロップゾーン判定
  function getDropZone(paneEl, clientX, clientY) {
    const rect = paneEl.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    // 端から25%以内なら方向ゾーン
    const edgePct = 0.25;

    if (y < h * edgePct) return 'top';
    if (y > h * (1 - edgePct)) return 'bottom';
    if (x < w * edgePct) return 'left';
    if (x > w * (1 - edgePct)) return 'right';
    return 'center';
  }

  // インジケータ要素の作成
  function createIndicator() {
    if (_indicator) return _indicator;
    _indicator = document.createElement('div');
    _indicator.className = 'gb-drop-indicator';
    _indicator.style.display = 'none';
    document.body.appendChild(_indicator);
    return _indicator;
  }

  // インジケータの位置更新
  function updateIndicator(paneEl, zone) {
    const ind = createIndicator();
    const raw = paneEl.getBoundingClientRect();
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    const rect = { left: raw.left / z, top: raw.top / z, width: raw.width / z, height: raw.height / z, right: raw.right / z, bottom: raw.bottom / z };

    ind.style.display = 'block';
    switch (zone) {
      case 'top':
        ind.style.left = rect.left + 'px';
        ind.style.top = rect.top + 'px';
        ind.style.width = rect.width + 'px';
        ind.style.height = (rect.height * 0.4) + 'px';
        break;
      case 'bottom':
        ind.style.left = rect.left + 'px';
        ind.style.top = (rect.top + rect.height * 0.6) + 'px';
        ind.style.width = rect.width + 'px';
        ind.style.height = (rect.height * 0.4) + 'px';
        break;
      case 'left':
        ind.style.left = rect.left + 'px';
        ind.style.top = rect.top + 'px';
        ind.style.width = (rect.width * 0.4) + 'px';
        ind.style.height = rect.height + 'px';
        break;
      case 'right':
        ind.style.left = (rect.left + rect.width * 0.6) + 'px';
        ind.style.top = rect.top + 'px';
        ind.style.width = (rect.width * 0.4) + 'px';
        ind.style.height = rect.height + 'px';
        break;
      case 'center':
        ind.style.left = (rect.left + 4) + 'px';
        ind.style.top = (rect.top + 4) + 'px';
        ind.style.width = (rect.width - 8) + 'px';
        ind.style.height = (rect.height - 8) + 'px';
        break;
    }
  }

  function hideIndicator() {
    if (_indicator) _indicator.style.display = 'none';
    _currentZone = null;
    _currentTarget = null;
    _rootZone = null;
  }

  function _toolTabLabel(toolType) {
    return TOOL_DROP_LABELS[toolType] || toolType;
  }

  function _dropToolToPane(paneId, zone, toolType) {
    if (!paneId || !toolType) return;
    const label = _toolTabLabel(toolType);
    if (zone === 'center') {
      GBTabs.addTab(paneId, label, toolType, '');
      return;
    }
    const tab = GBTabs.createTab(label, toolType, '');
    const newPane = GBLayout.createPaneNode(null, [tab], 0);
    const newPaneId = GBLayout.splitPane(paneId, null, zone, newPane);
    if (newPaneId) {
      GBLayout.setActivePane(newPaneId);
    } else if (typeof showStatus === 'function') {
      showStatus('分割上限に達しました', true);
    }
  }

  function _dropToolToRoot(zone, toolType) {
    if (!zone || !toolType) return;
    const tab = GBTabs.createTab(_toolTabLabel(toolType), toolType, '');
    const newPane = GBLayout.createPaneNode(null, [tab], 0);
    if (!GBLayout.splitRoot(zone, newPane)) return;
    GBLayout.setActivePane(newPane.id);
  }

  function _isRootDockDrop(e) {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return types.includes('application/x-gb-tab') ||
      types.includes('application/meldex-tool') ||
      (types.includes('application/x-meldex-node') && e.ctrlKey);
  }

  // ドロップ処理
  function handleDrop(targetPaneId, zone, data) {
    if (!data) return;
    if (_isLockedPane(targetPaneId)) {
      if (typeof showStatus === 'function') showStatus('ロック中のパネルには追加できません', true);
      return;
    }

    if (data.tabId && data.paneId) {
      if (_isLockedPane(data.paneId) && (data.paneId !== targetPaneId || zone !== 'center')) {
        if (typeof showStatus === 'function') showStatus('ロック中のパネルからタブは移動できません', true);
        return;
      }
      // 同ペインへのcenterドロップは並べ替え扱い（moveTabが処理）
      // タブの移動
      if (zone === 'center') {
        // 既存ペインのタブとして追加
        GBTabs.moveTab(data.paneId, data.tabId, targetPaneId);
      } else {
        // 新しいスプリットを作成
        const paneInfo = GBLayout.findNode(GBLayout.root, data.paneId);
        if (!paneInfo) return;
        const pane = paneInfo.node;
        const tabIdx = pane.tabs.findIndex(t => t.id === data.tabId);
        if (tabIdx < 0) return;
        const sourceTab = pane.tabs[tabIdx];
        const duplicateSingleTab = data.paneId === targetPaneId && pane.tabs.length <= 1;
        const cloneTabState = (state) => {
          if (!state || typeof state !== 'object') return state || {};
          if (typeof structuredClone === 'function') {
            try { return structuredClone(state); } catch {}
          }
          try { return JSON.parse(JSON.stringify(state)); } catch {}
          return { ...state };
        };
        const before = typeof GBLayout.captureLayoutSnapshot === 'function' ? GBLayout.captureLayoutSnapshot() : null;
        const tab = duplicateSingleTab
          ? GBTabs.createTab(sourceTab.label, sourceTab.type, sourceTab.path, cloneTabState(sourceTab.state))
          : pane.tabs.splice(tabIdx, 1)[0];

        // 新ペインを作成してタブを配置
        const newPane = GBLayout.createPaneNode(null, [tab], 0);
        const splitResult = GBLayout.splitPane(targetPaneId, null, zone, newPane, { skipHistory: true });
        // MAX_DEPTH到達等でsplit失敗 → タブを元ペインに戻す
        if (!splitResult) {
          if (!duplicateSingleTab) pane.tabs.splice(tabIdx, 0, tab);
          showStatus && showStatus('分割上限に達しました', true);
          return;
        }

        // 元ペインが空になった場合
        if (!duplicateSingleTab && pane.tabs.length === 0) {
          if (pane.activeTabIndex >= 0) pane.activeTabIndex = -1;
          const allPanes = GBLayout.getAllPanes(GBLayout.root);
          if (allPanes.length > 1) {
            GBLayout.removePane(data.paneId, { skipHistory: true });
          }
        } else if (!duplicateSingleTab) {
          if (tabIdx < pane.activeTabIndex) {
            pane.activeTabIndex--;
          } else if (pane.activeTabIndex >= pane.tabs.length) {
            pane.activeTabIndex = pane.tabs.length - 1;
          }
          GBLayout.render();
          GBLayout.saveLayout();
        } else {
          GBLayout.render();
          GBLayout.saveLayout();
        }

        GBLayout.setActivePane(newPane.id);
        if (before && typeof GBLayout.pushLayoutHistory === 'function') {
          GBLayout.pushLayoutHistory('レイアウト: タブを分割移動', before, GBLayout.captureLayoutSnapshot(), tab.label || tab.path || '');
        }
      }
    } else if (data.paneId && !data.tabId) {
      // ペイン単独の移動。zone に応じてディスパッチ:
      //   center              → applyColumnDrop で対象カラムへマージ（panelset 化）
      //   top/bottom/left/right → ソースペインを detach し、対象ペインの該当位置に分割挿入
      if (data.paneId === targetPaneId) return;
      // ロック中のペインからは移動不可（タブ移動と同じガード）
      if (_isLockedPane(data.paneId)) {
        if (typeof showStatus === 'function') showStatus('ロック中のパネルからは移動できません', true);
        return;
      }
      const findCol = (id) => (typeof GBLayout._findColumnAncestorId === 'function'
        ? GBLayout._findColumnAncestorId(id) : null);
      const targetColumnId = findCol(targetPaneId);
      const sourceColumnId = findCol(data.paneId);

      if (zone === 'center') {
        if (typeof GBLayout?.applyColumnDrop !== 'function') return;
        const targetId = targetColumnId || targetPaneId;
        // 同一カラム内へのドロップは無効（applyColumnDrop の detach が target を巻き込んで破壊するため）
        if (sourceColumnId && sourceColumnId === targetId) return;
        if (data.paneId === targetId) return;
        GBLayout.applyColumnDrop(data.paneId, targetId);
        return;
      }

      // top/bottom/left/right: ソースペインのタブを新ペインに移動し、対象ペインの該当位置へ splitPane で挿入、
      // 元ペインが空になれば removePane で片付ける（タブ移動と同じフロー）。
      const sourceInfo = GBLayout.findNode(GBLayout.root, data.paneId);
      if (!sourceInfo) return;
      const sourcePane = sourceInfo.node;
      if (!sourcePane || !Array.isArray(sourcePane.tabs) || sourcePane.tabs.length === 0) return;
      const before = typeof GBLayout.captureLayoutSnapshot === 'function' ? GBLayout.captureLayoutSnapshot() : null;
      const movingTabs = sourcePane.tabs.splice(0, sourcePane.tabs.length);
      const savedActiveIdx = Math.max(0, Math.min(sourcePane.activeTabIndex || 0, movingTabs.length - 1));
      const newPane = GBLayout.createPaneNode(null, movingTabs, savedActiveIdx);
      const splitResult = GBLayout.splitPane(targetPaneId, null, zone, newPane, { skipHistory: true });
      if (!splitResult) {
        // 失敗時はロールバック: 元ペインのタブを復元
        sourcePane.tabs.push(...movingTabs);
        if (typeof showStatus === 'function') showStatus('分割上限に達しました', true);
        return;
      }
      // 元ペインが空になったので削除（ただし全ペイン数が 1 以下にならない場合のみ）
      const allPanes = GBLayout.getAllPanes(GBLayout.root);
      if (allPanes.length > 1) {
        GBLayout.removePane(data.paneId, { skipHistory: true });
      } else {
        GBLayout.render();
        GBLayout.saveLayout();
      }
      GBLayout.setActivePane(newPane.id);
      if (before && typeof GBLayout.pushLayoutHistory === 'function') {
        GBLayout.pushLayoutHistory('レイアウト: パネル移動', before, GBLayout.captureLayoutSnapshot(), newPane.id || '');
      }
    }
  }

  // ルートレベル横断ドロップ（ウィンドウ端30px以内）
  const ROOT_EDGE = 30;
  let _rootZone = null;

  function _getRootEdgeZone(clientX, clientY) {
    const layoutEl = document.getElementById('gb-layout-root');
    if (!layoutEl) return null;
    const rect = layoutEl.getBoundingClientRect();
    if (clientY - rect.top < ROOT_EDGE) return 'top';
    if (rect.bottom - clientY < ROOT_EDGE) return 'bottom';
    if (clientX - rect.left < ROOT_EDGE) return 'left';
    if (rect.right - clientX < ROOT_EDGE) return 'right';
    return null;
  }

  function _showRootIndicator(zone) {
    const layoutEl = document.getElementById('gb-layout-root');
    if (!layoutEl) return;
    const ind = createIndicator();
    const raw = layoutEl.getBoundingClientRect();
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    const rect = { left: raw.left / z, top: raw.top / z, width: raw.width / z, height: raw.height / z, right: raw.right / z, bottom: raw.bottom / z };
    ind.style.display = 'block';
    const thickness = 6;
    switch (zone) {
      case 'top':
        ind.style.left = rect.left + 'px'; ind.style.top = rect.top + 'px';
        ind.style.width = rect.width + 'px'; ind.style.height = thickness + 'px'; break;
      case 'bottom':
        ind.style.left = rect.left + 'px'; ind.style.top = (rect.bottom - thickness) + 'px';
        ind.style.width = rect.width + 'px'; ind.style.height = thickness + 'px'; break;
      case 'left':
        ind.style.left = rect.left + 'px'; ind.style.top = rect.top + 'px';
        ind.style.width = thickness + 'px'; ind.style.height = rect.height + 'px'; break;
      case 'right':
        ind.style.left = (rect.right - thickness) + 'px'; ind.style.top = rect.top + 'px';
        ind.style.width = thickness + 'px'; ind.style.height = rect.height + 'px'; break;
    }
  }

  // 全ペインにドロップターゲットを設定
  // カラム D&D: Shift+ドラッグ（gb-layout.part01.js の dragHandle dragstart で
  // application/x-gb-column ペイロードをセット済み）。ドロップは各ペインの
  // dragover/drop で center ゾーン判定時に受理。
  // カラムドラッグ用のインジケーター: 対象カラム全体をハイライトする。
  // ペイン基準ではなく「カラム = 水平スプリットの直接の子」全体を覆う。
  function _columnElementById(columnId) {
    if (!columnId) return null;
    const id = CSS.escape(columnId);
    return document.querySelector(`[data-column-node-id="${id}"]`)
      || document.querySelector(`[data-pane-id="${id}"]`)
      || document.querySelector(`[data-split-id="${id}"]`);
  }

  function _openTypeForDroppedNode(type) {
    return type === 'database' ? 'pivot' : (type || 'page');
  }

  function _droppedMeldexItems(e) {
    const nodeData = e.ctrlKey ? e.dataTransfer.getData('application/x-meldex-node') : '';
    if (!nodeData) return [];
    try {
      const parsed = JSON.parse(nodeData);
      const rawItems = Array.isArray(parsed?.items) && parsed.items.length ? parsed.items : [parsed];
      return rawItems.map(item => ({
        name: String(item?.name || item?.path || 'ノート').trim() || 'ノート',
        path: String(item?.path || '').trim(),
        type: _openTypeForDroppedNode(item?.type || 'page'),
      })).filter(item => item.path);
    } catch {
      return [];
    }
  }

  function _tabForDroppedNode(item) {
    return GBTabs.createTab(item.name, item.type, item.path);
  }

  function _openDroppedNodesAtRoot(zone, items) {
    if (!Array.isArray(items) || !items.length) return false;
    const tabs = items.map(_tabForDroppedNode);
    const newPane = GBLayout.createPaneNode(null, tabs, 0);
    if (!GBLayout.splitRoot(zone, newPane)) return false;
    GBLayout.setActivePane(newPane.id, { sync: true });
    const active = items[0];
    if (active && typeof navOpen === 'function') navOpen({ type: active.type, label: active.name, path: active.path });
    return true;
  }

  function _openDroppedNodesInPane(paneId, zone, items) {
    if (!paneId || !Array.isArray(items) || !items.length) return false;
    if (zone === 'center') {
      let opened = false;
      let lastOpened = null;
      for (const item of items) {
        if (GBTabs.addTab(paneId, item.name, item.type, item.path)) {
          opened = true;
          lastOpened = item;
        }
      }
      if (opened && lastOpened && typeof navOpen === 'function') {
        navOpen({ type: lastOpened.type, label: lastOpened.name, path: lastOpened.path });
      }
      return opened;
    }
    const tabs = items.map(_tabForDroppedNode);
    const newPane = GBLayout.createPaneNode(null, tabs, 0);
    const newPaneId = GBLayout.splitPane(paneId, null, zone, newPane);
    if (!newPaneId) {
      if (typeof showStatus === 'function') showStatus('分割上限に達しました', true);
      return false;
    }
    GBLayout.setActivePane(newPaneId, { sync: true });
    const active = items[0];
    if (active && typeof navOpen === 'function') navOpen({ type: active.type, label: active.name, path: active.path });
    return true;
  }

  function _nodeHasLockedPane(node) {
    if (!node) return false;
    if (node.type === 'pane') return _isLockedPane(node.id);
    if (node.type === 'split' && Array.isArray(node.children)) {
      return node.children.some(child => _nodeHasLockedPane(child));
    }
    if (node.type === 'panelset' && Array.isArray(node.groups)) {
      return node.groups.some(group => _nodeHasLockedPane(group?.root));
    }
    return false;
  }

  function _columnHasLockedPane(columnId) {
    const info = (typeof GBLayout?.findNode === 'function')
      ? GBLayout.findNode(GBLayout.root, columnId)
      : null;
    return _nodeHasLockedPane(info?.node);
  }

  function _updateColumnIndicator(paneEl) {
    if (!paneEl) return;
    const targetColumnId = typeof GBLayout?._findColumnAncestorId === 'function'
      ? GBLayout._findColumnAncestorId(paneEl.dataset.paneId)
      : null;
    const columnEl = _columnElementById(targetColumnId);
    const refEl = columnEl || paneEl;
    const ind = createIndicator();
    const raw = refEl.getBoundingClientRect();
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    const rect = { left: raw.left / z, top: raw.top / z, width: raw.width / z, height: raw.height / z };
    ind.style.display = 'block';
    ind.style.left = (rect.left + 4) + 'px';
    ind.style.top = (rect.top + 4) + 'px';
    ind.style.width = Math.max(0, rect.width - 8) + 'px';
    ind.style.height = Math.max(0, rect.height - 8) + 'px';
  }

  function _setupColumnDropOnPanes() {
    const panes = document.querySelectorAll('.gb-pane');
    panes.forEach((paneEl) => {
      const paneId = paneEl.dataset.paneId;
      paneEl.addEventListener('dragover', (e) => {
        const types = e.dataTransfer.types;
        const isColumn = types.includes('application/x-gb-column');
        const isGroup = types.includes('application/x-gb-panelset-group');
        if (!isColumn && !isGroup) return;
        const targetColumnId = _targetColumnIdForPane(paneId) || paneId;
        if (_columnHasLockedPane(targetColumnId)) {
          hideIndicator();
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // カラム/グループ両方で left/right 新カラム挿入、center で合流
        const z = getDropZone(paneEl, e.clientX, e.clientY);
        const zone = (z === 'left' || z === 'right') ? z : 'center';
        if (paneId !== _currentTarget || _currentZone !== ('col-' + zone)) {
          _currentTarget = paneId;
          _currentZone = 'col-' + zone;
          if (zone === 'center') {
            _updateColumnIndicator(paneEl);
          } else {
            _updateColumnEdgeIndicator(paneEl, zone);
          }
        }
      });
      paneEl.addEventListener('dragleave', (e) => {
        const types = e.dataTransfer.types;
        if (!types.includes('application/x-gb-column') && !types.includes('application/x-gb-panelset-group')) return;
        if (!paneEl.contains(e.relatedTarget)) {
          if (typeof _currentZone === 'string' && _currentZone.indexOf('col-') === 0) hideIndicator();
        }
      });
      paneEl.addEventListener('drop', (e) => {
        const types = e.dataTransfer.types;
        const isColumn = types.includes('application/x-gb-column');
        const isGroup = types.includes('application/x-gb-panelset-group');
        if (!isColumn && !isGroup) return;
        e.preventDefault();
        e.stopPropagation();
        hideIndicator();
        const targetColumnId = _targetColumnIdForPane(paneId) || paneId;
        if (_columnHasLockedPane(targetColumnId)) {
          if (typeof showStatus === 'function') showStatus('ロック中のパネルには追加できません', true);
          return;
        }
        try {
          const z = getDropZone(paneEl, e.clientX, e.clientY);
          const isEdge = (z === 'left' || z === 'right');
          if (isGroup) {
            const data = _parseDropJson(e, 'application/x-gb-panelset-group');
            if (!data.groupId || !paneId) return;
            if (_groupHasLockedPane(data.panelsetId, data.groupId)) {
              _showLayoutLockedStatus('ロック中のパネルを含むグループは移動できません');
              return;
            }
            if (isEdge && typeof GBPanelSet?.insertGroupAsColumn === 'function') {
              GBPanelSet.insertGroupAsColumn(data.panelsetId, data.groupId, paneId, z);
            } else if (typeof GBPanelSet?.dropGroupOnPane === 'function') {
              GBPanelSet.dropGroupOnPane(data.panelsetId, data.groupId, paneId);
            }
            return;
          }
          const data = _parseDropJson(e, 'application/x-gb-column');
          if (!data.nodeId || !paneId) return;
          if (_layoutNodeHasLockedPane(data.nodeId)) {
            _showLayoutLockedStatus('ロック中のパネルを含むカラムは移動できません');
            return;
          }
          const targetId = targetColumnId;
          if (data.nodeId === targetId) return;
          if (isEdge && typeof GBLayout?.insertColumnAround === 'function') {
            GBLayout.insertColumnAround(data.nodeId, targetId, z);
          } else if (typeof GBLayout?.applyColumnDrop === 'function') {
            GBLayout.applyColumnDrop(data.nodeId, targetId);
          }
        } catch {}
      });
    });
  }

  function _boundaryDropTarget(handleEl, e) {
    const leftId = handleEl?.dataset?.columnDropLeftId || '';
    const rightId = handleEl?.dataset?.columnDropRightId || '';
    if (!leftId || !rightId) return null;
    const rect = handleEl.getBoundingClientRect();
    const useLeftSide = e.clientX < rect.left + rect.width / 2;
    return useLeftSide
      ? { targetId: leftId, side: 'right' }
      : { targetId: rightId, side: 'left' };
  }

  function _setupColumnDropOnSplitHandles() {
    document.querySelectorAll('.gb-split-horizontal > .gb-split-handle[data-column-drop-left-id][data-column-drop-right-id]').forEach((handleEl) => {
      handleEl.addEventListener('dragover', (e) => {
        const types = e.dataTransfer?.types;
        const isColumn = types?.includes?.('application/x-gb-column');
        const isGroup = types?.includes?.('application/x-gb-panelset-group');
        if (!isColumn && !isGroup) return;
        const target = _boundaryDropTarget(handleEl, e);
        if (!target?.targetId || _columnHasLockedPane(target.targetId)) {
          hideIndicator();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const key = `boundary-${target.targetId}-${target.side}`;
        if (_currentTarget !== target.targetId || _currentZone !== key) {
          _currentTarget = target.targetId;
          _currentZone = key;
          const columnEl = _columnElementById(target.targetId) || handleEl;
          showEdgeIndicator(columnEl, target.side);
        }
      });
      handleEl.addEventListener('dragleave', (e) => {
        const types = e.dataTransfer?.types;
        if (!types?.includes?.('application/x-gb-column') && !types?.includes?.('application/x-gb-panelset-group')) return;
        if (!handleEl.contains(e.relatedTarget)) hideIndicator();
      });
      handleEl.addEventListener('drop', (e) => {
        const types = e.dataTransfer?.types;
        const isColumn = types?.includes?.('application/x-gb-column');
        const isGroup = types?.includes?.('application/x-gb-panelset-group');
        if (!isColumn && !isGroup) return;
        const target = _boundaryDropTarget(handleEl, e);
        if (!target?.targetId) return;
        e.preventDefault();
        e.stopPropagation();
        hideIndicator();
        if (_columnHasLockedPane(target.targetId)) {
          if (typeof showStatus === 'function') showStatus('ロック中のパネルには追加できません', true);
          return;
        }
        try {
          if (isGroup) {
            const data = _parseDropJson(e, 'application/x-gb-panelset-group');
            if (!data.panelsetId || !data.groupId) return;
            if (_groupHasLockedPane(data.panelsetId, data.groupId)) {
              _showLayoutLockedStatus('ロック中のパネルを含むグループは移動できません');
              return;
            }
            if (typeof GBPanelSet?.insertGroupAsColumn === 'function') {
              GBPanelSet.insertGroupAsColumn(data.panelsetId, data.groupId, target.targetId, target.side);
            }
            return;
          }
          const data = _parseDropJson(e, 'application/x-gb-column');
          if (!data.nodeId || data.nodeId === target.targetId) return;
          if (_layoutNodeHasLockedPane(data.nodeId)) {
            _showLayoutLockedStatus('ロック中のパネルを含むカラムは移動できません');
            return;
          }
          if (typeof GBLayout?.insertColumnAround === 'function') {
            GBLayout.insertColumnAround(data.nodeId, target.targetId, target.side);
          }
        } catch {}
      });
    });
  }

  // カラムの該当辺(left/right)をハイライト（新カラム挿入位置を示す太い縦バー）
  function _updateColumnEdgeIndicator(paneEl, side) {
    if (!paneEl) return;
    const targetColumnId = typeof GBLayout?._findColumnAncestorId === 'function'
      ? GBLayout._findColumnAncestorId(paneEl.dataset.paneId)
      : null;
    const columnEl = _columnElementById(targetColumnId);
    const refEl = columnEl || paneEl;
    const ind = createIndicator();
    const raw = refEl.getBoundingClientRect();
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    const rect = { left: raw.left / z, top: raw.top / z, width: raw.width / z, height: raw.height / z };
    ind.style.display = 'block';
    ind.style.top = (rect.top + 4) + 'px';
    ind.style.height = Math.max(0, rect.height - 8) + 'px';
    const barW = 6;
    if (side === 'left') {
      ind.style.left = (rect.left - barW / 2) + 'px';
      ind.style.width = barW + 'px';
    } else {
      ind.style.left = (rect.left + rect.width - barW / 2) + 'px';
      ind.style.width = barW + 'px';
    }
  }

  // グローバル安全網: 何らかの理由で個別 dragend が発火しなかった場合でも
  // ドラッグ終了時に必ずインジケーターを消す
  let _globalDragEndAttached = false;
  function _ensureGlobalDragEnd() {
    if (_globalDragEndAttached) return;
    _globalDragEndAttached = true;
    document.addEventListener('dragend', () => { hideIndicator(); }, true);
    // 一部ブラウザで dragend が発火しないケースの保険
    document.addEventListener('drop', () => { setTimeout(hideIndicator, 0); }, true);
  }

  function setupDropTargets() {
    _ensureGlobalDragEnd();
    _setupColumnDropOnPanes();
    _setupColumnDropOnSplitHandles();
    // ルートレベルのエッジドロップ（1回だけ登録）
    const layoutEl = document.getElementById('gb-layout-root');
    if (layoutEl && !_rootListenersAttached) {
      _rootListenersAttached = true;
      // キャプチャフェーズで先に処理（ペインのdragoverより優先）
      layoutEl.addEventListener('dragover', (e) => {
        if (!_isRootDockDrop(e)) return;
        if (_hasLockedPane()) {
          if (_rootZone) { _rootZone = null; hideIndicator(); }
          return;
        }
        // タブバー内のドラッグはタブ並び替えに委ねる
        if (e.target.closest('.gb-pane-tabs')) {
          if (_rootZone) { _rootZone = null; hideIndicator(); }
          return;
        }
        const rz = _getRootEdgeZone(e.clientX, e.clientY);
        if (rz) {
          e.preventDefault();
          e.stopPropagation();
          if (rz !== _rootZone) { _rootZone = rz; _showRootIndicator(rz); }
        } else {
          if (_rootZone) { _rootZone = null; hideIndicator(); }
        }
      }, true);
      layoutEl.addEventListener('drop', (e) => {
        if (!_isRootDockDrop(e)) return;
        if (e.target.closest('.gb-pane-tabs')) return;
        const rz = _getRootEdgeZone(e.clientX, e.clientY);
        if (!rz) return;
        if (_hasLockedPane()) {
          hideIndicator();
          _rootZone = null;
          if (typeof showStatus === 'function') showStatus('ロック中のパネルがあるため外側へ新しいパネルを追加できません', true);
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        hideIndicator();
        _rootZone = null;

        const toolType = e.dataTransfer.getData('application/meldex-tool');
        if (toolType) {
          _dropToolToRoot(rz, toolType);
          return;
        }

        // タブD&D
        const tabData = e.dataTransfer.getData('application/x-gb-tab');
        if (tabData) {
          try {
            const data = JSON.parse(tabData);
            const paneInfo = GBLayout.findNode(GBLayout.root, data.paneId);
            if (!paneInfo) return;
            const pane = paneInfo.node;
            const tabIdx = pane.tabs.findIndex(t => t.id === data.tabId);
            if (tabIdx < 0) return;
            const before = typeof GBLayout.captureLayoutSnapshot === 'function' ? GBLayout.captureLayoutSnapshot() : null;
            const [tab] = pane.tabs.splice(tabIdx, 1);
            const newPane = GBLayout.createPaneNode(null, [tab], 0);
            if (!GBLayout.splitRoot(rz, newPane, { skipHistory: true })) { pane.tabs.splice(tabIdx, 0, tab); return; }
            if (pane.tabs.length === 0) {
              const allPanes = GBLayout.getAllPanes(GBLayout.root);
              if (allPanes.length > 1) GBLayout.removePane(data.paneId, { skipHistory: true });
            } else {
              if (tabIdx < pane.activeTabIndex) pane.activeTabIndex--;
              else if (pane.activeTabIndex >= pane.tabs.length) pane.activeTabIndex = pane.tabs.length - 1;
            }
            GBLayout.setActivePane(newPane.id);
            if (before && typeof GBLayout.pushLayoutHistory === 'function') {
              GBLayout.pushLayoutHistory('レイアウト: 外側へタブ移動', before, GBLayout.captureLayoutSnapshot(), tab.label || tab.path || '');
            }
          } catch {}
          return;
        }
        // フォルダツリーノード Ctrl+ドロップ
        const droppedItems = _droppedMeldexItems(e);
        if (droppedItems.length) {
          _openDroppedNodesAtRoot(rz, droppedItems);
        }
      }, true);
      layoutEl.addEventListener('dragleave', (e) => {
        if (!layoutEl.contains(e.relatedTarget)) { hideIndicator(); _rootZone = null; }
      }, true);
    }

    const panes = document.querySelectorAll('.gb-pane');
    panes.forEach(paneEl => {
      const paneId = paneEl.dataset.paneId;

      paneEl.addEventListener('dragover', (e) => {
        // タブまたはペインのD&Dのみ受け入れ
        // フォルダツリーノードはCtrl+ドラッグ時のみ（通常は各ビュー固有ハンドラに委ねる）
        if (!e.dataTransfer.types.includes('application/x-gb-tab') &&
            !e.dataTransfer.types.includes('application/x-gb-pane') &&
            !e.dataTransfer.types.includes('application/meldex-tool') &&
            !(e.dataTransfer.types.includes('application/x-meldex-node') && e.ctrlKey)) return;

        // 編集領域上ではリンク挿入が優先（Ctrl+ドラッグ以外）
        if (e.target.closest('[contenteditable="true"]') &&
            !e.ctrlKey &&
            e.dataTransfer.types.includes('application/x-meldex-node')) {
          hideIndicator();
          return;
        }

        if (_isLockedPane(paneId)) {
          hideIndicator();
          return;
        }

        // タブバー内でのドラッグはタブ並び替え処理に委ねる（分割インジケータを出さない）
        if (e.target.closest('.gb-pane-tabs')) {
          // ただし drop を受け取れるよう preventDefault は呼ぶ
          e.preventDefault();
          hideIndicator();
          return;
        }

        e.preventDefault();
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/meldex-tool') ? 'copy' : 'move';

        const zone = getDropZone(paneEl, e.clientX, e.clientY);
        if (zone !== _currentZone || paneId !== _currentTarget) {
          _currentZone = zone;
          _currentTarget = paneId;
          updateIndicator(paneEl, zone);
        }
      });

      paneEl.addEventListener('dragleave', (e) => {
        if (!paneEl.contains(e.relatedTarget)) {
          hideIndicator();
        }
      });

      paneEl.addEventListener('drop', (e) => {
        // 編集領域上でのmeldex-nodeドロップ（Ctrl なし）はエディタ側に委ねる
        if (e.target.closest('[contenteditable="true"]') &&
            !e.ctrlKey &&
            e.dataTransfer.types.includes('application/x-meldex-node') &&
            !e.dataTransfer.types.includes('application/x-gb-tab') &&
            !e.dataTransfer.types.includes('application/meldex-tool')) {
          return;
        }

        e.preventDefault();
        hideIndicator();

        if (_isLockedPane(paneId)) {
          if (typeof showStatus === 'function') showStatus('ロック中のパネルには追加できません', true);
          return;
        }

        const zone = getDropZone(paneEl, e.clientX, e.clientY);

        const toolType = e.dataTransfer.getData('application/meldex-tool');
        if (toolType) {
          e.stopPropagation();
          _dropToolToPane(paneId, zone, toolType);
          return;
        }

        // タブD&D
        const tabData = e.dataTransfer.getData('application/x-gb-tab');
        if (tabData) {
          try {
            const data = JSON.parse(tabData);
            handleDrop(paneId, zone, data);
          } catch {}
          return;
        }

        // ペインD&D
        const paneData = e.dataTransfer.getData('application/x-gb-pane');
        if (paneData) {
          try {
            const data = JSON.parse(paneData);
            handleDrop(paneId, zone, data);
          } catch {}
          return;
        }

        // フォルダツリーノードD&D（Ctrl+ドロップ時のみファイルを開く）
        const droppedItems = _droppedMeldexItems(e);
        if (droppedItems.length) {
          _openDroppedNodesInPane(paneId, zone, droppedItems);
        }
      });
    });
  }

  // 任意の要素の左/右辺にエッジインジケータ（新カラム挿入位置）を表示する公開 API。
  // side: 'left' | 'right'
  function showEdgeIndicator(el, side) {
    if (!el) return;
    const ind = createIndicator();
    const raw = el.getBoundingClientRect();
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    const rect = { left: raw.left / z, top: raw.top / z, width: raw.width / z, height: raw.height / z };
    ind.style.display = 'block';
    ind.style.top = (rect.top + 4) + 'px';
    ind.style.height = Math.max(0, rect.height - 8) + 'px';
    const barW = 6;
    if (side === 'left') {
      ind.style.left = (rect.left - barW / 2) + 'px';
    } else {
      ind.style.left = (rect.left + rect.width - barW / 2) + 'px';
    }
    ind.style.width = barW + 'px';
  }

  return {
    setupDropTargets,
    hideIndicator,
    getDropZone,
    showEdgeIndicator,
    hasLockedPaneInNode: _layoutNodeHasLockedPane,
    hasLockedPaneInGroup: _groupHasLockedPane,
  };
})();
