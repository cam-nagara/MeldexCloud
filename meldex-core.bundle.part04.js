    }
    return type === 'note' || type === 'sticky';
  }

  function _renderNote(annId, data, color) {
    const note = document.createElement('div');
    note.className = 'sa-note'; note.dataset.annId = annId;
    note.style.cssText = `position:absolute;left:${data.x}px;top:${data.y}px;width:${data.width||180}px;min-height:${data.height||100}px;background:${color};color:#333;padding:8px;border-radius:4px;font-size:12px;cursor:move;z-index:12;border:1px solid rgba(0,0,0,0.15);`;
    const textarea = document.createElement('textarea');
    textarea.value = data.text || '';
    textarea.style.cssText = 'width:100%;height:80px;background:transparent;border:none;color:#333;font-size:12px;resize:both;outline:none;';
    note.style.pointerEvents = _ann.active ? 'auto' : 'none';
    _applyStandaloneNoteSize(note, textarea, data);
    textarea.onblur = async () => {
      const previousData = { ...data };
      const previousStyle = {
        width: note.style.width,
        minHeight: note.style.minHeight,
        textareaHeight: textarea.style.height,
      };
      Object.assign(data, _saNotePayload(data, textarea, note));
      try {
        await _saUpdateAnnotation(annId, { data: { ...data } });
      } catch (error) {
        Object.keys(data).forEach(key => { delete data[key]; });
        Object.assign(data, previousData);
        note.style.width = previousStyle.width;
        note.style.minHeight = previousStyle.minHeight;
        textarea.style.height = previousStyle.textareaHeight;
        textarea.value = previousData.text || '';
        _saReportSaveFailure(error);
      }
    };
    note.appendChild(textarea);
    let dx = 0, dy = 0;
    note.addEventListener('pointerdown', (e) => {
      if (_ann.active && _ann.tool === 'eraser') {
        e.preventDefault();
        e.stopPropagation();
        _saDeleteNoteElement(note);
        return;
      }
      if (e.target === textarea) return; e.preventDefault();
      const rect = note.getBoundingClientRect();
      dx = e.clientX - rect.left; dy = e.clientY - rect.top;
      const previous = {
        x: data.x || 0,
        y: data.y || 0,
        text: data.text || '',
        width: data.width,
        height: data.height,
        left: note.style.left,
        top: note.style.top,
        noteWidth: note.style.width,
        noteMinHeight: note.style.minHeight,
        textareaHeight: textarea.style.height,
      };
      const onMove = (e2) => {
        const pt = _toCoords(e2.clientX - dx, e2.clientY - dy);
        note.style.left = pt.x + 'px';
        note.style.top = pt.y + 'px';
      };
      const onUp = async () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        Object.assign(data, _saNotePayload(data, textarea, note), {
          x: parseFloat(note.style.left) || 0,
          y: parseFloat(note.style.top) || 0,
        });
        try {
          await _saUpdateAnnotation(annId, { data: { ...data } });
        } catch (error) {
          data.x = previous.x;
          data.y = previous.y;
          data.text = previous.text;
          data.width = previous.width;
          data.height = previous.height;
          note.style.left = previous.left;
          note.style.top = previous.top;
          note.style.width = previous.noteWidth;
          note.style.minHeight = previous.noteMinHeight;
          textarea.style.height = previous.textareaHeight;
          textarea.value = previous.text;
          _saReportSaveFailure(error);
        }
      };
      document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
    });
    container.appendChild(note);
  }

  async function loadAnnotations(targetPath) {
    const requestSeq = ++_loadAnnotationsSeq;
    const requestedTarget = String(targetPath || '');
    layer.innerHTML = ''; container.querySelectorAll('.sa-note').forEach(n => n.remove());
    if (!requestedTarget) return;
    try {
      const items = await apiFetch('/annotations?target=' + encodeURIComponent(requestedTarget));
      const activeTarget = typeof getTargetPath === 'function' ? String(getTargetPath() || '') : requestedTarget;
      if (requestSeq !== _loadAnnotationsSeq || activeTarget !== requestedTarget) return;
      items.forEach(item => {
        const data = _saParseAnnotationData(item);
        if (!data) return;
        if (_isStandaloneNoteAnnotation(item, data)) _renderNote(item.id, data, item.color);
        else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') return;
        else if (item.type === 'rect' && data?.width != null && data?.height != null) _renderRect(data, item.color, item.opacity, item.id);
        else if (data.points) _renderStroke(item.type, data.points, data.pressures || [], item.color, item.opacity, item.id);
      });
      _syncStandaloneNoteInteractivity();
    } catch (error) {
      if (requestSeq === _loadAnnotationsSeq) _saReportSaveFailure(error, '注釈を読み込めませんでした');
    }
  }

  function toggle(active) {
    if (active === undefined) active = !_ann.active;
    _ann.active = active;
    svg.style.pointerEvents = active ? 'auto' : 'none';
    svg.style.cursor = active ? (_ann.tool === 'eraser' ? 'not-allowed' : _ann.tool === 'sticky' ? 'cell' : 'crosshair') : '';
    svg.style.outline = active ? '2px solid rgba(86,156,214,0.3)' : '';
    hitRect.setAttribute('pointer-events', active ? 'all' : 'none');
    _syncStandaloneNoteInteractivity();
  }
  function setTool(tool) { _ann.tool = tool; if (_ann.active) svg.style.cursor = tool === 'eraser' ? 'not-allowed' : tool === 'sticky' ? 'cell' : 'crosshair'; }
  function setColor(c) { _ann.color = c; }
  function setOpacity(o) {
    const opacity = _saNormalizeOpacity(o, 1);
    _ann.opacity = opacity;
    svg.style.opacity = opacity;
    container.querySelectorAll('.sa-note').forEach(n => { n.style.opacity = opacity; });
  }
  function destroy() { svg.remove(); container.querySelectorAll('.sa-note').forEach(n => n.remove()); }

  return { svg, layer, ann: _ann, toggle, loadAnnotations, setTool, setColor, setOpacity, destroy };
}

