/* gb-db-entity-layout-canvas.js: エントリレイアウトの自由配置キャンバス描画。
   - デザイン基準サイズ（layout.canvasSize）でセルを絶対配置し、表示コンテナ幅へ
     transform: scale() で等比フィットさせる（要望8。ResizeObserverで追従）。
   - 編集モード: セルのドラッグ移動・右下ハンドルでのリサイズ・選択・削除、
     「列を配置」メニュー、キャンバスサイズ設定。
   - ボードのキャンバスエンジン（gb-canvas-engine*）はグローバル状態と強く結合しているため
     直接流用せず、ドラッグ/リサイズの考え方だけを踏襲した軽量実装とする（計画書2.4節）。
   セル内容の描画は gb-db-entity-layout-cells.js の _elBuildCellContent が担当する。 */
'use strict';

const EL_DRAG_SNAP = 5;

function _elZoomFactor() {
  return typeof _getZoom === 'function' ? Math.max(0.1, Number(_getZoom()) || 1) : 1;
}

function _elSnap(value) {
  return Math.round(value / EL_DRAG_SNAP) * EL_DRAG_SNAP;
}

/* レイアウト本体を grid コンテナへ描画する（renderEntityPropsGridInto から委譲される）。 */
function _elRenderLayoutBody(grid, data, entityPath, options, dbPath, layoutId, rerender) {
  const state = _elGetState(dbPath);
  const layout = state?.layouts.find(l => l.id === layoutId);
  const host = document.createElement('div');
  host.className = 'el-host';
  host.dataset.e2eId = 'entity-layout-host';
  grid.appendChild(host);
  if (!layout) {
    const missing = document.createElement('div');
    missing.className = 'el-empty-hint';
    missing.textContent = 'このトピックレイアウトは見つかりませんでした';
    host.appendChild(missing);
    return;
  }
  const session = _elSession(grid, entityPath);
  const editMode = !!session.editMode;
  const safeRerender = () => {
    if (grid.isConnected && typeof rerender === 'function') rerender();
  };
  const ctx = {
    grid, data, entityPath, options, dbPath, layout, editMode,
    readOnly: options?.readOnly === true,
    rerender: safeRerender,
    propTypes: options?.propTypes
      || (typeof getPropertyTypes === 'function' ? getPropertyTypes(dbPath) : null)
      || {},
    persist(label, detail, mutator) {
      if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(grid, options)) return null;
      return _elMutateState(dbPath, label, detail, (st, cfg) => {
        const target = st.layouts.find(l => l.id === layoutId);
        if (!target) return false;
        return mutator(target, st, cfg);
      }, { onRestore: safeRerender });
    },
  };

  if (editMode) host.appendChild(_elBuildEditToolbar(ctx));

  const viewport = document.createElement('div');
  viewport.className = 'el-viewport' + (editMode ? ' el-editing' : '');
  viewport.dataset.e2eId = 'entity-layout-viewport';
  host.appendChild(viewport);

  const canvas = document.createElement('div');
  canvas.className = 'el-canvas';
  canvas.style.width = layout.canvasSize.w + 'px';
  canvas.style.height = layout.canvasSize.h + 'px';
  viewport.appendChild(canvas);
  if (typeof _elApplyLayoutTheme === 'function') _elApplyLayoutTheme(canvas, layout);

  layout.cells.forEach(cell => {
    canvas.appendChild(_elBuildCellElement(cell, ctx, canvas));
  });

  if (layout.cells.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'el-empty-hint';
    hint.dataset.e2eId = 'entity-layout-empty-hint';
    hint.textContent = editMode
      ? '「列を配置」からセルを追加してください'
      : 'セルがありません（鉛筆ボタンからレイアウトを編集できます）';
    canvas.appendChild(hint);
  }

  // 等比フィット: コンテナ幅に合わせて縮小/拡大し、高さは縦横比に追従させる
  const applyScale = () => {
    if (!viewport.isConnected) return;
    const width = viewport.clientWidth;
    if (!width) return;
    const scale = width / layout.canvasSize.w;
    canvas.style.transform = 'scale(' + scale + ')';
    canvas.dataset.elScale = String(scale);
    canvas.style.setProperty('--el-inverse-scale', String(scale > 0 ? 1 / scale : 1));
    viewport.style.height = Math.ceil(layout.canvasSize.h * scale) + 'px';
  };
  applyScale();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => applyScale());
    observer.observe(viewport);
    // 解放はタブ行の再構築時（_elBuildTabBar）に grid 経由で行う
    grid._elViewportObserver = observer;
  }

  // 長文の自動フィット（要望10）: レイアウト確定後にセルごとへ適用する
  requestAnimationFrame(() => {
    if (!canvas.isConnected || typeof _elAutoFitCellText !== 'function') return;
    layout.cells.forEach(cell => {
      const cellEl = canvas.querySelector('.el-cell[data-cell-id="' + cell.id + '"]');
      if (cellEl) _elAutoFitCellText(cellEl, cell);
    });
  });

  // 編集モード: 何もない場所のクリックで選択解除
  if (editMode) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.target === canvas) _elClearCellSelection(canvas);
    });
  }
}

