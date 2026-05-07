// Meldex Service Worker — online-first PWA shell.
// 通常リソースは常にネットワーク優先。?v=<hash> 付き静的アセットだけ
// fingerprint 済みとして immutable cache に保存する。
const MELDEX_FINGERPRINT_CACHE = 'meldex-fingerprinted-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

async function deleteOldFingerprintCaches() {
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith('meldex-fingerprinted-') && key !== MELDEX_FINGERPRINT_CACHE)
    .map((key) => caches.delete(key)));
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
  const cache = await caches.open(MELDEX_FINGERPRINT_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  if (!isFingerprintRequest(event.request)) return;
  event.respondWith(respondFingerprint(event.request));
});
