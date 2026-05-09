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

  async function _listFolders(path) {
    const auth = _auth();
    if (!auth?.apiRpc) throw new Error('Dropboxへ接続してください');
    const folders = [];
    let payload = await auth.apiRpc('files/list_folder', {
      path: path === '/' ? '' : path,
      recursive: false,
      include_deleted: false,
      include_mounted_folders: true,
    });
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
      payload = await auth.apiRpc('files/list_folder/continue', { cursor: payload.cursor });
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, 'ja', { sensitivity: 'base' }));
    return folders;
  }

  async function _createFolder(parentPath, name) {
    const cleanName = String(name || '').trim().replace(/[\\\/]+/g, '-');
    if (!cleanName) return null;
    const path = parentPath === '/' ? `/${cleanName}` : `${parentPath}/${cleanName}`;
    await _auth().apiRpc('files/create_folder_v2', { path, autorename: false });
    return _escPath(path);
  }

  function pickFolder(options) {
    options = options || {};
    return new Promise((resolve) => {
      const overlay = _el('div', { class: 'modal-overlay meldex-dropbox-folder-picker-overlay' });
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(0,0,0,0.55);';
      const dialog = _el('div', { class: 'modal meldex-dropbox-folder-picker-modal', role: 'dialog', 'aria-modal': 'true' });
      dialog.style.cssText = 'width:min(620px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 32px));display:flex;flex-direction:column;overflow:hidden;background:var(--bg2);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:0;';
      const title = _el('h3', { text: options.title || 'Dropbox内フォルダを選択' });
      title.style.cssText = 'margin:0;padding:14px 16px;border-bottom:1px solid var(--border);font-size:16px;';
      const body = _el('div', { class: 'modal-body' });
      body.style.cssText = 'display:grid;grid-template-rows:auto 1fr auto;gap:10px;min-height:0;padding:12px 16px;overflow:hidden;';
      const toolbar = _el('div', { class: 'gb-field-row' });
      toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';
      const upButton = _el('button', { type: 'button', text: '上へ' });
      const pathText = _el('div', { class: 'gb-section-desc' });
      pathText.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg2);';
      const refreshButton = _el('button', { type: 'button', text: '更新' });
      toolbar.append(upButton, pathText, refreshButton);
      const list = _el('div', { role: 'listbox' });
      list.style.cssText = 'min-height:220px;overflow:auto;border:1px solid var(--border);border-radius:6px;background:var(--bg);';
      const status = _el('div', { class: 'gb-section-desc', text: '' });
      status.style.cssText = 'min-height:18px;color:var(--fg2);font-size:12px;';
      const buttons = _el('div', { class: 'btn-row' });
      buttons.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--border);';
      const newButton = _el('button', { type: 'button', text: '新規フォルダ' });
      const cancelButton = _el('button', { type: 'button', text: 'キャンセル' });
      const selectButton = _el('button', { type: 'button', class: 'primary', text: 'このフォルダを追加' });
      buttons.append(newButton, cancelButton, selectButton);
      body.append(toolbar, list, status);
      dialog.append(title, body, buttons);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      let currentPath = _escPath(options.initialPath || '/');
      let selectedPath = currentPath;

      const close = (value) => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        resolve(value || null);
      };

      function onKeydown(event) {
        if (event.key === 'Escape') close(null);
      }

      async function render() {
        pathText.textContent = currentPath;
        selectedPath = currentPath;
        list.textContent = '';
        status.textContent = '読み込み中...';
        upButton.disabled = currentPath === '/';
        try {
          const folders = await _listFolders(currentPath === '/' ? '' : currentPath);
          list.textContent = '';
          if (!folders.length) {
            const empty = _el('div', { text: 'この階層にフォルダはありません' });
            empty.style.cssText = 'padding:14px;color:var(--fg2);font-size:13px;';
            list.appendChild(empty);
          }
          folders.forEach((folder) => {
            const row = _el('button', { type: 'button', text: folder.name });
            row.style.cssText = 'width:100%;display:flex;align-items:center;gap:8px;padding:10px 12px;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--fg);text-align:left;cursor:pointer;';
            row.addEventListener('click', () => {
              currentPath = folder.path;
              render();
            });
            list.appendChild(row);
          });
          status.textContent = '現在表示しているフォルダをソースフォルダに追加できます。';
        } catch (err) {
          list.textContent = '';
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
      newButton.addEventListener('click', async () => {
        const name = prompt('新しいフォルダ名');
        if (!name) return;
        try {
          currentPath = await _createFolder(currentPath, name);
          await render();
        } catch (err) {
          status.textContent = err?.message || String(err);
        }
      });
      cancelButton.addEventListener('click', () => close(null));
      selectButton.addEventListener('click', () => close({ path: selectedPath, name: _basename(selectedPath) }));
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(null);
      });
      document.addEventListener('keydown', onKeydown);
      render();
    });
  }

  window.MeldexDropboxFolderPicker = { pickFolder };
})();
