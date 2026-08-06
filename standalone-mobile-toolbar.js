/* standalone-mobile-toolbar.js
 * 単独アプリ（ノート/シナリオ/シート/ボード）共通のスマホ幅ツールバー化。
 * 計画書: app/docs/standalone-mobile-toolbar_plan_2026-07-20.md
 *
 * 狭幅（matchMedia '(max-width: 820px)'）時、指定した優先操作だけをツールバーに常時表示し、
 * それ以外を末尾の「その他」ボタン（⋯）から開くボトムシートへ畳む。
 *
 * 方式（変更禁止・計画書§3-3）: 元のツールバー要素は物理移動しない。CSSで非表示にし、
 * ボトムシートの行タップでは「元ボタンの .click() を呼ぶ代理クリック」を行う。
 * これにより、ノートのイベント委譲（bindToolbar）やシナリオ/ボードの本体共用生成コード
 * （gb-tool-scriptnote.js / gb-board-presets.js）を一切変更せずに済む。
 *
 * 使い方（各アプリのブートストラップJSから1回呼ぶ）:
 *   MeldexStandaloneMobileToolbar.setup({
 *     toolbar: '#se-toolbar',              // 対象ツールバー（セレクタ or 要素）
 *     priority: ['[data-sn-action="undo"]', ...], // 常時表示する操作のセレクタ群
 *     keep: ['#title-input'],              // 畳み対象外（タイトル入力等）。sep/spacerは自動判定
 *     sheetTitle: 'その他',                 // あふれメニューの見出し（省略時 'その他'）
 *   });
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  const NARROW_QUERY = '(max-width: 820px)';
  const HIDE_CLASS = 'sa-mtb-hide';

  const registry = [];

  function _resolveToolbar(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.querySelector(target);
    if (target instanceof Element) return target;
    return null;
  }

  function _labelFor(el) {
    const aria = String(el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const title = String(el.getAttribute('title') || '').trim();
    if (title) return title;
    const text = String(el.textContent || '').trim();
    return text || '操作';
  }

  function _isHiddenStatic(el) {
    if (el.hidden) return true;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    return !!style && style.display === 'none';
  }

  function _isSeparator(el) {
    return el.classList.contains('sep');
  }

  function _isSpacer(el) {
    return el.classList.contains('tb-spacer');
  }

  function _matchesAny(el, selectors) {
    return selectors.some(sel => {
      try { return el.matches(sel); } catch { return false; }
    });
  }

  // ノートの書式ボタン等は元ツールバーの mousedown ハンドラ（gb-editor.js の
  // rtCaptureSelectionFromToolbar + preventDefault）でフォーカス・選択範囲の
  // 保持/復元を行っている。ボトムシートの行はそのツールバーの外（document.body直下）
  // に生成されるため同じ効果を自前で再現する（preventDefaultでフォーカス移動を防ぎ、
  // 編集中の選択範囲を保ったまま代理クリックへ渡す）。
  function _preventMousedownBlur(el) {
    el.addEventListener('mousedown', event => event.preventDefault());
  }

  // ツールバー直下の子要素を「優先/畳み対象外(keep)/区切り/あふれ」に分類し、
  // dataset.saMtbRole へ記録する（複数回呼んでも安全＝refresh()の保険を兼ねる）。
  function _classify(entry) {
    const children = Array.from(entry.toolbar.children).filter(el => el !== entry.moreButton);
    const overflow = [];
    children.forEach(child => {
      // refresh()の再分類では、前回の狭幅適用で付けた自前のHIDE_CLASSを一旦外してから
      // 判定する。外さないと「本体共用CSS等の外部要因で隠れている」のか「前回の
      // 自分の適用で隠れているだけ」のかを区別できず、2回目以降の refresh() で
      // あふれ項目を external-hidden と誤判定して取りこぼす（狭幅状態の再適用は
      // このあと呼ばれる _applyNarrowState 側の役目）。
      child.classList.remove(HIDE_CLASS);
      if (_isHiddenStatic(child)) { delete child.dataset.saMtbRole; return; }
      if (_isSeparator(child)) { child.dataset.saMtbRole = 'sep'; return; }
      if (_isSpacer(child) || _matchesAny(child, entry.keep)) { child.dataset.saMtbRole = 'keep'; return; }
      if (_matchesAny(child, entry.priority)) { child.dataset.saMtbRole = 'priority'; return; }
      child.dataset.saMtbRole = 'overflow';
      overflow.push(child);
    });
    entry.overflowItems = overflow;
  }

  function _toolbarKey(toolbar) {
    return toolbar.id || toolbar.dataset.bdRole || 'sa-mtb-toolbar-' + (registry.length + 1);
  }

  function _createMoreButton(entry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tb-icon-btn sa-mtb-more-btn';
    btn.title = 'その他';
    btn.setAttribute('aria-label', 'その他');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.hidden = true;
    btn.dataset.e2eId = _toolbarKey(entry.toolbar) + '-mtb-more';
    btn.innerHTML = typeof window.lucide === 'function' ? window.lucide('moreHorizontal', 16) : '&#8943;';
    _preventMousedownBlur(btn);
    btn.addEventListener('mousedown', () => {
      // 選択範囲の書式ポップアップが開いていると、その終了処理にこのクリックが
      // 吸収されることがある。選択範囲自体はツールバー側が保持するため、
      // ポップアップだけを先に閉じて「あふれメニュー」を確実に開く。
      if (typeof window.closeAllFormatPopups === 'function') window.closeAllFormatPopups();
    });
    btn.addEventListener('click', () => _toggleSheet(entry));
    entry.toolbar.appendChild(btn);
    entry.moreButton = btn;
  }

  // 狭幅状態の反映: role='overflow'/'sep' の要素へ HIDE_CLASS を出し入れする。
  // 広幅へ戻った時はシートを強制的に閉じる（要素が全部再表示されるため畳む意味がない）。
  function _applyNarrowState(entry, isNarrow) {
    entry.narrow = isNarrow;
    entry.toolbar.classList.toggle('sa-mtb-narrow', isNarrow);
    Array.from(entry.toolbar.children).forEach(child => {
      if (child === entry.moreButton) return;
      const role = child.dataset.saMtbRole;
      if (role === 'overflow' || role === 'sep') child.classList.toggle(HIDE_CLASS, isNarrow);
    });
    if (entry.moreButton) entry.moreButton.hidden = !isNarrow;
    if (!isNarrow) _closeSheet(entry, { restoreFocus: false });
  }

  function _mirrorState(el) {
    const pressed = el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true';
    const disabled = !!el.disabled;
    let badgeText = '';
    const badge = el.querySelector('[class*="badge"]');
    if (badge && !badge.hidden && window.getComputedStyle(badge).display !== 'none') {
      badgeText = String(badge.textContent || '').trim();
    }
    return { pressed, disabled, badgeText };
  }

  function _iconHtmlFor(el) {
    const svg = el.querySelector('svg');
    return svg ? svg.outerHTML : '';
  }

  // 「元ボタンを隠して代理クリック」方式の要。狭幅時に display:none 相当で隠れている
  // ボタンを、クリック直前だけ画面外に見えない形で有効なレイアウト矩形を持たせる。
  // カードスタイル選択などクリックハンドラ内で anchor.getBoundingClientRect() を
  // 同期的に読むポップアップ（gb-board-presets.js等・本体共用コード）が、隠れたままの
  // ボタンから (0,0) の矩形しか取れず画面左上に張り付く事態を避けるための保険。
  // 同期処理内で隠し直すため、ペイントされる前に元へ戻り、ユーザーには見えない。
  function _revealForSyntheticInteraction(el, rect) {
    if (!el.classList.contains(HIDE_CLASS)) return () => {};
    const prevStyle = el.getAttribute('style');
    const box = rect || { left: 0, top: 0, width: 32, height: 32 };
    const set = (prop, value) => el.style.setProperty(prop, value, 'important');
    set('display', 'inline-flex');
    set('position', 'fixed');
    set('left', Math.max(0, box.left) + 'px');
    set('top', Math.max(0, box.top) + 'px');
    set('width', (box.width || 32) + 'px');
    set('height', (box.height || 32) + 'px');
    set('margin', '0');
    set('visibility', 'hidden');
    set('pointer-events', 'none');
    set('z-index', '-1');
    return () => {
      if (prevStyle === null) el.removeAttribute('style');
      else el.setAttribute('style', prevStyle);
    };
  }

  function _activateActionRow(entry, sourceEl, row) {
    if (sourceEl.disabled) return;
    const rect = row.getBoundingClientRect();
    _closeSheet(entry, { restoreFocus: false });
    const restore = _revealForSyntheticInteraction(sourceEl, rect);
    try { sourceEl.click(); } finally { restore(); }
    try { entry.moreButton?.focus?.({ preventScroll: true }); } catch { entry.moreButton?.focus?.(); }
  }

  function _rowId(sourceEl) {
    return sourceEl.id || sourceEl.dataset.snAction || sourceEl.dataset.bdAction
      || sourceEl.dataset.bdTool || sourceEl.dataset.noteRtCmd || sourceEl.dataset.sheetAction
      || Math.random().toString(36).slice(2);
  }

  function _buildActionRow(entry, sourceEl) {
    const state = _mirrorState(sourceEl);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sa-mtb-row';
    row.disabled = state.disabled;
    if (state.pressed) row.classList.add('active');
    row.dataset.e2eId = 'sa-mtb-row-' + _rowId(sourceEl);
    const icon = document.createElement('span');
    icon.className = 'sa-mtb-row-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = _iconHtmlFor(sourceEl);
    const label = document.createElement('span');
    label.className = 'sa-mtb-row-label';
    label.textContent = _labelFor(sourceEl);
    row.append(icon, label);
    if (state.badgeText) {
      const badge = document.createElement('span');
      badge.className = 'sa-mtb-row-badge';
      badge.textContent = state.badgeText;
      row.appendChild(badge);
    }
    _preventMousedownBlur(row);
    // 代理クリック（sourceEl.click()）は行のクリックハンドラ内で同期的に完結するが、
    // 元のクリックイベント自体はそのまま document までバブルし続ける。代理先が
    // ポップアップ／メニュー（.gb-context-menu 等）を開くボタンの場合、
    // gb-dropdown-dismiss.js の「外側クリックで閉じる」判定が、開いた直後の
    // ポップアップをこの行イベントの target（sa-mtb-row、非トリガー要素）で
    // 即座に閉じてしまう。行クリックはこのモジュール内で処理を完結させるため、
    // 外側へは伝播させない。
    row.addEventListener('click', event => {
      event.stopPropagation();
      _activateActionRow(entry, sourceEl, row);
    });
    return row;
  }

  function _currentOptionText(sourceEl) {
    const opt = sourceEl.options ? sourceEl.options[sourceEl.selectedIndex] : null;
    return String((opt && opt.textContent) || sourceEl.value || '').trim();
  }

  function _selectOption(entry, sourceEl, value) {
    sourceEl.value = value;
    sourceEl.dispatchEvent(new Event('change', { bubbles: true }));
    _closeSheet(entry, { restoreFocus: false });
    try { entry.moreButton?.focus?.({ preventScroll: true }); } catch { entry.moreButton?.focus?.(); }
  }

  // <select> の畳み対象は「ラベル+現在値」の行をタップで展開し、選択肢を縦リストで
  // 表示する（計画書§3-3）。選択で元selectへ value を設定し change を発火する。
  function _buildSelectRow(entry, sourceEl) {
    const wrap = document.createElement('div');
    wrap.className = 'sa-mtb-row-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'sa-mtb-row sa-mtb-row-select-trigger';
    trigger.disabled = !!sourceEl.disabled;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.dataset.e2eId = 'sa-mtb-row-' + _rowId(sourceEl);
    const label = document.createElement('span');
    label.className = 'sa-mtb-row-label';
    label.textContent = _labelFor(sourceEl);
    const value = document.createElement('span');
    value.className = 'sa-mtb-row-value';
    value.textContent = _currentOptionText(sourceEl);
    trigger.append(label, value);
    const options = _buildSelectOptionsList(entry, sourceEl);
    _preventMousedownBlur(trigger);
    trigger.addEventListener('click', () => {
      const willOpen = options.hidden;
      options.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    wrap.append(trigger, options);
    return wrap;
  }

  function _buildSelectOptionsList(entry, sourceEl) {
    const options = document.createElement('div');
    options.className = 'sa-mtb-select-options';
    options.hidden = true;
    options.setAttribute('role', 'listbox');
    Array.from(sourceEl.options || []).forEach(option => {
      const optBtn = document.createElement('button');
      optBtn.type = 'button';
      optBtn.className = 'sa-mtb-option';
      optBtn.setAttribute('role', 'option');
      optBtn.textContent = option.textContent || option.value;
      if (option.selected) { optBtn.classList.add('active'); optBtn.setAttribute('aria-selected', 'true'); }
      _preventMousedownBlur(optBtn);
      optBtn.addEventListener('click', () => _selectOption(entry, sourceEl, option.value));
      options.appendChild(optBtn);
    });
    return options;
  }

  function _buildRow(entry, sourceEl) {
    return sourceEl.tagName === 'SELECT' ? _buildSelectRow(entry, sourceEl) : _buildActionRow(entry, sourceEl);
  }

  function _sheetHeader(entry) {
    const header = document.createElement('div');
    header.className = 'sa-mtb-sheet-header';
    const title = document.createElement('strong');
    title.textContent = entry.sheetTitle;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sa-mtb-sheet-close';
    closeBtn.setAttribute('aria-label', '閉じる');
    closeBtn.innerHTML = typeof window.lucide === 'function' ? window.lucide('x', 16) : '&times;';
    _preventMousedownBlur(closeBtn);
    closeBtn.addEventListener('click', () => _closeSheet(entry, { restoreFocus: true }));
    header.append(title, closeBtn);
    return header;
  }

  function _toggleSheet(entry) {
    if (entry.sheet) _closeSheet(entry, { restoreFocus: true });
    else _openSheet(entry);
  }

  function _openSheet(entry) {
    if (entry.sheet) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'sa-mtb-backdrop';
    const sheet = document.createElement('div');
    sheet.className = 'sa-mtb-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', entry.sheetTitle);
    const body = document.createElement('div');
    body.className = 'sa-mtb-sheet-body';
    entry.overflowItems.forEach(sourceEl => body.appendChild(_buildRow(entry, sourceEl)));
    sheet.append(_sheetHeader(entry), body);
    backdrop.appendChild(sheet);
    backdrop.addEventListener('pointerdown', event => {
      if (event.target === backdrop) _closeSheet(entry, { restoreFocus: true });
    });
    entry._onKeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); _closeSheet(entry, { restoreFocus: true }); }
    };
    document.addEventListener('keydown', entry._onKeydown);
    document.body.appendChild(backdrop);
    entry.sheet = backdrop;
    entry.moreButton?.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      const first = body.querySelector('button:not(:disabled)');
      try { first?.focus?.({ preventScroll: true }); } catch { first?.focus?.(); }
    });
  }

  function _closeSheet(entry, options) {
    if (!entry.sheet) return;
    entry.sheet.remove();
    entry.sheet = null;
    entry.moreButton?.setAttribute('aria-expanded', 'false');
    if (entry._onKeydown) { document.removeEventListener('keydown', entry._onKeydown); entry._onKeydown = null; }
    if (options && options.restoreFocus) {
      try { entry.moreButton?.focus?.({ preventScroll: true }); } catch { entry.moreButton?.focus?.(); }
    }
  }

  function _registerMediaQuery(entry) {
    const mql = window.matchMedia ? window.matchMedia(NARROW_QUERY) : null;
    entry.mql = mql;
    const apply = () => _applyNarrowState(entry, !!mql && mql.matches);
    if (mql) {
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', apply);
      else if (typeof mql.addListener === 'function') mql.addListener(apply);
    }
    apply();
  }

  function _refreshEntry(entry) {
    _classify(entry);
    _applyNarrowState(entry, !!entry.mql && entry.mql.matches);
  }

  function setup(config) {
    const opts = config || {};
    const toolbar = _resolveToolbar(opts.toolbar);
    if (!toolbar) {
      console.error('MeldexStandaloneMobileToolbar.setup: toolbar not found', opts.toolbar);
      return null;
    }
    const existing = registry.find(e => e.toolbar === toolbar);
    if (existing) return existing;
    const entry = {
      toolbar,
      priority: Array.isArray(opts.priority) ? opts.priority.slice() : [],
      keep: Array.isArray(opts.keep) ? opts.keep.slice() : [],
      sheetTitle: opts.sheetTitle || 'その他',
      moreButton: null,
      overflowItems: [],
      narrow: false,
      mql: null,
      sheet: null,
      _onKeydown: null,
    };
    toolbar.classList.add('sa-mtb-toolbar');
    _createMoreButton(entry);
    _classify(entry);
    _registerMediaQuery(entry);
    registry.push(entry);
    return entry;
  }

  // 将来ツールバーが再生成されるケースに備えた保険（計画書§3-3）。
  // 引数省略で登録済み全ツールバーを、引数指定でその1件だけを再分類する。
  function refresh(target) {
    if (target) {
      const toolbar = _resolveToolbar(target);
      const entry = registry.find(e => e.toolbar === toolbar);
      if (entry) _refreshEntry(entry);
      return;
    }
    registry.forEach(_refreshEntry);
  }

  window.MeldexStandaloneMobileToolbar = { setup, refresh };
})();
