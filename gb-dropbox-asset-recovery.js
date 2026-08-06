/* Dropbox file-operation hooks for asset identity, tag following and recovery. */
(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const hooks = window.__MeldexPwaPathMutationHooks;
  const identity = window.MeldexDropboxAssetIdentity;
  const managedJson = window.MeldexDropboxManagedJson;
  if (!internals || !Array.isArray(hooks) || !identity || !managedJson) return;

  const {
    _normalizeFolderPath,
    _requirePwaProvider,
  } = internals;
  const ASSIGNMENTS_FILE = '.meldex/global-tags.json';
  const RECOVERY_ROOT = '.meldex/asset-recovery';
  const APPLIED_OPERATION_LIMIT = 256;

  function randomId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return `${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`;
  }

  function matchesPath(path, root, isFolder) {
    const value = identity.normalizePath(path);
    const base = identity.normalizePath(root);
    return value === base || (isFolder && value.startsWith(base + '/'));
  }

  function mappedPath(path, oldPath, newPath) {
    const value = identity.normalizePath(path);
    const oldRoot = identity.normalizePath(oldPath);
    const nextRoot = identity.normalizePath(newPath);
    return nextRoot + value.slice(oldRoot.length);
  }

  function assignmentPaths(store, oldPath, isFolder) {
    const paths = new Set();
    Object.values(store.asset_locators || {}).forEach(path => {
      if (matchesPath(path, oldPath, isFolder)) paths.add(identity.normalizePath(path));
    });
    Object.keys(store.assignments || {}).forEach(path => {
      if (matchesPath(path, oldPath, isFolder)) paths.add(identity.normalizePath(path));
    });
    if (!paths.size && oldPath) paths.add(identity.normalizePath(oldPath));
    return [...paths];
  }

  function assetAtPath(store, path) {
    const normalized = identity.normalizePath(path);
    return Object.entries(store.asset_locators || {})
      .find(([, value]) => identity.normalizePath(value) === normalized)?.[0] || '';
  }

  function removeProjection(store, path) {
    const normalized = identity.normalizePath(path);
    delete store.assignments[normalized];
    delete store.auto_assignments[normalized];
    delete store.legacy_migrations[normalized];
  }

  async function resolveMovedAsset(provider, store, oldPath, newPath) {
    const sourceAssetId = assetAtPath(store, oldPath);
    const resolved = await identity.resolveAsset(provider, store, newPath);
    if (!sourceAssetId || sourceAssetId === resolved.asset.asset_id) return resolved;
    const providerId = String(resolved.asset.provider_id || '');
    delete resolved.store.asset_assignments[resolved.asset.asset_id];
    delete resolved.store.asset_auto_assignments[resolved.asset.asset_id];
    delete resolved.store.asset_locators[resolved.asset.asset_id];
    if (providerId) resolved.store.asset_provider_ids[providerId] = sourceAssetId;
    resolved.store.asset_locators[sourceAssetId] = identity.normalizePath(newPath);
    return {
      store: resolved.store,
      asset: {
        ...resolved.asset,
        asset_id: sourceAssetId,
        path: identity.normalizePath(newPath),
      },
    };
  }

  async function applyMove(provider, rawStore, event) {
    let store = identity.normalizeStore(rawStore);
    store.asset_tombstones = store.asset_tombstones
      && typeof store.asset_tombstones === 'object' ? store.asset_tombstones : {};
    const oldPath = identity.normalizePath(event.oldPath || event.path);
    const newPath = identity.normalizePath(event.newPath || event.trashPath);
    const changes = [];
    for (const sourcePath of assignmentPaths(store, oldPath, !!event.isFolder)) {
      const destinationPath = mappedPath(sourcePath, oldPath, newPath);
      const sourceAssetId = assetAtPath(store, sourcePath);
      const assigned = identity.assignmentFor(store, sourcePath, sourceAssetId);
      const resolved = await resolveMovedAsset(provider, store, sourcePath, destinationPath);
      store = identity.projectAssignment(
        resolved.store,
        destinationPath,
        resolved.asset,
        assigned.ids,
        assigned.autoIds,
      );
      if (sourcePath !== destinationPath) removeProjection(store, sourcePath);
      const assetId = String(resolved.asset.asset_id || '');
      if (event.action === 'delete' && assetId) {
        store.asset_tombstones[assetId] = {
          status: 'deleted',
          last_path: sourcePath,
          trash_path: destinationPath,
          deleted_at: new Date().toISOString(),
        };
      } else if (event.action === 'restore' && assetId) {
        delete store.asset_tombstones[assetId];
      }
      changes.push({
        asset_id: assetId,
        before: { path: sourcePath },
        after: { path: destinationPath },
        tag_uids: assigned.ids,
        auto_tag_uids: assigned.autoIds,
      });
    }
    return { store, changes };
  }

  async function applyCopy(provider, rawStore, event) {
    let store = identity.normalizeStore(rawStore);
    store.asset_lineages = store.asset_lineages
      && typeof store.asset_lineages === 'object' ? store.asset_lineages : {};
    const oldPath = identity.normalizePath(event.oldPath);
    const newPath = identity.normalizePath(event.newPath);
    const changes = [];
    for (const sourcePath of assignmentPaths(store, oldPath, !!event.isFolder)) {
      const destinationPath = mappedPath(sourcePath, oldPath, newPath);
      const sourceAssetId = assetAtPath(store, sourcePath);
      const assigned = identity.assignmentFor(store, sourcePath, sourceAssetId);
      const resolved = await identity.resolveAsset(provider, store, destinationPath);
      store = identity.projectAssignment(
        resolved.store,
        destinationPath,
        resolved.asset,
        assigned.ids,
        assigned.autoIds,
      );
      const copiedAssetId = String(resolved.asset.asset_id || '');
      const lineageId = String(store.asset_lineages[sourceAssetId] || sourceAssetId);
      if (copiedAssetId && lineageId) store.asset_lineages[copiedAssetId] = lineageId;
      changes.push({
        asset_id: copiedAssetId,
        before: { path: sourcePath, source_asset_id: sourceAssetId },
        after: { path: destinationPath, lineage_id: lineageId },
        tag_uids: assigned.ids,
        auto_tag_uids: assigned.autoIds,
      });
    }
    return { store, changes };
  }

  async function writeMerged(provider, path, updater, fallbackValue) {
    return managedJson.writeMerged(provider, path, updater, fallbackValue);
  }

  async function persistEvents(provider, event, changes) {
    const month = new Date().toISOString().slice(0, 7);
    const path = `${RECOVERY_ROOT}/events/${month}.json`;
    const operationId = String(event.operationId || randomId());
    await writeMerged(provider, path, current => {
      const source = current && typeof current === 'object' ? current : {};
      const events = source.events && typeof source.events === 'object'
        ? { ...source.events } : {};
      changes.forEach((change, index) => {
        const eventId = `${operationId}:${index}`;
        events[eventId] = {
          event_id: eventId,
          operation: event.action,
          ...change,
          recorded_at: new Date().toISOString(),
        };
      });
      return { version: 1, events };
    }, { version: 1, events: {} });
  }

  async function enqueueRetry(provider, event, error) {
    const retryId = String(event.operationId || randomId());
    await managedJson.write(provider, `${RECOVERY_ROOT}/retry/${retryId}.json`, {
      version: 1,
      retry_id: retryId,
      status: 'pending',
      event,
      error: String(error?.message || error || '').slice(0, 1000),
      created_at: new Date().toISOString(),
    });
  }

  function rememberAppliedOperation(store, operationId, changes) {
    const applied = store.asset_recovery_operations
      && typeof store.asset_recovery_operations === 'object'
      ? { ...store.asset_recovery_operations } : {};
    applied[operationId] = {
      applied_at: new Date().toISOString(),
      changes,
    };
    const entries = Object.entries(applied)
      .sort((left, right) => String(left[1]?.applied_at || '')
        .localeCompare(String(right[1]?.applied_at || '')));
    store.asset_recovery_operations = Object.fromEntries(
      entries.slice(Math.max(0, entries.length - APPLIED_OPERATION_LIMIT)),
    );
    return store;
  }

  async function handleMutation(event, providerOverride) {
    const provider = providerOverride || await _requirePwaProvider('readwrite');
    const normalizedEvent = { ...event, operationId: event.operationId || randomId() };
    const oldPath = identity.normalizePath(normalizedEvent.oldPath || normalizedEvent.path);
    const newPath = identity.normalizePath(normalizedEvent.newPath || normalizedEvent.trashPath);
    if (normalizedEvent.action !== 'copy' && oldPath === newPath) {
      return { ok: true, tracked: 0, noop: true };
    }
    try {
      let changes = [];
      let deduplicated = false;
      await writeMerged(provider, ASSIGNMENTS_FILE, async current => {
        const applied = current?.asset_recovery_operations;
        const previous = applied && typeof applied === 'object'
          ? applied[normalizedEvent.operationId] : null;
        if (previous) {
          changes = Array.isArray(previous.changes) ? previous.changes : [];
          deduplicated = true;
          return current;
        }
        const result = normalizedEvent.action === 'copy'
          ? await applyCopy(provider, current, normalizedEvent)
          : await applyMove(provider, current, normalizedEvent);
        changes = result.changes;
        const remembered = rememberAppliedOperation(
          result.store,
          normalizedEvent.operationId,
          changes,
        );
        return {
          ...remembered,
          version: Math.max(5, Number(remembered.version || 0)),
          updated_at: new Date().toISOString(),
          assignment_revision: randomId(),
        };
      }, { version: 5, assignments: {}, auto_assignments: {} });
      await persistEvents(provider, normalizedEvent, changes);
      return { ok: true, tracked: changes.length, deduplicated };
    } catch (error) {
      let retryQueued = false;
      try {
        await enqueueRetry(provider, normalizedEvent, error);
        retryQueued = true;
      } catch (retryError) {
        console.warn('[asset-recovery] 保守キューへの登録にも失敗しました', retryError);
      }
      const wrapped = new Error(retryQueued
        ? 'タグ追従を保守キューへ登録しました'
        : 'タグ追従を記録できませんでした。「タグのメンテナンス」で差分照合してください');
      wrapped.code = 'asset_recovery_deferred';
      wrapped.retryQueued = retryQueued;
      wrapped.cause = error;
      throw wrapped;
    }
  }

  hooks.push(event => handleMutation(event));
  window.MeldexDropboxAssetRecovery = { handleMutation };
})();
