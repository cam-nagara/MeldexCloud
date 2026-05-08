    menu.appendChild(item);
  }
  function addSep() {
    const s = document.createElement('div');
    s.className = 'ab-dropdown-sep';
    menu.appendChild(s);
  }

  // 新規作成 サブメニュー
  const newItem = document.createElement('div');
  newItem.className = 'ab-dropdown-item';
  newItem.innerHTML = lucide('plus', 16) + ' 新規作成' + submenuArrow();
  newItem.style.position = 'relative';
  const subMenu = document.createElement('div');
  subMenu.className = 'ab-dropdown ab-sub-menu';
  subMenu.style.cssText = 'display:none;min-width:160px;';
  [
    ['フォルダ', 'folder', 'folder'],
    ['ノート', 'page', 'page'],
    ['シート', 'db', 'database'],
    ['ボード', 'presentation', 'board'],
    ['スマートシート', 'databaseSearch', 'smart-db'],
  ].forEach(([label, icon, type]) => {
    const si = document.createElement('div');
    si.className = 'ab-dropdown-item';
    si.innerHTML = lucide(icon, 16) + ' ' + label;
    si.addEventListener('click', (ev) => { ev.stopPropagation(); closeMenu(); showAddOutlinerItem(type); });
    subMenu.appendChild(si);
  });
  attachHoverSubmenu(newItem, subMenu);
  newItem.appendChild(subMenu);
  menu.appendChild(newItem);
  addSep();

  addItem('削除済みファイル', 'trash2', () => showTrashModal());
  addSep();
  addItem('設定', 'settings', () => showSettingsModal());

  document.body.appendChild(menu);
  const btn = _resolveAppBarButton(e);
  if (btn && typeof positionPopup === 'function') positionPopup(menu, btn.getBoundingClientRect());
  else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  const onPointerDown = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onClick = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onFocusIn = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') closeMenu();
  };
  menu._cleanupActivityMenu = () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('keydown', onKeyDown, true);
    menu._cleanupActivityMenu = null;
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('keydown', onKeyDown, true);
}

// パネルメニュー経由はメニューを開いたペインに新規タブを追加する（C案）
// → 既に他のパネルセットに同種のタブがあっても、新しく追加できる
const _openPanelMenuItem = (type, paneId) => {
  if (type === 'outliner' && window.MeldexCloudMobile?.toggleSidebarDrawer?.()) {
    return;
  }
  if (type === 'version') {
    if (typeof addPanelMenuVersion === 'function') addPanelMenuVersion({ paneId });
  } else if (typeof addPanelMenuTool === 'function') {
    addPanelMenuTool(type, { paneId });
  }
};

