    _uniqueName,
    _moveConflictName,
    _writeBytes,
    _decodeUploadData,
    _copyEntryHandle,
    _removeEntry,
    _moveEntry,
    _classifyDirectoryType,
    _classifyFileType,
    _buildBrowseItem,
    _sortBrowseItems,
    _linkedItemsForFolder,
    _rewriteStoredPaths,
    _rewriteStoredPathsForProvider,
    _removeStoredPathEntries,
    _removeStoredPathEntriesForProvider,
    _iterateWorkspaceFiles,
    _requireUnlockedPath,
    _relocateReferences,
    _queryBacklinks,
    _fnvFileId,
  };
  window.__MeldexPwaDataAccessExtensions = window.__MeldexPwaDataAccessExtensions || [];

  const PWA_WORKSPACES_FILE = '_meldex/workspaces.v1.json';
  const TEAM_LAST_SEEN_REFRESH_MS = 10 * 60 * 1000;

  function _nowIso() {
    return new Date().toISOString();
  }

  function _httpError(status, message) {
    const err = new Error(message || `HTTP ${status}`);
    err.status = status;
    err.httpStatus = status;
    return err;
  }

  function _teamFilePath(folderPath) {
    const relativeFolder = _normalizeFolderPath(folderPath);
    return relativeFolder ? (relativeFolder + '/_Meldex_team.json') : '_Meldex_team.json';
  }

  function _normalizeTeamFile(team) {
    const base = team && typeof team === 'object' && !Array.isArray(team) ? { ...team } : {};
    if (!base.members || typeof base.members !== 'object' || Array.isArray(base.members)) base.members = {};
    return base;
  }

  async function _writeTeamFileMerged(folderPath, updater) {
    const provider = await _requirePwaProvider('readwrite');
    const relativeFile = _teamFilePath(folderPath);
    if (typeof provider.writeJsonMerged === 'function') {
      return provider.writeJsonMerged(relativeFile, current => {
        const team = _normalizeTeamFile(current);
        const next = updater(team);
        if (next === false) return false;
        return _normalizeTeamFile(next || team);
      }, { fallbackValue: { members: {} }, retries: 5 });
    }
    const team = _normalizeTeamFile(await _readTeamFile(folderPath).catch(() => ({ members: {} })));
    const next = updater(team);
    if (next === false) return { ok: true, skipped: true };
    await _writeTeamFile(folderPath, _normalizeTeamFile(next || team));
    return { ok: true };
  }

  async function _syncTeamMember(folder, body) {
    const name = String(body?.name || '').trim();
    if (!name) throw new Error('name は必須です');
    const accountId = String(body?.accountId || body?.account_id || '').trim();
    const hasAvatarField = Object.prototype.hasOwnProperty.call(body || {}, 'avatar');
    let avatarForCache = '';
    let wrote = false;
    const result = await _writeTeamFileMerged(folder, team => {
      const members = team.members || {};
      const existing = members[name] && typeof members[name] === 'object' ? { ...members[name] } : {};
      const next = { ...existing };
      let changed = false;
      if (hasAvatarField) {
        const avatar = body?.avatar || '';
        if ((next.avatar || '') !== avatar) {
          next.avatar = avatar;
          changed = true;
        }
      } else if (!Object.prototype.hasOwnProperty.call(next, 'avatar')) {
        next.avatar = '';
      }
      if (accountId) {
        Object.entries(members).forEach(([memberName, info]) => {
          if (memberName !== name && info?.accountId === accountId) {
            delete members[memberName];
            changed = true;
          }
        });
        if (next.accountId !== accountId) {
          next.accountId = accountId;
          changed = true;
        }
      }
      if (!next.role) {
        next.role = 'editor';
        changed = true;
      }
      const seenMs = Date.parse(String(existing.last_seen || ''));
      const refreshSeen = !Number.isFinite(seenMs) || Date.now() - seenMs > TEAM_LAST_SEEN_REFRESH_MS;
      avatarForCache = next.avatar || '';
      if (!changed && !refreshSeen) return false;
      next.last_seen = _nowIso();
      members[name] = next;
      team.members = members;
      wrote = true;
      return team;
    });
    _cacheTeamAvatar(name, avatarForCache, folder);
    return { ok: true, skipped: result?.skipped === true || !wrote };
  }

  function _workspaceRole(role, fallback) {
    const value = String(role || '').trim().toLowerCase();
    return ['owner', 'admin', 'member', 'viewer'].includes(value) ? value : (fallback || 'member');
  }

  function _workspaceMember(member, fallbackName) {
    const name = String(member?.name || fallbackName || '').trim();
    if (!name) return null;
    const accountId = String(member?.accountId || member?.account_id || '').trim();
    const row = {
      name,
      role: _workspaceRole(member?.role, 'member'),
      avatar: String(member?.avatar || ''),
      updatedAt: String(member?.updatedAt || member?.updated_at || _nowIso()),
    };
    if (accountId) row.accountId = accountId;
    return row;
  }

  function _localAvatar() {
    try {
      return String(localStorage.getItem('meldex-avatar') || '');
    } catch {
      return '';
    }
  }

  function _workspaceId() {
    return 'ws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function _workspaceFolderPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const registry = window.MeldexSourceFolderRegistry;
    if (raw.startsWith('/') && registry?.virtualPathFromDropboxPath) {
      return _normalizeFolderPath(registry.virtualPathFromDropboxPath(raw));
    }
    return _normalizeFolderPath(raw);
  }

  function _normalizeCloudWorkspace(raw) {
    const folder = _workspaceFolderPath(raw?.folder || raw?.path || '');
    const id = String(raw?.id || '').trim() || (folder ? _fnvFileId(folder).slice(0, 18) : '');
    if (!id) return null;
    const members = (Array.isArray(raw?.members) ? raw.members : [])
      .map(member => _workspaceMember(member))
      .filter(Boolean);
    return {
      id,
      name: String(raw?.name || _basename(folder) || 'ワークスペース'),
      folder,
      visible: raw?.visible !== false,
      deleted: raw?.deleted === true,
      createdAt: String(raw?.createdAt || raw?.created_at || _nowIso()),
      updatedAt: String(raw?.updatedAt || raw?.updated_at || _nowIso()),
      deletedAt: raw?.deletedAt || raw?.deleted_at || '',
      sourceFolderIds: Array.isArray(raw?.sourceFolderIds) ? raw.sourceFolderIds.map(String) : [],
      members,
    };
  }

  function _normalizeWorkspaceStore(raw) {
    const rows = Array.isArray(raw?.workspaces) ? raw.workspaces : (Array.isArray(raw) ? raw : []);
    return {
      kind: 'meldex-cloud-workspaces',
      version: 1,
      updatedAt: String(raw?.updatedAt || raw?.updated_at || ''),
      workspaces: rows.map(_normalizeCloudWorkspace).filter(Boolean),
    };
  }

  async function _readCloudWorkspaceStore() {
    const provider = await _requirePwaProvider('read');
    const data = await _readJsonSafe(provider, PWA_WORKSPACES_FILE, { workspaces: [] });
    return _normalizeWorkspaceStore(data);
  }

  async function _updateCloudWorkspaceStore(updater) {
    const provider = await _requirePwaProvider('readwrite');
    let latest = null;
    const apply = current => {
      const store = _normalizeWorkspaceStore(current);
      const next = updater(store);
      if (next === false) return false;
      latest = _normalizeWorkspaceStore(next || store);
      latest.updatedAt = _nowIso();
      return latest;
    };
    if (typeof provider.writeJsonMerged === 'function') {
      const result = await provider.writeJsonMerged(PWA_WORKSPACES_FILE, apply, {
        fallbackValue: { kind: 'meldex-cloud-workspaces', version: 1, workspaces: [] },
        retries: 5,
      });
      return result?.skipped ? null : latest;
    }
    const current = await _readCloudWorkspaceStore();
    const next = apply(current);
    if (next === false) return null;
    await provider.writeJson(PWA_WORKSPACES_FILE, latest);
    return latest;
  }

  function _currentWorkspaceMember(body, role) {
    const name = String(body?.user || body?.name || (typeof getUsername === 'function' ? getUsername() : '') || 'anonymous').trim() || 'anonymous';
    return _workspaceMember({
      name,
      role: role || 'owner',
      avatar: body?.avatar || _localAvatar(),
      accountId: body?.accountId || body?.account_id || '',
      updatedAt: _nowIso(),
    });
  }

  async function _cloudWorkspaceList() {
    const store = await _readCloudWorkspaceStore();
    return { workspaces: store.workspaces.filter(item => item && item.deleted !== true) };
  }

  async function _cloudCreateWorkspace(body) {
    const folder = _workspaceFolderPath(body?.folder || body?.path || '');
    if (!folder) throw _httpError(400, 'ワークスペースにするDropboxフォルダを指定してください');
    let created = null;
    await _updateCloudWorkspaceStore(store => {
      if (store.workspaces.some(item => item.deleted !== true && _normalizeFolderPath(item.folder) === folder)) {
        throw _httpError(409, 'このフォルダは既にワークスペースに登録されています');
      }
      const now = _nowIso();
      created = _normalizeCloudWorkspace({
        id: _workspaceId(),
        name: String(body?.name || _basename(folder) || 'ワークスペース').trim(),
        folder,
        visible: true,
        createdAt: now,
        updatedAt: now,
        members: [_currentWorkspaceMember(body, 'owner')].filter(Boolean),
      });
      store.workspaces.push(created);
      return store;
    });
    return { ok: true, workspace: created };
  }

  async function _cloudUpdateWorkspace(id, body) {
    let updated = null;
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      if (Object.prototype.hasOwnProperty.call(body || {}, 'name')) target.name = String(body.name || target.name || 'ワークスペース').trim();
      if (Object.prototype.hasOwnProperty.call(body || {}, 'folder')) target.folder = _workspaceFolderPath(body.folder || target.folder || '');
      target.updatedAt = _nowIso();
      updated = _normalizeCloudWorkspace(target);
      Object.assign(target, updated);
      return store;
    });
    return { ok: true, workspace: updated };
  }

  async function _cloudDeleteWorkspace(id) {
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      target.deleted = true;
      target.deletedAt = _nowIso();
      target.updatedAt = target.deletedAt;
      return store;
    });
    return { ok: true };
  }

  async function _cloudUpsertWorkspaceMember(id, name, body) {
    let workspace = null;
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      const targetName = String(name || '').trim();
      const existingIndex = target.members.findIndex(item => item.name === targetName);
      const existing = existingIndex >= 0 ? target.members[existingIndex] : {};
      const accountId = String(body?.accountId || body?.account_id || existing?.accountId || '').trim();
      const member = _workspaceMember({
        ...existing,
        name: targetName,
        role: body?.role || existing?.role || 'member',
        avatar: Object.prototype.hasOwnProperty.call(body || {}, 'avatar') ? body.avatar : (existing?.avatar || ''),
        accountId,
        updatedAt: _nowIso(),
      }, targetName);
      if (!member) throw _httpError(400, 'メンバー名を指定してください');
      if (accountId) {
        target.members = target.members.filter((item, index) => index === existingIndex || item?.accountId !== accountId);
      }
      const index = target.members.findIndex(item => item.name === member.name);
      if (index >= 0) target.members[index] = { ...target.members[index], ...member };
      else target.members.push(member);
      target.updatedAt = _nowIso();
      workspace = _normalizeCloudWorkspace(target);
      Object.assign(target, workspace);
      return store;
    });
    return { ok: true, workspace };
  }

  async function _cloudRemoveWorkspaceMember(id, name) {
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      target.members = target.members.filter(member => member.name !== name);
      target.updatedAt = _nowIso();
      return store;
    });
    return { ok: true };
  }

  async function _cloudSyncWorkspaceProfile(id, body) {
    return _cloudUpsertWorkspaceMember(id, String(body?.name || body?.user || (typeof getUsername === 'function' ? getUsername() : 'anonymous')), {
      role: body?.role || 'member',
      avatar: body?.avatar || _localAvatar(),
      accountId: body?.accountId || body?.account_id || '',
    });
  }

  async function _cloudPickWorkspaceFolder() {
    const picker = window.MeldexDropboxFolderPicker?.pickFolder || window.GBFolderPicker?.pickFolder;
    if (typeof picker === 'function') {
      const picked = await picker({ title: 'ワークスペースにするDropboxフォルダを選択' });
      const path = _workspaceFolderPath(window.GBFolderPicker?.toSourceRelativePath?.(picked) || picked?.path || picked?.relativePath || '');
      if (path) return { ok: true, path, name: _basename(path) || path };
    }
    return { ok: false, path: '', manual: true };
  }

  async function _dropboxJsonRequest(path, opts) {
    const method = String(opts?.method || 'GET').toUpperCase();
    const body = opts?.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts?.body || {});
    const url = new URL('http://local' + String(path || ''));
    const pathname = url.pathname;

    if (pathname === '/vault' && method === 'GET') return _pwaWorkspaceDescriptor();
    if (pathname === '/vaults' && method === 'GET') {
      const workspace = await _pwaWorkspaceDescriptor();
      return { vaults: workspace.name ? [workspace] : [], current: workspace.path || '' };
    }
    if (pathname === '/outliner-roots' && method === 'GET') return _pwaRoots();
    if (pathname === '/outliner-roots' && method === 'PUT') return _setPwaRoots(body?.roots || []);
    if (pathname === '/home-folder' && method === 'GET') return _pwaHomeFolder();
    if (pathname === '/ui-config' && method === 'GET') return _safeReadJson(PWA_UI_CONFIG_KEY, {});
    if (pathname === '/ui-config' && method === 'PUT') {
      _safeWriteJson(PWA_UI_CONFIG_KEY, body || {});
      return { ok: true };
    }
    if (pathname === '/team' && method === 'GET') {
      const folder = url.searchParams.get('folder') || '';
      const team = await _readTeamFile(folder);
      Object.entries(team.members || {}).forEach(([name, info]) => _cacheTeamAvatar(name, info?.avatar || '', folder));
      return _toTeamPayload(team);
    }
    if (pathname === '/team/sync' && method === 'POST') {
      const folder = body?.folder || '';
      return _syncTeamMember(folder, body);
    }
    if (pathname === '/team/remove' && method === 'POST') {
      const folder = body?.folder || '';
      const name = String(body?.name || '').trim();
      await _writeTeamFileMerged(folder, team => {
        delete team.members[name];
        return team;
      });
      return { ok: true };
    }
    if (pathname === '/workspaces' && method === 'GET') return _cloudWorkspaceList();
    if (pathname === '/workspaces/pick-folder' && method === 'POST') return _cloudPickWorkspaceFolder();
    if (pathname === '/workspaces' && method === 'POST') return _cloudCreateWorkspace(body);
    {
      const syncMatch = pathname.match(/^\/workspaces\/([^/]+)\/sync-profile$/);
      if (syncMatch && method === 'POST') return _cloudSyncWorkspaceProfile(decodeURIComponent(syncMatch[1]), body);
      const memberMatch = pathname.match(/^\/workspaces\/([^/]+)\/members\/([^/]+)$/);
      if (memberMatch && method === 'PUT') return _cloudUpsertWorkspaceMember(decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2]), body);
      if (memberMatch && method === 'DELETE') return _cloudRemoveWorkspaceMember(decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2]));
      const itemMatch = pathname.match(/^\/workspaces\/([^/]+)$/);
      if (itemMatch && method === 'PUT') return _cloudUpdateWorkspace(decodeURIComponent(itemMatch[1]), body);
      if (itemMatch && method === 'DELETE') return _cloudDeleteWorkspace(decodeURIComponent(itemMatch[1]));
    }
    if (pathname === '/file-ids' && method === 'POST') {
      const result = {};
      (Array.isArray(body?.paths) ? body.paths : []).forEach((pathValue) => {
        const key = String(pathValue || '');
        result[key] = key ? _fnvFileId(_normalizePath(key)) : null;
      });
      return result;
    }
    if (pathname === '/version' && method === 'GET') {
      const semver = String(window.MeldexCloudRuntimeConfig?.version?.semver || window.MeldexReleaseConfig?.fallbackSemver || '0.5.x').replace(/^v/i, '').split(/\s+/)[0] || '0.5.x';
      const betaLabel = String(window.MeldexReleaseConfig?.betaLabel || 'BETA');
      return { version: `v${semver} ${betaLabel}`, semver, variant: 'dropbox', build: '', commit: '' };
    }
    if (pathname === '/os-accent-color' && method === 'GET') return { color: '#569cd6' };

    for (const handler of window.__MeldexPwaDataAccessExtensions || []) {
      const result = await handler({ method, body, url, pathname, headers: opts?.headers });
      if (result !== NOT_HANDLED) return result;
    }
    return NOT_HANDLED;
  }

  async function requestJson(path, opts) {
    const started = performance.now();
    const requestOpts = opts || {};
    const mode = _runtime()?.getMode?.() || 'legacy';
    const logBase = {
      action: String(path || ''),
      method: _requestMethod(requestOpts),
      payload: _summarizePayload(requestOpts.body),
    };
    if (_runtime()?.isDropboxMode?.()) {
      const localResult = await _dropboxJsonRequest(path, requestOpts);
      if (localResult === NOT_HANDLED) {
        _logCompare({ ...logBase, adapter: 'dropbox-unhandled', durationMs: Math.round(performance.now() - started) });
        const err = new Error('この操作を完了できませんでした。画面を更新してもう一度試してください。');
        err.status = 500;
        err.code = 'cloud_route_unwired';
        err.route = String(path || '');
        throw err;
      }
      _logCompare({ ...logBase, adapter: 'dropbox', durationMs: Math.round(performance.now() - started) });
      return localResult;
    }
    const result = await _legacyJsonRequest(path, requestOpts);
    _logCompare({ ...logBase, adapter: 'legacy', durationMs: Math.round(performance.now() - started), mode });
    return result;
  }

  function _teamAvatarUrl(name, query) {
    if (!_runtime()?.isDropboxMode?.()) return _resource().teamAvatar(name, query);
    const folder = query?.folder ? _normalizeFolderPath(query.folder) : '';
    return _cachedTeamAvatar(name, folder) || _avatarFallbackUrl(name);
  }

  function _authAvatarUrl(name, query) {
    if (!_runtime()?.isDropboxMode?.()) return _resource().authAvatar(name, query);
    if (typeof getUsername === 'function' && getUsername() === name) return localStorage.getItem('meldex-avatar') || _avatarFallbackUrl(name);
    return _avatarFallbackUrl(name);
  }

  window.MeldexDataAccess = {
    requestJson,
    putJson(path, body) {
      return requestJson(path, { method: 'PUT', body });
    },
    postJson(path, body) {
      return requestJson(path, { method: 'POST', body });
    },
    deleteJson(path) {
      return requestJson(path, { method: 'DELETE' });
    },
    bootstrap: {
      getWorkspace() {
        return requestJson('/vault');
      },
      getVault() {
        return requestJson('/vault');
      },
      getRoots() {
        return requestJson('/outliner-roots');
      },
      setRoots(roots) {
        return requestJson('/outliner-roots', { method: 'PUT', body: { roots } });
      },
      getHomeFolder() {
        return requestJson('/home-folder');
      },
      getUiConfig() {
        return requestJson('/ui-config');
      },
      setUiConfig(config) {
        return requestJson('/ui-config', { method: 'PUT', body: config });
      },
    },
    team: {
      syncProfile(payload) {
        return requestJson('/team/sync', { method: 'POST', body: payload });
      },
      listMembers(folder) {
        const query = folder ? ('?folder=' + encodeURIComponent(folder)) : '';
        return requestJson('/team' + query);
      },
      avatarUrl(name, query) {
        return _teamAvatarUrl(name, query);
      },
      authAvatarUrl(name, query) {
        return _authAvatarUrl(name, query);
      },
    },
    fileId: {
      resolvePaths(paths) {
        return requestJson('/file-ids', { method: 'POST', body: { paths } });
      },
      stableIdForPath(path) {
        return path ? _fnvFileId(_normalizePath(path)) : '';
      },
    },
    meta: {
      getVersion() {
        return requestJson('/version');
      },
      getOsAccentColor() {
        return requestJson('/os-accent-color');
      },
    },
  };
})();
