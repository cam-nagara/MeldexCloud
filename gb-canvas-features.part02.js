/* gb-canvas-features.part02.js */
// --- 2. Focus (Space キーでフォーカス / 解除) ---
// v0.5.285: フォーカスモード (トグル ON/OFF) は廃止。Space キーを押すだけでフォーカス / 解除できる仕様に統一。
let _bdFocusSaved = null; // フォーカス前のzoom/pan状態
function bdFocusSelected(force) {
  const ids = [...bd.selected];
  if (ids.length !== 1) return;

  // フォーカス中なら解除（元の表示に戻す）
  if (_bdFocusSaved && !force) {
    bd.zoom = _bdFocusSaved.zoom;
    bd.panX = _bdFocusSaved.panX;
    bd.panY = _bdFocusSaved.panY;
    _bdFocusSaved = null;
    bdTransform();
    document.getElementById('bd-zoom-label').textContent = Math.round(bd.zoom * 100) + '%';
    showStatus('フォーカス解除');
    return;
  }

  const n = bd.nodes.find(v => v.id === ids[0]);
  const el = document.getElementById('bdn-' + ids[0]);
  if (!n || !el) return;

  // 現在の状態を保存
  if (!_bdFocusSaved) _bdFocusSaved = { zoom: bd.zoom, panX: bd.panX, panY: bd.panY };

  const canvasEl = document.getElementById('bd-canvas');
  const cw = canvasEl.offsetWidth, ch = canvasEl.offsetHeight;
  const nw = el.offsetWidth, nh = el.offsetHeight;
  const zoom = Math.min(cw / (nw + 40), ch / (nh + 40), 3);
  bd.zoom = zoom;
  bd.panX = cw / 2 - (n.x + nw / 2) * zoom;
  bd.panY = ch / 2 - (n.y + nh / 2) * zoom;
  bdTransform();
  document.getElementById('bd-zoom-label').textContent = Math.round(bd.zoom * 100) + '%';
}
// --- 3. Z-order ---
function bdMoveZ(direction) {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  if (direction === 'front') {
    ids.forEach(id => { const idx = bd.nodes.findIndex(n => n.id === id); if (idx >= 0) { const n = bd.nodes.splice(idx, 1)[0]; bd.nodes.push(n); } });
  } else {
    ids.reverse().forEach(id => { const idx = bd.nodes.findIndex(n => n.id === id); if (idx >= 0) { const n = bd.nodes.splice(idx, 1)[0]; bd.nodes.unshift(n); } });
  }
  bdRender(); bdDirty();
}
// --- 4. Lock ---
function bdToggleLock() {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  const anyLocked = ids.some(id => { const n = bd.nodes.find(v => v.id === id); return n && n.locked; });
  ids.forEach(id => { const n = bd.nodes.find(v => v.id === id); if (n) n.locked = !anyLocked; });
  bdRender(); bdDirty();
  showStatus(anyLocked ? 'ロック解除' : 'ロックしました');
}
// --- 5. Flip / Rotate / Opacity ---
function bdFlip(axis) {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  ids.forEach(id => {
    const n = bd.nodes.find(v => v.id === id); if (!n) return;
    if (axis === 'h') n.flipH = !n.flipH;
    else n.flipV = !n.flipV;
  });
  bdRender(); bdDirty();
}

function bdRotate(deg) {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  ids.forEach(id => {
    const n = bd.nodes.find(v => v.id === id); if (!n) return;
    n.rotate = ((n.rotate || 0) + deg) % 360;
  });
  bdRender(); bdDirty();
}

