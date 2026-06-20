/* タイムラインヘッダーメニュー・ビュー別条件付きカラー */

const TL_AXIS_CONDITIONAL_COLOR_KEY = '__timelineAxisColors';

function _timelineColorKey(kind, value) {
  const prefix = kind === 'time' ? 'time' : 'axis';
  const raw = typeof _timelineColKey === 'function' ? _timelineColKey(value) : String(value ?? '');
  return prefix + ':' + raw;
}

function _getTimelineAxisColorMap(dbPath, ctx = null) {
  const colors = typeof getConditionalColors === 'function' ? getConditionalColors(dbPath, { ctx }) : {};
  const map = colors?.[TL_AXIS_CONDITIONAL_COLOR_KEY];
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

function _getTimelineAxisColorFromMap(map, value, kind = 'axis') {
  if (!map || typeof map !== 'object') return null;
  const key = _timelineColorKey(kind, value);
  const legacyKey = typeof _timelineColKey === 'function' ? _timelineColKey(value) : String(value ?? '');
  const raw = map[key] || (kind === 'axis' ? map[legacyKey] : null);
  if (!raw || typeof raw !== 'object') return null;
  const bg = String(raw.bg || '').trim();
  if (!bg) return null;
  return { bg, fg: String(raw.fg || '#ffffff').trim() || '#ffffff' };
}

function _saveTimelineAxisColorMap(dbPath, nextMap, detail, ctx = null) {
  const colors = { ...(typeof getConditionalColors === 'function' ? getConditionalColors(dbPath, { ctx }) : {}) };
  const clean = {};
  Object.entries(nextMap || {}).forEach(([key, value]) => {
    const bg = String(value?.bg || '').trim();
    if (!bg) return;
    clean[key] = { bg, fg: String(value?.fg || '#ffffff').trim() || '#ffffff' };
  });
  if (Object.keys(clean).length) colors[TL_AXIS_CONDITIONAL_COLOR_KEY] = clean;
  else delete colors[TL_AXIS_CONDITIONAL_COLOR_KEY];
  if (typeof setConditionalColors === 'function') {
    setConditionalColors(dbPath, colors, {
      label: 'シート表示: 条件付きカラー',
      detail: detail || 'タイムライン',
      ctx,
    });
  }
}

function _setTimelineHeaderColor(dbPath, kind, value, color, ctx) {
  const next = { ..._getTimelineAxisColorMap(dbPath, ctx) };
  next[_timelineColorKey(kind, value)] = color;
  _saveTimelineAxisColorMap(dbPath, next, `タイムライン: ${value}`, ctx);
  if (typeof renderTimeline === 'function') renderTimeline(ctx);
}

function _clearTimelineHeaderColor(dbPath, kind, value, ctx) {
  const next = { ..._getTimelineAxisColorMap(dbPath, ctx) };
  delete next[_timelineColorKey(kind, value)];
  if (kind === 'axis') {
    const legacyKey = typeof _timelineColKey === 'function' ? _timelineColKey(value) : String(value ?? '');
    delete next[legacyKey];
  }
  _saveTimelineAxisColorMap(dbPath, next, `タイムライン解除: ${value}`, ctx);
  if (typeof renderTimeline === 'function') renderTimeline(ctx);
}

function _clearAllTimelineHeaderColors(dbPath, ctx) {
  _saveTimelineAxisColorMap(dbPath, {}, 'タイムライン全解除', ctx);
  if (typeof renderTimeline === 'function') renderTimeline(ctx);
}

function _applyTimelineAxisColor(el, color) {
  if (!el || !color?.bg) return;
  el.classList.add('tl-axis-colored');
  el.style.setProperty('--tl-axis-bg', color.bg);
  el.style.setProperty('--tl-axis-fg', color.fg || '#ffffff');
}

function _timelineHeaderMenuClose() {
  if (typeof closeColHeaderMenu === 'function') closeColHeaderMenu();
  else document.querySelectorAll('.gb-context-menu').forEach(el => el.remove());
}

function _applyTimelineValueOrder(values, order) {
  const saved = Array.isArray(order) ? order : [];
  if (saved.length === 0) return values;
  const byKey = new Map(values.map(value => [_timelineColKey(value), value]));
  const used = new Set();
  const out = [];
  saved.forEach(value => {
    const key = _timelineColKey(value);
    if (!byKey.has(key) || used.has(key)) return;
    out.push(byKey.get(key));
    used.add(key);
  });
  values.forEach(value => {
    const key = _timelineColKey(value);
    if (used.has(key)) return;
    out.push(value);
    used.add(key);
  });
  return out;
}

function _applyTimelineTimeOrder(timeArr, cfg) {
  return _applyTimelineValueOrder(timeArr, cfg?.timeOrder);
}

function _setTimelineTimeOrder(dbPath, cfg, ordered, options = {}) {
  const next = { ...cfg, timeOrder: ordered.map(value => _timelineColKey(value)) };
  setTimelineConfig(dbPath, next, {
    label: options.label || 'シート表示: タイムライン時間順',
    detail: options.detail || '',
    skipHistory: options.skipHistory === true,
    ctx: options.ctx || null,
  });
}

function _sortTimelineValues(dbPath, cfg, values, kind, dir, ctx) {
  const ordered = values.slice().sort(_compareTimelineGroupValues);
  if (dir === 'desc') ordered.reverse();
  const detail = dir === 'desc' ? '降順' : '昇順';
  if (kind === 'time') _setTimelineTimeOrder(dbPath, cfg, ordered, { detail, ctx });
  else if (typeof _setTimelineRowOrder === 'function') _setTimelineRowOrder(dbPath, cfg, ordered, { detail, ctx });
  else setTimelineConfig(dbPath, { ...cfg, rowOrder: ordered.map(value => _timelineColKey(value)) }, { label: 'シート表示: タイムラインヘッダー順', detail, ctx });
  if (typeof renderTimeline === 'function') renderTimeline(ctx);
}

function _resetTimelineOrder(dbPath, cfg, kind, ctx) {
  const next = { ...cfg };
  if (kind === 'time') next.timeOrder = [];
  else next.rowOrder = [];
  setTimelineConfig(dbPath, next, {
    label: kind === 'time' ? 'シート表示: タイムライン時間順' : 'シート表示: タイムラインヘッダー順',
    detail: 'リセット',
    ctx,
  });
  if (typeof renderTimeline === 'function') renderTimeline(ctx);
}

function _timelineWidthTarget(options) {
  if (options?.isCorner || options?.isRowHeader) return '__rowHeader';
  return options?.value;
}

async function _promptTimelineColumnWidth(dbPath, options) {
  const target = _timelineWidthTarget(options);
  const cfg = getTimelineConfig(dbPath, { ctx: options.ctx || null });
  const current = target === '__rowHeader' ? _timelineCornerWidth(cfg) : _timelineColWidth(cfg, target);
  const raw = typeof cfPrompt === 'function'
    ? await cfPrompt('列幅(px)', String(current), { okLabel: '適用' })
    : window.prompt('列幅(px)', String(current));
  if (raw == null) return;
  const width = Number(raw);
  if (!Number.isFinite(width)) {
    if (typeof showStatus === 'function') showStatus('列幅は数値で入力してください', true);
    return;
  }
  const minWidth = target === '__rowHeader' ? 80 : 60;
  _setTimelineColWidth(dbPath, cfg, target, Math.max(minWidth, Math.min(640, width)), { detail: String(target || ''), ctx: options.ctx || null });
  if (typeof renderTimeline === 'function') renderTimeline(options.ctx);
}

function _resetTimelineColumnWidth(dbPath, options) {
  const target = _timelineWidthTarget(options);
  const cfg = getTimelineConfig(dbPath, { ctx: options.ctx || null });
  const next = { ...cfg, colWidths: { ...(cfg.colWidths || {}) } };
  delete next.colWidths[_timelineColKey(target)];
  setTimelineConfig(dbPath, next, {
    label: 'シート表示: タイムライン列幅',
    detail: 'リセット: ' + String(target || ''),
    ctx: options.ctx || null,
  });
  if (typeof renderTimeline === 'function') renderTimeline(options.ctx);
}

function _autoFitTimelineColumnFromMenu(dbPath, options) {
  const target = _timelineWidthTarget(options);
  if (typeof autoFitTimelineColumn === 'function') {
    autoFitTimelineColumn(options.ctx, dbPath, target);
  } else if (typeof autoFitTimelineColumns === 'function') {
    autoFitTimelineColumns(options.ctx, dbPath);
  }
}

function _renderTimelineHeaderContent(el, label, options = {}) {
  el.textContent = '';
  const labelEl = document.createElement('span');
  labelEl.className = 'tl-header-label';
  labelEl.textContent = String(label ?? '');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tl-header-more-btn';
  btn.title = 'タイムラインメニュー';
  btn.setAttribute('aria-label', 'タイムラインメニュー');
  const e2eKey = encodeURIComponent(String(options.value ?? label ?? 'root')).replace(/%/g, '').slice(0, 64) || 'root';
  btn.setAttribute('data-e2e-id', 'timeline-header-menu-' + (options.kind || 'corner') + '-' + e2eKey);
  btn.draggable = false;
  btn.innerHTML = typeof lucide === 'function' ? lucide('ellipsis', 12) : '...';
  btn.addEventListener('pointerdown', ev => ev.stopPropagation());
  btn.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    _showTimelineHeaderMenu(btn, { ...options, label });
  });
  el.appendChild(labelEl);
  el.appendChild(btn);
}

