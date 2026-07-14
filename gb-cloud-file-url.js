(function () {
  const CACHE = window.__MeldexPwaFileUrlCache = window.__MeldexPwaFileUrlCache || {};
  const PATH_MUTATION_HOOKS = window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];
  const RAW_URL_RE = /\/(?:api\/)?file-raw\?[^"' )]+/g;
  const MEDIA_URL_RE = /\/(?:api\/)?media\/file\?[^"' )]+/g;
  const THUMB_URL_RE = /\/(?:api\/)?thumbnail\?[^"' )]+/g;
  const BLOB_CACHE_MAX_BYTES = 24 * 1024 * 1024;

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
    return _normalizePath(path, { preserveAbsolute: !_runtime()?.isDropboxMode?.() });
  }

  function _isAppRelativeUrl(raw) {
    return /^\/(?:api|viewer(?:\.html)?|pdf-viewer(?:\.html)?|slideshow(?:\.html)?|Meldex(?:\.html)?|Meldex-dev(?:\.html)?|vendor|assets|data|icons)(?:\/|\?|#|$)/i.test(raw);
  }

  function _looksLikeFileRawUrl(value) {
    return !!value && (typeof window.MeldexResourceUrl?.isFileRawUrl === 'function'
      ? window.MeldexResourceUrl.isFileRawUrl(value)
      : /\/(?:api\/)?file-raw\?/.test(String(value || '')))
      || /\/(?:api\/)?media\/file\?/.test(String(value || ''));
  }

  function _extractRawPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
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

  function _authHeaders() {
    const headers = new Headers();
    try {
      const token = localStorage.getItem('meldex-auth-token') || localStorage.getItem('crossfolio-auth-token') || '';
      if (token) headers.set('Authorization', 'Bearer ' + token);
    } catch {}
    return headers;
  }

  async function _serverRawUrl(path, opts) {
    const normalized = _normalizeLocalPath(path);
    const rawUrl = _fallbackRawUrl(normalized);
    const response = await fetch(rawUrl, {
      method: 'GET',
      headers: _authHeaders(),
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) return { path: normalized, url: rawUrl, streamed: true };
    const blob = await response.blob();
    const fileSize = Number(blob.size || 0);
    if (fileSize > BLOB_CACHE_MAX_BYTES && !opts.allowLargeBlob) {
      const cachedLarge = CACHE[normalized];
      if (cachedLarge?.url?.startsWith('blob:')) {
        try { URL.revokeObjectURL(cachedLarge.url); } catch {}
      }
      delete CACHE[normalized];
      return { path: normalized, url: rawUrl, mime: blob.type || _mimeFromPath(normalized), size: fileSize, streamed: true };
    }
    const modified = response.headers.get('etag') || response.headers.get('last-modified') || String(Date.now());
    const cached = CACHE[normalized];
    if (cached && cached.modified === modified && cached.size === fileSize) return cached;
    const url = URL.createObjectURL(blob);
    if (cached?.url && cached.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(cached.url); } catch {}
    }
    const next = { path: normalized, url, mime: blob.type || _mimeFromPath(normalized), size: fileSize, modified };
    CACHE[normalized] = next;
    return next;
  }

  async function _provider() {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) return null;
    await provider.restoreWorkspace?.();
    return provider;
  }

  async function ensureRawUrl(pathLike, options) {
    const opts = options || {};
    const direct = String(pathLike || '').trim();
    if (!direct) return { path: '', url: '' };
    if (_isDirectUrl(direct)) return { path: '', url: direct };
    const normalized = _extractRawPath(direct);
    if (!normalized) return { path: '', url: direct };
    if (_runtime()?.isServerMode?.()) return _serverRawUrl(normalized, opts);
    if (!_runtime()?.isDropboxMode?.()) return { path: normalized, url: _fallbackRawUrl(normalized) };
    const provider = await _provider();
    if (!provider) return { path: normalized, url: _fallbackRawUrl(normalized) };
    const fileHandle = await provider.getFileHandle(normalized, { create: false });
    const file = await fileHandle.getFile();
    const fileSize = Number(file.size || 0);
    if (fileSize > BLOB_CACHE_MAX_BYTES && !opts.allowLargeBlob) {
      const cachedLarge = CACHE[normalized];
      if (cachedLarge?.url?.startsWith('blob:')) {
        try { URL.revokeObjectURL(cachedLarge.url); } catch {}
      }
      delete CACHE[normalized];
      return { path: normalized, url: _fallbackRawUrl(normalized), mime: file.type || _mimeFromPath(normalized), size: fileSize, modified: String(file.lastModified || 0), streamed: true };
    }
    const modified = String(file.lastModified || 0);
    const cached = CACHE[normalized];
    if (cached && cached.modified === modified && cached.size === fileSize) return cached;
    const url = fileSize > BLOB_CACHE_MAX_BYTES
      ? URL.createObjectURL(file)
      : _bytesToUrl(new Uint8Array(await file.arrayBuffer()), file.type || _mimeFromPath(normalized));
    if (cached?.url && cached.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(cached.url); } catch {}
    }
    const next = { path: normalized, url, mime: file.type || _mimeFromPath(normalized), size: fileSize, modified };
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
    return getCachedRawUrl(normalized) || _fallbackRawUrl(normalized);
  }

  async function ensureDisplayUrl(pathLike, options) {
    const direct = String(pathLike || '').trim();
    if (!direct) return { path: '', url: '' };
    if (_isDirectUrl(direct)) return { path: '', url: direct };
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
    const current = displayUrl(pathLike);
    if (current) _setElementUrlIfChanged(target, prop, current);
    return ensureDisplayUrl(pathLike).then((info) => {
      if (target.isConnected && info?.url) _setElementUrlIfChanged(target, prop, info.url);
      return info;
    }).catch(() => ({ path: '', url: current || '' }));
  }

  function _clearCachePath(path, isFolder) {
    const normalized = _normalizeLocalPath(path);
    Object.keys(CACHE).forEach((key) => {
      if (key === normalized || (isFolder && key.startsWith(normalized + '/'))) {
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
    if (_looksLikeFileRawUrl(raw) || isThumbnail) {
      if (isThumbnail && !(_runtime()?.isDropboxMode?.() || _runtime()?.isServerMode?.())) return;
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
    if (!styleValue || (!RAW_URL_RE.test(styleValue) && !MEDIA_URL_RE.test(styleValue) && !THUMB_URL_RE.test(styleValue))) {
      RAW_URL_RE.lastIndex = 0;
      MEDIA_URL_RE.lastIndex = 0;
      THUMB_URL_RE.lastIndex = 0;
      return;
    }
    RAW_URL_RE.lastIndex = 0;
    MEDIA_URL_RE.lastIndex = 0;
    THUMB_URL_RE.lastIndex = 0;
    const rawMatches = [...styleValue.matchAll(RAW_URL_RE), ...styleValue.matchAll(MEDIA_URL_RE), ...styleValue.matchAll(THUMB_URL_RE)];
    rawMatches.forEach((match) => {
      const urlText = match[0];
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
