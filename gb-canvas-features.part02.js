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
  if (typeof bdSyncNodeDomOrder === 'function') bdSyncNodeDomOrder();
  if (typeof bdMarkSelectionDirty === 'function') bdMarkSelectionDirty(ids, 'move-z');
  bdDirty();
}
// --- 4. Lock ---
function bdToggleLock() {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  const anyLocked = ids.some(id => { const n = bd.nodes.find(v => v.id === id); return n && n.locked; });
  ids.forEach(id => { const n = bd.nodes.find(v => v.id === id); if (n) n.locked = !anyLocked; });
  if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(ids, 'toggle-lock');
  else bdRender();
  bdDirty();
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
  if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(ids, 'flip');
  else bdRender();
  bdDirty();
}

function bdRotate(deg) {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  ids.forEach(id => {
    const n = bd.nodes.find(v => v.id === id); if (!n) return;
    n.rotate = ((n.rotate || 0) + deg) % 360;
  });
  if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(ids, 'rotate');
  else bdRender();
  bdDirty();
}

function bdSetOpacity(val) {
  const ids = [...bd.selected]; if (!ids.length) return;
  bdPushUndo();
  ids.forEach(id => { const n = bd.nodes.find(v => v.id === id); if (n) n.opacity = val; });
  if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(ids, 'opacity');
  else bdRender();
  bdDirty();
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
  if (window.MeldexBoardTransfer?.requestPaste) {
    return window.MeldexBoardTransfer.requestPaste({ imagesOnly: true });
  }
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
            if (canvasEl) {
              const rect = canvasEl.getBoundingClientRect();
              pos = bdScreenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
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
    // html2canvasが複雑な内容で極端に時間がかかる／返ってこないことがあるため、
    // 単独版など無期限に固まって見えるのを避ける上限時間を設ける
    // （gb-export-image.js の同種フォールバックと同じ考え方）。
    const canvas = await Promise.race([
      html2canvas(stage, {
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
      }),
      new Promise((_resolve, reject) => setTimeout(
        () => reject(new Error('画像生成がタイムアウトしました（内容が複雑すぎる可能性があります）')),
        25000,
      )),
    ]);
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
  if (!imgNodes.length) { showStatus('画像トピックがありません', true); return; }
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
// --- Find & Replace は gb-board-find.js に分離済み (v0.5.287) ---

// --- Numbering ---
function bdToggleNumbering() {
  bd._numbering = !bd._numbering;
  const nodeIds = (bd.nodes || []).map(node => node?.id).filter(Boolean);
  if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(nodeIds, 'toggle-numbering');
  else bdRender();
  bdDirty();
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

// --- Dialog mutation checkpoints ---
function _bdDialogCaptureHistoryCheckpoint() {
  if (typeof _bdHasCommonHistory === 'function' && _bdHasCommonHistory()
      && typeof _historyStacks !== 'undefined' && typeof _bdHistoryScope === 'function') {
    const scope = _bdHistoryScope();
    const existed = Object.prototype.hasOwnProperty.call(_historyStacks, scope);
    const stack = _historyStacks[scope] || { undo: [], redo: [] };
    return {
      mode: 'common',
      scope,
      existed,
      undo: stack.undo.slice(),
      redo: stack.redo.slice(),
      globalRedo: typeof _historyGlobal !== 'undefined' ? _historyGlobal.redo.slice() : null,
    };
  }
  return {
    mode: 'local',
    undo: typeof _bdUndoStack !== 'undefined' ? _bdUndoStack.slice() : [],
    redo: typeof _bdRedoStack !== 'undefined' ? _bdRedoStack.slice() : [],
  };
}

function _bdDialogRestoreHistoryCheckpoint(checkpoint) {
  if (!checkpoint) return;
  if (checkpoint.mode === 'common' && typeof _historyStacks !== 'undefined') {
    if (!checkpoint.existed) {
      delete _historyStacks[checkpoint.scope];
    } else {
      const stack = _historyStacks[checkpoint.scope] || (_historyStacks[checkpoint.scope] = { undo: [], redo: [] });
      stack.undo.splice(0, stack.undo.length, ...checkpoint.undo);
      stack.redo.splice(0, stack.redo.length, ...checkpoint.redo);
    }
    if (checkpoint.globalRedo && typeof _historyGlobal !== 'undefined') {
      _historyGlobal.redo.splice(0, _historyGlobal.redo.length, ...checkpoint.globalRedo);
    }
    try { if (typeof renderHistoryList === 'function') renderHistoryList(); } catch {}
    try { if (typeof renderHistoryPanel === 'function') renderHistoryPanel(); } catch {}
  } else {
    if (typeof _bdUndoStack !== 'undefined') _bdUndoStack.splice(0, _bdUndoStack.length, ...checkpoint.undo);
    if (typeof _bdRedoStack !== 'undefined') _bdRedoStack.splice(0, _bdRedoStack.length, ...checkpoint.redo);
  }
  try { if (typeof updateUndoRedoButtonStates === 'function') updateUndoRedoButtonStates(); } catch {}
}

function _bdDialogCaptureMutationCheckpoint() {
  return {
    dirty: !!bd.dirty,
    autoVersionDirty: typeof _autoVersionDirty !== 'undefined' ? _autoVersionDirty : undefined,
    hadPendingSave: !!window._bdTimer && !!bd.dirty,
    history: _bdDialogCaptureHistoryCheckpoint(),
  };
}

function _bdDialogRestoreMutationCheckpoint(checkpoint) {
  if (!checkpoint) return;
  if (window._bdTimer) clearTimeout(window._bdTimer);
  window._bdTimer = null;
  bd.dirty = checkpoint.dirty;
  if (checkpoint.autoVersionDirty !== undefined && typeof _autoVersionDirty !== 'undefined') {
    _autoVersionDirty = checkpoint.autoVersionDirty;
  }
  _bdDialogRestoreHistoryCheckpoint(checkpoint.history);
  if (checkpoint.hadPendingSave && typeof bdSave === 'function') window._bdTimer = setTimeout(bdSave, 500);
}

function _bdDialogHistorySize(checkpoint) {
  const history = checkpoint?.history || checkpoint;
  return {
    undo: history?.undo?.length || 0,
    redo: history?.redo?.length || 0,
    globalRedo: history?.globalRedo?.length || 0,
  };
}

// --- Note Panel ---
function bdEditNote(nodeId) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  if (!window.GBUI?.createModal) throw new Error('トピックノート編集ダイアログを初期化できませんでした');
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const uid = 'bd-note-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const textarea = document.createElement('textarea');
  textarea.id = uid + '-text';
  textarea.className = 'gb-textarea';
  textarea.rows = 12;
  textarea.value = n.note || '';
  textarea.dataset.e2eId = 'board-note-text';
  textarea.setAttribute('aria-label', 'トピックノート');
  textarea.style.cssText = 'box-sizing:border-box;width:100%;min-height:180px;resize:vertical;';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'gb-btn gb-btn-sm';
  cancelButton.dataset.e2eId = 'board-note-cancel';
  cancelButton.textContent = 'キャンセル';
  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'gb-btn gb-btn-sm gb-btn-primary';
  saveButton.dataset.e2eId = 'board-note-save';
  saveButton.textContent = '保存';
  [cancelButton, saveButton].forEach(button => {
    button.style.minWidth = '44px';
    button.style.minHeight = '44px';
  });
  let saving = false;
  const modalApi = window.GBUI.createModal({
    id: uid,
    title: `ノート: ${(n.text || '').split('\n')[0].slice(0, 30)}`,
    body: textarea,
    footer: [cancelButton, saveButton],
    variant: 'standard',
    extraClass: 'bd-note-dialog',
    geometryKey: 'board-card-note',
    minWidth: '0',
    initialFocus: textarea,
    returnFocus: returnFocus || undefined,
    closeLabel: 'トピックノートを閉じる',
    closeOnEsc: true,
    closeOnOverlay: true,
    onBeforeClose: reason => !saving || reason === 'saved',
  });
  modalApi.overlay.dataset.e2eId = 'board-note-overlay';
  modalApi.modal.dataset.e2eId = 'board-note-dialog';
  const headerClose = modalApi.header.querySelector('.gb-modal-close');
  headerClose?.setAttribute('data-e2e-id', 'board-note-header-close');
  if (headerClose) headerClose.style.cssText = 'width:44px;min-width:44px;height:44px;min-height:44px;';
  modalApi.modal.style.cssText = 'width:min(620px, calc(100vw - 24px));overflow:hidden;';
  modalApi.body.style.cssText = 'box-sizing:border-box;min-width:0;min-height:0;overflow-y:auto;';
  modalApi.body.style.setProperty('overflow-x', 'hidden', 'important');
  cancelButton.addEventListener('click', () => modalApi.close('cancel'));
  saveButton.addEventListener('click', () => {
    if (saving) return;
    saving = true;
    saveButton.disabled = true;
    const hadOwnNote = Object.prototype.hasOwnProperty.call(n, 'note');
    const previousNote = n.note;
    const checkpoint = _bdDialogCaptureMutationCheckpoint();
    try {
      if (typeof bdPushUndo === 'function') bdPushUndo('トピックノートを編集');
      n.note = textarea.value;
      if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nodeId], 'edit-note', { detailPanel: true });
      else bdRender();
      bdDirty();
    } catch (error) {
      if (hadOwnNote) n.note = previousNote; else delete n.note;
      _bdDialogRestoreMutationCheckpoint(checkpoint);
    try { if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nodeId], 'restore-note', { detailPanel: true }); else bdRender(); } catch (renderError) { console.error('トピックノート復元後の再描画に失敗しました:', renderError); }
      console.error('トピックノートを保存できませんでした:', error);
      try { showStatus('ノートを保存できませんでした', true); } catch {}
      saving = false;
      saveButton.disabled = false;
      textarea.focus({ preventScroll: true });
      return;
    }
    modalApi.close('saved');
    try { showStatus('ノートを保存しました'); } catch (error) { console.warn('トピックノート保存通知に失敗しました:', error); }
  });
  modalApi.open();
  replaceIcons(modalApi.overlay);
  return modalApi;
}

