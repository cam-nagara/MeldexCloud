/* Standalone viewer: no API, file writes, tile requests or topic access. */
(function () {
  'use strict';
  const element = id => document.getElementById(id), status = element('status');
  try {
    const data = window.MELDEX_MAP_PACKAGE;
    if (data?.fileType !== 'meldex-map-package' || data.schema_version !== 1 || !Array.isArray(data.maps) || !data.maps.length || data.maps.length > 64) throw new Error('未対応のパッケージです');
    const maps = new Map(data.maps.map(item => [item.id, { id: item.id, doc: MeldexMapDocument.parse(item.doc) }]));
    if (!maps.has(data.root) || Array.from(maps.values()).some(item => item.doc.coordinate_system !== 'local')) throw new Error('創作地図を確認できません');
    let current, doc, history = []; const periodsByMap = new Map();
    const button = (label, handler) => { const el = document.createElement('button'); el.textContent = label; el.onclick = handler; return el; };
    const view = new MeldexMapView(element('map'), {
      select: id => select(id), action: () => {}, message: text => { status.textContent = text; },
      period: id => { periodsByMap.set(current, id); element('periods').value = id; select(null); places(); },
      reveal: feature => {
        view.filter = ''; element('search').value = '';
        const index = doc.layers.findIndex(layer => layer.id === feature.layer_id);
        if (index >= 0) { doc.layers[index].visible = true; const check = element('layers').querySelectorAll('input')[index]; if (check) check.checked = true; }
        view._features(); places();
      },
      draft: (count, distance) => { status.textContent = count ? '計測: ' + distance + '（クリックで点を追加し、計測を確定）' : '閲覧用 — 変更は保存されません'; },
    });
    function select(id) {
      const target = element('detail'); target.replaceChildren(); view.selectedId = id;
      const feature = doc.features.find(item => item.id === id);
      if (feature) {
        const name = document.createElement('h2'); name.textContent = feature.label || '名前なし';
        const text = document.createElement('p'); text.textContent = feature.description;
        const tags = document.createElement('p'); tags.textContent = feature.tags.join(' · '); target.append(name, text, tags);
        for (const link of feature.links.filter(item => maps.has(item.package_map_id))) target.appendChild(button('子地図: ' + maps.get(link.package_map_id).doc.title, () => {
          if (history.length >= 32) { status.textContent = '移動が深すぎます。地図の一覧から選び直してください'; return; }
          history.push({ id: current, feature: feature.id }); open(link.package_map_id);
        }));
      }
      view._features();
    }
    function places() {
      const list = element('places'); list.replaceChildren();
      for (const feature of doc.features.filter(item => view._visible(item))) list.appendChild(button(feature.label || '名前なし', () => { select(feature.id); view.focus(feature); }));
      if(!list.children.length) {
        const empty=document.createElement('div');empty.className='gb-empty-state';
        for(const [cls,text] of [['gb-empty-message','表示する地点・図形はありません'],['gb-empty-hint','検索・レイヤー・表示する章の条件を確認してください']]) {
          const line=document.createElement('div');line.className=cls;line.textContent=text;empty.append(line);
        }
        list.append(empty);
      }
    }
    function open(id) {
      if (!maps.has(id)) return;
      // parse() already detached these documents from the package data. Keep
      // per-map visibility for this session when returning from a child.
      current = id; doc = maps.get(id).doc;
      view.cancel(); view.selectedId = null; view.selectedIds.clear(); view.filter = ''; element('search').value = '';
      const periods = element('periods'); periods.replaceChildren(new Option('すべて', ''));
      for (const period of doc.periods || []) periods.add(new Option(period.name, period.id));
      view.periodId = (doc.periods || []).some(period => period.id === periodsByMap.get(id)) ? periodsByMap.get(id) : '';
      periods.value = view.periodId; element('period-label').style.display = doc.periods?.length ? '' : 'none';
      view.setDocument(doc, true); view.map.attributionControl.setPrefix(false); view.fit();
      element('terrain-style-label').hidden=!doc.atlas&&!MeldexMapWorldGeography.validEnvironment(doc.terrain);
      element('terrain-style').value=doc.atlas?.presentation||doc.terrain?.presentation||'biomes';
      view.setTool('select'); element('measure').setAttribute('aria-pressed', 'false');
      element('title').textContent = doc.title; document.title = doc.title + ' — マップ'; element('maps').value = id;
      element('back').disabled = !history.length; element('detail').replaceChildren();
      const elements=element('elements');elements.replaceChildren();for(const [key,name]of MeldexMapDisplay.categories){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=doc.display?.[key]!==false;check.setAttribute('aria-label',name+'を表示');check.onchange=()=>{doc.display={...doc.display,[key]:check.checked};view.setDocument(doc,true);places();};label.append(check,document.createTextNode(' '+name));elements.append(label);}
      const layers = element('layers'); layers.replaceChildren();
      for (const layer of doc.layers) {
        const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = layer.visible;
        check.onchange = () => { layer.visible = check.checked; select(null); places(); }; label.append(check, document.createTextNode(' ' + layer.name)); layers.appendChild(label);
      }
      places(); status.textContent = '閲覧用 — 変更は保存されません';
    }
    for (const item of maps.values()) element('maps').add(new Option(item.doc.title || '無題', item.id));
    element('maps').onchange = event => { history = []; open(event.target.value); };
    element('terrain-style').onchange=event=>{if(doc.atlas)doc.atlas.presentation=event.target.value;else if(MeldexMapWorldGeography.validEnvironment(doc.terrain))doc.terrain.presentation=event.target.value;else return;view._terrainData=null;view.setDocument(doc,true);};
    element('periods').onchange = event => { periodsByMap.set(current, event.target.value); view.periodId = event.target.value; select(null); places(); };
    element('back').onclick = () => { const parent = history.pop(); if (parent) { open(parent.id); select(parent.feature); const feature = doc.features.find(item => item.id === parent.feature); if (feature) view.focus(feature); } };
    element('fit').onclick = () => view.fit();
    element('search').oninput = event => { view.filter = event.target.value.toLocaleLowerCase(); select(null); places(); };
    element('measure').onclick = () => { const measuring = view.tool !== 'measure'; view.setTool(measuring ? 'measure' : 'select'); element('measure').setAttribute('aria-pressed', String(measuring)); status.textContent = measuring ? '地図をクリックして計測する点を追加してください' : '閲覧用 — 変更は保存されません'; };
    element('finish').onclick = () => {
      const distance = MeldexMapDocument.distanceLabel(MeldexMapDocument.distance(view.draft, doc), doc);
      if (view.finish()) status.textContent = '距離: ' + distance;
    };
    element('cancel').onclick = () => view.cancel();
    open(data.root);
  } catch (error) { status.textContent = '地図を開けません: ' + error.message; }
})();
