/* ==============================
   gb-production-recalc-engine.js: フル再計算エンジン（Desktopの meldex_production_recalculate.py /
   meldex_production_schedule_segments.py の純粋ロジック部分をJS移植）

   production-management-ux-improvement-plan-2026-08-04.md §4-1。Cloud（Dropboxモード）でも
   Desktopと同一の割当結果を得るための計算本体。ここには一切のCloud I/O（provider/internals操作）
   を含めない — 入力は既に読み込み済みのプレーンなタスク/スタッフ/シフト配列、出力はプレーンな
   plan行の配列。Cloud側のファイル読み書き・カレンダーイベント同期は
   gb-production-recalc-engine-cloud-adapter.js が担当する（責務分離）。

   Pythonの対応関数名をコメントに残し、行番号非依存で追跡できるようにしている。
   優先度はグループ単位（同一グループ内の最高ランクを全体へ適用）— Phase 1 修正後の挙動
   （_build_plan_at_ratio 内の group_priority）を必ず踏襲する。
   ============================== */
(function () {
  'use strict';

  // meldex_production_recalculate.py の定数
  const MIN_TASK_MINUTES = 10;
  const PROTECTED_TASK_STATUSES = new Set(['完了', '進行中', '着手中', '作業中']);
  // スケジューラー複数アカウント修正計画2026-08-13 Phase 4-2: 「完了」以外の進行中系
  // ステータスは、既に作業予定日時が入っている場合だけ保護する（taskProtected参照）。
  const IN_PROGRESS_TASK_STATUSES = new Set([...PROTECTED_TASK_STATUSES].filter(status => status !== '完了'));
  // meldex_production_schema.PRIORITY_OPTIONS と同じ値（低<通常<高<最優先）。
  // 別クロージャ（gb-production-management-schema-definitions.js）にも同値の定義があるが、
  // このファイルはCloud本体から独立して読み込み・テストできるよう小さな定数の複製を許容する。
  const PRIORITY_OPTIONS = ['低', '通常', '高', '最優先'];

  // --- 数値・文字列ユーティリティ（meldex_production_recalculate.py の _safe_float/_truthy/_list_value 等） ---

  function safeFloat(value, fallback = 0) {
    const text = String(value == null ? '' : value).replace(/時間/g, '').trim();
    if (text === '') return fallback;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function truthy(value) {
    return ['1', 'true', 'yes', 'on', '有効', 'はい', 'する'].includes(String(value == null ? '' : value).trim().toLowerCase());
  }

  function listValue(value) {
    return String(value == null ? '' : value).split(/[,、\n]/).map(part => part.trim()).filter(Boolean);
  }

  // Python 3 の round()（銀行家の丸め=0.5はもっとも近い偶数へ）に寄せた丸め。JSの Math.round は
  // 常に0.5を切り上げるため、圧縮比の段階適用や時間換算の丸め結果がズレる可能性を減らす。
  function pythonRoundTo(value, digits = 0) {
    const factor = Math.pow(10, digits);
    const scaled = value * factor;
    const floor = Math.floor(scaled);
    const diff = scaled - floor;
    let rounded;
    if (Math.abs(diff - 0.5) < 1e-9) rounded = (floor % 2 === 0) ? floor : floor + 1;
    else rounded = Math.round(scaled);
    return rounded / factor;
  }

  function formatHoursOneDecimal(value) {
    return (Math.round(value * 10) / 10).toFixed(1);
  }

  // Python の str(float) 相当（str(row["hours"]) で「作業予定時間」プロパティへ書き込む値の
  // 文字列化に使う）。JSの Number#toString() は整数値の小数点以下 .0 を省略するため
  // （JSの1 !== Pythonのfloat 1.0 の文字列表現）、整数値のときだけ ".0" を補う。それ以外は
  // JSの最短往復表現がPythonのfloat replと一致する範囲（このエンジンが生成する2桁丸め値）。
  function pythonFloatStr(value) {
    if (!Number.isFinite(value)) return String(value);
    return Number.isInteger(value) ? `${value}.0` : String(value);
  }

  // --- 日付ユーティリティ（date-only文字列は 'YYYY-MM-DD' で保持し、UTCのエポック日数で加減算する） ---

  function dateValue(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return null;
    const slice = text.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slice)) return null;
    return Number.isNaN(new Date(slice + 'T00:00:00').getTime()) ? null : slice;
  }

  function dateToEpochDay(dateText) {
    const [y, m, d] = dateText.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  }

  function epochDayToDate(epochDay) {
    const d = new Date(epochDay * 86400000);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  function addDays(dateText, days) {
    return epochDayToDate(dateToEpochDay(dateText) + days);
  }

  function todayLocalDate() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function isoMinutes(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function dateTextFromLocalDate(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // _period(body)
  function period(body) {
    const today = todayLocalDate();
    const start = dateValue(body && (body.date_from || body['開始日'])) || today;
    let end = dateValue(body && (body.date_to || body['終了日'])) || addDays(start, 30);
    let s = start;
    let e = end;
    if (e < s) { const tmp = s; s = e; e = tmp; }
    return { start: s, end: e, startText: s, endText: e };
  }

  // --- シフト時間帯パース（_time_ranges/_first_time_range） ---

  function timeRanges(value) {
    const ranges = [];
    String(value == null ? '' : value).split(/[,、\n]/).forEach(part => {
      const match = part.match(/(\d{1,2}):(\d{2})\s*(?:-|~|〜|から)\s*(\d{1,2}):(\d{2})/);
      if (match) ranges.push([`${match[1].padStart(2, '0')}:${match[2]}`, `${match[3].padStart(2, '0')}:${match[4]}`]);
    });
    return ranges;
  }

  function firstTimeRange(value) {
    const ranges = timeRanges(value);
    return ranges.length ? ranges[0] : null;
  }

  function staffActiveOn(staffRow, dateText) {
    const start = dateValue(staffRow && staffRow.active_from);
    const end = dateValue(staffRow && staffRow.active_to);
    return (!start || start <= dateText) && (!end || dateText <= end);
  }

  function staffHolidayOn(staffRow, dateText) {
    const text = String((staffRow && staffRow.holidays) || '');
    if (text.includes(dateText)) return true;
    const labels = ['月', '火', '水', '木', '金', '土', '日'];
    const english = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const utcDay = new Date(dateText + 'T00:00:00Z').getUTCDay();
    const weekday = (utcDay + 6) % 7; // Monday=0..Sunday=6（Python date.weekday()と揃える）
    const lowered = text.toLowerCase();
    return text.includes(labels[weekday]) || lowered.includes(english[weekday]);
  }

  function blankStaff(name) {
    return { name, break_hours: '', holidays: '', active_from: '', active_to: '' };
  }

  // 正本『スタッフ管理シート』が未登録のユーザーはフェイルオープン（従来どおり対象）。登録済み
  // なら参加期間外／休日を除外制約として併用する（shift-staff-registry-linkage_plan_2026-07-24
  // 案B-1。Desktop の _staff_available_for_shift と同じ判定。unassigned_only スコープ専用）。
  function staffAvailableForShift(staffRow, dateText) {
    if (!staffRow) return true;
    return staffActiveOn(staffRow, dateText) && !staffHolidayOn(staffRow, dateText);
  }

  // --- 優先度・グループキー（3-4章の修正後挙動） ---

  function priorityRank(priority) {
    const idx = PRIORITY_OPTIONS.indexOf(String(priority == null ? '' : priority).trim());
    return idx === -1 ? PRIORITY_OPTIONS.length : PRIORITY_OPTIONS.length - 1 - idx;
  }

  function taskGroupKey(task) {
    return [task.work_title, task.hierarchy_path, task.target, task.scale].map(v => String(v || '')).join('|');
  }

  function taskProtected(task) {
    const status = String(task.status || '').trim();
    if (task.manual_locked || status === '完了') return true;
    if (task.assignee_fixed && !String(task.fixed_user || '').trim()) {
      // 担当者固定なのに固定先の担当者が空。割り当てようがないため常に保護する。
      return true;
    }
    // Phase 4-2（ユーザー判断: 日程が空なら割り当てる）: 進行中系ステータス・担当者固定は、
    // 既に作業予定日時が入っている場合だけ保護する。空なら通常どおり割り当て対象にする
    // (_reserve_slot 相当の reserveSlot は task.fixed_user を尊重するので、担当者固定の
    // 枠は保たれる)。
    if (task.assignee_fixed || IN_PROGRESS_TASK_STATUSES.has(status)) {
      return !!(task.current_start && task.current_end);
    }
    return false;
  }

  function deadlineDt(task, periodValue) {
    const raw = task.deadline || periodValue.endText;
    const text = String(raw || '');
    const withTime = text.includes('T') ? text : `${text}T23:59`;
    const parsed = new Date(withTime);
    if (Number.isNaN(parsed.getTime())) return new Date(`${periodValue.end}T23:59:59.999`);
    return parsed;
  }

  function taskInScope(task, periodValue) {
    if (taskProtected(task)) return true;
    const deadline = deadlineDt(task, periodValue);
    const start = new Date(`${periodValue.start}T00:00:00`);
    const end = new Date(`${periodValue.end}T23:59:59.999`);
    return deadline >= start && deadline <= end;
  }

  // --- スコープ絞り込み（6.1章 work_titles/task_paths）。Cloudのtask_pathsは既にクライアント相対
  //     パスとして送られてくるため、Desktop版のような ctx.resolve_path() 経由の解決は不要。 ---

  function valuesSet(value) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return new Set();
    const raw = Array.isArray(value) ? value : [value];
    return new Set(raw.map(item => String(item).trim()).filter(Boolean));
  }

  function canonicalTaskPath(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    return text.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  }

  function applyRecalculationScope(tasks, body) {
    const workTitles = valuesSet(body && body.work_titles);
    const taskPaths = valuesSet(body && body.task_paths);
    if (!workTitles.size && !taskPaths.size) return tasks;
    const wantedPaths = taskPaths.size ? new Set([...taskPaths].map(canonicalTaskPath)) : null;
    return tasks.filter(task => {
      if (workTitles.size && !workTitles.has(String(task.work_title || ''))) return false;
      if (wantedPaths && !wantedPaths.has(canonicalTaskPath(task.path))) return false;
      return true;
    });
  }

  // --- 分割区間・イベントID規約（meldex_production_schedule_segments.py） ---

  function datetimePair(startValue, endValue) {
    const start = new Date(String(startValue == null ? '' : startValue));
    const end = new Date(String(endValue == null ? '' : endValue));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(end > start)) return null;
    return [start, end];
  }

  function parseSegments(value) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return [];
    let raw;
    try { raw = Array.isArray(value) ? value : JSON.parse(String(value)); } catch { return []; }
    if (!Array.isArray(raw)) return [];
    const result = [];
    raw.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const parsed = datetimePair(item.start, item.end);
      if (parsed) result.push({ start: isoMinutes(parsed[0]), end: isoMinutes(parsed[1]) });
    });
    return result.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : (a.end < b.end ? -1 : a.end > b.end ? 1 : 0)));
  }

  function rowSegments(row) {
    const segments = parseSegments((row || {}).segments);
    if (segments.length) return segments;
    const parsed = datetimePair((row || {}).start, (row || {}).end);
    if (!parsed) return [];
    return [{ start: isoMinutes(parsed[0]), end: isoMinutes(parsed[1]) }];
  }

  function segmentsJson(segments) {
    const normalized = parseSegments(segments);
    return normalized.length ? JSON.stringify(normalized) : '';
  }

  function taskEventId(taskId, index) {
    const base = `production-task:${taskId}`;
    return index === 0 ? base : `${base}:part:${index + 1}`;
  }

  function logicalTaskId(eventId) {
    const raw = String(eventId || '');
    if (!raw.startsWith('production-task:')) return '';
    return raw.slice('production-task:'.length).split(':part:')[0];
  }

  // --- 稼働時間（休憩・シフト備考休憩・残業） ---

  function breakRanges(staffRow, dateText) {
    const ranges = [];
    timeRanges((staffRow && staffRow.break_hours) || '').forEach(([s, e]) => {
      const start = new Date(`${dateText}T${s}`);
      let end = new Date(`${dateText}T${e}`);
      if (end <= start) end = new Date(end.getTime() + 86400000);
      ranges.push([start, end]);
    });
    return ranges;
  }

  function shiftBreakRanges(row) {
    const ranges = [];
    if (!row._start) return ranges;
    const dateText = dateTextFromLocalDate(row._start);
    const regex = /^\s*休憩\s*\d+\s*:\s*([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)\s*$/gm;
    const note = String(row.note || '');
    let match;
    while ((match = regex.exec(note))) {
      const start = new Date(`${dateText}T${match[1]}:${match[2]}`);
      let end = new Date(`${dateText}T${match[3]}:${match[4]}`);
      if (end <= start) end = new Date(end.getTime() + 86400000);
      ranges.push([start, end]);
    }
    return ranges;
  }

  function subtractRanges(base, blocks) {
    let segments = base;
    blocks.forEach(([blockStart, blockEnd]) => {
      const next = [];
      segments.forEach(([start, end]) => {
        if (blockEnd <= start || end <= blockStart) { next.push([start, end]); return; }
        if (start < blockStart) next.push([start, blockStart]);
        if (blockEnd < end) next.push([blockEnd, end]);
      });
      segments = next;
    });
    return segments;
  }

  function shiftDatetimes(row) {
    try {
      if (row.type === 'work' && !String(row.end_time || '').trim()) return null;
      const startTime = row.start_time || '00:00';
      const endTime = row.end_time || startTime;
      const start = new Date(`${row.date}T${startTime}`);
      let endDateText = row.date;
      if (endTime <= startTime) endDateText = addDays(row.date, 1);
      const end = new Date(`${endDateText}T${endTime}`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
      return end > start ? [start, end] : null;
    } catch { return null; }
  }

  function defaultStaffShifts(staff, existing, periodValue) {
    // (user, date) の組で重複判定する（Pythonの {(user, date)} タプル集合と同じ厳密一致にする
    // ため、スペースを含むユーザー名でも衝突しないよう JSON.stringify で組キー化する）。
    const occupied = new Set(existing.map(row => JSON.stringify([row.user, row.date])));
    const rows = [];
    const startDay = dateToEpochDay(periodValue.start);
    const endDay = dateToEpochDay(periodValue.end);
    for (let day = startDay; day <= endDay; day += 1) {
      const dateText = epochDayToDate(day);
      staff.forEach(staffRow => {
        if (occupied.has(JSON.stringify([staffRow.name, dateText]))) return;
        if (!staffActiveOn(staffRow, dateText) || staffHolidayOn(staffRow, dateText)) return;
        const workRange = firstTimeRange(staffRow.work_hours);
        if (!workRange) return;
        const start = new Date(`${dateText}T${workRange[0]}`);
        let end = new Date(`${dateText}T${workRange[1]}`);
        if (end <= start) end = new Date(end.getTime() + 86400000);
        rows.push({ id: 'staff-default', user: staffRow.name, date: dateText, _start: start, _end: end });
      });
    }
    return rows;
  }

  function lockedBusy(tasks) {
    const busy = {};
    tasks.forEach(task => {
      if (!taskProtected(task) || !task.current_user || !task.current_start || !task.current_end) return;
      const start = new Date(task.current_start);
      const end = new Date(task.current_end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
      (busy[task.current_user] || (busy[task.current_user] = [])).push([start, end]);
    });
    return busy;
  }

  function outOfScopeBusy(allTasks, scopedTasks) {
    const scopedPaths = new Set(scopedTasks.map(task => task.path));
    const busy = {};
    allTasks.forEach(task => {
      if (scopedPaths.has(task.path) || taskProtected(task)) return;
      if (!task.current_user || !task.current_start || !task.current_end) return;
      const start = new Date(task.current_start);
      const end = new Date(task.current_end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(end > start)) return;
      (busy[task.current_user] || (busy[task.current_user] = [])).push([start, end]);
    });
    return busy;
  }

  function mergeBusy(...sources) {
    const merged = {};
    sources.forEach(source => {
      Object.entries(source || {}).forEach(([user, ranges]) => {
        (merged[user] || (merged[user] = [])).push(...(ranges || []));
      });
    });
    Object.values(merged).forEach(ranges => ranges.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1])));
    return merged;
  }

  function segment(staffName, start, end, overtime) {
    return { staff: staffName, start, end, cursor: start, overtime };
  }

  function overtimeSegment(row, shifts, staffRow, busy) {
    const nextShift = shifts.find(item => item.user === row.user && item._start > row._end);
    if (!nextShift) return null;
    const rowEndDay = dateTextFromLocalDate(row._end);
    const limitDay = addDays(rowEndDay, 1);
    const nextShiftDay = dateTextFromLocalDate(nextShift._start);
    if (nextShiftDay > limitDay) return null;
    if (staffHolidayOn(staffRow, nextShiftDay)) return null;
    const segments = subtractRanges([[row._end, nextShift._start]], busy);
    if (!segments.length) return null;
    const [start, end] = segments[0];
    return end > start ? segment(row.user, start, end, true) : null;
  }

  // _availability(ctx, root, staff, period, tasks, allow_overtime, extra_busy,
  // exclude_registry_holidays)。baseShiftRows は Cloudアダプター側が事前に読み込んだ
  // 「type='work' かつ期間内」のシフト行（_startプロパティ付き）。excludeRegistryHolidays は
  // unassigned_only スコープ専用（§4-1。旧 _assignment_plan の休日除外を一本化後も維持する）。
  function availability(staff, periodValue, tasks, allowOvertime, extraBusy, baseShiftRows, excludeRegistryHolidays) {
    const staffMap = new Map(staff.map(row => [row.name, row]));
    const explicitRows = excludeRegistryHolidays
      ? baseShiftRows.filter(row => staffAvailableForShift(staffMap.get(row.user), dateTextFromLocalDate(row._start)))
      : baseShiftRows;
    const shiftRows = [...explicitRows, ...defaultStaffShifts(staff, explicitRows, periodValue)];
    const lockedBusyMap = mergeBusy(lockedBusy(tasks), extraBusy || {});
    const segments = [];
    const shifts = [...shiftRows].sort((a, b) => (a.user < b.user ? -1 : a.user > b.user ? 1 : a._start - b._start));
    shifts.forEach(row => {
      const staffRow = staffMap.get(row.user) || blankStaff(row.user);
      const dateText = dateTextFromLocalDate(row._start);
      const breaks = [...breakRanges(staffRow, dateText), ...shiftBreakRanges(row)];
      let baseSegments = subtractRanges([[row._start, row._end]], breaks);
      baseSegments = subtractRanges(baseSegments, lockedBusyMap[row.user] || []);
      baseSegments.forEach(([start, end]) => { if (end > start) segments.push(segment(row.user, start, end, false)); });
      if (allowOvertime) {
        const overtime = overtimeSegment(row, shifts, staffRow, lockedBusyMap[row.user] || []);
        if (overtime) segments.push(overtime);
      }
    });
    return segments.sort((a, b) => (a.cursor - b.cursor) || (a.staff < b.staff ? -1 : a.staff > b.staff ? 1 : 0));
  }

  // --- 割当計画本体 ---

  function candidateStaff(task, staffMap, contentCandidates) {
    if (task.fixed_user) return staffMap.has(task.fixed_user) ? new Set([task.fixed_user]) : new Set();
    const allowed = contentCandidates.get(task.content || '') || new Set();
    const staffNames = new Set(staffMap.keys());
    const explicit = new Set((task.candidate_users || []).map(value => String(value || '').trim()).filter(Boolean));
    if (explicit.size) return new Set([...staffNames].filter(name => explicit.has(name)));
    return allowed.size ? new Set([...staffNames].filter(name => allowed.has(name))) : staffNames;
  }

  function reserveSlot(task, candidateStaffSet, segments, durationMs, deadline, earliestStart, slotAllowed) {
    const fixed = task.fixed_user;
    const ordered = [...segments].sort((a, b) => (a.cursor - b.cursor) || (Number(a.overtime) - Number(b.overtime)) || (a.staff < b.staff ? -1 : a.staff > b.staff ? 1 : 0));
    for (const seg of ordered) {
      if (fixed && seg.staff !== fixed) continue;
      if (!candidateStaffSet.has(seg.staff)) continue;
      const cursor = seg.cursor > seg.start ? seg.cursor : seg.start;
      const start = (earliestStart && earliestStart > cursor) ? earliestStart : cursor;
      const end = new Date(start.getTime() + durationMs);
      if (end <= seg.end && end <= deadline) {
        if (slotAllowed && !slotAllowed(start, end)) continue;
        if (start > cursor) {
          const before = { ...seg, cursor, end: start };
          if (before.end > before.cursor) segments.push(before);
        }
        seg.cursor = end;
        return { staff: seg.staff, start, end, overtime: !!seg.overtime };
      }
    }
    return null;
  }

  function topologicalTaskOrder(tasks) {
    const byId = new Map(tasks.map(task => [String(task.id || ''), task]));
    const rank = new Map(tasks.map((task, index) => [String(task.id || ''), index]));
    const incoming = new Map([...byId].map(([id, task]) => [id, new Set(
      (task.dependencies || []).map(String).filter(dependency => byId.has(dependency))
    )]));
    const ready = [...incoming].filter(([, dependencies]) => !dependencies.size).map(([id]) => id)
      .sort((a, b) => rank.get(a) - rank.get(b));
    const result = [];
    while (ready.length) {
      const id = ready.shift();
      result.push(byId.get(id));
      for (const candidate of [...incoming.keys()].sort((a, b) => rank.get(a) - rank.get(b))) {
        const dependencies = incoming.get(candidate);
        if (!dependencies.delete(id) || dependencies.size || result.includes(byId.get(candidate)) || ready.includes(candidate)) continue;
        ready.push(candidate);
        ready.sort((a, b) => rank.get(a) - rank.get(b));
      }
    }
    const cycles = new Set([...incoming].filter(([, dependencies]) => dependencies.size).map(([id]) => id));
    result.push(...tasks.filter(task => !result.includes(task)));
    return { tasks: result, cycles };
  }

  function equipmentState(runtimeOptions) {
    const resources = new Map();
    (runtimeOptions && runtimeOptions.equipment || []).forEach(raw => {
      if (!raw || typeof raw !== 'object') return;
      const id = String(raw.id || raw.name || '').trim();
      if (!id) return;
      const ranges = values => (values || []).map(item => ({
        start: new Date(String(item && item.start || '')),
        end: new Date(String(item && item.end || '')),
      })).filter(item => !Number.isNaN(item.start.getTime()) && !Number.isNaN(item.end.getTime()) && item.end > item.start);
      resources.set(id, {
        capacity: Math.max(1, Math.floor(safeFloat(raw.capacity, 1))),
        availability: ranges(raw.availability),
        reservations: ranges(raw.reservations || raw.busy),
      });
    });
    return resources;
  }

  function equipmentAvailable(resources, required, start, end) {
    return (required || []).every(value => {
      const resource = resources.get(String(value));
      if (!resource) return false;
      if (resource.availability.length && !resource.availability.some(range => range.start <= start && end <= range.end)) return false;
      return resource.reservations.filter(range => range.start < end && start < range.end).length < resource.capacity;
    });
  }

  function reserveEquipment(resources, required, start, end) {
    (required || []).forEach(value => resources.get(String(value)).reservations.push({ start, end }));
  }

  function compressionRatio(tasks, segments) {
    const need = tasks.reduce((sum, task) => sum + Math.max(MIN_TASK_MINUTES, task.target_hours * 60), 0);
    const avail = segments.reduce((sum, seg) => sum + Math.max(0, (seg.end - seg.cursor) / 60000), 0);
    if (need <= 0 || avail <= 0 || need <= avail) return 1.0;
    return Math.max(0.1, Math.min(1.0, avail / need));
  }

  function compressionAttempts(baseRatio) {
    const ratios = [Math.max(0.1, Math.min(1.0, baseRatio))];
    while (ratios[ratios.length - 1] > 0.1) {
      const next = Math.max(0.1, pythonRoundTo(ratios[ratios.length - 1] * 0.9, 4));
      if (next === ratios[ratios.length - 1]) break;
      ratios.push(next);
    }
    return ratios;
  }

  function cloneSegments(segments) {
    return segments.map(seg => ({ ...seg }));
  }

  function scheduledRow(task, staffName, start, end, durationMs, overtime) {
    const startText = isoMinutes(start);
    const endText = isoMinutes(end);
    const hours = pythonRoundTo(durationMs / 3600000, 2);
    const row = {
      status: 'scheduled',
      task_path: String(task.path),
      task_id: task.id,
      creation_key: task.creation_key,
      task_name: task.task_name,
      work_title: task.work_title || '',
      user: staffName,
      start: startText,
      end: endText,
      hours,
      before_user: task.current_user,
      before_range: task.current_range,
      after_range: `${startText}|${endText}`,
      changed: task.current_user !== staffName || task.current_range !== `${startText}|${endText}`,
      color: task.color || '',
    };
    if (task.required_equipment && task.required_equipment.length) row.required_equipment = [...task.required_equipment];
    // スケジューラー複数アカウント修正計画2026-08-13 Phase 3-2: Desktop版 _scheduled_row と
    // 同じ残業区分をrowへ持たせる（案の一覧・カレンダー・比較で残業と分かるようにする）。
    row.overtime = !!overtime;
    if (row.overtime) row.overtime_hours = hours;
    return row;
  }

  function lockedRowReason(task) {
    // スケジューラー複数アカウント修正計画2026-08-13 Phase 4-2: 保護されて動かさなかった
    // タスクも、結果一覧の理由欄が空欄で並ばないよう理由を示す(Desktop版 _locked_row_reason)。
    const status = String(task.status || '').trim();
    if (task.manual_locked) return '手動でロックされているため、予定を変更していません';
    if (status === '完了') return '完了済みのため、予定を変更していません';
    if (IN_PROGRESS_TASK_STATUSES.has(status)) return '進行中のため、予定を変更していません';
    if (task.assignee_fixed) return '担当者固定のため、予定を変更していません';
    return '既に予定があるため、変更していません';
  }

  function lockedRow(task) {
    const row = {
      status: 'locked',
      task_path: String(task.path),
      task_id: task.id,
      creation_key: task.creation_key,
      task_name: task.task_name,
      user: task.current_user,
      start: task.current_start,
      end: task.current_end,
      hours: task.planned_hours || task.target_hours,
      before_user: task.current_user,
      before_range: task.current_range,
      after_range: task.current_range,
      changed: false,
      color: task.color || '',
      reason: lockedRowReason(task),
    };
    if (task.current_segments && task.current_segments.length) row.segments = task.current_segments;
    return row;
  }

  function unassignedRow(task, reason) {
    return {
      status: 'unassigned',
      task_path: String(task.path),
      task_id: task.id,
      creation_key: task.creation_key,
      task_name: task.task_name,
      user: '',
      start: '',
      end: '',
      hours: 0,
      before_user: task.current_user,
      before_range: task.current_range,
      after_range: '',
      changed: !!(task.current_user || task.current_range),
      reason,
      segments: [],
    };
  }

  function rowEndDatetime(row) {
    const d = new Date(String(row.end || ''));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // _build_plan_at_ratio: 締切→グループ優先度→ページソート値→作業順→タスク名 のソート。
  // 優先度はタスク単位でなく「同一グループ（work+階層パス+作業対象+作業規模）内の最高ランク」を
  // グループ全体へ適用する（production-management-ux-improvement-plan-2026-08-04.md §3-4。
  // タスク単位でソートすると後工程だけ「高」を付けた時に前工程より先に処理され、group_ready の
  // 逐次制約によって工程順が逆転してしまうため。Phase 1 修正後の挙動を必ず踏襲する）。
  function buildPlanAtRatio(tasks, staff, segments, periodValue, contentOrder, contentCandidates, ratio, runtimeOptions) {
    const rows = [];
    const warnings = [];
    const staffMap = new Map(staff.map(row => [row.name, row]));
    segments.forEach(seg => { if (!staffMap.has(seg.staff)) staffMap.set(seg.staff, { name: seg.staff }); });

    const groupPriority = new Map();
    tasks.forEach(task => {
      const key = taskGroupKey(task);
      const rank = priorityRank(task.priority);
      const current = groupPriority.get(key);
      if (current === undefined || rank < current) groupPriority.set(key, rank);
    });

    const baseOrdered = [...tasks].sort((a, b) => {
      const da = deadlineDt(a, periodValue).getTime();
      const db = deadlineDt(b, periodValue).getTime();
      if (da !== db) return da - db;
      const pa = groupPriority.get(taskGroupKey(a));
      const pb = groupPriority.get(taskGroupKey(b));
      if (pa !== pb) return pa - pb;
      if (a.sort_value !== b.sort_value) return a.sort_value - b.sort_value;
      const ca = contentOrder.has(a.content) ? contentOrder.get(a.content) : 9999;
      const cb = contentOrder.has(b.content) ? contentOrder.get(b.content) : 9999;
      if (ca !== cb) return ca - cb;
      return a.task_name < b.task_name ? -1 : a.task_name > b.task_name ? 1 : 0;
    });
    const topological = topologicalTaskOrder(baseOrdered);
    const ordered = topological.tasks;

    const groupReady = new Map();
    const blockedGroups = new Set();
    const completedById = new Map();
    const blockedTaskIds = new Set();
    const knownTaskIds = new Set(tasks.map(task => String(task.id || '')));
    const resources = equipmentState(runtimeOptions);
    ordered.forEach(task => {
      const groupKey = taskGroupKey(task);
      if (topological.cycles.has(String(task.id || ''))) {
        rows.push(unassignedRow(task, '依存関係が循環しています'));
        warnings.push({ type: 'dependency', task: task.task_name, content: task.content });
        blockedTaskIds.add(String(task.id || ''));
        return;
      }
      const dependencies = (task.dependencies || []).map(String).filter(value => knownTaskIds.has(value));
      const dependencyEnds = dependencies.map(value => completedById.get(value)).filter(Boolean);
      if (dependencies.some(value => blockedTaskIds.has(value))) {
        rows.push(unassignedRow(task, '依存タスクが未割り当てです'));
        warnings.push({ type: 'dependency', task: task.task_name, content: task.content });
        blockedTaskIds.add(String(task.id || ''));
        return;
      }
      if (blockedGroups.has(groupKey)) {
        rows.push(unassignedRow(task, '前工程が未割り当てです'));
        warnings.push({ type: 'dependency', task: task.task_name, content: task.content });
        return;
      }
      if (taskProtected(task)) {
        const row = lockedRow(task);
        rows.push(row);
        const endAt = rowEndDatetime(row);
        if (endAt) {
          const current = groupReady.get(groupKey);
          groupReady.set(groupKey, (current && current > endAt) ? current : endAt);
          completedById.set(String(task.id || ''), endAt);
        }
        return;
      }
      const durationMinutes = Math.max(MIN_TASK_MINUTES, pythonRoundTo(task.target_hours * 60 * ratio, 0));
      const durationMs = durationMinutes * 60000;
      const candidates = candidateStaff(task, staffMap, contentCandidates);
      if (!candidates.size) {
        rows.push(unassignedRow(task, '担当できるスタッフがいません'));
        warnings.push({ type: 'no_staff', task: task.task_name, content: task.content });
        blockedGroups.add(groupKey);
        blockedTaskIds.add(String(task.id || ''));
        return;
      }
      const dependencyReady = dependencyEnds.length ? new Date(Math.max(...dependencyEnds.map(value => value.getTime()))) : null;
      const groupStart = groupReady.get(groupKey) || null;
      const earliestStart = dependencyReady && (!groupStart || dependencyReady > groupStart) ? dependencyReady : groupStart;
      const requiredEquipment = task.required_equipment || [];
      const slot = reserveSlot(
        task, candidates, segments, durationMs, deadlineDt(task, periodValue), earliestStart,
        (start, end) => equipmentAvailable(resources, requiredEquipment, start, end),
      );
      if (!slot) {
        rows.push(unassignedRow(task, '期間内の空き時間が足りません'));
        warnings.push({ type: 'deadline', task: task.task_name, minutes: Math.floor(durationMs / 60000) });
        blockedGroups.add(groupKey);
        blockedTaskIds.add(String(task.id || ''));
        return;
      }
      reserveEquipment(resources, requiredEquipment, slot.start, slot.end);
      rows.push(scheduledRow(task, slot.staff, slot.start, slot.end, durationMs, slot.overtime));
      completedById.set(String(task.id || ''), slot.end);
      const current = groupReady.get(groupKey);
      groupReady.set(groupKey, (current && current > slot.end) ? current : slot.end);
    });
    return { rows, warnings };
  }

  function buildPlan(tasks, staff, segments, periodValue, contentOrder, contentCandidates, runtimeOptions) {
    const movable = tasks.filter(task => !taskProtected(task));
    const baseRatio = compressionRatio(movable, segments);
    const attempts = compressionAttempts(baseRatio);
    let bestRows = [];
    let bestWarnings = [];
    let bestScore = null;
    for (const ratio of attempts) {
      const result = buildPlanAtRatio(tasks, staff, cloneSegments(segments), periodValue, contentOrder, contentCandidates, ratio, runtimeOptions);
      const deadlineWarnings = result.warnings.filter(w => w.type === 'deadline');
      const unassignedCount = result.rows.filter(r => r.status === 'unassigned').length;
      const score = [deadlineWarnings.length, unassignedCount];
      if (bestScore === null || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
        bestRows = result.rows;
        bestWarnings = result.warnings;
        bestScore = score;
      }
      if (!deadlineWarnings.length) return { rows: result.rows, warnings: result.warnings };
    }
    return { rows: bestRows, warnings: bestWarnings };
  }

  function suggestions(rows, warnings) {
    const result = [];
    if (warnings.some(w => w.type === 'no_staff')) {
      const contents = [...new Set(warnings.filter(w => w.content).map(w => w.content))].sort();
      contents.forEach(content => result.push(`作業内容『${content}』の担当者候補にスタッフを追加してください`));
    }
    if (warnings.some(w => w.type === 'deadline')) {
      const shortage = warnings.filter(w => w.type === 'deadline').reduce((sum, w) => sum + (Number(w.minutes) || 0), 0);
      result.push(`約${formatHoursOneDecimal(shortage / 60)}時間分の人員追加、〆切延長、または対象縮小を検討してください`);
    }
    if (warnings.some(w => w.type === 'dependency')) result.push('前工程が割り当てられないタスクがあるため、後工程も保留されています');
    if (warnings.some(w => w.type === 'invalid_shift')) result.push('終了時刻がない勤務シフトがあります。シフト表で終了時刻を入力してください');
    if (warnings.some(w => w.type === 'overtime_used')) {
      const overtimeMinutes = warnings.filter(w => w.type === 'overtime_used').reduce((sum, w) => sum + (Number(w.minutes) || 0), 0);
      result.push(`通常の勤務時間だけでは約${formatHoursOneDecimal(overtimeMinutes / 60)}時間分足りず、残業として配置しています`);
    }
    if (!result.length && rows.some(r => r.changed)) result.push('プレビューを確認して問題なければ適用してください');
    return result;
  }

  // _canonical_recalculation_rows: apply時の陳腐化検知（プレビューと同一bodyで再計算した結果を
  // 比較する）用の正規化。行順に依存させないよう最終的にソートする。
  function canonicalRecalculationRows(rows) {
    const canonical = rows.map(row => {
      if (!row || typeof row !== 'object') return ['invalid', String(row)];
      const segs = rowSegments(row).map(item => [String(item.start || ''), String(item.end || '')]);
      return [
        String(row.task_id || ''),
        canonicalTaskPath(row.task_path),
        String(row.status || ''),
        String(row.task_name || ''),
        String(row.creation_key || ''),
        String(row.work_title || ''),
        String(row.user || ''),
        String(row.start || ''),
        String(row.end || ''),
        pythonRoundTo(safeFloat(row.hours, 0), 6),
        String(row.reason || ''),
        segs,
      ];
    });
    canonical.sort((a, b) => {
      const sa = JSON.stringify(a);
      const sb = JSON.stringify(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
    return canonical;
  }

  window.MeldexProductionRecalcEngine = {
    MIN_TASK_MINUTES,
    PROTECTED_TASK_STATUSES,
    IN_PROGRESS_TASK_STATUSES,
    PRIORITY_OPTIONS,
    safeFloat,
    truthy,
    listValue,
    pythonRoundTo,
    pythonFloatStr,
    dateValue,
    addDays,
    isoMinutes,
    period,
    timeRanges,
    firstTimeRange,
    staffActiveOn,
    staffHolidayOn,
    blankStaff,
    priorityRank,
    taskGroupKey,
    taskProtected,
    deadlineDt,
    taskInScope,
    applyRecalculationScope,
    canonicalTaskPath,
    canonicalRecalculationRows,
    parseSegments,
    rowSegments,
    segmentsJson,
    taskEventId,
    logicalTaskId,
    breakRanges,
    shiftBreakRanges,
    subtractRanges,
    shiftDatetimes,
    defaultStaffShifts,
    lockedBusy,
    outOfScopeBusy,
    mergeBusy,
    availability,
    candidateStaff,
    reserveSlot,
    compressionRatio,
    compressionAttempts,
    scheduledRow,
    lockedRow,
    unassignedRow,
    rowEndDatetime,
    topologicalTaskOrder,
    buildPlanAtRatio,
    buildPlan,
    suggestions,
  };
})();
