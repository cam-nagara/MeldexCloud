/* gb-data-access-dropbox-fileops-conflict-backups.js
 *
 * gb-data-access-dropbox-fileops-core.js の続き(同じ関数スコープに連結される
 * 継続ファイル。IIFEはここでは開かない・閉じない。詳細は core.js 冒頭コメント参照)。
 *
 * 固有形式付随物廃止・管理データ一元化計画 Phase 0 監査ノート§5「切り出し範囲の
 * 決定」の②競合バックアップクラスタ(Dropbox自身の競合コピーの検出・
 * バックアップ)。
 *
 * 競合バックアップはファイル／フォルダ内容を管理レコードへ埋め込み、
 * `SystemStorageKind.CONFLICT_BACKUPS` へ保存する。ユーザーの保存場所に
 * `_meldex/conflict-backups` を新規作成・更新しない。
 */

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

function _bytesToManagedBase64(bytes) {
  let binary = '';
  const data = new Uint8Array(bytes || []);
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function _conflictObject(provider, sourcePath) {
  const normalized = _normalizeFolderPath(sourcePath);
  const entry = await _resolveEntryHandle(provider, normalized);
  if (!entry) return null;
  if (entry.kind === 'file') {
    const file = await entry.handle.getFile();
    return {
      type: 'file',
      name: _basename(normalized),
      bytes_base64: _bytesToManagedBase64(await file.arrayBuffer()),
    };
  }
  const children = [];
  for (const child of await _listDirectoryEntries(provider, normalized)) {
    children.push(await _conflictObject(provider, child.path || _joinPath(normalized, child.name)));
  }
  return { type: 'folder', name: _basename(normalized), children: children.filter(Boolean) };
}

async function _backupConflictSide(provider, kind, sourcePath, stamp) {
  const normalized = _normalizeFolderPath(sourcePath);
  if (!normalized || !await _pathExists(provider, normalized)) return '';
  const adapter = await _managementAdapterForProvider(
    provider,
    window.MeldexSystemStorage.SystemStorageKind.CONFLICT_BACKUPS,
    normalized,
  );
  const documentId = `${_fnvFileId(normalized)}-${_randomId('c').replace(/[^a-z0-9]/gi, '').slice(-12)}`;
  await adapter.save(window.MeldexSystemStorage.SystemStorageKind.CONFLICT_BACKUPS, documentId, {
    kind,
    original_relative_path: normalized,
    created_at: stamp || _conflictBackupStamp(),
    object: await _conflictObject(provider, normalized),
  });
  return `${window.MeldexSystemStorage.SystemStorageKind.CONFLICT_BACKUPS}/${documentId}`;
}
