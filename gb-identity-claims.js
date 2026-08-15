/* Dropbox SystemStorage上の型付き安定ID claim正本。 */
(function () {
  'use strict';
  if (window.MeldexIdentityClaims) return;

  const KINDS = new Set(['document', 'asset', 'entry']);
  const STATUSES = new Set(['active', 'tombstoned', 'ambiguous']);
  const MAX_RETRIES = 5;
  const MAX_CANONICALS = 8;
  const MAX_PUBLIC_RETRIES = 8;
  const CLAIM_KEYS = new Set(['boundary', 'kind', 'uid', 'canonical', 'first_seen_at', 'status', 'claim_revision', 'conflicting_canonicals']);
  const CANONICAL_KEYS = new Set(['provider', 'provider_id', 'source_locator']);
  const PROVIDER_LOCATOR_KEYS = new Set([
    'boundary', 'kind', 'uid', 'canonical', 'provider_rev', 'sha256', 'status', 'locator_revision',
  ]);
  const SOURCE_INDEX_KEYS = new Set(['boundary', 'kind', 'provider', 'source_locator', 'refs', 'index_revision']);

  function exactKeys(value, allowed) {
    const keys = Object.keys(value || {});
    return keys.length === allowed.size && keys.every(key => allowed.has(key));
  }

  class IdentityClaimError extends Error {}
  class IdentityClaimConflictError extends IdentityClaimError {}
  class IdentityClaimCorruptError extends IdentityClaimError {}

  function text(value, label) {
    if (typeof value !== 'string') throw new IdentityClaimError(`${label} は文字列である必要があります`);
    const result = value.normalize('NFC').trim();
    if (!result || /[\u0000-\u001f]/.test(result)) throw new IdentityClaimError(`${label} が不正です`);
    return result;
  }

  function identityKind(value) {
    const result = text(value, 'kind');
    if (!KINDS.has(result)) throw new IdentityClaimError(`identity kind が不正です: ${result}`);
    return result;
  }

  function normalizeUid(value) { return text(value, 'uid'); }

  function retryCount(options) {
    const value = options == null || options.maxRetries == null ? MAX_RETRIES : options.maxRetries;
    if (!Number.isInteger(value) || value < 1 || value > MAX_PUBLIC_RETRIES) {
      throw new IdentityClaimError('maxRetries が不正です');
    }
    return value;
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function claimKey(scopeBoundary, kindValue, uidValue) {
    const boundary = text(scopeBoundary, 'boundary');
    const kind = identityKind(kindValue);
    const uid = normalizeUid(uidValue);
    return `claim-${await sha256Hex(`${boundary}\0${kind}\0${uid}`)}`;
  }

  function normalizedSourceLocator(value) {
    return text(value, 'source_locator').replace(/\\/g, '/').replace(/\/{2,}/g, '/')
      .replace(/^\/+|\/+$/g, '').toLocaleLowerCase('en-US');
  }

  async function providerLocatorKey(boundaryValue, kindValue, providerValue, providerIdValue) {
    const boundary = text(boundaryValue, 'boundary');
    const kind = identityKind(kindValue);
    const provider = text(providerValue, 'provider').toLowerCase();
    const providerId = text(providerIdValue, 'provider_id');
    return `provider-locator-${await sha256Hex(`${boundary}\0${kind}\0${provider}\0${providerId}`)}`;
  }

  async function sourceLocatorIndexKey(boundaryValue, kindValue, providerValue, sourceLocatorValue) {
    const boundary = text(boundaryValue, 'boundary');
    const kind = identityKind(kindValue);
    const provider = text(providerValue, 'provider').toLowerCase();
    const sourceLocator = normalizedSourceLocator(sourceLocatorValue);
    return `source-locator-${await sha256Hex(`${boundary}\0${kind}\0${provider}\0${sourceLocator}`)}`;
  }

  function canonical(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IdentityClaimError('canonical が不正です');
    if (!exactKeys(value, CANONICAL_KEYS)) throw new IdentityClaimError('canonical schema が不正です');
    return {
      provider: text(value.provider, 'canonical.provider').toLowerCase(),
      provider_id: text(value.provider_id, 'canonical.provider_id'),
      source_locator: text(value.source_locator, 'canonical.source_locator').replace(/\\/g, '/'),
    };
  }

  function equalCanonical(a, b) {
    return a.provider === b.provider && a.provider_id === b.provider_id && a.source_locator === b.source_locator;
  }

  function candidates(payload) {
    const result = [];
    [payload.canonical].concat(payload.conflicting_canonicals || []).forEach((value) => {
      const item = canonical(value);
      if (!result.some(existing => equalCanonical(existing, item))) result.push(item);
    });
    return result;
  }

  function authoritativeBoundary(adapter, expected) {
    const described = adapter && adapter.describe && adapter.describe();
    const boundary = text(described && described.boundary, 'adapter boundary');
    if (boundary !== expected) throw new IdentityClaimConflictError('adapter boundary と claim boundary が一致しません');
    if (!String(described.environment || '').startsWith('dropbox-') || !described.namespace_kind) {
      throw new IdentityClaimConflictError('CloudではDropbox真CASアダプターだけがclaim正本です');
    }
    return boundary;
  }

  async function validate(payload, boundary, kind, uid, key) {
    try {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload');
      if (!exactKeys(payload, CLAIM_KEYS)) throw new Error('payload schema');
      if (!Array.isArray(payload.conflicting_canonicals)) throw new Error('conflicting_canonicals');
      const actualBoundary = text(payload.boundary, 'boundary');
      const actualKind = identityKind(payload.kind);
      const actualUid = normalizeUid(payload.uid);
      const actualCanonical = canonical(payload.canonical);
      const firstSeen = text(payload.first_seen_at, 'first_seen_at');
      const status = text(payload.status, 'status');
      const revision = payload.claim_revision;
      if (!STATUSES.has(status) || !Number.isInteger(revision) || revision < 1) throw new Error('status/revision');
      if (actualBoundary !== boundary || actualKind !== kind || actualUid !== uid) throw new Error('identity');
      if (await claimKey(actualBoundary, actualKind, actualUid) !== key) throw new Error('hash');
      const result = Object.assign({}, payload, {
        boundary: actualBoundary, kind: actualKind, uid: actualUid, canonical: actualCanonical,
        first_seen_at: firstSeen, status, claim_revision: revision,
      });
      result.conflicting_canonicals = candidates(result).slice(1);
      return result;
    } catch (error) {
      if (error instanceof IdentityClaimCorruptError) throw error;
      throw new IdentityClaimCorruptError(`claim が破損しています: ${error && error.message}`);
    }
  }

  async function read(adapter, boundary, kind, uid) {
    const key = await claimKey(boundary, kind, uid);
    const record = await adapter.load(window.MeldexSystemStorage.SystemStorageKind.IDENTITY_CLAIMS, key);
    return { key, record, payload: record ? await validate(record.payload, boundary, kind, uid, key) : null };
  }

  function isCasConflict(error) {
    const Contract = window.MeldexSystemStorage;
    return (Contract.SystemStorageConflictError && error instanceof Contract.SystemStorageConflictError)
      || (error && error.name === 'SystemStorageConflictError');
  }

  async function saveVerified(adapter, key, payload, expectedRevision) {
    const kind = window.MeldexSystemStorage.SystemStorageKind.IDENTITY_CLAIMS;
    const saved = await adapter.save(kind, key, payload, { expectedRevision });
    const readback = await adapter.load(kind, key);
    if (!readback || readback.revision !== saved.revision || JSON.stringify(readback.payload) !== JSON.stringify(payload)) {
      throw new IdentityClaimCorruptError('claim readback 検証に失敗しました');
    }
    return payload;
  }

  function locatorProof(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new IdentityClaimError('provider locator proofが不正です');
    }
    const result = {
      provider_rev: text(value.provider_rev, 'provider_rev'),
      sha256: text(value.sha256, 'sha256').toLowerCase(),
    };
    if (!/^[0-9a-f]{64}$/.test(result.sha256)) {
      throw new IdentityClaimError('provider locator SHA-256が不正です');
    }
    return result;
  }

  async function readProviderLocator(adapter, boundary, kind, wanted) {
    const key = await providerLocatorKey(boundary, kind, wanted.provider, wanted.provider_id);
    const record = await adapter.load(window.MeldexSystemStorage.SystemStorageKind.IDENTITY_CLAIMS, key);
    if (!record) return { key, record: null, payload: null };
    const payload = record.payload;
    if (!payload || !exactKeys(payload, PROVIDER_LOCATOR_KEYS)) {
      throw new IdentityClaimCorruptError('provider locator schemaが破損しています');
    }
    const storedCanonical = canonical(payload.canonical);
    const proof = locatorProof(payload);
    if (text(payload.boundary, 'boundary') !== boundary
        || identityKind(payload.kind) !== kind
        || normalizeUid(payload.uid) !== payload.uid
        || storedCanonical.provider !== wanted.provider
        || storedCanonical.provider_id !== wanted.provider_id
        || !['active', 'tombstoned'].includes(payload.status)
        || !Number.isInteger(payload.locator_revision) || payload.locator_revision < 1) {
      throw new IdentityClaimCorruptError('provider locator identityが破損しています');
    }
    return { key, record, payload: { ...payload, canonical: storedCanonical, ...proof } };
  }

  async function readSourceIndex(adapter, boundary, kind, wanted) {
    const sourceLocator = normalizedSourceLocator(wanted.source_locator);
    const key = await sourceLocatorIndexKey(boundary, kind, wanted.provider, sourceLocator);
    const record = await adapter.load(window.MeldexSystemStorage.SystemStorageKind.IDENTITY_CLAIMS, key);
    if (!record) return { key, record: null, payload: null };
    const payload = record.payload;
    if (!payload || !exactKeys(payload, SOURCE_INDEX_KEYS) || !Array.isArray(payload.refs)
        || text(payload.boundary, 'boundary') !== boundary
        || identityKind(payload.kind) !== kind
        || text(payload.provider, 'provider').toLowerCase() !== wanted.provider
        || normalizedSourceLocator(payload.source_locator) !== sourceLocator
        || !Number.isInteger(payload.index_revision) || payload.index_revision < 1) {
      throw new IdentityClaimCorruptError('source locator indexが破損しています');
    }
    const refs = payload.refs.map((ref) => {
      if (!ref || !exactKeys(ref, new Set(['provider_id', 'uid', 'status']))) {
        throw new IdentityClaimCorruptError('source locator refが破損しています');
      }
      const status = text(ref.status, 'status');
      if (!['active', 'tombstoned'].includes(status)) {
        throw new IdentityClaimCorruptError('source locator statusが破損しています');
      }
      return { provider_id: text(ref.provider_id, 'provider_id'),
        uid: normalizeUid(ref.uid), status };
    });
    return { key, record, payload: { ...payload, source_locator: sourceLocator, refs } };
  }

  async function claimProviderLocator(
    adapter, scopeBoundary, kindValue, uidValue, canonicalValue, proofValue, options,
  ) {
    const boundary = text(scopeBoundary, 'boundary');
    const kind = identityKind(kindValue);
    const uid = normalizeUid(uidValue);
    const wanted = canonical(canonicalValue);
    const proof = locatorProof(proofValue);
    authoritativeBoundary(adapter, boundary);
    const retries = retryCount(options);
    const located = await readProviderLocator(adapter, boundary, kind, wanted);
    if (located.payload) {
      if (located.payload.status !== 'active' || located.payload.uid !== uid
          || !equalCanonical(located.payload.canonical, wanted)
          || located.payload.provider_rev !== proof.provider_rev
          || located.payload.sha256 !== proof.sha256) {
        throw new IdentityClaimConflictError('provider locatorが別identityを指しています');
      }
    } else {
      await saveVerified(adapter, located.key, {
        boundary, kind, uid, canonical: wanted, ...proof,
        status: 'active', locator_revision: 1,
      }, null);
    }
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const index = await readSourceIndex(adapter, boundary, kind, wanted);
      const refs = index.payload?.refs || [];
      const existing = refs.find(ref => ref.provider_id === wanted.provider_id);
      if (existing) {
        if (existing.uid !== uid || existing.status !== 'active') {
          throw new IdentityClaimConflictError('source locator indexが別identityを指しています');
        }
        return { uid, canonical: wanted, ...proof, status: 'active' };
      }
      if (refs.length >= 2048) throw new IdentityClaimConflictError('source locator index上限を超えました');
      const next = index.payload ? {
        ...index.payload, refs: [...refs, { provider_id: wanted.provider_id, uid, status: 'active' }],
        index_revision: index.payload.index_revision + 1,
      } : {
        boundary, kind, provider: wanted.provider, source_locator: normalizedSourceLocator(wanted.source_locator),
        refs: [{ provider_id: wanted.provider_id, uid, status: 'active' }], index_revision: 1,
      };
      try {
        await saveVerified(adapter, index.key, next, index.record?.revision || null);
        return { uid, canonical: wanted, ...proof, status: 'active' };
      } catch (error) { if (!isCasConflict(error)) throw error; }
    }
    throw new IdentityClaimConflictError('source locator index CAS retry上限に達しました');
  }

  async function resolveProviderLocator(
    adapter, scopeBoundary, kindValue, canonicalValue, proofValue,
  ) {
    const boundary = text(scopeBoundary, 'boundary');
    const kind = identityKind(kindValue);
    const wanted = canonical(canonicalValue);
    const proof = locatorProof(proofValue);
    authoritativeBoundary(adapter, boundary);
    const located = await readProviderLocator(adapter, boundary, kind, wanted);
    const indexCanonical = located.payload?.canonical || wanted;
    const index = await readSourceIndex(adapter, boundary, kind, indexCanonical);
    const activeRefs = (index.payload?.refs || []).filter(ref => ref.status === 'active');
    if (!located.payload) {
      return activeRefs.length ? { status: 'ambiguous', count: activeRefs.length } : { status: 'missing', count: 0 };
    }
    if (located.payload.status !== 'active' || located.payload.provider_rev !== proof.provider_rev
        || located.payload.sha256 !== proof.sha256
        || !activeRefs.some(ref => ref.provider_id === wanted.provider_id
          && ref.uid === located.payload.uid)) {
      return { status: 'ambiguous', count: Math.max(1, activeRefs.length) };
    }
    return { status: 'active', count: 1, uid: located.payload.uid,
      canonical: located.payload.canonical, proof };
  }

  async function rebindProviderLocator(
    adapter, scopeBoundary, kindValue, uidValue, providerValue, providerIdValue,
    oldSourceLocatorValue, newSourceLocatorValue, providerRevValue, sha256Value, options,
  ) {
    const boundary = text(scopeBoundary, 'boundary');
    const kind = identityKind(kindValue);
    const uid = normalizeUid(uidValue);
    const provider = text(providerValue, 'provider').toLowerCase();
    const providerId = text(providerIdValue, 'provider_id');
    const oldCanonical = canonical({ provider, provider_id: providerId,
      source_locator: oldSourceLocatorValue });
    const newCanonical = canonical({ provider, provider_id: providerId,
      source_locator: newSourceLocatorValue });
    const oldSourceLocator = normalizedSourceLocator(oldCanonical.source_locator);
    const newSourceLocator = normalizedSourceLocator(newCanonical.source_locator);
    const providerRev = text(providerRevValue, 'provider_rev');
    const sha256 = text(sha256Value, 'sha256').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new IdentityClaimError('移動対象SHA-256が不正です');
    authoritativeBoundary(adapter, boundary);
    const retries = retryCount(options);
    const lookupCanonical = oldCanonical;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const located = await readProviderLocator(adapter, boundary, kind, lookupCanonical);
      if (!located.payload || located.payload.status !== 'active' || located.payload.uid !== uid
          || located.payload.sha256 !== sha256) {
        throw new IdentityClaimConflictError('移動対象provider locatorが一致しません');
      }
      const storedPath = normalizedSourceLocator(located.payload.canonical.source_locator);
      if (storedPath !== oldSourceLocator && storedPath !== newSourceLocator) {
        throw new IdentityClaimConflictError('移動対象provider locator pathが一致しません');
      }
      if (storedPath === oldSourceLocator && oldSourceLocator !== newSourceLocator) {
        const next = { ...located.payload,
          canonical: newCanonical,
          provider_rev: providerRev,
          locator_revision: located.payload.locator_revision + 1 };
        try { await saveVerified(adapter, located.key, next, located.record.revision); }
        catch (error) { if (isCasConflict(error)) continue; throw error; }
      }
      await claimProviderLocator(adapter, boundary, kind, uid, newCanonical, {
        provider_rev: providerRev, sha256,
      }, options);
      if (oldSourceLocator === newSourceLocator) return newCanonical;
      for (let indexAttempt = 0; indexAttempt < retries; indexAttempt += 1) {
        const oldIndex = await readSourceIndex(adapter, boundary, kind, lookupCanonical);
        const ref = oldIndex.payload?.refs.find(item => item.provider_id === providerId);
        if (!ref || ref.uid !== uid) {
          throw new IdentityClaimConflictError('移動元source locator indexが一致しません');
        }
        if (ref.status === 'tombstoned') return newCanonical;
        const refs = oldIndex.payload.refs.map(item => item.provider_id === providerId
          ? { ...item, status: 'tombstoned' } : item);
        try {
          await saveVerified(adapter, oldIndex.key, { ...oldIndex.payload, refs,
            index_revision: oldIndex.payload.index_revision + 1 }, oldIndex.record.revision);
          return newCanonical;
        } catch (error) { if (!isCasConflict(error)) throw error; }
      }
      throw new IdentityClaimConflictError('source locator rebind CAS retry上限に達しました');
    }
    throw new IdentityClaimConflictError('provider locator rebind CAS retry上限に達しました');
  }

  async function refreshProviderLocatorProof(
    adapter, scopeBoundary, kindValue, canonicalValue, proofValue, options,
  ) {
    const boundary = text(scopeBoundary, 'boundary');
    const kind = identityKind(kindValue);
    const wanted = canonical(canonicalValue);
    const proof = locatorProof(proofValue);
    authoritativeBoundary(adapter, boundary);
    const retries = retryCount(options);
    let initialProviderRev = '';
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const located = await readProviderLocator(adapter, boundary, kind, wanted);
      if (!located.payload || located.payload.status !== 'active'
          || located.payload.sha256 !== proof.sha256) {
        throw new IdentityClaimConflictError('provider locator proofを更新できません');
      }
      const storedCanonical = located.payload.canonical;
      const main = await read(adapter, boundary, kind, located.payload.uid);
      if (!main.payload || main.payload.status !== 'active'
          || !equalCanonical(main.payload.canonical, storedCanonical)) {
        throw new IdentityClaimConflictError('provider locatorとmain claimが一致しません');
      }
      const index = await readSourceIndex(adapter, boundary, kind, storedCanonical);
      const activeRef = index.payload?.refs.find(ref => (
        ref.provider_id === storedCanonical.provider_id
          && ref.uid === located.payload.uid && ref.status === 'active'
      ));
      if (!activeRef) {
        throw new IdentityClaimConflictError('provider locatorとsource indexが一致しません');
      }
      if (located.payload.provider_rev === proof.provider_rev) {
        return { status: 'active', uid: located.payload.uid,
          canonical: storedCanonical, proof };
      }
      if (!initialProviderRev) initialProviderRev = located.payload.provider_rev;
      else if (located.payload.provider_rev !== initialProviderRev) {
        throw new IdentityClaimConflictError('provider locator revisionが並行更新されました');
      }
      const next = { ...located.payload, provider_rev: proof.provider_rev,
        locator_revision: located.payload.locator_revision + 1 };
      try {
        await saveVerified(adapter, located.key, next, located.record.revision);
        return { status: 'active', uid: located.payload.uid,
          canonical: storedCanonical, proof };
      } catch (error) { if (!isCasConflict(error)) throw error; }
    }
    throw new IdentityClaimConflictError('provider locator proof更新CAS retry上限に達しました');
  }

  async function tombstoneProviderLocator(
    adapter, scopeBoundary, kindValue, uidValue, canonicalValue, proofValue, options,
  ) {
    const boundary = text(scopeBoundary, 'boundary');
    const kind = identityKind(kindValue);
    const uid = normalizeUid(uidValue);
    const wanted = canonical(canonicalValue);
    const proof = locatorProof(proofValue);
    authoritativeBoundary(adapter, boundary);
    const retries = retryCount(options);
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const located = await readProviderLocator(adapter, boundary, kind, wanted);
      if (!located.payload || located.payload.uid !== uid
          || !equalCanonical(located.payload.canonical, wanted)
          || located.payload.provider_rev !== proof.provider_rev
          || located.payload.sha256 !== proof.sha256) {
        throw new IdentityClaimConflictError('削除対象provider locatorが一致しません');
      }
      if (located.payload.status === 'active') {
        try {
          await saveVerified(adapter, located.key, { ...located.payload,
            status: 'tombstoned', locator_revision: located.payload.locator_revision + 1 },
          located.record.revision);
        } catch (error) { if (isCasConflict(error)) continue; throw error; }
      }
      const index = await readSourceIndex(adapter, boundary, kind, wanted);
      const ref = index.payload?.refs.find(item => item.provider_id === wanted.provider_id);
      if (!ref || ref.uid !== uid) throw new IdentityClaimConflictError('削除対象source locatorが一致しません');
      if (ref.status === 'tombstoned') return { status: 'tombstoned', uid };
      const refs = index.payload.refs.map(item => item.provider_id === wanted.provider_id
        ? { ...item, status: 'tombstoned' } : item);
      try {
        await saveVerified(adapter, index.key, { ...index.payload, refs,
          index_revision: index.payload.index_revision + 1 }, index.record.revision);
        return { status: 'tombstoned', uid };
      } catch (error) { if (!isCasConflict(error)) throw error; }
    }
    throw new IdentityClaimConflictError('provider locator tombstone CAS retry上限に達しました');
  }

  async function claimIdentity(adapter, scopeBoundary, kindValue, uidValue, canonicalValue, options) {
    const boundary = text(scopeBoundary, 'boundary');
    const kind = identityKind(kindValue);
    const uid = normalizeUid(uidValue);
    const wanted = canonical(canonicalValue);
    authoritativeBoundary(adapter, boundary);
    const retries = retryCount(options);
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const current = await read(adapter, boundary, kind, uid);
      let next;
      let expectedRevision;
      if (!current.payload) {
        next = { boundary, kind, uid, canonical: wanted, first_seen_at: new Date().toISOString(), status: 'active', claim_revision: 1, conflicting_canonicals: [] };
        expectedRevision = null;
      } else {
        if (current.payload.status === 'tombstoned') throw new IdentityClaimConflictError('tombstoned claim はactiveへ戻せません');
        const known = candidates(current.payload);
        if (known.some(item => equalCanonical(item, wanted))) return current.payload;
        if (known.length >= MAX_CANONICALS) throw new IdentityClaimConflictError('claim canonical候補上限を超えました');
        next = Object.assign({}, current.payload, { status: 'ambiguous', claim_revision: current.payload.claim_revision + 1, conflicting_canonicals: known.slice(1).concat([wanted]) });
        expectedRevision = current.record.revision;
      }
      try { return await saveVerified(adapter, current.key, next, expectedRevision); } catch (error) {
        if (!isCasConflict(error)) throw error;
      }
    }
    throw new IdentityClaimConflictError('claim CAS retry上限に達しました');
  }

  async function tombstoneIdentity(adapter, scopeBoundary, kindValue, uidValue, canonicalValue, options) {
    const boundary = text(scopeBoundary, 'boundary');
    const kind = identityKind(kindValue);
    const uid = normalizeUid(uidValue);
    const wanted = canonical(canonicalValue);
    authoritativeBoundary(adapter, boundary);
    const retries = retryCount(options);
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const current = await read(adapter, boundary, kind, uid);
      if (current.payload) {
        const known = candidates(current.payload);
        if (known.length !== 1 || !equalCanonical(known[0], wanted)) {
          throw new IdentityClaimConflictError('削除対象とactive claim canonicalが一致しません');
        }
        if (current.payload.status === 'tombstoned') return current.payload;
      }
      const next = current.payload
        ? Object.assign({}, current.payload, { status: 'tombstoned', claim_revision: current.payload.claim_revision + 1 })
        : { boundary, kind, uid, canonical: wanted, first_seen_at: new Date().toISOString(), status: 'tombstoned', claim_revision: 1, conflicting_canonicals: [] };
      try { return await saveVerified(adapter, current.key, next, current.record ? current.record.revision : null); } catch (error) {
        if (!isCasConflict(error)) throw error;
      }
    }
    throw new IdentityClaimConflictError('tombstone CAS retry上限に達しました');
  }

  async function resolveIdentity(adapter, scopeBoundary, kindValue, uidValue) {
    const boundary = text(scopeBoundary, 'boundary');
    const kind = identityKind(kindValue);
    const uid = normalizeUid(uidValue);
    authoritativeBoundary(adapter, boundary);
    const current = await read(adapter, boundary, kind, uid);
    if (!current.payload || current.payload.status === 'tombstoned') return { count: 0, status: current.payload ? current.payload.status : 'missing', canonical: null };
    const known = candidates(current.payload);
    if (current.payload.status === 'ambiguous' || known.length > 1) return { count: Math.max(2, known.length), status: 'ambiguous', canonical: null, candidates: known };
    return { count: 1, status: 'active', canonical: known[0] };
  }

  window.MeldexIdentityClaims = {
    IdentityClaimError, IdentityClaimConflictError, IdentityClaimCorruptError,
    normalizeUid, claimKey, claimIdentity, tombstoneIdentity, resolveIdentity,
    claimProviderLocator, resolveProviderLocator, tombstoneProviderLocator,
    rebindProviderLocator, refreshProviderLocatorProof,
  };
}());
