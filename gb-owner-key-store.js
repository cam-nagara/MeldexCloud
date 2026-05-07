(function () {
  'use strict';

  const DB_NAME = 'meldex-owner-keys';
  const STORE_NAME = 'keys';
  const DB_VERSION = 1;
  const FALLBACK_KEY = 'meldex-owner-hmac-key';
  const KEY_ID = 'hmac-sha256';
  const PASSPHRASE_MIN_LENGTH = 12;
  const KDF_ITERATIONS = 600000;
  const KDF_SALT = 'meldex-owner-hmac-v1';
  let _dbPromise = null;

  function _bytesToBase64(bytes) {
    let text = '';
    (bytes || []).forEach(byte => { text += String.fromCharCode(byte); });
    return btoa(text);
  }

  function _base64ToBytes(text) {
    const raw = atob(String(text || ''));
    return Uint8Array.from(raw, ch => ch.charCodeAt(0));
  }

  function _openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    return _dbPromise;
  }

  async function _readStoredKey() {
    try {
      const db = await _openDb();
      const row = await new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(KEY_ID);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
      });
      return String(row?.value || '');
    } catch {
      try { return localStorage.getItem(FALLBACK_KEY) || ''; } catch { return ''; }
    }
  }

  async function _writeStoredKey(value) {
    const row = { id: KEY_ID, value: String(value || ''), updatedAt: new Date().toISOString() };
    try {
      const db = await _openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
      });
    } catch {
      try { localStorage.setItem(FALLBACK_KEY, row.value); } catch {}
    }
    return row;
  }

  async function getRawKey(options = {}) {
    let value = await _readStoredKey();
    if (!value && options.create !== false) {
      value = await createRandomKey();
    }
    return value;
  }

  async function createRandomKey() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const value = _bytesToBase64(bytes);
    await _writeStoredKey(value);
    return value;
  }

  async function setRawKey(value) {
    const bytes = _base64ToBytes(value);
    if (bytes.length < 32) throw new Error('管理者鍵が短すぎます');
    return _writeStoredKey(_bytesToBase64(bytes));
  }

  async function deriveFromPassphrase(passphrase, saltText = KDF_SALT) {
    const pass = String(passphrase || '');
    if (pass.length < PASSPHRASE_MIN_LENGTH) throw new Error(`管理者パスフレーズは${PASSPHRASE_MIN_LENGTH}文字以上にしてください`);
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(String(saltText || KDF_SALT)), iterations: KDF_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const value = _bytesToBase64(new Uint8Array(bits));
    await _writeStoredKey(value);
    return value;
  }

  async function importHmacKey(options = {}) {
    const raw = await getRawKey(options);
    if (!raw) return null;
    return crypto.subtle.importKey('raw', _base64ToBytes(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }

  async function clear() {
    try {
      const db = await _openDb();
      await new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(KEY_ID);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'));
      });
    } catch {}
    try { localStorage.removeItem(FALLBACK_KEY); } catch {}
  }

  window.MeldexOwnerKeyStore = {
    getRawKey,
    createRandomKey,
    setRawKey,
    deriveFromPassphrase,
    importHmacKey,
    clear,
    PASSPHRASE_MIN_LENGTH,
    KDF_ITERATIONS,
    KDF_SALT,
  };
})();
