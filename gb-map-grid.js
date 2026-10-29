/* Bounded cell geometry shared by creative generators. Coordinates use y down. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MeldexMapGrid = api;
})(globalThis, function () {
  'use strict';
  function rng(seed) {
    let state = 2166136261;
    for (const c of String(seed)) state = Math.imul(state ^ c.codePointAt(0), 16777619) >>> 0;
    return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  }
  function sample(t, x, y) {
    const gx = Math.max(0, Math.min(t.cols - 1, x * t.cols)), gy = Math.max(0, Math.min(t.rows - 1, y * t.rows));
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const get = (a, b) => t.heights[Math.min(t.rows - 1, b) * t.cols + Math.min(t.cols - 1, a)];
    return (get(ix, iy) * (1 - fx) + get(ix + 1, iy) * fx) * (1 - fy) + (get(ix, iy + 1) * (1 - fx) + get(ix + 1, iy + 1) * fx) * fy;
  }
  function rectangles(cells, columns, rows, key) {
    const result = []; let active = new Map();
    for (let y = 0; y < rows; y++) {
      const next = new Map();
      for (let x = 0; x < columns;) {
        const start = x++, value = cells[y * columns + start];
        while (x < columns && cells[y * columns + x] === value) x++;
        if (value !== key) continue;
        const signature = start + ':' + x, box = active.get(signature) || { x1: start, x2: x, y1: y, y2: y };
        if (!active.has(signature)) result.push(box);
        box.y2 = y + 1; next.set(signature, box);
      }
      active = next;
    }
    return result.map(b => [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]]);
  }
  function polygons(cells, columns, rows, key) {
    const edges = [], starts = new Map(), at = (x, y) => x >= 0 && x < columns && y >= 0 && y < rows && cells[y * columns + x] === key;
    const add = (x, y, nx, ny, direction) => {
      const edge = { a: [x, y], b: [nx, ny], direction, used: false }; edges.push(edge);
      const s = x + ',' + y; if (!starts.has(s)) starts.set(s, []); starts.get(s).push(edge);
    };
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) if (at(x, y)) {
      if (!at(x, y - 1)) add(x, y, x + 1, y, 0);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2);
      if (!at(x - 1, y)) add(x, y + 1, x, y, 3);
    }
    const loops = [];
    for (const first of edges) {
      if (first.used) continue;
      const points = []; let edge = first;
      do {
        edge.used = true; points.push(edge.a);
        if (edge.b[0] === first.a[0] && edge.b[1] === first.a[1]) break;
        const candidates = (starts.get(edge.b.join(',')) || []).filter(e => !e.used);
        // Follow the right boundary at diagonal contacts; do not join islands.
        edge = [1, 0, 3, 2].map(turn => candidates.find(e => e.direction === (edge.direction + turn) % 4)).find(Boolean);
        if (!edge) throw new Error('領域の境界を生成できません');
      } while (points.length <= edges.length);
      const simple = points.filter((p, i) => {
        const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
        return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
      });
      loops.push(simple);
    }
    const area = points => points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    // Native regions have no holes. Rectangles retain lakes and enclaves exactly.
    return loops.some(loop => area(loop) < 0) ? rectangles(cells, columns, rows, key) : loops;
  }
  return Object.freeze({ rng, sample, rectangles, polygons });
});
