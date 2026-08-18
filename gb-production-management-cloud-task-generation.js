  // gb-production-management-cloud-task-generation.js: タスク一覧セルの合成表示
  // （予定時間の併記・保護アイコン）、ページ/コマの選択肢整備、初期シードデータ、
  // タスク一括作成のプレビュー・確定（作成キー突合を含む）を担当する（責務単位分割
  // 2026-08-12。旧 gb-production-management.part01.js の一部）。
  //
  // gb-production-management.part01.js から続く共有クロージャ（IIFEの raw
  // concatenation）に属し、このファイル自体は自前のIIFEを持たない。読み込み順は
  // gb-production-management.js を参照。

  // 制作管理UX改善計画（2026-08-04）§5-1: 読み取り専用の自動列（コードが再計算エンジン・
  // 同期フック経由で更新し、ユーザーの直接編集は拒否する）。汎用の計算列基盤
  // （gb-db-computed-columns.js / gb-data-access-dropbox-expanded.part01.js の
  // _rejectComputedPropertyEdit）が frontmatterの computed_props: 宣言を見てセル編集を拒否
  // する。内部エンジンの書込み（applyPropsToFrontmatter 等）は /value を通らないため影響しない。
  // コミット前レビュー指摘 #13: 目標作業時間_値（数値の実体列）にもcomputed_props宣言が
  // 必要（表示文字列の目標作業時間だけ保護しても、裏の数値列を表示に戻すと直接編集できる
  // 抜け道になる）。Desktop meldex_production_management.COMPUTED_PROPS と同じ集合。
  const PM_TASK_COMPUTED_PROPS = ['作業予定日時', '作業予定時間', '目標作業時間', '目標作業時間_値', 'シフト割当不能理由'];
  function _pmCloudApplyComputedProps(frontmatter) {
    const current = Array.isArray(frontmatter.computed_props) ? frontmatter.computed_props : [];
    frontmatter.computed_props = [...new Set([...current, ...PM_TASK_COMPUTED_PROPS])];
  }

  // 制作管理UX改善計画（2026-08-04）§5-1「予定セルの合成表示」: フル汎用の列合成基盤は
  // 大掛かりになるため、コーディネーター確定のフォールバック案を採用する。「作業予定日時」
  // セル（computed_props宣言済みの読み取り専用列）へ、同エントリの「作業予定時間」を
  // 「（3h）」形式で併記し、「シフト割当不能理由」があれば⚠アイコン＋ツールチップで示す。
  // gb-db-computed-columns.js の decorateCell 汎用フック（window.MeldexCellDisplayAugment.
  // decorators）へ登録する（このファイルの読込順に依存しない。描画時に遅延解決されるため）。
  function _pmScheduleCellFirstValue(entityData, propName) {
    const raw = entityData && Object.prototype.hasOwnProperty.call(entityData, propName) ? entityData[propName] : null;
    if (!Array.isArray(raw) || !raw.length) return '';
    const adopted = raw.find(v => v && (v.status === '採用' || v.status === '掲載済み')) || raw[0];
    return adopted && adopted.value != null ? String(adopted.value).trim() : '';
  }

  function _pmFormatScheduleHours(hoursText) {
    if (window.MeldexProductionTimeFormatter?.formatDuration) {
      const sec = window.MeldexProductionTimeFormatter.parseToSeconds(hoursText);
      if (sec !== null && sec > 0) {
        return window.MeldexProductionTimeFormatter.formatDuration(sec);
      }
    }
    const num = Number(hoursText);
    if (!Number.isFinite(num) || num <= 0) return '';
    const rounded = Math.round(num * 10) / 10;
    return `${rounded}h`;
  }

  // 制作管理UX改善計画（2026-08-04）§6-2: 保護トグル（再計算ロック/担当者固定/シフト固定）は
  // タスク詳細サイドバーで編集するが、一覧を見ただけで保護中と分かるよう、既に計算列表示に
  // なっている「作業予定日時」セルへ小さな🔒/📌アイコンを併記する（decorateCell拡張点の再利用）。
  function _pmScheduleCellTruthy(entityData, propName) {
    const value = _pmScheduleCellFirstValue(entityData, propName).toLowerCase();
    return value === 'true' || value === '1' || value === 'yes' || value === 'on';
  }

  function _pmDecorateScheduleCell(td, container, entityData) {
    const hoursLabel = _pmFormatScheduleHours(_pmScheduleCellFirstValue(entityData, '作業予定時間'));
    if (hoursLabel) {
      const hoursSpan = document.createElement('span');
      hoursSpan.className = 'pm-schedule-cell-hours';
      hoursSpan.textContent = `（${hoursLabel}）`;
      container.appendChild(hoursSpan);
    }
    const reasonText = _pmScheduleCellFirstValue(entityData, 'シフト割当不能理由');
    if (reasonText) {
      td.classList.add('pm-schedule-cell-warning');
      td.title = `シフト割当不能: ${reasonText}`;
      const warnSpan = document.createElement('span');
      warnSpan.className = 'pm-schedule-cell-warning-icon';
      warnSpan.textContent = '⚠';
      warnSpan.setAttribute('aria-label', `シフト割当不能理由: ${reasonText}`);
      container.appendChild(warnSpan);
    }
    if (_pmScheduleCellTruthy(entityData, '再計算ロック')) {
      const lockSpan = document.createElement('span');
      lockSpan.className = 'pm-schedule-cell-protection-icon';
      lockSpan.textContent = '🔒';
      lockSpan.title = '再計算ロック: 自動割り当てで動きません';
      lockSpan.setAttribute('aria-label', '再計算ロック中');
      container.appendChild(lockSpan);
    }
    const assigneeFixed = _pmScheduleCellTruthy(entityData, '担当者固定');
    const shiftFixed = _pmScheduleCellTruthy(entityData, 'シフト固定');
    if (assigneeFixed || shiftFixed) {
      const pinLabel = [assigneeFixed && '担当者固定', shiftFixed && 'シフト固定'].filter(Boolean).join(' / ');
      const pinSpan = document.createElement('span');
      pinSpan.className = 'pm-schedule-cell-protection-icon';
      pinSpan.textContent = '📌';
      pinSpan.title = `${pinLabel}: 自動割り当てで動きません`;
      pinSpan.setAttribute('aria-label', `${pinLabel}中`);
      container.appendChild(pinSpan);
    }
  }

  if (typeof window !== 'undefined') {
    window.MeldexCellDisplayAugment = window.MeldexCellDisplayAugment || {};
    window.MeldexCellDisplayAugment.decorators = {
      ...(window.MeldexCellDisplayAugment.decorators || {}),
      '作業予定日時': _pmDecorateScheduleCell,
    };
  }

  // コミット前レビュー指摘 #12: 既定非表示列の適用は初回のみ。_pmCloudEnsureSheet は
  // シートを開くたびに呼ばれ得るため、無条件に union し続けるとユーザーが表示へ戻した列を
  // 毎回黙って再び隠してしまう。適用済みマーカー（フォルダノートのfrontmatter直下。
  // savedViewsの追加・削除に影響されない）が立っていれば以降はスキップする。Desktop
  // meldex_production_management._apply_default_view_config と同じ意図・同じマーカー名。
  function _pmCloudApplyTaskHiddenColumns(frontmatter) {
    if (frontmatter.production_hidden_defaults_applied) return;
    const config = (frontmatter.view_config && typeof frontmatter.view_config === 'object') ? frontmatter.view_config : {};
    const views = Array.isArray(config.savedViews) && config.savedViews.length ? config.savedViews : [{ name: 'テーブル', viewMode: 'pivot' }];
    views.forEach(view => {
      if (!view || typeof view !== 'object') return;
      const current = Array.isArray(view.hiddenCols) ? view.hiddenCols : [];
      view.hiddenCols = [...new Set([...current, ...PM_TASK_HIDDEN_COLUMNS])];
    });
    config.savedViews = views;
    if (!Number.isInteger(config.currentViewIdx)) config.currentViewIdx = 0;
    frontmatter.view_config = config;
    frontmatter.production_hidden_defaults_applied = true;
  }

  function _pmTaskPageOptionCount(rows, fallback) {
    return (rows || []).reduce((max, row) => {
      const match = String(row?.['ページ'] || row?.['単位レベル1'] || '').match(/\d+/);
      return match ? Math.max(max, Number(match[0]) || 1) : max;
    }, Math.max(1, Number(fallback) || 1));
  }

  function _pmTaskPageOptions(count) {
    return Array.from({ length: Math.max(1, Number(count) || 1) }, (_, i) => 'p' + String(i + 1).padStart(4, '0'));
  }

  function _pmTaskPanelOptions(rows) {
    return (rows || []).map(row => String(row?.['コマ'] || row?.['単位レベル2'] || '').trim()).filter(Boolean);
  }

  function _pmTaskPageValues(rows) {
    return (rows || []).map(row => String(row?.['ページ'] || row?.['単位レベル1'] || '').trim()).filter(Boolean);
  }

  function _pmMergeOptions(current, additions) {
    const out = [];
    [...(Array.isArray(current) ? current : []), ...(additions || [])].forEach((item) => {
      const value = String(item || '').trim();
      if (value && !out.includes(value)) out.push(value);
    });
    return out;
  }

  async function _pmCloudEnsureTaskPagePanelOptions(provider, internals, taskSheet, rows, fallbackPageCount) {
    if (!(rows || []).some(row => String(row?.['ページ'] || row?.['コマ'] || '').trim())) return;
    const note = internals._joinPath(_pmCloudRoot(internals), taskSheet, taskSheet + '.md');
    const parsed = await _pmCloudReadFrontmatter(provider, note);
    const frontmatter = { ...(parsed.frontmatter || {}), type: 'settings-db', schema_version: 1 };
    const propTypes = frontmatter.property_types && typeof frontmatter.property_types === 'object' ? { ...frontmatter.property_types } : {};
    const pageSpec = { ...(propTypes['ページ'] || {}), type: 'multi-select' };
    pageSpec.options = _pmMergeOptions(
      pageSpec.options,
      [..._pmTaskPageOptions(_pmTaskPageOptionCount(rows, fallbackPageCount)), ..._pmTaskPageValues(rows)],
    );
    propTypes['ページ'] = pageSpec;
    const panelSpec = { ...(propTypes['コマ'] || {}), type: 'multi-select' };
    const panelOptions = _pmMergeOptions(panelSpec.options, _pmTaskPanelOptions(rows));
    if (panelOptions.length) panelSpec.options = panelOptions;
    propTypes['コマ'] = panelSpec;
    frontmatter.property_types = propTypes;
    await provider.writeText(note, _pmCloudFrontmatterText(frontmatter, parsed.body || `# ${taskSheet}\n\n`));
  }

  async function _pmCloudSeed(provider, internals) {
    for (const [sheet, rows] of Object.entries(PM_SEEDS)) {
      for (const [name, props] of rows) await _pmCloudUpsertEntry(provider, internals, sheet, name, props, '', '', { reuseName: true });
    }
    for (const sheet of PM_SHEETS) {
      await _pmCloudUpsertEntry(provider, internals, 'データソース', sheet, { '役割': sheet, '対象シート': `シート/${sheet}`, '有効': 'true', '説明': '制作管理で使う標準シート' }, '役割', sheet);
    }
  }

  function _pmCloudValidateTaskRows(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('作成するタスクがありません。作業内容を1つ以上選んでください');
    if (rows.length > PM_MAX_GENERATED_TASKS) throw new Error(`一度に作成できるタスクは${PM_MAX_GENERATED_TASKS}件までです`);
  }

  async function _pmCloudPreviewTasks(provider, internals, body) {
    const workTitle = String((body || {}).work_title || (body || {})['作品タイトル'] || (body || {}).title || '無題作品');
    const workEntry = await _pmCloudFindWork(provider, internals, workTitle);
    const taskBody = window.MeldexProductionPageStructure?.prepare?.(body || {}, workEntry?.frontmatter) || (body || {});
    const rows = _pmBuildTaskRows(taskBody);
    _pmCloudValidateTaskRows(rows);
    await _pmCloudApplyTaskDurations(provider, internals, rows);
    const existingKeys = await _pmCloudExistingTaskKeysForWork(provider, internals, workTitle);
    return { ok: true, rows: rows.map(row => ({ ...row, existing: existingKeys.has(String(row['作成キー'] || '')) })), count: rows.length, page_units: taskBody.pages || [], cloud: true };
  }

  async function _pmCloudEnsureTaskReferences(provider, internals, rows, config) {
    const values = (prop) => [...new Set((rows || []).map(row => String(row?.[prop] || '').trim()).filter(Boolean))];
    const standardContents = new Map((PM_SEEDS['作業内容リスト'] || []).map(([name, props]) => [name, props]));
    const specs = [
      ['作業対象リスト', values('作業対象リスト'), () => ({ '基準作業時間': '1' })],
      ['作業内容リスト', values('作業内容リスト'), (name, index) => standardContents.get(name) || { '表示名': name, '作業順': String(100 + index * 10), '作業時間倍率': '1' }],
      ['作業規模リスト', values('作業規模リスト'), () => ({ '作業時間倍率': '1' })],
    ];
    let created = 0;
    for (const [sheet, names, propsFor] of specs) {
      const known = new Set((await _pmCloudListEntries(provider, internals, sheet)).map(entry => entry.name).filter(Boolean));
      for (let index = 0; index < names.length; index += 1) {
        const name = names[index];
        if (known.has(name)) continue;
        await _pmCloudUpsertEntry(provider, internals, sheet, name, propsFor(name, index), '', '', { reuseName: true });
        known.add(name);
        created += 1;
      }
    }
    return created;
  }

  async function _pmCloudCreateTasks(provider, internals, body) {
    const previous = PM_TASK_CREATE_QUEUE;
    let release;
    const current = new Promise(resolve => { release = resolve; });
    PM_TASK_CREATE_QUEUE = current;
    await previous;
    try {
      return await _pmCloudWithProductionLease(provider, () => _pmCloudCreateTasksUnlocked(provider, internals, body));
    } finally {
      release();
      if (PM_TASK_CREATE_QUEUE === current) PM_TASK_CREATE_QUEUE = Promise.resolve();
    }
  }

  async function _pmCloudCreateTasksUnlocked(provider, internals, body) {
    const init = await _pmCloudInit(provider, internals);
    const workTitle = String((body || {}).work_title || (body || {})['作品タイトル'] || (body || {}).title || '無題作品');
    const workEntries = await _pmCloudListEntries(provider, internals, '作品リスト', { concurrency: 8 });
    const workEntry = workEntries.find(entry => {
      const title = entry.name || _pmCloudPropValue(entry.frontmatter, '作品タイトル_話数')
        || _pmCloudPropValue(entry.frontmatter, '作品タイトル');
      return title === workTitle;
    });
    const taskBody = window.MeldexProductionPageStructure?.prepare?.(body || {}, workEntry?.frontmatter) || (body || {});
    const rows = _pmBuildTaskRows(taskBody);
    _pmCloudValidateTaskRows(rows);
    await _pmCloudApplyTaskDurations(provider, internals, rows);
    const config = _pmHierarchyConfig(taskBody);
    const paths = _pmHierarchyPaths(taskBody, config);
    const firstLevelCount = new Set(paths.map(path => path[0]).filter(Boolean)).size || paths.length || 1;
    const physicalPageCount = Number(taskBody._physical_page_count || firstLevelCount);
    const secondLevelsByFirst = new Map();
    paths.forEach(path => {
      if (!path[1]) return;
      if (!secondLevelsByFirst.has(path[0])) secondLevelsByFirst.set(path[0], new Set());
      secondLevelsByFirst.get(path[0]).add(path[1]);
    });
    const secondLevelCount = Math.max(0, ...[...secondLevelsByFirst.values()].map(values => values.size));
    const usedSheets = new Set(workEntries
      .map(entry => _pmCloudPropValue(entry.frontmatter, 'タスクリストシート').toLocaleLowerCase('ja'))
      .filter(Boolean));
    const taskSheet = _pmCloudPropValue(workEntry?.frontmatter, 'タスクリストシート')
      || _pmCloudAllocateTaskSheetName(workTitle, usedSheets);
    await _pmCloudEnsureSheet(provider, internals, taskSheet, 'タスクリスト');
    const workProps = {
      'ページ数': String(physicalPageCount),
      '階層数': String(config.count),
      '階層ラベル': config.labels.join(','),
      'プリセット種別': config.preset,
      '作業作成粒度': String(taskBody.granularity || taskBody['作業作成粒度'] || config.granularity || '階層単位'),
      '生成ページ数': String(firstLevelCount),
      '生成コマ数': String(secondLevelCount),
      'タスク生成': '作成中',
      'タスクリストシート': taskSheet,
    };
    if (taskBody._physical_page_count) {
      workProps['開始ページの位置'] = taskBody._page_start_side || '左ページ';
      workProps['見開きページ'] = (taskBody._spread_pages || []).join(',');
      workProps['カラーページ'] = (taskBody._color_pages || []).join(',');
    }
    const workPeriod = _pmWorkPeriodValue(taskBody);
    if (workPeriod) workProps['作業期間'] = workPeriod;
    const workPath = workEntry
      ? await _pmCloudUpdateEntryAtPath(provider, workEntry.path, workProps, workEntry)
      : await _pmCloudUpsertEntry(provider, internals, '作品リスト', workTitle, workProps, '', '', { reuseName: true, createNew: true });
    const migration = await _pmCloudMigrateLegacyTasksForWork(provider, internals, workTitle, taskSheet);
    if (migration.conflicts) throw new Error(`タスクリストに内容を自動統合できない行が${migration.conflicts}件あります。旧タスクリストまたは競合コピーと、作品別タスクリストの同じ作成キーを確認してください`);
    const referencesCreated = await _pmCloudEnsureTaskReferences(provider, internals, rows, config);
    await _pmCloudEnsureTaskPagePanelOptions(provider, internals, taskSheet, rows, physicalPageCount);
    const existingKeys = new Set(migration.existing_keys || []);
    const missingRows = [];
    for (const row of rows) {
      const key = String(row['作成キー'] || '');
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      missingRows.push(row);
    }
    const created = await _pmCloudWriteTaskRows(provider, internals, taskSheet, missingRows);
    await _pmCloudUpdateEntryAtPath(provider, workPath, { ...workProps, 'タスク生成': '作成済み' });
    return { ok: true, created, skipped: rows.length - created, count: rows.length, references_created: referencesCreated, migrated: migration.copied, legacy_removed: migration.removed, migration_conflicts: migration.conflicts, task_sheet: taskSheet, cloud: true, ..._pmCloudRecoveryPayload(init.recovered_items) };
  }
