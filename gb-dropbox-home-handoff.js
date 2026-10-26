/* Encrypted, one-time, local-device handoff. No server and no credential URL. */
(function () {
  'use strict';
  const DB = 'meldex-dropbox-home-handoff-v1', STORE = 'pending', PREFIX = 'MELDEX-HOME-1.';
  const LOCAL_ONLY = 'meldex-dropbox-home-local-v1', TTL = 5 * 60 * 1000;
  const RSA = { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  let creation = null;
  function issue(code, status) { return Object.assign(new Error(code), { code, status: status || 0 }); }
  function encode(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function decode(value, maximum) {
    if (typeof value !== 'string' || value.length > maximum || !/^[A-Za-z0-9_-]+$/.test(value)) throw issue('handoff_invalid');
    try { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0)); }
    catch { throw issue('handoff_invalid'); }
  }
  const utf8 = text => new TextEncoder().encode(text);
  async function hash(value) { return encode(await crypto.subtle.digest('SHA-256', value)); }
  function installed() { return navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)')?.matches === true; }
  function isEnabled() {
    if (location.protocol !== 'https:' || !(/iPhone|iPad|iPod/i.test(navigator.userAgent || '')
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))) return false;
    const params = new URLSearchParams(location.search);
    if (params.get('desktop') === '1' || params.get('safeMode') === '1' || params.has('smoke')) return false;
    if (params.has('dataAccessMode') && params.get('dataAccessMode') !== 'dropbox') return false;
    if (window.MeldexDropboxSessionBroker?.isEnabled?.()) return false;
    try { if (localStorage.getItem(LOCAL_ONLY) === '1') return false; } catch {}
    return true;
  }
  function kind() {
    return document.documentElement?.getAttribute('data-standalone-cloud') === 'quick-memo'
      || /quick-memo(?:\/|\.html)/i.test(location.pathname) ? 'memo' : 'main';
  }
  async function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(issue('handoff_storage_failed'));
      request.onblocked = () => reject(issue('handoff_storage_failed'));
    });
  }
  async function storage(mode, action) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode), request = action(tx.objectStore(STORE));
        let result;
        request.onsuccess = () => { result = request.result; };
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(issue('handoff_storage_failed'));
      });
    } finally { db.close(); }
  }
  function validateRequest(value) {
    if (!value || value.version !== 1 || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.id)
      || !['main', 'memo'].includes(value.kind) || !Number.isSafeInteger(value.expiresAt)
      || typeof value.publicKey !== 'string' || !/^[A-Za-z0-9_-]{300,600}$/.test(value.publicKey)
      || typeof value.origin !== 'string' || value.origin !== location.origin) throw issue('handoff_invalid');
    if (value.expiresAt <= Date.now() || value.expiresAt > Date.now() + TTL + 5000) throw issue('handoff_expired', 410);
    return { version: 1, id: value.id, kind: value.kind, expiresAt: value.expiresAt,
      origin: value.origin, publicKey: value.publicKey };
  }
  function aad(value) {
    return utf8(JSON.stringify(['meldex-home-handoff-v1', value.id, value.kind, value.expiresAt, value.origin, value.publicKey]));
  }
  async function code(value) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', aad(value)));
    return String(new DataView(bytes.buffer).getUint32(0) % 1000000).padStart(6, '0');
  }
  async function makeRequest() {
    let saved = await storage('readonly', store => store.get(kind()));
    if (!saved || saved.request.expiresAt <= Date.now()) {
      const pair = await crypto.subtle.generateKey(RSA, false, ['encrypt', 'decrypt']);
      const request = { version: 1, id: encode(crypto.getRandomValues(new Uint8Array(32))), kind: kind(),
        expiresAt: Date.now() + TTL, origin: location.origin,
        publicKey: encode(await crypto.subtle.exportKey('spki', pair.publicKey)) };
      saved = { request, privateKey: pair.privateKey };
      await storage('readwrite', store => store.put(saved, kind()));
    }
    const request = validateRequest(saved.request);
    const bridge = new URL('dropbox-session-bridge.html', new URL('.', document.baseURI || location.href));
    bridge.hash = 'handoff=' + encode(utf8(JSON.stringify(request)));
    return { id: request.id, kind: request.kind, expiresAt: request.expiresAt,
      userCode: await code(request), bridgeUrl: bridge.href };
  }
  function createHandoff() {
    if (!creation) creation = makeRequest().finally(() => { creation = null; });
    return creation;
  }
  async function resetHandoff() { await storage('readwrite', store => store.delete(kind())); }
  function requestFromUrl() {
    const value = new URLSearchParams(location.hash.slice(1)).get('handoff');
    try { return validateRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(value, 2048)))); }
    catch (error) { if (error.code) throw error; throw issue('handoff_invalid'); }
  }
  function settings() {
    const auth = window.MeldexDropboxAuth;
    return { vaultPath: auth.getVaultPath(), settingsPath: auth.getSettingsPath(),
      vaultNamespace: auth.getVaultNamespaceKind(), appMode: auth.getAppMode(), customAppKey: auth.getCustomAppKey() };
  }
  async function prepareExport(request) {
    request = validateRequest(request);
    if (window.top !== window.self) throw issue('handoff_framed');
    const auth = window.MeldexDropboxAuth, session = await auth.getSession();
    if (!session?.refreshToken) throw issue('handoff_source_disconnected');
    let accountId = String(session.accountId || session.account?.account_id || '');
    if (!accountId) accountId = String((await auth.getCurrentAccount(false))?.account_id || '');
    if (!accountId) throw issue('handoff_source_disconnected');
    const payload = { version: 1, id: request.id, accountId, appKey: session.appKey || auth.getAppKey(),
      refreshToken: session.refreshToken, settings: settings() };
    const publicKey = await crypto.subtle.importKey('spki', decode(request.publicKey, 600), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(request) }, key, utf8(JSON.stringify(payload)));
    const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, await crypto.subtle.exportKey('raw', key));
    const envelope = { version: 1, id: request.id, kind: request.kind, expiresAt: request.expiresAt,
      recipient: await hash(decode(request.publicKey, 600)), iv: encode(iv), key: encode(wrappedKey), data: encode(ciphertext) };
    return { text: PREFIX + encode(utf8(JSON.stringify(envelope))), accountId,
      userCode: await code(request), expiresAt: request.expiresAt };
  }
  async function consume(text) {
    if (typeof text !== 'string' || text.length > 24000 || !text.startsWith(PREFIX)) throw issue('handoff_clipboard_invalid');
    const saved = await storage('readonly', store => store.get(kind()));
    if (!saved) throw issue('handoff_expired', 410);
    const request = validateRequest(saved.request);
    let envelope;
    try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(text.slice(PREFIX.length), 24000))); }
    catch { throw issue('handoff_clipboard_invalid'); }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw issue('handoff_clipboard_invalid');
    if (envelope.version !== 1 || envelope.id !== request.id || envelope.kind !== request.kind
      || envelope.expiresAt !== request.expiresAt || envelope.recipient !== await hash(decode(request.publicKey, 600))) throw issue('handoff_recipient_rejected');
    let payload;
    try {
      const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, saved.privateKey, decode(envelope.key, 400));
      if (rawKey.byteLength !== 32) throw issue('handoff_invalid');
      const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
      const iv = decode(envelope.iv, 16);
      if (iv.byteLength !== 12) throw issue('handoff_invalid');
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(request) }, key, decode(envelope.data, 22000));
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    } catch { throw issue('handoff_ciphertext_rejected'); }
    validateRequest(request); // Do not install a transfer that expired during processing.
    const latest = await storage('readonly', store => store.get(kind()));
    if (latest?.request?.id !== request.id) throw issue('handoff_recipient_rejected');
    if (!payload || payload.version !== 1 || payload.id !== request.id) throw issue('handoff_invalid');
    // Credentials and pending settings are committed together by the auth module.
    await window.MeldexDropboxAuth.acceptHomeHandoff(payload);
    await window.MeldexDropboxAuth.getValidSession();
    await resetHandoff().catch(() => {});
    return true;
  }
  function redeemHandoff() {
    // Invoke clipboard access synchronously inside the explicit trusted click.
    if (!navigator.clipboard?.readText) return Promise.reject(issue('handoff_clipboard_denied'));
    return navigator.clipboard.readText().catch(() => { throw issue('handoff_clipboard_denied'); }).then(consume);
  }
  async function prepareLaunch(options) {
    if (!isEnabled() || !installed()) return;
    let session, initialError;
    try {
      session = await window.MeldexDropboxAuth.getSession();
      if (session?.homeHandoffImported) session = await window.MeldexDropboxAuth.getValidSession();
    } catch (error) { initialError = error; }
    if (initialError || !window.MeldexDropboxAuth.hasConnection(session)) {
      const result = await window.MeldexDropboxSessionRestore.wait({ ...options, initialError,
        transport: api, allowLocal: true, requireValidSession: true });
      if (result?.local) {
        await resetHandoff().catch(() => {});
        localStorage.setItem(LOCAL_ONLY, '1');
        window.MeldexRuntimeAdapter?.setMode?.('browser');
        return;
      }
      session = await window.MeldexDropboxAuth.getSession();
    }
    if (window.MeldexDropboxAuth.hasConnection(session)) {
      window.MeldexRuntimeAdapter?.setMode?.('dropbox');
      await resetHandoff().catch(() => {});
    }
  }
  const api = { isEnabled, installed, kind, createHandoff, resetHandoff, redeemHandoff,
    requestFromUrl, prepareExport, prepareLaunch, manualCompletion: true };
  window.MeldexDropboxHomeHandoff = Object.freeze(api);
})();
