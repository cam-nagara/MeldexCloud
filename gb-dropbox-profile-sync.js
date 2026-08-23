(function () {
  const PROFILE_STORE_RELATIVE_PATH = '_meldex/profiles.v1.json';
  const LOCAL_USER_KEY = 'meldex-user';
  const LOCAL_AVATAR_KEY = 'meldex-avatar';
  const LOCAL_AVATAR_SPEC_KEY = 'meldex-avatar-spec';
  const LOCAL_AVATAR_BG_KEY = 'meldex-avatar-bg';
  const LOCAL_ACCOUNT_KEY = 'meldex-profile-account-id';
  const LOCAL_UPDATED_KEY = 'meldex-profile-updated-at';
  // LOCAL_UPDATED_KEY の時刻が「どのアカウント向けに記録されたか」を紐付ける
  // 補助キー（additive）。_isLocalProfileNewer() 参照。
  const LOCAL_UPDATED_FOR_KEY = 'meldex-profile-updated-for';
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

  function _hasLocalProfileData() {
    return !!(_usableLocalDisplayName()
      || _readStorage(LOCAL_AVATAR_KEY, '')
      || _readStorage(LOCAL_AVATAR_SPEC_KEY, '')
      || _readStorage(LOCAL_AVATAR_BG_KEY, ''));
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
    const displayName = String(value?.displayName || value?.name || _accountDisplayName(account) || '').trim();
    const profile = {
      accountId,
      displayName,
      avatar: String(value?.avatar || ''),
      avatarSpec: String(value?.avatarSpec || ''),
      avatarBg: _normalizeColor(value?.avatarBg),
      updatedAt: String(value?.updatedAt || at || _nowIso()),
    };
    // profileId / supersededBy は自己同定ラダー（gb-profile-identity.js）が
    // 'local:' エントリの引き継ぎに使う追加フィールド（additive）。既存フィールド
    // ではないため明示的に保持しないと、再正規化のたびに消えてしまう。
    if (value?.profileId) profile.profileId = String(value.profileId);
    if (value?.supersededBy) profile.supersededBy = String(value.supersededBy);
    return profile;
  }

  function _localProfileForKey(account, accountKey, at) {
    const base = _localProfile(account, at);
    return { ...base, accountId: accountKey || base.accountId };
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
    if (updatedAt) {
      _writeStorage(LOCAL_UPDATED_KEY, updatedAt);
      // この更新時刻がどのアカウント向けの記録かを紐付けて残す。紐付けが無いと、
      // 後から別アカウントへ切り替わった際に「切り替え前のアカウント向けの
      // 古い更新時刻」がキー一致ガード（下の_isLocalProfileNewer）を素通りし、
      // 選び直した相手の共有プロフィールを自端末の古いデータで上書きしてしまう
      // （実際に発生した端末間データ破壊バグ）。accountId が空（OAuth未接続での
      // afterLocalProfileChanged 呼び出し等）の場合は、現在 LOCAL_ACCOUNT_KEY に
      // 記録済みのアカウントを紐付け先とみなす。
      _writeStorage(LOCAL_UPDATED_FOR_KEY, accountId || _readStorage(LOCAL_ACCOUNT_KEY, ''));
    }
  }

  // 記憶キーの切り替え・破棄の直後に呼ぶ。切り替え前のアカウント向けに記録された
  // 「ローカル更新時刻」を新しい選択へ持ち越さないための多重防御（呼び出し側:
  // gb-settings-account-link.js の切り替え・候補選択フロー）。本体の防御は
  // _isLocalProfileNewer 側の紐付けキー一致チェックだが、ここでも明示的に
  // 消しておくことで、紐付け情報を持たない旧バージョンのデータとの取り違えの
  // 余地を減らす。
  function clearLocalUpdateMarker() {
    _writeStorage(LOCAL_UPDATED_KEY, '');
    _writeStorage(LOCAL_UPDATED_FOR_KEY, '');
  }

  function _isLocalProfileNewer(accountId, sharedUpdatedAt) {
    const localAccountId = _readStorage(LOCAL_ACCOUNT_KEY, '');
    if (!accountId || localAccountId !== accountId) return false;
    if (!_hasLocalProfileData()) return false;
    // localAccountId の一致だけでは、切り替え操作が LOCAL_ACCOUNT_KEY だけを
    // 先に書き換えるケース（gb-settings-account-link.js の候補選択）で、切り替え
    // 前のアカウント向けの古い更新時刻を「新しいアカウントの更新時刻」として
    // 誤認してしまう。紐付け記録（LOCAL_UPDATED_FOR_KEY）がある場合は、比較対象の
    // accountId と一致するかを必ず確認する。記録が無い場合（紐付け導入前の
    // 旧バージョンが書いた値等）は、後方互換のため localAccountId 一致判定だけで
    // 判断する（既存の同一アカウント内 LWW 比較の挙動を変えない）。
    const updatedForKey = _readStorage(LOCAL_UPDATED_FOR_KEY, '');
    if (updatedForKey && updatedForKey !== accountId) return false;
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

  async function _isSettingsBridgeAvailable() {
    const registry = window.MeldexProfileStoreTransport;
    if (!registry || typeof registry.select !== 'function') return false;
    try {
      const transport = await registry.select();
      return !!(transport && transport.id === 'settings-bridge');
    } catch {
      return false;
    }
  }

  async function _shouldUseSharedProfile() {
    if (await _hasDropboxBackedSourceFolder()) return true;
    if (_accountId(await _getCurrentAccount(false))) return true;
    // デスクトップ版（Dropbox OAuth未接続）でも、ローカルAPIサーバー経由で
    // 同じ共有ストアを読み書きできるなら共有プロフィールを使う。
    return _isSettingsBridgeAvailable();
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

  // gb-profile-store-transport.js が未ロードの場合に備えた、Dropbox HTTP API
  // 直叩きの独立したフォールバック実装。transport モジュールの実装と処理内容は
  // 同じだが、あえて重複させて完全に自己完結させている（transport モジュール側の
  // 不具合・未読込がクラウド版の既存動作に一切影響しないようにするため）。
  function _fallbackDropboxApiTransport() {
    return {
      id: 'dropbox-api-fallback',
      async read(storePath) {
        const auth = _auth();
        if (!auth?.apiContent) throw new Error('Dropbox API is unavailable');
        try {
          const response = await auth.apiContent('files/download', { path: storePath });
          const meta = _safeJsonParse(response.headers?.get?.('dropbox-api-result') || '{}', {}) || {};
          const text = await response.text();
          const parsed = _safeJsonParse(text, null);
          if (!parsed || typeof parsed !== 'object') throw new Error('Dropbox profile store JSON is broken');
          return { store: parsed, rev: String(meta.rev || '') };
        } catch (error) {
          if (_isNotFoundError(error)) return { store: null, rev: '' };
          throw error;
        }
      },
      async write(storePath, storeObj, options) {
        void storePath;
        void storeObj;
        void options;
        throw new Error('旧プロフィール付随物への書き込みは廃止されました');
      },
    };
  }

  async function _resolveTransport() {
    const registry = window.MeldexProfileStoreTransport;
    if (registry && typeof registry.select === 'function') {
      try {
        const selected = await registry.select();
        if (selected) return selected;
      } catch {}
    }
    return _fallbackDropboxApiTransport();
  }

  async function _profileManagementRecord() {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    const resolver = window.MeldexDropboxManagementRootResolver;
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.PROFILES_WORKSPACE;
    if (!provider || !resolver?.resolveTypedAdapterForProvider || !kind) {
      throw new Error('プロフィール管理データの保存先を安全に判定できません');
    }
    const adapter = await resolver.resolveTypedAdapterForProvider(provider, kind, { personalOnly: true });
    const record = await adapter.load(kind, 'dropbox-profiles');
    return { adapter, kind, record };
  }

  async function _readProfileStore() {
    const transport = await _resolveTransport();
    if (String(transport?.id || '').startsWith('dropbox-api')) {
      const managed = await _profileManagementRecord();
      if (managed.record?.payload) {
        return { store: _normalizeStore(managed.record.payload), rev: managed.record.revision };
      }
      // 旧ファイルは読取専用fallbackとし、初回だけ管理領域へ移す。
      const legacy = await transport.read(_profileStorePath());
      let legacyStore = _normalizeStore(legacy.store);
      if (!Object.keys(legacyStore.profiles).length) {
        const teamLegacy = await _readLegacyTeamProfileStore();
        if (teamLegacy) legacyStore = teamLegacy;
      }
      if (!Object.keys(legacyStore.profiles).length) return { store: legacyStore, rev: '' };
      try {
        await managed.adapter.save(managed.kind, 'dropbox-profiles', legacyStore, {
          expectedRevision: null,
        });
      } catch (error) {
        if (!_isConflictError(error)) throw error;
        const winner = await managed.adapter.load(managed.kind, 'dropbox-profiles');
        if (!winner?.payload) throw error;
        return { store: _normalizeStore(winner.payload), rev: String(winner.revision || '') };
      }
      const migrated = await managed.adapter.load(managed.kind, 'dropbox-profiles');
      return { store: _normalizeStore(migrated?.payload), rev: String(migrated?.revision || '') };
    }
    const result = await transport.read(_profileStorePath());
    return { store: _normalizeStore(result.store), rev: String(result.rev || '') };
  }

  async function _readLegacyTeamProfileStore() {
    const auth = _auth();
    if (!auth?.apiContent || !auth?.getNamespaceContext) return null;
    let context = null;
    try {
      context = await auth.getNamespaceContext(false);
    } catch {}
    if (!context?.isTeam) return null;
    try {
      const response = await auth.apiContent(
        'files/download',
        { path: _profileStorePath() },
        undefined,
        { namespaceKind: 'team_root' },
      );
      const parsed = _safeJsonParse(await response.text(), null);
      return parsed && typeof parsed === 'object' ? _normalizeStore(parsed) : null;
    } catch (error) {
      if (_isNotFoundError(error)) return null;
      throw error;
    }
  }

  async function _writeProfileStore(store, rev) {
    const transport = await _resolveTransport();
    if (String(transport?.id || '').startsWith('dropbox-api')) {
      const managed = await _profileManagementRecord();
      await managed.adapter.save(managed.kind, 'dropbox-profiles', store, {
        expectedRevision: rev || null,
      });
      return;
    }
    await transport.write(_profileStorePath(), store, { ifMatch: rev || '' });
  }

  // MeldexProfileIdentity が未ロードの場合は null を返し、呼び出し側が従来通り
  // 'dropbox-unconnected' で早期returnできるようにする（クラウド互換のため）。
  function _hasIdentityModule() {
    return !!(window.MeldexProfileIdentity && typeof window.MeldexProfileIdentity.resolveKey === 'function');
  }

  async function _resolveIdentityKey(store) {
    const identity = window.MeldexProfileIdentity;
    if (!identity || typeof identity.resolveKey !== 'function') return null;
    try {
      const result = await identity.resolveKey(store);
      return result && result.key ? result : null;
    } catch {
      return null;
    }
  }

  function _adoptLocalEntryIfMatching(store, accountId) {
    const identity = window.MeldexProfileIdentity;
    if (!identity || typeof identity.adoptLocalEntryIfMatching !== 'function') return null;
    try {
      return identity.adoptLocalEntryIfMatching(store, accountId);
    } catch {
      return null;
    }
  }

  async function saveCurrentProfile(overrides) {
    if (!await _shouldUseSharedProfile()) return { ok: false, reason: 'not-dropbox-workspace' };
    const account = await _getCurrentAccount(false);
    // OAuthのaccount_idが最優先。無ければ、呼び出し側が既に自己同定済みのキー
    // （_resolveStartupProfile が overrides.accountId として渡す）をそのまま使い、
    // 二度手間の store 読み直し・自己同定をしない。それも無ければ自己同定を試みる。
    let accountId = _accountId(account) || String(overrides?.accountId || '').trim();

    if (!accountId) {
      // OAuth未接続（デスクトップ・Dropbox未接続）: 自己同定ラダーが使えなければ
      // 従来通り即座に諦める（storeへは一切アクセスしない）。
      if (!_hasIdentityModule()) return { ok: false, reason: 'dropbox-unconnected' };
      let storeForIdentity;
      try {
        storeForIdentity = _normalizeStore((await _readProfileStore()).store);
      } catch (error) {
        return { ok: false, reason: 'dropbox-read-failed', error };
      }
      const link = await _resolveIdentityKey(storeForIdentity);
      if (!link) return { ok: false, reason: 'profile-unlinked' };
      accountId = link.key;
    }

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

  // 共有プロフィールに今いる「生きているプロフィール」の一覧を返す。
  // OAuth接続済み（クラウド版）は自己同定ラダーを経由しないため getLinkState()
  // から候補を拾えない。設定画面の統合導線がその場で読むために使う。
  async function listProfileCandidates() {
    if (!await _shouldUseSharedProfile()) return { ok: false, candidates: [], reason: 'not-dropbox-workspace' };
    const identity = window.MeldexProfileIdentity;
    if (!identity || typeof identity.listCandidates !== 'function') {
      return { ok: false, candidates: [], reason: 'identity-unavailable' };
    }
    try {
      const store = _normalizeStore((await _readProfileStore()).store);
      return { ok: true, candidates: identity.listCandidates(store) };
    } catch (error) {
      return { ok: false, candidates: [], reason: 'dropbox-read-failed', error };
    }
  }

  // 本人の明示選択による統合を共有ストアへ書き込む。
  // fromKey のエントリへ引き継ぎ先(toKey)を記録し、以後 fromKey は候補一覧・
  // 自己同定・共有判定の人数から外れる。
  //
  // fromKey は 'local:' エントリだけを受け付ける。'dbid:' エントリは実在する
  // Dropboxアカウントの正本であり、他の端末・他人が今も使っている可能性がある
  // ため、引き継ぎ済みにして殺してはならない（v0.7.011 のなりすまし防止原則）。
  //
  // options.adoptContent が true の場合、同じ書き込みの中で fromKey 側の名前・
  // アイコンを toKey のエントリへ写し、この端末の表示にも反映する
  // （「デスクトップ版の設定を使う」統合）。
  async function mergeProfileInto(fromKey, toKey, options) {
    const from = String(fromKey || '').trim();
    const to = String(toKey || '').trim();
    if (!from.startsWith('local:')) return { ok: true, changed: false, reason: 'not-a-local-entry' };
    if (!await _shouldUseSharedProfile()) return { ok: false, changed: false, reason: 'not-dropbox-workspace' };
    const identity = window.MeldexProfileIdentity;
    if (!identity || typeof identity.mergeEntries !== 'function') {
      return { ok: false, changed: false, reason: 'identity-unavailable' };
    }
    const adoptContent = !!options?.adoptContent;
    const account = await _getCurrentAccount(false);

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let current;
      try {
        current = await _readProfileStore();
      } catch (error) {
        return { ok: false, changed: false, reason: 'dropbox-read-failed', error };
      }
      const store = _normalizeStore(current.store);
      const merged = identity.mergeEntries(store, from, to);
      if (!merged?.changed) return { ok: true, changed: false, reason: 'already-merged' };

      const nextStore = _normalizeStore(merged.store);
      const updatedAt = _nowIso();
      let adopted = null;
      if (adoptContent) {
        const source = store.profiles[from] || {};
        adopted = _normalizeProfile(account, {
          ...(nextStore.profiles[to] || {}),
          displayName: String(source.displayName || source.name || '').trim(),
          avatar: String(source.avatar || ''),
          avatarSpec: String(source.avatarSpec || ''),
          avatarBg: String(source.avatarBg || ''),
          accountId: to,
          updatedAt,
        }, updatedAt);
        if (!adopted.displayName) return { ok: false, changed: false, reason: 'empty-profile' };
        nextStore.profiles[to] = adopted;
        nextStore.updatedAt = updatedAt;
      }

      try {
        await _writeProfileStore(nextStore, current.rev);
        // 取り込んだ名前・アイコンはこの端末の表示にも反映する。統合先のキーで
        // ローカル更新時刻を記録し直すため、直後の起動時解決で往復しない。
        if (adopted) _applyProfileToLocal(adopted);
        return {
          ok: true,
          changed: true,
          mergedFrom: from,
          mergedInto: to,
          fromDisplayName: merged.mergedFromDisplayName || '',
          profile: adopted || null,
        };
      } catch (error) {
        lastError = error;
        if (!_isConflictError(error) || attempt >= 2) break;
      }
    }
    try { console.warn('[MeldexDropboxProfileSync] merge failed', lastError); } catch {}
    return { ok: false, changed: false, reason: 'dropbox-write-failed', error: lastError };
  }

  // 起動時解決の結果キャッシュを捨てる。連携先プロフィールを切り替えた直後に
  // resolveStartupProfile() を呼んでも、成功済みのキャッシュがそのまま返ってしまい
  // 新しいプロフィールがローカルへ反映されないため、切り替え操作の側から明示的に
  // 呼んでキャッシュを無効化する。
  function resetStartupResolution() {
    _startupProfilePromise = null;
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
    let accountId = _accountId(account);
    // 自己同定ラダーが使えない環境（gb-profile-identity.js 未ロード）では、
    // 従来通り store を読みにいく前に即座に諦める（クラウド互換のため）。
    if (!accountId && !_hasIdentityModule()) return { ok: false, reason: 'dropbox-unconnected' };

    let current;
    try {
      current = await _readProfileStore();
    } catch (error) {
      try { console.warn('[MeldexDropboxProfileSync] startup read failed', error); } catch {}
      return { ok: false, reason: 'dropbox-read-failed', error };
    }
    let store = _normalizeStore(current.store);

    if (!accountId) {
      // OAuth未接続: 記憶済みキー・唯一エントリ・表示名一致の順に自己同定を試みる。
      // 曖昧なまま決められない場合は store に一切書き込まない。
      const link = await _resolveIdentityKey(store);
      if (!link) return { ok: false, reason: 'profile-unlinked' };
      accountId = link.key;
    } else {
      // OAuth接続済み: 同じ表示名の 'local:' エントリ（デスクトップ側で先に作られた
      // ローカル専用プロフィール）があれば、その内容をこのaccount_idへ引き継ぐ。
      const adoption = _adoptLocalEntryIfMatching(store, accountId);
      if (adoption?.changed) {
        try {
          await _writeProfileStore(adoption.store, current.rev);
          current = await _readProfileStore();
          store = _normalizeStore(current.store);
        } catch (error) {
          // 引き継ぎ書き込みの失敗は起動を止めない（次回起動時に再試行される）。
          try { console.warn('[MeldexDropboxProfileSync] adopt local entry failed', error); } catch {}
        }
      }
    }

    const sharedRaw = store.profiles[accountId];
    if (sharedRaw && typeof sharedRaw === 'object') {
      // store のエントリ本体は accountId を持たないことがある（キー側が正本）。
      // OAuth未接続で自己同定ラダーが決めたキーはここで補わないと accountId が
      // 空のままになり、_applyProfileToLocal がローカル反映を行わずに抜けてしまう。
      const shared = _normalizeProfile(account, { ...sharedRaw, accountId: sharedRaw.accountId || accountId });
      if (_isLocalProfileNewer(accountId, shared.updatedAt)) {
        const updatedAt = _readStorage(LOCAL_UPDATED_KEY, '') || _nowIso();
        const mergedLocal = _normalizeProfile(account, {
          ...shared,
          displayName: _usableLocalDisplayName() || shared.displayName || _accountDisplayName(account),
          avatar: _readStorage(LOCAL_AVATAR_KEY, ''),
          avatarSpec: _readStorage(LOCAL_AVATAR_SPEC_KEY, ''),
          avatarBg: _readStorage(LOCAL_AVATAR_BG_KEY, ''),
          updatedAt,
        }, updatedAt);
        const saved = await saveCurrentProfile({ ...mergedLocal, accountId });
        const applied = _applyProfileToLocal(saved.ok ? saved.profile : mergedLocal);
        return { ok: true, source: saved.ok ? 'local-newer' : 'local', profile: applied };
      }
      const applied = _applyProfileToLocal(shared);
      return { ok: true, source: 'dropbox', profile: applied };
    }

    const initial = _localProfileForKey(account, accountId, _nowIso());
    if (!initial.displayName) return { ok: false, reason: 'empty-profile' };
    const applied = _applyProfileToLocal(initial);
    const saved = await saveCurrentProfile({ updatedAt: applied.updatedAt, accountId });
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

  function getLinkState() {
    return window.MeldexProfileIdentity?.getLinkState?.() || null;
  }

  window.MeldexDropboxProfileSync = {
    profileStorePath: _profileStorePath,
    resolveStartupProfile,
    resetStartupResolution,
    clearLocalUpdateMarker,
    saveCurrentProfile,
    afterLocalProfileChanged,
    listProfileCandidates,
    mergeProfileInto,
    teamSyncPayload,
    getCachedAccountId,
    getCachedProfile,
    getLinkState,
    _internals: {
      normalizeProfile: _normalizeProfile,
      localProfile: _localProfile,
      normalizeStore: _normalizeStore,
      isLocalProfileNewer: _isLocalProfileNewer,
      shouldUseSharedProfile: _shouldUseSharedProfile,
      hasLocalProfileData: _hasLocalProfileData,
    },
  };
})();
