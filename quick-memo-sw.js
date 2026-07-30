const QUICK_MEMO_CACHE = 'meldex-quick-memo-v4';
const QUICK_MEMO_CACHE_PREFIX = 'meldex-quick-memo-';
const QUICK_MEMO_ASSETS = [
  'quick-memo.html',
  'quick-memo.css',
  'quick-memo.js',
  'quick-memo-editor.js',
  'quick-memo-drawing.js',
  'quick-memo-library.js',
  'gb-split-loader.js',
  'vendor/lucide-icons.js',
  'meldex-core.js',
  'meldex-core.bundle.js',
  'meldex-core.bundle.part01.js',
  'meldex-core.bundle.part02.js',
  'meldex-core.bundle.part03.js',
  'meldex-core.bundle.part04.js',
  'meldex-core.part01.js',
  'meldex-core.part02.js',
  'meldex-core.part02.part01.js',
  'meldex-core.part02.part02.js',
  'meldex-core.part03.js',
  'gb-auto-tag-settings.js',
  'gb-global-tags.js',
  'gb-tag-preset-management.js',
  'gb-tag-panel-tabs.js',
  'gb-tag-tree-dnd.js',
  'gb-tag-management.js',
  'gb-data-access-dropbox-tag-csv.js',
  'gb-data-access-dropbox-tag-safety.js',
  'gb-data-access-dropbox-tags.js',
  'standalone-tags.js',
  'standalone-tags.css',
  'standalone-profile.js',
  'standalone-profile.css',
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
