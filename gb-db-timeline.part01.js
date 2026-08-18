/* タイムライン表示・依存矢印 — gb-db-views.js から分離 */

const TL_SCALES = [
  {value:'second',label:'秒'}, {value:'minute',label:'分'}, {value:'hour',label:'時間'},
  {value:'day',label:'日'}, {value:'week',label:'週'}, {value:'month',label:'月'},
  {value:'year',label:'年'}, {value:'decade',label:'十年'}, {value:'century',label:'百年'},
  {value:'millennium',label:'千年'}, {value:'ten_thousand',label:'万年'},
];

function getTimelineConfig(dbPath, options = {}) {
  const cfg = getCurrentDbViewTypeSpecific(dbPath, 'timeline', { ctx: options.ctx || null }) || {};
  return typeof _normalizeDbTimelineTypeSpecific === 'function'
    ? _normalizeDbTimelineTypeSpecific(cfg)
    : {
      timeProp: cfg.timeProp || '',
      endProp: cfg.endProp || '',
      rowProp: cfg.rowProp || '_entity',
      scale: cfg.scale || 'day',
      direction: cfg.direction || 'horizontal',
      displayStart: cfg.displayStart || '',
      displayEnd: cfg.displayEnd || '',
      timeStepMinutes: Math.max(1, Math.round(Number(cfg.timeStepMinutes || 1) || 1)),
      calendarSystemId: cfg.calendarSystemId || 'gregorian',
      showEntryName: cfg.showEntryName !== false,
      cardProps: Array.isArray(cfg.cardProps) ? cfg.cardProps : [],
      cardImageThumbCount: _normalizeDbCardImageThumbCount(cfg.cardImageThumbCount),
      cardPropLineCount: _normalizeDbCardPropLineCount(cfg.cardPropLineCount),
      calendarSystems: Array.isArray(cfg.calendarSystems) ? cfg.calendarSystems : [],
    };
}
function setTimelineConfig(dbPath, cfg, options = {}) {
  const label = options.historyLabel || options.label || '';
  const normalized = typeof _normalizeDbTimelineTypeSpecific === 'function'
    ? _normalizeDbTimelineTypeSpecific(cfg)
    : { ...(cfg || {}) };
  setCurrentDbViewTypeSpecific(dbPath, 'timeline', normalized, {
    ctx: options.ctx || null,
    historyLabel: label,
    detail: options.detail || '',
    skipHistory: options.skipHistory === true || !label,
  });
}

function _timelineColKey(col) {
  return String(col ?? '');
}

function _timelineColWidth(cfg, col) {
  const w = Number(cfg?.colWidths?.[_timelineColKey(col)]);
  const key = String(col ?? '');
  const defaultWidth = key.startsWith('@tlcal|') ? 150 : (/^\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}/.test(key) ? 86 : 120);
  return Number.isFinite(w) && w >= 60 ? Math.round(w) : defaultWidth;
}

function _timelineCornerWidth(cfg) {
  const w = Number(cfg?.colWidths?.__rowHeader);
  return Number.isFinite(w) && w >= 80 ? Math.round(w) : 120;
}

function _timelineMinWidthForCol(col) {
  return _timelineColKey(col) === '__rowHeader' ? 80 : 60;
}

function _timelineGridTemplate(cfg, cols) {
  return `${_timelineCornerWidth(cfg)}px ${cols.map(col => _timelineColWidth(cfg, col) + 'px').join(' ')}`;
}

function _setTimelineColWidth(dbPath, cfg, col, width, options = {}) {
  const base = dbPath ? getTimelineConfig(dbPath) : (cfg || {});
  const baseForContext = options.ctx && dbPath ? getTimelineConfig(dbPath, { ctx: options.ctx }) : base;
  const next = { ...baseForContext, colWidths: { ...(baseForContext.colWidths || {}) } };
  next.colWidths[_timelineColKey(col)] = Math.max(_timelineMinWidthForCol(col), Math.round(width || 120));
  setTimelineConfig(dbPath, next, {
    label: options.label || 'シート表示: タイムライン列幅',
    detail: options.detail || String(col || ''),
    skipHistory: options.skipHistory === true,
    ctx: options.ctx || null,
  });
}

function _bindTimelineColumnResize(th, grid, dbPath, cfg, cols, col, ctx) {
  const handle = document.createElement('span');
  handle.className = 'tl-col-resize-handle';
  handle.title = '列幅を調整';
  handle.draggable = false;
  handle.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    handle.setPointerCapture?.(ev.pointerId);
    const baseCfg = getTimelineConfig(dbPath);
    const ctxBaseCfg = getTimelineConfig(dbPath, { ctx });
    const startX = ev.clientX;
    const startWidth = _timelineColWidth(ctxBaseCfg, col);
    let nextWidth = startWidth;
    const onMove = (moveEv) => {
      nextWidth = Math.max(60, startWidth + moveEv.clientX - startX);
      const liveCfg = { ...ctxBaseCfg, colWidths: { ...(ctxBaseCfg.colWidths || {}), [_timelineColKey(col)]: nextWidth } };
      grid.style.gridTemplateColumns = _timelineGridTemplate(liveCfg, cols);
    };
    const onUp = (upEv) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      handle.releasePointerCapture?.(upEv.pointerId);
      _setTimelineColWidth(dbPath, baseCfg, col, nextWidth, { ctx });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  });
  handle.addEventListener('dblclick', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof autoFitTimelineColumn === 'function') {
      const ctx = typeof _dbPaneContextFromEvent === 'function'
        ? _dbPaneContextFromEvent(th, { dbPath })
        : (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
      autoFitTimelineColumn(ctx, dbPath, col);
      return;
    }
    const colIndex = th.dataset.colIndex;
    let width = th.scrollWidth + 18;
    grid.querySelectorAll(`[data-tl-col-index="${colIndex}"]`).forEach(el => {
      width = Math.max(width, el.scrollWidth + 18);
    });
    _setTimelineColWidth(dbPath, getTimelineConfig(dbPath), col, Math.min(Math.max(width, 80), 360), { detail: String(col || ''), ctx });
  });
  th.appendChild(handle);
}

function _timelineEntryPropValues(entry, propName, filterMode) {
  const mode = filterMode ?? entry?.filterMode;
  const vals = typeof filterValues === 'function' ? filterValues(entry.data?.[propName] || [], undefined, mode) : (entry.data?.[propName] || []);
  return vals || [];
}

function _timelineEntryPropDisplay(entry, propName, filterMode) {
  const vals = _timelineEntryPropValues(entry, propName, filterMode);
  return vals.map(v => v?.value ?? '').filter(v => String(v).trim()).join(', ');
}

function _timelineShowsEntryName(cfg) {
  return cfg?.showEntryName !== false;
}

function _normalizeDbCardImageThumbCount(value) {
  const n = Number(value == null || value === '' ? 3 : value);
  return Math.max(1, Math.min(12, Math.round(Number.isFinite(n) ? n : 3)));
}

function _normalizeDbCardPropLineCount(value) {
  const n = Number(value == null || value === '' ? 1 : value);
  return Math.max(1, Math.min(20, Math.round(Number.isFinite(n) ? n : 1)));
}

function _dbCardViewDisplayConfig(cfg = {}) {
  return {
    cardImageThumbCount: _normalizeDbCardImageThumbCount(cfg.cardImageThumbCount),
    cardPropLineCount: _normalizeDbCardPropLineCount(cfg.cardPropLineCount),
  };
}

function _appendDbCardDisplayNumberControl(root, labelText, value, options = {}) {
  const label = document.createElement('label');
  label.className = 'db-card-props-number-option';
  const text = document.createElement('span');
  text.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'gb-input db-card-props-number-input';
  input.min = String(options.min || 1);
  input.max = String(options.max || 20);
  input.step = '1';
  input.value = String(value);
  input.setAttribute('aria-label', labelText);
  let committedValue = String(value);
  const commit = () => {
    const normalize = options.normalize || ((v) => Math.max(1, Math.round(Number(v) || 1)));
    const next = normalize(input.value);
    const nextText = String(next);
    input.value = nextText;
    if (nextText === committedValue) return;
    committedValue = nextText;
    options.onChange?.(next);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    commit();
  });
  label.append(text, input);
  root.appendChild(label);
  return input;
}

