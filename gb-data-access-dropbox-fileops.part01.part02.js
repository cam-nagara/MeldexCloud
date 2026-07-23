    if (!meta || typeof meta !== 'object') throw new Error('フォルダバージョンが見つかりません');
    return meta;
  }

  async function _readFolderVersionFile(provider, folderPath, version, file) {
    const relFile = _safeRelativeFile(file, 'file');
    const path = _joinPath(_folderVersionDir(_normalizeFolderPath(folderPath)), _safeVersionName(version), 'files', relFile);
    const entry = await _resolveEntryHandle(provider, path);
    if (!entry || entry.kind !== 'file') throw new Error('バージョン内のファイルが見つかりません');
    return { content: await provider.readText(path) };
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
      const src = _joinPath(_folderVersionDir(normalized), safeVersion, 'files', relPath);
      _rejectProductionLegacyEntryContent(dst, await provider.readText(src));
    }
    await _saveFolderVersion(provider, normalized, { auto: true, label: 'pre_restore' });
    const snapshotFiles = new Set((Array.isArray(meta.files) ? meta.files : []).map(file => _normalizeFolderPath(file.rel_path)).filter(Boolean));
    const versionFilesDir = _joinPath(_folderVersionDir(normalized), safeVersion, 'files');
    let restored = 0;
    for (const file of (Array.isArray(meta.files) ? meta.files : [])) {
      const relPath = _safeRelativeFile(file.rel_path, 'rel_path');
      const src = _joinPath(versionFilesDir, relPath);
      const dst = _joinPath(normalized, relPath);
      const srcEntry = await _resolveEntryHandle(provider, src);
      if (!srcEntry || srcEntry.kind !== 'file') continue;
      const srcFile = await provider.downloadAsFile(src);
      await provider.uploadBytes(dst, new Uint8Array(await srcFile.arrayBuffer()));
      restored += 1;
    }
    return { ok: true, restored_count: restored, restored_files: [...snapshotFiles] };
  }

  async function _deleteFolderVersion(provider, folderPath, version) {
    return _softDeleteVersionEntry(provider, _folderVersionDir(_normalizeFolderPath(folderPath)), version, 'folder');
  }

  async function _undeleteFolderVersion(provider, folderPath, token) {
    return _restoreDeletedVersionEntry(provider, _folderVersionDir(_normalizeFolderPath(folderPath)), token, 'folder');
  }

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
