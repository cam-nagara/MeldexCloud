/* Map chrome uses the same toolbar, menus and option-panel shell as other tools. */
(function (root) {
  'use strict';
  const icon = name => typeof lucide === 'function' ? lucide(name, 16) : '';
  const dialogs = new WeakMap();
  function closePanel(panel) {
    const modal = dialogs.get(panel); if (!modal) return;
    dialogs.delete(panel); modal.close();
  }
  function openPanel(panel) {
    const actions = [...panel.children].filter(el => el.tagName === 'BUTTON');
    const close = actions.find(el => el.dataset.mapAction === '閉じる');
    const heading = panel.querySelector(':scope > h3');
    panel.classList.add('gb-map-modal-content', 'gb-map-options');
    const title = heading?.textContent || 'マップ';
    const modal = GBUI.createModal({ title, closeLabel: title + 'を閉じる', body: panel, footer: actions,
      initialFocus: () => panel.querySelector('input:not([type=hidden]),select,textarea'),
      geometryKey: 'map-' + (panel.getAttribute('aria-label') || heading?.textContent || 'dialog'),
      onClose: () => { dialogs.delete(panel); close?.click(); } });
    modal.modal.style.width = 'min(640px, calc(100vw - 32px))';
    close?.addEventListener('click', () => closePanel(panel));
    dialogs.set(panel, modal); modal.open(); return modal;
  }
  function iconButton(app, label, name, action, id) {
    const button = app._button(label, action, { id });
    button.className = 'tb-icon-btn'; button.innerHTML = icon(name);
    button.title = label; button.setAttribute('aria-label', label); return button;
  }
  function convert(button, label, name) {
    button.className = 'tb-icon-btn'; button.innerHTML = icon(name);
    button.title = label; button.setAttribute('aria-label', label); return button;
  }
  function section(title, content, open = false) {
    const el = document.createElement('details'); el.className = 'gb-map-section'; el.open = open;
    const summary = document.createElement('summary'); summary.textContent = title;
    el.append(summary, ...content); return el;
  }
  function decorate(app) {
    const toolbar = app.el.querySelector('.gb-map-toolbar'), tools = app.el.querySelector('.gb-map-tools');
    const commands = new Map([...toolbar.querySelectorAll('button')].map(b => [b.dataset.mapAction, b]));
    app._mapCommands = commands;
    const parking = app._mapParking = document.createElement('div'); parking.hidden = true; app.el.appendChild(parking);
    parking.append(...toolbar.children);
    toolbar.className = 'gb-toolbar gb-toolbar-map'; toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'マップの操作');
    const menu = iconButton(app, 'マップメニュー', 'menu', event => showToolMenu(event, 'map', app), 'menu'); menu.classList.add('tool-menu-btn');
    menu.setAttribute('aria-haspopup', 'menu'); menu.setAttribute('aria-expanded', 'false');
    const reveal = iconButton(app, 'フォルダツリーで表示', 'folderTree', event => revealCurrentInFolderTree('map', event), 'reveal');
    const title = app._mapTitle = document.createElement('span'); title.className = 'tb-title tb-file-title'; title.textContent = app.state.label || 'マップ'; title.title = title.textContent;
    const sep = () => { const s = document.createElement('div'); s.className = 'sep'; return s; };
    app.undoButton.dataset.gbTooltipKey = 'history.undo'; app.redoButton.dataset.gbTooltipKey = 'history.redo';
    toolbar.append(menu, reveal, title, sep(), convert(app.undoButton, '元に戻す', 'undo2'), convert(app.redoButton, 'やり直し', 'redo2'), sep());
    const toolIcons = { select: 'mousePointer', pin: 'mapPin', route: 'spline', region: 'pentagon', label: 'type', symbol: 'stamp', land: 'mountain', sea: 'waves', erase: 'eraser', measure: 'ruler' };
    for (const [tool, button] of app.toolButtons) toolbar.appendChild(convert(button, button.textContent, toolIcons[tool]));
    const spacer = document.createElement('div'); spacer.className = 'tb-spacer'; toolbar.appendChild(spacer);
    app.sidebarToggle = iconButton(app, 'レイヤーと地点一覧', 'layers', () => { app.sidebar.hidden = !app.sidebar.hidden; app.sidebarToggle.setAttribute('aria-pressed', String(!app.sidebar.hidden)); }, 'navigator');
    app.sidebarToggle.setAttribute('aria-pressed', 'false');
    app.inspectorToggle = iconButton(app, 'オプションを開く', 'panelRight', () => { app._syncDetailPanel(); toggleOptionPanel(); }, 'options');
    app.inspectorToggle.classList.add('gb-toolbar-option-panel-btn'); app.inspectorToggle.dataset.gbTooltipKey = 'panel.right.toggle';
    const search = iconButton(app, '地図内を検索', 'search', () => { app.sidebar.hidden = false; app.sidebarToggle.setAttribute('aria-pressed', 'true'); app._mapNavigatorTab('places'); app.search.focus(); }, 'search');
    const reload = commands.get('再読込');
    toolbar.append(app.sidebarToggle, convert(reload, '再読み込み', 'refreshCw'), search, app.inspectorToggle, app.saveStatus);
    app.saveStatus.classList.add('tb-meta');

    tools.className = 'gb-toolbar gb-map-contextbar'; tools.setAttribute('role', 'toolbar');
    app.symbolInput.className = 'gb-select';
    const color = iconButton(app, '追加する図形の色', 'palette', event => {
      openColorPalette(event.currentTarget, app.colorInput.value, value => { if (!app.editingDisabled) { app.colorInput.value = value; color.style.setProperty('--map-color', value); } }, { allowTransparent: false });
    }, 'draw-color'); color.className += ' gb-map-color-button'; color.style.setProperty('--map-color', app.colorInput.value);
    color.disabled = app.editingDisabled; app.colorInput.hidden = true; app.colorInput.removeAttribute('aria-label');
    const cancel = tools.querySelector('[data-map-action="取消"]');
    tools.replaceChildren(app.symbolInput, app.colorInput, color, convert(app.finishButton, '描画を確定', 'check'), convert(cancel, '描画を取消', 'x'));
    app._contextColor = color; app._contextCancel = cancel; app._contextBar = tools;
    app._contextBrush = document.createElement('label'); app._contextBrush.className = 'gb-map-brush'; app._contextBrush.append('ブラシ ');
    const brush = document.createElement('input'); brush.type = 'range'; brush.min = 5; brush.max = 300; brush.step = 5; brush.value = app.view.brushSize || 70; brush.className = 'tb-range'; brush.setAttribute('aria-label', 'ブラシの半径');
    brush.oninput = () => { app.view.brushSize = Number(brush.value); }; app._contextBrush.appendChild(brush); tools.prepend(app._contextBrush);

    const sidebar = app.sidebar; sidebar.replaceChildren(); sidebar.hidden = true; sidebar.setAttribute('aria-label', 'レイヤーと地点一覧');
    const nav = document.createElement('div'); nav.className = 'gb-tabbar'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', '地図の一覧');
    const layers = document.createElement('div'), places = document.createElement('div'); layers.className = places.className = 'gb-map-navigator-page';
    const addLayer = [...parking.querySelectorAll('[data-map-action="レイヤー追加"]')][0] || app._button('レイヤー追加', () => {
      const id = MeldexMapDocument.id(); if (app.update(d => { d.layers.push({ id, name: '新しいレイヤー', visible: true, locked: false, opacity: 1 }); })) { app._activeLayer = id; app._renderLayers(); }
    }, { disabled: app.editingDisabled });
    layers.append(addLayer, app.layerList); places.append(app.search, app.kindFilter, app.placeList);
    const pages = { layers, places }, tabs = new Map();
    app._mapNavigatorTab = id => { for (const [key, page] of Object.entries(pages)) { page.hidden = key !== id; tabs.get(key).setAttribute('aria-selected', String(key === id)); tabs.get(key).classList.toggle('gb-inner-tab-active', key === id); } };
    for (const [id, label] of [['layers', 'レイヤー'], ['places', '地点・図形']]) {
      const b = app._button(label, () => app._mapNavigatorTab(id)); b.className = 'gb-inner-tab'; b.setAttribute('role', 'tab'); tabs.set(id, b); nav.appendChild(b);
    }
    sidebar.append(nav, layers, places); app._mapNavigatorTab('layers');
    const closeNav = iconButton(app, '一覧を閉じる', 'x', () => { sidebar.hidden = true; app.sidebarToggle.setAttribute('aria-pressed', 'false'); }, 'close-navigator'); nav.appendChild(closeNav);

    const options = app.optionsRoot = document.createElement('div'); options.className = 'gb-map-options';
    const settingsTitle = document.createElement('h3'); settingsTitle.textContent = '地図の設定';
    options.append(settingsTitle, app.settings, section('章・時代', [app.periodsRoot]), section('保存した表示', [app.savedViewsRoot]), section('シートの場所', [app.sheetSources, app.sheetStatus]));
    parking.append(options, app.inspector);
    app.inspector.classList.add('gb-map-options'); app.inspector.hidden = false;
    for (const host of [options, app.inspector]) host.addEventListener('keydown', event => { if (app.handleKeyDown(event)) { event.preventDefault(); event.stopPropagation(); } });
    const empty = app._mapEmpty = document.createElement('div'); empty.className = 'gb-map-empty';
    const emptyTitle = document.createElement('strong'); emptyTitle.textContent = '世界を描き始める';
    const hint = document.createElement('p'); hint.textContent = '地形・川・都市をまとめて生成するか、地図画像を読み込んで作成できます。';
    const actions = document.createElement('div');
    actions.append(app._button('地図画像を読み込む', () => app.settings.querySelector('input[type=file]')?.click(), { disabled: app.editingDisabled }), app._button('世界地図を生成', () => MeldexMapWorldGenerator.show(app), { disabled: app.editingDisabled }));
    empty.append(emptyTitle, hint, actions); app.el.querySelector('.gb-map-body').appendChild(empty);

    const bar = app.el.querySelector('.gb-map-viewbar'); bar.className = 'gb-toolbar gb-map-viewbar';
    app.zoomSlider.className = 'tb-range'; app.rotationSlider.className = 'tb-range';
    const buttons = [...bar.querySelectorAll('button')];
    const icons = ['zoomOut', 'zoomIn', 'square', 'maximize', 'disc'];
    buttons.forEach((b, i) => convert(b, ['縮小', '拡大', '100%', '全体表示', '回転をリセット'][i], icons[i]));
    bar.replaceChildren(app.zoomSlider, app.zoomLabel, buttons[0], buttons[1], buttons[2], buttons[3], sep(), app.rotationSlider, app.rotationLabel, buttons[4]);
    bar.appendChild(app.position);
    const breadcrumbs = app.breadcrumbs; breadcrumbs.className = 'gb-map-breadcrumbs'; app.el.insertBefore(breadcrumbs, app.el.querySelector('.gb-map-body'));
    refresh(app);
    root.MeldexToolbarOverflow?.setup(toolbar, { keep: ['[data-map-action="menu"]', '[data-map-action="options"]', '[data-map-action="select"]'] });
  }
  function refresh(app) {
    if (!app._contextBar || !app.view || !app.store || app.view._destroyed) return;
    const tool = app.view.tool, draft = app.view.draft.length > 0;
    if (app._mapEmpty) app._mapEmpty.hidden = app.editingDisabled || tool !== 'select' || app.store.doc.coordinate_system !== 'local' || !!app.store.doc.background || !!app.store.doc.terrain || !!app.store.doc.features.length;
    app._contextBar.hidden = !draft && ['select', 'measure', 'erase'].includes(tool);
    app.symbolInput.hidden = tool !== 'symbol'; app._contextBrush.hidden = !['land', 'sea'].includes(tool);
    app._contextColor.hidden = ['select', 'measure', 'erase', 'land', 'sea'].includes(tool);
    app.finishButton.hidden = app._contextCancel.hidden = !draft;
    for (const [id, b] of app.toolButtons) b.classList.toggle('active', id === tool);
    if (app._mapTitle) { app._mapTitle.textContent = app.state.label || 'マップ'; app._mapTitle.title = app._mapTitle.textContent; }
    root.MeldexToolbarOverflow?.refresh();
  }
  function details(app, tab = null) {
    if (app._active === false || app.paneId !== GBLayout.activePane || !app.view?.map || !app.store || !app.optionsRoot || !app.inspector) return;
    const settings = document.getElementById('detail-tab-map-settings'), selection = document.getElementById('detail-tab-map-selection');
    if (!settings || !selection) return;
    if (settings.firstElementChild !== app.optionsRoot) settings.replaceChildren(app.optionsRoot);
    if (selection.firstElementChild !== app.inspector) selection.replaceChildren(app.inspector);
    document.querySelectorAll('.detail-tab-map').forEach(el => { el.hidden = false; });
    const chosen = tab || (typeof _resolveDetailTabForType === 'function' ? _resolveDetailTabForType('map', app._selected ? 'map-selection' : 'map-settings') : 'map-settings');
    if (typeof switchDetailTab === 'function' && _currentDetailTab !== chosen) switchDetailTab(chosen);
  }
  function menuItems(app) {
    const run = action => async () => { try { await action(); } catch (e) { app._message(e.userMessage || e.message); } };
    const command = (label, id, name, shortcut) => ({ label, icon: name, shortcut, disabled: !!app._mapCommands.get(id)?.disabled, action: run(() => app._mapCommands.get(id)?.click()) });
    const local = app.store.doc.coordinate_system === 'local';
    return [command('新規マップ', '新規', 'filePlus'), command('保存', '保存', 'save', 'Ctrl+S'), command('再読み込み', '再読込', 'refreshCw'), { separator: true },
      { label: app.state.mapBrowseMode ? '作図モードに戻る' : '閲覧モード', icon: app.state.mapBrowseMode ? 'pencil' : 'eye', action: run(() => app._toggleBrowseMode()) },
      ...(local ? [{ label: '生成', icon: 'sparkles', submenu: [
        { label: '世界地図を生成', icon: 'globe', action: run(() => MeldexMapWorldGenerator.show(app)), disabled: app.editingDisabled },
        { label: '地形を生成', icon: 'mountain', action: run(() => MeldexMapControls.generator(app)), disabled: app.editingDisabled },
        { label: '都市候補を生成', icon: 'mapPin', action: run(() => MeldexMapSettlements.show(app)), disabled: app.editingDisabled },
        { label: '気候帯を生成', icon: 'cloudSun', action: run(() => MeldexMapClimate.show(app)), disabled: app.editingDisabled },
        ...[['nations', '国家を生成'], ['vegetation', '植生を生成'], ['town', '都市・集落の詳細図']].map(([kind, label]) => ({ label, action: run(() => MeldexMapWorldBuilding.show(app, kind)), disabled: app.editingDisabled })),
      ] }] : []),
      { label: '読み込み・書き出し', icon: 'import', submenu: [command('データ入出力', 'データ入出力', 'arrowLeftRight'), command('マップを書き出す', 'マップを書き出す', 'fileDown'), ...(local ? [command('PNG画像を書き出す', 'PNG', 'image'), command('持ち出しパッケージ', '持ち出しパッケージ', 'package')] : [])] },
      { separator: true }, { label: '地図の設定', icon: 'settings', action: () => { details(app, 'map-settings'); if (typeof openRightPanelTab === 'function') openRightPanelTab('detail'); } },
      { label: 'レイヤーと地点一覧', icon: 'layers', action: () => app.sidebarToggle.click() }, { label: '全体表示', icon: 'maximize', shortcut: 'Ctrl+0', action: () => app.view.fit() }];
  }
  function destroy(app) {
    const menu = document.querySelector('.tool-menu-dropdown[data-tool-menu-root]');
    if (menu && app.el.contains(menu._sourceButton)) menu._cleanup?.({ restoreFocus: false });
    app.el.querySelectorAll('.gb-toolbar').forEach(el => root.MeldexToolbarOverflow?.teardown(el));
    app.optionsRoot?.remove(); app.inspector?.remove();
    app._contextBar = null;
  }
  root.MeldexMapChrome = Object.freeze({ decorate, refresh, details, menuItems, destroy, openPanel, closePanel });
})(globalThis);
