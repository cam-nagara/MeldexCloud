  // gb-production-management-cloud-workspace.js: 制作管理ワークスペースの状態確認・
  // 一覧取得・初期化・シート/フォルダノートのスキーマ整備を担当する（責務単位分割
  // 2026-08-12。旧 gb-production-management.part01.js の一部）。
  //
  // /production-management/status・/summary・/lists・/task-sheets・/init の各Cloudルートの
  // 実処理本体（_pmCloudStatus / _pmCloudSummary / _pmCloudList / _pmCloudTaskSheets /
  // _pmCloudInit 等）と、シート作成時のフォルダノート・列タイプ整備（_pmCloudEnsureSheet 等）
  // をまとめる。ルーティング自体（URLパターン→この呼び出し）は
  // gb-production-management.part01.js の _pmInstallCloudHandler にある。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。

  function _pmCloudRoot(internals) {
    return internals._joinPath(PM_ROOT, 'シート');
  }

  // コミット前レビュー指摘 #15: 移行スキップキャッシュ用の安定キー。実際に接続している
  // Dropbox名前空間+絶対ルートパスを合成する（gb-dropbox-management-root-resolver.js。
  // ワークスペース切替を正しく検知できるのはこちらで、`制作管理/シート` のような
  // provider内相対パスでは複数ワークスペースが同じ文字列に潰れてしまうため使わない）。
  // 解決できない場合（リゾルバ未読込・未接続等）は空文字を返し、呼び出し側はキャッシュを
  // 使わず毎回移行を試みる。
  async function _pmCloudRootMigrationKey(provider) {
    try {
      const resolver = window.MeldexDropboxManagementRootResolver;
      if (!resolver?.resolveConnectionInfo) return '';
      const info = await resolver.resolveConnectionInfo(provider);
      const key = `${String(info?.namespaceKind || '')}:${String(info?.rootPath || '')}`.toLowerCase();
      return key === ':' ? '' : key;
    } catch (err) {
      console.warn('制作管理: 管理ルートの解決に失敗しました。移行スキップキャッシュを無効化します:', err);
      return '';
    }
  }

  async function _pmCloudStatus(provider, internals) {
    const missing = await _pmCloudMissing(provider, internals);
    return { ok: true, root: PM_ROOT, missing, ready: missing.length === 0, repairable: !!missing.length, message: missing.length ? '制作管理に必要なファイルが一部見つかりません。「制作管理を始める」で自動復旧できます。' : '', cloud: true };
  }

  async function _pmCloudSummary(provider, internals) {
    const [works, tasks, contents] = await Promise.all([
      _pmCloudListEntries(provider, internals, '作品リスト'),
      _pmCloudListAllTaskEntries(provider, internals),
      _pmCloudListEntries(provider, internals, '作業内容リスト'),
    ]);
    return { ok: true, root: PM_ROOT, counts: { works: works.length, tasks: tasks.length, contents: contents.length }, cloud: true };
  }

  async function _pmCloudList(provider, internals, url) {
    const aliases = { works: '作品リスト', tasks: 'タスクリスト', contents: '作業内容リスト', targets: '作業対象リスト', scales: '作業規模リスト' };
    const requested = String(url?.searchParams?.get('sheet') || 'タスクリスト');
    const sheet = aliases[requested] || requested;
    const q = String(url?.searchParams?.get('q') || '').trim().toLocaleLowerCase('ja');
    const limit = Math.max(1, Math.min(5000, Number(url?.searchParams?.get('limit') || 100) || 100));
    const entries = sheet === 'タスクリスト'
      ? await _pmCloudListAllTaskEntries(provider, internals)
      : await _pmCloudListEntries(provider, internals, sheet);
    const rows = entries.map(_pmCloudEntryRow).filter(row => {
      if (!q) return true;
      return `${row.name}\n${Object.values(row.properties).join('\n')}`.toLocaleLowerCase('ja').includes(q);
    });
    return { ok: true, sheet, rows: rows.slice(0, limit), count: rows.length, root: PM_ROOT, cloud: true };
  }

  async function _pmCloudTaskSheets(provider, internals, cachedWorks = null) {
    const works = Array.isArray(cachedWorks)
      ? cachedWorks
      : await _pmCloudListEntries(provider, internals, '作品リスト', { concurrency: 8 });
    const rows = await _pmCloudMapBounded(works, 8, async work => {
      const workTitle = work.name || _pmCloudPropValue(work.frontmatter, '作品タイトル_話数')
        || _pmCloudPropValue(work.frontmatter, '作品タイトル');
      const sheetName = _pmCloudPropValue(work.frontmatter, 'タスクリストシート');
      if (!sheetName) return null;
      const entries = await _pmCloudDirectoryEntries(provider, internals, internals._joinPath(_pmCloudRoot(internals), sheetName));
      const count = entries.filter(entry => entry?.handle?.kind === 'file' && String(entry.name || '').endsWith('.md') && entry.name !== sheetName + '.md').length;
      return {
        sheet_name: sheetName,
        work_title: workTitle,
        dir: internals._joinPath(_pmCloudRoot(internals), sheetName),
        count,
      };
    });
    const resolved = rows.filter(Boolean), registered = new Set(resolved.map(row => String(row.sheet_name).toLocaleLowerCase('ja'))); await Promise.all((await _pmCloudTaskSheetNames(provider, internals, works)).filter(name => !registered.has(String(name).toLocaleLowerCase('ja'))).map(async sheetName => { const dir = internals._joinPath(_pmCloudRoot(internals), sheetName), entries = await _pmCloudDirectoryEntries(provider, internals, dir); resolved.push({ sheet_name: sheetName, work_title: sheetName === 'タスクリスト_未分類' ? '' : String(sheetName).replace(/^タスクリスト_/, ''), dir, count: entries.filter(entry => entry?.handle?.kind === 'file' && String(entry.name || '').endsWith('.md') && entry.name !== sheetName + '.md').length }); })); return { ok: true, root: PM_ROOT, sheets: resolved, cloud: true };
  }

  function _pmCloudLegacyTaskWorkTitle(entry) {
    const properties = entry?.frontmatter?.properties || {};
    const hasWorkProperty = Object.prototype.hasOwnProperty.call(properties, '作品タイトル')
      || Object.prototype.hasOwnProperty.call(properties, '作品タイトル_話数');
    const explicit = _pmCloudPropValue(entry?.frontmatter, '作品タイトル')
      || _pmCloudPropValue(entry?.frontmatter, '作品タイトル_話数');
    if (hasWorkProperty) return explicit.trim() || '未分類';
    const keyParts = _pmCloudPropValue(entry?.frontmatter, '作成キー').split('|');
    const inferred = keyParts.length > 4 ? keyParts.slice(0, -4).join('|').trim() : '';
    return inferred || '未分類';
  }

  function _pmCloudAllocateTaskSheetName(workTitle, usedSheets) {
    const base = PM_TASK_SHEET_PREFIX + _pmSafeName(workTitle).slice(0, 100);
    let candidate = base;
    let suffix = 1;
    while (usedSheets.has(candidate.toLocaleLowerCase('ja'))) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    usedSheets.add(candidate.toLocaleLowerCase('ja'));
    return candidate;
  }

  async function _pmCloudMapBounded(items, limit, mapper) {
    const source = Array.from(items || []);
    const results = new Array(source.length);
    let cursor = 0;
    let firstError = null;
    async function worker() {
      while (!firstError) {
        const index = cursor++;
        if (index >= source.length) return;
        try { results[index] = await mapper(source[index], index); }
        catch (error) { firstError ||= error; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit || 1), source.length) }, worker));
    if (firstError) throw firstError;
    return results;
  }

  async function _pmCloudCreateTaskSheet(provider, internals, body) {
    await _pmCloudInit(provider, internals);
    const workTitle = String(body?.work_title || '').trim();
    if (!workTitle) throw new Error('work_title は必須です');
    const sheetName = await _pmCloudEnsureWorkTaskSheet(provider, internals, workTitle);
    await _pmCloudUpsertEntry(provider, internals, '作品リスト', workTitle, {
      'タスクリストシート': sheetName,
    }, '', '', { reuseName: true });
    return { ok: true, sheet_name: sheetName, work_title: workTitle, dir: internals._joinPath(_pmCloudRoot(internals), sheetName), cloud: true };
  }

  async function _pmCloudAddStaff(provider, internals, body) {
    // 「メンバーを追加」は正本『スタッフ管理シート』への upsert へ委譲する
    // （アカウント一元管理計画書 Phase 4 §5.9手順4・手順5）。スタッフは制作管理
    // ルートごとではなく全体で1枚の正本を共有するため、制作管理の初期化・
    // 一意チェック・書き込みはもう不要（正本自体の保護は window.MeldexUserRegistry
    // が担う）。スキル（旧「担当できる作業」）は正本に存在しない列のため一切
    // 扱わない（計画書§5.5、作業内容リストの「担当者候補」側で設定する）。
    // クラウド静的版のtwin実装（gb-staff-registry-cloud-twin.js、2026-07-20）
    // により実動作する。真のエラー（例: ユーザー重複の409）はここで案内文へ
    // すり替えず、そのまま呼び出し元（openProductionStaffAdd の catch）へ
    // 伝播させる。
    const name = String(body?.name || body?.user || '').trim();
    if (!name) throw new Error('メンバー名は必須です');
    // 「ユーザーを選択（未連携も可）」— user が明示されていない限り name を
    // ユーザーIDへ代用しない（表示名だけの未連携行を許す。
    // meldex_staff_registry_service.upsert_staff の同じ配慮と揃えている）。
    const entry = {
      user: String(body?.user || '').trim(),
      display: String(body?.display || '').trim() || name,
      role: String(body?.role_label || body?.role || '').trim(),
      work_hours: String(body?.work_hours || '').trim(),
      break_hours: String(body?.break_hours || '').trim(),
      holidays: String(body?.holidays || '').trim(),
      active_from: String(body?.active_from || '').trim(),
      active_to: String(body?.active_to || '').trim(),
      google_url: String(body?.google_url || '').trim(),
      caldav_url: String(body?.caldav_url || '').trim(),
      sync_enabled: !!body?.sync_enabled,
      note: String(body?.note || '').trim(),
    };
    await window.MeldexUserRegistry.upsertStaff(entry, { fillOnly: false });
    return { ok: true, staff: name, cloud: true };
  }

  async function _pmCloudTaskSheetForWork(provider, internals, workTitle) {
    const existingWork = await _pmCloudFindByName(provider, internals, '作品リスト', workTitle)
      || await _pmCloudFindByProp(provider, internals, '作品リスト', '作品タイトル_話数', workTitle);
    if (existingWork) {
      const parsed = await _pmCloudReadFrontmatter(provider, existingWork);
      const registered = _pmCloudPropValue(parsed.frontmatter, 'タスクリストシート');
      if (registered) return registered;
    }
    const base = PM_TASK_SHEET_PREFIX + _pmSafeName(workTitle).slice(0, 100);
    const used = new Set();
    for (const work of await _pmCloudListEntries(provider, internals, '作品リスト')) {
      const registered = _pmCloudPropValue(work.frontmatter, 'タスクリストシート');
      if (registered) used.add(registered.toLocaleLowerCase('ja'));
    }
    let candidate = base;
    let suffix = 1;
    // 未登録の同名フォルダは、前回の途中失敗で先に作られた作品別シートとして再利用する。
    // 他作品が正式登録済みの場合だけ枝番へ進み、再試行で孤立シートを増やさない。
    while (used.has(candidate.toLocaleLowerCase('ja'))) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }

  async function _pmCloudEnsureWorkTaskSheet(provider, internals, workTitle) {
    const sheet = await _pmCloudTaskSheetForWork(provider, internals, workTitle);
    await _pmCloudEnsureSheet(provider, internals, sheet, 'タスクリスト');
    return sheet;
  }

  async function _pmCloudInit(provider, internals, options = {}) {
    // コミット前レビュー指摘 #15: 以降のスキップキャッシュ判定はすべてこの1回だけ解決した
    // 管理ルートキーで揃える（provider同一性は使わない。解決できない場合はprovider単位の
    // フォールバックへ倒す。_pmCloudMigrationAlreadyDone参照）。
    const migrationRootKey = await _pmCloudRootMigrationKey(provider);
    // 名称衝突は制作管理ファイルへ一切書き込む前に検出する。
    const shouldMigrateNames = options.forceNameMigration
      || !_pmCloudMigrationAlreadyDone(PM_NAME_MIGRATED_ROOTS, PM_NAME_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    const nameMigration = shouldMigrateNames
      ? await window.MeldexProductionSchemaMigration?.migrateManagedNameProperties?.(
        _pmCloudManagedNameContext(provider, internals)
      ) || { migrated: 0, staff_users_added: 0 }
      : { migrated: 0, staff_users_added: 0 };
    if (shouldMigrateNames) _pmCloudMarkMigrationDone(PM_NAME_MIGRATED_ROOTS, PM_NAME_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    // 制作管理UX改善計画（2026-08-04）§5-2: 死に列に値が残っていれば production_schema_
    // cleanup へ退避してから削除する（非破壊）。名称移行と同じ管理ルート単位のスキップ
    // キャッシュで、毎リクエストの全件スキャンを避ける。
    const shouldMigrateSchemaCleanup = options.forceSchemaCleanupMigration
      || !_pmCloudMigrationAlreadyDone(PM_SCHEMA_CLEANUP_MIGRATED_ROOTS, PM_SCHEMA_CLEANUP_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    if (shouldMigrateSchemaCleanup && window.MeldexProductionSchemaCleanup?.migrateProductionSchemaCleanup) {
      await window.MeldexProductionSchemaCleanup.migrateProductionSchemaCleanup(
        _pmCloudManagedNameContext(provider, internals)
      );
      _pmCloudMarkMigrationDone(PM_SCHEMA_CLEANUP_MIGRATED_ROOTS, PM_SCHEMA_CLEANUP_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    }
    // コミット前レビュー指摘 #7: タスクリスト（+作品別シート）の内部専用列（PM_INTERNAL_
    // METADATA_PROPERTIES と同一集合。Desktop migrate_production_internal_metadata と同等）を
    // properties から production_internal へ一括移行する。移動のみで削除ではないため
    // 非破壊・冪等（既存の production_internal 値は上書きしない）。
    const shouldMigrateInternalMetadata = options.forceInternalMetadataMigration
      || !_pmCloudMigrationAlreadyDone(PM_INTERNAL_METADATA_MIGRATED_ROOTS, PM_INTERNAL_METADATA_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    let internalMetadataMigration = { migrated: 0 };
    if (shouldMigrateInternalMetadata && window.MeldexProductionSchemaCleanup?.migrateProductionInternalMetadata) {
      internalMetadataMigration = await window.MeldexProductionSchemaCleanup.migrateProductionInternalMetadata(
        _pmCloudManagedNameContext(provider, internals)
      ) || { migrated: 0 };
      _pmCloudMarkMigrationDone(PM_INTERNAL_METADATA_MIGRATED_ROOTS, PM_INTERNAL_METADATA_MIGRATED_PROVIDERS_FALLBACK, migrationRootKey, provider);
    }
    const missing = await _pmCloudMissing(provider, internals);
    await internals._directoryHandle(provider, PM_ROOT, true);
    for (const [name, text] of Object.entries(PM_REQUIRED_PAGES)) await _pmCloudEnsurePage(provider, internals, name, text);
    for (const sheet of PM_SHEETS) await _pmCloudEnsureSheet(provider, internals, sheet);
    // 構造が揃っている場合は初期値を再シードしない（編集済みの作業内容・規模リスト等を巻き戻さない）
    if (missing.length) await _pmCloudSeed(provider, internals);
    const recovered = [...missing];
    const cal = await _pmCloudRecoverFromCalendar(provider, internals, missing);
    if (cal.shifts) recovered.push(`カレンダーからシフトを復旧: ${cal.shifts}件`);
    if (cal.tasks) recovered.push(`カレンダーから作業予定を復旧: ${cal.tasks}件`);
    const migration = options.migrateLegacyWorkspace
      ? await _pmCloudMigrateLegacyWorkspace(provider, internals)
      : { works: 0, copied: 0, removed: 0, conflict_copies_removed: 0 };
    return {
      ok: true,
      root: PM_ROOT,
      sheets: PM_SHEETS,
      cloud: true,
      legacy_works_registered: migration.works,
      legacy_migrated: migration.copied,
      legacy_removed: migration.removed,
      conflict_copies_removed: migration.conflict_copies_removed,
      managed_names_migrated: nameMigration.migrated,
      staff_users_added: nameMigration.staff_users_added,
      internal_metadata_migrated: internalMetadataMigration.migrated,
      ..._pmCloudRecoveryPayload(recovered),
    };
  }

  function _pmCloudManagedNameContext(provider, internals) {
    return {
      provider,
      rootPath: _pmCloudRoot(internals),
      listEntries: sheet => _pmCloudListEntries(provider, internals, sheet),
      listTaskSheets: () => _pmCloudTaskSheetNames(provider, internals),
      readFrontmatter: path => _pmCloudReadFrontmatter(provider, path),
      frontmatterText: _pmCloudFrontmatterText,
      safeName: _pmSafeName,
      entryPath: (sheet, name) => internals._joinPath(_pmCloudRoot(internals), sheet, `${name}.md`),
      notePath: sheet => internals._joinPath(_pmCloudRoot(internals), sheet, `${sheet}.md`),
      entryExists: path => _pmCloudEntryExists(provider, path, internals),
      moveEntry: (source, target) => internals._moveEntry(provider, source, target),
      readCalendarEvents: () => _pmReadCalendarStore(provider, internals, 'events'),
      writeCalendarEvents: rows => _pmWriteCalendarStore(provider, internals, 'events', rows),
    };
  }

  async function _pmCloudRenameManagedEntry(provider, internals, body) {
    const migration = window.MeldexProductionSchemaMigration;
    if (!migration?.isManagedEntryPath?.(body?.path)) return internals.NOT_HANDLED;
    const isTaskEntry = !!_pmCloudTaskSheetEntryInfo(internals, body?.path);
    const result = await _pmCloudWithProductionLease(provider, () => migration.renameManagedEntry(
      _pmCloudManagedNameContext(provider, internals),
      body?.path,
      body?.new_name,
      {
        expectedEntryId: body?.expected_entry_id,
        operationId: body?.operation_id,
      },
    ));
    // 手動リネームは「タスク名を固定」を立て、以後の分類変更で名前が自動更新されないように
    // する（meldex_production_task_name_autofill と同じ意図。production-management-ux-
    // improvement-plan-2026-08-04.md §4-3）。
    if (isTaskEntry && result?.ok && result?.new_path) {
      await _pmCloudMarkTaskNameFixed(provider, result.new_path);
    }
    return result;
  }

  async function _pmCloudMarkTaskNameFixed(provider, path) {
    const parsed = await _pmCloudReadFrontmatter(provider, path);
    const fm = { ...(parsed.frontmatter || {}) };
    // 制作管理UX改善計画（2026-08-04）§5-1: 「タスク名を固定」は production_internal
    // へ統一移動済み（gb-production-task-naming.js の isTaskNameFixed / Desktop
    // meldex_production_task_name_autofill._task_name_fixed と同じ場所）。旧トップレベル
    // フラグは新規には立てない（読み取り側のフォールバックとしてのみ残す）。
    fm.production_internal = fm.production_internal && typeof fm.production_internal === 'object' ? { ...fm.production_internal } : {};
    fm.production_internal.task_name_fixed = true;
    delete fm['タスク名を固定'];
    delete fm.task_name_auto_generated;
    await provider.writeText(path, _pmCloudFrontmatterText(fm, parsed.body || ''));
  }

  async function _pmCloudMissing(provider, internals) {
    const missing = [];
    for (const name of Object.keys(PM_REQUIRED_PAGES)) {
      if (!await _pmCloudEntryExists(provider, internals._joinPath(PM_ROOT, name), internals)) missing.push(`${PM_ROOT}/${name}`);
    }
    for (const sheet of PM_SHEETS) {
      const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
      if (!await _pmCloudEntryExists(provider, dir, internals)) missing.push(`シート/${sheet}`);
      else if (!await _pmCloudEntryExists(provider, internals._joinPath(dir, sheet + '.md'), internals)) missing.push(`シート/${sheet}/${sheet}.md`);
    }
    return missing;
  }

  async function _pmCloudEntryExists(provider, path, internals) {
    try {
      if (typeof provider?.statPath === 'function') return !!(await provider.statPath(path));
      return !!(await internals._resolveEntryHandle(provider, path));
    } catch (error) {
      if (_pmCloudIsNotFoundError(error)) return false;
      throw error;
    }
  }

  async function _pmCloudEnsurePage(provider, internals, name, text) {
    const path = internals._joinPath(PM_ROOT, name);
    if (!await _pmCloudEntryExists(provider, path, internals)) await provider.writeText(path, text);
  }

  function _pmCloudRecoveryPayload(items) {
    const unique = [...new Set((items || []).filter(Boolean))];
    return { recovered: !!unique.length, recovered_count: unique.length, recovered_items: unique, message: unique.length ? `制作管理に必要なファイルを自動復旧しました: ${unique.slice(0, 4).join('、')}` : '' };
  }

  async function _pmCloudEnsureSheet(provider, internals, sheet, schemaSheet = sheet) {
    const dir = internals._joinPath(_pmCloudRoot(internals), sheet);
    await internals._directoryHandle(provider, dir, true);
    // ストア汚染（v0.6.120〜v0.7.146 の暗黙sheet-store化）の修復。制作管理の初回表示
    // （_pmCloudInit）とタスクシート作成で必ず通る（production-sheet-store-contamination-
    // fix-plan-2026-08-05.md Phase 2）。ノート再構築より先に行う（修復後の浄化済み
    // frontmatter を _pmCloudReadFrontmatter で読み直すため）。
    await internals._repairProductionSheetStoreIfNeeded?.(provider, dir);
    const note = internals._joinPath(dir, sheet + '.md');
    const parsed = await _pmCloudReadFrontmatter(provider, note);
    const frontmatter = { ...(parsed.frontmatter || {}), type: 'settings-db', schema_version: 1 };
    // 防御: 修復関数が未読込でも、汚染由来の保存方式キーをノートへ引き継がない
    ['storage', 'sheet_storage', 'entry_storage', 'storage_backend'].forEach((key) => {
      if (String(frontmatter[key] || '').toLowerCase() === 'sqlite') delete frontmatter[key];
    });
    if (String(frontmatter.cloud_storage || '').toLowerCase() === 'sheet-store-v1') delete frontmatter.cloud_storage;
    const propTypes = { ...(frontmatter.property_types || {}) };
    if (schemaSheet === 'タスクリスト') {
      delete propTypes[PM_TASK_LEGACY_NAME_PROP];
      delete propTypes['タスク名を固定'];
    }
    if (schemaSheet === 'タスクリスト アーカイブ') delete propTypes[PM_TASK_LEGACY_NAME_PROP];
    const managedNameDefinition = window.MeldexProductionSchemaMigration?.MANAGED_NAME_COLUMNS?.[schemaSheet];
    if (managedNameDefinition) {
      [managedNameDefinition.legacy, ...(managedNameDefinition.historicalAliases || [])]
        .filter(Boolean)
        .forEach(property => { delete propTypes[property]; });
    }
    const expectedTypes = PM_PROPERTY_TYPES[schemaSheet] || {};
    frontmatter.property_types = _pmCloudMergePropertyTypes(propTypes, expectedTypes);
    if (schemaSheet === 'タスクリスト') {
      frontmatter.calendar_mapping = { ...(frontmatter.calendar_mapping || {}), startProp: '作業予定日時', endProp: '作業予定日時', titleProp: '' };
      if (!frontmatter.calendar_mapping.colorProp) frontmatter.calendar_mapping.colorProp = '対象色';
      if (!frontmatter.calendar_mapping.descriptionProp) frontmatter.calendar_mapping.descriptionProp = '備考';
      _pmCloudApplyTaskHiddenColumns(frontmatter);
      _pmCloudApplyComputedProps(frontmatter);
    }
    if (sheet === 'スケジュール') frontmatter.calendar_mapping = frontmatter.calendar_mapping || { startProp: '予定日時', endProp: '予定日時', titleProp: '予定名', descriptionProp: '備考' };
    await provider.writeText(note, _pmCloudFrontmatterText(frontmatter, parsed.body || `# ${sheet}\n\n`));
  }

  function _pmCloudMergePropertyTypes(current, expected) {
    const merged = { ...(current || {}) };
    Object.entries(expected || {}).forEach(([prop, spec]) => {
      const existing = merged[prop] && typeof merged[prop] === 'object' ? merged[prop] : {};
      merged[prop] = { ...existing, ...(spec || {}) };
    });
    return merged;
  }
