      return _dbDateValueFromDate(d, /T\d{2}:\d{2}/.test(dateStr));
    }
    return /T\d{2}:\d{2}/.test(dateStr) && typeof formatLocalDateTime === 'function'
      ? formatLocalDateTime(d)
      : (typeof formatLocalDate === 'function' ? formatLocalDate(d) : d.toISOString().substring(0, 10));
  }
  const n = parseFloat(dateStr);
  if (!isNaN(n)) return String(n + diff);
  return dateStr;
}

function roundTimeValue(val, scale) {
  if (typeof _dbDateGetComparableValue === 'function') val = _dbDateGetComparableValue(val);
  // 日付の場合を先に判定 (YYYY-MM-DD, YYYY/MM/DD等) — parseFloatが "2024-01-15" を 2024 として誤判定するのを防ぐ
  const isDateLike = typeof val === 'string' && /^\d{4}[-/]\d{2}[-/]\d{2}/.test(val);
  if (isDateLike) {
    const d = typeof parseLocalDate === 'function' ? parseLocalDate(val) : new Date(val);
    if (!isNaN(d.getTime())) {
      const localDate = typeof formatLocalDate === 'function' ? formatLocalDate(d) : d.toISOString().substring(0, 10);
      const localDateTime = typeof formatLocalDateTime === 'function'
        ? formatLocalDateTime(d)
        : d.toISOString().substring(0, 16);
      const parts = typeof _timelineDateParts === 'function' ? _timelineDateParts(d) : null;
      const year = parts?.year ?? d.getFullYear();
      const month = parts?.month ?? (d.getMonth() + 1);
      const day = parts?.day ?? d.getDate();
      const sec = String(parts?.second ?? d.getSeconds()).padStart(2, '0');
      const hour = String(parts?.hour ?? d.getHours()).padStart(2, '0');
      switch (scale) {
        case 'second': return localDateTime + ':' + sec;
        case 'minute': return localDateTime;
        case 'hour': return localDate + 'T' + hour + ':00';
        case 'day': return localDate;
        case 'week': {
          const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
          const w = new Date(Date.UTC(year, month - 1, day - dow));
          return _timelineDatePartsToValue(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate());
        }
        case 'month': return _timelineYearLabel(year) + '-' + String(month).padStart(2,'0');
        case 'year': return _timelineYearLabel(year);
        case 'decade': return String(Math.floor(year/10)*10) + '年代';
        case 'century': return String(Math.floor((year - 1)/100)+1) + '世紀';
        case 'millennium': return String(Math.floor(year/1000)*1000) + '年';
        case 'ten_thousand': return String(Math.floor(year/10000)*10000) + '年';
      }
    }
  }
  // 数値の場合
  const num = parseFloat(val);
  if (!isNaN(num) && isFinite(num)) {
    switch (scale) {
      case 'second': return String(Math.floor(num));
      case 'minute': return String(Math.floor(num / 60) * 60);
      case 'hour': return String(Math.floor(num / 3600) * 3600);
      case 'day': return String(Math.floor(num));
      case 'week': return String(Math.floor(num / 7) * 7);
      case 'month': return String(Math.floor(num / 30) * 30);
      case 'year': return String(Math.floor(num));
      case 'decade': return String(Math.floor(num / 10) * 10);
      case 'century': return String(Math.floor(num / 100) * 100);
      case 'millennium': return String(Math.floor(num / 1000) * 1000);
      case 'ten_thousand': return String(Math.floor(num / 10000) * 10000);
    }
  }
  // テキストの場合はそのまま
  return (val !== null && val !== undefined && val !== '') ? String(val) : '(空)';
}

function _timelineDateParts(date) {
  if (typeof _meldexDateParts === 'function' && typeof getMeldexTimeZone === 'function') {
    return _meldexDateParts(date, getMeldexTimeZone());
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

function _timelineYearLabel(year) {
  const n = Number(year);
  if (!Number.isFinite(n)) return String(year || '');
  if (n >= 0 && n < 10000) return String(Math.trunc(n)).padStart(4, '0');
  return String(Math.trunc(n));
}

function _timelineDatePartsToValue(year, month, day) {
  return `${_timelineYearLabel(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function _timelineGroupStartValue(group, scale) {
  const text = String(group || '').trim();
  let m = text.match(/^(\d{4,})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}${m[4] ? 'T' + m[4] + ':' + m[5] : ''}`;
  m = text.match(/^(\d{4,})[-/](\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-01`;
  m = text.match(/^(\d{4,})$/);
  if (m && ['year', 'decade', 'century', 'millennium', 'ten_thousand'].includes(scale)) return `${m[1]}-01-01`;
  m = text.match(/^([+-]?\d+)年代$/);
  if (m) return `${_timelineYearLabel(Number(m[1]))}-01-01`;
  m = text.match(/^([+-]?\d+)世紀$/);
  if (m) return `${_timelineYearLabel((Number(m[1]) - 1) * 100 + 1)}-01-01`;
  m = text.match(/^([+-]?\d+)年$/);
  if (m) return `${_timelineYearLabel(Number(m[1]))}-01-01`;
  return text;
}

function _timelineValueForDropTarget(oldValue, targetGroup, scale, ptc) {
  const parsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(oldValue || '') : null;
  const source = parsed?.range ? parsed.start : (parsed?.start || oldValue || '');
  const sourceComparable = typeof _dbDateGetComparableValue === 'function' ? _dbDateGetComparableValue(source) : source;
  if (typeof sourceComparable === 'string' && /^\d{4}[-/]\d{2}[-/]\d{2}/.test(sourceComparable)) {
    const target = _timelineGroupStartValue(targetGroup, scale);
    const mode = typeof _dbDateResolveMode === 'function' ? _dbDateResolveMode(ptc || {}, oldValue || '') : { withTime: /T\d{2}:\d{2}/.test(sourceComparable) };
    if (mode.withTime && /^\d{4}-\d{2}-\d{2}$/.test(target)) {
      const time = sourceComparable.match(/T\d{2}:\d{2}/)?.[0] || 'T00:00';
      return target + time;
    }
    return target;
  }
  return String(targetGroup ?? '');
}

function _timelineGroupSortValue(value) {
  const text = String(value ?? '').trim();
  const dateText = _timelineGroupStartValue(text, '');
  if (/^\d{4,}[-/]\d{2}[-/]\d{2}/.test(dateText)) {
    const d = typeof parseLocalDate === 'function' ? parseLocalDate(dateText) : new Date(dateText);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  const m = text.match(/^[+-]?\d+(?:\.\d+)?/);
  if (m) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function _compareTimelineGroupValues(a, b) {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  const na = _timelineGroupSortValue(sa);
  const nb = _timelineGroupSortValue(sb);
  if (na != null && nb != null && na !== nb) return na - nb;
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
}

function navigateToEntity(entityName, dbPath) {
  if (!entityName) return;
  // dbPath指定時: 別DBに遷移してからエントリを選択
  if (dbPath && dbPath !== state.currentDbPath) {
    selectDatabase(dbPath).then(() => {
      selectEntity(_entityPath(dbPath, entityName));
    }).catch(() => showStatus('DBの読み込みに失敗: ' + dbPath, true));
    return;
  }
  if (!state.currentDbPath || !state.pivotData) return;
  // 現在のDB内で一致するエントリを探す
  if (state.pivotData.entities[entityName]) {
    selectEntity(_entityPath(state.currentDbPath, entityName));
    return;
  }
  // 見つからない場合はステータスバーに表示
  showStatus('エントリが見つかりません: ' + entityName, true);
}
