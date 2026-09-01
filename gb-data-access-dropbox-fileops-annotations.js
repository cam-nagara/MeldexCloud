/* gb-data-access-dropbox-fileops-annotations.js
 *
 * gb-data-access-dropbox-fileops-core.js の続き(同じ関数スコープに連結される
 * 継続ファイル。IIFEはここでは開かない・閉じない。詳細は core.js 冒頭コメント参照)。
 *
 * 固有形式付随物廃止・管理データ一元化計画 Phase 0 監査ノート§5「切り出し範囲の
 * 決定」の③アノテートクラスタ。Phase 4でこのクラスタを実際に共通ストレージ層
 * (gb-system-storage.js、種別 annotations)へ載せ替える。
 *
 * ## 保存先の変更
 *
 * 旧: `_events/annotations/<id>.json` への直接読み書き。
 * 新: 共通ストレージ層(document_id = アノテートid)。個人領域は `/MeldexSettings/system/v1`、
 *     参加中の共有ワークスペースに接続している場合は `<ワークスペース>/MeldexShare/system/v1`
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
  if (!boundary) throw new Error('アノテートのDropbox adapter boundaryを確認できません');
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
// 削除先が分裂しないようにする(個人Vault接続のまま共有ソースの文書へアノテートを
// 付けた場合、共有管理領域に保存されたそのアノテートを同じセッションで読めること)。

async function _annotationScopes(provider) {
  const resolver = window.MeldexDropboxManagementRootResolver;
  if (!resolver || typeof resolver.resolveManagementScopesForProvider !== 'function') {
    throw new Error('gb-dropbox-management-root-resolver.js が読み込まれていません');
  }
  return resolver.resolveManagementScopesForProvider(provider);
}

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
// identity claimと同じ保留/復帰の対象へアノテート書込みを含められるようにする登録。
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
      if (_annotationDeleted(payload)) continue;
      if (payload && typeof payload === 'object' && payload.id) {
        const migrated = await _migrateAnnotationStoredRecord(provider, scope.adapter, String(payload.id));
        payload = migrated.record?.payload || payload;
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
