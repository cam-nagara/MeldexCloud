// Meldex Service Worker — online-first PWA shell.
// 通常リソースは常にネットワーク優先。?v=<hash> 付き静的アセットだけ
// fingerprint 済みとして immutable cache に保存する。
const MELDEX_FINGERPRINT_CACHE = 'meldex-fingerprinted-v1';
const MELDEX_FINGERPRINT_MAX_ENTRIES = 256;
const MELDEX_UNIFIED_APP_CACHE = 'meldex-unified-app-shell-v1';
const MELDEX_OFFLINE_META_CACHE = 'meldex-offline-shell-meta-v1';
const MELDEX_OFFLINE_CACHE_PREFIX = 'meldex-offline-shell-content-';
const MELDEX_OFFLINE_META_URL = new URL('./__meldex_offline_state__', self.registration.scope).href;
const MELDEX_OFFLINE_MANIFEST_URL = new URL('./offline-shell-manifest.json', self.registration.scope).href;
let activeOfflineCacheName = '';
let activeOfflineVersion = '';
const MELDEX_STANDALONE_ROUTES = Object.freeze([
  './apps/note/',
  './apps/scenario/',
  './apps/board/',
  './apps/sheet/',
  './apps/timer/',
  './apps/quick-memo/',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([
    self.skipWaiting(),
    caches.open(MELDEX_UNIFIED_APP_CACHE)
      .then((cache) => cache.addAll(MELDEX_STANDALONE_ROUTES.map(
        (path) => new Request(new URL(path, self.registration.scope).href, { cache: 'reload' })
      )))
      .catch((error) => console.warn('Meldex SW: unified app shell cache failed', error)),
  ]));
});

async function deleteOldFingerprintCaches() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('meldex-fingerprinted-') && key !== MELDEX_FINGERPRINT_CACHE)
      .map((key) => caches.delete(key)));
  } catch (e) {
    console.warn('Meldex SW: old cache cleanup failed', e);
  }
}

async function deleteOldUnifiedAppCaches() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('meldex-unified-app-shell-') && key !== MELDEX_UNIFIED_APP_CACHE)
      .map((key) => caches.delete(key)));
  } catch (e) {
    console.warn('Meldex SW: old unified app cache cleanup failed', e);
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    deleteOldFingerprintCaches(),
    deleteOldUnifiedAppCaches(),
    loadOfflineState(),
    self.clients.claim(),
  ]));
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type === 'MELDEX_SW_SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (!['MELDEX_OFFLINE_ENABLE', 'MELDEX_OFFLINE_DISABLE', 'MELDEX_OFFLINE_STATUS'].includes(type)) return;
  const reply = (payload) => {
    try { event.ports?.[0]?.postMessage(payload); } catch (_) {}
  };
  const task = (async () => {
    try {
      if (type === 'MELDEX_OFFLINE_ENABLE') return await enableOfflineShell();
      if (type === 'MELDEX_OFFLINE_DISABLE') return await disableOfflineShell();
      await loadOfflineState();
      return { ok: true, enabled: !!activeOfflineCacheName, cacheName: activeOfflineCacheName, version: activeOfflineVersion };
    } catch (error) {
      return { ok: false, enabled: !!activeOfflineCacheName, message: error?.message || String(error) };
    }
  })();
  event.waitUntil(task.then(reply));
});

async function loadOfflineState() {
  try {
    const cache = await caches.open(MELDEX_OFFLINE_META_CACHE);
    const response = await cache.match(MELDEX_OFFLINE_META_URL);
    const state = response ? await response.json() : null;
    const cacheName = String(state?.activeCacheName || '');
    activeOfflineCacheName = cacheName && await caches.has(cacheName) ? cacheName : '';
    activeOfflineVersion = activeOfflineCacheName ? String(state?.version || '') : '';
  } catch (error) {
    activeOfflineCacheName = '';
    activeOfflineVersion = '';
    console.warn('Meldex SW: offline state load failed', error);
  }
  return activeOfflineCacheName;
}