// --- Summary ---
function bdAddSummary() {
  const ids = [...bd.selected]; if (ids.length < 2) { showStatus('2つ以上のトピックを選択してください', true); return; }
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
    showStatus('表示中のトピックを選択してください', true);
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
  if (typeof bdAppendFastNode !== 'function' || !bdAppendFastNode(summary)) {
    if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([summary.id], 'add-summary');
    else bdRender();
  }
  if (typeof bdDrawConns === 'function') bdDrawConns({ nodeIds: [summary.id], reason: 'add-summary' });
  bdSelect(summary.id); bdDirty();
}

// --- Drill Down ---
let _bdDrillRoot = null;
function bdDrillDown(nodeId) {
  _bdDrillRoot = nodeId;
  bdRender();
    showStatus('ドリルダウン表示中（トピックまたはボードのメニューから「ドリルダウン解除」で戻れます）');
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
  if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nodeId], 'marker');
  else bdRender();
  bdDirty();
}

// --- カードHUD クリック時のサブメニュー (board-card-popup-redesign-plan.md §7) ---
// カードHUDの左上ステータス/右下マーカー/左下コメントをクリックしたときに、その要素位置に
// ポップアップを開く。既存の .gb-context-menu を流用し、bdContextMenu と共存可能にする。
function _bdCreateHudMenu(rect, options) {
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu';
  menu.setAttribute('role', 'menu');
  if (options?.label) menu.setAttribute('aria-label', options.label);
  menu.style.position = 'fixed';
  menu.style.minWidth = '180px';
  const trigger = options?.trigger || null;
  if (typeof _bdTrackContextMenuTrigger === 'function') _bdTrackContextMenuTrigger(menu, trigger);
  const closeMenu = (restoreFocus = false) => {
    menu.remove();
    if (trigger?.setAttribute) trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && trigger && typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(trigger);
  };
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
        closeMenu(false);
        document.removeEventListener('pointerdown', h);
      }
    }, { once: false });
  }, 0);
  menu.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu(true);
    }
  });
  return menu;
}
function _bdHudMenuItem(htmlLabel, onClick, opts) {
  const d = document.createElement('div');
  d.className = 'gb-context-menu-item';
  d.tabIndex = 0;
  d.setAttribute('role', opts?.role || 'menuitem');
  if (opts?.checked !== undefined) d.setAttribute('aria-checked', opts.checked ? 'true' : 'false');
  d.innerHTML = htmlLabel;
  if (opts?.danger) d.classList.add('danger');
  d.addEventListener('click', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
    try { onClick?.(); } catch {}
  });
  d.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      d.click();
    }
  });
  return d;
}
function _bdHudMenuSep() {
  const d = document.createElement('div');
  d.className = 'gb-context-menu-sep';
  return d;
}
function _bdRepositionHudMenu(menu, rect) {
  if (!menu || !rect) return;
  if (typeof positionPopup === 'function') {
    positionPopup(menu, rect);
  } else if (typeof clampPopupToViewport === 'function') {
    clampPopupToViewport(menu);
  }
}
function _bdCheckMark(isActive) {
  return isActive ? lucide('check', 12) + ' ' : '<span style="display:inline-block;width:14px;"></span>';
}

