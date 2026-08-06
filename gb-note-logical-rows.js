/* ==============================
   gb-note-logical-rows.js — ノートの論理行resolver
   計画書: app/docs/note-row-format-popup-chat-selection-regression-plan-2026-08-04.md
           §2.1（論理行と階層横断移動） §2.3（全行種のハンドルとハイライト）

   本文・見出し・各リスト項目・コールアウト・引用・コード・表・区切り線を
   「表示順の論理行」として列挙し、Ctrl+↑/↓（gb-note-block-reorder.js の
   moveBlock）・ドラッグ（同ファイルのハンドル）・行ハンドル／右クリック
   ハイライト（gb-note-block-context-menu.js）が共通で使う正本。
   見出し用 section.heading-section とリストコンテナ（UL/OL）自体は
   「行」に数えない（見出しは中の見出し要素そのものが行、リストは各 LI が行）。

   階層横断移動（§2.1）は次の優先順位で1段階ずつ配置する。
     1. 同一リスト内の隣接 LI → 前後入れ替え
     2. 入れ子リストの端 → 親 LI と同じ階層へ一段だけ昇格
     3. ルート直下のリスト境界 → 隣接する同種リスト(UL/UL・OL/OL)へ合流
     4. 通常行との境界 → 旧実装どおり LI ⇔ 通常行を相互変換して越える
   見出しインデント表示（section.heading-section）がONの場合、操作の前後で
   対象ホスト全体を一時的にアンラップ／再ラップし（既存の
   wrapHeadingSections/unwrapHeadingSections を再利用）、上記の配置判定を
   セクション構造に煩わされないフラットなDOM上で行う。これにより見出し境界の
   前後移動も他の行種と同じ規則で扱える。

   本ファイルは「DOM上の配置」だけに責務を限定する。Undo・キャレット保持・
   dirty化・保存予約・TOC更新は呼び出し元（gb-note-block-reorder.js）が担当する
   （生ノードを移動するだけで複製しないため、既存の captureCaretRefs/
   restoreCaretRefs がそのまま有効という前提を崩さない）。

   公開API: window.MeldexNoteLogicalRows
   ============================== */
