      caret.style.top = ((rect.top - elRect.top) / zoom) + 'px';
      caret.style.height = (rect.height || 18) + 'px';
    }
    caret.style.display = '';
  };
  el._bdCaretUpdate = updateCaret;
  document.addEventListener('selectionchange', updateCaret);
  setTimeout(updateCaret, 0);
}
// 課題8: contentEditable='false' への代入がブラウザによっては同期的に blur を誘発し、
// blur ハンドラ (bdEditNode 側) が bdFinishEdit() を再入呼び出しすることがある。
// 再入すると bd.editing が途中で null 化され、外側の呼び出しが `bd.nodes.find(...===bd.editing)`
// で自ノードを見失い、確定処理 (bdPushUndo/text 反映) が丸ごと skip される実害があるため、
// 実行中フラグで多重実行そのものを防ぐ。
let _bdFinishEditRunning = false;
function bdFinishEdit() {
  if (!bd.editing || _bdFinishEditRunning) return;
  _bdFinishEditRunning = true;
  try {
    const el = document.querySelector('.bd-node.bd-editing');
    let editedNode = null;
    let changed = false;
    let beforeText = '';
    if (el) {
      el.classList.remove('bd-editing');
      const txt = el.querySelector('.bd-text');
      txt.contentEditable = 'false';
      editedNode = bd.nodes.find(v=>v.id===bd.editing);
      if (editedNode) {
        beforeText = editedNode.text || '';
        const nextText = txt.innerText.trim();
        changed = nextText !== beforeText;
        if (changed) {
          bdPushUndo();
          editedNode.text = nextText;
        }
        txt.innerHTML = applyAutoLinks(esc(editedNode.text).replace(/\n/g,'<br>'), bd.path);
      }
      // カスタムキャレットを削除 + selectionchange リスナー解除
      if (el._bdCaretUpdate) { document.removeEventListener('selectionchange', el._bdCaretUpdate); el._bdCaretUpdate = null; }
      const caret = el.querySelector(':scope > .bd-custom-caret');
      if (caret) caret.remove();
    }
    bd.editing = null;
    if (changed && editedNode?._topicCanonicalOnly && editedNode?.topicRef) {
      const attemptedText = editedNode.text;
      void window.MeldexTopicPlacementUI.updateProjectedBoardText(editedNode, attemptedText)
        .catch((error) => {
          if (editedNode.text === attemptedText) editedNode.text = beforeText;
          if (typeof showStatus === 'function') showStatus(error?.message || 'トピックの保存に失敗しました', true);
          if (typeof bdRender === 'function') bdRender();
        });
    } else if (changed) bdDirty();
    // 編集解除後も `.bd-selection-rect` の `is-editing` を外すため再同期
    if (editedNode && typeof bdMeasureNodeElement === 'function') bdMeasureNodeElement(editedNode, el);
    if (changed && editedNode && typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(editedNode.id, 'finish-edit');
    if (editedNode && typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty([editedNode.id], 'finish-edit');
    if (changed && editedNode && typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [editedNode.id] }, 'finish-edit');
    if (typeof bdSyncResizeHandleForNode === 'function') bdSyncResizeHandleForNode(editedNode?.id || '');
    else if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
    // テキスト編集でカード高さが変わっていた場合は、構造ツリーの全体整列をリクエストする。
    // 高さ差で周囲のカードと重なるケースを救済するため、autoAlign が on かつ構造ありで実行。
    if (changed && editedNode && typeof bd !== 'undefined' && bd.autoAlign !== false) {
      const _editedRoot = (typeof bdRoot === 'function') ? bdRoot(editedNode.id) : null;
      if (_editedRoot?.structure) {
        if (typeof bdRequestAutoLayout === 'function') bdRequestAutoLayout(_editedRoot.id);
        else if (typeof bdAutoLayout === 'function') bdAutoLayout(_editedRoot.id);
      }
    }
    document.getElementById('bd-canvas').focus();
  } finally {
    _bdFinishEditRunning = false;
  }
}

// --- 削除 ---
function _bdSelectedConnectionIdsForDelete() {
  return typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
}

async function _bdConfirmDeleteSelection() {
  const nodeCount = bd.selected?.size || 0;
  const lineCount = _bdSelectedConnectionIdsForDelete().length;
  let msg;
  if (nodeCount && lineCount) msg = `${nodeCount}件のトピックと${lineCount}件のラインを削除しますか？`;
  else if (nodeCount > 1) msg = `${nodeCount}件のトピックを削除しますか？`;
  else if (nodeCount === 1) msg = 'このトピックを削除しますか？';
  else if (lineCount > 1) msg = `${lineCount}件のラインを削除しますか？`;
  else msg = 'このラインを削除しますか？';
  try {
    if (typeof cfConfirm === 'function') return !!(await cfConfirm(msg));
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') return !!window.confirm(msg);
  } catch (_err) {
    return false;
  }
  return true;
}

async function bdDeleteSelected(options = {}) {
  if (!_bdSelectedConnectionIdsForDelete().length && bd.selected.size===0) return;
  if (options.confirm !== false && !(await _bdConfirmDeleteSelection())) return;
  const selectedConnIdsBeforeDelete = _bdSelectedConnectionIdsForDelete();
  if (!selectedConnIdsBeforeDelete.length && bd.selected.size===0) return;
  bdPushUndo();
  if (bd.selected.size === 0 && selectedConnIdsBeforeDelete.length) {
    selectedConnIdsBeforeDelete.forEach(connId => {
      if (typeof bdRemoveConnection === 'function') bdRemoveConnection(connId, { skipRender: true, skipDirty: true, skipSelection: true });
    });
    bdClearConnectionSelection();
    bdDrawConns();
    bdDirty();
    if (typeof bdSyncBoardUi === 'function') bdSyncBoardUi(true);
    return;
  }
  const deletedIds = [...bd.selected];
  const anchorId = (bd._activeNode && bd.selected.has(bd._activeNode)) ? bd._activeNode : deletedIds[0];
  const anchorNode = anchorId ? bd.nodes.find(n => n.id === anchorId) : null;
  const anchorEl = anchorId ? document.getElementById('bdn-' + anchorId) : null;
  const anchorPoint = anchorNode ? {
    x: anchorNode.x + ((anchorEl?.offsetWidth || anchorNode.w || 160) / 2),
    y: anchorNode.y + ((anchorEl?.offsetHeight || anchorNode.h || 36) / 2),
  } : null;
  // Phase 4: カード/ライン混在選択時、単独選択されたラインも削除する
  const selectedConnIds = new Set(selectedConnIdsBeforeDelete);
  const removedConnIds = bd.connections
    .filter(c => !c || bd.selected.has(c.from) || bd.selected.has(c.to) || selectedConnIds.has(c.id))
    .map(c => c?.id)
    .filter(Boolean);
  if (removedConnIds.length && typeof apiPost === 'function' && bd?.path) {
    removedConnIds.forEach(connId => {
      apiPost('/annotations/orphan-by-target', {
        target_kind: 'board_line',
        target_file: bd.path,
        item_id: connId,
        cascade_container: true,
      }).catch(() => {});
    });
  }
  bd.connections = bd.connections.filter(c =>
    !bd.selected.has(c.from) && !bd.selected.has(c.to) && !selectedConnIds.has(c.id));
  // 削除されるコンテナノードに contained されていた子を外に出す
  // (contained のままだとレンダ時に非表示になるため)
  const _deletedContainers = bd.nodes.filter(n => bd.selected.has(n.id) && n.container);
  if (_deletedContainers.length) {