function bdStatusMenuFor(nodeId, rect, trigger) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const menu = _bdCreateHudMenu(rect, { label: 'ステータス', trigger });
  const targetIds = bd.selected.has(nodeId) ? [...bd.selected] : [nodeId];
  const setStatus = (st) => {
    bdPushUndo();
    targetIds.forEach(id => { const nd = bd.nodes.find(v => v.id === id); if (nd) nd.status = st; });
    if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(targetIds, 'status-hud');
    else bdRender();
    bdDirty();
  };
  const curStatus = n.status || '';
  // 「なし」項目
  menu.appendChild(_bdHudMenuItem(_bdCheckMark(!curStatus) + 'なし', () => setStatus(''), { role: 'menuitemradio', checked: !curStatus }));
  bdStatusNames().filter(s => !!s).forEach(st => {
    const sd = bdStatusDef(st);
    const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${sd.color};margin-right:4px;vertical-align:middle;"></span>`;
    menu.appendChild(_bdHudMenuItem(_bdCheckMark(curStatus === st) + dot + esc(st), () => setStatus(st), { role: 'menuitemradio', checked: curStatus === st }));
  });
  menu.appendChild(_bdHudMenuSep());
  menu.appendChild(_bdHudMenuItem('ステータスを管理...', () => {
    if (typeof bdManageStatuses === 'function') bdManageStatuses();
  }));
  _bdRepositionHudMenu(menu, rect);
  requestAnimationFrame(() => _bdFocusContextMenuItem(menu, 'first'));
}

