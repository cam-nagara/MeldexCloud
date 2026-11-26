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
  settled: _awaitPendingEditFinalizations,
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
  if (window.MeldexRuntimeAdapter?.isBrowserMode?.() && typeof provider.getMetadata === 'function') {
    const browserMeta = await provider.getMetadata(path);
    return String(browserMeta?.revision || '');
  }
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
  await _awaitPendingEditFinalizations();
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
  const textFile = _isTextLikePath(normalized);
  const versionName = _fileVersionName(normalized, options || {});
  const adapter = await _managementAdapterForProvider(provider, window.MeldexSystemStorage.SystemStorageKind.VERSIONS, normalized);
  const expectedRevision = String(options?.expectedRevision || '');
  const revisionOf = value => String(value?.revision || value?.rev || value?.etag || '');
  const before = expectedRevision ? await provider.getMetadata(normalized) : null;
  const content = textFile ? await provider.readText(normalized) : '';
  const binary = textFile ? {} : await _versionFileBase64(provider, normalized);
  const after = expectedRevision ? await provider.getMetadata(normalized) : null;
  if (expectedRevision && (revisionOf(before) !== expectedRevision || revisionOf(after) !== expectedRevision)) {
    throw Object.assign(new Error('Version保存中にCloudファイルが変更されました'), { status: 409 });
  }
  const payload = {
    object_type: 'text-file',
    original_relative_path: normalized,
    version_name: versionName,
    content,
    ...binary,
    annotation_snapshot: await _captureVersionAnnotations(provider, normalized),
    auto: !!options?.auto,
    label: String(options?.label || ''),
    file_kind: _historyFileKind(normalized, content),
    created_at: _nowIso(),
    deleted_at: '',
    ...pointMetadata,
  };
  let documentId = `file-${_fnvFileId(normalized)}-${_fnvFileId(versionName)}`;
  if (pointMetadata.restore_point_kind === 'periodic') {
    payload.content_hash = _contentHistoryHash((textFile ? content : binary.content_base64) + JSON.stringify(payload.annotation_snapshot));
    await _awaitPendingEditFinalizations();
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
  await _awaitPendingEditFinalizations();
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
  const path = _normalizeFolderPath(url.searchParams.get('target_path') || url.searchParams.get('path') || '');
  if (!path) return { ok: true, total: 0, entries: [] };
  const kinds = new Set(String(url.searchParams.get('kinds') || 'named,auto,edit').split(',').filter(Boolean));
  const entries = [];
  const target = await _resolveEntryHandle(provider, path);
  const folderTarget = target?.kind === 'directory';
  if (target?.kind === 'file') {
    try {
      await _reconcileCloudEditIntents(provider, path, await provider.readText(path));
    } catch (error) {
      console.warn('編集履歴の同期待ち確認に失敗しました:', error);
    }
  }
  if (kinds.has('named') || kinds.has('auto')) {
    const versions = folderTarget ? await _listFolderVersions(provider, path) : await _listFileVersions(provider, path);
    for (const row of versions) {
      const auto = !!row.auto;
      if (!kinds.has(auto ? 'auto' : 'named')) continue;
      const previousName = row.content_last_editor_display_name || '';
      const nextName = row.next_editor_display_name || '';
      entries.push({
        ...row, id: `file:${path}:${row.name}`, type: auto ? 'auto' : 'named',
        timestamp: row.created || row.modified || '', path,
        file_kind: folderTarget ? 'folder' : (row.file_kind || _historyFileKind(path, '')),
        user: previousName, actor_id: row.content_last_editor_id || '',
        actor_kind: row.content_last_editor_kind || '', actor_model: row.content_last_editor_model || '',
        actor_provider: row.content_last_editor_provider || '',
        chat_session_id: row.content_last_editor_session_id || '', tool_name: row.content_last_editor_tool || '',
        label: row.snapshot_reason === 'before_editor_transition'
          ? `${previousName || '編集者不明'}の最終編集 — ${nextName || '別のユーザー'}が編集を開始する前に自動保存`
          : (row.label || (auto ? '自動復元ポイント' : 'スナップショット')),
        snapshot_ref: row.name, snapshot_kind: folderTarget ? 'folder' : 'file', snapshot_version: row.name,
        version_type: folderTarget ? 'folder' : 'file', auto,
      });
    }
  }
  if (kinds.has('edit')) {
    for (const record of await _listSharedEditRecords(provider, path, folderTarget)) {
      const row = record.payload || {};
      const integrityStatus = String(record.integrity?.status || 'pending-owner-signature');
      entries.push({
        ...row, id: `edit:${row.event_id || record.documentId}`, type: 'edit',
        timestamp: row.committed_at || row.timestamp || '',
        path: row.original_relative_path || path,
        label: row.body_diff_summary || row.action || '編集', auto: false,
        snapshot_ref: '', snapshot_kind: '', snapshot_version: '', version_type: '',
        integrity_status: integrityStatus,
        integrity_verified: record.integrity?.ok === true,
        integrity_warning: integrityStatus === 'tampered'
          ? '署名後に変更レコードが改変された可能性があります。内容を残したまま、管理者鍵の復旧または安全な版への復元を確認してください。'
          : (integrityStatus === 'owner-key-missing'
            ? 'この端末に検証用の管理者鍵がありません。管理者鍵を復旧してから整合性を確認してください。'
            : ''),
        integrity_recovery_action: ['tampered', 'owner-key-missing'].includes(integrityStatus)
          ? 'open-owner-key-recovery' : '',
      });
    }
  }
  const filters = {
    actor_id: 'actor_id', actor_kind: 'actor_kind', actor_model: 'actor_model',
    actor_provider: 'actor_provider', chat_session_id: 'chat_session_id', user: 'user',
    tool_name: 'tool_name', file_kind: 'file_kind', action: 'action',
    entity: 'entity_name', prop: 'property_name',
  };
  const since = String(url.searchParams.get('since') || '');
  const until = String(url.searchParams.get('until') || '');
  const filtered = entries.filter(entry => Object.entries(filters).every(([queryKey, entryKey]) => {
    const expected = String(url.searchParams.get(queryKey) || '');
    return !expected || String(entry[entryKey] || '') === expected;
  }) && (!since || String(entry.timestamp || '') >= since)
    && (!until || String(entry.timestamp || '') <= until))
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100)));
  return { ok: true, total: filtered.length, entries: filtered.slice(offset, offset + limit) };
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
  await _awaitPendingEditFinalizations();
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
  const current = await _readConflictSnapshot(provider, _normalizeFolderPath(path));
  const currentAnnotations = record.payload?.annotation_snapshot == null ? null : await _captureVersionAnnotations(provider, path);
  return { content: String(record.payload?.content || ''), name,
    ...(record.payload?.content_base64 != null ? { binary: true, content_base64: record.payload.content_base64,
      size: record.payload.byte_length, sha256: await _conflictSnapshotSha256(Uint8Array.from(atob(record.payload.content_base64), c=>c.charCodeAt(0))), current_sha256: current.sha256 } : {}),
    annotation_snapshot: _rebindVersionAnnotations(record.payload?.annotation_snapshot, _normalizeFolderPath(path)), current_annotation_snapshot: currentAnnotations,
    annotation_revision: currentAnnotations ? _contentHistoryHash(JSON.stringify(currentAnnotations)) : '',
    etag: current.revision, transport_revision: { transport: 'provider-revision', token: current.revision } };
}

