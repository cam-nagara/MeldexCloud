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
    _validateItemName,
    _removeEntry,
    _moveEntry,
  } = internals;

  const CHAT_DIR = '_chat';
  const RESERVED_TOP_ROOMS = new Set(['llm', 'dm', 'group', 'file']);

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

  function _parseMessage(raw, fallbackId, fallbackRoom) {
    const text = String(raw || '');
    const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
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
      timestamp: frontmatter.timestamp || '',
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

  function _roomPathFromCreateBody(body, user) {
    const type = String(body?.type || 'general');
    if (type === 'dm') {
      const roomName = _normalizeDmRoomName(body?.name || '');
      if (!roomName || !roomName.split('__').includes(user)) throw new Error('このDMには参加できません');
      return 'dm/' + _safeRoomSegment(roomName, 'dm');
    }
    if (type === 'group') return 'group/' + _safeRoomSegment(body?.name, 'group');
    if (type === 'file') return 'file/' + _normalizeRoomPath(body?.name || 'file', 'file');
    return _safeRoomSegment(body?.name, 'general');
  }

  function _roomDir(roomPath) {
    return _joinPath(CHAT_DIR, _normalizeRoomPath(roomPath));
  }

  function _roomMeta(roomPath) {
    const normalized = _normalizeRoomPath(roomPath);
    const parts = normalized.split('/').filter(Boolean);
    const category = parts[0] || '';
    const name = parts.length > 1 ? parts.slice(1).join('/') : (parts[0] || 'general');
    const type = category === 'dm' || category === 'group' || category === 'file' ? category : 'general';
    return { name, path: normalized || 'general', type };
  }

  function _roomMembers(room) {
    return String(room || '').split('/').pop().split('__').map(part => part.trim()).filter(Boolean);
  }

  function _canSeeRoom(meta, user) {
    if (meta.type !== 'dm') return true;
    const members = _roomMembers(meta.path);
    return members.length < 2 || members.includes(user);
  }

  async function _listEntries(provider, path) {
    try {
      return await _listDirectoryEntries(provider, path);
    } catch {
      return [];
    }
  }

  async function _readMessage(provider, roomPath, entry) {
    const filePath = _joinPath(_roomDir(roomPath), entry.name);
    const raw = await provider.readText(filePath);
    return _parseMessage(raw, String(entry.name || '').replace(/\.md$/i, ''), roomPath);
  }

  async function _roomSummary(provider, roomPath) {
    const meta = _roomMeta(roomPath);
    const entries = (await _listEntries(provider, _roomDir(meta.path)))
      .filter(entry => entry?.handle?.kind === 'file' && /\.md$/i.test(entry.name || ''))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    let last = null;
    if (entries.length) {
      try { last = await _readMessage(provider, meta.path, entries[entries.length - 1]); } catch {}
    }
    const payload = { ...meta, count: entries.length, last };
    if (meta.type === 'dm') payload.members = _roomMembers(meta.path);
    return payload;
  }

  async function _listRooms(provider, user) {
    const rootEntries = await _listEntries(provider, CHAT_DIR);
    const rooms = [];
    for (const entry of rootEntries) {
      if (entry?.handle?.kind !== 'directory' || RESERVED_TOP_ROOMS.has(entry.name)) continue;
      const meta = await _roomSummary(provider, entry.name);
      if (_canSeeRoom(meta, user)) rooms.push(meta);
    }
    for (const category of ['dm', 'group', 'file']) {
      const catEntries = await _listEntries(provider, _joinPath(CHAT_DIR, category));
      for (const entry of catEntries) {
        if (entry?.handle?.kind !== 'directory') continue;
        const meta = await _roomSummary(provider, category + '/' + entry.name);
        if (_canSeeRoom(meta, user)) rooms.push(meta);
      }
    }
    return rooms.sort((a, b) => String(a.path || '').localeCompare(String(b.path || ''), 'ja'));
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

    if (pathname === '/collab/rooms' && method === 'GET') {
      return _listRooms(provider, user);
    }
    if (pathname === '/collab/rooms' && method === 'POST') {
      const roomPath = _roomPathFromCreateBody(body || {}, user);
      await _directoryHandle(provider, _roomDir(roomPath), true);
      return { ok: true, path: roomPath };
    }
    if (pathname === '/collab/rooms/rename' && method === 'POST') {
      const oldPath = _normalizeRoomPath(body?.path || '');
      const meta = _roomMeta(oldPath);
      if (meta.type === 'dm') throw new Error('DMはリネームできません');
      const newName = _safeRoomSegment(body?.new_name, 'general');
      const newPath = meta.type === 'general' ? newName : meta.type + '/' + newName;
      await _moveEntry(provider, _roomDir(oldPath), _roomDir(newPath));
      return { ok: true, path: newPath, name: newName };
    }
    if (pathname === '/collab/rooms' && method === 'DELETE') {
      const roomPath = _normalizeRoomPath(url.searchParams.get('path') || body?.path || '');
      await _removeEntry(provider, _roomDir(roomPath));
      return { ok: true };
    }
    if (pathname === '/collab/messages' && method === 'GET') {
      const roomPath = _normalizeRoomPath(url.searchParams.get('room') || 'general');
      const since = String(url.searchParams.get('since') || '');
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 50) || 50));
      const entries = (await _listEntries(provider, _roomDir(roomPath)))
        .filter(entry => entry?.handle?.kind === 'file' && /\.md$/i.test(entry.name || ''))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      const messages = [];
      for (const entry of entries) {
        try {
          const message = await _readMessage(provider, roomPath, entry);
          if (!since || String(message.timestamp || '') > since) messages.push(message);
        } catch {}
      }
      return messages.slice(-limit);
    }
    if (pathname === '/collab/send' && method === 'POST') {
      const roomPath = _normalizeRoomPath(body?.room || 'general');
      const text = String(body?.text || '');
      if (!text) throw new Error('text は必須');
      const roomDir = _roomDir(roomPath);
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