async function saveOfflineState(cacheName, manifest) {
  const cache = await caches.open(MELDEX_OFFLINE_META_CACHE);
  const state = {
    activeCacheName: cacheName,
    version: String(manifest?.version || ''),
    updatedAt: new Date().toISOString(),
  };
  await cache.put(MELDEX_OFFLINE_META_URL, new Response(JSON.stringify(state), {
    headers: { 'Content-Type': 'application/json' },
  }));
  activeOfflineCacheName = cacheName;
  activeOfflineVersion = state.version;
}

async function readOfflineManifest() {
  const response = await fetch(new Request(MELDEX_OFFLINE_MANIFEST_URL, { cache: 'no-store' }));
  if (!response.ok) throw new Error(`オフライン用ファイル一覧を取得できませんでした（HTTP ${response.status}）`);
  const manifest = await response.json();
  if (manifest?.type !== 'meldex-offline-shell' || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error('オフライン用ファイル一覧が不正です');
  }
  return manifest;
}

function offlineAssetRequest(path) {
  const url = new URL(String(path || '').replace(/^\/+/, ''), self.registration.scope);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL('.', self.registration.scope).pathname)) {
    throw new Error(`オフライン保存の対象外パスです: ${path}`);
  }
  return new Request(url.href, { cache: 'reload', credentials: 'same-origin' });
}

async function cacheOfflineAssets(cache, files) {
  const entries = new Map();
  files.forEach((item) => {
    const path = String(item?.path || item || '').trim();
    if (path) entries.set(path, typeof item === 'object' ? String(item.sha256 || '').toLowerCase() : '');
  });
  const assets = [...entries.entries()];
  for (let offset = 0; offset < assets.length; offset += 8) {
    const batch = assets.slice(offset, offset + 8);
    await Promise.all(batch.map(async ([path, expectedSha256]) => {
      const request = offlineAssetRequest(path);
      const response = await fetch(request);
      if (!response.ok) throw new Error(`オフライン用ファイルを取得できませんでした: ${path}（HTTP ${response.status}）`);
      if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
        throw new Error(`オフライン用ファイルの検証情報が不正です: ${path}`);
      }
      const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
      const actualSha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
      if (actualSha256 !== expectedSha256) {
        throw new Error(`オフライン用ファイルの整合性を確認できませんでした: ${path}`);
      }
      await cache.put(request, response);
    }));
  }
}

async function deleteInactiveOfflineCaches(activeName) {
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith(MELDEX_OFFLINE_CACHE_PREFIX) && key !== activeName)
    .map((key) => caches.delete(key)));
}

async function enableOfflineShell() {
  const manifest = await readOfflineManifest();
  await loadOfflineState();
  if (activeOfflineCacheName && activeOfflineVersion === String(manifest.version || '')) {
    return { ok: true, enabled: true, cacheName: activeOfflineCacheName, version: activeOfflineVersion, unchanged: true };
  }
  const version = String(manifest.version || Date.now()).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
  const stagingName = `${MELDEX_OFFLINE_CACHE_PREFIX}${version}-${Date.now()}`;
  await caches.delete(stagingName);
  const staging = await caches.open(stagingName);
  try {
    await cacheOfflineAssets(staging, manifest.files);
    await saveOfflineState(stagingName, manifest);
    await deleteInactiveOfflineCaches(stagingName).catch((error) => console.warn('Meldex SW: old offline cache cleanup failed', error));
    return { ok: true, enabled: true, cacheName: stagingName, fileCount: manifest.files.length };
  } catch (error) {
    if (activeOfflineCacheName !== stagingName) await caches.delete(stagingName);
    throw error;
  }
}

async function disableOfflineShell() {
  activeOfflineCacheName = '';
  activeOfflineVersion = '';
  const meta = await caches.open(MELDEX_OFFLINE_META_CACHE);
  await meta.delete(MELDEX_OFFLINE_META_URL);
  await deleteInactiveOfflineCaches('');
  return { ok: true, enabled: false };
}

