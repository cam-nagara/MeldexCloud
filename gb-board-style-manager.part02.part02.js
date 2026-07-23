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
      bdRender();
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
      bdRender();
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
      bdRender();
      bdDirty();
    });
    menu.appendChild(row);
  }
  // 共通タグによる絞り込み（このボードのカードに実際に付いているタグのみ表示）
  const _bdFilterMenuUsedTagIds = new Set();
  bd.nodes.forEach(n => { (Array.isArray(n.tags) ? n.tags : []).forEach(id => _bdFilterMenuUsedTagIds.add(String(id))); });
  if (_bdFilterMenuUsedTagIds.size) {
    const tagSep = document.createElement('div');
    tagSep.className = 'bd-cm-sep';
    menu.appendChild(tagSep);
    const tagHeading = document.createElement('div');
    tagHeading.className = 'gb-context-menu-heading';
    tagHeading.style.cssText = 'padding:4px 10px;font-size:11px;color:var(--fg2);';
    tagHeading.textContent = 'タグで絞り込み';
    menu.appendChild(tagHeading);
    const tagListHost = document.createElement('div');
    tagListHost.dataset.e2eId = 'bd-filter-tag-list';
    tagListHost.className = 'gb-section-desc';
    tagListHost.style.padding = '2px 10px';
    tagListHost.textContent = '読み込み中...';
    menu.appendChild(tagListHost);
    if (window.MeldexGlobalTags && typeof window.MeldexGlobalTags.loadTags === 'function') {
      window.MeldexGlobalTags.loadTags().then(data => {
        if (!menu.isConnected) return;
        const allTags = Array.isArray(data?.tags) ? data.tags : [];
        const groupsList = Array.isArray(data?.groups) ? data.groups : [];
        const groupsById = Object.fromEntries(groupsList.map(g => [g.id, g]));
        const usable = allTags.filter(tag => _bdFilterMenuUsedTagIds.has(String(tag.id)));
        tagListHost.textContent = '';
        tagListHost.style.padding = '';
        if (!usable.length) {
          tagListHost.textContent = '（該当するタグがありません）';
          tagListHost.style.padding = '2px 10px';
          return;
        }
        const activeTagFilter = new Set((bd.tagFilter || []).map(String));
        usable.forEach(tag => {
          const row = document.createElement('div');
          const checked = activeTagFilter.has(String(tag.id));
          prepareToggleRow(row, checked);
          const swatchColor = typeof window.MeldexGlobalTags.effectiveTagColor === 'function'
            ? window.MeldexGlobalTags.effectiveTagColor(tag, groupsById) : 'var(--accent)';
          row.dataset.e2eId = 'bd-filter-tag-' + String(tag.id);
          row.innerHTML = `${radioMark(checked)}<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:${esc(swatchColor)};"></span>${esc(tag.name || '')}`;
          row.addEventListener('click', () => {
            const next = new Set((bd.tagFilter || []).map(String));
            const tagIdStr = String(tag.id);
            if (next.has(tagIdStr)) next.delete(tagIdStr);
            else next.add(tagIdStr);
            bd.tagFilter = [...next];
            closeMenu(true);
            bdRender();
            bdDirty();
            if (typeof bdRefreshBoardToolbar === 'function') bdRefreshBoardToolbar();
          });
          tagListHost.appendChild(row);
        });
        if (activeTagFilter.size) {
          const clearRow = document.createElement('div');
          clearRow.className = 'gb-context-menu-item';
          clearRow.dataset.e2eId = 'bd-filter-tag-clear';
          clearRow.textContent = 'タグ絞り込みを解除';
          clearRow.addEventListener('click', () => {
            bd.tagFilter = [];
            closeMenu(true);
            bdRender();
            bdDirty();
            if (typeof bdRefreshBoardToolbar === 'function') bdRefreshBoardToolbar();
          });
          tagListHost.appendChild(clearRow);
        }
      }).catch(() => {
        if (menu.isConnected) tagListHost.textContent = 'タグを読み込めませんでした';
      });
    } else {
      tagListHost.textContent = '（タグ機能を読み込めませんでした）';
    }
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
