    else { ta.rows = 1; ta.classList.remove('multiline'); }
  }

  let queryComposing = false;
  const isComposingQuery = (e) => queryComposing || e.isComposing || e.keyCode === 229;
  q.addEventListener('compositionstart', () => { queryComposing = true; });
  q.addEventListener('compositionend', () => {
    queryComposing = false;
    autoResize(q);
    doFileSearch(1);
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeFileSearch(); e.preventDefault(); return; }
    // Enter（Shift なし）: 次の検索結果へジャンプ。Shift+Enter: 改行入力
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isComposingQuery(e)) return;
      e.preventDefault();
      doFileSearch(1);
      return;
    }
  });
  q.addEventListener('input', () => autoResize(q));

  r.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeFileSearch(); e.preventDefault(); }
  });
  r.addEventListener('input', () => autoResize(r));
});

function closeFileSearch() {
  document.getElementById('file-search-bar').classList.remove('open');
  clearFileSearchHighlights();
}

function _currentFileSearchEditable() {
  if (state.view === 'entity') return document.getElementById('entity-freetext');
  if (state.view === 'page') return document.getElementById('page-content');
  return null;
}

function doFileSearch(direction) {
  const q = document.getElementById('fsb-query').value;
  if (!q) {
    clearFileSearchHighlights();
    _fileSearchMatches = [];
    _fileSearchIdx = -1;
    _fileSearchLastQuery = '';
    _fileSearchLastRoot = null;
    document.getElementById('fsb-count').textContent = '0/0';
    return;
  }

  // ボードビューの場合はボード内検索
  if (state.view === 'board') { doBoardSearch(q, direction); return; }

  const editable = _currentFileSearchEditable();
  if (!editable || !editable.isConnected) return;

  const previousIdx = _fileSearchIdx;
  const sameSearch = _fileSearchLastQuery === q && _fileSearchLastRoot === editable && previousIdx >= 0;
  clearFileSearchHighlights();

  // テキストノード内でマッチを検索
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  _fileSearchMatches = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent;
    let idx = 0;
    const lq = q.toLowerCase();
    while (true) {
      const pos = text.toLowerCase().indexOf(lq, idx);
      if (pos === -1) break;
      _fileSearchMatches.push({ node, pos, len: q.length });
      idx = pos + q.length;
    }
  }

  if (_fileSearchMatches.length === 0) {
    document.getElementById('fsb-count').textContent = '0/0';
    return;
  }

  // ハイライト表示（CSS highlight APIの代わりにmark要素で）
  // 逆順で挿入してインデックスがずれないようにする
  for (let i = _fileSearchMatches.length - 1; i >= 0; i--) {
    const m = _fileSearchMatches[i];
    const range = document.createRange();
    range.setStart(m.node, m.pos);
    range.setEnd(m.node, m.pos + m.len);
    const mark = document.createElement('mark');
    mark.className = 'file-search-highlight';
    mark.style.cssText = 'background:var(--orange);color:#000;border-radius:1px;';
    try { range.surroundContents(mark); } catch (e) { /* クロスエレメント範囲はスキップ */ }
  }

  // 再収集（markで囲んだのでノードが変わった）
  const marks = editable.querySelectorAll('mark.file-search-highlight');
  if (sameSearch) {
    const step = direction > 0 ? 1 : -1;
    _fileSearchIdx = (previousIdx + step + marks.length) % marks.length;
  } else {
    _fileSearchIdx = direction > 0 ? 0 : marks.length - 1;
  }
  _fileSearchLastQuery = q;
  _fileSearchLastRoot = editable;
  if (_fileSearchIdx >= 0 && _fileSearchIdx < marks.length) {
    marks[_fileSearchIdx].style.outline = '2px solid var(--accent)';
    marks[_fileSearchIdx].scrollIntoView({ block: 'center' });
  }
  document.getElementById('fsb-count').textContent = `${_fileSearchIdx + 1}/${marks.length}`;
}