function bdSetOpacity(val) {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  ids.forEach(id => { const n = bd.nodes.find(v => v.id === id); if (n) n.opacity = val; });
  bdRender(); bdDirty();
}
// --- 8. Color Picker ---
function bdColorPicker() {
  showStatus('画像上をクリックして色を取得...');
  const handler = (e) => {
    const img = e.target.closest('.bd-img');
    if (!img) { document.removeEventListener('click', handler, true); return; }
    e.preventDefault(); e.stopPropagation();
    document.removeEventListener('click', handler, true);
    const canvas2 = document.createElement('canvas');
    const rect = img.getBoundingClientRect();
    canvas2.width = img.naturalWidth || img.width; canvas2.height = img.naturalHeight || img.height;
    const ctx2 = canvas2.getContext('2d'); ctx2.drawImage(img, 0, 0);
    const sx = (e.clientX - rect.left) / rect.width * canvas2.width;
    const sy = (e.clientY - rect.top) / rect.height * canvas2.height;
    const ix = Math.max(0, Math.min(canvas2.width - 1, Math.floor(sx)));
    const iy = Math.max(0, Math.min(canvas2.height - 1, Math.floor(sy)));
    let px;
    try {
      px = ctx2.getImageData(ix, iy, 1, 1).data;
    } catch {
      showStatus('色を取得できませんでした', true);
      return;
    }
    const hex = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    navigator.clipboard.writeText(hex).then(() => showStatus('色をコピー: ' + hex));
  };
  setTimeout(() => document.addEventListener('click', handler, true), 0);
}
// --- 9. Clipboard Paste Image ---
function bdPasteImage() {
  navigator.clipboard.read().then(items => {
    for (const item of items) {
      const imgType = item.types.find(t => t.startsWith('image/'));
      if (imgType) {
        item.getType(imgType).then(blob => {
          const reader = new FileReader();
          reader.onload = () => {
            bdPushUndo();
            const canvasEl = document.getElementById('bd-canvas');
            let pos = { x: 200, y: 160 };
            if (canvasEl && typeof bdScreenToWorld === 'function') {
              const rect = canvasEl.getBoundingClientRect();
              pos = bdScreenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
            } else if (canvasEl) {
              pos = {
                x: ((canvasEl.offsetWidth || 600) / 2 - (bd.panX || 0)) / (bd.zoom || 1),
                y: ((canvasEl.offsetHeight || 400) / 2 - (bd.panY || 0)) / (bd.zoom || 1),
              };
            }
            const n = bdNode('', pos.x - 150, pos.y - 100, 300, 0, { img: reader.result });
            bd.nodes.push(n);
            if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(n)) {
              if (typeof bdRequestFullRender === 'function') bdRequestFullRender('paste-image-fallback');
              else bdRender();
            }
            if (typeof bdMarkNodeDirty === 'function') bdMarkNodeDirty(n.id, 'paste-image');
            if (typeof bdMarkExtrasDirty === 'function') bdMarkExtrasDirty({ minimap: true, boardUi: true, comments: [n.id] }, 'paste-image');
            bdSelect(n.id); bdDirty();
            showStatus('画像を貼り付けました');
          };
          reader.readAsDataURL(blob);
        });
        return;
      }
    }
    showStatus('クリップボードに画像がありません', true);
  }).catch(() => showStatus('クリップボードアクセスに失敗', true));
}
// --- 10. Canvas Export as Image ---
function _bdExportImageBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const includeRect = (x, y, w, h) => {
    if (![x, y, w, h].every(Number.isFinite)) return;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  bd.nodes.forEach(n => {
    const el = document.getElementById('bdn-' + n.id);
    if (!el) return;
    const pos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(n) : { x: n.x, y: n.y };
    includeRect(pos.x, pos.y, el.offsetWidth || n.w || 160, el.offsetHeight || n.h || 40);
  });
  document.querySelectorAll('#bd-svg .bd-conn-path, #bd-svg .bd-conn-arrow, #bd-svg .bd-conn-label-path').forEach(path => {
    try {
      const b = path.getBBox();
      includeRect(b.x, b.y, b.width, b.height);
    } catch {}
  });
  document.querySelectorAll('.bd-frame, .bd-conn-label, .bd-line-comment-badge').forEach(el => {
    const x = parseFloat(el.style.left);
    const y = parseFloat(el.style.top);
    includeRect(x, y, el.offsetWidth || 0, el.offsetHeight || 0);
  });
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
  const pad = 40;
  return {
    x0: x0 - pad,
    y0: y0 - pad,
    x1: x1 + pad,
    y1: y1 + pad,
    width: Math.max(1, Math.ceil(x1 - x0 + pad * 2)),
    height: Math.max(1, Math.ceil(y1 - y0 + pad * 2)),
  };
}

function _bdLoadHtml2CanvasForExport() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-html2canvas-loader="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.html2canvas), { once: true });
      existing.addEventListener('error', () => reject(new Error('html2canvas の読み込みに失敗しました')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.dataset.html2canvasLoader = '1';
    script.src = 'vendor/html2canvas.min.js';
    script.onload = () => window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas を初期化できませんでした'));
    script.onerror = () => reject(new Error('html2canvas の読み込みに失敗しました'));
    document.head.appendChild(script);
  });
}

function _bdCreateExportStage(world, bounds) {
  const canvasEl = document.getElementById('bd-canvas');
  const bg = canvasEl ? (getComputedStyle(canvasEl).backgroundColor || '#1e1e1e') : '#1e1e1e';
  const stage = document.createElement('div');
  stage.className = 'bd-export-stage';
  stage.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    `width:${bounds.width}px`,
    `height:${bounds.height}px`,
    'overflow:hidden',
    `background:${bg}`,
    'pointer-events:none',
    'z-index:0',
  ].join(';');
  const clone = world.cloneNode(true);
  clone.style.position = 'absolute';
  clone.style.left = '0';
  clone.style.top = '0';
  clone.style.transformOrigin = '0 0';
  clone.style.transform = `translate(${-bounds.x0}px, ${-bounds.y0}px)`;
  clone.style.minWidth = Math.max(bounds.width, bounds.x1 + Math.abs(bounds.x0)) + 'px';
  clone.style.minHeight = Math.max(bounds.height, bounds.y1 + Math.abs(bounds.y0)) + 'px';
  clone.querySelectorAll('[data-bd-role="svg"]').forEach(svg => {
    const svgWidth = Math.max(bounds.width, bounds.x1 + Math.abs(bounds.x0));
    const svgHeight = Math.max(bounds.height, bounds.y1 + Math.abs(bounds.y0));
    svg.setAttribute('width', String(svgWidth));
    svg.setAttribute('height', String(svgHeight));
    svg.style.width = svgWidth + 'px';
    svg.style.height = svgHeight + 'px';
    svg.style.overflow = 'visible';
  });
  stage.appendChild(clone);
  document.body.appendChild(stage);
  return stage;
}