function _elClearCellSelection(canvas) {
  canvas.querySelectorAll('.el-cell.el-selected').forEach(el => el.classList.remove('el-selected'));
}

function _elSelectCellElement(canvas, cellEl) {
  _elClearCellSelection(canvas);
  cellEl.classList.add('el-selected');
}

/* セル1件のDOMを構築する（枠 + 内容 + 編集モードの操作チローム） */
function _elBuildCellElement(cell, ctx, canvas) {
  const el = document.createElement('div');
  el.className = 'el-cell el-cell-' + cell.type;
  el.dataset.cellId = cell.id;
  el.dataset.e2eId = 'entity-layout-cell';
  el.style.left = cell.x + 'px';
  el.style.top = cell.y + 'px';
  el.style.width = cell.w + 'px';
  el.style.height = cell.h + 'px';

  const content = typeof _elBuildCellContent === 'function'
    ? _elBuildCellContent(cell, ctx, canvas)
    : null;
  if (content) el.appendChild(content);
  if (typeof _elApplyCellStyle === 'function') _elApplyCellStyle(el, cell, ctx);

  if (!ctx.editMode) return el;

  // --- 以下は編集モード専用のチローム ---
  el.classList.add('el-editable');
  el.tabIndex = 0;
  el.setAttribute('role', 'group');
  const typeLabel = cell.type === 'field' ? (cell.prop || '列')
    : cell.type === 'label' ? (cell.text || '見出し')
      : cell.type === 'image' ? '画像'
        : cell.type === 'divider' ? '罫線'
          : cell.type === 'chart' ? 'チャート' : cell.type;
  el.setAttribute('aria-label', typeLabel + 'のレイアウトセル');
  // フォーカスだけでも選択状態にして、ホバーを使えないキーボード操作から
  // 設定・削除ボタンへ Tab で到達できるようにする。
  el.addEventListener('focus', () => _elSelectCellElement(canvas, el));

  // 見出しセルはダブルクリックでテキストを直接編集する
  if (cell.type === 'label') {
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _elBeginLabelEdit(el, cell, ctx);
    });
  }

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'el-cell-settings';
  settingsBtn.dataset.e2eId = 'entity-layout-cell-settings';
  const settingsLabel = cell.type === 'image' ? '画像の設定'
    : cell.type === 'divider' ? '罫線の色' : 'セルの書式';
  settingsBtn.title = settingsLabel;
  settingsBtn.setAttribute('aria-label', settingsLabel);
  settingsBtn.setAttribute('aria-haspopup', 'dialog');
  settingsBtn.innerHTML = typeof lucide === 'function' ? lucide('settings2', 12) : '⚙';
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _elSelectCellElement(canvas, el);
    if (typeof _elOpenCellSettings === 'function') _elOpenCellSettings(settingsBtn, cell, ctx, el);
  });
  settingsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.appendChild(settingsBtn);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'el-cell-remove';
  removeBtn.dataset.e2eId = 'entity-layout-cell-remove';
  removeBtn.title = 'セルを削除';
  removeBtn.setAttribute('aria-label', 'セルを削除');
  removeBtn.innerHTML = typeof lucide === 'function' ? lucide('x', 12) : '×';
  // セル削除は配置の編集操作（データ自体は消えない）なので確認は出さず、取り消し履歴で戻せるようにする
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.persist('トピックレイアウト: セル削除', '', (layout) => {
      const idx = layout.cells.findIndex(c => c.id === cell.id);
      if (idx < 0) return false;
      layout.cells.splice(idx, 1);
    });
    ctx.rerender();
  });
  el.appendChild(removeBtn);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'el-cell-resize';
  resizeHandle.dataset.e2eId = 'entity-layout-cell-resize';
  resizeHandle.setAttribute('aria-hidden', 'true');
  el.appendChild(resizeHandle);

  el.addEventListener('keydown', (e) => {
    if (e.target !== el) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      _elSelectCellElement(canvas, el);
      settingsBtn.focus({ preventScroll: true });
    }
  });

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target === removeBtn || removeBtn.contains(e.target)) return;
    if (el.classList.contains('el-label-editing')) return; // 見出しテキスト編集中はドラッグしない
    const resizing = e.target === resizeHandle;
    e.preventDefault();
    e.stopPropagation();
    _elSelectCellElement(canvas, el);
    _elBeginCellPointerOp(e, el, cell, ctx, canvas, resizing ? 'resize' : 'move');
  });

  return el;
}

