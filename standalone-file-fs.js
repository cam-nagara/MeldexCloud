/* standalone-file-fs.js: common local-file bridge for standalone exe pages. */
(function () {
  'use strict';

  const NS = (window.MeldexStandaloneFS = window.MeldexStandaloneFS || {});
  let config = null;
  let currentPath = '';

  function _jsonBody(opts) {
    let body = opts?.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    return body && typeof body === 'object' ? body : {};
  }

  async function _fetchJson(path, opts = {}) {
    const res = await fetch('/api' + path, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const payload = await res.json();
        detail = payload?.detail || payload?.error || '';
      } catch {}
      const error = new Error(detail || ('HTTP ' + res.status));
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  function _pathFromConfig(payload) {
    if (!payload) return '';
    return String(payload.initialPath || payload.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function _filenameFromPath(path, fallback) {
    const value = String(path || '').replace(/\\/g, '/');
    return value ? value.split('/').pop() : fallback;
  }

  NS.init = async function () {
    config = await _fetchJson('/standalone/config');
    return config;
  };

  NS.config = function () {
    return config || {};
  };

  NS.refreshConfig = async function () {
    return NS.init();
  };

  NS.nativeInitialPath = function () {
    const fromQuery = new URLSearchParams(location.search).get('open') || '';
    return String(fromQuery || config?.initialPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  };

  NS.rootPathLabel = function () {
    return String(config?.root || '');
  };

  NS.pathLabel = function (path) {
    const relative = String(path || '').replace(/\//g, '\\');
    const root = NS.rootPathLabel();
    return [root, relative].filter(Boolean).join('\\');
  };

  NS.setCurrentPath = function (path) {
    currentPath = String(path || '').replace(/\\/g, '/');
    return currentPath;
  };

  NS.currentPath = function () {
    return currentPath;
  };

  NS.defaultFilename = function () {
    return String(config?.defaultFilename || '無題');
  };

  NS.defaultExtension = function () {
    return String(config?.defaultExtension || '');
  };

  NS.openFile = async function () {
    try {
      const payload = await _fetchJson('/standalone/open-file', { method: 'POST', body: '{}' });
      config = payload;
      return { path: _pathFromConfig(payload), config: payload };
    } catch (error) {
      if (error?.status === 499) return null;
      throw error;
    }
  };

  NS.newContent = async function (title) {
    const payload = await _fetchJson('/standalone/new-content', {
      method: 'POST',
      body: JSON.stringify({ title: String(title || '') }),
    });
    return String(payload?.content || '');
  };

  NS.readText = async function (path) {
    const payload = await _fetchJson('/file?path=' + encodeURIComponent(String(path || '')));
    return {
      path: String(payload?.path || path || ''),
      content: String(payload?.content || ''),
      etag: String(payload?.etag || ''),
    };
  };

  NS.writeText = async function (path, content, extra) {
    const payload = {
      content: String(content || ''),
      ...(extra || {}),
    };
    return _fetchJson('/file?path=' + encodeURIComponent(String(path || '')), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  };

  NS.saveAs = async function (content, suggestedName) {
    try {
      const payload = await _fetchJson('/standalone/save-as', {
        method: 'POST',
        body: JSON.stringify({
          content: String(content || ''),
          suggestedName: String(suggestedName || NS.defaultFilename()),
        }),
      });
      config = payload;
      return { path: _pathFromConfig(payload), config: payload };
    } catch (error) {
      if (error?.status === 499) return null;
      throw error;
    }
  };

  NS.suggestedName = function (path, fallback) {
    return _filenameFromPath(path, fallback || NS.defaultFilename());
  };

  window.apiFetch = async function (path, opts) {
    return _fetchJson(path, opts || {});
  };
  window.apiPut = async function (path, body) {
    return window.apiFetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  };
  window.apiPost = async function (path, body, options) {
    return window.apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      ...(options || {}),
    });
  };
  window.apiDelete = async function (path) {
    return window.apiFetch(path, { method: 'DELETE' });
  };

  NS._jsonBody = _jsonBody;
})();