async function bdExportImage() {
  const world = document.getElementById('bd-world');
  if (!world) return;
  const bounds = _bdExportImageBounds();
  if (!bounds) return;
  if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveBlob !== 'function') {
    showStatus('保存ダイアログを初期化できませんでした', true);
    return;
  }
  let stage = null;
  try {
    showStatus('ボード画像を生成中...');
    if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
    stage = _bdCreateExportStage(world, bounds);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const html2canvas = await _bdLoadHtml2CanvasForExport();
    const stageRect = stage.getBoundingClientRect();
    const canvas = await html2canvas(stage, {
      backgroundColor: getComputedStyle(stage).backgroundColor || '#1e1e1e',
      scale: window.devicePixelRatio || 1,
      useCORS: true,
      logging: false,
      x: -stageRect.left,
      y: -stageRect.top,
      width: bounds.width,
      height: bounds.height,
      windowWidth: bounds.width,
      windowHeight: bounds.height,
    });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      showStatus('ボードの画像化に失敗しました', true);
      return;
    }
    const path = typeof getCurrentFilePath === 'function' ? getCurrentFilePath() : '';
    const baseName = (typeof MeldexExportSave.guessNameFromPath === 'function')
      ? MeldexExportSave.guessNameFromPath(path, 'board')
      : 'board';
    const stem = String(baseName || 'board').replace(/\.[^.]+$/, '') || 'board';
    MeldexExportSave.saveBlob(blob, {
      filename: stem + '.png',
      extension: '.png',
      dialogTitle: 'ボード画像として保存',
      filetypes: [['PNGファイル', '*.png'], ['すべてのファイル', '*.*']],
      okMessage: 'ボードをエクスポートしました',
      errorMessage: 'ボードの保存に失敗しました',
    });
  } catch (err) {
    showStatus('ボードの画像化に失敗しました: ' + (err?.message || err), true);
  } finally {
    if (stage) stage.remove();
  }
}
// --- 11. Slideshow ---
let _bdSlideshow = null;
function bdStartSlideshow(interval) {
  const imgNodes = bd.nodes.filter(n => n.img);
  if (!imgNodes.length) { showStatus('画像カードがありません', true); return; }
  let idx = 0;
  _bdSlideshow = { nodes: imgNodes, interval: interval || 5000 };
  const show = () => {
    if (!_bdSlideshow) return;
    const n = imgNodes[idx];
    bd.selected = new Set([n.id]);
    bdFocusSelected(true);
    document.querySelectorAll('.bd-node').forEach(el => el.classList.toggle('bd-selected', bd.selected.has(el.id.replace('bdn-', ''))));
    if (typeof bdSyncResizeHandles === 'function') bdSyncResizeHandles();
    idx = (idx + 1) % imgNodes.length;
    _bdSlideshow.timer = setTimeout(show, _bdSlideshow.interval);
  };
  show();
  showStatus('スライドショー開始（Escで停止）');
}
function bdStopSlideshow() {
  if (_bdSlideshow) { clearTimeout(_bdSlideshow.timer); _bdSlideshow = null; showStatus('スライドショー停止'); }
}
// --- 12. Background Color ---
function bdSetBackground(color) {
  document.getElementById('bd-canvas').style.background = color;
  bd._bgColor = color;
  bdDirty();
}
// --- Find & Replace は gb-board-find.js に分離済み (v0.5.287) ---

// --- Numbering ---
function bdToggleNumbering() {
  bd._numbering = !bd._numbering;
  bdRender(); bdDirty();
  showStatus(bd._numbering ? '番号付けON' : '番号付けOFF');
}
function _bdGetNumber(nodeId) {
  if (!bd._numbering) return '';
  const n = bd.nodes.find(v => v.id === nodeId);
  if (!n) return '';
  const lineage = [];
  let cur = n;
  const seen = new Set();
  const limit = Math.max(50, (bd.nodes || []).length + 1);
  let guard = 0;
  while (cur && !seen.has(cur.id) && guard < limit) {
    seen.add(cur.id);
    lineage.unshift(cur);
    if (!cur.parent) break;
    const parentId = cur.parent;
    cur = bd.nodes.find(v => v.id === parentId);
    guard += 1;
  }
  if (!lineage.length) return '';
  const nums = [];
  lineage.forEach((node, index) => {
    if (index === 0) {
      const roots = bd.nodes.filter(v => !v.parent);
      const idx = roots.findIndex(v => v.id === node.id);
      if (idx >= 0) nums.push(idx + 1);
      return;
    }
    const parentNode = lineage[index - 1];
    const siblings = bdChildren(parentNode.id);
    const idx = siblings.findIndex(s => s.id === node.id);
    if (idx >= 0) nums.push(idx + 1);
  });
  return nums.length ? nums.join('.') + '. ' : '';
}

// --- Note Panel ---
function bdEditNote(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const o = document.createElement('div'); o.className = 'modal-overlay';
  o.innerHTML = `<div class="modal" style="min-width:500px;">
    <h3>ノート: ${esc((n.text||'').split('\n')[0].slice(0,30))}</h3>
    <textarea id="bd-note-text" rows="12" style="width:100%;font-size:13px;padding:8px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;resize:vertical;">${esc(n.note || '')}</textarea>
    <div class="btn-row">
      <button data-action="this.closest('.modal-overlay').remove()">キャンセル</button>
      <button class="primary" data-action="_bdSaveNote('${nodeId}')">保存</button>
    </div>
  </div>`;
  document.body.appendChild(o);
}
function _bdSaveNote(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  n.note = document.getElementById('bd-note-text').value;
  document.querySelector('.modal-overlay').remove();
  bdRender(); bdDirty();
  showStatus('ノートを保存しました');
}

// --- Checkbox + Progress ---
function bdToggleCheck(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  if (n.checked === undefined) n.checked = false;
  n.checked = !n.checked;
  bdRender(); bdDirty();
}
function bdSetProgress(nodeId, pct) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  n.progress = pct;
  bdRender(); bdDirty();
}

