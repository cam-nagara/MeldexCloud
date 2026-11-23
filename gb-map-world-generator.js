/* A single guarded transaction builds an internally consistent fantasy world. */
(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./gb-map-document.js'):root.MeldexMapDocument,node?require('./gb-map-azgaar.js'):root.MeldexMapAzgaar,node?require('./gb-map-world-names.js'):root.MeldexMapWorldNames);
  if(node)module.exports=api;else root.MeldexMapWorldGenerator=api;
})(globalThis,function(D,A,Names){
  'use strict';
  const defaults=Object.freeze({seed:'',name:'新しい世界',naming:'katakana',template:'continent',cells:20000,warmth:50,wetness:55,cities:100,nations:12,widthKm:24000});
  // 地図の規模の目安（世界〜地方）。都市・村の街路は「都市・集落の詳細図」、地点の周りは「詳細地図を作成」で作る。
  const scales=Object.freeze([
    {id:'world',label:'世界（約24000km）',widthKm:24000,template:'continent',cities:100,nations:12,cells:20000},
    {id:'continent',label:'大陸（約6000km）',widthKm:6000,template:'pangea',cities:80,nations:8,cells:20000},
    {id:'country',label:'国（約1500km）',widthKm:1500,template:'island',cities:40,nations:3,cells:20000},
    {id:'region',label:'地方・山岳（約300km）',widthKm:300,template:'island',cities:12,nations:1,cells:30000},
    {id:'custom',label:'自由に指定',widthKm:0,template:'continent',cities:100,nations:12,cells:20000},
  ]);
  const presentations=[['biomes','自然・植生'],['elevation','標高'],['temperature','気温'],['rain','降水'],['political','国家']];
  function parameters(input={}){
    const o=Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,input[key]??value]));
    if(typeof o.seed!=='string'||!o.seed.trim()||o.seed.length>128||typeof o.name!=='string'||!o.name.trim()||[...o.name].length>64||!['continent','island','archipelago','pangea','shattered'].includes(o.template))throw new Error('シード・世界名・地形の種類を確認してください');
    if(!['katakana','original'].includes(o.naming))throw new Error('地名の表記を確認してください');
    for(const [key,lo,hi]of[['cells',10000,40000],['warmth',0,100],['wetness',0,100],['widthKm',10,60000],['cities',4,300],['nations',1,24]])if(!Number.isFinite(o[key])||o[key]<lo||o[key]>hi||['cities','nations','cells'].includes(key)&&!Number.isInteger(o[key]))throw new Error('世界地図生成の数値条件を確認してください');
    if(o.nations>o.cities)throw new Error('国家数は都市数以下にしてください');
    return o;
  }
  function adopt(source,input,world){
    const doc=D.parse(source),o=parameters(input);
    if(doc.atlas?.locked)throw new Error('地形をロックしています');
    if(doc.coordinate_system!=='local')throw new Error('創作地図で実行してください');
    if(!world?.ok)throw new Error('Azgaarの生成結果を取得できません');
    world=Names.localize(world,o.seed,o.naming);
    if(doc.layers.length>93)throw new Error('世界地図には7つのレイヤーを追加します。レイヤーの上限100件を超えます');
    const previous=new Set(doc.layers.filter(l=>['coherent-world','azgaar-world'].includes(l.generation?.kind)).map(l=>l.id));
    const group=D.id(),layers={},features=[],scale=[doc.canvas.width/world.width,doc.canvas.height/world.height];
    const toMap=p=>[p[0]*scale[0],p[1]*scale[1]];
    for(const [key,name]of[['cities','都市・港'],['labels','地名'],['roads','陸路'],['shipping','航路'],['rivers','河川'],['lakes','湖'],['borders','国家・国境']])
      layers[key]={id:D.id(),name:name+'（'+o.name+'）',visible:true,locked:false,opacity:1,generation:{kind:'azgaar-world',engine_version:A.version,group,part:key}};
    const add=(kind,points,key,label,color,role,path,closed=false)=>{const f={...D.feature(kind,points.map(toMap),layers[key].id,label),color,tags:[layers[key].name.split('（')[0]],cartography:{role}};if(kind==='route')f.line_style=role==='border'?'straight':'curve';if(path)A.attach(f,path,scale,closed);features.push(f);return f;};
    for(const lake of world.lakes)if(lake.points.length>=3)add('region',lake.points,'lakes',lake.name,'#80a9ba','lake',lake.path,true);
    for(const river of world.rivers){const f=add('route',river.points,'rivers',river.name,'#457e9b','river',river.path,true);f.cartography.basin=river.basin;f.cartography.parent=river.parent;}
    for(const state of world.states){
      const polygon=state.polygons.slice().sort((a,b)=>b.length-a.length)[0];
      if(polygon?.length>=3){const area=add('region',polygon,'borders',state.name,'#796b66','border',state.path,true);if(Array.isArray(world.borders))area.cartography.area=true;}
      const label=add('label',[state.point],'labels',state.shortName||state.name,'#514b43','country-label');label.description=state.name;
    }
    for(const border of world.borders||[])add('route',border.points,'borders',border.pair.map(i=>world.states.find(s=>s.id===i)?.name||'未所属').join(' / '),'#827465','border',border.path);
    for(const route of world.routes){const sea=route.group==='searoutes',f=add('route',route.points,sea?'shipping':'roads',route.name|| (sea?'航路':'陸路'),sea?'#577d8b':'#8c7058',sea?'shipping':'road',route.path);f.cartography.rank=route.group==='roads'?'major':'minor';f.travel_plan={schema_version:1,unit:'km',speed:sea?15:5,daily_hours:sea?12:8,rest_days:0};}
    for(const city of world.cities){const f=add('pin',[city.point],'cities',city.name,'#4b443f','city');f.icon=city.port?'port':city.capital?'castle':'city';Object.assign(f.cartography,{capital:city.capital,rank:city.capital?'major':'minor'});f.tags=[city.port?'港':'都市',...(city.capital?['首都']:[])];f.description=(world.states.find(s=>s.id===city.state)?.name||'未所属')+'。Azgaarの地形・気候・居住適性に基づく都市。';}
    const shape=(path,color,opacity=1)=>({path,color,opacity});
    doc.atlas={version:1,engine:'Azgaar',engine_version:A.version,revision:A.revision,width:world.width,height:world.height,presentation:'biomes',shores:world.shores,
      modes:{biomes:world.shapes.map(s=>shape(s.path,s.color)),elevation:world.heights.map(s=>shape(s.path,['#b7c79c','#adba8e','#a4ad83','#9da07b','#a59477','#ae9f8b','#b4aa99','#bdb9aa','#cfcec1','#dddfd7','#eceee8','#f2f4f0','#f8faf7','#ffffff'][Math.min(13,Math.floor((s.height-30)/5))])),temperature:world.temperature.map(s=>shape(s.path,s.color)),rain:world.rain.map(s=>shape(s.path,s.color)),political:world.states.map(s=>shape(s.path,s.color,.65))},
      relief:world.heights.filter(s=>s.height>=45).map(s=>shape(s.path,s.height>=80?'#fafbf3':'#665d49',s.height>=80?.18:.065)),...(world.surface?{surface:world.surface}:{})};
    if(!A.valid(doc.atlas))throw new Error('生成結果が地図の上限を超えました。地形の細かさを下げてください');
    for(const layer of doc.layers)if(previous.has(layer.id))layer.visible=false;
    doc.layers.push(...Object.values(layers));doc.features.push(...features);doc.terrain=null;doc.background=null;
    doc.scale={...doc.scale,distance_per_unit:o.widthKm/doc.canvas.width,unit:'km',north_degrees:0};
    doc.schema_version=1;doc.world_generation={version:4,engine:'Azgaar',engine_version:A.version,revision:A.revision,names_version:Names.version,parameters:o,stats:world.stats,group,layer_ids:Object.values(layers).map(l=>l.id)};
    D.parse(JSON.stringify(doc));return {doc,stats:world.stats,parameters:o,previousLayers:[...previous],layers};
  }
  async function prepare(source,input,signal){
    const doc=D.parse(source),o=parameters(input),aspect=doc.canvas.height/doc.canvas.width;
    if(doc.atlas?.locked)throw new Error('地形をロックしています');
    if(doc.coordinate_system!=='local')throw new Error('創作地図で実行してください');
    if(doc.layers.length>93)throw new Error('世界地図には7つのレイヤーを追加します。レイヤーの上限100件を超えます');
    if(aspect<.125||aspect>8)throw new Error('生成できる地図の縦横比は1:8〜8:1です');
    const result=adopt(doc,o,await A.generate({seed:o.seed,template:({continent:'continents',island:'highIsland',archipelago:'archipelago',pangea:'pangea',shattered:'shattered'})[o.template],aspect,widthKm:o.widthKm,cells:o.cells,cities:o.cities,nations:o.nations,equator:10+o.warmth*.34,precipitation:20+o.wetness*1.6},signal));
    result.doc.background={data_url:await A.raster(result.doc.atlas)};
    D.parse(JSON.stringify(result.doc));return result;
  }
  function show(app){
    app._commitInput();if(app._inputDirty)throw new Error('入力内容を確認してください');
    if(app.editingDisabled||app.store.doc.atlas?.locked||app.store.doc.coordinate_system!=='local')throw new Error('編集できる創作地図で実行してください');
    app._generatorPreview?.destroy();app._settlementsPreview?.destroy();app._climatePreview?.destroy();app._worldPreview?.destroy();app._terrainPreview?.destroy();
    const store=app.store,path=app.path,canEdit=app._editGuard(),panel=document.createElement('div');panel.className='gb-map-generator gb-map-world-generator';panel.setAttribute('role','region');panel.setAttribute('aria-label','世界地図生成のプレビュー');
    const title=document.createElement('h3');title.textContent='世界地図を生成';const help=document.createElement('p');help.textContent='Azgaar v1.156.0で地形・水系・気候・植生から都市、国家、陸路と航路を生成します。通信・API料金は発生しません。プレビューで確認してから採用してください。';panel.append(title,help);
    let prepared=null,source=null,signature='',preview=null,pending=false,controller=null;const controls={},previous=store.doc.world_generation?.parameters||{};
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='条件を設定してください。';
    const clear=()=>{controller?.abort();controller=null;prepared=null;preview?.destroy();preview=null;canvas.replaceChildren();adopt.disabled=true;};
    const input=(key,label,value,attrs={})=>{const wrap=document.createElement('label');wrap.className='gb-map-field';const text=document.createElement('span');text.textContent=label;const c=document.createElement('input');c.className=attrs.type==='number'?'gb-input gb-num-input':'gb-input';c.setAttribute('aria-label',label);Object.assign(c,attrs);c.required=true;c.value=value;c.oninput=c.onchange=()=>{clear();status.textContent='条件が変わりました。プレビューを作り直してください。';};wrap.append(text,c);panel.append(wrap);controls[key]=c;};
    input('name','世界名',previous.name||app.state.label||defaults.name,{maxLength:64});input('seed','シード',previous.seed||String(Date.now()),{maxLength:128});
    const naming=document.createElement('select');naming.className='gb-select';naming.setAttribute('aria-label','地名の表記');for(const [key,label]of[['katakana','カタカナ（基本）'],['original','原語（Azgaar）']])naming.add(new Option(label,key));naming.value=previous.naming||defaults.naming;naming.onchange=clear;const namingLabel=document.createElement('label');namingLabel.className='gb-map-field';namingLabel.append('地名の表記',naming);panel.append(namingLabel);controls.naming=naming;
    const wrap=document.createElement('label');wrap.className='gb-map-field';wrap.append('地形の種類');const template=document.createElement('select');template.className='gb-select';template.setAttribute('aria-label','地形の種類');for(const [key,name]of[['continent','大陸'],['archipelago','群島'],['island','島'],['pangea','超大陸'],['shattered','分裂した大陸']])template.add(new Option(name,key));template.value=previous.template||defaults.template;template.onchange=clear;wrap.append(template);panel.append(wrap);controls.template=template;
    for(const [key,label,min,max]of[['cells','地形の細かさ（セル数）',10000,40000],['warmth','暖かさ（0〜100）',0,100],['wetness','湿り気（0〜100）',0,100],['cities','都市数の目安',4,300],['nations','国家数',1,24],['widthKm','地図の横幅（km）',10,60000]])input(key,label,previous[key]??defaults[key],{type:'number',min,max,step:1});
    // 地図の規模: 世界地図だけでなく、大陸・国・地方（山岳・盆地）の地図も作れる。選ぶと横幅・地形・都市数・国家数の目安を入れる（あとから個別に変更できる）。
    const scaleWrap=document.createElement('label');scaleWrap.className='gb-map-field';scaleWrap.append('地図の規模');const scale=document.createElement('select');scale.className='gb-select';scale.setAttribute('aria-label','地図の規模');
    for(const [key,name]of scales.map(s=>[s.id,s.label]))scale.add(new Option(name,key));scale.value=scales.find(s=>Number(controls.widthKm.value)>=s.widthKm*.7&&Number(controls.widthKm.value)<=s.widthKm*1.5)?.id||'custom';
    scale.onchange=()=>{const preset=scales.find(s=>s.id===scale.value);if(preset&&preset.id!=='custom'){controls.widthKm.value=preset.widthKm;controls.template.value=preset.template;controls.cities.value=preset.cities;controls.nations.value=preset.nations;controls.cells.value=preset.cells;}clear();};
    scaleWrap.append(scale);panel.insertBefore(scaleWrap,panel.querySelector('.gb-map-field'));
    const mode=document.createElement('select');mode.className='gb-select';mode.setAttribute('aria-label','プレビューの配色');for(const [key,name]of presentations)mode.add(new Option(name,key));mode.onchange=()=>{if(prepared){prepared.doc.atlas.presentation=mode.value;preview?.setDocument(prepared.doc,true);}};
    const modeLabel=document.createElement('label');modeLabel.className='gb-map-field';modeLabel.append('プレビューの配色',mode);
    const canvas=document.createElement('div');canvas.className='gb-map-generator-preview gb-map-world-preview';panel.append(modeLabel,status,canvas);
    const values=()=>Object.fromEntries(Object.entries(controls).map(([k,c])=>[k,c.type==='number'?Number(c.value):c.value]));
    const conditions=()=>JSON.stringify(Object.values(controls).map(c=>c.value));
    const current=()=>panel.isConnected&&canEdit()&&app.store===store&&app.path===path&&app._active!==false;
    const cleanup=()=>{controller?.abort();controller=null;MeldexMapChrome.closePanel(panel);preview?.destroy();preview=null;prepared=null;panel.remove();if(app._worldPreview?.panel===panel)app._worldPreview=null;};
    const generate=app._button('世界地図をプレビュー',async()=>{
      if(pending||!current()||!Object.values(controls).every(c=>c.reportValidity()))return;
      clear();controller=new AbortController();pending=true;generate.disabled=true;status.textContent='Azgaarで地形・水系・都市と交通を生成しています…';
      try{await new Promise(resolve=>requestAnimationFrame(resolve));if(!current())return;source=store.doc;signature=conditions();prepared=await prepare(source,values(),controller.signal);prepared.doc.atlas.presentation=mode.value;
        if(!current()||source!==store.doc||signature!==conditions()){clear();return;}
        preview=new MeldexMapView(canvas,{select:()=>{}});preview.setDocument(prepared.doc,true);const s=prepared.stats;
        status.textContent=`陸地${Math.round(s.landRatio*100)}%・主な陸塊${s.landmasses}・河川${s.rivers}・湖${s.lakes}・都市${s.cities}（港${s.ports}）・国家${s.nations}・陸路${s.roads}・航路${s.seaRoutes}。採用すると背景・縮尺・北方向（上）を更新します。以前の世界生成レイヤーは保持して非表示にします。`;
      }catch(e){clear();status.textContent=e.name==='AbortError'?'生成を中止しました。':e.userMessage||e.message;}finally{pending=false;generate.disabled=false;adopt.disabled=!prepared;}
    });
    const adopt=app._button('この世界地図を採用',async()=>{
      if(pending||!prepared||!current())return;const candidate=prepared;const valid=()=>current()&&prepared===candidate&&store.doc===source&&signature===conditions();
      if(!valid()){clear();status.textContent='地図または条件が変更されました。プレビューを作り直してください。';return;}
      pending=true;generate.disabled=adopt.disabled=true;
      // The confirmation must not keep a second large map rendering behind it.
      // Restore the same prepared preview when the user cancels or access fails.
      preview?.destroy();preview=null;canvas.replaceChildren();
      let accessCheck;
      try{if((source.terrain||source.background)&&!await cfConfirm('背景・縮尺・北方向（上）を生成した世界地図へ更新します。手描き図形を保持し、以前の世界生成レイヤーは非表示にします。採用しますか？',{
        onAccept:()=>{accessCheck=MeldexEntityDetail.resolveReadOnly(path,false);}
      }))return;
        if(!valid())return;
        status.textContent='反映しています…';
        const access=await(accessCheck||MeldexEntityDetail.resolveReadOnly(path,false));if(!valid())return;if(access.readOnly){status.textContent=access.reason||'編集ロック中のため採用できません';return;}
        // Generation retains the local canvas and projection. Fit its existing
        // light view first so the new vector layers are projected only once.
        if(app.update(d=>Object.assign(d,candidate.doc))){for(const id of candidate.previousLayers)if(app.state.mapLayerVisibility)delete app.state.mapLayerVisibility[id];app.state.mapSearch='';app.state.mapFeatureKind='';app.search.value='';app.kindFilter.value='';app._selection=new Set();app._selected=null;app._activeLayer=candidate.layers.cities.id;cleanup();app._buildSettingsRefresh();app.view.fit();app._render();app._saveViewState();}
      }finally{
        if(!preview&&valid()){preview=new MeldexMapView(canvas,{select:()=>{}});preview.setDocument(candidate.doc,true);}
        pending=false;generate.disabled=false;adopt.disabled=!prepared;
      }
    },{disabled:true});
    panel.append(generate,adopt,app._button('閉じる',cleanup));app._worldPreview={panel,kind:'world',destroy:cleanup};MeldexMapChrome.openPanel(panel);
  }
  return Object.freeze({defaults,scales,presentations,parameters,adopt,prepare,show});
});
