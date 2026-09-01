/* Desktop/Cloud間で個人または共有ワークスペースの復元ポイント方針をCAS同期する。 */
(function (global) {
  'use strict';

  if (global.MeldexRestorePointPolicySync) return;
  const DOCUMENT_NAME = 'restore-point-policy';
  const STATE_KEY_PREFIX = 'meldex:restore-point-policy-sync-state:v2:';
  let applyingRemote = false;
  let pushTimer = null;
  let busy = false;
  let activeScopeId = '';

  function currentScope() {
    const workspace = global.MeldexWorkspaces?.getActiveWorkspace?.() || null;
    const workspaceId = String(workspace?.id || global.MeldexWorkspaces?.getActiveId?.() || '');
    if (!workspaceId) return { id: 'personal', kind: 'personal', path: `/personal-preferences/${DOCUMENT_NAME}`, readOnly: false, role: 'owner' };
    const user = String(typeof getUsername === 'function' ? getUsername() : '').trim().toLowerCase();
    const member = (Array.isArray(workspace.members) ? workspace.members : []).find(row =>
      user && String(row?.name || '').trim().toLowerCase() === user);
    const role = String(member?.role || 'viewer').trim().toLowerCase();
    return {
      id: `workspace:${workspaceId}`,
      kind: 'workspace',
      workspaceId,
      path: `/workspace-preferences/${encodeURIComponent(workspaceId)}/${DOCUMENT_NAME}`,
      role,
      readOnly: !['owner', 'admin'].includes(role),
    };
  }

  function _normalize(value) {
    return global.MeldexRestorePointPolicy?.normalize?.(value) || value || {};
  }

  function _signature(value) {
    const text = JSON.stringify(_normalize(value));
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return String(hash);
  }

  function _state(scope = currentScope()) {
    try { return JSON.parse(localStorage.getItem(STATE_KEY_PREFIX + scope.id) || 'null'); } catch { return null; }
  }

  function _saveState(scope, value) {
    try { localStorage.setItem(STATE_KEY_PREFIX + scope.id, JSON.stringify(value || {})); } catch {}
  }

  function _notify(scope, detail = {}) {
    try { global.dispatchEvent(new CustomEvent('meldex:restore-point-policy-sync', { detail: { scope, ...detail } })); } catch {}
  }

  async function _request(path, options = {}) {
    if (typeof apiFetch !== 'function') return null;
    return apiFetch(path, { silentError: true, ...options });
  }

  async function pull(options = {}) {
    const scope = options.scope || currentScope();
    const response = await _request(scope.path);
    if (!response || response.available === false) {
      const result = { available: false, applied: false, scope };
      _notify(scope, result);
      return result;
    }
    scope.readOnly = response.readOnly === true || scope.readOnly;
    scope.role = response.role || scope.role;
    if (!response.exists || !response.payload?.config) {
      const result = { available: true, applied: false, revision: null, readOnly: scope.readOnly, scope };
      _notify(scope, result);
      return result;
    }
    const remote = _normalize(response.payload.config);
    const local = typeof getVersionConfig === 'function' ? getVersionConfig() : {};
    if (_signature(local) === _signature(remote)) {
      _saveState(scope, { revision: response.revision || '', signature: _signature(remote), updatedAt: response.payload.updatedAt || '' });
      const result = { available: true, applied: false, revision: response.revision || '', readOnly: scope.readOnly, scope };
      _notify(scope, result);
      return result;
    }
    const syncState = _state(scope);
    if (!options.forceRemote && syncState?.signature && syncState.signature !== _signature(local)) {
      const result = { available: true, applied: false, localChanged: true, revision: response.revision || '', readOnly: scope.readOnly, scope };
      _notify(scope, result);
      return result;
    }
    applyingRemote = true;
    try {
      if (typeof saveVersionConfig === 'function') saveVersionConfig(remote);
      if (typeof _ensureAutoVersionTimer === 'function') _ensureAutoVersionTimer();
    } finally {
      applyingRemote = false;
    }
    _saveState(scope, { revision: response.revision || '', signature: _signature(remote), updatedAt: response.payload.updatedAt || '' });
    const result = { available: true, applied: true, revision: response.revision || '', readOnly: scope.readOnly, scope };
    _notify(scope, result);
    return result;
  }

  async function push(options = {}) {
    const scope = options.scope || currentScope();
    if (scope.readOnly) {
      const result = { available: true, pushed: false, readOnly: true, scope };
      _notify(scope, result);
      return result;
    }
    const config = typeof getVersionConfig === 'function' ? getVersionConfig() : {};
    const signature = _signature(config);
    const syncState = _state(scope);
    if (!options.force && syncState?.signature === signature) return { available: true, pushed: false, scope };
    const payload = { updatedAt: new Date().toISOString(), config };
    try {
      const response = await _request(scope.path, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, expectedRevision: syncState?.revision || null }),
      });
      if (!response || response.available === false) return { available: false, pushed: false, scope };
      _saveState(scope, { revision: response.revision || '', signature, updatedAt: payload.updatedAt });
      const result = { available: true, pushed: true, revision: response.revision || '', readOnly: false, scope };
      _notify(scope, result);
      return result;
    } catch (error) {
      await pull({ scope }).catch(() => null);
      const result = { available: true, pushed: false, conflict: true, error, scope };
      _notify(scope, result);
      return result;
    }
  }

  function schedulePush() {
    if (applyingRemote) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; push().catch(() => null); }, 900);
  }

  async function syncNow() {
    if (busy) return null;
    busy = true;
    try {
      const scope = currentScope();
      const scopeChanged = activeScopeId !== scope.id;
      activeScopeId = scope.id;
      const pulled = await pull({ scope, forceRemote: scopeChanged });
      if (pulled?.available === false) return pulled;
      if (pulled?.readOnly) return pulled;
      if (pulled?.localChanged || !pulled?.revision) return push({ scope });
      return pulled;
    } finally {
      busy = false;
    }
  }

  function start() {
    global.addEventListener('meldex:restore-point-policy-change', schedulePush);
    global.addEventListener('meldex:workspaces-changed', () => { syncNow().catch(() => null); });
    global.addEventListener('focus', () => { syncNow().catch(() => null); });
    syncNow().catch(() => null);
  }

  global.MeldexRestorePointPolicySync = Object.freeze({ currentScope, pull, push, syncNow, start });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(typeof window !== 'undefined' ? window : globalThis);
