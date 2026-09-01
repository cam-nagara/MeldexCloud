  const path = _normalizeFolderPath(url.searchParams.get('target_path') || url.searchParams.get('path') || '');
  if (!path) return { ok: true, total: 0, entries: [] };
  const kinds = new Set(String(url.searchParams.get('kinds') || 'named,auto,edit').split(',').filter(Boolean));
  const entries = [];
  const target = await _resolveEntryHandle(provider, path);
  const folderTarget = target?.kind === 'directory';
  if (target?.kind === 'file') {
    try {
      await _reconcileCloudEditIntents(provider, path, await provider.readText(path));
    } catch (error) {
      console.warn('編集履歴の同期待ち確認に失敗しました:', error);
    }
  }
  if (kinds.has('named') || kinds.has('auto')) {
    const versions = folderTarget ? await _listFolderVersions(provider, path) : await _listFileVersions(provider, path);
    for (const row of versions) {
      const auto = !!row.auto;
      if (!kinds.has(auto ? 'auto' : 'named')) continue;
      const previousName = row.content_last_editor_display_name || '';
      const nextName = row.next_editor_display_name || '';
      entries.push({
        ...row, id: `file:${path}:${row.name}`, type: auto ? 'auto' : 'named',
        timestamp: row.created || row.modified || '', path,
        file_kind: folderTarget ? 'folder' : (row.file_kind || _historyFileKind(path, '')),
        user: previousName, actor_id: row.content_last_editor_id || '',
        actor_kind: row.content_last_editor_kind || '', actor_model: row.content_last_editor_model || '',
        actor_provider: row.content_last_editor_provider || '',
        chat_session_id: row.content_last_editor_session_id || '', tool_name: row.content_last_editor_tool || '',
        label: row.snapshot_reason === 'before_editor_transition'
          ? `${previousName || '編集者不明'}の最終編集 — ${nextName || '別のユーザー'}が編集を開始する前に自動保存`
          : (row.label || (auto ? '自動復元ポイント' : 'スナップショット')),
        snapshot_ref: row.name, snapshot_kind: folderTarget ? 'folder' : 'file', snapshot_version: row.name,
        version_type: folderTarget ? 'folder' : 'file', auto,
      });
    }
  }
  if (kinds.has('edit')) {
    for (const record of await _listSharedEditRecords(provider, path, folderTarget)) {
      const row = record.payload || {};
      const integrityStatus = String(record.integrity?.status || 'pending-owner-signature');
      entries.push({
        ...row, id: `edit:${row.event_id || record.documentId}`, type: 'edit',
        timestamp: row.committed_at || row.timestamp || '',
        path: row.original_relative_path || path,
        label: row.body_diff_summary || row.action || '編集', auto: false,
        snapshot_ref: '', snapshot_kind: '', snapshot_version: '', version_type: '',
        integrity_status: integrityStatus,
        integrity_verified: record.integrity?.ok === true,
        integrity_warning: integrityStatus === 'tampered'
          ? '署名後に変更レコードが改変された可能性があります。内容を残したまま、管理者鍵の復旧または安全な版への復元を確認してください。'
          : (integrityStatus === 'owner-key-missing'
            ? 'この端末に検証用の管理者鍵がありません。管理者鍵を復旧してから整合性を確認してください。'
            : ''),
        integrity_recovery_action: ['tampered', 'owner-key-missing'].includes(integrityStatus)
          ? 'open-owner-key-recovery' : '',
      });
    }
  }
  const filters = {
    actor_id: 'actor_id', actor_kind: 'actor_kind', actor_model: 'actor_model',
    actor_provider: 'actor_provider', chat_session_id: 'chat_session_id', user: 'user',
    tool_name: 'tool_name', file_kind: 'file_kind', action: 'action',
    entity: 'entity_name', prop: 'property_name',
  };
  const since = String(url.searchParams.get('since') || '');
  const until = String(url.searchParams.get('until') || '');
  const filtered = entries.filter(entry => Object.entries(filters).every(([queryKey, entryKey]) => {
    const expected = String(url.searchParams.get(queryKey) || '');
    return !expected || String(entry[entryKey] || '') === expected;
  }) && (!since || String(entry.timestamp || '') >= since)
    && (!until || String(entry.timestamp || '') <= until))
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));
  return { ok: true, total: filtered.length, entries: filtered.slice(offset, offset + limit) };
}

