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

async function _listSharedEditRecords(provider, path, recursive) {
  const normalized = _normalizeFolderPath(path);
  const kind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
  const adapter = await _managementAdapterForProvider(provider, kind, normalized);
  const records = await adapter.listDocuments(kind);
  const visible = records.filter(row => {
    const payload = row?.payload || {};
    const currentPath = _normalizeFolderPath(payload.original_relative_path || '');
    return payload.object_type === 'edit-record'
      && (currentPath === normalized || (recursive && currentPath.startsWith(normalized + '/')))
      && payload.committed && !payload.aborted;
  }).sort((a, b) => String(b.payload?.committed_at || b.payload?.timestamp || '')
    .localeCompare(String(a.payload?.committed_at || a.payload?.timestamp || '')));
  for (const row of visible) {
    const integrity = await _editRecordIntegrity(provider, adapter, row).catch(() => ({
      ok: false, status: 'pending-owner-signature', reason: 'integrity-check-failed',
    }));
    row.integrity = integrity;
  }
  return visible;
}

async function _reconcileCloudEditIntents(provider, path, currentContent) {
  const normalized = _normalizeFolderPath(path);
  const kind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
  const adapter = await _managementAdapterForProvider(provider, kind, normalized);
  const records = await adapter.listDocuments(kind);
  const currentHash = _contentHistoryHash(currentContent);
  for (const row of records) {
    const payload = row?.payload || {};
    if (payload.object_type !== 'edit-record' || payload.original_relative_path !== normalized
        || payload.committed || payload.aborted) continue;
    const intentAge = Date.now() - Date.parse(payload.timestamp || '');
    if (!Number.isFinite(intentAge) || intentAge > 24 * 60 * 60 * 1000) {
      await _markSharedEditMutationPending(provider, adapter, row).catch(() => null);
      const saved = await adapter.save(kind, row.documentId, {
        ...payload, aborted: true, aborted_at: _nowIso(), abort_reason: 'expired_intent',
      }, { expectedRevision: row.revision }).catch(() => null);
      if (saved) await _protectSharedEditRevision(provider, adapter, saved).catch(() => null);
      continue;
    }
    if (payload.planned_content_hash !== currentHash) continue;
    await _markSharedEditMutationPending(provider, adapter, row).catch(() => null);
    const saved = await adapter.save(kind, row.documentId, {
      ...payload, committed: true, committed_at: _nowIso(), recovered_from_intent: true,
    }, { expectedRevision: row.revision }).catch(() => null);
    if (saved) await _protectSharedEditRevision(provider, adapter, saved).catch(() => null);
  }
  return { adapter, kind };
}

