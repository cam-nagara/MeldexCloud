/* gb-workspace-registry.js: user-facing collaborative workspaces */
(function() {
  'use strict';

  if (window.MeldexWorkspaces) return;

  const ACTIVE_KEY = 'meldex-active-workspace-id';
  let _cache = [];
  let _loaded = false;

  function _readActiveId() {
    try { return String(localStorage.getItem(ACTIVE_KEY) || ''); } catch { return ''; }
  }

  function _writeActiveId(id) {
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, String(id));
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {}
  }

  function _event(detail) {
    try { window.dispatchEvent(new CustomEvent('meldex:workspaces-changed', { detail: detail || {} })); } catch {}
  }

  async function _request(path, options = {}) {
    if (typeof apiFetch !== 'function') throw new Error('APIを呼び出せません');
    return apiFetch(path, options);
  }

  function _currentUserName() {
    if (typeof getUsername === 'function') return String(getUsername() || '').trim();
    try {
      const cfg = JSON.parse(localStorage.getItem('meldex-user') || '{}') || {};
      return String(cfg.name || '').trim();
    } catch {
      return '';
    }
  }

  function _currentAvatar() {
    try { return String(localStorage.getItem('meldex-avatar') || ''); }
    catch { return ''; }
  }

  function _withCurrentUserFields(data = {}) {
    const payload = { ...(data || {}) };
    const currentUser = _currentUserName();
    if (!String(payload.user || '').trim() || (String(payload.user || '').trim() === 'anonymous' && currentUser)) {
      payload.user = currentUser || 'anonymous';
    }
    if (!String(payload.avatar || '').trim()) payload.avatar = _currentAvatar();
    return payload;
  }

  function _listFromPayload(payload) {
    const rows = Array.isArray(payload?.workspaces) ? payload.workspaces : (Array.isArray(payload) ? payload : []);
    return rows.filter(item => item && item.deleted !== true);
  }

  async function load(options = {}) {
    if (_loaded && !options.force) return _cache.slice();
    const payload = await _request(
      '/workspaces',
      options.silentError === true ? { silentError: true } : {},
    );
    _cache = _listFromPayload(payload);
    _loaded = true;
    const activeId = _readActiveId();
    if (activeId && !_cache.some(item => item.id === activeId)) _writeActiveId('');
    return _cache.slice();
  }

  function getCached() {
    return _cache.slice();
  }

  function getActiveId() {
    const activeId = _readActiveId();
    return _cache.some(item => item.id === activeId) ? activeId : activeId;
  }

  function getActiveWorkspace() {
    const activeId = _readActiveId();
    return _cache.find(item => item.id === activeId) || null;
  }

  function setActiveId(id, options = {}) {
    const next = String(id || '');
    if (next === _readActiveId() && !options.force) return;
    _writeActiveId(next);
    if (!options.silent) _event({ activeId: next, reason: options.reason || 'select' });
  }

  async function create(data = {}) {
    const body = _withCurrentUserFields(data);
    const payload = await _request('/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await load({ force: true });
    const workspace = payload?.workspace || null;
    if (workspace?.id) setActiveId(workspace.id, { reason: 'create' });
    _event({ reason: 'create', workspace });
    return workspace;
  }

  async function update(id, data = {}) {
    const payload = await _request('/workspaces/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
    });
    await load({ force: true });
    _event({ reason: 'update', workspace: payload?.workspace || null });
    return payload?.workspace || null;
  }

  async function remove(id) {
    await _request('/workspaces/' + encodeURIComponent(id), { method: 'DELETE' });
    if (_readActiveId() === String(id || '')) setActiveId('', { reason: 'delete' });
    await load({ force: true });
    _event({ reason: 'delete', id });
  }

  async function pickFolder() {
    return _request('/workspaces/pick-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  function displayName(workspace) {
    const folder = String(workspace?.folder || '');
    const fallback = folder ? (folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folder) : 'ワークスペース';
    return String(workspace?.name || fallback);
  }

  window.MeldexWorkspaces = {
    load,
    getCached,
    getActiveId,
    getActiveWorkspace,
    setActiveId,
    create,
    update,
    remove,
    pickFolder,
    displayName,
  };
})();
