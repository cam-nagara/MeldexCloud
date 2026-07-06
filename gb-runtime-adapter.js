(function () {
  const MODE_KEY = 'meldex-data-access-mode';
  const SERVER_CONNECTION_KEY = 'meldex-shared-server-connection';
  const SAFE_MODE_KEY = 'meldex-safe-mode-once';
  const WORKSPACE_STATE_KEY = 'meldex-cloud-workspace-state';
  const COMPARE_LOG_KEY = 'meldex-cloud-compare-log';
  const MODES = new Set(['legacy', 'dropbox', 'server']);
  const MAX_COMPARE_LOGS = 100;

  function _baseUrl() {
    return new URL('.', document.baseURI || window.location.href);
  }

  function _normalizeMode(mode) {
    return MODES.has(mode) ? mode : 'legacy';
  }

  function _normalizeServerUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.hash = '';
      url.search = '';
      if (/\/api\/?$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/api\/?$/i, '/');
      }
      if (!url.pathname.endsWith('/')) url.pathname += '/';
      return url.toString();
    } catch {
      return '';
    }
  }

  function _isLocalAppHost() {
    try {
      const host = String(window.location.hostname || '').toLowerCase();
      if (!host) return window.location.protocol === 'file:';
      return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    } catch {
      return false;
    }
  }

  function _isHostedCloudLaunch(params) {
    try {
      if (params?.has('dataAccessMode') || params?.get('safeMode') === '1' || params?.get('desktop') === '1') return false;
      return window.location.protocol === 'https:' && !_isLocalAppHost();
    } catch {
      return false;
    }
  }

  function _mergeQuery(url, query) {
    if (!query || typeof query !== 'object') return url;
    Object.entries(query).forEach(([key, value]) => {
      if (value == null || value === '') return;
      url.searchParams.set(key, String(value));
    });
    return url;
  }

  function _safeReadJson(key, fallbackValue) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallbackValue;
      return JSON.parse(raw);
    } catch {
      return fallbackValue;
    }
  }

  function _safeWriteJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function _safeGetItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function _safeSetItem(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {}
  }

  function _safeRemoveItem(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  }

  function _notifyModeChanged(reason) {
    const detail = { mode: getMode(), reason: reason || 'updated' };
    try {
      document.dispatchEvent(new CustomEvent('meldex:mode-changed', { detail }));
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('meldex:mode-changed', { detail }));
    } catch {}
  }

  function getMode() {
    const storedMode = _normalizeMode(_safeGetItem(MODE_KEY));
    try {
      const params = new URLSearchParams(window.location.search);
      const requestedMode = params.get('dataAccessMode');
      if (MODES.has(requestedMode)) return requestedMode;
      if (params.get('safeMode') === '1') return 'legacy';
      if (_isHostedCloudLaunch(params)) return storedMode === 'server' ? 'server' : 'dropbox';
    } catch {}
    try {
      if (sessionStorage.getItem(SAFE_MODE_KEY) === '1') return 'legacy';
    } catch {}
    return storedMode;
  }

  function hasStoredMode() {
    return MODES.has(_safeGetItem(MODE_KEY));
  }

  function setMode(mode) {
    _safeSetItem(MODE_KEY, _normalizeMode(mode));
    _notifyModeChanged('mode');
  }

  function clearMode() {
    _safeRemoveItem(MODE_KEY);
    _notifyModeChanged('mode');
  }

  function isDropboxMode() {
    return getMode() === 'dropbox';
  }

  function isServerMode() {
    return getMode() === 'server';
  }

  function isPwaMode() {
    return isDropboxMode() || isServerMode();
  }

  function resolveAppUrl(path, query) {
    const url = new URL(String(path || '').replace(/^\/+/, ''), _baseUrl());
    return _mergeQuery(url, query).toString();
  }

  function resolveAppPath(path, query) {
    const url = new URL(resolveAppUrl(path, query));
    return url.pathname + url.search + url.hash;
  }

  function getBaseUrl() {
    return _baseUrl().toString();
  }

  function getBasePath() {
    return _baseUrl().pathname;
  }

  function getApiBaseUrl() {
    if (isServerMode()) {
      const apiBase = getServerApiBaseUrl();
      if (apiBase) return apiBase;
    }
    return resolveAppUrl('api');
  }

  function getApiBasePath() {
    const apiBase = getApiBaseUrl();
    try {
      const url = new URL(apiBase, document.baseURI || window.location.href);
      if (url.origin !== window.location.origin) return url.toString().replace(/\/+$/, '');
      return url.pathname.replace(/\/+$/, '') + url.search + url.hash;
    } catch {
      return resolveAppPath('api');
    }
  }

  function getServerConnection() {
    const data = _safeReadJson(SERVER_CONNECTION_KEY, null);
    const url = _normalizeServerUrl(data?.url || data?.baseUrl || data?.serverUrl || '');
    if (!url) return null;
    return {
      url,
      apiBaseUrl: getServerApiBaseUrl(url),
      savedAt: data?.savedAt || '',
    };
  }

  function setServerConnection(config) {
    const url = _normalizeServerUrl(config?.url || config?.baseUrl || config?.serverUrl || config || '');
    if (!url) throw new Error('Meldex共有サーバーのURLを確認してください');
    _safeWriteJson(SERVER_CONNECTION_KEY, {
      url,
      savedAt: new Date().toISOString(),
    });
    _notifyModeChanged('server-connection');
    return getServerConnection();
  }

  function clearServerConnection() {
    _safeRemoveItem(SERVER_CONNECTION_KEY);
    _notifyModeChanged('server-connection');
  }

  function getServerBaseUrl() {
    return getServerConnection()?.url || '';
  }

  function getServerApiBaseUrl(urlOverride) {
    const base = _normalizeServerUrl(urlOverride || _safeReadJson(SERVER_CONNECTION_KEY, null)?.url || '');
    if (!base) return '';
    const url = new URL('api/', base);
    return url.toString().replace(/\/+$/, '');
  }

  function getWorkspaceState() {
    return _safeReadJson(WORKSPACE_STATE_KEY, null);
  }

  function setWorkspaceState(state) {
    if (!state) {
      _safeRemoveItem(WORKSPACE_STATE_KEY);
      _notifyModeChanged('workspace');
      return;
    }
    _safeWriteJson(WORKSPACE_STATE_KEY, state);
    _notifyModeChanged('workspace');
  }

  function clearWorkspaceState() {
    _safeRemoveItem(WORKSPACE_STATE_KEY);
    _notifyModeChanged('workspace');
  }

  function enableSafeModeOnce() {
    try {
      sessionStorage.setItem(SAFE_MODE_KEY, '1');
    } catch {}
  }

  function clearSafeModeOnce() {
    try {
      sessionStorage.removeItem(SAFE_MODE_KEY);
    } catch {}
  }

  function getCompareLogs() {
    const logs = _safeReadJson(COMPARE_LOG_KEY, []);
    return Array.isArray(logs) ? logs : [];
  }

  function recordCompareLog(entry) {
    const logs = getCompareLogs();
    logs.push({
      time: new Date().toISOString(),
      mode: getMode(),
      ...entry,
    });
    while (logs.length > MAX_COMPARE_LOGS) logs.shift();
    _safeWriteJson(COMPARE_LOG_KEY, logs);
  }

  function clearCompareLogs() {
    _safeRemoveItem(COMPARE_LOG_KEY);
  }

  window.MeldexRuntimeAdapter = {
    MODES: [...MODES],
    getMode,
    hasStoredMode,
    setMode,
    clearMode,
    isDropboxMode,
    isServerMode,
    isPwaMode,
    getBaseUrl,
    getBasePath,
    getApiBaseUrl,
    getApiBasePath,
    getServerConnection,
    setServerConnection,
    clearServerConnection,
    getServerBaseUrl,
    getServerApiBaseUrl,
    resolveAppUrl,
    resolveAppPath,
    getWorkspaceState,
    setWorkspaceState,
    clearWorkspaceState,
    enableSafeModeOnce,
    clearSafeModeOnce,
    getCompareLogs,
    recordCompareLog,
    clearCompareLogs,
  };
})();
