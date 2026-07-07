(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const {
    NOT_HANDLED,
    _normalizeFolderPath,
    _readJsonSafe,
    _pathExists,
  } = internals;

  const STORE_PATH = '_meldex/active_locks.json';
  const HEADER = 'X-Meldex-Active-Lock-Token';
  const LEASE_SECONDS = 300;
  // 協調編集事故を減らす短期リース。アクセス権限はDropbox共有権限と既存の編集ロックで扱う。
  const SYSTEM_EXCLUDED = new Set(['_chat', '_skills', '_models', '_knowledge', '.meldex', '_meldex', '.trash', '_trash']);

  function _normalize(path) {
    return _normalizeFolderPath(path).toLowerCase();
  }

  function _isSystemExcluded(path) {
    const parts = _normalize(path).split('/').filter(Boolean);
    return parts.some(part => SYSTEM_EXCLUDED.has(part));
  }

  function _nowMs() {
    return Date.now();
  }

  function _expiresAt(leaseSeconds) {
    const seconds = Math.max(30, Math.min(300, Number(leaseSeconds) || LEASE_SECONDS));
    return new Date(_nowMs() + seconds * 1000).toISOString();
  }

  function _cleanText(value, maxLen) {
    return String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, maxLen || 160);
  }

  function _headerValue(headers, name) {
    if (!headers) return '';
    if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name) || '';
    if (Array.isArray(headers)) {
      const row = headers.find(item => String(item?.[0] || '').toLowerCase() === name.toLowerCase());
      return row ? String(row[1] || '') : '';
    }
    if (typeof headers === 'object') {
      const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
      return key ? String(headers[key] || '') : '';
    }
    return '';
  }

  function _token(body, headers) {
    const value = _headerValue(headers, HEADER) || body?.token || '';
    const text = String(value || '').trim();
    return text.length <= 160 ? text : '';
  }

  async function _tokenHash(token) {
    const text = String(token || '').trim();
    if (!text) return '';
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function _cleanEntry(entry) {
    const path = _normalizeFolderPath(entry?.path || '');
    const normalized = _normalize(entry?.normalized_path || path);
    const tokenHash = String(entry?.token_hash || '').trim().toLowerCase();
    if (!path || !normalized || !tokenHash) return null;
    const expiresAt = String(entry?.expires_at || '');
    if (expiresAt && Date.parse(expiresAt) <= _nowMs()) return null;
    return {
      path,
      normalized_path: normalized,
      token_hash: tokenHash,
      lock_id: tokenHash.slice(0, 12),
      locked_by: _cleanText(entry?.locked_by, 80),
      device_id: _cleanText(entry?.device_id, 80),
      device_label: _cleanText(entry?.device_label, 120),
      kind: _cleanText(entry?.kind || 'edit', 40),
      acquired_at: String(entry?.acquired_at || new Date().toISOString()),
      heartbeat_at: String(entry?.heartbeat_at || new Date().toISOString()),
      expires_at: expiresAt || _expiresAt(LEASE_SECONDS),
    };
  }

  async function _readStore(provider) {
    const exists = await _pathExists(provider, STORE_PATH).catch(() => false);
    if (!exists) return { entries: [], updated_at: '' };
    const data = await _readJsonSafe(provider, STORE_PATH, { entries: [] });
    const rawEntries = Array.isArray(data?.entries) ? data.entries : [];
    const entries = rawEntries.map(_cleanEntry).filter(Boolean);
    return {
      entries,
      updated_at: String(data?.updated_at || ''),
    };
  }

  async function _writeStore(provider, entries) {
    const payload = {
      entries: entries.map(_cleanEntry).filter(Boolean).sort((a, b) => a.normalized_path.localeCompare(b.normalized_path)),
      updated_at: new Date().toISOString(),
    };
    await provider.writeJson(STORE_PATH, payload);
    return payload;
  }

  async function _readPruned(provider) {
    return _readStore(provider);
  }

  function _pathsOverlap(target, locked, includeDescendants) {
    if (!target || !locked) return false;
    if (target === locked || target.startsWith(locked + '/')) return true;
    return !!includeDescendants && locked.startsWith(target + '/');
  }

  function _findConflict(entries, path, tokenHash, options = {}) {
    const target = _normalize(path);
    if (!target) return null;
    return (entries || []).find(entry => {
      if (tokenHash && entry?.token_hash === tokenHash) return false;
      return _pathsOverlap(target, _normalize(entry?.normalized_path || entry?.path || ''), !!options.includeDescendants);
    }) || null;
  }

  function _conflictError(entry, path) {
    const owner = entry?.locked_by || entry?.device_label || '別の端末';
    const err = new Error(`${owner}が編集中のため保存できません: ${_normalizeFolderPath(entry?.path || path || '')}`);
    err.status = 423;
    err.lock_entry = entry || null;
    err.unlock_hint = '相手の編集が終わるか、数分後に再試行してください。';
    return err;
  }

  function _entryPayload(path, body, tokenHash, existing) {
    const now = new Date().toISOString();
    return {
      path: _normalizeFolderPath(path),
      normalized_path: _normalize(path),
      token_hash: tokenHash,
      lock_id: tokenHash.slice(0, 12),
      locked_by: _cleanText(body?.locked_by, 80),
      device_id: _cleanText(body?.device_id, 80),
      device_label: _cleanText(body?.device_label, 120),
      kind: _cleanText(body?.kind || 'edit', 40),
      acquired_at: existing?.acquired_at || now,
      heartbeat_at: now,
      expires_at: _expiresAt(body?.lease_seconds || body?.leaseSeconds),
    };
  }

  async function list(provider) {
    const store = await _readPruned(provider);
    return { entries: store.entries, count: store.entries.length };
  }

  async function check(provider, path, token, options = {}) {
    if (!path || _isSystemExcluded(path)) return { locked: false, entry: null };
    const tokenHash = await _tokenHash(token);
    const store = await _readPruned(provider);
    const entry = _findConflict(store.entries, path, tokenHash, options);
    return { locked: !!entry, entry: entry || null };
  }

  async function requireAvailable(provider, path, token, options = {}) {
    if (!path || _isSystemExcluded(path)) return { ok: true, locked: false };
    const result = await check(provider, path, token, options);
    if (result.locked) throw _conflictError(result.entry, path);
    return { ok: true, locked: false };
  }

  async function acquire(provider, body = {}, headers) {
    const path = _normalizeFolderPath(body.path || '');
    const token = _token(body, headers);
    if (!path) throw new Error('path は必須です');
    if (!token) throw new Error('ロックトークンがありません');
    if (_isSystemExcluded(path)) throw new Error('システムフォルダは自動編集中ロックの対象外です');
    const tokenHash = await _tokenHash(token);
    const store = await _readPruned(provider);
    const conflict = _findConflict(store.entries, path, tokenHash);
    if (conflict) throw _conflictError(conflict, path);
    const existing = store.entries.find(entry => entry.token_hash === tokenHash && entry.normalized_path === _normalize(path));
    const next = store.entries.filter(entry => !(entry.token_hash === tokenHash && entry.normalized_path === _normalize(path)));
    const entry = _entryPayload(path, body, tokenHash, existing);
    next.push(entry);
    await _writeStore(provider, next);
    return { ok: true, entry };
  }

  async function heartbeat(provider, body = {}, headers) {
    const rawPaths = Array.isArray(body.paths) ? body.paths : [body.path];
    const entries = [];
    for (const path of rawPaths.map(_normalizeFolderPath).filter(Boolean)) {
      const result = await acquire(provider, { ...body, path }, headers);
      entries.push(result.entry);
    }
    return { ok: true, entries };
  }

  async function release(provider, path, token) {
    const normalized = _normalize(path);
    if (!normalized || !token) return { ok: true, removed: false };
    const tokenHash = await _tokenHash(token);
    const store = await _readPruned(provider);
    const next = store.entries.filter(entry => !(entry.token_hash === tokenHash && entry.normalized_path === normalized));
    await _writeStore(provider, next);
    return { ok: true, removed: next.length !== store.entries.length };
  }

  async function releaseAll(provider, token) {
    if (!token) return { ok: true, removed: 0 };
    const tokenHash = await _tokenHash(token);
    const store = await _readPruned(provider);
    const next = store.entries.filter(entry => entry.token_hash !== tokenHash);
    await _writeStore(provider, next);
    return { ok: true, removed: store.entries.length - next.length };
  }

  function _addPath(paths, value) {
    const text = _normalizeFolderPath(value || '');
    if (text) paths.push(text);
  }

  function _pathDir(path) {
    const text = _normalizeFolderPath(path || '');
    const index = text.lastIndexOf('/');
    return index > 0 ? text.slice(0, index) : '';
  }

  function _candidatePaths({ pathname, url, body }) {
    const paths = [];
    const query = key => _addPath(paths, url.searchParams.get(key));
    const payload = key => _addPath(paths, body?.[key]);
    const both = key => { query(key); payload(key); };
    if (pathname === '/file' || pathname === '/value' || pathname === '/db-metadata' || pathname === '/replace') {
      both('path');
      payload('entry_path');
      payload('folder_path');
    } else if (pathname === '/upload-file') {
      both('path');
      payload('dir');
    } else if (pathname === '/outliner/add') {
      payload('parent');
    } else if (pathname === '/outliner/delete') {
      payload('path');
    } else if (pathname === '/outliner/delete-batch') {
      (Array.isArray(body?.items) ? body.items : []).forEach(item => _addPath(paths, item?.path));
    } else if (pathname === '/outliner/duplicate') {
      const srcPath = _normalizeFolderPath(body?.path || '');
      if (srcPath) _addPath(paths, _pathDir(srcPath));
    } else if (pathname === '/outliner/save-as') {
      payload('path');
      payload('dest_folder');
    } else if (pathname === '/outliner/move') {
      payload('path');
      payload('dest_folder');
    } else if (pathname === '/outliner/rename' || pathname === '/entity/rename') {
      const oldPath = _normalizeFolderPath(pathname === '/outliner/rename' ? body?.old_path : body?.path);
      const newName = String(body?.new_name || '').replace(/[\\/]/g, '').trim();
      _addPath(paths, oldPath);
      if (oldPath && newName) _addPath(paths, (_pathDir(oldPath) ? _pathDir(oldPath) + '/' : '') + newName);
    } else if (pathname === '/entity/create') {
      payload('parent_path');
    } else if (pathname === '/entity/auto-name') {
      payload('db_path');
      payload('entry_path');
      payload('path');
    } else if (pathname === '/folder-links/add' || pathname === '/folder-links/remove') {
      payload('folder_path');
      payload('file_path');
    } else if (pathname === '/annotations' || pathname === '/annotations/restore' || pathname === '/annotations/orphan-by-target') {
      payload('target_path');
    } else if (pathname === '/import-csv' || pathname === '/import-xlsx') {
      payload('csv_path');
      payload('xlsx_path');
      payload('db_path');
    } else if (pathname === '/public-form/submit') {
      payload('db_path');
    } else if (pathname.startsWith('/calendar-db/events') || pathname.startsWith('/calendar-db/sync') || pathname.startsWith('/calendar-db/ical') || pathname.startsWith('/calendar-db/caldav')) {
      both('db_path');
    } else if (pathname === '/version/restore' || pathname === '/version/restore-db' || pathname === '/version/restore-folder' || pathname === '/version/delete-folder') {
      payload('path');
    }
    return [...new Set(paths)];
  }

  async function guardMutationRequest({ method, body, url, pathname, headers }) {
    if (method === 'GET') return;
    if (pathname === '/active-lock' || pathname.startsWith('/active-lock/')) return;
    const paths = _candidatePaths({ pathname, url, body });
    if (!paths.length) return;
    const provider = await internals._requirePwaProvider('readwrite');
    const token = _token(body || {}, headers);
    for (const path of paths) {
      await requireAvailable(provider, path, token, {
        includeDescendants: pathname.includes('folder') || pathname.includes('delete-batch'),
      });
    }
  }

  handlers.push(async function _dropboxActiveLockHandler({ method, body, url, pathname, headers }) {
    if (pathname === '/active-lock' && method === 'GET') {
      const provider = await internals._requirePwaProvider('read');
      return list(provider);
    }
    if (pathname === '/active-lock/check' && method === 'GET') {
      const provider = await internals._requirePwaProvider('read');
      return check(provider, url.searchParams.get('path') || '', _headerValue(headers, HEADER), {
        includeDescendants: url.searchParams.get('include_descendants') === 'true',
      });
    }
    if (pathname === '/active-lock' && method === 'PUT') {
      const provider = await internals._requirePwaProvider('readwrite');
      return acquire(provider, body || {}, headers);
    }
    if (pathname === '/active-lock/heartbeat' && method === 'POST') {
      const provider = await internals._requirePwaProvider('readwrite');
      return heartbeat(provider, body || {}, headers);
    }
    if (pathname === '/active-lock/release-all' && method === 'POST') {
      const provider = await internals._requirePwaProvider('readwrite');
      return releaseAll(provider, _token(body || {}, headers));
    }
    if (pathname === '/active-lock' && method === 'DELETE') {
      const provider = await internals._requirePwaProvider('readwrite');
      return release(provider, url.searchParams.get('path') || body?.path || '', _token(body || {}, headers));
    }
    await guardMutationRequest({ method, body, url, pathname, headers });
    return NOT_HANDLED;
  });

  window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];
  window.__MeldexPwaPathMutationHooks.push(async event => {
    const provider = await internals._requirePwaProvider('readwrite').catch(() => null);
    if (!provider) return;
    const store = await _readPruned(provider).catch(() => ({ entries: [] }));
    const oldPath = _normalizeFolderPath(event?.oldPath || event?.path || '');
    const newPath = _normalizeFolderPath(event?.newPath || '');
    if (!oldPath) return;
    const base = _normalize(oldPath);
    const next = [];
    let changed = false;
    for (const row of store.entries) {
      const cur = _normalize(row.path);
      if (event?.action === 'delete' && (cur === base || (event?.isFolder && cur.startsWith(base + '/')))) {
        changed = true;
        continue;
      }
      if ((event?.action === 'rename' || event?.action === 'move') && newPath && (cur === base || (event?.isFolder && cur.startsWith(base + '/')))) {
        const path = cur === base ? newPath : newPath + row.path.slice(oldPath.length);
        next.push({ ...row, path: _normalizeFolderPath(path), normalized_path: _normalize(path) });
        changed = true;
      } else {
        next.push(row);
      }
    }
    if (changed) await _writeStore(provider, next).catch(() => {});
  });

  window.MeldexActiveLockStore = {
    list,
    check,
    acquire,
    heartbeat,
    release,
    releaseAll,
    guardMutationRequest,
  };
})();
