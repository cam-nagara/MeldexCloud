(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const {
    NOT_HANDLED,
    _normalizeFolderPath,
    _joinPath,
    _dirname,
    _basename,
    _splitNameAndExt,
    _readJsonSafe,
    _validateItemName,
    _pathExists,
    _resolveEntryHandle,
    _moveConflictName,
    _fnvFileId,
    PWA_TRASH_DIR,
  } = internals;

  const STORE_PATH = '_meldex/file_locks.json';
  const SIGNATURE_SCOPE = 'file_locks';
  const SYSTEM_EXCLUDED = new Set(['_chat', '_skills', '_models', '_knowledge', '.meldex', '_meldex', '.trash', '_trash']);
  const REASON_TEMPLATES = ['確定済み', '公開済み', 'レビュー中', 'アーカイブ', '編集禁止'];

  function _role() {
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    if (state.isOwner) return 'owner';
    if (state.access === 'viewer') return 'viewer';
    return 'editor';
  }

  function _requireOwner() {
    if (_role() !== 'owner') throw new Error('編集ロックの設定は管理者のみ可能です');
  }

  function _normalize(path) {
    return _normalizeFolderPath(path).toLowerCase();
  }

  function _isSystemExcluded(path) {
    const parts = _normalize(path).split('/').filter(Boolean);
    return parts.some(part => SYSTEM_EXCLUDED.has(part));
  }

  function _pathOrAncestorEntry(entries, path) {
    const target = _normalize(path);
    if (!target) return null;
    return (entries || []).find(entry => {
      const base = _normalize(entry?.normalized_path || entry?.path || '');
      return base && (target === base || target.startsWith(base + '/'));
    }) || null;
  }

  function _descendantEntry(entries, path) {
    const target = _normalize(path);
    if (!target) return null;
    return (entries || []).find(entry => {
      const base = _normalize(entry?.normalized_path || entry?.path || '');
      return base && (base === target || base.startsWith(target + '/'));
    }) || null;
  }

  function _cleanEntry(entry) {
    const path = _normalizeFolderPath(entry?.path || '');
    if (!path) return null;
    const normalized = _normalize(path);
    return {
      path,
      normalized_path: normalized,
      file_id: String(entry?.file_id || (_fnvFileId ? _fnvFileId(path) : '')),
      locked_by: String(entry?.locked_by || ''),
      locked_at: String(entry?.locked_at || new Date().toISOString()),
      lock_reason: String(entry?.lock_reason || entry?.reason || '').trim(),
    };
  }

  async function _readStore(provider) {
    const exists = await _pathExists(provider, STORE_PATH).catch(() => false);
    if (!exists) {
      return { entries: [], updated_at: '', verification: { ok: true, skipped: true, reason: 'store-missing' } };
    }
    const data = await _readJsonSafe(provider, STORE_PATH, { entries: [] });
    const entries = (Array.isArray(data?.entries) ? data.entries : []).map(_cleanEntry).filter(Boolean);
    const payload = { entries, updated_at: String(data?.updated_at || '') };
    const verification = await window.MeldexKnowledgeSignature?.verify?.(provider, SIGNATURE_SCOPE, payload).catch(err => ({ ok: false, error: err?.message || String(err) }));
    return { ...payload, verification };
  }

  async function _writeStore(provider, entries, audit) {
    const payload = {
      entries: entries.map(_cleanEntry).filter(Boolean).sort((a, b) => a.normalized_path.localeCompare(b.normalized_path)),
      updated_at: new Date().toISOString(),
    };
    await provider.writeJson(STORE_PATH, payload);
    const signature = await window.MeldexKnowledgeSignature?.sign?.(provider, SIGNATURE_SCOPE, payload, { signer: typeof getUsername === 'function' ? getUsername() : '' }).catch(() => null);
    if (audit) await window.MeldexKnowledgeSignature?.recordAudit?.(provider, 'file_lock', audit).catch(() => {});
    return { ...payload, signature };
  }

  async function list(provider, query = '') {
    const store = await _readStore(provider);
    const q = String(query || '').trim().toLowerCase();
    const entries = q
      ? store.entries.filter(entry => `${entry.path} ${entry.lock_reason} ${entry.locked_by}`.toLowerCase().includes(q))
      : store.entries;
    return { entries, count: entries.length, verification: store.verification };
  }

  async function check(provider, path) {
    const store = await _readStore(provider);
    const entry = _pathOrAncestorEntry(store.entries, path);
    return { locked: !!entry, entry: entry || null, lock_reason: entry?.lock_reason || '', verification: store.verification };
  }

  async function requireUnlocked(provider, path, options = {}) {
    const target = _normalizeFolderPath(path || options.path || '');
    if (!target || _isSystemExcluded(target)) return { ok: true, locked: false };
    const store = await _readStore(provider);
    if (store.verification && store.verification.ok === false && !store.verification.skipped) {
      const err = new Error('編集ロック情報の署名検証に失敗しました');
      err.lock_verification = store.verification;
      throw err;
    }
    const entry = _pathOrAncestorEntry(store.entries, target)
      || (options.includeDescendants ? _descendantEntry(store.entries, target) : null);
    if (!entry) return { ok: true, locked: false };
    const err = new Error('編集ロック中のため変更できません: ' + target);
    err.status = 423;
    err.lock_reason = entry.lock_reason || '';
    err.lock_entry = entry;
    err.unlock_hint = '管理者が編集ロックを解除してから再実行してください。';
    throw err;
  }

  function _isDropboxConflictName(name) {
    const normalized = String(name || '').toLowerCase();
    return /\bconflicted\s+copy\b/.test(normalized) || /競合.*コピー/.test(normalized);
  }

  function _originalPathForConflict(conflictPath) {
    const normalized = _normalizeFolderPath(conflictPath);
    const name = _basename(normalized);
    const match = /^(.*)\s+\((?:[^)]*conflicted\s+copy[^)]*|[^)]*競合[^)]*コピー[^)]*)\)(\.[^.]*)?$/i.exec(name);
    if (!match) return '';
    const originalName = `${match[1]}${match[2] || ''}`.trim();
    return originalName ? _joinPath(_dirname(normalized), originalName) : '';
  }

  async function _uploadTargetPath(provider, url, body) {
    const targetDir = _normalizeFolderPath(url.searchParams.get('path') || body?.dir || '');
    const rawName = String(body?.filename || body?.name || 'file').split(/[\\/]/).pop();
    const fileName = _validateItemName(rawName || 'file', 'filename');
    const split = _splitNameAndExt(fileName);
    let targetName = fileName;
    let targetPath = _joinPath(targetDir, targetName);
    for (let counter = 1; await _pathExists(provider, targetPath); counter += 1) {
      targetName = `${split.stem}_${counter}${split.ext}`;
      targetPath = _joinPath(targetDir, targetName);
    }
    return targetPath;
  }

  async function _guardRename(provider, body) {
    const oldPath = _normalizeFolderPath(body?.old_path || '');
    const newName = _validateItemName(body?.new_name || '', 'new_name');
    const source = await _resolveEntryHandle(provider, oldPath);
    if (!source) return;
    await requireUnlocked(provider, oldPath, { action: 'rename-source', includeDescendants: source.kind === 'directory' });
    const parentPath = _dirname(oldPath);
    const sourceName = _basename(oldPath);
    const nextPath = source.kind === 'directory'
      ? _joinPath(parentPath, newName)
      : _joinPath(parentPath, newName + _splitNameAndExt(sourceName).ext);
    if (nextPath !== oldPath) await requireUnlocked(provider, nextPath, { action: 'rename-destination' });
  }

  async function _guardTrashRestore(provider, body) {
    const name = _validateItemName(body?.name || '', 'name');
    const sourcePath = _joinPath(PWA_TRASH_DIR, name);
    const source = await _resolveEntryHandle(provider, sourcePath);
    if (!source) return;
    const meta = await _readJsonSafe(provider, _joinPath(PWA_TRASH_DIR, name + '._trash_meta.json'), {});
    const baseDest = _normalizeFolderPath(meta?.original_path || '') || name;
    let destPath = baseDest;
    if (await _pathExists(provider, destPath)) {
      const split = _splitNameAndExt(_basename(baseDest));
      const baseDir = _dirname(baseDest);
      for (let counter = 1; await _pathExists(provider, destPath); counter += 1) {
        const stem = source.kind === 'directory' ? _basename(baseDest).replace(/_\d{4}$/, '') : split.stem;
        destPath = source.kind === 'directory'
          ? _joinPath(baseDir, `${stem}_restored_${String(counter).padStart(4, '0')}`)
          : _joinPath(baseDir, `${stem}_restored_${String(counter).padStart(4, '0')}${split.ext}`);
      }
    }
    await requireUnlocked(provider, destPath, { action: 'trash-restore', includeDescendants: source.kind === 'directory' });
  }

  async function _guardOutlinerRestore(provider, body) {
    const trashName = _validateItemName(body?.trash_name || '', 'trash_name');
    const source = await _resolveEntryHandle(provider, _joinPath(PWA_TRASH_DIR, trashName));
    if (!source) return;
    const meta = await _readJsonSafe(provider, _joinPath(PWA_TRASH_DIR, trashName + '._trash_meta.json'), {});
    const originalPath = _normalizeFolderPath(meta?.original_path || '');
    if (originalPath) await requireUnlocked(provider, originalPath, { action: 'restore', includeDescendants: source.kind === 'directory' });
  }

  async function _guardDuplicate(provider, body) {
    const sourcePath = _normalizeFolderPath(body?.path || '');
    const source = await _resolveEntryHandle(provider, sourcePath);
    if (!source) return;
    const sourceName = _basename(sourcePath);
    const sourceSplit = _splitNameAndExt(sourceName);
    let destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${sourceSplit.ext}` : `${sourceName}_copy`;
    let destPath = _joinPath(_dirname(sourcePath), destName);
    for (let counter = 2; await _pathExists(provider, destPath); counter += 1) {
      destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${counter}${sourceSplit.ext}` : `${sourceName}_copy${counter}`;
      destPath = _joinPath(_dirname(sourcePath), destName);
    }
    await requireUnlocked(provider, destPath, { action: 'duplicate-destination', includeDescendants: source.kind === 'directory' });
  }

  async function _guardSaveAs(provider, body) {
    const sourcePath = _normalizeFolderPath(body?.path || '');
    const source = await _resolveEntryHandle(provider, sourcePath);
    if (!source) return;
    const sourceName = _basename(sourcePath);
    const sourceSplit = _splitNameAndExt(sourceName);
    const newName = String(body?.new_name || (source.kind === 'file' ? sourceSplit.stem : sourceName)).replace(/[\\/]/g, '').replace(/\.\./g, '').trim();
    if (!newName) throw new Error('不正なファイル名です');
    const destFolder = _normalizeFolderPath(body?.dest_folder || _dirname(sourcePath));
    let destName = source.kind === 'file' ? newName + sourceSplit.ext : newName;
    let destPath = _joinPath(destFolder, destName);
    for (let counter = 2; await _pathExists(provider, destPath); counter += 1) {
      destName = source.kind === 'file' ? `${newName}_${counter}${sourceSplit.ext}` : `${newName}_${counter}`;
      destPath = _joinPath(destFolder, destName);
    }
    await requireUnlocked(provider, destPath, { action: 'save-as-destination', includeDescendants: source.kind === 'directory' });
  }

  async function _guardMove(provider, body) {
    const sourcePath = _normalizeFolderPath(body?.path || '');
    const destFolder = _normalizeFolderPath(body?.dest_folder || '');
    const source = await _resolveEntryHandle(provider, sourcePath);
    if (!source) return;
    await requireUnlocked(provider, sourcePath, { action: 'move-source', includeDescendants: source.kind === 'directory' });
    const destEntry = await _resolveEntryHandle(provider, destFolder);
    if (!destEntry || destEntry.kind !== 'directory') return;
    const conflict = await _moveConflictName(provider, destFolder, _basename(sourcePath), source.kind === 'file');
    await requireUnlocked(provider, conflict.path, { action: 'move-destination', includeDescendants: source.kind === 'directory' });
  }

  async function _guardConflictResolve(provider, body) {
    const conflictPath = _normalizeFolderPath(body?.conflict_path || '');
    const action = String(body?.action || '');
    if (!conflictPath || !_isDropboxConflictName(_basename(conflictPath))) return;
    const originalPath = _originalPathForConflict(conflictPath);
    if (action === 'keep_original') {
      await requireUnlocked(provider, conflictPath, { action: 'conflict-remove' });
    } else if (action === 'keep_conflict') {
      if (originalPath) await requireUnlocked(provider, originalPath, { action: 'conflict-apply' });
      await requireUnlocked(provider, conflictPath, { action: 'conflict-remove' });
    }
  }

  async function guardMutationRequest({ method, body, url, pathname }) {
    if (method === 'GET') return;
    const guardedPaths = new Set([
      '/file',
      '/upload-file',
      '/cloud/conflict-resolve',
      '/outliner/add',
      '/outliner/rename',
      '/outliner/delete',
      '/outliner/restore',
      '/outliner/duplicate',
      '/outliner/save-as',
      '/outliner/move',
      '/version/restore',
      '/version/restore-folder',
      '/trash/restore',
    ]);
    if (!guardedPaths.has(pathname)) return;
    const provider = await internals._requirePwaProvider('readwrite');
    if (pathname === '/file' && (method === 'PUT' || method === 'POST')) {
      await requireUnlocked(provider, url.searchParams.get('path') || '', { action: 'write' });
    } else if (pathname === '/upload-file' && method === 'POST') {
      await requireUnlocked(provider, await _uploadTargetPath(provider, url, body || {}), { action: 'upload' });
    } else if (pathname === '/cloud/conflict-resolve' && method === 'POST') {
      await _guardConflictResolve(provider, body || {});
    } else if (pathname === '/outliner/add' && method === 'POST') {
      await requireUnlocked(provider, body?.parent || '', { action: 'create' });
    } else if (pathname === '/outliner/rename' && method === 'POST') {
      await _guardRename(provider, body || {});
    } else if (pathname === '/outliner/delete' && method === 'POST') {
      const targetPath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, targetPath);
      await requireUnlocked(provider, targetPath, { action: 'delete', includeDescendants: source?.kind === 'directory' });
    } else if (pathname === '/outliner/restore' && method === 'POST') {
      await _guardOutlinerRestore(provider, body || {});
    } else if (pathname === '/outliner/duplicate' && method === 'POST') {
      await _guardDuplicate(provider, body || {});
    } else if (pathname === '/outliner/save-as' && method === 'POST') {
      await _guardSaveAs(provider, body || {});
    } else if (pathname === '/outliner/move' && method === 'POST') {
      await _guardMove(provider, body || {});
    } else if (pathname === '/version/restore' && method === 'POST') {
      await requireUnlocked(provider, body?.path || '', { action: 'version-restore' });
    } else if (pathname === '/version/restore-folder' && method === 'POST') {
      await requireUnlocked(provider, body?.path || '', { action: 'folder-version-restore', includeDescendants: true });
    } else if (pathname === '/trash/restore' && method === 'POST') {
      await _guardTrashRestore(provider, body || {});
    }
  }

  async function setLock(provider, body = {}) {
    _requireOwner();
    const entry = _cleanEntry({
      path: body.path,
      file_id: body.file_id,
      lock_reason: body.reason || body.lock_reason,
      locked_by: typeof getUsername === 'function' ? getUsername() : '',
      locked_at: new Date().toISOString(),
    });
    if (!entry) throw new Error('path は必須です');
    if (_isSystemExcluded(entry.path)) throw new Error('システムフォルダは編集ロックできません');
    const store = await _readStore(provider);
    const next = store.entries.filter(row => row.normalized_path !== entry.normalized_path && row.file_id !== entry.file_id);
    next.push(entry);
    await _writeStore(provider, next, { action: 'lock', path: entry.path, reason: entry.lock_reason });
    return { ok: true, entry };
  }

  async function unlock(provider, path) {
    _requireOwner();
    const target = _normalize(path);
    if (!target) throw new Error('path は必須です');
    const store = await _readStore(provider);
    const before = store.entries.length;
    const next = store.entries.filter(row => row.normalized_path !== target);
    await _writeStore(provider, next, { action: 'unlock', path: _normalizeFolderPath(path), removed: before - next.length });
    return { ok: true, removed: before - next.length };
  }

  async function rewriteForPathMutation(provider, event = {}) {
    if (!provider || !event) return;
    const store = await _readStore(provider).catch(() => ({ entries: [] }));
    let changed = false;
    const oldPath = _normalizeFolderPath(event.oldPath || event.path || '');
    const newPath = _normalizeFolderPath(event.newPath || '');
    const isFolder = !!event.isFolder;
    const next = [];
    for (const row of store.entries) {
      let path = row.path;
      if (event.action === 'delete') {
        const base = _normalize(oldPath);
        const cur = _normalize(path);
        if (base && (cur === base || (isFolder && cur.startsWith(base + '/')))) {
          changed = true;
          continue;
        }
      } else if ((event.action === 'rename' || event.action === 'move') && oldPath && newPath) {
        const cur = _normalizeFolderPath(path);
        if (cur === oldPath) {
          path = newPath;
          changed = true;
        } else if (isFolder && cur.startsWith(oldPath + '/')) {
          path = newPath + cur.slice(oldPath.length);
          changed = true;
        }
      }
      next.push({ ...row, path, normalized_path: _normalize(path), file_id: _fnvFileId ? _fnvFileId(path) : row.file_id });
    }
    if (changed) await _writeStore(provider, next, { action: 'path-mutation', path: oldPath, new_path: newPath, mutation: event.action || '' });
  }

  handlers.push(async function _dropboxFileLockHandler({ method, body, url, pathname }) {
    if (pathname === '/file-lock' && method === 'GET') {
      const provider = await internals._requirePwaProvider('read');
      return list(provider, url.searchParams.get('q') || url.searchParams.get('search') || '');
    }
    if (pathname === '/file-lock/check' && method === 'GET') {
      const provider = await internals._requirePwaProvider('read');
      return check(provider, url.searchParams.get('path') || '');
    }
    if (pathname === '/file-lock' && method === 'PUT') {
      const provider = await internals._requirePwaProvider('readwrite');
      return setLock(provider, body || {});
    }
    if (pathname === '/file-lock' && method === 'DELETE') {
      const provider = await internals._requirePwaProvider('readwrite');
      return unlock(provider, url.searchParams.get('path') || body?.path || '');
    }
    if (pathname === '/file-lock/templates' && method === 'GET') return { templates: REASON_TEMPLATES.slice() };
    if (pathname === '/file-lock/audit' && method === 'GET') {
      const provider = await internals._requirePwaProvider('read');
      const rows = await window.MeldexKnowledgeSignature?.readAudit?.(provider, 'file_lock').catch(() => []) || [];
      return { items: rows, count: rows.length };
    }
    await guardMutationRequest({ method, body, url, pathname });
    return NOT_HANDLED;
  });

  window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];
  window.__MeldexPwaPathMutationHooks.push(async event => {
    const provider = await internals._requirePwaProvider('readwrite').catch(() => null);
    if (provider) await rewriteForPathMutation(provider, event);
  });

  window.MeldexFileLockStore = {
    list,
    check,
    requireUnlocked,
    setLock,
    unlock,
    rewriteForPathMutation,
    guardMutationRequest,
    reasonTemplates: REASON_TEMPLATES.slice(),
  };
})();
