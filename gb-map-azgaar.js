/* Azgaar's native vector geometry; no remote services or arbitrary SVG markup. */
(function(root,factory){const node=typeof module==='object'&&module.exports,api=factory(root,node?require('./gb-map-atlas-surface.js'):root.MeldexMapAtlasSurface,node?require('./gb-map-terrain-field.js'):root.MeldexMapTerrainField);if(node)module.exports=api;else root.MeldexMapAzgaar=api;})(globalThis,function(root,Surface,Field){
  'use strict';
  const version='1.156.0',revision='67d555b83f0b2f40ae50b03c9bbfd018175acc6d';
  const workerURL=typeof document==='undefined'?'':new URL('vendor/azgaar/azgaar-worker.js',document.currentScript?.src||location.href).href;
  const modes=['biomes','elevation','temperature','rain','political'];
  const pathOK=p=>typeof p==='string'&&p.length>0&&p.length<=4e6&&/^[MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]+$/.test(p)&&/^[Mm]/.test(p)
    &&(p.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[]).every(n=>Number.isFinite(+n)&&Math.abs(+n)<=1e7);
  const colorOK=c=>typeof c==='string'&&/^#[\da-f]{6}$/i.test(c);
  function valid(a){
    if(!a||a.version!==1||a.engine!=='Azgaar'||!Number.isFinite(a.width)||!Number.isFinite(a.height)||a.width<128||a.height<128||a.width>4096||a.height>4096||!modes.includes(a.presentation))return false;
    if(a.surface!=null&&!Surface.valid(a.surface,a.width,a.height))return false;
    if(!Field.valid(a.editor,a.width,a.height)||a.locked!==undefined&&typeof a.locked!=='boolean')return false;
    if(!Array.isArray(a.shores)||!a.shores.length||a.shores.length>2000||!a.shores.every(pathOK)||!a.modes||!Array.isArray(a.relief)||a.relief.length>30)return false;
    let size=a.shores.reduce((n,p)=>n+p.length,0);
    for(const shapes of [...modes.map(m=>a.modes[m]),a.relief]){
      if(!Array.isArray(shapes)||shapes.length>2000||!shapes.every(s=>s&&pathOK(s.path)&&colorOK(s.color)&&Number.isFinite(s.opacity)&&s.opacity>=0&&s.opacity<=1))return false;
      size+=shapes.reduce((n,s)=>n+s.path.length,0);
    }
    return size<=12*1024*1024;
  }
  // 「陸地を追加」「海・湖」「水路」の描き込みを陸の切り抜きへ加える。強さは起伏に使い、陸と海の境目は不透明に描く。
  function landMasks(a){return (a.editor?.edits||[]).filter(e=>['land','water','waterway'].includes(e.kind)).map(e=>{const white=e.kind==='land',r=e.radius*(e.kind==='waterway'?.15:1);return e.points.length===1?`<circle cx="${e.points[0][0]}" cy="${e.points[0][1]}" r="${r}" fill="${white?'white':'black'}"/>`:`<path d="M${e.points.map(p=>p.join(',')).join('L')}" fill="none" stroke="${white?'white':'black'}" stroke-width="${r*2}" stroke-linecap="round" stroke-linejoin="round"/>`;}).join('');}
  // 地図の見た目のスタイル。色は海・海岸線・陸の下地、filter は起伏テクスチャの色調、line は等高線の色。
  const styles=Object.freeze({
    standard:{label:'標準',ocean:'#82aaba',coast:'#799caa',land:'#d9ddbe',filter:'',line:'#6f6650',lineOpacity:.45},
    parchment:{label:'羊皮紙（中世ファンタジー）',ocean:'#cdb98f',coast:'#5b4126',land:'#eadbb4',filter:'<feColorMatrix type="matrix" values=".39 .77 .19 0 0 .35 .69 .17 0 0 .27 .53 .13 0 0 0 0 0 1 0"/><feComponentTransfer><feFuncR type="linear" slope=".9" intercept=".08"/><feFuncG type="linear" slope=".85" intercept=".06"/><feFuncB type="linear" slope=".75" intercept=".03"/></feComponentTransfer>',line:'#6b4a2b',lineOpacity:.55},
    mono:{label:'モノクロ',ocean:'#d8d8d8',coast:'#3c3c3c',land:'#f2f2f2',filter:'<feColorMatrix type="saturate" values="0"/>',line:'#3c3c3c',lineOpacity:.5},
    ink:{label:'インク（線画）',ocean:'#f3f1ea',coast:'#1d1d1d',land:'#fdfcf7',filter:'<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".35"/></feComponentTransfer>',line:'#1d1d1d',lineOpacity:.7},
  });
  const styleIds=Object.keys(styles);
  function svg(a,options={}){
    if(!valid(a))throw new Error('Azgaar地図の描画データが不正です');
    const shore=a.shores.map(p=>`<path d="${p}"/>`).join('');
    const shapes=a.modes[a.presentation].map(s=>`<path d="${s.path}" fill="${s.color}" opacity="${s.opacity}"/>`).join('');
    const relief=['biomes','political'].includes(a.presentation)?a.relief.map(s=>`<path d="${s.path}" fill="${s.color}" opacity="${s.opacity}"/>`).join(''):'';
    const bounds=options.bounds||[0,0,a.width,a.height],resolution=options.resolution||2048;
    if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[2]<=0||bounds[3]<=0||Math.max(...bounds.map(Math.abs))>1e7||!Number.isFinite(resolution)||resolution<16||resolution>4096)throw Error('地図の表示範囲が不正です');
    const rw=Math.max(16,Math.floor(Math.min(resolution,4090,4090*bounds[2]/bounds[3],Math.sqrt(11e6*bounds[2]/bounds[3])))),rh=Math.max(1,Math.round(rw*bounds[3]/bounds[2])),pixel=bounds[2]/rw,bleed=pixel*3,b=[bounds[0]-bleed,bounds[1]-bleed,bounds[2]+bleed*2,bounds[3]+bleed*2];
    const texture=a.surface&&typeof root.document?.createElement==='function'?Field.url(a,a.presentation,b,rw+6,rh+6,options.display||{}):null;
    const style=styles[options.style]||styles.standard;
    const image=texture?`<image href="${texture}" x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" preserveAspectRatio="none"${style.filter?' filter="url(#tone)"':''}/>`:'';
    const contourLines=texture&&options.contours?Field.contours(a,b,options.contourInterval||10,Math.min(96,Math.max(24,Math.round(rw/8)))).map(c=>`<path d="${c.d}" stroke-width="${(c.major?1.6:.8)*pixel}"/>`).join(''):'';
    const contourGroup=contourLines?`<g fill="none" stroke="${style.line}" opacity="${style.lineOpacity}" stroke-linecap="round">${contourLines}</g>`:'';
    const land=texture?(a.presentation==='political'?((options.display?.countries===false?'':shapes)+image):image):shapes+relief;
    const masks=landMasks(a);
    if(texture)return `<svg xmlns="http://www.w3.org/2000/svg" width="${rw}" height="${rh}" preserveAspectRatio="none" viewBox="${bounds.join(' ')}"><defs><clipPath id="paper"><rect width="${a.width}" height="${a.height}"/></clipPath><mask id="land" maskUnits="userSpaceOnUse" x="0" y="0" width="${a.width}" height="${a.height}"><rect width="${a.width}" height="${a.height}" fill="black"/><g fill="white">${shore}</g>${masks}</mask><filter id="coast" filterUnits="userSpaceOnUse" x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}"><feMorphology in="SourceAlpha" operator="dilate" radius="${pixel*.8}" result="edge"/><feComposite in="edge" in2="SourceAlpha" operator="out" result="outline"/><feFlood flood-color="${style.coast}"/><feComposite in2="outline" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>${style.filter?`<filter id="tone" color-interpolation-filters="sRGB">${style.filter}</filter>`:''}</defs><g clip-path="url(#paper)"><rect width="${a.width}" height="${a.height}" fill="${style.ocean}"/><g filter="url(#coast)"><g mask="url(#land)"><rect x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" fill="${style.land}"/>${land}${contourGroup}</g></g></g></svg>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.width}" height="${a.height}" viewBox="0 0 ${a.width} ${a.height}"><defs><clipPath id="land">${shore}</clipPath><linearGradient id="ocean" x2="0" y2="1"><stop stop-color="#91b6c3"/><stop offset=".5" stop-color="#779faf"/><stop offset="1" stop-color="#86aebc"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#ocean)"/><g fill="none" stroke="#bfd6d6" stroke-width="3">${shore}</g><g fill="#c3cca3">${shore}</g><g clip-path="url(#land)">${land}</g><g fill="none" stroke="#607e7a" stroke-width=".45">${shore}</g></svg>`;
  }
  // 旧方式の格子地形（高さ -1〜1、0以下は海）を、Azgaar方式の地形（起伏の面・海岸線・配色）へ変換する。
  // 変換前の地図は版として残してから呼ぶこと（呼び出し側の責任）。陸地ブラシや等高線は変換後の地形で使える。
  function fromLegacyTerrain(doc){
    // 地形の座標は最大4096まで（大きなキャンバスは縮めた座標で持ち、表示はキャンバスへ引き伸ばす）。
    const t=doc?.terrain,CW=doc?.canvas?.width,CH=doc?.canvas?.height,k=Math.min(1,4096/Math.max(CW||1,CH||1)),W=Math.max(128,Math.round(CW*k)),H=Math.max(128,Math.round(CH*k));
    if(!t||!Number.isInteger(t.cols)||!Number.isInteger(t.rows)||!Array.isArray(t.heights)||t.heights.length!==t.cols*t.rows)throw new Error('旧方式の地形が不正です');
    const step=Math.max(1,Math.ceil(Math.sqrt(t.cols*t.rows/60000))),cols=Math.max(2,Math.floor((t.cols-1)/step)+1),rows=Math.max(2,Math.floor((t.rows-1)/step)+1);
    const at=(x,y)=>t.heights[Math.min(t.rows-1,y*step)*t.cols+Math.min(t.cols-1,x*step)];
    const points=[],triangles=[],heights=[],temperature=[],rain=[],biomes=[];
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const v=at(x,y),h=Math.round(v>0?20+v*80:Math.max(0,20+v*20)),lat=Math.abs(y/(rows-1)-.5)*2,temp=Math.round(Math.max(-35,Math.min(60,30-55*lat-Math.max(0,h-20)*.4)));
      points.push([x/(cols-1)*W,y/(rows-1)*H]);heights.push(Math.min(100,h));temperature.push(temp+64);rain.push(90);
      biomes.push(h<20?0:temp<-10?11:temp<0?10:temp<5?9:h>78?10:h<28?4:temp>24?5:6);
    }
    for(let y=0;y<rows-1;y++)for(let x=0;x<cols-1;x++){const i=y*cols+x;triangles.push(i,i+1,i+cols,i+1,i+cols+1,i+cols);}
    const cw=W/t.cols,ch=H/t.rows,runs=[];
    for(let y=0;y<t.rows;y++){let x=0;while(x<t.cols){if(t.heights[y*t.cols+x]>0){const x0=x;while(x<t.cols&&t.heights[y*t.cols+x]>0)x++;runs.push(`M${(x0*cw).toFixed(2)},${(y*ch).toFixed(2)}h${((x-x0)*cw).toFixed(2)}v${ch.toFixed(2)}h${(-(x-x0)*cw).toFixed(2)}Z`);}else x++;}}
    const shore=runs.join('')||'M0,0h0Z',land=c=>[{path:shore,color:c,opacity:1}];
    const atlas={version:1,engine:'Azgaar',engine_version:version,revision,width:W,height:H,presentation:'biomes',shores:[shore],
      modes:{biomes:land('#b1c38e'),elevation:land('#b7c79c'),temperature:land('#d8c48f'),rain:land('#9fc0a8'),political:land('#c9c2a8')},relief:[],
      surface:Surface.encode(points,triangles,{heights,temperature,rain,biomes})};
    if(!valid(atlas))throw new Error('旧方式の地形を変換できません（海岸線が複雑すぎます）');
    return atlas;
  }
  const url=(a,options)=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg(a,options));
  function signature(points){let hash=2166136261;const [x,y]=points[0];for(const p of points){const s=`${Math.round((p[0]-x)*1e4)},${Math.round((p[1]-y)*1e4)};`;for(let i=0;i<s.length;i++)hash=Math.imul(hash^s.charCodeAt(i),16777619);}return (hash>>>0).toString(16);}
  function geometry(f){const g=f.cartography?.geometry;if(!g||!pathOK(g.path)||!Array.isArray(g.scale)||g.scale.length!==2||!g.scale.every(n=>Number.isFinite(n)&&n>0&&n<=128)||!Array.isArray(g.anchor)||g.anchor.length!==2||!g.anchor.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7)||typeof g.closed!=='boolean'||g.line_style!==undefined&&(!['straight','curve'].includes(g.line_style)||g.line_style!==(f.line_style||'straight'))||g.signature!==signature(f.points))return null;return g;}
  function attach(f,path,scale,closed=false){f.cartography.geometry={path,scale,anchor:[...f.points[0]],closed,line_style:f.line_style||'straight',signature:signature(f.points)};return f;}
  function generate(options,signal){
    return new Promise((resolve,reject)=>{
      if(signal?.aborted){reject(new DOMException('中止しました','AbortError'));return;}
      let worker,timer;const finish=(error,result)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker?.terminate();error?reject(error):resolve(result);};
      const abort=()=>finish(new DOMException('中止しました','AbortError'));
      try{worker=new Worker(workerURL);worker.onmessage=({data})=>finish(data.ok?null:new Error('Azgaarの生成に失敗しました: '+data.error),data);worker.onerror=()=>finish(new Error('Azgaarを読み込めませんでした。アプリのファイルを確認してください'));signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(new Error('地図生成が時間内に完了しませんでした。地形の細かさを下げて再試行してください')),90000);worker.postMessage(options);}catch(error){finish(error);}
    });
  }
  async function raster(a){const image=new Image();image.src=url(a);await image.decode();const c=document.createElement('canvas');c.width=a.width*2;c.height=a.height*2;c.getContext('2d').drawImage(image,0,0,c.width,c.height);return c.toDataURL('image/png');}
  return Object.freeze({version,revision,modes,styles,styleIds,pathOK,colorOK,valid,svg,landMasks,fromLegacyTerrain,url,geometry,attach,generate,raster});
});
