/* gb-board-find.js: ボードの検索 / 置換バー (旧 gb-canvas-features.part01.js から分離) */

// --- 検索・置換バー ---
// モーダルダイアログではなく、キャンバス上に非モーダルで表示される検索バー。
// Ctrl+F: 検索のみモードで開く / Ctrl+H: 置換行も展開して開く。
// Enter: 次へ、Shift+Enter: 前へ、Escape: 閉じる。
function bdOpenFindBar(mode) {
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
  const ql = query.toLowerCase();
  bd.nodes.forEach(n => { if (n.text && n.text.toLowerCase().includes(ql)) bd._findMatches.push({ type: 'node', id: n.id }); });
  bd.connections.forEach(c => { if (c.label && c.label.toLowerCase().includes(ql)) bd._findMatches.push({ type: 'conn', id: c.id }); });
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
  if (!cur || cur.type !== 'node') return;
  const n = bd.nodes.find(x => x.id === cur.id);
  if (!n) return;
  const canvasEl = document.getElementById('bd-canvas');
  const el = document.getElementById('bdn-' + n.id);
  if (!canvasEl || !el) return;
  const cw = canvasEl.offsetWidth, ch = canvasEl.offsetHeight;
  const nw = el.offsetWidth, nh = el.offsetHeight;
  const sx = n.x * bd.zoom + bd.panX;
  const sy = n.y * bd.zoom + bd.panY;
  const margin = 40;
  let dx = 0, dy = 0;
  if (sx < margin) dx = margin - sx;
  else if (sx + nw * bd.zoom > cw - margin) dx = cw - margin - (sx + nw * bd.zoom);
  if (sy < margin) dy = margin - sy;
  else if (sy + nh * bd.zoom > ch - margin) dy = ch - margin - (sy + nh * bd.zoom);
  if (dx !== 0 || dy !== 0) {
    bd.panX += dx;
    bd.panY += dy;
    if (typeof bdTransform === 'function') bdTransform();
  }
}
// マッチ語を <mark> で囲んでカードテキスト / ラインラベルの innerHTML を書き換える。
// q が空文字のときはハイライト解除 (通常のエスケープ済み表示に戻す)。
function _bdApplyFindHighlight(q) {
  const cur = bd._findMatches && bd._findMatches[bd._findIndex];
  const curKey = cur ? (cur.type + ':' + cur.id) : '';
  bd.nodes.forEach(n => {
    const el = document.getElementById('bdn-' + n.id);
    if (!el) return;
    const txt = el.querySelector('.bd-text');
    if (!txt) return;
    const isCurrent = ('node:' + n.id) === curKey;
    txt.innerHTML = _bdRenderTextWithHighlight(n.text || '', q, isCurrent);
  });
  bd.connections.forEach(c => {
    if (!c.label) return;
    const labelEl = document.querySelector(`.bd-conn-label[data-conn-id="${c.id}"]`);
    if (!labelEl) return;
    const isCurrent = ('conn:' + c.id) === curKey;
    labelEl.innerHTML = _bdRenderTextWithHighlight(c.label, q, isCurrent);
  });
}
function _bdRenderTextWithHighlight(text, q, isCurrent) {
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
  while (i < safeText.length) {
    const idx = tLower.indexOf(qLower, i);
    if (idx < 0) { result += esc(safeText.slice(i)); break; }
    if (idx > i) result += esc(safeText.slice(i, idx));
    const cls = isCurrent ? 'bd-find-hl bd-find-hl-current' : 'bd-find-hl';
    result += `<mark class="${cls}">${esc(safeText.slice(idx, idx + q.length))}</mark>`;
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
      replacementResult = _bdReplaceFindQuery(n.text, q, r, 0);
    }
  } else {
    const c = bd.connections.find(x => x.id === cur.id);
    if (c && c.label) {
      target = c;
      field = 'label';
      replacementResult = _bdReplaceFindQuery(c.label, q, r, 0);
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
  const updates = [];
  let count = 0;
  bd.nodes.forEach(n => {
    if (!n.text) return;
    const result = _bdReplaceFindQuery(n.text, q, r, 0);
    if (result.count) {
      updates.push(() => { n.text = result.text; });
      count += result.count;
    }
  });
  bd.connections.forEach(c => {
    if (!c.label) return;
    const result = _bdReplaceFindQuery(c.label, q, r, 0);
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
