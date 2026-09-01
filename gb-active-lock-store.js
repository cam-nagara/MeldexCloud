(function () {
  'use strict';

  const internals = window.__MeldexPwaDataAccessInternals;
  const handlers = window.__MeldexPwaDataAccessExtensions;
  if (!internals || !Array.isArray(handlers)) return;

  const {
    NOT_HANDLED,
    _normalizeFolderPath,
    _readJsonSafe,
    _pathExists,
  } = internals;

  // PC本体(meldex_active_locks.py)が今回のPhase 4では変更対象外のまま同じパスへ
  // 書き続けるため、Cloud側もこの旧パスの「読取」だけは続ける(相互運用)。
  // Cloud側からの新規書込は共通ストレージ層(gb-dropbox-management-root-resolver.js
  // が解決する新管理領域、種別 edit-locks)だけへ行い、この旧パスへは二度と
  // 書き込まない(PC本体のファイルI/Oとの書込競合を避けるため)。
  //
  // PC本体(meldex_active_locks.py)側もDropbox共通ストレージ層(edit-locks)を
  // 併読するようになり(固有形式付随物廃止 Phase 4引き継ぎ事項の解消)、双方向の
  // 可視性自体は揃った。ただしPC↔Cloud間のロック競合検知修正までは、双方が
  // 「見える」だけで実際の競合判定(パス文字列一致)が形式不一致により機能して
  // いなかった: legacy entry(_readLegacyEntries経由)の normalized_path は
  // PC本体が書くOS依存の絶対パス(normalize_lock_path の出力)で、Cloud側の
  // 相対パス空間とは形式が異なる。_cleanEntry はこの絶対パスを信用せず、常に
  // 相対パスの path フィールドから normalized_path を再計算する(下記参照)。
  const STORE_PATH = '_meldex/active_locks.json';
  const STORE_DOCUMENT_ID = 'active-lock-store';
  const HEADER = 'X-Meldex-Active-Lock-Token';
  const LEASE_SECONDS = 300;
  const READ_POST_ENDPOINTS = new Set([
    '/production-management/tasks/query', '/production-management/tasks/preview',
    '/production-management/tasks/structure/preview', '/production-management/recalculate/preview',
    '/production-management/assign/preview',
  ]);
  // 協調編集事故を減らす短期リース。アクセス権限はDropbox共有権限と既存の編集ロックで扱う。
  const SYSTEM_EXCLUDED = new Set(['_chat', '_skills', '_models', '_knowledge', '.meldex', '_meldex', '.trash', '_trash']);

  function _normalize(path) {
    return _normalizeFolderPath(path).toLowerCase();
  }

  function _isSystemExcluded(path) {
    const parts = _normalize(path).split('/').filter(Boolean);
    return parts.some(part => SYSTEM_EXCLUDED.has(part));
  }

  function _nowMs() {
    return Date.now();
  }

  function _expiresAt(leaseSeconds) {
    const seconds = Math.max(30, Math.min(300, Number(leaseSeconds) || LEASE_SECONDS));
    return new Date(_nowMs() + seconds * 1000).toISOString();
  }

  function _cleanText(value, maxLen) {
    return String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, maxLen || 160);
  }

  function _cleanHolder(holder) {
    const holderId = _cleanText(holder?.holder_id || holder?.holderId, 160);
    const expiresAt = String(holder?.expires_at || holder?.expiresAt || '');
    const expiresMs = Date.parse(expiresAt);
    if (!holderId || !Number.isFinite(expiresMs) || expiresMs <= _nowMs()) return null;
    const rawHeartbeat = String(holder?.heartbeat_at || holder?.heartbeatAt || '');
    const heartbeatAt = Number.isFinite(Date.parse(rawHeartbeat)) ? rawHeartbeat : new Date().toISOString();
    return {
      holder_id: holderId,
      heartbeat_at: heartbeatAt,
      expires_at: expiresAt,
    };
  }

  function _entryHolders(entry) {
    if (Array.isArray(entry?.holders)) return entry.holders.map(_cleanHolder).filter(Boolean);
    const expiresAt = String(entry?.expires_at || '');
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= _nowMs()) return [];
    return [{
      holder_id: 'legacy',
      heartbeat_at: String(entry?.heartbeat_at || entry?.acquired_at || new Date().toISOString()),
      expires_at: expiresAt,
    }];
  }

  function _entryWithHolders(entry, holders) {
    const cleaned = (holders || []).map(_cleanHolder).filter(Boolean);
    if (!cleaned.length) return null;
    const byExpiry = [...cleaned].sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at));
    const byHeartbeat = [...cleaned].sort((a, b) => Date.parse(b.heartbeat_at) - Date.parse(a.heartbeat_at));
    return {
      ...entry,
      holders: cleaned.sort((a, b) => a.holder_id.localeCompare(b.holder_id)),
      heartbeat_at: byHeartbeat[0]?.heartbeat_at || entry?.heartbeat_at,
      expires_at: byExpiry[0]?.expires_at || entry?.expires_at,
    };
  }

  function _headerValue(headers, name) {
    if (!headers) return '';
    if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(name) || '';
    if (Array.isArray(headers)) {
      const row = headers.find(item => String(item?.[0] || '').toLowerCase() === name.toLowerCase());
      return row ? String(row[1] || '') : '';
    }
    if (typeof headers === 'object') {
      const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
      return key ? String(headers[key] || '') : '';
    }
    return '';
  }

  function _token(body, headers) {
    const value = _headerValue(headers, HEADER) || body?.token || '';
    const text = String(value || '').trim();
    return text.length <= 160 ? text : '';
  }

  async function _tokenHash(token) {
    const text = String(token || '').trim();
    if (!text) return '';
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function _cleanEntry(entry) {
    const path = _normalizeFolderPath(entry?.path || '');
    // entry.normalized_path は信用しない(PC↔Cloud間のロック競合検知修正)。
    // 旧パス(_meldex/active_locks.json、meldex_active_locks.py が書く)経由で
    // 読み込んだ legacy entry の normalized_path は PC のOS依存な絶対パス
    // (normalize_lock_path の出力)であり、Cloud側の相対パス空間とは形式が
    // 異なるため、そのまま使うと _findConflict が実データでは常に不一致になり
    // 競合検知が機能しない。Cloud自身が書いたentryの normalized_path も常に
    // path から導出した値と同一なので、常に path から計算し直しても損はない。
    const normalized = _normalize(path);
    const tokenHash = String(entry?.token_hash || '').trim().toLowerCase();
    if (!path || !normalized || !tokenHash) return null;
    const holders = _entryHolders(entry);
    if (!holders.length) return null;
    const withHolders = _entryWithHolders(entry, holders);
    const cleaned = {
      path,
      normalized_path: normalized,
      token_hash: tokenHash,
      lock_id: tokenHash.slice(0, 12),
      locked_by: _cleanText(entry?.locked_by, 80),
      device_id: _cleanText(entry?.device_id, 80),
      device_label: _cleanText(entry?.device_label, 120),
      kind: _cleanText(entry?.kind || 'edit', 40),
      include_descendants: entry?.include_descendants === true || entry?.includeDescendants === true,
      acquired_at: String(entry?.acquired_at || new Date().toISOString()),
      heartbeat_at: String(withHolders?.heartbeat_at || new Date().toISOString()),
      expires_at: String(withHolders?.expires_at || _expiresAt(LEASE_SECONDS)),
      holders: withHolders.holders,
    };
    // 'root' = 管理スコープの正準パス(個人=ホーム同期ルート相対 / 共有=
    // ワークスペースルート相対。meldex_active_locks.py の相互運用契約と同じ)
    // で保存された新形式。旧形式entryにはこのフィールドが無く、照合時に
    // ローカルパスとして再解釈する。
    if (entry?.path_space === 'root') cleaned.path_space = 'root';
    return cleaned;
  }

  // --- 管理スコープ解決(対象文書パス→個人/共有ワークスペースの管理領域) --------
  //
  // ストアは管理スコープごとに1つ。対象文書パスからスコープを決め、共有ソース
  // 配下の文書のロックは共有管理領域のストアへ、entryのパスはそのスコープの
  // 正準形で保存する(PC本体 meldex_active_locks.py が併読する際の相対パス基準
  // と同じ)。スコープを一意に決められない操作(list / release-all / パス変更
  // フック)は全スコープを集約する。

  function _resolver() {
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!resolver) throw new Error('gb-dropbox-management-root-resolver.js が読み込まれていません');
    return resolver;
  }

  async function _scopeForPath(provider, targetPath) {
    return _resolver().resolveManagementScopeForPath(provider, targetPath);
  }

  async function _allScopes(provider) {
    return _resolver().resolveManagementScopesForProvider(provider);
  }

  function _canonicalForScope(scope, localPath) {
    return _normalizeFolderPath(scope.toCanonicalPath(_normalizeFolderPath(localPath)));
  }

  // entryの正準パス(一義)。path_space === 'root' の新形式entryは保存済みの値が
  // そのまま正準形(PC本体 _encode_management_entry も同フィールドを書く)。
  // 旧形式entry(path_spaceなし)は「そのentryが載っているストアのスコープ」で
  // 解釈を一つに決める: 接続中スコープのストア(旧パス併読を含む)にある旧entryは
  // 自分のローカルパスとして正準化し、非接続スコープのストアにある旧entryは
  // そのルートへ直接接続していたクライアントが書いたもの(ローカル=正準)として
  // 扱う。二重解釈は別ソースの同名フォルダとの誤一致(誤423)を生むため行わない。
  function _entryCanonicalForms(entry, scope) {
    const stored = _normalizeFolderPath(entry?.path || '');
    if (!stored) return [];
    if (!scope || entry?.path_space === 'root' || !scope.isConnectedRootScope) return [stored];
    try {
      const reinterpreted = _canonicalForScope(scope, stored);
      return [reinterpreted || stored];
    } catch {
      return [stored]; // スコープ外のパスは正準化できない(保存値のまま照合する)。
    }
  }

  function _localizedEntry(entry, scope) {
    if (!scope || !entry) return entry;
    // 接続中スコープの旧形式entryは保存値が既にローカルパスなので変換しない。
    if (entry.path_space !== 'root' && scope.isConnectedRootScope) return entry;
    try {
      const local = _normalizeFolderPath(scope.toLocalPath(entry.path));
      if (local && local !== entry.path) {
        return { ...entry, path: local, normalized_path: _normalize(local) };
      }
    } catch {
      // 逆変換できない場合は保存済みのパスをそのまま表示する。
    }
    return entry;
  }

  async function _readLegacyEntries(provider, scope) {
    // 旧パス(_meldex/active_locks.json)は接続中ルート配下にしか存在しない。
    // 別スコープ(共有ソース等)の読取へ接続中ルートの旧データを混ぜない。
    if (scope && !scope.isConnectedRootScope) return [];
    const exists = await _pathExists(provider, STORE_PATH).catch(() => false);
    if (!exists) return [];
    const data = await _readJsonSafe(provider, STORE_PATH, { entries: [] });
    return (Array.isArray(data?.entries) ? data.entries : []).map(_cleanEntry).filter(Boolean);
  }

  async function _readNewStoreRecord(provider, scope) {
    if (!scope) return null;
    try {
      return await scope.adapter.load(window.MeldexSystemStorage.SystemStorageKind.EDIT_LOCKS, STORE_DOCUMENT_ID);
    } catch {
      return null; // 共通ストレージ層が使えない場合も、旧パス読取だけで機能を継続する。
    }
  }

  function _mergeEntryLists(...lists) {
    const byKey = new Map();
    for (const list of lists) {
      for (const entry of (list || [])) {
        if (!entry) continue;
        const key = `${entry.token_hash}:${entry.normalized_path}`;
        const prior = byKey.get(key);
        if (!prior || Date.parse(entry.heartbeat_at || '') > Date.parse(prior.heartbeat_at || '')) {
          byKey.set(key, entry);
        }
      }
    }
    return Array.from(byKey.values());
  }

  async function _readStore(provider, scope) {
    const [record, legacyEntries] = await Promise.all([
      _readNewStoreRecord(provider, scope),
      _readLegacyEntries(provider, scope),
    ]);
    const newEntries = record ? _entriesFromStore(record.payload) : [];
    return {
      entries: _mergeEntryLists(newEntries, legacyEntries),
      updated_at: String(record?.updatedAt || ''),
    };
  }

  // 読取専用の操作でスコープを解決できない場合(台帳破損等)は、旧パスのみの
  // 縮退読取で継続する(書込側はスコープ解決の例外で安全側に拒否される)。
  async function _readStoreForTarget(provider, path) {
    let scope = null;
    try {
      scope = await _scopeForPath(provider, path);
    } catch {
      scope = null;
    }
    if (scope) return { scope, store: await _readStore(provider, scope) };
    return { scope: null, store: { entries: await _readLegacyEntries(provider, null), updated_at: '' } };
  }

  function _storePayload(entries) {
    return {
      entries: entries.map(_cleanEntry).filter(Boolean).sort((a, b) => a.normalized_path.localeCompare(b.normalized_path)),
      updated_at: new Date().toISOString(),
    };
  }

  function _entriesFromStore(data) {
    return (Array.isArray(data?.entries) ? data.entries : []).map(_cleanEntry).filter(Boolean);
  }

  async function _mutateStore(provider, scope, updater) {
    const adapter = scope.adapter;
    const contract = window.MeldexSystemStorage;
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const [record, legacyEntries] = await Promise.all([
        adapter.load(contract.SystemStorageKind.EDIT_LOCKS, STORE_DOCUMENT_ID).catch(() => null),
        _readLegacyEntries(provider, scope),
      ]);
      const newEntries = record ? _entriesFromStore(record.payload) : [];
      const currentEntries = _mergeEntryLists(newEntries, legacyEntries);
      const change = await updater(currentEntries);
      if (change === false) return undefined;
      const payload = _storePayload(Array.isArray(change?.entries) ? change.entries : []);
      try {
        await adapter.save(contract.SystemStorageKind.EDIT_LOCKS, STORE_DOCUMENT_ID, payload, {
          expectedRevision: record ? record.revision : undefined,
        });
        return change?.result;
      } catch (error) {
        if (error instanceof contract.SystemStorageConflictError && attempt < MAX_ATTEMPTS - 1) continue;
        throw error;
      }
    }
    return undefined;
  }

  function _pathsOverlap(target, locked, includeDescendants) {
    if (!target || !locked) return false;
    if (target === locked || target.startsWith(locked + '/')) return true;
    return !!includeDescendants && locked.startsWith(target + '/');
  }

  function _findConflict(entries, canonicalTarget, tokenHash, options = {}, scope = null) {
    const target = _normalize(canonicalTarget);
    if (!target) return null;
    return (entries || []).find(entry => {
      if (tokenHash && entry?.token_hash === tokenHash) return false;
      return _entryCanonicalForms(entry, scope)
        .some(form => _pathsOverlap(target, form.toLowerCase(), !!options.includeDescendants));
    }) || null;
  }

  function _entryMatchesToken(entry, tokenHash, canonicalLower, scope) {
    return entry.token_hash === tokenHash
      && _entryCanonicalForms(entry, scope).some(form => form.toLowerCase() === canonicalLower);
  }

  function _conflictError(entry, path) {
    const owner = entry?.locked_by || entry?.device_label || '別の端末';
    const err = new Error(`${owner}が編集中のため保存できません: ${_normalizeFolderPath(entry?.path || path || '')}`);
    err.status = 423;
    err.lock_entry = entry || null;
    err.unlock_hint = '相手の編集が終わるか、数分後に再試行してください。';
    return err;
  }

  function _entryPayload(path, body, tokenHash, existing) {
    const now = new Date().toISOString();
    const holderId = _cleanText(body?.holder_id || body?.holderId, 160) || 'legacy';
    const holders = _entryHolders(existing).filter(holder => holder.holder_id !== holderId);
    holders.push({
      holder_id: holderId,
      heartbeat_at: now,
      expires_at: _expiresAt(body?.lease_seconds || body?.leaseSeconds),
    });
    return _entryWithHolders({
      path: _normalizeFolderPath(path),
      path_space: 'root',
      normalized_path: _normalize(path),
      token_hash: tokenHash,
      lock_id: tokenHash.slice(0, 12),
      locked_by: _cleanText(body?.locked_by, 80),
      device_id: _cleanText(body?.device_id, 80),
      device_label: _cleanText(body?.device_label, 120),
      kind: _cleanText(body?.kind || 'edit', 40),
      include_descendants: existing?.include_descendants === true
        || body?.include_descendants === true
        || body?.includeDescendants === true,
      acquired_at: existing?.acquired_at || now,
      heartbeat_at: now,
      expires_at: _expiresAt(body?.lease_seconds || body?.leaseSeconds),
    }, holders);
  }

  async function list(provider) {
    let scopes = null;
    try {
      scopes = await _allScopes(provider);
    } catch {
      scopes = null; // スコープ一覧を確定できない場合は旧パスのみの縮退読取。
    }
    if (!scopes) {
      const entries = await _readLegacyEntries(provider, null);
      return { entries, count: entries.length };
    }
    const collected = [];
    for (const scope of scopes) {
      const store = await _readStore(provider, scope);
      collected.push(store.entries.map(entry => _localizedEntry(entry, scope)));
    }
    const entries = _mergeEntryLists(...collected);
    return { entries, count: entries.length };
  }

  async function check(provider, path, token, options = {}) {
    if (!path || _isSystemExcluded(path)) return { locked: false, entry: null };
    const tokenHash = await _tokenHash(token);
    const { scope, store } = await _readStoreForTarget(provider, path);
    const target = scope ? _canonicalForScope(scope, path) : _normalizeFolderPath(path);
    const entry = _findConflict(store.entries, target, tokenHash, options, scope);
    return { locked: !!entry, entry: entry ? _localizedEntry(entry, scope) : null };
  }

  async function requireAvailable(provider, path, token, options = {}) {
    if (!path || _isSystemExcluded(path)) return { ok: true, locked: false };
    const result = await check(provider, path, token, options);
    if (result.locked) throw _conflictError(result.entry, path);
    return { ok: true, locked: false };
  }

  async function acquire(provider, body = {}, headers) {
    const path = _normalizeFolderPath(body.path || '');
    const token = _token(body, headers);
    if (!path) throw new Error('path は必須です');
    if (!token) throw new Error('ロックトークンがありません');
    if (_isSystemExcluded(path)) throw new Error('システムフォルダは自動編集中ロックの対象外です');
    const tokenHash = await _tokenHash(token);
    const includeDescendants = body?.include_descendants === true || body?.includeDescendants === true;
    const scope = await _scopeForPath(provider, path); // 書込はスコープ不明時に拒否(安全側)
    const canonical = _canonicalForScope(scope, path);
    const canonicalLower = _normalize(canonical);
    return _mutateStore(provider, scope, entries => {
      // writeJsonMerged の競合リトライごとに、必ずその時点の最新 entries で判定する。
      const conflict = _findConflict(entries, canonical, tokenHash, { includeDescendants }, scope);
      if (conflict) throw _conflictError(_localizedEntry(conflict, scope), path);
      const existing = entries.find(entry => _entryMatchesToken(entry, tokenHash, canonicalLower, scope));
      const next = entries.filter(entry => !_entryMatchesToken(entry, tokenHash, canonicalLower, scope));
      const entry = _entryPayload(canonical, body, tokenHash, existing);
      next.push(entry);
      return { entries: next, result: { ok: true, entry: _localizedEntry(entry, scope) } };
    });
  }

  async function heartbeat(provider, body = {}, headers) {
    const rawPaths = Array.isArray(body.paths) ? body.paths : [body.path];
    const entries = [];
    for (const path of rawPaths.map(_normalizeFolderPath).filter(Boolean)) {
      const result = await acquire(provider, { ...body, path }, headers);
      entries.push(result.entry);
    }
    return { ok: true, entries };
  }

  async function release(provider, path, token, holderId) {
    const localNormalized = _normalize(path);
    if (!localNormalized || !token) return { ok: true, removed: false };
    const tokenHash = await _tokenHash(token);
    const holder = _cleanText(holderId, 160);
    const scope = await _scopeForPath(provider, path);
    const canonicalLower = _normalize(_canonicalForScope(scope, path));
    return _mutateStore(provider, scope, entries => {
      let removed = false;
      const next = [];
      for (const entry of entries) {
        if (!_entryMatchesToken(entry, tokenHash, canonicalLower, scope)) {
          next.push(entry);
          continue;
        }
        if (!holder) {
          removed = true;
          continue;
        }
        const holders = _entryHolders(entry).filter(row => row.holder_id !== holder);
        removed = removed || holders.length !== _entryHolders(entry).length;
        const updated = _entryWithHolders(entry, holders);
        if (updated) next.push(updated);
      }
      return { entries: next, result: { ok: true, removed } };
    });
  }

  async function releaseAll(provider, token, holderId) {
    if (!token) return { ok: true, removed: 0 };
    const tokenHash = await _tokenHash(token);
    const holder = _cleanText(holderId, 160);
    // 対象パスを一意に決められない操作なので、登録ソース由来を含む全スコープの
    // ストアを走査する(個人領域だけを見て共有側のロックを取り残さない)。
    // ソース台帳を読めない場合は接続中スコープだけでも解放する(残りは短期
    // リースの満了で自己回復する)。
    let scopes = null;
    try {
      scopes = await _allScopes(provider);
    } catch {
      scopes = [await _scopeForPath(provider, '')];
    }
    let removed = 0;
    for (const scope of scopes) {
      const result = await _mutateStore(provider, scope, entries => {
        let scopeRemoved = 0;
        const next = [];
        for (const entry of entries) {
          if (entry.token_hash !== tokenHash) {
            next.push(entry);
            continue;
          }
          if (!holder) {
            scopeRemoved += 1;
            continue;
          }
          const before = _entryHolders(entry);
          const holders = before.filter(row => row.holder_id !== holder);
          if (holders.length !== before.length) scopeRemoved += 1;
          const updated = _entryWithHolders(entry, holders);
          if (updated) next.push(updated);
        }
        if (!scopeRemoved) return false; // 変更が無いスコープのストアは書き換えない。
        return { entries: next, result: { ok: true, removed: scopeRemoved } };
      });
      removed += Number(result?.removed || 0);
    }
    return { ok: true, removed };
  }

  function _pathDir(path) {
    const text = _normalizeFolderPath(path || '');
    const index = text.lastIndexOf('/');
    return index > 0 ? text.slice(0, index) : '';
  }

  function _pathBase(path) {
    const text = _normalizeFolderPath(path || '');
    const index = text.lastIndexOf('/');
    return index >= 0 ? text.slice(index + 1) : text;
  }

  function _joinPath(parent, child) {
    return _normalizeFolderPath([parent, child].filter(Boolean).join('/'));
  }

  function _splitNameAndExtension(name) {
    const text = String(name || '');
    const index = text.lastIndexOf('.');
    if (index <= 0) return { stem: text, extension: '' };
    return { stem: text.slice(0, index), extension: text.slice(index) };
  }

  async function _entryKind(provider, path) {
    if (!path) return '';
    if (typeof provider?.statPath === 'function') return String((await provider.statPath(path))?.kind || '');
    if (typeof internals._resolveEntryHandle === 'function') {
      return String((await internals._resolveEntryHandle(provider, path))?.kind || '');
    }
    return '';
  }

  async function _moveTarget(provider, sourcePath, destFolder, isFile) {
    if (!sourcePath || !destFolder) return '';
    if (_pathDir(sourcePath) === destFolder) return sourcePath;
    const sourceName = _pathBase(sourcePath);
    const split = _splitNameAndExtension(sourceName);
    const baseName = isFile ? split.stem : sourceName;
    const extension = isFile ? split.extension : '';
    let candidate = _joinPath(destFolder, baseName + extension);
    if (!await _pathExists(provider, candidate)) return candidate;
    for (let index = 1; index < 10000; index += 1) {
      candidate = _joinPath(destFolder, `${baseName}_${String(index).padStart(4, '0')}${extension}`);
      if (!await _pathExists(provider, candidate)) return candidate;
    }
    return _joinPath(destFolder, `${baseName}_${Date.now()}${extension}`);
  }

  function _renameTarget(sourcePath, newName, isFile) {
    if (!sourcePath || !newName) return '';
    const extension = isFile ? _splitNameAndExtension(_pathBase(sourcePath)).extension : '';
    return _joinPath(_pathDir(sourcePath), String(newName).replace(/[\\/]/g, '').trim() + extension);
  }

  function _addCandidate(candidates, value, options = {}) {
    const path = _normalizeFolderPath(value || '');
    if (!path) return;
    candidates.push({
      path,
      includeDescendants: options.includeDescendants === true,
      purpose: String(options.purpose || ''),
    });
  }

  function _uniqueCandidates(candidates) {
    const byPath = new Map();
    for (const candidate of candidates || []) {
      const key = _normalize(candidate?.path || '');
      if (!key) continue;
      const previous = byPath.get(key);
      byPath.set(key, previous ? {
        ...previous,
        includeDescendants: previous.includeDescendants || candidate.includeDescendants,
      } : candidate);
    }
    return [...byPath.values()];
  }

  async function _candidatePaths({ pathname, url, body, provider }) {
    const candidates = [];
    const legacyIncludeDescendants = pathname.includes('folder') || pathname.includes('delete-batch');
    const query = (key, options = {}) => _addCandidate(candidates, url.searchParams.get(key), {
      includeDescendants: options.includeDescendants ?? legacyIncludeDescendants,
      purpose: options.purpose,
    });
    const payload = (key, options = {}) => _addCandidate(candidates, body?.[key], {
      includeDescendants: options.includeDescendants ?? legacyIncludeDescendants,
      purpose: options.purpose,
    });
    const both = (key, options) => { query(key, options); payload(key, options); };
    if (pathname === '/file' || pathname === '/value' || pathname === '/db-metadata' || pathname === '/replace') {
      both('path');
      payload('entry_path');
      payload('folder_path');
    } else if (pathname === '/upload-file') {
      both('path');
      payload('dir');
    } else if (pathname === '/outliner/add') {
      payload('parent');
    } else if (pathname === '/outliner/delete') {
      const sourcePath = _normalizeFolderPath(body?.path || '');
      _addCandidate(candidates, sourcePath, {
        includeDescendants: await _entryKind(provider, sourcePath) === 'directory',
        purpose: 'source',
      });
    } else if (pathname === '/outliner/delete-batch') {
      for (const item of Array.isArray(body?.items) ? body.items : []) {
        const sourcePath = _normalizeFolderPath(item?.path || '');
        _addCandidate(candidates, sourcePath, {
          includeDescendants: await _entryKind(provider, sourcePath) === 'directory',
          purpose: 'source',
        });
      }
    } else if (pathname === '/outliner/duplicate') {
      const srcPath = _normalizeFolderPath(body?.path || '');
      if (srcPath) _addCandidate(candidates, _pathDir(srcPath));
    } else if (pathname === '/outliner/save-as') {
      payload('path');
      payload('dest_folder');
    } else if (pathname === '/outliner/move') {
      const sourcePath = _normalizeFolderPath(body?.path || '');
      const destFolder = _normalizeFolderPath(body?.dest_folder || '');
      const sourceKind = await _entryKind(provider, sourcePath);
      _addCandidate(candidates, sourcePath, {
        includeDescendants: sourceKind === 'directory',
        purpose: 'source',
      });
      _addCandidate(candidates, await _moveTarget(provider, sourcePath, destFolder, sourceKind === 'file'), {
        includeDescendants: false,
        purpose: 'destination',
      });
    } else if (pathname === '/outliner/rename' || pathname === '/entity/rename') {
      const oldPath = _normalizeFolderPath(pathname === '/outliner/rename' ? body?.old_path : body?.path);
      const newName = String(body?.new_name || '').replace(/[\\/]/g, '').trim();
      const sourceKind = await _entryKind(provider, oldPath);
      const isFile = sourceKind === 'file' || (sourceKind !== 'directory' && !!_splitNameAndExtension(_pathBase(oldPath)).extension);
      _addCandidate(candidates, oldPath, {
        includeDescendants: sourceKind === 'directory',
        purpose: 'source',
      });
      _addCandidate(candidates, _renameTarget(oldPath, newName, isFile), {
        includeDescendants: false,
        purpose: 'destination',
      });
    } else if (pathname === '/entity/create') {
      payload('parent_path');
    } else if (pathname === '/entity/auto-name') {
      payload('db_path');
      payload('entry_path');
      payload('path');
    } else if (pathname === '/folder-links/add' || pathname === '/folder-links/remove') {
      payload('folder_path');
      payload('file_path');
    } else if (pathname === '/annotations' || pathname === '/annotations/restore' || pathname === '/annotations/orphan-by-target') {
      payload('target_path');
    } else if (pathname === '/import-csv' || pathname === '/import-xlsx') {
      payload('csv_path');
      payload('xlsx_path');
      payload('db_path');
    } else if (pathname === '/public-form/submit') {
      payload('db_path');
    } else if (pathname === '/production-management/entries') {
      payload('path');
    } else if (pathname.startsWith('/calendar-db/events') || pathname.startsWith('/calendar-db/sync') || pathname.startsWith('/calendar-db/ical') || pathname.startsWith('/calendar-db/caldav')) {
      both('db_path');
    } else if (pathname === '/version/restore' || pathname === '/version/restore-db' || pathname === '/version/restore-folder' || pathname === '/version/delete-folder' || pathname === '/version/delete-db') {
      payload('path');
    }
    return _uniqueCandidates(candidates);
  }

  async function guardMutationRequest({ method, body, url, pathname, headers }) {
    if (method === 'GET') return;
    if (method === 'POST' && READ_POST_ENDPOINTS.has(pathname)) return;
    if (pathname === '/active-lock' || pathname.startsWith('/active-lock/')) return;
    const provider = await internals._requirePwaProvider('readwrite');
    const candidates = await _candidatePaths({ pathname, url, body, provider });
    if (!candidates.length) return;
    const token = _token(body || {}, headers);
    for (const candidate of candidates) {
      await requireAvailable(provider, candidate.path, token, {
        includeDescendants: candidate.includeDescendants,
      });
    }
  }

  handlers.push(async function _dropboxActiveLockHandler({ method, body, url, pathname, headers }) {
    if (pathname === '/active-lock' && method === 'GET') {
      const provider = await internals._requirePwaProvider('read');
      return list(provider);
    }
    if (pathname === '/active-lock/check' && method === 'GET') {
      const provider = await internals._requirePwaProvider('read');
      return check(provider, url.searchParams.get('path') || '', _headerValue(headers, HEADER), {
        includeDescendants: url.searchParams.get('include_descendants') === 'true',
      });
    }
    if (pathname === '/active-lock' && method === 'PUT') {
      const provider = await internals._requirePwaProvider('readwrite');
      return acquire(provider, body || {}, headers);
    }
    if (pathname === '/active-lock/heartbeat' && method === 'POST') {
      const provider = await internals._requirePwaProvider('readwrite');
      return heartbeat(provider, body || {}, headers);
    }
    if (pathname === '/active-lock/release-all' && method === 'POST') {
      const provider = await internals._requirePwaProvider('readwrite');
      return releaseAll(provider, _token(body || {}, headers), body?.holder_id || body?.holderId || '');
    }
    if (pathname === '/active-lock' && method === 'DELETE') {
      const provider = await internals._requirePwaProvider('readwrite');
      return release(
        provider,
        url.searchParams.get('path') || body?.path || '',
        _token(body || {}, headers),
        url.searchParams.get('holder_id') || body?.holder_id || body?.holderId || '',
      );
    }
    await guardMutationRequest({ method, body, url, pathname, headers });
    return NOT_HANDLED;
  });

  window.__MeldexPwaPathMutationHooks = window.__MeldexPwaPathMutationHooks || [];
  window.__MeldexPwaPathMutationHooks.push(async event => {
    const provider = await internals._requirePwaProvider('readwrite').catch(() => null);
    if (!provider) return;
    const oldPath = _normalizeFolderPath(event?.oldPath || event?.path || '');
    const newPath = _normalizeFolderPath(event?.newPath || '');
    const isDelete = event?.action === 'delete';
    const isMove = event?.action === 'rename' || event?.action === 'move';
    if (!oldPath || (!isDelete && !isMove) || (isMove && !newPath)) return;
    let oldScope = null;
    let canonicalOld = '';
    try {
      oldScope = await _scopeForPath(provider, oldPath);
      canonicalOld = _canonicalForScope(oldScope, oldPath);
    } catch {
      return; // スコープを判定できない場合はロック台帳を書き換えない。
    }
    let newScope = null;
    let canonicalNew = '';
    if (isMove) {
      try {
        newScope = await _scopeForPath(provider, newPath);
        canonicalNew = _canonicalForScope(newScope, newPath);
      } catch {
        return;
      }
    }
    const base = canonicalOld.toLowerCase();
    const crossScope = !!newScope && newScope.scopeKey !== oldScope.scopeKey;
    const moveResult = await _mutateStore(provider, oldScope, entries => {
      const next = [];
      const moved = [];
      let changed = false;
      for (const row of entries) {
        const matchedForm = _entryCanonicalForms(row, oldScope).find((form) => {
          const cur = form.toLowerCase();
          return cur === base || (event?.isFolder && cur.startsWith(base + '/'));
        });
        if (!matchedForm) {
          next.push(row);
          continue;
        }
        changed = true;
        if (isDelete) continue;
        const nextPath = matchedForm.toLowerCase() === base
          ? canonicalNew
          : canonicalNew + matchedForm.slice(canonicalOld.length);
        const rewritten = {
          ...row,
          path: _normalizeFolderPath(nextPath),
          path_space: 'root',
          normalized_path: _normalize(nextPath),
        };
        if (crossScope) moved.push(rewritten);
        else next.push(rewritten);
      }
      return changed ? { entries: next, result: { ok: true, moved } } : false;
    }).catch(() => null);
    const moved = Array.isArray(moveResult?.moved) ? moveResult.moved : [];
    if (!moved.length || !newScope) return;
    // スコープをまたぐ移動: 移動先スコープのストアへ引き継ぐ(短期リースのため
    // 途中失敗してもハートビートの再取得で自己回復する)。
    await _mutateStore(provider, newScope, entries => {
      const movedKeys = new Set(moved.map(row => `${row.token_hash}:${row.normalized_path}`));
      const kept = entries.filter(row => !movedKeys.has(`${row.token_hash}:${row.normalized_path}`));
      return { entries: [...kept, ...moved], result: { ok: true } };
    }).catch(() => {});
  });

  window.MeldexActiveLockStore = {
    list,
    check,
    acquire,
    heartbeat,
    release,
    releaseAll,
    guardMutationRequest,
  };
})();