function _setupTimelineHeaderCell(el, label, options = {}, axisColors = {}) {
  if (typeof _renderTimelineHeaderContent === 'function') _renderTimelineHeaderContent(el, label, options);
  else el.textContent = String(label ?? '');
  if ((options.kind === 'axis' || options.kind === 'time') && typeof _applyTimelineAxisColor === 'function') {
    _applyTimelineAxisColor(el, _getTimelineAxisColorFromMap(axisColors, options.value ?? label, options.kind));
  }
}

function _applyTimelineVisibleColor(el, axisColors, axisValue, timeValue) {
  if (typeof _applyTimelineAxisColor !== 'function') return;
  _applyTimelineAxisColor(el,
    _getTimelineAxisColorFromMap(axisColors, axisValue, 'axis')
    || _getTimelineAxisColorFromMap(axisColors, timeValue, 'time'));
}

function _timelineHeaderMenuItems(dbPath, options) {
  const cfg = getTimelineConfig(dbPath, { ctx: options.ctx || null });
  const kind = options.kind === 'time' ? 'time' : (options.kind === 'axis' ? 'axis' : '');
  const values = kind === 'time' ? (options.timeValues || []) : (options.axisValues || []);
  const icon = (name) => typeof lucide === 'function' ? lucide(name, 14) + ' ' : '';
  const items = [];

  if (kind) {
    const currentColor = _getTimelineAxisColorFromMap(_getTimelineAxisColorMap(dbPath, options.ctx || null), options.value, kind);
    items.push({
      label: icon('palette') + (kind === 'time' ? 'この時間を色付け...' : 'この列/行を色付け...'),
      action: () => _showTimelineHeaderColorModal(dbPath, kind, options.value, currentColor, options.ctx),
    });
    if (currentColor) {
      items.push({
        label: icon('eraser') + 'この色を解除',
        action: () => _clearTimelineHeaderColor(dbPath, kind, options.value, options.ctx),
      });
    }
    if (values.length > 1) {
      items.push({
        type: 'submenu',
        label: icon('arrowUpDown') + '並び替え',
        children: [
          { label: icon('arrowUp') + '昇順', action: () => _sortTimelineValues(dbPath, cfg, values, kind, 'asc', options.ctx) },
          { label: icon('arrowDown') + '降順', action: () => _sortTimelineValues(dbPath, cfg, values, kind, 'desc', options.ctx) },
          { label: icon('rotateCcw') + '手動順をリセット', action: () => _resetTimelineOrder(dbPath, cfg, kind, options.ctx) },
        ],
      });
    }
    items.push({ type: 'sep' });
  }

  items.push({
    type: 'submenu',
    label: icon('columns') + '列幅',
    children: [
      { label: icon('maximize2') + 'この列を自動調整', action: () => _autoFitTimelineColumnFromMenu(dbPath, options) },
      { label: icon('columns') + '幅を指定...', action: () => _promptTimelineColumnWidth(dbPath, options) },
      { label: icon('rotateCcw') + '列幅をリセット', action: () => _resetTimelineColumnWidth(dbPath, options) },
      { type: 'sep' },
      { label: icon('maximize2') + '全列を自動調整', action: () => autoFitTimelineColumns(options.ctx, dbPath) },
    ],
  });

  if (Object.keys(_getTimelineAxisColorMap(dbPath, options.ctx || null)).length) {
    items.push({ type: 'sep' });
    items.push({
      label: icon('eraser') + 'タイムライン色を全解除',
      action: () => _clearAllTimelineHeaderColors(dbPath, options.ctx),
    });
  }

  return items;
}

