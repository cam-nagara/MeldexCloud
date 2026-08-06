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
    // タスクリスト（+作品別シート）だけ内部専用列を production_internal へ振り分ける
    // （制作管理UX改善計画 2026-08-04 §5-1）。作品リスト等の同名列（階層ラベル/プリセット
    // 種別/作業作成粒度）は対象外（_pmCloudIsTaskSheetName で先に判定してから適用する）。
    const isTaskSheet = _pmCloudIsTaskSheetName(sheet);
    if (isTaskSheet) fm.production_internal = { ...(fm.production_internal || {}) };
    Object.entries(props || {}).forEach(([prop, value]) => {
      if (value == null || value === '') return;
      if (_pmCloudIsInternalMetadataProp(isTaskSheet, prop)) {
        fm.production_internal[prop] = String(value);
        return;
      }
      fm.properties[prop] = [{ value: String(value), status: '採用', note: '', created: new Date().toISOString() }];
    });
    if (typeof options.beforeWrite === 'function') await options.beforeWrite(path);
    await provider.writeText(path, _pmCloudFrontmatterText(fm, parsed.body || ''));
    return path;
  }

  // コミット前レビュー指摘 #16: タスクシートへの直接プロパティ書込み
  // （_pmCloudUpsertEntry / _pmCloudUpdateEntryAtPath / _pmCloudApplyEntryUpdates）で共通
  // して使う、内部メタデータキーの振り分け判定。isTaskSheet（真偽値。呼び出し側が物理
  // シート名や論理シート名から先に判定する）かつ PM_INTERNAL_METADATA_PROPERTIES に
  // 含まれる列なら production_internal へ、それ以外は通常の properties へ書く。
  function _pmCloudIsInternalMetadataProp(isTaskSheet, prop) {
    return !!isTaskSheet && PM_INTERNAL_METADATA_PROPERTIES.has(prop);
  }

  // _pmCloudUpdateEntryAtPath は sheet名を引数で受け取らないため、対象パスが
  // `制作管理/シート/<シート名>/...` の形かどうかから物理シート名を復元する
  // （PM_ROOTはpart01.jsで定義済み。同じ共有クロージャのため直接参照できる）。
  function _pmCloudSheetNameFromPath(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const prefix = `${PM_ROOT}/シート/`;
    if (!normalized.startsWith(prefix)) return '';
    return normalized.slice(prefix.length).split('/').filter(Boolean)[0] || '';
  }

  // 既存エントリをパス指定で直接更新する（キー検索に依存しない。割り当て結果の書き戻し用）
  async function _pmCloudUpdateEntryAtPath(provider, path, props, cachedEntry = null) {
    const parsed = cachedEntry || await _pmCloudReadFrontmatter(provider, path);
    const fm = { ...(parsed.frontmatter || {}) };
    fm.type = fm.type || 'settings-entry';
    fm.modified = new Date().toISOString();
    fm.properties = { ...(fm.properties || {}) };
    // コミット前レビュー指摘 #16: タスクシートへ書き戻す場合、内部メタデータキー
    // （作成キー・階層パス等）は properties ではなく production_internal へ振り分ける
    // （_pmCloudUpsertEntry / _pmCloudApplyEntryUpdates と同じ判定を共通化して再利用。
    // これが無いと、再計算エンジンの割当結果書き戻しのたびに内部専用列が生JSONの
    // properties へ復活し、列一覧・フィルタ候補に再び現れてしまう）。
    const isTaskSheet = _pmCloudIsTaskSheetName(_pmCloudSheetNameFromPath(path));
    if (isTaskSheet) fm.production_internal = { ...(fm.production_internal || {}) };
    Object.entries(props || {}).forEach(([prop, value]) => {
      if (value == null || value === '') return;
      if (_pmCloudIsInternalMetadataProp(isTaskSheet, prop)) {
        fm.production_internal[prop] = String(value);
        return;
      }
      fm.properties[prop] = [{ value: String(value), status: '採用', note: '', created: new Date().toISOString() }];
    });
    if (isTaskSheet && fm.production_internal && !Object.keys(fm.production_internal).length) delete fm.production_internal;
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
    const rows = await _pmCloudMapBounded(files, options.concurrency || 1, async entry => {
      const path = internals._joinPath(dir, entry.name);
      const parsed = await _pmCloudReadFrontmatter(provider, path);
      return { path, name: entry.name.replace(/\.md$/i, ''), frontmatter: parsed.frontmatter || {}, body: parsed.body || '' };
    });
    // ストア汚染の過渡期フォールバック（production-sheet-store-contamination-fix-plan-
    // 2026-08-05.md Phase 3）: 修復（_repairProductionSheetStoreIfNeeded）が走る前の
    // 1リクエスト目や旧版クライアント併走時に、sheet-store にしか無い行をベストエフォート
    // で合流させ、重複作成・編集不能(404)・目標時間の計算誤りを防ぐ。同名は物理.md優先。
    // 修復完了後は storeファイル自体が無いため、この読み取りは即失敗して素通りする。
    try {
      const store = await provider.readJson(internals._joinPath(dir, '_meldex_sheet.cloud.json'));
      if (store && store.rows && typeof store.rows === 'object') {
        const seen = new Set(rows.map(row => (row.name + '.md').toLowerCase()));
        Object.values(store.rows).forEach((row) => {
          const fileName = String(row?.file_name || '').trim();
          if (!fileName || !fileName.toLowerCase().endsWith('.md')) return;
          if (fileName.startsWith('_') || fileName === sheet + '.md') return;
          if (seen.has(fileName.toLowerCase())) return;
          if (String(row?.frontmatter?.type || '') !== 'settings-entry') return;
          rows.push({
            path: internals._joinPath(dir, fileName),
            name: fileName.replace(/\.md$/i, ''),
            frontmatter: row.frontmatter || {},
            body: String(row.body || ''),
          });
        });
      }
    } catch (err) { /* sheet-store未使用（修復済み・正常状態）。物理ファイルの結果のみで進める */ }
    return rows;
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
    // production_internal の値も一覧・詳細パネル・サイドバー（gb-tool-calendar-production-
    // sidebar.js の階層レベル表示・編集フォーム等）が読めるようにここで合流させる
    // （制作管理UX改善計画 2026-08-04 §5-1）。列一覧・列タイプ設定・フィルタ候補は
    // property_types 宣言（＝スキーマ）で決まるため、ここに含めても列としては出てこない。
    const internal = entry?.frontmatter?.production_internal;
    if (internal && typeof internal === 'object') {
      Object.entries(internal).forEach(([name, value]) => {
        if (!(name in properties) && value !== null && value !== undefined && value !== '') {
          properties[name] = String(value);
        }
      });
    }
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
    // 制作管理UX改善計画（2026-08-04）§5-1: タスクリストの内部専用列は production_internal
    // を優先し、旧データ（properties に残ったまま）はフォールバックで読める。
    if (PM_INTERNAL_METADATA_PROPERTIES.has(prop)) {
      const internal = fm && fm.production_internal;
      if (internal && typeof internal === 'object' && Object.prototype.hasOwnProperty.call(internal, prop)) {
        const value = internal[prop];
        if (value !== null && value !== undefined && value !== '') return String(value);
      }
    }
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

  function _pmCloudMutationJournal(provider, internals) {
    return { provider, internals, texts: new Map(), calendars: new Map(), dirs: new Map(), createdPaths: new Set() };
  }
  function _pmCloudJournalCreatedPath(journal, path) {
    const key = _pmCloudNormalizePath(path);
    if (!key) throw new Error('ロールバック対象の作成先を確認できません');
    journal.createdPaths.add(key);
  }
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
    for (const path of [...journal.createdPaths].reverse()) {
      try { await _pmCloudDeleteRollbackPath(journal, path); }
      catch (error) { failures.push(error); }
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
    // 内部専用列（production_internal行き）はユーザー向けスキーマに存在しなくても許可する
    // （制作管理UX改善計画 2026-08-04 §5-1）。この経路へ内部列名が来るのは自動追従フック・
    // タスク詳細サイドバーの階層レベル欄など内部呼び出しのみで、ユーザーが手でこの列名を
    // 追加することはできない（列一覧・列タイプ設定に出ないため）。
    const isTaskSheet = logicalSheet === 'タスクリスト';
    const internalNames = new Set(Object.keys(updates).filter(name => _pmCloudIsInternalMetadataProp(isTaskSheet, name)));
    const unknown = Object.keys(updates).filter(name => !Object.prototype.hasOwnProperty.call(schema, name) && !internalNames.has(name));
    if (unknown.length) throw _pmCloudError(400, '存在しない項目です: ' + unknown.join(', '));
    const fm = {
      ...(frontmatter || {}),
      properties: { ...(frontmatter?.properties || {}) },
      production_internal: { ...(frontmatter?.production_internal || {}) },
      modified: new Date().toISOString(),
    };
    Object.entries(updates).forEach(([name, value]) => {
      if (internalNames.has(name)) {
        const text = value == null ? '' : String(value).trim();
        if (text) fm.production_internal[name] = text;
        else delete fm.production_internal[name];
        delete fm.properties[name];
        return;
      }
      const normalized = _pmCloudNormalizeEntryValue(schema[name], value);
      if (normalized === '') delete fm.properties[name];
      else fm.properties[name] = [{ value: normalized, status: '採用', note: '', created: new Date().toISOString() }];
      if (isTaskSheet && PM_CLOUD_LEVEL_COUNTERPART[name]) {
        delete fm.properties[PM_CLOUD_LEVEL_COUNTERPART[name]];
        delete fm.production_internal[PM_CLOUD_LEVEL_COUNTERPART[name]];
      }
    });
    if (!Object.keys(fm.production_internal).length) delete fm.production_internal;
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
    // 制作管理UX改善計画（2026-08-04）§5-1「開始日時・完了日時」: タスク詳細サイドバーの
    // PATCH経路（Desktop _patch_production_entry_locked のCloud対応）でも状況変更を拾う。
    if (sheet === 'タスクリスト') _pmCloudApplyStatusTimestampHook(entry.path, fm);
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
      // 制作管理UX改善計画（2026-08-04）§6-3: タスクの「対象色」をイベント色へ反映する
      // （未設定時は現行の既定色）。カレンダー自体の既定色は変えない（Desktop
      // meldex_production_management._upsert_work_event と同じ方針）。
      const eventColor = String(_pmCloudPropValue(fm, '対象色') || '').trim() || '#569cd6';
      segments.forEach((segment, index) => {
        const id = index ? `${baseId}:part:${index + 1}` : baseId;
        const old = before.find(event => String(event?.id || '') === id);
        const detail = ['元シート: ' + path, work && '作品タイトル: ' + work, key && '作成キー: ' + key, locked && '再計算ロック: true', segments.length > 1 && `作業区間: ${index + 1}/${segments.length}`].filter(Boolean).join('\n');
        events.push({ id, title: internals._basename(path).replace(/\.md$/i, ''), start: segment.start, end: segment.end, all_day: 0, color: eventColor, description: detail, location: '', url: key ? `production-task-key:${key}` : '', recurrence: '', external_id: taskId, calendar_source: 'production-task', user, creator: user, calendar_id: calendarId, alert_minutes: -1, created: old?.created || now, modified: now });
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
      // 分類（作業対象・作業内容・作業規模）が揃っている場合のみ、目標作業時間_値／
      // 目標作業時間を計算式（基準×内容倍率×規模倍率×対象数）で上書きする。分類が1つでも
      // 欠けている場合はテンプレートの目標作業時間_値（分類が無い場合の手動指定値）を温存する。
      await _pmCloudApplyTemplateInstanceDuration(provider, internals, props);
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

  // 対象数は既定1。0以下・非数（空欄含む）は1扱いにする（設計文書の計算式
  // 基準時間×内容倍率×規模倍率×対象数のうち対象数側の丸め規則）。
  function _pmCloudTargetCountNumber(value) {
    const text = String(value == null ? '' : value).trim();
    const parsed = text ? Number(text) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  async function _pmCloudApplyTaskDurations(provider, internals, rows) {
    const maps = await _pmCloudTaskDurationMaps(provider, internals);
    (rows || []).forEach(row => {
      const targetHours = maps.targets.get(String(row?.['作業対象リスト'] || '')) ?? 1;
      const contentRatio = maps.contents.get(String(row?.['作業内容リスト'] || '')) ?? 1;
      const scaleRatio = maps.scales.get(String(row?.['作業規模リスト'] || '')) ?? 1;
      const targetCount = _pmCloudTargetCountNumber(row?.['対象数']);
      const hoursText = _pmCloudDurationText(Math.max(0.01, targetHours * contentRatio * scaleRatio * targetCount));
      row['目標作業時間_値'] = hoursText;
      row['目標作業時間'] = `${hoursText}時間`;
    });
    return rows;
  }

  // テンプレート生成・カレンダードロップ経路（_pmCloudCreateFromTemplate）用: 作業対象・
  // 作業内容・作業規模の3分類が揃っている場合だけ計算式で目標作業時間_値／目標作業時間を
  // 上書きする。分類が1つでも欠けている場合はテンプレートの明示値（手動指定値）を温存する。
  async function _pmCloudApplyTemplateInstanceDuration(provider, internals, props) {
    const target = String(props?.['作業対象リスト'] || '').trim();
    const content = String(props?.['作業内容リスト'] || '').trim();
    const scale = String(props?.['作業規模リスト'] || '').trim();
    if (!target || !content || !scale) return props;
    await _pmCloudApplyTaskDurations(provider, internals, [props]);
    return props;
  }

  // シート編集経路（Cloud）で作業対象/作業内容/作業規模/対象数のセルが変更された時、
  // 目標作業時間_値・目標作業時間を再計算する単一の入口。gb-data-access-dropbox-expanded
  // .part01.js の _updateValue / _updateSheetStoreValue / _addValue / _addSheetStoreValue
  // から window.MeldexProductionManagement.applyTaskDurationRecalcOnValueUpdate() 経由で
  // 呼ばれる。後続フェーズ（タスク名自動更新のCloud対応）でも同じ入口に処理を足す想定。
  const PM_DURATION_RECALC_TRIGGER_PROPS = new Set(['作業対象リスト', '作業内容リスト', '作業規模リスト', '対象数']);

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
    const spread = text.match(new RegExp('^' + prefix + '?(\\d+)\\s*[-–—~〜～/・]\\s*' + prefix + '?(\\d+)$', 'i'));
    if (spread && Number(spread[2]) === Number(spread[1]) + 1) {
      return _pmFormatUnitLabel(Number(spread[1]), prefix) + '-' + _pmFormatUnitLabel(Number(spread[2]), prefix);
    }
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

  // フル再計算エンジン（gb-production-recalc-engine-cloud-adapter.js、別クロージャ）向けの依存
  // 注入。_pmCloudTaskStructureDeps() と同じ流儀（part01.js/part02.js は同一IIFEなので、
  // どちらに置いてもprivateヘルパーへ同様にアクセスできる）。
  function _pmRecalcEngineDeps() {
    return {
      listEntries: _pmCloudListEntries, listAllTaskEntries: _pmCloudListAllTaskEntries, init: _pmCloudInit,
      mutationJournal: _pmCloudMutationJournal, journalText: _pmCloudJournalText, journalCalendar: _pmCloudJournalCalendar,
      rollbackMutation: _pmCloudRollbackMutation, syncTaskEvent: _pmCloudSyncTaskEvent,
      readCalendarStore: _pmReadCalendarStore, writeCalendarStore: _pmWriteCalendarStore,
      // タスク作成系のCloud機能が同じ書込みヘルパーを使えるよう、追加の参照も
      // 上乗せする（_pmRecalcEngineDeps()のスーパーセット）。
      propValue: _pmCloudPropValue, writeNewEntry: _pmCloudWriteNewEntry,
      ensureTaskSheetForWork: _pmCloudEnsureTaskSheetForWork, journalDirectory: _pmCloudJournalDirectory,
    };
  }

  function _pmCloudTaskStructureDeps() {
    return {
      propValue: _pmCloudPropValue,
      belongsToWork: _pmCloudTaskBelongsToWork,
      hash: _pmHash,
      findWork: _pmCloudFindWork,
      listTasks: _pmCloudListAllTaskEntries,
      buildRows: _pmBuildTaskRows,
      validateRows: _pmCloudValidateTaskRows,
      error: _pmCloudError,
      init: _pmCloudInit,
      mutationJournal: _pmCloudMutationJournal,
      root: _pmCloudRoot,
      journalDirectory: _pmCloudJournalDirectory,
      journalText: _pmCloudJournalText,
      ensureSheet: _pmCloudEnsureSheet,
      uniqueEntryPath: _pmCloudUniqueEntryPath,
      clone: _pmCloudClone,
      frontmatterText: _pmCloudFrontmatterText,
      writeNewEntry: _pmCloudWriteNewEntry,
      updateEntry: _pmCloudUpdateEntryAtPath,
      rollback: _pmCloudRollbackMutation,
    };
  }

  function _pmCloudPreviewTaskStructure(provider, internals, body) {
    return window.MeldexProductionCloudTaskStructure.preview(
      provider,
      internals,
      body,
      _pmCloudTaskStructureDeps(),
    );
  }

  function _pmCloudApplyTaskStructure(provider, internals, body) {
    return window.MeldexProductionCloudTaskStructure.apply(
      provider,
      internals,
      body,
      _pmCloudTaskStructureDeps(),
    );
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


  window.openProductionManagementStart = openProductionManagementStart;
  window.openProductionShiftImport = openProductionShiftImport;
  window.openProductionTaskCreate = openProductionTaskCreate;
  window.runProductionExternalSync = runProductionExternalSync;
  window.openProductionExport = openProductionExport;
  window.MeldexCloudShiftSync = { sync: _pmSyncCloudShiftEvent, remove: _pmRemoveCloudShiftEvent };
  window.MeldexProductionManagement = {
    parseCsv: PM_SHIFT_PARSER.parseCsv,
    rowsToShifts: PM_SHIFT_PARSER.rowsToShifts,
    buildTaskRows: _pmBuildTaskRows,
    // コミット前レビュー指摘 #17: Desktop meldex_production_management_support.
    // INTERNAL_METADATA_PROPERTIES とJS側複製の集合一致をテストで検証できるよう公開する
    // （test_meldex_production_schema_cleanup.py）。
    INTERNAL_METADATA_PROPERTIES: PM_INTERNAL_METADATA_PROPERTIES,
    async renameCloudManagedEntry(body) {
      const internals = window.__MeldexPwaDataAccessInternals;
      if (!internals) throw new Error('Cloudデータ操作を利用できません');
      const provider = await internals._requirePwaProvider('readwrite');
      return _pmCloudRenameManagedEntry(provider, internals, body || {});
    },
    // gb-data-access-dropbox-expanded.part01.js のセル値保存経路（_updateValue /
    // _updateSheetStoreValue / _addValue / _addSheetStoreValue）から呼ばれる、タスクリスト
    // セル保存時の自動追従フックの単一入口。目標作業時間の分類変更追従（changedProperty で
    // ゲート）と、状況変更に伴う開始日時・完了日時の自動記録（changedProperty を問わず毎回
    // チェック。production-management-ux-improvement-plan-2026-08-04.md §5-1）の2つをここで
    // まとめる。タスクリスト系シート以外・保護対象行では何もしない（false を返す）。
    async applyTaskDurationRecalcOnValueUpdate(provider, path, frontmatter, changedProperty) {
      const durationChanged = await _pmCloudApplyDurationRecalcHook(provider, path, frontmatter, changedProperty);
      const timestampChanged = _pmCloudApplyStatusTimestampHook(path, frontmatter);
      return durationChanged || timestampChanged;
    },
    // gb-data-access-dropbox-expanded.part01.js の汎用エントリ作成経路（_createEntity）から
    // 呼ばれる、作業内容リストへ行を直接追加した時の作業順自動採番の単一入口
    // （production-management-ux-improvement-plan-2026-08-04.md §5-3）。対象外シート・
    // 既に値がある行では何もしない（false を返す）。
    async applyWorkOrderDefaultOnEntityCreate(provider, path, frontmatter) {
      return _pmCloudApplyWorkOrderDefault(provider, path, frontmatter);
    },
    // gb-data-access-dropbox-expanded.part01.js の4つの値書込み関数（_updateValue /
    // _addValue / _updateSheetStoreValue / _addSheetStoreValue）から「書込み完了後」に
    // 呼ばれる、タスク名自動更新（管理付きリネーム込み）の単一入口（Stage 4）。
    async applyTaskNameAutoRenameOnValueUpdate(provider, path, frontmatter) {
      return _pmCloudApplyTaskNameAutoRename(provider, path, frontmatter);
    },
    // テスト・診断用に内部関数も公開する（gb-cal-cloud-sync.js の _internal と同じ方針。
    // コミット前レビュー指摘 #16: _pmCloudUpdateEntryAtPath の内部メタデータ振り分けゲートを
    // 直接検証できるようにする）。
    _internal: {
      updateEntryAtPath: _pmCloudUpdateEntryAtPath,
    },
  };

  _pmInstallCloudHandler();
  _pmStartExternalSyncTimer();
