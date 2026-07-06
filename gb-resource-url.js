(function () {
  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _appendQuery(url, query) {
    if (!query || typeof query !== 'object') return url;
    Object.entries(query).forEach(([key, value]) => {
      if (value == null || value === '') return;
      url.searchParams.set(key, String(value));
    });
    return url;
  }

  function _apiUrl(path, query) {
    const runtime = _runtime();
    const base = runtime?.getApiBaseUrl?.() || '/api';
    const suffix = String(path || '').replace(/^\/+/, '');
    const baseText = String(base || '/api').replace(/\/+$/, '') + '/';
    const url = new URL(suffix, baseText.startsWith('http') ? baseText : window.location.origin + baseText);
    return _appendQuery(url, query).toString();
  }

  function _apiPath(path, query) {
    const url = new URL(_apiUrl(path, query));
    if (url.origin !== window.location.origin) return url.toString();
    return url.pathname + url.search + url.hash;
  }

  function _pagePath(fileName, query) {
    const runtime = _runtime();
    if (runtime) return runtime.resolveAppPath(fileName, query);
    const url = new URL(String(fileName || '').replace(/^\/+/, ''), window.location.origin + '/');
    return _appendQuery(url, query).pathname + url.search + url.hash;
  }

  function _rewritePath(fileName, parsed) {
    const next = new URL(_pagePath(fileName), window.location.origin);
    next.search = parsed.search;
    next.hash = parsed.hash;
    return next.pathname + next.search + next.hash;
  }

  function _appEntryPath(query) {
    return _pagePath('Meldex.html', query);
  }

  function _viewerPath(query) {
    return _pagePath('viewer.html', query);
  }

  function _pdfViewerPath(query) {
    return _pagePath('pdf-viewer.html', query);
  }

  function _slideshowPath(query) {
    return _pagePath('slideshow.html', query);
  }

  function _fileRawPath(path, query) {
    return _apiPath('/file-raw', { ...query, path });
  }

  function _fileUrlPath(path, query) {
    return _apiPath('/file', { ...query, path });
  }

  function _thumbnailPath(path, query) {
    return _apiPath('/thumbnail', { ...query, path });
  }

  function _teamAvatarPath(name, query) {
    return _apiPath('/team/avatar/' + encodeURIComponent(name || ''), query);
  }

  function _authAvatarPath(name, query) {
    return _apiPath('/auth/avatar/' + encodeURIComponent(name || ''), query);
  }

  function _fileRawPattern() {
    return new URL(_apiUrl('/file-raw'));
  }

  function isFileRawUrl(url) {
    if (!url) return false;
    try {
      const parsed = new URL(String(url), document.baseURI || window.location.href);
      const expected = _fileRawPattern();
      return parsed.origin === expected.origin
        && /\/(?:api\/)?file-raw$/.test(parsed.pathname)
        && parsed.searchParams.has('path');
    } catch {
      return /\/(?:api\/)?file-raw\?/.test(String(url));
    }
  }

  function rewriteInternalUrl(url) {
    if (!url) return url;
    try {
      const parsed = new URL(String(url), document.baseURI || window.location.href);
      if (parsed.origin !== window.location.origin) return String(url);
      const pathname = String(parsed.pathname || '').toLowerCase();
      if (/\/viewer(?:\.html)?$/.test(pathname)) return _rewritePath('viewer.html', parsed);
      if (/\/pdf-viewer(?:\.html)?$/.test(pathname)) return _rewritePath('pdf-viewer.html', parsed);
      if (/\/slideshow(?:\.html)?$/.test(pathname)) return _rewritePath('slideshow.html', parsed);
      if (pathname === '/' || /\/(?:index|meldex)\.html$/.test(pathname)) return _rewritePath('Meldex.html', parsed);
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return String(url);
    }
  }

  window.MeldexResourceUrl = {
    api: _apiPath,
    apiUrl: _apiUrl,
    appEntry: _appEntryPath,
    viewer: _viewerPath,
    pdfViewer: _pdfViewerPath,
    slideshow: _slideshowPath,
    file: _fileUrlPath,
    fileRaw: _fileRawPath,
    fileDownload(path, query) {
      return _fileUrlPath(path, { ...query, download: 1 });
    },
    thumbnail: _thumbnailPath,
    teamAvatar: _teamAvatarPath,
    authAvatar: _authAvatarPath,
    isFileRawUrl,
    rewriteInternalUrl,
  };
})();
