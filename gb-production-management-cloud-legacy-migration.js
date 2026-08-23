  // gb-production-management-cloud-legacy-migration.js: 旧共通「タスクリスト」から
  // 作品別タスクシートへの移行（重複判定・競合コピー整理・カレンダー予定の付け替えを含む）
  // を担当する（責務単位分割 2026-08-12。旧 gb-production-management.part02.js の一部）。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。

  function _pmCloudTaskBelongsToWork(entry, workTitle) {
    const title = String(workTitle || '').trim();
    if (!title) return false;
    const propertyTitle = _pmCloudPropValue(entry?.frontmatter, '作品タイトル')
      || _pmCloudPropValue(entry?.frontmatter, '作品タイトル_話数');
    const creationKey = _pmCloudPropValue(entry?.frontmatter, '作成キー');
    if (propertyTitle) return propertyTitle === title;
    if (!creationKey.startsWith(title + '|')) return false;
    return creationKey.slice(title.length + 1).split('|').length === 4;
  }

  async function _pmCloudLegacyCopyPath(provider, internals, entry, taskSheet) {
    const root = _pmCloudRoot(internals);
    const baseName = _pmSafeName(entry?.name || '無題');
    const basePath = internals._joinPath(root, taskSheet, baseName + '.md');
    if (!await _pmCloudEntryExists(provider, basePath, internals)) return basePath;
    const suffix = _pmHash(String(entry?.path || baseName)).slice(0, 8);
    let candidate = internals._joinPath(root, taskSheet, `${baseName}-${suffix}.md`);
    let counter = 1;
    while (await _pmCloudEntryExists(provider, candidate, internals)) {
      counter += 1;
      candidate = internals._joinPath(root, taskSheet, `${baseName}-${suffix}-${counter}.md`);
    }
    return candidate;
  }

  function _pmCloudRelinkTaskEvents(events, entry, targetPath) {
    const taskId = String(entry?.frontmatter?.id || '');
    const sourcePath = String(entry?.path || '');
    if (!taskId && !sourcePath) return 0;
    let updated = 0;
    events.forEach(event => {
      const matchesId = taskId && String(event?.external_id || '') === taskId;
      const matchesPath = sourcePath && String(event?.description || '').includes(sourcePath);
      if (event?.calendar_source !== 'production-task' || (!matchesId && !matchesPath)) return;
      const description = '元シート: ' + targetPath;
      if (event.description === description) return;
      event.description = description;
      event.modified = new Date().toISOString();
      updated += 1;
    });
    return updated;
  }

  async function _pmCloudReadCalendarEventsStrict(provider, internals) {
    const path = _pmCalendarStorePath(internals, 'events');
    let text;
    try {
      text = await provider.readText(path);
    } catch (error) {
      if (_pmCloudIsNotFoundError(error)) return [];
      throw error;
    }
    const parsed = JSON.parse(String(text || '[]'));
    if (!Array.isArray(parsed)) throw new Error('作業予定カレンダーのデータ形式が不正です');
    return parsed;
  }

  function _pmCloudIsConflictCopyEntry(entry) {
    const name = String(entry?.name || entry?.path || '').replace(/\\/g, '/').split('/').pop();
    return /(?:競合コピー|conflicted copy)/i.test(name);
  }

  async function _pmCloudCleanupIdenticalConflictCopies(provider, targetEntries) {
    const byKey = new Map();
    targetEntries.forEach(entry => {
      const key = _pmCloudPropValue(entry.frontmatter, '作成キー');
      if (!key) return;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(entry);
    });
    const removed = new Set();
    let unresolved = 0;
    for (const entries of byKey.values()) {
      const conflicts = entries.filter(_pmCloudIsConflictCopyEntry);
      if (!conflicts.length) continue;
      const canonicals = entries.filter(entry => !_pmCloudIsConflictCopyEntry(entry));
      if (canonicals.length !== 1) {
        if (entries.length > 1) unresolved += conflicts.length;
        continue;
      }
      const canonical = canonicals[0];
      const canonicalText = await provider.readText(canonical.path);
      for (const conflict of conflicts) {
        const conflictText = await provider.readText(conflict.path);
        if (conflictText !== canonicalText) { unresolved += 1; continue; }
        if (typeof provider?.deletePath !== 'function') throw new Error(`同一内容の競合コピーを削除できません: ${conflict.path}`);
        await provider.deletePath(conflict.path);
        removed.add(conflict.path);
      }
    }
    return { entries: targetEntries.filter(entry => !removed.has(entry.path)), removed: removed.size, conflicts: unresolved };
  }

  async function _pmCloudMigrateLegacyTasksForWork(provider, internals, workTitle, taskSheet, options = {}) {
    if (!taskSheet || taskSheet === 'タスクリスト') return { copied: 0, removed: 0, matched: 0, conflicts: 0, existing_keys: [] };
    const hasLegacySnapshot = Array.isArray(options.legacyEntries);
    const legacyEntries = hasLegacySnapshot
      ? options.legacyEntries
      : await _pmCloudListEntries(provider, internals, 'タスクリスト', { concurrency: 8 });
    const targetSnapshot = await _pmCloudListEntries(provider, internals, taskSheet, { concurrency: 8 });
    const conflictCleanup = await _pmCloudCleanupIdenticalConflictCopies(provider, targetSnapshot);
    const targetEntries = conflictCleanup.entries;
    const targetByKey = new Map(targetEntries.map(entry => [_pmCloudPropValue(entry.frontmatter, '作成キー'), entry]).filter(([key]) => key));
    const targetBySource = new Map(targetEntries.map(entry => [String(entry.frontmatter?.migrated_from || ''), entry]).filter(([source]) => source));
    const existingKeys = new Set(targetByKey.keys());
    const candidates = hasLegacySnapshot
      ? legacyEntries
      : legacyEntries.filter(entry => _pmCloudTaskBelongsToWork(entry, workTitle));
    const events = candidates.length ? await _pmCloudReadCalendarEventsStrict(provider, internals) : [];
    const pendingDeletes = [];
    let eventUpdates = 0;
    let copied = 0;
    let removed = 0;
    let conflicts = conflictCleanup.conflicts || 0;
    for (const entry of candidates) {
      const key = _pmCloudPropValue(entry.frontmatter, '作成キー');
      if (key) existingKeys.add(key);
      let targetEntry = key ? targetByKey.get(key) : targetBySource.get(entry.path);
      if (!targetEntry) {
        const targetPath = await _pmCloudLegacyCopyPath(provider, internals, entry, taskSheet);
        const frontmatter = { ...(entry.frontmatter || {}) };
        frontmatter.type = frontmatter.type || 'settings-entry';
        // ID未採番の旧行も割当時は旧pathのhashを実効IDとして使うため、その値を固定して引き継ぐ。
        frontmatter.id = frontmatter.id || _pmHash(entry.path).slice(0, 12);
        frontmatter.category = taskSheet;
        frontmatter.migrated_from = entry.path;
        frontmatter.modified = new Date().toISOString();
        await provider.writeText(targetPath, _pmCloudFrontmatterText(frontmatter, entry.body || ''));
        eventUpdates += _pmCloudRelinkTaskEvents(events, entry, targetPath);
        targetEntry = { path: targetPath, name: internals._basename(targetPath).replace(/\.md$/i, ''), frontmatter, body: entry.body || '' };
        if (key) targetByKey.set(key, targetEntry);
        targetBySource.set(entry.path, targetEntry);
        copied += 1;
      } else {
        const sourceId = String(entry.frontmatter?.id || '');
        const targetId = String(targetEntry.frontmatter?.id || '');
        const copiedFromSource = String(targetEntry.frontmatter?.migrated_from || '') === entry.path;
        const sameStableId = !!sourceId && !!targetId && sourceId === targetId;
        if (!copiedFromSource && !sameStableId) {
          conflicts += 1;
          continue;
        }
        if (sourceId && !targetId) {
          targetEntry.frontmatter.id = sourceId;
          targetEntry.frontmatter.modified = new Date().toISOString();
          await provider.writeText(targetEntry.path, _pmCloudFrontmatterText(targetEntry.frontmatter, targetEntry.body || ''));
        }
        eventUpdates += _pmCloudRelinkTaskEvents(events, entry, targetEntry.path);
      }
      if (typeof provider?.deletePath === 'function') pendingDeletes.push(entry.path);
    }
    if (eventUpdates) await _pmWriteCalendarStore(provider, internals, 'events', events);
    for (const path of pendingDeletes) {
      try {
        await provider.deletePath(path);
        removed += 1;
      } catch (error) {
        console.warn('[ProductionManagement] 旧タスク行を残しました', path, error);
      }
    }
    return { copied, removed, matched: candidates.length, conflicts, conflict_copies_removed: conflictCleanup.removed, existing_keys: [...existingKeys] };
  }

  async function _pmCloudMigrateLegacyWorkspace(provider, internals) {
    const workEntries = await _pmCloudListEntries(provider, internals, '作品リスト', { concurrency: 8 });
    const legacyEntries = await _pmCloudListEntries(provider, internals, 'タスクリスト', { concurrency: 8 });
    const worksByTitle = new Map();
    workEntries.forEach(work => {
      const title = _pmCloudPropValue(work.frontmatter, '作品タイトル_話数')
        || _pmCloudPropValue(work.frontmatter, '作品タイトル') || work.name;
      if (title && !worksByTitle.has(title)) worksByTitle.set(title, work);
    });
    const usedSheets = new Set(workEntries
      .map(work => _pmCloudPropValue(work.frontmatter, 'タスクリストシート').toLocaleLowerCase('ja'))
      .filter(Boolean));
    const legacyByTitle = new Map();
    legacyEntries.forEach(entry => {
      const title = _pmCloudLegacyTaskWorkTitle(entry);
      if (!legacyByTitle.has(title)) legacyByTitle.set(title, []);
      legacyByTitle.get(title).push(entry);
    });
    const titles = new Set(legacyByTitle.keys());
    worksByTitle.forEach((work, title) => {
      if (!_pmCloudPropValue(work.frontmatter, 'タスクリストシート')) titles.add(title);
    });
    const result = { works: 0, copied: 0, removed: 0, conflict_copies_removed: 0 };
    for (const workTitle of titles) {
      const work = worksByTitle.get(workTitle);
      const registeredSheet = work ? _pmCloudPropValue(work.frontmatter, 'タスクリストシート') : '';
      let taskSheet = registeredSheet;
      if (!taskSheet) {
        taskSheet = _pmCloudAllocateTaskSheetName(workTitle, usedSheets);
        await _pmCloudEnsureSheet(provider, internals, taskSheet, 'タスクリスト');
      } else if (legacyByTitle.has(workTitle)) {
        const sheetDir = internals._joinPath(_pmCloudRoot(internals), taskSheet);
        const sheetNote = internals._joinPath(sheetDir, taskSheet + '.md');
        if (!await _pmCloudEntryExists(provider, sheetDir, internals) || !await _pmCloudEntryExists(provider, sheetNote, internals)) {
          await _pmCloudEnsureSheet(provider, internals, taskSheet, 'タスクリスト');
        }
      }
      if (!registeredSheet) {
        const props = { 'タスクリストシート': taskSheet };
        if (work) await _pmCloudUpdateEntryAtPath(provider, work.path, props, work);
        else await _pmCloudUpsertEntry(provider, internals, '作品リスト', workTitle, props, '', '', { reuseName: true, createNew: true });
        result.works += 1;
      }
      const migration = await _pmCloudMigrateLegacyTasksForWork(provider, internals, workTitle, taskSheet, {
        legacyEntries: legacyByTitle.get(workTitle) || [],
      });
      if (migration.conflicts) {
        throw new Error(`タスクリストに内容を自動統合できない行が${migration.conflicts}件あります。旧タスクリストまたは競合コピーと、作品別タスクリストの同じ作成キーを確認してください`);
      }
      result.copied += migration.copied;
      result.removed += migration.removed;
      result.conflict_copies_removed += migration.conflict_copies_removed || 0;
    }
    return result;
  }

  async function _pmCloudExistingTaskKeysForWork(provider, internals, workTitle) {
    let taskSheet = '';
    const workPath = await _pmCloudFindByName(provider, internals, '作品リスト', workTitle)
      || await _pmCloudFindByProp(provider, internals, '作品リスト', '作品タイトル_話数', workTitle);
    if (workPath) {
      const work = await _pmCloudReadFrontmatter(provider, workPath);
      taskSheet = _pmCloudPropValue(work.frontmatter, 'タスクリストシート');
    }
    const entries = taskSheet ? await _pmCloudListEntries(provider, internals, taskSheet) : [];
    const legacyEntries = await _pmCloudListEntries(provider, internals, 'タスクリスト');
    legacyEntries.filter(entry => _pmCloudTaskBelongsToWork(entry, workTitle)).forEach(entry => entries.push(entry));
    return new Set(entries.map(entry => _pmCloudPropValue(entry.frontmatter, '作成キー')).filter(Boolean));
  }
