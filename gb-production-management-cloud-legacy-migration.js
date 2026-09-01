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

  const PM_WORK_TEMPLATE_SHEET = '作業テンプレート';
  const PM_WORK_TEMPLATE_RELATION = '作業テンプレート';
  const PM_WORK_TEMPLATE_DEFAULT_NAME = '既定の作業テンプレート';
  const PM_WORK_TEMPLATE_CHILD_SHEETS = ['タスクテンプレート', '作業対象リスト', '作業内容リスト', '作業規模リスト'];

  async function _pmCloudEnsureDefaultWorkTemplate(provider, internals) {
    const entries = await _pmCloudListEntries(provider, internals, PM_WORK_TEMPLATE_SHEET);
    let entry = entries.find(item => item.name === PM_WORK_TEMPLATE_DEFAULT_NAME
      || _pmCloudPropValue(item.frontmatter, 'テンプレート名') === PM_WORK_TEMPLATE_DEFAULT_NAME);
    let created = false;
    if (!entry) {
      const path = await _pmCloudUpsertEntry(provider, internals, PM_WORK_TEMPLATE_SHEET,
        PM_WORK_TEMPLATE_DEFAULT_NAME, { 'テンプレート名': PM_WORK_TEMPLATE_DEFAULT_NAME, 'リビジョン': '1' },
        'テンプレート名', PM_WORK_TEMPLATE_DEFAULT_NAME, { reuseName: true, createNew: true });
      const parsed = await _pmCloudReadFrontmatter(provider, path);
      entry = { path, name: PM_WORK_TEMPLATE_DEFAULT_NAME, frontmatter: parsed.frontmatter || {}, body: parsed.body || '' };
      created = true;
    }
    return { path: entry.path, id: String(entry.frontmatter?.id || _pmHash(entry.path).slice(0, 12)), created };
  }

  function _pmCloudMigrationCandidate(value) {
    return [{ value: String(value), status: '採用', note: '', created: new Date().toISOString() }];
  }

  async function _pmCloudMigrateTemplateMembership(provider, internals) {
    const workTemplate = await _pmCloudEnsureDefaultWorkTemplate(provider, internals);
    const snapshots = new Map();
    const updates = [];
    let workEntries = [];
    for (const sheet of [...PM_WORK_TEMPLATE_CHILD_SHEETS, '作品リスト']) {
      const entries = await _pmCloudListEntries(provider, internals, sheet);
      if (sheet === '作品リスト') workEntries = entries;
      for (const entry of entries) {
        const fm = { ...(entry.frontmatter || {}), properties: { ...(entry.frontmatter?.properties || {}) } };
        let changed = false;
        if (PM_WORK_TEMPLATE_CHILD_SHEETS.includes(sheet) && !String(fm.production_template_child_name || '').trim()) {
          fm.production_template_child_name = entry.name;
          changed = true;
        }
        if (sheet === '作業内容リスト' && Object.prototype.hasOwnProperty.call(fm.properties, '表示名')) {
          const oldDisplayName = _pmCloudPropValue(fm, '表示名').trim();
          delete fm.properties['表示名'];
          const oldNote = _pmCloudPropValue(fm, '備考').trim();
          const preserved = !!oldDisplayName && oldDisplayName !== entry.name;
          if (preserved && !oldNote.split('\n').includes(`旧表示名: ${oldDisplayName}`)) {
            fm.properties['備考'] = _pmCloudMigrationCandidate([oldNote, `旧表示名: ${oldDisplayName}`].filter(Boolean).join('\n'));
          }
          const history = Array.isArray(fm.production_template_membership_migration)
            ? [...fm.production_template_membership_migration] : [];
          history.push({ migrated_at: new Date().toISOString(), removed_property: '表示名',
            old_value: oldDisplayName, entry_name: entry.name, preserved_in_note: preserved });
          fm.production_template_membership_migration = history;
          changed = true;
        }
        const relation = sheet === '作品リスト' ? '使用する作業テンプレート' : PM_WORK_TEMPLATE_RELATION;
        if (!_pmCloudPropValue(fm, relation)) {
          fm.properties[relation] = _pmCloudMigrationCandidate(workTemplate.id);
          changed = true;
        }
        if (changed) {
          fm.modified = new Date().toISOString();
          snapshots.set(entry.path, typeof entry.sourceText === 'string'
            ? entry.sourceText
            : await provider.readText(entry.path));
          updates.push({ entry, frontmatter: fm });
        }
      }
    }
    try {
      for (const update of updates) {
        const text = _pmCloudFrontmatterText(update.frontmatter, update.entry.body || '');
        await provider.writeText(update.entry.path, text);
        // 後続の旧タスクリスト移行へ同じ一覧を渡すため、書込み後の正本状態へ更新する。
        // 古いfrontmatterを渡すと作品行の更新時にテンプレート所属を巻き戻し、次回initで
        // 同じ4行を再移行してしまう。
        update.entry.frontmatter = update.frontmatter;
        update.entry.sourceText = text;
      }
    } catch (error) {
      for (const [path, text] of snapshots) await provider.writeText(path, text);
      if (workTemplate.created && typeof provider.deletePath === 'function') {
        await provider.deletePath(workTemplate.path);
      }
      throw error;
    }
    return { migrated: updates.length, template_id: workTemplate.id, work_entries: workEntries };
  }

  function _pmCloudProductionSourceId(provider, internals) {
    const parsed = window.MeldexSourceFolderRegistry?.parseSourcePath?.(_pmCloudRoot(internals));
    return String(parsed?.sourceId || provider?.sourceId || provider?.id || 'source');
  }

  async function _pmCloudEnsureTaskTopic(provider, internals, entry) {
    const fm = { ...(entry.frontmatter || {}) };
    const sourceId = String(fm.topicRef?.sourceId || _pmCloudProductionSourceId(provider, internals));
    const topicId = String(fm.topicRef?.topicId || fm.id || ('production-' + _pmHash(entry.path).slice(0, 24)));
    const topicRef = { sourceId, topicId };
    const topicPath = `_meldex/topics/v1/sources/${encodeURIComponent(sourceId)}/records/${encodeURIComponent(topicId)}.json`;
    const now = new Date().toISOString();
    const envelope = { schemaVersion: 1, topicRef, record: { topicId, title: entry.name,
      properties: {}, propertyValuesByFamilyId: {}, propertyValueOrder: [], note: null, resources: [],
      revision: 1, schemaVersion: 1, createdAt: now, updatedAt: now, updatedBy: null },
      createdByMutationId: `production-task-link-${topicId}`, updatedAt: now };
    if (typeof provider.writeJsonMerged === 'function') {
      await provider.writeJsonMerged(topicPath, current => current?.record ? current : envelope,
        { fallbackValue: {}, retries: 4 });
    } else {
      try { await provider.readText(topicPath); } catch (error) {
        if (!_pmCloudIsNotFoundError(error)) throw error;
        await provider.writeText(topicPath, JSON.stringify(envelope));
      }
    }
    if (fm.topicRef?.sourceId === sourceId && fm.topicRef?.topicId === topicId) return topicRef;
    fm.topicRef = topicRef;
    fm.modified = now;
    await provider.writeText(entry.path, _pmCloudFrontmatterText(fm, entry.body || ''));
    return topicRef;
  }

  async function _pmCloudEnsureTaskTopics(provider, internals, taskSheet, cachedEntries = null) {
    let migrated = 0;
    const entries = Array.isArray(cachedEntries)
      ? cachedEntries
      : await _pmCloudListEntries(provider, internals, taskSheet, { concurrency: 8 });
    await _pmCloudMapBounded(entries, 4, async entry => {
      const before = entry.frontmatter?.topicRef;
      await _pmCloudEnsureTaskTopic(provider, internals, entry);
      if (!before?.sourceId || !before?.topicId) migrated += 1;
    });
    return { migrated };
  }

  function _pmCloudTopicResourceId(mutationId) {
    return 'production-resource-' + _pmHash(String(mutationId)).slice(0, 24);
  }

  async function _pmCloudCreateTopicResource(provider, internals, body) {
    const ref = body?.topicRef || body?.topic_ref || {};
    const sourceId = String(ref.sourceId || '').trim(), topicId = String(ref.topicId || '').trim();
    const kind = String(body?.type || '').trim().toLowerCase();
    const mutationId = String(body?.mutation_id || body?.mutationId || '').trim();
    if (!sourceId || !topicId) throw _pmCloudError(400, 'TopicRefを確認できません');
    if (!['note', 'chat'].includes(kind)) throw _pmCloudError(400, 'type は note または chat を指定してください');
    if (!/^[A-Za-z0-9._:-]{8,255}$/.test(mutationId)) throw _pmCloudError(400, 'mutation_id が不正です');
    const topicPath = `_meldex/topics/v1/sources/${encodeURIComponent(sourceId)}/records/${encodeURIComponent(topicId)}.json`;
    let envelope;
    try { envelope = JSON.parse(await provider.readText(topicPath)); }
    catch (error) { if (_pmCloudIsNotFoundError(error)) throw _pmCloudError(404, 'Topic正本が見つかりません'); throw error; }
    const existing = (envelope?.record?.resources || []).find(item => item?.creationMutationId === mutationId);
    if (existing) return { ok: true, idempotent: true, topicRef: { sourceId, topicId }, resource: existing, record: envelope.record };
    const resourceId = _pmCloudTopicResourceId(mutationId);
    const fallbackLabel = kind === 'note' ? '新規ノート' : '新規チャット';
    const label = String(body?.label || fallbackLabel).trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || fallbackLabel;
    const user = String(body?.current_user || global.state?.currentUser?.name || global.currentUser?.name || global.currentUser || 'anonymous')
      .replace(/[\\/:*?"<>|]+/g, '_') || 'anonymous';
    const userSegment = user === '.' || user === '..' ? 'anonymous' : user;
    const resourcePath = kind === 'note'
      ? `_meldex/topics/v1/resources/${encodeURIComponent(topicId)}/${resourceId}.md`
      : `_chat/llm/${userSegment}/${label}-${resourceId.slice(-8)}.md`;
    const created = new Date().toISOString();
    const content = kind === 'note'
      ? `---\nmeldex:\n  metadata_version: 1\n  document_id: ${JSON.stringify(resourceId)}\n---\n# ${label}\n\n`
      : `---\ntype: chat\nprovider: ''\nmodel: ''\ncreated: ${created}\ntags: []\nuser: ${JSON.stringify(user)}\nowner: ${JSON.stringify(user)}\ntitle: ${JSON.stringify(label)}\nmessages: []\n---\n\n`;
    let wroteResource = false;
    try {
      let currentText = '';
      try { currentText = await provider.readText(resourcePath); }
      catch (error) { if (!_pmCloudIsNotFoundError(error)) throw error; }
      if (currentText && currentText !== content) throw _pmCloudError(409, '同じ作成IDの保存先に別のファイルがあります');
      if (!currentText) { await provider.writeText(resourcePath, content); wroteResource = true; }
      const resource = { resourceId, resourceType: kind === 'note' ? 'note-link' : 'chat-link', href: resourcePath,
        label, creationMutationId: mutationId };
      const updateEnvelope = current => {
        const base = current?.record ? current : envelope;
        const resources = Array.isArray(base.record.resources) ? [...base.record.resources] : [];
        if (!resources.some(item => item?.creationMutationId === mutationId)) resources.push(resource);
        return { ...base, record: { ...base.record, resources, revision: Number(base.record.revision || 0) + 1,
          updatedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
      };
      let saved;
      if (typeof provider.writeJsonMerged === 'function') saved = await provider.writeJsonMerged(topicPath, updateEnvelope, { fallbackValue: envelope, retries: 4 });
      else { saved = updateEnvelope(envelope); await provider.writeText(topicPath, JSON.stringify(saved)); }
      const finalEnvelope = saved?.record ? saved : JSON.parse(await provider.readText(topicPath));
      return { ok: true, idempotent: false, topicRef: { sourceId, topicId }, resource, record: finalEnvelope.record };
    } catch (error) {
      let linkedByConcurrentRetry = false;
      try {
        const latest = JSON.parse(await provider.readText(topicPath));
        linkedByConcurrentRetry = (latest?.record?.resources || []).some(item => item?.creationMutationId === mutationId);
      } catch (_readLatestError) {}
      if (linkedByConcurrentRetry) {
        const latest = JSON.parse(await provider.readText(topicPath));
        const linked = latest.record.resources.find(item => item?.creationMutationId === mutationId);
        return { ok: true, idempotent: true, topicRef: { sourceId, topicId }, resource: linked, record: latest.record };
      }
      if (wroteResource && typeof provider.deletePath === 'function') {
        try { if (await provider.readText(resourcePath) === content) await provider.deletePath(resourcePath); } catch (_cleanupError) {}
      }
      throw error;
    }
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

  async function _pmCloudMigrateLegacyWorkspace(
    provider, internals, cachedWorkEntries = null, defaultTemplateId = ''
  ) {
    const workEntries = Array.isArray(cachedWorkEntries)
      ? cachedWorkEntries
      : await _pmCloudListEntries(provider, internals, '作品リスト', { concurrency: 8 });
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
        if (defaultTemplateId) props['使用する作業テンプレート'] = defaultTemplateId;
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
