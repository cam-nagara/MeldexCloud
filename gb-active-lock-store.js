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

  function _cleanHolder(holder) {
    const holderId = _cleanText(holder?.holder_id || holder?.holderId, 160);
    const expiresAt = String(holder?.expires_at || holder?.expiresAt || '');
    const expiresMs = Date.parse(expiresAt);
    if (!holderId || !Number.isFinite(expiresMs) || expiresMs <= _nowMs()) return null;
    const rawHeartbeat = String(holder?.heartbeat_at || holder?.heartbeatAt || '');
    const heartbeatAt = Number.isFinite(Date.parse(rawHeartbeat)) ? rawHeartbeat : new Date().toISOString();
    return {
      holder_id: holderId,
      heartbeat_at: heartbeatAt,
      expires_at: expiresAt,
    };
  }

  function _entryHolders(entry) {
    if (Array.isArray(entry?.holders)) return entry.holders.map(_cleanHolder).filter(Boolean);
    const expiresAt = String(entry?.expires_at || '');
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= _nowMs()) return [];
    return [{
      holder_id: 'legacy',
      heartbeat_at: String(entry?.heartbeat_at || entry?.acquired_at || new Date().toISOString()),
      expires_at: expiresAt,
    }];
  }

  function _entryWithHolders(entry, holders) {
    const cleaned = (holders || []).map(_cleanHolder).filter(Boolean);
    if (!cleaned.length) return null;
    const byExpiry = [...cleaned].sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at));
    const byHeartbeat = [...cleaned].sort((a, b) => Date.parse(b.heartbeat_at) - Date.parse(a.heartbeat_at));
    return {
      ...entry,
      holders: cleaned.sort((a, b) => a.holder_id.localeCompare(b.holder_id)),
      heartbeat_at: byHeartbeat[0]?.heartbeat_at || entry?.heartbeat_at,
      expires_at: byExpiry[0]?.expires_at || entry?.expires_at,
    };
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
    const holders = _entryHolders(entry);
    if (!holders.length) return null;
    const withHolders = _entryWithHolders(entry, holders);
    return {
      path,
      normalized_path: normalized,
      token_hash: tokenHash,
      lock_id: tokenHash.slice(0, 12),
      locked_by: _cleanText(entry?.locked_by, 80),
      device_id: _cleanText(entry?.device_id, 80),
      device_label: _cleanText(entry?.device_label, 120),
      kind: _cleanText(entry?.kind || 'edit', 40),
      include_descendants: entry?.include_descendants === true || entry?.includeDescendants === true,
      acquired_at: String(entry?.acquired_at || new Date().toISOString()),
      heartbeat_at: String(withHolders?.heartbeat_at || new Date().toISOString()),
      expires_at: String(withHolders?.expires_at || _expiresAt(LEASE_SECONDS)),
      holders: withHolders.holders,
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
    const payload = _storePayload(entries);
    await provider.writeJson(STORE_PATH, payload);
    return payload;
  }

  function _storePayload(entries) {
    return {
      entries: entries.map(_cleanEntry).filter(Boolean).sort((a, b) => a.normalized_path.localeCompare(b.normalized_path)),
      updated_at: new Date().toISOString(),
    };
  }

  function _entriesFromStore(data) {
    return (Array.isArray(data?.entries) ? data.entries : []).map(_cleanEntry).filter(Boolean);
  }

  async function _mutateStore(provider, updater) {
    if (typeof provider?.writeJsonMerged === 'function') {
      let result;
      await provider.writeJsonMerged(STORE_PATH, async current => {
        const change = await updater(_entriesFromStore(current));
        if (change === false) return false;
        result = change?.result;
        return _storePayload(Array.isArray(change?.entries) ? change.entries : []);
      }, { fallbackValue: { entries: [], updated_at: '' } });
      return result;
    }

    const store = await _readPruned(provider);
    const change = await updater(store.entries);
    if (change === false) return undefined;
    await _writeStore(provider, Array.isArray(change?.entries) ? change.entries : []);
    return change?.result;
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
    const holderId = _cleanText(body?.holder_id || body?.holderId, 160) || 'legacy';
    const holders = _entryHolders(existing).filter(holder => holder.holder_id !== holderId);
    holders.push({
      holder_id: holderId,
      heartbeat_at: now,
      expires_at: _expiresAt(body?.lease_seconds || body?.leaseSeconds),
    });
    return _entryWithHolders({
      path: _normalizeFolderPath(path),
      normalized_path: _normalize(path),
      token_hash: tokenHash,
      lock_id: tokenHash.slice(0, 12),
      locked_by: _cleanText(body?.locked_by, 80),
      device_id: _cleanText(body?.device_id, 80),
      device_label: _cleanText(body?.device_label, 120),
      kind: _cleanText(body?.kind || 'edit', 40),
      include_descendants: existing?.include_descendants === true
        || body?.include_descendants === true
        || body?.includeDescendants === true,
      acquired_at: existing?.acquired_at || now,
      heartbeat_at: now,
      expires_at: _expiresAt(body?.lease_seconds || body?.leaseSeconds),
    }, holders);
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
    const includeDescendants = body?.include_descendants === true || body?.includeDescendants === true;
    return _mutateStore(provider, entries => {
      // writeJsonMerged の競合リトライごとに、必ずその時点の最新 entries で判定する。
      const conflict = _findConflict(entries, path, tokenHash, { includeDescendants });
      if (conflict) throw _conflictError(conflict, path);
      const existing = entries.find(entry => entry.token_hash === tokenHash && entry.normalized_path === _normalize(path));
      const next = entries.filter(entry => !(entry.token_hash === tokenHash && entry.normalized_path === _normalize(path)));
      const entry = _entryPayload(path, body, tokenHash, existing);
      next.push(entry);
      return { entries: next, result: { ok: true, entry } };
    });
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

  async function release(provider, path, token, holderId) {
    const normalized = _normalize(path);
    if (!normalized || !token) return { ok: true, removed: false };
    const tokenHash = await _tokenHash(token);
    const holder = _cleanText(holderId, 160);
    return _mutateStore(provider, entries => {
      let removed = false;
      const next = [];
      for (const entry of entries) {
        if (entry.token_hash !== tokenHash || entry.normalized_path !== normalized) {
          next.push(entry);
          continue;
        }
        if (!holder) {
          removed = true;
          continue;
        }
        const holders = _entryHolders(entry).filter(row => row.holder_id !== holder);
        removed = removed || holders.length !== _entryHolders(entry).length;
        const updated = _entryWithHolders(entry, holders);
        if (updated) next.push(updated);
      }
      return { entries: next, result: { ok: true, removed } };
    });
  }

  async function releaseAll(provider, token, holderId) {
    if (!token) return { ok: true, removed: 0 };
    const tokenHash = await _tokenHash(token);
    const holder = _cleanText(holderId, 160);
    return _mutateStore(provider, entries => {
      let removed = 0;
      const next = [];
      for (const entry of entries) {
        if (entry.token_hash !== tokenHash) {
          next.push(entry);
          continue;
        }
        if (!holder) {
          removed += 1;
          continue;
        }
        const before = _entryHolders(entry);
        const holders = before.filter(row => row.holder_id !== holder);
        if (holders.length !== before.length) removed += 1;
        const updated = _entryWithHolders(entry, holders);
        if (updated) next.push(updated);
      }
      return { entries: next, result: { ok: true, removed } };
    });
  }

  function _pathDir(path) {
    const text = _normalizeFolderPath(path || '');
    const index = text.lastIndexOf('/');
    return index > 0 ? text.slice(0, index) : '';
  }

  function _pathBase(path) {
    const text = _normalizeFolderPath(path || '');
    const index = text.lastIndexOf('/');
    return index >= 0 ? text.slice(index + 1) : text;
  }

  function _joinPath(parent, child) {
    return _normalizeFolderPath([parent, child].filter(Boolean).join('/'));
  }

  function _splitNameAndExtension(name) {
    const text = String(name || '');
    const index = text.lastIndexOf('.');
    if (index <= 0) return { stem: text, extension: '' };
    return { stem: text.slice(0, index), extension: text.slice(index) };
  }

  async function _entryKind(provider, path) {
    if (!path) return '';
    if (typeof provider?.statPath === 'function') return String((await provider.statPath(path))?.kind || '');
    if (typeof internals._resolveEntryHandle === 'function') {
      return String((await internals._resolveEntryHandle(provider, path))?.kind || '');
    }
    return '';
  }

  async function _moveTarget(provider, sourcePath, destFolder, isFile) {
    if (!sourcePath || !destFolder) return '';
    if (_pathDir(sourcePath) === destFolder) return sourcePath;
    const sourceName = _pathBase(sourcePath);
    const split = _splitNameAndExtension(sourceName);
    const baseName = isFile ? split.stem : sourceName;
    const extension = isFile ? split.extension : '';
    let candidate = _joinPath(destFolder, baseName + extension);
    if (!await _pathExists(provider, candidate)) return candidate;
    for (let index = 1; index < 10000; index += 1) {
      candidate = _joinPath(destFolder, `${baseName}_${String(index).padStart(4, '0')}${extension}`);
      if (!await _pathExists(provider, candidate)) return candidate;
    }
    return _joinPath(destFolder, `${baseName}_${Date.now()}${extension}`);
  }

  function _renameTarget(sourcePath, newName, isFile) {
    if (!sourcePath || !newName) return '';
    const extension = isFile ? _splitNameAndExtension(_pathBase(sourcePath)).extension : '';
    return _joinPath(_pathDir(sourcePath), String(newName).replace(/[\\/]/g, '').trim() + extension);
  }

  function _addCandidate(candidates, value, options = {}) {
    const path = _normalizeFolderPath(value || '');
    if (!path) return;
    candidates.push({
      path,
      includeDescendants: options.includeDescendants === true,
      purpose: String(options.purpose || ''),
    });
  }

  function _uniqueCandidates(candidates) {
    const byPath = new Map();
    for (const candidate of candidates || []) {
      const key = _normalize(candidate?.path || '');
      if (!key) continue;
      const previous = byPath.get(key);
      byPath.set(key, previous ? {
        ...previous,
        includeDescendants: previous.includeDescendants || candidate.includeDescendants,
      } : candidate);
    }
    return [...byPath.values()];
  }

  async function _candidatePaths({ pathname, url, body, provider }) {
    const candidates = [];
    const legacyIncludeDescendants = pathname.includes('folder') || pathname.includes('delete-batch');
    const query = (key, options = {}) => _addCandidate(candidates, url.searchParams.get(key), {
      includeDescendants: options.includeDescendants ?? legacyIncludeDescendants,
      purpose: options.purpose,
    });
    const payload = (key, options = {}) => _addCandidate(candidates, body?.[key], {
      includeDescendants: options.includeDescendants ?? legacyIncludeDescendants,
      purpose: options.purpose,
    });
    const both = (key, options) => { query(key, options); payload(key, options); };
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
      const sourcePath = _normalizeFolderPath(body?.path || '');
      _addCandidate(candidates, sourcePath, {
        includeDescendants: await _entryKind(provider, sourcePath) === 'directory',
        purpose: 'source',
      });
    } else if (pathname === '/outliner/delete-batch') {
      for (const item of Array.isArray(body?.items) ? body.items : []) {
        const sourcePath = _normalizeFolderPath(item?.path || '');
        _addCandidate(candidates, sourcePath, {
          includeDescendants: await _entryKind(provider, sourcePath) === 'directory',
          purpose: 'source',
        });
      }
    } else if (pathname === '/outliner/duplicate') {
      const srcPath = _normalizeFolderPath(body?.path || '');
      if (srcPath) _addCandidate(candidates, _pathDir(srcPath));
    } else if (pathname === '/outliner/save-as') {
      payload('path');
      payload('dest_folder');
    } else if (pathname === '/outliner/move') {
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const destFolder = _normalizeFolderPath(body?.dest_folder || '');
      const sourceKind = await _entryKind(provider, sourcePath);
      _addCandidate(candidates, sourcePath, {
        includeDescendants: sourceKind === 'directory',
        purpose: 'source',
      });
      _addCandidate(candidates, await _moveTarget(provider, sourcePath, destFolder, sourceKind === 'file'), {
        includeDescendants: false,
        purpose: 'destination',
      });
    } else if (pathname === '/outliner/rename' || pathname === '/entity/rename') {
      const oldPath = _normalizeFolderPath(pathname === '/outliner/rename' ? body?.old_path : body?.path);
      const newName = String(body?.new_name || '').replace(/[\\/]/g, '').trim();
      const sourceKind = await _entryKind(provider, oldPath);
      const isFile = sourceKind === 'file' || (sourceKind !== 'directory' && !!_splitNameAndExtension(_pathBase(oldPath)).extension);
      _addCandidate(candidates, oldPath, {
        includeDescendants: sourceKind === 'directory',
        purpose: 'source',
      });
      _addCandidate(candidates, _renameTarget(oldPath, newName, isFile), {
        includeDescendants: false,
        purpose: 'destination',
      });
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
    return _uniqueCandidates(candidates);
  }

  async function guardMutationRequest({ method, body, url, pathname, headers }) {
    if (method === 'GET') return;
    if (pathname === '/active-lock' || pathname.startsWith('/active-lock/')) return;
    const provider = await internals._requirePwaProvider('readwrite');
    const candidates = await _candidatePaths({ pathname, url, body, provider });
    if (!candidates.length) return;
    const token = _token(body || {}, headers);
    for (const candidate of candidates) {
      await requireAvailable(provider, candidate.path, token, {
        includeDescendants: candidate.includeDescendants,
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
      return releaseAll(provider, _token(body || {}, headers), body?.holder_id || body?.holderId || '');
    }
    if (pathname === '/active-lock' && method === 'DELETE') {
      const provider = await internals._requirePwaProvider('readwrite');
      return release(
        provider,
        url.searchParams.get('path') || body?.path || '',
        _token(body || {}, headers),
        url.searchParams.get('holder_id') || body?.holder_id || body?.holderId || '',
      );
    }
    await guardMutationRequest({ method, body, url, pathname, headers });
    return NOT_HANDLED;
  });

  window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];
  window.__MeldexPwaPathMutationHooks.push(async event => {
    const provider = await internals._requirePwaProvider('readwrite').catch(() => null);
    if (!provider) return;
    const oldPath = _normalizeFolderPath(event?.oldPath || event?.path || '');
    const newPath = _normalizeFolderPath(event?.newPath || '');
    if (!oldPath) return;
    const base = _normalize(oldPath);
    await _mutateStore(provider, entries => {
      const next = [];
      let changed = false;
      for (const row of entries) {
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
      return changed ? { entries: next, result: { ok: true } } : false;
    }).catch(() => {});
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
