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
    return MeldexEscape.html(value);
  }

  async function _workspaceRows() {
    return window.MeldexWorkspaces ? await window.MeldexWorkspaces.load({ force: true }) : [];
  }

  async function _registryUsers() {
    if (!window.MeldexUserRegistry) return [];
    try { return await window.MeldexUserRegistry.listStaff({ force: true }); }
    catch { return []; }
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
    container.innerHTML = `<section class="gb-section gb-section--boxed" data-settings-view="workspace">
      <div class="gb-section-title">${_icon('usersRound', 14)} ワークスペース</div>
      <div class="gb-section-desc">チャット、シフト、共同作業の対象をソースフォルダとは別に管理します。</div>
      <button type="button" class="gb-btn gb-btn-sm" data-settings-workspace-add data-e2e-id="settings-workspace-add-empty">${_icon('plus', 14)} ワークスペースを追加</button>
    </section>`;
    container.querySelector('[data-settings-workspace-add]')?.addEventListener('click', addWorkspaceFromSettings);
    _reapplySettingsView(container);
  }

  function _memberListHtml(workspace, users) {
    const members = Array.isArray(workspace?.members) ? workspace.members : [];
    const virtualUsers = (Array.isArray(users) ? users : []).filter(user => user?.user_type === 'virtual' && (user.workspace_ids || []).includes(workspace.id));
    if (!members.length && !virtualUsers.length) return '<div class="gb-section-desc">このワークスペースのユーザーはまだ登録されていません。</div>';
    const accountHtml = members.map(member => `<div class="settings-workspace-member" data-workspace-account-user style="display:grid;grid-template-columns:minmax(0,1fr) 140px 44px;gap:6px;align-items:center;margin:4px 0;">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escape(member.name || '')}</span>
      <select class="gb-select" data-workspace-member-role="${_escape(member.name || '')}" data-e2e-id="settings-workspace-member-role-${_escape(member.name || '')}" aria-label="${_escape(member.name || '')}の権限">
        ${['owner','admin','schedule_manager','member','viewer'].map(role => `<option value="${role}"${member.role === role ? ' selected' : ''}>${{owner:'管理者（作成者）',admin:'管理者',schedule_manager:'スケジュール管理者',member:'ユーザー',viewer:'閲覧のみ'}[role]}</option>`).join('')}
      </select>
      <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-workspace-member-remove="${_escape(member.name || '')}" data-e2e-id="settings-workspace-member-remove-${_escape(member.name || '')}" title="アクセスユーザーから削除" aria-label="${_escape(member.name || '')}を削除">${_icon('trash2', 14)}</button>
      <label class="gb-check" style="grid-column:1 / 3;min-width:0;" title="完全な安全は保証できません。信頼できるユーザーだけ許可してください。">
        <input type="checkbox" data-workspace-member-cli-chat="${_escape(member.name || '')}" data-e2e-id="settings-workspace-member-cli-chat-${_escape(member.name || '')}" ${member.adminCliChatAllowed === true ? 'checked' : ''}>
        <span>管理者PCのCLI返答を許可</span>
      </label>
    </div>`).join('');
    const virtualHtml = virtualUsers.map(user => `<div class="settings-workspace-member" data-workspace-virtual-user style="display:grid;grid-template-columns:minmax(0,1fr) 140px 44px;gap:6px;align-items:center;margin:4px 0;">
      <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escape(user.display || user.user || '')} <small style="color:var(--fg2);">仮ユーザー</small></span>
      <span class="gb-section-desc" title="共有ファイルへアクセスできません">制作管理のみ・ログイン不可</span>
      <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-workspace-virtual-remove="${_escape(user.user_id || user.user || '')}" data-e2e-id="settings-workspace-virtual-remove-${_escape(user.user_id || user.user || '')}" title="このワークスペースから外す" aria-label="${_escape(user.display || user.user || '')}を外す">${_icon('trash2', 14)}</button>
    </div>`).join('');
    return accountHtml + virtualHtml;
  }

  function _renderRows(container, rows, users) {
    const activeId = window.MeldexWorkspaces?.getActiveId?.() || '';
    const workspaceHtml = rows.map(workspace => {
      const listId = `workspace-user-options-${String(workspace.id || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      const options = (Array.isArray(users) ? users : []).map(user => `<option value="${_escape(user.display || user.user || '')}">${_escape(user.user_type === 'virtual' ? '仮ユーザー' : 'アカウント')}</option>`).join('');
      return `<section class="gb-section gb-section--boxed settings-workspace-card" data-settings-view="workspace" data-workspace-id="${_escape(workspace.id)}">
      <div class="settings-workspace-head">
        <div>
          <div class="gb-section-title">${_icon('usersRound', 14)} <span>${_escape(workspace.name || 'ワークスペース')}</span></div>
          <div class="gb-section-desc">${_escape(workspace.folder || '')}</div>
        </div>
          <label class="gb-check" title="チャットとスケジュールで最初に使うワークスペース">
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
      <div class="gb-section-title" style="margin-top:12px;">${_icon('usersRound', 14)} ユーザーとアクセス権限</div>
      <div class="gb-section-desc">アカウントユーザーには共有アクセス権限を、仮ユーザーには制作管理上の所属だけを設定します。</div>
      <div class="gb-section-desc" style="color:var(--red, #e53935);">注意：信頼できるユーザーだけに管理者PCのCLI返答を許可してください。 ${fieldHelp('完全な安全は保証できません。信頼できるユーザーだけ許可してください。', { e2eId: `workspace-cli-user-permission-help-${String(workspace.id || '').replace(/[^a-zA-Z0-9_-]/g, '-')}` })}</div>
      <div class="settings-workspace-members">${_memberListHtml(workspace, users)}</div>
      <div class="gb-field-row" style="justify-content:flex-start;">
        <label class="gb-field" style="margin:0;max-width:240px;"><span class="gb-label">追加するユーザー</span><input class="gb-input" data-workspace-new-user data-workspace-new-member data-e2e-id="settings-workspace-new-user-${_escape(workspace.id)}" list="${_escape(listId)}" autocomplete="off"></label>
        <datalist id="${_escape(listId)}">${options}</datalist>
        <select class="gb-select" data-workspace-new-role data-e2e-id="settings-workspace-new-role-${_escape(workspace.id)}" aria-label="追加するアカウントユーザーの権限">
          <option value="member">ユーザー</option>
          <option value="admin">管理者</option>
          <option value="viewer">閲覧のみ</option>
        </select>
        <button type="button" class="gb-btn gb-btn-sm" data-workspace-user-add data-workspace-member-add data-e2e-id="settings-workspace-user-add-${_escape(workspace.id)}">${_icon('userPlus', 14)} 追加</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-workspace-profile-sync data-e2e-id="settings-workspace-profile-sync-${_escape(workspace.id)}">${_icon('refreshCw', 14)} 自分を同期</button>
      </div>
    </section>`;
    }).join('');
    container.innerHTML = `<section class="gb-section gb-section--boxed" data-settings-view="workspace">
      <div class="gb-section-title">${_icon('usersRound', 14)} ワークスペース ${fieldHelp('作品・フォルダツリーのソースとは別に、チャットや共同作業で使う単位です。', { e2eId: 'workspace-scope-help' })}</div>
      <div class="gb-section-desc">ワークスペースごとのユーザー所属と権限を、各ワークスペース内で管理します。</div>
      <button type="button" class="gb-btn gb-btn-sm" data-settings-workspace-add data-e2e-id="settings-workspace-add">${_icon('plus', 14)} ワークスペースを追加</button>
    </section>${workspaceHtml}`;
    bindWorkspaceSettings(container);
    _reapplySettingsView(container);
  }

  function _reapplySettingsView(container) {
    const modal = container?.closest?.('.settings-modal');
    if (!modal || typeof _applySettingsNavigationView !== 'function' || typeof resolveSettingsNavigationTarget !== 'function') return;
    const target = resolveSettingsNavigationTarget(modal.dataset.settingsActiveTabId || 'ユーザー・共同作業', {
      pageId: modal.dataset.settingsActivePageId || 'workspace',
    });
    _applySettingsNavigationView(modal, target);
  }

  async function settingsInitWorkspaces(root) {
    const panel = _panel(root);
    if (!panel) return;
    panel.innerHTML = '<section class="gb-section gb-section--boxed" data-settings-view="workspace"><div class="gb-section-desc">読み込み中...</div></section>';
    try {
      const [rows, users] = await Promise.all([_workspaceRows(), _registryUsers()]);
      if (!rows.length) _renderEmpty(panel);
      else _renderRows(panel, rows, users);
    } catch {
      panel.innerHTML = '<section class="gb-section gb-section--boxed" data-settings-view="workspace"><div class="gb-section-desc">ワークスペースを読み込めませんでした。</div></section>';
    }
  }

  async function addWorkspaceFromSettings() {
    let picked = null;
    try { picked = await window.MeldexWorkspaces?.pickFolder?.(); } catch {}
    let path = String(picked?.path || '').trim();
    if (!path) {
      const promptLabel = window.MeldexRuntimeAdapter?.isDropboxMode?.()
        ? 'ワークスペースにするDropbox内フォルダ'
        : window.MeldexRuntimeAdapter?.isBrowserMode?.()
          ? 'ワークスペースにする端末内フォルダ'
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
        try {
          const users = await _registryUsers();
          const user = users.find(item => item.display === name || item.user === name);
          if (user?.user_type === 'virtual') {
            await window.MeldexUserRegistry.setUserWorkspace(user.user_id || user.user, id, true);
          } else {
            await apiFetch('/workspaces/' + encodeURIComponent(id) + '/members/' + encodeURIComponent(user?.user || name), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role, user_type: 'account', user_id: user?.user_id || '' }),
            });
            await window.MeldexWorkspaces.load({ force: true });
          }
          await settingsInitWorkspaces(document);
          _status(`「${user?.display || name}」をワークスペースへ追加しました`);
        } catch (error) {
          _status('ユーザーを追加できませんでした: ' + (error?.message || error), true);
        }
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
      card.querySelectorAll('[data-workspace-member-cli-chat]').forEach(checkbox => {
        checkbox.addEventListener('change', async () => {
          const memberName = checkbox.dataset.workspaceMemberCliChat || '';
          const allowed = checkbox.checked;
          if (allowed) {
            const warning = 'このユーザーを信頼し、管理者PCのCLI返答を許可しますか？\n安全対策を講じても、管理者PCへの影響を完全には排除できません。';
            const confirmed = typeof cfConfirm === 'function'
              ? await cfConfirm(warning)
              : window.confirm(warning);
            if (!confirmed) { checkbox.checked = false; return; }
          }
          checkbox.disabled = true;
          try {
            await apiFetch('/workspace-cli/phase4a/user-permission', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ workspace_id: id, user: memberName, allowed }),
            });
            await window.MeldexWorkspaces?.load?.({ force: true });
            await settingsInitWorkspaces(document);
            _status(allowed ? '管理者PCのCLI返答を許可しました' : '管理者PCのCLI返答を拒否しました');
          } catch (error) {
            checkbox.checked = !allowed;
            checkbox.disabled = false;
            _status('CLI返答権限を変更できませんでした: ' + (error?.message || error), true);
          }
        });
      });
      card.querySelectorAll('[data-workspace-virtual-remove]').forEach(button => {
        button.addEventListener('click', async () => {
          try {
            await window.MeldexUserRegistry.setUserWorkspace(button.dataset.workspaceVirtualRemove || '', id, false);
            await settingsInitWorkspaces(document);
            _status('仮ユーザーをワークスペースから外しました');
          } catch (error) {
            _status('仮ユーザーを外せませんでした: ' + (error?.message || error), true);
          }
        });
      });
    });
  }

  window.settingsInitWorkspaces = settingsInitWorkspaces;
})();