function _appendDbCardDisplayControls(menu, cfg, onChange) {
  if (!menu) return;
  const current = _dbCardViewDisplayConfig(cfg);
  const section = document.createElement('div');
  section.className = 'db-card-props-settings';
  const title = document.createElement('div');
  title.className = 'db-card-props-settings-title';
  title.textContent = 'カード表示';
  section.appendChild(title);
  const save = (key, value, detail) => {
    current[key] = value;
    onChange?.({ ...current }, detail);
  };
  _appendDbCardDisplayNumberControl(section, '画像サムネ数', current.cardImageThumbCount, {
    max: 12,
    normalize: _normalizeDbCardImageThumbCount,
    onChange: value => save('cardImageThumbCount', value, '画像サムネ数'),
  });
  _appendDbCardDisplayNumberControl(section, '値の行数', current.cardPropLineCount, {
    max: 20,
    normalize: _normalizeDbCardPropLineCount,
    onChange: value => save('cardPropLineCount', value, '値の行数'),
  });
  menu.appendChild(section);
}

function _renderTimelineEntityContent(root, entry, cfg, options = {}) {
  root.innerHTML = '';
  const displayCfg = _dbCardViewDisplayConfig(cfg);
  root.style.setProperty('--db-card-prop-lines', String(displayCfg.cardPropLineCount));
  if (_timelineShowsEntryName(cfg)) {
    const title = document.createElement('div');
    title.className = options.titleClass || 'tl-card-title';
    title.textContent = entry.name;
    root.appendChild(title);
  }
  const cardProps = Array.isArray(cfg.cardProps) ? cfg.cardProps : [];
  const editable = options.editable && options.dbPath && typeof _entityPath === 'function';
  const propTypes = options.propTypes || {};
  const entityPath = editable ? _entityPath(options.dbPath, entry.name) : '';
  cardProps.forEach(propName => {
    const vals = _timelineEntryPropValues(entry, propName, options.filter);
    const displayVal = vals.map(v => v?.value ?? '').filter(v => String(v).trim()).join(', ');
    if (!displayVal) return;
    const row = document.createElement('div');
    row.className = 'tl-card-prop';
    const name = document.createElement('span');
    name.className = 'tl-card-prop-name';
    name.textContent = propName + ':';
    const value = document.createElement('span');
    value.className = 'tl-card-prop-value';
    if (propTypes[propName]?.type === 'image') value.classList.add('tl-card-prop-value--image');
    if (editable && typeof createTypedValueElement === 'function') {
      value.classList.add('tl-card-prop-value--editable');
      vals.forEach(val => {
        const valueEl = createTypedValueElement(val, entityPath, propName, options.thumbSize || 'small', propTypes[propName], {
          dbPath: options.dbPath,
          ctx: options.ctx || null,
          filter: options.filter,
          cardPreview: true,
          imagePreviewCount: displayCfg.cardImageThumbCount,
        });
        if (valueEl) value.appendChild(valueEl);
      });
      ['pointerdown', 'click', 'dblclick', 'dragstart'].forEach(type => {
        value.addEventListener(type, ev => ev.stopPropagation());
      });
    }
    if (!value.childNodes.length) {
      if (typeof _dbRichAppendValuePreview === 'function') _dbRichAppendValuePreview(value, vals);
      else value.textContent = displayVal;
    }
    row.appendChild(name);
    row.appendChild(value);
    root.appendChild(row);
  });
}

function _appendDbDisplayPropOption(menu, text, checked, options = {}) {
  const label = document.createElement('label');
  label.className = 'tl-card-prop-option';
  label.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!checked;
  cb.addEventListener('change', () => options.onToggle?.(cb.checked));
  const textEl = document.createElement('span');
  textEl.textContent = text;
  textEl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  label.appendChild(cb);
  label.appendChild(textEl);
  if (options.onMove) {
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'tl-card-prop-move';
    up.title = '上へ移動';
    up.setAttribute('aria-label', text + 'を上へ移動');
    up.disabled = !options.canMoveUp;
    up.innerHTML = typeof lucide === 'function' ? lucide('arrowUp', 12) : '↑';
    up.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      options.onMove(-1);
    });
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'tl-card-prop-move';
    down.title = '下へ移動';
    down.setAttribute('aria-label', text + 'を下へ移動');
    down.disabled = !options.canMoveDown;
    down.innerHTML = typeof lucide === 'function' ? lucide('arrowDown', 12) : '↓';
    down.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      options.onMove(1);
    });
    label.append(up, down);
  }
  menu.appendChild(label);
  return cb;
}

function _appendTimelineCardPropsOption(menu, text, checked, onChange) {
  return _appendDbDisplayPropOption(menu, text, checked, { onToggle: onChange });
}

