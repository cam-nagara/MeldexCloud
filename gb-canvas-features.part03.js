/* gb-canvas-features.part03.js */
// 2026-04-18: 旧 bdConnContextMenu の続き (ライン形状/ラインの太さ/矢印/重複ラインスタイル
//   サブ/削除 と、関数末尾のポジション補正 + 外クリックで閉じる) は part01.js 側の新実装で
//   完結したため、ここでは削除のみ行う。関数定義そのものは part01.js:1109 以降に移設済み。
function bdEditConnLabel(conn) {
  setTimeout(() => {
    if (!conn || !conn.id) return;
    let lbl = document.querySelector(`.bd-conn-label[data-conn-id="${conn.id}"]`);
    if (!lbl && typeof bdDrawConns === 'function') {
      conn._editingInline = true;
      bdDrawConns({ connIds: [conn.id], reason: 'conn-label-edit-html-fallback' });
      lbl = document.querySelector(`.bd-conn-label[data-conn-id="${conn.id}"]`);
    }
    if (!lbl) return;
    lbl.contentEditable = 'true'; lbl.focus();
    const s=window.getSelection(), r=document.createRange();
    r.selectNodeContents(lbl); s.removeAllRanges(); s.addRange(r);
    lbl.style.pointerEvents = 'auto';
    const originalLabel = conn._labelWasEmpty ? '' : (conn.label || '');
    conn._labelEditOriginalLabel = originalLabel;
    const cleanupLabelEditFlags = () => {
      delete conn._labelWasEmpty;
      delete conn._labelPlaceholderUndoCaptured;
      delete conn._labelEditOriginalLabel;
      delete conn._editingInline;
    };
    const finish = () => {
      lbl.contentEditable = 'false';
      const text = lbl.textContent.trim() || '';
      const beforeLabel = conn.label || '';
      const labelBeforePlaceholder = conn._labelEditOriginalLabel || '';
      const placeholderAdd = !!conn._labelWasEmpty && beforeLabel === 'テキスト';
      const nextLabel = (conn._labelWasEmpty && (text === 'テキスト' || text === '')) ? '' : text;
      const changedFromOriginal = nextLabel !== labelBeforePlaceholder;
      if (nextLabel === beforeLabel) {
        const wasInlineNoChange = !!conn._editingInline;
        lbl.style.pointerEvents = '';
        cleanupLabelEditFlags();
        if (wasInlineNoChange && typeof bdDrawConns === 'function') bdDrawConns();
        return;
      }
      if (placeholderAdd && !changedFromOriginal) {
        conn.label = labelBeforePlaceholder;
        lbl.style.pointerEvents = '';
        cleanupLabelEditFlags();
        if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: [conn.id], reason: 'conn-label-placeholder-cancel' });
        return;
      }
      if ((!placeholderAdd || !conn._labelPlaceholderUndoCaptured) && typeof bdPushUndo === 'function') bdPushUndo();
      // 元々空ラベルだった場合にプレースホルダ「テキスト」のまま確定されたら空に戻す
      conn.label = nextLabel;
      lbl.style.pointerEvents = '';
      // textPath モードから一時的に HTML モードへ切り替えていた場合、編集完了で textPath モードに戻す (Phase 5-2)
      const wasInline = !!conn._editingInline;
      cleanupLabelEditFlags();
      bdDirty();
      if (!conn.label || wasInline) bdDrawConns();
    };
    lbl.onblur = finish;
    lbl.onkeydown = (ke) => {
      if (ke.key === 'Enter') { ke.preventDefault(); lbl.blur(); }
      if (ke.key === 'Escape') {
        lbl.textContent = conn._labelEditOriginalLabel || '';
        lbl.blur();
      }
      ke.stopPropagation();
    };
  }, 50);
}

function _bdSafeInlineColor(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text || /["'<>;]/.test(text)) return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (/^var\(--[a-z0-9_-]+\)$/i.test(text)) return text;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(text)) return text;
  return fallback;
}

function _bdPrepareContextMenuSelection(nodeId) {
  if (!nodeId || !bd.nodes.some(n => n.id === nodeId)) return;
  if (bd.selected instanceof Set && bd.selected.has(nodeId)) return;
  const previous = new Set(bd.selected || []);
  bd.selected = new Set([nodeId]);
  bd._activeNode = nodeId;
  if (typeof bdClearConnectionSelection === 'function') bdClearConnectionSelection();
  previous.add(nodeId);
  previous.forEach(id => {
    const el = document.getElementById('bdn-' + id);
    if (el) el.classList.toggle('bd-selected', id === nodeId);
  });
  if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([...previous], 'context-menu');
  if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
}

function _bdApplyBulkTopicSelection(ids, activeNodeId, reason) {
  const known = new Set((bd.nodes || []).map(node => node.id));
  const next = new Set(Array.from(ids || []).filter(id => known.has(id)));
  if (activeNodeId && known.has(activeNodeId)) next.add(activeNodeId);
  bd.selected = next;
  bd._activeNode = activeNodeId && next.has(activeNodeId) ? activeNodeId : (next.values().next().value || null);
  document.querySelectorAll('.bd-node').forEach(el => {
    el.classList.toggle('bd-selected', next.has(el.id.replace('bdn-', '')));
  });
  if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([...next], reason || 'bulk-select');
  if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
  if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi();
  return next;
}

function _bdAncestorTopicIds(nodeId) {
  const byId = new Map((bd.nodes || []).map(node => [node.id, node]));
  const result = new Set();
  let currentId = nodeId;
  while (currentId && byId.has(currentId) && !result.has(currentId)) {
    result.add(currentId);
    currentId = byId.get(currentId)?.parent || '';
  }
  return result;
}

function _bdDescendantTopicIds(nodeId) {
  const result = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || result.has(currentId)) continue;
    result.add(currentId);
    (bd.nodes || []).forEach(node => {
      if (node?.parent === currentId && !result.has(node.id)) queue.push(node.id);
    });
  }
  return result;
}

function bdGroupSelectedNodes() {
  const nodeIds = [...(bd.selected || [])].filter(id => bd.nodes.some(node => node.id === id));
  if (nodeIds.length < 2) return null;
  bdPushUndo();
  if (!Array.isArray(bd.groups)) bd.groups = [];
  const group = { id: bdId(), name: 'グループ' + (bd.groups.length + 1), nodeIds,
    styleRef: bd.topicViewDocument?.activeGroupStyleId || null, styleOverrides: {} };
  bd.groups.push(group);
  if (typeof bdMarkExtrasDirty === 'function') {
    bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true }, 'group-create');
  } else bdRender();
  bdDirty();
  if (typeof showStatus === 'function') showStatus(`${nodeIds.length}件のトピックをグループ化しました`);
  return group;
}

