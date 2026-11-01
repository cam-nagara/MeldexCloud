/* Shared tab overflow, <=640px tab dropdown and edge gesture router. */
(function (global) {
  'use strict';

  const PHONE_QUERY = '(max-width: 640px)';
  const LEFT_ZONE = 28;
  const SWIPE_DISTANCE = 72;
  const BLOCKED = [
    'input', 'textarea', 'select', '[contenteditable="true"]',
    '[role="dialog"]', '.modal-overlay', '.gb-modal-overlay', '.gb-cal-modal-overlay',
    '.link-modal-overlay', '.cloud-mobile-menu-overlay', '.cloud-mobile-overflow-overlay',
    '#board-canvas', '.board-canvas', '.gb-board', '#html-view', '.gb-viewer',
    '#ann-overlay', '.ann-note', '.cloud-mobile-annotationbar'
  ].join(',');
  let observer = null;
  let gesture = null;
  const overflowBars = new Map();

  function isPhone() {
    return !!global.matchMedia?.(PHONE_QUERY).matches;
  }

  function tabTitle(tab) {
    const label = tab?.querySelector?.('.view-tab-label, .gb-tab-label, .tab-label');
    return String(tab?.dataset?.tabTitle || tab?.getAttribute?.('aria-label') ||
      tab?.getAttribute?.('title') || label?.textContent || tab?.textContent || 'タブ').trim() || 'タブ';
  }

  function tabItems(tablist) {
    const paneTabs = tablist.classList.contains('gb-pane-tabs');
    const selector = paneTabs
      ? ':scope > .gb-pane-tabs-scroll > .gb-tab'
      : '[role="tab"]';
    // #detail-tab-bar（オプションパネル）のように、
    // 複数の対象タイプ用タブを同じタブバーへ同居させ、現在のタイプに合わない
    // タブを `hidden` 属性で隠す実装がある。ここで hidden を素通りさせると、
    // スマホ用ドロップダウンに無関係な20件前後のタブが並び、実質的に目的の
    // タブへ切り替えられなくなる（2026-08-13 バグ報告で確認）。
    return Array.from(tablist.querySelectorAll(selector)).filter(tab =>
      !tab.hidden && (paneTabs || tab.closest('[role="tablist"]') === tablist));
  }

  function activeTab(tabs) {
    return tabs.find(tab => tab.classList.contains('active') || tab.getAttribute('aria-selected') === 'true') || tabs[0];
  }

  function closeMenu(menu, trigger, restoreFocus = true) {
    menu?._cleanup?.();
    menu?.remove();
    trigger?.setAttribute('aria-expanded', 'false');
    if (trigger?._tabMenu === menu) trigger._tabMenu = null;
    if (restoreFocus) trigger?.focus?.();
  }

  async function closeMainTab(tablist, tab) {
    const paneId = tablist.closest('.gb-pane')?.dataset?.paneId;
    const tabId = tab?.dataset?.tabId;
    const tabsApi = typeof GBTabs !== 'undefined' ? GBTabs : global.GBTabs;
    if (!paneId || !tabId || typeof tabsApi?.closeTab !== 'function') return false;
    return await tabsApi.closeTab(paneId, tabId) !== false;
  }

  function openMenu(trigger, tablist, overflowTabs = null) {
    document.querySelectorAll('.gb-mobile-tab-menu').forEach(node => closeMenu(node, node._trigger, false));
    const tabs = overflowTabs || tabItems(tablist);
    const menu = document.createElement('div');
    menu.className = 'gb-mobile-tab-menu' + (overflowTabs ? ' gb-tab-overflow-menu gb-context-menu' : '');
    menu._trigger = trigger; trigger._tabMenu = menu;
    menu._closeTabMenu = () => closeMenu(menu, trigger, false);
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', overflowTabs ? '隠れているタブ' : '表示を切り替える');
    tabs.forEach((tab) => {
      const row = document.createElement('div');
      row.className = 'gb-mobile-tab-menu-row';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-mobile-tab-menu-item';
      item.setAttribute('role', 'menuitem');
      item.disabled = tab.matches(':disabled,[aria-disabled="true"]');
      item.textContent = tabTitle(tab);
      if (tab === activeTab(tabItems(tablist))) item.setAttribute('aria-current', 'page');
      item.addEventListener('click', () => {
        closeMenu(menu, trigger, !overflowTabs);
        tab.click();
        syncOne(tablist);
        if (overflowTabs) global.requestAnimationFrame(() => {
          if (tab.isConnected) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          scheduleSync();
        });
      });
      row.appendChild(item);
      if (tablist.classList.contains('gb-pane-tabs') && tab.dataset.tabId) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'gb-mobile-tab-menu-close';
        close.setAttribute('aria-label', `${tabTitle(tab)}を閉じる`);
        close.title = `${tabTitle(tab)}を閉じる`;
        close.textContent = '×';
        close.addEventListener('click', async () => {
          if (await closeMainTab(tablist, tab)) closeMenu(menu, trigger);
        });
        row.appendChild(close);
      }
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    trigger.setAttribute('aria-expanded', 'true');
    if (typeof global.positionPopup === 'function') global.positionPopup(menu, trigger.getBoundingClientRect());
    else {
      const rect = trigger.getBoundingClientRect();
      menu.style.setProperty('left', `${Math.max(8, rect.left)}px`);
      menu.style.setProperty('top', `${rect.bottom + 4}px`);
    }
    menu.querySelector('button:not(:disabled)')?.focus();
    menu.addEventListener('keydown', (event) => {
      const items = Array.from(menu.querySelectorAll('button:not(:disabled)'));
      const index = items.indexOf(document.activeElement);
      let next = -1;
      if (event.key === 'ArrowDown') next = index < items.length - 1 ? index + 1 : 0;
      else if (event.key === 'ArrowUp') next = index > 0 ? index - 1 : items.length - 1;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      if (next >= 0) {
        event.preventDefault();
        event.stopPropagation();
        items[next]?.focus();
      }
    });
    const dismiss = (event) => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && !menu.contains(event.target) && event.target !== trigger)) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
        closeMenu(menu, trigger);
      }
    };
    menu._cleanup = () => {
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('pointerdown', dismiss, true);
    };
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('pointerdown', dismiss, true);
  }

  function clippedTabs(bar, scroll) {
    const clip = scroll.getBoundingClientRect();
    return tabItems(bar).filter(tab => {
      const rect = tab.getBoundingClientRect();
      return rect.width > 0 && (rect.left < clip.left - 1 || rect.right > clip.right + 1);
    });
  }

  function syncOverflow(bar) {
    if (!bar.classList.contains('gb-pane-tabs')) return;
    const scroll = bar.querySelector(':scope > .gb-pane-tabs-scroll');
    if (!scroll?.clientWidth) {
      const existing = overflowBars.get(bar);
      if (existing) {
        if (!existing.trigger.hidden) existing.trigger.hidden = true;
        if (existing.trigger._tabMenu) closeMenu(existing.trigger._tabMenu, existing.trigger, false);
      }
      return;
    }
    let state = overflowBars.get(bar);
    if (!state) {
      const trigger = document.createElement('button');
      trigger.type = 'button'; trigger.className = 'gb-tab-overflow-button'; trigger.textContent = '▼';
      trigger.hidden = true;
      trigger.title = '隠れているタブを表示'; trigger.setAttribute('aria-label', trigger.title);
      trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
      trigger.dataset.e2eId = 'tab-overflow-button';
      trigger.addEventListener('click', () => {
        if (trigger._tabMenu) closeMenu(trigger._tabMenu, trigger);
        else {
          const hidden = clippedTabs(bar, scroll);
          if (hidden.length) openMenu(trigger, bar, hidden);
          else scheduleSync();
        }
      });
      bar.appendChild(trigger);
      const resize = typeof global.ResizeObserver === 'function' ? new global.ResizeObserver(scheduleSync) : null;
      resize?.observe(scroll); resize?.observe(bar);
      scroll.addEventListener('scroll', scheduleSync, { passive: true });
      state = { scroll, trigger, resize, active: null, add: scroll.querySelector(':scope > .gb-pane-add-tab') }; overflowBars.set(bar, state);
    }
    const { trigger } = state;
    // Compare against the space without the trigger to avoid show/hide oscillation.
    const reserved = trigger.hidden ? 0 : trigger.getBoundingClientRect().width;
    const overflow = !isPhone() && scroll.scrollWidth > scroll.clientWidth + reserved + 1;
    if (trigger.hidden === overflow) trigger.hidden = !overflow;
    // Keep creation available when the final tab and its following + are clipped.
    if (state.add && overflow && state.add.parentNode === scroll) bar.insertBefore(state.add, trigger);
    else if (state.add && !overflow && state.add.parentNode === bar) scroll.appendChild(state.add);
    if (!overflow && trigger._tabMenu) closeMenu(trigger._tabMenu, trigger, false);
    const active = activeTab(tabItems(bar));
    if (active !== state.active) {
      state.active = active;
      if (active && !isPhone()) global.requestAnimationFrame(() => {
        if (active.isConnected) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }
  }

  // 1ペイン内に複数のタブバー（ペイン自体のタブ + 中に埋め込まれたオプション
  // パネルのタブ等）が入れ子になることがある。祖先ペインのIDだけを優先すると、
  // 同じペインを共有する別々のタブバーへ同一の data-e2e-id が付いてしまう
  // （例: オプションパネルの「詳細タブ」）。まず自分自身の id / aria-label を
  // 優先し、それが無いタブバー（＝ペイン直下のタブバー自身）だけ祖先ペインIDへ
  // フォールバックする。
  function _dropdownOwnerKey(tablist) {
    return tablist.id || tablist.getAttribute?.('aria-label')
      || tablist.closest?.('[data-pane-id]')?.dataset?.paneId || 'tabs';
  }

  function ensureDropdown(tablist, usedIds) {
    let trigger = tablist.previousElementSibling;
    if (!trigger?.classList?.contains('gb-mobile-tab-dropdown')) {
      trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'gb-mobile-tab-dropdown';
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('click', () => openMenu(trigger, tablist));
      tablist.parentNode?.insertBefore(trigger, tablist);
    }
    const owner = _dropdownOwnerKey(tablist);
    const base = `mobile-tab-dropdown-${String(owner).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'tabs'}`;
    let e2eId = base;
    // 上記の優先順位を揃えても、想定していない入れ子構造では同じ owner が
    // 複数のタブバーへ再び付き得る。同一syncAllパス内での重複だけは、
    // 安定した通し番号を付けて必ず一意化する（安全網）。
    if (usedIds) {
      let n = 2;
      while (usedIds.has(e2eId) && usedIds.get(e2eId) !== tablist) {
        e2eId = `${base}-${n}`;
        n += 1;
      }
      usedIds.set(e2eId, tablist);
    }
    // 同じ値でも属性へ書けば変更通知は発生する。実際に変わる時だけ書くこと
    // （この関数を呼んでいる MutationObserver が再発火して無限ループになるため）。
    if (trigger.dataset.e2eId !== e2eId) trigger.dataset.e2eId = e2eId;
    trigger.__meldexTablist = tablist;
    return trigger;
  }

  function syncOne(tablist, usedIds) {
    if (!tablist?.isConnected) return;
    if (tablist.classList?.contains('gb-production-list-switch') || tablist.closest?.('.gb-production-list-switch')) return;
    // Sheet/board view bars already provide their own phone select and menu.
    // Adding a second dropdown also collects hidden menu text into its label.
    const nativeSwitcher = tablist.closest?.('.db-view-switcher')?.querySelector('select.db-view-select');
    // A tab-styled toolbar may wrap a semantic tablist plus an add button.
    // Convert the inner list so the toolbar's other controls remain visible.
    const nestedTablist = tablist.classList?.contains('gb-pane-tabs')
      && tablist.querySelector(':scope > [role="tablist"]');
    if (nativeSwitcher || nestedTablist || tablist.dataset.mobileTabContainer === '1') {
      const old = tablist.previousElementSibling;
      if (old?.classList?.contains('gb-mobile-tab-dropdown')) old.remove();
      return;
    }
    const trigger = ensureDropdown(tablist, usedIds);
    const tabs = tabItems(tablist);
    const active = activeTab(tabs);
    const title = tabTitle(active);
    const label = `${title}。表示を切り替える`;
    const disabled = tabs.length === 0;
    // すべて「変化した時だけ書く」こと。値が同じでも属性への書き込みは変更通知を
    // 発生させ、下の MutationObserver（disabled を監視対象に含む）が再びこの関数を
    // 呼ぶ。タブが0個のタブバー（読み込み中のタスクリスト等）では disabled=true を
    // 毎回書き直すため終わらない連鎖になり、画面全体が停止していた（2026-08-13）。
    if (trigger.textContent !== title) trigger.textContent = title;
    if (trigger.title !== title) trigger.title = title;
    if (trigger.getAttribute('aria-label') !== label) trigger.setAttribute('aria-label', label);
    if (trigger.disabled !== disabled) trigger.disabled = disabled;
  }

  function syncAll() {
    const phone = isPhone();
    document.documentElement.toggleAttribute('data-meldex-phone-tabs', phone);
    const tablists = Array.from(document.querySelectorAll('[role="tablist"], .gb-pane-tabs'));
    const usedIds = new Map();
    tablists.forEach((tablist) => { syncOne(tablist, usedIds); syncOverflow(tablist); });
    for (const [bar, state] of overflowBars) {
      if (bar.isConnected) continue;
      state.resize?.disconnect(); state.scroll.removeEventListener('scroll', scheduleSync);
      if (state.trigger._tabMenu) closeMenu(state.trigger._tabMenu, state.trigger, false);
      overflowBars.delete(bar);
    }
    document.querySelectorAll('.gb-mobile-tab-dropdown').forEach((trigger) => {
      if (!trigger.__meldexTablist?.isConnected) trigger.remove();
    });
  }

  function blockedTarget(target) {
    if (target?.closest?.(BLOCKED)) return true;
    try {
      if (typeof global.ann !== 'undefined' && (global.ann.active || global.ann.drawing)) return true;
    } catch (_) { /* optional annotation runtime */ }
    return false;
  }

  function leftOpen() {
    return document.getElementById('sidebar')?.classList.contains('cloud-mobile-tree-screen-open');
  }

  function rightOpen() {
    return document.getElementById('right-panel')?.classList.contains('open') ||
      !!document.querySelector('.gb-pane[data-meldex-role="right-sidebar"]');
  }

  function routeGesture(event, dx, dy) {
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (gesture.side === 'left' && dx > 0) global.MeldexCloudMobile?.openSidebar?.(true);
    else if (gesture.side === 'left-open' && dx < 0) global.MeldexCloudMobile?.closeSidebar?.({ reason: 'gesture-router' });
    else if (gesture.side === 'right' && dx < 0) {
      if (typeof global.openRightPanelTab === 'function') global.openRightPanelTab('detail');
      else if (typeof global.toggleRightPanel === 'function') global.toggleRightPanel();
    } else if (gesture.side === 'right-open' && dx > 0 && typeof global.toggleRightPanel === 'function') {
      global.toggleRightPanel();
    }
  }

  function installGestures() {
    if (document.__MeldexCommonEdgeGestureRouter) return;
    document.__MeldexCommonEdgeGestureRouter = true;
    document.addEventListener('pointerdown', (event) => {
      if (!isPhone() || event.pointerType === 'mouse' || blockedTarget(event.target)) return;
      const width = global.innerWidth || document.documentElement.clientWidth;
      let side = '';
      if (leftOpen() && event.target?.closest?.('#sidebar')) side = 'left-open';
      else if (rightOpen() && event.target?.closest?.('#right-panel, .gb-pane[data-meldex-role="right-sidebar"]')) side = 'right-open';
      else if (event.clientX <= LEFT_ZONE) side = 'left';
      else if (event.clientX >= width - LEFT_ZONE) side = 'right';
      if (side) gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, side };
    }, true);
    document.addEventListener('pointerup', (event) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const current = gesture;
      gesture = current;
      routeGesture(event, event.clientX - current.x, event.clientY - current.y);
      gesture = null;
    }, true);
    document.addEventListener('pointermove', (event) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.2) event.preventDefault();
    }, { capture: true, passive: false });
    document.addEventListener('pointercancel', () => { gesture = null; }, true);
  }

  // openMenu() が作るドロップダウンメニュー(.gb-mobile-tab-menu)は、位置制御の
  // 都合上 document.body 直下に付く（ポップアップの位置制御ルール通り）。
  // そのため、このメニューをタブバーの内側に持つ他のポップアップ・ダイアログ
  // （例: アイコンピッカー）が「自分の外側を pointerdown/mousedown したら閉じる」を
  // `!el.contains(event.target)` で判定していると、メニュー項目のタップは
  // 常に「外側」と誤判定され、タブ切替と同時に親ポップアップごと閉じてしまう
  // （2026-08-13 バグ報告で確認。iconピッカーの候補タブが選べなくなっていた）。
  // ここで最初期に capture フェーズの document リスナーを登録しておくと、
  // 同一ノードへの capture リスナーは登録順に実行されるため、後から各
  // ポップアップが登録する「外側クリックで閉じる」判定より必ず先に走り、
  // stopImmediatePropagation() でそれらを止められる。
  //
  // 対象は pointerdown/mousedown のみに絞る（click は含めない）。click は
  // pointerdown/pointerup の後に発火する別イベントで、メニュー項目自身の
  // click リスナー（tab.click() 実行）はそれを使う。ここで click まで止めると
  // 伝播が target 手前で完全に止まり、項目自身のクリックハンドラーに一生
  // 届かなくなる（タブ切替そのものが無効化される）ため、pointerdown/mousedown
  // だけを対象にして「外側クリックで閉じる」誤爆だけを防ぐ。
  function _installMenuOutsideClickGuard() {
    const guard = (event) => {
      if (event.target?.closest?.('.gb-mobile-tab-menu')) event.stopImmediatePropagation();
    };
    ['pointerdown', 'mousedown'].forEach((type) => {
      document.addEventListener(type, guard, true);
    });
  }

  // DOMが変わるたびに全タブバーを走査するため、変更が連続する画面では走査が
  // 積み上がる。連続した変更は1回の走査にまとめる（実行の順番は従来どおり、
  // 次の描画より前）。
  let syncQueued = false;
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    const run = () => { syncQueued = false; syncAll(); };
    if (typeof queueMicrotask === 'function') queueMicrotask(run);
    else setTimeout(run, 0);
  }

  function init() {
    syncAll();
    installGestures();
    _installMenuOutsideClickGuard();
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-selected', 'aria-disabled', 'disabled'] });
    global.addEventListener('resize', scheduleSync, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  global.MeldexMobileTabGestureRouter = { sync: syncAll, isPhone };
})(window);
