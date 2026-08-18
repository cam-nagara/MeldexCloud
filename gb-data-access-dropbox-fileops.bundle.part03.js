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
  const plan = Array.isArray(event?.annotationPlan)
    ? event.annotationPlan
    : await _prepareAnnotationsForPathMutation(provider, { oldPath, newPath, isFolder, action });
  for (const prepared of plan) {
    const record = prepared.record;
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
      const saved = await _annotationTargetResolver().markStoredRecordOrphan({
        adapter: prepared.scope.adapter,
        kind: window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS,
        documentId: String(record.id), oldPath,
      });
      await _annotationTargetResolver().indexUpsert(
        prepared.scope.adapter, window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS, saved.payload,
      );
      Object.assign(record, saved.payload);
      changed = true;
    } else if (action === 'rename' || action === 'move') {
      if (record.target_path) {
        const nextTargetPath = _rewriteAnnotationPath(record.target_path, oldPath, newPath, isFolder);
        if (nextTargetPath !== _normalizeFolderPath(record.target_path)) {
          if (record.target_identity) {
            await _annotationTargetResolver().rebindClaimAfterMove({
              provider, adapter: prepared.scope.adapter, boundary: prepared.boundary,
              targetIdentity: record.target_identity, oldPath: record.target_path,
              newPath: nextTargetPath, oldProviderIdentity: prepared.oldProviderIdentity,
            });
          }
          const saved = await _annotationTargetResolver().rewriteStoredRecordAfterMove({
            adapter: prepared.scope.adapter,
            kind: window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS,
            documentId: String(record.id), oldPath: record.target_path, newPath: nextTargetPath,
            targetId: nextTargetPath ? _fnvFileId(nextTargetPath) : '',
            operationId: `annotation-${action}:${record.id}:${oldPath}`,
          });
          await _annotationTargetResolver().indexUpsert(
            prepared.scope.adapter, window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS, saved.payload,
          );
          Object.assign(record, saved.payload);
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
    updated += 1;
  }
  return { ok: true, updated };
}

async function _prepareAnnotationsForPathMutation(provider, event) {
  const oldPath = _normalizeFolderPath(event?.oldPath || event?.path || '');
  const newPath = _normalizeFolderPath(event?.newPath || '');
  const action = String(event?.action || 'move');
  const isFolder = !!event?.isFolder;
  if (!oldPath) return [];
  const records = await _listAnnotationRecords(provider, { targetPath: oldPath, folderPrefix: isFolder });
  const plan = [];
  for (const record of records) {
    if (!_annotationPathMatches(record.target_path, oldPath, isFolder)) continue;
    let scope;
    try { scope = await window.MeldexDropboxManagementRootResolver.resolveManagementScopeForPath(provider, record.target_path); }
    catch (error) { throw _annotationUnavailable(error, '移動scope解決'); }
    const boundary = scope.adapter?.describe?.().boundary;
    if (!boundary) throw _annotationUnavailable(new Error('adapter boundary missing'), '移動scope解決');
    const kind = window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS;
    let stored = await scope.adapter.load(kind, String(record.id));
    if (!stored) {
      if (!newPath || !new Set(['rename', 'move', 'delete']).has(action)) {
        throw Object.assign(new Error('legacy注釈を安全に移行できません'), { status: 409 });
      }
      const nextTargetPath = _rewriteAnnotationPath(record.target_path, oldPath, newPath, isFolder);
      stored = await _annotationTargetResolver().prepareLegacyRecordForMove({
        provider, adapter: scope.adapter, boundary, kind, record,
        oldPath: record.target_path, newPath: nextTargetPath,
        operationId: `annotation-${action}:${record.id}:${record.target_path}:${nextTargetPath}`,
      });
      await _annotationTargetResolver().indexUpsert(scope.adapter, kind, stored.payload);
      Object.assign(record, stored.payload);
    }
    const oldProviderIdentity = await _annotationTargetResolver().freshProviderIdentity(provider, record.target_path);
    plan.push({ record, scope, boundary, oldProviderIdentity });
  }
  return plan;
}
/* gb-data-access-dropbox-fileops-versions.js
 *
 * gb-data-access-dropbox-fileops-core.js の続き(同じ関数スコープに連結される
 * 継続ファイル。IIFEはここでは開かない・閉じない。詳細は core.js 冒頭コメント参照)。
 *
 * 固有形式付随物廃止・管理データ一元化計画 Phase 0 監査ノート§5「切り出し範囲の
 * 決定」の④版クラスタ(ファイル版・フォルダ版の自動作成・一覧・復元・
 * 論理削除/復元)。フォルダ版のヘルパーは兄弟ファイル
 * gb-data-access-dropbox-fileops-folder-versions.js が担当し、このファイルの
 * 旧パス読取ヘルパーと共通管理領域アダプターを共有する。
 *
 * 版履歴は共通ストレージ層（種別 versions）へ内容とメタデータを保存する。
 * `_meldex/versions/files` / `_meldex/versions/folders` は移行時の読取・照合・
 * 検証済み削除にのみ使用し、通常運用では作成・更新しない。
 */

const LEGACY_VERSION_FILE_DIR = '_meldex/versions/files';
const LEGACY_VERSION_FOLDER_DIR = '_meldex/versions/folders';
const FOLDER_VERSION_EXCLUDE = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg',
  '.mp4', '.avi', '.mov', '.wmv', '.mkv', '.webm',
  '.mp3', '.wav', '.ogg', '.flac', '.aac',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.exe', '.dll', '.so', '.dylib', '.psd', '.ai', '.sketch',
]);
const FOLDER_VERSION_EXCLUDE_PREFIXES = ['_meldex/', '_events/', '_trash/', 'node_modules/'];

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
  return _joinPath(LEGACY_VERSION_FILE_DIR, _fnvFileId(normalized));
}

