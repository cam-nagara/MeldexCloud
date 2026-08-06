const QUICK_MEMO_CACHE = 'meldex-quick-memo-v5';
const QUICK_MEMO_CACHE_PREFIX = 'meldex-quick-memo-';
const QUICK_MEMO_ASSETS = [
  'quick-memo.html',
  'quick-memo.css',
  'quick-memo.js',
  'quick-memo-editor.js',
  'quick-memo-drawing.js',
  'quick-memo-library.js',
  'gb-fonts.css',
  'gb-icon-assets.css',
  'gb-theme.css',
  'gb-ui.css',
  'standalone-shell.css',
  'standalone-workspace-tree.css',
  'standalone-profile.css',
  'gb-tooltip.css',
  'standalone-secondary-panel.css',
  'gb-split-loader.js',
  'vendor/lucide-icons.js',
  'meldex-core.js',
  'meldex-core.bundle.js',
  'meldex-core.bundle.part01.js',
  'meldex-core.bundle.part02.js',
  'meldex-core.bundle.part03.js',
  'meldex-core.bundle.part04.js',
  'meldex-core.bundle.part05.js',
  'meldex-core.part01.js',
  'meldex-core.part02.js',
  'meldex-core.part02.part01.js',
  'meldex-core.part02.part02.js',
  'meldex-core.part03.js',
  'gb-auto-tag-settings.js',
  'gb-global-tags.js',
  'gb-tag-preset-management.js',
  'gb-tag-panel-tabs.js',
  'gb-tag-tree-runtime.js',
  'gb-tag-management-overlays.js',
  'gb-tag-catalog-suggestions.js',
  'gb-tag-display-preferences.js',
  'gb-tag-group-summary.js',
  'gb-tag-tree-dnd.js',
  'gb-tag-management.js',
  'gb-data-access-dropbox-tag-csv.js',
  'gb-data-access-dropbox-tag-safety.js',
  'gb-data-access-dropbox-tags.js',
  'standalone-tags.js',
  'standalone-tags.css',
  'standalone-profile.js',
  'standalone-workspace-tree.js',
  'standalone-pwa-install.js',
  'standalone-app-bootstrap.js',
  'standalone-local-drafts.js',
  'standalone-offline-outbox.js',
  'gb-tooltip.js',
  'gb-tooltip.part01.js',
  'gb-tooltip.part02.js',
  'standalone-secondary-panel.js',
  'standalone-close-guard.js',
  'standalone-save-queue.js',
  'quick-memo.webmanifest',
  'MeldexQuickMemo_icon_256.png',
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