function _showTimelineCardPropsMenu(anchor, dbPath, cfg, props, ctx) {
  document.querySelectorAll('.tl-card-props-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu tl-card-props-menu';
  menu.style.cssText = 'position:fixed;z-index:10000;min-width:220px;max-height:320px;overflow:auto;padding:6px;';
  let ordered = Array.isArray(cfg.cardProps) ? cfg.cardProps.filter(prop => props.includes(prop)) : [];
  let showEntryName = _timelineShowsEntryName(cfg);
  let { cardImageThumbCount, cardPropLineCount } = _dbCardViewDisplayConfig(cfg);
  const saveCardProps = (detail) => {
    setTimelineConfig(dbPath, { ...cfg, cardProps: ordered, showEntryName, cardImageThumbCount, cardPropLineCount }, {
      label: 'シート表示: タイムライン表示列',
      detail,
      ctx,
    });
    renderTimeline(ctx);
  };
  _appendDbDisplayPropOption(menu, 'エントリ名', showEntryName, {
    onToggle(checked) {
      showEntryName = checked;
      saveCardProps('エントリ名');
    },
  });
  _appendDbCardDisplayControls(menu, { cardImageThumbCount, cardPropLineCount }, (next, detail) => {
    cardImageThumbCount = next.cardImageThumbCount;
    cardPropLineCount = next.cardPropLineCount;
    saveCardProps(detail);
  });
  props.forEach(prop => {
    _appendDbDisplayPropOption(menu, prop, ordered.includes(prop), {
      canMoveUp: ordered.indexOf(prop) > 0,
      canMoveDown: ordered.indexOf(prop) >= 0 && ordered.indexOf(prop) < ordered.length - 1,
      onToggle(checked) {
        ordered = checked ? [...ordered, prop].filter((name, idx, arr) => arr.indexOf(name) === idx) : ordered.filter(name => name !== prop);
        saveCardProps(prop);
      },
      onMove(delta) {
        const idx = ordered.indexOf(prop);
        const nextIdx = idx + delta;
        if (idx < 0 || nextIdx < 0 || nextIdx >= ordered.length) return;
        [ordered[idx], ordered[nextIdx]] = [ordered[nextIdx], ordered[idx]];
        saveCardProps(prop);
      },
    });
  });
  document.body.appendChild(menu);
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(menu, {
      trigger: anchor,
      className: 'tl-card-props-menu-close',
      attr: 'data-tl-card-props-close',
    });
  }
  _positionTimelineCardPropsMenu(menu, anchor);
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function _positionTimelineCardPropsMenu(menu, anchor) {
  const rect = anchor?.getBoundingClientRect?.();
  if (!menu || !rect) return;
  if (typeof positionPopup === 'function') {
    positionPopup(menu, rect);
    return;
  }
  const z = typeof _getZoom === 'function' ? _getZoom() : 1;
  menu.style.left = (rect.left / z) + 'px';
  menu.style.top = (rect.bottom / z + 2) + 'px';
  if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
}

function _timelineDisplayViewMode(mode) {
  return ['calendar', 'tasks', 'shifts'].includes(mode) ? 'timeline' : (mode || 'timeline');
}

function _timelineNormalizeDisplayDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (typeof _timelineNormalizeDateText === 'function') return _timelineNormalizeDateText(text);
  const m = text.match(/^([+-]?\d{1,6})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return '';
  return `${_timelineYearLabel(Number(m[1]))}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

function _timelineDisplayInputType(cfg) {
  return ['second', 'minute', 'hour'].includes(String(cfg?.scale || '')) ? 'datetime-local' : 'date';
}

function _timelineDisplayInputValue(value, inputType) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (inputType === 'datetime-local') {
    const m = text.match(/^([+-]?\d{1,6})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (!m) return '';
    return `${_timelineYearLabel(Number(m[1]))}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}T${String(Number(m[4] || 0)).padStart(2, '0')}:${String(Number(m[5] || 0)).padStart(2, '0')}`;
  }
  return _timelineNormalizeDisplayDate(text);
}

function _timelineUsesCustomCalendarInputs(calendarSystem) {
  return !!calendarSystem
    && String(calendarSystem.id || '') !== 'gregorian'
    && typeof _timelineCalendarInputState === 'function'
    && typeof _timelineCalendarDateValueFromParts === 'function'
    && typeof _timelineCalendarMonthOptionsHtml === 'function';
}

function _timelineCustomCalendarDateInputHtml(id, label, value, inputType, calendarSystem) {
  const state = _timelineCalendarInputState(calendarSystem, value);
  const withTime = inputType === 'datetime-local';
  const hiddenValue = value ? _timelineDisplayInputValue(value, inputType) : '';
  const timeHtml = withTime
    ? `<input type="time" class="gb-input tl-calendar-date-time" value="${esc(state.time)}" data-e2e-id="${esc(id)}-calendar-time" data-tl-calendar-date-part="time" data-tl-calendar-date-target="${esc(id)}">`
    : '';
  return `<label class="tl-calendar-date-field">${esc(label)}
    <span class="tl-calendar-date-controls" data-tl-calendar-date-controls="${esc(id)}">
      <input type="number" class="gb-input tl-number-input tl-calendar-date-year" min="1" step="1" value="${esc(state.year)}" aria-label="${esc(label)} 年" data-e2e-id="${esc(id)}-calendar-year" data-tl-calendar-date-part="year" data-tl-calendar-date-target="${esc(id)}">
      <select class="gb-select tl-calendar-date-month" aria-label="${esc(label)} 月" data-e2e-id="${esc(id)}-calendar-month" data-tl-calendar-date-part="month" data-tl-calendar-date-target="${esc(id)}">${_timelineCalendarMonthOptionsHtml(calendarSystem, state.monthIndex)}</select>
      <input type="number" class="gb-input tl-number-input tl-calendar-date-day" min="1" max="${esc(state.maxDay)}" step="1" value="${esc(state.day)}" aria-label="${esc(label)} 日" data-e2e-id="${esc(id)}-calendar-day" data-tl-calendar-date-part="day" data-tl-calendar-date-target="${esc(id)}">
      ${timeHtml}
    </span>
    <input type="hidden" id="${esc(id)}" value="${esc(hiddenValue)}" data-tl-calendar-date-hidden="1">
  </label>`;
}

function _timelineSyncCustomCalendarDateInput(settings, targetId, calendarSystem, inputType) {
  const hidden = settings.querySelector('#' + targetId);
  const controls = settings.querySelector(`[data-tl-calendar-date-controls="${targetId}"]`);
  if (!hidden || !controls) return;
  const year = Number(controls.querySelector('[data-tl-calendar-date-part="year"]')?.value || 1);
  const month = Number(controls.querySelector('[data-tl-calendar-date-part="month"]')?.value || 0);
  const dayInput = controls.querySelector('[data-tl-calendar-date-part="day"]');
  const day = Number(dayInput?.value || 1);
  const time = controls.querySelector('[data-tl-calendar-date-part="time"]')?.value || '';
  const nextValue = _timelineCalendarDateValueFromParts(calendarSystem, year, month, day, inputType === 'datetime-local' ? time : '');
  hidden.value = _timelineDisplayInputValue(nextValue, inputType);
  const state = _timelineCalendarInputState(calendarSystem, nextValue);
  if (dayInput) {
    dayInput.max = String(state.maxDay);
    if (Number(dayInput.value || 1) > state.maxDay) dayInput.value = String(state.maxDay);
  }
}

function _timelineDateTimeTextToMinute(value) {
  const comparable = typeof _dbDateGetComparableValue === 'function' ? _dbDateGetComparableValue(value) : value;
  const text = String(comparable || '').trim();
  const m = text.match(/^([+-]?\d{1,6})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return null;
  const date = new Date(Date.UTC(0, Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)));
  date.setUTCFullYear(Number(m[1]));
  return Math.floor(date.getTime() / 60000);
}

function _timelineMinuteToDateTimeValue(minuteNumber) {
  const date = new Date(Math.trunc(minuteNumber) * 60000);
  return `${_timelineDatePartsToValue(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())}T${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function _timelineTimeStepMinutes(cfg) {
  const step = Number(cfg?.timeStepMinutes || 1);
  return Math.max(1, Math.min(1440, Math.round(Number.isFinite(step) ? step : 1)));
}

function _timelineRoundConfiguredTimeValue(value, cfg, fallbackRound) {
  const base = fallbackRound(value);
  if (String(cfg?.scale || '') !== 'minute') return base;
  const step = _timelineTimeStepMinutes(cfg);
  if (step <= 1) return base;
  const minute = _timelineDateTimeTextToMinute(value);
  if (minute == null) return base;
  return _timelineMinuteToDateTimeValue(Math.floor(minute / step) * step);
}

function _timelineDisplayGroupLabel(value, cfg) {
  const text = String(value ?? '');
  if (String(cfg?.scale || '') !== 'minute') {
    return typeof _timelineDisplayGroupValue === 'function'
      ? _timelineDisplayGroupValue(text)
      : text;
  }
  const m = text.match(/^([+-]?\d{1,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return text;
  const start = _timelineDisplayInputValue(cfg?.displayStart, 'datetime-local');
  const startDate = start.includes('T') ? start.split('T')[0] : '';
  const currentDate = `${m[1]}-${m[2]}-${m[3]}`;
  const time = `${m[4]}:${m[5]}`;
  return startDate && currentDate !== startDate ? `${m[2]}-${m[3]} ${time}` : time;
}

function _timelineDisplayDateToDayNumber(value) {
  const text = _timelineNormalizeDisplayDate(value);
  if (!text) return null;
  if (typeof _timelineDateTextToDayNumber === 'function') return _timelineDateTextToDayNumber(text);
  const m = text.match(/^([+-]?\d{1,6})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const date = new Date(Date.UTC(0, Number(m[2]) - 1, Number(m[3])));
  date.setUTCFullYear(Number(m[1]));
  return Math.floor(date.getTime() / 86400000);
}

function _timelineDayNumberToDisplayDate(dayNumber) {
  if (typeof _timelineDayNumberToDateValue === 'function') return _timelineDayNumberToDateValue(dayNumber);
  const date = new Date(Math.trunc(dayNumber) * 86400000);
  return _timelineDatePartsToValue(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function _timelineExplicitRangeGroups(cfg, roundTimelineValue) {
  if (String(cfg?.scale || '') === 'minute') {
    let startMinute = _timelineDateTimeTextToMinute(cfg?.displayStart);
    let endMinute = _timelineDateTimeTextToMinute(cfg?.displayEnd);
    if (startMinute == null || endMinute == null) return [];
    if (endMinute < startMinute) [startMinute, endMinute] = [endMinute, startMinute];
    const step = _timelineTimeStepMinutes(cfg);
    const maxSteps = 5000;
    const groups = new Set();
    for (let minute = startMinute, scanned = 0; minute <= endMinute && scanned <= maxSteps; minute += step, scanned += 1) {
      const group = roundTimelineValue(_timelineMinuteToDateTimeValue(minute));
      if (group) groups.add(group);
    }
    const endGroup = roundTimelineValue(_timelineMinuteToDateTimeValue(endMinute));
    if (endGroup) groups.add(endGroup);
    return Array.from(groups).sort(_compareTimelineGroupValues);
  }
  let startDay = _timelineDisplayDateToDayNumber(cfg?.displayStart);
  let endDay = _timelineDisplayDateToDayNumber(cfg?.displayEnd);
  if (startDay == null || endDay == null) return [];
  if (endDay < startDay) [startDay, endDay] = [endDay, startDay];
  const maxDays = 5000;
  const groups = new Set();
  for (let day = startDay, scanned = 0; day <= endDay && scanned <= maxDays; day += 1, scanned += 1) {
    const group = roundTimelineValue(_timelineDayNumberToDisplayDate(day));
    if (group) groups.add(group);
  }
  const endGroup = roundTimelineValue(_timelineDayNumberToDisplayDate(endDay));
  if (endGroup) groups.add(endGroup);
  return Array.from(groups).sort(_compareTimelineGroupValues);
}

function _captureTimelineViewState(ctx, dbPath) {
  const currentMode = (dbPath && typeof getCurrentViewMode === 'function')
    ? getCurrentViewMode(dbPath, { ctx })
    : (ctx?.viewMode || 'timeline');
  const targetStateView = ['calendar', 'tasks', 'shifts'].includes(currentMode) ? 'timeline' : (currentMode || 'timeline');
  return {
    dbPath,
    currentViewIdx: Number.isInteger(ctx?.currentViewIdx) ? ctx.currentViewIdx : ((dbPath && typeof getCurrentViewIdx === 'function') ? getCurrentViewIdx(dbPath) : null),
    viewMode: currentMode || 'timeline',
    stateView: targetStateView,
  };
}

function _restoreTimelineViewState(snapshot, ctx) {
  if (!snapshot?.dbPath || typeof state === 'undefined') return;
  if (state.currentDbPath !== snapshot.dbPath) return;
  if (Number.isInteger(snapshot.currentViewIdx) && typeof setCurrentViewIdx === 'function') {
    setCurrentViewIdx(snapshot.dbPath, snapshot.currentViewIdx, { skipHistory: true });
  }
  const mode = snapshot.viewMode || 'timeline';
  if (ctx && ctx.dbPath === snapshot.dbPath) ctx.viewMode = mode;
  state.view = ['calendar', 'tasks', 'shifts'].includes(mode) ? 'timeline' : mode;
  if (typeof showView === 'function') showView(_timelineDisplayViewMode(mode), ctx);
  if (typeof renderDbViewTabs === 'function') renderDbViewTabs(ctx);
}

async function _openTimelineEntityInSubpanel(ctx, dbPath, entityName) {
  const snapshot = _captureTimelineViewState(ctx, dbPath);
  let result = false;
  try {
    if (typeof openEntityInSplit === 'function') {
      result = await openEntityInSplit(_entityPath(dbPath, entityName), entityName);
    }
  } finally {
    const restore = () => _restoreTimelineViewState(snapshot, ctx);
    if (typeof queueMicrotask === 'function') queueMicrotask(restore);
    else Promise.resolve().then(restore);
    setTimeout(restore, 0);
  }
  return result;
}

function _queueTimelineEntitySingleClick(el, ctx, dbPath, entityName) {
  if (!el) return;
  if (el._tlSingleClickTimer) clearTimeout(el._tlSingleClickTimer);
  el._tlSingleClickTimer = setTimeout(() => {
    el._tlSingleClickTimer = null;
    void _openTimelineEntityInSubpanel(ctx, dbPath, entityName);
  }, 180);
}

function _cancelTimelineEntitySingleClick(el) {
  if (!el?._tlSingleClickTimer) return;
  clearTimeout(el._tlSingleClickTimer);
  el._tlSingleClickTimer = null;
}

function renderTimeline(ctx) {
  ctx = ctx || _currentPaneState();
  const data = ctx.pivotData || state.pivotData;
  const container = typeof _dbViewSurfaceEl === 'function'
    ? _dbViewSurfaceEl(ctx, '.timeline-view', 'timeline-view')
    : ((ctx?.containerEl ? ctx.containerEl.querySelector('.timeline-view') : null) || document.getElementById('timeline-view') || document.querySelector('.timeline-view'));
  if (!container) {
    if (typeof showStatus === 'function') showStatus('シートのタイムライン表示領域を準備できませんでした。シートを開き直してください。', true);
    return;
  }
  container.style.display = '';
  if (!data || !data.entities) { container.innerHTML = ''; return; }
  const dbPath = ctx.dbPath || state.currentDbPath;
  if (typeof syncDbCellDisplayToolbar === 'function') syncDbCellDisplayToolbar(dbPath);

  // カレンダーソースDBの場合はカレンダーモードに分岐
  if (typeof _canRenderCalendarFromDb === 'function' && _canRenderCalendarFromDb(dbPath, data, ctx) && typeof renderCalendar === 'function') {
    const viewMode = typeof _getActiveCalendarViewMode === 'function'
      ? _getActiveCalendarViewMode(dbPath, data, ctx)
      : getCurrentViewMode(dbPath, { ctx });
    if (viewMode === 'calendar') {
      renderCalendar(ctx);
      return;
    }
    if (typeof showCalendarDetailTabs === 'function') showCalendarDetailTabs(false);
    const previewPane = document.getElementById('gb-preview-pane');
    if (previewPane && previewPane.closest('.gb-pane-content')) {
      previewPane.innerHTML = '';
      delete previewPane.dataset.previewMode;
    }
  }

  let cfg = getTimelineConfig(dbPath, { ctx });
  const calendarSystem = typeof _timelineActiveCalendarSystem === 'function'
    ? _timelineActiveCalendarSystem(cfg)
    : null;
  const timelineScale = calendarSystem && typeof _timelineResolveScaleForCalendarSystem === 'function'
    ? _timelineResolveScaleForCalendarSystem(cfg, calendarSystem)
    : cfg.scale;
  if (timelineScale && timelineScale !== cfg.scale) cfg = { ...cfg, scale: timelineScale };
  const entitiesMap = data.entities;
  const entityNames = typeof _dbSortedEntityNames === 'function'
    ? _dbSortedEntityNames(data, dbPath, ctx, { applyAdvancedFilters: true })
    : Object.keys(entitiesMap).sort();
  const props = Array.isArray(data.properties) ? data.properties : [];
  const propTypes = getPropertyTypes(dbPath);
  const schemaProps = Object.keys(propTypes || {});
  const timelineProps = Array.from(new Set([...props, ...schemaProps, cfg.timeProp, cfg.endProp, cfg.rowProp].filter(p => p && p !== '_entity')));
  const dateProps = timelineProps.filter(p => (propTypes?.[p]?.type || '') === 'date');
  if (cfg.timeProp && !dateProps.includes(cfg.timeProp)) cfg = { ...cfg, timeProp: '' };
  if (cfg.endProp && !dateProps.includes(cfg.endProp)) cfg = { ...cfg, endProp: '' };
  const timePropOptions = dateProps.length
    ? `<option value="" ${!cfg.timeProp?'selected':''}>(未設定)</option>`
      + dateProps.map(p => `<option value="${esc(p)}" ${cfg.timeProp===p?'selected':''}>${esc(p)}</option>`).join('')
    : '<option value="">(日時列なし)</option>';
  const endPropOptions = dateProps.map(p => `<option value="${esc(p)}" ${cfg.endProp===p?'selected':''}>${esc(p)}</option>`).join('');

  container.innerHTML = '';

  // 設定バー
  const settings = document.createElement('div');
  settings.className = 'tl-settings';
  const displayInputType = _timelineDisplayInputType(cfg);
  const displayStartValue = _timelineDisplayInputValue(cfg.displayStart, displayInputType);
  const displayEndValue = _timelineDisplayInputValue(cfg.displayEnd, displayInputType);
  const calendarName = calendarSystem?.name || 'グレゴリオ暦';
  const customCalendarInputs = _timelineUsesCustomCalendarInputs(calendarSystem);
  const displayStartHtml = customCalendarInputs
    ? _timelineCustomCalendarDateInputHtml('tl-display-start', '表示開始', cfg.displayStart, displayInputType, calendarSystem)
    : `<label>表示開始: <input type="${displayInputType}" id="tl-display-start" class="gb-input tl-date-input" value="${esc(displayStartValue)}"></label>`;
  const displayEndHtml = customCalendarInputs
    ? _timelineCustomCalendarDateInputHtml('tl-display-end', '表示終了', cfg.displayEnd, displayInputType, calendarSystem)
    : `<label>表示終了: <input type="${displayInputType}" id="tl-display-end" class="gb-input tl-date-input" value="${esc(displayEndValue)}"></label>`;
  const timeStepStyle = cfg.scale === 'minute' ? '' : ' style="display:none"';

  // 時間軸プロパティ
  settings.innerHTML = `
    <label>開始日時: <select id="tl-time-prop" class="gb-select">${timePropOptions}</select></label>
    <label>終了日時: <select id="tl-end-prop" class="gb-select">
      <option value="" ${!cfg.endProp?'selected':''}>(なし)</option>
      ${endPropOptions}
    </select></label>
    <label>行/列軸: <select id="tl-row-prop" class="gb-select">
      <option value="_entity" ${cfg.rowProp==='_entity'?'selected':''}>エントリ名</option>
      ${timelineProps.map(p => `<option value="${esc(p)}" ${cfg.rowProp===p?'selected':''}>${esc(p)}</option>`).join('')}
    </select></label>
    ${displayStartHtml}
    ${displayEndHtml}
    <button type="button" id="tl-calendar-open" class="tl-nav-btn" title="暦プリセットと暦体系を編集">暦: ${esc(calendarName)}</button>
    <label>単位: <select id="tl-scale" class="gb-select">${typeof _timelineScaleOptionsHtml === 'function' ? _timelineScaleOptionsHtml(calendarSystem, cfg.scale) : TL_SCALES.map(s => `<option value="${s.value}" ${cfg.scale===s.value?'selected':''}>${s.label}</option>`).join('')}</select></label>
    <label${timeStepStyle}>時間間隔(分): <input type="number" id="tl-time-step-minutes" class="gb-input tl-number-input tl-step-input" min="1" max="1440" step="1" value="${esc(_timelineTimeStepMinutes(cfg))}"></label>
    <label>方向: <select id="tl-direction" class="gb-select">
      <option value="horizontal" ${cfg.direction==='horizontal'?'selected':''}>→ 横方向（時間が右）</option>
      <option value="vertical" ${cfg.direction==='vertical'?'selected':''}>↓ 縦方向（時間が下）</option>
    </select></label>
    <button type="button" id="tl-card-props" class="tl-nav-btn" title="カードに表示する列">${lucide('listPlus', 12)} 表示列 ${Array.isArray(cfg.cardProps) && cfg.cardProps.length ? '(' + cfg.cardProps.length + ')' : ''}</button>
  `;
  container.appendChild(settings);
  settings.querySelector('#tl-card-props')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    _showTimelineCardPropsMenu(ev.currentTarget, dbPath, cfg, props, ctx);
  });
  settings.querySelector('#tl-calendar-open')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof _showTimelineCalendarSystemModal === 'function') _showTimelineCalendarSystemModal(dbPath, cfg, ctx);
  });

  const applyTimelineSettingsChange = (el) => {
    if (customCalendarInputs) {
      _timelineSyncCustomCalendarDateInput(settings, 'tl-display-start', calendarSystem, displayInputType);
      _timelineSyncCustomCalendarDateInput(settings, 'tl-display-end', calendarSystem, displayInputType);
    }
    setTimelineConfig(dbPath, {
      ...cfg,
      timeProp: settings.querySelector('#tl-time-prop').value,
      endProp: settings.querySelector('#tl-end-prop').value,
      rowProp: settings.querySelector('#tl-row-prop').value,
      displayStart: settings.querySelector('#tl-display-start')?.value || '',
      displayEnd: settings.querySelector('#tl-display-end')?.value || '',
      timeStepMinutes: _timelineTimeStepMinutes({ timeStepMinutes: settings.querySelector('#tl-time-step-minutes')?.value || cfg.timeStepMinutes || 1 }),
      scale: settings.querySelector('#tl-scale').value,
      direction: settings.querySelector('#tl-direction').value,
    }, {
      label: 'シート表示: タイムライン設定',
      detail: el?.closest('label')?.textContent?.split(':')[0]?.trim() || '',
      ctx,
    });
    renderTimeline(ctx);
  };

  // 設定変更イベント
  ['tl-time-prop','tl-end-prop','tl-row-prop','tl-display-start','tl-display-end','tl-scale','tl-time-step-minutes','tl-direction'].forEach(id => {
    const el = settings.querySelector('#' + id);
    if (el && !el.dataset.tlCalendarDateHidden) el.onchange = () => applyTimelineSettingsChange(el);
  });
  settings.querySelectorAll('[data-tl-calendar-date-target]').forEach(el => {
    el.addEventListener('change', () => applyTimelineSettingsChange(el));
  });

  // 時間値をグループ化（スケールに応じて丸める）
  const baseRoundTimelineValue = (value) => typeof _timelineRoundTimeValue === 'function'
    ? _timelineRoundTimeValue(value, cfg)
    : roundTimeValue(value, cfg.scale);
  const roundTimelineValue = (value) => _timelineRoundConfiguredTimeValue(value, cfg, baseRoundTimelineValue);
  const displayTimelineGroup = (value) => _timelineDisplayGroupLabel(value, cfg);
  const explicitTimeArr = _timelineExplicitRangeGroups(cfg, roundTimelineValue);

  if (entityNames.length === 0 && explicitTimeArr.length === 0) {
    const emptyHost = document.createElement('div');
    container.appendChild(emptyHost);
    if (typeof _dbRenderEmptyStateWithCreate === 'function') {
      _dbRenderEmptyStateWithCreate(emptyHost, 'clock', 'エントリがありません', '表示開始と表示終了を入れると、カレンダーだけを先に表示できます。', ctx);
    } else if (typeof renderEmptyState === 'function') {
      renderEmptyState(emptyHost, 'clock', 'エントリがありません', '表示開始と表示終了を入れると、カレンダーだけを先に表示できます。');
    } else {
      emptyHost.innerHTML = '<div style="padding:24px;color:var(--fg2);">エントリがありません。表示開始と表示終了を入れると、カレンダーだけを先に表示できます。</div>';
    }
    return;
  }

  if (entityNames.length > 0 && !cfg.timeProp) {
    container.insertAdjacentHTML('beforeend', '<div style="padding:24px;color:var(--fg2);">時間軸の列を選択してください</div>');
    return;
  }

  // データ収集: 各エントリの時間値と行値を取得
  const entries = [];
  if (cfg.timeProp) entityNames.forEach(name => {
    const ed = entitiesMap[name];
    const timeVals = filterValues(ed[cfg.timeProp] || [], undefined, ctx?.filter);
    const rawTimeVal = timeVals.length > 0 ? timeVals[0].value : '';
    const timeParsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(rawTimeVal) : null;
    const timeVal = timeParsed?.range ? (timeParsed.start || rawTimeVal) : rawTimeVal;
    let endVal = '';
    if (cfg.endProp) {
      const endVals = filterValues(ed[cfg.endProp] || [], undefined, ctx?.filter);
      const rawEndVal = endVals.length > 0 ? endVals[0].value : '';
      if (cfg.endProp === cfg.timeProp && timeParsed?.range) endVal = timeParsed.end || '';
      else endVal = typeof _dbDateGetComparableValue === 'function'
        ? _dbDateGetComparableValue(rawEndVal, true)
        : rawEndVal;
    } else if (timeParsed?.range) {
      endVal = timeParsed.end || '';
    }
    let rowVal = name;
    if (cfg.rowProp && cfg.rowProp !== '_entity') {
      const rv = filterValues(ed[cfg.rowProp] || [], undefined, ctx?.filter);
      rowVal = rv.length > 0 ? rv[0].value : '(未設定)';
    }
    if (timeVal) entries.push({ name, timeVal, endVal, rowVal, data: ed, filterMode: ctx?.filter });
  });

  const timeGroups = new Set(explicitTimeArr);
  const rowGroups = new Set();
  entries.forEach(e => {
    timeGroups.add(roundTimelineValue(e.timeVal));
    if (e.endVal) timeGroups.add(roundTimelineValue(e.endVal));
    rowGroups.add(e.rowVal);
  });
  const timeArrBase = [...timeGroups].sort(_compareTimelineGroupValues);
  const timeArr = typeof _applyTimelineTimeOrder === 'function' ? _applyTimelineTimeOrder(timeArrBase, cfg) : timeArrBase;
  const rowArrBase = entries.length > 0 ? [...rowGroups].sort(_compareTimelineGroupValues) : ['カレンダー'];
  const rowArr = _applyTimelineRowOrder(rowArrBase, cfg);

  if (timeArr.length === 0 || rowArr.length === 0) {
    container.insertAdjacentHTML('beforeend', '<div style="padding:24px;color:var(--fg2);">データがありません</div>');
    return;
  }

  // グリッド生成
  const isHorizontal = cfg.direction === 'horizontal';
  const cols = isHorizontal ? timeArr : rowArr;
  const rows = isHorizontal ? rowArr : timeArr;
  const axisColors = typeof _getTimelineAxisColorMap === 'function' ? _getTimelineAxisColorMap(dbPath, ctx) : {};

  const grid = document.createElement('div');
  grid.className = 'tl-grid';
  grid.style.gridTemplateColumns = _timelineGridTemplate(cfg, cols);
  if (typeof _dbCellDisplayConfig === 'function') {
    const display = _dbCellDisplayConfig(dbPath);
    grid.dataset.cellOverflow = display.overflow;
    grid.dataset.cellWrapLines = String(display.lines);
    grid.style.setProperty('--db-cell-wrap-lines', String(display.lines));
  }

  // コーナーセル
  const corner = document.createElement('div');
  corner.className = 'tl-header-cell tl-corner';
  const cornerLabel = isHorizontal ? (cfg.rowProp === '_entity' ? 'エントリ' : cfg.rowProp) : cfg.timeProp;
  if (typeof _setupTimelineHeaderCell === 'function') _setupTimelineHeaderCell(corner, cornerLabel, { dbPath, cfg, ctx, isCorner: true, kind: 'corner', axisValues: rowArr, timeValues: timeArr }, axisColors);
  else corner.textContent = cornerLabel;
  corner.style.gridRow = '1'; corner.style.gridColumn = '1';
  grid.appendChild(corner);

  // 列ヘッダー
  cols.forEach((col, ci) => {
    const th = document.createElement('div');
    th.className = 'tl-header-cell tl-col-header';
    const headerKind = isHorizontal ? 'time' : 'axis';
    const colLabel = headerKind === 'time' ? displayTimelineGroup(col) : col;
    if (typeof _setupTimelineHeaderCell === 'function') _setupTimelineHeaderCell(th, colLabel, { dbPath, cfg, ctx, value: col, kind: headerKind, axisValues: rowArr, timeValues: timeArr }, axisColors);
    else th.textContent = colLabel;
    th.style.gridRow = '1'; th.style.gridColumn = (ci + 2) + '';
    th.dataset.colIndex = String(ci);
    th.dataset.tlColIndex = String(ci);
    th.dataset.tlValue = String(col);
    th.title = String(col);
    if (!isHorizontal) _bindTimelineHeaderReorder(th, dbPath, cfg, rowArr, col, ctx);
    _bindTimelineColumnResize(th, grid, dbPath, cfg, cols, col, ctx);
    grid.appendChild(th);
  });

  // 行
  rows.forEach((row, ri) => {
    // 行ヘッダー
    const rh = document.createElement('div');
    rh.className = 'tl-header-cell tl-row-header';
    const rowHeaderKind = isHorizontal ? 'axis' : 'time';
    const rowLabel = rowHeaderKind === 'time' ? displayTimelineGroup(row) : row;
    if (typeof _setupTimelineHeaderCell === 'function') _setupTimelineHeaderCell(rh, rowLabel, { dbPath, cfg, ctx, value: row, kind: rowHeaderKind, isRowHeader: true, axisValues: rowArr, timeValues: timeArr }, axisColors);
    else rh.textContent = rowLabel;
    rh.style.gridRow = (ri + 2) + ''; rh.style.gridColumn = '1';
    rh.dataset.tlValue = String(row);
    rh.title = String(row);
    if (isHorizontal) _bindTimelineHeaderReorder(rh, dbPath, cfg, rowArr, row, ctx);
    grid.appendChild(rh);

    // セル
    cols.forEach((col, ci) => {
      const cell = document.createElement('div');
      cell.className = 'tl-cell';
      cell.style.gridRow = (ri + 2) + ''; cell.style.gridColumn = (ci + 2) + '';
      cell.dataset.row = row; cell.dataset.col = col;
      cell.dataset.tlColIndex = String(ci);
      if (typeof _applyTimelineVisibleColor === 'function') _applyTimelineVisibleColor(cell, axisColors, isHorizontal ? row : col, isHorizontal ? col : row);

      // D&D: ドロップ先
      cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', async (e) => {
        e.preventDefault(); cell.classList.remove('drag-over');
        const entName = e.dataTransfer.getData('text/x-timeline-entity');
        if (!entName) return;
        const newTimeGroup = isHorizontal ? col : row;
        const newRow = isHorizontal ? row : col;
        // 時間値を更新（採用値のみを対象にする。先頭が案/ボツ候補だった場合に破壊しないため）
        const ed = entitiesMap[entName];
        const pickAdopted = (arr) => {
          const a = arr || [];
          return typeof filterValues === 'function'
            ? filterValues(a, '採用')[0]
            : a.find(v => (v?.status || '採用') === '採用');
        };
        const valueRef = (val) => val ? {
          file: val.file,
          property: val.property,
          candidate_index: val.candidate_index,
          value: val.value || '',
        } : null;
        const appliedWrites = [];
        const putTimelineValue = async (val, newValue) => {
          const ref = valueRef(val);
          if (!ref) return null;
          await _apiPutValue(ref, { new_value: newValue });
          appliedWrites.push({ kind: 'put', ref, oldValue: val.value || '' });
          return ref;
        };
        const postTimelineValue = async (entityPath, propName, value) => {
          const res = await _apiPostValue(entityPath, propName, value, '採用', '');
          const ref = {
            file: res?.path,
            property: res?.property || propName,
            candidate_index: res?.candidate_index,
            value,
          };
          if (ref.file) appliedWrites.push({ kind: 'create', ref });
          return ref.file ? ref : null;
        };
        const rollbackTimelineWrites = async () => {
          for (let i = appliedWrites.length - 1; i >= 0; i -= 1) {
            const op = appliedWrites[i];
            try {
              if (op.kind === 'create') await _apiPutValue(op.ref, { _delete: true });
              else await _apiPutValue(op.ref, { new_value: op.oldValue });
            } catch {}
          }
        };

        const tv = pickAdopted(ed[cfg.timeProp]);
        const oldTime = tv ? (tv.value || '') : '';
        const timePtc = propTypes[cfg.timeProp] || {};
        const newTime = typeof _timelineValueForDropTarget === 'function'
          ? _timelineValueForDropTarget(oldTime, newTimeGroup, cfg.scale, timePtc)
          : newTimeGroup;
        const oldTimeParsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(oldTime) : null;
        const endUsesTimeProp = !!cfg.endProp && cfg.endProp === cfg.timeProp;
        const useRangeInTimeProp = (!cfg.endProp || endUsesTimeProp) && oldTimeParsed?.range;
        let newTimeValue = newTime;
        if (useRangeInTimeProp && typeof _dbDateSerializeValue === 'function') {
          const diff = _calcDateDiff(oldTimeParsed.start || oldTime, newTime, cfg.scale);
          const shiftedEnd = oldTimeParsed.end ? _shiftDate(oldTimeParsed.end, diff, cfg.scale) : '';
          newTimeValue = _dbDateSerializeValue(newTime, shiftedEnd, timePtc, oldTime);
        }
        let oldRow = '';
        let rvRef = null;
        let rowValueWasCreated = false;
        const rv2 = (cfg.rowProp && cfg.rowProp !== '_entity') ? pickAdopted(ed[cfg.rowProp]) : null;
        let oldEnd = '', newEnd = '';
        const ev3 = (cfg.endProp && !endUsesTimeProp) ? pickAdopted(ed[cfg.endProp]) : null;
        const currentRowValue = rv2 ? (rv2.value || '') : ((cfg.rowProp && cfg.rowProp !== '_entity') ? '(未設定)' : newRow);
        const previewEnd = (ev3 && oldTime && ev3.value)
          ? _shiftDate(ev3.value || '', _calcDateDiff(oldTime, newTime, cfg.scale), cfg.scale)
          : '';
        const noTimeChange = !tv || newTimeValue === oldTime;
        const noRowChange = !(cfg.rowProp && cfg.rowProp !== '_entity') || currentRowValue === newRow;
        const noEndChange = !ev3 || !oldTime || !ev3.value || previewEnd === ev3.value;
        if (noTimeChange && noRowChange && noEndChange) return;
        let tvRef = null;
        let evRef = null;
        try {
          if (tv) tvRef = await putTimelineValue(tv, newTimeValue);
          if (rv2) {
            oldRow = rv2.value || '';
            rvRef = await putTimelineValue(rv2, newRow);
          } else if (cfg.rowProp && cfg.rowProp !== '_entity' && newRow && newRow !== '(未設定)') {
            const ep = _entityPath(dbPath, entName, ctx?.pivotData);
            rvRef = await postTimelineValue(ep, cfg.rowProp, newRow);
            rowValueWasCreated = !!rvRef;
          }
          // 期間バーのD&D: 終了日も差分保持で移動
          if (ev3 && oldTime && ev3.value) {
            oldEnd = ev3.value;
            newEnd = previewEnd;
            evRef = await putTimelineValue(ev3, newEnd);
          }
        } catch (err) {
          await rollbackTimelineWrites();
          if (typeof showStatus === 'function') showStatus('タイムライン移動に失敗: ' + (err?.message || err), true);
          await selectDatabase(dbPath, ctx);
          return;
        }
        historyPush('タイムライン移動: ' + entName,
          async () => {
            if (tvRef) await _apiPutValue(tvRef, { new_value: oldTime });
            if (rvRef) {
              if (rowValueWasCreated) await _apiPutValue(rvRef, { _delete: true });
              else await _apiPutValue(rvRef, { new_value: oldRow });
            }
            if (evRef) await _apiPutValue(evRef, { new_value: oldEnd });
            await selectDatabase(dbPath, ctx);
          },
          async () => {
            if (tvRef) await _apiPutValue(tvRef, { new_value: newTimeValue });
            if (rvRef) {
              if (rowValueWasCreated) {
                const res = await _apiPostValue(_entityPath(dbPath, entName, ctx?.pivotData), cfg.rowProp, newRow, '採用', '');
                rvRef.file = res?.path || rvRef.file;
                rvRef.property = res?.property || cfg.rowProp;
                rvRef.candidate_index = res?.candidate_index;
              } else {
                await _apiPutValue(rvRef, { new_value: newRow });
              }
            }
            if (evRef) await _apiPutValue(evRef, { new_value: newEnd });
            await selectDatabase(dbPath, ctx);
          },
          _dbScope(dbPath)
        );
        selectDatabase(dbPath, ctx);
      });

      // エントリカードを配置（endProp 未設定 or endDate なしの点表示）
      const timeKey = isHorizontal ? col : row;
      const rowKey = isHorizontal ? row : col;
      entries.filter(e => {
        if (e.endVal) return false; // 期間バーで表示するのでスキップ
        return roundTimelineValue(e.timeVal) === timeKey && e.rowVal === rowKey;
      }).forEach(e => {
        const card = document.createElement('div');
        card.className = 'tl-card';
        card.dataset.entity = e.name;
        card.dataset.entityName = e.name;
        card.dataset.meldexEntityPath = _entityPath(dbPath, e.name, ctx?.pivotData);
        // 互換テスト用: _renderTimelineEntityContent(card, e, cfg, { dbPath, propTypes, editable: true });
        _renderTimelineEntityContent(card, e, cfg, { dbPath, propTypes, editable: true, ctx, filter: ctx?.filter });
        card.title = e.name + '\n' + cfg.timeProp + ': ' + e.timeVal;
        if (typeof _applyTimelineVisibleColor === 'function') _applyTimelineVisibleColor(card, axisColors, e.rowVal, roundTimelineValue(e.timeVal));
        card.draggable = true;
        card.addEventListener('dragstart', (ev) => {
          ev.dataTransfer.setData('text/x-timeline-entity', e.name);
          window.MeldexBoardTransfer?.setEntityDragData?.(
            ev.dataTransfer,
            dbPath,
            e.name,
            card.dataset.meldexEntityPath,
          );
          ev.dataTransfer.effectAllowed = 'copyMove';
        });
        card.addEventListener('click', (ev) => {
          ev.stopPropagation();
          _queueTimelineEntitySingleClick(card, ctx, dbPath, e.name);
        });
        card.addEventListener('dblclick', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          _cancelTimelineEntitySingleClick(card);
          if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, e.name);
          selectEntity(_entityPath(dbPath, e.name));
        });
        cell.appendChild(card);
      });

      grid.appendChild(cell);
    });
  });

  // 期間バー: 終了日がある場合
  if (entries.some(e => e.endVal)) {
    entries.filter(e => e.endVal).forEach(e => {
      const startRound = roundTimelineValue(e.timeVal);
      const endRound = roundTimelineValue(e.endVal);
      const startColIdx = cols.indexOf(isHorizontal ? startRound : e.rowVal);
      const endColIdx = cols.indexOf(isHorizontal ? endRound : e.rowVal);
      const rowIdx = rows.indexOf(isHorizontal ? e.rowVal : startRound);
      const endRowIdx = rows.indexOf(isHorizontal ? e.rowVal : endRound);

      if (startColIdx < 0 || rowIdx < 0) return;
      if (isHorizontal && endColIdx < 0) return;
      if (!isHorizontal && endRowIdx < 0) return;

      const bar = document.createElement('div');
      bar.className = 'tl-bar';
      bar.dataset.entity = e.name;

      if (isHorizontal) {
        const firstColIdx = Math.min(startColIdx, endColIdx);
        const span = Math.max(1, Math.abs(endColIdx - startColIdx) + 1);
        bar.style.gridRow = (rowIdx + 2) + '';
        bar.style.gridColumn = `${firstColIdx + 2} / span ${span}`;
      } else {
        const firstRowIdx = Math.min(rowIdx, endRowIdx);
        const span = Math.max(1, Math.abs(endRowIdx - rowIdx) + 1);
        bar.style.gridRow = `${firstRowIdx + 2} / span ${span}`;
        bar.style.gridColumn = (startColIdx + 2) + '';
      }

      if (typeof _applyTimelineVisibleColor === 'function') _applyTimelineVisibleColor(bar, axisColors, e.rowVal, startRound);

      // リサイズハンドル
      const handleL = document.createElement('div');
      handleL.className = 'tl-bar-handle tl-bar-handle-left';
      const label = document.createElement('span');
      label.className = 'tl-bar-label';
      _renderTimelineEntityContent(label, e, cfg, { titleClass: 'tl-bar-title', dbPath, propTypes, editable: true, ctx, filter: ctx?.filter });
      const handleR = document.createElement('div');
      handleR.className = 'tl-bar-handle tl-bar-handle-right';
      bar.appendChild(handleL);
      bar.appendChild(label);
      bar.appendChild(handleR);

      bar.title = e.name + '\n' + cfg.timeProp + ': ' + e.timeVal + '\n' + (cfg.endProp || cfg.timeProp) + ': ' + e.endVal;
      bar.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _queueTimelineEntitySingleClick(bar, ctx, dbPath, e.name);
      });
      bar.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        _cancelTimelineEntitySingleClick(bar);
        if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, e.name);
        selectEntity(_entityPath(dbPath, e.name));
      });

      // ドラッグ移動
      bar.draggable = true;
      bar.dataset.entityName = e.name;
      bar.dataset.meldexEntityPath = _entityPath(dbPath, e.name, ctx?.pivotData);
      bar.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/x-timeline-entity', e.name);
        window.MeldexBoardTransfer?.setEntityDragData?.(
          ev.dataTransfer,
          dbPath,
          e.name,
          bar.dataset.meldexEntityPath,
        );
        ev.dataTransfer.effectAllowed = 'copyMove';
      });

      // リサイズハンドルのドラッグ処理
      [handleL, handleR].forEach((handle, hIdx) => {
        handle.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          bar.draggable = false;
          handle.setPointerCapture?.(ev.pointerId);
          const isLeft = hIdx === 0;
          const startX = ev.clientX;
          const startY = ev.clientY;
          const cells = grid.querySelectorAll('.tl-cell');
          const cellRects = [];
          cells.forEach(c => cellRects.push({ el: c, rect: c.getBoundingClientRect(), col: c.dataset.col, row: c.dataset.row }));

          const onMove = (me) => {
            const x = me.clientX, y = me.clientY;
            // 最も近いセルを特定
            let closest = null, minDist = Infinity;
            cellRects.forEach(cr => {
              const cx = cr.rect.left + cr.rect.width / 2;
              const cy = cr.rect.top + cr.rect.height / 2;
              const d = Math.abs(isHorizontal ? x - cx : y - cy);
              if (d < minDist) { minDist = d; closest = cr; }
            });
            if (closest) {
              const targetTimeGroup = isHorizontal ? closest.col : closest.row;
              bar.dataset.resizeTarget = targetTimeGroup;
              bar.dataset.resizeSide = isLeft ? 'left' : 'right';
            }
          };
          const onUp = async (upEv) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            handle.releasePointerCapture?.(upEv?.pointerId ?? ev.pointerId);
            bar.draggable = true;
            let targetTimeGroup = bar.dataset.resizeTarget;
            delete bar.dataset.resizeTarget;
            delete bar.dataset.resizeSide;
            if (!targetTimeGroup) return;
            const currentSideGroup = isLeft ? startRound : endRound;
            if (targetTimeGroup === currentSideGroup) return;
            if (isLeft && _compareTimelineGroupValues(targetTimeGroup, endRound) > 0) targetTimeGroup = endRound;
            if (!isLeft && _compareTimelineGroupValues(targetTimeGroup, startRound) < 0) targetTimeGroup = startRound;
            if (targetTimeGroup === currentSideGroup) return;
            const ed = entitiesMap[e.name];
            // 採用値のみを対象にする（先頭が案/ボツの場合にそれを書き換えないため）
            const pickAdopted = (arr) => {
              const a = arr || [];
              return typeof filterValues === 'function'
                ? filterValues(a, '採用')[0]
                : a.find(v => (v?.status || '採用') === '採用');
            };
            if (isLeft) {
              const tv = pickAdopted(ed[cfg.timeProp]);
              if (tv) {
                const oldVal = tv.value || '';
                const targetTime = typeof _timelineValueForDropTarget === 'function'
                  ? _timelineValueForDropTarget(oldVal, targetTimeGroup, cfg.scale, propTypes[cfg.timeProp] || {})
                  : targetTimeGroup;
                let newVal = targetTime;
                const endUsesTimeProp = !!cfg.endProp && cfg.endProp === cfg.timeProp;
                if ((!cfg.endProp || endUsesTimeProp) && typeof _dbDateSerializeValue === 'function') {
                  const parsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(oldVal) : null;
                  if (parsed?.range) {
                    newVal = _dbDateSerializeValue(targetTime, parsed.end || '', propTypes[cfg.timeProp] || {}, oldVal);
                  }
                }
                await _apiPutValue(tv, { new_value: newVal });
                _dbUndoValue(cfg.timeProp, tv, oldVal, newVal);
              }
            } else {
              const endUsesTimeProp = !!cfg.endProp && cfg.endProp === cfg.timeProp;
              const ev2 = (cfg.endProp && !endUsesTimeProp) ? pickAdopted(ed[cfg.endProp]) : null;
              if (ev2) {
                const oldVal = ev2.value || '';
                const targetTime = typeof _timelineValueForDropTarget === 'function'
                  ? _timelineValueForDropTarget(oldVal, targetTimeGroup, cfg.scale, propTypes[cfg.endProp] || {})
                  : targetTimeGroup;
                await _apiPutValue(ev2, { new_value: targetTime });
                _dbUndoValue(cfg.endProp, ev2, oldVal, targetTime);
              } else {
                const tv = pickAdopted(ed[cfg.timeProp]);
                if (tv && typeof _dbDateSerializeValue === 'function') {
                  const oldVal = tv.value || '';
                  const targetTime = typeof _timelineValueForDropTarget === 'function'
                    ? _timelineValueForDropTarget(oldVal, targetTimeGroup, cfg.scale, propTypes[cfg.timeProp] || {})
                    : targetTimeGroup;
                  const parsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(oldVal) : null;
                  if (parsed?.range) {
                    const newVal = _dbDateSerializeValue(parsed.start || '', targetTime, propTypes[cfg.timeProp] || {}, oldVal);
                    await _apiPutValue(tv, { new_value: newVal });
                    _dbUndoValue(cfg.timeProp, tv, oldVal, newVal);
                  }
                }
              }
            }
            selectDatabase(dbPath, ctx);
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          document.addEventListener('pointercancel', onUp);
        });
      });

      grid.appendChild(bar);
    });
  }

  container.appendChild(grid);

  // 依存矢印の描画（ペアリレーションが設定されている場合）
  requestAnimationFrame(() => _renderDependencyArrows(grid, dbPath, entitiesMap, entries));
}