function bdMarkerMenuFor(nodeId, rect, trigger) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const menu = _bdCreateHudMenu(rect, { label: 'マーカー', trigger });
  const markers = n.markers || {};
  // 2026-04-18: BD_MARKERS.progress 廃止に伴い progress ラベルは不要。priority / flag のみ保持。
  const categoryLabels = { priority: '優先度', flag: 'フラグ' };
  const entries = Object.entries(BD_MARKERS);
  entries.forEach(([cat, list], catIdx) => {
    if (catIdx > 0) menu.appendChild(_bdHudMenuSep());
    _bdContextMenuLabel(menu, categoryLabels[cat] || cat);
    list.forEach((mk, idx) => {
      const isActive = markers[cat] === idx;
      const iconHtml = typeof bdMarkerIconHtml === 'function' ? bdMarkerIconHtml(mk, 12) : lucide(mk.icon, 12);
      const iconSpan = `<span style="color:${mk.color};margin-right:4px;vertical-align:middle;">${iconHtml}</span>`;
      menu.appendChild(_bdHudMenuItem(
        _bdCheckMark(isActive) + iconSpan + esc(mk.label),
        () => { bdPushUndo(); bdSetMarker(nodeId, cat, isActive ? -1 : idx); },
        { role: 'menuitemcheckbox', checked: isActive }
      ));
    });
  });
  if (markers && Object.keys(markers).length > 0) {
    menu.appendChild(_bdHudMenuSep());
    menu.appendChild(_bdHudMenuItem('すべてクリア', () => {
      bdPushUndo();
      const n2 = bd.nodes.find(v => v.id === nodeId);
      if (n2) n2.markers = {};
      if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nodeId], 'clear-markers-hud');
      else bdRender();
      bdDirty();
    }));
  }
  _bdRepositionHudMenu(menu, rect);
  requestAnimationFrame(() => _bdFocusContextMenuItem(menu, 'first'));
}