// --- ボード内検索 ---
function doBoardSearch(q, direction) {
  // Phase D: ボード検索は直接bdFindReplace()を呼ぶ（簡易検索: ノード選択のみ）
  if (typeof bd !== 'undefined' && q) {
    bd.selected = new Set();
    bd.nodes.forEach(n => { if (n.text && n.text.includes(q)) bd.selected.add(n.id); });
    document.querySelectorAll('.bd-node').forEach(el => el.classList.toggle('bd-selected', bd.selected.has(el.id.replace('bdn-', ''))));
    showStatus(bd.selected.size + '件のカードが見つかりました');
  }
}

function clearBoardSearchHighlights() {
  if (typeof bd !== 'undefined') {
    bd.selected = new Set();
    document.querySelectorAll('.bd-node').forEach(el => el.classList.remove('bd-selected'));
  }
}

function clearFileSearchHighlights() {
  const editables = [document.getElementById('page-content'), document.getElementById('entity-freetext')];
  editables.forEach(el => {
    if (!el) return;
    el.querySelectorAll('mark.file-search-highlight').forEach(mark => {
      mark.replaceWith(...mark.childNodes);
    });
    el.normalize();
  });
  // ボード検索ハイライトもクリア
  clearBoardSearchHighlights();
}

function _currentFileSearchMark(editable) {
  const marks = editable?.querySelectorAll?.('mark.file-search-highlight') || [];
  if (!marks.length) return null;
  const index = _fileSearchIdx >= 0 && _fileSearchIdx < marks.length ? _fileSearchIdx : 0;
  return marks[index] || null;
}

function _refreshFileSearchAfterSingleReplace(editable, replacedIndex) {
  const marks = editable?.querySelectorAll?.('mark.file-search-highlight') || [];
  if (!marks.length) {
    _fileSearchMatches = [];
    _fileSearchIdx = -1;
    document.getElementById('fsb-count').textContent = '0/0';
    return;
  }
  _fileSearchIdx = Math.min(Math.max(0, replacedIndex), marks.length - 1);
  marks.forEach(mark => { mark.style.outline = ''; });
  marks[_fileSearchIdx].style.outline = '2px solid var(--accent)';
  marks[_fileSearchIdx].scrollIntoView({ block: 'center' });
  document.getElementById('fsb-count').textContent = `${_fileSearchIdx + 1}/${marks.length}`;
}

function _commitFileSearchReplacement(editable) {
  editable.dispatchEvent(new Event('input', { bubbles: true }));
  editable.dispatchEvent(new Event('blur'));
}

function doFileReplace(all) {
  const q = document.getElementById('fsb-query').value;
  const r = document.getElementById('fsb-replace').value;
  if (!q) return;

  const editable = _currentFileSearchEditable();
  if (!editable || !editable.isConnected) {
    document.getElementById('fsb-count').textContent = 'この画面ではノート本文の置換はできません';
    if (typeof showStatus === 'function') showStatus('この画面ではノート本文の置換はできません', true);
    return;
  }

  if (!all) {
    if (!_currentFileSearchMark(editable) || _fileSearchLastQuery !== q || _fileSearchLastRoot !== editable) {
      doFileSearch(1);
    }
    const currentMark = _currentFileSearchMark(editable);
    if (!currentMark) {
      document.getElementById('fsb-count').textContent = '0件置換';
      return;
    }
    const replacedIndex = Math.max(0, _fileSearchIdx);
    currentMark.replaceWith(document.createTextNode(r));
    editable.normalize();
    _refreshFileSearchAfterSingleReplace(editable, replacedIndex);
    document.getElementById('fsb-count').textContent = '1件置換';
    _commitFileSearchReplacement(editable);
    return;
  }

  clearFileSearchHighlights();

  // テキストノード単位で置換（HTMLタグ内を誤置換しない）
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  let count = 0;
  const lq = q.toLowerCase();
  for (const node of textNodes) {
    const text = node.textContent;
    const idx = text.toLowerCase().indexOf(lq);
    if (idx === -1) continue;

    if (all) {
      // 全置換: 大文字小文字無視で全一致を置換
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = text.match(regex);
      count += matches ? matches.length : 0;
      node.textContent = text.replace(regex, () => r);
    }
  }

  document.getElementById('fsb-count').textContent = `${count}件置換`;
  if (count > 0) _commitFileSearchReplacement(editable);
}

