/* Current-file editing session and Cloud filesystem adapter wiring. */
(function () {
  'use strict';

  function create(options) {
    const host = options?.host || window;
    const shared = options?.state;
    if (!shared || typeof options?.normalizePath !== 'function') {
      throw new Error('Cloud編集セッションの初期化情報が不足しています');
    }

    const session = {
      currentPath: '',
      adaptersInstalled: false,
      editActivityInstalled: false,
      editLockPath: '',
      editLockPromise: null,
      pendingBoardOpen: null,
      openEventInstalled: false,
      renameEventInstalled: false,
    };

    const normalizePath = options.normalizePath;
    const currentApp = () => options.getAppSpec();
    const activeLocks = () => host.MeldexActiveLocks;

    function setCurrentPath(path) {
      const previous = session.currentPath;
      session.currentPath = normalizePath(path || '');
      if (previous !== session.currentPath) {
        session.editLockPath = '';
        session.editLockPromise = null;
      }
      options.safeSet(options.lastPathKey + ':' + currentApp().id, session.currentPath);
      if (previous && previous !== session.currentPath) {
        activeLocks()?.releaseLock?.(previous).catch?.(() => {});
      }
      return session.currentPath;
    }

    function currentPath() {
      return session.currentPath;
    }

    function discardRememberedPath(path) {
      const normalized = normalizePath(path || '');
      if (!normalized) return false;
      const key = options.lastPathKey + ':' + currentApp().id;
      if (options.safeGet(key, '') !== normalized) return false;
      options.safeSet(key, '');
      return true;
    }

    async function ensureEditLock(path) {
      return activeLocks()?.ensureLock?.(normalizePath(path)) || null;
    }

    async function releaseEditLock(path) {
      return activeLocks()?.releaseLock?.(normalizePath(path)) || null;
    }

    function _isEditableTarget(target) {
      if (typeof target?.matches !== 'function') return false;
      if (target.closest?.('#sa-workspace-drawer, #sa-pwa-install-dialog')) return false;
      return target.matches([
        'textarea:not([readonly]):not([disabled])',
        'select:not([disabled])',
        '[contenteditable="true"]',
        '[contenteditable="plaintext-only"]',
        'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]):not([type="search"]):not([readonly]):not([disabled])',
      ].join(','));
    }

    function _acquireEditActivityLock(path) {
      const locks = activeLocks();
      if (!locks?.ensureLock) return;
      session.editLockPath = path;
      let acquisition;
      try { acquisition = locks.ensureLock(path); }
      catch { session.editLockPath = ''; return; }
      const pending = Promise.resolve(acquisition)
        .then(() => {
          if (session.currentPath !== path) return releaseEditLock(path);
          return null;
        })
        .catch(() => {
          if (session.editLockPath === path) session.editLockPath = '';
        })
        .finally(() => {
          if (session.editLockPromise === pending) session.editLockPromise = null;
        });
      session.editLockPromise = pending;
    }

    function _handleEditActivity(event) {
      const path = session.currentPath;
      if (!path || !_isEditableTarget(event?.target)) return;
      const locks = activeLocks();
      if (session.editLockPath !== path) {
        _acquireEditActivityLock(path);
        return;
      }
      const touched = locks?.touchLock?.(path) === true;
      if (!touched && !session.editLockPromise) _acquireEditActivityLock(path);
    }

    function _installEditActivity() {
      if (session.editActivityInstalled) return;
      host.addEventListener('input', _handleEditActivity, true);
      host.addEventListener('change', _handleEditActivity, true);
      session.editActivityInstalled = true;
    }

    function installEditPathApi(fs) {
      fs.setCurrentPath = setCurrentPath;
      fs.currentPath = currentPath;
      fs.ensureEditLock = ensureEditLock;
      fs.releaseEditLock = releaseEditLock;
      fs.discardRememberedPath = discardRememberedPath;
    }

    function assertCanDelete(path) {
      const target = normalizePath(path);
      if (session.currentPath && (session.currentPath === target || session.currentPath.startsWith(target + '/'))) {
        throw new Error('現在開いているファイルまたは保存先フォルダは削除できません。別のファイルを開いてから実行してください。');
      }
      return target;
    }

    function notifyMove(sourcePath, destinationPath) {
      const source = normalizePath(sourcePath);
      const destination = normalizePath(destinationPath);
      if (!session.currentPath || (session.currentPath !== source && !session.currentPath.startsWith(source + '/'))) return;
      const nextCurrent = destination + session.currentPath.slice(source.length);
      host.dispatchEvent(new host.CustomEvent('meldex:file-path-renamed', {
        detail: { oldPath: session.currentPath, newPath: nextCurrent, type: currentApp().id },
      }));
    }

    function _handlePathRenamed(event) {
      const oldPath = normalizePath(event?.detail?.oldPath || '');
      const newPath = normalizePath(event?.detail?.newPath || '');
      if (!oldPath || !newPath || oldPath === newPath) return;
      if (shared.etags.has(oldPath)) {
        const etag = shared.etags.get(oldPath);
        shared.etags.delete(oldPath);
        shared.etags.set(newPath, etag);
      }
      Object.keys(options.appSpecs).forEach((appId) => {
        const key = options.lastPathKey + ':' + appId;
        if (options.safeGet(key, '') === oldPath) options.safeSet(key, newPath);
      });
      if (shared.queuedOpenPath === oldPath) shared.queuedOpenPath = newPath;
      activeLocks()?.relocateLock?.(oldPath, newPath).catch?.(() => {});
      if (session.currentPath === oldPath) session.currentPath = newPath;
      shared.config = options.makeConfig(shared.config?.initialPath === oldPath ? newPath : '');
    }

    function _installRenameEvent() {
      if (session.renameEventInstalled) return;
      host.addEventListener('meldex:file-path-renamed', _handlePathRenamed);
      session.renameEventInstalled = true;
    }

    function _patchStandaloneFs() {
      const fs = host.MeldexStandaloneFS;
      if (!fs || fs._cloudAdapterInstalled) return false;
      fs._cloudOriginals = Object.fromEntries(Object.keys(fs).map((key) => [key, fs[key]]));
      fs.init = async () => {
        await options.ensureReady({ requireConnection: false });
        shared.config = options.makeConfig('');
        return shared.config;
      };
      fs.config = () => shared.config || options.makeConfig('');
      fs.refreshConfig = fs.init;
      fs.nativeInitialPath = () => options.makeConfig('').initialPath;
      fs.rootPathLabel = () => options.getActiveRoot()?.name || '';
      fs.pathLabel = options.pathLabel;
      installEditPathApi(fs);
      fs.defaultFilename = () => currentApp().defaultFilename;
      fs.defaultExtension = () => currentApp().defaultExtension;
      fs.openFile = async () => {
        const queued = shared.queuedOpenPath;
        shared.queuedOpenPath = '';
        const selected = queued ? { path: queued } : await options.pickOpen({ extensions: currentApp().extensions });
        if (!selected?.path) return null;
        shared.config = options.makeConfig(selected.path);
        return { path: selected.path, config: shared.config };
      };
      fs.discardQueuedOpen = () => { shared.queuedOpenPath = ''; };
      fs.newContent = async (title) => options.newContent(title, currentApp().id);
      fs.readText = async (path) => options.readText(normalizePath(path));
      fs.readFileAsDataUrl = options.fileAsDataUrl;
      fs.writeText = options.writeText;
      fs.saveAs = (content, suggestedName) => options.saveContentAs(content, suggestedName);
      fs.suggestedName = (path, fallback) => options.basename(path) || fallback || currentApp().defaultFilename;
      fs._cloudAdapterInstalled = true;
      return true;
    }

    function _setBoardRoot(pathValue) {
      const path = normalizePath(pathValue || '');
      session.pendingBoardOpen = null;
      shared.boardRootPath = path;
      shared.boardRootHandle = path ? options.virtualHandle(path) : null;
    }

    function _setBoardCurrentPath(pathValue) {
      const path = normalizePath(pathValue || '');
      const pending = session.pendingBoardOpen;
      if (pending?.path === path) _setBoardRoot(pending.rootPath);
      else if (pending) session.pendingBoardOpen = null;
      return setCurrentPath(path);
    }

    async function _releaseBoardEditLock(pathValue) {
      const path = normalizePath(pathValue || '');
      if (session.pendingBoardOpen?.path === path) session.pendingBoardOpen = null;
      return releaseEditLock(path);
    }

    function _patchBoardFs() {
      const fs = host.BoardStandaloneFS;
      if (!fs || fs._cloudAdapterInstalled) return false;
      fs._cloudOriginals = Object.fromEntries(Object.keys(fs).map((key) => [key, fs[key]]));
      fs.initNativeIfAvailable = async () => {
        await options.ensureReady({ requireConnection: false });
        return true;
      };
      installEditPathApi(fs);
      fs.setCurrentPath = _setBoardCurrentPath;
      fs.releaseEditLock = _releaseBoardEditLock;
      // BoardStandaloneApp calls this while opening. Opening is read-only; the
      // first real input/change event acquires the edit lock instead.
      fs.ensureEditLock = async () => null;
      fs.isNativeMode = () => true;
      fs.isFileSystemAccessSupported = () => true;
      fs.nativeInitialPath = () => options.makeConfig('').initialPath;
      fs.setRootHandle = (handle) => _setBoardRoot(handle?.path || handle?.root || options.getActiveRoot()?.path || '');
      fs.getRootHandle = () => shared.boardRootHandle;
      fs.rootName = () => {
        const pendingRoot = session.pendingBoardOpen?.rootPath || '';
        return (pendingRoot ? options.folderName(pendingRoot) : shared.boardRootHandle?.name)
          || options.getActiveRoot()?.name || '';
      };
      fs.rootPathLabel = fs.rootName;
      fs.loadSavedRootHandle = async () => {
        await options.ensureReady({ requireConnection: false });
        return shared.connected ? shared.boardRootHandle : null;
      };
      fs.saveRootHandle = async (handle) => fs.setRootHandle(handle);
      fs.clearSavedRootHandle = async () => _setBoardRoot('');
      fs.verifyPermission = async () => shared.connected;
      fs.pickRootFolder = async () => {
        const picked = await options.treeApi().pickFolder({ title: 'ボードの保存場所を選択' });
        if (!picked?.path) return null;
        fs.setRootHandle(options.virtualHandle(picked.path));
        return shared.boardRootHandle;
      };
      fs.openBoardFile = async () => {
        const queued = shared.queuedOpenPath;
        shared.queuedOpenPath = '';
        const picked = queued
          ? { path: queued }
          : await options.pickOpen({ extensions: options.appSpecs.board.extensions, title: 'ボードを開く' });
        if (!picked?.path) return null;
        const path = normalizePath(picked.path);
        const rootPath = options.dirname(path);
        session.pendingBoardOpen = { path, rootPath };
        return {
          cloud: true,
          path,
          initialPath: path,
          root: rootPath,
          rootName: options.folderName(rootPath),
        };
      };
      fs.discardQueuedOpen = () => { shared.queuedOpenPath = ''; };
      fs.saveBoardAs = async (content, suggestedName) => {
        const saved = await options.saveContentAs(content, suggestedName, { appId: 'board' });
        if (!saved) return null;
        fs.setRootHandle(options.virtualHandle(options.dirname(saved.path)));
        return {
          ...saved.config,
          path: saved.path,
          initialPath: saved.path,
          root: options.dirname(saved.path),
          rootName: options.folderName(options.dirname(saved.path)),
        };
      };
      fs.pickImageFile = async () => {
        const extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico'];
        const picked = await options.pickOpen({ extensions, title: '画像を選択' });
        if (!picked?.path) return null;
        return {
          ok: true,
          name: options.basename(picked.path),
          path: picked.path,
          dataUrl: await options.fileAsDataUrl(picked.path),
          outsideRoot: false,
        };
      };
      fs.readFileAsDataUrl = options.fileAsDataUrl;
      fs.listBoardFiles = async () => {
        const pending = session.pendingBoardOpen;
        try {
          return (await options.listFiles(
            pending?.rootPath || shared.boardRootPath || options.getActiveRoot()?.path || '',
            { extensions: options.appSpecs.board.extensions },
          )).map((item) => ({ path: item.path, kind: 'board' }));
        } catch (error) {
          if (session.pendingBoardOpen === pending) session.pendingBoardOpen = null;
          throw error;
        }
      };
      fs.isBoardFilename = (name) => options.fileNameMatches(name, options.appSpecs.board.extensions);
      fs._cloudAdapterInstalled = true;
      return true;
    }

    function _installOpenEvent() {
      if (session.openEventInstalled) return;
      host.addEventListener('meldex:standalone-file-open-request', (event) => {
        const path = normalizePath(event?.detail?.path || '');
        if (!path || !options.fileNameMatches(path, currentApp().extensions)) return;
        shared.queuedOpenPath = path;
        const selectors = {
          note: '[data-note-action="open"]',
          scenario: '[data-scenario-action="open"]',
          sheet: '[data-sheet-action="open"]',
          timer: '[data-timer-file-action="open"]',
        };
        host.queueMicrotask(() => {
          if (currentApp().id === 'board') host.MeldexBoardStandalone?.openBoardFromMenu?.();
          else host.document.querySelector(selectors[currentApp().id] || '')?.click?.();
        });
      });
      session.openEventInstalled = true;
    }

    function installAdapters() {
      const standalone = _patchStandaloneFs();
      const board = _patchBoardFs();
      _installEditActivity();
      _installOpenEvent();
      _installRenameEvent();
      session.adaptersInstalled = standalone || board || session.adaptersInstalled;
      return { installed: true, standalone, board };
    }

    return Object.freeze({
      setCurrentPath,
      currentPath,
      ensureEditLock,
      releaseEditLock,
      discardRememberedPath,
      installEditPathApi,
      assertCanDelete,
      notifyMove,
      installAdapters,
    });
  }

  window.MeldexStandaloneEditSession = Object.freeze({ create });
})();
