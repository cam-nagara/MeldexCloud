function _annotationUnavailable(error, operation) {
  if (error?.status === 409 || error?.status === 410 || error?.status === 503) return error;
  const wrapped = new Error(`アノテートSystemStorageの${operation}に失敗しました`);
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
    const error = new Error('同じアノテートIDが複数の管理スコープに存在します');
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

async function _writeAnnotationRecord(provider, record, options = {}) {
  const docId = _safeId(record.id, 'annotation id');
  const adapter = await _managementAdapterForProvider(
    provider,
    window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS,
    record.target_path || record.path || '',
  );
  const kind = window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS;
  let saveOptions;
  if (options.expectedModified) {
    let current = await adapter.load(kind, docId);
    if (!current) {
      const legacy = await _readJsonSafe(provider, _annotationPath(docId), null);
      if (legacy && _annotationRow(legacy).modified === options.expectedModified) {
        // Retain the legacy source and claim an absent common-store slot first.
        // A retry can then edit that same snapshot with the normal CAS guard.
        await adapter.save(kind, docId, legacy, { expectedRevision: null });
        current = await adapter.load(kind, docId);
      }
    }
    if (!current || _annotationRow(current.payload || {}).modified !== options.expectedModified) {
      const error = new Error('他の画面で更新されたためアノテートを変更できません');
      error.status = 409; throw error;
    }
    saveOptions = { expectedRevision: current.revision };
  }
  await adapter.save(kind, docId, record, saveOptions);
  const migrated = await _migrateAnnotationStoredRecord(provider, adapter, docId);
  await _annotationTargetResolver().indexUpsert(adapter, kind, migrated.record?.payload || record);
  return migrated.record?.payload || record;
}

// 履歴復元では、削除記録を通常の読込・移行へ渡さない。削除記録は残したまま
// 読んだ版を条件に復元するので、取り消し後の他画面の更新を上書きしない。
async function _restoreAnnotationRecord(provider, body) {
  const id = _safeId(body.id, 'annotation id');
  const kind = window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS;
  const adapter = await _managementAdapterForProvider(provider, kind, body.target_path || '');
  const matches = await _findAnnotationRecordsById(provider, id);
  const match = matches[0];
  const current = match?.stored || null;
  const existing = current?.payload || null;
  const reject = () => { const error = new Error('他の画面で更新されたためアノテートを復元できません'); error.status = 409; throw error; };
  if (match && match.scope.adapter.describe().boundary !== adapter.describe().boundary) reject();
  if (body.expected_absent && existing && !_annotationDeleted(existing)) reject();
  if (body.expected_modified && (!existing || _annotationDeleted(existing) || existing.modified !== body.expected_modified)) reject();
  const record = _mergeAnnotationRecord(existing, body, { id, now: _nowIso() });
  if (body.created) { record.created = body.created; record.created_at = body.created_at || body.created; }
  if (body.modified) { record.modified = body.modified; record.modified_at = body.modified_at || body.modified; }
  delete record.tombstone; delete record.deleted; delete record.deleted_at;
  if (record.state === 'deleted') delete record.state;
  if (record.status === 'tombstoned') delete record.status;
  await adapter.save(kind, id, record, { expectedRevision: current?.revision || null });
  const migrated = await _migrateAnnotationStoredRecord(provider, adapter, id);
  await _annotationTargetResolver().indexUpsert(adapter, kind, migrated.record?.payload || record);
  return { ok: true, id };
}

// created-image-identity aftercare(gb-created-image-identity-aftercare.js)が
// identity claimと同じ保留/復帰の対象へアノテート書込みを含められるようにする登録。
// 素のオブジェクトへの代入のみで行い、2ファイル間の読込順に依存しない
// (aftercare側は実行時にこのレジストリを参照するため、このファイルが
// aftercare側より先に読み込まれても後に読み込まれても問題ない)。
window.MeldexCreatedImageIdentityAftercarePendingWriters = window.MeldexCreatedImageIdentityAftercarePendingWriters || {};
window.MeldexCreatedImageIdentityAftercarePendingWriters['annotation-record'] = (provider, payload) => _writeAnnotationRecord(provider, payload);

async function _deleteAnnotationRecordFully(provider, id, options = {}) {
  const docId = _safeId(id, 'annotation id');
  const contract = window.MeldexSystemStorage;
  const matches = await _findAnnotationRecordsById(provider, docId);
  if (matches.length === 1) {
    const match = matches[0];
    if (options.expectedModified && _annotationRow(match.stored.payload || {}).modified !== options.expectedModified) {
      const error = new Error('他の画面で更新されたためアノテートを削除できません');
      error.status = 409; throw error;
    }
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
  if (options.expectedModified && (!legacy || _annotationRow(legacy).modified !== options.expectedModified)) {
    const error = new Error('他の画面で更新されたためアノテートを削除できません');
    error.status = 409; throw error;
  }
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

async function _ensureAnnotationIndexCoverage(provider, scope, kind) {
  // A normal first read can require several 50-record pages, followed by a
  // second pass after legacy migration changes the collection generation.
  // Finish that work before reporting a startup failure. Bound the work and
  // stop on stalled coverage; storage/CAS errors still propagate unchanged.
  const seen = new Set();
  let coverage;
  for (let batch = 0; batch < 200; batch++) {
    coverage = await _coverAnnotationIndexBatch(provider, scope, kind);
    if (coverage.complete) return coverage;
    const progress = JSON.stringify([coverage.cursor, coverage.revision]);
    if (seen.has(progress)) break;
    seen.add(progress);
  }
  return coverage;
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
        const coverage = await _ensureAnnotationIndexCoverage(provider, scope, kind);
        if (!coverage.complete) {
          const error = new Error('アノテートmetadata indexを構築中です。再試行してください');
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
        const error = new Error('同じアノテートIDが複数の管理スコープに存在します');
        error.status = 409; error.code = 'annotation_scope_ambiguous'; throw error;
      }
      seenIds.add(key);
    }
    for (const item of stored) {
      let payload = item?.payload;
      // This typed record remains authoritative over its old path even if it
      // is deleted between the index read and target resolution below.
      if (payload && typeof payload === 'object' && payload.id) seenIds.add(String(payload.id));
      if (_annotationDeleted(payload)) continue;
      if (payload && typeof payload === 'object' && payload.id) {
        let migrated;
        try { migrated = await _migrateAnnotationStoredRecord(provider, scope.adapter, String(payload.id)); }
        catch (error) {
          if (error?.status === 410 && error?.meldexCode === 'annotation_record_deleted') continue;
          throw error;
        }
        payload = migrated.record?.payload;
        if (!payload || _annotationDeleted(payload)) continue;
      }
      if (payload && typeof payload === 'object' && payload.id) {
        const id = String(payload.id);
        if (records.some(existing => String(existing.id) === id)) {
          const error = new Error('同じアノテートIDが複数の管理スコープに存在します');
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
        throw Object.assign(new Error('legacyアノテートを安全に移行できません'), { status: 409 });
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
const SHARED_EDIT_SIGNATURE_SCOPE = 'shared-edit-history';

function _versionActor(url, body) {
  const query = url?.searchParams;
  const snapshot = window.MeldexProfileIdentity?.getActorSnapshot?.() || {};
  return {
    actor_id: String(query?.get('_actor_id') || body?._actor_id || snapshot.actorId || '').trim(),
    user: String(query?.get('_user') || body?._user || snapshot.displayName || 'anonymous').trim() || 'anonymous',
    actor_kind: String(query?.get('_actor_kind') || body?._actor_kind || snapshot.kind || 'human'),
    actor_model: String(query?.get('_actor_model') || body?._actor_model || ''),
    actor_provider: String(query?.get('_actor_provider') || body?._actor_provider || ''),
    chat_session_id: String(query?.get('_chat_session_id') || body?._chat_session_id || ''),
    tool_name: String(query?.get('_tool_name') || body?._tool_name || 'cloud_file'),
  };
}

function _actorMetadata(actor, prefix) {
  return {
    [`${prefix}_id`]: String(actor?.actor_id || ''),
    [`${prefix}_display_name`]: String(actor?.user || 'anonymous'),
    [`${prefix}_kind`]: String(actor?.actor_kind || 'human'),
    [`${prefix}_model`]: String(actor?.actor_model || ''),
    [`${prefix}_provider`]: String(actor?.actor_provider || ''),
    [`${prefix}_session_id`]: String(actor?.chat_session_id || ''),
    [`${prefix}_tool`]: String(actor?.tool_name || ''),
  };
}

function _snapshotActorMetadata(previous, creator, reason, eventId, nextEditor, sourceRevision) {
  return {
    metadata_schema_version: 2,
    restore_point_kind: _restorePointKind(reason, true),
    snapshot_reason: String(reason || ''),
    source_revision: String(sourceRevision || ''),
    event_id: String(eventId || ''),
    ..._actorMetadata(previous, 'content_last_editor'),
    ..._actorMetadata(creator, 'snapshot_created_by'),
    ...(nextEditor ? _actorMetadata(nextEditor, 'next_editor') : {}),
  };
}

function _restorePointKind(labelOrReason, auto, metadata) {
  const explicit = String(metadata?.restore_point_kind || '');
  const allowed = new Set([
    'manual', 'periodic', 'before_restore', 'before_llm', 'before_editor_transition',
    'before_migration', 'before_bulk_operation', 'before_external_sync',
    'before_permanent_delete', 'before_conflict_resolution', 'disaster_recovery', 'legacy',
  ]);
  if (allowed.has(explicit)) return explicit;
  const text = `${labelOrReason || ''} ${metadata?.snapshot_reason || ''}`.toLowerCase();
  const rules = [
    ['before_editor_transition', ['before_editor_transition', '編集者交代']],
    ['before_restore', ['before_restore', 'pre_restore', '復元前', '復元直前']],
    ['before_llm', ['before_llm', 'llm', 'ai編集']],
    ['before_migration', ['before_migration', '移行前', '変換前', '取り込み前']],
    ['before_bulk_operation', ['before_bulk', '一括', 'bulk', 'replace']],
    ['before_external_sync', ['before_external_sync', '同期前', '取得前']],
    ['before_permanent_delete', ['before_permanent_delete', '完全削除前', '空にする前']],
    ['before_conflict_resolution', ['before_conflict', '競合解決前']],
    ['disaster_recovery', ['disaster_recovery', '災害復旧', '安全網']],
    ['periodic', ['periodic', '周期復元', '定期復元']],
  ];
  for (const [kind, tokens] of rules) {
    if (tokens.some(token => text.includes(token))) return kind;
  }
  return auto ? 'legacy' : 'manual';
}

function _restorePointMetadata(label, auto, metadata) {
  return {
    ...(metadata || {}),
    metadata_schema_version: Math.max(2, Number(metadata?.metadata_schema_version || 0)),
    restore_point_kind: _restorePointKind(label, auto, metadata),
  };
}

function _shouldCreateRestorePoint(label, auto, metadata) {
  if (!auto) return true;
  if (_restorePointKind(label, auto, metadata) !== 'legacy') return true;
  const text = String(label || '').toLowerCase();
  if (!text) return true;
  return text !== 'file write before' && text !== 'file write create before'
    && !text.endsWith('更新前') && !text.endsWith('作成前') && !text.endsWith('通常保存前');
}

function _stableHistoryContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  const canonicalize = value => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    if (typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key =>
        `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  return canonicalize(content);
}

function _contentHistoryHash(content) {
  return `fnv64:${_fnvFileId(_stableHistoryContent(content))}`;
}

function _historyFileKind(path, content) {
  const name = _basename(_normalizeFolderPath(path)).toLowerCase();
  const text = String(content || '').slice(0, 4000).toLowerCase();
  if (name.endsWith('.mel-scenario') || name.endsWith('.scriptnote.json')) return 'scenario';
  if (name.endsWith('.mel-board') || name.endsWith('.board.json')) return 'board';
  if (name.endsWith('.mel-form')) return 'form';
  if (name.endsWith('.mel-map')) return 'map';
  if (name.endsWith('.mel-sheet')) return 'sheet';
  if (name.endsWith('.md')) {
    if (text.includes('type: settings-entry')) return 'settings-entry';
    if (text.includes('type: calendar-event')) return 'calendar-event';
    if (text.includes('type: board')) return 'board';
    return 'note';
  }
  const ext = _splitNameAndExt(name).ext.replace(/^\./, '');
  return ext || 'file';
}

function _historyDiffSummary(before, after) {
  const previous = _stableHistoryContent(before);
  const current = _stableHistoryContent(after);
  if (previous === current) return '';
  const beforeLines = previous.split(/\r?\n/).length;
  const afterLines = current.split(/\r?\n/).length;
  const preview = current.replace(/\s+/g, ' ').trim().slice(0, 200);
  const delta = afterLines - beforeLines;
  return `行数 ${beforeLines} → ${afterLines} (${delta >= 0 ? '+' : ''}${delta})${preview ? ': ' + preview : ''}`;
}

function _editDocumentId(path, eventId) {
  return `edit-${_fnvFileId(_normalizeFolderPath(path))}-${_fnvFileId(eventId)}`;
}

function _isSharedHistoryOwner() {
  let role = '';
  try { role = String(window.MeldexKnowledgeCloudStore?.role?.() || '').toLowerCase(); } catch {}
  let workspace = null;
  try { workspace = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null; } catch {}
  const workspaceRole = String(workspace?.access?.role || workspace?.role || workspace?.access || '').toLowerCase();
  return role === 'owner' || workspace?.isOwner === true || workspaceRole === 'owner';
}

async function _protectSharedEditRevision(provider, adapter, record) {
  const signature = window.MeldexKnowledgeSignature;
  if (!signature || !record?.documentId) return { ok: false, skipped: true };
  const actor = record.payload || {};
  if (_isSharedHistoryOwner()) {
    return signature.signRecord?.(provider, SHARED_EDIT_SIGNATURE_SCOPE, record, {
      managementAdapter: adapter,
      signer: String(actor.user || ''),
      createKey: true,
    });
  }
  return signature.markRecordPending?.(provider, SHARED_EDIT_SIGNATURE_SCOPE, record, {
    managementAdapter: adapter,
    requestedBy: String(actor.user || ''),
  });
}

async function _markSharedEditMutationPending(provider, adapter, record) {
  const signature = window.MeldexKnowledgeSignature;
  if (!signature?.markRecordPending || !record?.documentId) return;
  await signature.markRecordPending(provider, SHARED_EDIT_SIGNATURE_SCOPE, record, {
    managementAdapter: adapter,
    requestedBy: String(record?.payload?.user || ''),
  });
}

async function _editRecordIntegrity(provider, adapter, record) {
  const signature = window.MeldexKnowledgeSignature;
  if (!signature?.verifyRecord) {
    return Number(record?.payload?.integrity_schema_version || 0) >= 1
      ? { ok: false, status: 'pending-owner-signature' }
      : { ok: false, status: 'legacy-unsigned' };
  }
  if (Number(record?.payload?.integrity_schema_version || 0) < 1) {
    return { ok: false, status: 'legacy-unsigned', reason: 'legacy-unsigned' };
  }
  if (!_isSharedHistoryOwner()) {
    const saved = await signature.readRecordSignature?.(
      provider, SHARED_EDIT_SIGNATURE_SCOPE, record.documentId, { managementAdapter: adapter },
    );
    return saved?.hmac
      ? { ok: false, status: 'owner-verification-required', reason: 'owner-key-not-distributed' }
      : { ok: false, status: 'pending-owner-signature', reason: 'pending-owner-signature' };
  }
  let result = await signature.verifyRecord(provider, SHARED_EDIT_SIGNATURE_SCOPE, record, {
    managementAdapter: adapter,
  });
  if (result?.status === 'pending-owner-signature' && _isSharedHistoryOwner()) {
    const signed = await signature.signRecord(provider, SHARED_EDIT_SIGNATURE_SCOPE, record, {
      managementAdapter: adapter,
      signer: String(record?.payload?.user || ''),
      createKey: true,
    }).catch(() => null);
    if (signed?.ok) {
      result = await signature.verifyRecord(provider, SHARED_EDIT_SIGNATURE_SCOPE, record, {
        managementAdapter: adapter,
      });
    }
  }
  return result || { ok: false, status: 'pending-owner-signature' };
}

// 所有者の保存のたびに行っていた「署名待ちの記録への自動署名」を、保存を待たせない形で
// 続ける。対象は新しい順に数件、同じファイルにつき一定間隔まで。
const _backgroundSignedAt = new Map();
const BACKGROUND_SIGN_INTERVAL_MS = 10 * 60 * 1000;
const BACKGROUND_SIGN_RECORD_LIMIT = 10;

function _signPendingEditRecordsInBackground(provider, adapter, path, records) {
  if (!_isSharedHistoryOwner() || !records?.length) return;
  const last = _backgroundSignedAt.get(path) || 0;
  if (Date.now() - last < BACKGROUND_SIGN_INTERVAL_MS) return;
  if (_backgroundSignedAt.size >= 500) _backgroundSignedAt.clear();
  _backgroundSignedAt.set(path, Date.now());
  const targets = records.slice(0, BACKGROUND_SIGN_RECORD_LIMIT);
  (async () => {
    for (const row of targets) {
      await _editRecordIntegrity(provider, adapter, row).catch(() => null);
    }
  })().catch(() => {});
}

async function _listSharedEditRecords(provider, path, recursive, options = {}) {
  const normalized = _normalizeFolderPath(path);
  await _awaitPendingEditFinalizations(options.skipIntegrity && !recursive ? {provider, path:normalized} : undefined);
  const kind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
  const adapter = await _managementAdapterForProvider(provider, kind, normalized);
  const records = options.records || await adapter.listDocuments(kind,
    options.documentIdPrefix ? { documentIdPrefix: options.documentIdPrefix } : undefined);
  const visible = records.filter(row => {
    const payload = row?.payload || {};
    const currentPath = _normalizeFolderPath(payload.original_relative_path || '');
    return payload.object_type === 'edit-record'
      && (currentPath === normalized || (recursive && currentPath.startsWith(normalized + '/')))
      && payload.committed && !payload.aborted;
  }).sort((a, b) => String(b.payload?.committed_at || b.payload?.timestamp || '')
    .localeCompare(String(a.payload?.committed_at || a.payload?.timestamp || '')));
  // 保存の前処理は「直前の編集者」を知るために最新1件の内容を見るだけで、署名の検証結果は
  // 使わない。検証は履歴1件ごとに通信が発生し、保存のたびに履歴の件数ぶん遅くなっていた。
  // 履歴画面など検証結果を表示する呼び出しでは従来どおり全件を検証する。
  if (options.skipIntegrity) {
    _signPendingEditRecordsInBackground(provider, adapter, normalized, visible);
    return visible;
  }
  // 署名の確認は1件ごとに通信が要る。順番に行うと履歴が十数件を超えた時点で履歴画面が
  // 時間切れになっていたので、同時4件で進める。確認が取れた結果は同じ版の記録に限り
  // 2分間だけ使い回す（パネルを開き直すたびに全件を取り直さない）。
  let next = 0;
  const worker = async () => {
    while (next < visible.length) {
      const row = visible[next++];
      const memoKey = `${row.documentId}|${row.revision || ''}`;
      const memo = _verifiedIntegrityMemo.get(memoKey);
      if (memo && Date.now() - memo.at < 120000) { row.integrity = memo.result; continue; }
      row.integrity = await _editRecordIntegrity(provider, adapter, row).catch(() => ({
        ok: false, status: 'pending-owner-signature', reason: 'integrity-check-failed',
      }));
      if (row.integrity?.ok === true && row.revision) {
        if (_verifiedIntegrityMemo.size >= 5000) _verifiedIntegrityMemo.clear();
        _verifiedIntegrityMemo.set(memoKey, { at: Date.now(), result: row.integrity });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, visible.length) }, worker));
  return visible;
}
const _verifiedIntegrityMemo = new Map();

// 保存の前処理が読む編集履歴は、対象パスのものだけ（記録名の先頭が対象パスのハッシュ）。
// 種別全体を読むと、無関係な履歴・フォルダの控え（実データで3199件・307MB）を保存のたびに
// ダウンロードし、スマホのクイックメモ送信が終わらなかった（2026-11-26）。
// 移動で付け替えた記録は元の名前のままなので、ここでは読まない（直前の編集者の判定と
// 未確定の記録の回収が、移動後の最初の1回だけ効かない。内容は失われない）。
function _editRecordPrefix(path) {
  return `edit-${_fnvFileId(_normalizeFolderPath(path))}-`;
}

async function _reconcileCloudEditIntents(provider, path, currentContent) {
  const normalized = _normalizeFolderPath(path);
  await _awaitPendingEditFinalizations({provider, path:normalized});
  const kind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
  const adapter = await _managementAdapterForProvider(provider, kind, normalized);
  const records = await adapter.listDocuments(kind, { documentIdPrefix: _editRecordPrefix(normalized) });
  const currentHash = _contentHistoryHash(currentContent);
  let changed = false;
  for (const row of records) {
    const payload = row?.payload || {};
    if (payload.object_type !== 'edit-record' || payload.original_relative_path !== normalized
        || payload.committed || payload.aborted) continue;
    const intentAge = Date.now() - Date.parse(payload.timestamp || '');
    // 書こうとした内容が今の本文と一致していれば、その保存は成立している。保存直後に
    // 画面を閉じて確定が終わらなかった記録も、何日後でもここで確定する（期限切れ扱いに
    // して履歴から落とさない）。
    const contentWritten = payload.planned_content_hash === currentHash;
    if (!contentWritten && (!Number.isFinite(intentAge) || intentAge > 24 * 60 * 60 * 1000)) {
      changed = true;
      await _markSharedEditMutationPending(provider, adapter, row).catch(() => null);
      const saved = await adapter.save(kind, row.documentId, {
        ...payload, aborted: true, aborted_at: _nowIso(), abort_reason: 'expired_intent',
      }, { expectedRevision: row.revision }).catch(() => null);
      if (saved) await _protectSharedEditRevision(provider, adapter, saved).catch(() => null);
      continue;
    }
    if (payload.planned_content_hash !== currentHash) continue;
    changed = true;
    await _markSharedEditMutationPending(provider, adapter, row).catch(() => null);
    const saved = await adapter.save(kind, row.documentId, {
      ...payload, committed: true, committed_at: _nowIso(), recovered_from_intent: true,
    }, { expectedRevision: row.revision }).catch(() => null);
    if (saved) await _protectSharedEditRevision(provider, adapter, saved).catch(() => null);
  }
  // 何も書き換えなかった時だけ、読んだ一覧を直後の処理で使い回せるように返す。
  return { adapter, kind, records: changed ? null : records };
}

async function _prepareCloudFileEdit(provider, path, currentContent, nextContent, actor, sourceRevision, exists, options = {}) {
  const normalized = _normalizeFolderPath(path);
  const { adapter, kind, records } = await _reconcileCloudEditIntents(provider, normalized, currentContent);
  if (_stableHistoryContent(currentContent) === _stableHistoryContent(nextContent)) {
    return { adapter, kind, skipped: true, eventId: '', documentId: '', payload: null };
  }
  const latest = (await _listSharedEditRecords(provider, normalized, false, {
    skipIntegrity: true, records, documentIdPrefix: _editRecordPrefix(normalized),
  }))[0]?.payload || {};
  const previous = latest.actor_id ? latest : actor;
  const transition = !!(latest.actor_id && actor.actor_id && latest.actor_id !== actor.actor_id);
  const eventId = `edit-${_versionTimestamp()}-${_randomId('e').slice(-8)}`;
  const documentId = _editDocumentId(normalized, eventId);
  const payload = {
    object_type: 'edit-record', original_relative_path: normalized, event_id: eventId,
    timestamp: _nowIso(), ...actor, action: exists ? 'update_body' : 'create_file',
    file_kind: String(options.fileKind || _historyFileKind(normalized, nextContent)),
    entity_name: _splitNameAndExt(_basename(normalized)).stem,
    property_name: String(options.propertyName || ''),
    body_diff_summary: String(options.bodyDiffSummary || _historyDiffSummary(currentContent, nextContent)).slice(0, 1000),
    planned_content_hash: _contentHistoryHash(nextContent), previous_revision: String(sourceRevision || ''),
    committed: false, committed_at: '', committed_revision: '', aborted: false,
    integrity_schema_version: 1,
  };
  const intent = await adapter.save(kind, documentId, payload, { expectedRevision: null });
  if (_isSharedHistoryOwner()) {
    let protectedIntent = null;
    let protectionError = null;
    try {
      protectedIntent = await _protectSharedEditRevision(provider, adapter, intent);
    } catch (error) {
      protectionError = error;
    }
    if ((!protectedIntent?.ok && !protectedIntent?.skipped) || protectionError) {
      await adapter.save(kind, documentId, {
        ...payload, aborted: true, aborted_at: _nowIso(), abort_reason: 'owner_signature_failed',
      }, { expectedRevision: intent?.revision || undefined }).catch(() => null);
      throw protectionError || new Error('変更レコードへ管理者署名を保存できませんでした');
    }
  } else {
    await _protectSharedEditRevision(provider, adapter, intent).catch(() => null);
  }
  const metadata = _snapshotActorMetadata(
    previous, actor, transition ? 'before_editor_transition' : 'before_write',
    eventId, transition ? actor : null, sourceRevision,
  );
  try {
    const snapshotPath = _normalizeFolderPath(options.snapshotPath || normalized);
    if (options.snapshotKind === 'folder') {
      if (transition) await _saveFolderVersion(provider, snapshotPath, {
        auto: true, label: '編集者交代前', metadata,
      });
    } else if (exists && transition) {
      await _saveFileVersion(provider, snapshotPath, {
        auto: true, label: '編集者交代前', max_auto: 30,
        expectedRevision: sourceRevision, metadata,
      });
    }
  } catch (error) {
    await _markSharedEditMutationPending(provider, adapter, intent).catch(() => null);
    const aborted = await adapter.save(kind, documentId, {
      ...payload, aborted: true, aborted_at: _nowIso(), abort_reason: 'snapshot_failed',
    }, { expectedRevision: intent?.revision || undefined }).catch(() => null);
    if (aborted) await _protectSharedEditRevision(provider, adapter, aborted).catch(() => null);
    throw error;
  }
  return { provider, adapter, kind, documentId, intentRevision: intent?.revision || '', payload, eventId, intentRecord: intent };
}

// 本文の保存が終わった後の「履歴の確定」は、通信を10回以上（実測で約15秒）使う。
// 本文はこの時点で保存済みなので、確定は裏で続け、保存の完了を待たせない。
// 確定が終わる前に同じ履歴を読む処理（次の保存・履歴表示・移動に伴う付け替え）は、
// _awaitPendingEditFinalizations で先に完了を待つので、順序は従来と変わらない。
// 確定できなかった場合は従来どおり、次回の保存時に内容の一致で回収される。
const _pendingEditFinalizations = new Set();
const _pendingEditFinalizationScopes = new WeakMap();

const PENDING_EDIT_FINALIZATION_WAIT_MS = 45000;

async function _awaitPendingEditFinalizations(target) {
  const normalized = target?.path ? _normalizeFolderPath(target.path) : '';
