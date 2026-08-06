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
 * 旧パスへ行わない)。削除時だけは、フォールバックで存在し続ける「ゴースト
 * 注釈」の復活を防ぐため、旧パスの実体があれば併せて削除する(ベストエフォート)。
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

async function _readAnnotationRecord(provider, id, targetPathHint) {
  const docId = _safeId(id, 'annotation id');
  const contract = window.MeldexSystemStorage;
  const triedScopeKeys = new Set();
  // 対象パスのヒントがある場合は、書込と同じスコープを最初に読む(最短経路)。
  const hint = _normalizeFolderPath(targetPathHint || '');
  if (hint) {
    try {
      const resolver = window.MeldexDropboxManagementRootResolver;
      const scope = await resolver.resolveManagementScopeForPath(provider, hint);
      triedScopeKeys.add(scope.scopeKey);
      const stored = await scope.adapter.load(contract.SystemStorageKind.ANNOTATIONS, docId);
      if (stored) return stored.payload && typeof stored.payload === 'object' ? stored.payload : null;
    } catch {
      // ヒントのスコープで読めない場合も、全スコープ走査と旧パスで継続する。
    }
  }
  try {
    for (const scope of await _annotationScopes(provider)) {
      if (triedScopeKeys.has(scope.scopeKey)) continue;
      try {
        const stored = await scope.adapter.load(contract.SystemStorageKind.ANNOTATIONS, docId);
        if (stored) return stored.payload && typeof stored.payload === 'object' ? stored.payload : null;
      } catch {
        // 到達できないスコープは読み飛ばす(読取はベストエフォート)。
      }
    }
  } catch {
    // 共通ストレージ層が使えない場合も、旧パスへフォールバックして機能を維持する。
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
  await adapter.save(window.MeldexSystemStorage.SystemStorageKind.ANNOTATIONS, docId, record);
}

async function _deleteAnnotationRecordFully(provider, id) {
  const docId = _safeId(id, 'annotation id');
  const contract = window.MeldexSystemStorage;
  // 書込先スコープはidだけでは特定できないため、全スコープを走査して削除する。
  // スコープ一覧を確定できない・一部スコープに実体が残った場合に成功扱いに
  // すると、読取集約が削除済みの注釈を復活させる(ゴースト化)ため、削除は
  // 安全側で失敗にする(スコープ列挙の失敗はそのまま伝える)。
  const scopes = await _annotationScopes(provider);
  let deleteError = null;
  for (const scope of scopes) {
    let stored = null;
    try {
      stored = await scope.adapter.load(contract.SystemStorageKind.ANNOTATIONS, docId);
    } catch (error) {
      if (!deleteError) deleteError = error;
      continue;
    }
    if (!stored) continue;
    try {
      await scope.adapter.delete(contract.SystemStorageKind.ANNOTATIONS, docId);
    } catch (error) {
      if (!deleteError) deleteError = error;
    }
  }
  // 旧パスに実体が残っていると、_readAnnotationRecord のフォールバックが
  // 削除済みの注釈を復活させてしまう(ゴースト化)。削除時だけは旧パスも消す。
  await provider.deletePath(_annotationPath(docId)).catch(() => {});
  if (deleteError) throw deleteError;
}

async function _listAnnotationRecords(provider) {
  const contract = window.MeldexSystemStorage;
  const records = [];
  const seenIds = new Set();
  let scopes = [];
  try {
    scopes = await _annotationScopes(provider);
  } catch {
    scopes = []; // 共通ストレージ層が使えない場合も、旧パスの一覧だけで機能を継続する。
  }
  for (const scope of scopes) {
    let stored = [];
    try {
      stored = await scope.adapter.listDocuments(contract.SystemStorageKind.ANNOTATIONS);
    } catch {
      continue; // 到達できないスコープは読み飛ばす(読取はベストエフォート)。
    }
    for (const item of stored) {
      const payload = item?.payload;
      if (payload && typeof payload === 'object' && payload.id && !seenIds.has(String(payload.id))) {
        records.push(payload);
        seenIds.add(String(payload.id));
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
  const records = await _listAnnotationRecords(provider);
  for (const record of records) {
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
      record.orphan = 1;
      record.orphaned_at = now;
      record.target_file_name = record.target_file_name || _basename(oldPath);
      changed = true;
    } else if (action === 'rename' || action === 'move') {
      if (record.target_path) {
        const nextTargetPath = _rewriteAnnotationPath(record.target_path, oldPath, newPath, isFolder);
        if (nextTargetPath !== _normalizeFolderPath(record.target_path)) {
          record.target_path = nextTargetPath;
          record.target_id = nextTargetPath ? _fnvFileId(nextTargetPath) : '';
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
    await _writeAnnotationRecord(provider, record);
    updated += 1;
  }
  return { ok: true, updated };
}
