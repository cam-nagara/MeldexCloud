(function () {
  'use strict';

  const TIME_ENTRY_TYPES = Object.freeze(['clock_in', 'clock_out', 'break_start', 'break_end']);

  function fail(message, status = 400, code = '') {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    throw error;
  }

  function strictDate(value) {
    const text = String(value || '');
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return '';
    const normalized = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString().slice(0, 10);
    return normalized === text ? text : '';
  }

  function validTimestamp(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(text)) return '';
    if (!strictDate(text.slice(0, 10))) return '';
    return Number.isNaN(Date.parse(text)) ? '' : text;
  }

  function dayOffset(day, offset) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    if (!match) return '';
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offset)).toISOString().slice(0, 10);
  }

  function state(rows, user, timestamp) {
    const day = String(timestamp || '').slice(0, 10);
    const previous = dayOffset(day, -1);
    const targetEpoch = Date.parse(timestamp);
    const latest = (Array.isArray(rows) ? rows : [])
      .filter(row => row.user === user && String(row.timestamp || '').slice(0, 10) >= previous
        && String(row.timestamp || '').slice(0, 10) <= day && TIME_ENTRY_TYPES.includes(row.type)
        && !Number.isNaN(Date.parse(row.timestamp)) && Date.parse(row.timestamp) <= targetEpoch)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
        || String(a.id || '').localeCompare(String(b.id || ''))).at(-1);
    return ({ clock_in: 'working', break_start: 'away', break_end: 'working', clock_out: 'off' })[latest?.type] || 'initial';
  }

  function assertNormalAction(rows, user, type, timestamp, now = Date.now()) {
    if (Math.abs(now - Date.parse(timestamp)) > 5 * 60 * 1000) {
      fail('打刻時刻が現在時刻から離れています。時刻設定を確認してください', 400, 'CLOCK_TIMESTAMP_OUT_OF_RANGE');
    }
    const allowed = { initial: ['clock_in'], working: ['clock_out', 'break_start'], away: ['break_end'], off: ['clock_in'] };
    if (!allowed[state(rows, user, timestamp)].includes(type)) {
      fail('現在の勤務状態ではこの打刻はできません', 409, 'CLOCK_STATE_CONFLICT');
    }
  }

  function affectedTargets(...entries) {
    const targets = new Map();
    entries.filter(Boolean).forEach((entry) => {
      const user = String(entry.user || '');
      const day = String(entry.timestamp || '').slice(0, 10);
      if (!user || !strictDate(day)) return;
      [day, dayOffset(day, -1)].forEach((candidate) => {
        if (candidate) targets.set(`${user}\u0000${candidate}`, { user, day: candidate });
      });
    });
    return [...targets.values()];
  }

  const activeCalendarLeases = new WeakMap();
  const LEASE_PROVIDER_ORIGINAL = Symbol.for('meldex.lease.originalProvider');

  async function withCalendarLease(provider, operation, context = null) {
    const store = window.MeldexActiveLockStore;
    if (!store?.acquire || !store?.release || !store?.heartbeat) {
      fail('共有カレンダーの更新ロックを利用できません。再読み込みしてから再試行してください', 503, 'CALENDAR_LOCK_UNAVAILABLE');
    }
    const active = activeCalendarLeases.get(provider);
    if (context?.token && active?.token === context.token) return operation(active.context);
    const token = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `calendar-${Date.now()}-${Math.random()}`;
    const holderId = `calendar-mutation:${token}`;
    const lease = {
      path: 'カレンダー', token, holder_id: holderId, locked_by: 'カレンダー更新',
      device_label: 'カレンダー', kind: 'calendar-mutation', include_descendants: true, lease_seconds: 300,
    };
    await store.acquire(provider, lease);
    let leaseLost = null;
    let heartbeatPromise = null;
    const lostError = cause => {
      const error = new Error('共有カレンダーの更新ロックを失いました。変更を保存せず再読み込みしてください');
      error.status = 409;
      error.code = 'CALENDAR_LEASE_LOST';
      if (cause) error.cause = cause;
      return error;
    };
    const renew = async () => {
      if (leaseLost) throw leaseLost;
      if (!heartbeatPromise) {
        heartbeatPromise = Promise.resolve(store.heartbeat(provider, lease))
          .catch(error => { leaseLost = lostError(error); throw leaseLost; })
          .finally(() => { heartbeatPromise = null; });
      }
      return heartbeatPromise;
    };
    const assertOwned = async () => {
      if (leaseLost) throw leaseLost;
      await renew();
      if (leaseLost) throw leaseLost;
    };
    const guardedProviders = new WeakMap();
    const guardedAliases = new Set();
    let leaseState = null;
    const guardProvider = target => {
      if (!target || typeof target !== 'object') return target;
      if (guardedAliases.has(target)) return target;
      if (guardedProviders.has(target)) return guardedProviders.get(target);
      const guarded = new Proxy(target, {
        get(object, property) {
          if (property === LEASE_PROVIDER_ORIGINAL) return object[LEASE_PROVIDER_ORIGINAL] || object;
          const value = Reflect.get(object, property, object);
          if (typeof value !== 'function') return value;
          if (!/^(?:write|upload|put|create|copy|remove|delete|move|rename)/u.test(String(property))) return value.bind(object);
          return async (...args) => { await assertOwned(); return value.apply(object, args); };
        },
      });
      guardedProviders.set(target, guarded);
      guardedAliases.add(guarded);
      if (leaseState) activeCalendarLeases.set(guarded, leaseState);
      return guarded;
    };
    const publicContext = Object.freeze({ token, holderId, assertOwned, guardProvider });
    leaseState = { token, context: publicContext };
    activeCalendarLeases.set(provider, leaseState);
    const heartbeat = setInterval(() => {
      renew().catch(error => {
        console.warn('[Calendar] 共有更新ロックの延長に失敗しました', error);
      });
    }, 60000);
    try {
      const result = await operation(publicContext);
      await assertOwned();
      return result;
    } finally {
      clearInterval(heartbeat);
      if (activeCalendarLeases.get(provider)?.token === token) activeCalendarLeases.delete(provider);
      guardedAliases.forEach(alias => {
        if (activeCalendarLeases.get(alias)?.token === token) activeCalendarLeases.delete(alias);
      });
      try { await store.release(provider, lease.path, token, holderId); }
      catch (error) { console.warn('[Calendar] 共有更新ロックの解放に失敗しました', error); }
    }
  }

  function csvCell(value) {
    let text = value == null ? '' : String(value);
    if (/^\s*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function csvText(rows) {
    return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function sessions(entries, startDay, endDay) {
    const byUser = new Map();
    (Array.isArray(entries) ? entries : []).forEach((raw) => {
      const timestamp = validTimestamp(raw?.timestamp);
      if (!timestamp || !TIME_ENTRY_TYPES.includes(raw?.type)) return;
      const user = String(raw?.user || '');
      if (!byUser.has(user)) byUser.set(user, []);
      byUser.get(user).push({ ...raw, timestamp, epoch: Date.parse(timestamp) });
    });
    const result = [];
    for (const [user, records] of byUser) {
      records.sort((a, b) => a.epoch - b.epoch || String(a.id || '').localeCompare(String(b.id || '')));
      let active = null;
      let breakStart = null;
      for (const record of records) {
        if (record.type === 'clock_in') {
          if (active) continue;
          active = { user, day: record.timestamp.slice(0, 10), clockIn: record, clockOut: null,
            breaks: [], events: [record], notes: [String(record.note || '')] };
          breakStart = null;
        } else if (!active) {
          continue;
        } else if (record.type === 'break_start' && !breakStart) {
          active.events.push(record); active.notes.push(String(record.note || '')); breakStart = record;
        } else if (record.type === 'break_end' && breakStart && record.epoch >= breakStart.epoch) {
          active.events.push(record); active.notes.push(String(record.note || ''));
          active.breaks.push([breakStart, record]); breakStart = null;
        } else if (record.type === 'clock_out' && record.epoch >= active.clockIn.epoch) {
          active.events.push(record); active.notes.push(String(record.note || ''));
          if (breakStart && record.epoch >= breakStart.epoch) active.breaks.push([breakStart, record]);
          active.clockOut = record;
          if (active.day >= startDay && active.day <= endDay) result.push(active);
          active = null; breakStart = null;
        }
      }
      if (active && active.day >= startDay && active.day <= endDay) result.push(active);
    }
    return result.sort((a, b) => a.user.localeCompare(b.user) || a.clockIn.epoch - b.clockIn.epoch);
  }

  function dailyAttendance(attendanceSessions) {
    const daily = new Map();
    attendanceSessions.forEach((session) => {
      const key = `${session.user}\u0000${session.day}`;
      const info = daily.get(key) || { clockIns: [], clockOuts: [], breakStarts: [], breakEnds: [], breakMinutes: 0, workSeconds: 0, notes: [] };
      info.clockIns.push(session.clockIn.timestamp.slice(11, 16));
      if (session.clockOut) {
        info.clockOuts.push(session.clockOut.timestamp.slice(11, 16));
        const breakSeconds = session.breaks.reduce((total, pair) => total + (pair[1].epoch - pair[0].epoch) / 1000, 0);
        info.workSeconds += Math.max(0, (session.clockOut.epoch - session.clockIn.epoch) / 1000 - breakSeconds);
      }
      session.breaks.forEach(([begin, finish]) => {
        info.breakStarts.push(begin.timestamp.slice(11, 16)); info.breakEnds.push(finish.timestamp.slice(11, 16));
        info.breakMinutes += Math.max(0, Math.floor((finish.epoch - begin.epoch) / 60000));
      });
      info.notes.push(...session.notes.filter(Boolean));
      daily.set(key, info);
    });
    return daily;
  }

  function intervalMaps(entries) {
    const workMap = {};
    const breakMap = {};
    sessions(entries, '0001-01-01', '9999-12-31').forEach((session) => {
      workMap[session.user] = workMap[session.user] || [];
      workMap[session.user].push({
        start: session.clockIn.timestamp,
        end: session.clockOut ? session.clockOut.timestamp : null,
      });
      session.breaks.forEach(([begin, finish]) => {
        breakMap[session.user] = breakMap[session.user] || [];
        const interval = { start: begin.timestamp, end: finish.timestamp };
        if (finish.type === 'clock_out') {
          interval.incomplete = true;
          interval.quality_reason = '離席復帰打刻がありません';
        }
        breakMap[session.user].push(interval);
      });
    });
    const grouped = new Map();
    (Array.isArray(entries) ? entries : []).forEach((raw) => {
      const timestamp = validTimestamp(raw?.timestamp);
      if (!timestamp || !TIME_ENTRY_TYPES.includes(raw?.type)) return;
      const user = String(raw?.user || '');
      if (!grouped.has(user)) grouped.set(user, []);
      grouped.get(user).push({ ...raw, timestamp, epoch: Date.parse(timestamp) });
    });
    for (const [user, rows] of grouped.entries()) {
      let stateValue = 'off';
      const reasons = [];
      rows.sort((a, b) => a.epoch - b.epoch || String(a.id || '').localeCompare(String(b.id || ''))).forEach((row) => {
        if (row.type === 'clock_in' && stateValue === 'off') stateValue = 'working';
        else if (row.type === 'break_start' && stateValue === 'working') stateValue = 'away';
        else if (row.type === 'break_end' && stateValue === 'away') stateValue = 'working';
        else if (row.type === 'clock_out' && ['working', 'away'].includes(stateValue)) stateValue = 'off';
        else reasons.push(`打刻順序が競合しています: ${String(row.id || row.type)}`);
      });
      if (!reasons.length) continue;
      workMap[user] = workMap[user] || [{ start: null, end: null }];
      workMap[user].forEach((interval) => {
        interval.quality_status = 'conflict';
        interval.quality_reasons = [...new Set(reasons)];
      });
    }
    return { workMap, breakMap };
  }

  function validateCsvQuery(dateFrom, dateTo, format) {
    const startDay = strictDate(dateFrom);
    const endDay = strictDate(dateTo);
    if (!['generic', 'smaregi', 'moneyforward'].includes(format)) {
      fail('format は generic / smaregi / moneyforward のいずれかを指定してください', 400, 'INVALID_CSV_FORMAT');
    }
    if (!startDay || !endDay) fail('date_from と date_to は必須です', 400, 'INVALID_CSV_DATE');
    if (endDay < startDay) fail('date_to は date_from 以降を指定してください', 400, 'INVALID_CSV_RANGE');
    if ((Date.parse(endDay + 'T00:00:00Z') - Date.parse(startDay + 'T00:00:00Z')) / 86400000 + 1 > 366) {
      fail('出力期間は最大366日です', 400, 'CSV_RANGE_TOO_LARGE');
    }
    return { startDay, endDay };
  }

  function buildCsv(entries, shifts, startDay, endDay, format) {
    const attendanceSessions = sessions(entries, startDay, endDay);
    const rows = [];
    if (format === 'moneyforward') {
      rows.push(['従業員番号', '姓', '名', '打刻所属日', '打刻日', '打刻時刻', '打刻種別']);
      const labels = { clock_in: '出勤', clock_out: '退勤', break_start: '休憩開始', break_end: '休憩終了' };
      attendanceSessions.forEach((session) => {
        const names = session.user.trim().split(/\s+/, 2);
        session.events.forEach(event => rows.push([session.user, names[0] || '', names[1] || '', session.day.replace(/-/g, '/'),
          event.timestamp.slice(0, 10).replace(/-/g, '/'), event.timestamp.slice(11, 16), labels[event.type]]));
      });
    } else {
      rows.push(format === 'smaregi'
        ? ['従業員名', '日付', 'シフト区分', 'シフト開始', 'シフト終了', '出勤時刻', '退勤時刻', '離席時間(分)', '実労働時間(h)', '備考']
        : ['従業員名', '日付', 'シフト区分', 'シフト開始', 'シフト終了', '出勤時刻', '退勤時刻', '離席', '復帰', '離席時間(分)', '実労働時間(h)', '備考']);
      const daily = dailyAttendance(attendanceSessions);
      const shiftMap = new Map();
      shifts.forEach((shift) => {
        const key = `${String(shift.user || '')}\u0000${String(shift.date || '')}`;
        if (!shiftMap.has(key)) shiftMap.set(key, []);
        shiftMap.get(key).push(shift);
      });
      const keys = [...new Set([...daily.keys(), ...shiftMap.keys()])].sort();
      keys.forEach((key) => {
        const [user, day] = key.split('\u0000');
        const dayShifts = (shiftMap.get(key) || [{}]).sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
        dayShifts.forEach((shift, index) => {
          const actual = index === 0 ? daily.get(key) : null;
          const common = [user, day, shift.type || '', shift.start_time || '', shift.end_time || '',
            (actual?.clockIns || []).join(','), (actual?.clockOuts || []).join(',')];
          const hours = actual ? (actual.workSeconds / 3600).toFixed(2) : '';
          const notes = (actual?.notes || []).join('; ');
          rows.push(format === 'smaregi'
            ? common.concat([actual?.breakMinutes ?? '', hours, notes])
            : common.concat([(actual?.breakStarts || []).join(','), (actual?.breakEnds || []).join(','), actual?.breakMinutes ?? '', hours, notes]));
        });
      });
    }
    return csvText(rows);
  }

  function createMutationService(deps) {
    const { readStore, writeStore, deriveEvent, randomId, nowIso } = deps;

    async function ensureCalendars(targets) {
      const calendars = await readStore('calendars');
      let changed = false;
      const byUser = new Map();
      for (const { user } of targets) {
        if (byUser.has(user)) continue;
        let calendar = calendars.find(row => row.source === 'attendance' && row.user === user);
        if (!calendar) {
          const now = nowIso();
          calendar = { id: randomId('attendance-cal'), name: `実績: ${user}`, color: '#6a9955', user,
            source: 'attendance', visible: 1, sort_order: 0, folder: '実績カレンダー', edit_role: 'admin', created: now, modified: now };
          calendars.push(calendar);
          changed = true;
        }
        byUser.set(user, calendar.id);
      }
      if (changed) await writeStore('calendars', calendars);
      return byUser;
    }

    async function sync(timeRows, targets) {
      if (!targets.length) return;
      const events = await readStore('events');
      for (const { user, day } of targets) {
        const existing = events.find(row => row.id === `attendance:${user}:${day}`);
        if (existing && existing.calendar_source !== 'attendance') {
          fail('勤怠由来予定IDが通常予定と衝突しています', 409, 'ATTENDANCE_EVENT_COLLISION');
        }
      }
      const calendarIds = await ensureCalendars(targets);
      for (const { user, day } of targets) {
        const id = `attendance:${user}:${day}`;
        const index = events.findIndex(row => row.id === id);
        const existing = index >= 0 ? events[index] : null;
        const derived = deriveEvent(timeRows, user, day, existing);
        if (derived) {
          derived.calendar_id = calendarIds.get(user) || existing?.calendar_id || '';
          if (index >= 0) events[index] = derived;
          else events.push(derived);
        } else if (index >= 0) {
          events.splice(index, 1);
        }
      }
      await writeStore('events', events);
    }

    async function snapshot(storeNames) {
      const result = {};
      for (const name of storeNames) result[name] = await readStore(name);
      return result;
    }

    async function restore(original, storeNames) {
      const writeErrors = [];
      for (const name of storeNames) {
        try {
          const current = await readStore(name);
          if (JSON.stringify(current) !== JSON.stringify(original[name])) await writeStore(name, original[name]);
        } catch (error) {
          writeErrors.push(`${name}: ${error?.message || error}`);
        }
      }
      const mismatches = [];
      for (const name of storeNames) {
        try {
          if (JSON.stringify(await readStore(name)) !== JSON.stringify(original[name])) mismatches.push(name);
        } catch (error) {
          mismatches.push(`${name}(確認失敗: ${error?.message || error})`);
        }
      }
      if (mismatches.length) {
        throw new Error(`復元後も不一致: ${mismatches.join(', ')}${writeErrors.length ? ` / 保存エラー: ${writeErrors.join('; ')}` : ''}`);
      }
    }

    async function runStores(storeNames, mutation, failureCode, failureLabel) {
      const original = await snapshot(storeNames);
      try {
        return await mutation(JSON.parse(JSON.stringify(original)));
      } catch (originalError) {
        try {
          await restore(original, storeNames);
        } catch (restoreError) {
          fail(
            `${failureLabel}に失敗し、原状復帰にも失敗しました（元のエラー: ${originalError?.message || originalError} / 復元エラー: ${restoreError?.message || restoreError}）`,
            500,
            failureCode,
          );
        }
        throw originalError;
      }
    }

    const run = mutation => runStores(
      ['calendars', 'events', 'time'], mutation, 'ATTENDANCE_ROLLBACK_FAILED', '勤怠保存',
    );
    const runShift = mutation => runStores(
      ['calendars', 'events', 'shifts'], mutation, 'SHIFT_ROLLBACK_FAILED', 'シフト保存',
    );
    return Object.freeze({ run, runShift, sync });
  }

  window.MeldexCloudCalendarAttendance = Object.freeze({
    TIME_ENTRY_TYPES, strictDate, validTimestamp, dayOffset, state, assertNormalAction, affectedTargets,
    validateCsvQuery, buildCsv, intervalMaps, createMutationService,
  });
  window.MeldexCloudCalendarLease = Object.freeze({ withLease: withCalendarLease });
})();
