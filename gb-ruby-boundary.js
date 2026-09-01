/* gb-ruby-boundary.js — ルビを振った文字列の「境界」を守る共通処理（ノート／シナリオ共用）。
 *
 * 直したい挙動:
 *   ルビ span の直前・直後にキャレットがある状態で文字を打つ・貼り付ける・変換すると、
 *   入力した文字までルビの対象文字列に取り込まれてしまう。
 *
 * 原因:
 *   キャレットを span の外側（親ノード内のインデックス位置）に置いても、ブラウザは
 *   「最も深い等価位置」＝span の内側の端へ正規化する。span の隣に通常のテキストノードが
 *   無いとき（ブロックの先頭/末尾、インライン要素どうしが隣り合う場合）に起きる。
 *
 * 方針:
 *   beforeinput を主軸に、入力を span の外側へ逃がす。日本語入力（IME）は beforeinput を
 *   止められないため、変換開始の時点で span の外側へ一時的な置き場（ゼロ幅スペース）を作って
 *   キャレットを移し、変換確定でその置き場をたたむ。
 *   ゼロ幅スペースを常設する方式は採らない（本文のテキストに混ざり、検索・置換や
 *   目次・アノテートの位置計算へ波及するため）。
 */
(function (global) {
  'use strict';

  var ZWSP = '​';
  var INSERT_TYPES = {
    insertText: true,
    insertFromPaste: true,
    insertFromPasteAsQuotation: true,
    insertFromDrop: true,
    insertFromYank: true,
    insertReplacementText: true,
  };

  function _currentRange() {
    var sel = (global.getSelection && global.getSelection()) || null;
    if (!sel || !sel.rangeCount) return null;
    return sel.getRangeAt(0);
  }

  function _rubyAncestor(node) {
    var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    return el && el.closest ? el.closest('[data-ruby]') : null;
  }

  function _firstTextIn(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    return walker.nextNode();
  }

  function _lastTextIn(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var last = null, n;
    while ((n = walker.nextNode())) last = n;
    return last;
  }

  // 折り畳みキャレットがルビ span の端にあるかを返す。
  //   { span, side: 'start' | 'end' } | null
  function edgeAt(range) {
    var r = range || _currentRange();
    if (!r || !r.collapsed) return null;
    var c = r.startContainer;
    var o = r.startOffset;
    if (!c) return null;

    if (c.nodeType === 3) {
      var span = _rubyAncestor(c);
      if (!span) return null;
      if (o === 0 && _firstTextIn(span) === c) return { span: span, side: 'start' };
      if (o === c.length && _lastTextIn(span) === c) return { span: span, side: 'end' };
      return null;
    }

    if (c.nodeType === 1) {
      var inner = c.closest ? c.closest('[data-ruby]') : null;
      if (inner) {
        if (o === 0) return { span: inner, side: 'start' };
        if (o === c.childNodes.length) return { span: inner, side: 'end' };
        return null;
      }
      var before = c.childNodes[o - 1];
      var after = c.childNodes[o];
      if (before && before.nodeType === 1 && before.matches && before.matches('[data-ruby]')) {
        return { span: before, side: 'end' };
      }
      if (after && after.nodeType === 1 && after.matches && after.matches('[data-ruby]')) {
        return { span: after, side: 'start' };
      }
    }
    return null;
  }

  function _setCaret(node, offset) {
    var sel = global.getSelection && global.getSelection();
    if (!sel) return;
    var r = document.createRange();
    r.setStart(node, Math.max(0, Math.min(offset, node.length != null ? node.length : node.childNodes.length)));
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // span の外側にキャレットを置く（隣にテキストノードが無ければ作る）。
  function rangeOutside(span, side) {
    var parent = span && span.parentNode;
    if (!parent) return null;
    var node;
    if (side === 'end') {
      node = span.nextSibling;
      if (!node || node.nodeType !== 3) {
        node = document.createTextNode('');
        parent.insertBefore(node, span.nextSibling);
      }
      _setCaret(node, 0);
    } else {
      node = span.previousSibling;
      if (!node || node.nodeType !== 3) {
        node = document.createTextNode('');
        parent.insertBefore(node, span);
      }
      _setCaret(node, node.length);
    }
    return _currentRange();
  }

  // span の外側へ文字列を挿入し、その直後へキャレットを置く。
  // 隣のテキストノードがあればそこへ足す（ノードを分けるとキャレット計算が壊れやすいため）。
  function insertTextOutside(span, side, text) {
    var parent = span && span.parentNode;
    if (!parent || !text) return false;
    var node, offset;
    if (side === 'end') {
      var next = span.nextSibling;
      if (next && next.nodeType === 3) { next.insertData(0, text); node = next; offset = text.length; }
      else { node = document.createTextNode(text); parent.insertBefore(node, span.nextSibling); offset = text.length; }
    } else {
      var prev = span.previousSibling;
      if (prev && prev.nodeType === 3) { var at = prev.length; prev.insertData(at, text); node = prev; offset = at + text.length; }
      else { node = document.createTextNode(text); parent.insertBefore(node, span); offset = text.length; }
    }
    _setCaret(node, offset);
    return true;
  }

  function _insertedTextOf(e) {
    if (typeof e.data === 'string' && e.data) return e.data;
    var dt = e.dataTransfer || (e.clipboardData || null);
    if (dt && typeof dt.getData === 'function') {
      try { return dt.getData('text/plain') || ''; } catch (_) { return ''; }
    }
    return '';
  }

  // 変換中の一時的な置き場を span の外側へ作る（IME 用）
  function _openCompositionAnchor(host) {
    var edge = edgeAt(null);
    if (!edge) return;
    var parent = edge.span.parentNode;
    if (!parent) return;
    var anchor = document.createTextNode(ZWSP);
    if (edge.side === 'end') {
      parent.insertBefore(anchor, edge.span.nextSibling);
      _setCaret(anchor, 1);
    } else {
      parent.insertBefore(anchor, edge.span);
      _setCaret(anchor, 0);
    }
    host._gbRubyAnchor = anchor;
  }

  function _closeCompositionAnchor(host) {
    var anchor = host._gbRubyAnchor;
    host._gbRubyAnchor = null;
    if (!anchor || !anchor.isConnected) return;
    var idx = anchor.data.indexOf(ZWSP);
    if (idx >= 0) {
      var r = _currentRange();
      var caretHere = r && r.startContainer === anchor;
      var caretOffset = caretHere ? r.startOffset : -1;
      anchor.deleteData(idx, 1);
      if (caretHere) _setCaret(anchor, caretOffset > idx ? caretOffset - 1 : caretOffset);
    }
    if (!anchor.data.length) anchor.remove();
  }

  // 残ってしまったゼロ幅スペースを掃除する（blur・保存前の保険）。
  function cleanup(host) {
    if (!host || !host.querySelectorAll) return;
    host._gbRubyAnchor = null;
    var walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    var targets = [];
    var n;
    while ((n = walker.nextNode())) {
      if (n.data.indexOf(ZWSP) >= 0) targets.push(n);
    }
    targets.forEach(function (node) {
      node.data = node.data.split(ZWSP).join('');
      if (!node.data.length && node.parentNode) node.parentNode.removeChild(node);
    });
  }

  /**
   * 編集ホストへ境界処理を登録する（冪等）。
   * options.pushUndo(host)    … 取り消し用のスナップショットを取る。
   *   beforeinput を preventDefault するとブラウザ標準の取り消しが切れるため、
   *   各アプリが持つ取り消し機構へ載せ替える。
   * options.dispatchInput(host) … 自動保存等のために input を発火させる。
   */
  function attach(host, options) {
    if (!host || host._gbRubyBoundaryAttached) return;
    host._gbRubyBoundaryAttached = true;
    var opts = options || {};

    host.addEventListener('beforeinput', function (e) {
      if (e.isComposing) return;
      if (!e.cancelable) return;
      if (!INSERT_TYPES[e.inputType]) return;
      var edge = edgeAt(null);
      if (!edge) return;
      var text = _insertedTextOf(e);
      if (!text) {
        // 改行など文字を伴わない挿入は、キャレットだけ外へ逃がして既定動作に任せる
        rangeOutside(edge.span, edge.side);
        return;
      }
      e.preventDefault();
      if (typeof opts.pushUndo === 'function') { try { opts.pushUndo(host); } catch (_) { /* 取り消し記録は任意 */ } }
      insertTextOutside(edge.span, edge.side, text);
      if (typeof opts.dispatchInput === 'function') opts.dispatchInput(host);
      else host.dispatchEvent(new Event('input', { bubbles: true }));
    });

    host.addEventListener('compositionstart', function () { _openCompositionAnchor(host); });
    host.addEventListener('compositionend', function () { _closeCompositionAnchor(host); });
    host.addEventListener('blur', function () { cleanup(host); });
  }

  global.MeldexRubyBoundary = {
    ZWSP: ZWSP,
    edgeAt: edgeAt,
    rangeOutside: rangeOutside,
    insertTextOutside: insertTextOutside,
    attach: attach,
    cleanup: cleanup,
  };
})(typeof window !== 'undefined' ? window : globalThis);
