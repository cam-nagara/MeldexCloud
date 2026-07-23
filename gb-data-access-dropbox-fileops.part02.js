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
      if (!entry) return { type: 'unknown' };
      if (entry.kind === 'directory') return { type: await _classifyDirectoryType(provider, targetPath) };
      return { type: (await _classifyFileType(provider, targetPath, {})) || 'unknown' };
    }

    if (pathname === '/images-in-folder' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const targetPath = _normalizeFolderPath(url.searchParams.get('path') || '');
      const entries = await _listDirectoryEntries(provider, targetPath);
      const items = [];
      for (const entry of entries) {
        if (entry.handle.kind !== 'file') continue;
        const ext = _splitNameAndExt(entry.name).ext.toLowerCase();
        if (!IMAGE_EXTS.has(ext)) continue;
        const itemPath = entry.path || _joinPath(targetPath, entry.name);
        const stats = await _fileStats(entry.handle);
        items.push({ name: entry.name, path: itemPath, size: stats.size, modified: stats.modified });
      }
      return items;
    }

    if (pathname === '/file' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const filePath = _normalizeFolderPath(url.searchParams.get('path') || '');
      if (!filePath) throw new Error('path は必須です');
      if (!_isTextLikePath(filePath)) throw new Error('Binary file cannot be read as text');
      const entry = await _resolveEntryHandle(provider, filePath);
      if (!entry || entry.kind !== 'file') throw new Error(`ファイルが見つかりません: ${filePath}`);
      return { path: filePath, content: await provider.readText(filePath), etag: await _fileEtag(provider, filePath, entry) };
    }

    if (pathname === '/file' && (method === 'PUT' || method === 'POST')) {
      const provider = await _requirePwaProvider('readwrite');
      const filePath = _normalizeFolderPath(url.searchParams.get('path') || '');
      if (!filePath) throw new Error('path は必須です');
      if (_isProductionFolderNotePath(filePath)) {
        throw new Error('制作管理の列定義ファイルは汎用ファイル保存から変更できません');
      }
      const content = String(body?.content ?? '');
      _rejectProductionLegacyEntryContent(filePath, content);
      const skipIfMissing = !!(body?.skip_if_missing || body?.skipIfMissing);
      const forceOverwrite = !!(body?.force_overwrite || body?.forceOverwrite);
      const createOnly = !!(body?.create_only || body?.createOnly);
      const expectedEtag = String(body?.if_match_etag || body?.ifMatchEtag || '').trim();
      const entry = await _resolveEntryHandle(provider, filePath);
      if (!entry && skipIfMissing) return { ok: true, skipped: true, missing: true, etag: '' };
      if (entry?.kind === 'directory') throw new Error(`フォルダはファイルとして保存できません: ${filePath}`);
      if ((createOnly && entry) || (expectedEtag && !entry && !forceOverwrite)) {
        _throwEtagConflict(filePath, expectedEtag, entry ? await _fileEtag(provider, filePath, entry) : '');
      }
      if (expectedEtag && entry && !forceOverwrite) {
        const currentEtag = await _fileEtag(provider, filePath, entry);
        if (!currentEtag || currentEtag !== expectedEtag) _throwEtagConflict(filePath, expectedEtag, currentEtag);
      }
      if (forceOverwrite && typeof provider.refreshMetadata === 'function') await provider.refreshMetadata(filePath).catch(() => null);
      await _assertNoBoardTypeDowngrade(provider, filePath, content);
      const writeMeta = await provider.writeText(filePath, content);
      return { ok: true, etag: await _fileEtag(provider, filePath, null, writeMeta) };
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
      const existing = await _readAnnotationRecord(provider, id);
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
      const targetPath = _joinPath('_screenshots', `screenshot_${ts}.png`);
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
      await provider.deletePath(_annotationPath(id)).catch(() => {});
      return { ok: true };
    }

    if (pathname === '/view-lock' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const viewKey = String(url.searchParams.get('view_key') || '').trim();
      if (!viewKey) throw new Error('view_key required');
      const entry = await _readJsonSafe(provider, _joinPath(VIEW_LOCK_DIR, _fnvFileId(viewKey) + '.json'), null);
      return entry && typeof entry === 'object'
        ? entry
        : { view_key: viewKey, target_path: '', pane_id: '', target_kind: '', locked: 0, state: {}, locked_at: '', locked_by: '' };
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
      await provider.writeJson(_joinPath(VIEW_LOCK_DIR, _fnvFileId(viewKey) + '.json'), entry);
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
          version: 1,
          title: labelName,
          layoutMode: 'manga',
          editor: { viewMode: 'horizontal', wrapMode: true, textWidth: 20, lineHeight: 1.5, letterSpacing: 0.02, fontH: '', fontV: '', colors: null },
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
        await provider.writeText(targetPath, `---\ntype: board\nxmind:\n  n0: {autoStyle: true}\n---\n# ${labelName}\n\n`);
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
      return { ok: true, new_path: destPath, new_name: destName };
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
      return { ok: true, new_path: destPath, new_name: source.kind === 'file' ? _splitNameAndExt(destName).stem : destName };
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

    if (pathname === '/trash' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const items = [];
      const warnings = [];
      let allowedRoots;
      try {
        allowedRoots = await _allowedTrashRoots();
      } catch (error) {
        allowedRoots = [{ path: _normalizeFolderPath(PWA_TRASH_DIR), name: 'Meldex', physicalPath: '' }];
        warnings.push({
          trash_root: '', trash_root_name: '', stage: 'trash-roots',
          message: error?.message || String(error), code: error?.code || '',
        });
      }
      const rootsByPath = new Map(allowedRoots.map((root) => [root.path, root]));
      const sourceRootsByPhysical = new Map(allowedRoots.filter((root) => (
        window.MeldexSourceFolderRegistry?.parseSourcePath?.(root.path)
      )).map((root) => [String(root.physicalPath || root.path).toLowerCase(), root]));
      const listedPhysicalRoots = new Set();
      for (const trashRoot of allowedRoots) {
        const physicalKey = String(trashRoot.physicalPath || trashRoot.path).toLowerCase();
        if (listedPhysicalRoots.has(physicalKey)) continue;
        try {
          const trashEntry = await _resolveEntryHandle(provider, trashRoot.path);
          if (!trashEntry || trashEntry.kind !== 'directory') {
            listedPhysicalRoots.add(physicalKey);
            continue;
          }
          const entries = await _listDirectoryEntries(provider, trashRoot.path);
          listedPhysicalRoots.add(physicalKey);
          for (const entry of entries) {
            if (entry.name.endsWith('._trash_meta.json')) continue;
            const entryPath = _joinPath(trashRoot.path, entry.name);
            const meta = await _readJsonSafe(provider, entryPath + '._trash_meta.json', {});
            let size = 1;
            if (entry.handle.kind === 'directory') {
              size = await _countFolderEntriesIncludingTrash(provider, entryPath).catch(() => 0);
            }
            const metaHasVirtualSource = window.MeldexSourceFolderRegistry?.parseSourcePath?.(
              meta?.trash_root || meta?.original_path || '',
            );
            const declaredTrashRoot = rootsByPath.get(_normalizeFolderPath(meta?.trash_root || ''));
            const declaredPhysicalKey = String(declaredTrashRoot?.physicalPath || declaredTrashRoot?.path || '').toLowerCase();
            const itemTrashRoot = (declaredTrashRoot && declaredPhysicalKey === physicalKey ? declaredTrashRoot : null)
              || (metaHasVirtualSource ? sourceRootsByPhysical.get(physicalKey) : null)
              || trashRoot;
            items.push({
              name: entry.name,
              type: entry.handle.kind === 'directory' ? 'folder' : 'file',
              size,
              original_path: String(meta?.original_path || ''),
              deleted_at: String(meta?.deleted_at || ''),
              trash_root: itemTrashRoot.path,
              trash_root_name: itemTrashRoot.name,
            });
          }
        } catch (error) {
          warnings.push({
            trash_root: trashRoot.path, trash_root_name: trashRoot.name, stage: 'trash-list',
            message: error?.message || String(error), code: error?.code || '',
          });
        }
      }
      return warnings.length
        ? { items, warnings, partial: true, failed: warnings.length }
        : { items };
    }

    if (pathname === '/trash/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const name = _validateItemName(body?.name || '', 'name');
      const trashRoot = await _resolveAllowedTrashRoot(body?.trash_root);
      const trashPath = _joinPath(trashRoot.path, name);
      const metaPath = trashPath + '._trash_meta.json';
      const source = await _resolveEntryHandle(provider, trashPath);
      if (!source) throw new Error('ゴミ箱に見つかりません');
      const meta = await _readJsonSafe(provider, metaPath, {});
      const baseDest = await _resolveValidatedTrashRestorePath(trashRoot, meta?.original_path || '', name);
      let destPath = baseDest;
      if (await _pathExists(provider, destPath)) {
        const split = _splitNameAndExt(_basename(baseDest));
        const baseDir = _dirname(baseDest);
        for (let counter = 1; await _pathExists(provider, destPath); counter += 1) {
          const stem = source.kind === 'directory' ? _basename(baseDest).replace(/_\d{4}$/, '') : split.stem;
          const nextName = source.kind === 'directory'
            ? `${stem}_restored_${String(counter).padStart(4, '0')}`
            : `${stem}_restored_${String(counter).padStart(4, '0')}${split.ext}`;
          destPath = _joinPath(baseDir, nextName);
        }
      }
      await _moveEntry(provider, trashPath, destPath);
      const warnings = [];
      await _runPostMutationStep(warnings, 'trash-metadata', async () => {
        if (await _pathExists(provider, metaPath)) await _removeEntry(provider, metaPath);
      });
      return { ok: true, restored_to: destPath, trash_root: trashRoot.path, ..._resultWarnings(warnings) };
    }

    if (pathname === '/trash/delete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const name = _validateItemName(body?.name || '', 'name');
      const trashRoot = await _resolveAllowedTrashRoot(body?.trash_root);
      const trashPath = _joinPath(trashRoot.path, name);
      const metaPath = trashPath + '._trash_meta.json';
      if (await _resolveEntryHandle(provider, trashPath)) await _removeEntry(provider, trashPath);
      const warnings = [];
      await _runPostMutationStep(warnings, 'trash-metadata', async () => {
        if (await _pathExists(provider, metaPath)) await _removeEntry(provider, metaPath);
      });
      return { ok: true, trash_root: trashRoot.path, ..._resultWarnings(warnings) };
    }

    if (pathname === '/trash/empty' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const requestedRoots = body?.trash_root
        ? [await _resolveAllowedTrashRoot(body.trash_root)]
        : await _allowedTrashRoots();
      const seenPhysicalRoots = new Set();
      const roots = requestedRoots.filter((root) => {
        const key = String(root.physicalPath || root.path).toLowerCase();
        if (seenPhysicalRoots.has(key)) return false;
        seenPhysicalRoots.add(key);
        return true;
      });
      const failures = [];
      let removed = 0;
      for (const trashRoot of roots) {
        try {
          const trash = await _resolveEntryHandle(provider, trashRoot.path);
          if (!trash || trash.kind !== 'directory') continue;
          const entries = await _listDirectoryEntries(provider, trashRoot.path);
          const entryNames = new Set(entries.map((entry) => entry.name));
          const handled = new Set();
          for (const entry of entries) {
            if (handled.has(entry.name)) continue;
            const isMeta = entry.name.endsWith('._trash_meta.json');
            const itemName = isMeta ? entry.name.slice(0, -'._trash_meta.json'.length) : entry.name;
            if (isMeta && entryNames.has(itemName)) continue;
            try {
              await _removeEntry(provider, _joinPath(trashRoot.path, entry.name));
              removed += 1;
            } catch (error) {
              failures.push({ trash_root: trashRoot.path, name: entry.name, error: error?.message || String(error) });
              if (!isMeta) handled.add(entry.name + '._trash_meta.json');
              continue;
            }
            if (isMeta) continue;
            const metaName = entry.name + '._trash_meta.json';
            handled.add(metaName);
            if (!entryNames.has(metaName)) continue;
            try {
              await _removeEntry(provider, _joinPath(trashRoot.path, metaName));
              removed += 1;
            } catch (error) {
              failures.push({ trash_root: trashRoot.path, name: metaName, error: error?.message || String(error) });
            }
          }
        } catch (error) {
          failures.push({ trash_root: trashRoot.path, name: '', error: error?.message || String(error) });
        }
      }
      if (failures.length) {
        const error = new Error(`ゴミ箱を完全に空にできませんでした（${failures.length}件）`);
        error.code = 'trash_empty_partial_failure';
        error.failures = failures;
        error.removed = removed;
        throw error;
      }
      return { ok: true, removed, trash_roots: roots.map((root) => root.path) };
    }

    if (pathname === '/server-info' && method === 'GET') return { local_ip: 'ブラウザ版ではローカルIPは利用しません' };
    if (pathname === '/autostart' && method === 'GET') return { supported: false, enabled: false };
    if (pathname === '/autostart' && method === 'POST') return { ok: false, supported: false };
    if (pathname === '/chat/config' && method === 'GET') return _llmConfigShape();
    if (pathname === '/chat/config' && (method === 'PUT' || method === 'POST')) return { ok: false, unsupported: true };
    if (pathname === '/extensions/status' && method === 'GET') return { pillow: false, clip: false, caldav: false };
    if (pathname === '/extensions/install' && method === 'POST') return { ok: false, error: 'ブラウザ版では拡張インストールに対応していません' };
    if (pathname === '/caldav/info' && method === 'GET') return { url: '', instructions: { iphone: '', thunderbird: '', google: '' } };
    if (pathname === '/caldav/sync-to-ics' && method === 'POST') return { ok: false, synced: 0 };
    if (pathname === '/caldav/sync-from-ics' && method === 'POST') return { ok: false, imported: 0, updated: 0 };
    if (pathname === '/auth/users' && method === 'GET') return [];
    if (pathname === '/auth/me' && method === 'GET') {
      const username = url.searchParams.get('username') || 'anonymous';
      const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
      return { user: username, username, role: state.access === 'viewer' ? 'viewer' : 'editor' };
    }
    if (pathname === '/pick-folder' && method === 'GET') return { ok: false, needManualInput: true };

    return NOT_HANDLED;
  });
})();
