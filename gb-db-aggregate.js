/* ==============================
   gb-db-aggregate.js: 拡張集計エンジン
   プロパティ型に応じた集計タイプ（SUM/AVG/MIN/MAX等）を提供
   ============================== */

/* --- 集計タイプレジストリ --- */
const AGGREGATION_TYPES = {
  // 全型共通
  none:              { label: '-',          appliesTo: '*' },
  count:             { label: '件数',       appliesTo: '*' },
  unique:            { label: 'ユニーク',   appliesTo: '*' },
  empty:             { label: '空',         appliesTo: '*' },
  not_empty:         { label: '非空',       appliesTo: '*' },
  percent_empty:     { label: '空%',        appliesTo: '*' },
  percent_not_empty: { label: '非空%',      appliesTo: '*' },

  // number / formula 専用
  sum:     { label: '合計',   appliesTo: ['number', 'formula'] },
  average: { label: '平均',   appliesTo: ['number', 'formula'] },
  min:     { label: '最小',   appliesTo: ['number', 'formula'] },
  max:     { label: '最大',   appliesTo: ['number', 'formula'] },
  median:  { label: '中央値', appliesTo: ['number', 'formula'] },
  range:   { label: '範囲',   appliesTo: ['number', 'formula'] },

  // date 専用
  earliest:   { label: '最古', appliesTo: ['date'] },
  latest:     { label: '最新', appliesTo: ['date'] },
  date_range: { label: '期間', appliesTo: ['date'] },

  // checkbox 専用
  percent_checked: { label: 'チェック%', appliesTo: ['checkbox'] },
};

/**
 * プロパティ型に対して使用可能な集計タイプ一覧を返す
 * @param {string} propType - プロパティ型 ('text','number','date','select','checkbox','formula'等)
 * @returns {Array<{key:string, label:string}>}
 */
function getAggregationTypesForProperty(propType) {
  const type = propType || 'text';
  const result = [];
  for (const [key, def] of Object.entries(AGGREGATION_TYPES)) {
    if (def.appliesTo === '*' || (Array.isArray(def.appliesTo) && def.appliesTo.includes(type))) {
      result.push({ key, label: def.label });
    }
  }
  return result;
}

/**
 * プロパティ型が未設定の場合、値から型を推定する
 * @returns {string} 推定された型 ('number','date','checkbox','text')
 */
function inferPropertyType(propName, entitiesMap, entityNames) {
  let numCount = 0, dateCount = 0, boolCount = 0, total = 0;
  const sampleSize = Math.min(entityNames.length, 200);
  for (let i = 0; i < entityNames.length && total < sampleSize; i++) {
    const entity = entitiesMap[entityNames[i]];
    if (!entity) continue;
    const vals = filterValues(entity[propName] || []);
    if (vals.length === 0) continue;
    const v = vals[0].value;
    total++;
    if (_isCheckboxLikeValue(v)) { boolCount++; continue; }
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) { dateCount++; continue; }
    if (_toStrictNumber(v) !== null) { numCount++; continue; }
  }
  if (total === 0) return 'text';
  if (boolCount / total > 0.8) return 'checkbox';
  if (numCount / total > 0.8) return 'number';
  if (dateCount / total > 0.8) return 'date';
  return 'text';
}

/* --- 値抽出ヘルパー --- */

function _toStrictNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function _normalizeCheckboxText(value) {
  return String(value).trim().toLowerCase();
}

function _isCheckedValue(value) {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['true', '1', 'on', 'yes', 'はい'].includes(_normalizeCheckboxText(value));
}

