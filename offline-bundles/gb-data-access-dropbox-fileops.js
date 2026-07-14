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

  async function _allowedTrashRoots() {
    const registry = window.MeldexSourceFolderRegistry;
    const physicalTrashPath = (dropboxPath) => {
      if (typeof registry?.normalizeDropboxPath !== 'function') return '';
      const base = registry.normalizeDropboxPath(dropboxPath || '');
      return base ? `${base === '/' ? '' : base}/_trash` : '';
    };
    const roots = [{
      path: _normalizeFolderPath(PWA_TRASH_DIR),
      name: 'Meldex',
      physicalPath: physicalTrashPath(window.MeldexDropboxAuth?.getVaultPath?.()),
    }];
    if (typeof registry?.loadRegistry !== 'function' || typeof registry?.sourcePath !== 'function') return roots;
    let payload;
    try {
      payload = await registry.loadRegistry({ writeIfMissing: false });
    } catch (error) {
      const wrapped = new Error('ソースフォルダのゴミ箱設定を確認できませんでした');
      wrapped.code = 'trash_roots_unavailable';
      wrapped.cause = error;
      throw wrapped;
    }
    const seen = new Set(roots.map((root) => root.path));
    for (const source of Array.isArray(payload?.roots) ? payload.roots : []) {
      if (!source || source.deleted === true || !source.id) continue;
      const path = _normalizeFolderPath(registry.sourcePath(source.id, '_trash'));
      if (!path || seen.has(path)) continue;
      seen.add(path);
      roots.push({
        path,
        name: String(source.name || source.dropboxPath || source.id).trim() || String(source.id),
        physicalPath: physicalTrashPath(source.dropboxPath),
      });
    }
    return roots;
  }

  async function _resolveAllowedTrashRoot(rawRoot) {
    const raw = String(rawRoot || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (raw.split('/').some((part) => part === '.' || part === '..')) {
      const error = new Error('許可されていないゴミ箱です');
      error.code = 'invalid_trash_root';
      throw error;
    }
    const requested = _normalizeFolderPath(raw || PWA_TRASH_DIR);
    const matched = (await _allowedTrashRoots()).find((root) => root.path === requested);
    if (matched) return matched;
    const error = new Error('許可されていないゴミ箱です');
    error.code = 'invalid_trash_root';
    throw error;
  }

  function _invalidTrashRestorePath() {
    return Object.assign(new Error('元の保存先が安全な復元先ではありません'), {
      code: 'invalid_trash_original_path', status: 400,
    });
  }

  function _safeTrashRestoreRelativePath(rawPath) {
    const raw = String(rawPath || '').trim().replace(/\\/g, '/');
    const segments = raw.split('/');
    if (!raw || raw.startsWith('/') || segments.some((segment) => !segment
      || segment === '.' || segment === '..' || segment.startsWith('.') || segment.startsWith('_'))) throw _invalidTrashRestorePath();
    const normalized = _normalizeFolderPath(raw);
    if (!normalized || normalized !== raw) throw _invalidTrashRestorePath();
    return normalized;
  }

  async function _resolveValidatedTrashRestorePath(trashRoot, originalPath, fallbackPath = '') {
    const registry = window.MeldexSourceFolderRegistry;
    const rootPath = _normalizeFolderPath(trashRoot?.path || '');
    const rawOriginal = String(originalPath || '').trim().replace(/\\/g, '/');
    const candidate = rawOriginal || String(fallbackPath || '').trim().replace(/\\/g, '/');
    if (!candidate || candidate.startsWith('/')) throw _invalidTrashRestorePath();
    const parsedRoot = registry?.parseSourcePath?.(rootPath);
    const parsedOriginal = registry?.parseSourcePath?.(candidate);
    if (parsedRoot) {
      if (parsedRoot.relativePath !== '_trash' || typeof registry?.sourcePath !== 'function') throw _invalidTrashRestorePath();
      const relativePath = _safeTrashRestoreRelativePath(parsedOriginal ? parsedOriginal.relativePath : candidate);
      return registry.sourcePath(parsedRoot.sourceId, relativePath);
    }
    if (rootPath !== _normalizeFolderPath(PWA_TRASH_DIR)) throw _invalidTrashRestorePath();
    if (!parsedOriginal) return _safeTrashRestoreRelativePath(candidate);
    const relativePath = _safeTrashRestoreRelativePath(parsedOriginal.relativePath);
    const allowedSourceIds = new Set((await _allowedTrashRoots())
      .map((root) => registry?.parseSourcePath?.(root.path)?.sourceId || '').filter(Boolean));
    if (!allowedSourceIds.has(parsedOriginal.sourceId) || typeof registry?.sourcePath !== 'function') throw _invalidTrashRestorePath();
    return registry.sourcePath(parsedOriginal.sourceId, relativePath);
  }

  async function _deleteOutlinerPathToTrash(provider, rawPath) {
    const targetPath = _normalizeFolderPath(rawPath || '');
    const source = await _resolveEntryHandle(provider, targetPath);
    if (!source) return { ok: true };
    const parsedSource = window.MeldexSourceFolderRegistry?.parseSourcePath?.(targetPath);
    const trashDir = parsedSource
      ? window.MeldexSourceFolderRegistry.sourcePath(parsedSource.sourceId, '_trash')
      : PWA_TRASH_DIR;
    await _directoryHandle(provider, trashDir, true);
    const originalName = _basename(targetPath);
    const split = _splitNameAndExt(originalName);
    let destName = originalName;
    let destPath = _joinPath(trashDir, destName);
    for (let counter = 1; await _pathExists(provider, destPath); counter += 1) {
      destName = source.kind === 'file'
        ? `${split.stem}_${String(counter).padStart(4, '0')}${split.ext}`
        : `${originalName}_${String(counter).padStart(4, '0')}`;
      destPath = _joinPath(trashDir, destName);
    }
    const metaPath = destPath + '._trash_meta.json';
    await provider.writeJson(metaPath, {
      original_path: targetPath,
      trash_root: trashDir,
      deleted_at: new Date().toISOString(),
    });
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
    return { ok: true, trash_name: destName, trash_root: trashDir, ..._resultWarnings(warnings) };
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
      const content = String(body?.content ?? '');
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