function _bindPanelMenuItem(row, action) {
  let touchHandled = false;
  const run = (ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    action();
  };
  row.addEventListener('pointerup', (ev) => {
    if (ev.pointerType === 'mouse') return;
    touchHandled = true;
    run(ev);
  });
  row.addEventListener('click', (ev) => {
    if (touchHandled) {
      touchHandled = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    run(ev);
  });
}

const PANEL_MENU_SECTIONS = [
  {
    title: '作業パネル',
    items: [
      { label: 'フォルダ', icon: 'folder', type: 'folder', open: (paneId) => _openPanelMenuItem('folder', paneId) },
      { label: 'ノート', icon: 'page', type: 'page', open: (paneId) => _openPanelMenuItem('page', paneId) },
      { label: 'シナリオ', icon: 'bookOpenText', type: 'scriptnote', open: (paneId) => _openPanelMenuItem('scriptnote', paneId) },
      { label: 'シート', icon: 'db', type: 'database', open: (paneId) => _openPanelMenuItem('database', paneId) },
      { label: 'ボード', icon: 'presentation', type: 'board', open: (paneId) => _openPanelMenuItem('board', paneId) },
      { label: 'スマートシート', icon: 'databaseSearch', type: 'smart-db', open: (paneId) => _openPanelMenuItem('smart-db', paneId) },
    ],
  },
  {
    title: '補助パネル',
    items: [
      { label: 'フォルダツリー', icon: 'folderTree', type: 'outliner', open: (paneId) => _openPanelMenuItem('outliner', paneId) },
      { label: 'ビューワー', icon: 'tvMinimal', type: 'preview', open: (paneId) => _openPanelMenuItem('preview', paneId) },
      { label: 'オプション', icon: 'panelRight', type: 'detail', open: (paneId) => _openPanelMenuItem('detail', paneId) },
      { label: 'バージョン管理', icon: 'gitBranch', type: 'version', open: (paneId) => _openPanelMenuItem('version', paneId) },
      { label: 'チャット', icon: 'messagesSquare', type: 'chat', open: (paneId) => _openPanelMenuItem('chat', paneId) },
      { label: 'カレンダー', icon: 'calendar', type: 'calendar', open: (paneId) => _openPanelMenuItem('calendar', paneId) },
      { label: 'タイマー', icon: 'timer', type: 'timer', open: (paneId) => _openPanelMenuItem('timer', paneId) },
      { label: 'ヒストリー', icon: 'history', type: 'history', open: (paneId) => _openPanelMenuItem('history', paneId) },
      { label: '注釈', icon: 'stickyNote', type: 'annotation', open: (paneId) => _openPanelMenuItem('annotation', paneId) },
    ],
  },
];

function showPanelMenu(e, options) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  e?.stopImmediatePropagation?.();
  const existing = document.querySelector('.ab-dropdown.ab-panel-menu');
  if (existing) {
    if (typeof existing._cleanupPanelMenu === 'function') existing._cleanupPanelMenu();
    _removeAppBarDropdowns();
    return;
  }
  _removeAppBarDropdowns();
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'ab-dropdown ab-panel-menu';
  menu.style.cssText = 'position:fixed;z-index:999;min-width:240px;';
  const targetPaneId = options?.paneId || (typeof GBLayout !== 'undefined' ? GBLayout.activePane : '');

  const closeMenu = () => {
    _removeAppBarDropdowns();
  };

  PANEL_MENU_SECTIONS.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      const sep = document.createElement('div');
      sep.className = 'ab-dropdown-sep';
      menu.appendChild(sep);
    }
    const title = document.createElement('div');
    title.style.cssText = 'padding:6px 12px 4px;font-size:11px;color:var(--fg2);text-transform:uppercase;letter-spacing:0.04em;';
    title.textContent = section.title;
    menu.appendChild(title);
    section.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'ab-dropdown-item';
      row.innerHTML = lucide(item.icon, 16) + ' ' + item.label;
      _bindPanelMenuItem(row, () => {
        closeMenu();
        item.open(targetPaneId);
      });
      menu.appendChild(row);
    });
  });

  document.body.appendChild(menu);
  const btn = _resolveAppBarButton(e);
  if (btn && typeof positionPopup === 'function') positionPopup(menu, btn.getBoundingClientRect());
  else if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  const onPointerDown = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onClick = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onFocusIn = (ev) => {
    if (_isAppBarDropdownTarget(ev.target, menu, btn)) return;
    closeMenu();
  };
  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') closeMenu();
  };
  menu._cleanupPanelMenu = () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('keydown', onKeyDown, true);
    menu._cleanupPanelMenu = null;
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('keydown', onKeyDown, true);
}

/* ==============================
   インポート / エクスポート メニュー
   ============================== */
function _showDropdownMenu(e, items, btnSelector) {
  const existing = document.querySelector('.ab-dropdown.ab-io-menu');
  if (existing) { existing.remove(); return; }
  const menu = document.createElement('div');
  menu.className = 'ab-dropdown ab-io-menu';
  items.forEach(item => {
    if (item === '---') {
      const s = document.createElement('div'); s.className = 'ab-dropdown-sep'; menu.appendChild(s); return;
    }
    const el = document.createElement('div');
    el.className = 'ab-dropdown-item';
    el.innerHTML = lucide(item[1], 16) + ' ' + item[0];
    el.addEventListener('click', () => { menu.remove(); item[2](); });
    menu.appendChild(el);
  });
  document.body.appendChild(menu);
  const btn = (e && e.target) ? e.target.closest('button') : document.querySelector(btnSelector);
  const rect = btn ? btn.getBoundingClientRect() : { right: window.innerWidth - 100, bottom: 40 };
  { const z = _getZoom(); menu.style.right = ((window.innerWidth - rect.right) / z) + 'px'; menu.style.top = (rect.bottom / z + 2) + 'px'; }
  requestAnimationFrame(() => {
    const z = _getZoom(); const mr = menu.getBoundingClientRect();
    if (mr.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - mr.height - 4) / z) + 'px';
  });
  setTimeout(() => {
    document.addEventListener('pointerdown', function closer(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', closer, true); }
    }, true);
  }, 0);
}

