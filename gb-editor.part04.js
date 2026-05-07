    else { ta.rows = 1; ta.classList.remove('multiline'); }
  }

  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeFileSearch(); e.preventDefault(); return; }
    // Enter（Shift なし）: 次の検索結果へジャンプ。Shift+Enter: 改行入力
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doFileSearch(1); return; }
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
  return state.view === 'entity'
    ? document.getElementById('entity-freetext')
    : document.getElementById('page-content');
}

function doFileSearch(direction) {
  const q = document.getElementById('fsb-query').value;
  if (!q) return;

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
  if (!editable) return;

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
function _pageTitleRubyHandler(e) {
  const editable = e.target.closest('[contenteditable="true"]');
  if (!editable) return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
  // 念のため: 万一ノート編集 editable に届いた場合はノートメニューに任せる
  if (editable.id === 'entity-freetext' || editable.id === 'page-content' || editable.id === 'dp-editable') return;

  e.preventDefault();
  const selectedText = sel.toString().trim();

  // 既存のルビメニューを閉じる
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());

  // 選択範囲を保存
  const savedRange = sel.getRangeAt(0).cloneRange();
  const savedEditable = editable;

  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.style.cssText = `position:fixed;z-index:200;left:${e.clientX}px;top:${e.clientY}px;background:var(--ui-popup-bg, var(--bg2));border:1px solid var(--border);border-radius:4px;padding:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5);font-size:13px;`;
  // mousedownでフォーカスを奪わない
  menu.addEventListener('mousedown', (ev) => ev.preventDefault());
  menu.innerHTML = `
    <div style="margin-bottom:4px;color:var(--fg2);font-size:12px;">「${esc(selectedText.slice(0, 20))}」にルビを設定</div>
    <div style="display:flex;gap:4px;">
      <input type="text" id="ruby-input" placeholder="ルビを入力..." style="flex:1;padding:3px 6px;font-size:13px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;outline:none;">
      <button class="primary" style="padding:3px 8px;font-size:13px;" id="ruby-apply-btn">設定</button>
    </div>`;
  document.body.appendChild(menu);

  { const rect = menu.getBoundingClientRect(); const z = _getZoom();
  if (rect.right > window.innerWidth) menu.style.left = ((window.innerWidth - rect.width - 8) / z) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - rect.height - 8) / z) + 'px'; }

  const input = document.getElementById('ruby-input');
  // blurで再描画されないよう一時的に無効化
  const origBlur = savedEditable.onblur;
  savedEditable.onblur = null;
  input.focus();
  // メニューが閉じたらblurを復元
  const restoreBlur = () => { savedEditable.onblur = origBlur; };
  window._rubyRestoreBlur = restoreBlur;

  function doApply() {
    const ruby = input.value.trim();
    menu.remove();
    if (window._rubyRestoreBlur) { window._rubyRestoreBlur(); window._rubyRestoreBlur = null; }
    if (!ruby) return;

    const path = savedEditable.dataset?.path || savedEditable.dataset?.entityPath;
    const ep = savedEditable.dataset.entityPath || '';
    const isNewFormatFreetext = savedEditable.id === 'entity-freetext' && ep.endsWith('.md');
    const savePath = savedEditable.id === 'entity-freetext'
      ? (isNewFormatFreetext ? ep : ep + '/_freetext.md')
      : (path || '');
    if (!savePath) return;

    // --- ルビ適用 ---
    // 自動保存タイマーをキャンセル（normalize()でRangeが無効化されるのを防止）
    clearTimeout(window._noteAutoSaveTimer);

    savedEditable.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);

    // カスタムアンドゥ用にスナップショットを保存
    _pushCustomUndo(savedEditable);

    // 既存のルビspan全体を選択している場合はルビ値を上書き
    const existingRuby = savedRange.startContainer.parentElement?.closest('[data-ruby]');
    if (existingRuby && savedRange.toString().trim() === existingRuby.textContent.trim()) {
      existingRuby.dataset.ruby = ruby;
    } else {
      // 選択範囲をruby spanで囲む（DOM直接操作）
      const span = document.createElement('span');
      span.dataset.ruby = ruby;
      span.style.position = 'relative';
      try {
        savedRange.surroundContents(span);
      } catch (e) {
        const fragment = savedRange.extractContents();
        span.appendChild(fragment);
        savedRange.insertNode(span);
      }
    }

    // ペンディング中の自動保存をキャンセルし、即時保存
    clearTimeout(window._noteAutoSaveTimer);
    savedEditable.querySelectorAll('mark.file-search-highlight').forEach(m => m.replaceWith(...m.childNodes));
    savedEditable.normalize();
    let md = htmlToMd(savedEditable.innerHTML);
    if (!md.trim()) return;
    const fm = savedEditable.dataset.frontmatter || '';
    if (fm) md = fm + md;

    const savePromise = isNewFormatFreetext
      ? apiPut('/value?path=' + encodeURIComponent(savePath), { new_body: md })
      : apiPut('/file?path=' + encodeURIComponent(savePath), { content: md });
    savePromise.then(() => {
      // 保存後にDOM再描画（auto-link再適用のため）
      const bodyMd = md.replace(/^---\n[\s\S]*?\n---\n?/, '');
      const reHtml = mdToHtml(bodyMd);
      savedEditable.innerHTML = applyAutoLinks(reHtml, savePath);
      // ルビを設定したテキストの直後にカーソルを配置
      savedEditable.focus();
      const rubySpans = savedEditable.querySelectorAll('[data-ruby]');
      for (const span of rubySpans) {
        if (span.textContent.includes(selectedText)) {
          const s = window.getSelection();
          const r = document.createRange();
          r.setStartAfter(span);
          r.collapse(true);
          s.removeAllRanges();
          s.addRange(r);
          span.scrollIntoView({ block: 'center' });
          break;
        }
      }
      showStatus('ルビを設定しました');
    }).catch(() => {});
  }

  document.getElementById('ruby-apply-btn').addEventListener('click', doApply);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); doApply(); }
    if (ev.key === 'Escape') { menu.remove(); if (window._rubyRestoreBlur) { window._rubyRestoreBlur(); window._rubyRestoreBlur = null; } }
  });

  setTimeout(() => document.addEventListener('pointerdown', function closer(ev) {
    if (!menu.contains(ev.target)) {
      menu.remove();
      if (window._rubyRestoreBlur) { window._rubyRestoreBlur(); window._rubyRestoreBlur = null; }
      document.removeEventListener('pointerdown', closer);
    }
  }), 0);
}

