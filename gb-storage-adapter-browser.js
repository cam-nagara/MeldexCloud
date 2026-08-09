(function () {
  'use strict';

  const shared = window.__MeldexStorageAdapterInternals;
  if (!shared) return;

  const {
    _runtime,
    _normalizeRelativePath,
    _joinPath,
    _basename,
    _dirname,
    _mimeFromPath,
    _normalizeHandleOptions,
    _createFile,
    _toUint8Array,
  } = shared;

  const STORAGE_ROOT_NAME = 'MeldexData';
  const HOME_FOLDER_NAME = 'MeldexHome';
  const HOME_STORAGE_KEY = 'meldex-cloud-home-folder';
  const SYSTEM_ROOT = 'MeldexSettings/system/v1';

  function _systemContract() {
    return window.MeldexSystemStorage || null;
  }

  function _assertEntryName(name) {
    const value = String(name || '').trim();
    if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
      throw new Error('ファイル名またはフォルダ名が不正です');
    }
    return value;
  }

  function _systemSegment(value, label) {
    const text = String(value || '').trim();
    if (!text || !/^[A-Za-z0-9._-]+$/.test(text)) throw new Error(`${label}が不正です`);
    return text;
  }

  function _revision() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function _conflictError(expectedRevision, currentRevision) {
    const error = new Error('管理データが別の画面で更新されています。再読み込みしてからやり直してください');
    error.name = 'SystemStorageConflictError';
    error.code = 'system_storage_conflict';
    error.expectedRevision = expectedRevision;
    error.currentRevision = currentRevision;
    return error;
  }

  class BrowserFileHandle {
    constructor(provider, relativePath, handle) {
      this.provider = provider;
      this.path = _normalizeRelativePath(relativePath);
      this.name = _basename(this.path);
      this.kind = 'file';
      this._handle = handle;
    }

    async getFile() {
      return this._handle.getFile();
    }

    async createWritable(options) {
      return this._handle.createWritable(options);
    }
  }

  class BrowserDirectoryHandle {
    constructor(provider, relativePath, handle) {
      this.provider = provider;
      this.path = _normalizeRelativePath(relativePath);
      this.name = this.path ? _basename(this.path) : STORAGE_ROOT_NAME;
      this.kind = 'directory';
      this._handle = handle;
    }

    async getDirectoryHandle(name, options) {
      const entryName = _assertEntryName(name);
      const handle = await this._handle.getDirectoryHandle(entryName, options || {});
      return new BrowserDirectoryHandle(this.provider, _joinPath(this.path, entryName), handle);
    }

    async getFileHandle(name, options) {
      const entryName = _assertEntryName(name);
      const handle = await this._handle.getFileHandle(entryName, options || {});
      return new BrowserFileHandle(this.provider, _joinPath(this.path, entryName), handle);
    }

    async *entries() {
      for await (const [name, handle] of this._handle.entries()) {
        const path = _joinPath(this.path, name);
        yield [name, handle.kind === 'directory'
          ? new BrowserDirectoryHandle(this.provider, path, handle)
          : new BrowserFileHandle(this.provider, path, handle)];
      }
    }

    async removeEntry(name, options) {
      return this._handle.removeEntry(_assertEntryName(name), options || {});
    }
  }

  class BrowserSystemStorageAdapter {
    constructor(provider) {
      this.provider = provider;
    }

    _path(kind, documentId) {
      const contract = _systemContract();
      if (contract?.documentRelativePath) return `${SYSTEM_ROOT}/${contract.documentRelativePath(kind, documentId)}`;
      const safeKind = _systemSegment(kind, '管理データ種別');
      const safeId = _systemSegment(documentId, '管理データID');
      return `${SYSTEM_ROOT}/${safeKind}/${safeId}.json`;
    }

    async load(kind, documentId) {
      const path = this._path(kind, documentId);
      let text = '';
      try {
        text = await this.provider.readText(path);
      } catch (error) {
        if (error?.name === 'NotFoundError') return null;
        throw error;
      }
      let record = null;
      try {
        record = JSON.parse(text);
      } catch {
        throw new Error(`管理データが破損しているため読み込めません: ${path}`);
      }
      if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
      const contract = _systemContract();
      if (contract?.recordFromEnvelope && record.meldex_system_storage) {
        return contract.recordFromEnvelope(record);
      }
      // 初期開発版で作成された封筒なしレコードの読込互換。
      return record;
    }

    async save(kind, documentId, payload, options) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload はオブジェクトである必要があります');
      const path = this._path(kind, documentId);
      return this.provider._withWriteLock(path, async () => {
        const current = await this.load(kind, documentId);
        if (Object.prototype.hasOwnProperty.call(options || {}, 'expectedRevision')) {
          const expected = options.expectedRevision || null;
          const actual = current?.revision || null;
          if (expected !== actual) throw _conflictError(expected, actual);
        }
        const contract = _systemContract();
        const timestamp = new Date().toISOString();
        const record = {
          schemaVersion: contract?.CURRENT_SCHEMA_VERSION || 1,
          kind,
          documentId,
          revision: _revision(),
          createdAt: current?.createdAt || timestamp,
          updatedAt: timestamp,
          boundary: 'browser-local',
          payload,
        };
        await this.provider.writeJson(path, contract?.recordToEnvelope ? contract.recordToEnvelope(record) : record);
        return record;
      });
    }

    async delete(kind, documentId, options) {
      const path = this._path(kind, documentId);
      return this.provider._withWriteLock(path, async () => {
        const current = await this.load(kind, documentId);
        if (!current) return false;
        if (Object.prototype.hasOwnProperty.call(options || {}, 'expectedRevision')) {
          const expected = options.expectedRevision || null;
          const actual = current.revision || null;
          if (expected !== actual) throw _conflictError(expected, actual);
        }
        await this.provider.deletePath(path);
        return true;
      });
    }
  }

  class BrowserStorageProvider {
    constructor() {
      this.rootHandle = null;
      this._nativeRoot = null;
      this._writeLocks = new Map();
      this._systemStorage = new BrowserSystemStorageAdapter(this);
    }

    static isSupported() {
      return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
    }

    getVaultName() {
      return STORAGE_ROOT_NAME;
    }

    getVaultPath() {
      return STORAGE_ROOT_NAME;
    }

    async _root() {
      if (!BrowserStorageProvider.isSupported()) {
        throw new Error('このブラウザは端末内保存に対応していません。OSとブラウザを最新版に更新してください');
      }
      if (!this._nativeRoot) {
        const originRoot = await navigator.storage.getDirectory();
        this._nativeRoot = await originRoot.getDirectoryHandle(STORAGE_ROOT_NAME, { create: true });
      }
      return this._nativeRoot;
    }

    _syncWorkspaceState() {
      _runtime()?.setWorkspaceState?.({
        kind: 'browser',
        name: 'この端末',
        path: STORAGE_ROOT_NAME,
        access: 'editor',
        shared: false,
      });
    }

    async restoreWorkspace() {
      if (!_runtime()?.isBrowserMode?.()) return null;
      const nativeRoot = await this._root();
      await nativeRoot.getDirectoryHandle(HOME_FOLDER_NAME, { create: true });
      if (!this.rootHandle) this.rootHandle = new BrowserDirectoryHandle(this, '', nativeRoot);
      try {
        if (!localStorage.getItem(HOME_STORAGE_KEY)) {
          localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify({ path: HOME_FOLDER_NAME, name: HOME_FOLDER_NAME }));
        }
      } catch {}
      this._syncWorkspaceState();
      return this.rootHandle;
    }

    async clearWorkspace() {
      this.rootHandle = null;
      this._nativeRoot = null;
      this._writeLocks.clear();
      if (_runtime()?.isBrowserMode?.()) _runtime()?.clearWorkspaceState?.();
    }

    async ensureWorkspacePermission() {
      return !!(await this.restoreWorkspace());
    }

    async getWorkspaceInfo() {
      const root = await this.restoreWorkspace();
      return {
        supported: BrowserStorageProvider.isSupported(),
        connected: !!root,
        name: 'この端末',
        path: STORAGE_ROOT_NAME,
        permission: 'readwrite',
        homePath: HOME_FOLDER_NAME,
        homeName: HOME_FOLDER_NAME,
      };
    }

    async _nativeDirectory(relativePath, create) {
      let handle = await this._root();
      const segments = _normalizeRelativePath(relativePath).split('/').filter(Boolean);
      for (const segment of segments) handle = await handle.getDirectoryHandle(_assertEntryName(segment), { create: !!create });
      return handle;
    }

    async getDirectoryHandle(relativePath, options) {
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) return this.restoreWorkspace();
      const handleOptions = _normalizeHandleOptions(options);
      const handle = await this._nativeDirectory(normalized, !!handleOptions.create);
      return new BrowserDirectoryHandle(this, normalized, handle);
    }

    async getFileHandle(relativePath, options) {
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) throw new Error('ファイルパスが不正です');
      const handleOptions = _normalizeHandleOptions(options);
      const parent = await this._nativeDirectory(_dirname(normalized), !!handleOptions.create);
      const handle = await parent.getFileHandle(_assertEntryName(_basename(normalized)), { create: !!handleOptions.create });
      return new BrowserFileHandle(this, normalized, handle);
    }

    async statPath(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) return { kind: 'directory', name: STORAGE_ROOT_NAME, path: '', size: 0, modified: '', modifiedMs: 0 };
      try {
        const handle = await this.getFileHandle(normalized, { create: false });
        const file = await handle.getFile();
        return {
          kind: 'file', name: handle.name, path: normalized, size: Number(file.size || 0),
          modified: file.lastModified ? new Date(file.lastModified).toISOString() : '',
          modifiedMs: Number(file.lastModified || 0),
        };
      } catch {}
      try {
        await this.getDirectoryHandle(normalized, { create: false });
        return { kind: 'directory', name: _basename(normalized), path: normalized, size: 0, modified: '', modifiedMs: 0 };
      } catch {
        return null;
      }
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
      const handle = await this._nativeDirectory(normalized, true);
      return new BrowserDirectoryHandle(this, normalized, handle);
    }

    async listEntries(relativePath) {
      const directory = await this.getDirectoryHandle(relativePath, { create: false });
      const entries = [];
      for await (const [name, handle] of directory.entries()) {
        const path = _joinPath(relativePath, name);
        if (handle.kind === 'file') {
          const file = await handle.getFile();
          entries.push({ name, path, kind: 'file', size: file.size, modified: new Date(file.lastModified).toISOString() });
        } else {
          entries.push({ name, path, kind: 'directory', size: 0, modified: '' });
        }
      }
      return entries.sort((a, b) => a.name.localeCompare(b.name, 'ja', { sensitivity: 'base' }));
    }

    async downloadAsFile(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const source = await (await this.getFileHandle(normalized, { create: false })).getFile();
      return _createFile(new Uint8Array(await source.arrayBuffer()), _basename(normalized), {
        type: source.type || _mimeFromPath(normalized),
        lastModified: source.lastModified,
      });
    }

    async readText(relativePath) {
      return (await this.downloadAsFile(relativePath)).text();
    }

    async readJson(relativePath, fallbackValue) {
      try { return JSON.parse(await this.readText(relativePath)); } catch { return fallbackValue; }
    }

    async uploadBytes(relativePath, data) {
      const normalized = _normalizeRelativePath(relativePath);
      const parent = _dirname(normalized);
      if (parent) await this.ensureDirectory(parent);
      const handle = await this.getFileHandle(normalized, { create: true });
      const writable = await handle.createWritable();
      await writable.write(await _toUint8Array(data));
      await writable.close();
      return this.statPath(normalized);
    }

    async overwriteBytes(relativePath, data) {
      return this.uploadBytes(relativePath, data);
    }

    async writeText(relativePath, content) {
      return this.uploadBytes(relativePath, new TextEncoder().encode(String(content ?? '')));
    }

    async writeJson(relativePath, data) {
      return this.writeText(relativePath, JSON.stringify(data, null, 2));
    }

    async _withWriteLock(path, callback) {
      if (globalThis.navigator?.locks?.request) return globalThis.navigator.locks.request(`meldex-browser:${path}`, callback);
      const previous = this._writeLocks.get(path) || Promise.resolve();
      const next = previous.catch(() => {}).then(callback);
      this._writeLocks.set(path, next);
      try { return await next; } finally { if (this._writeLocks.get(path) === next) this._writeLocks.delete(path); }
    }

    async writeJsonMerged(relativePath, updater, options) {
      const normalized = _normalizeRelativePath(relativePath);
      return this._withWriteLock(normalized, async () => {
        const fallback = Object.prototype.hasOwnProperty.call(options || {}, 'fallbackValue') ? options.fallbackValue : {};
        const current = await this.readJson(normalized, fallback);
        const next = typeof updater === 'function' ? await updater(current, { attempt: 0, rev: '' }) : updater;
        if (next === false) return { ok: true, skipped: true };
        await this.writeJson(normalized, next === undefined ? current : next);
        return { ok: true };
      });
    }

    async deletePath(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) throw new Error('端末内保存のルートは削除できません');
      const parent = await this._nativeDirectory(_dirname(normalized), false);
      await parent.removeEntry(_basename(normalized), { recursive: true });
      return true;
    }

    async _copyRecursive(sourcePath, targetPath) {
      const stat = await this.statPath(sourcePath);
      if (!stat) throw new Error(`見つかりません: ${sourcePath}`);
      if (stat.kind === 'directory') {
        await this.ensureDirectory(targetPath);
        for (const child of await this.listEntries(sourcePath)) {
          await this._copyRecursive(_joinPath(sourcePath, child.name), _joinPath(targetPath, child.name));
        }
        return;
      }
      let bytes = new Uint8Array(await (await this.downloadAsFile(sourcePath)).arrayBuffer());
      const format = window.MeldexDocumentIdentity?.formatForPath?.(targetPath);
      if (format) {
        const regenerated = window.MeldexDocumentIdentity.regenerateDocumentId(new TextDecoder().decode(bytes), format);
        if (regenerated?.changed) bytes = new TextEncoder().encode(regenerated.text);
      }
      await this.uploadBytes(targetPath, bytes);
    }

    async copyPath(oldRelativePath, newRelativePath) {
      const source = _normalizeRelativePath(oldRelativePath);
      const target = _normalizeRelativePath(newRelativePath);
      if (!source || !target) throw new Error('コピー元またはコピー先が不正です');
      if (target.startsWith(`${source}/`)) throw new Error('フォルダをそのフォルダ自身の配下へコピーできません');
      if (await this.statPath(target)) throw new Error(`コピー先に既に存在します: ${target}`);
      await this._copyRecursive(source, target);
      return { ok: true, new_path: target };
    }

    async movePath(oldRelativePath, newRelativePath) {
      const source = _normalizeRelativePath(oldRelativePath);
      const target = _normalizeRelativePath(newRelativePath);
      if (source === target) return { ok: true, new_path: target };
      await this.copyPath(source, target);
      await this.deletePath(source);
      window.MeldexDocumentSaveCoordinator?.rebindDocumentPathPrefix?.(source, target);
      return { ok: true, new_path: target };
    }

    async getTemporaryLink(relativePath) {
      return URL.createObjectURL(await this.downloadAsFile(relativePath));
    }

    getSystemStorageAdapter() {
      return this._systemStorage;
    }

    async preflight() {
      const info = await this.getWorkspaceInfo();
      return {
        ok: !!info.connected,
        mounted: !!info.connected,
        access: info.connected ? 'editor' : 'none',
        state: _runtime()?.getWorkspaceState?.() || null,
        message: info.connected ? '' : 'このブラウザでは端末内保存を利用できません。',
      };
    }
  }

  if (window.MeldexStorageAdapter) {
    window.MeldexStorageAdapter.BrowserStorageProvider = BrowserStorageProvider;
  }
})();
