/**
 * gb-production-time-formatter.js: 制作管理共通時間フォーマッター
 *
 * 目的: 整数秒を正本とする時間を、利用者の表示設定（時間・分 / 分 / 小数時間）に合わせて
 * 正確にフォーマットおよびパースする共通モジュール。
 *
 * 計画書: production-task-actual-time-history-and-analysis-plan-2026-08-15.md §6
 *
 * 表示設定（localStorage: 'meldex-production-time-format'）:
 *   - 'hm'      : 時間・分（初期値）例: 5400秒 -> "1時間30分", 2700秒 -> "45分", 7200秒 -> "2時間", 0秒 -> "0分"
 *   - 'm'       : 分                例: 5400秒 -> "90分", 2700秒 -> "45分", 0秒 -> "0分"
 *   - 'decimal' : 小数時間          例: 5400秒 -> "1.50時間", 2700秒 -> "0.75時間", 0秒 -> "0.00時間"
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'meldex-production-time-format';
  const DEFAULT_MODE = 'hm';

  const FORMAT_OPTIONS = [
    { value: 'hm', label: '時間・分', description: '時間と分で表示（例: 1時間30分）' },
    { value: 'm', label: '分', description: '分単位で表示（例: 90分）' },
    { value: 'decimal', label: '小数時間', description: '小数時間で表示（例: 1.50時間）' },
  ];

  function normalizeMode(mode) {
    const raw = String(mode || '').trim().toLowerCase();
    if (raw === 'hm' || raw === 'hours_minutes' || raw === '時間・分' || raw === '時間分') return 'hm';
    if (raw === 'm' || raw === 'minutes' || raw === '分') return 'm';
    if (raw === 'decimal' || raw === 'hours_decimal' || raw === '小数時間' || raw === '小数') return 'decimal';
    return DEFAULT_MODE;
  }

  function getPreference() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return normalizeMode(saved);
    } catch {}
    return DEFAULT_MODE;
  }

  function setPreference(mode) {
    const norm = normalizeMode(mode);
    try {
      localStorage.setItem(STORAGE_KEY, norm);
      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function') {
        document.dispatchEvent(new CustomEvent('meldex:production-time-format-changed', { detail: { format: norm } }));
      }
    } catch {}
    return norm;
  }

  /**
   * 整数秒（または秒数）を表示文字列へフォーマットする。
   *
   * @param {number|string|null|undefined} seconds 秒数
   * @param {string|null} [mode] 表示モード（省略時はユーザー設定を使用）
   * @param {boolean} [showZero=true] 0秒時に "0分" / "0.00時間" を返すか（falseなら ""）
   * @returns {string} フォーマット済み文字列
   */
  function formatDuration(seconds, mode = null, showZero = true) {
    if (seconds === null || seconds === undefined || seconds === '') return '';
    const num = Number(seconds);
    if (!Number.isFinite(num)) return '';

    const isNegative = num < 0;
    const absSec = Math.abs(num);
    const intSec = Math.round(absSec);

    const normMode = mode ? normalizeMode(mode) : getPreference();

    if (intSec === 0) {
      if (!showZero) return '';
      return normMode === 'decimal' ? '0.00時間' : '0分';
    }

    const prefix = isNegative ? '-' : '';

    if (normMode === 'decimal') {
      const hours = absSec / 3600;
      return `${prefix}${hours.toFixed(2)}時間`;
    }

    const totalMinutes = Math.floor(intSec / 60);
    const adjustedMinutes = (totalMinutes === 0 && intSec >= 30) ? 1 : totalMinutes;

    if (normMode === 'm') {
      return `${prefix}${adjustedMinutes}分`;
    }

    // 'hm' モード
    const hours = Math.floor(adjustedMinutes / 60);
    const minutes = adjustedMinutes % 60;

    if (hours > 0 && minutes > 0) {
      return `${prefix}${hours}時間${minutes}分`;
    }
    if (hours > 0) {
      return `${prefix}${hours}時間`;
    }
    return `${prefix}${minutes}分`;
  }

  /**
   * 入力文字列や数値を整数秒へパースする。
   *
   * @param {string|number|null|undefined} text 入力文字列または数値
   * @returns {number|null} 秒数（整数）、パース不能時は null
   */
  function parseToSeconds(text) {
    if (text === null || text === undefined) return null;
    if (typeof text === 'number') {
      if (!Number.isFinite(text)) return null;
      // 小数または24以下の数値は時間単位と解釈
      if (!Number.isInteger(text) || text <= 24) {
        return Math.round(text * 3600);
      }
      return Math.round(text);
    }

    let raw = String(text).trim();
    if (!raw) return null;

    // 単純な数値文字列
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      const val = parseFloat(raw);
      if (!Number.isFinite(val)) return null;
      if (raw.includes('.') || Math.abs(val) <= 24) {
        return Math.round(val * 3600);
      }
      return Math.round(val);
    }

    const isNegative = raw.startsWith('-');
    if (isNegative) raw = raw.slice(1).trim();

    let totalSeconds = 0;
    let matched = false;

    // 1. 日本語形式: X時間Y分Z秒
    const jpMatch = raw.match(/^(?:(\d+(?:\.\d+)?)\s*時間)?\s*(?:(\d+(?:\.\d+)?)\s*分)?\s*(?:(\d+(?:\.\d+)?)\s*秒)?$/);
    if (jpMatch && (jpMatch[1] || jpMatch[2] || jpMatch[3])) {
      if (jpMatch[1]) totalSeconds += parseFloat(jpMatch[1]) * 3600;
      if (jpMatch[2]) totalSeconds += parseFloat(jpMatch[2]) * 60;
      if (jpMatch[3]) totalSeconds += parseFloat(jpMatch[3]);
      matched = true;
    }

    // 2. 英語形式: 1h 30m / 1.5h / 90min
    if (!matched) {
      const enMatch = raw.match(/^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hours?))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|minutes?))?\s*(?:(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?))?$/i);
      if (enMatch && (enMatch[1] || enMatch[2] || enMatch[3])) {
        if (enMatch[1]) totalSeconds += parseFloat(enMatch[1]) * 3600;
        if (enMatch[2]) totalSeconds += parseFloat(enMatch[2]) * 60;
        if (enMatch[3]) totalSeconds += parseFloat(enMatch[3]);
        matched = true;
      }
    }

    // 3. コロン形式: HH:MM または HH:MM:SS
    if (!matched) {
      const colonMatch = raw.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
      if (colonMatch) {
        totalSeconds += parseInt(colonMatch[1], 10) * 3600 + parseInt(colonMatch[2], 10) * 60;
        if (colonMatch[3]) totalSeconds += parseInt(colonMatch[3], 10);
        matched = true;
      }
    }

    if (!matched) return null;
    const res = Math.round(totalSeconds);
    return isNegative ? -res : res;
  }

  const Formatter = Object.freeze({
    FORMAT_OPTIONS,
    DEFAULT_MODE,
    normalizeMode,
    getPreference,
    setPreference,
    formatDuration,
    parseToSeconds,
  });

  window.MeldexProductionTimeFormatter = Formatter;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Formatter;
  }
})();