{
  const _pageTitleEl = document.getElementById('page-title');
  if (_pageTitleEl) {
    _pageTitleEl.addEventListener('contextmenu', _pageTitleRubyHandler);
    if (typeof addLongPressHandler === 'function') addLongPressHandler(_pageTitleEl, _pageTitleRubyHandler);
  }
}

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
    if (nd && lbl && nd.type !== 'entity' && !(nd.path && isItemLocked(nd.path))) startTreeLabelEdit(lbl, nd);
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
    const items = [...treeSelection.items].map(n => n._nodeData).filter(d => d && !(d.path && isItemLocked(d.path)));
    if (items.length === 0) return;
    if (!await cfConfirm(items.length + ' 件を削除しますか？')) return;
    deleteOutlinerItemsWithHistory(items, {
      label: items.length + ' 件を削除',
      onItemDeleted: (item) => {
        if (typeof _removeOutlinerNodesForPaths === 'function') _removeOutlinerNodesForPaths([item.path]);
      },
      refresh: async () => {
        if (typeof loadOutliner === 'function') await loadOutliner();
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
    if (document.getElementById('file-search-bar').classList.contains('open')) { closeFileSearch(); e.preventDefault(); return; }
    if (document.getElementById('search-panel').classList.contains('open')) { closeSearchPanel(); e.preventDefault(); return; }
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

function moveBlock(direction) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.anchorNode;
  while (node && node.nodeType === 3) node = node.parentNode;
  const editable = document.activeElement;
  if (!node || node === editable) return;
  const beforeHtml = editable.innerHTML;
  let undoPushed = false;
  const pushCustomUndo = () => {
    if (undoPushed || typeof _pushCustomUndo !== 'function') return;
    _pushCustomUndo(editable);
    undoPushed = true;
  };

  const markerId = '_mv_' + Date.now();
  const li = node.closest ? node.closest('li') : null;

  if (li && editable.contains(li)) {
    const sibling = direction === 'up' ? li.previousElementSibling : li.nextElementSibling;
    if (sibling) {
      // 同一リスト内のLI入れ替え
      pushCustomUndo();
      _swapAdjacent(li, sibling, direction, sel, markerId);
    } else {
      // リスト境界: この1項目だけを抽出して移動
      _moveLiAcrossBoundary(li, direction, editable, sel, markerId, pushCustomUndo);
    }
  } else {
    // リスト外ブロック
    while (node && node !== editable && node.parentNode !== editable) node = node.parentNode;
    if (!node || node === editable) return;
    const sibling = direction === 'up' ? node.previousElementSibling : node.nextElementSibling;
    if (!sibling) return;

    // 隣接要素がリスト(UL/OL)またはリストを含む要素なら、そのリストにLIとして合流
    let targetList = null;
    if (sibling.tagName === 'UL' || sibling.tagName === 'OL') {
      targetList = sibling;
    } else {
      targetList = sibling.querySelector('ul, ol');
    }
    if (targetList) {
      pushCustomUndo();
      const newLi = document.createElement('li');
      newLi.innerHTML = node.innerHTML;
      newLi.setAttribute('data-mv', markerId);
      if (direction === 'down') {
        targetList.insertBefore(newLi, targetList.firstElementChild);
      } else {
        targetList.appendChild(newLi);
      }
      node.remove();
    } else {
      pushCustomUndo();
      _swapAdjacent(node, sibling, direction, sel, markerId);
    }
  }

  // カーソルを移動先の要素に配置
  const moved = editable.querySelector('[data-mv="' + markerId + '"]');
  if (moved) {
    moved.removeAttribute('data-mv');
    const r = document.createRange();
    r.selectNodeContents(moved);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    moved.scrollIntoView({ block: 'nearest' });
  }
  if (editable.innerHTML !== beforeHtml) {
    editable.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// 隣接する2要素を入れ替え（DOM直接操作、カスタムアンドゥで対応）
function _swapAdjacent(target, sibling, direction, sel, markerId) {
  target.setAttribute('data-mv', markerId);
  if (direction === 'up') {
    target.parentNode.insertBefore(target, sibling);
  } else {
    target.parentNode.insertBefore(sibling, target);
  }
}

// リスト境界でLIを1項目だけ移動（同じ階層を維持する）
function _moveLiAcrossBoundary(li, direction, editable, sel, markerId, beforeMutate) {
  const parentList = li.parentNode; // UL or OL
  const listTag = parentList.tagName; // 'UL' or 'OL'

  // 親リストを含む最も近いブロック要素（editable直下まで辿る）
  let listBlock = parentList;
  while (listBlock.parentNode !== editable) listBlock = listBlock.parentNode;

  // listBlockの隣接要素を取得
  const adjacent = direction === 'up'
    ? listBlock.previousElementSibling
    : listBlock.nextElementSibling;
  if (!adjacent) return;

  // ケース1: 隣接要素の中に同タイプのリストがあれば合流
  // （隣がリストそのもの、または隣の内部にリストがある場合）
  let targetList = null;
  if (adjacent.tagName === listTag) {
    targetList = adjacent;
  } else {
    // 隣の要素内（LI, DIV等）から同タイプのリストを探す
    targetList = adjacent.querySelector(listTag.toLowerCase());
  }
  if (targetList) {
    beforeMutate?.();
    li.setAttribute('data-mv', markerId);
    parentList.removeChild(li);
    if (direction === 'up') {
      targetList.appendChild(li);
    } else {
      targetList.insertBefore(li, targetList.firstElementChild);
    }
    if (parentList.children.length === 0) {
      // 空リストを削除。親が空のDIV等なら一緒に削除
      const p = parentList.parentNode;
      parentList.remove();
      if (p !== editable && p.children.length === 0 && !p.textContent.trim()) p.remove();
    }
    return;
  }

  // ケース2: 隣にリストがない → LIをdivとして抽出
  const div = document.createElement('div');
  div.innerHTML = li.innerHTML;
  div.setAttribute('data-mv', markerId);
  beforeMutate?.();
  parentList.removeChild(li);
  if (direction === 'up') {
    editable.insertBefore(div, listBlock);
  } else {
    listBlock.nextSibling
      ? editable.insertBefore(div, listBlock.nextSibling)
      : editable.appendChild(div);
  }
  if (parentList.children.length === 0) {
    const p = parentList.parentNode;
    parentList.remove();
    if (p !== editable && p.children.length === 0 && !p.textContent.trim()) p.remove();
  }
}

// ノートエディタ用ルビ入力ポップアップ。
// シナリオエディタの sn2-header-popup と同パターン（positionPopup + 範囲基準）。
function showNoteRubyPopup(editable, range) {
  if (!editable || !range) return;
  document.querySelectorAll('.note-ruby-popup').forEach(el => el.remove());
  const text = range.toString();
  if (!text) return;
  const popup = document.createElement('div');
  popup.className = 'gb-context-menu note-ruby-popup';
  popup.style.cssText = 'position:fixed;z-index:10000;min-width:240px;padding:8px 12px;';
  popup.innerHTML = `
    <div style="font-size:12px;margin-bottom:6px;">「${esc(text.slice(0, 20))}」にルビを設定</div>
    <div style="display:flex;gap:4px;">
      <input type="text" class="note-ruby-input" placeholder="ルビを入力..." style="flex:1;padding:3px 6px;font-size:13px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;outline:none;">
      <button type="button" class="primary note-ruby-ok" style="padding:3px 8px;font-size:12px;">設定</button>
    </div>`;
  popup.addEventListener('mousedown', ev => { if (ev.target.tagName !== 'INPUT') ev.preventDefault(); });
  document.body.appendChild(popup);
  positionPopup(popup, range.getBoundingClientRect());
  const input = popup.querySelector('.note-ruby-input');
  const apply = () => {
    const ruby = input.value.trim();
    popup.remove();
    document.removeEventListener('pointerdown', closeHandler, true);
    if (!ruby) return;
    editable.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    _pushCustomUndo(editable);
    const span = document.createElement('span');
    span.dataset.ruby = ruby;
    span.style.position = 'relative';
    span.textContent = text;
    range.deleteContents();
    range.insertNode(span);
    const r2 = document.createRange();
    r2.setStartAfter(span);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
    editable.dispatchEvent(new Event('input'));
    showStatus('ルビを設定しました');
  };
  popup.querySelector('.note-ruby-ok').addEventListener('click', apply);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); apply(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); popup.remove(); document.removeEventListener('pointerdown', closeHandler, true); editable.focus(); }
    ev.stopPropagation();
  });
  function closeHandler(ev) {
    if (!popup.contains(ev.target)) { popup.remove(); document.removeEventListener('pointerdown', closeHandler, true); }
  }
  setTimeout(() => { document.addEventListener('pointerdown', closeHandler, true); input.focus(); }, 0);
}

