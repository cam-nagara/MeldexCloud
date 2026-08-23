/* gb-cal-toolbar-overflow.js: スケジュールツールバーの操作グループを、ツールバー自身の
 * 実測幅に応じて優先ボタン＋あふれメニューへ畳む。
 *
 * 背景（狭幅ツールバー未対応の残作業）: .gb-cal-toolbar-actions は十数個のアイコン
 * ボタンと区切り線を並べるが、折返し（.gb-toolbar-cal の flex-wrap）で自分の行へ
 * 落ちるだけで、行自体の幅がツールバーより狭くなると操作グループごとツールバー右端の
 * 外側へはみ出し、操作が届かなくなっていた。単独アプリ（standalone-mobile-toolbar.js）
 * が使う「優先ボタン＋あふれメニュー」と同じ考え方を、ビューポート幅のメディアクエリ
 * ではなくツールバー自身の実測幅（ResizeObserver）で判定する形で適用する
 * （ウィンドウは変わらずオプションパネルの分割等でツールバー自体が狭くなるケースにも
 *   対応するため。単独アプリ側の判定方式はそのまま流用しない＝別モジュールとする）。
 *
 * 44px未満へのボタン縮小はしない（タップ領域の既定ルール）。入りきらない分は表示
 * サイズを変えず、区切り線ごと畳んだうえで丸ごと「その他」メニューへ移す。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // 優先順位（数字が小さいほど狭幅でも残す）。表に無い data-cal-action は最初に畳む。
  const RANK = {
    detail: 0, productionManagement: 1, recalculate: 2,
    undo: 3, redo: 3, sync: 4,
    bulkCreateTasks: 5, sheetFilter: 6, reload: 7, sheetSort: 8,
    template: 9, sheetAutoFit: 10, sheetColumnDisplayOrder: 11, timer: 12,
  };

  const registry = new Map(); // toolbar要素 -> entry

  function _zoom() {
    return typeof window._getZoom === 'function' ? (window._getZoom() || 1) : 1;
  }

  function _isSep(el) { return el.classList.contains('sep'); }

  function _rankFor(el) {
    const action = el.dataset ? (el.dataset.calAction || '') : '';
    return Object.prototype.hasOwnProperty.call(RANK, action) ? RANK[action] : 99;
  }

  function _labelFor(el) {
    const aria = String(el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const title = String(el.getAttribute('title') || '').trim();
    return title || String(el.textContent || '').trim() || '操作';
  }

  function _iconHtmlFor(el) {
    const svg = el.querySelector('svg');
    if (svg) return svg.outerHTML;
    const ico = el.querySelector('.ico');
    return ico ? ico.outerHTML : '';
  }

  function _sumWidth(list, widthOf, gap) {
    if (!list.length) return 0;
    return list.reduce((sum, el) => sum + widthOf.get(el), 0) + gap * (list.length - 1);
  }

  function _createMoreButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tb-icon-btn gb-cto-more-btn';
    btn.title = 'その他の操作';
    btn.setAttribute('aria-label', 'その他の操作');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.dataset.e2eId = 'gb-cal-toolbar-actions-more';
    btn.hidden = true;
    if (typeof lucide === 'function') btn.innerHTML = lucide('moreHorizontal', 16);
    return btn;
  }

  function _closeMenu(entry) {
    entry.menu?.remove();
    entry.menu = null;
    if (entry.menuKeydown) { document.removeEventListener('keydown', entry.menuKeydown); entry.menuKeydown = null; }
    if (entry.menuDismiss) { document.removeEventListener('pointerdown', entry.menuDismiss); entry.menuDismiss = null; }
    entry.moreBtn.setAttribute('aria-expanded', 'false');
  }

  // あふれた元ボタンは display:none のままなので、代理クリックの瞬間だけ実レイアウトを
  // 持たせる。並び替えメニュー等はクリックハンドラ内で anchor.getBoundingClientRect() を
  // 同期的に読んで位置決めする（gb-tool-calendar-production-task-view.part03.js の
  // _runProductionSheetDisplayAction 等）ため、非表示のままだと (0,0) 相当の矩形しか
  // 取れずポップアップが左上へ張り付く（standalone-mobile-toolbar.js と同じ手当て）。
  function _activateOverflowItem(entry, el, rowRect) {
    if (el.disabled) return;
    _closeMenu(entry);
    const prevStyle = el.getAttribute('style');
    const set = (prop, value) => el.style.setProperty(prop, value, 'important');
    set('display', 'inline-flex');
    set('position', 'fixed');
    set('left', Math.max(0, rowRect.left) + 'px');
    set('top', Math.max(0, rowRect.top) + 'px');
    set('width', (rowRect.width || 22) + 'px');
    set('height', (rowRect.height || 22) + 'px');
    set('margin', '0');
    set('visibility', 'hidden');
    set('pointer-events', 'none');
    set('z-index', '-1');
    try { el.click(); }
    finally {
      if (prevStyle === null) el.removeAttribute('style');
      else el.setAttribute('style', prevStyle);
    }
    entry.moreBtn.focus?.({ preventScroll: true });
  }

  function _openMenu(entry) {
    if (entry.menu) { _closeMenu(entry); return; }
    const items = entry.overflowItems || [];
    if (!items.length) return;
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu gb-cal-toolbar-overflow-menu';
    menu.dataset.e2eId = 'gb-cal-toolbar-actions-overflow-menu';
    menu.setAttribute('role', 'menu');
    items.forEach(el => {
      const row = document.createElement('div');
      row.className = 'gb-context-menu-item' + (el.disabled ? ' disabled' : '');
      row.setAttribute('role', 'menuitem');
      if (el.dataset?.e2eId) row.dataset.e2eId = 'gb-cal-toolbar-overflow-' + el.dataset.e2eId;
      row.innerHTML = _iconHtmlFor(el) + ' ';
      row.appendChild(document.createTextNode(_labelFor(el)));
      if (el.disabled) row.setAttribute('aria-disabled', 'true');
      else row.addEventListener('click', () => _activateOverflowItem(entry, el, row.getBoundingClientRect()));
      menu.appendChild(row);
    });
    entry.menu = menu;
    if (typeof window.positionPopup === 'function') {
      window.positionPopup(menu, entry.moreBtn.getBoundingClientRect());
    } else {
      document.body.appendChild(menu);
      window.clampPopupToViewport?.(menu);
    }
    entry.moreBtn.setAttribute('aria-expanded', 'true');
    entry.menuDismiss = event => {
      if (!menu.contains(event.target) && event.target !== entry.moreBtn) _closeMenu(entry);
    };
    entry.menuKeydown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      _closeMenu(entry);
      entry.moreBtn.focus?.();
    };
    setTimeout(() => {
      document.addEventListener('pointerdown', entry.menuDismiss);
      document.addEventListener('keydown', entry.menuKeydown);
    }, 0);
  }

  function _classify(children) {
    const seps = []; const mandatory = []; const collapsible = [];
    children.forEach(el => {
      if (_isSep(el)) { seps.push(el); return; }
      // ボタン以外（スケジューラーが差し込む表示案セレクタ等）は畳まない。
      // アクションではなく現在の文脈を示す要素のため、あふれメニューの選択肢にしない。
      if (el.tagName !== 'BUTTON') { mandatory.push(el); return; }
      collapsible.push(el);
    });
    return { seps, mandatory, collapsible };
  }

  function _availableWidth(toolbar) {
    const z = _zoom();
    const style = window.getComputedStyle(toolbar);
    const paddingLeft = (parseFloat(style.paddingLeft) || 0) * z;
    const paddingRight = (parseFloat(style.paddingRight) || 0) * z;
    return Math.max(0, toolbar.getBoundingClientRect().width - paddingLeft - paddingRight);
  }

  function _recompute(entry) {
    const { toolbar, group, moreBtn } = entry;
    if (!toolbar.isConnected || !group.isConnected) return;
    _closeMenu(entry); // 判定をやり直すので、開いていたメニューは作り直す
    const children = Array.from(group.children).filter(el => el !== moreBtn);
    // 前回の折り畳み状態をいったんリセットし、自然な幅を測れる状態に戻す。
    children.forEach(el => el.style.removeProperty('display'));
    moreBtn.hidden = false;

    const available = _availableWidth(toolbar);
    const groupStyle = window.getComputedStyle(group);
    const gap = (parseFloat(groupStyle.columnGap || groupStyle.gap) || 0) * _zoom();
    const moreBtnWidth = moreBtn.getBoundingClientRect().width;

    const { seps, mandatory, collapsible } = _classify(children);
    const widthOf = new Map();
    children.forEach(el => widthOf.set(el, el.getBoundingClientRect().width));

    if (_sumWidth([...seps, ...mandatory, ...collapsible], widthOf, gap) <= available + 1) {
      moreBtn.hidden = true;
      entry.overflowItems = [];
      return;
    }

    // まず区切り線を畳む（操作ではないため、あふれメニューの項目にはしない）。
    seps.forEach(el => el.style.setProperty('display', 'none', 'important'));
    if (_sumWidth([...mandatory, ...collapsible], widthOf, gap) <= available + 1) {
      moreBtn.hidden = true;
      entry.overflowItems = [];
      return;
    }

    // 「その他」ボタン分を確保したうえで、優先順位の高い操作から入るだけ表示する。
    const budget = available - moreBtnWidth - gap;
    let used = _sumWidth(mandatory, widthOf, gap);
    let visibleCount = mandatory.length;
    const ordered = collapsible.slice().sort((a, b) => _rankFor(a) - _rankFor(b));
    const shown = new Set();
    for (const el of ordered) {
      const addGap = visibleCount > 0 ? gap : 0;
      const w = widthOf.get(el);
      if (used + addGap + w > budget) break; // 優先順位順の先着で確定させる
      used += addGap + w;
      visibleCount += 1;
      shown.add(el);
    }
    collapsible.forEach(el => {
      if (shown.has(el)) el.style.removeProperty('display');
      else el.style.setProperty('display', 'none', 'important');
    });
    entry.overflowItems = collapsible.filter(el => !shown.has(el));
    moreBtn.hidden = entry.overflowItems.length === 0;
  }

  // ResizeObserver/MutationObserverのコールバックはレイアウト確定後（ペイント直前）に
  // 走るため、requestAnimationFrame越しに遅延させる必要はない。実測でも、ペインが
  // 表示されずコンポジット（画面合成）が起きていない環境ではrAF自体が発火しないことが
  // あり、その場合はいつまで待っても畳み込みが反映されなかった。ResizeObserverの
  // コールバック内で直接再計算する。
  function _requestRecompute(entry) {
    _recompute(entry);
  }

  function setup(rootEl) {
    if (!rootEl) return null;
    const toolbar = rootEl.querySelector('.gb-toolbar-cal');
    const group = toolbar?.querySelector('.gb-cal-toolbar-actions');
    if (!toolbar || !group) return null;
    if (registry.has(toolbar)) return registry.get(toolbar);

    const moreBtn = _createMoreButton();
    group.appendChild(moreBtn);

    const entry = {
      toolbar, group, moreBtn, overflowItems: [],
      menu: null, menuDismiss: null, menuKeydown: null,
    };
    registry.set(toolbar, entry);
    moreBtn.addEventListener('click', () => _openMenu(entry));

    const resizeObserver = new ResizeObserver(() => _requestRecompute(entry));
    resizeObserver.observe(toolbar);
    entry.resizeObserver = resizeObserver;

    // サーフェス切替（カレンダー/タスクリスト）は data-cal-surface 属性で表示ボタン群が
    // 入れ替わるが、ツールバー自身の幅が変わるとは限らずResizeObserverが発火しない
    // ことがあるため、属性変化と操作グループへの子要素追加（スケジューラーが差し込む
    // 表示案セレクタ等）も監視して再判定する。
    const mutationObserver = new MutationObserver(() => _requestRecompute(entry));
    mutationObserver.observe(rootEl, { attributes: true, attributeFilter: ['data-cal-surface'] });
    mutationObserver.observe(group, { childList: true });
    entry.mutationObserver = mutationObserver;

    _requestRecompute(entry);
    return entry;
  }

  function refresh(rootEl) {
    const toolbar = (rootEl?.querySelector?.('.gb-toolbar-cal')) || rootEl;
    const entry = toolbar && registry.get(toolbar);
    if (entry) _requestRecompute(entry);
  }

  function teardown(rootEl) {
    const toolbar = rootEl?.querySelector?.('.gb-toolbar-cal');
    const entry = toolbar && registry.get(toolbar);
    if (!entry) return;
    _closeMenu(entry);
    entry.resizeObserver?.disconnect();
    entry.mutationObserver?.disconnect();
    registry.delete(toolbar);
  }

  window.MeldexCalToolbarOverflow = { setup, refresh, teardown };
})();
