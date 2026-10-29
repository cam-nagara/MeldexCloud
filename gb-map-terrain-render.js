/* One physical-map renderer shared by the editor, PNG and portable viewer. */
(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./gb-map-world-terrain.js'):root.MeldexMapWorldTerrain,node?require('./gb-map-world-geography.js'):root.MeldexMapWorldGeography);
  if(node)module.exports=api;else root.MeldexMapTerrainRender=api;
})(globalThis,function(T,G){
  'use strict';
  const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const colors=G.biomes.map(b=>rgb(b.color));
  function pixels(t,width=Math.min(1536,t.cols*6),height=Math.round(width*(t.rows-1)/(t.cols-1))){
    width=Math.max(8,Math.min(4096,Math.round(width)));height=Math.max(8,Math.min(4096,Math.round(height)));
    const data=new Uint8ClampedArray(width*height*4),hasEnvironment=G.validEnvironment(t),e=hasEnvironment?t.environment:null,c=t.cols,r=t.rows,mode=t.presentation||'biomes';
    const h=t.heights,at=(x,y)=>h[Math.max(0,Math.min(r-1,y))*c+Math.max(0,Math.min(c-1,x))],normals=h.map((_,i)=>[(at(i%c+1,Math.floor(i/c))-at(i%c-1,Math.floor(i/c)))*8,(at(i%c,Math.floor(i/c)+1)-at(i%c,Math.floor(i/c)-1))*8]);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const gx=x/(width-1)*(c-1),gy=y/(height-1)*(r-1),ix=Math.floor(gx),iy=Math.floor(gy),u=gx-ix,v=gy-iy;
      const ids=[iy*c+ix,iy*c+Math.min(c-1,ix+1),Math.min(r-1,iy+1)*c+ix,Math.min(r-1,iy+1)*c+Math.min(c-1,ix+1)],weights=[(1-u)*(1-v),u*(1-v),(1-u)*v,u*v];
      const z=ids.reduce((s,i,k)=>s+h[i]*weights[k],0);
      let color,shade=1;
      if(z<=0){const depth=Math.min(1,-z),shelf=Math.exp(-depth*19),deep=T.clamp(depth*1.3);color=[89-26*deep+65*shelf,139-29*deep+45*shelf,166-29*deep+29*shelf];}
      else{
        if(e&&mode!=='elevation'){color=[0,0,0];let weight=0;ids.forEach((i,k)=>{if(h[i]<=0)return;let co=colors[e.biomes[i]===11?(e.rain[i]>.55?4:5):e.biomes[i]];
          if(mode==='temperature'){const v=T.clamp((e.temperature[i]+25)/60);co=[70+165*v,140+45*Math.sin(v*Math.PI)-50*v,195-125*v];}
          else if(mode==='rain'){const v=e.rain[i];co=[215-142*v,185-25*v,122+30*v];}
          else if(mode==='political'&&e.owner?.[i]>=0&&e.countries?.[e.owner[i]])co=rgb(e.countries[e.owner[i]]).map(v=>v*.48+245*.52);
          for(let ch=0;ch<3;ch++)color[ch]+=co[ch]*weights[k];weight+=weights[k];});if(weight)color=color.map(v=>v/weight);else color=[174,184,132];}
        else color=z<.25?[181-z*95,191-z*80,137-z*35]:[161+z*50,159+z*48,137+z*65];
        const dx=ids.reduce((s,i,k)=>s+normals[i][0]*weights[k],0),dy=ids.reduce((s,i,k)=>s+normals[i][1]*weights[k],0),normal=Math.hypot(dx,dy,1);
        const light=(-dx*-.55-dy*-.65+.57)/normal;
        shade=T.clamp(.72+light*.5,.48,1.18);
        const thematic=e&&!['biomes','elevation'].includes(mode),ridge=thematic?0:T.clamp((z-.22)/.55),rock=[161,151,132];color=color.map((v,k)=>v*(1-ridge*.64)+rock[k]*ridge*.64);
        const temperature=e?ids.reduce((s,i,k)=>s+e.temperature[i]*weights[k],0):20-z*35;
        const snow=thematic?0:T.clamp((-temperature-2)/12)*T.clamp((z-.3)/.24);
        color=color.map((v,k)=>v*(1-snow)+[235,237,227][k]*snow);
        const beach=T.clamp(1-z/.012)*T.clamp((temperature-3)/14)*T.clamp(1-Math.hypot(dx,dy)*.6);color=color.map((v,k)=>v*(1-beach)+[214,207,165][k]*beach);
      }
      const offset=(y*width+x)*4;for(let k=0;k<3;k++)data[offset+k]=T.clamp(color[k]*shade,0,255);data[offset+3]=255;
    }
    return {width,height,data};
  }
  function canvas(terrain){const p=pixels(terrain),c=document.createElement('canvas');c.width=p.width;c.height=p.height;const context=c.getContext('2d'),image=context.createImageData(p.width,p.height);image.data.set(p.data);context.putImageData(image,0,0);return c;}
  function style(f){const role=f.cartography?.role;
    const base={role:typeof role==='string'?role:'',weight:3,fillOpacity:.22,fontSize:16,label:true,symbolSize:20};
    if(role==='river'){const flow=Number.isFinite(f.cartography.flow)?T.clamp(f.cartography.flow,0,1e9):1;return {...base,weight:T.clamp(.5+Math.log1p(flow)*.22,.65,2.6),label:false};}
    if(role==='road')return {...base,weight:1.05,label:false};
    if(role==='shipping')return {...base,weight:.85,dash:'5 5',label:false};
    if(role==='border')return {...base,weight:1.15,dash:'4 2',label:false};
    if(role==='lake')return {...base,weight:.3,fillOpacity:.95,label:false};
    if(role==='city')return {...base,fontSize:f.cartography.capital?12:11,symbolSize:f.icon==='port'?13:f.cartography.capital?10:6};
    if(role==='country-label')return {...base,fontSize:17};
    if(role==='mountain-label')return {...base,fontSize:12};
    if(role==='river-label')return {...base,fontSize:11};
    return base;
  }
  function symbol(f,fallback){return f.cartography?.role==='city'?(f.icon==='port'?'⚓':f.cartography.capital?'◉':'●'):fallback;}
  return Object.freeze({pixels,canvas,style,symbol});
});