/* ==============================
   ルビ設定（右クリックメニュー）
   #page-title 等のノート編集以外の contenteditable 向け。
   全域抑止と board 早期 return は meldex-core.part02.js の capture ハンドラへ移管済み。
   ノート編集用 editable (#entity-freetext/#page-content/#dp-editable) は
   bindNoteEditorContextMenu 側のメニュー内「ルビを設定...」項目が担当する。
   ============================== */
function _editorPointRect(x, y) {
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return { left, right: left, top, bottom: top, width: 0, height: 0 };
}

function _editorEventAnchorRect(e, fallbackEl) {
  const fallback = fallbackEl?.getBoundingClientRect?.();
  const x = Number.isFinite(e?.clientX) && e.clientX > 0 ? e.clientX : (fallback?.left || 12);
  const y = Number.isFinite(e?.clientY) && e.clientY > 0 ? e.clientY : (fallback?.top || 12);
  return _editorPointRect(x, y);
}

function _positionEditorPopup(popup, anchorRect, options) {
  if (!popup) return;
  if (typeof positionPopup === 'function') {
    // 縦書きでは下に開くと本文の続きを隠すため、行の進行方向と直交する側（左）へ寄せる
    const prefer = (typeof MeldexNoteWritingMode !== 'undefined') ? MeldexNoteWritingMode.popupPrefer() : 'below';
    positionPopup(popup, anchorRect, Object.assign({ prefer }, options || {}));
    return;
  }
  const z = typeof _getZoom === 'function' ? (_getZoom() || 1) : 1;
  popup.style.left = ((anchorRect?.left || 12) / z) + 'px';
  popup.style.top = ((anchorRect?.bottom ?? anchorRect?.top ?? 12) / z) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(popup);
}

function _editorMenuSeparator() {
  const sep = document.createElement('div');
  sep.className = 'gb-context-menu-sep';
  sep.setAttribute('role', 'separator');
  return sep;
}

function _editorMenuButton(label, enabled, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gb-context-menu-item';
  button.setAttribute('role', 'menuitem');
  button.textContent = label;
  if (!enabled) {
    button.classList.add('disabled');
    button.disabled = true;
    button.setAttribute('aria-disabled', 'true');
  }
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (!enabled) return;
    onClick?.(event, button);
  });
  return button;
}

function _closeEditorPopup(popup, cleanup, restoreFocusEl) {
  if (!popup) return;
  if (popup.isConnected) popup.remove();
  cleanup?.();
  // preventScroll を付けないと、ポップアップを閉じた拍子に本文がスクロールする
  if (restoreFocusEl?.isConnected && typeof restoreFocusEl.focus === 'function') {
    try { restoreFocusEl.focus({ preventScroll: true }); } catch (_) { restoreFocusEl.focus(); }
  }
}

// ページタイトルへのルビ設定は削除した。適用処理が保存先パスを見つけられず必ず途中で
// 止まっており（タイトルはファイル名そのものでルビの保存先が無い）、右クリックしても
// 何も起きない項目になっていたため。本文のルビは gb-note-ruby.js が担当する。

/* ==============================
   Notion風キーボードショートカット
   ============================== */
// 書式ショートカット（Ctrl+B/I/U/E、Ctrl+Shift+1-9/0/H、Tab等）
// Ctrl+F/Shift+F、Alt+↓ → gb-shortcuts.js の中央ハンドラに移行済み

