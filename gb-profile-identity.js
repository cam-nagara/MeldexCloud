// gb-profile-identity.js
//
// Dropbox OAuth未接続の環境（デスクトップ版・Dropbox未接続）で、共有プロフィール
// ストア（profiles.v1.json）のどのエントリが「自分」かを自己同定するラダー。
// OAuthのaccount_idが取れない場合でも、記憶済みキー・唯一エントリ・表示名一致の
// 順で妥当な候補を探し、それでも決まらなければ何もしない（曖昧なまま書き込まない）。
//
// gb-dropbox-profile-sync.js から呼ばれる。ストアへの読み書き（I/O）はここでは
// 行わない（resolveKey は与えられた store を読むだけの純粋関数、
// adoptLocalEntryIfMatching は次のstoreを返すだけで実際の保存は呼び出し側が行う）。
// 例外: 記憶済みキーが引き継ぎ済み（supersededBy）エントリを指していた場合だけは、
// resolveKey が rememberKey() を呼んで記憶を追跡先へ更新する（記憶が恒久的に
// 死んだエントリへ固定され続けるのを防ぐための最小限の副作用）。
//
// 「引き継ぎ済み（supersededBy が付いた）」エントリは、単独エントリ判定・表示名
// 一致判定・候補一覧のいずれからも除外する（生きているエントリだけを対象にする）。
(function () {
  const LOCAL_ACCOUNT_KEY = 'meldex-profile-account-id';
  const LOCAL_USER_KEY = 'meldex-user';
  const LOCAL_AVATAR_KEY = 'meldex-avatar';
  const LOCAL_AVATAR_SPEC_KEY = 'meldex-avatar-spec';
  const LOCAL_AVATAR_BG_KEY = 'meldex-avatar-bg';
  const NOTICE_SHOWN_KEY = 'meldex-profile-link-notice-shown';

  let _lastLinkState = null;

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

  function _localDisplayName() {
    const value = _safeJsonParse(_readStorage(LOCAL_USER_KEY, '{}'), {});
    return String(value?.name || '').trim();
  }

  // 'anonymous' はユーザー名未設定時の既定値（gb-app.part03.js の getUsername() と
  // 同じ規約）。これを「実質プロフィール無し」の判定基準に使う。
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

  function _storeProfiles(store) {
    return store && typeof store === 'object' && store.profiles && typeof store.profiles === 'object' && !Array.isArray(store.profiles)
      ? store.profiles
      : {};
  }

  // 引き継ぎ済み（supersededBy が付いた）エントリを除いた「生きているエントリ」
  // だけを返す。単独エントリ判定・表示名一致判定・候補一覧の走査は、すべて
  // このヘルパー経由の結果を使うこと（旧エントリを誤って対象に含めないため）。
  function _livingProfiles(profiles) {
    const result = {};
    Object.keys(profiles).forEach((key) => {
      const profile = profiles[key];
      if (profile && profile.supersededBy) return;
      result[key] = profile;
    });
    return result;
  }

  function _profileDisplayName(profile) {
    return String(profile?.displayName || profile?.name || '').trim();
  }

  async function _oauthAccountId() {
    const auth = window.MeldexDropboxAuth;
    if (!auth?.getCurrentAccount) return '';
    try {
      const account = await auth.getCurrentAccount(false);
      return String(account?.account_id || account?.accountId || '').trim();
    } catch {
      return '';
    }
  }

  // 記憶済みキーが引き継ぎ済み(supersededBy)エントリを指している場合、引き継ぎ先を
  // 追跡して生きているキーへ辿り着く。循環参照や引き継ぎ先が存在しない壊れた
  // チェーンでは、それ以上辿れなくなった時点のキーをそのまま返す（無限ループ防止）。
  function _followSupersession(profiles, startKey) {
    let current = startKey;
    const seen = new Set([current]);
    while (true) {
      const profile = profiles[current];
      const next = profile && profile.supersededBy ? String(profile.supersededBy) : '';
      if (!next) return current;
      if (seen.has(next) || !Object.prototype.hasOwnProperty.call(profiles, next)) return current;
      seen.add(next);
      current = next;
    }
  }

  function _rememberedKeyIfPresent(profiles) {
    const remembered = _readStorage(LOCAL_ACCOUNT_KEY, '');
    if (!remembered || !Object.prototype.hasOwnProperty.call(profiles, remembered)) return '';
    const resolved = _followSupersession(profiles, remembered);
    // 引き継ぎ済みエントリを指していた記憶は、追跡先へ更新する（次回以降も
    // 同じ古いエントリへ恒久固定されないようにするため）。
    if (resolved !== remembered) rememberKey(resolved);
    return resolved;
  }

  function _singleEntryKeyIfNoLocalProfile(profiles) {
    const keys = Object.keys(profiles);
    if (keys.length !== 1 || _hasLocalProfileData()) return '';
    return keys[0];
  }

  function _nameMatchKey(profiles) {
    const localName = _usableLocalDisplayName();
    if (!localName) return '';
    const matches = Object.keys(profiles).filter((key) => _profileDisplayName(profiles[key]) === localName);
    return matches.length === 1 ? matches[0] : '';
  }

  function _generateLocalId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // crypto.randomUUID が無い実行環境向けの簡易フォールバック（暗号強度は求めない）。
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  function listCandidates(store) {
    // 引き継ぎ済みの旧エントリは候補一覧に出さない（表示名・アイコンが完全一致する
    // 判別不能な行が並ぶのを防ぐ）。
    const profiles = _livingProfiles(_storeProfiles(store));
    return Object.keys(profiles).map((key) => ({
      key,
      displayName: _profileDisplayName(profiles[key]),
      avatar: String(profiles[key]?.avatar || ''),
    }));
  }

  // 設定画面の候補選択UI（gb-settings-account-link.js）が、曖昧解決時に
  // 「今の設定のまま新しく登録する」を選んだ場合に使う新規ローカルキーの発行。
  // _generateLocalId() と同じ採番方式（'local-created' 経路と揃える）。
  function createLocalKey() {
    return 'local:' + _generateLocalId();
  }

  function _notifyAdoptedOnce(method) {
    if (method !== 'single-entry' && method !== 'name-match') return;
    if (_readStorage(NOTICE_SHOWN_KEY, '') === '1') return; // 初回だけ知らせる
    _writeStorage(NOTICE_SHOWN_KEY, '1');
    try {
      if (typeof window !== 'undefined' && typeof window.showStatus === 'function') {
        window.showStatus('クラウド版と同じ名前とアイコンを引き継ぎました', false);
      }
    } catch {}
  }

  // 自己同定ラダー。上から順に決まり次第終了する:
  //   1. oauth        — OAuth接続済みなら account_id
  //   2. remembered    — 前回記憶したキーが今のstoreにまだ存在する（引き継ぎ済みなら追跡先へ）
  //   3. single-entry  — 生きているエントリがstoreに1件だけ、かつローカルに実質プロフィール無し
  //   4. name-match    — 生きているエントリのうちローカル表示名と完全一致するものがちょうど1件
  //   5. local-created — 生きているエントリが0件、かつローカルに名前あり→ 'local:'+UUID を新規発行
  //   6. unlinked      — 曖昧。呼び出し側は store に書き込んではならない
  //
  // 3〜5・候補一覧は「生きているエントリ」（supersededByの付いていないエントリ）
  // だけを対象にする。2の記憶済みキーだけは、引き継ぎ済みエントリを指していても
  // 追跡先へ辿り着ければ有効に扱う（_rememberedKeyIfPresent 参照）。
  async function resolveKey(store) {
    const profiles = _storeProfiles(store);
    const livingProfiles = _livingProfiles(profiles);
    const candidates = listCandidates(store);

    const oauthId = await _oauthAccountId();
    if (oauthId) {
      const result = { method: 'oauth', key: oauthId, candidates };
      _lastLinkState = result;
      return result;
    }

    const remembered = _rememberedKeyIfPresent(profiles);
    if (remembered) {
      const result = { method: 'remembered', key: remembered, candidates };
      _lastLinkState = result;
      return result;
    }

    const singleEntry = _singleEntryKeyIfNoLocalProfile(livingProfiles);
    if (singleEntry) {
      const result = { method: 'single-entry', key: singleEntry, candidates };
      _lastLinkState = result;
      _notifyAdoptedOnce('single-entry');
      return result;
    }

    const nameMatch = _nameMatchKey(livingProfiles);
    if (nameMatch) {
      const result = { method: 'name-match', key: nameMatch, candidates };
      _lastLinkState = result;
      _notifyAdoptedOnce('name-match');
      return result;
    }

    if (Object.keys(livingProfiles).length === 0 && _usableLocalDisplayName()) {
      const result = { method: 'local-created', key: 'local:' + _generateLocalId(), candidates: [] };
      _lastLinkState = result;
      return result;
    }

    const result = { method: 'unlinked', key: null, candidates };
    _lastLinkState = result;
    return result;
  }

  function rememberKey(key) {
    if (key) _writeStorage(LOCAL_ACCOUNT_KEY, key);
  }

  // 記憶済みキーを消す（設定画面の「別のプロフィールに切り替える」から使う）。
  // rememberKey() は空文字を無視するため記憶を消せない。forgetKey() は
  // _writeStorage() の「value===''ならremoveItem」経路をそのまま使う。
  function forgetKey() {
    _writeStorage(LOCAL_ACCOUNT_KEY, '');
  }

  function getLinkState() {
    return _lastLinkState ? { ..._lastLinkState } : null;
  }

  function getStableActorId() {
    const remembered = String(_readStorage(LOCAL_ACCOUNT_KEY, '') || '').trim();
    if (remembered) return remembered;
    const created = createLocalKey();
    rememberKey(created);
    return created;
  }

  function getActorSnapshot() {
    return {
      actorId: getStableActorId(),
      displayName: String(_readStorage(LOCAL_USER_KEY, '') || 'anonymous').trim() || 'anonymous',
      kind: 'human',
    };
  }

  // OAuth起動時、accountIdエントリが無く、ローカル表示名と一致する 'local:' エントリ
  // (まだ他のaccountIdへ引き継ぎ済みでないもの)が「ちょうど1件」あれば、その内容を
  // accountIdへコピーする。旧エントリは削除せず supersededBy を付与するだけ。既に
  // accountId エントリがあれば何もしない。同名候補が複数ある場合は、どちらが本人か
  // 決められないため何もしない（変更なし＝呼び出し側は新規エントリ作成へ落ちる。
  // 曖昧解決UIをここに新設すると自己同定と設定画面の責務が混ざるため行わない）。
  // 戻り値の store はコピー後の新しいオブジェクト（呼び出し側が実際の保存を行う）。
  function adoptLocalEntryIfMatching(store, accountId) {
    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) return { changed: false, store };
    const profiles = _storeProfiles(store);
    if (Object.prototype.hasOwnProperty.call(profiles, normalizedAccountId)) {
      return { changed: false, store };
    }
    const localName = _usableLocalDisplayName();
    if (!localName) return { changed: false, store };
    const matchKeys = Object.keys(profiles).filter((key) => {
      const profile = profiles[key];
      return key.startsWith('local:') && !profile?.supersededBy && _profileDisplayName(profile) === localName;
    });
    if (matchKeys.length !== 1) return { changed: false, store };
    const matchKey = matchKeys[0];

    const sourceProfile = { ...profiles[matchKey] };
    const nextProfiles = { ...profiles };
    nextProfiles[normalizedAccountId] = { ...sourceProfile, accountId: normalizedAccountId, profileId: normalizedAccountId };
    nextProfiles[matchKey] = { ...sourceProfile, supersededBy: normalizedAccountId };
    return { changed: true, store: { ...store, profiles: nextProfiles }, adoptedFrom: matchKey };
  }

  // 本人の明示選択による統合。fromKey のエントリへ「引き継ぎ先は toKey」と記録した
  // 新しい store を返す純粋関数（実際の保存は呼び出し側が行う）。旧エントリは
  // 削除せず supersededBy を付けるだけなので、記憶済みキーが旧エントリを指している
  // 他の端末も _followSupersession で新しい方へ辿り着ける。
  //
  // 次の場合は何もしない（changed:false）:
  //   - どちらかのキーが空、または同じキー
  //   - どちらかのエントリが store に存在しない（宙に浮いた引き継ぎ先を作らない）
  //   - fromKey が既に引き継ぎ済み（二重統合で引き継ぎ先が枝分かれするのを防ぐ）
  //   - toKey 側を辿ると fromKey へ戻る（循環参照を作らない）
  function mergeEntries(store, fromKey, toKey) {
    const from = String(fromKey || '').trim();
    const to = String(toKey || '').trim();
    if (!from || !to || from === to) return { changed: false, store };
    const profiles = _storeProfiles(store);
    if (!Object.prototype.hasOwnProperty.call(profiles, from)) return { changed: false, store };
    if (!Object.prototype.hasOwnProperty.call(profiles, to)) return { changed: false, store };
    if (profiles[from]?.supersededBy) return { changed: false, store };
    if (_followSupersession(profiles, to) === from) return { changed: false, store };

    const nextProfiles = { ...profiles };
    nextProfiles[from] = { ...profiles[from], supersededBy: to };
    return {
      changed: true,
      store: { ...store, profiles: nextProfiles },
      mergedFrom: from,
      mergedInto: to,
      mergedFromDisplayName: _profileDisplayName(profiles[from]),
    };
  }

  window.MeldexProfileIdentity = {
    resolveKey,
    rememberKey,
    forgetKey,
    getLinkState,
    getStableActorId,
    getActorSnapshot,
    listCandidates,
    adoptLocalEntryIfMatching,
    mergeEntries,
    createLocalKey,
  };
})();
