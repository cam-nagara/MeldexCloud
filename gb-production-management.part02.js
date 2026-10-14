  // gb-production-management.part02.js: 責務単位分割（2026-08-12）後もこのファイル名を
  // 維持している。tests/test_meldex_phase_e_board_timer_quickmemo_viewer.py の
  // ロールバック回帰テストが、_pmCloudRollbackMutation の関数本体をこの物理ファイルから
  // Node上でbrace抽出してevalする直読み検証を行っているため（このリファクタの編集許可
  // 範囲外のテスト）。そのため、このファイルには変更のロールバック機構（ミューテーション
  // ジャーナル）と、それを使う汎用エントリ作成・更新（/production-management/entries）だけを
  // 残す（他の責務は gb-production-management-cloud-*.js へ分離済み）。

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
  function _pmCloudSetRollbackRevision(journal, path, revision) {
    const snapshot = journal.texts.get(_pmCloudNormalizePath(path));
    if (!snapshot) throw new Error('ロールバック対象の保存前状態を確認できません');
    snapshot.rollbackExpectedRevision = String(revision || '').trim();
    if (!snapshot.rollbackExpectedRevision) {
      snapshot.rollbackRevisionUnavailable = true;
      throw new Error('ロールバック対象の保存後版を確認できません');
    }
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
      try {
        if (snapshot.rollbackRevisionUnavailable) throw new Error(`条件付き復元に必要な保存後版がありません: ${path}`);
        if (snapshot.exists && snapshot.rollbackExpectedRevision) {
          if (typeof journal.provider.uploadBytesConditional !== 'function') throw new Error(`条件付き復元を実行できません: ${path}`);
          await journal.provider.uploadBytesConditional(path, new TextEncoder().encode(snapshot.text), snapshot.rollbackExpectedRevision);
        } else if (snapshot.exists) await journal.provider.writeText(path, snapshot.text);
        else await _pmCloudDeleteRollbackPath(journal, path);
      }
      catch (error) {
        failures.push(error);
        // 正本のCAS復元に失敗した時点で、後続クライアントが正本とカレンダーを更新した
        // 可能性がある。共有カレンダーを古いsnapshotへ戻さず、その場で復旧失敗を返す。
        if (snapshot.rollbackExpectedRevision || snapshot.rollbackRevisionUnavailable) {
          throw new Error(`制作管理の保存に失敗し、元の状態の復元にも失敗しました: ${error?.message || error}`, { cause: originalError });
        }
      }
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

  function _pmCloudPatchPreconditions(body) {
    const hasEntry = Object.prototype.hasOwnProperty.call(body || {}, 'entry_revision')
      || Object.prototype.hasOwnProperty.call(body || {}, 'entryRevision');
    const hasTransport = Object.prototype.hasOwnProperty.call(body || {}, 'transport_revision')
      || Object.prototype.hasOwnProperty.call(body || {}, 'transportRevision');
    if (!hasEntry || !hasTransport) {
      const error = _pmCloudError(428, '保存元の版情報がありません。タスクを再読み込みしてから保存してください。');
      error.code = 'revision_precondition_required';
      throw error;
    }
    const rawEntry = body.entry_revision ?? body.entryRevision;
    const entryRevision = Number(rawEntry);
    if (!Number.isInteger(entryRevision) || entryRevision < 0) throw _pmCloudError(400, '保存元のエントリ版が不正です');
    const rawTransport = body.transport_revision ?? body.transportRevision;
    let transport = _pmCloudTransportName();
    let token = '';
    if (rawTransport && typeof rawTransport === 'object') {
      transport = String(rawTransport.transport || rawTransport.kind || transport);
      token = String(rawTransport.token || rawTransport.revision || rawTransport.etag || '');
    } else {
      const raw = String(rawTransport || '');
      const colon = raw.indexOf(':');
      if (colon > 0) { transport = raw.slice(0, colon); token = raw.slice(colon + 1); }
      else token = raw;
    }
    if (transport !== _pmCloudTransportName()) {
      const error = _pmCloudError(400, '別の保存先で取得した版情報は使用できません。');
      error.code = 'transport_mismatch';
      throw error;
    }
    if (!token) throw _pmCloudError(400, '保存元のファイル版が不正です');
    return { entryRevision, transportRevision: { transport, token } };
  }

  function _pmCloudAssertPatchCurrent(entry, expected) {
    const currentEntry = _pmCloudEntryRevision(entry.frontmatter);
    const currentTransport = entry.transportRevision || { transport: _pmCloudTransportName(), token: '' };
    if (expected.entryRevision !== currentEntry || expected.transportRevision.token !== String(currentTransport.token || '')) {
      const error = _pmCloudError(409, 'この項目は別の画面で更新されています。競合内容を確認してから保存してください。');
      error.code = 'etag_conflict';
      error.meldexCode = 'etag_conflict';
      error.currentEntryRevision = currentEntry;
      error.currentTransportRevision = currentTransport;
      throw error;
    }
    return currentEntry;
  }
  function _pmCloudPatchIsNoop(frontmatter, schema, updates) {
    return Object.entries(updates).every(([name, value]) => (
      _pmCloudPropValue(frontmatter, name).trim() === _pmCloudNormalizeEntryValue(schema[name] || {}, value).trim()
    ));
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
    if (['タスクテンプレート', '作業対象リスト', '作業内容リスト', '作業規模リスト'].includes(logicalSheet)) {
      fm.production_template_child_name = String(name);
    }
    const path = await _pmCloudUniqueEntryPath(provider, internals, physicalSheet, name, seed || `${name}|${Date.now()}|${Math.random()}`);
    fm.id = 'ent_' + _pmHash(path + '|' + seed + '|' + Math.random()).slice(0, 10);
    await _pmCloudJournalText(journal, path);
    await provider.writeText(path, _pmCloudFrontmatterText(fm, ''));
    return {
      path,
      name: internals._basename(path).replace(/\.md$/i, ''),
      sheet: physicalSheet,
      frontmatter: fm,
      body: '',
      transportRevision: await _pmCloudEntryTransportRevision(provider, path, { frontmatter: fm, body: '' }),
    };
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
    const defaultTemplate = await _pmCloudEnsureDefaultWorkTemplate(provider, internals);
    const props = onlyWhenEmpty ? {
      '階層数': '3', '階層ラベル': '中分類,小分類,詳細分類', 'プリセット種別': '汎用', '作業作成粒度': '階層単位', '状況': '進行中',
      '作業期間': `${_pmDateTimeText(new Date())}|${_pmDateTimeText(new Date(Date.now() + 30 * 86400000))}`,
      '使用する作業テンプレート': defaultTemplate.id,
    } : { '使用する作業テンプレート': defaultTemplate.id };
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
  async function _pmCloudEnsureProjectlessTaskSheet(provider, internals, journal) {
    const sheet = 'タスクリスト_未分類', dir = internals._joinPath(_pmCloudRoot(internals), sheet), note = internals._joinPath(dir, sheet + '.md'); await _pmCloudJournalDirectory(journal, dir); await _pmCloudJournalText(journal, note); await _pmCloudEnsureSheet(provider, internals, sheet, 'タスクリスト');
    const parsed = await _pmCloudReadFrontmatter(provider, note), fm = { ...(parsed.frontmatter || {}), property_types: { ...(parsed.frontmatter?.property_types || {}) } }; _pmResolveLevelPropNames('中分類,小分類,詳細分類').forEach(names => { fm.property_types[names[0]] ||= { type: 'text' }; }); await provider.writeText(note, _pmCloudFrontmatterText(fm, parsed.body || `# ${sheet}\n\n`)); return { sheet };
  }

  async function _pmCloudCreateEntry(provider, internals, body) {
    if ((await _pmCloudMissing(provider, internals)).length) await _pmCloudInit(provider, internals);
    const sheet = _pmCloudSheetAlias(body?.sheet);
    if (!PM_PROPERTY_TYPES[sheet]) throw _pmCloudError(400, '対象リストが不正です');
    const props = body?.properties && typeof body.properties === 'object' ? { ...body.properties } : {};
    const defaultTemplate = await _pmCloudEnsureDefaultWorkTemplate(provider, internals);
    if (PM_WORK_TEMPLATE_CHILD_SHEETS.includes(sheet)) {
      const requested = String(body?.template_id || body?.templateId || props[PM_WORK_TEMPLATE_RELATION] || defaultTemplate.id);
      const ids = new Set((await _pmCloudListEntries(provider, internals, PM_WORK_TEMPLATE_SHEET))
        .map(entry => String(entry.frontmatter?.id || '')));
      if (!ids.has(requested)) throw _pmCloudError(400, '指定された作業テンプレートが見つかりません');
      props[PM_WORK_TEMPLATE_RELATION] = requested;
    } else if (sheet === '作品リスト' && !String(props['使用する作業テンプレート'] || '').trim()) {
      props['使用する作業テンプレート'] = defaultTemplate.id;
    }
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
      let entry = await _pmCloudWriteNewEntry(provider, internals, sheet, physicalSheet, title, props, journal);
      if (sheet === 'タスクリスト') {
        await _pmCloudEnsureTaskTopic(provider, internals, entry);
        const reparsed = await _pmCloudReadFrontmatter(provider, entry.path);
        entry = {
          ...entry,
          frontmatter: reparsed.frontmatter || entry.frontmatter,
          body: reparsed.body || entry.body,
          transportRevision: await _pmCloudEntryTransportRevision(provider, entry.path, reparsed),
        };
      }
      return { ok: true, row: _pmCloudEntryRow(entry), cloud: true };
    } catch (error) { return _pmCloudRollbackMutation(journal, error); }
  }

  async function _pmCloudValidateTaskParentGraph(provider, internals, entry, updates) {
    const rows = (await _pmCloudRawTaskEntries(provider, internals))
      .filter(candidate => String(candidate.sheet || '') === String(entry.sheet || ''));
    const parents = new Map();
    for (const candidate of rows) {
      const id = String(candidate.frontmatter?.id || '').trim();
      if (!id) continue;
      if (parents.has(id)) throw _pmCloudError(409, '同じタスクIDが複数あるため親タスクを保存できません');
      parents.set(id, _pmCloudPropValue(candidate.frontmatter, '親タスクID'));
    }
    const targetId = String(entry.frontmatter?.id || '').trim();
    if (!targetId || !parents.has(targetId)) throw _pmCloudError(409, '対象タスクを同じタスクシート内で確認できません');
    parents.set(targetId, String(updates['親タスクID'] || '').trim());
    for (const [id, parentId] of parents) {
      if (parentId && !parents.has(parentId)) throw _pmCloudError(400, `親タスク ${parentId} は同じタスクシート内に存在しません`);
      if (parentId === id) throw _pmCloudError(400, 'タスク自身を親タスクにはできません');
    }
    const visited = new Set();
    const visiting = new Set();
    const visit = id => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw _pmCloudError(400, '親タスクに循環があるため保存できません');
      visiting.add(id);
      const parentId = parents.get(id);
      if (parentId) visit(parentId);
      visiting.delete(id);
      visited.add(id);
    };
    parents.forEach((_parentId, id) => visit(id));
  }

  async function _pmCloudPatchEntry(provider, internals, body) {
    const sheet = _pmCloudSheetAlias(body?.sheet);
    if (!PM_PROPERTY_TYPES[sheet]) throw _pmCloudError(400, '対象リストが不正です');
    const entry = await _pmCloudResolveEntry(provider, internals, sheet, body);
    const expected = _pmCloudPatchPreconditions(body);
    const currentEntryRevision = _pmCloudAssertPatchCurrent(entry, expected);
    const updates = body?.properties && typeof body.properties === 'object' ? { ...body.properties } : {};
    if (sheet === 'タスクリスト') {
      delete updates[PM_TASK_LEGACY_NAME_PROP];
      if (Object.prototype.hasOwnProperty.call(updates, '作業予定日時') && !Object.prototype.hasOwnProperty.call(updates, '作業予定区間')) updates['作業予定区間'] = '';
      if (Object.prototype.hasOwnProperty.call(updates, '親タスクID')) {
        const expectedModified = String(body?.expectedModified ?? body?.expected_modified ?? '').trim();
        const actualModified = String(entry.frontmatter?.modified || '').trim();
        if (!expectedModified || expectedModified !== actualModified) {
          throw _pmCloudError(409, 'このタスクは別の画面で更新されています。再読み込みしてからやり直してください');
        }
        await _pmCloudValidateTaskParentGraph(provider, internals, entry, updates);
      }
    }
    if (!Object.keys(updates).length) throw _pmCloudError(400, '更新内容がありません');
    const schema = await _pmCloudEntrySchema(provider, internals, sheet, entry.sheet, entry.frontmatter);
    if (_pmCloudPatchIsNoop(entry.frontmatter, schema, updates)) {
      return { ok: true, row: _pmCloudEntryRow(entry), needs_recalculate: false, unchanged: true, cloud: true };
    }
    const fm = _pmCloudApplyEntryUpdates(entry.frontmatter, schema, updates, sheet);
    // 制作管理UX改善計画（2026-08-04）§5-1「開始日時・完了日時」: タスク詳細サイドバーの
    // PATCH経路（Desktop _patch_production_entry_locked のCloud対応）でも状況変更を拾う。
    if (sheet === 'タスクリスト') _pmCloudApplyStatusTimestampHook(entry.path, fm);
    const beforeState = JSON.stringify({ properties: entry.frontmatter?.properties || {}, production_internal: entry.frontmatter?.production_internal || {} });
    const afterState = JSON.stringify({ properties: fm.properties || {}, production_internal: fm.production_internal || {} });
    if (beforeState === afterState) {
      return { ok: true, row: _pmCloudEntryRow(entry), needs_recalculate: false, unchanged: true, cloud: true };
    }
    fm.meldex_revision = currentEntryRevision + 1;
    if (typeof provider.uploadBytesConditional !== 'function') {
      const error = _pmCloudError(503, 'このCloud保存先では安全な同時更新を利用できません。接続を更新してからやり直してください。');
      error.code = 'strict_cas_unavailable'; error.meldexCode = 'strict_cas_unavailable'; throw error;
    }
    const journal = _pmCloudMutationJournal(provider, internals);
    await _pmCloudJournalText(journal, entry.path);
    if (sheet === 'タスクリスト') { await _pmCloudJournalCalendar(journal, 'events'); await _pmCloudJournalCalendar(journal, 'calendars'); }
    try {
      const text = _pmCloudFrontmatterText(fm, entry.body || '');
      const saved = await provider.uploadBytesConditional(entry.path, new TextEncoder().encode(text), expected.transportRevision.token);
      const savedRevision = String(saved?.revision || saved?.rev || saved?.etag || '');
      _pmCloudSetRollbackRevision(journal, entry.path, savedRevision);
      if (sheet === 'タスクリスト') await _pmCloudSyncTaskEvent(provider, internals, entry.path, fm);
      const parsed = { frontmatter: fm, body: entry.body || '' };
      const transportRevision = savedRevision
        ? { transport: _pmCloudTransportName(), token: savedRevision }
        : await _pmCloudEntryTransportRevision(provider, entry.path, parsed);
      return { ok: true, row: _pmCloudEntryRow({ ...entry, frontmatter: fm, transportRevision }), needs_recalculate: sheet === 'タスクリスト', cloud: true };
    } catch (error) { return _pmCloudRollbackMutation(journal, error); }
  }
