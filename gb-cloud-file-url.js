(function () {
  const CACHE = window.__MeldexPwaFileUrlCache = window.__MeldexPwaFileUrlCache || {};
  const PATH_MUTATION_HOOKS = window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];
  // Inline custom properties may store an unquoted URL immediately before
  // the CSS declaration separator. Filenames carry punctuation URL-encoded.
  const RAW_URL_RE = /\/(?:api\/)?file-raw\?[^"'\s);]+/g;
  const MEDIA_URL_RE = /\/(?:api\/)?media\/file\?[^"'\s);]+/g;
  const THUMB_URL_RE = /\/(?:api\/)?thumbnail\?[^"'\s);]+/g;
  const ARCHIVE_FILE_URL_RE = /\/(?:api\/)?archive\/file\?[^"'\s);]+/g;
  const BLOB_CACHE_MAX_BYTES = 24 * 1024 * 1024;
  const ELEMENT_REQUESTS = new WeakMap();
  const THUMBNAIL_FLIGHTS = new Map();
  const IMAGE_REFRESH_QUEUE = [];
  let imageRefreshCount = 0;
  let warmScopePending = null;

  function _queueImageRefresh(work) {
    return new Promise(resolve => {
      IMAGE_REFRESH_QUEUE.push({ work, resolve });
      const drain = () => {
        while (imageRefreshCount < 3 && IMAGE_REFRESH_QUEUE.length) {
          const job = IMAGE_REFRESH_QUEUE.shift();
          imageRefreshCount++;
          Promise.resolve().then(job.work).catch(() => null).then(job.resolve).finally(() => {
            imageRefreshCount--; drain();
          });
        }
      };
      drain();
    });
  }

  async function _warmImage(pathLike) {
    if (!_runtime()?.isDropboxMode?.()) return null;
    const normalized = _extractRawPath(pathLike);
    const key = _thumbnailCacheKey(pathLike) || normalized;
    const cached = CACHE[key] || CACHE[normalized];
    if (!cached?.mediaScope || !cached.url?.startsWith('blob:') || !/^image\//.test(cached.mime || '')) return null;
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!warmScopePending) {
      const pending = (async () => {
        const auth = window.MeldexDropboxAuth;
        const account = await auth?.getCurrentAccount(false);
        return account?.account_id ? JSON.stringify([
          account.account_id, account.root_info || {}, provider?.getVaultPath?.(),
          auth.getVaultNamespaceKind?.() || 'home',
        ]) : '';
      })();
      warmScopePending = pending;
      pending.finally(() => { if (warmScopePending === pending) warmScopePending = null; }).catch(() => {});
    }
    try {
      const scope = await warmScopePending;
      return (CACHE[key] === cached || CACHE[normalized] === cached) && scope === cached.mediaScope
        && cached.mediaLocation === JSON.stringify(provider?._dropboxLocation?.(normalized)) ? cached : null;
    } catch (_) { return null; }
  }

  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _normalizePath(path, options) {
    const opts = options || {};
    let normalized = String(path || '').replace(/\\/g, '/').trim();
    if (!normalized) return '';
    if (!opts.preserveAbsolute) {
      return normalized.replace(/^\/+/, '').replace(/\/+/g, '/');
    }
    if (/^[a-zA-Z]:\//.test(normalized)) {
      return normalized.replace(/\/+/g, '/');
    }
    if (normalized.startsWith('//')) {
      const body = normalized.slice(2).replace(/\/+/g, '/');
      return '//' + body;
    }
    return normalized.replace(/\/+/g, '/');
  }

  function _normalizeLocalPath(path) {
    return _normalizePath(path, { preserveAbsolute: !_runtime()?.isBrowserDataMode?.() });
  }

  function _isAppRelativeUrl(raw) {
    return /^\/(?:api|viewer(?:\.html)?|pdf-viewer(?:\.html)?|slideshow(?:\.html)?|Meldex(?:\.html)?|Meldex-dev(?:\.html)?|vendor|assets|data|icons)(?:\/|\?|#|$)/i.test(raw);
  }

  function _looksLikeFileRawUrl(value) {
    return !!value && (typeof window.MeldexResourceUrl?.isFileRawUrl === 'function'
      ? window.MeldexResourceUrl.isFileRawUrl(value)
      : /\/(?:api\/)?file-raw\?/.test(String(value || '')))
      || /\/(?:api\/)?media\/file\?/.test(String(value || ''))
      || /\/(?:api\/)?archive\/file\?/.test(String(value || ''));
  }

  // ZIP内のファイル（/archive/file?path=...&member=...）はarchivePathとmember
  // の2つを識別しないと読めないため、`zip:<archivePath>!/<member>` という
  // 合成キーへ変換し、以降は通常のfile-rawと同じキャッシュ・書き換え経路に乗せる。
  function _looksLikeArchiveFileUrl(value) {
    return !!value && /\/(?:api\/)?archive\/file\?/.test(String(value || ''));
  }

  function _archiveKeyFromUrl(value) {
    const raw = String(value || '').trim();
    if (!_looksLikeArchiveFileUrl(raw)) return '';
    try {
      const parsed = new URL(raw, document.baseURI || window.location.href);
      const archivePath = _normalizeLocalPath(parsed.searchParams.get('path') || '');
      const member = String(parsed.searchParams.get('member') || '');
      if (!archivePath) return '';
      return `zip:${archivePath}!/${member}`;
    } catch {
      return '';
    }
  }

  function _extractRawPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const archiveKey = _archiveKeyFromUrl(raw);
    if (archiveKey) return archiveKey;
    if (_looksLikeFileRawUrl(raw) || /\/(?:api\/)?thumbnail\?/.test(raw)) {
      try {
        const parsed = new URL(raw, document.baseURI || window.location.href);
        return _normalizeLocalPath(parsed.searchParams.get('path') || '');
      } catch {
        const match = /[?&]path=([^&#]+)/.exec(raw);
        if (match) {
          try { return _normalizeLocalPath(decodeURIComponent(match[1])); } catch {}
        }
      }
    }
    if (/^(https?:|data:|blob:)/i.test(raw)) return '';
    if (raw.startsWith('/') && _isAppRelativeUrl(raw)) return '';
    return _normalizeLocalPath(raw);
  }

  function _isDirectUrl(value) {
    const raw = String(value || '').trim();
    if (_looksLikeFileRawUrl(raw) && !_runtime()?.isBrowserDataMode?.()) {
      try {
        // Rebuilding a scoped Desktop URL from "path" alone loses its root
        // and may reuse another source's cached image with the same name.
        if (new URL(raw, document.baseURI || window.location.href).searchParams.has('context_path')) return true;
      } catch {}
    }
    if (_looksLikeFileRawUrl(raw) || /\/(?:api\/)?thumbnail\?/.test(raw)) return false;
    return /^(https?:|data:|blob:)/i.test(raw) || (raw.startsWith('/') && _isAppRelativeUrl(raw));
  }

  function _fallbackRawUrl(path) {
    const normalized = _normalizeLocalPath(path);
    if (!normalized) return '';
    return window.MeldexResourceUrl?.fileRaw
      ? window.MeldexResourceUrl.fileRaw(normalized)
      : ('/api/file-raw?path=' + encodeURIComponent(normalized));
  }

  function _mimeFromPath(path) {
    const ext = _normalizeLocalPath(path).split('.').pop().toLowerCase();
    return {
      png: 'image/png',
      apng: 'image/apng',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      jpe: 'image/jpeg',
      jfif: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      avif: 'image/avif',
      ico: 'image/x-icon',
      tif: 'image/tiff',
      tiff: 'image/tiff',
      heic: 'image/heic',
      heif: 'image/heif',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      pdf: 'application/pdf',
      html: 'text/html',
      htm: 'text/html',
      md: 'text/markdown',
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      js: 'text/javascript',
      css: 'text/css',
    }[ext] || 'application/octet-stream';
  }

  function _bytesToUrl(bytes, mime) {
    return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  }

  // Embedded viewers share the host's revision-checked image cache. Never
  // borrow across origins, accounts, namespace roots or vaults.
  async function _sharedImageOwner() {
    if (!_runtime()?.isDropboxMode?.() || !/\/viewer(?:\.html)?$/.test(location.pathname)) return null;
    try {
      const host = window.parent;
      if (!host || host === window || host.location.origin !== location.origin) return null;
      const owner = host.MeldexPwaFileUrl;
      const ownAuth = window.MeldexDropboxAuth;
      const hostAuth = host.MeldexDropboxAuth;
      if (!owner?.ensureDisplayUrl || !host.MeldexRuntimeAdapter?.isDropboxMode?.()) return null;
      const accounts = await Promise.all([ownAuth?.getCurrentAccount(false), hostAuth?.getCurrentAccount(false)]);
      const scope = (auth, account) => account?.account_id ? JSON.stringify([
        auth.getAppKey?.(), account.account_id, account.root_info || {},
        auth.getVaultPath?.(), auth.getVaultNamespaceKind?.() || 'home',
      ]) : '';
      const ownScope = scope(ownAuth, accounts[0]);
      return ownScope && ownScope === scope(hostAuth, accounts[1]) ? { owner, scope: ownScope } : null;
    } catch (_) { return null; }
  }

  async function _provider() {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) return null;
    await provider.restoreWorkspace?.();
    return provider;
  }

  // `_media/blobs/...` はホームフォルダからの相対で記録されているため、
  // ソースフォルダ直下として探すと必ず見つからない（シートの画像列が全滅する）。
  // gb-cloud-fetch.js が公開する探索先候補（ホームフォルダ基準→ソースフォルダ直下）を
  // 順に試す。未読込の環境では従来どおり1つだけ試す。
  async function _getFileWithMediaFallback(provider, normalized) {
    const candidates = typeof window.MeldexCloudMediaPath?.candidates === 'function'
      ? window.MeldexCloudMediaPath.candidates(normalized)
      : [normalized];
    let lastError = null;
    for (const candidate of candidates) {
      try {
        // Dropbox media downloads validate their revision before cache access.
        // Avoid a separate getFileHandle metadata round-trip for every image.
        if (typeof provider.downloadAsFile === 'function') return await provider.downloadAsFile(candidate);
        const handle = await provider.getFileHandle(candidate, { create: false });
        return await handle.getFile();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('ファイルを取得できませんでした: ' + normalized);
  }

  // ZIP内メンバーの表示URL（archivePath!/member から復元した実体をblob:化する）。
  // gb-archive-zip-engine.js（端末内保存／Dropboxの両バックエンドで共通）を使う。
  function _archiveOriginalUrl(zipKey, fallbackDirect) {
    const match = /^zip:([\s\S]*)!\/([\s\S]*)$/.exec(zipKey);
    if (!match) return fallbackDirect;
    return `/api/archive/file?path=${encodeURIComponent(match[1])}&member=${encodeURIComponent(match[2])}`;
  }

  async function _ensureArchiveRawUrl(zipKey, originalUrl, opts) {
    const cached = CACHE[zipKey];
    if (cached) return cached;
    const fallbackUrl = _archiveOriginalUrl(zipKey, originalUrl);
    if (!_runtime()?.isBrowserDataMode?.()) {
      return { path: zipKey, url: fallbackUrl };
    }
    const engine = window.MeldexArchiveZipEngine;
    const match = /^zip:([\s\S]*)!\/([\s\S]*)$/.exec(zipKey);
    if (!engine || !match) return { path: zipKey, url: fallbackUrl };
    const provider = await _provider();
    if (!provider) return { path: zipKey, url: fallbackUrl };
    let result;
    try {
      result = await engine.readArchiveMemberViaProvider(provider, match[1], match[2]);
    } catch (error) {
      console.warn('[archive] ZIP内ファイルを読み込めませんでした', error);
      return { path: zipKey, url: fallbackUrl };
    }
    const fileSize = result.bytes.length;
    if (fileSize > BLOB_CACHE_MAX_BYTES && !opts.allowLargeBlob) {
      delete CACHE[zipKey];
      return { path: zipKey, url: fallbackUrl, mime: result.mime, size: fileSize, streamed: true };
    }
    const url = _bytesToUrl(result.bytes, result.mime);
    const next = { path: zipKey, url, mime: result.mime, size: fileSize, modified: String(Date.now()) };
    CACHE[zipKey] = next;
    return next;
  }

  async function ensureRawUrl(pathLike, options) {
    const opts = options || {};
    const direct = String(pathLike || '').trim();
    if (!direct) return { path: '', url: '' };
    if (_isDirectUrl(direct)) return { path: '', url: direct };
    const normalized = _extractRawPath(direct);
    if (!normalized) return { path: '', url: direct };
    if (normalized.startsWith('zip:')) return _ensureArchiveRawUrl(normalized, direct, opts);
    if (!_runtime()?.isBrowserDataMode?.()) return { path: normalized, url: _fallbackRawUrl(normalized) };
    const shared = await _sharedImageOwner();
    if (shared) {
      const result = await shared.owner.ensureDisplayUrl(direct, opts);
      const current = await _sharedImageOwner();
      if (!current || current.owner !== shared.owner || current.scope !== shared.scope) {
        throw new Error('画像の取得中にDropboxの保存先が変更されました');
      }
      return result;
    }
    const provider = await _provider();
    if (!provider) return { path: normalized, url: _fallbackRawUrl(normalized) };
    const file = await _getFileWithMediaFallback(provider, normalized);
    const fileSize = Number(file.size || 0);
    const modified = String(file.lastModified || 0);
    const cached = CACHE[normalized];
    const identity = file.__meldexMediaKey || file;
    if (cached && cached.identity === identity && cached.modified === modified && cached.size === fileSize) return cached;
    // File/Blob URLs work for large files too; the desktop HTTP fallback is
    // absent on static Cloud. Avoid copying every image into an ArrayBuffer.
    const mime = file.type && file.type !== 'application/octet-stream' ? file.type : _mimeFromPath(normalized);
    const url = URL.createObjectURL(file.type === mime ? file : file.slice(0, file.size, mime));
    if (cached?.url && cached.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(cached.url); } catch {}
    }
    const next = { path: normalized, url, mime, size: fileSize, modified, identity,
      mediaScope: provider._mediaScope || '', mediaLocation: JSON.stringify(provider._dropboxLocation?.(normalized)) };
    CACHE[normalized] = next;
    return next;
  }

  function getCachedRawUrl(pathLike) {
    const direct = String(pathLike || '').trim();
    if (!direct) return '';
    if (_isDirectUrl(direct)) return direct;
    const normalized = _extractRawPath(direct);
    return normalized && CACHE[normalized] ? String(CACHE[normalized].url || '') : '';
  }

  function displayUrl(pathLike) {
    const direct = String(pathLike || '').trim();
    if (!direct) return '';
    if (_isDirectUrl(direct)) return direct;
    const normalized = _extractRawPath(direct);
    if (!normalized) return direct;
    if (normalized.startsWith('zip:')) {
      return getCachedRawUrl(normalized) || _archiveOriginalUrl(normalized, direct);
    }
    return getCachedRawUrl(normalized) || _fallbackRawUrl(normalized);
  }

  function _thumbnailSize(pathLike) {
    if (!/\/(?:api\/)?thumbnail\?/.test(String(pathLike))) return 0;
    try { return Math.max(64, Math.min(1024, Number(new URL(pathLike, document.baseURI).searchParams.get('size')) || 256)); }
    catch (_) { return 256; }
  }

  function _thumbnailCacheKey(pathLike) {
    const size = _thumbnailSize(pathLike);
    return size ? _extractRawPath(pathLike) + '#thumbnail-' + size : '';
  }

  // ---- 縮小表示のまとめ取り（2026-11-26 利用者報告「画像列のサムネイルが何十分も出ない」） ----
  // 以前は1枚ごとに「親フォルダの一覧（存在確認）・ファイルの確認・縮小表示」の3回を、画像用の枠（同時2本）で
  // 頼んだ順に送っていた。疑似Dropbox（1回0.4秒）の3000件のシートで、最初の画面に15.8秒、10画面スクロールした先の
  // 画面に45秒かかり、見えなくなった行の分が先に処理されていた。Dropbox の回数制限に当たると更に何倍にもなる。
  // ・1回の通信で最大25枚まとめて取る（files/get_thumbnail_batch。版番号も同じ応答で返る）。
  // ・後から頼まれた分（今見えている画面）を先に送る。画面から外れた分は後回しにする。
  // ・ファイル名が中身の指紋（_media/blobs/xx/<64桁>）の画像は中身が変わらないので、端末内の控えを確認なしで使う。
  const THUMB_BATCH_MAX = 25;
  const THUMB_BATCH_EXTS = /\.(?:jpe?g|png|tiff?|gif|webp|ppm|bmp)$/i;
  const IMMUTABLE_MEDIA_RE = /(?:^|\/)_media\/(?:blobs|thumbs)\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]+$/i;
  const THUMB_BATCH_QUEUE = [];
  let thumbBatchTimer = null;
  let thumbBatchActive = 0;
  let thumbBatchSeq = 0;

  function _thumbDimensions(size) {
    const pixels = Math.max(64, Math.min(1024, Number(size) || 256));
    return pixels <= 64 ? 'w64h64' : pixels <= 128 ? 'w128h128' : pixels <= 256 ? 'w256h256'
      : pixels <= 480 ? 'w640h480' : pixels <= 768 ? 'w1024h768' : 'w2048h1536';
  }

  async function _thumbScope(provider) {
    const auth = window.MeldexDropboxAuth;
    const account = await auth?.getCurrentAccount?.(false);
    if (!account?.account_id) throw new Error('Dropboxへもう一度接続してください');
    return JSON.stringify([account.account_id, account.root_info || {}, provider?.getVaultPath?.(), auth.getVaultNamespaceKind?.() || 'home']);
  }

  function _thumbLocation(provider, candidate) {
    const location = provider._dropboxLocation(candidate);
    return window.MeldexDropboxAuth?.resolveFileLocation?.(location.path, location.namespaceKind) || location;
  }

  async function _thumbPersistKey(scope, location, size) {
    const text = ['thumb-v2', scope, location.namespaceKind || '', location.path, size].join('\n');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    return new URL('./__meldex_thumbnail_cache__/' + hash, document.baseURI).href;
  }

  function _thumbBlobFromBase64(text) {
    const binary = atob(String(text || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: 'image/png' });
  }

  function _thumbBatchSupported(provider, normalized) {
    return !!(_runtime()?.isDropboxMode?.() && typeof window.MeldexDropboxAuth?.apiThumbnailBatch === 'function'
      && typeof provider?._dropboxLocation === 'function' && THUMB_BATCH_EXTS.test(normalized));
  }

  function _scheduleThumbBatch() {
    if (thumbBatchTimer || !THUMB_BATCH_QUEUE.length || thumbBatchActive >= 2) return;
    // 同じ描画で並ぶ画像をまとめるため、わずかに待ってから送る。
    thumbBatchTimer = setTimeout(() => { thumbBatchTimer = null; _flushThumbBatch(); }, 30);
  }

  function _takeThumbBatch() {
    // 画面に残っている要求を先に、その中では新しい順に。外れたものは後回し（消さない: 戻ってきた時に要る）。
    const visible = job => !job.element || job.element.isConnected;
    const order = [...THUMB_BATCH_QUEUE].sort((a, b) => Number(visible(b)) - Number(visible(a)) || b.seq - a.seq);
    const namespaceKind = order[0].location.namespaceKind || 'home';
    const picked = order.filter(job => (job.location.namespaceKind || 'home') === namespaceKind).slice(0, THUMB_BATCH_MAX);
    picked.forEach(job => THUMB_BATCH_QUEUE.splice(THUMB_BATCH_QUEUE.indexOf(job), 1));
    return { namespaceKind, picked };
  }

  function _flushThumbBatch() {
    while (THUMB_BATCH_QUEUE.length && thumbBatchActive < 2) {
      const { namespaceKind, picked } = _takeThumbBatch();
      thumbBatchActive += 1;
      (async () => {
        let results;
        try {
          results = await window.MeldexDropboxAuth.apiThumbnailBatch(picked.map(job => ({
            path: job.location.path, format: 'png', size: job.dimensions, mode: 'strict',
          })), { namespaceKind });
        } catch (error) {
          picked.forEach(job => job.reject(error));
          return;
        }
        picked.forEach((job, index) => {
          const entry = results[index];
          if (entry?.['.tag'] === 'success' && entry.thumbnail) {
            job.resolve({ blob: _thumbBlobFromBase64(entry.thumbnail), rev: entry.metadata?.rev || '' });
            return;
          }
          const failure = entry?.failure || {};
          const notFound = /not_found/.test(JSON.stringify(failure));
          job.reject(Object.assign(new Error(notFound ? 'path/not_found/' : 'thumbnail/' + (failure['.tag'] || 'failed')), { notFound }));
        });
      })().finally(() => { thumbBatchActive -= 1; _scheduleThumbBatch(); });
    }
  }

  function _queueThumbBatch(location, size, element) {
    return new Promise((resolve, reject) => {
      THUMB_BATCH_QUEUE.push({ location, dimensions: _thumbDimensions(size), element, resolve, reject, seq: ++thumbBatchSeq });
      _scheduleThumbBatch();
    });
  }

  async function _ensureBatchedThumbnailUrl(provider, pathLike, normalized, size, options) {
    const scope = await _thumbScope(provider);
    const key = _thumbnailCacheKey(pathLike);
    const immutable = IMMUTABLE_MEDIA_RE.test(normalized);
    const memory = CACHE[key];
    if (immutable && memory?.batch && memory.mediaScope === scope) return memory;
    const candidates = window.MeldexCloudMediaPath?.candidates?.(normalized) || [normalized];
    let lastError = null;
    for (const candidate of candidates) {
      const location = _thumbLocation(provider, candidate);
      const persistentKey = immutable && globalThis.crypto?.subtle ? await _thumbPersistKey(scope, location, size) : '';
      const flightKey = persistentKey || JSON.stringify([scope, location.namespaceKind, location.path, size]);
      let work = THUMBNAIL_FLIGHTS.get(flightKey);
      const owner = !work;
      if (owner) {
        work = (async () => {
          let cache = null, blob = null, rev = '';
          if (persistentKey && globalThis.caches) {
            try {
              cache = await caches.open('meldex-image-thumbnails-v2');
              blob = await (await cache.match(persistentKey))?.blob() || null;
            } catch (_) {}
          }
          const retained = !!blob;
          if (!blob) ({ blob, rev } = await _queueThumbBatch(location, size, options?.element));
          if (await _thumbScope(provider) !== scope) throw new Error('画像の取得中にDropboxの接続先が変更されました');
          // 中身の変わる画像は、同じ版なら前の表示を使い回す（画面の作り直しで点滅させない）。
          const current = CACHE[key];
          if (!immutable && current?.batch && current.rev === rev && current.mediaScope === scope) return current;
          if (cache && !retained) {
            try { await cache.put(persistentKey, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/png' } })); } catch (_) {}
          }
          const url = URL.createObjectURL(blob);
          const next = { path: normalized, cacheKey: key, url, mime: blob.type || 'image/png', size: blob.size, batch: true, rev,
            identity: 'batch:' + (persistentKey || rev), mediaScope: scope,
            mediaLocation: JSON.stringify(provider._dropboxLocation(normalized)) };
          CACHE[key] = next;
          if (current?.url?.startsWith('blob:') && current.url !== url) URL.revokeObjectURL(current.url);
          return next;
        })();
        THUMBNAIL_FLIGHTS.set(flightKey, work);
      }
      try {
        return await work;
      } catch (error) {
        lastError = error;
        if (!error?.notFound) throw error;
      } finally {
        if (owner && THUMBNAIL_FLIGHTS.get(flightKey) === work) THUMBNAIL_FLIGHTS.delete(flightKey);
      }
    }
    throw lastError || new Error('path/not_found/');
  }

  async function _ensureThumbnailUrl(pathLike, options) {
    const normalized = _extractRawPath(pathLike), size = _thumbnailSize(pathLike);
    const provider = await _provider();
    if (!_runtime()?.isDropboxMode?.() || !provider?._mediaCacheRecord
        || !/\.(?:png|jpe?g|webp|bmp|avif|gif|tiff?|ppm|svg|heic|heif)$/i.test(normalized)) {
      return ensureRawUrl(pathLike, options);
    }
    if (_thumbBatchSupported(provider, normalized)) {
      try {
        return await _ensureBatchedThumbnailUrl(provider, pathLike, normalized, size, options);
      } catch (error) {
        // 変換できない画像だけは従来の取り方（原寸から端末内で縮小）へ戻す。通信の失敗はそのまま返す
        // （1枚ずつの取り直しは回数制限を悪化させる）。
        if (!/^thumbnail\/(?:unsupported_extension|unsupported_image|conversion_error)/.test(String(error?.message || ''))) throw error;
      }
    }
    const candidates = window.MeldexCloudMediaPath?.candidates?.(normalized) || [normalized];
    let media, mediaPath, lastError;
    for (const candidate of candidates) {
      try {
        media = await provider._mediaCacheRecord(candidate);
        mediaPath = candidate;
        break;
      } catch (error) {
        if (!/path\/not_found|path_not_found|ファイルが見つかりません/.test(String(error?.message || ''))) throw error;
        lastError = error;
      }
    }
    if (!mediaPath) throw lastError;
    if (!media?.key) return ensureRawUrl(pathLike, options);
    const key = _thumbnailCacheKey(pathLike), persistentKey = media.key + '/thumbnail-v1-' + size;
    const memory = CACHE[key];
    if (memory?.identity === persistentKey) return memory;
    if (THUMBNAIL_FLIGHTS.has(persistentKey)) return THUMBNAIL_FLIGHTS.get(persistentKey);
    const work = (async () => {
      let cache, blob;
      try { cache = await caches.open('meldex-image-thumbnails-v1'); blob = await (await cache.match(persistentKey))?.blob(); } catch (_) {}
      const retained = !!blob;
      if (!blob) {
        blob = await provider._downloadThumbnail?.(mediaPath, size, media);
        const remote = !!blob;
        if (typeof createImageBitmap !== 'function') {
          if (!remote) return ensureRawUrl(pathLike, options);
        } else {
          const file = blob || await _getFileWithMediaFallback(provider, mediaPath);
          let bitmap;
          try {
            bitmap = await createImageBitmap(file);
            const scale = Math.min(1, size / bitmap.width, size / bitmap.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')) || blob;
          } catch (_) { if (!remote) return ensureRawUrl(pathLike, options); }
          finally { bitmap?.close(); }
        }
        if (!blob) return ensureRawUrl(pathLike, options);
      }
      const current = await provider._mediaCacheRecord(mediaPath);
      if (current?.key !== media.key || current?.scope !== media.scope
          || provider._mediaScope !== media.scope) throw new Error('画像の取得中に接続先またはファイルの版が変更されました');
      // Reuse the existing bounded background trim, in a separate local store.
      if (cache && !retained) await provider._persistCachedFile({ cache, key: persistentKey, documentFile: true, maxBytes: 128 * 1024, maxEntries: 1024 }, blob);
      const published = await provider._mediaCacheRecord(mediaPath);
      if (published?.key !== media.key || published?.scope !== media.scope || provider._mediaScope !== media.scope) {
        throw new Error('画像の取得中に接続先またはファイルの版が変更されました');
      }
      const url = URL.createObjectURL(blob);
      const next = { path: normalized, cacheKey: key, url, mime: blob.type, size: blob.size,
        identity: persistentKey, mediaScope: media.scope, mediaLocation: JSON.stringify(provider._dropboxLocation(normalized)) };
      CACHE[key] = next;
      if (memory?.url?.startsWith('blob:')) URL.revokeObjectURL(memory.url);
      return next;
    })();
    THUMBNAIL_FLIGHTS.set(persistentKey, work);
    try { return await work; }
    finally { if (THUMBNAIL_FLIGHTS.get(persistentKey) === work) THUMBNAIL_FLIGHTS.delete(persistentKey); }
  }

  async function ensureDisplayUrl(pathLike, options) {
    const direct = String(pathLike || '').trim();
    if (!direct) return { path: '', url: '' };
    if (_isDirectUrl(direct)) return { path: '', url: direct };
    if (_thumbnailSize(direct) && _runtime()?.isBrowserDataMode?.()) return _ensureThumbnailUrl(direct, options);
    return ensureRawUrl(direct, options);
  }

  function _sameResourceUrl(left, right) {
    const a = String(left || '').trim();
    const b = String(right || '').trim();
    if (a === b) return true;
    if (!a || !b) return false;
    try {
      return new URL(a, document.baseURI || window.location.href).href === new URL(b, document.baseURI || window.location.href).href;
    } catch {
      return false;
    }
  }

  function _setElementUrlIfChanged(element, propName, nextValue) {
    const next = String(nextValue || '');
    if (!element || !next) return false;
    const currentProp = String(element[propName] || '');
    const currentAttr = String(element.getAttribute?.(propName) || '');
    if (_sameResourceUrl(currentProp, next) || _sameResourceUrl(currentAttr, next)) return false;
    element[propName] = next;
    return true;
  }

  function applyToElement(element, pathLike, propName) {
    const target = element;
    const prop = propName || 'src';
    if (!target) return Promise.resolve({ path: '', url: '' });
    const requests = ELEMENT_REQUESTS.get(target) || {};
    const request = {};
    requests[prop] = request;
    ELEMENT_REQUESTS.set(target, requests);
    const current = displayUrl(pathLike);
    // A browser has no native /api/file-raw endpoint. Wait for the provider
    // URL instead of starting a doomed HTTP request before the blob is ready.
    if (current && !_runtime()?.isBrowserDataMode?.()) {
      _setElementUrlIfChanged(target, prop, current);
    }
    return _warmImage(pathLike).then(cached => {
      const ownsTarget = () => target.isConnected && requests[prop] === request;
      if (cached && ownsTarget()) _setElementUrlIfChanged(target, prop, cached.url);
      const refresh = () => {
        if (cached && !ownsTarget()) return cached;
        return ensureDisplayUrl(pathLike, { element: target }).then(info => {
          if (ownsTarget() && info?.url) _setElementUrlIfChanged(target, prop, info.url);
          return info;
        }).catch(error => {
          // Keep the last image through temporary network failures, but never
          // keep a confirmed deleted/inaccessible file visible.
          if (cached && /path\/(?:not_found|no_permission)|path_not_found|invalid_access_token|expired_access_token|再度接続|もう一度接続|保存先が変更|接続先が変更/.test(String(error?.message || error?.code || ''))) {
            if (CACHE[cached.cacheKey || cached.path] === cached) _clearCachePath(cached.path, false);
            if (ownsTarget()) {
              target.removeAttribute(prop);
              target.dispatchEvent(new Event('error'));
            }
            return { path: '', url: '' };
          }
          return cached || { path: '', url: '' };
        });
      };
      const refreshing = cached ? _queueImageRefresh(refresh) : refresh();
      return cached || refreshing;
    });
  }

  function _clearCachePath(path, isFolder) {
    const normalized = _normalizeLocalPath(path);
    Object.keys(CACHE).forEach((key) => {
      if (key === normalized || CACHE[key]?.path === normalized || (isFolder && key.startsWith(normalized + '/'))) {
        const url = CACHE[key]?.url;
        if (url && url.startsWith('blob:')) {
          try { URL.revokeObjectURL(url); } catch {}
        }
        delete CACHE[key];
      }
    });
  }

  function _rewriteInternalPath(value) {
    return window.MeldexResourceUrl?.rewriteInternalUrl?.(value) || value;
  }

  function _setAttrIfChanged(element, attrName, nextValue) {
    const next = String(nextValue || '');
    if (!next) return false;
    if (String(element.getAttribute(attrName) || '') === next) return false;
    element.setAttribute(attrName, next);
    return true;
  }

  function _rewriteAttr(element, attrName) {
    const raw = element.getAttribute(attrName);
    if (!raw) return;
    const isThumbnail = /\/(?:api\/)?thumbnail\?/.test(raw);
    if (!_runtime()?.isBrowserDataMode?.() && _looksLikeFileRawUrl(raw)) {
      try {
        // This query selects the script-free HTML response policy. Rebuilding
        // its URL from just "path" would restore the opaque, image-blocking view.
        if (new URL(raw, document.baseURI || window.location.href).searchParams.get('static_preview') === '1') return;
      } catch {}
    }
    if (_looksLikeFileRawUrl(raw) || isThumbnail) {
      if (isThumbnail && !_runtime()?.isBrowserDataMode?.()) return;
      applyToElement(element, raw, attrName === 'href' ? 'href' : attrName);
      return;
    }
    if (/\/viewer(\.html)?\?/.test(raw) || /\/(?:pdf-viewer|slideshow)(\.html)?\?/.test(raw)) {
      _setAttrIfChanged(element, attrName, _rewriteInternalPath(raw));
      return;
    }
    if (/\/api\/team\/avatar\//.test(raw)) {
      try {
        const parsed = new URL(raw, document.baseURI || window.location.href);
        const name = decodeURIComponent(parsed.pathname.split('/').pop() || '');
        const folder = parsed.searchParams.get('folder') || '';
        const next = window.MeldexDataAccess?.team?.avatarUrl?.(name, { folder }) || raw;
        if (next) _setAttrIfChanged(element, attrName, next);
      } catch {}
      return;
    }
    if (/\/api\/auth\/avatar\//.test(raw)) {
      try {
        const parsed = new URL(raw, document.baseURI || window.location.href);
        const name = decodeURIComponent(parsed.pathname.split('/').pop() || '');
        const next = window.MeldexDataAccess?.team?.authAvatarUrl?.(name, {}) || raw;
        if (next) _setAttrIfChanged(element, attrName, next);
      } catch {}
    }
  }

  function _rewriteStyle(element) {
    const styleValue = element.getAttribute('style');
    if (!styleValue || (!RAW_URL_RE.test(styleValue) && !MEDIA_URL_RE.test(styleValue) && !THUMB_URL_RE.test(styleValue) && !ARCHIVE_FILE_URL_RE.test(styleValue))) {
      RAW_URL_RE.lastIndex = 0;
      MEDIA_URL_RE.lastIndex = 0;
      THUMB_URL_RE.lastIndex = 0;
      ARCHIVE_FILE_URL_RE.lastIndex = 0;
      return;
    }
    RAW_URL_RE.lastIndex = 0;
    MEDIA_URL_RE.lastIndex = 0;
    THUMB_URL_RE.lastIndex = 0;
    ARCHIVE_FILE_URL_RE.lastIndex = 0;
    // Custom properties are also persisted as theme settings. Their source
    // references must survive reload; only rendered CSS uses transient blobs.
    const sourceValues = Array.from(element.style || [])
      .filter(name => name.startsWith('--'))
      .map(name => element.style.getPropertyValue(name).trim());
    const rawMatches = [...styleValue.matchAll(RAW_URL_RE), ...styleValue.matchAll(MEDIA_URL_RE), ...styleValue.matchAll(THUMB_URL_RE), ...styleValue.matchAll(ARCHIVE_FILE_URL_RE)];
    rawMatches.forEach((match) => {
      const urlText = match[0];
      if (sourceValues.some(value => value === urlText || value.endsWith(urlText))) return;
      ensureDisplayUrl(urlText).then((info) => {
        const current = element.getAttribute('style') || '';
        if (!current.includes(urlText) || !info?.url) return;
        const next = current.replaceAll(urlText, info.url);
        if (next !== current) element.setAttribute('style', next);
      }).catch(() => {});
    });
  }

  function _processElement(element) {
    if (!(element instanceof HTMLElement)) return;
    ['src', 'href'].forEach((attrName) => {
      if (element.hasAttribute(attrName)) _rewriteAttr(element, attrName);
    });
    if (element.hasAttribute('style')) _rewriteStyle(element);
  }

  function _processNode(node) {
    if (!(node instanceof HTMLElement)) return;
    _processElement(node);
    node.querySelectorAll?.('[src],[href],[style]').forEach((element) => _processElement(element));
  }

  function _startObserver() {
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === 'attributes' && record.target instanceof HTMLElement) _processElement(record.target);
        record.addedNodes.forEach((node) => _processNode(node));
      });
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'href', 'style'],
    });
    _processNode(document.body || document.documentElement);
  }

  PATH_MUTATION_HOOKS.push(async (event) => {
    const oldPath = _normalizeLocalPath(event?.oldPath || event?.path || '');
    const newPath = _normalizeLocalPath(event?.newPath || '');
    if (!oldPath) return;
    if (event?.action === 'delete' || !newPath) {
      _clearCachePath(oldPath, !!event?.isFolder);
      return;
    }
    Object.keys(CACHE).forEach((key) => {
      if (CACHE[key]?.cacheKey && (CACHE[key].path === oldPath || event?.isFolder && CACHE[key].path.startsWith(oldPath + '/'))) {
        try { URL.revokeObjectURL(CACHE[key].url); } catch (_) {}
        delete CACHE[key];
        return;
      }
      if (key === oldPath || (event?.isFolder && key.startsWith(oldPath + '/'))) {
        const rewritten = key === oldPath ? newPath : (newPath + key.slice(oldPath.length));
        CACHE[rewritten] = { ...CACHE[key], path: rewritten };
        delete CACHE[key];
      }
    });
  });

  window.MeldexPwaFileUrl = window.MeldexPwaFileUrl || {
    extractPath: _extractRawPath,
    ensureRawUrl,
    ensureDisplayUrl,
    getCachedRawUrl,
    displayUrl,
    applyToElement,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _startObserver, { once: true });
  else _startObserver();
})();