async function _restoreFileVersion(provider, path, version, options = {}) {
  const normalized = _normalizeFolderPath(path);
  if (_isProductionFolderNotePath(normalized)) {
    throw new Error('制作管理の列定義ファイルは汎用バージョン履歴から復元できません');
  }
  const source = await _resolveEntryHandle(provider, normalized);
  if (!source || source.kind !== 'file') throw new Error(`ファイルが見つかりません: ${normalized}`);
  const data = await _readFileVersion(provider, normalized, version);
  const transport = options.transport_revision;
  if (transport && transport.transport !== 'provider-revision') {
    throw Object.assign(new Error('復元のrevision transportが一致しません'), { status: 409 });
  }
  if (options.if_match_etag && transport?.token && options.if_match_etag !== transport.token) {
    throw Object.assign(new Error('復元のrevision指定が一致しません'), { status: 400 });
  }
  const expected = String(options.if_match_etag || options.transport_revision?.token || '').trim();
  if (!expected || expected !== data.etag) throw Object.assign(new Error('復元対象が更新されました。再確認してください'), { status: 409 });
  _rejectProductionLegacyEntryContent(normalized, data.content || '');
  await _saveFileVersion(provider, normalized, { auto: true, label: 'pre_restore', max_auto: 30 });
  const rollbackAnnotations = await _restoreVersionAnnotations(provider, normalized, data.annotation_snapshot, options.annotation_revision);
  let saved;
  try { saved = await provider.uploadBytesConditional(normalized, data.binary
    ? Uint8Array.from(atob(data.content_base64),c=>c.charCodeAt(0)) : new TextEncoder().encode(data.content || ''), expected); }
  catch(error) { await rollbackAnnotations(); throw error; }
  const token = String(saved?.rev || saved?.revision || '');
  return { ok: true, etag: token, transport_revision: { transport: 'provider-revision', token } };
}

