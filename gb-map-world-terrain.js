/* Deterministic terrain primitives. No saved heightfield is regenerated on load. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MeldexMapWorldTerrain = api;
})(globalThis, function() {
  'use strict';
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  function hash(text) { let n = 2166136261; for (const c of String(text)) n = Math.imul(n ^ c.codePointAt(0), 16777619); return n >>> 0; }
  function rng(seed) { let n = hash(seed); return () => { n += 0x6D2B79F5; let t = Math.imul(n ^ n >>> 15, 1 | n); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  class Heap {
    constructor() { this.items = []; }
    push(id, cost) { const a = this.items, item = { id, cost }; let i = a.length; a.push(item); while (i) { const p = (i - 1) >> 1; if (a[p].cost <= cost) break; a[i] = a[p]; i = p; } a[i] = item; }
    pop() { const a = this.items, first = a[0], last = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let j = i * 2 + 1; if (j + 1 < a.length && a[j + 1].cost < a[j].cost) j++; if (a[j].cost >= last.cost) break; a[i] = a[j]; i = j; } a[i] = last; } return first; }
    get length() { return this.items.length; }
  }
  function noise(seed) {
    const salt = hash(seed), grad = [[1,0],[-1,0],[0,1],[0,-1],[.707,.707],[-.707,.707],[.707,-.707],[-.707,-.707]];
    const lattice = (x, y, dx, dy) => { let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ salt; n = Math.imul(n ^ n >>> 13, 1274126177); const g = grad[(n ^ n >>> 16) & 7]; return g[0] * dx + g[1] * dy; };
    const fade = x => x * x * x * (x * (x * 6 - 15) + 10);
    return (x, y) => { const a = Math.floor(x), b = Math.floor(y), u = x - a, v = y - b, sx = fade(u), sy = fade(v);
      const p = lattice(a,b,u,v)*(1-sx)+lattice(a+1,b,u-1,v)*sx, q = lattice(a,b+1,u,v-1)*(1-sx)+lattice(a+1,b+1,u-1,v-1)*sx;
      return (p*(1-sy)+q*sy)*1.5; };
  }
  function fbm(n, x, y, octaves = 6) { let sum = 0, amp = 1, weight = 0; for (let i = 0; i < octaves; i++) { sum += n(x,y)*amp; weight += amp; x = x * 2.03 + 17.31; y = y * 2.03 - 9.17; amp *= .52; } return sum / weight; }
  function neighbors(i, cols, rows, visit, diagonal = true) { const x = i % cols, y = Math.floor(i / cols); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if ((!dx && !dy) || !diagonal && dx && dy) continue; const a = x + dx, b = y + dy; if (a >= 0 && b >= 0 && a < cols && b < rows) visit(b * cols + a, dx && dy ? Math.SQRT2 : 1); } }
  function distances(mask, cols, rows) { const d = new Int32Array(mask.length).fill(0x3fffffff), q = []; for (let i = 0; i < mask.length; i++) if (mask[i]) { d[i] = 0; q.push(i); } for (let k = 0; k < q.length; k++) neighbors(q[k],cols,rows,j => { if (d[j] > d[q[k]] + 1) { d[j] = d[q[k]] + 1; q.push(j); } },false); return d; }
  function components(mask, cols, rows, diagonal = false) { const ids = new Int32Array(mask.length).fill(-1), groups = []; for (let i = 0; i < mask.length; i++) if (mask[i] && ids[i] < 0) { const cells = [i], id = groups.length; ids[i] = id; for (let k = 0; k < cells.length; k++) neighbors(cells[k],cols,rows,j => { if (mask[j] && ids[j] < 0) { ids[j] = id; cells.push(j); } },diagonal); groups.push(cells); } return { ids, groups }; }
  function fingerprint(t) { let n = 2166136261; for (const h of t.heights) n = Math.imul(n ^ Math.round((h + 1) * 1e7), 16777619); return t.cols + ':' + t.rows + ':' + (n >>> 0).toString(16); }
  function sample(t, nx, ny, field = t.heights) { const x = clamp(nx)*(t.cols-1), y = clamp(ny)*(t.rows-1), a = Math.floor(x), b = Math.floor(y), u = x-a, v = y-b; const at = (i,j)=>field[Math.min(t.rows-1,j)*t.cols+Math.min(t.cols-1,i)]; return (at(a,b)*(1-u)+at(a+1,b)*u)*(1-v)+(at(a,b+1)*(1-u)+at(a+1,b+1)*u)*v; }
  function generate(seed, template = 'continent', land = .4, roughness = 50, size = {}) {
    if (!['continent','island','archipelago'].includes(template) || !Number.isFinite(land) || land < .1 || land > .8 || !Number.isFinite(roughness) || roughness < 0 || roughness > 100) throw new Error('地形生成の条件を確認してください');
    const cols = size.cols ?? 256, rows = size.rows ?? 160;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 32 || rows < 32 || cols > 256 || rows > 256) throw new Error('地形の解像度が不正です');
    const n = noise(seed), warp = noise(seed + ':warp'), detail = noise(seed + ':detail'), random = rng(seed + ':plates');
    const plates = Array.from({ length: 18 }, () => { const angle = random() * Math.PI * 2; return { x: random(), y: random(), vx: Math.cos(angle), vy: Math.sin(angle) }; });
    const raw = [], ridges = [], frequency = template === 'archipelago' ? 5.4 : 3.1;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const nx = x/(cols-1), ny = y/(rows-1), wx = nx + fbm(warp,nx*3,ny*3,3)*.22, wy = ny + fbm(warp,nx*3+40,ny*3-20,3)*.22;
      let value = fbm(n,wx*frequency,wy*frequency,7) + .12*fbm(detail,wx*frequency*2,wy*frequency*2,3);
      const edge = Math.min(nx,ny,1-nx,1-ny);
      value -= .9 * (1-clamp(edge/.07)) ** 2;
      if (template === 'island') value -= .65 * (Math.hypot((wx-.5)*1.2,wy-.5));
      raw.push(value);
      const ordered = plates.map(p => ({ p, d: (p.x-wx)**2+(p.y-wy)**2 })).sort((a,b) => a.d-b.d), a = ordered[0], b = ordered[1];
      const dx = b.p.x-a.p.x, dy = b.p.y-a.p.y, distance = Math.hypot(dx,dy);
      const convergence = clamp(((a.p.vx-b.p.vx)*dx+(a.p.vy-b.p.vy)*dy)/(distance||1)*.7+.2);
      const gap=Math.sqrt(b.d)-Math.sqrt(a.d),boundary=Math.exp(-((gap/.027)**2)),foothills=Math.exp(-((gap/.065)**2));
      const peaks=clamp(.5+fbm(detail,wx*35,wy*35,4)*1.05,.12,1),folds=(1-Math.abs(detail(wx*95,wy*95)))**3;
      ridges.push((boundary*.68+foothills*.32) * (.28+.72*convergence) * (.3+peaks*.7) * (.5+folds*.5));
    }
    const sorted = [...raw].sort((a,b)=>a-b), threshold = sorted[Math.floor((1-land)*(raw.length-1))], span = Math.max(.08,sorted[Math.floor(raw.length*.98)]-threshold);
    const sea = raw.map(v => v <= threshold), coastDistance = distances(sea,cols,rows), strength = roughness/100;
    let heights = raw.map((v,i) => { const z = (v-threshold)/span; if (z <= 0) return -clamp(-z*.55,.002,1);
      const coast = clamp(coastDistance[i]/3), nx = i%cols/cols, ny = Math.floor(i/cols)/rows;
      const lowland = .025+.22*Math.pow(clamp(z),.85), ridge = ridges[i]*(.18+.65*strength), hills = Math.abs(fbm(detail,nx*55,ny*55,4))*.09*strength;
      return clamp((lowland+ridge+hills)*coast, .001, .98); });
    // Talus transport softens isolated spikes while retaining long uplift belts.
    for (let step = 0; step < 3; step++) { const next = heights.slice(); for (let i = 0; i < heights.length; i++) if (heights[i] > .15) { let target = i, drop = .19; neighbors(i,cols,rows,(j,d) => { const slope = (heights[i]-heights[j])/d; if (heights[j] > 0 && slope > drop) { drop = slope; target = j; } }); if (target !== i) { const moved = Math.min(.025,(drop-.19)*.15); next[i] -= moved; next[target] += moved; } } heights = next; }
    return { generator_version: 3, seed: String(seed), template, land, roughness, cols, rows, heights };
  }
  function simplify(points, tolerance = .2) { if (points.length <= 2) return points; const keep = new Set([0,points.length-1]), stack = [[0,points.length-1]], sq = tolerance*tolerance; while (stack.length) { const [a,b] = stack.pop(), p = points[a], q = points[b], dx = q[0]-p[0], dy = q[1]-p[1], len = dx*dx+dy*dy; let far = sq, best = -1; for (let i = a+1; i < b; i++) { const t = len ? clamp(((points[i][0]-p[0])*dx+(points[i][1]-p[1])*dy)/len) : 0; const d = (points[i][0]-p[0]-t*dx)**2+(points[i][1]-p[1]-t*dy)**2; if (d > far) { far = d; best = i; } } if (best >= 0) { keep.add(best); stack.push([a,best],[best,b]); } } return [...keep].sort((a,b)=>a-b).map(i=>points[i]); }
  return Object.freeze({ clamp, hash, rng, Heap, noise, fbm, neighbors, distances, components, fingerprint, sample, generate, simplify });
});
