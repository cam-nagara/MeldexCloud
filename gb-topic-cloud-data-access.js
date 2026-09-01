/* Dropbox-backed Cloud/PWA routes for unified topic records and placements. */
(function initMeldexTopicCloudDataAccess(global) {
  'use strict';

  const ROOT = '_meldex/topics/v1';
  const REGISTRY_PATH = `${ROOT}/registry.json`;
  const TRANSACTION_INDEX_PATH = `${ROOT}/transaction-index.json`;
  const PREPARE_TTL_MS = 5 * 60 * 1000;
  const NOT_HANDLED_FALLBACK = Symbol('topic-cloud-not-handled');

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function encode(value) {
    return encodeURIComponent(String(value || '').trim());
  }

  function nowIso(now) {
    return new Date(now()).toISOString();
  }

  function error(message, status, code, detail) {
    const value = new Error(message);
    value.status = status;
    value.code = code;
    value.meldexCode = code;
    if (detail) value.detail = detail;
    return value;
  }

  function required(value, label) {
    const text = String(value || '').trim();
    if (!text) throw error(`${label} は必須です`, 400, 'invalid_request');
    return text;
  }

  function normalizePath(value) {
    const parts = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '.' || part === '..' || part.includes('\0'))) {
      throw error('安全でないパスです', 400, 'invalid_path');
    }
    return parts.join('/');
  }

  function topicPath(ref) {
    return `${ROOT}/sources/${encode(ref.sourceId)}/records/${encode(ref.topicId)}.json`;
  }

  function viewPath(documentId) {
    return `${ROOT}/views/${encode(documentId)}.json`;
  }

  function archiveRelativePath(documentId, surface) {
    return `${ROOT}/views/${encode(documentId)}.${surface === 'board' ? 'mel-board' : 'mel-sheet'}`;
  }

  function preparedPath(token) {
    return `${ROOT}/prepared/${encode(token)}.json`;
  }

  function receiptPath(operationId) {
    return `${ROOT}/receipts/${encode(operationId)}.json`;
  }

  function randomToken(randomValues) {
    const bytes = new Uint8Array(24);
    randomValues(bytes);
    return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function stableId(kind, ...parts) {
    const family = global.MeldexTopicPropertyFamily;
    const joined = parts.map(value => String(value || '')).join('\0');
    if (typeof family?.legacyPropertyFamilyId === 'function') {
      return `${kind}-${family.legacyPropertyFamilyId(kind, joined).replace(/^legacy-/, '')}`;
    }
    let hash = 2166136261;
    for (let index = 0; index < joined.length; index += 1) {
      hash ^= joined.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${kind}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function topicKey(ref) {
    return JSON.stringify([String(ref?.sourceId || ''), String(ref?.topicId || '')]);
  }

  function checkpointValue(value) {
    return String(value?.checkpointId || value?.id || value?.revision || value || '');
  }

  function sourceQualifiedPath(sourceId, relativePath) {
    const relative = String(relativePath || '').replace(/^\/+/, '');
    return global.MeldexSourceFolderRegistry?.sourcePath?.(sourceId, relative)
      || `source://${encode(sourceId)}/${relative}`;
  }

  function isReadOnly() {
    return global.document?.body?.dataset?.cloudReadonly === '1'
      || global.MeldexCloudRuntime?.getWorkspaceState?.()?.access === 'viewer';
  }

  function safeUsageTarget(path, label, linkType) {
    const href = String(path || '').trim();
    if (!href || /[\u0000-\u001f\u007f]/.test(href)) return null;
    const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || '';
    if (scheme && !['http', 'https', 'mailto', 'source'].includes(scheme)) return null;
    const router = global.GBLinkRouter;
    if (typeof router?.resolve !== 'function' || typeof global.openLink !== 'function') return null;
    const resolved = router.resolve(href, { label, linkType });
    return resolved?.recognized !== false && resolved?.type !== 'unsupported' ? resolved : null;
  }

  function normalizeRef(value) {
    return global.MeldexTopicContract?.normalizeTopicRef?.(value) || {
      sourceId: required(value?.sourceId, 'sourceId'), topicId: required(value?.topicId, 'topicId'),
    };
  }

  function normalizeRecord(value) {
    return global.MeldexTopicContract?.normalizeTopicRecord?.(value) || clone(value);
  }

  function normalizeDocument(value) {
    return global.MeldexTopicViewDocument?.normalizeDocument?.(value)
      || global.MeldexTopicContract?.normalizeTopicViewDocument?.(value) || clone(value);
  }

  function sameValue(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right)
        && left.length === right.length
        && left.every((value, index) => sameValue(value, right[index]));
    }
    if (plainObject(left) || plainObject(right)) {
      if (!plainObject(left) || !plainObject(right)) return false;
      const leftKeys = Object.keys(left).sort();
      const rightKeys = Object.keys(right).sort();
      return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index]
          && sameValue(left[key], right[key]));
    }
    return false;
  }

  function plainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function mergeItemId(path, value) {
    if (!plainObject(value)) return '';
    if (value.sourceId && value.topicId) return `topic:${topicKey(value)}`;
    if (value.placementId) return `placement:${value.placementId}`;
    if (value.topicRef && path.includes('topicLayouts')) {
      return `layout:${value.boardViewId || value.viewId || ''}:${topicKey(value.topicRef)}`;
    }
    if (value.relationSetId) return `relation:${value.relationSetId}`;
    if (value.groupId) return `group:${value.groupId}`;
    if (value.layoutId) return `layout:${value.layoutId}`;
    if (value.boardViewId || value.sheetViewId || value.viewId) {
      return `view:${value.boardViewId || value.sheetViewId || value.viewId}`;
    }
    if (value.propertyFamilyId || value.columnId || value.id || value.name) {
      if (path.includes('.columns')) {
        return `column:${value.propertyFamilyId || value.columnId || value.id || value.name}`;
      }
    }
    if (value.id) return `id:${value.id}`;
    return '';
  }

  function mergeStableArray(base, current, incoming, path) {
    const values = [...base, ...current, ...incoming];
    const ids = values.map(value => mergeItemId(path, value));
    if (values.length && ids.some(id => !id)) return null;
    const maps = [base, current, incoming].map(list => new Map(list.map(item => [mergeItemId(path, item), item])));
    if (maps.some(map => map.size !== (map === maps[0] ? base.length : map === maps[1] ? current.length : incoming.length))) {
      return null;
    }
    const [baseMap, currentMap, incomingMap] = maps;
    const allIds = [...new Set([...baseMap.keys(), ...currentMap.keys(), ...incomingMap.keys()])];
    const merged = new Map();
    for (const id of allIds) {
      const hasBase = baseMap.has(id); const hasCurrent = currentMap.has(id); const hasIncoming = incomingMap.has(id);
      if (!hasBase) {
        if (hasCurrent && hasIncoming) {
          merged.set(id, mergeThreeWayValue(undefined, currentMap.get(id), incomingMap.get(id), `${path}.${id}`));
        } else if (hasCurrent) merged.set(id, clone(currentMap.get(id)));
        else if (hasIncoming) merged.set(id, clone(incomingMap.get(id)));
        continue;
      }
      if (!hasCurrent && !hasIncoming) continue;
      if (!hasCurrent) {
        // 現在側の削除は、旧データ側で並び順などが変わっていても優先する。
        // 再移行で利用者が外した配置や列を復活させない。
        continue;
      }
      if (!hasIncoming) {
        if (sameValue(currentMap.get(id), baseMap.get(id))) continue;
        // 旧データ側で消えた項目を利用者が編集済みなら、現在値を保持する。
        merged.set(id, clone(currentMap.get(id)));
        continue;
      }
      merged.set(id, mergeThreeWayValue(
        baseMap.get(id), currentMap.get(id), incomingMap.get(id), `${path}.${id}`,
      ));
    }
    const baseIds = base.map(item => mergeItemId(path, item));
    const currentBaseOrder = current.map(item => mergeItemId(path, item)).filter(id => baseMap.has(id));
    const incomingBaseOrder = incoming.map(item => mergeItemId(path, item)).filter(id => baseMap.has(id));
    const survivingBaseOrder = baseIds.filter(id => merged.has(id));
    const currentOrder = currentBaseOrder.filter(id => merged.has(id));
    const incomingOrder = incomingBaseOrder.filter(id => merged.has(id));
    const currentReordered = !sameValue(currentOrder, survivingBaseOrder);
    const incomingReordered = !sameValue(incomingOrder, survivingBaseOrder);
    if (currentReordered && incomingReordered && !sameValue(currentOrder, incomingOrder)) {
      throw error('旧データと現在の並び順が競合しました', 409, 'conflict', { path: `${path}.$order` });
    }
    const preferred = currentReordered ? current : incomingReordered ? incoming : current;
    const orderedIds = preferred.map(item => mergeItemId(path, item)).filter(id => merged.has(id));
    for (const list of [current, incoming, base]) {
      for (const item of list) {
        const id = mergeItemId(path, item);
        if (merged.has(id) && !orderedIds.includes(id)) orderedIds.push(id);
      }
    }
    return orderedIds.map(id => clone(merged.get(id)));
  }

  function mergeThreeWayValue(base, current, incoming, path) {
    if (sameValue(current, incoming)) return clone(current);
    if (sameValue(current, base)) return clone(incoming);
    if (sameValue(incoming, base)) return clone(current);
    if (Array.isArray(base) && Array.isArray(current) && Array.isArray(incoming)) {
      const merged = mergeStableArray(base, current, incoming, path);
      if (merged) return merged;
    }
    if (plainObject(base) && plainObject(current) && plainObject(incoming)) {
      const output = {};
      const keys = new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(incoming)]);
      for (const key of keys) {
        const hasBase = Object.prototype.hasOwnProperty.call(base, key);
        const hasCurrent = Object.prototype.hasOwnProperty.call(current, key);
        const hasIncoming = Object.prototype.hasOwnProperty.call(incoming, key);
        const merged = mergeThreeWayValue(
          hasBase ? base[key] : undefined,
          hasCurrent ? current[key] : undefined,
          hasIncoming ? incoming[key] : undefined,
          `${path}.${key}`,
        );
        if (merged !== undefined) output[key] = merged;
      }
      return output;
    }
    throw error('旧データと現在の編集が同じ項目で競合しました', 409, 'conflict', { path });
  }

  function emptyRegistry() {
    return { schemaVersion: 1, revision: 0, documents: {}, updatedAt: null };
  }

  async function optionalJson(provider, path, fallback) {
    try {
      const stat = await provider.statPath(path);
      if (!stat) return clone(fallback);
      if (stat.kind !== 'file') throw error(`保存データがファイルではありません: ${path}`, 409, 'conflict');
      const parsed = JSON.parse(await provider.readText(path));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : clone(fallback);
    } catch (reason) {
      throw storageError(reason);
    }
  }

  function storageError(reason) {
    if (reason?.status || reason?.code) return reason;
    if (global.navigator?.onLine === false || reason?.name === 'NetworkError'
        || /network|fetch|offline|接続/i.test(String(reason?.message || ''))) {
      reason.code = 'offline'; reason.offline = true; reason.status = 503;
    }
    return reason;
  }

  async function casJson(provider, path, fallback, updater) {
    if (typeof provider.writeJsonMerged !== 'function') {
      throw error('Dropboxの競合検出保存を利用できません', 503, 'offline');
    }
    try {
      const checker = global.MeldexFileLockStore?.requireUnlocked;
      if (typeof checker === 'function') await checker(provider, path, { action: 'topic-write' });
      let output;
      await provider.writeJsonMerged(path, async (current, meta) => {
        const base = current && typeof current === 'object' && !Array.isArray(current) ? current : clone(fallback);
        output = await updater(clone(base), meta);
        return clone(output);
      }, { fallbackValue: clone(fallback), retries: 4 });
      return clone(output);
    } catch (reason) {
      throw storageError(reason);
    }
  }

  const transactionGc = global.MeldexTopicCloudTransactionGC?.create?.({
    indexPath: TRANSACTION_INDEX_PATH, preparedPath, receiptPath, optionalJson, casJson,
  });
  const recordTransaction = (...args) => transactionGc?.record(...args);
  const garbageCollectTransactions = (...args) => transactionGc?.collect(...args);

  function createDependencies(overrides) {
    const internals = overrides?.internals || global.__MeldexPwaDataAccessInternals || {};
    return {
      NOT_HANDLED: internals.NOT_HANDLED || NOT_HANDLED_FALLBACK,
      requireProvider: overrides?.requireProvider || internals._requirePwaProvider,
      requestJson: overrides?.requestJson || global.MeldexDataAccess?.requestJson,
      now: overrides?.now || Date.now,
      randomValues: overrides?.randomValues || (array => global.crypto.getRandomValues(array)),
    };
  }

  function createHandler(overrides) {
    const deps = createDependencies(overrides);

    async function provider(mode) {
      if (typeof deps.requireProvider !== 'function') throw error('Dropboxへ接続してください', 503, 'offline');
      if (global.navigator?.onLine === false) throw error('オフラインです', 503, 'offline');
      if (mode === 'readwrite' && isReadOnly()) {
        throw error('このCloudワークスペースは読み取り専用です', 403, 'forbidden');
      }
      return deps.requireProvider(mode);
    }

    async function requireLogicalViewUnlocked(storage, envelope, action) {
      const checker = global.MeldexFileLockStore?.requireUnlocked;
      if (typeof checker !== 'function') return;
      const logicalPath = envelope?.legacyPath || envelope?.relativePath;
      if (!logicalPath) return;
      await checker(storage, normalizePath(logicalPath), {
        action: action || 'topic-placement',
      });
    }

    async function readRegistry(storage) {
      return optionalJson(storage, REGISTRY_PATH, emptyRegistry());
    }

    async function registerView(storage, envelope) {
      await casJson(storage, REGISTRY_PATH, emptyRegistry(), (current) => {
        const documents = { ...(current.documents || {}) };
        documents[envelope.documentId] = {
          documentId: envelope.documentId, sourceId: envelope.sourceId,
          relativePath: envelope.relativePath, surface: envelope.viewDocument.defaultSurface,
          label: envelope.label || envelope.relativePath, checkpointId: checkpointValue(envelope.checkpoint),
          archiveRelativePath: envelope.archiveRelativePath
            || archiveRelativePath(envelope.documentId, envelope.viewDocument.defaultSurface),
          updatedAt: nowIso(deps.now),
        };
        return { ...current, schemaVersion: 1, revision: Number(current.revision || 0) + 1,
          documents, updatedAt: nowIso(deps.now) };
      });
    }

    async function readView(storage, documentId) {
      const envelope = await optionalJson(storage, viewPath(documentId), null);
      if (!envelope) throw error('シートまたはボードのトピック表示が見つかりません', 404, 'missing');
      envelope.viewDocument = normalizeDocument(envelope.viewDocument);
      return envelope;
    }

    async function writeView(storage, documentId, expectedCheckpoint, mutationId, mutate) {
      let result;
      await casJson(storage, viewPath(documentId), {}, (current) => {
        if (!current.documentId) throw error('トピック表示が見つかりません', 404, 'missing');
        if (current.viewDocument?.systemProvider) {
          throw error('この表示はスケジュール機能が提供する読み取り専用表示です', 403, 'forbidden');
        }
        const checkpoint = checkpointValue(current.checkpoint);
        if (expectedCheckpoint != null && String(expectedCheckpoint) !== checkpoint) {
          throw error('他の画面で更新されています。再読み込みしてください。', 409, 'conflict', {
            expectedCheckpoint, actualCheckpoint: checkpoint,
          });
        }
        const viewDocument = normalizeDocument(mutate(normalizeDocument(current.viewDocument), current));
        const revision = Number(current.checkpoint?.revision || 0) + 1;
        const nextCheckpointId = `cp-${encode(mutationId)}-${revision}`;
        result = { ...current, viewDocument, checkpoint: {
          id: nextCheckpointId, checkpointId: nextCheckpointId, revision, updatedAt: nowIso(deps.now),
        }, lastMutationId: mutationId, updatedAt: nowIso(deps.now) };
        return result;
      });
      return result;
    }

    async function readTopic(storage, ref) {
      const envelope = await optionalJson(storage, topicPath(ref), null);
      if (!envelope?.record) throw error('トピックが見つかりません', 404, 'missing');
      return { ...envelope, topicRef: normalizeRef(envelope.topicRef || ref), record: normalizeRecord(envelope.record) };
    }

    async function putNewTopic(storage, ref, record, mutationId) {
      return casJson(storage, topicPath(ref), {}, (current) => {
        if (current.record) {
          if (current.createdByMutationId === mutationId) return current;
          throw error('同じIDのトピックが既に存在します', 409, 'conflict');
        }
        return { schemaVersion: 1, topicRef: normalizeRef(ref), record: normalizeRecord(record),
          createdByMutationId: mutationId, updatedAt: nowIso(deps.now) };
      });
    }

    async function patchTopic(storage, ref, body) {
      const mutationId = required(body?.mutationId, 'mutationId');
      let output;
      await casJson(storage, topicPath(ref), {}, (current) => {
        if (!current.record) throw error('トピックが見つかりません', 404, 'missing');
        if (current.lastMutationId === mutationId) { output = current; return current; }
        const actual = current.record.revision ?? 0;
        if (body?.baseRevision != null && String(body.baseRevision) !== String(actual)) {
          throw error('トピックが他の画面で更新されています', 409, 'conflict');
        }
        const changes = body?.changes && typeof body.changes === 'object' ? body.changes : {};
        const record = normalizeRecord({ ...current.record, ...clone(changes),
          topicId: ref.topicId, revision: Number(actual || 0) + 1, updatedAt: nowIso(deps.now) });
        output = { ...current, record, lastMutationId: mutationId, updatedAt: nowIso(deps.now) };
        return output;
      });
      return { ok: true, topicRef: ref, record: output.record, revision: output.record.revision };
    }

    const duplicateTrash = global.MeldexTopicCloudDuplicateTrash?.create?.({
      root: ROOT, encode, topicPath, optionalJson, casJson, readTopic,
      topicUsages: (...args) => topicUsages(...args), error,
    });

    const placementDocument = global.MeldexTopicCloudPlacementDocument?.create?.({
      stableId, clone, normalizeDocument, topicKey,
    });
    const { placements, includesPlacement, placementFor, withPlacement, withoutPlacement,
      reconcileViewDocument } = placementDocument;

    async function allViewEnvelopes(storage) {
      const registry = await readRegistry(storage);
      const output = [];
      for (const documentId of Object.keys(registry.documents || {})) {
        try { output.push(await readView(storage, documentId)); } catch (reason) {
          if (Number(reason?.status) !== 404) throw reason;
        }
      }
      return output;
    }

    async function topicUsages(storage, ref) {
      const usages = [];
      for (const envelope of await allViewEnvelopes(storage)) {
        for (const placement of placements(envelope.viewDocument)) {
          if (topicKey(placement.topicRef) !== topicKey(ref)) continue;
          const relativePath = envelope.relativePath || envelope.legacyPath || '';
          const legacyRelativePath = envelope.legacyPath || relativePath;
          const qualifiedPath = sourceQualifiedPath(envelope.sourceId, legacyRelativePath);
          usages.push({ usageId: `usage-${placement.placementId}`, topicRef: clone(ref), kind: 'placement',
            targetId: envelope.documentId, label: envelope.label || envelope.relativePath || envelope.documentId,
            location: { documentId: envelope.documentId, viewId: placement.viewId,
              surface: placement.surface, placementId: placement.placementId,
              sourceId: envelope.sourceId, relativePath, legacyPath: qualifiedPath,
              sourceQualifiedPath: qualifiedPath },
            available: !!safeUsageTarget(qualifiedPath,
              envelope.label || envelope.relativePath, placement.surface) });
        }
      }
      try {
        const topic = await readTopic(storage, ref);
        for (const resource of (topic.record.resources || [])) {
          const resourceType = String(resource?.resourceType || resource?.type || '').toLowerCase();
          const href = String(resource?.href || resource?.path || resource?.url || '');
          const kind = ['chat-link', 'chat'].includes(resourceType) ? 'chat-link'
            : (resourceType === 'note-link' || resourceType === 'file' || /\.md(?:$|[?#])/i.test(href)
              ? 'note-link' : '');
          if (!kind || !href) continue;
          const targetId = String(resource.resourceId || resource.id || href);
          usages.push({ usageId: stableId('usage', ref.sourceId, ref.topicId, kind, targetId),
            topicRef: clone(ref), kind, targetId,
            label: String(resource.label || resource.title || href), location: { href },
            available: !!safeUsageTarget(href, resource.label || resource.title || href,
              resource.linkType || (kind === 'chat-link' ? 'page' : '')) });
        }
      } catch (reason) {
        if (Number(reason?.status) !== 404) throw reason;
      }
      return { topicRef: ref, revision: 0, partial: true, coverage: 'partial', usages };
    }

    function expectedCheckpoint(request, documentId) {
      return request.baseRevisions?.[documentId] ?? request.expectedRevision ?? null;
    }

    async function validatePrepare(storage, request) {
      const ref = normalizeRef(request.topicRef);
      if (request.operation !== 'detach') {
        required(request.target?.documentId, 'target.documentId');
        required(request.target?.viewId, 'target.viewId');
        if (!['sheet', 'board'].includes(request.target?.surface)) {
          throw error('target.surface が不正です', 400, 'invalid_request');
        }
      }
      if (['move', 'detach'].includes(request.operation)) {
        required(request.sourcePlacement?.placementId, 'sourcePlacement.placementId');
        required(request.sourcePlacement?.documentId, 'sourcePlacement.documentId');
      }
      const boundSources = new Map();
      const boundTargets = new Map();
      for (const binding of (request.columnBindings || [])) {
        const sourceFamily = required(binding?.sourcePropertyFamilyId, 'sourcePropertyFamilyId');
        const targetFamily = required(binding?.targetPropertyFamilyId, 'targetPropertyFamilyId');
        if (binding?.confirmed !== true) throw error('列の共通化には確認が必要です', 400, 'invalid_request');
        if (boundSources.has(sourceFamily) && boundSources.get(sourceFamily) !== targetFamily) {
          throw error('同じ値を複数の列へ共通化できません', 400, 'invalid_request');
        }
        if (boundTargets.has(targetFamily) && boundTargets.get(targetFamily) !== sourceFamily) {
          throw error('複数の値を同じ列へ共通化できません', 400, 'invalid_request');
        }
        boundSources.set(sourceFamily, targetFamily);
        boundTargets.set(targetFamily, sourceFamily);
      }
      const topic = await readTopic(storage, ref);
      const documentIds = new Set();
      if (request.target?.documentId) documentIds.add(request.target.documentId);
      if (request.sourcePlacement?.documentId) documentIds.add(request.sourcePlacement.documentId);
      const revisions = {};
      let targetView = null;
      for (const documentId of documentIds) {
        const envelope = await readView(storage, documentId);
        if (envelope.viewDocument.systemProvider) {
          throw error('システム提供の表示は変更できません', 403, 'forbidden');
        }
        await requireLogicalViewUnlocked(storage, envelope, 'topic-placement-prepare');
        const checkpoint = checkpointValue(envelope.checkpoint);
        const expected = expectedCheckpoint(request, documentId);
        if (expected != null && String(expected) !== String(checkpoint)) {
          throw error('配置先が他の画面で更新されています', 409, 'conflict');
        }
        if (documentId === request.target?.documentId) {
          const rows = request.target.surface === 'sheet'
            ? envelope.viewDocument.sheetViews : envelope.viewDocument.boardViews;
          targetView = (rows || []).find(item => String(
            item?.viewId || item?.sheetViewId || item?.boardViewId || '',
          ) === String(request.target.viewId)) || null;
          if (!targetView) {
            throw error('移動先のビューまたは表示形式が現在の登録と一致しません', 409, 'conflict');
          }
        }
        revisions[documentId] = checkpoint;
      }
      const values = topic.record.propertyValuesByFamilyId || {};
      const columns = Array.isArray(targetView?.columns) ? targetView.columns : [];
      for (const [sourceFamily, targetFamily] of boundSources.entries()) {
        const sourceValue = values[sourceFamily];
        const targetColumn = columns.find(column => String(column?.propertyFamilyId || '') === targetFamily);
        if (!sourceValue || !targetColumn) {
          throw error('共通化する列またはトピック値が現在の保存内容と一致しません', 409, 'conflict');
        }
        const compatible = global.MeldexTopicPropertyFamily?.compatibleTypes;
        let typesMatch = false;
        try {
          typesMatch = typeof compatible === 'function' && compatible({
            columnId: sourceFamily, name: sourceValue.displayName || sourceFamily,
            columnType: sourceValue.columnType, typeConfig: sourceValue.typeConfig || {},
          }, targetColumn);
        } catch (_) {
          typesMatch = false;
        }
        if (!typesMatch) {
          throw error('型または型設定が異なる列は共通化できません', 409, 'conflict');
        }
      }
      if (['move', 'detach'].includes(request.operation)) {
        const source = await readView(storage, request.sourcePlacement.documentId);
        const actual = placements(source.viewDocument).find(item => (
          String(item.placementId) === String(request.sourcePlacement.placementId)
        ));
        if (!actual) {
          throw error('移動元の登録が見つかりません', 409, 'conflict');
        }
        if (topicKey(actual.topicRef) !== topicKey(ref)) {
          throw error('移動元の登録とトピックが一致しません', 409, 'conflict');
        }
        const persistedLocation = [actual.documentId, actual.viewId, actual.surface];
        const requestedLocation = [request.sourcePlacement.documentId,
          request.sourcePlacement.viewId, request.sourcePlacement.surface];
        if (persistedLocation.some((value, index) => String(value) !== String(requestedLocation[index]))) {
          throw error('移動元の表示位置が現在の登録と一致しません', 409, 'conflict');
        }
      }
      return { ref, revisions, topicRevision: topic.record.revision ?? 0 };
    }

    async function preparePlacement(storage, request) {
      const operationId = required(request?.operationId || request?.mutationId, 'operationId');
      if (!['move', 'link-duplicate', 'duplicate', 'detach'].includes(request?.operation)) {
        throw error('未対応の配置操作です', 400, 'invalid_request');
      }
      const validated = await validatePrepare(storage, request);
      const token = randomToken(deps.randomValues);
      const expiresAt = deps.now() + PREPARE_TTL_MS;
      const duplicateRef = request.operation === 'duplicate' ? {
        sourceId: validated.ref.sourceId,
        topicId: stableId('topic', operationId, validated.ref.sourceId, validated.ref.topicId),
      } : null;
      await casJson(storage, preparedPath(token), {}, (current) => {
        if (current.operationId) throw error('準備トークンが競合しました', 409, 'conflict');
        return { schemaVersion: 1, token, operationId,
          request: clone(request), revisions: validated.revisions,
          topicRevision: validated.topicRevision, duplicateRef,
          phase: 'prepared', createdAt: deps.now(), expiresAt };
      });
      await recordTransaction(storage, token, operationId, 'pending', deps.now());
      return { ok: true, preparedToken: token, prepareToken: token, operationId,
        expectedRevision: clone(validated.revisions), expiresAt: new Date(expiresAt).toISOString() };
    }

    async function readPrepared(storage, token, operationId) {
      const prepared = await optionalJson(storage, preparedPath(token), null);
      if (!prepared || prepared.operationId !== operationId) throw error('準備済み操作が見つかりません', 404, 'missing');
      const completed = ['topic-created', 'target-added', 'source-removal-authorized',
        'operation-complete', 'committed'].includes(prepared.phase);
      if (!completed && Number(prepared.expiresAt || 0) <= deps.now()) {
        throw error('操作の有効期限が切れました', 409, 'conflict');
      }
      return prepared;
    }

    async function savePrepared(storage, prepared, phase) {
      const ranks = { prepared: 0, 'topic-created': 1, 'target-added': 2,
        'source-removal-authorized': 3, 'operation-complete': 4, committed: 5 };
      return casJson(storage, preparedPath(prepared.token), {}, (current) => {
        if (current.operationId !== prepared.operationId) throw error('準備済み操作が変更されました', 409, 'conflict');
        const nextPhase = (ranks[current.phase] || 0) > (ranks[phase] || 0) ? current.phase : phase;
        return { ...current, phase: nextPhase, updatedAt: deps.now() };
      });
    }

    async function recheckView(storage, prepared, documentId) {
      const envelope = await readView(storage, documentId);
      await requireLogicalViewUnlocked(storage, envelope, 'topic-placement-commit');
      const expected = prepared.revisions?.[documentId];
      if (checkpointValue(envelope.checkpoint) !== String(expected || '')) {
        throw error('準備後にシートまたはボードが更新されました', 409, 'conflict');
      }
      return envelope;
    }

    async function addTarget(storage, prepared, ref) {
      const request = prepared.request;
      const target = await readView(storage, request.target.documentId);
      const placement = placementFor(request, ref);
      const sameView = placements(target.viewDocument).find(item => (
        topicKey(item.topicRef) === topicKey(ref)
        && String(item.viewId) === String(request.target.viewId)
        && String(item.surface) === String(request.target.surface)
      ));
      if (sameView) {
        const replayedAddition = sameView.mutationId === request.operationId;
        const sourceIsTarget = request.sourcePlacement
          && request.sourcePlacement.documentId === request.target.documentId
          && request.sourcePlacement.viewId === request.target.viewId
          && request.sourcePlacement.surface === request.target.surface;
        return { envelope: target, placement: sameView,
          noOp: !replayedAddition && (request.operation === 'link-duplicate' || sourceIsTarget),
          targetAlreadyPresent: !replayedAddition, addedPlacement: replayedAddition };
      }
      if (includesPlacement(target.viewDocument, placement.placementId)) {
        return { envelope: target, placement, targetAlreadyPresent: true, addedPlacement: false };
      }
      await recheckView(storage, prepared, request.target.documentId);
      const envelope = await writeView(storage, request.target.documentId,
        prepared.revisions[request.target.documentId], request.operationId,
        document => withPlacement(document, placement));
      return { envelope, placement, targetAlreadyPresent: false, addedPlacement: true };
    }

    async function removeSource(storage, prepared) {
      const request = prepared.request;
      const source = await readView(storage, request.sourcePlacement.documentId);
      if (!includesPlacement(source.viewDocument, request.sourcePlacement.placementId)) {
        if (source.lastMutationId === request.operationId) return source;
        throw error('準備後に移動元の登録が変更されました', 409, 'conflict');
      }
      await requireLogicalViewUnlocked(storage, source, 'topic-placement-source-removal');
      const expected = prepared.phase !== 'prepared' && request.sourcePlacement.documentId === request.target?.documentId
        ? checkpointValue(source.checkpoint) : prepared.revisions[request.sourcePlacement.documentId];
      return writeView(storage, request.sourcePlacement.documentId, expected, request.operationId,
        document => withoutPlacement(document, request.sourcePlacement));
    }

    async function removeAddedTarget(storage, prepared, targetResult) {
      if (!targetResult?.addedPlacement) return;
      const request = prepared.request;
      const current = await readView(storage, request.target.documentId);
      const placement = placements(current.viewDocument).find(item =>
        String(item.placementId) === String(targetResult.placement.placementId));
      if (!placement) return;
      if (placement.mutationId !== request.operationId) {
        throw error('追加先が別の操作で変更されたため自動復旧できません', 409,
          'placement-recovery-required');
      }
      await writeView(storage, request.target.documentId, checkpointValue(current.checkpoint),
        `${request.operationId}:rollback-target`,
        document => withoutPlacement(document, targetResult.placement));
    }

    async function executePrepared(storage, prepared) {
      const request = prepared.request;
      const sourceRef = normalizeRef(request.topicRef);
      if (prepared.phase === 'prepared') {
        const current = await validatePrepare(storage, request);
        if (String(current.topicRevision) !== String(prepared.topicRevision)) {
          throw error('準備後にトピックの値または型が更新されました', 409, 'conflict');
        }
      }
      if (request.operation === 'detach') {
        const source = await readView(storage, request.sourcePlacement.documentId);
        if (!includesPlacement(source.viewDocument, request.sourcePlacement.placementId)) {
          return { topicRef: sourceRef, detached: true, _sourceRemovalCommitted: true };
        }
        const index = await topicUsages(storage, sourceRef);
        const placementCount = index.usages.filter(usage => usage.kind === 'placement').length;
        if (placementCount <= 1 && request.allowOrphan !== true) {
          throw error('最後の登録先から外すには確認が必要です', 409, 'conflict');
        }
        await recheckView(storage, prepared, request.sourcePlacement.documentId);
        prepared = await savePrepared(storage, prepared, 'source-removal-authorized');
        await removeSource(storage, prepared);
        return { topicRef: sourceRef, detached: true, _sourceRemovalCommitted: true };
      }
      let ref = sourceRef;
      let duplicateCreated = false;
      let targetResult = null;
      try {
        if (request.operation === 'duplicate') {
          ref = normalizeRef(prepared.duplicateRef);
          const source = await readTopic(storage, sourceRef);
          await putNewTopic(storage, ref, { ...clone(source.record), topicId: ref.topicId,
            revision: 0, createdAt: nowIso(deps.now), updatedAt: nowIso(deps.now) }, request.operationId);
          duplicateCreated = true;
          prepared = await savePrepared(storage, prepared, 'topic-created');
        }
        targetResult = await addTarget(storage, prepared, ref);
        prepared = await savePrepared(storage, prepared, 'target-added');
        if (request.operation === 'move' && !targetResult.noOp) {
          prepared = await savePrepared(storage, prepared, 'source-removal-authorized');
          await removeSource(storage, prepared);
        }
      } catch (reason) {
        const failures = [];
        try { await removeAddedTarget(storage, prepared, targetResult); }
        catch (rollbackError) { failures.push(`target:${rollbackError?.message || rollbackError}`); }
        if (duplicateCreated) {
          try {
            await duplicateTrash.discard(storage, ref, request.operationId);
          } catch (rollbackError) {
            failures.push(`topic:${rollbackError?.message || rollbackError}`);
          }
        }
        if (failures.length) {
          throw error('配置変更の自動復旧結果を確認できません', 409,
            'placement-recovery-required', { recoveryRequired: true, failures });
        }
        reason.sourcePreserved = true;
        throw reason;
      }
      return { topicRef: ref, topicRefs: [ref], placement: targetResult.placement,
        targetCheckpoint: targetResult.envelope.checkpoint,
        noOp: targetResult.noOp === true,
        targetAlreadyPresent: targetResult.targetAlreadyPresent === true,
        addedPlacement: targetResult.addedPlacement === true,
        _sourceRemovalCommitted: request.operation === 'move' && !targetResult.noOp };
    }

    async function commitPlacement(storage, body) {
      const operationId = required(body?.operationId, 'operationId');
      const token = required(body?.preparedToken || body?.prepareToken, 'preparedToken');
      const existing = await optionalJson(storage, receiptPath(operationId), null);
      if (existing?.result) {
        try {
          await recordTransaction(storage, token, operationId, 'committed', deps.now());
          await garbageCollectTransactions(storage, deps.now());
        } catch (reason) { global.console?.warn?.('トピック操作履歴の索引を再試行します', reason); }
        return clone(existing.result);
      }
      let prepared = await readPrepared(storage, token, operationId);
      const execution = await executePrepared(storage, prepared);
      delete execution._sourceRemovalCommitted;
      const result = { ok: true, operationId, ...execution };
      try {
        prepared = await savePrepared(storage, prepared, 'operation-complete');
        await casJson(storage, receiptPath(operationId), {}, current => current.result ? current : {
          schemaVersion: 1, operationId, result, committedAt: nowIso(deps.now),
        });
        await savePrepared(storage, prepared, 'committed');
      } catch (reason) {
        result.receiptPending = true;
        try { await recordTransaction(storage, token, operationId, 'recovery-required', deps.now()); }
        catch (indexReason) { global.console?.warn?.('トピック操作の復旧索引を再試行します', indexReason); }
        return result;
      }
      try {
        await recordTransaction(storage, token, operationId, 'committed', deps.now());
        await garbageCollectTransactions(storage, deps.now());
      } catch (reason) { global.console?.warn?.('トピック操作履歴のGCを再試行します', reason); }
      return result;
    }

    function legacyProperty(raw) {
      if (Array.isArray(raw)) return raw.length === 1 ? raw[0]?.value ?? raw[0] : raw.map(item => item?.value ?? item);
      return raw?.value ?? raw;
    }

    function sheetMigration(sourceId, relativePath, pivot, metadata) {
      const documentId = stableId('view', sourceId, relativePath);
      const viewId = stableId('sheet', documentId);
      const properties = Array.isArray(pivot?.properties) ? pivot.properties : [];
      const propertyTypes = metadata?.property_types || {};
      const propertyIds = metadata?.property_ids || {};
      const columns = properties.map((name) => {
        const spec = propertyTypes[name];
        const rawType = spec && typeof spec === 'object' ? spec.type : spec;
        const typeConfig = spec && typeof spec === 'object'
          ? clone(spec.typeConfig || spec.config || Object.fromEntries(
            Object.entries(spec).filter(([key]) => key !== 'type'),
          )) : {};
        return { id: String(propertyIds[name] || name), name: String(name), typeConfig,
          columnType: global.MeldexTopicPropertyFamily?.canonicalType?.(rawType || 'unknown') || 'unknown',
          propertyFamilyId: global.MeldexTopicPropertyFamily?.legacyPropertyFamilyId?.(
            documentId, String(propertyIds[name] || name),
          ) || stableId('property', documentId, propertyIds[name] || name) };
      });
      const adapterColumns = columns.map(column => ({ ...column, id: column.name, columnId: column.id }));
      const topicRecords = [];
      const placementsList = [];
      Object.entries(pivot?.entities || {}).forEach(([name, entity], index) => {
        const topicId = stableId('topic', sourceId, relativePath, entity?._id || name);
        const rowProperties = {};
        properties.forEach(prop => { if (entity?.[prop] !== undefined) rowProperties[prop] = legacyProperty(entity[prop]); });
        const row = { id: topicId, name, title: name, properties: rowProperties, revision: 0 };
        const adapted = global.MeldexTopicSheetBoardAdapter?.adaptLegacySheetRowToTopic?.(
          row, sourceId, { columns: adapterColumns, documentId },
        );
        const ref = adapted?.topicRef || { sourceId, topicId };
        topicRecords.push({ topicRef: ref, record: adapted?.topicRecord || {
          topicId, title: name, properties: rowProperties, propertyValuesByFamilyId: {},
          propertyValueOrder: [], note: null, resources: [], revision: 0,
        } });
        placementsList.push({ placementId: stableId('placement', documentId, topicId), topicRef: ref,
          documentId, viewId, surface: 'sheet', order: index, position: null, revision: 0 });
      });
      return migrationResult(sourceId, relativePath, documentId, viewId, 'sheet', columns, topicRecords, placementsList);
    }

    function boardMigration(sourceId, relativePath, board) {
      const savedDocument = nestedJsonObject(board?.topicViewDocument);
      if (savedDocument && savedDocument.defaultSurface !== 'board') {
        throw error('保存済みの表示データがボードではありません', 409, 'conflict');
      }
      const documentId = String(savedDocument?.documentId || stableId('view', sourceId, relativePath));
      const viewId = String(savedDocument?.activeBoardViewId
        || savedDocument?.boardViews?.[0]?.boardViewId
        || savedDocument?.boardViews?.[0]?.viewId
        || stableId('board', documentId));
      const nodes = Array.isArray(board?.nodes) ? board.nodes : (Array.isArray(board?.items) ? board.items : []);
      const idMap = {};
      nodes.forEach(node => { idMap[node.id] = node.topicId || stableId('topic', sourceId, relativePath, node.id); });
      const topicRecords = [];
      const placementsList = [];
      nodes.forEach((node, index) => {
        const adapted = global.MeldexTopicSheetBoardAdapter?.adaptLegacyBoardNodeToTopic?.(
          node, sourceId, idMap, { documentId, columns: board?.columns || [] },
        );
        const ref = adapted?.topicRef || { sourceId, topicId: idMap[node.id] };
        topicRecords.push({ topicRef: ref, record: adapted?.topicRecord || {
          topicId: ref.topicId, title: String(node.title || node.text || ''), properties: node.properties || {},
          propertyValuesByFamilyId: {}, propertyValueOrder: [], note: null, resources: [], revision: 0,
        } });
        placementsList.push({ placementId: stableId('placement', documentId, ref.topicId), topicRef: ref,
          documentId, viewId, surface: 'board', order: index,
          position: { x: Number(node.x || 0), y: Number(node.y || 0) }, revision: 0 });
      });
      const migration = migrationResult(
        sourceId, relativePath, documentId, viewId, 'board', board?.columns || [], topicRecords, placementsList,
      );
      if (savedDocument) migration.viewDocument = mergeSavedBoardDocument(savedDocument, migration.viewDocument);
      return migration;
    }

    function nestedJsonObject(value) {
      let current = value;
      for (let pass = 0; pass < 3; pass += 1) {
        if (current && typeof current === 'object' && !Array.isArray(current)) return clone(current);
        if (typeof current !== 'string') return null;
        try { current = JSON.parse(current); }
        catch (reason) { throw error('保存済みのボード表示データを読み取れません', 409, 'conflict', {
          message: String(reason?.message || reason),
        }); }
      }
      return current && typeof current === 'object' && !Array.isArray(current) ? clone(current) : null;
    }

    function mergeSavedBoardDocument(savedValue, generatedValue) {
      const saved = normalizeDocument(savedValue);
      const generated = normalizeDocument(generatedValue);
      const memberKeys = new Set(saved.membership.manualTopicRefs.map(topicKey));
      for (const ref of generated.membership.manualTopicRefs) {
        const key = topicKey(ref);
        if (!memberKeys.has(key)) {
          saved.membership.manualTopicRefs.push(clone(ref));
          memberKeys.add(key);
        }
      }
      const placedKeys = new Set(placements(saved).map(item => topicKey(item.topicRef)));
      for (const placement of placements(generated)) {
        const key = topicKey(placement.topicRef);
        if (!placedKeys.has(key)) {
          saved.placements.push(clone(placement));
          placedKeys.add(key);
        }
      }
      return normalizeDocument(saved);
    }

    function migrationResult(sourceId, relativePath, documentId, viewId, surface, columns, records, placementsList) {
      const viewDocument = normalizeDocument({ documentId, schemaVersion: 1, defaultSurface: surface,
        membership: { mode: 'manual', manualTopicRefs: records.map(item => item.topicRef) },
        systemProvider: null, sheetViews: surface === 'sheet' ? [{ viewId, columns: clone(columns) }] : [],
        boardViews: surface === 'board' ? [{ viewId, columns: clone(columns) }] : [],
        placements: placementsList, relationSets: [], topicLayouts: [], lastCompleteSnapshot: null });
      return { sourceId, relativePath, documentId, viewDocument, topicRecords: records,
        checkpoint: { id: 'cp-initial-0', checkpointId: 'cp-initial-0', revision: 0 },
        archiveRelativePath: archiveRelativePath(documentId, surface) };
    }

    async function loadMigration(sourceId, relativePath) {
      const virtualPath = global.MeldexSourceFolderRegistry?.sourcePath?.(sourceId, relativePath)
        || `source://${encode(sourceId)}/${relativePath}`;
      const lowerPath = relativePath.toLowerCase();
      const isBoard = lowerPath.endsWith('.mel-board') || lowerPath.endsWith('.board.json')
        || lowerPath.endsWith('.canvas.json') || lowerPath.endsWith('.board');
      if (!isBoard) {
        if (typeof deps.requestJson !== 'function') throw error('シート読込経路がありません', 503, 'offline');
        const [pivot, metadata] = await Promise.all([
          deps.requestJson(`/pivot?path=${encodeURIComponent(virtualPath)}`),
          deps.requestJson(`/db-metadata?path=${encodeURIComponent(virtualPath)}`),
        ]);
        return sheetMigration(sourceId, relativePath, pivot, metadata);
      }
      if (typeof deps.requestJson !== 'function') throw error('ボード読込経路がありません', 503, 'offline');
      const file = await deps.requestJson(`/file?path=${encodeURIComponent(virtualPath)}`);
      return boardMigration(sourceId, relativePath, JSON.parse(file?.content || '{}'));
    }

    function comparableTopicRecord(value) {
      const record = clone(value || {});
      ['revision', 'createdAt', 'updatedAt', 'updatedBy', '_mutationIds']
        .forEach(key => { delete record[key]; });
      return record;
    }

    function mergeMigratedTopicRecord(baseValue, currentValue, incomingValue, ref) {
      const current = normalizeRecord(currentValue);
      const incoming = normalizeRecord(incomingValue);
      const mergedData = mergeThreeWayValue(
        comparableTopicRecord(normalizeRecord(baseValue)),
        comparableTopicRecord(current),
        comparableTopicRecord(incoming),
        `topics.${topicKey(ref)}`,
      );
      if (sameValue(mergedData, comparableTopicRecord(current))) return current;
      const next = {};
      ['createdAt', '_mutationIds'].forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(current, key)) next[key] = clone(current[key]);
      });
      Object.assign(next, mergedData, {
        topicId: ref.topicId,
        revision: Number(current.revision || 0) + 1,
        updatedAt: nowIso(deps.now),
        updatedBy: 'legacy-migration',
      });
      return normalizeRecord(next);
    }

    function mergeMigratedViewDocument(currentValue, incomingValue, baselineValue, newTopicKeys) {
      const current = normalizeDocument(currentValue);
      const incoming = normalizeDocument(incomingValue);
      const baseline = baselineValue ? normalizeDocument(baselineValue) : null;
      const output = reconcileViewDocument(current, incoming, newTopicKeys);
      if (!baseline) return output;
      const excluded = new Set(['documentId', 'schemaVersion', 'defaultSurface']);
      const keys = new Set([...Object.keys(baseline), ...Object.keys(current), ...Object.keys(incoming)]);
      for (const key of keys) {
        if (excluded.has(key)) continue;
        const merged = mergeThreeWayValue(
          baseline[key], current[key], incoming[key], `viewDocument.${key}`,
        );
        if (merged === undefined) delete output[key];
        else output[key] = merged;
      }
      return normalizeDocument(output);
    }

    async function planMigratedTopics(storage, envelope, migration) {
      const baselineRecords = envelope.legacyBaseline?.topicRecords || {};
      const plans = [];
      for (const item of migration.topicRecords) {
        const key = topicKey(item.topicRef);
        const current = await optionalJson(storage, topicPath(item.topicRef), null);
        if (!current?.record) {
          plans.push({ kind: 'create', item, key });
          continue;
        }
        const baselineRecord = baselineRecords[key];
        if (!baselineRecord) {
          // Older envelopes did not record a migration baseline.  Preserve the
          // current canonical topic and establish a baseline on this pass.
          plans.push({ kind: 'keep', item, key });
          continue;
        }
        const record = mergeMigratedTopicRecord(
          baselineRecord, current.record, item.record, item.topicRef,
        );
        plans.push({ kind: sameValue(record, current.record) ? 'keep' : 'update', item, key, record });
      }
      return plans;
    }

    async function applyMigratedTopicPlans(storage, migration, plans) {
      for (const plan of plans) {
        if (plan.kind === 'keep') continue;
        if (plan.kind === 'create') {
          await putNewTopic(storage, plan.item.topicRef, plan.item.record, `migration-${migration.documentId}`);
          continue;
        }
        await casJson(storage, topicPath(plan.item.topicRef), {}, (current) => {
          if (!current.record) throw error('更新対象のトピックが見つかりません', 409, 'conflict');
          const nextRecord = mergeMigratedTopicRecord(
            migration._baselineTopicRecords[plan.key], current.record,
            plan.item.record, plan.item.topicRef,
          );
          if (sameValue(nextRecord, current.record)) return current;
          return { ...current, record: nextRecord,
            lastMigrationMutationId: `migration-reconcile-${migration.documentId}`,
            updatedAt: nowIso(deps.now) };
        });
      }
    }

    async function reconcileMigration(storage, envelope, migration) {
      const established = new Set(Array.isArray(envelope.legacyManagedTopicKeys)
        ? envelope.legacyManagedTopicKeys : placements(envelope.viewDocument).map(item => topicKey(item.topicRef)));
      const migrationKeys = migration.topicRecords.map(item => topicKey(item.topicRef));
      const newTopicKeys = new Set(migrationKeys.filter(key => !established.has(key)));
      migration._baselineTopicRecords = clone(envelope.legacyBaseline?.topicRecords || {});
      const topicPlans = await planMigratedTopics(storage, envelope, migration);
      const baselineView = envelope.legacyBaseline?.viewDocument || null;
      // Complete all deterministic conflict checks before the first write so
      // one conflicting topic cannot leave unrelated topics half-updated.
      mergeMigratedViewDocument(envelope.viewDocument, migration.viewDocument, baselineView, newTopicKeys);
      await applyMigratedTopicPlans(storage, migration, topicPlans);
      let reconciled;
      let changed = false;
      await casJson(storage, viewPath(envelope.documentId), {}, (current) => {
        if (current.documentId !== envelope.documentId) throw error('トピック表示のIDが競合しました', 409, 'conflict');
        const viewDocument = mergeMigratedViewDocument(
          current.viewDocument, migration.viewDocument, baselineView, newTopicKeys,
        );
        const legacyManagedTopicKeys = [...new Set([
          ...(current.legacyManagedTopicKeys || established), ...migrationKeys,
        ])];
        const legacyBaseline = {
          topicRecords: Object.fromEntries(migration.topicRecords.map(item => [
            topicKey(item.topicRef), clone(item.record),
          ])),
          viewDocument: clone(migration.viewDocument),
        };
        if (sameValue(viewDocument, current.viewDocument)
            && sameValue(legacyManagedTopicKeys, current.legacyManagedTopicKeys || [])
            && sameValue(legacyBaseline, current.legacyBaseline || {})
            && !topicPlans.some(plan => plan.kind === 'create' || plan.kind === 'update')) {
          reconciled = current; return false;
        }
        changed = true;
        const revision = Number(current.checkpoint?.revision || 0) + 1;
        const checkpointId = `cp-reconcile-${encode(envelope.documentId)}-${revision}`;
        reconciled = { ...current, viewDocument, legacyManagedTopicKeys, legacyBaseline,
          checkpoint: { id: checkpointId, checkpointId, revision, updatedAt: nowIso(deps.now) },
          updatedAt: nowIso(deps.now) };
        return reconciled;
      });
      if (changed) await registerView(storage, reconciled);
      return readView(storage, envelope.documentId);
    }

    async function persistMigration(storage, migration) {
      for (const item of migration.topicRecords) {
        await putNewTopic(storage, item.topicRef, item.record, `migration-${migration.documentId}`);
      }
      const path = viewPath(migration.documentId);
      await casJson(storage, path, {}, current => {
        if (current.documentId) return current;
        return { schemaVersion: 1, documentId: migration.documentId, sourceId: migration.sourceId,
          relativePath: migration.relativePath, label: migration.relativePath,
          legacyPath: migration.relativePath, archiveRelativePath: migration.archiveRelativePath,
          legacyManagedTopicKeys: migration.topicRecords.map(item => topicKey(item.topicRef)),
          legacyBaseline: {
            topicRecords: Object.fromEntries(migration.topicRecords.map(item => [
              topicKey(item.topicRef), clone(item.record),
            ])),
            viewDocument: clone(migration.viewDocument),
          },
          viewDocument: migration.viewDocument, checkpoint: migration.checkpoint,
          createdAt: nowIso(deps.now), updatedAt: nowIso(deps.now) };
      });
      const envelope = await readView(storage, migration.documentId);
      await registerView(storage, envelope);
      return envelope;
    }

    async function openMigration(storage, body) {
      const sourceId = required(body?.sourceId, 'sourceId');
      const relativePath = normalizePath(body?.relativePath);
      const registry = await readRegistry(storage);
      const existing = Object.values(registry.documents || {}).find(item => (
        item.sourceId === sourceId && item.relativePath === relativePath
      ));
      const migration = await loadMigration(sourceId, relativePath);
      if (body?.migrationPreview === true) {
        return { mode: 'migration-preview', sourceId, preview: migration };
      }
      if (existing) {
        let envelope = await readView(storage, existing.documentId);
        envelope = await reconcileMigration(storage, envelope, migration);
        return migrationResponse(envelope, await snapshot(storage, envelope));
      }
      const envelope = await persistMigration(storage, migration);
      return migrationResponse(envelope, migration);
    }

    function migrationResponse(envelope, preview) {
      const relative = envelope.archiveRelativePath
        || archiveRelativePath(envelope.documentId, envelope.viewDocument.defaultSurface);
      return { mode: 'migration', sourceId: envelope.sourceId, migration: {
        ok: true, status: 'complete', sourceId: envelope.sourceId,
        legacyPath: envelope.legacyPath || envelope.relativePath,
        archiveRelativePath: relative, documentId: envelope.documentId,
        viewDocument: envelope.viewDocument, checkpoint: envelope.checkpoint,
        checkpointId: envelope.checkpoint?.checkpointId || envelope.checkpoint?.id,
        legacyOriginalModified: false,
      }, preview };
    }

    async function openRegisteredView(storage, body) {
      const sourceId = required(body?.sourceId, 'sourceId');
      const relativePath = normalizePath(body?.relativePath);
      const registry = await readRegistry(storage);
      const registered = Object.values(registry.documents || {}).find(item => (
        item.sourceId === sourceId && (item.archiveRelativePath === relativePath
          || item.relativePath === relativePath)
      ));
      if (!registered) throw error('登録済みのトピック表示が見つかりません', 404, 'missing');
      const envelope = await readView(storage, registered.documentId);
      return { mode: 'archive', documentId: envelope.documentId,
        defaultSurface: envelope.viewDocument.defaultSurface,
        viewDocument: envelope.viewDocument, checkpoint: envelope.checkpoint,
        readOnly: isReadOnly(), legacy: false, assets: [] };
    }

    async function snapshot(storage, envelope) {
      const refs = envelope.viewDocument.membership?.manualTopicRefs || [];
      const topics = [];
      for (const ref of refs) {
        try {
          const topic = await readTopic(storage, ref);
          topics.push({ topicRef: topic.topicRef, record: topic.record });
        } catch (reason) {
          if (Number(reason?.status) !== 404) throw reason;
        }
      }
      return { ok: true, documentId: envelope.documentId, viewDocument: envelope.viewDocument,
        checkpoint: envelope.checkpoint, topics, topicRecords: topics, readOnly: isReadOnly() };
    }

    async function propertyCandidates(storage, url) {
      const name = String(url.searchParams.get('name') || '').trim();
      const type = global.MeldexTopicPropertyFamily?.canonicalType?.(
        url.searchParams.get('column_type') || 'unknown',
      ) || String(url.searchParams.get('column_type') || 'unknown');
      const candidates = [];
      for (const envelope of await allViewEnvelopes(storage)) {
        const views = [...(envelope.viewDocument.sheetViews || []), ...(envelope.viewDocument.boardViews || [])];
        for (const view of views) {
          for (const column of (view.columns || [])) {
            const columnName = String(column.name || column.label || column.id || '');
            const columnType = global.MeldexTopicPropertyFamily?.canonicalType?.(
              column.columnType || column.type || 'unknown',
            ) || String(column.columnType || column.type || 'unknown');
            if (columnName !== name || columnType !== type) continue;
            const propertyFamilyId = column.propertyFamilyId || stableId('property', envelope.documentId,
              column.id || column.columnId || columnName);
            let existingValueCount = 0;
            for (const ref of (envelope.viewDocument.membership?.manualTopicRefs || [])) {
              try {
                const topic = await readTopic(storage, ref);
                if (Object.prototype.hasOwnProperty.call(topic.record.propertyValuesByFamilyId || {}, propertyFamilyId)) {
                  existingValueCount += 1;
                }
              } catch (reason) {
                if (Number(reason?.status) !== 404) throw reason;
              }
            }
            candidates.push({ documentId: envelope.documentId, documentLabel: envelope.label || envelope.relativePath,
              viewId: view.viewId || view.sheetViewId || view.boardViewId,
              columnId: column.id || column.columnId || columnName, columnName, columnType,
              propertyFamilyId, existingValueCount });
          }
        }
      }
      return { ok: true, candidates };
    }

    async function route({ method, body, url, pathname }) {
      let match;
      if (pathname === '/topic-migrations/open' && method === 'POST') {
        return openMigration(await provider(body?.migrationPreview ? 'read' : 'readwrite'), body || {});
      }
      if (pathname === '/topic-views/migration/open' && method === 'POST') {
        return openRegisteredView(await provider('read'), body || {});
      }
      if ((match = pathname.match(/^\/topic-views\/([^/]+)$/)) && method === 'GET') {
        const envelope = await readView(await provider('read'), decodeURIComponent(match[1]));
        return { ok: true, viewDocument: envelope.viewDocument, checkpoint: envelope.checkpoint,
          readOnly: isReadOnly() };
      }
      if ((match = pathname.match(/^\/topic-views\/([^/]+)\/snapshot$/)) && method === 'GET') {
        const storage = await provider('read');
        return snapshot(storage, await readView(storage, decodeURIComponent(match[1])));
      }
      if ((match = pathname.match(/^\/topic-views\/([^/]+)$/)) && method === 'PATCH') {
        const storage = await provider('readwrite');
        const documentId = decodeURIComponent(match[1]);
        const changes = body?.changes && typeof body.changes === 'object' ? body.changes : {};
        const envelope = await writeView(storage, documentId, body?.baseCheckpointId,
          required(body?.mutationId, 'mutationId'), document => ({ ...document, ...clone(changes), documentId }));
        return { ok: true, viewDocument: envelope.viewDocument, checkpoint: envelope.checkpoint };
      }
      if ((match = pathname.match(/^\/topic-stores\/([^/]+)\/topics\/([^/]+)$/))) {
        const ref = normalizeRef({ sourceId: decodeURIComponent(match[1]), topicId: decodeURIComponent(match[2]) });
        if (method === 'GET') {
          const topic = await readTopic(await provider('read'), ref);
          return { ok: true, topicRef: ref, topic: topic.record, record: topic.record };
        }
        if (method === 'PATCH') return patchTopic(await provider('readwrite'), ref, body || {});
        if (method === 'DELETE') return duplicateTrash.remove(await provider('readwrite'), ref, body || {});
      }
      if ((match = pathname.match(/^\/topic-stores\/([^/]+)\/trash\/([^/]+)\/restore$/))
          && method === 'POST') {
        const ref = normalizeRef({ sourceId: decodeURIComponent(match[1]), topicId: decodeURIComponent(match[2]) });
        return duplicateTrash.restore(await provider('readwrite'), ref, body || {});
      }
      if ((match = pathname.match(/^\/topics\/([^/]+)\/([^/]+)\/usages$/)) && method === 'GET') {
        return topicUsages(await provider('read'), normalizeRef({
          sourceId: decodeURIComponent(match[1]), topicId: decodeURIComponent(match[2]),
        }));
      }
      if (pathname === '/topic-property-families/candidates' && method === 'GET') {
        return propertyCandidates(await provider('read'), url);
      }
      if (pathname === '/topic-placements/prepare' && method === 'POST') {
        return preparePlacement(await provider('readwrite'), body || {});
      }
      if (pathname === '/topic-placements/commit' && method === 'POST') {
        return commitPlacement(await provider('readwrite'), body || {});
      }
      return deps.NOT_HANDLED;
    }

    return route;
  }

  const api = Object.freeze({ createHandler, garbageCollectTransactions, ROOT, PREPARE_TTL_MS,
    RECEIPT_RETENTION_MS: global.MeldexTopicCloudTransactionGC?.RETENTION_MS,
    MAX_COMMITTED_RECEIPTS: global.MeldexTopicCloudTransactionGC?.MAX_COMMITTED,
    TRANSACTION_INDEX_PATH });
  global.MeldexTopicCloudDataAccess = api;
  const handlers = global.__MeldexPwaDataAccessExtensions;
  if (Array.isArray(handlers) && global.__MeldexPwaDataAccessInternals) handlers.push(createHandler());
}(typeof globalThis !== 'undefined' ? globalThis : window));
