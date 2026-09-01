(function () {
  const NOT_HANDLED = Symbol('NOT_HANDLED');
  const TEAM_CACHE_KEY = 'meldex-cloud-team-avatar-cache';
  const PWA_ROOTS_KEY = 'meldex-cloud-outliner-roots';
  const PWA_HOME_KEY = 'meldex-cloud-home-folder';
  const PWA_UI_CONFIG_KEY = 'meldex-cloud-ui-config';
  const PWA_UI_CONFIG_HISTORY_KEY = 'meldex-cloud-ui-config-history-v1';
  const PWA_FOLDER_LINKS_KEY = 'meldex-cloud-folder-links';

  function _pwaStableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(_pwaStableJson).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + _pwaStableJson(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  async function _pwaUiConfigRevision(value) {
    const bytes = new TextEncoder().encode(_pwaStableJson(value && typeof value === 'object' ? value : {}));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function _pwaUiConfigVersionId() {
    if (typeof crypto?.randomUUID === 'function') {
      return 'uicv_' + crypto.randomUUID().replace(/-/g, '');
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return 'uicv_' + [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function _pwaCaptureUiConfigVersion(snapshot, label) {
    const value = snapshot && typeof snapshot === 'object'
      ? JSON.parse(JSON.stringify(snapshot))
      : {};
    const sourceRevision = await _pwaUiConfigRevision(value);
    const history = _requiredReadJson(PWA_UI_CONFIG_HISTORY_KEY, []);
    const rows = Array.isArray(history) ? history : [];
    if (rows[0]?.sourceRevision === sourceRevision) {
      return { versionId: rows[0].versionId, previousRows: rows, changed: false };
    }
    const versionId = _pwaUiConfigVersionId();
    rows.unshift({ versionId, sourceRevision, label: label || '設定変更前', actor: 'Cloud', createdAt: new Date().toISOString(), snapshot: value });
    const nextRows = rows.slice(0, 30);
    _requiredWriteJson(PWA_UI_CONFIG_HISTORY_KEY, nextRows);
    return { versionId, previousRows: rows.slice(1), changed: true };
  }
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

  function _requiredReadJson(key, fallbackValue) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallbackValue;
      return JSON.parse(raw);
    } catch {
      throw _httpError(409, '保存されている設定履歴の整合性を確認できません');
    }
  }

  function _requiredWriteJson(key, value) {
    const serialized = JSON.stringify(value);
    try {
      localStorage.setItem(key, serialized);
      if (localStorage.getItem(key) !== serialized) throw new Error('write verification failed');
    } catch {
      throw _httpError(507, '設定を端末へ保存できません。空き容量とブラウザの保存許可を確認してください');
    }
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
      || path.toLowerCase().endsWith('.scriptnote.json') || path.toLowerCase().endsWith('.timer.json');
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
    const label = MeldexEscape.html(rawName.charAt(0).toUpperCase() || '?');
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
    if (typeof provider?.getSystemStorageAdapter === 'function') {
      return provider.getSystemStorageAdapter();
    }
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!provider || !resolver?.resolveTypedAdapterForProvider) {
      throw new Error('管理データの保存先を安全に判定できません');
    }
    return resolver.resolveTypedAdapterForProvider(provider, kind);
  }

  async function _managementScopeIdentity(provider, kind) {
    const adapter = await _managementAdapter(provider, kind);
    const description = await adapter?.describe?.();
    const boundary = String(description?.boundary || '').trim();
    const managementRoot = String(description?.management_root || '').trim();
    const namespaceKind = String(description?.namespace_kind || '').trim();
    if (!boundary || !managementRoot || !namespaceKind) {
      throw new Error('管理データの保存先を一意に識別できません');
    }
    return JSON.stringify({
      boundary,
      management_root: managementRoot,
      namespace_kind: namespaceKind,
    });
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
    // ワークスペース由来（origin: 'ws:...'）のエントリは、個人のアカウント台帳
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

  function _validateManagedFolderLinks(raw) {
    if (!Array.isArray(raw)) throw new Error('フォルダリンク管理データの links が破損しています');
    const identities = new Set();
    return raw.map((link) => {
      if (!link || typeof link !== 'object' || Array.isArray(link)) {
        throw new Error('フォルダリンク管理データのリンク項目が破損しています');
      }
      for (const field of ['file_id', 'path', 'name', 'folder_path', 'folder_id', 'added_at']) {
        if (typeof link[field] !== 'string') throw new Error(`フォルダリンク管理データの ${field} が不正です`);
      }
      const fileId = link.file_id.trim();
      const path = _normalizeFolderPath(link.path);
      const folderPath = _normalizeFolderPath(link.folder_path);
      const folderId = link.folder_id.trim();
      if (!fileId || !path || !folderPath || path !== link.path || folderPath !== link.folder_path) {
        throw new Error('フォルダリンク管理データの必須識別情報が不正です');
      }
      const identity = `${fileId}\u0000${folderId || folderPath}`;
      if (identities.has(identity)) throw new Error('フォルダリンク管理データに重複したリンクがあります');
      identities.add(identity);
      return { ...link, file_id: fileId, folder_id: folderId };
    });
  }

  function _folderLinksStore() {
    return _normalizeFolderLinks(_safeReadJson(PWA_FOLDER_LINKS_KEY, []));
  }

  function _writeFolderLinksStore(links) {
    _safeWriteJson(PWA_FOLDER_LINKS_KEY, _normalizeFolderLinks(links));
  }

  function _normalizeFolderLinkRequests(raw) {
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw new Error('フォルダリンクの再試行履歴が破損しています');
    const requestIds = new Set();
    return raw.map((record) => {
      const requestId = String(record?.request_id || '').trim();
      const operation = String(record?.operation || '').trim();
      const fingerprint = String(record?.fingerprint || '');
      const scopeId = String(record?.scope_id || '');
      const result = record?.result;
      if (!requestId || !['add', 'remove'].includes(operation) || !fingerprint || !scopeId
          || typeof record?.saved_at !== 'string' || requestIds.has(requestId)) {
        throw new Error('フォルダリンクの再試行履歴が破損しています');
      }
      requestIds.add(requestId);
      if (!result || typeof result !== 'object' || Array.isArray(result)
          || typeof result.ok !== 'boolean' || result.operation !== operation || result.request_id !== requestId
          || !Array.isArray(result.results)) throw new Error('フォルダリンクの保存結果が破損しています');
      const counts = { created: 0, removed: 0, unchanged: 0, failed: 0 };
      result.results.forEach((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)
            || typeof row.file_path !== 'string' || typeof row.file_id !== 'string'
            || typeof row.folder_path !== 'string' || typeof row.folder_id !== 'string'
            || !Object.hasOwn(counts, row.status)
            || (row.status === 'failed' && typeof row.error !== 'string')) {
          throw new Error('フォルダリンクの保存結果が破損しています');
        }
        counts[row.status] += 1;
      });
      for (const status of Object.keys(counts)) {
        if (result[`${status}_count`] !== counts[status]) throw new Error('フォルダリンクの保存結果件数が不正です');
      }
      if (result.ok !== (counts.failed === 0)) throw new Error('フォルダリンクの保存結果状態が不正です');
      return { request_id: requestId, operation, fingerprint, scope_id: scopeId, result, saved_at: record.saved_at };
    });
  }

  function _normalizeOutlinerOperations(raw) {
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw new Error('ファイル操作の再試行履歴が破損しています');
    const ids = new Set();
    return raw.map(record => {
      const id = String(record?.operation_id || '').trim();
      const operation = String(record?.operation || '');
      const state = String(record?.state || '');
      if (!id || ids.has(id) || !['duplicate', 'save-as'].includes(operation)
          || !['prepared', 'completed'].includes(state)
          || !/^[a-f0-9]{64}$/.test(String(record?.fingerprint || ''))
          || typeof record?.scope_id !== 'string' || !record.scope_id
          || !record?.intent || typeof record.intent !== 'object' || Array.isArray(record.intent)
          || typeof record.saved_at !== 'string') {
        throw new Error('ファイル操作の再試行履歴が破損しています');
      }
      if (state === 'completed' && (!record.result || record.result.ok !== true
          || record.result.operation_id !== id || typeof record.result.new_path !== 'string')) {
        throw new Error('ファイル操作の保存結果が破損しています');
      }
      ids.add(id);
      return JSON.parse(JSON.stringify(record));
    });
  }

  async function _readFolderLinks(provider) {
    let persisted = null;
    let fromManagedStorage = false;
    if (provider) {
      const kind = window.MeldexSystemStorage?.SystemStorageKind?.FOLDER_ASSOCIATIONS;
      if (!kind) throw new Error('フォルダ関連付けの管理データ契約が未初期化です');
      const managed = await _readManagementPayload(provider, kind, FOLDER_LINKS_DOCUMENT_ID);
      persisted = managed.payload;
      fromManagedStorage = persisted != null;
      // 旧付随物は移行期間中の読取専用fallback。新規・更新書込は必ず管理領域へ行う。
      if (!persisted) persisted = await _readJsonSafe(provider, PWA_FOLDER_LINKS_FILE, null);
    }
    const raw = Array.isArray(persisted) ? persisted : persisted?.links;
    if (fromManagedStorage || Array.isArray(raw)) {
      const links = fromManagedStorage ? _validateManagedFolderLinks(raw) : _normalizeFolderLinks(raw);
      _writeFolderLinksStore(links);
      return links;
    }
    return _folderLinksStore();
  }

  async function _readFolderLinksManaged(provider) {
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.FOLDER_ASSOCIATIONS;
    if (!provider || !kind) throw new Error('フォルダ関連付けの管理データ契約が未初期化です');
    const managed = await _readManagementPayload(provider, kind, FOLDER_LINKS_DOCUMENT_ID);
    const current = managed.payload;
    if (!current) return { links: await _readFolderLinks(provider), requests: [], outliner_operations: [] };
    const currentRaw = Array.isArray(current) ? current : current?.links;
    return {
      links: _validateManagedFolderLinks(currentRaw),
      requests: _normalizeFolderLinkRequests(Array.isArray(current) ? null : current?.requests),
      outliner_operations: _normalizeOutlinerOperations(Array.isArray(current) ? null : current?.outliner_operations),
    };
  }

  async function _updateFolderLinksManaged(provider, updater) {
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.FOLDER_ASSOCIATIONS;
    if (!kind) throw new Error('フォルダ関連付けの管理データ契約が未初期化です');
    let committed = null;
    const fallbackLinks = await _readFolderLinks(provider);
    await _writeManagementPayload(provider, kind, FOLDER_LINKS_DOCUMENT_ID, (current) => {
      const currentRaw = current == null ? fallbackLinks
        : (Array.isArray(current) ? current : current?.links);
      const state = {
        links: _validateManagedFolderLinks(currentRaw),
        requests: _normalizeFolderLinkRequests(Array.isArray(current) ? null : current?.requests),
        outliner_operations: _normalizeOutlinerOperations(Array.isArray(current) ? null : current?.outliner_operations),
      };
      const updated = updater(state);
      committed = {
        links: _validateManagedFolderLinks(updated?.links),
        requests: _normalizeFolderLinkRequests(updated?.requests),
        outliner_operations: _normalizeOutlinerOperations(updated?.outliner_operations),
        result: updated?.result,
      };
      return {
        ...(current && !Array.isArray(current) ? current : {}),
        version: 1,
        updated_at: new Date().toISOString(),
        links: committed.links,
        requests: committed.requests,
        outliner_operations: committed.outliner_operations,
      };
    }, 5);
    _writeFolderLinksStore(committed.links);
    return committed;
  }

  async function _writeFolderLinks(provider, linksOrUpdater) {
    const applyLocalUpdate = (currentLinks) => _normalizeFolderLinks(
      typeof linksOrUpdater === 'function' ? linksOrUpdater(_normalizeFolderLinks(currentLinks)) : linksOrUpdater
    );
    if (!provider) {
      const normalized = applyLocalUpdate(_folderLinksStore());
      _writeFolderLinksStore(normalized);
      return normalized;
    }
    const committed = await _updateFolderLinksManaged(provider, (state) => ({
      ...state,
      links: typeof linksOrUpdater === 'function' ? linksOrUpdater(state.links.map(link => ({ ...link }))) : linksOrUpdater,
    }));
    return committed.links;
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
    if (ext === '.mel-sheet') return _phase1SurfaceType('database', 'file');
    if (ext === '.mel-scenario') return 'scriptnote';
    if (ext === '.mel-timer') return 'unsupported';
    if (ext === '.md') {
      if (lowerName.endsWith('.board.md')) return _phase1SurfaceType('board', 'file');
      const frontmatterType = _extractFrontmatterType(await _readTextSafe(provider, relativePath, ''));
      if (frontmatterType === 'board') return _phase1SurfaceType('board', 'file');
      if (frontmatterType === 'chat') return _phase1SurfaceType('chat', 'file');
      return 'page';
    }
    if (ext === '.json' || lowerName.endsWith('.scriptnote.json') || lowerName.endsWith('.timer.json')) {
      if (lowerName.endsWith('.scriptnote.json')) return 'scriptnote';
      if (lowerName.endsWith('.scenario.json')) return 'scenario';
      if (lowerName.endsWith('.timer.json')) return 'unsupported';
      const parsed = await _readJsonSafe(provider, relativePath, null);
      if (parsed && typeof parsed === 'object') {
        if (parsed.fileType === 'meldex-scriptnote') return 'scriptnote';
        if (parsed.fileType === 'meldex-scenario' || parsed.type === 'scenario') return 'scenario';
        if (parsed.type === 'meldex-timer') return 'unsupported';
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
      }, rootPath);
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
    const scanner = window.MeldexReferenceImpactLiveScan;
    if (!scanner?.query) throw Object.assign(new Error('参照影響の走査機能を利用できません'), { status: 503 });
    if (typeof provider?.readTextBounded !== 'function' || typeof provider?.statPathFresh !== 'function'
        || typeof provider?.walkEntriesFresh !== 'function') {
      throw Object.assign(new Error('bounded参照走査に対応していない保存先です'), { status: 503 });
    }
    const files = []; const seen = new Set();
    for (const rootPath of await _workspaceScanRoots()) {
      const remaining = scanner.MAX_FILES - files.length;
      if (remaining <= 0) throw Object.assign(new Error('参照影響の走査件数上限を超えました'), { status: 503 });
      for (const entry of await provider.walkEntriesFresh(rootPath, { maxEntries: remaining, maxPathBytes: 4 * 1024 * 1024 })) {
        if (entry.kind !== 'file') continue;
        const path = _normalizeFolderPath(entry.path);
        if (_isExcludedWorkspacePath(path)) continue;
        if (!seen.has(path)) { seen.add(path); files.push(path); }
      }
    }
    return scanner.query({
      items, listFiles: async () => files,
      readTextBounded: (path, remaining) => provider.readTextBounded(path, remaining),
      statSize: async path => Number((await provider.statPathFresh(path))?.size),
      isTextLike: scanner.isTextLikePath,
      displayName: path => _displayLabelForPath(path, ''),
    });
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
    _readFolderLinksManaged,
    _writeFolderLinks,
    _updateFolderLinksManaged,
    _normalizeOutlinerOperations,
    _managementScopeIdentity,
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
    _queryDeleteImpact,
    _fnvFileId,
  };
  window.__MeldexPwaDataAccessExtensions = window.__MeldexPwaDataAccessExtensions || [];

  const PWA_WORKSPACES_FILE = '_meldex/workspaces.v1.json';
  const PWA_WORKSPACES_DOCUMENT_ID = 'cloud-workspaces';
  const TEAM_MANAGEMENT_DOCUMENT_PREFIX = 'team-members-v1-';

  function _nowIso() {
    return new Date().toISOString();
  }

  function _httpError(status, message) {
    const err = new Error(message || `HTTP ${status}`);
    err.status = status;
    err.httpStatus = status;
    return err;
  }

  function _teamManagementDocumentId(folderPath) {
    // Dropboxのパス比較は大文字小文字を区別しないため、表記差で別レコードを
    // 作らないよう管理IDだけを小文字へ正規化する。
    const relativeFolder = (_normalizeFolderPath(folderPath) || '.').toLowerCase();
    return TEAM_MANAGEMENT_DOCUMENT_PREFIX + _fnvFileId(relativeFolder);
  }

  function _normalizeTeamFile(team) {
    const base = team && typeof team === 'object' && !Array.isArray(team) ? { ...team } : {};
    if (!base.members || typeof base.members !== 'object' || Array.isArray(base.members)) base.members = {};
    return base;
  }

  function _teamStorageKind() {
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.PROFILES_WORKSPACE;
    if (!kind) throw new Error('チームプロフィール管理データ契約が未初期化です');
    return kind;
  }

  async function _readManagedTeamFile(folderPath) {
    const provider = await _requirePwaProvider('read');
    const kind = _teamStorageKind();
    const managed = await _readManagementPayload(
      provider,
      kind,
      _teamManagementDocumentId(folderPath),
    );
    if (managed.payload) return _normalizeTeamFile(managed.payload);
    // 旧ファイルは既存利用者のメンバー情報を失わないために限って併読する。
    // 保存は必ず型付き管理領域へ行い、source folder側は変更しない。
    return _normalizeTeamFile(
      await _readTeamFile(folderPath).catch(() => ({ members: {} })),
    );
  }

  function _isSystemStorageConflict(error) {
    return error?.name === 'SystemStorageConflictError'
      || error?.code === 'system_storage_conflict';
  }

  async function _writeTeamFileMerged(folderPath, updater) {
    const provider = await _requirePwaProvider('readwrite');
    const kind = _teamStorageKind();
    const documentId = _teamManagementDocumentId(folderPath);
    const adapter = await _managementAdapter(provider, kind);
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await adapter.load(kind, documentId);
      const team = current?.payload
        ? _normalizeTeamFile(current.payload)
        : _normalizeTeamFile(await _readTeamFile(folderPath).catch(() => ({ members: {} })));
      const next = updater(team);
      if (next === false) return { ok: true, skipped: true };
      try {
        const saved = await adapter.save(
          kind,
          documentId,
          _normalizeTeamFile(next || team),
          { expectedRevision: current?.revision ?? null },
        );
        return { ok: true, record: saved };
      } catch (error) {
        lastError = error;
        if (!_isSystemStorageConflict(error)) throw error;
      }
    }
    throw lastError;
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
      // last_seen は書き込みが発生する時（＝プロフィールに実変更がある時）だけ
      // 付随して更新する。無変更の起動・閲覧だけで共有Dropboxの管理ファイルを
      // 書き換えないようにするため、経過時間だけを理由にした強制書き込み判定は
      // 廃止した（last_seen の読み手は一覧整形のみで、UI表示には使われていない
      // ため、更新頻度が下がっても実害はない）。
      avatarForCache = next.avatar || '';
      if (!changed) return false;
      next.last_seen = _nowIso();
      members[name] = next;
      team.members = members;
      wrote = true;
      return team;
    });
    _cacheTeamAvatar(name, avatarForCache, folder);
    return { ok: true, skipped: result?.skipped === true || !wrote };
  }

  // 統合したプロフィールの旧名の行を、新しい名前の行へ移してから消す
  // (デスクトップ版 /api/team/merge と同じ契約)。
  //
  // 安全側の契約:
  //   - 権限は残る側の行の値をそのまま維持し、旧行が owner/admin でも継承しない。
  //   - 旧行が自分以外の accountId を持つ場合は他人の行なので触らない。
  //   - 「新しい行を書いてから旧行を消す」の順で2回書き込む。途中で失敗しても
  //     行が消えたままになることはない。
  async function _mergeTeamMember(folder, body) {
    const name = String(body?.name || '').trim();
    const previousName = String(body?.previousName || body?.previous_name || '').trim();
    if (!name) throw new Error('name は必須です');
    if (!previousName || previousName === name) return { ok: true, skipped: true };
    const accountId = String(body?.accountId || body?.account_id || '').trim();

    let moved = false;
    let blocked = false;
    await _writeTeamFileMerged(folder, team => {
      const members = team.members || {};
      const old = members[previousName];
      if (!old || typeof old !== 'object') return false;
      const oldAccountId = String(old.accountId || '').trim();
      // 旧行が別のDropboxアカウントに紐づいているなら他人の行なので触らない。
      // 自分のaccountIdを名乗れない状態でも、accountId付きの行は消さない。
      if (oldAccountId && oldAccountId !== accountId) {
        blocked = true;
        return false;
      }
      const existing = members[name] && typeof members[name] === 'object' ? { ...members[name] } : {};
      const next = { ...existing };
      // role は残る側の値を維持する。旧行からの owner/admin 継承は行わない。
      if (!next.role) next.role = 'editor';
      if (!next.avatar) next.avatar = old.avatar || '';
      if (accountId) next.accountId = accountId;
      else if (!next.accountId && oldAccountId) next.accountId = oldAccountId;
      const lastSeen = [String(next.last_seen || ''), String(old.last_seen || ''), _nowIso()]
        .reduce((a, b) => (a > b ? a : b), '');
      next.last_seen = lastSeen;
      members[name] = next;
      team.members = members;
      moved = true;
      return team;
    });
    if (blocked) throw new Error('他のメンバーの行は移動できません');
    if (!moved) return { ok: true, skipped: true };

    // 新しい行の書き込みが成功してから、旧行を別の書き込みで消す。
    await _writeTeamFileMerged(folder, team => {
      const members = team.members || {};
      if (!members[previousName]) return false;
      delete members[previousName];
      team.members = members;
      return team;
    });
    return { ok: true, merged: true, from: previousName, to: name };
  }

  function _workspaceRole(role, fallback) {
    const value = String(role || '').trim().toLowerCase();
    return ['owner', 'admin', 'schedule_manager', 'member', 'viewer'].includes(value) ? value : (fallback || 'member');
  }

  function _workspaceMember(member, fallbackName) {
    const userType = String(member?.userType || member?.user_type || 'account').trim();
    if (userType === 'virtual') return null;
    const name = String(member?.name || fallbackName || '').trim();
    if (!name) return null;
    const accountId = String(member?.accountId || member?.account_id || '').trim();
    const row = {
      name,
      userType: 'account',
      role: _workspaceRole(member?.role, 'member'),
      avatar: String(member?.avatar || ''),
      updatedAt: String(member?.updatedAt || member?.updated_at || _nowIso()),
    };
    const userId = String(member?.userId || member?.user_id || member?.id || member?.member_id || accountId || '').trim();
    if (userId) row.userId = userId;
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
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.PROFILES_WORKSPACE;
    if (!kind) throw new Error('ワークスペース管理データ契約が未初期化です');
    const managed = await _readManagementPayload(provider, kind, PWA_WORKSPACES_DOCUMENT_ID);
    const data = managed.payload
      || await _readJsonSafe(provider, PWA_WORKSPACES_FILE, { workspaces: [] });
    return _normalizeWorkspaceStore(data);
  }

  async function _resolveCloudWorkspaceFolder(workspaceId) {
    const id = String(workspaceId || '').trim();
    if (!id) return '';
    const store = await _readCloudWorkspaceStore();
    const workspace = store.workspaces.find(item => item?.id === id && item.deleted !== true);
    if (!workspace) throw _httpError(404, 'ワークスペースが見つかりません');
    const folder = _workspaceFolderPath(workspace.folder || '');
    if (!folder) throw _httpError(409, 'ワークスペースのDropboxフォルダが設定されていません');
    return folder;
  }

  window.__MeldexPwaDataAccessInternals._resolveCloudWorkspaceFolder = _resolveCloudWorkspaceFolder;

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
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.PROFILES_WORKSPACE;
    if (!kind) throw new Error('ワークスペース管理データ契約が未初期化です');
    const result = await _writeManagementPayload(
      provider,
      kind,
      PWA_WORKSPACES_DOCUMENT_ID,
      current => {
        const next = apply(current || { kind: 'meldex-cloud-workspaces', version: 1, workspaces: [] });
        return next === false ? _normalizeWorkspaceStore(current || {}) : next;
      },
    );
    return result ? latest : null;
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
    if (!folder) throw _httpError(400, 'ワークスペースにするフォルダを指定してください');
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
    if (String(body?.user_type || body?.userType || 'account').trim() === 'virtual') {
      throw _httpError(400, '仮ユーザーはログイン権限を持たないため、ワークスペースのアクセスユーザーには追加できません');
    }
    const identities = new Set([
      String(name || '').trim(),
      String(body?.user_id || body?.userId || '').trim(),
    ].filter(Boolean));
    const listRegistryUsers = globalThis.MeldexUserRegistry?.listStaff;
    if (typeof listRegistryUsers === 'function') {
      let registryUsers;
      try {
        registryUsers = await listRegistryUsers.call(globalThis.MeldexUserRegistry, { force: true });
      } catch {
        throw _httpError(503, 'ユーザー管理シートを確認できないため、アクセスユーザーを追加できません');
      }
      const matchedVirtualUser = (Array.isArray(registryUsers) ? registryUsers : []).some(user => {
        if (user?.user_type !== 'virtual') return false;
        return [user.user_id, user.user, user.display].some(value => identities.has(String(value || '').trim()));
      });
      if (matchedVirtualUser) {
        throw _httpError(400, '仮ユーザーはログイン権限を持たないため、ワークスペースのアクセスユーザーには追加できません');
      }
    }
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
        userId: body?.user_id || body?.userId || existing?.userId || '',
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
      const picked = await picker({ title: 'ワークスペースにするフォルダを選択' });
      const path = _workspaceFolderPath(window.GBFolderPicker?.toSourceRelativePath?.(picked) || picked?.path || picked?.relativePath || '');
      if (path) return { ok: true, path, name: _basename(path) || path };
    }
    return { ok: false, path: '', manual: true };
  }

  // --- 個人設定（テーマなどの見た目）の保存先 ---------------------------------
  // デスクトップ版と同じ「その人自身のDropbox個人管理領域」を読み書きする。
  // どちらの環境から開いても同じ実体を見るため、片方で整えた見た目がもう片方にも届く。
  const PERSONAL_PREFERENCE_DOCUMENTS = new Set(['theme-settings', 'shortcut-settings', 'topic-layout-templates', 'restore-point-policy']);
  const WORKSPACE_PREFERENCE_DOCUMENTS = new Set(['restore-point-policy']);

  function _personalPreferenceKind() {
    const contract = window.MeldexSystemStorage;
    if (!contract) throw new Error('gb-system-storage.js が読み込まれていません');
    return contract.SystemStorageKind.USER_PREFERENCES;
  }

  async function _personalPreferenceAdapter() {
    if (_runtime()?.isBrowserMode?.()) {
      const provider = await _requirePwaProvider('read');
      return provider?.getSystemStorageAdapter?.() || null;
    }
    const factory = window.MeldexSystemStorageDropbox;
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!factory || !resolver?.resolveAdapterForProvider) return null;
    return resolver.resolveAdapterForProvider('dropbox', { personalOnly: true });
  }

  function _assertPersonalPreferenceName(name) {
    const doc = String(name || '').trim();
    if (!PERSONAL_PREFERENCE_DOCUMENTS.has(doc)) throw _httpError(404, `未知の個人設定です: ${name}`);
    return doc;
  }

  async function _readPersonalPreference(name) {
    const doc = _assertPersonalPreferenceName(name);
    let adapter = null;
    try {
      adapter = await _personalPreferenceAdapter();
    } catch {
      adapter = null;
    }
    if (!adapter) return { available: false, exists: false, payload: null, revision: null };
    const record = await adapter.load(_personalPreferenceKind(), doc);
    if (!record) return { available: true, exists: false, payload: null, revision: null };
    return { available: true, exists: true, payload: record.payload, revision: record.revision };
  }

  async function _writePersonalPreference(name, body) {
    const doc = _assertPersonalPreferenceName(name);
    const payload = body?.payload;
    if (!payload || typeof payload !== 'object') throw _httpError(400, 'payload はオブジェクトである必要があります');
    let adapter = null;
    try {
      adapter = await _personalPreferenceAdapter();
    } catch {
      adapter = null;
    }
    if (!adapter) return { available: false, ok: false, revision: null };
    const options = {};
    if (Object.prototype.hasOwnProperty.call(body || {}, 'expectedRevision')) {
      options.expectedRevision = body.expectedRevision || null;
    }
    const record = await adapter.save(_personalPreferenceKind(), doc, payload, options);
    return { available: true, ok: true, revision: record?.revision || null };
  }

  function _assertWorkspacePreferenceName(name) {
    const doc = String(name || '').trim();
    if (!WORKSPACE_PREFERENCE_DOCUMENTS.has(doc)) throw _httpError(404, `未知のワークスペース設定です: ${name}`);
    return doc;
  }

  function _workspacePreferenceRole(workspace) {
    const user = String(typeof getUsername === 'function' ? getUsername() : '').trim().toLowerCase();
    const member = (Array.isArray(workspace?.members) ? workspace.members : []).find(row =>
      user && String(row?.name || '').trim().toLowerCase() === user);
    return String(member?.role || '').trim().toLowerCase();
  }

  async function _workspacePreferenceContext(workspaceId, mode) {
    const store = await _readCloudWorkspaceStore();
    const workspace = store.workspaces.find(item => item?.id === String(workspaceId || '') && item.deleted !== true);
    if (!workspace) throw _httpError(404, 'ワークスペースが見つかりません');
    const role = _workspacePreferenceRole(workspace);
    if (!role) throw _httpError(403, 'このワークスペース設定を表示できません');
    if (mode === 'write' && !['owner', 'admin'].includes(role)) {
      throw _httpError(403, '復元ポイント方針を変更できるのは所有者または管理者だけです');
    }
    const provider = await _requirePwaProvider(mode === 'write' ? 'readwrite' : 'read');
    const resolver = window.MeldexDropboxManagementRootResolver;
    const registry = window.MeldexSourceFolderRegistry;
    if (!resolver?.resolveSharedWorkspaceTypedAdapter || !registry?.resolveDropboxPath) {
      return { available: false, workspace, role, adapter: null };
    }
    let dropboxPath = '';
    try { dropboxPath = registry.resolveDropboxPath(workspace.folder || ''); } catch {}
    if (!dropboxPath) return { available: false, workspace, role, adapter: null };
    try {
      const adapter = await resolver.resolveSharedWorkspaceTypedAdapter(
        provider, _personalPreferenceKind(), {
          workspaceDropboxPath: dropboxPath,
          workspaceId: workspace.id,
        },
      );
      return { available: true, workspace, role, adapter };
    } catch {
      return { available: false, workspace, role, adapter: null };
    }
  }

  async function _readWorkspacePreference(workspaceId, name) {
    const doc = _assertWorkspacePreferenceName(name);
    const context = await _workspacePreferenceContext(workspaceId, 'read');
    const base = { available: context.available, scope: 'workspace', workspaceId,
      role: context.role, readOnly: !['owner', 'admin'].includes(context.role) };
    if (!context.adapter) return { ...base, exists: false, payload: null, revision: null };
    const record = await context.adapter.load(_personalPreferenceKind(), doc);
    if (!record) return { ...base, exists: false, payload: null, revision: null };
    return { ...base, exists: true, payload: record.payload, revision: record.revision };
  }

  async function _writeWorkspacePreference(workspaceId, name, body) {
    const doc = _assertWorkspacePreferenceName(name);
    const payload = body?.payload;
    if (!payload || typeof payload !== 'object') throw _httpError(400, 'payload はオブジェクトである必要があります');
    const context = await _workspacePreferenceContext(workspaceId, 'write');
    if (!context.adapter) return { available: false, ok: false, revision: null,
      scope: 'workspace', workspaceId, role: context.role, readOnly: true };
    const options = {};
    if (Object.prototype.hasOwnProperty.call(body || {}, 'expectedRevision')) {
      options.expectedRevision = body.expectedRevision || null;
    }
    const record = await context.adapter.save(_personalPreferenceKind(), doc, payload, options);
    return { available: true, ok: true, revision: record?.revision || null,
      scope: 'workspace', workspaceId, role: context.role, readOnly: false };
  }

  // ---- クラウド直結（端末内保存／Dropboxの両バックエンド）の圧縮・解凍・ZIP閲覧 ----
  // デスクトップ版 app/meldex_archive_service.py と同じ安全上限・巻き戻し方針を
  // gb-archive-zip-engine.js（自己完結ZIPエンジン）+ 既存のfileops抽象で実現する。

  async function _collectFolderFilesForZip(provider, folderPath, arcPrefix, entries) {
    const dirEntries = await _listDirectoryEntries(provider, folderPath);
    for (const entry of dirEntries) {
      const childPath = _joinPath(folderPath, entry.name);
      const childArcName = arcPrefix ? `${arcPrefix}/${entry.name}` : entry.name;
      if (entry.handle.kind === 'directory') {
        await _collectFolderFilesForZip(provider, childPath, childArcName, entries);
      } else {
        const file = await entry.handle.getFile();
        entries.push({ name: childArcName, data: new Uint8Array(await file.arrayBuffer()) });
      }
    }
  }

  function _requireArchiveEngine() {
    const engine = window.MeldexArchiveZipEngine;
    if (!engine) throw _httpError(500, '圧縮・解凍機能を読み込めませんでした。ページを再読み込みしてください');
    return engine;
  }

  async function _archiveCompress(provider, body) {
    const engine = _requireArchiveEngine();
    const rawPaths = Array.isArray(body?.paths) ? body.paths : [body?.path];
    const sourcePaths = rawPaths.map((value) => _normalizeFolderPath(String(value || ''))).filter(Boolean);
    if (!sourcePaths.length) throw _httpError(400, '圧縮対象を指定してください');

    const entries = [];
    for (const sourcePath of sourcePaths) {
      const resolved = await _resolveEntryHandle(provider, sourcePath);
      if (!resolved) throw _httpError(404, '圧縮対象が見つかりません');
      const baseName = _basename(sourcePath);
      if (resolved.kind === 'file') {
        const file = await resolved.handle.getFile();
        entries.push({ name: baseName, data: new Uint8Array(await file.arrayBuffer()) });
      } else {
        await _collectFolderFilesForZip(provider, sourcePath, baseName, entries);
      }
    }

    // 完成したZIPだけを最終名で置く。生成途中のZIPが保存先に残ることはない。
    const zipBytes = await engine.buildZip(entries);

    const rawOutput = String(body?.output_path || body?.outputPath || '').trim();
    let outputDir;
    let outputStem;
    if (rawOutput) {
      const normalizedOutput = _normalizeFolderPath(rawOutput);
      outputDir = _dirname(normalizedOutput);
      outputStem = _splitNameAndExt(_basename(normalizedOutput)).stem || _basename(normalizedOutput);
    } else {
      const first = sourcePaths[0];
      outputDir = _dirname(first);
      const firstStem = _splitNameAndExt(_basename(first)).stem || _basename(first);
      outputStem = firstStem + (sourcePaths.length > 1 ? '_他' : '');
    }
    const finalStem = await _uniqueName(provider, outputDir, outputStem, '.zip');
    const finalName = `${finalStem}.zip`;
    const outputPath = _joinPath(outputDir, finalName);
    await _writeBytes(provider, outputPath, zipBytes);
    return { ok: true, path: outputPath, name: finalName, count: sourcePaths.length };
  }

  async function _archiveReadArchiveBytes(provider, rawArchivePath) {
    const normalizedArchivePath = _normalizeFolderPath(rawArchivePath);
    if (_splitNameAndExt(_basename(normalizedArchivePath)).ext.toLowerCase() !== '.zip') {
      throw _httpError(404, 'ZIPファイルが見つかりません');
    }
    const resolved = await _resolveEntryHandle(provider, normalizedArchivePath);
    if (!resolved || resolved.kind !== 'file') throw _httpError(404, 'ZIPファイルが見つかりません');
    const file = await resolved.handle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { normalizedArchivePath, bytes };
  }

  async function _archiveBrowse(provider, url) {
    const engine = _requireArchiveEngine();
    const { normalizedArchivePath, bytes } = await _archiveReadArchiveBytes(provider, url.searchParams.get('path') || '');
    let parsed;
    try {
      parsed = await engine.parseZip(bytes);
    } catch (error) {
      throw _httpError(error?.status || 400, error?.message || 'ZIPを読み込めませんでした');
    }
    let member;
    try {
      member = engine.normalizeMemberPath(url.searchParams.get('member') || '', { allowRoot: true });
    } catch (error) {
      throw _httpError(error?.status || 400, error?.message || '安全でないZIP内パスです');
    }
    const prefix = member ? `${member}/` : '';
    const childrenByKey = new Map();
    for (const info of parsed.members.values()) {
      if (prefix && !info.name.startsWith(prefix)) continue;
      const remainder = info.name.slice(prefix.length);
      if (!remainder) continue;
      const slashIndex = remainder.indexOf('/');
      const leaf = slashIndex >= 0 ? remainder.slice(0, slashIndex) : remainder;
      const isDir = slashIndex >= 0 || info.isDir;
      const childMember = prefix + leaf;
      const key = leaf.toLowerCase();
      const existing = childrenByKey.get(key);
      if (existing && existing.is_dir !== isDir) {
        throw _httpError(400, `ファイルとフォルダが衝突しています: ${leaf}`);
      }
      if (existing) continue;
      childrenByKey.set(key, {
        name: leaf,
        path: `zip:${normalizedArchivePath}!/${childMember}`,
        type: engine.entryType(leaf, isDir),
        is_dir: isDir,
        size: isDir ? null : info.size,
        modified: info.modifiedIso,
        ext: isDir ? '' : _splitNameAndExt(leaf).ext.toLowerCase(),
        archive_path: normalizedArchivePath,
        archive_member: childMember,
        read_only: true,
      });
    }
    const items = Array.from(childrenByKey.values()).sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name, 'ja', { sensitivity: 'base' });
    });
    return {
      ok: true,
      archive_path: normalizedArchivePath,
      member,
      name: member ? (member.split('/').pop() || member) : _basename(normalizedArchivePath),
      read_only: true,
      message: 'ZIP内は読み取り専用です',
      items,
    };
  }

  function _archiveBytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function _archiveFile(provider, url) {
    const engine = _requireArchiveEngine();
    try {
      const result = await engine.readArchiveMemberViaProvider(
        provider,
        url.searchParams.get('path') || '',
        url.searchParams.get('member') || '',
      );
      return {
        ok: true,
        name: result.name,
        mime: result.mime,
        size: result.bytes.length,
        data: `data:${result.mime};base64,${_archiveBytesToBase64(result.bytes)}`,
      };
    } catch (error) {
      throw _httpError(error?.status || 400, error?.message || 'ZIP内のファイルを読み込めませんでした');
    }
  }

  function _archiveExtractDirName(archivePath) {
    const base = _basename(archivePath);
    if (base.toLowerCase().endsWith('.zip')) return base.slice(0, -4);
    return _splitNameAndExt(base).stem || base;
  }

  // 圧縮ファイルからの制作管理シート定義の上書き保護（Cloud版）。
  //
  // デスクトップ版 meldex_api_shell._check_managed_sheet は
  // meldex_production_management_support.production_sheet_folder_note_name を
  // archive_service.extract_zip_archive の target_check に渡し、ZIP内の各メンバーの
  // 「解凍先での最終パス」が「…/制作管理/シート/<シート名>/<シート名>.md」に一致したら
  // 実際の書き込み（一時展開すら）を始める前に 409 で拒否する。ここではその判定規則を
  // JSへ移植し、_archiveExtract でも書き込み開始前（decode/write より前）に同じ判定を行う。
  //
  // 正規化はデスクトップ版 normalized_path_segments / path_segments_match と揃える:
  // 区切り記号の統一（\ → /）、先頭・途中の "."、末尾スラッシュ、".." の字句解決、
  // Unicode NFC正規化、英字の大文字小文字を無視した比較。判定はパスの「末尾4要素」
  // （制作管理/シート/<name>/<name>.md）で行い、vaultのどの階層に制作管理があっても
  // 検出できるようにする（デスクトップ版と同じ仕様）。
  //
  // 既存の gb-data-access-dropbox-fileops-core.js の _isProductionFolderNotePath と
  // gb-data-access-dropbox-expanded.part01.js の _isProductionProtectedStructurePath は
  // どちらも「先頭からの4要素・単純な===比較」で判定しており、(1) 別ファイルのIIFE内に
  // ローカル定義されているためここから参照できない、(2) NFC正規化・大文字小文字無視を
  // 行っていない、という理由でここでは再利用せず、デスクトップ版と厳密に揃えた実装を
  // 別名で用意する（二重実装ではあるが、既存2箇所も既に同種の理由でそれぞれ独立している）。
  const _PM_ROOT_NAME = '制作管理';
  const _PM_SHEETS_DIR = 'シート';

  function _pmNormalizedPathSegments(path) {
    const text = String(path || '').replace(/\\/g, '/');
    const segments = [];
    for (const raw of text.split('/')) {
      const part = raw.trim().normalize('NFC');
      if (!part || part === '.') continue;
      if (part === '..') { segments.pop(); continue; }
      segments.push(part);
    }
    return segments;
  }

  function _pmSegmentsMatch(actual, expected) {
    // Python版の str.casefold() 相当が無いため toLowerCase() で代用する。
    // 比較対象は日本語のフォルダ名（大文字小文字の概念が無い）と ".md" 拡張子のみのため、
    // casefold と toLowerCase の差（一部の特殊文字での展開規則差）は実用上影響しない。
    return String(actual || '').normalize('NFC').toLowerCase()
      === String(expected || '').normalize('NFC').toLowerCase();
  }

  function _pmManagedSheetFolderNoteName(path) {
    const segments = _pmNormalizedPathSegments(path);
    if (segments.length < 4) return '';
    const note = segments[segments.length - 1];
    const sheet = segments[segments.length - 2];
    const sheetsDir = segments[segments.length - 3];
    const root = segments[segments.length - 4];
    if (!sheet) return '';
    if (!_pmSegmentsMatch(root, _PM_ROOT_NAME)) return '';
    if (!_pmSegmentsMatch(sheetsDir, _PM_SHEETS_DIR)) return '';
    return _pmSegmentsMatch(note, `${sheet}.md`) ? sheet : '';
  }

  function _pmIsManagedSheetFolderNotePath(path) {
    return !!_pmManagedSheetFolderNoteName(path);
  }

  async function _archiveExtract(provider, body) {
    const engine = _requireArchiveEngine();
    const rawPath = String(body?.path || '').trim();
    if (!rawPath) throw _httpError(400, '解凍対象を指定してください');
    const normalizedArchivePath = _normalizeFolderPath(rawPath);
    const archiveExt = _splitNameAndExt(_basename(normalizedArchivePath)).ext.toLowerCase();
    if (archiveExt !== '.zip') {
      throw _httpError(400, 'クラウド版ではZIP形式以外の圧縮ファイルは解凍できません。デスクトップ版をご利用ください');
    }
    const archiveHandle = await _resolveEntryHandle(provider, normalizedArchivePath);
    if (!archiveHandle || archiveHandle.kind !== 'file') throw _httpError(404, '圧縮ファイルが見つかりません');
    const archiveFile = await archiveHandle.handle.getFile();
    const archiveBytes = new Uint8Array(await archiveFile.arrayBuffer());

    let parsed;
    try {
      parsed = await engine.parseZip(archiveBytes);
    } catch (error) {
      throw _httpError(error?.status || 400, error?.message || 'ZIPを読み込めませんでした');
    }

    const rawOutputDir = String(body?.output_dir || body?.outputDir || '').trim();
    const outputDir = rawOutputDir
      ? _normalizeFolderPath(rawOutputDir)
      : _joinPath(_dirname(normalizedArchivePath), _archiveExtractDirName(normalizedArchivePath));
    if (!outputDir) throw _httpError(400, '解凍先を決められませんでした');

    const existingOutput = await _resolveEntryHandle(provider, outputDir);
    if (existingOutput) {
      if (existingOutput.kind !== 'directory') throw _httpError(409, `解凍先が既に存在します: ${_basename(outputDir)}`);
      const existingChildren = await _listDirectoryEntries(provider, outputDir);
      if (existingChildren.length) throw _httpError(409, `解凍先が既に存在します: ${_basename(outputDir)}`);
    }
    const outputPreexisted = !!existingOutput;

    // デスクトップ版と同じ保護: 解凍先での最終パスが制作管理シートのフォルダノート
    // （…/制作管理/シート/<シート名>/<シート名>.md）に一致するメンバーが1件でもあれば、
    // 一時展開・書き込みを一切始める前に拒否する。
    for (const info of parsed.members.values()) {
      const finalPath = _joinPath(outputDir, info.name);
      if (_pmIsManagedSheetFolderNotePath(finalPath)) {
        throw _httpError(409, '圧縮ファイルから制作管理のシート定義は上書きできません');
      }
    }

    // 全メンバーを先に検証・復元してから書き込みを始める
    // （壊れたZIP・上限超過なら書き込みを一切始めない）。
    const members = Array.from(parsed.members.values());
    const decodedFiles = [];
    for (const info of members) {
      if (info.isDir) continue;
      let data;
      try {
        data = await engine.extractMember(archiveBytes, info);
      } catch (error) {
        throw _httpError(error?.status || 400, error?.message || 'ZIPの展開に失敗しました');
      }
      decodedFiles.push({ name: info.name, data });
    }

    async function rollback() {
      try {
        if (outputPreexisted) {
          const leftovers = await _listDirectoryEntries(provider, outputDir);
          for (const leftover of leftovers) {
            await _removeEntry(provider, _joinPath(outputDir, leftover.name));
          }
        } else {
          await _removeEntry(provider, outputDir);
        }
      } catch (_) {
        // 巻き戻し自体の失敗は、呼び出し元へ伝える元のエラーを優先する
      }
    }

    try {
      for (const info of members) {
        if (!info.isDir) continue;
        await _directoryHandle(provider, _joinPath(outputDir, info.name), true);
      }
      if (!members.length) await _directoryHandle(provider, outputDir, true);
      for (const file of decodedFiles) {
        await _writeBytes(provider, _joinPath(outputDir, file.name), file.data);
      }
    } catch (error) {
      await rollback();
      throw _httpError(500, `解凍中にエラーが発生しました: ${error?.message || error}`);
    }

    return { ok: true, path: outputDir, name: _basename(outputDir), count: decodedFiles.length };
  }

  async function _handleArchiveRoute(pathname, method, body, url) {
    const provider = await _requirePwaProvider(method === 'GET' ? 'read' : 'readwrite');
    if (pathname === '/archive/compress' && method === 'POST') return _archiveCompress(provider, body);
    if (pathname === '/archive/extract' && method === 'POST') return _archiveExtract(provider, body);
    if (pathname === '/archive/browse' && method === 'GET') return _archiveBrowse(provider, url);
    if (pathname === '/archive/file' && method === 'GET') return _archiveFile(provider, url);
    throw _httpError(404, '未対応のアーカイブ操作です');
  }

  async function _pwaJsonRequest(path, opts) {
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
      const current = _safeReadJson(PWA_UI_CONFIG_KEY, {});
      const desired = body && typeof body === 'object' ? body : {};
      const currentRevision = await _pwaUiConfigRevision(current);
      const desiredRevision = await _pwaUiConfigRevision(desired);
      if (currentRevision === desiredRevision) return { ok: true, unchanged: true, revision: currentRevision };
      const captured = await _pwaCaptureUiConfigVersion(current, '設定変更前');
      try {
        _requiredWriteJson(PWA_UI_CONFIG_KEY, desired);
      } catch (error) {
        if (captured.changed) _requiredWriteJson(PWA_UI_CONFIG_HISTORY_KEY, captured.previousRows);
        throw error;
      }
      return { ok: true, revision: desiredRevision };
    }
    if (pathname === '/ui-config/history' && method === 'GET') {
      const current = _safeReadJson(PWA_UI_CONFIG_KEY, {});
      const history = _requiredReadJson(PWA_UI_CONFIG_HISTORY_KEY, []);
      return {
        currentRevision: await _pwaUiConfigRevision(current),
        versions: (Array.isArray(history) ? history : []).map(({ snapshot, ...version }) => version),
      };
    }
    const uiConfigHistoryMatch = pathname.match(/^\/ui-config\/history\/([^/]+)(\/restore)?$/);
    if (uiConfigHistoryMatch && method === (uiConfigHistoryMatch[2] ? 'POST' : 'GET')) {
      const versionId = decodeURIComponent(uiConfigHistoryMatch[1]);
      const history = _requiredReadJson(PWA_UI_CONFIG_HISTORY_KEY, []);
      const saved = (Array.isArray(history) ? history : []).find(row => row?.versionId === versionId);
      if (!saved || !saved.snapshot || typeof saved.snapshot !== 'object') throw _httpError(404, '指定した設定の版がありません');
      if (await _pwaUiConfigRevision(saved.snapshot) !== saved.sourceRevision) throw _httpError(409, '保存版の設定の整合性を確認できません');
      const current = _safeReadJson(PWA_UI_CONFIG_KEY, {});
      const currentRevision = await _pwaUiConfigRevision(current);
      if (!uiConfigHistoryMatch[2]) {
        const keys = [...new Set([...Object.keys(saved.snapshot), ...Object.keys(current)])].sort();
        return {
          versionId, currentRevision, version: saved.snapshot, current,
          changes: keys.filter(key => _pwaStableJson(saved.snapshot[key]) !== _pwaStableJson(current[key])).map(key => ({
            key, versionValue: saved.snapshot[key], currentValue: current[key],
          })),
        };
      }
      if (String(body?.expectedRevision || '') !== currentRevision) throw _httpError(409, '表示後に設定が変更されたため復元を中止しました');
      const captured = await _pwaCaptureUiConfigVersion(current, '設定復元前');
      try {
        _requiredWriteJson(PWA_UI_CONFIG_KEY, saved.snapshot);
      } catch (error) {
        if (captured.changed) _requiredWriteJson(PWA_UI_CONFIG_HISTORY_KEY, captured.previousRows);
        throw error;
      }
      return {
        ok: true, config: saved.snapshot, revision: saved.sourceRevision,
        reload: { scope: 'ui-config' },
      };
    }
    if (pathname === '/beta/consent') {
      const consentKey = 'meldex-beta-consent-v1';
      if (method === 'GET') return { consent: _safeReadJson(consentKey, null) };
      if (method === 'PUT') {
        _safeWriteJson(consentKey, body?.consent || null);
        return { ok: true, consent: body?.consent || null };
      }
      if (method === 'DELETE') {
        try { localStorage.removeItem(consentKey); } catch {}
        return { ok: true };
      }
    }
    if (pathname === '/system-fonts' && method === 'GET') return { families: [] };
    if (pathname === '/jobs' && method === 'GET') return { jobs: [] };
    if (pathname === '/startup-ready' && method === 'POST') return { ok: true };
    if (pathname === '/cli-chat/config' && method === 'GET') {
      return { enabled: false, providers: {}, available: false };
    }
    if (pathname === '/settings-db/debug-report/exists' && method === 'GET') return { exists: false };
    if (pathname === '/dropbox-link/status' && method === 'GET') {
      return {
        available: false,
        detected: false,
        activeSyncRoot: '',
        roots: [],
        unsharedLocalFolders: [],
      };
    }
    if (pathname === '/settings-transfer/status' && method === 'GET') {
      return {
        user_data_dir: 'このブラウザの端末内ストレージ',
        items: { config_file: { exists: false }, db_path: { exists: false } },
      };
    }
    if (pathname === '/file-associations/status' && method === 'GET') {
      return { ok: true, supported: false, apps: {} };
    }
    if (pathname === '/team' && method === 'GET') {
      const folder = url.searchParams.get('folder') || '';
      const team = await _readManagedTeamFile(folder);
      Object.entries(team.members || {}).forEach(([name, info]) => _cacheTeamAvatar(name, info?.avatar || '', folder));
      return _toTeamPayload(team);
    }
    if (pathname === '/team/sync' && method === 'POST') {
      const folder = body?.folder || '';
      return _syncTeamMember(folder, body);
    }
    if (pathname === '/team/merge' && method === 'POST') {
      const folder = body?.folder || '';
      return _mergeTeamMember(folder, body);
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
      const variant = _runtime()?.isBrowserMode?.() ? 'browser-local' : 'dropbox';
      return { version: `v${semver} ${betaLabel}`, semver, variant, build: '', commit: '' };
    }
    // ブラウザからはOSのアクセントカラーを読めない。以前は固定の青を返していたが、
    // それは「OSの設定を反映した色」ではないため、デスクトップ版と見た目がずれる原因になる。
    // 取得できないことを正直に返し、テーマ側はブラウザ標準のアクセント色へ委ねる。
    if (pathname === '/os-accent-color' && method === 'GET') return { color: '', available: false };
    if (pathname.startsWith('/personal-preferences/')) {
      const name = pathname.slice('/personal-preferences/'.length);
      if (method === 'GET') return _readPersonalPreference(name);
      if (method === 'PUT') return _writePersonalPreference(name, body);
    }
    {
      const workspacePreferenceMatch = pathname.match(/^\/workspace-preferences\/([^/]+)\/([^/]+)$/);
      if (workspacePreferenceMatch) {
        const workspaceId = decodeURIComponent(workspacePreferenceMatch[1]);
        const name = decodeURIComponent(workspacePreferenceMatch[2]);
        if (method === 'GET') return _readWorkspacePreference(workspaceId, name);
        if (method === 'PUT') return _writeWorkspacePreference(workspaceId, name, body);
      }
    }
    if (pathname.startsWith('/archive/')) {
      return _handleArchiveRoute(pathname, method, body, url);
    }

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
    if (_runtime()?.isBrowserDataMode?.()) {
      const localResult = await _pwaJsonRequest(path, requestOpts);
      if (localResult === NOT_HANDLED) {
        _logCompare({ ...logBase, adapter: `${mode}-unhandled`, durationMs: Math.round(performance.now() - started) });
        const err = new Error('この操作を完了できませんでした。画面を更新してもう一度試してください。');
        err.status = 500;
        err.code = 'cloud_route_unwired';
        err.route = String(path || '');
        throw err;
      }
      _logCompare({ ...logBase, adapter: mode, durationMs: Math.round(performance.now() - started) });
      return localResult;
    }
    const result = await _legacyJsonRequest(path, requestOpts);
    _logCompare({ ...logBase, adapter: 'legacy', durationMs: Math.round(performance.now() - started), mode });
    return result;
  }

  function _teamAvatarUrl(name, query) {
    if (!_runtime()?.isBrowserDataMode?.()) return _resource().teamAvatar(name, query);
    const folder = query?.folder ? _normalizeFolderPath(query.folder) : '';
    return _cachedTeamAvatar(name, folder) || _avatarFallbackUrl(name);
  }

  function _authAvatarUrl(name, query) {
    if (!_runtime()?.isBrowserDataMode?.()) return _resource().authAvatar(name, query);
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
