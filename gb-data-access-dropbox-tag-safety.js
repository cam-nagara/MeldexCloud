/* Safety helpers for Dropbox tag dictionary and assignment mutations. */
(function () {
  'use strict';

  function sameJsonValue(left, right) {
    return left === right || JSON.stringify(left) === JSON.stringify(right);
  }

  function reverseCatalogRows(currentRows, beforeRows, publishedRows) {
    const missing = Symbol('missing');
    const currentById = new Map((currentRows || []).map(row => [row.id, row]));
    const beforeById = new Map((beforeRows || []).map(row => [row.id, row]));
    const publishedById = new Map((publishedRows || []).map(row => [row.id, row]));
    const ids = new Set([
      ...currentById.keys(),
      ...beforeById.keys(),
      ...publishedById.keys(),
    ]);
    const rows = [];
    let unresolved = false;
    ids.forEach(id => {
      const current = currentById.has(id) ? currentById.get(id) : missing;
      const before = beforeById.has(id) ? beforeById.get(id) : missing;
      const published = publishedById.has(id) ? publishedById.get(id) : missing;
      if (before === missing && published !== missing) {
        if (current === missing || sameJsonValue(current, published)) return;
        rows.push(structuredClone(current));
        unresolved = true;
        return;
      }
      if (before !== missing && published === missing) {
        rows.push(structuredClone(current === missing ? before : current));
        return;
      }
      if (current === missing) return;
      if (before === missing || published === missing) {
        rows.push(structuredClone(current));
        unresolved = true;
        return;
      }
      const restored = {};
      const fields = new Set([
        ...Object.keys(current),
        ...Object.keys(before),
        ...Object.keys(published),
      ]);
      fields.forEach(field => {
        const currentValue = Object.prototype.hasOwnProperty.call(current, field)
          ? current[field]
          : missing;
        const beforeValue = Object.prototype.hasOwnProperty.call(before, field)
          ? before[field]
          : missing;
        const publishedValue = Object.prototype.hasOwnProperty.call(published, field)
          ? published[field]
          : missing;
        let selected = currentValue;
        if (!sameJsonValue(beforeValue, publishedValue)) {
          if (sameJsonValue(currentValue, publishedValue)) selected = beforeValue;
          else if (!sameJsonValue(currentValue, beforeValue)) unresolved = true;
        }
        if (selected !== missing) restored[field] = structuredClone(selected);
      });
      rows.push(restored);
    });
    return { rows, unresolved };
  }

  function reverseCatalogPublish(current, before, published, normalizeCatalog, nowIso) {
    const empty = { version: 1, tags: [], groups: [] };
    const live = normalizeCatalog(current || empty);
    const old = normalizeCatalog(before || empty);
    const sent = normalizeCatalog(published || empty);
    const tags = reverseCatalogRows(live.tags, old.tags, sent.tags);
    const groups = reverseCatalogRows(live.groups, old.groups, sent.groups);
    return {
      catalog: normalizeCatalog({
        ...live,
        tags: tags.rows,
        groups: groups.rows,
        updated_at: nowIso(),
      }),
      unresolved: tags.unresolved || groups.unresolved,
    };
  }

  function reverseAssignmentIds(current, before, published) {
    if (![current, before, published].every(Array.isArray)) {
      return { value: current, unresolved: true };
    }
    const currentIds = [...new Set(current.map(String))];
    const beforeIds = new Set(before.map(String));
    const publishedIds = new Set(published.map(String));
    const addedByPublish = new Set([...publishedIds].filter(id => !beforeIds.has(id)));
    const removedByPublish = [...beforeIds].filter(id => !publishedIds.has(id));
    const restored = currentIds.filter(id => !addedByPublish.has(id));
    removedByPublish.forEach(id => {
      if (!restored.includes(id)) restored.push(id);
    });
    return { value: restored, unresolved: false };
  }

  function reverseAssignments(current, before, published) {
    const missing = Symbol('missing');
    const restored = { ...(current || {}) };
    let unresolved = false;
    const paths = new Set([
      ...Object.keys(current || {}),
      ...Object.keys(before || {}),
      ...Object.keys(published || {}),
    ]);
    paths.forEach(path => {
      const currentValue = Object.prototype.hasOwnProperty.call(current || {}, path)
        ? current[path]
        : missing;
      const beforeValue = Object.prototype.hasOwnProperty.call(before || {}, path)
        ? before[path]
        : missing;
      const publishedValue = Object.prototype.hasOwnProperty.call(published || {}, path)
        ? published[path]
        : missing;
      if (beforeValue === missing && publishedValue !== missing) {
        if (currentValue === missing || sameJsonValue(currentValue, publishedValue)) {
          delete restored[path];
        } else {
          const reversed = reverseAssignmentIds(currentValue, [], publishedValue);
          unresolved = unresolved || reversed.unresolved;
          if (reversed.value?.length) restored[path] = reversed.value;
          else delete restored[path];
        }
        return;
      }
      if (beforeValue !== missing && publishedValue === missing) {
        const reversed = reverseAssignmentIds(
          currentValue === missing ? [] : currentValue,
          beforeValue,
          [],
        );
        unresolved = unresolved || reversed.unresolved;
        if (reversed.value.length) restored[path] = reversed.value;
        else delete restored[path];
        return;
      }
      if (currentValue === missing || beforeValue === missing || publishedValue === missing) {
        unresolved = true;
        return;
      }
      const reversed = reverseAssignmentIds(currentValue, beforeValue, publishedValue);
      unresolved = unresolved || reversed.unresolved;
      if (reversed.value.length) restored[path] = reversed.value;
      else delete restored[path];
    });
    return { assignments: restored, unresolved };
  }

  function normalizeAssignmentStore(value) {
    const source = value && typeof value === 'object' ? value : {};
    const assignments = source.assignments && typeof source.assignments === 'object'
      ? { ...source.assignments }
      : {};
    const rawAuto = source.auto_assignments && typeof source.auto_assignments === 'object'
      ? source.auto_assignments
      : {};
    const autoAssignments = {};
    Object.entries(assignments).forEach(([path, ids]) => {
      const assigned = Array.isArray(ids)
        ? [...new Set(ids.map(id => String(id ?? '').trim()).filter(Boolean))]
        : [];
      const allowed = new Set(assigned);
      const auto = Array.isArray(rawAuto[path])
        ? [...new Set(rawAuto[path].map(id => String(id ?? '').trim()).filter(Boolean))]
          .filter(id => allowed.has(id))
        : [];
      if (assigned.length) assignments[path] = assigned;
      else delete assignments[path];
      if (auto.length) autoAssignments[path] = auto;
    });
    const normalized = {
      ...source,
      version: 5,
      assignments,
      auto_assignments: autoAssignments,
    };
    return window.MeldexDropboxAssetIdentity?.normalizeStore?.(normalized) || normalized;
  }

  function promoteManualTag(store, path, tagId) {
    const current = normalizeAssignmentStore(store);
    current.assignments[path] = [...new Set([...(current.assignments[path] || []), tagId])];
    const auto = (current.auto_assignments[path] || []).filter(id => id !== tagId);
    if (auto.length) current.auto_assignments[path] = auto;
    else delete current.auto_assignments[path];
    return current;
  }

  function setManualTags(store, path, ids) {
    const current = normalizeAssignmentStore(store);
    const next = [...new Set((ids || []).map(String))];
    if (next.length) current.assignments[path] = next;
    else delete current.assignments[path];
    delete current.auto_assignments[path];
    return current;
  }

  function removeTargetTag(store, path, tagId) {
    const current = normalizeAssignmentStore(store);
    const assigned = (current.assignments[path] || []).filter(id => id !== tagId);
    const auto = (current.auto_assignments[path] || []).filter(id => id !== tagId);
    if (assigned.length) current.assignments[path] = assigned;
    else delete current.assignments[path];
    if (auto.length) current.auto_assignments[path] = auto;
    else delete current.auto_assignments[path];
    return current;
  }

  function removeTagEverywhere(store, tagId) {
    const current = normalizeAssignmentStore(store);
    Object.keys(current.assignments).forEach(path => {
      const assigned = current.assignments[path].filter(id => id !== tagId);
      const auto = (current.auto_assignments[path] || []).filter(id => id !== tagId);
      if (assigned.length) current.assignments[path] = assigned;
      else delete current.assignments[path];
      if (auto.length) current.auto_assignments[path] = auto;
      else delete current.auto_assignments[path];
    });
    return current;
  }

  function reverseAssignmentStore(current, before, published) {
    const currentStore = normalizeAssignmentStore(current);
    const beforeStore = normalizeAssignmentStore(before);
    const publishedStore = normalizeAssignmentStore(published);
    const assigned = reverseAssignments(
      currentStore.assignments,
      beforeStore.assignments,
      publishedStore.assignments,
    );
    const auto = reverseAssignments(
      currentStore.auto_assignments,
      beforeStore.auto_assignments,
      publishedStore.auto_assignments,
    );
    return {
      store: normalizeAssignmentStore({
        ...currentStore,
        assignments: assigned.assignments,
        auto_assignments: auto.assignments,
      }),
      unresolved: assigned.unresolved || auto.unresolved,
    };
  }

  async function pruneRecoveryFiles(provider, directory, listEntries, removeEntry, keep = 12) {
    if (typeof listEntries !== 'function' || typeof removeEntry !== 'function') return;
    try {
      const entries = await listEntries(provider, directory);
      const generationTime = entry => {
        const name = String(entry?.name || '');
        const python = name.match(/(?:^|\D)(\d{8})-(\d{6})-(\d{6})(?:\D|$)/);
        if (python) {
          const [, date, clock, micros] = python;
          const parsed = new Date(
            Number(date.slice(0, 4)),
            Number(date.slice(4, 6)) - 1,
            Number(date.slice(6, 8)),
            Number(clock.slice(0, 2)),
            Number(clock.slice(2, 4)),
            Number(clock.slice(4, 6)),
            Math.floor(Number(micros) / 1000),
          ).getTime();
          if (Number.isFinite(parsed)) return parsed;
        }
        const cloud = name.match(/(?:^|\D)(\d{13})(?:\D|$)/);
        if (cloud) return Number(cloud[1]);
        const serverModified = Date.parse(String(entry?.server_modified || entry?.serverModified || ''));
        return Number.isFinite(serverModified) ? serverModified : 0;
      };
      const stale = (Array.isArray(entries) ? entries : [])
        .filter(entry => /\.json$/i.test(String(entry?.name || '')))
        .sort((left, right) => generationTime(right) - generationTime(left)
          || String(right?.name || '').localeCompare(String(left?.name || '')))
        .slice(Math.max(0, keep));
      for (const entry of stale) {
        try {
          await removeEntry(provider, `${directory}/${String(entry.name || '')}`);
        } catch (error) {
          console.warn('自動タグ辞書の古い復旧データを削除できませんでした', error);
        }
      }
    } catch (error) {
      console.warn('自動タグ辞書の復旧データを整理できませんでした', error);
    }
  }

  async function rollbackCreatedCatalogTags(provider, options) {
    const created = Array.isArray(options.created) ? options.created : [];
    if (!created.length) return { ok: true, current: null };
    if (typeof provider.writeJsonMerged !== 'function') {
      return { ok: false, current: null, reason: '安全な同時更新を利用できません' };
    }
    const compensationId = options.randomId();
    let ownsBlock = false;
    try {
      await provider.writeJsonMerged(options.markerPath, current => {
        if (current?.active) return current;
        ownsBlock = true;
        return {
          ...(current && typeof current === 'object' ? current : {}),
          version: 1,
          active: true,
          conflict_id: compensationId,
          kind: 'target-tag-compensation',
          warning: 'タグ保存の取り消しを確認しています。完了するまでタグを編集できません。',
          updated_at: options.nowIso(),
        };
      }, {
        fallbackValue: { version: 1, active: false },
        retries: 5,
      });
    } catch (error) {
      return { ok: false, current: null, reason: `編集を安全に停止できません: ${error?.message || error}` };
    }
    const assignmentStore = await options.readJson(
      provider,
      options.assignmentsPath,
      { assignments: {} },
    );
    const referenced = new Set(
      Object.values(assignmentStore?.assignments || {}).flatMap(
        value => Array.isArray(value) ? value.map(String) : [],
      ),
    );
    if (created.some(tag => referenced.has(String(tag.id)))) {
      return { ok: false, current: null, reason: '作成したタグが別の割当に使われています' };
    }
    let unresolved = false;
    let currentSnapshot = null;
    await provider.writeJsonMerged(options.catalogPath, current => {
      currentSnapshot = structuredClone(current || {});
      const catalog = options.normalizeCatalog(current || { tags: [], groups: [] });
      const createdById = new Map(created.map(tag => [String(tag.id), tag]));
      catalog.tags = catalog.tags.filter(tag => {
        const expected = createdById.get(String(tag.id));
        if (!expected) return true;
        if (sameJsonValue(tag, expected)) return false;
        unresolved = true;
        return true;
      });
      catalog.updated_at = options.nowIso();
      return catalog;
    }, {
      fallbackValue: { version: 1, updated_at: '', tags: [], groups: [] },
      retries: 5,
    });
    const afterAssignments = await options.readJson(
      provider,
      options.assignmentsPath,
      { assignments: {} },
    );
    const referencedAfter = new Set(
      Object.values(afterAssignments?.assignments || {}).flatMap(
        value => Array.isArray(value) ? value.map(String) : [],
      ),
    );
    if (created.some(tag => referencedAfter.has(String(tag.id)))) {
      await provider.writeJsonMerged(options.catalogPath, current => {
        const catalog = options.normalizeCatalog(current || { tags: [], groups: [] });
        const byId = new Set(catalog.tags.map(tag => String(tag.id)));
        created.forEach(tag => {
          if (!byId.has(String(tag.id))) catalog.tags.push(structuredClone(tag));
        });
        catalog.updated_at = options.nowIso();
        return catalog;
      }, {
        fallbackValue: { version: 1, updated_at: '', tags: [], groups: [] },
        retries: 5,
      });
      return {
        ok: false,
        current: currentSnapshot,
        reason: '取り消し中に作成したタグが別の割当に使われたため、タグを復元しました',
      };
    }
    if (ownsBlock && !unresolved) {
      await provider.writeJsonMerged(options.markerPath, current => (
        current?.active && String(current.conflict_id || '') === compensationId
          ? { ...current, active: false, updated_at: options.nowIso() }
          : current
      ), {
        fallbackValue: { version: 1, active: false },
        retries: 5,
      });
    }
    return unresolved
      ? { ok: false, current: currentSnapshot, reason: '作成したタグが同時に変更されています' }
      : { ok: true, current: currentSnapshot };
  }

  async function compensateCreatedTags(provider, options) {
    let rollback;
    try {
      rollback = await rollbackCreatedCatalogTags(provider, options);
    } catch (error) {
      rollback = { ok: false, current: null, reason: String(error?.message || error) };
    }
    if (rollback.ok) return;
    await options.ensureDirectory(provider, options.recoveryDirectory);
    const recoveryPath = `${options.recoveryDirectory}/${Date.now()}-${options.randomId().slice(0, 12)}-target-tag-rollback.json`;
    const payload = {
      version: 1,
      kind: 'target-tag-rollback',
      created_at: options.nowIso(),
      requires_edit_block: true,
      before: options.before,
      published: options.published,
      current: rollback.current,
      reason: rollback.reason,
    };
    if (typeof provider.writeJson === 'function') {
      await provider.writeJson(recoveryPath, payload);
    } else {
      await provider.writeText(recoveryPath, JSON.stringify(payload, null, 2) + '\n');
    }
    await options.pruneRecovery(provider);
    const warning = (
      'タグは保存された可能性があります。新しく作成したタグの自動取り消しを'
      + `完了できませんでした。復旧データ: ${recoveryPath}`
    );
    const markerValue = current => ({
      ...(current && typeof current === 'object' ? current : {}),
      version: 1,
      active: true,
      conflict_id: current?.active && current?.conflict_id
        ? current.conflict_id
        : options.randomId(),
      kind: 'target-tag-rollback',
      catalog_rollback_path: recoveryPath,
      warning,
      updated_at: options.nowIso(),
    });
    if (typeof provider.writeJsonMerged === 'function') {
      await provider.writeJsonMerged(options.markerPath, markerValue, {
        fallbackValue: { version: 1, active: false },
        retries: 5,
      });
    } else {
      const marker = markerValue(
        await options.readJson(provider, options.markerPath, null),
      );
      if (typeof provider.writeJson === 'function') {
        await provider.writeJson(options.markerPath, marker);
      } else {
        await provider.writeText(options.markerPath, JSON.stringify(marker, null, 2) + '\n');
      }
    }
    try {
      const cleared = { ...payload, requires_edit_block: false };
      if (typeof provider.writeJson === 'function') {
        await provider.writeJson(recoveryPath, cleared);
      } else {
        await provider.writeText(recoveryPath, JSON.stringify(cleared, null, 2) + '\n');
      }
    } catch {
      // The conflict marker is active, so retaining the recovery block is safe.
    }
    throw new Error(`${options.originalMessage || 'タグを保存できませんでした'} ${warning}`);
  }

  window.MeldexDropboxTagSafety = {
    sameJsonValue,
    reverseCatalogPublish,
    reverseAssignments,
    normalizeAssignmentStore,
    promoteManualTag,
    setManualTags,
    removeTargetTag,
    removeTagEverywhere,
    reverseAssignmentStore,
    pruneRecoveryFiles,
    rollbackCreatedCatalogTags,
    compensateCreatedTags,
  };
})();