function bdContextMenu(e, nodeId) {
  _bdCloseAllContextMenus();
  const menu = _bdEnhanceContextMenu(document.createElement('div'), nodeId ? 'トピックメニュー' : 'ボードメニュー');
  _bdTrackContextMenuTrigger(menu, e?.trigger || null);
  { const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1); menu.style.left = (e.clientX/z)+'px'; menu.style.top = (e.clientY/z)+'px'; }
  const contextAnchorEl = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) };
  function item(label, fn) { return _bdContextMenuItem(menu, label, fn); }
  function dangerItem(label, fn) { return _bdContextMenuItem(menu, label, fn, { danger: true }); }
  function sep() { return _bdContextMenuSep(menu); }
  function sub(label) {
    const panel = _bdCreateContextSubmenu(menu, label, 140);
    return {
      item(l, fn, opts) { return _bdContextMenuItem(panel, l, fn, opts); },
      sep() { return _bdContextMenuSep(panel); },
      label(text) { return _bdContextMenuLabel(panel, text); },
      raw(el) { panel.appendChild(el); return el; },
      panel,
    };
  }
  function addToolbarVisibilityItems(target) {
    const immersive = window.MeldexBoardImmersive;
    let added = false;
    if (immersive?.getMode && immersive?.setMode) {
      [['top', '上端ツールバーを常時表示'], ['bottom', '下端ツールバーを常時表示']]
        .forEach(([edge, label]) => {
          const pinned = immersive.getMode(edge) === 'pinned';
          target.item(radioMark(pinned) + label, () => immersive.setMode(edge, pinned ? 'auto' : 'pinned'), {
            role: 'menuitemcheckbox',
            checked: pinned,
          });
        });
      added = true;
    }
    if (window.MeldexBoardStandalone?.appendDisplayContextMenuItems) {
      window.MeldexBoardStandalone.appendDisplayContextMenuItems(target);
      added = true;
    }
    return added;
  }

  if (nodeId) _bdPrepareContextMenuSelection(nodeId);
  const multi = !!(nodeId && bd.selected instanceof Set && bd.selected.has(nodeId) && bd.selected.size > 1);
  const nd = nodeId ? bd.nodes.find(n=>n.id===nodeId) : null;
  const connColors = ['','#ef4444','#3b82f6','#22c55e','#f97316','#8b5cf6','#ec4899','#eab308'];
  const colorLabels = {'':'デフォルト','#ef4444':'赤','#3b82f6':'青','#22c55e':'緑','#f97316':'橙','#8b5cf6':'紫','#ec4899':'桃','#eab308':'黄'};
  const currentImageDropMode = typeof bdGetImageDropMode === 'function' ? bdGetImageDropMode() : 'link';
  const imageDropCheck = mode => currentImageDropMode === mode ? (typeof lucide === 'function' ? lucide('checkSquare', 12) + ' ' : '') : '';
  const imageDropLabel = mode => typeof bdImageDropModeLabel === 'function'
    ? bdImageDropModeLabel(mode)
    : (mode === 'embed' ? 'ファイルに埋め込む' : '画像ファイルへのリンク');

  if (nodeId) {
    // 2026-04-18: board-card-popup-redesign-plan.md §4 に沿って再構築。
    //   - 色スウォッチ / 「コメントを追加」 / 「ノートを作成」 / 「ライン」サブ / 「外観」サブ /
    //     「拡張」サブ / 「サイズ設定」/「表示サイズ」 はすべて廃止または移設。
    //   - 編集 UI はオプションパネルへ一本化、ポップアップは切替と状態トグルに専念する。
    const targetNodeIds = multi ? [...bd.selected] : [nodeId];
    const topicPlacementSource = !multi
      ? window.MeldexTopicPlacementUI?.boardSource?.(nd) || null
      : null;
    const isLinkCard = nd && !!nd.link;
    const isImageCard = nd && !!nd.img;
    const isRootCard = nd && !nd.parent;
    const openTarget = !multi && typeof MeldexBoardOpenTarget !== 'undefined'
      ? MeldexBoardOpenTarget.resolve(nd)
      : null;
    if ((isLinkCard || isImageCard) && openTarget?.path) {
      // サブパネル内では、右サイドバーで開く（別サブパネルを開くUI）を
      // 一覧に出さない（計画書「右サイドバー操作の制限」節。他の右サイドバー分岐と
      // 同じ判定パターンに合わせる）。sourceEl を明示的に open() へ渡すことで、実行側の
      // ガード(guardRightSidebarTool)がフォーカス位置フォールバック頼みでバイパスされる
      // のも防ぐ（カードメニューは右クリック/メニューボタン起点でフォーカスが伴わない）。
      const cardMenuSourceEl = e?.target || e?.trigger || null;
      const cardMenuCanUseRightSidebar = typeof GBPaneBridge === 'undefined' || typeof GBPaneBridge.canUseRightSidebarTools !== 'function'
        || typeof GBPaneBridge.surfaceOf !== 'function'
        || GBPaneBridge.canUseRightSidebarTools(GBPaneBridge.surfaceOf(cardMenuSourceEl));
      item('リンク先を開く', () => {
        MeldexBoardOpenTarget.open(nd, undefined, { sourceEl: cardMenuSourceEl });
      });
      MeldexBoardOpenTarget.getAvailableTargets()
        .filter(target => cardMenuCanUseRightSidebar || !['sidebar', 'right-sidebar'].includes(target.value))
        .forEach(target => {
          item(`${target.label}で開く`, () => MeldexBoardOpenTarget.open(nd, target.value, { sourceEl: cardMenuSourceEl }));
        });
      if (isLinkCard && (typeof canOpenLinkedPathStandalone !== 'function' || canOpenLinkedPathStandalone(nd.link, nd.linkType || ''))) {
        item('単独アプリで開く', () => {
          const linkPath = nd.link;
          const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
          if (typeof openLinkedPathStandalone === 'function') openLinkedPathStandalone(linkPath, linkName, { linkType: nd.linkType });
        });
      }
      // board-standalone.html にはフォルダツリーが無いため typeof ガードで非表示にする。
      if (typeof window.revealPathInFolderTree === 'function'
        && !(typeof _bdIsExternalBrowserUrl === 'function' && _bdIsExternalBrowserUrl(openTarget.path))) {
        item('フォルダツリーに表示', () => window.revealPathInFolderTree(openTarget.path));
      }
      item('パスをコピー', () => MeldexBoardOpenTarget.copyPath(openTarget.path));
      if (isLinkCard) item('リンクをコピー', () => {
        const linkPath = nd.link;
        const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
        if (typeof MeldexBroadcast !== 'undefined') {
          MeldexBroadcast.copyMeldexLink(linkName, linkPath, 'page').then(ok => {
            if (ok) showStatus('リンクをコピーしました');
          });
        }
      });
      sep();
    }
    if (!multi) {
      item('テキスト編集 (F2)', () => bdEditNode(nodeId));
      // 「同階層カード追加 (Enter)」: ルートカード (親なし) では追加先の階層が不定のため disabled。
      if (isRootCard) {
        const disabled = _bdContextMenuItem(menu, '同階層トピック追加 (Enter)', null, { disabled: true, html: false });
        disabled.title = 'メイントピックは親が無いため、同階層追加できません';
      } else {
        item('同階層トピック追加 (Enter)', () => {
          bdSelect(nodeId);
          if (typeof bdAddSiblingToSelected === 'function') bdAddSiblingToSelected();
        });
      }
      item('サブトピック追加 (Ctrl+Enter)', () => {
        bdSelect(nodeId);
        if (typeof bdAddChildToSelected === 'function') bdAddChildToSelected();
      });
      const linkifySub = sub('リンクトピック化');
      linkifySub.item('ノート', () => bdLinkifyCardAs(nodeId, 'page'));
      linkifySub.item('シート', () => bdLinkifyCardAs(nodeId, 'database'));
      linkifySub.item('シナリオ', () => bdLinkifyCardAs(nodeId, 'scriptnote'));
      linkifySub.item('ボード', () => bdLinkifyCardAs(nodeId, 'board'));
      linkifySub.sep();
      linkifySub.item('既存ファイル...', () => bdLinkifyCardFromExisting(nodeId));
      item('接続トピックを全選択', () => {
        const ids = new Set([nodeId]); let ch = true;
        while (ch) {
          ch = false;
          bd.connections.forEach(c => {
            if (ids.has(c.from) && !ids.has(c.to)) { ids.add(c.to); ch = true; }
            if (ids.has(c.to) && !ids.has(c.from)) { ids.add(c.from); ch = true; }
          });
        }
        bdDescendants(nodeId).forEach(id => ids.add(id));
        _bdApplyBulkTopicSelection(ids, nodeId, 'connected-topic-select');
      });
      const appendHierarchySelection = (label, ids, reason, disabledReason) => {
        if (ids.size <= 1) {
          const disabled = _bdContextMenuItem(menu, label, null, { disabled: true, html: false });
          disabled.title = disabledReason;
          disabled.setAttribute('aria-description', disabledReason);
          return;
        }
        item(label, () => _bdApplyBulkTopicSelection(ids, nodeId, reason));
      };
      appendHierarchySelection('親トピックを全選択', _bdAncestorTopicIds(nodeId), 'ancestor-topic-select', '親トピックがありません');
      appendHierarchySelection('子トピックを全選択', _bdDescendantTopicIds(nodeId), 'descendant-topic-select', '子トピックがありません');
    }
    if (topicPlacementSource) {
      window.MeldexTopicPlacementUI.menuItems(topicPlacementSource).forEach(menuItem => {
        item(menuItem.label, menuItem.action);
      });
    }
    item(topicPlacementSource ? 'トピックの見た目を複製' : '複製', () => {
      bdPushUndo();
      const ids = multi ? [...bd.selected] : [nodeId];
      const sourceNodes = ids.map(id => bd.nodes.find(v => v.id === id)).filter(Boolean);
      const { newNodes, idMap } = typeof bdCloneNodesWithOffset === 'function'
        ? bdCloneNodesWithOffset(sourceNodes, 30)
        : { newNodes: [], idMap: {} };
      bd.nodes.push(...newNodes);
      const sourceIdSet = new Set(sourceNodes.map(node => node.id));
      const newConnections = (bd.connections || [])
        .filter(conn => conn && sourceIdSet.has(conn.from) && sourceIdSet.has(conn.to) && idMap[conn.from] && idMap[conn.to])
        .map(conn => {
          const cloned = { ...conn, id: bdId(), from: idMap[conn.from], to: idMap[conn.to] };
          if (Array.isArray(conn.controlPoints) && conn.controlPoints.length === 2) {
            cloned.controlPoints = conn.controlPoints.map(point => ({ ...point }));
          }
          return cloned;
        });
      bd.connections.push(...newConnections);
      bd.selected = new Set(newNodes.map(node => node.id));
      newNodes.forEach(node => {
        if (typeof bdAppendFastNode === 'function') bdAppendFastNode(node);
      });
      if (typeof bdDrawConns === 'function') bdDrawConns({ connIds: newConnections.map(conn => conn.id), reason: 'duplicate' });
      if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(newNodes.map(node => node.id), 'duplicate');
      bdDirty();
    });
    if (multi && nd) {
      item('選択トピックをこのトピックに内包', () => {
        const parentAbs = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(nd) : { x: nd.x, y: nd.y };
        const isAncestorOfTarget = (id) => {
          if (typeof bdDescendants === 'function') return bdDescendants(id).includes(nodeId);
          let cur = nd;
          const seen = new Set();
          while (cur?.parent && !seen.has(cur.id)) {
            if (cur.parent === id) return true;
            seen.add(cur.id);
            cur = bd.nodes.find(v => v.id === cur.parent);
          }
          return false;
        };
        const targetIds = [...bd.selected].filter(id => id !== nodeId && !isAncestorOfTarget(id));
        if (!targetIds.length) {
          if (typeof showStatus === 'function') showStatus('内包できるトピックがありません', true);
          return;
        }
        bdPushUndo();
        nd.container = true;
        targetIds.forEach(id => {
          const ch = bd.nodes.find(v => v.id === id);
          if (ch) {
            const childAbs = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(ch) : { x: ch.x, y: ch.y };
            ch.x = childAbs.x - parentAbs.x; ch.y = childAbs.y - parentAbs.y;
            ch.parent = nodeId; ch.contained = true;
            document.getElementById('bdn-' + id)?.remove();
          }
        });
        if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nodeId], 'menu-containerize');
        else bdRender();
        bdDirty();
      });
    }
    const hasParentTarget = targetNodeIds.some(id => !!bd.nodes.find(v => v.id === id)?.parent);
    if (nd && hasParentTarget) {
      item('親から切り離す', () => {
        bdPushUndo();
        const depthOf = id => bdParentDepth(id);
        const ids = (multi ? [...bd.selected] : [nodeId]).sort((a, b) => depthOf(b) - depthOf(a));
        ids.forEach(id => {
          const n = bd.nodes.find(v => v.id === id); if (!n || !n.parent) return;
          const parentId = n.parent;
          if (typeof bdDetachParentChildRelation === 'function') bdDetachParentChildRelation(parentId, id);
          else n.parent = '';
        });
        if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(ids, 'detach-parent');
        else bdRender();
        bdDirty();
      });
    }
    // ロックはトグル項目として「複製」の直下に置く
    if (nd) {
      const lockLabel = nd.locked ? 'ロック解除' : 'ロック';
      item(lockLabel, () => {
        bdPushUndo();
        const ids = multi ? [...bd.selected] : [nodeId];
        const next = !nd.locked;
        ids.forEach(id => { const n = bd.nodes.find(v => v.id === id); if (n) n.locked = next; });
        if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(ids, 'menu-lock');
        else bdRender();
        bdDirty();
      });
    }
    sep();

    // --- カードスタイル サブ (旧「外観 > カードスタイル」を昇格。切替と管理のみ) ---
    //   書式編集 (色・フォントサイズ・太字/斜体・形状・角丸・影・雲型等) はオプションパネルに一本化。
    //   ここでは「スタイル選択」「階層別スタイル on/off」「スタイル管理」のみ扱う。
    {
      const cardStylePanel = _bdCreateContextSubmenu(menu, 'トピックスタイル', 160);
      const currentStyleId = nd?.cardStyle || bd.activeCardStyle || '';
      const isHierarchical = !nd?.cardStyle;
      const restoreItem = _bdContextMenuItem(cardStylePanel, radioMark(isHierarchical) + esc('階層別スタイルに戻す'), () => {
        if (typeof _bdRestoreCardToHierarchy === 'function') _bdRestoreCardToHierarchy(targetNodeIds);
      }, {
        role: 'menuitemradio',
        checked: isHierarchical,
      });
      if (isHierarchical) restoreItem.style.color = 'var(--accent)';
      _bdContextMenuSep(cardStylePanel);
      (bd.cardStyles || []).forEach(style => {
        if (typeof _bdIsCustomStyleId === 'function' && _bdIsCustomStyleId('card', style.id)) return;
        const si = _bdContextMenuItem(cardStylePanel, radioMark(currentStyleId === style.id) + esc(style.name || ''), () => {
          _bdApplyCardStyleFromMenu(targetNodeIds, style.id);
        }, {
          role: 'menuitemradio',
          checked: currentStyleId === style.id,
        });
        if (currentStyleId === style.id) si.style.color = 'var(--accent)';
      });
      _bdContextMenuSep(cardStylePanel);
      // 階層別スタイル サブのサブ (有効/無効)
      // 課題18-案A: 「有効/無効」という文言だけでは、有効にしたカードが「階層別スタイルの
      // 起点になる」(そのカード自身が深さ0、子孫だけに効く) ことが伝わらないため改善した。
      if (nd) {
        const autoPanel = _bdCreateContextSubmenu(cardStylePanel, '階層別スタイル', 160);
    [['このトピックを起点にする', true], ['起点にしない', false]].forEach(([label, val]) => {
          const si = _bdContextMenuItem(autoPanel, radioMark(!!nd._autoStyle === val) + label, () => {
            nd._autoStyle = val;
            if (val) delete nd._userCardStyle;
            if (val && typeof bdApplyAutoStyle === 'function') bdApplyAutoStyle(nd.id);
            if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nd.id], 'toggle-auto-style');
            else bdRender();
            bdDirty();
            if (nd.structure && typeof bdRequestAutoLayout === 'function') bdRequestAutoLayout(nd.id);
            else if (nd.structure && typeof bdAutoLayout === 'function') bdAutoLayout(nd.id);
          }, {
            role: 'menuitemradio',
            checked: !!nd._autoStyle === val,
          });
          if (!!nd._autoStyle === val) si.style.color = 'var(--accent)';
        });
      }
      _bdContextMenuItem(cardStylePanel, 'スタイル管理...', () => {
        if (typeof bdOpenCardStyleManager === 'function') bdOpenCardStyleManager();
      });
    }

    // --- 画像操作 サブ (画像カード時のみルート直下) ---
    if (isImageCard) {
      const imgSub = sub('画像操作');
      imgSub.item('画像ファイルを再指定...', () => {
        if (typeof bdRelocateImageNode === 'function') bdRelocateImageNode(nodeId);
      });
      imgSub.item('元のサイズに戻す', () => {
        if (typeof bdRestoreImageNaturalSize === 'function') bdRestoreImageNaturalSize(nodeId);
      }, { disabled: !!nd.locked });
      imgSub.sep();
      imgSub.item('水平反転', () => bdFlip('h'));
      imgSub.item('垂直反転', () => bdFlip('v'));
      imgSub.item('90°回転', () => bdRotate(90));
      imgSub.item('-90°回転', () => bdRotate(-90));
      imgSub.sep();
      // 不透明度サブのサブ
      {
        const opPanel = _bdCreateContextSubmenu(imgSub.panel, '不透明度', 100);
        [[1, '100%'], [0.75, '75%'], [0.5, '50%'], [0.25, '25%']].forEach(([val, label]) => {
          const curOp = nd.opacity != null ? nd.opacity : 1;
          const active = Math.abs(curOp - val) < 0.01;
          const si = _bdContextMenuItem(opPanel, radioMark(active) + label, () => {
            bdSetOpacity(val);
          }, {
            role: 'menuitemradio',
            checked: active,
          });
          if (active) si.style.color = 'var(--accent)';
        });
      }
      imgSub.item('カラーピッカー', () => bdColorPicker());
    }

    // --- 表示 サブ (新設。折りたたみ/フォーカス/ドリルダウン/Z 順序) ---
    {
      const viewSub = sub('表示');
      const childNodesForView = typeof bdChildren === 'function' ? bdChildren(nodeId) : [];
      if (!multi && nd && childNodesForView.length > 0) {
  const collapseLabel = nd.collapsed ? 'サブトピックを展開' : 'サブトピックを折りたたむ';
        viewSub.item(collapseLabel, () => {
          bdPushUndo();
          nd.collapsed = !nd.collapsed;
          if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nd.id], 'collapse');
          else bdRender();
          bdDirty();
        });
      }
      viewSub.item('フォーカス (Space)', () => bdFocusSelected());
      if (!multi && nd) {
        viewSub.item('ドリルダウン', () => bdDrillDown(nodeId));
      }
      if (typeof _bdDrillRoot !== 'undefined' && _bdDrillRoot) {
        viewSub.item('ドリルダウン解除', () => bdDrillUp());
      }
      viewSub.sep();
      viewSub.item('前面に移動', () => bdMoveZ('front'));
      viewSub.item('背面に移動', () => bdMoveZ('back'));
      viewSub.sep();
      addToolbarVisibilityItems(viewSub);
    }

    // --- 構造サブメニュー（コンテナ・子ライン・構造タイプ・グループ） ---
    // --- 構造 サブ (コンテナ切替 + 構造タイプのみ。子ライン操作 / 追従モード / 階層別スタイル は廃止) ---
    //   「子ラインスタイル/子ライン表示/子ライン形状」はライン側の編集に一本化し、
    //   「追従モード」は選択 + ドラッグで代替可能なため廃止。
    //   「階層別スタイル」はカードスタイル サブ内に移動済み。
    if (nd) {
      const strSub = sub('構造');
      if (!multi) {
        // コンテナ切替 (ルート直下はトグル式だが、サブ内では現在値の確認を兼ねてラジオで並べる)
        const ctPanel = _bdCreateContextSubmenu(strSub.panel, 'コンテナ', 120);
        [['コンテナにする', true], ['コンテナ解除', false]].forEach(([label, val]) => {
          const active = !!nd.container === val;
          const si = _bdContextMenuItem(ctPanel, radioMark(active) + label, () => {
            bdPushUndo();
            nd.container = val;
            if (!val) {
              bd.nodes.forEach(ch => {
                if (ch.parent === nodeId && ch.contained) {
                  const pos = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(ch) : { x: ch.x + nd.x, y: ch.y + nd.y };
                  ch.contained = false; ch.x = pos.x; ch.y = pos.y;
                }
              });
            }
            const childIds = bd.nodes.filter(ch => ch.parent === nodeId).map(ch => ch.id);
            if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nodeId, ...childIds], 'container-toggle');
            else bdRender();
            bdDirty();
          }, {
            role: 'menuitemradio',
            checked: active,
          });
          if (active) si.style.color = 'var(--accent)';
        });
      }
      // 構造タイプ: 選択中のすべてのカードに一括適用する (親子関係にあってもまとめて設定可能)。
      // c33a3a6 以降、中間カードに設定した structure もそのカード配下のサブツリーに適用される。
      // bdAutoLayout が DFS でサブルートを個別レイアウトするので、ルート以外でも有効。
      strSub.sep();
      const targetStructures = targetNodeIds.map(id => bd.nodes.find(v => v.id === id)?.structure || '');
      const mixedStructure = targetStructures.some(st => st !== targetStructures[0]);
      const curSt = mixedStructure ? '' : (targetStructures[0] || '');
      const applyStructure = (key) => {
        bdPushUndo();
        const allTargetsAlreadyUseKey = key && targetNodeIds.every(id => (bd.nodes.find(v => v.id === id)?.structure || '') === key);
        const nextValue = allTargetsAlreadyUseKey ? '' : key;
        targetNodeIds.forEach(id => {
          const n2 = bd.nodes.find(v => v.id === id);
          if (!n2) return;
          n2.structure = nextValue;
          if (nextValue) {
            // このノード (サブルート扱い) とその descendants について、欠けている親子接続を補充。
            // flowchart なら矢印付きで生成する。
            const descIds = typeof bdDescendants === 'function' ? bdDescendants(id) : [];
            descIds.forEach(cid => {
              const cn = bd.nodes.find(v => v.id === cid);
              if (cn && cn.parent && !bd.connections.some(c => c.from === cn.parent && c.to === cn.id)) {
                const conn = typeof bdCreateConnectionWithStyle === 'function'
                  ? bdCreateConnectionWithStyle(cn.parent, cn.id, { arrow: nextValue === 'flowchart' ? 'end' : '' })
                  : { from: cn.parent, to: cn.id, arrow: nextValue === 'flowchart' ? 'end' : '', label: '', style: '' };
                bd.connections.push(conn);
              }
            });
          }
          // このカードを subroot とする再レイアウト (空への変更でも、ルートから再整列するため呼ぶ)。
          if (typeof bdRequestAutoLayout === 'function' || typeof bdAutoLayout === 'function') {
            const targetId = nextValue ? id : (typeof bdRoot === 'function' ? bdRoot(id)?.id : id);
            if (targetId && typeof bdRequestAutoLayout === 'function') bdRequestAutoLayout(targetId);
            else if (targetId) bdAutoLayout(targetId);
          }
        });
        if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(targetNodeIds, 'structure-change');
        else bdRender();
        bdDirty();
      };
      if (multi && typeof bdLinkifySelectionToTree === 'function') {
        strSub.item('ラインから親子化', () => { bdLinkifySelectionToTree(nodeId); });
        strSub.sep();
      }
      strSub.item((!mixedStructure && !curSt ? lucide('checkSquare', 12) + ' ' : '') + '親に従う', () => applyStructure(''));
      Object.entries(BD_STRUCTURES).forEach(([key, label]) => {
        strSub.item((!mixedStructure && curSt === key ? lucide('checkSquare', 12) + ' ' : '') + label, () => applyStructure(key));
      });
    }

    // --- ステータス/マーカー/コメント サブメニュー (HUD の空状態ボタンから移設) ---
    if (nd && !multi) {
      // ステータス
      const statusSub = sub('ステータス');
      const curStatus = nd.status || '';
      const setStatus = (st) => {
        bdPushUndo();
        const targets = bd.selected.has(nodeId) ? [...bd.selected] : [nodeId];
        targets.forEach(id => { const n2 = bd.nodes.find(v => v.id === id); if (n2) n2.status = st; });
        if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(targets, 'status');
        else bdRender();
        bdDirty();
      };
      statusSub.item(radioMark(!curStatus) + 'なし', () => setStatus(''));
      if (typeof bdStatusNames === 'function') {
        bdStatusNames().filter(s => !!s).forEach(st => {
          const sd = typeof bdStatusDef === 'function' ? bdStatusDef(st) : null;
          const dot = sd ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${_bdSafeInlineColor(sd.color, '#888')};margin-right:4px;vertical-align:middle;"></span>` : '';
          statusSub.item(radioMark(curStatus === st) + dot + esc(st), () => setStatus(st));
        });
      }
      statusSub.sep();
      statusSub.item('ステータスを管理...', () => {
        if (typeof bdManageStatuses === 'function') bdManageStatuses();
      });

      // マーカー
      if (typeof BD_MARKERS !== 'undefined') {
        const markerSub = sub('マーカー');
        const markers = nd.markers || {};
        const categoryLabels = { priority: '優先度', flag: 'フラグ' };
        let firstCat = true;
        Object.entries(BD_MARKERS).forEach(([cat, list]) => {
          if (!firstCat) markerSub.sep();
          firstCat = false;
          markerSub.label(categoryLabels[cat] || cat);
          list.forEach((mk, idx) => {
            const isActive = markers[cat] === idx;
            const iconHtml = typeof bdMarkerIconHtml === 'function' ? bdMarkerIconHtml(mk, 12) : (typeof lucide === 'function' ? lucide(mk.icon, 12) : '');
            const iconSpan = `<span style="color:${_bdSafeInlineColor(mk.color, 'var(--fg2)')};margin-right:4px;vertical-align:middle;">${iconHtml}</span>`;
            markerSub.item(radioMark(isActive) + iconSpan + esc(mk.label), () => {
              bdPushUndo();
              if (typeof bdSetMarker === 'function') bdSetMarker(nodeId, cat, isActive ? -1 : idx);
            });
          });
        });
        if (markers && Object.keys(markers).length > 0) {
          markerSub.sep();
          markerSub.item('すべてクリア', () => {
            bdPushUndo();
            const n2 = bd.nodes.find(v => v.id === nodeId);
            if (n2) n2.markers = {};
            if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nodeId], 'clear-markers');
            else bdRender();
            bdDirty();
          });
        }
      }

      // コメント
      const commentSub = sub('コメント');
      const filePath = (bd?.path || '').trim();
      commentSub.item('コメントを追加', () => {
        if (typeof addCommentHere !== 'function') return;
        if (!filePath) {
          if (typeof showStatus === 'function') showStatus('コメント対象のボードパスを取得できませんでした', true);
          return;
        }
        const snap = (nd.text || '').trim().slice(0, 120);
        addCommentHere({
          targetKind: 'board_card', filePath,
          targetRef: { file: filePath, cardId: nodeId },
          snapshot: snap,
        }, { anchorEl: contextAnchorEl });
      });
      commentSub.item('コメント一覧を開く', () => {
        if (typeof openRightPanelTab === 'function') openRightPanelTab('annotation');
        else if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('annotation');
        const typeSel = document.getElementById('rp-ann-type'); if (typeSel) typeSel.value = 'comment';
        const scopeSel = document.getElementById('rp-ann-scope'); if (scopeSel) scopeSel.value = 'current';
        const searchEl = document.getElementById('rp-ann-search');
        if (searchEl) {
          searchEl.value = '';
          searchEl.dataset.targetFilter = JSON.stringify({
            targetPath: filePath, targetKind: 'board_card',
            targetRef: { file: filePath, cardId: nodeId },
          });
        }
        if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
      });

      // フキダシのしっぽ (追加する / 削除する の2択。アノテートの付箋メニューと同じ構成に揃える)。
      // Alt+Shift+ドラッグを知らなくても到達できる導線。
      const tailSub = sub('フキダシのしっぽ');
      const hasTail = typeof bdCardHasTail === 'function' ? bdCardHasTail(nd) : !!nd.tail;
      [['追加する', false], ['削除する', true]].forEach(([label, isRemove]) => {
        tailSub.item(radioMark(hasTail === isRemove) + label, () => {
          const cardEl = document.getElementById('bdn-' + nodeId);
          if (isRemove) {
            if (typeof bdRemoveCardTail === 'function') bdRemoveCardTail(cardEl, nd);
          } else if (typeof bdAddCardTail === 'function') {
            bdAddCardTail(cardEl, nd);
          }
        }, { role: 'menuitemradio', checked: hasTail === isRemove });
      });
    }

    // --- Multi-select: 整列・サイズ・集約・グループ化 ---
    if (multi) {
      sep();
      item('集約トピックを追加', () => bdAddSummary());
      const alSub = sub('整列');
      alSub.item('左揃え', () => bdAlign('left')); alSub.item('右揃え', () => bdAlign('right'));
      alSub.item('上揃え', () => bdAlign('top')); alSub.item('下揃え', () => bdAlign('bottom'));
      alSub.item('水平中央', () => bdAlign('centerH')); alSub.item('垂直中央', () => bdAlign('centerV'));
      alSub.item('水平等間隔', () => bdAlign('distributeH')); alSub.item('垂直等間隔', () => bdAlign('distributeV'));
      alSub.sep();
      alSub.item('自動整列（横幅）', () => bdArrangeByWidth());
      alSub.item('自動整列（縦幅）', () => bdArrangeByHeight());
      alSub.item('自動整列（サイズ・横幅）', () => bdArrangeWithSize('width'));
      alSub.item('自動整列（サイズ・縦幅）', () => bdArrangeWithSize('height'));
      const nrmSub = sub('サイズ正規化');
      nrmSub.item('高さを揃える', () => bdNormalize('height'));
      nrmSub.item('幅を揃える', () => bdNormalize('width'));
      nrmSub.item('サイズを揃える', () => bdNormalize('size'));
      item('グループ化', () => bdGroupSelectedNodes());
    }
    // 注: ルート直下の「フォーカス (Space)」および「拡張」サブ全体 (ノート編集/チェックボックス/
    // 進捗/フォント設定/マーカー/ドリルダウン/ステータス) は廃止。
    //   - フォーカス / ドリルダウン → 「表示」サブへ移設済み
    //   - ステータス / マーカー → カード HUD の左上・右下クリックから直接選択
    //   - ノート編集 / チェックボックス / 進捗 / フォント設定 → 廃止 (機能自体の削除)

    // --- Groups ---
    const nodeGroups = bd.groups.filter(g=>g.nodeIds.includes(nodeId));
    if (nodeGroups.length) {
      nodeGroups.forEach(g => {
        item('グループ「'+esc(g.name)+'」を選択', () => { g.nodeIds.forEach(id=>bd.selected.add(id)); document.querySelectorAll('.bd-node').forEach(el=>el.classList.toggle('bd-selected',bd.selected.has(el.id.replace('bdn-','')))); if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles(); });
        item('グループ「'+esc(g.name)+'」を解除', () => { bd.groups=bd.groups.filter(gg=>gg.id!==g.id); if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true }, 'group-remove'); else bdRender(); bdDirty(); showStatus('グループ解除'); });
      });
    }
    sep();
    dangerItem('削除 (Del)', async () => {
      if (!multi) bdSelect(nodeId);
      const count = bd.selected.size;
      const msg = count > 1 ? `${count}件のトピックを削除しますか？` : 'このトピックを削除しますか？';
      if (!(await cfConfirm(msg))) return;
      await bdDeleteSelected({ confirm: false });
    });

  } else {
    // --- Blank area menu ---
    const _stw = bdScreenToWorld(e.clientX, e.clientY);
    const clickWx = _stw.x, clickWy = _stw.y;
    item('トピックを追加', () => { bdAddAt(clickWx, clickWy); });
    const newLinkSub = sub('新規リンクトピック');
    [
      ['ノート', 'page'],
      ['シート', 'database'],
      ['シナリオ', 'scriptnote'],
      ['ボード', 'board'],
    ].forEach(([label, type]) => {
      newLinkSub.item(label, () => {
        if (typeof bdCreateLinkedFileCardAt === 'function') bdCreateLinkedFileCardAt(clickWx, clickWy, type);
        else showStatus('リンクトピック追加機能を読み込めませんでした', true);
      });
    });
    newLinkSub.sep();
    newLinkSub.item('既存ファイルへのリンク...', () => {
      if (typeof bdPromptAddLinkCardAt === 'function') bdPromptAddLinkCardAt(clickWx, clickWy);
      else showStatus('リンクトピック追加機能を読み込めませんでした', true);
    });
    item('貼り付け (Ctrl+V)', () => {
      if (window.MeldexBoardTransfer?.requestPaste) {
        window.MeldexBoardTransfer.requestPaste({ point: { x: clickWx, y: clickWy } });
      } else if (_bdClipboard && _bdClipboard.length > 0) {
        bdPaste();
      } else {
        showStatus('貼り付け機能を読み込めませんでした', true);
      }
    });
    item('画像を貼り付け (Ctrl+Shift+V)', () => bdPasteImage());
    sep();
    item('自動整列（横幅）', () => bdArrangeByWidth());
    item('自動整列（縦幅）', () => bdArrangeByHeight());
    item('自動整列（サイズ・横幅）', () => bdArrangeWithSize('width'));
    item('自動整列（サイズ・縦幅）', () => bdArrangeWithSize('height'));
    sep();
    item('検索と置換...', () => bdFindReplace());
    sep();
    const displaySub = sub('表示');
    addToolbarVisibilityItems(displaySub);
    // 2026-04-18: 「表示設定」→「ボード設定」にリネーム (カード側の「表示」サブと用語が衝突するため、§6.2)。
    // 「全体表示に戻る」→「ドリルダウン解除」に統一 (カード側「表示」サブと用語を揃える)。
    const boardSettingsSub = sub('ボード設定');
    boardSettingsSub.item(bd._numbering ? lucide('checkSquare', 12) + ' 番号付け' : '番号付け', () => bdToggleNumbering());
    // v0.5.285: フローティングミニマップ項目とフォーカスモード項目を削除。
    //   ミニマップはビューワーパネル側 (gb-canvas-minimap.js) で置換済み。
    //   フォーカスモードは Space キー直押しでフォーカス / 解除できるため不要。
    boardSettingsSub.sep();
    const thmSub = sub('テーマ');
    if (typeof MeldexThemeManager !== 'undefined' && typeof MeldexThemeManager.getAllThemes === 'function') {
      const activeThemeId = bd.themeId || '';
      thmSub.item(!activeThemeId ? lucide('checkSquare', 12) + ' アプリ設定に追従' : 'アプリ設定に追従', () => MeldexThemeManager.setBoardTheme(bd, ''));
      thmSub.sep();
      MeldexThemeManager.getAllThemes().forEach(theme => {
        thmSub.item(activeThemeId === theme.id ? lucide('checkSquare', 12) + ' ' + esc(theme.name) : esc(theme.name), () => MeldexThemeManager.setBoardTheme(bd, theme.id));
      });
    }
    if (_bdDrillRoot) item('ドリルダウン解除', () => bdDrillUp());
    if (bd.selected.size > 1) {
      item('集約トピックを追加', () => bdAddSummary());
    }
  }

  sep();
  const imageDropSub = sub('画像追加方式');
  imageDropSub.item(imageDropCheck('embed') + esc(imageDropLabel('embed')), () => {
    if (typeof bdSetImageDropMode === 'function') bdSetImageDropMode('embed');
  });
  imageDropSub.item(imageDropCheck('link') + esc(imageDropLabel('link')), () => {
    if (typeof bdSetImageDropMode === 'function') bdSetImageDropMode('link');
  });

  document.body.appendChild(menu);
  if (typeof positionPopup === 'function') {
    positionPopup(menu, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
  } else {
    const r=menu.getBoundingClientRect();
    if(r.right>window.innerWidth) menu.style.left=(window.innerWidth-r.width-4)+'px';
    if(r.bottom>window.innerHeight) menu.style.top=(window.innerHeight-r.height-4)+'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  setTimeout(()=>document.addEventListener('pointerdown',function h(ev){const inAny=[...document.querySelectorAll('.gb-context-menu')].some(m=>m.contains(ev.target));if(!inAny){document.querySelectorAll('.gb-context-menu').forEach(m=>m.remove());document.removeEventListener('pointerdown',h);}},{once:false}),0);
}

// --- 15. Status Management ---
function _bdUniqueStatusName(baseName, skipIndex) {
  const base = String(baseName || '').replace(/[\r\n]+/g, ' ').trim() || '新規';
  const names = new Set((bd.statuses || [])
    .map((status, index) => index === skipIndex ? '' : (status?.name || '').trim())
    .filter(Boolean));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(base + ' ' + suffix)) suffix += 1;
  return base + ' ' + suffix;
}

