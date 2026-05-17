// gb-panelset.js — パネルセット（CSP ドック相当）
// 構造: 列（水平スプリットの子 or 単独ルート）の位置に、複数の列構成（groups）
//       を重ねて保持し、アイコンタブバーで切り替える。
// 生成: 列ヘッダ間の D&D で自動生成（gb-docking.js 側）。
// 解体: groups が 1 件になったら自動解体し、その唯一の group.root を親に戻す。
(function() {
  'use strict';

  let _groupIdCounter = 0;
  let _panelsetIdCounter = 0;

  function _nextPanelsetId() {
    _panelsetIdCounter += 1;
    return 'panelset-' + Date.now().toString(36) + '-' + _panelsetIdCounter;
  }
  function _nextGroupId() {
    _groupIdCounter += 1;
    return 'group-' + Date.now().toString(36) + '-' + _groupIdCounter;
  }

  function createGroup(root) {
    return { id: _nextGroupId(), root: root || null };
  }

  function createPanelSetNode(groups, activeGroupId) {
    const list = Array.isArray(groups) ? groups.filter(Boolean) : [];
    return {
      type: 'panelset',
      id: _nextPanelsetId(),
      activeGroupId: activeGroupId || list[0]?.id || null,
      groups: list,
    };
  }

  function _capturePanelsetLayoutHistory() {
    return (typeof GBLayout !== 'undefined' && typeof GBLayout.captureLayoutSnapshot === 'function')
      ? GBLayout.captureLayoutSnapshot()
      : null;
  }

  function _pushPanelsetLayoutHistory(label, beforeSnapshot, detail) {
    if (!beforeSnapshot || typeof GBLayout === 'undefined' || typeof GBLayout.pushLayoutHistory !== 'function') return;
    GBLayout.pushLayoutHistory(label, beforeSnapshot, GBLayout.captureLayoutSnapshot(), detail || '');
  }

  // グループ内のすべてのペインのすべてのタブの type を列挙（アイコン合成用、
  // 順序保持。ペイン配下のタブ順 → ペイン順 → 深度優先）。
  function collectGroupTabTypes(groupRoot) {
    const out = [];
    function walk(node) {
      if (!node) return;
      if (node.type === 'pane') {
        (node.tabs || []).forEach(t => { if (t?.type) out.push(t.type); });
        return;
      }
      if (node.type === 'split' && Array.isArray(node.children)) {
        node.children.forEach(walk);
      }
      if (node.type === 'panelset' && Array.isArray(node.groups)) {
        const active = node.groups.find(g => g && g.id === node.activeGroupId);
        if (active?.root) walk(active.root);
      }
    }
    walk(groupRoot);
    return out;
  }

  // アイコンボタン生成。そのグループに含まれるタブ種別を合成アイコンとして並べる。
  function renderGroupIconButton(panelsetNode, group) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gb-panelset-icon' + (group.id === panelsetNode.activeGroupId ? ' active' : '');
    btn.dataset.groupId = group.id;
    btn.dataset.panelsetId = panelsetNode.id;
    btn.dataset.e2eId = `panelset-${panelsetNode.id}-group-${group.id}`;
    btn.draggable = true;
    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-gb-panelset-group', JSON.stringify({
        panelsetId: panelsetNode.id, groupId: group.id,
      }));
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
    });
    // ドロップ受理失敗時のインジケータ残留を防ぐ
    btn.addEventListener('dragend', () => {
      if (typeof GBDocking !== 'undefined' && typeof GBDocking.hideIndicator === 'function') {
        GBDocking.hideIndicator();
      }
      btn.classList.remove('gb-panelset-drop-before', 'gb-panelset-drop-after');
      document.querySelectorAll('.gb-panelset-tabbar-drop').forEach(el => el.classList.remove('gb-panelset-tabbar-drop'));
      document.querySelectorAll('.gb-panelset-tabbar[data-drop-side]').forEach(el => el.removeAttribute('data-drop-side'));
    });
    // 別グループの上にドラッグ → 挿入位置インジケータ
    // 注: stopPropagation は呼ばない（親タブバーの dragover にも届かせてカラム間判定を有効化）
    btn.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-gb-panelset-group')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = btn.getBoundingClientRect();
      const isBefore = (e.clientX - rect.left) < rect.width / 2;
      btn.classList.toggle('gb-panelset-drop-before', isBefore);
      btn.classList.toggle('gb-panelset-drop-after', !isBefore);
    });
    btn.addEventListener('dragleave', () => {
      btn.classList.remove('gb-panelset-drop-before', 'gb-panelset-drop-after');
    });
    btn.addEventListener('drop', (e) => {
      if (!e.dataTransfer.types.includes('application/x-gb-panelset-group')) return;
      // 親タブバーが side='left'/'right' を設定している場合はそちらに委ねる
      const parentBar = btn.closest('.gb-panelset-tabbar');
      const parentSide = parentBar?.dataset?.dropSide;
      if (parentSide === 'left' || parentSide === 'right') {
        // 親の drop ハンドラに処理を任せる（bubbling で実行される）。
        // ブラウザのデフォルト drop 動作を抑止するために preventDefault は呼ぶが、
        // stopPropagation は呼ばず親へ bubble する。
        e.preventDefault();
        btn.classList.remove('gb-panelset-drop-before', 'gb-panelset-drop-after');
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      btn.classList.remove('gb-panelset-drop-before', 'gb-panelset-drop-after');
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/x-gb-panelset-group') || '{}');
        if (!data.groupId) return;
        if (data.groupId === group.id && data.panelsetId === panelsetNode.id) return;
        const rect = btn.getBoundingClientRect();
        const pos = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';
        reorderOrMoveGroup(data.panelsetId, data.groupId, panelsetNode.id, group.id, pos);
      } catch {}
    });
    const types = collectGroupTabTypes(group.root);
    btn.title = (types.join(' / ') || '(空)') + '\nAlt+ドラッグ: 別カラムに移動';
    const iconBox = document.createElement('span');
    iconBox.className = 'gb-panelset-icon-box';
    types.forEach((type) => {
      const iconName = (typeof GBTabs !== 'undefined' && typeof GBTabs.tabIcon === 'function')
        ? GBTabs.tabIcon(type)
        : 'page';
      const iconEl = document.createElement('span');
      iconEl.className = 'gb-panelset-mini-icon';
      iconEl.innerHTML = (typeof lucide === 'function') ? lucide(iconName, 12) : '';
      iconBox.appendChild(iconEl);
    });
    if (types.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'gb-panelset-mini-empty';
      empty.textContent = '·';
      iconBox.appendChild(empty);
    }
    btn.appendChild(iconBox);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      switchGroup(panelsetNode, group.id);
    });
    // 中クリックでそのグループを閉じる（タブ閉じの慣例に合わせる）
    btn.addEventListener('mousedown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        closeGroup(panelsetNode, group.id);
      }
    });
    // 右クリックメニュー: 閉じる（将来: 複製・リネーム等の拡張余地）＋ 長押しで同メニュー
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _showGroupContextMenu(e, panelsetNode, group);
    });
    if (typeof addLongPressHandler === 'function') {
      addLongPressHandler(btn, (e) => _showGroupContextMenu(e, panelsetNode, group));
    }
    return btn;
  }

  function _showGroupContextMenu(e, panelsetNode, group) {
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    const z = (typeof _getZoom === 'function') ? _getZoom() : 1;
    menu.style.cssText = 'position:fixed;z-index:10000;left:' + (e.clientX / z) + 'px;top:' + (e.clientY / z) + 'px;';
    function addItem(label, fn) {
      const mi = document.createElement('div');
      mi.textContent = label;
      mi.style.cssText = 'padding:4px 12px;cursor:pointer;font-size:13px;white-space:nowrap;';
      mi.onmouseenter = () => { mi.style.background = 'var(--bg4)'; };
      mi.onmouseleave = () => { mi.style.background = ''; };
      mi.addEventListener('click', () => {
        document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
        fn();
      });
      menu.appendChild(mi);
    }
    addItem('このドックを閉じる', () => closeGroup(panelsetNode, group.id));
    document.body.appendChild(menu);
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    setTimeout(() => {
      const close = (ev) => {
        // 自分のメニューが既に外されている場合は、リスナー自身を破棄して終了
        // （次回開いた別メニューを「外側クリック」と誤判定して破壊する事故を防ぐ）
        if (!menu.isConnected) {
          document.removeEventListener('pointerdown', close);
          return;
        }
        const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
        if (!inAny) {
          document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
          document.removeEventListener('pointerdown', close);
        }
      };
      document.addEventListener('pointerdown', close);
    }, 0);
  }

  // パネルセット内の特定グループを閉じる。残り 1 件になれば自動解体。
  function closeGroup(panelsetNode, groupId) {
    if (!panelsetNode || !groupId) return;
    const idx = (panelsetNode.groups || []).findIndex(g => g && g.id === groupId);
    if (idx < 0) return;
    // グループ内の全タブのコンポーネント破棄
    const group = panelsetNode.groups[idx];
    if (group?.root && typeof removeComponentInstance === 'function') {
      const ids = [];
      (function walk(n) {
        if (!n) return;
        if (n.type === 'pane' && Array.isArray(n.tabs)) n.tabs.forEach(t => { if (t?.id) ids.push(t.id); });
        if (n.type === 'split' && Array.isArray(n.children)) n.children.forEach(walk);
        if (n.type === 'panelset' && Array.isArray(n.groups)) n.groups.forEach(g2 => { if (g2?.root) walk(g2.root); });
      })(group.root);
      ids.forEach(id => removeComponentInstance(id));
    }
    panelsetNode.groups.splice(idx, 1);
    if (panelsetNode.groups.length === 0) {
      // 空 panelset → ツリーから除去（B 案では 1 件の panelset は解体しない）
      if (typeof GBLayout?._layoutInternal?.detachNodeById === 'function') {
        GBLayout._layoutInternal.detachNodeById(panelsetNode.id);
      }
    } else {
      // 1 件以上残る → activeGroupId 補正のみ（単一 group でも panelset を解体しない）
      if (!panelsetNode.groups.some(g => g && g.id === panelsetNode.activeGroupId)) {
        panelsetNode.activeGroupId = panelsetNode.groups[0].id;
      }
    }
    if (typeof GBLayout?.render === 'function') GBLayout.render();
    if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
  }

  // 列ヘッダとして panelset のタブバーを描画（上端・横帯）
  function renderPanelSetTabbar(panelsetNode) {
    const bar = document.createElement('div');
    bar.className = 'gb-panelset-tabbar';
    bar.dataset.panelsetId = panelsetNode.id;
    (panelsetNode.groups || []).forEach((g) => {
      if (g?.id) bar.appendChild(renderGroupIconButton(panelsetNode, g));
    });
    // タブバー上のドロップ位置: 左右 15% は新カラム挿入、それ以外はタブバーマージ
    function _sideFromEvent(e) {
      const rect = bar.getBoundingClientRect();
      const isVertical = bar.classList.contains('gb-panelset-tabbar-vertical');
      const pos = isVertical ? (e.clientY - rect.top) : (e.clientX - rect.left);
      const size = isVertical ? rect.height : rect.width;
      const edgePct = 0.15;
      if (pos < size * edgePct) return isVertical ? 'top' : 'left';
      if (pos > size * (1 - edgePct)) return isVertical ? 'bottom' : 'right';
      return 'center';
    }
    bar.addEventListener('dragover', (e) => {
      const types = e.dataTransfer.types;
      const isGroup = types.includes('application/x-gb-panelset-group');
      const isColumn = types.includes('application/x-gb-column');
      if (!isGroup && !isColumn) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const rawSide = _sideFromEvent(e);
      // top/bottom（縦タブバー用）は left/right として扱う
      const side = (rawSide === 'top') ? 'left' : (rawSide === 'bottom') ? 'right' : rawSide;
      bar.dataset.dropSide = side;
      if (side === 'center') {
        bar.classList.add('gb-panelset-tabbar-drop');
        if (typeof GBDocking?.hideIndicator === 'function') GBDocking.hideIndicator();
      } else {
        bar.classList.remove('gb-panelset-tabbar-drop');
        // カラム全体の要素を参照してカラムの左右辺にエッジインジケータを出す
        const columnEl = bar.closest('.gb-column') || bar;
        if (typeof GBDocking?.showEdgeIndicator === 'function') {
          GBDocking.showEdgeIndicator(columnEl, side);
        }
      }
    });
    bar.addEventListener('dragleave', (e) => {
      if (!bar.contains(e.relatedTarget)) {
        bar.classList.remove('gb-panelset-tabbar-drop');
        if (typeof GBDocking?.hideIndicator === 'function') GBDocking.hideIndicator();
      }
    });
    bar.addEventListener('drop', (e) => {
      const types = e.dataTransfer.types;
      const isGroup = types.includes('application/x-gb-panelset-group');
      const isColumn = types.includes('application/x-gb-column');
      if (!isGroup && !isColumn) return;
      e.preventDefault();
      e.stopPropagation();
      bar.classList.remove('gb-panelset-tabbar-drop');
      const side = bar.dataset.dropSide || 'center';
      bar.removeAttribute('data-drop-side');
      if (typeof GBDocking?.hideIndicator === 'function') GBDocking.hideIndicator();
      try {
        if (typeof GBDocking !== 'undefined' && typeof GBDocking.hasLockedPaneInNode === 'function' && GBDocking.hasLockedPaneInNode(panelsetNode.id)) {
          if (typeof showStatus === 'function') showStatus('ロック中のパネルには追加できません', true);
          return;
        }
        if (isColumn) {
          const data = JSON.parse(e.dataTransfer.getData('application/x-gb-column') || '{}');
          if (!data.nodeId || data.nodeId === panelsetNode.id) return;
          if (typeof GBDocking !== 'undefined' && typeof GBDocking.hasLockedPaneInNode === 'function' && GBDocking.hasLockedPaneInNode(data.nodeId)) {
            if (typeof showStatus === 'function') showStatus('ロック中のパネルを含むカラムは移動できません', true);
            return;
          }
          if ((side === 'left' || side === 'right') && typeof GBLayout?.insertColumnAround === 'function') {
            GBLayout.insertColumnAround(data.nodeId, panelsetNode.id, side);
          } else if (typeof GBLayout?.applyColumnDrop === 'function') {
            GBLayout.applyColumnDrop(data.nodeId, panelsetNode.id);
          }
          return;
        }
        const data = JSON.parse(e.dataTransfer.getData('application/x-gb-panelset-group') || '{}');
        if (!data.groupId) return;
        if (typeof GBDocking !== 'undefined' && typeof GBDocking.hasLockedPaneInGroup === 'function' && GBDocking.hasLockedPaneInGroup(data.panelsetId, data.groupId)) {
          if (typeof showStatus === 'function') showStatus('ロック中のパネルを含むグループは移動できません', true);
          return;
        }
        if (side === 'left' || side === 'right') {
          // グループを新カラムとして挿入。panelset 自身のカラム ID を target に
          if (typeof GBLayout?._findColumnAncestorId === 'function'
              && typeof insertGroupAsColumn === 'function') {
            // panelset の代表ペインを経由して columnId を確定させる
            // 代表ペインの id が不明なので、panelsetNode.id を直接使ってよい：
            // insertGroupAsColumn は targetPaneId を取るが、その関数内では
            // _findColumnAncestorId(targetPaneId) でカラム ID を解決する。
            // panelsetNode.id はそのまま columnId として使えるため、ここだけは
            // GBLayout.insertFreeNodeAsColumn を直接呼んでしまう。
            const internal = (typeof GBLayout !== 'undefined') ? GBLayout?._layoutInternal : null;
            if (!internal) return;
            const findNodeFn = (id) => (typeof GBLayout?.findNode === 'function' ? GBLayout.findNode(GBLayout.root, id) : null);
            const sourcePs = findNodeFn(data.panelsetId)?.node;
            if (!sourcePs || sourcePs.type !== 'panelset') return;
            if (data.panelsetId === panelsetNode.id) return; // 同一 panelset 内は並び替えで対応
            const srcIdx = (sourcePs.groups || []).findIndex(g => g && g.id === data.groupId);
            if (srcIdx < 0) return;
            const before = _capturePanelsetLayoutHistory();
            const [moved] = sourcePs.groups.splice(srcIdx, 1);
            if (!moved?.root) return;
            // 先に target の隣に挿入する（source の整理でツリーが変形する前に panelsetNode.id を
            // 解決させる）。この時点で source panelset は空/単一状態でもツリーに残っている。
            if (typeof GBLayout?.insertFreeNodeAsColumn === 'function') {
              GBLayout.insertFreeNodeAsColumn(moved.root, panelsetNode.id, side);
            }
            // source panelset の整理（後処理）
            if (sourcePs.groups.length === 0) {
              if (typeof internal.detachNodeById === 'function') internal.detachNodeById(sourcePs.id);
            } else if (!sourcePs.groups.some(g => g && g.id === sourcePs.activeGroupId)) {
              sourcePs.activeGroupId = sourcePs.groups[0].id;
            }
            if (typeof GBLayout?.render === 'function') GBLayout.render();
            if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
            _pushPanelsetLayoutHistory('レイアウト: パネルセット移動', before, moved.id || '');
          }
          return;
        }
        moveGroupToPanelset(data.panelsetId, data.groupId, panelsetNode.id);
      } catch {}
    });
    return bar;
  }

  // グループを特定位置に挿入しながら並び替え/移動する。
  // - 同一 panelset: 順序変更
  // - 別 panelset: source から detach、target の指定位置に挿入
  // pos: 'before' | 'after'（targetGroupId の前/後）
  function reorderOrMoveGroup(sourcePanelsetId, groupId, targetPanelsetId, targetGroupId, pos) {
    if (!groupId || !targetPanelsetId || !targetGroupId) return;
    const internal = (typeof GBLayout !== 'undefined') ? GBLayout?._layoutInternal : null;
    if (!internal) return;
    const findNode = (id) => (typeof GBLayout?.findNode === 'function' ? GBLayout.findNode(GBLayout.root, id) : null);
    const sourcePs = findNode(sourcePanelsetId)?.node;
    const targetPs = findNode(targetPanelsetId)?.node;
    if (!sourcePs || !targetPs || sourcePs.type !== 'panelset' || targetPs.type !== 'panelset') return;
    const srcIdx = (sourcePs.groups || []).findIndex(g => g && g.id === groupId);
    if (srcIdx < 0) return;
    const before = _capturePanelsetLayoutHistory();
    const [moved] = sourcePs.groups.splice(srcIdx, 1);
    // target のインデックス（splice 後の targetPs.groups で再計算）
    let tgtIdx = (targetPs.groups || []).findIndex(g => g && g.id === targetGroupId);
    if (tgtIdx < 0) {
      // 見つからなければ末尾へ
      targetPs.groups.push(moved);
    } else {
      const insertAt = pos === 'before' ? tgtIdx : tgtIdx + 1;
      targetPs.groups.splice(insertAt, 0, moved);
    }
    targetPs.activeGroupId = moved.id;
    // 異なる panelset の場合のみ source を整理
    if (sourcePs !== targetPs) {
      if (sourcePs.groups.length === 0) {
        if (typeof internal.detachNodeById === 'function') internal.detachNodeById(sourcePs.id);
      } else if (!sourcePs.groups.some(g => g && g.id === sourcePs.activeGroupId)) {
        sourcePs.activeGroupId = sourcePs.groups[0].id;
      }
    }
    if (typeof GBLayout?.render === 'function') GBLayout.render();
    if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
    _pushPanelsetLayoutHistory('レイアウト: パネルセット移動', before, moved.id || '');
  }

  // パネルセット間でグループを移動する。
  // - sourcePanelsetId === targetPanelsetId かつグループが同一なら何もしない
  // - 同一 panelset なら active 切替のみ
  // - 異なる panelset なら source から detach し target に append
  // - 移動後 source が 1 グループになったら自動解体
  function moveGroupToPanelset(sourcePanelsetId, groupId, targetPanelsetId) {
    if (!groupId || !targetPanelsetId) return;
    // GBLayout は classic script top-level const のため window 経由では取得できない（直接参照）
    const internal = (typeof GBLayout !== 'undefined') ? GBLayout?._layoutInternal : null;
    if (!internal) return;
    const findNode = (id) => (typeof GBLayout?.findNode === 'function' ? GBLayout.findNode(GBLayout.root, id) : null);
    const sourceInfo = findNode(sourcePanelsetId);
    const targetInfo = findNode(targetPanelsetId);
    const sourcePs = sourceInfo?.node;
    const targetPs = targetInfo?.node;
    if (!targetPs || targetPs.type !== 'panelset') return;
    // 同一 panelset 内: アクティブ切替のみ（並べ替えは未対応、要望が来たら追加）
    if (sourcePs === targetPs) {
      switchGroup(targetPs, groupId);
      return;
    }
    if (!sourcePs || sourcePs.type !== 'panelset') return;
    const idx = (sourcePs.groups || []).findIndex(g => g && g.id === groupId);
    if (idx < 0) return;
    const before = _capturePanelsetLayoutHistory();
    const [moved] = sourcePs.groups.splice(idx, 1);
    targetPs.groups.push(moved);
    targetPs.activeGroupId = moved.id;
    // source が空の場合のみ整理（B案では単一 group でも解体しない）
    if (sourcePs.groups.length === 0) {
      if (typeof internal.detachNodeById === 'function') internal.detachNodeById(sourcePs.id);
    } else if (!sourcePs.groups.some(g => g && g.id === sourcePs.activeGroupId)) {
      sourcePs.activeGroupId = sourcePs.groups[0].id;
    }
    if (typeof GBLayout?.render === 'function') GBLayout.render();
    if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
    _pushPanelsetLayoutHistory('レイアウト: パネルセット移動', before, moved.id || '');
  }

  // ペイン領域へのドロップで、グループをそのカラムに「単独カラム」として取り出す。
  // gb-docking.js のペイン dragover/drop から呼ばれる。
  function dropGroupOnPane(sourcePanelsetId, groupId, targetPaneId) {
    if (!sourcePanelsetId || !groupId || !targetPaneId) return;
    // GBLayout は classic script top-level const のため window 経由では取得できない（直接参照）
    const internal = (typeof GBLayout !== 'undefined') ? GBLayout?._layoutInternal : null;
    if (!internal) return;
    const findNode = (id) => (typeof GBLayout?.findNode === 'function' ? GBLayout.findNode(GBLayout.root, id) : null);
    const sourceInfo = findNode(sourcePanelsetId);
    const sourcePs = sourceInfo?.node;
    if (!sourcePs || sourcePs.type !== 'panelset') return;
    const targetColumnId = typeof GBLayout._findColumnAncestorId === 'function'
      ? GBLayout._findColumnAncestorId(targetPaneId) : null;
    const resolvedTargetColumnId = targetColumnId || (findNode(targetPaneId)?.node ? targetPaneId : null);
    // 同一 panelset へのドロップは何もしない
    if (!resolvedTargetColumnId || resolvedTargetColumnId === sourcePs.id) return;
    const targetInfo = findNode(resolvedTargetColumnId);
    const targetNode = targetInfo?.node;
    if (!targetNode) return;
    const idx = (sourcePs.groups || []).findIndex(g => g && g.id === groupId);
    if (idx < 0) return;
    const before = _capturePanelsetLayoutHistory();
    const [moved] = sourcePs.groups.splice(idx, 1);
    if (!moved?.root) return;
    // ターゲットがパネルセットなら、その panelset に追加
    if (targetNode && targetNode.type === 'panelset') {
      targetNode.groups.push(moved);
      targetNode.activeGroupId = moved.id;
    } else {
      // ターゲットが通常列: その列とマージして新しい panelset 化する
      const merged = mergeColumns(targetNode, moved.root);
      if (merged && merged !== targetNode && typeof internal.replaceNodeById === 'function') {
        internal.replaceNodeById(resolvedTargetColumnId, merged);
      }
    }
    // source の整理（B案では単一 group でも解体しない）
    if (sourcePs.groups.length === 0) {
      if (typeof internal.detachNodeById === 'function') internal.detachNodeById(sourcePs.id);
    } else if (!sourcePs.groups.some(g => g && g.id === sourcePs.activeGroupId)) {
      sourcePs.activeGroupId = sourcePs.groups[0].id;
    }
    if (typeof GBLayout?.render === 'function') GBLayout.render();
    if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
    _pushPanelsetLayoutHistory('レイアウト: パネルセット移動', before, moved.id || '');
  }

  // パネルセットからグループを取り出し、ペインの属するカラムの left/right に
  // 新カラムとして挿入する（カラム間ドロップ）。
  function insertGroupAsColumn(sourcePanelsetId, groupId, targetPaneId, position) {
    if (!sourcePanelsetId || !groupId || !targetPaneId) return;
    if (position !== 'left' && position !== 'right') return;
    const internal = (typeof GBLayout !== 'undefined') ? GBLayout?._layoutInternal : null;
    if (!internal) return;
    const findNode = (id) => (typeof GBLayout?.findNode === 'function' ? GBLayout.findNode(GBLayout.root, id) : null);
    const sourcePs = findNode(sourcePanelsetId)?.node;
    if (!sourcePs || sourcePs.type !== 'panelset') return;
    const targetColumnId = typeof GBLayout._findColumnAncestorId === 'function'
      ? GBLayout._findColumnAncestorId(targetPaneId) : null;
    if (!targetColumnId || targetColumnId === sourcePs.id) return;
    const idx = (sourcePs.groups || []).findIndex(g => g && g.id === groupId);
    if (idx < 0) return;
    const before = _capturePanelsetLayoutHistory();
    const [moved] = sourcePs.groups.splice(idx, 1);
    if (!moved?.root) return;
    // source の整理（B案では単一 group でも解体しない）
    if (sourcePs.groups.length === 0) {
      if (typeof internal.detachNodeById === 'function') internal.detachNodeById(sourcePs.id);
    } else if (!sourcePs.groups.some(g => g && g.id === sourcePs.activeGroupId)) {
      sourcePs.activeGroupId = sourcePs.groups[0].id;
    }
    // 新カラムとして挿入
    if (typeof GBLayout?.insertFreeNodeAsColumn === 'function') {
      GBLayout.insertFreeNodeAsColumn(moved.root, targetColumnId, position);
    } else {
      if (typeof GBLayout?.render === 'function') GBLayout.render();
      if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
    }
    _pushPanelsetLayoutHistory('レイアウト: パネルセット移動', before, moved.id || '');
  }

  // 現在のアクティブグループの root を描画
  function renderActiveGroupContent(panelsetNode, depth) {
    const wrap = document.createElement('div');
    wrap.className = 'gb-panelset-content';
    const active = Array.isArray(panelsetNode.groups)
      ? panelsetNode.groups.find(g => g && g.id === panelsetNode.activeGroupId)
      : null;
    if (active?.root && typeof GBLayout?.renderNode === 'function') {
      wrap.appendChild(GBLayout.renderNode(active.root, depth));
    }
    return wrap;
  }

  function switchGroup(panelsetNode, newGroupId) {
    if (!panelsetNode || !newGroupId) return;
    if (panelsetNode.activeGroupId === newGroupId) return;
    const exists = (panelsetNode.groups || []).some(g => g && g.id === newGroupId);
    if (!exists) return;
    panelsetNode.activeGroupId = newGroupId;
    if (typeof GBLayout?.render === 'function') GBLayout.render();
    if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
  }

  // 2 つの列ノード（または panelset）を結合して 1 つの panelset を形成する。
  // target: 受け側の列ノード（ツリー内の位置を保持）
  // source: ドラッグ側の列ノード（ツリーから切り離されて groups に追加される）
  // 戻り値: 新しく形成された（または拡張された）panelset ノード
  function mergeColumns(target, source) {
    if (!target || !source) return null;
    // どちらかが既に panelset なら、その groups に他方を追加してマージ
    if (target.type === 'panelset') {
      const incoming = (source.type === 'panelset')
        ? (source.groups || [])
        : [createGroup(source)];
      incoming.forEach((g) => { if (g?.root) target.groups.push(g); });
      target.activeGroupId = incoming[0]?.id || target.activeGroupId;
      return target;
    }
    if (source.type === 'panelset') {
      const wrapped = createGroup(target);
      source.groups.unshift(wrapped);
      source.activeGroupId = wrapped.id;
      return source;
    }
    const gA = createGroup(target);
    const gB = createGroup(source);
    return createPanelSetNode([gA, gB], gB.id);
  }

  // ==========================================================================
  // Phase 3: renderDock — CSP パレット方式の常設ドックバー + 本体構造
  // ==========================================================================
  // パネル「+」ポップアップ (gb-outliner-search.part02.js の PANEL_MENU_SECTIONS) と
  // 完全に一致させる。追加種別はポップアップ側に合わせて更新すること。
  const _TAB_TYPE_ICON_MAP = {
    // 作業パネル
    folder: 'folder',
    page: 'page',
    scriptnote: 'bookOpenText',
    database: 'db',
    board: 'presentation',
    calendar: 'calendar',
    'smart-db': 'databaseSearch',
    // 補助パネル
    outliner: 'folderTree',
    preview: 'tvMinimal',
    detail: 'panelRight',
    version: 'gitBranch',
    chat: 'messagesSquare',
    timer: 'timer',
    history: 'history',
    annotation: 'stickyNote',
    // その他
    search: 'search',
  };
  function _dockTabTypeIcon(type, size) {
    const name = _TAB_TYPE_ICON_MAP[type] || 'square';
    return (typeof lucide === 'function') ? lucide(name, size) : '';
  }
  function _collectPanesInGroup(root) {
    const out = [];
    function walk(n) {
      if (!n) return;
      if (n.type === 'pane') { out.push(n); return; }
      if (n.type === 'split' && Array.isArray(n.children)) n.children.forEach(walk);
      // ネストした panelset 配下には潜らない。各 panelset は自前の dockBar を持つため、
      // ここで拾うと外側の dockBar に内側のアイコンが重複表示されてしまう。
    }
    walk(root);
    return out;
  }

  function renderDock(panelsetNode, depth) {
    const col = document.createElement('div');
    col.className = 'gb-column gb-dock';
    if (panelsetNode.collapsed) col.classList.add('gb-dock-collapsed');
    col.dataset.columnNodeId = panelsetNode.id || '';
    col.dataset.panelsetId = panelsetNode.id || '';
    col.style.display = 'flex';
    col.style.flexDirection = 'row';
    col.style.width = '100%';
    col.style.height = '100%';
    col.style.minWidth = '0';
    col.style.minHeight = '0';

    // ==== 単一グループ判定 ====
    // groups が 1 件だけなら、それが pane の複数タブでも split でも通常カラムとして扱い、
    // ドックバーは描画しない。ドックバーは複数カラム/group を重ねた panelset のための UI。
    const _groups = Array.isArray(panelsetNode.groups) ? panelsetNode.groups : [];
    const _isSingleGroupExpanded = _groups.length === 1 && !panelsetNode.collapsed;

    if (_isSingleGroupExpanded) {
      const body = document.createElement('div');
      body.className = 'gb-dock-body';
      body.style.flex = '1 1 auto';
      body.style.minWidth = '0';
      body.style.minHeight = '0';
      body.style.overflow = 'hidden';
      body.style.display = 'flex';
      body.style.flexDirection = 'column';
      if (typeof GBLayout?.renderNode === 'function') {
        body.appendChild(GBLayout.renderNode(_groups[0].root, depth));
      }
      col.appendChild(body);
      return col;
    }

    // ==== ドックバー（右32px 常設） ====
    const dockBar = document.createElement('div');
    dockBar.className = 'gb-dock-bar';
    dockBar.dataset.panelsetId = panelsetNode.id || '';

    // ドラッグハンドル
    const dragHandle = document.createElement('span');
    dragHandle.className = 'gb-dock-bar-handle';
    dragHandle.draggable = true;
    dragHandle.title = 'ドラッグ: ドック移動';
    dragHandle.innerHTML = (typeof lucide === 'function') ? lucide('gripHorizontal', 14) : '::';
    dragHandle.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    dragHandle.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      try {
        e.dataTransfer.setData('application/x-gb-column', JSON.stringify({ nodeId: panelsetNode.id }));
        e.dataTransfer.effectAllowed = 'move';
      } catch {}
    });
    dragHandle.addEventListener('dragend', () => {
      if (typeof GBDocking !== 'undefined' && typeof GBDocking.hideIndicator === 'function') {
        GBDocking.hideIndicator();
      }
    });
    dockBar.appendChild(dragHandle);

    // Phase 4: ドックバー本体にドロップで groups 末尾に挿入
    dockBar.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types;
      const isGroup = types?.includes?.('application/x-gb-panelset-group');
      if (!isGroup) return;
      // 見出しが先に dragover を処理している場合はそちらに委譲
      if (e.target?.closest?.('.gb-dock-tab-header')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    dockBar.addEventListener('drop', (e) => {
      const types = e.dataTransfer?.types;
      const isGroup = types?.includes?.('application/x-gb-panelset-group');
      if (!isGroup) return;
      if (e.target?.closest?.('.gb-dock-tab-header')) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/x-gb-panelset-group') || '{}');
        if (!data.panelsetId || !data.groupId) return;
        if (data.panelsetId === panelsetNode.id) return; // 同 panelset 内の末尾drop は active 切替で代替
        if (typeof GBDocking !== 'undefined' && typeof GBDocking.hasLockedPaneInNode === 'function' && GBDocking.hasLockedPaneInNode(panelsetNode.id)) {
          if (typeof showStatus === 'function') showStatus('ロック中のパネルには追加できません', true);
          return;
        }
        if (typeof GBDocking !== 'undefined' && typeof GBDocking.hasLockedPaneInGroup === 'function' && GBDocking.hasLockedPaneInGroup(data.panelsetId, data.groupId)) {
          if (typeof showStatus === 'function') showStatus('ロック中のパネルを含むグループは移動できません', true);
          return;
        }
        moveGroupToPanelset(data.panelsetId, data.groupId, panelsetNode.id);
      } catch {}
    });

    const groups = Array.isArray(panelsetNode.groups) ? panelsetNode.groups : [];
    const multiGroup = groups.length >= 2;

    // ==== 各 group 分の見出し + パネルアイコン ====
    let _totalIconCount = 0;
    groups.forEach((g) => {
      if (!g?.root) return;
      const isActiveGroup = g.id === panelsetNode.activeGroupId;

      // 各 group の間には視覚的な区切りとして空のスペーサーのみ置く。
      // 以前は clickable なドックタブ見出しだったが、タブアイコンクリックで
      // switchGroup されるためボタンとしては不要（スペーサーだけ残す）。
      if (multiGroup) {
        const spacer = document.createElement('div');
        spacer.className = 'gb-dock-tab-spacer';
        dockBar.appendChild(spacer);
      }

      // 各パネル（pane）のタブをアイコン列挙
      const panes = _collectPanesInGroup(g.root);
      panes.forEach((pane) => {
        (pane.tabs || []).forEach((tab, tabIdx) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'gb-dock-icon';
          const isActiveTab = (pane.activeTabIndex === tabIdx) && isActiveGroup && !panelsetNode.collapsed;
          if (isActiveTab) btn.classList.add('active');
          btn.dataset.paneId = pane.id;
          btn.dataset.tabId = tab.id || '';
          btn.dataset.groupId = g.id;
          btn.dataset.panelsetId = panelsetNode.id;
          btn.dataset.e2eId = `dock-${panelsetNode.id}-${g.id}-${pane.id}-${tab.id || tabIdx}`;
          btn.title = tab.label || '';
          btn.innerHTML = _dockTabTypeIcon(tab.type, 18);
          const preserveWorkActive = typeof GBLayout?.isPassivePaneType === 'function'
            && GBLayout.isPassivePaneType(tab.type, tab, pane);
          // Phase 5: D4 仕様 (click/dblclick 分岐)
          //   折りたたみ時: click=ポップアップ / dblclick=展開+アクティブ化
          //   展開時:       click=アクティブ化 / dblclick=折りたたみ
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (panelsetNode.collapsed) {
              // R7: 単体パネルのみポップアップ（ドック全体ではなく、対応タブをアクティブにしてポップアップ）
              if (typeof GBDockPopup?.open === 'function') {
                GBDockPopup.open({
                  panelsetNode,
                  groupId: g.id,
                  paneNode: pane,
                  tab,
                  tabIdx,
                  anchorEl: btn,
                });
              }
            } else {
              // 展開時: group をアクティブ化 + タブをアクティブ化
              switchGroup(panelsetNode, g.id);
              pane.activeTabIndex = tabIdx;
              if (typeof GBLayout?.render === 'function') GBLayout.render();
              if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
            }
          });
          btn.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (typeof GBDockPopup?.close === 'function') GBDockPopup.close();
            if (panelsetNode.collapsed) {
              panelsetNode.activeGroupId = g.id;
              pane.activeTabIndex = tabIdx;
              let revealed = false;
              if (typeof GBLayout?.revealPane === 'function') {
                revealed = !!GBLayout.revealPane(pane.id, { activate: !preserveWorkActive });
              }
              if (!revealed && panelsetNode.collapsed) {
                panelsetNode.collapsed = false;
                if (!preserveWorkActive && typeof GBLayout?.setActivePane === 'function') GBLayout.setActivePane(pane.id);
                if (typeof GBLayout?.render === 'function') GBLayout.render();
                if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
              }
            } else {
              panelsetNode.collapsed = true;
              if (typeof GBLayout?.render === 'function') GBLayout.render();
              if (typeof GBLayout?.saveLayout === 'function') GBLayout.saveLayout();
            }
          });
          dockBar.appendChild(btn);
          _totalIconCount += 1;
        });
      });
    });
    // ==== 本体 ====
    const body = document.createElement('div');
    body.className = 'gb-dock-body';
    body.style.flex = '1 1 auto';
    body.style.minWidth = '0';
    body.style.minHeight = '0';
    body.style.overflow = 'hidden';
    body.style.display = panelsetNode.collapsed ? 'none' : 'flex';
    body.style.flexDirection = 'column';
    const active = groups.find(g => g && g.id === panelsetNode.activeGroupId);
    if (active?.root && typeof GBLayout?.renderNode === 'function') {
      body.appendChild(GBLayout.renderNode(active.root, depth));
    }
    col.appendChild(body);
    // ドックバーは右側に配置（body を先に、dockBar を後に追加）。
    // ただしアイコンが 1 件も無い場合（例: group.root が全てネスト panelset で
    // そちらが自前のドックバーを持つケース）は外側ドックバーを描画しない。
    // これを描画すると空の 32px バーが並び「ドックバーが二列」に見えてしまう。
    if (_totalIconCount > 0) {
      col.appendChild(dockBar);
    }
    return col;
  }

  // groups が 1 件になった panelset を解体し、唯一の group.root を返す。
  // 呼び出し側がツリー内の該当位置をこの戻り値で置換する。
  function extractSoleGroupRoot(panelsetNode) {
    if (!panelsetNode || panelsetNode.type !== 'panelset') return null;
    const groups = (panelsetNode.groups || []).filter(g => g && g.root);
    if (groups.length !== 1) return null;
    return groups[0].root;
  }

  window.GBPanelSet = {
    createGroup,
    createPanelSetNode,
    renderPanelSetTabbar,
    renderActiveGroupContent,
    renderGroupIconButton,
    renderDock,
    collectGroupTabTypes,
    switchGroup,
    closeGroup,
    mergeColumns,
    extractSoleGroupRoot,
    moveGroupToPanelset,
    reorderOrMoveGroup,
    dropGroupOnPane,
    insertGroupAsColumn,
  };
})();
