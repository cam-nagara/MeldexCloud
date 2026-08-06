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
      // 読み取った本文/バイナリと同じ時点のrevisionだけを次の全量保存へ使う。
      // 保存直前のmetadata GETで最新revisionを拾う方式は、古い内容の上書きを
      // CASが正当化してしまうため禁止する。
      this._knownFileRevisions = new Map();
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
      const runtime = _runtime();
      const serverConnection = runtime?.isServerMode?.() ? runtime.getServerConnection?.() : null;
      _runtime()?.setWorkspaceState?.({
        kind: serverConnection ? 'server' : 'localfs',
        name: String(info?.name || info?.homeName || _basename(statePath) || 'vault'),
        path: statePath,
        serverUrl: serverConnection?.url || '',
        access: 'editor',
      });
    }

    async _detectRenameType(relativePath, stat) {
      if (stat?.kind === 'directory') return 'folder';
      const normalized = _normalizeRelativePath(relativePath);
      const lower = normalized.toLowerCase();
      if (lower.endsWith('.mel-board') || lower.endsWith('.board.md') || lower.endsWith('.board.json') || lower.endsWith('.canvas.json')) return 'board';
      if (lower.endsWith('.mel-sheet') || lower.endsWith('.smart-db.json')) return 'smart-db';
      if (lower.endsWith('.mel-scenario') || lower.endsWith('.scriptnote.json')) return 'scriptnote';
      if (lower.endsWith('.mel-timer') || lower.endsWith('.timer.json')) return 'timer';
      if (!lower.endsWith('.md')) return 'scenario';
      const typeInfo = await _fetchJson('/check-type', { query: { path: normalized }, allowStatus: [404] });
      return String(typeInfo?.type || '') === 'board' ? 'board' : 'page';
    }

    _renameStem(relativePath) {
      const name = _basename(relativePath);
      const ext = _legacyRenameExt(name);
      return ext ? name.slice(0, -ext.length) : name;
    }

    _rekeyKnownRevisions(oldRelativePath, newRelativePath) {
      const oldPath = _normalizeRelativePath(oldRelativePath);
      const newPath = _normalizeRelativePath(newRelativePath);
      if (!oldPath || !newPath || oldPath === newPath) return;
      const prefix = oldPath + '/';
      Array.from(this._knownFileRevisions.entries()).forEach(([path, revision]) => {
        if (path !== oldPath && !path.startsWith(prefix)) return;
        const suffix = path === oldPath ? '' : path.slice(oldPath.length);
        this._knownFileRevisions.delete(path);
        this._knownFileRevisions.set(newPath + suffix, revision);
      });
      window.MeldexDocumentSaveCoordinator?.rebindDocumentPathPrefix?.(oldPath, newPath);
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
      this._rekeyKnownRevisions(oldPath, actualPath || newPath);
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
      this._knownFileRevisions.clear();
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
      // raw取得より先にrevisionを固定する。途中で外部更新が入った場合は次回保存が
      // 409になる（安全側）。raw取得後にrevisionを取ると古いbytesへ新しいrevisionを
      // 結び付ける危険がある。
      const revisionPayload = await _fetchJson('/file', {
        query: { path: normalized, metadata_only: '1' },
      });
      this._rememberFileRevision(normalized, revisionPayload);
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
      this._rememberFileRevision(normalized, payload);
      return String(payload?.content || '');
    }

    async readJson(relativePath, fallbackValue) {
      try {
        return JSON.parse(await this.readText(relativePath));
      } catch {
        return fallbackValue;
      }
    }

    _rememberFileRevision(relativePath, payload) {
      const normalized = _normalizeRelativePath(relativePath);
      const revision = payload?.transport_revision || payload?.etag || '';
      if (revision) this._knownFileRevisions.set(normalized, revision);
      else this._knownFileRevisions.delete(normalized);
    }

    _revisionPrecondition(revision) {
      const coordinator = window.MeldexDocumentSaveCoordinator;
      const token = coordinator?.revisionTokenForWrite
        ? coordinator.revisionTokenForWrite(revision, coordinator.currentTransportName())
        : String(revision?.token || revision || '');
      if (!token) throw new Error('保存元のrevisionを取得できませんでした');
      return {
        if_match_etag: token,
        transport_revision: coordinator?.normalizeTransportRevision
          ? coordinator.normalizeTransportRevision(coordinator.currentTransportName(), revision)
          : revision,
      };
    }

    async _fullWritePrecondition(relativePath, options) {
      const normalized = _normalizeRelativePath(relativePath);
      const opts = options && typeof options === 'object' ? options : {};
      if (opts.force_overwrite || opts.forceOverwrite) return { force_overwrite: true };
      if (opts.create_only || opts.createOnly) return { create_only: true };
      const supplied = opts.transport_revision || opts.transportRevision
        || opts.if_match_etag || opts.ifMatchEtag || this._knownFileRevisions.get(normalized) || '';
      if (supplied) return this._revisionPrecondition(supplied);
      try {
        const metadata = await _fetchJson('/file', {
          query: { path: normalized, metadata_only: '1' },
          allowStatus: [404],
        });
        if (!metadata) return { create_only: true };
        const error = new Error('既存ファイルの保存には、読込時のrevisionが必要です');
        error.status = 428;
        error.meldexCode = 'precondition_required';
        throw error;
      } catch (error) {
        if (error?.status === 404) return { create_only: true };
        throw error;
      }
    }

    async uploadBytes(relativePath, bytes, options) {
      const normalized = _normalizeRelativePath(relativePath);
      const precondition = await this._fullWritePrecondition(normalized, options);
      const result = await _fetchJson('/file', {
        method: 'PUT',
        query: { path: normalized },
        body: {
          binary: true,
          content_base64: _bytesToBase64(bytes),
          ...precondition,
        },
      });
      this._rememberFileRevision(normalized, result);
      return this.statPath(normalized);
    }

    async writeText(relativePath, content, options) {
      const normalized = _normalizeRelativePath(relativePath);
      const precondition = await this._fullWritePrecondition(normalized, options);
      const result = await _fetchJson('/file', {
        method: 'PUT',
        query: { path: normalized },
        body: {
          content: String(content ?? ''),
          ...precondition,
        },
      });
      this._rememberFileRevision(normalized, result);
      return this.statPath(normalized);
    }

    async writeJson(relativePath, data, options) {
      return this.writeText(relativePath, JSON.stringify(data, null, 2), options);
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
      this._knownFileRevisions.delete(normalized);
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
        const movedPath = _normalizeRelativePath(moved?.new_path || currentPath);
        this._rekeyKnownRevisions(currentPath, movedPath);
        currentPath = movedPath;
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
      let bytes = new Uint8Array(await file.arrayBuffer());
      const fmt = window.MeldexDocumentIdentity?.formatForPath?.(newPath);
      if (fmt) {
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const regenerated = window.MeldexDocumentIdentity.regenerateDocumentId(source, fmt);
        if (regenerated?.changed) bytes = new TextEncoder().encode(regenerated.text);
      }
      await this.uploadBytes(newPath, bytes);
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