// --- Summary ---
function bdAddSummary() {
  const ids = [...bd.selected]; if (ids.length < 2) { showStatus('2つ以上のカードを選択してください', true); return; }
  bdPushUndo();
  let maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  ids.forEach(id => {
    const n = bd.nodes.find(v => v.id === id);
    if (!n) return;
    const el = document.getElementById('bdn-' + id);
    if (n && el) {
      const pos = typeof bdNodeCanvasPosition === 'function' ? bdNodeCanvasPosition(n) : { x: n.x, y: n.y };
      maxX = Math.max(maxX, pos.x + el.offsetWidth);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y + el.offsetHeight);
    }
  });
  if (!Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    showStatus('表示中のカードを選択してください', true);
    return;
  }
  const summary = (typeof bdCreateNodeWithStyle === 'function')
    ? bdCreateNodeWithStyle('集約', maxX + 40, (minY + maxY) / 2 - 18, { w: 120 })
    : bdNode('集約', maxX + 40, (minY + maxY) / 2 - 18, 120, 0, {});
  summary._summaryOf = ids.slice();
  bd.nodes.push(summary);
  ids.forEach(id => {
    const conn = typeof bdCreateConnectionWithStyle === 'function'
      ? bdCreateConnectionWithStyle(id, summary.id, { arrow: 'end', style: 'dashed' })
      : { from: id, to: summary.id, arrow: 'end', label: '', style: 'dashed' };
    bd.connections.push(conn);
  });
  // 追加直後のインライン編集は発火させない (F2 / ダブルクリックで編集開始)
  bdRender(); bdSelect(summary.id); bdDirty();
}

// --- Drill Down ---
let _bdDrillRoot = null;
function bdDrillDown(nodeId) {
  _bdDrillRoot = nodeId;
  bdRender();
  showStatus('ドリルダウン表示中（右クリック→「全体表示に戻る」で解除）');
}
function bdDrillUp() {
  _bdDrillRoot = null;
  bdRender();
  showStatus('全体表示に戻りました');
}

// --- Markers ---
// 2026-04-18: board-card-popup-redesign-plan.md §3.3/§4.2 に沿って progress カテゴリを廃止。
// ステータスと役割が重複するため priority / flag のみ残す。既存の n.markers.progress は
// 参照されなくなる (廃止されたカテゴリは HUD / サブメニューから出ない) が、保存データ上は
// 後方互換のため保持される (bdSetMarker で progress を指定しても BD_MARKERS[category] が
// undefined になり、既存 n.markers[progress] が delete される挙動も従来通り)。
const BD_MARKERS = {
  priority: [{icon:'circle',color:'#e74c3c',label:'最優先'},{icon:'circle',color:'#e67e22',label:'高'},{icon:'circle',color:'#f1c40f',label:'中'},{icon:'circle',color:'#2ecc71',label:'低'}],
  flag: [{icon:'flag',color:'#e74c3c',label:'フラグ'},{icon:'star',color:'#f39c12',label:'スター'},{icon:'lightbulb',color:'#f1c40f',label:'アイデア'},{icon:'alertTriangle',color:'#e67e22',label:'注意'},{icon:'helpCircle',color:'#9b59b6',label:'要確認'}],
};
function bdSetMarker(nodeId, category, markerIdx) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  if (!n.markers) n.markers = {};
  const markers = BD_MARKERS[category];
  if (!markers || markerIdx < 0 || markerIdx >= markers.length) { delete n.markers[category]; }
  else { n.markers[category] = markerIdx; }
  bdRender(); bdDirty();
}

// --- カードHUD クリック時のサブメニュー (board-card-popup-redesign-plan.md §7) ---
// カードHUDの左上ステータス/右下マーカー/左下コメントをクリックしたときに、その要素位置に
// ポップアップを開く。既存の .gb-context-menu を流用し、bdContextMenu と共存可能にする。
function _bdCreateHudMenu(rect) {
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.style.position = 'fixed';
  menu.style.minWidth = '180px';
  document.body.appendChild(menu);
  if (typeof positionPopup === 'function') {
    positionPopup(menu, rect);
  } else {
    const z = typeof _getZoom === 'function' ? _getZoom() : 1;
    menu.style.left = (rect.left / z) + 'px';
    menu.style.top = ((rect.bottom + 4) / z) + 'px';
  }
  // 外側クリックで閉じる。bdContextMenu と同じパターン
  setTimeout(() => {
    document.addEventListener('pointerdown', function h(ev) {
      const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
      if (!inAny) {
        document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
        document.removeEventListener('pointerdown', h);
      }
    }, { once: false });
  }, 0);
  return menu;
}
function _bdHudMenuItem(htmlLabel, onClick, opts) {
  const d = document.createElement('div');
  d.className = 'gb-context-menu-item';
  d.innerHTML = htmlLabel;
  if (opts?.danger) d.classList.add('danger');
  d.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    try { onClick?.(); } catch {}
  });
  return d;
}
function _bdHudMenuSep() {
  const d = document.createElement('div');
  d.className = 'gb-context-menu-sep';
  return d;
}
function _bdCheckMark(isActive) {
  return isActive ? lucide('check', 12) + ' ' : '<span style="display:inline-block;width:14px;"></span>';
}

function bdStatusMenuFor(nodeId, rect) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const menu = _bdCreateHudMenu(rect);
  const targetIds = bd.selected.has(nodeId) ? [...bd.selected] : [nodeId];
  const setStatus = (st) => {
    bdPushUndo();
    targetIds.forEach(id => { const nd = bd.nodes.find(v => v.id === id); if (nd) nd.status = st; });
    bdRender(); bdDirty();
  };
  const curStatus = n.status || '';
  // 「なし」項目
  menu.appendChild(_bdHudMenuItem(_bdCheckMark(!curStatus) + 'なし', () => setStatus('')));
  bdStatusNames().filter(s => !!s).forEach(st => {
    const sd = bdStatusDef(st);
    const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${sd.color};margin-right:4px;vertical-align:middle;"></span>`;
    menu.appendChild(_bdHudMenuItem(_bdCheckMark(curStatus === st) + dot + esc(st), () => setStatus(st)));
  });
  menu.appendChild(_bdHudMenuSep());
  menu.appendChild(_bdHudMenuItem('ステータスを管理...', () => {
    if (typeof bdManageStatuses === 'function') bdManageStatuses();
  }));
}