/* ==============================
   ルートフォルダ全体検索
   ============================== */
/* ==============================
   フォルダツリー ファイル名検索
   ============================== */
let _treeSearchQuery = '';

function doTreeNameSearch() {
  const input = document.getElementById('sidebar-search-input');
  const q = (input?.value || '').trim().toLowerCase();
  const clearBtn = document.getElementById('btn-tree-search-clear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';
  _treeSearchQuery = q;
  applyTreeNameSearch();
  if (typeof saveCurrentLayoutFilterState === 'function') saveCurrentLayoutFilterState();
}

function clearTreeNameSearch() {
  const input = document.getElementById('sidebar-search-input');
  if (input) input.value = '';
  _treeSearchQuery = '';
  const clearBtn = document.getElementById('btn-tree-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  applyTreeNameSearch();
  if (typeof saveCurrentLayoutFilterState === 'function') saveCurrentLayoutFilterState();
}

function applyTreeNameSearch() {
  const q = _treeSearchQuery;
  const includeEntities = typeof _getTreeSearchIncludeEntities === 'function'
    ? _getTreeSearchIncludeEntities()
    : localStorage.getItem('tree-search-include-entities') === 'true';
  const allNodes = document.querySelectorAll('#outliner-tree .tree-node');

  if (!q) {
    // 検索クリア: グローバルフィルタのみ適用状態に戻す
    applyGlobalFilter();
    return;
  }

  // パス1: マッチするノードにフラグを立てる
  allNodes.forEach(node => {
    const d = node._nodeData;
    const baseVisible = node.dataset.baseVisible !== '0';
    if (!d || !baseVisible) {
      node._searchMatch = false;
      return;
    }
    // フォルダ/ルートは名前マッチのみ
    if (d.type === 'folder' || d._isRoot || d.type === 'database') {
      node._searchMatch = d.name && d.name.toLowerCase().includes(q);
      return;
    }
    // エントリ: 設定次第
    if (d.type === 'entity') {
      node._searchMatch = includeEntities && d.name && d.name.toLowerCase().includes(q);
      return;
    }
    // ファイル: 名前マッチ
    node._searchMatch = d.name && d.name.toLowerCase().includes(q);
  });

  // パス2: マッチしたノードの祖先フォルダも表示
  allNodes.forEach(node => {
    if (node._searchMatch) {
      let parent = node.parentElement?.closest('.tree-node');
      while (parent) {
        if (parent.dataset.baseVisible !== '0') parent._searchAncestor = true;
        parent = parent.parentElement?.closest('.tree-node');
      }
    }
  });

  // パス3: 表示/非表示を設定 + マッチした子を持つフォルダを展開
  allNodes.forEach(node => {
    const d = node._nodeData;
    const baseVisible = node.dataset.baseVisible !== '0';
    if (!d || !baseVisible) {
      node.style.display = 'none';
      delete node._searchMatch;
      delete node._searchAncestor;
      return;
    }
    if (node._searchMatch || node._searchAncestor) {
      node.style.display = '';
      // 祖先フォルダが閉じていれば開く
      if (node._searchAncestor && (d.type === 'folder' || d.type === 'database' || d._isRoot)) {
        const toggle = node.querySelector(':scope > .tree-node-row .tree-toggle');
        const childrenDiv = node.querySelector(':scope > .tree-children');
        if (toggle && childrenDiv && toggle.dataset.expanded === 'false') {
          // まだロードされていないフォルダは展開（遅延ロード発火）
          toggle.click();
        } else if (childrenDiv) {
          childrenDiv.classList.remove('collapsed');
        }
      }
    } else {
      node.style.display = 'none';
    }
    delete node._searchMatch;
    delete node._searchAncestor;
  });
}

function openSearchPanel() {
  // サイドバーが非表示なら開く
  const sidebar = document.getElementById('sidebar');
  if (sidebar.style.display === 'none') toggleSidebar();
  const panel = document.getElementById('search-panel');
  delete panel.dataset.searchPath;
  panel.classList.add('open');
  document.getElementById('sp-query').focus();
}
function closeSearchPanel() {
  const panel = document.getElementById('search-panel');
  panel.classList.remove('open');
  delete panel.dataset.searchPath;
}

function _setVaultSearchReplaceMode(enabled) {
  const replaceToggle = document.getElementById('sp-show-replace');
  const replaceRow = document.getElementById('sp-replace-row');
  if (replaceToggle) replaceToggle.checked = !!enabled;
  if (replaceRow) replaceRow.style.display = enabled ? 'flex' : 'none';
}

function openVaultSearchReplacePanel(scopePath) {
  openSearchPanel();
  const panel = document.getElementById('search-panel');
  const path = String(scopePath || '').trim();
  if (path) panel.dataset.searchPath = path;
  else delete panel.dataset.searchPath;
  const folderOnly = document.getElementById('sp-folder-only');
  if (folderOnly) folderOnly.checked = !!path;
  _setVaultSearchReplaceMode(true);
  const q = document.getElementById('sp-query');
  if (q) q.focus();
}

function openCurrentToolbarSearchReplace(tool) {
  const normalized = String(tool || '').toLowerCase();
  if (normalized === 'page' || normalized === 'note') {
    if (typeof openFileSearch === 'function') openFileSearch();
    return;
  }
  if (normalized === 'board') {
    if (typeof bdOpenFindBar === 'function') bdOpenFindBar('replace');
    return;
  }
  if (normalized === 'database' || normalized === 'db' || normalized === 'sheet') {
    if (typeof showDbSearchModal === 'function') showDbSearchModal({ scope: 'current' });
    return;
  }
  if (normalized === 'folder') {
    const folderPath = (typeof _folderPath !== 'undefined' && _folderPath) ? _folderPath : '';
    openVaultSearchReplacePanel(folderPath);
    return;
  }
  if (typeof openFileSearch === 'function') openFileSearch();
}

function _selectedSearchFolderPath() {
  const panel = document.getElementById('search-panel');
  const scopedPath = panel?.dataset?.searchPath || '';
  if (scopedPath) return scopedPath;
  if (!treeSelection.lastClicked || !treeSelection.lastClicked._nodeData) return '';
  const nd = treeSelection.lastClicked._nodeData;
  if (nd.type === 'folder' || nd.type === 'database') return nd.path || '';
  const path = String(nd.path || '').replace(/\\/g, '/');
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

async function doVaultSearch() {
  const q = document.getElementById('sp-query').value;
  if (!q) return;
  const caseSensitive = document.getElementById('sp-case').checked;
  const useRegex = document.getElementById('sp-regex').checked;
  const folderOnly = document.getElementById('sp-folder-only').checked;
  const searchPath = folderOnly ? _selectedSearchFolderPath() : '';

  document.getElementById('sp-status').textContent = '検索中...';
  document.getElementById('sp-results').innerHTML = '';

  try {
    const params = new URLSearchParams({ q, case: caseSensitive, regex: useRegex });
    if (searchPath) params.set('path', searchPath);
    const data = await apiFetch('/search?' + params.toString());
    if (data.error) {
      const container = document.getElementById('sp-results');
      renderEmptyState(container, 'search', data.error, '検索語を確認してください');
      document.getElementById('sp-status').textContent = data.error;
      return;
    }
    renderSearchResults(data, q, caseSensitive, useRegex);
  } catch (e) {
    document.getElementById('sp-status').textContent = '検索エラー';
  }
}

function renderSearchResults(data, query, caseSensitive, useRegex) {
  const results = data.results || [];
  const container = document.getElementById('sp-results');
  if (results.length === 0) {
    renderEmptyState(container, 'search', '見つかりませんでした', '別のキーワードで検索してください');
    document.getElementById('sp-status').textContent = '0件';
    return;
  }

  let html = '';
  results.forEach(file => {
    const resultAttrs = `data-search-result-path="${esc(file.path)}" data-search-result-type="${esc(file.type)}"`;
    html += `<div class="sp-file" ${resultAttrs}>${esc(file.name)} <span style="font-weight:normal;color:var(--fg2);font-size:11px;">(${file.matches.length}件)</span></div>`;
    file.matches.slice(0, 20).forEach(m => {
      const text = m.text || '';
      const highlighted = highlightMatch(text, query, caseSensitive, useRegex);
      const lineInfo = m.field ? `${m.field}:${m.line}` : `L${m.line}`;
      html += `<div class="sp-match" ${resultAttrs}><span class="sp-line">${lineInfo}</span>${highlighted}</div>`;
    });
    if (file.matches.length > 20) {
      html += `<div class="sp-match" style="color:var(--fg2);font-style:italic;">...他 ${file.matches.length - 20}件</div>`;
    }
  });
  container.innerHTML = html;
  _bindVaultSearchResultClicks(container);
  document.getElementById('sp-status').textContent = `${data.total}件（${results.length}ファイル）`;
}

function _bindVaultSearchResultClicks(container) {
  if (!container || container._vaultSearchResultClickBound) return;
  container._vaultSearchResultClickBound = true;
  container.addEventListener('click', (e) => {
    const target = e.target.closest?.('[data-search-result-path]');
    if (!target || !container.contains(target)) return;
    e.preventDefault();
    openSearchResult(target.dataset.searchResultPath || '', target.dataset.searchResultType || '');
  });
}

function highlightMatch(text, query, caseSensitive, useRegex) {
  const source = String(text || '');
  const flags = caseSensitive ? 'g' : 'gi';
  try {
    if (useRegex) {
      const re = new RegExp(query, flags);
      let out = '';
      let lastIndex = 0;
      let match;
      while ((match = re.exec(source)) !== null) {
        const start = match.index;
        const matched = match[0] || '';
        const end = start + matched.length;
        if (end === start) {
          re.lastIndex += 1;
          continue;
        }
        out += esc(source.slice(lastIndex, start));
        out += `<span class="sp-highlight">${esc(source.slice(start, end))}</span>`;
        lastIndex = end;
      }
      return out + esc(source.slice(lastIndex));
    }
    const escaped = esc(source);
    const qEsc = esc(query);
    return escaped.replace(new RegExp(qEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags),
      m => `<span class="sp-highlight">${m}</span>`);
  } catch { return esc(source); }
}

function openSearchResult(path, type) {
  const _expOpts = { fromExplorer: true };
  if (type === 'scriptnote' || type === 'scenario') { if (typeof openScenarioInScriptNote === 'function') openScenarioInScriptNote(path, path.split('/').pop().replace(/\.\w+$/, ''), _expOpts); }
  else if (type === 'board') openBoard(path.split('/').pop().replace(/\.\w+$/, ''), path, _expOpts);
  else openPage(path.split('/').pop().replace(/\.\w+$/, ''), path, _expOpts);
}

async function doVaultReplace(all) {
  const q = document.getElementById('sp-query').value;
  const r = document.getElementById('sp-replace').value;
  if (!q) return;
  if (!await cfConfirm(`${all ? '全ファイルの全一致箇所' : '各ファイルの最初の一致箇所'}を置換しますか？\n\n「${q}」→「${r}」`)) return;

  const caseSensitive = document.getElementById('sp-case').checked;
  const useRegex = document.getElementById('sp-regex').checked;
  const folderOnly = document.getElementById('sp-folder-only').checked;
  const searchPath = folderOnly ? _selectedSearchFolderPath() : '';

  // まず検索して対象ファイルを取得
  const params = new URLSearchParams({ q, case: caseSensitive, regex: useRegex });
  if (searchPath) params.set('path', searchPath);
  const data = await apiFetch('/search?' + params.toString());
  if (data.error) {
    document.getElementById('sp-status').textContent = data.error;
    showStatus(data.error, true);
    return;
  }
  let totalCount = 0;

  for (const file of (data.results || [])) {
    try {
      const res = await apiPut('/replace', { path: file.path, search: q, replace: r, case: caseSensitive, regex: useRegex, all });
      totalCount += res.count || 0;
    } catch (e) {
      showStatus('置換に失敗: ' + (e.message || e), true);
    }
  }

  showStatus(`${totalCount}箇所を置換しました`);
  doVaultSearch(); // 結果を更新

  // 開いているファイルを再読み込み（置換結果を反映）
  try {
    const lastView = JSON.parse(localStorage.getItem('lastView') || '{}');
    if (lastView.type === 'page' && lastView.path) openPage(lastView.label || '', lastView.path);
    else if ((lastView.type === 'scriptnote' || lastView.type === 'scenario') && lastView.path && typeof openScenarioInScriptNote === 'function') {
      openScenarioInScriptNote(lastView.path, lastView.label || lastView.path.split('/').pop().replace(/\.\w+$/, ''));
    }
    else if (lastView.type === 'entity' && lastView.entityPath) selectEntity(lastView.entityPath);
    else if ((lastView.type === 'pivot' || lastView.type === 'database') && lastView.dbPath && typeof selectDatabase === 'function') {
      await selectDatabase(lastView.dbPath, null, { skipNavPush: true, skipRecent: true, skipAutoVersion: true });
    }
  } catch {}
}

// フォルダツリーへのファイルD&D
