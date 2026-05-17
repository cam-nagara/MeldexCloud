/* タイムライン行/列軸ヘッダーの並べ替え */

function _applyTimelineRowOrder(rowArr, cfg) {
  const order = Array.isArray(cfg?.rowOrder) ? cfg.rowOrder : [];
  if (order.length === 0) return rowArr;
  const byKey = new Map(rowArr.map(value => [_timelineColKey(value), value]));
  const used = new Set();
  const ordered = [];
  order.forEach(value => {
    const key = _timelineColKey(value);
    if (!byKey.has(key) || used.has(key)) return;
    ordered.push(byKey.get(key));
    used.add(key);
  });
  rowArr.forEach(value => {
    const key = _timelineColKey(value);
    if (used.has(key)) return;
    ordered.push(value);
    used.add(key);
  });
  return ordered;
}

function _moveTimelineOrderedValue(values, fromValue, toValue) {
  const fromKey = _timelineColKey(fromValue);
  const toKey = _timelineColKey(toValue);
  if (fromKey === toKey) return null;
  const next = values.slice();
  const fromIdx = next.findIndex(value => _timelineColKey(value) === fromKey);
  const toIdx = next.findIndex(value => _timelineColKey(value) === toKey);
  if (fromIdx < 0 || toIdx < 0) return null;
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

function _setTimelineRowOrder(dbPath, cfg, ordered, options = {}) {
  const base = dbPath && typeof getTimelineConfig === 'function' ? getTimelineConfig(dbPath) : (cfg || {});
  const next = { ...base, rowOrder: ordered.map(value => _timelineColKey(value)) };
  setTimelineConfig(dbPath, next, {
    label: options.label || 'シート表示: タイムラインヘッダー順',
    detail: options.detail || '',
    skipHistory: options.skipHistory === true,
  });
}

function _bindTimelineHeaderReorder(el, dbPath, cfg, rowArr, value, ctx) {
  el.draggable = true;
  el.classList.add('tl-axis-sortable');
  el.dataset.tlAxisValue = _timelineColKey(value);
  el.title = String(value || '') + '\nドラッグで並べ替え';
  el.addEventListener('dragstart', (ev) => {
    if (ev.target?.closest?.('.tl-col-resize-handle, .tl-header-more-btn')) {
      ev.preventDefault();
      return;
    }
    ev.dataTransfer.setData('text/x-timeline-row-header', JSON.stringify({ value: _timelineColKey(value) }));
    ev.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    document.querySelectorAll('.tl-header-cell.drag-over-tab').forEach(node => node.classList.remove('drag-over-tab'));
  });
  el.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-over-tab');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over-tab'));
  el.addEventListener('drop', (ev) => {
    ev.preventDefault();
    el.classList.remove('drag-over-tab');
    const payload = ev.dataTransfer.getData('text/x-timeline-row-header');
    if (!payload) return;
    let fromValue = '';
    try { fromValue = JSON.parse(payload)?.value ?? ''; } catch { fromValue = payload; }
    const ordered = _moveTimelineOrderedValue(rowArr, fromValue, value);
    if (!ordered) return;
    _setTimelineRowOrder(dbPath, cfg, ordered, { detail: `${fromValue} → ${_timelineColKey(value)}` });
    renderTimeline(ctx);
  });
}