// 依存矢印を SVG オーバーレイに描画
function _renderDependencyArrows(grid, dbPath, entitiesMap, entries) {
  // 既存のSVGオーバーレイを削除（リスナー蓄積防止）
  grid.querySelectorAll('.tl-dependency-overlay').forEach(el => el.remove());

  const pts = getPropertyTypes(dbPath);
  let blockingProp = null;
  let direction = 'target-to-entry';
  for (const [p, cfg] of Object.entries(pts)) {
    if (blockingProp) break;
    if (cfg.pairWith && cfg.relationDb === '' && cfg.dependencyDirection) {
      blockingProp = p;
      direction = cfg.dependencyDirection === 'entry-to-target' ? 'entry-to-target' : 'target-to-entry';
      break;
    }
  }
  if (!blockingProp && pts['先行'] && pts['先行'].pairWith && pts['先行'].relationDb === '') {
    blockingProp = '先行';
    direction = 'target-to-entry';
  }
  if (!blockingProp) return;

  // バーまたはカード要素のマップを構築
  const entityElements = {};
  grid.querySelectorAll('.tl-bar[data-entity], .tl-card').forEach(el => {
    const name = el.dataset.entity || el.textContent.trim();
    if (name) entityElements[name] = el;
  });

  // エントリのIDマップ
  const cached = _relationCache[dbPath];
  if (!cached) return;

  const arrows = [];
  for (const entry of entries) {
    const ed = entitiesMap[entry.name];
    const blockingVals = ed[blockingProp] || [];
    const picked = (typeof getAdoptedValueForWrite === 'function' ? getAdoptedValueForWrite(blockingVals) : null)
      || (typeof filterValues === 'function' ? filterValues(blockingVals, '採用')[0] : null)
      || blockingVals[0];
    const v = picked?.value || '';
    if (!v) continue;
    const targetIds = v.split(',').map(s => s.trim()).filter(Boolean);
    for (const tid of targetIds) {
      const targetName = cached.idToName[tid] || tid;
      if (entityElements[entry.name] && entityElements[targetName]) {
        arrows.push(direction === 'entry-to-target'
          ? { from: entry.name, to: targetName }
          : { from: targetName, to: entry.name });
      }
    }
  }

  if (arrows.length === 0) return;

  // SVGオーバーレイを作成
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('tl-dependency-overlay');
  svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:2;';
  svg.style.width = grid.scrollWidth + 'px';
  svg.style.height = grid.scrollHeight + 'px';
  // 矢印マーカー定義
  svg.innerHTML = `<defs>
    <marker id="tl-arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="var(--accent)" />
    </marker>
  </defs>`;

  const gridRect = grid.getBoundingClientRect();
  const scrollL = grid.scrollLeft, scrollT = grid.scrollTop;

  arrows.forEach(a => {
    const fromEl = entityElements[a.from];
    const toEl = entityElements[a.to];
    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();

    // 矢印: ソースの右端中央 → ターゲットの左端中央（スクロールオフセット補正）
    const x1 = fromRect.right - gridRect.left + scrollL;
    const y1 = fromRect.top + fromRect.height / 2 - gridRect.top + scrollT;
    const x2 = toRect.left - gridRect.left + scrollL;
    const y2 = toRect.top + toRect.height / 2 - gridRect.top + scrollT;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', 'var(--accent)');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('opacity', '0.7');
    line.setAttribute('marker-end', 'url(#tl-arrowhead)');
    line.dataset.from = a.from;
    line.dataset.to = a.to;
    svg.appendChild(line);
  });

  // gridにposition:relativeを設定（既存になければ）
  grid.style.position = 'relative';
  grid.appendChild(svg);

  // スクロール対応: gridのスクロールで矢印座標を再計算
  const scrollParent = grid.closest('.timeline-view') || grid.parentElement;
  if (scrollParent) {
    const updateArrows = () => {
      const newGridRect = grid.getBoundingClientRect();
      const sL = grid.scrollLeft, sT = grid.scrollTop;
      svg.querySelectorAll('line').forEach(line => {
        const fromName = line.dataset.from;
        const toName = line.dataset.to;
        const fromEl = entityElements[fromName];
        const toEl = entityElements[toName];
        if (!fromEl || !toEl) return;
        const fr = fromEl.getBoundingClientRect();
        const tr = toEl.getBoundingClientRect();
        line.setAttribute('x1', fr.right - newGridRect.left + sL);
        line.setAttribute('y1', fr.top + fr.height / 2 - newGridRect.top + sT);
        line.setAttribute('x2', tr.left - newGridRect.left + sL);
        line.setAttribute('y2', tr.top + tr.height / 2 - newGridRect.top + sT);
      });
    };
    // 前回のリスナーを除去してから登録（蓄積防止）
    if (scrollParent._tlDepArrowHandler) scrollParent.removeEventListener('scroll', scrollParent._tlDepArrowHandler);
    scrollParent._tlDepArrowHandler = updateArrows;
    scrollParent.addEventListener('scroll', updateArrows);
  }
}

