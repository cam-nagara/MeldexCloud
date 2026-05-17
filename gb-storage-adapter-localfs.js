(function () {
  const shared = window.__MeldexStorageAdapterInternals;
  if (!shared) return;

  const {
    _runtime,
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
  } = shared;

  class LocalFsWritable {
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

  class LocalFsFileHandle {
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
      return new LocalFsWritable(this.provider, this.path);
    }
  }

  class LocalFsDirectoryHandle {
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
      return new LocalFsDirectoryHandle(this.provider, targetPath);
    }

    async getFileHandle(name, options) {
      const targetPath = _joinPath(this.path, name);
      if (!options?.create) await this.provider.assertFile(targetPath);
      return new LocalFsFileHandle(this.provider, targetPath);
    }

    async *entries() {
      const entries = await this.provider.listEntries(this.path);
      for (const entry of entries) {
        if (entry.kind === 'directory') yield [entry.name, new LocalFsDirectoryHandle(this.provider, entry.path)];
        else yield [entry.name, new LocalFsFileHandle(this.provider, entry.path)];
      }
    }

    async removeEntry(name) {
      await this.provider.deletePath(_joinPath(this.path, name));
    }
  }

  class LocalFsStorageProvider {
    constructor() {
      this.rootHandle = null;
      this._workspaceInfo = null;
    }

    static isSupported() {
      return true;
    }

    getVaultPath() {
      return this._workspaceInfo?.path || '';
    }

    getVaultName() {
      return this._workspaceInfo?.name || '';
    }

    _syncWorkspaceState(info) {
      const statePath = String(info?.path || info?.homePath || '');
      if (!statePath) {
        _runtime()?.clearWorkspaceState?.();
        return;
      }
      _runtime()?.setWorkspaceState?.({
        kind: 'localfs',
        name: String(info?.name || info?.homeName || _basename(statePath) || 'vault'),
        path: statePath,
        access: 'editor',
      });
    }

    async _detectRenameType(relativePath, stat) {
      if (stat?.kind === 'directory') return 'folder';
      const normalized = _normalizeRelativePath(relativePath);
      const lower = normalized.toLowerCase();
      if (lower.endsWith('.scriptnote.json')) return 'scriptnote';
      if (!lower.endsWith('.md')) return 'scenario';
      const typeInfo = await _fetchJson('/check-type', { query: { path: normalized }, allowStatus: [404] });
      return String(typeInfo?.type || '') === 'board' ? 'board' : 'page';
    }

    _renameStem(relativePath) {
      const name = _basename(relativePath);
      const ext = _legacyRenameExt(name);
      return ext ? name.slice(0, -ext.length) : name;
    }

    async _renamePath(oldRelativePath, newRelativePath) {
      const oldPath = _normalizeRelativePath(oldRelativePath);
      const newPath = _normalizeRelativePath(newRelativePath);
      const stat = await this.statPath(oldPath);
      if (!stat) throw new Error(`見つかりません: ${oldPath}`);
      const itemType = await this._detectRenameType(oldPath, stat);
      const result = await _fetchJson('/outliner/rename', {
        method: 'POST',
        body: {
          old_path: oldPath,
          new_name: stat.kind === 'directory' ? _basename(newPath) : this._renameStem(newPath),
          type: itemType,
        },
      });
      const actualPath = _normalizeRelativePath(result?.new_path || '');
      if (actualPath && actualPath !== newPath) {
        throw new Error(`ローカル rename 結果が期待と異なります: ${actualPath}`);
      }
      return result;
    }

    async restoreWorkspace() {
      const info = await this.getWorkspaceInfo(true);
      if (!info.connected) return null;
      if (!this.rootHandle) this.rootHandle = new LocalFsDirectoryHandle(this, '');
      return this.rootHandle;
    }

    async getDirectoryHandle(relativePath, options) {
      const handleOptions = _normalizeHandleOptions(options);
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) return this.restoreWorkspace();
      if (handleOptions.create) await this.ensureDirectory(normalized);
      else await this.assertDirectory(normalized);
      return new LocalFsDirectoryHandle(this, normalized);
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
      return new LocalFsFileHandle(this, normalized);
    }

    async clearWorkspace() {
      this.rootHandle = null;
      this._workspaceInfo = null;
      if (_runtime()?.getMode?.() === 'legacy') _runtime()?.clearWorkspaceState?.();
    }

    async ensureWorkspacePermission() {
      const info = await this.getWorkspaceInfo(true);
      return !!info.connected;
    }

    async getWorkspaceInfo(forceRefresh) {
      if (!forceRefresh && this._workspaceInfo) return this._workspaceInfo;
      let vault = { path: '', name: '' };
      let home = null;
      try {
        vault = (await _fetchJson('/vault')) || vault;
      } catch {}
      try {
        home = await _fetchJson('/home-folder', { allowStatus: [404] });
      } catch {}
      const info = {
        supported: true,
        connected: !!vault?.path,
        name: String(vault?.name || ''),
        path: String(vault?.path || ''),
        permission: 'readwrite',
        homePath: String(home?.path || ''),
        homeName: String(home?.name || ''),
      };
      this._workspaceInfo = info;
      this.rootHandle = info.connected ? (this.rootHandle || new LocalFsDirectoryHandle(this, '')) : null;
      this._syncWorkspaceState(info);
      return info;
    }

    async statPath(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) {
        const info = await this.getWorkspaceInfo(true);
        if (!info.connected) return null;
        return {
          kind: 'directory',
          name: info.name || 'vault',
          path: '',
          size: 0,
          modified: '',
          modifiedMs: 0,
          meta: { type: 'folder' },
        };
      }
      const fileMeta = await _fetchJson('/file-meta', {
        query: { path: normalized },
        allowStatus: [404],
      });
      if (fileMeta) {
        const modified = fileMeta.modified || fileMeta.created || '';
        return {
          kind: 'file',
          name: _basename(normalized),
          path: normalized,
          size: Number(fileMeta.size || 0),
          modified,
          modifiedMs: _jsonDate(modified),
          meta: fileMeta,
        };
      }
      const typeInfo = await _fetchJson('/check-type', {
        query: { path: normalized },
        allowStatus: [404],
      });
      if (!typeInfo || !['folder', 'database', 'calendar'].includes(String(typeInfo.type || ''))) return null;
      return {
        kind: 'directory',
        name: _basename(normalized),
        path: normalized,
        size: 0,
        modified: '',
        modifiedMs: 0,
        meta: typeInfo,
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
      if (!normalized) return this.restoreWorkspace();
      const segments = normalized.split('/').filter(Boolean);
      let current = '';
      for (const segment of segments) {
        current = _joinPath(current, segment);
        const stat = await this.statPath(current);
        if (stat?.kind === 'directory') continue;
        if (stat) throw new Error(`フォルダではない項目があります: ${current}`);
        const parent = _dirname(current);
        await _fetchJson('/outliner/add', {
          method: 'POST',
          body: {
            type: 'folder',
            label: segment,
            parent,
          },
        });
      }
      return new LocalFsDirectoryHandle(this, normalized);
    }

    async listEntries(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const items = await _fetchJson('/browse', {
        query: {
          path: normalized,
          all_files: 1,
          detail: 1,
        },
      });
      return (Array.isArray(items) ? items : []).map((item) => {
        const path = _normalizeRelativePath(item?.path || '');
        const itemType = String(item?.type || '');
        return {
          name: _basename(path),
          path,
          kind: ['folder', 'database', 'calendar'].includes(itemType) ? 'directory' : 'file',
          size: Number(item?.size || 0),
          modified: String(item?.modified || ''),
        };
      }).sort((a, b) => a.name.localeCompare(b.name, 'ja', { sensitivity: 'base' }));
    }

    async downloadAsFile(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const meta = await _fetchJson('/file-meta', {
        query: { path: normalized },
        allowStatus: [404],
      });
      const response = await fetch(_apiUrl('/file-raw', { path: normalized }));
      if (!response.ok) throw new Error(await _responseError(response));
      const modified = meta?.modified || meta?.created || '';
      const bytes = new Uint8Array(await response.arrayBuffer());
      return _createFile(bytes, _basename(normalized), {
        type: response.headers.get('content-type') || _mimeFromPath(normalized),
        lastModified: _jsonDate(modified),
      });
    }

    async getTemporaryLink(relativePath) {
      return _apiUrl('/file-raw', { path: _normalizeRelativePath(relativePath) });
    }

    async readText(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      const payload = await _fetchJson('/file', { query: { path: normalized } });
      return String(payload?.content || '');
    }

    async readJson(relativePath, fallbackValue) {
      try {
        return JSON.parse(await this.readText(relativePath));
      } catch {
        return fallbackValue;
      }
    }

    async uploadBytes(relativePath, bytes) {
      const normalized = _normalizeRelativePath(relativePath);
      await _fetchJson('/file', {
        method: 'PUT',
        query: { path: normalized },
        body: {
          binary: true,
          content_base64: _bytesToBase64(bytes),
        },
      });
      return this.statPath(normalized);
    }

    async writeText(relativePath, content) {
      const normalized = _normalizeRelativePath(relativePath);
      await _fetchJson('/file', {
        method: 'PUT',
        query: { path: normalized },
        body: {
          content: String(content ?? ''),
        },
      });
      return this.statPath(normalized);
    }

    async writeJson(relativePath, data) {
      return this.writeText(relativePath, JSON.stringify(data, null, 2));
    }

    async deletePath(relativePath) {
      const normalized = _normalizeRelativePath(relativePath);
      if (!normalized) throw new Error('ローカル vault ルートは削除できません');
      if (normalized.startsWith('_trash/')) {
        await _fetchJson('/trash/delete', {
          method: 'POST',
          body: { name: _basename(normalized) },
        });
        return true;
      }
      await _fetchJson('/outliner/delete', {
        method: 'POST',
        body: { path: normalized },
      });
      return true;
    }

    async movePath(oldRelativePath, newRelativePath) {
      const oldPath = _normalizeRelativePath(oldRelativePath);
      const newPath = _normalizeRelativePath(newRelativePath);
      if (!oldPath || !newPath) throw new Error('移動元または移動先が不正です');
      if (oldPath === newPath) return { ok: true, new_path: newPath };
      const targetStat = await this.statPath(newPath);
      if (targetStat) throw new Error(`移動先に既に存在します: ${newPath}`);
      let currentPath = oldPath;
      if (_dirname(oldPath) !== _dirname(newPath)) {
        const moved = await _fetchJson('/outliner/move', {
          method: 'POST',
          body: {
            path: currentPath,
            dest_folder: _dirname(newPath),
          },
        });
        currentPath = _normalizeRelativePath(moved?.new_path || currentPath);
      }
      if (currentPath !== newPath) return this._renamePath(currentPath, newPath);
      return { ok: true, new_path: newPath };
    }

    async copyPath(oldRelativePath, newRelativePath) {
      const oldPath = _normalizeRelativePath(oldRelativePath);
      const newPath = _normalizeRelativePath(newRelativePath);
      const stat = await this.statPath(oldPath);
      if (!stat) throw new Error(`見つかりません: ${oldPath}`);
      if (stat.kind === 'directory') {
        await this.ensureDirectory(newPath);
        const children = await this.listEntries(oldPath);
        for (const child of children) {
          await this.copyPath(_joinPath(oldPath, child.name), _joinPath(newPath, child.name));
        }
        return { ok: true, new_path: newPath };
      }
      const file = await this.downloadAsFile(oldPath);
      await this.uploadBytes(newPath, new Uint8Array(await file.arrayBuffer()));
      return { ok: true, new_path: newPath };
    }

    async preflight() {
      const info = await this.getWorkspaceInfo(true);
      if (!info.connected) {
        return {
          ok: false,
          mounted: false,
          access: 'none',
          message: 'デスクトップ版の保存先フォルダが未設定です。',
          state: _runtime()?.getWorkspaceState?.() || null,
        };
      }
      return {
        ok: true,
        mounted: true,
        access: 'editor',
        state: _runtime()?.getWorkspaceState?.() || null,
      };
    }
  }

  if (window.MeldexStorageAdapter) {
    window.MeldexStorageAdapter.LocalFsStorageProvider = LocalFsStorageProvider;
  }
})();
