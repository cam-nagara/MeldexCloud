/* タイムライン用の暦体系 */

const TL_CALENDAR_SYSTEM_DEFAULT_ID = 'gregorian';
const TL_CALENDAR_SYSTEM_EDIT_VALUE = '__edit_calendar_system__';
const TL_CALENDAR_GROUP_PREFIX = '@tlcal|';
const TL_CALENDAR_DAY_MS = 86400000;

function _timelineSafeCalendarId(text, fallback = '') {
  const raw = String(text || '').trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return safe || fallback || ('calendar-' + Date.now().toString(36));
}

function _timelineDefaultGregorianMonths() {
  return [
    '1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月',
  ].map((name, index) => ({ name, days: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][index] }));
}

function _timelineDefaultWeekdays() {
  return ['日', '月', '火', '水', '木', '金', '土'];
}

function _timelineDefaultCalendarSystems() {
  const baseScales = typeof TL_SCALES !== 'undefined' ? TL_SCALES : [
    { value: 'day', label: '日' }, { value: 'week', label: '週' }, { value: 'month', label: '月' }, { value: 'year', label: '年' },
  ];
  return [{
    id: TL_CALENDAR_SYSTEM_DEFAULT_ID,
    name: 'グレゴリオ暦',
    builtIn: true,
    eraLabel: '西暦',
    epoch: '0001-01-01',
    weekdays: _timelineDefaultWeekdays(),
    months: _timelineDefaultGregorianMonths(),
    units: baseScales.map(scale => ({ id: scale.value, label: scale.label, baseScale: scale.value })),
  }];
}

function _timelineDefaultCustomCalendarSystem() {
  return {
    id: 'custom-' + Date.now().toString(36),
    name: '新しい暦',
    eraLabel: '神暦',
    epoch: '0001-01-01',
    weekdays: ['光曜日', '風曜日', '水曜日', '火曜日', '土曜日'],
    months: [
      { name: 'はじまりの月', days: 30 },
      { name: '緑の月', days: 30 },
      { name: '雨の月', days: 30 },
      { name: '火の月', days: 30 },
      { name: '実りの月', days: 30 },
      { name: '星の月', days: 30 },
    ],
    units: [
      { id: 'day', label: '日', days: 1 },
      { id: 'week', label: '週', days: 5 },
      { id: 'month', label: '月', days: 30 },
      { id: 'year', label: '年', days: 180 },
      { id: 'era', label: '紀', days: 1800 },
    ],
  };
}

function _normalizeTimelineCalendarMonth(month, index) {
  const name = String(month?.name || month?.label || (index + 1) + '月').trim() || ((index + 1) + '月');
  const days = Math.max(1, Math.round(Number(month?.days || month?.lengthDays || 30) || 30));
  return { name, days };
}

function _normalizeTimelineCalendarUnit(unit, index) {
  const label = String(unit?.label || unit?.name || '単位 ' + (index + 1)).trim() || ('単位 ' + (index + 1));
  const baseScale = String(unit?.baseScale || '').trim();
  const id = _timelineSafeCalendarId(unit?.id || label, 'unit-' + (index + 1));
  const days = Number(unit?.days ?? unit?.lengthDays);
  const out = { id, label };
  if (baseScale) out.baseScale = baseScale;
  if (Number.isFinite(days) && days > 0) out.days = days;
  return out;
}

function _normalizeTimelineCalendarLeapYear(leapYear, months) {
  const src = leapYear && typeof leapYear === 'object' ? leapYear : {};
  const monthCount = Array.isArray(months) && months.length ? months.length : 1;
  const enabled = src.enabled === true || src.enabled === 'true';
  const interval = Math.max(1, Math.round(Number(src.interval ?? src.every ?? 4) || 4));
  const firstYear = Math.max(1, Math.round(Number(src.firstYear ?? interval) || interval));
  const extraDays = Math.max(1, Math.round(Number(src.extraDays ?? src.days ?? 1) || 1));
  const rawMonth = Math.round(Number(src.monthIndex ?? src.month ?? 0) || 0);
  const monthIndex = Math.max(0, Math.min(monthCount - 1, rawMonth));
  return { enabled, interval, firstYear, extraDays, monthIndex };
}

function _normalizeTimelineCalendarSystem(system, index = 0) {
  const src = system && typeof system === 'object' ? system : {};
  const name = String(src.name || '暦 ' + (index + 1)).trim() || ('暦 ' + (index + 1));
  const months = (Array.isArray(src.months) && src.months.length ? src.months : _timelineDefaultGregorianMonths())
    .map(_normalizeTimelineCalendarMonth);
  const weekdays = (Array.isArray(src.weekdays) && src.weekdays.length ? src.weekdays : _timelineDefaultWeekdays())
    .map(v => String(v || '').trim())
    .filter(Boolean);
  const units = (Array.isArray(src.units) && src.units.length ? src.units : [
    { id: 'day', label: '日', days: 1 },
    { id: 'month', label: '月', days: months[0]?.days || 30 },
    { id: 'year', label: '年', days: months.reduce((sum, m) => sum + m.days, 0) || 360 },
  ]).map(_normalizeTimelineCalendarUnit);
  return {
    id: _timelineSafeCalendarId(src.id || name, 'calendar-' + (index + 1)),
    name,
    builtIn: src.builtIn === true,
    eraLabel: String(src.eraLabel || '').trim(),
    epoch: _timelineNormalizeDateText(src.epoch || '0001-01-01'),
    weekdays,
    months,
    units,
    leapYear: _normalizeTimelineCalendarLeapYear(src.leapYear, months),
  };
}