function isFingerprintRequest(request) {
  if (!request || request.method !== 'GET') return false;
  let url;
  try { url = new URL(request.url); } catch (_) { return false; }
  if (url.origin !== self.location.origin) return false;
  if (!url.searchParams.get('v')) return false;
  return /\.(?:js|css|json|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|otf)$/i.test(url.pathname);
}

async function respondFingerprint(request) {
  let cache = null;
  try {
    cache = await caches.open(MELDEX_FINGERPRINT_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch (e) {
    console.warn('Meldex SW: cache read failed', e);
  }
  const response = await fetch(request);
  if (response && response.ok && cache) {
    try {
      await cache.put(request, response.clone());
      pruneFingerprintCache(cache, request).catch((e) => console.warn('Meldex SW: cache prune failed', e));
    } catch (e) {
      console.warn('Meldex SW: cache write failed', e);
    }
  }
  return response;
}

function fingerprintCacheAssetKey(request) {
  try {
    const url = new URL(request.url);
    return url.origin + url.pathname;
  } catch (_) {
    return '';
  }
}

function isRuntimeBustFingerprint(request) {
  try {
    const url = new URL(request.url);
    return /^\d{10,}$/.test(url.searchParams.get('v') || '');
  } catch (_) {
    return false;
  }
}

async function pruneFingerprintCache(cache, preferredRequest) {
  const requests = await cache.keys();
  const preferredKey = fingerprintCacheAssetKey(preferredRequest);
  const deleteTargets = [];

  if (preferredKey && isRuntimeBustFingerprint(preferredRequest)) {
    requests.forEach((req) => {
      if (req.url !== preferredRequest.url && fingerprintCacheAssetKey(req) === preferredKey && isRuntimeBustFingerprint(req)) {
        deleteTargets.push(req);
      }
    });
  }

  const remaining = requests.filter((req) => !deleteTargets.includes(req));
  const overflow = remaining.length - MELDEX_FINGERPRINT_MAX_ENTRIES;
  if (overflow > 0) {
    remaining
      .filter((req) => req.url !== preferredRequest.url)
      .slice(0, overflow)
      .forEach((req) => deleteTargets.push(req));
  }

  await Promise.all(deleteTargets.map((req) => cache.delete(req)));
}

self.addEventListener('fetch', (event) => {
  if (isOfflineShellRequest(event.request)) {
    event.respondWith(respondOfflineShell(event.request));
    return;
  }
  if (isFingerprintRequest(event.request)) {
    event.respondWith(respondFingerprint(event.request));
    return;
  }
  if (!isUnifiedStandaloneRequest(event.request)) return;
  event.respondWith(respondUnifiedStandalone(event.request));
});

function isOfflineShellRequest(request) {
  if (!request || request.method !== 'GET') return false;
  let url;
  try { url = new URL(request.url); } catch (_) { return false; }
  if (url.origin !== self.location.origin) return false;
  const apiPrefix = new URL('./api/', self.registration.scope).pathname;
  return !url.pathname.startsWith(apiPrefix);
}

async function respondOfflineShell(request) {
  const cacheName = activeOfflineCacheName || await loadOfflineState();
  if (!cacheName) return fetch(request);
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  return fetch(request);
}

function isUnifiedStandaloneRequest(request) {
  if (!request || request.method !== 'GET') return false;
  let url;
  let referrer;
  try {
    url = new URL(request.url);
    referrer = request.referrer ? new URL(request.referrer) : null;
  } catch (_) {
    return false;
  }
  if (url.origin !== self.location.origin) return false;
  const appPrefix = new URL('./apps/', self.registration.scope).pathname;
  const apiPrefix = new URL('./api/', self.registration.scope).pathname;
  if (url.pathname.startsWith(apiPrefix)) return false;
  return url.pathname.startsWith(appPrefix)
    || referrer?.pathname?.startsWith(appPrefix) === true;
}

async function respondUnifiedStandalone(request) {
  const cache = await caches.open(MELDEX_UNIFIED_APP_CACHE);
  try {
    const response = await fetch(request);
    if (response?.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}
