        if (c.hidden) return;
        const pathEl = document.getElementById(`bd-path-${c.id}`);
        if (!pathEl || typeof pathEl.getTotalLength !== 'function') return;
        try {
          const total = pathEl.getTotalLength();
          if (!total) return;
          const samples = Math.min(240, Math.max(24, Math.ceil(total / Math.max(6, Math.min(24, w || 6, h || 6)))));
          let prev = null;
          for (let i = 0; i <= samples; i++) {
            const pt = pathEl.getPointAtLength((total * i) / samples);
            if (
              (pt.x >= l && pt.x <= l + w && pt.y >= t && pt.y <= t + h) ||
              (prev && typeof bdSegmentIntersectsRect === 'function' && bdSegmentIntersectsRect(prev.x, prev.y, pt.x, pt.y, l, t, w, h))
            ) { rectConnIds.add(c.id); break; }
            prev = pt;
          }
        } catch (_) {}
      });
      let nextConnIds;
      if (selStart.additive) {
        const baseConn = selStart.baseSelConnIds || new Set();
        nextConnIds = new Set(baseConn);
        rectConnIds.forEach(id => {
          if (baseConn.has(id)) nextConnIds.delete(id);
          else nextConnIds.add(id);
        });
      } else {
        nextConnIds = rectConnIds;
      }
      const prevConnIds = (bd.selectedConnIds instanceof Set) ? [...bd.selectedConnIds] : [];
      if (typeof bdSetConnectionSelection === 'function') bdSetConnectionSelection([...nextConnIds]);
      if (typeof bdDrawConns === 'function') {
        const dirtyConnIds = [...new Set([...prevConnIds, ...nextConnIds])];
        if (dirtyConnIds.length) bdDrawConns({ connIds: dirtyConnIds, reason: 'rect-select' });
      }
      if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
      else if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(false);
    }
  }

  // --- pointerup on document (global) ---
  function onDocPointerup(e) {
    const wasTouchPinch = !!touchPinch;
    if (bdIsTouchPointer(e)) {
      touchPointers.delete(e.pointerId);
      if (wasTouchPinch) {
        if (touchPointers.size < 2) {
          touchPinch = null;
          canvas.classList.remove('bd-panning');
        }
        return;
      }
    }
    if (bd._lineToolDrag) {
      const start = bd._lineToolDrag;
      document.getElementById('bd-conn-preview')?.remove();
      const targetEl = boardNodeFromTarget(document.elementFromPoint(e.clientX, e.clientY));
      const dropW = typeof bdScreenToWorld === 'function'
        ? bdScreenToWorld(e.clientX, e.clientY)
        : { x: e.clientX, y: e.clientY };
      let created = null;
      if (targetEl) {
        const toId = targetEl.id.replace('bdn-','');
        if (start.nid) {
          if ((start.dragged || toId !== start.nid) && bdCanCreateConnection(start.nid, toId)) {
            bdPushUndo();
            created = bdCreateConnection(start.nid, toId);
          }
        } else if (start.fromPoint) {
          bdPushUndo();
          created = bdCreateConnection('', toId, { fromPoint: start.fromPoint });
        }
      } else if (start.dragged || start.nid) {
        bdPushUndo();
        if (start.nid) created = bdCreateConnection(start.nid, '', { toPoint: dropW });
        else created = bdCreateConnection('', '', { fromPoint: start.fromPoint, toPoint: dropW });
      }
      if (created) showStatus('ラインを追加しました');
      bd._lineToolDrag = null;
    }
    // Alt+左ドラッグ接続線の完了
    if (bd._rightDragNode) {
      const rd = bd._rightDragNode;
      document.getElementById('bd-conn-preview')?.remove();
      if (rd.dragged) {
        // ドロップ先ノードを検出してライン作成
        const targetEl = boardNodeFromTarget(document.elementFromPoint(e.clientX, e.clientY));
        if (targetEl) {
          const toId = targetEl.id.replace('bdn-','');
          if (bdCanCreateConnection(rd.nid, toId)) { bdPushUndo(); if (bdCreateConnection(rd.nid, toId)) showStatus('ラインを追加しました'); }
        } else {
          const dropW = typeof bdScreenToWorld === 'function'
            ? bdScreenToWorld(e.clientX, e.clientY)
            : { x: e.clientX, y: e.clientY };
          bdPushUndo();
          if (bdCreateConnection(rd.nid, '', { toPoint: dropW })) showStatus('ラインを追加しました');
        }
      }
      // ドラッグしなかった場合は何もしない (ノード選択は pointerdown 時に済んでいる)
      bd._rightDragNode = null;
    }
    if (erasing) {
      erasing = false;
      eraseUndoCaptured = false;
      erasedNodeIds = null;
      erasedConnRefs = null;
    }
    if (_cspZoom) { _cspZoom = false; canvas.classList.remove('bd-panning'); }
    if (_cspRotate) { _cspRotate = false; canvas.classList.remove('bd-panning'); }
    if (pan) {
      if (touchPanPointerId !== null && e.pointerId !== touchPanPointerId) return;
      const wasTouchCanvasPan = touchPanPointerId !== null;
      const touchMoved = e.type === 'pointercancel' || touchPanMoved || Math.abs(e.clientX - panSX) >= 6 || Math.abs(e.clientY - panSY) >= 6;
      pan=false; canvas.classList.remove('bd-panning');
      if (wasTouchCanvasPan) {
        try { canvas.releasePointerCapture?.(touchPanPointerId); } catch (_) {}
        if (!touchMoved && !bdIsAnnotationModeActive()) {
          bdSelect(null);
          if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
        }
        touchPanPointerId = null;
        touchPanMoved = false;
      }
      // 移動量が小さければ右クリックメニュー。nid があればノードメニュー、なければ空白メニュー
      if (bd._rightClickPos) {
        const dx=Math.abs(e.clientX-bd._rightClickPos.x), dy=Math.abs(e.clientY-bd._rightClickPos.y);
        // 注釈ツールバーオン時はボードの右クリックメニューを出さない (注釈描画の邪魔になるため)
        if (dx<15 && dy<15 && !bdIsAnnotationModeActive()) {
          const menuNid = bd._rightClickPos.nid;
          // ノード上で右クリックした場合、そのノードが未選択なら選択してからメニューを出す
          // (メニュー項目の多くは選択中カードを対象にするため)
          if (menuNid && typeof bdSelect === 'function' && !bd.selected.has(menuNid) && !bd._rightClickPos.e.shiftKey) {
            bdSelect(menuNid);
          }
          bdContextMenu(bd._rightClickPos.e, menuNid || null);
        }
        bd._rightClickPos=null;
      }
    }
    if (drag) {
      canvas.classList.remove('bd-node-dragging');
      // 2026-04-18: 自動整列がオンで、ドラッグ量が小さい場合に上下左右のカードへ吸着する。
      // bd.autoAlign は未定義時も true として扱う (defaultOn)。
      const autoAlignOn = typeof bd !== 'undefined' && bd.autoAlign !== false;
      const _draggedId = drag;
      const _draggedOffsets = dragOffsets;
      const dragIdsAtDrop = Object.keys(dragOffsets || {});
      const dragIdsForContainer = dragIdsAtDrop.filter(id => !_draggedOffsets?.[id]?.followOnly);
      const didDragMove = dragMoved || bdDragMovedBeyondClickThreshold(dragOffsets, e);
      if (!didDragMove) {
        document.querySelectorAll('.bd-node.bd-drop-target').forEach(el => el.classList.remove('bd-drop-target'));
        drag=null; dragOffsets=null; dragMoved=false; dragUndoCaptured=false; bd._dragExtracted=false;
        return;
      }
      ensureDragUndoCaptured();
      // ドロップターゲットがあればコンテナ内包を実行
      const dropTarget = didDragMove
        ? (bdFindNodeDropTargetAtPoint(e.clientX, e.clientY, dragIdsAtDrop)
          || document.querySelector('.bd-node.bd-drop-target'))
        : null;
      let containerized = false;
      if (dropTarget && dragOffsets) {
        const parentId = dropTarget.id.replace('bdn-','');
        const parentNode = bd.nodes.find(v => v.id === parentId);
        const dragIds = dragIdsForContainer.length ? dragIdsForContainer : dragIdsAtDrop;
        // 循環防止: ドロップ先がドラッグ中のノードの子孫でないこと
        const descendants = new Set();
        dragIds.forEach(id => bdDescendants(id).forEach(d => descendants.add(d)));
        if (parentNode && !dragIds.includes(parentId) && !descendants.has(parentId)) {
          // contained 連鎖を辿って絶対座標を算出するヘルパー
          // (parentNode や dragIds のノードが多段 contained の場合、相対座標のままでは差分が正しく取れない)
          const getAbs = (n) => {
            let ax = n.x, ay = n.y;
            let cur = n;
            while (cur.contained && cur.parent) {
              const p = bd.nodes.find(v => v.id === cur.parent);
              if (!p) break;
              ax += p.x; ay += p.y;
              cur = p;
            }
            return { x: ax, y: ay };
          };
          const parentAbs = getAbs(parentNode);
          // ドロップ先カードをコンテナ化し、ドラッグしたカードを contained として取り込む
          parentNode.container = true;
          dragIds.forEach(id => {
            const n = bd.nodes.find(v => v.id === id);
            if (!n) return;
            const nAbs = getAbs(n);
            // 新親 (parentNode) 相対座標に変換 (parentNode が contained でも絶対座標基準なので正しい)
            n.x = nAbs.x - parentAbs.x;
            n.y = nAbs.y - parentAbs.y;
            n.parent = parentId;
            n.contained = true;
          });
          bdRender();
          containerized = true;
          showStatus('コンテナに内包しました');
        }
        dropTarget.classList.remove('bd-drop-target');
      }
      document.querySelectorAll('.bd-node.bd-drop-target').forEach(el => el.classList.remove('bd-drop-target'));
      // 2026-04-18: 自動整列がオンで、ドラッグ量が小さい場合に上下左右のカードへ吸着する。
      // _dropTarget が処理された (コンテナ化) 時は吸着しない。
      if (autoAlignOn && _draggedId && _draggedOffsets && !containerized && !dropTarget
          && typeof _bdSnapNodeToNeighbors === 'function') {
        const o = _draggedOffsets[_draggedId];
        const n = bd.nodes.find(v => v.id === _draggedId);
        if (n && o) {
          const moveAbs = Math.abs(n.x - o.ox) + Math.abs(n.y - o.oy);
          const SMALL_DRAG_THRESHOLD = 40; // 40px 未満の小さなドラッグは吸着対象
          // 1px 以下 (= ほぼクリック) のときは吸着しない。微小なドラッグで勝手にカードが動くのを防ぐ。
          if (moveAbs > 1 && moveAbs < SMALL_DRAG_THRESHOLD) {
            // 選択中のカード全ての位置に snap delta を一括適用
            const delta = _bdSnapNodeToNeighbors(_draggedId, Object.keys(_draggedOffsets));
            if (delta && (delta.dx !== 0 || delta.dy !== 0)) {
              Object.keys(_draggedOffsets).forEach(id => {
                const nn = bd.nodes.find(v => v.id === id);
                if (nn && !nn.locked) { nn.x += delta.dx; nn.y += delta.dy; }
                const el = document.getElementById('bdn-' + id);
                if (el && nn && !nn.contained) { el.style.left = nn.x + 'px'; el.style.top = nn.y + 'px'; }
              });
              const snapIds = Object.keys(_draggedOffsets);
              bdDrawConns({ nodeIds: snapIds, reason: 'drag-snap' });
              snapIds.forEach(id => {
                if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
              });
              if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
            }
          }
        }
      }
      const movedIds = Object.keys(dragOffsets || {});
      if (didDragMove) bdSuppressNodeClickAfterDrag(movedIds);
      if (typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(movedIds, 'drag-end');
      if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(movedIds, 'drag-end');
      if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true }, 'drag-end');
      drag=null; dragOffsets=null; dragMoved=false; dragUndoCaptured=false; bd._dragExtracted=false; bdDirty();
    }
    if (resizing) {
      const _resizedId = resizing;
      const finishedResizeSelection = resizeSelection;
      resizing=null;
      resizeNode=null;
      resizeSelection=null;
      if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(false);
      // 2026-04-18: 自動整列がオン && リサイズしたカードが構造ツリーに属するなら、
      // サイズ変化に合わせて周囲カードを再配置する (bdAutoLayout をルートに対して実行)。
      // contained カード (コンテナ内のカード) はワールド座標レイアウトと相性が悪いため対象外。
      if (typeof bd !== 'undefined' && bd.autoAlign !== false && _resizedId) {
        const _resizedNode = bd.nodes.find(v => v.id === _resizedId);
        if (_resizedNode && !_resizedNode.contained) {
          const rootId = (typeof _bdFindStructureRoot === 'function') ? _bdFindStructureRoot(_resizedId) : null;
          if (rootId && typeof bdAutoLayout === 'function') bdAutoLayout(rootId);
        }
      }
      if (finishedResizeSelection && typeof bdMarkNodesMoved === 'function') bdMarkNodesMoved(finishedResizeSelection.items.map(item => item.id), 'resize-end');
      if (finishedResizeSelection && typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ frames: true, minimap: true, boardUi: true }, 'resize-end');
      bdDirty();
    }
    if (selRect) { selRect.remove(); selRect=null; selStart=null; }
    else if (selStart) { selStart=null; }
  }

  // --- contextmenu on canvas ---
  function onCanvasContextmenu(e) { e.preventDefault(); e.stopPropagation(); }

  // --- dblclick on canvas ---
  function onCanvasDblclick(e) {
    if (!bdEnsureInteractiveCanvas(canvas)) return;
    if (bdIsAnnotationModeActive()) return;
    // Space+ダブルクリック: 表示リセット（Shift併用で回転のみリセット）
    if (_spaceDown) {
      if (e.shiftKey) { bdResetRotation(); }
      else { bd.zoom = 1; bd.panX = 0; bd.panY = 0; bd.rotation = 0; bdTransform(); showStatus('表示をリセット'); }
      return;
    }
    const ne = e.target.closest('.bd-node');
    if (ne) {
      const nid = ne.id.replace('bdn-','');
      // リンク付きカードはリンク先を開く。Ctrl+ダブルクリックはテキスト編集。
      if (!e.ctrlKey && bdOpenNodeLink(nid)) return;
      bdEditNode(nid);
    }
    else { const wc=bdScreenToWorld(e.clientX,e.clientY); bdAddAt(wc.x,wc.y); }
  }

  // --- wheel on canvas ---
  function onCanvasWheel(e) {
    if (!bdEnsureInteractiveCanvas(canvas)) return; e.preventDefault();
    const local = (typeof bdClientToCanvasLocal === 'function')
      ? bdClientToCanvasLocal(e.clientX, e.clientY, canvas)
      : { x: e.clientX, y: e.clientY };
    const rotation = Number(bd.rotation) || 0;
    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;
    let mx = local.x, my = local.y;
    if (rotation) {
      const rad = -rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = mx - centerX;
      const dy = my - centerY;
      mx = dx * cos - dy * sin + centerX;
      my = dx * sin + dy * cos + centerY;
    }
    const oz = bd.zoom;
    const anchorWorldX = (mx - bd.panX) / oz;
    const anchorWorldY = (my - bd.panY) / oz;
    // v0.5.319: ホイールズームを 10% 刻み (0.1 単位) にスナップ
    const step = 0.1;
    const dir = e.deltaY > 0 ? -1 : 1;
    let newZoom = Math.round(oz / step) * step + dir * step;
    newZoom = Math.round(newZoom / step) * step;  // 浮動小数点誤差の正規化
    newZoom = Math.max(0.1, Math.min(5, newZoom));
    bd.zoom = newZoom;
    bd.panX = mx - anchorWorldX * bd.zoom;
    bd.panY = my - anchorWorldY * bd.zoom;
    bdTransform();
  }

  // --- dragover on canvas ---
  function onCanvasDragover(e) {
    // パネル/タブ操作系の D&D はキャンバスではなくペイン側で処理させる
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.isPanelDnD(e.dataTransfer.types, e.ctrlKey)) return;
    if (bdIsInteractiveCanvas(canvas)) e.preventDefault();
  }

  // --- drop on canvas ---
  function onCanvasDrop(e) {
    // パネル/タブ操作系の D&D はキャンバスではなくペイン側で処理させる
    if (typeof MeldexDnD !== 'undefined' && MeldexDnD.isPanelDnD(e.dataTransfer.types, e.ctrlKey)) return;
    if (!bdEnsureInteractiveCanvas(canvas)) return;
    e.preventDefault(); e.stopPropagation();
    const {x: wx, y: wy} = bdScreenToWorld(e.clientX, e.clientY);

    // フォルダツリーからのドロップ
    const cfData = e.dataTransfer.getData('application/x-meldex-node');
    if (cfData) {
      try {
        const parsed = JSON.parse(cfData);
        const items = Array.isArray(parsed?.items) && parsed.items.length
          ? parsed.items
          : [{ name: parsed?.name || '', path: parsed?.path || '', type: parsed?.type || '' }];
        const extIsImage = lowerPath => ['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.avif','.ico'].some(ext => lowerPath.endsWith(ext));
        const pendingNodes = [];
        const addedIds = [];
        items.forEach((item, index) => {
          const path = String(item?.path || '').trim();
          if (!path) return;
          const name = String(item?.name || path.split(/[/\\]/).pop() || path).trim() || path;
          const lower = path.toLowerCase();
          const imgUrl = (item?.type === 'image' || extIsImage(lower))
            ? API_BASE + '/file-raw?path=' + encodeURIComponent(path)
            : '';
          const linkType = item?.type || (typeof _bdInferLinkType === 'function' ? _bdInferLinkType(path, '') : '');
          const offsetX = (index % 4) * 260;
          const offsetY = Math.floor(index / 4) * 220;
          const node = typeof bdCreateNodeWithStyle === 'function'
            ? bdCreateNodeWithStyle(name, wx + offsetX, wy + offsetY, { link: path, linkType, img: imgUrl, w: imgUrl ? 240 : 200 })
            : bdNode(name, wx + offsetX, wy + offsetY, imgUrl ? 240 : 200, 0, { link: path, linkType, img: imgUrl });
          pendingNodes.push(node);
        });
        if (pendingNodes.length) {
          bdPushUndo();
          pendingNodes.forEach(node => {
            bd.nodes.push(node);
            addedIds.push(node.id);
          });
        }
        if (addedIds.length) {
          const activeId = addedIds.length === 1 ? addedIds[0] : null;
          if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
          try {
            addedIds.forEach(id => {
              const node = bd.nodes.find(n => n.id === id);
              if (node && typeof bdAppendFastNode === 'function') bdAppendFastNode(node);
              if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(id, 'drop-cards');
            });
            if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: addedIds }, 'drop-cards');
          } finally {
            if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
          }
          bd.selected = new Set(addedIds);
          bd._activeNode = activeId;
          bdClearConnectionSelection();
          bdApplySelectionDomClass();
          addedIds.forEach(id => {
            if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(id);
          });
          if (typeof bdSyncResizeHandleForNode !== 'function' && typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
          if (activeId) {
            const activeNode = bd.nodes.find(node => node.id === activeId);
            if (activeNode?.link && typeof bdShowLinkedSelectionPreview === 'function') bdShowLinkedSelectionPreview(activeNode.link, activeNode.linkType);
          }
          if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
          bdDirty();
          showStatus(addedIds.length > 1 ? `${addedIds.length}件のカードを追加しました` : 'カードを追加しました');
        }
      } catch(err) {
        console.error('[board] meldex-node drop failed:', err);
        if (typeof showStatus === 'function') showStatus('ドロップ処理に失敗: ' + (err?.message || err), true);
      }
      return;
    }

    // ノートからのテキストドロップ → テキストカード追加
    const meldexText = e.dataTransfer.getData('application/x-meldex-text');
    if (meldexText) {
      try {
        const { text } = JSON.parse(meldexText);
        if (text) {
          bdPushUndo();
          const label = String(text);
          const node = typeof bdCreateNodeWithStyle === 'function'
            ? bdCreateNodeWithStyle(label, wx, wy, { w: 240 })
            : bdNode(label, wx, wy, 240, 0, {});
          bd.nodes.push(node);
          if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(node)) {
            if (typeof bdRequestFullRender === 'function') bdRequestFullRender('drop-text-fallback');
            else bdRender();
          }
          if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(node.id, 'drop-text');
          if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [node.id] }, 'drop-text');
          bd.selected = new Set([node.id]);
          bd._activeNode = node.id;
          bdClearConnectionSelection();
          bdApplySelectionDomClass();
          if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(node.id);
          else if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
          if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
          bdDirty();
          showStatus('テキストカードを追加しました');
        }
      } catch {}
      return;
    }

    // ファイルドロップ
    const files = e.dataTransfer.files;
    if (!files.length || !bd.path) return;
    const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const boardDir = bd.path.substring(0, bd.path.lastIndexOf('/'));
    const dropBoardPath = bd.path;
    const dropOpenSeq = Number(bd._openSeq) || 0;
    const dropStillTargetsCurrentBoard = () => (
      bd.path === dropBoardPath && (!dropOpenSeq || Number(bd._openSeq) === dropOpenSeq)
    );
    const cleanupAbandonedUploads = (items) => {
      const uploadedPaths = (items || []).map(item => item?.path).filter(Boolean);
      if (!uploadedPaths.length || typeof apiPost !== 'function') return;
      Promise.allSettled(uploadedPaths.map(path => apiPost('/outliner/delete', { path }, { silentError: true }))).catch(() => {});
    };
    const jobs = [];
    let ox = 0;
    for (const f of files) {
      const offsetX = ox;
      const isImage = f.type.startsWith('image/');
      jobs.push((async () => {
        try {
          const data = await readFileAsDataURL(f);
          if (!dropStillTargetsCurrentBoard()) return null;
          const res = await apiFetch('/upload-file?path=' + encodeURIComponent(boardDir), {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({data, filename: f.name}),
          });
          if (!res.ok) return null;
          return { name: f.name, path: res.path || '', isImage, offsetX };
        } catch (err) {
          showStatus('ファイルの保存に失敗しました', true);
          return null;
        }
      })());
      ox += 220;
    }
    Promise.all(jobs).then(results => {
      if (!dropStillTargetsCurrentBoard()) {
        cleanupAbandonedUploads(results);
        if (typeof showStatus === 'function') showStatus('別のボードに切り替わったため、ファイルカードの追加を中止しました', true);
        return;
      }
      const nodes = results.filter(Boolean).map(item => {
        if (item.isImage && item.path) {
          const imgUrl = API_BASE + '/file-raw?path=' + encodeURIComponent(item.path);
          const linkType = typeof _bdInferLinkType === 'function' ? _bdInferLinkType(item.path, 'image') : 'image';
          return typeof bdCreateNodeWithStyle === 'function'
            ? bdCreateNodeWithStyle('', wx + item.offsetX, wy, { img: imgUrl, link: item.path, linkType, w: 250 })
            : bdNode('', wx + item.offsetX, wy, 250, 0, { img: imgUrl, link: item.path, linkType });
        }
        const linkType = typeof _bdInferLinkType === 'function' ? _bdInferLinkType(item.path || '', '') : '';
        return typeof bdCreateNodeWithStyle === 'function'
          ? bdCreateNodeWithStyle(item.name, wx + item.offsetX, wy, { link: item.path || '', linkType, w: 200 })
          : bdNode(item.name, wx + item.offsetX, wy, 200, 0, { link: item.path || '', linkType });
      });
      if (!nodes.length) {
        return;
      }
      bdPushUndo();
      nodes.forEach(n => bd.nodes.push(n));
      const ids = nodes.map(n => n.id);
      if (typeof bdBeginFastBoardMutation === 'function') bdBeginFastBoardMutation();
      try {
        nodes.forEach(n => {
          if (typeof bdAppendFastNode === 'function') bdAppendFastNode(n);
          if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(n.id, 'drop-files');
        });
        if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: ids }, 'drop-files');
      } finally {
        if (typeof bdEndFastBoardMutation === 'function') bdEndFastBoardMutation();
      }
      bdDirty();
    });
  }

  // --- Space key tracking (CSP-compatible pan/zoom/rotate) ---
  const _rotateCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'/%3E%3Cpath d='M3 3v5h5'/%3E%3C/svg%3E") 12 12, crosshair`;
  function _updateSpaceCursor(e) {
    if (!_spaceDown) return;
    canvas.style.cursor = e.ctrlKey ? 'zoom-in' : e.shiftKey ? _rotateCursor : 'grab';
  }
  function onKeydownSpace(e) {
    if (!bdIsInteractiveCanvas(canvas)) return;
    if (e.code === 'Space' && !e.repeat && !bd.editing) {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      _spaceDown = true;
      _updateSpaceCursor(e);
      // ノード・ラインのポインタイベントを無効化（カーソル変化防止）
      const world = document.getElementById('bd-world');
      if (world) world.style.pointerEvents = 'none';
      e.preventDefault();
    }
    // Space押下中にCtrl/Shiftが変わったらカーソル更新
    if (_spaceDown && (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
      _updateSpaceCursor(e);
    }
  }
  function onKeyupSpace(e) {
    if (e.code === 'Space') {
      _resetSpaceState();
    }
    // Space押下中にCtrl/Shiftを離したらカーソル更新
    if (_spaceDown && (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
      _updateSpaceCursor(e);
    }
  }

  // blur / visibilitychange で Space keyup を取りこぼしたときの復旧
  function _resetSpaceState() {
    _spaceDown = false;
    bd._spaceHeld = false;
    if (pan) pan = false;
    if (_cspZoom) _cspZoom = false;
    if (_cspRotate) _cspRotate = false;
    touchPanPointerId = null;
    touchPanMoved = false;
    touchPinch = null;
    touchPointers.clear();
    canvas.style.cursor = '';
    canvas.classList.remove('bd-panning');
    const world = document.getElementById('bd-world');
    if (world) world.style.pointerEvents = '';
  }
  function onWindowBlurSpace() { _resetSpaceState(); }
  function onVisibilityChangeSpace() {
    if (document.hidden) _resetSpaceState();
  }

  // --- Attach listeners ---
  canvas.addEventListener('pointerdown', onCanvasPointerdown);
  canvas.addEventListener('contextmenu', onCanvasContextmenu);
  canvas.addEventListener('dblclick', onCanvasDblclick);
  canvas.addEventListener('wheel', onCanvasWheel, {passive:false});
  canvas.addEventListener('dragover', onCanvasDragover);
  canvas.addEventListener('drop', onCanvasDrop);
  document.addEventListener('pointermove', onDocPointermove);
  document.addEventListener('pointerup', onDocPointerup);
  document.addEventListener('pointercancel', onDocPointerup);
  document.addEventListener('keydown', onKeydownSpace);
  document.addEventListener('keyup', onKeyupSpace);
  window.addEventListener('blur', onWindowBlurSpace);
  document.addEventListener('visibilitychange', onVisibilityChangeSpace);

  // --- Cleanup ---
  return function bdCleanupInteraction() {
    canvas.removeEventListener('pointerdown', onCanvasPointerdown);
    canvas.removeEventListener('contextmenu', onCanvasContextmenu);
    canvas.removeEventListener('dblclick', onCanvasDblclick);
    canvas.removeEventListener('wheel', onCanvasWheel);
    canvas.removeEventListener('dragover', onCanvasDragover);
    canvas.removeEventListener('drop', onCanvasDrop);
    document.removeEventListener('pointermove', onDocPointermove);
    document.removeEventListener('pointerup', onDocPointerup);
    document.removeEventListener('pointercancel', onDocPointerup);
    document.removeEventListener('keydown', onKeydownSpace);
    document.removeEventListener('keyup', onKeyupSpace);
    window.removeEventListener('blur', onWindowBlurSpace);
    document.removeEventListener('visibilitychange', onVisibilityChangeSpace);
    _resetSpaceState();
  };
}

// ============================================================
//  Keyboard Interaction
// ============================================================

/**
 * Direction-based nearest node search.
 */
function bdFindNearest(fromId, dir) {
  const fn = bd.nodes.find(n=>n.id===fromId); if (!fn) return null;
  const fe = document.getElementById('bdn-'+fromId);
  if (!fe || !fe.isConnected) return null;
  const fromPos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(fn) : { x: fn.x, y: fn.y };
  const fx = fromPos.x + (fe?fe.offsetWidth/2:80), fy = fromPos.y + (fe?fe.offsetHeight/2:20);
  let best = null, bestDist = Infinity;
  bd.nodes.forEach(n => {
    if (n.id===fromId) return;
    const ne = document.getElementById('bdn-'+n.id);
    if (!ne || !ne.isConnected) return;
    const pos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(n) : { x: n.x, y: n.y };
    const nx = pos.x + (ne?ne.offsetWidth/2:80), ny = pos.y + (ne?ne.offsetHeight/2:20);
    const dx = nx-fx, dy = ny-fy;
    // 方向フィルタ
    if (dir==='left' && dx>=0) return;
    if (dir==='right' && dx<=0) return;
    if (dir==='up' && dy>=0) return;
    if (dir==='down' && dy<=0) return;
    const dist = dx*dx + dy*dy;
    if (dist<bestDist) { bestDist=dist; best=n.id; }
  });
  return best;
}

/**
 * Set up keyboard event handlers for the canvas.
 * Call after the canvas DOM is ready.
 * @returns {Function} cleanup - removes all event listeners
 */
function bdInitKeyboard(root) {
  const canvas = root?.querySelector?.('[data-bd-role="canvas"]')
    || (typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas', root) : null)
    || document.getElementById('bd-canvas');
  if (!canvas) return () => {};

  // Space押下状態トラッキング
  bd._spaceHeld = false;
  function onDocKeydown(e) { if (e.key===' ' && bdIsInteractiveCanvas(canvas) && !bd.editing) bd._spaceHeld=true; }
  function onDocKeyup(e) { if (e.key===' ') bd._spaceHeld=false; }

  // 離散ショートカット（Delete, Ctrl+A/D/S/C/X/Z/Y, F2, Enter, Tab等）
  // → gb-shortcuts.js の中央ハンドラに移行済み
  // 残存: 矢印キーナビゲーション、Space操作、編集モードキー
  function onCanvasKeydown(e) {
    if (!bdEnsureInteractiveCanvas(canvas)) return;
    if (bdIsAnnotationModeActive()) return;
    if (e.defaultPrevented) return;

    // --- 編集中 ---
    if (bd.editing) {
      // Enter (修飾キーなし) で編集確定。Shift+Enter は改行を許可するためデフォルト挙動を残す。
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey)) {
        bdFinishEdit();
        e.preventDefault();
      } else if (e.key === 'Tab' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        // Tab / Ctrl+Enter: 編集を確定して子カードを追加
        e.preventDefault();
        bdFinishEdit();
        setTimeout(() => {
          if (typeof bdAddChildToSelected === 'function') bdAddChildToSelected();
        }, 0);
      }
      return;
    }

    // --- 非編集 ---

    // Ctrl+F: 検索バー / Ctrl+H: 置換バー (モーダルダイアログではなく上書き表示)
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const lk = (e.key || '').toLowerCase();
      if (lk === 'f' && typeof bdOpenFindBar === 'function') { e.preventDefault(); bdOpenFindBar('find'); return; }
      if (lk === 'h' && typeof bdOpenFindBar === 'function') { e.preventDefault(); bdOpenFindBar('replace'); return; }
    }

    if (e.key === 'Escape' && bd.tool && bd.tool !== 'select') {
      e.preventDefault();
      bdSetTool('select');
      return;
    }

    const arrow = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[e.key];

    if (arrow) {
      // Ctrl+矢印 (Shift / Alt 修飾なし): 中央ハンドラ (gb-shortcuts.js board.ctrlArrow*) に委譲する。
      // ここで preventDefault せず、なおかつ canvas-interact 側の処理もスキップする。
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        return;
      }

      e.preventDefault();

      // Space+矢印: ボード全体をパン
      if (bd._spaceHeld) {
        const panStep = 50;
        if (arrow==='left') bd.panX+=panStep;
        else if (arrow==='right') bd.panX-=panStep;
        else if (arrow==='up') bd.panY+=panStep;
        else if (arrow==='down') bd.panY-=panStep;
        bdTransform();
        return;
      }

      // Shift+矢印: 方向のノードを選択に追加
      if (e.shiftKey && !e.ctrlKey) {
        const active = bd._activeNode || (bd.selected.size===1 ? [...bd.selected][0] : null);
        if (!active) return;
        const next = bdFindNearest(active, arrow);
        if (next) {
          if (bd.selected.has(next)) bd.selected.delete(active);
          else bd.selected.add(next);
          bd._activeNode = next;
          bdApplySelectionDomClass();
          if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
        }
        return;
      }

      // 矢印のみ: アクティブノード移動
      const active = bd._activeNode || (bd.selected.size===1 ? [...bd.selected][0] : null);
      const next = bdFindNearest(active || (bd.nodes[0]?.id), arrow);
      if (next) { bdSelect(next); bd._activeNode = next; }
      return;
    }

    // Space: フォーカス/復元（矢印なし）
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) {
        if (bd.selected.size===1) bdFocusSelected();
        else if (_bdFocusSaved) { bd.zoom=_bdFocusSaved.zoom; bd.panX=_bdFocusSaved.panX; bd.panY=_bdFocusSaved.panY; _bdFocusSaved=null; bdTransform(); document.getElementById('bd-zoom-label').textContent=Math.round(bd.zoom*100)+'%'; }
      }
      return;
    }

    // Escape: スライドショー停止 + 選択解除
    if (e.key === 'Escape') {
      if(typeof _bdSlideshow !== 'undefined' && _bdSlideshow) bdStopSlideshow();
      bdSelect(null); bd.connecting=null; bd._connOrigin=null; bd._activeNode=null;
      e.preventDefault();
      return;
    }

    // --- 印字可能文字によるクイック編集開始 ---
    // 1枚選択中に a/s/あ など印字可能な1文字キーを押したら、そのカードの編集を開始して
    // 既存テキストの末尾にその文字を追記する。IME 変換中 (isComposing / keyCode 229) は対象外。
    if (
      bd.selected.size === 1
      && !e.ctrlKey && !e.metaKey && !e.altKey
      && !e.isComposing && e.keyCode !== 229
      && typeof e.key === 'string' && e.key.length === 1
    ) {
      const id = [...bd.selected][0];
      e.preventDefault();
      const typed = e.key;
      bdEditNode(id);
      setTimeout(() => {
        const el = document.getElementById('bdn-' + id);
        const txt = el?.querySelector('.bd-text');
        if (!txt) return;
        txt.innerText = (txt.innerText || '') + typed;
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(txt);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        if (typeof el._bdCaretUpdate === 'function') el._bdCaretUpdate();
      }, 0);
      return;
    }
  }

  // --- Attach listeners ---
  document.addEventListener('keydown', onDocKeydown);
  document.addEventListener('keyup', onDocKeyup);
  canvas.addEventListener('keydown', onCanvasKeydown);

  // --- Cleanup ---
  return function bdCleanupKeyboard() {
    document.removeEventListener('keydown', onDocKeydown);
    document.removeEventListener('keyup', onDocKeyup);
    canvas.removeEventListener('keydown', onCanvasKeydown);
  };
}

// ============================================================
//  Link helpers
// ============================================================

/**
 * Open a node's link with the appropriate opener. Returns true if the node had a link.
 */
function bdOpenNodeLink(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n || !n.link) return false;
  if (typeof _bdOpenLinkedTarget === 'function') _bdOpenLinkedTarget(n);
  return true;
}

/**
 * Handle click on an auto-detected link inside a node.
 */
function onAutoLinkClick(el, e) {
  const path = el.dataset?.path || el.getAttribute('href') || '';
  if (!path) return;
  if (path.replace(/\\/g, '/').includes('_chat/llm/') && path.includes('#')) {
    const hashIndex = path.indexOf('#');
    if (typeof openSavedChat === 'function') {
      openSavedChat(path.slice(0, hashIndex), path.slice(hashIndex + 1));
      return;
    }
  }
  const name = el.textContent?.trim() || path.split('/').pop();
  if (typeof openLink === 'function') openLink(path, name, { ctrlKey: e?.ctrlKey });
  else if (typeof openPage === 'function') openPage(name, path);
}
