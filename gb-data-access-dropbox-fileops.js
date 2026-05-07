(function () {
  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;
  const pathMutationHooks = window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];

  const {
    NOT_HANDLED,
    PWA_HOME_KEY,
    PWA_TRASH_DIR,
    IMAGE_EXTS,
    _safeWriteJson,
    _normalizeFolderPath,
    _joinPath,
    _dirname,
    _basename,
    _splitNameAndExt,
    _boolParam,
    _displayLabelForPath,
    _phase1SurfaceType,
    _isTextLikePath,
    _folderLinksStore,
    _writeFolderLinksStore,
    _requirePwaProvider,
    _directoryHandle,
    _resolveEntryHandle,
    _listDirectoryEntries,
    _readJsonSafe,
    _fileStats,
    _validateItemName,
    _pathExists,
    _uniqueName,
    _moveConflictName,
    _writeBytes,
    _decodeUploadData,
    _copyEntryHandle,
    _removeEntry,
    _moveEntry,
    _classifyDirectoryType,
    _classifyFileType,
    _buildBrowseItem,
    _sortBrowseItems,
    _linkedItemsForFolder,
    _rewriteStoredPaths,
    _removeStoredPathEntries,
    _iterateWorkspaceFiles,
    _relocateReferences,
    _queryBacklinks,
    _fnvFileId,
  } = internals;

  async function _runPathMutationHooks(event) {
    for (const hook of pathMutationHooks) {
      try {
        await hook(event);
      } catch {}
    }
  }

  async function _findPathByFileId(provider, fileId) {
    const wanted = String(fileId || '').trim();
    if (!wanted) return '';
    async function walk(relativePath) {
      const normalized = _normalizeFolderPath(relativePath);
      if (normalized && _fnvFileId(normalized) === wanted) return normalized;
      const entries = await _listDirectoryEntries(provider, normalized);
      for (const entry of entries) {
        if (!entry.name || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
        const nextPath = _joinPath(normalized, entry.name);
        if (_fnvFileId(nextPath) === wanted) return nextPath;
        if (entry.handle.kind === 'directory') {
          const nested = await walk(nextPath);
          if (nested) return nested;
        }
      }
      return '';
    }
    return walk('');
  }

  function _llmConfigShape() {
    return {
      providers: {
        gemini: { configured: false },
        anthropic: { configured: false },
        openai: { configured: false },
      },
    };
  }

  function _phaseUnsupported(feature, phase) {
    return {
      ok: false,
      unsupported: true,
      error: `${feature}は Dropbox 共有モード ${phase} 対象です。Phase 1 ではフォルダ・ノート・シナリオ・ボードの基本操作を先に安定化します。`,
    };
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
    if (!originalName) return '';
    return _joinPath(_dirname(normalized), originalName);
  }

  function _conflictBackupStamp() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  }

  function _conflictBackupPath(kind, sourcePath, stamp) {
    return _joinPath('_meldex/conflict-backups', stamp, kind, _normalizeFolderPath(sourcePath));
  }

  async function _backupConflictSide(provider, kind, sourcePath, stamp) {
    const normalized = _normalizeFolderPath(sourcePath);
    if (!normalized || !await _pathExists(provider, normalized)) return '';
    const backupPath = _conflictBackupPath(kind, normalized, stamp || _conflictBackupStamp());
    await provider.copyPath(normalized, backupPath);
    return backupPath;
  }

  async function _textPreview(provider, filePath, maxChars) {
    const text = await provider.readText(filePath);
    const limit = Number(maxChars || 200000);
    if (text.length <= limit) return { content: text, truncated: false, length: text.length };
    return { content: text.slice(0, limit), truncated: true, length: text.length };
  }

  const ANNOTATION_DIR = '_events/annotations';
  const VIEW_LOCK_DIR = '_meldex/view-locks';
  const VERSION_FILE_DIR = '_meldex/versions/files';
  const VERSION_FOLDER_DIR = '_meldex/versions/folders';
  const FOLDER_VERSION_EXCLUDE = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg',
    '.mp4', '.avi', '.mov', '.wmv', '.mkv', '.webm',
    '.mp3', '.wav', '.ogg', '.flac', '.aac',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.exe', '.dll', '.so', '.dylib', '.psd', '.ai', '.sketch',
  ]);
  const FOLDER_VERSION_EXCLUDE_PREFIXES = ['_meldex/', '_events/', '_trash/', 'node_modules/'];
  const ANNOTATION_EXT_KEYS = [
    'target_kind', 'target_ref', 'target_file_name', 'target_snapshot',
    'orphan', 'orphaned_at', 'resolved', 'thread_parent_id', 'body',
    'copied_to_refs', 'monitor_id', 'monitor_w', 'monitor_h',
    'desktop_x', 'desktop_y', 'width', 'height', 'always_on_top',
    'z_order', 'collapsed', 'last_seen_at',
  ];
  const ANNOTATION_UPDATE_KEYS = [
    'data', 'color', 'opacity', 'shape', 'type',
    ...ANNOTATION_EXT_KEYS,
  ];

  function _nowIso() {
    return new Date().toISOString();
  }

  function _randomId(prefix) {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const random = Math.random().toString(16).slice(2);
    return `${prefix || 'id'}-${Date.now().toString(36)}-${random}`;
  }

  function _safeNamePart(value, fallback) {
    const text = String(value || fallback || 'item')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return (text || fallback || 'item').slice(0, 80);
  }

  function _decodePathPart(value) {
    try {
      return decodeURIComponent(String(value || ''));
    } catch {
      return String(value || '');
    }
  }

  function _safeId(value, field) {
    const id = _decodePathPart(value).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) throw new Error(`${field || 'id'} が不正です`);
    return id;
  }

  function _safeRelativeFile(value, field) {
    const raw = _decodePathPart(value).replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = raw.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..')) throw new Error(`${field || 'file'} が不正です`);
    return parts.join('/');
  }

  function _jsonMaybeParse(value, fallback) {
    if (typeof value !== 'string') return value == null ? fallback : value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function _annotationJsonField(value, fallback) {
    const parsed = _jsonMaybeParse(value, null);
    if (parsed && typeof parsed === 'object') return parsed;
    if (value && typeof value !== 'string') return value;
    return fallback;
  }

  function _annotationFlag(value) {
    if (value === true || value === 1 || value === '1') return 1;
    if (String(value || '').toLowerCase() === 'true') return 1;
    return 0;
  }

  function _currentUserName(body) {
    const fromBody = String(body?.user || '').trim();
    if (fromBody) return fromBody;
    try {
      const username = typeof getUsername === 'function' ? getUsername() : '';
      if (username) return username;
    } catch {}
    return 'anonymous';
  }

  function _annotationPath(id) {
    return _joinPath(ANNOTATION_DIR, _safeId(id, 'annotation id') + '.json');
  }

  function _annotationRow(record) {
    const out = { ...(record || {}) };
    out.id = String(out.id || '');
    out.data = typeof out.data === 'string'
      ? out.data
      : JSON.stringify(out.data && typeof out.data === 'object' ? out.data : {}, null, 0);
    if (out.target_ref && typeof out.target_ref !== 'string') out.target_ref = JSON.stringify(out.target_ref, null, 0);
    if (out.copied_to_refs && typeof out.copied_to_refs !== 'string') out.copied_to_refs = JSON.stringify(out.copied_to_refs, null, 0);
    out.orphan = _annotationFlag(out.orphan);
    out.resolved = _annotationFlag(out.resolved);
    out.created = out.created || out.created_at || '';
    out.modified = out.modified || out.modified_at || out.created;
    out.created_at = out.created_at || out.created;
    out.modified_at = out.modified_at || out.modified;
    return out;
  }

  function _mergeAnnotationRecord(existing, body, options) {
    const now = options?.now || _nowIso();
    const record = { ...(existing || {}) };
    if (!record.id) record.id = options?.id || _randomId('ann');
    if (!record.created) record.created = now;
    if (!record.created_at) record.created_at = record.created;
    record.modified = now;
    record.modified_at = now;
    if (!record.target_path && body?.target_path) record.target_path = _normalizeFolderPath(body.target_path);
    if (!record.target_id && record.target_path) record.target_id = _fnvFileId(record.target_path);
    if (!record.user) record.user = _currentUserName(body);
    if (body && Object.prototype.hasOwnProperty.call(body, 'target_path')) {
      record.target_path = _normalizeFolderPath(body.target_path || '');
      record.target_id = body.target_id || (record.target_path ? _fnvFileId(record.target_path) : '');
    }
    if (body && Object.prototype.hasOwnProperty.call(body, 'target_id')) record.target_id = String(body.target_id || '');
    if (body && Object.prototype.hasOwnProperty.call(body, 'type')) record.type = String(body.type || 'stroke');
    if (body && Object.prototype.hasOwnProperty.call(body, 'shape')) record.shape = String(body.shape || '');
    if (body && Object.prototype.hasOwnProperty.call(body, 'data')) record.data = _annotationJsonField(body.data, {});
    if (body && Object.prototype.hasOwnProperty.call(body, 'color')) record.color = String(body.color || '#ffeb3b');
    if (body && Object.prototype.hasOwnProperty.call(body, 'opacity')) record.opacity = Number(body.opacity == null ? 1 : body.opacity);
    if (body && Object.prototype.hasOwnProperty.call(body, 'user')) record.user = _currentUserName(body);
    ANNOTATION_EXT_KEYS.forEach((key) => {
      if (!body || !Object.prototype.hasOwnProperty.call(body, key)) return;
      if (key === 'target_ref' || key === 'copied_to_refs') record[key] = _annotationJsonField(body[key], key === 'copied_to_refs' ? [] : null);
      else if (key === 'orphan' || key === 'resolved') record[key] = _annotationFlag(body[key]);
      else record[key] = body[key];
    });
    if (!record.type) record.type = 'stroke';
    if (record.data == null) record.data = {};
    if (!record.color) record.color = '#ffeb3b';
    if (record.opacity == null || !Number.isFinite(Number(record.opacity))) record.opacity = 1;
    return record;
  }

  async function _readAnnotationRecord(provider, id) {
    const record = await _readJsonSafe(provider, _annotationPath(id), null);
    return record && typeof record === 'object' ? record : null;
  }

  async function _writeAnnotationRecord(provider, record) {
    await provider.writeJson(_annotationPath(record.id), record);
  }

  async function _listAnnotationRecords(provider) {
    let entries = [];
    try {
      entries = await _listDirectoryEntries(provider, ANNOTATION_DIR);
    } catch {
      return [];
    }
    const records = [];
    for (const entry of entries) {
      if (entry.handle.kind !== 'file' || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      const record = await _readAnnotationRecord(provider, id);
      if (record?.id) records.push(record);
    }
    return records;
  }

  function _annotationRef(record) {
    const ref = _annotationJsonField(record?.target_ref, null);
    return ref && typeof ref === 'object' ? ref : {};
  }

  function _annotationMatchesOrphan(record, body, cascade) {
    if (!record || _annotationFlag(record.orphan)) return false;
    const targetKind = String(body?.target_kind || '');
    const itemId = String(body?.item_id || '');
    const colId = String(body?.col_id || '');
    const targetFile = _normalizeFolderPath(body?.target_file || '');
    if (!targetKind || !itemId) return false;
    const ref = _annotationRef(record);
    if (targetFile && _normalizeFolderPath(ref.file || record.target_path || '') !== targetFile) return false;

    const kind = String(record.target_kind || '');
    const directKindOk = targetKind === 'sheet_col'
      ? (kind === 'sheet_col' || kind === 'sheet_cell')
      : kind === targetKind;
    if (directKindOk) {
      if ((targetKind === 'note_line' || targetKind === 'scriptnote_line') && String(ref.lineId || '') === itemId) return true;
      if (targetKind === 'board_card' && String(ref.cardId || '') === itemId) return true;
      if (targetKind === 'sheet_entry' && String(ref.entryId || '') === itemId) return true;
      if (targetKind === 'sheet_cell' && String(ref.entryId || '') === itemId && (!colId || String(ref.colId || '') === colId)) return true;
      if (targetKind === 'sheet_col' && String(ref.colId || '') === itemId) return true;
      if (targetKind === 'calendar_event' && String(ref.eventId || '') === itemId) return true;
    }

    if (!cascade || kind !== 'text_range' || !ref.container) return false;
    const container = ref.container;
    if ((targetKind === 'note_line' || targetKind === 'scriptnote_line' || targetKind === 'board_card' || targetKind === 'calendar_event')) {
      const containerId = container.id || container.lineId || container.cardId || '';
      return String(container.kind || '') === targetKind && String(containerId || '') === itemId;
    }
    if (targetKind === 'sheet_cell') {
      return String(container.kind || '') === 'sheet_cell'
        && String(container.entryId || '') === itemId
        && (!colId || String(container.colId || '') === colId);
    }
    if (targetKind === 'sheet_entry') {
      return String(container.kind || '') === 'sheet_cell' && String(container.entryId || '') === itemId;
    }
    if (targetKind === 'sheet_col') {
      return String(container.kind || '') === 'sheet_cell' && String(container.colId || '') === itemId;
    }
    return false;
  }

  function _versionTimestamp() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${y}${m}${day}T${hh}${mm}${ss}_${ms}_${_randomId('v').replace(/[^a-z0-9]/gi, '').slice(-6)}`;
  }

  function _fileVersionDir(path) {
    const normalized = _normalizeFolderPath(path);
    return _joinPath(VERSION_FILE_DIR, _fnvFileId(normalized));
  }

  function _folderVersionDir(path) {
    const normalized = _normalizeFolderPath(path);
    return _joinPath(VERSION_FOLDER_DIR, _fnvFileId(normalized || '.'));
  }

  function _fileVersionName(path, options) {
    const split = _splitNameAndExt(_basename(path));
    const label = _safeNamePart(options?.label || '', '').replace(/^_+|_+$/g, '');
    const prefix = options?.auto ? 'auto_' : '';
    return `${_safeNamePart(split.stem, 'file')}_${prefix}${_versionTimestamp()}${label ? '_' + label : ''}${split.ext || '.txt'}`;
  }

  function _versionLabelFromName(path, name) {
    const split = _splitNameAndExt(_basename(path));
    const versionSplit = _splitNameAndExt(name);
    let rest = versionSplit.stem;
    const stemPrefix = `${split.stem}_`;
    if (rest.startsWith(stemPrefix)) rest = rest.slice(stemPrefix.length);
    if (rest.startsWith('auto_')) rest = rest.slice(5);
    const match = /^\d{8}T\d{6}_\d{3}_[A-Za-z0-9]+(?:_(.*))?$/.exec(rest);
    return match?.[1] || '';
  }

  function _versionCreatedFromName(name) {
    const match = /(\d{8})T(\d{6})_(\d{3})_[A-Za-z0-9]+/.exec(String(name || ''));
    if (!match) return '';
    const date = match[1];
    const time = match[2];
    return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}.${match[3]}`;
  }

  async function _listEntriesSafe(provider, dir) {
    try {
      return await _listDirectoryEntries(provider, dir);
    } catch {
      return [];
    }
  }

  async function _saveFileVersion(provider, path, options) {
    const normalized = _normalizeFolderPath(path);
    const source = await _resolveEntryHandle(provider, normalized);
    if (!source || source.kind !== 'file') throw new Error(`ファイルが見つかりません: ${normalized}`);
    if (!_isTextLikePath(normalized)) throw new Error('このファイル形式のバージョン保存にはまだ対応していません');
    const versionDir = _fileVersionDir(normalized);
    const versionName = _fileVersionName(normalized, options || {});
    const versionPath = _joinPath(versionDir, versionName);
    await provider.copyPath(normalized, versionPath);

    const maxAuto = Number(options?.max_auto || 0);
    if (options?.auto && maxAuto > 0) {
      const entries = await _listEntriesSafe(provider, versionDir);
      const autoFiles = [];
      for (const entry of entries) {
        if (entry.handle.kind !== 'file' || !entry.name.includes('_auto_')) continue;
        const stats = await _fileStats(entry.handle).catch(() => ({ modifiedMs: 0 }));
        autoFiles.push({ name: entry.name, path: _joinPath(versionDir, entry.name), modifiedMs: stats.modifiedMs || 0 });
      }
      autoFiles.sort((a, b) => a.modifiedMs - b.modifiedMs);
      while (autoFiles.length > maxAuto) {
        const old = autoFiles.shift();
        await provider.deletePath(old.path).catch(() => {});
      }
    }
    return { ok: true, version: versionName };
  }

  async function _listFileVersions(provider, path) {
    const normalized = _normalizeFolderPath(path);
    const source = await _resolveEntryHandle(provider, normalized);
    if (!source || source.kind !== 'file') throw new Error(`ファイルが見つかりません: ${normalized}`);
    const split = _splitNameAndExt(_basename(normalized));
    const entries = await _listEntriesSafe(provider, _fileVersionDir(normalized));
    const versions = [];
    for (const entry of entries) {
      if (entry.handle.kind !== 'file') continue;
      const entrySplit = _splitNameAndExt(entry.name);
      if (!entry.name.startsWith(split.stem + '_') || entrySplit.ext !== (split.ext || '.txt')) continue;
      const stats = await _fileStats(entry.handle).catch(() => ({ size: 0, modified: '', modifiedMs: 0 }));
      versions.push({
        name: entry.name,
        auto: entry.name.includes('_auto_'),
        label: _versionLabelFromName(normalized, entry.name),
        created: _versionCreatedFromName(entry.name) || stats.modified || '',
        modified: stats.modified || '',
        size: stats.size || 0,
        _modifiedMs: stats.modifiedMs || 0,
      });
    }
    versions.sort((a, b) => (b._modifiedMs || 0) - (a._modifiedMs || 0));
    return versions.map(({ _modifiedMs, ...row }) => row);
  }

  function _safeVersionName(value) {
    const name = _decodePathPart(value).trim();
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('version が不正です');
    return name;
  }

  function _deletedVersionToken() {
    return `d_${_versionTimestamp()}`;
  }

  function _deletedVersionsDir(baseDir) {
    return _joinPath(baseDir, '_deleted');
  }

  async function _softDeleteVersionEntry(provider, baseDir, version, kind) {
    const safeName = _safeVersionName(version);
    const sourcePath = _joinPath(baseDir, safeName);
    const source = await _resolveEntryHandle(provider, sourcePath);
    const expectedKind = kind === 'folder' ? 'directory' : 'file';
    if (!source || source.kind !== expectedKind) throw new Error('バージョンが見つかりません');
    const token = _safeVersionName(_deletedVersionToken());
    const deletedDir = _joinPath(_deletedVersionsDir(baseDir), token);
    await provider.movePath(sourcePath, _joinPath(deletedDir, safeName));
    await provider.writeJson(_joinPath(deletedDir, '_meta.json'), {
      kind,
      version: safeName,
      deleted_at: _nowIso(),
    });
    return { ok: true, token, version: safeName };
  }

  async function _restoreDeletedVersionEntry(provider, baseDir, token, kind) {
    const safeToken = _safeVersionName(token);
    const deletedDir = _joinPath(_deletedVersionsDir(baseDir), safeToken);
    const meta = await _readJsonSafe(provider, _joinPath(deletedDir, '_meta.json'), null);
    if (!meta || meta.kind !== kind) throw new Error('削除済みバージョンが見つかりません');
    const versionName = _safeVersionName(meta.version || '');
    const sourcePath = _joinPath(deletedDir, versionName);
    const expectedKind = kind === 'folder' ? 'directory' : 'file';
    const source = await _resolveEntryHandle(provider, sourcePath);
    if (!source || source.kind !== expectedKind) throw new Error('削除済みバージョンが見つかりません');
    const target = await _moveConflictName(provider, baseDir, versionName, kind !== 'folder');
    await provider.movePath(sourcePath, target.path);
    await provider.deletePath(deletedDir).catch(() => {});
    return { ok: true, version: _basename(target.path) };
  }

  async function _readFileVersion(provider, path, version) {
    const normalized = _normalizeFolderPath(path);
    const name = _safeVersionName(version);
    const versionPath = _joinPath(_fileVersionDir(normalized), name);
    const entry = await _resolveEntryHandle(provider, versionPath);
    if (!entry || entry.kind !== 'file') throw new Error('バージョンが見つかりません');
    return { content: await provider.readText(versionPath), name };
  }

  async function _restoreFileVersion(provider, path, version) {
    const normalized = _normalizeFolderPath(path);
    const source = await _resolveEntryHandle(provider, normalized);
    if (!source || source.kind !== 'file') throw new Error(`ファイルが見つかりません: ${normalized}`);
    await _saveFileVersion(provider, normalized, { auto: true, label: 'pre_restore', max_auto: 30 });
    const data = await _readFileVersion(provider, normalized, version);
    await provider.writeText(normalized, data.content || '');
    return { ok: true };
  }

  async function _deleteFileVersion(provider, path, version) {
    return _softDeleteVersionEntry(provider, _fileVersionDir(_normalizeFolderPath(path)), version, 'file');
  }

  async function _undeleteFileVersion(provider, path, token) {
    return _restoreDeletedVersionEntry(provider, _fileVersionDir(_normalizeFolderPath(path)), token, 'file');
  }

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
        const nextPath = _joinPath(relativePath, entry.name);
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
        await provider.uploadBytes(originalPath, new Uint8Array(await conflictFile.arrayBuffer()));
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
      const allFiles = _boolParam(url.searchParams.get('all_files'));
      const detail = _boolParam(url.searchParams.get('detail'));
      const foldersOnly = _boolParam(url.searchParams.get('folders_only'));
      const entries = await _listDirectoryEntries(provider, browsePath);
      const folders = [];
      const files = [];
      for (const entry of entries) {
        const itemPath = _joinPath(browsePath, entry.name);
        const item = await _buildBrowseItem(provider, itemPath, entry.handle, { allFiles, detail });
        if (!item) continue;
        if (item.type === 'folder') folders.push(item);
        else if (!foldersOnly) files.push(item);
      }
      const items = _sortBrowseItems(folders, sort, order).concat(_sortBrowseItems(files, sort, order));
      const existing = new Set(items.map((item) => item.path));
      for (const linked of _linkedItemsForFolder(browsePath)) {
        if (existing.has(linked.path)) continue;
        const entry = await _resolveEntryHandle(provider, linked.path);
        if (!entry) continue;
        if (entry.kind === 'directory') {
          items.push({ ...linked, type: 'folder', exists: true });
          continue;
        }
        if (foldersOnly) continue;
        const item = await _buildBrowseItem(provider, linked.path, entry.handle, { allFiles, detail });
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
        const itemPath = _joinPath(targetPath, entry.name);
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
      return { path: filePath, content: await provider.readText(filePath) };
    }

    if (pathname === '/file' && (method === 'PUT' || method === 'POST')) {
      const provider = await _requirePwaProvider('readwrite');
      const filePath = _normalizeFolderPath(url.searchParams.get('path') || '');
      if (!filePath) throw new Error('path は必須です');
      await provider.writeText(filePath, body?.content || '');
      return { ok: true };
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
      await _writeBytes(provider, targetPath, _decodeUploadData(body?.data || ''));
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
      for (const link of _folderLinksStore().filter((row) => (folderId ? row.folder_id === folderId : row.folder_path === folderPath))) {
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
      const links = _folderLinksStore();
      if (!links.some((link) => link.file_id === fileId && (folderId ? link.folder_id === folderId : link.folder_path === folderPath))) {
        links.push({
          file_id: fileId,
          path: filePath,
          name: _displayLabelForPath(filePath, ''),
          folder_path: folderPath,
          folder_id: folderId,
          added_at: new Date().toISOString(),
        });
        _writeFolderLinksStore(links);
      }
      return { ok: true, file_id: fileId };
    }

    if (pathname === '/folder-links/remove' && method === 'POST') {
      const fileId = String(body?.file_id || '').trim();
      const folderPath = _normalizeFolderPath(body?.folder_path || '');
      const folderId = String(body?.folder_id || '').trim();
      if (!fileId || (!folderPath && !folderId)) throw new Error('file_id と folder_path/folder_id は必須です');
      _writeFolderLinksStore(_folderLinksStore().filter((link) => !(link.file_id === fileId && (folderId ? link.folder_id === folderId : link.folder_path === folderPath))));
      return { ok: true };
    }

    if (pathname === '/file-folders' && method === 'GET') {
      const filePath = _normalizeFolderPath(url.searchParams.get('path') || '');
      const result = [];
      const physical = _dirname(filePath);
      if (physical) result.push({ folder: physical, type: 'physical' });
      const fileId = filePath ? _fnvFileId(filePath) : '';
      _folderLinksStore().filter((link) => link.file_id === fileId).forEach((link) => {
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
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 200), 1000));
      let rows = (await _listAnnotationRecords(provider)).map(_annotationRow);
      if (annId) rows = rows.filter(row => String(row.id || '') === annId);
      else if (targetId) rows = rows.filter(row => String(row.target_id || '') === targetId);
      else if (targetPath) rows = rows.filter(row => _normalizeFolderPath(row.target_path || '') === targetPath);
      if (user) rows = rows.filter(row => String(row.user || '') === user);
      if (annType) rows = rows.filter(row => String(row.type || '') === annType);
      rows.sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));
      return rows.slice(0, limit);
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
        const labelName = await _uniqueName(provider, parent, label, '.md');
        const targetPath = _joinPath(parent, labelName + '.md');
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
      const newName = _validateItemName(body?.new_name || '', 'new_name');
      const source = await _resolveEntryHandle(provider, oldPath);
      if (!source) throw new Error(`見つかりません: ${oldPath}`);
      const parentPath = _dirname(oldPath);
      const sourceName = _basename(oldPath);
      if (source.kind === 'directory') {
        const newPath = _joinPath(parentPath, newName);
        if (newPath !== oldPath && await _pathExists(provider, newPath)) throw new Error(`既に存在: ${newName}`);
        if (newPath !== oldPath) await _moveEntry(provider, oldPath, newPath);
        const oldNotePath = _joinPath(newPath, sourceName + '.md');
        const newNotePath = _joinPath(newPath, newName + '.md');
        if (await _pathExists(provider, oldNotePath) && !await _pathExists(provider, newNotePath)) await _moveEntry(provider, oldNotePath, newNotePath);
        _rewriteStoredPaths(oldPath, newPath, true);
        await _runPathMutationHooks({ action: 'rename', oldPath, newPath, isFolder: true });
        return { ok: true, new_path: newPath, file_id: _fnvFileId(newPath), relocate: await _relocateReferences(provider, oldPath, newPath, true) };
      }
      const split = _splitNameAndExt(sourceName);
      const nextPath = _joinPath(parentPath, newName + split.ext);
      if (nextPath !== oldPath && await _pathExists(provider, nextPath)) throw new Error(`既に存在: ${newName + split.ext}`);
      if (split.ext === '.md' && String(body?.type || '') === 'page') {
        const original = await provider.readText(oldPath);
        await provider.writeText(oldPath, original.replace(/^# .+/m, '# ' + newName));
      }
      if (nextPath !== oldPath) await _moveEntry(provider, oldPath, nextPath);
      _rewriteStoredPaths(oldPath, nextPath, false);
      await _runPathMutationHooks({ action: 'rename', oldPath, newPath: nextPath, isFolder: false });
      return { ok: true, new_path: nextPath, file_id: _fnvFileId(nextPath), relocate: await _relocateReferences(provider, oldPath, nextPath, false) };
    }

    if (pathname === '/outliner/delete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const targetPath = _normalizeFolderPath(body?.path || '');
      const source = await _resolveEntryHandle(provider, targetPath);
      if (!source) return { ok: true };
      await _directoryHandle(provider, PWA_TRASH_DIR, true);
      const originalName = _basename(targetPath);
      const split = _splitNameAndExt(originalName);
      let destName = originalName;
      let destPath = _joinPath(PWA_TRASH_DIR, destName);
      for (let counter = 1; await _pathExists(provider, destPath); counter += 1) {
        destName = source.kind === 'file'
          ? `${split.stem}_${String(counter).padStart(4, '0')}${split.ext}`
          : `${originalName}_${String(counter).padStart(4, '0')}`;
        destPath = _joinPath(PWA_TRASH_DIR, destName);
      }
      await _moveEntry(provider, targetPath, destPath);
      await provider.writeJson(destPath + '._trash_meta.json', { original_path: targetPath, deleted_at: new Date().toISOString() });
      _removeStoredPathEntries(targetPath, source.kind === 'directory');
      await _runPathMutationHooks({ action: 'delete', path: targetPath, isFolder: source.kind === 'directory', trashPath: destPath });
      return { ok: true, trash_name: destName };
    }

    if (pathname === '/outliner/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const trashName = _validateItemName(body?.trash_name || '', 'trash_name');
      const source = await _resolveEntryHandle(provider, _joinPath(PWA_TRASH_DIR, trashName));
      if (!source) throw new Error(`ゴミ箱にありません: ${trashName}`);
      const meta = await _readJsonSafe(provider, _joinPath(PWA_TRASH_DIR, trashName + '._trash_meta.json'), {});
      const originalPath = _normalizeFolderPath(meta?.original_path || '');
      if (!originalPath) throw new Error('元のパスが不明です');
      if (await _pathExists(provider, originalPath)) throw new Error(`復元先に既にファイルが存在: ${originalPath}`);
      await _moveEntry(provider, _joinPath(PWA_TRASH_DIR, trashName), originalPath);
      await _removeEntry(provider, _joinPath(PWA_TRASH_DIR, trashName + '._trash_meta.json')).catch(() => {});
      return { ok: true, restored_path: originalPath };
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
      if (!newName) throw new Error('不正なファイル名です');
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
      const source = await _resolveEntryHandle(provider, sourcePath);
      const destEntry = await _resolveEntryHandle(provider, destFolder);
      if (!source) throw new Error('見つかりません');
      if (!destEntry || destEntry.kind !== 'directory') throw new Error(`移動先フォルダが見つかりません: ${destFolder}`);
      if (source.kind === 'directory' && (destFolder === sourcePath || destFolder.startsWith(sourcePath + '/'))) throw new Error('フォルダ自身の中には移動できません');
      const conflict = await _moveConflictName(provider, destFolder, _basename(sourcePath), source.kind === 'file');
      await _moveEntry(provider, sourcePath, conflict.path);
      _rewriteStoredPaths(sourcePath, conflict.path, source.kind === 'directory');
      await _runPathMutationHooks({ action: 'move', oldPath: sourcePath, newPath: conflict.path, isFolder: source.kind === 'directory' });
      return {
        ok: true,
        new_path: conflict.path,
        new_name: source.kind === 'file' ? _splitNameAndExt(_basename(conflict.path)).stem : _basename(conflict.path),
        file_id: _fnvFileId(conflict.path),
        relocate: await _relocateReferences(provider, sourcePath, conflict.path, source.kind === 'directory'),
      };
    }

    if (pathname === '/trash' && method === 'GET') {
      const provider = await _requirePwaProvider('read');
      const trashEntry = await _resolveEntryHandle(provider, PWA_TRASH_DIR);
      if (!trashEntry || trashEntry.kind !== 'directory') return { items: [] };
      const entries = await _listDirectoryEntries(provider, PWA_TRASH_DIR);
      const items = [];
      for (const entry of entries) {
        if (entry.name.endsWith('._trash_meta.json')) continue;
        const entryPath = _joinPath(PWA_TRASH_DIR, entry.name);
        const meta = await _readJsonSafe(provider, entryPath + '._trash_meta.json', {});
        let size = 1;
        if (entry.handle.kind === 'directory') {
          size = 0;
          await _iterateWorkspaceFiles(provider, async () => { size += 1; }, entryPath);
        }
        items.push({
          name: entry.name,
          type: entry.handle.kind === 'directory' ? 'folder' : 'file',
          size,
          original_path: String(meta?.original_path || ''),
          deleted_at: String(meta?.deleted_at || ''),
        });
      }
      return { items };
    }

    if (pathname === '/trash/restore' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const name = _validateItemName(body?.name || '', 'name');
      const source = await _resolveEntryHandle(provider, _joinPath(PWA_TRASH_DIR, name));
      if (!source) throw new Error('ゴミ箱に見つかりません');
      const originalPath = _normalizeFolderPath((await _readJsonSafe(provider, _joinPath(PWA_TRASH_DIR, name + '._trash_meta.json'), {}))?.original_path || '');
      const baseDest = originalPath || name;
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
      await _moveEntry(provider, _joinPath(PWA_TRASH_DIR, name), destPath);
      await _removeEntry(provider, _joinPath(PWA_TRASH_DIR, name + '._trash_meta.json')).catch(() => {});
      return { ok: true, restored_to: destPath };
    }

    if (pathname === '/trash/delete' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const name = _validateItemName(body?.name || '', 'name');
      const target = await _resolveEntryHandle(provider, _joinPath(PWA_TRASH_DIR, name));
      if (!target) return { ok: true };
      await _removeEntry(provider, _joinPath(PWA_TRASH_DIR, name));
      await _removeEntry(provider, _joinPath(PWA_TRASH_DIR, name + '._trash_meta.json')).catch(() => {});
      return { ok: true };
    }

    if (pathname === '/trash/empty' && method === 'POST') {
      const provider = await _requirePwaProvider('readwrite');
      const trash = await _resolveEntryHandle(provider, PWA_TRASH_DIR);
      if (!trash || trash.kind !== 'directory') return { ok: true };
      const entries = await _listDirectoryEntries(provider, PWA_TRASH_DIR);
      for (const entry of entries) {
        await _removeEntry(provider, _joinPath(PWA_TRASH_DIR, entry.name)).catch(() => {});
      }
      return { ok: true };
    }

    if (pathname === '/server-info' && method === 'GET') return { local_ip: 'クラウドモードではローカルIPは利用しません' };
    if (pathname === '/autostart' && method === 'GET') return { supported: false, enabled: false };
    if (pathname === '/autostart' && method === 'POST') return { ok: false, supported: false };
    if (pathname === '/chat/config' && method === 'GET') return _llmConfigShape();
    if (pathname === '/chat/config' && (method === 'PUT' || method === 'POST')) return { ok: false, unsupported: true };
    if (pathname === '/extensions/status' && method === 'GET') return { pillow: false, clip: false, caldav: false };
    if (pathname === '/extensions/install' && method === 'POST') return { ok: false, error: 'クラウドモードでは拡張インストールに対応していません' };
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
