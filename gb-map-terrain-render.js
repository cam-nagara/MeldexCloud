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
  function baseStyle(f){const role=f.cartography?.role;
    const base={role:typeof role==='string'?role:'',weight:3,fillOpacity:.22,fontSize:16,label:true,symbolSize:20};
    if(role==='river'){const flow=Number.isFinite(f.cartography.flow)?T.clamp(f.cartography.flow,0,1e9):1;return {...base,weight:T.clamp(.5+Math.log1p(flow)*.22,.65,2.6),label:false};}
    if(role==='road')return {...base,weight:f.cartography.rank==='minor'?.65:1.05,dash:f.cartography.rank==='minor'?'2 3':null,label:false};
    if(role==='railway')return {...base,weight:1.8,dash:'2 4',label:false};
    if(role==='shipping')return {...base,weight:.85,dash:'5 5',label:false};
    if(role==='border')return {...base,weight:f.cartography.area?0:1.0,fillOpacity:0,dash:f.cartography.area?null:'3 2',label:false};
    if(role==='lake')return {...base,weight:.3,fillOpacity:.95,label:false};
    if(role==='city')return {...base,fontSize:f.cartography.capital?12:11,fontWeight:f.cartography.capital?600:400,symbolSize:f.cartography.capital?10:f.icon==='port'?7:5};
    if(role==='country-label')return {...base,fontSize:14,fontWeight:500};
    if(role==='mountain-label')return {...base,fontSize:12};
    if(role==='river-label')return {...base,fontSize:11};
    return base;
  }
  function style(f,scale=1){const s=baseStyle(f);return scale===1?s:{...s,fontSize:s.fontSize*scale,symbolSize:s.symbolSize*scale,weight:s.weight*scale,...(s.dash?{dash:s.dash.split(' ').map(n=>Number(n)*scale).join(' ')}:{})};}
  function symbol(f,fallback){return f.cartography?.role==='city'?(f.cartography.capital?'◉':f.icon==='port'?'○':'●'):fallback;}
  const DROP=Object.freeze({width:28,height:40,anchorX:14,anchorY:38,centerX:14,centerY:14,radius:6.5,path:'M14 38C11 32 2 23 2 14A12 12 0 0 1 26 14C26 23 17 32 14 38Z'});
  function marker(f){return f.kind==='pin'&&f.marker_style==='drop'?DROP:null;}
  function drawMarker(c,f,point,scale=1,glyph=''){
    const m=marker(f);if(!m)return false;
    c.save();c.translate(point[0],point[1]);c.scale(scale,scale);c.translate(-m.anchorX,-m.anchorY);c.setLineDash([]);
    c.fillStyle=f.color;c.strokeStyle='white';c.lineWidth=1.5;const path=new Path2D(m.path);c.fill(path);c.stroke(path);
    c.fillStyle='white';c.beginPath();c.arc(m.centerX,m.centerY,m.radius,0,Math.PI*2);c.fill();
    if(['city','castle','mountain','forest','port'].includes(f.icon)&&glyph){c.fillStyle=f.color;c.font='bold 12px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(glyph,m.centerX,m.centerY);}
    c.restore();return true;
  }
  function labelLayout(features,project,measure,options={}){
    const selected=options.selected||new Set(),occupied=[],result=new Map(),bounds=options.bounds;
    const entries=features.filter(f=>['pin','label'].includes(f.kind)&&f.label).map((f,index)=>{
      const cart=style(f,options.scale||1),manual=!cart.role,score=selected.has(f.id)?20000:manual?10000:cart.role==='country-label'?90:f.cartography?.capital?100:f.icon==='port'?40:20;
      return {f,index,cart,manual,score};
    }).sort((a,b)=>b.score-a.score||a.index-b.index);
    for(const {f,cart,manual} of entries){
      const p=project(f.points[0]),w=Math.min(300,measure(f.label,cart)),h=cart.fontSize+3;
      const m=marker(f),scale=options.scale||1,r=m?(m.width/2+6)*scale:cart.symbolSize/2+4,y=m?(m.centerY-m.anchorY)*scale:0;
      const candidates=manual?[m?[r,y]:options.forExport?[f.kind==='pin'?18*scale:0,-cart.fontSize*.35]:[f.kind==='pin'?12:-12,0]]:f.kind==='pin'?[[r,y],[-r-w,y],[-w/2,y-h/2-r],[-w/2,m?h/2+4*scale:h/2+r]]:[[-w/2,0],[-w/2,-h],[-w/2,h]];
      let chosen=null;
      for(const [dx,dy] of candidates){const rect=[p[0]+dx-3,p[1]+dy-h/2-2,p[0]+dx+w+3,p[1]+dy+h/2+2];
        if(!manual&&!selected.has(f.id)&&(bounds&&(rect[0]<bounds[0]||rect[1]<bounds[1]||rect[2]>bounds[2]||rect[3]>bounds[3])||occupied.some(b=>rect[0]<b[2]&&rect[2]>b[0]&&rect[1]<b[3]&&rect[3]>b[1])))continue;
        chosen={visible:true,dx,dy,rect};occupied.push(rect);break;
      }
      result.set(f.id,chosen||{visible:false});
    }
    return result;
  }
  return Object.freeze({pixels,canvas,style,symbol,labelLayout,marker,drawMarker});
});
