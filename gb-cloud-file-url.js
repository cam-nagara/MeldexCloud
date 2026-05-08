(function () {
  const CACHE = window.__MeldexPwaFileUrlCache = window.__MeldexPwaFileUrlCache || {};
  const PATH_MUTATION_HOOKS = window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];
  const RAW_URL_RE = /\/(?:api\/)?file-raw\?[^"' )]+/g;
  const THUMB_URL_RE = /\/(?:api\/)?thumbnail\?[^"' )]+/g;

  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  }

  function _looksLikeFileRawUrl(value) {
    return !!value && (typeof window.MeldexResourceUrl?.isFileRawUrl === 'function'
      ? window.MeldexResourceUrl.isFileRawUrl(value)
      : /\/(?:api\/)?file-raw\?/.test(String(value || '')));
  }

  function _extractRawPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (_looksLikeFileRawUrl(raw) || /\/(?:api\/)?thumbnail\?/.test(raw)) {
      try {
        const parsed = new URL(raw, document.baseURI || window.location.href);
        return _normalizePath(parsed.searchParams.get('path') || '');
      } catch {
        const match = /[?&]path=([^&#]+)/.exec(raw);
        if (match) {
          try { return _normalizePath(decodeURIComponent(match[1])); } catch {}
        }
      }
    }
    if (/^(https?:|data:|blob:)/i.test(raw)) return '';
    if (raw.startsWith('/')) return '';
    return _normalizePath(raw);
  }

  function _isDirectUrl(value) {
    const raw = String(value || '').trim();
    if (_looksLikeFileRawUrl(raw) || /\/(?:api\/)?thumbnail\?/.test(raw)) return false;
    return /^(https?:|data:|blob:)/i.test(raw) || raw.startsWith('/');
  }

  function _fallbackRawUrl(path) {
    const normalized = _normalizePath(path);
    if (!normalized) return '';
    return window.MeldexResourceUrl?.fileRaw
      ? window.MeldexResourceUrl.fileRaw(normalized)
      : ('/api/file-raw?path=' + encodeURIComponent(normalized));
  }

  function _mimeFromPath(path) {
    const ext = _normalizePath(path).split('.').pop().toLowerCase();
    return {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      avif: 'image/avif',
      ico: 'image/x-icon',
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

  async function _provider() {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) return null;
    await provider.restoreWorkspace?.();
    return provider;
  }

  async function ensureRawUrl(pathLike) {
    const direct = String(pathLike || '').trim();
    if (!direct) return { path: '', url: '' };
    if (_isDirectUrl(direct)) return { path: '', url: direct };
    const normalized = _extractRawPath(direct);
    if (!normalized) return { path: '', url: direct };
    if (!_runtime()?.isDropboxMode?.()) return { path: normalized, url: _fallbackRawUrl(normalized) };
    const provider = await _provider();
    if (!provider) return { path: normalized, url: _fallbackRawUrl(normalized) };
    const fileHandle = await provider.getFileHandle(normalized, { create: false });
    const file = await fileHandle.getFile();
    const modified = String(file.lastModified || 0);
    const cached = CACHE[normalized];
    if (cached && cached.modified === modified && cached.size === Number(file.size || 0)) return cached;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const url = _bytesToUrl(bytes, file.type || _mimeFromPath(normalized));
    if (cached?.url && cached.url.startsWith('blob:')) {
      try { URL.revokeObjectURL(cached.url); } catch {}
    }
    const next = { path: normalized, url, mime: file.type || _mimeFromPath(normalized), size: Number(file.size || 0), modified };
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

  async function ensureDisplayUrl(pathLike) {
    const direct = String(pathLike || '').trim();
    if (!direct) return { path: '', url: '' };
    if (_isDirectUrl(direct)) return { path: '', url: direct };
    return ensureRawUrl(direct);
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
    const normalized = _normalizePath(path);
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
    if (_looksLikeFileRawUrl(raw) || /\/(?:api\/)?thumbnail\?/.test(raw)) {
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
    if (!styleValue || (!RAW_URL_RE.test(styleValue) && !THUMB_URL_RE.test(styleValue))) {
      RAW_URL_RE.lastIndex = 0;
      THUMB_URL_RE.lastIndex = 0;
      return;
    }
    RAW_URL_RE.lastIndex = 0;
    THUMB_URL_RE.lastIndex = 0;
    const rawMatches = [...styleValue.matchAll(RAW_URL_RE), ...styleValue.matchAll(THUMB_URL_RE)];
    rawMatches.forEach((match) => {
      const urlText = match[0];
      ensureDisplayUrl(urlText).then((info) => {
        const current = element.getAttribute('style') || '';
        if (!current.includes(urlText) || !info?.url) return;
        element.setAttribute('style', current.replaceAll(urlText, info.url));
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
    const oldPath = _normalizePath(event?.oldPath || event?.path || '');
    const newPath = _normalizePath(event?.newPath || '');
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
