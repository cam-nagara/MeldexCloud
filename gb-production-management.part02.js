  async function _pmCloudDirectoryEntries(provider, internals, dir) {
    try {
      return await internals._listDirectoryEntries(provider, dir);
    } catch (error) {
      if (_pmCloudIsNotFoundError(error)) return [];
      throw error;
    }
  }

  async function _pmCloudUpsertEntry(provider, internals, sheet, name, props, keyProp, keyValue, options = {}) {
    let existing = keyProp && keyValue && !options.skipLookup
      ? await _pmCloudFindByProp(provider, internals, sheet, keyProp, keyValue)
      : '';
    const safeName = _pmSafeName(existing ? internals._basename(existing).replace(/\.md$/i, '') : name);
    let path = existing || internals._joinPath(_pmCloudRoot(internals), sheet, safeName + '.md');
    if (!existing && await _pmCloudEntryExists(provider, path, internals)) {
      if (options.reuseName) existing = path;
      const atBase = await _pmCloudReadFrontmatter(provider, path);
      if (existing || (keyProp && keyValue && _pmCloudPropValue(atBase.frontmatter, keyProp) === String(keyValue))) {
        if (!props || !Object.keys(props).length) return path;
      } else {
        const suffix = _pmHash([sheet, keyProp || '', keyValue || '', JSON.stringify(props || {})].join('|')).slice(0, 8);
        path = internals._joinPath(_pmCloudRoot(internals), sheet, `${safeName}-${suffix}.md`);
        let counter = 1;
        while (await _pmCloudEntryExists(provider, path, internals)) {
          const atCandidate = await _pmCloudReadFrontmatter(provider, path);
          if (keyProp && keyValue && _pmCloudPropValue(atCandidate.frontmatter, keyProp) === String(keyValue)) return path;
          counter += 1;
          path = internals._joinPath(_pmCloudRoot(internals), sheet, `${safeName}-${suffix}-${counter}.md`);
        }
      }
    }
    const parsed = options.createNew && !existing ? { frontmatter: {}, body: '' } : await _pmCloudReadFrontmatter(provider, path);
    const fm = { ...(parsed.frontmatter || {}) };
    fm.type = 'settings-entry';
    fm.id = fm.id || 'ent_' + _pmHash(path).slice(0, 10);
    fm.category = sheet;
    fm.modified = new Date().toISOString();
    fm.properties = { ...(fm.properties || {}) };
    Object.entries(props || {}).forEach(([prop, value]) => {
      if (value == null || value === '') return;
      fm.properties[prop] = [{ value: String(value), status: '採用', note: '', created: new Date().toISOString() }];
    });
    await provider.writeText(path, _pmCloudFrontmatterText(fm, parsed.body || ''));
    return path;
  }

  // 既存エントリをパス指定で直接更新する（キー検索に依存しない。割り当て結果の書き戻し用）
  async function _pmCloudUpdateEntryAtPath(provider, path, props, cachedEntry = null) {
    const parsed = cachedEntry || await _pmCloudReadFrontmatter(provider, path);
    const fm = { ...(parsed.frontmatter || {}) };
    fm.type = fm.type || 'settings-entry';
    fm.modified = new Date().toISOString();
    fm.properties = { ...(fm.properties || {}) };
    Object.entries(props || {}).forEach(([prop, value]) => {
      if (value == null || value === '') return;
      fm.properties[prop] = [{ value: String(value), status: '採用', note: '', created: new Date().toISOString() }];
    });
    await provider.writeText(path, _pmCloudFrontmatterText(fm, parsed.body || ''));
    return path;
  }

  async function _pmCloudFindByProp(provider, internals, sheet, prop, value) {
    for (const entry of await _pmCloudListEntries(provider, internals, sheet)) {
      if (_pmCloudPropValue(entry.frontmatter, prop) === String(value)) return entry.path;
    }
    return '';
  }

  async function _pmCloudListEntries(provider, internals, sheet, options = {}) {
    const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
    const entries = await _pmCloudDirectoryEntries(provider, internals, dir);
    const files = entries.filter(entry => entry.handle.kind === 'file' && entry.name.endsWith('.md')
      && entry.name !== sheet + '.md' && !entry.name.startsWith('_'));
    return _pmCloudMapBounded(files, options.concurrency || 1, async entry => {
      const path = internals._joinPath(dir, entry.name);
      const parsed = await _pmCloudReadFrontmatter(provider, path);
      return { path, name: entry.name.replace(/\.md$/i, ''), frontmatter: parsed.frontmatter || {}, body: parsed.body || '' };
    });
  }

  async function _pmCloudFindByName(provider, internals, sheet, name) { return (await _pmCloudListEntries(provider, internals, sheet)).find(entry => entry.name === String(name))?.path || ''; }

  async function _pmCloudTaskSheetNames(provider, internals) {
    const names = new Set();
    const legacyDir = internals._joinPath(_pmCloudRoot(internals), 'タスクリスト');
    if (await _pmCloudEntryExists(provider, legacyDir, internals)) names.add('タスクリスト');
    for (const work of await _pmCloudListEntries(provider, internals, '作品リスト')) {
      const sheet = _pmCloudPropValue(work.frontmatter, 'タスクリストシート');
      if (sheet) names.add(sheet);
    }
    const rootEntries = await _pmCloudDirectoryEntries(provider, internals, _pmCloudRoot(internals));
    rootEntries.forEach(entry => {
      if (entry?.handle?.kind === 'directory' && _pmCloudIsTaskSheetName(entry.name)) names.add(String(entry.name));
    });
    return [...names];
  }

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

  async function _pmCloudWriteTaskRows(provider, internals, taskSheet, rows) {
    const buckets = Array.from({ length: Math.min(4, Math.max(1, rows.length)) }, () => []);
    rows.forEach(row => {
      const name = _pmSafeName(_pmTaskRowEntryName(row));
      const bucket = Number.parseInt(_pmHash(name).slice(0, 8), 16) % buckets.length;
      buckets[bucket].push(row);
    });
    let created = 0;
    const errors = [];
    let aborted = false;
    await Promise.all(buckets.map(async bucket => {
      for (const row of bucket) {
        if (aborted) break;
        const key = String(row['作成キー'] || '');
        try {
          await _pmCloudUpsertEntry(provider, internals, taskSheet, _pmTaskRowEntryName(row), _pmTaskRowProps(row), '作成キー', key, { skipLookup: true });
          created += 1;
        } catch (error) {
          const isConflict = String(error?.name || '').toLowerCase().includes('conflict')
            || String(error?.status || error?.code || '') === '409'
            || /conflict|競合/i.test(String(error?.message || ''));
          let reconciled = false;
          try {
            const concurrent = isConflict && key ? await _pmCloudTaskConflictExists(provider, internals, taskSheet, row, key) : false;
            if (concurrent) {
              const conflictPath = String(error?.message || '').match(/競合コピーへ保存しました:\s*(.+)\s*$/)?.[1] || '';
              if (conflictPath && typeof provider?.deletePath !== 'function') throw error;
              if (conflictPath) await provider.deletePath(conflictPath);
              reconciled = true;
            }
          } catch (reconcileError) {
            errors.push(reconcileError);
            aborted = true;
            break;
          }
          if (reconciled) continue;
          errors.push(error);
          aborted = true;
          break;
        }
      }
    }));
    if (errors.length) throw errors[0];
    return created;
  }

  async function _pmCloudTaskConflictExists(provider, internals, taskSheet, row, key) {
    const props = _pmTaskRowProps(row);
    const safeName = _pmSafeName(_pmTaskRowEntryName(row));
    const dir = internals._joinPath(_pmCloudRoot(internals), taskSheet);
    const suffix = _pmHash([taskSheet, '作成キー', key, JSON.stringify(props)].join('|')).slice(0, 8);
    const candidates = [
      internals._joinPath(dir, safeName + '.md'),
      internals._joinPath(dir, `${safeName}-${suffix}.md`),
    ];
    for (const path of candidates) {
      if (!await _pmCloudEntryExists(provider, path, internals)) continue;
      const parsed = await _pmCloudReadFrontmatter(provider, path);
      if (_pmCloudPropValue(parsed.frontmatter, '作成キー') === key) return true;
    }
    return false;
  }

  async function _pmCloudTaskCreateCatalog(provider, internals) {
    const works = await _pmCloudListEntries(provider, internals, '作品リスト', { concurrency: 8 });
    const [contents, targets, scales, taskSheets] = await Promise.all([
      _pmCloudListEntries(provider, internals, '作業内容リスト', { concurrency: 8 }),
      _pmCloudListEntries(provider, internals, '作業対象リスト', { concurrency: 8 }),
      _pmCloudListEntries(provider, internals, '作業規模リスト', { concurrency: 8 }),
      _pmCloudTaskSheets(provider, internals, works),
    ]);
    const payload = (sheet, entries) => ({ ok: true, sheet, rows: entries.map(_pmCloudEntryRow), count: entries.length, root: PM_ROOT, cloud: true });
    return {
      ok: true,
      root: PM_ROOT,
      works: payload('作品リスト', works),
      contents: payload('作業内容リスト', contents),
      targets: payload('作業対象リスト', targets),
      scales: payload('作業規模リスト', scales),
      task_sheets: taskSheets.sheets,
      cloud: true,
    };
  }

  async function _pmCloudWithProductionLease(provider, operation) {
    const serialize = window.MeldexProductionSchemaMigration?.serializeProviderLeaseOperation;
    if (typeof serialize === 'function') {
      return serialize(provider, () => _pmCloudWithProductionLeaseUnlocked(provider, operation));
    }
    return _pmCloudWithProductionLeaseUnlocked(provider, operation);
  }

  async function _pmCloudWithProductionLeaseUnlocked(provider, operation) {
    const requireUnlocked = window.MeldexFileLockStore?.requireUnlocked;
    if (typeof requireUnlocked === 'function') {
      await requireUnlocked(provider, PM_ROOT, { action: 'production-management', includeDescendants: true });
    }
    const store = window.MeldexActiveLockStore;
    if (!store?.acquire || !store?.release) return operation();
    const token = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `pm-${Date.now()}-${_pmHash(Math.random())}`;
    const holderId = `production-task-create:${token}`;
    const lease = {
      path: PM_ROOT,
      token,
      holder_id: holderId,
      locked_by: '制作管理タスク生成',
      device_label: '制作管理',
      kind: 'production-task-create',
      include_descendants: true,
      lease_seconds: 300,
    };
    await store.acquire(provider, lease);
    const heartbeatId = typeof store.heartbeat === 'function'
      ? setInterval(() => store.heartbeat(provider, lease).catch(error => console.warn('[ProductionManagement] 制作管理ロックの更新に失敗しました', error)), 60000)
      : null;
    try {
      return await operation();
    } finally {
      if (heartbeatId != null) clearInterval(heartbeatId);
      try {
        await store.release(provider, PM_ROOT, token, holderId);
      } catch (error) {
        console.warn('[ProductionManagement] 制作管理ロックの解放に失敗しました', error);
      }
    }
  }

  async function _pmCloudListAllTaskEntries(provider, internals) {
    const all = [];
    const seenKeys = new Set();
    const migratedLegacyPaths = new Set();
    const sheets = await _pmCloudTaskSheetNames(provider, internals);
    const orderedSheets = [...sheets.filter(sheet => sheet !== 'タスクリスト'), ...sheets.filter(sheet => sheet === 'タスクリスト')];
    for (const sheet of orderedSheets) {
      const entries = await _pmCloudListEntries(provider, internals, sheet);
      entries.forEach(entry => {
        if (sheet === 'タスクリスト' && migratedLegacyPaths.has(entry.path)) return;
        const key = _pmCloudPropValue(entry.frontmatter, '作成キー');
        if (key && seenKeys.has(key)) return;
        if (key) seenKeys.add(key);
        if (sheet !== 'タスクリスト' && entry.frontmatter?.migrated_from) migratedLegacyPaths.add(String(entry.frontmatter.migrated_from));
        all.push({ ...entry, sheet });
      });
    }
    return all;
  }

  function _pmCloudEntryRow(entry) {
    const properties = {};
    Object.keys(entry?.frontmatter?.properties || {}).forEach(prop => {
      properties[prop] = _pmCloudPropValue(entry.frontmatter, prop);
    });
    const sheet = String(entry?.sheet || entry?.frontmatter?.category || '');
    return {
      id: String(entry?.frontmatter?.id || ''),
      name: String(entry?.name || ''),
      path: String(entry?.path || ''),
      sheet,
      sheet_name: sheet,
      modified: String(entry?.frontmatter?.modified || ''),
      properties,
    };
  }

  function _pmCloudPropValue(fm, prop) {
    const values = fm?.properties?.[prop] || [];
    const list = Array.isArray(values) ? values : [values];
    const found = list.find(v => v && (v.status === '採用' || v.status === '掲載済み')) || list[0];
    return found && typeof found === 'object' ? String(found.value || '') : String(found || '');
  }

  // 「staff」エイリアス（→スタッフリスト）は廃止済み（アカウント一元管理
  // 計画書 Phase 4）。スタッフは正本「スタッフ管理シート」（window.MeldexUserRegistry）
  // 経由に統合され、制作管理のシート契約は 13→12 になった。
  const PM_CLOUD_SHEET_ALIASES = Object.freeze({ tasks: 'タスクリスト', works: '作品リスト', targets: '作業対象リスト', contents: '作業内容リスト', scales: '作業規模リスト', schedule: 'スケジュール', templates: 'タスクテンプレート' });
  const PM_CLOUD_TEMPLATE_FIELDS = new Set(['タスク名', '単位レベル1', '単位レベル2', '単位レベル3', '作業対象リスト', '作業内容リスト', '作業規模リスト', '対象数', '担当者', '目標作業時間_値', '対象色', '優先度', '備考']);
  const PM_CLOUD_LEVEL_COUNTERPART = Object.freeze({ '単位レベル1': '中分類', '中分類': '単位レベル1', '単位レベル2': '小分類', '小分類': '単位レベル2', '単位レベル3': '詳細分類', '詳細分類': '単位レベル3' });

  function _pmCloudError(status, message) { const error = new Error(message); error.status = status; return error; }
  function _pmCloudNormalizePath(value) { return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''); }
  function _pmCloudSheetAlias(value) { const raw = String(value || 'タスクリスト').trim(); return PM_CLOUD_SHEET_ALIASES[raw] || raw; }
  function _pmCloudIsTaskSheetName(value) {
    const name = String(value || '');
    return name === 'タスクリスト' || (name.startsWith(PM_TASK_SHEET_PREFIX) && !name.startsWith('タスクリスト_旧形式バックアップ'));
  }
  function _pmCloudPlainValue(value) {
    const item = Array.isArray(value) ? value[0] : value;
    return String(item && typeof item === 'object' ? item.value || '' : item == null ? '' : item).trim();
  }
  function _pmCloudClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

  function _pmCloudMutationJournal(provider, internals) { return { provider, internals, texts: new Map(), calendars: new Map(), dirs: new Map() }; }
  async function _pmCloudJournalText(journal, path) {
    const key = _pmCloudNormalizePath(path);
    if (journal.texts.has(key)) return;
    const exists = await _pmCloudEntryExists(journal.provider, key, journal.internals);
    journal.texts.set(key, { exists, text: exists ? await journal.provider.readText(key) : '' });
  }
  async function _pmCloudJournalDirectory(journal, path) {
    const key = _pmCloudNormalizePath(path);
    if (!journal.dirs.has(key)) journal.dirs.set(key, await _pmCloudEntryExists(journal.provider, key, journal.internals));
  }
  async function _pmCloudJournalCalendar(journal, name) {
    if (journal.calendars.has(name)) return;
    const path = _pmCalendarStorePath(journal.internals, name);
    journal.calendars.set(name, {
      exists: await _pmCloudEntryExists(journal.provider, path, journal.internals),
      rows: _pmCloudClone(await _pmReadCalendarStore(journal.provider, journal.internals, name)),
    });
    await _pmCloudJournalDirectory(journal, '_calendar');
  }
  async function _pmCloudDeleteRollbackPath(journal, path) {
    if (!await _pmCloudEntryExists(journal.provider, path, journal.internals)) return;
    if (typeof journal.provider?.deletePath !== 'function') throw new Error(`ロールバックで作成ファイルを削除できません: ${path}`);
    await journal.provider.deletePath(path);
  }
  async function _pmCloudRollbackMutation(journal, originalError) {
    const failures = [];
    for (const [path, snapshot] of [...journal.texts.entries()].reverse()) {
      try { if (snapshot.exists) await journal.provider.writeText(path, snapshot.text); else await _pmCloudDeleteRollbackPath(journal, path); }
      catch (error) { failures.push(error); }
    }
    for (const [name, snapshot] of [...journal.calendars.entries()].reverse()) {
      try {
        if (snapshot.exists) await _pmWriteCalendarStore(journal.provider, journal.internals, name, snapshot.rows);
        else await _pmCloudDeleteRollbackPath(journal, _pmCalendarStorePath(journal.internals, name));
      } catch (error) { failures.push(error); }
    }
    for (const [path, existed] of [...journal.dirs.entries()].reverse()) {
      if (!existed) { try { await _pmCloudDeleteRollbackPath(journal, path); } catch (error) { failures.push(error); } }
    }
    if (failures.length) throw new Error(`制作管理の保存に失敗し、元の状態の復元にも失敗しました: ${failures[0]?.message || failures[0]}`, { cause: originalError });
    throw originalError;
  }

  async function _pmCloudRawTaskEntries(provider, internals) {
    const all = [];
    const sheets = await _pmCloudTaskSheetNames(provider, internals);
    const ordered = [...sheets.filter(sheet => sheet !== 'タスクリスト'), ...sheets.filter(sheet => sheet === 'タスクリスト')];
    for (const sheet of ordered) {
      for (const entry of await _pmCloudListEntries(provider, internals, sheet)) all.push({ ...entry, sheet });
    }
    return all;
  }
  async function _pmCloudResolveEntry(provider, internals, sheet, body) {
    const entries = sheet === 'タスクリスト' ? await _pmCloudRawTaskEntries(provider, internals) : await _pmCloudListEntries(provider, internals, sheet);
    const path = _pmCloudNormalizePath(body?.path);
    const id = String(body?.id || '').trim();
    const found = path ? entries.find(entry => _pmCloudNormalizePath(entry.path) === path)
      : id ? entries.find(entry => String(entry.frontmatter?.id || entry.name) === id) : null;
    if (!path && !id) throw _pmCloudError(400, 'path または id は必須です');
    if (!found) throw _pmCloudError(404, '項目が見つかりません');
    const physicalSheet = String(found.sheet || sheet);
    const category = String(found.frontmatter?.category || '').trim();
    if (category && category !== physicalSheet) throw _pmCloudError(404, '項目が見つかりません');
    return { ...found, sheet: physicalSheet };
  }
  async function _pmCloudEntrySchema(provider, internals, logicalSheet, physicalSheet, entryFrontmatter = null) {
    let schema = { ...(PM_PROPERTY_TYPES[logicalSheet] || {}) };
    if (logicalSheet === 'タスクリスト') {
      const note = await _pmCloudReadFrontmatter(provider, internals._joinPath(_pmCloudRoot(internals), physicalSheet, physicalSheet + '.md'));
      const entryLevelTypes = {};
      const labels = _pmCloudPropValue(entryFrontmatter, '階層ラベル');
      if (labels) _pmResolveLevelPropNames(labels).forEach(candidates => candidates.forEach(name => { entryLevelTypes[name] ||= { type: 'text' }; }));
      schema = { ...(note.frontmatter?.property_types || {}), ...entryLevelTypes, ...schema };
      delete schema[PM_TASK_LEGACY_NAME_PROP];
      delete schema['タスク名を固定'];
    }
    return schema;
  }
  function _pmCloudNormalizeEntryValue(spec, value) {
    if (value == null) return '';
    const type = String(spec?.type || 'text');
    if (type === 'checkbox') return typeof value === 'boolean' ? String(value) : (/^(true|1|yes|on|採用)$/i.test(String(value).trim()) ? 'true' : 'false');
    if (type === 'number') {
      const text = String(value).trim();
      if (!text) return '';
      const number = Number(text);
      if (!Number.isFinite(number)) throw _pmCloudError(400, '数値欄には数値を入力してください');
      return String(number);
    }
    return String(value);
  }
  function _pmCloudApplyEntryUpdates(frontmatter, schema, updates, logicalSheet) {
    const unknown = Object.keys(updates).filter(name => !Object.prototype.hasOwnProperty.call(schema, name));
    if (unknown.length) throw _pmCloudError(400, '存在しない項目です: ' + unknown.join(', '));
    const fm = { ...(frontmatter || {}), properties: { ...(frontmatter?.properties || {}) }, modified: new Date().toISOString() };
    Object.entries(updates).forEach(([name, value]) => {
      const normalized = _pmCloudNormalizeEntryValue(schema[name], value);
      if (normalized === '') delete fm.properties[name];
      else fm.properties[name] = [{ value: normalized, status: '採用', note: '', created: new Date().toISOString() }];
      if (logicalSheet === 'タスクリスト' && PM_CLOUD_LEVEL_COUNTERPART[name]) delete fm.properties[PM_CLOUD_LEVEL_COUNTERPART[name]];
    });
    return fm;
  }
  async function _pmCloudUniqueEntryPath(provider, internals, sheet, name, seed) {
    const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
    const base = _pmSafeName(name).slice(0, 90);
    let path = internals._joinPath(dir, base + '.md');
    if (!await _pmCloudEntryExists(provider, path, internals)) return path;
    const suffix = _pmHash(seed).slice(0, 8);
    path = internals._joinPath(dir, `${base}_${suffix}.md`);
    let counter = 1;
    while (await _pmCloudEntryExists(provider, path, internals)) path = internals._joinPath(dir, `${base}_${suffix}_${String(counter++).padStart(2, '0')}.md`);
    return path;
  }
  async function _pmCloudWriteNewEntry(provider, internals, logicalSheet, physicalSheet, name, props, journal, seed = '') {
    const schema = await _pmCloudEntrySchema(provider, internals, logicalSheet, physicalSheet);
    const fm = _pmCloudApplyEntryUpdates({ type: 'settings-entry', category: physicalSheet, properties: {} }, schema, props, logicalSheet);
    const path = await _pmCloudUniqueEntryPath(provider, internals, physicalSheet, name, seed || `${name}|${Date.now()}|${Math.random()}`);
    fm.id = 'ent_' + _pmHash(path + '|' + seed + '|' + Math.random()).slice(0, 10);
    await _pmCloudJournalText(journal, path);
    await provider.writeText(path, _pmCloudFrontmatterText(fm, ''));
    return { path, name: internals._basename(path).replace(/\.md$/i, ''), sheet: physicalSheet, frontmatter: fm, body: '' };
  }
  async function _pmCloudFindWork(provider, internals, title) {
    const wanted = String(title || '').trim();
    return (await _pmCloudListEntries(provider, internals, '作品リスト')).find(entry => entry.name === wanted
      || _pmCloudPropValue(entry.frontmatter, '作品タイトル_話数') === wanted
      || _pmCloudPropValue(entry.frontmatter, '作品タイトル') === wanted) || null;
  }
  async function _pmCloudGetOrCreateWork(provider, internals, title, journal, onlyWhenEmpty = false) {
    const wanted = String(title || '').trim() || '未分類';
    const works = await _pmCloudListEntries(provider, internals, '作品リスト');
    const found = works.find(entry => entry.name === wanted || _pmCloudPropValue(entry.frontmatter, '作品タイトル_話数') === wanted);
    if (found) return found;
    if (onlyWhenEmpty && works.length) throw _pmCloudError(404, '指定した作品が見つかりません');
    const props = onlyWhenEmpty ? {
      '階層数': '3', '階層ラベル': '中分類,小分類,詳細分類', 'プリセット種別': '汎用', '作業作成粒度': '階層単位', '状況': '進行中',
      '作業期間': `${_pmDateTimeText(new Date())}|${_pmDateTimeText(new Date(Date.now() + 30 * 86400000))}`,
    } : {};
    return _pmCloudWriteNewEntry(provider, internals, '作品リスト', '作品リスト', wanted, props, journal, `work:${wanted}`);
  }
  async function _pmCloudEnsureTaskSheetForWork(provider, internals, work, journal) {
    const works = await _pmCloudListEntries(provider, internals, '作品リスト');
    const registered = _pmCloudPropValue(work.frontmatter, 'タスクリストシート');
    const used = new Set(works.map(entry => _pmCloudPropValue(entry.frontmatter, 'タスクリストシート').toLocaleLowerCase('ja')).filter(Boolean));
    const sheet = registered || _pmCloudAllocateTaskSheetName(work.name || '未分類', used);
    const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
    const note = internals._joinPath(dir, sheet + '.md');
    await _pmCloudJournalDirectory(journal, dir);
    await _pmCloudJournalText(journal, note);
    await _pmCloudEnsureSheet(provider, internals, sheet, 'タスクリスト');
    if (!registered) {
      await _pmCloudJournalText(journal, work.path);
      await _pmCloudUpdateEntryAtPath(provider, work.path, { 'タスクリストシート': sheet }, work);
      work = { ...work, ...(await _pmCloudReadFrontmatter(provider, work.path)), path: work.path, name: work.name };
    }
    const labels = _pmCloudPropValue(work.frontmatter, '階層ラベル');
    const parsed = await _pmCloudReadFrontmatter(provider, note);
    const fm = { ...(parsed.frontmatter || {}), property_types: { ...(parsed.frontmatter?.property_types || {}) } };
    _pmResolveLevelPropNames(labels).slice(0, 3).forEach(candidates => { fm.property_types[candidates[0]] ||= { type: 'text' }; });
    await provider.writeText(note, _pmCloudFrontmatterText(fm, parsed.body || `# ${sheet}\n\n`));
    return { sheet, work };
  }

  async function _pmCloudCreateEntry(provider, internals, body) {
    if ((await _pmCloudMissing(provider, internals)).length) await _pmCloudInit(provider, internals);
    const sheet = _pmCloudSheetAlias(body?.sheet);
    if (!PM_PROPERTY_TYPES[sheet]) throw _pmCloudError(400, '対象リストが不正です');
    const props = body?.properties && typeof body.properties === 'object' ? { ...body.properties } : {};
    const managed = window.MeldexProductionSchemaMigration?.MANAGED_NAME_COLUMNS?.[sheet];
    const retiredName = managed ? _pmCloudPlainValue(props[managed.legacy]) || (managed.historicalAliases || []).map(name => _pmCloudPlainValue(props[name])).find(Boolean) : '';
    const taskLegacyName = _pmCloudPlainValue(props[PM_TASK_LEGACY_NAME_PROP]);
    const title = String(body?.name || taskLegacyName || retiredName || props['テンプレート名'] || '無題').trim() || '無題';
    if (managed) [managed.legacy, ...(managed.historicalAliases || [])].forEach(name => delete props[name]);
    if (sheet === 'タスクリスト') delete props[PM_TASK_LEGACY_NAME_PROP];
    const journal = _pmCloudMutationJournal(provider, internals);
    try {
      let physicalSheet = sheet;
      if (sheet === 'タスクリスト') {
        const work = await _pmCloudGetOrCreateWork(provider, internals, body?.work_title || props['作品タイトル'], journal);
        physicalSheet = (await _pmCloudEnsureTaskSheetForWork(provider, internals, work, journal)).sheet;
      }
      const entry = await _pmCloudWriteNewEntry(provider, internals, sheet, physicalSheet, title, props, journal);
      return { ok: true, row: _pmCloudEntryRow(entry), cloud: true };
    } catch (error) { return _pmCloudRollbackMutation(journal, error); }
  }

  async function _pmCloudPatchEntry(provider, internals, body) {
    const sheet = _pmCloudSheetAlias(body?.sheet);
    if (!PM_PROPERTY_TYPES[sheet]) throw _pmCloudError(400, '対象リストが不正です');
    const entry = await _pmCloudResolveEntry(provider, internals, sheet, body);
    const updates = body?.properties && typeof body.properties === 'object' ? { ...body.properties } : {};
    if (sheet === 'タスクリスト') {
      delete updates[PM_TASK_LEGACY_NAME_PROP];
      if (Object.prototype.hasOwnProperty.call(updates, '作業予定日時') && !Object.prototype.hasOwnProperty.call(updates, '作業予定区間')) updates['作業予定区間'] = '';
    }
    if (!Object.keys(updates).length) throw _pmCloudError(400, '更新内容がありません');
    const schema = await _pmCloudEntrySchema(provider, internals, sheet, entry.sheet, entry.frontmatter);
    const fm = _pmCloudApplyEntryUpdates(entry.frontmatter, schema, updates, sheet);
    const journal = _pmCloudMutationJournal(provider, internals);
    await _pmCloudJournalText(journal, entry.path);
    if (sheet === 'タスクリスト') { await _pmCloudJournalCalendar(journal, 'events'); await _pmCloudJournalCalendar(journal, 'calendars'); }
    try {
      await provider.writeText(entry.path, _pmCloudFrontmatterText(fm, entry.body || ''));
      if (sheet === 'タスクリスト') await _pmCloudSyncTaskEvent(provider, internals, entry.path, fm);
      return { ok: true, row: _pmCloudEntryRow({ ...entry, frontmatter: fm }), needs_recalculate: sheet === 'タスクリスト', cloud: true };
    } catch (error) { return _pmCloudRollbackMutation(journal, error); }
  }

  function _pmCloudTaskSegments(value, start, end) {
    let rows = [];
    try { rows = Array.isArray(value) ? value : JSON.parse(String(value || '[]')); } catch {}
    const valid = (Array.isArray(rows) ? rows : []).map(item => ({ start: String(item?.start || ''), end: String(item?.end || '') }))
      .filter(item => item.start && item.end && new Date(item.end) > new Date(item.start)).sort((a, b) => a.start.localeCompare(b.start));
    return valid.length ? valid : (start && end ? [{ start, end }] : []);
  }
  async function _pmCloudSyncTaskEvent(provider, internals, path, fm) {
    const taskId = String(fm?.id || internals._basename(path).replace(/\.md$/i, ''));
    const baseId = `production-task:${taskId}`;
    const before = await _pmReadCalendarStore(provider, internals, 'events');
    const events = before.filter(event => String(event?.id || '') !== baseId && !String(event?.id || '').startsWith(baseId + ':part:'));
    const planned = _pmCloudPropValue(fm, '作業予定日時');
    const user = _pmCloudPropValue(fm, '担当者');
    if (planned && user && planned.includes('|')) {
      const [start, end] = planned.split('|', 2);
      const segments = _pmCloudTaskSegments(_pmCloudPropValue(fm, '作業予定区間'), start, end);
      const calendarId = await _pmEnsureCloudCalendar(provider, internals, `作業予定: ${user}`, '#569cd6', 'production-task', user);
      const key = _pmCloudPropValue(fm, '作成キー');
      const work = _pmCloudPropValue(fm, '作品タイトル');
      const locked = /^(true|1|yes|on)$/i.test(_pmCloudPropValue(fm, '再計算ロック'));
      const now = new Date().toISOString();
      segments.forEach((segment, index) => {
        const id = index ? `${baseId}:part:${index + 1}` : baseId;
        const old = before.find(event => String(event?.id || '') === id);
        const detail = ['元シート: ' + path, work && '作品タイトル: ' + work, key && '作成キー: ' + key, locked && '再計算ロック: true', segments.length > 1 && `作業区間: ${index + 1}/${segments.length}`].filter(Boolean).join('\n');
        events.push({ id, title: internals._basename(path).replace(/\.md$/i, ''), start: segment.start, end: segment.end, all_day: 0, color: '#569cd6', description: detail, location: '', url: key ? `production-task-key:${key}` : '', recurrence: '', external_id: taskId, calendar_source: 'production-task', user, creator: user, calendar_id: calendarId, alert_minutes: -1, created: old?.created || now, modified: now });
      });
    }
    await _pmWriteCalendarStore(provider, internals, 'events', events);
  }

  function _pmCloudApplyCalendarDrop(props, body, drop) {
    const startDate = new Date(String(drop?.start || body?.start || ''));
    if (!Number.isFinite(startDate.getTime())) throw _pmCloudError(400, '開始日時は必須です');
    const fallback = Math.max(0.01, Number(props['目標作業時間_値']) || 1) * 60;
    const minutes = Math.max(1, Number(drop?.duration_minutes || body?.duration_minutes) || fallback);
    if (minutes > 525600) throw _pmCloudError(400, '作業時間は1年以内で指定してください');
    const rawEnd = String(drop?.end || body?.end || '');
    const endDate = rawEnd ? new Date(rawEnd) : new Date(startDate.getTime() + minutes * 60000);
    if (!Number.isFinite(endDate.getTime()) || endDate <= startDate) throw _pmCloudError(400, '終了日時は開始日時より後にしてください');
    const user = String(props['担当者'] || body?.current_user || '').trim();
    if (!user) throw _pmCloudError(400, 'カレンダーへ追加する担当者を指定してください');
    const start = _pmDateTimeText(startDate), end = _pmDateTimeText(endDate);
    props['担当者'] = user; props['作業予定日時'] = `${start}|${end}`;
    props['作業予定区間'] = JSON.stringify([{ start, end }]);
    props['作業予定時間'] = _pmCloudDurationText((endDate - startDate) / 3600000); props['状況'] = '着手待ち';
  }
  async function _pmCloudCreateFromTemplate(provider, internals, body) {
    if ((await _pmCloudMissing(provider, internals)).length) await _pmCloudInit(provider, internals);
    const template = await _pmCloudResolveEntry(provider, internals, 'タスクテンプレート', { path: body?.template_path, id: body?.template_id });
    const journal = _pmCloudMutationJournal(provider, internals);
    try {
      let work;
      if (body?.work_path || body?.work_id) work = await _pmCloudResolveEntry(provider, internals, '作品リスト', { path: body.work_path, id: body.work_id });
      else {
        const workTitle = String(body?.work_title || body?.['作品タイトル'] || '').trim();
        if (!workTitle) throw _pmCloudError(400, 'work_id、work_path、work_title のいずれかは必須です');
        work = await _pmCloudGetOrCreateWork(provider, internals, workTitle, journal, true);
      }
      const props = {};
      PM_CLOUD_TEMPLATE_FIELDS.forEach(name => { const value = _pmCloudPropValue(template.frontmatter, name); if (value) props[name] = value; });
      const overrides = body?.overrides && typeof body.overrides === 'object' ? body.overrides : {};
      const unknown = Object.keys(overrides).filter(name => !PM_CLOUD_TEMPLATE_FIELDS.has(name) && !['name', 'name_override'].includes(name));
      if (unknown.length) throw _pmCloudError(400, '上書きできない項目です: ' + unknown.join(', '));
      Object.entries(overrides).forEach(([name, value]) => { if (PM_CLOUD_TEMPLATE_FIELDS.has(name)) { if (value == null || value === '') delete props[name]; else props[name] = String(value); } });
      const labels = _pmCloudPropValue(work.frontmatter, '階層ラベル') || '中分類,小分類,詳細分類';
      const levelNames = _pmResolveLevelPropNames(labels).map(names => names[0]);
      const classification = body?.classification && typeof body.classification === 'object' ? body.classification : {};
      const levels = [1, 2, 3].map(index => String(classification[`level${index}`] ?? body?.[`level${index}`] ?? props[`\u5358\u4f4d\u30ec\u30d9\u30eb${index}`] ?? '').trim());
      levels.forEach((value, index) => { delete props[`\u5358\u4f4d\u30ec\u30d9\u30eb${index + 1}`]; if (value) props[levelNames[index]] = value; });
      const key = 'template-instance:' + (globalThis.crypto?.randomUUID?.() || _pmHash(Date.now() + '|' + Math.random()));
      props['作品タイトル'] = work.name; props['階層パス'] = levels.filter(Boolean).join('-'); props['階層ラベル'] = labels;
      props['プリセット種別'] = _pmCloudPropValue(work.frontmatter, 'プリセット種別') || '汎用'; props['状況'] ||= '未着手';
      props['元テンプレートID'] = String(template.frontmatter?.id || template.name); props['作成キー'] = key;
      const name = String(body?.task_name || overrides.name_override || overrides.name || props['タスク名'] || _pmCloudPropValue(template.frontmatter, 'テンプレート名') || '無題タスク').trim() || '無題タスク';
      delete props['タスク名'];
      const surface = String(body?.drop?.surface || body?.surface || 'list').toLowerCase();
      if (!['list', 'calendar'].includes(surface)) throw _pmCloudError(400, 'drop.surface は list または calendar を指定してください');
      if (surface === 'calendar') _pmCloudApplyCalendarDrop(props, body, body?.drop || {});
      const { sheet } = await _pmCloudEnsureTaskSheetForWork(provider, internals, work, journal);
      if (surface === 'calendar') { await _pmCloudJournalCalendar(journal, 'events'); await _pmCloudJournalCalendar(journal, 'calendars'); }
      const entry = await _pmCloudWriteNewEntry(provider, internals, 'タスクリスト', sheet, name, props, journal, key);
      if (surface === 'calendar') await _pmCloudSyncTaskEvent(provider, internals, entry.path, entry.frontmatter);
      return { ok: true, surface, template_id: String(template.frontmatter?.id || template.name), row: _pmCloudEntryRow(entry), cloud: true };
    } catch (error) { return _pmCloudRollbackMutation(journal, error); }
  }

  async function _pmCloudTaskByEvent(provider, internals, url) {
    const eventId = String(url?.searchParams?.get('event_id') || '').trim();
    if (!eventId) throw _pmCloudError(400, 'event_id は必須です');
    const event = (await _pmReadCalendarStore(provider, internals, 'events')).find(row => String(row?.id || '') === eventId);
    if (!event) throw _pmCloudError(404, '予定が見つかりません');
    const match = String(event.description || '').match(/(?:^|\n)元シート:\s*([^\n]+)/);
    if (!match) throw _pmCloudError(404, '元の作業項目が見つかりません');
    const entry = await _pmCloudResolveEntry(provider, internals, 'タスクリスト', { path: match[1].trim() });
    return { ok: true, event, row: _pmCloudEntryRow(entry), cloud: true };
  }

  function _pmCloudQueryValues(value) { return new Set(_pmList(value)); }
  function _pmCloudQueryLevel(props, index) {
    for (const name of _pmResolveLevelPropNames(props?.['階層ラベル'] || '')[index] || []) if (props?.[name]) return String(props[name]);
    return '';
  }
  function _pmCloudQueryField(row, field) {
    const props = row.properties || {};
    if (field === 'name') return row.name || '';
    if (/^level[1-3]$/.test(field)) return _pmCloudQueryLevel(props, Number(field.slice(-1)) - 1);
    if (field === '作品タイトル') return props['作品タイトル'] || props['作品タイトル_話数'] || '';
    return props[field] || '';
  }
  function _pmCloudQuerySort(raw) {
    const aliases = { task_name: 'name', 'タスク名': 'name', work: '作品タイトル', work_title: '作品タイトル', status: '状況', assignee: '担当者', '単位レベル1': 'level1', '単位レベル2': 'level2', '単位レベル3': 'level3', '中分類': 'level1', '小分類': 'level2', '詳細分類': 'level3', priority: '優先度', planned_start: '作業予定日時', work_content: '作業内容リスト', duration: '目標作業時間_値', target_hours: '目標作業時間_値' };
    if (raw == null || raw === '' || (Array.isArray(raw) && !raw.length)) raw = ['work_title', 'level1', 'level2', 'level3', 'name'].map(field => ({ field, direction: 'asc' }));
    if (typeof raw === 'string') raw = raw.split(',').filter(Boolean).map(token => { const [field, direction] = token.trim().split(':'); return { field, direction }; });
    if (raw && !Array.isArray(raw)) raw = [raw];
    if (!Array.isArray(raw)) throw _pmCloudError(400, 'sort は配列で指定してください');
    return raw.map(item => {
      const requested = String(item?.field || '').trim(); const field = aliases[requested] || requested;
      if (!(field === 'name' || /^level[1-3]$/.test(field) || Object.prototype.hasOwnProperty.call(PM_PROPERTY_TYPES['タスクリスト'], field))) throw _pmCloudError(400, `並べ替えできない項目です: ${requested}`);
      const direction = String(item?.direction || 'asc').toLowerCase(); if (!['asc', 'desc'].includes(direction)) throw _pmCloudError(400, 'sort.direction は asc または desc を指定してください');
      return { field, direction };
    });
  }
  async function _pmCloudQueryTasks(provider, internals, body) {
    const filters = body?.filters && typeof body.filters === 'object' ? body.filters : {};
    const q = String(body?.q || '').trim().toLocaleLowerCase('ja');
    let rows = (await _pmCloudListAllTaskEntries(provider, internals)).map(_pmCloudEntryRow).filter(row => {
      if (q && !`${row.name}\n${Object.values(row.properties || {}).join('\n')}`.toLocaleLowerCase('ja').includes(q)) return false;
      const rules = [[_pmCloudQueryField(row, '作品タイトル'), filters.work_titles || filters.works || filters.work || body?.work_titles || body?.work_title], [_pmCloudQueryField(row, '状況'), filters.statuses || filters.status || body?.statuses || body?.status], [_pmCloudQueryField(row, '担当者'), filters.assignees || filters.assignee || body?.assignees || body?.assignee]];
      if (rules.some(([value, accepted]) => { const set = _pmCloudQueryValues(accepted); return set.size && !set.has(String(value)); })) return false;
      return [1, 2, 3].every(index => { const set = _pmCloudQueryValues(filters[`level${index}`] || body?.[`level${index}`]); return !set.size || set.has(_pmCloudQueryLevel(row.properties, index - 1)); });
    });
    for (const spec of _pmCloudQuerySort(body?.sort).reverse()) rows.sort((a, b) => {
      const av = String(_pmCloudQueryField(a, spec.field) || ''), bv = String(_pmCloudQueryField(b, spec.field) || '');
      if (!av || !bv) return av ? -1 : bv ? 1 : 0;
      const numeric = spec.field === '目標作業時間_値' && Number.isFinite(Number(av)) && Number.isFinite(Number(bv));
      const compared = numeric ? Number(av) - Number(bv) : av.localeCompare(bv, 'ja', { numeric: true, sensitivity: 'base' });
      return spec.direction === 'desc' ? -compared : compared;
    });
    const total = rows.length, offset = Math.max(0, Number.parseInt(body?.offset, 10) || 0), limit = Math.max(1, Math.min(1000, Number.parseInt(body?.limit, 10) || 200));
    const workMeta = {};
    for (const work of await _pmCloudListEntries(provider, internals, '作品リスト')) {
      const labels = _pmList(_pmCloudPropValue(work.frontmatter, '階層ラベル')).slice(0, 3);
      workMeta[work.name] = { id: String(work.frontmatter?.id || work.name), title: work.name, classification_labels: labels, classification_count: Math.max(0, Number(_pmCloudPropValue(work.frontmatter, '階層数')) || labels.length) };
    }
    rows = rows.slice(offset, offset + limit);
    return { ok: true, sheet: 'タスクリスト', columns: Object.keys(PM_PROPERTY_TYPES['タスクリスト']), property_types: PM_PROPERTY_TYPES['タスクリスト'], editable_columns: Object.keys(PM_PROPERTY_TYPES['タスクリスト']), rows, count: rows.length, total, offset, limit, work_meta: workMeta, generic_classification_labels: ['中分類', '小分類', '詳細分類'], cloud: true };
  }

  function _pmCloudDurationNumber(value, fallback = 1) {
    const text = String(value == null ? '' : value).trim();
    const parsed = text ? Number(text) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function _pmCloudDurationText(value) {
    const rounded = Math.round(Number(value || 0) * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
  }

  async function _pmCloudTaskDurationMaps(provider, internals) {
    const specs = {
      targets: ['作業対象リスト', '基準作業時間'],
      contents: ['作業内容リスト', '作業時間倍率'],
      scales: ['作業規模リスト', '作業時間倍率'],
    };
    const result = {};
    for (const [kind, [sheet, valueProp]] of Object.entries(specs)) {
      const values = new Map();
      (PM_SEEDS[sheet] || []).forEach(([name, props]) => {
        values.set(name, _pmCloudDurationNumber(props?.[valueProp], 1));
      });
      for (const entry of await _pmCloudListEntries(provider, internals, sheet)) {
        const name = entry.name;
        if (!name) continue;
        values.set(name, _pmCloudDurationNumber(_pmCloudPropValue(entry.frontmatter, valueProp), values.get(name) ?? 1));
      }
      result[kind] = values;
    }
    return result;
  }

  async function _pmCloudApplyTaskDurations(provider, internals, rows) {
    const maps = await _pmCloudTaskDurationMaps(provider, internals);
    (rows || []).forEach(row => {
      const targetHours = maps.targets.get(String(row?.['作業対象リスト'] || '')) ?? 1;
      const contentRatio = maps.contents.get(String(row?.['作業内容リスト'] || '')) ?? 1;
      const scaleRatio = maps.scales.get(String(row?.['作業規模リスト'] || '')) ?? 1;
      const hoursText = _pmCloudDurationText(Math.max(0.01, targetHours * contentRatio * scaleRatio));
      row['目標作業時間_値'] = hoursText;
      row['目標作業時間'] = `${hoursText}時間`;
    });
    return rows;
  }

  function _pmHierarchyConfig(body) {
    const explicitPreset = String(body.preset || body['プリセット種別'] || '').trim();
    const preset = explicitPreset || (_pmHasMangaCountInput(body) ? 'マンガ' : '汎用');
    const rawCount = body.hierarchy_count || body['階層数'];
    const fallback = preset === 'マンガ' ? 2 : 1;
    const count = Math.max(1, Math.min(5, Number(rawCount || fallback) || fallback));
    const labels = _pmList(body.hierarchy_labels || body['階層ラベル'] || (preset === 'マンガ' ? 'ページ,コマ' : '項目,サブ項目,詳細,工程,単位'));
    while (labels.length < count) labels.push('単位レベル' + (labels.length + 1));
    const granularity = String(body.granularity || body['作業作成粒度'] || (preset === 'マンガ' ? 'ページ単位' : ''));
    return { preset, count, labels: labels.slice(0, count), granularity };
  }

  // meldex_production_task_sheets.resolve_level_prop_names の JS版。新規タスク作成時の
  // レベル値プロパティキー解決に使う（AGENT_INBOX.md「制作タスク作成のJS側ミラーにも旧名
  // 単位レベル1〜3書き込みバグが残っている」の解消。2026-07-15 フェーズD1）。
  // 優先順位: 作品固有ラベル（階層ラベルの各段名。マンガプリセットなら ページ/コマ）
  //   > 中分類/小分類/詳細分類（1〜3段目のみ） > 旧 単位レベルN。
  const _PM_NEW_LEVEL_NAMES = ['中分類', '小分類', '詳細分類'];

  function _pmResolveLevelPropNames(labelsText, levelCount = 5) {
    const labels = _pmList(labelsText);
    const result = [];
    for (let index = 0; index < levelCount; index += 1) {
      const candidates = [];
      if (labels[index]) candidates.push(labels[index]);
      if (_PM_NEW_LEVEL_NAMES[index]) candidates.push(_PM_NEW_LEVEL_NAMES[index]);
      candidates.push('単位レベル' + (index + 1));
      result.push([...new Set(candidates)]);
    }
    return result;
  }

  function _pmHierarchyPaths(body, config) {
    const pathCount = _pmHierarchyPathCount(body, config);
    if (pathCount > PM_MAX_GENERATED_TASKS) throw new Error(`一度に作成できる階層は${PM_MAX_GENERATED_TASKS}件までです`);
    const explicit = _pmExplicitHierarchyPaths(body.hierarchy_paths || body['階層パス'], config.count);
    if (explicit.length) return explicit;
    if (config.preset === 'マンガ' || _pmHasMangaCountInput(body)) {
      const pages = _pmLevelValues(body.pages, body.page_count || body['ページ数'], 1, 'P');
      if (config.granularity !== 'コマ単位' || config.count < 2) return pages.map(page => [page]);
      const panels = _pmLevelValues(body.panels, body.panel_count || body['コマ数'], 1, 'C');
      return pages.flatMap(page => panels.map(panel => [page, panel]));
    }
    const counts = _pmHierarchyCounts(body.hierarchy_counts || body['階層別件数'], config.count);
    return _pmCartesian(counts.map((count, level) => Array.from({ length: count }, (_, i) => `L${level + 1}-${i + 1}`)));
  }

  function _pmHierarchyPathCount(body, config) {
    const explicit = _pmExplicitHierarchyPaths(body.hierarchy_paths || body['階層パス'], config.count);
    if (explicit.length) return explicit.length;
    if (config.preset === 'マンガ' || _pmHasMangaCountInput(body)) {
      const pages = _pmLevelValueCount(body.pages, _pmFirstPresent(body, ['page_count', 'ページ数']), 1, 'ページ数');
      if (config.granularity !== 'コマ単位' || config.count < 2) return pages;
      return pages * _pmLevelValueCount(body.panels, _pmFirstPresent(body, ['panel_count', 'コマ数']), 1, 'コマ数');
    }
    return _pmValidatedHierarchyCounts(body.hierarchy_counts || body['階層別件数'], config.count)
      .reduce((total, count) => total * count, 1);
  }

  function _pmExplicitHierarchyPaths(value, count) {
    const rows = Array.isArray(value) ? value : String(value || '').split(/\r?\n/).filter(Boolean);
    return rows.map((row) => {
      const parts = Array.isArray(row) ? row : String(row).split(/[>\/\\|-]/);
      return parts.map(part => String(part).trim()).filter(Boolean).slice(0, count);
    }).filter(path => path.length);
  }

  function _pmLevelValues(values, countValue, fallback, prefix) {
    const list = _pmList(values);
    if (list.length) return list.map(value => _pmUnitLabel(value, prefix));
    const count = _pmPositiveInteger(countValue || fallback, String(prefix).toLowerCase() === 'p' ? 'ページ数' : 'コマ数');
    return Array.from({ length: count }, (_, i) => _pmFormatUnitLabel(i + 1, prefix));
  }

  function _pmLevelValueCount(values, countValue, fallback, label) {
    const list = _pmList(values);
    const requested = countValue === undefined || countValue === null || countValue === '' ? fallback : countValue;
    return list.length || _pmPositiveInteger(requested, label);
  }

  function _pmValidatedHierarchyCounts(value, count) {
    const list = _pmList(value);
    return Array.from({ length: count }, (_, index) => _pmPositiveInteger(list[index] || 1, `階層${index + 1}の件数`));
  }

  function _pmPositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error(`${label}は1以上の整数で指定してください`);
    return number;
  }

  function _pmFirstPresent(body, keys) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) return body[key];
    }
    return undefined;
  }

  function _pmHasMangaCountInput(body) {
    return ['page_count', 'ページ数', 'panel_count', 'コマ数', 'pages', 'panels'].some((key) => {
      const value = body?.[key];
      return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);
    });
  }

  function _pmUnitLabel(value, prefix) {
    const text = String(value || '').trim();
    const number = text.match(/\d+/)?.[0];
    if (number && (new RegExp('^' + prefix + '\\d+', 'i')).test(text)) return _pmFormatUnitLabel(Number(number), prefix);
    if (/^\d+$/.test(text)) return _pmFormatUnitLabel(Number(text), prefix);
    return text || _pmFormatUnitLabel(1, prefix);
  }

  function _pmFormatUnitLabel(index, prefix) {
    const normalized = String(prefix || '').toLowerCase();
    const width = normalized === 'p' ? 4 : normalized === 'c' ? 2 : 2;
    return normalized + String(Math.max(1, Number(index) || 1)).padStart(width, '0');
  }

  function _pmHierarchyCounts(value, count) {
    const list = _pmList(value);
    return Array.from({ length: count }, (_, i) => Math.max(1, Number(list[i] || 1) || 1));
  }

  function _pmCartesian(levels) {
    return levels.reduce((acc, level) => acc.flatMap(path => level.map(value => [...path, value])), [[]]);
  }

  function _pmHierarchyId(path) {
    return path.map(value => String(value).trim()).filter(Boolean).join('-');
  }

  function _pmBuildTaskRows(body) {
    const workTitle = String(body.work_title || body['作品タイトル'] || '無題作品');
    const config = _pmHierarchyConfig(body);
    const targets = _pmTaskDimension(body, ['target_names', '作業対象リスト'], ['全体'], '作業対象');
    const contents = _pmTaskDimension(body, ['content_names', '作業内容リスト'], [config.preset === 'マンガ' ? 'ネーム' : '制作'], '作業内容');
    const scales = _pmTaskDimension(body, ['scale_names', '作業規模リスト'], [config.preset === 'マンガ' ? 'ページ全体' : '標準'], '作業規模');
    const estimated = _pmHierarchyPathCount(body, config) * targets.length * contents.length * scales.length;
    if (estimated > PM_MAX_GENERATED_TASKS) throw new Error(`一度に作成できるタスクは${PM_MAX_GENERATED_TASKS}件までです`);
    const paths = _pmHierarchyPaths(body, config);
    // 実際に書き込むプロパティキーは、この作品の階層ラベル解決結果の先頭候補を使う
    // （meldex_production_task_sheets.resolve_level_prop_names と同じ優先順位。マンガ
    // プリセットなら「ページ/コマ」、汎用プリセットで階層ラベル未指定なら「中分類/小分類/
    // 詳細分類」、階層ラベルを明示指定した作品ではその名前が実際のプロパティキーになる）。
    const levelPropNames = _pmResolveLevelPropNames(config.labels.join(',')).map(candidates => candidates[0]);
    const rows = [];
    paths.forEach(path => targets.forEach(target => contents.forEach(content => scales.forEach((scale) => {
      const unitId = _pmHierarchyId(path);
      const key = [workTitle, unitId, target, content, scale].join('|');
      const levels = {};
      path.slice(0, 5).forEach((value, index) => { levels[levelPropNames[index]] = value; });
      const usesMangaUnits = config.preset === 'マンガ';
      rows.push({ _entry_name: _pmTaskTitle(path, target, scale, content), '作品タイトル': workTitle, 'ページ': usesMangaUnits ? (path[0] || '') : '', 'コマ': usesMangaUnits ? (path[1] || '全体') : '', '階層パス': unitId, '階層ラベル': config.labels.join(','), 'プリセット種別': config.preset, ...levels, '作業作成粒度': config.granularity || `階層${path.length || 1}単位`, '作業対象リスト': target, '作業内容リスト': content, '作業規模リスト': scale, '対象数': '1', '状況': '未着手', '目標作業時間_値': '1', 'ページソート値': String(_pmSortPath(path)), '作成キー': key });
    }))));
    return rows;
  }

  function _pmTaskDimension(body, keys, fallback, label) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const values = [...new Set(_pmList(body[key]))];
      if (!values.length) throw new Error(`${label}を1つ以上指定してください`);
      return values;
    }
    return fallback.slice();
  }

  function _pmList(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    return String(value || '').split(/[,、\n]/).map(v => v.trim()).filter(Boolean);
  }

  function _pmTaskTitle(path, target, scale, content) {
    return [_pmHierarchyId(path), target === '全体' ? '' : target, (scale === 'ページ全体' || scale === '標準') ? '' : scale, content].filter(Boolean).join(' ');
  }

  function _pmSortPath(path) {
    const number = path.map(part => String(part).match(/\d+/)?.[0]).find(Boolean);
    return number ? Number(number) : 0;
  }

  function _pmNormalizeIncomingShift(row) {
    if (!row) return null;
    const user = String(row.user || row['担当者'] || row['スタッフ名'] || '').trim();
    const date = PM_SHIFT_PARSER.normalizeDate(row.date || row['日付']);
    if (!user || !date) return null;
    const startRaw = row.start_time || row['開始時刻'] || row.start;
    const endRaw = row.end_time || row['終了時刻'] || row.end;
    const start_time = PM_SHIFT_PARSER.normalizeTime(startRaw);
    const end_time = PM_SHIFT_PARSER.normalizeTime(endRaw, { allowOver24: true });
    if (String(startRaw || '').trim() && !start_time) return null;
    if (String(endRaw || '').trim() && !end_time) return null;
    return { user, date, start_time, end_time, type: PM_SHIFT_PARSER.normalizeType(row.type || row['種別']), note: String(row.note || row['備考'] || '') };
  }

  function _pmScheduleProps(row, id) {
    const label = _pmScheduleTypeLabel(row.type);
    return { '予定名': `${label} ${row.user}`, '種別': label, '担当者': row.user, '予定日時': _pmDateRange(row.date, row.start_time, row.end_time), '開始時刻': row.start_time, '終了時刻': row.end_time, 'カレンダーID': `shift:${id}`, '作成キー': id, '備考': row.note };
  }

  function _pmScheduleTypeLabel(type) {
    return type === 'off' || type === 'holiday' ? '休み' : 'シフト';
  }

  function _pmDateRange(date, start, end) {
    if (!start) return date;
    const endDate = end && end <= start ? _pmAddDay(date) : date;
    return `${date}T${start}|${endDate}T${end || start}`;
  }

  function _pmAddDay(date) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    // toISOString()（UTC変換）はUTCより進んだタイムゾーンで同じ日付を返すため、ローカル整形を使う
    return _pmDateTimeText(d).slice(0, 10);
  }

  function _pmDateTime(date, time) {
    return new Date(`${date}T${time || '00:00'}`);
  }

  function _pmShiftEndDateTime(row) {
    return _pmDateTime(_pmCloudShiftEndDate(row), row.end_time || row.start_time || '00:00');
  }

  function _pmDateTimeText(value) {
    const pad = n => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  function _pmShiftId(row) {
    return 'pm-shift-' + _pmHash([row.user, row.date, row.start_time, row.end_time, row.type].join('|')).slice(0, 20);
  }

  function _pmSafeName(value) {
    return String(value || '無題').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 100) || '無題';
  }

  function _pmHash(value) {
    let hash = 2166136261;
    String(value || '').split('').forEach((ch) => {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return (hash >>> 0).toString(16) + Math.abs(String(value || '').length).toString(16);
  }

  function _pmRowsCsv(rows) {
    const headers = ['種別', '担当者', '日付', '開始', '終了', '内容', '備考'];
    const lines = [headers.join(',')];
    rows.forEach(row => lines.push(headers.map(header => _pmCsvCell(row[header])).join(',')));
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function _pmCsvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  async function _pmBlobBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function _pmXlsxBlob(rows) {
    const headers = ['種別', '担当者', '日付', '開始', '終了', '内容', '備考'];
    const sheetRows = [headers, ...rows.map(row => headers.map(header => row[header] || ''))];
    const worksheet = _pmWorksheetXml(sheetRows);
    const files = {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="制作管理" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml': worksheet,
    };
    return new Blob([_pmZipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function _pmWorksheetXml(rows) {
    const body = rows.map((row, rIndex) => '<row r="' + (rIndex + 1) + '">' + row.map((value, cIndex) => {
      const ref = _pmColumnName(cIndex + 1) + (rIndex + 1);
      return `<c r="${ref}" t="inlineStr"><is><t>${_pmXmlEscape(value)}</t></is></c>`;
    }).join('') + '</row>').join('');
    return '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
  }

  function _pmColumnName(index) {
    let name = '';
    let n = index;
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function _pmXmlEscape(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function _pmZipStore(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    Object.entries(files).forEach(([name, text]) => {
      const nameBytes = _pmUtf8(name);
      const data = _pmUtf8(text);
      const crc = _pmCrc32(data);
      const local = _pmZipHeader(0x04034b50, nameBytes, data, crc, offset);
      parts.push(local, data);
      central.push(_pmZipHeader(0x02014b50, nameBytes, data, crc, offset));
      offset += local.length + data.length;
    });
    const centralOffset = offset;
    central.forEach(part => { parts.push(part); offset += part.length; });
    parts.push(_pmEndCentral(central.length, offset - centralOffset, centralOffset));
    return _pmConcat(parts);
  }

  function _pmZipHeader(signature, nameBytes, data, crc, offset) {
    const isCentral = signature === 0x02014b50;
    const size = isCentral ? 46 : 30;
    const out = new Uint8Array(size + nameBytes.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, signature, true);
    if (isCentral) {
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint32(16, crc, true);
      view.setUint32(20, data.length, true);
      view.setUint32(24, data.length, true);
      view.setUint16(28, nameBytes.length, true);
      view.setUint32(42, offset, true);
      out.set(nameBytes, 46);
    } else {
      view.setUint16(4, 20, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, nameBytes.length, true);
      out.set(nameBytes, 30);
    }
    return out;
  }

  function _pmEndCentral(count, size, offset) {
    const out = new Uint8Array(22);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, size, true);
    view.setUint32(16, offset, true);
    return out;
  }

  function _pmUtf8(value) {
    return new TextEncoder().encode(String(value || ''));
  }

  function _pmConcat(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    parts.forEach((part) => {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function _pmCrc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  }

  window.openProductionManagementStart = openProductionManagementStart;
  window.openProductionShiftImport = openProductionShiftImport;
  window.openProductionTaskCreate = openProductionTaskCreate;
  window.runProductionAssignment = runProductionAssignment;
  window.runProductionExternalSync = runProductionExternalSync;
  window.openProductionExport = openProductionExport;
  window.MeldexCloudShiftSync = { sync: _pmSyncCloudShiftEvent, remove: _pmRemoveCloudShiftEvent };
  window.MeldexProductionManagement = {
    parseCsv: PM_SHIFT_PARSER.parseCsv,
    rowsToShifts: PM_SHIFT_PARSER.rowsToShifts,
    buildTaskRows: _pmBuildTaskRows,
    async renameCloudManagedEntry(body) {
      const internals = window.__MeldexPwaDataAccessInternals;
      if (!internals) throw new Error('Cloudデータ操作を利用できません');
      const provider = await internals._requirePwaProvider('readwrite');
      return _pmCloudRenameManagedEntry(provider, internals, body || {});
    },
  };

  _pmInstallCloudHandler();
  _pmStartExternalSyncTimer();
})();
