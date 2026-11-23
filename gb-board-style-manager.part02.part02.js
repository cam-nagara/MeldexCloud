    } else if (el.childElementCount === 0) {
      // 初回レンダー時のみインデックス 0 で描画。既に描画済みの場合は現在の選択を保つ。
      _bdRenderDepthStyleInPanel(el, 0);
    }
  }
  if (typeof switchDetailTab === 'function') switchDetailTab('board-depth-style');
}

// 旧モーダルは廃止し、オプションパネルのカードスタイルタブに切り替える (コミットC)。
// タブコンテンツは _bdEnsureBoardStyleManagerTabs() 経由で _bdRenderStyleManagerInPanel が描画する。
function bdOpenCardStyleManager(source) {
  if (typeof _openDetailRightPanel === 'function' && _openDetailRightPanel(source) === false) return;
  bdEnsureBoardUiState();
  if (typeof _bdEnsureBoardStyleManagerTabs === 'function') _bdEnsureBoardStyleManagerTabs();
  if (typeof showBoardTabs === 'function') showBoardTabs({ cardStyle: true });
  if (typeof switchDetailTab === 'function') switchDetailTab('board-card-style');
}

function bdOpenLineStyleManager(source) {
  if (typeof _openDetailRightPanel === 'function' && _openDetailRightPanel(source) === false) return;
  bdEnsureBoardUiState();
  if (typeof _bdEnsureBoardStyleManagerTabs === 'function') _bdEnsureBoardStyleManagerTabs();
  if (typeof showBoardTabs === 'function') showBoardTabs({ lineStyle: true });
  if (typeof switchDetailTab === 'function') switchDetailTab('board-line-style');
}

// 表示切替で本文や選択、オプションパネルを作り直さない。
function bdApplyDisplayFilterChange(key) {
  const root = typeof bdGetActiveBoardRoot === 'function' ? bdGetActiveBoardRoot() : document;
  const canvas = typeof bdGetBoardElement === 'function' ? bdGetBoardElement('canvas') : document.getElementById('bd-canvas');
  if (key === '_showShadow') {
    canvas?.classList.toggle('bd-shadow-on', !!bd._showShadow);
    return;
  }
  if (['showConnections', 'showConnLabels', '_textRotateOnLine'].includes(key)) {
    if (typeof bdDrawConns === 'function') {
      if (key === 'showConnections') bdDrawConns();
      else bdDrawConns({ connIds: (bd.connections || []).filter(conn => conn.label).map(conn => conn.id), reason: 'display-label-filter' });
    }
  } else {
    const highlight = key === 'highlightParentChildGroups' && typeof bdCreateRenderContext === 'function'
      ? bdCreateRenderContext().parentChildGroupColors : null;
    const geometryIds = [];
    for (const node of bd.nodes || []) {
      const div = root?.querySelector?.('#bdn-' + CSS.escape(node.id));
      if (!div) continue;
      const enabled = bd.displayFilters?.[key] !== false;
      const remove = selector => div.querySelectorAll(':scope > ' + selector).forEach(el => el.remove());
      if (key === 'showMenuButtons') {
        remove('.bd-card-menu-btn');
        if (enabled) bdAppendCardMenuButton(div, node);
      } else if (key === 'showMarkers') {
        remove('.bd-marker-hud');
        if (enabled) bdAppendMarkerHud(div, node);
      } else if (key === 'showLinkBadges') {
        remove('.bd-link-open-btn');
        if (enabled && (node.link || node.imageSourcePath || node.img)) {
          const resolved = typeof MeldexBoardOpenTarget !== 'undefined'
            ? MeldexBoardOpenTarget.resolve(node) : { path: node.link || node.imageSourcePath || node.img };
          bdAppendLinkOpenButton(div, node, resolved);
        }
      } else if (key === 'showStatus' && node.status) {
        remove('.bd-status-hud');
        if (enabled) bdAppendStatusHud(div, node);
        const sample = document.createElement('div');
        bdApplyNodeBaseStyles(sample, node, bdGetNodeStyle(node), enabled);
        for (const prop of ['opacity', 'borderColor', 'borderWidth', 'borderStyle']) div.style[prop] = sample.style[prop];
        geometryIds.push(node.id);
      } else if (key === 'showImageNames' && node.img) {
        const oldText = div.querySelector(':scope > .bd-text');
        const next = oldText?.nextSibling;
        oldText?.remove();
        bdAppendNodeText(div, node, bdGetNodeStyle(node), { showImageNames: enabled });
        if (next) div.insertBefore(div.querySelector(':scope > .bd-text'), next);
        geometryIds.push(node.id);
      } else if (key === 'highlightParentChildGroups') {
        delete div.dataset.bdGroupColor;
        div.classList.remove('bd-group-hi-clip');
        div.style.removeProperty('--bd-group-hi');
        div.style.removeProperty('--bd-group-hi-filter');
        const color = highlight?.get(node.id);
        if (color) _bdApplyParentChildGroupHighlight(div, div.dataset.shape || '', color);
      }
    }
    if (geometryIds.length) {
      geometryIds.forEach(id => bdMeasureNodeElement(id));
      if (typeof bdMarkConnectionsDirtyByNodes === 'function') bdMarkConnectionsDirtyByNodes(geometryIds, 'display-filter');
      if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(geometryIds, 'display-filter');
    }
  }
  if (['showConnections', 'showStatus', 'showImageNames'].includes(key)) {
    if (typeof bdInvalidateMinimapCache === 'function') bdInvalidateMinimapCache();
    if (typeof bdUpdateMinimap === 'function') bdUpdateMinimap();
  }
}

