(function (root, factory) {
  'use strict';
  const contract = root && root.MeldexTopicContract
    ? root.MeldexTopicContract
    : (typeof require === 'function' ? require('./gb-topic-contract.js') : null);
  const indexed = root && root.MeldexTopicIndexedDB
    ? root.MeldexTopicIndexedDB
    : (typeof require === 'function' ? require('./gb-topic-indexeddb.js') : null);
  const api = factory(contract, indexed, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MeldexTopicStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (contract, indexed, root) {
  'use strict';

  if (!contract || !indexed) throw new Error('トピック契約とIndexedDBアダプターが必要です');
  const fallbackTopicLocks = new Map();

  class TopicStore {
    constructor(options) {
      const opts = options || {};
      this.index = opts.index || new indexed.TopicIndexedDbAdapter(opts.indexOptions);
      this.provider = opts.provider || null;
      this.mutationBus = opts.mutationBus || (root && root.MeldexMutationBus) || null;
      this.scheduler = opts.scheduler || (callback => setTimeout(callback, 0));
      this.sourceStates = new Map();
      this.listeners = new Set();
      this.syncScheduled = false;
      this.syncPromise = Promise.resolve();
      this.lastErrors = new Map();
      if (this.provider) this.scheduleSync();
    }

    setProvider(provider) {
      this.provider = provider || null;
      this.scheduleSync();
    }

    setSourceConnected(sourceId, connected) {
      this.sourceStates.set(String(sourceId), !!connected);
      if (connected) this.scheduleSync();
    }

    async isSourceConnected(sourceId) {
      const key = String(sourceId);
      if (this.sourceStates.has(key)) return this.sourceStates.get(key);
      if (!this.provider) return false;
      if (typeof this.provider.isSourceConnected === 'function') {
        return !!(await this.provider.isSourceConnected(key));
      }
      return true;
    }

    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    async loadSnapshot(topicRef, record, options) {
      const ref = contract.normalizeTopicRef(topicRef);
      const row = await this.index.putTopic(ref, record, Object.assign({}, options || {}, { snapshot: true }));
      this._notify('topic', { action: 'snapshot', topicRef: ref, record: row.record });
      return clone(row.record);
    }

    async getTopic(topicRef) {
      const ref = contract.normalizeTopicRef(topicRef);
      const row = await this.index.getTopic(ref);
      if (!row) return null;
      const connected = await this.isSourceConnected(ref.sourceId);
      const durableError = await this.index.getTerminalFailure?.(ref);
      return {
        topicRef: clone(ref), record: clone(row.record), readOnly: !connected,
        sourceState: connected ? 'connected' : 'snapshot',
        syncError: clone(this.lastErrors.get(contract.topicRefKey(ref)) || durableError || null),
      };
    }

    queryTopics(query) { return this.index.queryTopics(query); }

    async mutateTopic(topicRef, mutation, options) {
      const ref = contract.normalizeTopicRef(topicRef);
      if (!(await this.isSourceConnected(ref.sourceId))) {
        const error = new Error('SOURCE_DISCONNECTED_READ_ONLY');
        error.name = 'SourceDisconnectedReadOnly';
        error.topicRef = ref;
        throw error;
      }
      return this._withTopicLock(ref, async () => {
        const applied = await this.index.applyLocalMutation(ref, mutation);
        if (applied.duplicate) return { duplicate: true, record: clone(applied.row && applied.row.record) };
        await this.index.enqueueMutation(ref, applied.mutation, applied.baseRecord);
        this.lastErrors.delete(contract.topicRefKey(ref));
        this._notify('topic', {
          action: 'changed', topicRef: ref, mutation: applied.mutation, record: applied.row.record,
          origin: options && options.origin,
        });
        this.scheduleSync();
        return { duplicate: false, record: clone(applied.row.record), syncScheduled: true };
      });
    }

    scheduleSync() {
      if (this.syncScheduled || !this.provider) return;
      this.syncScheduled = true;
      this.scheduler(() => {
        this.syncScheduled = false;
        this.syncPromise = this.syncPromise.then(() => this._drainOutbox()).catch(error => {
          this._notify('topic', { action: 'sync-runner-error', error: serializableError(error) });
        });
      });
    }

    async flush() {
      this.syncScheduled = false;
      this.syncPromise = this.syncPromise.then(() => this._drainOutbox());
      return this.syncPromise;
    }

    async getSyncStatus() {
      const outbox = await this.index.listOutbox();
      const durable = await this.index.listTerminalFailures?.() || [];
      const errors = new Map(durable.map(error => [contract.topicRefKey(error.topicRef), error]));
      for (const error of this.lastErrors.values()) errors.set(contract.topicRefKey(error.topicRef), error);
      return { pendingCount: outbox.length, errors: clone(Array.from(errors.values())) };
    }

    async putDocumentMapping(sourceId, documentId, mapping) {
      const result = await this.index.putDocumentMapping(sourceId, documentId, mapping);
      this._notify('topic-view', { action: 'mapping-changed', sourceId, documentId, mapping: clone(mapping) });
      return result;
    }

    async _drainOutbox() {
      await this.index.recoverPendingLocalMutations?.();
      if (!this.provider) return { processed: 0, pending: (await this.index.listOutbox()).length };
      let processed = 0;
      const queued = await this.index.listOutbox();
      for (const row of queued) {
        if (!(await this.isSourceConnected(row.topicRef.sourceId))) continue;
        const result = await this._sendRow(row);
        if (result === 'success' || result === 'conflict' || result === 'failed') processed += 1;
      }
      return { processed, pending: (await this.index.listOutbox()).length };
    }

    async _sendRow(row) {
      const prepared = await this._withTopicLock(row.topicRef, () => this.index.prepareOutboxAttempt(row));
      if (!prepared.prepared) {
        if (prepared.current && !prepared.current.terminal) this.scheduleSync();
        return 'pending';
      }
      row = prepared.row;
      try {
        const response = await providerApply(this.provider, row);
        await this._acceptRemoteSuccess(row, response || {});
        return 'success';
      } catch (error) {
        if (isConflict(error)) return this._handleConflict(row, error);
        const detail = syncError(row.topicRef, error, isRetryable(error) ? 'retryable' : 'failed');
        this.lastErrors.set(contract.topicRefKey(row.topicRef), detail);
        if (!isRetryable(error)) {
          await this._finishTerminalFailure(row, detail);
        } else {
          this._notify('topic', { action: 'sync-error', topicRef: row.topicRef, error: detail });
        }
        return isRetryable(error) ? 'pending' : 'failed';
      }
    }

    async _acceptRemoteSuccess(row, response) {
      const outcome = await this._withTopicLock(
        row.topicRef, () => this.index.markRemoteApplied(row, response),
      );
      this.lastErrors.delete(contract.topicRefKey(row.topicRef));
      this._notify('topic', {
        action: 'synced', topicRef: row.topicRef, mutationId: row.mutation.mutationId,
        record: outcome.record, newerChangePending: !!outcome.supersededByNewer,
      });
      if (outcome.supersededByNewer) this.scheduleSync();
    }

    async _handleConflict(row, error) {
      const remote = error.currentRecord || await providerRead(this.provider, row.topicRef);
      if (!remote) {
        const detail = syncError(row.topicRef, error, 'conflict');
        this.lastErrors.set(contract.topicRefKey(row.topicRef), detail);
        await this._finishTerminalFailure(row, detail);
        return 'conflict';
      }
      const prepared = await this._withTopicLock(row.topicRef, async () => {
        const queued = await this.index.getOutbox(row.topicRef);
        if (!sameOutboxGeneration(queued, row)) {
          if (!queued || queued.terminal) return { supersededByNewer: true };
          const localRow = await this.index.getTopic(row.topicRef);
          const outcome = mergeRemote(
            queued.baseRecord, localRow && localRow.record, remote, queued.mutation.changes,
          );
          if (outcome.conflicts.length) {
            const detail = conflictDetail(queued, outcome.conflicts);
            const recorded = await this.index.markConflictIfCurrent(queued, outcome.record, detail);
            return recorded.recorded
              ? { conflict: true, detail, record: outcome.record }
              : { supersededByNewer: true };
          }
          const rebased = await this.index.rebaseOutboxAfterConflict(
            queued, outcome.record, remote,
          );
          return rebased.updated
            ? { row: rebased.current, supersededOldRequest: true }
            : { supersededByNewer: true };
        }
        const localRow = await this.index.getTopic(row.topicRef);
        const outcome = mergeRemote(row.baseRecord, localRow && localRow.record, remote, row.mutation.changes);
        if (outcome.conflicts.length) {
          const detail = conflictDetail(row, outcome.conflicts);
          const recorded = await this.index.markConflictIfCurrent(row, outcome.record, detail);
          return recorded.recorded
            ? { conflict: true, detail, record: outcome.record }
            : { supersededByNewer: true };
        }
        const rebased = await this.index.rebaseOutboxAfterConflict(row, outcome.record, remote);
        return rebased.updated ? { row: rebased.current } : { supersededByNewer: true };
      });
      if (prepared.supersededByNewer) {
        this.scheduleSync();
        return 'pending';
      }
      if (prepared.conflict) {
        this.lastErrors.set(contract.topicRefKey(row.topicRef), prepared.detail);
        this._notify('topic', {
          action: 'conflict', topicRef: row.topicRef, error: prepared.detail, record: prepared.record,
        });
        return 'conflict';
      }
      row = prepared.row;
      try {
        const response = await providerApply(this.provider, row);
        await this._acceptRemoteSuccess(row, response || {});
        return 'success';
      } catch (retryError) {
        const detail = syncError(row.topicRef, retryError, isRetryable(retryError) ? 'retryable' : 'failed');
        this.lastErrors.set(contract.topicRefKey(row.topicRef), detail);
        if (!isRetryable(retryError)) await this._finishTerminalFailure(row, detail);
        else this._notify('topic', { action: 'sync-error', topicRef: row.topicRef, error: detail });
        return isRetryable(retryError) ? 'pending' : 'failed';
      }
    }

    async _finishTerminalFailure(row, detail) {
      const outcome = await this._withTopicLock(
        row.topicRef, () => this.index.markTerminalFailure(row, detail),
      );
      if (outcome.rolledBack) {
        this._notify('topic', {
          action: 'rollback', topicRef: row.topicRef, error: detail, record: outcome.record,
        });
      } else if (outcome.supersededByNewer) {
        this.scheduleSync();
      }
      this._notify('topic', {
        action: 'sync-error', topicRef: row.topicRef, error: detail,
        record: outcome.record, newerChangePending: !!outcome.supersededByNewer,
      });
      return outcome;
    }

    async _withTopicLock(topicRef, work) {
      const key = contract.topicRefKey(topicRef);
      const webLocks = root && root.navigator && root.navigator.locks;
      if (webLocks && typeof webLocks.request === 'function') {
        return webLocks.request(`meldex-topic:${encodeURIComponent(key)}`, work);
      }
      const previous = fallbackTopicLocks.get(key) || Promise.resolve();
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const tail = previous.catch(() => undefined).then(() => gate);
      fallbackTopicLocks.set(key, tail);
      await previous.catch(() => undefined);
      try {
        return await work();
      } finally {
        release();
        if (fallbackTopicLocks.get(key) === tail) fallbackTopicLocks.delete(key);
      }
    }

    _notify(scope, payload) {
      const event = Object.assign({ scope, at: new Date().toISOString() }, clone(payload));
      for (const listener of this.listeners) {
        try { listener(event); } catch (_) { /* consumer failures must not block persistence */ }
      }
      const bus = this.mutationBus;
      if (!bus) return;
      try {
        if (typeof bus.publish === 'function') bus.publish(event);
        else if (typeof bus.emit === 'function') bus.emit(scope, event);
        else if (typeof bus.dispatch === 'function') bus.dispatch(scope, event);
      } catch (_) { /* notification is best-effort; persistence remains authoritative */ }
    }
  }

  async function providerApply(provider, row) {
    const request = {
      sourceId: row.topicRef.sourceId, topicId: row.topicRef.topicId,
      path: contract.sourceRecordPath(row.topicRef.topicId), topicRef: clone(row.topicRef),
      mutation: clone(row.mutation),
    };
    if (typeof provider.applyTopicMutation === 'function') return provider.applyTopicMutation(request);
    if (typeof provider.patchTopic === 'function') return provider.patchTopic(request);
    if (typeof provider.writeJsonMerged === 'function') {
      let written = null;
      await provider.writeJsonMerged(request.path, (current) => {
        const existing = current && current.topicId ? contract.normalizeTopicRecord(current) : null;
        const currentRevision = existing ? existing.revision : null;
        if (currentRevision !== request.mutation.baseRevision) {
          throw providerConflict(request.mutation.baseRevision, existing);
        }
        written = Object.assign(
          {}, existing || { topicId: request.topicId, title: '', revision: 0 },
          clone(request.mutation.changes),
        );
        written.topicId = request.topicId;
        written.revision = Number.isInteger(currentRevision) ? currentRevision + 1 : 1;
        written = contract.normalizeTopicRecord(written);
        return written;
      }, { fallbackValue: null });
      return { revision: written.revision, record: written };
    }
    throw new Error('provider does not implement applyTopicMutation');
  }

  async function providerRead(provider, topicRef) {
    const request = {
      sourceId: topicRef.sourceId, topicId: topicRef.topicId,
      path: contract.sourceRecordPath(topicRef.topicId), topicRef: clone(topicRef),
    };
    if (typeof provider.getTopic === 'function') return provider.getTopic(request);
    if (typeof provider.readTopic === 'function') return provider.readTopic(request);
    if (typeof provider.readJson === 'function') return provider.readJson(request.path, null);
    return null;
  }

  function providerConflict(expectedRevision, currentRecord) {
    const error = new Error('TOPIC_CAS_CONFLICT');
    error.name = 'TopicCasConflict';
    error.status = 409;
    error.expectedRevision = expectedRevision;
    error.currentRecord = clone(currentRecord);
    return error;
  }

  function conflictDetail(row, fields) {
    return {
      kind: 'conflict', topicRef: clone(row.topicRef), mutationId: row.mutation.mutationId,
      message: '同じ項目が別の場所でも変更されています', fields: clone(fields),
    };
  }

  function mergeRemote(base, local, remote, changes) {
    const result = Object.assign({}, clone(remote));
    const conflicts = [];
    for (const [field, localValue] of Object.entries(changes || {})) {
      const baseValue = base ? base[field] : undefined;
      const remoteValue = remote[field];
      if (same(remoteValue, baseValue) || same(remoteValue, localValue)) result[field] = clone(localValue);
      else {
        conflicts.push({ field, baseValue: clone(baseValue), localValue: clone(localValue), remoteValue: clone(remoteValue) });
        result[field] = clone(localValue);
      }
    }
    result.topicId = remote.topicId || (local && local.topicId);
    if (conflicts.length) result._meldexSyncConflicts = clone(conflicts);
    return { record: contract.normalizeTopicRecord(result), conflicts };
  }

  function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
  function sameOutboxGeneration(left, right) {
    return !!left && !!right && !!left.mutation && !!right.mutation
      && left.mutation.mutationId === right.mutation.mutationId;
  }
  function isConflict(error) { return !!error && (error.status === 409 || error.code === 'CAS_CONFLICT' || error.name === 'TopicCasConflict'); }
  function isRetryable(error) {
    if (!error) return false;
    if (typeof error.retryable === 'boolean') return error.retryable;
    return error.name === 'NetworkError' || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  function syncError(topicRef, error, kind) {
    return { kind, topicRef: clone(topicRef), message: String(error && error.message || error || '同期に失敗しました'), status: error && error.status };
  }
  function serializableError(error) { return { name: error && error.name, message: String(error && error.message || error) }; }
  function clone(value) { return contract.clone(value); }
  function createTopicStore(options) { return new TopicStore(options); }

  return Object.freeze({ TopicStore, createTopicStore, mergeRemote });
});
