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

function bdContextMenu(e, nodeId) {
  _bdCloseAllContextMenus();
  const menu = _bdEnhanceContextMenu(document.createElement('div'), nodeId ? 'カードメニュー' : 'ボードメニュー');
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
    const isLinkCard = nd && !!nd.link;
    const isImageCard = nd && !!nd.img;
    const isRootCard = nd && !nd.parent;
    if (isLinkCard && !multi) {
      item('リンク先を開く', () => {
        if (typeof _bdOpenLinkedTarget === 'function') _bdOpenLinkedTarget(nd);
      });
      item('サブパネルで開く', () => {
        const linkPath = nd.link;
        const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
        if (typeof openLinkInSubPanel === 'function') openLinkInSubPanel(linkPath, linkName, { linkType: nd.linkType });
        else if (typeof bdOpenLinkedPath === 'function') bdOpenLinkedPath(linkPath, linkName, { linkType: nd.linkType, rightOfBoard: true });
      });
      item('メインパネルで開く', () => {
        const linkPath = nd.link;
        const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
        if (typeof openLinkedPathInMainPane === 'function') openLinkedPathInMainPane(linkPath, linkName, { linkType: nd.linkType });
        else if (typeof openLink === 'function') openLink(linkPath, linkName);
      });
      item('右サイドバーで開く', () => {
        const linkPath = nd.link;
        const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
        if (typeof openLinkedPathInRightPane === 'function') openLinkedPathInRightPane(linkPath, linkName, { linkType: nd.linkType });
        else if (typeof openLinkInSubPanel === 'function') openLinkInSubPanel(linkPath, linkName, { linkType: nd.linkType });
      });
      if (typeof canOpenLinkedPathStandalone !== 'function' || canOpenLinkedPathStandalone(nd.link, nd.linkType || '')) {
        item('単独アプリで開く', () => {
          const linkPath = nd.link;
          const linkName = nd.text || linkPath.split(/[/\\]/).pop() || linkPath;
          if (typeof openLinkedPathStandalone === 'function') openLinkedPathStandalone(linkPath, linkName, { linkType: nd.linkType });
        });
      }
      item('リンクをコピー', () => {
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
        const disabled = _bdContextMenuItem(menu, '同階層カード追加 (Enter)', null, { disabled: true, html: false });
        disabled.title = 'ルートカードは親が無いため、同階層追加できません';
      } else {
        item('同階層カード追加 (Enter)', () => {
          bdSelect(nodeId);
          if (typeof bdAddSiblingToSelected === 'function') bdAddSiblingToSelected();
        });
      }
      item('子カード追加 (Ctrl+Enter)', () => {
        bdSelect(nodeId);
        if (typeof bdAddChildToSelected === 'function') bdAddChildToSelected();
      });
      const linkifySub = sub('リンクカード化');
      linkifySub.item('ノート', () => bdLinkifyCardAs(nodeId, 'page'));
      linkifySub.item('シート', () => bdLinkifyCardAs(nodeId, 'smart-db'));
      linkifySub.item('シナリオ', () => bdLinkifyCardAs(nodeId, 'scriptnote'));
      linkifySub.item('ボード', () => bdLinkifyCardAs(nodeId, 'board'));
      linkifySub.item('タイマー', () => bdLinkifyCardAs(nodeId, 'timer'));
      linkifySub.sep();
      linkifySub.item('既存ファイル...', () => bdLinkifyCardFromExisting(nodeId));
      item('接続カードを全選択', () => {
        const ids = new Set([nodeId]); let ch = true;
        while (ch) {
          ch = false;
          bd.connections.forEach(c => {
            if (ids.has(c.from) && !ids.has(c.to)) { ids.add(c.to); ch = true; }
            if (ids.has(c.to) && !ids.has(c.from)) { ids.add(c.from); ch = true; }
          });
        }
        bdDescendants(nodeId).forEach(id => ids.add(id));
        bd.selected = ids;
        document.querySelectorAll('.bd-node').forEach(el => el.classList.toggle('bd-selected', bd.selected.has(el.id.replace('bdn-', ''))));
        if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
        if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi();
      });
    }
    item('複製', () => {
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
      bdRender();
      bdDirty();
    });
    if (multi && nd) {
      item('選択カードをこのカードに内包', () => {
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
          if (typeof showStatus === 'function') showStatus('内包できるカードがありません', true);
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
          }
        });
        bdRender(); bdDirty();
      });
    }
    const hasParentTarget = targetNodeIds.some(id => !!bd.nodes.find(v => v.id === id)?.parent);
    if (nd && hasParentTarget) {
      item('親から切り離す', () => {
        bdPushUndo();
        const depthOf = (id) => (typeof bdParentDepth === 'function') ? bdParentDepth(id) : (() => {
          let depth = 0;
          let cur = bd.nodes.find(v => v.id === id);
          const seen = new Set();
          const limit = Math.max(50, (bd.nodes || []).length + 1);
          while (cur?.parent && depth < limit && !seen.has(cur.id)) {
            seen.add(cur.id);
            cur = bd.nodes.find(v => v.id === cur.parent);
            depth += 1;
          }
          return depth;
        })();
        const ids = (multi ? [...bd.selected] : [nodeId]).sort((a, b) => depthOf(b) - depthOf(a));
        ids.forEach(id => {
          const n = bd.nodes.find(v => v.id === id); if (!n || !n.parent) return;
          const parentId = n.parent;
          if (typeof bdDetachParentChildRelation === 'function') bdDetachParentChildRelation(parentId, id);
          else n.parent = '';
        });
        bdRender(); bdDirty();
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
        bdRender(); bdDirty();
      });
    }
    sep();

    // --- カードスタイル サブ (旧「外観 > カードスタイル」を昇格。切替と管理のみ) ---
    //   書式編集 (色・フォントサイズ・太字/斜体・形状・角丸・影・雲型等) はオプションパネルに一本化。
    //   ここでは「スタイル選択」「階層別スタイル on/off」「スタイル管理」のみ扱う。
    {
      const cardStylePanel = _bdCreateContextSubmenu(menu, 'カードスタイル', 160);
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
      if (nd) {
        const autoPanel = _bdCreateContextSubmenu(cardStylePanel, '階層別スタイル', 120);
        [['有効', true], ['無効', false]].forEach(([label, val]) => {
          const si = _bdContextMenuItem(autoPanel, radioMark(!!nd._autoStyle === val) + label, () => {
            nd._autoStyle = val;
            if (val) delete nd._userCardStyle;
            if (val && typeof bdApplyAutoStyle === 'function') bdApplyAutoStyle(nd.id);
            bdRender(); bdDirty();
            if (nd.structure && typeof bdAutoLayout === 'function') bdAutoLayout(nd.id);
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
        const collapseLabel = nd.collapsed ? '子カードを展開' : '子カードを折りたたむ';
        viewSub.item(collapseLabel, () => {
          bdPushUndo();
          nd.collapsed = !nd.collapsed;
          bdRender(); bdDirty();
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
            bdRender(); bdDirty();
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
          if (typeof bdAutoLayout === 'function') {
            const targetId = nextValue ? id : (typeof bdRoot === 'function' ? bdRoot(id)?.id : id);
            if (targetId) bdAutoLayout(targetId);
          }
        });
        bdRender(); bdDirty();
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
        bdRender(); bdDirty();
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
            bdRender(); bdDirty();
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
    }

    // --- Multi-select: 整列・サイズ・集約・グループ化 ---
    if (multi) {
      sep();
      item('集約カードを追加', () => bdAddSummary());
      const alSub = sub('整列');
      alSub.item('左揃え', () => bdAlign('left')); alSub.item('右揃え', () => bdAlign('right'));
      alSub.item('上揃え', () => bdAlign('top')); alSub.item('下揃え', () => bdAlign('bottom'));
      alSub.item('水平中央', () => bdAlign('centerH')); alSub.item('垂直中央', () => bdAlign('centerV'));
      alSub.item('水平等間隔', () => bdAlign('distributeH')); alSub.item('垂直等間隔', () => bdAlign('distributeV'));
      alSub.sep();
      alSub.item('自動整列（横幅）', () => bdArrangeByWidth());
      alSub.item('自動整列（縦幅）', () => bdArrangeByHeight());
      const nrmSub = sub('サイズ正規化');
      nrmSub.item('高さを揃える', () => bdNormalize('height'));
      nrmSub.item('幅を揃える', () => bdNormalize('width'));
      nrmSub.item('サイズを揃える', () => bdNormalize('size'));
      nrmSub.item('面積を揃える', () => bdNormalize('area'));
      item('グループ化', () => {
        bdPushUndo();
        bd.groups.push({ id: bdId(), name: 'グループ' + (bd.groups.length + 1), nodeIds: [...bd.selected] });
        bdRender(); bdDirty();
      });
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
        item('グループ「'+esc(g.name)+'」を解除', () => { bd.groups=bd.groups.filter(gg=>gg.id!==g.id); bdRender(); bdDirty(); showStatus('グループ解除'); });
      });
    }
    sep();
    dangerItem('削除 (Del)', async () => {
      if (!multi) bdSelect(nodeId);
      const count = bd.selected.size;
      const msg = count > 1 ? `${count}件のカードを削除しますか？` : 'このカードを削除しますか？';
      if (!(await cfConfirm(msg))) return;
      await bdDeleteSelected({ confirm: false });
    });

  } else {
    // --- Blank area menu ---
    const _stw = typeof bdScreenToWorld === 'function' ? bdScreenToWorld(e.clientX, e.clientY) : { x: e.clientX, y: e.clientY };
    const clickWx = _stw.x, clickWy = _stw.y;
    item('カードを追加', () => { bdAddAt(clickWx, clickWy); });
    const newLinkSub = sub('新規リンクカード');
    [
      ['ノート', 'page'],
      ['シート', 'smart-db'],
      ['シナリオ', 'scriptnote'],
      ['ボード', 'board'],
      ['タイマー', 'timer'],
    ].forEach(([label, type]) => {
      newLinkSub.item(label, () => {
        if (typeof bdCreateLinkedFileCardAt === 'function') bdCreateLinkedFileCardAt(clickWx, clickWy, type);
        else showStatus('リンクカード追加機能を読み込めませんでした', true);
      });
    });
    newLinkSub.sep();
    newLinkSub.item('既存ファイルへのリンク...', () => {
      if (typeof bdPromptAddLinkCardAt === 'function') bdPromptAddLinkCardAt(clickWx, clickWy);
      else showStatus('リンクカード追加機能を読み込めませんでした', true);
    });
    if (_bdClipboard && _bdClipboard.length > 0) {
      item('貼り付け (Ctrl+V)', () => { bdPaste(); });
    }
    item('画像を貼り付け (Ctrl+Shift+V)', () => bdPasteImage());
    sep();
    item('自動整列（横幅）', () => bdArrangeByWidth());
    item('自動整列（縦幅）', () => bdArrangeByHeight());
    sep();
    item('検索と置換...', () => bdFindReplace());
    sep();
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
      item('集約カードを追加', () => bdAddSummary());
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

  if (typeof window !== 'undefined' && window.MeldexBoardStandalone?.appendContextMenuItems) {
    try {
      window.MeldexBoardStandalone.appendContextMenuItems(menu);
    } catch (err) {
      console.warn('[board] standalone context menu extension failed', err);
    }
  }

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
  const o = document.createElement('div'); o.className = 'modal-overlay';
  let undoCaptured = false;
  const captureUndo = () => {
    if (undoCaptured) return;
    undoCaptured = true;
    if (typeof bdPushUndo === 'function') bdPushUndo();
  };
  const bindStatusSwatches = () => {
    o.querySelectorAll('.bd-status-color').forEach((swatch) => {
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
    let html = '<div class="modal" style="min-width:400px;"><h3>ステータス管理</h3>';
    html += '<div style="font-size:12px;color:var(--fg2);margin-bottom:8px;">各ステータスの名前・色・透過度・枠線を設定できます</div>';
    bd.statuses.forEach((s,i) => {
      html += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
        <input type="text" value="${esc(s.name)}" data-i="${i}" data-f="name" style="width:80px;font-size:13px;padding:2px 4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;">
        <button type="button" class="bd-status-color gb-color-swatch gb-color-swatch--status" data-i="${i}" data-f="color" data-color="${esc(s.color)}" title="色"></button>
        <label style="font-size:11px;color:var(--fg2);">透過<input type="range" min="0" max="1" step="0.1" value="${s.opacity}" data-i="${i}" data-f="opacity" style="width:50px;vertical-align:middle;"></label>
        <label style="font-size:11px;color:var(--fg2);">枠<input type="text" value="${esc(s.border||'')}" data-i="${i}" data-f="border" placeholder="例: 2px solid #22c55e" style="width:100px;font-size:11px;padding:1px 3px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:2px;"></label>
        <button data-del="${i}" style="font-size:11px;padding:1px 6px;color:var(--fg2);">${lucide('x', 12)}</button>
      </div>`;
    });
    html += `<div style="margin-top:8px;"><button id="bd-st-add" style="font-size:12px;padding:3px 10px;">+ ステータスを追加</button></div>`;
    html += '<div class="btn-row"><button id="bd-st-close">閉じる</button></div></div>';
    o.innerHTML = html;
    bindStatusSwatches();
  }
  render(); document.body.appendChild(o);
  o.addEventListener('input', (ev) => {
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
  o.addEventListener('click', async (ev) => {
    const delBtn = ev.target.closest?.('[data-del]');
    if (delBtn?.dataset?.del!==undefined) {
      const idx = +delBtn.dataset.del;
      if (!Number.isFinite(idx) || !bd.statuses[idx]) return;
      const label = bd.statuses[idx].name || 'このステータス';
      if (typeof cfConfirm === 'function' && !(await cfConfirm(`ステータス「${label}」を削除しますか？`))) return;
      captureUndo();
      bd.statuses.splice(idx,1);
      _bdClearStatusOnNodes(label);
      bdRender();
      bdDirty();
      render();
      return;
    }
    if (ev.target.id==='bd-st-add') {
      captureUndo();
      bd.statuses.push({name:_bdUniqueStatusName('新規'),color:'#888',opacity:1,border:''});
      bdDirty();
      render();
    }
    if (ev.target.id==='bd-st-close') { o.remove(); bdRender(); bdDirty(); }
  });
}

// --- 16. Help Dialog ---
function bdShowHelp() {
  const o = document.createElement('div'); o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="max-width:500px;">
    <h3>ボード ショートカット</h3>
    <div style="font-size:13px;line-height:2;columns:2;column-gap:24px;">
      <div><kbd>ダブルクリック</kbd> カード追加/編集</div>
      <div><kbd>左ドラッグ (空白)</kbd> 範囲選択</div>
      <div><kbd>左ドラッグ (カード)</kbd> 移動</div>
      <div><kbd>右ドラッグ (空白)</kbd> パン</div>
      <div><kbd>右ドラッグ (カード)</kbd> ライン</div>
      <div><kbd>ホイール</kbd> ズーム</div>
      <div><kbd>中ボタンドラッグ</kbd> パン</div>
      <div><kbd>Space+矢印</kbd> パン</div>
      <div><kbd>Ctrl++/-</kbd> ズーム</div>
      <div><kbd>Tab</kbd> 子カード追加</div>
      <div><kbd>Enter</kbd> 同階層カード追加</div>
      <div><kbd>Shift+Enter</kbd> カード内改行 (編集中)</div>
      <div><kbd>F2</kbd> テキスト編集</div>
      <div><kbd>Esc</kbd> 編集完了/選択解除</div>
      <div><kbd>Delete</kbd> 削除</div>
      <div><kbd>矢印</kbd> カード間移動</div>
      <div><kbd>Ctrl+矢印</kbd> 位置微調整</div>
      <div><kbd>Shift+矢印</kbd> 方向選択追加</div>
      <div><kbd>Ctrl+A</kbd> 全選択</div>
      <div><kbd>Ctrl+D</kbd> 全解除</div>
      <div><kbd>Ctrl+C/V</kbd> コピー/ペースト</div>
      <div><kbd>Ctrl+Z/Y</kbd> 元に戻す/やり直し</div>
      <div><kbd>自動保存</kbd> 編集内容を保存</div>
    </div>
    <div class="btn-row"><button data-action="this.closest('.modal-overlay').remove()">閉じる</button></div>
  </div>`;
  document.body.appendChild(o);
}


// 2026-04-18: 旧 _bdCreateNoteForNode (未完成で末尾切れていた) を廃止し、
// 「リンクカード化」メニュー用の汎用関数に置き換え。対象は既存カード 1 件。
//   - bdLinkifyCardAs(nodeId, type)   新規ファイルを作成してリンク化 ('page'|'database'|'board')
//   - bdLinkifyCardFromExisting(nodeId) 既存ファイル選択ダイアログから選んでリンク化
async function bdLinkifyCardAs(nodeId, type) {
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !bd.path) { showStatus('先にボードを保存してください', true); return; }
  if (n.link) {
    if (!(await cfConfirm('このカードには既にリンクが設定されています。上書きしますか？'))) return;
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
    bdRender();
    bdDirty();
    if (typeof _bdOpenEntryInSubPanel === 'function') _bdOpenEntryInSubPanel(label, path, n.linkType);
    showStatus('リンクカード化: ' + label);
  } catch {
    showStatus('リンクカード化に失敗しました', true);
  }
}

async function bdLinkifyCardFromExisting(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !bd.path) { showStatus('先にボードを保存してください', true); return; }
  if (n.link) {
    if (!(await cfConfirm('このカードには既にリンクが設定されています。上書きしますか？'))) return;
  }
  const applyLink = (linkPath, maybeLabel, linkType) => {
    if (!linkPath) return;
    bdPushUndo();
    n.link = linkPath;
    n.linkType = linkType || '';
    const fallback = linkPath.split(/[/\\]/).pop() || linkPath;
    const label = (maybeLabel && maybeLabel.trim()) || fallback;
    if (!n.text || n.text === '無題') n.text = label;
    bdRender();
    bdDirty();
    showStatus('リンクカード化: ' + label);
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