/* 見出しセルのインラインテキスト編集。blur/Enterで確定、Escapeで取消。 */
function _elBeginLabelEdit(el, cell, ctx) {
  if (typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return;
  if (el.classList.contains('el-label-editing')) return;
  el.classList.add('el-label-editing');
  const body = el.querySelector('.el-label-text');
  if (!body) { el.classList.remove('el-label-editing'); return; }
  const original = String(cell.text || '');
  const input = document.createElement('textarea');
  input.className = 'el-label-input';
  input.dataset.e2eId = 'entity-layout-label-input';
  input.value = original;
  input.setAttribute('aria-label', '見出しのテキスト');
  body.replaceChildren(input);
  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    // 動的に閲覧専用へ切り替わった間は入力DOMを残す。解除後に確定/取消できるため、
    // blurを契機に下書きを捨てたり、古い権限で保存したりしない。
    if (commit && typeof _elCanMutateGrid === 'function' && !_elCanMutateGrid(ctx.grid, ctx.options)) return;
    finished = true;
    const next = String(input.value || '').trim();
    el.classList.remove('el-label-editing');
    if (commit && next !== original) {
      _elPersistCellPatch(ctx, cell, 'トピックレイアウト: 見出し編集', (target) => { target.text = next; });
    }
    ctx.rerender();
  };
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  });
  requestAnimationFrame(() => { try { input.focus({ preventScroll: true }); input.select(); } catch { /* ignore */ } });
}

/* ドラッグ移動 / リサイズの共通処理。ポインタ差分を zoom とフィットスケールで
   デザイン基準pxへ換算し、スナップとキャンバス境界クランプを掛けて反映する。
   確定（pointerup）時に1回だけ永続化し、取り消し履歴にも1操作として載せる。 */
