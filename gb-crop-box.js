/* gb-crop-box.js — 範囲の切り抜き（トリミング）枠の共通部品（UI共通ルール 4.0「範囲を切り抜く枠」）。
 *
 * 対象の領域（画面上の矩形）の上に、大きさを変えられる枠を出す。範囲は対象の幅・高さに対する
 * 割合 [左, 上, 右, 下]（0〜1）で受け渡す。保存は呼び出し側が持つ。
 * - 枠の中のドラッグで移動、辺と四隅の8つのつまみで大きさを変える、枠の外のドラッグで描き直す
 * - 矢印キーで移動（Shift で大きく）、Alt＋矢印キーで右辺・下辺を動かして大きさを変える
 * - Enter で最初の主ボタン、Esc で取り消し。開いている間は下の画面の拡大・パンを受け付けない
 * 見た目は gb-crop-box.css（共通トークン --ui-crop-box-*）。
 */
(function () {
  'use strict';
  const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = v => Math.round(v * 10000) / 10000;

  function open(options = {}) {
    const minSize = Number(options.minSize) > 0 ? Number(options.minSize) : 0.02;
    let box = normalize(options.box || [0, 0, 1, 1]);
    let closed = false;
    const overlay = document.createElement('div');
    overlay.className = 'gb-crop-box-overlay';
    overlay.tabIndex = -1;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', options.label || 'トリミングの範囲');
    const page = document.createElement('div');
    page.className = 'gb-crop-box-page';
    const rect = document.createElement('div');
    rect.className = 'gb-crop-box-rect';
    rect.tabIndex = 0;
    rect.setAttribute('role', 'group');
    rect.setAttribute('aria-label', (options.label || 'トリミングの範囲') + '（矢印キーで移動、Alt＋矢印キーで大きさを変更、Enterで確定、Escで取り消し）');
    EDGES.forEach(edge => {
      const handle = document.createElement('span');
      handle.className = 'gb-crop-box-handle';
      handle.dataset.edge = edge;
      rect.appendChild(handle);
    });
    const bar = document.createElement('div');
    bar.className = 'gb-crop-box-bar';
    if (options.title) {
      const title = document.createElement('span');
      title.className = 'gb-crop-box-title';
      title.textContent = options.title;
      bar.appendChild(title);
    }
    if (options.extra instanceof Element) bar.appendChild(options.extra);
    const buttons = new Map();
    (options.actions || []).forEach(action => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gb-btn' + (action.primary ? ' gb-btn-primary' : '');
      button.dataset.cropAction = action.id;
      button.textContent = action.label;
      if (action.title) button.title = action.title;
      button.addEventListener('click', () => { void run(action.id); });
      buttons.set(action.id, button);
      bar.appendChild(button);
    });
    overlay.append(page, rect, bar);
    (options.host || document.body).appendChild(overlay);

    function normalize(value) {
      const [l, t, r, b] = (Array.isArray(value) ? value : [0, 0, 1, 1]).map(Number);
      const left = clamp(Math.min(l, r), 0, 1), right = clamp(Math.max(l, r), 0, 1);
      const top = clamp(Math.min(t, b), 0, 1), bottom = clamp(Math.max(t, b), 0, 1);
      return [left, top, Math.max(right, Math.min(1, left + minSize)), Math.max(bottom, Math.min(1, top + minSize))];
    }
    function area() {
      const r = typeof options.target === 'function' ? options.target() : options.target?.getBoundingClientRect?.();
      return r && r.width > 0 && r.height > 0 ? r : null;
    }
    function layout() {
      if (closed) return;
      const a = area();
      if (!a) { rect.hidden = true; page.hidden = true; return; }
      const host = overlay.getBoundingClientRect();
      rect.hidden = false; page.hidden = false;
      Object.assign(page.style, { left: (a.left - host.left) + 'px', top: (a.top - host.top) + 'px', width: a.width + 'px', height: a.height + 'px' });
      Object.assign(rect.style, {
        left: (a.left - host.left + box[0] * a.width) + 'px', top: (a.top - host.top + box[1] * a.height) + 'px',
        width: ((box[2] - box[0]) * a.width) + 'px', height: ((box[3] - box[1]) * a.height) + 'px',
      });
      rect.dataset.box = box.map(round).join(',');
      options.onChange?.(getBox());
    }
    function getBox() { return box.map(round); }
    function setBox(value) { box = normalize(value); layout(); }

    async function run(id) {
      if (closed) return;
      buttons.forEach(button => { button.disabled = true; });
      try {
        const keep = await options.onAction?.(id, getBox());
        if (keep === false || closed) return;
        close();
      } finally {
        if (!closed) buttons.forEach(button => { button.disabled = false; });
      }
    }
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', layout);
      resizeObserver?.disconnect();
      overlay.remove();
      options.onClose?.();
    }

    // ---- ポインター: 移動・大きさの変更・描き直し ----
    let drag = null;
    overlay.addEventListener('pointerdown', event => {
      if (event.button !== 0 || bar.contains(event.target)) return;
      const a = area();
      if (!a) return;
      event.preventDefault();
      const handle = event.target.closest?.('.gb-crop-box-handle');
      const x = (event.clientX - a.left) / a.width, y = (event.clientY - a.top) / a.height;
      if (handle) drag = { kind: 'edge', edge: handle.dataset.edge, start: box.slice(), x, y };
      else if (rect.contains(event.target)) drag = { kind: 'move', start: box.slice(), x, y };
      else drag = { kind: 'draw', x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
      overlay.setPointerCapture?.(event.pointerId);
      rect.focus({ preventScroll: true });
    });
    overlay.addEventListener('pointermove', event => {
      if (!drag) return;
      const a = area();
      if (!a) return;
      const x = (event.clientX - a.left) / a.width, y = (event.clientY - a.top) / a.height;
      if (drag.kind === 'move') {
        const [l, t, r, b] = drag.start, w = r - l, h = b - t;
        const left = clamp(l + x - drag.x, 0, 1 - w), top = clamp(t + y - drag.y, 0, 1 - h);
        box = [left, top, left + w, top + h];
      } else if (drag.kind === 'edge') {
        let [l, t, r, b] = drag.start;
        const dx = x - drag.x, dy = y - drag.y;
        if (drag.edge.includes('w')) l = clamp(l + dx, 0, r - minSize);
        if (drag.edge.includes('e')) r = clamp(r + dx, l + minSize, 1);
        if (drag.edge.includes('n')) t = clamp(t + dy, 0, b - minSize);
        if (drag.edge.includes('s')) b = clamp(b + dy, t + minSize, 1);
        box = [l, t, r, b];
      } else {
        box = normalize([drag.x, drag.y, clamp(x, 0, 1), clamp(y, 0, 1)]);
      }
      layout();
    });
    const endDrag = () => { drag = null; };
    overlay.addEventListener('pointerup', endDrag);
    overlay.addEventListener('pointercancel', endDrag);
    // 下の画面の拡大・パン・右クリックを受け付けない
    overlay.addEventListener('wheel', event => { event.preventDefault(); event.stopPropagation(); }, { passive: false });
    overlay.addEventListener('contextmenu', event => { event.preventDefault(); event.stopPropagation(); });

    // ---- キーボード ----
    // 開いている間のキー操作は枠が受ける（フォーカスがまだ枠へ移っていなくても、下の画面のページ送り等へ渡さない）
    const onKey = event => {
      if (closed || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        const cancel = (options.actions || []).find(action => action.cancel);
        if (cancel) void run(cancel.id); else close();
        return;
      }
      if (event.key === 'Enter' && !event.target.closest?.('button,input,select,textarea')) {
        event.preventDefault(); event.stopPropagation();
        const primary = (options.actions || []).find(action => action.primary);
        if (primary) void run(primary.id);
        return;
      }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!dir || event.target.closest?.('input,select,textarea')) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 0.1 : 0.01;
      let [l, t, r, b] = box;
      if (event.altKey) {
        r = clamp(r + dir[0] * step, l + minSize, 1);
        b = clamp(b + dir[1] * step, t + minSize, 1);
      } else {
        const w = r - l, h = b - t;
        l = clamp(l + dir[0] * step, 0, 1 - w); t = clamp(t + dir[1] * step, 0, 1 - h);
        r = l + w; b = t + h;
      }
      box = [l, t, r, b];
      layout();
    };
    document.addEventListener('keydown', onKey, true);

    window.addEventListener('resize', layout);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
    resizeObserver?.observe(overlay);
    layout();
    requestAnimationFrame(() => { if (!closed) { layout(); rect.focus({ preventScroll: true }); } });
    return Object.freeze({ getBox, setBox, close, layout, element: overlay, isOpen: () => !closed });
  }

  window.MeldexCropBox = Object.freeze({ open });
})();
