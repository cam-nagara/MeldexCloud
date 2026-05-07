/* meldex-core.part03.js */
        const avgP = pressures.reduce((a, b) => a + b, 0) / pressures.length;
        el.setAttribute('stroke-width', Math.max(1, avgP * 8));
      } else {
        el.setAttribute('stroke-width', isPen ? '3' : '12');
      }
      el.setAttribute('stroke-opacity', type === 'marker' ? '0.5' : String(opacity));
      el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    }
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    return el;
  }
  function _saRectData(pts) {
    const a = pts?.[0] || [0, 0], b = pts?.[pts.length - 1] || a;
    const x1 = Number(a[0]) || 0, y1 = Number(a[1]) || 0, x2 = Number(b[0]) || 0, y2 = Number(b[1]) || 0;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }
  function _saApplyRect(el, data, color, opacity, preview) {
    el.setAttribute('x', Number(data?.x) || 0); el.setAttribute('y', Number(data?.y) || 0);
    el.setAttribute('width', Math.max(1, Number(data?.width) || 0)); el.setAttribute('height', Math.max(1, Number(data?.height) || 0));
    el.setAttribute('fill', color); el.setAttribute('fill-opacity', String((Number(opacity) || 1) * (preview ? 0.2 : 0.4)));
    el.setAttribute('stroke', color); el.setAttribute('stroke-width', '1'); el.setAttribute('stroke-opacity', String(Number(opacity) || 1));
    if (preview) el.setAttribute('stroke-dasharray', '4,4'); else el.removeAttribute('stroke-dasharray');
    return el;
  }
  function _renderRect(data, color, opacity, annId) {
    const el = _saApplyRect(document.createElementNS(_svgNS, 'rect'), data, color, opacity, false);
    if (annId) el.dataset.annId = annId;
    layer.appendChild(el);
    return el;
  }

  svg.addEventListener('pointerdown', async (e) => {
    if (!_ann.active) return;
    const pt = _toCoords(e.clientX, e.clientY);
    if (_ann.tool === 'sticky') {
      try {
        const res = await apiPost('/annotations', { target_path: getTargetPath(), type: 'comment', shape: 'sticky', data: { x: pt.x, y: pt.y, width: 180, height: 100, text: '' }, color: _ann.color, opacity: _ann.opacity, user: _getUser() });
        _renderNote(res.id, { x: pt.x, y: pt.y, width: 180, height: 100, text: '' }, _ann.color);
      } catch {}
      return;
    }
    if (_ann.tool === 'eraser') {
      const els = Array.from(layer.querySelectorAll('path, polygon, rect')).reverse();
      for (const el of els) {
        if (el.classList.contains('ann-preview')) continue;
        const bbox = el.getBBox();
        if (pt.x >= bbox.x - 10 && pt.x <= bbox.x + bbox.width + 10 && pt.y >= bbox.y - 10 && pt.y <= bbox.y + bbox.height + 10) {
          if (el.dataset.annId) fetch(API_BASE + '/annotations/' + el.dataset.annId, { method: 'DELETE' }).catch(() => {});
          el.remove(); break;
        }
      }
      for (const n of container.querySelectorAll('.sa-note')) {
        const r = n.getBoundingClientRect(); const cr = container.getBoundingClientRect();
        const nx = r.left - cr.left, ny = r.top - cr.top;
        if (pt.x >= nx - 5 && pt.x <= nx + r.width + 5 && pt.y >= ny - 5 && pt.y <= ny + r.height + 5) {
          if (n.dataset.annId) fetch(API_BASE + '/annotations/' + n.dataset.annId, { method: 'DELETE' }).catch(() => {});
          n.remove(); break;
        }
      }
      return;
    }
    _ann.drawing = true;
    _ann.path = [[pt.x, pt.y]]; _ann.pressures = [e.pressure || 0.5];
    svg.setPointerCapture(e.pointerId);
  });

  svg.addEventListener('pointermove', (e) => {
    if (!_ann.drawing) return;
    const pt = _toCoords(e.clientX, e.clientY);
    _ann.path.push([pt.x, pt.y]); _ann.pressures.push(e.pressure || 0.5);
    let preview = layer.querySelector('.ann-preview');
    const previewTag = _ann.tool === 'lasso' ? 'polygon' : (_ann.tool === 'rect' ? 'rect' : 'path');
    if (!preview || preview.tagName.toLowerCase() !== previewTag) { preview?.remove(); preview = document.createElementNS(_svgNS, previewTag); preview.classList.add('ann-preview'); layer.appendChild(preview); }
    if (_ann.tool === 'rect') {
      _saApplyRect(preview, _saRectData(_ann.path), _ann.color, _ann.opacity, true);
    } else if (_ann.tool === 'lasso') {
      preview.setAttribute('points', _ann.path.map(p => p.join(',')).join(' '));
      preview.setAttribute('fill', _ann.color); preview.setAttribute('fill-opacity', '0.2');
      preview.setAttribute('stroke', _ann.color); preview.setAttribute('stroke-width', '1'); preview.setAttribute('stroke-dasharray', '4,4');
    } else {
      preview.setAttribute('d', _pathD(_ann.path)); preview.setAttribute('fill', 'none'); preview.setAttribute('stroke', _ann.color);
      preview.setAttribute('stroke-width', _ann.tool === 'pen' ? '3' : '12');
      preview.setAttribute('stroke-opacity', _ann.tool === 'marker' ? '0.5' : String(_ann.opacity)); preview.setAttribute('stroke-linecap', 'round');
    }
  });

  svg.addEventListener('pointerup', async () => {
    if (!_ann.drawing) return;
    _ann.drawing = false;
    layer.querySelector('.ann-preview')?.remove();
    if (_ann.path.length < 2) return;
    const type = _ann.tool === 'rect' ? 'rect' : (_ann.tool === 'lasso' ? 'lasso' : (_ann.tool === 'marker' ? 'marker' : 'stroke'));
    const data = type === 'rect' ? _saRectData(_ann.path) : { points: _ann.path, pressures: _ann.pressures };
    try {
      const res = await apiPost('/annotations', { target_path: getTargetPath(), type, data, color: _ann.color, opacity: _ann.opacity, user: _getUser() });
      if (type === 'rect') _renderRect(data, _ann.color, _ann.opacity, res.id);
      else _renderStroke(type, _ann.path, _ann.pressures, _ann.color, _ann.opacity, res.id);
    } catch {}
    _ann.path = []; _ann.pressures = [];
  });

  function _isStandaloneNoteAnnotation(item, data) {
    if (!item || data?.deleted) return false;
    const type = String(item.type || '');
    const shape = String(item.shape || data?.shape || '');
    const hasPosition = data && (data.x != null || data.y != null || data.width != null || data.height != null);
    if (type === 'comment') {
      return shape === 'sticky' || data?.noteType === 'sticky' || hasPosition;
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
    textarea.onblur = () => {
      data.text = textarea.value;
      fetch(API_BASE + '/annotations/' + annId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...data } }),
      }).catch(() => {});
    };
    note.appendChild(textarea);
    let dx = 0, dy = 0;
    note.addEventListener('pointerdown', (e) => {
      if (e.target === textarea) return; e.preventDefault();
      const rect = note.getBoundingClientRect();
      dx = e.clientX - rect.left; dy = e.clientY - rect.top;
      const onMove = (e2) => {
        const pt = _toCoords(e2.clientX - dx, e2.clientY - dy);
        note.style.left = pt.x + 'px';
        note.style.top = pt.y + 'px';
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        data.x = parseFloat(note.style.left) || 0;
        data.y = parseFloat(note.style.top) || 0;
        data.text = textarea.value;
        fetch(API_BASE + '/annotations/' + annId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { ...data } }),
        }).catch(() => {});
      };
      document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
    });
    container.appendChild(note);
  }

  async function loadAnnotations(targetPath) {
    layer.innerHTML = ''; container.querySelectorAll('.sa-note').forEach(n => n.remove());
    if (!targetPath) return;
    try {
      const items = await apiFetch('/annotations?target=' + encodeURIComponent(targetPath));
      items.forEach(item => {
        const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data;
        if (_isStandaloneNoteAnnotation(item, data)) _renderNote(item.id, data, item.color);
        else if (item.type === 'comment' || item.type === 'note' || item.type === 'sticky') return;
        else if (item.type === 'rect' && data?.width != null && data?.height != null) _renderRect(data, item.color, item.opacity, item.id);
        else if (data.points) _renderStroke(item.type, data.points, data.pressures || [], item.color, item.opacity, item.id);
      });
    } catch {}
  }

  function toggle(active) {
    if (active === undefined) active = !_ann.active;
    _ann.active = active;
    svg.style.pointerEvents = active ? 'auto' : 'none';
    svg.style.cursor = active ? (_ann.tool === 'eraser' ? 'not-allowed' : _ann.tool === 'sticky' ? 'cell' : 'crosshair') : '';
    svg.style.outline = active ? '2px solid rgba(86,156,214,0.3)' : '';
    hitRect.setAttribute('pointer-events', active ? 'all' : 'none');
    container.querySelectorAll('.sa-note').forEach(n => { n.style.pointerEvents = active ? 'auto' : 'none'; });
  }
  function setTool(tool) { _ann.tool = tool; if (_ann.active) svg.style.cursor = tool === 'eraser' ? 'not-allowed' : tool === 'sticky' ? 'cell' : 'crosshair'; }
  function setColor(c) { _ann.color = c; }
  function setOpacity(o) { _ann.opacity = o; svg.style.opacity = o; container.querySelectorAll('.sa-note').forEach(n => { n.style.opacity = o; }); }
  function destroy() { svg.remove(); container.querySelectorAll('.sa-note').forEach(n => n.remove()); }

  return { svg, layer, ann: _ann, toggle, loadAnnotations, setTool, setColor, setOpacity, destroy };
}

