/* ==============================
   gb-note-block-types.js: ノート行種 正本レジストリ
   計画書: app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md
           §4.2（レジストリ仕様）§5 工程4（共通の現在行変換）
   依存: gb-editor.js（mdToHtml/htmlToMd, _pushCustomUndo, esc）, meldex-core.js（lucide, showStatus）

   このファイルは、行種（本文・見出し1-6・箇条書き・番号付き・チェックリスト・
   コールアウト・引用・コード・表・区切り線）の定義と、現在行を「内容を失わず」
   変換する共通プリミティブを提供する正本である。
   `/` スラッシュメニュー（gb-note-enhance.part01.js）、行頭記法
   （gb-note-enhance.part02.js）、チェックリスト・コールアウトショートカット
   （gb-shortcuts.part01.js）はすべてこのファイルの `MeldexNoteBlockTypes` へ委譲する。
   工程7-10（ハンドル／右クリック／長押し／ツールバー）はこのレジストリを
   そのまま再利用する想定で、TYPES 配列・convertCurrentLineTo・resolveCurrentBlock
   は工程7-10からもそのまま呼び出せる公開APIとする。
   ============================== */

(function (global) {
  'use strict';

  // ============================================================
  // 0. 編集ホスト解決
  // ============================================================
  // note.* ショートカット（gb-shortcuts.part01.js の _activeNoteEditable）と同じ
  // 3ホストに揃える。board-note-editable はボードレーンの管轄のため対象外
  // （§5工程7以降でホスト一般化する際に再検討する）。
  const EDITABLE_SELECTOR = '#page-content, #entity-freetext, #dp-editable';

  function resolveEditableHost(nodeOrRange) {
    if (!nodeOrRange) return null;
    let node = nodeOrRange;
    if (node.startContainer) node = node.startContainer; // Range
    if (node.nodeType === 3) node = node.parentElement;
    if (!node || typeof node.closest !== 'function') return null;
    return node.closest(EDITABLE_SELECTOR) || null;
  }

  function activeEditableHost() {
    const ae = document.activeElement;
    const editable = ae && typeof ae.closest === 'function' ? ae.closest(EDITABLE_SELECTOR) : null;
    return editable || null;
  }

  function isEditableWritable(editable) {
    return !!editable && editable.contentEditable === 'true';
  }

  function currentRangeWithin(editable) {
    if (!editable) return null;
    const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!editable.contains(range.startContainer)) return null;
    return range;
  }

  // ============================================================
  // 1. 現在行（論理ブロック）の解決 — 計画書§2.4
  // ============================================================
  // - 通常段落／見出し: そのブロック
  // - 箇条書き／番号付き／チェックリスト: 選択中の li
  // - コールアウト／引用／コード／表: コンテナ全体
  // - section.heading-section は表示用ラッパーなので通過する（移動単位にしない）
  function resolveCurrentBlock(editable, range) {
    if (!editable || !range) return null;
    const rawContainer = range.startContainer;
    let node = rawContainer;
    if (node.nodeType === 3) node = node.parentElement;
    if (!node || !editable.contains(node)) return null;
    // 区切り線(HR)はvoid要素で内部に選択が入らないため、range.startContainerが
    // HRそのもの、または（startContainerが元々要素の場合のみ）そのオフセットが
    // 子ノード列上でHRの直前/直後を指す場合を明示的に検出する。startContainerが
    // テキストノードだった場合のoffsetは「文字位置」であり、親要素の子ノード
    // インデックスとは無関係の数え方のため、その変換後のnodeに対してこの
    // オフセット判定を行ってはならない（座標系の取り違えを防ぐ）。
    if (node.nodeType === 1 && node.tagName === 'HR') {
      return { kind: 'hr', block: node, editable, hasNestedList: false };
    }
    if (rawContainer.nodeType === 1) {
      const kids = rawContainer.childNodes;
      const at = kids[range.startOffset];
      const before = range.startOffset > 0 ? kids[range.startOffset - 1] : null;
      if (at && at.nodeType === 1 && at.tagName === 'HR') return { kind: 'hr', block: at, editable, hasNestedList: false };
      if (before && before.nodeType === 1 && before.tagName === 'HR') return { kind: 'hr', block: before, editable, hasNestedList: false };
    }
    let el = node;
    while (el && el !== editable) {
      if (el.nodeType === 1) {
        const tag = el.tagName;
        if (tag === 'LI') {
          const hasNestedList = !!el.querySelector(':scope > ul, :scope > ol');
          return { kind: 'list-item', block: el, editable, hasNestedList };
        }
        if (el.classList && el.classList.contains('callout-block')) {
          return { kind: 'callout', block: el, editable, hasNestedList: false };
        }
        if (tag === 'BLOCKQUOTE') return { kind: 'quote', block: el, editable, hasNestedList: false };
        if (tag === 'PRE') return { kind: 'code', block: el, editable, hasNestedList: false };
        if (tag === 'TABLE') return { kind: 'table', block: el, editable, hasNestedList: false };
        if (/^H[1-6]$/.test(tag)) return { kind: 'heading', block: el, editable, hasNestedList: false };
        const parent = el.parentElement;
        const isTopLevel = parent === editable || (parent && parent.classList && parent.classList.contains('heading-section'));
        if (isTopLevel && (tag === 'DIV' || tag === 'P')) {
          return { kind: 'body', block: el, editable, hasNestedList: false };
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function getBlockTypeId(info) {
    if (!info) return null;
    switch (info.kind) {
      case 'list-item': {
        if (info.block.classList && info.block.classList.contains('note-checklist-item')) return 'checklist';
        return info.block.parentElement && info.block.parentElement.tagName === 'OL' ? 'ol' : 'ul';
      }
      case 'callout': return 'callout';
      case 'quote': return 'quote';
      case 'code': return 'code';
      case 'table': return 'table';
      case 'hr': return 'hr';
      case 'heading': return info.block.tagName.toLowerCase();
      case 'body': return 'body';
      default: return null;
    }
  }

  // ============================================================
  // 2. 内容抽出／構築ヘルパー（テキスト・書式・アンカー・コメント・IDの保持）
  // ============================================================
  function _isNlIdSpan(node) {
    return !!(node && node.nodeType === 1 && node.classList && node.classList.contains('_nl-id'));
  }

  // 親要素から _nl-id マーカー（コメント安定ID）を取り除いて返す（先頭要素のみ有効）。
  function _takeNlIdSpan(container) {
    if (!container || !container.firstElementChild) return null;
    const first = container.firstElementChild;
    if (_isNlIdSpan(first) && container.firstChild === first) {
      first.remove();
      return first;
    }
    return null;
  }

  // ブロックの子ノードをすべて「移動」して配列で返す（クローンしない＝インライン書式・
  // コメントハイライト・自動リンク等の実体を保つ）。excludeNestedList=true の場合、
  // 直下の UL/OL（ネストしたサブリスト）は nestedList として分離する。
  function _extractSimpleContent(container, options) {
    const opts = options || {};
    const nodes = [];
    let nestedList = null;
    const nlIdSpan = _takeNlIdSpan(container);
    Array.from(container.childNodes).forEach((child) => {
      if (opts.excludeNestedList && child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) {
        nestedList = child;
        return;
      }
      nodes.push(child);
    });
    nodes.forEach((n) => { if (n.parentNode) n.parentNode.removeChild(n); });
    if (nestedList && nestedList.parentNode) nestedList.parentNode.removeChild(nestedList);
    return { nlIdSpan, nodes, nestedList };
  }

  function _extractCalloutContent(calloutEl) {
    const nlIdSpan = _takeNlIdSpan(calloutEl); // 稀: 会話上手動で先頭に置かれた場合のみ
    const body = calloutEl.querySelector('.callout-body') || calloutEl;
    const extracted = _extractSimpleContent(body, {});
    return { nlIdSpan: nlIdSpan || extracted.nlIdSpan, nodes: extracted.nodes };
  }

  // 引用（出典なし／出典ありの両構造に対応）。出典は失わないよう本文末尾へ合流する。
  function _extractQuoteContent(blockquoteEl) {
    const nlIdSpan = _takeNlIdSpan(blockquoteEl);
    const qBody = blockquoteEl.querySelector('.quote-body');
    const qCite = blockquoteEl.querySelector('.quote-cite');
    if (qBody || qCite) {
      const nodes = [];
      if (qBody) nodes.push(...Array.from(qBody.childNodes));
      if (qCite) {
        if (nodes.length) nodes.push(document.createElement('br'));
        nodes.push(document.createTextNode('— '));
        nodes.push(...Array.from(qCite.childNodes));
      }
      nodes.forEach((n) => { if (n.parentNode) n.parentNode.removeChild(n); });
      return { nlIdSpan, nodes };
    }
    return { nlIdSpan, nodes: Array.from(blockquoteEl.childNodes).filter((n) => {
      if (n.parentNode) n.parentNode.removeChild(n);
      return true;
    }) };
  }

  function _extractCodeText(preEl) {
    const code = preEl.querySelector('code') || preEl;
    return code.textContent || '';
  }

  function _nodesToPlainText(nodes) {
    const div = document.createElement('div');
    nodes.forEach((n) => div.appendChild(n.cloneNode(true)));
    // <br> はtextContentに寄与しないため、そのままだと複数行が連結されてしまう
    // （コールアウト/引用→コード変換で改行が消える不具合）。改行文字へ変換してから
    // textContentを取る。
    div.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\n')));
    return div.textContent || '';
  }

  function _isBlockTextEmpty(block) {
    if (!block) return true;
    const clone = block.cloneNode(true);
    clone.querySelectorAll('._nl-id, input.note-checklist-check, br').forEach((n) => n.remove());
    return clone.textContent.trim() === '';
  }

  // ============================================================
  // 3. 構築ヘルパー
  // ============================================================
  // 空行を変換する時、抽出したnodesが「空文字テキストノード」1個だけのことがある
  // （例: 行頭で"/"を打ってから削除した直後の残骸）。そのまま新しい要素へ移すと、
  // 要素の子は「空文字テキストノードのみ」になり、innerHTML上は空要素に見えるが
  // 実際には子がある状態になる。この状態はブラウザのcontenteditable実装によっては
  // キャレット位置の内部管理が不安定になり、直後の入力が別のブロックに飛ぶ不具合の
  // 原因になる（実機検証で確認）。「実際に見える内容が無い」場合は既存コードベース
  // 全体で使われている <br> 単独パターンへ揃える。
  function _hasMeaningfulContent(nodes) {
    return (nodes || []).some((n) => n.nodeType !== 3 || (n.textContent && n.textContent.length > 0));
  }

  function _appendPreserved(container, nlIdSpan, nodes) {
    if (nlIdSpan) container.appendChild(nlIdSpan);
    if (nodes && nodes.length && _hasMeaningfulContent(nodes)) {
      nodes.forEach((n) => container.appendChild(n));
    } else if (!nlIdSpan) {
      container.appendChild(document.createElement('br'));
    }
  }

  function _buildSimpleBlock(tag, nlIdSpan, nodes) {
    const el = document.createElement(tag);
    _appendPreserved(el, nlIdSpan, nodes);
    return el;
  }

  function _buildCallout(nlIdSpan, nodes) {
    const wrap = document.createElement('div');
    wrap.className = 'callout-block callout-info';
    wrap.setAttribute('contenteditable', 'false');
    if (nlIdSpan) wrap.appendChild(nlIdSpan);
    const icon = document.createElement('span');
    icon.className = 'callout-icon';
    icon.dataset.icon = 'info';
    icon.innerHTML = typeof lucide === 'function' ? lucide('info', 20) : '';
    wrap.appendChild(icon);
    const body = document.createElement('div');
    body.className = 'callout-body';
    body.setAttribute('contenteditable', 'true');
    if (nodes && nodes.length && _hasMeaningfulContent(nodes)) nodes.forEach((n) => body.appendChild(n));
    else body.appendChild(document.createElement('br'));
    wrap.appendChild(body);
    return wrap;
  }

  function _buildCode(nlIdSpan, text) {
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:var(--bg3);padding:8px;border-radius:4px;overflow-x:auto;font-size:13px;';
    if (nlIdSpan) pre.appendChild(nlIdSpan);
    const code = document.createElement('code');
    code.textContent = text || '';
    pre.appendChild(code);
    return pre;
  }

  function _buildTable(nodes) {
    const table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;width:100%;margin:8px 0;';
    const row1 = document.createElement('tr');
    const th1 = document.createElement('th');
    th1.style.cssText = 'border:1px solid var(--border);padding:4px 8px;';
    if (nodes && nodes.length) nodes.forEach((n) => th1.appendChild(n));
    const th2 = document.createElement('th');
    th2.style.cssText = 'border:1px solid var(--border);padding:4px 8px;';
    row1.appendChild(th1); row1.appendChild(th2);
    const row2 = document.createElement('tr');
    ['td', 'td'].forEach(() => {
      const td = document.createElement('td');
      td.style.cssText = 'border:1px solid var(--border);padding:4px 8px;';
      row2.appendChild(td);
    });
    table.appendChild(row1); table.appendChild(row2);
    return table;
  }

  function _buildListItemEl(options) {
    const opts = options || {};
    const li = document.createElement('li');
    if (opts.checklist) {
      li.className = 'note-checklist-item';
      li.dataset.checked = opts.checked ? 'true' : 'false';
    }
    if (opts.nlIdSpan) li.appendChild(opts.nlIdSpan);
    if (opts.checklist) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'note-checklist-check';
      checkbox.setAttribute('contenteditable', 'false');
      checkbox.tabIndex = -1;
      checkbox.setAttribute('aria-label', 'チェック項目');
      // 共通UI監査（gb-e2e-coverage.js）が要求する安定した識別子。
      // 同一ノート内に複数のチェックリスト項目があっても、各要素は自分自身の
      // datasetだけを見て判定されるため、この行種共通の値で全項目を満たせる。
      checkbox.setAttribute('data-e2e-id', 'note-checklist-check');
      if (opts.checked) checkbox.checked = true;
      li.appendChild(checkbox);
    }
    if (opts.nodes && opts.nodes.length && _hasMeaningfulContent(opts.nodes)) opts.nodes.forEach((n) => li.appendChild(n));
    else if (!opts.nlIdSpan) li.appendChild(document.createElement('br'));
    if (opts.nestedList) li.appendChild(opts.nestedList);
    return li;
  }

  function _copyHeadingAnchor(oldEl, newEl) {
    if (!oldEl || !newEl) return;
    const id = oldEl.getAttribute('id');
    const headingId = oldEl.getAttribute('data-note-heading-id');
    if (id) newEl.setAttribute('id', id);
    if (headingId) newEl.setAttribute('data-note-heading-id', headingId);
    if (oldEl.classList && oldEl.classList.contains('note-title')) {
      newEl.classList.add('note-title');
      newEl.setAttribute('data-note-title', '1');
    }
  }

  // ============================================================
  // 4. リスト分割（現在行だけを差し替え、前後の兄弟行は元のリストのまま残す）
  // ============================================================
  function _splitListAtItem(li) {
    const parentList = li.parentElement;
    const grandParent = parentList.parentElement;
    const tag = parentList.tagName;
    const startAttr = parentList.getAttribute('start');
    // 分割後のafterList（liより後ろに残る項目群）は、元のリストの続きの番号から
    // 始まらなければならない。単純に元の start をそのままコピーすると、
    // 「start無し(既定1)の1,2,3,4,5のうち3番目を変換」で afterList が
    // 1,2から始まってしまう（正しくは4,5）。分割位置（liより前にあった項目数）を
    // 数え、「元のstart + 前方項目数 + 1（liが占めていた番号ぶん）」を新しいstartにする。
    const originalStart = startAttr ? parseInt(startAttr, 10) : 1;
    let precedingItemCount = 0;
    for (let sib = li.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.tagName === 'LI') precedingItemCount++;
    }
    const insertBeforeNode = parentList.nextSibling;
    const afterNodes = [];
    let sib = li.nextSibling;
    while (sib) {
      const next = sib.nextSibling;
      afterNodes.push(sib);
      sib = next;
    }
    afterNodes.forEach((n) => parentList.removeChild(n));
    parentList.removeChild(li);
    if (!parentList.children.length) grandParent.removeChild(parentList);
    let afterList = null;
    if (afterNodes.length) {
      afterList = document.createElement(tag.toLowerCase());
      // start属性はOLにのみ意味を持つ（ULでは元コードも実質no-opだった挙動を維持）。
      if (tag === 'OL') {
        const afterStart = originalStart + precedingItemCount + 1;
        if (afterStart !== 1) afterList.setAttribute('start', String(afterStart));
      }
      afterNodes.forEach((n) => afterList.appendChild(n));
    }
    return { grandParent, insertBeforeNode, afterList };
  }

  function _replaceSource(info, newRoot) {
    if (info.kind === 'list-item') {
      const split = _splitListAtItem(info.block);
      split.grandParent.insertBefore(newRoot, split.insertBeforeNode);
      if (split.afterList) split.grandParent.insertBefore(split.afterList, split.insertBeforeNode);
      return;
    }
    info.block.replaceWith(newRoot);
  }

  // ============================================================
  // 5. キャレット保持
  // ============================================================
  // 変換は子ノードを「移動」するだけで再生成しないため、Range の境界点（同じノード
  // 参照＋オフセット）は再配置後も有効であることを利用する。
  function _captureCaretRefs(range) {
    if (!range) return null;
    return { sc: range.startContainer, so: range.startOffset, ec: range.endContainer, eo: range.endOffset };
  }

  function _nodeLength(node) {
    return node.nodeType === 3 ? node.textContent.length : node.childNodes.length;
  }

  function _placeCaretAtStart(block) {
    if (!block) return;
    const sel = window.getSelection();
    if (!sel) return;
    if (!block.childNodes.length) block.appendChild(document.createElement('br'));
    const range = document.createRange();
    const nlIdSpan = block.firstElementChild && _isNlIdSpan(block.firstElementChild) ? block.firstElementChild : null;
    if (nlIdSpan) range.setStartAfter(nlIdSpan);
    else range.setStart(block, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function _restoreCaretRefs(refs, fallbackBlock) {
    const sel = window.getSelection();
    if (!sel) return;
    try {
      if (refs && refs.sc && refs.sc.isConnected !== false && document.contains(refs.sc)) {
        const r = document.createRange();
        r.setStart(refs.sc, Math.min(refs.so, _nodeLength(refs.sc)));
        if (refs.ec && document.contains(refs.ec)) r.setEnd(refs.ec, Math.min(refs.eo, _nodeLength(refs.ec)));
        else r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
    } catch (_) { /* フォールバックへ */ }
    _placeCaretAtStart(fallbackBlock);
  }

  function _placeCaretAtEnd(block) {
    if (!block) return;
    const sel = window.getSelection();
    if (!sel) return;
    if (!block.childNodes.length) block.appendChild(document.createElement('br'));
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ============================================================
  // 5.5 論理行内の文字オフセットスナップショット（行種変換のキャレット保持）
  // ============================================================
  // 計画書§2.2: 行種変換はコード／表など内容を作り直す経路があり、生ノード参照
  // （_captureCaretRefs）だけでは復元先が無くなることがある（例: コード変換は
  // 文字列からテキストノードを新規作成する）。行内の「先頭からの文字オフセット」を
  // 安定した基準にし、変換後に対象要素（本文/見出しは新要素、コールアウトは本文、
  // コードはcode要素）へ同じオフセットで復元する。表・区切り線は文字オフセットの
  // 対応関係が無い（表は先頭セル、区切り線は直後の編集位置）ため、呼び出し側で
  // 個別に扱う。
  function _captureRowSnapshot(block, range) {
    if (!block || !range) return null;
    try {
      const startOffset = _offsetFromRowStart(block, range.startContainer, range.startOffset);
      const endOffset = _offsetFromRowStart(block, range.endContainer, range.endOffset);
      if (startOffset == null || endOffset == null) return null;
      const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
      let backward = false;
      if (sel && sel.anchorNode && sel.focusNode && !sel.isCollapsed) {
        try {
          const cmp = sel.anchorNode.compareDocumentPosition(sel.focusNode);
          backward = !!(cmp & Node.DOCUMENT_POSITION_PRECEDING)
            || (sel.anchorNode === sel.focusNode && sel.anchorOffset > sel.focusOffset);
        } catch (_) { backward = false; }
      }
      return {
        start: Math.min(startOffset, endOffset),
        end: Math.max(startOffset, endOffset),
        backward,
      };
    } catch (_) { return null; }
  }

  // 行内の文字オフセットを数える単位は、コード変換時の実テキスト（_nodesToPlainText、
  // <br>を'\n'1文字として扱う）と揃える。_nl-id・チェックボックスは非表示要素として
  // カウント対象から除く。
  function _offsetFromRowStart(block, container, offset) {
    if (!container) return null;
    let total = 0;
    let found = null;
    function addLength(node) {
      if (found !== null) return;
      if (node.nodeType === 3) { total += node.textContent.length; return; }
      if (node.nodeType === 1) {
        if (node.tagName === 'BR') { total += 1; return; }
        if (_isNlIdSpan(node)) return;
        if (node.tagName === 'INPUT') return;
        Array.prototype.forEach.call(node.childNodes, addLength);
      }
    }
    function visit(node) {
      if (found !== null) return;
      if (node === container) {
        if (node.nodeType === 3) { found = total + Math.min(offset, node.textContent.length); return; }
        const kids = node.childNodes;
        for (let i = 0; i < offset && i < kids.length; i++) addLength(kids[i]);
        found = total;
        return;
      }
      if (node.nodeType === 3) { total += node.textContent.length; return; }
      if (node.nodeType === 1) {
        if (node.tagName === 'BR') { total += 1; return; }
        if (_isNlIdSpan(node)) return;
        if (node.tagName === 'INPUT') return;
        Array.prototype.forEach.call(node.childNodes, visit);
      }
    }
    try { visit(block); } catch (_) { return null; }
    return found;
  }

  // 文字オフセットに対応する (node, offset) を求める（_offsetFromRowStart と同じ
  // 数え方: <br> を1文字とみなす）。見つからない場合はブロック末尾へフォールバックする。
  function _resolveOffsetPosition(block, charOffset) {
    if (!block.childNodes.length) block.appendChild(document.createElement('br'));
    let remaining = Math.max(0, charOffset);
    let result = null;
    function walk(node) {
      if (result) return;
      if (node.nodeType === 3) {
        const len = node.textContent.length;
        if (remaining <= len) { result = { node, offset: remaining }; return; }
        remaining -= len;
        return;
      }
      if (node.nodeType === 1) {
        if (node.tagName === 'BR') {
          if (remaining <= 0) {
            const parent = node.parentNode;
            result = { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) };
            return;
          }
          remaining -= 1;
          return;
        }
        if (_isNlIdSpan(node)) return;
        if (node.tagName === 'INPUT') return;
        Array.prototype.forEach.call(node.childNodes, walk);
      }
    }
    walk(block);
    if (result) return result;
    return { node: block, offset: block.childNodes.length };
  }

  function _restoreRowSnapshot(block, snapshot) {
    if (!block || !snapshot) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    try {
      const startPos = _resolveOffsetPosition(block, snapshot.start);
      const endPos = _resolveOffsetPosition(block, snapshot.end);
      if (!startPos || !endPos) return false;
      if (typeof sel.setBaseAndExtent === 'function') {
        if (snapshot.backward) sel.setBaseAndExtent(endPos.node, endPos.offset, startPos.node, startPos.offset);
        else sel.setBaseAndExtent(startPos.node, startPos.offset, endPos.node, endPos.offset);
      } else {
        const r = document.createRange();
        r.setStart(startPos.node, startPos.offset);
        r.setEnd(endPos.node, endPos.offset);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return true;
    } catch (_) { return false; }
  }

  // 区切り線への変換後は「直後の編集位置」へ対応付ける（区切り線自体は編集不可）。
  // 直後に別の行があればその先頭へ、無ければ空の本文行を新設してそこへ置く。
  function _placeCaretAfterHr(editable, hrEl) {
    const sel = window.getSelection();
    if (!sel || !hrEl) return;
    let next = hrEl.nextElementSibling;
    while (next && next.tagName === 'BR') next = next.nextElementSibling;
    if (!next) {
      next = document.createElement('div');
      next.appendChild(document.createElement('br'));
      hrEl.after(next);
    } else if (next.tagName === 'LI') {
      // LIの内容へ直接キャレットは置けないため、その最初のテキスト位置を使う。
      _placeCaretAtStart(next);
      return;
    }
    _placeCaretAtStart(next);
  }

  // ============================================================
  // 6. 変換本体
  // ============================================================
  function _extractForConvert(info) {
    switch (info.kind) {
      case 'list-item': {
        const ex = _extractSimpleContent(info.block, { excludeNestedList: true });
        return { nlIdSpan: ex.nlIdSpan, nodes: ex.nodes, nestedList: ex.nestedList, text: '' };
      }
      case 'callout': {
        const ex = _extractCalloutContent(info.block);
        return { nlIdSpan: ex.nlIdSpan, nodes: ex.nodes, nestedList: null, text: '' };
      }
      case 'quote': {
        const ex = _extractQuoteContent(info.block);
        return { nlIdSpan: ex.nlIdSpan, nodes: ex.nodes, nestedList: null, text: '' };
      }
      case 'code': {
        return { nlIdSpan: _takeNlIdSpan(info.block), nodes: [], nestedList: null, text: _extractCodeText(info.block) };
      }
      case 'heading':
      case 'body': {
        const ex = _extractSimpleContent(info.block, {});
        return { nlIdSpan: ex.nlIdSpan, nodes: ex.nodes, nestedList: null, text: '' };
      }
      default:
        return { nlIdSpan: null, nodes: [], nestedList: null, text: '' };
    }
  }

  function _performConvert(typeId, info, ctx) {
    const extracted = _extractForConvert(info);
    let nodes = extracted.nodes;
    if (!nodes.length && extracted.text) nodes = [document.createTextNode(extracted.text)];

    let newRoot = null;
    let focusTarget = null;

    if (typeId === 'body') {
      newRoot = _buildSimpleBlock('div', extracted.nlIdSpan, nodes);
      focusTarget = newRoot;
    } else if (/^h[1-6]$/.test(typeId)) {
      newRoot = _buildSimpleBlock(typeId, extracted.nlIdSpan, nodes);
      if (info.kind === 'heading') _copyHeadingAnchor(info.block, newRoot);
      focusTarget = newRoot;
    } else if (typeId === 'quote') {
      newRoot = _buildSimpleBlock('blockquote', extracted.nlIdSpan, nodes);
      focusTarget = newRoot;
    } else if (typeId === 'callout') {
      newRoot = _buildCallout(extracted.nlIdSpan, nodes);
      focusTarget = newRoot.querySelector('.callout-body');
    } else if (typeId === 'code') {
      const text = extracted.text || _nodesToPlainText(nodes);
      newRoot = _buildCode(extracted.nlIdSpan, text);
      focusTarget = newRoot.querySelector('code');
    } else if (typeId === 'table') {
      newRoot = _buildTable(nodes);
      focusTarget = newRoot.querySelector('th');
    } else if (typeId === 'hr') {
      newRoot = document.createElement('hr');
      focusTarget = null;
    } else if (typeId === 'ul' || typeId === 'ol' || typeId === 'checklist') {
      const tag = typeId === 'ol' ? 'ol' : 'ul';
      const li = _buildListItemEl({
        nlIdSpan: extracted.nlIdSpan,
        nodes,
        nestedList: extracted.nestedList,
        checklist: typeId === 'checklist',
        checked: false,
      });
      const wrapper = document.createElement(tag);
      // orderedStart は「0」も有効な指定値（行頭記法で「0」+スペースを打った場合等）
      // のため、truthy判定だと0の時にstartが付かなくなる（低重要度の既知バグ）。
      if (typeId === 'ol' && ctx && ctx.orderedStart != null) wrapper.setAttribute('start', String(ctx.orderedStart));
      wrapper.appendChild(li);
      newRoot = wrapper;
      focusTarget = li;
    }

    if (!newRoot) return null;
    _replaceSource(info, newRoot);
    return { newRoot, focusTarget };
  }

  // ============================================================
  // 7. 変換可否
  // ============================================================
  const READONLY_STATE = Object.freeze({ disabled: true, reasonKey: 'readonly', reasonText: '読み取り専用のため変更できません' });

  function canConvert(typeId, editable, info) {
    if (!isEditableWritable(editable)) return { allowed: false, reason: READONLY_STATE.reasonText };
    if (info && info.kind === 'table' && typeId !== 'table') {
      return { allowed: false, reason: '表からの変換には対応していません' };
    }
    if (info && info.kind === 'list-item' && info.hasNestedList) {
      const staysList = typeId === 'ul' || typeId === 'ol' || typeId === 'checklist';
      if (!staysList) return { allowed: false, reason: 'サブリストを含む行は変換できません' };
    }
    if (typeId === 'hr') {
      const empty = info ? _isBlockTextEmpty(info.block) : true;
      if (!empty) return { allowed: false, reason: 'この行に文字があるため区切り線に変換できません' };
    }
    return { allowed: true, reason: '' };
  }

  // ============================================================
  // 7.5 見出しセクション（表示用ラッパー）の再構築
  // ============================================================
  // 見出しインデント表示（gb-note-enhance.part01.js の wrapHeadingSections /
  // unwrapHeadingSections）がONの場合、見出し⇄他行種の変換は section.heading-section
  // の構造をズレさせる:
  //   - 見出し→他行種: 旧見出しの section が「見出しの無い section」として残留する
  //   - 他行種→見出し: 新しい見出しが section にラップされないまま残る
  // 影響ブロック周辺だけを部分再構築するのは section の入れ子（前後の見出しレベル）を
  // 正しく追跡する必要があり複雑なため、既存関数をそのまま再利用し対象ホストを
  // 一度アンラップしてから再ラップする（離散的なユーザー操作でのみ発生し、毎キー
  // 入力では走らないため、ノート全体でも許容できるコスト）。#page-content のみが
  // 見出しインデント表示の対象（他ホストは対象外。既存挙動のまま）。
  function _isHeadingIndentOn() {
    if (typeof localStorage === 'undefined') return false;
    const v = localStorage.getItem('note-heading-indent');
    return v === null || v === '1';
  }

  function _refreshHeadingSectionsAfterConvert(editable, currentTypeId, typeId) {
    if (!editable || editable.id !== 'page-content') return;
    const touchesHeading = /^h[1-6]$/.test(currentTypeId || '') || /^h[1-6]$/.test(typeId || '');
    if (!touchesHeading || !_isHeadingIndentOn()) return;
    if (typeof global.unwrapHeadingSections === 'function') global.unwrapHeadingSections(editable);
    if (typeof global.wrapHeadingSections === 'function') global.wrapHeadingSections(editable);
  }

  // ============================================================
  // 7.6 キャレット復元（計画書§2.2）
  // ============================================================
  function _focusEditableForConvert(editable) {
    if (!editable || typeof editable.focus !== 'function') return;
    try { editable.focus({ preventScroll: true }); } catch (_) { try { editable.focus(); } catch (_) { /* noop */ } }
  }

  // コールアウトの callout-body は contenteditable="true" を明示指定した、外側の
  // callout-block（contenteditable="false"）とは別の「入れ子編集アイランド」。
  // キャレットをその中へ置いた直後に外側の editable（#page-content 等）へ
  // .focus() すると、ブラウザが選択位置を外側要素基準へ引き戻すことがあり、
  // 「変換後のキャレットがcallout-body内にない」不具合の原因になる（実ブラウザE2E
  // 実行で確認）。対象がそのような入れ子編集アイランドを持つ場合は、そちら自身へ
  // フォーカスする（コード/表のセルは独自のcontenteditable指定を持たないため、
  // 従来どおり外側のeditableが選ばれ、挙動は変わらない）。
  function _focusHostForTarget(editable, target) {
    if (target && typeof target.closest === 'function') {
      const island = target.closest('[contenteditable="true"]');
      if (island) return island;
    }
    return editable;
  }

  function _restoreCaretAfterConvert(editable, typeId, result, snapshot) {
    if (typeId === 'hr') {
      _placeCaretAfterHr(editable, result.newRoot);
      _focusEditableForConvert(editable);
      return;
    }
    const target = result.focusTarget;
    const focusHost = _focusHostForTarget(editable, target || result.newRoot);
    if (typeId === 'table') {
      // 表は文字オフセットの対応関係が無いため、常に先頭セルの先頭へ置く。
      _placeCaretAtStart(target);
      _focusEditableForConvert(focusHost);
      return;
    }
    if (target && snapshot && _restoreRowSnapshot(target, snapshot)) {
      _focusEditableForConvert(focusHost);
      return;
    }
    // スナップショットが復元できない場合も、変換後の対象要素の先頭へ置く
    // （ノート先頭へのフォールバックは行わない）。
    _placeCaretAtStart(target || result.newRoot);
    _focusEditableForConvert(focusHost);
  }

  // ============================================================
  // 8. 公開: 現在行変換（工程4-1〜4-6 すべてを満たす共通入口）
  // ============================================================
  function convertCurrentLineTo(typeId, options) {
    const opts = options || {};
    const def = getType(typeId);
    if (!def) return { ok: false, reason: 'unknown-type' };

    const editable = opts.editable || resolveEditableHost(opts.range) || activeEditableHost();
    if (!editable) return { ok: false, reason: 'no-editable-host' };

    const range = opts.range || currentRangeWithin(editable);
    if (!range) return { ok: false, reason: 'no-selection' };

    const info = resolveCurrentBlock(editable, range);
    if (!info) return { ok: false, reason: 'no-current-block' };

    const currentTypeId = getBlockTypeId(info);
    // beforeConvert（行頭記法の「###」等トリガー文字削除）が指定されている場合は、
    // 型が同じでもトリガー文字の削除自体を1操作として実行する必要があるため、
    // unchanged 早期returnをスキップする。
    if (currentTypeId === typeId && typeof opts.beforeConvert !== 'function') {
      return { ok: true, block: info.block, unchanged: true };
    }

    const check = canConvert(typeId, editable, info);
    if (!check.allowed) return { ok: false, reason: check.reason };

    // §5工程4-4: 1操作を1回のUndoで戻せるようにする（既存のカスタムUndoスタックへ委譲）。
    // beforeConvert は undo push の直後・DOM変換の直前に呼ぶことで、行頭記法の
    // 「トリガー文字削除＋行種変換」を単一のUndo操作として扱う（工程6）。
    if (typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
    if (typeof opts.beforeConvert === 'function') opts.beforeConvert(info, range);

    // 計画書§2.2: 行内文字オフセット・選択範囲・方向の安定したスナップショットを
    // 取る。beforeConvert（トリガー文字削除等）でDOMが変わっている可能性があるため、
    // その直後の実際のキャレット位置（生きたSelectionがinfo.block内に残っていれば
    // それ）を基準にする。
    let snapshotRange = range;
    try {
      const liveSel = window.getSelection();
      if (liveSel && liveSel.rangeCount && info.block.isConnected) {
        const liveRange = liveSel.getRangeAt(0);
        if (info.block.contains(liveRange.startContainer)) snapshotRange = liveRange;
      }
    } catch (_) { /* range のまま使う */ }
    const rowSnapshot = _captureRowSnapshot(info.block, snapshotRange);

    const result = _performConvert(typeId, info, { orderedStart: opts.orderedStart });
    if (!result) return { ok: false, reason: 'convert-failed' };

    _refreshHeadingSectionsAfterConvert(editable, currentTypeId, typeId);
    // 行種変換と見出し階層の再構築がすべて完了してから復元する（§2.2）。
    // コールアウトは本文、コードはcode要素、表は先頭セル、区切り線は直後の
    // 編集位置へ対応付ける。変換後は元の行を表示したまま編集領域へフォーカスを
    // 戻し、ノート先頭へのフォールバックは行わない。
    _restoreCaretAfterConvert(editable, typeId, result, rowSnapshot);

    // §5工程4-5: 変換後は共通のdirty/保存経路だけを呼ぶ（既存のinputリスナーへ委譲。
    // 保存コーディネーターへの接続は保存系レーンが工程1で統合する）。
    // TODO(工程1統合): editable.dispatchEvent の直後に自動保存が走る経路は
    // gb-editor.part01.part01.js の pc.oninput のまま。共通保存コーディネーター
    // 導入後は、その入口へ差し替える（本タスクでは既存経路を変更しない）。
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    const toc = document.getElementById('note-toc');
    if (toc && toc.style.display !== 'none' && typeof updateNoteToc === 'function') updateNoteToc();

    return { ok: true, block: result.newRoot };
  }

  // ============================================================
  // 9. チェックリストの実チェック動作（クリックでチェック状態を切替）
  // ============================================================
  document.addEventListener('change', function (e) {
    const input = e.target && e.target.closest ? e.target.closest('input.note-checklist-check') : null;
    if (!input) return;
    const li = input.closest('li.note-checklist-item');
    if (!li) return;
    const editable = li.closest(EDITABLE_SELECTOR);
    if (!editable || editable.contentEditable !== 'true') {
      input.checked = !input.checked; // 読み取り専用時は変更を戻す
      return;
    }
    if (typeof _pushCustomUndo === 'function') _pushCustomUndo(editable);
    li.dataset.checked = input.checked ? 'true' : 'false';
    if (input.checked) input.setAttribute('checked', ''); else input.removeAttribute('checked');
    editable.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // ============================================================
  // 10. 行種レジストリ本体（正本）
  // ============================================================
  // 各定義: id, label（ユーザー向け名称）, icon, shortcutId（GB_SHORTCUTS参照。無ければnull）,
  // sampleTag/sampleClass（テーマ見本の描画に使う実タグ・実クラス）, keywords（メニュー検索用）,
  // convert（現在行変換関数。共通プリミティブへの薄い委譲）, readOnlyState。
  const TYPES = [
    {
      id: 'body', label: '本文', icon: 'pilcrow', shortcutId: null,
      sampleTag: 'div', sampleClass: '', keywords: ['本文', 'text', 'paragraph', 'ほんぶん'],
      readOnlyState: READONLY_STATE,
      convert(info, ctx) { return _performConvert('body', info, ctx); },
    },
    { id: 'h1', label: '見出し１', icon: 'heading', shortcutId: 'note.h1', sampleTag: 'h1', sampleClass: '', keywords: ['見出し', 'heading', 'h1', 'みだし'], readOnlyState: READONLY_STATE, convert(info, ctx) { return _performConvert('h1', info, ctx); } },
    { id: 'h2', label: '見出し２', icon: 'heading', shortcutId: 'note.h2', sampleTag: 'h2', sampleClass: '', keywords: ['見出し', 'heading', 'h2', 'みだし'], readOnlyState: READONLY_STATE, convert(info, ctx) { return _performConvert('h2', info, ctx); } },
    { id: 'h3', label: '見出し３', icon: 'heading', shortcutId: 'note.h3', sampleTag: 'h3', sampleClass: '', keywords: ['見出し', 'heading', 'h3', 'みだし'], readOnlyState: READONLY_STATE, convert(info, ctx) { return _performConvert('h3', info, ctx); } },
    { id: 'h4', label: '見出し４', icon: 'heading', shortcutId: 'note.h4', sampleTag: 'h4', sampleClass: '', keywords: ['見出し', 'heading', 'h4', 'みだし'], readOnlyState: READONLY_STATE, convert(info, ctx) { return _performConvert('h4', info, ctx); } },
    { id: 'h5', label: '見出し５', icon: 'heading', shortcutId: 'note.h5', sampleTag: 'h5', sampleClass: '', keywords: ['見出し', 'heading', 'h5', 'みだし'], readOnlyState: READONLY_STATE, convert(info, ctx) { return _performConvert('h5', info, ctx); } },
    { id: 'h6', label: '見出し６', icon: 'heading', shortcutId: 'note.h6', sampleTag: 'h6', sampleClass: '', keywords: ['見出し', 'heading', 'h6', 'みだし'], readOnlyState: READONLY_STATE, convert(info, ctx) { return _performConvert('h6', info, ctx); } },
    {
      id: 'ul', label: '箇条書き', icon: 'list', shortcutId: 'note.ul',
      sampleTag: 'li', sampleClass: '', keywords: ['箇条書き', 'リスト', 'list', 'bullet', 'りすと'],
      readOnlyState: READONLY_STATE,
      convert(info, ctx) { return _performConvert('ul', info, ctx); },
    },
    {
      id: 'ol', label: '番号付きリスト', icon: 'listOrdered', shortcutId: 'note.ol',
      sampleTag: 'li', sampleClass: '', keywords: ['番号', 'リスト', 'number', 'ordered', 'ばんごう'],
      readOnlyState: READONLY_STATE,
      convert(info, ctx) { return _performConvert('ol', info, ctx); },
    },
    {
      id: 'checklist', label: 'チェックリスト', icon: 'checkSquare', shortcutId: 'note.checklist',
      sampleTag: 'li', sampleClass: 'note-checklist-item', keywords: ['チェック', 'check', 'todo', 'ちぇっく', 'たすく'],
      readOnlyState: READONLY_STATE,
      convert(info, ctx) { return _performConvert('checklist', info, ctx); },
    },
    {
      id: 'callout', label: 'コールアウト', icon: 'alertTriangle', shortcutId: 'note.callout',
      sampleTag: 'div', sampleClass: 'callout-block callout-info', keywords: ['コールアウト', 'callout', '注意', 'info', 'めだたせ'],
      readOnlyState: READONLY_STATE,
      convert(info, ctx) { return _performConvert('callout', info, ctx); },
    },
    {
      id: 'quote', label: '引用', icon: 'quote', shortcutId: 'note.quote',
      sampleTag: 'blockquote', sampleClass: '', keywords: ['引用', 'quote', 'いんよう'],
      readOnlyState: READONLY_STATE,
      convert(info, ctx) { return _performConvert('quote', info, ctx); },
    },
    {
      id: 'code', label: 'コードブロック', icon: 'code', shortcutId: 'note.codeBlock',
      sampleTag: 'pre', sampleClass: '', keywords: ['コード', 'code', 'こーど'],
      readOnlyState: READONLY_STATE,
      convert(info, ctx) { return _performConvert('code', info, ctx); },
    },
    {
      id: 'table', label: 'テーブル', icon: 'table', shortcutId: null,
      sampleTag: 'table', sampleClass: '', keywords: ['テーブル', 'table', '表', 'ひょう'],
      readOnlyState: READONLY_STATE,
      convert(info, ctx) { return _performConvert('table', info, ctx); },
    },
    {
      id: 'hr', label: '区切り線', icon: 'minus', shortcutId: 'note.hr',
      sampleTag: 'hr', sampleClass: '', keywords: ['水平線', '区切り線', 'hr', 'line', 'すいへいせん'],
      readOnlyState: READONLY_STATE,
      convert(info, ctx) { return _performConvert('hr', info, ctx); },
    },
  ];

  const TYPES_BY_ID = TYPES.reduce((acc, t) => { acc[t.id] = t; return acc; }, {});

  function getType(id) { return TYPES_BY_ID[id] || null; }

  // ============================================================
  // 公開API
  // ============================================================
  global.MeldexNoteBlockTypes = {
    EDITABLE_SELECTOR,
    TYPES,
    getType,
    resolveEditableHost,
    activeEditableHost,
    isEditableWritable,
    resolveCurrentBlock,
    getBlockTypeId,
    canConvert,
    convertCurrentLineTo,
    isBlockTextEmpty: _isBlockTextEmpty,
    // 工程7-8（gb-note-block-reorder.js）向けの新規公開: 既存の内部キャレット保持
    // ヘルパーをそのまま公開する（ロジックの重複作成を避けるため）。既存の
    // 上記APIの挙動は変更していない。
    captureCaretRefs: _captureCaretRefs,
    restoreCaretRefs: _restoreCaretRefs,
    // §2.2: 行種変換専用のオフセットベースのキャレットスナップショット（テスト・
    // 他の変換経路からの再利用向けに公開する。読み取り専用の内部ヘルパー）。
    captureRowSnapshot: _captureRowSnapshot,
    restoreRowSnapshot: _restoreRowSnapshot,
    placeCaretAtStart: _placeCaretAtStart,
    placeCaretAtEnd: _placeCaretAtEnd,
  };
})(window);
