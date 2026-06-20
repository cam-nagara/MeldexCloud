(function () {
  'use strict';
  if (window.MeldexSaveSafety) return;

  let consecutiveSaveFailures = 0;
  let modalOpen = false;
  const CONFLICT_PATHS_KEY = 'meldex-save-conflict-paths';
  const SAVE_MUTATION_ENDPOINTS = [
    '/annotations',
    '/cal/events',
    '/cal/tasks',
    '/calendar',
    '/calendar-db',
    '/database',
    '/data-protection',
    '/db-metadata',
    '/entity',
    '/file',
    '/file-content',
    '/import-csv',
    '/outliner',
    '/property-layout-templates',
    '/quick-memo',
    '/upload-file',
    '/upload-image',
    '/value',
  ];

  const CODE_LABELS = {
    no_space: '容量不足',
    permission_denied: '権限エラー',
    sqlite_locked: 'ロック中',
    sqlite_database_error: 'DBエラー',
    etag_conflict: '競合',
    file_exists: '同名あり',
    invalid_base64: '形式エラー',
    unknown_write_error: '不明',
  };

  function _method(opts) {
    return String(opts?.method || 'GET').toUpperCase();
  }

  function _apiPathname(path) {
    try {
      const url = new URL(String(path || ''), window.location.origin || 'http://localhost');
      return String(url.pathname || '').replace(/^\/api(?=\/)/, '').replace(/\/+$/, '') || '/';
    } catch {
      return String(path || '').split(/[?#]/, 1)[0].replace(/^\/api(?=\/)/, '').replace(/\/+$/, '') || '/';
    }
  }

  function _matchesSaveMutationEndpoint(pathname, endpoint) {
    return pathname === endpoint || pathname.startsWith(endpoint + '/');
  }

  function isSaveMutation(path, opts) {
    const method = _method(opts);
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
    const pathname = _apiPathname(path);
    return SAVE_MUTATION_ENDPOINTS.some(endpoint => _matchesSaveMutationEndpoint(pathname, endpoint));
  }

  function _message(error) {
    return error?.meldexMessage || error?.message || String(error || '保存に失敗しました');
  }

  function _code(error) {
    return error?.meldexCode || 'unknown_write_error';
  }

  function _isAlreadyExists(error) {
    const raw = [_code(error), _message(error), JSON.stringify(error?.meldexDetail || {})].join('\n');
    return /file_exists|既に存在|同名|already exists/i.test(raw);
  }

  function _isConflict(error) {
    if (_code(error) === 'etag_conflict') return true;
    if (_isAlreadyExists(error)) return false;
    const raw = [_message(error), JSON.stringify(error?.meldexDetail || {})].join('\n');
    return Number(error?.status || 0) === 409
      && /conflict|競合|if[_-]?match|他のタブ|別プロセス/i.test(raw);
  }

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  }

  function _readConflictMap() {
    try {
      const data = JSON.parse(localStorage.getItem(CONFLICT_PATHS_KEY) || '{}');
      return data && typeof data === 'object' ? data : {};
    } catch (_) {
      return {};
    }
  }

  function _writeConflictMap(map) {
    try { localStorage.setItem(CONFLICT_PATHS_KEY, JSON.stringify(map || {})); } catch (_) {}
  }

  function _notifyConflictChange(path) {
    try {
      window.dispatchEvent(new CustomEvent('meldex-save-conflicts-change', { detail: { path: _normalizePath(path) } }));
    } catch (_) {}
  }

  function _extractMutationPath(path, opts) {
    try {
      const url = new URL(String(path || ''), window.location.origin);
      const queryPath = url.searchParams.get('path') || url.searchParams.get('old_path') || '';
      if (queryPath) return _normalizePath(queryPath);
    } catch (_) {}
    const body = opts?.body;
    if (typeof body === 'string') {
      try {
        const data = JSON.parse(body);
        return _normalizePath(data.path || data.old_path || data.new_path || data.conflict_path || '');
      } catch (_) {}
    } else if (body && typeof body === 'object') {
      return _normalizePath(body.path || body.old_path || body.new_path || body.conflict_path || '');
    }
    return '';
  }

  function markConflict(path, detail = {}) {
    const normalized = _normalizePath(path);
    if (!normalized) return false;
    const map = _readConflictMap();
    map[normalized] = {
      path: normalized,
      detail: detail || '',
      updated: new Date().toISOString(),
    };
    _writeConflictMap(map);
    _notifyConflictChange(normalized);
    return true;
  }

  function clearConflict(path) {
    const normalized = _normalizePath(path);
    if (!normalized) return false;
    const map = _readConflictMap();
    if (!Object.prototype.hasOwnProperty.call(map, normalized)) return false;
    delete map[normalized];
    _writeConflictMap(map);
    _notifyConflictChange(normalized);
    return true;
  }

  function getConflictPaths() {
    return Object.keys(_readConflictMap());
  }

  function isConflictPath(path) {
    return Object.prototype.hasOwnProperty.call(_readConflictMap(), _normalizePath(path));
  }

  function _showFailureModal(error) {
    if (modalOpen) return;
    modalOpen = true;
    const code = _code(error);
    const title = '保存に失敗しています';
    const body = document.createElement('div');
    body.className = 'gb-confirm-message';
    body.style.whiteSpace = 'pre-wrap';
    body.textContent = `保存失敗が続いています。\n原因: ${CODE_LABELS[code] || code}\n内容: ${_message(error)}\n\nこのまま編集を続けると、未保存の変更が増える可能性があります。`;

    if (window.GBUI?.createModal) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'gb-btn gb-btn-sm';
      close.textContent = '確認しました';
      const modal = GBUI.createModal({ title, body, footer: close, closeOnOverlay: false, onClose: () => { modalOpen = false; } });
      close.addEventListener('click', modal.close);
      document.body.appendChild(modal.overlay);
      return;
    }
    if (typeof cfAlert === 'function') {
      cfAlert(`${title}\n\n${body.textContent}`).finally(() => { modalOpen = false; });
      return;
    }
    alert(`${title}\n\n${body.textContent}`);
    modalOpen = false;
  }

  function reportApiError(path, opts, error) {
    if (!isSaveMutation(path, opts)) return false;
    if (_isConflict(error)) {
      consecutiveSaveFailures = 0;
      markConflict(_extractMutationPath(path, opts), _message(error));
      if (typeof showStatus === 'function') {
        showStatus('ほかの変更とぶつかりました。競合解消ダイアログで保存方法を選んでください。', true);
      }
      return true;
    }
    consecutiveSaveFailures += 1;
    const code = _code(error);
    const label = CODE_LABELS[code] || code;
    if (typeof showStatus === 'function') showStatus(`保存に失敗しました（${label}）: ${_message(error)}`, true);
    if (consecutiveSaveFailures >= 3) _showFailureModal(error);
    return true;
  }

  function reportApiSuccess(path, opts) {
    if (isSaveMutation(path, opts)) {
      consecutiveSaveFailures = 0;
      clearConflict(_extractMutationPath(path, opts));
    }
  }

  function enrichError(error, payload, status) {
    const detail = payload?.detail ?? payload?.error ?? null;
    if (detail && typeof detail === 'object') {
      error.meldexCode = detail.code || '';
      error.meldexMessage = detail.message || detail.technical_detail || '';
      error.meldexDetail = detail;
    } else if (typeof detail === 'string') {
      error.meldexMessage = detail;
    }
    error.status = status;
    return error;
  }

  window.MeldexSaveSafety = {
    clearConflict,
    enrichError,
    getConflictPaths,
    isSaveMutation,
    isConflictPath,
    markConflict,
    reportApiError,
    reportApiSuccess,
  };
})();
