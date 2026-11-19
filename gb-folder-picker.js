/* gb-folder-picker.js: shared in-app folder picker */
(function() {
  'use strict';

  if (window.GBFolderPicker) return;

  let _dialogSeq = 0;

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function _leafName(path) {
    const parts = _normalizePath(path).split('/').filter(Boolean);
    return parts[parts.length - 1] || _normalizePath(path) || 'フォルダ';
  }

  function _rootKind(root) {
    if (root?.kind === 'workspace' || root?.workspaceId) return 'workspace';
    if (root?.kind === 'home') return 'home';
    return 'source';
  }

  function _rootSectionLabel(kind) {
    if (kind === 'home') return 'ホームフォルダ';
    if (kind === 'workspace') return 'ワークスペース';
    return 'ソースフォルダ';
  }

  function _rootKey(root) {
    return _rootKind(root) + ':' + _normalizePath(root?.path || root?.rootPath).toLowerCase();
  }

  function _selectionFor(root, path, name, kind, type) {
    const normalizedPath = _normalizePath(path || root.path || root.rootPath);
    return {
      path: normalizedPath,
      name: name || _leafName(normalizedPath),
      rootPath: _normalizePath(root.rootPath || root.path),
      rootName: root.name || _leafName(root.rootPath || root.path),
      rootKind: _rootKind(root),
      sourceId: root.sourceId || '',
      workspaceId: root.workspaceId || '',
      kind: kind || 'folder',
      type: type || (kind === 'folder' ? 'folder' : ''),
    };
  }

  function _addRoot(list, root, seen) {
    const path = _normalizePath(root?.path || root?.rootPath);
    if (!path) return;
    const normalized = {
      ...root,
      path,
      rootPath: _normalizePath(root.rootPath || path),
      name: String(root.name || _leafName(path)),
      kind: _rootKind(root),
      visible: root.visible !== false,
    };
    const key = _rootKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    list.push(normalized);
  }

  async function loadRoots(options = {}) {
    const opts = {
      includeHome: options.includeHome !== false,
      includeSources: options.includeSources !== false,
      includeWorkspaces: options.includeWorkspaces !== false,
    };
    const roots = [];
    const seen = new Set();

    if (opts.includeHome) {
      try {
        const home = await apiFetch('/home-folder');
        const path = _normalizePath(home?.path || (typeof _homeFolderPath !== 'undefined' ? _homeFolderPath : ''));
        if (path) {
          _addRoot(roots, {
            name: typeof HOME_FOLDER_DISPLAY_LABEL !== 'undefined' ? HOME_FOLDER_DISPLAY_LABEL : 'ホームフォルダ',
            path,
            rootPath: path,
            kind: 'home',
            visible: true,
          }, seen);
        }
      } catch (_) {}
    }

    try {
      const payload = await apiFetch('/outliner-roots');
      (Array.isArray(payload) ? payload : []).forEach(root => {
        if (!root || root.visible === false || !root.path) return;
        const kind = _rootKind(root);
        if (kind === 'workspace' && !opts.includeWorkspaces) return;
        if (kind === 'source' && !opts.includeSources) return;
        _addRoot(roots, {
          name: root.name || _leafName(root.path),
          path: root.path,
          rootPath: root.path,
          kind,
          sourceId: kind === 'source' ? (root.sourceId || root.id || '') : '',
          workspaceId: root.workspaceId || '',
          visible: root.visible,
        }, seen);
      });
    } catch (_) {}

    if (opts.includeWorkspaces && window.MeldexWorkspaces?.load) {
      try {
        const rows = await window.MeldexWorkspaces.load({ force: true });
        (Array.isArray(rows) ? rows : []).forEach(workspace => {
          const path = _normalizePath(workspace?.folder || workspace?.localPath || workspace?.path);
          if (!path || workspace?.deleted === true) return;
          _addRoot(roots, {
            name: window.MeldexWorkspaces?.displayName?.(workspace) || workspace.name || _leafName(path),
            path,
            rootPath: path,
            kind: 'workspace',
            workspaceId: workspace.id || '',
            visible: workspace.visible !== false,
          }, seen);
        });
      } catch (_) {}
    }

    // 左のフォルダツリーパネルと同じ区分順・登録順（名前順に並べ替えない）
    const order = { workspace: 0, source: 1, home: 2 };
    roots.sort((a, b) => order[_rootKind(a)] - order[_rootKind(b)]);
    return roots;
  }

  function toSourceRelativePath(selection) {
    if (!selection?.path) return '';
    const path = _normalizePath(selection.path);
    const rootPath = _normalizePath(selection.rootPath);
    if (selection.rootKind === 'home') return path;
    const rootName = String(selection.rootName || _leafName(rootPath));
    if (!rootPath) return path;
    if (path === rootPath) return rootName;
    if (path.startsWith(rootPath + '/')) return rootName + '/' + path.slice(rootPath.length + 1);
    return path;
  }

  function _browseUrl(root, path, options) {
    const params = new URLSearchParams();
    params.set('path', _normalizePath(path || root.path || ''));
    params.set('root', _normalizePath(root.rootPath || root.path || ''));
    if (options && options.selectFiles) {
      // ファイルも選択できるモードでは、拡張子未対応ファイルまで含めて一覧できるよう all_files も付ける
      params.set('all_files', '1');
    } else {
      params.set('folders_only', '1');
    }
    params.set('sort', 'name');
    params.set('order', 'asc');
    if (root.sourceId) params.set('sourceId', root.sourceId);
    return '/browse?' + params.toString();
  }

  function _clearSelection(tree) {
    tree.querySelectorAll('[data-gb-folder-picker-selected="1"]').forEach(row => {
      delete row.dataset.gbFolderPickerSelected;
      if (row.getAttribute('role') === 'treeitem') row.setAttribute('aria-selected', 'false');
    });
  }

  function _markSelectedAcross(state, row) {
    _clearSelection(state.tree);
    if (state.searchResultsEl) _clearSelection(state.searchResultsEl);
    row.dataset.gbFolderPickerSelected = '1';
    if (row.getAttribute('role') === 'treeitem') row.setAttribute('aria-selected', 'true');
  }

  function _icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function _rowLabelText(selection) {
    if (!selection?.path) return '';
    if (selection.rootKind === 'home') return selection.path;
    return toSourceRelativePath(selection);
  }

  // 「選択中:」欄の表示更新。長いパスは実効幅に収めて「先頭…末尾ファイル名」形式で中略する。
  // meldex-coreが未ロードの環境で使われる可能性を考慮し、typeofガード+従来表示にフォールバックする。
  function _setCurrentPathText(el, text) {
    if (typeof applyMiddleEllipsis === 'function') applyMiddleEllipsis(el, text);
    else el.textContent = text;
  }

  // selectFiles モードで一覧に含めるファイルの種別アイコン（サーバの /browse type をそのまま解釈）
  const _FILE_TYPE_ICONS = {
    folder: 'folder', database: 'database', calendar: 'calendar',
    page: 'fileText', board: 'layoutGrid', chat: 'messagesSquare',
    scriptnote: 'bookOpenText', unsupported: 'fileQuestion',
    image: 'image', video: 'film', audio: 'music', html: 'globe', csv: 'fileSpreadsheet',
    document: 'fileText', archive: 'fileArchive', app: 'terminal', psd: 'image', clip: 'image', '3d': 'box',
  };

  function _fileIconForType(type) {
    return _FILE_TYPE_ICONS[type] || 'file';
  }

  function _createFolderNode(root, folder, depth, state) {
    const path = _normalizePath(folder.path || folder);
    const name = folder.name || _leafName(path);
    const isFile = !!(state.selectFiles && folder && folder.type && folder.type !== 'folder');
    const node = document.createElement('div');
    node.className = 'gb-folder-picker-node';

    const row = document.createElement('div');
    // 見た目は左のフォルダツリーパネルと同じ（UI共通ルール 4.1）。ルート行はアイコンなし・太字・区分背景
    row.className = depth === 0 ? 'gb-folder-picker-row is-root' : 'gb-folder-picker-row';
    row.dataset.gbPickerKind = isFile ? 'file' : 'folder';
    row.dataset.gbPickerName = String(name || '').toLocaleLowerCase('ja');
    row.dataset.gbPickerPath = String(path || '').toLocaleLowerCase('ja');
    row.dataset.path = path;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth + 1));
    row.setAttribute('aria-selected', 'false');
    if (!isFile) row.setAttribute('aria-expanded', 'false');
    row.tabIndex = 0;
    // 行の寸法・字下げ・選択表示は共通トークン（--ui-row-*）を使う CSS 側で決める
    row.style.setProperty('--gb-picker-depth', String(depth));

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gb-folder-picker-toggle';
    toggle.tabIndex = -1;
    toggle.title = '展開';
    toggle.setAttribute('aria-label', `${name}を展開`);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = _icon('chevronRight', 16);
    if (isFile) toggle.style.visibility = 'hidden';
    row.appendChild(toggle);

    if (depth > 0) {
      const icon = document.createElement('span');
      icon.className = 'gb-folder-picker-icon';
      const shared = window.MeldexFileIcons?.itemIconHtml;
      icon.innerHTML = typeof shared === 'function'
        ? shared({ ...(folder && typeof folder === 'object' ? folder : {}), path, type: isFile ? folder.type : (folder?.type || 'folder') }, 18)
        : _icon(isFile ? _fileIconForType(folder.type) : 'folder', 18);
      row.appendChild(icon);
    }

    const label = document.createElement('span');
    label.className = 'gb-folder-picker-label';
    label.textContent = name;
    row.appendChild(label);
    row.title = path;

    const children = document.createElement('div');
    children.className = 'gb-folder-picker-children';
    children.style.display = 'none';
    children.dataset.loaded = '0';

    const selectRow = (automatic = false) => {
      if (!automatic) state.userSelected = true;
      state.selected = _selectionFor(
        root, path, name, isFile ? 'file' : 'folder', isFile ? folder.type : 'folder',
      );
      _markSelectedAcross(state, row);
      _setCurrentPathText(state.current, _rowLabelText(state.selected));
      state.onSelect?.(state.selected, { automatic });
    };
    const activate = () => { state.onActivate?.(state.selected); };

    if (state.nodeByPath) state.nodeByPath.set(path, { row, selectRow, isFile, expand: null });

    if (isFile) {
      row.addEventListener('click', () => selectRow());
      row.addEventListener('dblclick', () => { selectRow(); activate(); });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectRow();
        if (event.key === 'Enter') activate();
      });
      node.appendChild(row);
      if (!state.userSelected && _normalizePath(state.initialPath) === path) selectRow(true);
      return node;
    }

    const expand = async () => {
      const expanded = children.style.display !== 'none';
      if (expanded) {
        children.style.display = 'none';
        row.setAttribute('aria-expanded', 'false');
        toggle.title = '展開';
        toggle.setAttribute('aria-label', `${name}を展開`);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.innerHTML = _icon('chevronRight', 16);
        if (typeof replaceIcons === 'function') replaceIcons(toggle);
        return;
      }
      children.style.display = '';
      row.setAttribute('aria-expanded', 'true');
      toggle.title = '折りたたむ';
      toggle.setAttribute('aria-label', `${name}を折りたたむ`);
      toggle.setAttribute('aria-expanded', 'true');
      toggle.innerHTML = _icon('chevronDown', 16);
      if (typeof replaceIcons === 'function') replaceIcons(toggle);
      if (children.dataset.loaded === '1') return;
      children.dataset.loaded = '1';
      const loading = document.createElement('div');
      loading.textContent = '読み込み中...';
      loading.className = 'gb-folder-picker-message';
      loading.style.setProperty('--gb-picker-depth', String(depth + 1));
      children.appendChild(loading);
      try {
        const payload = await apiFetch(_browseUrl(root, path, { selectFiles: state.selectFiles }), { skipBrowseCache: true });
        const rows = (Array.isArray(payload) ? payload : (payload.items || []))
          .filter(item => item?.path && (item?.type === 'folder' || (state.selectFiles
            && (!state.fileTypes || state.fileTypes.includes(item.type))
            && (typeof state.fileFilter !== 'function' || state.fileFilter(item)))));
        rows.sort((a, b) => {
          const aFolder = a.type === 'folder' ? 0 : 1;
          const bFolder = b.type === 'folder' ? 0 : 1;
          if (aFolder !== bFolder) return aFolder - bFolder;
          const order = String(a.name || '').localeCompare(String(b.name || ''), 'ja');
          return state.sortDirection === 'desc' ? -order : order;
        });
        children.innerHTML = '';
        if (!rows.length) {
          const empty = document.createElement('div');
          empty.textContent = state.emptyText || (state.selectFiles ? 'この階層にファイル・フォルダはありません。' : 'この階層にフォルダはありません。');
          empty.className = 'gb-folder-picker-message';
        empty.style.setProperty('--gb-picker-depth', String(depth + 1));
          children.appendChild(empty);
          toggle.style.visibility = 'hidden';
          return;
        }
        rows.forEach(item => children.appendChild(_createFolderNode(root, item, depth + 1, state)));
        state.applyTreeView?.();
      } catch (error) {
        children.innerHTML = '';
        const failed = document.createElement('div');
        failed.textContent = 'フォルダ一覧を読み込めませんでした。';
        failed.className = 'gb-folder-picker-message is-error';
        failed.style.setProperty('--gb-picker-depth', String(depth + 1));
        children.appendChild(failed);
      }
    };
    if (state.nodeByPath) {
      const entry = state.nodeByPath.get(path);
      if (entry) entry.expand = expand;
    }

    const foldersSelectable = state.selectFolders !== false;
    row.addEventListener('click', (event) => {
      if (event.target === toggle || toggle.contains(event.target)) return;
      if (foldersSelectable) selectRow();
      else expand();
    });
    if (foldersSelectable) {
      row.addEventListener('dblclick', () => {
        selectRow();
        activate();
      });
    }
    row.addEventListener('keydown', (event) => {
      const expanded = children.style.display !== 'none';
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (!expanded) expand();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (expanded) expand();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!foldersSelectable) { expand(); return; }
        selectRow();
        if (event.key === 'Enter') activate();
      }
    });
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      expand();
    });

    node.appendChild(row);
    node.appendChild(children);
    if (!state.userSelected && _normalizePath(state.initialPath) === path) selectRow(true);
    return node;
  }

  // revealPath 用: ルートから対象パスまでの祖先フォルダを順に展開し、最後に対象行を選択状態にする
  async function _revealPath(state, targetPath) {
    const target = _normalizePath(targetPath);
    if (!target || !Array.isArray(state.roots)) return;
    let bestRoot = null;
    let bestRootPath = '';
    state.roots.forEach(root => {
      const rp = _normalizePath(root.rootPath || root.path);
      if (!rp) return;
      if (target === rp || target.startsWith(rp + '/')) {
        if (rp.length >= bestRootPath.length) { bestRoot = root; bestRootPath = rp; }
      }
    });
    if (!bestRoot) return;
    const segments = target === bestRootPath ? [] : target.slice(bestRootPath.length + 1).split('/').filter(Boolean);
    let currentPath = bestRootPath;
    for (let i = 0; i < segments.length; i++) {
      const entry = state.nodeByPath.get(currentPath);
      if (!entry || entry.isFile || typeof entry.expand !== 'function') return;
      await entry.expand();
      currentPath = currentPath + '/' + segments[i];
    }
    const finalEntry = state.nodeByPath.get(currentPath);
    if (finalEntry && !state.userSelected) {
      finalEntry.selectRow(true);
      if (typeof finalEntry.row.scrollIntoView === 'function') {
        finalEntry.row.scrollIntoView({ block: 'center' });
      }
    }
  }

  // フォルダツリーからフォルダ/ファイルを選ぶ共通ブラウザ。ダイアログ本文へ埋め込める。
  // pickFolder() はこれを共通ダイアログに載せたもの。独自のツリーをダイアログ内に作らず、これを使う。
  function createBrowser(options = {}) {
    const body = document.createElement('div');
    body.className = 'gb-folder-picker-body';
    // 共通部品の目印。ダイアログ側の一括装飾（タッチ用拡大など）はこの中の部品に触れない（UI共通ルール 4.0）
    body.dataset.uiComponent = 'folder-picker';

    const currentRow = document.createElement('div');
    currentRow.className = 'gb-folder-picker-current-row';
    currentRow.dataset.e2eId = 'gb-folder-picker-current-row';
    currentRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--fg2);margin-bottom:8px;';
    const currentLabel = document.createElement('span');
    currentLabel.textContent = options.currentLabel || '選択中:';
    currentLabel.style.whiteSpace = 'nowrap';
    const current = document.createElement('code');
    current.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--fg);';
    current.textContent = options.initialPath || '未選択';
    currentRow.appendChild(currentLabel);
    currentRow.appendChild(current);
    body.appendChild(currentRow);

    const tools = document.createElement('div');
    tools.className = 'gb-folder-picker-tools';
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'gb-input gb-folder-picker-search';
    searchInput.dataset.e2eId = 'gb-folder-picker-search';
    searchInput.placeholder = options.searchPlaceholder || '名前・パスを検索';
    searchInput.setAttribute('aria-label', 'フォルダやファイルを検索');
    const sortSelect = document.createElement('select');
    sortSelect.className = 'gb-input gb-folder-picker-sort';
    sortSelect.dataset.e2eId = 'gb-folder-picker-sort';
    sortSelect.setAttribute('aria-label', '並び順');
    sortSelect.innerHTML = '<option value="asc">名前 昇順</option><option value="desc">名前 降順</option>';
    const filterSelect = document.createElement('select');
    filterSelect.className = 'gb-input gb-folder-picker-filter';
    filterSelect.dataset.e2eId = 'gb-folder-picker-filter';
    filterSelect.setAttribute('aria-label', '表示する種類');
    filterSelect.innerHTML = options.selectFiles
      ? '<option value="all">すべて</option><option value="folder">フォルダ</option><option value="file">ファイル</option>'
      : '<option value="folder">フォルダ</option>';
    [searchInput, sortSelect, filterSelect].forEach(control => {
      tools.appendChild(control);
    });
    body.appendChild(tools);

    const tree = document.createElement('div');
    tree.className = 'gb-folder-picker-tree';
    tree.dataset.e2eId = 'gb-folder-picker-tree';
    tree.setAttribute('role', 'tree');
    tree.style.cssText = 'flex:1;min-height:0;overflow:auto;border:1px solid var(--border);border-radius:4px;background:var(--bg);padding:4px;';
    body.appendChild(tree);

    let searchResults = null;
    if (typeof options.searchProvider === 'function') {
      searchResults = document.createElement('div');
      searchResults.className = 'gb-folder-picker-search-results';
      searchResults.style.cssText = tree.style.cssText;
      searchResults.style.display = 'none';
      body.appendChild(searchResults);
    }

    const status = document.createElement('div');
    status.className = 'gb-folder-picker-status';
    status.dataset.e2eId = 'gb-folder-picker-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'min-height:18px;font-size:12px;color:var(--fg2);margin-top:6px;';
    body.appendChild(status);

    const state = {
      tree,
      current,
      selected: null,
      initialPath: options.initialPath || '',
      selectFiles: !!options.selectFiles,
      fileTypes: Array.isArray(options.fileTypes) && options.fileTypes.length ? options.fileTypes.slice() : null,
      emptyText: options.emptyText || '',
      nodeByPath: new Map(),
      searchResultsEl: searchResults,
      sortDirection: 'asc',
      filterKind: options.selectFiles ? 'all' : 'folder',
      roots: null,
      selectFolders: options.selectFolders !== false,
      fileFilter: typeof options.fileFilter === 'function' ? options.fileFilter : null,
      onSelect: typeof options.onSelect === 'function' ? options.onSelect : null,
      onActivate: typeof options.onActivate === 'function' ? options.onActivate : null,
    };

    let searchItemsCache = null;
    async function _ensureSearchItems() {
      if (searchItemsCache) return searchItemsCache;
      try {
        const list = await options.searchProvider();
        searchItemsCache = Array.isArray(list) ? list : [];
      } catch (_) {
        searchItemsCache = [];
      }
      return searchItemsCache;
    }

    function _renderSearchResults(items, query) {
      searchResults.innerHTML = '';
      const q = String(query || '').toLowerCase().trim();
      const filtered = items.filter(d => !q || String(d.name || '').toLowerCase().includes(q) || String(d.path || '').toLowerCase().includes(q));
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.textContent = '該当なし';
        empty.style.cssText = 'padding:8px;font-size:12px;color:var(--fg2);';
        searchResults.appendChild(empty);
        return;
      }
      filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
      filtered.forEach(d => {
        const row = document.createElement('div');
        row.className = 'gb-folder-picker-row';
        row.style.setProperty('--gb-picker-depth', '0');
        const icon = document.createElement('span');
        icon.style.cssText = 'width:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;';
        icon.innerHTML = _icon('database', 14);
        row.appendChild(icon);
        const label = document.createElement('span');
        label.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
        label.textContent = d.name || _leafName(d.path);
        row.appendChild(label);
        if (d.rootName || d.relPath) {
          const sub = document.createElement('span');
          sub.style.cssText = 'font-size:11px;color:var(--fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%;';
          sub.textContent = d.rootName ? (d.rootName + (d.relPath ? ' / ' + d.relPath : '')) : (d.relPath || '');
          row.appendChild(sub);
        }
        row.title = d.path || '';
        const selectThis = () => {
          const matchedRoot = Array.isArray(state.roots) ? state.roots.find(r => {
            const rp = _normalizePath(r.rootPath || r.path);
            return rp && (_normalizePath(d.path) === rp || _normalizePath(d.path).startsWith(rp + '/'));
          }) : null;
          state.selected = matchedRoot
            ? _selectionFor(matchedRoot, d.path, d.name, 'file', d.type)
            : { path: _normalizePath(d.path), name: d.name || _leafName(d.path), rootPath: '', rootName: d.rootName || '', rootKind: 'source', sourceId: '', workspaceId: '', kind: 'file', type: d.type || '' };
          _markSelectedAcross(state, row);
          _setCurrentPathText(state.current, matchedRoot ? _rowLabelText(state.selected) : (d.path || d.name || ''));
          state.onSelect?.(state.selected, { automatic: false });
        };
        row.addEventListener('click', selectThis);
        row.addEventListener('dblclick', () => { selectThis(); state.onActivate?.(state.selected); });
        searchResults.appendChild(row);
      });
    }

    function _applyLocalTreeView() {
      if (typeof options.searchProvider === 'function') return;
      const query = searchInput.value.toLocaleLowerCase('ja').trim();
      const visit = node => {
        const row = node.querySelector(':scope > .gb-folder-picker-row');
        const children = node.querySelector(':scope > .gb-folder-picker-children');
        const childNodes = children ? [...children.children].filter(child => child.classList?.contains('gb-folder-picker-node')) : [];
        // some() は最初の一致で止まり後続の兄弟が判定されないため、全件を判定してから集計する
        const descendantVisible = childNodes.map(visit).some(Boolean);
        const kind = row?.dataset.gbPickerKind || 'folder';
        const kindVisible = state.filterKind === 'all' || kind === state.filterKind || (state.filterKind === 'file' && kind === 'folder');
        const matches = !query || row?.dataset.gbPickerName?.includes(query) || row?.dataset.gbPickerPath?.includes(query);
        const visible = !!row && kindVisible && (matches || descendantVisible || (!query && state.filterKind === 'file' && kind === 'folder'));
        node.hidden = !visible;
        return visible;
      };
      tree.querySelectorAll(':scope > .gb-folder-picker-node').forEach(visit);
    }
    state.applyTreeView = _applyLocalTreeView;

    searchInput.addEventListener('input', async () => {
      if (typeof options.searchProvider !== 'function') {
        _applyLocalTreeView();
        return;
      }
        const query = searchInput.value;
        if (!query.trim()) {
          searchResults.style.display = 'none';
          tree.style.display = '';
          return;
        }
        tree.style.display = 'none';
        searchResults.style.display = '';
        searchResults.textContent = '読み込み中...';
        const items = await _ensureSearchItems();
        if (searchInput.value !== query) return;
        _renderSearchResults(items, query);
    });
    filterSelect.addEventListener('change', () => {
      state.filterKind = filterSelect.value;
      if (typeof options.searchProvider === 'function' && searchInput.value.trim()) {
        _ensureSearchItems().then(items => _renderSearchResults(items, searchInput.value));
      } else _applyLocalTreeView();
    });
    sortSelect.addEventListener('change', () => {
      state.sortDirection = sortSelect.value;
      state.nodeByPath.clear();
      searchItemsCache = null;
      searchInput.value = '';
      searchResults && (searchResults.style.display = 'none');
      tree.style.display = '';
      renderRoots();
    });

    let loadedRoots = null;
    async function renderRoots() {
      tree.textContent = 'フォルダを読み込み中...';
      status.textContent = '';
      status.style.color = '';
      try {
      const roots = loadedRoots || await loadRoots(options);
      loadedRoots = roots;
      state.roots = roots;
      tree.innerHTML = '';
      if (!roots.length) {
        status.textContent = '選択できるフォルダがありません。';
        return;
      }
      // ルートはパネルと同じ区分順・登録順で出す（区分見出しが重複しない）。並び順の指定は各フォルダの中身に効く。
      // パネルと同じく、ルートが無い区分も見出しだけは出す（表示対象から外した区分は出さない）
      const sectionKinds = [];
      if (options.includeWorkspaces !== false) sectionKinds.push('workspace');
      if (options.includeSources !== false) sectionKinds.push('source');
      if (options.includeHome !== false) sectionKinds.push('home');
      const entries = [];
      sectionKinds.forEach(kind => {
        const inKind = roots.filter(root => _rootKind(root) === kind);
        if (!inKind.length) entries.push({ kind, root: null });
        inKind.forEach(root => entries.push({ kind, root }));
      });
      let lastSection = '';
      entries.forEach(({ kind, root }) => {
        const section = _rootSectionLabel(kind);
        if (section !== lastSection) {
          // パネルの区分見出しと同じ形（開閉の三角＋区分名）。押すとその区分のルートを畳む
          const heading = document.createElement('button');
          heading.type = 'button';
          heading.className = 'gb-folder-picker-section';
          heading.setAttribute('aria-expanded', 'true');
          const chevron = document.createElement('span');
          chevron.className = 'sidebar-section-toggle expanded';
          chevron.innerHTML = _icon('chevronRight', 10);
          const text = document.createElement('span');
          text.textContent = section;
          heading.append(chevron, text);
          heading.addEventListener('click', () => {
            const open = heading.getAttribute('aria-expanded') !== 'true';
            heading.setAttribute('aria-expanded', open ? 'true' : 'false');
            chevron.classList.toggle('expanded', open);
            let next = heading.nextElementSibling;
            while (next && !next.classList.contains('gb-folder-picker-section')) {
              next.classList.toggle('is-section-collapsed', !open);
              next = next.nextElementSibling;
            }
          });
          tree.appendChild(heading);
          lastSection = section;
        }
        if (root) tree.appendChild(_createFolderNode(root, { name: root.name, path: root.path }, 0, state));
      });
      if (typeof replaceIcons === 'function') replaceIcons(tree);
      if (options.revealPath) {
        try { await _revealPath(state, options.revealPath); } catch (_) {}
      }
    } catch (error) {
      tree.textContent = '';
      status.textContent = 'フォルダ一覧を読み込めませんでした。';
      status.style.color = 'var(--red)';
    }
    }
    return {
      element: body,
      tree,
      searchInput,
      status,
      state,
      // DOM接続後に呼ぶ。中略表示は実効幅が必要なため接続前には行わない
      start() {
        _setCurrentPathText(current, options.initialPath || '未選択');
        return renderRoots().then(() => state.roots || []);
      },
      reload() {
        loadedRoots = null;
        state.nodeByPath.clear();
        return renderRoots().then(() => state.roots || []);
      },
      getSelection: () => state.selected,
    };
  }

  function pickFolder(options = {}) {
    return new Promise(async resolve => {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'gb-btn gb-btn-sm gb-btn-quiet';
      cancel.dataset.e2eId = 'gb-folder-picker-cancel';
      cancel.textContent = 'キャンセル';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'gb-btn gb-btn-sm primary gb-btn-primary';
      ok.dataset.e2eId = 'gb-folder-picker-select';
      ok.textContent = '選択';
      ok.disabled = true;
      let closed = false;
      const browser = createBrowser({
        ...options,
        onSelect: () => { ok.disabled = false; },
        onActivate: selection => close(selection),
      });
      const body = browser.element;
      const searchInput = browser.searchInput;
      const tree = browser.tree;
      const state = browser.state;
      let modalApi = null;
      const close = value => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeyDown, true);
        modalApi?.close(value ? 'submit' : 'cancel');
        resolve(value || null);
      };
      const onKeyDown = event => {
        // ツリー行のEnterは行側で選択してから確定するため、ここでは古い選択で閉じない
        if (event.target?.closest?.('.gb-folder-picker-tree, .gb-folder-picker-search-results')) return;
        if (event.key === 'Enter' && state?.selected) close(state.selected);
      };
      modalApi = window.GBUI.createModal({
        id: `gb-folder-picker-${++_dialogSeq}`,
        title: options.title || 'フォルダを選択',
        body,
        footer: [cancel, ok],
        variant: 'mobile-sheet',
        extraClass: 'gb-folder-picker-modal',
        initialFocus: () => searchInput || tree,
        closeLabel: 'フォルダ選択を閉じる',
        closeOnEsc: true,
        closeOnOverlay: true,
        onClose: () => {
          document.removeEventListener('keydown', onKeyDown, true);
          if (closed) return;
          closed = true;
          resolve(null);
        },
      });
      const overlay = modalApi.overlay;
      const modal = modalApi.modal;
      overlay.dataset.gbFolderPicker = '1';
      overlay.dataset.e2eId = 'gb-folder-picker-overlay';
      modal.dataset.e2eId = 'gb-folder-picker-dialog';
      modalApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'gb-folder-picker-header-close');
      modalApi.footer.classList.add('gb-folder-picker-actions');
      modalApi.open();
      if (typeof replaceIcons === 'function') replaceIcons(overlay);

      document.addEventListener('keydown', onKeyDown, true);
      cancel.addEventListener('click', () => close(null));
      ok.addEventListener('click', () => close(state.selected));
      await browser.start();
    });
  }

  window.GBFolderPicker = {
    loadRoots,
    createBrowser,
    pickFolder,
    toSourceRelativePath,
  };
})();
