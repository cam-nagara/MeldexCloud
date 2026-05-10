/**
 * gb-db-date.js: DB日付プロパティ共通ヘルパー
 */

const _DB_DATE_TOKEN_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/;
const _DB_DATE_INPUT_RE = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const _DB_TIME_INPUT_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function _dbDateHasTimeToken(v) {
  return typeof v === 'string' && /T\d{2}:\d{2}/.test(v);
}

function _dbDateIsToken(v) {
  return typeof v === 'string' && _DB_DATE_TOKEN_RE.test(v.trim());
}

function _dbDatePad2(n) {
  return String(n).padStart(2, '0');
}

function _dbDateBuildDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function _dbDateBuildPart(date, hour = null, minute = null, usedBaseDate = false, timeOnly = false) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const hasTime = hour != null && minute != null;
  if (hasTime && (hour < 0 || hour > 23 || minute < 0 || minute > 59)) return null;
  const token = `${date.getFullYear()}-${_dbDatePad2(date.getMonth() + 1)}-${_dbDatePad2(date.getDate())}`
    + (hasTime ? `T${_dbDatePad2(hour)}:${_dbDatePad2(minute)}` : '');
  return { token, date, hour, minute, hasTime, usedBaseDate, timeOnly };
}

function _dbDateCoerceBaseDate(baseDate) {
  if (baseDate instanceof Date && !Number.isNaN(baseDate.getTime())) {
    return _dbDateBuildDate(baseDate.getFullYear(), baseDate.getMonth() + 1, baseDate.getDate());
  }
  if (typeof baseDate !== 'string' || !baseDate.trim()) return null;
  const part = _dbDateParseSinglePart(baseDate.trim(), null);
  return part ? part.date : null;
}

function _dbDateParseSinglePart(raw, baseDate) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  let m = text.match(_DB_DATE_INPUT_RE);
  if (m) {
    const date = _dbDateBuildDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!date) return null;
    if (m[4] != null) {
      return _dbDateBuildPart(date, Number(m[4]), Number(m[5]), false, false);
    }
    return _dbDateBuildPart(date, null, null, false, false);
  }
  m = text.match(_DB_TIME_INPUT_RE);
  if (m) {
    const base = _dbDateCoerceBaseDate(baseDate);
    if (!base) return null;
    return _dbDateBuildPart(base, Number(m[1]), Number(m[2]), true, true);
  }
  return null;
}

function _dbDateSplitRangeText(text) {
  const pipeIdx = text.indexOf('|');
  if (pipeIdx >= 0) return { left: text.slice(0, pipeIdx).trim(), right: text.slice(pipeIdx + 1).trim(), sep: '|' };
  const tildeMatch = text.match(/\s*[~～〜]\s*/);
  if (tildeMatch) {
    return {
      left: text.slice(0, tildeMatch.index).trim(),
      right: text.slice(tildeMatch.index + tildeMatch[0].length).trim(),
      sep: '~',
    };
  }
  const dashMatch = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(?=(?:\d{1,2}:\d{2}|\d{4}[/-]\d{1,2}[/-]\d{1,2}))/.exec(text);
  if (dashMatch) {
    const leftEnd = dashMatch.index + dashMatch[1].length;
    return { left: text.slice(0, leftEnd).trim(), right: text.slice(dashMatch.index + dashMatch[0].length).trim(), sep: '-' };
  }
  return null;
}

function _dbDatePartToComparableDate(part) {
  if (!part) return null;
  return new Date(
    part.date.getFullYear(),
    part.date.getMonth(),
    part.date.getDate(),
    part.hasTime ? part.hour : 0,
    part.hasTime ? part.minute : 0
  );
}

function _dbDateAddDaysToToken(token, days) {
  const part = _dbDateParseSinglePart(token, null);
  if (!part) return token;
  const date = new Date(part.date.getFullYear(), part.date.getMonth(), part.date.getDate() + days);
  return _dbDateBuildPart(date, part.hour, part.minute, part.usedBaseDate, part.timeOnly)?.token || token;
}

