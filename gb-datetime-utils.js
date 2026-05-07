/**
 * gb-datetime-utils.js: ローカル日時ユーティリティ
 *
 * 目的: `new Date('YYYY-MM-DD')` が UTC 解釈されたり、
 * `toISOString().slice(0,10)` がローカル日付と 1 日ずれる問題を解消するための共通ヘルパー。
 */

/**
 * 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:MM' / 'YYYY-MM-DDTHH:MM:SS' をローカル Date として返す。
 * 未対応形式は Date コンストラクタにフォールバックする。
 */
function parseLocalDate(s) {
  if (s instanceof Date) return new Date(s.getTime());
  if (typeof s !== 'string' || !s) return new Date(NaN);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const h = m[4] != null ? parseInt(m[4], 10) : 0;
    const mi = m[5] != null ? parseInt(m[5], 10) : 0;
    const se = m[6] != null ? parseInt(m[6], 10) : 0;
    const dt = new Date(y, mo, d, h, mi, se, 0);
    if (
      dt.getFullYear() !== y ||
      dt.getMonth() !== mo ||
      dt.getDate() !== d ||
      dt.getHours() !== h ||
      dt.getMinutes() !== mi ||
      dt.getSeconds() !== se
    ) {
      return new Date(NaN);
    }
    return dt;
  }
  const fallback = new Date(s);
  return fallback;
}

function _pad2dt(n) { return String(n).padStart(2, '0'); }

function getMeldexTimeZone() {
  try {
    const saved = localStorage.getItem('meldex-time-zone') || '';
    if (saved) return saved;
  } catch {}
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo';
  } catch {
    return 'Asia/Tokyo';
  }
}

function formatMeldexDateIntl(d, options) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: getMeldexTimeZone(),
    ...(options || {}),
  }).format(d);
}

/**
 * Date → 'YYYY-MM-DD'（ローカル）
 */
function formatLocalDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${_pad2dt(d.getMonth() + 1)}-${_pad2dt(d.getDate())}`;
}

/**
 * Date → 'YYYY-MM-DDTHH:MM'（ローカル）
 */
function formatLocalDateTime(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  return `${formatLocalDate(d)}T${_pad2dt(d.getHours())}:${_pad2dt(d.getMinutes())}`;
}

/**
 * サーバから受けた値をローカル Date に変換する（parseLocalDate のエイリアス、意味明示用）
 */
function apiValueToLocalDate(s) {
  return parseLocalDate(s);
}
