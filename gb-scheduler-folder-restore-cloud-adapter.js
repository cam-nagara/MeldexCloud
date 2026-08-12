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

    async function preflight(domain, version, targets, target, expectedRevision) {
      await assertBound();
      const capabilities = provider.folderRestoreCapabilities?.() || {};
      if (!capabilities.createFileCas || !capabilities.updateFileCas || !capabilities.createDirectoryCas || !capabilities.freshRead
        || !capabilities.deleteFileCas || !capabilities.deleteEmptyDirectoryCas) {
        fail('この保存先では必要なatomic条件付き操作をすべて利用できません', 503, 'strict_cas_unavailable');
      }
      if (typeof provider.uploadBytesConditional !== 'function' || typeof provider.deletePathConditional !== 'function') {
        fail('この保存先は厳密なフォルダー復元に対応していません', 503, 'strict_cas_unavailable');
      }
      if (provider.supportsStrictConditionalDelete?.() === false) {
        fail('Dropboxではatomic条件付き削除を利用できないため、この復元は手動確認が必要です', 503, 'strict_cas_unavailable');
      }
      if (typeof provider.deleteEmptyDirectoryConditional !== 'function' || typeof provider.ensureDirectoryConditional !== 'function'
        || typeof provider.rollbackDirectoryConditional !== 'function' || typeof provider.rollbackFileConditional !== 'function') {
        fail('この保存先は空フォルダーの厳密な削除に対応していません', 503, 'strict_cas_unavailable');
      }
      const context = await resolveReference(domain, version, targets, target);
      const current = await captureManifest(context.resolved.path);
      const currentRevision = await manifestRevision(current);
      const adapter = await journalAdapter();
      const existing = await adapter.load(journalKind(), journalId(context));
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
      if (!resumable && currentRevision !== expectedRevision && currentRevision !== context.desiredRevision) {
        fail('復元対象の確認後に現在の状態が変わりました');
      }
      return { ...context, current, currentRevision };
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
        || record.payload?.actor !== actor || record.payload?.role !== role || record.payload?.policyIdentity !== policyIdentity)) {
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
        beforeVersionId: restart ? '' : record.payload.beforeVersionId,
        previewManifest: restart ? clone(context.current) : (record.payload.previewManifest || clone(context.current)),
        completedEntries: restart ? [] : (record.payload.completedEntries || []),
        applied: restart ? {} : (record.payload.applied || {}), intents: restart ? {} : (record.payload.intents || {}),
        rollbackCompleted: restart ? [] : (record.payload.rollbackCompleted || []), fencingToken, leaseOwner: executorId } : {
        schemaVersion: 1, object_type: 'scheduler-folder-restore-journal', stage: 'preparing',
        versionId: context.reference.versionId, target: context.resolved.target, path: context.resolved.path,
        domain: context.resolved.domain, providerRootIdentity: identity, workspaceId, actor, role, policyIdentity,
        expectedRevision, desiredRevision: context.desiredRevision, beforeVersionId: '', previewManifest: clone(context.current),
        completedEntries: [], applied: {}, intents: {}, rollbackCompleted: [],
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
      const completed = new Set(payload.completedEntries || []);
      const applied = { ...(payload.applied || {}) };
      const intents = { ...(payload.intents || {}) };
      const desiredFiles = new Map(context.desired.filter(item => item.entry_type === 'file').map(item => [item.rel_path, item]));
      const desiredDirs = new Set(context.desired.filter(item => item.entry_type === 'directory').map(item => item.rel_path));
      const preview = Array.isArray(payload.previewManifest) ? payload.previewManifest : [];
      const previewFiles = new Map(preview.filter(item => entryType(item) === 'file').map(item => [item.rel_path, item]));
      const previewDirs = new Set(preview.filter(item => entryType(item) === 'directory').map(item => item.rel_path));

      const saveProgress = async (key, change) => {
        completed.add(key); applied[key] = change;
        await journal.checkpoint({ completedEntries: [...completed].sort(), applied: clone(applied), intents: clone(intents) });
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

      // Remove snapshot-extraneous entries and old entry types first. This
      // makes file<->directory transitions deterministic and rollbackable.
      for (const extra of preview.filter(item => entryType(item) === 'file'
        && (!desiredFiles.has(item.rel_path) || desiredDirs.has(item.rel_path)))) await deletePreviewFile(extra);
      for (const relPath of [...previewDirs].filter(path => !desiredDirs.has(path) || desiredFiles.has(path))
        .sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b))) {
        await deletePreviewDirectory(relPath);
      }

      for (const relPath of [...desiredDirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
        const key = `mkdir:${relPath}`;
        const fullPath = join(context.resolved.path, relPath);
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
        if ((before && (!current || current.revision !== before.revision || currentBase64 !== before.content_base64))
          || (!before && current)) fail('確認後に復元先ファイルが変更されました');
        if (!intents[key]) await saveIntent(key, ownershipIntent('write', key, fullPath, { beforeRevision: before?.revision || null,
          beforeBase64: before?.content_base64 ?? null, afterHash: desired.content_base64 }));
        await journal.checkpoint({});
        const result = await provider.uploadBytesConditional(fullPath, base64ToBytes(desired.content_base64), before?.revision || null,
          { name: intents[key].markerName, bytes: markerBytes(intents[key].markerToken) });
        await window.__MeldexSchedulerFolderRestoreCrashHook?.('mutated', { key, target: context.resolved.target });
        await saveProgress(key, { kind: 'write', afterRevision: String(result?.revision || result?.rev || result?.etag || ''), afterHash: desired.content_base64, changed: true });
      }

      const finalManifest = await captureManifest(context.resolved.path);
      if (await manifestRevision(finalManifest) !== context.desiredRevision) fail('フォルダーを完全に復元できません');
      await journal.checkpoint({ stage: 'committing' });
      for (const intent of Object.values(intents)) await cleanupMarker(intent);
      await journal.finish({ stage: 'complete', completedAt: new Date().toISOString() });
      return { restored: desiredFiles.size, restoredDirectories: desiredDirs.size };
    }

    async function rollbackApplied(context, journal) {
      const payload = journal.record.payload;
      if (!payload.beforeVersionId) return;
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
        if (options.preflightOnly) return { restored: 0, preflight: true };
        if (options.verifyOnly) {
          if (context.currentRevision !== context.desiredRevision) fail('checkpoint後に復元済みフォルダーが変更されました');
          return { restored: context.desired.filter(item => item.entry_type === 'file').length, resumed: true, verified: true };
        }
        let journal = await acquireJournal(context, expectedRevision);
        if (journal.complete) {
          if (context.currentRevision !== context.desiredRevision) fail('完了済み復元の内容が変更されました');
          return { restored: context.desired.filter(item => item.entry_type === 'file').length, resumed: true };
        }
        try {
          if (journal.record.payload?.stage === 'rolling-back') {
            await rollbackApplied(context, journal);
            await journal.finish({ stage: 'rolled-back', rolledBack: true, rolledBackAt: new Date().toISOString() });
            await journal.close();
            context = await preflight(domain, version, targets, target, expectedRevision);
            journal = await acquireJournal(context, expectedRevision);
          }
          return await applyExact(context, journal);
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
      },
    });
  }

  window.MeldexSchedulerFolderRestoreCloudAdapter = Object.freeze({ DOMAINS, create });
})();
