(function initMeldexTopicCloudDuplicateTrash(global) {
  'use strict';

  function create(options) {
    const trashPath = ref => `${options.root}/trash/${options.encode(ref.sourceId)}/${options.encode(ref.topicId)}.json`;

    async function remove(storage, ref, body) {
      const operationId = String(body?.undoDuplicateOperationId || '');
      const mutationId = String(body?.mutationId || '');
      if (!operationId || !mutationId) {
        throw options.error('複製Undoの操作IDがありません', 400, 'invalid_request');
      }
      const path = trashPath(ref);
      const saved = await options.optionalJson(storage, path, null);
      let current = await options.optionalJson(storage, options.topicPath(ref), null);
      if (!current?.record && saved?.record && saved.createdByMutationId === operationId
          && saved.trashMutationId === mutationId) {
        return { ok: true, topicRef: ref, deleted: true, idempotent: true };
      }
      if (!current?.record || current.createdByMutationId !== operationId) {
        throw options.error('複製操作の正本を確認できないためUndoできません', 409, 'conflict');
      }
      const usages = await options.topicUsages(storage, ref);
      if (usages.usages.some(item => item.kind === 'placement')) {
        throw options.error('複製トピックがまだ登録中のためUndoできません', 409, 'conflict');
      }
      await options.casJson(storage, path, {}, previous => {
        if (previous.record) {
          if (previous.createdByMutationId !== operationId || previous.trashMutationId !== mutationId) {
            throw options.error('別の削除操作と競合しています', 409, 'conflict');
          }
          return previous;
        }
        return { ...current, trashMutationId: mutationId };
      });
      await storage.deletePath(options.topicPath(ref));
      return { ok: true, topicRef: ref, deleted: true, idempotent: false };
    }

    async function restore(storage, ref, body) {
      const saved = await options.optionalJson(storage, trashPath(ref), null);
      if (!saved?.record) {
        const existing = await options.optionalJson(storage, options.topicPath(ref), null);
        if (existing?.record) return { ok: true, topicRef: ref, record: existing.record, idempotent: true };
        throw options.error('復元する複製トピックが見つかりません', 404, 'missing');
      }
      const mutationId = String(body?.mutationId || '');
      if (!mutationId) throw options.error('mutationId は必須です', 400, 'invalid_request');
      await options.casJson(storage, options.topicPath(ref), {}, current => {
        if (current.record) return current;
        return { ...saved, lastMutationId: mutationId };
      });
      await storage.deletePath(trashPath(ref));
      return { ok: true, topicRef: ref, record: saved.record };
    }

    async function discard(storage, ref, operationId) {
      const current = await options.optionalJson(storage, options.topicPath(ref), null);
      if (!current?.record) return { ok: true, topicRef: ref, discarded: true, idempotent: true };
      if (!operationId || current.createdByMutationId !== operationId) {
        throw options.error('未完了の複製操作を確認できません', 409, 'conflict');
      }
      const usages = await options.topicUsages(storage, ref);
      if (usages.usages.some(item => item.kind === 'placement')) {
        throw options.error('未完了の複製トピックがまだ登録中です', 409, 'conflict');
      }
      await storage.deletePath(options.topicPath(ref));
      const saved = await options.optionalJson(storage, trashPath(ref), null);
      if (saved?.createdByMutationId === operationId) await storage.deletePath(trashPath(ref));
      return { ok: true, topicRef: ref, discarded: true, idempotent: false };
    }

    return Object.freeze({ remove, restore, discard });
  }

  global.MeldexTopicCloudDuplicateTrash = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
