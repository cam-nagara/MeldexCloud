(function () {
  'use strict';

  const DB_NAME = 'meldex-llm-keys';
  const STORE_NAME = 'keys';
  const DB_VERSION = 1;
  const FALLBACK_STORAGE_KEY = 'meldex-llm-keys:fallback';
  const SAVE_MODE_KEY = 'meldex-llm-keys:save-mode';
  const CLOUD_KDF_ITERATIONS = 600000;
  const CLOUD_KEY_PATH = '_meldex/secrets/llm-api-keys.v1.json';
  const KEY_NAMES = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];
  const PROVIDER_KEY = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
  };
  let _dbPromise = null;

  function _providerKey(provider) {
    const key = String(provider || '').trim().toLowerCase();
    return PROVIDER_KEY[key] || '';
  }

  function _normalizeKeyName(name) {
    const key = String(name || '').trim().toUpperCase();
    return KEY_NAMES.includes(key) ? key : '';
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
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    return _dbPromise;
  }

  function _tx(db, mode) {
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  function _readFallbackRaw() {
    try {
      return localStorage.getItem(FALLBACK_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function _readFallback() {
    try {
      const parsed = JSON.parse(_readFallbackRaw() || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      _removeFallback();
      return {};
    }
  }

  function _removeFallback() {
    try { localStorage.removeItem(FALLBACK_STORAGE_KEY); } catch {}
  }

  function _storageUnavailableError() {
    return new Error('APIキーをこの端末へ保存できませんでした。ブラウザのIndexedDBが使えないため、この端末には保存せず、必要な時に入力してください');
  }

  async function _migrateFallbackToDb(db) {
    const raw = _readFallbackRaw();
    if (!raw) return 0;
    const entries = Object.entries(_cleanKeyMap(_readFallback()));
    if (!entries.length) {
      _removeFallback();
      return 0;
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const updatedAt = new Date().toISOString();
      entries.forEach(([name, value]) => store.put({ name, value, updatedAt, migratedFrom: 'localStorage' }));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB migration failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB migration aborted'));
    });
    _removeFallback();
    return entries.length;
  }

  function _bytesToBase64(bytes) {
    let raw = '';
    new Uint8Array(bytes || []).forEach((byte) => { raw += String.fromCharCode(byte); });
    return btoa(raw);
  }

  function _base64ToBytes(text) {
    const raw = atob(String(text || ''));
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index) & 0xff;
    return bytes;
  }

  function _webCrypto() {
    const api = globalThis.crypto;
    if (!api?.subtle || !api?.getRandomValues) throw new Error('このブラウザではWeb Cryptoを利用できません');
    return api;
  }

  async function _deriveCloudKey(passphrase, salt, iterations) {
    const cryptoApi = _webCrypto();
    const material = await cryptoApi.subtle.importKey(
      'raw',
      new TextEncoder().encode(String(passphrase || '')),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return cryptoApi.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt,
        iterations: Math.max(CLOUD_KDF_ITERATIONS, Number(iterations || CLOUD_KDF_ITERATIONS) || CLOUD_KDF_ITERATIONS),
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function _cleanKeyMap(keys) {
    const result = {};
    Object.entries(keys || {}).forEach(([name, value]) => {
      const keyName = _normalizeKeyName(name);
      const text = String(value || '').trim();
      if (keyName && text) result[keyName] = text;
    });
    return result;
  }

  async function _encryptForCloud(keys, passphrase) {
    if (!String(passphrase || '').trim()) throw new Error('Cloud保存パスフレーズを入力してください');
    const cryptoApi = _webCrypto();
    const salt = new Uint8Array(16);
    const iv = new Uint8Array(12);
    cryptoApi.getRandomValues(salt);
    cryptoApi.getRandomValues(iv);
    const key = await _deriveCloudKey(passphrase, salt, CLOUD_KDF_ITERATIONS);
    const payload = {
      type: 'meldex-llm-api-keys',
      version: 1,
      keys: _cleanKeyMap(keys),
      exported_at: new Date().toISOString(),
    };
    const ciphertext = await cryptoApi.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(payload))
    );
    return {
      schema: 'meldex.llm-api-keys.encrypted.v1',
      version: 1,
      path: CLOUD_KEY_PATH,
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: CLOUD_KDF_ITERATIONS,
        salt: _bytesToBase64(salt),
      },
      cipher: {
        name: 'AES-GCM',
        iv: _bytesToBase64(iv),
        ciphertext: _bytesToBase64(ciphertext),
      },
      providers: Object.keys(payload.keys).map(name => name.replace(/_API_KEY$/, '').toLowerCase()).sort(),
      updated_at: new Date().toISOString(),
    };
  }

  async function _decryptCloudEnvelope(envelope, passphrase) {
    if (!String(passphrase || '').trim()) throw new Error('Cloud保存パスフレーズを入力してください');
    if (!envelope?.cipher?.ciphertext || !envelope?.kdf?.salt || !envelope?.cipher?.iv) throw new Error('Cloud保存APIキーの形式が不正です');
    const key = await _deriveCloudKey(
      passphrase,
      _base64ToBytes(envelope.kdf.salt),
      envelope.kdf.iterations
    );
    let plain;
    try {
      plain = await _webCrypto().subtle.decrypt(
        { name: 'AES-GCM', iv: _base64ToBytes(envelope.cipher.iv) },
        key,
        _base64ToBytes(envelope.cipher.ciphertext)
      );
    } catch {
      throw new Error('Cloud保存APIキーを復号できません。パスフレーズを確認してください');
    }
    const payload = JSON.parse(new TextDecoder().decode(plain));
    return _cleanKeyMap(payload?.keys || {});
  }

  function getSaveMode() {
    try {
      return localStorage.getItem(SAVE_MODE_KEY) === 'cloud-encrypted' ? 'cloud-encrypted' : 'local-device';
    } catch {
      return 'local-device';
    }
  }

  function setSaveMode(mode) {
    const value = mode === 'cloud-encrypted' ? 'cloud-encrypted' : 'local-device';
    try { localStorage.setItem(SAVE_MODE_KEY, value); } catch {}
    return value;
  }

  async function cloudStatus() {
    if (!window.MeldexDataAccess?.requestJson) return { exists: false, available: false };
    const data = await window.MeldexDataAccess.requestJson('/llm-keys/cloud').catch(() => null);
    return {
      available: !!data,
      exists: !!data?.exists,
      providers: Array.isArray(data?.envelope?.providers) ? data.envelope.providers : [],
      updated_at: data?.envelope?.updated_at || '',
      path: CLOUD_KEY_PATH,
    };
  }

  async function _requireCloudKeyApiAvailable() {
    if (!window.MeldexDataAccess?.requestJson) {
      throw new Error('暗号化APIキーCloud保存は、Cloud/Dropbox連携が有効な環境で利用できます');
    }
    const data = await window.MeldexDataAccess.requestJson('/llm-keys/cloud').catch(() => null);
    if (!data) {
      throw new Error('この環境では暗号化APIキーCloud保存を利用できません');
    }
    return data;
  }

  async function saveCloudEncrypted(passphrase, keys) {
    await _requireCloudKeyApiAvailable();
    const sourceKeys = keys ? _cleanKeyMap(keys) : await getAll();
    if (!Object.keys(sourceKeys).length) throw new Error('Cloud保存するAPIキーがありません');
    const envelope = await _encryptForCloud(sourceKeys, passphrase);
    await window.MeldexDataAccess.requestJson('/llm-keys/cloud', { method: 'PUT', body: envelope });
    setSaveMode('cloud-encrypted');
    return { ok: true, providers: envelope.providers, path: CLOUD_KEY_PATH };
  }

  async function loadCloudEncrypted(passphrase, options = {}) {
    const data = await _requireCloudKeyApiAvailable();
    if (!data?.exists || !data?.envelope) throw new Error('Cloud保存APIキーが見つかりません');
    const keys = await _decryptCloudEnvelope(data.envelope, passphrase);
    if (options.importToLocal !== false) await setMany(keys);
    setSaveMode('cloud-encrypted');
    return { ok: true, keys: options.returnKeys ? keys : undefined, providers: Object.keys(keys).map(name => name.replace(/_API_KEY$/, '').toLowerCase()) };
  }

  async function deleteCloudEncrypted() {
    await _requireCloudKeyApiAvailable();
    await window.MeldexDataAccess.requestJson('/llm-keys/cloud', { method: 'DELETE' });
    setSaveMode('local-device');
    return { ok: true };
  }

  function _settingsInputKeys() {
    return _cleanKeyMap({
      GEMINI_API_KEY: document.getElementById('modal-gemini-key')?.value || '',
      ANTHROPIC_API_KEY: document.getElementById('modal-anthropic-key')?.value || '',
      OPENAI_API_KEY: document.getElementById('modal-openai-key')?.value || '',
    });
  }

  async function saveCloudFromSettings() {
    try {
      const passphrase = document.getElementById('modal-llm-cloud-passphrase')?.value || '';
      const keys = { ...(await getAll()), ..._settingsInputKeys() };
      const result = await saveCloudEncrypted(passphrase, keys);
      if (typeof showStatus === 'function') showStatus('APIキーを暗号化してCloudへ保存しました');
      return result;
    } catch (err) {
      if (typeof showStatus === 'function') showStatus('Cloud保存に失敗: ' + (err?.message || err), true);
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async function loadCloudFromSettings() {
    try {
      const passphrase = document.getElementById('modal-llm-cloud-passphrase')?.value || '';
      const result = await loadCloudEncrypted(passphrase, { returnKeys: true });
      const keys = result.keys || {};
      const gemini = document.getElementById('modal-gemini-key');
      const anthropic = document.getElementById('modal-anthropic-key');
      const openai = document.getElementById('modal-openai-key');
      if (gemini && keys.GEMINI_API_KEY) gemini.value = keys.GEMINI_API_KEY;
      if (anthropic && keys.ANTHROPIC_API_KEY) anthropic.value = keys.ANTHROPIC_API_KEY;
      if (openai && keys.OPENAI_API_KEY) openai.value = keys.OPENAI_API_KEY;
      if (typeof showStatus === 'function') showStatus('Cloud保存APIキーを復号してこの端末へ読み込みました');
      return result;
    } catch (err) {
      if (typeof showStatus === 'function') showStatus('Cloud保存APIキーの復号に失敗: ' + (err?.message || err), true);
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async function deleteCloudFromSettings() {
    try {
      if (typeof cfConfirm === 'function' && !await cfConfirm('Cloud保存APIキーを削除しますか？', { danger: true, okLabel: '削除' })) return { ok: false, cancelled: true };
      const result = await deleteCloudEncrypted();
      if (typeof showStatus === 'function') showStatus('Cloud保存APIキーを削除しました');
      return result;
    } catch (err) {
      if (typeof showStatus === 'function') showStatus('Cloud保存APIキーの削除に失敗: ' + (err?.message || err), true);
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async function getAll() {
    try {
      const db = await _openDb();
      await _migrateFallbackToDb(db);
      return await new Promise((resolve, reject) => {
        const req = _tx(db, 'readonly').getAll();
        req.onsuccess = () => {
          const result = {};
          (req.result || []).forEach(row => {
            const name = _normalizeKeyName(row?.name);
            const value = String(row?.value || '').trim();
            if (name && value) result[name] = value;
          });
          resolve(result);
        };
        req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
      });
    } catch {
      return {};
    }
  }

  async function setMany(nextKeys) {
    const entries = Object.entries(nextKeys || {})
      .map(([name, value]) => [_normalizeKeyName(name), String(value || '').trim()])
      .filter(([name, value]) => name && value);
    if (!entries.length) return { ok: true, saved: 0 };
    try {
      const db = await _openDb();
      await _migrateFallbackToDb(db);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const updatedAt = new Date().toISOString();
        entries.forEach(([name, value]) => store.put({ name, value, updatedAt }));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
      });
    } catch (err) {
      _removeFallback();
      throw _storageUnavailableError(err);
    }
    return { ok: true, saved: entries.length };
  }

  async function deleteKey(name) {
    const keyName = _normalizeKeyName(name);
    if (!keyName) return { ok: true };
    try {
      const db = await _openDb();
      await _migrateFallbackToDb(db);
      await new Promise((resolve, reject) => {
        const req = _tx(db, 'readwrite').delete(keyName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'));
      });
    } catch (err) {
      _removeFallback();
      throw _storageUnavailableError(err);
    }
    return { ok: true };
  }

  async function getForProvider(provider) {
    const keyName = _providerKey(provider);
    if (!keyName) return '';
    const keys = await getAll();
    return String(keys[keyName] || '').trim();
  }

  async function hasProvider(provider) {
    return !!(await getForProvider(provider));
  }

  async function configuredProviders() {
    const keys = await getAll();
    return {
      anthropic: !!keys.ANTHROPIC_API_KEY,
      openai: !!keys.OPENAI_API_KEY,
      gemini: !!keys.GEMINI_API_KEY,
    };
  }

  async function configShape(serverConfig) {
    const local = await configuredProviders();
    const server = serverConfig?.providers || {};
    return {
      providers: {
        anthropic: {
          available: server.anthropic?.available !== false,
          configured: !!(local.anthropic || server.anthropic?.configured),
          localConfigured: !!local.anthropic,
          serverConfigured: !!server.anthropic?.configured,
        },
        openai: {
          available: server.openai?.available !== false,
          configured: !!(local.openai || server.openai?.configured),
          localConfigured: !!local.openai,
          serverConfigured: !!server.openai?.configured,
        },
        gemini: {
          available: server.gemini?.available !== false,
          configured: !!(local.gemini || server.gemini?.configured),
          localConfigured: !!local.gemini,
          serverConfigured: !!server.gemini?.configured,
        },
      },
    };
  }

  window.MeldexLlmKeys = {
    keyNames: KEY_NAMES.slice(),
    providerKey: _providerKey,
    getAll,
    setMany,
    deleteKey,
    getForProvider,
    hasProvider,
    configuredProviders,
    configShape,
    getSaveMode,
    setSaveMode,
    cloudStatus,
    saveCloudEncrypted,
    loadCloudEncrypted,
    deleteCloudEncrypted,
    saveCloudFromSettings,
    loadCloudFromSettings,
    deleteCloudFromSettings,
  };
})();
