/* gb-production-task-analysis-engine.js: 制作タスクAI分析・集計・構造化履歴・CSVエンジン */
(function() {
  'use strict';

  const ROLE_ADMIN = 'admin';
  const ROLE_OWNER = 'owner';
  const ROLE_MEMBER = 'member';

  class MeldexProductionTaskAnalysisEngine {
    constructor() {}

    isAdminOrOwner(role) {
      const r = String(role || ROLE_MEMBER).trim().toLowerCase();
      return r === ROLE_ADMIN || r === ROLE_OWNER;
    }

    _filterByPermissions(tasks, requesterUserId, requesterRole) {
      if (this.isAdminOrOwner(requesterRole)) {
        return tasks;
      }

      const uid = String(requesterUserId || '').trim();
      const filtered = [];
      for (const t of tasks) {
        const assignee = String(t.assignee || '').trim();
        const participants = new Set(
          (t.participant_actuals || []).map(p => String(p.user_id || p.display_name || '').trim())
        );
        if (assignee === uid || participants.has(uid)) {
          filtered.push(t);
        }
      }
      return filtered;
    }

    queryTaskHistory(args = {}) {
      const ws = String(args.workspaceId || args.workspace_id || 'default').trim();
      const requesterUserId = String(args.requesterUserId || args.requester_user_id || '').trim();
      const requesterRole = String(args.requesterRole || args.requester_role || 'member').trim();
      const dataset = args.dataset || {};
      const allTasks = dataset.tasks || [];
      const filters = args.filters || {};
      const pagination = args.pagination || {};

      const visibleTasks = this._filterByPermissions(allTasks, requesterUserId, requesterRole);

      const workIdFilter = filters.work_id || filters.workId;
      const assigneeFilter = filters.assignee;
      const statusFilter = filters.status;
      const qualityFilter = filters.quality_status || filters.qualityStatus;
      const estimatedByFilter = filters.estimated_by || filters.estimatedBy;

      const matched = [];
      for (const t of visibleTasks) {
        if (workIdFilter && String(t.work_id || '') !== String(workIdFilter)) continue;
        if (assigneeFilter && String(t.assignee || '') !== String(assigneeFilter)) continue;
        if (statusFilter && String(t.status || '') !== String(statusFilter)) continue;
        if (qualityFilter && String(t.quality_status || '') !== String(qualityFilter)) continue;
        if (estimatedByFilter && String(t.estimated_by || '') !== String(estimatedByFilter)) continue;
        matched.push(JSON.parse(JSON.stringify(t)));
      }

      const totalCount = matched.length;
      const limit = parseInt(pagination.limit, 10) || 50;
      const offset = parseInt(pagination.offset, 10) || 0;

      const items = matched.slice(offset, offset + limit);
      const hasMore = (offset + limit) < totalCount;

      return {
        ok: true,
        workspace_id: ws,
        total_count: totalCount,
        offset: offset,
        limit: limit,
        has_more: hasMore,
        items: items,
      };
    }

    calculateImprovementMetrics(args = {}) {
      const ws = String(args.workspaceId || args.workspace_id || 'default').trim();
      const requesterUserId = String(args.requesterUserId || args.requester_user_id || '').trim();
      const requesterRole = String(args.requesterRole || args.requester_role || 'member').trim();
      const dataset = args.dataset || {};
      const allTasks = dataset.tasks || [];
      const filters = args.filters || {};

      let tasks = this._filterByPermissions(allTasks, requesterUserId, requesterRole);

      const workIdFilter = filters.work_id || filters.workId;
      if (workIdFilter) {
        tasks = tasks.filter(t => String(t.work_id || '') === String(workIdFilter));
      }

      const assigneeGroups = {};
      const estimatorGroups = {};
      const qualityCounts = {};

      let totalEstimateSec = 0;
      let totalActualSec = 0;
      let totalAllocatedSec = 0;
      let deadlineExtensionsTotal = 0;

      for (const t of tasks) {
        const assignee = String(t.assignee || 'unassigned').trim();
        const estimator = String(t.estimated_by || 'unassigned').trim();
        const qStatus = String(t.quality_status || 'unmeasured').trim();

        assigneeGroups[assignee] = assigneeGroups[assignee] || [];
        assigneeGroups[assignee].push(t);

        estimatorGroups[estimator] = estimatorGroups[estimator] || [];
        estimatorGroups[estimator].push(t);

        qualityCounts[qStatus] = (qualityCounts[qStatus] || 0) + 1;

        const est = parseInt(t.estimate_seconds, 10) || 0;
        const act = parseInt(t.actual_seconds, 10) || 0;
        const alloc = parseInt(t.allocated_seconds, 10) || 0;
        const ext = parseInt(t.deadline_extension_count, 10) || 0;

        totalEstimateSec += est;
        totalActualSec += act;
        totalAllocatedSec += alloc;
        deadlineExtensionsTotal += ext;
      }

      const assigneeMetrics = {};
      for (const [assignee, aTasks] of Object.entries(assigneeGroups)) {
        const confirmedTasks = aTasks.filter(t => t.quality_status === 'confirmed');
        const confEst = confirmedTasks.reduce((sum, t) => sum + (parseInt(t.estimate_seconds, 10) || 0), 0);
        const confAct = confirmedTasks.reduce((sum, t) => sum + (parseInt(t.actual_seconds, 10) || 0), 0);
        const overrunRatio = confEst > 0 ? (confAct / confEst) : (confAct === 0 ? 1.0 : 0.0);

        assigneeMetrics[assignee] = {
          sample_count: aTasks.length,
          confirmed_sample_count: confirmedTasks.length,
          total_estimate_seconds: confEst,
          total_actual_seconds: confAct,
          overrun_ratio: Math.round(overrunRatio * 10000) / 10000,
          overtime_seconds: aTasks.reduce((sum, t) => sum + (parseInt(t.overtime_seconds, 10) || 0), 0),
        };
      }

      const estimatorMetrics = {};
      for (const [estimator, eTasks] of Object.entries(estimatorGroups)) {
        const diffs = eTasks
          .filter(t => t.quality_status === 'confirmed')
          .map(t => (parseInt(t.actual_seconds, 10) || 0) - (parseInt(t.estimate_seconds, 10) || 0));

        let meanDiff = 0;
        let medianDiff = 0;
        let p90Diff = 0;

        if (diffs.length > 0) {
          diffs.sort((a, b) => a - b);
          meanDiff = diffs.reduce((sum, v) => sum + v, 0) / diffs.length;
          medianDiff = diffs[Math.floor(diffs.length / 2)];
          const idx90 = Math.min(Math.ceil(diffs.length * 0.9) - 1, diffs.length - 1);
          p90Diff = diffs[Math.max(0, idx90)];
        }

        estimatorMetrics[estimator] = {
          sample_count: eTasks.length,
          confirmed_count: diffs.length,
          mean_variance_seconds: Math.round(meanDiff * 10) / 10,
          median_variance_seconds: Math.round(medianDiff * 10) / 10,
          p90_variance_seconds: Math.round(p90Diff * 10) / 10,
        };
      }

      return {
        ok: true,
        workspace_id: ws,
        total_tasks: tasks.length,
        total_estimate_seconds: totalEstimateSec,
        total_allocated_seconds: totalAllocatedSec,
        total_actual_seconds: totalActualSec,
        deadline_extensions_total: deadlineExtensionsTotal,
        assignee_metrics: assigneeMetrics,
        estimator_metrics: estimatorMetrics,
        quality_counts: qualityCounts,
      };
    }

    _formatDuration(seconds) {
      if (window.MeldexProductionTimeFormatter?.formatDuration) {
        return window.MeldexProductionTimeFormatter.formatDuration(seconds);
      }
      const s = Number(seconds) || 0;
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (h > 0 && m > 0) return `${h}時間${m}分`;
      if (h > 0) return `${h}時間`;
      return `${m}分`;
    }

    exportAnalysisCsv(args = {}) {
      const res = this.queryTaskHistory({
        ...args,
        pagination: { limit: 100000, offset: 0 },
      });
      const tasks = res.items || [];

      const escapeCsvCell = (val) => {
        const s = String(val == null ? '' : val);
        if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const headers = [
        'task_id',
        'work_id',
        'work_title',
        'task_title',
        'assignee',
        'estimated_by',
        'status',
        'estimate_seconds',
        'estimate_display',
        'allocated_seconds',
        'allocated_display',
        'actual_seconds',
        'actual_display',
        'variance_ratio',
        'quality_status',
        'deadline',
        'completed_at',
      ];

      const lines = ['\ufeff' + headers.join(',')];

      for (const t of tasks) {
        const estSec = parseInt(t.estimate_seconds, 10) || 0;
        const allocSec = parseInt(t.allocated_seconds, 10) || 0;
        const actSec = parseInt(t.actual_seconds, 10) || 0;
        const varRatio = estSec > 0 ? (actSec / estSec) : (actSec === 0 ? 1.0 : 0.0);

        const row = [
          escapeCsvCell(t.task_id || ''),
          escapeCsvCell(t.work_id || ''),
          escapeCsvCell(t.work_title || ''),
          escapeCsvCell(t.title || ''),
          escapeCsvCell(t.assignee || ''),
          escapeCsvCell(t.estimated_by || ''),
          escapeCsvCell(t.status || ''),
          escapeCsvCell(estSec),
          escapeCsvCell(this._formatDuration(estSec)),
          escapeCsvCell(allocSec),
          escapeCsvCell(this._formatDuration(allocSec)),
          escapeCsvCell(actSec),
          escapeCsvCell(this._formatDuration(actSec)),
          escapeCsvCell(varRatio.toFixed(2)),
          escapeCsvCell(t.quality_status || ''),
          escapeCsvCell(t.deadline || ''),
          escapeCsvCell(t.completed_at || ''),
        ];
        lines.push(row.join(','));
      }

      return lines.join('\n');
    }

    deleteTaskHistoryExplicitly(args = {}) {
      const requesterRole = String(args.requesterRole || args.requester_role || 'member').trim();
      const confirmationToken = String(args.confirmationToken || args.confirmation_token || '').trim();

      if (!this.isAdminOrOwner(requesterRole)) {
        return {
          ok: false,
          error: 'permission_denied',
          message: 'タスク履歴の明示削除は管理者のみ実行できます',
        };
      }

      if (confirmationToken !== 'CONFIRM_DELETE') {
        return {
          ok: false,
          error: 'invalid_confirmation_token',
          message: '確認トークンが正しくありません',
        };
      }

      return {
        ok: true,
        workspace_id: args.workspaceId || args.workspace_id || 'default',
        deleted_by: args.requesterUserId || args.requester_user_id || '',
        target_filter: args.targetFilter || args.target_filter || {},
        message: 'タスク履歴を明示的に削除しました',
      };
    }
  }

  if (typeof window !== 'undefined') {
    window.MeldexProductionTaskAnalysisEngine = MeldexProductionTaskAnalysisEngine;
    window.ROLE_ADMIN = ROLE_ADMIN;
    window.ROLE_OWNER = ROLE_OWNER;
    window.ROLE_MEMBER = ROLE_MEMBER;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      MeldexProductionTaskAnalysisEngine,
      ROLE_ADMIN,
      ROLE_OWNER,
      ROLE_MEMBER,
    };
  }
})();
