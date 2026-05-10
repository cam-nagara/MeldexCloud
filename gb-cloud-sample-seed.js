(function () {
  const MANIFEST_URL = 'cloud-samples/manifest.json';
  const DEFAULT_SAMPLE_TARGET_ROOT = 'MeldexHome/サンプル';
  const HOME_STORAGE_KEY = 'meldex-cloud-home-folder';
  const SEED_META_PATH = '_meldex/cloud-sample-seed.json';
  const COPY_YIELD_INTERVAL = 8;
  let _running = null;
  let _preparePromise = null;

  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _provider() {
    return window.MeldexStorageAdapter?.getProvider?.();
  }

  function _isDropboxMode() {
    return _runtime()?.isDropboxMode?.() || document.body?.dataset?.cloudMode === 'dropbox';
  }

  function _normalizePath(path) {
    return String(path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
  }

  function _basename(path) {
    const normalized = _normalizePath(path);
    if (!normalized) return '';
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(index + 1) : normalized;
  }

  function _dirname(path) {
    const normalized = _normalizePath(path);
    if (!normalized.includes('/')) return '';
    return normalized.slice(0, normalized.lastIndexOf('/'));
  }

  function _absoluteStaticUrl(path) {
    return new URL(_normalizePath(path), document.baseURI || window.location.href).toString();
  }

  function _rememberHome(path) {
    const normalized = _normalizePath(path);
    if (!normalized) return;
    try {
      localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify({
        path: normalized,
        name: _basename(normalized),
        exists: true,
        locked_folders: [],
        locked_paths: [],
      }));
    } catch {}
  }

  async function _yieldToUi() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function _readManifest() {
    const response = await fetch(_absoluteStaticUrl(MANIFEST_URL), { cache: 'no-store' });
    if (!response.ok) throw new Error(`サンプルマニフェストを取得できませんでした: HTTP ${response.status}`);
    const manifest = await response.json();
    if (manifest?.type !== 'meldex-cloud-sample-seed') {
      throw new Error('サンプルマニフェストの形式が不正です');
    }
    manifest.targetRoot = _normalizePath(manifest.targetRoot) || DEFAULT_SAMPLE_TARGET_ROOT;
    if (!Array.isArray(manifest.entries)) {
      throw new Error('サンプルファイル一覧が不正です');
    }
    return manifest;
  }

  async function _hasWritePermission(provider) {
    if (!provider) return false;
    if (!provider.ensureWorkspacePermission) return true;
    try {
      return !!(await provider.ensureWorkspacePermission('readwrite'));
    } catch {
      return false;
    }
  }

  async function _statPath(provider, path) {
    const normalized = _normalizePath(path);
    if (!normalized) return null;
    try {
      if (provider?.statPath) return await provider.statPath(normalized);
      if (provider?.getMetadata) {
        const meta = await provider.getMetadata(normalized);
        if (!meta) return null;
        return { kind: meta['.tag'] === 'folder' ? 'directory' : 'file', path: normalized };
      }
    } catch {
      return null;
    }
    return null;
  }

  async function _ensureDirectory(provider, path) {
    const normalized = _normalizePath(path);
    if (!normalized || !provider?.ensureDirectory) return;
    await provider.ensureDirectory(normalized);
  }

  async function prepareHome(options) {
    if (_preparePromise) return _preparePromise;
    _preparePromise = (async () => {
      if (!_isDropboxMode()) return { ok: false, skipped: 'not-dropbox' };
      const provider = _provider();
      if (!provider) return { ok: false, skipped: 'missing-provider' };
      const opts = options || {};
      const manifest = await _readManifest();
      const targetRoot = _normalizePath(manifest.targetRoot);
      const homePath = targetRoot.split('/')[0] || 'MeldexHome';
      const canWrite = await _hasWritePermission(provider);
      if (canWrite) {
        await _ensureDirectory(provider, homePath);
        if (opts.createSampleRoot) await _ensureDirectory(provider, targetRoot);
        _rememberHome(homePath);
        return { ok: true, homePath, targetRoot, writable: true };
      }
      const existing = await _statPath(provider, targetRoot);
      if (existing?.kind === 'directory') _rememberHome(homePath);
      return { ok: !!existing, homePath, targetRoot, writable: false };
    })().finally(() => {
      _preparePromise = null;
    });
    return _preparePromise;
  }

  async function status() {
    if (!_isDropboxMode()) return { ok: false, skipped: 'not-dropbox' };
    const provider = _provider();
    if (!provider) return { ok: false, skipped: 'missing-provider' };
    const manifest = await _readManifest();
    const targetRoot = _normalizePath(manifest.targetRoot);
    const meta = provider?.readJson ? await provider.readJson(SEED_META_PATH, null).catch(() => null) : null;
    const sampleRoot = await _statPath(provider, targetRoot);
    const failed = Number(meta?.failed || 0);
    return {
      ok: true,
      targetRoot,
      hasSampleFolder: sampleRoot?.kind === 'directory',
      hasInstallMeta: !!meta,
      installed: !!meta && failed === 0,
      meta,
    };
  }

  async function _sha256Hex(bytes) {
    if (!window.crypto?.subtle) return '';
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  }

  async function _fetchAsset(entry) {
    const response = await fetch(_absoluteStaticUrl(entry.asset), { cache: 'force-cache' });
    if (!response.ok) throw new Error(`サンプルファイルを取得できませんでした: ${entry.relativePath || entry.asset}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (Number(entry.size || 0) > 0 && bytes.length !== Number(entry.size || 0)) {
      throw new Error(`サンプルファイルサイズが一致しません: ${entry.relativePath || entry.asset}`);
    }
    if (entry.sha256 && window.crypto?.subtle) {
      const digest = await _sha256Hex(bytes);
      if (digest && digest !== String(entry.sha256)) {
        throw new Error(`サンプルファイルのハッシュが一致しません: ${entry.relativePath || entry.asset}`);
      }
    }
    return bytes;
  }

  async function _copyMissingEntries(provider, manifest) {
    const result = { copied: 0, skipped: 0, failed: 0, errors: [] };
    const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index] || {};
      const targetPath = _normalizePath(entry.targetPath);
      if (!targetPath || !_normalizePath(entry.asset)) {
        result.failed += 1;
        result.errors.push({ targetPath, error: 'invalid-entry' });
        continue;
      }
      try {
        const existing = await _statPath(provider, targetPath);
        if (existing?.kind === 'file') {
          result.skipped += 1;
          continue;
        }
        const parent = _dirname(targetPath);
        if (parent) await _ensureDirectory(provider, parent);
        const bytes = await _fetchAsset(entry);
        await provider.uploadBytes(targetPath, bytes);
        result.copied += 1;
      } catch (err) {
        result.failed += 1;
        result.errors.push({ targetPath, error: err?.message || String(err) });
      }
      if ((index + 1) % COPY_YIELD_INTERVAL === 0) await _yieldToUi();
    }
    return result;
  }

  async function _writeSeedMeta(provider, manifest, result) {
    try {
      await _ensureDirectory(provider, _dirname(SEED_META_PATH));
      await provider.writeJson(SEED_META_PATH, {
        type: 'meldex-cloud-sample-seed-result',
        contentHash: manifest.contentHash || '',
        fileCount: manifest.fileCount || 0,
        totalBytes: manifest.totalBytes || 0,
        targetRoot: manifest.targetRoot || '',
        copied: result.copied || 0,
        skipped: result.skipped || 0,
        failed: result.failed || 0,
        updatedAt: new Date().toISOString(),
      });
    } catch {}
  }

  async function _ensureNow() {
    if (!_isDropboxMode()) return { ok: false, skipped: 'not-dropbox' };
    const provider = _provider();
    if (!provider?.uploadBytes) return { ok: false, skipped: 'missing-provider' };
    const manifest = await _readManifest();
    const canWrite = await _hasWritePermission(provider);
    if (!canWrite) return { ok: false, skipped: 'readonly' };
    await prepareHome({ createSampleRoot: true });
    await _ensureDirectory(provider, _normalizePath(manifest.targetRoot));
    const result = await _copyMissingEntries(provider, manifest);
    await _writeSeedMeta(provider, manifest, result);
    if (typeof refreshOutliner === 'function') {
      const refreshResult = refreshOutliner();
      refreshResult?.catch?.(() => {});
    }
    if (result.copied > 0 && typeof showStatus === 'function') {
      showStatus(`クラウド版サンプルを準備しました（追加 ${result.copied} 件）`);
    }
    return { ok: result.failed === 0, ...result };
  }

  function _startEnsure() {
    if (!_running) {
      _running = _ensureNow()
        .catch((err) => {
          console.warn('[MeldexCloudSampleSeed] sample seed failed', err);
          return { ok: false, error: err?.message || String(err) };
        })
        .finally(() => {
          _running = null;
        });
    }
    return _running;
  }

  function ensure(options) {
    if (options?.background) {
      setTimeout(() => {
        _startEnsure().catch(() => {});
      }, 0);
      return Promise.resolve({ ok: true, scheduled: true });
    }
    return _startEnsure();
  }

  window.MeldexCloudSampleSeed = {
    prepareHome,
    ensure,
    status,
    _readManifestForTest: _readManifest,
  };
})();