function bdMarkerMenuFor(nodeId, rect) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const menu = _bdCreateHudMenu(rect);
  const markers = n.markers || {};
  // 2026-04-18: BD_MARKERS.progress 廃止に伴い progress ラベルは不要。priority / flag のみ保持。
  const categoryLabels = { priority: '優先度', flag: 'フラグ' };
  const entries = Object.entries(BD_MARKERS);
  entries.forEach(([cat, list], catIdx) => {
    if (catIdx > 0) menu.appendChild(_bdHudMenuSep());
    const catHeader = document.createElement('div');
    catHeader.textContent = categoryLabels[cat] || cat;
    catHeader.style.cssText = 'padding:4px 14px;font-size:11px;color:var(--fg2);cursor:default;user-select:none;';
    menu.appendChild(catHeader);
    list.forEach((mk, idx) => {
      const isActive = markers[cat] === idx;
      const iconHtml = typeof bdMarkerIconHtml === 'function' ? bdMarkerIconHtml(mk, 12) : lucide(mk.icon, 12);
      const iconSpan = `<span style="color:${mk.color};margin-right:4px;vertical-align:middle;">${iconHtml}</span>`;
      menu.appendChild(_bdHudMenuItem(
        _bdCheckMark(isActive) + iconSpan + esc(mk.label),
        () => { bdPushUndo(); bdSetMarker(nodeId, cat, isActive ? -1 : idx); }
      ));
    });
  });
  if (markers && Object.keys(markers).length > 0) {
    menu.appendChild(_bdHudMenuSep());
    menu.appendChild(_bdHudMenuItem('すべてクリア', () => {
      bdPushUndo();
      const n2 = bd.nodes.find(v => v.id === nodeId);
      if (n2) n2.markers = {};
      bdRender(); bdDirty();
    }));
  }
}

function bdCommentMenuFor(nodeId, rect) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const menu = _bdCreateHudMenu(rect);
  const filePath = (bd?.path || '').trim();
  // Audit-P1 H-5: HUD の rect を仮想アンカーとしてインライン textarea を配置する
  const anchorRect = rect || (menu && menu.getBoundingClientRect ? menu.getBoundingClientRect() : null);
  const anchorEl = anchorRect ? { getBoundingClientRect: () => anchorRect } : null;
  menu.appendChild(_bdHudMenuItem('コメントを追加', () => {
    if (typeof addCommentHere !== 'function') return;
    if (!filePath) {
      if (typeof showStatus === 'function') showStatus('コメント対象のボードパスを取得できませんでした', true);
      return;
    }
    const snap = (n.text || '').trim().slice(0, 120);
    addCommentHere({
      targetKind: 'board_card', filePath,
      targetRef: { file: filePath, cardId: nodeId },
      snapshot: snap,
    }, anchorEl ? { anchorEl } : undefined);
  }));
  menu.appendChild(_bdHudMenuItem('コメント一覧を開く', () => {
    // 注釈パネルを開き、このカードに絞り込んだフィルタを設定 (CommentBadges._openPanelForTarget 相当)
    if (typeof openRightPanelTab === 'function') openRightPanelTab('annotation');
    else if (typeof toggleRightPanelTab === 'function') toggleRightPanelTab('annotation');
    const typeSel = document.getElementById('rp-ann-type'); if (typeSel) typeSel.value = 'comment';
    const scopeSel = document.getElementById('rp-ann-scope'); if (scopeSel) scopeSel.value = 'current';
    const searchEl = document.getElementById('rp-ann-search');
    if (searchEl) {
      searchEl.value = '';
      searchEl.dataset.targetFilter = JSON.stringify({
        targetPath: filePath, targetKind: 'board_card',
        targetRef: { file: filePath, cardId: nodeId },
      });
    }
    if (typeof loadRpAnnotationList === 'function') loadRpAnnotationList();
  }));
}

// --- 下部ツールバーのズーム倍率ラベルをクリックしたときのドロップダウン ---
// プリセット倍率 + フィットマップを選択可能にする。
function bdShowZoomMenu(anchor) {
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const menu = _bdCreateHudMenu(rect);
  menu.style.minWidth = '120px';
  const levels = [500, 400, 300, 200, 150, 120, 100, 80, 50, 20, 10];
  const currentPct = Math.round((bd.zoom || 1) * 100);
  const applyZoom = (pct) => {
    const oz = bd.zoom || 1;
    bd.zoom = pct / 100;
    // ビューポート中心を軸にズーム (ラベルからの操作はカーソル位置ではなく中心基準)
    const canvas = document.getElementById('bd-canvas');
    if (canvas) {
      const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;
      bd.panX = cx - (cx - bd.panX) * (bd.zoom / oz);
      bd.panY = cy - (cy - bd.panY) * (bd.zoom / oz);
    }
    bdTransform();
  };
  levels.forEach(pct => {
    menu.appendChild(_bdHudMenuItem(_bdCheckMark(pct === currentPct) + pct + '%', () => applyZoom(pct)));
  });
  menu.appendChild(_bdHudMenuSep());
  menu.appendChild(_bdHudMenuItem('<span style="display:inline-block;width:14px;"></span>フィットマップ', () => {
    if (typeof bdFitAll === 'function') bdFitAll();
  }));
}