async function _captureVersionAnnotations(provider, path) {
  const normalized = _normalizeFolderPath(path);
  const rows = (await _listAnnotationRecords(provider, { targetPath: normalized, includePdfPages: true }))
    .filter(row => _normalizeFolderPath(row.target_path) === normalized || _normalizeFolderPath(row.target_path).startsWith(normalized+'#page='))
    .sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  return { schemaVersion: 1, targets: { [normalized]: rows } };
}

function _rebindVersionAnnotations(snapshot, path) {
  if(snapshot==null)return snapshot;
  const invalid=()=>{throw Object.assign(new Error('アノテートの保存版の対象が不正です'),{status:400});};
  if(snapshot.schemaVersion!==1||!snapshot.targets||Array.isArray(snapshot.targets))invalid();
  const roots=[...new Set(Object.keys(snapshot.targets).map(key=>key.replace(/\\/g,'/').split('#page=')[0]))];
  if(roots.length!==1)invalid();
  const owner=roots[0],rows=[];
  const map=value=>{
    const parts=String(value||'').replace(/\\/g,'/').split('#page='),base=parts[0];
    if(base!==owner&&!(/^(?:[a-z]:\/|\/)/i.test(owner)&&owner.endsWith('/'+base))||parts.length>2||parts.length===2&&!/^[1-9]\d*$/.test(parts[1]))invalid();
    return path+(parts.length===2?'#page='+parts[1]:'');
  };
  for(const [key,items] of Object.entries(snapshot.targets)){
    map(key);if(!Array.isArray(items))invalid();
    for(const item of items){
      const row={...item,target_path:map(item.target_path)};
      let ref=row.target_ref;const stringRef=typeof ref==='string';
      if(stringRef){try{ref=JSON.parse(ref);}catch{ref=null;}}
      if(ref&&typeof ref==='object'){
        ref={...ref};for(const field of ['file','path'])if(field in ref)ref[field]=map(ref[field]);
        row.target_ref=stringRef?JSON.stringify(ref):ref;
      }
      if('target_file_name' in row)row.target_file_name=path.split('/').pop();
      rows.push(row);
    }
  }
  return {schemaVersion:1,targets:{[path]:rows}};
}