function _bdRenameStatusOnNodes(oldName, nextName) {
  if (!oldName || oldName === nextName) return;
  (bd.nodes || []).forEach(node => {
    if (node.status === oldName) node.status = nextName;
  });
}

function _bdClearStatusOnNodes(statusName) {
  if (!statusName) return;
  (bd.nodes || []).forEach(node => {
    if (node.status === statusName) node.status = '';
  });
}

function bdManageStatuses() {
  if (!window.GBUI?.createModal) throw new Error('ステータス管理ダイアログを初期化できませんでした');
  const existing = document.querySelector('[data-e2e-id="board-status-manager-dialog"]');
  if (existing) { existing.focus(); return existing.closest('.gb-modal-overlay')?._bdStatusManagerApi || null; }
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const uid = 'bd-status-manager-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const content = document.createElement('div');
  content.dataset.e2eId = 'board-status-manager-content';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'gb-btn gb-btn-sm';
  closeButton.dataset.e2eId = 'board-status-manager-close';
  closeButton.textContent = '閉じる';
  closeButton.style.cssText = 'min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;line-height:1.2;';
  let undoCaptured = false;
  let actionPending = false;
  const captureUndo = () => {
    if (undoCaptured) return;
    undoCaptured = true;
    if (typeof bdPushUndo === 'function') bdPushUndo();
  };
  const bindStatusSwatches = () => {
    content.querySelectorAll('.bd-status-color').forEach((swatch) => {
      const idx = parseInt(swatch.dataset.i, 10);
      bindColorSwatch(swatch, () => getColorSwatchValue(swatch, bd.statuses[idx]?.color || '#888'), (nextColor) => {
        const appliedColor = nextColor || '#888';
        captureUndo();
        setColorSwatchValue(swatch, appliedColor);
        if (Number.isFinite(idx) && bd.statuses[idx]) bd.statuses[idx].color = appliedColor;
        bdDirty();
      });
    });
  };
  function render() {
    let html = '<div data-bd-status-list>';
    bd.statuses.forEach((s,i) => {
      html += `<div data-bd-status-row="${i}" style="box-sizing:border-box;display:grid;grid-template-columns:minmax(92px,1fr) 44px minmax(96px,1fr) 44px;gap:6px;align-items:center;width:100%;max-width:100%;min-width:0;margin-bottom:8px;">
        <input class="gb-input" aria-label="ステータス名" type="text" value="${esc(s.name)}" data-i="${i}" data-f="name" style="box-sizing:border-box;width:100%;max-width:100%;min-width:0;grid-column:1;grid-row:1;">
        <button type="button" class="bd-status-color gb-color-swatch gb-color-swatch--status" data-i="${i}" data-f="color" data-color="${esc(s.color)}" title="色" aria-label="ステータスの色" style="grid-column:2;grid-row:1;"></button>
        <label style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px;align-items:center;min-width:0;grid-column:3;grid-row:1;">透過<input type="range" min="0" max="1" step="0.1" value="${s.opacity}" data-i="${i}" data-f="opacity" style="box-sizing:border-box;width:100%;max-width:100%;min-width:0;"></label>
        <label style="display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px;align-items:center;min-width:0;grid-column:1 / -1;grid-row:2;">枠<input class="gb-input" aria-label="ステータスの枠線" type="text" value="${esc(s.border||'')}" data-i="${i}" data-f="border" placeholder="例: 2px solid #22c55e" style="box-sizing:border-box;width:100%;max-width:100%;min-width:0;"></label>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-icon" data-del="${i}" aria-label="ステータス「${esc(s.name)}」を削除" style="grid-column:4;grid-row:1;">${lucide('x', 16)}</button>
      </div>`;
    });
    html += `<div style="margin-top:8px;"><button type="button" class="gb-btn gb-btn-sm" id="bd-st-add" data-e2e-id="board-status-add">+ ステータスを追加</button></div></div>`;
    content.innerHTML = html;
    content.querySelectorAll('button').forEach(button => {
      button.style.minWidth = '44px';
      button.style.minHeight = '44px';
    });
    bindStatusSwatches();
    replaceIcons(content);
  }
  const modalApi = window.GBUI.createModal({
    id: uid,
    title: 'ステータス管理',
    body: content,
    footer: closeButton,
    variant: 'standard',
    extraClass: 'bd-status-manager-dialog',
    geometryKey: 'board-status-manager',
    minWidth: '0',
    initialFocus: () => content.querySelector('[data-f="name"], #bd-st-add') || closeButton,
    returnFocus: returnFocus || undefined,
    closeLabel: 'ステータス管理を閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
    onBeforeClose: reason => !actionPending || reason === 'complete',
  });
  modalApi.overlay.dataset.e2eId = 'board-status-manager-overlay';
  modalApi.overlay._bdStatusManagerApi = modalApi;
  modalApi.modal.dataset.e2eId = 'board-status-manager-dialog';
  const headerClose = modalApi.header.querySelector('.gb-modal-close');
  headerClose?.setAttribute('data-e2e-id', 'board-status-manager-header-close');
  if (headerClose) headerClose.style.cssText = 'width:44px;min-width:44px;height:44px;min-height:44px;';
  modalApi.modal.style.cssText = 'width:min(680px, calc(100vw - 24px));overflow:hidden;';
  modalApi.body.style.cssText = 'box-sizing:border-box;min-width:0;min-height:0;overflow-y:auto;';
  modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
  render();
  const setActionPending = pending => {
    actionPending = !!pending;
    modalApi.overlay.setAttribute('aria-busy', actionPending ? 'true' : 'false');
    modalApi.modal.setAttribute('aria-busy', actionPending ? 'true' : 'false');
  };
  const runDialogHistory = async (direction, focusSpec) => {
    if (actionPending) return;
    setActionPending(true);
    try {
      if (typeof _bdHasCommonHistory === 'function' && _bdHasCommonHistory()) {
        const operation = direction === 'redo' ? historyRedo : historyUndo;
        await operation(_bdHistoryScope());
      } else if (direction === 'redo') {
        if (typeof bdRedo === 'function') bdRedo();
      } else if (typeof bdUndo === 'function') {
        bdUndo();
      }
      undoCaptured = false;
      render();
      const nextFocus = focusSpec?.field
        ? content.querySelector(`[data-f="${focusSpec.field}"][data-i="${focusSpec.index}"]`)
        : content.querySelector('[data-f="name"], #bd-st-add');
      nextFocus?.focus?.({ preventScroll: true });
    } finally {
      setActionPending(false);
    }
  };
  content.addEventListener('keydown', ev => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const key = String(ev.key || '').toLowerCase();
    const redo = key === 'y' || (key === 'z' && ev.shiftKey);
    if (key !== 'z' && key !== 'y') return;
    ev.preventDefault();
    ev.stopPropagation();
    const focusSpec = { field: ev.target?.dataset?.f || '', index: ev.target?.dataset?.i || '' };
    runDialogHistory(redo ? 'redo' : 'undo', focusSpec).catch(error => {
      console.error('ステータス管理の履歴操作に失敗しました:', error);
      try { showStatus('ステータス管理の履歴操作に失敗しました', true); } catch {}
    });
  });
  content.addEventListener('input', (ev) => {
    const i = parseInt(ev.target.dataset.i, 10), f = ev.target.dataset.f;
    if (!Number.isFinite(i) || !f || !bd.statuses[i]) return;
    if (f === 'name') {
      const oldName = bd.statuses[i].name || '';
      const nextName = _bdUniqueStatusName(ev.target.value, i);
      if (ev.target.value !== nextName) ev.target.value = nextName;
      if (nextName === oldName) return;
      captureUndo();
      _bdRenameStatusOnNodes(oldName, nextName);
      bd.statuses[i].name = nextName;
      bdRender();
      bdDirty();
      return;
    }
    captureUndo();
    if (f === 'opacity') {
      bd.statuses[i][f] = +ev.target.value;
    } else if (f === 'border') {
      const nextBorder = String(ev.target.value || '').replace(/[\r\n]+/g, ' ').trim();
      if (ev.target.value !== nextBorder) ev.target.value = nextBorder;
      bd.statuses[i][f] = nextBorder;
    } else {
      bd.statuses[i][f] = ev.target.value;
    }
    bdRender();
    bdDirty();
  });
  content.addEventListener('click', async (ev) => {
    const delBtn = ev.target.closest?.('[data-del]');
    if (delBtn?.dataset?.del!==undefined) {
      const idx = +delBtn.dataset.del;
      if (actionPending || !Number.isFinite(idx) || !bd.statuses[idx]) return;
      const label = bd.statuses[idx].name || 'このステータス';
      setActionPending(true);
      delBtn.disabled = true;
      let mutationCheckpoint = null;
      let statusesBefore = null;
      let nodeStatusesBefore = null;
      let undoCapturedBefore = undoCaptured;
      try {
        if (typeof cfConfirm === 'function' && !(await cfConfirm(`ステータス「${label}」を削除しますか？`))) return;
        mutationCheckpoint = _bdDialogCaptureMutationCheckpoint();
        statusesBefore = bd.statuses.slice();
        nodeStatusesBefore = (bd.nodes || []).map(node => ({
          node,
          hadStatus: Object.prototype.hasOwnProperty.call(node, 'status'),
          status: node.status,
        }));
        undoCapturedBefore = undoCaptured;
        captureUndo();
        bd.statuses.splice(idx,1);
        _bdClearStatusOnNodes(label);
        bdRender();
        bdDirty();
        render();
      } catch (error) {
        if (mutationCheckpoint) {
          bd.statuses = statusesBefore;
          nodeStatusesBefore.forEach(entry => {
            if (entry.hadStatus) entry.node.status = entry.status; else delete entry.node.status;
          });
          undoCaptured = undoCapturedBefore;
          _bdDialogRestoreMutationCheckpoint(mutationCheckpoint);
          try { bdRender(); } catch (renderError) { console.error('ステータス削除復元後の再描画に失敗しました:', renderError); }
          render();
        }
        console.error('ステータスを削除できませんでした:', error);
        try { showStatus('ステータスを削除できませんでした', true); } catch {}
      } finally {
        setActionPending(false);
        if (delBtn.isConnected) delBtn.disabled = false;
      }
      return;
    }
    if (ev.target.id==='bd-st-add') {
      captureUndo();
      bd.statuses.push({name:_bdUniqueStatusName('新規'),color:'#888',opacity:1,border:''});
      bdDirty();
      render();
    }
  });
  closeButton.addEventListener('click', () => {
    if (actionPending) return;
    bdRender();
    bdDirty();
    modalApi.close('footer-close');
  });
  modalApi.open();
  replaceIcons(modalApi.overlay);
  return modalApi;
}

