/* Terrain and visibility controls use Meldex's existing options and modal shell. */
(function(root){
 'use strict';const D=()=>root.MeldexMapDocument,F=()=>root.MeldexMapTerrainField,V=()=>root.MeldexMapDisplay;
 const brushes=[['land','陸地を追加'],['water','海・湖'],['plain','平野'],['mountain','山地'],['hills','丘陵'],['desert','砂漠'],['wasteland','荒野'],['snow','雪原'],['forest','森林']];
 const routes=[['major','主要道路'],['road','道路・小径'],['railway','鉄道・線路'],['shipping','航路'],['river','川・水路'],['other','その他']];
 function input(parent,label,value,attrs,change){const wrap=document.createElement('label');wrap.className='gb-map-field';const text=document.createElement('span');text.textContent=label;const el=document.createElement('input');el.className='gb-input gb-num-input';el.required=true;Object.assign(el,attrs);el.setAttribute('aria-label',label);el.value=value;el.onchange=()=>{if(el.reportValidity())change(el.value);};wrap.append(text,el);parent.append(wrap);return el;}
 function select(parent,label,values,value,change,disabled=false){const wrap=document.createElement('label');wrap.className='gb-map-field';wrap.append(label);const el=document.createElement('select');el.className='gb-select';el.setAttribute('aria-label',label);el.disabled=disabled;for(const [id,text]of values)el.add(new Option(text,id));el.value=value;el.onchange=()=>change(el.value);wrap.append(el);parent.append(wrap);return el;}
 function display(parent,app){const section=document.createElement('details'),title=document.createElement('summary');title.textContent='表示する要素';section.className='gb-map-element-options';section.append(title);parent.append(section);
   const current=V().effective({...app.store.doc.display,...app.state.mapElementVisibility});
   for(const [key,name]of V().categories){const label=document.createElement('label');label.className='gb-check';const check=document.createElement('input');check.type='checkbox';check.checked=current[key];check.setAttribute('aria-label',name+'を表示');check.onchange=()=>{const current=V().effective({...app.store.doc.display,...app.state.mapElementVisibility});if(app.editingDisabled){app.state.mapElementVisibility={...current,[key]:check.checked};}else{const next={...current,[key]:check.checked};if(!app.update(d=>{d.display=next;})&&!Object.entries(next).every(([k,v])=>app.store.doc.display?.[k]===v)){check.checked=current[key];return;}delete app.state.mapElementVisibility;}app._saveViewState();app._render();};label.append(check,document.createTextNode(' '+name));section.append(label);}
 }
 function settings(parent,app){
   display(parent,app);
   select(parent,'描画する経路の種類',routes,app.view?.routeKind||'major',value=>{app.view.routeKind=value;},app.editingDisabled);
   parent.append(app._button('川をフリーハンドで描く',()=>app._setTool('river'),{disabled:app.editingDisabled}));
   const labelStyle=app.store.doc.map_style||{};
   select(parent,'地名の書体',[['standard','標準'],['fell','古地図風（IM FELL）'],['medieval','中世風（MedievalSharp）']],labelStyle.label_font||'standard',value=>{if(app.update(d=>{d.map_style={...(d.map_style||{}),label_font:value};},true,'マップ: 地名の書体を変更')){app._buildSettingsRefresh?.();app._render();}},app.editingDisabled);
   if(!app.store.doc.atlas?.surface)return;
   const style=app.store.doc.map_style||{},setStyle=(patch,label)=>{if(app.update(d=>{d.map_style={...(d.map_style||{}),...patch};},true,label)){app._buildSettingsRefresh?.();app._render();}};
   select(parent,'地図のスタイル',root.MeldexMapAzgaar.styleIds.map(id=>[id,root.MeldexMapAzgaar.styles[id].label]),style.theme||'standard',value=>setStyle({theme:value},'マップ: スタイルを変更'),app.editingDisabled);
   const contour=document.createElement('label');contour.className='gb-check';const cc=document.createElement('input');cc.type='checkbox';cc.setAttribute('aria-label','等高線を表示');cc.checked=!!style.contours;cc.disabled=app.editingDisabled;cc.onchange=()=>setStyle({contours:cc.checked},'マップ: 等高線の表示を変更');contour.append(cc,document.createTextNode(' 等高線を表示'));parent.append(contour);
   select(parent,'等高線の間隔',[['5','細かい'],['10','標準'],['20','粗い']],String(style.contour_interval||10),value=>setStyle({contour_interval:Number(value)},'マップ: 等高線の間隔を変更'),app.editingDisabled||!style.contours);
   select(parent,'地形ブラシ',brushes,app.view?.terrainKind||'land',value=>{app.view.terrainKind=value;app._setTool('land');},app.editingDisabled||app.store.doc.atlas.locked);
   input(parent,'地形ブラシの強さ',app.view?.terrainStrength||.7,{type:'number',min:.05,max:1,step:.05,disabled:app.editingDisabled},v=>{app.view.terrainStrength=Number(v);});
   const lock=document.createElement('label');lock.className='gb-check';const c=document.createElement('input');c.type='checkbox';c.setAttribute('aria-label','地形をロック');c.checked=!!app.store.doc.atlas.locked;c.disabled=app.editingDisabled;c.onchange=()=>{app.update(d=>{d.atlas.locked=c.checked;});app._buildSettingsRefresh();app._render();};lock.append(c,document.createTextNode(' 地形をロック'));parent.append(lock);
   parent.append(app._button('周囲の地形を合わせる',()=>showFit(app),{disabled:app.editingDisabled||app.store.doc.atlas.locked}));
 }
 function routeFields(parent,app,feature,locked){const kind=feature.cartography?.role==='road'?(feature.cartography.rank==='major'?'major':'road'):feature.cartography?.role||'other';select(parent,'経路の種類',routes,routes.some(r=>r[0]===kind)?kind:'other',value=>app._editFeature(f=>{f.cartography={...f.cartography,role:value==='major'?'road':value==='other'?'':value,rank:value==='major'?'major':'minor'};delete f.cartography.geometry;}),locked);}
 function converted(doc,editor){const result=D().clone(doc);result.atlas.editor=editor;const upgrade=result.schema_version!==2;result.schema_version=2;result.background=null;if(upgrade)D().parse(JSON.stringify(result));return result;}
 async function paint(app,action){
   const source=app.store.doc,store=app.store,path=app.path,guard=app._editGuard(),upgrading=source.schema_version!==2,signature=upgrading?JSON.stringify(source):'';if(!guard()||!source.atlas?.surface||source.atlas.locked||app._terrainPending)return;
   const points=action.points.map(p=>[p[0]/source.canvas.width*source.atlas.width,p[1]/source.canvas.height*source.atlas.height]),radius=Math.min(Math.max(source.atlas.width,source.atlas.height)/2,action.radius/source.canvas.width*source.atlas.width);
   const candidate=converted(source,F().stroke(source.atlas,action.kind,points,radius,action.strength));
   const valid=()=>guard()&&app.store===store&&app.path===path&&store.doc===source&&(!upgrading||JSON.stringify(source)===signature)&&!source.atlas.locked&&app._active!==false;
   if(source.schema_version!==2){app._terrainPending=true;try{if(!await cfConfirm('地形を直接編集できる新形式へ変換します。旧版のMeldexでは開けなくなります。PNGや閲覧パッケージで共有できます。変換と描画は「元に戻す」で取り消せます。続けますか？'))return;if(!valid())return;const access=await MeldexEntityDetail.resolveReadOnly(path,false);if(!valid()||access.readOnly){app._message(access.reason||'この地図は編集できません');return;}}finally{app._terrainPending=false;}}
   if(valid()&&app.update(d=>Object.assign(d,candidate))){app._buildSettingsRefresh();app._render();}
 }
 function showFit(app){
   app._commitInput();if(app._inputDirty)throw Error('入力内容を確認してください');
   const store=app.store,source=store.doc,path=app.path,guard=app._editGuard(),signature=JSON.stringify(source);
   if(!guard()||!source.atlas?.surface||source.atlas.locked)throw Error('編集できる地形を選択してください');
   app._worldPreview?.destroy();app._generatorPreview?.destroy();app._settlementsPreview?.destroy();app._climatePreview?.destroy();
   const selected=source.features.filter(f=>app._selection.has(f.id)&&f.kind==='route');if(!selected.length)throw Error('川・道路・線路・航路を選択してください');
   if(selected.some(f=>source.layers.find(l=>l.id===f.layer_id)?.locked))throw Error('選択中の経路のレイヤーがロックされています');
   const panel=document.createElement('div');panel.className='gb-map-generator';const title=document.createElement('h3');title.textContent='周囲の地形を合わせる';const help=document.createElement('p');help.textContent='川は高い側から低い側へ谷を掘り、道路・線路は段差をならし、航路は水路を開きます。線や地点は移動しません。採用すると編集形式v2になり、旧版では開けません。';panel.append(title,help);
   let candidate=null,preview=null,pending=false,settings=null;const status=document.createElement('p');status.setAttribute('role','status');const area=document.createElement('div');area.className='gb-map-generator-preview';
   const clear=()=>{candidate=null;settings=null;preview?.destroy();preview=null;area.replaceChildren();adopt.disabled=true;};
   const radius=input(panel,'周囲を補正する半径（地図単位）',20,{type:'number',min:.1,max:1000,step:.1},clear);
   const valid=()=>panel.isConnected&&guard()&&app.store===store&&store.doc===source&&JSON.stringify(source)===signature&&app.path===path&&app._active!==false&&!source.atlas.locked&&selected.every(f=>!store.doc.layers.find(l=>l.id===f.layer_id)?.locked);
   const cleanup=()=>{preview?.destroy();preview=null;candidate=null;MeldexMapChrome.closePanel(panel);panel.remove();if(app._terrainPreview?.panel===panel)app._terrainPreview=null;};
   const generate=app._button('補正をプレビュー',()=>{if(pending||!valid()||!radius.reportValidity())return;clear();try{let atlas=D().clone(source.atlas);for(const f of selected){const role=f.cartography?.role,kind=role==='river'?'river':role==='railway'?'railway':role==='shipping'?'waterway':'road',points=D().drawPoints(f,source).map(p=>[p[0]/source.canvas.width*atlas.width,p[1]/source.canvas.height*atlas.height]);atlas.editor=F().fit(atlas,kind,points,Number(radius.value)/source.canvas.width*atlas.width,f.id);}candidate=converted(source,atlas.editor);settings=radius.value;preview=new MeldexMapView(area,{select:()=>{}});preview.setDocument(candidate,true);adopt.disabled=false;status.textContent=selected.length+'件の経路の周囲を補正しました。採用前に確認してください。';}catch(error){clear();status.textContent=error.message;}});
   const adopt=app._button('この地形を採用',async()=>{if(pending||!candidate)return;if(!valid()||settings!==radius.value){clear();status.textContent='地図または補正範囲が変更されました。閉じてから補正をやり直してください。';return;}const result=candidate;pending=true;adopt.disabled=generate.disabled=true;try{const access=await MeldexEntityDetail.resolveReadOnly(path,false);if(!valid()||candidate!==result||settings!==radius.value){clear();status.textContent='地図が変更されました。補正は採用していません。';return;}if(access.readOnly){status.textContent=access.reason||'編集ロック中です';return;}if(app.update(d=>Object.assign(d,result))){cleanup();app._buildSettingsRefresh();app._render();}}finally{pending=false;generate.disabled=false;adopt.disabled=!candidate;}},{disabled:true});
   panel.append(status,area,generate,adopt,app._button('閉じる',cleanup));app._terrainPreview?.destroy();app._terrainPreview={panel,destroy:cleanup};MeldexMapChrome.openPanel(panel);
 }
 root.MeldexMapTerrainControls=Object.freeze({brushes,routes,settings,routeFields,paint,showFit});
})(globalThis);