function bdCommentMenuFor(nodeId, rect, trigger) {
  const n = bd.nodes.find(v => v.id === nodeId); if (!n) return;
  const menu = _bdCreateHudMenu(rect, { label: 'コメント', trigger });
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
  _bdRepositionHudMenu(menu, rect);
  requestAnimationFrame(() => _bdFocusContextMenuItem(menu, 'first'));
}

// --- 下部ツールバーのズーム倍率ラベルをクリックしたときのドロップダウン ---
// プリセット倍率 + フィットマップを選択可能にする。
function bdShowZoomMenu(anchor) {
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  anchor.setAttribute('aria-haspopup', 'menu');
  const menu = _bdCreateHudMenu(rect, { trigger: anchor });
  menu.setAttribute('aria-label', '表示倍率');
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
  if (typeof positionPopup === 'function') {
    positionPopup(menu, rect);
  } else if (typeof clampPopupToViewport === 'function') {
    clampPopupToViewport(menu);
  }
  requestAnimationFrame(() => {
    if (menu.isConnected) menu.querySelector('.gb-context-menu-item')?.focus?.();
  });
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
  if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial([nodeId], 'shape');
  else bdRender();
  bdDirty();
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
  if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(ids, 'resize-selected');
  else bdRender();
  bdDirty();
}

// --- 14. Context Menus ---
function _bdCloseAllContextMenus() {
  document.querySelectorAll('.gb-context-menu').forEach(m => m.remove());
}

function _bdTrackContextMenuTrigger(menu, trigger) {
  if (!menu || !trigger?.setAttribute) return;
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'true');
  if (typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(() => {
    if (menu.isConnected) return;
    trigger.setAttribute('aria-expanded', 'false');
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true });
}

function _bdVisibleContextMenuItems(menu) {
  return [...(menu?.querySelectorAll?.('.gb-context-menu-item') || [])]
    .filter(item => !item.classList.contains('disabled')
      && item.getAttribute('aria-disabled') !== 'true'
      && item.offsetParent !== null);
}

function _bdFocusContextMenuItem(menu, direction) {
  const items = _bdVisibleContextMenuItems(menu);
  if (!items.length) return;
  const current = document.activeElement;
  const idx = Math.max(0, items.indexOf(current));
  const nextIdx = direction === 'first' ? 0
    : direction === 'last' ? items.length - 1
    : (idx + direction + items.length) % items.length;
  items[nextIdx]?.focus?.();
}

function _bdEnhanceContextMenu(menu, label) {
  if (!menu) return menu;
  menu.classList.add('gb-context-menu');
  menu.setAttribute('role', 'menu');
  if (label) menu.setAttribute('aria-label', label);
  if (menu.dataset.bdMenuEnhanced === '1') return menu;
  menu.dataset.bdMenuEnhanced = '1';
  menu.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      _bdCloseAllContextMenus();
      return;
    }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); _bdFocusContextMenuItem(menu, 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); _bdFocusContextMenuItem(menu, -1); }
    else if (ev.key === 'Home') { ev.preventDefault(); _bdFocusContextMenuItem(menu, 'first'); }
    else if (ev.key === 'End') { ev.preventDefault(); _bdFocusContextMenuItem(menu, 'last'); }
  });
  return menu;
}

