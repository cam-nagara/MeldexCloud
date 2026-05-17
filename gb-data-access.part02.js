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
      const team = await _readTeamFile(folder);
      const name = String(body?.name || '').trim();
      if (!name) throw new Error('name は必須です');
      const member = team.members[name] || {};
      member.avatar = Object.prototype.hasOwnProperty.call(body || {}, 'avatar') ? (body?.avatar || '') : (member.avatar || '');
      const accountId = String(body?.accountId || body?.account_id || '').trim();
      if (accountId) {
        Object.entries(team.members || {}).forEach(([memberName, info]) => {
          if (memberName !== name && info?.accountId === accountId) delete team.members[memberName];
        });
        member.accountId = accountId;
      }
      member.last_seen = new Date().toISOString();
      member.role = member.role || 'editor';
      team.members[name] = member;
      _cacheTeamAvatar(name, member.avatar, folder);
      await _writeTeamFile(folder, team);
      return { ok: true };
    }
    if (pathname === '/team/remove' && method === 'POST') {
      const folder = body?.folder || '';
      const team = await _readTeamFile(folder);
      delete team.members[String(body?.name || '').trim()];
      await _writeTeamFile(folder, team);
      return { ok: true };
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
      const result = await handler({ method, body, url, pathname });
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
        throw new Error('ブラウザ版ではまだ未対応の操作です');
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
