/* Thin, non-blocking bridge from legacy Sheet paths to the unified Topic store. */
(function initMeldexTopicLiveBridge(global) {
  'use strict';

  if (global.GbTopicLiveBridge) return;

  const DEFAULT_DEBOUNCE_MS = 450;
  const ROOT_CACHE_MS = 10000;
  const inflight = new Map();
  const saveTimers = new Map();
  const ownerStates = new WeakMap();
  let rootsCache = null;
  let rootsLoadedAt = 0;
  let generation = 0;

  function normalizePath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '');
  }

  function safeRelative(value) {
    const relative = normalizePath(value).replace(/^\/+/, '');
    const parts = relative.split('/').filter(Boolean);
    if (!parts.length || parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) return '';
    return parts.join('/');
  }

  function rootItems(value) {
    if (Array.isArray(value)) return value;
    return Array.isArray(value?.roots) ? value.roots : [];
  }

  async function registeredRoots(force) {
    const now = Date.now();
    if (!force && rootsCache && now - rootsLoadedAt < ROOT_CACHE_MS) return rootsCache;
    if (typeof global.apiFetch !== 'function') return [];
    const loaded = rootItems(await global.apiFetch('/outliner-roots', { silentError: true }));
    rootsCache = loaded.filter((root) => root && root.visible !== false && root.deleted !== true);
    rootsLoadedAt = now;
    return rootsCache;
  }

  function sourceIdOf(root) {
    return String(root?.sourceId || root?.id || '').trim();
  }

  function rootLocalPath(root) {
    const candidates = [root?.localPath, root?.path];
    for (const value of candidates) {
      const normalized = normalizePath(value);
      if (/^[a-z]:\//i.test(normalized) || normalized.startsWith('//') || normalized.startsWith('/')) return normalized;
    }
    return '';
  }

  function isBelow(path, root) {
    const foldedPath = path.toLocaleLowerCase();
    const foldedRoot = root.toLocaleLowerCase();
    return foldedPath === foldedRoot || foldedPath.startsWith(foldedRoot + '/');
  }

  async function resolveDefaultRootRelativePath(rawPath, roots) {
    const relativePath = safeRelative(rawPath);
    if (!relativePath || typeof global.apiFetch !== 'function') return null;
    let vault;
    try {
      vault = await global.apiFetch('/vault', { silentError: true });
    } catch (_) {
      // 既定ソースの補完解決だけを諦め、明示的な登録パスの処理は継続させる。
      return null;
    }
    const vaultPath = normalizePath(vault?.path);
    if (!vaultPath) return null;
    const matches = roots.map((root) => ({
      sourceId: sourceIdOf(root), path: rootLocalPath(root),
    })).filter((entry) => entry.sourceId && entry.path
      && entry.path.toLocaleLowerCase() === vaultPath.toLocaleLowerCase());
    if (matches.length !== 1) return null;
    return { sourceId: matches[0].sourceId, relativePath, dbPath: rawPath };
  }

  async function resolveRegisteredPath(dbPath, options) {
    const rawPath = normalizePath(dbPath);
    if (!rawPath) return null;
    let roots;
    try {
      roots = await registeredRoots(options?.refreshRoots === true);
    } catch (_) {
      return null;
    }
    const registry = global.MeldexSourceFolderRegistry;
    const parsed = registry?.parseSourcePath?.(rawPath);
    if (parsed?.sourceId) {
      const sourceId = String(parsed.sourceId).trim();
      const registered = roots.some((root) => sourceIdOf(root) === sourceId);
      const relativePath = safeRelative(parsed.relativePath);
      return registered && relativePath ? { sourceId, relativePath, dbPath: rawPath } : null;
    }
    if (!/^[a-z]:\//i.test(rawPath) && !rawPath.startsWith('//') && !rawPath.startsWith('/')) {
      return resolveDefaultRootRelativePath(rawPath, roots);
    }
    const matches = roots.map((root) => ({ root, sourceId: sourceIdOf(root), path: rootLocalPath(root) }))
      .filter((entry) => entry.sourceId && entry.path && isBelow(rawPath, entry.path))
      .sort((left, right) => right.path.length - left.path.length);
    if (!matches.length) return null;
    const match = matches[0];
    const relativePath = safeRelative(rawPath.slice(match.path.length));
    return relativePath ? { sourceId: match.sourceId, relativePath, dbPath: rawPath } : null;
  }

  function ownerActive(owner, expectedPath) {
    if (!owner || typeof owner !== 'object') return true;
    const state = ownerStates.get(owner);
    if (state?.destroyed || owner.destroyed) return false;
    return !owner.dbPath || normalizePath(owner.dbPath) === normalizePath(expectedPath);
  }

  function statusOf(error) {
    return Number(error?.status || error?.response?.status || error?.payload?.status || 0);
  }

  async function requestMigration(target, previewOnly) {
    const key = `${target.sourceId}\n${target.relativePath}\n${previewOnly ? 'preview' : 'commit'}`;
    if (inflight.has(key)) return inflight.get(key);
    const request = global.apiPost('/topic-migrations/open', {
      sourceId: target.sourceId,
      relativePath: target.relativePath,
      ...(previewOnly ? { migrationPreview: true } : {}),
    }, { silentError: true }).finally(() => {
      if (inflight.get(key) === request) inflight.delete(key);
    });
    inflight.set(key, request);
    return request;
  }

  async function migrateTarget(target, options) {
    if (typeof global.apiPost !== 'function') return { ok: false, status: 'offline', target };
    const previewOnly = options?.readOnly === true || options?.previewOnly === true;
    try {
      const response = await requestMigration(target, previewOnly);
      let archive = null;
      const archiveRelativePath = response?.migration?.archiveRelativePath;
      if (!previewOnly && archiveRelativePath) {
        archive = await global.apiPost('/topic-views/migration/open', {
          sourceId: target.sourceId,
          relativePath: archiveRelativePath,
          legacyPath: target.relativePath,
        }, { silentError: true });
        if (archive?.documentId && typeof global.apiFetch === 'function') {
          archive = await global.apiFetch(
            `/topic-views/${encodeURIComponent(archive.documentId)}/snapshot`,
            { silentError: true },
          );
        }
      }
      return { ok: true, mode: previewOnly ? 'preview' : 'commit', response, archive, target };
    } catch (error) {
      if (!previewOnly && [403, 409].includes(statusOf(error))) {
        try {
          const response = await requestMigration(target, true);
          return { ok: true, mode: 'preview', response, target };
        } catch (previewError) {
          return { ok: false, status: 'fallback', error: previewError, target };
        }
      }
      return { ok: false, status: statusOf(error) === 0 ? 'offline' : 'fallback', error, target };
    }
  }

  function recordsFrom(result) {
    const response = result?.response || {};
    if (Array.isArray(result?.archive?.topics)) {
      return result.archive.topics.map(item => item?.record && ({
        ...item.record, topicRef: item.topicRef,
      })).filter(Boolean);
    }
    if (Array.isArray(response?.preview?.topicRecords)) return response.preview.topicRecords;
    const states = response?.migration?.topicStates;
    return states && typeof states === 'object'
      ? Object.values(states).map((state) => state?.record).filter(Boolean)
      : [];
  }

  function viewDocumentFrom(result) {
    return result?.archive?.viewDocument || result?.response?.preview?.viewDocument
      || result?.response?.migration?.viewDocument || null;
  }

  function publish(result, reason) {
    const records = recordsFrom(result);
    const legacyNodeTopicIds = {};
    records.forEach((record) => {
      const legacyNodeId = String(record?.legacyNodeId || '').trim();
      if (legacyNodeId && record?.topicId) legacyNodeTopicIds[legacyNodeId] = String(record.topicId);
    });
    const detail = {
      sourceId: result.target.sourceId,
      relativePath: result.target.relativePath,
      dbPath: result.target.dbPath,
      mode: result.mode,
      reason: reason || 'open',
      topicRecords: records,
      viewDocument: viewDocumentFrom(result),
      checkpoint: result?.archive?.checkpoint || null,
      archiveRelativePath: result?.response?.migration?.archiveRelativePath || '',
      legacyNodeTopicIds,
    };
    if (typeof global.dispatchEvent === 'function') {
      const event = typeof global.CustomEvent === 'function'
        ? new global.CustomEvent('meldex:topic-records-updated', { detail })
        : { type: 'meldex:topic-records-updated', detail };
      global.dispatchEvent(event);
    }
    return detail;
  }

  async function migrateOpenedSheet(dbPath, options) {
    const owner = options?.owner;
    const startedGeneration = generation;
    if (!ownerActive(owner, dbPath)) return { ok: false, status: 'destroyed' };
    const target = await resolveRegisteredPath(dbPath, options);
    if (!target) return { ok: false, status: 'unregistered' };
    const result = await migrateTarget(target, options);
    if (startedGeneration !== generation || !ownerActive(owner, dbPath)) {
      return { ok: false, status: 'destroyed', target };
    }
    if (result.ok) result.detail = publish(result, options?.reason);
    return result;
  }

  function scheduleAfterSave(dbPath, options) {
    const key = normalizePath(dbPath);
    if (!key) return null;
    const previous = saveTimers.get(key);
    if (previous) clearTimeout(previous.timer);
    const owner = options?.owner;
    const delay = Number.isFinite(options?.debounceMs) ? Math.max(0, options.debounceMs) : DEFAULT_DEBOUNCE_MS;
    const timer = setTimeout(() => {
      saveTimers.delete(key);
      if (!ownerActive(owner, dbPath)) return;
      void migrateOpenedSheet(dbPath, { ...options, reason: 'save', refreshRoots: false });
    }, delay);
    saveTimers.set(key, { timer, owner });
    return timer;
  }

  function destroyOwner(owner) {
    if (!owner || typeof owner !== 'object') return;
    ownerStates.set(owner, { destroyed: true });
    for (const [key, pending] of saveTimers.entries()) {
      if (pending.owner !== owner) continue;
      clearTimeout(pending.timer);
      saveTimers.delete(key);
    }
  }

  function destroy() {
    generation += 1;
    for (const pending of saveTimers.values()) clearTimeout(pending.timer);
    saveTimers.clear();
    inflight.clear();
    rootsCache = null;
    rootsLoadedAt = 0;
  }

  global.GbTopicLiveBridge = Object.freeze({
    resolveRegisteredPath,
    migrateOpenedSheet,
    scheduleAfterSave,
    destroyOwner,
    clearRootsCache() { rootsCache = null; rootsLoadedAt = 0; },
    destroy,
  });
})(window);
