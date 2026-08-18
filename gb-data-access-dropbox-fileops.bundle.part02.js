      if (previous.state === 'completed') selected = previous.result;
      else {
        if (result?.ok !== true || result.operation_id !== operationId) throw new Error('Cloudファイル操作結果が不正です');
        operations[index] = { ...previous, state: 'completed', result: structuredClone(result),
          saved_at: new Date().toISOString() };
      }
      return { ...state, outliner_operations: _pruneCloudCopyOperations(operations) };
    });
    return selected;
  }

  async function _runCloudCopyAftercare(provider, operationId, operation, payload, record, steps, checkpoint = null) {
    let intent = structuredClone(record.intent || {});
    const completed = new Set(Array.isArray(intent.aftercare_completed) ? intent.aftercare_completed : []);
    intent.aftercare_required = steps.map(step => step.name);
    intent.aftercare_completed = [...completed];
    await _updateCloudCopyIntent(provider, operationId, operation, payload, intent);
    for (const step of steps) {
      if (completed.has(step.name)) continue;
      const inProgress = intent.aftercare_in_progress || null;
      if (inProgress && inProgress.name !== step.name) throw new Error('Cloud aftercareの実行中stepが一致しません');
      let current = null;
      if (checkpoint) {
        current = await checkpoint();
        const expected = intent.aftercare_manifest_digest || intent.manifest_digest;
        if (expected && current.manifest_digest !== expected && !inProgress) {
          throw Object.assign(new Error('Cloud folderがaftercare前に変更されています'), { status: 409 });
        }
      }
      const effect = intent.aftercare_effects?.[step.name] || null;
      if (inProgress) {
        const before = String(inProgress.before_manifest_digest || '');
        const currentDigest = String(current?.manifest_digest || '');
        if (effect && currentDigest === String(effect.after_manifest_digest || '')) {
          completed.add(step.name);
          intent.aftercare_completed = [...completed];
          if (checkpoint) intent.aftercare_manifest_digest = currentDigest;
          delete intent.aftercare_in_progress;
          await _updateCloudCopyIntent(provider, operationId, operation, payload, intent);
          continue;
        }
        if (checkpoint && currentDigest !== before) {
          throw Object.assign(new Error('実行中Cloud aftercareの前後manifestを証明できません'), { status: 409 });
        }
      }
      if (!inProgress) {
        intent.aftercare_in_progress = { name: step.name,
          before_manifest_digest: String(current?.manifest_digest || '') };
        await _updateCloudCopyIntent(provider, operationId, operation, payload, intent);
      }
      await step.run();
      const after = checkpoint ? await checkpoint() : null;
      intent.aftercare_effects = { ...(intent.aftercare_effects || {}),
        [step.name]: {
          before_manifest_digest: String(intent.aftercare_in_progress?.before_manifest_digest || ''),
          after_manifest_digest: String(after?.manifest_digest || ''),
        } };
      await _updateCloudCopyIntent(provider, operationId, operation, payload, intent);
      completed.add(step.name);
      intent.aftercare_completed = [...completed];
      if (checkpoint) intent.aftercare_manifest_digest = after.manifest_digest;
      delete intent.aftercare_in_progress;
      await _updateCloudCopyIntent(provider, operationId, operation, payload, intent);
    }
    return { ...record, intent };
  }

  window.MeldexCloudCopyOperationJournal = Object.freeze({
    withFlight: _withCloudCopyFlight,
    load: _loadCloudCopyOperation,
    listPrepared: _listPreparedCloudCopyOperations,
    listCompleted: _listCompletedCloudCopyOperations,
    prepare: _prepareCloudCopyOperation,
    updateIntent: _updateCloudCopyIntent,
    complete: _completeCloudCopyOperation,
    fail: _failCloudCopyOperation,
    rearm: _rearmCloudCopyOperation,
    runAftercare: _runCloudCopyAftercare,
  });
