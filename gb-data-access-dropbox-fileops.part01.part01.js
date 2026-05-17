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
    _extractFrontmatterType,
    _isTextLikePath,
    _folderLinksStore,
    _writeFolderLinksStore,
    _readFolderLinks,
    _writeFolderLinks,
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
    _rewriteStoredPathsForProvider,
    _removeStoredPathEntries,
    _removeStoredPathEntriesForProvider,
    _iterateWorkspaceFiles,
    _relocateReferences,
    _queryBacklinks,
    _fnvFileId,
  } = internals;

  async function _runPathMutationHooks(event) {
    const errors = [];
    for (const hook of pathMutationHooks) {
      try {
        await hook(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      const error = new Error('パス変更後の保護メタデータ更新に失敗しました');
      error.hookErrors = errors;
      throw error;
    }
  }

  function _postMutationWarning(stage, error) {
    return {
      stage: String(stage || 'post-mutation'),
      message: error?.message || String(error),
      code: error?.code || '',
    };
  }

  async function _runPostMutationStep(warnings, stage, fn) {
    try {
      await fn();
    } catch (error) {
      warnings.push(_postMutationWarning(stage, error));
    }
  }

  async function _runPathMutationHooksSafe(event, warnings) {
    await _runPostMutationStep(warnings, 'path-mutation-hooks', () => _runPathMutationHooks(event));
  }

  function _resultWarnings(warnings) {
    return warnings.length ? { warnings } : {};
  }

  function _isBrowseContainerItem(item) {
    const type = String(item?.type || '');
    return type === 'folder' || type === 'database' || type === 'calendar';
  }

  async function _folderLinksForProvider(provider) {
    return typeof _readFolderLinks === 'function' ? _readFolderLinks(provider) : _folderLinksStore();
  }

  async function _writeFolderLinksForProvider(provider, links) {
    if (typeof _writeFolderLinks === 'function') return _writeFolderLinks(provider, links);
    _writeFolderLinksStore(links);
    return links;
  }

  async function _deleteOutlinerPathToTrash(provider, rawPath) {
    const targetPath = _normalizeFolderPath(rawPath || '');
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
    const metaPath = destPath + '._trash_meta.json';
    await provider.writeJson(metaPath, { original_path: targetPath, deleted_at: new Date().toISOString() });
    try {
      await _moveEntry(provider, targetPath, destPath);
    } catch (error) {
      await provider.deletePath(metaPath).catch(() => {});
      throw error;
    }
    const warnings = [];
    await _runPostMutationStep(warnings, 'stored-paths', () => (
      typeof _removeStoredPathEntriesForProvider === 'function'
        ? _removeStoredPathEntriesForProvider(provider, targetPath, source.kind === 'directory')
        : Promise.resolve(_removeStoredPathEntries(targetPath, source.kind === 'directory'))
    ));
    await _runPathMutationHooksSafe({ action: 'delete', path: targetPath, isFolder: source.kind === 'directory', trashPath: destPath }, warnings);
    await _runPostMutationStep(warnings, 'annotations', () => _updateAnnotationsForPathMutation(provider, {
      action: 'delete',
      oldPath: targetPath,
      isFolder: source.kind === 'directory',
      trashPath: destPath,
    }));
    return { ok: true, trash_name: destName, ..._resultWarnings(warnings) };
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
        const nextPath = entry.path || _joinPath(normalized, entry.name);
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

  function _pathLooksLikeBoardMarkdown(path) {
    return /\.board\.md$/i.test(String(path || ''));
  }

  async function _assertNoBoardTypeDowngrade(provider, path, nextContent) {
    let previous = '';
    try {
      previous = await provider.readText(path);
    } catch {}
    const wasBoard = _pathLooksLikeBoardMarkdown(path) || _extractFrontmatterType(previous) === 'board';
    if (!wasBoard || _extractFrontmatterType(nextContent) === 'board') return;
    const error = new Error('既存のボードファイルをノート形式のMarkdownで上書きしようとしたため保存を中止しました');
    error.code = 'board_type_downgrade';
    throw error;
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
      error: `${feature}はブラウザ版Meldex ${phase} 対象です。現在はフォルダ・ノート・シナリオ・ボードの基本操作を先に安定化しています。`,
    };
  }

  function _isDropboxConflictName(name) {
    const normalized = String(name || '').toLowerCase();
    return /\([^)]*\bconflicted\s+copy\b[^)]*\)(?:\.[^.]*)?$/i.test(normalized)
      || /\([^)]*競合[^)]*コピー[^)]*\)(?:\.[^.]*)?$/.test(normalized);
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
      if (targetKind === 'board_line' && String(ref.lineId || '') === itemId) return true;
      if (targetKind === 'sheet_entry' && String(ref.entryId || '') === itemId) return true;
      if (targetKind === 'sheet_cell' && String(ref.entryId || '') === itemId && (!colId || String(ref.colId || '') === colId)) return true;
      if (targetKind === 'sheet_col' && String(ref.colId || '') === itemId) return true;
      if (targetKind === 'calendar_event' && String(ref.eventId || '') === itemId) return true;
    }

    if (!cascade || kind !== 'text_range' || !ref.container) return false;
    const container = ref.container;
    if ((targetKind === 'note_line' || targetKind === 'scriptnote_line' || targetKind === 'board_card' || targetKind === 'board_line' || targetKind === 'calendar_event')) {
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

  function _annotationPathMatches(path, targetPath, isFolder) {
    const normalized = _normalizeFolderPath(path);
    const target = _normalizeFolderPath(targetPath);
    if (!normalized || !target) return false;
    return normalized === target || (!!isFolder && normalized.startsWith(target + '/'));
  }

  function _rewriteAnnotationPath(path, oldPath, newPath, isFolder) {
    const normalized = _normalizeFolderPath(path);
    const oldNormalized = _normalizeFolderPath(oldPath);
    const newNormalized = _normalizeFolderPath(newPath);
    if (!normalized || !oldNormalized) return normalized;
    if (normalized === oldNormalized) return newNormalized;
    if (isFolder && normalized.startsWith(oldNormalized + '/')) return newNormalized + normalized.slice(oldNormalized.length);
    return normalized;
  }

  async function _updateAnnotationsForPathMutation(provider, event) {
    const action = String(event?.action || '');
    const oldPath = _normalizeFolderPath(event?.oldPath || event?.path || '');
    const newPath = _normalizeFolderPath(event?.newPath || '');
    const isFolder = !!event?.isFolder;
    if (!oldPath || (action !== 'delete' && !newPath)) return { ok: true, updated: 0 };
    const now = _nowIso();
    let updated = 0;
    const records = await _listAnnotationRecords(provider);
    for (const record of records) {
      let changed = false;
      const ref = _annotationRef(record);
      const recordPaths = [
        record.target_path,
        ref.file,
        ref.path,
        ref.targetPath,
        ref.target_path,
      ].filter(Boolean);
      const matches = recordPaths.some(path => _annotationPathMatches(path, oldPath, isFolder));
      if (!matches) continue;

      if (action === 'delete') {
        record.orphan = 1;
        record.orphaned_at = now;
        record.target_file_name = record.target_file_name || _basename(oldPath);
        changed = true;
      } else if (action === 'rename' || action === 'move') {
        if (record.target_path) {
          const nextTargetPath = _rewriteAnnotationPath(record.target_path, oldPath, newPath, isFolder);
          if (nextTargetPath !== _normalizeFolderPath(record.target_path)) {
            record.target_path = nextTargetPath;
            record.target_id = nextTargetPath ? _fnvFileId(nextTargetPath) : '';
            changed = true;
          }
        }
        ['file', 'path', 'targetPath', 'target_path'].forEach((key) => {
          if (!ref[key]) return;
          const rewritten = _rewriteAnnotationPath(ref[key], oldPath, newPath, isFolder);
          if (rewritten !== _normalizeFolderPath(ref[key])) {
            ref[key] = rewritten;
            changed = true;
          }
        });
        if (changed) record.target_ref = ref;
      }
      if (!changed) continue;
      record.modified = now;
      record.modified_at = now;
      await _writeAnnotationRecord(provider, record);
      updated += 1;
    }
    return { ok: true, updated };
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

  async function _fileEtag(provider, path, entry, writeMeta) {
    const meta = writeMeta?.meta || writeMeta || {};
    const metaToken = meta.rev || meta.content_hash || meta.etag || '';
    if (metaToken) return String(metaToken);
    const stat = typeof provider.statPath === 'function' ? await provider.statPath(path).catch(() => null) : null;
    const statMeta = stat?.meta || {};
    const statToken = statMeta.rev || statMeta.content_hash || statMeta.etag || '';
    if (statToken) return String(statToken);
    const handle = entry?.handle || (await _resolveEntryHandle(provider, path))?.handle;
    const stats = handle ? await _fileStats(handle).catch(() => null) : null;
    return stats ? `${Number(stats.modifiedMs || 0)}:${Number(stats.size || 0)}` : '';
  }

  function _throwEtagConflict(path, expected, current) {
    const error = new Error('他のタブまたは別プロセスで更新されたため保存を中止しました');
    error.status = 409;
    error.code = 'etag_conflict';
    error.detail = {
      code: 'etag_conflict',
      path: _normalizeFolderPath(path),
      expected_etag: String(expected || ''),
      current_etag: String(current || ''),
    };
    throw error;
  }

  async function _mergeVersionDirectory(provider, oldDir, newDir) {
    const oldEntry = await _resolveEntryHandle(provider, oldDir);
    if (!oldEntry || oldEntry.kind !== 'directory') return false;
    const newEntry = await _resolveEntryHandle(provider, newDir);
    if (!newEntry) {
      await _moveEntry(provider, oldDir, newDir);
      return true;
    }
    if (newEntry.kind !== 'directory') throw new Error('バージョン履歴の移動先がフォルダではありません');
    for (const entry of await _listEntriesSafe(provider, oldDir)) {
      const target = await _moveConflictName(provider, newDir, entry.name, entry.handle.kind === 'file');
      await _moveEntry(provider, _joinPath(oldDir, entry.name), target.path);
    }
    await _removeEntry(provider, oldDir).catch(() => {});
    return true;
  }

  async function _relocateChildFileVersionHistories(provider, oldFolder, newFolder) {
    const oldBase = _normalizeFolderPath(oldFolder);
    const newBase = _normalizeFolderPath(newFolder);
    async function walk(current) {
      for (const entry of await _listDirectoryEntries(provider, current)) {
        const nextPath = entry.path || _joinPath(current, entry.name);
        if (entry.handle.kind === 'directory') {
          await walk(nextPath);
          continue;
        }
        const rel = _relativeToFolder(newBase, nextPath);
        await _mergeVersionDirectory(provider, _fileVersionDir(_joinPath(oldBase, rel)), _fileVersionDir(nextPath));
      }
    }
    await walk(newBase);
  }

  async function _relocateVersionHistory(provider, oldPath, newPath, isFolder) {
    const normalizedOld = _normalizeFolderPath(oldPath);
    const normalizedNew = _normalizeFolderPath(newPath);
    if (!normalizedOld || normalizedOld === normalizedNew) return false;
    const oldDir = isFolder ? _folderVersionDir(normalizedOld) : _fileVersionDir(normalizedOld);
    const newDir = isFolder ? _folderVersionDir(normalizedNew) : _fileVersionDir(normalizedNew);
    const moved = await _mergeVersionDirectory(provider, oldDir, newDir);
    if (isFolder) await _relocateChildFileVersionHistories(provider, normalizedOld, normalizedNew);
    return moved;
  }

  async function _countFolderEntriesIncludingTrash(provider, folderPath) {
    let size = 0;
    async function walk(current) {
      for (const entry of await _listDirectoryEntries(provider, current)) {
        if (entry.handle.kind === 'directory') await walk(entry.path || _joinPath(current, entry.name));
        else size += 1;
      }
    }
    await walk(folderPath);
    return size;
  }

  function _fileVersionName(path, options) {
    const split = _splitNameAndExt(_basename(path));
    const label = _safeNamePart(options?.label || '', '').replace(/^_+|_+$/g, '');
    const prefix = options?.auto ? 'auto_' : '';
    return `${_safeNamePart(split.stem, 'file')}_${prefix}${_versionTimestamp()}${label ? '_' + label : ''}${split.ext || '.txt'}`;
  }

  function _fileVersionInfoFromName(name) {
    const stem = _splitNameAndExt(name).stem;
    const match = /(?:^|_)(auto_)?(\d{8})T(\d{6})_(\d{3})_[A-Za-z0-9]+(?:_(.*))?$/.exec(stem);
    if (!match) return { auto: false, label: '', created: '' };
    const date = match[2];
    const time = match[3];
    return {
      auto: !!match[1],
      label: match[5] || '',
      created: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}.${match[4]}`,
    };
  }

  function _versionLabelFromName(path, name) {
    return _fileVersionInfoFromName(name).label || '';
  }

  function _versionCreatedFromName(name) {
    return _fileVersionInfoFromName(name).created || '';
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
        if (entry.handle.kind !== 'file' || !_fileVersionInfoFromName(entry.name).auto) continue;
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
    const entries = await _listEntriesSafe(provider, _fileVersionDir(normalized));
    const versions = [];
    for (const entry of entries) {
      if (entry.handle.kind !== 'file') continue;
      const entryInfo = _fileVersionInfoFromName(entry.name);
      if (!entryInfo.created) continue;
      const stats = await _fileStats(entry.handle).catch(() => ({ size: 0, modified: '', modifiedMs: 0 }));
      versions.push({
        name: entry.name,
        auto: entryInfo.auto,
        label: entryInfo.label,
        created: entryInfo.created || stats.modified || '',
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