(function (global) {
  'use strict';

  const HEADING_RE = /^H[1-6]$/;
  const LIST_TAG_RE = /^(UL|OL)$/;

  // ============================================================
  // 0. 見出しセクション（表示用ラッパー）判定・一時アンラップ
  // ============================================================
  function isHeadingSectionWrapper(el) {
    return !!(el && el.nodeType === 1 && el.tagName === 'SECTION' && el.classList && el.classList.contains('heading-section'));
  }

  function _isHeadingIndentOn() {
    if (typeof localStorage === 'undefined') return false;
    const v = localStorage.getItem('note-heading-indent');
    return v === null || v === '1';
  }

  // 見出しインデント表示は #page-content のみが対象（既存仕様のまま）。
  function _sectionsActive(editable) {
    return !!(editable && editable.id === 'page-content' && _isHeadingIndentOn());
  }

  function _unwrapForOp(editable) {
    if (!_sectionsActive(editable)) return false;
    if (typeof global.unwrapHeadingSections !== 'function') return false;
    if (!editable.querySelector('section.heading-section')) return false;
    global.unwrapHeadingSections(editable);
    return true;
  }

  function _rewrapAfterOp(editable, wasWrapped) {
    if (!wasWrapped) return;
    if (typeof global.wrapHeadingSections === 'function') global.wrapHeadingSections(editable);
  }

  // ============================================================
  // 1. 行の種類判定
  // ============================================================
  function rowKind(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName;
    if (tag === 'LI') {
      if (el.classList && el.classList.contains('note-checklist-item')) return 'checklist';
      return el.parentElement && el.parentElement.tagName === 'OL' ? 'ol' : 'ul';
    }
    if (tag === 'HR') return 'hr';
    if (HEADING_RE.test(tag)) return 'heading';
    if (el.classList && el.classList.contains('callout-block')) return 'callout';
    if (tag === 'BLOCKQUOTE') return 'quote';
    if (tag === 'PRE') return 'code';
    if (tag === 'TABLE') return 'table';
    if (tag === 'DIV' || tag === 'P') return 'body';
    return null;
  }

  function isRowElement(el) {
    return !!rowKind(el);
  }

  // ============================================================
  // 2. 論理行の列挙（doc順、見出しsection透過、リストはLI単位に展開）
  // ============================================================
  function _expandListItems(listEl, out) {
    Array.from(listEl.children).forEach((li) => {
      if (li.tagName !== 'LI') return;
      out.push(li);
      Array.from(li.children).forEach((c) => {
        if (LIST_TAG_RE.test(c.tagName)) _expandListItems(c, out);
      });
    });
  }

  function listRows(editable) {
    const out = [];
    function walk(container) {
      Array.from(container.children || []).forEach((child) => {
        if (child.tagName === 'BR') return;
        if (isHeadingSectionWrapper(child)) { walk(child); return; }
        if (LIST_TAG_RE.test(child.tagName)) { _expandListItems(child, out); return; }
        out.push(child);
      });
    }
    if (editable) walk(editable);
    return out;
  }

  // ============================================================
  // 3. ヒットテスト（ハンドル・ハイライト用）
  // ============================================================
  // §2.3: 深いリストでは、子リストを除いた項目自身の矩形を算出する。
  function rowOwnRect(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const full = el.getBoundingClientRect();
    if (el.tagName !== 'LI') return full;
    const nestedList = Array.from(el.children).find((c) => LIST_TAG_RE.test(c.tagName));
    if (!nestedList) return full;
    const nestedRect = nestedList.getBoundingClientRect();
    const bottom = Math.max(full.top, Math.min(full.bottom, nestedRect.top));
    return {
      top: full.top, left: full.left, right: full.right, bottom,
      width: full.width, height: Math.max(0, bottom - full.top),
    };
  }

  // ノードから直接の対象行を解決する（クリック・右クリック・ホバー用）。
  // §2.3: 未対応だった HR をここへ追加する。
  function resolveRowAt(editable, node) {
    let el = node;
    while (el && el !== editable) {
      if (el.nodeType === 1) {
        const kind = rowKind(el);
        if (kind === 'hr' || el.tagName === 'LI' || kind === 'callout' || kind === 'quote' || kind === 'code' || kind === 'table' || kind === 'heading') {
          return el;
        }
        if (kind === 'body') {
          const parent = el.parentElement;
          const isTopLevel = parent === editable || isHeadingSectionWrapper(parent);
          if (isTopLevel) return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  // Y座標（clientY）から対象行を解決する（ガター／余白ホバー用）。
  // ownRect を使うため、深いリストでも重ならず最深行が自然に選ばれる。
  function rowAtPoint(editable, clientY, excludeEl) {
    const rows = listRows(editable);
    for (const el of rows) {
      if (excludeEl && (el === excludeEl || excludeEl.contains(el))) continue;
      const r = rowOwnRect(el);
      if (!r) continue;
      const bottom = Math.max(r.bottom, r.top + 1);
      if (clientY >= r.top && clientY < bottom) return el;
    }
    return null;
  }

  // ============================================================
  // 4. 行ハイライトオーバーレイ（§2.3: CSSアウトラインではなく矩形オーバーレイ）
  // ============================================================
  let _highlightEl = null;
  let _highlightTarget = null;

  function _ensureHighlightEl() {
    if (_highlightEl && _highlightEl.isConnected) return _highlightEl;
    const el = document.createElement('div');
    el.id = 'note-logical-row-highlight';
    el.className = 'note-logical-row-highlight';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    _highlightEl = el;
    return el;
  }

  function showRowHighlight(rowEl) {
    if (!rowEl || !rowEl.isConnected) { hideRowHighlight(); return; }
    const rect = rowOwnRect(rowEl);
    if (!rect || (!rect.width && !rect.height)) { hideRowHighlight(); return; }
    const el = _ensureHighlightEl();
    const z = (typeof global._getZoom === 'function') ? global._getZoom() : 1;
    el.style.top = (rect.top / z) + 'px';
    el.style.left = (rect.left / z) + 'px';
    el.style.width = (rect.width / z) + 'px';
    el.style.height = (rect.height / z) + 'px';
    el.classList.add('is-visible');
    _highlightTarget = rowEl;
  }

  function refreshRowHighlight() {
    if (_highlightTarget) showRowHighlight(_highlightTarget);
  }

  function hideRowHighlight() {
    if (_highlightEl) _highlightEl.classList.remove('is-visible');
    _highlightTarget = null;
  }

  // ============================================================
  // 5. 循環チェック・空リスト掃除・低レベル挿入
  // ============================================================
  function wouldCreateCycle(a, b) {
    return !!(a && b && (a === b || (a.contains && a.contains(b)) || (b.contains && b.contains(a))));
  }

  function _cleanupEmptyList(listEl) {
    if (!listEl || !listEl.isConnected) return;
    const hasLi = Array.from(listEl.children).some((c) => c.tagName === 'LI');
    if (!hasLi) listEl.remove();
  }

  function _insertRelative(el, ref, before) {
    if (before) ref.before(el); else ref.after(el);
  }

  function _meaningfulSibling(el, direction) {
    let sib = direction === 'up' ? el.previousElementSibling : el.nextElementSibling;
    while (sib && sib.tagName === 'BR') sib = direction === 'up' ? sib.previousElementSibling : sib.nextElementSibling;
    return sib || null;
  }

  // ============================================================
  // 6. 1段階配置プリミティブ（フラット化済みDOM前提。§2.1 のケース1〜4）
  // ============================================================
  function _moveListItemFlat(li, direction) {
    const parentList = li.parentElement;
    if (!parentList) return { ok: false, reason: 'no-parent' };

    // ケース1: 同一リスト内の隣接LI → 前後入れ替え
    const sib = direction === 'up' ? li.previousElementSibling : li.nextElementSibling;
    if (sib && sib.tagName === 'LI') {
      _insertRelative(li, sib, direction === 'up');
      return { ok: true, block: li };
    }

    // 現在のリスト内でこの方向の端にいる。
    const grandParent = parentList.parentElement;
    const grandLi = grandParent && grandParent.tagName === 'LI' ? grandParent : null;
    if (grandLi) {
      // ケース2: 入れ子リストの端 → 親LIと同じ階層へ一段だけ昇格する
      // （子リストはliの子ノードのまま一体で移動する）。
      _insertRelative(li, grandLi, direction === 'up');
      _cleanupEmptyList(parentList);
      return { ok: true, block: li };
    }

    // parentList はルート直下のリスト。リスト自体の隣接ブロックを見る。
    const outer = _meaningfulSibling(parentList, direction);
    if (!outer) return { ok: false, reason: 'boundary' };

    if (LIST_TAG_RE.test(outer.tagName) && outer.tagName === parentList.tagName) {
      // ケース3: 隣接する同種リストへ合流。
      // up: 上のリストの末尾へ（そこへ「上がっていく」自然な着地点）
      // down: 下のリストの先頭へ
      if (direction === 'up') outer.appendChild(li);
      else outer.insertBefore(li, outer.firstElementChild);
      _cleanupEmptyList(parentList);
      return { ok: true, block: li };
    }

    // ケース4: 通常行との境界 → 旧実装どおりLIを通常行(div)へ変換して越える。
    // 子ノード（_nl-id・チェックボックス・ネストしたリスト等）はすべて生きたまま移す。
    const div = document.createElement('div');
    Array.from(li.childNodes).forEach((n) => div.appendChild(n));
    _insertRelative(div, outer, direction === 'up');
    li.remove();
    _cleanupEmptyList(parentList);
    return { ok: true, block: div, converted: true };
  }

  function _moveNonListRowFlat(rowEl, direction) {
    const sib = _meaningfulSibling(rowEl, direction);
    if (!sib) return { ok: false, reason: 'boundary' };

    if (LIST_TAG_RE.test(sib.tagName)) {
      // ケース4の逆: 通常行 → 隣接リストへLIとして合流する。
      const li = document.createElement('li');
      Array.from(rowEl.childNodes).forEach((n) => li.appendChild(n));
      if (direction === 'up') sib.appendChild(li);
      else sib.insertBefore(li, sib.firstElementChild);
      rowEl.remove();
      return { ok: true, block: li, converted: true };
    }

    _insertRelative(rowEl, sib, direction === 'up');
    return { ok: true, block: rowEl };
  }

  function _flatStep(rowEl, direction) {
    if (!rowEl) return { ok: false, reason: 'no-block' };
    return rowEl.tagName === 'LI' ? _moveListItemFlat(rowEl, direction) : _moveNonListRowFlat(rowEl, direction);
  }

  // ============================================================
  // 7. 公開: moveRow（キーボード等、1段階移動）
  // ============================================================
  function moveRow(editable, rowEl, direction) {
    if (!editable || !rowEl) return { ok: false, reason: 'no-block' };
    if (direction !== 'up' && direction !== 'down') return { ok: false, reason: 'bad-direction' };
    const wasWrapped = _unwrapForOp(editable);
    let result;
    try {
      result = _flatStep(rowEl, direction);
    } finally {
      _rewrapAfterOp(editable, wasWrapped);
    }
    return result;
  }

  // ============================================================
  // 8. 公開: placeRowRelative（ドラッグ等、任意目標への配置）
  // ============================================================
  // targetRow の直前(before=true)／直後(before=false)へ rowEl を配置する。
  // Ctrl移動と同じ1段階プリミティブ(_flatStep)を目標へ到達するまで反復適用し、
  // キーボード操作とドラッグでDOM結果を一致させる（別アルゴリズムを持たない）。
  const MAX_PLACEMENT_STEPS = 400;

  function _directionTowards(fromEl, targetEl) {
    if (!fromEl.isConnected || !targetEl.isConnected) return null;
    const pos = fromEl.compareDocumentPosition(targetEl);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return 'down';
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 'up';
    return null;
  }

  function _isPlacedRelative(rowEl, targetRow, before) {
    if (!rowEl.isConnected || !targetRow.isConnected) return false;
    if (rowEl.parentElement !== targetRow.parentElement) return false;
    return before ? rowEl.nextElementSibling === targetRow : rowEl.previousElementSibling === targetRow;
  }

  function placeRowRelative(editable, rowEl, targetRow, before) {
    if (!editable || !rowEl || !targetRow || rowEl === targetRow) return { ok: false, reason: 'invalid' };
    if (wouldCreateCycle(rowEl, targetRow)) return { ok: false, reason: 'cycle' };

    const wasWrapped = _unwrapForOp(editable);
    let cur = rowEl;
    let last = { ok: true, block: cur };
    let steps = 0;
    try {
      while (steps++ < MAX_PLACEMENT_STEPS) {
        if (_isPlacedRelative(cur, targetRow, before)) { last = { ok: true, block: cur, steps }; break; }
        const direction = _directionTowards(cur, targetRow);
        if (!direction) { last = { ok: true, block: cur, steps }; break; }
        const stepResult = _flatStep(cur, direction);
        if (!stepResult.ok) { last = stepResult; break; }
        cur = stepResult.block || cur;
        last = stepResult;
        if (steps >= MAX_PLACEMENT_STEPS) last = { ok: false, reason: 'unreachable' };
      }
    } finally {
      _rewrapAfterOp(editable, wasWrapped);
    }
    return last;
  }

  // ============================================================
  // 公開API
  // ============================================================
  global.MeldexNoteLogicalRows = {
    isHeadingSectionWrapper,
    rowKind,
    isRowElement,
    listRows,
    rowOwnRect,
    resolveRowAt,
    rowAtPoint,
    showRowHighlight,
    hideRowHighlight,
    refreshRowHighlight,
    wouldCreateCycle,
    moveRow,
    placeRowRelative,
  };
})(window);