function _safeVersionName(value) {
  const name = _decodePathPart(value).trim();
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('version が不正です');
  return name;
}

function _deletedVersionToken() {
  return `d_${_versionTimestamp()}`;
}

async function _findFileVersionRecord(provider, path, version, includeDeleted, migrateLegacy) {
  const normalized = _normalizeFolderPath(path);
  const name = _safeVersionName(version);
  const storageKind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
  const adapter = await _managementAdapterForProvider(provider, storageKind, normalized);
  const records = await adapter.listDocuments(storageKind);
  let record = records.find(row => {
    const payload = row?.payload || {};
    return payload.object_type === 'text-file'
      && payload.original_relative_path === normalized
      && payload.version_name === name
      && (includeDeleted || !payload.deleted_at);
  });
  if (!record) {
    const legacyPath = _joinPath(_fileVersionDir(normalized), name);
    const legacyEntry = await _resolveEntryHandle(provider, legacyPath);
    if (legacyEntry?.kind === 'file') {
      const info = _fileVersionInfoFromName(name);
      const stats = await _fileStats(legacyEntry.handle).catch(() => ({ modified: '' }));
      const payload = {
        object_type: 'text-file',
        original_relative_path: normalized,
        version_name: name,
        content: await provider.readText(legacyPath),
        auto: info.auto,
        label: info.label,
        created_at: info.created || stats.modified || '',
        deleted_at: '',
        deleted_token: '',
        migrated_from_legacy: true,
      };
      if (migrateLegacy) {
        const documentId = `file-${_fnvFileId(normalized)}-${_fnvFileId(name)}`;
        record = await adapter.save(storageKind, documentId, payload, { expectedRevision: null });
      } else {
        record = { documentId: '', revision: '', payload };
      }
    }
  }
  return { adapter, storageKind, record, name };
}

async function _readFileVersion(provider, path, version) {
  const { record, name } = await _findFileVersionRecord(provider, path, version, false);
  if (!record || record.payload?.deleted_at) throw new Error('バージョンが見つかりません');
  return { content: String(record.payload?.content || ''), name };
}

async function _restoreFileVersion(provider, path, version) {
  const normalized = _normalizeFolderPath(path);
  if (_isProductionFolderNotePath(normalized)) {
    throw new Error('制作管理の列定義ファイルは汎用バージョン履歴から復元できません');
  }
  const source = await _resolveEntryHandle(provider, normalized);
  if (!source || source.kind !== 'file') throw new Error(`ファイルが見つかりません: ${normalized}`);
  const data = await _readFileVersion(provider, normalized, version);
  _rejectProductionLegacyEntryContent(normalized, data.content || '');
  await _saveFileVersion(provider, normalized, { auto: true, label: 'pre_restore', max_auto: 30 });
  await provider.writeText(normalized, data.content || '');
  return { ok: true };
}

async function _deleteFileVersion(provider, path, version) {
  const { adapter, storageKind, record, name } = await _findFileVersionRecord(provider, path, version, false, true);
  if (!record) throw new Error('バージョンが見つかりません');
  const token = _deletedVersionToken();
  await adapter.save(
    storageKind,
    record.documentId,
    { ...record.payload, deleted_at: _nowIso(), deleted_token: token },
    { expectedRevision: record.revision },
  );
  return { ok: true, token, version: name };
}

