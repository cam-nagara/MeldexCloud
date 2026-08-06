/* viewer-context-menu.js — Meldexビューワー: 右クリック/長押しメニュー。
   計画書: app/docs/viewer-stability-common-ui-plan-2026-07-31.md「実装変更 > 2. ビューワーUI」
   分割元: viewer.html（旧・独自 .viewer-ctx 系メニュー）。
   独自CSSの .viewer-ctx 系は廃止し、Meldex共通の .gb-context-menu 系（gb-tools.css）へ統一する。
   サブメニューは親メニューのDOM内に入れず、body直下へ別ポップアップとして配置し、共通の
   positionPopup/clampPopupToViewport（画面端補正）・addLongPressHandler（タッチ/ペン500ms長押し、
   10px以上の移動やパン開始・指離し・キャンセルでは非表示）を利用する。外側タップとEscapeで
   全階層を閉じる。本ファイルは window.MeldexViewerScene / window.MeldexViewerAnnotations へ
   発呼するだけで、シーン状態そのものは保持しない。 */
(function () {
  'use strict';

  function Scene() { return window.MeldexViewerScene; }
  function Annotations() { return window.MeldexViewerAnnotations; }

  let mainMenu = null;
  let submenuState = null; // { sub, trigger }

  function closeSubmenu() {
    if (!submenuState) return;
    submenuState.trigger.setAttribute('aria-expanded', 'false');
    submenuState.sub.remove();
    submenuState = null;
  }

  function closeAll() {
    closeSubmenu();
    if (!mainMenu) return;
    mainMenu.remove();
    mainMenu = null;
    document.removeEventListener('pointerdown', onOutsidePointerDown, true);
    document.removeEventListener('keydown', onMenuKeyDown, true);
  }

  function onOutsidePointerDown(ev) {
    if (mainMenu?.contains(ev.target)) return;
    if (submenuState?.sub.contains(ev.target)) return;
    closeAll();
  }

  function focusableItems(host) {
    return Array.from(host.querySelectorAll('.gb-context-menu-item:not(.disabled)'));
  }

  function cycleFocus(host, backward) {
    const items = focusableItems(host);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    const next = current < 0 ? (backward ? items.length - 1 : 0) : (current + (backward ? -1 : 1) + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  function focusFirst(host) { focusableItems(host)[0]?.focus({ preventScroll: true }); }
  function focusLast(host) { const items = focusableItems(host); items[items.length - 1]?.focus({ preventScroll: true }); }

  function onMenuKeyDown(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeAll(); return; }
    const host = submenuState?.sub || mainMenu;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      cycleFocus(host, ev.key === 'ArrowUp');
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      focusFirst(host);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      focusLast(host);
    } else if (ev.key === 'ArrowLeft' && submenuState) {
      ev.preventDefault();
      const trigger = submenuState.trigger;
      closeSubmenu();
      trigger.focus({ preventScroll: true });
    }
    // Enter/Space はネイティブ<button>のクリック挙動に委ねる（サブメニュートリガーは
    // 個別のkeydownハンドラで既にArrowRight/Enter/Spaceを処理済み）。
  }

  function menuIconHtml(name) {
    return typeof window.lucide === 'function' ? `<span class="menu-icon">${window.lucide(name, 16)}</span>` : '';
  }

  function addItem(host, label, fn, opts = {}) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'gb-context-menu-item';
    item.setAttribute('role', 'menuitem');
    if (opts.icon) item.insertAdjacentHTML('beforeend', menuIconHtml(opts.icon));
    const labelSpan = document.createElement('span');
    labelSpan.className = 'gb-context-menu-item-label';
    labelSpan.textContent = label;
    item.appendChild(labelSpan);
    if (opts.key) {
      const key = document.createElement('span');
      key.className = 'menu-shortcut';
      key.textContent = opts.key;
      item.appendChild(key);
    }
    item.addEventListener('click', () => { closeAll(); fn(); });
    host.appendChild(item);
    return item;
  }

  function addSep(host) {
    const sep = document.createElement('div');
    sep.className = 'gb-context-menu-sep';
    sep.setAttribute('role', 'separator');
    host.appendChild(sep);
  }

  function addSubmenu(host, label, buildFn) {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'gb-context-menu-item has-submenu';
    trigger.setAttribute('role', 'menuitem');
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    const labelSpan = document.createElement('span');
    labelSpan.className = 'gb-context-menu-item-label';
    labelSpan.textContent = label;
    trigger.appendChild(labelSpan);

    const open = () => {
      if (submenuState?.trigger === trigger) return;
      closeSubmenu();
      const sub = document.createElement('div');
      sub.className = 'gb-context-menu';
      sub.setAttribute('role', 'menu');
      sub.setAttribute('aria-label', label);
      sub.tabIndex = -1;
      buildFn(sub);
      if (typeof positionPopup === 'function') positionPopup(sub, trigger.getBoundingClientRect(), { prefer: 'right' });
      else { document.body.appendChild(sub); if (typeof clampPopupToViewport === 'function') clampPopupToViewport(sub); }
      trigger.setAttribute('aria-expanded', 'true');
      submenuState = { sub, trigger };
    };
    trigger.addEventListener('mouseenter', open);
    trigger.addEventListener('click', (ev) => { ev.stopPropagation(); open(); focusableItems(submenuState.sub)[0]?.focus(); });
    trigger.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight' || ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault(); ev.stopPropagation(); open();
        focusableItems(submenuState.sub)[0]?.focus();
      }
    });
    host.appendChild(trigger);
    return trigger;
  }

  function addSliderRow(host, label, opts) {
    const row = document.createElement('div');
    row.className = 'gb-context-menu-item';
    row.setAttribute('role', 'menuitem');
    row.tabIndex = 0;
    row.append(label + ': ');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = opts.min; input.max = opts.max; input.step = opts.step; input.value = opts.value;
    input.style.cssText = 'width:80px;accent-color:var(--accent);';
    input.setAttribute('aria-label', label);
    const valueLabel = document.createElement('span');
    valueLabel.className = 'menu-shortcut';
    valueLabel.textContent = opts.format(opts.value);
    input.addEventListener('input', () => { valueLabel.textContent = opts.format(input.value); });
    input.addEventListener('change', () => opts.onChange(input.value));
    row.append(input, valueLabel);
    row.addEventListener('click', ev => ev.stopPropagation());
    host.appendChild(row);
    return row;
  }

  function buildMenu() {
    const scene = Scene();
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'ビューワーメニュー');
    menu.tabIndex = -1;

    addItem(menu, '前へ', () => { scene.pause(); scene.prevGroup(); }, { key: '←' });
    addItem(menu, '次へ', () => { scene.pause(); scene.nextGroup(); }, { key: '→' });
    addItem(menu, '1枚戻る', () => { scene.pause(); scene.shiftBackward(); }, { key: 'Shift+←' });
    addItem(menu, '1枚進む', () => { scene.pause(); scene.shiftForward(); }, { key: 'Shift+→' });
    addSep(menu);
    addItem(menu, scene.isSheetContext() ? '前の画像行' : '前のフォルダ', () => scene.prevFolder(), { key: '↑' });
    addItem(menu, scene.isSheetContext() ? '次の画像行' : '次のフォルダ', () => scene.nextFolder(), { key: '↓' });
    addSep(menu);
    addItem(menu, scene.isPlaying() ? '一時停止' : '再生', () => scene.togglePlay(), { key: 'Space' });
    addSep(menu);
    addItem(menu, 'ズームイン', () => scene.zoomIn(), { key: '+' });
    addItem(menu, 'ズームアウト', () => scene.zoomOut(), { key: '−' });
    addSubmenu(menu, 'フィット', sub => {
      addItem(sub, '全体フィット', () => scene.setFitMode('contain'), { key: '1' });
      addItem(sub, '高さフィット', () => scene.setFitMode('height'), { key: '2' });
      addItem(sub, '幅フィット', () => scene.setFitMode('width'), { key: '3' });
      addItem(sub, '原寸', () => scene.setFitMode('none'), { key: '4' });
    });
    addSep(menu);
    addSubmenu(menu, '表示モード', sub => {
      const currentMode = scene.getMode();
      addItem(sub, (currentMode === 'single' ? '● ' : '') + '単体', () => scene.setMode('single'));
      addItem(sub, (currentMode === 'spread' ? '● ' : '') + '見開き', () => scene.setMode('spread'));
      addItem(sub, (currentMode === 'manga' ? '● ' : '') + 'マンガ（右→左）', () => scene.setMode('manga'));
    });
    addSubmenu(menu, '回転・反転', sub => {
      addItem(sub, '左右反転', () => scene.toggleFlipH(), { key: 'M' });
      addItem(sub, '上下反転', () => scene.toggleFlipV());
      addItem(sub, '回転', () => scene.rotate(), { key: 'Q' });
    });
    addSep(menu);
    addSliderRow(menu, '再生速度', {
      min: '0.5', max: '15', step: '0.5', value: String(scene.getSpeed()),
      format: v => parseFloat(v).toFixed(1) + 's',
      onChange: v => scene.setSpeed(v),
    });
    addSliderRow(menu, 'フェード', {
      min: '0', max: '2000', step: '100', value: String(scene.getFadeMs()),
      format: v => (parseFloat(v) / 1000).toFixed(1) + 's',
      onChange: v => scene.setFadeMs(v),
    });
    addSep(menu);
    addSubmenu(menu, 'エフェクト', sub => {
      addItem(sub, '背景ブラー ' + (scene.isBgBlur() ? 'ON' : 'OFF'), () => scene.toggleBg());
      addItem(sub, 'HUD ' + (scene.isHudVisible() ? 'ON' : 'OFF'), () => scene.toggleHud(), { key: 'H' });
      addItem(sub, '全画面', () => scene.toggleFullscreen(), { key: 'F' });
    });
    addSep(menu);
    addItem(menu, '注釈', () => Annotations().toggle(), { key: 'A' });
    if (window.MeldexStandaloneDefaultApps?.isAvailable?.()) {
      addSep(menu);
      addItem(menu, '既定アプリに設定...', () => window.MeldexStandaloneDefaultApps.openDialog({ source: 'menu' }));
    }
    // 別の直下項目にホバーしたら開いているサブメニューを閉じる（隣接サブメニューの重複表示防止）。
    menu.addEventListener('mouseover', ev => {
      const item = ev.target.closest('.gb-context-menu-item');
      if (item && item.parentElement === menu && !item.classList.contains('has-submenu')) closeSubmenu();
    });
    return menu;
  }

  function openMenuAt(clientX, clientY) {
    closeAll();
    const menu = buildMenu();
    mainMenu = menu;
    const anchorRect = { left: clientX, right: clientX, top: clientY, bottom: clientY };
    if (typeof positionPopup === 'function') {
      positionPopup(menu, anchorRect, { prefer: 'below' });
    } else {
      document.body.appendChild(menu);
      menu.style.position = 'fixed';
      menu.style.left = clientX + 'px';
      menu.style.top = clientY + 'px';
      if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    }
    menu.focus({ preventScroll: true });
    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    document.addEventListener('keydown', onMenuKeyDown, true);
  }

  const display = document.getElementById('display');
  display.addEventListener('contextmenu', e => {
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY);
  });

  // タッチ/ペンの500ms長押しで同じメニューを表示する。10px以上の移動・パン開始・指離し・
  // キャンセルでは表示しない（addLongPressHandler が判定する）。
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(display, (e) => { openMenuAt(e.clientX, e.clientY); });
  }
})();
