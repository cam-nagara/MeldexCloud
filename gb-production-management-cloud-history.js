  // gb-production-management-cloud-history.js: Cloud版の制作タスク実績履歴、日次記録、
  // 業務改善分析API。Desktop版と同じ正本（タスクのproduction_time_records）から組み立てる。
  // gb-production-management.part01.js から続く共有IIFE内で読み込まれる。

  function _pmCloudHistoryWorkspaceId(value = '') {
    const explicit = String(value || '').trim();
    if (explicit) return explicit;
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    return String(state.workspaceId || state.workspace_id || 'default').trim() || 'default';
  }

  function _pmCloudHistoryRole() {
    if (_pmCloudCanExportAttendance()) {
      const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
      return state.isOwner === true || String(state.access || state.role || '').toLowerCase() === 'owner'
        ? 'owner' : 'admin';
    }
    return 'member';
  }

  function _pmCloudHistorySeconds(value) {
    const store = window.MeldexProductionTaskSessionStore;
    return store?.hoursToSeconds ? store.hoursToSeconds(value) : Math.max(0, Math.round((Number(value) || 0) * 3600));
  }

  function _pmCloudHistoryScheduledSlots(fm) {
    const planned = String(_pmCloudPropValue(fm, '作業予定日時') || '').trim();
    const pair = planned.includes('|') ? planned.split('|', 2) : [];
    return _pmCloudTaskSegments(
      _pmCloudPropValue(fm, '作業予定区間'),
      String(pair[0] || '').trim(),
      String(pair[1] || '').trim(),
    );
  }

  async function _pmCloudHistoryDataset(provider, internals) {
    const tasks = [];
    const sessions = [];
    for (const entry of await _pmCloudListAllTaskEntries(provider, internals)) {
      const fm = entry.frontmatter || {};
      const records = fm.production_time_records && typeof fm.production_time_records === 'object'
        ? fm.production_time_records : {};
      const revisions = Array.isArray(records.revisions) ? records.revisions : [];
      const latest = revisions.length && revisions[revisions.length - 1] && typeof revisions[revisions.length - 1] === 'object'
        ? revisions[revisions.length - 1] : {};
      const taskSessions = Array.isArray(records.sessions) ? records.sessions.filter(item => item && typeof item === 'object') : [];
      taskSessions.forEach(item => sessions.push(JSON.parse(JSON.stringify(item))));
      const summaries = records.summaries && typeof records.summaries === 'object' ? records.summaries : {};
      const total = summaries.__total__ && typeof summaries.__total__ === 'object' ? summaries.__total__ : {};
      const workTitle = String(_pmCloudPropValue(fm, '作品タイトル') || '').trim();
      const taskId = String(fm.id || entry.name || '').trim();
      const estimateSeconds = Number(latest.estimate_seconds) || _pmCloudHistorySeconds(
        _pmCloudPropValue(fm, '目標作業時間_値') || _pmCloudPropValue(fm, '目標作業時間'),
      );
      const allocatedSeconds = Number(latest.allocated_seconds) || _pmCloudHistorySeconds(
        _pmCloudPropValue(fm, '作業予定時間') || _pmCloudPropValue(fm, '割当作業時間'),
      );
      tasks.push({
        task_id: taskId,
        id: taskId,
        work_id: String(latest.work_id || workTitle),
        work_title: workTitle,
        title: String(_pmCloudPropValue(fm, 'タイトル') || entry.name || taskId),
        assignee: String(_pmCloudPropValue(fm, '担当者') || ''),
        status: String(_pmCloudPropValue(fm, '状況') || latest.status || '未着手'),
        estimate_seconds: Math.max(0, Math.floor(estimateSeconds)),
        allocated_seconds: Math.max(0, Math.floor(allocatedSeconds)),
        actual_seconds: Math.max(0, Math.floor(Number(total.actual_seconds) || 0)),
        quality_status: String(total.quality_status || 'unmeasured'),
        quality_reasons: Array.isArray(total.quality_reasons) ? total.quality_reasons.slice() : [],
        estimated_by: String(latest.estimated_by || ''),
        deadline: String(latest.deadline_at || _pmCloudPropValue(fm, '締切') || _pmCloudPropValue(fm, '期限') || ''),
        completed_at: String(_pmCloudPropValue(fm, '完了日時') || ''),
        deadline_extension_count: revisions.filter(revision => revision?.change_source === 'deadline-extension').length,
        participant_actuals: Object.entries(summaries).filter(([userId, value]) => userId !== '__total__' && value && typeof value === 'object')
          .map(([userId, value]) => ({
            user_id: userId,
            display_name: userId,
            actual_seconds: Math.max(0, Math.floor(Number(value.actual_seconds) || 0)),
            quality_status: String(value.quality_status || total.quality_status || 'unmeasured'),
          })),
        scheduled_slots: _pmCloudHistoryScheduledSlots(fm),
        _path: entry.path,
        _sheet: entry.sheet,
        _name: entry.name,
        _frontmatter: fm,
        _body: entry.body || '',
      });
    }
    return { tasks, sessions };
  }

  async function _pmCloudGetDailySnapshots(provider, url) {
    const Store = window.MeldexProductionDailySnapshotStore;
    if (!Store) throw new Error('日次スナップショット機能を利用できません');
    const workspaceId = _pmCloudHistoryWorkspaceId(
      url.searchParams.get('workspace_id') || url.searchParams.get('workspace'),
    );
    const store = new Store({ provider });
    const loaded = await store.loadFromProvider(workspaceId);
    if (!loaded?.ok) return loaded;
    const targetDate = String(url.searchParams.get('target_date') || '').trim();
    if (targetDate) return { ok: true, snapshot: store.getSnapshot(workspaceId, targetDate), cloud: true };
    return {
      ok: true,
      snapshots: store.listSnapshots(
        workspaceId,
        url.searchParams.get('start_date') || undefined,
        url.searchParams.get('end_date') || undefined,
      ),
      cloud: true,
    };
  }

  async function _pmCloudCreateDailySnapshot(provider, internals, body) {
    const Store = window.MeldexProductionDailySnapshotStore;
    const SnapshotEngine = window.MeldexProductionDailySnapshotEngine;
    if (!Store || !SnapshotEngine) throw new Error('日次スナップショット機能を利用できません');
    const workspaceId = _pmCloudHistoryWorkspaceId(body.workspace_id || body.workspace);
    const store = new Store({ provider });
    const engine = new SnapshotEngine({ snapshotStore: store });
    const targetDate = String(body.target_date || engine.calculateBusinessDate(new Date(), body.day_cutoff || '04:00')).trim();
    if (body.only_if_missing) {
      const loaded = await store.loadFromProvider(workspaceId);
      if (!loaded?.ok) return loaded;
      const existing = store.getSnapshot(workspaceId, targetDate);
      if (existing) return { ok: true, snapshot: existing, replayed: true, cloud: true };
    }
    const dataset = await _pmCloudHistoryDataset(provider, internals);
    const attendance = await _extractCloudShiftsAndBreaks(provider);
    const calendarEvents = await _pmReadCalendarStore(provider, internals, 'events');
    const snapshot = engine.buildDailySnapshot({
      workspace_id: workspaceId,
      target_date: targetDate,
      day_cutoff: body.day_cutoff || '04:00',
      tasks: dataset.tasks,
      sessions: dataset.sessions,
      attendances: { shifts: attendance.shiftsMap, breaks: attendance.breaksMap },
      calendar_events: calendarEvents,
    });
    snapshot.created_by = _resolveActorUser(provider);
    const saved = await store.saveSnapshot(workspaceId, targetDate, snapshot);
    return { ...saved, cloud: true };
  }

  function _pmCloudHistoryFilters(url) {
    return {
      work_id: url.searchParams.get('work_id') || undefined,
      assignee: url.searchParams.get('assignee') || undefined,
      status: url.searchParams.get('status') || undefined,
      quality_status: url.searchParams.get('quality_status') || undefined,
      estimated_by: url.searchParams.get('estimated_by') || undefined,
    };
  }

  async function _pmCloudProductionAnalysis(provider, internals, url) {
    const Engine = window.MeldexProductionTaskAnalysisEngine;
    if (!Engine) throw new Error('制作タスク分析機能を利用できません');
    const workspaceId = _pmCloudHistoryWorkspaceId(url.searchParams.get('workspace_id'));
    const requesterUserId = _resolveActorUser(provider);
    const requesterRole = _pmCloudHistoryRole();
    const history = await _pmCloudHistoryDataset(provider, internals);
    const dataset = { workspace_id: workspaceId, tasks: history.tasks.map(task => {
      const copy = { ...task };
      delete copy._path; delete copy._sheet; delete copy._name; delete copy._frontmatter; delete copy._body;
      return copy;
    }) };
    const filters = _pmCloudHistoryFilters(url);
    const engine = new Engine();
    const args = {
      workspaceId,
      requesterUserId,
      requesterRole,
      dataset,
      filters,
      pagination: {
        limit: Math.max(1, Math.min(1000, Number(url.searchParams.get('limit')) || 50)),
        offset: Math.max(0, Number(url.searchParams.get('offset')) || 0),
      },
    };
    if (String(url.searchParams.get('format') || '').toLowerCase() === 'csv') {
      return { ok: true, filename: 'production-analysis.csv', mime: 'text/csv;charset=utf-8', content: engine.exportAnalysisCsv(args), cloud: true };
    }
    const query = engine.queryTaskHistory(args);
    return {
      ok: true,
      tasks: query.items,
      metrics: engine.calculateImprovementMetrics(args),
      total_count: query.total_count,
      offset: query.offset,
      limit: query.limit,
      has_more: query.has_more,
      cloud: true,
    };
  }

  async function _pmCloudDeleteProductionHistory(provider, internals, body) {
    const Engine = window.MeldexProductionTaskAnalysisEngine;
    if (!Engine) throw new Error('制作タスク分析機能を利用できません');
    const target = body.target_filter && typeof body.target_filter === 'object' ? body.target_filter : {};
    const taskId = String(target.task_id || '').trim();
    const workId = String(target.work_id || '').trim();
    if (!taskId && !workId) throw _pmCloudError(400, '削除対象には task_id または work_id の指定が必要です');
    const engine = new Engine();
    const permission = engine.deleteTaskHistoryExplicitly({
      workspaceId: _pmCloudHistoryWorkspaceId(body.workspace_id),
      requesterUserId: _resolveActorUser(provider),
      requesterRole: _pmCloudHistoryRole(),
      confirmationToken: body.confirmation_token,
      targetFilter: { task_id: taskId || undefined, work_id: workId || undefined },
    });
    if (!permission.ok) throw _pmCloudError(permission.error === 'permission_denied' ? 403 : 400, permission.message);
    const history = await _pmCloudHistoryDataset(provider, internals);
    const matched = history.tasks.filter(task => (!taskId || task.task_id === taskId) && (!workId || task.work_id === workId));
    const journal = _pmCloudMutationJournal(provider, internals);
    const deletedAt = new Date().toISOString();
    const deletedTaskIds = [];
    try {
      for (const task of matched) {
        const fm = task._frontmatter;
        if (!fm.production_time_records || typeof fm.production_time_records !== 'object') continue;
        await _pmCloudJournalText(journal, task._path);
        delete fm.production_time_records;
        if (fm.properties && typeof fm.properties === 'object') {
          delete fm.properties['作業時間_実績'];
          delete fm.properties['実績作業時間'];
        }
        fm.production_time_history_deletion = {
          deleted_at: deletedAt,
          deleted_by: _resolveActorUser(provider),
          target_filter: { task_id: taskId || null, work_id: workId || null },
        };
        const sheetDir = internals._joinPath(_pmCloudRoot(internals), task._sheet);
        await _pmCloudJournalText(journal, internals._joinPath(sheetDir, '_meldex_sheet.cloud.json'));
        const stored = await _pmCloudRenameSheetStoreRow(provider, internals, sheetDir, task._name, task._name, fm);
        if (!stored) await provider.writeText(task._path, _pmCloudFrontmatterText(fm, task._body));
        deletedTaskIds.push(task.task_id);
      }
    } catch (error) {
      return _pmCloudRollbackMutation(journal, error);
    }
    return { ok: true, deleted_count: deletedTaskIds.length, deleted_task_ids: deletedTaskIds, cloud: true };
  }
