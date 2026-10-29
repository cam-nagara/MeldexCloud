/* Read-only creative-map packages. Original paths and topic metadata stay local. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./gb-map-document.js') : root.MeldexMapDocument, node ? require('./gb-map-world-geography.js') : root.MeldexMapWorldGeography);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MeldexMapPackage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D, G) {
  'use strict';
  const MAX_MAPS = 64, MAX_BYTES = 48 * 1024 * 1024;
  const assets = ['vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/LICENSE',
    'gb-map-world-terrain.js', 'gb-map-document.js', 'gb-map-world-geography.js', 'gb-map-terrain-render.js', 'gb-map-interaction.js', 'gb-map-view.js', 'gb-tool-map.css', 'map-package-viewer.txt', 'map-package-viewer.js', 'map-package-viewer.css'];
  const key = path => String(path).replace(/\\/g, '/').toLocaleLowerCase();
  const pick = (obj, fields) => Object.fromEntries(fields.filter(field => Object.hasOwn(obj, field)).map(field => [field, D.clone(obj[field])]));
  function portable(doc, links) {
    const result = pick(doc, ['fileType', 'schema_version', 'title', 'coordinate_system']);
    result.canvas = pick(doc.canvas, ['width', 'height']); result.basemap = 'blank';
    result.scale = pick(doc.scale, ['distance_per_unit', 'unit', 'north_degrees']);
    const periods = new Map((doc.periods || []).map((period, index) => [period.id, 'period-' + index]));
    if (doc.periods) result.periods = doc.periods.map(period => ({ id: periods.get(period.id), name: period.name }));
    const layers = new Map(doc.layers.map((layer, index) => [layer.id, 'layer-' + index]));
    result.layers = doc.layers.map(layer => ({ ...pick(layer, ['name', 'visible', 'locked', 'opacity']), id: layers.get(layer.id) }));
    const cartography = feature => {
      const c = feature.cartography;
      if (!c || !['river','road','shipping','border','lake','city','country-label','mountain-label','river-label'].includes(c.role)) return {};
      return { cartography: { role:c.role, ...(typeof c.capital === 'boolean' ? {capital:c.capital}:{}), ...(['minor','major'].includes(c.rank)?{rank:c.rank}:{}), ...(Number.isFinite(c.flow)&&c.flow>=0&&c.flow<=1e9?{flow:c.flow}:{}) } };
    };
    result.features = doc.features.map((feature, index) => ({
      ...pick(feature, ['kind', 'points', 'label', 'description', 'color', 'tags']),
      id: 'feature-' + index, layer_id: layers.get(feature.layer_id),
      ...cartography(feature),
      ...(feature.period_ids ? { period_ids: feature.period_ids.map(id => periods.get(id)) } : {}),
      icon: ['pin', 'city', 'castle', 'mountain', 'forest', 'port'].includes(feature.icon) ? feature.icon : 'pin',
      line_style: feature.line_style === 'curve' ? 'curve' : 'straight', arrow: !!feature.arrow, dashed: !!feature.dashed,
      links: feature.links.filter(link => link.role === 'child-map' && links.has(key(link.path))).map(link => {
        const target = links.get(key(link.path));
        return { path: target.id + '.mel-map', label: target.doc.title, role: 'child-map', type: 'map', package_map_id: target.id };
      }),
    }));
    result.terrain = doc.terrain ? pick(doc.terrain, ['cols', 'rows', 'heights']) : null;
    if (doc.terrain && G.validEnvironment(doc.terrain)) {
      result.terrain.environment = pick(doc.terrain.environment,['version','signature','temperature','rain','biomes','lakes','owner','countries']);
      if (['biomes','elevation','temperature','rain','political'].includes(doc.terrain.presentation)) result.terrain.presentation=doc.terrain.presentation;
    }
    result.background = doc.background ? pick(doc.background, ['data_url']) : null; result.view = null;
    return D.parse(result);
  }
  async function collect(rootPath, read, options = {}) {
    const check = options.check || (() => {});
    const canonical = options.canonicalPath || (path => String(path).replace(/\\/g, '/'));
    const maps = new Map(), seen = new Set(), queue = [canonical(rootPath)], skipped = [], snapshots = [];
    let bytes = 0, omittedLinks = 0, omittedSources = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      check();
      const path = queue[cursor], pathKey = key(path);
      if (seen.has(pathKey)) continue;
      if (seen.size >= MAX_MAPS) throw new Error('持ち出す地図は64件以内にしてください');
      seen.add(pathKey);
      const loaded = await read(path); check();
      const doc = D.parse(loaded.content);
      bytes += new TextEncoder().encode(typeof loaded.content === 'string' ? loaded.content : JSON.stringify(loaded.content)).length;
      if (bytes > MAX_BYTES) throw new Error('持ち出す地図の合計は48MB以内にしてください');
      if (!loaded.etag) throw new Error('地図の保存状態を確認できません');
      snapshots.push({ path, etag: loaded.etag });
      if (doc.coordinate_system !== 'local') {
        if (!cursor) throw new Error('持ち出しパッケージは創作地図で利用できます');
        skipped.push(doc.title); continue;
      }
      maps.set(pathKey, { id: 'map-' + maps.size, doc });
      omittedSources += (doc.sheet_sources || []).length;
      for (const feature of doc.features) for (const link of feature.links) {
        if (link.role === 'child-map' && options.includeChildren !== false) queue.push(canonical(link.path));
        else omittedLinks++;
      }
    }
    const aliases = new Map(maps);
    for (const entry of maps.values()) for (const feature of entry.doc.features) for (const link of feature.links) {
      const target = maps.get(key(canonical(link.path))); if (target) aliases.set(key(link.path), target);
    }
    const data = { fileType: 'meldex-map-package', schema_version: 1, root: 'map-0',
      maps: Array.from(maps.values(), item => ({ id: item.id, doc: portable(item.doc, aliases) })) };
    return { data, snapshots, skipped, omittedLinks, omittedSources, bytes };
  }
  async function verify(plan, read, check = () => {}) {
    for (const source of plan.snapshots) {
      check();
      const loaded = await read(source.path); check();
      if (loaded.etag !== source.etag) throw new Error('地図が変更されました。「内容を確認」からやり直してください');
    }
  }
  function dataScript(data) {
    return 'window.MELDEX_MAP_PACKAGE=' + JSON.stringify(data).replace(/[<\u2028\u2029]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')) + ';\n';
  }
  async function build(plan, loadAsset, zip, check = () => {}) {
    check();
    // The HTML template is served as text so the app's HTML bootstrap (local
    // session credentials) is never injected into a portable document.
    const entries = await Promise.all(assets.map(async name => ({ name: name === 'map-package-viewer.txt' ? 'index.html' : name, data: await loadAsset(name) })));
    check();
    entries.push({ name: 'package-data.js', data: new TextEncoder().encode(dataScript(plan.data)) });
    entries.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify({ fileType: plan.data.fileType, schema_version: 1,
      root: plan.data.root, maps: plan.data.maps.map(item => ({ id: item.id, title: item.doc.title })), read_only: true }, null, 2)) });
    entries.push({ name: 'お読みください.txt', data: new TextEncoder().encode('ZIPをすべて展開し、index.htmlをブラウザで開いてください。インターネット接続やMeldexは不要です。\n閲覧用パッケージです。元のマップは.mel-mapで別途保管してください。\n非表示レイヤー・説明・タグも含みます。資料リンク、シート参照、現実地図は含みません。\nLeafletの著作権表示はvendor/leaflet/LICENSEを参照してください。\n') });
    const bytes = await zip(entries); check();
    return new Blob([bytes], { type: 'application/zip' });
  }
  function show(app) {
    const store = app.store, generation = app._generation, path = app.path;
    let active = true, busy = false, plan = null, signature = '';
    const current = () => active && app.store === store && app._generation === generation && app.path === path && app._active !== false;
    const controller = new AbortController();
    const check = () => { if (!current()) throw new DOMException('持ち出し処理を中止しました', 'AbortError'); };
    const canonical = value => MeldexLocationData.canonicalPath(value, state.vaultPath);
    const read = value => apiFetch('/file?path=' + encodeURIComponent(value), { cache: 'no-store', signal: controller.signal });
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    const list = document.createElement('ul'), label = document.createElement('label'), children = document.createElement('input');
    children.type = 'checkbox'; children.checked = true; children.setAttribute('aria-label', '子地図を含める'); label.append(children, document.createTextNode(' 子地図を含める'));
    const warning = document.createElement('p'); warning.textContent = '創作地図と画像を閲覧用ZIPにまとめます。非表示レイヤー・説明・タグも含みます。資料リンクとシートの参照表示は含みません。子地図は保存済みの内容を使用します。';
    const reset = () => { plan = null; save.disabled = true; list.replaceChildren(); status.textContent = '「内容を確認」で含まれる地図を確認してください。'; };
    const setBusy = value => { busy = value; preview.disabled = value; children.disabled = value; save.disabled = value || !plan; };
    const preview = app._button('内容を確認', async () => {
      if (busy || !current()) return;
      reset(); setBusy(true); status.textContent = '地図を確認しています…';
      try {
        if (!await app.flush()) throw new Error('現在のマップを保存してから実行してください');
        if (!current()) return;
        signature = JSON.stringify(store.doc);
        const result = await collect(path, read, { canonicalPath: canonical, includeChildren: children.checked, check });
        if (!current()) return;
        if (signature !== JSON.stringify(store.doc)) throw new Error('地図が変更されました。「内容を確認」からやり直してください');
        if (result.snapshots[0]?.etag !== store.etag) throw new Error('保存先の地図が変更されています。マップを再読込してから実行してください');
        plan = result;
        for (const item of plan.data.maps) { const row = document.createElement('li'); row.textContent = item.doc.title || '無題'; list.appendChild(row); }
        status.textContent = `${plan.data.maps.length}件、約${(plan.bytes / 1024 / 1024).toFixed(1)}MB。資料リンク等${plan.omittedLinks}件・シート参照${plan.omittedSources}件を除外。`
          + (plan.skipped.length ? `現実地図${plan.skipped.length}件を除外: ${plan.skipped.join('、')}` : '') + ' ZIPを展開してindex.htmlを開くと閲覧できます。';
      } catch (error) { if (current()) { reset(); status.textContent = '確認できません: ' + error.message; } }
      finally { setBusy(false); }
    });
    const save = app._button('ZIPを保存', async () => {
      if (busy || !plan || !current()) return;
      setBusy(true);
      try {
        const blob = await build(plan, async name => {
          const response = await fetch(new URL(name, document.baseURI), { signal: controller.signal });
          if (!response.ok) throw new Error('閲覧用ファイルを取得できません: ' + name);
          return new Uint8Array(await response.arrayBuffer());
        }, MeldexArchiveZipEngine.buildZip, check);
        await verify(plan, read, check);
        if (!current()) return;
        if (store.dirty || app._inputDirty || signature !== JSON.stringify(store.doc)) throw new Error('地図が変更されました。「内容を確認」からやり直してください');
        const saved = await MeldexExportSave.saveBlob(blob, { initialfile: plan.data.maps[0].doc.title + '-持ち出し.zip', extension: '.zip' });
        if (saved !== false && current()) dialog.close('saved');
      } catch (error) { if (current()) { reset(); status.textContent = '保存できません: ' + error.message; } }
      finally { setBusy(false); }
    });
    const dialog = GBUI.createModal({ title: '持ち出しパッケージ', footer: [app._button('閉じる', () => dialog.close()), preview, save], onClose: () => { active = false; controller.abort(); } });
    children.onchange = reset; dialog.body.append(warning, label, status, list); reset(); dialog.open();
  }
  return Object.freeze({ collect, verify, build, dataScript, show });
});