// v0.5.285 でフローティングミニマップ (bdToggleMinimap / _bdDrawFloatingMinimap /
// _bdMinimapVisible) を削除。ビューワーパネル側のミニマップ (gb-canvas-minimap.js
// `_bdDrawPreviewMinimap`) で同じ目的を達成するため。

// --- Node Shapes ---
const BD_SHAPES = ['rect','ellipse','pill','octagon','cloud','fluffy','thorn','thorn-curve'];
const BD_SHAPE_LABELS = {rect:'矩形',ellipse:'楕円',pill:'ピル',octagon:'八角形',cloud:'雲',fluffy:'もやもや',thorn:'トゲ（直線）','thorn-curve':'トゲ（曲線）'};
function bdSetShape(nodeId, shape) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  n.shape = BD_SHAPES.includes(shape) && shape !== 'rect' ? shape : '';
  bdRender(); bdDirty();
}

// --- Font Settings ---
async function bdSetFont(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const size = await cfPrompt('フォントサイズ (px)', n.fontSize || '13');
  if (size === null) return;
  n.fontSize = parseInt(size) || 13;
  const bold = await cfConfirm('太字にしますか？');
  n.fontBold = bold;
  bdRender(); bdDirty();
}

// --- Resize Selected ---
async function bdResizeSelected() {
  const ids=[...bd.selected]; if(!ids.length) return;
  const first=bd.nodes.find(n=>n.id===ids[0]);
  const w=await cfPrompt('幅 (px)', Math.round(first?.w||160));
  const h=await cfPrompt('高さ (px, 0=自動)', Math.round(first?.h||0));
  if(w===null || h===null) return;
  bdPushUndo();
  ids.forEach(id=>{ const n=bd.nodes.find(v=>v.id===id); if(n){n.w=parseInt(w)||160; n.h=parseInt(h)||0;} });
  bdRender(); bdDirty();
}

// --- 14. Context Menus ---
function _bdCreateContextSubmenu(menu, label, minWidth) {
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';
  const trigger = document.createElement('div');
  trigger.innerHTML = esc(label) + submenuArrow();
  trigger.style.cssText = 'padding:4px 16px;cursor:pointer;';
  trigger.onmouseenter = () => { trigger.style.background='var(--bg4)'; };
  trigger.onmouseleave = () => { trigger.style.background=''; };
  const panel = document.createElement('div');
  panel.className = 'gb-context-menu';
  panel.style.cssText = `display:none;min-width:${minWidth || 120}px;`;
  attachHoverSubmenu(trigger, panel);
  wrap.appendChild(trigger);
  wrap.appendChild(panel);
  menu.appendChild(wrap);
  return panel;
}

function _bdApplyCardStyleFromMenu(nodeIds, styleId) {
  const ids = [...new Set((nodeIds || []).filter(Boolean))];
  if (!ids.length) return;
  bdPushUndo();
  if (typeof _bdAssignCardStyleToNodes === 'function') _bdAssignCardStyleToNodes(ids, styleId);
  else ids.forEach(nodeId => {
    const node = bd.nodes.find(item => item.id === nodeId);
    if (!node) return;
    node.cardStyle = styleId || '';
    if (styleId) node._userCardStyle = true;
    else delete node._userCardStyle;
  });
  bdRender();
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
}

// ノードを「階層別スタイル」に戻す。
// - cardStyle (個別カードスタイル参照) をクリア
// - bdClearCardStyleOverrides で per-node 視覚 override を削除
// - _userCardStyle / _userBgColor / _userFontSize / _userFontBold / _userW フラグを削除
//   （これらが立っていると bdApplyAutoStyle が深さ別の値で上書きしないため、
//    フラグを消して階層スタイルが効くようにする）
// - 対象ノードからルートまで遡り、ルートに _autoStyle: true があれば
//   bdApplyAutoStyle を再実行して深さ別スタイルを再適用する。
function _bdRestoreCardToHierarchy(nodeIds) {
  const ids = [...new Set((nodeIds || []).filter(Boolean))];
  if (!ids.length) return;
  bdPushUndo();
  const rootsToReapply = new Set();
  ids.forEach(nodeId => {
    const node = bd.nodes.find(item => item.id === nodeId);
    if (!node) return;
    node.cardStyle = '';
    if (typeof bdClearCardStyleOverrides === 'function') bdClearCardStyleOverrides(node);
    delete node._userCardStyle;
    delete node._userBgColor;
    delete node._userFontSize;
    delete node._userFontBold;
    delete node._userW;
    let cur = node;
    const guard = new Set();
    while (cur && cur.parent && !guard.has(cur.id)) {
      guard.add(cur.id);
      const parent = bd.nodes.find(n => n.id === cur.parent);
      if (!parent) break;
      cur = parent;
    }
    if (cur && cur._autoStyle) rootsToReapply.add(cur.id);
  });
  if (typeof bdApplyAutoStyle === 'function') {
    rootsToReapply.forEach(rid => bdApplyAutoStyle(rid));
  }
  bdRender();
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  if (typeof showStatus === 'function') {
    showStatus(rootsToReapply.size
      ? '階層別スタイルに戻しました'
      : '個別スタイルを解除しました（ルートカードで「階層別スタイル」を有効にすると深さ別スタイルが反映されます）');
  }
}

function _bdApplyLineStyleFromMenu(connIds, styleId) {
  const ids = [...new Set((connIds || []).filter(Boolean))];
  if (!ids.length) return;
  bdPushUndo();
  if (typeof _bdAssignLineStyleToConnections === 'function') _bdAssignLineStyleToConnections(ids, styleId);
  else ids.forEach(connId => {
    const target = typeof bdGetConnectionById === 'function' ? bdGetConnectionById(connId) : bd.connections.find(conn => conn.id === connId);
    if (!target) return;
    target.styleRef = styleId || '';
  });
  bdDrawConns({ connIds: ids, reason: 'line-style-menu' });
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
}

