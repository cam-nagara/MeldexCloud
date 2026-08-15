    } else if (el.childElementCount === 0) {
      // 初回レンダー時のみインデックス 0 で描画。既に描画済みの場合は現在の選択を保つ。
      _bdRenderDepthStyleInPanel(el, 0);
    }
  }
  if (typeof switchDetailTab === 'function') switchDetailTab('board-depth-style');
}

// 旧モーダルは廃止し、オプションパネルのカードスタイルタブに切り替える (コミットC)。
// タブコンテンツは _bdEnsureBoardStyleManagerTabs() 経由で _bdRenderStyleManagerInPanel が描画する。
function bdOpenCardStyleManager() {
  bdEnsureBoardUiState();
  if (typeof _bdEnsureBoardStyleManagerTabs === 'function') _bdEnsureBoardStyleManagerTabs();
  if (typeof showBoardTabs === 'function') showBoardTabs({ cardStyle: true });
  if (typeof switchDetailTab === 'function') switchDetailTab('board-card-style');
}

function bdOpenLineStyleManager() {
  bdEnsureBoardUiState();
  if (typeof _bdEnsureBoardStyleManagerTabs === 'function') _bdEnsureBoardStyleManagerTabs();
  if (typeof showBoardTabs === 'function') showBoardTabs({ lineStyle: true });
  if (typeof switchDetailTab === 'function') switchDetailTab('board-line-style');
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
  Object.entries(labels).forEach(([key, label]) => {
    const row = document.createElement('div');
    const checked = bd.displayFilters[key] !== false;
    prepareToggleRow(row, checked);
    row.innerHTML = `${radioMark(checked)}${esc(label)}`;
    row.addEventListener('click', () => {
      bd.displayFilters[key] = !(bd.displayFilters[key] !== false);
      closeMenu(true);
      _bdRenderKeepingDetailTab();
      bdDirty();
    });
    menu.appendChild(row);
  });
  // 表示モード: 既定 false / ON で有効（計画書 §4-3-A）
  const modes = [
    { key: '_showShadow', label: 'カード影' },
    { key: '_textRotateOnLine', label: 'ライン上テキスト回転' },
  ];
  modes.forEach(({ key, label }) => {
    const row = document.createElement('div');
    const checked = !!bd[key];
    prepareToggleRow(row, checked);
    row.innerHTML = `${radioMark(checked)}${esc(label)}`;
    row.addEventListener('click', () => {
      bd[key] = !bd[key];
      closeMenu(true);
      _bdRenderKeepingDetailTab();
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
      bd.displayFilters[key] = bd.displayFilters[key] !== true;
      closeMenu(true);
      _bdRenderKeepingDetailTab();
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
