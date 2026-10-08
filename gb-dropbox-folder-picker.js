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

  function _detector() {
    return window.MeldexWorkspaceFolderDetect;
  }

  // 共有ワークスペースへの参加先を選ぶときは、ワークスペースとして作られたフォルダだけを
  // 並べる。中にワークスペースを含むだけのフォルダは、辿り着けなくならないよう「開くだけ」
  // 残す。判定できなかった場合は黙って全部並べず、絞り込めなかったことを画面に出す。
  async function _classifyWorkspaceFolders(folders, currentPath, namespaceKind) {
    const detect = _detector();
    if (!detect) return { folders, filtered: false, notice: '' };
    const found = await detect.findWorkspaceRootsUnder(currentPath, namespaceKind);
    if (!found.searched) {
      return {
        folders,
        filtered: false,
        notice: '共有ワークスペースだけに絞り込めませんでした。フォルダを選ぶと、参加する前に確認します。',
      };
    }
    const roots = found.roots.map((root) => String(root).toLowerCase());
    const classified = folders.map((folder) => {
      const lower = String(folder.path || '').toLowerCase();
      const isWorkspace = roots.includes(lower);
      const hasWorkspaceInside = !isWorkspace && roots.some((root) => root.startsWith(lower + '/'));
      return { ...folder, isWorkspace, hasWorkspaceInside };
    }).filter((folder) => folder.isWorkspace || folder.hasWorkspaceInside);
    return { folders: classified, filtered: true, notice: '' };
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
    const workspaceMode = options.mode === 'workspace';
    return new Promise((resolve) => {
      const pickerId = `meldex-dropbox-folder-picker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const body = _el('div', {
        class: 'meldex-dropbox-folder-picker-body',
        'data-e2e-id': 'dropbox-folder-picker-body',
      });
      const namespacePicker = _el('div', {
        class: 'meldex-dropbox-folder-picker-namespace',
        role: 'group',
        'aria-label': 'Dropboxの領域',
        'data-e2e-id': 'dropbox-folder-picker-namespace',
      });
      namespacePicker.hidden = true;
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
      for (const button of [homeNamespaceButton, teamNamespaceButton]) namespacePicker.appendChild(button);
      const toolbar = _el('div', { class: 'gb-field-row meldex-dropbox-folder-picker-toolbar' });
      const upButton = _el('button', { type: 'button', class: 'gb-btn gb-btn-sm', text: '上へ', title: '上の階層へ', 'aria-label': '上の階層へ', 'data-e2e-id': 'dropbox-folder-picker-up' });
      const pathText = _el('div', { class: 'gb-section-desc meldex-dropbox-folder-picker-path', 'data-e2e-id': 'dropbox-folder-picker-current-path' });
      const refreshButton = _el('button', { type: 'button', class: 'gb-btn gb-btn-sm', text: '更新', title: 'フォルダ一覧を更新', 'data-e2e-id': 'dropbox-folder-picker-refresh' });
      toolbar.append(upButton, pathText, refreshButton);
      const list = _el('div', { class: 'meldex-dropbox-folder-picker-list', role: 'listbox', 'aria-label': 'Dropboxフォルダ一覧', 'data-e2e-id': 'dropbox-folder-picker-list' });
      const status = _el('div', { class: 'gb-section-desc meldex-dropbox-folder-picker-status', text: '', role: 'status', 'aria-live': 'polite', 'data-e2e-id': 'dropbox-folder-picker-status' });
      const newButton = _el('button', { type: 'button', class: 'gb-btn gb-btn-sm', text: '新規フォルダ', title: '新規フォルダ', 'data-e2e-id': 'dropbox-folder-picker-new' });
      const cancelButton = _el('button', { type: 'button', class: 'gb-btn gb-btn-sm', text: 'キャンセル', 'data-e2e-id': 'dropbox-folder-picker-cancel' });
      const selectButton = _el('button', {
        type: 'button',
        class: 'gb-btn gb-btn-sm gb-btn-primary primary',
        text: workspaceMode ? 'このワークスペースに参加' : 'このフォルダを追加',
        'data-e2e-id': 'dropbox-folder-picker-select',
      });
      // 参加先を選ぶ画面では新しいフォルダを作っても意味がない（作った直後の空フォルダは
      // 共有ワークスペースではないため）ので出さない
      body.append(namespacePicker, toolbar, list, status);
      const footer = workspaceMode
        ? [cancelButton, selectButton]
        : [newButton, cancelButton, selectButton];
      const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      let closeValue = null;
      let settled = false;
      const modalApi = window.GBUI.createModal({
        id: pickerId,
        title: options.title || 'Dropbox内フォルダを選択',
        body,
        footer,
        variant: 'mobile-sheet',
        extraClass: 'meldex-dropbox-folder-picker-modal',
        initialFocus: '[data-e2e-id="dropbox-folder-picker-cancel"]',
        returnFocus: restoreFocusTo || undefined,
        closeOnEsc: true,
        closeOnOverlay: true,
        onClose: () => {
          if (settled) return;
          settled = true;
          resolve(closeValue);
        },
      });
      const overlay = modalApi.overlay;
      overlay.classList.add('modal-overlay', 'meldex-dropbox-folder-picker-overlay');
      overlay.dataset.dropboxFolderPicker = '1';
      overlay.dataset.e2eId = 'dropbox-folder-picker-overlay';
      const dialog = modalApi.modal;
      dialog.classList.add('modal');
      dialog.dataset.e2eId = 'dropbox-folder-picker-modal';
      dialog.dataset.dropboxPickerMode = workspaceMode ? 'workspace' : 'source';
      modalApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'dropbox-folder-picker-header-close');
      modalApi.footer.classList.add('meldex-dropbox-folder-picker-footer');

      let currentPath = _escPath(options.initialPath || '/');
      let selectedPath = currentPath;
      let currentNamespaceKind = _normalizeNamespaceKind(options.namespaceKind);
      let renderSeq = 0;

      const close = (value, reason) => {
        closeValue = value || null;
        modalApi.close(reason || 'programmatic');
      };

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
        if (workspaceMode) selectButton.disabled = true;
        try {
          let folders = await _listFolders(renderPath, currentNamespaceKind);
          let notice = '';
          if (workspaceMode) {
            const classified = await _classifyWorkspaceFolders(folders, renderPath, currentNamespaceKind);
            if (seq !== renderSeq) return;
            folders = classified.folders;
            notice = classified.notice;
          }
          if (seq !== renderSeq) return;
          list.textContent = '';
          list.setAttribute('aria-busy', 'false');
          if (!folders.length) {
            const empty = _el('div', {
              class: 'meldex-dropbox-folder-picker-empty',
              text: workspaceMode
                ? 'この場所に共有ワークスペースはありません'
                : 'この階層にフォルダはありません',
            });
            list.appendChild(empty);
          }
          folders.forEach((folder) => {
            const row = _el('button', {
              type: 'button',
              class: 'meldex-dropbox-folder-picker-row',
              title: folder.path,
              role: 'option',
              'aria-label': folder.isWorkspace ? `${folder.name}（共有ワークスペース）を選ぶ` : `${folder.name}を開く`,
              'data-dropbox-path': folder.path,
              'data-e2e-id': 'dropbox-folder-picker-row',
            });
            if (workspaceMode) row.dataset.workspaceFolder = folder.isWorkspace ? '1' : '0';
            row.appendChild(_el('span', { text: folder.name }));
            if (folder.isWorkspace) {
              const badge = _el('span', { class: 'meldex-dropbox-folder-picker-badge', text: '共有ワークスペース', 'data-e2e-id': 'dropbox-folder-picker-workspace-badge' });
              row.appendChild(badge);
            }
            row.addEventListener('click', () => {
              currentPath = folder.path;
              render();
            });
            list.appendChild(row);
          });
          if (workspaceMode) {
            const current = _detector()
              ? await _detector().isWorkspaceFolder(renderPath, currentNamespaceKind)
              : { workspace: false, checked: false };
            if (seq !== renderSeq) return;
            // 確認できなかったとき（通信不調など）はボタンを塞がない。参加の可否は
            // 参加処理側でもう一度確かめるので、ここで行き止まりにしない。
            selectButton.disabled = current.checked ? !current.workspace : false;
            status.textContent = notice || (current.workspace
              ? '表示中のフォルダに参加できます。'
              : '参加できる共有ワークスペースを選んでください。');
          } else {
            status.textContent = '現在表示しているフォルダをソースフォルダに追加できます。';
          }
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
      cancelButton.addEventListener('click', () => close(null, 'cancel'));
      selectButton.addEventListener('click', () => close({
        path: selectedPath,
        name: _displayName(selectedPath),
        namespaceKind: currentNamespaceKind,
      }, 'select'));
      modalApi.open();
      render();
      Promise.resolve(_auth()?.getNamespaceContext?.(false)).then((context) => {
        if (!context?.isTeam) return;
        namespacePicker.hidden = false;
      }).catch(() => {});
    });
  }

  window.MeldexDropboxFolderPicker = { pickFolder };
})();
