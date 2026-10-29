/* Coupled drainage, orographic moisture, temperature and land cover. */
(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./gb-map-world-terrain.js') : root.MeldexMapWorldTerrain);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MeldexMapWorldGeography = api;
})(globalThis, function(T) {
  'use strict';
  const biomes = Object.freeze([
    ['ocean','海','#739eaf'], ['ice','氷雪','#e8ecdf'], ['tundra','ツンドラ','#afb6a0'],
    ['boreal','針葉樹林','#7f9b7a'], ['forest','温帯林','#87a873'], ['grass','草原','#b2bd83'],
    ['rainforest','熱帯雨林','#5b986e'], ['savanna','サバンナ','#b0b879'], ['desert','砂漠','#d9c491'],
    ['steppe','乾燥草原','#c6bf8c'], ['alpine','高山','#b1aaa0'], ['lake','湖','#80b5c5'],
  ].map(([key,name,color])=>Object.freeze({key,name,color})));
  function drainage(terrain) {
    const { cols, rows, heights: h } = terrain, n = h.length, filled = new Float64Array(n), receiver = new Int32Array(n).fill(-1), seen = new Uint8Array(n), order = [], heap = new T.Heap();
    const add = i => { if (!seen[i]) { seen[i] = 1; filled[i] = h[i]; heap.push(i,h[i]); } };
    for (let i = 0; i < n; i++) if (h[i] <= 0) add(i);
    if (!heap.length) { for (let x = 0; x < cols; x++) { add(x); add((rows-1)*cols+x); } for (let y = 0; y < rows; y++) { add(y*cols); add(y*cols+cols-1); } }
    while (heap.length) { const {id:i} = heap.pop(); order.push(i); T.neighbors(i,cols,rows,j => { if (seen[j]) return; seen[j] = 1; filled[j] = Math.max(h[j],filled[i]+1e-7); receiver[j] = i; heap.push(j,filled[j]); }); }
    // Steepest descending D8 edge; discovery parents resolve all flat ties.
    for (const i of order) if (h[i] > 0) { let best = 0; T.neighbors(i,cols,rows,(j,d) => { const grade = (filled[i]-filled[j])/d; if (grade > best) { best = grade; receiver[i] = j; } }); }
    const rank = new Int32Array(n); order.forEach((i,k)=>{rank[i]=k;});
    return { filled, receiver, order, rank };
  }
  function climate(terrain, options = {}) {
    const { cols, rows, heights: h } = terrain, n = h.length;
    const warmth = options.warmth ?? 50, wetness = options.wetness ?? 55, equator = (options.equator ?? 50)/100, north = (options.north ?? 0)*Math.PI/180;
    const sx = Math.sin(north), sy = -Math.cos(north), extent = (Math.abs(sx)*cols+Math.abs(sy)*rows)/2;
    const temperature = new Float32Array(n), latitude = new Float32Array(n), rain = new Float32Array(n), vapor = new Float32Array(n);
    const noise = T.noise((options.seed||terrain.seed||'')+':climate');
    for (let i = 0; i < n; i++) { const x = i%cols+.5, y = Math.floor(i/cols)+.5;
      const northness = ((x-cols/2)*sx+(y-rows/2)*sy)/(extent||1), lat = ((1-northness)/2-equator)/Math.max(equator,1-equator)*80;
      latitude[i] = lat; temperature[i] = 30-Math.abs(lat)*.62-Math.max(0,h[i])*36+(warmth-50)*.45 + noise(x/50,y/50)*2;
      vapor[i] = h[i] <= 0 ? 1 : .2;
    }
    // Four directional sweeps let rotated winds carry oceanic moisture inland.
    // Condensation on windward slopes removes water available downwind.
    for (let pass = 0; pass < 6; pass++) for (let yy = 0; yy < rows; yy++) {
      const y = pass%2 ? rows-1-yy : yy, lat = Math.abs(latitude[y*cols+Math.floor(cols/2)]), sign = lat > 28 && lat < 62 ? 1 : -1;
      const rowDirection = Math.cos(north)*sign;
      for (let xx = 0; xx < cols; xx++) { const x = rowDirection >= 0 ? xx : cols-1-xx, i = y*cols+x;
        if (h[i] <= 0) { vapor[i] = 1; continue; }
        const cellLatitude=Math.abs(latitude[i]),windSign=cellLatitude>28&&cellLatitude<62?1:-1,dx=Math.cos(north)*windSign,dy=Math.sin(north)*windSign;
        let moisture = 0, previousHeight = 0, weight = 0;
        for (const [a,b,w] of [[x-Math.sign(dx),y,Math.abs(dx)],[x,y-Math.sign(dy),Math.abs(dy)]]) {
          if (w < .001) continue;
          if (a >= 0 && b >= 0 && a < cols && b < rows) { moisture += vapor[b*cols+a]*w; previousHeight += Math.max(0,h[b*cols+a])*w; } else moisture += w;
          weight += w;
        }
        moisture /= weight||1; previousHeight /= weight||1;
        const rise = Math.max(0,h[i]-previousHeight), a = Math.abs(latitude[i]);
        const belt = .21+.72*Math.exp(-((a/18)**2))+.45*Math.exp(-(((a-52)/17)**2));
        rain[i] = T.clamp((.12+moisture*.82+rise*3)*belt*(wetness/55));
        vapor[i] = T.clamp(moisture*.984-rise*1.5,.012,1);
      }
    }
    return { temperature, rain, latitude };
  }
  function analyze(terrain, options = {}) {
    const { cols, rows, heights: h } = terrain, n = h.length, water = h.map(v=>v<=0), land = h.map(v=>v>0);
    const hydro = drainage(terrain), weather = climate(terrain,options), flow = new Float64Array(n), lake = new Uint16Array(n), slope = new Float32Array(n);
    const depressions = h.map((v,i)=>v>0 && hydro.filled[i]-v>.018), lakes = T.components(depressions,cols,rows);
    let lakeId = 0; const lakeGroups = [];
    for (const cells of lakes.groups) if (cells.length >= 3 && cells.length < n*.04 && cells.some(i=>weather.rain[i]>.22)) { lakeId++; for (const i of cells) lake[i] = lakeId; lakeGroups.push(cells); }
    for (let i = 0; i < n; i++) {
      flow[i] = land[i] ? weather.rain[i]*Math.max(.3,1-weather.temperature[i]/70) : 0;
      T.neighbors(i,cols,rows,(j,d)=>{slope[i]=Math.max(slope[i],Math.abs(h[i]-h[j])/d);});
    }
    for (let k = hydro.order.length-1; k >= 0; k--) { const i = hydro.order[k], j = hydro.receiver[i]; if (j >= 0) flow[j] += flow[i]; }
    const landCount = land.filter(Boolean).length, threshold = Math.max(16,landCount/600), river = h.map((v,i)=>v>0 && flow[i]>=threshold);
    const coastDistance = T.distances(water,cols,rows), riverDistance = T.distances(river,cols,rows);
    const navigable = land.map((v,i)=>v && !lake[i]), masses = T.components(navigable,cols,rows);
    const seas = T.components(water,cols,rows), ocean = new Uint8Array(n);
    for (const cells of seas.groups) if (cells.some(i=>i%cols===0||i%cols===cols-1||i<cols||i>=n-cols)) for (const i of cells) ocean[i]=1;
    const cover = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const t = weather.temperature[i], moisture = weather.rain[i]+(riverDistance[i]<3?.09:0);
      cover[i] = water[i] ? 0 : lake[i] ? 11 : h[i]>.57 && t<6 ? 10 : t< -10 ? 1 : t<0 ? 2 : t<9 ? moisture>.38?3:9 : moisture<.2 ? 8 : moisture<.34 ? 9 : t>22 ? moisture>.65?6:7 : moisture>.57?4:5;
    }
    return { ...hydro, ...weather, cols, rows, flow, lake, lakeGroups, slope, river, riverDistance, coastDistance, masses, ocean, cover, threshold, landCount };
  }
  function environment(terrain, a) {
    return { version:1, signature:T.fingerprint(terrain), temperature:Array.from(a.temperature,v=>Math.round(v*10)/10||0), rain:Array.from(a.rain,v=>Math.round(v*1000)/1000), biomes:Array.from(a.cover), lakes:Array.from(a.lake) };
  }
  function validEnvironment(t) {
    const e=t?.environment, n=t?.cols*t?.rows;
    return !!e && e.version===1 && e.signature===T.fingerprint(t) && ['temperature','rain','biomes','lakes'].every(k=>Array.isArray(e[k])&&e[k].length===n)
      && e.temperature.every(v=>Number.isFinite(v)&&v>=-100&&v<=80) && e.rain.every(v=>Number.isFinite(v)&&v>=0&&v<=1)
      && e.biomes.every(v=>Number.isInteger(v)&&v>=0&&v<biomes.length) && e.lakes.every(v=>Number.isInteger(v)&&v>=0&&v<65536)
      && (e.countries===undefined || Array.isArray(e.countries)&&e.countries.length<=24&&e.countries.every(c=>typeof c==='string'&&/^#[\da-f]{6}$/i.test(c)))
      && (e.owner===undefined || Array.isArray(e.owner)&&e.owner.length===n&&Array.isArray(e.countries)&&e.owner.every(v=>Number.isInteger(v)&&v>=-1&&v<e.countries.length));
  }
  function rivers(terrain, a) {
    const { cols, rows } = terrain, upstream = new Uint16Array(a.flow.length), result=[];
    for (let i=0;i<a.river.length;i++) if(a.river[i]&&a.receiver[i]>=0&&a.river[a.receiver[i]]) upstream[a.receiver[i]]++;
    for (let i=0;i<a.river.length;i++) if(a.river[i] && upstream[i]!==1) {
      const cells=[i]; let j=i;
      while(a.receiver[j]>=0) { const next=a.receiver[j]; cells.push(next); if(!a.river[next]||upstream[next]!==1)break;j=next; }
      if(cells.length<2 || cells.every(k=>a.lake[k]))continue;
      const points=cells.map(k=>[k%cols/(cols-1),Math.floor(k/cols)/(rows-1)]);
      result.push({cells,points,flow:a.flow[cells.at(-2)],mouth:terrain.heights[cells.at(-1)]<=0});
    }
    return result.sort((a,b)=>b.flow-a.flow);
  }
  return Object.freeze({ biomes, drainage, climate, analyze, environment, validEnvironment, rivers });
});