function bdOpenFilterMenu(anchor) {
  if (typeof bdEnsureBoardUiState === 'function') bdEnsureBoardUiState();
  bdCloseStylePicker();
  document.querySelectorAll('.gb-context-menu').forEach(menu => menu.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'ボード表示フィルタ');
  menu.style.cssText = 'position:fixed;z-index:10000;';
  const rect = anchor.getBoundingClientRect();
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'true');
  let closeHandler = null;
  const closeMenu = (restoreFocus = false) => {
    menu.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (closeHandler) {
      document.removeEventListener('pointerdown', closeHandler);
      closeHandler = null;
    }
    if (restoreFocus && typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(anchor);
  };
  const prepareToggleRow = (row, checked) => {
    row.className = 'gb-context-menu-item';
    row.tabIndex = 0;
    row.setAttribute('role', 'menuitemcheckbox');
    row.setAttribute('aria-checked', checked ? 'true' : 'false');
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        row.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    });
  };
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    }
  });
  // 表示フィルタ: 既定 true / OFF で非表示
  const labels = {
    showConnections: 'ライン',
    showConnLabels: 'ラインテキスト',
    showStatus: 'ステータス',
    showProgress: '進捗バー',
    showMarkers: 'マーカー',
    showNotes: 'ノート印',
    showLinkBadges: 'リンク印',
    showMenuButtons: '... ボタン',
    showImageNames: '画像ファイル名',
  };
  // 設計意図「カードHUD / ポップアップメニュー」で廃止済みの表示。
  // 既存の保存値を消さず、以前の項目は理由付きの利用不可表示として残す。
  const retired = {
    showProgress: '進捗バーは廃止済みです。ステータス表示を使用してください。',
    showNotes: '旧ノートインジケータの表示切替は廃止済みです。',
  };
  Object.entries(labels).forEach(([key, label]) => {
    const row = document.createElement('div');
    if (retired[key]) {
      row.className = 'gb-context-menu-item disabled';
      row.tabIndex = -1;
      row.setAttribute('role', 'menuitem');
      row.setAttribute('aria-disabled', 'true');
      row.setAttribute('aria-label', label + '。' + retired[key]);
      row.textContent = label + '（廃止済み）';
      row.title = retired[key];
      menu.appendChild(row);
      return;
    }
    const checked = bd.displayFilters[key] !== false;
    prepareToggleRow(row, checked);
    row.innerHTML = `${radioMark(checked)}${esc(label)}`;
    row.addEventListener('click', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo('ボード: ' + label + 'の表示');
      bd.displayFilters[key] = !(bd.displayFilters[key] !== false);
      closeMenu(true);
      bdApplyDisplayFilterChange(key);
      bdDirty();
    });
    menu.appendChild(row);
  });
  // 表示モード: 既定 false / ON で有効（計画書 §4-3-A）
  const modes = [
    { key: '_showShadow', label: 'トピック影' },
    { key: '_textRotateOnLine', label: 'ライン上テキスト回転' },
  ];
  modes.forEach(({ key, label }) => {
    const row = document.createElement('div');
    const checked = !!bd[key];
    prepareToggleRow(row, checked);
    row.innerHTML = `${radioMark(checked)}${esc(label)}`;
    row.addEventListener('click', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo('ボード: ' + label + 'の表示');
      bd[key] = !bd[key];
      // 同じ影を変えるテーマ欄と保存値を共有し、再読込で古い値を優先させない。
      if (key === '_showShadow') bd._fileStyle = { ...(bd._fileStyle || {}), '--bd-shadow': bd[key] ? '1' : '0' };
      closeMenu(true);
      bdApplyDisplayFilterChange(key);
      bdDirty();
    });
    menu.appendChild(row);
  });
  const relationSep = document.createElement('div');
  relationSep.className = 'bd-cm-sep';
  menu.appendChild(relationSep);
  {
    const key = 'highlightParentChildGroups';
    const row = document.createElement('div');
    const checked = bd.displayFilters[key] === true;
    prepareToggleRow(row, checked);
    row.innerHTML = `${radioMark(checked)}${esc('親子関係ハイライト')}`;
    row.addEventListener('click', () => {
      if (typeof bdPushUndo === 'function') bdPushUndo('ボード: 親子関係ハイライト');
      bd.displayFilters[key] = bd.displayFilters[key] !== true;
      closeMenu(true);
      bdApplyDisplayFilterChange(key);
      bdDirty();
    });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(menu, {
      trigger: anchor,
      close: () => closeMenu(false),
    });
  }
  if (typeof positionPopup === 'function') positionPopup(menu, rect);
  else {
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = (rect.left / z) + 'px';
    menu.style.top = (rect.bottom / z + 4) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  setTimeout(() => {
    closeHandler = event => {
      if (!menu.contains(event.target)) {
        closeMenu(false);
      }
    };
    document.addEventListener('pointerdown', closeHandler);
  }, 0);
  requestAnimationFrame(() => {
    if (menu.isConnected) menu.querySelector('.gb-context-menu-item')?.focus?.();
  });
}
