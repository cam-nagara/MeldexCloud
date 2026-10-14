(function (root, factory) {
  'use strict';
  const api = factory(root?.MeldexTopicContract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MeldexTopicPlacement = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Contract) {
  'use strict';

  const OPERATIONS = new Set(['move', 'link-duplicate', 'duplicate', 'detach']);
  const SURFACES = new Set(['sheet', 'board']);
  const FAILURE_CODES = new Set([
    'conflict', 'forbidden', 'locked', 'offline', 'capacity', 'missing',
    'placement-recovery-required', 'result-unknown',
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object`);
    }
    return value;
  }

  function requiredString(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
    return value.trim();
  }

  function normalizeTopicRef(value) {
    if (Contract?.normalizeTopicRef) return Contract.normalizeTopicRef(value);
    const source = object(value, 'TopicRef');
    return { ...clone(source), sourceId: requiredString(source.sourceId, 'sourceId'),
      topicId: requiredString(source.topicId, 'topicId') };
  }

  function normalizePlacement(value) {
    if (Contract?.normalizeTopicPlacement) return Contract.normalizeTopicPlacement(value);
    const source = object(value, 'TopicPlacement');
    const result = clone(source);
    result.placementId = requiredString(source.placementId, 'placementId');
    result.topicRef = normalizeTopicRef(source.topicRef);
    result.documentId = requiredString(source.documentId, 'documentId');
    if (!SURFACES.has(source.surface)) throw new TypeError('surface must be sheet or board');
    result.surface = source.surface;
    result.viewId = requiredString(source.viewId, 'viewId');
    result.revision = source.revision ?? 0;
    result.order = source.order ?? null;
    result.position = clone(source.position ?? null);
    return result;
  }

  function normalizeUsage(value) {
    if (Contract?.normalizeTopicUsage) {
      const source = object(value, 'TopicUsage');
      const normalizedInput = { ...clone(source),
        targetId: source.targetId || source.target?.targetId || source.target?.documentId,
        location: source.location ?? source.target ?? null };
      const result = Contract.normalizeTopicUsage(normalizedInput);
      result.available = value.available !== false;
      result.partial = value.partial === true;
      return result;
    }
    const source = object(value, 'TopicUsage');
    const kind = requiredString(source.kind, 'usage.kind');
    if (!['placement', 'note-link', 'chat-link'].includes(kind)) throw new TypeError('usage.kind is invalid');
    const result = clone(source);
    result.usageId = requiredString(source.usageId, 'usageId');
    result.kind = kind;
    result.topicRef = normalizeTopicRef(source.topicRef);
    result.label = typeof source.label === 'string' ? source.label : '';
    result.targetId = requiredString(source.targetId || source.target?.targetId
      || source.target?.documentId, 'usage.targetId');
    result.location = clone(source.location ?? source.target ?? null);
    result.available = source.available !== false;
    result.partial = source.partial === true;
    return result;
  }

  function normalizeUsageIndex(value) {
    const source = object(value, 'TopicUsageIndex');
    return {
      ...clone(source),
      topicRef: normalizeTopicRef(source.topicRef),
      revision: source.revision ?? 0,
      partial: source.partial === true,
      usages: (Array.isArray(source.usages) ? source.usages : []).map(normalizeUsage),
    };
  }

  function normalizeRequest(value) {
    const source = object(value, 'placement operation');
    const operation = requiredString(source.operation, 'operation');
    if (!OPERATIONS.has(operation)) throw new TypeError('operation is invalid');
    const result = clone(source);
    result.operationId = requiredString(source.operationId, 'operationId');
    result.operation = operation;
    result.topicRef = normalizeTopicRef(source.topicRef);
    result.sourcePlacement = source.sourcePlacement ? normalizePlacement(source.sourcePlacement) : null;
    result.target = source.target ? clone(object(source.target, 'target')) : null;
    result.expectedRevision = source.expectedRevision ?? null;
    result.allowOrphan = source.allowOrphan === true;
    result.currentPlacementCount = source.currentPlacementCount ?? null;
    if (operation !== 'detach' && !result.target) throw new TypeError('target is required');
    if (operation !== 'detach') {
      result.target.documentId = requiredString(result.target.documentId, 'target.documentId');
      result.target.viewId = requiredString(result.target.viewId, 'target.viewId');
      if (!SURFACES.has(result.target.surface)) throw new TypeError('target.surface is invalid');
    }
    if ((operation === 'move' || operation === 'detach') && !result.sourcePlacement) {
      throw new TypeError('sourcePlacement is required');
    }
    if (operation === 'detach' && result.currentPlacementCount === 1 && !result.allowOrphan) {
      throw new TypeError('最後の登録先から外すには明示的な確認が必要です');
    }
    result.action = operation;
    result.mutationId = result.operationId;
    result.topicRefs = [clone(result.topicRef)];
    result.sourcePlacements = result.sourcePlacement ? [clone(result.sourcePlacement)] : [];
    result.targetDocumentId = result.target?.documentId || null;
    result.targetViewId = result.target?.viewId || null;
    result.targetSurface = result.target?.surface || null;
    result.targetPosition = clone(result.target?.position ?? null);
    result.columnBindings = normalizeBindings(source.columnBindings || []);
    result.baseRevisions = clone(object(source.baseRevisions, 'baseRevisions'));
    const revisionDocuments = new Set();
    if (result.targetDocumentId) revisionDocuments.add(result.targetDocumentId);
    if (['move', 'detach'].includes(operation)) revisionDocuments.add(result.sourcePlacement.documentId);
    revisionDocuments.forEach((documentId) => {
      if (!Object.prototype.hasOwnProperty.call(result.baseRevisions, documentId)) {
        throw new TypeError(`baseRevisions.${documentId} is required`);
      }
    });
    return result;
  }

  function normalizeBindings(value) {
    if (!Array.isArray(value)) throw new TypeError('columnBindings must be an array');
    const bySource = new Map();
    const byTarget = new Map();
    return value.map((binding) => {
      const source = object(binding, 'column binding');
      if (source.confirmed !== true) throw new TypeError('column bindings require explicit confirmation');
      const sourceId = requiredString(source.sourcePropertyFamilyId, 'sourcePropertyFamilyId');
      const targetId = requiredString(source.targetPropertyFamilyId, 'targetPropertyFamilyId');
      if (bySource.has(sourceId) && bySource.get(sourceId) !== targetId) {
        throw new TypeError('one source property cannot bind to multiple target properties');
      }
      if (byTarget.has(targetId) && byTarget.get(targetId) !== sourceId) {
        throw new TypeError('one target property cannot bind to multiple source properties');
      }
      bySource.set(sourceId, targetId);
      byTarget.set(targetId, sourceId);
      return { ...clone(source), sourcePropertyFamilyId: sourceId,
        targetPropertyFamilyId: targetId, confirmed: true };
    });
  }

  function failureState(error) {
    const detail = error?.detail && typeof error.detail === 'object' ? error.detail
      : error?.data?.detail && typeof error.data.detail === 'object' ? error.data.detail
        : error?.response?.detail && typeof error.response.detail === 'object'
          ? error.response.detail : null;
    const statusCode = Number(error?.status);
    const mapped = ({ 403: 'forbidden', 404: 'missing', 409: 'conflict', 423: 'locked',
      507: 'capacity' })[statusCode];
    const offline = error?.name === 'NetworkError' || error?.offline === true;
    const candidate = detail?.code || mapped || (offline ? 'offline' : error?.code);
    const code = FAILURE_CODES.has(candidate) ? candidate : 'failed';
    const recoveryRequired = code === 'placement-recovery-required'
      || detail?.recoveryRequired === true;
    const resultUnknown = code === 'result-unknown' || detail?.resultUnknown === true;
    return { ok: false, state: code,
      retryable: !recoveryRequired && !resultUnknown && ['offline', 'conflict', 'locked'].includes(code),
      sourcePreserved: resultUnknown ? null : (recoveryRequired ? false : detail?.sourcePreserved !== false),
      recoveryRequired, resultUnknown,
      affectedDocuments: clone(detail?.affectedDocuments || []),
      message: detail?.message || error?.message || String(error) };
  }

  function createClient(transport) {
    object(transport, 'placement transport');
    if (typeof transport.prepare !== 'function' || typeof transport.commit !== 'function') {
      throw new TypeError('placement transport requires prepare and commit');
    }
    const completed = new Map();
    const pending = new Map();

    async function execute(value) {
      const request = normalizeRequest(value);
      if (completed.has(request.operationId)) return clone(completed.get(request.operationId));
      if (pending.has(request.operationId)) return pending.get(request.operationId);
      if (typeof transport.isOnline === 'function' && !transport.isOnline()) {
        return failureState({ code: 'offline', message: '現在はオフラインです。再接続後に再試行してください。' });
      }
      const promise = run(request).finally(() => pending.delete(request.operationId));
      pending.set(request.operationId, promise);
      return promise;
    }

    async function run(request) {
      try {
        const prepared = object(await transport.prepare(clone(request)), 'prepare response');
        if (prepared.ok === false) return failureState(prepared.error || prepared);
        const token = requiredString(prepared.preparedToken || prepared.prepareToken, 'preparedToken');
        const commitRequest = {
          operationId: request.operationId, preparedToken: token,
          expectedRevision: prepared.expectedRevision ?? request.expectedRevision,
          sourcePreservationRequired: request.operation === 'move',
        };
        let committedValue;
        try {
          committedValue = await transport.commit(clone(commitRequest));
        } catch (firstError) {
          const uncertain = firstError?.name === 'NetworkError' || firstError?.offline === true
            || Number(firstError?.status) === 503;
          if (!uncertain) throw firstError;
          try {
            committedValue = await transport.commit(clone(commitRequest));
          } catch (secondError) {
            const stillUncertain = secondError?.name === 'NetworkError'
              || secondError?.offline === true || Number(secondError?.status) === 503;
            if (!stillUncertain) throw secondError;
            throw Object.assign(new Error(
              '保存結果を確認できません。再操作せず、オンライン復帰後にシートまたはボードを再読込してください。',
            ), { code: 'result-unknown', detail: { code: 'result-unknown',
              resultUnknown: true, sourcePreserved: null } });
          }
        }
        const committed = object(committedValue, 'commit response');
        if (committed.ok === false) return failureState(committed.error || committed);
        const committedRef = committed.topicRef || committed.placement?.topicRef
          || committed.topicRefs?.[0] || null;
        const result = { ...clone(committed), ok: true, state: 'committed',
          sourcePreserved: ['link-duplicate', 'duplicate'].includes(request.operation) };
        if (request.operation === 'link-duplicate' && (!committedRef
            || JSON.stringify(normalizeTopicRef(committedRef)) !== JSON.stringify(request.topicRef))) {
          throw Object.assign(new Error('リンク複製でトピックIDが変更されました'), { code: 'conflict' });
        }
        if (request.operation === 'duplicate' && (!committedRef
            || normalizeTopicRef(committedRef).topicId === request.topicRef.topicId)) {
          throw Object.assign(new Error('複製で新しいトピックIDが作成されませんでした'), { code: 'conflict' });
        }
        completed.set(request.operationId, result);
        return clone(result);
      } catch (error) {
        return failureState(error);
      }
    }

    function operation(name, value) {
      return execute({ ...clone(value), operation: name });
    }

    return Object.freeze({
      execute,
      move: (value) => operation('move', value),
      linkDuplicate: (value) => operation('link-duplicate', value),
      duplicate: (value) => operation('duplicate', value),
      detach: (value) => operation('detach', value),
      normalizeRequest,
    });
  }

  return Object.freeze({
    normalizePlacement,
    normalizeUsage,
    normalizeUsageIndex,
    normalizeRequest,
    createClient,
  });
}));
