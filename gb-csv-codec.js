/* gb-csv-codec.js: CSV本文の解析・保存・列型推定を全実行環境で共有する。 */
(function (root) {
  'use strict';

  const NUMBER_RE = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i;
  const MELDEX_FORMULA_RE = /^=\s*(?:prop\s*\(|if\s*\(|and\s*\(|or\s*\(|not\s*\(|empty\s*\(|contains\s*\(|replace\s*\(|floor\s*\(|ceil\s*\(|round\s*\(|abs\s*\(|mod\s*\(|toNumber\s*\(|format\s*\(|length\s*\(|concat\s*\(|min\s*\(|max\s*\(|now\s*\(|year\s*\(|month\s*\(|day\s*\(|dateBetween\s*\(|dateSubtract\s*\(|dateAdd\s*\(|let\s*\(|lets\s*\()/;
  const EXCEL_A1_RE = /(?:^|[^A-Za-z0-9_])\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?(?:$|[^A-Za-z0-9_])/;

  function normalizeDialect(value) {
    const source = value || {};
    const delimiter = [',', '\t', ';', '|'].includes(source.delimiter) ? source.delimiter : ',';
    const newline = ['\r\n', '\n', '\r'].includes(source.newline) ? source.newline : '\r\n';
    return {
      delimiter,
      newline,
      bom: source.bom !== false,
      finalNewline: source.finalNewline === true,
      encoding: String(source.encoding || 'utf-8-bom').toLowerCase(),
    };
  }

  function scanRecordCounts(text, delimiter) {
    const counts = [];
    let quoted = false;
    let count = 0;
    let hasContent = false;
    for (let index = 0; index < text.length && counts.length < 20; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') index += 1;
        else quoted = !quoted;
        hasContent = true;
      } else if (!quoted && char === delimiter) {
        count += 1;
        hasContent = true;
      } else if (!quoted && (char === '\r' || char === '\n')) {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        if (hasContent || count > 0) counts.push(count);
        count = 0;
        hasContent = false;
      } else if (char !== '\uFEFF') hasContent = true;
    }
    if (hasContent || count > 0) counts.push(count);
    return counts;
  }

  function detectDelimiter(text) {
    let best = { delimiter: ',', score: -1 };
    [',', '\t', ';', '|'].forEach(delimiter => {
      const counts = scanRecordCounts(text, delimiter);
      if (!counts.length) return;
      const positive = counts.filter(count => count > 0);
      if (!positive.length) return;
      const frequency = new Map();
      positive.forEach(count => frequency.set(count, (frequency.get(count) || 0) + 1));
      const stable = Math.max(...frequency.values());
      const score = stable * 100 + positive.reduce((sum, value) => sum + value, 0);
      if (score > best.score) best = { delimiter, score };
    });
    return best.delimiter;
  }

  function detectNewline(text) {
    const crlf = (text.match(/\r\n/g) || []).length;
    const withoutCrlf = text.replace(/\r\n/g, '');
    const lf = (withoutCrlf.match(/\n/g) || []).length;
    const cr = (withoutCrlf.match(/\r/g) || []).length;
    if (crlf >= lf && crlf >= cr && crlf > 0) return '\r\n';
    if (lf >= cr && lf > 0) return '\n';
    if (cr > 0) return '\r';
    return '\r\n';
  }

  function detectDialect(text, options) {
    const raw = String(text == null ? '' : text);
    const supplied = options || {};
    return normalizeDialect({
      delimiter: supplied.delimiter || detectDelimiter(raw),
      newline: supplied.newline || detectNewline(raw),
      bom: supplied.bom == null ? raw.charCodeAt(0) === 0xFEFF : supplied.bom,
      finalNewline: /(?:\r\n|\n|\r)$/.test(raw),
      encoding: supplied.encoding || (raw.charCodeAt(0) === 0xFEFF ? 'utf-8-bom' : 'utf-8'),
    });
  }

  function parse(text, options) {
    const raw = String(text == null ? '' : text);
    const dialect = detectDialect(raw, options);
    const input = raw.replace(/^\uFEFF/, '');
    if (!input) return { rows: [], dialect, warnings: [] };
    const rows = [];
    const warnings = [];
    let row = [];
    let cell = '';
    let quoted = false;
    let recordStarted = false;
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      if (quoted) {
        if (char === '"' && input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else cell += char;
        recordStarted = true;
      } else if (char === '"' && cell === '') {
        quoted = true;
        recordStarted = true;
      } else if (char === dialect.delimiter) {
        row.push(cell);
        cell = '';
        recordStarted = true;
      } else if (char === '\r' || char === '\n') {
        if (char === '\r' && input[index + 1] === '\n') index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        recordStarted = false;
      } else {
        cell += char;
        recordStarted = true;
      }
    }
    if (quoted) warnings.push('閉じていない引用符をファイル末尾で補いました');
    if (recordStarted || row.length > 0 || cell !== '') {
      row.push(cell);
      rows.push(row);
    }
    return { rows, dialect, warnings };
  }

  function encodeCell(value, delimiter) {
    const text = String(value == null ? '' : value);
    if (text.includes(delimiter) || /["\r\n]/.test(text) || /^\s|\s$/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function serialize(rows, options) {
    const dialect = normalizeDialect(options);
    const body = (rows || []).map(row =>
      (Array.isArray(row) ? row : []).map(value => encodeCell(value, dialect.delimiter)).join(dialect.delimiter)
    ).join(dialect.newline);
    const suffix = dialect.finalNewline && body ? dialect.newline : '';
    return (dialect.bom ? '\uFEFF' : '') + body + suffix;
  }

  function isSafeNumber(value) {
    const text = String(value == null ? '' : value).trim();
    if (!NUMBER_RE.test(text)) return false;
    const unsigned = text.replace(/^[+-]/, '');
    if (/^0\d/.test(unsigned)) return false;
    const number = Number(text);
    return Number.isFinite(number);
  }

  function isMeldexFormula(value) {
    const text = String(value == null ? '' : value).trim();
    return MELDEX_FORMULA_RE.test(text) && !EXCEL_A1_RE.test(text);
  }

  function isExcelFormula(value) {
    const text = String(value == null ? '' : value).trim();
    return text.startsWith('=') && EXCEL_A1_RE.test(text);
  }

  function inferColumn(values) {
    const nonEmpty = (values || []).map(value => String(value == null ? '' : value))
      .filter(value => value.trim() !== '');
    if (!nonEmpty.length) return { type: 'text', formula: '', warning: '' };
    if (nonEmpty.every(isSafeNumber)) return { type: 'number', formula: '', warning: '' };
    const formula = nonEmpty[0].trim();
    if (nonEmpty.every(value => value.trim() === formula) && isMeldexFormula(formula)) {
      return { type: 'formula', formula, warning: '' };
    }
    const excelCount = nonEmpty.filter(isExcelFormula).length;
    return {
      type: 'text',
      formula: '',
      warning: excelCount ? `Excel形式の数式 ${excelCount}件はテキストとして扱います` : '',
    };
  }

  function uniqueHeaders(values) {
    const used = new Set();
    return (values || []).map((value, index) => {
      const base = String(value == null ? '' : value).trim() || `列${index + 1}`;
      let name = base;
      let suffix = 2;
      while (used.has(name)) {
        name = `${base} ${suffix}`;
        suffix += 1;
      }
      used.add(name);
      return name;
    });
  }

  function inferColumns(rows, hasHeader) {
    const table = Array.isArray(rows) ? rows : [];
    const maxColumns = table.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
    const headers = hasHeader !== false && table.length
      ? uniqueHeaders(table[0])
      : uniqueHeaders(Array.from({ length: maxColumns }, (_, index) => `列${index + 1}`));
    const start = hasHeader !== false ? 1 : 0;
    return headers.map((name, index) => {
      const inferred = inferColumn(table.slice(start).map(row => row?.[index] ?? ''));
      return {
        id: `column-${index + 1}`,
        name,
        type: inferred.type,
        formula: inferred.formula,
        width: 140,
        wrap: false,
        hidden: false,
        frozen: false,
        warning: inferred.warning,
      };
    });
  }

  function hashPath(path) {
    let hash = 0x811c9dc5;
    const normalized = String(path || '').replace(/\\/g, '/').toLowerCase();
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function metadataPath(csvPath) {
    const normalized = String(csvPath || '').replace(/\\/g, '/');
    const slash = normalized.lastIndexOf('/');
    const parent = slash >= 0 ? normalized.slice(0, slash) : '';
    const file = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const stem = file.replace(/\.csv$/i, '') || 'csv';
    const leaf = `${stem}-${hashPath(normalized)}.json`;
    return (parent ? `${parent}/` : '') + `.meldex/csv/${leaf}`;
  }

  root.MeldexCsv = Object.freeze({
    parse,
    serialize,
    detectDialect,
    normalizeDialect,
    inferColumn,
    inferColumns,
    isSafeNumber,
    isMeldexFormula,
    isExcelFormula,
    uniqueHeaders,
    metadataPath,
  });
})(typeof window !== 'undefined' ? window : globalThis);
