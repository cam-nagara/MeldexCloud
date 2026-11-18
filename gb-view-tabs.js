/* gb-view-tabs.js: ツールバー下のビュータブ（共通部品）
   ビューの切替・名前変更・複製・並べ替え・削除と、ビュー固有の追加メニューを持つタブ列を作る。
   見た目はシート・ボードのビュータブと同じ共通トークン（--ui-view-tab-*）を使う。
   データの保存は呼び出し側が持ち、この部品は表示と操作の受け渡しだけを行う。

   MeldexViewTabs.create({
     e2ePrefix: 'scriptnote-view',            // data-e2e-id の接頭辞
     ariaLabel: 'シナリオのビュー',
     readOnly: () => false,
     getViews: () => [{ id, name, icon }],    // 表示順
     getActiveId: () => id,
     onActivate: id => {},
     onRename: (id, name) => {},
     onDuplicate: id => {},
     onMove: (id, toIndex) => {},
     onDelete: id => {},
     onChangeIcon: (id, spec) => {},          // 任意。渡すと「アイコンを変更」を出す（spec='' は既定に戻す）
     viewMenuItems: view => [{ id, label, checked, disabled, run }],   // 任意（ビュー固有の項目）
     addMenuItems: () => [{ id, label, icon, run }],
   }) → { element, refresh() }
   getViews の icon は既定アイコン（lucide名）、customIcon は利用者が選んだアイコン（GBIconAssets の指定）。

   ビュータブを持つ他のアプリ（シート・ボード）も、並べ替えのドラッグ操作とドロップ位置の表示は
   MeldexViewTabs.bindReorder、ビューのアイコンの表示と選択は renderIcon / openIconPicker を使う
   （UI共通ルール 4.0「タブのドラッグ並べ替え」）。
*/
(function initMeldexViewTabs(global) {
  'use strict';

  function icon(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size || 14) : '';
  }

  function token(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]+/g, '-');
  }

  /* --- ビューのアイコン（全アプリのビュータブで共通） --- */

  // 利用者が選んだアイコン（customSpec）を優先し、無ければビュー種別の既定アイコン（lucide名）を描く。
  function renderIcon(customSpec, fallbackName, size) {
    const spec = String(customSpec || '').trim();
    const px = size || 12;
    if (spec && global.GBIconAssets && typeof global.GBIconAssets.render === 'function') {
      return global.GBIconAssets.render(spec, px, { className: 'gb-view-tab-custom-icon' });
    }
    return icon(fallbackName || 'table', px);
  }

  // 保存するアイコン指定を整える（空・文字列以外は「既定」= ''）。
  function normalizeIconSpec(value) {
    if (typeof value !== 'string') return '';
    const spec = value.trim();
    if (!spec || spec.length > 1024) return '';
    return global.GBIconAssets && typeof global.GBIconAssets.normalizeSpec === 'function'
      ? String(global.GBIconAssets.normalizeSpec(spec) || '')
      : spec;
  }

  // アイコン選択は共通の GBIconAssets.openPicker。「既定に戻す」は onChange('') を呼ぶ。
  function openIconPicker(options) {
    const settings = options || {};
    if (!global.GBIconAssets || typeof global.GBIconAssets.openPicker !== 'function') {
      global.showStatus?.('アイコンを選択できません', true);
      return null;
    }
    // メニュー項目のクリックから呼ばれると、そのクリックが開いたばかりの選択画面の
    // 「外側クリックで閉じる」へ届いて即座に閉じていた。クリック処理が終わってから開く。
    setTimeout(() => global.GBIconAssets.openPicker({
      anchorEl: settings.anchorEl?.isConnected ? settings.anchorEl : null,
      title: settings.title || 'ビューのアイコン',
      current: settings.current || '',
      allowReset: true,
      resetLabel: settings.resetLabel || '既定に戻す',
      onSelect: spec => settings.onChange?.(normalizeIconSpec(spec || '')),
      onReset: () => settings.onChange?.(''),
    }), 0);
    return null;
  }

  /* --- タブの並べ替え（ドラッグ＆ドロップ）: 全アプリのビュータブで共通 ---
     見た目と判定はメインパネルのタブと同じ。カーソルが各タブの中央より左なら「そのタブの前」、
     全タブの中央より右なら「最後のタブの後ろ」。表示は .gb-view-tab-drop-before / -after
     （縦線。寸法・色は共通トークン --ui-tab-drop-indicator-*）。 */

  const DROP_BEFORE = 'gb-view-tab-drop-before';
  const DROP_AFTER = 'gb-view-tab-drop-after';
  const DRAGGING = 'gb-view-tab-dragging';

  // rects: 横並びのタブの [{ left, width }]（表示順）。戻り値 { overIndex, side } または null。
  function resolveDropSlot(rects, clientX) {
    const list = Array.isArray(rects) ? rects : [];
    if (!list.length) return null;
    const x = Number(clientX);
    for (let index = 0; index < list.length; index += 1) {
      const rect = list[index] || {};
      const left = Number(rect.left) || 0;
      const width = Number(rect.width) || 0;
      if (Number.isFinite(x) && x < left + width / 2) return { overIndex: index, side: 'before' };
    }
    return { overIndex: list.length - 1, side: 'after' };
  }

  // 取り除いた後の並びでの挿入位置（onMove へ渡す toIndex）。
  function dropTargetIndex(fromIndex, overIndex, side) {
    let target = side === 'after' ? overIndex + 1 : overIndex;
    if (fromIndex >= 0 && fromIndex < target) target -= 1;
    return Math.max(0, target);
  }

  function clearDropIndicator(container) {
    const scope = container || (typeof document !== 'undefined' ? document : null);
    scope?.querySelectorAll?.(`.${DROP_BEFORE}, .${DROP_AFTER}`)
      .forEach(item => item.classList.remove(DROP_BEFORE, DROP_AFTER));
  }

  let activeDrag = null;

  // container: タブを並べる要素（再描画しても同じ要素を使い続けること）。
  // options: { itemSelector, dataType, readOnly(), onMove(fromIndex, toIndex, { fromItem }) }
  // 同じ container へ再度呼ぶと options だけ差し替える。
  function bindReorder(container, options) {
    if (!container || typeof container.addEventListener !== 'function') return null;
    if (container._meldexViewTabReorder) {
      container._meldexViewTabReorder.options = options || {};
      return container._meldexViewTabReorder;
    }
    const binding = { options: options || {} };
    const opt = () => binding.options || {};
    const locked = () => {
      const readOnly = opt().readOnly;
      return typeof readOnly === 'function' ? !!readOnly() : !!readOnly;
    };
    const items = () => Array.from(container.querySelectorAll(opt().itemSelector || ':scope > .gb-view-tab'));
    const itemOf = target => items().find(item => item === target || item.contains?.(target)) || null;
    const ours = () => !!activeDrag && activeDrag.container === container;
    const slotOf = event => {
      const list = items();
      const slot = resolveDropSlot(list.map(item => item.getBoundingClientRect()), event.clientX);
      return slot ? { ...slot, item: list[slot.overIndex] } : null;
    };
    const finish = () => {
      clearDropIndicator(container);
      if (activeDrag && activeDrag.container === container) {
        activeDrag.item?.classList?.remove(DRAGGING, 'dragging');
        activeDrag = null;
      }
    };
    container.addEventListener('dragstart', event => {
      const item = itemOf(event.target);
      if (!item) return;
      if (locked()) { event.preventDefault?.(); return; }
      activeDrag = { container, item, fromIndex: items().indexOf(item) };
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        try { event.dataTransfer.setData(opt().dataType || 'text/x-meldex-view-tab', String(activeDrag.fromIndex)); } catch (_) {}
      }
      item.classList.add(DRAGGING, 'dragging');
      // ドロップで元のタブが描き直されても、終了処理を必ず行う。
      if (typeof document !== 'undefined') document.addEventListener?.('dragend', finish, { once: true, capture: true });
    });
    container.addEventListener('dragover', event => {
      if (!ours() || locked()) return;
      event.preventDefault();
      event.stopPropagation?.();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const slot = slotOf(event);
      clearDropIndicator(container);
      if (slot?.item) slot.item.classList.add(slot.side === 'before' ? DROP_BEFORE : DROP_AFTER);
    });
    container.addEventListener('dragleave', event => {
      if (!ours()) return;
      if (event.relatedTarget && container.contains(event.relatedTarget)) return;
      clearDropIndicator(container);
    });
    container.addEventListener('drop', event => {
      if (!ours()) return;
      event.preventDefault();
      event.stopPropagation?.();
      const drag = activeDrag;
      const slot = slotOf(event);
      finish();
      if (locked() || !slot || drag.fromIndex < 0) return;
      const toIndex = dropTargetIndex(drag.fromIndex, slot.overIndex, slot.side);
      if (toIndex === drag.fromIndex) return;
      try { opt().onMove?.(drag.fromIndex, toIndex, { fromItem: drag.item }); }
      catch (error) { global.showStatus?.(error?.message || 'ビューを並べ替えできません', true); }
    });
    container.addEventListener('dragend', finish);
    container._meldexViewTabReorder = binding;
    return binding;
  }

  // タブ列は横スクロールするため、メニューは popover（top layer）へ出して見切れを防ぐ。
  // パネルに .gb-context-menu は付けない（各所の「開いているメニューを全部消す」処理で、
  // 常設のパネルごと削除されるため）。見た目は gb-view-tabs.css で共通メニューに揃える。
  function bindMenu(details, panel) {
    if (typeof panel.showPopover !== 'function') return;
    panel.setAttribute('popover', 'auto');
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return;
      if (details.open) {
        if (!panel.matches(':popover-open')) panel.showPopover();
        const summary = details.querySelector('summary');
        if (summary && typeof global.positionPopup === 'function') {
          global.positionPopup(panel, summary.getBoundingClientRect(), { gap: 4 });
        }
      } else if (panel.matches(':popover-open')) {
        panel.hidePopover();
      }
    });
    panel.addEventListener('toggle', () => {
      if (!panel.matches(':popover-open')) details.open = false;
    });
  }

  function create(options) {
    const settings = options || {};
    const prefix = settings.e2ePrefix || 'view';
    const readOnly = () => (typeof settings.readOnly === 'function' ? !!settings.readOnly() : !!settings.readOnly);
    const root = document.createElement('div');
    root.className = 'gb-view-tabs';
    root.dataset.uiComponent = 'view-tabs';
    root.dataset.e2eId = `${prefix}-tabs`;
    const list = document.createElement('div');
    list.className = 'gb-view-tabs-list';
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-label', settings.ariaLabel || 'ビュー');
    const select = document.createElement('select');
    select.className = 'tb-select gb-view-tabs-select';
    select.dataset.e2eId = `${prefix}-select`;
    select.setAttribute('aria-label', 'ビュー切替');
    select.title = 'ビュー切替';
    root.append(list, select);
    let addElement = null;
    let lastLabelClick = null;

    const closeMenus = () => root.querySelectorAll('details[open]').forEach(item => { item.open = false; });

    const beginRename = (tab, view) => {
      if (readOnly()) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'gb-view-tab-rename';
      input.value = view.name || '';
      input.setAttribute('aria-label', 'ビュー名');
      input.dataset.e2eId = `${prefix}-rename-input`;
      let done = false;
      const finish = cancelled => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (!cancelled && next && next !== view.name) {
          try { settings.onRename?.(view.id, next); }
          catch (error) { global.showStatus?.(error?.message || 'ビュー名を変更できません', true); }
        }
        refresh();
      };
      input.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); finish(false); }
        else if (event.key === 'Escape') { event.preventDefault(); finish(true); }
      });
      input.addEventListener('blur', () => finish(false));
      tab.replaceChildren(input);
      input.focus();
      input.select();
    };

    const menuButton = (panel, item, refToken) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gb-context-menu-item';
      button.dataset.e2eId = `${prefix}-${item.id}-${refToken}`;
      if (item.checked != null) {
        button.setAttribute('role', 'menuitemcheckbox');
        button.setAttribute('aria-checked', String(!!item.checked));
        button.innerHTML = `<span class="gb-view-tab-check" aria-hidden="true">${item.checked ? icon('check', 14) : ''}</span>`;
        button.appendChild(document.createTextNode(item.label));
      } else {
        button.textContent = item.label;
      }
      button.disabled = !!item.disabled;
      button.addEventListener('click', async () => {
        closeMenus();
        await item.run?.();
        if (item.refresh !== false) refresh();
      });
      panel.appendChild(button);
    };

    const separator = panel => {
      const sep = document.createElement('div');
      sep.className = 'gb-context-menu-sep';
      sep.setAttribute('role', 'separator');
      panel.appendChild(sep);
    };

    function refresh() {
      addElement?.remove();
      const views = settings.getViews?.() || [];
      const activeId = settings.getActiveId?.();
      const locked = readOnly();
      list.replaceChildren();
      select.replaceChildren();
      views.forEach((view, index) => {
        const refToken = token(view.id);
        const selected = view.id === activeId;
        const tab = document.createElement('div');
        tab.className = 'gb-view-tab';
        tab.classList.toggle('active', selected);
        tab.dataset.viewId = view.id;
        tab.dataset.e2eId = `${prefix}-tab-${refToken}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(selected));
        tab.draggable = !locked;

        const option = document.createElement('option');
        option.value = view.id;
        option.textContent = view.name || 'ビュー';
        option.selected = selected;
        select.appendChild(option);

        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'gb-view-tab-label';
        label.dataset.e2eId = `${prefix}-label-${refToken}`;
        label.innerHTML = renderIcon(view.customIcon, view.icon || 'table', 12);
        const text = document.createElement('span');
        text.textContent = view.name || 'ビュー';
        label.appendChild(text);
        label.title = locked ? (view.name || '') : `${view.name || 'ビュー'}（ダブルクリックで名前を変更）`;
        label.addEventListener('click', () => {
          const now = Date.now();
          const repeated = lastLabelClick?.id === view.id && now - lastLabelClick.time < 350;
          lastLabelClick = { id: view.id, time: now };
          // 1回目の切替でタブが描き直されるため、ネイティブの dblclick では判定できない。
          if (repeated && selected && !locked) {
            lastLabelClick = null;
            beginRename(tab, view);
          } else if (!selected) {
            settings.onActivate?.(view.id);
            refresh();
          }
        });

        const menu = document.createElement('details');
        menu.className = 'gb-view-tab-menu';
        menu.dataset.e2eId = `${prefix}-menu-${refToken}`;
        const summary = document.createElement('summary');
        summary.className = 'gb-view-tab-more';
        summary.dataset.e2eId = `${prefix}-menu-trigger-${refToken}`;
        summary.setAttribute('aria-label', `${view.name || 'ビュー'}のビュー操作`);
        summary.innerHTML = icon('moreHorizontal', 14) || '…';
        const panel = document.createElement('div');
        panel.className = 'gb-view-tab-menu-panel';
        panel.setAttribute('role', 'menu');
        menu.append(summary, panel);
        bindMenu(menu, panel);
        menuButton(panel, { id: 'rename', label: '名前を変更', disabled: locked, refresh: false, run: () => beginRename(tab, view) }, refToken);
        menuButton(panel, { id: 'duplicate', label: '複製', disabled: locked, run: () => settings.onDuplicate?.(view.id) }, refToken);
        if (typeof settings.onChangeIcon === 'function') {
          menuButton(panel, {
            id: 'icon', label: 'アイコンを変更', disabled: locked, refresh: false,
            run: () => openIconPicker({
              anchorEl: tab.isConnected ? tab : root,
              current: view.customIcon || '',
              onChange: spec => {
                try { settings.onChangeIcon(view.id, spec); }
                catch (error) { global.showStatus?.(error?.message || 'アイコンを変更できません', true); }
                refresh();
              },
            }),
          }, refToken);
        }
        const extra = settings.viewMenuItems?.(view) || [];
        if (extra.length) {
          separator(panel);
          extra.forEach(item => menuButton(panel, { ...item, disabled: locked || item.disabled }, refToken));
        }
        separator(panel);
        menuButton(panel, { id: 'previous', label: '左へ移動', disabled: locked || index <= 0, run: () => settings.onMove?.(view.id, index - 1) }, refToken);
        menuButton(panel, { id: 'next', label: '右へ移動', disabled: locked || index >= views.length - 1, run: () => settings.onMove?.(view.id, index + 1) }, refToken);
        separator(panel);
        menuButton(panel, { id: 'delete', label: '削除', disabled: locked || views.length <= 1, run: () => settings.onDelete?.(view.id) }, refToken);

        let longPress = 0;
        label.addEventListener('contextmenu', event => { event.preventDefault(); menu.open = true; });
        label.addEventListener('pointerdown', () => { longPress = setTimeout(() => { menu.open = true; }, 550); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => label.addEventListener(type, () => clearTimeout(longPress)));
        tab.append(label, menu);
        list.appendChild(tab);
      });

      const addItems = settings.addMenuItems?.() || [];
      if (addItems.length) {
        const add = document.createElement('details');
        add.className = 'gb-view-tab-menu gb-view-tabs-add';
        add.dataset.e2eId = `${prefix}-add-menu`;
        const addSummary = document.createElement('summary');
        addSummary.className = 'gb-view-tabs-add-trigger';
        addSummary.dataset.e2eId = `${prefix}-add-trigger`;
        addSummary.setAttribute('aria-label', 'ビューを追加');
        addSummary.title = 'ビューを追加';
        addSummary.innerHTML = icon('plus', 16) || '＋';
        const addPanel = document.createElement('div');
        addPanel.className = 'gb-view-tab-menu-panel';
        addPanel.setAttribute('role', 'menu');
        add.append(addSummary, addPanel);
        bindMenu(add, addPanel);
        addItems.forEach(item => menuButton(addPanel, { ...item, disabled: locked || item.disabled }, 'add'));
        root.insertBefore(add, select);
        addElement = add;
      }
    }

    // 並べ替えはタブ列全体で受ける（最後のタブの後ろへも置ける）。
    bindReorder(list, {
      itemSelector: ':scope > .gb-view-tab',
      dataType: 'text/meldex-view-tab',
      readOnly,
      onMove: (fromIndex, toIndex) => {
        const view = (settings.getViews?.() || [])[fromIndex];
        if (view) settings.onMove?.(view.id, toIndex);
        refresh();
      },
    });

    select.addEventListener('change', () => {
      settings.onActivate?.(select.value);
      refresh();
    });
    refresh();
    return { element: root, refresh };
  }

  global.MeldexViewTabs = Object.freeze({
    create, bindReorder, resolveDropSlot, dropTargetIndex, clearDropIndicator,
    renderIcon, normalizeIconSpec, openIconPicker,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
