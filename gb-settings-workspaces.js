/* gb-settings-workspaces.js: settings tab for workspaces */
(function() {
  'use strict';

  function _icon(name, size = 14) {
    return typeof lucide === 'function' ? lucide(name, size) : '';
  }

  function _status(message, isError) {
    if (typeof showStatus === 'function') showStatus(message, !!isError);
  }

  function _panel(root) {
    const scope = root?.querySelector ? root : document;
    return scope.querySelector('.settings-panel[data-panel="ワークスペース"]') || document.querySelector('.settings-panel[data-panel="ワークスペース"]');
  }

  function _escape(value) {
    return typeof esc === 'function'
      ? esc(value == null ? '' : String(value))
      : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  async function _workspaceRows() {
    return window.MeldexWorkspaces ? await window.MeldexWorkspaces.load({ force: true }) : [];
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

  function _renderEmpty(container) {
    container.innerHTML = `<section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${_icon('usersRound', 14)} ワークスペース</div>
      <div class="gb-section-desc">チャット、シフト、共同作業の対象をソースフォルダとは別に管理します。</div>
      <button type="button" class="gb-btn gb-btn-sm" data-settings-workspace-add data-e2e-id="settings-workspace-add-empty">${_icon('plus', 14)} ワークスペースを追加</button>
    </section>`;
    container.querySelector('[data-settings-workspace-add]')?.addEventListener('click', addWorkspaceFromSettings);
  }

  function _memberListHtml(workspace) {
    const members = Array.isArray(workspace?.members) ? workspace.members : [];
    if (!members.length) return '<div class="gb-section-desc">メンバーはまだ登録されていません。</div>';
    return members.map(member => `<div class="settings-workspace-member" style="display:grid;grid-template-columns:minmax(0,1fr) 120px 44px;gap:6px;align-items:center;margin:4px 0;">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escape(member.name || '')}</span>
      <select class="gb-select" data-workspace-member-role="${_escape(member.name || '')}" data-e2e-id="settings-workspace-member-role-${_escape(member.name || '')}" aria-label="${_escape(member.name || '')}の権限">
        ${['owner','admin','member','viewer'].map(role => `<option value="${role}"${member.role === role ? ' selected' : ''}>${{owner:'管理者（作成者）',admin:'管理者',member:'メンバー',viewer:'閲覧'}[role]}</option>`).join('')}
      </select>
      <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-workspace-member-remove="${_escape(member.name || '')}" data-e2e-id="settings-workspace-member-remove-${_escape(member.name || '')}" title="メンバーを削除" aria-label="${_escape(member.name || '')}を削除">${_icon('trash2', 14)}</button>
    </div>`).join('');
  }

  function _renderRows(container, rows) {
    const activeId = window.MeldexWorkspaces?.getActiveId?.() || '';
    const rowHtml = rows.map(workspace => `<section class="gb-section gb-section--boxed settings-workspace-card" data-workspace-id="${_escape(workspace.id)}">
      <div class="settings-workspace-head">
        <div>
          <div class="gb-section-title">${_icon('usersRound', 14)} <span>${_escape(workspace.name || 'ワークスペース')}</span></div>
          <div class="gb-section-desc">${_escape(workspace.folder || '')}</div>
        </div>
        <label class="gb-check" title="チャットとスケジューラーで最初に使うワークスペース">
          <input type="radio" name="settings-active-workspace" data-workspace-active="${_escape(workspace.id)}" data-e2e-id="settings-workspace-active-${_escape(workspace.id)}" ${workspace.id === activeId ? 'checked' : ''}>
          <span>選択中</span>
        </label>
      </div>
      <div class="gb-field-row">
        <input class="gb-input" data-workspace-name data-e2e-id="settings-workspace-name-${_escape(workspace.id)}" value="${_escape(workspace.name || '')}" aria-label="ワークスペース名">
        <input class="gb-input" data-workspace-folder data-e2e-id="settings-workspace-folder-${_escape(workspace.id)}" value="${_escape(workspace.folder || '')}" aria-label="ワークスペースのフォルダ">
        <button type="button" class="gb-btn gb-btn-sm" data-workspace-save data-e2e-id="settings-workspace-save-${_escape(workspace.id)}">${_icon('save', 14)} 保存</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-workspace-delete data-e2e-id="settings-workspace-delete-${_escape(workspace.id)}">${_icon('trash2', 14)} 削除</button>
      </div>
      <div class="settings-workspace-members">${_memberListHtml(workspace)}</div>
      <div class="gb-field-row" style="justify-content:flex-start;">
        <input class="gb-input" data-workspace-new-member data-e2e-id="settings-workspace-new-member-${_escape(workspace.id)}" placeholder="メンバー名" style="max-width:220px;">
        <select class="gb-select" data-workspace-new-role data-e2e-id="settings-workspace-new-role-${_escape(workspace.id)}" aria-label="追加するメンバーの権限">
          <option value="member">メンバー</option>
          <option value="admin">管理者</option>
          <option value="viewer">閲覧</option>
        </select>
        <button type="button" class="gb-btn gb-btn-sm" data-workspace-member-add data-e2e-id="settings-workspace-member-add-${_escape(workspace.id)}">${_icon('userPlus', 14)} 追加</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-workspace-profile-sync data-e2e-id="settings-workspace-profile-sync-${_escape(workspace.id)}">${_icon('refreshCw', 14)} 自分を同期</button>
      </div>
    </section>`).join('');
    container.innerHTML = `<section class="gb-section gb-section--boxed">
      <div class="gb-section-title">${_icon('usersRound', 14)} ワークスペース</div>
      <div class="gb-section-desc">作品・フォルダツリーのソースとは別に、チャットや共同作業で使う単位です。</div>
      <button type="button" class="gb-btn gb-btn-sm" data-settings-workspace-add data-e2e-id="settings-workspace-add">${_icon('plus', 14)} ワークスペースを追加</button>
    </section>${rowHtml}`;
    bindWorkspaceSettings(container);
  }

  async function settingsInitWorkspaces(root) {
    const panel = _panel(root);
    if (!panel) return;
    panel.innerHTML = '<section class="gb-section gb-section--boxed"><div class="gb-section-desc">読み込み中...</div></section>';
    try {
      const rows = await _workspaceRows();
      if (!rows.length) _renderEmpty(panel);
      else _renderRows(panel, rows);
    } catch {
      panel.innerHTML = '<section class="gb-section gb-section--boxed"><div class="gb-section-desc">ワークスペースを読み込めませんでした。</div></section>';
    }
  }

  async function addWorkspaceFromSettings() {
    let picked = null;
    try { picked = await window.MeldexWorkspaces?.pickFolder?.(); } catch {}
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
      await settingsInitWorkspaces(document);
      _status('ワークスペースを追加しました');
    } catch (error) {
      _status('追加に失敗: ' + (error?.message || error), true);
    }
  }

  function bindWorkspaceSettings(container) {
    container.querySelector('[data-settings-workspace-add]')?.addEventListener('click', addWorkspaceFromSettings);
    container.querySelectorAll('[data-workspace-active]').forEach(input => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        window.MeldexWorkspaces?.setActiveId?.(input.dataset.workspaceActive || '', { reason: 'settings' });
        _status('ワークスペースを選択しました');
      });
    });
    container.querySelectorAll('[data-workspace-id]').forEach(card => {
      const id = card.dataset.workspaceId || '';
      card.querySelector('[data-workspace-save]')?.addEventListener('click', async () => {
        const name = card.querySelector('[data-workspace-name]')?.value || '';
        const folder = card.querySelector('[data-workspace-folder]')?.value || '';
        try {
          await window.MeldexWorkspaces.update(id, { name, folder });
          await settingsInitWorkspaces(document);
          _status('ワークスペースを保存しました');
        } catch (error) {
          _status('保存に失敗: ' + (error?.message || error), true);
        }
      });
      card.querySelector('[data-workspace-delete]')?.addEventListener('click', async () => {
        const ok = typeof cfConfirm === 'function'
          ? await cfConfirm('このワークスペースを一覧から削除しますか？\nフォルダや中のファイルは削除しません。')
          : window.confirm('このワークスペースを一覧から削除しますか？');
        if (!ok) return;
        try {
          await window.MeldexWorkspaces.remove(id);
          await settingsInitWorkspaces(document);
          _status('ワークスペースを削除しました');
        } catch (error) {
          _status('削除に失敗: ' + (error?.message || error), true);
        }
      });
      card.querySelector('[data-workspace-member-add]')?.addEventListener('click', async () => {
        const name = String(card.querySelector('[data-workspace-new-member]')?.value || '').trim();
        const role = String(card.querySelector('[data-workspace-new-role]')?.value || 'member');
        if (!name) return;
        await apiFetch('/workspaces/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(name), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        });
        await window.MeldexWorkspaces.load({ force: true });
        await settingsInitWorkspaces(document);
      });
      card.querySelector('[data-workspace-profile-sync]')?.addEventListener('click', async () => {
        await apiFetch('/workspaces/' + encodeURIComponent(id) + '/sync-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: typeof getUsername === 'function' ? getUsername() : 'anonymous' }),
        });
        await window.MeldexWorkspaces.load({ force: true });
        await settingsInitWorkspaces(document);
      });
      card.querySelectorAll('[data-workspace-member-role]').forEach(select => {
        select.addEventListener('change', async () => {
          const memberName = select.dataset.workspaceMemberRole || '';
          await apiFetch('/workspaces/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(memberName), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: select.value }),
          });
          await window.MeldexWorkspaces.load({ force: true });
        });
      });
      card.querySelectorAll('[data-workspace-member-remove]').forEach(button => {
        button.addEventListener('click', async () => {
          const memberName = button.dataset.workspaceMemberRemove || '';
          await apiFetch('/workspaces/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(memberName), { method: 'DELETE' });
          await window.MeldexWorkspaces.load({ force: true });
          await settingsInitWorkspaces(document);
        });
      });
    });
  }

  window.settingsInitWorkspaces = settingsInitWorkspaces;
})();
