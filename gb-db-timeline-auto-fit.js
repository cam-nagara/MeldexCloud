/* タイムライン表示の列幅自動調整 */

function _timelineAutoWidthPx(texts, headerText) {
  if (typeof _dbAutoWidthCharsForTexts === 'function' && typeof _dbWidthPxFromChars === 'function') {
    return Math.min(360, Math.max(80, _dbWidthPxFromChars(_dbAutoWidthCharsForTexts(texts, headerText))));
  }
  const values = (texts || []).map(text => String(text || '')).filter(Boolean);
  const longest = Math.max([...String(headerText || '')].length, ...values.map(text => [...text].length), 4);
  return Math.min(360, Math.max(80, Math.round(longest * 9 + 32)));
}

function _timelineEntryAutoFitTexts(entry, cfg) {
  const parts = [];
  if (_timelineShowsEntryName(cfg)) parts.push(entry.name);
  (Array.isArray(cfg.cardProps) ? cfg.cardProps : []).forEach(propName => {
    const value = _timelineEntryPropDisplay(entry, propName);
    if (value) parts.push(`${propName}: ${value}`);
  });
  return parts;
}

function _timelineEntryAutoFitText(entry, cfg) {
  return _timelineEntryAutoFitTexts(entry, cfg).join(' ');
}

function _collectTimelineAutoFitEntries(data, cfg, filterMode) {
  const entitiesMap = data?.entities || {};
  const entries = [];
  Object.keys(entitiesMap).sort().forEach(name => {
    const ed = entitiesMap[name] || {};
    const timeVals = filterValues(ed[cfg.timeProp] || [], undefined, filterMode);
    const rawTimeVal = timeVals.length > 0 ? timeVals[0].value : '';
    const timeParsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(rawTimeVal) : null;
    const timeVal = timeParsed?.range ? (timeParsed.start || rawTimeVal) : rawTimeVal;
    let endVal = '';
    if (cfg.endProp) {
      const endVals = filterValues(ed[cfg.endProp] || [], undefined, filterMode);
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
      const rv = filterValues(ed[cfg.rowProp] || [], undefined, filterMode);
      rowVal = rv.length > 0 ? rv[0].value : '(未設定)';
    }
    if (timeVal) entries.push({ name, timeVal, endVal, rowVal, data: ed, filterMode });
  });
  return entries;
}

function autoFitTimelineColumns(ctx, dbPath, options = {}) {
  ctx = ctx || (typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  const data = ctx?.pivotData || state.pivotData;
  dbPath = dbPath || ctx?.dbPath || state.currentDbPath;
  if (!dbPath || !data?.entities) return;
  const cfg = getTimelineConfig(dbPath, { ctx });
  if (!cfg.timeProp) {
    if (typeof showStatus === 'function') showStatus('時間軸プロパティを選択してください', true);
    return;
  }
  const entries = _collectTimelineAutoFitEntries(data, cfg, ctx?.filter);
  const roundTimelineValue = (value) => typeof _timelineRoundTimeValue === 'function'
    ? _timelineRoundTimeValue(value, cfg)
    : roundTimeValue(value, cfg.scale);
  const timeGroups = new Set();
  const rowGroups = new Set();
  entries.forEach(entry => {
    timeGroups.add(roundTimelineValue(entry.timeVal));
    if (entry.endVal) timeGroups.add(roundTimelineValue(entry.endVal));
    rowGroups.add(entry.rowVal);
  });
  const timeArrBase = [...timeGroups].sort(_compareTimelineGroupValues);
  const timeArr = typeof _applyTimelineTimeOrder === 'function' ? _applyTimelineTimeOrder(timeArrBase, cfg) : timeArrBase;
  const rowArr = _applyTimelineRowOrder([...rowGroups].sort(_compareTimelineGroupValues), cfg);
  if (timeArr.length === 0 || rowArr.length === 0) return;

  const isHorizontal = cfg.direction === 'horizontal';
  const cols = isHorizontal ? timeArr : rowArr;
  const rows = isHorizontal ? rowArr : timeArr;
  const targetKey = options.targetKey == null ? '' : _timelineColKey(options.targetKey);
  const next = { ...cfg, colWidths: { ...(cfg.colWidths || {}) } };
  const displayTimelineGroup = (value) => typeof _timelineDisplayGroupValue === 'function'
    ? _timelineDisplayGroupValue(value)
    : value;
  if (!targetKey || targetKey === '__rowHeader') {
    const rowHeader = isHorizontal ? (cfg.rowProp === '_entity' ? 'エントリ' : cfg.rowProp) : cfg.timeProp;
    next.colWidths.__rowHeader = _timelineAutoWidthPx(rows.map(displayTimelineGroup), rowHeader);
  }
  const colTexts = new Map(cols.map(col => [_timelineColKey(col), []]));
  entries.forEach(entry => {
    const key = _timelineColKey(isHorizontal ? roundTimelineValue(entry.timeVal) : entry.rowVal);
    const texts = colTexts.get(key);
    if (texts) texts.push(..._timelineEntryAutoFitTexts(entry, cfg));
  });
  cols.forEach(col => {
    const key = _timelineColKey(col);
    if (targetKey && key !== targetKey) return;
    next.colWidths[key] = _timelineAutoWidthPx(colTexts.get(key) || [], displayTimelineGroup(col));
  });
  setTimelineConfig(dbPath, next, {
    label: 'シート表示: タイムライン列幅自動調整',
    detail: targetKey ? String(options.detail || options.targetKey || '') : '全列',
    ctx,
  });
  renderTimeline(ctx);
  if (typeof showStatus === 'function') showStatus(targetKey ? 'タイムライン列幅を自動調整しました' : 'タイムライン全列幅を自動調整しました');
}

function autoFitTimelineColumn(ctx, dbPath, col) {
  autoFitTimelineColumns(ctx, dbPath, { targetKey: col, detail: String(col || '') });
}
