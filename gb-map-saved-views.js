/* Named views change the viewing state without rewriting geometry or history. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./gb-map-document.js') : root.MeldexMapDocument);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MeldexMapSavedViews = api;
})(globalThis, function (D) {
  'use strict';
  const kinds = ['', 'pin', 'route', 'region', 'label'];
  const rotation = n => typeof n === 'number' && Number.isFinite(n) ? ((n + 180) % 360 + 360) % 360 - 180 : 0;
  function capture(doc, state, viewport, name) {
    if (!name.trim() || [...name.trim()].length > 80) throw new Error('表示名は1〜80文字で入力してください');
    const view = { id: D.id(), name: name.trim(), center: D.clone(viewport.center), zoom: viewport.zoom, rotation: rotation(state.mapRotation),
      layer_ids: doc.layers.filter(l => state.mapLayerVisibility?.[l.id] ?? l.visible).map(l => l.id),
      filter: typeof state.mapSearch === 'string' ? state.mapSearch.slice(0, 1000) : '',
      feature_kind: kinds.includes(state.mapFeatureKind) ? state.mapFeatureKind : '', period_id: state.mapPeriodId || '' };
    D.parse({ ...doc, saved_views: [view] }); return view;
  }
  function apply(app, view) {
    app._commitInput();
    if (app._inputDirty) { app._message('入力内容を確認してから表示を切り替えてください'); return false; }
    const doc = app.store.doc;
    app.state.mapLayerVisibility = Object.fromEntries(doc.layers.map(l => [l.id, view.layer_ids.includes(l.id)]));
    app.state.mapSearch = view.filter; app.state.mapFeatureKind = view.feature_kind; app.state.mapRotation = rotation(view.rotation);
    app.state.mapPeriodId = (doc.periods || []).some(p => p.id === view.period_id) ? view.period_id : '';
    app.state.mapViewport = { center: D.clone(view.center), zoom: view.zoom };
    app.state.mapViewSystem = doc.coordinate_system; app.state.mapSavedViewId = view.id;
    app.search.value = view.filter; app.kindFilter.value = view.feature_kind;
    app._saveViewState(); app._render(); app.view.map.setView(app.view.latlng(view.center), view.zoom);
    return true;
  }
  function render(app) {
    const root = app.savedViewsRoot; root.replaceChildren();
    const title = document.createElement('h3'); title.textContent = '保存した表示'; root.appendChild(title);
    const list = document.createElement('select'); list.style.width = '100%'; list.setAttribute('aria-label', '保存した表示'); list.add(new Option('表示を選択', ''));
    for (const v of app.store.doc.saved_views || []) list.add(new Option(v.name, v.id));
    list.value = app.state.mapSavedViewId || '';
    list.onchange = () => {
      const v = app.store.doc.saved_views?.find(v => v.id === list.value);
      if (v) { if (!apply(app, v)) list.value = app.state.mapSavedViewId || ''; }
      else { app.state.mapSavedViewId = ''; app._saveViewState(); render(app); }
    };
    root.append(list, app._button('現在の表示を保存', async () => {
      app._commitInput(); if (app._inputDirty) throw new Error('入力内容を確認してください');
      const store = app.store, doc = store.doc, canEdit = app._editGuard();
      const value = await cfPrompt('表示名（80文字まで）', ''); if (value == null || !canEdit()) return;
      const access = await MeldexEntityDetail.resolveReadOnly(app.path, false);
      if (!canEdit() || app._active === false || store.doc !== doc) return;
      if (access.readOnly) throw new Error(access.reason || 'このマップは編集できません');
      if ((doc.saved_views || []).length >= 50) throw new Error('表示は50件まで保存できます');
      const viewport = { center: app.view.xy(app.view.map.getCenter()), zoom: app.view.map.getZoom() };
      const view = capture(doc, app.state, viewport, value);
      if ((doc.saved_views || []).some(v => v.name === view.name)) throw new Error('同じ表示名があります');
      D.parse(JSON.stringify({ ...doc, saved_views: [...(doc.saved_views || []), view] }, null, 2));
      if (app.update(next => { (next.saved_views ||= []).push(view); })) { app.state.mapSavedViewId = view.id; app._saveViewState(); app._render(); }
    }, { disabled: app.editingDisabled }), app._button('選択した表示を削除', async () => {
      const doc = app.store.doc, canEdit = app._editGuard(), target = doc.saved_views?.find(v => v.id === list.value);
      if (!target || !await cfConfirm('保存した表示「' + target.name + '」を削除しますか？ 地図の図形は保持されます。')) return;
      const access = await MeldexEntityDetail.resolveReadOnly(app.path, false);
      if (!canEdit() || app.store.doc !== doc || app._active === false) return;
      if (access.readOnly) throw new Error(access.reason || 'このマップは編集できません');
      if (app.update(next => { next.saved_views = next.saved_views.filter(v => v.id !== target.id); })) { app.state.mapSavedViewId = ''; app._saveViewState(); app._render(); }
    }, { disabled: app.editingDisabled || !(app.store.doc.saved_views || []).some(v => v.id === list.value) }));
  }
  return Object.freeze({ capture, apply, render });
});