async function _prepareCloudFileEdit(provider, path, currentContent, nextContent, actor, sourceRevision, exists, options = {}) {
  const normalized = _normalizeFolderPath(path);
  const { adapter, kind } = await _reconcileCloudEditIntents(provider, normalized, currentContent);
  if (_stableHistoryContent(currentContent) === _stableHistoryContent(nextContent)) {
    return { adapter, kind, skipped: true, eventId: '', documentId: '', payload: null };
  }
  const latest = (await _listSharedEditRecords(provider, normalized))[0]?.payload || {};
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

async function _commitCloudFileEdit(prepared, committedRevision) {
  if (!prepared || prepared.skipped) return false;
  try {
    await _markSharedEditMutationPending(prepared.provider, prepared.adapter, prepared.intentRecord).catch(() => null);
    const saved = await prepared.adapter.save(prepared.kind, prepared.documentId, {
      ...prepared.payload, committed: true, committed_at: _nowIso(),
      committed_revision: String(committedRevision || ''),
    }, { expectedRevision: prepared.intentRevision || undefined });
    await _protectSharedEditRevision(prepared.provider, prepared.adapter, saved);
    return false;
  } catch {
    return true;
  }
}

async function _abortCloudFileEdit(prepared) {
  if (!prepared || prepared.skipped || !prepared.documentId) return;
  await _markSharedEditMutationPending(prepared.provider, prepared.adapter, prepared.intentRecord).catch(() => null);
  const saved = await prepared.adapter.save(prepared.kind, prepared.documentId, {
    ...prepared.payload, aborted: true, aborted_at: _nowIso(), abort_reason: 'content_write_failed',
  }, { expectedRevision: prepared.intentRevision || undefined }).catch(() => null);
  if (saved) await _protectSharedEditRevision(prepared.provider, prepared.adapter, saved).catch(() => null);
}

async function _trackCloudEdit(provider, options, mutation) {
  if (typeof mutation !== 'function') throw new Error('編集処理が指定されていません');
  const actor = options.actor || _versionActor(null, {});
  const prepared = await _prepareCloudFileEdit(
    provider,
    options.path,
    options.currentContent,
    options.nextContent,
    actor,
    options.sourceRevision || '',
    options.exists !== false,
    options,
  );
  let result;
  try {
    result = await mutation();
  } catch (error) {
    await _abortCloudFileEdit(prepared);
    throw error;
  }
  const pending = await _commitCloudFileEdit(prepared, options.committedRevision || '');
  if (result && typeof result === 'object') {
    result.history_recorded = !pending;
    result.history_sync_pending = pending;
  }
  return result;
}

window.MeldexSharedEditHistory = {
  actor: _versionActor,
  prepare: _prepareCloudFileEdit,
  commit: _commitCloudFileEdit,
  abort: _abortCloudFileEdit,
  track: _trackCloudEdit,
  fileKind: _historyFileKind,
  stableContent: _stableHistoryContent,
};

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
  const metaToken = meta.rev || meta.revision || meta.content_hash || meta.etag || '';
  if (metaToken) return String(metaToken);
  const stat = typeof provider.statPath === 'function' ? await provider.statPath(path).catch(() => null) : null;
  const statMeta = stat?.meta || {};
  const statToken = statMeta.rev || statMeta.revision || statMeta.content_hash || statMeta.etag || '';
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
  const pointMetadata = _restorePointMetadata(options?.label || '', !!options?.auto, options?.metadata);
  if (!_shouldCreateRestorePoint(options?.label || '', !!options?.auto, options?.metadata)) {
    return { ok: true, skipped: true, reason: 'ordinary_write' };
  }
  const source = await _resolveEntryHandle(provider, normalized);
  if (!source || source.kind !== 'file') throw new Error(`ファイルが見つかりません: ${normalized}`);
  if (!_isTextLikePath(normalized)) throw new Error('このファイル形式のバージョン保存にはまだ対応していません');
  const versionName = _fileVersionName(normalized, options || {});
  const adapter = await _managementAdapterForProvider(provider, window.MeldexSystemStorage.SystemStorageKind.VERSIONS, normalized);
  const expectedRevision = String(options?.expectedRevision || '');
  const revisionOf = value => String(value?.revision || value?.rev || value?.etag || '');
  const before = expectedRevision ? await provider.getMetadata(normalized) : null;
  const content = await provider.readText(normalized);
  const after = expectedRevision ? await provider.getMetadata(normalized) : null;
  if (expectedRevision && (revisionOf(before) !== expectedRevision || revisionOf(after) !== expectedRevision)) {
    throw Object.assign(new Error('Version保存中にCloudファイルが変更されました'), { status: 409 });
  }
  const payload = {
    object_type: 'text-file',
    original_relative_path: normalized,
    version_name: versionName,
    content,
    auto: !!options?.auto,
    label: String(options?.label || ''),
    file_kind: _historyFileKind(normalized, content),
    created_at: _nowIso(),
    deleted_at: '',
    ...pointMetadata,
  };
  let documentId = `file-${_fnvFileId(normalized)}-${_fnvFileId(versionName)}`;
  if (pointMetadata.restore_point_kind === 'periodic') {
    payload.content_hash = payload.content_hash || _contentHistoryHash(content);
    const rows = await adapter.listDocuments(window.MeldexSystemStorage.SystemStorageKind.VERSIONS);
    const existing = rows.find(row => {
      const value = row.payload || {};
      if (value.object_type !== 'text-file' || value.original_relative_path !== normalized || value.deleted_at) return false;
      const sameBucket = value.schedule_id === payload.schedule_id
        && value.schedule_bucket_id === payload.schedule_bucket_id;
      return sameBucket || value.content_hash === payload.content_hash;
    });
    if (existing) {
      return { ok: true, skipped: true, reason: 'unchanged_or_duplicate', version: existing.payload?.version_name || '' };
    }
    if (payload.schedule_id && payload.schedule_bucket_id) {
      documentId = `file-${_fnvFileId(normalized)}-periodic-${_fnvFileId(`${payload.schedule_id}:${payload.schedule_bucket_id}`)}`;
    }
  }
  try {
    await adapter.save(window.MeldexSystemStorage.SystemStorageKind.VERSIONS, documentId, payload, { expectedRevision: null });
  } catch (error) {
    if (pointMetadata.restore_point_kind === 'periodic' && (error?.status === 409 || error?.code === 'revision_conflict')) {
      return { ok: true, skipped: true, reason: 'duplicate_schedule_bucket' };
    }
    throw error;
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
      file_kind: String(payload.file_kind || _historyFileKind(normalized, payload.content || '')),
      size: new TextEncoder().encode(payload.content || '').length,
      _modifiedMs: Date.parse(payload.created_at || '') || 0,
      ...Object.fromEntries(Object.entries(payload).filter(([key]) =>
        key === 'event_id' || key === 'snapshot_reason' || key === 'restore_point_kind'
        || key === 'content_hash' || key === 'stable_document_id' || key === 'schedule_id'
        || key === 'schedule_bucket_id' || key === 'transaction_id' || key === 'created_by'
        || key.startsWith('content_last_editor_')
        || key.startsWith('snapshot_created_by_') || key.startsWith('next_editor_'))),
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

async function _buildCloudVersionTimeline(provider, url) {
