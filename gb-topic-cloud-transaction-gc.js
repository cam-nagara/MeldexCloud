(function initMeldexTopicCloudTransactionGc(global) {
  'use strict';

  const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const MAX_COMMITTED = 2048;

  function emptyIndex() {
    return { schemaVersion: 1, entries: {}, updatedAt: null };
  }

  function create(options) {
    const indexPath = options.indexPath;

    async function record(storage, token, operationId, status, now) {
      return options.casJson(storage, indexPath, emptyIndex(), (current) => {
        const entries = { ...(current.entries || {}) };
        entries[token] = { ...(entries[token] || {}), token, operationId, status,
          updatedAt: now, ...(status === 'committed' ? { committedAt: now } : {}) };
        return { schemaVersion: 1, entries, updatedAt: now };
      });
    }

    async function deleteOptional(storage, path) {
      if (!await storage.statPath(path)) return;
      await storage.deletePath(path);
    }

    async function collect(storage, now) {
      const index = await options.optionalJson(storage, indexPath, emptyIndex());
      const committed = Object.values(index.entries || {}).filter(item => item?.status === 'committed')
        .sort((left, right) => Number(right.committedAt || 0) - Number(left.committedAt || 0));
      const expired = committed.filter((item, position) => position >= MAX_COMMITTED
        || now - Number(item.committedAt || 0) > RETENTION_MS);
      const removed = [];
      for (const item of expired) {
        try {
          await deleteOptional(storage, options.preparedPath(item.token));
          await deleteOptional(storage, options.receiptPath(item.operationId));
          removed.push(item.token);
        } catch (reason) {
          global.console?.warn?.('トピック操作履歴のGCを再試行します', reason);
        }
      }
      if (!removed.length) return { removed: 0, retained: committed.length };
      await options.casJson(storage, indexPath, emptyIndex(), (current) => {
        const entries = { ...(current.entries || {}) };
        removed.forEach((token) => {
          if (entries[token]?.status === 'committed') delete entries[token];
        });
        return { ...current, entries, updatedAt: now };
      });
      return { removed: removed.length, retained: committed.length - removed.length };
    }

    return Object.freeze({ record, collect });
  }

  global.MeldexTopicCloudTransactionGC = Object.freeze({
    create, emptyIndex, RETENTION_MS, MAX_COMMITTED,
  });
})(typeof window !== 'undefined' ? window : globalThis);
