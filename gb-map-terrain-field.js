/* Continuous, deterministic 2D relief and bounded, reversible terrain strokes. */
(function(root,factory){const node=typeof module==='object'&&module.exports,api=factory(root,node?require('./gb-map-atlas-surface.js'):root.MeldexMapAtlasSurface);if(node)module.exports=api;else root.MeldexMapTerrainField=api;})(globalThis,function(root,Surface){
 'use strict';
 const kinds=['plain','mountain','hills','desert','wasteland','snow','forest','land','water','river','road','railway','waterway'],scenes=new Map(),images=new Map();
 const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
 const colors={plain:[177,194,140],mountain:[162,159,139],hills:[153,177,128],desert:[222,196,139],wasteland:[174,164,139],snow:[236,242,238],forest:[99,150,108],land:[180,196,148],water:[114,163,185]};
 function valid(editor,w,h){
   if(editor==null)return true;
   if(!editor||editor.version!==1||!Array.isArray(editor.edits)||editor.edits.length>256)return false;
   let points=0,cost=0;
   for(const e of editor.edits){
     if(!e||!kinds.includes(e.kind)||!Number.isFinite(e.radius)||e.radius<.001||e.radius>Math.max(w,h)/2||!Number.isFinite(e.strength)||e.strength<=0||e.strength>1||!Array.isArray(e.points)||!e.points.length||e.points.length>2048||!e.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=w&&p[1]>=0&&p[1]<=h))return false;
     if(e.feature_id!==undefined&&(typeof e.feature_id!=='string'||e.feature_id.length>256))return false;
     if((e.profile!==undefined||['river','road','railway','waterway'].includes(e.kind))&&(!Array.isArray(e.profile)||e.profile.length!==e.points.length||!e.profile.every(n=>Number.isFinite(n)&&n>=0&&n<=100)))return false;
     points+=e.points.length;if(points>32768)return false;
     for(let i=0;i<e.points.length;i++){const a=e.points[i],b=e.points[i+1]||a,x0=clamp(Math.floor((Math.min(a[0],b[0])-e.radius)/w*32),0,31),x1=clamp(Math.floor((Math.max(a[0],b[0])+e.radius)/w*32),0,31),y0=clamp(Math.floor((Math.min(a[1],b[1])-e.radius)/h*32),0,31),y1=clamp(Math.floor((Math.max(a[1],b[1])+e.radius)/h*32),0,31);cost+=(x1-x0+1)*(y1-y0+1);if(cost>262144)return false;}
   }
   return true;
 }
 function hash(x,y,seed){let n=Math.imul(x,374761393)^Math.imul(y,668265263)^seed;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
 function noise(x,y,seed){const ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy,a=hash(ix,iy,seed),b=hash(ix+1,iy,seed),c=hash(ix,iy+1,seed),d=hash(ix+1,iy+1,seed),f=u*u*(3-2*u),g=v*v*(3-2*v);return [a+(b-a)*f+(c-a)*g+(a-b-c+d)*f*g,((b-a)+(a-b-c+d)*g)*6*u*(1-u),((c-a)+(a-b-c+d)*f)*6*v*(1-v)];}
 function scene(atlas){
   if(!atlas.surface||!valid(atlas.editor,atlas.width,atlas.height))throw Error('地形の編集データが不正です');
   const edits=atlas.editor?.edits||[],key=[atlas.width,atlas.height,...Surface.fields.map(k=>atlas.surface[k]),JSON.stringify(edits)].join('|');if(scenes.has(key))return scenes.get(key);
   const w=atlas.width,h=atlas.height,base=Surface.sampler(atlas.surface,w,h),bins=Array.from({length:1024},()=>[]),segments=[];
   let seed=2166136261;for(let i=0;i<atlas.surface.points.length;i+=31)seed=Math.imul(seed^atlas.surface.points.charCodeAt(i),16777619);
   edits.forEach((e,op)=>e.points.forEach((a,i)=>{const b=e.points[i+1]||a,seg={a,b,op,i},id=segments.push(seg)-1;
     const x0=clamp(Math.floor((Math.min(a[0],b[0])-e.radius)/w*32),0,31),x1=clamp(Math.floor((Math.max(a[0],b[0])+e.radius)/w*32),0,31),y0=clamp(Math.floor((Math.min(a[1],b[1])-e.radius)/h*32),0,31),y1=clamp(Math.floor((Math.max(a[1],b[1])+e.radius)/h*32),0,31);
     for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)bins[y*32+x].push(id);
   }));
   const distance=new Float64Array(edits.length),nearest=new Int32Array(edits.length),fraction=new Float64Array(edits.length),stamp=new Uint32Array(edits.length);let tick=0;
   const sample=(x,y,out=new Float64Array(9))=>{
     base(x,y,out);let height=out[0],gx=out[6],gy=out[7],detail=1;const touched=[];tick++;if(tick===4294967295){stamp.fill(0);tick=1;}
     for(const id of bins[clamp(Math.floor(y/h*32),0,31)*32+clamp(Math.floor(x/w*32),0,31)]){const s=segments[id],dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1],len=dx*dx+dy*dy,t=len?clamp(((x-s.a[0])*dx+(y-s.a[1])*dy)/len):0,d=Math.hypot(x-s.a[0]-t*dx,y-s.a[1]-t*dy),op=s.op;if(d>=edits[op].radius)continue;if(stamp[op]!==tick){stamp[op]=tick;distance[op]=d;nearest[op]=id;fraction[op]=t;touched.push(op);}else if(d<distance[op]){distance[op]=d;nearest[op]=id;fraction[op]=t;}}
     touched.sort((a,b)=>a-b);
     for(const op of touched){const e=edits[op],s=segments[nearest[op]],t=fraction[op],d=distance[op],dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1],len=dx*dx+dy*dy,f=Math.cos(Math.PI/2*d/e.radius)**2*e.strength,derivative=-Math.sin(Math.PI*d/e.radius)*Math.PI/(2*e.radius)*e.strength,dfx=d?derivative*(x-s.a[0]-dx*t)/d:0,dfy=d?derivative*(y-s.a[1]-dy*t)/d:0;
       let target=height,tx=0,ty=0;
       if(e.profile){const p=e.profile[s.i],q=e.profile[Math.min(s.i+1,e.profile.length-1)];target=p+(q-p)*t;if(len){tx=(q-p)*dx/len;ty=(q-p)*dy/len;}detail*=1-f;}
       else {target=({plain:25,mountain:78,hills:45,land:26,water:15})[e.kind]??height;if(target===height){tx=gx;ty=gy;}detail=detail*(1-f)+f;}
       const delta=target-height;gx=gx*(1-f)+tx*f+delta*dfx;gy=gy*(1-f)+ty*f+delta*dfy;height+=delta*f;out[1]-=delta*f*.45;
       const color=colors[e.kind];if(color)for(let ch=0;ch<3;ch++)out[3+ch]=out[3+ch]*(1-f)+color[ch]*f;
       if(e.kind==='desert'){out[1]=out[1]*(1-f)+26*f;out[2]*=1-f;}
       if(e.kind==='snow')out[1]=out[1]*(1-f)-18*f;
       if(['plain','land','forest'].includes(e.kind)){out[1]=out[1]*(1-f)+Math.max(10,out[1])*f;out[2]=out[2]*(1-f)+Math.max(e.kind==='forest'?110:50,out[2])*f;}
       if(e.kind==='wasteland')out[2]=out[2]*(1-f)+5*f;
       if(e.kind==='river'&&delta<0&&height<45&&out[1]>2)for(let ch=0;ch<3;ch++)out[3+ch]=out[3+ch]*(1-f)+[132,174,118][ch]*f;
     }
     const high=clamp((height-32)/42),amplitude=3.6*high*detail;let fine=0,nx=0,ny=0,total=0;
     for(let octave=0,frequency=48/Math.max(w,h),weight=1;octave<5;octave++,frequency*=3,weight*=.48){const n=noise(x*frequency,y*frequency,seed+octave*31),ridge=1-Math.abs(n[0]*2-1),sign=n[0]>.5?-2:2;fine+=(ridge-.6)*weight;nx+=sign*n[1]*frequency*weight;ny+=sign*n[2]*frequency*weight;total+=weight;}
     height+=fine/total*amplitude;gx+=nx/total*amplitude;gy+=ny/total*amplitude;
     out[0]=clamp(height,0,100);out[6]=gx;out[7]=gy;out[8]=detail;return out;
   };
   const result={key,sample};scenes.set(key,result);while(scenes.size>2)scenes.delete(scenes.keys().next().value);return result;
 }
 function pixels(atlas,mode,bounds=[0,0,atlas.width,atlas.height],width=512,height=Math.round(width*bounds[3]/bounds[2]),display={}){
   if(!bounds.every(Number.isFinite)||bounds[2]<=0||bounds[3]<=0||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4104||height>4104||width*height>12e6)throw Error('地形の描画範囲が不正です');
   const data=new Uint8ClampedArray(width*height*4),s=scene(atlas),v=new Float64Array(9),exaggeration=Math.max(atlas.width,atlas.height)*.025;
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
     s.sample(bounds[0]+(x+.5)/width*bounds[2],bounds[1]+(y+.5)/height*bounds[3],v);const h=v[0],temp=v[1],rain=clamp(v[2]/160),at=(y*width+x)*4;
     let color=[v[3],v[4],v[5]],shade=1;
     if(mode==='temperature'){const f=clamp((temp+35)/65);color=[92+f*144,152+30*Math.sin(f*Math.PI)-f*60,203-f*132];}
     else if(mode==='rain')color=[214-rain*134,192-rain*58,137+rain*48];
     else if(mode==='elevation'||display.vegetation===false){const f=clamp((h-20)/80);color=[181+f*47,199-f*30+f*f*62,148+f*80];}
     if(['biomes','elevation','political'].includes(mode)&&display.terrain!==false){const dh=h>20?1.6/80*Math.pow((h-20)/80,.6):0,gx=v[6]*dh*exaggeration,gy=v[7]*dh*exaggeration,normal=Math.hypot(gx,gy,1),light=(gx*.55+gy*.65+.7)/normal;shade=clamp(.64+light*.5,.4,1.2);
       if(mode==='biomes'){const rock=clamp((h-55)/35)*.6,snow=clamp((-temp-7)/15)*clamp((h-50)/30);color=color.map((c,k)=>(c*(1-rock)+[164,158,141][k]*rock)*(1-snow)+[238,243,239][k]*snow);}
     }
     for(let ch=0;ch<3;ch++)data[at+ch]=color[ch]*shade;
     data[at+3]=255;
     if(mode==='political'){data[at]=data[at+1]=data[at+2]=shade>1?255:0;data[at+3]=Math.abs(shade-1)*(shade>1?160:210);}
   }
   return {width,height,data};
 }
 // Azgaar方式の地形から、都市・気候・国家・植生の生成が使う格子（高さ -1〜1、0以下は海）を作る。
 // 旧方式の地形を持たない地図でも同じ生成を使えるようにするための読み取り専用の写しで、保存しない。
 const grids=new WeakMap();
 function grid(doc){
   const atlas=doc?.atlas;if(!atlas?.surface)return null;
   const cached=grids.get(atlas);if(cached)return cached;
   const sc=scene(atlas),cols=256,rows=Math.max(32,Math.min(256,Math.round(cols*(doc.canvas?.height||atlas.height)/(doc.canvas?.width||atlas.width)))),heights=new Array(cols*rows);
   for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const h=sc.sample((x+.5)/cols*atlas.width,(y+.5)/rows*atlas.height)[0];heights[y*cols+x]=h<20?clamp((h-20)/20,-1,0):clamp((h-20)/80,0.001,1);}
   const result=Object.freeze({cols,rows,heights:Object.freeze(heights)});grids.set(atlas,result);return result;
 }
 // 等高線: 表示範囲を格子に区切って高さ（0〜100、20未満は海）を測り、一定間隔の高さで線を引く（マーチングスクエア法）。
 function contours(atlas,bounds,interval=10,samples=48){
   const sc=scene(atlas),[x0,y0,w,h]=bounds,cols=Math.max(2,Math.min(160,Math.round(samples))),rows=Math.max(2,Math.min(160,Math.round(samples*h/w))),stride=cols+1,grid=new Float32Array(stride*(rows+1));
   const step=[10,20,5].includes(interval)?interval:10;
   for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const x=clamp(x0+i*w/cols,0,atlas.width),y=clamp(y0+j*h/rows,0,atlas.height);grid[j*stride+i]=sc.sample(x,y)[0];}
   const lines=[];
   for(let level=20+step;level<100;level+=step){
     let d='';
     for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
       const a=grid[j*stride+i],b=grid[j*stride+i+1],c=grid[(j+1)*stride+i+1],e=grid[(j+1)*stride+i];
       const code=(a>=level?8:0)|(b>=level?4:0)|(c>=level?2:0)|(e>=level?1:0);if(code===0||code===15)continue;
       const px=i*w/cols+x0,py=j*h/rows+y0,cw=w/cols,ch=h/rows,t=(p,q)=>p===q?.5:(level-p)/(q-p);
       const top=[px+cw*t(a,b),py],right=[px+cw,py+ch*t(b,c)],bottom=[px+cw*t(e,c),py+ch],left=[px,py+ch*t(a,e)];
       const segs=({1:[[left,bottom]],2:[[bottom,right]],3:[[left,right]],4:[[top,right]],5:[[top,left],[bottom,right]],6:[[top,bottom]],7:[[top,left]],8:[[top,left]],9:[[top,bottom]],10:[[top,right],[left,bottom]],11:[[top,right]],12:[[left,right]],13:[[bottom,right]],14:[[left,bottom]]})[code];
       for(const [p,q] of segs)d+=`M${p[0].toFixed(2)},${p[1].toFixed(2)}L${q[0].toFixed(2)},${q[1].toFixed(2)}`;
     }
     if(d)lines.push({level,major:(level-20)%(step*5)===0,d});
   }
   return lines;
 }
 function url(atlas,mode,bounds,width,height,display={}){
   const key=scene(atlas).key+'|'+JSON.stringify([mode,bounds,width,height,display]);if(images.has(key))return images.get(key);
   const result=pixels(atlas,mode,bounds,width,height,display),canvas=document.createElement('canvas');canvas.width=result.width;canvas.height=result.height;const ctx=canvas.getContext('2d'),im=ctx.createImageData(result.width,result.height);im.data.set(result.data);ctx.putImageData(im,0,0);const value=canvas.toDataURL('image/png');images.set(key,value);while(images.size>48)images.delete(images.keys().next().value);return value;
 }
 function stroke(atlas,kind,points,radius,strength=1){const e={kind,points:points.map(p=>p.slice()),radius,strength};const editor={version:1,edits:[...(atlas.editor?.edits||[]),e]};if(!valid(editor,atlas.width,atlas.height))throw Error('編集回数・点数・範囲の上限を超えます');return editor;}
 function fit(atlas,kind,points,radius,featureId){
   if(points.length<2||points.length>32768||typeof featureId!=='string'||!featureId)throw Error('2〜32,768点の川・経路を選択してください');const edits=(atlas.editor?.edits||[]).filter(old=>old.feature_id!==featureId),s=scene({...atlas,editor:{version:1,edits}}),v=new Float64Array(9),p=simplify(points,Math.max(radius*.02,.0001));if(kind==='river'&&s.sample(...p[0],v)[0]<s.sample(...p.at(-1),v)[0])p.reverse();
   let profile=p.map(point=>s.sample(...point,v)[0]);
   if(kind==='river'){for(let i=0;i<profile.length;i++)profile[i]=clamp(Math.min(profile[i]-1.2,i?profile[i-1]-Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1])*.002:100),19.8,100);}
   else if(kind==='waterway')profile.fill(18);
   else {for(let pass=0;pass<3;pass++){const prev=profile.slice();profile=profile.map((h,i)=>Math.max(20.5,(prev[Math.max(0,i-1)]+h*2+prev[Math.min(prev.length-1,i+1)])/4));}}
   const e={kind,points:p,radius,strength:1,profile,feature_id:featureId},editor={version:1,edits:[...edits,e]};if(!valid(editor,atlas.width,atlas.height))throw Error('補正範囲または経路の点数を小さくしてください');return editor;
 }
 function simplify(points,tolerance){
   if(points.length<=2)return points.map(p=>p.slice());const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]],limit=tolerance*tolerance;let work=0;
   while(stack.length){const [a,b]=stack.pop(),p=points[a],q=points[b],dx=q[0]-p[0],dy=q[1]-p[1],len=dx*dx+dy*dy;let best=-1,dist=limit;for(let i=a+1;i<b;i++){if(++work>2e6)throw Error('経路が複雑すぎます。頂点を減らすか、補正する半径を広げてください');const t=len?clamp(((points[i][0]-p[0])*dx+(points[i][1]-p[1])*dy)/len):0,d=(points[i][0]-p[0]-dx*t)**2+(points[i][1]-p[1]-dy*t)**2;if(d>dist){dist=d;best=i;}}if(best>=0){keep.add(best);stack.push([a,best],[best,b]);}}
   return [...keep].sort((a,b)=>a-b).map(i=>points[i].slice());
 }
 return Object.freeze({kinds,valid,scene,pixels,url,contours,grid,stroke,fit,simplify});
});
