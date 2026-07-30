/* タグツリーのタグ並べ替え。辞書への保存は一括APIで原子的に行う。 */
(function () {
  'use strict';

  let saving = false;

  function compareByOrder(a, b) {
    return Number(a?.sort_index || 0) - Number(b?.sort_index || 0)
      || String(a?.name || '').localeCompare(String(b?.name || ''), 'ja');
  }

  function clearDropState(element) {
    element?.classList?.remove('is-drop-before', 'is-drop-after', 'is-drop-target');
    if (element?.dataset) delete element.dataset.tagDropPlacement;
  }

  function uniqueDraggedTags(items, state, excludedId) {
    const byId = new Map((state?.tags || []).map(tag => [String(tag?.id || ''), tag]));
    const seen = new Set();
    const tags = [];
    for (const item of items || []) {
      const id = String(item?.id || '');
      if (item?.kind !== 'tag' || !id || id === excludedId || seen.has(id)) continue;
      const tag = byId.get(id);
      if (!tag) continue;
      seen.add(id);
      tags.push(tag);
    }
    return tags;
  }

  function updatesForInsertion(state, movingTags, targetGroupId, targetTagId, placement) {
    const movingIds = new Set(movingTags.map(tag => String(tag.id)));
    const normalizedGroupId = targetGroupId || null;
    const siblings = (state.tags || [])
      .filter(tag => (tag.group_id || null) === normalizedGroupId && !movingIds.has(String(tag.id)))
      .sort(compareByOrder);
    let insertIndex = siblings.length;
    if (targetTagId) {
      const targetIndex = siblings.findIndex(tag => String(tag.id) === String(targetTagId));
      if (targetIndex < 0) return [];
      insertIndex = targetIndex + (placement === 'after' ? 1 : 0);
    }
    siblings.splice(insertIndex, 0, ...movingTags);
    return siblings.map((tag, index) => ({
      id: String(tag.id),
      group_id: normalizedGroupId,
      sort_index: (index + 1) * 10,
    })).filter(update => {
      const current = (state.tags || []).find(tag => String(tag.id) === update.id);
      return (current?.group_id || null) !== normalizedGroupId
        || Number(current?.sort_index || 0) !== update.sort_index;
    });
  }

  function applyUpdates(tags, updates) {
    const patches = new Map(updates.map(update => [String(update.id), update]));
    return (tags || []).map(tag => {
      const patch = patches.get(String(tag?.id || ''));
      return patch ? { ...tag, ...patch } : tag;
    });
  }

  async function saveInsertion(items, targetGroupId, targetTagId, placement, options) {
    const state = options?.getState?.();
    const api = options?.getApi?.();
    if (!state || !api?.updateTagOrder || state.mutationBlocked || saving) return false;
    const movingTags = uniqueDraggedTags(items, state, targetTagId || '');
    if (!movingTags.length) return false;
    const updates = updatesForInsertion(
      state,
      movingTags,
      targetGroupId,
      targetTagId,
      placement,
    );
    if (!updates.length) return false;
    const previousTags = state.tags.map(tag => ({ ...tag }));
    const sourceFolder = String(state.sourceFolder || '');
    state.tags = applyUpdates(state.tags, updates);
    saving = true;
    options.render?.();
    try {
      const result = await api.updateTagOrder(updates, sourceFolder);
      if (String(options.getState?.()?.sourceFolder || '') !== sourceFolder) return true;
      if (Array.isArray(result?.tags)) state.tags = result.tags;
      if (Array.isArray(result?.groups)) state.groups = result.groups;
      options.render?.();
      if (typeof showStatus === 'function') showStatus('タグの表示順を保存しました');
      return true;
    } catch (error) {
      if (String(options.getState?.()?.sourceFolder || '') === sourceFolder) {
        state.tags = previousTags;
        options.render?.();
        options.reportError?.(error, 'タグの表示順を保存できませんでした');
      }
      return false;
    } finally {
      saving = false;
    }
  }

  function bindTagDropTarget(row, targetTag, options) {
    row.addEventListener('dragover', event => {
      const state = options?.getState?.();
      const items = options?.readItems?.(event) || [];
      const movingTags = uniqueDraggedTags(items, state, String(targetTag?.id || ''));
      if (!movingTags.length || movingTags.length !== items.length) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      clearDropState(row);
      const rect = row.getBoundingClientRect();
      const placement = Number.isFinite(event.clientY) && rect.height
        && (event.clientY - rect.top) / rect.height > 0.5
        ? 'after'
        : 'before';
      row.dataset.tagDropPlacement = placement;
      row.classList.add(placement === 'after' ? 'is-drop-after' : 'is-drop-before');
    });
    row.addEventListener('dragleave', event => {
      if (!event.relatedTarget || !row.contains(event.relatedTarget)) clearDropState(row);
    });
    row.addEventListener('drop', event => {
      const items = options?.readItems?.(event) || [];
      const state = options?.getState?.();
      const movingTags = uniqueDraggedTags(items, state, String(targetTag?.id || ''));
      if (!movingTags.length || movingTags.length !== items.length) return;
      event.preventDefault();
      event.stopPropagation();
      const placement = row.dataset.tagDropPlacement || 'before';
      clearDropState(row);
      void saveInsertion(
        items,
        targetTag?.group_id || null,
        targetTag?.id || '',
        placement,
        options,
      );
    });
  }

  function moveTagsToGroup(items, targetGroupId, options) {
    return saveInsertion(items, targetGroupId || null, '', 'after', options);
  }

  window.MeldexTagTreeDnD = {
    bindTagDropTarget,
    moveTagsToGroup,
    isSaving: () => saving,
  };
})();
