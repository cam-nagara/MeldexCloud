// Meldex Service Worker — online-first PWA shell.
// 通常リソースは常にネットワーク優先。?v=<hash> 付き静的アセットだけ
// fingerprint 済みとして immutable cache に保存する。
const MELDEX_FINGERPRINT_CACHE = 'meldex-fingerprinted-v1';
const MELDEX_FINGERPRINT_MAX_ENTRIES = 256;
const MELDEX_UNIFIED_APP_CACHE = 'meldex-unified-app-shell-v1';
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
    self.clients.claim(),
  ]));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'MELDEX_SW_SKIP_WAITING') self.skipWaiting();
});

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
  if (isFingerprintRequest(event.request)) {
    event.respondWith(respondFingerprint(event.request));
    return;
  }
  if (!isUnifiedStandaloneRequest(event.request)) return;
  event.respondWith(respondUnifiedStandalone(event.request));
});

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