// 2026-04-18: board-card-popup-redesign-plan.md §5.2 に沿って再構築。
//   色 / ラインスタイル(実線/破線) / ラインの太さ / 矢印 / ライン形状 / ラベル色 は
//   オプションパネル側に一本化。ポップアップは切替と状態トグルに専念する。
function bdConnContextMenu(e, conn) {
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div'); menu.className = 'gb-context-menu';
  {
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    menu.style.left = (e.clientX / z) + 'px';
    menu.style.top = (e.clientY / z) + 'px';
  }
  function item(label, fn) { const d = document.createElement('div'); d.innerHTML = label; d.addEventListener('click', () => { document.querySelectorAll('.gb-context-menu').forEach(m => m.remove()); fn(); }); menu.appendChild(d); }
  function dangerItem(label, fn) { const d = document.createElement('div'); d.innerHTML = label; d.classList.add('danger'); d.addEventListener('click', () => { document.querySelectorAll('.gb-context-menu').forEach(m => m.remove()); fn(); }); menu.appendChild(d); }
  function sep() { const d = document.createElement('div'); d.className = 'bd-cm-sep'; menu.appendChild(d); }

  const fromN = bd.nodes.find(n => n.id === conn.from);
  const toN = bd.nodes.find(n => n.id === conn.to);
  const fromLbl = fromN ? fromN.text.split('\n')[0].slice(0, 12) : '?';
  const toLbl = toN ? toN.text.split('\n')[0].slice(0, 12) : '?';
  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'padding:4px 16px;color:var(--fg2);font-size:12px;cursor:default;';
  titleRow.innerHTML = esc(fromLbl) + ' → ' + esc(toLbl);
  menu.appendChild(titleRow);
  sep();
  item('テキスト編集', () => {
    if (!conn.label) { bdPushUndo(); conn.label = 'テキスト'; conn._labelWasEmpty = true; conn._labelPlaceholderUndoCaptured = true; bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-label-edit' }); bdDirty(); }
    if (typeof bdEditConnLabel === 'function') bdEditConnLabel(conn);
  });
  if (conn.label) {
    item('テキストを削除', () => { bdPushUndo(); conn.label = ''; bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-label-delete' }); bdDirty(); });
  } else {
    item('テキストを追加', () => { bdPushUndo(); conn.label = 'テキスト'; conn._labelWasEmpty = true; conn._labelPlaceholderUndoCaptured = true; bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-label-add' }); bdDirty(); if (typeof bdEditConnLabel === 'function') bdEditConnLabel(conn); });
  }
  item('反転 (from / to 入替)', () => {
    bdPushUndo();
    const tmp = conn.from; conn.from = conn.to; conn.to = tmp;
    const tmpFromPoint = conn.fromPoint;
    const tmpToPoint = conn.toPoint;
    if (tmpToPoint !== undefined) conn.fromPoint = tmpToPoint; else delete conn.fromPoint;
    if (tmpFromPoint !== undefined) conn.toPoint = tmpFromPoint; else delete conn.toPoint;
    const tmpFromAnchor = conn.fromAnchor;
    const tmpToAnchor = conn.toAnchor;
    if (tmpToAnchor !== undefined) conn.fromAnchor = tmpToAnchor; else delete conn.fromAnchor;
    if (tmpFromAnchor !== undefined) conn.toAnchor = tmpFromAnchor; else delete conn.toAnchor;
    if (Array.isArray(conn.controlPoints) && conn.controlPoints.length === 2) {
      conn.controlPoints = [{ ...conn.controlPoints[1] }, { ...conn.controlPoints[0] }];
    }
    if (conn.arrow === 'start') conn.arrow = 'end';
    else if (conn.arrow === 'end') conn.arrow = 'start';
    bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-reverse' }); bdDirty();
  });
  item('複製', () => {
    bdPushUndo();
    const duplicated = { ...conn };
    duplicated.id = typeof bdId === 'function' ? bdId() : ('conn-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    // ラベル重複を避けるため clone に「 (コピー)」を付けない。from/to が同じなので別配線として識別できる。
    bd.connections.push(duplicated);
    bdDrawConns({ connIds: [conn.id, duplicated.id], reason: 'conn-menu-duplicate' }); bdDirty();
  });
  // ライン上コメント追加導線。カードとは別の board_line target_kind として保存する。
  item('コメントを追加', () => {
    if (typeof addCommentHere !== 'function') return;
    const filePath = (typeof bd !== 'undefined' && bd?.path) || '';
    const snippet = (conn.label || '').trim().slice(0, 120);
    // 右クリック座標を仮想アンカーとする
    const cx = e.clientX, cy = e.clientY;
    const anchorEl = { getBoundingClientRect: () => ({ left: cx, top: cy, right: cx, bottom: cy, width: 0, height: 0, x: cx, y: cy }) };
    addCommentHere({
      targetKind: 'board_line',
      filePath,
      targetRef: { file: filePath, lineId: conn.id },
      snapshot: snippet || 'ライン',
    }, { anchorEl });
  });
  sep();
  // ラインスタイル サブ (切替のみ。編集はオプションパネル)
  {
    const stylePanel = _bdCreateContextSubmenu(menu, 'ラインスタイル', 140);
    const selectedConnIds = typeof bdGetSelectedConnectionIds === 'function' ? bdGetSelectedConnectionIds() : [];
    const targetConnIds = selectedConnIds.includes(conn.id) && selectedConnIds.length > 1 ? selectedConnIds : [conn.id];
    const currentStyleId = conn.styleRef || bd.activeLineStyle || '';
    (bd.lineStyles || []).forEach(style => {
      const si = document.createElement('div');
      si.innerHTML = radioMark(currentStyleId === style.id) + esc(style.name || '');
      si.style.cssText = 'padding:4px 16px;cursor:pointer;' + (currentStyleId === style.id ? 'color:var(--accent);' : '');
      si.onmouseenter = () => { si.style.background = 'var(--bg4)'; };
      si.onmouseleave = () => { si.style.background = ''; };
      si.addEventListener('click', () => {
        document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
        if (typeof _bdApplyLineStyleFromMenu === 'function') _bdApplyLineStyleFromMenu(targetConnIds, style.id);
      });
      stylePanel.appendChild(si);
    });
    if (stylePanel.childElementCount) {
      const sepEl = document.createElement('div');
      sepEl.className = 'bd-cm-sep';
      stylePanel.appendChild(sepEl);
    }
    const manageItem = document.createElement('div');
    manageItem.textContent = 'スタイル管理...';
    manageItem.style.cssText = 'padding:4px 16px;cursor:pointer;';
    manageItem.onmouseenter = () => { manageItem.style.background = 'var(--bg4)'; };
    manageItem.onmouseleave = () => { manageItem.style.background = ''; };
    manageItem.addEventListener('click', () => {
      document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
      if (typeof bdOpenLineStyleManager === 'function') bdOpenLineStyleManager();
    });
    stylePanel.appendChild(manageItem);
  }
  // 表示 サブ (非表示/表示 + 前面/背面)
  {
    const viewPanel = _bdCreateContextSubmenu(menu, '表示', 140);
    const isHidden = !!conn.hidden;
    const toggleItem = document.createElement('div');
    toggleItem.textContent = isHidden ? '表示する' : '非表示にする';
    toggleItem.style.cssText = 'padding:4px 16px;cursor:pointer;';
    toggleItem.onmouseenter = () => { toggleItem.style.background = 'var(--bg4)'; };
    toggleItem.onmouseleave = () => { toggleItem.style.background = ''; };
    toggleItem.addEventListener('click', () => {
      document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
      bdPushUndo();
      conn.hidden = !isHidden;
      bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-hidden' }); bdDirty();
    });
    viewPanel.appendChild(toggleItem);
    const zFrontItem = document.createElement('div');
    zFrontItem.textContent = '前面に移動';
    zFrontItem.style.cssText = 'padding:4px 16px;cursor:pointer;';
    zFrontItem.onmouseenter = () => { zFrontItem.style.background = 'var(--bg4)'; };
    zFrontItem.onmouseleave = () => { zFrontItem.style.background = ''; };
    zFrontItem.addEventListener('click', () => {
      document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
      bdPushUndo();
      const idx = bd.connections.indexOf(conn);
      if (idx >= 0 && idx < bd.connections.length - 1) {
        bd.connections.splice(idx, 1);
        bd.connections.push(conn);
        bdDrawConns(); bdDirty();
      }
    });
    viewPanel.appendChild(zFrontItem);
    const zBackItem = document.createElement('div');
    zBackItem.textContent = '背面に移動';
    zBackItem.style.cssText = 'padding:4px 16px;cursor:pointer;';
    zBackItem.onmouseenter = () => { zBackItem.style.background = 'var(--bg4)'; };
    zBackItem.onmouseleave = () => { zBackItem.style.background = ''; };
    zBackItem.addEventListener('click', () => {
      document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
      bdPushUndo();
      const idx = bd.connections.indexOf(conn);
      if (idx > 0) {
        bd.connections.splice(idx, 1);
        bd.connections.unshift(conn);
        bdDrawConns(); bdDirty();
      }
    });
    viewPanel.appendChild(zBackItem);
  }
  // v0.5.320: ライン形状の個別オーバーライドを既定値 (スタイル継承) に戻す
  const hasOverride = !!(conn.fromAnchor || conn.toAnchor
    || (Array.isArray(conn.controlPoints) && conn.controlPoints.length === 2)
    || Number.isFinite(+conn.branchRatio) || Number.isFinite(+conn.cornerRadius));
  if (hasOverride) {
    item('形状を既定にリセット', () => {
      bdPushUndo();
      delete conn.fromAnchor;
      delete conn.toAnchor;
      delete conn.controlPoints;
      delete conn.branchRatio;
      delete conn.cornerRadius;
      bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-reset' });
      bdDirty();
    });
  }
  sep();
  dangerItem('削除', async () => {
    if (!(await cfConfirm('このラインを削除しますか？'))) return;
    bdPushUndo();
    if (typeof bdRemoveConnection === 'function') bdRemoveConnection(conn);
    else { bd.connections = bd.connections.filter(c => c !== conn); bdDrawConns(); bdDirty(); }
  });
  document.body.appendChild(menu);
  if (typeof positionPopup === 'function') {
    positionPopup(menu, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
  } else {
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    const r = menu.getBoundingClientRect();
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    if (r.right / z > vw) menu.style.left = Math.max(4, vw - (r.width / z) - 4) + 'px';
    if (r.bottom / z > vh) menu.style.top = Math.max(4, vh - (r.height / z) - 4) + 'px';
    if (typeof clampPopupToViewport === 'function') clampPopupToViewport(menu);
  }
  setTimeout(() => document.addEventListener('pointerdown', function h(ev) {
    const inAny = [...document.querySelectorAll('.gb-context-menu')].some(m => m.contains(ev.target));
    if (!inAny) {
      document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
      document.removeEventListener('pointerdown', h);
    }
  }, { once: false }), 0);
}
