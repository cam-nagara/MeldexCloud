(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MeldexTopicContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class ContractValidationError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ContractValidationError';
    }
  }

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function object(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ContractValidationError(`${path} must be an object`);
    }
    return value;
  }

  function array(value, path) {
    if (!Array.isArray(value)) throw new ContractValidationError(`${path} must be an array`);
    return value;
  }

  function string(value, path, nonempty) {
    if (typeof value !== 'string' || (nonempty && !value.trim())) {
      throw new ContractValidationError(`${path} must be${nonempty ? ' a non-empty string' : ' a string'}`);
    }
    return value;
  }

  function revision(value, path, allowNull) {
    if (allowNull && value === null) return null;
    if ((Number.isInteger(value) && value >= 0) || (typeof value === 'string' && value.trim())) return value;
    throw new ContractValidationError(`${path} must be a non-negative integer or opaque string`);
  }

  function normalizeTopicRef(value) {
    const source = object(value, 'TopicRef');
    return Object.assign(clone(source), {
      sourceId: string(source.sourceId, 'TopicRef.sourceId', true),
      topicId: string(source.topicId, 'TopicRef.topicId', true),
    });
  }

  function topicRefKey(value) {
    const ref = normalizeTopicRef(value);
    return JSON.stringify([ref.sourceId, ref.topicId]);
  }

  function normalizeTopicRecord(value) {
    const source = object(value, 'TopicRecord');
    const result = clone(source);
    result.topicId = string(source.topicId, 'TopicRecord.topicId', true);
    result.title = string(source.title, 'TopicRecord.title', false);
    result.properties = clone(object(source.properties === undefined ? {} : source.properties, 'TopicRecord.properties'));
    const typed = object(source.propertyValuesByFamilyId === undefined ? {}
      : source.propertyValuesByFamilyId, 'TopicRecord.propertyValuesByFamilyId');
    result.propertyValuesByFamilyId = {};
    Object.keys(typed).forEach((familyId) => {
      result.propertyValuesByFamilyId[familyId] = normalizePropertyValue(typed[familyId], familyId);
    });
    const requestedOrder = array(source.propertyValueOrder === undefined ? [] : source.propertyValueOrder,
      'TopicRecord.propertyValueOrder');
    result.propertyValueOrder = [...new Set(requestedOrder.map((item) => string(item,
      'TopicRecord.propertyValueOrder[]', true)).filter((item) => item in result.propertyValuesByFamilyId))];
    Object.keys(result.propertyValuesByFamilyId).forEach((familyId) => {
      if (!result.propertyValueOrder.includes(familyId)) result.propertyValueOrder.push(familyId);
    });
    result.note = clone(source.note);
    result.resources = clone(array(source.resources === undefined ? [] : source.resources, 'TopicRecord.resources'));
    result.revision = revision(source.revision === undefined ? 0 : source.revision, 'TopicRecord.revision', false);
    result.schemaVersion = revision(source.schemaVersion === undefined ? 1 : source.schemaVersion, 'TopicRecord.schemaVersion', false);
    for (const field of ['createdAt', 'updatedAt', 'updatedBy']) result[field] = clone(source[field]);
    return result;
  }

  function normalizeTopicPlacement(value) {
    const source = object(value, 'TopicPlacement');
    const result = clone(source);
    result.placementId = string(source.placementId, 'TopicPlacement.placementId', true);
    result.topicRef = normalizeTopicRef(source.topicRef);
    result.documentId = string(source.documentId, 'TopicPlacement.documentId', true);
    result.viewId = string(source.viewId, 'TopicPlacement.viewId', true);
    if (!['sheet', 'board'].includes(source.surface)) {
      throw new ContractValidationError('TopicPlacement.surface must be sheet or board');
    }
    result.surface = source.surface;
    result.order = clone(source.order);
    result.position = clone(source.position);
    result.revision = revision(source.revision === undefined ? 0 : source.revision,
      'TopicPlacement.revision', false);
    return result;
  }

  function normalizeTopicUsage(value) {
    const source = object(value, 'TopicUsage');
    const result = clone(source);
    result.usageId = string(source.usageId, 'TopicUsage.usageId', true);
    result.topicRef = normalizeTopicRef(source.topicRef);
    if (!['placement', 'note-link', 'chat-link'].includes(source.kind)) {
      throw new ContractValidationError('TopicUsage.kind is invalid');
    }
    result.kind = source.kind;
    result.targetId = string(source.targetId, 'TopicUsage.targetId', true);
    result.label = string(source.label === undefined ? '' : source.label, 'TopicUsage.label', false);
    result.location = clone(source.location);
    return result;
  }

  function normalizePropertyValue(value, familyId) {
    const source = object(value, 'TopicPropertyValue');
    const result = clone(source);
    result.propertyFamilyId = string(familyId || source.propertyFamilyId,
      'TopicPropertyValue.propertyFamilyId', true);
    result.displayName = typeof source.displayName === 'string' ? source.displayName : '';
    result.columnType = canonicalColumnType(source.columnType || source.type || 'unknown');
    result.typeConfig = clone(object(source.typeConfig === undefined ? {} : source.typeConfig,
      'TopicPropertyValue.typeConfig'));
    result.value = clone(source.value);
    result.origins = clone(array(source.origins === undefined ? [] : source.origins,
      'TopicPropertyValue.origins'));
    return result;
  }

  function canonicalColumnType(value) {
    const normalized = string(value, 'TopicPropertyValue.columnType', true)
      .trim().toLowerCase().replaceAll('_', '-');
    const aliases = {
      string: 'text', 'long-text': 'text', textarea: 'text', integer: 'number',
      float: 'number', decimal: 'number', url: 'multi-link', link: 'multi-link',
      links: 'multi-link', formula: 'calculation', computed: 'calculation',
    };
    return aliases[normalized] || normalized;
  }

  function normalizeRelationSet(value) {
    const source = object(value, 'RelationSet');
    const result = clone(source);
    result.relationSetId = string(source.relationSetId, 'RelationSet.relationSetId', true);
    result.name = string(source.name, 'RelationSet.name', false);
    result.constraint = source.constraint === undefined ? 'single-parent' : source.constraint;
    if (result.constraint !== 'single-parent') {
      throw new ContractValidationError('RelationSet.constraint must be single-parent');
    }
    result.edges = array(source.edges === undefined ? [] : source.edges, 'RelationSet.edges').map((edge, index) => {
      const item = object(edge, `RelationSet.edges[${index}]`);
      return Object.assign(clone(item), {
        parentTopicRef: normalizeTopicRef(item.parentTopicRef),
        childTopicRef: normalizeTopicRef(item.childTopicRef),
      });
    });
    result.revision = revision(source.revision === undefined ? 0 : source.revision, 'RelationSet.revision', false);
    result.schemaVersion = revision(source.schemaVersion === undefined ? 1 : source.schemaVersion, 'RelationSet.schemaVersion', false);
    validateRelationGraph(result.edges);
    return result;
  }

  function validateRelationGraph(edges) {
    const parents = new Map();
    for (const edge of edges) {
      const parent = topicRefKey(edge.parentTopicRef);
      const child = topicRefKey(edge.childTopicRef);
      if (parent === child) throw new ContractValidationError('RelationSet cannot contain a self-reference');
      if (parents.has(child) && parents.get(child) !== parent) {
        throw new ContractValidationError('RelationSet single-parent constraint was violated');
      }
      parents.set(child, parent);
    }
    const resolved = new Set();
    for (const start of parents.keys()) {
      const path = new Set();
      let node = start;
      while (parents.has(node) && !resolved.has(node)) {
        if (path.has(node)) throw new ContractValidationError('RelationSet cannot contain a cycle');
        path.add(node);
        node = parents.get(node);
      }
      for (const item of path) resolved.add(item);
    }
  }

  function normalizeMembership(value) {
    const source = object(value, 'TopicViewDocument.membership');
    const result = clone(source);
    if (source.mode !== 'manual') {
      throw new ContractValidationError('TopicViewDocument.membership.mode is invalid');
    }
    result.mode = source.mode;
    result.manualTopicRefs = array(source.manualTopicRefs === undefined ? [] : source.manualTopicRefs,
      'TopicViewDocument.membership.manualTopicRefs').map(normalizeTopicRef);
    delete result.queryDefinition;
    return result;
  }

  function normalizeSystemProvider(value) {
    const source = object(value, 'TopicViewDocument.systemProvider');
    const result = clone(source);
    result.providerId = string(source.providerId, 'systemProvider.providerId', true);
    result.scopeId = string(source.scopeId, 'systemProvider.scopeId', true);
    const capabilities = array(source.capabilities === undefined ? ['read-only'] : source.capabilities,
      'systemProvider.capabilities');
    if (capabilities.length !== 1 || capabilities[0] !== 'read-only') {
      throw new ContractValidationError('systemProvider capabilities must be read-only');
    }
    result.capabilities = ['read-only'];
    return result;
  }

  function normalizeTopicViewDocument(value) {
    const source = object(value, 'TopicViewDocument');
    const result = clone(source);
    result.documentId = string(source.documentId, 'TopicViewDocument.documentId', true);
    result.schemaVersion = revision(source.schemaVersion === undefined ? 1 : source.schemaVersion,
      'TopicViewDocument.schemaVersion', false);
    if (!['sheet', 'board'].includes(source.defaultSurface)) {
      throw new ContractValidationError('TopicViewDocument.defaultSurface must be sheet or board');
    }
    result.defaultSurface = source.defaultSurface;
    result.membership = normalizeMembership(source.membership || { mode: 'manual', manualTopicRefs: [] });
    result.systemProvider = source.systemProvider == null ? null : normalizeSystemProvider(source.systemProvider);
    if (result.systemProvider && result.membership.manualTopicRefs.length) {
      throw new ContractValidationError('system topic views use their provider, not membership');
    }
    for (const field of ['sheetViews', 'boardViews', 'topicLayouts']) {
      result[field] = clone(array(source[field] === undefined ? [] : source[field], `TopicViewDocument.${field}`));
    }
    result.relationSets = array(source.relationSets === undefined ? [] : source.relationSets,
      'TopicViewDocument.relationSets').map(normalizeRelationSet);
    result.lastCompleteSnapshot = clone(source.lastCompleteSnapshot);
    return result;
  }

  function normalizeMutation(value) {
    const source = object(value, 'mutation');
    if (!Object.prototype.hasOwnProperty.call(source, 'baseRevision')) {
      throw new ContractValidationError('mutation.baseRevision is required');
    }
    const result = clone(source);
    result.mutationId = string(source.mutationId, 'mutation.mutationId', true);
    result.baseRevision = revision(source.baseRevision, 'mutation.baseRevision', true);
    result.changes = clone(object(source.changes, 'mutation.changes'));
    if (source.topicRef !== undefined) result.topicRef = normalizeTopicRef(source.topicRef);
    return result;
  }

  function sourceRecordPath(topicId) {
    string(topicId, 'topicId', true);
    return `_meldex/topics/v1/records/${encodeURIComponent(topicId)}.json`;
  }

  return Object.freeze({
    ContractValidationError,
    clone,
    normalizeMutation,
    normalizeRelationSet,
    normalizePropertyValue,
    normalizeTopicRecord,
    normalizeTopicPlacement,
    normalizeTopicRef,
    normalizeTopicUsage,
    normalizeTopicViewDocument,
    normalizeSystemProvider,
    sourceRecordPath,
    topicRefKey,
    validateMutation: normalizeMutation,
    validateRelationSet: normalizeRelationSet,
    validateTopicRecord: normalizeTopicRecord,
    validateTopicPlacement: normalizeTopicPlacement,
    validateTopicRef: normalizeTopicRef,
    validateTopicUsage: normalizeTopicUsage,
    validateTopicViewDocument: normalizeTopicViewDocument,
  });
});
