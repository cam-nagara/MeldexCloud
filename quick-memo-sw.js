const QUICK_MEMO_CACHE = 'meldex-quick-memo-v2';
const QUICK_MEMO_CACHE_PREFIX = 'meldex-quick-memo-';
const QUICK_MEMO_ASSETS = [
  'quick-memo.html',
  'quick-memo.css',
  'quick-memo.js',
  'quick-memo.webmanifest',
  'Meldex_icon_32.png',
  'Meldex_icon_192.png',
  'Meldex_icon_512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(QUICK_MEMO_CACHE).then((cache) => cache.addAll(QUICK_MEMO_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(QUICK_MEMO_CACHE_PREFIX) && key !== QUICK_MEMO_CACHE)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !QUICK_MEMO_ASSETS.some((asset) => url.pathname.endsWith('/' + asset))) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(QUICK_MEMO_CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
