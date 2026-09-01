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

async function _conflictObject(provider, sourcePath, snapshot = null) {
  const normalized = _normalizeFolderPath(sourcePath);
  if (snapshot && _normalizeFolderPath(snapshot.path) === normalized) {
    return {
      type: 'file',
      name: _basename(normalized),
      bytes_base64: _bytesToManagedBase64(snapshot.bytes),
    };
  }
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

async function _backupConflictSide(provider, kind, sourcePath, stamp, snapshot = null) {
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
    object: await _conflictObject(provider, normalized, snapshot),
  });
  return `${window.MeldexSystemStorage.SystemStorageKind.CONFLICT_BACKUPS}/${documentId}`;
}

async function _conflictSnapshotSha256(bytes) {
  if (!globalThis.crypto?.subtle?.digest) {
    const error = new Error('競合世代の安全なhash確認に対応していません');
    error.status = 503;
    error.code = 'strict_cas_unavailable';
    throw error;
  }
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', view));
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
}

async function _readConflictSnapshot(provider, path) {
  if (typeof provider?.readBytesFresh !== 'function' || typeof provider?.uploadBytesConditional !== 'function') {
    const error = new Error('競合世代を固定する条件付き保存に対応していません');
    error.status = 503;
    error.code = 'strict_cas_unavailable';
    throw error;
  }
  const read = await provider.readBytesFresh(path);
  const bytes = read?.bytes instanceof Uint8Array ? read.bytes.slice() : new Uint8Array(read?.bytes || []);
  const revision = String(read?.revision || read?.rev || '').trim();
  if (!revision) {
    const error = new Error('競合ファイルの現在世代を確認できません');
    error.status = 503;
    error.code = 'strict_cas_unavailable';
    throw error;
  }
  return { path, bytes, revision, sha256: await _conflictSnapshotSha256(bytes) };
}

function _resolvedConflictTombstone(bytes) {
  try {
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return payload?.meldex_resolved_conflict === 1 ? payload : null;
  } catch {
    return null;
  }
}

function _conflictSnapshotPreview(snapshot, maxChars) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot?.bytes || new Uint8Array()); }
  catch { return { content: '', truncated: false, length: 0 }; }
  const limit = Number(maxChars || 200000);
  return {
    content: text.length <= limit ? text : text.slice(0, limit),
    truncated: text.length > limit,
    length: text.length,
  };
}

async function _retireResolvedConflict(provider, snapshot, action, backupPath) {
  const markerBytes = new TextEncoder().encode(JSON.stringify({
    meldex_resolved_conflict: 1,
    resolved_at: new Date().toISOString(),
    action: String(action || ''),
    source_revision: snapshot.revision,
    source_sha256: snapshot.sha256,
    backup_path: String(backupPath || ''),
  }));
  const markerSha256 = await _conflictSnapshotSha256(markerBytes);
  const marked = await provider.uploadBytesConditional(snapshot.path, markerBytes, snapshot.revision);
  const markerRevision = String(marked?.revision || marked?.rev || '').trim();
  if (!markerRevision) {
    const error = new Error('競合コピー退役後の世代を確認できません');
    error.status = 503;
    error.code = 'strict_cas_unavailable';
    throw error;
  }

  const hiddenName = `.${_safeNamePart(_basename(snapshot.path), 'conflict')}.meldex-resolved-${_randomId('r').replace(/[^a-z0-9]/gi, '')}.json`;
  const hiddenPath = _joinPath(_dirname(snapshot.path), hiddenName);
  try {
    await provider.movePath(snapshot.path, hiddenPath);
    const moved = await _readConflictSnapshot(provider, hiddenPath);
    if (moved.sha256 !== markerSha256) {
      let recoveryPath = hiddenPath;
      try {
        await provider.movePath(hiddenPath, snapshot.path);
        recoveryPath = snapshot.path;
      } catch {}
      const error = new Error('競合コピーが解消処理中に更新されました。新しい世代は上書きしていません');
      error.status = 409;
      error.code = 'conflict_generation_changed';
      error.recoveryPath = recoveryPath;
      throw error;
    }
    await provider.deletePath(hiddenPath);
    return { removed_path: snapshot.path, cleanup_pending: false };
  } catch (error) {
    if (error?.code === 'conflict_generation_changed') throw error;
    // CAS済みmarkerは元内容を管理backupへ移したことを示す。cleanupに失敗しても
    // markerを競合として再提示せず、利用者データを無条件deleteしない。
    return { removed_path: snapshot.path, cleanup_pending: true };
  }
}