const STANDALONE_MARKUP_TOOLBAR_CSS = `
.sa-markup-toolbar {
  position: fixed;
  z-index: 55;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  border-bottom: 1px solid var(--border, #333);
  background: var(--ui-popup-bg, var(--bg2, #252525));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
}
.sa-markup-toolbar .sa-tb-btn,
.sa-markup-toolbar .sa-markup-color-btn,
.sa-markup-toolbar .sa-markup-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  border: 1px solid var(--border, #333);
  border-radius: 4px;
  background: transparent;
  color: var(--fg, #d4d4d4);
  cursor: pointer;
}
.sa-markup-toolbar .sa-tb-btn:hover,
.sa-markup-toolbar .sa-markup-color-btn:hover,
.sa-markup-toolbar .sa-markup-close-btn:hover {
  background: var(--bg3, #2d2d2d);
  border-color: var(--accent, #569cd6);
}
.sa-markup-toolbar .sa-tb-btn.active,
.sa-markup-toolbar .sa-tb-btn[aria-pressed="true"] {
  background: var(--accent, #569cd6);
  border-color: var(--accent, #569cd6);
  color: #fff;
}
.sa-markup-toolbar .sa-tb-btn svg {
  width: 18px;
  height: 18px;
}
.sa-markup-toolbar .sa-markup-close-btn svg {
  width: 14px;
  height: 14px;
}
.sa-markup-color-swatch {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border, #333);
  border-radius: 999px;
  pointer-events: none;
}
.sa-markup-palette {
  position: fixed;
  z-index: 56;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 188px;
  padding: 6px;
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  background: var(--ui-popup-bg, var(--bg2, #252525));
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
.sa-markup-color-dot {
  width: 24px;
  min-width: 24px;
  height: 24px;
  min-height: 24px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 999px;
  cursor: pointer;
}
@media (max-width: 640px) {
  .sa-markup-toolbar {
    left: 8px;
    right: 8px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    transform: none;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    max-width: calc(100vw - 16px);
    padding: 6px;
  }
  .sa-markup-toolbar .sa-tb-btn,
  .sa-markup-toolbar .sa-markup-color-btn,
  .sa-markup-toolbar .sa-markup-close-btn {
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
  }
  .sa-markup-toolbar .sa-tb-btn svg {
    width: 20px;
    height: 20px;
  }
  .sa-markup-toolbar .sa-markup-close-btn svg {
    width: 18px;
    height: 18px;
  }
  .sa-markup-palette {
    width: min(260px, calc(100vw - 16px));
    gap: 6px;
    padding: 8px;
  }
  .sa-markup-color-dot {
    width: 44px;
    min-width: 44px;
    height: 44px;
    min-height: 44px;
  }
}`;

