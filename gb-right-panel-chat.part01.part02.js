  _syncTeamRoomSelect(_teamRoomsCache);
  _restartTeamPolling();
}

let _teamMessagesLoadSerial = 0;
let _teamPollInFlight = false;
let _teamSending = false;
let _teamRenderedMessageKeys = new Set();

function _teamMessageKey(message) {
  const id = String(message?.id || message?.message_id || message?.msg_id || '').trim();
  if (id) return 'id:' + id;
  return [
    String(message?.timestamp || ''),
    String(message?.from || ''),
    String(message?.text || ''),
    String(message?.path || ''),
  ].join('\u001f');
}

function _teamMarkMessageRendered(message) {
  const key = _teamMessageKey(message);
  if (!key) return true;
  if (_teamRenderedMessageKeys.has(key)) return false;
  _teamRenderedMessageKeys.add(key);
  return true;
}

function _teamMarkdownImageAlt(name) {
  return String(name || 'image').replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

function _teamIsVisibleElement(el) {
  if (!el || !(el instanceof Element)) return false;
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function _teamChatRoot() {
  const roots = [...document.querySelectorAll('[id="rp-chat"]')]
    .filter(root => !root.closest('[data-gb-snapshot="true"]'));
  return roots.find(_teamIsVisibleElement) || roots[0] || document.getElementById('rp-chat');
}

function _teamElementById(id) {
  const root = _teamChatRoot();
  const scoped = root?.querySelector?.(`[id="${id}"]`);
  return scoped || document.getElementById(id);
}

function _teamSendButton() {
  return _teamElementById('team-send-btn')
    || document.querySelector('[data-action="teamSend()"], [onclick="teamSend()"]');
}

function _syncTeamRoomSelect(rooms) {
  const select = _teamElementById('team-room-select');
  if (!select) return;
  const current = _teamCurrentRoom;
  const visibleRooms = (rooms || []).filter(room => !_isBuiltInGeneralRoom(room));
  select.innerHTML = '<option value="">ルームを選択</option>' + visibleRooms.map(room => {
    const label = room.type === 'dm' ? 'DM: ' + _roomDisplayName(room) : _roomDisplayName(room);
    return `<option value="${esc(room.path)}" ${room.path===current?'selected':''}>${esc(label)}</option>`;
  }).join('');
}

async function loadTeamRooms() {
  const list = document.getElementById('team-room-list');
  if (!_chatSourceFolderValue() && !_chatWorkspaceIdValue()) {
    _teamRoomsCache = [];
    _clearTeamRoomSelection();
    if (typeof _restartTeamPolling === 'function') _restartTeamPolling();
    _syncTeamRoomSelect([]);
    _renderTeamRoomTitle(null);
    if (list) {
      list.style.display = 'none';
      list.innerHTML = '';
    }
    return;
  }
  try {
    let rooms = await apiFetch(_chatApiPath('/collab/rooms'));
    const me = getUsername();
    rooms = rooms.filter(room => !_isBuiltInGeneralRoom(room) && _isRoomVisibleToUser(room, me));
    _teamRoomsCache = rooms;
    if (_teamCurrentRoom && !_teamRoomByPath(_teamCurrentRoom)) {
      _clearTeamRoomSelection();
    }
    _syncTeamRoomSelect(rooms);
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom));
    if (!list) return;
    list.style.display = 'none';
    list.innerHTML = rooms.map(r => {
      const active = r.path === _teamCurrentRoom;
      const lastBody = String(r.last?.text ?? '');
      const lastFrom = String(r.last?.from ?? '');
      const lastText = r.last ? esc((lastFrom ? lastFrom + ': ' : '') + lastBody.substring(0, 30)) : '';
      const typeIcon = { general: lucide('messagesSquare',12), dm: lucide('user',12), group: lucide('users',12), file: lucide('paperclip',12) }[r.type] || lucide('messagesSquare',12);
      const displayName = _roomDisplayName(r);
      return `<div data-room-path="${esc(r.path)}" data-room-name="${esc(r.name)}" data-room-type="${esc(r.type || 'general')}" data-room-display="${esc(displayName)}" data-action="selectTeamRoom" data-args="${esc(JSON.stringify([r.path]))}" style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border);${active?'background:var(--bg4);':''}" title="${lastText}">` +
        `<div>${typeIcon} <span class="team-room-name">${esc(displayName)}</span></div>` +
        (lastText ? `<div style="font-size:10px;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${lastText}</div>` : '') +
        `</div>`;
    }).join('');
    // 右クリック/ダブルクリックでリネーム/削除
    list.querySelectorAll('[data-room-path]').forEach(row => {
      const room = { path: row.dataset.roomPath, name: row.dataset.roomName, type: row.dataset.roomType, displayName: row.dataset.roomDisplay };
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); showTeamRoomContextMenu(e, room); });
      if (typeof addLongPressHandler === 'function') {
        addLongPressHandler(row, (e) => showTeamRoomContextMenu(e, room));
      }
      row.addEventListener('dblclick', (e) => { if (room.type === 'dm') return; e.stopPropagation(); _doRenameTeamRoom(room); });
    });
  } catch(e) {
    if (list) {
      list.style.display = 'none';
      list.innerHTML = '';
    }
  }
}

function _teamRoomDeleteLabel(room) {
  return room?.type === 'dm' ? 'DMを閉じる' : 'ルームを削除';
}

function _renderTeamRoomTitle(room) {
  const title = document.getElementById('team-room-title');
  if (!title) return;
  title.innerHTML = '';
  title.style.display = 'flex';
  title.style.alignItems = 'center';
  title.style.gap = '6px';
  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  if (!room) {
    nameEl.textContent = 'ルームを選択';
    nameEl.style.color = 'var(--fg2)';
    title.appendChild(nameEl);
    return;
  }

  nameEl.textContent = _roomDisplayName(room) || room.name || room.path || '';
  if (room.type !== 'dm') {
    nameEl.tabIndex = 0;
    nameEl.title = 'クリックしてルーム名を編集';
    nameEl.style.cursor = 'text';
    nameEl.addEventListener('click', () => _beginTeamRoomTitleEdit(room));
    nameEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'F2') {
        event.preventDefault();
        _beginTeamRoomTitleEdit(room);
      }
    });
  }
  title.appendChild(nameEl);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.dataset.e2eId = 'team-room-delete-button';
  deleteBtn.title = _teamRoomDeleteLabel(room);
  deleteBtn.setAttribute('aria-label', _teamRoomDeleteLabel(room));
  deleteBtn.innerHTML = lucide('trash2', 13);
  deleteBtn.style.cssText = 'margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:transparent;color:var(--fg2);border:1px solid transparent;border-radius:4px;cursor:pointer;padding:0;';
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    _deleteTeamRoom(room);
  });
  title.appendChild(deleteBtn);
}

