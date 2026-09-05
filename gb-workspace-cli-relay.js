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
    _listDirectoryEntries,
    _readJsonSafe,
    _validateItemName,
  } = internals;

  const CHAT_DIR = '_chat';
  const REQUEST_DIR = '_chat/workspace-cli/requests';
  const PRESENCE_DIR = '_chat/workspace-cli/presence';
  const PROVIDER_LABELS = {
    codex: 'Codex CLI',
    claude_code: 'Claude Code',
    antigravity_cli: 'Antigravity CLI',
  };
  const ADMIN_ROLES = new Set(['owner', 'admin']);
  // Phase 2: サーバー側(meldex_workspace_cli_service.presence_is_online)と同じ稼働判定式。
  const PRESENCE_MIN_INTERVAL_SECONDS = 60;
  const PRESENCE_MAX_INTERVAL_SECONDS = 600;
  const PRESENCE_DEFAULT_INTERVAL_SECONDS = 120;
  const PRESENCE_STALE_GRACE_SECONDS = 60;

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

  function _canonicalSigningValue(value) {
    if (Array.isArray(value)) return value.map(_canonicalSigningValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = _canonicalSigningValue(value[key]);
      return result;
    }, {});
  }

  function _base64Url(bytes) {
    let binary = '';
    new Uint8Array(bytes).forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function _base64UrlBytes(value) {
    const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(raw + '='.repeat((4 - raw.length % 4) % 4));
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  function _unsignedSigningPayload(payload) {
    const copy = { ...(payload || {}) };
    delete copy.signature;
    delete copy.signature_scheme;
    return copy;
  }

  async function _sha256KeyId(publicBytes) {
    const digest = await crypto.subtle.digest('SHA-256', publicBytes);
    return 'ed25519:' + Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function _generateSigningKey() {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    const publicBytes = await crypto.subtle.exportKey('raw', pair.publicKey);
    return { privateKey: pair.privateKey, publicKey: pair.publicKey, public_key: _base64Url(publicBytes), key_id: await _sha256KeyId(publicBytes) };
  }

  async function _signV2Payload(payload, privateKey, expectedKeyId) {
    if (!payload || payload.type !== 'workspace-cli-request' || payload.version !== 2) {
      throw new Error('旧形式または不正なrequestは署名できません');
    }
    if (!privateKey || privateKey.type !== 'private' || privateKey.extractable) {
      throw new Error('端末ローカルの非export鍵が必要です');
    }
    const unsigned = { ..._unsignedSigningPayload(payload), key_id: String(expectedKeyId || '') };
    if (!/^ed25519:[a-f0-9]{64}$/.test(unsigned.key_id)) throw new Error('端末公開鍵IDが不正です');
    const bytes = new TextEncoder().encode(JSON.stringify(_canonicalSigningValue(unsigned)));
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, bytes);
    return { ...unsigned, signature_scheme: 'ed25519-v1', signature: _base64Url(signature) };
  }

  async function _signEnrollmentPayload(payload, keyPair) {
    if (!payload || payload.type !== 'workspace-cli-enrollment-request' || payload.version !== 1) {
      throw new Error('端末登録申請の形式が不正です');
    }
    if (!keyPair?.privateKey || keyPair.privateKey.extractable || keyPair.key_id !== payload.key_id
      || keyPair.public_key !== payload.public_key) {
      throw new Error('端末登録申請と端末ローカル鍵が一致しません');
    }
    const unsigned = _unsignedSigningPayload(payload);
    const bytes = new TextEncoder().encode(JSON.stringify(_canonicalSigningValue(unsigned)));
    const signature = await crypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, bytes);
    return { ...unsigned, signature_scheme: 'ed25519-v1', signature: _base64Url(signature) };
  }

  async function _verifyOwnerPin(pin, expectedWorkspaceId, pinnedKeyId) {
    if (!pin || pin.type !== 'workspace-cli-owner-pin' || pin.version !== 1
      || pin.workspace_id !== expectedWorkspaceId || pin.signature_scheme !== 'ed25519-v1') return false;
    const publicBytes = _base64UrlBytes(pin.public_key);
    const keyId = await _sha256KeyId(publicBytes);
    if (keyId !== pin.key_id || (pinnedKeyId && keyId !== pinnedKeyId)) return false;
    const publicKey = await crypto.subtle.importKey('raw', publicBytes, { name: 'Ed25519' }, false, ['verify']);
    const bytes = new TextEncoder().encode(JSON.stringify(_canonicalSigningValue(_unsignedSigningPayload(pin))));
    return crypto.subtle.verify({ name: 'Ed25519' }, publicKey, _base64UrlBytes(pin.signature), bytes);
  }

  async function _verifySignedValue(value, publicKeyValue) {
    if (!value || value.signature_scheme !== 'ed25519-v1') return false;
    const publicKey = await crypto.subtle.importKey(
      'raw', _base64UrlBytes(publicKeyValue), { name: 'Ed25519' }, false, ['verify'],
    );
    const bytes = new TextEncoder().encode(JSON.stringify(_canonicalSigningValue(_unsignedSigningPayload(value))));
    return crypto.subtle.verify({ name: 'Ed25519' }, publicKey, _base64UrlBytes(value.signature), bytes);
  }

  async function _sha256Hex(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function _validateSignedRequestV2(request, ledger, ownerPin, expectedWorkspaceId, pinnedOwnerKeyId) {
    if (!await _verifyOwnerPin(ownerPin, expectedWorkspaceId, pinnedOwnerKeyId)) throw new Error('所有者公開鍵pinが一致しません');
    if (!ledger || ledger.type !== 'workspace-cli-key-ledger' || ledger.version !== 1
      || ledger.workspace_id !== expectedWorkspaceId || ledger.owner_key_id !== ownerPin.key_id
      || !await _verifySignedValue(ledger, ownerPin.public_key)) throw new Error('所有者署名済み端末台帳が不正です');
    if (!request || request.type !== 'workspace-cli-request' || request.version !== 2
      || request.workspace_id !== expectedWorkspaceId || request.responder_policy_version !== 'answer-only-v2'
      || request.read_only !== true || String(request.source_folder || '') !== '') {
      throw new Error('旧形式・ローカルpath付き・answer-onlyでない依頼は利用できません');
    }
    if (['path', 'relative_path', 'attachment_path'].some(key => Object.prototype.hasOwnProperty.call(request, key))) {
      throw new Error('添付pathの直接指定は利用できません');
    }
    const entries = Array.isArray(ledger.keys) ? ledger.keys : [];
    const device = entries.find(item => item?.key_id === request.key_id && item?.kind === 'device' && !item?.revoked_at);
    if (!device || device.user_id !== request.user_id || device.device_id !== request.device_id
      || !await _verifySignedValue(request, device.public_key)) throw new Error('未登録・失効・改ざんされた端末依頼です');
    if (device.admin_cli_chat_allowed !== true) throw new Error('このユーザーには管理者PCのCLI返答が許可されていません');
    const node = entries.find(item => item?.kind === 'node' && item?.node_id === request.target_node_id && !item?.revoked_at);
    if (!node) throw new Error('未登録または失効済みの管理者PCです');
    const issued = Date.parse(request.issued_at || '');
    const expires = Date.parse(request.expires_at || '');
    const now = Date.now();
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now + 60000 || expires <= now
      || expires <= issued || expires - issued > 30 * 60 * 1000) throw new Error('依頼の時刻または期限が不正です');
    if (!request.text || await _sha256Hex(request.text) !== request.text_sha256) throw new Error('依頼本文が改ざんされています');
    if (!Array.isArray(request.attachments_manifest)
      || await _sha256Hex(new TextEncoder().encode(JSON.stringify(_canonicalSigningValue(request.attachments_manifest)))) !== request.attachments_manifest_sha256
      || request.attachments_manifest.some(item => !item || 'relative_path' in item || 'path' in item)) {
      throw new Error('添付manifestが改ざんされています');
    }
    if (!request.context_snapshot || request.context_snapshot.sha256 !== request.context_snapshot_sha256) {
      throw new Error('回答用文脈snapshotが不正です');
    }
    return true;
  }

  // Phase 4A protocol adapter only. UIや自動enrollmentはPhase 4Bまで追加しない。
  // privateKeyは非export CryptoKeyのまま端末ローカルで扱い、共有フォルダへは公開鍵だけを出す。
  window.__MeldexWorkspaceCliSigningProtocol = Object.freeze({
    canonicalize: value => JSON.stringify(_canonicalSigningValue(value)),
    generateSigningKey: _generateSigningKey,
    signEnrollmentRequest: _signEnrollmentPayload,
    signRequestV2: _signV2Payload,
    verifyOwnerPin: _verifyOwnerPin,
    validateSignedRequestV2: _validateSignedRequestV2,
  });

  async function _writeChatMessage(provider, sourceFolder, roomPath, from, text, now) {
    const roomDir = _roomDir(roomPath, sourceFolder);
    await _directoryHandle(provider, roomDir, true);
    const filePath = _joinPath(roomDir, _messageFileName(now));
    await provider.writeText(filePath, _messageMarkdown(roomPath, from, text, now.toISOString()));
  }

  function _presenceHeartbeatInterval(node) {
    const raw = Number(node?.heartbeat_interval_seconds);
    const interval = Number.isFinite(raw) ? raw : PRESENCE_DEFAULT_INTERVAL_SECONDS;
    return Math.max(PRESENCE_MIN_INTERVAL_SECONDS, Math.min(interval, PRESENCE_MAX_INTERVAL_SECONDS));
  }

  function _presenceIsOnline(node, nowMs) {
    const raw = String(node?.updated_at || '').trim();
    if (!raw) return false;
    const updatedMs = Date.parse(raw);
    if (Number.isNaN(updatedMs)) return false;
    const thresholdMs = (_presenceHeartbeatInterval(node) * 3 + PRESENCE_STALE_GRACE_SECONDS) * 1000;
    const ageMs = nowMs - updatedMs;
    if (ageMs < -PRESENCE_STALE_GRACE_SECONDS * 1000) return false;
    return ageMs <= thresholdMs;
  }

  // Phase 2: Cloud直結ではowner鍵pin/端末承認UIがまだ無いため、共有presenceを信用しない。
  // 署名らしいフィールドの存在確認だけでは偽装を防げないので、Phase 4の明示登録まで常に停止中を返す。
  async function _dropboxWorkspaceCliPresence(url) {
    return {
      online: false,
      node_name: '',
      updated_at: '',
      stale_after_seconds: PRESENCE_DEFAULT_INTERVAL_SECONDS * 3 + PRESENCE_STALE_GRACE_SECONDS,
      nodes: [],
      unavailable_reason: 'device-signing-not-enrolled',
    };
  }

  handlers.push(async function _dropboxWorkspaceCliHandler({ method, body, url, pathname }) {
    if (!/^\/workspace-cli(\/|$)/.test(pathname)) return NOT_HANDLED;
    if (pathname === '/workspace-cli/presence' && method === 'GET') {
      return _dropboxWorkspaceCliPresence(url);
    }
    if (pathname === '/workspace-cli/request' && method === 'POST') {
      throw new Error('旧外部中継入口は廃止されました。端末署名済みv2入口を使用してください');
    }
    if (pathname !== '/workspace-cli/request-v2/accept' || method !== 'POST') {
      throw new Error('クラウドモードでは管理者PCの中継設定は変更できません');
    }
    const request = body?.signed_request;
    if (!request) throw new Error('この端末は管理者AIへの依頼用にまだ登録されていません');
    const provider = await _requirePwaProvider('readwrite');
    const sourceFolder = _requestSourceFolder(url, request);
    const workspaceId = String(request.workspace_id || '').trim();
    if (!workspaceId) throw new Error('署名依頼のworkspace IDがありません');
    const pinPath = _joinPath(sourceFolder, '_chat/workspace-cli/security/owner-pin.json');
    const ledgerPath = _joinPath(sourceFolder, '_chat/workspace-cli/security/key-ledger.json');
    const ownerPin = await _readJsonSafe(provider, pinPath, null);
    const ledger = await _readJsonSafe(provider, ledgerPath, null);
    const workspaceMeta = await _readJsonSafe(provider, _joinPath(sourceFolder, '_Meldex_workspace.json'), null);
    const storageKey = 'meldex-workspace-cli-owner-pin:' + workspaceId;
    const pinnedOwnerKeyId = String(localStorage.getItem(storageKey) || '');
    if (!pinnedOwnerKeyId) throw new Error('このワークスペースの所有者公開鍵を確認していません');
    await _validateSignedRequestV2(request, ledger, ownerPin, workspaceId, pinnedOwnerKeyId);
    const user = _currentUser(url, {});
    if (user !== request.user_id) throw new Error('ログイン利用者と署名端末の利用者が一致しません');
    const member = Array.isArray(workspaceMeta?.members)
      ? workspaceMeta.members.find(item => item && String(item.name || item.user || '').trim() === user)
      : null;
    if (workspaceMeta?.id !== workspaceId || member?.adminCliChatAllowed !== true) {
      throw new Error('このユーザーには管理者PCのCLI返答が許可されていません');
    }
    const roomPath = await _assertRoomAccess(provider, request.room, user, sourceFolder);
    if (roomPath !== request.room) throw new Error('署名依頼のルームが一致しません');
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(request.id)) throw new Error('署名依頼IDが不正です');
    const requestPath = _joinPath(sourceFolder, REQUEST_DIR, request.id + '.json');
    if (await _readJsonSafe(provider, requestPath, null)) throw new Error('同じ署名依頼は既に存在します');
    await _directoryHandle(provider, _joinPath(sourceFolder, REQUEST_DIR), true);
    await provider.writeText(requestPath, JSON.stringify(request, null, 2));
    return { ok: true, request_id: request.id, attempt_id: request.attempt_id, status: 'queued', room: roomPath };
  });
})();

