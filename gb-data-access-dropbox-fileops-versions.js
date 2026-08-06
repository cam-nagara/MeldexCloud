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
  const content = await provider.readText(normalized);
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
