/* Durable CAS journal for Cloud duplicate/save-as identity transactions. */
  const _CLOUD_COPY_COMPLETED_LIMIT = 512;
  const _cloudCopyFlights = new Map();

  function _canonicalCloudCopyValue(value) {
    if (Array.isArray(value)) return value.map(_canonicalCloudCopyValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, _canonicalCloudCopyValue(value[key])]));
  }

  async function _cloudCopyDigest(scope, operation, payload) {
    const encoded = new TextEncoder().encode(JSON.stringify(_canonicalCloudCopyValue({ scope, operation, payload })));
    const bytes = await crypto.subtle.digest('SHA-256', encoded);
    return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  async function _cloudCopyIdentity(provider, operationId, operation, payload) {
    const scope = await _folderLinksManagementScope(provider);
    if (!scope) throw new Error('Cloudファイル操作の保存境界を識別できません');
    return { scope, fingerprint: await _cloudCopyDigest(scope, operation, payload),
      key: `${scope}\u0000${operationId}` };
  }

  function _assertCloudCopyRecord(record, operationId, operation, identity) {
    if (!record) return;
    if (record.operation_id !== operationId || record.operation !== operation
        || record.scope_id !== identity.scope || record.fingerprint !== identity.fingerprint) {
      const error = new Error('同じ operation_id を異なるCloudファイル操作へ再利用できません');
      error.status = 409; error.meldexCode = 'operation_id_conflict';
      throw error;
    }
  }

  function _pruneCloudCopyOperations(operations) {
    const terminal = operations.filter(record => record.state === 'completed' || record.state === 'failed');
    const keep = new Set(terminal.slice(-_CLOUD_COPY_COMPLETED_LIMIT));
    return operations.filter(record => (record.state !== 'completed' && record.state !== 'failed')
      || keep.has(record));
  }

  async function _withCloudCopyFlight(provider, operationId, operation, payload, task) {
    const identity = await _cloudCopyIdentity(provider, operationId, operation, payload);
    const previous = _cloudCopyFlights.get(identity.key);
    if (previous) {
      if (previous.fingerprint !== identity.fingerprint) {
        const error = new Error('同じ operation_id を異なるCloudファイル操作へ再利用できません');
        error.status = 409; error.meldexCode = 'operation_id_conflict';
        throw error;
      }
      return previous.promise;
    }
    const promise = Promise.resolve().then(() => task(identity));
    const record = { fingerprint: identity.fingerprint, promise };
    _cloudCopyFlights.set(identity.key, record);
    try { return await promise; }
    finally { if (_cloudCopyFlights.get(identity.key) === record) _cloudCopyFlights.delete(identity.key); }
  }

  async function _loadCloudCopyOperation(provider, operationId, operation, payload, identity = null) {
    const resolved = identity || await _cloudCopyIdentity(provider, operationId, operation, payload);
    const state = await _folderLinksStateForProvider(provider);
    const record = _normalizeOutlinerOperations(state.outliner_operations)
      .find(row => row.operation_id === operationId) || null;
    _assertCloudCopyRecord(record, operationId, operation, resolved);
    return record;
  }

  async function _listPreparedCloudCopyOperations(provider, operation, limit = 50) {
    const bounded = Math.max(1, Math.min(50, Number(limit) || 50));
    const scope = await _folderLinksManagementScope(provider);
    if (!scope) throw new Error('Cloudファイル操作の保存境界を識別できません');
    const state = await _folderLinksStateForProvider(provider);
    return _normalizeOutlinerOperations(state.outliner_operations)
      .filter(record => (record.state === 'prepared' || record.state === 'awaiting_proof')
        && (!operation || record.operation === operation)
        && record.scope_id === scope)
      .slice(0, bounded)
      .map(record => structuredClone(record));
  }

  async function _listCompletedCloudCopyOperations(provider, operation, limit = 512) {
    const bounded = Math.max(1, Math.min(_CLOUD_COPY_COMPLETED_LIMIT, Number(limit) || 512));
    const scope = await _folderLinksManagementScope(provider);
    if (!scope) throw new Error('Cloudファイル操作の保存境界を識別できません');
    const state = await _folderLinksStateForProvider(provider);
    return _normalizeOutlinerOperations(state.outliner_operations)
      .filter(record => record.state === 'completed'
        && (!operation || record.operation === operation)
        && record.scope_id === scope)
      .slice(-bounded)
      .map(record => structuredClone(record));
  }

  async function _prepareCloudCopyOperation(provider, operationId, operation, payload, intent, identity = null) {
    const resolved = identity || await _cloudCopyIdentity(provider, operationId, operation, payload);
    let selected = null;
    await _updateFolderLinksStateForProvider(provider, state => {
      const operations = _normalizeOutlinerOperations(state.outliner_operations);
      const previous = operations.find(row => row.operation_id === operationId) || null;
      _assertCloudCopyRecord(previous, operationId, operation, resolved);
      selected = previous || {
        operation_id: operationId, operation, fingerprint: resolved.fingerprint,
        scope_id: resolved.scope,
        state: intent?.operation_state === 'awaiting_proof' ? 'awaiting_proof' : 'prepared',
        intent: structuredClone(intent),
        saved_at: new Date().toISOString(),
      };
      return { ...state, outliner_operations: previous ? operations
        : _pruneCloudCopyOperations([...operations, selected]) };
    });
    return selected;
  }

  async function _updateCloudCopyIntent(provider, operationId, operation, payload, intent) {
    const identity = await _cloudCopyIdentity(provider, operationId, operation, payload);
    await _updateFolderLinksStateForProvider(provider, state => {
      const operations = _normalizeOutlinerOperations(state.outliner_operations);
      const index = operations.findIndex(row => row.operation_id === operationId);
      const previous = index < 0 ? null : operations[index];
      _assertCloudCopyRecord(previous, operationId, operation, identity);
      if (!previous || (previous.state !== 'prepared' && previous.state !== 'awaiting_proof')) {
        throw new Error('再開可能なCloudファイル操作履歴がありません');
      }
      const nextState = intent?.operation_state === 'proof_ready' ? 'prepared' : previous.state;
      operations[index] = {
        ...previous, state: nextState, intent: structuredClone(intent), saved_at: new Date().toISOString(),
      };
      return { ...state, outliner_operations: operations };
    });
  }

  async function _failCloudCopyOperation(provider, operationId, operation, payload, reason) {
    const identity = await _cloudCopyIdentity(provider, operationId, operation, payload);
    await _updateFolderLinksStateForProvider(provider, state => {
      const operations = _normalizeOutlinerOperations(state.outliner_operations);
      const index = operations.findIndex(row => row.operation_id === operationId);
      const previous = index < 0 ? null : operations[index];
      _assertCloudCopyRecord(previous, operationId, operation, identity);
      if (!previous) throw new Error('再開可能なCloudファイル操作履歴がありません');
      if (previous.state === 'completed') return state;
      operations[index] = {
        ...previous, state: 'failed', failure_reason: String(reason || 'publish-failed'),
        saved_at: new Date().toISOString(),
      };
      return { ...state, outliner_operations: _pruneCloudCopyOperations(operations) };
    });
  }

  async function _rearmCloudCopyOperation(provider, operationId, operation, payload, publisherToken) {
    const identity = await _cloudCopyIdentity(provider, operationId, operation, payload);
    let selected = null;
    await _updateFolderLinksStateForProvider(provider, state => {
      const operations = _normalizeOutlinerOperations(state.outliner_operations);
      const index = operations.findIndex(row => row.operation_id === operationId);
      const previous = index < 0 ? null : operations[index];
      _assertCloudCopyRecord(previous, operationId, operation, identity);
      if (!previous) throw new Error('再開対象のCloudファイル操作履歴がありません');
      if (previous.state !== 'failed') {
        selected = previous;
        return state;
      }
      const intent = { ...previous.intent };
      delete intent.provider_id;
      delete intent.provider_rev;
      delete intent.sha256;
      delete intent.aftercare_in_progress;
      delete intent.aftercare_effects;
      intent.operation_state = 'awaiting_proof';
      intent.publisher_token = String(publisherToken || '');
      intent.claim_boundary = '';
      intent.aftercare_completed = [];
      selected = {
        ...previous, state: 'awaiting_proof', intent,
        failure_reason: '', saved_at: new Date().toISOString(),
      };
      operations[index] = selected;
      return { ...state, outliner_operations: operations };
    });
    return selected;
  }

  async function _completeCloudCopyOperation(provider, operationId, operation, payload, result) {
    const identity = await _cloudCopyIdentity(provider, operationId, operation, payload);
    let selected = result;
    await _updateFolderLinksStateForProvider(provider, state => {
      const operations = _normalizeOutlinerOperations(state.outliner_operations);
      const index = operations.findIndex(row => row.operation_id === operationId);
      const previous = index < 0 ? null : operations[index];
      _assertCloudCopyRecord(previous, operationId, operation, identity);
      if (!previous) throw new Error('prepared Cloudファイル操作履歴がありません');
      if (previous.state === 'completed') selected = previous.result;
      else {
        if (result?.ok !== true || result.operation_id !== operationId) throw new Error('Cloudファイル操作結果が不正です');
        operations[index] = { ...previous, state: 'completed', result: structuredClone(result),
          saved_at: new Date().toISOString() };
      }
      return { ...state, outliner_operations: _pruneCloudCopyOperations(operations) };
    });
    return selected;
  }

  async function _runCloudCopyAftercare(provider, operationId, operation, payload, record, steps, checkpoint = null) {
    let intent = structuredClone(record.intent || {});
    const completed = new Set(Array.isArray(intent.aftercare_completed) ? intent.aftercare_completed : []);
    intent.aftercare_required = steps.map(step => step.name);
    intent.aftercare_completed = [...completed];
    await _updateCloudCopyIntent(provider, operationId, operation, payload, intent);
    for (const step of steps) {
      if (completed.has(step.name)) continue;
      const inProgress = intent.aftercare_in_progress || null;
      if (inProgress && inProgress.name !== step.name) throw new Error('Cloud aftercareの実行中stepが一致しません');
      let current = null;
      if (checkpoint) {
        current = await checkpoint();
        const expected = intent.aftercare_manifest_digest || intent.manifest_digest;
        if (expected && current.manifest_digest !== expected && !inProgress) {
          throw Object.assign(new Error('Cloud folderがaftercare前に変更されています'), { status: 409 });
        }
      }
      const effect = intent.aftercare_effects?.[step.name] || null;
      if (inProgress) {
        const before = String(inProgress.before_manifest_digest || '');
        const currentDigest = String(current?.manifest_digest || '');
        if (effect && currentDigest === String(effect.after_manifest_digest || '')) {
          completed.add(step.name);
          intent.aftercare_completed = [...completed];
          if (checkpoint) intent.aftercare_manifest_digest = currentDigest;
          delete intent.aftercare_in_progress;
          await _updateCloudCopyIntent(provider, operationId, operation, payload, intent);
          continue;
        }
        if (checkpoint && currentDigest !== before) {
          throw Object.assign(new Error('実行中Cloud aftercareの前後manifestを証明できません'), { status: 409 });
        }
      }
      if (!inProgress) {
        intent.aftercare_in_progress = { name: step.name,
          before_manifest_digest: String(current?.manifest_digest || '') };
        await _updateCloudCopyIntent(provider, operationId, operation, payload, intent);
      }
      await step.run();
      const after = checkpoint ? await checkpoint() : null;
      intent.aftercare_effects = { ...(intent.aftercare_effects || {}),
        [step.name]: {
          before_manifest_digest: String(intent.aftercare_in_progress?.before_manifest_digest || ''),
          after_manifest_digest: String(after?.manifest_digest || ''),
        } };
      await _updateCloudCopyIntent(provider, operationId, operation, payload, intent);
      completed.add(step.name);
      intent.aftercare_completed = [...completed];
      if (checkpoint) intent.aftercare_manifest_digest = after.manifest_digest;
      delete intent.aftercare_in_progress;
      await _updateCloudCopyIntent(provider, operationId, operation, payload, intent);
    }
    return { ...record, intent };
  }

  window.MeldexCloudCopyOperationJournal = Object.freeze({
    withFlight: _withCloudCopyFlight,
    load: _loadCloudCopyOperation,
    listPrepared: _listPreparedCloudCopyOperations,
    listCompleted: _listCompletedCloudCopyOperations,
    prepare: _prepareCloudCopyOperation,
    updateIntent: _updateCloudCopyIntent,
    complete: _completeCloudCopyOperation,
    fail: _failCloudCopyOperation,
    rearm: _rearmCloudCopyOperation,
    runAftercare: _runCloudCopyAftercare,
  });
