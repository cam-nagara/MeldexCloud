(function () {
  const DB_NAME = 'meldex-dropbox-auth';
  const STORE_NAME = 'session';
  const SESSION_KEY = 'oauth-session';
  const PENDING_KEY = 'meldex-dropbox-pkce-pending';
  const APP_MODE_KEY = 'meldex-dropbox-app-mode';
  const CUSTOM_APP_KEY = 'meldex-dropbox-custom-app-key';
  const VAULT_PATH_KEY = 'meldex-dropbox-vault-path';
  const VAULT_NAMESPACE_KEY = 'meldex-dropbox-vault-namespace';
  const SETTINGS_PATH_KEY = 'meldex-dropbox-settings-path';
  const REDIRECT_OVERRIDE_KEY = 'meldex-dropbox-redirect-override';
  const DEFAULT_VAULT_PATH = '/MeldexVault';
  const DEFAULT_SETTINGS_PATH = '/MeldexSettings';
  const DEFAULT_APP_KEY = window.MeldexCloudConfig?.dropbox?.developerAppKey || '';
  const DEFAULT_SCOPES = Object.freeze(window.MeldexCloudConfig?.dropbox?.scopes || []);
  const TOKEN_ENDPOINT = 'https://api.dropbox.com/oauth2/token';
  const AUTH_ENDPOINT = 'https://www.dropbox.com/oauth2/authorize';
  const EARLY_REFRESH_MS = 120 * 1000;
  const PENDING_MAX_AGE_MS = 30 * 60 * 1000;
  const DROPBOX_API_MAX_RETRIES = 3;
  const DROPBOX_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
  const AUTH_CHANNEL_NAME = 'meldex-dropbox-auth-session-v1';
  let _memoryPending = null;
  let _authChannel = null;
  let _accountRootInfo = null;
  const _readFolderCache = new Map();
  const _readFolderPending = new Map();
  let _readFolderGeneration = 0;
  let _rateLimitUntil = 0;
  let _apiSessionGeneration = 0;
  // Leave capacity for sheet reads and writes while thumbnails are loading.
  const _apiQueue = [];
  let _apiActive = 0;
  let _mediaActive = 0;
  function _isMediaRead(route, path) {
    return /^(files\/download|files\/get_metadata)$/.test(route)
      && /\.(png|jpe?g|gif|webp|svg|bmp|avif|pdf|mp[34]|webm|mov|ogg|wav)$/i.test(String(path || ''));
  }
  function _drainApiQueue() {
    while (_apiActive < 4) {
      let index = _apiQueue.findIndex(item => !item.media);
      if (index < 0 && _mediaActive < 2) index = _apiQueue.findIndex(item => item.media);
      if (index < 0) break;
      const item = _apiQueue.splice(index, 1)[0];
      _apiActive += 1;
      if (item.media) _mediaActive += 1;
      Promise.resolve().then(item.run).then(item.resolve, item.reject).finally(() => {
        _apiActive -= 1;
        if (item.media) _mediaActive -= 1;
        _drainApiQueue();
      });
    }
  }
  function _queueApi(run, media) {
    return new Promise((resolve, reject) => {
      _apiQueue.push({ run, media, resolve, reject });
      _drainApiQueue();
    });
  }


  function _invalidateReadFolders() {
    _readFolderGeneration += 1;
    _readFolderCache.clear();
    _readFolderPending.clear();
  }

  function _dispatchSessionChanged(detail) {
    _apiSessionGeneration += 1;
    _accountRootInfo = null;
    _invalidateReadFolders();
    _rateLimitUntil = 0;
    try {
      window.dispatchEvent(new CustomEvent('meldex:dropbox-auth-session-changed', {
        detail: { ...(detail || {}) },
      }));
    } catch {}
  }

  function _notifySessionChanged(session, connected) {
    const detail = {
      connected: !!connected,
      accountId: String(session?.accountId || ''),
      savedAt: String(session?.savedAt || ''),
      remote: false,
    };
    _dispatchSessionChanged(detail);
    try {
      _authChannel?.postMessage?.({
        connected: detail.connected,
        accountId: detail.accountId,
        savedAt: detail.savedAt,
      });
    } catch {}
  }

  function _initializeAuthChannel() {
    if (typeof window.BroadcastChannel !== 'function' || typeof window.addEventListener !== 'function') return;
    try {
      _authChannel = new window.BroadcastChannel(AUTH_CHANNEL_NAME);
      _authChannel.addEventListener('message', (event) => {
        const data = event?.data;
        if (!data || typeof data !== 'object') return;
        _dispatchSessionChanged({
          connected: !!data.connected,
          accountId: String(data.accountId || ''),
          savedAt: String(data.savedAt || ''),
          remote: true,
        });
      });
    } catch {
      _authChannel = null;
    }
  }

  function _openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Dropbox 認証DBを開けません'));
    });
  }

  async function _idbGet(key) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('Dropbox 認証DB読み込み失敗'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  }

  async function _idbPut(key, value) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('Dropbox 認証DB保存失敗'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  }

  async function _idbDelete(key) {
    const db = await _openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('Dropbox 認証DB削除失敗'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  }

  function _normalizeVaultPath(path) {
    const normalized = String(path || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!normalized) return '';
    const withLeadingSlash = normalized.startsWith('/') ? normalized : ('/' + normalized);
    return withLeadingSlash === '/' ? '/' : withLeadingSlash.replace(/\/+$/, '');
  }

  function _readStorage(key, fallbackValue) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallbackValue : value;
    } catch {
      return fallbackValue;
    }
  }

  function _writeStorage(key, value) {
    if (value == null || value === '') {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, String(value));
  }

  function _accountIdFromAccount(account) {
    return String(account?.account_id || account?.accountId || '').trim();
  }

  function getAppMode() {
    const mode = _readStorage(APP_MODE_KEY, 'developer');
    return mode === 'custom' ? 'custom' : 'developer';
  }

  function setAppMode(mode) {
    _writeStorage(APP_MODE_KEY, mode === 'custom' ? 'custom' : 'developer');
  }

  function getCustomAppKey() {
    return _readStorage(CUSTOM_APP_KEY, '').trim();
  }

  function setCustomAppKey(value) {
    _writeStorage(CUSTOM_APP_KEY, String(value || '').trim());
  }

  function getVaultPath() {
    return _normalizeVaultPath(_readStorage(VAULT_PATH_KEY, DEFAULT_VAULT_PATH)) || DEFAULT_VAULT_PATH;
  }

  function setVaultPath(path) {
    _writeStorage(VAULT_PATH_KEY, _normalizeVaultPath(path) || DEFAULT_VAULT_PATH);
  }

  function getVaultNamespaceKind() {
    return _readStorage(VAULT_NAMESPACE_KEY, 'home') === 'team_root' ? 'team_root' : 'home';
  }

  function setVaultNamespaceKind(value) {
    _writeStorage(VAULT_NAMESPACE_KEY, value === 'team_root' ? 'team_root' : 'home');
  }

  function getSettingsPath() {
    return _normalizeVaultPath(_readStorage(SETTINGS_PATH_KEY, DEFAULT_SETTINGS_PATH)) || DEFAULT_SETTINGS_PATH;
  }

  function setSettingsPath(path) {
    _writeStorage(SETTINGS_PATH_KEY, _normalizeVaultPath(path) || DEFAULT_SETTINGS_PATH);
  }

  function _normalizeRedirectUri(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      return _stripOauthQuery(new URL(raw, window.location.href).toString());
    } catch {
      return '';
    }
  }

  function _redirectUriCandidates() {
    const config = window.MeldexCloudRuntimeConfig || {};
    return [
      window.location.href,
      config.cloudPublicUrl,
      config.cloudBackupUrl,
    ].map(_normalizeRedirectUri).filter(Boolean);
  }

  function _isLocalRedirectUri(uri) {
    try {
      const url = new URL(uri);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'http:') return false;
      if (host !== 'localhost' && host !== '127.0.0.1') return false;
      return url.port === '8080' || url.port === '8001';
    } catch {
      return false;
    }
  }

  function _redirectUriAllowed(value) {
    const normalized = _normalizeRedirectUri(value);
    if (!normalized) return false;
    if (_isLocalRedirectUri(normalized)) return true;
    return _redirectUriCandidates().includes(normalized);
  }

  function getRedirectOverride() {
    const stored = _readStorage(REDIRECT_OVERRIDE_KEY, '').trim();
    if (!stored) return '';
    const normalized = _normalizeRedirectUri(stored);
    if (normalized && _redirectUriAllowed(normalized)) return normalized;
    try {
      _writeStorage(REDIRECT_OVERRIDE_KEY, '');
    } catch {}
    return '';
  }

  function setRedirectOverride(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      _writeStorage(REDIRECT_OVERRIDE_KEY, '');
      return;
    }
    const normalized = _normalizeRedirectUri(raw);
    if (!normalized || !_redirectUriAllowed(normalized)) {
      throw new Error('redirect URI 上書きは、現在のCloud URL、予備URL、または許可されたlocalhost URLだけを指定できます');
    }
    _writeStorage(REDIRECT_OVERRIDE_KEY, normalized);
  }

  function getDefaultAppKey() {
    return DEFAULT_APP_KEY;
  }

  function getAppKey() {
    return getAppMode() === 'custom' ? getCustomAppKey() : getDefaultAppKey();
  }

  function getScopes() {
    return [...DEFAULT_SCOPES];
  }

  function hasConfiguredAppKey() {
    return !!getAppKey();
  }

  function _stripOauthQuery(urlText) {
    const url = new URL(urlText, window.location.href);
    [
      'code',
      'state',
      'error',
      'error_description',
      'uid',
      'token_type',
      'access_token',
      'scope',
    ].forEach((key) => url.searchParams.delete(key));
    url.hash = '';
    return url.toString();
  }

  function buildRedirectUri() {
    const override = getAppMode() === 'custom' ? getRedirectOverride() : '';
    if (override) return override;
    return _stripOauthQuery(window.location.href);
  }

  function _webCrypto() {
    return globalThis.crypto || globalThis.msCrypto || null;
  }

  function _base64UrlBytes(bytes) {
    let raw = '';
    bytes.forEach((value) => { raw += String.fromCharCode(value); });
    return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function _randomToken(byteLength) {
    const bytes = new Uint8Array(byteLength || 32);
    const cryptoApi = _webCrypto();
    if (typeof cryptoApi?.getRandomValues === 'function') {
      cryptoApi.getRandomValues(bytes);
    } else {
      let seed = Date.now() ^ Math.floor(Math.random() * 0xffffffff);
      for (let index = 0; index < bytes.length; index += 1) {
        seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + index) >>> 0;
        bytes[index] = (seed ^ Math.floor(Math.random() * 256)) & 0xff;
      }
    }
    return _base64UrlBytes(bytes);
  }

  function _utf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text || ''));
    const encoded = unescape(encodeURIComponent(String(text || '')));
    const bytes = new Uint8Array(encoded.length);
    for (let index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index) & 0xff;
    return bytes;
  }

  function _rightRotate(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function _sha256BytesFallback(bytes) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
    const data = new Uint8Array(paddedLength);
    data.set(bytes);
    data[bytes.length] = 0x80;
    const bitLength = bytes.length * 8;
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    data[paddedLength - 8] = (high >>> 24) & 0xff;
    data[paddedLength - 7] = (high >>> 16) & 0xff;
    data[paddedLength - 6] = (high >>> 8) & 0xff;
    data[paddedLength - 5] = high & 0xff;
    data[paddedLength - 4] = (low >>> 24) & 0xff;
    data[paddedLength - 3] = (low >>> 16) & 0xff;
    data[paddedLength - 2] = (low >>> 8) & 0xff;
    data[paddedLength - 1] = low & 0xff;

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const w = new Uint32Array(64);

    for (let chunk = 0; chunk < data.length; chunk += 64) {
      for (let index = 0; index < 16; index += 1) {
        const offset = chunk + index * 4;
        w[index] = ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const s0 = (_rightRotate(w[index - 15], 7) ^ _rightRotate(w[index - 15], 18) ^ (w[index - 15] >>> 3)) >>> 0;
        const s1 = (_rightRotate(w[index - 2], 17) ^ _rightRotate(w[index - 2], 19) ^ (w[index - 2] >>> 10)) >>> 0;
        w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
      }
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let index = 0; index < 64; index += 1) {
        const s1 = (_rightRotate(e, 6) ^ _rightRotate(e, 11) ^ _rightRotate(e, 25)) >>> 0;
        const ch = ((e & f) ^ ((~e) & g)) >>> 0;
        const temp1 = (h + s1 + ch + K[index] + w[index]) >>> 0;
        const s0 = (_rightRotate(a, 2) ^ _rightRotate(a, 13) ^ _rightRotate(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const temp2 = (s0 + maj) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    const out = new Uint8Array(32);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, index) => {
      const offset = index * 4;
      out[offset] = (word >>> 24) & 0xff;
      out[offset + 1] = (word >>> 16) & 0xff;
      out[offset + 2] = (word >>> 8) & 0xff;
      out[offset + 3] = word & 0xff;
    });
    return out;
  }

  async function _sha256Base64Url(text) {
    const data = _utf8Bytes(text);
    const subtle = _webCrypto()?.subtle || _webCrypto()?.webkitSubtle || null;
    if (typeof subtle?.digest === 'function') {
      try {
        return _base64UrlBytes(new Uint8Array(await subtle.digest('SHA-256', data)));
      } catch {}
    }
    return _base64UrlBytes(_sha256BytesFallback(data));
  }

  function _readPendingFrom(storage) {
    try {
      if (!storage) return null;
      const raw = storage.getItem(PENDING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const createdAt = Date.parse(parsed?.createdAt || '');
      if (createdAt && Date.now() - createdAt > PENDING_MAX_AGE_MS) {
        storage.removeItem(PENDING_KEY);
        if (_memoryPending?.createdAt === parsed?.createdAt) _memoryPending = null;
        return null;
      }
      return parsed || null;
    } catch {
      return null;
    }
  }

  function _savePending(value) {
    _memoryPending = value || null;
    const serialized = JSON.stringify(value);
    try {
      sessionStorage.setItem(PENDING_KEY, serialized);
    } catch {}
    try {
      localStorage.setItem(PENDING_KEY, serialized);
    } catch {}
  }

  function _readPendingFromMemory() {
    const createdAt = Date.parse(_memoryPending?.createdAt || '');
    if (createdAt && Date.now() - createdAt > PENDING_MAX_AGE_MS) {
      _memoryPending = null;
      return null;
    }
    return _memoryPending || null;
  }

  function _loadPending() {
    return _readPendingFromMemory() || _readPendingFrom(sessionStorage) || _readPendingFrom(localStorage);
  }

  function clearPending() {
    _memoryPending = null;
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch {}
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {}
  }

  function getPendingAuth() {
    const pending = _loadPending();
    if (!pending) return null;
    return {
      manual: !!pending.manual,
      createdAt: pending.createdAt || '',
      redirectUri: pending.redirectUri || '',
      appKey: pending.appKey || '',
    };
  }

  async function _tokenRequest(params) {
    const body = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value != null && value !== '') body.set(key, String(value));
    });
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {}
    if (!response.ok) {
      const detail = payload?.error_description || payload?.error || response.statusText || ('HTTP ' + response.status);
      throw new Error(detail);
    }
    return payload || {};
  }

  async function _persistSession(payload, meta) {
    const now = Date.now();
    const current = (await _idbGet(SESSION_KEY)) || {};
    const nextAccountId = String(payload.account_id || current.accountId || '').trim();
    const currentAccountId = _accountIdFromAccount(current.account);
    const canKeepAccount = !payload.account_id || !currentAccountId || currentAccountId === nextAccountId;
    const next = {
      accessToken: payload.access_token || current.accessToken || '',
      refreshToken: payload.refresh_token || current.refreshToken || '',
      tokenType: payload.token_type || current.tokenType || 'bearer',
      scope: payload.scope || current.scope || '',
      accountId: nextAccountId,
      expiresAt: payload.expires_in ? (now + (Number(payload.expires_in) * 1000)) : current.expiresAt || 0,
      appKey: meta?.appKey || current.appKey || getAppKey(),
      redirectUri: meta?.redirectUri != null ? meta.redirectUri : (current.redirectUri || ''),
      account: canKeepAccount ? (current.account || null) : null,
      savedAt: new Date(now).toISOString(),
    };
    await _idbPut(SESSION_KEY, next);
    _notifySessionChanged(next, true);
    return next;
  }

  async function getSession() {
    return _idbGet(SESSION_KEY);
  }

  async function clearSession() {
    _accountRootInfo = null;
    const current = await getSession().catch(() => null);
    await _idbDelete(SESSION_KEY);
    _notifySessionChanged(current, false);
  }

  async function exchangeCode(code, pending) {
    const safePending = pending || _loadPending();
    if (!safePending?.appKey || !safePending?.codeVerifier) {
      throw new Error('Dropbox接続の手続きが見つかりません。もう一度Dropboxに接続してください。');
    }
    const payload = await _tokenRequest({
      code: String(code || '').trim(),
      grant_type: 'authorization_code',
      client_id: safePending.appKey,
      code_verifier: safePending.codeVerifier,
      redirect_uri: safePending.redirectUri || '',
    });
    const session = await _persistSession(payload, {
      appKey: safePending.appKey,
      redirectUri: safePending.redirectUri || '',
    });
    clearPending();
    return session;
  }

  async function refreshSession(forceAppKey) {
    const session = await getSession();
    if (!session?.refreshToken) throw new Error('Dropbox接続情報が見つかりません。もう一度Dropboxに接続してください。');
    const appKey = forceAppKey || session.appKey || getAppKey();
    if (!appKey) throw new Error('Dropbox App key が設定されていません');
    const payload = await _tokenRequest({
      refresh_token: session.refreshToken,
      grant_type: 'refresh_token',
      client_id: appKey,
    });
    return _persistSession(payload, {
      appKey,
      redirectUri: session.redirectUri || '',
    });
  }

  function _normalizeNamespaceKind(value) {
    return value === 'team_root' ? 'team_root' : 'home';
  }

  function resolveFileLocation(path, namespaceKind) {
    const location = { path, namespaceKind: _normalizeNamespaceKind(namespaceKind) };
    const info = _accountRootInfo;
    const home = String(info?.home_path || '').replace(/\/+$/, '');
    // In the distinct-user-root model the desktop member folder is a mount
    // prefix, not a directory under the API root. Use the account's explicit
    // home mapping; never guess a prefix from a name or probe another folder.
    if (location.namespaceKind !== 'team_root' || info?.['.tag'] !== 'user'
      || !home || home === '/' || !info.root_namespace_id || !info.home_namespace_id
      || info.root_namespace_id === info.home_namespace_id) return location;
    const text = String(path || '');
    if (text.toLowerCase() !== home.toLowerCase() && !text.toLowerCase().startsWith(home.toLowerCase() + '/')) return location;
    return { path: text.slice(home.length) || '/', namespaceKind: 'home' };
  }

  function _pathRootHeaderFromAccount(account, namespaceKind) {
    if (_normalizeNamespaceKind(namespaceKind) !== 'team_root') return '';
    const rootInfo = account?.root_info || null;
    const rootNamespaceId = rootInfo?.root_namespace_id || '';
    // Dropbox also returns tag=user for accounts with distinct root/home
    // namespaces. An explicit root request must use its namespace ID in both
    // models, rather than silently falling back to the member home.
    if (!rootNamespaceId) return '';
    return JSON.stringify({ '.tag': 'root', root: rootNamespaceId });
  }

  async function getNamespaceContext(refresh) {
    const account = await getCurrentAccount(!!refresh);
    const rootInfo = account?.root_info || null;
    const isTeam = rootInfo?.['.tag'] === 'team'
      || (!!rootInfo?.root_namespace_id && !!rootInfo?.home_namespace_id
        && rootInfo.root_namespace_id !== rootInfo.home_namespace_id);
    return {
      accountId: String(account?.account_id || ''),
      isTeam,
      homeNamespaceId: String(rootInfo?.home_namespace_id || ''),
      rootNamespaceId: String(rootInfo?.root_namespace_id || ''),
    };
  }

  async function getPathRootHeader(namespaceKind) {
    const account = await getCurrentAccount(false);
    return _pathRootHeaderFromAccount(account, namespaceKind);
  }

  async function getValidSession() {
    let session = await getSession();
    if (!session?.accessToken) return null;
    const expiresAt = Number(session.expiresAt || 0);
    if (!expiresAt || (expiresAt - Date.now()) > EARLY_REFRESH_MS) return session;
    session = await refreshSession(session.appKey);
    return session;
  }

  async function getValidAccessToken() {
    const session = await getValidSession();
    return session?.accessToken || '';
  }

  async function beginAuth(options) {
    const settings = options || {};
    const appKey = getAppKey();
    if (!appKey) throw new Error('Dropbox App key が設定されていません');
    const codeVerifier = _randomToken(48);
    const state = _randomToken(24);
    const redirectUri = settings.manual ? '' : buildRedirectUri();
    const pending = {
      appKey,
      codeVerifier,
      state,
      redirectUri,
      manual: !!settings.manual,
      createdAt: new Date().toISOString(),
    };
    _savePending(pending);
    const challenge = await _sha256Base64Url(codeVerifier);
    const params = new URLSearchParams({
      client_id: appKey,
      response_type: 'code',
      token_access_type: 'offline',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      scope: getScopes().join(' '),
    });
    if (redirectUri) params.set('redirect_uri', redirectUri);
    if (settings.forceReapprove) params.set('force_reapprove', 'true');
    if (settings.forceReauthentication) params.set('force_reauthentication', 'true');
    return {
      authorizationUrl: AUTH_ENDPOINT + '?' + params.toString(),
      pending,
    };
  }

  async function exchangeManualCode(code) {
    return exchangeCode(code, _loadPending());
  }

  async function handleRedirectCallback() {
    const url = new URL(window.location.href);
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!error && !code) return { handled: false };
    const cleanUrl = _stripOauthQuery(window.location.href);
    history.replaceState(null, '', cleanUrl);
    if (error) {
      clearPending();
      const description = url.searchParams.get('error_description') || error;
      return { handled: true, ok: false, error: description };
    }
    const pending = _loadPending();
    if (!pending || pending.state !== state) {
      clearPending();
      return { handled: true, ok: false, error: 'Dropboxの接続確認に失敗しました。もう一度接続してください。' };
    }
    try {
      await exchangeCode(code, pending);
      return { handled: true, ok: true };
    } catch (err) {
      return { handled: true, ok: false, error: err?.message || String(err) };
    }
  }

  async function _readDropboxError(response) {
    const apiError = response.headers.get('dropbox-api-error') || '';
    let text = '';
    try {
      text = await response.text();
    } catch {}
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {}
    }
    return payload?.error_summary
      || payload?.error?.error_summary
      || payload?.error_description
      || payload?.error
      || apiError
      || text
      || response.statusText
      || ('HTTP ' + response.status);
  }

  function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function _retryAfterMs(response, attempt) {
    const retryAfter = Number(response?.headers?.get?.('retry-after') || 0);
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
    return Math.min(500 * (2 ** attempt), 4000);
  }

  async function _fetchDropboxWithRetry(label, fetcher, media) {
    const generation = _apiSessionGeneration;
    return _queueApi(() => _fetchDropboxAttempts(label, async () => {
      if (generation !== _apiSessionGeneration) throw new DOMException('Dropboxの接続先が変更されました', 'AbortError');
      const response = await fetcher();
      if (generation !== _apiSessionGeneration) throw new DOMException('Dropboxの接続先が変更されました', 'AbortError');
      return response;
    }), !!media);
  }

  async function _fetchDropboxAttempts(label, fetcher) {
    let lastError = null;
    for (let attempt = 0; attempt <= DROPBOX_API_MAX_RETRIES; attempt += 1) {
      try {
        while (_rateLimitUntil > Date.now()) await _sleep(Math.min(_rateLimitUntil - Date.now(), 60000));
        const response = await fetcher();
        if (response.status === 429) _rateLimitUntil = Math.max(_rateLimitUntil, Date.now() + _retryAfterMs(response, attempt));
        if (!response.ok && DROPBOX_RETRY_STATUSES.has(response.status) && attempt < DROPBOX_API_MAX_RETRIES) {
          await _sleep(_retryAfterMs(response, attempt));
          continue;
        }
        return response;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        lastError = err;
        if (attempt >= DROPBOX_API_MAX_RETRIES) break;
        await _sleep(Math.min(500 * (2 ** attempt), 4000));
      }
    }
    throw new Error(`${label || 'Dropbox API'} の呼び出しに失敗しました: ${lastError?.message || String(lastError)}`);
  }

  async function _fileApiHeaders(route, baseHeaders, options) {
    const headers = { ...(baseHeaders || {}) };
    if (/^files\//.test(String(route || ''))) {
      const pathRoot = await getPathRootHeader(options?.namespaceKind);
      if (pathRoot) headers['Dropbox-API-Path-Root'] = pathRoot;
    }
    return headers;
  }

  function _jsonHeaderValue(value) {
    return JSON.stringify(value || {}).replace(/[^\x20-\x7e]/g, (char) => {
      return '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
    });
  }

  async function _refreshAfterUnauthorized() {
    const session = await getSession();
    if (!session?.refreshToken) return false;
    try {
      await refreshSession(session.appKey);
      return true;
    } catch {
      return false;
    }
  }

  // Optional sidecars and management records are often absent. Check their
  // parent listing instead of using a failing download/get_metadata as an
  // existence probe. Share listings across adapters and concurrent callers.
  async function _readFolderEntries(path, options) {
    const namespaceKind = _normalizeNamespaceKind(options?.namespaceKind);
    const account = await getCurrentAccount(false);
    const namespaceId = account?.root_info?.[namespaceKind === 'team_root' ? 'root_namespace_id' : 'home_namespace_id'] || '';
    const key = JSON.stringify([account?.account_id || '', namespaceKind, namespaceId, path.toLowerCase()]);
    const cached = _readFolderCache.get(key);
    if (!options?.freshMissingCheck && cached?.until > Date.now()) return cached.entries;
    const pending = _readFolderPending.get(key);
    if (pending) return pending;
    const generation = _readFolderGeneration;
    const promise = (async () => {
      if (path && await _isMissingReadPath(path, options)) return new Map();
      let payload = await apiRpc('files/list_folder', { path, recursive: false, include_deleted: false }, { namespaceKind });
      const entries = new Map();
      for (;;) {
        for (const entry of payload.entries || []) {
          if (entry['.tag'] !== 'deleted') entries.set(String(entry.name || '').toLowerCase(), entry);
        }
        if (!payload.has_more) break;
        if (!payload.cursor) throw new Error('Dropboxのフォルダ一覧に継続カーソルがありません');
        payload = await apiRpc('files/list_folder/continue', { cursor: payload.cursor }, { namespaceKind });
      }
      if (generation === _readFolderGeneration && entries.size <= 4096) {
        if (_readFolderCache.size >= 128) _readFolderCache.delete(_readFolderCache.keys().next().value);
        _readFolderCache.set(key, { entries, until: Date.now() + 30000 });
      }
      return entries;
    })();
    _readFolderPending.set(key, promise);
    try { return await promise; }
    finally { if (_readFolderPending.get(key) === promise) _readFolderPending.delete(key); }
  }

  async function _isMissingReadPath(path, options) {
    // ID and namespace-relative paths cannot be checked through a parent.
    if (typeof path !== 'string' || !path.startsWith('/') || path === '/') return false;
    const normalized = path.replace(/\/+$/, '');
    const split = normalized.lastIndexOf('/');
    const entries = await _readFolderEntries(normalized.slice(0, split), options);
    return !entries.has(normalized.slice(split + 1).toLowerCase());
  }

  async function _guardMissingRead(path, options) {
    if (options?.checkMissing && await _isMissingReadPath(path, options)) {
      throw Object.assign(new Error('path/not_found/'), { status: 409, code: 'path_not_found' });
    }
  }

  async function apiRpc(route, body, options) {
    if (route === 'files/get_metadata' || route === 'files/list_folder') await _guardMissingRead(body?.path, options);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await getValidAccessToken();
      if (!token) throw new Error('Dropboxへもう一度接続してください');
      const response = await _fetchDropboxWithRetry(route, async () => fetch('https://api.dropboxapi.com/2/' + String(route || '').replace(/^\/+/, ''), {
        method: 'POST',
        headers: await _fileApiHeaders(route, {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        }, options),
        body: body == null ? 'null' : JSON.stringify(body),
      }), _isMediaRead(route, body?.path));
      if (response.ok) {
        if (/^files\/(?:create_folder|delete|move|copy|restore)/.test(route)) _invalidateReadFolders();
        let payload = null;
        try {
          payload = await response.json();
        } catch {}
        return payload;
      }
      if (response.status === 401 && attempt === 0 && await _refreshAfterUnauthorized()) {
        continue;
      }
      const detail = await _readDropboxError(response);
      if (response.status === 401) await clearSession();
      if (response.status === 409 && /^path\/not_found(?:\/|$)/i.test(String(detail))) _invalidateReadFolders();
      throw new Error(String(detail));
    }
    throw new Error('Dropboxへもう一度接続してください');
  }

  async function apiContent(route, arg, init, options) {
    if (route === 'files/download') await _guardMissingRead(arg?.path, options);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await getValidAccessToken();
      if (!token) throw new Error('Dropboxへもう一度接続してください');
      const requestInit = init ? { ...init } : {};
      requestInit.method = requestInit.method || 'POST';
      requestInit.headers = await _fileApiHeaders(route, {
        Authorization: 'Bearer ' + token,
        'Dropbox-API-Arg': _jsonHeaderValue(arg || {}),
        ...(requestInit.headers || {}),
      }, options);
      const response = await _fetchDropboxWithRetry(route, async () => {
        const result = await fetch('https://content.dropboxapi.com/2/' + String(route || '').replace(/^\/+/, ''), requestInit);
        // Keep the slot until the download body finishes, not just its headers.
        if (result.ok && route === 'files/download') {
          return new Response(await result.blob(), { status: result.status, statusText: result.statusText, headers: result.headers });
        }
        return result;
      }, _isMediaRead(route, arg?.path));
      if (response.ok) {
        if (/^files\/(?:upload|upload_session\/finish)/.test(route)) _invalidateReadFolders();
        return response;
      }
      if (response.status === 401 && attempt === 0 && await _refreshAfterUnauthorized()) {
        continue;
      }
      const detail = await _readDropboxError(response);
      if (response.status === 401) await clearSession();
      if (response.status === 409 && /^path\/not_found(?:\/|$)/i.test(String(detail))) _invalidateReadFolders();
      throw new Error(String(detail));
    }
    throw new Error('Dropboxへもう一度接続してください');
  }

  async function getCurrentAccount(refresh) {
    const session = await getSession();
    if (!refresh && session?.account) {
      _accountRootInfo = session.account.root_info || null;
      return session.account;
    }
    const account = await apiRpc('users/get_current_account', null);
    _accountRootInfo = account?.root_info || null;
    const latestSession = (await getSession()) || session;
    if (latestSession) {
      await _idbPut(SESSION_KEY, { ...latestSession, account });
    }
    return account;
  }

  async function getSpaceUsage() {
    return apiRpc('users/get_space_usage', null);
  }

  window.MeldexDropboxAuth = {
    getDefaultAppKey,
    getAppKey,
    getAppMode,
    setAppMode,
    getCustomAppKey,
    setCustomAppKey,
    hasConfiguredAppKey,
    getVaultPath,
    setVaultPath,
    getVaultNamespaceKind,
    setVaultNamespaceKind,
    getSettingsPath,
    setSettingsPath,
    getRedirectOverride,
    setRedirectOverride,
    isRedirectUriAllowed: _redirectUriAllowed,
    getScopes,
    buildRedirectUri,
    beginAuth,
    exchangeManualCode,
    exchangeCode,
    handleRedirectCallback,
    getSession,
    getValidSession,
    getValidAccessToken,
    clearSession,
    clearPending,
    getPendingAuth,
    refreshSession,
    getNamespaceContext,
    getPathRootHeader,
    resolveFileLocation,
    apiRpc,
    apiContent,
    getCurrentAccount,
    getSpaceUsage,
  };
  _initializeAuthChannel();
})();
