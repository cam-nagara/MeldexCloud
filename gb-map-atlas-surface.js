/* Smooth cartographic relief from the native Azgaar Delaunay mesh.
 * Encoded numeric fields stay immutable and cheap to retain in Undo snapshots.
 */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MeldexMapAtlasSurface=api;})(globalThis,function(root){
  'use strict';
  const fields=['points','triangles','heights','temperature','rain','biomes'],decoded=new Map(),images=new Map();
  const palette=['#c0c79d','#e0c68d','#c3bda0','#c1c38b','#b1c38e','#91b17d','#779c78','#65996d','#69977b','#82967f','#babaa6','#e8ede9','#82a38e'].map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
  function encodeBytes(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return root.btoa(text);}
  function encode(points,triangles,attributes){
    const xy=new DataView(new ArrayBuffer(points.length*8)),indices=new DataView(new ArrayBuffer(triangles.length*2));
    points.forEach((p,i)=>{xy.setFloat32(i*8,p[0],true);xy.setFloat32(i*8+4,p[1],true);});
    triangles.forEach((n,i)=>indices.setUint16(i*2,n,true));
    return {version:1,count:points.length,points:encodeBytes(new Uint8Array(xy.buffer)),triangles:encodeBytes(new Uint8Array(indices.buffer)),...Object.fromEntries(fields.slice(2).map(k=>[k,encodeBytes(Uint8Array.from(attributes[k]))]))};
  }
  function bytes(text,max){if(typeof text!=='string'||text.length>max||text.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw Error('地形の描画データが不正です');const s=root.atob(text);return Uint8Array.from(s,c=>c.charCodeAt(0));}
  function mesh(s,width,height){
    if(!s||s.version!==1||!Number.isInteger(s.count)||s.count<3||s.count>65535||!Number.isFinite(width)||!Number.isFinite(height)||width<128||height<128)throw Error('地形の描画データが不正です');
    const n=s.count,limits=[Math.ceil(n*8/3)*4,n*24,...Array(4).fill(Math.ceil(n/3)*4)];
    if(fields.some((k,i)=>typeof s[k]!=='string'||s[k].length>limits[i]))throw Error('地形の描画データが不正です');
    const key=[width,height,n,...fields.map(k=>s[k])].join('|');let m=decoded.get(key);if(m)return m;
    const xy=bytes(s.points,limits[0]),ts=bytes(s.triangles,limits[1]),attributes=Object.fromEntries(fields.slice(2).map(k=>[k,bytes(s[k],limits[2])]));
    if(xy.length!==n*8||ts.length<6||ts.length%6||ts.length>n*18||Object.values(attributes).some(a=>a.length!==n)||attributes.heights.some(h=>h>100)||attributes.temperature.some(t=>t>128)||attributes.biomes.some(b=>b>12))throw Error('地形の描画データが不正です');
    const p=new Float64Array(n*2),t=new Uint16Array(ts.length/2),pv=new DataView(xy.buffer),tv=new DataView(ts.buffer);
    for(let i=0;i<n*2;i++){const v=pv.getFloat32(i*4,true),span=i%2?height:width;if(!Number.isFinite(v)||v<-.25*span||v>1.25*span)throw Error('地形の座標が不正です');p[i]=v;}
    for(let i=0;i<t.length;i++){t[i]=tv.getUint16(i*2,true);if(t[i]>=n)throw Error('地形の頂点参照が不正です');}
    // Bound raster work even for a malformed mesh with many overlapping triangles.
    let coverage=0;
    for(let i=0;i<t.length;i+=3){const ids=[t[i],t[i+1],t[i+2]],xs=ids.map(j=>p[j*2]),ys=ids.map(j=>p[j*2+1]);coverage+=Math.max(0,Math.min(width,Math.max(...xs))-Math.max(0,Math.min(...xs)))*Math.max(0,Math.min(height,Math.max(...ys))-Math.max(0,Math.min(...ys)))/(width*height);}
    if(coverage>32)throw Error('地形の面が過剰に重なっています');
    // Identical immutable fields across Undo snapshots share a bounded decode cache.
    m={width,height,p,t,...attributes,key};decoded.set(key,m);while(decoded.size>4)decoded.delete(decoded.keys().next().value);return m;
  }
  function valid(s,width,height){try{mesh(s,width,height);return true;}catch{return false;}}
  function vertexColors(m,mode){
    const rgb=new Float32Array(m.heights.length*3),z=Float64Array.from(m.heights,h=>Math.pow(Math.max(0,h-20)/80,1.6)),nx=new Float64Array(z.length),ny=new Float64Array(z.length),area=new Float64Array(z.length);
    const {p,t}=m;
    for(let i=0;i<t.length;i+=3){const a=t[i],b=t[i+1],c=t[i+2],dx=p[b*2]-p[a*2],dy=p[b*2+1]-p[a*2+1],ex=p[c*2]-p[a*2],ey=p[c*2+1]-p[a*2+1],det=dx*ey-dy*ex;if(Math.abs(det)<1e-8)continue;
      const weight=Math.abs(det),gx=((z[b]-z[a])*ey-(z[c]-z[a])*dy)/det,gy=(dx*(z[c]-z[a])-ex*(z[b]-z[a]))/det;
      for(const j of [a,b,c]){nx[j]+=gx*weight;ny[j]+=gy*weight;area[j]+=weight;}
    }
    for(let i=0;i<z.length;i++){nx[i]=area[i]?nx[i]/area[i]:0;ny[i]=area[i]?ny[i]/area[i]:0;}
    // Smooth lighting normals only; elevations and hydrology remain unchanged.
    for(let pass=0;pass<2;pass++){
      const sx=new Float64Array(z.length),sy=new Float64Array(z.length),degree=new Uint16Array(z.length);
      for(let i=0;i<t.length;i+=3){const a=t[i],b=t[i+1],c=t[i+2];for(const [j,k,l]of [[a,b,c],[b,c,a],[c,a,b]]){sx[j]+=nx[k]+nx[l];sy[j]+=ny[k]+ny[l];degree[j]+=2;}}
      for(let i=0;i<z.length;i++)if(degree[i]){nx[i]=nx[i]*.6+sx[i]/degree[i]*.4;ny[i]=ny[i]*.6+sy[i]/degree[i]*.4;}
    }
    for(let i=0;i<z.length;i++){
      const h=m.heights[i],temp=m.temperature[i]-64,moisture=clamp(m.rain[i]/160),base=palette[m.biomes[i]];
      let color=base.slice();
      if(mode==='temperature'){const v=clamp((temp+35)/65);color=[92+v*144,152+30*Math.sin(v*Math.PI)-v*60,203-v*132];}
      else if(mode==='rain')color=[214-moisture*134,192-moisture*58,137+moisture*48];
      else if(mode==='elevation'){const k=clamp((h-20)/80),stops=[[191,205,159],[143,166,122],[171,157,121],[185,178,161],[242,245,239]],x=k*4,l=Math.min(3,Math.floor(x));color=stops[l].map((v,ch)=>v+(stops[l+1][ch]-v)*(x-l));}
      else {const rock=clamp((h-52)/32)*.76,snow=clamp((-temp-5)/16)*clamp((h-50)/25);color=color.map((v,ch)=>(v*(1-rock)+[179,172,151][ch]*rock)*(1-snow)+[239,243,235][ch]*snow);}
      rgb.set(color,i*3);
    }
    return {rgb,nx,ny};
  }
  function pixels(s,graphWidth,graphHeight,mode='biomes',width=1536){
    if(!['biomes','elevation','temperature','rain','political'].includes(mode))throw Error('未対応の地図の配色です');
    const m=mesh(s,graphWidth,graphHeight);width=Math.max(32,Math.min(2048,Math.round(width)));if(graphHeight>graphWidth)width=Math.max(16,Math.round(width*graphWidth/graphHeight));const height=Math.max(16,Math.round(width*graphHeight/graphWidth)),data=new Uint8ClampedArray(width*height*4),{rgb:colors,nx,ny}=vertexColors(m,mode),{p,t}=m,lit=['biomes','elevation','political'].includes(mode),exaggeration=graphWidth*.055;
    for(let i=0;i<t.length;i+=3){const a=t[i],b=t[i+1],c=t[i+2],ax=p[a*2]/graphWidth*width,ay=p[a*2+1]/graphHeight*height,bx=p[b*2]/graphWidth*width,by=p[b*2+1]/graphHeight*height,cx=p[c*2]/graphWidth*width,cy=p[c*2+1]/graphHeight*height;
      const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-8)continue;
      const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))),x1=Math.min(width-1,Math.ceil(Math.max(ax,bx,cx))),y0=Math.max(0,Math.floor(Math.min(ay,by,cy))),y1=Math.min(height-1,Math.ceil(Math.max(ay,by,cy)));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const u=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/den,v=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/den,w=1-u-v;if(u<-.00001||v<-.00001||w<-.00001)continue;
        const offset=(y*width+x)*4;
        let shade=1;
        if(lit){const gx=(nx[a]*u+nx[b]*v+nx[c]*w)*exaggeration,gy=(ny[a]*u+ny[b]*v+ny[c]*w)*exaggeration;shade=clamp(.75+(-gx*-.55-gy*-.65+.62)/Math.hypot(gx,gy,1)*.40,.48,1.15);}
        for(let k=0;k<3;k++)data[offset+k]=(colors[a*3+k]*u+colors[b*3+k]*v+colors[c*3+k]*w)*shade;
        if(mode==='political'){data[offset]=data[offset+1]=data[offset+2]=shade>1?255:0;data[offset+3]=Math.abs(shade-1)*(shade>1?180:230);}
        else data[offset+3]=255;
      }
    }
    return {width,height,data};
  }
  function url(s,width,height,mode){
    if(typeof root.document?.createElement!=='function')return null;
    const key=mesh(s,width,height).key+'|'+mode;if(images.has(key))return images.get(key);
    const result=pixels(s,width,height,mode,1536),canvas=document.createElement('canvas');canvas.width=result.width;canvas.height=result.height;
    const context=canvas.getContext('2d'),image=context.createImageData(result.width,result.height);image.data.set(result.data);context.putImageData(image,0,0);
    const value=canvas.toDataURL('image/png');images.set(key,value);while(images.size>4)images.delete(images.keys().next().value);return value;
  }
  function sampler(s,width,height){
    const m=mesh(s,width,height);
    if(!m.field){
      const w=width>=height?512:Math.max(32,Math.round(512*width/height)),h=Math.max(32,Math.round(w*height/width)),data=new Float32Array(w*h*6),{p,t}=m;
      for(let k=0;k<t.length;k+=3){const a=t[k],b=t[k+1],c=t[k+2],ax=p[a*2]/width*w,ay=p[a*2+1]/height*h,bx=p[b*2]/width*w,by=p[b*2+1]/height*h,cx=p[c*2]/width*w,cy=p[c*2+1]/height*h,den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-8)continue;
        for(let y=Math.max(0,Math.floor(Math.min(ay,by,cy)));y<=Math.min(h-1,Math.ceil(Math.max(ay,by,cy)));y++)for(let x=Math.max(0,Math.floor(Math.min(ax,bx,cx)));x<=Math.min(w-1,Math.ceil(Math.max(ax,bx,cx)));x++){
          const u=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/den,v=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/den,z=1-u-v;if(u<-.00001||v<-.00001||z<-.00001)continue;const at=(y*w+x)*6;
          data[at]=m.heights[a]*u+m.heights[b]*v+m.heights[c]*z;data[at+1]=m.temperature[a]*u+m.temperature[b]*v+m.temperature[c]*z-64;data[at+2]=m.rain[a]*u+m.rain[b]*v+m.rain[c]*z;
          for(let ch=0;ch<3;ch++)data[at+3+ch]=palette[m.biomes[a]][ch]*u+palette[m.biomes[b]][ch]*v+palette[m.biomes[c]][ch]*z;
        }
      }
      m.field={w,h,data};
    }
    const {w,h,data}=m.field;
    const cubic=(a,b,c,d,t)=>b+.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));
    const derivative=(a,b,c,d,t)=>.5*(c-a+t*(2*(2*a-5*b+4*c-d)+3*t*(3*(b-c)+d-a)));
    const row=(x,y,u,gradient=false)=>{const at=clamp(y,0,h-1)*w,read=i=>data[(at+clamp(i,0,w-1))*6];return (gradient?derivative:cubic)(read(x-1),read(x),read(x+1),read(x+2),u);};
    return (x,y,out)=>{const gx=clamp(x/width*w-.5,0,w-1),gy=clamp(y/height*h-.5,0,h-1),ix=Math.min(w-2,Math.floor(gx)),iy=Math.min(h-2,Math.floor(gy)),u=gx-ix,v=gy-iy,a=(iy*w+ix)*6,b=a+6,c=a+w*6,d=c+6;
      for(let ch=0;ch<6;ch++)out[ch]=data[a+ch]*(1-u)*(1-v)+data[b+ch]*u*(1-v)+data[c+ch]*(1-u)*v+data[d+ch]*u*v;
      const r0=row(ix,iy-1,u),r1=row(ix,iy,u),r2=row(ix,iy+1,u),r3=row(ix,iy+2,u);
      out[0]=clamp(cubic(r0,r1,r2,r3,v),0,100);out[6]=cubic(row(ix,iy-1,u,true),row(ix,iy,u,true),row(ix,iy+1,u,true),row(ix,iy+2,u,true),v)*w/width;out[7]=derivative(r0,r1,r2,r3,v)*h/height;return out;
    };
  }
  return Object.freeze({fields,encode,valid,pixels,url,sampler});
});
