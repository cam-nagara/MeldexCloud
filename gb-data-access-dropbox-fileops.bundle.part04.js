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
      await _assertNoBoardTypeDowngrade(provider, filePath, content);
      const incomingIdentityFmt = window.MeldexDocumentIdentity?.formatForPath?.(filePath, content);
      let docIdentityFmt = incomingIdentityFmt;
      if (incomingIdentityFmt) {
        let existingDocumentId = '';
        if (entry) {
          const currentContent = await provider.readText(filePath);
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
      const writeMeta = await provider.writeText(filePath, content);
      const etag = await _fileEtag(provider, filePath, null, writeMeta);
      return {
        ok: true,
        ...await _fileIdentityAndRevision(provider, filePath, null, etag, writeMeta, content),
      };
    }

    if (pathname === '/upload-file' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const imageAftercare = window.MeldexCreatedImageIdentityAftercare;
      if (!imageAftercare?.prepare || !imageAftercare?.record
          || !imageAftercare?.cancel || !imageAftercare?.drainPrepared) {
        throw new Error('Cloud画像identity aftercareが読み込まれていません');
      }
      const drainedIdentity = await imageAftercare.drainPrepared(provider);
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
      if (_isProductionFolderNotePath(targetPath)) {
        throw new Error('制作管理の列定義ファイルは汎用アップロードから変更できません');
      }
      const uploadBytes = _decodeUploadData(body?.data || '');
      if (_productionReservedEntryProperties(targetPath).length && /\.md$/i.test(targetPath)) {
        _rejectProductionLegacyEntryContent(targetPath, new TextDecoder().decode(uploadBytes));
      }
      let identity = null;
      if (/\.(?:apng|jpe?g|png|webp)$/i.test(targetPath)) {
        const prepared = await imageAftercare.prepare(provider, targetPath, uploadBytes, {
          source: 'upload-file', filename: targetName,
        });
        if (prepared.publish_required) {
          try {
            await _writeBytes(provider, targetPath, uploadBytes);
          } catch (error) {
            await imageAftercare.cancel(provider, prepared, error?.message).catch(console.warn);
            throw error;
          }
        }
        identity = await imageAftercare.record(
          provider, targetPath, uploadBytes, { source: 'upload-file', prepared },
        );
      } else {
        await _writeBytes(provider, targetPath, uploadBytes);
      }
      return {
        ok: true, path: targetPath, name: targetName,
        aftercare_pending: !!identity?.aftercare_pending || drainedIdentity.blocked > 0,
      };
    }

    if (pathname === '/file-meta' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const targetPath = _normalizeFolderPath(url.searchParams.get('path') || '');
      const entry = await _resolveEntryHandle(provider, targetPath);
      if (!entry) throw new Error(`ファイルまたはフォルダが見つかりません: ${targetPath}`);
      if (entry.kind === 'directory') {
        const directoryStats = typeof provider.statPath === 'function'
          ? await provider.statPath(targetPath).catch(() => null)
          : null;
        return {
          created: directoryStats?.created || directoryStats?.modified || '',
          modified: directoryStats?.modified || '',
          kind: 'folder',
        };
      }
      const stats = await _fileStats(entry.handle);
      return {
        created: stats.modified,
        modified: stats.modified,
        size: stats.size,
        kind: 'file',
      };
    }

    if (pathname === '/folder-links' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      let folderPath = _normalizeFolderPath(url.searchParams.get('folder') || '');
      const folderId = String(url.searchParams.get('folder_id') || '').trim();
      if (!folderPath && folderId) folderPath = await _findPathByFileId(provider, folderId);
      const result = [];
      for (const link of (await _folderLinksForProvider(provider)).filter((row) => (folderId ? row.folder_id === folderId : row.folder_path === folderPath))) {
        result.push({
          file_id: link.file_id,
          path: link.path,
          name: _displayLabelForPath(link.path, ''),
          exists: !!(await _resolveEntryHandle(provider, link.path)),
          linked: true,
          link_folder_path: link.folder_path || folderPath,
        });
      }
      return result;
    }

    const folderLinkRoute = internals._handleFolderLinkBatchRoute;
    const folderLinkBatchResult = typeof folderLinkRoute === 'function'
      ? await folderLinkRoute(pathname, method, body) : undefined;
    if (folderLinkBatchResult !== undefined) return folderLinkBatchResult;

    if (pathname === '/folder-links/add' && method === 'POST') {
      const filePath = _normalizeFolderPath(body?.file_path || '');
      if (typeof folderLinkRoute !== 'function') throw new Error('フォルダリンク一括処理を利用できません');
      const batch = await folderLinkRoute('/folder-links/batch/add', 'POST', {
        ...body,
        items: [{ file_path: filePath }],
        request_id: String(body?.request_id || `single-add-${Date.now()}-${Math.random()}`),
      });
      const row = batch.results[0];
      if (row?.status === 'failed') throw new Error(row.error || 'リンク登録に失敗しました');
      return { ok: true, file_id: row.file_id, folder_path: row.folder_path, folder_id: row.folder_id, created: row.status === 'created' };
    }

    if (pathname === '/folder-links/remove' && method === 'POST') {
      const fileId = String(body?.file_id || '').trim();
      if (typeof folderLinkRoute !== 'function') throw new Error('フォルダリンク一括処理を利用できません');
      const batch = await folderLinkRoute('/folder-links/batch/remove', 'POST', {
        ...body,
        items: [{ file_id: fileId, file_path: _normalizeFolderPath(body?.file_path || '') }],
        request_id: String(body?.request_id || `single-remove-${Date.now()}-${Math.random()}`),
      });
      const row = batch.results[0];
      if (row?.status === 'failed') throw new Error(row.error || 'リンク解除に失敗しました');
      return { ok: true, removed: row.status === 'removed' };
    }

    if (pathname === '/file-folders' && method === 'GET') {
      const filePath = _normalizeFolderPath(url.searchParams.get('path') || '');
      const result = [];
      const physical = _dirname(filePath);
      if (physical) result.push({ folder: physical, type: 'physical' });
      const fileId = filePath ? _fnvFileId(filePath) : '';
      const provider = await _requirePwaProvider('read');
      (await _folderLinksForProvider(provider)).filter((link) => link.file_id === fileId).forEach((link) => {
        result.push({ folder: link.folder_path, type: 'link', file_id: fileId, added_at: link.added_at || '' });
      });
      return result;
    }

    if (pathname === '/backlinks' && method === 'GET' && url.searchParams.get('target')) {
      const provider = await _requirePwaProvider('read');
      return _queryBacklinks(provider, url.searchParams.get('target') || '');
    }

    if (pathname === '/backlinks/rebuild' && method === 'POST') return { ok: true, mode: 'live-scan' };
    if (pathname === '/backlinks/update' && method === 'POST') {
      const normalizedPath = _normalizeFolderPath(body?.path || '');
      if (!normalizedPath) return { ok: false, error: 'path required' };
      return { ok: true, path: normalizedPath };
    }

    if (pathname === '/references/delete-impact' && method === 'POST') {
      // ファイル参照整合性・削除警告・全ファイルバックリンク実装計画 Phase 4:
      // 削除確認ダイアログの被参照警告(gb-delete-impact-warning.js)向け。
      // Desktop側 /api/references/delete-impact の Cloud（Dropbox直結）等価。
      const provider = await _requirePwaProvider('read');
      const items = Array.isArray(body?.items) ? body.items : [];
      const gate = window.MeldexCloudDeleteConfirmation;
      if (!gate?.prepareProviderDelete) {
        const error = new Error('削除確認の永続ストレージを利用できません');
        error.status = 503;
        throw error;
      }
      return gate.prepareProviderDelete({
        provider, items, operation: body?.operation,
        queryImpact: (currentProvider, currentItems) => _queryDeleteImpact(currentProvider, currentItems),
      });
    }

    if (pathname === '/annotations' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const targetPath = _normalizeFolderPath(url.searchParams.get('target') || '');
      const targetId = String(url.searchParams.get('target_id') || '').trim();
      const annId = String(url.searchParams.get('ann_id') || '').trim();
      const user = String(url.searchParams.get('user') || '').trim();
      const annType = String(url.searchParams.get('ann_type') || '').trim();
      const limitValue = Number(url.searchParams.get('limit') || 200);
      const limit = Number.isFinite(limitValue) ? Math.floor(limitValue) : 200;
      let rows = (await _listAnnotationRecords(provider, {
        annId, targetId, targetPath, user, annType, limit, bulk: true,
      })).map(_annotationRow);
      if (annId) rows = rows.filter(row => String(row.id || '') === annId);
      else if (targetId) rows = rows.filter(row => String(row.target_id || '') === targetId);
      else if (targetPath) rows = rows.filter(row => _normalizeFolderPath(row.target_path || '') === targetPath);
      if (user) rows = rows.filter(row => String(row.user || '') === user);
      if (annType) rows = rows.filter(row => String(row.type || '') === annType);
      rows.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
      return limit > 0 ? rows.slice(0, limit) : rows;
    }
    if (pathname === '/annotations' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const now = _nowIso();
      const record = _mergeAnnotationRecord(null, body || {}, { id: _randomId('ann'), now });
      await _writeAnnotationRecord(provider, record);
      return { ok: true, id: record.id, created: record.created };
    }
    if (pathname === '/annotations/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const id = body?.id ? _safeId(body.id, 'annotation id') : _randomId('ann');
      const existing = await _readAnnotationRecord(provider, id, body?.target_path || '');
      const record = _mergeAnnotationRecord(existing, { ...(body || {}), id }, { id, now: _nowIso() });
      if (body?.created) {
        record.created = body.created;
        record.created_at = body.created_at || body.created;
      }
      if (body?.modified) {
        record.modified = body.modified;
        record.modified_at = body.modified_at || body.modified;
      }
      await _writeAnnotationRecord(provider, record);
      return { ok: true, id: record.id };
    }
    if (pathname === '/annotations/orphan-by-target' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const now = _nowIso();
      const targetFileName = _basename(body?.target_file || '');
      const cascade = !!body?.cascade_container;
      let directCount = 0;
      let cascadeCount = 0;
      const records = await _listAnnotationRecords(provider);
      for (const record of records) {
        const matchedWithoutCascade = _annotationMatchesOrphan(record, body || {}, false);
        const matchedWithCascade = !matchedWithoutCascade && _annotationMatchesOrphan(record, body || {}, cascade);
        if (!matchedWithoutCascade && !matchedWithCascade) continue;
        record.orphan = 1;
        record.orphaned_at = now;
        record.target_file_name = targetFileName;
        if (body?.target_snapshot && !record.target_snapshot) record.target_snapshot = body.target_snapshot;
        record.modified = now;
        record.modified_at = now;
        if (matchedWithoutCascade) directCount += 1;
        else cascadeCount += 1;
        await _writeAnnotationRecord(provider, record);
      }
      return { ok: true, orphaned: directCount, cascade_orphaned: cascadeCount };
    }
    if (pathname === '/annotation/screenshot' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const imageAftercare = window.MeldexCreatedImageIdentityAftercare;
      if (!imageAftercare?.prepare || !imageAftercare?.record
          || !imageAftercare?.cancel || !imageAftercare?.drainPrepared) {
        throw new Error('Cloud画像identity aftercareが読み込まれていません');
      }
      const drainedIdentity = await imageAftercare.drainPrepared(provider);
      const dataUrl = String(body?.data || '');
      if (!dataUrl) throw new Error('data は必須です');
      const ts = _versionTimestamp();
      const configuredFolder = String(body?.target_path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const targetPath = _joinPath(configuredFolder || 'スクリーンショット', `screenshot_${ts}.png`);
      const screenshotBytes = _decodeUploadData(dataUrl);
      const prepared = await imageAftercare.prepare(provider, targetPath, screenshotBytes, {
        source: 'annotation-screenshot', filename: _basename(targetPath),
      });
      if (prepared.publish_required) {
        try {
          await _writeBytes(provider, targetPath, screenshotBytes);
        } catch (error) {
          await imageAftercare.cancel(provider, prepared, error?.message).catch(console.warn);
          throw error;
        }
      }
      const identity = await imageAftercare.record(
        provider, targetPath, screenshotBytes, { source: 'annotation-screenshot', prepared },
      );
      return {
        ok: true, path: targetPath,
        aftercare_pending: !!identity.aftercare_pending || drainedIdentity.blocked > 0,
      };
    }
    if (/^\/annotations\/[^/]+$/.test(pathname) && method === 'PUT') {
      const provider = await _requirePwaProvider('readwrite');
      const id = _safeId(pathname.split('/').pop(), 'annotation id');
      const existing = await _readAnnotationRecord(provider, id);
      if (!existing) throw new Error('注釈が見つかりません');
      const updateBody = {};
      ANNOTATION_UPDATE_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(body || {}, key)) updateBody[key] = body[key];
      });
      const record = _mergeAnnotationRecord(existing, updateBody, { id, now: _nowIso() });
      await _writeAnnotationRecord(provider, record);
      return { ok: true };
    }
    if (/^\/annotations\/[^/]+$/.test(pathname) && method === 'DELETE') {
      const provider = await _requirePwaProvider('readwrite');
      const id = _safeId(pathname.split('/').pop(), 'annotation id');
      await _deleteAnnotationRecordFully(provider, id);
      return { ok: true };
    }

    if (pathname === '/view-lock' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const viewKey = String(url.searchParams.get('view_key') || '').trim();
      if (!viewKey) throw new Error('view_key required');
      return _readViewLockRecord(provider, viewKey);
    }
    if (pathname === '/view-lock' && method === 'PUT') {
      const provider = await _requirePwaProvider('readwrite');
      const viewKey = String(body?.view_key || '').trim();
      if (!viewKey) throw new Error('view_key required');
      const locked = _annotationFlag(body?.locked);
      const entry = {
        view_key: viewKey,
        target_path: _normalizeFolderPath(body?.target_path || ''),
        pane_id: String(body?.pane_id || ''),
        target_kind: String(body?.target_kind || ''),
        locked,
        state: body?.state && typeof body.state === 'object' ? body.state : {},
        locked_at: locked ? _nowIso() : '',
        locked_by: String(body?.locked_by || ''),
      };
      await _writeViewLockRecord(provider, viewKey, entry);
      return { ok: true, view_key: viewKey, locked };
    }

    if (/^\/version\/(list-db|read-db|save-db|restore-db)/.test(pathname)) return _phaseUnsupported('シート履歴', 'Phase 4');
    if (pathname === '/version/list-folder' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _listFolderVersions(provider, url.searchParams.get('path') || '');
    }
    if (pathname === '/version/read-folder' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _readFolderVersion(provider, url.searchParams.get('path') || '', url.searchParams.get('version') || '');
    }
    if (pathname === '/version/read-folder-file' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _readFolderVersionFile(provider, url.searchParams.get('path') || '', url.searchParams.get('version') || '', url.searchParams.get('file') || '');
    }
    if (pathname === '/version/save-folder' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _saveFolderVersion(provider, body?.path || '', { label: body?.label || '', auto: !!body?.auto });
    }
    if (pathname === '/version/restore-folder' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _restoreFolderVersion(provider, body?.path || '', body?.version || '');
    }
    if (pathname === '/version/delete-folder' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _deleteFolderVersion(provider, body?.path || '', body?.version || '');
    }
    if (pathname === '/version/undelete-folder' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _undeleteFolderVersion(provider, body?.path || '', body?.token || '');
    }
    if (pathname === '/version/list' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _listFileVersions(provider, url.searchParams.get('path') || '');
    }
    if (pathname === '/version/read' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      return _readFileVersion(provider, url.searchParams.get('path') || '', url.searchParams.get('version') || '');
    }
    if (pathname === '/version/save' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _saveFileVersion(provider, body?.path || '', { label: body?.label || '', auto: !!body?.auto, max_auto: body?.max_auto });
    }
    if (pathname === '/version/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _restoreFileVersion(provider, body?.path || '', body?.version || '');
    }
    if (pathname === '/version/delete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _deleteFileVersion(provider, body?.path || '', body?.version || '');
    }
    if (pathname === '/version/undelete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _undeleteFileVersion(provider, body?.path || '', body?.token || '');
    }

    if (/^\/cal(\/|$)/.test(pathname)) {
      if (method === 'GET') {
        if (pathname === '/cal/sync/status') return { enabled: false, configured: false, unsupported: true };
        return [];
      }
      return _phaseUnsupported('カレンダー', 'Phase 3');
    }
    if (/^\/calendar-db(\/|$)/.test(pathname)) {
      if (method === 'GET') return [];
      return _phaseUnsupported('カレンダー', 'Phase 3');
    }
    if (/^\/chat\/(list|search)/.test(pathname) && method === 'GET') return [];
    if (pathname === '/chat/load' && method === 'GET') return { messages: [], title: '', unsupported: true };
    if (pathname === '/chat/save' && method === 'POST') return _phaseUnsupported('チャット', 'Phase 3');
    if (pathname === '/chat/stream' && method === 'POST') return _phaseUnsupported('チャット', 'Phase 3');
    if (/^\/collab\/(rooms|messages)/.test(pathname) && method === 'GET') return [];
    if (/^\/collab\//.test(pathname)) return _phaseUnsupported('チャット', 'Phase 3');

    if (pathname === '/outliner/add' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const parent = _normalizeFolderPath(body?.parent || '');
      const label = _validateItemName(body?.label || '無題', 'label');
      const type = String(body?.type || '');
      const blockedCreate = {
        database: ['シート', 'Phase 4'],
        calendar: ['カレンダー', 'Phase 3'],
        'smart-db': ['スマートシート', 'Phase 4'],
      }[type];
      if (blockedCreate) throw new Error(_phaseUnsupported(blockedCreate[0], blockedCreate[1]).error);
      if (type === 'folder') {
        const labelName = await _uniqueName(provider, parent, label, '');
        const targetPath = _joinPath(parent, labelName);
        await _directoryHandle(provider, targetPath, true);
        return { ok: true, node: { type: 'folder', label: labelName, path: targetPath, children: [] } };
      }
      if (type === 'page') {
        const labelName = await _uniqueName(provider, parent, label, '.md');
        const targetPath = _joinPath(parent, labelName + '.md');
        await provider.writeText(targetPath, `# ${labelName}\n\n`);
        return { ok: true, node: { type: 'page', label: labelName, path: targetPath } };
      }
      if (type === 'database') {
        const labelName = await _uniqueName(provider, parent, label, '');
        const targetPath = _joinPath(parent, labelName);
        await _directoryHandle(provider, targetPath, true);
        await provider.writeText(_joinPath(targetPath, labelName + '.md'), `# ${labelName}\n\n`);
        return { ok: true, node: { type: _phase1SurfaceType('database', 'directory'), label: labelName, path: targetPath } };
      }
      if (type === 'scriptnote') {
        const labelName = await _uniqueName(provider, parent, label, '.scriptnote.json');
        const targetPath = _joinPath(parent, labelName + '.scriptnote.json');
        await provider.writeJson(targetPath, {
          fileType: 'meldex-scriptnote',
          schema_version: 3,
          version: 1,
          title: labelName,
          layoutMode: 'manga',
          editor: { viewMode: 'horizontal', wrapMode: true, textWidth: 20, lineHeight: 1.5, letterSpacing: 0.02, fontH: '', fontV: '', colors: null },
          scenarioTypes: [],
          characters: [],
          characterDb: [],
          notes: [],
          rows: [],
          source: { importedFrom: '', modeName: 'マンガ縦書き' },
        });
        return { ok: true, node: { type: 'scriptnote', label: labelName, path: targetPath } };
      }
      if (type === 'board') {
        const labelName = await _uniqueName(provider, parent, label, '.mel-board');
        const targetPath = _joinPath(parent, labelName + '.mel-board');
        let boardContent = `---\ntype: board\nxmind:\n  n0: {autoStyle: true}\n---\n# ${labelName}\n\n`;
        if (window.MeldexDocumentIdentity) boardContent = window.MeldexDocumentIdentity.ensureDocumentId(boardContent, 'board').text;
        await provider.writeText(targetPath, boardContent);
        return { ok: true, node: { type: _phase1SurfaceType('board', 'file'), label: labelName, path: targetPath } };
      }
      if (type === 'calendar') {
        const labelName = await _uniqueName(provider, parent, label, '');
        const targetPath = _joinPath(parent, labelName);
        await _directoryHandle(provider, targetPath, true);
        await provider.writeText(_joinPath(targetPath, labelName + '.md'), `---\ntype: calendar-db\n---\n# ${labelName}\n\n`);
        return { ok: true, node: { type: _phase1SurfaceType('calendar', 'directory'), label: labelName, path: targetPath } };
      }
      if (type === 'smart-db') {