function _ensureStandaloneMarkupToolbarStyles() {
  if (document.getElementById('meldex-standalone-markup-toolbar-styles')) return;
  const style = document.createElement('style');
  style.id = 'meldex-standalone-markup-toolbar-styles';
  style.textContent = STANDALONE_MARKUP_TOOLBAR_CSS;
  document.head.appendChild(style);
}

function createMarkupToolbar(markup, parentEl) {
  _ensureStandaloneMarkupToolbarStyles();
  let tb = parentEl.querySelector('.sa-markup-toolbar');
  if (tb) return tb;
  tb = document.createElement('div');
  tb.className = 'sa-toolbar sa-markup-toolbar';
  tb.dataset.markupToolbar = '1';
  tb.setAttribute('role', 'toolbar');
  tb.setAttribute('aria-label', '注釈ツールバー');
  let palette = null;
  let closePaletteTimer = null;
  let paletteOutsideHandler = null;
  let paletteKeyHandler = null;
  const closePalette = () => {
    if (closePaletteTimer) clearTimeout(closePaletteTimer);
    closePaletteTimer = null;
    if (paletteOutsideHandler) document.removeEventListener('pointerdown', paletteOutsideHandler, true);
    if (paletteKeyHandler) document.removeEventListener('keydown', paletteKeyHandler, true);
    paletteOutsideHandler = null;
    paletteKeyHandler = null;
    palette?.remove();
    palette = null;
    colorBtn?.setAttribute?.('aria-expanded', 'false');
  };
  const updateToolButtons = (selectedBtn) => {
    tb.querySelectorAll('.sa-tb-btn').forEach(b => {
      const active = b === selectedBtn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };
  [{ name:'pen',icon:'pencil',title:'ペン' },{ name:'marker',icon:'highlighter',title:'マーカー' },{ name:'lasso',icon:'lasso',title:'投げ縄' },{ name:'rect',icon:'square',title:'矩形塗り' },{ name:'eraser',icon:'eraser',title:'消しゴム' },{ name:'sticky',icon:'stickyNote',title:'付箋' }].forEach(t => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sa-tb-btn' + (t.name === 'pen' ? ' active' : '');
    btn.dataset.tool = t.name; btn.title = t.title; btn.setAttribute('aria-label', t.title); btn.setAttribute('aria-pressed', t.name === 'pen' ? 'true' : 'false'); btn.innerHTML = lucide(t.icon, 18);
    btn.onclick = () => { markup.setTool(t.name); updateToolButtons(btn); };
    tb.appendChild(btn);
  });
  const colorBtn = document.createElement('button');
  colorBtn.type = 'button';
  colorBtn.className = 'sa-markup-color-btn';
  colorBtn.title = '色';
  colorBtn.setAttribute('aria-label', '注釈色');
  colorBtn.setAttribute('aria-haspopup', 'dialog');
  colorBtn.setAttribute('aria-expanded', 'false');
  const colorSwatch = document.createElement('span');
  colorSwatch.className = 'sa-markup-color-swatch';
  colorSwatch.style.background = markup.ann.color || PALETTE_COLORS[0];
  colorBtn.appendChild(colorSwatch);
  colorBtn.onclick = () => {
    if (palette) { closePalette(); return; }
    palette = document.createElement('div');
    palette.className = 'sa-palette sa-markup-palette';
    palette.setAttribute('role', 'dialog');
    palette.setAttribute('aria-label', '注釈色');
    PALETTE_COLORS.forEach(c => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'sa-markup-color-dot';
      dot.title = c;
      dot.setAttribute('aria-label', `注釈色 ${c}`);
      dot.style.background = c;
      dot.onclick = () => { markup.setColor(c); colorSwatch.style.background = c; closePalette(); };
      palette.appendChild(dot);
    });
    document.body.appendChild(palette);
    colorBtn.setAttribute('aria-expanded', 'true');
    positionPopup(palette, colorBtn.getBoundingClientRect(), { prefer: 'right', gap: 8, avoidRect: tb.getBoundingClientRect() });
    paletteKeyHandler = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); closePalette(); colorBtn.focus(); } };
    paletteOutsideHandler = (ev) => { if (!palette?.contains(ev.target) && !colorBtn.contains(ev.target)) closePalette(); };
    closePaletteTimer = setTimeout(() => {
      document.addEventListener('pointerdown', paletteOutsideHandler, true);
      document.addEventListener('keydown', paletteKeyHandler, true);
    }, 0);
  };
  tb.appendChild(colorBtn);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sa-markup-close-btn';
  closeBtn.innerHTML = lucide('x', 14); closeBtn.title = '閉じる'; closeBtn.setAttribute('aria-label', '閉じる');
  closeBtn.onclick = () => { closePalette(); markup.toggle(false); tb.style.display = 'none'; const trigger = document.getElementById('btn-markup'); trigger?.classList.remove('active'); trigger?.setAttribute?.('aria-pressed', 'false'); };
  tb.appendChild(closeBtn);
  parentEl.appendChild(tb);
  return tb;
}