function _bdContextMenuItem(parent, label, fn, opts) {
  const options = opts || {};
  const item = document.createElement('div');
  item.className = 'gb-context-menu-item';
  item.tabIndex = options.disabled ? -1 : 0;
  item.setAttribute('role', options.role || 'menuitem');
  if (options.checked !== undefined) item.setAttribute('aria-checked', options.checked ? 'true' : 'false');
  if (options.disabled) {
    item.classList.add('disabled');
    item.setAttribute('aria-disabled', 'true');
  }
  if (options.danger) item.classList.add('danger');
  if (options.html === false) item.textContent = String(label || '');
  else item.innerHTML = label;
  const activate = ev => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    if (options.disabled) return;
    _bdCloseAllContextMenus();
    fn?.();
  };
  item.addEventListener('click', activate);
  item.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' || ev.key === ' ') activate(ev);
  });
  parent?.appendChild?.(item);
  return item;
}

function _bdContextMenuLabel(parent, label) {
  const item = document.createElement('div');
  item.className = 'gb-context-menu-label';
  item.textContent = label;
  item.setAttribute('role', 'presentation');
  parent?.appendChild?.(item);
  return item;
}

function _bdContextMenuSep(parent) {
  const sep = document.createElement('div');
  sep.className = 'gb-context-menu-sep bd-cm-sep';
  sep.setAttribute('role', 'separator');
  parent?.appendChild?.(sep);
  return sep;
}

function _bdCreateContextSubmenu(menu, label, minWidth) {
  const wrap = document.createElement('div');
  wrap.className = 'gb-context-menu-submenu';
  const trigger = document.createElement('div');
  trigger.className = 'gb-context-menu-item has-submenu';
  trigger.innerHTML = esc(label);
  trigger.tabIndex = 0;
  trigger.setAttribute('role', 'menuitem');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  const panel = _bdEnhanceContextMenu(document.createElement('div'), label);
  panel.style.cssText = `display:none;min-width:${minWidth || 120}px;`;
  attachHoverSubmenu(trigger, panel);
  trigger.addEventListener('mouseenter', () => trigger.setAttribute('aria-expanded', 'true'));
  trigger.addEventListener('mouseleave', () => setTimeout(() => {
    if (panel.style.display === 'none') trigger.setAttribute('aria-expanded', 'false');
  }, 220));
  panel.addEventListener('mouseleave', () => setTimeout(() => {
    if (panel.style.display === 'none') trigger.setAttribute('aria-expanded', 'false');
  }, 220));
  trigger.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => _bdFocusContextMenuItem(panel, 'first'));
  });
  panel.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowLeft') return;
    ev.preventDefault();
    panel.style.display = 'none';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus?.();
  });
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
  if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(ids, 'menu-card-style', { detailPanel: true });
  else bdRender();
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
}

