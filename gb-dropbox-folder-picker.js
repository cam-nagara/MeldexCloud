(function () {
  'use strict';

  if (window.MeldexDropboxFolderPicker) return;

  function _auth() {
    return window.MeldexDropboxAuth;
  }

  function _registry() {
    return window.MeldexSourceFolderRegistry;
  }

  function _el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.entries(attrs).forEach(([key, value]) => {
      if (value == null) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    });
    (children || []).forEach((child) => node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child));
    return node;
  }

  function _escPath(path) {
    return _registry()?.normalizeDropboxPath?.(path) || '/';
  }

  function _basename(path) {
    const parts = String(path || '').split('/').filter(Boolean);
    return parts[parts.length - 1] || '/';
  }

  function _displayName(path) {
    return path === '/' ? 'Dropbox' : _basename(path);
  }

  function _normalizeNamespaceKind(value) {
    return value === 'team_root' ? 'team_root' : 'home';
  }

  async function _listFolders(path, namespaceKind) {
    const auth = _auth();
    if (!auth?.apiRpc) throw new Error('Dropboxへ接続してください');
    const folders = [];
    let payload = await auth.apiRpc('files/list_folder', {
      path: path === '/' ? '' : path,
      recursive: false,
      include_deleted: false,
      include_mounted_folders: true,
    }, { namespaceKind: _normalizeNamespaceKind(namespaceKind) });
    while (true) {
      (payload.entries || []).forEach((entry) => {
        if (entry['.tag'] === 'folder') {
          folders.push({
            name: entry.name || _basename(entry.path_display || entry.path_lower),
            path: _escPath(entry.path_display || entry.path_lower || ''),
          });
        }
      });
      if (!payload.has_more || !payload.cursor) break;
      payload = await auth.apiRpc(
        'files/list_folder/continue',
        { cursor: payload.cursor },
        { namespaceKind: _normalizeNamespaceKind(namespaceKind) }
      );
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, 'ja', { sensitivity: 'base' }));
    return folders;
  }

  async function _createFolder(parentPath, name, namespaceKind) {
    const cleanName = String(name || '').trim().replace(/[\\\/]+/g, '-');
    if (!cleanName) return null;
    const path = parentPath === '/' ? `/${cleanName}` : `${parentPath}/${cleanName}`;
    await _auth().apiRpc(
      'files/create_folder_v2',
      { path, autorename: false },
      { namespaceKind: _normalizeNamespaceKind(namespaceKind) }
    );
    return _escPath(path);
  }

  function pickFolder(options) {
    options = options || {};
    return new Promise((resolve) => {
      const pickerId = `meldex-dropbox-folder-picker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const overlay = _el('div', {
        class: 'modal-overlay meldex-dropbox-folder-picker-overlay',
        'data-dropbox-folder-picker': '1',
        'data-e2e-id': 'dropbox-folder-picker-overlay',
      });
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(0,0,0,0.55);';
      const dialog = _el('div', {
        class: 'modal meldex-dropbox-folder-picker-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': `${pickerId}-title`,
        'data-e2e-id': 'dropbox-folder-picker-modal',
      });
      dialog.style.cssText = 'width:min(620px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 32px));display:flex;flex-direction:column;overflow:hidden;background:var(--bg2);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:0;';
      const title = _el('h3', { id: `${pickerId}-title`, text: options.title || 'Dropbox内フォルダを選択' });
      title.style.cssText = 'margin:0;padding:14px 16px;border-bottom:1px solid var(--border);font-size:16px;';
      const body = _el('div', { class: 'modal-body' });
      body.style.cssText = 'display:grid;grid-template-rows:auto auto 1fr auto;gap:10px;min-height:0;padding:12px 16px;overflow:hidden;';
      const namespacePicker = _el('div', {
        role: 'group',
        'aria-label': 'Dropboxの領域',
        'data-e2e-id': 'dropbox-folder-picker-namespace',
      });
      namespacePicker.style.cssText = 'display:none;grid-template-columns:1fr 1fr;gap:8px;';
      const homeNamespaceButton = _el('button', {
        type: 'button',
        class: 'gb-btn gb-btn-sm',
        text: '個人用',
        'data-namespace-kind': 'home',
        'data-e2e-id': 'dropbox-folder-picker-namespace-home',
      });
      const teamNamespaceButton = _el('button', {
        type: 'button',
        class: 'gb-btn gb-btn-sm',
        text: 'チーム共有',
        'data-namespace-kind': 'team_root',
        'data-e2e-id': 'dropbox-folder-picker-namespace-team',
      });
      for (const button of [homeNamespaceButton, teamNamespaceButton]) {
        button.style.cssText = 'min-height:44px;';
        namespacePicker.appendChild(button);
      }
      const toolbar = _el('div', { class: 'gb-field-row' });
      toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';
      const upButton = _el('button', { type: 'button', class: 'gb-btn gb-btn-sm', text: '上へ', title: '上の階層へ', 'aria-label': '上の階層へ', 'data-e2e-id': 'dropbox-folder-picker-up' });
      const pathText = _el('div', { class: 'gb-section-desc', 'data-e2e-id': 'dropbox-folder-picker-current-path' });
      pathText.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg2);';
      const refreshButton = _el('button', { type: 'button', class: 'gb-btn gb-btn-sm', text: '更新', title: 'フォルダ一覧を更新', 'data-e2e-id': 'dropbox-folder-picker-refresh' });
      toolbar.append(upButton, pathText, refreshButton);
      const list = _el('div', { role: 'listbox', 'aria-label': 'Dropboxフォルダ一覧', 'data-e2e-id': 'dropbox-folder-picker-list' });
      list.style.cssText = 'min-height:220px;overflow:auto;border:1px solid var(--border);border-radius:6px;background:var(--bg);';
      const status = _el('div', { class: 'gb-section-desc', text: '', role: 'status', 'aria-live': 'polite', 'data-e2e-id': 'dropbox-folder-picker-status' });
      status.style.cssText = 'min-height:18px;color:var(--fg2);font-size:12px;';
      const buttons = _el('div', { class: 'btn-row' });
      buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--border);';
      const newButton = _el('button', { type: 'button', class: 'gb-btn gb-btn-sm', text: '新規フォルダ', title: '新規フォルダ', 'data-e2e-id': 'dropbox-folder-picker-new' });
      const cancelButton = _el('button', { type: 'button', class: 'gb-btn gb-btn-sm', text: 'キャンセル', 'data-e2e-id': 'dropbox-folder-picker-cancel' });
      const selectButton = _el('button', { type: 'button', class: 'gb-btn gb-btn-sm gb-btn-primary primary', text: 'このフォルダを追加', 'data-e2e-id': 'dropbox-folder-picker-select' });
      buttons.append(newButton, cancelButton, selectButton);
      body.append(namespacePicker, toolbar, list, status);
      dialog.append(title, body, buttons);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      let currentPath = _escPath(options.initialPath || '/');
      let selectedPath = currentPath;
      let currentNamespaceKind = _normalizeNamespaceKind(options.namespaceKind);
      let renderSeq = 0;

      const close = (value) => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        resolve(value || null);
      };

      function onKeydown(event) {
        if (event.key === 'Escape') close(null);
      }

      async function render() {
        const seq = ++renderSeq;
        const renderPath = _escPath(currentPath);
        currentPath = renderPath;
        pathText.textContent = renderPath;
        homeNamespaceButton.setAttribute('aria-pressed', currentNamespaceKind === 'home' ? 'true' : 'false');
        teamNamespaceButton.setAttribute('aria-pressed', currentNamespaceKind === 'team_root' ? 'true' : 'false');
        selectedPath = renderPath;
        list.textContent = '';
        list.setAttribute('aria-busy', 'true');
        status.textContent = '読み込み中...';
        upButton.disabled = renderPath === '/';
        try {
          const folders = await _listFolders(renderPath, currentNamespaceKind);
          if (seq !== renderSeq) return;
          list.textContent = '';
          list.setAttribute('aria-busy', 'false');
          if (!folders.length) {
            const empty = _el('div', { text: 'この階層にフォルダはありません' });
            empty.style.cssText = 'padding:14px;color:var(--fg2);font-size:13px;';
            list.appendChild(empty);
          }
          folders.forEach((folder) => {
            const row = _el('button', {
              type: 'button',
              class: 'meldex-dropbox-folder-picker-row',
              text: folder.name,
              title: folder.path,
              role: 'option',
              'aria-label': `${folder.name}を開く`,
              'data-dropbox-path': folder.path,
              'data-e2e-id': 'dropbox-folder-picker-row',
            });
            row.style.cssText = 'width:100%;display:flex;align-items:center;gap:8px;padding:10px 12px;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--fg);text-align:left;cursor:pointer;';
            row.addEventListener('click', () => {
              currentPath = folder.path;
              render();
            });
            list.appendChild(row);
          });
          status.textContent = '現在表示しているフォルダをソースフォルダに追加できます。';
        } catch (err) {
          if (seq !== renderSeq) return;
          list.textContent = '';
          list.setAttribute('aria-busy', 'false');
          status.textContent = err?.message || String(err);
        }
      }

      upButton.addEventListener('click', () => {
        if (currentPath === '/') return;
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        currentPath = parts.length ? `/${parts.join('/')}` : '/';
        render();
      });
      refreshButton.addEventListener('click', render);
      namespacePicker.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-namespace-kind]');
        if (!button) return;
        const nextKind = _normalizeNamespaceKind(button.getAttribute('data-namespace-kind'));
        if (nextKind === currentNamespaceKind) return;
        currentNamespaceKind = nextKind;
        currentPath = '/';
        render();
      });
      newButton.addEventListener('click', async () => {
        const name = prompt('新しいフォルダ名');
        if (!name) return;
        try {
          const createdPath = await _createFolder(currentPath, name, currentNamespaceKind);
          if (!createdPath) {
            status.textContent = 'フォルダ名を入力してください。';
            return;
          }
          currentPath = createdPath;
          await render();
        } catch (err) {
          status.textContent = err?.message || String(err);
        }
      });
      cancelButton.addEventListener('click', () => close(null));
      selectButton.addEventListener('click', () => close({
        path: selectedPath,
        name: _displayName(selectedPath),
        namespaceKind: currentNamespaceKind,
      }));
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(null);
      });
      document.addEventListener('keydown', onKeydown);
      render();
      Promise.resolve(_auth()?.getNamespaceContext?.(false)).then((context) => {
        if (!context?.isTeam) return;
        namespacePicker.style.display = 'grid';
      }).catch(() => {});
    });
  }

  window.MeldexDropboxFolderPicker = { pickFolder };
})();
