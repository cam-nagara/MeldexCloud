  await adapter.save(
    window.MeldexSystemStorage.SystemStorageKind.VERSIONS,
    record.documentId,
    { ...record.payload, deleted_at: '', deleted_token: '' },
    { expectedRevision: record.revision },
  );
  return { ok: true, version: record.payload.version_name };
}

window.MeldexFileVersionProviderOps = Object.freeze({
  save: (provider, path, options) => _saveFileVersion(provider, path, options || {}),
  read: (provider, path, version) => _readFileVersion(provider, path, version),
});
  /* Folder-version helpers share the enclosing Dropbox file-operations scope. */
  function _relativeToFolder(folderPath, filePath) {
    const folder = _normalizeFolderPath(folderPath);
    const file = _normalizeFolderPath(filePath);
    if (!folder) return file;
    return file === folder ? '' : (file.startsWith(folder + '/') ? file.slice(folder.length + 1) : file);
  }

  function _skipFolderVersionRelPath(relPath) {
    const normalized = _normalizeFolderPath(relPath);
    return FOLDER_VERSION_EXCLUDE_PREFIXES.some(prefix => normalized === prefix.replace(/\/$/, '') || normalized.startsWith(prefix));
  }

  async function _versionFileBase64(provider, path) {
    const source = await provider.downloadAsFile(path);
    const bytes = new Uint8Array(await source.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return { content_base64: btoa(binary), byte_length: bytes.length };
  }

  async function _collectFolderVersionFiles(provider, folderPath, options = {}) {
    const base = _normalizeFolderPath(folderPath);
    const files = [];
    async function walk(current) {
      const entries = await _listDirectoryEntries(provider, current);
      for (const entry of entries) {
        if (!entry.name || (!options.includeAll && entry.name.startsWith('.'))) continue;
        const fullPath = _joinPath(current, entry.name);
        const relPath = _relativeToFolder(base, fullPath);
        if (!options.includeAll && _skipFolderVersionRelPath(relPath)) continue;
        if (entry.handle.kind === 'directory') {
          files.push({ rel_path: relPath, entry_type: 'directory', size: 0, modified: '', content_base64: null });
          await walk(fullPath);
          continue;
        }
        const ext = _splitNameAndExt(entry.name).ext.toLowerCase();
        if (!options.includeAll && FOLDER_VERSION_EXCLUDE.has(ext)) continue;
        const stats = await _fileStats(entry.handle).catch(() => ({ size: 0, modified: '' }));
        const encoded = await _versionFileBase64(provider, fullPath);
        files.push({
          rel_path: relPath,
          entry_type: 'file',
          size: stats.size || encoded.byte_length,
          modified: stats.modified || '',
          content_base64: encoded.content_base64,
        });
      }
    }
    await walk(base);
    return files;
  }

  async function _saveFolderVersion(provider, folderPath, options) {
    const normalized = _normalizeFolderPath(folderPath);
    const folder = await _resolveEntryHandle(provider, normalized);
    if (!folder || folder.kind !== 'directory') throw new Error(`フォルダが見つかりません: ${normalized}`);
    const label = _safeNamePart(options?.label || '', '').replace(/^_+|_+$/g, '');
    const kind = options?.auto ? 'auto' : 'manual';
    const versionName = `v_${_versionTimestamp()}_${kind}${label ? '_' + label : ''}`;
    const files = await _collectFolderVersionFiles(provider, normalized, options || {});
    const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const storageKind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
    const adapter = await _managementAdapterForProvider(provider, storageKind, normalized);
    const documentId = `folder-${_fnvFileId(normalized)}-${_fnvFileId(versionName)}`;
    await adapter.save(storageKind, documentId, {
      object_type: 'folder',
      original_relative_path: normalized,
      version_name: versionName,
      created_at: _nowIso(),
      label: options?.label || '',
      auto: !!options?.auto,
      files,
      exclude_patterns: [...FOLDER_VERSION_EXCLUDE],
      deleted_at: '',
      deleted_token: '',
      ...(options?.metadata || {}),
    }, { expectedRevision: null });
    return { ok: true, version: versionName, file_count: files.length, total_size: totalSize };
  }

  async function _readLegacyFolderVersion(provider, folderPath, version) {
    const normalized = _normalizeFolderPath(folderPath);
    const safeVersion = _safeVersionName(version);
    const versionDir = _joinPath(_folderVersionDir(normalized), safeVersion);
    const meta = await _readJsonSafe(provider, _joinPath(versionDir, '_meta.json'), null);
    if (!meta || typeof meta !== 'object') return null;
    const files = [];
    for (const file of (Array.isArray(meta.files) ? meta.files : [])) {
      const relPath = _safeRelativeFile(file?.rel_path || '', 'rel_path');
      const encoded = await _versionFileBase64(provider, _joinPath(versionDir, 'files', relPath));
      files.push({
        rel_path: relPath,
        size: Number(file?.size || encoded.byte_length),
        modified: file?.modified || '',
        content_base64: encoded.content_base64,
      });
    }
    return {
      object_type: 'folder',
      original_relative_path: normalized,
      version_name: safeVersion,
      created_at: meta.created || _versionCreatedFromName(safeVersion) || '',
      label: meta.label || '',
      auto: !!meta.auto,
      files,
      exclude_patterns: Array.isArray(meta.exclude_patterns) ? meta.exclude_patterns : [...FOLDER_VERSION_EXCLUDE],
      deleted_at: '',
      deleted_token: '',
      migrated_from_legacy: true,
    };
  }

  async function _listFolderVersions(provider, folderPath) {
    const normalized = _normalizeFolderPath(folderPath);
    const storageKind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
    const adapter = await _managementAdapterForProvider(provider, storageKind, normalized);
    const entries = await adapter.listDocuments(storageKind);
    const versions = [];
    for (const entry of entries) {
      const meta = entry?.payload || {};
      if (meta.object_type !== 'folder' || meta.original_relative_path !== normalized || meta.deleted_at) continue;
      const files = Array.isArray(meta.files) ? meta.files : [];
      versions.push({
        name: meta.version_name,
        created: meta.created_at || _versionCreatedFromName(meta.version_name) || '',
        label: meta.label || '',
        auto: !!meta.auto,
        file_count: files.length,
        total_size: files.reduce((sum, file) => sum + Number(file?.size || 0), 0),
        ...Object.fromEntries(Object.entries(meta).filter(([key]) =>
          key === 'event_id' || key === 'snapshot_reason' || key.startsWith('content_last_editor_')
          || key.startsWith('snapshot_created_by_') || key.startsWith('next_editor_'))),
      });
    }
    const known = new Set(versions.map(row => row.name));
    const legacyDir = _folderVersionDir(normalized);
    for (const entry of await _listEntriesSafe(provider, legacyDir)) {
      if (entry.handle.kind !== 'directory' || !entry.name.startsWith('v_') || known.has(entry.name)) continue;
      const meta = await _readJsonSafe(provider, _joinPath(legacyDir, entry.name, '_meta.json'), null);
      if (!meta || typeof meta !== 'object') continue;
      const files = Array.isArray(meta.files) ? meta.files : [];
      versions.push({
        name: entry.name,
        created: meta.created || _versionCreatedFromName(entry.name) || '',
        label: meta.label || '',
        auto: !!meta.auto,
        file_count: files.length,
        total_size: files.reduce((sum, file) => sum + Number(file?.size || 0), 0),
      });
    }
    versions.sort((a, b) => String(b.name).localeCompare(String(a.name)));
    return versions;
  }

  async function _findFolderVersionRecord(provider, folderPath, version, includeDeleted, migrateLegacy) {
    const normalized = _normalizeFolderPath(folderPath);
    const safeVersion = _safeVersionName(version);
    const storageKind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
    const adapter = await _managementAdapterForProvider(provider, storageKind, normalized);
    const records = await adapter.listDocuments(storageKind);
    let record = records.find(row => {
      const payload = row?.payload || {};
      return payload.object_type === 'folder'
        && payload.original_relative_path === normalized
        && payload.version_name === safeVersion
        && (includeDeleted || !payload.deleted_at);
    });
    if (!record) {
      const legacyPayload = await _readLegacyFolderVersion(provider, normalized, safeVersion);
      if (legacyPayload && migrateLegacy) {
        const documentId = `folder-${_fnvFileId(normalized)}-${_fnvFileId(safeVersion)}`;
        record = await adapter.save(storageKind, documentId, legacyPayload, { expectedRevision: null });
      } else if (legacyPayload) {
        record = { documentId: '', revision: '', payload: legacyPayload };
      }
    }
    return { adapter, storageKind, record };
  }

  async function _readFolderVersion(provider, folderPath, version) {
    const { record } = await _findFolderVersionRecord(provider, folderPath, version, false);
    if (!record) throw new Error('フォルダバージョンが見つかりません');
    return record.payload;
  }

  async function _readFolderVersionFile(provider, folderPath, version, file) {
    const relFile = _safeRelativeFile(file, 'file');
    const meta = await _readFolderVersion(provider, folderPath, version);
    const snapshot = (Array.isArray(meta.files) ? meta.files : []).find(row => row?.rel_path === relFile);
    if (!snapshot?.content_base64) throw new Error('バージョン内のファイルが見つかりません');
    const binary = atob(snapshot.content_base64);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return { content: new TextDecoder().decode(bytes) };
  }

  async function _restoreFolderVersion(provider, folderPath, version) {
    const normalized = _normalizeFolderPath(folderPath);
    const folder = await _resolveEntryHandle(provider, normalized);
    if (!folder || folder.kind !== 'directory') throw new Error(`フォルダが見つかりません: ${normalized}`);
    const safeVersion = _safeVersionName(version);
    const meta = await _readFolderVersion(provider, normalized, safeVersion);
    const protectedFile = (Array.isArray(meta.files) ? meta.files : []).find(file => {
      const relPath = _normalizeFolderPath(file?.rel_path || '');
      return relPath && _isProductionFolderNotePath(_joinPath(normalized, relPath));
    });
    if (protectedFile) {
      throw new Error('制作管理の列定義を含むフォルダ履歴は汎用復元できません');
    }
    for (const file of (Array.isArray(meta.files) ? meta.files : [])) {
      const relPath = _safeRelativeFile(file.rel_path, 'rel_path');
      const dst = _joinPath(normalized, relPath);
      if (!_productionReservedEntryProperties(dst).length) continue;
      const snapshot = meta.files.find(row => row?.rel_path === relPath);
      if (!snapshot?.content_base64) throw new Error('バージョン内のファイルが見つかりません');
      const binary = atob(snapshot.content_base64);
      _rejectProductionLegacyEntryContent(dst, new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
    }
    await _saveFolderVersion(provider, normalized, { auto: true, label: 'pre_restore' });
    const snapshotFiles = new Set((Array.isArray(meta.files) ? meta.files : []).map(file => _normalizeFolderPath(file.rel_path)).filter(Boolean));
    let restored = 0;
    for (const file of (Array.isArray(meta.files) ? meta.files : [])) {
      const relPath = _safeRelativeFile(file.rel_path, 'rel_path');
      const dst = _joinPath(normalized, relPath);
      if (!file.content_base64) continue;
      const binary = atob(file.content_base64);
      await provider.uploadBytes(dst, Uint8Array.from(binary, char => char.charCodeAt(0)));
      restored += 1;
    }
    return { ok: true, restored_count: restored, restored_files: [...snapshotFiles] };
  }

  async function _deleteFolderVersion(provider, folderPath, version) {
    const { adapter, storageKind, record } = await _findFolderVersionRecord(provider, folderPath, version, false, true);
    if (!record) throw new Error('フォルダバージョンが見つかりません');
    const token = _deletedVersionToken();
    await adapter.save(
      storageKind,
      record.documentId,
      { ...record.payload, deleted_at: _nowIso(), deleted_token: token },
      { expectedRevision: record.revision },
    );
    return { ok: true, token, version: record.payload.version_name };
  }

  async function _undeleteFolderVersion(provider, folderPath, token) {
    const normalized = _normalizeFolderPath(folderPath);
    const safeToken = _safeVersionName(token);
    const storageKind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
    const adapter = await _managementAdapterForProvider(provider, storageKind, normalized);
    const records = await adapter.listDocuments(storageKind);
    const record = records.find(row => {
      const payload = row?.payload || {};
      return payload.object_type === 'folder'
        && payload.original_relative_path === normalized
        && payload.deleted_token === safeToken;
    });
    if (!record) throw new Error('削除済みバージョンが見つかりません');
    await adapter.save(
      storageKind,
      record.documentId,
      { ...record.payload, deleted_at: '', deleted_token: '' },
      { expectedRevision: record.revision },
    );
    return { ok: true, version: record.payload.version_name };
  }

  window.MeldexFolderVersionProviderOps = Object.freeze({
    save: (provider, path, options) => _saveFolderVersion(provider, path, options || {}),
    read: (provider, path, version) => _readFolderVersion(provider, path, version),
  });
  async function _findDropboxConflictedCopies(provider, limit) {
    const maxItems = Math.max(1, Math.min(Number(limit || 50), 200));
    const maxFiles = 2500;
    const maxDirs = 500;
    const items = [];
    let total = 0;
    let scannedFiles = 0;
    let scannedDirs = 0;
    let scanTruncated = false;

    async function walk(relativePath) {
      if (scanTruncated) return;
      scannedDirs += 1;
      if (scannedDirs > maxDirs) {
        scanTruncated = true;
        return;
      }
      const entries = await _listDirectoryEntries(provider, relativePath);
      for (const entry of entries) {
        const nextPath = entry.path || _joinPath(relativePath, entry.name);
        if (!entry.name || entry.name.startsWith('.')) continue;
        if (entry.handle.kind === 'directory') {
          if (entry.name === '_meldex' || entry.name === '_trash' || entry.name === 'node_modules') continue;
          await walk(nextPath);
          if (scanTruncated) return;
          continue;
        }
        scannedFiles += 1;
        if (scannedFiles > maxFiles) {
          scanTruncated = true;
          return;
        }
        if (!_isDropboxConflictName(entry.name)) continue;
        total += 1;
        if (items.length >= maxItems) continue;
        const stats = await _fileStats(entry.handle).catch(() => ({ size: 0, modified: '' }));
        const originalPath = _originalPathForConflict(nextPath);
        items.push({
          path: nextPath,
          name: entry.name,
          folder: _dirname(nextPath),
          original_path: originalPath,
          size: Number(stats.size || 0),
          modified: stats.modified || '',
        });
      }
    }

    await walk('');
    return { items, total, truncated: total > items.length || scanTruncated, scannedFiles, scannedDirs };
  }

  handlers.push(async ({ method, body, url, pathname }) => {
    if (pathname === '/cloud/space-usage' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      if (typeof provider.refreshSharedSpaceUsage !== 'function') return { ok: false, error: 'Dropbox 容量確認に未対応です' };
      return provider.refreshSharedSpaceUsage();
    }

    if (pathname === '/cloud/conflicts' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const result = await _findDropboxConflictedCopies(provider, url.searchParams.get('limit') || 50);
      return {
        ok: true,
        count: result.total,
        truncated: result.truncated,
        scanned_files: result.scannedFiles,
        scanned_dirs: result.scannedDirs,
        items: result.items,
      };
    }

    if (pathname === '/cloud/conflict-detail' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const conflictPath = _normalizeFolderPath(url.searchParams.get('path') || '');
      if (!conflictPath || !_isDropboxConflictName(_basename(conflictPath))) throw new Error('競合コピーのパスが不正です');
      const originalPath = _originalPathForConflict(conflictPath);
      if (!originalPath) throw new Error('元ファイルの推定に失敗しました');
      const conflictEntry = await _resolveEntryHandle(provider, conflictPath);
      if (!conflictEntry || conflictEntry.kind !== 'file') throw new Error(`競合コピーが見つかりません: ${conflictPath}`);
      const originalEntry = await _resolveEntryHandle(provider, originalPath);
      const conflictStats = await _fileStats(conflictEntry.handle).catch(() => ({ size: 0, modified: '' }));
      const originalStats = originalEntry?.kind === 'file'
        ? await _fileStats(originalEntry.handle).catch(() => ({ size: 0, modified: '' }))
        : { size: 0, modified: '' };
      const textLike = _isTextLikePath(conflictPath) && (!originalEntry || _isTextLikePath(originalPath));
      const payload = {
        ok: true,
        text_like: textLike,
        original: {
          path: originalPath,
          name: _basename(originalPath),
          exists: originalEntry?.kind === 'file',
          size: Number(originalStats.size || 0),
          modified: originalStats.modified || '',
          content: '',
          truncated: false,
          length: 0,
        },
        conflict: {
          path: conflictPath,
          name: _basename(conflictPath),
          exists: true,
          size: Number(conflictStats.size || 0),
          modified: conflictStats.modified || '',
          content: '',
          truncated: false,
          length: 0,
        },
      };
      if (textLike) {
        const conflictPreview = await _textPreview(provider, conflictPath, 200000);
        payload.conflict.content = conflictPreview.content;
        payload.conflict.truncated = conflictPreview.truncated;
        payload.conflict.length = conflictPreview.length;
        if (originalEntry?.kind === 'file') {
          const originalPreview = await _textPreview(provider, originalPath, 200000);
          payload.original.content = originalPreview.content;
          payload.original.truncated = originalPreview.truncated;
          payload.original.length = originalPreview.length;
        }
      }
      return payload;
    }

    if (pathname === '/cloud/conflict-resolve' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const conflictPath = _normalizeFolderPath(body?.conflict_path || '');
      const action = String(body?.action || '');
      if (!conflictPath || !_isDropboxConflictName(_basename(conflictPath))) throw new Error('競合コピーのパスが不正です');
      if (!['keep_original', 'keep_conflict'].includes(action)) throw new Error('競合解消アクションが不正です');
      const originalPath = _originalPathForConflict(conflictPath);
      if (!originalPath) throw new Error('元ファイルの推定に失敗しました');
      if (action === 'keep_conflict' && _isProductionFolderNotePath(originalPath)) {
        throw new Error('制作管理の列定義へ競合コピーを適用できません');
      }
      if (action === 'keep_conflict' && _productionReservedEntryProperties(originalPath).length) {
        _rejectProductionLegacyEntryContent(originalPath, await provider.readText(conflictPath));
      }
      const conflictEntry = await _resolveEntryHandle(provider, conflictPath);
      if (!conflictEntry || conflictEntry.kind !== 'file') throw new Error(`競合コピーが見つかりません: ${conflictPath}`);
      const originalEntry = await _resolveEntryHandle(provider, originalPath);
      const backups = {};
      const backupStamp = _conflictBackupStamp();

      if (action === 'keep_original') {
        if (originalEntry?.kind !== 'file') throw new Error('元ファイルが見つからないため、元ファイルを残す解消はできません');
        backups.conflict = await _backupConflictSide(provider, 'discarded-conflict', conflictPath, backupStamp);
        await provider.deletePath(conflictPath);
        return { ok: true, action, original_path: originalPath, removed_path: conflictPath, backups };
      }

      backups.conflict = await _backupConflictSide(provider, 'applied-conflict', conflictPath, backupStamp);
      if (originalEntry?.kind === 'file') {
        backups.original = await _backupConflictSide(provider, 'replaced-original', originalPath, backupStamp);
        const conflictFile = await provider.downloadAsFile(conflictPath);
        await provider.downloadAsFile(originalPath).catch(() => null);
        await provider.overwriteBytes(originalPath, new Uint8Array(await conflictFile.arrayBuffer()));
        await provider.deletePath(conflictPath);
      } else {
        await provider.movePath(conflictPath, originalPath);
      }
      return { ok: true, action, original_path: originalPath, removed_path: conflictPath, backups };
    }

    if (pathname === '/home-folder' && method === 'PUT') {
      const provider = await _requirePwaProvider('read');
      const targetPath = _normalizeFolderPath(body?.path || '');
      if (!targetPath) throw new Error('path は必須です');
      const entry = await _resolveEntryHandle(provider, targetPath);
      if (!entry || entry.kind !== 'directory') throw new Error(`フォルダが見つかりません: ${targetPath}`);
      _safeWriteJson(PWA_HOME_KEY, { path: targetPath, name: _basename(targetPath), exists: true, locked_folders: [], locked_paths: [] });
      return { ok: true, path: targetPath };
    }

    if (pathname === '/add-outliner-root' && method === 'POST') {
      const provider = await _requirePwaProvider('read');
      const rawPath = _normalizeFolderPath(body?.path || '');
      if (!rawPath) return { ok: false, needManualInput: true };
      const entry = await _resolveEntryHandle(provider, rawPath);
      if (!entry || entry.kind !== 'directory') return { ok: false, error: 'フォルダが見つかりません' };
      return { ok: true, path: rawPath, name: _basename(rawPath) || rawPath || 'vault' };
    }

    if (pathname === '/browse' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const browsePath = _normalizeFolderPath(url.searchParams.get('path') || url.searchParams.get('root') || '');
      const sort = url.searchParams.get('sort') || 'name';
      const order = url.searchParams.get('order') || 'asc';

/* === gb-data-access-dropbox-folder-links.js === */
/* Atomic, retry-safe batch folder-link routes shared by Cloud/PWA surfaces. */
const _folderLinkBatchFlights = new Map();
const _FOLDER_LINK_REQUEST_LIMIT = 512;

function _folderLinkBatchSummary(operation, requestId, results) {
  const summary = { ok: !results.some(row => row.status === 'failed'), operation, request_id: requestId, results };
  ['created', 'removed', 'unchanged', 'failed'].forEach(status => {
    summary[`${status}_count`] = results.filter(row => row.status === status).length;
  });
  return summary;
}

function _folderLinkBatchFingerprint(operation, body) {
  return JSON.stringify({
    operation,
    folder_path: _normalizeFolderPath(body?.folder_path || ''),
    folder_id: String(body?.folder_id || '').trim(),
    items: (Array.isArray(body?.items) ? body.items : []).map(item => ({
      file_path: _normalizeFolderPath(item?.file_path || item?.path || ''),
      file_id: String(item?.file_id || '').trim(),
    })),
  });
}

function _assertFolderLinkRequestFingerprint(record, operation, fingerprint, scopeId) {
  if (record && (record.operation !== operation || record.fingerprint !== fingerprint || record.scope_id !== scopeId)) {
    throw new Error('同じ request_id を異なるリンク操作へ再利用できません');
  }
}

async function _resolveCloudLinkFolder(provider, body) {
  const requestedPath = _normalizeFolderPath(body?.folder_path || '');
  let folderId = String(body?.folder_id || '').trim();
  let folderPath = requestedPath;
  if (folderId) {
    const byId = _normalizeFolderPath(await _findPathByFileId(provider, folderId));
    if (!byId) throw new Error('folder_id に対応するフォルダが見つかりません');
    if (requestedPath && requestedPath !== byId) throw new Error('folder_path と folder_id が同じフォルダを指していません');
    folderPath = byId;
  }
  const folderEntry = await _resolveEntryHandle(provider, folderPath);
  if (!folderPath || !folderEntry || folderEntry.kind !== 'directory') throw new Error('リンク先フォルダが見つかりません');
  const canonicalId = _fnvFileId(folderPath);
  if (folderId && folderId !== canonicalId) throw new Error('folder_id が現在のフォルダ識別子と一致しません');
  folderId = canonicalId;
  if (typeof isItemLocked === 'function' && isItemLocked(folderPath)) throw new Error('編集ロック中のフォルダにはリンクを変更できません');
  return { folderPath, folderId };
}

function _cloudFolderLinkMatches(link, fileId, folderPath, folderId) {
  return link.file_id === fileId && (link.folder_id === folderId || (!link.folder_id && link.folder_path === folderPath));
}

async function _validateFolderLinkBatch(provider, operation, body) {
  const { folderPath, folderId } = await _resolveCloudLinkFolder(provider, body);
  const inputItems = Array.isArray(body?.items) ? body.items : [];
  if (!inputItems.length) throw new Error('items は1件以上必要です');
  const validated = [];
  const validationFailures = [];
  for (const input of inputItems) {
    const filePath = _normalizeFolderPath(input?.file_path || input?.path || '');
    let fileId = String(input?.file_id || '').trim();
    try {
      if (operation === 'add') {
        const entry = await _resolveEntryHandle(provider, filePath);
        if (!entry) throw new Error('ファイル/フォルダが見つかりません');
        if (entry.kind === 'directory' && (filePath === folderPath || folderPath.startsWith(`${filePath}/`))) {
          throw new Error('元フォルダ自身またはその配下にはリンクできません');
        }
      }
      fileId = fileId || (filePath ? _fnvFileId(filePath) : '');
      if (!fileId) throw new Error('file_id が見つかりません');
      validated.push({ file_path: filePath, file_id: fileId });
    } catch (error) {
      validationFailures.push({ file_path: filePath, file_id: fileId, folder_path: folderPath, folder_id: folderId, status: 'failed', error: error?.message || String(error) });
    }
  }
  return { folderPath, folderId, validated, validationFailures };
}

function _applyFolderLinkBatch(currentLinks, operation, validated, folderPath, folderId) {
  const next = currentLinks.map(link => ({ ...link }));
  const results = validated.map(item => {
    const result = { ...item, folder_path: folderPath, folder_id: folderId };
    const index = next.findIndex(link => _cloudFolderLinkMatches(link, item.file_id, folderPath, folderId));
    if (operation === 'add') {
      if (index >= 0) {
        if (!next[index].folder_id) next[index] = { ...next[index], folder_path: folderPath, folder_id: folderId };
        result.status = 'unchanged';
      } else {
        next.push({ ...item, path: item.file_path, name: _displayLabelForPath(item.file_path, ''), folder_path: folderPath, folder_id: folderId, added_at: new Date().toISOString() });
        result.status = 'created';
      }
    } else if (index < 0) result.status = 'unchanged';
    else {
      next.splice(index, 1);
      result.status = 'removed';
    }
    return result;
  });
  return { links: next, results };
}

async function _executeFolderLinkBatch(provider, operation, body, scopeId, fingerprint) {
  const requestId = String(body?.request_id || '').trim();
  if (requestId) {
    const current = await _folderLinksStateForProvider(provider);
    if (!Array.isArray(current?.requests)) throw new Error('フォルダリンクの再試行履歴が破損しています');
    const previous = current.requests.find(record => record.request_id === requestId);
    _assertFolderLinkRequestFingerprint(previous, operation, fingerprint, scopeId);
    if (previous) return previous.result;
  }
  const { folderPath, folderId, validated, validationFailures } = await _validateFolderLinkBatch(provider, operation, body);
  const committed = await _updateFolderLinksStateForProvider(provider, (state) => {
    if (!Array.isArray(state?.links) || !Array.isArray(state?.requests)) {
      throw new Error('フォルダリンクの再試行履歴が破損しています');
    }
    const previous = requestId ? state.requests.find(record => record.request_id === requestId) : null;
    _assertFolderLinkRequestFingerprint(previous, operation, fingerprint, scopeId);
    if (previous) return { ...state, result: previous.result };
    const applied = _applyFolderLinkBatch(state.links, operation, validated, folderPath, folderId);
    const result = _folderLinkBatchSummary(operation, requestId, applied.results.concat(validationFailures));
    const requests = requestId ? [...state.requests, {
      request_id: requestId,
      operation,
      fingerprint,
      scope_id: scopeId,
      result,
      saved_at: new Date().toISOString(),
    }].slice(-_FOLDER_LINK_REQUEST_LIMIT) : state.requests;
    return { links: applied.links, requests, result };
  });
  return committed.result;
}

async function _handleFolderLinkBatchRoute(pathname, method, body) {
  const operation = pathname === '/folder-links/batch/add' && method === 'POST' ? 'add'
    : (pathname === '/folder-links/batch/remove' && method === 'POST' ? 'remove' : '');
  if (!operation) return undefined;
  const provider = await _requirePwaProvider('readwrite');
  const scopeId = await _folderLinksManagementScope(provider);
  const requestId = String(body?.request_id || '').trim();
  const fingerprint = _folderLinkBatchFingerprint(operation, body);
  const key = `${scopeId}:${requestId}`;
  if (requestId) {
    const flight = _folderLinkBatchFlights.get(key);
    _assertFolderLinkRequestFingerprint(flight, operation, fingerprint, scopeId);
    if (flight) return flight.promise;
  }
  const promise = _executeFolderLinkBatch(provider, operation, body, scopeId, fingerprint);
  if (requestId) _folderLinkBatchFlights.set(key, { operation, fingerprint, scope_id: scopeId, promise });
  try { return await promise; }
  finally { if (requestId) _folderLinkBatchFlights.delete(key); }
}

// Generated split parts execute at separate script boundaries in real browsers.
// Export through the established internals object instead of relying on a cross-part lexical binding.
if (globalThis.__MeldexPwaDataAccessInternals) {
  globalThis.__MeldexPwaDataAccessInternals._handleFolderLinkBatchRoute = _handleFolderLinkBatchRoute;
}

/* === gb-data-access-dropbox-fileops.part02.js === */
      const allFiles = _boolParam(url.searchParams.get('all_files'));
      const detail = _boolParam(url.searchParams.get('detail'));
      const foldersOnly = _boolParam(url.searchParams.get('folders_only'));
      const entries = await _listDirectoryEntries(provider, browsePath);
      const folders = [];
      const files = [];
      for (const entry of entries) {
        const itemPath = entry.path || _joinPath(browsePath, entry.name);
        const item = await _buildBrowseItem(provider, itemPath, entry.handle, { allFiles, detail, classifyDirectories: allFiles || detail });
        if (!item) continue;
        if (_isBrowseContainerItem(item)) folders.push(item);
        else if (!foldersOnly) files.push(item);
      }
      const items = _sortBrowseItems(folders, sort, order).concat(_sortBrowseItems(files, sort, order));
      const existing = new Set(items.map((item) => item.path));
      const folderLinks = await _folderLinksForProvider(provider);
      for (const linked of _linkedItemsForFolder(browsePath, folderLinks)) {
        if (existing.has(linked.path)) continue;
        const entry = await _resolveEntryHandle(provider, linked.path);
        if (!entry) continue;
        const item = await _buildBrowseItem(provider, linked.path, entry.handle, { allFiles, detail, classifyDirectories: allFiles || detail });
        if (!item) continue;
        if (_isBrowseContainerItem(item)) {
          items.push({ ...item, linked: true, exists: true, file_id: linked.file_id, link_folder_path: linked.folder_path || browsePath });
          continue;
        }
        if (foldersOnly) continue;
        if (item) items.push({ ...item, linked: true, file_id: linked.file_id, link_folder_path: linked.folder_path || browsePath });
      }
      return items;
    }
    if (pathname === '/check-type' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const targetPath = _normalizeFolderPath(url.searchParams.get('path') || '');
      const entry = await _resolveEntryHandle(provider, targetPath);
      if (!entry) return { type: 'unknown', exists: false };
      if (entry.kind === 'directory') {
        return { type: await _classifyDirectoryType(provider, targetPath), exists: true };
      }
      return { type: (await _classifyFileType(provider, targetPath, {})) || 'unknown', exists: true };
    }
    if (pathname === '/images-in-folder' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const targetPath = _normalizeFolderPath(url.searchParams.get('path') || '');
      // include_videos=1 はビューワーのフォルダ内前後移動用（サーバー版 /api/images-in-folder と同じ拡張子集合）
      const includeVideos = url.searchParams.get('include_videos') === '1';
      const videoExts = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogv']);
      const entries = await _listDirectoryEntries(provider, targetPath);
      const items = [];
      for (const entry of entries) {
        if (entry.handle.kind !== 'file') continue;
        const ext = _splitNameAndExt(entry.name).ext.toLowerCase();
        if (!IMAGE_EXTS.has(ext) && !(includeVideos && videoExts.has(ext))) continue;
        const itemPath = entry.path || _joinPath(targetPath, entry.name);
        const stats = await _fileStats(entry.handle);
        items.push({ name: entry.name, path: itemPath, size: stats.size, modified: stats.modified });
      }
      return items;
    }

    async function _fileIdentityAndRevision(provider, filePath, entry, etag, writeMeta, fileContent) {
      let meta = writeMeta?.meta || writeMeta || null;
      if (!meta?.id && typeof provider?.getMetadata === 'function') {
        meta = await provider.getMetadata(filePath).catch(() => meta);
      }
      if (!meta?.id) {
        const stat = typeof provider?.statPath === 'function'
          ? await provider.statPath(filePath).catch(() => null)
          : null;
        meta = stat?.meta || meta;
      }
      const token = String(etag || '');
      const providerId = String(meta?.id || '');
      const identity = window.MeldexDocumentIdentity;
      const identityFormat = identity?.formatForPath?.(filePath);
      let content = fileContent;
      if (content == null && identityFormat && typeof provider?.readText === 'function') {
        content = await provider.readText(filePath).catch(() => '');
      }
      const documentId = identityFormat
        ? String(identity?.readDocumentId?.(String(content || ''), identityFormat) || '')
        : '';
      return {
        etag: token,
        transport_revision: { transport: 'dropbox-rev', token },
        ...(documentId ? {
          document_id: documentId,
          document_key: `document:${documentId}`,
        } : {}),
        ...(providerId ? {
          provider_id: providerId,
          ...(!documentId ? { document_key: `dropbox-item:${providerId}` } : {}),
        } : {}),
      };
    }

    function _throwPreconditionRequired(filePath, currentEtag) {
      const error = new Error('既存ファイルを更新するには読込時のrevisionが必要です');
      error.status = 428;
      error.code = 'precondition_required';
      error.meldexCode = 'precondition_required';
      error.detail = {
        code: 'precondition_required',
        path: _normalizeFolderPath(filePath),
        current_etag: String(currentEtag || ''),
      };
      throw error;
    }

    function _dropboxTransportRevisionToken(bodyValue) {
      const revision = bodyValue?.transport_revision || bodyValue?.transportRevision || '';
      let transport = '';
      let token = '';
      if (revision && typeof revision === 'object') {
        transport = String(revision.transport || revision.kind || 'dropbox-rev');
        token = String(revision.token || revision.revision || revision.etag || '').trim();
      } else {
        const raw = String(revision || '').trim();
        if (raw.startsWith('local-etag:')) transport = 'local-etag';
        else if (raw.startsWith('dropbox-rev:')) {
          transport = 'dropbox-rev';
          token = raw.slice('dropbox-rev:'.length);
        } else {
          transport = 'dropbox-rev';
          token = raw;
        }
      }
      if (transport && transport !== 'dropbox-rev') {
        const error = new Error('異なる保存経路のrevisionはDropbox保存に使用できません');
        error.status = 400; error.code = 'transport_mismatch'; error.meldexCode = 'transport_mismatch';
        error.detail = { code: 'transport_mismatch', expected_transport: 'dropbox-rev', actual_transport: transport };
        throw error;
      }
      return token;
    }

    if (pathname === '/file' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const filePath = _normalizeFolderPath(url.searchParams.get('path') || '');
      if (!filePath) throw new Error('path は必須です');
      if (!_isTextLikePath(filePath)) throw new Error('Binary file cannot be read as text');
      const entry = await _resolveEntryHandle(provider, filePath);
      if (!entry || entry.kind !== 'file') throw new Error(`ファイルが見つかりません: ${filePath}`);
      if (_boolParam(url.searchParams.get('metadata_only'))) {
        const etag = await _fileEtag(provider, filePath, entry);
        const stats = await _fileStats(entry.handle).catch(() => ({ size: 0 }));
        return {
          path: filePath,
          ...await _fileIdentityAndRevision(provider, filePath, entry, etag),
          size: Number(stats.size || 0),
        };
      }
      if (/\.csv$/i.test(filePath) && typeof provider.downloadAsFile === 'function') {
        const file = await provider.downloadAsFile(filePath);
        const bytes = await file.arrayBuffer();
        const view = new Uint8Array(bytes);
        const bom = view.length >= 3 && view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF;
        let content;
        let encoding = bom ? 'utf-8-bom' : 'utf-8';
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          content = new TextDecoder('shift_jis', { fatal: true }).decode(bytes);
          encoding = 'cp932';
        }
        const dialect = window.MeldexCsv?.detectDialect?.(content, { encoding, bom }) || {};
        const etag = await _fileEtag(provider, filePath, entry);
        return {
          path: filePath,
          content,
          ...await _fileIdentityAndRevision(provider, filePath, entry, etag),
          encoding,
          bom,
          delimiter: dialect.delimiter || ',',
          newline: dialect.newline || '\n',
        };
      }
      const etag = await _fileEtag(provider, filePath, entry);
      const content = await provider.readText(filePath);
      return {
        path: filePath,
        content,
        ...await _fileIdentityAndRevision(provider, filePath, entry, etag, null, content),
      };
    }

    if (pathname === '/file' && (method === 'PUT' || method === 'POST')) {
      const provider = await _requirePwaProvider('readwrite');
      const filePath = _normalizeFolderPath(url.searchParams.get('path') || '');
      if (!filePath) throw new Error('path は必須です');
      if (_isProductionFolderNotePath(filePath)) {
        throw new Error('制作管理の列定義ファイルは汎用ファイル保存から変更できません');
      }
      let content = String(body?.content ?? '');
      _rejectProductionLegacyEntryContent(filePath, content);
      const skipIfMissing = !!(body?.skip_if_missing || body?.skipIfMissing);
      const forceOverwrite = !!(body?.force_overwrite || body?.forceOverwrite);
      const createOnly = !!(body?.create_only || body?.createOnly);
      const explicitEtag = String(body?.if_match_etag || body?.ifMatchEtag || '').trim();
      const transportEtag = _dropboxTransportRevisionToken(body);
      if (explicitEtag && transportEtag && explicitEtag !== transportEtag) {
        const error = new Error('if_match_etagとtransport_revisionが一致しません');
        error.status = 400; error.code = 'revision_field_mismatch'; error.meldexCode = 'revision_field_mismatch';
        throw error;
      }
      const expectedEtag = explicitEtag || transportEtag;
      const entry = await _resolveEntryHandle(provider, filePath);
      if (!entry && skipIfMissing) return { ok: true, skipped: true, missing: true, etag: '' };
      if (entry?.kind === 'directory') throw new Error(`フォルダはファイルとして保存できません: ${filePath}`);
      if ((createOnly && entry) || (expectedEtag && !entry && !forceOverwrite)) {
        _throwEtagConflict(filePath, expectedEtag, entry ? await _fileEtag(provider, filePath, entry) : '');
      }
      if (entry && !expectedEtag && !forceOverwrite && !createOnly) {
        _throwPreconditionRequired(filePath, await _fileEtag(provider, filePath, entry));
      }
      if (expectedEtag && entry && !forceOverwrite) {
        const currentEtag = await _fileEtag(provider, filePath, entry);
        if (!currentEtag || currentEtag !== expectedEtag) _throwEtagConflict(filePath, expectedEtag, currentEtag);
      }
      if (forceOverwrite && typeof provider.refreshMetadata === 'function') await provider.refreshMetadata(filePath).catch(() => null);
      const currentContent = entry ? await provider.readText(filePath) : '';
      await _assertNoBoardTypeDowngrade(provider, filePath, content);
      const incomingIdentityFmt = window.MeldexDocumentIdentity?.formatForPath?.(filePath, content);
      let docIdentityFmt = incomingIdentityFmt;
      if (incomingIdentityFmt) {
        let existingDocumentId = '';
        if (entry) {
          const existingIdentityFmt = window.MeldexDocumentIdentity?.formatForPath?.(filePath, currentContent);
          docIdentityFmt = existingIdentityFmt === incomingIdentityFmt ? incomingIdentityFmt : null;
          existingDocumentId = String(
            docIdentityFmt && window.MeldexDocumentIdentity?.readDocumentId?.(currentContent, docIdentityFmt)
            || '',
          );
        }
        if (docIdentityFmt) {
          content = window.MeldexDocumentIdentity.ensureDocumentIdForOverwrite(
            content,
            docIdentityFmt,
            existingDocumentId,
          ).text;
        }
      }
      const history = await _prepareCloudFileEdit(
        provider, filePath, currentContent, content, _versionActor(url, body), expectedEtag, !!entry,
      );
      let writeMeta;
      try {
        writeMeta = await provider.writeText(filePath, content);
      } catch (error) {
        await _abortCloudFileEdit(history);
        throw error;
      }
      const etag = await _fileEtag(provider, filePath, null, writeMeta);
      const historySyncPending = await _commitCloudFileEdit(history, etag);
      return {
        ok: true,
        ...await _fileIdentityAndRevision(provider, filePath, null, etag, writeMeta, content),
        history_recorded: !historySyncPending,
        history_sync_pending: historySyncPending,
      };
    }
