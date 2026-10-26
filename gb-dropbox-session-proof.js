/* Cookie-free transport for an explicitly configured HTTPS session service. */
(function () {
  'use strict';
  const DB = 'meldex-pwa-session-device-v1';
  function fail() { throw new Error('session_device_storage_unavailable'); }
  function encode(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function database() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('devices');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('session_device_storage_blocked'));
    });
  }
  async function transaction(base, mode, action) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('devices', mode);
        let result;
        const request = action(tx.objectStore('devices'), base);
        request.onsuccess = () => { result = request.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('session_device_storage_failed'));
      });
    } finally { db.close(); }
  }
  async function load(base) {
    let value = await transaction(base, 'readonly', (store, key) => store.get(key));
    if (!value) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      const candidate = { privateKey: pair.privateKey, publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey), sid: '' };
      // add() is atomic across tabs. If another tab wins, use its key.
      try { await transaction(base, 'readwrite', (store, key) => store.add(candidate, key)); }
      catch (error) { if (error?.name !== 'ConstraintError') throw error; }
      value = await transaction(base, 'readonly', (store, key) => store.get(key));
    }
    if (!value?.privateKey || value.privateKey.extractable !== false || !value.publicKey) fail();
    return value;
  }
  async function device(base) {
    return load(base);
  }
  async function prepare(base, url, options) {
    const value = await device(base);
    const response = await fetch(new URL('challenge', base).href, {
      credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: options.signal,
      headers: { 'X-Meldex-Client': 'meldex-session-v1' },
    });
    const challenge = await response.json();
    if (!response.ok || !/^[A-Za-z0-9_-]{43}$/.test(challenge.nonce)) throw new Error('session_challenge_failed');
    const hash = encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.body || '')));
    const csrf = options.headers['X-CSRF-Token'] || '', account = options.headers['X-Meldex-Account'] || '';
    const message = ['meldex-session-proof-v1', options.method || 'GET', url, location.origin,
      challenge.nonce, value.sid, csrf, account, hash].join('\n');
    const signed = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, value.privateKey, new TextEncoder().encode(message));
    options.credentials = 'omit';
    options.headers['X-Meldex-Session'] = value.sid;
    options.headers['X-Meldex-Proof'] = encode(new TextEncoder().encode(JSON.stringify({
      key: value.publicKey, nonce: challenge.nonce, signature: encode(signed),
    })));
    return value.sid;
  }
  async function accept(base, value, expectedSid) {
    if (!Object.prototype.hasOwnProperty.call(value || {}, 'sessionId')) return value;
    if (typeof value.sessionId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.sessionId)) fail();
    const db = await database();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('devices', 'readwrite'), store = tx.objectStore('devices');
        const read = store.get(base);
        read.onsuccess = () => {
          const current = read.result;
          // A delayed response must not overwrite a session rotated in another tab.
          if (!current || (current.sid !== expectedSid && current.sid !== value.sessionId)) { tx.abort(); return; }
          store.put({ ...current, sid: value.sessionId }, base);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(new Error('session_device_changed'));
      });
    } finally { db.close(); }
    const result = { ...value };
    delete result.sessionId;
    return result;
  }
  window.MeldexDropboxSessionProof = Object.freeze({ prepare, accept });
})();
