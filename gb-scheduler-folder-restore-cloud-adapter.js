/* Cloud scheduler folder restore backed by canonical DB roots and Folder Version IDs. */
(function () {
  'use strict';

  const DOMAINS = Object.freeze(['calendar-db', 'mapped-db']);
  const clone = value => structuredClone(value);
  const fail = (message, status = 409, code = '') => {
    const error = new Error(message); error.status = status; if (code) error.code = code; throw error;
  };
  const normalize = value => String(value || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  const join = (...parts) => parts.map(normalize).filter(Boolean).join('/');
  const fnv = value => {
    let hash = 2166136261;
    for (const char of String(value || '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };
  const bytesToBase64 = bytes => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  };
  const base64ToBytes = value => Uint8Array.from(atob(String(value || '')), char => char.charCodeAt(0));
  const entryType = entry => entry?.entry_type === 'directory' ? 'directory' : 'file';
  const OWNER_MARKER_PREFIX = '.meldex-restore-owner-';

  async function providerIdentity(provider) {
    const info = await provider?.getWorkspaceInfo?.();
    const path = String(info?.path || provider?.getVaultPath?.() || '').trim();
    if (!provider || !info?.connected || !path) fail('Cloudの保存先ルートを確認できません');
    const providerName = provider.constructor?.name || '';
    let accountId = '';
    let namespaceId = '';
    if (providerName === 'DropboxStorageProvider') {
      const namespace = await window.MeldexDropboxAuth?.getNamespaceContext?.(false);
      accountId = String(namespace?.accountId || '');
      namespaceId = String(namespace?.rootNamespaceId || namespace?.homeNamespaceId || '');
      if (!accountId || !namespaceId) fail('Dropboxのアカウントと保存先ルートを確認できません');
    }
    return JSON.stringify({ provider: providerName, path, namespace: String(info.namespaceKind || ''), accountId, namespaceId });
  }

  async function create(options = {}) {
    const provider = options.provider;
    const workspaceId = String(options.workspaceId || '');
    const actor = String(options.actor || '');
    const role = String(options.role || 'viewer');
    const registry = options.registry || window.MeldexCalendarDatabaseRegistryCloud;
    const versionApi = options.versionApi || window.MeldexFolderVersionProviderOps;
    const system = options.systemStorage || window.MeldexSystemStorage;
    const capabilityPolicyIdentity = String(options.capabilityPolicyIdentity || '');
    const leaseMs = Math.max(300, Number(options.leaseMs || 120000));
    if (!workspaceId || !actor) fail('workspaceまたは操作者を確認できません');
    if (!registry?.list || !registry?.metadata || !versionApi?.save || !versionApi?.read) {
      fail('CloudのフォルダーVersion復元を利用できません', 503);
    }
    const identity = await providerIdentity(provider);
    if (!capabilityPolicyIdentity) fail('権限policyの版を確認できません');
    const restorePolicy = Object.freeze({ exact: true, includeAll: true, externalSync: false, schema: 1 });
    const policyIdentity = await system.computeRevision({ capabilityPolicyIdentity, restorePolicy });
    const executorId = String(options.executorId || (() => {
      const key = 'meldex.scheduler.folderRestoreExecutor';
      try {
        let value = sessionStorage.getItem(key);
        if (!value) { value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; sessionStorage.setItem(key, value); }
        return value;
      } catch { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }
    })());
    const assertBound = async () => {
      if (await providerIdentity(provider) !== identity) fail('復元中にCloudの保存先が切り替わりました');
      if (typeof options.assertCapabilityPolicyCurrent === 'function') await options.assertCapabilityPolicyCurrent();
    };

    const journalAdapter = async () => {
      if (typeof provider?.getSystemStorageAdapter === 'function') return provider.getSystemStorageAdapter();
      const kind = system?.SystemStorageKind?.VERSIONS;
      return window.MeldexDropboxManagementRootResolver.resolveTypedAdapterForProvider(provider, kind);
    };
    const journalKind = () => system.SystemStorageKind.VERSIONS;

    async function canonicalTargets(domain) {
      if (!DOMAINS.includes(domain)) fail(`${domain} のCloudフォルダー復元には対応していません`, 422);
      if (!['owner', 'admin', 'schedule_manager'].includes(role)) fail('このフォルダー復元を行う権限がありません', 403);
      await assertBound();
      const databases = await registry.list(provider);
      await assertBound();
      const resolved = [];
      for (const item of databases || []) {
        const path = normalize(item?.relPath || item?.path || '');
        if (!path || path.split('/').some(part => part === '..')) continue;
        const metadata = await registry.metadata(provider, path);
        const matches = domain === 'calendar-db'
          ? String(metadata?.type || '') === 'calendar-db'
          : String(metadata?.type || '') === 'settings-db' && !!metadata?.calendar_mapping;
        if (!matches) continue;
        const target = `${workspaceId}/${domain}/${fnv(path)}`;
        resolved.push({ target, path, domain, policyIdentity });
      }
      const unique = new Map(resolved.map(item => [item.target, item]));
      if (unique.size !== resolved.length) fail('登録済みDBの識別子が衝突しました');
      return new Map([...unique.entries()].sort(([left], [right]) => left.localeCompare(right)));
    }

    async function readFileFresh(path) {
      await assertBound();
      if (typeof provider.readBytesFresh === 'function') {
        const fresh = await provider.readBytesFresh(path);
        if (!fresh?.revision || !fresh.bytes) fail('Cloudファイルを厳密に読み込めません');
        return { bytes: new Uint8Array(fresh.bytes), revision: String(fresh.revision) };
      }
      const before = await provider.getMetadata(path);
      const file = await provider.downloadAsFile(path);
      const after = await provider.getMetadata(path);
      const revision = value => String(value?.revision || value?.rev || value?.etag || '');
      if (!revision(before) || revision(before) !== revision(after)) fail('Cloudファイルの読込中に内容が変わりました');
      return { bytes: new Uint8Array(await file.arrayBuffer()), revision: revision(after) };
    }

    async function captureManifest(path) {
      const result = [];
      async function walk(current, relative) {
        provider._forgetListCache?.(current);
        const entries = await provider.listEntries(current);
        for (const entry of entries || []) {
          const relPath = join(relative, entry.name);
          const fullPath = join(current, entry.name);
          if (entry.kind === 'directory') {
            result.push({ rel_path: relPath, entry_type: 'directory', content_base64: null, revision: '' });
            await walk(fullPath, relPath);
          } else {
            const fresh = await readFileFresh(fullPath);
            result.push({ rel_path: relPath, entry_type: 'file', content_base64: bytesToBase64(fresh.bytes), revision: fresh.revision });
          }
        }
      }
      await walk(path, '');
      result.sort((left, right) => left.rel_path.localeCompare(right.rel_path));
      return result;
    }

    const manifestRevision = manifest => system.computeRevision((manifest || []).map(entry => ({
      rel_path: normalize(entry.rel_path), entry_type: entryType(entry),
      content_base64: entryType(entry) === 'file' ? String(entry.content_base64 ?? '') : null,
    })).sort((left, right) => left.rel_path.localeCompare(right.rel_path)));

    function validateManifest(meta, expectedPath) {
      if (normalize(meta?.original_relative_path) !== expectedPath) fail('Version IDのフォルダー境界が一致しません');
      const seen = new Set();
      const manifest = (Array.isArray(meta.files) ? meta.files : []).map(entry => {
        const rawPath = String(entry?.rel_path || '').replaceAll('\\', '/');
        const relPath = normalize(rawPath);
        if (!relPath || rawPath !== relPath || relPath.split('/').some(part => part === '.' || part === '..') || seen.has(relPath)) {
          fail('Version内のパスが不正です');
        }
        seen.add(relPath);
        const type = entryType(entry);
        if (type === 'file' && entry.content_base64 == null) fail('Version内のファイル内容がありません');
        return { ...clone(entry), rel_path: relPath, entry_type: type,
          content_base64: type === 'file' ? String(entry.content_base64) : null };
      }).sort((left, right) => left.rel_path.localeCompare(right.rel_path));
      const files = new Set(manifest.filter(entry => entry.entry_type === 'file').map(entry => entry.rel_path));
      for (const entry of manifest) {
        const parts = entry.rel_path.split('/');
        for (let index = 1; index < parts.length; index += 1) {
          if (files.has(parts.slice(0, index).join('/'))) fail('Version内でファイルと子パスが競合しています');
        }
      }
      return manifest;
    }

    async function resolveReference(domain, version, targets, target) {
      if (!Array.isArray(targets) || !targets.includes(target)) fail('復元対象がVersion IDと一致しません', 422);
      const map = await canonicalTargets(domain);
      const resolved = map.get(target);
      if (!resolved) fail('登録済みDBから復元対象を解決できません');
      const reference = version?.references?.find(item => item.target === target);
      if (!reference?.versionId || reference.path !== resolved.path || reference.domain !== domain
        || reference.providerRootIdentity !== identity || reference.workspaceId !== workspaceId
        || reference.actor !== actor || reference.role !== role || reference.policyIdentity !== policyIdentity) {
        fail('Version IDの復元境界が現在のrequestと一致しません');
      }
      const meta = await versionApi.read(provider, resolved.path, reference.versionId);
      const desired = validateManifest(meta, resolved.path);
      return { resolved, reference, desired, desiredRevision: await manifestRevision(desired) };
    }

    // 実Dropbox完全復元のゴミ箱退避方式(2026-08-20計画・判断1〜3承認済み)による2モード受け入れ。
    // strict-cas: 既存の厳密なrev条件付きCASのみで完遂できる保存先(OPFS/デスクトップ)。
    // trash-evacuation: 物理削除を全廃し、削除に相当する操作をゴミ箱への原子的no-replace移動へ
    // 置き換えられる保存先(Dropbox)。deleteFileCas/deleteEmptyDirectoryCas はDropboxで
    // false のまま変えない(厳密条件付き削除が無い事実は変わらない)。
    function _hasStrictCasCapabilities(capabilities, storageProvider) {
      return !!(capabilities.createFileCas && capabilities.updateFileCas && capabilities.createDirectoryCas && capabilities.freshRead
        && capabilities.deleteFileCas && capabilities.deleteEmptyDirectoryCas
        && storageProvider.supportsStrictConditionalDelete?.() !== false
        && typeof storageProvider.uploadBytesConditional === 'function' && typeof storageProvider.deletePathConditional === 'function'
        && typeof storageProvider.deleteEmptyDirectoryConditional === 'function' && typeof storageProvider.ensureDirectoryConditional === 'function'
        && typeof storageProvider.rollbackDirectoryConditional === 'function' && typeof storageProvider.rollbackFileConditional === 'function');
    }
    function _hasTrashEvacuationCapabilities(capabilities, storageProvider) {
      return !!(capabilities.createFileCas && capabilities.updateFileCas && capabilities.freshRead
        && capabilities.deleteFileToTrash && capabilities.deleteDirectoryToTrash
        && typeof storageProvider.uploadBytesConditional === 'function' && typeof storageProvider.evacuatePathToTrash === 'function'
        && typeof storageProvider.ensureDirectory === 'function' && typeof storageProvider.movePathNoReplace === 'function'
        && typeof storageProvider.statPath === 'function' && typeof storageProvider.listEntries === 'function');
    }

    async function preflight(domain, version, targets, target, expectedRevision) {
      await assertBound();
      const capabilities = provider.folderRestoreCapabilities?.() || {};
      const strictCas = _hasStrictCasCapabilities(capabilities, provider);
      const trashEvacuation = !strictCas && _hasTrashEvacuationCapabilities(capabilities, provider);
      if (!strictCas && !trashEvacuation) {
        fail('この保存先では必要なatomic条件付き操作をすべて利用できません', 503, 'strict_cas_unavailable');
      }
      const mode = strictCas ? 'strict-cas' : 'trash-evacuation';
      const context = await resolveReference(domain, version, targets, target);
      const current = await captureManifest(context.resolved.path);
      const currentRevision = await manifestRevision(current);
      const adapter = await journalAdapter();
      const existing = await adapter.load(journalKind(), journalId(context));
      const existingMode = existing?.payload?.mode || 'strict-cas';
      const resumable = existing && (['applying', 'rolling-back', 'committing'].includes(existing.payload?.stage)
        || (existing.payload?.stage === 'failed' && !existing.payload?.rolledBack))
        && existing.payload?.versionId === context.reference.versionId
        && existing.payload?.target === context.resolved.target
        && existing.payload?.path === context.resolved.path
        && existing.payload?.domain === context.resolved.domain
        && existing.payload?.providerRootIdentity === identity
        && existing.payload?.workspaceId === workspaceId
        && existing.payload?.actor === actor && existing.payload?.role === role
        && existing.payload?.policyIdentity === policyIdentity;
      if (resumable && existingMode !== mode) {
        fail('復元中に保存先の実行モードが変わったため再開できません');
      }
      if (!resumable && currentRevision !== expectedRevision && currentRevision !== context.desiredRevision) {
        fail('復元対象の確認後に現在の状態が変わりました');
      }
      return { ...context, current, currentRevision, mode };
    }

    const journalId = context => `scheduler-folder-restore-${fnv(`${context.reference.versionId}|${context.resolved.target}|${identity}`)}`;
    async function acquireJournal(context, expectedRevision) {
      const adapter = await journalAdapter();
      const kind = journalKind();
      const id = journalId(context);
      let record = await adapter.load(kind, id);
      const now = Date.now();
      if (record && (record.payload?.versionId !== context.reference.versionId || record.payload?.target !== context.resolved.target
        || record.payload?.providerRootIdentity !== identity || record.payload?.workspaceId !== workspaceId
        || record.payload?.actor !== actor || record.payload?.role !== role || record.payload?.policyIdentity !== policyIdentity
        || (record.payload?.mode || 'strict-cas') !== context.mode)) {
        fail('フォルダー復元journalの境界が一致しません');
      }
      if (record?.payload?.stage === 'complete') return { adapter, kind, id, record, complete: true };
      const expired = !record || Date.parse(record.payload?.leaseExpiresAt || '') <= now;
      if (record && !expired && record.payload?.leaseOwner !== executorId) fail('別の実行者が同じフォルダーを復元中です');
      const fencingToken = record ? Number(record.payload?.fencingToken || 0) + (expired ? 1 : 0) : 1;
      const restart = !!record?.payload?.rolledBack;
      const resumeRollback = record && (record.payload?.stage === 'rolling-back'
        || (record.payload?.stage === 'failed' && record.payload?.rollbackError && !record.payload?.rolledBack));
      const resumeCommit = record?.payload?.stage === 'committing';
      const payload = record ? { ...record.payload, stage: resumeRollback ? 'rolling-back' : (resumeCommit ? 'committing' : 'applying'), error: '', rollbackError: '', rolledBack: false,
        mode: record.payload.mode || context.mode,
        beforeVersionId: restart ? '' : record.payload.beforeVersionId,
        previewManifest: restart ? clone(context.current) : (record.payload.previewManifest || clone(context.current)),
        completedEntries: restart ? [] : (record.payload.completedEntries || []),
        applied: restart ? {} : (record.payload.applied || {}), intents: restart ? {} : (record.payload.intents || {}),
        rollbackCompleted: restart ? [] : (record.payload.rollbackCompleted || []),
        evacuations: restart ? [] : (record.payload.evacuations || []),
        manualRestore: restart ? [] : (record.payload.manualRestore || []),
        fencingToken, leaseOwner: executorId } : {
        schemaVersion: 1, object_type: 'scheduler-folder-restore-journal', stage: 'preparing', mode: context.mode,
        versionId: context.reference.versionId, target: context.resolved.target, path: context.resolved.path,
        domain: context.resolved.domain, providerRootIdentity: identity, workspaceId, actor, role, policyIdentity,
        expectedRevision, desiredRevision: context.desiredRevision, beforeVersionId: '', previewManifest: clone(context.current),
        completedEntries: [], applied: {}, intents: {}, rollbackCompleted: [], evacuations: [], manualRestore: [],
        fencingToken: 1, leaseOwner: executorId, createdAt: new Date().toISOString(), error: '',
      };
      payload.leaseExpiresAt = new Date(now + leaseMs).toISOString();
      payload.updatedAt = new Date().toISOString();
      record = await adapter.save(kind, id, payload, { expectedRevision: record?.revision || null });
      let updateQueue = Promise.resolve();
      let heartbeatError = null;
      let stopped = false;
      const update = async patch => {
        await assertBound();
        const latest = await adapter.load(kind, id);
        if (!latest || Number(latest.payload?.fencingToken || 0) !== Number(record.payload.fencingToken)
          || latest.payload?.leaseOwner !== executorId || Date.parse(latest.payload?.leaseExpiresAt || '') <= Date.now()
          || latest.payload?.stage === 'complete') fail('フォルダー復元leaseの所有権を失いました');
        record = await adapter.save(kind, id, { ...latest.payload, ...clone(patch),
          leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(), updatedAt: new Date().toISOString() },
        { expectedRevision: latest.revision });
        return record;
      };
      const checkpoint = patch => {
        if (heartbeatError) return Promise.reject(heartbeatError);
        updateQueue = updateQueue.then(() => update(patch));
        return updateQueue;
      };
      const heartbeatMs = Math.max(100, Math.min(30000, Math.floor(leaseMs / 3)));
      const timer = setInterval(() => {
        if (stopped) return;
        updateQueue = updateQueue.then(() => update({})).catch(error => { heartbeatError = error; });
      }, heartbeatMs);
      let closed = false;
      const stopHeartbeat = async () => {
        if (!stopped) { stopped = true; clearInterval(timer); }
        await updateQueue;
        if (heartbeatError) throw heartbeatError;
      };
      const finish = async patch => {
        await stopHeartbeat();
        const latest = await adapter.load(kind, id);
        if (!latest || Number(latest.payload?.fencingToken || 0) !== Number(record.payload.fencingToken)
          || latest.payload?.leaseOwner !== executorId || Date.parse(latest.payload?.leaseExpiresAt || '') <= Date.now()) {
          fail('フォルダー復元leaseの所有権を失いました');
        }
        record = await adapter.save(kind, id, { ...latest.payload, ...clone(patch), leaseExpiresAt: '', updatedAt: new Date().toISOString() },
          { expectedRevision: latest.revision });
        closed = true;
        return record;
      };
      const close = async () => {
        if (closed) return;
        await stopHeartbeat();
        closed = true;
      };
      return { adapter, kind, id, get record() { return record; }, checkpoint, finish, close, complete: false };
    }

    async function applyExact(context, journal) {
      let payload = journal.record.payload;
      if (!payload.beforeVersionId) {
        const saved = await versionApi.save(provider, context.resolved.path, {
          label: '復元前の自動保存', auto: true, includeAll: true,
        });
        const savedMeta = await versionApi.read(provider, context.resolved.path, saved.version);
        const savedManifest = validateManifest(savedMeta, context.resolved.path);
        const previewRevision = await manifestRevision(payload.previewManifest || []);
        if (await manifestRevision(savedManifest) !== previewRevision || previewRevision !== String(payload.expectedRevision || '')) {
          fail('復元前Versionの保存中に対象フォルダーが変更されました');
        }
        await journal.checkpoint({ beforeVersionId: String(saved.version || ''), stage: 'applying' });
        payload = journal.record.payload;
      }
      const mode = payload.mode || 'strict-cas';
      const completed = new Set(payload.completedEntries || []);
      const applied = { ...(payload.applied || {}) };
      const intents = { ...(payload.intents || {}) };
      const evacuations = Array.isArray(payload.evacuations) ? [...payload.evacuations] : [];
      const desiredFiles = new Map(context.desired.filter(item => item.entry_type === 'file').map(item => [item.rel_path, item]));
      const desiredDirs = new Set(context.desired.filter(item => item.entry_type === 'directory').map(item => item.rel_path));
      const preview = Array.isArray(payload.previewManifest) ? payload.previewManifest : [];
      const previewFiles = new Map(preview.filter(item => entryType(item) === 'file').map(item => [item.rel_path, item]));
      const previewDirs = new Set(preview.filter(item => entryType(item) === 'directory').map(item => item.rel_path));

      const saveProgress = async (key, change, evacuationRecord) => {
        completed.add(key); applied[key] = change;
        if (evacuationRecord) evacuations.push(evacuationRecord);
        await journal.checkpoint({ completedEntries: [...completed].sort(), applied: clone(applied), intents: clone(intents), evacuations: clone(evacuations) });
        await window.__MeldexSchedulerFolderRestoreCrashHook?.('checkpoint', { key, target: context.resolved.target });
      };
      const saveIntent = async (key, intent) => {
        intents[key] = intent;
        await journal.checkpoint({ intents: clone(intents) });
      };
      const markerToken = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const markerBytes = token => new TextEncoder().encode(String(token));
      const ownershipIntent = (kind, key, fullPath, extra = {}) => {
        const markerTokenValue = markerToken();
        const markerName = `${OWNER_MARKER_PREFIX}${fnv(`${key}|${markerTokenValue}`)}`;
        return { kind, ...extra, markerToken: markerTokenValue, markerName,
          markerPath: `MeldexSettings/system/v1/restore-ownership/${markerName}` };
      };
      const verifyMarker = async intent => {
        if (!intent?.markerPath || !intent?.markerToken) fail('復元ownership markerを確認できません');
        const marker = await readFileFresh(intent.markerPath).catch(error => error?.name === 'NotFoundError' ? null : Promise.reject(error));
        if (!marker || bytesToBase64(marker.bytes) !== bytesToBase64(markerBytes(intent.markerToken))) {
          fail('復元ownership markerが一致しません');
        }
        return marker;
      };
      const cleanupMarker = async intent => {
        if (!intent?.markerPath) return;
        const stat = await provider.statPath(intent.markerPath).catch(() => null);
        if (!stat) return;
        const marker = await verifyMarker(intent);
        if (marker) await provider.deletePathConditional(intent.markerPath, marker.revision);
      };

      const deletePreviewFile = async extra => {
        const key = `delete:${extra.rel_path}`;
        const fullPath = join(context.resolved.path, extra.rel_path);
        const latest = await readFileFresh(fullPath).catch(error => error?.name === 'NotFoundError' ? null : Promise.reject(error));
        if (!latest) {
          if (!completed.has(key) && !intents[key]) fail('確認後に削除対象ファイルが変更されました');
          if (!completed.has(key)) await verifyMarker(intents[key]);
          if (!completed.has(key)) await saveProgress(key, { kind: 'delete', changed: true });
          return;
        }
        if (completed.has(key)) fail('checkpoint後に削除済みファイルが再作成されました');
        if (latest.revision !== extra.revision || bytesToBase64(latest.bytes) !== extra.content_base64) {
          fail('確認後に削除対象ファイルが変更されました');
        }
        if (!intents[key]) await saveIntent(key, ownershipIntent('delete', key, fullPath,
          { beforeRevision: extra.revision, beforeBase64: extra.content_base64 }));
        await journal.checkpoint({});
        const result = await provider.deletePathConditional(fullPath, extra.revision,
          { name: intents[key].markerName, bytes: markerBytes(intents[key].markerToken) });
        await window.__MeldexSchedulerFolderRestoreCrashHook?.('mutated', { key, target: context.resolved.target });
        await saveProgress(key, { kind: 'delete', deletedRevision: String(result?.deletedRevision || latest.revision), changed: true });
      };

      const deletePreviewDirectory = async relPath => {
        const key = `rmdir:${relPath}`;
        const fullPath = join(context.resolved.path, relPath);
        const stat = await provider.statPath(fullPath).catch(() => null);
        if (!stat) {
          if (!completed.has(key) && !intents[key]) fail('確認後に削除対象フォルダーが変更されました');
          if (!completed.has(key) && intents[key]) await verifyMarker(intents[key]);
          if (!completed.has(key)) await saveProgress(key, { kind: 'rmdir', changed: true });
          return;
        }
        if (stat.kind !== 'directory') fail('確認後に削除対象の種類が変更されました');
        const children = await provider.listEntries(fullPath);
        if (children.length) fail('削除対象フォルダーが空ではありません');
        if (completed.has(key)) fail('checkpoint後に削除済みフォルダーが再作成されました');
        if (!intents[key]) {
          const markerTokenValue = markerToken();
          await saveIntent(key, { kind: 'rmdir', beforeExists: true, markerToken: markerTokenValue,
            markerName: `${OWNER_MARKER_PREFIX}${fnv(`${key}|${markerTokenValue}`)}`,
            markerPath: `MeldexSettings/system/v1/restore-ownership/${OWNER_MARKER_PREFIX}${fnv(`${key}|${markerTokenValue}`)}` });
        }
        await journal.checkpoint({});
        await provider.deleteEmptyDirectoryConditional(fullPath, { name: intents[key].markerName, bytes: markerBytes(intents[key].markerToken) });
        await window.__MeldexSchedulerFolderRestoreCrashHook?.('mutated', { key, target: context.resolved.target });
        await saveProgress(key, { kind: 'rmdir', changed: true });
      };

      // ゴミ箱退避モード用: 個々のファイルを条件付き削除する代わりに、対象1件を
      // まるごとゴミ箱へ原子的no-replace移動する(物理削除は一切行わない)。
      // ディレクトリはmovePathNoReplaceが中身ごと移動するため、事前に空にする必要がない
      // (競合窓で追加されたファイルも中身ごと保全される)。
      const evacuateEntry = async (key, fullPath, relPath, reasonWhenEvacuated) => {
        if (completed.has(key)) return;
        if (!intents[key]) await saveIntent(key, { kind: 'evacuate', expectedRevision: '' });
        await journal.checkpoint({});
        const outcome = await provider.evacuatePathToTrash(fullPath, intents[key].expectedRevision || null, { name: key });
        await window.__MeldexSchedulerFolderRestoreCrashHook?.('mutated', { key, target: context.resolved.target });
        const evacuationRecord = outcome?.evacuated ? {
          rel_path: relPath, original_path: fullPath, trash_path: outcome.trashPath, kind: outcome.kind || 'file',
          reason: typeof reasonWhenEvacuated === 'function' ? reasonWhenEvacuated(outcome) : reasonWhenEvacuated,
          observed_revision: outcome.beforeRevision || '', content_stable: outcome.contentStable !== false,
        } : null;
        await saveProgress(key, { kind: 'evacuate', trashPath: outcome?.trashPath || '', evacuated: !!outcome?.evacuated, changed: true }, evacuationRecord);
      };

      const evacuatePreviewFile = async extra => {
        const key = `delete:${extra.rel_path}`;
        const fullPath = join(context.resolved.path, extra.rel_path);
        if (!completed.has(key) && !intents[key]) await saveIntent(key, { kind: 'evacuate', expectedRevision: extra.revision || '' });
        await evacuateEntry(key, fullPath, extra.rel_path,
          outcome => (outcome.matchedExpected === false ? 'conflict-changed' : 'obsolete'));
      };

      // preview時点で既知の不要ディレクトリのうち、他の不要ディレクトリの子孫ではない
      // 最上位のものだけをまるごと退避する(子孫は親と一緒に移動されるため個別処理不要)。
      const obsoleteDirPaths = new Set([...previewDirs].filter(path => !desiredDirs.has(path) || desiredFiles.has(path)));
      const isUnderObsoleteDir = relPath => [...obsoleteDirPaths].some(dir => relPath.startsWith(dir + '/'));
      const outermostObsoleteDirs = [...obsoleteDirPaths].filter(dir => !isUnderObsoleteDir(dir));

      if (mode === 'trash-evacuation') {
        for (const relPath of outermostObsoleteDirs.sort()) {
          await evacuateEntry(`rmdir:${relPath}`, join(context.resolved.path, relPath), relPath, 'obsolete');
        }
        for (const extra of preview.filter(item => entryType(item) === 'file'
          && (!desiredFiles.has(item.rel_path) || desiredDirs.has(item.rel_path)) && !isUnderObsoleteDir(item.rel_path))) {
          await evacuatePreviewFile(extra);
        }
        // preview確認後に出現した未知のファイル・ディレクトリを検知して退避する
        // (復元完遂後の内容が必ずsnapshotと一致するようにするため)。再スキャンは
        // 冪等(既に退避済みの項目は現在の一覧から消えているため再検出されない)。
        const unexpected = [];
        async function scanLive(currentPath, relative) {
          provider._forgetListCache?.(currentPath);
          let entries;
          try {
            entries = await provider.listEntries(currentPath);
          } catch (error) {
            if (/not_found/i.test(error?.message || '')) return;
            throw error;
          }
          for (const entry of entries || []) {
            const relPath = join(relative, entry.name);
            const fullPath = join(currentPath, entry.name);
            if (entry.kind === 'directory') {
              if (desiredDirs.has(relPath) || previewDirs.has(relPath)) { await scanLive(fullPath, relPath); continue; }
              unexpected.push({ rel_path: relPath, full_path: fullPath });
            } else if (!desiredFiles.has(relPath) && !previewFiles.has(relPath)) {
              unexpected.push({ rel_path: relPath, full_path: fullPath });
            }
          }
        }
        await scanLive(context.resolved.path, '');
        for (const extra of unexpected) await evacuateEntry(`evac-new:${extra.rel_path}`, extra.full_path, extra.rel_path, 'conflict-new');
      } else {
        // Remove snapshot-extraneous entries and old entry types first. This
        // makes file<->directory transitions deterministic and rollbackable.
        for (const extra of preview.filter(item => entryType(item) === 'file'
          && (!desiredFiles.has(item.rel_path) || desiredDirs.has(item.rel_path)))) await deletePreviewFile(extra);
        for (const relPath of [...previewDirs].filter(path => !desiredDirs.has(path) || desiredFiles.has(path))
          .sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b))) {
          await deletePreviewDirectory(relPath);
        }
      }

      for (const relPath of [...desiredDirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
        const key = `mkdir:${relPath}`;
        const fullPath = join(context.resolved.path, relPath);
        if (mode === 'trash-evacuation') {
          if (completed.has(key)) continue;
          if (!intents[key]) await saveIntent(key, { kind: 'mkdir', beforeExists: previewDirs.has(relPath) });
          const stat = await provider.statPath(fullPath).catch(() => null);
          if (stat && stat.kind !== 'directory') await evacuateEntry(`evac-new:${relPath}`, fullPath, relPath, 'conflict-new');
          await journal.checkpoint({});
          await provider.ensureDirectory(fullPath);
          await window.__MeldexSchedulerFolderRestoreCrashHook?.('mutated', { key, target: context.resolved.target });
          await saveProgress(key, { kind: 'mkdir', created: !previewDirs.has(relPath), changed: !previewDirs.has(relPath) });
          continue;
        }
        const stat = await provider.statPath(fullPath).catch(() => null);
        if (stat && stat.kind !== 'directory') fail('復元先の種類がVersionと異なります');
        if (completed.has(key)) {
          if (!stat) fail('checkpoint後に復元済みフォルダーが削除されました');
          continue;
        }
        if (!stat && previewDirs.has(relPath) && !intents[key]) fail('確認後に復元先フォルダーが削除されました');
        if (stat && !previewDirs.has(relPath) && !intents[key]) fail('確認後に復元先フォルダーが作成されました');
        if (!stat) {
          if (!intents[key]) {
            const markerTokenValue = markerToken();
            await saveIntent(key, { kind: 'mkdir', beforeExists: previewDirs.has(relPath), markerToken: markerTokenValue,
              markerName: `${OWNER_MARKER_PREFIX}${fnv(`${key}|${markerTokenValue}`)}`,
              markerPath: `MeldexSettings/system/v1/restore-ownership/${OWNER_MARKER_PREFIX}${fnv(`${key}|${markerTokenValue}`)}` });
          }
          await journal.checkpoint({});
          await provider.ensureDirectoryConditional(fullPath, { name: intents[key].markerName, bytes: markerBytes(intents[key].markerToken) });
          await window.__MeldexSchedulerFolderRestoreCrashHook?.('mutated', { key, target: context.resolved.target });
        } else if (intents[key] && !completed.has(key)) {
          await verifyMarker(intents[key]);
        }
        await saveProgress(key, { kind: 'mkdir', created: !previewDirs.has(relPath), changed: !previewDirs.has(relPath) });
      }

      for (const [relPath, desired] of desiredFiles) {
        const key = `write:${relPath}`;
        const fullPath = join(context.resolved.path, relPath);
        const current = await readFileFresh(fullPath).catch(error => error?.name === 'NotFoundError' ? null : Promise.reject(error));
        const currentBase64 = current ? bytesToBase64(current.bytes) : null;
        const before = previewFiles.get(relPath) || null;
        if (currentBase64 === desired.content_base64) {
          if (!completed.has(key) && !intents[key] && before?.content_base64 !== desired.content_base64) {
            fail('確認後に復元先ファイルが変更されました');
          }
          if (!completed.has(key) && intents[key]) await verifyMarker(intents[key]);
          if (!completed.has(key)) await saveProgress(key, { kind: 'write', afterRevision: current?.revision || '',
            afterHash: desired.content_base64, changed: before?.content_base64 !== desired.content_base64 });
          continue;
        }
        if (completed.has(key)) fail('checkpoint後に復元済みファイルが変更されました');
        const mismatched = (before && (!current || current.revision !== before.revision || currentBase64 !== before.content_base64))
          || (!before && current);
        let evacuationRecord = null;
        let expectedRevisionForWrite = before?.revision || null;
        if (mismatched && mode === 'trash-evacuation') {
          // 競合検知(§6): 確認後に書き換えられた/占有された現在の内容をゴミ箱へ退避してから
          // 目的内容を書き直す(退避は完了報告へ記録。再試行は1回のみ=このループを再実行しない)。
          if (!intents[key]) await saveIntent(key, { kind: 'write', beforeRevision: before?.revision || null,
            beforeBase64: before?.content_base64 ?? null, afterHash: desired.content_base64, conflictEvacuated: false });
          if (!intents[key].conflictEvacuated && current) {
            await journal.checkpoint({});
            const outcome = await provider.evacuatePathToTrash(fullPath, null, { name: key });
            if (outcome?.evacuated) {
              evacuationRecord = { rel_path: relPath, original_path: fullPath, trash_path: outcome.trashPath, kind: 'file',
                reason: 'conflict-changed', observed_revision: outcome.beforeRevision || '' };
            }
          }
          intents[key] = { ...intents[key], conflictEvacuated: true };
          await journal.checkpoint({ intents: clone(intents) });
          expectedRevisionForWrite = null;
        } else if (mismatched) {
          fail('確認後に復元先ファイルが変更されました');
        } else if (!intents[key]) {
          await saveIntent(key, ownershipIntent('write', key, fullPath, { beforeRevision: before?.revision || null,
            beforeBase64: before?.content_base64 ?? null, afterHash: desired.content_base64 }));
        }
        await journal.checkpoint({});
        const result = await provider.uploadBytesConditional(fullPath, base64ToBytes(desired.content_base64), expectedRevisionForWrite,
          { name: intents[key].markerName || key, bytes: intents[key].markerToken ? markerBytes(intents[key].markerToken) : undefined });
        await window.__MeldexSchedulerFolderRestoreCrashHook?.('mutated', { key, target: context.resolved.target });
        await saveProgress(key, { kind: 'write', afterRevision: String(result?.revision || result?.rev || result?.etag || ''),
          afterHash: desired.content_base64, changed: true }, evacuationRecord);
      }

      const finalManifest = await captureManifest(context.resolved.path);
      if (await manifestRevision(finalManifest) !== context.desiredRevision) fail('フォルダーを完全に復元できません');
      await journal.checkpoint({ stage: 'committing' });
      for (const intent of Object.values(intents)) await cleanupMarker(intent);
      await journal.finish({ stage: 'complete', completedAt: new Date().toISOString() });
      return { restored: desiredFiles.size, restoredDirectories: desiredDirs.size, mode, evacuations: clone(evacuations) };
    }

    async function rollbackStrictCas(context, journal) {
      const payload = journal.record.payload;
      const beforeMeta = await versionApi.read(provider, context.resolved.path, payload.beforeVersionId);
      const before = validateManifest(beforeMeta, context.resolved.path);
      const intents = Object.entries(payload.intents || {}).reverse();
      const rollbackCompleted = new Set(payload.rollbackCompleted || []);
      await journal.checkpoint({ stage: 'rolling-back' });
      const rollbackCheckpoint = async key => {
        rollbackCompleted.add(key);
        await journal.checkpoint({ rollbackCompleted: [...rollbackCompleted].sort() });
      };
      for (const [key, intent] of intents) {
        if (rollbackCompleted.has(key)) continue;
        const relPath = key.slice(key.indexOf(':') + 1);
        const fullPath = join(context.resolved.path, relPath);
        if (key.startsWith('mkdir:') || key.startsWith('rmdir:')) {
          if (!intent?.markerName || !intent?.markerToken) fail('復元ownership markerを確認できません');
          await provider.rollbackDirectoryConditional(fullPath, key.startsWith('mkdir:') ? 'remove-created' : 'recreate-deleted',
            { name: intent.markerName, bytes: new TextEncoder().encode(String(intent.markerToken)) });
          await window.__MeldexSchedulerFolderRestoreCrashHook?.('rollback-mutated', { key, target: context.resolved.target });
          await rollbackCheckpoint(key);
          continue;
        }
        if (key.startsWith('write:')) {
          const expectedAfterRevision = await system.computeRevision(Array.from(base64ToBytes(intent.afterHash)));
          await provider.rollbackFileConditional(fullPath, 'restore-written',
            intent.beforeBase64 == null ? null : base64ToBytes(intent.beforeBase64), intent.beforeRevision, expectedAfterRevision,
            { name: intent.markerName, bytes: new TextEncoder().encode(String(intent.markerToken)) });
        } else if (key.startsWith('delete:')) {
          await provider.rollbackFileConditional(fullPath, 'restore-deleted', base64ToBytes(intent.beforeBase64),
            intent.beforeRevision, '', { name: intent.markerName, bytes: new TextEncoder().encode(String(intent.markerToken)) });
        }
        await window.__MeldexSchedulerFolderRestoreCrashHook?.('rollback-mutated', { key, target: context.resolved.target });
        await rollbackCheckpoint(key);
      }
      const rolledBack = await captureManifest(context.resolved.path);
      if (await manifestRevision(rolledBack) !== await manifestRevision(before)) fail('復元失敗後の巻き戻しを完了できません', 500);
      await journal.checkpoint({ stage: 'rolled-back', rolledBack: true, rolledBackAt: new Date().toISOString() });
    }

    // ゴミ箱退避モードのrollbackは、strict-casのようなbit単位の完全一致を保証しない
    // (§6: 競合そのものは防げないため)。退避済みエントリはゴミ箱からの移動戻しを試み、
    // 移動先が再占有されて戻せない場合は物理削除・上書きをせず「手動で戻す必要がある」
    // 項目として journal.manualRestore / 完了報告へ列挙する(消失させない、を最優先する)。
    async function rollbackEvacuationMode(context, journal) {
      const payload = journal.record.payload;
      const intents = Object.entries(payload.intents || {}).reverse();
      const applied = payload.applied || {};
      const rollbackCompleted = new Set(payload.rollbackCompleted || []);
      const manualRestore = Array.isArray(payload.manualRestore) ? [...payload.manualRestore] : [];
      await journal.checkpoint({ stage: 'rolling-back' });
      const rollbackCheckpoint = async key => {
        rollbackCompleted.add(key);
        await journal.checkpoint({ rollbackCompleted: [...rollbackCompleted].sort(), manualRestore: clone(manualRestore) });
      };
      for (const [key, intent] of intents) {
        if (rollbackCompleted.has(key)) continue;
        const relPath = key.slice(key.indexOf(':') + 1);
        const fullPath = join(context.resolved.path, relPath);
        if (intent.kind === 'evacuate') {
          const trashPath = applied[key]?.trashPath || '';
          if (trashPath) {
            const stillThere = await provider.statPath(trashPath).catch(() => null);
            if (stillThere) {
              try {
                await provider.movePathNoReplace(trashPath, fullPath);
              } catch {
                manualRestore.push({ rel_path: relPath, trash_path: trashPath, reason: 'restore-destination-occupied' });
              }
            }
          }
        } else if (intent.kind === 'write') {
          const currentStat = await provider.statPath(fullPath).catch(() => null);
          if (intent.beforeBase64 == null) {
            if (currentStat) {
              const outcome = await provider.evacuatePathToTrash(fullPath, null, { name: key }).catch(() => null);
              if (!outcome?.evacuated) manualRestore.push({ rel_path: relPath, reason: 'write-rollback-failed' });
            }
          } else if (currentStat) {
            try {
              await provider.uploadBytesConditional(fullPath, base64ToBytes(intent.beforeBase64), currentStat.meta?.rev || null);
            } catch {
              manualRestore.push({ rel_path: relPath, reason: 'write-rollback-conflict' });
            }
          } else {
            manualRestore.push({ rel_path: relPath, reason: 'write-rollback-missing' });
          }
        } else if (intent.kind === 'mkdir') {
          if (!intent.beforeExists) {
            const stat = await provider.statPath(fullPath).catch(() => null);
            if (stat) {
              const outcome = await provider.evacuatePathToTrash(fullPath, null, { name: key }).catch(() => null);
              if (!outcome?.evacuated) manualRestore.push({ rel_path: relPath, reason: 'mkdir-rollback-failed' });
            }
          }
        }
        await window.__MeldexSchedulerFolderRestoreCrashHook?.('rollback-mutated', { key, target: context.resolved.target });
        await rollbackCheckpoint(key);
      }
      await journal.checkpoint({ stage: 'rolled-back', rolledBack: true, rolledBackAt: new Date().toISOString(), manualRestore: clone(manualRestore) });
    }

    async function rollbackApplied(context, journal) {
      const payload = journal.record.payload;
      if (!payload.beforeVersionId) return;
      if ((payload.mode || 'strict-cas') === 'trash-evacuation') return rollbackEvacuationMode(context, journal);
      return rollbackStrictCas(context, journal);
    }

    return Object.freeze({
      scope: provider.constructor?.name === 'BrowserStorageProvider' ? 'opfs-device-local' : 'dropbox-provider-root',
      identity,
      async captureDomain(domain) {
        const targets = await canonicalTargets(domain);
        const revisions = {};
        for (const [target, item] of targets) revisions[target] = await manifestRevision(await captureManifest(item.path));
        return { targets: [...targets.keys()], revisions };
      },
      async enumerateTargets(domain) { return [...(await canonicalTargets(domain)).keys()]; },
      async createVersion(domain, targets, label, capture = null) {
        const canonical = await canonicalTargets(domain);
        const sorted = [...new Set(targets || [])].sort();
        if (JSON.stringify(sorted) !== JSON.stringify([...canonical.keys()])) fail('Version対象のフォルダー集合が変わりました');
        const captured = capture || await this.captureDomain(domain);
        const references = [];
        for (const target of sorted) {
          const item = canonical.get(target);
          const before = await manifestRevision(await captureManifest(item.path));
          if (before !== captured.revisions[target]) fail('Version保存前にCloudフォルダーが変わりました');
          const saved = await versionApi.save(provider, item.path, { label, auto: false, includeAll: true });
          const meta = await versionApi.read(provider, item.path, saved.version);
          const manifest = validateManifest(meta, item.path);
          if (await manifestRevision(manifest) !== before) fail('Version保存中にCloudフォルダーが変わりました');
          references.push({ target, path: item.path, domain, versionId: String(saved.version || ''),
            providerRootIdentity: identity, workspaceId, actor, role, policyIdentity });
        }
        return { references, targets: sorted, itemCount: sorted.length };
      },
      async targetRevisions(domain, targets) {
        const canonical = await canonicalTargets(domain);
        const result = {};
        for (const target of targets || []) {
          const item = canonical.get(target);
          if (!item) fail('登録済みDBから復元対象を解決できません');
          result[target] = await manifestRevision(await captureManifest(item.path));
        }
        return result;
      },
      async derivedRevision() { return ''; },
      async restoreTarget(domain, version, targets, target, expectedRevision, options = {}) {
        let context = await preflight(domain, version, targets, target, expectedRevision);
        if (options.preflightOnly) return { restored: 0, preflight: true, mode: context.mode };
        if (options.verifyOnly) {
          if (context.currentRevision !== context.desiredRevision) fail('checkpoint後に復元済みフォルダーが変更されました');
          return { restored: context.desired.filter(item => item.entry_type === 'file').length, resumed: true, verified: true, mode: context.mode };
        }
        // 判断2(2026-08-20計画・承認済み): trash-evacuationモードでは開始前に対象フォルダーの
        // 共有編集ロックを取得し、他メンバーのMeldexクライアント経由の書き込みを復元中は拒否させる。
        // holderはjournalIdに固定するため、別セッションから再開しても自分のロックとして扱える。
        // strict-cas(OPFS/デスクトップ)は対象外(既存挙動を変えない)。
        const lockHolder = journalId(context);
        const lockStore = window.MeldexFileLockStore;
        const needsLock = context.mode === 'trash-evacuation' && typeof lockStore?.acquireSystemLock === 'function';
        if (needsLock) {
          await lockStore.acquireSystemLock(provider, context.resolved.path, {
            holder: lockHolder, reason: 'スケジューラーフォルダー復元(ゴミ箱退避方式)実行中のため一時的に編集ロックしています',
          });
        }
        try {
          let journal = await acquireJournal(context, expectedRevision);
          if (journal.complete) {
            if (context.currentRevision !== context.desiredRevision) fail('完了済み復元の内容が変更されました');
            return { restored: context.desired.filter(item => item.entry_type === 'file').length, resumed: true,
              mode: context.mode, evacuations: journal.record.payload?.evacuations || [] };
          }
          try {
            if (journal.record.payload?.stage === 'rolling-back') {
              await rollbackApplied(context, journal);
              await journal.finish({ stage: 'rolled-back', rolledBack: true, rolledBackAt: new Date().toISOString() });
              await journal.close();
              context = await preflight(domain, version, targets, target, expectedRevision);
              journal = await acquireJournal(context, expectedRevision);
            }
            const result = await applyExact(context, journal);
            return { ...result, mode: context.mode };
          } catch (error) {
            if (error?.hardCrash) throw error;
            if (journal.record.payload?.stage === 'committing') throw error;
            try {
              await rollbackApplied(context, journal);
              await journal.finish({ stage: 'failed', error: String(error?.message || error).slice(0, 500), rolledBack: true });
            } catch (rollbackError) {
              try { await journal.finish({ stage: 'failed', error: String(error?.message || error).slice(0, 500),
                rollbackError: String(rollbackError?.message || rollbackError).slice(0, 500) }); } catch { /* original error wins */ }
              error.rollbackError = rollbackError;
            }
            throw error;
          } finally {
            await journal.close().catch(() => {});
          }
        } finally {
          if (needsLock) {
            await lockStore.releaseSystemLock(provider, context.resolved.path, { holder: lockHolder }).catch(() => {});
          }
        }
      },
    });
  }

  window.MeldexSchedulerFolderRestoreCloudAdapter = Object.freeze({ DOMAINS, create });
})();
