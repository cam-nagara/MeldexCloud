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
    _pathExists,
    _removeEntry,
    _moveEntry,
  } = internals;

  const CHAT_DIR = '_chat';
  const RESERVED_TOP_ROOMS = new Set(['llm', 'dm', 'group', 'file']);
  const GROUP_MEMBERS_FILE = '_members.json';

  function _jsonString(value) {
    return JSON.stringify(String(value == null ? '' : value));
  }

  function _frontmatterValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      try { return JSON.parse(raw); } catch {}
      return raw.slice(1, -1);
    }
    return raw;
  }

  function _timestampText(value) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(text)) return text.replace(/\s+/, 'T');
    return text;
  }

  function _timestampMillis(value) {
    const text = _timestampText(value);
    if (!text) return null;
    // 旧デスクトップ版はオフセット無しのローカル時刻を保存していた。
    // 実行端末のtimezoneへ委ねると、GitHub/海外端末では同じメッセージの
    // since判定が変わるため、旧形式だけMeldexの基準時刻(JST)として固定する。
    const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text) && !hasOffset
      ? text + '+09:00'
      : text;
    const ms = new Date(normalized).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  function _parseMessage(raw, fallbackId, fallbackRoom) {
    const text = String(raw || '');
    const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const frontmatter = {};
    let body = text;
    if (match) {
      body = text.slice(match[0].length);
      match[1].split(/\r?\n/).forEach((line) => {
        const m = line.match(/^([^:#]+):\s*(.*)$/);
        if (m) frontmatter[m[1].trim()] = _frontmatterValue(m[2]);
      });
    }
    return {
      id: fallbackId,
      from: frontmatter.from || 'anonymous',
      timestamp: _timestampText(frontmatter.timestamp),
      room: frontmatter.room || fallbackRoom || '',
      text: body.trim(),
    };
  }

  function _currentUser(url, body) {
    const candidate = body?.from || url?.searchParams?.get('_user') || (typeof getUsername === 'function' ? getUsername() : '');
    return String(candidate || 'anonymous').trim() || 'anonymous';
  }

  function _safeRoomSegment(value, fallback) {
    const raw = String(value || '').trim() || fallback || 'general';
    return _validateItemName(raw.replace(/[\\/:*?"<>|]/g, '_'), 'room name');
  }

  function _normalizeDmRoomName(name) {
    return String(name || '').split('__').map(part => part.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ja')).join('__');
  }

  function _normalizeRoomPath(value, type) {
    const raw = _normalizeFolderPath(value || '');
    const parts = raw.split('/').filter(Boolean);
    if (!parts.length) return type === 'dm' ? '' : 'general';
    if (parts.some(part => part === '.' || part === '..' || part.startsWith('.'))) {
      throw new Error('不正なルームパスです');
    }
    if (parts[0] === CHAT_DIR) parts.shift();
    if (!parts.length) return type === 'dm' ? '' : 'general';
    return parts.join('/');
  }

  function _requestSourceFolder(url, body) {
    const raw = body?.source_folder || body?.sourceFolder || url?.searchParams?.get('source_folder') || '';
    const normalized = _normalizeFolderPath(raw);
    if (!normalized || normalized === '.') return '';
    if (normalized.split('/').filter(Boolean).some(part => part === '.' || part === '..')) throw new Error('source_folder が不正です');
    return normalized;
  }

  function _clientRoomPath(sourceFolder, path) {
    const base = _normalizeFolderPath(sourceFolder);
    const normalized = _normalizeFolderPath(path);
    if (base && normalized.startsWith(base + '/' + CHAT_DIR + '/')) {
      return normalized.slice(base.length + CHAT_DIR.length + 2);
    }
    return normalized;
  }

  function _requireRoomPath(value) {
    const raw = String(value || '').trim();
    if (!raw) throw new Error('room は必須です');
    return _normalizeRoomPath(raw);
  }

  function _roomPathFromCreateBody(body, user) {
    const type = String(body?.type || 'general');
    if (type === 'dm') {
      const roomName = _normalizeDmRoomName(body?.name || '');
      if (!roomName || !roomName.split('__').includes(user)) throw new Error('このDMには参加できません');
      return 'dm/' + _safeRoomSegment(roomName, 'dm');
    }
    if (type === 'group') return 'group/' + _safeRoomSegment(body?.name, 'group');
    if (type === 'file') return 'file/' + _normalizeRoomPath(body?.name || 'file', 'file');
    const general = _safeRoomSegment(body?.name, 'general');
    if (RESERVED_TOP_ROOMS.has(general)) throw new Error('予約済みのルーム名です');
    return general;
  }

  function _roomDir(roomPath, sourceFolder) {
    return _joinPath(sourceFolder, CHAT_DIR, _normalizeRoomPath(roomPath));
  }

  function _roomMeta(roomPath) {
    const normalized = _normalizeRoomPath(roomPath);
    const parts = normalized.split('/').filter(Boolean);
    const category = parts[0] || '';
    const name = parts.length > 1 ? parts.slice(1).join('/') : (parts[0] || 'general');
    const type = category === 'dm' || category === 'group' || category === 'file' ? category : 'general';
    return { name, path: normalized || 'general', type };
  }

  function _isHiddenRoomEntry(entry) {
    return String(entry?.name || '').startsWith('.');
  }

  function _assertMutableRoomPath(roomPath) {
    const parts = _normalizeRoomPath(roomPath).split('/').filter(Boolean);
    if (!parts.length) return;
    if (parts[0] === 'llm' || (parts.length === 1 && RESERVED_TOP_ROOMS.has(parts[0]))) {
      throw new Error('予約済みのチャット保存領域は変更できません');
    }
  }

  function _renamedRoomPath(meta, newName) {
    if (meta.type === 'general') return newName;
    if (meta.type === 'file') {
      const parts = meta.path.split('/').filter(Boolean);
      parts[parts.length - 1] = newName;
      return parts.join('/');
    }
    return meta.type + '/' + newName;
  }

  function _roomMembers(room) {
    return String(room || '').split('/').pop().split('__').map(part => part.trim()).filter(Boolean);
  }

  function _groupMembersPath(roomPath, sourceFolder) {
    return _joinPath(_roomDir(roomPath, sourceFolder), GROUP_MEMBERS_FILE);
  }

  async function _groupMembers(provider, roomPath, sourceFolder) {
    const data = await _readJsonSafe(provider, _groupMembersPath(roomPath, sourceFolder), {});
    const members = Array.isArray(data?.members) ? data.members : [];
    return members.map(member => String(member || '').trim()).filter(Boolean);
  }

  async function _canSeeRoom(provider, meta, user, sourceFolder) {
    if (meta.type === 'group') {
      const members = await _groupMembers(provider, meta.path, sourceFolder);
      return members.includes(user);
    }
    if (meta.type !== 'dm') return true;
    const members = _roomMembers(meta.path);
    return members.length === 2 && members.includes(user);
  }

  async function _assertRoomAccess(provider, roomPath, user, sourceFolder) {
    const meta = _roomMeta(roomPath);
    if (!await _canSeeRoom(provider, meta, user, sourceFolder)) {
      throw new Error(meta.type === 'group' ? 'このグループにはアクセスできません' : 'このDMにはアクセスできません');
    }
    return meta;
  }

  async function _listEntries(provider, path) {
    try {
      return await _listDirectoryEntries(provider, path);
    } catch {
      return [];
    }
  }

  async function _readMessage(provider, roomPath, entry) {
    const sourceFolder = arguments.length >= 4 ? arguments[3] : '';
    const filePath = _joinPath(_roomDir(roomPath, sourceFolder), entry.name);
    const raw = await provider.readText(filePath);
    return _parseMessage(raw, String(entry.name || '').replace(/\.md$/i, ''), roomPath);
  }

  async function _roomSummary(provider, roomPath, sourceFolder) {
    const meta = _roomMeta(roomPath);
    const entries = (await _listEntries(provider, _roomDir(meta.path, sourceFolder)))
      .filter(entry => entry?.handle?.kind === 'file' && /\.md$/i.test(entry.name || ''))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    let last = null;
    if (entries.length) {
      try { last = await _readMessage(provider, meta.path, entries[entries.length - 1], sourceFolder); } catch {}
    }
    const payload = { ...meta, count: entries.length, last };
    if (meta.type === 'dm') payload.members = _roomMembers(meta.path);
    if (meta.type === 'group') payload.members = await _groupMembers(provider, meta.path, sourceFolder);
    return payload;
  }

  async function _fileRoomPaths(provider, sourceFolder) {
    const basePath = _joinPath(sourceFolder, CHAT_DIR, 'file');
    const paths = [];
    async function walk(path, rel) {
      const entries = await _listEntries(provider, path);
      const dirs = entries.filter(entry => entry?.handle?.kind === 'directory' && !_isHiddenRoomEntry(entry));
      const hasMessages = entries.some(entry => entry?.handle?.kind === 'file' && /\.md$/i.test(entry.name || ''));
      if (rel && (hasMessages || dirs.length === 0)) paths.push('file/' + rel);
      for (const dir of dirs) await walk(_joinPath(path, dir.name), rel ? rel + '/' + dir.name : dir.name);
    }
    await walk(basePath, '');
    return paths;
  }

  async function _listRooms(provider, user, sourceFolder) {
    const rootEntries = await _listEntries(provider, _joinPath(sourceFolder, CHAT_DIR));
    const rooms = [];
    for (const entry of rootEntries) {
      if (entry?.handle?.kind !== 'directory' || RESERVED_TOP_ROOMS.has(entry.name)) continue;
      try {
        const meta = await _roomSummary(provider, entry.name, sourceFolder);
        if (await _canSeeRoom(provider, meta, user, sourceFolder)) rooms.push(meta);
      } catch {}
    }
    for (const category of ['dm', 'group']) {
      const catEntries = await _listEntries(provider, _joinPath(sourceFolder, CHAT_DIR, category));
      for (const entry of catEntries) {
        if (entry?.handle?.kind !== 'directory' || _isHiddenRoomEntry(entry)) continue;
        try {
          const meta = await _roomSummary(provider, category + '/' + entry.name, sourceFolder);
          if (await _canSeeRoom(provider, meta, user, sourceFolder)) rooms.push(meta);
        } catch {}
      }
    }
    for (const roomPath of await _fileRoomPaths(provider, sourceFolder)) {
      const meta = await _roomSummary(provider, roomPath, sourceFolder);
      rooms.push(meta);
    }
    return rooms.sort((a, b) => String(a.path || '').localeCompare(String(b.path || ''), 'ja'));
  }

  async function _writeGroupMembers(provider, roomPath, sourceFolder, user, body) {
    const members = Array.isArray(body?.members) ? body.members : [];
    const clean = Array.from(new Set([user, ...members.map(member => String(member || '').trim()).filter(Boolean)]));
    await provider.writeText(_groupMembersPath(roomPath, sourceFolder), JSON.stringify({ members: clean }, null, 2));
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

  function _messageFileName(date) {
    const pad = value => String(value).padStart(2, '0');
    const stamp = date.getFullYear()
      + pad(date.getMonth() + 1)
      + pad(date.getDate())
      + '_'
      + pad(date.getHours())
      + pad(date.getMinutes())
      + pad(date.getSeconds());
    const bytes = new Uint8Array(4);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
    const suffix = Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
    return stamp + '_' + suffix + '.md';
  }

  handlers.push(async function _dropboxCollabHandler({ method, body, url, pathname }) {
    if (!/^\/collab(\/|$)/.test(pathname)) return NOT_HANDLED;
    const provider = await _requirePwaProvider(method === 'GET' ? 'read' : 'readwrite');
    const user = _currentUser(url, body);
    const sourceFolder = _requestSourceFolder(url, body || {});

    if (pathname === '/collab/rooms' && method === 'GET') {
      return _listRooms(provider, user, sourceFolder);
    }
    if (pathname === '/collab/rooms' && method === 'POST') {
      const roomPath = _roomPathFromCreateBody(body || {}, user);
      await _directoryHandle(provider, _roomDir(roomPath, sourceFolder), true);
      if (_roomMeta(roomPath).type === 'group') await _writeGroupMembers(provider, roomPath, sourceFolder, user, body || {});
      return { ok: true, path: roomPath };
    }
    if (pathname === '/collab/rooms/rename' && method === 'POST') {
      const oldPath = _requireRoomPath(body?.path || '');
      _assertMutableRoomPath(oldPath);
      const meta = await _assertRoomAccess(provider, oldPath, user, sourceFolder);
      if (meta.type === 'dm') throw new Error('DMはリネームできません');
      const newName = _safeRoomSegment(body?.new_name, 'general');
      if (meta.type === 'general' && RESERVED_TOP_ROOMS.has(newName)) throw new Error('予約済みのルーム名です');
      const newPath = _renamedRoomPath(meta, newName);
      if (await _pathExists(provider, _roomDir(newPath, sourceFolder))) throw new Error('同名のルームが既に存在します');
      await _moveEntry(provider, _roomDir(oldPath, sourceFolder), _roomDir(newPath, sourceFolder));
      return { ok: true, path: newPath, name: newName };
    }
    if (pathname === '/collab/rooms' && method === 'DELETE') {
      const roomPath = _requireRoomPath(url.searchParams.get('path') || body?.path || '');
      _assertMutableRoomPath(roomPath);
      await _assertRoomAccess(provider, roomPath, user, sourceFolder);
      await _removeEntry(provider, _roomDir(roomPath, sourceFolder));
      return { ok: true };
    }
    if (pathname === '/collab/messages' && method === 'GET') {
      const roomPath = _requireRoomPath(url.searchParams.get('room') || 'general');
      await _assertRoomAccess(provider, roomPath, user, sourceFolder);
      const since = String(url.searchParams.get('since') || '');
      const sinceMs = _timestampMillis(since);
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 50) || 50));
      const entries = (await _listEntries(provider, _roomDir(roomPath, sourceFolder)))
        .filter(entry => entry?.handle?.kind === 'file' && /\.md$/i.test(entry.name || ''))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      const messages = [];
      for (const entry of entries) {
        try {
          const message = await _readMessage(provider, roomPath, entry, sourceFolder);
          const messageMs = _timestampMillis(message.timestamp);
          if (!since
            || (sinceMs != null && messageMs != null && messageMs > sinceMs)
            || (sinceMs == null && String(message.timestamp || '') > since)) messages.push(message);
        } catch {}
      }
      return messages.slice(-limit);
    }
    if (pathname === '/collab/send' && method === 'POST') {
      const roomPath = _requireRoomPath(body?.room || 'general');
      await _assertRoomAccess(provider, roomPath, user, sourceFolder);
      const text = String(body?.text || '');
      if (!text) throw new Error('text は必須');
      const roomDir = _roomDir(roomPath, sourceFolder);
      await _directoryHandle(provider, roomDir, true);
      const now = new Date();
      const timestamp = now.toISOString();
      const fileName = _messageFileName(now);
      const filePath = _joinPath(roomDir, fileName);
      await provider.writeText(filePath, _messageMarkdown(roomPath, user, text, timestamp));
      return { ok: true, id: fileName.replace(/\.md$/i, ''), timestamp };
    }

    return NOT_HANDLED;
  });

  window.MeldexDropboxCollabDataAccess = { CHAT_DIR };
})();
