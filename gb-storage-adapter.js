(function () {
  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _auth() {
    return window.MeldexDropboxAuth;
  }

  function _resource() {
    return window.MeldexResourceUrl;
  }

  function _sourceRegistry() {
    return window.MeldexSourceFolderRegistry;
  }

  function _normalizeRelativePath(path) {
    return String(path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
  }

  function _joinPath() {
    return Array.from(arguments)
      .map((part) => _normalizeRelativePath(part))
      .filter(Boolean)
      .join('/');
  }

  function _basename(path) {
    const normalized = _normalizeRelativePath(path);
    if (!normalized) return '';
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(index + 1) : normalized;
  }

  function _dirname(path) {
    const normalized = _normalizeRelativePath(path);
    if (!normalized.includes('/')) return '';
    return normalized.slice(0, normalized.lastIndexOf('/'));
  }

  function _mimeFromPath(path) {
    const ext = _basename(path).split('.').pop().toLowerCase();
    return {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bmp: 'image/bmp',
      avif: 'image/avif',
      ico: 'image/x-icon',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      pdf: 'application/pdf',
      html: 'text/html',
      htm: 'text/html',
      md: 'text/markdown',
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      js: 'text/javascript',
      css: 'text/css',
    }[ext] || 'application/octet-stream';
  }

  function _jsonDate(value) {
    const time = Date.parse(String(value || ''));
    return Number.isFinite(time) ? time : Date.now();
  }

  function _safeJsonParse(text, fallbackValue) {
    try {
      return JSON.parse(String(text || ''));
    } catch {
      return fallbackValue;
    }
  }

  function _accountId(account) {
    return String(account?.account_id || account?.accountId || '').trim();
  }

  function _accountName(account) {
    return String(account?.name?.display_name || account?.email || account?.account_id || '').trim();
  }

  function _allocatedBytes(spaceUsage) {
    const allocation = spaceUsage?.allocation || {};
    const candidates = [
      allocation.allocated,
      allocation.user_within_team_space_allocated,
      allocation.team_space_allocated,
    ];
    for (const value of candidates) {
      const numeric = Number(value || 0);
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
    return 0;
  }

  function _spaceUsageSnapshot(spaceUsage, account, vaultMeta) {
    const used = Number(spaceUsage?.used || 0);
    const allocated = _allocatedBytes(spaceUsage);
    const ratio = allocated > 0 ? used / allocated : 0;
    return {
      ok: true,
      kind: 'meldex-space-usage',
      ownerId: String(vaultMeta?.ownerId || _accountId(account) || ''),
      ownerName: String(vaultMeta?.ownerName || _accountName(account) || ''),
      accountId: _accountId(account),
      accountName: _accountName(account),
      used,
      allocated,
      ratio,
      allocationTag: String(spaceUsage?.allocation?.['.tag'] || ''),
      rawAllocation: spaceUsage?.allocation || null,
      updatedAt: new Date().toISOString(),
      source: 'owner-live',
    };
  }

  function _isStaleIso(value, maxAgeMs) {
    const time = Date.parse(String(value || ''));
    return !Number.isFinite(time) || (Date.now() - time) > maxAgeMs;
  }

  function _isDropboxConflictError(err) {
    return /conflict|too_many_write_operations|path\/conflict/i.test(err?.message || '');
  }

  function _conflictedCopyPath(relativePath) {
    const normalized = _normalizeRelativePath(relativePath);
    const dir = _dirname(normalized);
    const name = _basename(normalized);
    const dotIndex = name.lastIndexOf('.');
    const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
    const ext = dotIndex > 0 ? name.slice(dotIndex) : '';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    return _joinPath(dir, `${stem} (conflicted copy ${stamp})${ext}`);
  }

  function _appendStemSuffix(relativePath, suffix) {
    const normalized = _normalizeRelativePath(relativePath);
    const dir = _dirname(normalized);
    const name = _basename(normalized);
    const dotIndex = name.lastIndexOf('.');
    const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
    const ext = dotIndex > 0 ? name.slice(dotIndex) : '';
    return _joinPath(dir, `${stem}${suffix}${ext}`);
  }

  function _normalizeHandleOptions(options) {
    if (typeof options === 'boolean') return { create: options };
    return options || {};
  }

  function _apiUrl(path, query) {
    if (_resource()?.apiUrl) return _resource().apiUrl(path, query);
    const relative = '/api' + (String(path || '').startsWith('/') ? String(path || '') : ('/' + String(path || '')));
    const url = new URL(relative, document.baseURI || window.location.href);
    if (query && typeof query === 'object') {
      Object.entries(query).forEach(([key, value]) => {
        if (value == null || value === '') return;
        url.searchParams.set(key, String(value));
      });
    }
    return url.toString();
  }

  async function _responseError(response) {
    const fallback = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const text = await response.text();
      if (!text) return fallback;
      const parsed = _safeJsonParse(text, null);
      if (parsed && typeof parsed === 'object') {
        return parsed.detail || parsed.error || parsed.message || fallback;
      }
      return String(text || fallback);
    } catch {
      return fallback;
    }
  }

  async function _fetchJson(path, options) {
    const safeOptions = options || {};
    const requestInit = {
      method: safeOptions.method || 'GET',
      headers: { ...(safeOptions.headers || {}) },
    };
    if (safeOptions.body !== undefined) {
      requestInit.headers['Content-Type'] = 'application/json';
      requestInit.body = JSON.stringify(safeOptions.body);
    }
    const response = await fetch(_apiUrl(path, safeOptions.query), requestInit);
    const allowStatus = Array.isArray(safeOptions.allowStatus) ? safeOptions.allowStatus : [];
    if (allowStatus.includes(response.status)) return null;
    if (!response.ok) throw new Error(await _responseError(response));
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    return _safeJsonParse(text, text);
  }

  function _bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function _legacyRenameExt(name) {
    const safeName = String(name || '');
    const lower = safeName.toLowerCase();
    if (lower.endsWith('.scriptnote.json')) return '.scriptnote.json';
    if (lower.endsWith('.smart-db.json')) return '.smart-db.json';
    const firstDot = safeName.indexOf('.');
    if (firstDot <= 0) return '';
    return safeName.includes('.', firstDot + 1) ? safeName.slice(firstDot) : safeName.slice(safeName.lastIndexOf('.'));
  }

  function _createFile(bytes, name, options) {
    const safeOptions = options || {};
    if (typeof File === 'function') {
      return new File([bytes], name, safeOptions);
    }
    const blob = new Blob([bytes], { type: safeOptions.type || 'application/octet-stream' });
    blob.name = name;
    blob.lastModified = safeOptions.lastModified || Date.now();
    return blob;
  }

  async function _toUint8Array(data) {
    if (data == null) return new Uint8Array();
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
    return new TextEncoder().encode(String(data));
  }

  window.__MeldexStorageAdapterInternals = {
    _runtime,
    _resource,
    _normalizeRelativePath,
    _joinPath,
    _basename,
    _dirname,
    _mimeFromPath,
    _jsonDate,
    _normalizeHandleOptions,
    _apiUrl,
    _responseError,
    _fetchJson,
    _bytesToBase64,
    _legacyRenameExt,
    _createFile,
    _toUint8Array,
  };

  class DropboxWritable {
    constructor(provider, relativePath) {
      this.provider = provider;
      this.relativePath = relativePath;
      this.chunks = [];
    }

    async write(data) {
      this.chunks.push(await _toUint8Array(data));
    }

    async close() {
      const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const bytes = new Uint8Array(totalLength);
      let offset = 0;
      this.chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.length;
      });
      await this.provider.uploadBytes(this.relativePath, bytes);
    }
  }

  class DropboxFileHandle {
    constructor(provider, relativePath) {
      this.provider = provider;
      this.path = _normalizeRelativePath(relativePath);
      this.name = _basename(this.path);
      this.kind = 'file';
    }

    async getFile() {
      return this.provider.downloadAsFile(this.path);
    }

    async createWritable() {
      return new DropboxWritable(this.provider, this.path);
    }
  }

  class DropboxDirectoryHandle {
    constructor(provider, relativePath) {
      this.provider = provider;
      this.path = _normalizeRelativePath(relativePath);
      this.name = this.path ? _basename(this.path) : (provider.getVaultName() || 'vault');
      this.kind = 'directory';
    }

    async getDirectoryHandle(name, options) {
      const targetPath = _joinPath(this.path, name);
      if (options?.create) await this.provider.ensureDirectory(targetPath);
      else await this.provider.assertDirectory(targetPath);
      return new DropboxDirectoryHandle(this.provider, targetPath);
    }

    async getFileHandle(name, options) {
      const targetPath = _joinPath(this.path, name);
      if (!options?.create) await this.provider.assertFile(targetPath);
      return new DropboxFileHandle(this.provider, targetPath);
    }

    async *entries() {
      const entries = await this.provider.listEntries(this.path);
      for (const entry of entries) {
        if (entry.kind === 'directory') yield [entry.name, new DropboxDirectoryHandle(this.provider, entry.path)];
        else yield [entry.name, new DropboxFileHandle(this.provider, entry.path)];
      }
    }

    async removeEntry(name) {
      await this.provider.deletePath(_joinPath(this.path, name));
    }
  }

  class DropboxStorageProvider {
    constructor() {
      this.rootHandle = null;
      this._metaCache = new Map();
      this._recentConflictCopies = new Map();
    }

    static isSupported() {
      return true;
    }

    getVaultPath() {
      return _auth()?.getVaultPath?.() || '';
    }

    getVaultName() {
      const vaultPath = this.getVaultPath();
      return vaultPath ? vaultPath.split('/').filter(Boolean).pop() : '';
    }

    _dropboxPath(relativePath) {
      const registry = _sourceRegistry();
      if (registry?.resolveDropboxPath) return registry.resolveDropboxPath(relativePath, this.getVaultPath());
      const vaultPath = this.getVaultPath();
      if (!vaultPath) throw new Error('Dropboxの保存先フォルダが未設定です');
      const relative = _normalizeRelativePath(relativePath);
      return relative ? (vaultPath + '/' + relative) : vaultPath;
    }

    _relativeFromDropboxPath(pathDisplay, sourceId) {
      const registry = _sourceRegistry();
      if (registry?.virtualPathFromDropboxPath) return registry.virtualPathFromDropboxPath(pathDisplay, sourceId);
      const vaultPath = this.getVaultPath().toLowerCase();
      const raw = String(pathDisplay || '').replace(/\\/g, '/');
      const lower = raw.toLowerCase();
      if (lower === vaultPath) return '';
      if (lower.startsWith(vaultPath + '/')) return raw.slice(vaultPath.length + 1);
      return raw.replace(/^\/+/, '');
    }

    async _rpc(route, body) {
      return _auth().apiRpc(route, body);
    }

    async _content(route, arg, init) {
      return _auth().apiContent(route, arg, init);
    }

    _rememberMeta(relativePath, meta) {
      this._metaCache.set(_normalizeRelativePath(relativePath), meta || null);
    }

    _forgetMeta(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      this._metaCache.delete(normalized);
      const prefix = normalized ? (normalized + '/') : '';
      [...this._metaCache.keys()].forEach((key) => {
        if (prefix && key.startsWith(prefix)) this._metaCache.delete(key);
      });
    }

    async restoreWorkspace() {
      if (!_runtime()?.isDropboxMode?.()) return null;
      const appKey = _auth()?.getAppKey?.();
      const vaultPath = this.getVaultPath();
      const session = await _auth()?.getValidSession?.();
      if (!appKey || !vaultPath || !session?.accessToken) return null;
      this.rootHandle = new DropboxDirectoryHandle(this, '');
      return this.rootHandle;
    }

    async getDirectoryHandle(relativePath, options) {
      const handleOptions = _normalizeHandleOptions(options);
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) return this.restoreWorkspace();
      if (handleOptions.create) await this.ensureDirectory(normalized);
      else await this.assertDirectory(normalized);
      return new DropboxDirectoryHandle(this, normalized);
    }

    async getFileHandle(relativePath, options) {
      const handleOptions = _normalizeHandleOptions(options);
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) throw new Error('ファイルパスが不正です');
      if (!handleOptions.create) {
        await this.assertFile(normalized);
      } else {
        const parent = _dirname(normalized);
        if (parent) await this.ensureDirectory(parent);
      }
      return new DropboxFileHandle(this, normalized);
    }

    async clearWorkspace() {
      this.rootHandle = null;
      this._metaCache.clear();
      this._recentConflictCopies.clear();
    }

    async ensureWorkspacePermission(mode) {
      const workspace = await this.restoreWorkspace();
      if (!workspace) return false;
      const state = _runtime()?.getWorkspaceState?.() || {};
      if ((mode || 'readwrite') === 'readwrite' && document.body?.dataset?.cloudQuotaBlocked === '1') return false;
      if ((mode || 'readwrite') === 'readwrite' && state.access === 'viewer') return false;
      return true;
    }

    async getWorkspaceInfo() {
      const workspace = await this.restoreWorkspace();
      const state = _runtime()?.getWorkspaceState?.() || {};
      return {
        supported: true,
        connected: !!workspace,
        name: this.getVaultName(),
        path: this.getVaultPath(),
        permission: state.access === 'viewer' ? 'readonly' : 'readwrite',
      };
    }

    async readVaultMetadata() {
      const meta = await this.readJson('_meldex/vault.json', null);
      return meta && typeof meta === 'object' ? meta : null;
    }

    async writeVaultMetadata(metadata) {
      await this.ensureDirectory('_meldex');
      return this.writeJson('_meldex/vault.json', metadata || {});
    }

    async ensureVaultMetadataOwner(metadata, account) {
      const current = metadata && typeof metadata === 'object' ? { ...metadata } : {};
      const accountId = _accountId(account);
      let changed = false;
      if (!current.kind) {
        current.kind = 'meldex-vault';
        changed = true;
      }
      if (!current.vaultPath) {
        current.vaultPath = this.getVaultPath();
        changed = true;
      }
      if (!current.initializedAt) {
        current.initializedAt = new Date().toISOString();
        changed = true;
      }
      if (!current.ownerId && accountId) {
        current.ownerId = accountId;
        current.ownerName = _accountName(account);
        current.ownerEmail = String(account?.email || '');
        current.ownerInitializedAt = new Date().toISOString();
        changed = true;
      }
      if (!changed) return current;
      current.updatedAt = new Date().toISOString();
      await this.writeVaultMetadata(current);
      return current;
    }

    isCurrentAccountVaultOwner(metadata, account) {
      const ownerId = String(metadata?.ownerId || '').trim();
      const currentId = _accountId(account);
      return !!ownerId && !!currentId && ownerId === currentId;
    }

    async refreshSharedSpaceUsage() {
      const account = await _auth().getCurrentAccount(false).catch(() => null);
      const vaultMeta = await this.readVaultMetadata();
      const cached = await this.readJson('_meldex/space-usage.json', null);
      const state = _runtime()?.getWorkspaceState?.() || {};
      const isOwner = this.isCurrentAccountVaultOwner(vaultMeta, account);
      if (!isOwner || state.access === 'viewer') {
        if (cached && typeof cached === 'object') {
          return {
            ...cached,
            source: 'shared-cache',
            stale: _isStaleIso(cached.updatedAt, 24 * 60 * 60 * 1000),
            currentAccountId: _accountId(account),
            isOwner,
          };
        }
        return { ok: false, source: 'missing', message: '管理者端末の Dropbox 容量情報がまだ共有されていません', isOwner };
      }

      try {
        const rawUsage = await _auth().getSpaceUsage();
        const snapshot = {
          ..._spaceUsageSnapshot(rawUsage, account, vaultMeta),
          isOwner: true,
        };
        await this.writeJson('_meldex/space-usage.json', snapshot);
        return snapshot;
      } catch (err) {
        if (cached && typeof cached === 'object') {
          return {
            ...cached,
            source: 'shared-cache',
            stale: true,
            updateError: err?.message || String(err),
            isOwner: true,
          };
        }
        return { ok: false, source: 'error', error: err?.message || String(err), isOwner: true };
      }
    }

    async findMountedFolderByPath() {
      const expected = this.getVaultPath().toLowerCase();
      let cursor = null;
      do {
        const payload = cursor
          ? await this._rpc('sharing/list_folders/continue', { cursor })
          : await this._rpc('sharing/list_folders', { limit: 200 });
        const match = (payload.entries || []).find((entry) => String(entry.path_lower || '').toLowerCase() === expected);
        if (match) return match;
        cursor = payload.has_more ? payload.cursor : null;
      } while (cursor);
      return null;
    }

    async getMetadata(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      if (this._metaCache.has(normalized)) return this._metaCache.get(normalized);
      try {
        const payload = await this._rpc('files/get_metadata', {
          path: this._dropboxPath(normalized),
          include_deleted: false,
          include_has_explicit_shared_members: false,
        });
        this._rememberMeta(normalized, payload);
        return payload;
      } catch (err) {
        if (/not_found/i.test(err?.message || '')) {
          this._rememberMeta(normalized, null);
          return null;
        }
        throw err;
      }
    }

    async refreshMetadata(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      this._forgetMeta(normalized);
      return this.getMetadata(normalized);
    }

    async statPath(relativePath) {
      const meta = await this.getMetadata(relativePath);
      if (!meta) return null;
      const modified = meta.server_modified || meta.client_modified || '';
      return {
        kind: meta['.tag'] === 'folder' ? 'directory' : 'file',
        name: meta.name || _basename(relativePath),
        path: _normalizeRelativePath(relativePath),
        size: Number(meta.size || 0),
        modified,
        modifiedMs: _jsonDate(modified),
        meta,
      };
    }

    async assertDirectory(relativePath) {
      const stat = await this.statPath(relativePath);
      if (!stat || stat.kind !== 'directory') throw new Error(`フォルダが見つかりません: ${relativePath}`);
      return stat;
    }

    async assertFile(relativePath) {
      const stat = await this.statPath(relativePath);
      if (!stat || stat.kind !== 'file') throw new Error(`ファイルが見つかりません: ${relativePath}`);
      return stat;
    }

    async ensureDirectory(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) return new DropboxDirectoryHandle(this, '');
      const registry = _sourceRegistry();
      const parsedSource = registry?.parseSourcePath?.(normalized);
      const folderPath = parsedSource ? parsedSource.relativePath : normalized;
      if (parsedSource && !folderPath) return new DropboxDirectoryHandle(this, normalized);
      const segments = folderPath.split('/').filter(Boolean);
      let current = '';
      let currentSourceRelative = '';
      for (const segment of segments) {
        if (parsedSource) {
          currentSourceRelative = _joinPath(currentSourceRelative, segment);
          current = registry.sourcePath(parsedSource.sourceId, currentSourceRelative);
        } else {
          current = _joinPath(current, segment);
        }
        try {
          await this._rpc('files/create_folder_v2', {
            path: this._dropboxPath(current),
            autorename: false,
          });
        } catch (err) {
          this._forgetMeta(current);
          const existing = await this.statPath(current);
          if (!existing || existing.kind !== 'directory') throw err;
        }
        this._forgetMeta(current);
      }
      return new DropboxDirectoryHandle(this, normalized);
    }

    async ensureVaultRootDirectory() {
      const vaultPath = this.getVaultPath();
      if (!vaultPath) throw new Error('Dropboxの保存先フォルダが未設定です');
      try {
        await this._rpc('files/create_folder_v2', {
          path: vaultPath,
          autorename: false,
        });
      } catch (err) {
        this._forgetMeta('');
        const existing = await this.statPath('');
        if (!existing || existing.kind !== 'directory') throw err;
      }
      this._forgetMeta('');
      return this.getMetadata('');
    }

    async listEntries(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const sourceId = _sourceRegistry()?.parseSourcePath?.(normalized)?.sourceId || '';
      const entries = [];
      let payload = await this._rpc('files/list_folder', {
        path: this._dropboxPath(normalized),
        recursive: false,
        include_deleted: false,
        include_has_explicit_shared_members: false,
        include_mounted_folders: true,
      });
      while (true) {
        (payload.entries || []).forEach((entry) => {
          if (entry['.tag'] !== 'file' && entry['.tag'] !== 'folder') return;
          const rel = this._relativeFromDropboxPath(entry.path_display || entry.path_lower || '', sourceId);
          this._rememberMeta(rel, entry);
          entries.push({
            name: entry.name,
            path: rel,
            sourceId: sourceId || undefined,
            kind: entry['.tag'] === 'folder' ? 'directory' : 'file',
            size: Number(entry.size || 0),
            modified: entry.server_modified || entry.client_modified || '',
          });
        });
        if (!payload.has_more || !payload.cursor) break;
        payload = await this._rpc('files/list_folder/continue', { cursor: payload.cursor });
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'ja', { sensitivity: 'base' }));
      return entries;
    }

    async downloadAsFile(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const response = await this._content('files/download', { path: this._dropboxPath(normalized) });
      const resultHeader = response.headers.get('dropbox-api-result');
      const meta = _safeJsonParse(resultHeader, null) || {};
      this._rememberMeta(normalized, meta);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const modified = meta.server_modified || meta.client_modified || '';
      return _createFile(bytes, meta.name || _basename(normalized), {
        type: response.headers.get('content-type') || _mimeFromPath(normalized),
        lastModified: _jsonDate(modified),
      });
    }

    async getTemporaryLink(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const payload = await this._rpc('files/get_temporary_link', { path: this._dropboxPath(normalized) });
      return payload.link || '';
    }

    async readText(relativePath) {
      return (await this.downloadAsFile(relativePath)).text();
    }

    async readJson(relativePath, fallbackValue) {
      try {
        return JSON.parse(await this.readText(relativePath));
      } catch {
        return fallbackValue;
      }
    }

    async _uploadBytesWithMode(relativePath, bytes, mode) {
      const normalized = _normalizeRelativePath(relativePath);
      const response = await this._content('files/upload', {
        path: this._dropboxPath(normalized),
        mode,
        autorename: false,
        mute: false,
        strict_conflict: true,
      }, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      });
      const meta = await response.json();
      this._rememberMeta(normalized, meta);
      return meta;
    }

    async _writeConflictCopy(originalPath, bytes) {
      const recent = this._recentConflictCopies.get(originalPath);
      if (recent && Date.now() - recent.at < 30 * 60 * 1000) {
        const latestMeta = recent.meta?.rev ? recent.meta : await this.refreshMetadata(recent.path).catch(() => null);
        if (latestMeta?.rev) {
          try {
            const meta = await this._uploadBytesWithMode(recent.path, bytes, { '.tag': 'update', update: latestMeta.rev });
            this._recentConflictCopies.set(originalPath, { path: recent.path, meta, at: Date.now() });
            return { path: recent.path, meta, reused: true };
          } catch (err) {
            if (!_isDropboxConflictError(err)) throw err;
            const refreshedMeta = await this.refreshMetadata(recent.path).catch(() => null);
            if (refreshedMeta?.rev && refreshedMeta.rev !== latestMeta.rev) {
              const meta = await this._uploadBytesWithMode(recent.path, bytes, { '.tag': 'update', update: refreshedMeta.rev });
              this._recentConflictCopies.set(originalPath, { path: recent.path, meta, at: Date.now() });
              return { path: recent.path, meta, reused: true };
            }
          }
        }
      }
      const baseConflictPath = _conflictedCopyPath(originalPath);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const conflictPath = attempt === 0 ? baseConflictPath : _appendStemSuffix(baseConflictPath, `-${attempt}`);
        try {
          const meta = await this._uploadBytesWithMode(conflictPath, bytes, 'add');
          this._recentConflictCopies.set(originalPath, { path: conflictPath, meta, at: Date.now() });
          return { path: conflictPath, meta };
        } catch (err) {
          if (!_isDropboxConflictError(err) || attempt >= 4) throw err;
        }
      }
      throw new Error('Dropbox 競合コピーを作成できませんでした');
    }

    async uploadBytes(relativePath, bytes) {
      const normalized = _normalizeRelativePath(relativePath);
      const parent = _dirname(normalized);
      if (parent) await this.ensureDirectory(parent);
      const cachedMeta = this._metaCache.has(normalized) ? this._metaCache.get(normalized) : null;
      const mode = cachedMeta?.rev ? { '.tag': 'update', update: cachedMeta.rev } : 'add';
      try {
        const result = await this._uploadBytesWithMode(normalized, bytes, mode);
        this._recentConflictCopies.delete(normalized);
        return result;
      } catch (err) {
        if (!_isDropboxConflictError(err)) throw err;
        await this.refreshMetadata(normalized).catch(() => null);
        const conflict = await this._writeConflictCopy(normalized, bytes);
        throw new Error(`Dropbox 上で更新競合が発生したため、元ファイルは上書きせず競合コピーへ保存しました: ${conflict.path}`);
      }
    }

    async writeText(relativePath, content) {
      return this.uploadBytes(relativePath, new TextEncoder().encode(String(content ?? '')));
    }

    async writeJson(relativePath, data) {
      return this.writeText(relativePath, JSON.stringify(data, null, 2));
    }

    async deletePath(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      await this._rpc('files/delete_v2', { path: this._dropboxPath(normalized) });
      this._forgetMeta(normalized);
      return true;
    }

    async movePath(oldRelativePath, newRelativePath) {
      const source = _normalizeRelativePath(oldRelativePath);
      const target = _normalizeRelativePath(newRelativePath);
      const parent = _dirname(target);
      if (parent) await this.ensureDirectory(parent);
      const payload = await this._rpc('files/move_v2', {
        from_path: this._dropboxPath(source),
        to_path: this._dropboxPath(target),
        allow_shared_folder: true,
        autorename: false,
        allow_ownership_transfer: false,
      });
      this._forgetMeta(source);
      this._rememberMeta(target, payload.metadata || null);
      return payload;
    }

    async copyPath(oldRelativePath, newRelativePath) {
      const source = _normalizeRelativePath(oldRelativePath);
      const target = _normalizeRelativePath(newRelativePath);
      const parent = _dirname(target);
      if (parent) await this.ensureDirectory(parent);
      const payload = await this._rpc('files/copy_v2', {
        from_path: this._dropboxPath(source),
        to_path: this._dropboxPath(target),
        allow_shared_folder: true,
        autorename: false,
      });
      this._rememberMeta(target, payload.metadata || null);
      return payload;
    }

    async preflight() {
      this._metaCache.clear();
      const vaultPath = this.getVaultPath();
      if (!vaultPath) throw new Error('Dropboxの保存先フォルダが未設定です');
      const mountInfo = await this.findMountedFolderByPath();
      let rootMeta = await this.getMetadata('');
      if (!rootMeta) {
        try {
          rootMeta = await this.ensureVaultRootDirectory();
        } catch (err) {
          return {
            ok: false,
            mounted: false,
            access: 'none',
            message: `DropboxにMeldex用フォルダ（${vaultPath}）を作成できませんでした。Dropbox側の容量・権限・同名ファイルを確認してください。詳細: ${err?.message || String(err)}`,
          };
        }
      }
      if (!rootMeta || rootMeta['.tag'] !== 'folder') {
        return {
          ok: false,
          mounted: false,
          access: 'none',
          message: `Dropboxの${vaultPath}はフォルダではありません。同じ名前のファイルがある場合は名前を変更してください。`,
        };
      }
      const account = await _auth().getCurrentAccount(true);

      let metaFolder = await this.getMetadata('_meldex');
      if (!metaFolder || metaFolder['.tag'] !== 'folder') {
        try {
          await this.ensureDirectory('_meldex');
          await this.writeJson('_meldex/vault.json', {
            kind: 'meldex-vault',
            vaultPath,
            initializedAt: new Date().toISOString(),
            ownerId: _accountId(account),
            ownerName: _accountName(account),
            ownerEmail: String(account?.email || ''),
            ownerInitializedAt: new Date().toISOString(),
          });
          metaFolder = await this.getMetadata('_meldex');
        } catch (err) {
          return {
            ok: false,
            mounted: true,
            access: 'viewer',
            message: `共有フォルダ内の _meldex/ を作成できません。編集権限のあるメンバーで初期セットアップしてください。詳細: ${err?.message || String(err)}`,
            mountInfo,
            rootMeta,
          };
        }
      }
      let access = 'editor';
      let writeCheckPath = `_meldex/.preflight-${Date.now()}.json`;
      try {
        await this.writeJson(writeCheckPath, { ok: true, at: new Date().toISOString() });
        await this.deletePath(writeCheckPath);
      } catch (err) {
        access = 'viewer';
      }
      let vaultMeta = await this.readVaultMetadata();
      if (access === 'editor') {
        try {
          vaultMeta = await this.ensureVaultMetadataOwner(vaultMeta, account);
        } catch {}
      }
      let sourceRegistry = null;
      try {
        sourceRegistry = await _sourceRegistry()?.loadRegistry?.({ writeIfMissing: access === 'editor' });
      } catch {}
      const nextState = {
        kind: 'dropbox',
        name: mountInfo?.name || rootMeta.name || this.getVaultName(),
        path: vaultPath,
        access,
        shared: !!mountInfo,
        accountId: account?.account_id || '',
        accountName: account?.name?.display_name || account?.email || '',
        ownerId: vaultMeta?.ownerId || '',
        ownerName: vaultMeta?.ownerName || '',
        isOwner: this.isCurrentAccountVaultOwner(vaultMeta, account),
        sourceFolders: Array.isArray(sourceRegistry?.roots) ? sourceRegistry.roots.length : 0,
        cursorTopology: {
          vault: 'source-folder-registry',
          liveEvents: 'reserved-events-cursor',
        },
      };
      _runtime()?.setWorkspaceState?.(nextState);
      return {
        ok: true,
        mounted: true,
        access,
        mountInfo,
        account,
        vaultMeta,
        state: nextState,
      };
    }
  }

  const _providers = {
    dropbox: new DropboxStorageProvider(),
    legacy: null,
  };

  function _getLegacyProvider() {
    const ctor = window.MeldexStorageAdapter?.LocalFsStorageProvider;
    if (typeof ctor !== 'function') throw new Error('LocalFS storage provider が未読み込みです');
    if (!_providers.legacy || !(_providers.legacy instanceof ctor)) _providers.legacy = new ctor();
    return _providers.legacy;
  }

  function _activeProvider() {
    return _runtime()?.isDropboxMode?.() ? _providers.dropbox : _getLegacyProvider();
  }

  window.MeldexStorageAdapter = {
    DropboxStorageProvider,
    LocalFsStorageProvider: null,
    isSupported() {
      return _activeProvider().constructor.isSupported();
    },
    getProvider() {
      return _activeProvider();
    },
    async restoreWorkspace() {
      return _activeProvider().restoreWorkspace();
    },
    async clearWorkspace() {
      return _activeProvider().clearWorkspace();
    },
    async ensureWorkspacePermission(mode) {
      return _activeProvider().ensureWorkspacePermission(mode);
    },
    async describeWorkspace() {
      return _activeProvider().getWorkspaceInfo(true);
    },
    async preflight() {
      return _activeProvider().preflight();
    },
  };
})();
