// Meldex Service Worker — online-first PWA shell.
// 通常リソースは常にネットワーク優先。?v=<hash> 付き静的アセットだけ
// fingerprint 済みとして immutable cache に保存する。
const MELDEX_FINGERPRINT_CACHE = 'meldex-fingerprinted-v1';
const MELDEX_FINGERPRINT_MAX_ENTRIES = 256;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
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

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    deleteOldFingerprintCaches(),
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
  if (!isFingerprintRequest(event.request)) return;
  event.respondWith(respondFingerprint(event.request));
});
