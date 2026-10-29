/* Creative climate drafts are ordinary editable regions, not live weather data. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./gb-map-document.js') : root.MeldexMapDocument);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeldexMapClimate = api;
})(globalThis, function (D) {
  'use strict';
  const types = Object.freeze([
    { key: 'polar', name: '寒帯', color: '#c1dce5' }, { key: 'cold', name: '亜寒帯', color: '#739d9e' },
    { key: 'temperate', name: '温帯', color: '#8cae6f' }, { key: 'tropical', name: '熱帯', color: '#31966f' },
    { key: 'dry', name: '乾燥帯', color: '#d5b775' }, { key: 'alpine', name: '高山帯', color: '#aaa3ae' },
  ].map(Object.freeze));
  function generate(source, options) {
    const doc = D.parse(source), { seed, warmth, wetness, equator, columns, name } = options;
    if (doc.coordinate_system !== 'local' || !doc.terrain) throw new Error('創作地図で地形を生成してから気候帯の下案を作成してください');
    if (typeof seed !== 'string' || !seed.trim() || seed.length > 128 || typeof name !== 'string' || !name.trim() || name.length > 64
      || ![warmth, wetness, equator].every(value => Number.isFinite(value) && value >= 0 && value <= 100)
      || !Number.isInteger(columns) || columns < 4 || columns > 32) throw new Error('気候帯生成の条件を確認してください');
    if (doc.layers.length >= 100 || doc.features.length >= 10000) throw new Error('レイヤーまたは図形の上限に達しています');
    let state = 2166136261;
    for (const character of seed) state = Math.imul(state ^ character.codePointAt(0), 16777619) >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const phases = [random() * Math.PI * 2, random() * Math.PI * 2];
    const rows = Math.max(4, Math.min(24, Math.round(columns * doc.canvas.height / doc.canvas.width)));
    const terrain = doc.terrain, angle = ((doc.scale.north_degrees % 360 + 360) % 360) * Math.PI / 180;
    const sx = Math.sin(angle), sy = -Math.cos(angle), extent = (Math.abs(sx) * doc.canvas.width + Math.abs(sy) * doc.canvas.height) / 2;
    const sample = (x, y) => {
      const gx = Math.min(terrain.cols - 1, x * terrain.cols), gy = Math.min(terrain.rows - 1, y * terrain.rows);
      const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const get = (cx, cy) => terrain.heights[Math.min(terrain.rows - 1, cy) * terrain.cols + Math.min(terrain.cols - 1, cx)];
      return get(ix, iy) * (1 - fx) * (1 - fy) + get(ix + 1, iy) * fx * (1 - fy) + get(ix, iy + 1) * (1 - fx) * fy + get(ix + 1, iy + 1) * fx * fy;
    };
    const cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const nx = (x + 0.5) / columns, ny = (y + 0.5) / rows, height = sample(nx, ny);
      if (height < 0.035) { cells.push(null); continue; }
      const northness = ((nx - 0.5) * doc.canvas.width * sx + (ny - 0.5) * doc.canvas.height * sy) / extent;
      const latitude = Math.abs((1 - northness) / 2 - equator / 100) / Math.max(equator / 100, 1 - equator / 100);
      const heat = warmth / 100 * 0.85 + 0.25 - latitude * 0.8 - Math.max(0, height) * 0.4;
      const moisture = wetness / 100 + 0.3 * Math.sin(nx * Math.PI * 4 + phases[0]) * Math.cos(ny * Math.PI * 3 + phases[1]) - height * 0.1;
      cells.push(height > 0.7 ? 'alpine' : heat < 0.18 ? 'polar' : moisture < 0.28 ? 'dry' : heat > 0.58 ? 'tropical' : heat < 0.36 ? 'cold' : 'temperate');
    }
    const rectangles = []; let active = new Map();
    for (let y = 0; y < rows; y++) {
      const next = new Map();
      for (let x = 0; x < columns;) {
        const kind = cells[y * columns + x], start = x++;
        while (x < columns && cells[y * columns + x] === kind) x++;
        if (!kind) continue;
        const key = kind + ':' + start + ':' + x, previous = active.get(key);
        const rectangle = previous || { kind, x1: start, x2: x, y1: y, y2: y + 1 };
        if (previous) previous.y2 = y + 1; else rectangles.push(rectangle);
        next.set(key, rectangle);
      }
      active = next;
    }
    if (doc.features.length + rectangles.length > 10000 || doc.features.reduce((sum, feature) => sum + feature.points.length, 0) + rectangles.length * 4 > 100000) throw new Error('図形または頂点の上限を超えます。区画数を減らすか地図の図形を整理してください');
    const names = new Set(doc.features.map(feature => feature.label)), counters = new Map();
    const regions = rectangles.map(rectangle => {
      const type = types.find(item => item.key === rectangle.kind); let number = counters.get(type.key) || 1;
      while (names.has(type.name + ' ' + number)) number++;
      const label = type.name + ' ' + number; names.add(label); counters.set(type.key, number + 1);
      const x1 = rectangle.x1 / columns * doc.canvas.width, x2 = rectangle.x2 / columns * doc.canvas.width;
      const y1 = rectangle.y1 / rows * doc.canvas.height, y2 = rectangle.y2 / rows * doc.canvas.height;
      return { key: type.key, label, color: type.color, points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]] };
    });
    return { seed, warmth, wetness, equator, columns, rows, name: name.trim(), north_degrees: doc.scale.north_degrees, cells, regions,
      summary: types.map(type => ({ ...type, cells: cells.filter(key => key === type.key).length })).filter(type => type.cells) };
  }
  function materialize(plan) {
    const layer = { id: D.id(), name: plan.name + '（生成）', visible: true, locked: false, opacity: 0.85,
      generation: { kind: 'climate', generator_version: 1, seed: plan.seed, warmth: plan.warmth, wetness: plan.wetness,
        equator: plan.equator, columns: plan.columns, name: plan.name, north_degrees: plan.north_degrees } };
    const features = plan.regions.map(region => ({ ...D.feature('region', region.points, layer.id, region.label), color: region.color,
      description: '区画中央の地形から分類した創作用の気候帯下案', tags: ['気候', types.find(type => type.key === region.key).name] }));
    return { layer, features };
  }
  function prepare(source, options) {
    const plan = generate(source, options), draft = materialize(plan), doc = D.clone(source);
    doc.layers.push(draft.layer); doc.features.push(...draft.features);
    // Use the actual pretty-printed storage representation, including the
    // existing image/text payload, before enabling adoption.
    D.parse(JSON.stringify(doc, null, 2));
    return { plan, draft, doc };
  }
  function show(app) {
    app._commitInput(); if (app._inputDirty) throw new Error('入力内容を確認してください');
    if (app._climatePreview?.panel.isConnected) { app._climatePreview.panel.querySelector('input')?.focus(); return; }
    if (app.editingDisabled || app.store.doc.coordinate_system !== 'local') throw new Error('編集できる創作地図で実行してください');
    app._worldPreview?.destroy(); app._generatorPreview?.destroy(); app._settlementsPreview?.destroy();
    const store = app.store, canEdit = app._editGuard(), path = app.path;
    const previous = [...store.doc.layers].reverse().find(layer => layer.generation?.kind === 'climate' && layer.generation.generator_version === 1)?.generation;
    const panel = document.createElement('div'); panel.className = 'gb-map-generator'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '気候帯生成のプレビュー');
    const title = document.createElement('h3'); title.textContent = '気候帯の下案を生成';
    const help = document.createElement('p'); help.textContent = '区画中央の地形と地図の北方向を使って分類します。海岸の形には一致しません。確認後に編集できる領域として追加します。'; panel.append(title, help);
    let source = null, draft = null, preview = null, configuration = '', pending = false;
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '条件を設定してプレビューしてください。';
    const clear = () => { source = null; draft = null; configuration = ''; adopt.disabled = true; preview?.destroy(); preview = null; canvas.replaceChildren(); legend.replaceChildren(); };
    const input = (labelText, value, attributes = {}) => {
      const label = document.createElement('label'); label.className = 'gb-map-field'; const text = document.createElement('span'); text.textContent = labelText;
      const control = document.createElement('input'); control.setAttribute('aria-label', labelText); control.required = true; Object.assign(control, attributes); control.value = value;
      control.oninput = control.onchange = () => { clear(); status.textContent = '条件が変わりました。プレビューを作り直してください。'; };
      label.append(text, control); panel.appendChild(label); return control;
    };
    const seed = input('気候帯のシード', typeof previous?.seed === 'string' ? previous.seed : 'climate', { maxLength: 128 });
    const number = (label, key, fallback, min = 0, max = 100, step = 'any') => input(label, Number.isFinite(previous?.[key]) ? previous[key] : fallback, { type: 'number', min, max, step });
    const warmth = number('暖かさ（0〜100）', 'warmth', 60), wetness = number('湿り気（0〜100）', 'wetness', 55);
    const equator = number('赤道の位置（北端から%）', 'equator', 50), columns = number('横の区画数', 'columns', 16, 4, 32, 1);
    const name = input('気候レイヤーの名前', typeof previous?.name === 'string' ? previous.name : '気候', { maxLength: 64 });
    const conditions = () => JSON.stringify([seed.value, warmth.value, wetness.value, equator.value, columns.value, name.value]);
    const canvas = document.createElement('div'); canvas.className = 'gb-map-generator-preview';
    const legend = document.createElement('div'); legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', '気候帯の凡例'); legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px;margin:8px 0';
    const current = () => panel.isConnected && canEdit() && app.store === store && app.path === path && app._active !== false;
    const cleanup = () => { MeldexMapChrome.closePanel(panel); preview?.destroy(); preview = null; panel.remove(); if (app._climatePreview?.panel === panel) app._climatePreview = null; };
    const generateButton = app._button('気候帯をプレビュー', () => {
      if (pending || !current() || ![seed, warmth, wetness, equator, columns, name].every(control => control.reportValidity())) return;
      clear();
      try {
        source = store.doc;
        const prepared = prepare(source, { seed: seed.value, warmth: Number(warmth.value), wetness: Number(wetness.value), equator: Number(equator.value), columns: Number(columns.value), name: name.value });
        const { plan, doc } = prepared; draft = prepared.draft; configuration = conditions();
        preview = new MeldexMapView(canvas, { action: () => {}, select: () => {} }); preview.setDocument(doc, true);
        const land = plan.summary.reduce((sum, type) => sum + type.cells, 0);
        for (const type of plan.summary) {
          const item = document.createElement('span'), swatch = document.createElement('span'); swatch.style.cssText = 'display:inline-block;width:12px;height:12px;margin-right:4px'; swatch.style.backgroundColor = type.color;
          item.append(swatch, document.createTextNode(type.name + ' 約' + Math.round(type.cells / land * 100) + '%')); legend.appendChild(item);
        }
        status.textContent = `${plan.columns}×${plan.rows}区画から${draft.features.length}領域。北方向${plan.north_degrees}°。` + (land ? '元の地図はまだ変更していません。' : '区画中央に陸地がありません。地形や区画数を調整してください。');
        adopt.disabled = !draft.features.length;
      } catch (error) { clear(); status.textContent = error.message; }
    });
    const adopt = app._button('気候帯を新しいレイヤーへ追加', async () => {
      if (pending || !current() || !draft) return;
      if (store.doc !== source || app._inputDirty || conditions() !== configuration) { clear(); status.textContent = '地図または条件が変更されました。プレビューを作り直してください。'; return; }
      const result = draft, original = source, settings = configuration; pending = true; adopt.disabled = true; generateButton.disabled = true;
      try {
        const access = await MeldexEntityDetail.resolveReadOnly(path, false);
        if (!current() || draft !== result) return;
        if (access.readOnly) { clear(); status.textContent = access.reason || 'このマップは編集できません'; return; }
        if (store.doc !== original || app._inputDirty || conditions() !== settings) { clear(); status.textContent = '地図または条件が変更されました。プレビューを作り直してください。'; return; }
        if (app.update(doc => { doc.layers.push(result.layer); doc.features.push(...result.features); })) { app._activeLayer = result.layer.id; cleanup(); app._render(); app._message(result.features.length + '領域の気候帯を追加しました'); }
      } catch (error) { if (current()) status.textContent = '追加できません: ' + error.message; }
      finally { pending = false; adopt.disabled = !draft; generateButton.disabled = false; }
    }, { disabled: true });
    panel.append(status, legend, canvas, generateButton, adopt, app._button('閉じる', cleanup));
    app._climatePreview = { panel, destroy: cleanup }; MeldexMapChrome.openPanel(panel); seed.focus();
  }
  return Object.freeze({ types, generate, materialize, prepare, show });
});
