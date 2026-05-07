/* タイムライン表示・依存矢印 — gb-db-views.js から分離 */

const TL_SCALES = [
  {value:'second',label:'秒'}, {value:'minute',label:'分'}, {value:'hour',label:'時間'},
  {value:'day',label:'日'}, {value:'week',label:'週'}, {value:'month',label:'月'},
  {value:'year',label:'年'}, {value:'decade',label:'十年'}, {value:'century',label:'百年'},
  {value:'millennium',label:'千年'}, {value:'ten_thousand',label:'万年'},
];

function getTimelineConfig(dbPath) {
  const cfg = getCurrentDbViewTypeSpecific(dbPath, 'timeline') || {};
  return typeof _normalizeDbTimelineTypeSpecific === 'function'
    ? _normalizeDbTimelineTypeSpecific(cfg)
    : { timeProp: cfg.timeProp || '', endProp: cfg.endProp || '', rowProp: cfg.rowProp || '_entity', scale: cfg.scale || 'day', direction: cfg.direction || 'horizontal' };
}
function setTimelineConfig(dbPath, cfg, options = {}) {
  const label = options.historyLabel || options.label || '';
  const normalized = typeof _normalizeDbTimelineTypeSpecific === 'function'
    ? _normalizeDbTimelineTypeSpecific(cfg)
    : { ...(cfg || {}) };
  setCurrentDbViewTypeSpecific(dbPath, 'timeline', normalized, {
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
  return Number.isFinite(w) && w >= 60 ? Math.round(w) : 120;
}

function _timelineCornerWidth(cfg) {
  const w = Number(cfg?.colWidths?.__rowHeader);
  return Number.isFinite(w) && w >= 80 ? Math.round(w) : 120;
}

function _timelineGridTemplate(cfg, cols) {
  return `${_timelineCornerWidth(cfg)}px ${cols.map(col => _timelineColWidth(cfg, col) + 'px').join(' ')}`;
}

function _setTimelineColWidth(dbPath, cfg, col, width, options = {}) {
  const next = { ...cfg, colWidths: { ...(cfg.colWidths || {}) } };
  next.colWidths[_timelineColKey(col)] = Math.max(60, Math.round(width || 120));
  setTimelineConfig(dbPath, next, {
    label: options.label || 'シート表示: タイムライン列幅',
    detail: options.detail || String(col || ''),
    skipHistory: options.skipHistory === true,
  });
}

function _bindTimelineColumnResize(th, grid, dbPath, cfg, cols, col) {
  const handle = document.createElement('span');
  handle.className = 'tl-col-resize-handle';
  handle.title = '列幅を調整';
  handle.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    handle.setPointerCapture?.(ev.pointerId);
    const startX = ev.clientX;
    const startWidth = _timelineColWidth(cfg, col);
    let nextWidth = startWidth;
    const onMove = (moveEv) => {
      nextWidth = Math.max(60, startWidth + moveEv.clientX - startX);
      const liveCfg = { ...cfg, colWidths: { ...(cfg.colWidths || {}), [_timelineColKey(col)]: nextWidth } };
      grid.style.gridTemplateColumns = _timelineGridTemplate(liveCfg, cols);
    };
    const onUp = (upEv) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      handle.releasePointerCapture?.(upEv.pointerId);
      _setTimelineColWidth(dbPath, cfg, col, nextWidth);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
  handle.addEventListener('dblclick', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const colIndex = th.dataset.colIndex;
    let width = th.scrollWidth + 18;
    grid.querySelectorAll(`[data-tl-col-index="${colIndex}"]`).forEach(el => {
      width = Math.max(width, el.scrollWidth + 18);
    });
    _setTimelineColWidth(dbPath, cfg, col, Math.min(Math.max(width, 80), 480), { detail: String(col || '') });
  });
  th.appendChild(handle);
}

function _timelineEntryPropDisplay(entry, propName) {
  const vals = typeof filterValues === 'function' ? filterValues(entry.data?.[propName] || []) : (entry.data?.[propName] || []);
  return vals.map(v => v?.value ?? '').filter(v => String(v).trim()).join(', ');
}

function _renderTimelineEntityContent(root, entry, cfg, options = {}) {
  root.innerHTML = '';
  const title = document.createElement('div');
  title.className = options.titleClass || 'tl-card-title';
  title.textContent = entry.name;
  root.appendChild(title);
  const cardProps = Array.isArray(cfg.cardProps) ? cfg.cardProps : [];
  cardProps.forEach(propName => {
    const displayVal = _timelineEntryPropDisplay(entry, propName);
    if (!displayVal) return;
    const row = document.createElement('div');
    row.className = 'tl-card-prop';
    const name = document.createElement('span');
    name.className = 'tl-card-prop-name';
    name.textContent = propName + ':';
    const value = document.createElement('span');
    value.className = 'tl-card-prop-value';
    value.textContent = displayVal;
    row.appendChild(name);
    row.appendChild(value);
    root.appendChild(row);
  });
}

function _showTimelineCardPropsMenu(anchor, dbPath, cfg, props, ctx) {
  document.querySelectorAll('.tl-card-props-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu tl-card-props-menu';
  menu.style.cssText = 'position:fixed;z-index:10000;min-width:220px;max-height:320px;overflow:auto;padding:6px;';
  const selected = new Set(Array.isArray(cfg.cardProps) ? cfg.cardProps : []);
  props.forEach(prop => {
    const label = document.createElement('label');
    label.className = 'tl-card-prop-option';
    label.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(prop);
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(prop);
      else selected.delete(prop);
      setTimelineConfig(dbPath, { ...cfg, cardProps: Array.from(selected) }, {
        label: 'シート表示: タイムラインカード表示',
        detail: prop,
      });
      renderTimeline(ctx);
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(prop));
    menu.appendChild(label);
  });
  document.body.appendChild(menu);
  if (typeof attachMeldexDropdownCloseButton === 'function') {
    attachMeldexDropdownCloseButton(menu, {
      trigger: anchor,
      className: 'tl-card-props-menu-close',
      attr: 'data-tl-card-props-close',
    });
  }
  positionPopup(menu, anchor.getBoundingClientRect());
  setTimeout(() => {
    const closer = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchor) {
        menu.remove();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function renderTimeline(ctx) {
  ctx = ctx || _currentPaneState();
  const data = ctx.pivotData || state.pivotData;
  const container = _paneEl(ctx, '.timeline-view') || document.getElementById('timeline-view');
  if (!data || !data.entities) { container.innerHTML = ''; return; }
  const dbPath = ctx.dbPath || state.currentDbPath;

  // カレンダーソースDBの場合はカレンダーモードに分岐
  if (typeof _canRenderCalendarFromDb === 'function' && _canRenderCalendarFromDb(dbPath, data) && typeof renderCalendar === 'function') {
    const viewMode = typeof _getActiveCalendarViewMode === 'function'
      ? _getActiveCalendarViewMode(dbPath, data)
      : getCurrentViewMode(dbPath);
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

  const cfg = getTimelineConfig(dbPath);
  const entitiesMap = data.entities;
  const entityNames = Object.keys(entitiesMap).sort();
  if (entityNames.length === 0) { renderEmptyState(container, 'clock', 'エントリがありません', '下部の入力欄から追加してください'); return; }
  const props = data.properties;
  const propTypes = getPropertyTypes(dbPath);

  container.innerHTML = '';

  // 設定バー
  const settings = document.createElement('div');
  settings.className = 'tl-settings';

  // 時間軸プロパティ
  settings.innerHTML = `
    <label>開始日: <select id="tl-time-prop" class="gb-select">${props.map(p => `<option value="${esc(p)}" ${cfg.timeProp===p?'selected':''}>${esc(p)}</option>`).join('')}</select></label>
    <label>終了日: <select id="tl-end-prop" class="gb-select">
      <option value="" ${!cfg.endProp?'selected':''}>(なし)</option>
      ${props.map(p => `<option value="${esc(p)}" ${cfg.endProp===p?'selected':''}>${esc(p)}</option>`).join('')}
    </select></label>
    <label>行/列軸: <select id="tl-row-prop" class="gb-select">
      <option value="_entity" ${cfg.rowProp==='_entity'?'selected':''}>エントリ名</option>
      ${props.map(p => `<option value="${esc(p)}" ${cfg.rowProp===p?'selected':''}>${esc(p)}</option>`).join('')}
    </select></label>
    <label>スケール: <select id="tl-scale" class="gb-select">${TL_SCALES.map(s => `<option value="${s.value}" ${cfg.scale===s.value?'selected':''}>${s.label}</option>`).join('')}</select></label>
    <label>方向: <select id="tl-direction" class="gb-select">
      <option value="horizontal" ${cfg.direction==='horizontal'?'selected':''}>→ 横方向（時間が右）</option>
      <option value="vertical" ${cfg.direction==='vertical'?'selected':''}>↓ 縦方向（時間が下）</option>
    </select></label>
    <button type="button" id="tl-card-props" class="tl-nav-btn" title="カードに表示するプロパティ">${lucide('listPlus', 12)} カード表示 ${Array.isArray(cfg.cardProps) && cfg.cardProps.length ? '(' + cfg.cardProps.length + ')' : ''}</button>
  `;
  container.appendChild(settings);
  settings.querySelector('#tl-card-props')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    _showTimelineCardPropsMenu(ev.currentTarget, dbPath, cfg, props, ctx);
  });

  // 設定変更イベント
  ['tl-time-prop','tl-end-prop','tl-row-prop','tl-scale','tl-direction'].forEach(id => {
    const el = settings.querySelector('#' + id);
    if (el) el.onchange = () => {
      setTimelineConfig(dbPath, {
        ...cfg,
        timeProp: settings.querySelector('#tl-time-prop').value,
        endProp: settings.querySelector('#tl-end-prop').value,
        rowProp: settings.querySelector('#tl-row-prop').value,
        scale: settings.querySelector('#tl-scale').value,
        direction: settings.querySelector('#tl-direction').value,
      }, {
        label: 'シート表示: タイムライン設定',
        detail: el.closest('label')?.textContent?.split(':')[0]?.trim() || '',
      });
      renderTimeline(ctx);
    };
  });

  if (!cfg.timeProp) {
    container.insertAdjacentHTML('beforeend', '<div style="padding:24px;color:var(--fg2);">時間軸プロパティを選択してください</div>');
    return;
  }

  // データ収集: 各エントリの時間値と行値を取得
  const entries = [];
  entityNames.forEach(name => {
    const ed = entitiesMap[name];
    const timeVals = filterValues(ed[cfg.timeProp] || []);
    const rawTimeVal = timeVals.length > 0 ? timeVals[0].value : '';
    const timeParsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(rawTimeVal) : null;
    const timeVal = timeParsed?.range ? (timeParsed.start || rawTimeVal) : rawTimeVal;
    let endVal = '';
    if (cfg.endProp) {
      const endVals = filterValues(ed[cfg.endProp] || []);
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
      const rv = filterValues(ed[cfg.rowProp] || []);
      rowVal = rv.length > 0 ? rv[0].value : '(未設定)';
    }
    if (timeVal) entries.push({ name, timeVal, endVal, rowVal, data: ed });
  });

  // 時間値をグループ化（スケールに応じて丸める）
  const timeGroups = new Set();
  const rowGroups = new Set();
  entries.forEach(e => {
    timeGroups.add(roundTimeValue(e.timeVal, cfg.scale));
    if (e.endVal) timeGroups.add(roundTimeValue(e.endVal, cfg.scale));
    rowGroups.add(e.rowVal);
  });
  const timeArr = [...timeGroups].sort(_compareTimelineGroupValues);
  const rowArr = [...rowGroups].sort(_compareTimelineGroupValues);

  if (timeArr.length === 0 || rowArr.length === 0) {
    container.insertAdjacentHTML('beforeend', '<div style="padding:24px;color:var(--fg2);">データがありません</div>');
    return;
  }

  // グリッド生成
  const isHorizontal = cfg.direction === 'horizontal';
  const cols = isHorizontal ? timeArr : rowArr;
  const rows = isHorizontal ? rowArr : timeArr;

  const grid = document.createElement('div');
  grid.className = 'tl-grid';
  grid.style.gridTemplateColumns = _timelineGridTemplate(cfg, cols);

  // コーナーセル
  const corner = document.createElement('div');
  corner.className = 'tl-header-cell tl-corner';
  corner.textContent = isHorizontal ? cfg.rowProp === '_entity' ? 'エントリ' : cfg.rowProp : cfg.timeProp;
  corner.style.gridRow = '1'; corner.style.gridColumn = '1';
  grid.appendChild(corner);

  // 列ヘッダー
  cols.forEach((col, ci) => {
    const th = document.createElement('div');
    th.className = 'tl-header-cell tl-col-header';
    th.textContent = col;
    th.style.gridRow = '1'; th.style.gridColumn = (ci + 2) + '';
    th.dataset.colIndex = String(ci);
    th.dataset.tlColIndex = String(ci);
    _bindTimelineColumnResize(th, grid, dbPath, cfg, cols, col);
    grid.appendChild(th);
  });

  // 行
  rows.forEach((row, ri) => {
    // 行ヘッダー
    const rh = document.createElement('div');
    rh.className = 'tl-header-cell tl-row-header';
    rh.textContent = row;
    rh.style.gridRow = (ri + 2) + ''; rh.style.gridColumn = '1';
    grid.appendChild(rh);

    // セル
    cols.forEach((col, ci) => {
      const cell = document.createElement('div');
      cell.className = 'tl-cell';
      cell.style.gridRow = (ri + 2) + ''; cell.style.gridColumn = (ci + 2) + '';
      cell.dataset.row = row; cell.dataset.col = col;
      cell.dataset.tlColIndex = String(ci);

      // D&D: ドロップ先
      cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', async (e) => {
        e.preventDefault(); cell.classList.remove('drag-over');
        const entName = e.dataTransfer.getData('text/x-timeline-entity');
        if (!entName) return;
        const newTime = isHorizontal ? col : row;
        const newRow = isHorizontal ? row : col;
        // 時間値を更新（採用値のみを対象にする。先頭が案/ボツ候補だった場合に破壊しないため）
        const ed = entitiesMap[entName];
        const pickAdopted = (arr) => {
          const a = arr || [];
          return typeof filterValues === 'function'
            ? filterValues(a, '採用')[0]
            : a.find(v => (v?.status || '採用') === '採用');
        };
        const tv = pickAdopted(ed[cfg.timeProp]);
        const oldTime = tv ? (tv.value || '') : '';
        const timePtc = propTypes[cfg.timeProp] || {};
        const oldTimeParsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(oldTime) : null;
        const useRangeInTimeProp = !cfg.endProp && oldTimeParsed?.range;
        let newTimeValue = newTime;
        if (useRangeInTimeProp && typeof _dbDateSerializeValue === 'function') {
          const diff = _calcDateDiff(oldTimeParsed.start || oldTime, newTime, cfg.scale);
          const shiftedEnd = oldTimeParsed.end ? _shiftDate(oldTimeParsed.end, diff, cfg.scale) : '';
          newTimeValue = _dbDateSerializeValue(newTime, shiftedEnd, timePtc, oldTime);
        }
        if (tv) await _apiPutValue(tv, { new_value: newTimeValue });
        let oldRow = '';
        const rv2 = (cfg.rowProp && cfg.rowProp !== '_entity') ? pickAdopted(ed[cfg.rowProp]) : null;
        if (rv2) {
          oldRow = rv2.value || '';
          await _apiPutValue(rv2, { new_value: newRow });
        }
        // 期間バーのD&D: 終了日も差分保持で移動
        let oldEnd = '', newEnd = '';
        const ev3 = cfg.endProp ? pickAdopted(ed[cfg.endProp]) : null;
        if (ev3 && oldTime && ev3.value) {
          oldEnd = ev3.value;
          const diff = _calcDateDiff(oldTime, newTime, cfg.scale);
          newEnd = _shiftDate(oldEnd, diff, cfg.scale);
          await _apiPutValue(ev3, { new_value: newEnd });
        }
        // undo/redo用にvalオブジェクトのキーをコピー（再読込後も有効）
        const tvRef = tv ? { file: tv.file, property: tv.property, candidate_index: tv.candidate_index } : null;
        const rvRef = rv2 ? { file: rv2.file, property: rv2.property, candidate_index: rv2.candidate_index } : null;
        const evRef = ev3 ? { file: ev3.file, property: ev3.property, candidate_index: ev3.candidate_index } : null;
        historyPush('タイムライン移動: ' + entName,
          async () => {
            if (tvRef) await _apiPutValue(tvRef, { new_value: oldTime });
            if (rvRef) await _apiPutValue(rvRef, { new_value: oldRow });
            if (evRef) await _apiPutValue(evRef, { new_value: oldEnd });
            await selectDatabase(dbPath);
          },
          async () => {
            if (tvRef) await _apiPutValue(tvRef, { new_value: newTimeValue });
            if (rvRef) await _apiPutValue(rvRef, { new_value: newRow });
            if (evRef) await _apiPutValue(evRef, { new_value: newEnd });
            await selectDatabase(dbPath);
          },
          _dbScope()
        );
        selectDatabase(dbPath);
      });

      // エントリカードを配置（endProp 未設定 or endDate なしの点表示）
      const timeKey = isHorizontal ? col : row;
      const rowKey = isHorizontal ? row : col;
      entries.filter(e => {
        if (e.endVal) return false; // 期間バーで表示するのでスキップ
        return roundTimeValue(e.timeVal, cfg.scale) === timeKey && e.rowVal === rowKey;
      }).forEach(e => {
        const card = document.createElement('div');
        card.className = 'tl-card';
        card.dataset.entity = e.name;
        _renderTimelineEntityContent(card, e, cfg);
        card.title = e.name + '\n' + cfg.timeProp + ': ' + e.timeVal;
        const colorVals = filterValues(e.data['色'] || e.data['color'] || []);
        if (colorVals.length > 0 && colorVals[0].value) {
          card.style.background = colorVals[0].value;
          card.style.color = '#fff';
          card.style.borderColor = colorVals[0].value;
        }
        card.draggable = true;
        card.addEventListener('dragstart', (ev) => {
          ev.dataTransfer.setData('text/x-timeline-entity', e.name);
          ev.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('click', () => openEntityInSplit(_entityPath(dbPath, e.name), e.name));
        card.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
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
      const startRound = roundTimeValue(e.timeVal, cfg.scale);
      const endRound = roundTimeValue(e.endVal, cfg.scale);
      const startColIdx = cols.indexOf(isHorizontal ? startRound : e.rowVal);
      const endColIdx = cols.indexOf(isHorizontal ? endRound : e.rowVal);
      const rowIdx = rows.indexOf(isHorizontal ? e.rowVal : startRound);
      const endRowIdx = rows.indexOf(isHorizontal ? e.rowVal : endRound);

      if (startColIdx < 0 || rowIdx < 0) return;

      const bar = document.createElement('div');
      bar.className = 'tl-bar';
      bar.dataset.entity = e.name;

      if (isHorizontal) {
        const span = Math.max(1, endColIdx - startColIdx + 1);
        bar.style.gridRow = (rowIdx + 2) + '';
        bar.style.gridColumn = `${startColIdx + 2} / span ${span}`;
      } else {
        const span = Math.max(1, endRowIdx - rowIdx + 1);
        bar.style.gridRow = `${rowIdx + 2} / span ${span}`;
        bar.style.gridColumn = (startColIdx + 2) + '';
      }

      // 色プロパティ
      const colorVals = filterValues(e.data['色'] || e.data['color'] || []);
      if (colorVals.length > 0 && colorVals[0].value) {
        bar.style.background = colorVals[0].value;
        bar.style.color = '#fff';
      }

      // リサイズハンドル
      const handleL = document.createElement('div');
      handleL.className = 'tl-bar-handle tl-bar-handle-left';
      const label = document.createElement('span');
      label.className = 'tl-bar-label';
      _renderTimelineEntityContent(label, e, cfg, { titleClass: 'tl-bar-title' });
      const handleR = document.createElement('div');
      handleR.className = 'tl-bar-handle tl-bar-handle-right';
      bar.appendChild(handleL);
      bar.appendChild(label);
      bar.appendChild(handleR);

      bar.title = e.name + '\n' + cfg.timeProp + ': ' + e.timeVal + '\n' + (cfg.endProp || cfg.timeProp) + ': ' + e.endVal;
      bar.addEventListener('click', () => openEntityInSplit(_entityPath(dbPath, e.name), e.name));
      bar.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        if (typeof _navPushWithViewState === 'function') _navPushWithViewState(ctx, e.name);
        selectEntity(_entityPath(dbPath, e.name));
      });

      // ドラッグ移動
      bar.draggable = true;
      bar.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/x-timeline-entity', e.name);
        ev.dataTransfer.effectAllowed = 'move';
      });

      // リサイズハンドルのドラッグ処理
      [handleL, handleR].forEach((handle, hIdx) => {
        handle.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          bar.draggable = false;
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
              const targetTime = isHorizontal ? closest.col : closest.row;
              bar.dataset.resizeTarget = targetTime;
              bar.dataset.resizeSide = isLeft ? 'left' : 'right';
            }
          };
          const onUp = async () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            bar.draggable = true;
            const targetTime = bar.dataset.resizeTarget;
            if (!targetTime) return;
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
                let newVal = targetTime;
                if (!cfg.endProp && typeof _dbDateSerializeValue === 'function') {
                  const parsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(oldVal) : null;
                  if (parsed?.range) {
                    newVal = _dbDateSerializeValue(targetTime, parsed.end || '', propTypes[cfg.timeProp] || {}, oldVal);
                  }
                }
                await _apiPutValue(tv, { new_value: newVal });
                _dbUndoValue(cfg.timeProp, tv, oldVal, newVal);
              }
            } else {
              const ev2 = cfg.endProp ? pickAdopted(ed[cfg.endProp]) : null;
              if (ev2) {
                const oldVal = ev2.value || '';
                await _apiPutValue(ev2, { new_value: targetTime });
                _dbUndoValue(cfg.endProp, ev2, oldVal, targetTime);
              } else {
                const tv = pickAdopted(ed[cfg.timeProp]);
                if (tv && typeof _dbDateSerializeValue === 'function') {
                  const oldVal = tv.value || '';
                  const parsed = typeof _dbDateParseValue === 'function' ? _dbDateParseValue(oldVal) : null;
                  if (parsed?.range) {
                    const newVal = _dbDateSerializeValue(parsed.start || '', targetTime, propTypes[cfg.timeProp] || {}, oldVal);
                    await _apiPutValue(tv, { new_value: newVal });
                    _dbUndoValue(cfg.timeProp, tv, oldVal, newVal);
                  }
                }
              }
            }
            selectDatabase(dbPath);
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
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
  const n1 = parseFloat(from), n2 = parseFloat(to);
  if (!isNaN(n1) && !isNaN(n2)) return n2 - n1;
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
      const sec = String(d.getSeconds()).padStart(2, '0');
      const hour = String(d.getHours()).padStart(2, '0');
      switch (scale) {
        case 'second': return localDateTime + ':' + sec;
        case 'minute': return localDateTime;
        case 'hour': return localDate + 'T' + hour + ':00';
        case 'day': return localDate;
        case 'week': {
          const w = new Date(d);
          w.setDate(w.getDate() - w.getDay());
          return typeof formatLocalDate === 'function' ? formatLocalDate(w) : w.toISOString().substring(0, 10);
        }
        case 'month': return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        case 'year': return String(d.getFullYear());
        case 'decade': return String(Math.floor(d.getFullYear()/10)*10) + '年代';
        case 'century': return String(Math.floor(d.getFullYear()/100)+1) + '世紀';
        case 'millennium': return String(Math.floor(d.getFullYear()/1000)*1000) + '年';
        case 'ten_thousand': return String(Math.floor(d.getFullYear()/10000)*10000) + '年';
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

function _compareTimelineGroupValues(a, b) {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  const da = /^\d{4}[-/]\d{2}[-/]\d{2}/.test(sa)
    ? (typeof parseLocalDate === 'function' ? parseLocalDate(sa) : new Date(sa))
    : null;
  const db = /^\d{4}[-/]\d{2}[-/]\d{2}/.test(sb)
    ? (typeof parseLocalDate === 'function' ? parseLocalDate(sb) : new Date(sb))
    : null;
  if (da && db && !isNaN(da.getTime()) && !isNaN(db.getTime())) return da.getTime() - db.getTime();
  const ma = sa.match(/^[+-]?\d+(?:\.\d+)?/);
  const mb = sb.match(/^[+-]?\d+(?:\.\d+)?/);
  if (ma && mb) {
    const na = Number(ma[0]);
    const nb = Number(mb[0]);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }
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