function _timelineCustomCalendarSystems(cfg) {
  return (Array.isArray(cfg?.calendarSystems) ? cfg.calendarSystems : [])
    .map((system, index) => _normalizeTimelineCalendarSystem(system, index))
    .filter(system => system.id && system.id !== TL_CALENDAR_SYSTEM_DEFAULT_ID);
}

function _timelineCalendarSystems(cfg) {
  const builtIns = _timelineDefaultCalendarSystems();
  const used = new Set(builtIns.map(system => system.id));
  const custom = [];
  _timelineCustomCalendarSystems(cfg).forEach(system => {
    if (used.has(system.id)) system.id = 'custom-' + system.id;
    used.add(system.id);
    custom.push(system);
  });
  return builtIns.concat(custom);
}

function _timelineActiveCalendarSystem(cfg) {
  const systems = _timelineCalendarSystems(cfg);
  const id = String(cfg?.calendarSystemId || TL_CALENDAR_SYSTEM_DEFAULT_ID);
  return systems.find(system => system.id === id) || systems[0];
}

function _timelineScaleOptionsForSystem(system) {
  const normalized = _normalizeTimelineCalendarSystem(system || _timelineDefaultCalendarSystems()[0]);
  return normalized.units.map(unit => ({
    value: unit.id,
    label: unit.label,
    baseScale: unit.baseScale || '',
    days: unit.days,
  }));
}

function _timelineDefaultScaleForCalendarSystem(system) {
  const options = _timelineScaleOptionsForSystem(system);
  return options.find(option => option.value === 'day')?.value || options[0]?.value || 'day';
}

function _timelineResolveScaleForCalendarSystem(cfg, system) {
  const current = String(cfg?.scale || '');
  const options = _timelineScaleOptionsForSystem(system);
  return options.some(option => option.value === current) ? current : _timelineDefaultScaleForCalendarSystem(system);
}

function _timelineCalendarSystemOptionsHtml(cfg) {
  const activeId = String(cfg?.calendarSystemId || TL_CALENDAR_SYSTEM_DEFAULT_ID);
  const systems = _timelineCalendarSystems(cfg);
  const rows = systems.map(system =>
    `<option value="${esc(system.id)}" ${activeId === system.id ? 'selected' : ''}>${esc(system.name)}</option>`);
  return rows.join('');
}

function _timelineScaleOptionsHtml(system, selectedScale) {
  return _timelineScaleOptionsForSystem(system).map(option =>
    `<option value="${esc(option.value)}" ${selectedScale === option.value ? 'selected' : ''}>${esc(option.label)}</option>`
  ).join('');
}

