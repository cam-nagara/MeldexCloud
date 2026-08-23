/* Unified TopicViewDocument contract and relation visibility helpers. */
(function initMeldexTopicViewDocument(global) {
  'use strict';

  const MEMBERSHIP_MODES = new Set(['manual', 'query', 'hybrid']);
  const SURFACES = new Set(['sheet', 'board']);

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    Object.keys(value).forEach((key) => {
      Object.defineProperty(output, key, {
        value: clone(value[key]), enumerable: true, writable: true, configurable: true,
      });
    });
    return output;
  }

  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${label} must be an object`);
    }
    return value;
  }

  function requiredString(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`${label} must be a non-empty string`);
    }
    return value;
  }

  function normalizeTopicRef(value) {
    const source = object(value?.topicRef || value, 'TopicRef');
    const result = clone(source);
    result.sourceId = requiredString(source.sourceId, 'TopicRef.sourceId');
    result.topicId = requiredString(source.topicId, 'TopicRef.topicId');
    return result;
  }

  function topicRefKey(value) {
    const ref = normalizeTopicRef(value);
    return JSON.stringify([ref.sourceId, ref.topicId]);
  }

  function uniqueTopicRefs(values) {
    const byKey = new Map();
    (Array.isArray(values) ? values : []).forEach((value) => {
      const ref = normalizeTopicRef(value);
      const key = topicRefKey(ref);
      if (!byKey.has(key)) byKey.set(key, ref);
    });
    return [...byKey.values()];
  }

  function normalizeMembership(value) {
    const source = object(value, 'TopicViewDocument.membership');
    if (!MEMBERSHIP_MODES.has(source.mode)) throw new TypeError('membership.mode is invalid');
    const result = clone(source);
    result.mode = source.mode;
    result.manualTopicRefs = uniqueTopicRefs(source.manualTopicRefs);
    if (source.mode !== 'manual') {
      result.queryDefinition = clone(object(source.queryDefinition, 'membership.queryDefinition'));
    } else if (!Object.prototype.hasOwnProperty.call(result, 'queryDefinition')) {
      result.queryDefinition = null;
    }
    return result;
  }

  function normalizeEdge(value, index) {
    const source = object(value, `RelationSet.edges[${index}]`);
    const result = clone(source);
    result.parentTopicRef = normalizeTopicRef(source.parentTopicRef);
    result.childTopicRef = normalizeTopicRef(source.childTopicRef);
    if (topicRefKey(result.parentTopicRef) === topicRefKey(result.childTopicRef)) {
      throw new TypeError('RelationSet cannot contain a self-reference');
    }
    return result;
  }

  function validateRelationGraph(edges) {
    const parents = new Map();
    edges.forEach((edge) => {
      const child = topicRefKey(edge.childTopicRef);
      const parent = topicRefKey(edge.parentTopicRef);
      if (parents.has(child) && parents.get(child) !== parent) {
        throw new TypeError('RelationSet single-parent constraint was violated');
      }
      parents.set(child, parent);
    });
    const resolved = new Set();
    for (const start of parents.keys()) {
      const path = new Set();
      let current = start;
      while (parents.has(current) && !resolved.has(current)) {
        if (path.has(current)) throw new TypeError('RelationSet cannot contain a cycle');
        path.add(current);
        current = parents.get(current);
      }
      path.forEach((key) => resolved.add(key));
    }
  }

  function normalizeRelationSet(value) {
    const source = object(value, 'RelationSet');
    const result = clone(source);
    result.relationSetId = requiredString(source.relationSetId, 'RelationSet.relationSetId');
    result.name = typeof source.name === 'string' ? source.name : '';
    result.constraint = source.constraint || 'single-parent';
    if (result.constraint !== 'single-parent') throw new TypeError('unsupported relation constraint');
    result.edges = (Array.isArray(source.edges) ? source.edges : []).map(normalizeEdge);
    result.revision = source.revision ?? 0;
    validateRelationGraph(result.edges);
    return result;
  }

  function normalizeDocument(value) {
    const source = object(value, 'TopicViewDocument');
    const result = clone(source);
    result.documentId = requiredString(source.documentId, 'TopicViewDocument.documentId');
    if (!SURFACES.has(source.defaultSurface)) throw new TypeError('defaultSurface is invalid');
    result.schemaVersion = source.schemaVersion ?? 1;
    result.defaultSurface = source.defaultSurface;
    result.membership = normalizeMembership(source.membership);
    result.sheetViews = clone(Array.isArray(source.sheetViews) ? source.sheetViews : []);
    result.boardViews = clone(Array.isArray(source.boardViews) ? source.boardViews : []);
    result.relationSets = (Array.isArray(source.relationSets) ? source.relationSets : [])
      .map(normalizeRelationSet);
    result.topicLayouts = clone(Array.isArray(source.topicLayouts) ? source.topicLayouts : []);
    if (!Object.prototype.hasOwnProperty.call(result, 'lastCompleteSnapshot')) {
      result.lastCompleteSnapshot = null;
    }
    return result;
  }

  function resolveMembership(document, queryTopicRefs) {
    const membership = normalizeDocument(document).membership;
    const manual = membership.manualTopicRefs;
    const queried = uniqueTopicRefs(queryTopicRefs);
    if (membership.mode === 'manual') return manual;
    if (membership.mode === 'query') return queried;
    return uniqueTopicRefs([...manual, ...queried]);
  }

  function relationSetById(document, relationSetId) {
    const normalized = normalizeDocument(document);
    const match = normalized.relationSets.find((item) => item.relationSetId === relationSetId);
    return match ? clone(match) : null;
  }

  function boardRelationSet(document, boardViewId) {
    const normalized = normalizeDocument(document);
    const view = normalized.boardViews.find((candidate) => (
      candidate?.boardViewId === boardViewId || candidate?.viewId === boardViewId
    ));
    if (!view?.relationSetId) return null;
    return relationSetById(normalized, view.relationSetId);
  }

  function relationVisibility(relationSet, membershipTopicRefs, visibleTopicRefs) {
    const normalized = normalizeRelationSet(relationSet);
    const members = uniqueTopicRefs(membershipTopicRefs);
    const visible = new Set(uniqueTopicRefs(visibleTopicRefs ?? members).map(topicRefKey));
    const parents = new Map();
    normalized.edges.forEach((edge) => {
      parents.set(topicRefKey(edge.childTopicRef), clone(edge.parentTopicRef));
    });
    const items = members.filter((ref) => visible.has(topicRefKey(ref))).map((ref) => {
      const parentTopicRef = parents.get(topicRefKey(ref)) || null;
      return {
        topicRef: ref,
        isMainTopic: !parentTopicRef,
        hasHiddenParent: !!parentTopicRef && !visible.has(topicRefKey(parentTopicRef)),
        parentTopicRef,
      };
    });
    return {
      relationSetId: normalized.relationSetId,
      items,
      mainTopicRefs: members.filter((ref) => !parents.has(topicRefKey(ref))),
      visibleMainTopicRefs: items.filter((item) => item.isMainTopic).map((item) => item.topicRef),
      hiddenParentItems: items.filter((item) => item.hasHiddenParent),
    };
  }

  global.MeldexTopicViewDocument = Object.freeze({
    normalizeTopicRef,
    topicRefKey,
    uniqueTopicRefs,
    normalizeMembership,
    normalizeRelationSet,
    normalizeDocument,
    resolveMembership,
    relationSetById,
    boardRelationSet,
    relationVisibility,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