// ノート/自由記述の右クリックメニュー
// 旧: document 委譲 → editable コンテナ個別登録へ移行（global-contextmenu-refactor-plan.md）
function _noteCtxMenuHandler(e) {
  const editable = e.currentTarget;
  if (!editable || editable.contentEditable !== 'true') return;
  e.preventDefault();
  closeColHeaderMenu();
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());

  const sel = window.getSelection();
  const hasSelection = sel && !sel.isCollapsed;
  const savedRange = hasSelection && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
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
  // mousedownで選択が消えないようにpreventDefault
  menu.addEventListener('mousedown', (ev) => { if (ev.target.tagName !== 'INPUT') ev.preventDefault(); });

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
    { type: 'format', label: '書式…', enabled: hasSelection },
    { type: 'sep' },
    { label: 'ルビを設定...', enabled: hasSelection, action: () => {
      if (!savedRange) return;
      showNoteRubyPopup(editable, savedRange);
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
      { label: '行を削除', enabled: true, action: () => {
        pushTableUndo();
        _ctxCell.parentElement.remove();
        dispatchTableInput();
      }},
      { label: '列を削除', enabled: true, action: () => {
        pushTableUndo();
        const colIndex = [..._ctxCell.parentElement.children].indexOf(_ctxCell);
        _ctxTable.querySelectorAll('tr').forEach(row => {
          if (row.children[colIndex]) row.children[colIndex].remove();
        });
        dispatchTableInput();
      }}
    );
  }

  items.forEach(item => {
    if (item.type === 'sep') { const s = document.createElement('div'); s.className = 'gb-context-menu-sep'; menu.appendChild(s); return; }
    if (item.type === 'format') {
      // 「書式…」: クリックで統一書式ポップアップを開く
      const el = document.createElement('div');
      el.className = 'gb-context-menu-item';
      el.textContent = item.label;
      if (!item.enabled || typeof openFormatPopup !== 'function') el.classList.add('disabled');
      el.addEventListener('click', () => {
        if (!item.enabled || typeof openFormatPopup !== 'function') {
          closeColHeaderMenu();
          return;
        }
        // メニューを閉じる前にアンカー位置を取得（閉じると el が DOM から消えて rect=(0,0,0,0) になる）
        const anchorRect = el.getBoundingClientRect();
        const virtualAnchor = { getBoundingClientRect: () => anchorRect };
        closeColHeaderMenu();
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
    const el = document.createElement('div');
    el.className = 'gb-context-menu-item';
    el.textContent = item.label;
    if (!item.enabled) el.classList.add('disabled');
    el.addEventListener('click', () => { closeColHeaderMenu(); item.action(); });
    menu.appendChild(el);
  });

  { const z = _getZoom(); menu.style.left = (e.clientX / z) + 'px'; menu.style.top = (e.clientY / z) + 'px'; }
  document.body.appendChild(menu);
  { const rect = menu.getBoundingClientRect(); const z = _getZoom();
  if (rect.right > window.innerWidth) menu.style.left = ((window.innerWidth - rect.width - 4) / z) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - rect.height - 4) / z) + 'px'; }
  setTimeout(() => {
    const closer = (ev) => { if (!menu.contains(ev.target)) { closeColHeaderMenu(); document.removeEventListener('pointerdown', closer); } };
    document.addEventListener('pointerdown', closer);
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

function _closeTableMiniToolbar(toolbar) {
  if (!toolbar) return;
  if (typeof toolbar._cleanup === 'function') toolbar._cleanup();
  toolbar.remove();
}

function _showTableToolbar(tableEl, editable) {
  document.querySelectorAll('.table-mini-toolbar').forEach(existing => {
    if (existing._tableElement !== tableEl) _closeTableMiniToolbar(existing);
  });
  if (tableEl._tableMiniToolbar?.isConnected) {
    _positionTableMiniToolbar(tableEl, tableEl._tableMiniToolbar);
    return;
  }
  const toolbar = document.createElement('div');
  toolbar.className = 'table-mini-toolbar';
  toolbar.contentEditable = 'false';
  toolbar._tableElement = tableEl;
  toolbar.addEventListener('mousedown', (e) => e.preventDefault());
  function _getCurrentCell() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    return sel.anchorNode?.nodeType === 1
      ? sel.anchorNode.closest('td, th')
      : sel.anchorNode?.parentElement?.closest('td, th');
  }
  const pushTableUndo = () => {
    if (editable && typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
  };
  const dispatchTableInput = () => editable.dispatchEvent(new Event('input', { bubbles: true }));
  [
    { label: '↑行', action: () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      pushTableUndo();
      const row = cell.parentElement;
      const nr = row.cloneNode(true);
      nr.querySelectorAll('td,th').forEach(c => c.textContent = '');
      row.before(nr);
      dispatchTableInput();
    }},
    { label: '↓行', action: () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      pushTableUndo();
      const row = cell.parentElement;
      const nr = row.cloneNode(true);
      nr.querySelectorAll('td,th').forEach(c => c.textContent = '');
      row.after(nr);
      dispatchTableInput();
    }},
    { label: '行削除', action: () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      pushTableUndo();
      cell.parentElement.remove();
      dispatchTableInput();
    }},
    { label: '列削除', action: () => {
      const cell = _getCurrentCell();
      if (!cell) return;
      pushTableUndo();
      const ci = [...cell.parentElement.children].indexOf(cell);
      tableEl.querySelectorAll('tr').forEach(r => { if (r.children[ci]) r.children[ci].remove(); });
      dispatchTableInput();
    }},
  ].forEach(({label, action}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'table-mini-toolbar-btn';
    btn.textContent = label;
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); action(); });
    toolbar.appendChild(btn);
  });
  document.body.appendChild(toolbar);
  _positionTableMiniToolbar(tableEl, toolbar);
  tableEl._tableMiniToolbar = toolbar;
  const reposition = () => {
    if (!tableEl.isConnected) {
      _closeTableMiniToolbar(toolbar);
      return;
    }
    _positionTableMiniToolbar(tableEl, toolbar);
  };
  const _remove = (e) => {
    if (!tableEl.contains(e.target) && !toolbar.contains(e.target)) _closeTableMiniToolbar(toolbar);
  };
  toolbar._cleanup = () => {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    document.removeEventListener('click', _remove);
    if (tableEl._tableMiniToolbar === toolbar) tableEl._tableMiniToolbar = null;
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  setTimeout(() => document.addEventListener('click', _remove), 0);
}

// テーブルセルクリック/タップでミニツールバー表示
document.addEventListener('click', (e) => {
  const td = e.target.closest('#page-content table td, #page-content table th, #entity-freetext table td, #entity-freetext table th, #dp-editable table td, #dp-editable table th, #board-note-editable table td, #board-note-editable table th');
  if (!td) return;
  if (typeof window.showNoteTableCellControls === 'function') {
    window.showNoteTableCellControls(td);
    return;
  }
  const table = td.closest('table');
  const editable = td.closest('[contenteditable="true"]');
  if (table && editable) _showTableToolbar(table, editable);
});