function _folderVersionDir(path) {
  const normalized = _normalizeFolderPath(path);
  return _joinPath(LEGACY_VERSION_FOLDER_DIR, _fnvFileId(normalized || '.'));
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

async function _relocateVersionHistory(provider, oldPath, newPath, isFolder) {
  const normalizedOld = _normalizeFolderPath(oldPath);
  const normalizedNew = _normalizeFolderPath(newPath);
  if (!normalizedOld || normalizedOld === normalizedNew) return false;
  const kind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
  const adapter = await _managementAdapterForProvider(provider, kind, normalizedOld);
  const records = await adapter.listDocuments(kind);
  let moved = 0;
  for (const record of records) {
    const payload = record?.payload || {};
    const current = _normalizeFolderPath(payload.original_relative_path || '');
    const matches = current === normalizedOld || (isFolder && current.startsWith(normalizedOld + '/'));
    if (!matches) continue;
    const suffix = current === normalizedOld ? '' : current.slice(normalizedOld.length);
    await adapter.save(
      kind,
      record.documentId,
      { ...payload, original_relative_path: normalizedNew + suffix },
      { expectedRevision: record.revision },
    );
    moved += 1;
  }
  return moved > 0;
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
  const versionName = _fileVersionName(normalized, options || {});
  const adapter = await _managementAdapterForProvider(provider, window.MeldexSystemStorage.SystemStorageKind.VERSIONS, normalized);
  const documentId = `file-${_fnvFileId(normalized)}-${_fnvFileId(versionName)}`;
  const expectedRevision = String(options?.expectedRevision || '');
  const revisionOf = value => String(value?.revision || value?.rev || value?.etag || '');
  const before = expectedRevision ? await provider.getMetadata(normalized) : null;
  const content = await provider.readText(normalized);
  const after = expectedRevision ? await provider.getMetadata(normalized) : null;
  if (expectedRevision && (revisionOf(before) !== expectedRevision || revisionOf(after) !== expectedRevision)) {
    throw Object.assign(new Error('Version保存中にCloudファイルが変更されました'), { status: 409 });
  }
  await adapter.save(window.MeldexSystemStorage.SystemStorageKind.VERSIONS, documentId, {
    object_type: 'text-file',
    original_relative_path: normalized,
    version_name: versionName,
    content,
    auto: !!options?.auto,
    label: String(options?.label || ''),
    created_at: _nowIso(),
    deleted_at: '',
  }, { expectedRevision: null });

  const maxAuto = Number(options?.max_auto || 0);
  if (options?.auto && maxAuto > 0) {
    const rows = await adapter.listDocuments(window.MeldexSystemStorage.SystemStorageKind.VERSIONS);
    const autoFiles = rows.filter(row => row.payload?.original_relative_path === normalized && row.payload?.auto)
      .sort((a, b) => String(a.payload?.created_at || '').localeCompare(String(b.payload?.created_at || '')));
    while (autoFiles.length > maxAuto) {
      const old = autoFiles.shift();
      await adapter.delete(window.MeldexSystemStorage.SystemStorageKind.VERSIONS, old.documentId).catch(() => {});
    }
  }
  return { ok: true, version: versionName };
}

async function _listFileVersions(provider, path) {
  const normalized = _normalizeFolderPath(path);
  const source = await _resolveEntryHandle(provider, normalized);
  if (!source || source.kind !== 'file') throw new Error(`ファイルが見つかりません: ${normalized}`);
  const adapter = await _managementAdapterForProvider(provider, window.MeldexSystemStorage.SystemStorageKind.VERSIONS, normalized);
  const entries = await adapter.listDocuments(window.MeldexSystemStorage.SystemStorageKind.VERSIONS);
  const versions = [];
  for (const entry of entries) {
    const payload = entry.payload || {};
    if (payload.original_relative_path !== normalized || payload.object_type !== 'text-file' || payload.deleted_at) continue;
    const entryInfo = _fileVersionInfoFromName(payload.version_name);
    versions.push({
      name: payload.version_name,
      auto: !!payload.auto,
      label: payload.label || entryInfo.label,
      created: payload.created_at || entryInfo.created || '',
      modified: payload.created_at || '',
      size: new TextEncoder().encode(payload.content || '').length,
      _modifiedMs: Date.parse(payload.created_at || '') || 0,
    });
  }
  const known = new Set(versions.map(row => row.name));
  for (const entry of await _listEntriesSafe(provider, _fileVersionDir(normalized))) {
    if (entry.handle.kind !== 'file' || known.has(entry.name)) continue;
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
      _modifiedMs: stats.modifiedMs || Date.parse(entryInfo.created || '') || 0,
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
