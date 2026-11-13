/* Cloud batch rename: deterministic planner, provider batch move, journal, undo/redo. */
(function () {
  'use strict';

  if (window.MeldexCloudBatchRename) return;

  const IMAGE_EXTENSIONS = new Set([
    '.avif', '.bmp', '.gif', '.heic', '.heif', '.ico', '.jfif', '.jpeg',
    '.jpg', '.jxl', '.png', '.svg', '.tif', '.tiff', '.webp',
  ]);
  const MAX_ITEMS = 10000;
  const PLAN_TTL_MS = 15 * 60 * 1000;
  const LEADING_DATETIME_RE = /^(?:\d{12}(?:\d{2})?|\d{8}[-_ ]\d{4,6}|\d{4}[-.]\d{2}[-.]\d{2}[T _-]\d{2}(?:[-:.]?\d{2}){1,2}(?:[.,]\d{1,6})?|\d{4}年\d{1,2}月\d{1,2}日(?:[ _-]*\d{1,2}時\d{1,2}分(?:\d{1,2}秒)?)?)[ _-]+/i;
  const appliedResults = new Map();

  class CloudBatchRenameError extends Error {
    constructor(message, code = 'cloud_batch_rename_failed', details = null) {
      super(message);
      this.name = 'CloudBatchRenameError';
      this.code = code;
      this.details = details;
    }
  }

  function normalizePath(value) {
    const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const parts = raw.split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..')) throw new CloudBatchRenameError('管理ルート外のパスは指定できません', 'path_outside_root');
    return parts.join('/');
  }

  function dirname(path) {
    const normalized = normalizePath(path);
    return normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
  }

  function basename(path) {
    const normalized = normalizePath(path);
    return normalized.slice(normalized.lastIndexOf('/') + 1);
  }

  function joinPath(...values) {
    return normalizePath(values.filter(Boolean).join('/'));
  }

  function extension(name) {
    const match = /(?:^|\/)([^/]+)$/.exec(String(name || ''));
    const leaf = match?.[1] || '';
    const index = leaf.lastIndexOf('.');
    return index > 0 ? leaf.slice(index).toLowerCase() : '';
  }

  function removeLeadingDatetime(name) {
    return String(name || '').replace(LEADING_DATETIME_RE, '');
  }

  function suffixName(name, number) {
    const ext = extension(name);
    const stem = ext ? name.slice(0, -ext.length) : name;
    return `${stem} (${number})${ext}`;
  }

  function nameKey(name) { return String(name || '').normalize('NFC').toLocaleLowerCase('en-US'); }

  function randomId() {
    return globalThis.crypto?.randomUUID?.().replace(/-/g, '')
      || Array.from(globalThis.crypto?.getRandomValues?.(new Uint8Array(16)) || new Uint8Array(16))
        .map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function providerKind(provider) {
    const name = provider?.constructor?.name || '';
    if (/Dropbox/.test(name)) return 'dropbox';
    if (/Browser/.test(name)) return 'browser';
    return 'unknown';
  }

  function normalizeExtensions(values) {
    if (!values || !values.length) return new Set(IMAGE_EXTENSIONS);
    const result = new Set();
    for (let value of values) {
      value = String(value || '').trim().toLowerCase();
      if (value && !value.startsWith('.')) value = '.' + value;
      if (!/^\.[a-z0-9]{1,12}$/.test(value)) throw new CloudBatchRenameError(`不正な拡張子です: ${value}`, 'invalid_extension');
      result.add(value);
    }
    if (!result.size) throw new CloudBatchRenameError('対象拡張子が空です', 'invalid_extension');
    return result;
  }

  function revisionFromEntry(entry) {
    const meta = entry?.meta || {};
    return String(meta.rev || meta.revision || meta.content_hash || entry?.revision
      || `${Number(entry?.size || 0)}:${String(entry?.modified || '')}`);
  }

  function stableIdFromEntry(entry, revision) {
    return String(entry?.meta?.id || entry?.id || `${providerKind(entry?.provider)}:${revision}`);
  }

  async function workspaceSnapshot(provider) {
    const info = await provider.getWorkspaceInfo();
    if (!info?.connected || info.permission === 'readonly') throw new CloudBatchRenameError('この保存先は編集できません', 'permission_denied');
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    return {
      provider: providerKind(provider),
      workspace: String(state.securityScopeId || state.workspaceId || info.path || info.name || ''),
      namespace: String(info.namespaceKind || state.namespaceKind || (providerKind(provider) === 'browser' ? location.origin : '')),
      root: String(info.path || ''),
      permission: String(info.permission || 'readwrite'),
    };
  }

  function sameSnapshot(left, right) {
    return ['provider', 'workspace', 'namespace', 'root'].every(key => String(left?.[key] || '') === String(right?.[key] || ''));
  }

  async function listTree(provider, folder, recursive) {
    const rows = [];
    const queue = [normalizePath(folder)];
    const visited = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      const entries = await provider.listEntries(current);
      for (const entry of entries) {
        const row = { ...entry, path: normalizePath(entry.path || joinPath(current, entry.name)), provider };
        rows.push(row);
        if (recursive && row.kind === 'directory') queue.push(row.path);
      }
    }
    return { rows, directoriesRead: visited.size };
  }

  async function plan(options = {}) {
    const provider = options.provider || window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new CloudBatchRenameError('Cloud保存先がありません', 'provider_unavailable');
    if (!await provider.ensureWorkspacePermission?.('readwrite')) throw new CloudBatchRenameError('保存先を編集できません', 'permission_denied');
    const folder = normalizePath(options.folder || options.path || '');
    const folderStat = await provider.statPath(folder);
    if (!folderStat || folderStat.kind !== 'directory') throw new CloudBatchRenameError('対象フォルダが見つかりません', 'folder_not_found');
    if (options.transform && options.transform !== 'remove_leading_datetime') throw new CloudBatchRenameError('未対応の名前変換です', 'unsupported_transform');
    const conflictPolicy = String(options.conflictPolicy || options.conflict_policy || 'fail').toLowerCase();
    if (!['fail', 'suffix'].includes(conflictPolicy)) throw new CloudBatchRenameError('同名時の処理が不正です', 'invalid_conflict_policy');
    const allowed = normalizeExtensions(options.extensions);
    const snapshot = await workspaceSnapshot(provider);
    const listed = await listTree(provider, folder, !!options.recursive);
    const files = listed.rows.filter(row => row.kind === 'file');
    const occupied = new Map();
    for (const row of listed.rows) {
      const parent = dirname(row.path);
      if (!occupied.has(parent)) occupied.set(parent, new Set());
      occupied.get(parent).add(nameKey(basename(row.path)));
    }
    const allocated = new Map();
    const entries = [];
    const conflicts = [];
    let skippedExtension = 0;
    let skippedUnchanged = 0;
    for (const file of files.sort((a, b) => a.path.localeCompare(b.path, 'ja', { sensitivity: 'base' }))) {
      if (!allowed.has(extension(file.path))) { skippedExtension += 1; continue; }
      const oldName = basename(file.path);
      const requested = removeLeadingDatetime(oldName);
      if (requested === oldName) { skippedUnchanged += 1; continue; }
      const ext = extension(oldName);
      const stem = ext && requested.toLowerCase().endsWith(ext) ? requested.slice(0, -ext.length) : requested;
      if (!requested || requested === '.' || requested === '..' || !stem.trim().replace(/[. ]+$/g, '')) {
        throw new CloudBatchRenameError(`変更後の名前が空です: ${oldName}`, 'empty_destination_name');
      }
      if (/[\\/:*?"<>|\u0000-\u001f]/.test(requested)) throw new CloudBatchRenameError(`変更後の名前が不正です: ${requested}`, 'invalid_destination_name');
      const parent = dirname(file.path);
      const reserved = occupied.get(parent) || new Set();
      const used = allocated.get(parent) || new Set();
      allocated.set(parent, used);
      let nextName = requested;
      let key = nameKey(nextName);
      if (reserved.has(key) || used.has(key)) {
        if (conflictPolicy === 'fail') {
          conflicts.push({ path: file.path, requested_name: requested, reason: 'destination_exists' });
          continue;
        }
        let number = 2;
        do { nextName = suffixName(requested, number++); key = nameKey(nextName); }
        while (reserved.has(key) || used.has(key));
      }
      used.add(key);
      const metadata = snapshot.provider === 'dropbox' ? await provider.getMetadata(file.path) : null;
      if (metadata) file.meta = metadata;
      const revision = revisionFromEntry(file);
      entries.push({
        source: file.path,
        destination: joinPath(parent, nextName),
        stable_id: stableIdFromEntry(file, revision),
        revision,
        size: Number(file.size || 0),
        kind: 'file',
      });
      if (entries.length > MAX_ITEMS) throw new CloudBatchRenameError(`対象が上限${MAX_ITEMS}件を超えています`, 'too_many_items');
    }
    const now = Date.now();
    return Object.freeze({
      schema_version: 1,
      operation_id: randomId(),
      provider: snapshot.provider,
      workspace: snapshot.workspace,
      namespace: snapshot.namespace,
      operation_root: snapshot.root,
      target_folder: folder,
      recursive: !!options.recursive,
      transform: 'remove_leading_datetime',
      extensions: Array.from(allowed).sort(),
      conflict_policy: conflictPolicy,
      entries,
      conflicts,
      scanned_count: files.length,
      matched_count: entries.length + conflicts.length,
      skipped_extension_count: skippedExtension,
      skipped_unchanged_count: skippedUnchanged,
      directories_read: listed.directoriesRead,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + PLAN_TTL_MS).toISOString(),
      _provider: provider,
      _snapshot: snapshot,
    });
  }

  async function resolveJournalAdapter(provider) {
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.BATCH_FILE_OPERATIONS;
    if (!kind) throw new CloudBatchRenameError('操作記録の保存種別が利用できません', 'journal_unavailable');
    if (typeof provider.getSystemStorageAdapter === 'function') return { adapter: provider.getSystemStorageAdapter(), kind };
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!resolver?.resolveTypedAdapterForProvider) throw new CloudBatchRenameError('操作記録の保存先を判定できません', 'journal_unavailable');
    return { adapter: await resolver.resolveTypedAdapterForProvider(provider, kind), kind };
  }

  function serializablePlan(batchPlan) {
    const copy = { ...batchPlan };
    delete copy._provider;
    delete copy._snapshot;
    return JSON.parse(JSON.stringify(copy));
  }

  async function saveJournal(provider, operationId, payload, expectedRevision) {
    const { adapter, kind } = await resolveJournalAdapter(provider);
    const record = await adapter.save(kind, operationId, payload, { expectedRevision });
    return { adapter, kind, record };
  }

  async function loadJournal(provider, operationId) {
    const { adapter, kind } = await resolveJournalAdapter(provider);
    const record = await adapter.load(kind, String(operationId || ''));
    if (!record) throw new CloudBatchRenameError('操作記録が見つかりません', 'journal_not_found');
    return { adapter, kind, record };
  }

  async function transition(journal, expectedState, nextState, extra = {}) {
    if (journal.record.payload?.state !== expectedState) throw new CloudBatchRenameError('操作状態が別の画面で変更されました', 'journal_state_changed');
    const payload = { ...journal.record.payload, ...extra, state: nextState, updated_at: new Date().toISOString() };
    journal.record = await journal.adapter.save(journal.kind, journal.record.documentId, payload, { expectedRevision: journal.record.revision });
    return journal;
  }

  async function revalidate(provider, batchPlan, entries, direction = 'forward') {
    const currentSnapshot = await workspaceSnapshot(provider);
    const expectedSnapshot = batchPlan._snapshot || {
      provider: batchPlan.provider, workspace: batchPlan.workspace, namespace: batchPlan.namespace, root: batchPlan.operation_root,
    };
    if (!sameSnapshot(currentSnapshot, expectedSnapshot)) throw new CloudBatchRenameError('保存先が計画作成後に切り替わりました', 'workspace_changed');
    if (Date.parse(batchPlan.expires_at || 0) < Date.now() && direction === 'forward') throw new CloudBatchRenameError('計画の有効期限が切れました', 'plan_expired');
    if (window.MeldexFileLockStore?.requireUnlocked) {
      await window.MeldexFileLockStore.requireUnlocked(provider, batchPlan.target_folder, { action: 'batch-rename', includeDescendants: true });
    }
    for (const entry of entries) {
      const source = direction === 'forward' ? entry.source : entry.destination;
      const destination = direction === 'forward' ? entry.destination : entry.source;
      const stat = await provider.statPath(source);
      if (!stat || stat.kind !== 'file') throw new CloudBatchRenameError(`改名元が変更されました: ${source}`, 'source_changed');
      if (await provider.statPath(destination)) throw new CloudBatchRenameError(`改名先に既に存在します: ${destination}`, 'destination_exists');
      const actualRevision = revisionFromEntry(stat);
      const expectedRevision = direction === 'forward' ? entry.revision : (entry.applied_revision || entry.revision);
      if (expectedRevision && actualRevision !== expectedRevision && stat.meta?.rev) {
        throw new CloudBatchRenameError(`内容が変更されました: ${source}`, 'revision_changed');
      }
      if (entry.stable_id && stat.meta?.id && String(stat.meta.id) !== String(entry.stable_id)) {
        throw new CloudBatchRenameError(`別のファイルへ置き換わりました: ${source}`, 'stable_id_changed');
      }
    }
  }

  async function prepareAftercare(provider, entries, operationId, direction) {
    const hook = window.MeldexCloudBatchRenameAftercare;
    if (hook?.prepare) {
      const result = await hook.prepare({ provider, entries, operationId, direction });
      if (result?.ok === false) throw new CloudBatchRenameError('管理情報の事前確認に失敗しました', 'aftercare_prepare_failed', result.warnings);
      return result;
    }
    if (window.MeldexDataAccess?.requestJson) {
      const result = await window.MeldexDataAccess.requestJson('/outliner/batch-rename-aftercare', {
        method: 'POST', body: { phase: 'prepare', entries, operation_id: operationId, direction },
      });
      if (result?.ok === false) throw new CloudBatchRenameError('管理情報の事前確認に失敗しました', 'aftercare_prepare_failed', result.warnings);
      return result?.token || null;
    }
    throw new CloudBatchRenameError('一括変更の管理情報追随を利用できません', 'aftercare_unavailable');
  }

  async function runAftercare(provider, entries, operationId, direction, prepared) {
    const hook = window.MeldexCloudBatchRenameAftercare;
    if (hook?.apply && typeof prepared !== 'string') {
      const result = await hook.apply({ provider, entries, operationId, direction, prepared });
      if (result?.ok === false) throw new CloudBatchRenameError('管理情報の追随に失敗しました', 'aftercare_failed', result.warnings);
      return result;
    }
    if (window.MeldexDataAccess?.requestJson) {
      const result = await window.MeldexDataAccess.requestJson('/outliner/batch-rename-aftercare', {
        method: 'POST', body: { phase: 'apply', entries, operation_id: operationId, direction, token: prepared || null },
      });
      if (result?.ok === false) throw new CloudBatchRenameError('管理情報の追随に失敗しました', 'aftercare_failed', result.warnings);
      return result;
    }
    throw new CloudBatchRenameError('一括変更の管理情報追随を利用できません', 'aftercare_unavailable');
  }

  async function applyPlan(batchPlan, options = {}) {
    const provider = options.provider || batchPlan?._provider || window.MeldexStorageAdapter?.getProvider?.();
    if (!batchPlan || !Array.isArray(batchPlan.entries)) throw new CloudBatchRenameError('一括改名計画が不正です', 'invalid_plan');
    if (batchPlan.conflicts?.length) throw new CloudBatchRenameError('同名になるファイルがあります', 'destination_conflicts', batchPlan.conflicts);
    if (!batchPlan.entries.length) return { ok: true, operation_id: batchPlan.operation_id, changed_count: 0, state: 'applied' };
    if (appliedResults.has(batchPlan.operation_id)) return appliedResults.get(batchPlan.operation_id);
    await revalidate(provider, batchPlan, batchPlan.entries, 'forward');
    const aftercarePrepared = await prepareAftercare(provider, batchPlan.entries, batchPlan.operation_id, 'forward');
    const prepared = await provider.prepareBatchMoveNoReplace(batchPlan.entries, { operationId: batchPlan.operation_id, snapshot: batchPlan._snapshot });
    const payload = { schema_version: 1, kind: 'batch_rename', state: 'prepared', plan: serializablePlan(batchPlan), completed: [], created_at: new Date().toISOString() };
    let journal = await saveJournal(provider, batchPlan.operation_id, payload, null);
    await transition(journal, 'prepared', 'applying');
    let result;
    let physicalMoveCompleted = false;
    try {
      result = await provider.executeBatchMoveNoReplace(prepared, options.onProgress);
      if (!result?.ok || result.failed?.length) throw Object.assign(new Error('一括移動の一部が失敗しました'), { batchResult: result });
      const updatedEntries = batchPlan.entries.map(entry => ({ ...entry, applied_revision: result.completed?.find(row => row.source === entry.source)?.revision || entry.revision }));
      physicalMoveCompleted = true;
      await runAftercare(provider, updatedEntries, batchPlan.operation_id, 'forward', aftercarePrepared);
      await transition(journal, 'applying', 'applied', { completed: updatedEntries, result: { changed_count: updatedEntries.length } });
      const response = { ok: true, operation_id: batchPlan.operation_id, changed_count: updatedEntries.length, state: 'applied', entries: updatedEntries };
      appliedResults.set(batchPlan.operation_id, response);
      return response;
    } catch (error) {
      const completed = error?.batchResult?.completed || result?.completed || [];
      // 物理移動が全件完了した後の aftercare 失敗では、ファイルだけを元へ戻すと
      // 既に更新済みの参照・アノテート・版管理が新パスのまま残り、両者が分断する。
      // write-ahead journal を recovery_required に保ち、read-back 後に同じ方向の
      // aftercare を冪等に再実行してから applied を確定する。
      if (physicalMoveCompleted) {
        const latest = await loadJournal(provider, batchPlan.operation_id).catch(() => journal);
        await transition(latest, 'applying', 'recovery_required', {
          completed,
          error: String(error?.message || error),
          replay_direction: 'redo',
          recovery_stage: 'aftercare',
        }).catch(() => {});
        throw error;
      }
      await transition(journal, 'applying', 'compensating', { completed, error: String(error?.message || error) }).catch(() => {});
      let compensation = { ok: completed.length === 0, completed: [], failed: [] };
      if (completed.length) compensation = await provider.compensateBatchMove(batchPlan.operation_id, completed).catch(err => ({ ok: false, completed: [], failed: completed, error: String(err?.message || err) }));
      const latest = await loadJournal(provider, batchPlan.operation_id).catch(() => journal);
      await transition(latest, 'compensating', compensation.ok ? 'rolled_back' : 'recovery_required', { compensation }).catch(() => {});
      throw error;
    }
  }

  async function replay(operationId, direction, options = {}) {
    const provider = options.provider || window.MeldexStorageAdapter?.getProvider?.();
    const journal = await loadJournal(provider, operationId);
    const expected = direction === 'undo' ? 'applied' : 'undone';
    const intermediate = direction === 'undo' ? 'undoing' : 'redoing';
    const finalState = direction === 'undo' ? 'undone' : 'applied';
    if (journal.record.payload?.state === finalState) return { ok: true, operation_id: operationId, state: finalState, unchanged: true };
    if (journal.record.payload?.state !== expected) throw new CloudBatchRenameError('この操作は現在の状態では実行できません', 'journal_state_changed');
    const storedPlan = journal.record.payload.plan;
    const baseEntries = journal.record.payload.completed?.length ? journal.record.payload.completed : storedPlan.entries;
    const entries = direction === 'undo'
      ? baseEntries.map(entry => ({ ...entry, source: entry.destination, destination: entry.source, revision: entry.applied_revision || entry.revision }))
      : baseEntries.map(entry => ({ ...entry }));
    await revalidate(provider, storedPlan, baseEntries, direction === 'undo' ? 'reverse' : 'forward');
    const aftercarePrepared = await prepareAftercare(provider, baseEntries, operationId, direction === 'undo' ? 'reverse' : 'forward');
    await transition(journal, expected, intermediate);
    try {
      const prepared = await provider.prepareBatchMoveNoReplace(entries, { operationId: `${operationId}:${direction}`, snapshot: storedPlan._snapshot });
      const result = await provider.executeBatchMoveNoReplace(prepared, options.onProgress);
      if (!result?.ok || result.failed?.length) throw Object.assign(new Error(`${direction}の一部が失敗しました`), { batchResult: result });
      await runAftercare(provider, baseEntries, operationId, direction === 'undo' ? 'reverse' : 'forward', aftercarePrepared);
      await transition(journal, intermediate, finalState, { last_replay_at: new Date().toISOString() });
      appliedResults.delete(operationId);
      return { ok: true, operation_id: operationId, state: finalState, changed_count: entries.length };
    } catch (error) {
      const latest = await loadJournal(provider, operationId).catch(() => journal);
      await transition(latest, intermediate, 'recovery_required', { error: String(error?.message || error), replay_direction: direction }).catch(() => {});
      throw error;
    }
  }

  async function undo(operationId, options) { return replay(operationId, 'undo', options); }
  async function redo(operationId, options) { return replay(operationId, 'redo', options); }

  async function recover(operationId, options = {}) {
    const provider = options.provider || window.MeldexStorageAdapter?.getProvider?.();
    const journal = await loadJournal(provider, operationId);
    const state = String(journal.record.payload?.state || '');
    if (['applied', 'undone', 'rolled_back'].includes(state)) return { ok: true, operation_id: operationId, state, unchanged: true };
    const storedPlan = journal.record.payload?.plan || {};
    // 復旧判定は成功項目だけでなく計画全体をread-backする。部分成功だけを
    // 「全件完了」と誤認してaftercareを適用しない。
    const entries = storedPlan.entries || [];
    if (state === 'prepared') {
      await transition(journal, 'prepared', 'rolled_back', { recovery: 'no_physical_change' });
      return { ok: true, operation_id: operationId, state: 'rolled_back' };
    }
    if (!['applying', 'compensating', 'undoing', 'redoing', 'recovery_required'].includes(state)) {
      throw new CloudBatchRenameError('復旧できない操作状態です', 'journal_state_changed');
    }
    const forward = state !== 'undoing' && journal.record.payload?.replay_direction !== 'undo';
    const physicalEntries = forward ? entries : entries.map(entry => ({ ...entry, source: entry.destination, destination: entry.source }));
    const inspected = await provider.inspectBatchMove(operationId, physicalEntries);
    const finished = inspected.filter(row => !row.sourceExists && row.destinationExists);
    const untouched = inspected.filter(row => row.sourceExists && !row.destinationExists);
    if (finished.length === inspected.length && inspected.length) {
      const direction = forward ? 'forward' : 'reverse';
      const aftercarePrepared = await prepareAftercare(provider, entries, operationId, direction);
      await runAftercare(provider, entries, operationId, direction, aftercarePrepared);
      await transition(journal, state, forward ? 'applied' : 'undone', { recovery: 'completed_from_readback' });
      return { ok: true, operation_id: operationId, state: forward ? 'applied' : 'undone', recovered: true };
    }
    if (untouched.length === inspected.length) {
      await transition(journal, state, forward ? 'rolled_back' : 'applied', { recovery: 'no_physical_change' });
      return { ok: true, operation_id: operationId, state: forward ? 'rolled_back' : 'applied', recovered: true };
    }
    const completed = physicalEntries.filter(entry => {
      const row = inspected.find(item => item.source === entry.source && item.destination === entry.destination);
      return row && !row.sourceExists && row.destinationExists;
    });
    const compensation = await provider.compensateBatchMove(operationId, completed);
    await transition(journal, state, compensation.ok ? (forward ? 'rolled_back' : 'applied') : 'recovery_required', { recovery: 'compensation', compensation });
    if (!compensation.ok) throw new CloudBatchRenameError('一括変更を自動復旧できませんでした', 'recovery_required', compensation.failed);
    return { ok: true, operation_id: operationId, state: forward ? 'rolled_back' : 'applied', recovered: true };
  }

  async function recentOperation(folder, options = {}) {
    const provider = options.provider || window.MeldexStorageAdapter?.getProvider?.();
    const { adapter, kind } = await resolveJournalAdapter(provider);
    if (typeof adapter.listDocuments !== 'function') return null;
    const target = normalizePath(folder || '');
    const records = await adapter.listDocuments(kind);
    return records.filter(record => record?.payload?.kind === 'batch_rename'
      && normalizePath(record.payload?.plan?.target_folder || '') === target)
      .sort((left, right) => String(right.payload?.created_at || '').localeCompare(String(left.payload?.created_at || '')))[0] || null;
  }

  let latestOperationId = '';
  function closeDialog() { document.querySelector('[data-cloud-batch-rename-dialog]')?.remove(); }

  function progressLabel(value) {
    return `${Number(value?.completed || 0)} / ${Number(value?.total || 0)} 件`;
  }

  async function openDialog(folder, options = {}) {
    closeDialog();
    const overlay = document.createElement('div');
    overlay.dataset.cloudBatchRenameDialog = '1';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10040;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:12px;';
    const dialog = document.createElement('section');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'cloud-batch-rename-title');
    dialog.style.cssText = 'width:min(760px,100%);max-height:min(760px,92vh);display:flex;flex-direction:column;background:var(--bg,#fff);color:var(--fg,#222);border:1px solid var(--border,#bbb);border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.32);overflow:hidden;';
    dialog.innerHTML = `
      <header style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px"><h2 id="cloud-batch-rename-title" style="font-size:16px;margin:0;flex:1">ファイル名を一括変更</h2><button type="button" data-action="close" aria-label="閉じる">×</button></header>
      <div style="padding:14px 16px;overflow:auto;display:grid;gap:12px">
        <div style="font-size:12px;color:var(--fg2)">対象: <span data-role="folder"></span></div>
        <label><input type="checkbox" data-role="recursive"> サブフォルダを含む</label>
        <label>対象拡張子 <input data-role="extensions" value="jpg,jpeg,png,gif,webp,avif,svg" style="width:100%;box-sizing:border-box"></label>
        <label>同名時 <select data-role="conflict"><option value="fail">停止する</option><option value="suffix">連番で解消</option></select></label>
        <div data-role="summary" role="status">変更内容を確認しています…</div>
        <div data-role="progress" style="display:none"></div>
        <div data-role="list" style="max-height:330px;overflow:auto;border:1px solid var(--border);border-radius:7px"></div>
      </div>
      <footer style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:0;background:var(--bg)">
        <button type="button" data-action="retry" disabled>失敗分を再確認</button><button type="button" data-action="undo" disabled>元に戻す</button><button type="button" data-action="redo" disabled>やり直す</button><button type="button" data-action="refresh">再確認</button><button type="button" data-action="apply" disabled>実行</button>
      </footer>`;
    overlay.appendChild(dialog); document.body.appendChild(overlay);
    const role = name => dialog.querySelector(`[data-role="${name}"]`);
    const action = name => dialog.querySelector(`[data-action="${name}"]`);
    role('folder').textContent = normalizePath(folder);
    let batchPlan = null;
    let busy = false;
    const setBusy = value => { busy = value; dialog.querySelectorAll('button,input,select').forEach(node => { if (node.dataset.action !== 'close') node.disabled = value; }); };
    const renderPlan = value => {
      role('summary').textContent = `${value.entries.length} 件を変更、${value.conflicts.length} 件の同名衝突、${value.skipped_unchanged_count} 件は変更不要`;
      const rows = value.entries.slice(0, 200).map(entry => `<div style="padding:7px 9px;border-bottom:1px solid var(--border);font-size:12px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:8px"><span style="overflow:hidden;text-overflow:ellipsis">${String(entry.source).replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]))}</span><span>→</span><span style="overflow:hidden;text-overflow:ellipsis">${String(entry.destination).replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]))}</span></div>`).join('');
      role('list').innerHTML = rows + (value.entries.length > 200 ? `<div style="padding:8px">ほか ${value.entries.length - 200} 件（表示を省略）</div>` : '');
      action('apply').disabled = !value.entries.length || !!value.conflicts.length;
    };
    const refresh = async () => {
      if (busy) return; setBusy(true);
      try {
        batchPlan = await plan({ folder, recursive: role('recursive').checked, extensions: role('extensions').value.split(','), conflictPolicy: role('conflict').value });
        renderPlan(batchPlan);
      } catch (error) { role('summary').textContent = error?.message || String(error); role('list').textContent = ''; }
      finally { setBusy(false); action('apply').disabled = !batchPlan?.entries?.length || !!batchPlan?.conflicts?.length; }
    };
    action('close').onclick = closeDialog; overlay.addEventListener('click', event => { if (event.target === overlay && !busy) closeDialog(); });
    action('refresh').onclick = refresh;
    action('retry').onclick = async () => {
      if (!latestOperationId || busy) return; setBusy(true);
      try { const result = await recover(latestOperationId); role('summary').textContent = `操作を再確認しました: ${result.state}`; action('undo').disabled = result.state !== 'applied'; action('redo').disabled = result.state !== 'undone'; }
      catch (error) { role('summary').textContent = `自動復旧できませんでした: ${error?.message || error}`; }
      finally { busy = false; action('retry').disabled = true; action('close').disabled = false; }
    };
    action('apply').onclick = async () => {
      if (!batchPlan || busy) return; setBusy(true); role('progress').style.display = 'block';
      let succeeded = false;
      try {
        const result = await applyPlan(batchPlan, { onProgress: value => { role('progress').textContent = progressLabel(value); } });
        latestOperationId = result.operation_id; succeeded = true; role('summary').textContent = `${result.changed_count} 件を変更しました`; action('undo').disabled = false;
        window.refreshOutliner?.();
      } catch (error) { role('summary').textContent = `実行できませんでした: ${error?.message || error}`; }
      finally { busy = false; dialog.querySelectorAll('button,input,select').forEach(node => { node.disabled = false; }); action('apply').disabled = true; action('undo').disabled = !succeeded; action('redo').disabled = true; }
    };
    action('undo').onclick = async () => {
      if (!latestOperationId || busy) return; setBusy(true);
      let succeeded = false;
      try { await undo(latestOperationId, { onProgress: value => { role('progress').textContent = progressLabel(value); } }); succeeded = true; role('summary').textContent = '一括変更を元に戻しました'; action('redo').disabled = false; window.refreshOutliner?.(); }
      catch (error) { role('summary').textContent = `元に戻せませんでした: ${error?.message || error}`; }
      finally { busy = false; action('undo').disabled = succeeded; action('redo').disabled = !succeeded; action('close').disabled = false; }
    };
    action('redo').onclick = async () => {
      if (!latestOperationId || busy) return; setBusy(true);
      let succeeded = false;
      try { await redo(latestOperationId, { onProgress: value => { role('progress').textContent = progressLabel(value); } }); succeeded = true; role('summary').textContent = '一括変更をやり直しました'; action('undo').disabled = false; window.refreshOutliner?.(); }
      catch (error) { role('summary').textContent = `やり直せませんでした: ${error?.message || error}`; }
      finally { busy = false; action('redo').disabled = succeeded; action('undo').disabled = !succeeded; action('close').disabled = false; }
    };
    await refresh();
    try {
      const recent = await recentOperation(folder);
      const state = String(recent?.payload?.state || '');
      if (recent) latestOperationId = recent.documentId;
      if (state === 'applied') action('undo').disabled = false;
      else if (state === 'undone') action('redo').disabled = false;
      else if (['prepared', 'applying', 'compensating', 'undoing', 'redoing', 'recovery_required'].includes(state)) {
        action('retry').disabled = false;
        role('summary').textContent += '。前回の未完了操作があります。失敗分を再確認してください';
      }
    } catch {}
    return { dialog, getPlan: () => batchPlan };
  }

  async function executeNativeTool(name, args = {}) {
    if (name === 'batch_rename') {
      const batchPlan = await plan({ folder: args.path || args.folder, recursive: !!args.recursive, extensions: args.extensions, conflictPolicy: args.conflict_policy });
      if (args.dry_run !== false) return { ok: true, dry_run: true, ...serializablePlan(batchPlan) };
      return applyPlan(batchPlan);
    }
    if (name === 'batch_rename_undo') return undo(args.operation_id);
    if (name === 'batch_rename_redo') return redo(args.operation_id);
    throw new CloudBatchRenameError(`未対応のCloudツールです: ${name}`, 'unsupported_tool');
  }

  function installProviderContracts() {
    const browser = window.MeldexStorageAdapter?.BrowserStorageProvider?.prototype;
    if (browser && !browser.getBatchMoveCapabilities) {
      browser.getBatchMoveCapabilities = function () {
        return { maxBatchSize: 10000, nativeMove: true, fallbackConcurrency: 3, noReplace: true };
      };
      browser.prepareBatchMoveNoReplace = async function (entries, context = {}) {
        return { operationId: context.operationId, entries: entries.map(entry => ({ ...entry })), completed: [] };
      };
      browser.executeBatchMoveNoReplace = async function (prepared, progress) {
        const completed = [];
        const failed = [];
        const entries = prepared.entries || [];
        const run = async entry => {
          try {
            const parent = await this._nativeDirectory(dirname(entry.source), false);
            const handle = await parent.getFileHandle(basename(entry.source), { create: false });
            if (typeof handle.move === 'function' && dirname(entry.source) === dirname(entry.destination)) {
              await handle.move(basename(entry.destination));
            } else if (typeof handle.move === 'function') {
              const destinationParent = await this._nativeDirectory(dirname(entry.destination), false);
              await handle.move(destinationParent, basename(entry.destination));
            } else {
              await this.copyPath(entry.source, entry.destination);
              const sourceFile = await this.downloadAsFile(entry.source).catch(() => null);
              const targetFile = await this.downloadAsFile(entry.destination).catch(() => null);
              if (!sourceFile || !targetFile || sourceFile.size !== targetFile.size) throw new Error('コピー結果を検証できません');
              await this.deletePath(entry.source);
            }
            const stat = await this.statPath(entry.destination);
            const row = { ...entry, revision: revisionFromEntry(stat) };
            completed.push(row);
            progress?.({ completed: completed.length, total: entries.length, entry: row });
          } catch (error) { failed.push({ ...entry, error: String(error?.message || error) }); }
        };
        let index = 0;
        const workers = Array.from({ length: Math.min(3, entries.length) }, async () => {
          while (index < entries.length) { const current = entries[index++]; await run(current); }
        });
        await Promise.all(workers);
        return { ok: failed.length === 0, completed, failed, operationId: prepared.operationId };
      };
      browser.inspectBatchMove = async function (_operationId, entries = []) {
        const states = [];
        for (const entry of entries) states.push({ source: entry.source, destination: entry.destination, sourceExists: !!await this.statPath(entry.source), destinationExists: !!await this.statPath(entry.destination) });
        return states;
      };
      browser.compensateBatchMove = async function (operationId, completedEntries) {
        const reverse = completedEntries.slice().reverse().map(entry => ({ ...entry, source: entry.destination, destination: entry.source }));
        return this.executeBatchMoveNoReplace({ operationId: `${operationId}:compensate`, entries: reverse });
      };
    }

    const dropbox = window.MeldexStorageAdapter?.DropboxStorageProvider?.prototype;
    if (dropbox && !dropbox.getBatchMoveCapabilities) {
      dropbox.getBatchMoveCapabilities = function () { return { maxBatchSize: 1000, asyncJob: true, noReplace: true }; };
      dropbox.prepareBatchMoveNoReplace = async function (entries, context = {}) {
        const groups = new Map();
        for (const entry of entries) {
          const from = this._dropboxLocation(entry.source);
          const to = this._dropboxLocation(entry.destination);
          const key = `${from.namespaceKind}:${to.namespaceKind}`;
          if (!groups.has(key)) groups.set(key, { location: to, entries: [] });
          let fromPath = from.path;
          if (from.namespaceKind !== to.namespaceKind) {
            const metadata = await this.getMetadata(entry.source);
            fromPath = String(metadata?.id || '');
            if (!fromPath) throw new CloudBatchRenameError('Dropbox領域をまたぐ移動元を確認できません', 'stable_id_unavailable');
          }
          groups.get(key).entries.push({ ...entry, from: { ...from, path: fromPath }, to });
        }
        return { operationId: context.operationId, groups: Array.from(groups.values()) };
      };
      dropbox.executeBatchMoveNoReplace = async function (prepared, progress) {
        const completed = [];
        const failed = [];
        for (const group of prepared.groups || []) {
          for (let offset = 0; offset < group.entries.length; offset += 1000) {
            const chunk = group.entries.slice(offset, offset + 1000);
            let payload = await this._rpc('files/move_batch_v2', {
              entries: chunk.map(entry => ({ from_path: entry.from.path, to_path: entry.to.path })),
              autorename: false,
            }, group.location);
            let polls = 0;
            while (payload?.['.tag'] === 'async_job_id' || payload?.async_job_id) {
              if (++polls > 120) throw new CloudBatchRenameError('Dropbox一括移動の完了確認がタイムアウトしました', 'dropbox_job_timeout');
              await new Promise(resolve => setTimeout(resolve, Math.min(250 + polls * 50, 1500)));
              payload = await this._rpc('files/move_batch/check_v2', { async_job_id: payload.async_job_id }, group.location);
            }
            const rows = payload?.entries || payload?.complete?.entries || [];
            chunk.forEach((entry, index) => {
              const result = rows[index];
              const tag = result?.['.tag'] || result?.success?.['.tag'] || '';
              if (result && (tag === 'failure' || result.failure)) failed.push({ ...entry, error: JSON.stringify(result.failure || result) });
              else completed.push({ ...entry, revision: String(result?.success?.metadata?.rev || entry.revision) });
              progress?.({ completed: completed.length, failed: failed.length, total: (prepared.groups || []).reduce((sum, item) => sum + item.entries.length, 0), entry });
            });
            if (!rows.length && payload?.['.tag'] === 'failed') chunk.forEach(entry => failed.push({ ...entry, error: JSON.stringify(payload) }));
          }
        }
        const affectedFolders = new Set();
        completed.forEach(entry => { this._forgetMeta?.(entry.source); this._forgetListCache?.(dirname(entry.source)); this._forgetListCache?.(dirname(entry.destination)); affectedFolders.add(dirname(entry.destination)); });
        const found = new Map();
        for (const folder of affectedFolders) for (const entry of await this.listEntries(folder)) found.set(entry.path, entry);
        const verified = [];
        for (const entry of completed) {
          const actual = found.get(entry.destination);
          if (!actual) failed.push({ ...entry, error: 'Dropbox read-backで移動先を確認できません' });
          else {
            const metadata = await this.getMetadata(entry.destination);
            verified.push({ ...entry, revision: revisionFromEntry({ ...actual, meta: metadata }) || entry.revision });
          }
        }
        return { ok: failed.length === 0, completed: verified, failed, operationId: prepared.operationId };
      };
      dropbox.inspectBatchMove = async function (_operationId, entries = []) {
        const states = [];
        for (const entry of entries) states.push({ source: entry.source, destination: entry.destination, sourceExists: !!await this.refreshMetadata(entry.source), destinationExists: !!await this.refreshMetadata(entry.destination) });
        return states;
      };
      dropbox.compensateBatchMove = async function (operationId, completedEntries) {
        const reverse = completedEntries.slice().reverse().map(entry => ({ ...entry, source: entry.destination, destination: entry.source }));
        const prepared = await this.prepareBatchMoveNoReplace(reverse, { operationId: `${operationId}:compensate` });
        return this.executeBatchMoveNoReplace(prepared);
      };
    }
  }

  installProviderContracts();

  window.MeldexCloudBatchRename = {
    IMAGE_EXTENSIONS: Object.freeze(Array.from(IMAGE_EXTENSIONS)),
    CloudBatchRenameError,
    removeLeadingDatetime,
    plan,
    applyPlan,
    undo,
    redo,
    recover,
    recentOperation,
    get latestOperationId() { return latestOperationId; },
    openDialog,
    executeNativeTool,
    installProviderContracts,
  };
  window.MeldexCloudNativeTools ||= { definitions: new Map(), execute: executeNativeTool };
  [
    { name: 'batch_rename', description: 'Cloud保存先の画像ファイル名から先頭の日時を一括削除する', input_schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, recursive: { type: 'boolean' }, extensions: { type: 'array', items: { type: 'string' } }, conflict_policy: { enum: ['fail', 'suffix'] }, dry_run: { type: 'boolean' } } } },
    { name: 'batch_rename_undo', description: 'Cloud一括改名を操作ID単位で元に戻す', input_schema: { type: 'object', required: ['operation_id'], properties: { operation_id: { type: 'string' } } } },
    { name: 'batch_rename_redo', description: '元に戻したCloud一括改名をやり直す', input_schema: { type: 'object', required: ['operation_id'], properties: { operation_id: { type: 'string' } } } },
  ].forEach(definition => window.MeldexCloudNativeTools.definitions.set(definition.name, definition));
})();