(function () {
  function _htmlEsc(value) {
    return MeldexEscape.html(value);
  }

  function _icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function _workspaceCliChatElement(event, id) {
    const actionTarget = event?.currentTarget instanceof Element
      ? event.currentTarget
      : (event?.target instanceof Element ? event.target.closest('[data-action]') : null);
    const chatRoot = actionTarget?.closest?.('[id="rp-chat"]');
    return chatRoot?.querySelector?.(`[id="${id}"]`) || document.getElementById(id);
  }

  function _teamInputPayload(input = document.getElementById('team-input')) {
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

  function _button(event) {
    return _workspaceCliChatElement(event, 'team-workspace-cli-btn')
      || document.querySelector('[data-action="sendWorkspaceCliRelayRequestClick(event)"]');
  }

  // Phase 4: 提供元選択メニューを廃止し、押すとそのまま依頼が飛ぶ。どのCLI/モデルを使うかは
  // 管理者が設定→AI→CLIチャット節の中継設定で選ぶ(既定 Codex CLI)。ここではproviderを
  // 送らず、サーバー側(非管理者は常にCodex CLI読み取り専用、管理者は中継設定の選択)に委ねる。
  async function _sendWorkspaceCliRelayRequest(event) {
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
    const input = _workspaceCliChatElement(event, 'team-input');
    const payload = _teamInputPayload(input);
    if (!payload.text) {
      if (typeof showStatus === 'function') showStatus('依頼内容を入力してください', true);
      return false;
    }
    const sendBtn = _button(event);
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
        text: payload.text,
        from: typeof getUsername === 'function' ? getUsername() : 'anonymous',
      };
      if (typeof _chatSourceFolderValue === 'function') {
        const sourceFolder = _chatSourceFolderValue();
        if (sourceFolder) bodyBase.source_folder = sourceFolder;
      }
      const body = typeof _chatPostPayload === 'function' ? _chatPostPayload(bodyBase) : bodyBase;
      const path = typeof _chatApiPath === 'function' ? _chatApiPath('/workspace-cli/request') : '/workspace-cli/request';
      await apiPost(path, body);
      if (typeof _chatCommitDraftUploadsForText === 'function') _chatCommitDraftUploadsForText('team-input', payload.originalText);
      if (typeof pollTeamMessages === 'function') await pollTeamMessages();
      if (typeof showStatus === 'function') showStatus('管理者AIへ依頼しました');
      _trackOwnCliRequestSubmission(roomPath);
      return true;
    } catch (e) {
      if (input) {
        input.value = payload.originalText;
        if (typeof _autoGrowTextarea === 'function') _autoGrowTextarea(input, 2, 8);
      }
      if (typeof _teamPendingAttachments !== 'undefined') _teamPendingAttachments = payload.attachments;
      if (typeof _renderTeamAttachments === 'function') _renderTeamAttachments();
      if (typeof showStatus === 'function') showStatus('管理者AIへの依頼に失敗しました: ' + (e?.message || e), true);
      return false;
    } finally {
      if (input?.isConnected) input.disabled = inputWasDisabled;
      if (sendBtn?.isConnected) sendBtn.disabled = sendWasDisabled;
    }
  }

  // Phase 4: 停止中に押しても送信自体は妨げない。事前に一言だけ知らせる(ブロックしない通知)。
  function _workspaceCliPresenceOfflineNotice() {
    const badge = document.getElementById('team-workspace-cli-presence');
    if (!badge || badge.style.display === 'none') return;
    if (!badge.classList.contains('is-offline')) return;
    if (typeof showStatus === 'function') {
      showStatus('管理者PCが停止中です。送信すると起動後に処理されます');
    }
  }

  function sendWorkspaceCliRelayRequestClick(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    _workspaceCliPresenceOfflineNotice();
    return _sendWorkspaceCliRelayRequest(event);
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

  const RELAY_PROVIDER_LABELS = { codex: 'Codex CLI', claude_code: 'Claude Code', antigravity_cli: 'Antigravity CLI' };

  function _relayProviderOptionsHtml(selected) {
    const current = String(selected || 'codex');
    return Object.entries(RELAY_PROVIDER_LABELS).map(([key, label]) => (
      `<option value="${_htmlEsc(key)}" ${key === current ? 'selected' : ''}>${_htmlEsc(label)}</option>`
    )).join('');
  }

  // Phase 6: 設定応答にはもともと稼働状態(status)が入っているが、これまで表示していなかった。
  function _formatRelayRuntimeStatusLine(status) {
    const running = !!status?.running;
    const lastScan = status?.last_scan_at ? _formatPresenceTime(status.last_scan_at) : '未実施';
    const processed = Number(status?.processed_count || 0);
    const lastError = String(status?.last_error || '').trim();
    const parts = [
      `現在: ${running ? '稼働中' : '停止中'}`,
      `最終確認 ${lastScan}`,
      `処理済み ${processed}件`,
    ];
    if (lastError) parts.push(`直近のエラー: ${lastError}`);
    return parts.join(' / ');
  }

  function _renderRelaySettings(container, config) {
    if (!container) return;
    container.innerHTML = `
      <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px;">
        <div class="gb-section-desc" data-e2e-id="settings-workspace-cli-privacy-notice" style="display:flex;align-items:center;gap:4px;margin-bottom:8px;">
          <span>DMと非公開ルームは共有フォルダに保存されます</span>
          ${fieldHelp('Meldexの画面では当事者以外に表示されませんが、共有フォルダを直接開ける人は読めます。DMの内容は、管理者AIが答えるための材料として使われることがあります。')}
        </div>
        <div class="gb-check-help-row">
          <label class="gb-check">
            <input id="settings-workspace-cli-enabled" type="checkbox" ${config?.enabled ? 'checked' : ''}>
            <span>ワークスペースチャットから管理者PCのCLIへ依頼できるようにする</span>
          </label>
          ${fieldHelp('このPCが起動中の時だけ、共有ワークスペース内のCLI依頼を処理します。')}
        </div>
        <div id="settings-workspace-cli-runtime-status" class="gb-section-desc" style="margin-top:6px;" data-e2e-id="settings-workspace-cli-runtime-status">${_htmlEsc(_formatRelayRuntimeStatusLine(config?.status))}</div>
        <div style="display:grid;grid-template-columns:minmax(120px,1fr) 90px;gap:8px;margin-top:8px;">
          <input id="settings-workspace-cli-node-name" class="gb-input" value="${_htmlEsc(config?.node_name || '')}" placeholder="このPCの表示名">
          <input id="settings-workspace-cli-poll-interval" class="gb-input" type="number" min="2" max="3600" value="${Number(config?.poll_interval_seconds || 5)}" title="確認間隔（秒）">
        </div>
        <div class="gb-check-help-row" style="margin-top:8px;">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;flex:1;min-width:0;">
            <span>管理者AIに依頼した時に使うCLI</span>
            <select id="settings-workspace-cli-provider" class="gb-input" data-e2e-id="settings-workspace-cli-provider">${_relayProviderOptionsHtml(config?.provider)}</select>
          </label>
          ${fieldHelp('メンバーの依頼は常にCodex CLIの読み取り専用で実行され、この選択は影響しません。')}
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
      provider: container.querySelector('#settings-workspace-cli-provider')?.value || 'codex',
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

  // Phase 3: ワークスペースタブの依頼ボタン隣に「管理者AI 稼働中/停止中」を出す。
  const PRESENCE_POLL_INTERVAL_MS = 60000;
  const PRESENCE_FAILURE_THRESHOLD = 2;
  let _presencePollTimer = null;
  let _presencePollInFlight = false;
  let _presenceConsecutiveFailures = 0;
  let _presenceClickHooked = false;

  function _presenceBadgeEl() {
    return document.getElementById('team-workspace-cli-presence');
  }

  function _presenceChatVisible() {
    // rp-chatは複数DOMに存在し得る(ペイン/ドックポップアップ等)ため、実際に見えているものだけを対象にする。
    const nodes = [...document.querySelectorAll('[id="rp-chat"]')].filter(el => !el.closest('[data-gb-snapshot="true"]'));
    return nodes.some((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
  }

  function _presenceCurrentTarget() {
    try {
      const workspaceId = typeof _chatWorkspaceIdValue === 'function' ? _chatWorkspaceIdValue() : '';
      if (workspaceId) return { kind: 'workspace_id', value: workspaceId };
    } catch {}
    try {
      const sourceFolder = typeof _chatSourceFolderValue === 'function' ? _chatSourceFolderValue() : '';
      if (sourceFolder) return { kind: 'source_folder', value: sourceFolder };
    } catch {}
    return null;
  }

  function _presenceShouldPoll() {
    if (typeof _chatMode !== 'undefined' && _chatMode !== 'team') return false;
    if (!_presenceChatVisible()) return false;
    return !!_presenceCurrentTarget();
  }

  function _formatPresenceTime(isoString) {
    const raw = String(isoString || '').trim();
    if (!raw) return '不明';
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return '不明';
    try {
      return new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '不明';
    }
  }

  // ============================================================
  // Phase E (2026-08-12 管理者AI使用量レポート計画): 何が記録されるかの開示。
  // 依頼のたびにルームへ同じ文言を投稿すると形骸化するため、ここでは
  // 「常時見える短い1文+ツールチップの詳細」を稼働バッジの隣に置き、
  // 初回だけ詳細を展開表示する(以後は短い1文+ツールチップに戻る)。
  // ============================================================
  const AI_USAGE_DISCLOSURE_SEEN_KEY = 'meldex-workspace-cli-ai-usage-disclosure-seen-v1';
  const AI_USAGE_DISCLOSURE_SHORT_TEXT = '管理者AIの利用は記録されます';
  const AI_USAGE_DISCLOSURE_DETAIL_TEXT = '依頼回数・使ったモデル・成否・所要時間が管理者に記録されます。依頼と返答の内容は、このルームの参加者が読めます。AIタブでのご自身のAI利用は記録されません。';

  function _disclosureSeenBefore() {
    try { return window.localStorage?.getItem(AI_USAGE_DISCLOSURE_SEEN_KEY) === '1'; } catch { return true; }
  }
  function _markDisclosureSeen() {
    try { window.localStorage?.setItem(AI_USAGE_DISCLOSURE_SEEN_KEY, '1'); } catch {}
  }

  function _disclosureLineEl() {
    return document.getElementById('team-workspace-cli-disclosure');
  }

  function _renderDisclosureLineContent(el) {
    if (!_disclosureSeenBefore()) {
      // 初回のみ: 詳細を展開して可視のまま表示する(ツールチップに隠さない)。
      el.style.cssText = 'align-items:center;gap:6px;font-size:11px;line-height:1.4;color:var(--fg2);'
        + 'white-space:normal;max-width:280px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg3);';
      el.innerHTML = `<span style="flex:1;min-width:0;">${_htmlEsc(AI_USAGE_DISCLOSURE_DETAIL_TEXT)}</span>`
        + `<button type="button" class="gb-btn gb-btn-sm" data-e2e-id="team-workspace-cli-disclosure-ack" style="flex-shrink:0;" aria-label="確認しました">${_icon('check', 12)}</button>`;
      el.querySelector('[data-e2e-id="team-workspace-cli-disclosure-ack"]')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        _markDisclosureSeen();
        _renderDisclosureLineContent(el);
      });
    } else {
      el.style.cssText = 'align-items:center;gap:4px;font-size:11px;color:var(--fg2);white-space:nowrap;';
      el.innerHTML = `<span>${_htmlEsc(AI_USAGE_DISCLOSURE_SHORT_TEXT)}</span>${typeof fieldHelp === 'function' ? fieldHelp(AI_USAGE_DISCLOSURE_DETAIL_TEXT) : ''}`;
    }
    if (typeof replaceIcons === 'function') replaceIcons(el);
  }

  function _ensureAiUsageDisclosureLine() {
    const existing = _disclosureLineEl();
    if (existing) return existing;
    const anchor = _presenceBadgeEl() || _button();
    if (!anchor?.parentNode) return null;
    const el = document.createElement('span');
    el.id = 'team-workspace-cli-disclosure';
    el.className = 'team-workspace-cli-disclosure';
    el.setAttribute('data-e2e-id', 'team-workspace-cli-disclosure');
    el.style.display = 'none';
    _renderDisclosureLineContent(el);
    anchor.insertAdjacentElement('afterend', el);
    return el;
  }

  function _updateAiUsageDisclosureVisibility(visible) {
    const el = _ensureAiUsageDisclosureLine();
    if (!el) return;
    el.style.display = visible ? 'inline-flex' : 'none';
  }

  // ============================================================
  // Phase C (2026-08-12 管理者AI使用量レポート計画): 自分の使用量だけを確認できる表示。
  // GET /api/workspace-cli/ai-usage/me は認証セッションのユーザーぶんしか返さない
  // (対象メンバーを指定するパラメータが無い)ため、ここでも他人の分は扱えない。
  // ============================================================
  let _myAiUsageSummary = null;
  let _aiUsagePopupEl = null;

  async function _fetchMyAiUsageSummary() {
    const target = _presenceCurrentTarget();
    if (!target) return null;
    const query = target.kind + '=' + encodeURIComponent(target.value);
    try {
      return await apiFetch('/workspace-cli/ai-usage/me?' + query, { silentError: true });
    } catch {
      return null;
    }
  }

  function _formatAiUsageTooltipLine(summary) {
    if (!summary) return '';
    const monthCount = Number(summary.month?.total_count || 0);
    return `今月のあなたの依頼 ${monthCount}件（クリックで内訳）`;
  }

  function _aiUsageModelRowsHtml(list) {
    const rows = Array.isArray(list) ? list : [];
    if (!rows.length) return '<div class="gb-section-desc">利用はありません</div>';
    return rows.map(item => `<div class="gb-section-desc">${_htmlEsc(item?.model || '不明')}: ${Number(item?.count || 0)}件</div>`).join('');
  }

  function _renderAiUsageBreakdownHtml(summary) {
    const today = summary?.today || { total_count: 0, failure_count: 0, by_model: [] };
    const month = summary?.month || { total_count: 0, failure_count: 0, by_model: [] };
    return `
      <div style="min-width:220px;max-width:280px;padding:10px;">
        <div style="font-weight:600;font-size:12px;margin-bottom:6px;">あなたの管理者AI利用状況</div>
        <div class="gb-section-desc">今日: ${Number(today.total_count || 0)}件${today.failure_count ? `（失敗 ${Number(today.failure_count)}件）` : ''}</div>
        <div class="gb-section-desc">今月: ${Number(month.total_count || 0)}件${month.failure_count ? `（失敗 ${Number(month.failure_count)}件）` : ''}</div>
        <div style="margin-top:6px;font-size:11px;color:var(--fg2);">モデル別（今月）</div>
        ${_aiUsageModelRowsHtml(month.by_model)}
        <div class="gb-section-desc" style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px;">
          この内容は個人メッセージと同程度の扱いです。共有フォルダを直接開ける人には見える場合があります。
        </div>
      </div>
    `;
  }

  function _closeAiUsageBreakdownPopup() {
    if (_aiUsagePopupEl?.isConnected) _aiUsagePopupEl.remove();
    _aiUsagePopupEl = null;
  }

  async function _toggleAiUsageBreakdownPopup(anchorEl) {
    if (_aiUsagePopupEl?.isConnected) {
      _closeAiUsageBreakdownPopup();
      return;
    }
    const popup = document.createElement('div');
    popup.className = 'gb-context-menu team-workspace-cli-ai-usage-popup';
    popup.setAttribute('data-e2e-id', 'team-workspace-cli-ai-usage-popup');
    popup.style.cssText = 'position:fixed;z-index:10000;';
    popup.innerHTML = _renderAiUsageBreakdownHtml(_myAiUsageSummary);
    if (typeof window.attachMeldexDropdownCloseButton === 'function') {
      window.attachMeldexDropdownCloseButton(popup, { trigger: anchorEl, close: _closeAiUsageBreakdownPopup });
    }
    document.body.appendChild(popup);
    if (typeof positionPopup === 'function') positionPopup(popup, anchorEl.getBoundingClientRect(), { prefer: 'below' });
    _aiUsagePopupEl = popup;
    // 開いた瞬間はキャッシュ値で表示し、裏で最新値を取り直して古いまま放置しない。
    const fresh = await _fetchMyAiUsageSummary();
    if (fresh) {
      _myAiUsageSummary = fresh;
      if (_aiUsagePopupEl?.isConnected) {
        const closeRow = _aiUsagePopupEl.querySelector('.meldex-dropdown-close-row');
        _aiUsagePopupEl.innerHTML = _renderAiUsageBreakdownHtml(fresh);
        if (closeRow) _aiUsagePopupEl.appendChild(closeRow);
      }
    }
  }

  function _renderWorkspaceCliPresenceBadge(state) {
    const el = _presenceBadgeEl();
    if (!el) return;
    _updateAiUsageDisclosureVisibility(!!state);
    if (!state) {
      el.style.display = 'none';
      el.classList.remove('is-online', 'is-offline');
      el.removeAttribute('title');
      return;
    }
    el.style.display = 'inline-flex';
    el.setAttribute('aria-haspopup', 'dialog');
    el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    const label = el.querySelector('.team-workspace-cli-presence-label');
    const usageLine = _formatAiUsageTooltipLine(_myAiUsageSummary);
    if (state.online) {
      el.classList.add('is-online');
      el.classList.remove('is-offline');
      if (label) label.textContent = '管理者AI 稼働中';
      const nodeName = state.node_name || '不明';
      el.title = `管理者PC（${nodeName}）が応答できます。最終確認 ${_formatPresenceTime(state.updated_at)}` + (usageLine ? `\n${usageLine}` : '');
      el.setAttribute('aria-label', '管理者AI 稼働中。' + el.title);
    } else {
      el.classList.add('is-offline');
      el.classList.remove('is-online');
      if (label) label.textContent = '管理者AI 停止中';
      el.title = '管理者PCのMeldexが起動していないか、管理者AIの受付がオフです' + (usageLine ? `\n${usageLine}` : '');
      el.setAttribute('aria-label', '管理者AI 停止中。' + el.title);
    }
  }

  async function _fetchWorkspaceCliPresenceSnapshot() {
    const target = _presenceCurrentTarget();
    if (!target) return null;
    const query = target.kind + '=' + encodeURIComponent(target.value);
    return apiFetch('/workspace-cli/presence?' + query, { silentError: true });
  }

  // Phase 5: 期限切れ通知はサーバー処理(管理者PC起動時)に依存するため、メンバー側でも
  // サーバー処理に依存しない表示を併用する。自分の依頼から既定30分経っても管理者からの
  // 返答が(このタブで見えている範囲で)無ければ、一度だけ「まだ届いていません」を出す。
  // (管理者が中継設定で期限を変更していても、メンバーの画面はその値を知らないため既定値を使う。)
  const OWN_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
  let _lastOwnCliRequest = null;

  function _trackOwnCliRequestSubmission(roomPath) {
    _lastOwnCliRequest = { room: roomPath, at: Date.now(), notified: false };
  }

  function _hasAdminReplySince(sinceMs) {
    const rows = document.querySelectorAll('#team-messages .chat-message-row[data-msg-from]');
    for (const row of rows) {
      const from = String(row.dataset.msgFrom || '');
      if (!from.includes('管理者')) continue;
      const ts = Date.parse(row.dataset.msgTime || '');
      if (!Number.isNaN(ts) && ts >= sinceMs) return true;
    }
    return false;
  }

  function _checkOwnCliRequestTimeout() {
    if (!_lastOwnCliRequest || _lastOwnCliRequest.notified) return;
    const currentRoom = typeof _teamCurrentRoom !== 'undefined' ? _teamCurrentRoom : window._teamCurrentRoom;
    if (currentRoom !== _lastOwnCliRequest.room) return;
    if (_hasAdminReplySince(_lastOwnCliRequest.at)) {
      _lastOwnCliRequest = null;
      return;
    }
    if (Date.now() - _lastOwnCliRequest.at < OWN_REQUEST_TIMEOUT_MS) return;
    _lastOwnCliRequest.notified = true;
    if (typeof showStatus === 'function') {
      showStatus('依頼はまだ届いていません。管理者PCの起動状況をご確認ください', true);
    }
  }

  async function pollWorkspaceCliPresence() {
    _checkOwnCliRequestTimeout();
    if (!_presenceShouldPoll()) {
      if (_presencePollTimer) { clearInterval(_presencePollTimer); _presencePollTimer = null; }
      _presenceConsecutiveFailures = 0;
      _renderWorkspaceCliPresenceBadge(null);
      return;
    }
    if (!_presencePollTimer) _presencePollTimer = setInterval(pollWorkspaceCliPresence, PRESENCE_POLL_INTERVAL_MS);
    if (_presencePollInFlight) return;
    _presencePollInFlight = true;
    try {
      // Phase C: 自分の使用量サマリーも同じ間隔で取り直す(バッジのツールチップ表示用)。
      const [snapshot, usage] = await Promise.all([
        _fetchWorkspaceCliPresenceSnapshot(),
        _fetchMyAiUsageSummary(),
      ]);
      if (!_presenceShouldPoll()) return;
      if (usage) _myAiUsageSummary = usage;
      if (snapshot && typeof snapshot === 'object') {
        _presenceConsecutiveFailures = 0;
        _renderWorkspaceCliPresenceBadge(snapshot);
      } else {
        _presenceConsecutiveFailures += 1;
        // 取得失敗時は前回値を維持し、2回連続失敗で初めて「停止中」にする(一時的な通信エラーで点滅させない)。
        if (_presenceConsecutiveFailures >= PRESENCE_FAILURE_THRESHOLD) {
          _renderWorkspaceCliPresenceBadge({ online: false, node_name: '', updated_at: '' });
        }
      }
    } catch {
      _presenceConsecutiveFailures += 1;
      if (_presenceConsecutiveFailures >= PRESENCE_FAILURE_THRESHOLD) {
        _renderWorkspaceCliPresenceBadge({ online: false, node_name: '', updated_at: '' });
      }
    } finally {
      _presencePollInFlight = false;
    }
  }

  function _presenceMaybeTriggerSoon(target) {
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest('.chat-mode-tab, #rab-chat, .rp-tab[data-rp-tab="chat"]')) return;
    setTimeout(() => { pollWorkspaceCliPresence(); }, 80);
  }

  // Phase C: バッジをクリック/Enter/Spaceで自分の使用量内訳を開閉する。
  function _handleWorkspaceCliPresenceBadgeActivate(target) {
    const badge = target?.closest?.('#team-workspace-cli-presence');
    if (!badge || badge.style.display === 'none') return false;
    _toggleAiUsageBreakdownPopup(badge);
    return true;
  }

  function _initWorkspaceCliPresencePolling() {
    pollWorkspaceCliPresence();
    if (!_presenceClickHooked) {
      _presenceClickHooked = true;
      document.addEventListener('click', (ev) => {
        _presenceMaybeTriggerSoon(ev.target);
        _handleWorkspaceCliPresenceBadgeActivate(ev.target);
      }, true);
      document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        if (_handleWorkspaceCliPresenceBadgeActivate(ev.target)) ev.preventDefault();
      }, true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initWorkspaceCliPresencePolling, { once: true });
  } else {
    _initWorkspaceCliPresencePolling();
  }

  window.sendWorkspaceCliRelayRequestClick = sendWorkspaceCliRelayRequestClick;
  window.sendWorkspaceCliRelayRequest = _sendWorkspaceCliRelayRequest;
  window.renderWorkspaceCliRelaySettingsForSettings = renderWorkspaceCliRelaySettingsForSettings;
  window.saveWorkspaceCliRelaySettingsFromSettingsDialog = saveWorkspaceCliRelaySettingsFromSettingsDialog;
  window.pollWorkspaceCliPresence = pollWorkspaceCliPresence;
  window.renderWorkspaceCliPresenceBadge = _renderWorkspaceCliPresenceBadge;
})();
