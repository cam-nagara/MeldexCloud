/* Shared Dropbox runtime for Meldex standalone Cloud apps. */ (function () {
  'use strict';
  const CLOUD_ATTR = 'data-standalone-cloud';
  const ACTIVE_ROOT_KEY = 'meldex-standalone-cloud-active-root';
  const LAST_PATH_KEY = 'meldex-standalone-cloud-last-path';
  const WRITE_ENDPOINTS = new Set([
    '/file', '/upload-file', '/outliner/add', '/outliner/rename',
    '/outliner/delete', '/outliner/delete-batch', '/outliner/restore',
    '/outliner/duplicate', '/outliner/save-as', '/outliner/move',
  ]);
  const TRANSIENT_ACTIVE_LOCK_ENDPOINTS = new Set([...WRITE_ENDPOINTS].filter((endpoint) => endpoint !== '/file'));
  const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico'];
  const APP_SPECS = Object.freeze({
    note: {
      id: 'note', title: 'Meldex Note', defaultFilename: '無題.md', defaultExtension: '.md',
      extensions: ['.md', '.txt'],
    },
    scenario: {
      id: 'scenario', title: 'Meldex Scenario', defaultFilename: '無題.mel-scenario',
      defaultExtension: '.mel-scenario', extensions: ['.mel-scenario', '.scriptnote.json'],
    },
    sheet: {
      id: 'sheet', title: 'Meldex Sheet', defaultFilename: '',
      defaultExtension: '', extensions: [],
    },
    timer: {
      id: 'timer', title: 'Meldex Timer', defaultFilename: '無題.mel-timer',
      defaultExtension: '.mel-timer', extensions: ['.mel-timer', '.timer.json'],
    },
    board: {
      id: 'board', title: 'Meldex Board', defaultFilename: '無題.mel-board',
      defaultExtension: '.mel-board', extensions: ['.mel-board', '.board.md'],
    },
    'quick-memo': {
      id: 'quick-memo', title: 'Meldex クイックメモ', defaultFilename: '', defaultExtension: '', extensions: [],
    },
  });
  const state = {
    initPromise: null,
    initialized: false,
    connected: false,
    roots: [],
    allRoots: [],
    activeRootId: '',
    etags: new Map(),
    config: null,
    boardRootPath: '',
    boardRootHandle: null,
    queuedOpenPath: '',
  };
  let editSession = null;
  let pathPolicy = null;
  class StandaloneCloudConflictError extends Error {
    constructor(message, detail) {
      super(message || 'Dropbox上のファイルが別の端末で更新されています。最新の内容を開き直してください。');
      this.name = 'StandaloneCloudConflictError';
      this.code = 'etag_conflict'; this.status = 409; this.meldexCode = 'etag_conflict';
      this.detail = detail || null;
    }
  }
  function isCloudMode() {
    return document.documentElement?.hasAttribute(CLOUD_ATTR) === true;
  }
  function _safeGet(key, fallbackValue) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallbackValue : value;
    } catch {
      return fallbackValue;
    }
  }
  function _safeSet(key, value) {
    try {
      if (value == null || value === '') localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch { /* localStorage may be unavailable in private browsing. */ }
  }
  function _appIdFromLocation() {
    const explicit = String(document.documentElement?.dataset?.standaloneApp || '').trim().toLowerCase();
    if (APP_SPECS[explicit]) return explicit;
    const cloudValue = String(document.documentElement?.getAttribute(CLOUD_ATTR) || '').trim().toLowerCase();
    if (APP_SPECS[cloudValue]) return cloudValue;
    const filename = String(location.pathname || '').split('/').pop().toLowerCase();
    return Object.keys(APP_SPECS).find((id) => filename.includes(id)) || 'note';
  }
  function getAppSpec() {
    return APP_SPECS[_appIdFromLocation()] || APP_SPECS.note;
  }
  function _pathPolicyModule() {
    const module = window.MeldexStandaloneCloudPathPolicy;
    if (typeof module?.create !== 'function') {
      throw new Error('保存先の境界確認モジュールが未読込のため、安全に操作できません');
    }
    return module;
  }
  function _pathPolicy() {
    if (!pathPolicy) pathPolicy = _pathPolicyModule().create({
      getRoots: () => state.roots,
      getAllRoots: () => state.allRoots,
      getAppSpec,
      resolveDropboxPath: (path) => window.MeldexSourceFolderRegistry?.resolveDropboxPath?.(path),
    });
    return pathPolicy;
  }
  function normalizePath(value) { return _pathPolicyModule().normalizePath(value); }
  function joinPath() { return _pathPolicyModule().joinPath(...arguments); }
  function dirname(path) { return _pathPolicyModule().dirname(path); }
  function basename(path) { return _pathPolicyModule().basename(path); }
  function displayPath(path) {
    const normalized = normalizePath(path);
    const parsed = window.MeldexSourceFolderRegistry?.parseSourcePath?.(normalized);
    return parsed ? normalizePath(parsed.relativePath || '') : normalized;
  }
  function pathLabel(path) {
    const normalized = normalizePath(path);
    const parsed = window.MeldexSourceFolderRegistry?.parseSourcePath?.(normalized);
    if (!parsed) return normalized;
    const root = state.roots.find((item) => item.id === parsed.sourceId);
    const relative = normalizePath(parsed.relativePath || '');
    return [root?.name || 'Meldex', relative].filter(Boolean).join('/');
  }
  function folderName(path) {
    const normalized = normalizePath(path);
    const parsed = window.MeldexSourceFolderRegistry?.parseSourcePath?.(normalized);
    if (!parsed) return basename(normalized) || 'Meldex';
    const relative = normalizePath(parsed.relativePath || '');
    if (relative) return basename(relative);
    return state.roots.find((item) => item.id === parsed.sourceId)?.name || 'Meldex';
  }
  function _fileNameMatches(name, extensions) { return _pathPolicyModule().fileNameMatches(name, extensions); }
  function _bodyObject(body) {
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch { return {}; }
    }
    return body && typeof body === 'object' ? { ...body } : {};
  }
  function _endpoint(path) {
    return new URL('http://standalone.local' + String(path || '')).pathname;
  }
  function _pathQuery(path) {
    return normalizePath(new URL('http://standalone.local' + String(path || '')).searchParams.get('path') || '');
  }
  function _isNotFoundError(error) {
    const message = String(error?.message || error || '');
    return /not_found|path\/not_found|ファイルが見つかりません|見つかりません/i.test(message);
  }
  function _asConflictError(error) {
    const message = String(error?.message || error || '');
    if (error?.status === 409 || error?.code === 'etag_conflict' || error?.meldexCode === 'etag_conflict' || /etag_conflict|更新競合|競合コピー/i.test(message)) {
      return new StandaloneCloudConflictError(
        'Dropbox上のファイルが別の端末で更新されています。元ファイルは上書きしていません。最新の内容を開き直してください。',
        error?.detail || error,
      );
    }
    return error;
  }
  async function _openCloudLink(body) {
    const raw = String(body?.path || '').trim();
    if (!raw) throw new Error('リンク先が指定されていません');
    if (/^https?:\/\//i.test(raw)) {
      window.open(new URL(raw).href, '_blank', 'noopener,noreferrer');
      return { ok: true, external: true };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) throw new Error('この種類の外部リンクは開けません');
    const path = normalizePath(raw);
    const lower = path.toLowerCase();
    const hint = String(body?.linkType || body?.type || '').toLowerCase();
    const sheetLink = ['database', 'sheet', 'pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph'].includes(hint);
    const app = sheetLink ? 'sheet'
      : hint.includes('board') || ['.mel-board', '.board.md'].some((ext) => lower.endsWith(ext)) ? 'board'
      : hint.includes('scenario') || hint.includes('scriptnote') || ['.mel-scenario', '.scriptnote.json'].some((ext) => lower.endsWith(ext)) ? 'scenario'
        : hint.includes('timer') || ['.mel-timer', '.timer.json'].some((ext) => lower.endsWith(ext)) ? 'timer'
          : ['.md', '.txt'].some((ext) => lower.endsWith(ext)) ? 'note' : '';
    if (!app) throw new Error('このリンク先を開けるMeldex単独アプリがありません');
    await ensureReady({ requireConnection: true });
    if (sheetLink) {
      _pathPolicy().assertFolder(path, 'シートを開く');
      const stat = await (await _provider()).statPath(path);
      if (stat?.kind !== 'directory') throw new Error('通常シートのフォルダが見つかりません');
    } else _pathPolicy().assertFile(path, { action: 'リンク先を開く', extensions: APP_SPECS[app].extensions });
    const url = new URL(`apps/${app}/`, document.baseURI || window.location.href);
    url.searchParams.set('open', path);
    window.open(url.href, '_blank', 'noopener,noreferrer');
    return { ok: true, app, path, url: url.href };
  }
  function _dispatch(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* Older embedded webviews may not support CustomEvent. */ }
  }
  function _requireReadDependencies() {
    _pathPolicyModule();
    if (!window.MeldexDropboxAuth) throw new Error('Dropbox認証モジュールが読み込まれていません');
    if (!window.MeldexSourceFolderRegistry) throw new Error('保存先フォルダの管理モジュールが読み込まれていません');
    if (!window.MeldexStorageAdapter?.getProvider) throw new Error('Dropbox保存モジュールが読み込まれていません');
  }
  function _requireWriteDependencies() {
    _requireReadDependencies();
    if (typeof window.MeldexFileLockStore?.requireUnlocked !== 'function') {
      throw new Error('ファイル保護モジュールが未読込のため、安全に保存できません');
    }
  }
  async function _prepareWorkspace() {
    window.MeldexRuntimeAdapter?.setMode?.('dropbox');
    const session = await window.MeldexDropboxAuth.getValidSession();
    state.connected = !!session?.accessToken;
    if (!state.connected) return false;
    await window.MeldexStorageAdapter.restoreWorkspace();
    return true;
  }
  async function _setupAfterAuthorization() {
    window.MeldexRuntimeAdapter?.setMode?.('dropbox');
    if (window.MeldexStorageAdapter?.preflight) {
      const result = await window.MeldexStorageAdapter.preflight();
      if (result?.ok === false) throw new Error(result.message || 'Dropboxの保存場所を準備できません');
    }
    await window.MeldexSourceFolderRegistry.loadRegistry({ writeIfMissing: true });
  }
  async function _loadRoots() {
    if (!state.connected) {
      state.roots = [];
      state.allRoots = [];
      state.activeRootId = '';
      return [];
    }
    const registry = window.MeldexSourceFolderRegistry;
    const roots = typeof registry.loadOutlinerRoots === 'function'
      ? await registry.loadOutlinerRoots()
      : (await registry.loadRegistry({ writeIfMissing: false })).roots.map((root) => registry.toOutlinerRoot(root)).filter(Boolean);
    state.allRoots = roots;
    state.roots = roots.filter((root) => root?.visible !== false);
    const appKey = ACTIVE_ROOT_KEY + ':' + getAppSpec().id;
    const requested = _safeGet(appKey, '');
    const active = state.roots.find((root) => root.id === requested) || state.roots[0] || null;
    state.activeRootId = active?.id || '';
    if (active) _safeSet(appKey, active.id);
    if (!state.boardRootPath) state.boardRootPath = active?.path || '';
    state.boardRootHandle = state.boardRootPath ? _virtualHandle(state.boardRootPath) : null;
    return getRoots();
  }
  function getRoots() {
    return state.roots.map((root) => ({ ...root }));
  }
  function getActiveRoot() {
    return state.roots.find((root) => root.id === state.activeRootId) || null;
  }
  async function setActiveRoot(sourceId) {
    const root = state.roots.find((item) => item.id === String(sourceId || ''));
    if (!root) throw new Error('保存先が見つかりません');
    state.activeRootId = root.id;
    _safeSet(ACTIVE_ROOT_KEY + ':' + getAppSpec().id, root.id);
    state.boardRootPath = root.path;
    state.boardRootHandle = _virtualHandle(root.path);
    _dispatch('meldex:standalone-root-changed', { root: { ...root } });
    return { ...root };
  }
  async function addSource(dropboxPath, name, options) {
    await ensureReady({ requireConnection: true });
    const normalized = window.MeldexSourceFolderRegistry.normalizeDropboxPath(dropboxPath);
    const namespaceKind = window.MeldexSourceFolderRegistry.normalizeNamespaceKind(options?.namespaceKind);
    const metadata = await window.MeldexDropboxAuth.apiRpc('files/get_metadata', {
      path: normalized,
      include_deleted: false,
      include_has_explicit_shared_members: false,
    }, { namespaceKind });
    if (metadata?.['.tag'] !== 'folder') throw new Error('指定したDropboxの保存先はフォルダではありません');
    const root = await window.MeldexSourceFolderRegistry.addDropboxRoot(normalized, name, { namespaceKind });
    await _loadRoots();
    await setActiveRoot(root.id || root.sourceId);
    return getActiveRoot();
  }
  async function init() {
    if (!isCloudMode()) return { cloud: false, connected: false };
    if (state.initPromise) return state.initPromise;
    state.initPromise = (async () => {
      _requireReadDependencies();
      window.MeldexRuntimeAdapter?.setMode?.('dropbox');
      const callback = await window.MeldexDropboxAuth.handleRedirectCallback();
      if (callback?.handled && callback.ok === false) throw new Error(callback.error || 'Dropboxへ接続できませんでした');
      if (callback?.handled && callback.ok === true) await _setupAfterAuthorization();
      await _prepareWorkspace();
      await _loadRoots();
      state.config = _makeConfig('');
      state.initialized = true;
      installAdapters();
      _dispatch('meldex:standalone-cloud-ready', getStatus());
      if (!state.connected) _dispatch('meldex:standalone-auth-required', getStatus());
      return getStatus();
    })().catch((error) => {
      state.initPromise = null;
      state.initialized = false;
      _dispatch('meldex:standalone-cloud-error', { error });
      throw error;
    });
    return state.initPromise;
  }
  async function ensureReady(options) {
    if (!isCloudMode()) throw new Error('Cloud単独アプリとして起動していません');
    await init();
    if (options?.requireConnection !== false && !state.connected) throw new Error('Dropboxへ接続してください');
    return getStatus();
  }
  function getStatus() {
    return {
      cloud: isCloudMode(), initialized: state.initialized, connected: state.connected,
      app: getAppSpec().id, roots: getRoots(), activeRoot: getActiveRoot(),
      workspace: window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null,
    };
  }
  async function beginManualAuth() {
    if (!isCloudMode()) throw new Error('Cloud単独アプリとして起動していません');
    if (!window.MeldexDropboxAuth?.hasConfiguredAppKey?.()) throw new Error('Dropbox App key が設定されていません');
    return window.MeldexDropboxAuth.beginAuth({ manual: true });
  }
  async function exchangeManualCode(code) {
    const value = String(code || '').trim();
    if (!value) throw new Error('Dropboxに表示されたコードを入力してください');
    await window.MeldexDropboxAuth.exchangeManualCode(value);
    await _setupAfterAuthorization();
    state.initPromise = null;
    state.initialized = false;
    const result = await init();
    _dispatch('meldex:standalone-auth-changed', result);
    return result;
  }
  async function disconnect(options) {
    if (!options?.keepSession) await window.MeldexDropboxAuth?.clearSession?.();
    await window.MeldexStorageAdapter?.clearWorkspace?.();
    state.connected = false;
    state.roots = [];
    state.allRoots = [];
    state.activeRootId = '';
    state.etags.clear();
    state.initPromise = null;
    state.initialized = false;
    if (!options?.silent) _dispatch('meldex:standalone-auth-changed', getStatus());
    return getStatus();
  }
  async function _provider() {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new Error('Dropbox保存モジュールが利用できません');
    const workspace = await provider.restoreWorkspace?.();
    if (!workspace) throw new Error('Dropboxへ接続してください');
    return provider;
  }
  async function _requireUnlockedPath(path, options, allowInternal) {
    _requireWriteDependencies();
    const normalized = normalizePath(path);
    _pathPolicy().assertInside(normalized, { allowRoot: true, allowInternal: allowInternal === true, action: 'ファイル保護を確認' });
    const provider = await _provider();
    await window.MeldexFileLockStore.requireUnlocked(provider, normalized, options || {});
    return { ok: true, path: normalized };
  }
  async function requireUnlocked(path, options) { return _requireUnlockedPath(path, options, false); }
  function _sourceRootPath(path) {
    return _pathPolicy().match(path)?.root?.path || '';
  }
  function _splitName(name) { return _pathPolicyModule().splitName(name); }
  async function _uniqueProviderPath(provider, parent, requestedName, suffixLabel) {
    const split = _splitName(requestedName);
    let name = requestedName;
    let path = joinPath(parent, name);
    for (let index = 2; await provider.statPath(path); index += 1) {
      name = `${split.stem}${suffixLabel || '-'}${index}${split.extension}`;
      path = joinPath(parent, name);
    }
    return { name, path };
  }

  function _providerFileRoutes() {
    const routes = window.MeldexStandaloneCloudFileRoutes;
    if (!routes?.handle) throw new Error('Cloudファイル保存モジュールが読み込まれていません');
    return routes;
  }

  function _fallbackFileType(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.mel-board') || lower.endsWith('.board.md')) return 'board';
    if (lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json')) return 'scriptnote';
    if (lower.endsWith('.mel-sheet')) return 'sheet';
    if (lower.endsWith('.smart-db.json')) return 'smart-db';
    if (lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) return 'timer';
    if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'page';
    return 'unknown';
  }

  async function _providerBrowse(provider, url) {
    const folder = normalizePath(url.searchParams.get('path') || '');
    const entries = await provider.listEntries(folder);
    return entries.map((entry) => ({
      name: entry.name,
      path: normalizePath(entry.path || joinPath(folder, entry.name)),
      type: entry.kind === 'directory' ? 'folder' : _fallbackFileType(entry.name),
      kind: entry.kind,
      size: Number(entry.size || 0),
      modified: entry.modified || '',
    }));
  }

  function _searchWarning(stage, path, error) {
    return { stage, path: normalizePath(path), message: String(error?.message || error || '検索中に読み込めませんでした'), status: Number(error?.status || error?.response?.status || 0) || 0 };
  }

  function _isFatalSearchError(error) {
    const status = Number(error?.status || error?.response?.status || 0), detail = `${error?.code || ''} ${error?.message || error || ''}`;
    return status === 401 || status === 403 || (typeof navigator !== 'undefined' && navigator.onLine === false)
      || /offline|network|failed to fetch|unauthori|auth|access[_ -]?token|認証|ネットワーク|接続できません/i.test(detail);
  }

  async function _providerSearch(provider, url) {
    const query = String(url.searchParams.get('q') || '').toLocaleLowerCase('ja');
    const root = normalizePath(url.searchParams.get('path') || getActiveRoot()?.path || '');
    if (!query) return { results: [], total: 0 };
    const queue = [root];
    const results = [];
    let scanned = 0, failed = 0, truncated = false;
    const warnings = [];
    while (queue.length) {
      if (scanned >= 500) { truncated = true; break; }
      const folder = queue.shift();
      let entries;
      try { entries = await provider.listEntries(folder); }
      catch (error) {
        if (folder === root || _isFatalSearchError(error)) throw error;
        failed += 1; warnings.push(_searchWarning('content-folder', folder, error)); continue;
      }
      for (const entry of entries) {
        const path = normalizePath(entry.path || joinPath(folder, entry.name));
        if (!_pathPolicy().allowsInside(path, { allowRoot: false, action: '検索' })) continue;
        if (entry.kind === 'directory') {
          queue.push(path);
          continue;
        }
        scanned += 1;
        if (scanned > 500) { truncated = true; break; }
        if (!_fileNameMatches(path, ['.md', '.board.md', '.txt', '.json', '.scriptnote.json', '.smart-db.json', '.timer.json', '.csv', '.mel-board', '.mel-scenario', '.mel-sheet', '.mel-timer'])) continue;
        try {
          const content = await provider.readText(path);
          if (content.toLocaleLowerCase('ja').includes(query)) {
            results.push({ path, name: basename(path), type: _fallbackFileType(path), match: 'content' });
          }
        } catch (error) {
          if (_isFatalSearchError(error)) throw error;
          failed += 1; warnings.push(_searchWarning('content-file', path, error));
        }
      }
    }
    return { results, total: results.length, truncated: truncated || queue.length > 0, failed, warnings, scanned };
  }

  async function _providerRequest(path, options) {
    const provider = await _provider();
    const url = new URL('http://standalone.local' + String(path || ''));
    const endpoint = url.pathname;
    const method = String(options?.method || 'GET').toUpperCase();
    const body = _bodyObject(options?.body);
    if (endpoint === '/browse' && method === 'GET') return _providerBrowse(provider, url);
    if (endpoint === '/search' && method === 'GET') return _providerSearch(provider, url);
    const fileRoute = await _providerFileRoutes().handle({
      endpoint,
      method,
      body,
      url,
      provider,
      normalizePath,
      ConflictError: StandaloneCloudConflictError,
    });
    if (fileRoute.handled) return fileRoute.value;
    if (endpoint === '/outliner/add' && method === 'POST' && body?.type === 'folder') {
      const parent = normalizePath(body?.parent || '');
      const requested = String(body?.label || '新しいフォルダ').replace(/[\\/]/g, '').trim() || '新しいフォルダ';
      const target = await _uniqueProviderPath(provider, parent, requested, '-');
      await requireUnlocked(target.path, { action: 'create-destination' });
      await provider.ensureDirectory(target.path);
      return { ok: true, node: { type: 'folder', label: target.name, path: target.path, children: [] } };
    }
    if (endpoint === '/outliner/duplicate' && method === 'POST') {
      const source = normalizePath(body?.path || '');
      const stat = await provider.statPath(source);
      if (!stat) throw new Error('複製する項目が見つかりません');
      const split = _splitName(basename(source));
      const requested = stat.kind === 'file' ? `${split.stem}_copy${split.extension}` : `${split.stem}_copy`;
      const target = await _uniqueProviderPath(provider, dirname(source), requested, '-');
      await requireUnlocked(target.path, { action: 'duplicate-destination' });
      await provider.copyPath(source, target.path);
      await _providerFileRoutes().regenerateCopiedDocumentIdentity(provider, target.path);
      return { ok: true, new_path: target.path, new_name: target.name };
    }
    if (endpoint === '/outliner/delete' && method === 'POST') {
      const source = normalizePath(body?.path || '');
      const trashRoot = joinPath(_sourceRootPath(source), '_trash');
      await provider.ensureDirectory(trashRoot);
      const requested = `${Date.now()}-${basename(source)}`;
      const target = await _uniqueProviderPath(provider, trashRoot, requested, '-');
      await _requireUnlockedPath(target.path, { action: 'delete-trash-destination' }, true);
      await provider.movePath(source, target.path);
      return { ok: true, path: source, trash_path: target.path };
    }
    if (endpoint === '/outliner/move' && method === 'POST') {
      const source = normalizePath(body?.path || '');
      const destination = normalizePath(body?.dest_folder || '');
      let target = { path: joinPath(destination, basename(source)), name: basename(source) };
      if (await provider.statPath(target.path)) target = await _uniqueProviderPath(provider, destination, basename(source), '-');
      await requireUnlocked(target.path, { action: 'move-destination' });
      await provider.movePath(source, target.path);
      return { ok: true, new_path: target.path, new_name: target.name };
    }
    if (endpoint === '/outliner/save-as' && method === 'POST') {
      const source = normalizePath(body?.path || '');
      const stat = await provider.statPath(source);
      if (!stat) throw new Error('複製する項目が見つかりません');
      const split = _splitName(basename(source));
      const requested = stat.kind === 'file' ? `${String(body?.new_name || split.stem)}${split.extension}` : String(body?.new_name || split.stem);
      const target = await _uniqueProviderPath(provider, normalizePath(body?.dest_folder || dirname(source)), requested, '-');
      await requireUnlocked(target.path, { action: 'save-as-destination' });
      await provider.copyPath(source, target.path);
      await _providerFileRoutes().regenerateCopiedDocumentIdentity(provider, target.path);
      return { ok: true, new_path: target.path, new_name: target.name };
    }
    throw Object.assign(new Error('このCloud操作は利用できません: ' + endpoint), { code: 'cloud_route_unwired' });
  }

  async function _callDataOrProvider(path, options) {
    if (window.MeldexDataAccess?.requestJson) {
      try {
        return await window.MeldexDataAccess.requestJson(path, options || {});
      } catch (error) {
        if (error?.code !== 'cloud_route_unwired') throw error;
      }
    }
    return _providerRequest(path, options || {});
  }

  function _filterPathResults(result) {
    const filter = (item) => _pathPolicy().allowsInside(item?.path || '', { allowRoot: false, action: '表示' });
    if (Array.isArray(result)) return result.filter(filter);
    if (Array.isArray(result?.results)) return { ...result, results: result.results.filter(filter) };
    return result;
  }

  function _lockPaths(endpoint, path, body) {
    if (endpoint === '/file') return [_pathQuery(path)];
    if (endpoint === '/upload-file') return [joinPath(_pathQuery(path), body?.filename || body?.name || '')];
    if (endpoint === '/outliner/add') return [normalizePath(body?.parent || '')];
    if (endpoint === '/outliner/delete-batch') {
      return (Array.isArray(body?.items) ? body.items : []).map((item) => normalizePath(item?.path || ''));
    }
    if (endpoint === '/outliner/rename') {
      const source = normalizePath(body?.old_path || body?.path || '');
      const base = source && body?.new_name ? joinPath(dirname(source), String(body.new_name)) : '';
      const extension = source ? _splitName(basename(source)).extension : '';
      return [source, base, base ? base + extension : ''].filter(Boolean);
    }
    if (endpoint === '/outliner/move') return [normalizePath(body?.path || ''), normalizePath(body?.dest_folder || '')];
    if (endpoint === '/outliner/save-as') return [normalizePath(body?.path || ''), normalizePath(body?.dest_folder || '')];
    if (endpoint.startsWith('/outliner/')) return [normalizePath(body?.path || '')];
    return [];
  }

  function _uniqueLockPaths(paths) { return [...new Set((paths || []).map(normalizePath).filter(Boolean))]; }
  function _activeLockPaths(endpoint, path, body) {
    if (endpoint === '/outliner/add') return [joinPath(
      normalizePath(body?.parent || ''),
      String(body?.label || '新しいフォルダ').replace(/[\\/]/g, '').trim() || '新しいフォルダ',
    )];
    if (endpoint === '/outliner/move') {
      const source = normalizePath(body?.path || '');
      return [source, joinPath(normalizePath(body?.dest_folder || ''), basename(source))];
    }
    return _lockPaths(endpoint, path, body);
  }
  async function _releaseTransientActiveLocks(paths, heldBefore, lease) {
    if (lease) return Promise.resolve(lease.release()).catch(() => {});
    const locks = window.MeldexActiveLocks;
    if (typeof locks?.releaseLock !== 'function') return;
    await Promise.all(paths
      .filter((lockPath) => !heldBefore.has(lockPath))
      .map((lockPath) => Promise.resolve(locks.releaseLock(lockPath)).catch(() => {})));
  }
  async function _directRead(path) {
    const normalized = normalizePath(path);
    const payload = await _callDataOrProvider('/file?path=' + encodeURIComponent(normalized), { method: 'GET' });
    const result = {
      path: normalizePath(payload?.path || normalized),
      content: String(payload?.content || ''),
      etag: String(payload?.etag || ''),
    };
    if (result.etag) state.etags.set(result.path, result.etag);
    return result;
  }

  async function _expectedEtag(path, body) {
    const explicit = String(body?.if_match_etag || body?.ifMatchEtag || '').trim();
    if (explicit) return explicit;
    return state.etags.get(path) || '';
  }

  async function _resolveRestorePath(body) {
    const trashName = String(body?.trash_name || '').trim();
    if (!trashName || basename(trashName) !== trashName) throw new Error('復元する項目が不正です');
    const trashRoot = _pathPolicy().assertTrashRoot(body?.trash_root || '');
    const provider = await _provider();
    const metaPath = joinPath(trashRoot, trashName + '._trash_meta.json');
    let metadata = null;
    if (typeof provider.readJson === 'function') metadata = await provider.readJson(metaPath);
    else if (typeof provider.readText === 'function') metadata = JSON.parse(await provider.readText(metaPath));
    if (!metadata?.original_path) throw new Error('復元先を安全に確認できません');
    if (metadata.trash_root && _pathPolicy().assertTrashRoot(metadata.trash_root) !== trashRoot) {
      throw new Error('復元元の保存先が一致しません');
    }
    body.path = _pathPolicy().restoreDestination(trashRoot, metadata.original_path);
    body.original_path = body.path;
  }

  async function requestJson(path, options) {
    _pathPolicy();
    const endpoint = _endpoint(path);
    const method = String(options?.method || 'GET').toUpperCase();
    if (endpoint === '/board-app/open-link' && method === 'POST') return _openCloudLink(_bodyObject(options?.body));
    await ensureReady({ requireConnection: true });
    const write = method !== 'GET' && WRITE_ENDPOINTS.has(endpoint);
    if (write) _requireWriteDependencies();
    let opts = { ...(options || {}), method };
    const originalBody = _bodyObject(opts.body);
    const mutationSourcePath = normalizePath(originalBody?.old_path || originalBody?.path || '');
    if (endpoint === '/outliner/restore' && method === 'POST') await _resolveRestorePath(originalBody);
    _pathPolicy().authorizeRequest({ endpoint, method, queryPath: _pathQuery(path), body: originalBody });
    if (opts.body != null) opts.body = originalBody;
    if (write) {
      const manualLockPaths = _uniqueLockPaths(_lockPaths(endpoint, path, originalBody));
      for (const lockPath of manualLockPaths) {
        const includeDescendants = ['/outliner/delete', '/outliner/delete-batch'].includes(endpoint)
          || (['/outliner/move', '/outliner/rename'].includes(endpoint) && lockPath === mutationSourcePath);
        await requireUnlocked(lockPath, {
          action: 'standalone-' + endpoint.replace(/^\//, '').replace(/\//g, '-'),
          includeDescendants,
        });
      }
    }
    const activeLockPaths = write ? _uniqueLockPaths(_activeLockPaths(endpoint, path, originalBody)) : [];
    const transientActiveLocks = write && TRANSIENT_ACTIVE_LOCK_ENDPOINTS.has(endpoint);
    const heldBefore = new Set(activeLockPaths.filter((lockPath) => window.MeldexActiveLocks?._localLocks?.has?.(lockPath)));
    let activeLockAttempted = false, transientLease = null;
    let trackedPath = endpoint === '/file' ? _pathQuery(path) : '';
    try {
      if (write && window.MeldexActiveLocks?.beforeApiFetch) {
        activeLockAttempted = true;
        if (transientActiveLocks && window.MeldexActiveLocks.acquireMutationLocks) transientLease = await window.MeldexActiveLocks.acquireMutationLocks(activeLockPaths);
        opts = await window.MeldexActiveLocks.beforeApiFetch(path, opts, { candidatePaths: activeLockPaths });
      }
      if (endpoint === '/file' && method !== 'GET') {
        const body = _bodyObject(opts.body);
        const forceOverwrite = !!(body.force_overwrite || body.forceOverwrite);
        const coordinator = window.MeldexDocumentSaveCoordinator;
        const suppliedRevision = body.transport_revision || body.transportRevision || '';
        if (suppliedRevision && coordinator?.revisionTokenForWrite) {
          body.if_match_etag = coordinator.revisionTokenForWrite(suppliedRevision, 'dropbox-rev');
        }
        const expected = forceOverwrite ? '' : await _expectedEtag(trackedPath, body);
        const createOnly = !!(body.create_only || body.createOnly);
        if (!forceOverwrite && !expected && !createOnly) {
          const error = new Error('保存先の更新情報を確認できません。ファイルを開き直してから保存してください。');
          error.status = 428; error.code = 'precondition_required'; error.meldexCode = 'precondition_required';
          throw error;
        }
        if (expected) body.if_match_etag = expected;
        opts.body = body;
      }
      let result = await _callDataOrProvider(path, opts);
      if (method === 'GET' && (endpoint === '/browse' || endpoint === '/search')) result = _filterPathResults(result);
      if (endpoint === '/file' && method === 'GET') {
        trackedPath = normalizePath(result?.path || trackedPath);
        if (result?.etag) state.etags.set(trackedPath, String(result.etag));
      } else if (endpoint === '/file' && method !== 'GET') {
        if (result?.missing) state.etags.delete(trackedPath);
        else if (result?.etag) state.etags.set(trackedPath, String(result.etag));
      }
      if (
        ['/outliner/move', '/outliner/rename'].includes(endpoint)
        && mutationSourcePath
        && result?.new_path
      ) {
        window.MeldexDocumentSaveCoordinator?.rebindDocumentPathPrefix?.(
          mutationSourcePath,
          normalizePath(result.new_path),
        );
      }
      if (write) _dispatch('meldex:standalone-workspace-mutated', { endpoint, path: trackedPath, result });
      return result;
    } catch (error) {
      throw _asConflictError(error);
    } finally {
      if (transientActiveLocks && activeLockAttempted) {
        await _releaseTransientActiveLocks(activeLockPaths, heldBefore, transientLease);
      }
    }
  }

  async function browse(path, options) {
    const target = normalizePath(path || getActiveRoot()?.path || '');
    const query = new URLSearchParams({ path: target, all_files: '1', detail: options?.detail === false ? '0' : '1' });
    if (options?.foldersOnly) query.set('folders_only', '1');
    return requestJson('/browse?' + query.toString());
  }
  async function _walkNames(rootPath, query, result, options) {
    const queue = [{ path: normalizePath(rootPath), depth: 0 }];
    const limit = Math.max(50, Number(options?.limit || 800));
    const maxDepth = Math.max(1, Number(options?.maxDepth || 20));
    const metadata = { truncated: false, failed: 0, warnings: [], scanned: 0 };
    while (queue.length && result.length < limit) {
      const current = queue.shift();
      let entries;
      try { entries = await browse(current.path, { detail: false }); }
      catch (error) {
        if (current.depth === 0 || _isFatalSearchError(error)) throw error;
        metadata.failed += 1; metadata.warnings.push(_searchWarning('name-folder', current.path, error)); continue;
      }
      for (let index = 0; index < entries.length; index += 1) {
        const item = entries[index];
        metadata.scanned += 1;
        const name = String(item?.name || basename(item?.path || ''));
        if (name.toLocaleLowerCase('ja').includes(query)) result.push({ ...item, match: 'name' });
        const isFolder = item?.type === 'folder' || item?.kind === 'directory';
        if (isFolder && current.depth < maxDepth) queue.push({ path: normalizePath(item.path), depth: current.depth + 1 });
        if (result.length >= limit) { metadata.truncated = index + 1 < entries.length || queue.length > 0; break; }
      }
    }
    if (queue.length) metadata.truncated = true;
    return metadata;
  }
  async function search(query, options) {
    await ensureReady({ requireConnection: true });
    const text = String(query || '').trim();
    if (!text) return [];
    const rootPath = normalizePath(options?.path || getActiveRoot()?.path || '');
    const nameResults = [];
    const contentUrl = '/search?' + new URLSearchParams({ q: text, path: rootPath }).toString();
    const contentTask = options?.content === false ? Promise.resolve({ results: [] }) : requestJson(contentUrl);
    const [nameMetadata, contentPayload] = await Promise.all([
      _walkNames(rootPath, text.toLocaleLowerCase('ja'), nameResults, options), contentTask,
    ]);
    const contentResults = Array.isArray(contentPayload) ? contentPayload : (Array.isArray(contentPayload?.results) ? contentPayload.results : []);
    const contentMetadata = contentPayload?.metadata || contentPayload || {};
    const byPath = new Map();
    nameResults.concat(contentResults.map((item) => ({ ...item, match: 'content' }))).forEach((item) => {
      const path = normalizePath(item?.path || '');
      if (path && !byPath.has(path)) byPath.set(path, { ...item, path });
    });
    const results = [...byPath.values()];
    results.metadata = {
      total: results.length,
      truncated: !!nameMetadata.truncated || !!contentMetadata.truncated,
      failed: nameMetadata.failed + Number(contentMetadata.failed || 0),
      warnings: nameMetadata.warnings.concat(Array.isArray(contentMetadata.warnings) ? contentMetadata.warnings : []),
      scanned: nameMetadata.scanned + Number(contentMetadata.scanned || 0),
    };
    return results;
  }
  async function readText(path) {
    await ensureReady({ requireConnection: true });
    return _directRead(_pathPolicy().assertFile(path, { action: 'ファイルを開く' }));
  }

  async function writeText(path, content, extra) {
    const normalized = _pathPolicy().assertFile(path, { action: 'ファイルを保存' });
    if (!normalized) throw new Error('保存先ファイルを選択してください');
    const body = { content: String(content ?? ''), ..._bodyObject(extra) };
    const result = await requestJson('/file?path=' + encodeURIComponent(normalized), { method: 'PUT', body });
    return { ...result, path: normalized };
  }

  async function createFolder(parent, label) {
    const result = await requestJson('/outliner/add', {
      method: 'POST', body: { type: 'folder', parent: normalizePath(parent), label: String(label || '新しいフォルダ') },
    });
    return result?.node || result;
  }

  function newContent(title, appId) {
    const id = appId || getAppSpec().id;
    const safeTitle = String(title || '');
    if (id === 'note') return '';
    if (id === 'scenario') return JSON.stringify({
      fileType: 'meldex-scriptnote', schema_version: 3, version: 1,
      title: safeTitle === '無題' ? '' : safeTitle, layoutMode: 'manga',
      editor: { wrapMode: true, statusEnabled: false, viewMode: 'horizontal' },
      scenarioTypes: [], characters: [], characterDb: [], notes: [], rubyRules: [], rows: [], source: {},
    }, null, 2) + '\n';
    if (id === 'sheet') return '';
    if (id === 'timer') return JSON.stringify({
      type: 'meldex-timer', version: 1, name: safeTitle === '無題' ? '' : safeTitle,
      timer: { displayMode: 'digital', totalSeconds: 300, elapsed: 0, countUp: false,
        timerRunning: false, timerStarted: false, elapsedAtStart: 0, timerStartMs: 0 },
    }, null, 2) + '\n';
    return `---\ntype: board\nxmind:\n  n0: {autoStyle: true}\n---\n# ${safeTitle || '無題'}\n\n`;
  }

  function _ensureExtension(name, spec) {
    return _pathPolicyModule().ensureExtension(name, spec);
  }

  async function createFile(parent, label, options) {
    const spec = APP_SPECS[options?.appId] || getAppSpec();
    const rawName = _ensureExtension(label || spec.defaultFilename, spec);
    const entries = await browse(parent, { detail: false });
    const lowerNames = new Set(entries.map((item) => basename(item.path || item.name).toLowerCase()));
    const dot = rawName.indexOf('.');
    const stem = dot > 0 ? rawName.slice(0, dot) : rawName;
    const extension = dot > 0 ? rawName.slice(dot) : '';
    let name = rawName;
    for (let index = 2; lowerNames.has(name.toLowerCase()); index += 1) name = `${stem}-${index}${extension}`;
    const path = joinPath(parent, name);
    const title = name.slice(0, Math.max(0, name.length - extension.length));
    const result = await writeText(path, options?.content ?? newContent(title, spec.id), { create_only: true });
    return { ...result, name, path, type: spec.id };
  }

  async function duplicate(path) {
    return requestJson('/outliner/duplicate', { method: 'POST', body: { path: normalizePath(path) } });
  }

  async function deletePath(path) {
    const target = _getEditSession().assertCanDelete(path);
    return requestJson('/outliner/delete', { method: 'POST', body: { path: target } });
  }

  async function move(path, destinationFolder) {
    const source = normalizePath(path);
    const result = await requestJson('/outliner/move', {
      method: 'POST', body: { path: source, dest_folder: normalizePath(destinationFolder) },
    });
    if (result?.new_path) {
      const destination = normalizePath(result.new_path);
      if (state.etags.has(source)) {
        const etag = state.etags.get(source);
        state.etags.delete(source);
        state.etags.set(destination, etag);
      }
      _getEditSession().notifyMove(source, destination);
    }
    return result;
  }

  async function listFiles(rootPath, options) {
    const results = [];
    await _walkNames(rootPath || getActiveRoot()?.path || '', '', results, { limit: options?.limit || 2000, maxDepth: 30 });
    return results.filter((item) => item.type !== 'folder' && _fileNameMatches(item.path || item.name, options?.extensions));
  }

  function _treeApi() {
    const tree = window.MeldexStandaloneWorkspaceTree;
    if (!tree) throw new Error('保存先フォルダ画面が読み込まれていません');
    return tree;
  }

  async function pickOpen(options) {
    await ensureReady({ requireConnection: true });
    return _treeApi().pickOpen({ extensions: options?.extensions || getAppSpec().extensions, title: options?.title || 'ファイルを開く' });
  }

  async function pickSaveAs(options) {
    await ensureReady({ requireConnection: true });
    return _treeApi().pickSaveAs({
      title: options?.title || '名前を付けて保存',
      suggestedName: options?.suggestedName || getAppSpec().defaultFilename,
      extensions: options?.extensions || getAppSpec().extensions,
      defaultExtension: options?.defaultExtension || getAppSpec().defaultExtension,
    });
  }

  function _makeConfig(path) {
    const spec = getAppSpec();
    const active = getActiveRoot();
    let initialPath = '';
    if (state.connected) {
      const candidate = path || new URLSearchParams(location.search).get('open') || _safeGet(LAST_PATH_KEY + ':' + spec.id, '');
      initialPath = _pathPolicy().initialFile(candidate, spec.extensions);
    }
    return {
      cloud: true, appId: spec.id, title: spec.title, root: active?.name || '', rootPath: active?.path || '',
      initialPath,
      defaultFilename: spec.defaultFilename, defaultExtension: spec.defaultExtension, extensions: [...spec.extensions],
    };
  }

  async function saveContentAs(content, suggestedName, options) {
    const spec = APP_SPECS[options?.appId] || getAppSpec();
    const picked = await pickSaveAs({ suggestedName, extensions: spec.extensions, defaultExtension: spec.defaultExtension });
    if (!picked?.path) return null;
    const result = await writeText(picked.path, content,
      picked.existing ? { if_match_etag: picked.etag } : { create_only: true });
    _safeSet(LAST_PATH_KEY + ':' + spec.id, picked.path);
    return { path: picked.path, config: _makeConfig(picked.path), etag: result?.etag || '' };
  }

  function _virtualHandle(path) {
    const normalized = normalizePath(path);
    return { cloud: true, path: normalized, name: folderName(normalized) };
  }

  async function _fileAsDataUrl(path, extensions) {
    return _providerFileRoutes().fileAsDataUrl({
      path,
      extensions,
      ensureReady,
      assertFile: (target, options) => _pathPolicy().assertFile(target, options),
      getProvider: () => window.MeldexStorageAdapter?.getProvider?.(),
    });
  }

  function _getEditSession() {
    if (editSession) return editSession;
    const factory = window.MeldexStandaloneEditSession?.create;
    if (typeof factory !== 'function') throw new Error('Cloud編集セッションモジュールが読み込まれていません');
    editSession = factory({
      state,
      appSpecs: APP_SPECS,
      lastPathKey: LAST_PATH_KEY,
      safeGet: _safeGet,
      safeSet: _safeSet,
      normalizePath,
      dirname,
      basename,
      folderName,
      fileNameMatches: _fileNameMatches,
      getAppSpec,
      getActiveRoot,
      ensureReady,
      makeConfig: _makeConfig,
      pathLabel,
      pickOpen,
      treeApi: _treeApi,
      virtualHandle: _virtualHandle,
      newContent,
      readText,
      writeText,
      saveContentAs,
      fileAsDataUrl: getAppSpec().id === 'board' ? (path) => _fileAsDataUrl(path, IMAGE_EXTENSIONS) : _fileAsDataUrl,
      listFiles,
    });
    return editSession;
  }

  function installAdapters() {
    if (!isCloudMode()) return { installed: false, reason: 'not-cloud' };
    _providerFileRoutes().installApiGlobals(requestJson);
    return _getEditSession().installAdapters();
  }

  const api = {
    APP_SPECS,
    StandaloneCloudConflictError,
    isCloudMode,
    getAppSpec,
    getStatus,
    init,
    ensureReady,
    beginManualAuth,
    exchangeManualCode,
    disconnect,
    getRoots,
    getActiveRoot,
    setActiveRoot,
    addSource,
    normalizePath,
    joinPath,
    dirname,
    basename,
    displayPath,
    pathLabel,
    requireUnlocked,
    requestJson,
    browse,
    search,
    readText,
    writeText,
    newContent,
    createFolder,
    createFile,
    duplicate,
    deletePath,
    move,
    listFiles,
    pickOpen,
    pickSaveAs,
    saveContentAs,
    installAdapters,
  };

  window.MeldexStandaloneCloud = api;
  if (isCloudMode()) {
    const start = () => {
      installAdapters();
      init().catch(() => {});
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else queueMicrotask(start);
  }
})();