function createMarkupToolbar(markup, parentEl) {
  let tb = parentEl.querySelector('.sa-toolbar');
  if (tb) return tb;
  tb = document.createElement('div');
  tb.className = 'sa-toolbar';
  tb.style.cssText = 'position:fixed;z-index:55;background:var(--ui-popup-bg, var(--bg2,#252525));border:1px solid var(--border,#333);border-radius:8px;padding:4px 8px;display:flex;gap:4px;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.4);bottom:60px;left:50%;transform:translateX(-50%);';
  [{ name:'pen',icon:'pencil',title:'ペン' },{ name:'marker',icon:'highlighter',title:'マーカー' },{ name:'lasso',icon:'lasso',title:'投げ縄' },{ name:'rect',icon:'square',title:'矩形塗り' },{ name:'eraser',icon:'eraser',title:'消しゴム' },{ name:'sticky',icon:'stickyNote',title:'付箋' }].forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'sa-tb-btn' + (t.name === 'pen' ? ' active' : '');
    btn.dataset.tool = t.name; btn.title = t.title; btn.innerHTML = lucide(t.icon, 18);
    btn.style.cssText = 'background:var(--bg3,#2d2d2d);border:1px solid var(--border,#333);border-radius:4px;cursor:pointer;padding:4px 6px;color:var(--fg,#d4d4d4);display:flex;align-items:center;';
    btn.onclick = () => { markup.setTool(t.name); tb.querySelectorAll('.sa-tb-btn').forEach(b => { b.style.background = b === btn ? 'var(--accent,#569cd6)' : 'var(--bg3,#2d2d2d)'; b.style.color = b === btn ? '#fff' : 'var(--fg,#d4d4d4)'; }); };
    tb.appendChild(btn);
  });
  const colorBtn = document.createElement('div');
  colorBtn.style.cssText = 'width:22px;height:22px;border-radius:50%;border:2px solid var(--border,#333);cursor:pointer;background:' + (markup.ann.color || PALETTE_COLORS[0]) + ';';
  colorBtn.title = '色';
  colorBtn.onclick = () => {
    let palette = tb.querySelector('.sa-palette');
    if (palette) { palette.remove(); return; }
    palette = document.createElement('div'); palette.className = 'sa-palette';
    palette.style.cssText = 'position:absolute;bottom:44px;left:0;background:var(--bg2,#252525);border:1px solid var(--border,#333);border-radius:6px;padding:6px;display:flex;flex-wrap:wrap;gap:3px;width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.4);';
    PALETTE_COLORS.forEach(c => { const dot = document.createElement('div'); dot.style.cssText = 'width:18px;height:18px;border-radius:50%;cursor:pointer;background:' + c + ';border:1px solid rgba(255,255,255,0.15);'; dot.onclick = () => { markup.setColor(c); colorBtn.style.background = c; palette.remove(); }; palette.appendChild(dot); });
    tb.appendChild(palette);
  };
  tb.appendChild(colorBtn);
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = lucide('x', 14); closeBtn.title = '閉じる';
  closeBtn.style.cssText = 'background:none;border:none;color:var(--fg2,#969696);cursor:pointer;font-size:14px;padding:2px 4px;';
  closeBtn.onclick = () => { markup.toggle(false); tb.style.display = 'none'; document.getElementById('btn-markup')?.classList.remove('active'); };
  tb.appendChild(closeBtn);
  parentEl.appendChild(tb);
  return tb;
}

