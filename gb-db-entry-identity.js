/* ==============================
   シートエントリの安定ID・改名・保存直列化
   ============================== */
(function () {
  'use strict';

  const registries = new Map();
  const mutationChains = new Map();
  let operationSeq = 0;

  function normalize(path) {
    if (typeof _dbNormalizePath === 'function') return _dbNormalizePath(path || '');
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function registry(dbPath) {
    const key = normalize(dbPath);
    if (!registries.has(key)) {
      registries.set(key, {
        dbPath: key,
        pathById: new Map(),
        idByPath: new Map(),
        aliases: new Map(),
      });
    }
    return registries.get(key);
  }

  function entryPath(dbPath, entityName, pivotData) {
    if (typeof _entityPath === 'function') return normalize(_entityPath(dbPath, entityName, pivotData));
    return normalize(dbPath) + '/' + String(entityName || '') + '.md';
  }

  function entryIdFromEntity(entityData) {
    return String(entityData?._id || entityData?.entry_id || entityData?.id || '').trim();
  }

  function stampEntityValues(entityData, canonicalPath, entryId) {
    Object.values(entityData || {}).forEach(values => {
      if (!Array.isArray(values)) return;
      values.forEach(value => {
        if (!value || typeof value !== 'object') return;
        value.entry_path = canonicalPath;
        if (entryId) value.entry_id = entryId;
      });
    });
  }

  function registerEntry(dbPath, entryId, canonicalPath) {
    const id = String(entryId || '').trim();
    const path = normalize(canonicalPath);
    if (!path) return path;
    const reg = registry(dbPath || (typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(path) : ''));
    if (id) {
      const previous = reg.pathById.get(id);
      if (previous && previous !== path) reg.aliases.set(previous, path);
      reg.pathById.set(id, path);
      reg.idByPath.set(path, id);
    }
    return path;
  }

  function registerPivot(dbPath, pivotData) {
    Object.entries(pivotData?.entities || {}).forEach(([entityName, entityData]) => {
      const path = entryPath(dbPath, entityName, pivotData);
      const id = entryIdFromEntity(entityData);
      registerEntry(dbPath, id, path);
      stampEntityValues(entityData, path, id);
    });
    return pivotData;
  }

  function followAliases(reg, sourcePath) {
    let path = normalize(sourcePath);
    const visited = new Set();
    while (path && reg.aliases.has(path) && !visited.has(path)) {
      visited.add(path);
      path = normalize(reg.aliases.get(path));
    }
    return path;
  }

  function resolvePath(ref, fallbackPath, dbPath) {
    const candidate = ref && typeof ref === 'object' ? ref : {};
    const rawPath = normalize(
      candidate.entry_path || candidate.entity_path || candidate.folder_path
      || fallbackPath || (typeof ref === 'string' ? ref : '')
    );
    const targetDbPath = normalize(dbPath || (
      typeof _dbPathFromEntityPath === 'function' ? _dbPathFromEntityPath(rawPath) : ''
    ));
    const reg = registry(targetDbPath);
    const id = String(candidate.entry_id || candidate._id || reg.idByPath.get(rawPath) || '').trim();
    if (id && reg.pathById.has(id)) return reg.pathById.get(id);
    return followAliases(reg, rawPath);
  }

  function mutationKey(ref, entityPathValue, dbPath) {
    const path = normalize(entityPathValue);
    const reg = registry(dbPath);
    const id = String(ref?.entry_id || ref?._id || reg.idByPath.get(path) || '').trim();
    return id ? `id:${id}` : `path:${followAliases(reg, path) || normalize(dbPath)}`;
  }

  function queueMutation(ref, entityPathValue, dbPath, mutationFactory) {
    const targetDbPath = normalize(dbPath);
    const key = mutationKey(ref, entityPathValue, targetDbPath);
    const previous = mutationChains.get(key);
    const queued = Promise.resolve(previous)
      .catch(() => {})
      .then(() => mutationFactory(resolvePath(ref, entityPathValue, targetDbPath)));
    const tracked = typeof _dbTrackValueMutation === 'function'
      ? _dbTrackValueMutation(targetDbPath, queued)
      : queued;
    mutationChains.set(key, tracked);
    tracked.finally(() => {
      if (mutationChains.get(key) === tracked) mutationChains.delete(key);
    }).catch(() => {});
    return tracked;
  }

  function operationId(prefix) {
    operationSeq += 1;
    const random = globalThis.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${operationSeq.toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix || 'entry'}-${random}`;
  }

  function contextsForDb(dbPath) {
    if (typeof _dbPaneContextsForPath === 'function') {
      return _dbPaneContextsForPath(dbPath).filter(ctx => ctx && !ctx.destroyed);
    }
    return [];
  }

  function updatePivotTarget(target, oldName, newName, oldPath, newPath, entryId, revision) {
    const entities = target?.pivotData?.entities;
    if (!entities) return;
    if (oldName !== newName && Object.prototype.hasOwnProperty.call(entities, oldName)) {
      entities[newName] = entities[oldName];
      delete entities[oldName];
    }
    const entityData = entities[newName];
    if (entityData) {
      if (entryId) entityData._id = entryId;
      if (Number.isInteger(Number(revision))) entityData._revision = Number(revision);
      if (typeof _dbRewriteEntityValuePaths === 'function') {
        _dbRewriteEntityValuePaths(entityData, oldPath, newPath);
      }
      stampEntityValues(entityData, newPath, entryId);
    }
    if (Array.isArray(target._lastEntityNames)) {
      target._lastEntityNames = target._lastEntityNames.map(name => name === oldName ? newName : name);
    }
    if (target._selectedEntities?.has?.(oldName)) {
      target._selectedEntities.delete(oldName);
      target._selectedEntities.add(newName);
    }
  }

  function updateContextDom(ctx, oldName, newName) {
    if (ctx?.destroyed) return;
    const root = ctx ? ctx.containerEl : document;
    if (!root?.querySelectorAll) return;
    const escaped = globalThis.CSS?.escape
      ? CSS.escape(oldName)
      : String(oldName).replace(/["\\]/g, '\\$&');
    root.querySelectorAll(`tr[data-entity-name="${escaped}"]`).forEach(row => {
      row.dataset.entityName = newName;
      row.querySelectorAll('.entity-name-label').forEach(label => { label.textContent = newName; });
      row.querySelectorAll('[data-entity-name]').forEach(el => { el.dataset.entityName = newName; });
    });
  }

  function invalidateRelationCaches(dbPath) {
    try {
      if (typeof _relationCache === 'object' && _relationCache) {
        Object.keys(_relationCache).forEach(key => { _relationCache[key] = null; });
      }
    } catch (error) {
      console.warn('リレーション候補キャッシュの無効化に失敗:', error);
    }
    try {
      if (typeof clearRollupCache === 'function') clearRollupCache(dbPath);
    } catch (error) {
      console.warn('ロールアップキャッシュの無効化に失敗:', error);
    }
  }

  function applyRename(result, request) {
    const oldPath = normalize(request.oldPath || request.path);
    const newPath = normalize(result?.new_path || entryPath(request.dbPath, request.newName));
    const oldName = String(request.oldName || '').trim()
      || (typeof _dbEntityNameFromPath === 'function' ? _dbEntityNameFromPath(oldPath) : '');
    const newName = String(request.newName || '').trim()
      || (typeof _dbEntityNameFromPath === 'function' ? _dbEntityNameFromPath(newPath) : '');
    const entryId = String(result?.entry_id || request.entryId || '').trim();
    const reg = registry(request.dbPath);
    reg.aliases.set(oldPath, newPath);
    if (entryId) {
      reg.pathById.set(entryId, newPath);
      reg.idByPath.set(oldPath, entryId);
      reg.idByPath.set(newPath, entryId);
    }
    contextsForDb(request.dbPath).forEach(ctx => {
      updatePivotTarget(ctx, oldName, newName, oldPath, newPath, entryId, result?.revision);
      updateContextDom(ctx, oldName, newName);
    });
    if (typeof state !== 'undefined' && normalize(state.currentDbPath) === normalize(request.dbPath)) {
      updatePivotTarget(state, oldName, newName, oldPath, newPath, entryId, result?.revision);
    }
    if (typeof _dbRenameLocalRefs === 'function') _dbRenameLocalRefs(request.dbPath, oldName, newName);
    if (typeof _dbPropagateEntryRevision === 'function' && result?.revision != null) {
      _dbPropagateEntryRevision(newPath, result.revision);
    }
    if (typeof _dbNotifyCalendarEntryRenamed === 'function') {
      _dbNotifyCalendarEntryRenamed(request.dbPath, oldPath, newPath, oldName, newName);
    }
    invalidateRelationCaches(request.dbPath);
    return { ...result, new_path: newPath, entry_id: entryId || result?.entry_id || '' };
  }

  function isUnknownResultError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return error?.name === 'AbortError'
      || error?.code === 'ETIMEDOUT'
      || message.includes('タイムアウト')
      || message.includes('timeout')
      || message.includes('network')
      || message.includes('failed to fetch');
  }

  async function reconcile(request) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const pivot = await apiFetch('/pivot?path=' + encodeURIComponent(request.dbPath));
        registerPivot(request.dbPath, pivot);
        const entityData = pivot?.entities?.[request.newName];
        const oldEntityData = pivot?.entities?.[request.oldName];
        const actualId = entryIdFromEntity(entityData);
        const identityMatches = request.entryId
          ? actualId === request.entryId
          : !oldEntityData;
        if (entityData && identityMatches) {
          return {
            ok: true,
            reconciled: true,
            new_path: entryPath(request.dbPath, request.newName, pivot),
            entry_id: actualId || request.entryId || '',
            revision: entityData?._revision,
            operation_id: request.operationId,
          };
        }
      } catch (error) {
        if (attempt === 2) console.warn('エントリ改名結果の照合に失敗:', error);
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
    }
    return null;
  }

  async function rename(options) {
    const request = {
      dbPath: normalize(options?.dbPath),
      oldName: String(options?.oldName || '').trim(),
      newName: String(options?.newName || '').trim(),
      oldPath: normalize(options?.path || ''),
      entryId: String(options?.entryId || '').trim(),
      operationId: options?.operationId || operationId('entry-rename'),
    };
    if (!request.dbPath || !request.oldName || !request.newName) {
      throw new Error('名前変更の対象が特定できません');
    }
    const ctxEntity = options?.ctx?.pivotData?.entities?.[request.oldName];
    if (!request.entryId) request.entryId = entryIdFromEntity(ctxEntity);
    if (!request.oldPath) request.oldPath = entryPath(request.dbPath, request.oldName, options?.ctx?.pivotData);
    const ref = { entry_id: request.entryId, entry_path: request.oldPath };
    return queueMutation(ref, request.oldPath, request.dbPath, async latestPath => {
      const body = {
        path: latestPath || request.oldPath,
        new_name: request.newName,
        expected_entry_id: request.entryId || undefined,
        operation_id: request.operationId,
      };
      let result;
      try {
        result = await apiPost('/entity/rename', body, { silentError: true, timeoutMs: 120000 });
      } catch (error) {
        if (!isUnknownResultError(error)) throw error;
        try {
          result = await apiPost('/entity/rename', body, { silentError: true, timeoutMs: 120000 });
        } catch (retryError) {
          if (!isUnknownResultError(retryError)) throw retryError;
        }
        if (result) return applyRename(result, request);
        const reconciled = await reconcile(request);
        if (!reconciled) {
          error.resultUnknown = true;
          throw error;
        }
        result = reconciled;
      }
      return applyRename(result || {}, request);
    });
  }

  async function reload(ctx, dbPath, options = {}) {
    if (!ctx && typeof _dbFindPaneContextForPath === 'function') {
      ctx = _dbFindPaneContextForPath(dbPath);
    }
    if (!ctx && typeof _currentPaneState === 'function') {
      const current = _currentPaneState();
      if (!dbPath || normalize(current?.dbPath) === normalize(dbPath)) ctx = current;
    }
    if (!ctx || ctx.destroyed) return { ok: false, destroyed: true };
    if (ctx.embedded && ctx.hostController) {
      const ok = options.forceReload === false
        ? await ctx.hostController.open(dbPath)
        : await ctx.hostController.refresh();
      return { ok: ok !== false, destroyed: !!ctx.destroyed };
    }
    if (typeof selectDatabase !== 'function') return { ok: false, error: new Error('シート再読込機能がありません') };
    return selectDatabase(dbPath, ctx, {
      silent: true,
      skipRecent: true,
      skipNavPush: true,
      skipSaveLastView: true,
      skipAutoVersion: true,
      ...options,
    });
  }

  window.GbDbEntryIdentity = {
    applyRename,
    operationId,
    queueMutation,
    registerEntry,
    registerPivot,
    reload,
    rename,
    resolvePath,
  };
  window.renameDbEntry = rename;
})();