function _beginTeamRoomTitleEdit(room) {
  if (!room || room.type === 'dm') return;
  const title = document.getElementById('team-room-title');
  if (!title) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'team-room-title-input';
  input.className = 'team-room-title-input';
  input.dataset.e2eId = 'team-room-title-input';
  input.setAttribute('aria-label', 'ルーム名');
  input.title = 'ルーム名';
  input.value = room.name || _roomDisplayName(room) || '';
  input.style.cssText = 'flex:1;min-width:0;font:inherit;font-weight:bold;background:var(--bg);color:var(--fg);border:1px solid var(--accent);border-radius:3px;padding:2px 6px;';
  title.innerHTML = '';
  title.appendChild(input);
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'team-room-title-cancel-btn';
  cancelBtn.dataset.e2eId = 'team-room-title-cancel-button';
  cancelBtn.title = '編集をキャンセル';
  cancelBtn.setAttribute('aria-label', '編集をキャンセル');
  cancelBtn.innerHTML = lucide('x', 13);
  cancelBtn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:transparent;color:var(--fg2);border:1px solid transparent;border-radius:4px;cursor:pointer;padding:0;';
  title.appendChild(cancelBtn);
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const nextName = input.value.trim();
    if (commit && nextName && nextName !== room.name) {
      await _renameTeamRoom(room, nextName);
      return;
    }
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom) || room);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  cancelBtn.addEventListener('mousedown', (event) => event.preventDefault());
  cancelBtn.addEventListener('click', () => finish(false));
  input.focus();
  input.select();
}

async function _deleteTeamRoom(room) {
  if (!room?.path) return;
  if (!_chatRequireSourceFolder()) return;
  const ok = await cfConfirm(`ルーム「${_roomDisplayName(room) || room.name || room.path}」を本当に削除しますか？\n\n全メッセージが失われます。`);
  if (!ok) return;
  try {
    await apiFetch(_chatApiPath('/collab/rooms?path=' + encodeURIComponent(room.path)), { method: 'DELETE' });
    if (_teamCurrentRoom === room.path) _clearTeamRoomSelection();
    await loadTeamRooms();
    showStatus(room.type === 'dm' ? 'DMを閉じました' : 'ルームを削除しました');
  } catch (e) { showStatus('削除に失敗', true); }
}

async function _renameTeamRoom(room, newName) {
  if (!room?.path || room.type === 'dm') return;
  if (!_chatRequireSourceFolder()) {
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom) || room);
    return;
  }
  const name = String(newName || '').trim();
  if (!name || name === room.name) {
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom) || room);
    return;
  }
  try {
    const res = await apiPost(_chatApiPath('/collab/rooms/rename'), _chatPostPayload({ path: room.path, new_name: name }));
    if (_teamCurrentRoom === room.path && res?.path) {
      _teamCurrentRoom = res.path;
    }
    await loadTeamRooms();
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom) || { ...room, name, path: res?.path || room.path });
    showStatus('ルームをリネームしました');
  } catch (e) {
    _renderTeamRoomTitle(_teamRoomByPath(_teamCurrentRoom) || room);
    showStatus('リネームに失敗', true);
  }
}

function _chatContextMenuCanRestoreFocus(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tabIndex >= 0) return true;
  return /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/i.test(el.tagName);
}

function _chatContextMenuTrigger(e) {
  const trigger = e?.currentTarget || e?.target || document.activeElement;
  return _chatContextMenuCanRestoreFocus(trigger) ? trigger : null;
}

function _chatAppendContextMenuItem(menu, { icon, label, danger, action }) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'gb-context-menu-item' + (danger ? ' danger' : '');
  item.setAttribute('role', 'menuitem');
  item.innerHTML = lucide(icon, 14) + ' ' + esc(label);
  item.addEventListener('click', async () => {
    const close = menu.__chatContextMenuClose;
    if (typeof close === 'function') close(true);
    else menu.remove();
    await action?.();
  });
  menu.appendChild(item);
  return item;
}

function _showChatContextMenu(e, ariaLabel, buildItems) {
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', ariaLabel);
  buildItems(menu);
  document.body.appendChild(menu);
  const trigger = _chatContextMenuTrigger(e);
  const _z = (typeof _getZoom === 'function') ? _getZoom() : 1;
  menu.style.left = ((Number(e?.clientX) || 0) / _z) + 'px';
  menu.style.top = ((Number(e?.clientY) || 0) / _z) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);

  let closeMenu;
  const restoreFocus = () => {
    if (!trigger || !trigger.isConnected) return;
    try { trigger.focus({ preventScroll: true }); } catch {}
  };
  const pointerHandler = (ev) => {
    if (!menu.contains(ev.target)) closeMenu(true);
  };
  const keyHandler = (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    closeMenu(true);
  };
  closeMenu = (restore = false) => {
    if (!menu.isConnected) return;
    menu.remove();
    document.removeEventListener('pointerdown', pointerHandler, true);
    document.removeEventListener('keydown', keyHandler, true);
    if (restore) restoreFocus();
  };
  menu.__chatContextMenuClose = closeMenu;
  document.addEventListener('keydown', keyHandler, true);
  setTimeout(() => {
    document.addEventListener('pointerdown', pointerHandler, true);
    menu.querySelector('.gb-context-menu-item:not(:disabled)')?.focus?.({ preventScroll: true });
  }, 0);
  return menu;
}

// ルーム右クリックメニュー
function showTeamRoomContextMenu(e, room) {
  _showChatContextMenu(e, 'ルームメニュー', (menu) => {
    if (room.type !== 'dm') {
      _chatAppendContextMenuItem(menu, {
        icon: 'pencil',
        label: 'リネーム',
        action: () => _doRenameTeamRoom(room),
      });
    }
    _chatAppendContextMenuItem(menu, {
      icon: 'trash2',
      label: room.type === 'dm' ? 'DMを閉じる' : 'ルームを削除',
      danger: true,
      action: () => _deleteTeamRoom(room),
    });
  });
}

async function _doRenameTeamRoom(room) {
  const newName = await cfPrompt('新しいルーム名:', room.name);
  if (!newName || newName === room.name) return;
  await _renameTeamRoom(room, newName);
}

