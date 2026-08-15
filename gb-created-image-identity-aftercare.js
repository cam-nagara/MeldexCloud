/* Cloud image identity aftercare. Cloud binary objects are read-only here. */
(function () {
  'use strict';
  if (window.MeldexCreatedImageIdentityAftercare) return;

  const IMAGE_SUFFIXES = new Set(['.apng', '.jpeg', '.jpg', '.png', '.webp']);
  const OPERATION = 'created-cloud-image-identity';
  const DRAIN_LIMIT = 50;
  const drainFlights = new WeakMap();

  function imagePath(path) {
    const match = String(path || '').toLowerCase().match(/\.[^.\/]+$/);
    return Boolean(match && IMAGE_SUFFIXES.has(match[0]));
  }

  function bytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError('Cloud画像bytesが不正です');
  }

  function sameBytes(left, right) {
    if (left.byteLength !== right.byteLength) return false;
    for (let index = 0; index < left.byteLength; index += 1) {
      if (left[index] !== right[index]) return false;
    }
    return true;
  }

  async function digest(value) {
    const result = await crypto.subtle.digest('SHA-256', value);
    return Array.from(new Uint8Array(result), item => item.toString(16).padStart(2, '0')).join('');
  }

  function providerRevision(value) {
    const meta = value?.meta || value || {};
    return {
      id: String(meta.id || meta.provider_id || ''),
      rev: String(meta.rev || meta.revision || meta.etag || meta.content_hash || ''),
    };
  }

  function typedProvider(provider) {
    const Constructor = window.MeldexStorageAdapter?.DropboxStorageProvider;
    if (typeof Constructor !== 'function' || !(provider instanceof Constructor)) {
      throw new Error('DropboxStorageProvider以外ではCloud画像identityを記録できません');
    }
    return provider;
  }

  async function freshObject(provider, path, expectedBytes = null, expectedSha256 = '') {
    if (typeof provider.readBytesFresh !== 'function') {
      throw new Error('Dropbox bytes fresh read契約を利用できません');
    }
    const read = await provider.readBytesFresh(path);
    const actualBytes = bytes(read?.bytes);
    const rawMeta = typeof provider.refreshMetadata === 'function'
      ? await provider.refreshMetadata(path)
      : (typeof provider.statPathFresh === 'function' ? await provider.statPathFresh(path) : null);
    const identity = providerRevision(rawMeta);
    if (!identity.id || !identity.rev || String(read?.revision || '') !== identity.rev) {
      throw Object.assign(new Error('Dropbox画像のprovider identityが安定していません'), { status: 409 });
    }
    if (expectedBytes && !sameBytes(actualBytes, expectedBytes)) {
      throw Object.assign(new Error('Dropbox画像bytesがpublish後に変更されています'), { status: 409 });
    }
    const sha256 = await digest(actualBytes);
    if (expectedSha256 && sha256 !== expectedSha256) {
      throw Object.assign(
        new Error('Dropbox画像bytesがprepared intentと一致しません'),
        { status: 409, meldexCode: 'created_image_pending_blocked' },
      );
    }
    return { ...identity, sha256 };
  }

  async function freshPreparedObject(provider, intent) {
    if (typeof provider.readBytesFresh !== 'function') {
      throw new Error('Dropbox bytes fresh read契約を利用できません');
    }
    const read = await provider.readBytesFresh(intent.source_locator);
    const actualBytes = bytes(read?.bytes);
    const rawMeta = typeof provider.refreshMetadata === 'function'
      ? await provider.refreshMetadata(intent.source_locator)
      : (typeof provider.statPathFresh === 'function'
        ? await provider.statPathFresh(intent.source_locator) : null);
    const identity = providerRevision(rawMeta);
    const sha256 = await digest(actualBytes);
    if (!identity.id || !identity.rev || String(read?.revision || '') !== identity.rev
        || identity.id !== intent.provider_id || identity.rev !== intent.provider_rev
        || sha256 !== intent.sha256) {
      throw Object.assign(
        new Error('pending Cloud画像のprovider ID/rev/bytesが一致しません'),
        { status: 409, meldexCode: 'created_image_pending_blocked' },
      );
    }
    return { ...identity, sha256 };
  }

  function assertTypedClaimAdapter(adapter, expectedBoundary = '') {
    const Constructor = window.MeldexSystemStorageDropbox?.DropboxSystemStorageAdapter;
    if (typeof Constructor !== 'function' || !(adapter instanceof Constructor)) {
      throw new Error('Dropbox型SystemStorage adapter以外にはclaimを書き込めません');
    }
    const boundary = String(adapter.describe()?.boundary || '');
    if (!boundary || (expectedBoundary && boundary !== expectedBoundary)) {
      throw Object.assign(new Error('pending claimのDropbox保存境界が一致しません'), { status: 409 });
    }
    return { adapter, boundary };
  }

  async function typedClaimAdapter(provider, path, expectedBoundary = '') {
    const resolver = window.MeldexDropboxManagementRootResolver;
    const contract = window.MeldexSystemStorage;
    if (!resolver?.resolveTypedAdapterForProvider || !contract?.SystemStorageKind?.IDENTITY_CLAIMS) {
      throw new Error('Dropbox identity claim保存境界を解決できません');
    }
    const adapter = await resolver.resolveTypedAdapterForProvider(
      provider, contract.SystemStorageKind.IDENTITY_CLAIMS, { targetPath: path },
    );
    return assertTypedClaimAdapter(adapter, expectedBoundary).adapter;
  }

  function newPortableUid() {
    const value = String(crypto.randomUUID()).replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(value)) throw new Error('portable UID生成に失敗しました');
    return value;
  }

  function operationPayload(intent) {
    return {
      path: String(intent.idempotency_path || idempotencyPath(intent.source_locator)),
      route_operation_id: String(intent.route_operation_id || ''),
      expected_sha256: String(intent.expected_sha256 || ''),
      identity_kind: String(intent.identity_kind || 'asset'),
      stable_intent: String(intent.stable_intent || 'created-image'),
    };
  }

  function idempotencyPath(path) {
    return String(path || '').normalize('NFC').replace(/\\/g, '/').replace(/\/{2,}/g, '/')
      .replace(/^\/+|\/+$/g, '').toLocaleLowerCase('en-US');
  }

  function completedResult(operationId, intent) {
    return {
      ok: true,
      operation_id: operationId,
      mode: 'ledger-only',
      reason: 'cloud-binary-invariant',
      aftercare_pending: false,
      portable_uid: intent.portable_uid,
      provider_id: intent.provider_id,
      provider_rev: intent.provider_rev,
      path: intent.source_locator,
    };
  }

  async function verifyCompletedCanonical(provider, operation) {
    if (operation?.state !== 'completed') return operation;
    const claims = window.MeldexIdentityClaims;
    if (!claims?.resolveIdentity) throw new Error('Cloud画像identity claim解決契約を利用できません');
    const adapter = await typedClaimAdapter(
      provider, operation.intent.source_locator, operation.intent.claim_boundary,
    );
    const boundary = String(adapter.describe().boundary || '');
    const resolved = await claims.resolveIdentity(
      adapter, boundary, 'asset', operation.intent.portable_uid,
    );
    if (resolved.status !== 'active'
        || resolved.canonical?.provider !== 'dropbox'
        || resolved.canonical?.provider_id !== operation.intent.provider_id
        || resolved.canonical?.source_locator !== operation.intent.source_locator) {
      throw Object.assign(
        new Error('completed Cloud画像のactive canonical claimが一致しません'),
        { status: 409, meldexCode: 'created_image_completed_claim_mismatch' },
      );
    }
    if (!claims.resolveProviderLocator) {
      throw new Error('Cloud画像provider locator契約を利用できません');
    }
    const reverse = await claims.resolveProviderLocator(
      adapter, boundary, 'asset', {
        provider: 'dropbox', provider_id: operation.intent.provider_id,
        source_locator: operation.intent.source_locator,
      }, { provider_rev: operation.intent.provider_rev, sha256: operation.intent.sha256 },
    );
    if (reverse.status !== 'active' || reverse.uid !== operation.intent.portable_uid) {
      throw Object.assign(
        new Error('completed Cloud画像のprovider locatorが一致しません'),
        { status: 409, meldexCode: 'created_image_completed_locator_mismatch' },
      );
    }
    return operation;
  }

  async function lookupCompleted(providerValue, pathValue, sourceLocatorHint = '') {
    const provider = typedProvider(providerValue);
    const path = String(pathValue || '').trim().replace(/\\/g, '/');
    if (!imagePath(path)) return null;
    const journal = window.MeldexCloudCopyOperationJournal;
    if (!journal?.listCompleted) throw new Error('Cloud画像completed journalを参照できません');
    const fresh = await freshObject(provider, path);
    const locator = idempotencyPath(sourceLocatorHint);
    const claims = window.MeldexIdentityClaims;
    if (!claims?.resolveProviderLocator || !claims?.resolveIdentity) {
      throw new Error('Cloud画像provider locatorを参照できません');
    }
    const adapter = await typedClaimAdapter(provider, path);
    const boundary = String(adapter.describe()?.boundary || '');
    const wantedCanonical = {
      provider: 'dropbox', provider_id: fresh.id, source_locator: sourceLocatorHint || path,
    };
    const freshProof = { provider_rev: fresh.rev, sha256: fresh.sha256 };
    let reverse = await claims.resolveProviderLocator(
      adapter, boundary, 'asset', wantedCanonical, freshProof,
    );
    if (reverse.status === 'ambiguous' && claims.refreshProviderLocatorProof) {
      try {
        reverse = await claims.refreshProviderLocatorProof(
          adapter, boundary, 'asset', wantedCanonical, freshProof,
        );
      } catch (error) {
        if (!error.status) error.status = 409;
        throw error;
      }
    }
    if (reverse.status === 'active') {
      const resolved = await claims.resolveIdentity(adapter, boundary, 'asset', reverse.uid);
      if (resolved.status !== 'active'
          || resolved.canonical?.provider !== reverse.canonical.provider
          || resolved.canonical?.provider_id !== reverse.canonical.provider_id
          || resolved.canonical?.source_locator !== reverse.canonical.source_locator) {
        throw Object.assign(new Error('削除対象Cloud画像のreverse claimが一致しません'), { status: 409 });
      }
      return Object.freeze({
        kind: 'asset', uid: reverse.uid, boundary, provider_revision: fresh.rev,
        canonical: reverse.canonical,
        provider_locator: { provider_rev: fresh.rev, sha256: fresh.sha256 },
      });
    }
    if (reverse.status === 'ambiguous') {
      throw Object.assign(
        new Error('削除対象Cloud画像のprovider locatorを一意に証明できません'),
        { status: 409, meldexCode: 'created_image_delete_identity_ambiguous' },
      );
    }
    const records = await journal.listCompleted(provider, OPERATION, 512);
    const candidates = records.filter((record) => {
      const intent = record?.intent || {};
      return String(intent.provider_id || '') === fresh.id
        || (locator && idempotencyPath(intent.source_locator) === locator);
    });
    if (!candidates.length) return null;
    const matches = candidates.filter((record) => {
      const intent = record.intent || {};
      return String(intent.provider_id || '') === fresh.id
        && String(intent.provider_rev || '') === fresh.rev
        && String(intent.sha256 || '') === fresh.sha256;
    });
    if (matches.length !== 1) {
      throw Object.assign(
        new Error('削除対象Cloud画像のcompleted identityを一意に証明できません'),
        { status: 409, meldexCode: 'created_image_delete_identity_ambiguous' },
      );
    }
    const operation = matches[0];
    const intent = operation.intent || {};
    assertTypedClaimAdapter(adapter, intent.claim_boundary);
    if (!claims?.resolveIdentity || !intent.portable_uid || !boundary) {
      throw new Error('completed Cloud画像claimを参照できません');
    }
    const resolved = await claims.resolveIdentity(adapter, boundary, 'asset', intent.portable_uid);
    const canonical = {
      provider: 'dropbox', provider_id: intent.provider_id,
      source_locator: intent.source_locator,
    };
    if (resolved.status !== 'active'
        || resolved.canonical?.provider !== canonical.provider
        || resolved.canonical?.provider_id !== canonical.provider_id
        || resolved.canonical?.source_locator !== canonical.source_locator) {
      throw Object.assign(
        new Error('削除対象Cloud画像のactive claimが一意に一致しません'),
        { status: 409, meldexCode: 'created_image_delete_claim_mismatch' },
      );
    }
    return Object.freeze({
      kind: 'asset', uid: intent.portable_uid, boundary,
      provider_revision: intent.provider_rev, canonical,
    });
  }

  async function claimPrepared(provider, intent, adapter, suppliedScope = '') {
    const claims = window.MeldexIdentityClaims;
    if (!claims?.claimIdentity || !claims?.claimProviderLocator) {
      throw new Error('Cloud画像identity claim契約を利用できません');
    }
    const before = await freshPreparedObject(provider, intent);
    assertTypedClaimAdapter(adapter, intent.claim_boundary);
    const boundary = String(adapter.describe().boundary || '');
    if (suppliedScope && suppliedScope !== boundary) {
      throw Object.assign(new Error('drain対象scopeがpending claim境界と一致しません'), { status: 409 });
    }
    await claims.claimIdentity(adapter, boundary, 'asset', intent.portable_uid, {
      provider: 'dropbox',
      provider_id: intent.provider_id,
      source_locator: intent.source_locator,
    });
    await claims.claimProviderLocator(adapter, boundary, 'asset', intent.portable_uid, {
      provider: 'dropbox', provider_id: intent.provider_id,
      source_locator: intent.source_locator,
    }, { provider_rev: intent.provider_rev, sha256: intent.sha256 });
    const after = await freshPreparedObject(provider, intent);
    if (after.id !== before.id || after.rev !== before.rev || after.sha256 !== before.sha256) {
      throw Object.assign(new Error('Cloud画像がclaim中に変更されています'), { status: 409 });
    }
  }

  async function captureProof(provider, operation, payload) {
    if (operation.state !== 'awaiting_proof'
        && operation.intent?.operation_state !== 'awaiting_proof') return operation;
    const proof = await freshObject(
      provider, operation.intent.source_locator, null, operation.intent.expected_sha256,
    );
    const intent = {
      ...operation.intent,
      operation_state: 'proof_ready',
      provider_id: proof.id,
      provider_rev: proof.rev,
      sha256: proof.sha256,
    };
    await window.MeldexCloudCopyOperationJournal.updateIntent(
      provider, operation.operation_id, OPERATION, payload, intent,
    );
    return { ...operation, state: 'prepared', intent };
  }

  async function bindClaimBoundary(provider, operation, payload, suppliedAdapter, suppliedScope) {
    const expected = String(operation.intent.claim_boundary || operation.intent.expected_boundary_hint || '');
    const adapter = suppliedAdapter
      ? assertTypedClaimAdapter(suppliedAdapter, expected).adapter
      : await typedClaimAdapter(provider, operation.intent.source_locator, expected);
    const boundary = String(adapter.describe().boundary || '');
    if (suppliedScope && suppliedScope !== boundary) {
      throw Object.assign(new Error('drain対象scopeがpending claim境界と一致しません'), { status: 409 });
    }
    if (operation.intent.claim_boundary === boundary) return { operation, adapter };
    const intent = { ...operation.intent, claim_boundary: boundary };
    await window.MeldexCloudCopyOperationJournal.updateIntent(
      provider, operation.operation_id, OPERATION, payload, intent,
    );
    return { operation: { ...operation, intent }, adapter };
  }

  async function resumePrepared(provider, operation, suppliedAdapter = null, suppliedScope = '') {
    const journal = window.MeldexCloudCopyOperationJournal;
    const payload = operationPayload(operation.intent || {});
    return journal.withFlight(
      provider, operation.operation_id, OPERATION, payload, async identity => {
        let current = await journal.load(
          provider, operation.operation_id, OPERATION, payload, identity,
        );
        if (!current || current.state === 'completed') return current?.result || null;
        if (current.state === 'failed') {
          throw Object.assign(
            new Error('Cloud画像のbinary publishが完了していません'),
            { status: 503, meldexCode: 'created_image_publish_failed' },
          );
        }
        current = await captureProof(provider, current, payload);
        const intent = { ...current.intent };
        if (intent.aftercare_in_progress) {
          delete intent.aftercare_in_progress;
          await journal.updateIntent(
            provider, operation.operation_id, OPERATION, payload, intent,
          );
          current = { ...current, intent };
        }
        const bound = await bindClaimBoundary(
          provider, current, payload, suppliedAdapter, suppliedScope,
        );
        current = bound.operation;
        current = await journal.runAftercare(
          provider, operation.operation_id, OPERATION, payload, current,
          [{
            name: 'claim-created-image',
            run: () => claimPrepared(provider, current.intent, bound.adapter, suppliedScope),
          }],
        );
        return journal.complete(
          provider, operation.operation_id, OPERATION, payload,
          completedResult(operation.operation_id, current.intent),
        );
      },
    );
  }

  async function prepare(providerValue, pathValue, encodedBytes, options) {
    const provider = typedProvider(providerValue);
    const path = String(pathValue || '').trim().replace(/\\/g, '/');
    if (!imagePath(path)) return { ok: true, mode: 'not-image', path };
    const expectedBytes = bytes(encodedBytes).slice();
    const expectedSha256 = await digest(expectedBytes);
    const identityKind = 'asset';
    const stableIntent = String(options?.stableIntent || 'created-image').normalize('NFC').trim()
      || 'created-image';
    const idempotencyValue = JSON.stringify({
      path: idempotencyPath(path), expected_sha256: expectedSha256,
      identity_kind: identityKind, stable_intent: stableIntent,
    });
    const routeOperationId = await digest(new TextEncoder().encode(idempotencyValue));
    const operationId = `created-image-${routeOperationId}`;
    const normalizedPath = idempotencyPath(path);
    const payload = {
      path: normalizedPath, route_operation_id: routeOperationId, expected_sha256: expectedSha256,
      identity_kind: identityKind, stable_intent: stableIntent,
    };
    const journal = window.MeldexCloudCopyOperationJournal;
    if (!journal?.withFlight || !journal?.prepare || !journal?.fail || !journal?.rearm) {
      throw new Error('Cloud画像identity journal契約を利用できません');
    }
    const publisherToken = String(crypto.randomUUID()).toLowerCase();
    const operation = await journal.withFlight(provider, operationId, OPERATION, payload, async identity => {
      const existing = await journal.load(provider, operationId, OPERATION, payload, identity);
      if (existing?.state === 'failed') {
        return journal.rearm(
          provider, operationId, OPERATION, payload, publisherToken,
        );
      }
      if (existing) return verifyCompletedCanonical(provider, existing);
      return journal.prepare(provider, operationId, OPERATION, payload, {
        operation_state: 'awaiting_proof',
        route_operation_id: routeOperationId,
        identity_kind: identityKind,
        stable_intent: stableIntent,
        idempotency_path: normalizedPath,
        publisher_token: publisherToken,
        portable_uid: newPortableUid(),
        expected_sha256: expectedSha256,
        expected_boundary_hint: String(options?.expectedBoundaryHint || ''),
        source_locator: path,
        filename: String(options?.filename || path.split('/').pop() || ''),
        claim_boundary: '',
        source: String(options?.source || 'cloud-upload'),
        aftercare_completed: [],
      }, identity);
    });
    const publishRequired = operation.state === 'awaiting_proof'
      && operation.intent?.publisher_token === publisherToken;
    return Object.freeze({
      operation_id: operationId, payload, path, intent: operation.intent,
      publish_required: publishRequired,
    });
  }

  async function cancel(providerValue, prepared, reason = 'publish-failed') {
    const provider = typedProvider(providerValue);
    const journal = window.MeldexCloudCopyOperationJournal;
    if (!prepared?.operation_id || !prepared?.payload || !journal?.fail) {
      throw new Error('Cloud画像prepared intentが不正です');
    }
    await journal.fail(provider, prepared.operation_id, OPERATION, prepared.payload, reason);
    return { ok: true, state: 'failed', operation_id: prepared.operation_id };
  }

  async function record(providerValue, pathValue, encodedBytes, options) {
    const provider = typedProvider(providerValue);
    const path = String(pathValue || '').trim().replace(/\\/g, '/');
    if (!imagePath(path)) return { ok: true, mode: 'not-image', path };
    const prepared = options?.prepared;
    if (!prepared?.operation_id || prepared.path !== path) {
      throw new Error('Cloud画像はbinary publish前にprepareする必要があります');
    }
    const actualSha256 = await digest(bytes(encodedBytes));
    if (actualSha256 !== prepared.payload.expected_sha256) {
      throw new Error('publish bytesがprepared intentと一致しません');
    }
    const journal = window.MeldexCloudCopyOperationJournal;
    const operation = await journal.load(
      provider, prepared.operation_id, OPERATION, prepared.payload,
    );
    try {
      return await resumePrepared(provider, operation);
    } catch (error) {
      if (error?.meldexCode === 'created_image_publish_failed'
          || (!prepared.publish_required && operation.state === 'awaiting_proof')) {
        throw Object.assign(
          new Error('Cloud画像publisherの完了を確認できません'),
          { status: 503, meldexCode: 'created_image_publisher_incomplete' },
        );
      }
      console.warn('[created-image-identity] claim pending', error);
      return {
        ...completedResult(prepared.operation_id, operation.intent),
        aftercare_pending: true,
        pending_reason: String(error?.meldexCode || error?.message || 'claim-failed'),
      };
    }
  }

  async function drainPrepared(providerValue, adapter = null, scope = '') {
    const provider = typedProvider(providerValue);
    const journal = window.MeldexCloudCopyOperationJournal;
    if (!journal?.listPrepared) throw new Error('Cloud画像pending journalを列挙できません');
    if (adapter) assertTypedClaimAdapter(adapter, scope);
    let providerFlights = drainFlights.get(provider);
    if (!providerFlights) {
      providerFlights = new Map();
      drainFlights.set(provider, providerFlights);
    }
    const flightKey = String(scope || adapter?.describe?.().boundary || 'auto');
    if (providerFlights.has(flightKey)) return providerFlights.get(flightKey);
    const flight = (async () => {
      const pending = await journal.listPrepared(provider, OPERATION, DRAIN_LIMIT);
      const result = { scanned: pending.length, completed: 0, blocked: 0, limit: DRAIN_LIMIT };
      for (const operation of pending) {
        try {
          await resumePrepared(provider, operation, adapter, scope);
          result.completed += 1;
        } catch (error) {
          result.blocked += 1;
          console.warn('[created-image-identity] pending claim blocked', error);
        }
      }
      return result;
    })();
    providerFlights.set(flightKey, flight);
    try {
      return await flight;
    } finally {
      if (providerFlights.get(flightKey) === flight) providerFlights.delete(flightKey);
    }
  }

  async function drainConnected() {
    if (!window.MeldexRuntimeAdapter?.isDropboxMode?.()) {
      return { scanned: 0, completed: 0, blocked: 0, limit: DRAIN_LIMIT };
    }
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) return { scanned: 0, completed: 0, blocked: 0, limit: DRAIN_LIMIT };
    await provider.restoreWorkspace?.();
    return drainPrepared(provider);
  }

  window.addEventListener?.('online', () => { void drainConnected().catch(console.warn); });
  window.addEventListener?.(
    'meldex:dropbox-auth-session-changed',
    () => { void drainConnected().catch(console.warn); },
  );
  window.addEventListener?.(
    'meldex:workspaces-changed',
    () => { void drainConnected().catch(console.warn); },
  );

  window.MeldexCreatedImageIdentityAftercare = Object.freeze({
    imagePath, prepare, record, cancel, lookupCompleted, drainPrepared, drainConnected,
  });
}());
