/* Seeded, offline world-building drafts. Output remains ordinary editable geometry. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./gb-map-document.js') : root.MeldexMapDocument,
    node ? require('./gb-map-grid.js') : root.MeldexMapGrid, node ? require('./gb-map-climate.js') : root.MeldexMapClimate);
  if (node) module.exports = api; else root.MeldexMapWorldBuilding = api;
})(globalThis, function (D, G, C) {
  'use strict';
  const names = { nations: '国家', vegetation: '植生', town: '都市・集落' };
  const colors = ['#af765e', '#698eb2', '#9a8bba', '#b59c51', '#629d8b', '#b26f95', '#80964f', '#b38342'];
  const plants = [
    ['polar', 'ツンドラ', '#bec8a5'], ['cold', '針葉樹林', '#547b68'], ['temperate', '広葉樹林', '#6a965b'],
    ['tropical', '熱帯林', '#27835b'], ['dry', '乾燥草原・低木', '#bca573'], ['alpine', '高山植生', '#a4a795'],
  ];
  function regions(doc, cells, columns, rows, types) {
    const used = new Set(doc.features.map(f => f.label)), result = [];
    for (const type of types) {
      let number = 1;
      for (const points of G.polygons(cells, columns, rows, type.key)) {
        while (used.has(type.label + ' ' + number)) number++;
        const label = type.label + ' ' + number++; used.add(label);
        result.push({ kind: 'region', points: points.map(([x, y]) => [x / columns * doc.canvas.width, y / rows * doc.canvas.height]),
          label, color: type.color, tags: [type.label], description: '区画中央の陸地を使った創作の下案。境界は区画単位です。' });
      }
    }
    return result;
  }
  function nations(doc, options) {
    const { count, columns, seed } = options;
    if (!Number.isInteger(count) || count < 1 || count > 32 || !Number.isInteger(columns) || columns < 8 || columns > 64) throw new Error('国家数は1〜32、横の区画数は8〜64で指定してください');
    const rows = Math.max(8, Math.min(48, Math.round(columns * doc.canvas.height / doc.canvas.width))), random = G.rng(seed);
    const heights = Array.from({ length: columns * rows }, (_, i) => G.sample(doc.terrain, (i % columns + .5) / columns, (Math.floor(i / columns) + .5) / rows));
    const land = heights.map((h, i) => h >= .035 ? i : -1).filter(i => i >= 0), centers = [];
    const separation = (a, b) => ((a % columns - b % columns) * doc.canvas.width / columns) ** 2 + ((Math.floor(a / columns) - Math.floor(b / columns)) * doc.canvas.height / rows) ** 2;
    if (!land.length) return { features: [], detail: '区画中央に陸地がありません。' };
    centers.push(land[Math.floor(random() * land.length)]);
    while (centers.length < Math.min(count, land.length)) {
      let candidate = -1, best = -1;
      for (const cell of land) {
        const distance = Math.min(...centers.map(c => separation(c, cell)));
        const score = distance * (.85 + random() * .3);
        if (score > best && !centers.includes(cell)) { best = score; candidate = cell; }
      }
      centers.push(candidate);
    }
    const cells = Array(heights.length).fill(null), cost = Array(heights.length).fill(Infinity), done = new Uint8Array(heights.length);
    centers.forEach((c, i) => { cells[c] = i; cost[c] = 0; });
    // Bounded (at most 3072 cells) multi-source Dijkstra. Steep/high terrain
    // increases the expansion cost; sea is never traversed or assigned.
    for (;;) {
      let current = -1, best = Infinity;
      for (const cell of land) if (!done[cell] && cost[cell] < best) { best = cost[cell]; current = cell; }
      if (current < 0) break;
      done[current] = 1;
      const x = current % columns, y = Math.floor(current / columns);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        const next = ny * columns + nx;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows || heights[next] < .035 || done[next]) continue;
        const step = (nx === x ? doc.canvas.height / rows : doc.canvas.width / columns) * (1 + Math.abs(heights[next] - heights[current]) * 6 + Math.max(0, heights[next]) * 2);
        if (best + step < cost[next]) { cost[next] = best + step; cells[next] = cells[current]; }
      }
    }
    // Unseeded islands belong wholly to the nearest seed, avoiding artificial
    // nation fragments from assigning each island cell independently.
    for (const first of land) if (cells[first] === null) {
      const island = [first]; cells[first] = -1;
      for (let i = 0; i < island.length; i++) {
        const c = island[i], x = c % columns, y = Math.floor(c / columns);
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          const n = ny * columns + nx;
          if (nx >= 0 && nx < columns && ny >= 0 && ny < rows && heights[n] >= .035 && cells[n] === null) { cells[n] = -1; island.push(n); }
        }
      }
      const distances = centers.map(c => Math.min(...island.map(cell => separation(c, cell))));
      const owner = distances.indexOf(Math.min(...distances)); island.forEach(c => { cells[c] = owner; });
    }
    const types = centers.map((_, i) => ({ key: i, label: options.name + ' ' + (i + 1), color: colors[i % colors.length] }));
    return { features: regions(doc, cells, columns, rows, types), cells, columns, rows,
      detail: `${centers.length}か国（希望${count}）、${columns}×${rows}区画。海岸線は区画で近似します。` };
  }
  function vegetation(doc, options) {
    const climate = C.generate(doc, { ...options, equator: options.equator ?? 50 });
    const types = plants.map(([key, label, color]) => ({ key, label, color }));
    return { features: regions(doc, climate.cells, climate.columns, climate.rows, types), cells: climate.cells,
      columns: climate.columns, rows: climate.rows, detail: '暖かさ・湿り気・標高・北方向に基づく6種類の植生下案。海岸線は区画で近似します。' };
  }
  function town(doc, options) {
    const { count, angle, seed } = options;
    if (!Number.isInteger(count) || count < 8 || count > 200 || !Number.isFinite(angle) || angle < -180 || angle > 180) throw new Error('建物数は8〜200、街路の角度は-180〜180で指定してください');
    const random = G.rng(seed), size = Math.min(doc.canvas.width, doc.canvas.height) * .68, step = size / 8, half = size / 2;
    const theta = angle * Math.PI / 180, transform = ([x, y]) => [doc.canvas.width / 2 + x * Math.cos(theta) - y * Math.sin(theta), doc.canvas.height / 2 + x * Math.sin(theta) + y * Math.cos(theta)];
    const result = [], used = new Set(doc.features.map(f => f.label));
    const add = (kind, points, label, color, tag) => {
      let name = label, n = 2; while (used.has(name)) name = label + ' (' + n++ + ')'; used.add(name);
      result.push({ kind, points: points.map(transform), label: name, color, tags: [tag], description: '編集用の都市・集落下案。背景の水面・斜面には自動で合わせません。' });
    };
    for (let i = -2; i <= 2; i++) {
      const p = i * step * 1.5;
      add('route', [[-half, p], [half, p]], '東西通り ' + (i + 3), '#a28a62', '街路');
      add('route', [[p, -half], [p, half]], '南北通り ' + (i + 3), '#a28a62', '街路');
    }
    const plaza = step * .33;
    add('region', [[-plaza, -plaza], [plaza, -plaza], [plaza, plaza], [-plaza, plaza]], options.name + ' 中央広場', '#c9b891', '広場');
    const lots = [];
    for (let y = -11; y <= 11; y++) for (let x = -11; x <= 11; x++) {
      const px = x * step / 3 + step / 6, py = y * step / 3 + step / 6;
      if (Math.abs(px) < plaza * 1.8 && Math.abs(py) < plaza * 1.8) continue;
      const streetDistance = v => Math.min(...[-3, -1.5, 0, 1.5, 3].map(s => Math.abs(v / step - s)));
      if (streetDistance(px) < .18 || streetDistance(py) < .18) continue;
      lots.push({ x: px, y: py, score: random() });
    }
    lots.sort((a, b) => a.score - b.score);
    const chosen = [];
    for (const lot of lots) {
      if (chosen.some(p => Math.abs(p.x - lot.x) < step * .325 && Math.abs(p.y - lot.y) < step * .325)) continue;
      chosen.push(lot); if (chosen.length >= count) break;
    }
    chosen.forEach((p, i) => {
      const s = step * (.12 + random() * .04);
      add('region', [[p.x - s, p.y - s], [p.x + s, p.y - s], [p.x + s, p.y + s], [p.x - s, p.y + s]], options.name + ' 建物 ' + (i + 1), '#aa8c75', '建物');
    });
    for (const [i, [x, y]] of [[-1, -1], [1, -1], [-1, 1], [1, 1]].entries()) {
      const x1 = x < 0 ? -half : 0, y1 = y < 0 ? -half : 0;
      add('region', [[x1, y1], [x1 + half, y1], [x1 + half, y1 + half], [x1, y1 + half]], options.name + ' 街区 ' + (i + 1), '#bbc1ab', '街区');
    }
    // Streets/buildings must draw above the broad district fills in this layer.
    result.sort((a, b) => Number(a.tags[0] !== '街区') - Number(b.tags[0] !== '街区'));
    return { features: result, detail: `10街路・4街区・1広場・${chosen.length}建物（希望${count}）。地図中央に配置します。` };
  }
  function prepare(source, kind, options) {
    const doc = D.parse(source);
    if (!Object.hasOwn(names, kind) || doc.coordinate_system !== 'local') throw new Error('創作地図で実行してください');
    if (typeof options.seed !== 'string' || !options.seed.trim() || options.seed.length > 128 || typeof options.name !== 'string' || !options.name.trim() || options.name.length > 64) throw new Error('シードと名前を入力してください');
    if (kind !== 'town' && !doc.terrain) throw new Error('先に地形を生成してください');
    const plan = ({ nations, vegetation, town })[kind](doc, options);
    const layer = { id: D.id(), name: options.name.trim() + '（生成）', visible: true, locked: false, opacity: kind === 'town' ? 1 : .65,
      generation: { ...D.clone(options), kind, generator_version: 1 } };
    const features = plan.features.map(f => ({ ...D.feature(f.kind, f.points, layer.id, f.label), ...f }));
    if (doc.layers.length >= 100 || doc.features.length + features.length > 10000
      || doc.features.concat(features).reduce((sum, f) => sum + f.points.length, 0) > 100000) throw new Error('レイヤー・図形・頂点の上限を超えます。生成数を減らすか、地図の図形を整理してください');
    doc.layers.push(layer); doc.features.push(...features);
    D.parse(JSON.stringify(doc, null, 2));
    return { plan, draft: { layer, features }, doc };
  }
  function show(app, kind) {
    app._commitInput(); if (app._inputDirty) throw new Error('入力内容を確認してください');
    const canEdit = app._editGuard(), store = app.store, path = app.path;
    if (!canEdit() || store.doc.coordinate_system !== 'local') throw new Error('編集できる創作地図で実行してください');
    app._worldPreview?.destroy(); app._climatePreview?.destroy(); app._settlementsPreview?.destroy(); app._generatorPreview?.destroy();
    const panel = document.createElement('div'); panel.className = 'gb-map-generator'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', names[kind] + '生成のプレビュー');
    const heading = document.createElement('h3'); heading.textContent = names[kind] + 'の下案を生成'; panel.appendChild(heading);
    const help = document.createElement('p'); help.textContent = kind === 'town' ? '地図中央へ街路・街区・建物を配置します。画像・地形へは自動で合わせません。子地図でも利用できます。' : 'シードから創作用の領域を作成します。区画中央で海陸を判定し、既存の領域は残します。'; panel.appendChild(help);
    let preview = null, prepared = null, source = null, signature = '', pending = false;
    const controls = {}, previous = [...store.doc.layers].reverse().find(l => l.generation?.kind === kind)?.generation || {};
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '条件を設定してプレビューしてください。';
    const canvas = document.createElement('div'); canvas.className = 'gb-map-generator-preview';
    const clear = () => { preview?.destroy(); preview = null; prepared = source = null; adopt.disabled = true; canvas.replaceChildren(); };
    const input = (key, label, value, attributes = {}) => {
      const wrap = document.createElement('label'); wrap.className = 'gb-map-field'; const text = document.createElement('span'); text.textContent = label;
      const control = document.createElement('input'); control.setAttribute('aria-label', label); control.required = true; Object.assign(control, attributes); control.value = previous[key] ?? value;
      control.oninput = control.onchange = () => { clear(); status.textContent = '条件が変わりました。プレビューを作り直してください。'; };
      controls[key] = control; wrap.append(text, control); panel.appendChild(wrap);
    };
    input('seed', '生成のシード', kind, { maxLength: 128 }); input('name', '生成する名前', names[kind], { maxLength: 64 });
    const number = (key, label, value, min, max, step = 1) => input(key, label, value, { type: 'number', min, max, step });
    if (kind === 'nations') { number('count', '国家数', 6, 1, 32); number('columns', '横の区画数', 32, 8, 64); }
    if (kind === 'vegetation') {
      number('warmth', '暖かさ（0〜100）', 60, 0, 100, 'any'); number('wetness', '湿り気（0〜100）', 55, 0, 100, 'any');
      number('equator', '赤道の位置（北端から%）', 50, 0, 100, 'any'); number('columns', '横の区画数', 16, 4, 32);
    }
    if (kind === 'town') { number('count', '建物数', 80, 8, 200); number('angle', '街路の角度（度）', 0, -180, 180, 'any'); }
    const options = () => Object.fromEntries(Object.entries(controls).map(([k, c]) => [k, c.type === 'number' ? Number(c.value) : c.value]));
    const conditions = () => JSON.stringify(Object.values(controls).map(c => c.value));
    const current = () => panel.isConnected && canEdit() && app.path === path && app.store === store && app._active !== false;
    const cleanup = () => { MeldexMapChrome.closePanel(panel); preview?.destroy(); panel.remove(); if (app._worldPreview?.panel === panel) app._worldPreview = null; };
    const generate = app._button(names[kind] + 'をプレビュー', () => {
      if (pending || !current() || !Object.values(controls).every(c => c.reportValidity())) return;
      clear();
      try {
        source = store.doc; prepared = prepare(source, kind, options()); signature = conditions();
        preview = new MeldexMapView(canvas, { action: () => {}, select: () => {} }); preview.setDocument(prepared.doc, true);
        status.textContent = prepared.plan.detail + ` ${prepared.draft.features.length}図形。元の地図はまだ変更していません。`;
        adopt.disabled = !prepared.draft.features.length;
      } catch (error) { clear(); status.textContent = error.message; }
    });
    const adopt = app._button(names[kind] + 'を新しいレイヤーへ追加', async () => {
      if (pending || !current() || !prepared) return;
      const result = prepared, original = source, settings = signature;
      const unchanged = () => store.doc === original && !app._inputDirty && conditions() === settings;
      if (!unchanged()) { clear(); status.textContent = '地図または条件が変更されました。プレビューを作り直してください。'; return; }
      pending = true; adopt.disabled = true; generate.disabled = true;
      try {
        const access = await MeldexEntityDetail.resolveReadOnly(path, false);
        if (!current() || prepared !== result) return;
        if (access.readOnly || !unchanged()) { clear(); status.textContent = access.readOnly ? (access.reason || 'このマップは編集できません') : '地図または条件が変更されました。プレビューを作り直してください。'; return; }
        if (app.update(doc => { doc.layers.push(result.draft.layer); doc.features.push(...result.draft.features); })) {
          app._activeLayer = result.draft.layer.id; cleanup(); app._render(); app._message(names[kind] + 'の下案を追加しました');
        }
      } catch (error) { if (current()) status.textContent = '追加できません: ' + error.message; }
      finally { pending = false; generate.disabled = false; adopt.disabled = !prepared; }
    }, { disabled: true });
    panel.append(status, canvas, generate, adopt, app._button('閉じる', cleanup));
    app._worldPreview = { panel, destroy: cleanup }; MeldexMapChrome.openPanel(panel); controls.seed.focus();
  }
  return Object.freeze({ prepare, show });
});