function _timelineNormalizeDateText(text) {
  const value = String(text || '').trim();
  const m = value.match(/^([+-]?\d{1,6})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return '0001-01-01';
  return `${_timelineYearLabel(Number(m[1]))}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

function _timelineDateTextToDayNumber(text) {
  const value = String(text || '').trim();
  const m = value.match(/^([+-]?\d{1,6})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(Date.UTC(0, month - 1, day));
  date.setUTCFullYear(year);
  return Math.floor(date.getTime() / TL_CALENDAR_DAY_MS);
}

function _timelineDayNumberToDateValue(dayNumber) {
  const date = new Date(Math.trunc(dayNumber) * TL_CALENDAR_DAY_MS);
  return _timelineDatePartsToValue(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function _timelineValueDayNumber(value) {
  const comparable = typeof _dbDateGetComparableValue === 'function' ? _dbDateGetComparableValue(value) : value;
  return _timelineDateTextToDayNumber(comparable);
}

function _timelinePositiveModulo(value, size) {
  return ((value % size) + size) % size;
}

function _timelineCalendarBaseYearLength(system) {
  return system.months.reduce((sum, month) => sum + month.days, 0) || 360;
}

function _timelineCalendarIsLeapYear(system, year) {
  const rule = _normalizeTimelineCalendarLeapYear(system?.leapYear, system?.months || []);
  if (!rule.enabled) return false;
  return year >= rule.firstYear && ((year - rule.firstYear) % rule.interval) === 0;
}

function _timelineCalendarYearExtraDays(system, year) {
  const rule = _normalizeTimelineCalendarLeapYear(system?.leapYear, system?.months || []);
  return _timelineCalendarIsLeapYear(system, year) ? rule.extraDays : 0;
}

function _timelineCalendarMonthDays(system, monthIndex, year) {
  const months = Array.isArray(system?.months) ? system.months : [];
  const baseDays = Math.max(1, Math.round(Number(months[monthIndex]?.days || 30) || 30));
  const rule = _normalizeTimelineCalendarLeapYear(system?.leapYear, months);
  return rule.enabled && rule.monthIndex === monthIndex && _timelineCalendarIsLeapYear(system, year)
    ? baseDays + rule.extraDays
    : baseDays;
}

function _timelineCalendarYearLength(system, year = 1) {
  return _timelineCalendarBaseYearLength(system) + _timelineCalendarYearExtraDays(system, year);
}

function _timelineCalendarYearPosition(system, relDay) {
  let year = 1;
  let yearStartRel = 0;
  let dayOfYear = Math.trunc(relDay);
  if (dayOfYear >= 0) {
    let guard = 0;
    while (guard < 20000) {
      const length = _timelineCalendarYearLength(system, year);
      if (dayOfYear < length) break;
      dayOfYear -= length;
      yearStartRel += length;
      year += 1;
      guard += 1;
    }
    return { year, dayOfYear, yearStartRel };
  }
  let guard = 0;
  while (dayOfYear < 0 && guard < 20000) {
    year -= 1;
    const length = _timelineCalendarYearLength(system, year);
    yearStartRel -= length;
    dayOfYear += length;
    guard += 1;
  }
  return { year, dayOfYear, yearStartRel };
}

function _timelineCalendarUnitKind(unit) {
  const id = String(unit?.id || '').trim();
  const label = String(unit?.label || unit?.name || '').trim();
  if (id === 'day' || label === '日') return 'day';
  if (id === 'month' || label === '月') return 'month';
  if (id === 'year' || label === '年') return 'year';
  return '';
}

function _timelineCalendarPartsFromDay(system, dayNumber) {
  const epochDay = _timelineDateTextToDayNumber(system.epoch) ?? _timelineDateTextToDayNumber('0001-01-01');
  const rel = Math.trunc(dayNumber - epochDay);
  const position = _timelineCalendarYearPosition(system, rel);
  let dayOfYear = position.dayOfYear;
  let monthStartRel = position.yearStartRel;
  let monthIndex = 0;
  for (let i = 0; i < system.months.length; i++) {
    const days = _timelineCalendarMonthDays(system, i, position.year);
    if (dayOfYear < days) {
      monthIndex = i;
      break;
    }
    dayOfYear -= days;
    monthStartRel += days;
  }
  const weekday = system.weekdays.length
    ? system.weekdays[_timelinePositiveModulo(rel, system.weekdays.length)]
    : '';
  return {
    year: position.year,
    monthIndex,
    monthName: system.months[monthIndex]?.name || ((monthIndex + 1) + '月'),
    day: dayOfYear + 1,
    weekday,
    yearStartDay: epochDay + position.yearStartRel,
    monthStartDay: epochDay + monthStartRel,
    yearLength: _timelineCalendarYearLength(system, position.year),
    monthLength: _timelineCalendarMonthDays(system, monthIndex, position.year),
  };
}

function _timelineCalendarDayNumberFromParts(system, year, monthIndex, day) {
  const epochDay = _timelineDateTextToDayNumber(system.epoch) ?? _timelineDateTextToDayNumber('0001-01-01');
  const months = Array.isArray(system?.months) && system.months.length ? system.months : _timelineDefaultCustomCalendarSystem().months;
  let y = Math.round(Number(year) || 1);
  if (!Number.isFinite(y) || y === 0) y = 1;
  let rel = 0;
  if (y > 1) {
    for (let currentYear = 1; currentYear < y; currentYear += 1) rel += _timelineCalendarYearLength(system, currentYear);
  } else if (y < 1) {
    for (let currentYear = 0; currentYear >= y; currentYear -= 1) rel -= _timelineCalendarYearLength(system, currentYear);
  }
  const m = Math.max(0, Math.min(months.length - 1, Math.round(Number(monthIndex) || 0)));
  for (let index = 0; index < m; index += 1) rel += _timelineCalendarMonthDays(system, index, y);
  const maxDay = _timelineCalendarMonthDays(system, m, y);
  const d = Math.max(1, Math.min(maxDay, Math.round(Number(day) || 1)));
  return epochDay + rel + d - 1;
}

function _timelineCalendarTimeText(value) {
  const text = String(value || '');
  const m = text.match(/(?:^|[T ])(\d{1,2}):(\d{1,2})(?::\d{1,2})?/);
  if (!m) return '00:00';
  return `${String(Number(m[1])).padStart(2, '0')}:${String(Number(m[2])).padStart(2, '0')}`;
}

function _timelineCalendarInputState(system, value) {
  const dayNumber = _timelineValueDayNumber(value) ?? _timelineDateTextToDayNumber(system?.epoch || '0001-01-01') ?? 0;
  const parts = _timelineCalendarPartsFromDay(system, dayNumber);
  return {
    year: parts.year,
    monthIndex: parts.monthIndex,
    day: parts.day,
    maxDay: parts.monthLength,
    time: _timelineCalendarTimeText(value),
  };
}

function _timelineCalendarDateValueFromParts(system, year, monthIndex, day, timeText = '') {
  const value = _timelineDayNumberToDateValue(_timelineCalendarDayNumberFromParts(system, year, monthIndex, day));
  const time = _timelineCalendarTimeText(timeText);
  return timeText ? `${value}T${time}` : value;
}

function _timelineCalendarMonthOptionsHtml(system, selectedIndex = 0) {
  const months = Array.isArray(system?.months) && system.months.length ? system.months : _timelineDefaultCustomCalendarSystem().months;
  return months.map((month, index) => {
    const name = String(month?.name || month?.label || (index + 1) + '月').trim() || ((index + 1) + '月');
    return `<option value="${index}" ${Number(selectedIndex) === index ? 'selected' : ''}>${esc(name)}</option>`;
  }).join('');
}

function _timelineFormatCalendarDay(system, dayNumber, unit) {
  const parts = _timelineCalendarPartsFromDay(system, dayNumber);
  const era = system.eraLabel ? system.eraLabel : system.name;
  const unitDays = Number(unit?.days || 1);
  const kind = _timelineCalendarUnitKind(unit);
  if (kind === 'year' || unitDays >= parts.yearLength) return `${era}${parts.year}年`;
  if (kind === 'month' || unitDays >= Math.max(...system.months.map((month, index) => _timelineCalendarMonthDays(system, index, parts.year)))) return `${era}${parts.year}年 ${parts.monthName}`;
  const weekday = parts.weekday ? `(${parts.weekday})` : '';
  return `${era}${parts.year}年 ${parts.monthName}${parts.day}日${weekday}`;
}

function _timelineCalendarGroupKey(system, unit, dayNumber) {
  const label = _timelineFormatCalendarDay(system, dayNumber, unit);
  return `${TL_CALENDAR_GROUP_PREFIX}${system.id}|${unit.id}|${Math.trunc(dayNumber)}|${encodeURIComponent(label)}`;
}

function _timelineParseCalendarGroup(value) {
  const text = String(value || '');
  if (!text.startsWith(TL_CALENDAR_GROUP_PREFIX)) return null;
  const parts = text.slice(TL_CALENDAR_GROUP_PREFIX.length).split('|');
  if (parts.length < 4) return null;
  const dayNumber = Number(parts[2]);
  if (!Number.isFinite(dayNumber)) return null;
  return {
    systemId: parts[0],
    unitId: parts[1],
    dayNumber,
    label: decodeURIComponent(parts.slice(3).join('|') || ''),
  };
}

function _timelineDisplayGroupValue(value) {
  return _timelineParseCalendarGroup(value)?.label || value;
}

function _timelineCalendarGroupSortValue(value) {
  const parsed = _timelineParseCalendarGroup(value);
  return parsed ? parsed.dayNumber : null;
}

function _timelineCalendarGroupStartValue(value) {
  const parsed = _timelineParseCalendarGroup(value);
  return parsed ? _timelineDayNumberToDateValue(parsed.dayNumber) : null;
}

function _timelineRoundTimeValue(value, cfg) {
  const system = _timelineActiveCalendarSystem(cfg);
  const scale = _timelineResolveScaleForCalendarSystem(cfg, system);
  if (system.id === TL_CALENDAR_SYSTEM_DEFAULT_ID) return roundTimeValue(value, scale);
  const unit = system.units.find(item => item.id === scale) || system.units[0];
  if (!unit) return roundTimeValue(value, scale);
  if (unit.baseScale) return roundTimeValue(value, unit.baseScale);
  const valueDay = _timelineValueDayNumber(value);
  if (valueDay == null) return roundTimeValue(value, scale);
  const epochDay = _timelineDateTextToDayNumber(system.epoch) ?? _timelineDateTextToDayNumber('0001-01-01');
  const unitDays = Math.max(1, Math.round(Number(unit.days || 1)));
  const parts = _timelineCalendarPartsFromDay(system, valueDay);
  const kind = _timelineCalendarUnitKind(unit);
  let startDay = epochDay + Math.floor((valueDay - epochDay) / unitDays) * unitDays;
  if (kind === 'year') startDay = parts.yearStartDay;
  else if (kind === 'month') startDay = parts.monthStartDay;
  return _timelineCalendarGroupKey(system, unit, startDay);
}

function _timelineCalendarList(overlay, listName) {
  return overlay.querySelector(`[data-tl-cal-list="${listName}"]`);
}

function _timelineCalendarRemoveButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gb-btn gb-btn-xs gb-btn-quiet tl-calendar-row-remove';
  button.setAttribute('aria-label', 'この行を削除');
  button.title = 'この行を削除';
  button.textContent = '削除';
  button.addEventListener('click', () => button.closest('.tl-calendar-list-row')?.remove());
  return button;
}

async function _timelineConfirmCalendarPresetDelete(system) {
  const name = system?.name || '選択中の暦';
  const message = `暦プリセット「${name}」を削除しますか？\n削除した暦を使用中の場合、このシートの表示はグレゴリオ暦に戻ります。`;
  if (typeof cfConfirm === 'function') {
    return !!await cfConfirm(message, { danger: true, okLabel: '削除' });
  }
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return !!window.confirm(message);
  }
  return false;
}

function _timelineCalendarPresetFileName(system) {
  const name = system?.name || 'timeline-calendar';
  const safe = typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.sanitizeTitle === 'function'
    ? MeldexExportSave.sanitizeTitle(name, 'timeline-calendar')
    : String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'timeline-calendar';
  return safe + '.timeline-calendar.json';
}

async function _timelineExportCalendarPreset(system) {
  const normalized = _normalizeTimelineCalendarSystem(system || _timelineDefaultCalendarSystems()[0]);
  const payload = {
    type: 'meldex.timelineCalendarPreset',
    version: 1,
    exportedAt: new Date().toISOString(),
    calendarSystem: normalized,
  };
  const text = JSON.stringify(payload, null, 2);
  const filename = _timelineCalendarPresetFileName(normalized);
  if (typeof MeldexExportSave !== 'undefined' && typeof MeldexExportSave.saveText === 'function') {
    await MeldexExportSave.saveText(text, {
      filename,
      extension: '.json',
      filetypes: [['JSONファイル', '*.json'], ['すべてのファイル', '*.*']],
      okMessage: '暦プリセットを出力しました',
      errorMessage: '暦プリセットを出力できませんでした',
    });
    return;
  }
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
  if (typeof showStatus === 'function') showStatus('暦プリセットを出力しました');
}

function _timelineDuplicateCalendarPreset(dbPath, cfg, ctx) {
  const active = _timelineActiveCalendarSystem(cfg);
  const copy = _normalizeTimelineCalendarSystem({
    ...active,
    id: 'custom-' + Date.now().toString(36),
    name: (active?.name || '暦') + ' コピー',
    builtIn: false,
  });
  const nextSystems = _timelineCustomCalendarSystems(cfg).filter(system => system.id !== copy.id);
  nextSystems.push(copy);
  setTimelineConfig(dbPath, {
    ...cfg,
    calendarSystemId: copy.id,
    calendarSystems: nextSystems,
    scale: _timelineDefaultScaleForCalendarSystem(copy),
  }, {
    label: 'シート表示: 暦プリセット',
    detail: '複製: ' + copy.name,
    ctx,
  });
  if (typeof renderTimeline === 'function') renderTimeline(ctx);
  if (typeof showStatus === 'function') showStatus('暦プリセットを複製しました: ' + copy.name);
}

function _handleTimelineCalendarPresetAction(action, dbPath, cfg, ctx) {
  const currentCfg = dbPath && typeof getTimelineConfig === 'function' ? getTimelineConfig(dbPath, { ctx }) : cfg;
  if (action === 'edit') {
    _showTimelineCalendarSystemModal(dbPath, currentCfg, ctx);
    return;
  }
  if (action === 'duplicate') {
    _timelineDuplicateCalendarPreset(dbPath, currentCfg, ctx);
    return;
  }
  if (action === 'export') {
    _timelineExportCalendarPreset(_timelineActiveCalendarSystem(currentCfg)).catch(err => {
      if (typeof showStatus === 'function') showStatus('暦プリセットを出力できませんでした: ' + (err?.message || err), true);
    });
  }
}

function _timelineCalendarAppendNameRow(overlay, listName, value = '') {
  const list = _timelineCalendarList(overlay, listName);
  if (!list) return null;
  const row = document.createElement('div');
  row.className = 'tl-calendar-list-row tl-calendar-list-row--name';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'gb-input';
  input.dataset.tlCalName = '1';
  input.value = String(value || '');
  row.appendChild(input);
  row.appendChild(_timelineCalendarRemoveButton());
  list.appendChild(row);
  return row;
}

function _timelineCalendarAppendLengthRow(overlay, listName, item = {}, options = {}) {
  const list = _timelineCalendarList(overlay, listName);
  if (!list) return null;
  const row = document.createElement('div');
  row.className = 'tl-calendar-list-row tl-calendar-list-row--length';
  row.dataset.tlCalId = item.id || '';

  const nameLabel = document.createElement('label');
  nameLabel.textContent = options.nameLabel || '名前';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'gb-input';
  nameInput.dataset.tlCalName = '1';
  nameInput.value = String(item.name || item.label || '');
  nameLabel.appendChild(nameInput);

  const daysLabel = document.createElement('label');
  daysLabel.textContent = options.daysLabel || '日数';
  const daysInput = document.createElement('input');
  daysInput.type = 'number';
  daysInput.className = 'gb-input tl-number-input';
  daysInput.min = '1';
  daysInput.step = '1';
  daysInput.dataset.tlCalDays = '1';
  daysInput.value = String(Math.max(1, Math.round(Number(item.days || item.lengthDays || 1) || 1)));
  daysLabel.appendChild(daysInput);

  row.appendChild(nameLabel);
  row.appendChild(daysLabel);
  row.appendChild(_timelineCalendarRemoveButton());
  list.appendChild(row);
  return row;
}

function _timelineCalendarFillRows(overlay, listName, rows, appendRow) {
  const list = _timelineCalendarList(overlay, listName);
  if (!list) return;
  list.innerHTML = '';
  rows.forEach(row => appendRow(overlay, listName, row));
}

function _timelineCalendarReadNameRows(overlay, listName, fallback) {
  const rows = Array.from(_timelineCalendarList(overlay, listName)?.querySelectorAll('.tl-calendar-list-row') || [])
    .map(row => row.querySelector('[data-tl-cal-name]')?.value?.trim())
    .filter(Boolean);
  return rows.length ? rows : fallback;
}

function _timelineCalendarReadLengthRows(overlay, listName, fallback, keyName) {
  const rows = Array.from(_timelineCalendarList(overlay, listName)?.querySelectorAll('.tl-calendar-list-row') || [])
    .map((row, index) => {
      const name = row.querySelector('[data-tl-cal-name]')?.value?.trim();
      const days = Number(row.querySelector('[data-tl-cal-days]')?.value);
      if (!name || !Number.isFinite(days) || days <= 0) return null;
      return {
        id: row.dataset.tlCalId || '',
        name,
        [keyName]: Math.max(1, Math.round(days)),
        index,
      };
    })
    .filter(Boolean);
  return rows.length ? rows : fallback.map((row, index) => ({ ...row, index }));
}

function _timelineCalendarMonthOptionsHtml(months, selectedIndex = 0) {
  const rows = (Array.isArray(months) && months.length ? months : _timelineDefaultCustomCalendarSystem().months)
    .map((month, index) => {
      const name = String(month?.name || month?.label || (index + 1) + '月').trim() || ((index + 1) + '月');
      return `<option value="${index}" ${Number(selectedIndex) === index ? 'selected' : ''}>${esc(name)}</option>`;
    });
  return rows.join('');
}

function _timelineCalendarRefreshLeapMonthOptions(overlay, selectedIndex = null) {
  const select = overlay.querySelector('[data-tl-cal-leap-month]');
  if (!select) return;
  const current = selectedIndex == null ? Number(select.value || 0) : Number(selectedIndex);
  const months = _timelineCalendarReadLengthRows(
    overlay,
    'months',
    _timelineDefaultCustomCalendarSystem().months,
    'days'
  ).map(month => ({ name: month.name, days: month.days }));
  select.innerHTML = _timelineCalendarMonthOptionsHtml(months, Number.isFinite(current) ? current : 0);
  if (!select.value && select.options.length) select.value = '0';
}

function _timelineCalendarSetLeapEnabled(overlay, enabled) {
  overlay.querySelectorAll('[data-tl-cal-leap-control]').forEach(el => {
    el.disabled = !enabled;
  });
}

function _timelineCalendarReadLeapYear(overlay, months, fallback) {
  const enabled = !!overlay.querySelector('[data-tl-cal-leap-enabled]')?.checked;
  const interval = Number(overlay.querySelector('[data-tl-cal-leap-interval]')?.value);
  const firstYear = Number(overlay.querySelector('[data-tl-cal-leap-first-year]')?.value);
  const extraDays = Number(overlay.querySelector('[data-tl-cal-leap-extra-days]')?.value);
  const monthIndex = Number(overlay.querySelector('[data-tl-cal-leap-month]')?.value);
  return _normalizeTimelineCalendarLeapYear({
    ...(fallback || {}),
    enabled,
    interval,
    firstYear,
    extraDays,
    monthIndex,
  }, months);
}

function _timelineCalendarSystemFromModal(overlay, current) {
  const name = overlay.querySelector('[data-tl-cal-field="name"]')?.value?.trim() || '新しい暦';
  const eraLabel = overlay.querySelector('[data-tl-cal-field="era"]')?.value?.trim() || name;
  const epoch = _timelineNormalizeDateText(overlay.querySelector('[data-tl-cal-field="epoch"]')?.value || '0001-01-01');
  const weekdays = _timelineCalendarReadNameRows(overlay, 'weekdays', _timelineDefaultWeekdays());
  const months = _timelineCalendarReadLengthRows(
    overlay,
    'months',
    _timelineDefaultCustomCalendarSystem().months,
    'days'
  ).map(month => ({ name: month.name, days: month.days }));
  const leapYear = _timelineCalendarReadLeapYear(overlay, months, current?.leapYear);
  const units = _timelineCalendarReadLengthRows(
    overlay,
    'units',
    _timelineDefaultCustomCalendarSystem().units,
    'days'
  ).map((unit, index) => ({
    id: _timelineSafeCalendarId(unit.id || current?.units?.[index]?.id || unit.name || unit.label, 'unit-' + (index + 1)),
    label: unit.name || unit.label || ('単位 ' + (index + 1)),
    days: unit.days,
  }));
  return _normalizeTimelineCalendarSystem({
    id: current?.builtIn ? '' : (current?.id || _timelineSafeCalendarId(name, 'custom-' + Date.now().toString(36))),
    name,
    eraLabel,
    epoch,
    weekdays,
    months,
    units,
    leapYear,
  });
}

function _showTimelineCalendarSystemModal(dbPath, cfg, ctx) {
  document.querySelectorAll('.tl-calendar-modal-overlay').forEach(el => el.remove());
  const systems = _timelineCalendarSystems(cfg);
  const customSystems = _timelineCustomCalendarSystems(cfg);
  let selectedId = systems.some(system => system.id === cfg?.calendarSystemId) ? cfg.calendarSystemId : TL_CALENDAR_SYSTEM_DEFAULT_ID;
  let draft = systems.find(system => system.id === selectedId) || _timelineDefaultCalendarSystems()[0];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay tl-calendar-modal-overlay';
  overlay.innerHTML = `<div class="modal tl-calendar-modal" role="dialog" aria-modal="true" aria-label="暦体系を編集">
    <h3>暦体系を編集</h3>
    <div class="tl-calendar-preset-row">
      <label>暦プリセット
        <span class="tl-calendar-preset-select-wrap">
          <select class="gb-select" data-tl-cal-existing data-e2e-id="timeline-calendar-preset-select">
            <option value="">新しい暦</option>
            ${systems.map(system => `<option value="${esc(system.id)}" ${selectedId === system.id ? 'selected' : ''}>${esc(system.name)}</option>`).join('')}
          </select>
        </span>
      </label>
      <div class="tl-calendar-preset-actions" aria-label="暦プリセット操作">
        <button type="button" class="gb-btn gb-btn-sm" data-tl-cal-action="new" aria-label="新しい暦を作成" title="新しい暦を作成">新規作成</button>
        <button type="button" class="gb-btn gb-btn-sm" data-tl-cal-action="copy" aria-label="選択中の暦を複製して作成" title="選択中の暦を複製して作成">複製作成</button>
        <button type="button" class="gb-btn gb-btn-sm" data-tl-cal-action="export" aria-label="選択中の暦をJSONファイルに出力" title="選択中の暦をJSONファイルに出力">JSON出力</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-tl-cal-action="delete" aria-label="選択中の暦を削除" title="保存済みの暦を選んだときだけ削除できます">選択中を削除</button>
      </div>
    </div>
    <div class="tl-calendar-top-grid">
      <div class="tl-calendar-fields">
        <label>暦<input type="text" data-tl-cal-field="name" class="gb-input"></label>
        <label>紀元<input type="text" data-tl-cal-field="era" class="gb-input"></label>
        <label>起点<input type="text" data-tl-cal-field="epoch" class="gb-input" placeholder="0001-01-01"></label>
      </div>
      <div class="tl-calendar-side-stack">
        <section class="tl-calendar-section tl-calendar-section--units">
          <div class="tl-calendar-section-head">
            <strong>単位</strong>
            <button type="button" class="gb-btn gb-btn-xs" data-tl-cal-add="units">単位を追加</button>
          </div>
          <div class="tl-calendar-list" data-tl-cal-list="units"></div>
        </section>
        <section class="tl-calendar-section tl-calendar-section--leap">
          <div class="tl-calendar-section-head">
            <strong>閏年</strong>
          </div>
          <label class="tl-calendar-check"><input type="checkbox" data-tl-cal-leap-enabled> 閏年を使う</label>
          <div class="tl-calendar-leap-fields">
            <label>何年ごと<input type="number" class="gb-input tl-number-input" min="1" step="1" data-tl-cal-leap-control data-tl-cal-leap-interval></label>
            <label>最初の年<input type="number" class="gb-input tl-number-input" min="1" step="1" data-tl-cal-leap-control data-tl-cal-leap-first-year></label>
            <label>増やす月<select class="gb-select" data-tl-cal-leap-control data-tl-cal-leap-month></select></label>
            <label>増える日数<input type="number" class="gb-input tl-number-input" min="1" step="1" data-tl-cal-leap-control data-tl-cal-leap-extra-days></label>
          </div>
        </section>
      </div>
    </div>
    <div class="tl-calendar-sections-grid">
    <section class="tl-calendar-section tl-calendar-section--months">
      <div class="tl-calendar-section-head">
        <strong>月</strong>
        <button type="button" class="gb-btn gb-btn-xs" data-tl-cal-add="months">月を追加</button>
      </div>
      <div class="tl-calendar-list" data-tl-cal-list="months"></div>
    </section>
    <section class="tl-calendar-section tl-calendar-section--weekdays">
      <div class="tl-calendar-section-head">
        <strong>曜日</strong>
        <button type="button" class="gb-btn gb-btn-xs" data-tl-cal-add="weekdays">曜日を追加</button>
      </div>
      <div class="tl-calendar-list" data-tl-cal-list="weekdays"></div>
    </section>
    </div>
    <div class="tl-calendar-actions">
      <button type="button" class="gb-btn gb-btn-sm" data-tl-cal-cancel>キャンセル</button>
      <button type="button" class="gb-btn gb-btn-sm gb-btn-primary" data-tl-cal-save>保存して適用</button>
    </div>
  </div>`;

  const fill = (system) => {
    draft = _normalizeTimelineCalendarSystem(system || _timelineDefaultCustomCalendarSystem());
    overlay.querySelector('[data-tl-cal-field="name"]').value = draft.name;
    overlay.querySelector('[data-tl-cal-field="era"]').value = draft.eraLabel || draft.name;
    overlay.querySelector('[data-tl-cal-field="epoch"]').value = draft.epoch;
    const leapYear = _normalizeTimelineCalendarLeapYear(draft.leapYear, draft.months || []);
    const leapEnabled = overlay.querySelector('[data-tl-cal-leap-enabled]');
    if (leapEnabled) leapEnabled.checked = leapYear.enabled;
    const leapInterval = overlay.querySelector('[data-tl-cal-leap-interval]');
    if (leapInterval) leapInterval.value = String(leapYear.interval);
    const leapFirstYear = overlay.querySelector('[data-tl-cal-leap-first-year]');
    if (leapFirstYear) leapFirstYear.value = String(leapYear.firstYear);
    const leapExtraDays = overlay.querySelector('[data-tl-cal-leap-extra-days]');
    if (leapExtraDays) leapExtraDays.value = String(leapYear.extraDays);
    _timelineCalendarFillRows(overlay, 'weekdays', draft.weekdays || [], (targetOverlay, listName, value) => {
      _timelineCalendarAppendNameRow(targetOverlay, listName, value);
    });
    _timelineCalendarFillRows(overlay, 'months', draft.months || [], (targetOverlay, listName, month) => {
      _timelineCalendarAppendLengthRow(targetOverlay, listName, month, { nameLabel: '月名', daysLabel: '日数' });
    });
    _timelineCalendarFillRows(overlay, 'units', (draft.units || []).filter(unit => !unit.baseScale), (targetOverlay, listName, unit) => {
      _timelineCalendarAppendLengthRow(targetOverlay, listName, unit, { nameLabel: '表示名', daysLabel: '日数' });
    });
    _timelineCalendarRefreshLeapMonthOptions(overlay, leapYear.monthIndex);
    _timelineCalendarSetLeapEnabled(overlay, leapYear.enabled);
  };

  const setPresetSelectValue = (value) => {
    const select = overlay.querySelector('[data-tl-cal-existing]');
    if (select) select.value = value || '';
  };

  const updatePresetActionStates = () => {
    const deleteButton = overlay.querySelector('[data-tl-cal-action="delete"]');
    if (!deleteButton) return;
    const canDelete = customSystems.some(system => system.id === selectedId);
    deleteButton.disabled = !canDelete;
    deleteButton.title = canDelete
      ? '選択中の暦を削除'
      : '保存済みの暦を選んだときだけ削除できます';
  };

  overlay.querySelector('[data-tl-cal-add="weekdays"]')?.addEventListener('click', () => {
    _timelineCalendarAppendNameRow(overlay, 'weekdays', '');
  });
  overlay.querySelector('[data-tl-cal-add="months"]')?.addEventListener('click', () => {
    _timelineCalendarAppendLengthRow(overlay, 'months', { name: '', days: 30 }, { nameLabel: '月名', daysLabel: '日数' });
    _timelineCalendarRefreshLeapMonthOptions(overlay);
  });
  overlay.querySelector('[data-tl-cal-add="units"]')?.addEventListener('click', () => {
    _timelineCalendarAppendLengthRow(overlay, 'units', { name: '', days: 1 }, { nameLabel: '表示名', daysLabel: '日数' });
  });
  overlay.querySelector('[data-tl-cal-leap-enabled]')?.addEventListener('change', (ev) => {
    _timelineCalendarSetLeapEnabled(overlay, !!ev.currentTarget.checked);
  });
  overlay.addEventListener('input', (ev) => {
    if (ev.target?.closest?.('[data-tl-cal-list="months"]')) _timelineCalendarRefreshLeapMonthOptions(overlay);
  });
  overlay.addEventListener('click', (ev) => {
    if (ev.target?.closest?.('[data-tl-cal-list="months"] .tl-calendar-row-remove')) {
      setTimeout(() => _timelineCalendarRefreshLeapMonthOptions(overlay), 0);
    }
  });

  overlay.querySelector('[data-tl-cal-existing]')?.addEventListener('change', (ev) => {
    selectedId = ev.currentTarget.value || '';
    fill(selectedId ? systems.find(system => system.id === selectedId) : _timelineDefaultCustomCalendarSystem());
    updatePresetActionStates();
  });
  const runPresetAction = async (action) => {
    if (action === 'new') {
      selectedId = '';
      setPresetSelectValue('');
      fill(_timelineDefaultCustomCalendarSystem());
      updatePresetActionStates();
      return;
    }
    if (action === 'copy') {
      const current = _timelineCalendarSystemFromModal(overlay, draft);
      selectedId = '';
      setPresetSelectValue('');
      fill({ ...current, id: 'custom-' + Date.now().toString(36), name: current.name + ' コピー' });
      updatePresetActionStates();
      return;
    }
    if (action === 'export') {
      const current = _timelineCalendarSystemFromModal(overlay, draft);
      _timelineExportCalendarPreset(current).catch(err => {
        if (typeof showStatus === 'function') showStatus('暦プリセットを出力できませんでした: ' + (err?.message || err), true);
      });
      return;
    }
    if (action === 'delete') {
      const deleteTarget = customSystems.find(system => system.id === selectedId);
      if (!deleteTarget) {
        updatePresetActionStates();
        return;
      }
      if (!await _timelineConfirmCalendarPresetDelete(deleteTarget)) return;
      const latestCfg = dbPath && typeof getTimelineConfig === 'function' ? getTimelineConfig(dbPath, { ctx }) : cfg;
      const nextSystems = _timelineCustomCalendarSystems(latestCfg).filter(system => system.id !== selectedId);
      const activeWasDeleted = String(latestCfg?.calendarSystemId || TL_CALENDAR_SYSTEM_DEFAULT_ID) === selectedId;
      setTimelineConfig(dbPath, {
        ...latestCfg,
        calendarSystemId: activeWasDeleted ? TL_CALENDAR_SYSTEM_DEFAULT_ID : (latestCfg?.calendarSystemId || TL_CALENDAR_SYSTEM_DEFAULT_ID),
        calendarSystems: nextSystems,
        scale: activeWasDeleted ? 'day' : latestCfg?.scale,
      }, {
        label: 'シート表示: 暦体系',
        detail: '削除: ' + deleteTarget.name,
        ctx,
      });
      overlay.remove();
      if (typeof renderTimeline === 'function') renderTimeline(ctx);
      if (typeof showStatus === 'function') showStatus('暦プリセットを削除しました: ' + deleteTarget.name);
    }
  };
  overlay.querySelectorAll('button[data-tl-cal-action]').forEach(button => {
    button.addEventListener('click', () => {
      runPresetAction(button.dataset.tlCalAction || '').catch(err => {
        if (typeof showStatus === 'function') showStatus('暦プリセット操作に失敗しました: ' + (err?.message || err), true);
      });
    });
  });
  overlay.querySelector('[data-tl-cal-cancel]')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', ev => {
    if (ev.target === overlay) overlay.remove();
  });
  overlay.querySelector('[data-tl-cal-save]')?.addEventListener('click', () => {
    const current = _timelineCalendarSystemFromModal(overlay, draft);
    const nextSystems = customSystems.filter(system => system.id !== current.id);
    nextSystems.push(current);
    const nextCfg = {
      ...cfg,
      calendarSystemId: current.id,
      calendarSystems: nextSystems,
      scale: _timelineDefaultScaleForCalendarSystem(current),
    };
    setTimelineConfig(dbPath, nextCfg, {
      label: 'シート表示: 暦体系',
      detail: current.name,
      ctx,
    });
    overlay.remove();
    renderTimeline(ctx);
  });

  document.body.appendChild(overlay);
  fill(draft);
  updatePresetActionStates();
  overlay.querySelector('[data-tl-cal-field="name"]')?.focus();
}
