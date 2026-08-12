(function (global) {
  'use strict';

  const DB_NAME = 'meldex-portable-knowledge-v1';
  const DB_VERSION = 1;
  const ARTIFACTS = 'artifacts';
  const META = 'meta';
  let databasePromise = null;

  function _request(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('端末内ナレッジを読み書きできません'));
    });
  }

  function _complete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('端末内ナレッジの処理を完了できません'));
      transaction.onerror = () => reject(transaction.error || new Error('端末内ナレッジの処理に失敗しました'));
    });
  }

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ARTIFACTS)) {
          const store = db.createObjectStore(ARTIFACTS, { keyPath: 'document_id' });
          store.createIndex('source_path', 'source_path', { unique: false });
          store.createIndex('kind', 'kind', { unique: false });
        }
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('端末内ナレッジを開けません'));
      request.onblocked = () => reject(new Error('別のMeldex画面が索引更新を妨げています'));
    });
    return databasePromise;
  }

  async function getMeta(key, fallbackValue = null) {
    const db = await open();
    const tx = db.transaction(META, 'readonly');
    const row = await _request(tx.objectStore(META).get(String(key || '')));
    return row ? row.value : fallbackValue;
  }

  async function setMeta(key, value) {
    const db = await open();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put({ key: String(key || ''), value, updated_at: new Date().toISOString() });
    await _complete(tx);
    return value;
  }

  async function get(documentId) {
    const db = await open();
    const tx = db.transaction(ARTIFACTS, 'readonly');
    return (await _request(tx.objectStore(ARTIFACTS).get(String(documentId || '')))) || null;
  }

  async function list() {
    const db = await open();
    const tx = db.transaction(ARTIFACTS, 'readonly');
    return (await _request(tx.objectStore(ARTIFACTS).getAll())) || [];
  }

  async function batchUpsert(artifacts) {
    const rows = (Array.isArray(artifacts) ? artifacts : []).filter(row => row?.document_id && row?.revision);
    if (!rows.length) return { upserted: 0, unchanged: 0, changed: 0 };
    const db = await open();
    const existing = new Map((await list()).map(row => [row.document_id, row]));
    const tx = db.transaction(ARTIFACTS, 'readwrite');
    let changed = 0;
    let unchanged = 0;
    rows.forEach(row => {
      if (existing.get(row.document_id)?.revision === row.revision) {
        unchanged += 1;
        return;
      }
      changed += 1;
      tx.objectStore(ARTIFACTS).put(row);
    });
    await _complete(tx);
    return { upserted: changed, unchanged, changed };
  }

  async function deleteArtifacts(documentIds) {
    const ids = [...new Set((documentIds || []).map(String).filter(Boolean))];
    if (!ids.length) return { deleted: 0 };
    const db = await open();
    const tx = db.transaction(ARTIFACTS, 'readwrite');
    ids.forEach(id => tx.objectStore(ARTIFACTS).delete(id));
    await _complete(tx);
    return { deleted: ids.length };
  }

  async function clear() {
    const db = await open();
    const tx = db.transaction([ARTIFACTS, META], 'readwrite');
    tx.objectStore(ARTIFACTS).clear();
    tx.objectStore(META).clear();
    await _complete(tx);
  }

  async function coverage() {
    const artifacts = await list();
    const byKind = {};
    let bytes = 0;
    artifacts.forEach(artifact => {
      const kind = String(artifact.kind || 'other');
      byKind[kind] = Number(byKind[kind] || 0) + 1;
      bytes += Number(artifact?.metadata?.source_size || 0);
    });
    return {
      total: artifacts.length,
      by_kind: byKind,
      source_bytes: bytes,
      local_store: 'indexeddb',
      portable: true,
      latest_job: await getMeta('latest_job', null),
      last_sync: await getMeta('last_sync', null),
    };
  }

  global.MeldexPortableKnowledgeStore = Object.freeze({
    open,
    getMeta,
    setMeta,
    get,
    list,
    batchUpsert,
    deleteArtifacts,
    clear,
    coverage,
  });
})(window);