function _elBeginCellPointerOp(e, el, cell, ctx, canvas, mode) {
  const scale = Number(canvas.dataset.elScale) || 1;
  const zoom = _elZoomFactor();
  const factor = scale * zoom;
  const start = { x: cell.x, y: cell.y, w: cell.w, h: cell.h, clientX: e.clientX, clientY: e.clientY };
  const canvasW = ctx.layout.canvasSize.w;
  const canvasH = ctx.layout.canvasSize.h;
  let latest = { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
  let moved = false;
  el.classList.add('el-dragging');
  try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }

  const onMove = (ev) => {
    const dx = (ev.clientX - start.clientX) / factor;
    const dy = (ev.clientY - start.clientY) / factor;
    if (!moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    moved = true;
    if (mode === 'move') {
      const x = Math.max(0, Math.min(canvasW - start.w, _elSnap(start.x + dx)));
      const y = Math.max(0, Math.min(canvasH - start.h, _elSnap(start.y + dy)));
      latest = { ...latest, x, y };
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    } else {
      const w = Math.max(EL_CELL_MIN_SIZE, Math.min(canvasW - start.x, _elSnap(start.w + dx)));
      const h = Math.max(EL_CELL_MIN_SIZE, Math.min(canvasH - start.y, _elSnap(start.h + dy)));
      latest = { ...latest, w, h };
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    }
  };
  const onUp = (ev) => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.classList.remove('el-dragging');
    try { el.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    if (!moved) return;
    const changed = latest.x !== start.x || latest.y !== start.y || latest.w !== start.w || latest.h !== start.h;
    if (!changed) return;
    const persisted = ctx.persist(
      mode === 'move' ? 'トピックレイアウト: セル移動' : 'トピックレイアウト: セルサイズ変更',
      '',
      (layout) => {
        const target = layout.cells.find(c => c.id === cell.id);
        if (!target) return false;
        target.x = latest.x;
        target.y = latest.y;
        target.w = latest.w;
        target.h = latest.h;
      }
    );
    if (!persisted) {
      el.style.left = start.x + 'px';
      el.style.top = start.y + 'px';
      el.style.width = start.w + 'px';
      el.style.height = start.h + 'px';
      return;
    }
    cell.x = latest.x; cell.y = latest.y; cell.w = latest.w; cell.h = latest.h;
    // サイズ変更は文字の自動フィットとチャートの描画サイズに影響するため再描画で追従させる
    if (mode === 'resize') ctx.rerender();
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

/* --- 編集ツールバー --- */

function _elCloseEditPopups() {
  document.querySelectorAll('.el-edit-popup').forEach(el => {
    if (typeof el._cleanup === 'function') el._cleanup();
    el.remove();
  });
}

function _elAttachPopupCommon(popup, anchorBtn) {
  document.body.appendChild(popup);
  const cleanupFns = [];
  popup._cleanup = () => { cleanupFns.splice(0).forEach(off => off()); };
  const close = () => {
    popup._cleanup();
    popup.remove();
    if (typeof focusMeldexDropdownTrigger === 'function') focusMeldexDropdownTrigger(anchorBtn);
    else { try { anchorBtn?.focus?.(); } catch { /* ignore */ } }
  };
  if (typeof positionPopup === 'function') {
    positionPopup(popup, anchorBtn.getBoundingClientRect(), { gap: 4 });
  } else if (typeof clampPopupToViewport === 'function') {
    const rect = anchorBtn.getBoundingClientRect();
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 4) + 'px';
    clampPopupToViewport(popup);
  }
  setTimeout(() => {
    const onPointerDown = (ev) => {
      if (!popup.contains(ev.target) && ev.target !== anchorBtn && !anchorBtn.contains(ev.target)) close();
    };
    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    cleanupFns.push(() => document.removeEventListener('pointerdown', onPointerDown));
    cleanupFns.push(() => document.removeEventListener('keydown', onKeyDown, true));
  }, 0);
  return close;
}

// 新しいセルの初期位置: 既存セルと重なりにくいよう段々に流し込む
function _elNextCellPosition(layout, w, h) {
  const step = 30;
  const maxX = Math.max(0, layout.canvasSize.w - w);
  const maxY = Math.max(0, layout.canvasSize.h - h);
  const n = layout.cells.length;
  return {
    x: Math.min(maxX, 20 + (n % 8) * step),
    y: Math.min(maxY, 20 + n * step % Math.max(step, maxY)),
  };
}

function _elAddCell(ctx, partialCell, statusLabel) {
  const w = partialCell.w || 220;
  const h = partialCell.h || 90;
  ctx.persist('トピックレイアウト: セル追加', statusLabel || '', (layout) => {
    const pos = _elNextCellPosition(layout, w, h);
    layout.cells.push(_elNormalizeCell({ ...partialCell, ...pos, w, h }, layout.canvasSize.w, layout.canvasSize.h));
  });
  ctx.rerender();
}

// 「列を配置」メニュー: シートの列一覧から選んで field セルを追加する（同じ列の複数配置も可）
function _elShowFieldPickerMenu(anchorBtn, ctx) {
  _elCloseEditPopups();
  const menu = document.createElement('div');
  menu.className = 'gb-context-menu el-edit-popup el-field-picker';
  menu.dataset.e2eId = 'entity-layout-field-picker';
  menu.setAttribute('role', 'menu');
  const props = Object.keys(ctx.data?.properties || {});
  if (props.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'el-field-picker-empty';
    empty.textContent = '配置できる列がありません';
    menu.appendChild(empty);
  }
  props.forEach(propName => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'el-tab-menu-item';
    btn.dataset.e2eId = 'entity-layout-field-pick';
    btn.dataset.propName = propName;
    btn.setAttribute('role', 'menuitem');
    const iconHtml = typeof _elPropIconHtml === 'function' ? _elPropIconHtml(propName, ctx.propTypes, 13) : '';
    btn.innerHTML = iconHtml + '<span></span>';
    btn.querySelector('span').textContent = propName;
    btn.addEventListener('click', () => {
      close();
      _elAddCell(ctx, { type: 'field', prop: propName }, propName);
    });
    menu.appendChild(btn);
  });
  const close = _elAttachPopupCommon(menu, anchorBtn);
}

// キャンバスサイズ設定ポップアップ（デザイン基準サイズを変更する）
function _elShowCanvasSizePopup(anchorBtn, ctx) {
  _elCloseEditPopups();
  const popup = document.createElement('div');
  popup.className = 'gb-context-menu el-edit-popup el-canvas-size-popup';
  popup.dataset.e2eId = 'entity-layout-canvas-size-popup';

  const title = document.createElement('div');
  title.className = 'el-popup-title';
  title.textContent = 'キャンバスサイズ';
  popup.appendChild(title);

  const makeRow = (labelText, value, e2eId) => {
    const row = document.createElement('label');
    row.className = 'el-popup-row';
    const span = document.createElement('span');
    span.textContent = labelText;
    row.appendChild(span);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(EL_CANVAS_MIN);
    input.max = String(EL_CANVAS_MAX);
    input.step = '10';
    input.value = String(value);
    input.dataset.e2eId = e2eId;
    row.appendChild(input);
    popup.appendChild(row);
    return input;
  };
  const wInput = makeRow('幅 (px)', ctx.layout.canvasSize.w, 'entity-layout-canvas-w');
  const hInput = makeRow('高さ (px)', ctx.layout.canvasSize.h, 'entity-layout-canvas-h');

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'gb-btn gb-btn-sm gb-btn-primary primary';
  applyBtn.dataset.e2eId = 'entity-layout-canvas-size-apply';
  applyBtn.textContent = '適用';
  applyBtn.addEventListener('click', () => {
    const w = _elClampNum(wInput.value, EL_CANVAS_MIN, EL_CANVAS_MAX, ctx.layout.canvasSize.w);
    const h = _elClampNum(hInput.value, EL_CANVAS_MIN, EL_CANVAS_MAX, ctx.layout.canvasSize.h);
    close();
    ctx.persist('トピックレイアウト: キャンバスサイズ', w + 'x' + h, (layout) => {
      layout.canvasSize = { w, h };
    });
    ctx.rerender();
  });
  popup.appendChild(applyBtn);

  const close = _elAttachPopupCommon(popup, anchorBtn);
  popup.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyBtn.click(); }
  });
  requestAnimationFrame(() => { try { wInput.focus({ preventScroll: true }); wInput.select(); } catch { /* ignore */ } });
}