// 日付差分を計算（日付→msec、数値→数値差分）
function _calcDateDiff(from, to, scale) {
  if (typeof _dbDateGetComparableValue === 'function') {
    from = _dbDateGetComparableValue(from);
    to = _dbDateGetComparableValue(to);
  }
  const isDate = /^\d{4}[-/]\d{2}/.test(from);
  if (isDate) {
    const d1 = typeof parseLocalDate === 'function' ? parseLocalDate(from) : new Date(from);
    const d2 = typeof parseLocalDate === 'function' ? parseLocalDate(to) : new Date(to);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
    return d2.getTime() - d1.getTime();
  }
  const numRe = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  const fromText = String(from ?? '').trim();
  const toText = String(to ?? '').trim();
  const n1 = numRe.test(fromText) ? Number(fromText) : NaN;
  const n2 = numRe.test(toText) ? Number(toText) : NaN;
  if (Number.isFinite(n1) && Number.isFinite(n2)) return n2 - n1;
  return 0;
}
// 日付/数値をシフト
function _shiftDate(dateStr, diff, scale) {
  if (typeof _dbDateShiftValue === 'function' && typeof _dbDateParseValue === 'function') {
    const parsed = _dbDateParseValue(dateStr);
    if (parsed.range) return _dbDateShiftValue(dateStr, diff);
  }
  if (typeof _dbDateGetComparableValue === 'function') dateStr = _dbDateGetComparableValue(dateStr);
  const isDate = /^\d{4}[-/]\d{2}/.test(dateStr);
  if (isDate) {
    const d = typeof parseLocalDate === 'function' ? parseLocalDate(dateStr) : new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    d.setTime(d.getTime() + diff);
    if (typeof _dbDateValueFromDate === 'function') {
