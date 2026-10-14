(function initMeldexTopicPlacementHistory(global) {
  'use strict';

  if (global.MeldexTopicPlacementHistory) return;

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function checkpointId(value) {
    return String(value?.checkpointId || value?.revision || value || '');
  }

  function topicKey(ref) {
    return JSON.stringify([String(ref?.sourceId || ''), String(ref?.topicId || '')]);
  }

  function historyMutationId(prefix, operationId) {
    const safe = String(operationId || 'placement').replace(/[^A-Za-z0-9._-]+/g, '-');
    return `${prefix}-${safe}`.slice(0, 255);
  }

  function locationOf(value) {
    const placement = value?.placement || value || {};
    return {
      sourceId: String(value?.sourceId || value?.topicRef?.sourceId || ''),
      documentId: String(placement.documentId || value?.documentId || ''),
      viewId: String(placement.viewId || value?.viewId || ''),
      surface: placement.surface || value?.surface,
      position: clone(placement.position ?? value?.position ?? null),
      columnBindings: clone(placement.columnBindings || value?.columnBindings || []),
      path: String(value?.path || value?.legacyPath || ''),
      label: String(value?.label || 'トピック'),
    };
  }

  async function snapshot(documentId) {
    if (!documentId || typeof global.apiFetch !== 'function') {
      throw new Error('履歴の対象シートまたはボードを確認できません');
    }
    return global.apiFetch(`/topic-views/${encodeURIComponent(documentId)}/snapshot`, {
      silentError: true,
    });
  }

  function matchingPlacement(document, ref, location) {
    const placements = Array.isArray(document?.placements) ? document.placements : [];
    return placements.find(item => topicKey(item?.topicRef) === topicKey(ref)
      && String(item?.viewId || '') === String(location?.viewId || '')
      && item?.surface === location?.surface) || null;
  }

  function recordFromSnapshot(loaded, ref) {
    const match = (loaded?.topics || []).find(item => topicKey(item?.topicRef) === topicKey(ref));
    return clone(match?.record || null);
  }

  async function sourceAt(ref, location, requirePlacement, allowMissingRecord) {
    const loaded = await snapshot(location.documentId);
    const placement = matchingPlacement(loaded.viewDocument, ref, location);
    if (requirePlacement && !placement) throw new Error('履歴の操作元が変更または削除されています');
    let record = recordFromSnapshot(loaded, ref);
    if (!record && typeof global.apiFetch === 'function') {
      try {
        const topic = await global.apiFetch(
          `/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`,
          { silentError: true },
        );
        record = clone(topic?.topic || topic?.record || topic);
      } catch (error) {
        if (!allowMissingRecord || (Number(error?.status) !== 404 && error?.code !== 'missing')) {
          throw error;
        }
      }
    }
    return {
      topicRef: clone(ref), placement: clone(placement), record,
      path: location.path, label: location.label, surface: location.surface,
      document: clone(loaded.viewDocument), revision: checkpointId(loaded.checkpoint),
    };
  }

  async function targetAt(location) {
    const loaded = await snapshot(location.documentId);
    return {
      sourceId: location.sourceId,
      documentId: location.documentId, viewId: location.viewId,
      surface: location.surface, position: clone(location.position),
      revision: checkpointId(loaded.checkpoint), document: clone(loaded.viewDocument),
      path: location.path, label: location.label,
    };
  }

  async function runPlacement(operation, ref, sourceLocation, targetLocation, options) {
    const needsPlacement = ['move', 'detach'].includes(operation);
    const source = await sourceAt(ref, sourceLocation, false, needsPlacement);
    const target = targetLocation ? await targetAt(targetLocation) : null;
    if (needsPlacement && !source.placement) {
      if (operation === 'detach') {
        return { ok: true, noOp: true, alreadyApplied: true, topicRef: clone(ref) };
      }
      const targetPlacement = matchingPlacement(target?.document, ref, targetLocation);
      if (targetPlacement) {
        return { ok: true, noOp: true, alreadyApplied: true, topicRef: clone(ref) };
      }
      throw new Error('履歴の操作元が変更または削除されています');
    }
    const result = await global.MeldexTopicPlacementUI.execute(source, operation, target, {
      skipHistory: true,
      allowOrphan: options?.allowOrphan === true,
      columnBindings: clone(options?.columnBindings || targetLocation?.columnBindings || []),
      operationId: options?.operationId,
    });
    if (!result?.ok) throw new Error(result?.message || '履歴の配置変更に失敗しました');
    return result;
  }

  async function deleteTopic(ref, duplicateOperationId, deleteMutationId) {
    let record = null;
    try {
      const loaded = await global.apiFetch(
        `/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`,
        { silentError: true },
      );
      record = loaded?.topic || loaded?.record || loaded;
    } catch (error) {
      if (Number(error?.status) !== 404 && error?.code !== 'missing') throw error;
    }
    return global.apiFetch(
      `/topic-stores/${encodeURIComponent(ref.sourceId)}/topics/${encodeURIComponent(ref.topicId)}`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, silentError: true,
        body: JSON.stringify({ mutationId: deleteMutationId,
          baseRevision: Number(record?.revision || 0),
          undoDuplicateOperationId: duplicateOperationId }) },
    );
  }

  async function restoreTopic(ref, restoreMutationId) {
    return global.apiFetch(
      `/topic-stores/${encodeURIComponent(ref.sourceId)}/trash/${encodeURIComponent(ref.topicId)}/restore`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, silentError: true,
        body: JSON.stringify({ mutationId: restoreMutationId }) },
    );
  }

  function historyScope(source) {
    const path = String(source?.path || source?.placement?.documentId || 'topic');
    if (source?.surface === 'board') return `board:${path}`;
    if (typeof global._dbScopeForPath === 'function') return global._dbScopeForPath(path);
    if (typeof global._dbScope === 'function') return global._dbScope(path);
    return `db:${path}`;
  }

  function register(detail) {
    if (typeof global.historyPush !== 'function' || !detail?.source || !detail?.result) return false;
    const operation = detail.operation;
    const originalRef = clone(detail.source.topicRef);
    const effectiveRef = clone(detail.result.topicRefs?.[0] || detail.result.topicRef || originalRef);
    const sourceLocation = locationOf(detail.source);
    const targetLocation = detail.target ? locationOf(detail.target) : null;
    const originalOperationId = String(detail.result.operationId || detail.result.mutationId || 'placement');
    const stepId = prefix => historyMutationId(prefix, originalOperationId);
    const label = ({ move: 'トピック移動', 'link-duplicate': 'トピックのリンク複製',
      duplicate: 'トピック複製', detach: 'トピックをこの場所から外す' })[operation];
    if (!label) return false;

    let undo;
    let redo;
    if (operation === 'move') {
      if (detail.result.targetAlreadyPresent === true) {
        undo = () => runPlacement('link-duplicate', effectiveRef, targetLocation, sourceLocation,
          { columnBindings: sourceLocation.columnBindings, operationId: stepId('history-move-undo') });
        redo = () => runPlacement('detach', effectiveRef, sourceLocation, null,
          { allowOrphan: true, operationId: stepId('history-move-redo') });
      } else {
        undo = () => runPlacement('move', effectiveRef, targetLocation, sourceLocation,
          { columnBindings: sourceLocation.columnBindings, operationId: stepId('history-move-undo') });
        redo = () => runPlacement('move', effectiveRef, sourceLocation, targetLocation,
          { columnBindings: targetLocation.columnBindings, operationId: stepId('history-move-redo') });
      }
    } else if (operation === 'link-duplicate') {
      undo = () => runPlacement('detach', effectiveRef, targetLocation, null,
        { allowOrphan: true, operationId: stepId('history-link-undo') });
      redo = () => runPlacement('link-duplicate', effectiveRef, sourceLocation, targetLocation,
        { columnBindings: targetLocation.columnBindings, operationId: stepId('history-link-redo') });
    } else if (operation === 'detach') {
      undo = () => runPlacement('link-duplicate', effectiveRef, sourceLocation, sourceLocation,
        { columnBindings: sourceLocation.columnBindings, operationId: stepId('history-detach-undo') });
      redo = () => runPlacement('detach', effectiveRef, sourceLocation, null,
        { allowOrphan: true, operationId: stepId('history-detach-redo') });
    } else {
      const duplicateOperationId = String(detail.result.mutationId || detail.result.operationId || '');
      const deleteMutationId = stepId('history-duplicate-delete');
      undo = async () => {
        await runPlacement('detach', effectiveRef, targetLocation, null,
          { allowOrphan: true, operationId: stepId('history-duplicate-detach') });
        try {
          await deleteTopic(effectiveRef, duplicateOperationId, deleteMutationId);
        } catch (error) {
          await runPlacement('link-duplicate', effectiveRef, targetLocation, targetLocation,
            { columnBindings: targetLocation.columnBindings,
              operationId: stepId('history-duplicate-delete-compensate') });
          throw error;
        }
      };
      redo = async () => {
        await restoreTopic(effectiveRef, stepId('history-duplicate-restore'));
        try {
          await runPlacement('link-duplicate', effectiveRef, targetLocation, targetLocation,
            { columnBindings: targetLocation.columnBindings,
              operationId: stepId('history-duplicate-link') });
        } catch (error) {
          await deleteTopic(effectiveRef, duplicateOperationId, deleteMutationId);
          throw error;
        }
      };
    }
    global.historyPush(`${label}: ${detail.source.label || 'トピック'}`, undo, redo,
      historyScope(detail.source));
    return true;
  }

  global.addEventListener?.('meldex:topic-placement-committed', event => register(event?.detail));
  global.MeldexTopicPlacementHistory = Object.freeze({ register, locationOf });
})(typeof window !== 'undefined' ? window : globalThis);