async function _restoreVersionAnnotations(provider, path, snapshot, expectedRevision) {
  if (snapshot == null) return async()=>{};
  const normalized = _normalizeFolderPath(path);
  const current = await _captureVersionAnnotations(provider, normalized);
  if (snapshot.schemaVersion !== 1 || !snapshot.targets || Object.keys(snapshot.targets).some(key=>key!==normalized))
    throw Object.assign(new Error('別ファイルのアノテートは復元できません'),{status:400});
  if (expectedRevision && expectedRevision !== _contentHistoryHash(JSON.stringify(current)))
    throw Object.assign(new Error('アノテートが更新されました。再確認してください'),{status:409});
  const desired = snapshot.targets[normalized] || [], before = current.targets[normalized];
  if (!Array.isArray(desired) || desired.some(row=>_normalizeFolderPath(row.target_path).replace(/#page=\d+$/,'')!==normalized)
    || new Set(desired.map(row=>row.id)).size!==desired.length) throw Object.assign(new Error('アノテートの版が不正です'),{status:400});
  const applied=[];
  async function restoreRow(row, previous) {
    if(row) {
      const existing=(await _findAnnotationRecordsById(provider,row.id))[0]?.stored?.payload;
      if(existing && !_annotationDeleted(existing) && _normalizeFolderPath(existing.target_path).replace(/#page=\d+$/,'')!==normalized)
        throw Object.assign(new Error('アノテートは別の対象へ移動されています'),{status:409});
      await _restoreAnnotationRecord(provider,{...row,...(previous?{expected_modified:previous.modified}:{expected_absent:true})});
    } else await _deleteAnnotationRecordFully(provider,previous.id,{expectedModified:previous.modified});
  }
  async function rollback() { for(const [old,next] of [...applied].reverse()) await restoreRow(old,next); }
  try {
    for(const row of desired) {
      const old=before.find(item=>item.id===row.id)||null;
      if(JSON.stringify(old)===JSON.stringify(row))continue;
      await restoreRow(row,old);applied.push([old,row]);
    }
    for(const old of before) if(!desired.some(row=>row.id===old.id)) { await restoreRow(null,old);applied.push([old,null]); }
  }catch(error){await rollback();throw error;}
  return rollback;
}

window.MeldexFileVersionProviderOps = Object.freeze({
  save: (provider, path, options) => _saveFileVersion(provider, path, options || {}),
  read: (provider, path, version) => _readFileVersion(provider, path, version),
  captureAnnotations: (provider,path) => _captureVersionAnnotations(provider,path),
});
  /* Folder-version helpers share the enclosing Dropbox file-operations scope. */
  /* 以下の3つは gb-data-access-dropbox-fileops-versions.js が1000行を超えたため、ここへ移した（同じ関数スコープに連結される）: フォルダの中身の件数・ファイルの版の論理削除と復元。 */
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
  await _awaitPendingEditFinalizations();
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

  function _relativeToFolder(folderPath, filePath) {
    const folder = _normalizeFolderPath(folderPath);
    const file = _normalizeFolderPath(filePath);
    if (!folder) return file;
    return file === folder ? '' : (file.startsWith(folder + '/') ? file.slice(folder.length + 1) : file);
  }

  function _skipFolderVersionRelPath(relPath) {
    const normalized = _normalizeFolderPath(relPath);
    return FOLDER_VERSION_EXCLUDE_PREFIXES.some(prefix => normalized === prefix.replace(/\/$/, '') || normalized.startsWith(prefix));
  }

  async function _versionFileBase64(provider, path) {
    const source = await provider.downloadAsFile(path);
    const bytes = new Uint8Array(await source.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return { content_base64: btoa(binary), byte_length: bytes.length };
  }

  async function _collectFolderVersionFiles(provider, folderPath, options = {}) {
    const base = _normalizeFolderPath(folderPath);
    const files = [];
    async function walk(current) {
      const entries = await _listDirectoryEntries(provider, current);
      for (const entry of entries) {
        if (!entry.name || (!options.includeAll && entry.name.startsWith('.'))) continue;
        const fullPath = _joinPath(current, entry.name);
        const relPath = _relativeToFolder(base, fullPath);
        if (!options.includeAll && _skipFolderVersionRelPath(relPath)) continue;
        if (entry.handle.kind === 'directory') {
          files.push({ rel_path: relPath, entry_type: 'directory', size: 0, modified: '', content_base64: null });
          await walk(fullPath);
          continue;
        }
        const ext = _splitNameAndExt(entry.name).ext.toLowerCase();
        if (!options.includeAll && FOLDER_VERSION_EXCLUDE.has(ext)) continue;
        const stats = await _fileStats(entry.handle).catch(() => ({ size: 0, modified: '' }));
        const encoded = await _versionFileBase64(provider, fullPath);
        files.push({
          rel_path: relPath,
          entry_type: 'file',
          size: stats.size || encoded.byte_length,
          modified: stats.modified || '',
          content_base64: encoded.content_base64,
        });
      }
    }
    await walk(base);
    return files;
  }

  async function _saveFolderVersion(provider, folderPath, options) {
    const normalized = _normalizeFolderPath(folderPath);
    const pointMetadata = _restorePointMetadata(options?.label || '', !!options?.auto, options?.metadata);
    if (!_shouldCreateRestorePoint(options?.label || '', !!options?.auto, options?.metadata)) {
      return { ok: true, skipped: true, reason: 'ordinary_write' };
    }
    const folder = await _resolveEntryHandle(provider, normalized);
    if (!folder || folder.kind !== 'directory') throw new Error(`フォルダが見つかりません: ${normalized}`);
    const label = _safeNamePart(options?.label || '', '').replace(/^_+|_+$/g, '');
    const kind = options?.auto ? 'auto' : 'manual';
    const versionName = `v_${_versionTimestamp()}_${kind}${label ? '_' + label : ''}`;
    const files = await _collectFolderVersionFiles(provider, normalized, options || {});
    const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    const storageKind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
    const adapter = await _managementAdapterForProvider(provider, storageKind, normalized);
    const documentId = `folder-${_fnvFileId(normalized)}-${_fnvFileId(versionName)}`;
    await adapter.save(storageKind, documentId, {
      object_type: 'folder',
      original_relative_path: normalized,
      version_name: versionName,
      created_at: _nowIso(),
      label: options?.label || '',
      auto: !!options?.auto,
      files,
      ...(options?.include_annotations ? { annotation_snapshot: await _captureVersionAnnotations(provider, normalized) } : {}),
      exclude_patterns: [...FOLDER_VERSION_EXCLUDE],
      deleted_at: '',
      deleted_token: '',
      ...pointMetadata,
    }, { expectedRevision: null });
    return { ok: true, version: versionName, file_count: files.length, total_size: totalSize };
  }

  async function _readLegacyFolderVersion(provider, folderPath, version) {
    const normalized = _normalizeFolderPath(folderPath);
    const safeVersion = _safeVersionName(version);
    const versionDir = _joinPath(_folderVersionDir(normalized), safeVersion);
    const meta = await _readJsonSafe(provider, _joinPath(versionDir, '_meta.json'), null);
    if (!meta || typeof meta !== 'object') return null;
    const files = [];
    for (const file of (Array.isArray(meta.files) ? meta.files : [])) {
      const relPath = _safeRelativeFile(file?.rel_path || '', 'rel_path');
      const encoded = await _versionFileBase64(provider, _joinPath(versionDir, 'files', relPath));
      files.push({
        rel_path: relPath,
        size: Number(file?.size || encoded.byte_length),
        modified: file?.modified || '',
        content_base64: encoded.content_base64,
      });
    }
    return {
      object_type: 'folder',
      original_relative_path: normalized,
      version_name: safeVersion,
      created_at: meta.created || _versionCreatedFromName(safeVersion) || '',
      label: meta.label || '',
      auto: !!meta.auto,
      files,
      exclude_patterns: Array.isArray(meta.exclude_patterns) ? meta.exclude_patterns : [...FOLDER_VERSION_EXCLUDE],
      deleted_at: '',
      deleted_token: '',
      migrated_from_legacy: true,
    };
  }

  async function _listFolderVersions(provider, folderPath) {
    const normalized = _normalizeFolderPath(folderPath);
    const storageKind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
    const adapter = await _managementAdapterForProvider(provider, storageKind, normalized);
    const entries = await adapter.listDocuments(storageKind);
    const versions = [];
    for (const entry of entries) {
      const meta = entry?.payload || {};
      if (meta.object_type !== 'folder' || meta.original_relative_path !== normalized || meta.deleted_at) continue;
      const files = Array.isArray(meta.files) ? meta.files : [];
      versions.push({
        name: meta.version_name,
        created: meta.created_at || _versionCreatedFromName(meta.version_name) || '',
        label: meta.label || '',
        auto: !!meta.auto,
        file_count: files.length,
        total_size: files.reduce((sum, file) => sum + Number(file?.size || 0), 0),
        ...Object.fromEntries(Object.entries(meta).filter(([key]) =>
          key === 'event_id' || key === 'snapshot_reason' || key.startsWith('content_last_editor_')
          || key.startsWith('snapshot_created_by_') || key.startsWith('next_editor_'))),
      });
    }
    const known = new Set(versions.map(row => row.name));
    const legacyDir = _folderVersionDir(normalized);
    for (const entry of await _listEntriesSafe(provider, legacyDir)) {
      if (entry.handle.kind !== 'directory' || !entry.name.startsWith('v_') || known.has(entry.name)) continue;
      const meta = await _readJsonSafe(provider, _joinPath(legacyDir, entry.name, '_meta.json'), null);
      if (!meta || typeof meta !== 'object') continue;
      const files = Array.isArray(meta.files) ? meta.files : [];
      versions.push({
        name: entry.name,
        created: meta.created || _versionCreatedFromName(entry.name) || '',
        label: meta.label || '',
        auto: !!meta.auto,
        file_count: files.length,
        total_size: files.reduce((sum, file) => sum + Number(file?.size || 0), 0),
      });
    }
    versions.sort((a, b) => String(b.name).localeCompare(String(a.name)));
    return versions;
  }

  async function _findFolderVersionRecord(provider, folderPath, version, includeDeleted, migrateLegacy) {
    const normalized = _normalizeFolderPath(folderPath);
    const safeVersion = _safeVersionName(version);
    const storageKind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
    const adapter = await _managementAdapterForProvider(provider, storageKind, normalized);
    const records = await adapter.listDocuments(storageKind);
    let record = records.find(row => {
      const payload = row?.payload || {};
      return payload.object_type === 'folder'
        && payload.original_relative_path === normalized
        && payload.version_name === safeVersion
        && (includeDeleted || !payload.deleted_at);
    });
    if (!record) {
      const legacyPayload = await _readLegacyFolderVersion(provider, normalized, safeVersion);
      if (legacyPayload && migrateLegacy) {
        const documentId = `folder-${_fnvFileId(normalized)}-${_fnvFileId(safeVersion)}`;
        record = await adapter.save(storageKind, documentId, legacyPayload, { expectedRevision: null });
      } else if (legacyPayload) {
        record = { documentId: '', revision: '', payload: legacyPayload };
      }
    }
    return { adapter, storageKind, record };
  }

  async function _folderRestoreBaseline(provider, folderPath, files) {
    const plans = [];
    const seen = new Set();
    for (const file of files) {
      if (file.entry_type === 'directory') continue;
      const relPath = _safeRelativeFile(file.rel_path, 'rel_path');
      if (seen.has(relPath.toLowerCase())) throw new Error('復元対象のパスが重複しています');
      seen.add(relPath.toLowerCase());
      const path = _joinPath(folderPath, relPath);
      const entry = await _resolveEntryHandle(provider, path);
      if (entry && entry.kind !== 'file') throw new Error('復元先にファイル以外の項目があります');
      const current = entry ? await _readConflictSnapshot(provider, path) : { bytes: null, revision: null };
      plans.push({ path, relPath, ...current });
    }
    const token = await _conflictSnapshotSha256(new TextEncoder().encode(JSON.stringify(plans.map(plan => [plan.relPath, plan.revision]))));
    return { plans, token };
  }

  async function _readFolderVersion(provider, folderPath, version, includeRevision = false) {
    const { record } = await _findFolderVersionRecord(provider, folderPath, version, false);
    if (!record) throw new Error('フォルダバージョンが見つかりません');
    const payload={...record.payload,annotation_snapshot:_rebindVersionAnnotations(record.payload.annotation_snapshot,_normalizeFolderPath(folderPath))};
    if (!includeRevision) return payload;
    const baseline = await _folderRestoreBaseline(provider, _normalizeFolderPath(folderPath), record.payload.files || []);
    return { ...payload, restore_revision: baseline.token };
  }

  async function _readFolderVersionFile(provider, folderPath, version, file) {
    const relFile = _safeRelativeFile(file, 'file');
    const meta = await _readFolderVersion(provider, folderPath, version);
    const snapshot = (Array.isArray(meta.files) ? meta.files : []).find(row => row?.rel_path === relFile);
    if (!snapshot?.content_base64) throw new Error('バージョン内のファイルが見つかりません');
    const binary = atob(snapshot.content_base64);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return { content: new TextDecoder().decode(bytes) };
  }

  async function _restoreFolderVersion(provider, folderPath, version, options = {}) {
    const normalized = _normalizeFolderPath(folderPath);
    const folder = await _resolveEntryHandle(provider, normalized);
    if (!folder || folder.kind !== 'directory') throw new Error(`フォルダが見つかりません: ${normalized}`);
    const safeVersion = _safeVersionName(version);
    const meta = await _readFolderVersion(provider, normalized, safeVersion);
    const protectedFile = (Array.isArray(meta.files) ? meta.files : []).find(file => {
      const relPath = _normalizeFolderPath(file?.rel_path || '');
      return relPath && _isProductionFolderNotePath(_joinPath(normalized, relPath));
    });
    if (protectedFile) {
      throw new Error('制作管理の列定義を含むフォルダ履歴は汎用復元できません');
    }
    for (const file of (Array.isArray(meta.files) ? meta.files : [])) {
      const relPath = _safeRelativeFile(file.rel_path, 'rel_path');
      const dst = _joinPath(normalized, relPath);
      if (!_productionReservedEntryProperties(dst).length) continue;
      const snapshot = meta.files.find(row => row?.rel_path === relPath);
      if (!snapshot?.content_base64) throw new Error('バージョン内のファイルが見つかりません');
      const binary = atob(snapshot.content_base64);
      _rejectProductionLegacyEntryContent(dst, new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
    }
    if (typeof provider.uploadBytesConditional !== 'function') throw new Error('安全な条件付き復元を利用できません');
    const baseline = await _folderRestoreBaseline(provider, normalized, meta.files || []);
    if (options.restore_revision && options.restore_revision !== baseline.token) {
      throw Object.assign(new Error('確認後にフォルダ内のファイルが更新されました。再確認してください'), { status: 409 });
    }
    for (const plan of baseline.plans) {
      const file = meta.files.find(file => file.rel_path === plan.relPath);
      if (typeof file.content_base64 !== 'string') throw new Error('保存版の内容がありません');
      plan.nextBytes = Uint8Array.from(atob(file.content_base64), char => char.charCodeAt(0));
      await window.MeldexFileLockStore?.requireUnlocked?.(provider, plan.path, { action: 'folder-version-restore' });
    }
    const backup = await _saveFolderVersion(provider, normalized, { auto: true, label: 'pre_restore', include_annotations: meta.annotation_snapshot != null });
    const committed = [];
    try {
      for (const plan of baseline.plans) {
        await window.MeldexFileLockStore?.requireUnlocked?.(provider, plan.path, { action: 'folder-version-restore' });
        const saved = await provider.uploadBytesConditional(plan.path, plan.nextBytes, plan.revision);
        const revision = String(saved?.rev || saved?.revision || '');
        committed.push({ plan, revision });
        if (!revision) throw new Error('復元後の更新情報を確認できません');
        const readback = await _readConflictSnapshot(provider, plan.path);
        if (readback.sha256 !== await _conflictSnapshotSha256(plan.nextBytes)) throw new Error('復元後の内容が一致しません');
      }
      await _restoreVersionAnnotations(provider, normalized, meta.annotation_snapshot, options.annotation_revision);
    } catch (error) {
      const incomplete = [];
      for (const { plan, revision } of [...committed].reverse()) {
        try {
          if (!revision) throw new Error('更新情報不明');
          if (plan.bytes === null) await provider.deletePathConditional(plan.path, revision);
          else await provider.uploadBytesConditional(plan.path, plan.bytes, revision);
        } catch { incomplete.push(plan.relPath); }
      }
      throw Object.assign(new Error(incomplete.length
        ? `復元を完了できませんでした。元データは復元前版「${backup.version}」に保持しています。再読込してください。`
        : '復元を完了できなかったため、変更したファイルを元に戻しました。' + (error?.message || '')), { status: Number(error?.status || 500) });
    }
    return { ok: true, restored_count: baseline.plans.length, restored_files: baseline.plans.map(plan => plan.relPath) };
  }

  async function _deleteFolderVersion(provider, folderPath, version) {
    const { adapter, storageKind, record } = await _findFolderVersionRecord(provider, folderPath, version, false, true);
    if (!record) throw new Error('フォルダバージョンが見つかりません');
    const token = _deletedVersionToken();
    await adapter.save(
      storageKind,
      record.documentId,
      { ...record.payload, deleted_at: _nowIso(), deleted_token: token },
      { expectedRevision: record.revision },
    );
    return { ok: true, token, version: record.payload.version_name };
  }

  async function _undeleteFolderVersion(provider, folderPath, token) {
    const normalized = _normalizeFolderPath(folderPath);
    const safeToken = _safeVersionName(token);
    const storageKind = window.MeldexSystemStorage.SystemStorageKind.VERSIONS;
    const adapter = await _managementAdapterForProvider(provider, storageKind, normalized);
    const records = await adapter.listDocuments(storageKind);
    const record = records.find(row => {
      const payload = row?.payload || {};
      return payload.object_type === 'folder'
        && payload.original_relative_path === normalized
        && payload.deleted_token === safeToken;
    });
    if (!record) throw new Error('削除済みバージョンが見つかりません');
    await adapter.save(
      storageKind,
      record.documentId,
      { ...record.payload, deleted_at: '', deleted_token: '' },
      { expectedRevision: record.revision },
    );
    return { ok: true, version: record.payload.version_name };
  }

  window.MeldexFolderVersionProviderOps = Object.freeze({
    save: (provider, path, options) => _saveFolderVersion(provider, path, options || {}),
    read: (provider, path, version) => _readFolderVersion(provider, path, version),
    restoreRevision: async (provider,path,files) => (await _folderRestoreBaseline(provider,path,files)).token,
  });
  async function _findDropboxConflictedCopies(provider, limit) {
    const maxItems = Math.max(1, Math.min(Number(limit || 50), 200));
    const maxFiles = 2500;
    const maxDirs = 500;
    const items = [];
    let total = 0;
    let scannedFiles = 0;
