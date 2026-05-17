  }
  // openSavedChat が右パネルのチャットタブを開いてロードする
  if (typeof openSavedChat === 'function') {
    openSavedChat(chatPath, '', sourceFolder);
  }
}

// エントリ単位のチャット起動フック
// 汎用: エントリパスから既存または新規のチャットを開始する
// - 右パネルを開き、openFileChat で targetPath 紐付きチャットを復元または作成
window.openEntityChatForPath = async function openEntityChatForPath(entityPath) {
  if (!entityPath) return;
  const rp = document.getElementById('right-panel');
  if (rp && rp.classList.contains('collapsed')) {
    const toggle = document.getElementById('btn-right-panel');
    if (toggle) toggle.click();
  }
  if (typeof openFileChat === 'function') {
    await openFileChat(entityPath);
  }
};
window.openEntityAiChat = window.openEntityChatForPath;

// ユーザープロパティ: 小型アバター
function _userAvatarSmall(username) {
  // team avatar → auth avatar → フォールバック（頭文字）の順で試す
  const teamAvatar = window.MeldexDataAccess?.team?.avatarUrl?.(username || 'anonymous', {}) || ('/api/team/avatar/' + encodeURIComponent(username));
  const authAvatar = window.MeldexDataAccess?.team?.authAvatarUrl?.(username || 'anonymous', {}) || ('/api/auth/avatar/' + encodeURIComponent(username));
  return '<img src="' + esc(teamAvatar) + '" '
    + 'style="width:16px;height:16px;border-radius:50%;object-fit:cover;vertical-align:middle;" '
    + 'onerror="this.onerror=null;this.src=\'' + esc(authAvatar) + '\';this.addEventListener(\'error\',()=>{this.style.display=\'none\';this.nextElementSibling.style.display=\'inline-flex\';},{once:true});">'
    + '<span style="display:none;width:16px;height:16px;border-radius:50%;background:var(--accent);color:var(--ui-fg-strong);font-size:9px;font-weight:bold;align-items:center;justify-content:center;vertical-align:middle;">'
    + esc((username || '?')[0].toUpperCase()) + '</span>';
}

