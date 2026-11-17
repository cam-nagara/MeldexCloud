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
     viewMenuItems: view => [{ id, label, checked, disabled, run }],   // 任意（ビュー固有の項目）
     addMenuItems: () => [{ id, label, icon, run }],
   }) → { element, refresh() }
*/
(function initMeldexViewTabs(global) {
  'use strict';

  function icon(name, size) {
    return typeof global.lucide === 'function' ? global.lucide(name, size || 14) : '';
  }

  function token(value) {
    return String(value ?? '').replace(/[^a-zA-Z0-9_-]+/g, '-');
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
        label.innerHTML = icon(view.icon || 'table', 12);
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
        tab.addEventListener('dragstart', event => event.dataTransfer?.setData('text/meldex-view-tab', view.id));
        tab.addEventListener('dragover', event => { if (!readOnly()) event.preventDefault(); });
        tab.addEventListener('drop', event => {
          if (readOnly()) return;
          event.preventDefault();
          const fromId = event.dataTransfer?.getData('text/meldex-view-tab');
          if (fromId && fromId !== view.id) settings.onMove?.(fromId, index);
          refresh();
        });
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

    select.addEventListener('change', () => {
      settings.onActivate?.(select.value);
      refresh();
    });
    refresh();
    return { element: root, refresh };
  }

  global.MeldexViewTabs = Object.freeze({ create });
}(typeof globalThis !== 'undefined' ? globalThis : window));