function _dbDateParseValue(raw, options = {}) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return { raw: '', start: '', end: '', range: false, hasTime: false };
  }
  const split = _dbDateSplitRangeText(text);
  if (split) {
    const startPart = _dbDateParseSinglePart(split.left, options.baseDate || null);
    const endBase = startPart?.date || _dbDateCoerceBaseDate(options.baseDate || null);
    const endPart = _dbDateParseSinglePart(split.right, endBase);
    if (startPart && endPart) {
      let end = endPart.token;
      let overnight = false;
      const startDate = _dbDatePartToComparableDate(startPart);
      const endDate = _dbDatePartToComparableDate(endPart);
      if (startPart.hasTime && endPart.hasTime && endPart.timeOnly && endDate <= startDate) {
        end = _dbDateAddDaysToToken(end, 1);
        overnight = true;
      }
      return {
        raw: text,
        value: `${startPart.token}|${end}`,
        start: startPart.token,
        end,
        range: true,
        hasTime: startPart.hasTime || endPart.hasTime,
        usedBaseDate: !!(startPart.usedBaseDate || endPart.usedBaseDate),
        overnight,
      };
    }
    if (split.sep === '|' && (_dbDateIsToken(split.left) || _dbDateIsToken(split.right) || !split.left || !split.right)) {
      return {
        raw: text,
        value: text,
        start: split.left,
        end: split.right,
        range: true,
        hasTime: _dbDateHasTimeToken(split.left) || _dbDateHasTimeToken(split.right),
      };
    }
  }
  const part = _dbDateParseSinglePart(text, options.baseDate || null);
  if (part) {
    return {
      raw: text,
      value: part.token,
      start: part.token,
      end: '',
      range: false,
      hasTime: part.hasTime,
      usedBaseDate: !!part.usedBaseDate,
    };
  }
  return {
    raw: text,
    value: text,
    start: text,
    end: '',
    range: false,
    hasTime: _dbDateHasTimeToken(text),
  };
}

function _dbDateResolveMode(ptc, raw) {
  const parsed = _dbDateParseValue(raw);
  return {
    withTime: !!(ptc && ptc.withTime) || parsed.hasTime,
    range: !!(ptc && ptc.range) || parsed.range,
  };
}

function _dbDateToInputValue(v, wantTime) {
  if (!v || typeof v !== 'string') return '';
  const text = v.trim();
  if (wantTime) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.substring(0, 16);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text + 'T00:00';
    return text;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.substring(0, 10);
  return text;
}

