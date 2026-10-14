/* gb-note-writing-mode.js — ノート本文の組方向（縦書き/横書き）の正本。
 *
 * 目的:
 *  1. 「今が縦書きかどうか」と「縦書きのときブロック軸/インライン軸がどの物理方向か」を
 *     この1ファイルに集約する。ノート側で座標比較・矩形比較を書くときは必ず axis() を経由する。
 *     横書きでは blockCoord=pt.y / blockStart=rect.top / blockEnd=rect.bottom / blockSign=+1 に
 *     なるため、既存の物理座標ベースの式と数値が完全に一致する（横書きの挙動は不変）。
 *  2. 組方向を切り替えるときに触るUI（本文クラス、目次レイアウト、ツールバーボタン、
 *     セパレータのARIA、保存）を applyState() 1箇所へまとめる。新しく組方向へ追従したいUIが
 *     増えても、ここか meldex:note-writing-mode-changed の購読側に足すだけで済む。
 *
 * 本体（Meldex.html）とクラウド単独ノートアプリ（note-standalone.html）の両方から読み込む。
 * どちらも本文は <... id="page-content"> なので同じ実装で動く。
 */
(function (global) {
  'use strict';

  var VERTICAL_CLASS = 'vertical-writing';
  var BODY_VERTICAL_CLASS = 'is-note-vertical';
  var STORAGE_KEY = 'note-vertical';
  var INLINE_SIZE_VAR = '--note-avail-inline';
  var CHANGE_EVENT = 'meldex:note-writing-mode-changed';

  function _pageContent() {
    return document.getElementById('page-content');
  }

  function isVertical(editable) {
    var el = editable || _pageContent();
    return !!(el && el.classList && el.classList.contains(VERTICAL_CLASS));
  }

  function isActive() {
    return isVertical(null);
  }

  /* ---------------- 軸オラクル ---------------- */

  // block軸 = 行が積み重なる方向 / inline軸 = 行が伸びる方向
  // 横書き(horizontal-tb): block=上→下（+Y）、inline=左→右（+X）
  // 縦書き(vertical-rl):   block=右→左（-X）、inline=上→下（+Y）
  var _AXIS_BASE = {
    horizontal: {
      vertical: false,
      blockCoord: function (pt) { return pt.y; },
      blockStart: function (r) { return r.top; },
      blockEnd: function (r) { return r.bottom; },
      blockSize: function (r) { return r.height; },
      blockSign: 1,
      inlineCoord: function (pt) { return pt.x; },
      inlineStart: function (r) { return r.left; },
      inlineEnd: function (r) { return r.right; },
      inlineSize: function (r) { return r.width; },
      inlineSign: 1,
    },
    vertical: {
      vertical: true,
      blockCoord: function (pt) { return pt.x; },
      blockStart: function (r) { return r.right; },
      blockEnd: function (r) { return r.left; },
      blockSize: function (r) { return r.width; },
      blockSign: -1,
      inlineCoord: function (pt) { return pt.y; },
      inlineStart: function (r) { return r.top; },
      inlineEnd: function (r) { return r.bottom; },
      inlineSize: function (r) { return r.height; },
      inlineSign: 1,
    },
  };

  // 座標入力の正規化。数値は旧シグネチャ（clientY）との後方互換で、横書きの block 座標として扱う。
  function toPoint(input) {
    if (input == null) return { x: NaN, y: NaN };
    if (typeof input === 'number') return { x: NaN, y: input };
    var x = (input.clientX != null) ? input.clientX : input.x;
    var y = (input.clientY != null) ? input.clientY : input.y;
    return { x: Number(x), y: Number(y) };
  }

  function _buildAxis(base) {
    var axis = Object.create(null);
    for (var key in base) {
      if (Object.prototype.hasOwnProperty.call(base, key)) axis[key] = base[key];
    }
    axis.toPoint = toPoint;
    // pt が rect の「文書順で前半」にあるか（横書き=中点より上 / 縦書きrl=中点より右）
    axis.isBefore = function (rect, input) {
      var pt = toPoint(input);
      var mid = (base.blockStart(rect) + base.blockEnd(rect)) / 2;
      var c = base.blockCoord(pt);
      return base.blockSign > 0 ? c < mid : c > mid;
    };
    // block軸上での rect と pt の距離（内側なら0）
    axis.distanceTo = function (rect, input) {
      var pt = toPoint(input);
      var c = base.blockCoord(pt);
      var a = base.blockStart(rect);
      var b = base.blockEnd(rect);
      var lo = Math.min(a, b);
      var hi = Math.max(a, b);
      if (!isFinite(c)) return Infinity;
      if (c < lo) return lo - c;
      if (c > hi) return c - hi;
      return 0;
    };
    // pt が rect の block 範囲に入っているか
    axis.containsBlock = function (rect, input) {
      var pt = toPoint(input);
      var c = base.blockCoord(pt);
      if (!isFinite(c)) return false;
      var a = base.blockStart(rect);
      var b = base.blockEnd(rect);
      var lo = Math.min(a, b);
      var hi = Math.max(lo + 1, Math.max(a, b));
      return c >= lo && c < hi;
    };
    return axis;
  }

  var HORIZONTAL_AXIS = _buildAxis(_AXIS_BASE.horizontal);
  var VERTICAL_AXIS = _buildAxis(_AXIS_BASE.vertical);

  function axis(editable) {
    return isVertical(editable) ? VERTICAL_AXIS : HORIZONTAL_AXIS;
  }

  /* ---------------- 縦書き時の利用可能インラインサイズ ---------------- */
  // 縦書きでは padding のパーセンテージが「親の横幅」に解決されてしまうため、
  // 内容最大幅によるセンタリング（--page-content-max-width）が誤った軸で効く。
  // border-box のインラインサイズ（縦書きでは高さ）を CSS 変数へ流し、縦書きCSSがそれを使う。
  // border-box を観測するのでパディング変化には反応せず、観測ループにならない。
  var _inlineSizeObserver = null;
  var _observedEl = null;

  function _writeInlineSize(el, size) {
    if (!el || !isFinite(size) || size <= 0) return;
    el.style.setProperty(INLINE_SIZE_VAR, Math.round(size) + 'px');
  }

  function observeInlineSize(el) {
    var target = el || _pageContent();
    if (!target || typeof ResizeObserver !== 'function') return;
    if (_observedEl === target && _inlineSizeObserver) return;
    unobserveInlineSize();
    _observedEl = target;
    _inlineSizeObserver = new ResizeObserver(function (entries) {
      var entry = entries && entries[0];
      if (!entry) return;
      var box = entry.borderBoxSize && entry.borderBoxSize[0];
      // borderBoxSize は観測要素の writing-mode 基準なので、縦書きでは inlineSize = 高さ。
      var size = box ? box.inlineSize : (entry.contentRect ? entry.contentRect.height : 0);
      _writeInlineSize(target, size);
    });
    _inlineSizeObserver.observe(target);
    // 初回は同期的にも入れておく（ResizeObserver の初回通知を待たない）
    var rect = target.getBoundingClientRect();
    _writeInlineSize(target, rect.height);
  }

  function unobserveInlineSize() {
    if (_inlineSizeObserver) {
      try { _inlineSizeObserver.disconnect(); } catch (_) { /* 破棄済み */ }
    }
    _inlineSizeObserver = null;
    if (_observedEl) _observedEl.style.removeProperty(INLINE_SIZE_VAR);
    _observedEl = null;
  }

  /* ---------------- 状態遷移（唯一の入口） ---------------- */

  function _syncToolbarButton(vertical) {
    var btn = document.getElementById('btn-note-vertical');
    if (!btn) return;
    // アイコンは「クリック後の動作」を示す: 横書き中→kanban（縦書きにする）、縦書き中→textAlignStart（横書きに戻す）
    var iconName = vertical ? 'textAlignStart' : 'kanban';
    btn.innerHTML = (typeof lucide === 'function')
      ? lucide(iconName, 16)
      : '<span class="ico ico-' + iconName + '"></span>';
    btn.title = vertical ? '横書きに戻す' : '縦書きにする';
    btn.classList.toggle('active', vertical);
  }

  function _syncTocSeparator(vertical) {
    var handle = document.getElementById('note-toc-resize');
    if (!handle) return;
    // 横書き側の文字列は既存契約（E2E が厳密一致で検証）なので変更しない
    handle.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
    handle.setAttribute('aria-label', vertical ? '目次の高さを調整' : '目次幅を調整');
    handle.title = vertical ? '目次の高さを調整' : '目次幅を調整';
  }

  function applyState(vertical, options) {
    var opts = options || {};
    var persist = opts.persist !== false;
    var v = !!vertical;
    var pc = opts.editable || _pageContent();
    if (pc) {
      pc.classList.toggle(VERTICAL_CLASS, v);
      var body = pc.closest ? pc.closest('.note-editor-body') : null;
      if (body) body.classList.toggle(BODY_VERTICAL_CLASS, v);
      if (v) observeInlineSize(pc);
      else unobserveInlineSize();
    }
    _syncToolbarButton(v);
    _syncTocSeparator(v);
    if (typeof global.syncNoteTocLayout === 'function') global.syncNoteTocLayout();
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, v ? '1' : ''); } catch (_) { /* 保存不可環境 */ }
    }
    try {
      document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { vertical: v } }));
    } catch (_) { /* CustomEvent 非対応環境 */ }
    return v;
  }

  function toggle(options) {
    return applyState(!isActive(), options);
  }

  function restoreFromStorage() {
    var saved = '';
    try { saved = localStorage.getItem(STORAGE_KEY) || ''; } catch (_) { saved = ''; }
    return applyState(saved === '1', { persist: false });
  }

  /* ---------------- ポップアップの出る向き ---------------- */
  // 縦書きでは「下」に出すと続きの本文を隠すため、行の進行方向と直交する側（左）へ寄せる。
  function popupPrefer(editable) {
    return isVertical(editable) ? 'left' : 'below';
  }

  global.MeldexNoteWritingMode = {
    VERTICAL_CLASS: VERTICAL_CLASS,
    BODY_VERTICAL_CLASS: BODY_VERTICAL_CLASS,
    STORAGE_KEY: STORAGE_KEY,
    CHANGE_EVENT: CHANGE_EVENT,
    isVertical: isVertical,
    isActive: isActive,
    axis: axis,
    toPoint: toPoint,
    applyState: applyState,
    toggle: toggle,
    restoreFromStorage: restoreFromStorage,
    popupPrefer: popupPrefer,
    observeInlineSize: observeInlineSize,
    unobserveInlineSize: unobserveInlineSize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
