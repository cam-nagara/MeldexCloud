/* gb-board-find.js: ボードの検索 / 置換バー (旧 gb-canvas-features.part01.js から分離) */

// --- 検索・置換バー ---
// モーダルダイアログではなく、キャンバス上に非モーダルで表示される検索バー。
// Ctrl+F: 検索のみモードで開く / Ctrl+H: 置換行も展開して開く。
// Enter: 次へ、Shift+Enter: 前へ、Escape: 閉じる。
function bdOpenFindBar(mode) {
  _bdCommitActiveBoardTextEditBeforeFind();
  let bar = document.getElementById('bd-find-bar');
  if (!bar) bar = _bdCreateFindBar();
  bar.style.display = '';
  const rr = bar.querySelector('.bd-find-replace-row');
  if (rr) rr.style.display = (mode === 'replace') ? '' : 'none';
  const q = bar.querySelector('#bd-find-q');
  if (q) { q.focus(); q.select(); }
  // バーを開いた時点で現在値の検索を再実行
  if (q && q.value) _bdFindUpdateMatches(q.value);
}
function bdCloseFindBar() {
  const bar = document.getElementById('bd-find-bar');
  if (bar) bar.style.display = 'none';
  // ハイライトをクリアして元のテキスト表示に戻す
  _bdApplyFindHighlight('');
  bd._findMatches = null;
  bd._findQuery = '';
  const canvas = document.getElementById('bd-canvas');
  if (canvas) canvas.focus();
}
function _bdCommitActiveBoardTextEditBeforeFind() {
  const bar = document.getElementById('bd-find-bar');
  const active = document.activeElement;
  if (bar && active && bar.contains(active)) return;
  if (typeof bd !== 'undefined' && bd.editing && typeof bdFinishEdit === 'function') {
    bdFinishEdit();
    return;
  }
  if (active?.isContentEditable && !(bar && bar.contains(active))) {
    try { active.blur(); } catch {}
  }
}
function _bdCreateFindBar() {
  const bar = document.createElement('div');
  bar.id = 'bd-find-bar';
  bar.className = 'bd-find-bar';
  bar.innerHTML = `
    <div class="bd-find-bar-row">
      <input type="text" id="bd-find-q" class="bd-find-input" placeholder="検索">
      <span id="bd-find-count" class="bd-find-count">0 件</span>
      <button type="button" id="bd-find-prev" class="bd-find-btn" title="前へ (Shift+Enter)">&#x25B2;</button>
      <button type="button" id="bd-find-next" class="bd-find-btn" title="次へ (Enter)">&#x25BC;</button>
      <button type="button" id="bd-find-close" class="bd-find-btn" title="閉じる (Esc)">&#x2715;</button>
    </div>
    <div class="bd-find-bar-row bd-find-replace-row" style="display:none;">
      <input type="text" id="bd-find-r" class="bd-find-input" placeholder="置換">
      <button type="button" id="bd-find-replace-one" class="bd-find-btn" title="現在の項目を置換">置換</button>
      <button type="button" id="bd-find-replace-all" class="bd-find-btn" title="全て置換">全置換</button>
    </div>
  `;
  const host = document.getElementById('bd-canvas') || document.body;
  host.appendChild(bar);
  // 検索バー内の pointer / click / dblclick を canvas 側に伝播させない。
  // bd-canvas の pointerdown ハンドラーが発火すると入力欄にフォーカスが移らず、範囲選択等が始まってしまう。
  ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'contextmenu'].forEach(t => {
    bar.addEventListener(t, (ev) => ev.stopPropagation());
  });
  const q = bar.querySelector('#bd-find-q');
  const rInp = bar.querySelector('#bd-find-r');
  // 検索バー入力中でも Ctrl+F / Ctrl+H を捕捉する (ブラウザのネイティブ検索ダイアログ発動を抑止)
  const handleFindShortcut = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey) {
      const lk = (ev.key || '').toLowerCase();
      if (lk === 'f') { ev.preventDefault(); ev.stopPropagation(); bdOpenFindBar('find'); return true; }
      if (lk === 'h') { ev.preventDefault(); ev.stopPropagation(); bdOpenFindBar('replace'); return true; }
    }
    return false;
  };
  q.addEventListener('input', () => _bdFindUpdateMatches(q.value));
  q.addEventListener('keydown', (ev) => {
    if (handleFindShortcut(ev)) return;
    if (ev.key === 'Enter') { ev.preventDefault(); ev.shiftKey ? _bdFindPrev() : _bdFindNext(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); bdCloseFindBar(); }
    ev.stopPropagation();
  });
  rInp.addEventListener('keydown', (ev) => {
    if (handleFindShortcut(ev)) return;
    if (ev.key === 'Enter') { ev.preventDefault(); _bdFindReplaceOne(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); bdCloseFindBar(); }
    ev.stopPropagation();
  });
  bar.querySelector('#bd-find-prev').addEventListener('click', _bdFindPrev);
  bar.querySelector('#bd-find-next').addEventListener('click', _bdFindNext);
  bar.querySelector('#bd-find-close').addEventListener('click', bdCloseFindBar);
  bar.querySelector('#bd-find-replace-one').addEventListener('click', _bdFindReplaceOne);
  bar.querySelector('#bd-find-replace-all').addEventListener('click', _bdFindReplaceAll);
  return bar;
}
function _bdFindUpdateMatches(query) {
  bd._findQuery = query || '';
  bd._findMatches = [];
  bd._findIndex = 0;
  if (!query) { _bdFindUpdateUI(); _bdApplyFindHighlight(''); return; }
  bd.nodes.forEach(n => {
    if (!n.text || !document.getElementById('bdn-' + n.id)) return;
    _bdFindOccurrences(n.text, query).forEach((start, occurrence) => {
      bd._findMatches.push({ type: 'node', id: n.id, occurrence, start });
    });
  });
  bd.connections.forEach(c => {
    if (!c.label || !_bdFindConnLabelElements(c.id).length) return;
    _bdFindOccurrences(c.label, query).forEach((start, occurrence) => {
      bd._findMatches.push({ type: 'conn', id: c.id, occurrence, start });
    });
  });
  _bdFindUpdateUI();
  _bdApplyFindHighlight(query);
  _bdFindScrollToCurrent();
}
function _bdFindShowCurrent() {
  // 現在フォーカスのマッチだけ強調色が変わるよう、マーク全体を再描画
  _bdApplyFindHighlight(bd._findQuery);
  _bdFindScrollToCurrent();
}
// カード全体 / ラインの選択 (bd.selected) には手を出さず、現在マッチのカードがビュー外なら
// ズームは変えずに panX/Y を調整してビューに収める。
function _bdFindScrollToCurrent() {
  const cur = bd._findMatches && bd._findMatches[bd._findIndex];
  if (!cur) return;
  if (cur.type === 'conn') {
    const c = bd.connections.find(x => x.id === cur.id);
    const rect = _bdFindConnectionWorldRect(c);
    if (!rect) return;
    _bdFindEnsureWorldRectVisible(rect.x, rect.y, rect.w, rect.h);
    return;
  }
  const n = bd.nodes.find(x => x.id === cur.id);
  if (!n) return;
  const canvasEl = document.getElementById('bd-canvas');
  const el = document.getElementById('bdn-' + n.id);
  if (!canvasEl || !el) return;
  const nw = el.offsetWidth, nh = el.offsetHeight;
  const pos = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(n) : { x: n.x, y: n.y };
  _bdFindEnsureWorldRectVisible(pos.x, pos.y, nw, nh);
}
function _bdFindNodeCenter(node) {
  if (!node) return null;
  const pos = typeof bdAbsolutePosition === 'function' ? bdAbsolutePosition(node) : { x: node.x, y: node.y };
  const el = document.getElementById('bdn-' + node.id);
  return {
    x: (Number(pos.x) || 0) + ((el?.offsetWidth || node._rw || node.w || 160) / 2),
    y: (Number(pos.y) || 0) + ((el?.offsetHeight || node._rh || node.h || 36) / 2),
  };
}
function _bdFindConnectionEndpoint(conn, side) {
  if (!conn) return null;
  const nodeId = side === 'from' ? conn.from : conn.to;
  const node = nodeId ? bd.nodes.find(x => x.id === nodeId) : null;
  if (node) return _bdFindNodeCenter(node);
  const point = typeof bdNormalizeConnectionPoint === 'function'
    ? bdNormalizeConnectionPoint(side === 'from' ? conn.fromPoint : conn.toPoint)
    : (side === 'from' ? conn.fromPoint : conn.toPoint);
  return point ? { x: Number(point.x) || 0, y: Number(point.y) || 0 } : null;
}
function _bdFindConnectionWorldRect(conn) {
  const from = _bdFindConnectionEndpoint(conn, 'from');
  const to = _bdFindConnectionEndpoint(conn, 'to');
  if (!from && !to) return null;
  const a = from || to;
  const b = to || from;
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);
  return { x: x1, y: y1, w: Math.max(80, x2 - x1), h: Math.max(40, y2 - y1) };
}
function _bdFindEnsureWorldRectVisible(x, y, width, height) {
  const canvasEl = document.getElementById('bd-canvas');
  if (!canvasEl) return;
  const zoom = bd.zoom || 1;
  const cw = canvasEl.offsetWidth, ch = canvasEl.offsetHeight;
  const sx = x * zoom + bd.panX;
  const sy = y * zoom + bd.panY;
  const margin = 40;
  let dx = 0, dy = 0;
  if (sx < margin) dx = margin - sx;
  else if (sx + width * zoom > cw - margin) dx = cw - margin - (sx + width * zoom);
  if (sy < margin) dy = margin - sy;
  else if (sy + height * zoom > ch - margin) dy = ch - margin - (sy + height * zoom);
  if (dx !== 0 || dy !== 0) {
    bd.panX += dx;
    bd.panY += dy;
    if (typeof bdTransform === 'function') bdTransform();
  }
}
// マッチ語を <mark> で囲んでカードテキスト / ラインラベルの innerHTML を書き換える。
// q が空文字のときはハイライト解除 (通常のエスケープ済み表示に戻す)。
function _bdApplyFindHighlight(q) {
  if (!q) {
    _bdRestoreFindRender();
    return;
  }
  const cur = bd._findMatches && bd._findMatches[bd._findIndex];
  bd.nodes.forEach(n => {
    const el = document.getElementById('bdn-' + n.id);
    if (!el) return;
    const txt = el.querySelector('.bd-text');
    if (!txt) return;
    const currentOccurrence = cur && cur.type === 'node' && cur.id === n.id ? cur.occurrence : -1;
    txt.innerHTML = _bdRenderTextWithHighlight(n.text || '', q, currentOccurrence);
  });
  bd.connections.forEach(c => {
    if (!c.label) return;
    const currentOccurrence = cur && cur.type === 'conn' && cur.id === c.id ? cur.occurrence : -1;
    _bdFindConnLabelElements(c.id).forEach(labelEl => {
      _bdApplyConnLabelHighlight(labelEl, c.label, q, currentOccurrence);
    });
  });
}
function _bdFindOccurrences(text, query) {
  const source = String(text || '');
  const needle = String(query || '');
  if (!source || !needle) return [];
  const sourceLower = source.toLowerCase();
  const needleLower = needle.toLowerCase();
  const matches = [];
  let cursor = 0;
  while (cursor <= source.length) {
    const idx = sourceLower.indexOf(needleLower, cursor);
    if (idx < 0) break;
    matches.push(idx);
    cursor = idx + Math.max(needle.length, 1);
  }
  return matches;
}
function _bdFindConnLabelElements(connId) {
  const id = String(connId || '');
  if (!id) return [];
  return Array.from(document.querySelectorAll('.bd-conn-label, .bd-conn-label-path'))
    .filter(el => String(el.dataset?.connId || '') === id);
}
function _bdRestoreFindRender() {
  if (typeof bdRequestFullRender === 'function') {
    bdRequestFullRender('find-clear');
    if (typeof bdFlushBoardUpdates === 'function') bdFlushBoardUpdates();
    return;
  }
  if (typeof bdRender === 'function') bdRender();
}
function _bdRememberSvgConnLabelStyle(labelEl) {
  if (!labelEl || labelEl.dataset?.bdFindStyleSaved === '1') return;
  labelEl.dataset.bdFindStyleSaved = '1';
  labelEl.dataset.bdFindStyleAttr = labelEl.getAttribute('style') || '';
  labelEl.dataset.bdFindPaintOrderAttr = labelEl.getAttribute('paint-order') || '';
}
function _bdRestoreSvgConnLabelStyle(labelEl) {
  if (!labelEl || labelEl.dataset?.bdFindStyleSaved !== '1') return;
  const styleAttr = labelEl.dataset.bdFindStyleAttr || '';
  const paintOrder = labelEl.dataset.bdFindPaintOrderAttr || '';
  if (styleAttr) labelEl.setAttribute('style', styleAttr);
  else labelEl.removeAttribute('style');
  if (paintOrder) labelEl.setAttribute('paint-order', paintOrder);
  else labelEl.removeAttribute('paint-order');
  delete labelEl.dataset.bdFindStyleSaved;
  delete labelEl.dataset.bdFindStyleAttr;
  delete labelEl.dataset.bdFindPaintOrderAttr;
}
function _bdApplyConnLabelHighlight(labelEl, label, q, currentOccurrence) {
  if (!labelEl) return;
  const isSvg = labelEl.namespaceURI === 'http://www.w3.org/2000/svg';
  if (!isSvg) {
    labelEl.innerHTML = _bdRenderTextWithHighlight(label, q, currentOccurrence);
    return;
  }
  const matched = _bdFindOccurrences(label, q).length > 0;
  const textPath = labelEl.querySelector('textPath');
  if (textPath) textPath.textContent = label || '';
  else labelEl.textContent = label || '';
  labelEl.classList.toggle('bd-find-hl', matched);
  labelEl.classList.toggle('bd-find-hl-current', currentOccurrence >= 0);
  if (matched) {
    _bdRememberSvgConnLabelStyle(labelEl);
    labelEl.style.paintOrder = 'stroke';
    labelEl.style.stroke = currentOccurrence >= 0 ? 'rgba(255, 140, 0, 0.80)' : 'rgba(255, 220, 50, 0.50)';
    labelEl.style.strokeWidth = currentOccurrence >= 0 ? '5px' : '4px';
  } else {
    _bdRestoreSvgConnLabelStyle(labelEl);
  }
}
function _bdRenderTextWithHighlight(text, q, currentOccurrence) {
  const safeText = text || '';
  if (!q) {
    // 通常描画に戻す (auto-link も復活させる)
    if (typeof applyAutoLinks === 'function') return applyAutoLinks(esc(safeText).replace(/\n/g, '<br>'), bd.path);
    return esc(safeText).replace(/\n/g, '<br>');
  }
  const qLower = q.toLowerCase();
  const tLower = safeText.toLowerCase();
  let result = '';
  let i = 0;
  let occurrence = 0;
  while (i < safeText.length) {
    const idx = tLower.indexOf(qLower, i);
    if (idx < 0) { result += esc(safeText.slice(i)); break; }
    if (idx > i) result += esc(safeText.slice(i, idx));
    const isCurrent = occurrence === currentOccurrence;
    const cls = isCurrent ? 'bd-find-hl bd-find-hl-current' : 'bd-find-hl';
    result += `<mark class="${cls}">${esc(safeText.slice(idx, idx + q.length))}</mark>`;
    occurrence += 1;
    i = idx + q.length;
  }
  return result.replace(/\n/g, '<br>');
}
function _bdFindPrev() {
  if (!bd._findMatches || !bd._findMatches.length) return;
  bd._findIndex = (bd._findIndex - 1 + bd._findMatches.length) % bd._findMatches.length;
  _bdFindUpdateUI();
  _bdFindShowCurrent();
}
function _bdFindNext() {
  if (!bd._findMatches || !bd._findMatches.length) return;
  bd._findIndex = (bd._findIndex + 1) % bd._findMatches.length;
  _bdFindUpdateUI();
  _bdFindShowCurrent();
}
function _bdFindUpdateUI() {
  const cEl = document.getElementById('bd-find-count');
  if (!cEl) return;
  if (bd._findMatches && bd._findMatches.length) cEl.textContent = `${bd._findIndex + 1} / ${bd._findMatches.length}`;
  else cEl.textContent = '0 件';
}
function _bdEscapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function _bdReplaceFindQuery(text, query, replacement, limit) {
  const source = String(text || '');
  const needle = String(query || '');
  if (!needle) return { text: source, count: 0 };
  const re = new RegExp(_bdEscapeRegExp(needle), 'gi');
  let count = 0;
  const nextText = source.replace(re, (match) => {
    if (limit && count >= limit) return match;
    count += 1;
    return replacement;
  });
  return { text: nextText, count };
}
function _bdReplaceFindOccurrence(text, query, replacement, occurrence) {
  const source = String(text || '');
  const needle = String(query || '');
  const index = _bdFindOccurrences(source, needle)[Math.max(0, occurrence || 0)];
  if (index == null) return { text: source, count: 0 };
  return {
    text: source.slice(0, index) + String(replacement || '') + source.slice(index + needle.length),
    count: 1,
  };
}
function _bdReplaceFindOccurrencesByIndex(text, query, replacement, occurrenceIndexes) {
  const source = String(text || '');
  const needle = String(query || '');
  const wanted = occurrenceIndexes instanceof Set ? occurrenceIndexes : new Set(occurrenceIndexes || []);
  if (!source || !needle || !wanted.size) return { text: source, count: 0 };
  const starts = _bdFindOccurrences(source, needle);
  let result = '';
  let cursor = 0;
  let count = 0;
  starts.forEach((start, occurrence) => {
    if (!wanted.has(occurrence)) return;
    result += source.slice(cursor, start) + String(replacement || '');
    cursor = start + needle.length;
    count += 1;
  });
  if (!count) return { text: source, count: 0 };
  result += source.slice(cursor);
  return { text: result, count };
}
function _bdFindReplaceOne() {
  const q = bd._findQuery;
  const rEl = document.getElementById('bd-find-r');
  const r = rEl ? rEl.value : '';
  if (!q || !bd._findMatches || !bd._findMatches.length) return;
  const cur = bd._findMatches[bd._findIndex];
  const savedIdx = bd._findIndex;
  let target = null;
  let field = '';
  let replacementResult = null;
  if (cur.type === 'node') {
    const n = bd.nodes.find(x => x.id === cur.id);
    if (n && n.text) {
      target = n;
      field = 'text';
      replacementResult = _bdReplaceFindOccurrence(n.text, q, r, cur.occurrence);
    }
  } else {
    const c = bd.connections.find(x => x.id === cur.id);
    if (c && c.label) {
      target = c;
      field = 'label';
      replacementResult = _bdReplaceFindOccurrence(c.label, q, r, cur.occurrence);
    }
  }
  if (!target || !replacementResult?.count) return;
  bdPushUndo();
  target[field] = replacementResult.text;
  bdRender(); bdDirty();
  // 再検索後も同じ位置 (置換したマッチの位置) を維持し、そこから次のマッチを表示。
  // 置換で件数が減っていた場合は循環させて先頭に戻す。
  _bdFindUpdateMatches(q);
  if (bd._findMatches && bd._findMatches.length) {
    bd._findIndex = savedIdx < bd._findMatches.length ? savedIdx : 0;
    _bdFindUpdateUI();
    _bdFindShowCurrent();
  }
}
function _bdFindReplaceAll() {
  const q = bd._findQuery;
  const rEl = document.getElementById('bd-find-r');
  const r = rEl ? rEl.value : '';
  if (!q) return;
  _bdFindUpdateMatches(q);
  const nodeOccurrences = new Map();
  const connOccurrences = new Map();
  (bd._findMatches || []).forEach(match => {
    if (!match || !match.id) return;
    const target = match.type === 'conn' ? connOccurrences : nodeOccurrences;
    if (!target.has(match.id)) target.set(match.id, new Set());
    target.get(match.id).add(match.occurrence || 0);
  });
  const updates = [];
  let count = 0;
  bd.nodes.forEach(n => {
    if (!n.text) return;
    const result = _bdReplaceFindOccurrencesByIndex(n.text, q, r, nodeOccurrences.get(n.id));
    if (result.count) {
      updates.push(() => { n.text = result.text; });
      count += result.count;
    }
  });
  bd.connections.forEach(c => {
    if (!c.label) return;
    const result = _bdReplaceFindOccurrencesByIndex(c.label, q, r, connOccurrences.get(c.id));
    if (result.count) {
      updates.push(() => { c.label = result.text; });
      count += result.count;
    }
  });
  if (!updates.length) {
    if (typeof showStatus === 'function') showStatus('0 件置換しました');
    return;
  }
  bdPushUndo();
  updates.forEach(apply => apply());
  bdRender(); bdDirty();
  _bdFindUpdateMatches(q);
  if (typeof showStatus === 'function') showStatus(`${count} 件置換しました`);
}
// 互換ラッパー: 既存の右クリックメニュー「検索と置換...」は置換モードで検索バーを開く
function bdFindReplace() { bdOpenFindBar('replace'); }