// ノードを「階層別スタイル」に戻す。
// - cardStyle (個別カードスタイル参照) をクリア
// - bdClearCardStyleOverrides で per-node 視覚 override を削除
// - _userCardStyle / _userBgColor / _userFontSize / _userFontBold / _userW フラグを削除
//   （これらが立っていると bdApplyAutoStyle が深さ別の値で上書きしないため、
//    フラグを消して階層スタイルが効くようにする）
// - 対象ノードから親方向へ辿り、最初に見つかった起点 (_autoStyle: true のカード。
//   絶対ルートとは限らない。入れ子起点は近い方が優先される) があれば
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
    // 課題18-案A: 絶対ルートではなく「最も近い起点」まで遡る。祖先鎖の途中に起点があれば
    // そちらを優先し (入れ子起点の「近い方が勝つ」)、絶対ルートまで遡らない。
    const anchor = (typeof _bdNearestAutoStyleAnchor === 'function') ? _bdNearestAutoStyleAnchor(nodeId) : null;
    if (anchor) rootsToReapply.add(anchor.id);
  });
  if (typeof bdApplyAutoStyle === 'function') {
    rootsToReapply.forEach(rid => bdApplyAutoStyle(rid));
  }
  if (typeof bdRefreshNodesPartial === 'function') bdRefreshNodesPartial(ids, 'restore-depth-style', { detailPanel: true });
  else bdRender();
  bdDirty();
  if (typeof bdRefreshSelectionDetails === 'function') bdRefreshSelectionDetails(true);
  if (typeof showStatus === 'function') {
    showStatus(rootsToReapply.size
      ? '階層別スタイルに戻しました'
      : '個別スタイルを解除しました（トピックを右クリックして「階層別スタイルの起点にする」を選ぶと深さ別スタイルが反映されます）');
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
  _bdCloseAllContextMenus();
  const menu = _bdEnhanceContextMenu(document.createElement('div'), 'ラインメニュー');
  _bdTrackContextMenuTrigger(menu, e?.trigger || null);
  {
    const z = (typeof _getZoom === 'function') ? _getZoom() : (parseFloat(document.documentElement.style.zoom) || 1);
    menu.style.left = (e.clientX / z) + 'px';
    menu.style.top = (e.clientY / z) + 'px';
  }
  function item(label, fn) { return _bdContextMenuItem(menu, label, fn); }
  function dangerItem(label, fn) { return _bdContextMenuItem(menu, label, fn, { danger: true }); }
  function sep() { return _bdContextMenuSep(menu); }

  const fromN = bd.nodes.find(n => n.id === conn.from);
  const toN = bd.nodes.find(n => n.id === conn.to);
  const fromLbl = fromN ? fromN.text.split('\n')[0].slice(0, 12) : '?';
  const toLbl = toN ? toN.text.split('\n')[0].slice(0, 12) : '?';
  _bdContextMenuLabel(menu, `${fromLbl} → ${toLbl}`);
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
      const si = _bdContextMenuItem(stylePanel, radioMark(currentStyleId === style.id) + esc(style.name || ''), () => {
        if (typeof _bdApplyLineStyleFromMenu === 'function') _bdApplyLineStyleFromMenu(targetConnIds, style.id);
      }, {
        role: 'menuitemradio',
        checked: currentStyleId === style.id,
      });
      if (currentStyleId === style.id) si.style.color = 'var(--accent)';
    });
    if (stylePanel.childElementCount) {
      _bdContextMenuSep(stylePanel);
    }
    _bdContextMenuItem(stylePanel, 'スタイル管理...', () => {
      if (typeof bdOpenLineStyleManager === 'function') bdOpenLineStyleManager();
    });
  }
  // 表示 サブ (非表示/表示 + 前面/背面)
  {
    const viewPanel = _bdCreateContextSubmenu(menu, '表示', 140);
    const isHidden = !!conn.hidden;
    _bdContextMenuItem(viewPanel, isHidden ? '表示する' : '非表示にする', () => {
      bdPushUndo();
      conn.hidden = !isHidden;
      bdDrawConns({ connIds: [conn.id], reason: 'conn-menu-hidden' }); bdDirty();
    });
    _bdContextMenuItem(viewPanel, '前面に移動', () => {
      bdPushUndo();
      const idx = bd.connections.indexOf(conn);
      if (idx >= 0 && idx < bd.connections.length - 1) {
        bd.connections.splice(idx, 1);
        bd.connections.push(conn);
        if (typeof bdSyncConnectionDomOrder === 'function') bdSyncConnectionDomOrder();
        else bdDrawConns();
        bdDirty();
      }
    });
    _bdContextMenuItem(viewPanel, '背面に移動', () => {
      bdPushUndo();
      const idx = bd.connections.indexOf(conn);
      if (idx > 0) {
        bd.connections.splice(idx, 1);
        bd.connections.unshift(conn);
        if (typeof bdSyncConnectionDomOrder === 'function') bdSyncConnectionDomOrder();
        else bdDrawConns();
        bdDirty();
      }
    });
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
    else { bd.connections = bd.connections.filter(c => c !== conn); bdDrawConns({ connIds: [conn.id], reason: 'remove-connection-fallback' }); bdDirty(); }
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
