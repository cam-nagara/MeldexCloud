(function () {
  const MANIFEST_URL = 'cloud-samples/manifest.json';
  const DEFAULT_SAMPLE_TARGET_ROOT = 'MeldexHome/サンプル';
  const HOME_STORAGE_KEY = 'meldex-cloud-home-folder';
  const SEED_META_PATH = '_meldex/cloud-sample-seed.json';
  const SEED_META_DOCUMENT_ID = 'cloud-sample-seed';
  const COPY_YIELD_INTERVAL = 8;
  let _running = null;
  let _preparePromise = null;

  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _provider() {
    return window.MeldexStorageAdapter?.getProvider?.();
  }

  async function _managementAdapter(provider) {
    if (typeof provider?.getSystemStorageAdapter === 'function') {
      const kind = window.MeldexSystemStorage?.SystemStorageKind?.WORKSPACE_METADATA;
      if (!kind) throw new Error('サンプル管理データの種別を判定できません');
      return { adapter: provider.getSystemStorageAdapter(), kind };
    }
    const resolver = window.MeldexDropboxManagementRootResolver;
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.WORKSPACE_METADATA;
    if (!provider || !resolver?.resolveTypedAdapterForProvider || !kind) {
      throw new Error('サンプル管理データの保存先を安全に判定できません');
    }
    return {
      adapter: await resolver.resolveTypedAdapterForProvider(provider, kind),
      kind,
    };
  }

  async function _readSeedMeta(provider) {
    const managed = await _managementAdapter(provider);
    const record = await managed.adapter.load(managed.kind, SEED_META_DOCUMENT_ID);
    if (record?.payload) return record.payload;
    return provider?.readJson ? provider.readJson(SEED_META_PATH, null).catch(() => null) : null;
  }

  function _isCloudStorageMode() {
    return _runtime()?.isBrowserDataMode?.()
      || ['browser', 'dropbox'].includes(document.body?.dataset?.cloudMode || '');
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

  async function _requireUnlockedPath(provider, path, options = {}) {
    const normalized = _normalizePath(path);
    if (!normalized || !window.MeldexFileLockStore?.requireUnlocked) return;
    await window.MeldexFileLockStore.requireUnlocked(provider, normalized, options);
  }

  async function _ensureDirectory(provider, path, options = {}) {
    const normalized = _normalizePath(path);
    if (!normalized || !provider?.ensureDirectory) return;
    await _requireUnlockedPath(provider, normalized, {
      action: options.action || 'sample-create-directory',
      includeDescendants: !!options.includeDescendants,
    });
    await provider.ensureDirectory(normalized);
  }

  async function prepareHome(options) {
    if (_preparePromise) return _preparePromise;
    _preparePromise = (async () => {
      if (!_isCloudStorageMode()) return { ok: false, skipped: 'not-cloud-storage' };
      const provider = _provider();
      if (!provider) return { ok: false, skipped: 'missing-provider' };
      const opts = options || {};
      const manifest = await _readManifest();
      const targetRoot = _normalizePath(manifest.targetRoot);
      const homePath = targetRoot.split('/')[0] || 'MeldexHome';
      const canWrite = await _hasWritePermission(provider);
      if (canWrite) {
        await _ensureDirectory(provider, homePath, { action: 'sample-prepare-home' });
        if (opts.createSampleRoot) await _ensureDirectory(provider, targetRoot, { action: 'sample-prepare-root' });
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
    if (!_isCloudStorageMode()) return { ok: false, skipped: 'not-cloud-storage' };
    const provider = _provider();
    if (!provider) return { ok: false, skipped: 'missing-provider' };
    const manifest = await _readManifest();
    const targetRoot = _normalizePath(manifest.targetRoot);
    const meta = await _readSeedMeta(provider);
    const sampleRoot = await _statPath(provider, targetRoot);
    const failed = Number(meta?.failed || 0);
    const hasSampleFolder = sampleRoot?.kind === 'directory';
    const contentHashMatches = !manifest.contentHash || String(meta?.contentHash || '') === String(manifest.contentHash || '');
    return {
      ok: true,
      targetRoot,
      hasSampleFolder,
      hasInstallMeta: !!meta,
      installed: !!meta && failed === 0 && hasSampleFolder && contentHashMatches,
      contentHashMatches,
      needsUpdate: !!meta && hasSampleFolder && !contentHashMatches,
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

  function _entryHashMap(manifest) {
    const map = {};
    (Array.isArray(manifest?.entries) ? manifest.entries : []).forEach((entry) => {
      const targetPath = _normalizePath(entry?.targetPath);
      const sha256 = String(entry?.sha256 || '').trim();
      if (targetPath && sha256) map[targetPath] = sha256;
    });
    return map;
  }

  function _sampleContentNeedsRefresh(manifest, meta) {
    return !!meta
      && !!manifest?.contentHash
      && String(meta?.contentHash || '') !== String(manifest.contentHash || '');
  }

  async function _existingFileMatchesManifest(provider, targetPath, entry) {
    if (!entry?.sha256 || !window.crypto?.subtle || typeof provider?.downloadAsFile !== 'function') return false;
    const file = await provider.downloadAsFile(targetPath);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const digest = await _sha256Hex(bytes);
    return !!digest && digest === String(entry.sha256);
  }

  async function _copyMissingEntries(provider, manifest, options = {}) {
    const result = { copied: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
    const refreshExisting = !!options.refreshExisting;
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
          if (!refreshExisting || await _existingFileMatchesManifest(provider, targetPath, entry)) {
            result.skipped += 1;
            continue;
          }
          await _requireUnlockedPath(provider, targetPath, { action: 'sample-update' });
          const bytes = await _fetchAsset(entry);
          await provider.uploadBytes(targetPath, bytes);
          result.updated += 1;
          continue;
        }
        const parent = _dirname(targetPath);
        await _requireUnlockedPath(provider, targetPath, { action: 'sample-upload' });
        if (parent) await _ensureDirectory(provider, parent, { action: 'sample-create-parent' });
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
    const managed = await _managementAdapter(provider);
    const current = await managed.adapter.load(managed.kind, SEED_META_DOCUMENT_ID);
    await managed.adapter.save(managed.kind, SEED_META_DOCUMENT_ID, {
      type: 'meldex-cloud-sample-seed-result',
      contentHash: manifest.contentHash || '',
      entryHashes: _entryHashMap(manifest),
      fileCount: manifest.fileCount || 0,
      totalBytes: manifest.totalBytes || 0,
      targetRoot: manifest.targetRoot || '',
      copied: result.copied || 0,
      updated: result.updated || 0,
      skipped: result.skipped || 0,
      failed: result.failed || 0,
      updatedAt: new Date().toISOString(),
    }, {
      expectedRevision: current?.revision ?? null,
    });
  }

  async function _ensureNow() {
    if (!_isCloudStorageMode()) return { ok: false, skipped: 'not-cloud-storage' };
    const provider = _provider();
    if (!provider?.uploadBytes) return { ok: false, skipped: 'missing-provider' };
    const manifest = await _readManifest();
    const canWrite = await _hasWritePermission(provider);
    if (!canWrite) return { ok: false, skipped: 'readonly' };
    const previousMeta = await _readSeedMeta(provider);
    await prepareHome({ createSampleRoot: true });
    await _ensureDirectory(provider, _normalizePath(manifest.targetRoot));
    const result = await _copyMissingEntries(provider, manifest, {
      refreshExisting: _sampleContentNeedsRefresh(manifest, previousMeta),
    });
    try {
      await _writeSeedMeta(provider, manifest, result);
    } catch (err) {
      result.failed += 1;
      result.errors.push({ targetPath: SEED_META_PATH, error: err?.message || String(err) });
    }
    if (typeof refreshOutliner === 'function') {
      const refreshResult = refreshOutliner();
      refreshResult?.catch?.(() => {});
    }
    if ((result.copied > 0 || result.updated > 0) && typeof showStatus === 'function') {
      const updateText = result.updated > 0 ? ` / 更新 ${result.updated} 件` : '';
      showStatus(`クラウド版サンプルを準備しました（追加 ${result.copied} 件${updateText}）`);
    }
    return { ok: result.failed === 0, ...result };
  }

  function _startEnsure() {
    if (!_running) {
      _running = _ensureNow()
        .catch((err) => {
          console.warn('[MeldexCloudSampleSeed] sample seed failed', err);
          const message = err?.message || String(err);
          return {
            ok: false,
            copied: 0,
            updated: 0,
            skipped: 0,
            failed: 1,
            errors: [{ targetPath: MANIFEST_URL, error: message }],
            error: message,
          };
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
