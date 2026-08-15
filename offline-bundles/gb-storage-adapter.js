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

  function _isDropboxNotFoundError(err) {
    return /not_found|not found|path_lookup/i.test(err?.message || '');
  }

  // 計画書 app/docs/note-editor-regression-performance-conflict-plan-2026-08-01.md
  // §5 工程2-D項目7・工程2-B項目1〜2「正規化内容hash（サーバー側と同じ規則）」。
  // サーバー側 meldex_file_safety.canonical_text_for_conflict_compare の
  // 対応する部分集合をクライアント側で再現する（Dropbox直接書込経路には
  // Pythonサーバーが介在しないため、同じ規則をクライアント側にも持つ必要がある）。
  // - `.md`: 改行コード（CRLF/CR）の表記ゆれのみ吸収する最小限の正規化
  // - それ以外（バイナリ等）: 正規化しない。バイト列同士の完全一致で比較する
  // 文書ID対象4形式（.mel-board等）の正規化はサーバー専用処理に依存するため、
  // クライアント側では対象外のまま安全側（=別内容扱い）に倒す。
  function _canonicalizeBytesForCompare(relativePath, bytes) {
    const lower = String(relativePath || '').toLowerCase();
    if (!lower.endsWith('.md')) return bytes;
    try {
      const text = new TextDecoder('utf-8').decode(bytes);
      const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      return new TextEncoder().encode(normalized);
    } catch (_) {
      return bytes;
    }
  }

  async function _canonicalContentHash(relativePath, bytes) {
    if (!globalThis.crypto?.subtle) return '';
    try {
      const canonical = _canonicalizeBytesForCompare(relativePath, bytes);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', canonical);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return '';
    }
  }

  function _conflictBackupDocumentId() {
    const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '')
      || `${Math.random().toString(16).slice(2)}${Date.now().toString(36)}`;
    return `dropbox-write-conflict-${random}`.slice(0, 128).replace(/[^A-Za-z0-9_-]/g, '');
  }

  function _normalizeHandleOptions(options) {
    if (typeof options === 'boolean') return { create: options };
    return options || {};
  }

  const DROPBOX_FILE_CACHE_TTL_MS = 20 * 1000;
  const DROPBOX_FILE_CACHE_MAX_ENTRIES = 24;
  const DROPBOX_FILE_CACHE_MAX_BYTES = 2 * 1024 * 1024;
  // Dropbox の単発アップロード上限は150MB。境界ぎりぎりを避けて分割へ切り替える。
  const DROPBOX_SINGLE_UPLOAD_MAX_BYTES = 140 * 1024 * 1024;
  // 分割送信の1回あたりのサイズ（Dropbox の推奨は4MBの倍数）。
  const DROPBOX_UPLOAD_CHUNK_BYTES = 32 * 1024 * 1024;
  const DROPBOX_LIST_CACHE_TTL_MS = 3500;
  const DROPBOX_LIST_CACHE_MAX_ENTRIES = 80;

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
    if (lower.endsWith('.mel-scenario')) return '.mel-scenario';
    if (lower.endsWith('.mel-timer')) return '.mel-timer';
    if (lower.endsWith('.scriptnote.json')) return '.scriptnote.json';
    if (lower.endsWith('.smart-db.json')) return '.smart-db.json';
    if (lower.endsWith('.timer.json')) return '.timer.json';
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
      this._fileCache = new Map();
      this._fileDownloadInFlight = new Map();
      this._listCache = new Map();
      this._listInFlight = new Map();
      this._listCacheGeneration = 0;
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

    _dropboxLocation(relativePath) {
      const registry = _sourceRegistry();
      if (registry?.resolveDropboxLocation) {
        return registry.resolveDropboxLocation(relativePath, this.getVaultPath());
      }
      if (registry?.resolveDropboxPath) {
        return {
          path: registry.resolveDropboxPath(relativePath, this.getVaultPath()),
          namespaceKind: 'home',
        };
      }
      const vaultPath = this.getVaultPath();
      if (!vaultPath) throw new Error('Dropboxの保存先フォルダが未設定です');
      const relative = _normalizeRelativePath(relativePath);
      return {
        path: relative ? (vaultPath + '/' + relative) : vaultPath,
        namespaceKind: _auth()?.getVaultNamespaceKind?.() === 'team_root' ? 'team_root' : 'home',
      };
    }

    _dropboxPath(relativePath) {
      return this._dropboxLocation(relativePath).path;
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

    async _rpc(route, body, location) {
      return _auth().apiRpc(route, body, {
        namespaceKind: location?.namespaceKind || 'home',
      });
    }

    async _content(route, arg, init, location) {
      return _auth().apiContent(route, arg, init, {
        namespaceKind: location?.namespaceKind || 'home',
      });
    }

    _rememberMeta(relativePath, meta) {
      this._metaCache.set(_normalizeRelativePath(relativePath), meta || null);
    }

    _fileCacheMetaKey(meta) {
      return String(meta?.rev || meta?.content_hash || meta?.server_modified || meta?.client_modified || '');
    }

    _rememberDownloadedFile(relativePath, file, meta) {
      const normalized = _normalizeRelativePath(relativePath);
      const size = Number(file?.size || meta?.size || 0);
      if (!normalized || !file || size > DROPBOX_FILE_CACHE_MAX_BYTES) {
        this._fileCache.delete(normalized);
        return;
      }
      this._fileCache.set(normalized, {
        file,
        metaKey: this._fileCacheMetaKey(meta),
        size,
        at: Date.now(),
      });
      while (this._fileCache.size > DROPBOX_FILE_CACHE_MAX_ENTRIES) {
        const firstKey = this._fileCache.keys().next().value;
        if (!firstKey) break;
        this._fileCache.delete(firstKey);
      }
    }

    _cachedDownloadedFile(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const cached = this._fileCache.get(normalized);
      if (!cached) return null;
      if (Date.now() - Number(cached.at || 0) > DROPBOX_FILE_CACHE_TTL_MS) {
        this._fileCache.delete(normalized);
        return null;
      }
      if (this._metaCache.has(normalized)) {
        const meta = this._metaCache.get(normalized);
        if (!meta || meta['.tag'] !== 'file') {
          this._fileCache.delete(normalized);
          return null;
        }
        const currentMetaKey = this._fileCacheMetaKey(meta);
        if (cached.metaKey && currentMetaKey && cached.metaKey !== currentMetaKey) {
          this._fileCache.delete(normalized);
          return null;
        }
      }
      this._fileCache.delete(normalized);
      this._fileCache.set(normalized, { ...cached, at: Date.now() });
      return cached.file;
    }

    _forgetFileCache(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) {
        this._fileCache.clear();
        this._fileDownloadInFlight.clear();
        return;
      }
      this._fileCache.delete(normalized);
      this._fileDownloadInFlight.delete(normalized);
      const prefix = normalized + '/';
      [...this._fileCache.keys()].forEach((key) => {
        if (key.startsWith(prefix)) this._fileCache.delete(key);
      });
      [...this._fileDownloadInFlight.keys()].forEach((key) => {
        if (key.startsWith(prefix)) this._fileDownloadInFlight.delete(key);
      });
    }

    _cloneListEntries(entries) {
      return (Array.isArray(entries) ? entries : []).map(entry => ({ ...entry }));
    }

    _rememberListEntries(relativePath, entries) {
      const normalized = _normalizeRelativePath(relativePath);
      this._listCache.delete(normalized);
      this._listCache.set(normalized, {
        at: Date.now(),
        entries: this._cloneListEntries(entries),
      });
      while (this._listCache.size > DROPBOX_LIST_CACHE_MAX_ENTRIES) {
        const firstKey = this._listCache.keys().next().value;
        if (firstKey == null) break;
        this._listCache.delete(firstKey);
      }
    }

    _cachedListEntries(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const cached = this._listCache.get(normalized);
      if (!cached) return null;
      if (Date.now() - Number(cached.at || 0) > DROPBOX_LIST_CACHE_TTL_MS) {
        this._listCache.delete(normalized);
        return null;
      }
      this._listCache.delete(normalized);
      this._listCache.set(normalized, { ...cached, at: Date.now() });
      return this._cloneListEntries(cached.entries);
    }

    _forgetListCache(relativePath) {
      this._listCacheGeneration += 1;
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) {
        this._listCache.clear();
        this._listInFlight.clear();
        return;
      }
      const parent = _dirname(normalized);
      this._listCache.delete(normalized);
      this._listInFlight.delete(normalized);
      this._listCache.delete(parent);
      this._listInFlight.delete(parent);
      const prefix = normalized + '/';
      [...this._listCache.keys()].forEach((key) => {
        if (key.startsWith(prefix)) this._listCache.delete(key);
      });
      [...this._listInFlight.keys()].forEach((key) => {
        if (key.startsWith(prefix)) this._listInFlight.delete(key);
      });
    }

    _forgetMeta(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      this._metaCache.delete(normalized);
      this._forgetFileCache(normalized);
      this._forgetListCache(normalized);
      const prefix = normalized ? (normalized + '/') : '';
      [...this._metaCache.keys()].forEach((key) => {
        if (prefix && key.startsWith(prefix)) this._metaCache.delete(key);
      });
    }

    // フォルダの存在確認・作成のように「そのフォルダ自身の情報だけが変わりうる」
    // 操作用の軽い無効化。_forgetMeta() は配下の版情報(rev)まで巻き添えで消すため、
    // ensureDirectory() から呼ぶと、直前に読み込んだ「これから書くファイル」の rev
    // まで失われ、uploadBytes() が既存ファイルを新規作成(add)として送ってしまい
    // Dropbox 側で必ず競合になっていた（起動しただけで競合コピーが生成される真因）。
    // フォルダを作る操作は配下ファイルの rev を変えないので、配下は保持してよい。
    _forgetMetaSelf(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      this._metaCache.delete(normalized);
      this._forgetFileCache(normalized);
      this._forgetListCache(normalized);
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
      this._fileCache.clear();
      this._fileDownloadInFlight.clear();
      this._forgetListCache('');
      this._recentConflictCopies.clear();
    }

    async ensureWorkspacePermission(mode) {
      const workspace = await this.restoreWorkspace();
      if (!workspace) return false;
      const state = _runtime()?.getWorkspaceState?.() || {};
      const requestedMode = mode || 'readwrite';
      if (requestedMode === 'readwrite' && document.body?.dataset?.cloudQuotaBlocked === '1') return false;
      if (requestedMode === 'readwrite' && state.access === 'viewer') return false;
      if (requestedMode === 'readwrite') {
        const resolver = window.MeldexDropboxManagementRootResolver;
        const migration = window.MeldexSidecarMigration;
        if (!resolver?.resolveConnectionInfo) return false;
        try {
          const info = await resolver.resolveConnectionInfo(this);
          if (info?.kind === 'unknown') return false;
          if (info?.isSharedWorkspace) {
            if (!migration?.getCompatibilityLock) return false;
            const lock = await migration.getCompatibilityLock(this);
            if (lock?.locked || lock?.unavailable) return false;
          }
        } catch {
          return false;
        }
      }
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
        namespaceKind: _auth()?.getVaultNamespaceKind?.() === 'team_root' ? 'team_root' : 'home',
        permission: state.access === 'viewer' ? 'readonly' : 'readwrite',
      };
    }

    async _workspaceMetadataRecord(documentId) {
      const resolver = window.MeldexDropboxManagementRootResolver;
      const kind = window.MeldexSystemStorage?.SystemStorageKind?.WORKSPACE_METADATA;
      if (!resolver?.resolveTypedAdapterForProvider || !kind) {
        throw new Error('ワークスペース管理データの保存先を安全に判定できません');
      }
      const adapter = await resolver.resolveTypedAdapterForProvider(this, kind);
      const record = await adapter.load(kind, documentId);
      return { adapter, kind, record };
    }

    async readVaultMetadata() {
      const managed = await this._workspaceMetadataRecord('vault-metadata');
      const meta = managed.record?.payload || await this.readJson('_meldex/vault.json', null);
      return meta && typeof meta === 'object' ? meta : null;
    }

    async writeVaultMetadata(metadata) {
      const managed = await this._workspaceMetadataRecord('vault-metadata');
      return managed.adapter.save(managed.kind, 'vault-metadata', metadata || {}, {
        expectedRevision: managed.record?.revision ?? null,
      });
    }

    async assertOwnerWrite(relativePath) {
      const state = _runtime()?.getWorkspaceState?.() || {};
      if (state.access === 'viewer' || document.body?.dataset?.cloudReadonly === '1') {
        throw new Error('閲覧専用モードのため書き込めません');
      }
      const account = await _auth().getCurrentAccount(false).catch(() => null);
      const metadata = await this.readVaultMetadata();
      const ownerId = String(metadata?.ownerId || metadata?.owner_id || '').trim();
      const currentId = _accountId(account);
      if (!ownerId || !currentId || ownerId !== currentId) {
        throw new Error('管理者のみ書き込める共有データです');
      }
      return {
        ok: true,
        ownerId,
        currentAccountId: currentId,
        path: _normalizeRelativePath(relativePath),
      };
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
      const usageRecord = await this._workspaceMetadataRecord('space-usage');
      const cached = usageRecord.record?.payload || await this.readJson('_meldex/space-usage.json', null);
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
        return {
          ..._spaceUsageSnapshot(rawUsage, account, vaultMeta),
          isOwner: true,
          persisted: false,
        };
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

    async publishSharedSpaceUsage() {
      const account = await _auth().getCurrentAccount(false).catch(() => null);
      const vaultMeta = await this.readVaultMetadata();
      if (!this.isCurrentAccountVaultOwner(vaultMeta, account)) {
        throw new Error('管理者のみ共有容量情報を更新できます');
      }
      const rawUsage = await _auth().getSpaceUsage();
      const snapshot = {
        ..._spaceUsageSnapshot(rawUsage, account, vaultMeta),
        isOwner: true,
        persisted: true,
      };
      await this.assertOwnerWrite('space-usage');
      const managed = await this._workspaceMetadataRecord('space-usage');
      await managed.adapter.save(managed.kind, 'space-usage', snapshot, {
        expectedRevision: managed.record?.revision ?? null,
      });
      return snapshot;
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
        const location = this._dropboxLocation(normalized);
        const payload = await this._rpc('files/get_metadata', {
          path: location.path,
          include_deleted: false,
          include_has_explicit_shared_members: false,
        }, location);
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
          const location = this._dropboxLocation(current);
          await this._rpc('files/create_folder_v2', {
            path: location.path,
            autorename: false,
          }, location);
        } catch (err) {
          this._forgetMetaSelf(current);
          const existing = await this.statPath(current);
          if (!existing || existing.kind !== 'directory') throw err;
        }
        this._forgetMetaSelf(current);
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
        }, {
          namespaceKind: _auth()?.getVaultNamespaceKind?.() === 'team_root' ? 'team_root' : 'home',
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
      const cached = this._cachedListEntries(normalized);
      if (cached) return cached;
      const inFlight = this._listInFlight.get(normalized);
      if (inFlight) return this._cloneListEntries(await inFlight);
      const sourceId = _sourceRegistry()?.parseSourcePath?.(normalized)?.sourceId || '';
      const location = this._dropboxLocation(normalized);
      const cacheGeneration = this._listCacheGeneration;
      const promise = (async () => {
        const entries = [];
        let payload = await this._rpc('files/list_folder', {
          path: location.path,
          recursive: false,
          include_deleted: false,
          include_has_explicit_shared_members: false,
          include_mounted_folders: true,
        }, location);
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
          payload = await this._rpc('files/list_folder/continue', { cursor: payload.cursor }, location);
        }
        entries.sort((a, b) => a.name.localeCompare(b.name, 'ja', { sensitivity: 'base' }));
        if (cacheGeneration === this._listCacheGeneration) {
          this._rememberListEntries(normalized, entries);
        }
        return entries;
      })();
      this._listInFlight.set(normalized, promise);
      try {
        return this._cloneListEntries(await promise);
      } finally {
        if (this._listInFlight.get(normalized) === promise) this._listInFlight.delete(normalized);
      }
    }

    async downloadAsFile(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const cached = this._cachedDownloadedFile(normalized);
      if (cached) return cached;
      const inFlight = this._fileDownloadInFlight.get(normalized);
      if (inFlight) return inFlight;
      const promise = (async () => {
        const location = this._dropboxLocation(normalized);
        const response = await this._content('files/download', { path: location.path }, undefined, location);
        const resultHeader = response.headers.get('dropbox-api-result');
        const meta = _safeJsonParse(resultHeader, null) || {};
        this._rememberMeta(normalized, meta);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const modified = meta.server_modified || meta.client_modified || '';
        const file = _createFile(bytes, meta.name || _basename(normalized), {
          type: response.headers.get('content-type') || _mimeFromPath(normalized),
          lastModified: _jsonDate(modified),
        });
        this._rememberDownloadedFile(normalized, file, meta);
        return file;
      })();
      this._fileDownloadInFlight.set(normalized, promise);
      try {
        return await promise;
      } finally {
        if (this._fileDownloadInFlight.get(normalized) === promise) this._fileDownloadInFlight.delete(normalized);
      }
    }

    async readBytesFresh(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const location = this._dropboxLocation(normalized);
      const metadata = () => this._rpc('files/get_metadata', {
        path: location.path, include_deleted: false, include_has_explicit_shared_members: false,
      }, location);
      const before = await metadata();
      const response = await this._content('files/download', { path: location.path }, undefined, location);
      const downloaded = _safeJsonParse(response.headers.get('dropbox-api-result'), null) || {};
      const bytes = new Uint8Array(await response.arrayBuffer());
      const after = await metadata();
      if (!before?.rev || before.rev !== downloaded.rev || before.rev !== after?.rev) {
        throw Object.assign(new Error('Dropboxファイルの読込中に内容が変わりました'), { status: 409, meldexCode: 'etag_conflict' });
      }
      this._rememberMeta(normalized, after);
      return { bytes, revision: after.rev };
    }

    async getTemporaryLink(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const location = this._dropboxLocation(normalized);
      const payload = await this._rpc('files/get_temporary_link', { path: location.path }, location);
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
      // Dropbox の単発アップロードは150MBまで。動画などはセッションへ切り替える
      // （切り替えないと大きいファイルの保存が必ず失敗する）。
      if (bytes && bytes.length > DROPBOX_SINGLE_UPLOAD_MAX_BYTES) {
        return this._uploadLargeBytesWithMode(relativePath, bytes, mode);
      }
      const normalized = _normalizeRelativePath(relativePath);
      const location = this._dropboxLocation(normalized);
      const response = await this._content('files/upload', {
        path: location.path,
        mode,
        autorename: false,
        mute: false,
        strict_conflict: true,
      }, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      }, location);
      const meta = await response.json();
      this._rememberMeta(normalized, meta);
      this._rememberDownloadedFile(normalized, _createFile(bytes, meta.name || _basename(normalized), {
        type: _mimeFromPath(normalized),
        lastModified: _jsonDate(meta.server_modified || meta.client_modified || ''),
      }), meta);
      this._forgetListCache(_dirname(normalized));
      return meta;
    }

    /** 150MBを超えるファイルを分割して送る（動画の添付などで使う）。 */
    async _uploadLargeBytesWithMode(relativePath, bytes, mode) {
      const normalized = _normalizeRelativePath(relativePath);
      const location = this._dropboxLocation(normalized);
      const octet = { 'Content-Type': 'application/octet-stream' };
      const total = bytes.length;
      const first = bytes.subarray(0, Math.min(DROPBOX_UPLOAD_CHUNK_BYTES, total));
      const started = await this._content('files/upload_session/start', { close: false }, {
        method: 'POST', headers: octet, body: first,
      }, location);
      const session = await started.json();
      let offset = first.length;
      while (offset < total) {
        const end = Math.min(offset + DROPBOX_UPLOAD_CHUNK_BYTES, total);
        await this._content('files/upload_session/append_v2', {
          cursor: { session_id: session.session_id, offset },
          close: false,
        }, {
          method: 'POST', headers: octet, body: bytes.subarray(offset, end),
        }, location);
        offset = end;
      }
      const finished = await this._content('files/upload_session/finish', {
        cursor: { session_id: session.session_id, offset: total },
        commit: {
          path: location.path,
          mode,
          autorename: false,
          mute: false,
          strict_conflict: true,
        },
      }, {
        method: 'POST', headers: octet, body: new Uint8Array(0),
      }, location);
      const meta = await finished.json();
      this._rememberMeta(normalized, meta);
      // 大きいファイルは内容をメモリへ抱えない（_rememberDownloadedFile の上限判定にも掛かる）
      this._forgetListCache(_dirname(normalized));
      return meta;
    }

    async _writeConflictCopy(originalPath, bytes, conflictInfo) {
      const resolver = window.MeldexDropboxManagementRootResolver;
      const contract = window.MeldexSystemStorage;
      const kind = contract?.SystemStorageKind?.CONFLICT_BACKUPS;
      if (!resolver?.resolveTypedAdapterForProvider || !kind) {
        throw new Error('競合した編集内容の安全な保存先を判定できません');
      }
      const adapter = await resolver.resolveTypedAdapterForProvider(this, kind);
      const now = new Date().toISOString();
      const info = conflictInfo || {};
      const payload = {
        kind: 'dropbox-write-conflict',
        original_relative_path: _normalizeRelativePath(originalPath),
        attempted_bytes_base64: _bytesToBase64(bytes),
        attempted_size: Number(bytes?.byteLength ?? bytes?.length ?? 0),
        attempted_at: now,
        expected_transport_revision: String(info.expectedRevision || ''),
        current_transport_revision: String(info.currentRevision || ''),
      };
      const recent = this._recentConflictCopies.get(originalPath);
      if (recent && Date.now() - recent.at < 30 * 60 * 1000) {
        const latestRecord = recent.record?.revision
          ? recent.record
          : await adapter.load(kind, recent.documentId).catch(() => null);
        if (latestRecord?.revision) {
          try {
            const record = await adapter.save(kind, recent.documentId, payload, {
              expectedRevision: latestRecord.revision,
            });
            const path = `${kind}/${recent.documentId}`;
            this._recentConflictCopies.set(originalPath, {
              documentId: recent.documentId, path, record, at: Date.now(),
            });
            return { path, record, documentId: recent.documentId, reused: true };
          } catch {
            // 直近バックアップの更新は最適化に過ぎない。削除・revision競合・
            // 一時障害のいずれでも、新規管理レコードへ退避して保存内容を失わない。
          }
        }
      }
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const documentId = _conflictBackupDocumentId();
        try {
          const record = await adapter.save(kind, documentId, payload, { expectedRevision: null });
          const path = `${kind}/${documentId}`;
          this._recentConflictCopies.set(originalPath, { documentId, path, record, at: Date.now() });
          return { path, record, documentId };
        } catch (error) {
          const collision = error instanceof contract.SystemStorageConflictError
            || /revision|conflict/i.test(error?.message || '');
          if (!collision || attempt >= 4) throw error;
        }
      }
      throw new Error('Dropbox 競合バックアップを管理領域へ保存できませんでした');
    }

    // 計画書§5工程2-D項目7「競合コピー作成前に正規化内容hashを比較し、同一なら
    // 現在revisionを採用して競合コピーを作らない」。事前チェック通過後〜
    // アップロードまでの間に別端末が書き込んだ結果を取得し、これから書こうと
    // している内容と正規化後ハッシュが一致するかだけを見る（本文比較であり
    // rev/etagは一切比較しない＝transport_revisionを跨いだ比較をしない）。
    // 何らかの理由で比較できない場合（ダウンロード失敗等）は安全側（=別内容
    // 扱い）に倒し、通常の競合コピー経路へフォールバックする。
    async _tryConvergeOnIdenticalContent(normalized, bytes) {
      const latestMeta = this._metaCache.has(normalized) ? this._metaCache.get(normalized) : null;
      if (!latestMeta?.rev) return null;
      let remoteFile;
      try {
        remoteFile = await this.downloadAsFile(normalized);
      } catch (_) {
        return null;
      }
      const remoteBytes = new Uint8Array(await remoteFile.arrayBuffer());
      const [localHash, remoteHash] = await Promise.all([
        _canonicalContentHash(normalized, bytes),
        _canonicalContentHash(normalized, remoteBytes),
      ]);
      if (!localHash || !remoteHash || localHash !== remoteHash) return null;
      return latestMeta;
    }

    // 書き込み直前の版情報(rev)を確定する。キャッシュに「このパスの項目そのものが
    // 無い」場合は、存在するかどうかを確かめずに 'add'（新規作成）へ落ちると、
    // 既存ファイルに対して strict_conflict の衝突を必ず起こす。値が null で
    // 記録されている場合は「存在しないと確認済み」なので追加問い合わせをしない。
    async _resolveUploadMeta(normalizedPath) {
      if (this._metaCache.has(normalizedPath)) return this._metaCache.get(normalizedPath);
      try {
        return await this.getMetadata(normalizedPath);
      } catch (_) {
        // 版情報を取得できない場合は従来どおりの挙動（新規作成として送る）に倒す。
        // 競合時は既存の退避・再取得経路が受け止める。
        return null;
      }
    }

    async uploadBytes(relativePath, bytes) {
      const normalized = _normalizeRelativePath(relativePath);
      const parent = _dirname(normalized);
      if (parent) await this.ensureDirectory(parent);
      const cachedMeta = await this._resolveUploadMeta(normalized);
      const mode = cachedMeta?.rev ? { '.tag': 'update', update: cachedMeta.rev } : 'add';
      try {
        const result = await this._uploadBytesWithMode(normalized, bytes, mode);
        this._recentConflictCopies.delete(normalized);
        return result;
      } catch (err) {
        if (!_isDropboxConflictError(err)) throw err;
        await this.refreshMetadata(normalized).catch(() => null);
        const converged = await this._tryConvergeOnIdenticalContent(normalized, bytes).catch(() => null);
        if (converged) {
          this._recentConflictCopies.delete(normalized);
          return converged;
        }
        const currentMeta = this._metaCache.has(normalized) ? this._metaCache.get(normalized) : null;
        const conflict = await this._writeConflictCopy(normalized, bytes, {
          expectedRevision: cachedMeta?.rev || '',
          currentRevision: currentMeta?.rev || '',
        });
        // 計画書§5工程2-D項目3「CAS失敗時に.status/.codeを付与し、ノート側の
        // 409判定と接続する」。gb-save-safety.enrichError と同じフィールド名
        // （status/meldexCode）を使い、HTTP応答を経由しない直接Dropbox書込
        // エラーでも既存の`error?.status===409`判定を通す。
        const conflictError = new Error(`Dropbox 上で更新競合が発生したため、元ファイルは上書きせずMeldexの管理領域へ編集内容を保存しました: ${conflict.path}`);
        conflictError.status = 409;
        conflictError.meldexCode = 'etag_conflict';
        conflictError.conflictPath = conflict.path;
        conflictError.conflictBackupDocumentId = conflict.documentId;
        throw conflictError;
      }
    }

    async uploadBytesConditional(relativePath, bytes, expectedRevision) {
      const normalized = _normalizeRelativePath(relativePath);
      const parent = _dirname(normalized);
      if (parent) await this.ensureDirectory(parent);
      try {
        const mode = expectedRevision == null ? 'add' : { '.tag': 'update', update: String(expectedRevision) };
        return await this._uploadBytesWithMode(normalized, bytes, mode);
      } catch (error) {
        if (!_isDropboxConflictError(error)) throw error;
        this._forgetMeta(normalized);
        throw Object.assign(new Error('Dropbox上で同時に更新されました'), { status: 409, meldexCode: 'etag_conflict' });
      }
    }

    async deletePathConditional(relativePath, expectedRevision) {
      void relativePath; void expectedRevision;
      throw Object.assign(new Error('Dropbox APIはrev条件付き削除を提供しないため、厳密なフォルダー復元では削除できません'), {
        status: 503, meldexCode: 'strict_cas_unavailable',
      });
    }

    async deleteEmptyDirectoryConditional(relativePath) {
      void relativePath;
      throw Object.assign(new Error('Dropbox APIは空フォルダーのatomic条件付き削除を提供しません'), {
        status: 503, meldexCode: 'strict_cas_unavailable',
      });
    }

    supportsStrictConditionalDelete() { return false; }
    folderRestoreCapabilities() {
      return Object.freeze({ createFileCas: true, updateFileCas: true, deleteFileCas: false, deleteEmptyDirectoryCas: false });
    }

    async overwriteBytes(relativePath, bytes) {
      const normalized = _normalizeRelativePath(relativePath);
      const parent = _dirname(normalized);
      if (parent) await this.ensureDirectory(parent);
      const result = await this._uploadBytesWithMode(normalized, bytes, 'overwrite');
      this._recentConflictCopies.delete(normalized);
      return result;
    }

    async writeText(relativePath, content) {
      return this.uploadBytes(relativePath, new TextEncoder().encode(String(content ?? '')));
    }

    async writeJson(relativePath, data) {
      return this.writeText(relativePath, JSON.stringify(data, null, 2));
    }

    async writeJsonMerged(relativePath, updater, options) {
      const normalized = _normalizeRelativePath(relativePath);
      const parent = _dirname(normalized);
      if (parent) await this.ensureDirectory(parent);
      const fallbackValue = Object.prototype.hasOwnProperty.call(options || {}, 'fallbackValue')
        ? options.fallbackValue
        : {};
      const retries = Math.max(1, Number(options?.retries || 4));
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      let lastError = null;
      for (let attempt = 0; attempt < retries; attempt += 1) {
        let current = fallbackValue;
        let rev = '';
        try {
          const location = this._dropboxLocation(normalized);
          const response = await this._content('files/download', { path: location.path }, undefined, location);
          const resultHeader = response.headers.get('dropbox-api-result');
          const meta = _safeJsonParse(resultHeader, null) || {};
          this._rememberMeta(normalized, meta);
          rev = String(meta.rev || '');
          current = _safeJsonParse(await response.text(), fallbackValue);
        } catch (err) {
          if (!_isDropboxNotFoundError(err)) throw err;
          this._rememberMeta(normalized, null);
        }
        const base = current && typeof current === 'object' && !Array.isArray(current) ? current : fallbackValue;
        const next = await updater(base, { attempt, rev });
        if (next === false) return { ok: true, skipped: true };
        const data = next === undefined ? base : next;
        const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
        const mode = rev ? { '.tag': 'update', update: rev } : 'add';
        try {
          const meta = await this._uploadBytesWithMode(normalized, bytes, mode);
          this._recentConflictCopies.delete(normalized);
          return { ok: true, meta };
        } catch (err) {
          lastError = err;
          if (!_isDropboxConflictError(err) || attempt >= retries - 1) throw err;
          this._forgetMeta(normalized);
          await delay(Math.min(1200, 140 * (attempt + 1)));
        }
      }
      throw lastError || new Error('Dropbox 共有メタ情報を保存できませんでした');
    }

    async deletePath(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const location = this._dropboxLocation(normalized);
      await this._rpc('files/delete_v2', { path: location.path }, location);
      this._forgetMeta(normalized);
      return true;
    }

    async movePath(oldRelativePath, newRelativePath) {
      const source = _normalizeRelativePath(oldRelativePath);
      const target = _normalizeRelativePath(newRelativePath);
      const parent = _dirname(target);
      if (parent) await this.ensureDirectory(parent);
      const sourceLocation = this._dropboxLocation(source);
      const targetLocation = this._dropboxLocation(target);
      let sourcePath = sourceLocation.path;
      if (sourceLocation.namespaceKind !== targetLocation.namespaceKind) {
        const sourceMeta = await this._rpc('files/get_metadata', {
          path: sourceLocation.path,
          include_deleted: false,
        }, sourceLocation);
        sourcePath = String(sourceMeta?.id || '');
        if (!sourcePath) throw new Error('Dropbox領域をまたぐ移動元を確認できませんでした');
      }
      const payload = await this._rpc('files/move_v2', {
        from_path: sourcePath,
        to_path: targetLocation.path,
        allow_shared_folder: true,
        autorename: false,
        allow_ownership_transfer: false,
      }, targetLocation);
      this._forgetMeta(source);
      // 移動元の親フォルダの一覧キャッシュも明示的に無効化する（移動先のみが無効化され、
      // 移動元フォルダに最大3.5秒古い項目が残る問題の予防）
      this._forgetListCache(_dirname(source));
      this._rememberMeta(target, payload.metadata || null);
      this._forgetListCache(_dirname(target));
      return payload;
    }

    async movePathNoReplace(oldRelativePath, newRelativePath) {
      // Dropbox files/move_v2 with autorename:false is an atomic no-replace publish.
      return this.movePath(oldRelativePath, newRelativePath);
    }

    async copyPath(oldRelativePath, newRelativePath) {
      const source = _normalizeRelativePath(oldRelativePath);
      const target = _normalizeRelativePath(newRelativePath);
      const parent = _dirname(target);
      if (parent) await this.ensureDirectory(parent);
      const sourceLocation = this._dropboxLocation(source);
      const targetLocation = this._dropboxLocation(target);
      let sourcePath = sourceLocation.path;
      if (sourceLocation.namespaceKind !== targetLocation.namespaceKind) {
        const sourceMeta = await this._rpc('files/get_metadata', {
          path: sourceLocation.path,
          include_deleted: false,
        }, sourceLocation);
        sourcePath = String(sourceMeta?.id || '');
        if (!sourcePath) throw new Error('Dropbox領域をまたぐコピー元を確認できませんでした');
      }
      const payload = await this._rpc('files/copy_v2', {
        from_path: sourcePath,
        to_path: targetLocation.path,
        allow_shared_folder: true,
        autorename: false,
      }, targetLocation);
      this._rememberMeta(target, payload.metadata || null);
      this._forgetListCache(_dirname(target));
      return payload;
    }

    async preflight() {
      this._metaCache.clear();
      this._fileCache.clear();
      this._fileDownloadInFlight.clear();
      this._forgetListCache('');
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

      let metaFolder = await this.readVaultMetadata();
      if (!metaFolder) {
        try {
          await this.writeVaultMetadata({
            kind: 'meldex-vault',
            vaultPath,
            initializedAt: new Date().toISOString(),
            ownerId: _accountId(account),
            ownerName: _accountName(account),
            ownerEmail: String(account?.email || ''),
            ownerInitializedAt: new Date().toISOString(),
          });
          metaFolder = await this.readVaultMetadata();
        } catch (err) {
          return {
            ok: false,
            mounted: true,
            access: 'viewer',
            message: `共有ワークスペースのMeldex管理データを初期化できません。編集権限のあるメンバーで初期セットアップしてください。詳細: ${err?.message || String(err)}`,
            mountInfo,
            rootMeta,
          };
        }
      }
      let access = 'editor';
      try {
        const resolver = window.MeldexDropboxManagementRootResolver;
        const kind = window.MeldexSystemStorage?.SystemStorageKind?.DIAGNOSTICS;
        if (!resolver?.resolveTypedAdapterForProvider || !kind) {
          throw new Error('Meldex管理データの保存先を安全に判定できません');
        }
        const adapter = await resolver.resolveTypedAdapterForProvider(this, kind);
        const documentId = `preflight-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        await adapter.save(kind, documentId, { ok: true, at: new Date().toISOString() }, {
          expectedRevision: null,
        });
        await adapter.delete(kind, documentId);
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
    browser: null,
    legacy: null,
  };

  function _getBrowserProvider() {
    const ctor = window.MeldexStorageAdapter?.BrowserStorageProvider;
    if (typeof ctor !== 'function') throw new Error('ブラウザ内ストレージが未読み込みです');
    if (!_providers.browser || !(_providers.browser instanceof ctor)) _providers.browser = new ctor();
    return _providers.browser;
  }

  function _getLegacyProvider() {
    const ctor = window.MeldexStorageAdapter?.LocalFsStorageProvider;
    if (typeof ctor !== 'function') throw new Error('LocalFS storage provider が未読み込みです');
    if (!_providers.legacy || !(_providers.legacy instanceof ctor)) _providers.legacy = new ctor();
    return _providers.legacy;
  }

  function _activeProvider() {
    if (_runtime()?.isDropboxMode?.()) return _providers.dropbox;
    if (_runtime()?.isBrowserMode?.()) return _getBrowserProvider();
    return _getLegacyProvider();
  }

  window.MeldexStorageAdapter = {
    DropboxStorageProvider,
    BrowserStorageProvider: null,
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
/* Fresh, bounded Dropbox reads used only by destructive-operation confirmation. */
(function () {
  'use strict';

  function _normalize(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  }

  function _basename(path) { return _normalize(path).split('/').pop() || ''; }

  function _modifiedMs(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async function statDropbox(provider, relativePath) {
    const normalized = _normalize(relativePath);
    const location = provider._dropboxLocation(normalized);
    let meta;
    try {
      meta = await provider._rpc('files/get_metadata', {
        path: location.path, include_deleted: false,
        include_has_explicit_shared_members: false,
      }, location);
    } catch (error) {
      if (/not_found/i.test(error?.message || '')) return null;
      throw error;
    }
    const modified = meta.server_modified || meta.client_modified || '';
    return { kind: meta['.tag'] === 'folder' ? 'directory' : 'file',
      name: meta.name || _basename(normalized), path: normalized,
      size: Number(meta.size || 0), modified, modifiedMs: _modifiedMs(modified), meta };
  }

  async function walkDropbox(provider, relativePath, limits = {}) {
    const normalized = _normalize(relativePath);
    const maxEntries = Number(limits.maxEntries || 20000);
    const maxPathBytes = Number(limits.maxPathBytes || 4 * 1024 * 1024);
    const sourceId = window.MeldexSourceFolderRegistry?.parseSourcePath?.(normalized)?.sourceId || '';
    const location = provider._dropboxLocation(normalized);
    const rows = [];
    let pathBytes = 0;
    let payload = await provider._rpc('files/list_folder', {
      path: location.path, recursive: true, include_deleted: false,
      include_has_explicit_shared_members: false, include_mounted_folders: true,
    }, location);
    while (true) {
      for (const entry of (payload.entries || [])) {
        if (entry['.tag'] !== 'file' && entry['.tag'] !== 'folder') continue;
        const path = provider._relativeFromDropboxPath(entry.path_display || entry.path_lower || '', sourceId);
        pathBytes += new TextEncoder().encode(path).byteLength;
        if (rows.length >= maxEntries || pathBytes > maxPathBytes) {
          throw Object.assign(new Error('フォルダの確認上限を超えました'), { status: 503 });
        }
        const modified = entry.server_modified || entry.client_modified || '';
        rows.push({ path, kind: entry['.tag'] === 'folder' ? 'directory' : 'file',
          size: Number(entry.size || 0), modified, modifiedMs: _modifiedMs(modified), meta: entry });
      }
      if (!payload.has_more || !payload.cursor) break;
      payload = await provider._rpc('files/list_folder/continue', { cursor: payload.cursor }, location);
    }
    return rows;
  }

  function _parseJson(value) {
    try { return JSON.parse(String(value || '')); } catch (_) { return {}; }
  }

  async function readDropboxTextBounded(provider, relativePath, maxBytes) {
    const normalized = _normalize(relativePath);
    const location = provider._dropboxLocation(normalized);
    const metadata = () => provider._rpc('files/get_metadata', {
      path: location.path, include_deleted: false, include_has_explicit_shared_members: false,
    }, location);
    const before = await metadata();
    if (!Number.isFinite(maxBytes) || maxBytes < 0 || Number(before?.size || 0) > maxBytes) {
      throw Object.assign(new Error('参照影響の読取上限を超えました'), { status: 503 });
    }
    const response = await provider._content('files/download', { path: location.path }, undefined, location);
    const downloaded = _parseJson(response.headers.get('dropbox-api-result'));
    const reader = response.body?.getReader?.();
    if (!reader) throw Object.assign(new Error('Dropboxのbounded読込を利用できません'), { status: 503 });
    const decoder = new TextDecoder();
    let total = 0, text = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw Object.assign(new Error('参照影響の読取上限を超えました'), { status: 503 });
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const after = await metadata();
    if (!before?.rev || before.rev !== downloaded.rev || before.rev !== after?.rev) {
      throw Object.assign(new Error('Dropboxファイルの読込中に内容が変わりました'), { status: 409, meldexCode: 'etag_conflict' });
    }
    provider._rememberMeta(normalized, after);
    return text;
  }

  const contract = window.MeldexStorageDeleteConfirmationFresh = Object.freeze({
    statDropbox, walkDropbox, readDropboxTextBounded,
  });
  const prototype = window.MeldexStorageAdapter?.DropboxStorageProvider?.prototype;
  if (!prototype) throw new Error('DropboxStorageProvider is not loaded');
  prototype.statPathFresh = function (path) { return contract.statDropbox(this, path); };
  prototype.walkEntriesFresh = function (path, limits) { return contract.walkDropbox(this, path, limits); };
  prototype.readTextBounded = function (path, maxBytes) { return contract.readDropboxTextBounded(this, path, maxBytes); };
})();
