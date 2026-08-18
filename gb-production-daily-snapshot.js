/* gb-production-daily-snapshot.js: 日次スナップショット（production_daily_snapshots）ストア・エンジン */
(function() {
  'use strict';

  class MeldexProductionDailySnapshotStore {
    constructor(options = {}) {
      // key: `${workspace_id}::${target_date}` -> snapshot object
      this._snapshots = new Map();
      this.provider = options.provider || null;
      this.baseDir = options.baseDir || '_meldex/production_snapshots';
    }

    _key(workspaceId, targetDate) {
      const ws = String(workspaceId || 'default').trim();
      const dt = String(targetDate || '').trim();
      return `${ws}::${dt}`;
    }

    _filePath(workspaceId, targetDate) {
      const ws = String(workspaceId || 'default').trim().replace(/[^a-zA-Z0-9_\-]/g, '_') || 'default';
      const dt = String(targetDate || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '_');
      return `${this.baseDir}/${ws}/${dt}.json`;
    }

    async saveSnapshot(workspaceId, targetDate, snapshotData) {
      const ws = String(workspaceId || 'default').trim();
      const dt = String(targetDate || '').trim();
      if (!dt) return { ok: false, error: 'target_date_required' };

      const record = JSON.parse(JSON.stringify(snapshotData || {}));
      record.workspace_id = ws;
      record.target_date = dt;
      record.snapshot_id = record.snapshot_id || `snapshot:${ws}:${dt}`;
      record.is_long_term_retention = true;
      record.saved_at = new Date().toISOString();

      if (this.provider) {
        const filePath = this._filePath(ws, dt);
        try {
          if (typeof this.provider.writeJson === 'function') {
            await this.provider.writeJson(filePath, record);
          } else if (typeof this.provider.writeText === 'function') {
            await this.provider.writeText(filePath, JSON.stringify(record, null, 2));
          }
        } catch (err) {
          return { ok: false, error: `provider_save_failed: ${err?.message || err}` };
        }
      }

      this._snapshots.set(this._key(ws, dt), record);
      return { ok: true, snapshot: JSON.parse(JSON.stringify(record)) };
    }

    async saveSnapshotAsync(workspaceId, targetDate, snapshotData) {
      return this.saveSnapshot(workspaceId, targetDate, snapshotData);
    }

    async loadFromProvider(workspaceId) {
      if (!this.provider) return { ok: true, count: 0 };
      const ws = String(workspaceId || 'default').trim();
      const safeWs = ws.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'default';
      const wsDir = `${this.baseDir}/${safeWs}`;
      try {
        if (typeof this.provider.listDirectory === 'function') {
          const files = await this.provider.listDirectory(wsDir);
          let loadedCount = 0;
          if (Array.isArray(files)) {
            for (const f of files) {
              const name = typeof f === 'string' ? f : f?.name;
              if (name && name.endsWith('.json')) {
                const snapPath = `${wsDir}/${name}`;
                let snap = null;
                if (typeof this.provider.readJson === 'function') {
                  snap = await this.provider.readJson(snapPath);
                } else if (typeof this.provider.readText === 'function') {
                  const text = await this.provider.readText(snapPath);
                  if (text) {
                    try {
                      snap = JSON.parse(text);
                    } catch (parseErr) {
                      return { ok: false, error: `provider_parse_failed: ${parseErr?.message || parseErr}` };
                    }
                  }
                }
                if (snap && snap.target_date) {
                  this._snapshots.set(this._key(ws, snap.target_date), snap);
                  loadedCount++;
                }
              }
            }
          }
          return { ok: true, count: loadedCount };
        }
        return { ok: true, count: 0 };
      } catch (err) {
        console.warn('[snapshot-store] loadFromProvider failed:', err);
        return { ok: false, error: `provider_load_failed: ${err?.message || err}` };
      }
    }

    getSnapshot(workspaceId, targetDate) {
      const key = this._key(workspaceId, targetDate);
      const record = this._snapshots.get(key);
      return record ? JSON.parse(JSON.stringify(record)) : null;
    }

    listSnapshots(workspaceId, startDate, endDate) {
      const ws = String(workspaceId || 'default').trim();
      const results = [];

      for (const [key, snap] of this._snapshots.entries()) {
        const [itemWs, itemDate] = key.split('::');
        if (itemWs !== ws) continue;
        if (startDate && itemDate < startDate) continue;
        if (endDate && itemDate > endDate) continue;
        results.push(JSON.parse(JSON.stringify(snap)));
      }

      results.sort((a, b) => String(a.target_date || '').localeCompare(String(b.target_date || '')));
      return results;
    }

    async deleteSnapshot(workspaceId, targetDate) {
      const ws = String(workspaceId || 'default').trim();
      const dt = String(targetDate || '').trim();
      const key = this._key(ws, dt);
      const exists = this._snapshots.has(key);

      if (this.provider) {
        const filePath = this._filePath(ws, dt);
        if (typeof this.provider.deletePath === 'function') {
          try {
            await this.provider.deletePath(filePath);
          } catch (err) {
            // 削除失敗時はメモリ上の記録を失わない
            return false;
          }
        }
      }

      if (exists) {
        this._snapshots.delete(key);
        return true;
      }
      return false;
    }
  }

  class MeldexProductionDailySnapshotEngine {
    constructor(options = {}) {
      this.store = options.snapshotStore || new MeldexProductionDailySnapshotStore();
      this.actualEngine = options.actualEngine || (typeof window !== 'undefined' ? window.MeldexProductionTaskActualEngine : null);
      this.formatter = (typeof window !== 'undefined' ? window.MeldexProductionTimeFormatter : null) || options.formatter || null;
    }

    parseCutoff(cutoffStr) {
      const s = String(cutoffStr || '04:00').trim();
      const m = /^(\d{1,2}):(\d{2})$/.exec(s);
      if (m) return { hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) };
      return { hour: 4, minute: 0 };
    }

    calculateBusinessDate(dtValue, cutoff = '04:00') {
      const { hour: cutoffH, minute: cutoffM } = this.parseCutoff(cutoff);
      let dt = null;

      if (dtValue instanceof Date) {
        dt = new Date(dtValue.getTime());
      } else if (typeof dtValue === 'string' && dtValue.trim()) {
        const str = dtValue.trim();
        dt = new Date(str);
        if (isNaN(dt.getTime())) {
          try {
            dt = new Date(str.replace(' ', 'T'));
          } catch (_) {
            dt = null;
          }
        }
      }

      if (!dt || isNaN(dt.getTime())) {
        return new Date().toISOString().slice(0, 10);
      }

      const curMinute = dt.getHours() * 60 + dt.getMinutes();
      const cutoffMinute = cutoffH * 60 + cutoffM;

      if (curMinute < cutoffMinute) {
        dt.setDate(dt.getDate() - 1);
      }

      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    findMissingDates(workspaceId, startDate, endDate) {
      const existing = new Set(
        this.store.listSnapshots(workspaceId, startDate, endDate).map(s => s.target_date)
      );
      const missing = [];

      try {
        const cur = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');
        while (cur <= end) {
          const y = cur.getFullYear();
          const m = String(cur.getMonth() + 1).padStart(2, '0');
          const d = String(cur.getDate()).padStart(2, '0');
          const curStr = `${y}-${m}-${d}`;
          if (!existing.has(curStr)) {
            missing.push(curStr);
          }
          cur.setDate(cur.getDate() + 1);
        }
      } catch (_) {}

      return missing;
    }

    _parseSeconds(raw) {
      if (this.formatter && typeof this.formatter.parseToSeconds === 'function') {
        return this.formatter.parseToSeconds(raw);
      }
      if (raw == null || raw === '') return 0;
      const num = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
      if (isNaN(num)) return 0;
      return String(raw).includes('h') || num < 24 ? Math.round(num * 3600) : Math.round(num);
    }

    buildDailySnapshot(args = {}) {
      const ws = String(args.workspace_id || 'default').trim();
      const dateStr = String(args.target_date || '').trim();
      const tasks = args.tasks || [];
      const sessions = args.sessions || [];
      const attendances = args.attendances || [];
      const calendarEvents = args.calendar_events || [];
      const tzStr = args.tz_str || 'Asia/Tokyo';
      const dayCutoff = args.day_cutoff || '04:00';
      const changesSummary = args.changes_summary || [];

      const tasksSnapshot = [];

      // 勤怠リスト/オブジェクトから user_shifts_map と user_breaks_map を構築
      const userShiftsMap = {};
      const userBreaksMap = {};

      if (attendances && typeof attendances === 'object' && !Array.isArray(attendances)) {
        Object.assign(userShiftsMap, attendances.shifts || {});
        Object.assign(userBreaksMap, attendances.breaks || {});
      } else if (Array.isArray(attendances)) {
        for (const att of attendances) {
          const uid = String(att.user_id || att.user || '').trim();
          if (!uid) continue;
          const attType = String(att.type || 'work').toLowerCase();
          const interval = { start: att.start, end: att.end };
          if (attType === 'work' || attType === 'shift') {
            userShiftsMap[uid] = userShiftsMap[uid] || [];
            userShiftsMap[uid].push(interval);
          } else if (attType === 'break' || attType === 'rest' || attType === 'lunch') {
            userBreaksMap[uid] = userBreaksMap[uid] || [];
            userBreaksMap[uid].push(interval);
          }
        }
      }

      for (const row of tasks) {
        const taskId = String(row.id || row.task_id || '').trim();
        const props = row.properties || {};
        const workTitle = String(props['作品タイトル'] || row.work_title || '').trim();
        const title = String(row.name || row.title || props['タスク名'] || taskId).trim();
        const assignee = String(props['担当者'] || row.assignee || '').trim();
        const status = String(props['状況'] || row.status || '未着手').trim();
        const deadline = String(props['締切日時'] || props['完了日時'] || row.deadline || '').trim();

        // 予定作業時間
        const estimateRaw = props['目標作業時間_値'] || props['予定作業時間'] || row.estimate_seconds;
        const estimateSec = this._parseSeconds(estimateRaw);

        // 割当作業時間
        const allocatedRaw = props['作業予定時間'] || props['割当作業時間'] || row.allocated_seconds;
        const allocatedSec = this._parseSeconds(allocatedRaw);

        // 実績作業時間の計算
        const taskSessions = sessions.filter(s => String(s.task_id || '') === taskId);
        let actualSec = 0;
        let qualityStatus = 'unmeasured';
        let qualityReason = '実績区間なし';
        let participantActuals = [];

        if (taskSessions.length > 0 && this.actualEngine && typeof this.actualEngine.recalculateTaskSummaries === 'function') {
          const taskRecords = {
            task_id: taskId,
            sessions: taskSessions,
            revisions: [],
            summaries: {}
          };
          const recalcRes = this.actualEngine.recalculateTaskSummaries(
            taskRecords,
            userShiftsMap,
            userBreaksMap
          );
          const summaries = recalcRes.summaries || {};
          const totalSummary = summaries['__total__'] || {};
          actualSec = totalSummary.actual_seconds || 0;
          qualityStatus = totalSummary.quality_status || 'confirmed';
          const qualityReasons = totalSummary.quality_reasons || [];
          qualityReason = qualityReasons.join('; ');

          for (const [uid, uSummary] of Object.entries(summaries)) {
            if (uid === '__total__') continue;
            participantActuals.push({
              user_id: uid,
              display_name: uid,
              actual_seconds: uSummary.actual_seconds || 0,
              quality_status: uSummary.quality_status || 'confirmed'
            });
          }
        } else {
          const legacyManualRaw = props['作業時間_実績'];
          if (legacyManualRaw != null && String(legacyManualRaw).trim()) {
            actualSec = this._parseSeconds(legacyManualRaw);
            qualityStatus = 'legacy-manual';
            qualityReason = '過去手入力値';
          } else {
            actualSec = 0;
            qualityStatus = 'unmeasured';
            qualityReason = '実績区間なし';
          }
          if (assignee) {
            participantActuals.push({
              user_id: assignee,
              display_name: assignee,
              actual_seconds: actualSec,
              quality_status: qualityStatus
            });
          }
        }

        tasksSnapshot.push({
          task_id: taskId,
          work_title: workTitle,
          title: title,
          assignee: assignee,
          status: status,
          deadline: deadline,
          estimate_seconds: estimateSec,
          allocated_seconds: allocatedSec,
          actual_seconds: actualSec,
          quality_status: qualityStatus,
          quality_reason: qualityReason,
          participant_actuals: participantActuals
        });
      }

      return {
        snapshot_id: `snapshot:${ws}:${dateStr}`,
        workspace_id: ws,
        target_date: dateStr,
        timezone: tzStr,
        day_cutoff: dayCutoff,
        tasks: tasksSnapshot,
        calendar_events: JSON.parse(JSON.stringify(calendarEvents)),
        changes_summary: [...changesSummary],
        source_revision: 1,
        created_at: new Date().toISOString(),
        created_by: 'system',
        is_long_term_retention: true
      };
    }
  }

  // グローバル公開
  if (typeof window !== 'undefined') {
    window.MeldexProductionDailySnapshotStore = MeldexProductionDailySnapshotStore;
    window.MeldexProductionDailySnapshotEngine = MeldexProductionDailySnapshotEngine;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      MeldexProductionDailySnapshotStore,
      MeldexProductionDailySnapshotEngine
    };
  }
})();
