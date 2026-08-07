/* gb-production-management-shift-row-parser.js: shift CSV/XLSX row normalization */
(function (global) {
  'use strict';

  function _pmParseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quote = false;
    const input = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (quote && ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quote = !quote;
      } else if (!quote && ch === ',') {
        row.push(cell);
        cell = '';
      } else if (!quote && (ch === '\n' || ch === '\r')) {
        if (ch === '\r' && input[i + 1] === '\n') i += 1;
        row.push(cell);
        if (row.some(v => String(v).trim())) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some(v => String(v).trim())) rows.push(row);
    return rows;
  }

  function _pmRowsToShifts(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return [];
    const headers = rows[0].map(v => String(v || '').trim());
    const vertical = _pmVerticalShiftRows(headers, rows.slice(1));
    if (vertical.length) return vertical;
    return _pmHorizontalShiftRows(headers, rows.slice(1));
  }

  function _pmVerticalShiftRows(headers, rows) {
    const userIdx = _pmHeaderIndex(headers, ['担当者', 'スタッフ名', 'user', 'name']);
    const dateIdx = _pmHeaderIndex(headers, ['日付', 'date']);
    if (userIdx < 0 || dateIdx < 0) return [];
    const startIdx = _pmHeaderIndex(headers, ['開始', '開始時刻', 'start', 'start_time']);
    const endIdx = _pmHeaderIndex(headers, ['終了', '終了時刻', 'end', 'end_time']);
    const typeIdx = _pmHeaderIndex(headers, ['種別', 'type']);
    const noteIdx = _pmHeaderIndex(headers, ['備考', 'note']);
    return rows.map(row => _pmShiftRow(row[userIdx], row[dateIdx], row[startIdx], row[endIdx], row[typeIdx], row[noteIdx])).filter(Boolean);
  }

  function _pmHorizontalShiftRows(headers, rows) {
    const result = [];
    rows.forEach((row) => {
      const user = String(row[0] || '').trim();
      if (!user) return;
      headers.slice(1).forEach((header, index) => {
        const range = _pmTimeRange(row[index + 1]);
        const date = _pmDate(header);
        if (date && range) result.push(_pmShiftRow(user, date, range.start, range.end, 'work', ''));
      });
    });
    return result.filter(Boolean);
  }

  function _pmHeaderIndex(headers, names) {
    const normalized = names.map(v => String(v).toLowerCase());
    return headers.findIndex(header => normalized.includes(String(header).trim().toLowerCase()));
  }

  function _pmShiftRow(user, date, start, end, type, note) {
    const normalizedDate = _pmDate(date);
    const startText = _pmTime(start);
    const endText = _pmTime(end, { allowOver24: true });
    const range = !endText ? _pmTimeRange(start) : null;
    const finalStart = range ? range.start : startText;
    const finalEnd = range ? range.end : endText;
    if (String(start || '').trim() && !finalStart) return null;
    if (String(end || '').trim() && !finalEnd) return null;
    if (!String(user || '').trim() || !normalizedDate) return null;
    return { user: String(user).trim(), date: normalizedDate, start_time: finalStart, end_time: finalEnd, type: _pmShiftType(type), note: String(note || '') };
  }

  function _pmShiftType(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text === '休み' || text === '休' || text === 'off') return 'off';
    if (text === '祝日' || text === 'holiday') return 'holiday';
    return 'work';
  }

  function _pmDate(value) {
    const text = String(value || '').trim().replace(/\//g, '-');
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const serial = Number(text);
      if (serial >= 30000 && serial <= 80000) {
        const date = new Date(Math.round((serial - 25569) * 86400000));
        if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
      }
    }
    return '';
  }

  function _pmParseShiftTime(value, options = {}) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
    const maxHour = options.allowOver24 ? 47 : 23;
    if (hour < 0 || hour > maxHour) return null;
    return { text: `${String(hour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, dayOffset: hour >= 24 ? 1 : 0 };
  }

  function _pmTime(value, options = {}) {
    const match = String(value || '').trim().match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (!match) return '';
    return _pmParseShiftTime(match[1], options)?.text || '';
  }

  function _pmTimeRange(value) {
    const text = String(value || '');
    const match = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:~|-|〜|から)\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (!match) return null;
    const start = _pmParseShiftTime(match[1]);
    const end = _pmParseShiftTime(match[2], { allowOver24: true });
    return start && end ? { start: start.text, end: end.text } : null;
  }

  global.MeldexProductionShiftParser = Object.freeze({
    parseCsv: _pmParseCsv,
    rowsToShifts: _pmRowsToShifts,
    normalizeDate: _pmDate,
    normalizeTime: _pmTime,
    normalizeType: _pmShiftType,
  });
})(window);