function _showTimelineHeaderMenu(anchor, options = {}) {
  const dbPath = options.dbPath || state.currentDbPath;
  if (!dbPath) return;
  _timelineHeaderMenuClose();
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu tl-header-menu';
  const items = _timelineHeaderMenuItems(dbPath, options);
  if (typeof _renderColMenuItems === 'function') _renderColMenuItems(menu, items);
  document.body.appendChild(menu);
  const rect = anchor?.getBoundingClientRect?.() || { left: 0, right: 0, top: 0, bottom: 0 };
  if (typeof positionPopup === 'function') positionPopup(menu, rect, { prefer: 'below' });
  else {
    menu.style.position = 'fixed';
    menu.style.left = rect.left + 'px';
    menu.style.top = rect.bottom + 'px';
  }
  setTimeout(() => {
    const closer = (ev) => {
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAny) {
        _timelineHeaderMenuClose();
        document.removeEventListener('pointerdown', closer);
      }
    };
    document.addEventListener('pointerdown', closer);
  }, 0);
}

function _showTimelineHeaderColorModal(dbPath, kind, value, currentColor, ctx) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal tl-color-modal">
    <h3>タイムライン条件付きカラー</h3>
    <div class="field"><label>対象</label><div class="tl-color-target"></div></div>
    <div class="tl-color-row">
      <div class="field"><label>背景色</label><button type="button" class="gb-fmt-swatch-bg tl-color-bg"></button></div>
      <div class="field"><label>文字色</label><button type="button" class="gb-fmt-swatch-fg tl-color-fg"></button></div>
    </div>
    <div class="btn-row">
      <button type="button" class="tl-color-cancel">キャンセル</button>
      <button type="button" class="tl-color-apply primary">適用</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.tl-color-target').textContent = (kind === 'time' ? '時間: ' : '列/行: ') + String(value ?? '');
  const bg = overlay.querySelector('.tl-color-bg');
  const fg = overlay.querySelector('.tl-color-fg');
  const initialBg = currentColor?.bg || '#2980b9';
  const initialFg = currentColor?.fg || '#ffffff';
  if (typeof setColorSwatchValue === 'function') {
    setColorSwatchValue(bg, initialBg);
    setColorSwatchValue(fg, initialFg);
  } else {
    bg.dataset.color = initialBg;
    fg.dataset.color = initialFg;
  }
  if (typeof bindColorSwatch === 'function') {
    bindColorSwatch(bg, () => getColorSwatchValue(bg, initialBg), next => setColorSwatchValue(bg, next || initialBg));
    bindColorSwatch(fg, () => getColorSwatchValue(fg, initialFg), next => setColorSwatchValue(fg, next || initialFg));
  }
  overlay.querySelector('.tl-color-cancel')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('.tl-color-apply')?.addEventListener('click', () => {
    const next = {
      bg: typeof getColorSwatchValue === 'function' ? getColorSwatchValue(bg, initialBg) : (bg.dataset.color || initialBg),
      fg: typeof getColorSwatchValue === 'function' ? getColorSwatchValue(fg, initialFg) : (fg.dataset.color || initialFg),
    };
    overlay.remove();
    _setTimelineHeaderColor(dbPath, kind, value, next, ctx);
  });
}
