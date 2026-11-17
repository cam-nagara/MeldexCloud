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
  function svg(a,options={}){
    if(!valid(a))throw new Error('Azgaar地図の描画データが不正です');
    const shore=a.shores.map(p=>`<path d="${p}"/>`).join('');
    const shapes=a.modes[a.presentation].map(s=>`<path d="${s.path}" fill="${s.color}" opacity="${s.opacity}"/>`).join('');
    const relief=['biomes','political'].includes(a.presentation)?a.relief.map(s=>`<path d="${s.path}" fill="${s.color}" opacity="${s.opacity}"/>`).join(''):'';
    const bounds=options.bounds||[0,0,a.width,a.height],resolution=options.resolution||2048;
    if(!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||bounds[2]<=0||bounds[3]<=0||Math.max(...bounds.map(Math.abs))>1e7||!Number.isFinite(resolution)||resolution<16||resolution>4096)throw Error('地図の表示範囲が不正です');
    const rw=Math.max(16,Math.floor(Math.min(resolution,4090,4090*bounds[2]/bounds[3],Math.sqrt(11e6*bounds[2]/bounds[3])))),rh=Math.max(1,Math.round(rw*bounds[3]/bounds[2])),pixel=bounds[2]/rw,bleed=pixel*3,b=[bounds[0]-bleed,bounds[1]-bleed,bounds[2]+bleed*2,bounds[3]+bleed*2];
    const texture=a.surface&&typeof root.document?.createElement==='function'?Field.url(a,a.presentation,b,rw+6,rh+6,options.display||{}):null;
    const image=texture?`<image href="${texture}" x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" preserveAspectRatio="none"/>`:'';
    const land=texture?(a.presentation==='political'?((options.display?.countries===false?'':shapes)+image):image):shapes+relief;
    const masks=(a.editor?.edits||[]).filter(e=>['land','water','waterway'].includes(e.kind)).map(e=>{const white=e.kind==='land',r=e.radius*(e.kind==='waterway'?.15:1);return e.points.length===1?`<circle cx="${e.points[0][0]}" cy="${e.points[0][1]}" r="${r}" fill="${white?'white':'black'}" opacity="${e.strength}"/>`:`<path d="M${e.points.map(p=>p.join(',')).join('L')}" fill="none" stroke="${white?'white':'black'}" stroke-width="${r*2}" opacity="${e.strength}" stroke-linecap="round" stroke-linejoin="round"/>`;}).join('');
    if(texture)return `<svg xmlns="http://www.w3.org/2000/svg" width="${rw}" height="${rh}" preserveAspectRatio="none" viewBox="${bounds.join(' ')}"><defs><clipPath id="paper"><rect width="${a.width}" height="${a.height}"/></clipPath><mask id="land" maskUnits="userSpaceOnUse" x="0" y="0" width="${a.width}" height="${a.height}"><rect width="${a.width}" height="${a.height}" fill="black"/><g fill="white">${shore}</g>${masks}</mask><filter id="coast" filterUnits="userSpaceOnUse" x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}"><feMorphology in="SourceAlpha" operator="dilate" radius="${pixel*.8}" result="edge"/><feComposite in="edge" in2="SourceAlpha" operator="out" result="outline"/><feFlood flood-color="#799caa"/><feComposite in2="outline" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g clip-path="url(#paper)"><rect width="${a.width}" height="${a.height}" fill="#82aaba"/><g filter="url(#coast)"><g mask="url(#land)"><rect x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" fill="#d9ddbe"/>${land}</g></g></g></svg>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${a.width}" height="${a.height}" viewBox="0 0 ${a.width} ${a.height}"><defs><clipPath id="land">${shore}</clipPath><linearGradient id="ocean" x2="0" y2="1"><stop stop-color="#91b6c3"/><stop offset=".5" stop-color="#779faf"/><stop offset="1" stop-color="#86aebc"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#ocean)"/><g fill="none" stroke="#bfd6d6" stroke-width="3">${shore}</g><g fill="#c3cca3">${shore}</g><g clip-path="url(#land)">${land}</g><g fill="none" stroke="#607e7a" stroke-width=".45">${shore}</g></svg>`;
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
  return Object.freeze({version,revision,modes,pathOK,colorOK,valid,svg,url,geometry,attach,generate,raster});
});
