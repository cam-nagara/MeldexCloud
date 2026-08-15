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
