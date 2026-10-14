/** Restore-point schedule and retention policy shared by Desktop/Cloud UI. */
(function (root) {
  'use strict';

  const DEFAULT_TIMEZONE = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  })();
  const DEFAULT_CONFIG = Object.freeze({
    schemaVersion: 2,
    enabled: true,
    cadence: Object.freeze({
      kind: 'hourly', interval: 1, at: '00:00', weekdays: [], dayOfMonth: 1,
      useLastDayOfMonth: false, anchorDate: new Date().toISOString().slice(0, 10),
    }),
    timezone: DEFAULT_TIMEZONE,
    retention: Object.freeze({ schemaVersion: 1, mode: 'forever', days: null }),
  });

  function _integer(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }
  function _safeTimezone(value) {
    const timezone = String(value || DEFAULT_TIMEZONE);
    try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()); return timezone; } catch { return DEFAULT_TIMEZONE; }
  }
  function normalize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const legacyInterval = Number(source.autoInterval);
    const legacyDisabled = Number.isFinite(legacyInterval) && legacyInterval <= 0;
    const legacyHours = Number.isFinite(legacyInterval) && legacyInterval > 0
      ? Math.max(1, Math.round(legacyInterval / 3600000)) : 1;
    const cadenceSource = source.cadence && typeof source.cadence === 'object' ? source.cadence : {};
    const allowedKinds = new Set(['hourly', 'daily', 'weekdays', 'weekly', 'monthly']);
    const kind = allowedKinds.has(cadenceSource.kind) ? cadenceSource.kind : 'hourly';
    const retentionSource = source.retention && typeof source.retention === 'object' ? source.retention : {};
    const retentionMode = retentionSource.mode === 'days' && Number(retentionSource.days) >= 1 ? 'days' : 'forever';
    return {
      schemaVersion: 2,
      enabled: typeof source.enabled === 'boolean' ? source.enabled : !legacyDisabled,
      cadence: {
        kind,
        interval: _integer(cadenceSource.interval, legacyHours, 1, kind === 'monthly' ? 120 : 999),
        at: /^([01]\d|2[0-3]):[0-5]\d$/.test(cadenceSource.at || '') ? cadenceSource.at : '00:00',
        weekdays: [...new Set((Array.isArray(cadenceSource.weekdays) ? cadenceSource.weekdays : [])
          .map(value => _integer(value, -1, 0, 6)).filter(value => value >= 0))].sort(),
        dayOfMonth: _integer(cadenceSource.dayOfMonth, 1, 1, 31),
        useLastDayOfMonth: Boolean(cadenceSource.useLastDayOfMonth),
        anchorDate: /^\d{4}-\d{2}-\d{2}$/.test(cadenceSource.anchorDate || '')
          ? cadenceSource.anchorDate : DEFAULT_CONFIG.cadence.anchorDate,
      },
      timezone: _safeTimezone(source.timezone),
      retention: {
        schemaVersion: 1,
        mode: retentionMode,
        days: retentionMode === 'days' ? _integer(retentionSource.days, 30, 1, 36500) : null,
      },
    };
  }
  function _parts(date, timezone) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    const values = Object.fromEntries(formatter.formatToParts(date).map(item => [item.type, item.value]));
    return {
      year: Number(values.year), month: Number(values.month), day: Number(values.day),
      hour: Number(values.hour) % 24, minute: Number(values.minute), second: Number(values.second),
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday),
    };
  }
  function _localToDate(local, timezone) {
    let guess = Date.UTC(local.year, local.month - 1, local.day, local.hour || 0, local.minute || 0, 0);
    for (let i = 0; i < 4; i += 1) {
      const actual = _parts(new Date(guess), timezone);
      const wantedUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour || 0, local.minute || 0, 0);
      const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
      const delta = wantedUtc - actualUtc;
      if (!delta) break;
      guess += delta;
    }
    const resolved = _parts(new Date(guess), timezone);
    const wantedKey = [local.year, local.month, local.day, local.hour || 0, local.minute || 0].join('-');
    const resolvedKey = [resolved.year, resolved.month, resolved.day, resolved.hour, resolved.minute].join('-');
    if (wantedKey !== resolvedKey) {
      for (let offset = 1; offset <= 180; offset += 1) {
        const candidate = new Date(guess + offset * 60000);
        const p = _parts(candidate, timezone);
        if (p.year === local.year && p.month === local.month && p.day === local.day
          && (p.hour > (local.hour || 0) || (p.hour === (local.hour || 0) && p.minute >= (local.minute || 0)))) return candidate;
      }
    }
    return new Date(guess);
  }
  function _dateValue(year, month, day) { return Math.floor(Date.UTC(year, month - 1, day) / 86400000); }
  function _calendarFromValue(value) {
    const date = new Date(value * 86400000);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() };
  }
  function _at(cadence) { const [hour, minute] = cadence.at.split(':').map(Number); return { hour, minute }; }
  function _monthIndex(year, month) { return year * 12 + month - 1; }
  function _daysInMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

  function nextOccurrence(raw, afterValue) {
    const config = normalize(raw);
    if (!config.enabled) return null;
    const after = afterValue instanceof Date ? afterValue : new Date(afterValue || Date.now());
    const cadence = config.cadence;
    const timezone = config.timezone;
    const afterParts = _parts(after, timezone);
    const anchorBits = cadence.anchorDate.split('-').map(Number);
    const anchorValue = _dateValue(anchorBits[0], anchorBits[1], anchorBits[2]);
    if (cadence.kind === 'hourly') {
      const anchor = _localToDate({ year: anchorBits[0], month: anchorBits[1], day: anchorBits[2], hour: 0, minute: 0 }, timezone);
      const step = cadence.interval * 3600000;
      const count = Math.max(0, Math.floor((after.getTime() - anchor.getTime()) / step) + 1);
      return new Date(anchor.getTime() + count * step);
    }
    const startValue = _dateValue(afterParts.year, afterParts.month, afterParts.day);
    const time = _at(cadence);
    for (let offset = 0; offset <= 800; offset += 1) {
      const value = startValue + offset;
      const day = _calendarFromValue(value);
      let matches = false;
      if (cadence.kind === 'daily') matches = value >= anchorValue && (value - anchorValue) % cadence.interval === 0;
      if (cadence.kind === 'weekdays') matches = cadence.weekdays.includes(day.weekday);
      if (cadence.kind === 'weekly') {
        const weeks = Math.floor((value - anchorValue) / 7);
        const targetDay = cadence.weekdays[0] ?? _calendarFromValue(anchorValue).weekday;
        matches = weeks >= 0 && weeks % cadence.interval === 0 && day.weekday === targetDay;
      }
      if (cadence.kind === 'monthly') {
        const months = _monthIndex(day.year, day.month) - _monthIndex(anchorBits[0], anchorBits[1]);
        const targetDay = cadence.useLastDayOfMonth ? _daysInMonth(day.year, day.month)
          : Math.min(cadence.dayOfMonth, _daysInMonth(day.year, day.month));
        matches = months >= 0 && months % cadence.interval === 0 && day.day === targetDay;
      }
      if (!matches) continue;
      const candidate = _localToDate({ ...day, ...time }, timezone);
      if (candidate.getTime() > after.getTime()) return candidate;
    }
    return null;
  }
  function scheduleId(raw) {
    const config = normalize(raw);
    const text = JSON.stringify({ cadence: config.cadence, timezone: config.timezone });
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return `schedule-${hash.toString(16).padStart(8, '0')}`;
  }
  function bucketId(raw, dueValue) {
    const config = normalize(raw);
    const due = dueValue instanceof Date ? dueValue : new Date(dueValue);
    const p = _parts(due, config.timezone);
    const pad = value => String(value).padStart(2, '0');
    return `${config.cadence.kind}:${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}@${config.timezone}`;
  }
  root.MeldexRestorePointPolicy = Object.freeze({ DEFAULT_CONFIG, normalize, nextOccurrence, scheduleId, bucketId });
})(typeof window !== 'undefined' ? window : globalThis);
