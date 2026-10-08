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

    _storageComponent(value) {
      const text = String(value);
      if (/^[A-Za-z0-9_-]+$/.test(text)) return text;
      const bytes = new TextEncoder().encode(text);
      return '~' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    _legacyStorageComponent(value, fallback = '') {
      return String(value).replace(/[^A-Za-z0-9_-]/g, '_') || fallback;
    }

    _filePath(workspaceId, targetDate) {
      const ws = this._storageComponent(String(workspaceId || 'default').trim());
      const dt = this._storageComponent(String(targetDate || '').trim());
      return `${this.baseDir}/${ws}/${dt}.json`;
    }

    _legacyFilePath(workspaceId, targetDate) {
      const ws = this._legacyStorageComponent(String(workspaceId || 'default').trim(), 'default');
      const dt = this._legacyStorageComponent(String(targetDate || '').trim());
      return `${this.baseDir}/${ws}/${dt}.json`;
    }

    _recordMatches(record, workspaceId, targetDate) {
      return Boolean(record && typeof record === 'object'
        && String(record.workspace_id || 'default').trim() === workspaceId
        && String(record.target_date || '').trim() === targetDate);
    }

    _isNotFoundError(error) {
      const name = String(error?.name || '').toLowerCase();
      const code = String(error?.code || '').toLowerCase();
      const status = Number(error?.status ?? error?.statusCode ?? 0);
      const message = String(error?.message || error || '').toLowerCase();
      return status === 404
        || name === 'notfounderror'
        || name === 'systemstoragenotfounderror'
        || code === 'enoent'
        || code.includes('not_found')
        || /(^|[\s/:_-])not[\s_-]?found($|[\s/:_-])/.test(message)
        || message.includes('見つかりません');
    }

    async _listProviderDirectory(directory) {
      try {
        const files = await this.provider.listDirectory(directory);
        return Array.isArray(files) ? files : [];
      } catch (error) {
        if (this._isNotFoundError(error)) return [];
        throw error;
      }
    }

    async _writeProvider(filePath, record) {
      if (typeof this.provider?.writeJson === 'function') {
        await this.provider.writeJson(filePath, record);
      } else if (typeof this.provider?.writeText === 'function') {
        await this.provider.writeText(filePath, JSON.stringify(record, null, 2));
      }
    }

    async _readProvider(filePath) {
      if (typeof this.provider?.readJson === 'function') {
        return this.provider.readJson(filePath);
      }
      if (typeof this.provider?.readText === 'function') {
        const text = await this.provider.readText(filePath);
        return text ? JSON.parse(text) : null;
      }
      return null;
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
          await this._writeProvider(filePath, record);
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
      const wsDir = `${this.baseDir}/${this._storageComponent(ws)}`;
      const legacyWsDir = `${this.baseDir}/${this._legacyStorageComponent(ws, 'default')}`;
      try {
        if (typeof this.provider.listDirectory === 'function') {
          let loadedCount = 0;
          const loadedDates = new Set();
          const directories = legacyWsDir === wsDir ? [wsDir] : [wsDir, legacyWsDir];
          const directoryFiles = new Map();
          const existingPaths = new Set();
          for (const directory of directories) {
            const files = await this._listProviderDirectory(directory);
            directoryFiles.set(directory, files);
            for (const f of files) {
              const name = typeof f === 'string' ? f : f?.name;
              if (name && name.endsWith('.json')) existingPaths.add(`${directory}/${name}`);
            }
          }
          for (const directory of directories) {
            const files = directoryFiles.get(directory);
            if (!Array.isArray(files)) continue;
            for (const f of files) {
              const name = typeof f === 'string' ? f : f?.name;
              if (name && name.endsWith('.json')) {
                const snapPath = `${directory}/${name}`;
                const snap = await this._readProvider(snapPath);
                const targetDate = String(snap?.target_date || '').trim();
                if (!targetDate || !this._recordMatches(snap, ws, targetDate)) continue;
                const canonicalPath = this._filePath(ws, targetDate);
                const legacyPath = this._legacyFilePath(ws, targetDate);
                if (snapPath !== canonicalPath && snapPath !== legacyPath) continue;
                if (snapPath === legacyPath && legacyPath !== canonicalPath) {
                  // canonical は常に正本。古い legacy が残っていても巻き戻さない。
                  if (existingPaths.has(canonicalPath)) continue;
                  await this._writeProvider(canonicalPath, snap);
                  existingPaths.add(canonicalPath);
                  if (typeof this.provider.deletePath === 'function') {
                    await this.provider.deletePath(legacyPath);
                    existingPaths.delete(legacyPath);
                  }
                }
                this._snapshots.set(this._key(ws, targetDate), snap);
                if (!loadedDates.has(targetDate)) loadedCount++;
                loadedDates.add(targetDate);
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
      let deletedPersisted = false;

      if (this.provider) {
        const canonicalPath = this._filePath(ws, dt);
        const legacyPath = this._legacyFilePath(ws, dt);
        if (typeof this.provider.deletePath === 'function') {
          try {
            if (legacyPath !== canonicalPath) {
              let legacyRecord = null;
              let legacyExists = false;
              if (typeof this.provider.listDirectory === 'function') {
                const slash = legacyPath.lastIndexOf('/');
                const directory = legacyPath.slice(0, slash);
                const filename = legacyPath.slice(slash + 1);
                const files = await this._listProviderDirectory(directory);
                legacyExists = Array.isArray(files) && files.some(item => {
                  const name = typeof item === 'string' ? item : item?.name;
                  return name === filename;
                });
              } else {
                // 存在確認不能な provider では、読取失敗を「存在しない」と扱わない。
                legacyRecord = await this._readProvider(legacyPath);
                legacyExists = true;
              }
              if (legacyExists) {
                legacyRecord = legacyRecord || await this._readProvider(legacyPath);
                if (this._recordMatches(legacyRecord, ws, dt)) {
                  // legacy を先に消す。後段の canonical 削除に失敗しても古い値へ戻らない。
                  await this.provider.deletePath(legacyPath);
                  deletedPersisted = true;
                }
              }
            }

            let canonicalExists = true;
            if (typeof this.provider.listDirectory === 'function') {
              const slash = canonicalPath.lastIndexOf('/');
              const directory = canonicalPath.slice(0, slash);
              const filename = canonicalPath.slice(slash + 1);
              const files = await this._listProviderDirectory(directory);
              canonicalExists = Array.isArray(files) && files.some(item => {
                const name = typeof item === 'string' ? item : item?.name;
                return name === filename;
              });
            }
            if (canonicalExists) {
              const canonicalRecord = await this._readProvider(canonicalPath);
              if (!this._recordMatches(canonicalRecord, ws, dt)) return false;
              await this.provider.deletePath(canonicalPath);
              deletedPersisted = true;
            }
          } catch (err) {
            // 一方でも確認・削除に失敗したら、成功扱いせずメモリ上の記録を保持する。
            return false;
          }
        }
      }

      if (exists || deletedPersisted) {
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

    // 対象業務日に重なる実績区間だけを、読み取り専用表示用の形へ整えて返す。
    // 終了していない区間（未確定）は現在時刻で閉じず、ended_at を空のまま残す。
    sessionsForBusinessDate(sessions, targetDate, cutoff = '04:00') {
      const target = String(targetDate || '').trim();
      const picked = [];
      for (const sess of (sessions || [])) {
        if (!sess || typeof sess !== 'object' || sess.deleted_at) continue;
        const started = String(sess.started_at || '').trim();
        const ended = String(sess.ended_at || '').trim();
        if (!started) continue;
        const startDate = this.calculateBusinessDate(started, cutoff);
        const endDate = ended ? this.calculateBusinessDate(ended, cutoff) : startDate;
        if (target && target !== startDate && target !== endDate) {
          // 日跨ぎで対象日を挟み込む区間も対象に含める
          if (!(startDate < target && target < endDate)) continue;
        }
        picked.push({
          session_id: String(sess.session_id || ''),
          participant_user_id: String(sess.participant_user_id || ''),
          participant_display_name: String(sess.participant_display_name || sess.participant_user_id || ''),
          started_at: started,
          ended_at: ended,
          start_reason: String(sess.start_reason || ''),
          end_reason: String(sess.end_reason || '')
        });
      }
      picked.sort((a, b) => (a.started_at === b.started_at
        ? a.participant_user_id.localeCompare(b.participant_user_id)
        : a.started_at.localeCompare(b.started_at)));
      return picked;
    }

    // 対象業務日に重なる予定枠だけを [{start, end}] で返す。
    slotsForBusinessDate(slots, targetDate, cutoff = '04:00') {
      let raw = [];
      if (Array.isArray(slots)) raw = slots;
      else if (typeof slots === 'string' && slots.trim()) {
        try {
          const parsed = JSON.parse(slots);
          if (Array.isArray(parsed)) raw = parsed;
        } catch { raw = []; }
      }
      const target = String(targetDate || '').trim();
      const picked = [];
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const start = String(item.start || '').trim();
        const end = String(item.end || '').trim();
        if (!start) continue;
        const startDate = this.calculateBusinessDate(start, cutoff);
        const endDate = end ? this.calculateBusinessDate(end, cutoff) : startDate;
        if (target && target !== startDate && target !== endDate
            && !(startDate < target && target < endDate)) continue;
        picked.push({ start, end });
      }
      picked.sort((a, b) => (a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)));
      return picked;
    }

    // 予定枠の合計秒数（日付での絞り込みはしない。タスク全体の割当量）
    totalSlotSeconds(slots) {
      let total = 0;
      for (const slot of this.slotsForBusinessDate(slots, '')) {
        const start = new Date(String(slot.start || '')).getTime();
        const end = new Date(String(slot.end || '')).getTime();
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        total += Math.floor((end - start) / 1000);
      }
      return total;
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
        let allocatedSec = this._parseSeconds(allocatedRaw);
        if (!allocatedSec) {
          // 割当作業時間は「そのタスクへ割り当てた予定枠の合計」（計画書 §3）。
          // 集計済みの値が無い場合は予定枠そのものから合計する。
          allocatedSec = this.totalSlotSeconds(row.scheduled_slots || props['作業予定区間']);
        }

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

          // 勤務区間を渡されていない呼び出しでは交差計算が必ず0になる。呼び出し側が
          // 正本の算出済み実績を持っていれば、0で上書きせずそちらを採用する。
          if (actualSec === 0 && !Object.keys(userShiftsMap).length) {
            const fallbackSec = Number(row.actual_seconds) > 0 ? Math.floor(Number(row.actual_seconds)) : 0;
            if (fallbackSec > 0) {
              actualSec = fallbackSec;
              qualityStatus = String(row.quality_status || qualityStatus);
              const rowReasons = row.quality_reasons || [];
              if (rowReasons.length) qualityReason = Array.isArray(rowReasons) ? rowReasons.join('; ') : String(rowReasons);
              const rowParticipants = (row.participant_actuals || [])
                .filter(entry => entry && entry.user_id)
                .map(entry => ({
                  user_id: String(entry.user_id),
                  display_name: String(entry.display_name || entry.user_id),
                  actual_seconds: Number(entry.actual_seconds) || 0,
                  quality_status: String(entry.quality_status || qualityStatus)
                }));
              if (rowParticipants.length) {
                participantActuals.length = 0;
                participantActuals.push(...rowParticipants);
              }
            }
          }
        } else {
          // 区間そのものを渡されていなくても、呼び出し側が算出済みの実績を持っている
          // 場合はそれを使う（ここで無条件に0へ落とすと実際の保存経路で実績が消える）。
          const precomputedSec = Number(row.actual_seconds) > 0 ? Math.floor(Number(row.actual_seconds)) : 0;
          const precomputedQuality = String(row.quality_status || '').trim();
          const hasPrecomputed = precomputedSec > 0
            || ['confirmed', 'incomplete', 'conflict', 'legacy-manual'].includes(precomputedQuality);
          const legacyManualRaw = props['作業時間_実績'];
          if (hasPrecomputed) {
            actualSec = precomputedSec;
            qualityStatus = precomputedQuality || 'confirmed';
            const reasons = row.quality_reasons || row.quality_reason || '';
            qualityReason = Array.isArray(reasons) ? reasons.join('; ') : String(reasons);
          } else if (legacyManualRaw != null && String(legacyManualRaw).trim()) {
            actualSec = this._parseSeconds(legacyManualRaw);
            qualityStatus = 'legacy-manual';
            qualityReason = '過去手入力値';
          } else {
            actualSec = 0;
            qualityStatus = 'unmeasured';
            qualityReason = '実績区間なし';
          }
          for (const entry of (row.participant_actuals || [])) {
            if (!entry || typeof entry !== 'object') continue;
            const uid = String(entry.user_id || entry.participant_user_id || '').trim();
            if (!uid) continue;
            participantActuals.push({
              user_id: uid,
              display_name: String(entry.display_name || uid),
              actual_seconds: Number(entry.actual_seconds) || 0,
              quality_status: String(entry.quality_status || qualityStatus)
            });
          }
          if (!participantActuals.length && assignee) {
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
          participant_actuals: participantActuals,
          // actual_seconds はスナップショット時点までの累計。day_sessions は対象業務日に
          // 重なる区間だけを持ち、過去日を読み取り専用カレンダーとして描く素材にする。
          day_sessions: this.sessionsForBusinessDate(taskSessions, dateStr, dayCutoff),
          // 割当作業時間の内訳（カレンダー上の予定枠）。読み取り専用カレンダーで実績区間と重ねる。
          scheduled_slots: this.slotsForBusinessDate(
            row.scheduled_slots || props['作業予定区間'], dateStr, dayCutoff
          )
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
