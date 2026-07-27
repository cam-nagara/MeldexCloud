(function () {
  'use strict';

  if (window.MeldexSourceFolderRegistry) return;

  const SETTINGS_PATH_KEY = 'meldex-dropbox-settings-path';
  const DEFAULT_SETTINGS_PATH = '/MeldexSettings';
  const REGISTRY_RELATIVE_PATH = '_meldex/source-folders.v1.json';
  const CACHE_KEY = 'meldex-source-folders-cache-v1';
  const OLD_PWA_ROOTS_KEY = 'meldex-cloud-outliner-roots';
  const SOURCE_PREFIX = '__dropbox_root__';
  let _lastRegistry = null;
  // フェーズ3c: loadOutlinerRoots() が最後に合流させたワークスペース由来
  // ルートの sourceId -> {dropboxPath} キャッシュ。_lastRegistry と同じ
  // 「直近の読み込み結果を同期的に参照するための思想」で、_findRoot /
  // virtualPathFromDropboxPath から使う。
  let _lastWorkspaceRootsById = new Map();

  function _auth() {
    return window.MeldexDropboxAuth;
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

  function _readJson(key, fallbackValue) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallbackValue;
    } catch {
      return fallbackValue;
    }
  }

  function _writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function normalizeDropboxPath(path) {
    const raw = String(path || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/');
    if (raw === '/') return '/';
    const normalized = raw.replace(/\/$/, '');
    if (!normalized) return '';
    return normalized.startsWith('/') ? normalized : ('/' + normalized);
  }

  function normalizeRelativePath(path) {
    return String(path || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
  }

  function normalizeNamespaceKind(value) {
    return value === 'team_root' ? 'team_root' : 'home';
  }

  function joinDropboxPath() {
    const parts = Array.from(arguments);
    const first = normalizeDropboxPath(parts.shift() || '');
    const rest = parts.map(normalizeRelativePath).filter(Boolean).join('/');
    if (!rest) return first;
    return first === '/' ? `/${rest}` : `${first}/${rest}`;
  }

  function getSettingsPath() {
    const fromAuth = _auth()?.getSettingsPath?.();
    return normalizeDropboxPath(fromAuth || _readStorage(SETTINGS_PATH_KEY, DEFAULT_SETTINGS_PATH)) || DEFAULT_SETTINGS_PATH;
  }

  function setSettingsPath(path) {
    _writeStorage(SETTINGS_PATH_KEY, normalizeDropboxPath(path) || DEFAULT_SETTINGS_PATH);
  }

  function registryDropboxPath() {
    return joinDropboxPath(getSettingsPath(), REGISTRY_RELATIVE_PATH);
  }

  function _basename(path) {
    const normalized = normalizeDropboxPath(path) || normalizeRelativePath(path);
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  function _slug(text) {
    const raw = String(text || '')
      .trim()
      .toLowerCase()
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .join('-')
      .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return raw || 'root';
  }

  function sourceIdForDropboxPath(dropboxPath, existingIds, namespaceKind) {
    const namespacePrefix = normalizeNamespaceKind(namespaceKind) === 'team_root' ? 'team-root:' : '';
    const base = `dropbox:${namespacePrefix}${_slug(normalizeDropboxPath(dropboxPath))}`;
    const used = new Set(existingIds || []);
    if (!used.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  function sourcePath(sourceId, relativePath) {
    const id = encodeURIComponent(String(sourceId || '').trim());
    if (!id) return normalizeRelativePath(relativePath);
    const relative = normalizeRelativePath(relativePath);
    return [SOURCE_PREFIX, id, relative].filter(Boolean).join('/');
  }

  function parseSourcePath(path) {
    const normalized = normalizeRelativePath(path);
    const parts = normalized.split('/').filter(Boolean);
    if (parts[0] !== SOURCE_PREFIX || !parts[1]) return null;
    let sourceId = '';
    try { sourceId = decodeURIComponent(parts[1]); } catch { sourceId = parts[1]; }
    return {
      sourceId,
      relativePath: parts.slice(2).join('/'),
      virtualPath: sourcePath(sourceId, parts.slice(2).join('/')),
    };
  }

  function _now() {
    return new Date().toISOString();
  }

  function _isRegistryNotFoundError(err) {
    return /not_found|path\/not_found/i.test(err?.message || '');
  }

  function _isRegistryWriteConflictError(err) {
    return /conflict|path\/conflict|too_many_write_operations/i.test(err?.message || '');
  }

  function _normalizeRoot(root, existingIds) {
    const provider = String(root?.provider || (root?.dropboxPath ? 'dropbox' : '')).trim();
    if (provider !== 'dropbox') return null;
    const dropboxPath = normalizeDropboxPath(root?.dropboxPath || root?.path || '');
    if (!dropboxPath) return null;
    const namespaceKind = normalizeNamespaceKind(root?.namespaceKind);
    const id = String(root?.id || root?.sourceId || sourceIdForDropboxPath(dropboxPath, existingIds, namespaceKind)).trim();
    const timestamp = _now();
    return {
      id,
      sourceId: id,
      provider: 'dropbox',
      namespaceKind,
      dropboxPath,
      path: sourcePath(id, ''),
      name: String(root?.name || _basename(dropboxPath) || dropboxPath).trim(),
      visible: root?.visible !== false,
      createdAt: root?.createdAt || timestamp,
      updatedAt: root?.updatedAt || timestamp,
      deleted: root?.deleted === true,
      deletedAt: root?.deletedAt || '',
    };
  }

  function normalizeRegistryPayload(payload) {
    const timestamp = _now();
    const usedIds = new Set();
    const roots = [];
    for (const raw of Array.isArray(payload?.roots) ? payload.roots : []) {
      const root = _normalizeRoot(raw, usedIds);
      if (!root) continue;
      usedIds.add(root.id);
      roots.push(root);
    }
    return {
      version: 1,
      updatedAt: payload?.updatedAt || timestamp,
      roots,
    };
  }

  function toOutlinerRoot(root) {
    const normalized = _normalizeRoot(root, new Set());
    if (!normalized) return null;
    return {
      id: normalized.id,
      sourceId: normalized.id,
      provider: 'dropbox',
      namespaceKind: normalized.namespaceKind,
      dropboxPath: normalized.dropboxPath,
      path: sourcePath(normalized.id, ''),
      name: normalized.name,
      visible: normalized.visible,
      deleted: normalized.deleted,
    };
  }

  function _registryFromCache() {
    return normalizeRegistryPayload(_readJson(CACHE_KEY, null) || {});
  }

  async function _rpc(route, body, namespaceKind) {
    const auth = _auth();
    if (!auth?.apiRpc) throw new Error('Dropboxへ接続してください');
    return auth.apiRpc(route, body, {
      namespaceKind: normalizeNamespaceKind(namespaceKind),
    });
  }

  async function _content(route, arg, init, namespaceKind) {
    const auth = _auth();
    if (!auth?.apiContent) throw new Error('Dropboxへ接続してください');
    return auth.apiContent(route, arg, init, {
      namespaceKind: normalizeNamespaceKind(namespaceKind),
    });
  }

  async function _ensureFolder(dropboxPath) {
    const normalized = normalizeDropboxPath(dropboxPath);
    if (!normalized || normalized === '/') return true;
    try {
      await _rpc('files/create_folder_v2', { path: normalized, autorename: false });
      return true;
    } catch (err) {
      let meta = null;
      try {
        meta = await _rpc('files/get_metadata', {
          path: normalized,
          include_deleted: false,
          include_has_explicit_shared_members: false,
        });
      } catch {}
      if (meta?.['.tag'] === 'folder') return true;
      if (meta) throw new Error(normalized + ' はDropbox上でフォルダではありません');
      throw err;
    }
  }

  async function ensureRegistryFolders() {
    const settingsRoot = getSettingsPath();
    await _ensureFolder(settingsRoot);
    await _ensureFolder(joinDropboxPath(settingsRoot, '_meldex'));
    return true;
  }

  function _rootMergeKey(root) {
    const normalized = _normalizeRoot(root, new Set());
    if (!normalized) return '';
    return JSON.stringify({
      id: normalized.id,
      namespaceKind: normalized.namespaceKind,
      dropboxPath: normalized.dropboxPath,
      name: normalized.name,
      visible: normalized.visible,
      deleted: normalized.deleted,
    });
  }

  function _mergeRegistryForWrite(incomingRegistry, remoteRegistry, baseRegistry) {
    const incoming = normalizeRegistryPayload(incomingRegistry || {});
    const remote = normalizeRegistryPayload(remoteRegistry || {});
    const base = baseRegistry ? normalizeRegistryPayload(baseRegistry) : null;
    const rootsById = new Map();
    const baseById = new Map();
    const touchedIds = new Set(incoming.roots.map(root => root.id));
    const timestamp = _now();

    if (base) base.roots.forEach(root => baseById.set(root.id, root));
    remote.roots.forEach(root => rootsById.set(root.id, root));

    if (base) {
      base.roots.forEach((root) => {
        if (touchedIds.has(root.id)) return;
        const current = rootsById.get(root.id) || root;
        rootsById.set(root.id, {
          ...current,
          visible: false,
          deleted: true,
          deletedAt: current.deletedAt || timestamp,
          updatedAt: timestamp,
        });
      });
    }

    incoming.roots.forEach((root) => {
      const baseRoot = baseById.get(root.id);
      const remoteRoot = rootsById.get(root.id);
      if (baseRoot && remoteRoot && _rootMergeKey(root) === _rootMergeKey(baseRoot)) return;
      rootsById.set(root.id, root);
    });
    return normalizeRegistryPayload({
      ...remote,
      ...incoming,
      roots: Array.from(rootsById.values()),
    });
  }

  async function _readRemoteRegistryWithMetadata(namespaceKind) {
    const response = await _content(
      'files/download',
      { path: registryDropboxPath() },
      undefined,
      namespaceKind,
    );
    const text = await response.text();
    let rev = '';
    try {
      const metadataText = response.headers?.get?.('dropbox-api-result') || '';
      const metadata = metadataText ? JSON.parse(metadataText) : null;
      rev = String(metadata?.rev || '');
    } catch {}
    return {
      registry: normalizeRegistryPayload(JSON.parse(text)),
      rev,
    };
  }

  async function _readRemoteRegistry() {
    const remote = await _readRemoteRegistryWithMetadata('home');
    return remote.registry;
  }

  async function _readRemoteRegistryForWrite() {
    try {
      return await _readRemoteRegistryWithMetadata('home');
    } catch (err) {
      if (_isRegistryNotFoundError(err)) return null;
      throw err;
    }
  }

  async function writeRegistry(registry, options = {}) {
    const incoming = normalizeRegistryPayload(registry || {});
    await ensureRegistryFolders();
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remote = options.mergeRemote === false ? null : await _readRemoteRegistryForWrite();
      const normalized = remote
        ? _mergeRegistryForWrite(incoming, remote.registry, options.baseRegistry)
        : normalizeRegistryPayload(incoming);
      normalized.updatedAt = _now();
      const bytes = new TextEncoder().encode(JSON.stringify(normalized, null, 2));
      try {
        await _content('files/upload', {
          path: registryDropboxPath(),
          mode: remote?.rev ? { '.tag': 'update', update: remote.rev } : { '.tag': 'overwrite' },
          autorename: false,
          mute: false,
          strict_conflict: true,
        }, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
        });
        _lastRegistry = normalized;
        _writeJson(CACHE_KEY, normalized);
        return normalized;
      } catch (err) {
        lastError = err;
        if (attempt === 0 && options.mergeRemote !== false && _isRegistryWriteConflictError(err)) continue;
        throw err;
      }
    }
    throw lastError;
  }

  function _legacyRoots() {
    const oldRoots = _readJson(OLD_PWA_ROOTS_KEY, []);
    const vaultPath = normalizeDropboxPath(_auth()?.getVaultPath?.() || '/MeldexVault') || '/MeldexVault';
    const vaultNamespaceKind = normalizeNamespaceKind(_auth()?.getVaultNamespaceKind?.());
    const candidates = [];
    if (Array.isArray(oldRoots)) {
      oldRoots.forEach((root) => {
        if (!root?.path) return;
        const raw = String(root.path);
        if (raw === '.' || raw === '') {
          candidates.push({ dropboxPath: vaultPath, namespaceKind: vaultNamespaceKind, name: root.name || _basename(vaultPath), visible: root.visible !== false });
        } else if (raw.startsWith('/')) {
          candidates.push({ dropboxPath: raw, namespaceKind: vaultNamespaceKind, name: root.name || _basename(raw), visible: root.visible !== false });
        } else {
          candidates.push({ dropboxPath: joinDropboxPath(vaultPath, raw), namespaceKind: vaultNamespaceKind, name: root.name || _basename(raw), visible: root.visible !== false });
        }
      });
    }
    if (!candidates.length) {
      candidates.push({
        dropboxPath: vaultPath,
        namespaceKind: vaultNamespaceKind,
        name: _basename(vaultPath) || 'Meldex',
        visible: true,
      });
    }
    const usedIds = new Set();
    return candidates.map((candidate) => {
      const root = _normalizeRoot(candidate, usedIds);
      if (root) usedIds.add(root.id);
      return root;
    }).filter(Boolean);
  }

  async function loadRegistry(options) {
    try {
      const remote = await _readRemoteRegistry();
      if (remote.roots.length) {
        _lastRegistry = remote;
        _writeJson(CACHE_KEY, remote);
        return remote;
      }
      const migrated = await _migrateLegacyTeamRegistry();
      if (migrated) return migrated;
      const seeded = normalizeRegistryPayload({ roots: _legacyRoots() });
      if (options?.writeIfMissing !== false) return await writeRegistry(seeded);
      return seeded;
    } catch (err) {
      if (_isRegistryNotFoundError(err)) {
        const migrated = await _migrateLegacyTeamRegistry();
        if (migrated) return migrated;
        const seeded = normalizeRegistryPayload({ roots: _legacyRoots() });
        if (options?.writeIfMissing !== false) {
          try { return await writeRegistry(seeded); } catch {}
        }
        _lastRegistry = seeded;
        _writeJson(CACHE_KEY, seeded);
        return seeded;
      }
      const cached = _registryFromCache();
      if (cached.roots.length) {
        _lastRegistry = cached;
        return cached;
      }
      throw err;
    }
  }

  async function _migrateLegacyTeamRegistry() {
    let context = null;
    try {
      context = await _auth()?.getNamespaceContext?.(false);
    } catch {}
    if (!context?.isTeam) return null;
    let legacy = null;
    try {
      legacy = await _readRemoteRegistryWithMetadata('team_root');
    } catch (err) {
      if (_isRegistryNotFoundError(err)) return null;
      throw err;
    }
    if (!legacy?.registry?.roots?.length) return null;
    const migrated = await writeRegistry(legacy.registry, { mergeRemote: false });
    _dispatchRegistryMigration(migrated);
    return migrated;
  }

  function _dispatchRegistryMigration(registry) {
    try {
      window.dispatchEvent(new CustomEvent('meldex:dropbox-registry-migrated', {
        detail: { from: 'team_root', to: 'home', rootCount: registry.roots.length },
      }));
    } catch {}
  }

  async function ensureDefaultRoots() {
    const registry = await loadRegistry({ writeIfMissing: true });
    return registry.roots;
  }

  // フェーズ3c: アカウント台帳 + 参加中ワークスペースのフォルダ内台帳を
  // MeldexWorkspaceSharedLedger.mergeSourceRoots() で統合し、フロント向け
  // outliner root 形式へ変換する。
  //
  // 最重要の安全要件: アカウント由来（origin==='account'）の要素は、従来の
  // toOutlinerRoot() と完全に同じ7キー構成で返す。これにより参加中
  // ワークスペースが0件のユーザーは、この変更の前後で戻り値が完全に同一
  // になる（回帰防止の最優先要件）。
  async function loadOutlinerRoots() {
    const registry = await loadRegistry({ writeIfMissing: true });

    const joined = window.MeldexWorkspaceLedgerIO?.listJoinedWorkspaces?.() || [];
    const workspacesForMerge = [];
    for (const ws of joined) {
      if (!ws?.id || !ws?.dropboxPath) continue;
      let wsRoots = [];
      try {
        wsRoots = await window.MeldexWorkspaceLedgerIO.readWorkspaceLedger(ws.dropboxPath, ws.namespaceKind);
      } catch (err) {
        // 1つのワークスペースの読み込み失敗が、フォルダツリー全体の読み込みを
        // 止めてはならない（best-effort。他のアカウント/ワークスペースは正常に出す）。
        console.warn('[MeldexSourceFolderRegistry] ワークスペース台帳の読み込みに失敗:', ws.dropboxPath, err);
        continue;
      }
      workspacesForMerge.push({
        id: ws.id,
        dropboxPath: ws.dropboxPath,
        namespaceKind: normalizeNamespaceKind(ws.namespaceKind),
        roots: wsRoots,
      });
    }

    const merged = window.MeldexWorkspaceSharedLedger?.mergeSourceRoots
      ? window.MeldexWorkspaceSharedLedger.mergeSourceRoots(registry.roots, workspacesForMerge)
      : registry.roots.filter((root) => !root.deleted); // フォールバック: モジュール未読込時は従来どおり

    const workspaceRootsById = new Map();
    const outlinerRoots = [];
    for (const entry of merged) {
      const origin = String(entry?.origin || '');
      if (origin.startsWith('ws:')) {
        const dropboxPath = normalizeDropboxPath(entry.resolvedDropboxPath || '');
        const workspaceId = String(entry?.workspaceId || '').trim();
        if (!dropboxPath || !entry?.id || !workspaceId) continue;
        // フェーズ3c-hotfix: entry.id（wsrc:...）はワークスペードの
        // フォルダ内台帳ごとに独立採番される（parseWsLedger内でワークス
        // ペード単位に新規生成）ため、2つの異なる参加ワークスペードが
        // 同名フォルダ（例: 両方とも relPath:"第1話"）を持つと entry.id が
        // 衝突する。ここで workspaceId を名前空間として付与し、
        // ws:<workspaceId>:<entry.id> の形で最終idを一意化する
        // （デスクトップ側 meldex_workspace_service.py の
        // _normalize_joined_workspace_source_root と同一方式）。
        // これにより悪意ある entry.id によるアカウントroot（dropbox:xxx）への
        // なりすましも、workspaceIdプレフィックスがある限り構造的に不可能になる。
        const namespacedId = `ws:${workspaceId}:${entry.id}`;
        outlinerRoots.push({
          id: namespacedId,
          sourceId: namespacedId,
          provider: 'dropbox',
          namespaceKind: normalizeNamespaceKind(entry.namespaceKind),
          dropboxPath,
          path: sourcePath(namespacedId, ''),
          name: entry.name,
          visible: entry.visible,
          deleted: false, // mergeSourceRootsは既にdeleted除外済み
          origin: entry.origin,
          workspaceId: entry.workspaceId,
        });
        workspaceRootsById.set(namespacedId, {
          dropboxPath,
          namespaceKind: normalizeNamespaceKind(entry.namespaceKind),
        });
      } else {
        const outlinerRoot = toOutlinerRoot(entry);
        if (outlinerRoot) outlinerRoots.push(outlinerRoot);
      }
    }
    _lastWorkspaceRootsById = workspaceRootsById;
    return outlinerRoots;
  }

  async function saveOutlinerRoots(roots) {
    const source = Array.isArray(roots) ? roots : [];
    const existing = await loadRegistry({ writeIfMissing: false }).catch(() => _registryFromCache());
    const usedIds = new Set(existing.roots.map((root) => root.id));
    const nextRoots = [];
    for (const root of source) {
      // ワークスペース由来（フェーズ3c合流分）はアカウント台帳へ書き戻さない。
      // 設定画面がGETしたワークスペース由来の項目を表示切替等でPUTし返した際、
      // _normalizeRootが仮想パスをdropboxPathとして誤解釈しアカウント台帳
      // (source-folders.v1.json)を破壊する事故を防ぐ。
      if (typeof root?.origin === 'string' && root.origin.startsWith('ws:')) continue;
      if (root?.provider !== 'dropbox' && !root?.dropboxPath) continue;
      const normalized = _normalizeRoot(root, usedIds);
      if (!normalized) continue;
      usedIds.add(normalized.id);
      nextRoots.push(normalized);
    }
    return writeRegistry({ ...existing, roots: nextRoots }, { baseRegistry: existing });
  }

  async function addDropboxRoot(dropboxPath, name, options) {
    const normalizedPath = normalizeDropboxPath(dropboxPath);
    if (!normalizedPath) throw new Error('Dropbox内フォルダを選択してください');
    const namespaceKind = normalizeNamespaceKind(options?.namespaceKind);
    const registry = await loadRegistry({ writeIfMissing: true });
    const existing = registry.roots.find((root) => (
      normalizeNamespaceKind(root.namespaceKind) === namespaceKind
      && normalizeDropboxPath(root.dropboxPath).toLowerCase() === normalizedPath.toLowerCase()
      && !root.deleted
    ));
    if (existing) return toOutlinerRoot(existing);
    const usedIds = new Set(registry.roots.map((root) => root.id));
    const root = _normalizeRoot({ dropboxPath: normalizedPath, name, namespaceKind }, usedIds);
    const next = { ...registry, roots: [...registry.roots, root] };
    await writeRegistry(next, { baseRegistry: registry });
    return toOutlinerRoot(root);
  }

  function _findRoot(sourceId) {
    const registry = _lastRegistry || _registryFromCache();
    const accountRoot = registry.roots.find((root) => root.id === sourceId && !root.deleted) || null;
    if (accountRoot) return accountRoot;
    // アカウント台帳に無ければ、直近の loadOutlinerRoots() が合流させた
    // ワークスペース由来ルートを見る（フェーズ3c）。
    const wsRoot = _lastWorkspaceRootsById?.get?.(sourceId);
    if (wsRoot?.dropboxPath) {
      return {
        id: sourceId,
        sourceId,
        provider: 'dropbox',
        namespaceKind: normalizeNamespaceKind(wsRoot.namespaceKind),
        dropboxPath: wsRoot.dropboxPath,
      };
    }
    return null;
  }

  function resolveDropboxLocation(path, fallbackVaultPath) {
    const parsed = parseSourcePath(path);
    if (!parsed) {
      const fallback = normalizeDropboxPath(fallbackVaultPath || _auth()?.getVaultPath?.() || '');
      if (!fallback) throw new Error('Dropboxの保存先フォルダが未設定です');
      const relative = normalizeRelativePath(path);
      return {
        path: relative ? joinDropboxPath(fallback, relative) : fallback,
        namespaceKind: normalizeNamespaceKind(_auth()?.getVaultNamespaceKind?.()),
      };
    }
    const root = _findRoot(parsed.sourceId);
    if (!root) throw new Error('ソースフォルダ設定が見つかりません。フォルダツリーを更新してください。');
    return {
      path: parsed.relativePath ? joinDropboxPath(root.dropboxPath, parsed.relativePath) : normalizeDropboxPath(root.dropboxPath),
      namespaceKind: normalizeNamespaceKind(root.namespaceKind),
    };
  }

  function resolveDropboxPath(path, fallbackVaultPath) {
    return resolveDropboxLocation(path, fallbackVaultPath).path;
  }

  function virtualPathFromDropboxPath(dropboxPath, sourceId) {
    const normalized = normalizeDropboxPath(dropboxPath);
    const registry = _lastRegistry || _registryFromCache();
    const roots = registry.roots.filter((root) => !root.deleted);
    // フェーズ3c: 直近の loadOutlinerRoots() が合流させたワークスペース由来
    // ルートも逆引き候補に含める（_findRoot と対称に対応させる）。
    if (_lastWorkspaceRootsById) {
      for (const [id, info] of _lastWorkspaceRootsById.entries()) {
        if (info?.dropboxPath) {
          roots.push({
            id,
            dropboxPath: info.dropboxPath,
            namespaceKind: normalizeNamespaceKind(info.namespaceKind),
          });
        }
      }
    }
    const candidates = (sourceId ? roots.filter((root) => root.id === sourceId) : roots)
      .sort((left, right) => normalizeDropboxPath(right.dropboxPath).length - normalizeDropboxPath(left.dropboxPath).length);
    for (const root of candidates) {
      const base = normalizeDropboxPath(root.dropboxPath);
      const lower = normalized.toLowerCase();
      const baseLower = base.toLowerCase();
      if (lower === baseLower) return sourcePath(root.id, '');
      if (base === '/') return sourcePath(root.id, normalized.replace(/^\/+/, ''));
      if (lower.startsWith(baseLower + '/')) return sourcePath(root.id, normalized.slice(base.length + 1));
    }
    return normalizeRelativePath(normalized);
  }

  window.MeldexSourceFolderRegistry = {
    SETTINGS_PATH_KEY,
    DEFAULT_SETTINGS_PATH,
    REGISTRY_RELATIVE_PATH,
    SOURCE_PREFIX,
    CACHE_KEY,
    getSettingsPath,
    setSettingsPath,
    registryDropboxPath,
    normalizeDropboxPath,
    normalizeRelativePath,
    normalizeNamespaceKind,
    sourceIdForDropboxPath,
    sourcePath,
    parseSourcePath,
    toOutlinerRoot,
    normalizeRegistryPayload,
    ensureRegistryFolders,
    loadRegistry,
    writeRegistry,
    ensureDefaultRoots,
    loadOutlinerRoots,
    saveOutlinerRoots,
    addDropboxRoot,
    resolveDropboxLocation,
    resolveDropboxPath,
    virtualPathFromDropboxPath,
  };
})();
