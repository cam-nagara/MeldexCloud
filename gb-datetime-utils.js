/**
 * gb-datetime-utils.js: ローカル日時ユーティリティ
 *
 * 目的: `new Date('YYYY-MM-DD')` が UTC 解釈されたり、
 * `toISOString().slice(0,10)` がローカル日付と 1 日ずれる問題を解消するための共通ヘルパー。
 */

const MELDEX_DEFAULT_TIME_ZONE = 'Asia/Tokyo';

function _pad2dt(n) { return String(n).padStart(2, '0'); }

function _isValidMeldexTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('ja-JP', { timeZone: timeZone.trim() }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function getMeldexTimeZone() {
  try {
    const saved = (localStorage.getItem('meldex-time-zone') || '').trim();
    if (_isValidMeldexTimeZone(saved)) return saved;
    if (saved) localStorage.removeItem('meldex-time-zone');
  } catch {}
  return MELDEX_DEFAULT_TIME_ZONE;
}

function _meldexDateParts(d, timeZone) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const tz = _isValidMeldexTimeZone(timeZone) ? timeZone.trim() : MELDEX_DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(d);
  const out = {};
  parts.forEach(part => {
    if (part.type !== 'literal') out[part.type] = parseInt(part.value, 10);
  });
  if (out.hour === 24) out.hour = 0;
  return out;
}

function _isValidDateParts(y, mo, d, h, mi, se, ms) {
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return false;
  if (!Number.isInteger(h) || !Number.isInteger(mi) || !Number.isInteger(se) || !Number.isInteger(ms)) return false;
  if (mo < 0 || mo > 11 || d < 1 || h < 0 || h > 23 || mi < 0 || mi > 59 || se < 0 || se > 59 || ms < 0 || ms > 999) return false;
  const check = new Date(Date.UTC(y, mo, d, h, mi, se, ms));
  return check.getUTCFullYear() === y
    && check.getUTCMonth() === mo
    && check.getUTCDate() === d
    && check.getUTCHours() === h
    && check.getUTCMinutes() === mi
    && check.getUTCSeconds() === se;
}

function _dateFromMeldexZoneParts(y, mo, d, h, mi, se, ms, timeZone) {
  if (!_isValidDateParts(y, mo, d, h, mi, se, ms)) return new Date(NaN);
  const tz = _isValidMeldexTimeZone(timeZone) ? timeZone.trim() : getMeldexTimeZone();
  const desiredWallUtc = Date.UTC(y, mo, d, h, mi, se, ms);
  let utc = desiredWallUtc;
  for (let i = 0; i < 4; i++) {
    const actual = _meldexDateParts(new Date(utc), tz);
    if (!actual) return new Date(NaN);
    const actualWallUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, ms);
    const delta = desiredWallUtc - actualWallUtc;
    if (delta === 0) break;
    utc += delta;
  }
  const result = new Date(utc);
  const finalParts = _meldexDateParts(result, tz);
  if (!finalParts
    || finalParts.year !== y
    || finalParts.month !== mo + 1
    || finalParts.day !== d
    || finalParts.hour !== h
    || finalParts.minute !== mi
    || finalParts.second !== se) {
    return new Date(NaN);
  }
  return result;
}

/**
 * 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:MM' / 'YYYY-MM-DDTHH:MM:SS' を
 * Meldexのタイムゾーン上の日時として返す。
 * ISOオフセット付きの値はオフセットを優先する。
 */
function parseLocalDate(s) {
  if (s instanceof Date) return new Date(s.getTime());
  if (typeof s !== 'string' || !s.trim()) return new Date(NaN);
  const raw = s.trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const h = m[4] != null ? parseInt(m[4], 10) : 0;
    const mi = m[5] != null ? parseInt(m[5], 10) : 0;
    const se = m[6] != null ? parseInt(m[6], 10) : 0;
    const ms = m[7] != null ? parseInt((m[7].slice(1) + '00').slice(0, 3), 10) : 0;
    if (!_isValidDateParts(y, mo, d, h, mi, se, ms)) return new Date(NaN);
    if (m[8]) {
      const tzSuffix = m[8] === 'Z' ? 'Z' : m[8].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
      return new Date(`${m[1]}-${m[2]}-${m[3]}T${_pad2dt(h)}:${_pad2dt(mi)}:${_pad2dt(se)}.${String(ms).padStart(3, '0')}${tzSuffix}`);
    }
    return _dateFromMeldexZoneParts(y, mo, d, h, mi, se, ms, getMeldexTimeZone());
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return new Date(NaN);
  return new Date(raw);
}

function formatMeldexDateIntl(d, options) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: getMeldexTimeZone(),
      ...(options || {}),
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: MELDEX_DEFAULT_TIME_ZONE,
      ...(options || {}),
    }).format(d);
  }
}

/**
 * Date → 'YYYY-MM-DD'（ローカル）
 */
function formatLocalDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const parts = _meldexDateParts(d, getMeldexTimeZone());
  if (!parts) return '';
  return `${parts.year}-${_pad2dt(parts.month)}-${_pad2dt(parts.day)}`;
}

/**
 * Date → 'YYYY-MM-DDTHH:MM'（ローカル）
 */
function formatLocalDateTime(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const parts = _meldexDateParts(d, getMeldexTimeZone());
  if (!parts) return '';
  return `${parts.year}-${_pad2dt(parts.month)}-${_pad2dt(parts.day)}T${_pad2dt(parts.hour)}:${_pad2dt(parts.minute)}`;
}

/**
 * サーバから受けた値をローカル Date に変換する（parseLocalDate のエイリアス、意味明示用）
 */
function apiValueToLocalDate(s) {
  return parseLocalDate(s);
}