// 残存ハンドラ: F2/Delete（フォルダツリー操作）、Shift+F10（キーボード右クリック）、
//               Escape（検索パネルを閉じる）
document.addEventListener('keydown', async (e) => {
  if (e.defaultPrevented) return;

  const isEditing = document.activeElement?.contentEditable === 'true' || document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';

  // F2: フォルダツリーのインラインリネーム（フォルダビュー・ボード・エディタ中は除外）
  if (e.key === 'F2' && !isEditing && state.view !== 'folder' && state.view !== 'board' && treeSelection.lastClicked) {
    e.preventDefault();
    const nd = treeSelection.lastClicked._nodeData;
    const lbl = treeSelection.lastClicked.querySelector('.tree-label');
    if (nd && lbl && nd.type !== 'entity' && !nd._isRoot && !(nd.path && isItemLocked(nd.path))) startTreeLabelEdit(lbl, nd);
    return;
  }
  // Delete: フォルダツリーのツリー項目削除
  // ユーザーの最後のポインタ操作がフォルダツリー内にあった場合だけ発火する。
  // 以前は !isEditing のみを見ていたため、エディタから Esc/blur でフォーカスを body に戻した直後の
  // Delete で意図せずツリー側の選択ファイルが削除されていた。
  // tree-node 自体は tabindex を持たないので activeElement は当てにならず、
  // gb-app.js の pointerdown リスナーが window._lastPointerInTree を更新する。
  const active = document.activeElement;
  const inTreeByFocus = !!(active && (active.id === 'outliner-tree' || active.closest?.('#outliner-tree') || active.closest?.('.tree-node')));
  const inTreeByPointer = !!window._lastPointerInTree;
  if (e.key === 'Delete' && !isEditing && (inTreeByFocus || inTreeByPointer) && treeSelection.items.size > 0 && state.view !== 'folder' && state.view !== 'board') {
    const items = [...treeSelection.items].map(n => n._nodeData).filter(d => d && !d._isRoot && !(d.path && isItemLocked(d.path)));
    if (items.length === 0) return;
    const impactTargets = items.map(item => ({ path: item.path, kind: item.type === 'folder' ? 'folder' : 'file' }));
    const confirmMessage = items.length + ' 件を削除しますか？';
    const confirmed = typeof MeldexDeleteImpactWarning !== 'undefined'
      ? await MeldexDeleteImpactWarning.confirmDeleteWithImpact(impactTargets, confirmMessage)
      : await cfConfirm(confirmMessage);
    if (!confirmed) return;
    deleteOutlinerItemsWithHistory(items, {
      label: items.length + ' 件を削除',
      onItemDeleted: (item) => {
        if (typeof _removeOutlinerNodesForPaths === 'function') _removeOutlinerNodesForPaths([item.path]);
      },
      refresh: async () => {
        if (typeof loadOutliner === 'function') await loadOutliner();
        if (typeof renderWorkspaceSidebar === 'function') renderWorkspaceSidebar();
      },
    }).then((result) => {
      const deletedCount = result.deletedCount || result.succeeded.length;
      showStatus(deletedCount + ' 件を削除しました（Undoで戻せます）' + (result.failedCount ? `（${result.failedCount}件失敗）` : ''), result.failedCount > 0);
      if (typeof loadOutliner === 'function') loadOutliner();
    });
    return;
  }

  // Escape: 検索パネルを閉じる（中央ハンドラではEscapeをglobalに登録していないため残存）
  if (e.key === 'Escape') {
    if (document.getElementById('file-search-bar')?.classList.contains('open')) { closeFileSearch(); e.preventDefault(); return; }
    if (document.getElementById('search-panel')?.classList.contains('open')) { closeSearchPanel(); e.preventDefault(); return; }
  }

  // Shift+F10: 右クリックメニューをキーボードで呼び出し
  if (e.key === 'F10' && e.shiftKey) {
    e.preventDefault();
    const el = document.activeElement;
    const rect = el ? el.getBoundingClientRect() : { left: 100, top: 100, bottom: 120 };
    const sel = window.getSelection();
    let x = rect.left + 20, y = rect.top + 20;
    if (sel && !sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      x = r.left; y = r.bottom;
    }
    const evt = new MouseEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true });
    (el || document.body).dispatchEvent(evt);
    return;
  }
});

// 計画書§5工程7-8: 現在行の論理ブロック定義・移動判定は gb-note-block-reorder.js
// （MeldexNoteBlockTypes.resolveCurrentBlockベース）へ統合した。旧実装は
// document.activeElement を無条件に「編集ホスト」とみなし、見出しセクション
// ラッパー（section.heading-section）を越えてpc直下まで無条件に登っていたため
// heading-section単位で誤って移動する経路があった。ハンドルドラッグと
// Alt+Shift+↑/↓が同じresolverを共有する（§2.4「ドラッグとキーボードは同じ
// resolverを使う」）。第一級の実装は gb-note-block-reorder.js を参照。
function moveBlock(direction) {
  if (typeof MeldexNoteBlockReorder === 'undefined') return;
  return MeldexNoteBlockReorder.moveBlock(direction);
}

