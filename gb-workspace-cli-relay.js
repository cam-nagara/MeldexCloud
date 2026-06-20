(function () {
  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const {
    NOT_HANDLED,
    _normalizeFolderPath,
    _joinPath,
    _requirePwaProvider,
    _directoryHandle,
    _readJsonSafe,
    _validateItemName,
  } = internals;

  const CHAT_DIR = '_chat';
  const REQUEST_DIR = '_chat/workspace-cli/requests';
  const PROVIDER_LABELS = {
    codex: 'Codex CLI',
    claude_code: 'Claude Code',
    gemini_cli: 'Gemini CLI',
  };
  const ADMIN_ROLES = new Set(['owner', 'admin']);

  function _jsonString(value) {
    return JSON.stringify(String(value == null ? '' : value));
  }

  function _currentUser(url, body) {
    const candidate = body?.from || url?.searchParams?.get('_user') || (typeof getUsername === 'function' ? getUsername() : '');
    return String(candidate || 'anonymous').trim() || 'anonymous';
  }

  function _isAdminRole(role) {
    return ADMIN_ROLES.has(String(role || '').trim().toLowerCase());
  }

  function _currentWorkspaceCliRole(sourceFolder) {
    try {
      if (typeof getMyRoleForPath === 'function') return String(getMyRoleForPath(sourceFolder || '') || '').trim().toLowerCase();
    } catch {}
    try {
      if (typeof _myTeamRole !== 'undefined') return String(_myTeamRole || '').trim().toLowerCase();
    } catch {}
    return '';
  }

  function _requestSourceFolder(url, body) {
    const raw = body?.source_folder || body?.sourceFolder || url?.searchParams?.get('source_folder') || '';
    const normalized = _normalizeFolderPath(raw);
    if (!normalized || normalized === '.') return '';
    if (normalized.split('/').filter(Boolean).some(part => part === '.' || part === '..')) throw new Error('source_folder が不正です');
    return normalized;
  }

  function _safeRoomSegment(value, fallback) {
    const raw = String(value || '').trim() || fallback || 'general';
    if (raw === '.' || raw === '..' || raw.startsWith('.')) throw new Error('不正なルームパスです');
    return _validateItemName(raw.replace(/[\\/:*?"<>|]/g, '_'), 'room name');
  }

  function _normalizeDmRoomName(name) {
    const parts = String(name || '').split('__').map(part => part.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ja'));
    if (parts.length !== 2) throw new Error('DMルーム名が不正です');
    return parts.join('__');
  }

  function _normalizeRoomPath(value) {
    const raw = _normalizeFolderPath(value || '');
    const parts = raw.split('/').filter(Boolean);
    if (!parts.length) return 'general';
    if (parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) {
      throw new Error('不正なルームパスです');
    }
    if (parts[0] === CHAT_DIR) parts.shift();
    if (!parts.length) return 'general';
    if (parts.length >= 2 && ['dm', 'group', 'file'].includes(parts[0])) {
      const prefix = parts[0];
      const safeParts = parts.slice(1).map(part => _safeRoomSegment(part, prefix));
      if (prefix === 'dm') return 'dm/' + _normalizeDmRoomName(safeParts.join('__'));
      if (prefix === 'group') return 'group/' + safeParts.join('__');
      return 'file/' + safeParts.join('/');
    }
    if (parts.length === 1 && ['llm', 'dm', 'group', 'file'].includes(parts[0])) throw new Error('予約済みのルーム名です');
    return _safeRoomSegment(parts.join('_'), 'general');
  }

  function _roomDir(roomPath, sourceFolder) {
    return _joinPath(sourceFolder, CHAT_DIR, _normalizeRoomPath(roomPath));
  }

  function _roomMembers(room) {
    return String(room || '').split('/').pop().split('__').map(part => part.trim()).filter(Boolean);
  }

  async function _groupMembers(provider, roomPath, sourceFolder) {
    const data = await _readJsonSafe(provider, _joinPath(_roomDir(roomPath, sourceFolder), '_members.json'), {});
    const members = Array.isArray(data?.members) ? data.members : [];
    return members.map(member => String(member || '').trim()).filter(Boolean);
  }

  async function _assertRoomAccess(provider, roomPath, user, sourceFolder) {
    const normalized = _normalizeRoomPath(roomPath);
    const parts = normalized.split('/').filter(Boolean);
    if (parts[0] === 'dm') {
      const members = _roomMembers(normalized);
      if (members.length !== 2 || !members.includes(user)) throw new Error('このDMにはアクセスできません');
    }
    if (parts[0] === 'group') {
      const members = await _groupMembers(provider, normalized, sourceFolder);
      if (!members.includes(user)) throw new Error('このグループにはアクセスできません');
    }
    return normalized;
  }

  function _messageMarkdown(roomPath, from, text, timestamp) {
    return [
      '---',
      'type: chat-message',
      'from: ' + _jsonString(from),
      'timestamp: ' + _jsonString(timestamp),
      'room: ' + _jsonString(roomPath),
      '---',
      '',
      String(text || ''),
    ].join('\n');
  }

  function _randomHex(size) {
    const bytes = new Uint8Array(size);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
    return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function _messageFileName(date) {
    const pad = value => String(value).padStart(2, '0');
    return date.getFullYear()
      + pad(date.getMonth() + 1)
      + pad(date.getDate())
      + '_'
      + pad(date.getHours())
      + pad(date.getMinutes())
      + pad(date.getSeconds())
      + '_' + _randomHex(4) + '.md';
  }

  function _requestId(date) {
    const pad = value => String(value).padStart(2, '0');
    return 'wcli_' + date.getUTCFullYear()
      + pad(date.getUTCMonth() + 1)
      + pad(date.getUTCDate())
      + pad(date.getUTCHours())
      + pad(date.getUTCMinutes())
      + pad(date.getUTCSeconds())
      + '_' + _randomHex(6);
  }

  async function _writeChatMessage(provider, sourceFolder, roomPath, from, text, now) {
    const roomDir = _roomDir(roomPath, sourceFolder);
    await _directoryHandle(provider, roomDir, true);
    const filePath = _joinPath(roomDir, _messageFileName(now));
    await provider.writeText(filePath, _messageMarkdown(roomPath, from, text, now.toISOString()));
  }

  handlers.push(async function _dropboxWorkspaceCliHandler({ method, body, url, pathname }) {
    if (!/^\/workspace-cli(\/|$)/.test(pathname)) return NOT_HANDLED;
    if (pathname !== '/workspace-cli/request' || method !== 'POST') {
      throw new Error('クラウドモードでは管理者PCの中継設定は変更できません');
    }
    const provider = await _requirePwaProvider('readwrite');
    const user = _currentUser(url, body || {});
    const sourceFolder = _requestSourceFolder(url, body || {});
    const roomPath = await _assertRoomAccess(provider, body?.room || 'general', user, sourceFolder);
    const text = String(body?.text || '').trim();
    if (!text) throw new Error('依頼内容を入力してください');
    const providerKey = String(body?.provider || 'codex').trim();
    if (!PROVIDER_LABELS[providerKey]) throw new Error('未対応のCLIです');
    const requesterRole = _currentWorkspaceCliRole(sourceFolder);
    const readOnly = !_isAdminRole(requesterRole);
    if (readOnly && providerKey !== 'codex') {
      throw new Error('管理者以外は読み取り専用で実行できるCodex CLIだけ利用できます');
    }
    const now = new Date();
    const requestId = _requestId(now);
    const requestPath = _joinPath(sourceFolder, REQUEST_DIR, requestId + '.json');
    await _directoryHandle(provider, _joinPath(sourceFolder, REQUEST_DIR), true);
    const payload = {
      type: 'workspace-cli-request',
      version: 1,
      id: requestId,
      status: 'pending',
      requested_at: now.toISOString(),
      workspace_id: String(body?.workspace_id || body?.workspaceId || ''),
      source_folder: sourceFolder,
      room: roomPath,
      provider: providerKey,
      provider_label: PROVIDER_LABELS[providerKey],
      from: user,
      requester_role: requesterRole || 'member',
      read_only: readOnly,
      text,
    };
    await provider.writeText(requestPath, JSON.stringify(payload, null, 2));
    await _writeChatMessage(
      provider,
      sourceFolder,
      roomPath,
      user,
      `CLIへ依頼しました（${PROVIDER_LABELS[providerKey]}）。\n管理者PCが起動中で、中継設定が有効な場合、このルームに返答されます。${readOnly ? '\n管理者以外の依頼は読み取り専用で処理されます。' : ''}\n\n${text}`,
      now,
    );
    return { ok: true, request_id: requestId, status: 'pending', room: roomPath };
  });
})();

(function () {
  const PROVIDERS = [
    { key: 'codex', label: 'Codex CLI' },
    { key: 'claude_code', label: 'Claude Code' },
    { key: 'gemini_cli', label: 'Gemini CLI' },
  ];
  const ADMIN_ROLES = new Set(['owner', 'admin']);

  function _htmlEsc(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function _isAdminRole(role) {
    return ADMIN_ROLES.has(String(role || '').trim().toLowerCase());
  }

  function _chatSourceFolderForRole() {
    try {
      if (typeof _chatSourceFolderValue === 'function') return _chatSourceFolderValue() || '';
    } catch {}
    return '';
  }

  function _currentWorkspaceCliRole() {
    const sourceFolder = _chatSourceFolderForRole();
    try {
      if (typeof getMyRoleForPath === 'function') return String(getMyRoleForPath(sourceFolder || '') || '').trim().toLowerCase();
    } catch {}
    try {
      if (typeof _myTeamRole !== 'undefined') return String(_myTeamRole || '').trim().toLowerCase();
    } catch {}
    return '';
  }

  function _providersForCurrentRole() {
    return _isAdminRole(_currentWorkspaceCliRole()) ? PROVIDERS : PROVIDERS.filter(provider => provider.key === 'codex');
  }

  function _teamInputPayload() {
    const input = document.getElementById('team-input');
    const text = String(input?.value || '').trim();
    const atts = Array.isArray(window._teamPendingAttachments) ? window._teamPendingAttachments : (typeof _teamPendingAttachments !== 'undefined' ? _teamPendingAttachments : []);
    if (!text && atts.length === 0) return { text: '', originalText: text, attachments: [] };
    let finalText = text;
    if (atts.length > 0) {
      const imageLines = atts.map(att => {
        const alt = typeof _teamMarkdownImageAlt === 'function'
          ? _teamMarkdownImageAlt(att.name)
          : String(att.name || 'image').replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
        return `![${alt}](/api/file-raw?path=${encodeURIComponent(att.path)})`;
      }).join('\n');
      finalText = text ? text + '\n' + imageLines : imageLines;
    }
    return { text: finalText, originalText: text, attachments: atts.slice() };
  }

  function _button() {
    return document.getElementById('team-workspace-cli-btn')
      || document.querySelector('[data-action="openWorkspaceCliRelayMenu(event)"]');
  }

  async function _sendWorkspaceCliRelayRequest(providerKey) {
    if (typeof _chatRequireSourceFolder === 'function' && !_chatRequireSourceFolder()) return false;
    if (!window._teamCurrentRoom && typeof _teamCurrentRoom === 'undefined') {
      if (typeof showStatus === 'function') showStatus('ルームを選択してください', true);
      return false;
    }
    const roomPath = typeof _teamCurrentRoom !== 'undefined' ? _teamCurrentRoom : window._teamCurrentRoom;
    if (!roomPath) {
      if (typeof showStatus === 'function') showStatus('ルームを選択してください', true);
      return false;
    }
    const input = document.getElementById('team-input');
    const payload = _teamInputPayload();
    if (!payload.text) {
      if (typeof showStatus === 'function') showStatus('依頼内容を入力してください', true);
      return false;
    }
    const sendBtn = _button();
    const inputWasDisabled = !!input?.disabled;
    const sendWasDisabled = !!sendBtn?.disabled;
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    try {
      if (typeof _chatWithDraftUploadCleanupPaused === 'function') {
        _chatWithDraftUploadCleanupPaused(() => { if (input) input.value = ''; });
      } else if (input) {
        input.value = '';
      }
      if (typeof _teamPendingAttachments !== 'undefined') _teamPendingAttachments = [];
      if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 8);
      if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
      const bodyBase = {
        room: roomPath,
        provider: providerKey,
        text: payload.text,
        from: typeof getUsername === 'function' ? getUsername() : 'anonymous',
      };
      const requesterRole = _currentWorkspaceCliRole();
      bodyBase.requester_role = requesterRole || 'member';
      bodyBase.read_only = !_isAdminRole(requesterRole);
      if (bodyBase.read_only && providerKey !== 'codex') {
        throw new Error('管理者以外は読み取り専用で実行できるCodex CLIだけ利用できます');
      }
      if (typeof _chatSourceFolderValue === 'function') {
        const sourceFolder = _chatSourceFolderValue();
        if (sourceFolder) bodyBase.source_folder = sourceFolder;
      }
      const body = typeof _chatPostPayload === 'function' ? _chatPostPayload(bodyBase) : bodyBase;
      const path = typeof _chatApiPath === 'function' ? _chatApiPath('/workspace-cli/request') : '/workspace-cli/request';
      await apiPost(path, body);
      if (typeof _chatCommitDraftUploadsForText === 'function') _chatCommitDraftUploadsForText('team-input', payload.originalText);
      if (typeof pollTeamMessages === 'function') await pollTeamMessages();
      if (typeof showStatus === 'function') showStatus('CLIへ依頼しました');
      return true;
    } catch (e) {
      if (input) {
        input.value = payload.originalText;
        if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 8);
      }
      if (typeof _teamPendingAttachments !== 'undefined') _teamPendingAttachments = payload.attachments;
      if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
      if (typeof showStatus === 'function') showStatus('CLIへの依頼に失敗しました: ' + (e?.message || e), true);
      return false;
    } finally {
      if (input?.isConnected) input.disabled = inputWasDisabled;
      if (sendBtn?.isConnected) sendBtn.disabled = sendWasDisabled;
    }
  }

  function openWorkspaceCliRelayMenu(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (typeof _chatRequireSourceFolder === 'function' && !_chatRequireSourceFolder()) return;
    const payload = _teamInputPayload();
    if (!payload.text) {
      if (typeof showStatus === 'function') showStatus('依頼内容を入力してください', true);
      return;
    }
    document.querySelectorAll('.gb-context-menu.workspace-cli-relay-menu').forEach(el => el.remove());
    const menu = document.createElement('div');
    menu.className = 'gb-context-menu workspace-cli-relay-menu';
    menu.style.cssText = 'min-width:230px;max-width:min(320px,calc(100vw - 16px));padding:6px;';
    const desc = document.createElement('div');
    desc.className = 'gb-section-desc';
    desc.style.cssText = 'padding:6px 8px 8px;font-size:12px;line-height:1.45;';
    const requesterRole = _currentWorkspaceCliRole();
    const isAdmin = _isAdminRole(requesterRole);
    desc.textContent = isAdmin
      ? '管理者PCが起動中で中継設定が有効な時だけ返答されます。'
      : '管理者以外の依頼はCodex CLIで読み取り専用として処理されます。';
    menu.appendChild(desc);
    _providersForCurrentRole().forEach(provider => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'gb-context-menu-item';
      item.style.cssText = 'width:100%;display:flex;align-items:center;gap:8px;';
      item.innerHTML = _icon('terminal', 14) + '<span>' + _htmlEsc(provider.label) + 'に依頼</span>';
      item.addEventListener('click', async () => {
        menu.remove();
        await _sendWorkspaceCliRelayRequest(provider.key);
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    const rect = event?.currentTarget?.getBoundingClientRect?.() || event?.target?.getBoundingClientRect?.();
    const zoom = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = ((rect ? rect.left : (event?.clientX || 24)) / zoom) + 'px';
    menu.style.top = ((rect ? rect.bottom + 4 : (event?.clientY || 24)) / zoom) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
    setTimeout(() => {
      const closer = (ev) => {
        if (!menu.contains(ev.target)) {
          menu.remove();
          document.removeEventListener('pointerdown', closer);
        }
      };
      document.addEventListener('pointerdown', closer);
    }, 0);
  }

  function _workspaceRows(config) {
    const rows = Array.isArray(config?.workspaces) ? config.workspaces : [];
    if (!rows.length) return '<div class="gb-section-desc">登録済みワークスペースがありません。</div>';
    const enabledIds = Array.isArray(config?.enabled_workspace_ids) ? config.enabled_workspace_ids : [];
    const allEnabled = enabledIds.length === 0;
    return rows.map(item => {
      const checked = allEnabled || item.enabled ? 'checked' : '';
      return `<label class="gb-check" style="display:flex;margin-top:6px;min-width:0;">
        <input type="checkbox" data-workspace-cli-workspace="${_htmlEsc(item.id)}" ${checked}>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_htmlEsc(item.folder || '')}">${_htmlEsc(item.name || item.id)}</span>
      </label>`;
    }).join('');
  }

  function _renderRelaySettings(container, config) {
    if (!container) return;
    container.innerHTML = `
      <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px;">
        <label class="gb-check">
          <input id="settings-workspace-cli-enabled" type="checkbox" ${config?.enabled ? 'checked' : ''}>
          <span>ワークスペースチャットから管理者PCのCLIへ依頼できるようにする</span>
        </label>
        <div class="gb-section-desc" style="margin-top:6px;">このPCが起動中の時だけ、共有ワークスペース内のCLI依頼を処理します。</div>
        <div style="display:grid;grid-template-columns:minmax(120px,1fr) 90px;gap:8px;margin-top:8px;">
          <input id="settings-workspace-cli-node-name" class="gb-input" value="${_htmlEsc(config?.node_name || '')}" placeholder="このPCの表示名">
          <input id="settings-workspace-cli-poll-interval" class="gb-input" type="number" min="2" max="3600" value="${Number(config?.poll_interval_seconds || 5)}" title="確認間隔（秒）">
        </div>
        <label class="gb-check" style="margin-top:8px;">
          <input id="settings-workspace-cli-all-workspaces" type="checkbox" ${(config?.enabled_workspace_ids || []).length ? '' : 'checked'}>
          <span>登録済みワークスペースすべてを対象にする</span>
        </label>
        <div id="settings-workspace-cli-workspaces" style="margin-top:4px;max-height:120px;overflow:auto;">${_workspaceRows(config)}</div>
        <div class="btn-row" style="justify-content:flex-start;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <button type="button" class="gb-btn gb-btn-sm" id="settings-workspace-cli-refresh">${_icon('refreshCw',14)} 状態を更新</button>
          <button type="button" class="gb-btn gb-btn-sm" id="settings-workspace-cli-save">${_icon('save',14)} 中継設定を保存</button>
        </div>
        <div id="settings-workspace-cli-status" class="gb-section-desc" style="margin-top:6px;"></div>
      </div>
    `;
    container.querySelector('#settings-workspace-cli-refresh')?.addEventListener('click', () => renderWorkspaceCliRelaySettingsForSettings(container.closest('.modal-overlay') || document));
    container.querySelector('#settings-workspace-cli-save')?.addEventListener('click', () => saveWorkspaceCliRelaySettingsFromSettingsDialog(container.closest('.modal-overlay') || document));
    container.querySelector('#settings-workspace-cli-all-workspaces')?.addEventListener('change', (event) => {
      const disabled = !!event.target.checked;
      container.querySelectorAll('[data-workspace-cli-workspace]').forEach(cb => { cb.disabled = disabled; });
    });
    const allCb = container.querySelector('#settings-workspace-cli-all-workspaces');
    if (allCb?.checked) container.querySelectorAll('[data-workspace-cli-workspace]').forEach(cb => { cb.disabled = true; });
    if (typeof replaceIcons === 'function') replaceIcons(container);
  }

  async function renderWorkspaceCliRelaySettingsForSettings(root) {
    const scope = root?.querySelector ? root : document;
    const container = scope.querySelector('#settings-workspace-cli-relay-container') || document.getElementById('settings-workspace-cli-relay-container');
    if (!container) return;
    container.innerHTML = '<div class="gb-section-desc">中継設定を読み込み中...</div>';
    try {
      const config = await apiFetch('/workspace-cli/config', { silentError: true });
      _renderRelaySettings(container, config);
    } catch (e) {
      container.innerHTML = '<div class="gb-section-desc">中継設定はデスクトップ版の管理者PCで変更できます。</div>';
    }
  }

  async function saveWorkspaceCliRelaySettingsFromSettingsDialog(root, options = {}) {
    const scope = root?.querySelector ? root : document;
    const container = scope.querySelector('#settings-workspace-cli-relay-container') || document.getElementById('settings-workspace-cli-relay-container');
    if (!container || !container.querySelector('#settings-workspace-cli-enabled')) return true;
    const status = container.querySelector('#settings-workspace-cli-status');
    const allWorkspaces = container.querySelector('#settings-workspace-cli-all-workspaces')?.checked !== false;
    const enabledWorkspaceIds = allWorkspaces
      ? []
      : Array.from(container.querySelectorAll('[data-workspace-cli-workspace]'))
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.workspaceCliWorkspace)
        .filter(Boolean);
    const body = {
      enabled: container.querySelector('#settings-workspace-cli-enabled')?.checked === true,
      node_name: container.querySelector('#settings-workspace-cli-node-name')?.value?.trim() || '',
      poll_interval_seconds: Number(container.querySelector('#settings-workspace-cli-poll-interval')?.value || 5) || 5,
      enabled_workspace_ids: enabledWorkspaceIds,
    };
    try {
      if (status) {
        status.textContent = '保存中...';
        status.style.color = 'var(--fg2)';
      }
      await apiPut('/workspace-cli/config', body);
      if (status) {
        status.textContent = '保存しました。このPCが起動中の時に依頼を処理します。';
        status.style.color = 'var(--fg2)';
      }
      if (!options.skipReload) await renderWorkspaceCliRelaySettingsForSettings(container.closest('.modal-overlay') || document);
      if (!options.silent && typeof showStatus === 'function') showStatus('中継設定を保存しました');
      return true;
    } catch (e) {
      if (status) {
        status.textContent = '保存に失敗しました: ' + (e?.message || e);
        status.style.color = 'var(--red)';
      }
      if (!options.silent && typeof showStatus === 'function') showStatus('中継設定の保存に失敗しました', true);
      return false;
    }
  }

  window.openWorkspaceCliRelayMenu = openWorkspaceCliRelayMenu;
  window.sendWorkspaceCliRelayRequest = _sendWorkspaceCliRelayRequest;
  window.renderWorkspaceCliRelaySettingsForSettings = renderWorkspaceCliRelaySettingsForSettings;
  window.saveWorkspaceCliRelaySettingsFromSettingsDialog = saveWorkspaceCliRelaySettingsFromSettingsDialog;
})();