// === ポップアップ位置制御（共通ヘルパー） ===
// pywebview/WebView2環境ではwindow.innerWidth/Heightが不正確な場合があるため
// document.documentElement.clientWidth/Heightを使用する
function _popupCssRect(rect, z) {
  if (!rect) return null;
  const left = Number(rect.left);
  const right = Number(rect.right);
  const top = Number(rect.top);
  const bottom = Number(rect.bottom);
  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  return { left: left / z, right: right / z, top: top / z, bottom: bottom / z };
}

function _popupClampValue(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function _popupRectsOverlap(a, b, gap = 0) {
  if (!a || !b) return false;
  return !(
    a.right <= b.left - gap
    || a.left >= b.right + gap
    || a.bottom <= b.top - gap
    || a.top >= b.bottom + gap
  );
}

function _popupCandidateRect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height };
}

function _fitPopupAroundAvoidRect(baseLeft, baseTop, pw, ph, vw, vh, gap, avoid) {
  if (!avoid) return { left: baseLeft, top: baseTop };
  const maxLeft = vw - pw - gap;
  const maxTop = vh - ph - gap;
  const xNearAnchor = _popupClampValue(baseLeft, gap, maxLeft);
  const yNearAnchor = _popupClampValue(baseTop, gap, maxTop);
  const candidates = [
    { left: xNearAnchor, top: avoid.bottom + gap, side: 'below', space: vh - avoid.bottom - gap },
    { left: xNearAnchor, top: avoid.top - ph - gap, side: 'above', space: avoid.top - gap },
    { left: avoid.right + gap, top: yNearAnchor, side: 'right', space: vw - avoid.right - gap },
    { left: avoid.left - pw - gap, top: yNearAnchor, side: 'left', space: avoid.left - gap },
  ];

  for (const candidate of candidates) {
    const left = _popupClampValue(candidate.left, gap, maxLeft);
    const top = _popupClampValue(candidate.top, gap, maxTop);
    const rect = _popupCandidateRect(left, top, pw, ph);
    const fitsViewport = left >= gap && top >= gap && rect.right <= vw - gap && rect.bottom <= vh - gap;
    if (fitsViewport && !_popupRectsOverlap(rect, avoid, 0)) return { left, top };
  }

  const vertical = candidates
    .filter(c => c.side === 'below' || c.side === 'above')
    .filter(c => c.space >= 72)
    .sort((a, b) => b.space - a.space)[0];
  if (vertical) {
    const left = _popupClampValue(vertical.left, gap, maxLeft);
    const top = vertical.side === 'above'
      ? Math.max(gap, avoid.top - Math.min(ph, vertical.space) - gap)
      : avoid.bottom + gap;
    return { left, top, maxHeight: Math.max(72, vertical.space) };
  }

  const horizontal = candidates
    .filter(c => c.side === 'right' || c.side === 'left')
    .filter(c => c.space >= 72)
    .sort((a, b) => b.space - a.space)[0];
  if (horizontal) {
    const left = horizontal.side === 'left'
      ? Math.max(gap, avoid.left - Math.min(pw, horizontal.space) - gap)
      : avoid.right + gap;
    const top = _popupClampValue(horizontal.top, gap, maxTop);
    return { left, top, maxWidth: Math.max(72, horizontal.space) };
  }

  return {
    left: _popupClampValue(baseLeft, gap, maxLeft),
    top: _popupClampValue(baseTop, gap, maxTop),
  };
}