// --- 16. Help Dialog ---
function bdShowHelp() {
  if (!window.GBUI?.createModal) throw new Error('ボード ショートカットダイアログを初期化できませんでした');
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const content = document.createElement('div');
  content.dataset.e2eId = 'board-shortcuts-content';
  content.style.cssText = `box-sizing:border-box;width:100%;max-width:100%;min-width:0;font-size:13px;line-height:2;columns:${window.innerWidth <= 900 ? 1 : 2};column-gap:24px;overflow-wrap:anywhere;`;
  content.innerHTML = `
      <div><kbd>ダブルクリック</kbd> トピック追加/編集</div>
      <div><kbd>左ドラッグ (空白)</kbd> 範囲選択</div>
      <div><kbd>左ドラッグ (トピック)</kbd> 移動</div>
      <div><kbd>右ドラッグ (空白)</kbd> パン</div>
      <div><kbd>右ドラッグ (トピック)</kbd> ライン</div>
      <div><kbd>ホイール</kbd> ズーム</div>
      <div><kbd>中ボタンドラッグ</kbd> パン</div>
      <div><kbd>Space+矢印</kbd> パン</div>
      <div><kbd>Ctrl++/-</kbd> ズーム</div>
      <div><kbd>Tab</kbd> サブトピック追加</div>
      <div><kbd>Enter</kbd> 同階層トピック追加</div>
      <div><kbd>Shift+Enter</kbd> トピック内改行 (編集中)</div>
      <div><kbd>F2</kbd> テキスト編集</div>
      <div><kbd>Esc</kbd> 編集完了/選択解除</div>
      <div><kbd>Delete</kbd> 削除</div>
      <div><kbd>矢印</kbd> トピック間移動</div>
      <div><kbd>Ctrl+矢印</kbd> 位置微調整</div>
      <div><kbd>Shift+矢印</kbd> 方向選択追加</div>
      <div><kbd>Ctrl+A</kbd> 全選択</div>
      <div><kbd>Ctrl+D</kbd> 全解除</div>
      <div><kbd>Ctrl+C/V</kbd> コピー/ペースト</div>
      <div><kbd>Ctrl+Z/Y</kbd> 元に戻す/やり直し</div>
      <div><kbd>自動保存</kbd> 編集内容を保存</div>
  `;
  content.querySelectorAll(':scope > div').forEach(row => {
    row.style.breakInside = 'avoid';
    row.style.maxWidth = '100%';
    row.style.minWidth = '0';
    row.style.overflowWrap = 'anywhere';
  });
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'gb-btn gb-btn-sm';
  closeButton.dataset.e2eId = 'board-shortcuts-close';
  closeButton.textContent = '閉じる';
  closeButton.style.cssText = 'min-width:44px;min-height:44px;';
  const modalApi = window.GBUI.createModal({
    id: 'board-shortcuts-dialog',
    title: 'ボード ショートカット',
    body: content,
    footer: closeButton,
    variant: 'standard',
    extraClass: 'bd-shortcuts-dialog',
    geometryKey: 'board-shortcuts',
    minWidth: '0',
    initialFocus: closeButton,
    returnFocus: returnFocus || undefined,
    closeLabel: 'ボード ショートカットを閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
  });
  modalApi.overlay.dataset.e2eId = 'board-shortcuts-overlay';
  modalApi.modal.dataset.e2eId = 'board-shortcuts-dialog';
  const headerClose = modalApi.header.querySelector('.gb-modal-close');
  headerClose?.setAttribute('data-e2e-id', 'board-shortcuts-header-close');
  if (headerClose) headerClose.style.cssText = 'width:44px;min-width:44px;height:44px;min-height:44px;';
  modalApi.modal.style.cssText = 'width:min(560px, calc(100vw - 24px));overflow:hidden;';
  modalApi.body.style.cssText = 'box-sizing:border-box;min-width:0;min-height:0;overflow-y:auto;';
  modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
  closeButton.addEventListener('click', () => modalApi.close('footer-close'));
  modalApi.open();
  replaceIcons(modalApi.overlay);
  return modalApi;
}