/* Stable identity copy transaction helpers. This continuation file is loaded
 * inside the gb-data-access-dropbox-fileops IIFE after the operation journal. */
  async function _freshProviderStat(provider, path) {
    if (typeof provider?.refreshMetadata === 'function') {
      return provider.refreshMetadata(path);
    } else if (typeof provider?.statPathFresh === 'function') {
      return provider.statPathFresh(path);
    }
    const error = new Error('fresh provider identityを取得できないため安全に停止しました');
    error.status = 503; error.meldexCode = 'fresh_provider_identity_unavailable';
    throw error;
  }
  async function _providerObjectIdentity(provider, path, fallback) {
    const value = await _freshProviderStat(provider, path);
    return _providerObjectRevision(value);
  }
  async function _freshPathExists(provider, path) {
    return Boolean(await _freshProviderStat(provider, path));
  }
  async function _freshWalkEntries(provider, path, limit = 1000) {
    if (typeof provider?.walkEntriesFresh !== 'function') {
      const error = new Error('fresh provider listingを取得できないため安全に停止しました');
      error.status = 503; error.meldexCode = 'fresh_provider_listing_unavailable';
      throw error;
    }
    return provider.walkEntriesFresh(path, { maxEntries: limit, maxPathBytes: 4 * 1024 * 1024 });
  }
  async function _freshDirectEntries(provider, path, limit = 1000) {
    const normalized = _normalizeFolderPath(path);
    return (await _freshWalkEntries(provider, normalized, limit))
      .filter(row => _dirname(row.path) === normalized)
      .map(row => ({ ...row, name: row.name || _basename(row.path), handle: row.handle || row }));
  }
  async function _readIdentityTextPreservingBytes(provider, path) {
    let bytes = null;
    if (typeof provider?.readBytesFresh === 'function') {
      bytes = (await provider.readBytesFresh(path))?.bytes || null;
    } else if (typeof provider?.downloadAsFile === 'function') {
      bytes = new Uint8Array(await (await provider.downloadAsFile(path)).arrayBuffer());
    }
    if (bytes) return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), bytes,
    };
    return { text: await provider.readText(path), bytes: null };
  }
  function _isIdentityTextPath(path) {
    return /\.(?:md|mel-board|mel-scenario|mel-timer|mel-sheet)$/i.test(String(path || ''));
  }
  function _cloudOrphanPayload(path, ownership, reason) {
    const providerId = ownership?.id || '';
    const providerRev = ownership?.rev || '';
    return {
      path, provider_id: providerId, provider_rev: providerRev,
      manifest_digest: '', proof: { provider_id: providerId, provider_rev: providerRev },
      reason,
    };
  }
  function _attachCloudOrphan(error, path, ownership, reason) {
    error.meldexOrphanStaging = _cloudOrphanPayload(path, ownership, reason);
    error.meldexCode = error.meldexCode || 'copy_staging_orphan_retained';
    return error;
  }
  async function _rollbackOwnedCloudCopy(provider, destPath, ownership) {
    const current = await _providerObjectIdentity(provider, destPath, null);
    if (!ownership?.id || !ownership?.rev || current.id !== ownership.id || current.rev !== ownership.rev) {
      const error = new Error('複製先が作成後に変更されたため自動補償を停止しました');
      error.status = 409; error.meldexCode = 'copy_rollback_ownership_conflict';
      throw error;
    }
    if (typeof provider.deletePathConditional !== 'function') {
      const error = new Error('revision条件付き削除を利用できないため自動補償を停止しました');
      error.status = 503; error.meldexCode = 'copy_rollback_strict_cas_unavailable';
      throw _attachCloudOrphan(error, destPath, ownership, 'strict_conditional_delete_unavailable');
    }
    try {
      await provider.deletePathConditional(destPath, ownership.rev);
    } catch (error) {
      if (Number(error?.status || 0) === 503) {
        throw _attachCloudOrphan(error, destPath, ownership, 'strict_conditional_delete_failed');
      }
      throw error;
    }
  }

  // IDを先に生成し、providerのcreate-only CASで保存してreadbackする。
  async function _copyFileWithNewIdentityTransaction(provider, sourcePath, destPath, isFile, options = {}) {
    if (!isFile) return { handled: false };
    if (!_isIdentityTextPath(destPath)) return { handled: false };
    const docIdentity = window.MeldexDocumentIdentity;
    const content = (await _readIdentityTextPreservingBytes(provider, sourcePath)).text;
    const fmt = docIdentity?.formatForPath?.(destPath, content);
    if (!fmt) return { handled: false };
    const result = docIdentity.regenerateDocumentId(content, fmt);
    if (!result?.changed || !result?.documentId) throw new Error('複製先のdocument_idを生成できません');
    if (typeof provider?.uploadBytesConditional !== 'function') {
      const error = new Error('create-only保存を利用できないため複製を中止しました');
      error.status = 503; error.meldexCode = 'strict_create_cas_unavailable';
      throw error;
    }
    if (typeof provider?.movePathNoReplace !== 'function') {
      const error = new Error('atomic no-replace publishを利用できないため複製を中止しました');
      error.status = 503; error.meldexCode = 'strict_move_cas_unavailable';
      throw error;
    }
    const nonce = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const stagingPath = _joinPath(_dirname(destPath), `.${_basename(destPath)}.meldex-copy-${nonce}.tmp`);
    let ownership = null;
    let published = false;
    try {
      const written = await provider.uploadBytesConditional(
        stagingPath, new TextEncoder().encode(result.text), null,
      );
      ownership = await _providerObjectIdentity(provider, stagingPath, written);
      if (!ownership.id || !ownership.rev) throw new Error('複製先のprovider ID/revisionを確認できません');
      const readback = (await _readIdentityTextPreservingBytes(provider, stagingPath)).text;
      const latest = await _providerObjectIdentity(provider, stagingPath, null);
      const readbackId = docIdentity.readDocumentId(readback, fmt);
      if (readback !== result.text || readbackId !== result.documentId
        || latest.id !== ownership.id || latest.rev !== ownership.rev) {
        throw new Error('複製先のidentity/revision readbackが一致しません');
      }
      if (typeof options.persistPublishProof === 'function') {
        await options.persistPublishProof({ provider_id: ownership.id,
          provider_rev: ownership.rev, manifest_digest: '', staging_path: stagingPath });
      }
      await provider.movePathNoReplace(stagingPath, destPath);
      published = true;
      const finalOwnership = await _providerObjectIdentity(provider, destPath, null);
      if (finalOwnership.id !== ownership.id || finalOwnership.rev !== ownership.rev) {
        throw new Error('atomic publish後のprovider ID/revisionが一致しません');
      }
      return {
        handled: true, ownership: finalOwnership,
        rollback: () => _rollbackOwnedCloudCopy(provider, destPath, ownership),
      };
    } catch (err) {
      if (ownership?.id && ownership?.rev) {
        await _rollbackOwnedCloudCopy(provider, published ? destPath : stagingPath, ownership);
      }
      throw err;
    }
  }

  async function _boundedCloudFolderManifest(provider, sourcePath, limit = 1000) {
    const rows = await _freshWalkEntries(provider, sourcePath, limit + 1);
    if (rows.length > limit) throw new Error('フォルダ複製の上限件数を超えています');
    return rows.map(row => ({
      path: row.path, kind: row.kind || row.handle?.kind || 'file', handle: row.handle || row,
    }));
  }

  async function _copyCloudManifestFile(provider, row, sourceRoot, destRoot) {
    const relative = row.path.slice(sourceRoot.length).replace(/^\/+/, '');
    const destPath = _joinPath(destRoot, relative);
    let bytes;
    let expectedText = null;
    if (_isIdentityTextPath(destPath)) {
      const sourceText = (await _readIdentityTextPreservingBytes(provider, row.path)).text;
      const fmt = window.MeldexDocumentIdentity?.formatForPath?.(destPath, sourceText);
      if (fmt) {
        const regenerated = window.MeldexDocumentIdentity.regenerateDocumentId(sourceText, fmt);
        if (!regenerated?.changed || !regenerated?.documentId) throw new Error('複製先のdocument_idを生成できません');
        expectedText = regenerated.text;
        bytes = new TextEncoder().encode(expectedText);
        if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('identity対象textの複製上限を超えています');
      }
    }
    if (!bytes) {
      if (typeof provider?.copyPath !== 'function') throw new Error('binary streaming copyを利用できません');
      await provider.copyPath(row.path, destPath);
      const ownership = await _providerObjectIdentity(provider, destPath, null);
      if (!ownership.id || !ownership.rev) throw new Error('複製先のprovider ID/revisionを確認できません');
      return { path: destPath, ownership };
    }
    const written = await provider.uploadBytesConditional(destPath, bytes, null);
    const ownership = await _providerObjectIdentity(provider, destPath, written);
    if (!ownership.id || !ownership.rev) throw new Error('複製先のprovider ID/revisionを確認できません');
    if (expectedText != null
        && (await _readIdentityTextPreservingBytes(provider, destPath)).text !== expectedText) {
      await _rollbackOwnedCloudCopy(provider, destPath, ownership);
      throw new Error('複製先のidentity readbackが一致しません');
    }
    return { path: destPath, ownership };
  }

  async function _cloudFolderIdentityProof(provider, rootPath) {
    const root = await _providerObjectIdentity(provider, rootPath, null);
    if (!root.id) throw new Error('複製先folder IDを確認できません');
    const rows = [{ path: '', kind: 'directory', id: root.id, rev: '' }];
    for (const row of await _boundedCloudFolderManifest(provider, rootPath)) {
      const identity = await _providerObjectIdentity(provider, row.path, row.handle);
      if (!identity.id || (row.kind !== 'directory' && !identity.rev)) {
        throw new Error('複製先folder manifest identityを確認できません');
      }
      rows.push({ path: row.path.slice(rootPath.length), kind: row.kind,
        id: identity.id, rev: row.kind === 'directory' ? '' : identity.rev });
    }
    return { provider_id: root.id, provider_rev: '',
      manifest_digest: await _cloudCopyDigest('', 'manifest', rows) };
  }

  async function _rollbackOwnedCloudFolder(provider, files, directories) {
    const errors = [];
    for (const item of [...files].reverse()) {
      try { await _rollbackOwnedCloudCopy(provider, item.path, item.ownership); }
      catch (error) { errors.push(error); }
    }
    if (directories.some(item => !item.ownership?.rev)) {
      const root = directories[0];
      const orphanPayload = _cloudOrphanPayload(
        root.path, root.ownership, 'directory_revision_unavailable');
      if (errors.length) {
        errors[0].meldexOrphanStaging = orphanPayload;
        errors[0].meldexCode = errors[0].meldexCode || 'copy_staging_orphan_retained';
        throw errors[0];
      }
      const orphan = new Error('revision条件付きfolder削除を利用できないため孤立一時フォルダを保全しました');
      orphan.status = 503; orphan.meldexCode = 'copy_staging_orphan_retained';
      orphan.meldexOrphanStaging = orphanPayload;
      throw orphan;
    }
    for (const item of [...directories].reverse()) {
      try {
        const current = await _providerObjectIdentity(provider, item.path, null);
        const children = await _freshDirectEntries(provider, item.path);
        if (current.id !== item.ownership.id
            || (item.ownership.rev && current.rev !== item.ownership.rev) || children.length) {
          throw new Error('複製先フォルダが変更されたため自動補償を停止しました');
        }
        if (!item.ownership.rev || typeof provider.deletePathConditional !== 'function') {
          const orphan = new Error('revision条件付きfolder削除を利用できないため孤立一時フォルダを保全しました');
          orphan.status = 503; orphan.meldexCode = 'copy_staging_orphan_retained';
          orphan.meldexOrphanStaging = _cloudOrphanPayload(
            item.path, item.ownership, 'directory_revision_unavailable');
          throw orphan;
        }
        await provider.deletePathConditional(item.path, item.ownership.rev);
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw errors[0];
  }

  async function _copyFolderWithIdentityTransaction(provider, sourcePath, destPath, isDirectory, options = {}) {
    if (!isDirectory) return { handled: false };
    if (typeof provider?.uploadBytesConditional !== 'function') {
      const error = new Error('create-only保存を利用できないためフォルダ複製を中止しました');
      error.status = 503; error.meldexCode = 'strict_create_cas_unavailable';
      throw error;
    }
    const manifest = await _boundedCloudFolderManifest(provider, sourcePath);
    const nonce = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const stagingPath = _joinPath(_dirname(destPath), `.${_basename(destPath)}.meldex-copy-${nonce}.tmp`);
    let files = [];
    let directories = [];
    let published = false;
    try {
      if (await _freshPathExists(provider, stagingPath) || await _freshPathExists(provider, destPath)) {
        throw new Error('複製先または一時保存先が既に存在します');
      }
      await _directoryHandle(provider, stagingPath, true);
      const rootOwnership = await _providerObjectIdentity(provider, stagingPath, null);
      if (!rootOwnership.id) throw new Error('複製先folder IDを確認できません');
      directories.push({ path: stagingPath, ownership: rootOwnership });
      for (const row of manifest) {
        const relative = row.path.slice(sourcePath.length).replace(/^\/+/, '');
        const target = _joinPath(stagingPath, relative);
        if (row.kind === 'directory') {
          await _directoryHandle(provider, target, true);
          const ownership = await _providerObjectIdentity(provider, target, null);
          if (!ownership.id) throw new Error('複製先folder IDを確認できません');
          directories.push({ path: target, ownership });
        } else {
          files.push(await _copyCloudManifestFile(provider, row, sourcePath, stagingPath));
        }
      }
      const stagingProof = await _cloudFolderIdentityProof(provider, stagingPath);
      if (typeof options.persistPublishProof === 'function') {
        await options.persistPublishProof({ ...stagingProof, staging_path: stagingPath });
      }
      if (typeof provider?.movePathNoReplace !== 'function') throw new Error('atomic no-replace folder publishを利用できません');
      if (await _freshPathExists(provider, destPath)) throw new Error('複製先が同時に作成されました');
      await provider.movePathNoReplace(stagingPath, destPath);
      published = true;
      const rebind = async item => {
        const path = destPath + item.path.slice(stagingPath.length);
        const current = await _providerObjectIdentity(provider, path, null);
        const isFile = Boolean(item.ownership.rev);
        if (current.id !== item.ownership.id || (isFile && current.rev !== item.ownership.rev)) {
          throw new Error('atomic publish後のprovider ID/revisionが一致しません');
        }
        return { path, ownership: current };
      };
      files = await Promise.all(files.map(rebind));
      directories = await Promise.all(directories.map(rebind));
      const finalProof = await _cloudFolderIdentityProof(provider, destPath);
      if (finalProof.provider_id !== stagingProof.provider_id
          || finalProof.manifest_digest !== stagingProof.manifest_digest) {
        throw new Error('atomic publish後のfolder manifestが一致しません');
      }
      return {
        handled: true, ownership: directories[0]?.ownership || null,
        manifest_digest: finalProof.manifest_digest,
        rollback: () => _rollbackOwnedCloudFolder(provider, files, directories),
      };
    } catch (error) {
      if (published) {
        files = files.map(item => ({ ...item, path: destPath + item.path.slice(stagingPath.length) }));
        directories = directories.map(item => ({ ...item, path: destPath + item.path.slice(stagingPath.length) }));
      }
      try {
        await _rollbackOwnedCloudFolder(provider, files, directories);
      } catch (rollbackError) {
        if (rollbackError?.meldexOrphanStaging) {
          error.meldexOrphanStaging = rollbackError.meldexOrphanStaging;
          error.meldexCode = error.meldexCode || rollbackError.meldexCode;
        } else {
          throw rollbackError;
        }
      }
      throw error;
    }
  }

  async function _copyPathWithIdentityTransaction(provider, sourcePath, destPath, kind, options = {}) {
    if (kind === 'directory') {
      return _copyFolderWithIdentityTransaction(provider, sourcePath, destPath, true, options);
    }
    const identityCopy = await _copyFileWithNewIdentityTransaction(
      provider, sourcePath, destPath, true, options,
    );
    if (identityCopy.handled) return identityCopy;
    if (typeof provider?.copyPath !== 'function' || typeof provider?.movePathNoReplace !== 'function') {
      throw new Error('atomic binary copyを利用できません');
    }
    const nonce = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const stagingPath = _joinPath(_dirname(destPath), `.${_basename(destPath)}.meldex-copy-${nonce}.tmp`);
    await provider.copyPath(sourcePath, stagingPath);
    const ownership = await _providerObjectIdentity(provider, stagingPath, null);
    if (!ownership.id || !ownership.rev) throw new Error('binary copyのprovider ID/revisionを確認できません');
    try {
      if (typeof options.persistPublishProof === 'function') {
        await options.persistPublishProof({ provider_id: ownership.id,
          provider_rev: ownership.rev, manifest_digest: '', staging_path: stagingPath });
      }
      await provider.movePathNoReplace(stagingPath, destPath);
      const published = await _providerObjectIdentity(provider, destPath, null);
      if (published.id !== ownership.id || published.rev !== ownership.rev) {
        throw new Error('binary copyのatomic publish結果が一致しません');
      }
      return { handled: true, ownership: published,
        rollback: () => _rollbackOwnedCloudCopy(provider, destPath, published) };
    } catch (error) {
      await _rollbackOwnedCloudCopy(provider, stagingPath, ownership);
      throw error;
    }
  }
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
/* gb-data-access-dropbox-fileops-annotations.js
 *
 * gb-data-access-dropbox-fileops-core.js の続き(同じ関数スコープに連結される
 * 継続ファイル。IIFEはここでは開かない・閉じない。詳細は core.js 冒頭コメント参照)。
 *
 * 固有形式付随物廃止・管理データ一元化計画 Phase 0 監査ノート§5「切り出し範囲の
 * 決定」の③注釈クラスタ。Phase 4でこのクラスタを実際に共通ストレージ層
 * (gb-system-storage.js、種別 annotations)へ載せ替える。
 *
 * ## 保存先の変更
 *
 * 旧: `_events/annotations/<id>.json` への直接読み書き。
 * 新: 共通ストレージ層(document_id = 注釈id)。個人領域は `/MeldexSettings/system/v1`、
 *     参加中の共有ワークスペードに接続している場合は `<ワークスペード>/MeldexShare/system/v1`
 *     (gb-dropbox-management-root-resolver.js が判定)。
 *
 * 旧パスは読取フォールバックとしてのみ残す(移行はPhase 5。新規の書込は一切
 * 旧パスへ行わない)。SystemStorage上の削除は対象scope/revisionを一意に確定し、
 * CAS tombstoneとして保持する。旧パスだけに存在するrecordのみ旧削除経路を使う。
 */

const ANNOTATION_DIR = '_events/annotations'; // 旧パス読取フォールバック専用(新規書込では使わない)
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

function _annotationTargetResolver() {
  const resolver = window.MeldexCloudAnnotationTargetResolver;
  if (!resolver) throw new Error('gb-cloud-annotation-target-resolver.js が読み込まれていません');
  return resolver;
}

async function _migrateAnnotationStoredRecord(provider, adapter, docId) {
  const contract = window.MeldexSystemStorage;
  const boundary = adapter?.describe?.().boundary;
  if (!boundary) throw new Error('注釈のDropbox adapter boundaryを確認できません');
  return _annotationTargetResolver().migrateRecord({
    provider, adapter, boundary, kind: contract.SystemStorageKind.ANNOTATIONS,
    documentId: docId, operationId: `annotation-lazy-migrate:${docId}`,
  });
}

function _annotationPath(id) {
  return _joinPath(ANNOTATION_DIR, _safeId(id, 'annotation id') + '.json');
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

// --- 保存(共通ストレージ層。固有形式付随物廃止・管理データ一元化計画 Phase 4) ---
//
// 書込は record.target_path から個人/共有ワークスペースの管理スコープを解決する。
// 一方、idしか受け取らない読取・削除と全件一覧は書込先スコープを一意に特定
// できないため、resolveManagementScopesForProvider が返す全スコープ(接続中
// ルート + 登録ソース由来の共有ワークスペース)を集約して、書込先と読取・
// 削除先が分裂しないようにする(個人Vault接続のまま共有ソースの文書へ注釈を
// 付けた場合、共有管理領域に保存されたその注釈を同じセッションで読めること)。

async function _annotationScopes(provider) {
  const resolver = window.MeldexDropboxManagementRootResolver;
  if (!resolver || typeof resolver.resolveManagementScopesForProvider !== 'function') {
    throw new Error('gb-dropbox-management-root-resolver.js が読み込まれていません');
  }
  return resolver.resolveManagementScopesForProvider(provider);
}

function _annotationUnavailable(error, operation) {
  if (error?.status === 409 || error?.status === 410 || error?.status === 503) return error;
  const wrapped = new Error(`注釈SystemStorageの${operation}に失敗しました`);
  wrapped.status = 503; wrapped.code = 'annotation_storage_unavailable'; wrapped.cause = error;
  return wrapped;
}

function _annotationDeleted(record) {
  return record?.deleted === true || record?.tombstone === true
    || String(record?.state || '') === 'deleted' || String(record?.status || '') === 'tombstoned';
}

async function _findAnnotationRecordsById(provider, docId) {
  const kind = window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS;
  let scopes;
  try { scopes = await _annotationScopes(provider); } catch (error) { throw _annotationUnavailable(error, 'scope解決'); }
  const matches = [];
  for (const scope of scopes) {
    let stored;
    try { stored = await scope.adapter.load(kind, docId); } catch (error) { throw _annotationUnavailable(error, '読込'); }
    if (stored) matches.push({ scope, stored });
  }
  if (matches.length > 1) {
    const error = new Error('同じ注釈IDが複数の管理スコープに存在します');
    error.status = 409; error.code = 'annotation_scope_ambiguous'; throw error;
  }
  return matches;
}

async function _readAnnotationRecord(provider, id, targetPathHint) {
  const docId = _safeId(id, 'annotation id');
  const contract = window.MeldexSystemStorage;
  const hint = _normalizeFolderPath(targetPathHint || '');
  if (hint) {
    let scope; let stored;
    try { scope = await window.MeldexDropboxManagementRootResolver.resolveManagementScopeForPath(provider, hint); }
    catch (error) { throw _annotationUnavailable(error, 'scope解決'); }
    try { stored = await scope.adapter.load(contract.SystemStorageKind.ANNOTATIONS, docId); }
    catch (error) { throw _annotationUnavailable(error, '読込'); }
    if (stored) {
      const migrated = await _migrateAnnotationStoredRecord(provider, scope.adapter, docId);
      return migrated.record?.payload && typeof migrated.record.payload === 'object' ? migrated.record.payload : null;
    }
    const legacy = await _readJsonSafe(provider, _annotationPath(docId), null);
    return legacy && typeof legacy === 'object' ? legacy : null;
  }
  const matches = await _findAnnotationRecordsById(provider, docId);
  if (matches.length === 1) {
    const migrated = await _migrateAnnotationStoredRecord(provider, matches[0].scope.adapter, docId);
    return migrated.record?.payload && typeof migrated.record.payload === 'object' ? migrated.record.payload : null;
  }
  const legacy = await _readJsonSafe(provider, _annotationPath(docId), null);
  return legacy && typeof legacy === 'object' ? legacy : null;
}

async function _writeAnnotationRecord(provider, record) {
  const docId = _safeId(record.id, 'annotation id');
  const adapter = await _managementAdapterForProvider(
    provider,
    window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS,
    record.target_path || record.path || '',
  );
  const kind = window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS;
  await adapter.save(kind, docId, record);
  const migrated = await _migrateAnnotationStoredRecord(provider, adapter, docId);
  await _annotationTargetResolver().indexUpsert(adapter, kind, migrated.record?.payload || record);
}

// created-image-identity aftercare(gb-created-image-identity-aftercare.js)が
// identity claimと同じ保留/復帰の対象へ注釈書込みを含められるようにする登録。
// 素のオブジェクトへの代入のみで行い、2ファイル間の読込順に依存しない
// (aftercare側は実行時にこのレジストリを参照するため、このファイルが
// aftercare側より先に読み込まれても後に読み込まれても問題ない)。
window.MeldexCreatedImageIdentityAftercarePendingWriters = window.MeldexCreatedImageIdentityAftercarePendingWriters || {};
window.MeldexCreatedImageIdentityAftercarePendingWriters['annotation-record'] = (provider, payload) => _writeAnnotationRecord(provider, payload);

async function _deleteAnnotationRecordFully(provider, id) {
  const docId = _safeId(id, 'annotation id');
  const contract = window.MeldexSystemStorage;
  const matches = await _findAnnotationRecordsById(provider, docId);
  if (matches.length === 1) {
    const match = matches[0];
    const tombstoned = await _annotationTargetResolver().tombstoneStoredRecord({
      adapter: match.scope.adapter, kind: contract.SystemStorageKind.ANNOTATIONS,
      documentId: docId, expectedRevision: match.stored.revision,
    });
    await _annotationTargetResolver().indexTombstone(
      match.scope.adapter, contract.SystemStorageKind.ANNOTATIONS, tombstoned.payload,
    );
    return;
  }
  const legacy = await _readJsonSafe(provider, _annotationPath(docId), null);
  if (legacy) await provider.deletePath(_annotationPath(docId));
}

async function _coverAnnotationIndexBatch(provider, scope, kind) {
  const resolver = _annotationTargetResolver();
  const coverage = await resolver.indexCoverage(scope.adapter, kind);
  if (typeof scope.adapter.listDocumentHeaders !== 'function'
      || typeof scope.adapter.documentCollectionGeneration !== 'function') {
    throw _annotationUnavailable(new Error('metadata generation API unavailable'), '索引coverage確認');
  }
  const generation = await scope.adapter.documentCollectionGeneration(kind, {
    excludeDocumentIds: [resolver.INDEX_ID],
  });
  if (coverage.complete && coverage.revision === generation) return coverage;
  const page = await scope.adapter.listDocumentHeaders(kind, { cursor: coverage.cursor, limit: 50 });
  const rows = [];
  for (const header of page.entries || []) {
    if (header.documentId === resolver.INDEX_ID) continue;
    const stored = await scope.adapter.load(kind, header.documentId);
    if (!stored?.payload) continue;
    if (_annotationDeleted(stored.payload)) { rows.push(stored.payload); continue; }
    const migrated = await _migrateAnnotationStoredRecord(provider, scope.adapter, header.documentId);
    if (migrated.record?.payload) rows.push(migrated.record.payload);
  }
  let complete = page.complete === true;
  if (complete) {
    const readbackGeneration = await scope.adapter.documentCollectionGeneration(kind, {
      excludeDocumentIds: [resolver.INDEX_ID],
    });
    complete = readbackGeneration === generation;
  }
  const next = { cursor: page.cursor || '', revision: generation, complete };
  await resolver.indexCoverBatch(scope.adapter, kind, rows, next);
  return next;
}

async function _listAnnotationRecords(provider, query) {
  const contract = window.MeldexSystemStorage;
  const records = [];
  const seenIds = new Set();
  const scopeOwnersById = new Map();
  let scopes;
  try { scopes = await _annotationScopes(provider); } catch (error) { throw _annotationUnavailable(error, 'scope解決'); }
  for (const scope of scopes) {
    let stored = [];
    try {
      const kind = contract.SystemStorageKind.ANNOTATIONS;
      if (query && (query.bulk || query.annId || query.targetId || query.targetPath)) {
        const coverage = await _coverAnnotationIndexBatch(provider, scope, kind);
        if (!coverage.complete) {
          const error = new Error('注釈metadata indexを構築中です。再試行してください');
          error.status = 503; error.code = 'annotation_index_incomplete'; throw error;
        }
        const ids = await _annotationTargetResolver().indexedIds(scope.adapter, kind, query);
        for (const id of ids) {
          const item = await scope.adapter.load(kind, id);
          if (item) stored.push(item);
        }
      } else {
        let cursor = '';
        do {
          if (typeof scope.adapter.listDocumentHeaders !== 'function') throw new Error('metadata header API unavailable');
          const page = await scope.adapter.listDocumentHeaders(kind, { cursor, limit: 100 });
          for (const header of page.entries || []) {
            if (header.documentId === _annotationTargetResolver().INDEX_ID) continue;
            const item = await scope.adapter.load(kind, header.documentId);
            if (item) stored.push(item);
          }
          cursor = page.complete ? '' : page.cursor;
          if (!page.complete && !cursor) throw new Error('metadata cursor missing');
        } while (cursor);
      }
    } catch (error) { throw _annotationUnavailable(error, '一覧読込'); }
    for (const id of await _annotationTargetResolver().indexedKnownIds(
      scope.adapter, contract.SystemStorageKind.ANNOTATIONS,
    )) {
      const key = String(id);
      const owners = scopeOwnersById.get(key) || new Set();
      owners.add(String(scope.scopeKey || scope.adapter?.describe?.().boundary || 'unknown'));
      scopeOwnersById.set(key, owners);
      if (owners.size > 1) {
        const error = new Error('同じ注釈IDが複数の管理スコープに存在します');
        error.status = 409; error.code = 'annotation_scope_ambiguous'; throw error;
      }
      seenIds.add(key);
    }
    for (const item of stored) {
      let payload = item?.payload;
      if (_annotationDeleted(payload)) continue;
      if (payload && typeof payload === 'object' && payload.id) {
        const migrated = await _migrateAnnotationStoredRecord(provider, scope.adapter, String(payload.id));
        payload = migrated.record?.payload || payload;
      }
      if (payload && typeof payload === 'object' && payload.id) {
        const id = String(payload.id);
        if (records.some(existing => String(existing.id) === id)) {
          const error = new Error('同じ注釈IDが複数の管理スコープに存在します');
          error.status = 409; error.code = 'annotation_scope_ambiguous'; throw error;
        }
        records.push(payload); seenIds.add(id);
      }
    }
  }
  // 旧パス(_events/annotations)は読取フォールバック専用。新ストレージに
  // 既にある同一idは、新ストレージ側の内容を優先する(移行はPhase 5)。
  let legacyEntries = [];
  try {
    legacyEntries = await _listDirectoryEntries(provider, ANNOTATION_DIR);
  } catch {
    legacyEntries = [];
  }
  for (const entry of legacyEntries) {
    if (entry.handle.kind !== 'file' || !entry.name.endsWith('.json')) continue;
    const id = entry.name.slice(0, -5);
    if (seenIds.has(id)) continue;
    const record = await _readJsonSafe(provider, _annotationPath(id), null);
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