function positionPopup(popup, anchorRect, options = {}) {
  const z = _getZoom();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const gap = options.gap ?? 4;
  const preferDirection = options.prefer || 'below'; // 'below' | 'right'
  // anchorRectはgetBoundingClientRect()由来（viewport pixels）なのでCSS座標に変換
  const ar = _popupCssRect(anchorRect, z);
  const avoid = _popupCssRect(options.avoidRect, z);
  if (!ar) return;
  // 非表示でDOMに追加して測定
  popup.style.maxHeight = '';
  popup.style.maxWidth = '';
  popup.style.overflowY = '';
  popup.style.overflowX = '';
  popup.style.visibility = 'hidden';
  if (!popup.parentNode) document.body.appendChild(popup);
  const pw = popup.offsetWidth;
  const ph = popup.offsetHeight;
  let left, top;
  if (preferDirection === 'right') {
    // 右に表示、収まらなければ左
    left = ar.right + gap;
    if (left + pw > vw) left = Math.max(gap, ar.left - pw - gap);
    if (left + pw > vw) left = Math.max(gap, vw - pw - gap);
    top = ar.top;
  } else {
    // 下に表示
    left = ar.left;
    top = ar.bottom + gap;
  }
  // 右端チェック
  if (left + pw > vw) left = Math.max(gap, vw - pw - gap);
  // 下端チェック
  const spaceBelow = vh - ar.bottom - gap;
  const spaceAbove = ar.top - gap;
  if (top + ph > vh) {
    if (ph <= spaceAbove) {
      top = ar.top - ph - gap;
    } else if (spaceBelow >= spaceAbove) {
      top = ar.bottom + gap;
      popup.style.maxHeight = Math.max(120, spaceBelow) + 'px';
      popup.style.overflowY = 'auto';
    } else {
      top = gap;
      popup.style.maxHeight = Math.max(120, spaceAbove) + 'px';
      popup.style.overflowY = 'auto';
    }
  }
  // 上端チェック
  if (top < gap) top = gap;
  if (avoid) {
    const fitted = _fitPopupAroundAvoidRect(left, top, pw, ph, vw, vh, gap, avoid);
    left = fitted.left;
    top = fitted.top;
    if (fitted.maxHeight != null) {
      popup.style.maxHeight = fitted.maxHeight + 'px';
      popup.style.overflowY = 'auto';
    }
    if (fitted.maxWidth != null) {
      popup.style.maxWidth = fitted.maxWidth + 'px';
      popup.style.overflowX = 'auto';
    }
  }
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.visibility = 'visible';
  // 最終安全策: clampPopupToViewportで確実にビューポート内に収める
  clampPopupToViewport(popup);
}