// ノート本文のルビ入力ポップアップは gb-note-ruby.js（MeldexNoteRuby）へ移設した。
// 通常は文字選択で出る書式設定ポップアップへ統合され、そこが使えない環境
// （クラウドのスマホ編集UI等）だけ MeldexNoteRuby.showLegacyPopup が使われる。

async function confirmNoteTableDelete(message) {
  if (typeof cfConfirm === 'function') return !!(await cfConfirm(message));
  if (typeof confirm === 'function') return !!confirm(message);
  return true;
}

// ノート/自由記述の右クリックメニュー
// 旧: document 委譲 → editable コンテナ個別登録へ移行（global-contextmenu-refactor-plan.md）
// contextOverride: 行ハンドルの右クリック（gb-note-block-reorder.js の
// _onHandleContextMenu）から呼ばれる場合に渡される { editable, blockInfo }。
// 通常の contextmenu バインド（bindNoteEditorContextMenu）経由では
// e.currentTarget が editable 自身なので省略でよい（バグ報告§3の「可能であれば」対応）。
function _noteCtxMenuHandler(e, contextOverride) {
  const editable = (contextOverride && contextOverride.editable) || e.currentTarget;
  if (!editable || editable.contentEditable !== 'true') return;
  e.preventDefault();
  closeColHeaderMenu();
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());

  const sel = window.getSelection();
  const selectionRange = sel && !sel.isCollapsed && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  const hasSelection = !!(selectionRange && _rangeBelongsToEditable(editable, selectionRange));
  const savedRange = hasSelection ? selectionRange.cloneRange() : null;
  const anchorSourceRect = e.target?.getBoundingClientRect?.() || editable.getBoundingClientRect();
  const anchorX = Number.isFinite(e.clientX) && e.clientX > 0 ? e.clientX : anchorSourceRect.left;
  const anchorY = Number.isFinite(e.clientY) && e.clientY > 0 ? e.clientY : anchorSourceRect.top;
  const commentAnchorEl = {
    getBoundingClientRect: () => ({ left: anchorX, right: anchorX, top: anchorY, bottom: anchorY, width: 0, height: 0 }),
  };

  // 選択を復元してからアクションを実行するヘルパー
  const restoreAndExec = (action) => {
    editable.focus();
    if (savedRange) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(savedRange.cloneRange());
    }
    action();
  };

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'ノート本文メニュー');
  // mousedownで選択が消えないようにpreventDefault
  menu.addEventListener('mousedown', (ev) => ev.preventDefault());

  // 選択範囲を復元してから execCommand を実行するヘルパー（書式ポップアップ用）
  const applyFormat = (cmd, value) => {
    editable.focus();
    if (savedRange) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(savedRange.cloneRange());
    }
    document.execCommand(cmd, false, value);
  };

  // Audit-P1 H-2: 右クリック時点で e.target から明示コンテキストを構築し、
  // addCommentHere に override として渡す（detectCommentContext の DOM スキャンに頼らない）。
  const _ctxScanEl = e.target;
  const _ctxTargetEl = _ctxScanEl?.nodeType === Node.ELEMENT_NODE ? _ctxScanEl : _ctxScanEl?.parentElement;
  const _commentHighlightEl = _ctxTargetEl?.closest?.('.cmt-highlight,.cmt-line-highlight');
  // 計画書§5工程9-1: 右クリック/長押し位置(caretRangeFromPoint優先、フォールバックは
  // e.target位置)から対象の論理ブロック(行)を解決する。ロック中/読み取り専用時は
  // このハンドラ自体が発火しない(呼び出し元 bindNoteEditorContextMenu 参照)。
  const _blockInfo = (contextOverride && contextOverride.blockInfo !== undefined)
    ? contextOverride.blockInfo
    : ((typeof MeldexNoteBlockContextMenu !== 'undefined')
      ? MeldexNoteBlockContextMenu.resolveBlockInfoForEvent(editable, e, _ctxTargetEl)
      : null);
  const _blockIsHeading = !!(_blockInfo && _blockInfo.kind === 'heading');
  const items = [
    { label: 'コメントを追加', enabled: true, action: () => restoreAndExec(() => {
      if (typeof addCommentHere !== 'function') return;
      let override = null;
      try {
        if (typeof CommentBadges !== 'undefined' && typeof CommentBadges.detectCommentContext === 'function') {
          override = CommentBadges.detectCommentContext(_ctxScanEl);
        }
      } catch (_) { override = null; }
      addCommentHere(override || undefined, { anchorEl: commentAnchorEl });
    }) },
    { type: 'sep' },
    { label: '切り取り', enabled: hasSelection, action: () => restoreAndExec(() => document.execCommand('cut')) },
    { label: 'コピー', enabled: hasSelection, action: () => restoreAndExec(() => document.execCommand('copy')) },
    { label: '貼り付け', enabled: true, action: () => restoreAndExec(() => navigator.clipboard.readText().then(t => document.execCommand('insertText', false, t)).catch(() => {})) },
    { type: 'sep' },
    { label: '元に戻す', enabled: true, action: () => { editable.focus(); document.execCommand('undo'); } },
    { label: 'やり直し', enabled: true, action: () => { editable.focus(); document.execCommand('redo'); } },
    { type: 'sep' },
    { label: 'すべて選択', enabled: true, action: () => { editable.focus(); document.execCommand('selectAll'); } },
    { type: 'sep' },
    // 計画書§5工程9: 「行種変更」(共通行種メニューのサブメニュー)。
    { type: 'blockType', blockInfo: _blockInfo },
    // 計画書§5工程11項目4: 見出し限定で「この見出しへのリンクをコピー」を追加する。
    ...(_blockIsHeading ? [{
      label: 'この見出しへのリンクをコピー',
      enabled: true,
      action: () => {
        if (typeof MeldexNoteBlockContextMenu !== 'undefined') MeldexNoteBlockContextMenu.copyHeadingLink(_blockInfo.block);
      },
    }] : []),
    { type: 'sep' },
    { type: 'format', label: '書式…', enabled: hasSelection },
    { type: 'sep' },
    { label: 'Googleで検索', enabled: hasSelection, action: () => {
      const query = (savedRange ? savedRange.toString() : (sel ? sel.toString() : '')).trim();
      if (!query) return;
      const url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
      try { window.open(url, '_blank', 'noopener,noreferrer'); }
      catch { window.location.href = url; }
    }},
    { type: 'sep' },
    { label: 'ルビを設定...', enabled: hasSelection, action: () => {
      if (!savedRange) return;
      if (typeof MeldexNoteRuby === 'undefined') return;
      MeldexNoteRuby.insertRuby(editable, savedRange);
    }},
    { label: 'リンクを挿入...', enabled: true, action: () => {
      restoreAndExec(() => {});
      showLinkInsertModal(savedRange);
    }},
    { label: 'リンクを解除', enabled: !!_ctxTargetEl?.closest('a'), action: () => restoreAndExec(() => document.execCommand('unlink')) },
  ];
  if (_commentHighlightEl) {
    items.unshift(
      { label: 'コメント一覧を開く', enabled: true, action: () => {
        const filePath = _commentHighlightEl.dataset.cmtFile || editable.dataset.path || document.getElementById('page-content')?.dataset.path || state.currentPagePath || '';
        if (typeof CommentBadges !== 'undefined' && typeof CommentBadges.openPanelForFileComments === 'function') {
          CommentBadges.openPanelForFileComments(filePath);
        }
      } },
      { type: 'sep' },
    );
  }

  // テーブルセル右クリック時の行列操作
  // リファクタで editable コンテナ委譲となったため、editable 内の table に限定される。
  // 旧セレクタで拾えていなかった #dp-editable 内 table もここで拾えるようになる（4-7 修正）。
  const _ctxCell = e.target.closest('td, th');
  const _ctxTable = _ctxCell ? _ctxCell.closest('table') : null;
  if (_ctxCell && _ctxTable) {
    const pushTableUndo = () => {
      if (typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
    };
    const dispatchTableInput = () => editable.dispatchEvent(new Event('input', { bubbles: true }));
    items.push(
      { type: 'sep' },
      { label: '上に行を追加', enabled: true, action: () => {
        pushTableUndo();
        const row = _ctxCell.parentElement;
        const newRow = row.cloneNode(true);
        newRow.querySelectorAll('td, th').forEach(c => c.textContent = '');
        row.before(newRow);
        dispatchTableInput();
      }},
      { label: '下に行を追加', enabled: true, action: () => {
        pushTableUndo();
        const row = _ctxCell.parentElement;
        const newRow = row.cloneNode(true);
        newRow.querySelectorAll('td, th').forEach(c => c.textContent = '');
        row.after(newRow);
        dispatchTableInput();
      }},
      { label: '行を削除', enabled: true, action: async () => {
        if (!(await confirmNoteTableDelete('この行を削除しますか？'))) return;
        pushTableUndo();
        _ctxCell.parentElement.remove();
        dispatchTableInput();
      }},
      { label: '列を削除', enabled: true, action: async () => {
        if (!(await confirmNoteTableDelete('この列を削除しますか？'))) return;
        pushTableUndo();
        const colIndex = [..._ctxCell.parentElement.children].indexOf(_ctxCell);
        _ctxTable.querySelectorAll('tr').forEach(row => {
          if (row.children[colIndex]) row.children[colIndex].remove();
        });
        dispatchTableInput();
      }}
    );
  }

  let menuPointerCloser = null;
  let menuKeyCloser = null;
  const closeNoteContextMenu = (restoreFocus = false) => {
    if (menu.isConnected) menu.remove();
    if (menuPointerCloser) document.removeEventListener('pointerdown', menuPointerCloser, true);
    if (menuKeyCloser) document.removeEventListener('keydown', menuKeyCloser, true);
    menuPointerCloser = null;
    menuKeyCloser = null;
    // 工程9: 「行種変更」サブメニューを開いたまま外側の項目クリックやEscapeで
    // 親メニューだけが閉じると、サブメニューが孤立表示のまま残る。閉じる経路を
    // 問わず必ず一緒に畳む(ARIA aria-expanded/対象行ハイライトも合わせて解除)。
    if (typeof MeldexNoteBlockMenu !== 'undefined' && MeldexNoteBlockMenu.isOpen()) MeldexNoteBlockMenu.close();
    if (typeof MeldexNoteBlockContextMenu !== 'undefined') MeldexNoteBlockContextMenu.clearHighlight();
    if (restoreFocus && editable.isConnected) editable.focus();
  };

  items.forEach(item => {
    if (item.type === 'sep') { menu.appendChild(_editorMenuSeparator()); return; }
    if (item.type === 'format') {
      // 「書式…」: クリックで統一書式ポップアップを開く
      const el = _editorMenuButton(item.label, item.enabled && typeof openFormatPopup === 'function', () => {
        if (!item.enabled || typeof openFormatPopup !== 'function') {
          closeNoteContextMenu(true);
          return;
        }
        // メニューを閉じる前にアンカー位置を取得（閉じると el が DOM から消えて rect=(0,0,0,0) になる）
        const anchorRect = el.getBoundingClientRect();
        const virtualAnchor = { getBoundingClientRect: () => anchorRect };
        closeNoteContextMenu(false);
        // 選択を復元しないと queryCommandState / queryCommandValue が誤った結果を返す
        editable.focus();
        if (savedRange) {
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(savedRange.cloneRange());
        }
        const curColor = document.queryCommandValue('foreColor') || '';
        const values = {
          textColor: curColor,
          fontWeight: document.queryCommandState('bold') ? 'bold' : '',
          fontStyle: document.queryCommandState('italic') ? 'italic' : '',
          underline: document.queryCommandState('underline'),
          strike: document.queryCommandState('strikeThrough'),
        };
        openFormatPopup(virtualAnchor, {
          values,
          fields: ['textColor', 'bold', 'italic', 'underline', 'strike'],
          onChange: (prop, value) => {
            // 各変更前に選択を復元し、execCommand を実行
            // bold/italic/underline/strike はトグル系なので value の真偽に関係なく
            // execCommand を実行すれば UI のアクティブ状態と DOM が一致する
            if (prop === 'fontWeight') applyFormat('bold');
            else if (prop === 'fontStyle') applyFormat('italic');
            else if (prop === 'underline') applyFormat('underline');
            else if (prop === 'strike') applyFormat('strikeThrough');
            else if (prop === 'textColor') {
              const c = value || getComputedStyle(editable).color;
              applyFormat('foreColor', c);
            }
          },
        });
      });
      menu.appendChild(el);
      return;
    }
    if (item.type === 'blockType') {
      // 工程9: ホバー/矢印右で開く共通行種メニュー(gb-note-block-menu.js)への
      // サブメニュートリガー。構築・開閉・対象行ハイライトは共有ヘルパーへ委譲する
      // (gb-note-block-context-menu.js。ハンドルクリックメニュー側の見出しリンク
      // コピー統合と同じ対象行解決・ハイライトクラスを再利用するため)。
      const el = (typeof MeldexNoteBlockContextMenu !== 'undefined')
        ? MeldexNoteBlockContextMenu.buildBlockTypeMenuTrigger({
            editable,
            blockInfo: item.blockInfo,
            onAfterAction: () => closeNoteContextMenu(false),
          })
        : _editorMenuButton('行種変更', false, () => {});
      menu.appendChild(el);
      return;
    }
    const el = _editorMenuButton(item.label, item.enabled, () => { closeNoteContextMenu(false); item.action(); });
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  _positionEditorPopup(menu, _editorEventAnchorRect(e, editable));
  setTimeout(() => {
    menuPointerCloser = (ev) => {
      if (menu.contains(ev.target)) return;
      // 修正2: 「行種変更」サブメニュー(gb-note-block-menu.js の #note-block-menu)は
      // このメニューの子ではなく document.body 直下の別要素として開く。
      // pointerdown を素朴に「外側クリック」判定すると、サブメニュー項目を
      // クリックした瞬間にこの outside-click ハンドラが先に発火し、
      // MeldexNoteBlockMenu.close() でサブメニューを閉じてしまい、直後の click
      // イベントが選択項目に届かなくなる（行種変更が「全く機能しない」原因）。
      // サブメニュー内のクリックは外側クリック扱いにしない。
      const blockMenuEl = document.getElementById('note-block-menu');
      if (blockMenuEl && blockMenuEl.contains(ev.target)) return;
      closeNoteContextMenu(true);
    };
    menuKeyCloser = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeNoteContextMenu(true);
      }
    };
    document.addEventListener('pointerdown', menuPointerCloser, true);
    document.addEventListener('keydown', menuKeyCloser, true);
  }, 0);
}

