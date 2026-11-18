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
 // 地点の記号に使える同梱素材（vendor/map-assets/symbols、CC0）。名前は保存値、ラベルは画面表示。
 const stamps=Object.freeze([['castle','城'],['castleTall','高い城'],['castleWide','城塞'],['church','教会'],['churchLarge','大聖堂'],['tower','塔'],['towerTall','高い塔'],['watchtower','見張り塔'],['lighthouse','灯台'],['house','家'],['houses','町並み'],['houseSmall','小さな家'],['mill','風車小屋'],['waterWheel','水車'],['mine','鉱山'],['well','井戸'],['stable','厩舎'],['tent','天幕'],['campfire','野営地'],['graveyard','墓地'],['ruins','遺跡'],['pyramid','ピラミッド'],['rocksMountain','山'],['rocksTall','岩山'],['vulcano','火山'],['treePine','針葉樹'],['treePines','針葉樹林'],['treeTall','広葉樹'],['bush','茂み'],['palm','ヤシ'],['cactus','サボテン'],['lake','湖'],['ship','船'],['dock','港'],['bridge','橋'],['gate','門'],['wall','城壁'],['flag','旗'],['banner','旗印'],['chest','宝'],['skull','危険地帯'],['compass','方位記号']].map(([id,label])=>Object.freeze([id,label]))),stampIds=new Set(stamps.map(s=>s[0]));
 const stampURL=id=>stampIds.has(id)?'vendor/map-assets/symbols/'+id+'.png':'';
 return Object.freeze({categories,keys,valid,effective,category,visible,labels,symbols,stamps,stampIds,stampURL});
});
