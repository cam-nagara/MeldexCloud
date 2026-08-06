(function() {
  'use strict';

  // ダイアログ共通キーボード操作モジュール（Tab / Shift+Tab 循環フォーカス、
  // 矢印キーでのアクションボタン移動）。
  //
  // documentのcapture段階で最前面の可視ダイアログだけを処理する。依存なしの
  // 単独モジュール。Meldex本体・全Standaloneアプリのエントリーポイントへ個別に
  // <script> で読み込む（gb-modal-shell.js を読み込む画面はその直後）。
  //
  // 計画書: app/docs/subpanel-floatpanel-dialog-keyboard-plan_2026-07-31.md
  //   「ダイアログのキーボード操作」「ダイアログ共通基盤」節
  //
  // 対象: role="dialog" または role="alertdialog" かつ aria-modal="true" の
  // 可視ダイアログ。複数表示時はz-indexとDOM順から最前面の1つだけを処理する。
  //
  // 本モジュールが扱うのはTabキーと矢印キーのみ。Escape・Enter/Space・危険操作の
  // 初期フォーカス・閉じた後の呼び出し元へのフォーカス復帰は、各ダイアログの
  // 既存実装が引き続き担当する（本モジュールはそれらに干渉しない）。
  //
  // 個別ダイアログに既存のTab循環処理（bubble段階のkeydown等）がある場合、本
  // モジュールがcapture段階で先に処理しpreventDefault+stopPropagationするため、
  // 二重処理は起きない（旧実装は事実上呼ばれなくなる。削除は本計画の対象外）。

  const HANDLED_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

  // ダイアログ内の「フォーカス可能要素」（Tab循環の対象）
  const FOCUSABLE_SELECTOR = [
    'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea',
    'iframe', 'audio[controls]', 'video[controls]', 'summary',
    '[contenteditable="true"]', '[contenteditable=""]', '[tabindex]',
  ].join(', ');

  // アクション領域内で「ボタン」とみなす要素（矢印キー移動の対象）
  const ACTION_BUTTON_SELECTOR = [
    'button', '[role="button"]',
    'input[type="button"]', 'input[type="submit"]', 'input[type="reset"]',
    'a[href]',
  ].join(', ');

  // アクション領域の検出順（計画書どおり）:
  // ①共通フッター ②cfAlert/cfConfirm/cfPrompt系 ③汎用ボタン列 ④明示マーカー
  const ACTION_CONTAINER_SELECTORS = [
    '[data-modal-footer]',
    '.gb-confirm-actions',
    '.btn-row',
    '[data-dialog-actions]',
  ];

  // 矢印キーの本来の意味（キャレット移動・値変更・一覧内移動等）を奪ってはいけない要素。
  const NATIVE_ARROW_SELECTOR = [
    'input', 'textarea', 'select',
    '[contenteditable="true"]', '[contenteditable=""]',
    '[role="slider"]', '[role="spinbutton"]', '[role="combobox"]',
    '[role="listbox"]', '[role="menu"]', '[role="menuitem"]',
    '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
    '[role="tree"]', '[role="treeitem"]', '[role="grid"]', '[role="gridcell"]',
    '[role="table"]', '[role="row"]', '[role="cell"]',
    '[role="columnheader"]', '[role="rowheader"]',
    '[role="tab"]', '[role="tablist"]', '[role="radiogroup"]', '[role="option"]',
    '.CodeMirror', '.cm-editor', '.ProseMirror',
  ].join(', ');

  // Tabキー自体を独自消費するエディタ（インデント等）。矢印より狭い対象。
  // 通常の input/textarea/select は対象外（Tabで次要素へ抜けるのが既定挙動）。
  const TAB_CONSUMING_SELECTOR = [
    '[contenteditable="true"]', '[contenteditable=""]',
    '.CodeMirror', '.cm-editor', '.ProseMirror',
  ].join(', ');

  let enabled = true;

  function _safeClosest(el, selector) {
    if (!el || typeof el.closest !== 'function') return null;
    try { return el.closest(selector); } catch (_e) { return null; }
  }

  function _withinSelector(el, selector) {
    return !!_safeClosest(el, selector);
  }

  function _isDialogEligible(el) {
    if (!el || !el.getAttribute) return false;
    const role = el.getAttribute('role');
    if (role !== 'dialog' && role !== 'alertdialog') return false;
    if (el.getAttribute('aria-modal') !== 'true') return false;
    // 個別ダイアログ側の明示的なオプトアウト（gb-modal-shell.js の
    // data-modal-shell="off" と同じ流儀）。
    if (el.getAttribute('data-dialog-keyboard') === 'off') return false;
    return true;
  }

  function _isVisible(el) {
    if (!el) return false;
    if (el.isConnected === false) return false;
    if (el.hidden) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return false;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const cs = window.getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
      } catch (_e) { /* 計測不能な要素は素通りさせる */ }
    }
    if (typeof el.getBoundingClientRect === 'function') {
      const rect = el.getBoundingClientRect();
      if (rect && !(rect.width > 0 && rect.height > 0)) return false;
    }
    return true;
  }

  function _isEnabledNow(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('disabled')) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function _tabIndexOf(el) {
    if (!el || !el.getAttribute) return null;
    const raw = el.getAttribute('tabindex');
    if (raw === null || raw === undefined) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  function _isFocusCandidate(el) {
    if (!_isEnabledNow(el)) return false;
    const t = _tabIndexOf(el);
    if (t !== null && t < 0) return false;
    return _isVisible(el);
  }

  function _numericZIndex(el) {
    if (!el) return NaN;
    const inline = el.style ? el.style.zIndex : undefined;
    if (inline !== undefined && inline !== null && inline !== '') {
      const n = parseInt(inline, 10);
      if (Number.isFinite(n)) return n;
    }
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const cs = window.getComputedStyle(el);
        const n = parseInt(cs.zIndex, 10);
        if (Number.isFinite(n)) return n;
      } catch (_e) { /* 計測不能な要素は無視 */ }
    }
    return NaN;
  }

  // 最も近い明示的なz-index指定を祖先方向に探す（簡易スタッキング推定）。
  // 見つからない場合は0（同点はDOM順で後方＝最近追加されたものを優先）。
  function _stackingZIndex(el) {
    let node = el;
    let guard = 0;
    while (node && node !== document && guard < 200) {
      guard += 1;
      const z = _numericZIndex(node);
      if (Number.isFinite(z)) return z;
      node = node.parentNode;
    }
    return 0;
  }

  function _dialogCandidates() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return [];
    let nodes;
    try { nodes = document.querySelectorAll('[role]'); } catch (_e) { return []; }
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (_isDialogEligible(el) && _isVisible(el)) out.push(el);
    }
    return out;
  }

  // 複数ダイアログが同時に可視の場合、z-indexとDOM順（querySelectorAllの
  // document順を利用。同点はより後方＝より新しく開かれたものを優先）から
  // 最前面の1つだけを選ぶ。
  function topmostDialog() {
    const candidates = _dialogCandidates();
    if (!candidates.length) return null;
    let best = candidates[0];
    let bestZ = _stackingZIndex(best);
    for (let i = 1; i < candidates.length; i++) {
      const el = candidates[i];
      const z = _stackingZIndex(el);
      if (z >= bestZ) {
        best = el;
        bestZ = z;
      }
    }
    return best;
  }

  // ----------------------------------------------------------------------
  // 浮動UI（ダイアログの外、document.body直下に置かれるポップアップ/メニュー/
  // ツールチップ等）の除外判定。
  //
  // プロジェクト規約（app/CLAUDE.md「ポップアップの位置制御」節）により、
  // ポップアップは常に document.body 直下へ position:fixed で追加される
  // （ダイアログのDOM子孫にはならない）。そのため「フォーカスがダイアログの
  // 外へ抜けたら呼び戻す」処理をそのまま適用すると、ダイアログ内から開いた
  // ポップアップ（例: gb-color-palette.part01.js の色パレット、スウォッチは
  // tabIndex=0）にフォーカスがある状態でTab/矢印キーを押した時にポップアップ
  // からフォーカスを奪ってしまう。
  //
  // 判定条件（両方満たす場合のみ「浮動UI内」とみなしTab/矢印を素通しする）:
  //   (a) フォーカス中の要素、またはその祖先が position:fixed であるか、
  //       既知の浮動UIクラス命名規則（*-popup / *-menu / *-dropdown /
  //       *-tooltip / *-picker / *-suggest / *-autocomplete / *-combobox）に
  //       一致する（色パレット等の特定機能名に限定しない汎用パターン）
  //   (b) その要素のスタッキングz-indexが最前面ダイアログ以上（＝視覚的に
  //       ダイアログより手前）
  // ただし、ダイアログ自身や「role=dialog/alertdialogな要素を内包する外枠
  // （オーバーレイ）」は対象外とする。オーバーレイは実CSSで position:fixed
  // が指定されているため、これを除外しないと2枚重ねダイアログの背面側
  // オーバーレイまで「浮動UI」と誤検出し、既存の「最前面ダイアログへ呼び戻す」
  // 挙動を壊してしまう。
  //
  // 条件を満たさない場合（本当に背面へフォーカスが抜けた場合）は、従来どおり
  // ダイアログへ呼び戻す。
  const FLOATING_UI_CLASS_TOKEN = /(^|-)(popup|menu|submenu|dropdown|tooltip|picker|suggest|autocomplete|combobox)(-|$)/i;

  function _hasFloatingUiClass(el) {
    const cls = el && el.className;
    if (!cls) return false;
    const tokens = String(cls).split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      if (FLOATING_UI_CLASS_TOKEN.test(tokens[i])) return true;
    }
    return false;
  }

  function _isFixedPositioned(el) {
    if (!el) return false;
    if (el.style && el.style.position === 'fixed') return true;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const cs = window.getComputedStyle(el);
        if (cs && cs.position === 'fixed') return true;
      } catch (_e) { /* 計測不能なら次の判定へ */ }
    }
    return false;
  }

  // ダイアログそのもの、またはrole=dialog/alertdialogな要素を内包する
  // 外枠（オーバーレイ）を「ダイアログ機構」として浮動UI判定から除外する。
  function _isDialogOwnedElement(el) {
    if (!el || !el.getAttribute) return false;
    if (_isDialogEligible(el)) return true;
    if (typeof el.querySelector !== 'function') return false;
    let found = null;
    try { found = el.querySelector('[role="dialog"], [role="alertdialog"]'); } catch (_e) { found = null; }
    return !!found;
  }

  function _isFloatingUiHostCandidate(el) {
    if (!el || !el.getAttribute) return false;
    if (_isDialogOwnedElement(el)) return false;
    return _isFixedPositioned(el) || _hasFloatingUiClass(el);
  }

  // フォーカス中の要素自身、またはその祖先（document.bodyの手前まで）から、
  // 浮動UIの入口とみなせる要素を探す。見つかった最初の要素を返す。
  function _findFloatingUiHost(el) {
    if (typeof document === 'undefined') return null;
    const body = document.body;
    let node = el;
    let guard = 0;
    while (node && node !== body && guard < 200) {
      guard += 1;
      if (_isFloatingUiHostCandidate(node)) return node;
      node = node.parentNode;
    }
    return null;
  }

  // フォーカス中の要素が「ダイアログより手前に表示されている浮動UI」に
  // 属している場合はtrue。この場合、本モジュールはTab/矢印キーへ一切
  // 介入しない（各浮動UI自身のキー処理、またはブラウザ既定へ委ねる）。
  function _isFocusInsideFrontFloatingUi(active, dialog) {
    const host = _findFloatingUiHost(active);
    if (!host) return false;
    const dialogZ = _stackingZIndex(dialog);
    const hostZ = _stackingZIndex(host);
    return hostZ >= dialogZ;
  }

  function focusableElements(dialog) {
    if (!dialog || !dialog.querySelectorAll) return [];
    let nodes;
    try { nodes = dialog.querySelectorAll(FOCUSABLE_SELECTOR); } catch (_e) { return []; }
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      if (_isFocusCandidate(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  function _actionContainer(dialog) {
    if (!dialog || !dialog.querySelector) return null;
    for (let i = 0; i < ACTION_CONTAINER_SELECTORS.length; i++) {
      let found = null;
      try { found = dialog.querySelector(ACTION_CONTAINER_SELECTORS[i]); } catch (_e) { found = null; }
      if (found) return found;
    }
    return null;
  }

  function actionButtons(dialog) {
    const container = _actionContainer(dialog);
    if (!container || !container.querySelectorAll) return [];
    let nodes;
    try { nodes = container.querySelectorAll(ACTION_BUTTON_SELECTOR); } catch (_e) { return []; }
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      if (_isFocusCandidate(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  // フォーカス可能要素が1つもない場合の最終フォールバック。
  // 一時的にtabindex=-1を付与し、ダイアログ本体へフォーカスする。
  // 付与したtabindexは、フォーカスが離れた時点で取り除く（「一時的」を維持）。
  function _focusDialogBody(dialog) {
    if (!dialog || typeof dialog.focus !== 'function') return;
    let addedTabIndex = false;
    if (dialog.getAttribute && dialog.getAttribute('tabindex') === null) {
      dialog.setAttribute('tabindex', '-1');
      addedTabIndex = true;
    }
    dialog.focus();
    if (addedTabIndex && typeof dialog.addEventListener === 'function') {
      const cleanup = () => { dialog.removeAttribute('tabindex'); };
      dialog.addEventListener('blur', cleanup, { once: true });
    }
  }

  function _activeElement() {
    return (typeof document !== 'undefined' && document.activeElement) || null;
  }

  function _handleTab(event, dialog, shiftKey) {
    const active = _activeElement();
    // Tabインデント等でTabを独自消費するエディタからは奪わない。
    if (_withinSelector(active, TAB_CONSUMING_SELECTOR)) return;

    const items = focusableElements(dialog);
    event.preventDefault();
    event.stopPropagation();

    if (!items.length) {
      _focusDialogBody(dialog);
      return;
    }
    const insideDialog = typeof dialog.contains === 'function' ? dialog.contains(active) : false;
    if (!insideDialog) {
      (shiftKey ? items[items.length - 1] : items[0]).focus();
      return;
    }
    const idx = items.indexOf(active);
    if (idx === -1) {
      (shiftKey ? items[items.length - 1] : items[0]).focus();
      return;
    }
    let nextIdx;
    if (shiftKey) nextIdx = idx <= 0 ? items.length - 1 : idx - 1;
    else nextIdx = idx >= items.length - 1 ? 0 : idx + 1;
    items[nextIdx].focus();
  }

  function _handleArrow(event, dialog, key) {
    const active = _activeElement();
    // 入力欄・選択欄・編集可能領域・スライダー・表・ツリー・メニュー等では、
    // 本来の矢印キー操作（キャレット移動・値変更・一覧内移動）を奪わない。
    if (_withinSelector(active, NATIVE_ARROW_SELECTOR)) return;

    const buttons = actionButtons(dialog);
    if (!buttons.length) return; // アクション領域が見つからなければ矢印処理はしない

    const forward = key === 'ArrowRight' || key === 'ArrowDown';
    event.preventDefault();
    event.stopPropagation();

    const idx = buttons.indexOf(active);
    let nextIdx;
    if (idx === -1) {
      // ダイアログ外、またはアクションボタン以外へフォーカスがある状態からの
      // 矢印操作は、進行方向の端（前進なら先頭、後退なら末尾）へ着地させる。
      nextIdx = forward ? 0 : buttons.length - 1;
    } else if (forward) {
      nextIdx = idx >= buttons.length - 1 ? 0 : idx + 1;
    } else {
      nextIdx = idx <= 0 ? buttons.length - 1 : idx - 1;
    }
    buttons[nextIdx].focus();
  }

  function handleKeydown(event) {
    if (!enabled || !event || event.defaultPrevented) return;
    const key = event.key;
    if (!HANDLED_KEYS.has(key)) return;
    const dialog = topmostDialog();
    if (!dialog) return; // ダイアログが無ければ何もしない
    const active = _activeElement();
    const insideDialog = active && typeof dialog.contains === 'function' ? dialog.contains(active) : false;
    // ダイアログの外にフォーカスがあり、かつそこがダイアログより手前の浮動UI
    // （ダイアログ内から開いたポップアップ等）である場合は、Tab/矢印キーへ
    // 一切介入しない（素通し）。本当に背面へ抜けたケースはこの分岐に入らず、
    // 従来どおり以降の処理でダイアログへ呼び戻す。
    if (!insideDialog && _isFocusInsideFrontFloatingUi(active, dialog)) return;
    if (key === 'Tab') {
      _handleTab(event, dialog, !!event.shiftKey);
      return;
    }
    _handleArrow(event, dialog, key);
  }

  function _installListener() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    document.addEventListener('keydown', handleKeydown, true);
  }

  window.GBDialogKeyboard = {
    // イベント処理本体（documentのcapture keydownから呼ばれる。テストからも直接呼べる）
    handleKeydown,
    // 対象判定（テスト・他モジュールから直接参照可能にする）
    topmostDialog,
    isDialogEligible: _isDialogEligible,
    isVisible: _isVisible,
    focusableElements,
    actionButtons,
    // 浮動UI（ポップアップ/メニュー等）除外判定（テストから直接参照可能にする）
    isFocusInsideFrontFloatingUi: _isFocusInsideFrontFloatingUi,
    // 有効/無効切替
    enable() { enabled = true; },
    disable() { enabled = false; },
    isEnabled() { return enabled; },
  };

  _installListener();
})();