// editable コンテナ（#page-content / #entity-freetext / #dp-editable）にノート編集メニューを付ける
function bindNoteEditorContextMenu(el) {
  if (!el || el._noteCtxMenuAttached) return;
  el._noteCtxMenuAttached = true;
  el.addEventListener('contextmenu', _noteCtxMenuHandler);
  // タッチ/ペンの長押しでも同じハンドラを発火
  if (typeof addLongPressHandler === 'function') addLongPressHandler(el, _noteCtxMenuHandler);
}

// 静的要素に初期バインド（#dp-editable は gb-detail-panel.part02.js の _dpBindAutoSave で動的バインド）
bindNoteEditorContextMenu(document.getElementById('page-content'));
bindNoteEditorContextMenu(document.getElementById('entity-freetext'));

// ============================================================
// テーブルミニツールバー（タッチ対応）
// ============================================================
function _tableMiniToolbarZoom() {
  return (typeof _getZoom === 'function' ? _getZoom() : 1) || 1;
}

function _positionTableMiniToolbar(tableEl, toolbar) {
  if (!tableEl?.isConnected || !toolbar?.isConnected) return;
  const rect = tableEl.getBoundingClientRect();
  const z = _tableMiniToolbarZoom();
  const width = toolbar.offsetWidth || 180;
  const height = toolbar.offsetHeight || 28;
  toolbar.style.left = ((rect.left + (rect.width - width) / 2) / z) + 'px';
  toolbar.style.top = ((rect.top - height / 2) / z) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(toolbar);
}

