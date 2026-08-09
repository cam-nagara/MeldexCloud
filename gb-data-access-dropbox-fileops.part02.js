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
          items.push({ ...item, linked: true, exists: true });
          continue;
        }
        if (foldersOnly) continue;
        if (item) items.push({ ...item, linked: true });
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
      const docIdentityFmt = window.MeldexDocumentIdentity?.formatForPath?.(filePath);
      if (docIdentityFmt) {
        let existingDocumentId = '';
        if (entry) {
          const currentContent = await provider.readText(filePath);
          existingDocumentId = String(
            window.MeldexDocumentIdentity?.readDocumentId?.(currentContent, docIdentityFmt)
            || '',
          );
        }
        content = window.MeldexDocumentIdentity.ensureDocumentIdForOverwrite(
          content,
          docIdentityFmt,
          existingDocumentId,
        ).text;
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
      await _writeBytes(provider, targetPath, uploadBytes);
      return { ok: true, path: targetPath, name: targetName };
    }

    if (pathname === '/file-meta' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const targetPath = _normalizeFolderPath(url.searchParams.get('path') || '');
      const entry = await _resolveEntryHandle(provider, targetPath);
      if (!entry || entry.kind !== 'file') throw new Error(`ファイルが見つかりません: ${targetPath}`);
      const stats = await _fileStats(entry.handle);
      return {
        created: stats.modified,
        modified: stats.modified,
        size: stats.size,
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
        });
      }
      return result;
    }

    if (pathname === '/folder-links/add' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const filePath = _normalizeFolderPath(body?.file_path || '');
      let folderPath = _normalizeFolderPath(body?.folder_path || '');
      let folderId = String(body?.folder_id || '').trim();
      if (!filePath || (!folderPath && !folderId)) throw new Error('file_path と folder_path/folder_id は必須です');
      if (!folderPath && folderId) folderPath = await _findPathByFileId(provider, folderId);
      const folderEntry = await _resolveEntryHandle(provider, folderPath);
      const fileEntry = await _resolveEntryHandle(provider, filePath);
      if (!fileEntry) throw new Error('ファイル/フォルダが見つかりません');
      if (!folderEntry || folderEntry.kind !== 'directory') throw new Error('フォルダが見つかりません');
      const fileId = _fnvFileId(filePath);
      folderId = folderId || _fnvFileId(folderPath);
      const links = await _folderLinksForProvider(provider);
      let created = false;
      if (!links.some((link) => link.file_id === fileId && (folderId ? link.folder_id === folderId : link.folder_path === folderPath))) {
        links.push({
          file_id: fileId,
          path: filePath,
          name: _displayLabelForPath(filePath, ''),
          folder_path: folderPath,
          folder_id: folderId,
          added_at: new Date().toISOString(),
        });
        await _writeFolderLinksForProvider(provider, links);
        created = true;
      }
      return { ok: true, file_id: fileId, created };
    }

    if (pathname === '/folder-links/remove' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const fileId = String(body?.file_id || '').trim();
      const folderPath = _normalizeFolderPath(body?.folder_path || '');
      const folderId = String(body?.folder_id || '').trim();
      if (!fileId || (!folderPath && !folderId)) throw new Error('file_id と folder_path/folder_id は必須です');
      const links = await _folderLinksForProvider(provider);
      const nextLinks = links.filter((link) => !(link.file_id === fileId && (folderId ? link.folder_id === folderId : link.folder_path === folderPath)));
      await _writeFolderLinksForProvider(provider, nextLinks);
      return { ok: true, removed: nextLinks.length !== links.length };
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
      return _queryDeleteImpact(provider, items);
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
      let rows = (await _listAnnotationRecords(provider)).map(_annotationRow);
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
      const dataUrl = String(body?.data || '');
      if (!dataUrl) throw new Error('data は必須です');
      const ts = _versionTimestamp();
      const configuredFolder = String(body?.target_path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const targetPath = _joinPath(configuredFolder || 'スクリーンショット', `screenshot_${ts}.png`);
      await _writeBytes(provider, targetPath, _decodeUploadData(dataUrl));
      return { ok: true, path: targetPath };
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
        const labelName = await _uniqueName(provider, parent, label, '.json');
        const targetPath = _joinPath(parent, labelName + '.json');
        await provider.writeJson(targetPath, {
          type: 'smart-db',
          name: labelName,
          filters: [{ property: 'ステータス', field: 'value', operator: 'equals', value: '進行中' }],
          views: { table: {} },
          activeView: 'table',
          created: new Date().toISOString(),
        });
        return { ok: true, node: { type: _phase1SurfaceType('smart-db', 'file'), label: labelName, path: targetPath } };
      }
      throw new Error(`不正なタイプ: ${type}`);
    }

    if (pathname === '/outliner/rename' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const oldPath = _normalizeFolderPath(body?.old_path || '');
      _rejectProductionStructureMutation(oldPath, '名前変更');
      if (window.MeldexProductionSchemaMigration?.isManagedEntryPath?.(oldPath)) {
        throw new Error('制作管理の管理リスト名はシート上のエントリ名から変更してください');
      }
      const newName = _validateItemName(body?.new_name || '', 'new_name');
      const source = await _resolveEntryHandle(provider, oldPath);
      if (!source) throw new Error(`見つかりません: ${oldPath}`);
      const parentPath = _dirname(oldPath);
      const sourceName = _basename(oldPath);
      if (source.kind === 'directory') {
        const newPath = _joinPath(parentPath, newName);
        if (newPath !== oldPath && await _pathExists(provider, newPath)) throw new Error(`既に存在: ${newName}`);
        const warnings = [];
        if (newPath !== oldPath) {
          await _moveEntry(provider, oldPath, newPath);
          await _runPostMutationStep(warnings, 'version-history', () => _relocateVersionHistory(provider, oldPath, newPath, true));
          await _runPostMutationStep(warnings, 'csv-sidecars', () => (
            _relocateCsvSidecars(provider, oldPath, newPath, true, false)
          ));
        }
        const oldNotePath = _joinPath(newPath, sourceName + '.md');
        const newNotePath = _joinPath(newPath, newName + '.md');
        if (await _pathExists(provider, oldNotePath) && !await _pathExists(provider, newNotePath)) {
          await _moveEntry(provider, oldNotePath, newNotePath);
          await _runPostMutationStep(warnings, 'folder-note-version-history', () => _relocateVersionHistory(provider, _joinPath(oldPath, sourceName + '.md'), newNotePath, false));
        }
        await _runPostMutationStep(warnings, 'stored-paths', () => (
          typeof _rewriteStoredPathsForProvider === 'function'
            ? _rewriteStoredPathsForProvider(provider, oldPath, newPath, true)
            : Promise.resolve(_rewriteStoredPaths(oldPath, newPath, true))
        ));
        await _runPathMutationHooksSafe({ action: 'rename', oldPath, newPath, isFolder: true }, warnings);
        await _runPostMutationStep(warnings, 'annotations', () => _updateAnnotationsForPathMutation(provider, { action: 'rename', oldPath, newPath, isFolder: true }));
        let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
        await _runPostMutationStep(warnings, 'references', async () => {
          relocate = await _relocateReferences(provider, oldPath, newPath, true);
        });
        return { ok: true, new_path: newPath, file_id: _fnvFileId(newPath), relocate, ..._resultWarnings(warnings) };
      }
      const split = _splitNameAndExt(sourceName);
      const nextPath = _joinPath(parentPath, newName + split.ext);
      if (nextPath !== oldPath && await _pathExists(provider, nextPath)) throw new Error(`既に存在: ${newName + split.ext}`);
      if (split.ext === '.md' && String(body?.type || '') === 'page') {
        const original = await provider.readText(oldPath);
        await provider.writeText(oldPath, original.replace(/^# .+/m, '# ' + newName));
      }
      if (nextPath !== oldPath) {
        await _moveEntry(provider, oldPath, nextPath);
      }
      const warnings = [];
      await _runPostMutationStep(warnings, 'version-history', () => _relocateVersionHistory(provider, oldPath, nextPath, false));
      await _runPostMutationStep(warnings, 'csv-sidecar', () => (
        _relocateCsvSidecars(provider, oldPath, nextPath, false, false)
      ));
      await _runPostMutationStep(warnings, 'stored-paths', () => (
        typeof _rewriteStoredPathsForProvider === 'function'
          ? _rewriteStoredPathsForProvider(provider, oldPath, nextPath, false)
          : Promise.resolve(_rewriteStoredPaths(oldPath, nextPath, false))
      ));
      await _runPathMutationHooksSafe({ action: 'rename', oldPath, newPath: nextPath, isFolder: false }, warnings);
      await _runPostMutationStep(warnings, 'annotations', () => _updateAnnotationsForPathMutation(provider, { action: 'rename', oldPath, newPath: nextPath, isFolder: false }));
      let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
      await _runPostMutationStep(warnings, 'references', async () => {
        relocate = await _relocateReferences(provider, oldPath, nextPath, false);
      });
      return { ok: true, new_path: nextPath, file_id: _fnvFileId(nextPath), relocate, ..._resultWarnings(warnings) };
    }

    if (pathname === '/outliner/delete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      return _deleteOutlinerPathToTrash(provider, body?.path || '');
    }

    if (pathname === '/outliner/delete-batch' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const items = Array.isArray(body?.items) ? body.items : [];
      const results = [];
      for (const item of items) {
        try {
          results.push({ ok: true, value: await _deleteOutlinerPathToTrash(provider, item?.path || '') });
        } catch (error) {
          results.push({ ok: false, error: error?.message || String(error) });
        }
      }
      return { ok: true, results };
    }

    if (pathname === '/outliner/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const trashName = _validateItemName(body?.trash_name || '', 'trash_name');
      const trashRoot = await _resolveAllowedTrashRoot(body?.trash_root);
      const trashPath = _joinPath(trashRoot.path, trashName);
      const metaPath = trashPath + '._trash_meta.json';
      const source = await _resolveEntryHandle(provider, trashPath);
      if (!source) throw new Error(`ゴミ箱にありません: ${trashName}`);
      const meta = await _readJsonSafe(provider, metaPath, {});
      const originalPath = await _resolveValidatedTrashRestorePath(trashRoot, meta?.original_path || '');
      if (await _pathExists(provider, originalPath)) throw new Error(`復元先に既にファイルが存在: ${originalPath}`);
      await _moveEntry(provider, trashPath, originalPath);
      const warnings = [];
      const sidecarTrashPath = _normalizeFolderPath(meta?.csv_sidecar_trash_path || '');
      if (sidecarTrashPath && await _pathExists(provider, sidecarTrashPath)) {
        await _runPostMutationStep(warnings, 'csv-sidecar', async () => {
          const sidecarPath = _csvMetadataPath(originalPath);
          await _directoryHandle(provider, _dirname(sidecarPath), true);
          await _moveEntry(provider, sidecarTrashPath, sidecarPath);
          await _rewriteCsvSidecarSource(provider, sidecarPath, originalPath);
        });
      }
      await _runPathMutationHooksSafe({
        action: 'restore', oldPath: trashPath, newPath: originalPath,
        isFolder: source.kind === 'directory',
      }, warnings);
      await _runPostMutationStep(warnings, 'trash-metadata', async () => {
        if (await _pathExists(provider, metaPath)) await _removeEntry(provider, metaPath);
      });
      return { ok: true, restored_path: originalPath, trash_root: trashRoot.path, ..._resultWarnings(warnings) };
    }

    if (pathname === '/outliner/duplicate' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, sourcePath);
      if (!source) throw new Error(`見つかりません: ${sourcePath}`);
      const sourceName = _basename(sourcePath);
      const sourceSplit = _splitNameAndExt(sourceName);
      let destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${sourceSplit.ext}` : `${sourceName}_copy`;
      let destPath = _joinPath(_dirname(sourcePath), destName);
      for (let counter = 2; await _pathExists(provider, destPath); counter += 1) {
        destName = source.kind === 'file' ? `${sourceSplit.stem}_copy${counter}${sourceSplit.ext}` : `${sourceName}_copy${counter}`;
        destPath = _joinPath(_dirname(sourcePath), destName);
      }
      const destDirHandle = await _directoryHandle(provider, _dirname(destPath), true);
      await _copyEntryHandle(source.handle, destDirHandle, _basename(destPath));
      await _regenerateDocumentIdForCopiedEntry(provider, destPath, source.kind === 'file');
      const warnings = [];
      await _runPostMutationStep(warnings, 'csv-sidecars', () => (
        _relocateCsvSidecars(provider, sourcePath, destPath, source.kind === 'directory', true)
      ));
      await _runPathMutationHooksSafe({
        action: 'copy', oldPath: sourcePath, newPath: destPath,
        isFolder: source.kind === 'directory',
      }, warnings);
      return { ok: true, new_path: destPath, new_name: destName, ..._resultWarnings(warnings) };
    }

    if (pathname === '/outliner/save-as' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, sourcePath);
      if (!source) throw new Error(`見つかりません: ${sourcePath}`);
      const sourceName = _basename(sourcePath);
      const sourceSplit = _splitNameAndExt(sourceName);
      let newName = String(body?.new_name || (source.kind === 'file' ? sourceSplit.stem : sourceName)).replace(/[\\/]/g, '').replace(/\.\./g, '').trim();
      newName = _validateItemName(newName, 'new_name');
      const destFolder = _normalizeFolderPath(body?.dest_folder || _dirname(sourcePath));
      let destName = source.kind === 'file' ? newName + sourceSplit.ext : newName;
      let destPath = _joinPath(destFolder, destName);
      for (let counter = 2; await _pathExists(provider, destPath); counter += 1) {
        destName = source.kind === 'file' ? `${newName}_${counter}${sourceSplit.ext}` : `${newName}_${counter}`;
        destPath = _joinPath(destFolder, destName);
      }
      const destDirHandle = await _directoryHandle(provider, destFolder, true);
      await _copyEntryHandle(source.handle, destDirHandle, _basename(destPath));
      await _regenerateDocumentIdForCopiedEntry(provider, destPath, source.kind === 'file');
      const warnings = [];
      await _runPostMutationStep(warnings, 'csv-sidecars', () => (
        _relocateCsvSidecars(provider, sourcePath, destPath, source.kind === 'directory', true)
      ));
      await _runPathMutationHooksSafe({
        action: 'copy', oldPath: sourcePath, newPath: destPath,
        isFolder: source.kind === 'directory',
      }, warnings);
      return {
        ok: true,
        new_path: destPath,
        new_name: source.kind === 'file' ? _splitNameAndExt(destName).stem : destName,
        ..._resultWarnings(warnings),
      };
    }

    if (pathname === '/outliner/move' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const destFolder = _normalizeFolderPath(body?.dest_folder || '');
      _rejectProductionStructureMutation(sourcePath, '移動');
      if (window.MeldexProductionSchemaMigration?.isManagedEntryPath?.(sourcePath)) {
        throw new Error('制作管理の管理リストエントリの配置は変更できません');
      }
      const source = await _resolveEntryHandle(provider, sourcePath);
      const destEntry = await _resolveEntryHandle(provider, destFolder);
      if (!source) throw new Error('見つかりません');
      if (!destEntry || destEntry.kind !== 'directory') throw new Error(`移動先フォルダが見つかりません: ${destFolder}`);
      if (source.kind === 'directory' && (destFolder === sourcePath || destFolder.startsWith(sourcePath + '/'))) throw new Error('フォルダ自身の中には移動できません');
      if (destFolder === _dirname(sourcePath)) {
        return {
          ok: true,
          unchanged: true,
          new_path: sourcePath,
          new_name: source.kind === 'file' ? _splitNameAndExt(_basename(sourcePath)).stem : _basename(sourcePath),
          file_id: _fnvFileId(sourcePath),
          relocate: { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false },
        };
      }
      const conflict = await _moveConflictName(provider, destFolder, _basename(sourcePath), source.kind === 'file');
      await _moveEntry(provider, sourcePath, conflict.path);
      const warnings = [];
      await _runPostMutationStep(warnings, 'version-history', () => _relocateVersionHistory(provider, sourcePath, conflict.path, source.kind === 'directory'));
      await _runPostMutationStep(warnings, 'csv-sidecars', () => (
        _relocateCsvSidecars(provider, sourcePath, conflict.path, source.kind === 'directory', false)
      ));
      await _runPostMutationStep(warnings, 'stored-paths', () => (
        typeof _rewriteStoredPathsForProvider === 'function'
          ? _rewriteStoredPathsForProvider(provider, sourcePath, conflict.path, source.kind === 'directory')
          : Promise.resolve(_rewriteStoredPaths(sourcePath, conflict.path, source.kind === 'directory'))
      ));
      await _runPathMutationHooksSafe({ action: 'move', oldPath: sourcePath, newPath: conflict.path, isFolder: source.kind === 'directory' }, warnings);
      await _runPostMutationStep(warnings, 'annotations', () => _updateAnnotationsForPathMutation(provider, { action: 'move', oldPath: sourcePath, newPath: conflict.path, isFolder: source.kind === 'directory' }));
      let relocate = { rewritten_count: 0, failed_count: 0, rewritten_paths: [], truncated: false };
      await _runPostMutationStep(warnings, 'references', async () => {
        relocate = await _relocateReferences(provider, sourcePath, conflict.path, source.kind === 'directory');
      });
      return {
        ok: true,
        new_path: conflict.path,
        new_name: source.kind === 'file' ? _splitNameAndExt(_basename(conflict.path)).stem : _basename(conflict.path),
        file_id: _fnvFileId(conflict.path),
        relocate,
        ..._resultWarnings(warnings),
      };
    }
