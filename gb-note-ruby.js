/* gb-note-ruby.js — ノート本文のルビ機能。
 *
 * 旧実装はシナリオと別系統で、
 *   - 文字を選ぶと出る書式設定ポップアップ（シナリオと共通）にはルビ欄が生えない
 *   - 右クリック/Alt+↓ でだけ開く専用ポップアップが別にある
 *   - ルビ適用のあとスクロールが動く（focus にスクロール抑止が無い）
 *   - ルビ span の端で入力すると、その文字までルビ対象へ取り込まれる
 * という状態だった。ここに適用処理と入口をまとめ、書式設定ポップアップ側
 * （gb-text-selection-format.js）からも同じ関数を呼べるようにする。
 *
 * 境界の制御は gb-ruby-boundary.js（シナリオと共通）へ委譲する。
 */
(function (global) {
  'use strict';

  // ルビを扱う編集ホスト（本文・エントリの自由記述・詳細パネル内ノート・ボードのノート）
  var NOTE_RUBY_EDITABLES = '#page-content, #entity-freetext, #dp-editable, #board-note-editable';

  // ルビ記法 {親文字|ルビ} で往復できる文字かどうか。
  // 読み込み側（mdToHtml）はルビ部分の文字種を絞っており、書き出し側は絞っていないため、
  // 対象外の文字を許すと「保存 → 再読込でルビが消え、{...} が本文に出てしまう」片道の欠落になる。
  // 文字クラスは gb-editor.part03.part01.js の mdToHtml 側と同一（ひらがな・カタカナ・
  // 漢字・英数字・長音・々〆〇・空白）。片方だけ変えると往復できなくなるため揃えて保つ。
  var RUBY_READING_RE = /^[぀-ゟ゠-ヿ一-鿿㐀-䶿a-zA-Z0-9ー々〆〇\s]+$/;

  function canRoundTrip(baseText, rubyText) {
    var base = String(baseText == null ? '' : baseText);
    var ruby = String(rubyText == null ? '' : rubyText);
    if (!ruby) return { ok: false, reason: 'ルビが空です' };
    if (!RUBY_READING_RE.test(ruby)) {
      return { ok: false, reason: 'ルビにはひらがな・カタカナ・漢字・英数字だけ使えます' };
    }
    if (/[{}|]/.test(base)) {
      return { ok: false, reason: '{ } | を含む文字列にはルビを振れません' };
    }
    return { ok: true };
  }

  // --- スクロール位置の退避・復元 -------------------------------------------
  // 本文を作り直す処理（取り消し・リンクの再適用・保存後の再描画）で位置が飛ばないようにする。
  // 縦書きの単独アプリでは実際にスクロールするのが編集ホストの外側になるため、祖先まで見る。
  function captureScroll(el) {
    var list = [];
    for (var n = el; n && n !== document.body && n.nodeType === 1; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight || n.scrollWidth > n.clientWidth) {
        list.push({ el: n, top: n.scrollTop, left: n.scrollLeft });
      }
    }
    return list;
  }

  function restoreScroll(list) {
    (list || []).forEach(function (s) {
      if (!s.el || !s.el.isConnected) return;
      s.el.scrollTop = s.top;
      s.el.scrollLeft = s.left;
    });
  }

  function focusWithoutScroll(el) {
    if (!el || typeof el.focus !== 'function') return;
    try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (__) { /* 失われたノード */ } }
  }

  function selectedRubySpan(range, editable) {
    if (!range || !editable) return null;
    var start = range.startContainer && range.startContainer.nodeType === 1
      ? range.startContainer
      : range.startContainer && range.startContainer.parentElement;
    var end = range.endContainer && range.endContainer.nodeType === 1
      ? range.endContainer
      : range.endContainer && range.endContainer.parentElement;
    var startSpan = start && start.closest ? start.closest('[data-ruby]') : null;
    var endSpan = end && end.closest ? end.closest('[data-ruby]') : null;
    if (!startSpan || startSpan !== endSpan || !editable.contains(startSpan)) return null;
    return range.toString().trim() === String(startSpan.textContent || '').trim() ? startSpan : null;
  }

  // --- ルビの適用 -----------------------------------------------------------
  // シナリオの _applyRubyToSelection と同じく、本文を作り直さず DOM を直接書き換える。
  // 再描画を挟まないのでスクロール位置もキャレットも動かない。
  function applyToSelection(range, editable, ruby) {
    if (!range || !editable) return false;
    var text = range.toString();
    if (!text) return false;
    var reading = String(ruby || '').trim();
    var check = canRoundTrip(text, reading);
    if (!check.ok) {
      if (typeof global.showStatus === 'function') global.showStatus(check.reason, true);
      return false;
    }

    var scroll = captureScroll(editable);
    focusWithoutScroll(editable);
    var sel = global.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (typeof global._pushCustomUndo === 'function') global._pushCustomUndo(editable);

    var span = selectedRubySpan(range, editable);

    if (span) {
      span.dataset.ruby = reading;
    } else {
      span = document.createElement('span');
      span.dataset.ruby = reading;
      span.style.position = 'relative';
      span.textContent = text;
      range.deleteContents();
      range.insertNode(span);
    }
    // 前後に空テキストノードが分かれたままだとキャレットが span 内へ吸われやすい
    if (span.parentNode && span.parentNode.normalize) span.parentNode.normalize();

    // キャレットは span の外側（直後）へ。境界処理（gb-ruby-boundary.js）と組で
    // 「直後に打った文字がルビに含まれない」状態にする。
    var boundary = global.MeldexRubyBoundary;
    if (boundary && typeof boundary.rangeOutside === 'function') {
      boundary.rangeOutside(span, 'end');
    } else {
      var r2 = document.createRange();
      r2.setStartAfter(span);
      r2.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r2);
    }

    editable.dispatchEvent(new Event('input', { bubbles: true }));
    restoreScroll(scroll);
    if (typeof global.showStatus === 'function') global.showStatus('ルビを設定しました');
    return true;
  }

  // --- 入口 -----------------------------------------------------------------
  // 書式設定とは別の専用ポップアップを開く。
  function insertRuby(editable, range) {
    if (!editable || !range) return;
    var gts = global.GBTextSelectionFormat;
    if (gts && typeof gts.suppressFor === 'function') gts.suppressFor(1200);
    else if (gts && typeof gts.close === 'function') gts.close();
    focusWithoutScroll(editable);
    var sel = global.getSelection();
    sel.removeAllRanges();
    sel.addRange(range.cloneRange());
    showLegacyPopup(editable, range);
  }

  // ノート専用のルビ編集ポップアップ。
  function showLegacyPopup(editable, range) {
    if (!editable || !range) return;
    document.querySelectorAll('.note-ruby-popup').forEach(function (el) { el.remove(); });
    var text = range.toString();
    if (!text) return;
    var existingRuby = selectedRubySpan(range, editable);
    var popup = document.createElement('div');
    popup.className = 'gb-context-menu note-ruby-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'ノート本文にルビを設定');
    var label = document.createElement('div');
    label.className = 'note-ruby-popup-label';
    label.textContent = '「' + text.slice(0, 20) + '」のルビを' + (existingRuby ? '編集' : '設定');
    var row = document.createElement('div');
    row.className = 'note-ruby-popup-row';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'gb-input note-ruby-input';
    input.placeholder = 'ルビを入力...';
    input.value = existingRuby ? String(existingRuby.dataset.ruby || '') : '';
    input.setAttribute('aria-label', 'ノート本文のルビ');
    input.dataset.e2eId = 'note-ruby-input';
    // 開くと同時に自動フォーカスされるため、フォーカス由来のツールチップは出さない
    input.setAttribute('data-gb-tooltip-disabled', 'true');
    var applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.className = 'gb-btn gb-btn-sm gb-btn-primary note-ruby-ok';
    applyButton.dataset.e2eId = 'note-ruby-apply';
    applyButton.textContent = existingRuby ? '更新' : '設定';
    row.append(input, applyButton);
    popup.append(label, row);
    popup.addEventListener('mousedown', function (ev) { if (ev.target.tagName !== 'INPUT') ev.preventDefault(); });
    document.body.appendChild(popup);
    if (typeof global._positionEditorPopup === 'function') {
      global._positionEditorPopup(popup, range.getBoundingClientRect());
    }
    var closeHandler = null;
    var keyHandler = null;
    var cleanup = function () {
      if (closeHandler) document.removeEventListener('pointerdown', closeHandler, true);
      if (keyHandler) global.removeEventListener('keydown', keyHandler, true);
      closeHandler = null;
      keyHandler = null;
    };
    var closePopup = function (restoreFocusEl) {
      var formatUi = global.GBTextSelectionFormat;
      if (formatUi && typeof formatUi.suppressFor === 'function') formatUi.suppressFor(800);
      if (typeof global._closeEditorPopup === 'function') global._closeEditorPopup(popup, cleanup, restoreFocusEl);
      else { cleanup(); popup.remove(); }
    };
    var apply = function () {
      var ruby = input.value.trim();
      closePopup();
      if (!ruby) return;
      applyToSelection(range, editable, ruby);
    };
    applyButton.addEventListener('click', apply);
    input.addEventListener('keydown', function (ev) {
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === 'Enter') { ev.preventDefault(); apply(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closePopup(editable); }
      ev.stopPropagation();
    });
    closeHandler = function onPointerDown(ev) {
      if (!popup.contains(ev.target)) closePopup(editable);
    };
    keyHandler = function onKeyDown(ev) {
      // Tab / Shift+Tab はポップアップ内の項目切り替え（ルビ設定ポップアップ共通挙動）
      if (ev.key === 'Tab') {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof global.gbCyclePopupFocus === 'function') global.gbCyclePopupFocus(popup, ev.shiftKey);
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closePopup(editable);
      }
    };
    setTimeout(function () {
      document.addEventListener('pointerdown', closeHandler, true);
      global.addEventListener('keydown', keyHandler, true);
      try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
    }, 0);
  }

  // --- 境界処理の配線 -------------------------------------------------------
  function attachBoundary(host) {
    var boundary = global.MeldexRubyBoundary;
    if (!boundary || !host) return;
    boundary.attach(host, {
      pushUndo: function (el) {
        if (typeof global._pushCustomUndo === 'function') global._pushCustomUndo(el);
      },
    });
  }

  function attachBoundaryToAll(root) {
    var scope = root || document;
    if (!scope.querySelectorAll) return;
    scope.querySelectorAll(NOTE_RUBY_EDITABLES).forEach(attachBoundary);
  }

  function init() {
    attachBoundaryToAll(document);
    // 詳細パネル内ノートやクラウドのスマホ編集UIは後から作られる。DOM全体を監視すると
    // 入力のたびに走って重いので、編集ホストがフォーカスを受けた時に一度だけ配線する
    // （attach 側が二重登録を弾く）。
    document.addEventListener('focusin', function (e) {
      var host = e.target && e.target.closest ? e.target.closest(NOTE_RUBY_EDITABLES) : null;
      if (host) attachBoundary(host);
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.MeldexNoteRuby = {
    NOTE_RUBY_EDITABLES: NOTE_RUBY_EDITABLES,
    canRoundTrip: canRoundTrip,
    applyToSelection: applyToSelection,
    insertRuby: insertRuby,
    showLegacyPopup: showLegacyPopup,
    captureScroll: captureScroll,
    restoreScroll: restoreScroll,
    focusWithoutScroll: focusWithoutScroll,
    selectedRubySpan: selectedRubySpan,
    attachBoundary: attachBoundary,
  };

  // 後方互換: 既存の呼び出し（右クリックメニュー等）が直接この名前を呼んでいる
  global.showNoteRubyPopup = showLegacyPopup;
})(typeof window !== 'undefined' ? window : globalThis);
