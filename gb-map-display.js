/* Shared element visibility for the editor, PNG, saved maps and portable viewer. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MeldexMapDisplay=api;})(globalThis,function(){
 'use strict';
 const categories=[['terrain','地形の陰影'],['vegetation','植生の色'],['countries','国家の塗り分け'],['major_roads','主要道路'],['roads','道路・小径'],['railways','鉄道・線路'],['shipping','航路'],['rivers','川・水路'],['borders','国境'],['country_names','国名'],['city_symbols','都市の記号'],['city_names','都市名'],['terrain_names','山・川などの地名'],['other','その他の書き込み']];
 const keys=categories.map(c=>c[0]);
 const valid=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k)&&typeof value[k]==='boolean');
 const effective=value=>Object.fromEntries(keys.map(k=>[k,value?.[k]!==false]));
 function category(f){const role=f.cartography?.role;return ({river:'rivers',shipping:'shipping',railway:'railways',border:'borders','country-label':'country_names','mountain-label':'terrain_names','river-label':'terrain_names'})[role]||(role==='road'?(f.cartography.rank==='major'?'major_roads':'roads'):role==='city'?'city_symbols':'other');}
 function visible(f,v){return f.cartography?.role==='city'?(v.city_names!==false||v.city_symbols!==false):v[category(f)]!==false;}
 const labels=(f,v)=>f.cartography?.role==='city'?v.city_names!==false:visible(f,v);
 const symbols=(f,v)=>f.cartography?.role==='city'?v.city_symbols!==false:visible(f,v);
 return Object.freeze({categories,keys,valid,effective,category,visible,labels,symbols});
});