async function selectTeamRoom(roomPath) {
  if (roomPath && !_chatRequireSourceFolder()) return;
  if (!roomPath) {
    _clearTeamRoomSelection();
    return;
  }
  const hiddenGeneral = _isBuiltInGeneralRoom({ path: roomPath, name: roomPath, type: 'general' });
  if (hiddenGeneral) {
    _clearTeamRoomSelection();
    await loadTeamRooms();
    return;
  }
  _chatSaveCurrentRoomModelSettings();
  _teamCurrentRoom = roomPath;
  _chatApplyRoomModelSettings(roomPath);
  _teamLastTimestamp = '';
  _teamSessionGen++;
  if (typeof _teamClearPendingAttachments === 'function') {
    _teamClearPendingAttachments({ cleanupUploads: true });
  } else {
    _teamPendingAttachments = [];
    if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
  }
  const room = _teamRoomByPath(roomPath) || { path: roomPath, name: roomPath.split('/').pop(), type: roomPath.startsWith('dm/') ? 'dm' : 'general' };
  _renderTeamRoomTitle(room);
  await loadTeamRooms(); // ハイライト更新
  await loadTeamMessages();
  // ポーリング開始
  _restartTeamPolling();
}

async function showDirectMessageModal() {
  if (!_chatRequireSourceFolder()) return;
  const me = getUsername();
  let users = [];
  const seen = new Set([me]);
  const workspaceId = typeof _chatWorkspaceIdValue === 'function' ? _chatWorkspaceIdValue() : '';
  if (workspaceId) {
    try {
      const payload = await apiFetch('/workspaces/' + encodeURIComponent(workspaceId) + '/members');
      (payload?.members || []).forEach(member => {
        const name = String(member?.name || '').trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          users.push(name);
        }
      });
    } catch {}
  } else {
    // 候補ユーザー一覧は正本「スタッフ管理シート」から取得する（ユーザー
    // アカウント一元管理 計画書 Phase 5、旧 /team・/auth/users の個別マージ
    // 実装を置換）。ワークスペース内DMではワークスペースメンバーのみに絞る
    // 従来挙動は維持する。
    try {
      const staff = window.MeldexUserRegistry ? await window.MeldexUserRegistry.listStaff() : [];
      staff.forEach(row => {
        const name = String(row?.user || '').trim();
        if (name && !seen.has(name)) {
          seen.add(name);
          users.push(name);
        }
      });
    } catch {}
  }
  users.sort((a, b) => a.localeCompare(b, 'ja'));
  if (!users.length) {
    showStatus('DMできるユーザーが見つかりません', true);
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.chatDmModal = '1';
  overlay.innerHTML = `<div class="modal chat-dm-modal" role="dialog" aria-modal="true" aria-labelledby="team-dm-title" style="min-width:320px;">
    <h3 id="team-dm-title">ダイレクトメッセージ</h3>
    <div class="field">
      <label>相手</label>
      <select id="team-dm-user" style="width:100%;padding:6px 8px;">
        ${users.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
      </select>
    </div>
    <div class="btn-row" style="margin-top:12px;">
      <button type="button" data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button type="button" class="primary" id="team-dm-open">開く</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#team-dm-open')?.addEventListener('click', async () => {
    const openBtn = overlay.querySelector('#team-dm-open');
    const targetUser = overlay.querySelector('#team-dm-user')?.value;
    if (!targetUser) return;
    if (openBtn) openBtn.disabled = true;
    try {
      const roomName = _canonicalDmRoomName(me, targetUser);
      let room = _teamRoomsCache.find(item => item.type === 'dm' && item.name === roomName);
      if (!room) {
        const res = await apiPost(_chatApiPath('/collab/rooms'), _chatPostPayload({ name: roomName, type: 'dm' }));
        room = { name: roomName, path: res?.path || ('dm/' + roomName), type: 'dm' };
      }
      overlay.remove();
      await loadTeamRooms();
      await selectTeamRoom(room.path);
    } catch (e) {
      if (openBtn) openBtn.disabled = false;
      showStatus('DMを開けませんでした: ' + (e.message || ''), true);
    }
  });
}

document.getElementById('team-room-select')?.addEventListener('change', function() {
  selectTeamRoom(this.value);
});

// チームメッセージDOM生成（共通ヘルパー）
function _buildTeamMessageRow(m, me) {
  m = {
    ...(m || {}),
    from: String(m?.from ?? ''),
    text: typeof m?.text === 'string' ? m.text : (m?.text == null ? '' : String(m.text)),
  };
  const isMine = m.from === me;
  // 行: アバター + フキダシ（行全体でalign-selfで左右配置）
  const row = document.createElement('div');
  row.className = 'chat-message-row chat-message-row-team chat-copy-message' + (isMine ? ' is-mine' : '');
  row.style.cssText = 'display:flex;gap:6px;max-width:85%;align-items:flex-start;' + (isMine ? 'align-self:flex-end;flex-direction:row-reverse;' : 'align-self:flex-start;flex-direction:row;');
  row.dataset.msgText = m.text;
  row.dataset.msgFrom = m.from;
  row.dataset.msgTime = m.timestamp || '';
  row.dataset.chatCopyAuthor = m.from || me || '';
  row.dataset.chatCopyTime = typeof _chatFormatMessageTimestamp === 'function'
    ? _chatFormatMessageTimestamp(m.timestamp || '')
    : String(m.timestamp || '');
  // アバター
  if (typeof _userAvatarSmall === 'function') {
    const avatar = document.createElement('span');
    avatar.style.cssText = 'flex-shrink:0;margin-top:2px;';
    avatar.innerHTML = _userAvatarSmall(m.from);
    // アバターを24pxに拡大
    avatar.querySelectorAll('img,span').forEach(el => { el.style.width = '24px'; el.style.height = '24px'; el.style.fontSize = '12px'; });
    row.appendChild(avatar);
  }
  // フキダシ
  const div = document.createElement('div');
  div.className = 'chat-message-bubble chat-message-bubble-team';
  div.style.cssText = (isMine
    ? 'background:var(--accent);color:var(--ui-fg-strong);padding:6px 10px;border-radius:10px 2px 10px 10px;'
    : 'background:var(--bg3);color:var(--fg);padding:6px 10px;border-radius:2px 10px 10px 10px;')
    + 'font-size:13px;user-select:text;cursor:text;';
  // 名前（自分以外）
  if (!isMine) {
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:10px;font-weight:bold;color:var(--accent);margin-bottom:2px;user-select:text;';
    nameEl.textContent = m.from;
    div.appendChild(nameEl);
  }
  // 本文
  const textEl = document.createElement('div');
  textEl.className = 'chat-message-text chat-copy-body';
  textEl.style.cssText = 'white-space:pre-wrap;word-break:break-word;user-select:text;';
  const _so = typeof isStampOnly === 'function' && isStampOnly(m.text);
  const _hasImage = /!\[[^\]]*\]\([^)]+\)/.test(m.text || '');
  if (_so) {
    div.style.background = 'transparent'; div.style.padding = '4px';
    textEl.innerHTML = typeof renderStampsLarge === 'function' ? renderStampsLarge(esc(m.text)) : esc(m.text);
  } else if (typeof renderStamps === 'function' && m.text.includes('::stamp:')) {
    if (typeof renderChatMarkdown === 'function') renderChatMarkdown(textEl, m.text, { role: isMine ? 'user' : 'assistant' });
    else textEl.innerHTML = renderStamps(esc(m.text));
  } else if (_hasImage && typeof renderChatMarkdown !== 'function') {
    _renderTeamMessageWithImages(textEl, m.text);
  } else {
    if (typeof renderChatMarkdown === 'function') renderChatMarkdown(textEl, m.text, { role: isMine ? 'user' : 'assistant' });
    else textEl.textContent = m.text;
  }
  div.appendChild(textEl);
  // タイムスタンプ
  const timeEl = document.createElement('div');
  timeEl.style.cssText = 'font-size:9px;opacity:0.6;text-align:right;margin-top:2px;';
  timeEl.textContent = (m.timestamp || '').substring(11, 16);
  div.appendChild(timeEl);
  // 右クリックメニュー（コピー） ＋ 長押しで同メニュー（タッチ/ペン）
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _showChatMessageMenu(e, m);
  });
  if (typeof addLongPressHandler === 'function') {
    addLongPressHandler(row, (e) => _showChatMessageMenu(e, m));
  }
  row.appendChild(div);
  return row;
}

// メッセージ右クリックメニュー
function _showChatMessageMenu(e, m) {
  const items = [
    { icon: 'copy', label: 'テキストをコピー', action: () => _chatCopyText(m.text, 'テキストをコピーしました') },
    { icon: 'copy', label: '名前+テキストをコピー', action: () => _chatCopyText(m.from + ': ' + m.text, '名前とテキストをコピーしました') },
  ];
  _showChatContextMenu(e, 'メッセージメニュー', (menu) => {
    items.forEach(it => _chatAppendContextMenuItem(menu, it));
  });
}

async function loadTeamMessages() {
  const roomPath = _teamCurrentRoom;
  if (!roomPath) return;
  if (!_chatSourceFolderValue() && !_chatWorkspaceIdValue()) return;
  const container = document.getElementById('team-messages');
  if (!container) return;
  const loadSerial = ++_teamMessagesLoadSerial;
  const sessionGen = _teamSessionGen;
  try {
    const msgs = await apiFetch(_chatApiPath('/collab/messages?room=' + encodeURIComponent(roomPath) + '&limit=100'));
    if (loadSerial !== _teamMessagesLoadSerial || sessionGen !== _teamSessionGen || roomPath !== _teamCurrentRoom) return;
    container.innerHTML = '';
    _teamRenderedMessageKeys = new Set();
    _teamLastTimestamp = '';
    const me = getUsername();
    (Array.isArray(msgs) ? msgs : []).forEach(m => {
      if (!_teamMarkMessageRendered(m)) return;
      container.appendChild(_buildTeamMessageRow(m, me));
      _teamLastTimestamp = m.timestamp || _teamLastTimestamp;
    });
    _chatRevealLatest('team');
  } catch(e) {}
}

async function pollTeamMessages(options = {}) {
  // v5.0: ペインシステムではright-panel.openクラスは使わない。
  // rp-chatがペインにマウントされているか（表示中か）を確認する。
  const rpChat = document.getElementById('rp-chat');
  const chatVisible = rpChat && rpChat.closest('.gb-pane-content') && rpChat.style.display !== 'none';
  if ((!_chatSourceFolderValue() && !_chatWorkspaceIdValue()) || !_teamCurrentRoom || _chatMode !== 'team' || !chatVisible) { clearInterval(_teamPollTimer); _teamPollTimer = null; return; }
  if (_teamPollInFlight) return;
  const roomPath = _teamCurrentRoom;
  const since = _teamLastTimestamp;
  const sessionGen = _teamSessionGen;
  _teamPollInFlight = true;
  try {
    const msgs = await apiFetch(_chatApiPath('/collab/messages?room=' + encodeURIComponent(roomPath) + '&since=' + encodeURIComponent(since)));
    if (sessionGen !== _teamSessionGen || roomPath !== _teamCurrentRoom) return;
    const list = Array.isArray(msgs) ? msgs : [];
    if (list.length === 0) return;
    const container = document.getElementById('team-messages');
    if (!container) return;
    const shouldStickToLatest = _chatShouldStickToBottom(container, options.forceLatest === true);
    const me = getUsername();
    list.forEach(m => {
      if (!_teamMarkMessageRendered(m)) return;
      container.appendChild(_buildTeamMessageRow(m, me));
      _teamLastTimestamp = m.timestamp || _teamLastTimestamp;
    });
    _chatScrollToBottomIf(container, shouldStickToLatest);
  } catch(e) {
  } finally {
    _teamPollInFlight = false;
  }
}

async function teamSend() {
  if (!_chatRequireSourceFolder()) return;
  if (!_teamCurrentRoom) { showStatus('ルームを選択してください', true); return; }
  if (_teamSending) return;
  const input = document.getElementById('team-input');
  if (!input) return;
  const roomPath = _teamCurrentRoom;
  const text = input.value.trim();
  let atts = _teamPendingAttachments || [];
  if (!text && atts.length === 0) return;
  if (atts.length > 0) {
    const readyAttachments = await _teamWaitForPendingAttachmentUploads(atts);
    if (!readyAttachments) return false;
    atts = readyAttachments;
  }
  const pendingBeforeSend = atts.slice();
  const sendBtn = _teamSendButton();
  const inputWasDisabled = !!input.disabled;
  const sendWasDisabled = !!sendBtn?.disabled;
  // 画像があれば末尾に Markdown 画像として付与
  let finalText = text;
  if (atts.length > 0) {
    const imgs = atts.map(a => `![${_teamMarkdownImageAlt(a.name)}](/api/file-raw?path=${encodeURIComponent(a.path)})`).join('\n');
    finalText = text ? (text + '\n' + imgs) : imgs;
  }
  _teamSending = true;
  input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  if (typeof _chatWithDraftUploadCleanupPaused === 'function') {
    _chatWithDraftUploadCleanupPaused(() => { input.value = ''; });
  } else {
    input.value = '';
  }
  _teamPendingAttachments = [];
  _autoGrowTextarea(input, 2, 8);
  if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
  try {
    await apiPost(_chatApiPath('/collab/send'), _chatPostPayload({ room: roomPath, text: finalText, from: getUsername() }));
    if (typeof _chatCommitDraftUploadsForText === 'function') _chatCommitDraftUploadsForText('team-input', text);
    if (_teamCurrentRoom === roomPath) await pollTeamMessages({ forceLatest: true });
  } catch(e) {
    if (_teamCurrentRoom === roomPath) {
      input.value = text;
      _teamPendingAttachments = pendingBeforeSend;
      _autoGrowTextarea(input, 2, 8);
      if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
      showStatus('送信に失敗', true);
    }
  } finally {
    _teamSending = false;
    if (input.isConnected) input.disabled = inputWasDisabled;
    if (sendBtn?.isConnected) sendBtn.disabled = sendWasDisabled;
  }
}

// ===== チーム/DM: 画像添付（マルチモーダル） =====
function teamAttachmentPick() {
  if (!_teamCurrentRoom) { showStatus('ルームを選択してください', true); return; }
  const fileInput = _teamElementById('team-attachment-file');
  if (!fileInput) return;
  fileInput.value = '';
  fileInput.onchange = async () => {
    const files = Array.from(fileInput.files || []);
    for (const f of files) {
      await _teamUploadAttachment(f);
    }
    fileInput.value = '';
  };
  fileInput.click();
}
window.teamAttachmentPick = teamAttachmentPick;

function _teamIsImageAttachmentFile(file) {
  return !!file && (
    file.type?.startsWith('image/') ||
    /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name || '')
  );
}

function _teamAttachmentFileName(file) {
  const raw = String(file?.name || '').trim();
  if (raw) return raw;
  const subtype = String(file?.type || '').split('/')[1] || 'png';
  const ext = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/gi, '') || 'png';
  return 'clipboard-image.' + ext;
}

async function _teamUploadAttachment(file) {
  const roomPath = _teamCurrentRoom;
  if (!roomPath) {
    showStatus('ルームを選択してください', true);
    return false;
  }
  if (!_teamIsImageAttachmentFile(file)) {
    showStatus('画像ファイルのみ添付できます', true);
    return false;
  }
  if (file.size > 32 * 1024 * 1024) {
    showStatus('添付ファイルは32MB以下にしてください', true);
    return false;
  }
  const gen = _teamSessionGen;
  const uploadDir = _teamChatUploadDir();
  const fileName = _teamAttachmentFileName(file);
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('read error'));
      r.readAsDataURL(file);
    });
    if (gen !== _teamSessionGen || roomPath !== _teamCurrentRoom) return false;
    const att = {
      name: fileName,
      path: '',
      mime: file.type || 'image/png',
      dataUrl,
      uploaded: false,
      uploading: true,
      uploadError: '',
    };
    _teamPendingAttachments.push(att);
    _renderTeamAttachments();
    _teamStartAttachmentUpload(att, roomPath, uploadDir, gen);
    return att;
  } catch (e) {
    if (gen !== _teamSessionGen || roomPath !== _teamCurrentRoom) return false;
    showStatus('画像のアップロードに失敗しました', true);
    return false;
  }
}

function _teamStartAttachmentUpload(att, roomPath, uploadDir, gen) {
  att.uploadPromise = apiFetch('/upload-file?path=' + encodeURIComponent(uploadDir), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: att.dataUrl, filename: att.name }),
  }).then(res => {
    const uploadedPath = res.path || att.name;
    if (gen !== _teamSessionGen || roomPath !== _teamCurrentRoom || att.canceled) {
      if (uploadedPath && typeof _chatCleanupUploadedPath === 'function') _chatCleanupUploadedPath(uploadedPath);
      return false;
    }
    att.path = uploadedPath;
    att.uploaded = true;
    att.uploading = false;
    att.uploadError = '';
    _renderTeamAttachments();
    return true;
  }).catch(error => {
    if (gen !== _teamSessionGen || roomPath !== _teamCurrentRoom || att.canceled) return false;
    att.uploading = false;
    att.uploadError = error?.message || 'upload failed';
    _renderTeamAttachments();
    if (typeof showStatus === 'function') showStatus('画像のアップロードに失敗しました', true);
    return false;
  });
  return att.uploadPromise;
}

async function _teamWaitForPendingAttachmentUploads(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const pending = list.filter(att => att?.uploading && att.uploadPromise);
  if (pending.length && typeof showStatus === 'function') showStatus('添付ファイルのアップロード完了を待っています...');
  for (const att of pending) {
    try { await att.uploadPromise; } catch {}
  }
  const failed = list.filter(att => att?.uploadError || att?.uploading || !String(att?.path || '').trim());
  if (failed.length) {
    if (typeof showStatus === 'function') showStatus('アップロード未完了の添付があります。削除して貼り直してください。', true);
    _renderTeamAttachments();
    return null;
  }
  return list;
}

function _teamClipboardAttachmentFiles(event) {
  const files = [];
  const seen = new Set();
  const addFile = (file) => {
    if (!file) return;
    const key = [file.name || '', file.type || '', file.size || 0, file.lastModified || 0].join('\n');
    if (seen.has(key)) return;
    seen.add(key);
    if (_teamIsImageAttachmentFile(file)) files.push(file);
  };
  Array.from(event?.clipboardData?.files || []).forEach(addFile);
  Array.from(event?.clipboardData?.items || []).forEach((item) => {
    if (item?.kind !== 'file') return;
    try { addFile(item.getAsFile()); } catch {}
  });
  return files;
}

async function _handleTeamClipboardAttachments(event, filesOverride) {
  if (typeof _teamUploadAttachment !== 'function') return false;
  const files = Array.isArray(filesOverride) ? filesOverride : _teamClipboardAttachmentFiles(event);
  if (!files.length) return false;
  event.preventDefault();
  event.stopPropagation();
  let uploaded = 0;
  for (const file of files) {
    if (await _teamUploadAttachment(file)) uploaded += 1;
  }
  if (uploaded > 0 && typeof showStatus === 'function') {
    showStatus(uploaded === 1 ? 'クリップボードから添付しました' : uploaded + '件を添付しました');
  }
  return uploaded > 0;
}

function _bindTeamClipboardPaste() {
  const input = document.getElementById('team-input');
  if (!input || input.dataset.teamClipboardPasteBound === '1') return;
  input.dataset.teamClipboardPasteBound = '1';
  input.addEventListener('paste', (event) => {
    const files = _teamClipboardAttachmentFiles(event);
    if (!files.length) return;
    _handleTeamClipboardAttachments(event, files).catch(() => {
      if (typeof showStatus === 'function') showStatus('添付ファイルのアップロードに失敗しました', true);
    });
  });
}

function _renderTeamAttachments() {
  const bar = document.getElementById('team-attachments-bar');
  if (!bar) return;
  const list = _teamPendingAttachments || [];
  bar.innerHTML = '';
  if (list.length === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  list.forEach((att, idx) => {
    const chip = document.createElement('div');
    const hasError = !!att.uploadError;
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 6px;background:var(--bg);border:1px solid ' + (hasError ? 'var(--danger, #d9534f)' : 'var(--border)') + ';border-radius:3px;max-width:100%;';
    const img = document.createElement('img');
    img.src = att.dataUrl;
    img.alt = att.name;
    img.style.cssText = 'width:24px;height:24px;object-fit:cover;border-radius:2px;flex-shrink:0;';
    const label = document.createElement('span');
    const suffix = att.uploading ? '（アップロード中）' : (hasError ? '（失敗）' : '');
    label.textContent = att.name + suffix;
    label.title = att.name + suffix;
    label.style.cssText = 'max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = '削除';
    close.style.cssText = 'background:transparent;color:var(--fg2);border:none;cursor:pointer;padding:0 4px;font-size:14px;line-height:1;';
    close.addEventListener('click', () => {
      const removed = _teamPendingAttachments.splice(idx, 1);
      if (typeof _chatCleanupUploadedAttachments === 'function') _chatCleanupUploadedAttachments(removed);
      _renderTeamAttachments();
    });
    chip.appendChild(img);
    chip.appendChild(label);
    chip.appendChild(close);
    bar.appendChild(chip);
  });
}
window._renderTeamAttachments = _renderTeamAttachments;

// Markdown 画像を含むチームメッセージ本文をレンダリング（textContent + <img>）
// 安全な URL（/api/file-raw?... または相対 /file-raw?...）のみ画像化、他はテキスト
function _renderTeamMessageWithImages(container, text) {
  container.innerHTML = '';
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const seg = document.createElement('div');
      seg.style.cssText = 'white-space:pre-wrap;word-break:break-word;user-select:text;';
      seg.textContent = text.substring(last, m.index);
      container.appendChild(seg);
    }
    const alt = m[1];
    const url = m[2];
    if (url.startsWith('/api/file-raw?') || url.startsWith('/file-raw?')) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = alt;
      img.loading = 'lazy';
      img.style.cssText = 'max-width:240px;max-height:240px;border-radius:4px;margin-top:4px;display:block;object-fit:contain;cursor:zoom-in;';
      img.addEventListener('click', () => {
        if (typeof openImageViewer === 'function') openImageViewer(url, alt);
        else window.open(url, '_blank');
      });
      container.appendChild(img);
    } else {
      const seg = document.createElement('span');
      seg.textContent = m[0];
      container.appendChild(seg);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const seg = document.createElement('div');
    seg.style.cssText = 'white-space:pre-wrap;word-break:break-word;user-select:text;';
    seg.textContent = text.substring(last);
    container.appendChild(seg);
  }
}

function _chatBindImeCompositionGuard(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.chatImeGuardBound === '1') return;
  input.dataset.chatImeGuardBound = '1';
  input.addEventListener('compositionstart', () => {
    input.dataset.chatImeComposing = '1';
  });
  input.addEventListener('compositionend', () => {
    input.dataset.chatImeComposing = '0';
    input.dataset.chatLastCompositionEnd = String(Date.now());
  });
}

function _chatIsImeEnterEvent(event) {
  const target = event?.target;
  const lastEnd = Number(target?.dataset?.chatLastCompositionEnd || 0);
  return !!(
    event?.isComposing ||
    event?.keyCode === 229 ||
    event?.which === 229 ||
    target?.dataset?.chatImeComposing === '1' ||
    (lastEnd && Date.now() - lastEnd < 120)
  );
}

_chatBindImeCompositionGuard('team-input');
_bindTeamClipboardPaste();
document.getElementById('team-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    if (_chatIsImeEnterEvent(e)) return;
    e.preventDefault();
    teamSend();
  }
});

// textarea auto-grow（入力内容に合わせて高さを調整）
function _autoGrowTextarea(ta, minRows, maxRows) {
  if (!ta) return;
  const fontSize = parseFloat(getComputedStyle(ta).fontSize) || 13;
  const lineHeight = fontSize * 1.4;
  const padding = 16; // 上下padding合計
  const minH = (minRows || 2) * lineHeight + padding;
  const maxH = (maxRows || 8) * lineHeight + padding;
  if (ta.dataset.chatManualHeight === '1') {
    const manualMaxH = Number(ta.dataset.chatManualMaxHeight || 0);
    const effectiveMaxH = Math.max(maxH, Number.isFinite(manualMaxH) ? manualMaxH : 0);
    const currentH = parseFloat(ta.style.height) || ta.getBoundingClientRect().height || minH;
    const newH = Math.min(Math.max(currentH, ta.scrollHeight, minH), effectiveMaxH);
    ta.style.height = newH + 'px';
    ta.style.overflowY = ta.scrollHeight > newH + 1 ? 'auto' : 'hidden';
    return;
  }
  ta.style.height = 'auto';
  const newH = Math.min(Math.max(ta.scrollHeight, minH), maxH);
  ta.style.height = newH + 'px';
  ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden';
}
document.getElementById('team-input')?.addEventListener('input', function() { _autoGrowTextarea(this, 2, 8); });
_chatBindImeCompositionGuard('chat-input');
document.getElementById('chat-input')?.addEventListener('input', function() { _autoGrowTextarea(this, 2, 10); });
// 送信後のリセットにも対応するため、teamSend/chatSend内で呼ぶよう修正

async function showCreateRoomModal() {
  if (!_chatRequireSourceFolder()) return;
  // ダイアログなしで即座に「無題」ルームを作成（連番を自動付与）
  try {
    const existing = await apiFetch(_chatApiPath('/collab/rooms')).catch(() => []);
    const names = new Set((existing || []).map(r => r.name));
    let name = '無題';
    let i = 2;
    while (names.has(name)) { name = '無題' + i; i++; }
    const res = await apiPost(_chatApiPath('/collab/rooms'), _chatPostPayload({ name, type: 'general' }));
    await loadTeamRooms();
    const roomName = name;
    const roomPath = res?.path || roomName;
    showStatus('ルーム「' + roomName + '」を作成しました');
    await selectTeamRoom(roomPath);
    // 作成直後にリネームモードに入る
    setTimeout(() => {
      _beginTeamRoomTitleEdit(_teamRoomByPath(roomPath) || { path: roomPath, name: roomName, type: 'general' });
    }, 50);
  } catch (e) {
    showStatus('ルーム作成に失敗: ' + (e.message || ''), true);
  }
}

function openChat() {
  toggleRightPanelTab('chat');
}

function _chatNormalizeStoredPath(pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return '';
  if (!/^https?:/i.test(raw) && !raw.startsWith('/api/')) return raw;
  try {
    const parsed = new URL(raw, location.origin);
    const nextPath = parsed.searchParams.get('path');
    return nextPath || raw;
  } catch {
    const match = raw.match(/[?&]path=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : raw;
  }
}

function _chatGuessMimeType(pathOrName) {
  const lower = String(pathOrName || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  return 'image/png';
}

function _chatIsImagePath(pathOrName) {
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(String(pathOrName || ''));
}

function _chatContentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content.map(part => {
    if (!part || typeof part !== 'object') return '';
    if (part.type === 'text') return String(part.text || '');
    if (part.type === 'image') return `[画像: ${part.name || part.path || 'image'}]`;
    if (part.type === 'document') return `[PDF: ${part.name || part.path || 'document'}]`;
    return '';
  }).filter(Boolean).join('\n');
}

function _chatBuildImageContent(name, pathOrUrl) {
  const storedPath = _chatNormalizeStoredPath(pathOrUrl);
  const nextName = String(name || storedPath.split('/').pop() || 'image').trim() || 'image';
  return [
    { type: 'text', text: `画像を添付しました: ${nextName}` },
    { type: 'image', name: nextName, path: storedPath, mimeType: _chatGuessMimeType(storedPath || nextName) },
  ];
}

function _chatRenderStructuredMessage(div, content, isUser) {
  div.innerHTML = '';
  content.forEach(part => {
    if (!part || typeof part !== 'object') return;
    if (part.type === 'text') {
      const text = String(part.text || '').trim();
      if (!text) return;
      const textDiv = document.createElement('div');
      textDiv.style.cssText = 'white-space:pre-wrap;word-break:break-word;';
      textDiv.textContent = text;
      div.appendChild(textDiv);
      return;
    }
    if (part.type === 'image') {
      const storedPath = _chatNormalizeStoredPath(part.path || part.url || '');
      const imgUrl = storedPath ? (API_BASE + '/file-raw?path=' + encodeURIComponent(storedPath)) : String(part.url || '');
      const imgWrap = document.createElement('div');
      imgWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:4px;';
      if (part.name) {
        const caption = document.createElement('div');
        caption.style.cssText = `font-size:12px;display:flex;align-items:center;gap:4px;${isUser ? 'color:rgba(255,255,255,0.92);' : 'color:var(--fg2);'}`;
        caption.innerHTML = `${lucide('image', 14)} <span>${esc(String(part.name))}</span>`;
        imgWrap.appendChild(caption);
      }
      if (imgUrl) {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = String(part.name || storedPath || 'image');
        img.style.cssText = 'max-width:min(320px, 100%);max-height:220px;border-radius:8px;display:block;cursor:pointer;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.08);';
        img.addEventListener('click', () => {
          if (typeof openViewer === 'function') openViewer(imgUrl);
        });
        img.onerror = () => { img.style.display = 'none'; };
        imgWrap.appendChild(img);
      }
      div.appendChild(imgWrap);
      return;
    }
    if (part.type === 'document') {
      const storedPath = _chatNormalizeStoredPath(part.path || part.url || '');
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:6px;margin-top:4px;font-size:12px;${isUser ? 'color:rgba(255,255,255,0.92);' : 'color:var(--fg2);'}`;
      row.innerHTML = `${lucide('fileText', 14)} <span style="text-decoration:underline;cursor:pointer;">${esc(String(part.name || storedPath || 'PDF'))}</span>`;
      row.querySelector('span')?.addEventListener('click', () => {
        if (storedPath && typeof openViewer === 'function') openViewer(API_BASE + '/file-raw?path=' + encodeURIComponent(storedPath));
      });
      div.appendChild(row);
    }
  });
  if (!div.childNodes.length) {
    div.textContent = _chatContentToText(content);
  }
}

