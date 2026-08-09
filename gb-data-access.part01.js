(function () {
  const NOT_HANDLED = Symbol('NOT_HANDLED');
  const TEAM_CACHE_KEY = 'meldex-cloud-team-avatar-cache';
  const PWA_ROOTS_KEY = 'meldex-cloud-outliner-roots';
  const PWA_HOME_KEY = 'meldex-cloud-home-folder';
  const PWA_UI_CONFIG_KEY = 'meldex-cloud-ui-config';
  const PWA_FOLDER_LINKS_KEY = 'meldex-cloud-folder-links';
  const PWA_FOLDER_LINKS_FILE = '_meldex/folder-links.json';
  const FOLDER_LINKS_DOCUMENT_ID = 'cloud-folder-links';
  const PWA_TRASH_DIR = '_trash';
  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.avif']);
  const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv', '.ogv']);
  const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac']);
  const TEXT_EXTS = new Set(['.md', '.json', '.txt', '.csv', '.html', '.htm', '.js', '.css']);
  const ALL_FILE_EXT_TYPES = {
    '.psd': 'psd', '.psb': 'psd', '.ai': 'psd',
    '.clip': 'clip', '.lip': 'clip', '.csp': 'clip',
    '.xcf': 'image',
    '.blend': '3d', '.obj': '3d', '.fbx': '3d', '.gltf': '3d', '.glb': '3d', '.stl': '3d',
    '.3ds': '3d', '.dae': '3d', '.ply': '3d',
    '.pdf': 'document', '.docx': 'document', '.doc': 'document',
    '.xlsx': 'document', '.xls': 'document', '.pptx': 'document', '.ppt': 'document',
    '.txt': 'document', '.rtf': 'document',
    '.zip': 'archive', '.rar': 'archive', '.7z': 'archive', '.tar': 'archive', '.gz': 'archive',
    '.exe': 'app', '.msi': 'app', '.bat': 'app', '.sh': 'app', '.py': 'app',
  };
  const WORKSPACE_SCAN_EXCLUDE_PREFIXES = ['.', '_chat/', '_backup/', '_trash/', '_versions/', '_meldex/', '_meldex_pwa/', 'node_modules/'];

  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _resource() {
    return window.MeldexResourceUrl;
  }

  function _storage() {
    return window.MeldexStorageAdapter;
  }

  function _safeReadJson(key, fallbackValue) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallbackValue;
      return JSON.parse(raw);
    } catch {
      return fallbackValue;
    }
  }

  function _safeWriteJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  }

  function _normalizeFolderPath(path) {
    const normalized = _normalizePath(path);
    return normalized === '.' ? '' : normalized;
  }

  function _joinPath() {
    return Array.from(arguments)
      .map((part) => _normalizeFolderPath(part))
      .filter(Boolean)
      .join('/');
  }

  function _dirname(path) {
    const normalized = _normalizeFolderPath(path);
    if (!normalized.includes('/')) return '';
    return normalized.slice(0, normalized.lastIndexOf('/'));
  }

  function _basename(path) {
    const normalized = _normalizeFolderPath(path);
    if (!normalized) return '';
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(index + 1) : normalized;
  }

  function _splitNameAndExt(name) {
    const safeName = String(name || '');
    const lower = safeName.toLowerCase();
    if (lower.endsWith('.mel-board')) return { stem: safeName.slice(0, -10), ext: '.mel-board' };
    if (lower.endsWith('.mel-sheet')) return { stem: safeName.slice(0, -10), ext: '.mel-sheet' };
    if (lower.endsWith('.mel-scenario')) return { stem: safeName.slice(0, -13), ext: '.mel-scenario' };
    if (lower.endsWith('.mel-timer')) return { stem: safeName.slice(0, -10), ext: '.mel-timer' };
    if (lower.endsWith('.scriptnote.json')) return { stem: safeName.slice(0, -16), ext: '.scriptnote.json' };
    if (lower.endsWith('.smart-db.json')) return { stem: safeName.slice(0, -14), ext: '.smart-db.json' };
    if (lower.endsWith('.timer.json')) return { stem: safeName.slice(0, -11), ext: '.timer.json' };
    const index = safeName.lastIndexOf('.');
    if (index <= 0) return { stem: safeName, ext: '' };
    return { stem: safeName.slice(0, index), ext: safeName.slice(index) };
  }

  function _pathMatches(path, targetPath, isFolder) {
    const normalizedPath = _normalizeFolderPath(path);
    const normalizedTarget = _normalizeFolderPath(targetPath);
    if (!normalizedTarget) return false;
    if (normalizedPath === normalizedTarget) return true;
    return !!isFolder && normalizedPath.startsWith(normalizedTarget + '/');
  }

  function _rewritePath(path, oldPath, newPath, isFolder) {
    const normalized = _normalizeFolderPath(path);
    const normalizedOld = _normalizeFolderPath(oldPath);
    const normalizedNew = _normalizeFolderPath(newPath);
    if (!normalized || !normalizedOld) return normalized;
    if (normalized === normalizedOld) return normalizedNew;
    if (isFolder && normalized.startsWith(normalizedOld + '/')) return normalizedNew + normalized.slice(normalizedOld.length);
    return normalized;
  }

  function _boolParam(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  function _displayLabelForPath(path, type) {
    const name = _basename(path);
    if (!name) return '';
    const split = _splitNameAndExt(name);
    if (type === 'image' || type === 'video' || type === 'audio' || type === 'html' || type === 'unknown' || type === 'document' || type === 'archive' || type === 'app' || type === 'psd' || type === 'clip' || type === '3d') return name;
    if (type === 'csv') return split.stem || name;
    return split.stem || name;
  }

  function _fallbackOsTypeLabel(name, type, isDirectory) {
    if (isDirectory) return 'フォルダ';
    const ext = _splitNameAndExt(name).ext.toLowerCase();
    const labels = {
      '.ps1': 'Windows PowerShell スクリプト',
      '.py': 'Python ソース ファイル',
      '.json': 'JSON ソース ファイル',
      '.js': 'JavaScript ファイル',
      '.css': 'CSS ファイル',
      '.html': 'HTML ドキュメント',
      '.htm': 'HTML ドキュメント',
      '.md': 'Markdown ファイル',
      '.txt': 'テキスト ドキュメント',
      '.csv': 'CSV ファイル',
      '.xlsx': 'Microsoft Excel ワークシート',
      '.xls': 'Microsoft Excel ワークシート',
      '.zip': '圧縮フォルダー',
      '.png': 'PNG ファイル',
      '.jpg': 'JPG ファイル',
      '.jpeg': 'JPEG ファイル',
      '.gif': 'GIF ファイル',
      '.webp': 'WEBP ファイル',
      '.svg': 'SVG ファイル',
      '.blend': 'BLEND ファイル',
    };
    const appLabel = typeof FILE_TYPE_LABELS !== 'undefined' ? FILE_TYPE_LABELS?.[type] : '';
    return labels[ext] || (ext ? ext.slice(1).toUpperCase() + ' ファイル' : (appLabel || 'ファイル'));
  }

  function _phase1SurfaceType(type, kind) {
    const normalized = String(type || '').trim();
    return normalized;
  }

  function _extractFrontmatter(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(text || ''));
    return match ? match[1] : '';
  }

  function _extractFrontmatterType(text) {
    const block = _extractFrontmatter(text);
    if (!block) return '';
    const match = /^\s*type\s*:\s*([^\r\n#]+)/m.exec(block);
    return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
  }

  function _isTextLikePath(path) {
    const ext = _splitNameAndExt(_basename(path)).ext.toLowerCase();
    return TEXT_EXTS.has(ext) || ['.mel-board', '.mel-sheet', '.mel-scenario', '.mel-timer'].includes(ext)
      || path.toLowerCase().endsWith('.scriptnote.json') || path.toLowerCase().endsWith('.smart-db.json') || path.toLowerCase().endsWith('.timer.json');
  }

  function _isExcludedWorkspacePath(path) {
    const normalized = _normalizeFolderPath(path);
    if (!normalized) return false;
    const parsedSource = window.MeldexSourceFolderRegistry?.parseSourcePath?.(normalized);
    const relative = _normalizeFolderPath(parsedSource?.relativePath ?? normalized);
    if (!relative) return false;
    return WORKSPACE_SCAN_EXCLUDE_PREFIXES.some((prefix) => relative === prefix.replace(/\/$/, '') || relative.startsWith(prefix));
  }

  function _jsonHeaders(headers) {
    return { 'Content-Type': 'application/json', ...(headers || {}) };
  }

  function _requestMethod(opts) {
    return String(opts?.method || 'GET').toUpperCase();
  }

  function _summarizePayload(body) {
    if (body == null || body === '') return '';
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        return Array.isArray(parsed) ? `array(${parsed.length})` : Object.keys(parsed || {}).sort().join(',');
      } catch {
        return String(body).slice(0, 120);
      }
    }
    if (Array.isArray(body)) return `array(${body.length})`;
    if (typeof body === 'object') return Object.keys(body).sort().join(',');
    return String(body).slice(0, 120);
  }

  function _logCompare(entry) {
    _runtime()?.recordCompareLog?.(entry);
  }

  function _appendUserToUrl(url) {
    try {
      const user = typeof getUsername === 'function' ? getUsername() : '';
      if (user && user !== 'anonymous') url.searchParams.set('_user', user);
    } catch {}
    return url;
  }

  async function _legacyJsonRequest(path, opts) {
    const requestOpts = { ...(opts || {}) };
    const url = new URL(_resource().apiUrl(path), document.baseURI || window.location.href);
    _appendUserToUrl(url);
    if (requestOpts.body && typeof requestOpts.body !== 'string') {
      requestOpts.headers = _jsonHeaders(requestOpts.headers);
      requestOpts.body = JSON.stringify(requestOpts.body);
    }
    const response = await fetch(url.toString(), requestOpts);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response.json();
  }

  function _teamCache() {
    return _safeReadJson(TEAM_CACHE_KEY, {});
  }

  function _cacheTeamAvatar(name, avatar, folder) {
    if (!name) return;
    const cache = _teamCache();
    const folderKey = folder ? folder + '::' + name : '';
    if (!avatar) {
      if (folderKey) delete cache[folderKey];
      else delete cache[name];
      _safeWriteJson(TEAM_CACHE_KEY, cache);
      return;
    }
    if (folderKey) cache[folderKey] = avatar;
    else cache[name] = avatar;
    _safeWriteJson(TEAM_CACHE_KEY, cache);
  }

  function _cachedTeamAvatar(name, folder) {
    const cache = _teamCache();
    if (folder) return cache[folder + '::' + name] || '';
    if (cache[name]) return cache[name];
    if (name && typeof getUsername === 'function' && getUsername() === name) return localStorage.getItem('meldex-avatar') || '';
    return '';
  }

  function _avatarFallbackUrl(name) {
    const rawName = String(name || '').trim() || 'anonymous';
    let hash = 0;
    for (let index = 0; index < rawName.length; index += 1) {
      hash = ((hash << 5) - hash + rawName.charCodeAt(index)) | 0;
    }
    const hue = Math.abs(hash) % 360;
    const label = (rawName.charAt(0).toUpperCase() || '?')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="hsl(${hue},38%,36%)"/><text x="32" y="40" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="28" font-weight="700" fill="#f4f4f5">${label}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  async function _pwaProvider() {
    const storage = _storage();
    if (!storage || typeof storage.getProvider !== 'function') return null;
    const provider = storage.getProvider();
    await provider.restoreWorkspace();
    return provider;
  }

  async function _managementAdapter(provider, kind) {
    if (_runtime()?.isBrowserMode?.() && typeof provider?.getSystemStorageAdapter === 'function') {
      return provider.getSystemStorageAdapter();
    }
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!provider || !resolver?.resolveTypedAdapterForProvider) {
      throw new Error('管理データの保存先を安全に判定できません');
    }
    return resolver.resolveTypedAdapterForProvider(provider, kind);
  }

  async function _readManagementPayload(provider, kind, documentId) {
    const adapter = await _managementAdapter(provider, kind);
    const record = await adapter.load(kind, documentId);
    return { adapter, record, payload: record?.payload || null };
  }

  async function _writeManagementPayload(provider, kind, documentId, updater, retries = 5) {
    const adapter = await _managementAdapter(provider, kind);
    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const current = await adapter.load(kind, documentId);
      const next = updater(current?.payload || null);
      try {
        return await adapter.save(kind, documentId, next, {
          expectedRevision: current?.revision ?? null,
        });
      } catch (error) {
        lastError = error;
        if (error?.name !== 'SystemStorageConflictError' && error?.code !== 'system_storage_conflict') throw error;
      }
    }
    throw lastError;
  }

  async function _pwaWorkspaceDescriptor() {
    const provider = await _pwaProvider();
    const info = provider ? await provider.getWorkspaceInfo() : { connected: false, name: '', path: '' };
    if (!info.connected) return { path: '', name: '' };
    const current = _runtime()?.getWorkspaceState?.() || {};
    _runtime()?.setWorkspaceState?.({
      ...current,
      kind: _runtime()?.isBrowserMode?.() ? 'browser' : 'dropbox',
      name: info.name || current.name || '',
      path: info.path || current.path || '',
      access: current.access || (info.permission === 'readonly' ? 'viewer' : 'editor'),
    });
    return { path: info.path || '', name: info.name || '' };
  }

  async function _pwaRoots() {
    const workspace = await _pwaWorkspaceDescriptor();
    if (!workspace.name && !workspace.path) return [];
    const registry = window.MeldexSourceFolderRegistry;
    if (registry?.loadOutlinerRoots) {
      try {
        const roots = await registry.loadOutlinerRoots();
        if (Array.isArray(roots) && roots.length > 0) return roots;
      } catch {}
    }
    const stored = _safeReadJson(PWA_ROOTS_KEY, null);
    if (Array.isArray(stored) && stored.length > 0) return stored;
    return [{ path: '.', name: workspace.name || 'vault', visible: true }];
  }

  async function _setPwaRoots(roots) {
    // ワークスペード由来（origin: 'ws:...'）のエントリは、個人のアカウント台帳
    // （source-folders.v1.json）へ絶対に書き込んではならない。ここが全ての
    // PUT /outliner-roots 呼び出しの合流点なので、clean マッピングへ渡す前に除外する。
    const accountRoots = (Array.isArray(roots) ? roots : []).filter(
      (root) => !(typeof root?.origin === 'string' && root.origin.startsWith('ws:'))
    );
    const clean = accountRoots.map((root) => ({
      path: String(root?.path || '.'),
      id: root?.id || root?.sourceId || undefined,
      sourceId: root?.sourceId || root?.id || undefined,
      provider: root?.provider || undefined,
      dropboxPath: root?.dropboxPath || undefined,
      // namespaceKind省略時の巻き戻り防止（meldex_path_scope_fullwidth_plan_2026-07-31.md
      // 第2層タスク1対応）: ここは PUT /outliner-roots 呼び出しの合流点であり、
      // このフィールドを落とすと team_root で正しく登録済みのフォルダも、設定
      // ダイアログでの無関係な保存操作（改名・表示切替等）のたびに台帳へ
      // namespaceKind無し（=home扱い）で書き戻され続けてしまう。
      namespaceKind: root?.namespaceKind || undefined,
      name: String(root?.name || root?.path || '.'),
      visible: root?.visible !== false,
    }));
    const registry = window.MeldexSourceFolderRegistry;
    if (registry?.saveOutlinerRoots && (clean.length === 0 || clean.some((root) => root.provider === 'dropbox' || root.dropboxPath))) {
      await registry.saveOutlinerRoots(clean);
    }
    _safeWriteJson(PWA_ROOTS_KEY, clean);
    return { ok: true };
  }

  // デスクトップ版（配布物）と同じ「はじめから入っているフォルダ」の閲覧専用扱い。
  // Meldex.part01.part01.py の BUILTIN_LOCKED_HOME_FOLDERS と同じ内容を保つこと。
  // クラウド版はここが空のままだったため、マニュアルが編集可能な状態になり、
  // 起動直後に自動で開くクイックスタートが無編集のまま保存を試みて失敗し、
  // 未保存ドラフトと競合エラーが毎回出ていた。
  const BUILTIN_LOCKED_HOME_FOLDER_NAMES = ['マニュアル', 'サンプル'];

  function _builtinHomeLocks(homePath) {
    const base = _normalizeFolderPath(homePath);
    if (!base) return { locked_folders: [], locked_paths: [] };
    const folders = BUILTIN_LOCKED_HOME_FOLDER_NAMES.map(name => ({ name, path: _joinPath(base, name) }));
    return { locked_folders: folders, locked_paths: folders.map(item => item.path) };
  }

  async function _pwaHomeFolder() {
    const provider = await _pwaProvider();
    const stored = _safeReadJson(PWA_HOME_KEY, null);
    if (stored?.path) {
      // 保存済みの値には古い（空の）ロック一覧が残っていることがあるため、
      // ロックは常にその場で組み立て直す。
      const locks = _builtinHomeLocks(stored.path);
      try {
        if (provider) await provider.getDirectoryHandle(stored.path, false);
        return { ...stored, ...locks, exists: true };
      } catch {
        return { ...stored, ...locks, exists: false };
      }
    }
    try {
      if (provider) {
        await provider.getDirectoryHandle('MeldexHome', false);
        return { path: 'MeldexHome', name: 'MeldexHome', exists: true, ..._builtinHomeLocks('MeldexHome') };
      }
    } catch {}
    return { path: '', name: '', exists: false, locked_folders: [], locked_paths: [] };
  }

  async function _readTeamFile(folderPath) {
    const provider = await _pwaProvider();
    if (!provider || !await provider.ensureWorkspacePermission('read')) return { members: {} };
    const relativeFolder = _normalizeFolderPath(folderPath);
    const relativeFile = relativeFolder ? (relativeFolder + '/_Meldex_team.json') : '_Meldex_team.json';
    const entry = await _resolveEntryHandle(provider, relativeFile);
    if (!entry) return { members: {} };
    if (entry.kind !== 'file') throw new Error('_Meldex_team.json がファイルではありません');
    const team = await provider.readJson(relativeFile);
    if (!team || typeof team !== 'object' || Array.isArray(team)) throw new Error('_Meldex_team.json を読み込めません');
    if (!team.members || typeof team.members !== 'object' || Array.isArray(team.members)) throw new Error('_Meldex_team.json の members が不正です');
    return team;
  }

  function _toTeamPayload(team) {
    return Object.entries(team?.members || {}).map(([name, info]) => ({
      name,
      accountId: info?.accountId || '',
      has_avatar: !!info?.avatar,
      last_seen: info?.last_seen || '',
      role: info?.role || 'editor',
    }));
  }

  function _fnvFileId(path) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(String(path || ''));
    let hash = 0xcbf29ce484222325n;
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, '0');
  }

  function _normalizeFolderLinks(raw) {
    return Array.isArray(raw) ? raw.map((link) => ({
      file_id: String(link?.file_id || ''),
      path: _normalizeFolderPath(link?.path || ''),
      name: String(link?.name || ''),
      folder_path: _normalizeFolderPath(link?.folder_path || ''),
      folder_id: String(link?.folder_id || ''),
      added_at: String(link?.added_at || ''),
    })).filter((link) => link.path && link.folder_path) : [];
  }

  function _folderLinksStore() {
    return _normalizeFolderLinks(_safeReadJson(PWA_FOLDER_LINKS_KEY, []));
  }

  function _writeFolderLinksStore(links) {
    _safeWriteJson(PWA_FOLDER_LINKS_KEY, _normalizeFolderLinks(links));
  }

  async function _readFolderLinks(provider) {
    let persisted = null;
    if (provider) {
      const kind = window.MeldexSystemStorage?.SystemStorageKind?.FOLDER_ASSOCIATIONS;
      if (!kind) throw new Error('フォルダ関連付けの管理データ契約が未初期化です');
      const managed = await _readManagementPayload(provider, kind, FOLDER_LINKS_DOCUMENT_ID);
      persisted = managed.payload;
      // 旧付随物は移行期間中の読取専用fallback。新規・更新書込は必ず管理領域へ行う。
      if (!persisted) persisted = await _readJsonSafe(provider, PWA_FOLDER_LINKS_FILE, null);
    }
    const raw = Array.isArray(persisted) ? persisted : (Array.isArray(persisted?.links) ? persisted.links : null);
    if (raw) {
      const links = _normalizeFolderLinks(raw);
      _writeFolderLinksStore(links);
      return links;
    }
    return _folderLinksStore();
  }

  async function _writeFolderLinks(provider, links) {
    const normalized = _normalizeFolderLinks(links);
    _writeFolderLinksStore(normalized);
    if (provider) {
      const kind = window.MeldexSystemStorage?.SystemStorageKind?.FOLDER_ASSOCIATIONS;
      if (!kind) throw new Error('フォルダ関連付けの管理データ契約が未初期化です');
      await _writeManagementPayload(provider, kind, FOLDER_LINKS_DOCUMENT_ID, () => ({
          version: 1,
          updated_at: new Date().toISOString(),
          links: normalized,
        }), 1);
    }
    return normalized;
  }

  function assertCloudWriteAllowed(mode) {
    if ((mode || 'read') !== 'readwrite') return;
    const state = _runtime()?.getWorkspaceState?.() || {};
    const access = String(state.access || state.role || '').toLowerCase();
    if (access === 'viewer' || document.body?.dataset?.cloudReadonly === '1') {
      throw new Error('閲覧専用モードのため書き込めません');
    }
  }

  async function _requirePwaProvider(mode) {
    const provider = await _pwaProvider();
    if (!provider) throw new Error('保存先を利用できません');
    assertCloudWriteAllowed(mode || 'read');
    const granted = await provider.ensureWorkspacePermission(mode || 'read');
    if (!granted && (mode || 'read') === 'readwrite' && document.body?.dataset?.cloudQuotaBlocked === '1') {
      throw new Error('Dropbox 容量が95%を超えているため書き込みを停止しています。空き容量を確保してから再開してください');
    }
    if (!granted) throw new Error((mode || 'read') === 'readwrite' ? '閲覧専用モードのため書き込めません' : '保存先の読み取り権限がありません');
    return provider;
  }

  async function _workspaceHandle(provider) {
    const handle = provider ? await provider.restoreWorkspace() : null;
    if (!handle) throw new Error('保存先を利用できません');
    return handle;
  }

  async function _directoryHandle(provider, relativePath, create) {
    const normalized = _normalizeFolderPath(relativePath);
    if (!normalized) return _workspaceHandle(provider);
    return provider.getDirectoryHandle(normalized, { create: !!create });
  }

  async function _fileHandle(provider, relativePath, create) {
    const normalized = _normalizeFolderPath(relativePath);
    if (!normalized) throw new Error('ファイルパスが不正です');
    return provider.getFileHandle(normalized, { create: !!create });
  }

  async function _resolveEntryHandle(provider, relativePath) {
    const normalized = _normalizeFolderPath(relativePath);
    if (!normalized) return { kind: 'directory', handle: await _workspaceHandle(provider), path: '' };
    try {
      return { kind: 'directory', handle: await provider.getDirectoryHandle(normalized, { create: false }), path: normalized };
    } catch {}
    try {
      return { kind: 'file', handle: await provider.getFileHandle(normalized, { create: false }), path: normalized };
    } catch {}
    return null;
  }

  async function _listDirectoryEntries(provider, relativePath) {
    const dirHandle = await _directoryHandle(provider, relativePath, false);
    const entries = [];
    for await (const [name, handle] of dirHandle.entries()) {
      entries.push({ name, handle, path: handle?.path || '' });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name, 'ja', { sensitivity: 'base' }));
  }

  async function _readTextSafe(provider, relativePath, fallbackValue) {
    try {
      return await provider.readText(_normalizeFolderPath(relativePath));
    } catch {
      return fallbackValue == null ? '' : fallbackValue;
    }
  }

  async function _readJsonSafe(provider, relativePath, fallbackValue) {
    try {
      return await provider.readJson(_normalizeFolderPath(relativePath), fallbackValue);
    } catch {
      return fallbackValue;
    }
  }

  async function _fileStats(fileHandle) {
    const file = await fileHandle.getFile();
    return {
      size: Number(file.size || 0),
      created: file.lastModified ? new Date(file.lastModified).toISOString() : '',
      modified: file.lastModified ? new Date(file.lastModified).toISOString() : '',
      modifiedMs: Number(file.lastModified || 0),
      file,
    };
  }

  function _validateItemName(name, field) {
    const value = String(name || '').trim();
    if (!value) throw new Error(`${field || 'name'} は必須です`);
    if (value === '.' || value === '..' || value.includes('..') || value.includes('/') || value.includes('\\')) throw new Error(`不正な${field || 'name'}です`);
    if (/[<>:"|?*\x00-\x1f]/.test(value)) throw new Error(`不正な${field || 'name'}です`);
    return value;
  }

  async function _pathExists(provider, relativePath) {
    return !!(await _resolveEntryHandle(provider, relativePath));
  }

  async function _uniqueName(provider, baseDirPath, name, ext) {
    const baseDir = _normalizeFolderPath(baseDirPath);
    const safeName = String(name || '');
    const suffix = String(ext || '');
    const firstPath = _joinPath(baseDir, safeName + suffix);
    if (!await _pathExists(provider, firstPath)) return safeName;
    for (let index = 2; index < 10000; index += 1) {
      const candidate = `${safeName} ${index}`;
      if (!await _pathExists(provider, _joinPath(baseDir, candidate + suffix))) return candidate;
    }
    return `${safeName}_${Date.now()}`;
  }

  async function _moveConflictName(provider, destFolder, entryName, isFile) {
    const split = _splitNameAndExt(entryName);
    const baseName = isFile ? split.stem : entryName;
    const ext = isFile ? split.ext : '';
    let candidate = _joinPath(destFolder, isFile ? (baseName + ext) : baseName);
    if (!await _pathExists(provider, candidate)) return { path: candidate, name: isFile ? baseName : baseName };
    for (let index = 1; index < 10000; index += 1) {
      const nextBase = `${baseName}_${String(index).padStart(4, '0')}`;
      candidate = _joinPath(destFolder, nextBase + ext);
      if (!await _pathExists(provider, candidate)) return { path: candidate, name: nextBase };
    }
    const fallback = `${baseName}_${Date.now()}`;
    return { path: _joinPath(destFolder, fallback + ext), name: fallback };
  }

  async function _writeBytes(provider, relativePath, bytes) {
    const fileHandle = await _fileHandle(provider, relativePath, true);
    const writable = await fileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }

  function _base64ToBytes(base64Text) {
    const decoded = atob(base64Text);
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  }

  function _decodeUploadData(dataValue) {
    const raw = String(dataValue || '');
    const match = /^data:[^;]+;base64,([\s\S]+)$/i.exec(raw);
    if (match) return _base64ToBytes(match[1]);
    return new TextEncoder().encode(raw);
  }

  async function _copyEntryHandle(sourceHandle, targetDirHandle, targetName) {
    if (sourceHandle.kind === 'file') {
      const sourceFile = await sourceHandle.getFile();
      const targetFile = await targetDirHandle.getFileHandle(targetName, { create: true });
      const writable = await targetFile.createWritable();
      await writable.write(await sourceFile.arrayBuffer());
      await writable.close();
      return;
    }
    const childDir = await targetDirHandle.getDirectoryHandle(targetName, { create: true });
    for await (const [childName, childHandle] of sourceHandle.entries()) {
      await _copyEntryHandle(childHandle, childDir, childName);
    }
  }

  async function _removeEntry(provider, relativePath) {
    const normalized = _normalizeFolderPath(relativePath);
    if (!normalized) throw new Error('Dropbox 共有フォルダルートは削除できません');
    const parentPath = _dirname(normalized);
    const entryName = _basename(normalized);
    const parentHandle = await _directoryHandle(provider, parentPath, false);
    await parentHandle.removeEntry(entryName, { recursive: true });
  }

  async function _moveEntry(provider, oldPath, newPath) {
    await provider.movePath(oldPath, newPath);
    const moved = await _resolveEntryHandle(provider, newPath);
    return moved?.kind || 'file';
  }

  async function _classifyDirectoryType(provider, relativePath) {
    const normalized = _normalizeFolderPath(relativePath);
    const folderName = _basename(normalized);
    if (folderName) {
      const folderNote = _joinPath(normalized, folderName + '.md');
      const folderType = _extractFrontmatterType(await _readTextSafe(provider, folderNote, ''));
      if (folderType === 'calendar-db') return _phase1SurfaceType('calendar', 'directory');
      if (folderType === 'settings-db') return _phase1SurfaceType('database', 'directory');
    }
    const entries = await _listDirectoryEntries(provider, normalized);
    for (const entry of entries) {
      if (entry.handle.kind !== 'file' || !entry.name.endsWith('.md')) continue;
      if (entry.name.startsWith('.') || entry.name.startsWith('_') || entry.name === folderName + '.md') continue;
      const entryPath = _joinPath(normalized, entry.name);
      const entryType = _extractFrontmatterType(await _readTextSafe(provider, entryPath, ''));
      if (entryType === 'settings-entry') return _phase1SurfaceType('database', 'directory');
    }
    return 'folder';
  }

  async function _classifyFileType(provider, relativePath, options) {
    const safeOptions = options || {};
    const name = _basename(relativePath);
    const lowerName = name.toLowerCase();
    const ext = _splitNameAndExt(name).ext.toLowerCase();
    if (ext === '.mel-board') return _phase1SurfaceType('board', 'file');
    if (ext === '.mel-sheet') return _phase1SurfaceType('smart-db', 'file');
    if (ext === '.mel-scenario') return 'scriptnote';
    if (ext === '.mel-timer') return 'timer';
    if (ext === '.md') {
      if (lowerName.endsWith('.board.md')) return _phase1SurfaceType('board', 'file');
      const frontmatterType = _extractFrontmatterType(await _readTextSafe(provider, relativePath, ''));
      if (frontmatterType === 'board') return _phase1SurfaceType('board', 'file');
      if (frontmatterType === 'chat') return _phase1SurfaceType('chat', 'file');
      return 'page';
    }
    if (ext === '.json' || lowerName.endsWith('.scriptnote.json') || lowerName.endsWith('.smart-db.json') || lowerName.endsWith('.timer.json')) {
      if (lowerName.endsWith('.scriptnote.json')) return 'scriptnote';
      if (lowerName.endsWith('.scenario.json')) return 'scenario';
      if (lowerName.endsWith('.smart-db.json')) return _phase1SurfaceType('smart-db', 'file');
      if (lowerName.endsWith('.timer.json')) return 'timer';
      const parsed = await _readJsonSafe(provider, relativePath, null);
      if (parsed && typeof parsed === 'object') {
        if (parsed.fileType === 'meldex-scriptnote') return 'scriptnote';
        if (parsed.fileType === 'meldex-scenario' || parsed.type === 'scenario') return 'scenario';
        if (parsed.type === 'smart-db') return _phase1SurfaceType('smart-db', 'file');
        if (parsed.type === 'meldex-timer') return 'timer';
        if (!parsed.fileType && !parsed.type && Object.prototype.hasOwnProperty.call(parsed, 'title')) return 'scenario';
      }
      return 'unknown';
    }
    if (IMAGE_EXTS.has(ext)) return 'image';
    if (VIDEO_EXTS.has(ext)) return 'video';
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (ext === '.html' || ext === '.htm') return 'html';
    if (ext === '.csv') return 'csv';
    if (safeOptions.allFiles) return ALL_FILE_EXT_TYPES[ext] || 'unknown';
    return '';
  }

  async function _buildBrowseItem(provider, relativePath, handle, options) {
    const safeOptions = options || {};
    const name = _basename(relativePath);
    if (!name || name.startsWith('.') || name.startsWith('_')) return null;
    const sourceId = window.MeldexSourceFolderRegistry?.parseSourcePath?.(relativePath)?.sourceId || '';
    if (handle.kind === 'directory') {
      const type = safeOptions.classifyDirectories
        ? (await _classifyDirectoryType(provider, relativePath).catch(() => 'folder')) || 'folder'
        : 'folder';
      const folderItem = { name, type, path: _normalizeFolderPath(relativePath), sourceId: sourceId || undefined, file_id: _fnvFileId(_normalizeFolderPath(relativePath)) };
      if (safeOptions.detail) folderItem.os_type = _fallbackOsTypeLabel(name, type, true);
      return folderItem;
    }
    const fileType = await _classifyFileType(provider, relativePath, { forBrowse: true, allFiles: !!safeOptions.allFiles });
    if (!fileType) return null;
    const item = {
      name: _displayLabelForPath(relativePath, fileType),
      type: fileType,
      path: _normalizeFolderPath(relativePath),
      sourceId: sourceId || undefined,
      file_id: _fnvFileId(_normalizeFolderPath(relativePath)),
    };
    if (safeOptions.allFiles && fileType === 'unknown') {
      item.ext = _splitNameAndExt(name).ext.toLowerCase();
      item.name = name;
    }
    if (safeOptions.detail) {
      const stats = await _fileStats(handle);
      item.size = stats.size;
      item.created = stats.created || stats.modified;
      item.modified = stats.modified;
      item._modifiedMs = stats.modifiedMs;
      item.os_type = _fallbackOsTypeLabel(name, fileType, false);
    }
    return item;
  }

  function _sortBrowseItems(items, sort, order) {
    const reverse = String(order || 'asc').toLowerCase() === 'desc';
    const sortKey = String(sort || 'name').toLowerCase();
    const rows = [...items];
    rows.sort((a, b) => {
      if (sortKey === 'modified' || sortKey === 'created') {
        const timeDiff = Number(a._modifiedMs || 0) - Number(b._modifiedMs || 0);
        if (timeDiff !== 0) return reverse ? -timeDiff : timeDiff;
      }
      const nameDiff = String(a.name || '').localeCompare(String(b.name || ''), 'ja', { sensitivity: 'base' });
      return reverse ? -nameDiff : nameDiff;
    });
    return rows;
  }

  function _linkedItemsForFolder(folderPath, links) {
    const normalizedFolder = _normalizeFolderPath(folderPath);
    return _normalizeFolderLinks(links || _folderLinksStore()).filter((link) => link.folder_path === normalizedFolder).map((link) => ({
      file_id: link.file_id || _fnvFileId(link.path),
      path: link.path,
      name: _displayLabelForPath(link.path, ''),
      linked: true,
    }));
  }

  function _rewriteStoredPaths(oldPath, newPath, isFolder) {
    const roots = _safeReadJson(PWA_ROOTS_KEY, []);
    if (Array.isArray(roots) && roots.length > 0) {
      const nextRoots = roots.map((root) => ({ ...root, path: _rewritePath(root?.path || '.', oldPath, newPath, isFolder) || '.' }));
      _safeWriteJson(PWA_ROOTS_KEY, nextRoots);
    }
    const homeFolder = _safeReadJson(PWA_HOME_KEY, null);
    if (homeFolder?.path) {
      const rewritten = _rewritePath(homeFolder.path, oldPath, newPath, isFolder);
      if (rewritten !== _normalizeFolderPath(homeFolder.path)) _safeWriteJson(PWA_HOME_KEY, { ...homeFolder, path: rewritten, name: _basename(rewritten) || homeFolder.name || '' });
    }
    const links = _folderLinksStore();
    if (links.length > 0) {
      const nextLinks = links.map((link) => {
        const nextPath = _rewritePath(link.path, oldPath, newPath, isFolder);
        const nextFolderPath = _rewritePath(link.folder_path, oldPath, newPath, isFolder);
        return {
          ...link,
          path: nextPath,
          folder_path: nextFolderPath,
          file_id: _fnvFileId(nextPath),
          folder_id: _fnvFileId(nextFolderPath),
          name: _displayLabelForPath(nextPath, ''),
        };
      }).filter((link) => link.path && link.folder_path);
      _writeFolderLinksStore(nextLinks);
    }
  }

  async function _rewriteStoredPathsForProvider(provider, oldPath, newPath, isFolder) {
    _rewriteStoredPaths(oldPath, newPath, isFolder);
    if (!provider) return;
    const links = await _readFolderLinks(provider);
    if (!links.length) return;
    const nextLinks = links.map((link) => {
      const nextPath = _rewritePath(link.path, oldPath, newPath, isFolder);
      const nextFolderPath = _rewritePath(link.folder_path, oldPath, newPath, isFolder);
      return {
        ...link,
        path: nextPath,
        folder_path: nextFolderPath,
        file_id: _fnvFileId(nextPath),
        folder_id: _fnvFileId(nextFolderPath),
        name: _displayLabelForPath(nextPath, ''),
      };
    }).filter((link) => link.path && link.folder_path);
    await _writeFolderLinks(provider, nextLinks);
  }

  function _removeStoredPathEntries(targetPath, isFolder) {
    const normalizedTarget = _normalizeFolderPath(targetPath);
    const roots = _safeReadJson(PWA_ROOTS_KEY, []);
    if (Array.isArray(roots) && roots.length > 0) _safeWriteJson(PWA_ROOTS_KEY, roots.filter((root) => !_pathMatches(root?.path || '', normalizedTarget, isFolder)));
    const homeFolder = _safeReadJson(PWA_HOME_KEY, null);
    if (homeFolder?.path && _pathMatches(homeFolder.path, normalizedTarget, isFolder)) localStorage.removeItem(PWA_HOME_KEY);
    const links = _folderLinksStore().filter((link) => !_pathMatches(link.path, normalizedTarget, isFolder) && !_pathMatches(link.folder_path, normalizedTarget, isFolder));
    _writeFolderLinksStore(links);
  }

  async function _removeStoredPathEntriesForProvider(provider, targetPath, isFolder) {
    _removeStoredPathEntries(targetPath, isFolder);
    if (!provider) return;
    const normalizedTarget = _normalizeFolderPath(targetPath);
    const links = (await _readFolderLinks(provider))
      .filter((link) => !_pathMatches(link.path, normalizedTarget, isFolder) && !_pathMatches(link.folder_path, normalizedTarget, isFolder));
    await _writeFolderLinks(provider, links);
  }

  async function _iterateWorkspaceFiles(provider, callback, relativePath) {
    const basePath = _normalizeFolderPath(relativePath);
    const entries = await _listDirectoryEntries(provider, basePath);
    for (const entry of entries) {
      const nextPath = _joinPath(basePath, entry.name);
      if (!entry.name || entry.name.startsWith('.')) continue;
      if (_isExcludedWorkspacePath(nextPath)) continue;
      if (entry.handle.kind === 'directory') {
        await _iterateWorkspaceFiles(provider, callback, nextPath);
        continue;
      }
      await callback(nextPath, entry.handle);
    }
  }

  async function _workspaceScanRoots() {
    const roots = [''];
    const registry = window.MeldexSourceFolderRegistry;
    try {
      const outlinerRoots = await registry?.loadOutlinerRoots?.();
      (Array.isArray(outlinerRoots) ? outlinerRoots : []).forEach((root) => {
        const rootPath = _normalizeFolderPath(root?.path || '');
        if (rootPath && root?.visible !== false && root?.deleted !== true) roots.push(rootPath);
      });
    } catch {}
    const cached = registry?.CACHE_KEY ? _safeReadJson(registry.CACHE_KEY, {}) : {};
    (Array.isArray(cached?.roots) ? cached.roots : []).forEach((root) => {
      const rootPath = _normalizeFolderPath(root?.path || '');
      if (rootPath && root?.visible !== false && root?.deleted !== true) roots.push(rootPath);
    });
    return [...new Set(roots)];
  }

  async function _iterateAllWorkspaceFiles(provider, callback) {
    const seen = new Set();
    for (const rootPath of await _workspaceScanRoots()) {
      await _iterateWorkspaceFiles(provider, async (filePath, handle) => {
        const normalized = _normalizeFolderPath(filePath);
        if (seen.has(normalized)) return;
        seen.add(normalized);
        await callback(normalized, handle);
      }, rootPath).catch(() => {});
    }
  }

  async function _requireUnlockedPath(provider, path, options) {
    const checker = window.MeldexFileLockStore?.requireUnlocked;
    if (typeof checker === 'function') await checker(provider, path, options || {});
  }

  async function _relocateReferences(provider, oldPath, newPath, isFolder) {
    const normalizedOld = _normalizeFolderPath(oldPath);
    const normalizedNew = _normalizeFolderPath(newPath);
    // キー判定はPython側 meldex_reference_codecs.is_json_reference_path_key と
    // 1対1移植した gb-reference-codecs.js の正本へ委譲する(ファイル参照整合性
    // 計画 Phase 3。Phase0監査notes.md §5「重複実装リスク」の解消。移植前は
    // 固定19キーのみを認識する独立実装だったため、camelCase合成キー
    // (imageSourcePath等)を取りこぼしていた)。未読込時は認識キーが0件になる
    // フォールバック関数で安全側に倒す(誤検出を増やさない)。
    const isReferenceKey = window.MeldexReferenceCodecs?.isJsonReferencePathKey || (() => false);
    const quotedKeyPattern = /((["'])([A-Za-z_][A-Za-z0-9_]*)\2\s*:\s*)(["'])([^"'\r\n]*)\4/g;
    const looseKeyPattern = /(\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*)(["']?)([^"'\n\r,}\]]+)\3/g;
    const rewritePathValue = (value) => _rewritePath(value, normalizedOld, normalizedNew, isFolder);
    const rewriteReferenceText = (text) => {
      let next = String(text || '');
      next = next.replace(/(!?\[[^\]\n]*\]\()([^)\n]+)(\))/g, (match, prefix, target, suffix) => {
        const rewritten = rewritePathValue(target);
        return rewritten === target ? match : prefix + rewritten + suffix;
      });
      next = next.replace(quotedKeyPattern, (match, prefix, _quoteChar, keyName, valueQuote, target) => {
        if (!isReferenceKey(keyName)) return match;
        const rewritten = rewritePathValue(String(target).trim());
        return rewritten === String(target).trim() ? match : `${prefix}${valueQuote}${rewritten}${valueQuote}`;
      });
      next = next.replace(looseKeyPattern, (match, prefix, keyName, quote, target) => {
        if (!isReferenceKey(keyName)) return match;
        const rewritten = rewritePathValue(String(target).trim());
        return rewritten === String(target).trim() ? match : `${prefix}${quote}${rewritten}${quote}`;
      });
      return next;
    };
    const rewrittenPaths = [];
    let failedCount = 0;
    await _iterateAllWorkspaceFiles(provider, async (filePath) => {
      if (!_isTextLikePath(filePath)) return;
      try {
        const original = await _readTextSafe(provider, filePath, '');
        if (!original || !original.includes(normalizedOld)) return;
        const next = rewriteReferenceText(original);
        if (next === original) return;
        await _requireUnlockedPath(provider, filePath, { action: 'reference-relocate' });
        await provider.writeText(filePath, next);
        rewrittenPaths.push(filePath);
      } catch {
        failedCount += 1;
      }
    });
    return {
      rewritten_count: rewrittenPaths.length,
      failed_count: failedCount,
      rewritten_paths: rewrittenPaths.slice(0, 50),
      truncated: rewrittenPaths.length > 50,
    };
  }

  async function _queryBacklinks(provider, targetPath) {
    const normalizedTarget = _normalizeFolderPath(targetPath);
    const items = [];
    await _iterateAllWorkspaceFiles(provider, async (filePath) => {
      if (!_isTextLikePath(filePath) || filePath === normalizedTarget) return;
      const content = await _readTextSafe(provider, filePath, '');
      if (!content || !content.includes(normalizedTarget)) return;
      items.push({
        source_path: filePath,
        display_name: _displayLabelForPath(filePath, ''),
        exists: true,
        entry_type: '',
        link_type: 'body',
        link_location: '',
      });
    });
    items.sort((a, b) => String(a.display_name || '').localeCompare(String(b.display_name || ''), 'ja', { sensitivity: 'base' }));
    return { ok: true, target: normalizedTarget, items };
  }

  // ファイル参照整合性・削除警告・全ファイルバックリンク実装計画 Phase 4:
  // 削除影響照会（POST /references/delete-impact、gb-delete-impact-warning.js の
  // 呼び出し先）。Desktop側 meldex_api_reference_delete_impact.py の永続索引版と
  // 意味は同じだが、Cloud（Dropbox直結）にはbacklinksの永続索引が無いため、
  // _queryBacklinks / _relocateReferences と同じ「毎回workspace全体をライブ走査
  // する」設計に合わせる（第二の索引エンジンを作らない。Phase0監査notes.md §5
  // 「重複実装リスク」を踏襲）。ライブ全件走査のため coverage は常に complete
  // として返す（Desktopのような部分索引・陳腐化の概念がCloud側には無い）。
  async function _queryDeleteImpact(provider, items) {
    const requested = (Array.isArray(items) ? items : [])
      .map((it) => ({
        path: _normalizeFolderPath(it?.path || ''),
        kind: it?.kind === 'folder' ? 'folder' : 'file',
      }))
      .filter((it) => it.path);
    if (!requested.length) {
      return { ok: true, complete: true, sourceFileCount: 0, occurrenceCount: 0, sources: [], truncatedSources: false, unchecked: [], coverage: { status: 'complete', mode: 'live-scan' } };
    }
    const folderPrefixes = requested.filter((it) => it.kind === 'folder').map((it) => it.path + '/');
    const deletionTargets = new Set(requested.filter((it) => it.kind === 'file').map((it) => it.path));
    requested.forEach((it) => { if (it.kind === 'folder') deletionTargets.add(it.path); });

    const allFiles = [];
    await _iterateAllWorkspaceFiles(provider, async (filePath) => {
      allFiles.push(filePath);
      if (folderPrefixes.some((prefix) => filePath.startsWith(prefix))) deletionTargets.add(filePath);
    });

    const aggregated = new Map();
    for (const filePath of allFiles) {
      if (deletionTargets.has(filePath) || !_isTextLikePath(filePath)) continue;
      const content = await _readTextSafe(provider, filePath, '');
      if (!content) continue;
      let matchCount = 0;
      deletionTargets.forEach((target) => {
        if (target && content.includes(target)) matchCount += 1;
      });
      if (matchCount > 0) {
        aggregated.set(filePath, {
          source_path: filePath,
          source_asset_id: '',
          display_name: _displayLabelForPath(filePath, ''),
          exists: true,
          entry_type: '',
          occurrence_count: matchCount,
        });
      }
    }

    const sources = [...aggregated.values()].sort((a, b) => (
      String(a.source_path || '').localeCompare(String(b.source_path || ''), 'ja', { sensitivity: 'base' })
    ));
    const sourceFileCount = sources.length;
    const occurrenceCount = sources.reduce((sum, row) => sum + Number(row.occurrence_count || 0), 0);
    const visibleSources = sources.slice(0, 50);
    return {
      ok: true,
      complete: true,
      sourceFileCount,
      occurrenceCount,
      sources: visibleSources,
      truncatedSources: sources.length > visibleSources.length,
      unchecked: [],
      coverage: { status: 'complete', mode: 'live-scan' },
    };
  }

  window.__MeldexPwaDataAccessInternals = {
    NOT_HANDLED,
    PWA_HOME_KEY,
    PWA_TRASH_DIR,
    IMAGE_EXTS,
    _safeReadJson,
    _safeWriteJson,
    _normalizeFolderPath,
    _joinPath,
    _dirname,
    _basename,
    _splitNameAndExt,
    _boolParam,
    _displayLabelForPath,
    _phase1SurfaceType,
    _extractFrontmatterType,
    _isTextLikePath,
    _folderLinksStore,
    _writeFolderLinksStore,
    _readFolderLinks,
    _writeFolderLinks,
    assertCloudWriteAllowed,
    _requirePwaProvider,
    _directoryHandle,
    _resolveEntryHandle,
    _listDirectoryEntries,
    _readJsonSafe,
    _fileStats,
    _validateItemName,
    _pathExists,
