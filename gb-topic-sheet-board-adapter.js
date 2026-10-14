/* Pure legacy Sheet/Board adapters for the unified topic data layer. */
(function initMeldexTopicSheetBoardAdapter(global) {
  'use strict';

  const ViewContract = global.MeldexTopicViewDocument;
  const PropertyFamily = global.MeldexTopicPropertyFamily;
  if (!ViewContract) throw new Error('MeldexTopicViewDocument must be loaded first');
  if (!PropertyFamily) throw new Error('MeldexTopicPropertyFamily must be loaded first');

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

  function stableTopicId(value, label) {
    const source = object(value, label);
    const candidate = source.topicRef?.topicId ?? source.topicId ?? source.id
      ?? source.uid ?? source.file_id;
    if (typeof candidate !== 'string' || !candidate.trim()) {
      throw new TypeError(`${label} needs an existing stable topic ID`);
    }
    return candidate;
  }

  function sourceIdFor(value, fallback) {
    const sourceId = value?.topicRef?.sourceId || value?.sourceId || fallback;
    if (typeof sourceId !== 'string' || !sourceId.trim()) {
      throw new TypeError('sourceId is required');
    }
    return sourceId;
  }

  function topicRefFromLegacySheetRow(row, sourceId) {
    const source = object(row, 'legacy Sheet row');
    if (source.topicRef) return ViewContract.normalizeTopicRef(source.topicRef);
    return ViewContract.normalizeTopicRef({
      sourceId: sourceIdFor(source, sourceId),
      topicId: stableTopicId(source, 'legacy Sheet row'),
    });
  }

  function familyIdFor(documentId, columnId) {
    return PropertyFamily.legacyPropertyFamilyId(documentId, columnId);
  }

  function legacyPropertyValues(properties, sourceId, columns, documentId) {
    const definitions = Array.isArray(columns) ? columns : [];
    const values = {};
    const order = [];
    Object.keys(properties).forEach((name) => {
      const column = definitions.find((item) => (item.id || item.columnId || item.name) === name) || {};
      const columnId = String(column.id || column.columnId || name);
      const propertyFamilyId = column.propertyFamilyId || familyIdFor(documentId || sourceId, columnId);
      values[propertyFamilyId] = {
        propertyFamilyId,
        displayName: column.name || name,
        columnType: String(column.columnType || column.type || 'unknown'),
        typeConfig: clone(column.typeConfig || column.config || {}),
        value: clone(properties[name]),
        origins: [{ sourceId, columnId, columnName: column.name || name }],
        revision: 0,
      };
      order.push(propertyFamilyId);
    });
    return { values, order };
  }

  function legacySheetTopicRecord(row, topicRef, columns, documentId) {
    const frontmatter = row.frontmatter && typeof row.frontmatter === 'object' ? row.frontmatter : {};
    const properties = row.properties ?? row.values ?? frontmatter.properties ?? {};
    const migrated = legacyPropertyValues(properties, topicRef.sourceId, columns, documentId);
    return {
      topicId: topicRef.topicId,
      title: String(row.title ?? row.name ?? frontmatter.title ?? frontmatter.name ?? ''),
      properties: clone(properties && typeof properties === 'object' ? properties : {}),
      propertyValuesByFamilyId: clone(row.propertyValuesByFamilyId || migrated.values),
      propertyValueOrder: clone(row.propertyValueOrder || migrated.order),
      note: clone(row.note ?? row.body ?? null),
      resources: clone(Array.isArray(row.resources) ? row.resources
        : (frontmatter.resources || frontmatter.entry_attachments || [])),
      revision: row.revision ?? 0,
      createdAt: row.createdAt ?? row.created ?? null,
      updatedAt: row.updatedAt ?? row.updated ?? null,
      updatedBy: row.updatedBy ?? null,
    };
  }

  function legacySheetViewState(row) {
    const state = {};
    ['topicLayout', 'layout', 'order', 'selected', 'hidden', 'collapsed'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(row, key)) state[key] = clone(row[key]);
    });
    return state;
  }

  function adaptLegacySheetRowToTopic(row, sourceId, options) {
    const source = object(row, 'legacy Sheet row');
    const topicRef = topicRefFromLegacySheetRow(source, sourceId);
    return {
      topicRef,
      topicRecord: legacySheetTopicRecord(source, topicRef, options?.columns, options?.documentId),
      sheetRowState: legacySheetViewState(source),
      legacySheetRow: clone(source),
    };
  }

  function sheetRowForTopic(topicRef, topicRecord, sheetRowState, legacySheetRow) {
    const ref = ViewContract.normalizeTopicRef(topicRef);
    const topic = object(topicRecord, 'TopicRecord');
    if (String(topic.topicId) !== ref.topicId) throw new TypeError('TopicRecord topicId mismatch');
    const output = clone(legacySheetRow || {});
    Object.assign(output, clone(sheetRowState || {}), {
      topicRef: ref,
      topicId: ref.topicId,
      title: topic.title,
      properties: clone(topic.properties || {}),
      propertyValuesByFamilyId: clone(topic.propertyValuesByFamilyId || {}),
      propertyValueOrder: clone(topic.propertyValueOrder || []),
      note: clone(topic.note ?? null),
      resources: clone(topic.resources || []),
      revision: topic.revision ?? 0,
    });
    return output;
  }

  function topicRefFromLegacyBoardNode(node, sourceId, topicIdByLegacyNodeId) {
    const source = object(node, 'legacy Board node');
    if (source.topicRef) return ViewContract.normalizeTopicRef(source.topicRef);
    const mapped = topicIdByLegacyNodeId?.[source.id];
    const topicId = mapped || source.topicId || source.uid || source.file_id;
    if (typeof topicId !== 'string' || !topicId.trim()) {
      throw new TypeError('legacy Board node needs a migrated stable topic ID mapping');
    }
    return ViewContract.normalizeTopicRef({
      sourceId: sourceIdFor(source, sourceId),
      topicId,
    });
  }

  function legacyBoardResources(node) {
    const resources = clone(Array.isArray(node.resources) ? node.resources : []);
    if (node.link && !resources.some((item) => item?.href === node.link)) {
      resources.push({
        resourceId: `legacy-${String(node.id || 'topic')}-link`,
        resourceType: 'link', href: node.link, linkType: node.linkType || '',
        columnType: 'link', legacySingle: true,
      });
    }
    if (node.img && !resources.some((item) => item?.href === node.img || item?.value === node.img)) {
      resources.push({
        resourceId: `legacy-${String(node.id || 'topic')}-image`,
        resourceType: 'image', href: node.img, legacySingle: true,
      });
    }
    return resources;
  }

  function legacyBoardTopicRecord(node, topicRef, columns, documentId) {
    const text = String(node.text || '');
    const separator = text.indexOf('\n');
    const properties = clone(node.properties || {});
    if (Object.prototype.hasOwnProperty.call(node, 'status') && !('status' in properties)) {
      properties.status = clone(node.status);
    }
    const migrated = legacyPropertyValues(properties, topicRef.sourceId, columns, documentId);
    return {
      topicId: topicRef.topicId,
      title: String(node.title ?? (separator < 0 ? text : text.slice(0, separator))),
      properties,
      propertyValuesByFamilyId: clone(node.propertyValuesByFamilyId || migrated.values),
      propertyValueOrder: clone(node.propertyValueOrder || migrated.order),
      note: clone(node.note ?? (separator < 0 ? '' : text.slice(separator + 1))),
      resources: legacyBoardResources(node),
      revision: node.revision ?? 0,
      createdAt: node.createdAt ?? null,
      updatedAt: node.updatedAt ?? null,
      updatedBy: node.updatedBy ?? null,
    };
  }

  function legacyBoardViewState(node) {
    const state = clone(node);
    ['topicRef', 'topicId', 'title', 'text', 'properties', 'propertyValuesByFamilyId',
      'propertyValueOrder', 'status', 'note', 'resources', 'revision',
      'createdAt', 'updatedAt', 'updatedBy', 'parent', 'link', 'linkType', 'img']
      .forEach((key) => { delete state[key]; });
    state.legacyNodeId = String(node.id);
    return state;
  }

  function adaptLegacyBoardNodeToTopic(node, sourceId, topicIdByLegacyNodeId, options) {
    const source = object(node, 'legacy Board node');
    const topicRef = topicRefFromLegacyBoardNode(source, sourceId, topicIdByLegacyNodeId);
    return {
      topicRef,
      topicRecord: legacyBoardTopicRecord(source, topicRef, options?.columns, options?.documentId),
      boardNodeState: legacyBoardViewState(source),
      parentLegacyNodeId: source.parent ? String(source.parent) : null,
      legacyBoardNode: clone(source),
    };
  }

  function boardNodeForTopic(topicRef, boardNodeState, legacyBoardNode) {
    const ref = ViewContract.normalizeTopicRef(topicRef);
    const state = clone(boardNodeState || {});
    const output = { ...state, topicRef: ref, topicId: ref.topicId };
    output.id = state.legacyNodeId || legacyBoardNode?.id || ref.topicId;
    delete output.legacyNodeId;
    return output;
  }

  function normalizeLinkReference(value) {
    if (typeof value === 'string') return { href: value };
    return clone(object(value, 'link reference'));
  }

  function linkReferences(column) {
    if (column == null || column === '') return [];
    if (typeof column === 'string') return [normalizeLinkReference(column)];
    if (Array.isArray(column)) return column.map(normalizeLinkReference);
    const source = object(column, 'link resource column');
    if (source.type === 'multi-link' || Array.isArray(source.links)) {
      return (source.links || []).map(normalizeLinkReference);
    }
    const single = source.value ?? source.link ?? source.href ?? source.url ?? source.path;
    return single == null || single === '' ? [] : [normalizeLinkReference(single)];
  }

  function linkIdentity(value) {
    const ref = normalizeLinkReference(value);
    return String(ref.resourceId ?? ref.id ?? ref.href ?? ref.url ?? ref.path ?? JSON.stringify(ref));
  }

  function multiLinkColumn(column, links) {
    const output = (!column || typeof column !== 'object' || Array.isArray(column)) ? {} : clone(column);
    if (typeof column === 'string' && column) {
      output.legacySingleLink = column;
    } else if (output.type !== 'multi-link' && Object.keys(output).length) {
      output.legacySingleLink = clone(column);
    }
    delete output.value;
    delete output.link;
    output.type = 'multi-link';
    output.links = links.map(normalizeLinkReference);
    return output;
  }

  function addLinkReference(column, value) {
    const current = linkReferences(column);
    const added = normalizeLinkReference(value);
    if (current.some((item) => linkIdentity(item) === linkIdentity(added))) return clone(column);
    return multiLinkColumn(column, [...current, added]);
  }

  function reorderLinkReference(column, fromIndex, toIndex) {
    const links = linkReferences(column);
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
        || fromIndex < 0 || fromIndex >= links.length || toIndex < 0 || toIndex >= links.length) {
      throw new RangeError('link reorder index is out of range');
    }
    if (links.length < 2 || fromIndex === toIndex) return clone(column);
    const [moved] = links.splice(fromIndex, 1);
    links.splice(toIndex, 0, moved);
    return multiLinkColumn(column, links);
  }

  function detachLinkReference(column, selector) {
    const links = linkReferences(column);
    const index = Number.isInteger(selector)
      ? selector : links.findIndex((item) => linkIdentity(item) === linkIdentity(selector));
    if (index < 0 || index >= links.length) throw new RangeError('link reference was not found');
    const detached = links[index];
    if (links.length === 1 && typeof column === 'string') {
      return { column: '', detached, resourceDeletionRequested: false };
    }
    if (links.length === 1 && typeof column === 'object' && !Array.isArray(column)
        && column?.type !== 'multi-link') {
      const next = clone(column);
      if ('value' in next) next.value = null;
      else if ('link' in next) next.link = null;
      else if ('href' in next) next.href = null;
      return { column: next, detached, resourceDeletionRequested: false };
    }
    links.splice(index, 1);
    return { column: multiLinkColumn(column, links), detached, resourceDeletionRequested: false };
  }

  function resourceDeletionPlan(value) {
    return { resourceRef: normalizeLinkReference(value), deleteResource: true };
  }

  global.MeldexTopicSheetBoardAdapter = Object.freeze({
    topicRefFromLegacySheetRow,
    adaptLegacySheetRowToTopic,
    sheetRowForTopic,
    topicRefFromLegacyBoardNode,
    adaptLegacyBoardNodeToTopic,
    boardNodeForTopic,
    linkReferences,
    addLinkReference,
    reorderLinkReference,
    detachLinkReference,
    resourceDeletionPlan,
  });
}(typeof globalThis !== 'undefined' ? globalThis : window));