// 2026-04-18: 旧 _bdCreateNoteForNode (未完成で末尾切れていた) を廃止し、
// 「リンクカード化」メニュー用の汎用関数に置き換え。対象は既存カード 1 件。
//   - bdLinkifyCardAs(nodeId, type)   新規ファイルを作成してリンク化 ('page'|'database'|'board')
//   - bdLinkifyCardFromExisting(nodeId) 既存ファイル選択ダイアログから選んでリンク化
async function bdLinkifyCardAs(nodeId, type) {
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !bd.path) { showStatus('先にボードを保存してください', true); return; }
  if (n.link) {
  if (!(await cfConfirm('このトピックには既にリンクが設定されています。上書きしますか？'))) return;
  }
  const parentDir = typeof _bdBoardDir === 'function' ? _bdBoardDir() : bd.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const baseLabel = (n.text || '無題').trim() || '無題';
  try {
    const res = await apiPost('/outliner/add', { type, label: baseLabel, parent: parentDir });
    const nodeData = res?.node || {};
    const label = nodeData.name || nodeData.label || baseLabel;
    const path = nodeData.path || '';
    if (!path) throw new Error('path missing');
    bdPushUndo();
    n.link = path;
    n.linkType = nodeData.type || type;
    n.text = label;
    if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nodeId], 'linkify-card', { detailPanel: true });
    else bdRender();
    bdDirty();
    if (typeof _bdOpenEntryInRightSidebar === 'function') _bdOpenEntryInRightSidebar(label, path, n.linkType);
    showStatus('リンクトピック化: ' + label);
  } catch {
    showStatus('リンクトピック化に失敗しました', true);
  }
}

