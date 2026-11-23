/* Map hierarchy and sheet overlays reference existing documents and topics. */
const MeldexMapRelations = (() => {
  const D = () => MeldexMapDocument, LData = () => MeldexLocationData;
  const key = path => LData().canonicalPath(path, typeof state === 'undefined' ? '' : state.vaultPath).toLocaleLowerCase();
  function navigationGuard(app) {
    const store = app.store, generation = app._generation, path = app.path;
    return () => app.store === store && app._generation === generation && app.path === path && app._active !== false;
  }
  async function openChild(app, feature, link) {
    const current = navigationGuard(app);
    const trail = [...(app.state.mapTrail || []), { path: app.path, label: app.state.label, feature_id: feature.id }];
    if (trail.length > 32 || trail.some(item => key(item.path) === key(link.path))) throw new Error('循環した親子地図のため移動できません');
    if (!await app.flush()) throw new Error('親地図を保存してから開いてください');
    if (!current()) return false;
    if (!app.store.doc.features.some(item => item.id === feature.id && item.links.some(child => child.role === 'child-map' && key(child.path) === key(link.path)))) return false;
    await openMapApp(link.path, link.label, { paneId: app.paneId, mapTrail: trail });
  }
  function breadcrumbs(app, root) {
    const trail = Array.isArray(app.state.mapTrail) ? app.state.mapTrail : [];
    const parents = trail.length ? trail : app._directParents || [];
    for (const [index, parent] of parents.entries()) {
      root.appendChild(app._button('↩ ' + (parent.label || '親地図'), async () => {
        const current = navigationGuard(app);
        if (!await app.flush()) throw new Error('現在の地図を保存してから戻ってください');
        if (!current()) return false;
        if (!await openMapApp(parent.path, parent.label, { paneId: app.paneId, mapTrail: trail.length ? trail.slice(0, index) : [] })) return;
        forEachComponent(component => {
          if (component instanceof MapAppComponent && component._active && key(component.path) === key(parent.path)) {
            const feature = component.store?.doc.features.find(f => f.id === parent.feature_id);
            if (feature) { component._select(feature.id); component.view.focus(feature); }
          }
        });
      }));
    }
  }
  async function findParents(app) {
    if (app.state.mapTrail?.length) return;
    const store = app.store, generation = app._generation, path = app.path;
    const data = await apiFetch('/backlinks?target=' + encodeURIComponent(path));
    const paths = [...new Set((data.items || []).map(item => item.source_path).filter(source => source?.toLowerCase().endsWith('.mel-map')))].slice(0, 20);
    const results = await Promise.allSettled(paths.map(async parent => {
      const loaded = await apiFetch('/file?path=' + encodeURIComponent(parent)), doc = D().parse(loaded.content);
      const feature = doc.features.find(f => f.links.some(link => link.role === 'child-map' && key(link.path) === key(path)));
      return feature ? { path: parent, label: doc.display_title || doc.title, feature_id: feature.id } : null;
    }));
    if (app.store !== store || app._generation !== generation || app.state.mapTrail?.length) return;
    app._directParents = results.filter(result => result.status === 'fulfilled' && result.value).map(result => result.value);
    app.breadcrumbs.replaceChildren(); breadcrumbs(app, app.breadcrumbs);
  }
  async function wouldCycle(app, target) {
    const pending = [target], seen = new Set();
    while (pending.length) {
      const path = pending.pop(), normalized = key(path);
      if (normalized === key(app.path)) return true;
      if (seen.has(normalized)) continue;
      if (seen.size >= 64) throw new Error('親子関係が大きすぎるため確認できません。別の地図を選んでください');
      seen.add(normalized);
      const loaded = await apiFetch('/file?path=' + encodeURIComponent(path)), doc = D().parse(loaded.content);
      for (const feature of doc.features) for (const link of feature.links) if (link.role === 'child-map') pending.push(link.path);
    }
    return false;
  }
  function inspector(app, feature, root, locked) {
    const heading = document.createElement('h4'); heading.textContent = '子地図'; root.appendChild(heading);
    for (const link of feature.links.filter(link => link.role === 'child-map')) {
      const row = document.createElement('div'); row.className = 'gb-map-link-row';
      row.append(app._button(link.label || '子地図を開く', () => openChild(app, feature, link)),
        app._button('親子関係を解除', () => app._editFeature(next => { next.links = next.links.filter(item => item !== link && !(item.role === 'child-map' && item.path === link.path)); }), { disabled: locked })); root.appendChild(row);
    }
    const attach = async path => {
      path = LData().canonicalPath(path, state.vaultPath);
      const canEdit = app._editGuard(feature.id);
      if (await wouldCycle(app, path)) throw new Error('自分自身や親地図を子地図にはできません');
      const loaded = await apiFetch('/file?path=' + encodeURIComponent(path)), child = D().parse(loaded.content);
      if (!canEdit() || app._selected !== feature.id) return false;
      app._editFeature(next => {
        if (!next.links.some(link => link.role === 'child-map' && key(link.path) === key(path))) next.links.push({ path, label: child.display_title || child.title, type: 'map', role: 'child-map' });
      }); return true;
    };
    root.appendChild(app._button('既存マップを子地図にする', () => {
      const canEdit = app._editGuard(feature.id);
      MeldexLinkModal.show(null, async link => {
        if (!canEdit() || app._selected !== feature.id) return;
        try {
          if (link.type !== 'file' || !link.path?.toLowerCase().endsWith('.mel-map')) throw new Error('マップファイルを選んでください');
          await attach(link.path);
        } catch (error) { app._message(error.message); }
      });
    }, { disabled: locked }));
    if (app.store.doc.atlas?.surface && feature.points?.length) {
      const wrap = document.createElement('label'); wrap.className = 'gb-map-field'; wrap.append('詳細地図の範囲');
      const span = document.createElement('select'); span.className = 'gb-select'; span.setAttribute('aria-label', '詳細地図の範囲');
      for (const [value, label] of detailSpans) span.add(new Option(label, value));
      span.value = '16'; span.disabled = locked; wrap.append(span); root.appendChild(wrap);
      const detail = app._button('詳細地図を作成', async () => {
        try { await createDetailMap(app, feature, Number(span.value) || 16); } catch (error) { app._message(error.userMessage || error.message); }
      }, { disabled: locked });
      detail.dataset.e2eId = 'map-create-detail-map'; root.appendChild(detail);
    }
    root.appendChild(app._button('子地図を新規作成', async () => {
      const canEdit = app._editGuard(feature.id), parentPath = app.path;
      const name = await cfPrompt('子地図の名前', (feature.label || '地点') + 'の詳細地図');
      if (!name?.trim() || !canEdit() || app._selected !== feature.id) return;
      await runWithProgress('子地図を作成しています', async () => {
      const normalized = parentPath.replace(/\\/g, '/'), parent = normalized.slice(0, normalized.lastIndexOf('/') + 1);
      const result = await apiPost('/outliner/add', { type: 'map', label: name.trim(), parent });
      const path = result.node?.path;
      if (!path) throw new Error('子地図の作成結果を確認できません');
      if (typeof refreshOutliner === 'function') await refreshOutliner({ force: true, reason: 'map-child-created' });
      if (!canEdit() || app._selected !== feature.id) { app._message('地図を作成しました: ' + path + '。元の地点から子地図として選択してください。'); return; }
      if (await attach(path)) {
        if (!await app.flush()) { app._message('子地図を作成しましたが親地図を保存できません。関連付けは下書きに残っています: ' + path); return; }
        await openChild(app, feature, { path, label: result.node.label });
      }
      });
    }, { disabled: locked }));
  }
  // 詳細地図: 親地図（Azgaar方式）の地点の周りを切り出し、起伏・海岸線を引き継いだ子地図を作る。
  // 国→地方、地方→山や島、のように縮尺を下げて同じ世界の続きを描ける。街路は子地図の「都市・集落の詳細図」で作る。
  const detailSpans = Object.freeze([['8', '周囲の広い範囲（親の1/8）'], ['16', '周囲（親の1/16）'], ['32', '近く（親の1/32）'], ['64', 'ごく近く（親の1/64）']]);
  function detailTerrain(parent, feature, divisor) {
    const atlas = parent.atlas, field = globalThis.MeldexMapTerrainField;
    if (!atlas?.surface || !field) throw new Error('詳細地図は、起伏のあるAzgaar方式の地図から作れます');
    const [px, py] = feature.points[0];
    const ax = px / parent.canvas.width * atlas.width, ay = py / parent.canvas.height * atlas.height;
    const span = atlas.width / divisor, spanY = span * 0.6;
    const x0 = Math.max(0, Math.min(atlas.width - span, ax - span / 2)), y0 = Math.max(0, Math.min(atlas.height - spanY, ay - spanY / 2));
    const scene = field.scene(atlas), cols = 256, rows = 154, heights = new Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const h = scene.sample(x0 + (x + .5) / cols * span, y0 + (y + .5) / rows * spanY)[0];
      heights[y * cols + x] = h < 20 ? Math.max(-1, Math.min(0, (h - 20) / 20)) : Math.max(0.001, Math.min(1, (h - 20) / 80));
    }
    return { box: [x0, y0, span, spanY], terrain: { cols, rows, heights } };
  }
  async function createDetailMap(app, feature, divisor) {
    const parent = app.store.doc, canEdit = app._editGuard(feature.id), parentPath = app.path;
    const { box, terrain } = detailTerrain(parent, feature, divisor);
    const name = await cfPrompt('詳細地図の名前', (feature.label || '地点') + 'の詳細地図');
    if (!name?.trim() || !canEdit() || app._selected !== feature.id) return;
    await runWithProgress('詳細地図を作成しています', async () => {
    const normalized = parentPath.replace(/\\/g, '/'), folder = normalized.slice(0, normalized.lastIndexOf('/') + 1);
    const result = await apiPost('/outliner/add', { type: 'map', label: name.trim(), parent: folder });
    const path = result.node?.path;
    if (!path) throw new Error('詳細地図の作成結果を確認できません');
    const loaded = await apiFetch('/file?path=' + encodeURIComponent(path)), child = D().parse(loaded.content);
    child.coordinate_system = 'local'; child.basemap = 'blank';
    child.canvas = { width: 2000, height: Math.round(2000 * box[3] / box[2]) };
    child.terrain = terrain;
    child.atlas = globalThis.MeldexMapAzgaar.fromLegacyTerrain(child);
    child.terrain = null;
    child.atlas.presentation = parent.atlas.presentation || 'biomes';
    if (parent.map_style) child.map_style = D().clone(parent.map_style);
    // 縮尺: 親の1地図単位の距離 × 切り出した幅（親の地図単位）÷ 子の横幅。
    const parentUnits = box[2] / parent.atlas.width * parent.canvas.width;
    if (parent.scale?.distance_per_unit) child.scale = { ...child.scale, distance_per_unit: parent.scale.distance_per_unit * parentUnits / child.canvas.width, unit: parent.scale.unit };
    // 範囲内の地点（都市・地名）を引き継ぐ。
    const layer = child.layers[0], toChild = ([x, y]) => [((x / parent.canvas.width * parent.atlas.width) - box[0]) / box[2] * child.canvas.width, ((y / parent.canvas.height * parent.atlas.height) - box[1]) / box[3] * child.canvas.height];
    for (const source of parent.features) {
      if (!['pin', 'label'].includes(source.kind) || false) continue;
      const point = toChild(source.points[0]);
      if (point[0] < 0 || point[1] < 0 || point[0] > child.canvas.width || point[1] > child.canvas.height) continue;
      const copy = D().feature(source.kind, [point], layer.id, source.label);
      copy.color = source.color; copy.icon = source.icon; copy.tags = [...(source.tags || [])]; copy.description = source.description || '';
      if (source.stamp) copy.stamp = source.stamp;
      if (source.marker_style) copy.marker_style = source.marker_style;
      child.features.push(copy);
    }
    D().parse(JSON.stringify(child));
    await apiPut('/file?path=' + encodeURIComponent(path), { content: JSON.stringify(child), if_match_etag: loaded.etag });
    if (typeof refreshOutliner === 'function') await refreshOutliner({ force: true, reason: 'map-detail-created' });
    if (!canEdit() || app._selected !== feature.id) { app._message('詳細地図を作成しました: ' + path); return; }
    app._editFeature(next => {
      if (!next.links.some(link => link.role === 'child-map' && key(link.path) === key(path))) next.links.push({ path, label: child.display_title || child.title || name.trim(), type: 'map', role: 'child-map' });
    });
    if (!await app.flush()) { app._message('詳細地図を作成しましたが親地図を保存できません: ' + path); return; }
    await openChild(app, feature, { path, label: result.node.label });
    });
  }
  function sources(app, root) {
    const heading = document.createElement('h3'); heading.textContent = 'シートの場所'; root.appendChild(heading);
    root.append(app._button('シートの場所を表示', () => sourceDialog(app), { disabled: app.editingDisabled }), app._button('場所を更新', () => refresh(app, true)));
    for (const source of app.store.doc.sheet_sources || []) {
      const row = document.createElement('div'); row.className = 'gb-map-link-row';
      const label = document.createElement('span'); label.textContent = source.path + ' / ' + source.property;
      row.append(label, app._button('参照を解除', () => { app.update(doc => { doc.sheet_sources = doc.sheet_sources.filter(item => item.id !== source.id); }); app._render(); }, { disabled: app.editingDisabled })); root.appendChild(row);
    }
    const note = document.createElement('small'); note.textContent = '採用・掲載済みの場所を参照表示します。元のシートは変更しません。PNGには含めません。'; root.appendChild(note);
  }
  function sourceDialog(app) {
    const canEdit = app._editGuard(); let active = true, loadedPath = '', reading = 0;
    const choose = document.createElement('select'); choose.setAttribute('aria-label', '場所の列'); choose.disabled = true;
    const path = document.createElement('input'); path.setAttribute('aria-label', '参照するシート');
    const message = document.createElement('p'); message.setAttribute('role', 'status'); message.textContent = 'シートを選び、場所型の列を取得してください。';
    const save = app._button('この列を表示', () => {
      if (!canEdit() || !active) return;
      if (!choose.value || path.value.trim() !== loadedPath) throw new Error('列を取得し直してください');
      if ((app.store.doc.sheet_sources || []).some(source => source.path === loadedPath && source.property === choose.value)) throw new Error('この列は表示済みです');
      if (app.update(doc => { (doc.sheet_sources ||= []).push({ id: D().id(), path: loadedPath, property: choose.value }); })) { dialog.close('saved'); app._render(); }
    }); save.disabled = true;
    const dialog = GBUI.createModal({ title: 'シートの場所を表示', footer: [app._button('キャンセル', () => dialog.close()), save], onClose: () => { active = false; reading++; } });
    dialog.body.append(path, app._button('場所の列を取得', async () => {
      const requested = LData().canonicalPath(path.value.trim(), state.vaultPath), token = ++reading; path.value = requested; save.disabled = choose.disabled = true; choose.replaceChildren();
      if (!LData().safePath(requested)) throw new Error('シートを指定してください');
      try {
        const metadata = await apiFetch('/db-metadata?path=' + encodeURIComponent(requested));
        if (!active || !canEdit() || reading !== token) return;
        loadedPath = requested;
        for (const [name, spec] of Object.entries(metadata.property_types || {})) if (spec.type === 'location') choose.add(new Option(name, name));
        save.disabled = choose.disabled = !choose.options.length;
        message.textContent = choose.options.length ? '表示する場所の列を選んでください。' : '場所型の列がありません。シートで列を追加してください。';
      } catch (error) { if (active && token === reading) message.textContent = error.message; }
    }), choose, message);
    if (typeof _attachDbPicker === 'function') _attachDbPicker(path, ''); dialog.open(); path.focus();
  }
  function renderPlaces(app) {
    const places = []; let skipped = 0;
    sourcesLoop: for (const source of app.store.doc.sheet_sources || []) {
      const data = app._sheetCache?.get(source.id);
      if (!data) continue;
      for (const [name, entity] of Object.entries(data.entities || {})) for (const candidate of entity[source.property] || []) {
        if (!['採用', '掲載済み'].includes(candidate.status)) continue;
        try {
          const loc = LData().parse(candidate.value, candidate.link), point = LData().resolve(loc, candidate.link, app.store.doc, app.path);
          if (!point) { skipped++; continue; }
          places.push({ point, label: loc.label || name, name, path: candidate._topicCanonicalOnly || entity._topicCanonicalOnly ? null : candidate.entry_path || entity._entry_path || candidate.file,
            sheetPath: source.path, topicRef: candidate.topicRef || entity.topicRef });
        } catch (_) { skipped++; }
        if (places.length >= 10000) break sourcesLoop;
      }
    }
    app.view.setSheetPlaces(places);
    if (app.sheetStatus) app.sheetStatus.textContent = `${places.length}件を参照表示` + (skipped ? `（別の地図・未対応の場所など${skipped}件を除外）` : '');
  }
  async function refresh(app, force = false) {
    const store = app.store, generation = app._generation, sources = store.doc.sheet_sources || [];
    const signature = JSON.stringify(sources);
    if (!force && app._sheetSignature === signature) { renderPlaces(app); return; }
    app._sheetSignature = signature; const token = app._sheetRequest = (app._sheetRequest || 0) + 1;
    app._sheetCache = new Map(); app.view.setSheetPlaces([]);
    if (!sources.length) { renderPlaces(app); return; }
    const results = await Promise.allSettled(sources.map(async source => {
      const metadata = await apiFetch('/db-metadata?path=' + encodeURIComponent(source.path));
      if (metadata.property_types?.[source.property]?.type !== 'location') throw new Error('参照先に場所型の列がありません');
      const pivot = await apiFetch('/pivot?path=' + encodeURIComponent(source.path), { cache: 'no-store' });
      const target = await window.GbTopicLiveBridge?.resolveRegisteredPath?.(source.path, { refreshRoots: false });
      if (!target || !window.MeldexTopicPlacementUI?.projectSheetSnapshot) return pivot;
      const response = await apiPost('/topic-migrations/open', { sourceId: target.sourceId, relativePath: target.relativePath, migrationPreview: true });
      const preview = response.preview;
      if (!preview?.ok || !preview.viewDocument) return pivot;
      let snapshot = null;
      try { snapshot = await apiFetch('/topic-views/' + encodeURIComponent(preview.viewDocument.documentId) + '/snapshot', { silentError: true }); }
      catch (error) { if (Number(error.status || error.statusCode) !== 404) throw error; }
      return window.MeldexTopicPlacementUI.projectSheetSnapshot(source.path, pivot, {
        sourceId: target.sourceId, relativePath: target.relativePath, readOnly: true,
        viewDocument: snapshot?.viewDocument || preview.viewDocument,
        topicRecords: snapshot?.topics ? snapshot.topics.map(item => ({ ...item.record, topicRef: item.topicRef })) : preview.topicRecords,
      });
    }));
    if (app.store !== store || app._generation !== generation || app._sheetRequest !== token) return;
    for (const [i, result] of results.entries()) if (result.status === 'fulfilled') app._sheetCache.set(sources[i].id, result.value);
    renderPlaces(app);
    const failed = results.filter(result => result.status === 'rejected').length;
    if (failed) app.sheetStatus.textContent += ` ・ ${failed}列を取得できません。「場所を更新」で再試行してください`;
  }
  return Object.freeze({ breadcrumbs, inspector, sources, refresh, wouldCycle, openChild, findParents });
})();
