(function () {
  'use strict';

  const DB_NAME = 'meldex-owner-keys';
  const STORE_NAME = 'keys';
  const DB_VERSION = 2;
  const FALLBACK_KEY = 'meldex-owner-hmac-key';
  const KEY_ID = 'hmac-sha256';
  const PASSPHRASE_MIN_LENGTH = 12;
  const KDF_ITERATIONS = 600000;
  const LEGACY_KDF_SALT = 'meldex-owner-hmac-v1';
  const KDF_SALT = 'meldex-owner-hmac-v2';
  const ENVELOPE_SCHEMA = 'meldex.owner-hmac-key.encrypted.v2';
  const WRAP_KEY_SECRET = 'meldex-owner-key-wrap-v2';
  let _dbPromise = null;

  function _workspaceScope() {
    let workspace = null;
    try { workspace = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null; } catch {}
    let activeId = '';
    try { activeId = _safeText(window.MeldexWorkspaces?.getActiveId?.() || ''); } catch {}
    if (!workspace && !activeId) return { id: 'local-device', allowLegacyClaim: true };
    const id = _safeText(
      workspace.workspaceId || workspace.workspace_id || workspace.stableId
      || activeId || ''
    );
    if (!id) throw new Error('安定したワークスペースIDを取得できません');
    return { id, allowLegacyClaim: workspace?.ownerKeyLegacyClaim === true };
  }

  function _rowId() {
    return `${KEY_ID}:${_workspaceScope().id}`;
  }

  function _bytesToBase64(bytes) {
    let text = '';
    new Uint8Array(bytes || []).forEach(byte => { text += String.fromCharCode(byte); });
    return btoa(text);
  }

  function _base64ToBytes(text) {
    const raw = atob(String(text || ''));
    return Uint8Array.from(raw, ch => ch.charCodeAt(0));
  }

  function _normalizeRawKey(value) {
    const bytes = _base64ToBytes(value);
    if (bytes.length < 32) throw new Error('管理者鍵が短すぎます');
    return _bytesToBase64(bytes);
  }

  function _webCrypto() {
    const api = globalThis.crypto;
    if (!api?.subtle || !api?.getRandomValues) throw new Error('このブラウザではWeb Cryptoを利用できません');
    return api;
  }

  function _readFallbackKey() {
    try { return localStorage.getItem(FALLBACK_KEY) || ''; } catch { return ''; }
  }

  function _removeFallbackKey() {
    try { localStorage.removeItem(FALLBACK_KEY); } catch {}
  }

  function _safeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function _workspaceSaltText() {
    return `${KDF_SALT}:${_workspaceScope().id}`;
  }

  async function _saltBytesFromText(saltText) {
    const encoded = new TextEncoder().encode(String(saltText || _workspaceSaltText()));
    const digest = await _webCrypto().subtle.digest('SHA-256', encoded);
    return new Uint8Array(digest);
  }

  async function _deriveWrapKey(saltBytes) {
    const cryptoApi = _webCrypto();
    const material = await cryptoApi.subtle.importKey(
      'raw',
      new TextEncoder().encode(WRAP_KEY_SECRET),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return cryptoApi.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
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
      req.onerror = () => {
        _dbPromise = null;
        reject(req.error || new Error('IndexedDB open failed'));
      };
      req.onblocked = () => {
        _dbPromise = null;
        reject(new Error('IndexedDB open blocked'));
      };
    });
    return _dbPromise;
  }

  async function _readRow(db, id = _rowId()) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
  }

  async function _writeRow(row) {
    const db = await _openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
    });
  }

  async function _encryptStoredKey(value) {
    const raw = _normalizeRawKey(value);
    const salt = await _saltBytesFromText(_workspaceSaltText());
    const iv = new Uint8Array(12);
    _webCrypto().getRandomValues(iv);
    const payload = {
      type: 'meldex-owner-hmac-key',
      version: 2,
      raw,
      exported_at: new Date().toISOString(),
    };
    const ciphertext = await _webCrypto().subtle.encrypt(
      { name: 'AES-GCM', iv },
      await _deriveWrapKey(salt),
      new TextEncoder().encode(JSON.stringify(payload))
    );
    return {
      id: _rowId(),
      workspaceId: _workspaceScope().id,
      schema: ENVELOPE_SCHEMA,
      encrypted: true,
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: KDF_ITERATIONS,
        salt: _bytesToBase64(salt),
      },
      cipher: {
        name: 'AES-GCM',
        iv: _bytesToBase64(iv),
        ciphertext: _bytesToBase64(ciphertext),
      },
      updatedAt: new Date().toISOString(),
    };
  }

  async function _decryptStoredKey(row) {
    if (!row) return '';
    if (row.schema === ENVELOPE_SCHEMA && row.encrypted && row.cipher?.ciphertext) {
      const salt = _base64ToBytes(row.kdf?.salt || '');
      const iv = _base64ToBytes(row.cipher?.iv || '');
      let plain;
      try {
        plain = await _webCrypto().subtle.decrypt(
          { name: 'AES-GCM', iv },
          await _deriveWrapKey(salt),
          _base64ToBytes(row.cipher.ciphertext)
        );
      } catch {
        throw new Error('管理者鍵を復号できませんでした。バックアップまたはパスフレーズで復旧してください');
      }
      const payload = JSON.parse(new TextDecoder().decode(plain));
      return _normalizeRawKey(payload?.raw || '');
    }
    const legacyValue = String(row?.value || '');
    return legacyValue ? _normalizeRawKey(legacyValue) : '';
  }

  async function _readStoredKey() {
    const fallbackValue = _readFallbackKey();
    let db;
    let row;
    try {
      db = await _openDb();
      row = await _readRow(db);
    } catch {
      return '';
    }
    if (row) {
      const raw = await _decryptStoredKey(row);
      if (raw) {
        if (row.schema !== ENVELOPE_SCHEMA || fallbackValue) await _writeStoredKey(raw);
        return raw;
      }
    }
    const scope = _workspaceScope();
    if (!row && scope.allowLegacyClaim) {
      const legacyRow = await _readRow(db, KEY_ID);
      if (legacyRow) {
        const raw = await _decryptStoredKey(legacyRow);
        await _writeStoredKey(raw);
        await new Promise((resolve, reject) => {
          const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(KEY_ID);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error || new Error('IndexedDB legacy delete failed'));
        });
        return raw;
      }
    }
    if (fallbackValue && scope.allowLegacyClaim) {
      const raw = _normalizeRawKey(fallbackValue);
      await _writeStoredKey(raw);
      return raw;
    }
    return '';
  }

  async function _writeStoredKey(value) {
    const row = await _encryptStoredKey(value);
    try {
      await _writeRow(row);
      _removeFallbackKey();
    } catch (err) {
      throw err || new Error('管理者鍵を保存できませんでした');
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
    _webCrypto().getRandomValues(bytes);
    const value = _bytesToBase64(bytes);
    await _writeStoredKey(value);
    return value;
  }

  async function setRawKey(value) {
    return _writeStoredKey(_normalizeRawKey(value));
  }

  async function deriveRawFromPassphrase(passphrase, saltText = null) {
    const pass = String(passphrase || '');
    if (pass.length < PASSPHRASE_MIN_LENGTH) throw new Error(`管理者パスフレーズは${PASSPHRASE_MIN_LENGTH}文字以上にしてください`);
    const enc = new TextEncoder();
    const saltSource = saltText == null ? _workspaceSaltText() : String(saltText || LEGACY_KDF_SALT);
    const keyMaterial = await _webCrypto().subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await _webCrypto().subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(saltSource), iterations: KDF_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    return _bytesToBase64(new Uint8Array(bits));
  }

  async function deriveFromPassphrase(passphrase, saltText = null) {
    const value = await deriveRawFromPassphrase(passphrase, saltText);
    await _writeStoredKey(value);
    return value;
  }

  async function importHmacKey(options = {}) {
    const raw = options.rawKey ? _normalizeRawKey(options.rawKey) : await getRawKey(options);
    if (!raw) return null;
    return _webCrypto().subtle.importKey('raw', _base64ToBytes(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }

  async function clear() {
    try {
      const db = await _openDb();
      await new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(_rowId());
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'));
      });
    } catch {}
    _removeFallbackKey();
  }

  window.MeldexOwnerKeyStore = {
    getRawKey,
    createRandomKey,
    setRawKey,
    normalizeRawKey: _normalizeRawKey,
    deriveRawFromPassphrase,
    deriveFromPassphrase,
    importHmacKey,
    clear,
    vaultSaltText: _workspaceSaltText,
    PASSPHRASE_MIN_LENGTH,
    KDF_ITERATIONS,
    KDF_SALT,
    LEGACY_KDF_SALT,
    workspaceScope: _workspaceScope,
  };
})();