function _dbDateValueFromDate(date, withTime) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  if (!withTime) return `${y}-${m}-${d}`;
  return `${y}-${m}-${d}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function _dbDateSerializeValue(start, end, ptc, rawForMode = '') {
  const mode = _dbDateResolveMode(ptc, rawForMode);
  let s = _dbDateToInputValue(start, mode.withTime);
  let e = _dbDateToInputValue(end, mode.withTime);
  if (!mode.range) return s;
  if (!s && e) s = e;
  if (!s && !e) return '';
  return `${s}|${e}`;
}

function _dbDateNormalizeForCompare(raw, ptc) {
  const parsed = _dbDateParseValue(raw);
  return _dbDateSerializeValue(parsed.start, parsed.end, ptc, raw);
}

function _dbDateFormatSingle(v, withTime) {
  if (!v || typeof v !== 'string') return v || '';
  const m = v.trim().match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (!m) return v;
  return withTime && m[2] ? `${m[1]} ${m[2]}` : m[1];
}

function _dbDateFormatDisplay(raw, ptc) {
  const parsed = _dbDateParseValue(raw);
  const mode = _dbDateResolveMode(ptc, raw);
  const startText = _dbDateFormatSingle(parsed.start, mode.withTime);
  const endText = _dbDateFormatSingle(parsed.end, mode.withTime);
  if (!mode.range) return startText;
  if (parsed.end) return `${startText} ～ ${endText}`;
  if (parsed.raw.includes('|')) return startText ? `${startText} ～` : '';
  return startText;
}

function _dbDateCurrentValue(ptc, options = {}) {
  const mode = _dbDateResolveMode(ptc, '');
  const start = _dbDateValueFromDate(new Date(), mode.withTime);
  if (!mode.range) return start;
  const endSame = options.rangeEndSame !== false;
  return _dbDateSerializeValue(start, endSame ? start : '', ptc);
}

function _dbDateGetComparableValue(raw, useEnd = false) {
  const parsed = _dbDateParseValue(raw);
  if (!parsed.range) return parsed.start;
  return useEnd ? (parsed.end || parsed.start) : parsed.start;
}

function _dbDateShiftValue(raw, diff) {
  const parsed = _dbDateParseValue(raw);
  if (!parsed.range) return raw;
  const mode = _dbDateResolveMode(null, raw);
  const dayDiff = Math.round(diff / (24 * 60 * 60 * 1000));
  const shiftOne = token => {
    if (!_dbDateIsToken(token)) return token || '';
    const hasTime = mode.withTime || _dbDateHasTimeToken(token);
    if (!hasTime) {
      const m = token.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dayDiff);
        if (!Number.isNaN(d.getTime())) return _dbDateValueFromDate(d, false);
      }
    }
    // 'YYYY-MM-DD' を UTC 解釈させないよう parseLocalDate を使う
    const d = (typeof parseLocalDate === 'function') ? parseLocalDate(token) : new Date(token);
    if (Number.isNaN(d.getTime())) return token;
    d.setTime(d.getTime() + diff);
    return _dbDateValueFromDate(d, hasTime);
  };
  return _dbDateSerializeValue(shiftOne(parsed.start), shiftOne(parsed.end), mode, raw);
}

function _dbDateCreateEditor(raw, ptc, options = {}) {
  const mode = _dbDateResolveMode(ptc, raw);
  const parsed = _dbDateParseValue(raw);
  const layout = options.layout || 'inline';
  const root = document.createElement('div');
  root.className = options.className || 'cell-date-editor';
  root.style.cssText = options.rootStyle || (layout === 'block'
    ? 'display:flex;flex-direction:column;gap:6px;width:100%;'
    : 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;width:100%;');
  const inputType = mode.withTime ? 'datetime-local' : 'date';
  const inputStyle = options.inputStyle || 'padding:3px 6px;background:var(--bg2);color:var(--fg);border:1px solid var(--accent);border-radius:3px;font-size:12px;box-sizing:border-box;';
  const inputClass = options.inputClassName || 'cell-date-input';

  const createInput = (labelText, value) => {
    const input = document.createElement('input');
    input.type = inputType;
    input.className = inputClass;
    input.value = _dbDateToInputValue(value, mode.withTime);
    input.style.cssText = inputStyle;
    if (layout === 'block') {
      const field = document.createElement('label');
      field.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--fg2);';
      const title = document.createElement('span');
      title.textContent = labelText;
      field.appendChild(title);
      field.appendChild(input);
      return { wrapper: field, input };
    }
    return { wrapper: input, input };
  };

  const startField = createInput('開始', parsed.start);
  root.appendChild(startField.wrapper);
  let endField = null;
  if (mode.range) {
    if (layout === 'inline') {
      const sep = document.createElement('span');
      sep.textContent = '～';
      sep.style.cssText = 'color:var(--fg2);font-size:12px;';
      root.appendChild(sep);
    }
    endField = createInput('終了', parsed.end);
    root.appendChild(endField.wrapper);
  }

  return {
    root,
    mode,
    startInput: startField.input,
    endInput: endField?.input || null,
    contains(target) { return root.contains(target); },
    focus() { startField.input.focus(); },
    isEmpty() {
      return !startField.input.value && !(endField && endField.input.value);
    },
    getValue() {
      return _dbDateSerializeValue(
        startField.input.value,
        endField ? endField.input.value : '',
        ptc,
        raw
      );
    },
  };
}
