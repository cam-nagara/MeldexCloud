(function () {
  'use strict';

  let ensureKey = '';
  let ensureStatus = 'idle';
  let assignedCache = null;
  let indexTags = null;
  let indexGroups = null;
  let indexedTagsByGroup = null;

  function targetItems() {
    const selected = typeof _folderSelectedItems !== 'undefined' && Array.isArray(_folderSelectedItems)
      ? _folderSelectedItems.filter(item => item?.path && item.type !== 'folder')
      : [];
    if (selected.length) return selected;
    return typeof _folderItems !== 'undefined' && Array.isArray(_folderItems)
      ? _folderItems.filter(item => item?.path && item.type !== 'folder')
      : [];
  }

  function assignedTagKeys(items) {
    if (!items && assignedCache) return assignedCache;
    const keys = new Set();
    (items || targetItems()).forEach(item => {
      const tags = typeof _folderItemTags === 'function' ? _folderItemTags(item) : [];
      (Array.isArray(tags) ? tags : []).forEach(tag => {
        if (tag?.id) keys.add('id:' + String(tag.id));
        if (tag?.name) keys.add('name:' + String(tag.name).toLocaleLowerCase('ja'));
      });
    });
    if (!items) assignedCache = keys;
    return keys;
  }

  function ensureCatalogIndex(tags, groups) {
    if (tags === indexTags && groups === indexGroups && indexedTagsByGroup) return indexedTagsByGroup;
    const children = new Map();
    (groups || []).forEach(group => {
      const parentId = String(group?.parent_id || '');
      const values = children.get(parentId) || [];
      values.push(String(group?.id || ''));
      children.set(parentId, values);
    });
    const direct = new Map();
    (tags || []).forEach(tag => {
      const groupId = String(tag?.group_id || '');
      const values = direct.get(groupId) || [];
      values.push(tag);
      direct.set(groupId, values);
    });
    const memo = new Map();
    const collect = (groupId, visiting = new Set()) => {
      const id = String(groupId || '');
      if (memo.has(id)) return memo.get(id);
      if (visiting.has(id)) return direct.get(id) || [];
      const nextVisiting = new Set(visiting);
      nextVisiting.add(id);
      const values = [...(direct.get(id) || [])];
      (children.get(id) || []).forEach(childId => values.push(...collect(childId, nextVisiting)));
      memo.set(id, values);
      return values;
    };
    (groups || []).forEach(group => collect(group?.id));
    memo.set('', direct.get('') || []);
    indexTags = tags;
    indexGroups = groups;
    indexedTagsByGroup = memo;
    return memo;
  }

  function descendantGroupIds(groups, groupId) {
    const target = String(groupId || '');
    if (!target) return new Set(['']);
    const ids = new Set([target]);
    let changed = true;
    while (changed) {
      changed = false;
      (groups || []).forEach(group => {
        const id = String(group?.id || '');
        if (!id || ids.has(id) || !ids.has(String(group?.parent_id || ''))) return;
        ids.add(id);
        changed = true;
      });
    }
    return ids;
  }

  function get(tags, groups, groupId) {
    const assigned = assignedTagKeys();
    const groupTags = ensureCatalogIndex(tags, groups).get(String(groupId || '')) || [];
    const assignedCount = groupTags.filter(tag => (
      (tag?.id && assigned.has('id:' + String(tag.id)))
      || (tag?.name && assigned.has('name:' + String(tag.name).toLocaleLowerCase('ja')))
    )).length;
    return {
      assigned: ensureStatus === 'loading' || ensureStatus === 'error' ? '–' : assignedCount,
      total: groupTags.length,
      status: ensureStatus,
    };
  }

  function ensure(onReady) {
    const items = targetItems();
    if (!items.length || typeof _folderEnsureTags !== 'function') return;
    const key = items.map(item => String(item.path)).sort().join('\n');
    if (key === ensureKey) return;
    ensureKey = key;
    if (items.every(item => Array.isArray(item?._folderTags))) {
      ensureStatus = 'ready';
      assignedCache = null;
      return;
    }
    ensureStatus = 'loading';
    assignedCache = null;
    Promise.resolve(_folderEnsureTags(items)).then(() => {
      if (ensureKey !== key) return;
      ensureStatus = 'ready';
      assignedCache = null;
      onReady?.({ ok: true });
    }).catch(() => {
      if (ensureKey !== key) return;
      ensureStatus = 'error';
      assignedCache = null;
      onReady?.({ ok: false });
    });
  }

  function invalidate() {
    ensureKey = '';
    ensureStatus = 'idle';
    assignedCache = null;
  }

  window.MeldexTagGroupSummary = {
    assignedTagKeys,
    descendantGroupIds,
    ensure,
    get,
    invalidate,
    targetItems,
  };
})();