// ============================================================
// 長押し検知ヘルパー: iPad など contextmenu が安定しない環境向けに、
// タッチ/ペン入力の長押しで handler を発火させる。マウスは触らない
// （従来の contextmenu で右クリックメニューがそのまま使える）。
//
// 使い方:
//   addLongPressHandler(el, (ev) => { myMenuFn(ev, ...); });
//   ev は clientX/Y/target/currentTarget/preventDefault/stopPropagation を
//   持つ合成オブジェクト。既存の contextmenu ハンドラにそのまま渡せる。
// ============================================================
function addLongPressHandler(el, handler, opts = {}) {
  const DURATION = opts.duration ?? opts.delayMs ?? 500;
  const MOVE_THRESHOLD = opts.moveThreshold ?? opts.moveTolerance ?? 10;
  let timer = null;
  let startX = 0, startY = 0;
  let fired = false;
  let touchStartEv = null;

  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  el.addEventListener('pointerdown', (e) => {
    // タッチと Apple Pencil 等のペン入力のみ対象。マウスは無視
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    if (e.button !== 0 && e.button !== undefined && e.button !== -1) return;
    cancel();
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    touchStartEv = e;
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      handler({
        clientX: startX,
        clientY: startY,
        target: touchStartEv?.target || el,
        currentTarget: el,
        pointerType: touchStartEv?.pointerType || 'touch',
        preventDefault: () => {},
        stopPropagation: () => {},
      });
    }, DURATION);
  });

  el.addEventListener('pointermove', (e) => {
    if (!timer) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (dx * dx + dy * dy > MOVE_THRESHOLD * MOVE_THRESHOLD) cancel();
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => {
    el.addEventListener(ev, cancel);
  });

  // 長押し発火後の click / contextmenu は同ノードの他リスナーも含めて抑止
  // （stopPropagation だと同ノードの bubble リスナーが走る可能性があるため
  //  stopImmediatePropagation を使う）
  el.addEventListener('click', (e) => {
    if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
  }, true);
  el.addEventListener('contextmenu', (e) => {
    if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; }
  }, true);
}

function _isNativeContextMenuSurface(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('#html-view, #html-iframe');
}

// Meldex 全域でブラウザ標準右クリックメニューを抑止（input / textarea / HTMLビューワー は除外）。
// 旧 gb-editor.part04.js のルビハンドラ冒頭にあった同処理をここへ移管（capture phase）。
document.addEventListener('contextmenu', (e) => {
  if (_isNativeContextMenuSurface(e.target)) return;
  if (!e.target.matches('input, textarea')) e.preventDefault();
}, true);

// ============================================================
// 確認ダイアログ（モーダル）
// ============================================================
let _showConfirmDialogSeq = 0;
function showConfirmDialog(message, onOk, onCancel) {
  const focusReturnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialogId = 'show-confirm-dialog-' + (++_showConfirmDialogSeq);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.e2eId = 'show-confirm-dialog-overlay';
  overlay.dataset.confirmDialog = '1';

  const modal = document.createElement('div');
  modal.className = 'modal show-confirm-dialog';
  modal.dataset.e2eId = 'show-confirm-dialog';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', '確認');
  modal.setAttribute('aria-describedby', dialogId + '-body');
  modal.tabIndex = -1;

  const body = document.createElement('div');
  body.id = dialogId + '-body';
  body.className = 'modal-body show-confirm-dialog-body';
  body.dataset.e2eId = 'show-confirm-dialog-body';
  body.textContent = String(message ?? '');

  const buttonRow = document.createElement('div');
  buttonRow.className = 'btn-row show-confirm-dialog-actions';
  buttonRow.dataset.e2eId = 'show-confirm-dialog-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'cancel-btn';
  cancelBtn.dataset.e2eId = 'show-confirm-dialog-cancel';
  cancelBtn.textContent = 'キャンセル';

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'primary ok-btn';
  okBtn.dataset.e2eId = 'show-confirm-dialog-ok';
  okBtn.textContent = 'OK';

  buttonRow.append(cancelBtn, okBtn);
  modal.append(body, buttonRow);
  overlay.appendChild(modal);

  let closed = false;
  const restoreFocus = () => {
    if (focusReturnTarget?.isConnected && typeof focusReturnTarget.focus === 'function') {
      try { focusReturnTarget.focus({ preventScroll: true }); } catch (_) { focusReturnTarget.focus(); }
    }
  };
  const queueFocusRestore = () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (!active || !active.isConnected || active === document.body || active === document.documentElement || active === focusReturnTarget) {
        restoreFocus();
      }
    }, 0);
  };
  const close = (confirmed) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    restoreFocus();
    queueFocusRestore();
    if (confirmed) {
      if (onOk) onOk();
    } else if (onCancel) {
      onCancel();
    }
  };
  function onKeyDown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close(false);
  }

  okBtn.addEventListener('click', () => close(true));
  cancelBtn.addEventListener('click', () => close(false));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);
  window.GBModalShell?.enhanceOverlay?.(overlay);
  setTimeout(() => {
    try { okBtn.focus({ preventScroll: true }); } catch (_) { okBtn.focus(); }
  }, 0);
  return overlay;
}

