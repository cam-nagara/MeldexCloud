/* gb-workspace-sidebar.js: sidebar workspace section */
(function() {
  'use strict';

  function _icon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _status(message, isError) {
    if (typeof showStatus === 'function') showStatus(message, !!isError);
  }

  function _currentWorkspaceUserFields() {
    let user = typeof getUsername === 'function' ? String(getUsername() || '').trim() : '';
    if (!user) {
      try {
        const cfg = JSON.parse(localStorage.getItem('meldex-user') || '{}') || {};
        user = String(cfg.name || '').trim();
      } catch {}
    }
    let avatar = '';
    try { avatar = String(localStorage.getItem('meldex-avatar') || ''); } catch {}
    return { user: user || 'anonymous', avatar };
  }

  function _body() {
    return document.getElementById('body-workspaces');
  }

  function _workspaceTreeItem(workspace) {
    const name = window.MeldexWorkspaces?.displayName?.(workspace) || workspace.name || 'ワークスペース';
    return {
      name,
      type: 'folder',
      path: workspace.folder || '',
      rootKind: 'workspace',
      workspaceId: workspace.id || '',
      _isRoot: true,
    };
  }

  function _row(workspace, activeId) {
    if (workspace?.folder && typeof createTreeNodeFromBrowse === 'function') {
      const node = createTreeNodeFromBrowse(_workspaceTreeItem(workspace), workspace.folder);
      node.classList.add('workspace-sidebar-node');
      node.dataset.workspaceId = workspace.id || '';
      const row = node.querySelector(':scope > .tree-node-row');
      if (row) {
        row.classList.toggle('selected', workspace.id === activeId);
        row.title = workspace.folder || workspace.name || '';
        row.dataset.workspaceId = workspace.id || '';
        row.addEventListener('click', (event) => {
          // 修飾キー付きクリックは複数選択操作なので、選択状態の付け替えはツリー側に任せる
          if (event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (!workspace.id) return;
          window.MeldexWorkspaces?.setActiveId?.(workspace.id, { reason: 'sidebar', silent: true });
          _body()?.querySelectorAll?.('.tree-node-row.selected')?.forEach(item => item.classList.remove('selected'));
          row.classList.add('selected');
          if (typeof _initChatSourceFolderSelector === 'function') _initChatSourceFolderSelector();
        }, { capture: true });
      }
      return node;
    }

    const row = document.createElement('div');
    row.className = 'tree-node workspace-sidebar-row';
    row.dataset.workspaceId = workspace.id || '';
    row.classList.toggle('selected', workspace.id === activeId);
    row.title = workspace.folder || workspace.name || '';
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;margin:1px 6px;border-radius:4px;cursor:pointer;min-width:0;';

    const icon = document.createElement('span');
    icon.className = 'ico-wrap';
    icon.innerHTML = _icon('usersRound', 16);
    icon.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px;color:var(--fg2);';

    const label = document.createElement('span');
    label.textContent = window.MeldexWorkspaces?.displayName?.(workspace) || workspace.name || 'ワークスペース';
    label.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;';

    row.append(icon, label);
    row.addEventListener('click', () => {
      window.MeldexWorkspaces?.setActiveId?.(workspace.id, { reason: 'sidebar' });
      renderWorkspaceSidebar();
      if (typeof _initChatSourceFolderSelector === 'function') _initChatSourceFolderSelector();
    });
    row.addEventListener('dblclick', () => {
      if (workspace.folder && typeof openFolder === 'function') {
        openFolder(workspace.name || 'ワークスペース', workspace.folder, { fromExplorer: true });
      }
    });
    return row;
  }

  async function renderWorkspaceSidebar() {
    const body = _body();
    if (!body || !window.MeldexWorkspaces) return;
    if (typeof _unregisterTreeSubtree === 'function') _unregisterTreeSubtree(body);
    body.innerHTML = '<div class="sidebar-empty" style="padding:8px 12px;color:var(--fg2);font-size:12px;">読み込み中...</div>';
    try {
      const rows = await window.MeldexWorkspaces.load({ force: true });
      const activeId = window.MeldexWorkspaces.getActiveId();
      body.innerHTML = '';
      if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'sidebar-empty';
        empty.style.cssText = 'padding:8px 12px;color:var(--fg2);font-size:12px;line-height:1.4;';
        empty.textContent = 'ワークスペースは未作成です';
        body.appendChild(empty);
        return;
      }
      rows.forEach(workspace => body.appendChild(_row(workspace, activeId)));
    } catch {
      body.innerHTML = '<div class="sidebar-empty" style="padding:8px 12px;color:var(--fg2);font-size:12px;">ワークスペースを読み込めませんでした</div>';
    }
  }

  async function addWorkspaceFromSidebar() {
    if (!window.MeldexWorkspaces) return;
    let picked = null;
    try { picked = await window.MeldexWorkspaces.pickFolder(); } catch {}
    let path = String(picked?.path || '').trim();
    if (!path) {
      const promptLabel = window.MeldexRuntimeAdapter?.isDropboxMode?.()
        ? 'ワークスペースにするDropbox内フォルダ'
        : 'ワークスペースにするフォルダの絶対パス';
      path = window.prompt(promptLabel, '');
      if (path == null) return;
      path = String(path || '').trim();
    }
    if (!path) return;
    const defaultName = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'ワークスペース';
    const name = window.prompt('ワークスペース名', defaultName);
    if (name == null) return;
    try {
      await window.MeldexWorkspaces.create({
        name: String(name || defaultName).trim(),
        folder: path,
        ..._currentWorkspaceUserFields(),
      });
      await renderWorkspaceSidebar();
      _status('ワークスペースを追加しました');
    } catch (error) {
      _status('ワークスペースを追加できません: ' + (error?.message || error), true);
    }
  }

  function openWorkspaceSettings() {
    if (typeof showSettingsModal === 'function') showSettingsModal({ panel: 'ワークスペース' });
  }

  function _init() {
    renderWorkspaceSidebar();
    window.addEventListener('meldex:workspaces-changed', () => renderWorkspaceSidebar());
  }

  window.renderWorkspaceSidebar = renderWorkspaceSidebar;
  window.addWorkspaceFromSidebar = addWorkspaceFromSidebar;
  window.openWorkspaceSettings = openWorkspaceSettings;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _init);
  else _init();
})();
