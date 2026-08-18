/**
 * gb-production-task-session-store.js: 制作管理タスク実績区間・改訂履歴台帳・データ移行
 *
 * 目的:
 *   - タスク別・担当者別の実績区間台帳（production_task_sessions）
 *   - 予定・担当・締切の追加型改訂履歴（production_task_plan_revisions）
 *   - 算出結果と根拠（production_task_actual_summaries）
 *   - 旧データを破壊しない移行（§5.4）
 *   - CAS（Compare-And-Swap）、整合性、冪等再送、権限検証
 *
 * 計画書: production-task-actual-time-history-and-analysis-plan-2026-08-15.md §5, §9
 */

(function () {
  'use strict';

  const QUALITY_CONFIRMED = 'confirmed';
  const QUALITY_INCOMPLETE = 'incomplete';
  const QUALITY_CONFLICT = 'conflict';
  const QUALITY_LEGACY_MANUAL = 'legacy-manual';
  const QUALITY_UNMEASURED = 'unmeasured';

  const VALID_QUALITY_STATUSES = new Set([
    QUALITY_CONFIRMED,
    QUALITY_INCOMPLETE,
    QUALITY_CONFLICT,
    QUALITY_LEGACY_MANUAL,
    QUALITY_UNMEASURED,
  ]);

  const CHANGE_SOURCE_INITIAL_MIGRATION = 'initial-migration';
  const CHANGE_SOURCE_RECALCULATE = 'recalculate';
  const CHANGE_SOURCE_USER_EDIT = 'user-edit';
  const CHANGE_SOURCE_DEADLINE_EXTENSION = 'deadline-extension';
  const CHANGE_SOURCE_STATUS_CHANGE = 'status-change';
  const CHANGE_SOURCE_MANUAL_CORRECTION = 'manual-correction';

  const START_REASON_STATUS_CHANGE = 'status-change';
  const START_REASON_HELP_JOIN = 'help-join';
  const START_REASON_TASK_SWITCH = 'task-switch';
  const START_REASON_MANUAL_START = 'manual-start';
  const START_REASON_MANUAL_CORRECTION = 'manual-correction';

  const END_REASON_STATUS_CHANGE = 'status-change';
  const END_REASON_HELP_LEAVE = 'help-leave';
  const END_REASON_TASK_SWITCH = 'task-switch';
  const END_REASON_MANUAL_STOP = 'manual-stop';
  const END_REASON_MANUAL_CORRECTION = 'manual-correction';

  const TIME_RECORDS_KEY = 'production_time_records';

  function nowIsoUtc() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function generateUuid(prefix = '') {
    const raw = 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    return prefix ? `${prefix}_${raw}` : raw;
  }

  function safeIntSeconds(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return fallback;
    return Math.round(num);
  }

  function hoursToSeconds(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return fallback;
    return Math.round(num * 3600);
  }

  function normalizeSessionDict(data) {
    const src = data || {};
    const sessionId = String(src.session_id || generateUuid('sess')).trim();
    return {
      session_id: sessionId,
      workspace_id: String(src.workspace_id || '').trim(),
      work_id: String(src.work_id || '').trim(),
      task_id: String(src.task_id || '').trim(),
      participant_user_id: String(src.participant_user_id || '').trim(),
      participant_display_name: String(src.participant_display_name || '').trim(),
      started_at: String(src.started_at || nowIsoUtc()).trim(),
      ended_at: src.ended_at ? String(src.ended_at).trim() : null,
      timezone: String(src.timezone || 'Asia/Tokyo').trim(),
      start_reason: String(src.start_reason || START_REASON_STATUS_CHANGE).trim(),
      end_reason: src.end_reason ? String(src.end_reason).trim() : null,
      actor_user_id: String(src.actor_user_id || src.participant_user_id || '').trim(),
      created_at: String(src.created_at || nowIsoUtc()).trim(),
      modified_at: String(src.modified_at || nowIsoUtc()).trim(),
      revision: Number(src.revision) || 1,
      correction_of: src.correction_of ? String(src.correction_of).trim() : null,
      correction_reason: src.correction_reason ? String(src.correction_reason).trim() : null,
      deleted_at: src.deleted_at ? String(src.deleted_at).trim() : null,
    };
  }

  function normalizePlanRevisionDict(data) {
    const src = data || {};
    const revisionId = String(src.revision_id || generateUuid('rev')).trim();
    let assignees = [];
    if (Array.isArray(src.assignee_user_ids)) {
      assignees = src.assignee_user_ids.map(u => String(u || '').trim()).filter(Boolean);
    } else if (typeof src.assignee_user_ids === 'string' && src.assignee_user_ids.trim()) {
      assignees = [src.assignee_user_ids.trim()];
    }

    return {
      revision_id: revisionId,
      workspace_id: String(src.workspace_id || '').trim(),
      work_id: String(src.work_id || '').trim(),
      task_id: String(src.task_id || '').trim(),
      effective_at: String(src.effective_at || nowIsoUtc()).trim(),
      estimate_seconds: safeIntSeconds(src.estimate_seconds),
      allocated_seconds: safeIntSeconds(src.allocated_seconds),
      assignee_user_ids: assignees,
      deadline_at: src.deadline_at ? String(src.deadline_at).trim() : null,
      status: String(src.status || '').trim(),
      estimated_by: String(src.estimated_by || '').trim(),
      changed_by: String(src.changed_by || '').trim(),
      change_source: String(src.change_source || CHANGE_SOURCE_USER_EDIT).trim(),
      change_reason: String(src.change_reason || '').trim(),
      revision: Number(src.revision) || 1,
    };
  }

  function normalizeActualSummaryDict(data) {
    const src = data || {};
    let qualityStatus = String(src.quality_status || QUALITY_UNMEASURED).trim();
    if (!VALID_QUALITY_STATUSES.has(qualityStatus)) {
      qualityStatus = QUALITY_UNMEASURED;
    }

    let reasons = [];
    if (Array.isArray(src.quality_reasons)) {
      reasons = src.quality_reasons.map(r => String(r || '').trim()).filter(Boolean);
    } else if (typeof src.quality_reasons === 'string' && src.quality_reasons.trim()) {
      reasons = [src.quality_reasons.trim()];
    }

    let sessionIds = [];
    if (Array.isArray(src.session_ids)) {
      sessionIds = src.session_ids.map(s => String(s || '').trim()).filter(Boolean);
    }

    return {
      task_id: String(src.task_id || '').trim(),
      participant_user_id: String(src.participant_user_id || '__total__').trim(),
      actual_seconds: safeIntSeconds(src.actual_seconds),
      calculation_revision: Number(src.calculation_revision) || 1,
      session_ids: sessionIds,
      shift_revision: Number(src.shift_revision) || 0,
      calculated_at: String(src.calculated_at || nowIsoUtc()).trim(),
      quality_status: qualityStatus,
      quality_reasons: reasons,
      source_value: src.source_value !== undefined && src.source_value !== null ? String(src.source_value).trim() : null,
    };
  }

  function extractPropertyText(frontmatter, propName) {
    if (!frontmatter || typeof frontmatter !== 'object') return '';
    const internal = frontmatter.production_internal;
    if (internal && typeof internal === 'object' && internal[propName] != null) {
      const v = String(internal[propName]).trim();
      if (v) return v;
    }
    const props = frontmatter.properties;
    if (props && typeof props === 'object' && props[propName] != null) {
      const val = props[propName];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object' && item.value != null) {
            const v = String(item.value).trim();
            if (v) return v;
          } else if (typeof item === 'string' && item.trim()) {
            return item.trim();
          }
        }
      } else if (val && typeof val === 'object' && val.value != null) {
        const v = String(val.value).trim();
        if (v) return v;
      } else {
        const v = String(val).trim();
        if (v) return v;
      }
    }
    if (frontmatter[propName] != null) {
      const v = String(frontmatter[propName]).trim();
      if (v) return v;
    }
    return '';
  }

  function extractAssignees(frontmatter) {
    const assignees = [];
    if (!frontmatter || typeof frontmatter !== 'object') return assignees;
    const props = frontmatter.properties;
    if (props && typeof props === 'object') {
      const val = props['担当者'] || props['スタッフリスト'];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object' && item.value != null) {
            const v = String(item.value).trim();
            if (v && !assignees.includes(v)) assignees.push(v);
          } else if (typeof item === 'string' && item.trim() && !assignees.includes(item.trim())) {
            assignees.push(item.trim());
          }
        }
      } else if (val && typeof val === 'object' && val.value != null) {
        const v = String(val.value).trim();
        if (v && !assignees.includes(v)) assignees.push(v);
      } else if (val != null) {
        const v = String(val).trim();
        if (v && !assignees.includes(v)) assignees.push(v);
      }
    }
    return assignees;
  }

  function migrateTaskTimeRecords(frontmatter, taskId = '', workspaceId = '', workId = '', nowIso = null) {
    const existing = frontmatter && frontmatter[TIME_RECORDS_KEY];
    if (existing && Array.isArray(existing.revisions) && existing.revisions.length > 0) {
      return JSON.parse(JSON.stringify(existing));
    }

    const ts = nowIso || nowIsoUtc();
    const tId = taskId || extractPropertyText(frontmatter, '作成キー') || extractPropertyText(frontmatter, 'タイトル') || generateUuid('task');
    const wId = workId || extractPropertyText(frontmatter, '作品タイトル') || '';

    const estimateHoursStr = (
      extractPropertyText(frontmatter, '目標作業時間_値')
      || extractPropertyText(frontmatter, '目標作業時間')
      || extractPropertyText(frontmatter, '予定作業時間')
    );
    const estimateSeconds = hoursToSeconds(estimateHoursStr);

    const allocatedHoursStr = (
      extractPropertyText(frontmatter, '作業予定時間')
      || extractPropertyText(frontmatter, '割当作業時間')
    );
    const allocatedSeconds = hoursToSeconds(allocatedHoursStr);

    const assignees = extractAssignees(frontmatter);
    const deadlineStr = extractPropertyText(frontmatter, '締切') || extractPropertyText(frontmatter, '期限') || extractPropertyText(frontmatter, '作業予定終了');
    const statusStr = extractPropertyText(frontmatter, '状況') || extractPropertyText(frontmatter, 'status') || '未着手';

    const initialRevision = normalizePlanRevisionDict({
      revision_id: generateUuid('rev'),
      workspace_id: workspaceId,
      work_id: wId,
      task_id: tId,
      effective_at: ts,
      estimate_seconds: estimateSeconds,
      allocated_seconds: allocatedSeconds,
      assignee_user_ids: assignees,
      deadline_at: deadlineStr || null,
      status: statusStr,
      estimated_by: 'migration',
      changed_by: 'migration',
      change_source: CHANGE_SOURCE_INITIAL_MIGRATION,
      change_reason: '初期データ移行（現在値の初回改訂記録）',
      revision: 1,
    });

    const manualActualStr = extractPropertyText(frontmatter, '作業時間_実績') || extractPropertyText(frontmatter, '実績作業時間');
    const summaries = {};

    if (manualActualStr) {
      const num = Number(manualActualStr);
      if (Number.isFinite(num) && num >= 0) {
        summaries['__total__'] = normalizeActualSummaryDict({
          task_id: tId,
          participant_user_id: '__total__',
          actual_seconds: Math.round(num * 3600),
          calculation_revision: 1,
          session_ids: [],
          shift_revision: 0,
          calculated_at: ts,
          quality_status: QUALITY_LEGACY_MANUAL,
          quality_reasons: ['手入力された既存実績値を出典付きで保持'],
          source_value: manualActualStr,
        });
      } else {
        summaries['__total__'] = normalizeActualSummaryDict({
          task_id: tId,
          participant_user_id: '__total__',
          actual_seconds: 0,
          calculation_revision: 1,
          session_ids: [],
          shift_revision: 0,
          calculated_at: ts,
          quality_status: QUALITY_UNMEASURED,
          quality_reasons: ['旧実績値の数値変換失敗'],
          source_value: manualActualStr,
        });
      }
    } else {
      summaries['__total__'] = normalizeActualSummaryDict({
        task_id: tId,
        participant_user_id: '__total__',
        actual_seconds: 0,
        calculation_revision: 1,
        session_ids: [],
        shift_revision: 0,
        calculated_at: ts,
        quality_status: QUALITY_UNMEASURED,
        quality_reasons: ['過去の区間根拠なし（未計測）'],
        source_value: null,
      });
    }

    return {
      version: 1,
      task_id: tId,
      sessions: [],
      revisions: [initialRevision],
      summaries: summaries,
    };
  }

  function checkSessionPermission(session, actorUserId, isAdmin = false, allowDelegate = false) {
    if (isAdmin || allowDelegate) return;
    const participant = session && session.participant_user_id;
    if (!actorUserId || (participant && actorUserId !== participant)) {
      const err = new Error(`操作者「${actorUserId}」には担当者「${participant}」の実績区間を変更する権限がありません`);
      err.name = 'ProductionTimeLedgerPermissionDenied';
      err.code = 'PERMISSION_DENIED';
      throw err;
    }
  }

  function appendOrUpdateSession(records, sessionData, actorUserId, isAdmin = false, expectedRevision = null, allowDelegate = false) {
    const updated = JSON.parse(JSON.stringify(records || { sessions: [], revisions: [], summaries: {} }));
    const sessions = updated.sessions || [];
    const session = normalizeSessionDict(sessionData);
    const sessionId = session.session_id;

    const existingIdx = sessions.findIndex(s => s.session_id === sessionId);

    if (existingIdx >= 0) {
      const existing = sessions[existingIdx];
      checkSessionPermission(existing, actorUserId, isAdmin, allowDelegate);

      if (expectedRevision !== null && expectedRevision !== undefined && existing.revision !== expectedRevision) {
        const err = new Error(`セッション ${sessionId} の競合を検出しました（期待版: ${expectedRevision}, 現在版: ${existing.revision}）`);
        err.name = 'ProductionTimeLedgerConflict';
        err.code = 'CONFLICT';
        throw err;
      }

      session.revision = (Number(existing.revision) || 1) + 1;
      session.created_at = existing.created_at || session.created_at;
      session.modified_at = nowIsoUtc();
      session.actor_user_id = actorUserId;
      sessions[existingIdx] = session;
    } else {
      checkSessionPermission(session, actorUserId, isAdmin, allowDelegate);
      session.created_at = session.created_at || nowIsoUtc();
      session.modified_at = session.created_at;
      session.revision = 1;
      session.actor_user_id = actorUserId;
      sessions.push(session);
    }

    updated.sessions = sessions;
    return { records: updated, session };
  }

  function appendPlanRevision(records, revisionData, actorUserId, isAdmin = false) {
    const updated = JSON.parse(JSON.stringify(records || { sessions: [], revisions: [], summaries: {} }));
    const revisions = updated.revisions || [];
    const rev = normalizePlanRevisionDict(revisionData);

    const maxRev = revisions.reduce((max, r) => Math.max(max, Number(r.revision) || 0), 0);
    rev.revision = maxRev + 1;
    rev.changed_by = actorUserId || rev.changed_by || 'user';
    rev.effective_at = rev.effective_at || nowIsoUtc();

    revisions.push(rev);
    updated.revisions = revisions;
    return { records: updated, revision: rev };
  }

  function setActualSummary(records, summaryData) {
    const updated = JSON.parse(JSON.stringify(records || { sessions: [], revisions: [], summaries: {} }));
    const summaries = updated.summaries || {};
    const summary = normalizeActualSummaryDict(summaryData);
    const key = summary.participant_user_id || '__total__';

    summaries[key] = summary;
    updated.summaries = summaries;
    return { records: updated, summary };
  }

  function createTaskRecords(workspaceId, workId, taskId) {
    return {
      workspace_id: String(workspaceId || 'default').trim(),
      work_id: String(workId || '').trim(),
      task_id: String(taskId || '').trim(),
      sessions: [],
      revisions: [],
      summaries: {},
    };
  }

  const Store = Object.freeze({
    QUALITY_CONFIRMED,
    QUALITY_INCOMPLETE,
    QUALITY_CONFLICT,
    QUALITY_LEGACY_MANUAL,
    QUALITY_UNMEASURED,
    VALID_QUALITY_STATUSES,
    CHANGE_SOURCE_INITIAL_MIGRATION,
    CHANGE_SOURCE_RECALCULATE,
    CHANGE_SOURCE_USER_EDIT,
    CHANGE_SOURCE_DEADLINE_EXTENSION,
    CHANGE_SOURCE_STATUS_CHANGE,
    CHANGE_SOURCE_MANUAL_CORRECTION,
    START_REASON_STATUS_CHANGE,
    START_REASON_HELP_JOIN,
    START_REASON_TASK_SWITCH,
    START_REASON_MANUAL_START,
    START_REASON_MANUAL_CORRECTION,
    END_REASON_STATUS_CHANGE,
    END_REASON_HELP_LEAVE,
    END_REASON_TASK_SWITCH,
    END_REASON_MANUAL_STOP,
    END_REASON_MANUAL_CORRECTION,
    TIME_RECORDS_KEY,
    nowIsoUtc,
    generateUuid,
    safeIntSeconds,
    hoursToSeconds,
    createTaskRecords,
    normalizeSessionDict,
    normalizePlanRevisionDict,
    normalizeActualSummaryDict,
    extractPropertyText,
    extractAssignees,
    migrateTaskTimeRecords,
    checkSessionPermission,
    appendOrUpdateSession,
    appendPlanRevision,
    setActualSummary,
  });

  if (typeof window !== 'undefined') {
    window.MeldexProductionTaskSessionStore = Store;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Store;
  }
})();
