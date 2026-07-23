(function () {
  const NOT_HANDLED = Symbol('NOT_HANDLED');
  const TEAM_CACHE_KEY = 'meldex-cloud-team-avatar-cache';
  const PWA_ROOTS_KEY = 'meldex-cloud-outliner-roots';
  const PWA_HOME_KEY = 'meldex-cloud-home-folder';
  const PWA_UI_CONFIG_KEY = 'meldex-cloud-ui-config';
  const PWA_FOLDER_LINKS_KEY = 'meldex-cloud-folder-links';
  const PWA_FOLDER_LINKS_FILE = '_meldex/folder-links.json';
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

  async function _pwaWorkspaceDescriptor() {
    const provider = await _pwaProvider();
    const info = provider ? await provider.getWorkspaceInfo() : { connected: false, name: '', path: '' };
    if (!info.connected) return { path: '', name: '' };
    const current = _runtime()?.getWorkspaceState?.() || {};
    _runtime()?.setWorkspaceState?.({
      ...current,
      kind: 'dropbox',
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

  async function _pwaHomeFolder() {
    const provider = await _pwaProvider();
    const stored = _safeReadJson(PWA_HOME_KEY, null);
    if (stored?.path) {
      try {
        if (provider) await provider.getDirectoryHandle(stored.path, false);
        return { ...stored, exists: true };
      } catch {
        return { ...stored, exists: false };
      }
    }
    try {
      if (provider) {
        await provider.getDirectoryHandle('MeldexHome', false);
        return { path: 'MeldexHome', name: 'MeldexHome', exists: true, locked_folders: [], locked_paths: [] };
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

  async function _writeTeamFile(folderPath, team) {
    const provider = await _pwaProvider();
    if (!provider || !await provider.ensureWorkspacePermission('readwrite')) throw new Error('Dropbox 共有フォルダへ書き込めません');
    const relativeFolder = _normalizeFolderPath(folderPath);
    const relativeFile = relativeFolder ? (relativeFolder + '/_Meldex_team.json') : '_Meldex_team.json';
    await provider.writeJson(relativeFile, team || { members: {} });
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
    const persisted = provider ? await _readJsonSafe(provider, PWA_FOLDER_LINKS_FILE, null) : null;
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
      await _requireUnlockedPath(provider, PWA_FOLDER_LINKS_FILE, { action: 'folder-links' });
      await provider.writeJson(PWA_FOLDER_LINKS_FILE, {
        version: 1,
        updated_at: new Date().toISOString(),
        links: normalized,
      });
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
    if (!provider) throw new Error('Dropbox 共有フォルダが未接続です');
    assertCloudWriteAllowed(mode || 'read');
    const granted = await provider.ensureWorkspacePermission(mode || 'read');
    if (!granted && (mode || 'read') === 'readwrite' && document.body?.dataset?.cloudQuotaBlocked === '1') {
      throw new Error('Dropbox 容量が95%を超えているため書き込みを停止しています。空き容量を確保してから再開してください');
    }
    if (!granted) throw new Error((mode || 'read') === 'readwrite' ? '閲覧専用モードのため書き込めません' : 'Dropbox 共有フォルダの読み取り権限がありません');
    return provider;
  }

  async function _workspaceHandle(provider) {
    const handle = provider ? await provider.restoreWorkspace() : null;
    if (!handle) throw new Error('Dropbox 共有フォルダが未接続です');
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
    const referenceKeys = 'path|file|targetPath|target_path|targetFile|target_file|image|imagePath|url|href|folder_path|file_path|db_path|dbPath|scenarioPath|scriptnotePath|boardPath|csvPath|src';
    const quotedKeyPattern = new RegExp('((?:["\\\'])(?:' + referenceKeys + ')(?:["\\\'])\\s*:\\s*)(["\\\'])([^"\\\'\\r\\n]*)(\\2)', 'g');
    const looseKeyPattern = new RegExp('(\\b(?:' + referenceKeys + ')\\s*:\\s*)(["\\\']?)([^"\\\'\\n\\r,}\\]]+)(\\2)', 'g');
    const rewritePathValue = (value) => _rewritePath(value, normalizedOld, normalizedNew, isFolder);
    const rewriteReferenceText = (text) => {
      let next = String(text || '');
      next = next.replace(/(!?\[[^\]\n]*\]\()([^)\n]+)(\))/g, (match, prefix, target, suffix) => {
        const rewritten = rewritePathValue(target);
        return rewritten === target ? match : prefix + rewritten + suffix;
      });
      next = next.replace(quotedKeyPattern, (match, prefix, quote, target, suffix) => {
        const rewritten = rewritePathValue(String(target).trim());
        return rewritten === String(target).trim() ? match : prefix + quote + rewritten + suffix;
      });
      next = next.replace(looseKeyPattern, (match, prefix, quote, target, suffix) => {
        const rewritten = rewritePathValue(String(target).trim());
        return rewritten === String(target).trim() ? match : prefix + quote + rewritten + suffix;
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

  const PWA_WORKSPACES_FILE = '_meldex/workspaces.v1.json';
  const TEAM_LAST_SEEN_REFRESH_MS = 10 * 60 * 1000;

  function _nowIso() {
    return new Date().toISOString();
  }

  function _httpError(status, message) {
    const err = new Error(message || `HTTP ${status}`);
    err.status = status;
    err.httpStatus = status;
    return err;
  }

  function _teamFilePath(folderPath) {
    const relativeFolder = _normalizeFolderPath(folderPath);
    return relativeFolder ? (relativeFolder + '/_Meldex_team.json') : '_Meldex_team.json';
  }

  function _normalizeTeamFile(team) {
    const base = team && typeof team === 'object' && !Array.isArray(team) ? { ...team } : {};
    if (!base.members || typeof base.members !== 'object' || Array.isArray(base.members)) base.members = {};
    return base;
  }

  async function _writeTeamFileMerged(folderPath, updater) {
    const provider = await _requirePwaProvider('readwrite');
    const relativeFile = _teamFilePath(folderPath);
    if (typeof provider.writeJsonMerged === 'function') {
      return provider.writeJsonMerged(relativeFile, current => {
        const team = _normalizeTeamFile(current);
        const next = updater(team);
        if (next === false) return false;
        return _normalizeTeamFile(next || team);
      }, { fallbackValue: { members: {} }, retries: 5 });
    }
    const team = _normalizeTeamFile(await _readTeamFile(folderPath).catch(() => ({ members: {} })));
    const next = updater(team);
    if (next === false) return { ok: true, skipped: true };
    await _writeTeamFile(folderPath, _normalizeTeamFile(next || team));
    return { ok: true };
  }

  async function _syncTeamMember(folder, body) {
    const name = String(body?.name || '').trim();
    if (!name) throw new Error('name は必須です');
    const accountId = String(body?.accountId || body?.account_id || '').trim();
    const hasAvatarField = Object.prototype.hasOwnProperty.call(body || {}, 'avatar');
    let avatarForCache = '';
    let wrote = false;
    const result = await _writeTeamFileMerged(folder, team => {
      const members = team.members || {};
      const existing = members[name] && typeof members[name] === 'object' ? { ...members[name] } : {};
      const next = { ...existing };
      let changed = false;
      if (hasAvatarField) {
        const avatar = body?.avatar || '';
        if ((next.avatar || '') !== avatar) {
          next.avatar = avatar;
          changed = true;
        }
      } else if (!Object.prototype.hasOwnProperty.call(next, 'avatar')) {
        next.avatar = '';
      }
      if (accountId) {
        Object.entries(members).forEach(([memberName, info]) => {
          if (memberName !== name && info?.accountId === accountId) {
            delete members[memberName];
            changed = true;
          }
        });
        if (next.accountId !== accountId) {
          next.accountId = accountId;
          changed = true;
        }
      }
      if (!next.role) {
        next.role = 'editor';
        changed = true;
      }
      const seenMs = Date.parse(String(existing.last_seen || ''));
      const refreshSeen = !Number.isFinite(seenMs) || Date.now() - seenMs > TEAM_LAST_SEEN_REFRESH_MS;
      avatarForCache = next.avatar || '';
      if (!changed && !refreshSeen) return false;
      next.last_seen = _nowIso();
      members[name] = next;
      team.members = members;
      wrote = true;
      return team;
    });
    _cacheTeamAvatar(name, avatarForCache, folder);
    return { ok: true, skipped: result?.skipped === true || !wrote };
  }

  function _workspaceRole(role, fallback) {
    const value = String(role || '').trim().toLowerCase();
    return ['owner', 'admin', 'member', 'viewer'].includes(value) ? value : (fallback || 'member');
  }

  function _workspaceMember(member, fallbackName) {
    const name = String(member?.name || fallbackName || '').trim();
    if (!name) return null;
    const accountId = String(member?.accountId || member?.account_id || '').trim();
    const row = {
      name,
      role: _workspaceRole(member?.role, 'member'),
      avatar: String(member?.avatar || ''),
      updatedAt: String(member?.updatedAt || member?.updated_at || _nowIso()),
    };
    if (accountId) row.accountId = accountId;
    return row;
  }

  function _localAvatar() {
    try {
      return String(localStorage.getItem('meldex-avatar') || '');
    } catch {
      return '';
    }
  }

  function _workspaceId() {
    return 'ws-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function _workspaceFolderPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const registry = window.MeldexSourceFolderRegistry;
    if (raw.startsWith('/') && registry?.virtualPathFromDropboxPath) {
      return _normalizeFolderPath(registry.virtualPathFromDropboxPath(raw));
    }
    return _normalizeFolderPath(raw);
  }

  function _normalizeCloudWorkspace(raw) {
    const folder = _workspaceFolderPath(raw?.folder || raw?.path || '');
    const id = String(raw?.id || '').trim() || (folder ? _fnvFileId(folder).slice(0, 18) : '');
    if (!id) return null;
    const members = (Array.isArray(raw?.members) ? raw.members : [])
      .map(member => _workspaceMember(member))
      .filter(Boolean);
    return {
      id,
      name: String(raw?.name || _basename(folder) || 'ワークスペース'),
      folder,
      visible: raw?.visible !== false,
      deleted: raw?.deleted === true,
      createdAt: String(raw?.createdAt || raw?.created_at || _nowIso()),
      updatedAt: String(raw?.updatedAt || raw?.updated_at || _nowIso()),
      deletedAt: raw?.deletedAt || raw?.deleted_at || '',
      sourceFolderIds: Array.isArray(raw?.sourceFolderIds) ? raw.sourceFolderIds.map(String) : [],
      members,
    };
  }

  function _normalizeWorkspaceStore(raw) {
    const rows = Array.isArray(raw?.workspaces) ? raw.workspaces : (Array.isArray(raw) ? raw : []);
    return {
      kind: 'meldex-cloud-workspaces',
      version: 1,
      updatedAt: String(raw?.updatedAt || raw?.updated_at || ''),
      workspaces: rows.map(_normalizeCloudWorkspace).filter(Boolean),
    };
  }

  async function _readCloudWorkspaceStore() {
    const provider = await _requirePwaProvider('read');
    const data = await _readJsonSafe(provider, PWA_WORKSPACES_FILE, { workspaces: [] });
    return _normalizeWorkspaceStore(data);
  }

  async function _updateCloudWorkspaceStore(updater) {
    const provider = await _requirePwaProvider('readwrite');
    let latest = null;
    const apply = current => {
      const store = _normalizeWorkspaceStore(current);
      const next = updater(store);
      if (next === false) return false;
      latest = _normalizeWorkspaceStore(next || store);
      latest.updatedAt = _nowIso();
      return latest;
    };
    if (typeof provider.writeJsonMerged === 'function') {
      const result = await provider.writeJsonMerged(PWA_WORKSPACES_FILE, apply, {
        fallbackValue: { kind: 'meldex-cloud-workspaces', version: 1, workspaces: [] },
        retries: 5,
      });
      return result?.skipped ? null : latest;
    }
    const current = await _readCloudWorkspaceStore();
    const next = apply(current);
    if (next === false) return null;
    await provider.writeJson(PWA_WORKSPACES_FILE, latest);
    return latest;
  }

  function _currentWorkspaceMember(body, role) {
    const name = String(body?.user || body?.name || (typeof getUsername === 'function' ? getUsername() : '') || 'anonymous').trim() || 'anonymous';
    return _workspaceMember({
      name,
      role: role || 'owner',
      avatar: body?.avatar || _localAvatar(),
      accountId: body?.accountId || body?.account_id || '',
      updatedAt: _nowIso(),
    });
  }

  async function _cloudWorkspaceList() {
    const store = await _readCloudWorkspaceStore();
    return { workspaces: store.workspaces.filter(item => item && item.deleted !== true) };
  }

  async function _cloudCreateWorkspace(body) {
    const folder = _workspaceFolderPath(body?.folder || body?.path || '');
    if (!folder) throw _httpError(400, 'ワークスペースにするDropboxフォルダを指定してください');
    let created = null;
    await _updateCloudWorkspaceStore(store => {
      if (store.workspaces.some(item => item.deleted !== true && _normalizeFolderPath(item.folder) === folder)) {
        throw _httpError(409, 'このフォルダは既にワークスペースに登録されています');
      }
      const now = _nowIso();
      created = _normalizeCloudWorkspace({
        id: _workspaceId(),
        name: String(body?.name || _basename(folder) || 'ワークスペース').trim(),
        folder,
        visible: true,
        createdAt: now,
        updatedAt: now,
        members: [_currentWorkspaceMember(body, 'owner')].filter(Boolean),
      });
      store.workspaces.push(created);
      return store;
    });
    return { ok: true, workspace: created };
  }

  async function _cloudUpdateWorkspace(id, body) {
    let updated = null;
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      if (Object.prototype.hasOwnProperty.call(body || {}, 'name')) target.name = String(body.name || target.name || 'ワークスペース').trim();
      if (Object.prototype.hasOwnProperty.call(body || {}, 'folder')) target.folder = _workspaceFolderPath(body.folder || target.folder || '');
      target.updatedAt = _nowIso();
      updated = _normalizeCloudWorkspace(target);
      Object.assign(target, updated);
      return store;
    });
    return { ok: true, workspace: updated };
  }

  async function _cloudDeleteWorkspace(id) {
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      target.deleted = true;
      target.deletedAt = _nowIso();
      target.updatedAt = target.deletedAt;
      return store;
    });
    return { ok: true };
  }

  async function _cloudUpsertWorkspaceMember(id, name, body) {
    let workspace = null;
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      const targetName = String(name || '').trim();
      const existingIndex = target.members.findIndex(item => item.name === targetName);
      const existing = existingIndex >= 0 ? target.members[existingIndex] : {};
      const accountId = String(body?.accountId || body?.account_id || existing?.accountId || '').trim();
      const member = _workspaceMember({
        ...existing,
        name: targetName,
        role: body?.role || existing?.role || 'member',
        avatar: Object.prototype.hasOwnProperty.call(body || {}, 'avatar') ? body.avatar : (existing?.avatar || ''),
        accountId,
        updatedAt: _nowIso(),
      }, targetName);
      if (!member) throw _httpError(400, 'メンバー名を指定してください');
      if (accountId) {
        target.members = target.members.filter((item, index) => index === existingIndex || item?.accountId !== accountId);
      }
      const index = target.members.findIndex(item => item.name === member.name);
      if (index >= 0) target.members[index] = { ...target.members[index], ...member };
      else target.members.push(member);
      target.updatedAt = _nowIso();
      workspace = _normalizeCloudWorkspace(target);
      Object.assign(target, workspace);
      return store;
    });
    return { ok: true, workspace };
  }

  async function _cloudRemoveWorkspaceMember(id, name) {
    await _updateCloudWorkspaceStore(store => {
      const target = store.workspaces.find(item => item.id === id && item.deleted !== true);
      if (!target) throw _httpError(404, 'ワークスペースが見つかりません');
      target.members = target.members.filter(member => member.name !== name);
      target.updatedAt = _nowIso();
      return store;
    });
    return { ok: true };
  }

  async function _cloudSyncWorkspaceProfile(id, body) {
    return _cloudUpsertWorkspaceMember(id, String(body?.name || body?.user || (typeof getUsername === 'function' ? getUsername() : 'anonymous')), {
      role: body?.role || 'member',
      avatar: body?.avatar || _localAvatar(),
      accountId: body?.accountId || body?.account_id || '',
    });
  }

  async function _cloudPickWorkspaceFolder() {
    const picker = window.MeldexDropboxFolderPicker?.pickFolder || window.GBFolderPicker?.pickFolder;
    if (typeof picker === 'function') {
      const picked = await picker({ title: 'ワークスペースにするDropboxフォルダを選択' });
      const path = _workspaceFolderPath(window.GBFolderPicker?.toSourceRelativePath?.(picked) || picked?.path || picked?.relativePath || '');
      if (path) return { ok: true, path, name: _basename(path) || path };
    }
    return { ok: false, path: '', manual: true };
  }

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
      return _syncTeamMember(folder, body);
    }
    if (pathname === '/team/remove' && method === 'POST') {
      const folder = body?.folder || '';
      const name = String(body?.name || '').trim();
      await _writeTeamFileMerged(folder, team => {
        delete team.members[name];
        return team;
      });
      return { ok: true };
    }
    if (pathname === '/workspaces' && method === 'GET') return _cloudWorkspaceList();
    if (pathname === '/workspaces/pick-folder' && method === 'POST') return _cloudPickWorkspaceFolder();
    if (pathname === '/workspaces' && method === 'POST') return _cloudCreateWorkspace(body);
    {
      const syncMatch = pathname.match(/^\/workspaces\/([^/]+)\/sync-profile$/);
      if (syncMatch && method === 'POST') return _cloudSyncWorkspaceProfile(decodeURIComponent(syncMatch[1]), body);
      const memberMatch = pathname.match(/^\/workspaces\/([^/]+)\/members\/([^/]+)$/);
      if (memberMatch && method === 'PUT') return _cloudUpsertWorkspaceMember(decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2]), body);
      if (memberMatch && method === 'DELETE') return _cloudRemoveWorkspaceMember(decodeURIComponent(memberMatch[1]), decodeURIComponent(memberMatch[2]));
      const itemMatch = pathname.match(/^\/workspaces\/([^/]+)$/);
      if (itemMatch && method === 'PUT') return _cloudUpdateWorkspace(decodeURIComponent(itemMatch[1]), body);
      if (itemMatch && method === 'DELETE') return _cloudDeleteWorkspace(decodeURIComponent(itemMatch[1]));
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
      const result = await handler({ method, body, url, pathname, headers: opts?.headers });
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
        const err = new Error('この操作を完了できませんでした。画面を更新してもう一度試してください。');
        err.status = 500;
        err.code = 'cloud_route_unwired';
        err.route = String(path || '');
        throw err;
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