function _chatNormalizePath(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function _chatSourceFolderValue() {
  return String(_chatState.sourceFolder || '');
}

function _chatWorkspaceIdValue() {
  return String(_chatState.workspaceId || '');
}

function _chatRequireSourceFolder(message = 'フォルダツリーで対象フォルダまたはファイルを選択してください') {
  const sourceFolder = _chatSourceFolderValue();
  const workspaceId = _chatWorkspaceIdValue();
  if (workspaceId) return workspaceId;
  if (sourceFolder) return sourceFolder;
  if (typeof showStatus === 'function') showStatus(message, true);
  const targetBar = document.getElementById('chat-current-target-bar');
  if (targetBar) {
    try { targetBar.scrollIntoView({ block: 'nearest' }); } catch {}
  }
  return '';
}

function _chatSourceQuery() {
  const workspaceId = _chatWorkspaceIdValue();
  if (workspaceId) return 'workspace_id=' + encodeURIComponent(workspaceId);
  const sourceFolder = _chatSourceFolderValue();
  return sourceFolder ? 'source_folder=' + encodeURIComponent(sourceFolder) : '';
}

function _chatApiPath(path) {
  const sourceQuery = _chatSourceQuery();
  if (!sourceQuery) return path;
  return path + (path.includes('?') ? '&' : '?') + sourceQuery;
}

function _chatPostPayload(body = {}) {
  const workspaceId = _chatWorkspaceIdValue();
  if (workspaceId) {
    const hasWorkspace = Object.prototype.hasOwnProperty.call(body || {}, 'workspace_id');
    return { ...body, workspace_id: hasWorkspace ? body.workspace_id : workspaceId };
  }
  const hasSourceFolder = Object.prototype.hasOwnProperty.call(body || {}, 'source_folder');
  return { ...body, source_folder: hasSourceFolder ? body.source_folder : _chatSourceFolderValue() };
}

async function _chatClientApiKeysForRequest() {
  if (!window.MeldexLlmKeys?.getAll) return {};
  return await window.MeldexLlmKeys.getAll();
}

async function _chatKnowledgeAutomationForSave() {
  const manager = window.MeldexKnowledgeAutomationSettings;
  if (!manager?.load || !manager?.hasSaved?.()) return null;
  const settings = manager.load();
  return {
    ...settings,
    api_keys: typeof _chatClientApiKeysForRequest === 'function' ? await _chatClientApiKeysForRequest() : {},
  };
}

async function _chatProviderHasConfiguredKey(provider) {
  const status = await _chatProviderReadyStatus(provider);
  return !!status.configured;
}

function _chatProviderStatusConfigured(status) {
  return !!(status && (status.configured || status.ok));
}

function _chatProviderUnavailableSuffix(provider, status) {
  if (_chatProviderStatusConfigured(status)) return '';
  const message = String(status?.message || '');
  if (_chatIsCliProvider(provider)) {
    if (message.includes('コマンド')) return '（未検出）';
    if (message.includes('無効')) return '（無効）';
    if (message.includes('読み込め') || message.includes('確認')) return '（確認不可）';
    return '（未設定）';
  }
  if (_chatIsLocalLlmProvider(provider)) {
    if (message.includes('接続先')) return '（接続先確認）';
    if (message.includes('確認')) return '（確認不可）';
    return '（未設定）';
  }
  if (message.includes('確認')) return '（確認不可）';
  return '（APIキー未設定）';
}

function _chatApplyProviderOptionStatus(option, status) {
  if (!option) return;
  const provider = _chatProviderKey(option.value);
  if (!option.dataset.baseLabel) option.dataset.baseLabel = option.textContent.replace(/（(?:APIキー未設定|未設定|無効|未検出|確認不可|接続先確認)）$/, '');
  const configured = _chatProviderStatusConfigured(status);
  option.disabled = !configured;
  option.setAttribute('aria-disabled', configured ? 'false' : 'true');
  option.title = configured ? '' : (status?.message || '送信設定を確認してください。');
  option.textContent = option.dataset.baseLabel + _chatProviderUnavailableSuffix(provider, status);
}

async function _chatRefreshProviderAvailability(seedStatuses = {}) {
  const select = document.getElementById('chat-provider');
  if (!select) return;
  const refreshToken = Number(_chatState.providerAvailabilityRefreshToken || 0) + 1;
  _chatState.providerAvailabilityRefreshToken = refreshToken;
  const options = Array.from(select.options || []).filter(option => option.value);
  const statuses = {};
  await Promise.all(options.map(async option => {
    const provider = _chatProviderKey(option.value);
    statuses[provider] = seedStatuses[provider] || await _chatProviderReadyStatus(provider);
  }));
  if (refreshToken !== _chatState.providerAvailabilityRefreshToken) return;
  options.forEach(option => _chatApplyProviderOptionStatus(option, statuses[_chatProviderKey(option.value)]));
  const currentStatus = statuses[_chatProviderKey(select.value)];
  select.title = _chatProviderStatusConfigured(currentStatus) ? '' : (currentStatus?.message || '送信設定を確認してください。');
}

async function _chatProviderReadyStatus(provider) {
  const key = _chatProviderKey(provider);
  if (_chatIsCliProvider(key)) return _chatCliProviderReadyStatus(key);
  if (_chatIsLocalLlmProvider(key)) return _chatLocalLlmReadyStatus();
  try {
    if (await window.MeldexLlmKeys?.hasProvider?.(key)) return { configured: true, message: '' };
  } catch {}
  try {
    const cfg = await apiFetch('/chat/config');
    const configured = !!cfg?.providers?.[key]?.configured;
    return {
      configured,
      message: configured ? '' : 'APIキーが未設定です。設定ダイアログのLLMタブで、この端末用のAPIキーを保存してください。',
    };
  } catch {
    return {
      configured: false,
      message: 'APIキー設定を確認できませんでした。Meldexを再起動してからもう一度試してください。',
    };
  }
}

function _chatLocalLlmReadyStatus() {
  const baseUrl = typeof chatLocalLlmBaseUrl === 'function' ? chatLocalLlmBaseUrl() : '';
  try {
    const parsed = new URL(baseUrl);
    const host = String(parsed.hostname || '').toLowerCase();
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    if (!['http:', 'https:'].includes(parsed.protocol) || !localHosts.has(host)) {
      return {
        configured: false,
        message: 'ローカルLLMの接続先URLは localhost / 127.0.0.1 / ::1 のOpenAI互換サーバーにしてください。',
      };
    }
    return { configured: true, message: '' };
  } catch {
    return {
      configured: false,
      message: 'ローカルLLMの接続先URLを確認してください。',
    };
  }
}

async function _chatCliProviderReadyStatus(provider) {
  const key = _chatProviderKey(provider);
  const meta = CHAT_CLI_PROVIDERS[key] || { label: key || 'CLI', command: key || 'CLI' };
  try {
    const cfg = await apiFetch('/cli-chat/config', { silentError: true });
    if (cfg?.enabled === false) {
      return { configured: false, message: 'CLIチャット機能が無効です。設定 > LLM > CLIチャットで有効にしてください。' };
    }
    const item = cfg?.providers?.[key];
    if (!item) {
      return { configured: false, message: `${meta.label} のCLIチャット設定が見つかりません。設定 > LLM > CLIチャットで確認してください。` };
    }
    if (item.enabled === false) {
      return { configured: false, message: `${item.label || meta.label} はCLIチャット設定で無効です。` };
    }
    if (item.available === false) {
      const command = item.command || meta.command || key;
      return { configured: false, message: `${item.label || meta.label} のコマンドが見つかりません。${command} をインストールし、Meldexを起動した環境のPATHから実行できるようにしてください。` };
    }
    return { configured: true, message: '' };
  } catch {
    return { configured: false, message: 'CLIチャット設定を読み込めませんでした。Meldexを再起動してからもう一度試してください。' };
  }
}

async function _chatRefreshApiKeyState() {
  const sendBtn = document.getElementById('chat-send-btn');
  const provider = _chatProviderKey(_chatState.provider);
  const refreshToken = Number(_chatState.apiKeyRefreshToken || 0) + 1;
  _chatState.apiKeyRefreshToken = refreshToken;
