(function (root, factory) {
  'use strict';
  const contract = root && root.MeldexTopicContract
    ? root.MeldexTopicContract
    : (typeof require === 'function' ? require('./gb-topic-contract.js') : null);
  const api = factory(contract, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MeldexTopicIndexedDB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (contract, root) {
  'use strict';

  if (!contract) throw new Error('gb-topic-contract.js が読み込まれていません');
  const DB_NAME = 'meldex-topic-index-v1';
  const DB_VERSION = 1;
  const STORES = ['topics', 'outbox', 'receipts', 'documentMappings', 'checkpoints'];

  function clone(value) { return contract.clone(value); }
  function refKey(ref) { return contract.topicRefKey(ref); }
  function documentKey(sourceId, documentId) { return JSON.stringify([String(sourceId), String(documentId)]); }
  function nowIso(now) { return new Date(now()).toISOString(); }

  function createMemoryBackend() {
    const stores = Object.fromEntries(STORES.map(name => [name, new Map()]));
    return {
      async get(store, key) { return clone(stores[store].get(key) || null); },
      async put(store, row) { stores[store].set(row.id, clone(row)); },
      async delete(store, key) { return stores[store].delete(key); },
      async all(store) { return Array.from(stores[store].values(), clone); },
      async transaction(storeNames, action) {
        const names = Array.from(new Set(storeNames));
        const snapshots = Object.fromEntries(names.map(name => [name, new Map(
          Array.from(stores[name].entries(), ([key, value]) => [key, clone(value)]),
        )]));
        const tx = {
          async get(store, key) { return clone(stores[store].get(key) || null); },
          async put(store, row) { stores[store].set(row.id, clone(row)); },
          async delete(store, key) { return stores[store].delete(key); },
          async all(store) { return Array.from(stores[store].values(), clone); },
        };
        try {
          return clone(await action(tx));
        } catch (error) {
          for (const name of names) stores[name] = snapshots[name];
          throw error;
        }
      },
      async clear() { for (const store of Object.values(stores)) store.clear(); },
      _stores: stores,
    };
  }

  function createIndexedDbBackend(indexedDb) {
    let dbPromise = null;
    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        if (!indexedDb) return reject(new Error('この端末ではトピック索引を利用できません'));
        const request = indexedDb.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          for (const name of STORES) {
            if (db.objectStoreNames.contains(name)) continue;
            const store = db.createObjectStore(name, { keyPath: 'id' });
            if (name === 'topics') {
              store.createIndex('sourceId', 'sourceId');
              store.createIndex('titleLower', 'titleLower');
            }
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('トピック索引を開けませんでした'));
      });
      return dbPromise;
    }
    async function request(storeName, mode, action) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        let pending;
        try { pending = action(tx.objectStore(storeName)); } catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(pending && pending.result);
        tx.onerror = () => reject(tx.error || (pending && pending.error) || new Error('トピック索引の操作に失敗しました'));
        tx.onabort = () => reject(tx.error || new Error('トピック索引の操作を中断しました'));
      });
    }
    async function transaction(storeNames, action) {
      const db = await open();
      const names = Array.from(new Set(storeNames));
      return new Promise((resolve, reject) => {
        const tx = db.transaction(names, 'readwrite');
        let actionResult;
        let actionError = null;
        const run = (store, method, ...args) => new Promise((yes, no) => {
          let pending;
          try { pending = tx.objectStore(store)[method](...args); } catch (error) { no(error); return; }
          pending.onsuccess = () => yes(pending.result);
          pending.onerror = () => no(pending.error || new Error('トピック索引の操作に失敗しました'));
        });
        const api = {
          get: (store, key) => run(store, 'get', key).then(value => value || null),
          put: (store, row) => run(store, 'put', row).then(() => undefined),
          delete: (store, key) => run(store, 'delete', key).then(() => true),
          all: store => run(store, 'getAll').then(value => value || []),
        };
        Promise.resolve().then(() => action(api)).then(value => {
          actionResult = value;
        }).catch(error => {
          actionError = error;
          try { tx.abort(); } catch (_) { reject(error); }
        });
        tx.oncomplete = () => resolve(clone(actionResult));
        tx.onerror = () => reject(actionError || tx.error || new Error('トピック索引の操作に失敗しました'));
        tx.onabort = () => reject(actionError || tx.error || new Error('トピック索引の操作を中断しました'));
      });
    }
    return {
      get: (store, key) => request(store, 'readonly', target => target.get(key)).then(value => value || null),
      put: (store, row) => request(store, 'readwrite', target => target.put(row)).then(() => undefined),
      delete: (store, key) => request(store, 'readwrite', target => target.delete(key)).then(() => true),
      all: store => request(store, 'readonly', target => target.getAll()).then(value => value || []),
      transaction,
      async clear() { for (const name of STORES) await request(name, 'readwrite', target => target.clear()); },
    };
  }

  class TopicIndexedDbAdapter {
    constructor(options) {
      const opts = options || {};
      this.backend = opts.backend || createIndexedDbBackend(opts.indexedDB || (root && root.indexedDB));
      this.now = opts.now || Date.now;
    }

    async putTopic(topicRef, record, metadata) {
      const row = makeTopicRow(topicRef, record, metadata, this.now);
      await this.backend.put('topics', row);
      return clone(row);
    }

    async getTopic(topicRef) { return this.backend.get('topics', refKey(topicRef)); }
    async deleteTopic(topicRef) { return this.backend.delete('topics', refKey(topicRef)); }

    async queryTopics(query) {
      const options = query || {};
      const sourceIds = options.sourceIds ? new Set(options.sourceIds.map(String)) : null;
      const text = String(options.text || '').trim().toLocaleLowerCase();
      const where = options.where || {};
      let rows = await this.backend.all('topics');
      rows = rows.filter(row => (!sourceIds || sourceIds.has(row.sourceId))
        && (!text || row.searchable.includes(text)) && propertiesMatch(row.record.properties, where));
      const sortBy = options.sortBy || 'title';
      const direction = options.direction === 'desc' ? -1 : 1;
      rows.sort((a, b) => compareValues(sortValue(a, sortBy), sortValue(b, sortBy)) * direction
        || a.id.localeCompare(b.id));
      const offset = Math.max(0, Number(options.offset) || 0);
      const limit = Math.max(0, Number(options.limit) || rows.length);
      return clone(rows.slice(offset, offset + limit));
    }

    async applyLocalMutation(topicRef, mutation) {
      const ref = contract.normalizeTopicRef(topicRef);
      const item = contract.normalizeMutation(Object.assign({}, mutation, { topicRef: ref }));
      const priorReceipt = await this.getReceipt(item.mutationId);
      if (priorReceipt && priorReceipt.localApplied) {
        return { duplicate: true, row: await this.getTopic(ref), receipt: priorReceipt };
      }
      const current = await this.getTopic(ref);
      const currentRevision = current ? current.record.revision : null;
      if (item.baseRevision !== currentRevision) throw casError(item.baseRevision, currentRevision, current);
      const baseRecord = current ? clone(current.record) : null;
      const seed = baseRecord || { topicId: ref.topicId, title: '', revision: 0 };
      const next = Object.assign({}, seed, clone(item.changes));
      next.topicId = ref.topicId;
      next.revision = nextRevision(currentRevision);
      const row = await this.putTopic(ref, next, current ? current.metadata : {});
      await this.putReceipt(item.mutationId, {
        mutationId: item.mutationId, topicRef: ref, localApplied: true, remoteApplied: false,
        mutation: item, baseRecord, appliedAt: nowIso(this.now),
      });
      return { duplicate: false, row, baseRecord, mutation: item };
    }

    async enqueueMutation(topicRef, mutation, baseRecord) {
      const ref = contract.normalizeTopicRef(topicRef);
      const item = contract.normalizeMutation(Object.assign({}, mutation, { topicRef: ref }));
      const receipt = await this.getReceipt(item.mutationId);
      if (receipt && receipt.remoteApplied) return { duplicate: true, receipt };
      const id = refKey(ref);
      const storedPrevious = await this.backend.get('outbox', id);
      // A terminal row is retained only as a durable error receipt.  A fresh
      // user edit starts a new queue chain from the now-restored canonical
      // snapshot instead of coalescing with the rejected mutation.
      const previous = storedPrevious && !storedPrevious.terminal ? storedPrevious : null;
      const row = {
        id, topicRef: ref, mutation: item,
        baseRecord: previous ? previous.baseRecord : clone(baseRecord),
        supersededMutationIds: previous
          ? [...(previous.supersededMutationIds || []), previous.mutation.mutationId]
          : [],
        attempts: previous ? previous.attempts : 0,
        queuedAt: previous ? previous.queuedAt : nowIso(this.now),
      };
      if (previous) {
        row.mutation.baseRevision = previous.mutation.baseRevision;
        const changes = Object.assign({}, previous.mutation.changes, item.changes);
        if (previous.mutation.changes && item.changes
          && isObject(previous.mutation.changes.properties)
          && isObject(item.changes.properties)) {
          changes.properties = Object.assign(
            {}, previous.mutation.changes.properties, item.changes.properties,
          );
        }
        row.mutation.changes = changes;
      }
      await this.backend.put('outbox', row);
      return clone(row);
    }

    async recoverPendingLocalMutations() {
      const receipts = await this.backend.all('receipts');
      let recovered = 0;
      for (const receipt of receipts) {
        if (!receipt.localApplied || receipt.remoteApplied || receipt.failed || receipt.conflict
          || !receipt.mutation || !receipt.topicRef) continue;
        const current = await this.backend.get('outbox', refKey(receipt.topicRef));
        if (current) continue;
        await this.enqueueMutation(receipt.topicRef, receipt.mutation, receipt.baseRecord);
        recovered += 1;
      }
      return recovered;
    }

    async listOutbox(options) {
      const includeTerminal = !!(options && options.includeTerminal);
      const rows = await this.backend.all('outbox');
      const filtered = includeTerminal ? rows : rows.filter(row => !row.terminal);
      filtered.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.id.localeCompare(b.id));
      return clone(filtered);
    }
    async getOutbox(topicRef) { return this.backend.get('outbox', refKey(topicRef)); }
    async updateOutbox(row) { await this.backend.put('outbox', clone(row)); }
    async updateOutboxIfCurrent(row) {
      const current = await this.getOutbox(row.topicRef);
      if (!sameOutboxGeneration(current, row)) {
        return { updated: false, current: clone(current) };
      }
      await this.updateOutbox(row);
      return { updated: true, current: clone(row) };
    }

    async prepareOutboxAttempt(outboxRow) {
      const row = clone(outboxRow);
      const current = await this.getOutbox(row.topicRef);
      if (!sameOutboxGeneration(current, row)) {
        return { prepared: false, current: clone(current) };
      }
      row.attempts = (current.attempts || 0) + 1;
      await this.updateOutbox(row);
      return { prepared: true, row: clone(row) };
    }
    async removeOutbox(topicRef) { return this.backend.delete('outbox', refKey(topicRef)); }

    async removeOutboxIfCurrent(outboxRow) {
      const current = await this.getOutbox(outboxRow.topicRef);
      if (!sameOutboxGeneration(current, outboxRow)) {
        return { removed: false, current: clone(current) };
      }
      await this.removeOutbox(outboxRow.topicRef);
      return { removed: true, current: null };
    }

    async rebaseOutboxAfterConflict(outboxRow, record, remoteRecord) {
      const row = clone(outboxRow);
      return this.backend.transaction(['topics', 'outbox'], async tx => {
        const queued = await tx.get('outbox', refKey(row.topicRef));
        if (!sameOutboxGeneration(queued, row)) {
          return { updated: false, current: clone(queued) };
        }
        const local = await tx.get('topics', refKey(row.topicRef));
        await tx.put('topics', makeTopicRow(
          row.topicRef, record, local ? local.metadata : {}, this.now,
        ));
        row.baseRecord = clone(remoteRecord);
        row.mutation.baseRevision = remoteRecord.revision;
        row.attempts = 0;
        await tx.put('outbox', row);
        return { updated: true, current: clone(row), record: clone(record) };
      });
    }

    async markConflictIfCurrent(outboxRow, record, detail) {
      const row = clone(outboxRow);
      const ids = [...(row.supersededMutationIds || []), row.mutation.mutationId];
      return this.backend.transaction(['topics', 'outbox', 'receipts'], async tx => {
        const queued = await tx.get('outbox', refKey(row.topicRef));
        if (!sameOutboxGeneration(queued, row)) {
          return { recorded: false, current: clone(queued) };
        }
        const local = await tx.get('topics', refKey(row.topicRef));
        await tx.put('topics', makeTopicRow(
          row.topicRef, record, local ? local.metadata : {}, this.now,
        ));
        await tx.delete('outbox', refKey(row.topicRef));
        for (const mutationId of ids) {
          await mergeReceiptInTransaction(tx, mutationId, {
            mutationId, topicRef: row.topicRef, localApplied: true, remoteApplied: false,
            conflict: true, error: clone(detail), completedAt: nowIso(this.now),
          });
        }
        return { recorded: true, current: null, record: clone(record) };
      });
    }

    async getTerminalFailure(topicRef) {
      const row = await this.backend.get('outbox', refKey(topicRef));
      return row && row.terminal ? clone(row.terminalError || null) : null;
    }

    async listTerminalFailures() {
      const rows = await this.backend.all('outbox');
      return clone(rows.filter(row => row.terminal && row.terminalError)
        .map(row => row.terminalError));
    }

    async markTerminalFailure(outboxRow, detail) {
      const row = clone(outboxRow);
      const ids = [...(row.supersededMutationIds || []), row.mutation.mutationId];
      return this.backend.transaction(['topics', 'outbox', 'receipts'], async tx => {
        const queued = await tx.get('outbox', refKey(row.topicRef));
        const current = await tx.get('topics', refKey(row.topicRef));
        if (!sameOutboxGeneration(queued, row)) {
          for (const mutationId of ids) {
            await mergeReceiptInTransaction(tx, mutationId, {
              mutationId, topicRef: row.topicRef, localApplied: true, remoteApplied: false,
              lastAttemptFailed: true, lastError: clone(detail), lastAttemptAt: nowIso(this.now),
            });
          }
          return {
            row: clone(queued), record: clone(current && current.record),
            rolledBack: false, supersededByNewer: true,
          };
        }
        if (row.baseRecord) {
          await tx.put('topics', makeTopicRow(
            row.topicRef, row.baseRecord, current ? current.metadata : {}, this.now,
          ));
        } else {
          await tx.delete('topics', refKey(row.topicRef));
        }
        row.terminal = true;
        row.terminalError = clone(detail);
        row.failedAt = nowIso(this.now);
        await tx.put('outbox', row);
        for (const mutationId of ids) {
          await mergeReceiptInTransaction(tx, mutationId, {
            mutationId, topicRef: row.topicRef, localApplied: true, remoteApplied: false,
            failed: true, error: clone(detail), completedAt: nowIso(this.now),
          });
        }
        return {
          row: clone(row), record: clone(row.baseRecord),
          rolledBack: true, supersededByNewer: false,
        };
      });
    }

    async _markAttemptError(outboxRow, detail) {
      const ids = [...(outboxRow.supersededMutationIds || []), outboxRow.mutation.mutationId];
      for (const mutationId of ids) {
        await this.putReceipt(mutationId, {
          mutationId, topicRef: outboxRow.topicRef, localApplied: true, remoteApplied: false,
          lastAttemptFailed: true, lastError: clone(detail), lastAttemptAt: nowIso(this.now),
        });
      }
    }

    async getReceipt(mutationId) { return this.backend.get('receipts', String(mutationId)); }
    async putReceipt(mutationId, receipt) {
      const current = await this.getReceipt(mutationId);
      const row = Object.assign({}, current || {}, clone(receipt), { id: String(mutationId) });
      await this.backend.put('receipts', row);
      return clone(row);
    }

    async markRemoteApplied(outboxRow, response) {
      const ids = [...(outboxRow.supersededMutationIds || []), outboxRow.mutation.mutationId];
      const remoteRecord = responseRecord(outboxRow, response);
      return this.backend.transaction(['topics', 'outbox', 'receipts', 'checkpoints'], async tx => {
        for (const mutationId of ids) {
          await mergeReceiptInTransaction(tx, mutationId, {
            mutationId, topicRef: outboxRow.topicRef, localApplied: true, remoteApplied: true,
            remoteRevision: remoteRecord.revision, completedAt: nowIso(this.now),
          });
        }
        const queued = await tx.get('outbox', refKey(outboxRow.topicRef));
        const supersededByNewer = !sameOutboxGeneration(queued, outboxRow);
        let current = queued;
        let record;
        if (!supersededByNewer) {
          const local = await tx.get('topics', refKey(outboxRow.topicRef));
          await tx.put('topics', makeTopicRow(
            outboxRow.topicRef, remoteRecord, local ? local.metadata : {}, this.now,
          ));
          await tx.delete('outbox', refKey(outboxRow.topicRef));
          current = null;
          record = remoteRecord;
        } else {
          const local = await tx.get('topics', refKey(outboxRow.topicRef));
          record = local && local.record;
          if (queued && !queued.terminal) {
            current = clone(queued);
            current.baseRecord = clone(remoteRecord);
            current.mutation.baseRevision = remoteRecord.revision;
            current.attempts = 0;
            await tx.put('outbox', current);
          }
        }
        const checkpoint = {
          id: String(outboxRow.topicRef.sourceId), sourceId: String(outboxRow.topicRef.sourceId),
          value: {
            mutationId: outboxRow.mutation.mutationId, topicRef: clone(outboxRow.topicRef),
            revision: remoteRecord.revision,
          },
          completedAt: nowIso(this.now),
        };
        await tx.put('checkpoints', checkpoint);
        return {
          checkpoint, supersededByNewer, current: clone(current), record: clone(record),
        };
      });
    }

    async recordCheckpoint(sourceId, value) {
      const row = { id: String(sourceId), sourceId: String(sourceId), value: clone(value), completedAt: nowIso(this.now) };
      await this.backend.put('checkpoints', row);
      return clone(row);
    }
    async getCheckpoint(sourceId) { return this.backend.get('checkpoints', String(sourceId)); }

    async putDocumentMapping(sourceId, documentId, mapping) {
      const row = { id: documentKey(sourceId, documentId), sourceId: String(sourceId), documentId: String(documentId), mapping: clone(mapping) };
      await this.backend.put('documentMappings', row);
      return clone(row);
    }
    async getDocumentMapping(sourceId, documentId) {
      return this.backend.get('documentMappings', documentKey(sourceId, documentId));
    }
  }

  function makeTopicRow(topicRef, record, metadata, now) {
    const ref = contract.normalizeTopicRef(topicRef);
    const normalized = contract.normalizeTopicRecord(record);
    if (ref.topicId !== normalized.topicId) {
      throw new Error('TopicRef.topicId と TopicRecord.topicId が一致しません');
    }
    return {
      id: refKey(ref), sourceId: ref.sourceId, topicId: ref.topicId, topicRef: ref,
      record: normalized, titleLower: normalized.title.toLocaleLowerCase(),
      searchable: searchableText(normalized), metadata: clone(metadata || {}), updatedAt: nowIso(now),
    };
  }

  async function mergeReceiptInTransaction(tx, mutationId, receipt) {
    const id = String(mutationId);
    const current = await tx.get('receipts', id);
    const row = Object.assign({}, current || {}, clone(receipt), { id });
    await tx.put('receipts', row);
    return row;
  }

  function searchableText(record) {
    const values = [record.title];
    const walk = (value) => {
      if (value == null) return;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values.push(String(value));
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(record.properties);
    return values.join('\u0000').toLocaleLowerCase();
  }

  function propertiesMatch(properties, where) {
    return Object.entries(where).every(([key, expected]) => {
      const actual = properties && properties[key];
      return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
    });
  }

  function sortValue(row, sortBy) {
    if (sortBy.startsWith('properties.')) return row.record.properties[sortBy.slice(11)];
    return row.record[sortBy];
  }
  function compareValues(left, right) {
    if (left === right) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return String(left).localeCompare(String(right));
  }
  function nextRevision(current) { return Number.isInteger(current) ? current + 1 : 1; }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function sameOutboxGeneration(left, right) {
    return !!left && !!right && !!left.mutation && !!right.mutation
      && left.mutation.mutationId === right.mutation.mutationId;
  }
  function responseRecord(outboxRow, response) {
    if (response && response.record) return contract.normalizeTopicRecord(response.record);
    const seed = clone(outboxRow.baseRecord) || {
      topicId: outboxRow.topicRef.topicId, title: '', properties: {}, resources: [], revision: 0,
    };
    const record = Object.assign({}, seed, clone(outboxRow.mutation.changes || {}));
    record.topicId = outboxRow.topicRef.topicId;
    if (response && response.revision !== undefined) record.revision = response.revision;
    return contract.normalizeTopicRecord(record);
  }
  function casError(expected, current, row) {
    const error = new Error('TOPIC_CAS_CONFLICT');
    error.name = 'TopicCasConflict';
    error.expectedRevision = expected;
    error.currentRevision = current;
    error.current = clone(row);
    return error;
  }

  return Object.freeze({ DB_NAME, DB_VERSION, TopicIndexedDbAdapter, createIndexedDbBackend, createMemoryBackend });
});
