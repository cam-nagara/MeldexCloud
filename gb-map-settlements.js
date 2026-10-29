/* Deterministic city drafts use ordinary layers and pins, preserving old readers. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./gb-map-document.js') : root.MeldexMapDocument);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeldexMapSettlements = api;
})(globalThis, function (D) {
  'use strict';
  function generate(source, options) {
    const doc = D.parse(source), { seed, count, spacing, prefix, color } = options;
    if (doc.coordinate_system !== 'local' || !doc.terrain) throw new Error('創作地図で地形を生成してから都市候補を作成してください');
    if (typeof seed !== 'string' || !seed.trim() || seed.length > 128 || !Number.isInteger(count) || count < 1 || count > 100
      || !Number.isFinite(spacing) || spacing < 1 || spacing > 1e7 || typeof prefix !== 'string' || !prefix.trim() || prefix.length > 64
      || typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) throw new Error('都市生成の条件を確認してください');
    if (doc.layers.length >= 100 || doc.features.length >= 10000) throw new Error('レイヤーまたは図形の上限に達しています');
    let state = 2166136261;
    for (const character of seed) state = Math.imul(state ^ character.codePointAt(0), 16777619) >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const { cols, rows, heights } = doc.terrain, candidates = [];
    for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols - 1; x++) {
      // Four corners bound the interpolated centre shown by the renderer.
      const corners = [heights[y * cols + x], heights[y * cols + x + 1], heights[(y + 1) * cols + x], heights[(y + 1) * cols + x + 1]];
      const low = Math.min(...corners), high = Math.max(...corners);
      if (low < 0.035 || high > 0.65 || high - low > 0.35) continue;
      candidates.push({ point: [(x + 0.5) / cols * doc.canvas.width, (y + 0.5) / rows * doc.canvas.height],
        score: random() * 0.6 + (0.5 - (low + high) / 2) * 0.8 - (high - low) * 0.4 });
    }
    candidates.sort((a, b) => b.score - a.score || a.point[1] - b.point[1] || a.point[0] - b.point[0]);
    const buckets = new Map(), add = point => {
      const key = Math.floor(point[0] / spacing) + ',' + Math.floor(point[1] / spacing);
      if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(point);
    };
    doc.features.filter(feature => feature.kind === 'pin').forEach(feature => add(feature.points[0]));
    const available = point => {
      const bx = Math.floor(point[0] / spacing), by = Math.floor(point[1] / spacing);
      for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++) {
        if ((buckets.get(x + ',' + y) || []).some(other => (point[0] - other[0]) ** 2 + (point[1] - other[1]) ** 2 < spacing ** 2)) return false;
      }
      return true;
    };
    const selected = [], names = new Set(doc.features.map(feature => feature.label)); let sequence = 1;
    for (const candidate of candidates) {
      if (!available(candidate.point)) continue;
      while (names.has(prefix.trim() + ' ' + sequence)) sequence++;
      const label = prefix.trim() + ' ' + sequence++; names.add(label);
      selected.push({ point: candidate.point, label }); add(candidate.point);
      if (selected.length >= Math.min(count, 10000 - doc.features.length)) break;
    }
    return { seed, count, spacing, prefix: prefix.trim(), color, candidates: selected };
  }
  function materialize(plan) {
    const layer = { id: D.id(), name: plan.prefix + '（生成）', visible: true, locked: false, opacity: 1,
      generation: { kind: 'settlements', generator_version: 1, seed: plan.seed, count: plan.count, spacing: plan.spacing, prefix: plan.prefix, color: plan.color } };
    const features = plan.candidates.map(candidate => ({ ...D.feature('pin', [candidate.point], layer.id, candidate.label),
      icon: 'city', color: plan.color, tags: ['都市'], description: '地形から生成した都市候補' }));
    return { layer, features };
  }
  function show(app) {
    app._commitInput();
    if (app._inputDirty) throw new Error('入力内容を確認してから都市を生成してください');
    if (app._settlementsPreview?.panel.isConnected) { app._settlementsPreview.panel.querySelector('input')?.focus(); return; }
    if (app.editingDisabled || app.store.doc.coordinate_system !== 'local') throw new Error('編集できる創作地図で実行してください');
    app._worldPreview?.destroy(); app._generatorPreview?.destroy(); app._climatePreview?.destroy();
    const store = app.store, canEdit = app._editGuard(), path = app.path;
    const panel = document.createElement('div'); panel.className = 'gb-map-generator'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '都市生成のプレビュー');
    const heading = document.createElement('h3'); heading.textContent = '都市候補を生成';
    const help = document.createElement('p'); help.textContent = '生成・手描きした地形の陸地から、低めで平坦な場所を選びます。既存の地点との間隔を保ち、確認後に新しいレイヤーへ追加します。'; panel.append(heading, help);
    const previous = [...store.doc.layers].reverse().find(layer => layer.generation?.kind === 'settlements' && layer.generation.generator_version === 1)?.generation;
    let source = null, draft = null, preview = null, previewConditions = '', pending = false;
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = '条件を設定し、プレビューを作成してください。';
    const clear = () => { source = null; draft = null; previewConditions = ''; adopt.disabled = true; preview?.destroy(); preview = null; canvas.replaceChildren(); };
    const input = (name, value, attributes = {}) => {
      const label = document.createElement('label'); label.className = 'gb-map-field';
      const caption = document.createElement('span'); caption.textContent = name;
      const control = document.createElement('input'); control.setAttribute('aria-label', name); Object.assign(control, attributes); control.value = value;
      control.oninput = control.onchange = () => { clear(); status.textContent = '条件が変わりました。プレビューを作り直してください。'; };
      label.append(caption, control); panel.appendChild(label); return control;
    };
    const seed = input('都市生成のシード', typeof previous?.seed === 'string' ? previous.seed : 'cities', { maxLength: 128 });
    const count = input('生成する都市数', Number.isInteger(previous?.count) ? previous.count : 20, { type: 'number', min: 1, max: 100, step: 1 });
    const spacing = input('最小間隔（地図単位）', Number.isFinite(previous?.spacing) ? previous.spacing : Math.round(Math.hypot(store.doc.canvas.width, store.doc.canvas.height) / 15), { type: 'number', min: 1, max: 1e7, step: 'any' });
    const prefix = input('都市名の接頭辞', typeof previous?.prefix === 'string' ? previous.prefix : '都市', { maxLength: 64 });
    const color = input('都市の色', previous?.color || app.colorInput.value, { type: 'color' });
    const canvas = document.createElement('div'); canvas.className = 'gb-map-generator-preview';
    const conditions = () => JSON.stringify([seed.value, count.value, spacing.value, prefix.value, color.value]);
    const current = () => panel.isConnected && canEdit() && app.store === store && app.path === path && app._active !== false;
    const cleanup = () => { MeldexMapChrome.closePanel(panel); preview?.destroy(); preview = null; panel.remove(); if (app._settlementsPreview?.panel === panel) app._settlementsPreview = null; };
    const generateButton = app._button('都市候補をプレビュー', () => {
      if (pending || !current() || ![seed, count, spacing, prefix, color].every(control => control.reportValidity())) return;
      clear();
      try {
        source = store.doc;
        const plan = generate(source, { seed: seed.value, count: Number(count.value), spacing: Number(spacing.value), prefix: prefix.value, color: color.value });
        draft = materialize(plan);
        previewConditions = conditions();
        const doc = D.clone(source); doc.layers.push(draft.layer); doc.features.push(...draft.features);
        preview = new MeldexMapView(canvas, { action: () => {}, select: () => {} }); preview.setDocument(doc, true);
        status.textContent = `${draft.features.length}/${plan.count}件の都市候補を配置できます。` + (draft.features.length < plan.count ? '陸地・間隔・図形上限の条件により希望数に届いていません。' : '') + ' 元の地図はまだ変更していません。';
        adopt.disabled = !draft.features.length;
      } catch (error) { clear(); status.textContent = error.message; }
    });
    const adopt = app._button('都市を新しいレイヤーへ追加', async () => {
      if (pending || !current() || !draft) return;
      if (conditions() !== previewConditions) { clear(); status.textContent = '条件が変わりました。プレビューを作り直してください。'; return; }
      if (store.doc !== source || app._inputDirty) { clear(); status.textContent = '地図が変更されました。プレビューを作り直してください。'; return; }
      const result = draft, original = source, configuration = previewConditions;
      pending = true; adopt.disabled = true; generateButton.disabled = true;
      try {
        const access = await MeldexEntityDetail.resolveReadOnly(path, false);
        if (!current() || draft !== result) return;
        if (access.readOnly) { clear(); status.textContent = access.reason || 'このマップは編集できません'; return; }
        if (store.doc !== original || app._inputDirty || conditions() !== configuration) {
          clear(); status.textContent = '地図または条件が変更されました。プレビューを作り直してください。'; return;
        }
        if (app.update(doc => { doc.layers.push(result.layer); doc.features.push(...result.features); })) {
          app._activeLayer = result.layer.id; cleanup(); app._render(); app._message(result.features.length + '件の都市候補を追加しました');
        }
      } catch (error) { if (current()) status.textContent = '追加できません: ' + error.message; }
      finally { pending = false; adopt.disabled = !draft; generateButton.disabled = false; }
    }, { disabled: true });
    panel.append(status, canvas, generateButton, adopt, app._button('閉じる', cleanup));
    app._settlementsPreview = { panel, destroy: cleanup }; MeldexMapChrome.openPanel(panel); seed.focus();
  }
  return Object.freeze({ generate, materialize, show });
});
