/**
 * gb-db-date.js: DB日付プロパティ共通ヘルパー
 */

const _DB_DATE_TOKEN_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/;

function _dbDateHasTimeToken(v) {
  return typeof v === 'string' && /T\d{2}:\d{2}/.test(v);
}

function _dbDateIsToken(v) {
  return typeof v === 'string' && _DB_DATE_TOKEN_RE.test(v.trim());
}

function _dbDateParseValue(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return { raw: '', start: '', end: '', range: false, hasTime: false };
  }
  const pipeIdx = text.indexOf('|');
  if (pipeIdx >= 0) {
    const start = text.slice(0, pipeIdx).trim();
    const end = text.slice(pipeIdx + 1).trim();
    if (_dbDateIsToken(start) || _dbDateIsToken(end) || !start || !end) {
      return {
        raw: text,
        start,
        end,
        range: true,
        hasTime: _dbDateHasTimeToken(start) || _dbDateHasTimeToken(end),
      };
    }
  }
  return {
    raw: text,
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
