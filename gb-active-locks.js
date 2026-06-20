(function () {
  'use strict';

  const API_BASE = '/api';
  const HEADER = 'X-Meldex-Active-Lock-Token';
  const TOKEN_KEY = 'meldex-active-lock-token';
  const DEVICE_KEY = 'meldex-active-lock-device-id';
  const LEASE_SECONDS = 300;
  const HEARTBEAT_MS = 30000;
  const localLocks = new Map();
  let heartbeatTimer = 0;

  function _randomId(prefix) {
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return `${prefix}-${Array.from(bytes).map(v => v.toString(16).padStart(2, '0')).join('')}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function token() {
    let value = '';
    try { value = sessionStorage.getItem(TOKEN_KEY) || ''; } catch {}
    if (!value) {
      value = _randomId('lock');
      try { sessionStorage.setItem(TOKEN_KEY, value); } catch {}
    }
    return value;
  }

  function deviceId() {
    let value = '';
    try { value = localStorage.getItem(DEVICE_KEY) || ''; } catch {}
    if (!value) {
      value = _randomId('device');
      try { localStorage.setItem(DEVICE_KEY, value); } catch {}
    }
    return value;
  }

  function username() {
    try {
      const value = typeof getUsername === 'function' ? getUsername() : '';
      return value && value !== 'anonymous' ? value : '';
    } catch {
      return '';
    }
  }

  function deviceLabel() {
    const id = deviceId().slice(-6);
    const platform = String(navigator.platform || '').trim();
    return platform ? `${platform} ${id}` : `端末 ${id}`;
  }

  function _status(message, isError) {
    if (typeof showStatus === 'function') showStatus(message, !!isError);
  }

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  }

  function _uniquePaths(paths) {
    const result = [];
    const seen = new Set();
    (paths || []).forEach(path => {
      const normalized = _normalizePath(path);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      result.push(normalized);
    });
    return result;
  }

  function _method(opts) {
    return String(opts?.method || 'GET').toUpperCase();
  }

  function _route(path) {
    try {
      const url = new URL(String(path || ''), window.location.origin);
      return url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
    } catch {
      return '';
    }
  }

  function _isMutation(opts) {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(_method(opts));
  }

  function _isSelfRoute(path) {
    const route = _route(path);
    return route === '/active-lock' || route.startsWith('/active-lock/');
  }

  function _withActiveLockHeader(opts) {
    const next = { ...(opts || {}) };
    const headers = new Headers(next.headers || undefined);
    headers.set(HEADER, token());
    next.headers = headers;
    return next;
  }

  async function _jsonFetch(path, opts) {
    const headers = new Headers(opts?.headers || undefined);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    headers.set(HEADER, token());
    const res = await fetch(API_BASE + path, { ...(opts || {}), headers });
    if (!res.ok) {
      let payload = null;
      let detail = res.statusText || '';
      try {
        payload = await res.clone().json();
        detail = payload?.detail?.message || payload?.detail || payload?.error || detail;
      } catch {}
      const error = new Error(typeof detail === 'string' ? detail : (detail?.message || `HTTP ${res.status}`));
      error.status = res.status;
      error.payload = payload;
      throw error;
    }
    return res.json();
  }

  function _lockBody(path) {
    return {
      path,
      token: token(),
      locked_by: username(),
      device_id: deviceId(),
      device_label: deviceLabel(),
      lease_seconds: LEASE_SECONDS,
      kind: 'edit',
    };
  }

  function _conflictMessage(error) {
    const detail = error?.payload?.detail || {};
    return detail.message || error?.message || 'ほかの端末で編集中のため保存できません';
  }

  async function ensureLock(path) {
    const normalized = _normalizePath(path);
    if (!normalized) return null;
    const current = localLocks.get(normalized);
    if (current && Date.parse(current.expires_at || '') > Date.now() + HEARTBEAT_MS) {
      return current;
    }
    try {
      const response = await _jsonFetch('/active-lock', {
        method: 'PUT',
        body: JSON.stringify(_lockBody(normalized)),
      });
      const entry = response?.entry || null;
      if (entry) localLocks.set(normalized, entry);
      _startHeartbeat();
      return entry;
    } catch (error) {
      if (error?.status === 423) {
        const message = _conflictMessage(error);
        _status(message, true);
      }
      throw error;
    }
  }

  async function beforeApiFetch(path, opts, context) {
    if (!_isMutation(opts) || _isSelfRoute(path)) return opts || {};
    const candidatePaths = _uniquePaths(context?.candidatePaths || []);
    if (!candidatePaths.length) return _withActiveLockHeader(opts);
    for (const candidatePath of candidatePaths) {
      await ensureLock(candidatePath);
    }
    return _withActiveLockHeader(opts);
  }

  async function heartbeat() {
    const paths = _uniquePaths([...localLocks.keys()]);
    if (!paths.length) return;
    try {
      const response = await _jsonFetch('/active-lock/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ ..._lockBody(paths[0]), paths }),
      });
      const entries = Array.isArray(response?.entries) ? response.entries : [];
      entries.forEach(entry => {
        const path = _normalizePath(entry?.path || '');
        if (path) localLocks.set(path, entry);
      });
    } catch (error) {
      if (error?.status === 423) {
        _status(_conflictMessage(error), true);
        localLocks.clear();
      }
    }
  }

  function _startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = window.setInterval(heartbeat, HEARTBEAT_MS);
  }

  async function releaseAll() {
    const paths = [...localLocks.keys()];
    localLocks.clear();
    if (!paths.length) return;
    try {
      await _jsonFetch('/active-lock/release-all', {
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({ token: token() }),
      });
    } catch {}
  }

  window.addEventListener('pagehide', () => {
    releaseAll();
  });

  window.MeldexActiveLocks = {
    header: HEADER,
    token,
    beforeApiFetch,
    ensureLock,
    heartbeat,
    releaseAll,
    _localLocks: localLocks,
  };
})();