async function _undeleteFileVersion(provider, path, token) {
  const normalized = _normalizeFolderPath(path);
  const safeToken = _safeVersionName(token);
  const adapter = await _managementAdapterForProvider(provider, window.MeldexSystemStorage.SystemStorageKind.VERSIONS, normalized);
  const records = await adapter.listDocuments(window.MeldexSystemStorage.SystemStorageKind.VERSIONS);
  const record = records.find(row => row.payload?.original_relative_path === normalized && row.payload?.deleted_token === safeToken);
  if (!record) throw new Error('削除済みバージョンが見つかりません');
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
    const pointMetadata = _restorePointMetadata(options?.label || '', !!options?.auto, options?.metadata);
    if (!_shouldCreateRestorePoint(options?.label || '', !!options?.auto, options?.metadata)) {
      return { ok: true, skipped: true, reason: 'ordinary_write' };
    }
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
      ...pointMetadata,
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
        try {
          const snapshot = await _readConflictSnapshot(provider, nextPath);
          if (_resolvedConflictTombstone(snapshot.bytes)) continue;
        } catch {}
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
      const conflictSnapshot = await _readConflictSnapshot(provider, conflictPath);
      if (_resolvedConflictTombstone(conflictSnapshot.bytes)) throw new Error('この競合コピーは解消済みです');
      const originalSnapshot = originalEntry?.kind === 'file' ? await _readConflictSnapshot(provider, originalPath) : null;
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
          revision: originalSnapshot?.revision || '',
          sha256: originalSnapshot?.sha256 || '',
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
          revision: conflictSnapshot.revision,
          sha256: conflictSnapshot.sha256,
        },
      };
      if (textLike) {
        const conflictPreview = _conflictSnapshotPreview(conflictSnapshot, 200000);
        payload.conflict.content = conflictPreview.content;
        payload.conflict.truncated = conflictPreview.truncated;
        payload.conflict.length = conflictPreview.length;
        if (originalEntry?.kind === 'file') {
          const originalPreview = _conflictSnapshotPreview(originalSnapshot, 200000);
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
      const expectedConflictRevision = String(body?.conflict_revision || '').trim();
      const expectedConflictSha256 = String(body?.conflict_sha256 || '').trim();
      const expectedOriginalRevision = String(body?.original_revision || '').trim();
      const expectedOriginalSha256 = String(body?.original_sha256 || '').trim();
      if (!expectedConflictRevision || !expectedConflictSha256) {
        const error = new Error('競合詳細を再読込してから解消してください');
        error.status = 428;
        error.code = 'precondition_required';
        throw error;
      }
      const conflictSnapshot = await _readConflictSnapshot(provider, conflictPath);
      const originalSnapshot = originalEntry?.kind === 'file' ? await _readConflictSnapshot(provider, originalPath) : null;
      if (conflictSnapshot.revision !== expectedConflictRevision || conflictSnapshot.sha256 !== expectedConflictSha256
        || String(originalSnapshot?.revision || '') !== expectedOriginalRevision
        || String(originalSnapshot?.sha256 || '') !== expectedOriginalSha256) {
        const error = new Error('比較後に原本または競合コピーが更新されました。詳細を再確認してください');
        error.status = 409;
        error.code = 'conflict_generation_changed';
        throw error;
      }
      const backups = {};
      const backupStamp = _conflictBackupStamp();

      if (action === 'keep_original') {
        if (originalEntry?.kind !== 'file') throw new Error('元ファイルが見つからないため、元ファイルを残す解消はできません');
        backups.conflict = await _backupConflictSide(
          provider,
          'discarded-conflict',
          conflictPath,
          backupStamp,
          conflictSnapshot,
        );
        const retired = await _retireResolvedConflict(provider, conflictSnapshot, action, backups.conflict);
        return { ok: true, action, original_path: originalPath, backups, ...retired };
      }

      if (originalEntry?.kind !== 'file') {
        const error = new Error('元ファイルがない競合コピーの安全な適用はデスクトップ版で行ってください');
        error.status = 409;
        error.code = 'missing_original_requires_desktop';
        throw error;
      }
      backups.conflict = await _backupConflictSide(
        provider,
        'applied-conflict',
        conflictPath,
        backupStamp,
        conflictSnapshot,
      );
      backups.original = await _backupConflictSide(
        provider,
        'replaced-original',
        originalPath,
        backupStamp,
        originalSnapshot,
      );
      const applied = await provider.uploadBytesConditional(originalPath, conflictSnapshot.bytes, originalSnapshot.revision);
      const appliedRevision = String(applied?.revision || applied?.rev || '').trim();
      if (!appliedRevision) {
        const error = new Error('競合コピー適用後の原本世代を確認できません');
        error.status = 503;
        error.code = 'strict_cas_unavailable';
        throw error;
      }
      let retired;
      try {
        retired = await _retireResolvedConflict(provider, conflictSnapshot, action, backups.conflict);
      } catch (error) {
        try {
          await provider.uploadBytesConditional(originalPath, originalSnapshot.bytes, appliedRevision);
        } catch (rollbackError) {
          const failed = new Error('競合解消の補償復旧に失敗しました。両世代のbackupを保持しています');
          failed.status = 500;
          failed.code = 'conflict_resolution_compensation_failed';
          failed.backups = backups;
          throw failed;
        }
        throw error;
      }
      return { ok: true, action, original_path: originalPath, backups, ...retired };
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
