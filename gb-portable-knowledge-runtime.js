(function (global) {
  'use strict';

  // 可搬ナレッジの断片(artifacts)と端末別台帳(devices)は、固有形式付随物廃止・
  // 管理データ一元化計画(app/docs/proprietary-format-sidecar-cleanup-plan-2026-07-31.md)
  // の共通ストレージ層(gb-system-storage.js + gb-system-storage-dropbox.js)経由で
  // 個人管理領域(/MeldexSettings/system/v1/…)へ保存する。保存フォルダ内へ
  // `_meldex` 等の固有付随物を新規作成することはPhase 6で機械的に禁止されている
  // (旧実装は禁止パス `_meldex/portable-knowledge/v1` を直接書いていたため撤去した。
  // 実利用者の保存先にはまだ何も書き込まれていなかったため、データ移行は不要)。
  //
  // 個人管理領域を選ぶ理由: 可搬ナレッジは接続中フォルダ1つではなく、登録済みの
  // 全ソースフォルダ(_scanRootDirectories参照)を横断するDropboxアカウント単位の
  // 機能。接続中ルートが参加中の共有ワークスペースだった場合に共有管理領域へ
  // 保存すると、ユーザー個人限定のソースフォルダ内容が他メンバーへ漏れかねない
  // ため、常に個人管理領域(resolveAdapterForProvider({personalOnly:true}))を使う。
  const SYNC_INTERVAL_MS = 10 * 60 * 1000;
  const EDIT_DEBOUNCE_MS = 12 * 1000;
  const MAX_FILES = 20000;
  const MAX_TEXT_BYTES = 4 * 1024 * 1024;
  const contract = () => global.MeldexPortableKnowledgeContract;
  const store = () => global.MeldexPortableKnowledgeStore;
  const systemStorage = () => global.MeldexSystemStorage;
  const managementResolver = () => global.MeldexDropboxManagementRootResolver;
  let initialized = false;
  let initializing = null;
  let activeSync = null;
  let scheduledTimer = 0;
  let worker = null;
  let workerSequence = 0;
  const workerRequests = new Map();

  function _now() {
    return new Date().toISOString();
  }

  function _deviceId() {
    const key = 'meldex-portable-knowledge-device-id';
    try {
      let value = localStorage.getItem(key);
      if (!value) {
        value = global.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(key, value);
      }
      return value;
    } catch {
      return 'ephemeral-device';
    }
  }

  function _runtimeMode() {
    return String(global.MeldexRuntimeAdapter?.getMode?.() || 'legacy');
  }

  function isAvailable() {
    return ['browser', 'dropbox'].includes(_runtimeMode()) && !!global.indexedDB && !!contract() && !!store();
  }

  function _worker() {
    if (worker) return worker;
    if (typeof Worker !== 'function') return null;
    try {
      worker = new Worker(new URL('gb-portable-knowledge-worker.js', document.baseURI));
      worker.addEventListener('message', event => {
        const response = event.data || {};
        const pending = workerRequests.get(response.id);
        if (!pending) return;
        workerRequests.delete(response.id);
        if (response.ok) pending.resolve(response);
        else pending.reject(new Error(response.error || '自動ナレッジ処理に失敗しました'));
      });
      worker.addEventListener('error', () => {
        workerRequests.forEach(pending => pending.reject(new Error('端末内ナレッジ処理を再開します')));
        workerRequests.clear();
        worker?.terminate?.();
        worker = null;
      });
      return worker;
    } catch {
      worker = null;
      return null;
    }
  }

  function _workerCall(type, payload) {
    const instance = _worker();
    if (!instance) return null;
    const id = `portable-${++workerSequence}`;
    return new Promise((resolve, reject) => {
      workerRequests.set(id, { resolve, reject });
      instance.postMessage({ id, type, ...payload });
    });
  }

  async function _extract(input) {
    const pending = _workerCall('extract', { input });
    if (pending) {
      try { return (await pending).artifact; } catch { /* main-thread fallback below */ }
    }
    return contract().createArtifact(input);
  }

  async function _score(artifacts, query, limit) {
    const pending = _workerCall('score', { artifacts, query, limit });
    if (pending) {
      try { return (await pending).rows; } catch { /* main-thread fallback below */ }
    }
    return artifacts.map(artifact => ({ artifact, ...contract().scoreArtifact(artifact, query) }))
      .filter(row => row.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // MeldexSystemStorageのdocument_idは英数字・ハイフン・アンダースコアのみ
  // (先頭/末尾は英数字、1〜128文字)。ドットを禁則文字へ含め、境界の英数字も保証する。
  function _safeDocIdPart(value, maxLen = 120) {
    let cleaned = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, maxLen);
    cleaned = cleaned.replace(/^-+/, '').replace(/-+$/, '');
    if (!cleaned) return 'x';
    if (!/^[a-zA-Z0-9]/.test(cleaned)) cleaned = `x${cleaned}`;
    if (!/[a-zA-Z0-9]$/.test(cleaned)) cleaned = `${cleaned}x`;
    return cleaned;
  }

  // 内容アドレス方式のため、同じ文書の異なる版は別のdocument_idを持つ
  // (再発行されない限り上書きしない。世代の掃除は現状未実装で従来どおり)。
  function _artifactDocId(artifact) {
    return `${_safeDocIdPart(artifact.document_id, 100)}--${contract().hash(artifact.revision)}`;
  }

  function _deviceDocId(deviceId = _deviceId()) {
    return _safeDocIdPart(deviceId, 120);
  }

  async function _provider() {
    return global.MeldexStorageAdapter?.getProvider?.() || null;
  }

  // 可搬ナレッジは接続中フォルダに限らず登録済みソースフォルダ全体を横断する
  // Dropboxアカウント単位の機能のため、常に個人管理領域を使う(冒頭コメント参照)。
  async function _managementAdapter(provider) {
    const resolver = managementResolver();
    if (!resolver) throw new Error('gb-dropbox-management-root-resolver.js が読み込まれていません');
    return resolver.resolveAdapterForProvider(provider, { personalOnly: true });
  }

  async function _yield() {
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  async function _scanRootDirectories(provider) {
    const directories = [''];
    if (_runtimeMode() !== 'dropbox') return directories;
    const registry = global.MeldexSourceFolderRegistry;
    if (!registry?.loadOutlinerRoots) return directories;
    try {
      const info = await provider.getWorkspaceInfo?.();
      const connected = String(info?.path || '').replace(/\/$/, '').toLowerCase();
      const seenDropboxPaths = new Set(connected ? [connected] : []);
      const roots = await registry.loadOutlinerRoots();
      for (const root of roots || []) {
        if (!root || root.deleted || !root.path) continue;
        const dropboxPath = String(root.dropboxPath || '').replace(/\/$/, '').toLowerCase();
        if (dropboxPath && seenDropboxPaths.has(dropboxPath)) continue;
        if (dropboxPath) seenDropboxPaths.add(dropboxPath);
        directories.push(contract().normalizePath(root.path));
      }
    } catch (error) {
      console.warn('[MeldexPortableKnowledge] ソースフォルダ一覧を読めないため、現在の保存先だけを索引化します', error);
    }
    return [...new Set(directories)];
  }

  async function _listFiles(provider) {
    const files = [];
    const directories = await _scanRootDirectories(provider);
    const warnings = [];
    let complete = true;
    while (directories.length && files.length < MAX_FILES) {
      const directory = directories.shift();
      let entries = [];
      try { entries = await provider.listEntries(directory); } catch (error) {
        complete = false;
        warnings.push(`${directory || '保存先'}: ${error?.message || error}`);
        continue;
      }
      for (const entry of entries) {
        const path = contract().normalizePath(entry.path || (directory ? `${directory}/${entry.name}` : entry.name));
        if (!path || contract().shouldSkipPath(path)) continue;
        if (entry.kind === 'directory') directories.push(path);
        else if (contract().isSupported(path)) files.push({ ...entry, path });
        if ((files.length + directories.length) % 40 === 0) await _yield();
        if (files.length >= MAX_FILES) break;
      }
    }
    if (files.length >= MAX_FILES) {
      complete = false;
      warnings.push(`索引対象が${MAX_FILES}件を超えたため、残りは次回以降に処理します`);
    }
    return { files, complete, warnings };
  }

  function _recordForArtifact(artifact, artifactDocId, eventMs = Date.now()) {
    return {
      document_id: artifact.document_id,
      path: artifact.source_path,
      revision: artifact.revision,
      artifact_doc_id: artifactDocId,
      source_modified_ms: Number(artifact?.metadata?.source_modified_ms || 0),
      source_size: Number(artifact?.metadata?.source_size || 0),
      event_ms: eventMs,
      updated_at: _now(),
      deleted: false,
    };
  }

  function _newManifest(existing) {
    return {
      schema: contract().SCHEMA,
      device_id: _deviceId(),
      updated_at: _now(),
      mode: _runtimeMode(),
      documents: { ...(existing?.documents || {}) },
    };
  }

  async function _readDeviceManifests(adapter) {
    let records = [];
    try { records = await adapter.listDocuments(systemStorage().SystemStorageKind.PORTABLE_KNOWLEDGE_DEVICES); } catch { return []; }
    const results = [];
    for (const record of records) {
      const manifest = record?.payload;
      if (manifest?.schema === contract().SCHEMA && manifest?.documents) results.push(manifest);
      if (results.length % 10 === 0) await _yield();
    }
    return results;
  }

  function _latestRecords(manifests) {
    const latest = new Map();
    manifests.forEach(manifest => {
      Object.values(manifest.documents || {}).forEach(record => {
        if (!record?.document_id) return;
        const previous = latest.get(record.document_id);
        const before = Number(previous?.event_ms || previous?.source_modified_ms || 0);
        const next = Number(record.event_ms || record.source_modified_ms || 0);
        if (!previous || next > before || (next === before && String(record.updated_at || '') > String(previous.updated_at || ''))) {
          latest.set(record.document_id, record);
        }
      });
    });
    return latest;
  }

  async function _importPortable(provider, adapter) {
    if (_runtimeMode() !== 'dropbox') return { imported: 0, deleted: 0, manifests: [] };
    const manifests = await _readDeviceManifests(adapter);
    const latest = _latestRecords(manifests);
    const upserts = [];
    const deletes = [];
    for (const record of latest.values()) {
      if (record.deleted) {
        deletes.push(record.document_id);
        continue;
      }
      const current = await store().get(record.document_id);
      if (current?.revision === record.revision || !record.artifact_doc_id) continue;
      const loaded = await adapter.load(systemStorage().SystemStorageKind.PORTABLE_KNOWLEDGE_ARTIFACTS, record.artifact_doc_id).catch(() => null);
      const artifact = loaded?.payload;
      if (artifact?.schema === contract().SCHEMA && artifact?.document_id === record.document_id) upserts.push(artifact);
      if ((upserts.length + deletes.length) % 25 === 0) await _yield();
    }
    if (upserts.length) await store().batchUpsert(upserts);
    if (deletes.length) await store().deleteArtifacts(deletes);
    return { imported: upserts.length, deleted: deletes.length, manifests };
  }

  async function _scan(provider, remoteManifests) {
    const listing = await _listFiles(provider);
    const files = listing.files;
    const existing = new Map((await store().list()).map(row => [row.document_id, row]));
    const ownRemote = (remoteManifests || []).find(item => item.device_id === _deviceId());
    const manifest = _newManifest(ownRemote);
    const seen = new Set();
    const portableSeen = new Set();
    const changedArtifacts = [];
    const publishArtifacts = [];
    const warnings = [...listing.warnings];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const docId = contract().documentId(file.path);
      seen.add(docId);
      const sourcePrefix = String(global.MeldexSourceFolderRegistry?.SOURCE_PREFIX || '__dropbox_root__');
      const portableEligible = !contract().normalizePath(file.path).startsWith(`${sourcePrefix}/`);
      if (portableEligible) portableSeen.add(docId);
      const current = existing.get(docId);
      const modifiedMs = Number(Date.parse(file.modified || '') || 0);
      const unchanged = current
        && Number(current?.metadata?.source_size || 0) === Number(file.size || 0)
        && Number(current?.metadata?.source_modified_ms || 0) === modifiedMs;
      let artifact = current;
      if (!unchanged) {
        let text = '';
        if (contract().kindForPath(file.path) !== 'image' && Number(file.size || 0) <= MAX_TEXT_BYTES) {
          try { text = await provider.readText(file.path); } catch (error) {
            warnings.push(`${file.path}: ${error?.message || error}`);
            continue;
          }
        }
        artifact = await _extract({
          path: file.path,
          text,
          size: file.size,
          modified: file.modified,
          modifiedMs,
          visibility: 'workspace',
        });
        if (Number(file.size || 0) > MAX_TEXT_BYTES && artifact.kind !== 'image') {
          artifact.warnings.push('モバイル向け上限を超えるため名前とメタデータだけを索引化しました。PC/NASハブでは全文を処理できます');
        }
        changedArtifacts.push(artifact);
      }
      if (artifact && portableEligible) {
        const artifactDocId = _artifactDocId(artifact);
        manifest.documents[docId] = _recordForArtifact(artifact, artifactDocId);
        if (_runtimeMode() === 'dropbox' && (!ownRemote?.documents?.[docId] || ownRemote.documents[docId].revision !== artifact.revision)) {
          publishArtifacts.push({ artifact, docId: artifactDocId });
        }
      }
      if (index % 20 === 0) await _yield();
    }
    const eventMs = Date.now();
    if (listing.complete) {
      Object.entries(manifest.documents).forEach(([docId, record]) => {
        if (portableSeen.has(docId) || record.deleted) return;
        manifest.documents[docId] = { ...record, deleted: true, artifact_doc_id: '', event_ms: eventMs, updated_at: _now() };
      });
    }
    if (changedArtifacts.length) await store().batchUpsert(changedArtifacts);
    const removed = listing.complete ? [...existing.keys()].filter(id => !seen.has(id)) : [];
    if (removed.length) await store().deleteArtifacts(removed);
    return { files, manifest, publishArtifacts, changed: changedArtifacts.length, removed: removed.length, warnings, complete: listing.complete };
  }

  async function _canPublish(provider) {
    if (_runtimeMode() !== 'dropbox') return false;
    try { return !!(await provider.ensureWorkspacePermission?.('readwrite')); } catch { return false; }
  }

  async function _publish(provider, scan, adapter) {
    if (!(await _canPublish(provider))) return { published: 0, readonly: true };
    const kinds = systemStorage().SystemStorageKind;
    const ConflictError = systemStorage().SystemStorageConflictError;
    let published = 0;
    for (const item of scan.publishArtifacts) {
      try {
        const existing = await adapter.load(kinds.PORTABLE_KNOWLEDGE_ARTIFACTS, item.docId).catch(() => null);
        if (!existing) {
          await adapter.save(kinds.PORTABLE_KNOWLEDGE_ARTIFACTS, item.docId, item.artifact, { expectedRevision: null });
        }
        published += 1;
      } catch (error) {
        // 直前の存在確認後に別端末(または前回中断した自端末)が同一内容を
        // 発行済みだった場合(内容アドレス方式のため同一document_idなら同一内容)。
        if (!(error instanceof ConflictError)) throw error;
      }
      if (published % 10 === 0) await _yield();
    }
    await _publishManifest(adapter, scan.manifest);
    return { published, readonly: false };
  }

  async function _publishManifest(adapter, scanManifest) {
    const kinds = systemStorage().SystemStorageKind;
    const ConflictError = systemStorage().SystemStorageConflictError;
    const deviceDocId = _deviceDocId();
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = await adapter.load(kinds.PORTABLE_KNOWLEDGE_DEVICES, deviceDocId).catch(() => null);
      const next = _newManifest(current?.payload);
      Object.assign(next.documents, scanManifest.documents);
      next.updated_at = _now();
      try {
        await adapter.save(kinds.PORTABLE_KNOWLEDGE_DEVICES, deviceDocId, next, { expectedRevision: current ? current.revision : null });
        return;
      } catch (error) {
        if (error instanceof ConflictError && attempt < MAX_ATTEMPTS - 1) continue;
        throw error;
      }
    }
  }

  function _setJob(state, details = {}) {
    return store().setMeta('latest_job', {
      id: 'portable-current',
      state,
      updated_at: _now(),
      result: details,
      error: details.error || '',
    });
  }

  async function syncNow(options = {}) {
    if (!isAvailable()) throw new Error('この保存方式では端末内自動ナレッジを利用できません');
    // 保存やチャット検索が走行中の索引更新と重なった場合、現在処理だけを返すと
    // 直後の変更が次の定期実行まで残る。完了後にもう一度差分を確認する。
    if (activeSync) return activeSync.then(() => syncNow(options));
    activeSync = (async () => {
      await _setJob('running');
      const provider = await _provider();
      if (!provider) throw new Error('保存先を開けません');
      await provider.restoreWorkspace?.();
      const dropboxMode = _runtimeMode() === 'dropbox';
      const adapter = dropboxMode ? await _managementAdapter(provider) : null;
      const imported = await _importPortable(provider, adapter);
      let scan = null;
      let published = { published: 0, readonly: dropboxMode };
      if (options.scan !== false) {
        scan = await _scan(provider, imported.manifests);
        if (dropboxMode) published = await _publish(provider, scan, adapter);
      }
      const result = {
        imported: imported.imported,
        files: scan?.files?.length || 0,
        changed: scan?.changed || 0,
        removed: scan?.removed || 0,
        published: published.published,
        readonly: published.readonly,
        warnings: scan?.warnings || [],
      };
      await store().setMeta('last_sync', { at: _now(), mode: _runtimeMode(), ...result });
      await _setJob('completed', { artifacts: { failed: result.warnings.length }, ...result });
      global.dispatchEvent?.(new CustomEvent('meldex:portable-knowledge-updated', { detail: result }));
      return result;
    })().catch(async error => {
      await _setJob('failed', { error: error?.message || String(error) }).catch(() => {});
      throw error;
    }).finally(() => { activeSync = null; });
    return activeSync;
  }

  function schedule(reason = 'scheduled', delay = EDIT_DEBOUNCE_MS) {
    if (!isAvailable()) return;
    clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(() => {
      if (document.visibilityState === 'hidden') return schedule('visible-wait', 60 * 1000);
      const run = () => syncNow({ reason }).catch(error => console.warn('[MeldexPortableKnowledge]', error));
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 5000 });
      else run();
    }, Math.max(0, Number(delay) || 0));
  }

  async function initialize() {
    if (!isAvailable()) return false;
    if (initialized) return true;
    if (initializing) return initializing;
    initializing = (async () => {
      await store().open();
      const provider = await _provider();
      if (provider) {
        await (async () => {
          const dropboxMode = _runtimeMode() === 'dropbox';
          const adapter = dropboxMode ? await _managementAdapter(provider) : null;
          return _importPortable(provider, adapter);
        })().catch(() => ({ imported: 0 }));
      }
      initialized = true;
      schedule('startup', 1200);
      return true;
    })().finally(() => { initializing = null; });
    return initializing;
  }

  async function batchUpsert(artifacts) {
    await initialize();
    return store().batchUpsert(artifacts);
  }

  async function deleteArtifacts(documentIds) {
    await initialize();
    const result = await store().deleteArtifacts(documentIds);
    schedule('delete');
    return result;
  }

  async function retrieve(query, options = {}) {
    await initialize();
    schedule('chat-query', 0);
    let artifacts = await store().list();
    // 初回バックグラウンド走査より先に質問された場合だけ、その質問を空索引で
    // 回答しない。処理はWorker/yield経由なので、画面描画自体は止めない。
    if (!artifacts.length) {
      await syncNow({ scan: true, reason: 'first-chat-query' }).catch(() => null);
      artifacts = await store().list();
    }
    const kinds = new Set(options.kinds || []);
    if (kinds.size) artifacts = artifacts.filter(row => kinds.has(row.kind));
    const workspaceIds = new Set(options.workspaceIds || options.workspace_ids || []);
    if (workspaceIds.size) artifacts = artifacts.filter(row => !row.workspace_id || workspaceIds.has(row.workspace_id));
    const rows = await _score(artifacts, query, Math.max(1, Number(options.limit || 10)));
    return {
      query: String(query || ''),
      backend: 'portable-device-index',
      results: rows.map(row => ({
        document_id: row.artifact.document_id,
        path: row.artifact.source_path,
        revision: row.artifact.revision,
        kind: row.artifact.kind,
        score: row.score,
        snippets: row.snippets,
        nodes: options.includeStructure === false ? [] : (row.artifact.nodes || []).slice(0, 50),
        edges: options.includeStructure === false ? [] : (row.artifact.edges || []).slice(0, 50),
        images: row.artifact.images || [],
      })),
    };
  }

  async function pull(documentIds) {
    await initialize();
    const rows = [];
    for (const id of documentIds || []) {
      const artifact = await store().get(id);
      if (artifact) rows.push(artifact);
    }
    return { artifacts: rows };
  }

  async function reconcile(expectedDocumentIds) {
    await initialize();
    const expected = new Set((expectedDocumentIds || []).map(String));
    const ids = (await store().list()).map(row => row.document_id).filter(id => !expected.has(id));
    return deleteArtifacts(ids);
  }

  async function coverage() {
    await initialize();
    return store().coverage();
  }

  async function changes(cursor = 0, options = {}) {
    await initialize();
    const changed = (await store().list()).slice(0, options.limit || 1000);
    return { cursor: Number(cursor || 0) + changed.length, changes: changed.map(artifact => ({
      document_id: artifact.document_id, revision: artifact.revision, path: artifact.source_path, deleted: false,
    })) };
  }

  async function getJob() {
    await initialize();
    return (await store().getMeta('latest_job', null)) || { id: 'portable-current', state: 'idle' };
  }

  async function rebuild() {
    await initialize();
    await store().clear();
    return syncNow({ scan: true, reason: 'rebuild' });
  }

  global.addEventListener?.('online', () => schedule('online', 1000));
  global.addEventListener?.('focus', () => schedule('focus', 1500));
  global.addEventListener?.('meldex:mode-changed', () => {
    initialized = false;
    schedule('mode-change', 500);
  });
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule('visible', 1000);
  });
  setInterval(() => schedule('periodic', 0), SYNC_INTERVAL_MS);

  global.MeldexPortableKnowledge = Object.freeze({
    isAvailable,
    initialize,
    schedule,
    syncNow,
    batchUpsert,
    deleteArtifacts,
    retrieve,
    pull,
    reconcile,
    coverage,
    changes,
    getJob,
    rebuild,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initialize().catch(() => {}), { once: true });
  else initialize().catch(() => {});
})(window);