/* 編集ツールバー本体。セル種別の追加ボタン群は _elEditToolbarExtraItems（cells側、
   Phase C/D で見出し・画像・チャート等を追加）から拡張できる形にしておく。 */
function _elBuildEditToolbar(ctx) {
  const bar = document.createElement('div');
  bar.className = 'el-edit-toolbar';
  bar.dataset.e2eId = 'entity-layout-edit-toolbar';

  const fieldBtn = document.createElement('button');
  fieldBtn.type = 'button';
  fieldBtn.className = 'gb-btn gb-btn-sm';
  fieldBtn.dataset.e2eId = 'entity-layout-add-field';
  fieldBtn.setAttribute('aria-haspopup', 'menu');
  fieldBtn.innerHTML = (typeof lucide === 'function' ? lucide('plus', 13) : '+') + '<span>列を配置</span>';
  fieldBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _elShowFieldPickerMenu(fieldBtn, ctx);
  });
  bar.appendChild(fieldBtn);

  if (typeof _elEditToolbarExtraItems === 'function') {
    _elEditToolbarExtraItems(ctx).forEach(btn => bar.appendChild(btn));
  }

  const sizeBtn = document.createElement('button');
  sizeBtn.type = 'button';
  sizeBtn.className = 'gb-btn gb-btn-sm';
  sizeBtn.dataset.e2eId = 'entity-layout-canvas-size-btn';
  sizeBtn.setAttribute('aria-haspopup', 'dialog');
  sizeBtn.innerHTML = (typeof lucide === 'function' ? lucide('slidersHorizontal', 13) : '⚙') + '<span>キャンバスサイズ</span>';
  sizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _elShowCanvasSizePopup(sizeBtn, ctx);
  });
  bar.appendChild(sizeBtn);

  return bar;
}
