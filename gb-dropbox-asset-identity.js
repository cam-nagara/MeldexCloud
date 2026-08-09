/* Dropboxの安定metadata.idを、場所非依存asset_idへ結び付ける純粋層。 */
(function () {
  'use strict';

  function randomId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
      || `${Date.now().toString(16).padStart(12, '0')}${Math.random().toString(16).slice(2).padEnd(20, '0').slice(0, 20)}`;
  }

  function normalizePath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  }

  function normalizeIds(value) {
    return [...new Set((Array.isArray(value) ? value : [])
      .map(item => String(item || '').trim())
      .filter(Boolean))];
  }

  function normalizeStore(value) {
    const source = value && typeof value === 'object' ? structuredClone(value) : {};
    const objectField = name => (
      source[name] && typeof source[name] === 'object' && !Array.isArray(source[name])
        ? source[name]
        : {}
    );
    return {
      ...source,
      version: Math.max(5, Number(source.version || 0)),
      assignments: objectField('assignments'),
      auto_assignments: objectField('auto_assignments'),
      asset_assignments: objectField('asset_assignments'),
      asset_auto_assignments: objectField('asset_auto_assignments'),
      asset_locators: objectField('asset_locators'),
      asset_provider_ids: objectField('asset_provider_ids'),
      legacy_migrations: objectField('legacy_migrations'),
    };
  }

  async function metadataFor(provider, path) {
    if (typeof provider?.getMetadata === 'function') {
      return provider.getMetadata(path).catch(() => null);
    }
    const stat = await provider?.statPath?.(path).catch(() => null);
    return stat?.meta || null;
  }

  function resolveFromStore(store, path, providerId, options = {}) {
    const current = normalizeStore(store);
    const normalizedPath = normalizePath(path);
    const stableId = String(providerId || '').trim();
    let assetId = '';
    if (stableId) {
      assetId = String(current.asset_provider_ids[stableId] || '');
    }
    if (!assetId && !stableId) {
      assetId = Object.entries(current.asset_locators)
        .find(([, value]) => normalizePath(value) === normalizedPath)?.[0] || '';
    }
    if (!assetId && options.create !== false) assetId = randomId();
    if (assetId) {
      if (stableId) current.asset_provider_ids[stableId] = assetId;
      current.asset_locators[assetId] = normalizedPath;
      current.legacy_migrations[normalizedPath] = { asset_id: assetId, status: 'migrated' };
    }
    return {
      store: current,
      asset: {
        asset_id: assetId,
        provider: 'dropbox',
        provider_id: stableId,
        path: normalizedPath,
      },
    };
  }

  async function resolveAsset(provider, store, path, options = {}) {
    const metadata = await metadataFor(provider, path);
    return resolveFromStore(store, path, metadata?.id || '', options);
  }

  function assignmentFor(store, path, assetId) {
    const current = normalizeStore(store);
    const normalizedPath = normalizePath(path);
    if (assetId && Object.prototype.hasOwnProperty.call(current.asset_assignments, assetId)) {
      const ids = normalizeIds(current.asset_assignments[assetId]);
      return {
        ids,
        autoIds: normalizeIds(current.asset_auto_assignments[assetId])
          .filter(id => ids.includes(id)),
        source: 'asset',
      };
    }
    const ids = normalizeIds(current.assignments[normalizedPath]);
    return {
      ids,
      autoIds: normalizeIds(current.auto_assignments[normalizedPath])
        .filter(id => ids.includes(id)),
      source: ids.length ? 'legacy' : 'none',
    };
  }

  function projectAssignment(store, path, asset, ids, autoIds) {
    const current = normalizeStore(store);
    const normalizedPath = normalizePath(path);
    const assetId = String(asset?.asset_id || '');
    const assigned = normalizeIds(ids);
    const automatic = normalizeIds(autoIds).filter(id => assigned.includes(id));
    if (!assetId) return current;
    if (assigned.length) current.asset_assignments[assetId] = assigned;
    else delete current.asset_assignments[assetId];
    if (automatic.length) current.asset_auto_assignments[assetId] = automatic;
    else delete current.asset_auto_assignments[assetId];
    // One-release compatibility projection for older Meldex versions.
    if (assigned.length) current.assignments[normalizedPath] = assigned;
    else delete current.assignments[normalizedPath];
    if (automatic.length) current.auto_assignments[normalizedPath] = automatic;
    else delete current.auto_assignments[normalizedPath];
    current.asset_locators[assetId] = normalizedPath;
    if (asset?.provider_id) current.asset_provider_ids[asset.provider_id] = assetId;
    current.legacy_migrations[normalizedPath] = { asset_id: assetId, status: 'migrated' };
    return current;
  }

  window.MeldexDropboxAssetIdentity = {
    assignmentFor,
    normalizePath,
    normalizeStore,
    projectAssignment,
    resolveAsset,
    resolveFromStore,
  };
})();