// === ポップアップ位置制御（共通ヘルパー） ===
// pywebview/WebView2環境ではwindow.innerWidth/Heightが不正確な場合があるため
// document.documentElement.clientWidth/Heightを使用する
function positionPopup(popup, anchorRect, options = {}) {
  const z = _getZoom();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const gap = options.gap ?? 4;
  const preferDirection = options.prefer || 'below'; // 'below' | 'right'
  // anchorRectはgetBoundingClientRect()由来（viewport pixels）なのでCSS座標に変換
  const ar = {
    left: anchorRect.left / z, right: anchorRect.right / z,
    top: anchorRect.top / z, bottom: anchorRect.bottom / z,
  };
  // 非表示でDOMに追加して測定
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
  const DURATION = opts.duration ?? 500;
  const MOVE_THRESHOLD = opts.moveThreshold ?? 10;
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
function showConfirmDialog(message, onOk, onCancel) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" style="min-width:320px;max-width:480px;">
    <div class="modal-body" style="padding:16px 20px;font-size:13px;white-space:pre-wrap;color:var(--fg);">${typeof esc === 'function' ? esc(message) : message}</div>
    <div class="btn-row" style="display:flex;gap:8px;justify-content:flex-end;padding:8px 16px 16px;">
      <button type="button" class="cancel-btn">キャンセル</button>
      <button type="button" class="primary ok-btn">OK</button>
    </div>
  </div>`;
  overlay.querySelector('.ok-btn').addEventListener('click', () => { overlay.remove(); if (onOk) onOk(); });
  overlay.querySelector('.cancel-btn').addEventListener('click', () => { overlay.remove(); if (onCancel) onCancel(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); if (onCancel) onCancel(); } });
  document.body.appendChild(overlay);
  overlay.querySelector('.ok-btn').focus();
}

// ============================================================
// contentEditable外クリック時の即時blur（2回クリック問題の回避）
// ============================================================
// WebView2/Chromiumでは、contentEditable要素にフォーカスがある状態で
// その外をクリックすると、最初のクリックがフォーカス解除に消費され、
// ターゲットのクリックハンドラが動作しない。
// capture phaseでblurを先に実行することで、1回のクリックで操作可能にする。
document.addEventListener('pointerdown', (e) => {
  const focused = document.activeElement;
  if (focused && focused.contentEditable === 'true' && !focused.contains(e.target)) {
    focused.blur();
  }
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
