(function () {
  const PROFILE_STORE_RELATIVE_PATH = '_meldex/profiles.v1.json';
  const LOCAL_USER_KEY = 'meldex-user';
  const LOCAL_AVATAR_KEY = 'meldex-avatar';
  const LOCAL_AVATAR_SPEC_KEY = 'meldex-avatar-spec';
  const LOCAL_AVATAR_BG_KEY = 'meldex-avatar-bg';
  const LOCAL_ACCOUNT_KEY = 'meldex-profile-account-id';
  const LOCAL_UPDATED_KEY = 'meldex-profile-updated-at';
  const DEFAULT_SETTINGS_PATH = '/MeldexSettings';

  let _startupProfilePromise = null;
  let _cachedAccount = null;
  let _cachedProfile = null;

  function _auth() {
    return window.MeldexDropboxAuth;
  }

  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _nowIso() {
    return new Date().toISOString();
  }

  function _safeJsonParse(text, fallbackValue) {
    try {
      return JSON.parse(String(text || ''));
    } catch {
      return fallbackValue;
    }
  }

  function _readStorage(key, fallbackValue) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallbackValue : value;
    } catch {
      return fallbackValue;
    }
  }

  function _writeStorage(key, value) {
    try {
      if (value == null || value === '') localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch {}
  }

  function _accountId(account) {
    return String(account?.account_id || account?.accountId || '').trim();
  }

  function _accountDisplayName(account) {
    return String(account?.name?.display_name || account?.email || account?.account_id || account?.accountId || '').trim();
  }

  function _localDisplayName() {
    const value = _safeJsonParse(_readStorage(LOCAL_USER_KEY, '{}'), {});
    return String(value?.name || '').trim();
  }

  function _usableLocalDisplayName() {
    const name = _localDisplayName();
    return name && name !== 'anonymous' ? name : '';
  }

  function _normalizeColor(value) {
    const text = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text : '';
  }

  function _normalizeStore(value) {
    const store = value && typeof value === 'object' ? value : {};
    const profiles = store.profiles && typeof store.profiles === 'object' && !Array.isArray(store.profiles) ? store.profiles : {};
    return {
      version: 1,
      updatedAt: String(store.updatedAt || ''),
      profiles,
    };
  }

  function _normalizeProfile(account, value, at) {
    const accountId = String(value?.accountId || _accountId(account) || '').trim();
    const displayName = String(value?.displayName || value?.name || '').trim();
    return {
      accountId,
      displayName,
      avatar: String(value?.avatar || ''),
      avatarSpec: String(value?.avatarSpec || ''),
      avatarBg: _normalizeColor(value?.avatarBg),
      updatedAt: String(value?.updatedAt || at || _nowIso()),
    };
  }

  function _localProfile(account, at) {
    const displayName = _usableLocalDisplayName() || _accountDisplayName(account);
    return _normalizeProfile(account, {
      accountId: _accountId(account),
      displayName,
      avatar: _readStorage(LOCAL_AVATAR_KEY, ''),
      avatarSpec: _readStorage(LOCAL_AVATAR_SPEC_KEY, ''),
      avatarBg: _readStorage(LOCAL_AVATAR_BG_KEY, ''),
      updatedAt: _readStorage(LOCAL_UPDATED_KEY, '') || at || _nowIso(),
    }, at);
  }

  function _markLocalProfile(accountId, updatedAt) {
    if (accountId) _writeStorage(LOCAL_ACCOUNT_KEY, accountId);
    if (updatedAt) _writeStorage(LOCAL_UPDATED_KEY, updatedAt);
  }

  function _isLocalProfileNewer(accountId, sharedUpdatedAt) {
    const localAccountId = _readStorage(LOCAL_ACCOUNT_KEY, '');
    if (!accountId || localAccountId !== accountId) return false;
    if (!_usableLocalDisplayName()) return false;
    const localTime = Date.parse(_readStorage(LOCAL_UPDATED_KEY, ''));
    const sharedTime = Date.parse(String(sharedUpdatedAt || ''));
    if (!Number.isFinite(localTime)) return false;
    if (!Number.isFinite(sharedTime)) return true;
    return localTime > sharedTime;
  }

  function _applyProfileToLocal(profile) {
    const normalized = _normalizeProfile({ account_id: profile?.accountId || '' }, profile);
    if (!normalized.accountId || !normalized.displayName) return normalized;

    localStorage.setItem(LOCAL_USER_KEY, JSON.stringify({ name: normalized.displayName }));
    if (normalized.avatar) localStorage.setItem(LOCAL_AVATAR_KEY, normalized.avatar);
    else localStorage.removeItem(LOCAL_AVATAR_KEY);
    if (normalized.avatarSpec) localStorage.setItem(LOCAL_AVATAR_SPEC_KEY, normalized.avatarSpec);
    else localStorage.removeItem(LOCAL_AVATAR_SPEC_KEY);
    if (normalized.avatarBg) localStorage.setItem(LOCAL_AVATAR_BG_KEY, normalized.avatarBg);
    else localStorage.removeItem(LOCAL_AVATAR_BG_KEY);
    _markLocalProfile(normalized.accountId, normalized.updatedAt);

    try { if (typeof updateUserIcon === 'function') updateUserIcon(); } catch {}
    try { if (typeof updateLeftChromeUser === 'function') updateLeftChromeUser(); } catch {}
    try {
      window.dispatchEvent(new CustomEvent('meldex-profile-updated', { detail: { profile: normalized } }));
    } catch {}
    _cachedProfile = normalized;
    return normalized;
  }

  function _normalizeDropboxPath(path) {
    const normalized = String(path || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!normalized || normalized === '/') return '/';
    return (normalized.startsWith('/') ? normalized : '/' + normalized).replace(/\/+$/, '');
  }

  function _joinDropboxPath(base, relativePath) {
    const root = _normalizeDropboxPath(base || DEFAULT_SETTINGS_PATH);
    const relative = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
    return root === '/' ? '/' + relative : root + '/' + relative;
  }

  function _profileStorePath() {
    const settingsPath = _auth()?.getSettingsPath?.() || DEFAULT_SETTINGS_PATH;
    return _joinDropboxPath(settingsPath, PROFILE_STORE_RELATIVE_PATH);
  }

  function _profileStoreParents() {
    const settingsPath = _normalizeDropboxPath(_auth()?.getSettingsPath?.() || DEFAULT_SETTINGS_PATH);
    const parents = [];
    if (settingsPath !== '/') parents.push(settingsPath);
    parents.push(_joinDropboxPath(settingsPath, '_meldex'));
    return parents;
  }

  function _isNotFoundError(error) {
    return /not_found|path\/not_found/i.test(String(error?.message || error || ''));
  }

  function _isConflictError(error) {
    return /conflict|too_many_write_operations|path\/conflict/i.test(String(error?.message || error || ''));
  }

  function _isDropboxMode() {
    return !!(_runtime()?.isDropboxMode?.()
      || (typeof document !== 'undefined' && document.body?.dataset?.cloudMode === 'dropbox'));
  }

  function _looksLikeDropboxLocalPath(path) {
    const normalized = String(path || '').replace(/\\/g, '/').toLowerCase();
    return normalized.includes('/dropbox/')
      || normalized.includes(' dropbox/')
      || normalized.endsWith('/dropbox')
      || normalized.includes('dropbox');
  }

  function _workspaceSuggestsDropboxSource() {
    const state = _runtime()?.getWorkspaceState?.() || null;
    if (String(state?.kind || '') === 'dropbox') return true;
    return _looksLikeDropboxLocalPath(state?.path) || _looksLikeDropboxLocalPath(state?.homePath);
  }

  async function _hasDropboxBackedSourceFolder() {
    if (_isDropboxMode() || _workspaceSuggestsDropboxSource()) return true;
    if (typeof apiFetch !== 'function') return false;
    try {
      const roots = await apiFetch('/outliner-roots');
      return (Array.isArray(roots) ? roots : []).some((root) => {
        if (root?.visible === false) return false;
        return root?.provider === 'dropbox'
          || !!root?.dropboxPath
          || _looksLikeDropboxLocalPath(root?.path);
      });
    } catch {
      return false;
    }
  }

  async function _shouldUseSharedProfile() {
    return _hasDropboxBackedSourceFolder();
  }

  async function _getCurrentAccount(refresh) {
    const auth = _auth();
    if (!auth?.getCurrentAccount) return null;
    try {
      const account = await auth.getCurrentAccount(!!refresh);
      if (!_accountId(account)) return null;
      _cachedAccount = account;
      return account;
    } catch {
      return null;
    }
  }

  async function _ensureProfileDirectory() {
    const auth = _auth();
    if (!auth?.apiRpc) throw new Error('Dropbox API is unavailable');
    for (const path of _profileStoreParents()) {
      try {
        await auth.apiRpc('files/create_folder_v2', { path, autorename: false });
      } catch (error) {
        if (!_isConflictError(error)) throw error;
      }
    }
  }

  async function _readProfileStore() {
    const auth = _auth();
    if (!auth?.apiContent) throw new Error('Dropbox API is unavailable');
    try {
      const response = await auth.apiContent('files/download', { path: _profileStorePath() });
      const meta = _safeJsonParse(response.headers?.get?.('dropbox-api-result') || '{}', {}) || {};
      const text = await response.text();
      const parsed = _safeJsonParse(text, null);
      if (!parsed || typeof parsed !== 'object') throw new Error('Dropbox profile store JSON is broken');
      return { store: _normalizeStore(parsed), rev: String(meta.rev || '') };
    } catch (error) {
      if (_isNotFoundError(error)) return { store: _normalizeStore(null), rev: '' };
      throw error;
    }
  }

  async function _writeProfileStore(store, rev) {
    const auth = _auth();
    if (!auth?.apiContent) throw new Error('Dropbox API is unavailable');
    await _ensureProfileDirectory();
    const mode = rev ? { '.tag': 'update', update: rev } : 'add';
    const bytes = new TextEncoder().encode(JSON.stringify(store, null, 2));
    await auth.apiContent('files/upload', {
      path: _profileStorePath(),
      mode,
      autorename: false,
      mute: false,
      strict_conflict: true,
    }, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
  }

  async function saveCurrentProfile(overrides) {
    if (!await _shouldUseSharedProfile()) return { ok: false, reason: 'not-dropbox-workspace' };
    const account = await _getCurrentAccount(false);
    const accountId = _accountId(account);
    if (!accountId) return { ok: false, reason: 'dropbox-unconnected' };

    const updatedAt = String(overrides?.updatedAt || _nowIso());
    const profile = _normalizeProfile(account, {
      ..._localProfile(account, updatedAt),
      ...(overrides || {}),
      accountId,
      updatedAt,
    }, updatedAt);
    if (!profile.displayName) return { ok: false, reason: 'empty-profile' };
    _markLocalProfile(accountId, updatedAt);

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const current = await _readProfileStore();
        const store = _normalizeStore(current.store);
        store.updatedAt = updatedAt;
        store.profiles[accountId] = profile;
        await _writeProfileStore(store, current.rev);
        _cachedProfile = profile;
        return { ok: true, profile, source: 'dropbox' };
      } catch (error) {
        lastError = error;
        if (!_isConflictError(error) || attempt >= 2) break;
      }
    }
    try { console.warn('[MeldexDropboxProfileSync] save failed', lastError); } catch {}
    return { ok: false, reason: 'dropbox-write-failed', error: lastError };
  }

  async function resolveStartupProfile() {
    if (_startupProfilePromise) return _startupProfilePromise;
    _startupProfilePromise = _resolveStartupProfile().then((result) => {
      if (!result?.ok) _startupProfilePromise = null;
      return result;
    }, (error) => {
      _startupProfilePromise = null;
      throw error;
    });
    return _startupProfilePromise;
  }

  async function _resolveStartupProfile() {
    if (!await _shouldUseSharedProfile()) return { ok: false, reason: 'not-dropbox-workspace' };
    const account = await _getCurrentAccount(false);
    const accountId = _accountId(account);
    if (!accountId) return { ok: false, reason: 'dropbox-unconnected' };

    let current;
    try {
      current = await _readProfileStore();
    } catch (error) {
      try { console.warn('[MeldexDropboxProfileSync] startup read failed', error); } catch {}
      return { ok: false, reason: 'dropbox-read-failed', error };
    }

    const store = _normalizeStore(current.store);
    const sharedRaw = store.profiles[accountId];
    if (sharedRaw && typeof sharedRaw === 'object') {
      const shared = _normalizeProfile(account, sharedRaw);
      if (_isLocalProfileNewer(accountId, shared.updatedAt)) {
        const saved = await saveCurrentProfile({ updatedAt: _readStorage(LOCAL_UPDATED_KEY, '') || _nowIso() });
        return { ok: true, source: saved.ok ? 'local-newer' : 'local', profile: _localProfile(account) };
      }
      const applied = _applyProfileToLocal(shared);
      return { ok: true, source: 'dropbox', profile: applied };
    }

    const initial = _localProfile(account, _nowIso());
    if (!initial.displayName) return { ok: false, reason: 'empty-profile' };
    const applied = _applyProfileToLocal(initial);
    const saved = await saveCurrentProfile({ updatedAt: applied.updatedAt });
    return { ok: true, source: saved.ok ? 'created' : 'local', profile: applied };
  }

  async function afterLocalProfileChanged(overrides) {
    const account = await _getCurrentAccount(false);
    const updatedAt = _nowIso();
    _markLocalProfile(_accountId(account), updatedAt);
    const saved = await saveCurrentProfile({ ...(overrides || {}), updatedAt });
    try {
      if (typeof _syncMyTeamProfile === 'function') await _syncMyTeamProfile();
    } catch {}
    return saved;
  }

  function teamSyncPayload(base) {
    const payload = { ...(base || {}) };
    const accountId = _accountId(_cachedAccount);
    if (accountId) payload.accountId = accountId;
    return payload;
  }

  function getCachedAccountId() {
    return _accountId(_cachedAccount);
  }

  function getCachedProfile() {
    return _cachedProfile ? { ..._cachedProfile } : null;
  }

  window.MeldexDropboxProfileSync = {
    profileStorePath: _profileStorePath,
    resolveStartupProfile,
    saveCurrentProfile,
    afterLocalProfileChanged,
    teamSyncPayload,
    getCachedAccountId,
    getCachedProfile,
    _internals: {
      normalizeProfile: _normalizeProfile,
      localProfile: _localProfile,
      normalizeStore: _normalizeStore,
      isLocalProfileNewer: _isLocalProfileNewer,
      shouldUseSharedProfile: _shouldUseSharedProfile,
    },
  };
})();
