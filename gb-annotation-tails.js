/**
 * Sticky annotation tails
 * 付箋から外部要素へ伸びる三角形しっぽの描画と追従を管理する。
 */
const AnnotationStickyTail = (() => {
  const tracked = new Set();
  let rafHandle = 0;
  let safetyTimer = null;

  function _cssEscape(value) {
    return (window.CSS && CSS.escape) ? CSS.escape(String(value || '')) : String(value || '').replace(/["\\]/g, '\\$&');
  }

  function _localPoint(note, clientX, clientY) {
    const rect = note.getBoundingClientRect();
    const sx = (note.offsetWidth || rect.width || 1) / Math.max(1, rect.width || note.offsetWidth || 1);
    const sy = (note.offsetHeight || rect.height || 1) / Math.max(1, rect.height || note.offsetHeight || 1);
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  function _sheetCellId(entryName, propName) {
    return JSON.stringify([String(entryName || ''), String(propName || '')]);
  }

  function _parseSheetCellId(id) {
    const raw = String(id || '');
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length >= 2) {
          return [String(parsed[0] || ''), String(parsed[1] || '')];
        }
      } catch {}
    }
    const sep = raw.lastIndexOf('::');
    if (sep < 0) return [raw, ''];
    return [raw.slice(0, sep), raw.slice(sep + 2)];
  }

  function _targetFromPoint(clientX, clientY, note) {
    const elements = document.elementsFromPoint(clientX, clientY)
      .filter(el => el && el !== note && !note.contains(el) && !el.closest?.('.ann-tail-handle,.ann-tail-shape,#ann-toolbar,._note-ctx-menu'));
    for (const el of elements) {
      const board = el.closest?.('.bd-node');
      if (board?.id) return _targetDescriptor('board_card', board.id.replace(/^bdn-/, ''), board, clientX, clientY);
      const snRow = el.closest?.('.sn2-row[data-row-id]');
      if (snRow?.dataset?.rowId) return _targetDescriptor('scriptnote_line', snRow.dataset.rowId, snRow, clientX, clientY);
      const noteLine = el.closest?.('span._nl-id[data-line-id]') || el.querySelector?.('span._nl-id[data-line-id]');
      if (noteLine?.dataset?.lineId) return _targetDescriptor('note_line', noteLine.dataset.lineId, noteLine.parentElement || noteLine, clientX, clientY);
      const sheetCell = el.closest?.('td[data-prop-name]');
      const sheetRow = sheetCell?.closest?.('tr[data-entity-name]');
      if (sheetCell && sheetRow) {
        return _targetDescriptor('sheet_cell', _sheetCellId(sheetRow.dataset.entityName, sheetCell.dataset.propName), sheetCell, clientX, clientY);
      }
      const calendarEvent = el.closest?.('[data-event-id],.cal-event[data-id]');
      const eventId = calendarEvent?.dataset?.eventId || calendarEvent?.dataset?.id || '';
      if (eventId) return _targetDescriptor('calendar_event', eventId, calendarEvent, clientX, clientY);
    }
    return null;
  }

  function _targetDescriptor(kind, id, el, clientX, clientY) {
    const rect = el.getBoundingClientRect();
    const fx = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0.5;
    const fy = rect.height > 0 ? Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) : 0.5;
    return {
      kind,
      id,
      offsetX: (el.offsetWidth || 0) * fx,
      offsetY: (el.offsetHeight || 0) * fy,
      offsetXRatio: fx,
      offsetYRatio: fy,
    };
  }

  function _findTarget(target) {
    if (!target?.kind || !target.id) return null;
    if (target.kind === 'board_card') return document.getElementById('bdn-' + target.id);
    if (target.kind === 'scriptnote_line') return document.querySelector(`.sn2-row[data-row-id="${_cssEscape(target.id)}"]`);
    if (target.kind === 'note_line') return document.querySelector(`span._nl-id[data-line-id="${_cssEscape(target.id)}"]`)?.parentElement || null;
    if (target.kind === 'sheet_cell') {
      const [entryId, propName] = _parseSheetCellId(target.id);
      return document.querySelector(`tr[data-entity-name="${_cssEscape(entryId)}"] td[data-prop-name="${_cssEscape(propName)}"]`);
    }
    if (target.kind === 'calendar_event') {
      return document.querySelector(`[data-event-id="${_cssEscape(target.id)}"],.cal-event[data-id="${_cssEscape(target.id)}"]`);
    }
    return null;
  }

  function _targetClientPoint(target) {
    const el = _findTarget(target);
    if (!el || !el.isConnected) return null;
    const rect = el.getBoundingClientRect();
    const { fx, fy } = _targetOffsetFraction(target, el);
    return {
      x: rect.left + rect.width * fx,
      y: rect.top + rect.height * fy,
    };
  }

  function _tailFromLegacy(note, data) {
    if (data.tail) return data.tail;
    if (data.tailX === undefined || data.tailY === undefined) return null;
    return {
      startX: (note.offsetWidth || data.width || 180) / 2,
      startY: (note.offsetHeight || data.height || 100) / 2,
      endX: Number(data.tailX) + 5,
      endY: Number(data.tailY) + 5,
      target: null,
    };
  }

  function _ensureDom(note) {
    let svg = note.querySelector(':scope > .ann-tail-shape');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('ann-tail-shape');
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      svg.appendChild(polygon);
      note.insertBefore(svg, note.firstChild);
    }
    ['start', 'end'].forEach(which => {
      if (note.querySelector(`:scope > .ann-tail-handle[data-tail-handle="${which}"]`)) return;
      const handle = document.createElement('span');
      handle.className = 'ann-tail-handle';
      handle.dataset.tailHandle = which;
      note.appendChild(handle);
    });
  }

  function _updateDom(note) {
    const ctx = note._annTailCtx;
    const tail = ctx?.data?.tail || null;
    if (!tail) {
      note.querySelectorAll(':scope > .ann-tail-shape,:scope > .ann-tail-handle').forEach(el => el.remove());
      return;
    }
    _ensureDom(note);
    const color = ctx.getColor?.() || note.style.background || '#c48080';
    const sx = Number(tail.startX) || 0;
    const sy = Number(tail.startY) || 0;
    const ex = Number(tail.endX) || 0;
    const ey = Number(tail.endY) || 0;
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const half = 8;
    const nx = -dy / len;
    const ny = dx / len;
    const points = [
      [sx + nx * half, sy + ny * half],
      [sx - nx * half, sy - ny * half],
      [ex, ey],
    ].map(p => p.map(v => Number(v).toFixed(2)).join(',')).join(' ');
    const polygon = note.querySelector(':scope > .ann-tail-shape polygon');
    polygon.setAttribute('points', points);
    polygon.setAttribute('fill', color);
    polygon.setAttribute('stroke', color);
    polygon.setAttribute('stroke-width', '1');
    note.querySelector(':scope > .ann-tail-handle[data-tail-handle="start"]').style.cssText = `left:${sx - 5}px;top:${sy - 5}px;`;
    note.querySelector(':scope > .ann-tail-handle[data-tail-handle="end"]').style.cssText = `left:${ex - 5}px;top:${ey - 5}px;`;
  }

  function _setTail(note, tail, persist) {
    const ctx = note._annTailCtx;
    if (!ctx) return;
    const prevTarget = ctx.data.tail?.target || null;
    const nextTarget = tail?.target || null;
    const targetChanged = JSON.stringify(prevTarget || null) !== JSON.stringify(nextTarget || null);
    ctx.data.tail = tail;
    delete ctx.data.tailX;
    delete ctx.data.tailY;
    ctx.lastTargetClient = null;
    ctx.lastNoteClient = null;
    if (targetChanged) ctx.lastTargetLayout = null;
    _updateDom(note);
    persist?.();
  }

  function _removeTail(note, persist) {
    const ctx = note._annTailCtx;
    if (!ctx) return;
    delete ctx.data.tail;
    delete ctx.data.tailX;
    delete ctx.data.tailY;
    ctx.lastTargetClient = null;
    ctx.lastNoteClient = null;
    ctx.lastTargetLayout = null;
    _updateDom(note);
    persist?.();
  }

  function _isAnnotationToolbarActive() {
    const toolbar = document.getElementById('ann-toolbar');
    return !!toolbar && toolbar.classList.contains('visible');
  }

  function _installDrag(note, persist) {
    note.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest?.('.ann-tail-handle');
      if (handle && e.button === 0) {
        if (!_isAnnotationToolbarActive()) return;
        e.preventDefault();
        e.stopPropagation();
        _dragHandle(note, handle.dataset.tailHandle, e, persist);
        return;
      }
      if (!e.altKey || e.button !== 0 || e.target.closest?.('button,.ann-note-resize-handle,.gb-fmt-popup')) return;
      e.preventDefault();
      e.stopPropagation();
      const start = _localPoint(note, e.clientX, e.clientY);
      const draft = { startX: start.x, startY: start.y, endX: start.x, endY: start.y, target: null };
      _setTail(note, draft, null);
      const onMove = (ev) => {
        const pt = _localPoint(note, ev.clientX, ev.clientY);
        Object.assign(draft, { endX: pt.x, endY: pt.y });
        _updateDom(note);
      };
      const onUp = (ev) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        const noteRect = note.getBoundingClientRect();
        const outside = ev.clientX < noteRect.left || ev.clientX > noteRect.right || ev.clientY < noteRect.top || ev.clientY > noteRect.bottom;
        if (!outside) {
          _removeTail(note, null);
          return;
        }
        draft.target = _targetFromPoint(ev.clientX, ev.clientY, note);
        _setTail(note, draft, persist);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  function _dragHandle(note, which, startEvent, persist) {
    const ctx = note._annTailCtx;
    const tail = ctx?.data?.tail;
    if (!tail) return;
    const onMove = (ev) => {
      const pt = _localPoint(note, ev.clientX, ev.clientY);
      if (which === 'start') {
        tail.startX = pt.x;
        tail.startY = pt.y;
      } else {
        tail.endX = pt.x;
        tail.endY = pt.y;
        tail.target = null;
      }
      _updateDom(note);
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (which === 'end') tail.target = _targetFromPoint(ev.clientX, ev.clientY, note);
      _setTail(note, tail, persist);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function _finiteNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function _elementLayoutPos(el) {
    if (!el) return null;
    let x = 0;
    let y = 0;
    let current = el;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < 64) {
      x += _finiteNumber(current.offsetLeft, 0);
      y += _finiteNumber(current.offsetTop, 0);
      current = current.offsetParent;
      depth += 1;
    }
    return { x, y };
  }

  function _targetOffsetFraction(target, targetEl) {
    const w = targetEl.offsetWidth || 1;
    const h = targetEl.offsetHeight || 1;
    const fx = (target.offsetXRatio != null && !Number.isNaN(Number(target.offsetXRatio)))
      ? Math.max(0, Math.min(1, Number(target.offsetXRatio)))
      : Math.max(0, Math.min(1, _finiteNumber(target.offsetX, w / 2) / w));
    const fy = (target.offsetYRatio != null && !Number.isNaN(Number(target.offsetYRatio)))
      ? Math.max(0, Math.min(1, Number(target.offsetYRatio)))
      : Math.max(0, Math.min(1, _finiteNumber(target.offsetY, h / 2) / h));
    return { fx, fy };
  }

  function _targetLayoutPoint(target, targetEl) {
    const pos = _elementLayoutPos(targetEl);
    if (!pos) return null;
    const { fx, fy } = _targetOffsetFraction(target, targetEl);
    return {
      x: pos.x + (targetEl.offsetWidth || 0) * fx,
      y: pos.y + (targetEl.offsetHeight || 0) * fy,
    };
  }

  function _refreshTargets() {
    tracked.forEach(note => {
      if (!note.isConnected) { tracked.delete(note); return; }
      const ctx = note._annTailCtx;
      const tail = ctx?.data?.tail;
      if (!tail?.target) return;
      const targetEl = _findTarget(tail.target);
      if (!targetEl || !targetEl.isConnected) {
        // ターゲット要素が一時的に DOM に存在しない (ボード再レンダ直後等) 場合があるため、
        // 自動削除はせず、この tick ではスキップして次の tick で再試行する。
        // 以前は _removeTail を呼んでいたが、その結果 persist が走り
        // バックエンドの data.tail を消してしまっていた (保存直後に別セッションで開くと
        // しっぽが消える不具合の原因)。
        return;
      }
      // offsetParent 由来のレイアウト座標は CSS transform、表示倍率、スクロール表示位置の
      // 影響を受けないため、「対象そのものが実際に移動した」場合だけを検出できる。
      const targetLayout = _targetLayoutPoint(tail.target, targetEl);
      const clientPt = _targetClientPoint(tail.target);
      if (targetLayout && ctx.lastTargetLayout) {
        const layoutDx = targetLayout.x - ctx.lastTargetLayout.x;
        const layoutDy = targetLayout.y - ctx.lastTargetLayout.y;
        if (Math.abs(layoutDx) > 0.5 || Math.abs(layoutDy) > 0.5) {
          // note.style.left/top および data.x/y は表示座標ではなくコンテンツ座標で管理する。
          // ここで client 座標を使うとパン、ズーム、スクロールだけで保存位置が汚れる。
          note.style.left = (note.offsetLeft + layoutDx) + 'px';
          note.style.top = (note.offsetTop + layoutDy) + 'px';
          ctx.data.x = (Number(ctx.data.x) || 0) + layoutDx;
          ctx.data.y = (Number(ctx.data.y) || 0) + layoutDy;
          note.dataset.baseX = String(ctx.data.x);
          note.dataset.baseY = String(ctx.data.y);
          clearTimeout(ctx.followSaveTimer);
          ctx.followSaveTimer = window.setTimeout(() => ctx.persist?.(), 300);
        }
      }
      if (targetLayout) ctx.lastTargetLayout = targetLayout;
      if (clientPt) {
        ctx.lastTargetClient = clientPt;
        const clientLocal = _localPoint(note, clientPt.x, clientPt.y);
        tail.endX = clientLocal.x;
        tail.endY = clientLocal.y;
      }
      _updateDom(note);
    });
  }

  function _tick() {
    rafHandle = 0;
    if (!tracked.size) {
      if (safetyTimer) { window.clearInterval(safetyTimer); safetyTimer = null; }
      return;
    }
    _refreshTargets();
    rafHandle = window.requestAnimationFrame(_tick);
  }

  function _ensureTimer() {
    // rAF ループで 60fps に追従させる (setInterval 700ms だと付箋ドラッグ中に
    // 終点がズレて元に戻るような遅延が見え、ターゲットカードを動かした時も
    // 一拍遅れて付箋が追従する体感になっていた)。
    if (!rafHandle && tracked.size) {
      rafHandle = window.requestAnimationFrame(_tick);
    }
    // 安全網: rAF が止まっている (タブ非可視等) 間も、再可視化時に
    // レイアウト変化を拾えるよう低頻度のインターバルで補完する。
    if (!safetyTimer && tracked.size) safetyTimer = window.setInterval(_refreshTargets, 1500);
  }

  function install(note, options) {
    if (!note || note._annTailInstalled) return;
    note._annTailInstalled = true;
    note._annTailCtx = {
      data: options.data,
      persist: options.persist,
      getColor: options.getColor,
    };
    const tail = _tailFromLegacy(note, options.data);
    if (tail) options.data.tail = tail;
    tracked.add(note);
    _ensureTimer();
    _installDrag(note, options.persist);
    _updateDom(note);
  }

  function setTail(note, tail, persist) {
    if (!note?._annTailCtx) return;
    _setTail(note, tail, persist || note._annTailCtx.persist);
  }

  function removeTail(note, persist) {
    _removeTail(note, persist || note?._annTailCtx?.persist);
  }

  return { install, setTail, removeTail, refresh: _refreshTargets };
})();