function _isCheckboxLikeValue(value) {
  if (typeof value === 'boolean') return true;
  if (value === 0 || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['true', 'false', '1', '0', 'on', 'off', 'yes', 'no', 'はい', 'いいえ'].includes(_normalizeCheckboxText(value));
}

/**
 * エントリ群から数値の配列を抽出する
 */
function extractNumericValues(propName, entitiesMap, entityNames, ptc, propTypes) {
  const nums = [];
  entityNames.forEach(en => {
    if (ptc && ptc.type === 'formula' && ptc.formula) {
      const result = formulaEvalForEntity(ptc.formula, entitiesMap[en], { propTypes });
      if (!result.error) {
        const n = _toStrictNumber(result.value);
        if (n !== null) nums.push(n);
      }
    } else {
      if (!entitiesMap[en]) return;
      const vals = filterValues(entitiesMap[en][propName] || []);
      vals.forEach(v => {
        const n = _toStrictNumber(v.value);
        if (n !== null) nums.push(n);
      });
    }
  });
  return nums;
}

/**
 * エントリ群からDateの配列を抽出する
 */
function extractDateValues(propName, entitiesMap, entityNames) {
  const dates = [];
  entityNames.forEach(en => {
    if (!entitiesMap[en]) return;
    const vals = filterValues(entitiesMap[en][propName] || []);
    vals.forEach(v => {
      const raw = String(v.value ?? '');
      const parts = raw.includes('|') ? raw.split('|') : [raw];
      parts.map(part => part.trim()).filter(Boolean).forEach(part => {
        const d = (typeof parseLocalDate === 'function') ? parseLocalDate(part) : new Date(part);
        if (!isNaN(d.getTime())) dates.push(d);
      });
    });
  });
  return dates;
}

/**
 * エントリ群からチェックボックスの集計を返す
 */
function extractCheckboxStats(propName, entitiesMap, entityNames) {
  // 値が存在するエントリのみ分母に含める（未入力はカウント外）
  let checked = 0, total = 0;
  entityNames.forEach(en => {
    if (!entitiesMap[en]) return;
    const vals = filterValues(entitiesMap[en][propName] || []);
    if (vals.length === 0) return;
    total++;
    if (_isCheckedValue(vals[0].value)) checked++;
  });
  return { checked, total };
}

/* --- メイン集計関数 --- */

/**
 * 集計を計算する（calcColumnCountの拡張版）
 * @param {string} propName - プロパティ名
 * @param {object} entitiesMap - エントリデータマップ
 * @param {string[]} entityNames - エントリ名一覧
 * @param {string} type - 集計タイプキー
 * @param {object} ptc - プロパティ型設定 {type, formula, ...}
 * @returns {string|number} 集計結果
 */
function calcAggregation(propName, entitiesMap, entityNames, type, ptc, propTypes) {
  if (type === 'none') return '';

  // 基本4種は既存のcalcColumnCountに委譲
  if (['count', 'unique', 'empty', 'not_empty'].includes(type)) {
    return calcColumnCount(propName, entitiesMap, entityNames, type, ptc, propTypes);
  }

  const total = entityNames.length;
  if (total === 0) return '';

  // 実際の型を取得（未設定なら推定）
  const resolvedType = ptc?.type || inferPropertyType(propName, entitiesMap, entityNames);

  // パーセント系
  if (type === 'percent_empty' || type === 'percent_not_empty') {
    const emptyCount = calcColumnCount(propName, entitiesMap, entityNames, 'empty', ptc, propTypes);
    const notEmptyCount = calcColumnCount(propName, entitiesMap, entityNames, 'not_empty', ptc, propTypes);
    const denom = Number(emptyCount) + Number(notEmptyCount);
    if (denom === 0) return '0%';
    if (type === 'percent_empty') return Math.round((emptyCount / denom) * 100) + '%';
    return Math.round((notEmptyCount / denom) * 100) + '%';
  }

  // チェックボックスパーセント
  if (type === 'percent_checked') {
    const stats = extractCheckboxStats(propName, entitiesMap, entityNames);
    if (stats.total === 0) return '0%';
    return Math.round((stats.checked / stats.total) * 100) + '%';
  }

  // 数値系集計
  if (['sum', 'average', 'min', 'max', 'median', 'range'].includes(type)) {
    const nums = extractNumericValues(propName, entitiesMap, entityNames, ptc, propTypes);
    if (nums.length === 0) return '-';
    return formatAggregationResult(_calcNumeric(nums, type), type, ptc);
  }

  // 日付系集計
  if (['earliest', 'latest', 'date_range'].includes(type)) {
    const dates = extractDateValues(propName, entitiesMap, entityNames);
    if (dates.length === 0) return '-';
    return _calcDate(dates, type);
  }

  return '';
}

/**
 * 数値集計の計算コア
 */
function _calcNumeric(nums, type) {
  switch (type) {
    case 'sum':     return nums.reduce((a, b) => a + b, 0);
    case 'average': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':     return nums.reduce((a, b) => a < b ? a : b);
    case 'max':     return nums.reduce((a, b) => a > b ? a : b);
    case 'median': {
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    case 'range': {
      const mn = nums.reduce((a, b) => a < b ? a : b);
      const mx = nums.reduce((a, b) => a > b ? a : b);
      return mx - mn;
    }
    default:        return 0;
  }
}

/**
 * 日付集計の計算コア
 */
function _calcDate(dates, type) {
  dates.sort((a, b) => a - b);
  const earliest = dates[0];
  const latest = dates[dates.length - 1];

  if (type === 'earliest') return _formatDate(earliest);
  if (type === 'latest') return _formatDate(latest);

  // date_range: 期間を日数で表示
  const diffMs = latest - earliest;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return '同日';
  const range = _calendarDateRangeParts(earliest, latest);
  if (range.years < 1) return diffDays + '日';
  const years = range.years;
  const remaining = range.days;
  if (remaining === 0) return years + '年';
  return years + '年' + remaining + '日';
}

function _addYearsClamped(date, years) {
  const parts = _aggregateDateParts(date);
  const year = parts.year + years;
  const lastDay = new Date(Date.UTC(year, parts.month, 0)).getUTCDate();
  return _dateFromAggregateParts({
    year,
    month: parts.month,
    day: Math.min(parts.day, lastDay),
  });
}

function _calendarDateRangeParts(start, end) {
  const startParts = _aggregateDateParts(start);
  const endParts = _aggregateDateParts(end);
  let years = endParts.year - startParts.year;
  let anchor = _addYearsClamped(start, years);
  if (_aggregateDateUtc(anchor) > _aggregateDateUtc(end)) {
    years -= 1;
    anchor = _addYearsClamped(start, years);
  }
  const dayMs = 1000 * 60 * 60 * 24;
  const days = Math.max(0, Math.round((_aggregateDateUtc(end) - _aggregateDateUtc(anchor)) / dayMs));
  return { years: Math.max(0, years), days };
}

function _aggregateDateParts(d) {
  const text = _formatDate(d);
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  return {
    year: parseInt(m[1], 10),
    month: parseInt(m[2], 10),
    day: parseInt(m[3], 10),
  };
}

function _dateFromAggregateParts(parts) {
  const text = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  return typeof parseLocalDate === 'function' ? parseLocalDate(text) : new Date(parts.year, parts.month - 1, parts.day);
}

function _aggregateDateUtc(d) {
  const parts = _aggregateDateParts(d);
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

/**
 * 日付を YYYY-MM-DD 形式でフォーマット
 */
function _formatDate(d) {
  if (typeof formatLocalDate === 'function') return formatLocalDate(d);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * 集計結果をフォーマットする
 * @param {number} value - 計算結果
 * @param {string} type - 集計タイプ
 * @param {object} ptc - プロパティ型設定
 * @returns {string}
 */
function formatAggregationResult(value, type, ptc) {
  if (typeof value !== 'number') return String(value);

  // 整数ならそのまま、小数なら2桁まで
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);

  // 単位があれば付与
  if (ptc?.unit) return formatted + ptc.unit;

  return formatted;
}
