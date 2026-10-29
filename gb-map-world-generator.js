/* A single guarded transaction builds an internally consistent fantasy world. */
(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./gb-map-document.js'):root.MeldexMapDocument,node?require('./gb-map-world-terrain.js'):root.MeldexMapWorldTerrain,node?require('./gb-map-world-geography.js'):root.MeldexMapWorldGeography,node?require('./gb-map-world-society.js'):root.MeldexMapWorldSociety,node?require('./gb-map-grid.js'):root.MeldexMapGrid);
  if(node)module.exports=api;else root.MeldexMapWorldGenerator=api;
})(globalThis,function(D,T,G,S,Grid){
  'use strict';
  const defaults=Object.freeze({seed:'',name:'新しい世界',template:'continent',land:37,roughness:72,warmth:50,wetness:55,cities:32,nations:10,widthKm:24000});
  const presentations=[['biomes','自然・植生'],['elevation','標高'],['temperature','気温'],['rain','降水'],['political','国家']];
  function parameters(input={}){
    const o=Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,input[key]??value]));
    if(typeof o.seed!=='string'||!o.seed.trim()||o.seed.length>128||typeof o.name!=='string'||!o.name.trim()||[...o.name].length>64||!['continent','island','archipelago'].includes(o.template))throw new Error('シード・世界名・地形の種類を確認してください');
    for(const [key,lo,hi]of[['land',10,80],['roughness',0,100],['warmth',0,100],['wetness',0,100],['widthKm',100,60000],['cities',4,80],['nations',1,24]])if(!Number.isFinite(o[key])||o[key]<lo||o[key]>hi||['cities','nations'].includes(key)&&!Number.isInteger(o[key]))throw new Error('世界地図生成の数値条件を確認してください');
    if(o.nations>o.cities)throw new Error('国家数は都市数以下にしてください');
    return o;
  }
  function prepare(source,input){
    const doc=D.parse(source),o=parameters(input);
    if(doc.coordinate_system!=='local')throw new Error('創作地図で実行してください');
    if(doc.layers.length>93)throw new Error('世界地図には7つのレイヤーを追加します。レイヤーの上限100件を超えます');
    const cols=doc.canvas.width>=doc.canvas.height?256:Math.max(32,Math.round(256*doc.canvas.width/doc.canvas.height)),rows=Math.max(32,Math.min(256,Math.round(cols*doc.canvas.height/doc.canvas.width)));
    const terrain=T.generate(o.seed,o.template,o.land/100,o.roughness,{cols,rows}),climateOptions={seed:o.seed,warmth:o.warmth,wetness:o.wetness,north:doc.scale.north_degrees};
    let analysis=G.analyze(terrain,climateOptions);
    // Retain resolvable lakes. Fill smaller depressions to their spill surface
    // so a visible river cannot climb ground hidden beneath an omitted pond.
    terrain.heights=terrain.heights.map((h,i)=>h>0&&!analysis.lake[i]?Math.max(h,analysis.filled[i]):h);
    terrain.conditioning_version=1;analysis=G.analyze(terrain,climateOptions);
    const previous=new Set(doc.layers.filter(l=>l.generation?.kind==='coherent-world').map(l=>l.id));
    const existing=doc.features.filter(f=>f.kind==='pin'&&!previous.has(f.layer_id)).map(f=>[f.points[0][0]/doc.canvas.width,f.points[0][1]/doc.canvas.height]);
    const society=S.generate(terrain,analysis,{...o,existing}),rivers=G.rivers(terrain,analysis),group=D.id(),layers={},features=[];
    const toMap=p=>[p[0]*doc.canvas.width,p[1]*doc.canvas.height];
    const addLayer=(key,name)=>{const layer={id:D.id(),name,visible:true,locked:false,opacity:1,generation:{kind:'coherent-world',generator_version:3,group,part:key}};layers[key]=layer;return layer;};
    for(const [key,label]of[['cities','都市・港'],['labels','地名'],['borders','国境'],['roads','陸路'],['shipping','航路'],['rivers','河川'],['lakes','湖']])addLayer(key,label+'（'+o.name+'）');
    const add=(kind,points,key,label,color,role,extra={})=>{const f={...D.feature(kind,points.map(toMap),layers[key].id,label),color,tags:[({'cities':'都市','labels':'地名','borders':'国家','roads':'陸路','shipping':'航路','rivers':'河川','lakes':'湖'})[key]],cartography:{role},...extra};features.push(f);return f;};
    for(const [index,river]of rivers.entries())add('route',river.points,'rivers','河川 '+(index+1),'#397f9c','river',{cartography:{role:'river',flow:Math.round(river.flow)},description:'降水の集積と標高から生成した水系。合流して海または湖へ流れます。',line_style:'curve'});
    for(const state of society.states)add('label',[state.point],'labels',state.name,state.color,'country-label');
    for(const city of society.cities){const state=society.states[city.country];add('pin',[city.point],'cities',city.name,city.capital?'#65433c':'#46564c','city',{
      icon:city.port?'port':city.capital?'castle':'city',cartography:{role:'city',capital:city.capital,rank:city.capital||city.port?'major':'minor'},
      tags:[city.port?'港':'都市',...(city.capital?['首都']:[]),...(state?[state.name]:[])],description:`${state?.name||'未所属'}。${city.port?'外海に接する港。':'水と気候、勾配を考慮した居住地。'}標高の目安 ${Math.round(terrain.heights[city.cell]*6500)}m、年平均気温の目安 ${Math.round(analysis.temperature[city.cell])}℃。`});}
    for(const border of society.borders)add('route',border.points,'borders',border.pair.map(i=>society.states[i].name).join(' / '),'#806855','border',{line_style:'curve',description:'首都からの移動費用と山地・河川の障壁による国境。'});
    for(const road of society.roads)add('route',road.points,'roads',society.cities[road.from].name+' — '+society.cities[road.to].name,'#91765a','road',{description:'海と湖を避け、勾配・峠・河川の横断費用を考慮した陸路。',travel_plan:{schema_version:1,unit:'km',speed:5,daily_hours:8,rest_days:0}});
    for(const route of society.seaRoutes)add('route',route.points,'shipping',society.cities[route.from].name+' — '+society.cities[route.to].name,'#607d8b','shipping',{dashed:true,description:'港から外海へ出て、陸地を横切らない航路。',travel_plan:{schema_version:1,unit:'km',speed:15,daily_hours:12,rest_days:0}});
    const lakeCells=Array.from(analysis.lake),lakeIds=[...new Set(lakeCells)].filter(Boolean);
    for(const id of lakeIds){const polygons=Grid.polygons(lakeCells,cols,rows,id);for(const poly of polygons){const outline=polygons.length===1?poly.flatMap((p,i)=>{const q=poly[(i+1)%poly.length];return [[p[0]*.75+q[0]*.25,p[1]*.75+q[1]*.25],[p[0]*.25+q[0]*.75,p[1]*.25+q[1]*.75]];}):poly;
      add('region',outline.map(([x,y])=>[T.clamp((x-.5)/(cols-1)),T.clamp((y-.5)/(rows-1))]),'lakes','湖 '+id,'#77aabd','lake');}}
    const mountains=T.components(terrain.heights.map(h=>h>.42),cols,rows).groups.filter(g=>g.length>=5).sort((a,b)=>b.length-a.length).slice(0,8);
    const mountainNames=S.placeNames(o.seed+':mountains',mountains.length);
    const mountainLabels=[];
    mountains.forEach((cells,i)=>{const center=cells.reduce((best,k)=>terrain.heights[k]>terrain.heights[best]?k:best,cells[0]),p=S.point(center,analysis);if(mountainLabels.some(q=>Math.hypot((p[0]-q[0])*cols,(p[1]-q[1])*rows)<cols*.14))return;mountainLabels.push(p);add('label',[p],'labels',mountainNames[i]+'山脈','#6a6257','mountain-label');});
    terrain.environment=G.environment(terrain,analysis);terrain.environment.owner=Array.from(society.owner);terrain.environment.countries=society.states.map(s=>s.color);terrain.presentation='biomes';
    if(doc.features.length+features.length>10000||[...doc.features,...features].reduce((sum,f)=>sum+f.points.length,0)>100000)throw new Error('図形または頂点の上限を超えます。元の地図を保持したまま生成を中止しました');
    const stats={landRatio:analysis.landCount/terrain.heights.length,landmasses:analysis.masses.groups.filter(g=>g.length>=30).length,rivers:rivers.length,lakes:lakeIds.length,cities:society.cities.length,ports:society.cities.filter(c=>c.port).length,nations:society.states.length,roads:society.roads.length,seaRoutes:society.seaRoutes.length};
    for(const layer of doc.layers)if(previous.has(layer.id))layer.visible=false;
    doc.layers.push(...Object.values(layers));doc.features.push(...features);doc.terrain=terrain;doc.background=null;
    doc.scale={...doc.scale,distance_per_unit:o.widthKm/doc.canvas.width,unit:'km'};
    doc.world_generation={version:3,parameters:o,stats,group,layer_ids:Object.values(layers).map(l=>l.id)};
    D.parse(JSON.stringify(doc,null,2));
    return {doc,stats,parameters:o,analysis,society,rivers,previousLayers:[...previous],layers};
  }
  function show(app){
    app._commitInput();if(app._inputDirty)throw new Error('入力内容を確認してください');
    if(app.editingDisabled||app.store.doc.coordinate_system!=='local')throw new Error('編集できる創作地図で実行してください');
    app._generatorPreview?.destroy();app._settlementsPreview?.destroy();app._climatePreview?.destroy();app._worldPreview?.destroy();
    const store=app.store,path=app.path,canEdit=app._editGuard(),panel=document.createElement('div');panel.className='gb-map-generator gb-map-world-generator';panel.setAttribute('role','region');panel.setAttribute('aria-label','世界地図生成のプレビュー');
    const title=document.createElement('h3');title.textContent='世界地図を生成';const help=document.createElement('p');help.textContent='地形・水系・気候・植生から都市、国境、陸路と航路をまとめて作成します。プレビューで確認してから採用してください。';panel.append(title,help);
    let prepared=null,source=null,signature='',preview=null,pending=false;const controls={},previous=store.doc.world_generation?.parameters||{};
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='条件を設定してください。';
    const clear=()=>{prepared=null;preview?.destroy();preview=null;canvas.replaceChildren();adopt.disabled=true;};
    const input=(key,label,value,attrs={})=>{const wrap=document.createElement('label');wrap.className='gb-map-field';const text=document.createElement('span');text.textContent=label;const c=document.createElement('input');c.className=attrs.type==='number'?'gb-input gb-num-input':'gb-input';c.setAttribute('aria-label',label);Object.assign(c,attrs);c.required=true;c.value=value;c.oninput=c.onchange=()=>{clear();status.textContent='条件が変わりました。プレビューを作り直してください。';};wrap.append(text,c);panel.append(wrap);controls[key]=c;};
    input('name','世界名',previous.name||app.state.label||defaults.name,{maxLength:64});input('seed','シード',previous.seed||String(Date.now()),{maxLength:128});
    const wrap=document.createElement('label');wrap.className='gb-map-field';wrap.append('地形の種類');const template=document.createElement('select');template.className='gb-select';template.setAttribute('aria-label','地形の種類');for(const [key,name]of[['continent','大陸'],['archipelago','群島'],['island','島']])template.add(new Option(name,key));template.value=previous.template||defaults.template;template.onchange=clear;wrap.append(template);panel.append(wrap);controls.template=template;
    for(const [key,label,min,max]of[['land','陸地の割合（%）',10,80],['roughness','山地の起伏（0〜100）',0,100],['warmth','暖かさ（0〜100）',0,100],['wetness','湿り気（0〜100）',0,100],['cities','都市数',4,80],['nations','国家数',1,24],['widthKm','地図の横幅（km）',100,60000]])input(key,label,previous[key]??defaults[key],{type:'number',min,max,step:1});
    const mode=document.createElement('select');mode.className='gb-select';mode.setAttribute('aria-label','プレビューの配色');for(const [key,name]of presentations)mode.add(new Option(name,key));mode.onchange=()=>{if(prepared){prepared.doc.terrain.presentation=mode.value;preview?.setDocument(prepared.doc,true);}};
    const modeLabel=document.createElement('label');modeLabel.className='gb-map-field';modeLabel.append('プレビューの配色',mode);
    const canvas=document.createElement('div');canvas.className='gb-map-generator-preview gb-map-world-preview';panel.append(modeLabel,status,canvas);
    const values=()=>Object.fromEntries(Object.entries(controls).map(([k,c])=>[k,c.type==='number'?Number(c.value):c.value]));
    const conditions=()=>JSON.stringify(Object.values(controls).map(c=>c.value));
    const current=()=>panel.isConnected&&canEdit()&&app.store===store&&app.path===path&&app._active!==false;
    const cleanup=()=>{MeldexMapChrome.closePanel(panel);preview?.destroy();preview=null;prepared=null;panel.remove();if(app._worldPreview?.panel===panel)app._worldPreview=null;};
    const generate=app._button('世界地図をプレビュー',async()=>{
      if(pending||!current()||!Object.values(controls).every(c=>c.reportValidity()))return;
      clear();pending=true;generate.disabled=true;status.textContent='地形・水系・都市と交通を生成しています…';
      try{await new Promise(resolve=>requestAnimationFrame(resolve));if(!current())return;source=store.doc;signature=conditions();prepared=prepare(source,values());prepared.doc.terrain.presentation=mode.value;
        if(!current()||source!==store.doc||signature!==conditions()){clear();return;}
        preview=new MeldexMapView(canvas,{select:()=>{}});preview.setDocument(prepared.doc,true);const s=prepared.stats;
        status.textContent=`陸地${Math.round(s.landRatio*100)}%・主な陸塊${s.landmasses}・河川${s.rivers}・湖${s.lakes}・都市${s.cities}（港${s.ports}）・国家${s.nations}・陸路${s.roads}・航路${s.seaRoutes}。採用すると背景と縮尺を更新します。以前の世界生成レイヤーは保持して非表示にします。`;
      }catch(e){clear();status.textContent=e.userMessage||e.message;}finally{pending=false;generate.disabled=false;adopt.disabled=!prepared;}
    });
    const adopt=app._button('この世界地図を採用',async()=>{
      if(pending||!prepared||!current())return;const candidate=prepared;const valid=()=>current()&&prepared===candidate&&store.doc===source&&signature===conditions();
      if(!valid()){clear();status.textContent='地図または条件が変更されました。プレビューを作り直してください。';return;}
      pending=true;generate.disabled=adopt.disabled=true;
      try{if((source.terrain||source.background)&&!await cfConfirm('背景と縮尺を生成した世界地図へ更新します。手描き図形を保持し、以前の世界生成レイヤーは非表示にします。採用しますか？'))return;
        if(!valid())return;const access=await MeldexEntityDetail.resolveReadOnly(path,false);if(!valid())return;if(access.readOnly){status.textContent=access.reason||'編集ロック中のため採用できません';return;}
        if(app.update(d=>Object.assign(d,candidate.doc))){for(const id of candidate.previousLayers)if(app.state.mapLayerVisibility)delete app.state.mapLayerVisibility[id];app.state.mapSearch='';app.state.mapFeatureKind='';app.search.value='';app.kindFilter.value='';app._selection=new Set();app._selected=null;app._activeLayer=candidate.layers.cities.id;cleanup();app._buildSettingsRefresh();app._render();app.view.fit();app._saveViewState();}
      }finally{pending=false;generate.disabled=false;adopt.disabled=!prepared;}
    },{disabled:true});
    panel.append(generate,adopt,app._button('閉じる',cleanup));app._worldPreview={panel,kind:'world',destroy:cleanup};MeldexMapChrome.openPanel(panel);
  }
  return Object.freeze({defaults,presentations,parameters,prepare,show});
});
