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
    root.appendChild(app._button('子地図を新規作成', async () => {
      const canEdit = app._editGuard(feature.id), parentPath = app.path;
      const name = await cfPrompt('子地図の名前', (feature.label || '地点') + 'の詳細地図');
      if (!name?.trim() || !canEdit() || app._selected !== feature.id) return;
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
    }, { disabled: locked }));
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
