/* Provider-neutral, persistent one-use confirmation gate for Cloud deletes. */
(function () {
  'use strict';

  const TTL_MS = 300000;
  const ERROR_CODE = 'REFERENCE_IMPACT_CONFIRMATION_REQUIRED';

  function _error(message, status, latestImpact) {
    const error = new Error(message);
    error.code = status === 503 ? 'REFERENCE_CONFIRMATION_STORAGE_UNAVAILABLE' : ERROR_CODE;
    error.status = status;
    if (latestImpact) error.impact = latestImpact;
    return error;
  }

  function _token() {
    if (!window.crypto?.getRandomValues) throw _error('安全な確認tokenを発行できません', 503);
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function _normalize(items) {
    const unique = new Map();
    for (const raw of (Array.isArray(items) ? items : [])) {
      const path = String(raw?.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (!path || path.split('/').some(part => part === '.' || part === '..')) {
        throw _error('削除対象が不正です', 409);
      }
      const physicalPath = String(raw?.physicalPath || raw?._physicalPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (physicalPath && physicalPath.split('/').some(part => part === '.' || part === '..')) throw _error('削除対象が不正です', 409);
      const item = { path, kind: raw?.kind === 'folder' ? 'folder' : 'file' };
      if (physicalPath) item.physicalPath = physicalPath;
      if (raw?.assetId || raw?.asset_id) item.assetId = String(raw.assetId || raw.asset_id);
      unique.set(`${item.kind}:${item.path}:${physicalPath}`, item);
    }
    return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
  }

  function _operation(value) {
    return value === 'permanent' ? 'permanent' : 'trash';
  }

  function _stable(value) {
    if (Array.isArray(value)) return value.map(_stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, _stable(value[key])]));
    }
    return value == null ? null : value;
  }

  function _fingerprint(value) {
    return JSON.stringify(_stable(value));
  }

  async function _digest(value) {
    if (!window.crypto?.subtle) throw _error('削除対象を安全に識別できません', 503);
    const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(_fingerprint(value)));
    return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function _metadataIdentity(metadata) {
    const raw = metadata?.meta || metadata || {};
    return {
      assetId: String(raw.id || raw.asset_id || ''),
      revision: String(raw.revision || raw.rev || raw.content_hash || raw.etag
        || metadata?.revision || metadata?.modifiedMs || raw.modified || raw.server_modified || ''),
      size: Number(metadata?.size ?? raw.size ?? 0),
    };
  }

  function _impactFingerprint(impact) {
    if (impact?.graphRevision) return String(impact.graphRevision);
    return _fingerprint({
      complete: impact?.complete === true,
      sourceFileCount: Number(impact?.sourceFileCount || 0),
      occurrenceCount: Number(impact?.occurrenceCount || 0),
      sources: Array.isArray(impact?.sources) ? impact.sources : [],
      unchecked: Array.isArray(impact?.unchecked) ? impact.unchecked : [],
    });
  }

  function _mergeImpacts(left, right) {
    if (!left) return { ...right };
    const byPath = new Map();
    for (const row of [...(left.sources || []), ...(right.sources || [])]) {
      const key = String(row?.source_path || row?.path || '');
      if (!key) continue;
      const current = byPath.get(key);
      byPath.set(key, current ? {
        ...current,
        occurrence_count: Number(current.occurrence_count || 0) + Number(row.occurrence_count || 0),
      } : { ...row });
    }
    return {
      ...left, complete: left.complete === true && right.complete === true,
      sourceFileCount: (left.truncatedSources || right.truncatedSources)
        ? Number(left.sourceFileCount || 0) + Number(right.sourceFileCount || 0)
        : byPath.size,
      occurrenceCount: Number(left.occurrenceCount || 0) + Number(right.occurrenceCount || 0),
      sources: [...byPath.values()].sort((a, b) => String(a.source_path).localeCompare(String(b.source_path))).slice(0, 50),
      truncatedSources: left.truncatedSources === true || right.truncatedSources === true || byPath.size > 50,
      unchecked: [...(left.unchecked || []), ...(right.unchecked || [])],
      graphRevision: [left.graphRevision, right.graphRevision].filter(Boolean).sort().join(':'),
    };
  }

  async function _actor(provider) {
    if (typeof provider?.getConfirmationActor === 'function') {
      const value = String(await provider.getConfirmationActor()).trim();
      if (value) return value;
    }
    const account = await window.MeldexDropboxAuth?.getCurrentAccount?.(false);
    const accountId = String(account?.account_id || account?.accountId || '').trim();
    if (accountId) return accountId;
    if (provider?.confirmationActorKind === 'local-browser') return 'browser:local-owner';
    throw _error('操作した利用者を確認できません', 503);
  }

  async function _scope(provider, item) {
    if (typeof provider?.resolveConfirmationScope === 'function') {
      const supplied = await provider.resolveConfirmationScope(item.path);
      if (!supplied?.scopeKey || !supplied?.adapter?.load || !supplied?.adapter?.save) {
        throw _error('確認tokenのCAS保存先を利用できません', 503);
      }
      const canonical = String(supplied.toCanonicalPath?.(item.path) || '').replace(/^\/+|\/+$/g, '');
      if (!canonical) throw _error('削除対象の管理範囲を確認できません', 503);
      const physical = item.physicalPath ? String(supplied.toCanonicalPath?.(item.physicalPath) || '').replace(/^\/+|\/+$/g, '') : '';
      if (item.physicalPath && !physical) throw _error('削除対象の実体範囲を確認できません', 503);
      return { scope: supplied, item: { ...item, path: canonical, ...(physical ? { physicalPath: physical } : {}) } };
    }
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!resolver?.resolveManagementScopeForPath) throw _error('管理領域を解決できません', 503);
    let scope;
    try { scope = await resolver.resolveManagementScopeForPath(provider, item.path); }
    catch (cause) { throw _error(`管理領域を解決できません: ${cause?.message || cause}`, 503); }
    if (!scope?.scopeKey || !scope?.adapter?.load || !scope?.adapter?.save) {
      throw _error('確認tokenのCAS保存先を利用できません', 503);
    }
    const canonical = String(scope.toCanonicalPath?.(item.path) || '').replace(/^\/+|\/+$/g, '');
    if (!canonical) throw _error('削除対象の管理範囲を確認できません', 503);
    const physical = item.physicalPath ? String(scope.toCanonicalPath?.(item.physicalPath) || '').replace(/^\/+|\/+$/g, '') : '';
    if (item.physicalPath && !physical) throw _error('削除対象の実体範囲を確認できません', 503);
    return { scope, item: { ...item, path: canonical, ...(physical ? { physicalPath: physical } : {}) } };
  }

  async function _groups(provider, items) {
    const groups = new Map();
    for (const item of _normalize(items)) {
      const resolved = await _scope(provider, item);
      const key = String(resolved.scope.scopeKey);
      if (!groups.has(key)) groups.set(key, { scope: resolved.scope, items: [], localItems: [] });
      groups.get(key).items.push(resolved.item);
      groups.get(key).localItems.push(item);
    }
    for (const group of groups.values()) group.items = _normalize(group.items);
    return [...groups.values()].sort((a, b) => String(a.scope.scopeKey).localeCompare(String(b.scope.scopeKey)));
  }

  async function _states(provider, items, getState) {
    const values = [];
    for (const item of items) values.push(await getState({ ...item, path: item.physicalPath || item.path }, provider));
    return values;
  }

  async function _defaultState(item, provider) {
    if (typeof provider?.statPathFresh !== 'function') {
      throw _error('削除確認専用のfresh statを利用できません', 503);
    }
    const metadata = await provider.statPathFresh(item.path);
    if (!metadata) throw _error(`削除対象の状態を確認できません: ${item.path}`, 409);
    const actualKind = metadata.kind === 'directory' ? 'folder' : 'file';
    if (actualKind !== item.kind) throw _error(`削除対象の種類が変更されました: ${item.path}`, 409);
    const rootIdentity = _metadataIdentity(metadata);
    const root = {
      path: item.path, kind: actualKind,
      assetId: rootIdentity.assetId, revision: rootIdentity.revision, size: rootIdentity.size,
    };
    root.referenceTargets = [{ path: item.path, kind: item.kind, assetId: root.assetId }];
    if (item.kind !== 'folder') return root;
    if (metadata.manifestDigest && metadata.confirmationManifestAuthoritative === true) return {
      ...root, manifestDigest: String(metadata.manifestDigest),
      descendantCount: Number(metadata.descendantCount || 0),
    };
    if (typeof provider?.walkEntriesFresh !== 'function') {
      throw _error(`フォルダのfresh走査を利用できません: ${item.path}`, 503);
    }
    const rows = [];
    for (const child of await provider.walkEntriesFresh(item.path, { maxEntries: 20000, maxPathBytes: 4 * 1024 * 1024 })) {
      const kind = child.kind === 'directory' ? 'folder' : 'file';
      const identity = _metadataIdentity(child);
      rows.push([child.path, kind, identity.assetId, identity.revision, identity.size]);
      root.referenceTargets.push({ path: child.path, kind, assetId: identity.assetId });
    }
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return { ...root, manifestDigest: await _digest(rows), descendantCount: rows.length };
  }

  function _impactItems(items, states) {
    const values = [];
    states.forEach((state, index) => {
      const item = items[index];
      const physical = String(item.physicalPath || '').replace(/^\/+|\/+$/g, '');
      for (const target of (state.referenceTargets || [item])) {
        let path = target.path;
        if (physical && (path === physical || path.startsWith(`${physical}/`))) {
          path = item.path + path.slice(physical.length);
        }
        values.push({ ...target, path });
      }
    });
    return _normalize(values);
  }

  function _storedStates(states) {
    return states.map(({ referenceTargets, ...state }) => state);
  }

  async function _ledgerAdapter(provider, groups) {
    const direct = provider?.getSystemStorageAdapter?.();
    if (direct?.load && direct?.save) return direct;
    const resolver = window.MeldexDropboxManagementRootResolver;
    const resolved = await resolver?.resolveAdapterForProvider?.(provider);
    if (resolved?.load && resolved?.save) return resolved;
    const first = groups[0]?.scope?.adapter;
    if (first?.load && first?.save && groups.every(group => group.scope.adapter === first)) return first;
    throw _error('操作全体を原子的に保存できる確認台帳がありません', 503);
  }

  async function _latestImpact(provider, items, queryImpact) {
    const query = queryImpact || window.__MeldexPwaDataAccessInternals?._queryDeleteImpact;
    if (typeof query !== 'function') throw _error('参照影響を確認できません', 503);
    const impact = await query(provider, items);
    if (impact?.complete !== true) throw _error('参照影響の確認が完了しませんでした', 409, impact);
    return impact;
  }

  async function prepareProviderDelete(options) {
    const provider = options?.provider;
    const operation = _operation(options?.operation);
    const actor = await _actor(provider);
    const groups = await _groups(provider, options?.items);
    if (!groups.length) throw _error('削除対象がありません', 409);
    const ledger = await _ledgerAdapter(provider, groups);
    let aggregateImpact = null;
    const payloadGroups = [];
    for (const group of groups) {
      const getState = options?.getState || _defaultState;
      const before = await _states(provider, group.localItems, getState);
      const impactItems = _impactItems(group.localItems, before);
      const impact = await _latestImpact(provider, impactItems, options?.queryImpact);
      const after = await _states(provider, group.localItems, getState);
      if (_fingerprint(before) !== _fingerprint(after)) throw _error('確認中に削除対象が変更されました', 409, impact);
      payloadGroups.push({ scopeKey: String(group.scope.scopeKey), targets: group.items,
        localTargets: group.localItems, impactTargets: impactItems,
        states: _storedStates(after), graphRevision: _impactFingerprint(impact) });
      aggregateImpact = _mergeImpacts(aggregateImpact, impact);
    }
    const token = _token();
    const now = Date.now();
    const graphRevision = await _digest(payloadGroups.map(row => [row.scopeKey, row.graphRevision]));
    const payload = { actor, operation, groups: payloadGroups, graphRevision,
      issuedAt: now, expiresAt: now + TTL_MS, status: 'issued' };
    try {
      await ledger.save(window.MeldexSystemStorage.SystemStorageKind.REFERENCE_CONFIRMATIONS,
        token, payload, { expectedRevision: null });
    } catch (cause) {
      throw _error(`確認tokenを安全に保存できません: ${cause?.message || cause}`, 503);
    }
    const confirmation = { token, graphRevision, scopeKey: 'operation' };
    return { ...(aggregateImpact || {}), confirmations: [confirmation], confirmationToken: token, graphRevision };
  }

  async function consumeProviderDelete(options) {
    const provider = options?.provider;
    const operation = _operation(options?.operation);
    const actor = await _actor(provider);
    const groups = await _groups(provider, options?.items);
    const supplied = Array.isArray(options?.confirmations) && options.confirmations.length
      ? options.confirmations
      : [{ token: options?.confirmationToken || options?.confirmation_token, graphRevision: options?.graphRevision || options?.graph_revision }];
    if (supplied.length !== 1) throw _error('削除前の参照影響確認が必要です', 409);
    const confirmation = supplied[0];
    const token = String(confirmation?.token || confirmation?.confirmationToken || '').trim();
    if (!token) throw _error('削除前の参照影響確認が必要です', 409);
    const ledger = await _ledgerAdapter(provider, groups);
    const kind = window.MeldexSystemStorage.SystemStorageKind.REFERENCE_CONFIRMATIONS;
    let record;
    try { record = await ledger.load(kind, token); }
    catch (cause) { throw _error(`確認tokenを読み込めません: ${cause?.message || cause}`, 503); }
    const payload = record?.payload;
    const currentShape = groups.map(group => ({ scopeKey: String(group.scope.scopeKey), targets: group.items }));
    const storedShape = (payload?.groups || []).map(group => ({ scopeKey: group.scopeKey, targets: group.targets }));
    if (!payload || payload.status !== 'issued' || payload.expiresAt < Date.now()
        || payload.actor !== actor || payload.operation !== operation
        || _fingerprint(storedShape) !== _fingerprint(currentShape)
        || payload.graphRevision !== String(confirmation?.graphRevision || confirmation?.graph_revision || '')) {
      throw _error('削除確認が無効または期限切れです', 409);
    }
    let latestImpact = null;
    const receiptGroups = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index]; const stored = payload.groups[index];
      const getState = options?.getState || _defaultState;
      const before = await _states(provider, group.localItems, getState);
      const refreshedImpact = await _latestImpact(provider, _impactItems(group.localItems, before), options?.queryImpact);
      const after = await _states(provider, group.localItems, getState);
      latestImpact = _mergeImpacts(latestImpact, refreshedImpact);
      if (_fingerprint(before) !== _fingerprint(after) || _fingerprint(_storedStates(after)) !== _fingerprint(stored.states)
          || _impactFingerprint(refreshedImpact) !== stored.graphRevision) {
        throw _error('削除対象または参照が確認後に変更されました', 409, refreshedImpact);
      }
      receiptGroups.push({ localTargets: group.localItems, states: _storedStates(after),
        impactTargets: stored.impactTargets, graphRevision: stored.graphRevision });
    }
    try {
      await ledger.save(kind, token, { ...payload, status: 'consumed', consumedAt: Date.now() }, { expectedRevision: record.revision });
    } catch (cause) {
      if (cause?.name === 'SystemStorageConflictError') throw _error('削除確認をやり直してください。削除は開始されていません', 409, latestImpact);
      throw _error(`確認tokenを安全に消費できません: ${cause?.message || cause}`, 503);
    }
    return { ok: true, receipt: { groups: receiptGroups } };
  }

  async function revalidateProviderDelete(options) {
    const provider = options?.provider;
    const receipt = options?.receipt;
    if (!receipt?.groups?.length) throw _error('削除直前の確認情報がありません', 409);
    let latestImpact = null;
    for (const group of receipt.groups) {
      const requested = options?.items ? _normalize(options.items) : group.localTargets;
      const selected = group.localTargets.map((item, index) => ({ item, index }))
        .filter(row => requested.some(item => _fingerprint(item) === _fingerprint(row.item)));
      if (!selected.length) continue;
      const selectedItems = selected.map(row => row.item);
      const states = await _states(provider, selectedItems, options?.getState || _defaultState);
      const impact = await _latestImpact(provider, group.impactTargets, options?.queryImpact);
      latestImpact = _mergeImpacts(latestImpact, impact);
      const expectedStates = selected.map(row => group.states[row.index]);
      if (_fingerprint(_storedStates(states)) !== _fingerprint(expectedStates)
          || _impactFingerprint(impact) !== group.graphRevision) {
        throw _error('削除直前に対象または参照が変更されました', 409, impact);
      }
    }
    return { ok: true, impact: latestImpact };
  }

  window.MeldexCloudDeleteConfirmation = Object.freeze({
    prepareProviderDelete, consumeProviderDelete, revalidateProviderDelete,
  });
})();
