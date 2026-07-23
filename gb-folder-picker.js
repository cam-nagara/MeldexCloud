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
    if (kind === 'workspace') return 'ワークスペースフォルダ';
    return 'ソースフォルダ';
  }

  function _rootIcon(kind) {
    if (kind === 'home') return 'home';
    if (kind === 'workspace') return 'usersRound';
    return 'folderTree';
  }

  function _rootKey(root) {
    return _rootKind(root) + ':' + _normalizePath(root?.path || root?.rootPath).toLowerCase();
  }

  function _selectionFor(root, path, name, kind) {
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

    const order = { home: 0, source: 1, workspace: 2 };
    roots.sort((a, b) => (order[_rootKind(a)] - order[_rootKind(b)]) || String(a.name).localeCompare(String(b.name), 'ja'));
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
      row.style.background = '';
      row.style.color = '';
    });
  }

  function _markSelectedAcross(state, row) {
    _clearSelection(state.tree);
    if (state.searchResultsEl) _clearSelection(state.searchResultsEl);
    row.dataset.gbFolderPickerSelected = '1';
    row.style.background = 'var(--accent)';
    row.style.color = 'var(--ui-fg-strong)';
  }

  function _icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function _rowLabelText(selection) {
    if (!selection?.path) return '';
    if (selection.rootKind === 'home') return selection.path;
    return toSourceRelativePath(selection);
  }

  // selectFiles モードで一覧に含めるファイルの種別アイコン（サーバの /browse type をそのまま解釈）
  const _FILE_TYPE_ICONS = {
    folder: 'folder', database: 'database', calendar: 'calendar',
    page: 'fileText', board: 'layoutGrid', chat: 'messagesSquare',
    'smart-db': 'database', scriptnote: 'bookOpenText', timer: 'timer',
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
    row.className = 'gb-folder-picker-row';
    row.style.cssText = `display:flex;align-items:center;gap:5px;min-height:28px;padding:4px 8px 4px ${8 + depth * 16}px;border-radius:4px;cursor:pointer;font-size:12px;`;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gb-folder-picker-toggle';
    toggle.title = '展開';
    toggle.setAttribute('aria-label', `${name}を展開`);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.style.cssText = 'width:18px;height:22px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;background:transparent;color:inherit;flex-shrink:0;';
    toggle.innerHTML = _icon('chevronRight', 12);
    if (isFile) toggle.style.visibility = 'hidden';
    row.appendChild(toggle);

    const icon = document.createElement('span');
    icon.style.cssText = 'width:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;';
    icon.innerHTML = _icon(depth === 0 ? _rootIcon(_rootKind(root)) : (isFile ? _fileIconForType(folder.type) : 'folder'), 14);
    row.appendChild(icon);

    const label = document.createElement('span');
    label.textContent = name;
    label.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    row.appendChild(label);
    row.title = path;

    const children = document.createElement('div');
    children.className = 'gb-folder-picker-children';
    children.style.display = 'none';
    children.dataset.loaded = '0';

    const selectRow = () => {
      state.selected = _selectionFor(root, path, name, isFile ? 'file' : 'folder');
      _markSelectedAcross(state, row);
      state.current.textContent = _rowLabelText(state.selected);
      state.ok.disabled = false;
    };

    if (state.nodeByPath) state.nodeByPath.set(path, { row, selectRow, isFile, expand: null });

    if (isFile) {
      row.addEventListener('click', () => selectRow());
      row.addEventListener('dblclick', () => { selectRow(); state.close(state.selected); });
      row.addEventListener('mouseenter', () => { if (!row.dataset.gbFolderPickerSelected) row.style.background = 'var(--bg3)'; });
      row.addEventListener('mouseleave', () => { if (!row.dataset.gbFolderPickerSelected) row.style.background = ''; });
      node.appendChild(row);
      if (_normalizePath(state.initialPath) === path) selectRow();
      return node;
    }

    const expand = async () => {
      const expanded = children.style.display !== 'none';
      if (expanded) {
        children.style.display = 'none';
        toggle.title = '展開';
        toggle.setAttribute('aria-label', `${name}を展開`);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.innerHTML = _icon('chevronRight', 12);
        if (typeof replaceIcons === 'function') replaceIcons(toggle);
        return;
      }
      children.style.display = '';
      toggle.title = '折りたたむ';
      toggle.setAttribute('aria-label', `${name}を折りたたむ`);
      toggle.setAttribute('aria-expanded', 'true');
      toggle.innerHTML = _icon('chevronDown', 12);
      if (typeof replaceIcons === 'function') replaceIcons(toggle);
      if (children.dataset.loaded === '1') return;
      children.dataset.loaded = '1';
      const loading = document.createElement('div');
      loading.textContent = '読み込み中...';
      loading.style.cssText = `padding:3px 8px 3px ${26 + (depth + 1) * 16}px;font-size:11px;color:var(--fg2);`;
      children.appendChild(loading);
      try {
        const payload = await apiFetch(_browseUrl(root, path, { selectFiles: state.selectFiles }));
        const rows = (Array.isArray(payload) ? payload : (payload.items || []))
          .filter(item => item?.path && (item?.type === 'folder' || (state.selectFiles && (!state.fileTypes || state.fileTypes.includes(item.type)))));
        rows.sort((a, b) => {
          const aFolder = a.type === 'folder' ? 0 : 1;
          const bFolder = b.type === 'folder' ? 0 : 1;
          if (aFolder !== bFolder) return aFolder - bFolder;
          return String(a.name || '').localeCompare(String(b.name || ''), 'ja');
        });
        children.innerHTML = '';
        if (!rows.length) {
          const empty = document.createElement('div');
          empty.textContent = state.emptyText || (state.selectFiles ? 'この階層にファイル・フォルダはありません。' : 'この階層にフォルダはありません。');
          empty.style.cssText = `padding:3px 8px 3px ${26 + (depth + 1) * 16}px;font-size:11px;color:var(--fg2);`;
          children.appendChild(empty);
          toggle.style.visibility = 'hidden';
          return;
        }
        rows.forEach(item => children.appendChild(_createFolderNode(root, item, depth + 1, state)));
      } catch (error) {
        children.innerHTML = '';
        const failed = document.createElement('div');
        failed.textContent = 'フォルダ一覧を読み込めませんでした。';
        failed.style.cssText = `padding:3px 8px 3px ${26 + (depth + 1) * 16}px;font-size:11px;color:var(--red);`;
        children.appendChild(failed);
      }
    };
    if (state.nodeByPath) {
      const entry = state.nodeByPath.get(path);
      if (entry) entry.expand = expand;
    }

    row.addEventListener('click', (event) => {
      if (event.target === toggle || toggle.contains(event.target)) return;
      selectRow();
    });
    row.addEventListener('dblclick', () => {
      selectRow();
      state.close(state.selected);
    });
    row.addEventListener('mouseenter', () => { if (!row.dataset.gbFolderPickerSelected) row.style.background = 'var(--bg3)'; });
    row.addEventListener('mouseleave', () => { if (!row.dataset.gbFolderPickerSelected) row.style.background = ''; });
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      expand();
    });

    node.appendChild(row);
    node.appendChild(children);
    if (_normalizePath(state.initialPath) === path) selectRow();
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
    if (finalEntry) {
      finalEntry.selectRow();
      if (typeof finalEntry.row.scrollIntoView === 'function') {
        finalEntry.row.scrollIntoView({ block: 'center' });
      }
    }
  }

  function pickFolder(options = {}) {
    return new Promise(async resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.dataset.gbFolderPicker = '1';
      overlay.dataset.modalShell = 'off';

      const modal = document.createElement('div');
      modal.className = 'modal gb-folder-picker-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.style.cssText = 'width:560px;height:620px;max-width:min(92vw,560px);max-height:86vh;display:flex;flex-direction:column;';
      overlay.appendChild(modal);

      const title = document.createElement('h3');
      title.id = `gb-folder-picker-title-${++_dialogSeq}`;
      title.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const titleIcon = document.createElement('span');
      titleIcon.innerHTML = _icon('folderTree', 16);
      title.appendChild(titleIcon);
      title.appendChild(document.createTextNode(options.title || 'フォルダを選択'));
      modal.setAttribute('aria-labelledby', title.id);
      modal.appendChild(title);

      const currentRow = document.createElement('div');
      currentRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--fg2);margin-bottom:8px;';
      const currentLabel = document.createElement('span');
      currentLabel.textContent = options.currentLabel || '選択中:';
      currentLabel.style.whiteSpace = 'nowrap';
      const current = document.createElement('code');
      current.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--fg);';
      current.textContent = options.initialPath || '未選択';
      currentRow.appendChild(currentLabel);
      currentRow.appendChild(current);
      modal.appendChild(currentRow);

      let searchInput = null;
      if (typeof options.searchProvider === 'function') {
        searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'gb-folder-picker-search';
        searchInput.placeholder = options.searchPlaceholder || '検索...';
        searchInput.style.cssText = 'margin-bottom:8px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--fg);font-size:12px;';
        modal.appendChild(searchInput);
      }

      const tree = document.createElement('div');
      tree.className = 'gb-folder-picker-tree';
      tree.style.cssText = 'flex:1;min-height:0;overflow:auto;border:1px solid var(--border);border-radius:4px;background:var(--bg);padding:4px;';
      modal.appendChild(tree);

      let searchResults = null;
      if (searchInput) {
        searchResults = document.createElement('div');
        searchResults.className = 'gb-folder-picker-search-results';
        searchResults.style.cssText = tree.style.cssText;
        searchResults.style.display = 'none';
        modal.appendChild(searchResults);
      }

      const status = document.createElement('div');
      status.style.cssText = 'min-height:18px;font-size:12px;color:var(--fg2);margin-top:6px;';
      modal.appendChild(status);

      const buttonRow = document.createElement('div');
      buttonRow.className = 'btn-row';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'キャンセル';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'primary';
      ok.textContent = '選択';
      ok.disabled = true;
      buttonRow.appendChild(cancel);
      buttonRow.appendChild(ok);
      modal.appendChild(buttonRow);

      document.body.appendChild(overlay);
      if (typeof replaceIcons === 'function') replaceIcons(overlay);
      if (searchInput) searchInput.focus();

      const state = {
        tree,
        current,
        ok,
        selected: null,
        initialPath: options.initialPath || '',
        selectFiles: !!options.selectFiles,
        fileTypes: Array.isArray(options.fileTypes) && options.fileTypes.length ? options.fileTypes.slice() : null,
        emptyText: options.emptyText || '',
        nodeByPath: new Map(),
        searchResultsEl: searchResults,
        roots: null,
        close: value => close(value),
      };
      let closed = false;
      const close = value => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(value || null);
      };
      const onKeyDown = event => {
        if (event.key === 'Escape') close(null);
        if (event.key === 'Enter' && state.selected) close(state.selected);
      };
      document.addEventListener('keydown', onKeyDown, true);
      cancel.addEventListener('click', () => close(null));
      ok.addEventListener('click', () => close(state.selected));
      overlay.addEventListener('click', event => { if (event.target === overlay) close(null); });

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
          row.style.cssText = 'display:flex;align-items:center;gap:6px;min-height:28px;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;';
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
              ? _selectionFor(matchedRoot, d.path, d.name, 'file')
              : { path: _normalizePath(d.path), name: d.name || _leafName(d.path), rootPath: '', rootName: d.rootName || '', rootKind: 'source', sourceId: '', workspaceId: '', kind: 'file' };
            _markSelectedAcross(state, row);
            state.current.textContent = matchedRoot ? _rowLabelText(state.selected) : (d.path || d.name || '');
            state.ok.disabled = false;
          };
          row.addEventListener('click', selectThis);
          row.addEventListener('dblclick', () => { selectThis(); state.close(state.selected); });
          row.addEventListener('mouseenter', () => { if (!row.dataset.gbFolderPickerSelected) row.style.background = 'var(--bg3)'; });
          row.addEventListener('mouseleave', () => { if (!row.dataset.gbFolderPickerSelected) row.style.background = ''; });
          searchResults.appendChild(row);
        });
      }

      if (searchInput) {
        searchInput.addEventListener('input', async () => {
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
      }

      tree.textContent = 'フォルダを読み込み中...';
      try {
        const roots = await loadRoots(options);
        state.roots = roots;
        tree.innerHTML = '';
        if (!roots.length) {
          status.textContent = '選択できるフォルダがありません。';
          return;
        }
        let lastSection = '';
        roots.forEach(root => {
          const section = _rootSectionLabel(_rootKind(root));
          if (section !== lastSection) {
            const heading = document.createElement('div');
            heading.textContent = section;
            heading.style.cssText = 'padding:8px 6px 4px;font-size:11px;color:var(--fg2);font-weight:bold;';
            tree.appendChild(heading);
            lastSection = section;
          }
          tree.appendChild(_createFolderNode(root, { name: root.name, path: root.path }, 0, state));
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
    });
  }

  window.GBFolderPicker = {
    loadRoots,
    pickFolder,
    toSourceRelativePath,
  };
})();
