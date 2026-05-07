(function () {
  const MODE_KEY = 'meldex-data-access-mode';
  const SAFE_MODE_KEY = 'meldex-safe-mode-once';
  const WORKSPACE_STATE_KEY = 'meldex-cloud-workspace-state';
  const COMPARE_LOG_KEY = 'meldex-cloud-compare-log';
  const MODES = new Set(['legacy', 'dropbox']);
  const MAX_COMPARE_LOGS = 100;

  function _baseUrl() {
    return new URL('.', document.baseURI || window.location.href);
  }

  function _normalizeMode(mode) {
    return MODES.has(mode) ? mode : 'legacy';
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

  function getMode() {
    try {
      const params = new URLSearchParams(window.location.search);
      const requestedMode = params.get('dataAccessMode');
      if (MODES.has(requestedMode)) return requestedMode;
      if (params.get('safeMode') === '1') return 'legacy';
    } catch {}
    try {
      if (sessionStorage.getItem(SAFE_MODE_KEY) === '1') return 'legacy';
    } catch {}
    return _normalizeMode(localStorage.getItem(MODE_KEY));
  }

  function hasStoredMode() {
    try {
      return MODES.has(localStorage.getItem(MODE_KEY));
    } catch {
      return false;
    }
  }

  function setMode(mode) {
    localStorage.setItem(MODE_KEY, _normalizeMode(mode));
  }

  function clearMode() {
    localStorage.removeItem(MODE_KEY);
  }

  function isDropboxMode() {
    return getMode() === 'dropbox';
  }

  function isPwaMode() {
    return isDropboxMode();
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
    return resolveAppUrl('api');
  }

  function getApiBasePath() {
    return resolveAppPath('api');
  }

  function getWorkspaceState() {
    return _safeReadJson(WORKSPACE_STATE_KEY, null);
  }

  function setWorkspaceState(state) {
    if (!state) {
      localStorage.removeItem(WORKSPACE_STATE_KEY);
      return;
    }
    _safeWriteJson(WORKSPACE_STATE_KEY, state);
  }

  function clearWorkspaceState() {
    localStorage.removeItem(WORKSPACE_STATE_KEY);
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
    return _safeReadJson(COMPARE_LOG_KEY, []);
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
    localStorage.removeItem(COMPARE_LOG_KEY);
  }

  window.MeldexRuntimeAdapter = {
    MODES: [...MODES],
    getMode,
    hasStoredMode,
    setMode,
    clearMode,
    isDropboxMode,
    isPwaMode,
    getBaseUrl,
    getBasePath,
    getApiBaseUrl,
    getApiBasePath,
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
