/* Cloud annotation target identity resolver and lazy record migration. */
(function () {
  'use strict';
  if (window.MeldexCloudAnnotationTargetResolver) return;

  const INDEX_ID = 'annotation-target-index-v1';
  const INDEX_SCHEMA = 2;
  const MAX_RETRIES = 5;
  const MAX_ALIASES = 32;

  class AnnotationTargetError extends Error {
    constructor(message, status = 409, code = 'annotation_target_conflict') {
      super(message); this.name = 'AnnotationTargetError'; this.status = status; this.meldexCode = code;
    }
  }

  function text(value) { return String(value == null ? '' : value).normalize('NFC').trim(); }
  function path(value) { return text(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/'); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function identity(value) {
    if (!value || typeof value !== 'object') return null;
    const kind = text(value.kind); const uid = text(value.uid);
    return new Set(['document', 'asset', 'entry']).has(kind) && uid ? { kind, uid } : null;
  }
  function migrationBlocked(record) {
    return record?.deleted === true || record?.tombstone === true
      || text(record?.state) === 'deleted' || text(record?.status) === 'tombstoned';
  }
  function conflict(error) {
    return error?.name === 'SystemStorageConflictError'
      || error instanceof (window.MeldexSystemStorage?.SystemStorageConflictError || Function);
  }
  async function freshStat(provider, targetPath) {
    if (typeof provider?.refreshMetadata === 'function') return provider.refreshMetadata(targetPath);
    if (typeof provider?.statPathFresh === 'function') return provider.statPathFresh(targetPath);
    throw new AnnotationTargetError('fresh Dropbox metadata契約を利用できません', 503, 'fresh_metadata_unavailable');
  }
  function providerIdentity(meta) {
    return {
      id: text(meta?.id || meta?.providerId || meta?.provider_id || meta?.handle?.id),
      rev: text(meta?.rev || meta?.revision || meta?.handle?.rev),
    };
  }
  async function freshProviderIdentity(provider, targetPath) {
    const result = providerIdentity(await freshStat(provider, path(targetPath)));
    if (!result.id || !result.rev) {
      throw new AnnotationTargetError('fresh Dropbox provider identityが欠損しています', 503, 'fresh_metadata_unavailable');
    }
    return result;
  }
  async function freshAssetProof(provider, targetPath, identityValue) {
    if (typeof provider?.readBytesFresh !== 'function') {
      throw new AnnotationTargetError('asset fresh bytes契約を利用できません', 503, 'fresh_bytes_unavailable');
    }
    const read = await provider.readBytesFresh(path(targetPath));
    const bytes = read?.bytes instanceof Uint8Array ? read.bytes
      : (read?.bytes instanceof ArrayBuffer ? new Uint8Array(read.bytes) : null);
    if (!bytes || text(read?.revision) !== identityValue.rev) {
      throw new AnnotationTargetError('asset move bytes/revisionが一致しません', 409, 'annotation_move_identity_mismatch');
    }
    const hashed = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashed), value => value.toString(16).padStart(2, '0')).join('');
  }
  function explicitIdentity(record) {
    const direct = identity(record?.target_identity);
    if (direct) return direct;
    const ref = record?.target_ref && typeof record.target_ref === 'object' ? record.target_ref : {};
    const entryId = text(ref.entryId || ref.entry_id);
    if (entryId) return { kind: 'entry', uid: entryId };
    const assetId = text(ref.assetId || ref.asset_id);
    if (assetId) return { kind: 'asset', uid: assetId };
    const documentId = text(ref.documentId || ref.document_id);
    return documentId ? { kind: 'document', uid: documentId } : null;
  }
  async function discoverIdentity(provider, record) {
    const direct = explicitIdentity(record);
    if (direct) return direct;
    const targetPath = path(record?.target_path);
    if (!targetPath) return null;
    if (typeof provider?.readBytesFresh !== 'function') {
      throw new AnnotationTargetError('fresh Dropbox bytes契約を利用できません', 503, 'fresh_bytes_unavailable');
    }
    let read;
    try { read = await provider.readBytesFresh(targetPath); } catch (error) {
      throw new AnnotationTargetError(`fresh Dropbox bytesを取得できません: ${error?.message || error}`, 503, 'fresh_bytes_unavailable');
    }
    const bytes = read?.bytes;
    if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer)) {
      throw new AnnotationTargetError('fresh Dropbox bytesが欠損しています', 503, 'fresh_bytes_unavailable');
    }
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
    const helper = window.MeldexDocumentIdentity;
    const format = helper?.formatForPath?.(targetPath, content);
    const uid = format ? text(helper.readDocumentId(content, format)) : '';
    if (!uid) return null;
    const meta = providerIdentity(await freshStat(provider, targetPath));
    if (!meta.id || !meta.rev || (read.revision && text(read.revision) !== meta.rev)) {
      throw new AnnotationTargetError('アノテート対象のfresh bytes/revisionが一致しません', 409, 'annotation_target_revision_changed');
    }
    return { kind: 'document', uid };
  }

  async function resolveTarget({ provider, adapter, boundary, record }) {
    const targetIdentity = await discoverIdentity(provider, record);
    if (!targetIdentity) return { count: 0, mode: 'legacy', identity: null, canonical: null };
    const claims = window.MeldexIdentityClaims;
    if (!claims?.resolveIdentity) throw new AnnotationTargetError('typed identity claim resolverを利用できません', 503, 'identity_claims_unavailable');
    const resolved = await claims.resolveIdentity(adapter, boundary, targetIdentity.kind, targetIdentity.uid);
    if (resolved.status === 'tombstoned') {
      throw new AnnotationTargetError('削除済みのアノテート対象は復活できません', 410, 'annotation_target_tombstoned');
    }
    if (resolved.count > 1 || resolved.status === 'ambiguous') {
      throw new AnnotationTargetError('アノテート対象のtyped identityが複数候補です', 409, 'annotation_target_ambiguous');
    }
    if (resolved.count !== 1 || !resolved.canonical) {
      return { count: 0, mode: 'legacy', identity: targetIdentity, canonical: null };
    }
    const currentPath = path(record?.target_path || resolved.canonical.source_locator);
    const meta = providerIdentity(await freshStat(provider, currentPath));
    if (!meta.id || meta.id !== text(resolved.canonical.provider_id)) {
      throw new AnnotationTargetError('アノテート対象のDropbox identityがclaimと一致しません', 409, 'annotation_target_provider_mismatch');
    }
    return { count: 1, mode: 'typed', identity: targetIdentity, canonical: clone(resolved.canonical) };
  }

  function validateAliases(record, targetIdentity) {
    const aliases = Array.isArray(record?.legacy_target_aliases) ? record.legacy_target_aliases : [];
    if (aliases.length > MAX_ALIASES) throw new AnnotationTargetError('アノテート対象alias上限を超えました');
    const seen = new Set();
    for (const item of aliases) {
      const key = `${text(item?.target_id)}\0${path(item?.target_path)}`;
      const destination = identity(item?.target);
      if (!key.replace('\0', '') || !destination) throw new AnnotationTargetError('アノテート対象aliasが欠損しています');
      if (!targetIdentity || destination.kind !== targetIdentity.kind || destination.uid !== targetIdentity.uid) {
        throw new AnnotationTargetError('アノテート対象alias hopは許可されません');
      }
      if (seen.has(key)) throw new AnnotationTargetError('アノテート対象alias cycle/重複を検出しました');
      seen.add(key);
    }
    return aliases.map(clone);
  }

  function migratedPayload(record, resolved, operationId, now) {
    const targetIdentity = resolved.identity;
    const aliases = validateAliases(record, targetIdentity);
    const previous = { target_id: text(record?.target_id), target_path: path(record?.target_path) };
    const aliasKey = `${previous.target_id}\0${previous.target_path}`;
    if ((previous.target_id || previous.target_path) && !aliases.some(item => `${text(item.target_id)}\0${path(item.target_path)}` === aliasKey)) {
      aliases.push({
        type: 'legacy-path-fnv', target_id: previous.target_id, target_path: previous.target_path,
        target: clone(targetIdentity), migration_operation_id: operationId, created_at: now,
      });
    }
    if (aliases.length > MAX_ALIASES) aliases.splice(0, aliases.length - MAX_ALIASES);
    return Object.assign({}, record, {
      target_identity: clone(targetIdentity), target_canonical: clone(resolved.canonical),
      legacy_target_aliases: aliases,
      target_migration: { migration_operation_id: operationId, previous_target: previous, migrated_at: now },
    });
  }

  async function saveReadback(adapter, kind, documentId, payload, expectedRevision) {
    const saved = await adapter.save(kind, documentId, payload, { expectedRevision });
    const readback = await adapter.load(kind, documentId);
    if (!readback || readback.revision !== saved.revision || !equal(readback.payload, payload)) {
      throw new AnnotationTargetError('アノテートrecordのCAS readbackに失敗しました', 409, 'annotation_migration_readback_failed');
    }
    return readback;
  }

  async function rebindClaimAfterMove({ provider, adapter, boundary, targetIdentity, oldPath, newPath, oldProviderIdentity }) {
    const claims = window.MeldexIdentityClaims;
    const kind = window.MeldexSystemStorage.SystemStorageKind.IDENTITY_CLAIMS;
    const oldLocator = path(oldPath); const newLocator = path(newPath);
    const oldProvider = providerIdentity(oldProviderIdentity);
    const freshNew = await freshProviderIdentity(provider, newLocator);
    if (!oldProvider.id || !oldProvider.rev || freshNew.id !== oldProvider.id) {
      throw new AnnotationTargetError('移動前後のDropbox identityが一致しません', 409, 'annotation_move_identity_mismatch');
    }
    const assetSha256 = targetIdentity.kind === 'asset'
      ? await freshAssetProof(provider, newLocator, freshNew) : '';
    const rebindProviderLocator = async () => {
      if (targetIdentity.kind !== 'asset') return;
      if (!claims.rebindProviderLocator) {
        throw new AnnotationTargetError('asset provider locator rebind契約を利用できません');
      }
      await claims.rebindProviderLocator(
        adapter, boundary, targetIdentity.kind, targetIdentity.uid, 'dropbox', oldProvider.id,
        oldLocator, newLocator, freshNew.rev, assetSha256,
      );
    };
    // Asset bytes/proofをmain claimより先に検証し、内容差替え時は片側rebindを防ぐ。
    await rebindProviderLocator();
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const resolved = await claims.resolveIdentity(adapter, boundary, targetIdentity.kind, targetIdentity.uid);
      if (resolved.status === 'tombstoned') throw new AnnotationTargetError('削除済みclaimは移動できません', 410, 'annotation_target_tombstoned');
      if (resolved.count !== 1 || !resolved.canonical) throw new AnnotationTargetError('移動対象claimが一意ではありません', 409, 'annotation_target_ambiguous');
      if (text(resolved.canonical.provider_id) !== oldProvider.id) {
        throw new AnnotationTargetError('移動対象claimが別Dropbox objectを指しています', 409, 'annotation_target_foreign_claim');
      }
      if (path(resolved.canonical.source_locator) === newLocator) {
        await rebindProviderLocator();
        return resolved.canonical;
      }
      if (path(resolved.canonical.source_locator) !== oldLocator) {
        throw new AnnotationTargetError('移動対象claim locatorが移動元と一致しません', 409, 'annotation_target_foreign_claim');
      }
      const key = await claims.claimKey(boundary, targetIdentity.kind, targetIdentity.uid);
      const current = await adapter.load(kind, key);
      if (!current?.payload || current.payload.status !== 'active'
          || (current.payload.conflicting_canonicals || []).length) {
        throw new AnnotationTargetError('移動対象claimが一意ではありません', 409, 'annotation_target_ambiguous');
      }
      const currentCanonical = current.payload.canonical || {};
      if (text(current.payload.boundary) !== text(boundary)
          || text(current.payload.kind) !== targetIdentity.kind
          || text(current.payload.uid) !== targetIdentity.uid
          || text(currentCanonical.provider_id) !== oldProvider.id
          || path(currentCanonical.source_locator) !== oldLocator) {
        throw new AnnotationTargetError('移動対象claimが競合中に変更されました', 409, 'annotation_target_foreign_claim');
      }
      const next = Object.assign({}, current.payload, {
        canonical: Object.assign({}, current.payload.canonical, { source_locator: newLocator }),
        claim_revision: Number(current.payload.claim_revision || 0) + 1,
      });
      try {
        await saveReadback(adapter, kind, key, next, current.revision);
        await rebindProviderLocator();
        return next.canonical;
      } catch (error) {
        if (!conflict(error)) throw error;
      }
    }
    throw new AnnotationTargetError('claim rebindのCAS retry上限に達しました');
  }

  async function migrateRecord({ provider, adapter, boundary, kind, documentId, operationId, maxRetries = MAX_RETRIES }) {
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      const current = await adapter.load(kind, documentId);
      if (!current?.payload) return { mode: 'missing', record: null };
      if (migrationBlocked(current.payload)) throw new AnnotationTargetError('削除済みアノテートrecordは移行できません', 410, 'annotation_record_deleted');
      const resolved = await resolveTarget({ provider, adapter, boundary, record: current.payload });
      if (resolved.mode === 'legacy') return { mode: 'legacy', record: current };
      if (identity(current.payload.target_identity)) {
        validateAliases(current.payload, resolved.identity);
        return { mode: 'typed', record: current, identity: resolved.identity };
      }
      const next = migratedPayload(current.payload, resolved, text(operationId) || `annotation-migrate:${documentId}`, new Date().toISOString());
      try {
        const saved = await saveReadback(adapter, kind, documentId, next, current.revision);
        return { mode: 'typed', record: saved, identity: resolved.identity, migrated: true };
      } catch (error) {
        if (!conflict(error)) throw error;
      }
    }
    throw new AnnotationTargetError('アノテートrecordのCAS retry上限に達しました');
  }

  function indexRow(record) {
    return {
      id: text(record?.id), target_path: path(record?.target_path), target_id: text(record?.target_id),
      target_identity: identity(record?.target_identity), target_kind: text(record?.target_kind),
      target_ref: record?.target_ref && typeof record.target_ref === 'object' ? clone(record.target_ref) : null,
      user: text(record?.user), type: text(record?.type), created: text(record?.created), modified: text(record?.modified),
      tombstone: migrationBlocked(record),
    };
  }
  async function mutateIndex(adapter, kind, callback, nextCoverage) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const current = await adapter.load(kind, INDEX_ID);
      const payload = current?.payload?.schema_version === INDEX_SCHEMA ? clone(current.payload) : {
        schema_version: INDEX_SCHEMA, entries: {},
        coverage: { cursor: '', revision: '', complete: false },
      };
      if (!payload.entries || typeof payload.entries !== 'object' || Array.isArray(payload.entries)) payload.entries = {};
      if (!payload.coverage || typeof payload.coverage !== 'object') payload.coverage = { cursor: '', revision: '', complete: false };
      callback(payload.entries);
      if (nextCoverage) payload.coverage = {
        cursor: text(nextCoverage.cursor), revision: text(nextCoverage.revision), complete: nextCoverage.complete === true,
      };
      try { return await saveReadback(adapter, kind, INDEX_ID, payload, current ? current.revision : null); } catch (error) {
        if (!conflict(error)) throw error;
      }
    }
    throw new AnnotationTargetError('アノテートmetadata indexのCAS retry上限に達しました');
  }
  async function indexUpsert(adapter, kind, record) {
    const row = indexRow(record); if (!row.id) throw new AnnotationTargetError('アノテートmetadata idが欠損しています');
    return mutateIndex(adapter, kind, entries => { entries[row.id] = row; });
  }
  async function indexDelete(adapter, kind, documentId) {
    return mutateIndex(adapter, kind, entries => { delete entries[text(documentId)]; });
  }
  async function indexTombstone(adapter, kind, record) {
    const row = indexRow(record); if (!row.id) throw new AnnotationTargetError('アノテートtombstone idが欠損しています');
    row.tombstone = true;
    return mutateIndex(adapter, kind, entries => { entries[row.id] = row; });
  }
  async function indexedIds(adapter, kind, query = {}) {
    const current = await adapter.load(kind, INDEX_ID);
    const entries = current?.payload?.schema_version === INDEX_SCHEMA ? current.payload.entries || {} : {};
    const targetPath = path(query.targetPath); const targetId = text(query.targetId); const annId = text(query.annId);
    const user = text(query.user); const annotationType = text(query.annType);
    const folderPrefix = !!query.folderPrefix;
    const rows = Object.values(entries).filter(row => {
      if (row.tombstone === true) return false;
      if (annId) return row.id === annId;
      if (targetId && row.target_id !== targetId) return false;
      if (targetPath && row.target_path !== targetPath && !(folderPrefix && row.target_path.startsWith(targetPath + '/'))) return false;
      if (user && row.user !== user) return false;
      if (annotationType && row.type !== annotationType) return false;
      return true;
    }).sort((a, b) => text(b.created).localeCompare(text(a.created)));
    const limit = Math.max(1, Math.min(200, Number(query.limit || 200)));
    return rows.slice(0, limit).map(row => row.id);
  }

  async function indexedKnownIds(adapter, kind) {
    const current = await adapter.load(kind, INDEX_ID);
    if (current?.payload?.schema_version !== INDEX_SCHEMA) return [];
    return Object.keys(current.payload.entries || {});
  }

  async function indexCoverage(adapter, kind) {
    const current = await adapter.load(kind, INDEX_ID);
    if (current?.payload?.schema_version !== INDEX_SCHEMA) return { cursor: '', revision: '', complete: false };
    const coverage = current.payload.coverage || {};
    return { cursor: text(coverage.cursor), revision: text(coverage.revision), complete: coverage.complete === true };
  }
  async function indexCoverBatch(adapter, kind, rows, coverage) {
    return mutateIndex(adapter, kind, entries => {
      for (const record of rows || []) {
        const row = indexRow(record);
        if (row.id) entries[row.id] = row;
      }
    }, coverage);
  }

  function rewritePath(record, oldPath, newPath, targetId, operationId) {
    const currentIdentity = identity(record?.target_identity);
    if (!currentIdentity) return Object.assign({}, record, { target_path: path(newPath), target_id: text(targetId) });
    const aliases = validateAliases(record, currentIdentity);
    const previous = { target_id: text(record.target_id), target_path: path(oldPath || record.target_path) };
    if (!aliases.some(item => text(item.target_id) === previous.target_id && path(item.target_path) === previous.target_path)) {
      aliases.push({ type: 'legacy-path-fnv', ...previous, target: clone(currentIdentity), migration_operation_id: text(operationId), created_at: new Date().toISOString() });
    }
    return Object.assign({}, record, { target_path: path(newPath), target_id: text(targetId), legacy_target_aliases: aliases });
  }

  function rewriteRefPaths(record, oldPath, newPath) {
    const next = clone(record);
    const ref = next.target_ref && typeof next.target_ref === 'object' ? next.target_ref : null;
    if (!ref) return next;
    for (const key of ['file', 'path', 'targetPath', 'target_path']) {
      if (path(ref[key]) === path(oldPath)) ref[key] = path(newPath);
    }
    return next;
  }

  async function rewriteStoredRecordAfterMove({ adapter, kind, documentId, oldPath, newPath, targetId, operationId }) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const current = await adapter.load(kind, documentId);
      if (!current?.payload) throw new AnnotationTargetError('移動対象のアノテートrecordが見つかりません', 409, 'annotation_record_missing');
      if (migrationBlocked(current.payload)) throw new AnnotationTargetError('削除済みアノテートrecordは移動できません', 410, 'annotation_record_deleted');
      let next = rewritePath(current.payload, oldPath, newPath, targetId, operationId);
      next = rewriteRefPaths(next, oldPath, newPath);
      next.modified = new Date().toISOString(); next.modified_at = next.modified;
      if (next.annotation_move_journal?.state === 'prepared') {
        next.annotation_move_journal = Object.assign({}, next.annotation_move_journal, {
          state: 'completed', completed_at: next.modified,
        });
      }
      try { return await saveReadback(adapter, kind, documentId, next, current.revision); } catch (error) {
        if (!conflict(error)) throw error;
      }
    }
    throw new AnnotationTargetError('アノテート移動のCAS retry上限に達しました');
  }

  async function prepareLegacyRecordForMove({ provider, adapter, boundary, kind, record, oldPath, newPath, operationId }) {
    const documentId = text(record?.id);
    if (!documentId) throw new AnnotationTargetError('legacyアノテートIDが欠損しています');
    let current = await adapter.load(kind, documentId);
    if (!current) {
      const now = new Date().toISOString();
      const prepared = Object.assign({}, clone(record), {
        annotation_move_journal: {
          operation_id: text(operationId), state: 'prepared', old_path: path(oldPath),
          new_path: path(newPath), prepared_at: now,
        },
      });
      try { current = await saveReadback(adapter, kind, documentId, prepared, null); }
      catch (error) {
        if (!conflict(error)) throw error;
        current = await adapter.load(kind, documentId);
      }
    }
    const journal = current?.payload?.annotation_move_journal;
    if (!journal || text(journal.operation_id) !== text(operationId)
        || path(journal.old_path) !== path(oldPath) || path(journal.new_path) !== path(newPath)) {
      throw new AnnotationTargetError('legacyアノテートのmove checkpointが競合しています', 409, 'annotation_move_checkpoint_conflict');
    }
    const migrated = await migrateRecord({
      provider, adapter, boundary, kind, documentId,
      operationId: `${text(operationId)}:typed-migration`,
    });
    const readback = await adapter.load(kind, documentId);
    if (!readback || readback.revision !== migrated.record?.revision) {
      throw new AnnotationTargetError('legacyアノテートmove checkpointのreadbackに失敗しました', 409, 'annotation_move_checkpoint_readback_failed');
    }
    return readback;
  }

  async function tombstoneStoredRecord({ adapter, kind, documentId, expectedRevision }) {
    const current = await adapter.load(kind, documentId);
    if (!current?.payload) return null;
    if (current.revision !== expectedRevision) {
      throw new AnnotationTargetError('アノテート削除対象のrevisionが変更されました', 409, 'annotation_delete_revision_changed');
    }
    if (migrationBlocked(current.payload)) return current;
    const now = new Date().toISOString();
    const next = Object.assign({}, current.payload, { tombstone: true, status: 'tombstoned', deleted_at: now, modified: now, modified_at: now });
    return saveReadback(adapter, kind, documentId, next, expectedRevision);
  }

  async function markStoredRecordOrphan({ adapter, kind, documentId, oldPath }) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const current = await adapter.load(kind, documentId);
      if (!current?.payload) throw new AnnotationTargetError('孤児化対象のアノテートrecordが見つかりません', 409);
      if (migrationBlocked(current.payload)) return current;
      const now = new Date().toISOString();
      const next = Object.assign({}, current.payload, {
        orphan: 1, orphaned_at: now,
        target_file_name: current.payload.target_file_name || path(oldPath).split('/').pop(),
        modified: now, modified_at: now,
      });
      if (next.annotation_move_journal?.state === 'prepared') {
        next.annotation_move_journal = Object.assign({}, next.annotation_move_journal, {
          state: 'completed', completed_at: now,
        });
      }
      try { return await saveReadback(adapter, kind, documentId, next, current.revision); }
      catch (error) { if (!conflict(error)) throw error; }
    }
    throw new AnnotationTargetError('アノテート孤児化のCAS retry上限に達しました');
  }

  window.MeldexCloudAnnotationTargetResolver = Object.freeze({
    INDEX_ID, AnnotationTargetError, freshProviderIdentity, resolveTarget, migrateRecord,
    rebindClaimAfterMove, indexUpsert, indexDelete, indexTombstone, indexedIds, indexedKnownIds,
    indexCoverage, indexCoverBatch, prepareLegacyRecordForMove,
    rewritePath, rewriteStoredRecordAfterMove, tombstoneStoredRecord, markStoredRecordOrphan,
  });
}());
