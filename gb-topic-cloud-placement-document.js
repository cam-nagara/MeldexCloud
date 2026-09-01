(function initMeldexTopicCloudPlacementDocument(global) {
  'use strict';

  function create(options) {
    const placements = document => Array.isArray(document?.placements) ? document.placements : [];
    const includesPlacement = (document, placementId) => placements(document)
      .some(item => String(item.placementId) === String(placementId));
    const placementFor = (request, ref) => ({
      placementId: options.stableId('placement', request.operationId, ref.sourceId, ref.topicId,
        request.target.documentId, request.target.viewId),
      topicRef: ref, documentId: request.target.documentId, viewId: request.target.viewId,
      surface: request.target.surface, position: options.clone(request.target.position ?? null),
      order: options.clone(request.target.order ?? null),
      columnBindings: options.clone(request.columnBindings || []), revision: 0,
      mutationId: request.operationId,
    });
    const withPlacement = (document, placement) => {
      const next = options.normalizeDocument(document);
      if (!includesPlacement(next, placement.placementId)) next.placements = [...placements(next), placement];
      const refs = [...(next.membership?.manualTopicRefs || [])];
      if (!refs.some(ref => options.topicKey(ref) === options.topicKey(placement.topicRef))) {
        refs.push(options.clone(placement.topicRef));
      }
      next.membership = { mode: 'manual', manualTopicRefs: refs };
      return next;
    };
    const withoutPlacement = (document, sourcePlacement) => {
      const next = options.normalizeDocument(document);
      next.placements = placements(next)
        .filter(item => String(item.placementId) !== String(sourcePlacement.placementId));
      const stillPlaced = next.placements.some(item =>
        options.topicKey(item.topicRef) === options.topicKey(sourcePlacement.topicRef));
      if (!stillPlaced) next.membership.manualTopicRefs = next.membership.manualTopicRefs
        .filter(ref => options.topicKey(ref) !== options.topicKey(sourcePlacement.topicRef));
      return next;
    };
    const viewIdOf = view => String(view?.viewId || view?.sheetViewId || view?.boardViewId || '');
    const columnIdOf = column => String(column?.propertyFamilyId || column?.id || column?.columnId
      || `${column?.name || ''}\0${column?.columnType || column?.type || ''}`);
    const reconcileSurfaceViews = (currentViews, legacyViews) => {
      const output = options.clone(Array.isArray(currentViews) ? currentViews : []);
      for (const legacyView of (legacyViews || [])) {
        const index = output.findIndex(view => viewIdOf(view) === viewIdOf(legacyView));
        if (index < 0) { output.push(options.clone(legacyView)); continue; }
        const existing = output[index];
        const columns = options.clone(Array.isArray(existing.columns) ? existing.columns : []);
        const ids = new Set(columns.map(columnIdOf));
        for (const column of (legacyView.columns || [])) {
          if (!ids.has(columnIdOf(column))) {
            columns.push(options.clone(column));
            ids.add(columnIdOf(column));
          }
        }
        output[index] = { ...existing, columns };
      }
      return output;
    };
    const reconcileViewDocument = (current, legacy, newTopicKeys) => {
      const output = options.normalizeDocument(current);
      const placementIds = new Set(placements(output).map(item => String(item.placementId)));
      const additions = placements(legacy).filter(item => newTopicKeys.has(options.topicKey(item.topicRef))
        && !placementIds.has(String(item.placementId)));
      output.placements = [...placements(output), ...options.clone(additions)];
      const memberKeys = new Set(output.membership.manualTopicRefs.map(options.topicKey));
      for (const placement of additions) {
        if (!memberKeys.has(options.topicKey(placement.topicRef))) {
          output.membership.manualTopicRefs.push(options.clone(placement.topicRef));
          memberKeys.add(options.topicKey(placement.topicRef));
        }
      }
      output.sheetViews = reconcileSurfaceViews(output.sheetViews, legacy.sheetViews);
      output.boardViews = reconcileSurfaceViews(output.boardViews, legacy.boardViews);
      return options.normalizeDocument(output);
    };
    return Object.freeze({
      placements, includesPlacement, placementFor, withPlacement, withoutPlacement,
      reconcileViewDocument,
    });
  }

  global.MeldexTopicCloudPlacementDocument = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
