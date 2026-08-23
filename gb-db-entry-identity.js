/* ==============================
   シートエントリの安定ID・改名・保存直列化
   ============================== */
(function () {
  'use strict';

  const registries = new Map();
  const mutationChains = new Map();
  const deleteQueues = new Map();
  const deletingKeys = new Set();
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

  function deleteKeys(ref, entityPathValue, dbPath) {
    const path = normalize(entityPathValue);
    const reg = registry(dbPath);
    const id = String(ref?.entry_id || ref?._id || reg.idByPath.get(path) || '').trim();
    const keys = [];
    if (id) keys.push(`id:${id}`);
    if (path) keys.push(`path:${followAliases(reg, path)}`);
    return keys;
  }

  function deletingError() {
    const error = new Error('このトピックは削除中です');
    error.code = 'ENTRY_DELETING';
    error.userMessage = '削除中のトピックは編集できません';
    return error;
  }

  function queueMutation(ref, entityPathValue, dbPath, mutationFactory, options = {}) {
    const targetDbPath = normalize(dbPath);
    const key = mutationKey(ref, entityPathValue, targetDbPath);
    const isDeleting = () => deleteKeys(ref, entityPathValue, targetDbPath)
      .some(deleteKey => deletingKeys.has(deleteKey));
    if (!options.allowDeleting && isDeleting()) return Promise.reject(deletingError());
    const previous = mutationChains.get(key);
    const queued = Promise.resolve(previous)
      .catch(() => {})
      .then(() => {
        if (!options.allowDeleting && isDeleting()) throw deletingError();
        return mutationFactory(resolvePath(ref, entityPathValue, targetDbPath));
      });
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
    const escaped = MeldexEscape.cssIdent(oldName);
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

  function entityNameFromPath(path) {
    if (typeof _dbEntityNameFromPath === 'function') return _dbEntityNameFromPath(path);
    return normalize(path).split('/').pop()?.replace(/\.md$/i, '') || '';
  }

  function getDeleteQueue(dbPath) {
    const key = normalize(dbPath);
    if (!deleteQueues.has(key)) {
      deleteQueues.set(key, {
        dbPath: key,
        pending: [],
        activeByKey: new Map(),
        contexts: new Set(),
        requests: new Set(),
        completed: [],
        running: false,
        current: null,
        progressHandle: null,
      });
    }
    return deleteQueues.get(key);
  }

  function addQueueContext(queue, ctx) {
    if (ctx && !ctx.destroyed && normalize(ctx.dbPath || queue.dbPath) === queue.dbPath) {
      queue.contexts.add(ctx);
    }
    contextsForDb(queue.dbPath).forEach(candidate => queue.contexts.add(candidate));
  }

  function snapshotEntry(queue, item) {
    addQueueContext(queue, item.ctx);
    item.snapshots = item.snapshots || [];
    queue.contexts.forEach(ctx => {
      if (item.snapshots.some(snapshot => snapshot.ctx === ctx)) return;
      const entityData = ctx?.pivotData?.entities?.[item.name];
      item.snapshots.push({
        ctx,
        entityData,
        order: Array.isArray(ctx?._lastEntityNames) ? [...ctx._lastEntityNames] : null,
        selected: !!ctx?._selectedEntities?.has?.(item.name),
      });
    });
  }

  function hideEntries(queue, items) {
    const names = items.map(item => item.name).filter(Boolean);
    if (!names.length) return;
    items.forEach(item => snapshotEntry(queue, item));
    const ctx = items.find(item => item.ctx && !item.ctx.destroyed)?.ctx
      || [...queue.contexts].find(candidate => candidate && !candidate.destroyed);
    queue.contexts.forEach(candidate => {
      if (candidate?._selectedEntities) names.forEach(name => candidate._selectedEntities.delete(name));
    });
    if (typeof _dbRemoveCreatedEntitiesLocally === 'function') {
      _dbRemoveCreatedEntitiesLocally(ctx, queue.dbPath, names, { preserveManualOrder: true });
    } else {
      queue.contexts.forEach(candidate => {
        names.forEach(name => {
          const escaped = MeldexEscape.cssIdent(name);
          candidate?.containerEl?.querySelector?.(`tr[data-entity-name="${escaped}"]`)?.remove();
        });
      });
    }
    if (typeof _updateBulkEditBar === 'function') queue.contexts.forEach(candidate => _updateBulkEditBar(candidate));
  }

  function restoreSelection(ctx, names) {
    if (!ctx || ctx.destroyed || !names.length) return;
    names.forEach(name => ctx._selectedEntities?.add?.(name));
    if (typeof _restoreSelectionByEntityNames === 'function') {
      _restoreSelectionByEntityNames(ctx, names);
    }
  }

  function restoreFailedLocally(failures, successfulNames = []) {
    const touched = new Set();
    const orders = new Map();
    const successfulSet = new Set(successfulNames);
    failures.forEach(item => {
      (item.snapshots || []).forEach(snapshot => {
        const ctx = snapshot.ctx;
        if (!ctx || ctx.destroyed || !snapshot.entityData) return;
        if (ctx.pivotData?.entities) ctx.pivotData.entities[item.name] = snapshot.entityData;
        if (snapshot.order && (!orders.has(ctx) || orders.get(ctx).length < snapshot.order.length)) {
          orders.set(ctx, snapshot.order);
        }
        if (snapshot.selected) ctx._selectedEntities?.add?.(item.name);
        touched.add(ctx);
      });
    });
    touched.forEach(ctx => {
      if (orders.has(ctx)) {
        ctx._lastEntityNames = orders.get(ctx).filter(name => (
          !successfulSet.has(name) && Object.prototype.hasOwnProperty.call(ctx.pivotData?.entities || {}, name)
        ));
      }
      if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, ctx.dbPath);
      else if (typeof renderPivot === 'function') renderPivot(ctx);
    });
  }

  function canonicalContainsEntry(canonical, item) {
    const entities = canonical?.entities || {};
    if (item.entryId) {
      return Object.values(entities).some(entity => entryIdFromEntity(entity) === item.entryId);
    }
    return Object.prototype.hasOwnProperty.call(entities, item.name);
  }

  function promoteUnknownFailuresFromCanonical(completed, canonical) {
    completed.forEach(({ item, result }) => {
      if (result.ok || !result.error?.resultUnknown || canonicalContainsEntry(canonical, item)) return;
      result.ok = true;
      result.response = {
        ok: true,
        reconciled: true,
        entry_id: item.entryId || '',
        operation_id: item.operationId,
      };
      delete result.error;
      item.subscribers.forEach(({ request, entry }) => {
        const requestResult = request.results.find(value => value.entry === entry);
        if (!requestResult) return;
        requestResult.ok = true;
        requestResult.response = result.response;
        delete requestResult.error;
      });
    });
  }

  function showDeleteProgress(queue, checking = false) {
    const total = queue.completed.length + queue.pending.length + (queue.current ? 1 : 0);
    const progressApi = window.MeldexOperationProgress;
    if (progressApi) {
      if (!queue.progressHandle || progressApi.isTerminalStatus(queue.progressHandle.getState()?.status)) {
        queue.progressHandle = progressApi.begin({
          kind: 'sheet-entry-delete',
          label: 'シートのトピックを削除しています',
          mode: total > 0 ? 'determinate' : 'indeterminate',
          total: total || null,
          processed: queue.completed.length,
          priority: 50,
        });
      }
      queue.progressHandle.update({
        phase: checking ? '削除結果を確認中' : '削除中',
        mode: total > 0 ? 'determinate' : 'indeterminate',
        total: total || null,
        processed: queue.completed.length,
      });
    }
    if (typeof showStatus !== 'function') return;
    if (checking) {
      showStatus('削除結果を確認中…');
      return;
    }
    const remaining = queue.pending.length + (queue.current ? 1 : 0);
    if (remaining > 0) showStatus(`削除中…（残り${remaining}件）`);
  }

  function finishDeleteProgress(queue, completed) {
    const handle = queue.progressHandle;
    queue.progressHandle = null;
    if (!handle) return;
    const successes = completed.filter(value => value.result.ok).length;
    const failures = completed.length - successes;
    if (failures > 0) {
      handle.partial({
        summary: successes + '件を削除、' + failures + '件は削除できませんでした',
      });
    } else {
      handle.succeed({ summary: successes + '件を削除しました' });
    }
  }

  async function reconcileDelete(queue, item) {
    try {
      const pivot = await apiFetch('/pivot?path=' + encodeURIComponent(queue.dbPath), {
        silentError: true,
        timeoutMs: 60000,
        skipBrowseCache: true,
        cache: 'reload',
      });
      registerPivot(queue.dbPath, pivot);
      const entities = pivot?.entities || {};
      const namedEntity = entities[item.name];
      if (!item.entryId) return namedEntity ? null : { ok: true, reconciled: true };
      const matchingName = Object.entries(entities)
        .find(([, entity]) => entryIdFromEntity(entity) === item.entryId)?.[0];
      if (!matchingName) return { ok: true, reconciled: true, entry_id: item.entryId };
      return null;
    } catch (error) {
      console.warn('エントリ削除結果の照合に失敗:', error);
      return null;
    }
  }

  async function performDelete(queue, item) {
    const ref = { entry_id: item.entryId, entry_path: item.path };
    return queueMutation(ref, item.path, queue.dbPath, async latestPath => {
      const body = {
        path: latestPath || item.path,
        expected_entry_id: item.entryId || undefined,
        assetId: item.assetId || undefined,
        operation_id: item.operationId,
        ...(item.confirmationPayload || {}),
      };
      let response;
      let firstError;
      try {
        response = await apiPost('/outliner/delete', body, { silentError: true, timeoutMs: 60000 });
      } catch (error) {
        firstError = error;
        if (!isUnknownResultError(error)) throw error;
        showDeleteProgress(queue, true);
        try {
          response = await apiPost('/outliner/delete', body, { silentError: true, timeoutMs: 60000 });
        } catch (retryError) {
          if (!isUnknownResultError(retryError)) throw retryError;
        }
        if (!response) response = await reconcileDelete(queue, item);
        if (!response) {
          firstError.resultUnknown = true;
          throw firstError;
        }
      }
      if (window.GbDbCalendarSync && typeof window.GbDbCalendarSync.onEntryDeleted === 'function') {
        try {
          await window.GbDbCalendarSync.onEntryDeleted(queue.dbPath, latestPath || item.path);
        } catch {}
      }
      return response || { ok: true };
    }, { allowDeleting: true });
  }

  function settleItem(queue, item, result) {
    item.completed = true;
    item.result = result;
    item.subscribers.forEach(({ request, entry }) => {
      request.results.push({ ...result, entry });
      request.remaining -= 1;
    });
    queue.completed.push({ item, result });
    queue.current = null;
    showDeleteProgress(queue);
  }

  async function reloadDeleteCycle(queue, completed) {
    const liveContexts = [...queue.contexts].filter(ctx => (
      ctx && !ctx.destroyed && normalize(ctx.dbPath) === queue.dbPath
    ));
    const reloadCtx = liveContexts[0] || null;
    let canonical = null;
    try {
      if (reloadCtx) {
        try {
          const reloadResult = await reload(reloadCtx, queue.dbPath, { forceReload: true });
          if (reloadResult?.ok !== false && !reloadCtx.destroyed) canonical = reloadCtx.pivotData || null;
        } catch (error) {
          console.warn('エントリ削除後のシート再読込に失敗:', error);
        }
      }
      const hasUnknownFailure = completed.some(value => (
        !value.result.ok && value.result.error?.resultUnknown
      ));
      if (canonical && hasUnknownFailure) {
        try {
          const authoritative = await apiFetch('/pivot?path=' + encodeURIComponent(queue.dbPath), {
            silentError: true,
            timeoutMs: 60000,
            skipBrowseCache: true,
            cache: 'reload',
          });
          registerPivot(queue.dbPath, authoritative);
          promoteUnknownFailuresFromCanonical(completed, authoritative);
        } catch (error) {
          console.warn('削除後の正本照合に失敗:', error);
        }
      }
      const successful = completed.filter(value => value.result.ok).map(value => value.item);
      const failed = completed.filter(value => !value.result.ok).map(value => value.item);
      const successNames = successful.map(item => item.name).filter(Boolean);
      if (successNames.length && typeof _dbRemoveNamesFromCurrentManualOrder === 'function') {
        try {
          _dbRemoveNamesFromCurrentManualOrder(queue.dbPath, successNames);
        } catch (error) {
          console.warn('削除済みエントリの手動並び順更新に失敗:', error);
        }
      }
      if (canonical) {
        liveContexts.slice(1).forEach(ctx => {
          if (ctx.destroyed) return;
          try {
            ctx.pivotData = canonical;
            if (Array.isArray(reloadCtx._lastEntityNames)) ctx._lastEntityNames = [...reloadCtx._lastEntityNames];
            if (typeof _renderCurrentDbView === 'function') _renderCurrentDbView(ctx, queue.dbPath);
            else if (typeof renderPivot === 'function') renderPivot(ctx);
          } catch (error) {
            console.warn('削除後のシート表示反映に失敗:', error);
          }
        });
      } else if (failed.length) {
        try {
          restoreFailedLocally(failed, successNames);
        } catch (error) {
          console.warn('削除失敗行の表示復元に失敗:', error);
        }
      }
      liveContexts.forEach(ctx => {
        if (ctx.destroyed) return;
        try {
          const selectedFailures = failed
            .filter(item => item.snapshots?.some(snapshot => snapshot.ctx === ctx && snapshot.selected))
            .map(item => item.name);
          restoreSelection(ctx, selectedFailures);
          if (typeof _updateBulkEditBar === 'function') _updateBulkEditBar(ctx);
        } catch (error) {
          console.warn('削除後の選択状態復元に失敗:', error);
        }
      });
    } finally {
      completed.forEach(({ item }) => {
        item.deleteKeys.forEach(key => {
          deletingKeys.delete(key);
          if (queue.activeByKey.get(key) === item) queue.activeByKey.delete(key);
        });
      });
    }
  }

  function resolveReadyDeleteRequests(queue) {
    const ready = [...queue.requests].filter(request => request.remaining === 0);
    ready.forEach(request => {
      queue.requests.delete(request);
      const successes = request.results.filter(result => result.ok);
      const failures = request.results.filter(result => !result.ok);
      request.resolve({
        ok: failures.length === 0,
        successes,
        failures,
        responses: successes.map(result => result.response),
        trashRefs: successes.map(result => ({
          name: result.entry.name,
          path: result.entry.path,
          entry_id: result.entry.entryId,
          asset_id: result.entry.assetId || '',
          trash_name: result.response?.trash_name || '',
          trash_root: result.response?.trash_root || '',
        })),
      });
    });
  }

  async function drainDeleteQueue(queue) {
    if (queue.running) return;
    queue.running = true;
    try {
      while (queue.pending.length) {
        const item = queue.pending.shift();
        queue.current = item;
        showDeleteProgress(queue);
        try {
          const response = await performDelete(queue, item);
          settleItem(queue, item, { ok: true, response });
        } catch (error) {
          settleItem(queue, item, { ok: false, error });
        }
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      if (queue.pending.length) {
        queue.running = false;
        return drainDeleteQueue(queue);
      }
      const completed = queue.completed.splice(0);
      await reloadDeleteCycle(queue, completed);
      resolveReadyDeleteRequests(queue);
      if (!queue.pending.length) finishDeleteProgress(queue, completed);
      if (queue.pending.length) hideEntries(queue, queue.pending);
    } finally {
      queue.running = false;
      resolveReadyDeleteRequests(queue);
      if (queue.pending.length) drainDeleteQueue(queue);
      else if (!queue.requests.size && !queue.activeByKey.size) deleteQueues.delete(queue.dbPath);
    }
  }

  function deleteEntries(options) {
    const dbPath = normalize(options?.dbPath);
    if (!dbPath) return Promise.reject(new Error('削除対象のシートが特定できません'));
    const queue = getDeleteQueue(dbPath);
    addQueueContext(queue, options?.ctx);
    const requestEntries = [];
    const seen = new Set();
    (Array.isArray(options?.entries) ? options.entries : []).forEach(rawEntry => {
      const name = String(rawEntry?.name || rawEntry?.entityName || '').trim();
      const path = normalize(rawEntry?.path || rawEntry?.entry_path || entryPath(dbPath, name, options?.ctx?.pivotData));
      const entityData = options?.ctx?.pivotData?.entities?.[name];
      const entryId = String(rawEntry?.entryId || rawEntry?.entry_id || entryIdFromEntity(entityData)).trim();
      const assetId = String(
        rawEntry?.assetId || rawEntry?.asset_id || entityData?.assetId || entityData?.asset_id || '',
      ).trim();
      const identityKeys = deleteKeys({ entry_id: entryId, entry_path: path }, path, dbPath);
      const key = entryId ? `id:${entryId}` : `path:${path}`;
      if (!path || identityKeys.some(identityKey => seen.has(identityKey))) return;
      identityKeys.forEach(identityKey => seen.add(identityKey));
      requestEntries.push({ name: name || entityNameFromPath(path), path, entryId, assetId, key, identityKeys });
    });
    if (!requestEntries.length) {
      return Promise.resolve({ ok: true, successes: [], failures: [], responses: [], trashRefs: [] });
    }
    return new Promise(resolve => {
      const request = { source: options?.source || 'entry-delete', results: [], remaining: requestEntries.length, resolve };
      queue.requests.add(request);
      const pendingItems = [];
      requestEntries.forEach(entry => {
        let item = entry.identityKeys.map(key => queue.activeByKey.get(key)).find(Boolean);
        if (!item) {
          item = {
            ...entry,
            ctx: options?.ctx || null,
            operationId: operationId('entry-delete'),
            confirmationPayload: window.MeldexDeleteImpactWarning?.confirmationPayload?.(options?.confirmation) || {},
            subscribers: [],
          };
          item.deleteKeys = item.identityKeys;
          item.deleteKeys.forEach(key => deletingKeys.add(key));
          item.deleteKeys.forEach(key => queue.activeByKey.set(key, item));
          queue.pending.push(item);
        }
        if (item.completed) {
          request.results.push({ ...item.result, entry });
          request.remaining -= 1;
          return;
        }
        item.subscribers.push({ request, entry });
        pendingItems.push(item);
      });
      hideEntries(queue, pendingItems);
      showDeleteProgress(queue);
      drainDeleteQueue(queue);
    });
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
    deleteEntries,
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
