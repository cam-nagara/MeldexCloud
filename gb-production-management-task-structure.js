(function () {
  'use strict';

  function protectionReason(entry, deps) {
    const value = name => deps.propValue(entry?.frontmatter, name);
    const status = value('状況');
    if (status && status !== '未着手') return `状況が「${status}」`;
    const actual = value('作業時間_実績');
    if ((Number(actual) || 0) > 0 || (actual && !Number.isFinite(Number(actual)))) return '作業実績あり';
    const planned = value('作業予定時間');
    if ((Number(planned) || 0) > 0 || (planned && !Number.isFinite(Number(planned)))) return '作業予定時間あり';
    for (const name of ['再計算ロック', '担当者固定', 'シフト固定']) {
      if (['true', '1', 'yes', 'on', '採用', '有効', 'はい', 'する'].includes(value(name).trim().toLowerCase())) {
        return `${name}が有効`;
      }
    }
    for (const name of ['開始日時', '完了日時', '作業予定日時', '作業予定区間']) {
      if (value(name)) return `${name}あり`;
    }
    return '';
  }

  function prepareBody(body, workEntry, entries, deps) {
    const prepared = window.MeldexProductionPageStructure?.prepare?.(body || {}, workEntry?.frontmatter) || { ...(body || {}) };
    const dimensionSpecs = [
      ['target_names', '作業対象リスト'],
      ['content_names', '作業内容リスト'],
      ['scale_names', '作業規模リスト'],
    ];
    const hasExplicit = dimensionSpecs.some(([key, prop]) => Object.prototype.hasOwnProperty.call(body || {}, key)
      || Object.prototype.hasOwnProperty.call(body || {}, prop));
    if (!hasExplicit) {
      dimensionSpecs.forEach(([key, prop]) => {
        const values = [...new Set(entries.map(entry => deps.propValue(entry.frontmatter, prop)).filter(Boolean))];
        if (values.length) prepared[key] = values;
      });
    }
    return prepared;
  }

  function plan(entries, desiredRows, workTitle, deps) {
    const desired = new Map(desiredRows.map(row => [String(row['作成キー'] || ''), row]).filter(([key]) => key));
    const current = new Map();
    const archive = [];
    const protectedRows = [];
    entries.filter(entry => deps.belongsToWork(entry, workTitle)).forEach((entry) => {
      const key = deps.propValue(entry.frontmatter, '作成キー');
      if (key) current.set(key, entry);
      if (desired.has(key)) return;
      const reason = protectionReason(entry, deps);
      const item = { path: entry.path, name: entry.name, creation_key: key };
      if (reason) protectedRows.push({ ...item, reason });
      else archive.push(item);
    });
    const create = [...desired].filter(([key]) => !current.has(key))
      .map(([creation_key, row]) => ({ name: String(row._entry_name || ''), creation_key }));
    const state = entries.filter(entry => deps.belongsToWork(entry, workTitle)).map(entry => [
      entry.path,
      entry.frontmatter?.modified || '',
      entry.frontmatter?.properties || {},
    ]);
    const fingerprint = deps.hash(JSON.stringify({ state, desired: [...desired.keys()].sort() }));
    return {
      ok: true,
      fingerprint,
      desired_count: desired.size,
      current_count: current.size,
      create_count: create.length,
      archive_count: archive.length,
      protected_count: protectedRows.length,
      unchanged_count: [...desired.keys()].filter(key => current.has(key)).length,
      create,
      archive,
      protected: protectedRows,
      apply_allowed: !!(create.length || archive.length),
      recalculation_recommended: !!(create.length || archive.length),
    };
  }

  async function context(provider, internals, body, deps) {
    const workTitle = String(body?.work_title || body?.['作品タイトル'] || body?.title || '無題作品');
    const workEntry = await deps.findWork(provider, internals, workTitle);
    if (!workEntry) throw deps.error(404, '指定した作品が見つかりません');
    const entries = await deps.listTasks(provider, internals);
    const taskEntries = entries.filter(entry => deps.belongsToWork(entry, workTitle));
    const taskBody = prepareBody(body, workEntry, taskEntries, deps);
    const desiredRows = deps.buildRows(taskBody);
    deps.validateRows(desiredRows);
    return { workTitle, workEntry, entries, taskBody, desiredRows };
  }

  async function preview(provider, internals, body, deps) {
    const current = await context(provider, internals, body, deps);
    return {
      ...plan(current.entries, current.desiredRows, current.workTitle, deps),
      page_units: current.taskBody.pages || [],
      cloud: true,
    };
  }

  async function apply(provider, internals, body, deps) {
    await deps.init(provider, internals);
    const current = await context(provider, internals, body, deps);
    const currentPlan = plan(current.entries, current.desiredRows, current.workTitle, deps);
    if (!body?.fingerprint) throw deps.error(400, '先にタスク構成のプレビューを実行してください');
    if (String(body.fingerprint) !== currentPlan.fingerprint) {
      throw deps.error(409, 'プレビュー後にタスクが変更されました。もう一度プレビューしてください');
    }
    const journal = deps.mutationJournal(provider, internals);
    try {
      const taskSheet = deps.propValue(current.workEntry.frontmatter, 'タスクリストシート')
        || current.entries.find(entry => deps.belongsToWork(entry, current.workTitle))?.sheet;
      if (!taskSheet) throw deps.error(404, '作品のタスクリストが見つかりません');
      const archiveDir = internals._joinPath(deps.root(internals), 'タスクリスト アーカイブ');
      await deps.journalDirectory(journal, archiveDir);
      await deps.journalText(journal, internals._joinPath(archiveDir, 'タスクリスト アーカイブ.md'));
      await deps.ensureSheet(provider, internals, 'タスクリスト アーカイブ');
      const archiveSet = new Set(currentPlan.archive.map(item => item.path));
      for (const entry of current.entries.filter(item => archiveSet.has(item.path))) {
        const archivePath = await deps.uniqueEntryPath(
          provider,
          internals,
          'タスクリスト アーカイブ',
          entry.name,
          `archive:${entry.path}:${Date.now()}`,
        );
        await deps.journalText(journal, entry.path);
        await deps.journalText(journal, archivePath);
        const archived = deps.clone(entry.frontmatter) || {};
        archived.id = 'ent_' + deps.hash(`${archivePath}|${Date.now()}|${Math.random()}`).slice(0, 10);
        archived.category = 'タスクリスト アーカイブ';
        archived.modified = new Date().toISOString();
        archived.archived_from = entry.path;
        archived.archive_reason = '作品のページ構成を更新';
        await provider.writeText(archivePath, deps.frontmatterText(archived, entry.body || ''));
        await provider.deletePath(entry.path);
      }
      const currentKeys = new Set(
        current.entries
          .filter(entry => deps.belongsToWork(entry, current.workTitle))
          .map(entry => deps.propValue(entry.frontmatter, '作成キー'))
          .filter(Boolean),
      );
      const missing = current.desiredRows.filter(row => !currentKeys.has(String(row['作成キー'] || '')));
      for (const row of missing) {
        await deps.writeNewEntry(
          provider,
          internals,
          'タスクリスト',
          taskSheet,
          row._entry_name || 'タスク',
          row,
          journal,
          `structure:${row['作成キー']}`,
        );
      }
      await deps.journalText(journal, current.workEntry.path);
      await deps.updateEntry(provider, current.workEntry.path, {
        '生成ページ数': String((current.taskBody.pages || []).length),
        'タスク生成': '作成済み',
      }, current.workEntry);
      return {
        ok: true,
        ...currentPlan,
        created: missing.length,
        archived: currentPlan.archive_count,
        protected: currentPlan.protected_count,
        cloud: true,
      };
    } catch (error) {
      return deps.rollback(journal, error);
    }
  }

  // protectionReason はタスク構成更新（apply/preview）専用ではなく、目標作業時間の
  // 分類変更追従フック（gb-production-management.part02.js の
  // _pmCloudApplyDurationRecalcHook）からも共用する。「タスク構成を更新」と同じ保護条件
  // （状況/実績/予定時間/ロック系チェックボックス/開始・完了・作業予定日時）を単一箇所で判定する。
  window.MeldexProductionCloudTaskStructure = { preview, apply, protectionReason };
})();
