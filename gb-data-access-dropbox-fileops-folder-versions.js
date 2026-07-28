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

  async function _collectFolderVersionFiles(provider, folderPath) {
    const base = _normalizeFolderPath(folderPath);
    const files = [];
    async function walk(current) {
      const entries = await _listDirectoryEntries(provider, current);
      for (const entry of entries) {
        if (!entry.name || entry.name.startsWith('.')) continue;
        const fullPath = _joinPath(current, entry.name);
        const relPath = _relativeToFolder(base, fullPath);
        if (_skipFolderVersionRelPath(relPath)) continue;
        if (entry.handle.kind === 'directory') {
          await walk(fullPath);
          continue;
        }
        const ext = _splitNameAndExt(entry.name).ext.toLowerCase();
        if (FOLDER_VERSION_EXCLUDE.has(ext)) continue;
        const stats = await _fileStats(entry.handle).catch(() => ({ size: 0, modified: '' }));
        files.push({ rel_path: relPath, path: fullPath, size: stats.size || 0, modified: stats.modified || '' });
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
    const versionDir = _joinPath(_folderVersionDir(normalized), versionName);
    const filesDir = _joinPath(versionDir, 'files');
    const files = await _collectFolderVersionFiles(provider, normalized);
    let totalSize = 0;
    try {
      for (const file of files) {
        totalSize += Number(file.size || 0);
        await provider.copyPath(file.path, _joinPath(filesDir, file.rel_path));
      }
      await provider.writeJson(_joinPath(versionDir, '_meta.json'), {
        folder_path: normalized,
        created: _nowIso(),
        label: options?.label || '',
        auto: !!options?.auto,
        files: files.map(({ rel_path, size, modified }) => ({ rel_path, size, modified })),
        exclude_patterns: [...FOLDER_VERSION_EXCLUDE],
      });
    } catch (error) {
      await _removeEntry(provider, versionDir).catch(() => {});
      throw error;
    }
    return { ok: true, version: versionName, file_count: files.length, total_size: totalSize };
  }

  async function _listFolderVersions(provider, folderPath) {
    const dir = _folderVersionDir(_normalizeFolderPath(folderPath));
    const entries = await _listEntriesSafe(provider, dir);
    const versions = [];
    for (const entry of entries) {
      if (entry.handle.kind !== 'directory' || !entry.name.startsWith('v_')) continue;
      const meta = await _readJsonSafe(provider, _joinPath(dir, entry.name, '_meta.json'), {});
      const files = Array.isArray(meta?.files) ? meta.files : [];
      versions.push({
        name: entry.name,
        created: _versionCreatedFromName(entry.name) || meta?.created || '',
        label: meta?.label || '',
        auto: !!meta?.auto,
        file_count: files.length,
        total_size: files.reduce((sum, file) => sum + Number(file?.size || 0), 0),
      });
    }
    versions.sort((a, b) => String(b.name).localeCompare(String(a.name)));
    return versions;
  }

  async function _readFolderVersion(provider, folderPath, version) {
    const meta = await _readJsonSafe(provider, _joinPath(_folderVersionDir(_normalizeFolderPath(folderPath)), _safeVersionName(version), '_meta.json'), null);
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