// ============================================================
// contentEditable外クリック時の即時blur（2回クリック問題の回避）
// ============================================================
// WebView2/Chromiumでは、contentEditable要素にフォーカスがある状態で
// その外をクリックすると、最初のクリックがフォーカス解除に消費され、
// ターゲットのクリックハンドラが動作しない。
// capture phaseでblurを先に実行することで、1回のクリックで操作可能にする。
function _focusedContentEditableHost(active = document.activeElement) {
  if (!active || active === document.body || active === document.documentElement) return null;
  if (active.contentEditable === 'true' || active.contentEditable === 'plaintext-only' || active.isContentEditable) {
    return active.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable]:not([contenteditable="false"])') || active;
  }
  return null;
}

document.addEventListener('pointerdown', (e) => {
  const focused = _focusedContentEditableHost();
  if (focused && !focused.contains(e.target)) focused.blur();
}, true);

// Export for ES module usage (optional)
if (typeof window !== 'undefined') {
  window.CF = {
    API_BASE, apiFetch, apiPost, apiPut,
    esc, formatFileSize, showStatus, getCssVar, rgbToHex,
    LUCIDE, lucide, fileTypeIcon, replaceIcons,
    FILE_TYPE_LABELS, NATIVE_TYPES, PALETTE_COLORS, PALETTE_BG_COLORS,
    inheritParentTheme, loadThemeFromServer,
    positionPopup,
    initIframeMarkup, initStandaloneMarkup, createMarkupToolbar,
  };
}

function enableCheckboxDragToggle(container, scopeSelector) {
  if (!container || container._cbDragToggleInstalled) return;
  container._cbDragToggleInstalled = true;
  container.addEventListener('pointerdown', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb || cb.disabled) return;
    if (scopeSelector && !cb.closest(scopeSelector)) return;
    const newState = !cb.checked;
    cb.checked = newState;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    container._cbDragState = { checked: newState };
    e.preventDefault();
    // pointerdown で手動トグル済みのため、同じチェックボックスへ届く後続の
    // ネイティブ click（既定のトグル動作）を1回だけ打ち消す。
    // これが無いと「pointerdownでON→clickでOFF」と往復し、クリックで切り替わらなくなる
    const suppressClick = (clickEv) => {
      // チェックボックス本体だけでなく、包んでいる label 経由の activation も打ち消す
      // （チェックボックスで押してラベル上で離した場合の二重トグル防止）
      const label = cb.closest('label');
      if (clickEv.target !== cb && !(label && label.contains(clickEv.target))) return;
      clickEv.preventDefault();
      clickEv.stopImmediatePropagation();
    };
    document.addEventListener('click', suppressClick, true);
    const onUp = () => {
      delete container._cbDragState;
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      // click は pointerup の後・同一タスク内で配送されるため、打ち消しは次のタスクで解除する
      setTimeout(() => document.removeEventListener('click', suppressClick, true), 0);
    };
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  });
  container.addEventListener('pointerover', (e) => {
    if (!container._cbDragState) return;
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb || cb.disabled) return;
    if (scopeSelector && !cb.closest(scopeSelector)) return;
    if (cb.checked === container._cbDragState.checked) return;
    cb.checked = container._cbDragState.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
document.addEventListener('DOMContentLoaded', () => {
  enableCheckboxDragToggle(document.body, '.modal-overlay');
}, { once: true });
