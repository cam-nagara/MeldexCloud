/* Board-compatible pointer navigation. Document edits are committed only on release. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeldexMapInteraction = api;
})(globalThis, function () {
  'use strict';
  const angle = n => typeof n === 'number' && Number.isFinite(n) ? ((n + 180) % 360 + 360) % 360 - 180 : 0;
  const rotate = (p, degrees) => { const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
  const editableTarget = el => !!el?.closest?.('input,textarea,select,[contenteditable=true],[role=textbox]');
  class Controller {
    constructor(view) {
      this.view = view; this.el = view.container; this.space = false; this.usedSpace = false; this.touches = new Map(); this.listeners = [];
      this.listen(this.el, 'pointerdown', e => this.down(e), true);
      this.listen(document, 'pointermove', e => this.move(e), true);
      this.listen(document, 'pointerup', e => this.up(e), true);
      this.listen(document, 'pointercancel', e => this.abortPointer(e), true);
      this.listen(this.el, 'lostpointercapture', e => this.abortPointer(e), true);
      this.listen(this.el, 'click', e => { if (!this.control(e) && (!e.target.closest?.('.gb-map-sheet-place') || Date.now() < (this.suppressSheetClick || 0))) e.stopImmediatePropagation(); }, true);
      this.listen(document, 'pointerdown', e => { if (this.contextMenu && !this.contextMenu.contains(e.target)) this.closeMenu(); }, true);
      this.listen(this.el, 'dblclick', e => this.doubleClick(e), true);
      this.listen(this.el, 'contextmenu', e => { if (!this.control(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
      this.listen(this.el, 'wheel', e => this.wheel(e), { capture: true, passive: false });
      this.listen(document, 'keydown', e => {
        const owner = this.el.closest('.gb-map-app');
        if (this.el.contains(e.target) || this.el.classList.contains('gb-map-surface') && owner?.contains(e.target) && !e.target.closest('.gb-map-generator,.gb-map-generator-preview')) this.keyDown(e);
      }, true);
      this.listen(document, 'keyup', e => this.keyUp(e), true);
      this.listen(window, 'blur', () => this.reset());
      this.listen(document, 'visibilitychange', () => { if (document.hidden) this.reset(); });
      this.el.tabIndex = 0;
    }
    listen(el, name, fn, options) { el.addEventListener(name, fn, options); this.listeners.push(() => el.removeEventListener(name, fn, options)); }
    control(e) { return !!e.target.closest?.('.leaflet-control,.gb-map-context-menu'); }
    block(e) { e.preventDefault(); e.stopImmediatePropagation(); }
    local(e) {
      const r = this.el.getBoundingClientRect();
      return [(e.clientX - r.left) * this.el.clientWidth / (r.width || 1), (e.clientY - r.top) * this.el.clientHeight / (r.height || 1)];
    }
    native(p) {
      const v = this.view, size = v.map.getSize(), q = rotate([p[0] - this.el.clientWidth / 2, p[1] - this.el.clientHeight / 2], -(v.rotation || 0));
      return L.point(q[0] + size.x / 2, q[1] + size.y / 2);
    }
    point(e) { return this.view.xy(this.view.map.containerPointToLatLng(this.native(this.local(e)))); }
    navigationEvent(e) { return !!this.gesture || !this.view._painting && (this.space || e.button === 1 || e.button === 2); }
    keyDown(e) {
      if (e.isComposing || e.keyCode === 229 || editableTarget(e.target) || this.control(e)) return;
      if (e.code === 'Space') { if (!e.repeat) { this.space = true; this.usedSpace = false; this.spaceCanvas = this.el.contains(e.target); } this.cursor(e); if (this.spaceCanvas) this.block(e); }
      else if (this.space && ['Control', 'Shift'].includes(e.key)) this.cursor(e);
      else if (this.space && e.key.startsWith('Arrow')) {
        const d = { ArrowLeft: [50, 0], ArrowRight: [-50, 0], ArrowUp: [0, 50], ArrowDown: [0, -50] }[e.key];
        if (d) { this.view.panScreen(d); this.usedSpace = true; this.block(e); }
      } else if (e.key === 'Escape' && this.gesture) { this.cancel(); this.block(e); }
    }
    keyUp(e) {
      if (e.code === 'Space') {
        const focus = this.space && this.spaceCanvas && !this.usedSpace && !this.gesture;
        if (this.space && this.usedSpace) this.block(e);
        this.space = false; this.el.style.cursor = '';
        if (focus) this.view.focusSelection();
      } else if (this.space) this.cursor(e);
    }
    cursor(e) { this.el.style.cursor = this.space ? (e.ctrlKey || e.metaKey ? 'zoom-in' : e.shiftKey ? 'crosshair' : 'grab') : ''; }
    down(e) {
      const v = this.view; if (!v.map || this.control(e) || v._painting) return;
      this.closeMenu(); this.el.focus({ preventScroll: true });
      const p = this.local(e), hit = v.hit(e), nav = this.space || e.button === 1 || e.button === 2;
      if (e.pointerType === 'touch') {
        this.touches.set(e.pointerId, p);
        if (this.touches.size === 2) {
          this.cancel(false); const [a, b] = [...this.touches.values()];
          this.gesture = { mode: 'pinch', start: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], distance: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: v.map.getZoom() };
          this.gesture.anchor = v.map.containerPointToLatLng(this.native(this.gesture.start)); this.el.setPointerCapture(e.pointerId); this.block(e); return;
        }
      }
      if (this.gesture || ![0, 1, 2].includes(e.button)) return;
      if (!nav && e.target.closest?.('.gb-map-sheet-place')) return;
      if (!nav && ['land', 'sea'].includes(v.tool)) return;
      let mode = nav ? (this.space && (e.ctrlKey || e.metaKey) ? 'zoom' : this.space && e.shiftKey ? 'rotate' : 'pan')
        : v.tool === 'erase' ? 'erase' : e.altKey && !e.shiftKey && !v.readOnly ? 'route-drag'
          : v.tool === 'select' ? (hit ? 'feature' : e.pointerType === 'touch' ? 'pan' : 'rectangle') : 'draw';
      if (mode === 'feature') {
        const ids = new Set(v.selection());
        if (e.ctrlKey || e.metaKey) { if (ids.has(hit.id)) ids.delete(hit.id); else ids.add(hit.id); }
        else if (e.shiftKey) ids.add(hit.id);
        else if (!ids.has(hit.id)) { ids.clear(); ids.add(hit.id); }
        v.choose([...ids], hit.id);
      }
      const g = { mode, pointerId: e.pointerId, start: p, last: p, hit, button: e.button, moved: false, source: v.doc.features,
        zoom: v.map.getZoom(), rotation: v.rotation || 0, center: v.map.project(v.map.getCenter()), draft: v.draft.map(p => p.slice()),
        anchor: v.map.containerPointToLatLng(this.native(p)), baseSelection: [...v.selection()], additive: !!(e.ctrlKey || e.metaKey) };
      if (mode === 'feature') {
        g.vertex = e.target.closest?.('[data-map-vertex]');
        g.original = new Map(v.doc.features.filter(f => v.selection().has(f.id) && !v.readOnly && !v.doc.layers.find(l => l.id === f.layer_id)?.locked).map(f => [f.id, f.points]));
        if (g.vertex) g.original = new Map([...g.original].filter(([id]) => id === hit.id));
        else if (e.ctrlKey || e.metaKey || e.shiftKey) g.original.clear();
      }
      if (mode === 'erase') g.erased = new Set();
      if (mode === 'rectangle') {
        this.rectangle = document.createElement('div'); this.rectangle.className = 'gb-map-selection-rect'; this.el.appendChild(this.rectangle);
      }
      this.gesture = g; this.block(e); this.el.setPointerCapture(e.pointerId);
      if (mode === 'erase') this.erase(e);
      if (nav) { this.usedSpace = true; this.el.style.cursor = 'grabbing'; }
    }
    move(e) {
      const v = this.view, g = this.gesture; if (!g || !v.map) return;
      if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, this.local(e));
      if (g.mode === 'pinch') {
        const [a, b] = [...this.touches.values()]; if (!a || !b) return;
        const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ratio = Math.hypot(a[0] - b[0], a[1] - b[1]) / (g.distance || 1);
        v.zoomAt(g.zoom + Math.log2(Math.max(.01, ratio)), midpoint, g.anchor); this.block(e); return;
      }
      if (g.pointerId !== e.pointerId) return;
      this.block(e); const p = this.local(e), dx = p[0] - g.start[0], dy = p[1] - g.start[1]; g.last = p;
      g.moved ||= Math.hypot(dx, dy) >= 4;
      if (g.mode === 'pan') {
        const d = rotate([dx, dy], -g.rotation); v.map.setView(v.map.unproject(g.center.subtract(L.point(...d)), g.zoom), g.zoom, { animate: false });
      } else if (g.mode === 'zoom') {
        const factor = v.doc.coordinate_system === 'local' ? Math.max(.1, Math.min(5, 2 ** g.zoom + dx * .005)) : 2 ** (g.zoom + dx * .005);
        v.zoomAt(Math.log2(factor), g.start, g.anchor);
      } else if (g.mode === 'rotate') {
        const cx = this.el.clientWidth / 2, cy = this.el.clientHeight / 2;
        v.setRotation(g.rotation + angle((Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(g.start[1] - cy, g.start[0] - cx)) * 180 / Math.PI));
      } else if (g.mode === 'rectangle') {
        Object.assign(this.rectangle.style, { left: Math.min(p[0], g.start[0]) + 'px', top: Math.min(p[1], g.start[1]) + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
      } else if (g.mode === 'feature' && g.moved && g.original.size) {
        const d = rotate([dx, dy], -g.rotation); g.changes = [];
        for (const [id, points] of g.original) {
          const next = points.map((pt, i) => g.vertex && Number(g.vertex.dataset.mapVertex) !== i ? pt
            : v.xy(v.map.unproject(v.map.project(v.latlng(pt), g.zoom).add(L.point(...d)), g.zoom)));
          g.changes.push({ id, points: next }); v.preview(id, next);
        }
      } else if ((g.mode === 'route-drag' || g.mode === 'draw' && v.tool === 'route' && !g.draft.length) && g.moved && !v.readOnly) {
        v.draft = [v.xy(g.anchor), this.point(e)]; v._draft();
      } else if (g.mode === 'erase') this.erase(e);
    }
    erase(e) {
      const g = this.gesture, v = this.view; if (v.readOnly) return;
      const hit = v.hit(e, g.erased);
      if (hit && !v.doc.layers.find(l => l.id === hit.layer_id)?.locked) { g.erased.add(hit.id); v.previewHidden(g.erased); }
    }
    up(e) {
      const v = this.view, g = this.gesture;
      this.touches.delete(e.pointerId);
      if (!g || !v.map) return;
      if (g.mode === 'pinch') { if (this.touches.size < 2) this.cancel(); return; }
      if (g.pointerId !== e.pointerId) return;
      this.block(e); this.gesture = null; this.rectangle?.remove(); this.rectangle = null;
      if (g.moved) this.suppressSheetClick = Date.now() + 300;
      if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
      this.el.style.cursor = this.space ? 'grab' : '';
      if (g.mode === 'feature' && g.changes?.length) v.callbacks.action({ type: 'transform', changes: g.changes, source: g.source });
      else if (g.mode === 'rectangle') {
        const ids = g.moved ? v.inRectangle(g.start, g.last) : [], next = new Set(g.additive ? g.baseSelection : []);
        for (const id of ids) { if (g.additive && next.has(id)) next.delete(id); else next.add(id); } v.choose([...next]);
      } else if (g.mode === 'erase' && g.erased.size) v.callbacks.action({ type: 'erase', ids: [...g.erased], source: g.source });
      else if ((g.mode === 'route-drag' || g.mode === 'draw' && v.tool === 'route' && !g.draft.length) && g.moved) {
        if (!v.readOnly) v.callbacks.action({ type: 'add', kind: 'route', points: [v.xy(g.anchor), this.point(e)] }); v.cancel();
      } else if (g.mode === 'draw' && !g.moved) v._click({ latlng: v.map.containerPointToLatLng(this.native(this.local(e))) });
      else if (g.mode === 'pan' && g.button === 2 && !g.moved) this.menu(e, g.hit);
      v._features();
    }
    abortPointer(e) { if (this.gesture?.pointerId === e.pointerId || this.touches.has(e.pointerId)) this.reset(); }
    cancel(clearTouches = true) {
      const g = this.gesture; this.gesture = null; this.rectangle?.remove(); this.rectangle = null;
      if (clearTouches && g?.pointerId != null && this.el.hasPointerCapture(g.pointerId)) this.el.releasePointerCapture(g.pointerId);
      if (clearTouches) for (const id of this.touches.keys()) if (this.el.hasPointerCapture(id)) this.el.releasePointerCapture(id);
      if (g && this.view.map) { this.view._features(); if (g.mode === 'route-drag' || g.mode === 'draw' && g.moved) { this.view.draft = g.draft || []; this.view._draft(); } }
      if (clearTouches) this.touches.clear();
    }
    reset() { this.cancel(); this.view.cancel(); this.space = false; this.usedSpace = false; this.el.style.cursor = ''; this.closeMenu(); }
    wheel(e) {
      if (!this.view.map || this.control(e) || !e.deltaY) return;
      this.block(e); if (this.gesture) return;
      this.view.stepZoom(e.deltaY > 0 ? -1 : 1, this.local(e));
    }
    doubleClick(e) {
      if (!this.view.map || this.control(e) || e.target.closest?.('.gb-map-sheet-place')) return; this.block(e);
      const v = this.view;
      if (this.space) { this.usedSpace = true; if (e.shiftKey) v.setRotation(0); else v.resetView(); }
      else if (['route', 'region', 'measure'].includes(v.tool)) v.finish();
      else if (v.tool === 'select') {
        const hit = v.hit(e);
        if (hit) { v.choose([hit.id], hit.id); v.callbacks.edit?.(hit.id); }
        else if (!v.readOnly) { v.callbacks.action({ type: 'add', kind: 'pin', points: [this.point(e)], edit: true }); }
      }
    }
    menu(e, hit) {
      const v = this.view; if (hit && !v.selection().has(hit.id)) v.choose([hit.id], hit.id);
      this.closeMenu(); const menu = document.createElement('div'); this.contextMenu = menu;
      menu.className = 'gb-context-menu gb-map-context-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'マップ操作');
      const add = (label, action, disabled = false) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('role', 'menuitem'); b.disabled = disabled; b.onclick = () => { this.closeMenu(); action(); }; menu.appendChild(b); };
      if (v.draft.length) { add('描画を確定', () => v.finish()); add('描画を取消', () => v.cancel()); }
      add('地点を追加', () => v.callbacks.action({ type: 'add', kind: 'pin', points: [this.point(e)], edit: true }), v.readOnly);
      if (v.selection().size) {
        add('名前を編集', () => v.callbacks.edit?.([...v.selection()][0]), v.readOnly);
        add('複製', () => v.callbacks.command?.('duplicate'), v.readOnly); add('削除', () => v.callbacks.command?.('delete'), v.readOnly);
      }
      add('全選択', () => v.choose(v.doc.features.filter(f => v._visible(f)).map(f => f.id)));
      add('選択を解除', () => v.choose([])); add('全体表示', () => v.fit()); add('100%表示', () => v.zoom100()); add('回転リセット', () => v.setRotation(0));
      menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { this.closeMenu(); this.el.focus(); }
        else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          const buttons = [...menu.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        } else return;
        event.preventDefault(); event.stopPropagation();
      });
      document.body.appendChild(menu);
      if (typeof positionPopup === 'function') positionPopup(menu, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
      else { menu.style.left = Math.min(e.clientX, Math.max(0, innerWidth - menu.offsetWidth)) + 'px'; menu.style.top = Math.min(e.clientY, Math.max(0, innerHeight - menu.offsetHeight)) + 'px'; }
      menu.querySelector('button:not(:disabled)')?.focus();
    }
    closeMenu() { const focused = this.contextMenu?.contains(document.activeElement); this.contextMenu?.remove(); this.contextMenu = null; if (focused && this.el.isConnected) this.el.focus({ preventScroll: true }); }
    destroy() { this.reset(); this.listeners.forEach(fn => fn()); this.listeners = []; }
  }
  return Object.freeze({ Controller, angle, rotate, editableTarget });
});
