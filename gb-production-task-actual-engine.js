/**
 * gb-production-task-actual-engine.js: 制作管理実績作業時間・勤怠交差計算エンジン
 *
 * 目的:
 *   - ステータス変更と実績区間の自動開始・終了接続（着手中、保留、確認待ち、完了）
 *   - 応援参加（help-join）、担当解除（help-leave）、タスク切替（task-switch）
 *   - 出退勤（勤務区間）・離席区間との半開区間積集合・差集合計算:
 *       Actual(t, u) = (TaskSessions(t, u) ∩ WorkShifts(u)) - BreakIntervals(u)
 *   - 日跨ぎ、重複打刻、不完全打刻（退勤なし/離席復帰なし/セッション継続中）、訂正時再計算
 *   - 二重計上防止
 *
 * 計画書: production-task-actual-time-history-and-analysis-plan-2026-08-15.md §4, §5, §10
 */

(function () {
  'use strict';

  const Store = (typeof window !== 'undefined' && window.MeldexProductionTaskSessionStore)
    || (typeof require !== 'undefined' ? require('./gb-production-task-session-store.js') : null);

  const QUALITY_CONFIRMED = Store ? Store.QUALITY_CONFIRMED : 'confirmed';
  const QUALITY_INCOMPLETE = Store ? Store.QUALITY_INCOMPLETE : 'incomplete';
  const QUALITY_CONFLICT = Store ? Store.QUALITY_CONFLICT : 'conflict';
  const QUALITY_LEGACY_MANUAL = Store ? Store.QUALITY_LEGACY_MANUAL : 'legacy-manual';
  const QUALITY_UNMEASURED = Store ? Store.QUALITY_UNMEASURED : 'unmeasured';

  const START_REASON_STATUS_CHANGE = 'status-change';
  const START_REASON_HELP_JOIN = 'help-join';
  const START_REASON_TASK_SWITCH = 'task-switch';
  const START_REASON_MANUAL_START = 'manual-start';

  const END_REASON_STATUS_CHANGE = 'status-change';
  const END_REASON_HELP_LEAVE = 'help-leave';
  const END_REASON_TASK_SWITCH = 'task-switch';
  const END_REASON_MANUAL_STOP = 'manual-stop';

  const CANONICAL_STATUS_IN_PROGRESS = '着手中';
  const CANONICAL_STATUS_NOT_STARTED = '未着手';
  const CANONICAL_STATUS_PENDING = '保留';
  const CANONICAL_STATUS_REVIEW_WAITING = '確認待ち';
  const CANONICAL_STATUS_DONE = '完了';

  const LEGACY_STATUS_SYNONYMS = {
    '作業中': CANONICAL_STATUS_IN_PROGRESS,
    '進行中': CANONICAL_STATUS_IN_PROGRESS,
    '着手中': CANONICAL_STATUS_IN_PROGRESS,
    '未着手': CANONICAL_STATUS_NOT_STARTED,
    '': CANONICAL_STATUS_NOT_STARTED,
    '保留': CANONICAL_STATUS_PENDING,
    '確認待ち': CANONICAL_STATUS_REVIEW_WAITING,
    '完了': CANONICAL_STATUS_DONE,
  };

  function normalizeTaskStatus(status) {
    const raw = String(status || '').trim();
    return LEGACY_STATUS_SYNONYMS[raw] || raw || CANONICAL_STATUS_NOT_STARTED;
  }

  function isActiveWorkingStatus(status) {
    return normalizeTaskStatus(status) === CANONICAL_STATUS_IN_PROGRESS;
  }

  function parseIsoToEpochSec(isoStr) {
    if (!isoStr || !String(isoStr).trim()) return null;
    const raw = String(isoStr).trim();
    const d = new Date(raw);
    const time = d.getTime();
    if (!Number.isFinite(time)) return null;
    return Math.floor(time / 1000);
  }

  function formatEpochSecToIso(epochSec) {
    if (epochSec === null || epochSec === undefined) return null;
    return new Date(epochSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  // =====================================================================
  // TimeInterval Class & Algebra
  // =====================================================================

  class TimeInterval {
    constructor(startSec, endSec) {
      if (endSec < startSec) {
        throw new Error(`Invalid interval: start (${startSec}) > end (${endSec})`);
      }
      this.start = Math.floor(Number(startSec));
      this.end = Math.floor(Number(endSec));
    }

    get duration() {
      return Math.max(0, this.end - this.start);
    }

    isEmpty() {
      return this.start >= this.end;
    }

    overlaps(other) {
      return Math.max(this.start, other.start) < Math.min(this.end, other.end);
    }

    intersect(other) {
      const s = Math.max(this.start, other.start);
      const e = Math.min(this.end, other.end);
      if (s < e) {
        return new TimeInterval(s, e);
      }
      return null;
    }

    subtract(other) {
      const inter = this.intersect(other);
      if (!inter) {
        return [new TimeInterval(this.start, this.end)];
      }
      const result = [];
      if (this.start < inter.start) {
        result.append ? result.append(new TimeInterval(this.start, inter.start)) : result.push(new TimeInterval(this.start, inter.start));
      }
      if (inter.end < this.end) {
        result.push(new TimeInterval(inter.end, this.end));
      }
      return result;
    }
  }

  function mergeIntervals(intervals) {
    if (!intervals || !intervals.length) return [];
    const valid = intervals.filter(iv => !iv.isEmpty());
    if (!valid.length) return [];
    const sorted = [...valid].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = merged[merged.length - 1];
      if (current.start <= last.end) {
        merged[merged.length - 1] = new TimeInterval(last.start, Math.max(last.end, current.end));
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  function intersectIntervalLists(listA, listB) {
    const mergedA = mergeIntervals(listA);
    const mergedB = mergeIntervals(listB);
    const result = [];

    for (const a of mergedA) {
      for (const b of mergedB) {
        const inter = a.intersect(b);
        if (inter && !inter.isEmpty()) {
          result.push(inter);
        }
      }
    }
    return mergeIntervals(result);
  }

  function subtractIntervalLists(sourceList, subtractList) {
    let current = mergeIntervals(sourceList);
    const subs = mergeIntervals(subtractList);

    for (const sub of subs) {
      const nextGen = [];
      for (const iv of current) {
        nextGen.push(...iv.subtract(sub));
      }
      current = nextGen;
    }
    return mergeIntervals(current);
  }

  function computeUserTaskActualIntersection(sessionIntervals, shiftIntervals, breakIntervals) {
    const workedIntervals = intersectIntervalLists(sessionIntervals, shiftIntervals);
    const actualIntervals = subtractIntervalLists(workedIntervals, breakIntervals);
    const actualSeconds = actualIntervals.reduce((sum, iv) => sum + iv.duration, 0);
    return { actualSeconds, actualIntervals };
  }

  // =====================================================================
  // Status Transitions & Participant Actions
  // =====================================================================

  function handleTaskStatusTransition(
    records,
    newStatus,
    actorUserId,
    targetUserIds = null,
    transitionTimeIso = null,
    isAdmin = false
  ) {
    const store = Store || (typeof window !== 'undefined' ? window.MeldexProductionTaskSessionStore : null);
    const updated = JSON.parse(JSON.stringify(records || { sessions: [], revisions: [], summaries: {} }));
    const ts = transitionTimeIso || (store ? store.nowIsoUtc() : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    const canonicalStatus = normalizeTaskStatus(newStatus);
    const sessions = updated.sessions || [];
    const modified = [];

    if (canonicalStatus === CANONICAL_STATUS_IN_PROGRESS) {
      let targets = Array.isArray(targetUserIds)
        ? [...targetUserIds]
        : (typeof targetUserIds === 'string' && targetUserIds.trim() ? [targetUserIds.trim()] : null);
      if (targets === null) {
        const revs = updated.revisions || [];
        if (revs.length) {
          targets = [...(revs[revs.length - 1].assignee_user_ids || [])];
        }
        if (!targets || !targets.length) {
          targets = actorUserId ? [actorUserId] : [];
        }
      }

      const targetList = targets.map(u => String(u || '').trim()).filter(Boolean);

      // Close open sessions for assignees no longer in targets (if explicit targetUserIds was provided, keeping helper sessions)
      if (targetUserIds !== null) {
        for (const sess of [...sessions]) {
          if (!sess.ended_at && !sess.deleted_at) {
            if (sess.start_reason === START_REASON_HELP_JOIN) {
              continue;
            }
            if (!targetList.includes(sess.participant_user_id)) {
              const updateSess = { ...sess, ended_at: ts, end_reason: END_REASON_STATUS_CHANGE };
              const res = store.appendOrUpdateSession(updated, updateSess, actorUserId, isAdmin, null, true);
              updated.sessions = res.records.sessions;
              modified.push(res.session);
            }
          }
        }
      }

      // Start sessions for target assignees who do not have an open session
      const currentSessions = updated.sessions || [];
      for (const uIdStr of targetList) {
        const hasOpen = currentSessions.some(
          s => s.participant_user_id === uIdStr && !s.ended_at && !s.deleted_at
        );
        if (!hasOpen) {
          const newSess = {
            session_id: store ? store.generateUuid('sess') : 'sess_' + Math.random().toString(16).slice(2),
            task_id: updated.task_id || '',
            participant_user_id: uIdStr,
            participant_display_name: uIdStr,
            started_at: ts,
            ended_at: null,
            start_reason: START_REASON_STATUS_CHANGE,
            actor_user_id: actorUserId,
          };
          const res = store.appendOrUpdateSession(updated, newSess, actorUserId, isAdmin, null, true);
          updated.sessions = res.records.sessions;
          modified.push(res.session);
        }
      }
    } else {
      // Close all open sessions unconditionally on non-in-progress status
      for (const sess of [...sessions]) {
        if (!sess.ended_at && !sess.deleted_at) {
          const updateSess = { ...sess, ended_at: ts, end_reason: END_REASON_STATUS_CHANGE };
          const res = store.appendOrUpdateSession(updated, updateSess, actorUserId, isAdmin, null, true);
          updated.sessions = res.records.sessions;
          modified.push(res.session);
        }
      }
    }

    return { records: updated, modifiedSessions: modified };
  }

  function handleAssigneeChange(
    records,
    newAssigneeUserIds,
    actorUserId,
    currentStatus = null,
    transitionTimeIso = null,
    isAdmin = false
  ) {
    const store = Store || (typeof window !== 'undefined' ? window.MeldexProductionTaskSessionStore : null);
    const updated = JSON.parse(JSON.stringify(records || { sessions: [], revisions: [], summaries: {} }));
    const ts = transitionTimeIso || (store ? store.nowIsoUtc() : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    const canonicalStatus = normalizeTaskStatus(currentStatus || '');
    if (!isActiveWorkingStatus(canonicalStatus)) {
      return { records: updated, modifiedSessions: [] };
    }

    let targets = [];
    if (Array.isArray(newAssigneeUserIds)) {
      targets = newAssigneeUserIds.map(u => String(u || '').trim()).filter(Boolean);
    } else if (typeof newAssigneeUserIds === 'string') {
      targets = newAssigneeUserIds.split(/[,、;]+/).map(u => u.trim()).filter(Boolean);
    } else if (newAssigneeUserIds) {
      targets = [String(newAssigneeUserIds).trim()].filter(Boolean);
    }

    const sessions = updated.sessions || [];
    const modified = [];

    // 1. Close open sessions for assignees no longer in targets (keeping helper sessions)
    for (const sess of [...sessions]) {
      if (!sess.ended_at && !sess.deleted_at) {
        if (sess.start_reason === START_REASON_HELP_JOIN) {
          continue;
        }
        if (!targets.includes(sess.participant_user_id)) {
          const updateSess = { ...sess, ended_at: ts, end_reason: END_REASON_STATUS_CHANGE };
          const res = store.appendOrUpdateSession(updated, updateSess, actorUserId, isAdmin, null, true);
          updated.sessions = res.records.sessions;
          modified.push(res.session);
        }
      }
    }

    // 2. Start open sessions for new assignees who do not have an open session
    const currentSessions = updated.sessions || [];
    for (const uIdStr of targets) {
      const hasOpen = currentSessions.some(
        s => s.participant_user_id === uIdStr && !s.ended_at && !s.deleted_at
      );
      if (!hasOpen) {
        const newSess = {
          session_id: store ? store.generateUuid('sess') : 'sess_' + Math.random().toString(16).slice(2),
          task_id: updated.task_id || '',
          participant_user_id: uIdStr,
          participant_display_name: uIdStr,
          started_at: ts,
          ended_at: null,
          start_reason: START_REASON_STATUS_CHANGE,
          actor_user_id: actorUserId,
        };
        const res = store.appendOrUpdateSession(updated, newSess, actorUserId, isAdmin, null, true);
        updated.sessions = res.records.sessions;
        modified.push(res.session);
      }
    }

    return { records: updated, modifiedSessions: modified };
  }

  function handleParticipantJoin(
    records,
    participantUserId,
    participantDisplayName,
    actorUserId,
    joinTimeIso = null,
    isAdmin = false
  ) {
    const store = Store || (typeof window !== 'undefined' ? window.MeldexProductionTaskSessionStore : null);
    const updated = JSON.parse(JSON.stringify(records || { sessions: [], revisions: [], summaries: {} }));
    const ts = joinTimeIso || (store ? store.nowIsoUtc() : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    const pId = String(participantUserId || '').trim();
    const sessions = updated.sessions || [];

    const existingOpen = sessions.find(
      s => s.participant_user_id === pId && !s.ended_at && !s.deleted_at
    );
    if (existingOpen) {
      return { records: updated, session: existingOpen };
    }

    const newSess = {
      session_id: store ? store.generateUuid('sess') : 'sess_' + Math.random().toString(16).slice(2),
      task_id: updated.task_id || '',
      participant_user_id: pId,
      participant_display_name: String(participantDisplayName || pId).trim(),
      started_at: ts,
      ended_at: null,
      start_reason: START_REASON_HELP_JOIN,
      actor_user_id: actorUserId,
    };
    const res = store.appendOrUpdateSession(updated, newSess, actorUserId, isAdmin, null, true);
    return { records: res.records, session: res.session };
  }

  function handleParticipantLeave(
    records,
    participantUserId,
    actorUserId,
    leaveTimeIso = null,
    isAdmin = false
  ) {
    const store = Store || (typeof window !== 'undefined' ? window.MeldexProductionTaskSessionStore : null);
    const updated = JSON.parse(JSON.stringify(records || { sessions: [], revisions: [], summaries: {} }));
    const ts = leaveTimeIso || (store ? store.nowIsoUtc() : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    const pId = String(participantUserId || '').trim();
    const sessions = updated.sessions || [];

    const openSess = sessions.find(
      s => s.participant_user_id === pId && !s.ended_at && !s.deleted_at
    );
    if (!openSess) {
      return { records: updated, session: null };
    }

    const updateSess = { ...openSess, ended_at: ts, end_reason: END_REASON_HELP_LEAVE };
    const res = store.appendOrUpdateSession(updated, updateSess, actorUserId, isAdmin, null, true);
    return { records: res.records, session: res.session };
  }

  function handleTaskSwitch(
    recordsFrom,
    recordsTo,
    userId,
    userDisplayName,
    switchTimeIso = null,
    actorUserId = null,
    isAdmin = false
  ) {
    const store = Store || (typeof window !== 'undefined' ? window.MeldexProductionTaskSessionStore : null);
    const ts = switchTimeIso || (store ? store.nowIsoUtc() : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    const actor = actorUserId || userId;

    let updatedFrom = JSON.parse(JSON.stringify(recordsFrom || { sessions: [], revisions: [], summaries: {} }));
    const sessionsFrom = updatedFrom.sessions || [];
    const openSessA = sessionsFrom.find(
      s => s.participant_user_id === userId && !s.ended_at && !s.deleted_at
    );
    let closedA = null;
    if (openSessA) {
      const updateA = { ...openSessA, ended_at: ts, end_reason: END_REASON_TASK_SWITCH };
      const resA = store.appendOrUpdateSession(updatedFrom, updateA, actor, isAdmin);
      updatedFrom = resA.records;
      closedA = resA.session;
    }

    let updatedTo = JSON.parse(JSON.stringify(recordsTo || { sessions: [], revisions: [], summaries: {} }));
    const newSessB = {
      session_id: store ? store.generateUuid('sess') : 'sess_' + Math.random().toString(16).slice(2),
      task_id: updatedTo.task_id || '',
      participant_user_id: userId,
      participant_display_name: userDisplayName || userId,
      started_at: ts,
      ended_at: null,
      start_reason: START_REASON_TASK_SWITCH,
      actor_user_id: actor,
    };
    const resB = store.appendOrUpdateSession(updatedTo, newSessB, actor, isAdmin);
    updatedTo = resB.records;
    const createdB = resB.session;

    return {
      recordsFrom: updatedFrom,
      closedSessionA: closedA,
      recordsTo: updatedTo,
      newSessionB: createdB,
    };
  }

  function recalculateTaskSummaries(
    records,
    userShiftsMap,
    userBreaksMap,
    shiftRevision = 0,
    calculationTimeIso = null
  ) {
    const store = Store || (typeof window !== 'undefined' ? window.MeldexProductionTaskSessionStore : null);
    const updated = JSON.parse(JSON.stringify(records || { sessions: [], revisions: [], summaries: {} }));
    const calcTs = calculationTimeIso || (store ? store.nowIsoUtc() : new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
    const taskId = updated.task_id || '';
    const sessions = updated.sessions || [];

    const existingSummaries = updated.summaries || {};
    if (!sessions.length) {
      const totalSummary = existingSummaries['__total__'];
      if (totalSummary && totalSummary.quality_status === QUALITY_LEGACY_MANUAL) {
        return { records: updated, summaries: existingSummaries };
      }
      const unmeasuredSummary = store.normalizeActualSummaryDict({
        task_id: taskId,
        participant_user_id: '__total__',
        actual_seconds: 0,
        calculation_revision: 1,
        session_ids: [],
        shift_revision: shiftRevision,
        calculated_at: calcTs,
        quality_status: QUALITY_UNMEASURED,
        quality_reasons: ['区間根拠なし（未計測）'],
      });
      updated.summaries = { '__total__': unmeasuredSummary };
      return { records: updated, summaries: updated.summaries };
    }

    const userSessions = {};
    for (const sess of sessions) {
      if (sess.deleted_at) continue;
      const uid = sess.participant_user_id || 'anonymous';
      if (!userSessions[uid]) userSessions[uid] = [];
      userSessions[uid].push(sess);
    }

    const newSummaries = {};
    let totalSeconds = 0;
    const allSessionIds = [];
    let overallQualityStatus = QUALITY_CONFIRMED;
    const overallReasons = [];

    for (const [uid, uSessList] of Object.entries(userSessions)) {
      const sessIntervals = [];
      const userSessionIds = uSessList.map(s => s.session_id).filter(Boolean);
      allSessionIds.push(...userSessionIds);

      let uQualityStatus = QUALITY_CONFIRMED;
      const uReasons = [];

      for (const s of uSessList) {
        const sStart = parseIsoToEpochSec(s.started_at);
        const sEnd = parseIsoToEpochSec(s.ended_at);

        if (sStart === null) {
          uQualityStatus = QUALITY_CONFLICT;
          uReasons.push(`セッション ${s.session_id} の開始時刻が不正です`);
          continue;
        }

        if (sEnd === null) {
          uQualityStatus = QUALITY_INCOMPLETE;
          uReasons.push('作業セッションが継続中です（未完了）');
          continue;
        }

        if (sEnd < sStart) {
          uQualityStatus = QUALITY_CONFLICT;
          uReasons.push(`セッション ${s.session_id} の終了時刻が開始時刻より前です`);
          continue;
        }

        sessIntervals.push(new TimeInterval(sStart, sEnd));
      }

      const rawShifts = (userShiftsMap && userShiftsMap[uid]) || [];
      const shiftIntervals = [];
      for (const sh of rawShifts) {
        const shStart = parseIsoToEpochSec(sh.start || sh.started_at);
        const shEnd = parseIsoToEpochSec(sh.end || sh.ended_at);

        if (shStart === null) continue;
        if (shEnd === null) {
          uQualityStatus = QUALITY_INCOMPLETE;
          uReasons.push('退勤打刻がありません');
          continue;
        }
        if (shEnd < shStart) {
          uQualityStatus = QUALITY_CONFLICT;
          uReasons.push('出勤・退勤時刻が逆転しています');
          continue;
        }
        shiftIntervals.push(new TimeInterval(shStart, shEnd));
      }

      const rawBreaks = (userBreaksMap && userBreaksMap[uid]) || [];
      const breakIntervals = [];
      for (const br of rawBreaks) {
        const brStart = parseIsoToEpochSec(br.start || br.started_at);
        const brEnd = parseIsoToEpochSec(br.end || br.ended_at);

        if (brStart === null) continue;
        if (brEnd === null) {
          uQualityStatus = QUALITY_INCOMPLETE;
          uReasons.push('離席復帰打刻がありません');
          continue;
        }
        if (brEnd < brStart) {
          uQualityStatus = QUALITY_CONFLICT;
          uReasons.push('離席・復帰時刻が逆転しています');
          continue;
        }
        breakIntervals.push(new TimeInterval(brStart, brEnd));
      }

      const { actualSeconds } = computeUserTaskActualIntersection(sessIntervals, shiftIntervals, breakIntervals);
      totalSeconds += actualSeconds;

      if (uQualityStatus === QUALITY_CONFIRMED && !sessIntervals.length && uSessList.length) {
        uQualityStatus = QUALITY_INCOMPLETE;
      }

      const prevRev = (updated.summaries && updated.summaries[uid] && updated.summaries[uid].calculation_revision) || 0;
      const userSummary = store.normalizeActualSummaryDict({
        task_id: taskId,
        participant_user_id: uid,
        actual_seconds: actualSeconds,
        calculation_revision: prevRev + 1,
        session_ids: userSessionIds,
        shift_revision: shiftRevision,
        calculated_at: calcTs,
        quality_status: uQualityStatus,
        quality_reasons: uReasons,
      });
      newSummaries[uid] = userSummary;

      if (uQualityStatus === QUALITY_CONFLICT) {
        overallQualityStatus = QUALITY_CONFLICT;
      } else if (uQualityStatus === QUALITY_INCOMPLETE && overallQualityStatus !== QUALITY_CONFLICT) {
        overallQualityStatus = QUALITY_INCOMPLETE;
      }
      overallReasons.push(...uReasons);
    }

    const prevTotalRev = (updated.summaries && updated.summaries['__total__'] && updated.summaries['__total__'].calculation_revision) || 0;
    const totalSummary = store.normalizeActualSummaryDict({
      task_id: taskId,
      participant_user_id: '__total__',
      actual_seconds: totalSeconds,
      calculation_revision: prevTotalRev + 1,
      session_ids: Array.from(new Set(allSessionIds)),
      shift_revision: shiftRevision,
      calculated_at: calcTs,
      quality_status: overallQualityStatus,
      quality_reasons: Array.from(new Set(overallReasons)),
    });
    newSummaries['__total__'] = totalSummary;

    updated.summaries = newSummaries;
    return { records: updated, summaries: newSummaries };
  }

  const Engine = Object.freeze({
    QUALITY_CONFIRMED,
    QUALITY_INCOMPLETE,
    QUALITY_CONFLICT,
    QUALITY_LEGACY_MANUAL,
    QUALITY_UNMEASURED,
    CANONICAL_STATUS_IN_PROGRESS,
    CANONICAL_STATUS_NOT_STARTED,
    CANONICAL_STATUS_PENDING,
    CANONICAL_STATUS_REVIEW_WAITING,
    CANONICAL_STATUS_DONE,
    normalizeTaskStatus,
    isActiveWorkingStatus,
    parseIsoToEpochSec,
    formatEpochSecToIso,
    TimeInterval,
    mergeIntervals,
    intersectIntervalLists,
    subtractIntervalLists,
    computeUserTaskActualIntersection,
    handleTaskStatusTransition,
    handleAssigneeChange,
    handleParticipantJoin,
    handleParticipantLeave,
    handleTaskSwitch,
    recalculateTaskSummaries,
  });

  if (typeof window !== 'undefined') {
    window.MeldexProductionTaskActualEngine = Engine;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Engine;
  }
})();
