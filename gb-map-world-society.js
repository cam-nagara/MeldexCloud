/* Settlement suitability and travel-cost-based countries and transport. */
(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./gb-map-world-terrain.js') : root.MeldexMapWorldTerrain);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MeldexMapWorldSociety = api;
})(globalThis, function(T) {
  'use strict';
  const roots = ['アステ','エルド','セレ','リーネ','ヴァル','ノヴァ','カレ','オル','ミラ','ルミ','テラ','フィオ','ベル','アル','サル','レイ','イリ','トリ','メル','ガル'];
  const endings = ['リア','ティア','オン','ディア','ナ','ール','ノス','ヴィア','ニア','レア'];
  const palette = ['#9a6755','#5c8299','#8b749e','#a18a4b','#588b78','#a46683','#7e8b4f','#a57949','#657e9e','#9a8c78','#587f83','#8f7752'];
  function placeNames(seed, count) { const random=T.rng(seed+':names'), used=new Set(), result=[]; while(result.length<count) { const name=roots[Math.floor(random()*roots.length)]+endings[Math.floor(random()*endings.length)]; if(!used.has(name)){used.add(name);result.push(name);} } return result; }
  const point = (i,a) => [i%a.cols/(a.cols-1),Math.floor(i/a.cols)/(a.rows-1)];
  function cities(terrain,a,options) {
    const {cols,rows,heights:h}=terrain, random=T.rng(options.seed+':cities'), candidates=[];
    const freshDistance=T.distances(a.river.map((v,i)=>v||a.lake[i]>0),cols,rows);
    for(let i=0;i<h.length;i++) {
      if(h[i]<=0 || h[i]>.57 || a.lake[i] || a.slope[i]>.2 || a.temperature[i]<-5 || a.rain[i]<.12)continue;
      if(a.masses.groups[a.masses.ids[i]].length<8)continue;
      // Wet settlements may use local streams below the world-map threshold.
      // In dry country a visible river or lake must supply the settlement.
      if(a.rain[i]<.34&&freshDistance[i]>3)continue;
      let seaNeighbors=0, landNeighbors=0;T.neighbors(i,cols,rows,j=>{seaNeighbors+=a.ocean[j];landNeighbors+=Number(h[j]>0);});
      let harbor=false;T.neighbors(i,cols,rows,j=>{if(a.ocean[j])harbor=true;},false);
      const port=harbor&&seaNeighbors>0&&landNeighbors>=3;
      const water=Math.exp(-freshDistance[i]/4)*.32+(port?.1:0);
      const score=.4*T.clamp(1-Math.abs(a.temperature[i]-17)/35)+.22*T.clamp(1-Math.abs(a.rain[i]-.65)) +water-h[i]*.35-a.slope[i]*1.2+random()*.05;
      candidates.push({cell:i,point:point(i,a),score,port,mass:a.masses.ids[i]});
    }
    candidates.sort((a,b)=>b.score-a.score||a.cell-b.cell);
    const selected=[], spacing=Math.max(4,Math.sqrt(a.landCount/options.cities)*.7), existing=options.existing||[];
    const distance=(p,q)=>Math.hypot((p[0]-q[0])*cols,(p[1]-q[1])*rows);
    const available=(p,space)=>selected.every(c=>distance(p,c.point)>=space)&&existing.every(q=>distance(p,q)>=space*.7);
    const masses=[...a.masses.groups.keys()].sort((x,y)=>a.masses.groups[y].length-a.masses.groups[x].length);
    for(const mass of masses) { if(selected.length>=options.cities||a.masses.groups[mass].length<80)continue;
      const local=candidates.filter(c=>c.mass===mass), chosen=local.find(c=>c.port&&available(c.point,spacing))||local.find(c=>available(c.point,spacing)); if(chosen)selected.push(chosen);
    }
    for(const factor of [1,.85,.7]) for(const c of candidates) { if(selected.length>=options.cities)break; if(c.port&&selected.filter(c=>c.port).length>=Math.ceil(options.cities*.48))continue; if(!selected.includes(c)&&available(c.point,spacing*factor))selected.push(c); }
    const names=placeNames(options.seed,selected.length);
    return selected.map((c,i)=>({...c,name:names[i],index:i,capital:false}));
  }
  function traversable(terrain,a,i,sea) { return sea ? !!a.ocean[i] : terrain.heights[i]>0&&!a.lake[i]; }
  function landCost(terrain,a,i,j,d=1) {
    const rise=Math.abs(terrain.heights[j]-terrain.heights[i]);
    const riverCross=Number(a.river[i]!==a.river[j])*Math.min(5,a.flow[j]/a.threshold*.15);
    return d*(1+rise*24+terrain.heights[j]**2*10+a.slope[j]*4+riverCross+(a.cover[j]===8?.7:0));
  }
  function path(terrain,a,start,end,sea=false) {
    if(!traversable(terrain,a,start,sea)||!traversable(terrain,a,end,sea))return null;
    const {cols,rows}=terrain,n=terrain.heights.length, costs=new Float64Array(n).fill(Infinity),previous=new Int32Array(n).fill(-1),closed=new Uint8Array(n),heap=new T.Heap();
    const ex=end%cols,ey=Math.floor(end/cols),estimate=i=>Math.hypot(i%cols-ex,Math.floor(i/cols)-ey);
    costs[start]=0;heap.push(start,estimate(start));
    while(heap.length) { const {id:i}=heap.pop();if(closed[i])continue;closed[i]=1;if(i===end)break;
      T.neighbors(i,cols,rows,(j,d)=>{if(closed[j]||!traversable(terrain,a,j,sea))return;
        const x=i%cols,y=Math.floor(i/cols),jx=j%cols,jy=Math.floor(j/cols);
        if(x!==jx&&y!==jy&&(!traversable(terrain,a,y*cols+jx,sea)||!traversable(terrain,a,jy*cols+x,sea)))return;
        const step=sea?d*(1+Math.max(0,.08+terrain.heights[j])*2):landCost(terrain,a,i,j,d),next=costs[i]+step;
        if(next<costs[j]){costs[j]=next;previous[j]=i;heap.push(j,next+estimate(j));}
      });
    }
    if(!Number.isFinite(costs[end]))return null;
    const cells=[];for(let i=end;i>=0;i=previous[i]){cells.push(i);if(i===start)break;}cells.reverse();
    return {cells,cost:costs[end],points:cells.map(i=>point(i,a))};
  }
  function connections(terrain,a,settlements,sea=false) {
    const ports=sea?settlements.filter(c=>c.port):settlements,edges=[],pairs=new Set();
    const seaCell=c=>{let best=-1;T.neighbors(c.cell,a.cols,a.rows,j=>{if(a.ocean[j]&&(best<0||terrain.heights[j]<terrain.heights[best]))best=j;},false);return best;};
    for(const c of ports) {
      const sorted=ports.filter(q=>q!==c&&(sea||q.mass===c.mass)).sort((p,q)=>Math.hypot(p.point[0]-c.point[0],p.point[1]-c.point[1])-Math.hypot(q.point[0]-c.point[0],q.point[1]-c.point[1])),nearby=sorted.slice(0,sea?3:4);
      if(sea){const masses=new Set();for(const q of sorted)if(q.mass!==c.mass&&!masses.has(q.mass)){masses.add(q.mass);if(!nearby.includes(q))nearby.push(q);}}
      for(const q of nearby){const key=[c.index,q.index].sort((a,b)=>a-b).join(':');if(pairs.has(key))continue;pairs.add(key);
        const route=path(terrain,a,sea?seaCell(c):c.cell,sea?seaCell(q):q.cell,sea);if(!route)continue;
        if(sea)route.points=[c.point,...route.points,q.point];edges.push({...route,from:c.index,to:q.index,sea});
      }
    }
    edges.sort((a,b)=>a.cost-b.cost);
    const parent=settlements.map((_,i)=>i),find=i=>{while(parent[i]!==i)i=parent[i];return i;},chosen=[];
    for(const edge of edges){const p=find(edge.from),q=find(edge.to);if(p!==q){parent[p]=q;chosen.push(edge);}else if(!sea&&chosen.length<settlements.length*1.15&&edge.cost<35)chosen.push(edge);}
    // Nearest-neighbor candidate graphs can separate clusters on one continent.
    // Bridge those components with another terrain search, never a straight line.
    if(!sea)for(;;){let best=null;for(const c of settlements)for(const q of settlements)if(c.mass===q.mass&&find(c.index)!==find(q.index)){const d=Math.hypot(c.point[0]-q.point[0],c.point[1]-q.point[1]);if(!best||d<best.d)best={c,q,d};}if(!best)break;const route=path(terrain,a,best.c.cell,best.q.cell);if(!route)break;chosen.push({...route,from:best.c.index,to:best.q.index,sea:false});parent[find(best.c.index)]=find(best.q.index);}
    return chosen;
  }
  function countries(terrain,a,settlements,options) {
    const {cols,rows}=terrain,n=terrain.heights.length,owner=new Int16Array(n).fill(-1),cost=new Float64Array(n).fill(Infinity),heap=new T.Heap(),capitals=[];
    const wanted=Math.min(options.nations,settlements.length),rank=[...settlements].sort((a,b)=>b.score-a.score),masses=[...a.masses.groups.keys()].sort((x,y)=>a.masses.groups[y].length-a.masses.groups[x].length);
    for(const mass of masses){if(capitals.length>=wanted)break;const city=rank.find(c=>c.mass===mass);if(city)capitals.push(city);}
    while(capitals.length<wanted){let best=null,score=-1;for(const c of rank)if(!capitals.includes(c)){const distance=Math.min(...capitals.map(p=>Math.hypot((p.point[0]-c.point[0])*cols,(p.point[1]-c.point[1])*rows)));const value=distance*(.6+c.score);if(value>score){best=c;score=value;}}if(!best)break;capitals.push(best);}
    capitals.forEach((c,id)=>{c.capital=true;c.country=id;owner[c.cell]=id;cost[c.cell]=0;heap.push(c.cell,0);});
    while(heap.length){const {id:i,cost:value}=heap.pop();if(value!==cost[i])continue;T.neighbors(i,cols,rows,(j,d)=>{if(!traversable(terrain,a,j,false))return;
      const step=landCost(terrain,a,i,j,d)*(1+Math.max(0,terrain.heights[j]-.3)*8),next=value+step;
      if(next<cost[j]){cost[j]=next;owner[j]=owner[i];heap.push(j,next);}
    },false);}
    // Uninhabited offshore islands attach as a whole; do not split them into cells.
    for(const group of a.masses.groups) if(group.length&&owner[group[0]]<0&&capitals.length){const p=point(group[0],a),closest=capitals.map((c,id)=>({id,d:Math.hypot(c.point[0]-p[0],c.point[1]-p[1])})).sort((a,b)=>a.d-b.d)[0].id;for(const i of group)owner[i]=closest;}
    for(const c of settlements)c.country=owner[c.cell];
    const states=capitals.map((capital,id)=>{const cells=[];for(let i=0;i<n;i++)if(owner[i]===id)cells.push(i);
      const mainland=cells.filter(i=>a.masses.ids[i]===capital.mass);let x=0,y=0;for(const i of mainland){x+=i%cols;y+=Math.floor(i/cols);}x/=mainland.length||1;y/=mainland.length||1;
      let center=capital.cell,distance=Infinity;for(const i of mainland){const d=(i%cols-x)**2+(Math.floor(i/cols)-y)**2;if(d<distance&&terrain.heights[i]<.5){distance=d;center=i;}}
      return {id,name:capital.name+(['王国','連邦','共和国','公国'][id%4]),capital:capital.index,color:palette[id%palette.length],point:point(center,a),cells:cells.length};});
    return {owner,states};
  }
  function borders(terrain,a,owner) {
    const {cols,rows}=terrain, groups=new Map();
    const add=(p,q,left,right)=>{if(left===right||left<0||right<0)return;const key=[left,right].sort((a,b)=>a-b).join(':');if(!groups.has(key))groups.set(key,[]);groups.get(key).push({p,q,used:false});};
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const i=y*cols+x;if(x+1<cols)add([x+.5,y-.5],[x+.5,y+.5],owner[i],owner[i+1]);if(y+1<rows)add([x-.5,y+.5],[x+.5,y+.5],owner[i],owner[i+cols]);}
    const result=[];
    for(const [pair,edges]of groups){const nodes=new Map();for(const e of edges)for(const p of[e.p,e.q]){const key=p.join(',');if(!nodes.has(key))nodes.set(key,[]);nodes.get(key).push(e);}
      for(const first of edges){if(first.used)continue;let e=first,key=nodes.get(e.p.join(',')).length!==2?e.p.join(','):e.q.join(',');const pts=[];
        for(let limit=0;e&&limit<=edges.length;limit++){e.used=true;const p=e.p.join(',')===key?e.p:e.q,q=e.p===p?e.q:e.p;pts.push(p);key=q.join(',');const next=nodes.get(key).filter(c=>!c.used);if(next.length!==1){pts.push(q);break;}e=next[0];}
        if(pts.length>=2)result.push({pair:pair.split(':').map(Number),points:T.simplify(pts,.28).map(([x,y])=>[T.clamp(x/(cols-1)),T.clamp(y/(rows-1))])});
      }
    }
    return result;
  }
  function generate(terrain,a,options) {
    const settlements=cities(terrain,a,options),nations=countries(terrain,a,settlements,options);
    return {cities:settlements,...nations,borders:borders(terrain,a,nations.owner),roads:connections(terrain,a,settlements),seaRoutes:connections(terrain,a,settlements,true)};
  }
  return Object.freeze({ cities, path, landCost, countries, borders, connections, generate, placeNames, point });
});