async function bdLinkifyCardFromExisting(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !bd.path) { showStatus('先にボードを保存してください', true); return; }
  if (n.link) {
  if (!(await cfConfirm('このトピックには既にリンクが設定されています。上書きしますか？'))) return;
  }
  const applyLink = (linkPath, maybeLabel, linkType) => {
    if (!linkPath) return;
    bdPushUndo();
    n.link = linkPath;
    n.linkType = linkType || '';
    const fallback = linkPath.split(/[/\\]/).pop() || linkPath;
    const label = (maybeLabel && maybeLabel.trim()) || fallback;
    if (!n.text || n.text === '無題') n.text = label;
    if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nodeId], 'linkify-existing', { detailPanel: true });
    else bdRender();
    bdDirty();
    showStatus('リンクトピック化: ' + label);
  };
  if (typeof showLinkInsertModal === 'function') {
    showLinkInsertModal(null, (result) => {
      if (!result) return;
      if (result.type === 'file') applyLink(result.path, result.name, result.fileType || '');
      else if (result.type === 'url') applyLink(result.url, result.url.split('/').pop(), '');
    });
    return;
  }
  // フォールバック: リンクモーダルが未ロードなら直接入力
  const rawPath = await cfPrompt('リンク先のパスを入力', '');
  if (rawPath == null || !rawPath.trim()) return;
  applyLink(rawPath.trim(), null);
}
