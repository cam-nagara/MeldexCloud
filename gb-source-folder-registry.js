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
    const normalized = String(path || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/\/$/, '');
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

  function joinDropboxPath() {
    const parts = Array.from(arguments);
    const first = normalizeDropboxPath(parts.shift() || '');
    const rest = parts.map(normalizeRelativePath).filter(Boolean).join('/');
    return rest ? `${first}/${rest}` : first;
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

  function sourceIdForDropboxPath(dropboxPath, existingIds) {
    const base = `dropbox:${_slug(normalizeDropboxPath(dropboxPath))}`;
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

  function _normalizeRoot(root, existingIds) {
    const provider = String(root?.provider || (root?.dropboxPath ? 'dropbox' : '')).trim();
    if (provider !== 'dropbox') return null;
    const dropboxPath = normalizeDropboxPath(root?.dropboxPath || root?.path || '');
    if (!dropboxPath) return null;
    const id = String(root?.id || root?.sourceId || sourceIdForDropboxPath(dropboxPath, existingIds)).trim();
    const timestamp = _now();
    return {
      id,
      sourceId: id,
      provider: 'dropbox',
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

  async function _rpc(route, body) {
    const auth = _auth();
    if (!auth?.apiRpc) throw new Error('Dropboxへ接続してください');
    return auth.apiRpc(route, body);
  }

  async function _content(route, arg, init) {
    const auth = _auth();
    if (!auth?.apiContent) throw new Error('Dropboxへ接続してください');
    return auth.apiContent(route, arg, init);
  }

  async function _ensureFolder(dropboxPath) {
    const normalized = normalizeDropboxPath(dropboxPath);
    if (!normalized || normalized === '/') return true;
    try {
      await _rpc('files/create_folder_v2', { path: normalized, autorename: false });
      return true;
    } catch (err) {
      try {
        const meta = await _rpc('files/get_metadata', {
          path: normalized,
          include_deleted: false,
          include_has_explicit_shared_members: false,
        });
        if (meta?.['.tag'] === 'folder') return true;
      } catch {}
      if (/conflict|folder/i.test(err?.message || '')) return true;
      throw err;
    }
  }

  async function ensureRegistryFolders() {
    const settingsRoot = getSettingsPath();
    await _ensureFolder(settingsRoot);
    await _ensureFolder(joinDropboxPath(settingsRoot, '_meldex'));
    return true;
  }

  async function _readRemoteRegistry() {
    const response = await _content('files/download', { path: registryDropboxPath() });
    const text = await response.text();
    return normalizeRegistryPayload(JSON.parse(text));
  }

  async function writeRegistry(registry) {
    const normalized = normalizeRegistryPayload(registry || {});
    normalized.updatedAt = _now();
    await ensureRegistryFolders();
    const bytes = new TextEncoder().encode(JSON.stringify(normalized, null, 2));
    await _content('files/upload', {
      path: registryDropboxPath(),
      mode: { '.tag': 'overwrite' },
      autorename: false,
      mute: false,
      strict_conflict: false,
    }, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    _lastRegistry = normalized;
    _writeJson(CACHE_KEY, normalized);
    return normalized;
  }

  function _legacyRoots() {
    const oldRoots = _readJson(OLD_PWA_ROOTS_KEY, []);
    const vaultPath = normalizeDropboxPath(_auth()?.getVaultPath?.() || '/MeldexVault') || '/MeldexVault';
    const candidates = [];
    if (Array.isArray(oldRoots)) {
      oldRoots.forEach((root) => {
        if (!root?.path) return;
        const raw = String(root.path);
        if (raw === '.' || raw === '') {
          candidates.push({ dropboxPath: vaultPath, name: root.name || _basename(vaultPath), visible: root.visible !== false });
        } else if (raw.startsWith('/')) {
          candidates.push({ dropboxPath: raw, name: root.name || _basename(raw), visible: root.visible !== false });
        } else {
          candidates.push({ dropboxPath: joinDropboxPath(vaultPath, raw), name: root.name || _basename(raw), visible: root.visible !== false });
        }
      });
    }
    if (!candidates.length) candidates.push({ dropboxPath: vaultPath, name: _basename(vaultPath) || 'Meldex', visible: true });
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
      const seeded = normalizeRegistryPayload({ roots: _legacyRoots() });
      if (options?.writeIfMissing !== false) return await writeRegistry(seeded);
      return seeded;
    } catch (err) {
      if (/not_found|path\/not_found/i.test(err?.message || '')) {
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

  async function ensureDefaultRoots() {
    const registry = await loadRegistry({ writeIfMissing: true });
    return registry.roots;
  }

  async function loadOutlinerRoots() {
    const registry = await loadRegistry({ writeIfMissing: true });
    return registry.roots
      .filter((root) => !root.deleted)
      .map(toOutlinerRoot)
      .filter(Boolean);
  }

  async function saveOutlinerRoots(roots) {
    const source = Array.isArray(roots) ? roots : [];
    const existing = await loadRegistry({ writeIfMissing: false }).catch(() => _registryFromCache());
    const usedIds = new Set(existing.roots.map((root) => root.id));
    const nextRoots = [];
    for (const root of source) {
      if (root?.provider !== 'dropbox' && !root?.dropboxPath) continue;
      const normalized = _normalizeRoot(root, usedIds);
      if (!normalized) continue;
      usedIds.add(normalized.id);
      nextRoots.push(normalized);
    }
    return writeRegistry({ ...existing, roots: nextRoots });
  }

  async function addDropboxRoot(dropboxPath, name) {
    const normalizedPath = normalizeDropboxPath(dropboxPath);
    if (!normalizedPath) throw new Error('Dropbox内フォルダを選択してください');
    const registry = await loadRegistry({ writeIfMissing: true });
    const existing = registry.roots.find((root) => normalizeDropboxPath(root.dropboxPath).toLowerCase() === normalizedPath.toLowerCase() && !root.deleted);
    if (existing) return toOutlinerRoot(existing);
    const usedIds = new Set(registry.roots.map((root) => root.id));
    const root = _normalizeRoot({ dropboxPath: normalizedPath, name }, usedIds);
    const next = { ...registry, roots: [...registry.roots, root] };
    await writeRegistry(next);
    return toOutlinerRoot(root);
  }

  function _findRoot(sourceId) {
    const registry = _lastRegistry || _registryFromCache();
    return registry.roots.find((root) => root.id === sourceId && !root.deleted) || null;
  }

  function resolveDropboxPath(path, fallbackVaultPath) {
    const parsed = parseSourcePath(path);
    if (!parsed) {
      const fallback = normalizeDropboxPath(fallbackVaultPath || _auth()?.getVaultPath?.() || '');
      if (!fallback) throw new Error('Dropboxの保存先フォルダが未設定です');
      const relative = normalizeRelativePath(path);
      return relative ? joinDropboxPath(fallback, relative) : fallback;
    }
    const root = _findRoot(parsed.sourceId);
    if (!root) throw new Error('ソースフォルダ設定が見つかりません。フォルダツリーを更新してください。');
    return parsed.relativePath ? joinDropboxPath(root.dropboxPath, parsed.relativePath) : normalizeDropboxPath(root.dropboxPath);
  }

  function virtualPathFromDropboxPath(dropboxPath, sourceId) {
    const normalized = normalizeDropboxPath(dropboxPath);
    const registry = _lastRegistry || _registryFromCache();
    const roots = registry.roots.filter((root) => !root.deleted);
    const candidates = sourceId ? roots.filter((root) => root.id === sourceId) : roots;
    for (const root of candidates) {
      const base = normalizeDropboxPath(root.dropboxPath);
      const lower = normalized.toLowerCase();
      const baseLower = base.toLowerCase();
      if (lower === baseLower) return sourcePath(root.id, '');
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
    resolveDropboxPath,
    virtualPathFromDropboxPath,
  };
})();