// ユーザー選択ドロップダウン
async function _showUserDropdown(anchor, val, entityPath, propName, currentValue, isMulti, options) {
  const dropdownOptions = options || {};
  document.querySelectorAll('.user-dropdown').forEach(el => el.remove());

  // チームメンバー（優先）+ 旧auth users（後方互換）をマージ
  let users = [];
  const seen = new Set();
  try {
    const team = await apiFetch('/team');
    if (Array.isArray(team)) {
      team.forEach(m => { if (m.name && !seen.has(m.name)) { seen.add(m.name); users.push({ name: m.name, role: m.role || 'editor', has_avatar: !!m.has_avatar }); } });
    }
  } catch {}
  try {
    const authUsers = await apiFetch('/auth/users');
    if (Array.isArray(authUsers)) {
      authUsers.forEach(u => { if (u.name && !seen.has(u.name)) { seen.add(u.name); users.push(u); } });
    }
  } catch {}

  const dd = document.createElement('div');
  dd.className = 'cell-inline-dd user-dropdown';
  dd.style.cssText = 'position:fixed;z-index:9999;min-width:180px;max-height:300px;overflow-y:auto;background:var(--ui-popup-bg, var(--bg2));border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.3);padding:4px;';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'ユーザーを検索...';
  searchInput.style.cssText = 'width:100%;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;margin-bottom:4px;box-sizing:border-box;';
  dd.appendChild(searchInput);

  const selected = new Set(
    isMulti && currentValue ? currentValue.split(',').map(s => s.trim()).filter(Boolean) : []
  );
  if (!isMulti && currentValue) selected.add(currentValue.trim());

  function renderList(filter) {
    dd.querySelectorAll('.user-option,.user-confirm-btn,.user-clear-btn,.user-empty-msg').forEach(el => el.remove());

    if (users.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'user-empty-msg';
      msg.style.cssText = 'padding:8px;color:var(--fg2);font-size:12px;text-align:center;';
      msg.textContent = 'ユーザーが登録されていません。設定 → チームメンバーから追加してください';
      dd.appendChild(msg);
      return;
    }

    const filtered = filter
      ? users.filter(u => u.name.toLowerCase().includes(filter.toLowerCase()))
      : users;

    filtered.forEach(u => {
      const item = document.createElement('div');
      item.className = 'user-option';
      const isSelected = selected.has(u.name);
      item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;border-radius:3px;font-size:12px;'
        + (isSelected ? 'background:var(--accent);color:var(--ui-fg-strong);' : '');
      item.innerHTML = (isMulti ? '<span style="font-size:11px;">' + (isSelected ? '\u2713' : '\u3000') + '</span> ' : '')
        + _userAvatarSmall(u.name) + ' ' + esc(u.name)
        + '<span style="margin-left:auto;font-size:10px;color:' + (isSelected ? 'color-mix(in srgb, var(--ui-fg-strong) 70%, transparent)' : 'var(--fg2)') + ';">' + esc(u.role || '') + '</span>';
      item.addEventListener('mouseover', () => { if (!isSelected) item.style.background = 'var(--bg3)'; });
      item.addEventListener('mouseout', () => { if (!isSelected) item.style.background = ''; });
      item.addEventListener('click', async () => {
        if (isMulti) {
          if (selected.has(u.name)) selected.delete(u.name);
          else selected.add(u.name);
          renderList(searchInput.value);
        } else {
          const saved = await _saveUserValue(val, entityPath, propName, u.name, anchor, dropdownOptions);
          if (saved) dd.remove();
          else showStatus('ユーザーを保存できませんでした', true);
        }
      });
      dd.appendChild(item);
    });

    if (isMulti) {
      const confirmBtn = document.createElement('div');
      confirmBtn.className = 'user-confirm-btn';
      confirmBtn.style.cssText = 'padding:4px 8px;margin-top:4px;text-align:center;cursor:pointer;font-size:12px;color:var(--accent);border-top:1px solid var(--border);font-weight:bold;';
      confirmBtn.textContent = '\u2713 確定';
      confirmBtn.addEventListener('click', async () => {
        const saved = await _saveUserValue(val, entityPath, propName, [...selected].join(', '), anchor, dropdownOptions);
        if (saved) dd.remove();
        else showStatus('ユーザーを保存できませんでした', true);
      });
      dd.appendChild(confirmBtn);
    }

    if (!isMulti && currentValue) {
      const clearBtn = document.createElement('div');
      clearBtn.className = 'user-clear-btn';
      clearBtn.style.cssText = 'padding:4px 8px;text-align:center;cursor:pointer;font-size:11px;color:var(--fg2);border-top:1px solid var(--border);margin-top:4px;';
      clearBtn.textContent = '選択を解除';
      clearBtn.addEventListener('click', async () => {
        const saved = await _saveUserValue(val, entityPath, propName, '', anchor, dropdownOptions);
        if (saved) dd.remove();
        else showStatus('ユーザーを保存できませんでした', true);
      });
      dd.appendChild(clearBtn);
    }
  }

  searchInput.addEventListener('input', () => renderList(searchInput.value));
  renderList('');

  const rect = anchor.getBoundingClientRect();
  const _zu = _getZoom();
  dd.style.left = (rect.left / _zu) + 'px';
  dd.style.top = (rect.bottom / _zu + 2) + 'px';
  document.body.appendChild(dd);
  clampPopupToViewport(dd);
  _enableDropdownKeyNav(dd, '.user-option');
  searchInput.focus();

  setTimeout(() => {
    document.addEventListener('pointerdown', async function closer(ev) {
      if (!dd.contains(ev.target)) {
        let saved = false;
        if (isMulti) {
          saved = await _saveUserValue(val, entityPath, propName, [...selected].join(', '), anchor, dropdownOptions);
        }
        dd.remove();
        if (!saved && typeof dropdownOptions.onCancel === 'function') dropdownOptions.onCancel();
        document.removeEventListener('pointerdown', closer);
      }
    });
  }, 0);
}
