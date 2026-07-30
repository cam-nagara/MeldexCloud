/* Durable local snapshots and raw records for editable standalone apps. */
(function () {
  'use strict';

  const DB_NAME = 'meldex-standalone-local-v1';
  const DB_VERSION = 1;
  const SNAPSHOTS = 'snapshots';
  const RAW = 'raw';
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('この端末では端末内保存を利用できません'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SNAPSHOTS)) {
          const store = db.createObjectStore(SNAPSHOTS, { keyPath: 'id' });
          store.createIndex('appUpdated', ['appId', 'updatedAt']);
        }
        if (!db.objectStoreNames.contains(RAW)) db.createObjectStore(RAW, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('端末内保存を開けませんでした'));
    });
    return dbPromise;
  }

  async function transaction(storeName, mode, action) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try { result = action(store); }
      catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error || result?.error || new Error('端末内保存に失敗しました'));
      tx.onabort = () => reject(tx.error || new Error('端末内保存を中断しました'));
    });
  }

  function contextKey() {
    const status = window.MeldexStandaloneCloud?.getStatus?.() || {};
    const root = window.MeldexStandaloneCloud?.getActiveRoot?.() || {};
    return [status.provider || '', status.accountId || status.account_id || '', root.id || root.path || '']
      .map(value => String(value || '')).join('|');
  }

  function newId(prefix) {
    const value = crypto.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    return `${prefix}_${value}`;
  }

  async function putRaw(key, value) {
    await transaction(RAW, 'readwrite', store => store.put({
      key: String(key), value: structuredClone(value), updatedAt: new Date().toISOString(),
    }));
    return true;
  }

  async function getRaw(key, fallback) {
    const row = await transaction(RAW, 'readonly', store => store.get(String(key)));
    return row ? structuredClone(row.value) : fallback;
  }

  async function putSnapshot(record) {
    await transaction(SNAPSHOTS, 'readwrite', store => store.put(structuredClone(record)));
    return record;
  }

  async function getSnapshot(id) {
    return transaction(SNAPSHOTS, 'readonly', store => store.get(String(id)));
  }

  async function deleteSnapshot(id) {
    await transaction(SNAPSHOTS, 'readwrite', store => store.delete(String(id)));
  }

  async function listApp(appId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SNAPSHOTS, 'readonly');
      const request = tx.objectStore(SNAPSHOTS).getAll();
      request.onsuccess = () => resolve((request.result || [])
        .filter(row => row.appId === appId)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
      request.onerror = () => reject(request.error);
    });
  }

  function create(options) {
    const opts = options || {};
    if (!opts.appId || typeof opts.capture !== 'function') {
      throw new Error('端末内保存の初期化情報が不足しています');
    }
    const state = {
      timer: 0,
      saving: false,
      syncing: false,
      localId: '',
      started: false,
    };

    function path() {
      return String(opts.getPath?.() || '').replace(/\\/g, '/');
    }

    function recordId() {
      if (path()) return `${opts.appId}:path:${path()}`;
      if (!state.localId) state.localId = newId(`${opts.appId}_local`);
      return `${opts.appId}:local:${state.localId}`;
    }

    function status(value, detail) {
      opts.onStatus?.(value, detail || '');
      window.dispatchEvent(new CustomEvent('meldex:standalone-local-status', {
        detail: { appId: opts.appId, status: value, message: detail || '' },
      }));
    }

    async function saveNow() {
      if (state.saving) return false;
      state.saving = true;
      status('saving', '端末に保存中…');
      try {
        const snapshot = await opts.capture();
        const existing = await getSnapshot(recordId()).catch(() => null);
        const now = new Date().toISOString();
        const record = {
          id: recordId(),
          appId: opts.appId,
          formatVersion: 1,
          localDocumentId: existing?.localDocumentId || state.localId || newId(`${opts.appId}_doc`),
          remotePath: path(),
          baseRevision: String(opts.getRevision?.() || existing?.baseRevision || ''),
          contextKey: existing?.contextKey || contextKey(),
          snapshot: structuredClone(snapshot),
          pending: true,
          state: 'local-saved',
          operationId: existing?.operationId || newId(`${opts.appId}_save`),
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          retryCount: Number(existing?.retryCount || 0),
          lastError: '',
        };
        await putSnapshot(record);
        status(record.remotePath ? 'pending' : 'local-saved',
          record.remotePath ? '端末に保存済み・同期待ち' : '端末に保存済み');
        return true;
      } catch (error) {
        status('error', '端末への保存に失敗: ' + (error?.message || error));
        return false;
      } finally {
        state.saving = false;
      }
    }

    function schedule() {
      clearTimeout(state.timer);
      state.timer = setTimeout(saveNow, Number(opts.debounceMs || 450));
    }

    async function markSynced(revision) {
      const record = await getSnapshot(recordId()).catch(() => null);
      if (!record) return;
      record.pending = false;
      record.state = 'synced';
      record.baseRevision = String(revision || opts.getRevision?.() || record.baseRevision || '');
      record.lastError = '';
      record.syncedAt = new Date().toISOString();
      await putSnapshot(record);
      status('synced', '同期済み');
    }

    async function restoreLatest() {
      const rows = await listApp(opts.appId).catch(() => []);
      const currentPath = path();
      const record = rows.find(row => row.pending && (
        currentPath ? row.remotePath === currentPath : !row.remotePath
      ));
      if (!record || typeof opts.restore !== 'function') return false;
      if (!currentPath && record.localDocumentId) state.localId = record.localDocumentId;
      await opts.restore(structuredClone(record.snapshot), record);
      status(record.remotePath ? 'pending' : 'local-saved',
        record.remotePath ? '端末の未送信内容を復元しました' : '端末内の下書きを復元しました');
      return true;
    }

    async function discardCurrent() {
      clearTimeout(state.timer);
      await deleteSnapshot(recordId()).catch(() => {});
      state.localId = newId('local');
      status('discarded', '');
    }

    async function flush() {
      if (state.syncing || typeof opts.sync !== 'function') return false;
      const record = await getSnapshot(recordId()).catch(() => null);
      if (!record?.pending || !record.remotePath) return false;
      const currentContext = contextKey();
      if (record.contextKey && currentContext && record.contextKey !== currentContext) {
        record.state = 'destination-check';
        record.lastError = '保存先またはアカウントが変わっています';
        await putSnapshot(record);
        status('destination-check', '保存先を確認してください');
        return false;
      }
      state.syncing = true;
      status('syncing', '同期中…');
      try {
        await opts.sync(structuredClone(record.snapshot), record);
        await markSynced();
        return true;
      } catch (error) {
        const message = String(error?.userMessage || error?.message || error);
        record.retryCount += 1;
        record.lastError = message.slice(0, 500);
        record.state = /conflict|競合|etag|revision|更新情報/i.test(message) ? 'conflict' : 'pending';
        await putSnapshot(record);
        status(record.state, record.state === 'conflict' ? '競合を確認してください' : '端末に保存済み・同期待ち');
        return false;
      } finally {
        state.syncing = false;
      }
    }

    function start() {
      if (state.started) return;
      state.started = true;
      window.addEventListener('input', schedule, true);
      window.addEventListener('change', schedule, true);
      window.addEventListener('online', flush);
      window.addEventListener('meldex:standalone-auth-changed', flush);
      window.addEventListener('beforeunload', () => { clearTimeout(state.timer); saveNow(); });
    }

    return { start, schedule, saveNow, restoreLatest, flush, markSynced, discardCurrent, recordId };
  }

  window.MeldexStandaloneLocalDrafts = {
    create,
    putRaw,
    getRaw,
    putSnapshot,
    getSnapshot,
    listApp,
  };
})();
