/* Deterministic fantasy names in Katakana; the Azgaar geography stays intact. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MeldexMapWorldNames=api;})(globalThis,function(){
 'use strict';
 const starts=['ル','ネ','フィ','セ','ヴェ','ラ','リ','ミ','ト','フォ','カ','オ','キ','ニ','ソ','ノ','テ','ユ','イ','ア','フェ','メ','ク','レ'];
 const middles=['ネ','ル','ナ','リ','ヴァ','ゼ','レ','フィ','ロ','ディ','セ','メ','ティ','ファ','ヴィ','ノ'];
 const ends=['ス','ル','ナ','リア','レン','リス','ニア','ヴァ','ネル','ノア','ティス','ラ','レア','ノル','リム','フェン'];
 const forms=['王国','共和国','連邦','公国','諸侯国'];
 function hash(text){let n=2166136261;for(const c of text)n=Math.imul(n^c.codePointAt(0),16777619);n^=n>>>16;return n>>>0;}
 function localize(world,seed,mode='katakana'){
  if(mode==='original')return world;
  if(mode!=='katakana')throw Error('地名の表記を確認してください');
  const used=new Map(),capacity=starts.length*middles.length*ends.length;
  const name=(kind,id)=>{if(!used.has(kind))used.set(kind,new Set());const seen=used.get(kind),at=hash(seed+':katakana-v1:'+kind+':'+id)%capacity;
   // Sequential probing is bounded, so collisions cannot hang a large world.
   for(let j=0;j<capacity;j++){const n=(at+j)%capacity,value=starts[Math.floor(n/(middles.length*ends.length))]+middles[Math.floor(n/ends.length)%middles.length]+ends[n%ends.length];if(!seen.has(value)){seen.add(value);return value;}}
   throw Error('生成できる地名の件数を超えました');
  };
  return {...world,
   states:world.states.map((s,i)=>{const shortName=name('state',s.id??i);return {...s,shortName,name:shortName+forms[hash(seed+':state-form:'+s.id)%forms.length]};}),
   cities:world.cities.map((s,i)=>({...s,name:name('city',s.id??i)+(s.port?'港':'')})),
   rivers:world.rivers.map((s,i)=>({...s,name:name('river',s.id??i)+'川'})),
   lakes:world.lakes.map((s,i)=>({...s,name:name('lake',s.id??i)+'湖'})),
   routes:world.routes.map((s,i)=>({...s,name:name('route',s.id??i)+(s.group==='searoutes'?'航路':s.group==='roads'?'街道':'小径')}))};
 }
 return Object.freeze({version:1,localize});
});
