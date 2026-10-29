/* Scoped controls; values from files are always assigned as text/value. */
const MeldexMapControls = (() => {
  const D = () => MeldexMapDocument;
  function field(app, parent, label, value, apply, options = {}) {
    const wrap = document.createElement('label'); wrap.className = 'gb-map-field';
    const caption = document.createElement('span'); caption.textContent = label;
    const input = document.createElement(options.multiline ? 'textarea' : 'input');
    input.className = options.multiline ? 'gb-textarea' : options.type === 'number' ? 'gb-input gb-num-input' : 'gb-input';
    if (!options.multiline) input.type = options.type || 'text';
    input.value = value ?? ''; input.disabled = options.disabled ?? app.editingDisabled; input.setAttribute('aria-label', label);
    if (options.min != null) input.min = options.min;
    if (options.max != null) input.max = options.max;
    if (options.step != null) input.step = options.step;
    input.dataset.mapField = 'true';
    input.addEventListener('input', () => { if (options.transient !== true) app._inputDirty = true; });
    input.addEventListener('change', () => {
      if (!input.checkValidity()) { input.reportValidity(); return; }
      apply(input.value); if (options.transient !== true) app._inputDirty = false;
    });
    wrap.append(caption, input);
    if (options.type === 'color') {
      input.hidden = true;
      const swatch = app._button(label + 'を選択', event => {
        const selected = app._selected, canEdit = app._editGuard(selected);
        openColorPalette(event.currentTarget, input.value, value => {
          if (!canEdit() || app._selected !== selected) return;
          input.value = value; apply(value);
        }, { allowTransparent: false });
      }, { disabled: input.disabled });
      swatch.className = 'gb-color-swatch'; swatch.textContent = ''; swatch.title = label + 'を選択'; swatch.style.backgroundColor = input.value; swatch.setAttribute('aria-label', label + 'を選択');
      wrap.appendChild(swatch);
    }
    parent.appendChild(wrap); return input;
  }
  function select(parent, label, choices, value, apply, disabled = false) {
    const wrap = document.createElement('label'); wrap.className = 'gb-map-field';
    const caption = document.createElement('span'); caption.textContent = label;
    const control = document.createElement('select'); control.className = 'gb-select'; control.setAttribute('aria-label', label); control.disabled = disabled;
    for (const [key, text] of choices) control.add(new Option(text, key));
    control.value = value; control.onchange = () => apply(control.value);
    wrap.append(caption, control); parent.appendChild(wrap); return control;
  }
  function settings(app) {
    const root = app.settings, doc = app.store.doc;
    const canEdit = app._editGuard();
    select(root, '地図の種類', [['local', '創作地図'], ['world', '現実の地図']], doc.coordinate_system, async value => {
      if (value === app.store.doc.coordinate_system) return;
      if ((app.store.doc.features.length || app.store.doc.terrain || app.store.doc.background) && !await cfConfirm('座標の異なる地図へ切り替えると、現在の地形と図形を置き換えます。続けますか？（元に戻せます）')) {
        root.querySelector('select').value = app.store.doc.coordinate_system; return;
      }
      if (!canEdit()) return;
      if (!app.update(next => { Object.assign(next, D().create(next.title, value)); delete next.saved_views; delete next.world_generation; })) return;
      app.state.mapViewport = null; app.state.mapLayerVisibility = {}; app.state.mapSearch = ''; app.state.mapFeatureKind = ''; app.state.mapSavedViewId = '';
      app.search.value = ''; app.kindFilter.value = ''; app._saveViewState();
      app._selected = null; app._activeLayer = 'places'; app.view.setTool('select'); app._buildSettingsRefresh(); app._render();
    }, app.editingDisabled);
    const world = document.createElement('div'); root.appendChild(world); app.worldControls.push(world);
    select(world, '背景地図', [['osm', 'OpenStreetMap'], ['gsi', '地理院（淡色）'], ['gsi-standard', '地理院（標準）'], ['blank', '背景なし']], doc.basemap === 'gsi' && doc.basemap_style === 'standard' ? 'gsi-standard' : doc.basemap, value => {
      app.update(next => { next.basemap = value === 'gsi-standard' ? 'gsi' : value; if (next.basemap === 'gsi') next.basemap_style = value === 'gsi-standard' ? 'standard' : 'pale'; }); app._render();
      if (value.startsWith('gsi') && !app.store.doc.features.length) app.view.map.setView([36, 138], 7);
    }, app.editingDisabled);
    const coords = document.createElement('div'); coords.className = 'gb-map-coordinate-input'; world.appendChild(coords);
    const longitude = field(app, coords, '経度', 139.76, () => {}, { type: 'number', min: -180, max: 180, step: 'any', disabled: false, transient: true });
    const latitude = field(app, coords, '緯度', 35.68, () => {}, { type: 'number', min: -85.051129, max: 85.051129, step: 'any', disabled: false, transient: true });
    world.appendChild(app._button('座標へ移動', () => { if (!longitude.reportValidity() || !latitude.reportValidity()) return; app.view.map.setView([Number(latitude.value), Number(longitude.value)], 13); }));
    const local = document.createElement('div'); root.appendChild(local); app.localControls.push(local);
    const imageInput = document.createElement('input'); imageInput.type = 'file'; imageInput.accept = 'image/png,image/jpeg,image/webp'; imageInput.hidden = true;
    imageInput.onchange = async () => {
      const file = imageInput.files[0]; imageInput.value = ''; if (!file) return;
      try {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('12MB以下のPNG・JPEG・WebP画像を選んでください');
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('画像を読み込めません')); reader.readAsDataURL(file); });
        const image = new Image(); image.src = data; await image.decode();
        if (!canEdit()) return;
        if (image.naturalWidth * image.naturalHeight > 64000000) throw new Error('画像は6400万画素以下にしてください');
        if ((app.store.doc.background || app.store.doc.terrain) && !await cfConfirm('現在の背景をこの画像に置き換えますか？ 地点・図形は保持されます。')) return;
        if (!canEdit()) return;
        app.update(next => {
          next.background = { data_url: data }; next.terrain = null;
          if (!next.features.length) { const ratio = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight)); next.canvas = { width: Math.max(128, Math.round(image.naturalWidth * ratio)), height: Math.max(128, Math.round(image.naturalHeight * ratio)) }; next.view = null; }
        });
        app._render(); app.view.fit();
      } catch (error) { app._message(error.message); }
    };
    local.append(imageInput, app._button('世界地図を生成', () => MeldexMapWorldGenerator.show(app), { disabled: app.editingDisabled }), app._button('地図画像を読み込む', () => imageInput.click(), { disabled: app.editingDisabled }), app._button('地形を生成', () => generator(app), { disabled: app.editingDisabled }),
      app._button('都市を生成', () => MeldexMapSettlements.show(app), { disabled: app.editingDisabled }),
      app._button('気候帯を生成', () => MeldexMapClimate.show(app), { disabled: app.editingDisabled }),
      ...[['nations', '国家を生成'], ['vegetation', '植生を生成'], ['town', '都市・集落の詳細図']].map(([kind, label]) => app._button(label, () => MeldexMapWorldBuilding.show(app, kind), { disabled: app.editingDisabled })));
    if (MeldexMapWorldGeography.validEnvironment(doc.terrain)) select(local, '地図の配色', MeldexMapWorldGenerator.presentations, doc.terrain.presentation || 'biomes',
      value => { app.update(next => { next.terrain.presentation = value; }); app._render(); }, app.editingDisabled);
    field(app, local, '100地図単位の距離', doc.scale.distance_per_unit === null ? '' : doc.scale.distance_per_unit * 100,
      value => { app.update(next => { next.scale.distance_per_unit = value === '' ? null : Number(value) / 100; }); app._render(); }, { type: 'number', min: 0.000001, step: 'any' });
    select(local, '距離の単位', [['km', 'km'], ['m', 'm'], ['mi', 'mile'], ['unit', '任意単位']], doc.scale.unit,
      value => { app.update(next => { next.scale.unit = value; }); app._render(); }, app.editingDisabled);
    field(app, local, '北方向（上から時計回りの角度）', doc.scale.north_degrees,
      value => { app.update(next => { next.scale.north_degrees = Number(value); if(next.terrain?.environment){delete next.terrain.environment;delete next.terrain.presentation;} }); app._buildSettingsRefresh(); app._render(); }, { type: 'number', min: -360, max: 360, step: 1 });
    const calibration = field(app, local, '計測線の実際の距離', '', () => {}, { type: 'number', min: 0.000001, step: 'any', transient: true });
    local.appendChild(app._button('計測線で縮尺を設定', () => {
      const points = app.view.draft;
      if (app.view.tool !== 'measure' || points.length < 2 || !Number(calibration.value) || !calibration.reportValidity()) { app._message('「計測」で2点以上を選び、実際の距離を入力してください'); return; }
      const units = D().distance(points, { ...app.store.doc, scale: { distance_per_unit: null } });
      if (!(units > 0)) { app._message('離れた2点を選んでください'); return; }
      app.update(next => { next.scale.distance_per_unit = Number(calibration.value) / units; });
      app._buildSettingsRefresh(); app._render(); app.view._draft();
    }, { disabled: app.editingDisabled }));
    const brush = field(app, local, '地形ブラシの半径', app.view?.brushSize || 70, value => { app.view.brushSize = Number(value); }, { type: 'number', min: 5, max: 1000, step: 5 });
    brush.dataset.mapBrush = 'true';
    const note = document.createElement('small'); note.textContent = '縮尺を設定すると、地図上の距離と縮尺バーに反映されます。'; local.appendChild(note);
    if(doc.world_generation&&!MeldexMapWorldGeography.validEnvironment(doc.terrain)){const hint=document.createElement('small');hint.textContent='地形・方角の編集後は気候と植生の配色を解除します。世界地図を再生成すると、水系や都市を含めて整合を取り直せます。';local.appendChild(hint);}
    app._buildSettingsRefresh = () => {
      app.localControls = app.localControls.filter(el => !root.contains(el)); app.worldControls = app.worldControls.filter(el => !root.contains(el));
      root.replaceChildren(); settings(app);
    };
  }
  function layers(app) {
    const root = app.layerList; root.replaceChildren();
    app.store.doc.layers.forEach((layer, index) => {
      const row = document.createElement('div'); row.className = 'gb-map-layer';
      const pick = app._button(layer.name, () => { app._activeLayer = layer.id; layers(app); }); pick.setAttribute('aria-pressed', String(layer.id === app._activeLayer)); row.appendChild(pick);
      const edit = mutator => { app.update(doc => mutator(doc.layers.find(l => l.id === layer.id))); app._render(); };
      for (const [key, label] of [['visible', '表示'], ['locked', 'ロック']]) {
        const wrap = document.createElement('label'), input = document.createElement('input'); wrap.className = 'gb-check'; input.type = 'checkbox'; input.checked = key === 'visible' ? app._layerVisible(layer) : layer[key]; input.disabled = key !== 'visible' && app.editingDisabled;
        input.setAttribute('aria-label', layer.name + 'の' + label); input.onchange = () => {
          if (key === 'visible') {
            if (app.editingDisabled) { (app.state.mapLayerVisibility ||= {})[layer.id] = input.checked; app._saveViewState(); app._render(); return; }
            if (app.state.mapLayerVisibility) delete app.state.mapLayerVisibility[layer.id]; app._saveViewState();
          }
          edit(next => { next[key] = input.checked; });
        }; wrap.append(input, document.createTextNode(label)); row.appendChild(wrap);
      }
      const opacity = document.createElement('input'); opacity.className = 'tb-range'; opacity.type = 'range'; opacity.min = 0; opacity.max = 1; opacity.step = 0.1; opacity.value = layer.opacity; opacity.disabled = app.editingDisabled;
      opacity.setAttribute('aria-label', layer.name + 'の不透明度'); opacity.onchange = () => edit(next => { next.opacity = Number(opacity.value); }); row.appendChild(opacity);
      const up = app._button('前面へ移動', () => {
        app.update(doc => { [doc.layers[index - 1], doc.layers[index]] = [doc.layers[index], doc.layers[index - 1]]; }); app._render();
      }, { disabled: app.editingDisabled || !index });
      up.className = 'tb-icon-btn'; up.innerHTML = lucide('arrowUp', 16); up.title = '前面へ移動'; up.setAttribute('aria-label', layer.name + 'を前面へ移動'); row.appendChild(up);
      const rename = app._button('名前を変更', async () => {
        const canEdit = app._editGuard();
        const name = await cfPrompt('レイヤー名', layer.name);
        if (canEdit() && name?.trim() && app.store.doc.layers.some(l => l.id === layer.id)) edit(next => { next.name = name.trim(); });
      }, { disabled: app.editingDisabled });
      rename.className = 'tb-icon-btn'; rename.innerHTML = lucide('pencil', 16); rename.title = '名前を変更'; rename.setAttribute('aria-label', layer.name + 'の名前を変更'); row.appendChild(rename); root.appendChild(row);
    });
  }
  function places(app) {
    app.placeList.replaceChildren();
    for (const f of app.store.doc.features.filter(f => app.view._visible(f))) {
      const row = app._button(f.label || '名前なし', () => { app._select(f.id); app.view.focus(f); });
      row.setAttribute('aria-pressed', String(app._selection?.has(f.id) || f.id === app._selected)); row.dataset.mapFeatureId = f.id; app.placeList.appendChild(row);
    }
    if (!app.placeList.children.length) app.placeList.textContent = '表示する地点・図形がありません';
  }
  function inspector(app) {
    const root = app.inspector; root.replaceChildren();
    const f = app.store.doc.features.find(item => item.id === app._selected);
    const title = document.createElement('h3'); title.textContent = '選択項目'; root.appendChild(title);
    if (!f) { const hint = document.createElement('p'); hint.textContent = '地点や図形を選択すると、名前・説明・関連資料を編集できます。'; root.appendChild(hint); return; }
    const locked = app.editingDisabled || app.store.doc.layers.find(l => l.id === f.layer_id)?.locked;
    MeldexMapPeriods.inspector(app, root, f);
    field(app, root, '名前', f.label, value => app._editFeature(next => { next.label = value; }), { disabled: locked });
    field(app, root, '説明', f.description, value => app._editFeature(next => { next.description = value; }), { multiline: true, disabled: locked });
    const tags = document.createElement('div'); tags.className = 'gb-map-field';
    const tagsTitle = document.createElement('span'); tagsTitle.textContent = 'タグ'; tags.appendChild(tagsTitle);
    const chips = document.createElement('div'); chips.className = 'gb-map-tag-chips'; tags.appendChild(chips);
    const canEdit = app._editGuard(f.id);
    for (const name of f.tags) {
      const chip = window.MeldexGlobalTags?.createTagChip?.({ id: name, name }, { compact: true,
        ...(!locked ? { onRemove: () => { if (canEdit() && app._selected === f.id) app._editFeature(next => { next.tags = next.tags.filter(tag => tag !== name); }); } } : {}) });
      if (chip) chips.appendChild(chip); else { const text = document.createElement('span'); text.textContent = name; chips.appendChild(text); }
    }
    const addTag = document.createElement('input'); addTag.className = 'gb-input'; addTag.setAttribute('aria-label', 'タグを追加'); addTag.placeholder = 'タグを追加'; addTag.disabled = locked; addTag.maxLength = 500;
    const commitTags = () => {
      const values = addTag.value.split(/[,、]/).map(t => t.trim()).filter(Boolean);
      if (!values.length || !canEdit() || app._selected !== f.id) return;
      app._editFeature(next => { next.tags = [...new Set([...next.tags, ...values])]; });
    };
    addTag.addEventListener('input', () => { app._inputDirty = !!addTag.value.trim(); });
    addTag.addEventListener('change', commitTags); addTag.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commitTags(); } });
    tags.appendChild(addTag); root.appendChild(tags);
    field(app, root, '色', f.color, value => app._editFeature(next => { next.color = value; }), { type: 'color', disabled: locked });
    select(root, '配置レイヤー', app.store.doc.layers.filter(l => !l.locked || l.id === f.layer_id).map(l => [l.id, l.name]), f.layer_id,
      value => app._editFeature(next => { next.layer_id = value; }), locked);
    if (f.points.length > 1) {
      const length = document.createElement('p'); length.textContent = '線の長さ: ' + D().distanceLabel(D().distance(D().drawPoints(f, app.store.doc), app.store.doc), app.store.doc); root.appendChild(length);
      root.appendChild(app._button(app.view.editVertices ? '頂点編集を終了' : '頂点を編集', () => { app.view.editVertices = !app.view.editVertices; app._setTool('select'); app._render(); }, { disabled: locked }));
    }
    if (f.kind === 'route') {
      select(root, '経路の形', [['straight', '折れ線'], ['curve', '曲線']], f.line_style || 'straight', value => app._editFeature(next => { next.line_style = value; }), locked);
      const wrap = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!f.arrow; input.disabled = locked;
      input.onchange = () => app._editFeature(next => { next.arrow = input.checked; }); wrap.append(input, document.createTextNode('終点に矢印を表示')); root.appendChild(wrap);
    }
    MeldexMapTravel.inspector(app, root, f, locked);
    const linksTitle = document.createElement('h4'); linksTitle.textContent = '関連するファイル・トピック'; root.appendChild(linksTitle);
    for (const link of f.links.filter(link => link.role !== 'child-map')) {
      const row = document.createElement('div'); row.className = 'gb-map-link-row';
      row.appendChild(app._button(link.label || link.path, async () => {
        const target = await GBLinkRouter.resolveAsync(link.path, { linkType: link.type || '' });
        return navOpen({ ...target, path: link.path, label: link.label || link.path });
      }));
      row.appendChild(app._button('解除', () => app._editFeature(next => { next.links = next.links.filter(l => l.path !== link.path); }), { disabled: locked })); root.appendChild(row);
    }
    if (typeof MeldexLinkModal !== 'undefined') root.appendChild(app._button('リンクする資料を選択', () => {
      const selected = f.id;
      const canEdit = app._editGuard(selected);
      MeldexLinkModal.show(null, link => {
        if (link.type !== 'file') { app._message('Meldex内のファイルまたはトピックを選んでください'); return; }
        if (!canEdit() || app._selected !== selected) return;
        app._editFeature(next => { if (!next.links.some(l => l.path === link.path)) next.links.push({ path: link.path, label: link.name, type: link.fileType }); });
      });
    }, { disabled: locked }));
    MeldexMapRelations.inspector(app, f, root, locked);
    if (app.store.doc.coordinate_system === 'world') root.appendChild(app._button('Googleマップで開く', () => {
      const [lng, lat] = f.points[0]; const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng);
      window.open(url, '_blank', 'noopener');
    }));
    root.appendChild(app._button('削除', async () => {
      const canEdit = app._editGuard(f.id);
      if (!await cfConfirm('選択した地点・図形を削除しますか？（元に戻せます）')) return;
      if (!canEdit()) return;
      app.update(doc => { doc.features = doc.features.filter(item => item.id !== f.id); }); app._selected = null; app._render();
    }, { disabled: locked }));
  }
  function generator(app) {
    app._commitInput(); if (app._inputDirty) throw new Error('入力内容を確認してください');
    if (app.editingDisabled || app.store.doc.coordinate_system !== 'local') throw new Error('編集できる創作地図で実行してください');
    app._settlementsPreview?.destroy(); app._climatePreview?.destroy(); app._worldPreview?.destroy();
    const canEdit = app._editGuard(), store = app.store, path = app.path;
    if (app._generator?.isConnected) { app._generator.querySelector('input')?.focus(); return; }
    const panel = document.createElement('div'); panel.className = 'gb-map-generator'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '地形生成のプレビュー');
    const title = document.createElement('h3'); title.textContent = '地形生成'; panel.appendChild(title);
    const seed = field(app, panel, 'シード', app.store.doc.terrain?.seed || String(Date.now()), () => {}, { disabled: false, transient: true });
    let template = app.store.doc.terrain?.template || 'continent';
    const templateInput = select(panel, '地形の種類', [['continent', '大陸'], ['island', '島'], ['archipelago', '群島']], template, value => { template = value; clear(); });
    const land = field(app, panel, '陸地の割合（%）', 45, () => {}, { type: 'number', min: 10, max: 80, step: 1, disabled: false, transient: true });
    const roughness = field(app, panel, '起伏（0〜100）', store.doc.terrain?.roughness ?? 50, () => {}, { type: 'number', min: 0, max: 100, step: 1, disabled: false, transient: true });
    const preview = document.createElement('div'); preview.className = 'gb-map-generator-preview'; panel.appendChild(preview);
    let candidate = null, previewView = null, source = null, signature = '', pending = false;
    const conditions = () => JSON.stringify([seed.value, templateInput.value, land.value, roughness.value]);
    const clear = () => { candidate = null; previewView?.destroy(); previewView = null; preview.replaceChildren(); adopt.disabled = true; };
    for (const input of [seed, land, roughness]) { input.required = true; input.addEventListener('input', clear); input.addEventListener('change', clear); }
    const cleanup = () => {
      MeldexMapChrome.closePanel(panel);
      previewView?.destroy(); previewView = null; panel.remove();
      if (app._generator === panel) app._generator = null;
      if (app._generatorPreview?.panel === panel) app._generatorPreview = null;
    };
    const generate = app._button('プレビュー', () => {
      if (pending || !canEdit() || ![seed, land, roughness].every(input => input.reportValidity())) return;
      clear(); source = store.doc;
      candidate = D().generate(seed.value, template, Number(land.value) / 100, Number(roughness.value)); signature = conditions();
      D().parse(JSON.stringify({ ...source, terrain: candidate, background: null }, null, 2));
      previewView?.destroy(); previewView = new MeldexMapView(preview, { action: () => {}, select: () => {} });
      previewView.setDocument({ ...source, terrain: candidate, background: null }, true);
      adopt.disabled = false;
    });
    const adopt = app._button('この地形を採用', async () => {
      if (pending || !candidate || !canEdit()) return;
      const result = candidate, original = source, settings = signature;
      const current = () => canEdit() && panel.isConnected && app.path === path && app._active !== false && store.doc === original && candidate === result && conditions() === settings && !app._inputDirty;
      if (!current()) { clear(); app._message('地図または条件が変更されました。プレビューを作り直してください。'); return; }
      pending = true; generate.disabled = adopt.disabled = true;
      try {
        if ((source.terrain || source.background) && !await cfConfirm('現在の背景をプレビューの地形へ置き換えますか？ 地点・図形は保持されます。')) return;
        if (!current()) return;
        const access = await MeldexEntityDetail.resolveReadOnly(path, false);
        if (!current()) return;
        if (access.readOnly) { app._message(access.reason || 'このマップは編集できません'); return; }
        if (app.update(doc => { doc.terrain = result; doc.background = null; })) { cleanup(); app._render(); }
      } finally { pending = false; generate.disabled = false; adopt.disabled = !candidate; }
    }, { disabled: true });
    panel.append(generate, adopt, app._button('閉じる', cleanup));
    app._generator = panel; MeldexMapChrome.openPanel(panel);
    app._generatorPreview = { panel, destroy: cleanup };
  }
  function interchange(app) {
    if (app._interchange?.panel.isConnected) { app._interchange.panel.querySelector('input')?.focus(); return; }
    const canEdit = app._editGuard(), store = app.store;
    const panel = document.createElement('div'); panel.className = 'gb-map-generator'; panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '地図データの入出力');
    const heading = document.createElement('h3'); heading.textContent = '地図データの入出力';
    const help = document.createElement('p'); help.textContent = 'CSVは地点・文字、GeoJSONは地点・経路・穴のない領域、GPXは地点・経路に対応します。GeoJSON・GPXは現実地図専用です。';
    const note = document.createElement('p'); note.textContent = '標高・時刻・外部リンク・独自属性は取り込みません。書き出しには非表示レイヤーも含みます。元の編集情報を保管する場合は「マップを書き出す」を使ってください。';
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,.geojson,.json,.gpx'; input.setAttribute('aria-label', '取り込む地図データ'); input.disabled = app.editingDisabled;
    const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'ファイルを選ぶと、取り込む内容を確認できます。';
    const list = document.createElement('ul');
    let plan = null, filename = '', reading = 0;
    const close = () => { reading++; MeldexMapChrome.closePanel(panel); panel.remove(); if (app._interchange?.panel === panel) app._interchange = null; };
    const adopt = app._button('新しいレイヤーへ取り込む', () => {
      if (!plan || !panel.isConnected || app.store !== store) return;
      if (plan.coordinate_system !== store.doc.coordinate_system) throw new Error('地図の種類が変わりました。ファイルを選び直してください');
      if (!canEdit()) return;
      const layer = { id: D().id(), name: filename.replace(/\.[^.]+$/, '').slice(0, 80) || '取込データ', visible: true, locked: false, opacity: 1 };
      const features = plan.features.map(f => ({ ...D().clone(f), layer_id: layer.id, id: D().id() }));
      const next = D().clone(store.doc); next.layers.push(layer); next.features.push(...features);
      D().parse(JSON.stringify(next));
      if (!app.update(doc => { doc.layers.push(layer); doc.features.push(...features); })) return;
      app._activeLayer = layer.id; app._selected = null; app.view.cancel(); app._render();
      app._message(`${features.length}件を新しいレイヤーへ取り込みました。元に戻せます。`); close();
    }, { disabled: true });
    input.onchange = async () => {
      const generation = ++reading, file = input.files[0]; input.value = ''; plan = null; adopt.disabled = true; list.replaceChildren();
      if (!file) return;
      status.textContent = '読み込んでいます…';
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('8MB以下のファイルを指定してください');
        const source = await file.text();
        if (generation !== reading || !canEdit() || !panel.isConnected) return;
        const format = file.name.split('.').pop().toLowerCase();
        plan = MeldexMapInterchange.read(source, format, store.doc.coordinate_system); filename = file.name;
        const counts = new Map(); plan.features.forEach(f => counts.set(f.kind, (counts.get(f.kind) || 0) + 1));
        status.textContent = `${plan.features.length}件（` + Array.from(counts, ([kind, count]) => ({ pin: '地点', label: '文字', route: '経路', region: '領域' })[kind] + count).join('・') + '）を新しいレイヤーへ追加します。現在の地形・図形は保持されます。';
        for (const f of plan.features.slice(0, 5)) { const li = document.createElement('li'); li.textContent = f.label || '名前なし'; list.appendChild(li); }
        adopt.disabled = false;
      } catch (error) { if (generation === reading && panel.isConnected) status.textContent = '取り込めません: ' + error.message; }
    };
    panel.append(heading, help, note, input, status, list, adopt);
    for (const [format, label] of [['csv', 'CSVを書き出す'], ['geojson', 'GeoJSONを書き出す'], ['gpx', 'GPXを書き出す']]) {
      panel.appendChild(app._button(label, async () => {
        app._commitInput();
        if (app._inputDirty) throw new Error('入力内容を確認してから書き出してください');
        const output = MeldexMapInterchange.write(store.doc, format), name = app.state.label;
        if (output.omitted && !await cfConfirm(`${format.toUpperCase()}に対応しない${output.omitted}件の図形を除いて書き出しますか？ 元のマップには残ります。`)) return;
        await MeldexExportSave.saveText(output.text, { initialfile: name + output.extension, extension: output.extension, mime: output.mime });
      }, { disabled: format !== 'csv' && store.doc.coordinate_system !== 'world' }));
    }
    panel.appendChild(app._button('閉じる', close)); MeldexMapChrome.openPanel(panel); app._interchange = { panel, destroy: close };
  }
  return Object.freeze({ settings, layers, places, inspector, generator, interchange });
})();
