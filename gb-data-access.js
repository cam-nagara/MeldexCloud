(function () {
  const NOT_HANDLED = Symbol('NOT_HANDLED');
  const TEAM_CACHE_KEY = 'meldex-cloud-team-avatar-cache';
  const PWA_ROOTS_KEY = 'meldex-cloud-outliner-roots';
  const PWA_HOME_KEY = 'meldex-cloud-home-folder';
  const PWA_UI_CONFIG_KEY = 'meldex-cloud-ui-config';
  const PWA_FOLDER_LINKS_KEY = 'meldex-cloud-folder-links';
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
    if (lower.endsWith('.scriptnote.json')) return { stem: safeName.slice(0, -16), ext: '.scriptnote.json' };
    if (lower.endsWith('.smart-db.json')) return { stem: safeName.slice(0, -14), ext: '.smart-db.json' };
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
    return TEXT_EXTS.has(ext) || path.toLowerCase().endsWith('.scriptnote.json') || path.toLowerCase().endsWith('.smart-db.json');
  }

  function _isExcludedWorkspacePath(path) {
    const normalized = _normalizeFolderPath(path);
    if (!normalized) return false;
    return WORKSPACE_SCAN_EXCLUDE_PREFIXES.some((prefix) => normalized === prefix.replace(/\/$/, '') || normalized.startsWith(prefix));
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
    if (!name || !avatar) return;
    const cache = _teamCache();
    cache[name] = avatar;
    if (folder) cache[folder + '::' + name] = avatar;
    _safeWriteJson(TEAM_CACHE_KEY, cache);
  }

  function _cachedTeamAvatar(name, folder) {
    const cache = _teamCache();
    if (folder && cache[folder + '::' + name]) return cache[folder + '::' + name];
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
    const stored = _safeReadJson(PWA_ROOTS_KEY, null);
    if (Array.isArray(stored) && stored.length > 0) return stored;
    const workspace = await _pwaWorkspaceDescriptor();
    if (!workspace.name && !workspace.path) return [];
    return [{ path: '.', name: workspace.name || 'vault', visible: true }];
  }

  function _setPwaRoots(roots) {
    const clean = (Array.isArray(roots) ? roots : []).map((root) => ({
      path: String(root?.path || '.'),
      name: String(root?.name || root?.path || '.'),
      visible: root?.visible !== false,
    }));
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
    const team = await provider.readJson(relativeFile, { members: {} });
    if (!team || typeof team !== 'object') return { members: {} };
    if (!team.members || typeof team.members !== 'object') team.members = {};
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

  function _folderLinksStore() {
    const raw = _safeReadJson(PWA_FOLDER_LINKS_KEY, []);
    return Array.isArray(raw) ? raw.map((link) => ({
      file_id: String(link?.file_id || ''),
      path: _normalizeFolderPath(link?.path || ''),
      name: String(link?.name || ''),
      folder_path: _normalizeFolderPath(link?.folder_path || ''),
      folder_id: String(link?.folder_id || ''),
      added_at: String(link?.added_at || ''),
    })).filter((link) => link.path && link.folder_path) : [];
  }

  function _writeFolderLinksStore(links) {
    _safeWriteJson(PWA_FOLDER_LINKS_KEY, Array.isArray(links) ? links : []);
  }

  async function _requirePwaProvider(mode) {
    const provider = await _pwaProvider();
    if (!provider) throw new Error('Dropbox 共有フォルダが未接続です');
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
      entries.push({ name, handle });
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
    if (ext === '.md') {
      if (lowerName.endsWith('.board.md')) return _phase1SurfaceType('board', 'file');
      const frontmatterType = _extractFrontmatterType(await _readTextSafe(provider, relativePath, ''));
      if (frontmatterType === 'board') return _phase1SurfaceType('board', 'file');
      if (frontmatterType === 'chat') return _phase1SurfaceType('chat', 'file');
      return 'page';
    }
    if (ext === '.json' || lowerName.endsWith('.scriptnote.json') || lowerName.endsWith('.smart-db.json')) {
      if (lowerName.endsWith('.scriptnote.json')) return 'scriptnote';
      if (lowerName.endsWith('.smart-db.json')) return _phase1SurfaceType('smart-db', 'file');
      const parsed = await _readJsonSafe(provider, relativePath, null);
      if (parsed && typeof parsed === 'object') {
        if (parsed.fileType === 'meldex-scriptnote') return 'scriptnote';
        if (parsed.type === 'smart-db') return _phase1SurfaceType('smart-db', 'file');
      }
      return safeOptions.forBrowse ? 'scenario' : 'unknown';
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
    if (handle.kind === 'directory') {
      return { name, type: 'folder', path: _normalizeFolderPath(relativePath), file_id: _fnvFileId(_normalizeFolderPath(relativePath)) };
    }
    const fileType = await _classifyFileType(provider, relativePath, { forBrowse: true, allFiles: !!safeOptions.allFiles });
    if (!fileType) return null;
    const item = {
      name: _displayLabelForPath(relativePath, fileType),
      type: fileType,
      path: _normalizeFolderPath(relativePath),
      file_id: _fnvFileId(_normalizeFolderPath(relativePath)),
    };
    if (safeOptions.allFiles && fileType === 'unknown') {
      item.ext = _splitNameAndExt(name).ext.toLowerCase();
      item.name = name;
    }
    if (safeOptions.detail) {
      const stats = await _fileStats(handle);
      item.size = stats.size;
      item.modified = stats.modified;
      item._modifiedMs = stats.modifiedMs;
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

  function _linkedItemsForFolder(folderPath) {
    const normalizedFolder = _normalizeFolderPath(folderPath);
    return _folderLinksStore().filter((link) => link.folder_path === normalizedFolder).map((link) => ({
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

  function _removeStoredPathEntries(targetPath, isFolder) {
    const normalizedTarget = _normalizeFolderPath(targetPath);
    const roots = _safeReadJson(PWA_ROOTS_KEY, []);
    if (Array.isArray(roots) && roots.length > 0) _safeWriteJson(PWA_ROOTS_KEY, roots.filter((root) => !_pathMatches(root?.path || '', normalizedTarget, isFolder)));
    const homeFolder = _safeReadJson(PWA_HOME_KEY, null);
    if (homeFolder?.path && _pathMatches(homeFolder.path, normalizedTarget, isFolder)) localStorage.removeItem(PWA_HOME_KEY);
    const links = _folderLinksStore().filter((link) => !_pathMatches(link.path, normalizedTarget, isFolder) && !_pathMatches(link.folder_path, normalizedTarget, isFolder));
    _writeFolderLinksStore(links);
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

  async function _relocateReferences(provider, oldPath, newPath, isFolder) {
    const normalizedOld = _normalizeFolderPath(oldPath);
    const normalizedNew = _normalizeFolderPath(newPath);
    const rewritePathValue = (value) => _rewritePath(value, normalizedOld, normalizedNew, isFolder);
    const rewriteReferenceText = (text) => {
      let next = String(text || '');
      next = next.replace(/(!?\[[^\]\n]*\]\()([^)\n]+)(\))/g, (match, prefix, target, suffix) => {
        const rewritten = rewritePathValue(target);
        return rewritten === target ? match : prefix + rewritten + suffix;
      });
      next = next.replace(/(\b(?:path|file|targetPath|image|url|folder_path|db_path)\s*:\s*)(["']?)([^"'\n\r,}\]]+)(\2)/g, (match, prefix, quote, target, suffix) => {
        const rewritten = rewritePathValue(String(target).trim());
        return rewritten === String(target).trim() ? match : prefix + quote + rewritten + suffix;
      });
      return next;
    };
    const rewrittenPaths = [];
    let failedCount = 0;
    await _iterateWorkspaceFiles(provider, async (filePath) => {
      if (!_isTextLikePath(filePath)) return;
      try {
        const original = await _readTextSafe(provider, filePath, '');
        if (!original || !original.includes(normalizedOld)) return;
        const next = rewriteReferenceText(original);
        if (next === original) return;
        await provider.writeText(filePath, next);
        rewrittenPaths.push(filePath);
      } catch {
        failedCount += 1;
      }
    }, '');
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
    await _iterateWorkspaceFiles(provider, async (filePath) => {
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
    }, '');
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
    _removeStoredPathEntries,
    _iterateWorkspaceFiles,
    _relocateReferences,
    _queryBacklinks,
    _fnvFileId,
  };
  window.__MeldexPwaDataAccessExtensions = window.__MeldexPwaDataAccessExtensions || [];

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
      const team = await _readTeamFile(folder);
      const name = String(body?.name || '').trim();
      if (!name) throw new Error('name は必須です');
      const member = team.members[name] || {};
      member.avatar = body?.avatar || member.avatar || '';
      member.last_seen = new Date().toISOString();
      member.role = member.role || 'editor';
      team.members[name] = member;
      _cacheTeamAvatar(name, member.avatar, folder);
      await _writeTeamFile(folder, team);
      return { ok: true };
    }
    if (pathname === '/team/remove' && method === 'POST') {
      const folder = body?.folder || '';
      const team = await _readTeamFile(folder);
      delete team.members[String(body?.name || '').trim()];
      await _writeTeamFile(folder, team);
      return { ok: true };
    }
    if (pathname === '/file-ids' && method === 'POST') {
      const result = {};
      (Array.isArray(body?.paths) ? body.paths : []).forEach((pathValue) => {
        const key = String(pathValue || '');
        result[key] = key ? _fnvFileId(_normalizePath(key)) : null;
      });
      return result;
    }
    if (pathname === '/version' && method === 'GET') return { version: 'Dropbox cloud mode', semver: '0.0.0', variant: 'dropbox', build: '', commit: '' };
    if (pathname === '/os-accent-color' && method === 'GET') return { color: '#569cd6' };

    for (const handler of window.__MeldexPwaDataAccessExtensions || []) {
      const result = await handler({ method, body, url, pathname });
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
        throw new Error('クラウドモード未対応の操作です');
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
