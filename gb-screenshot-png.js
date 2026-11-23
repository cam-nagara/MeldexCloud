/* Portable screenshot source links. Pixel chunks are copied byte for byte. */
(function(global){
  'use strict';
  const key='MeldexSourceLink',encoder=new TextEncoder(),decoder=new TextDecoder();
  function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
  function parts(bytes){
    const signature=[137,80,78,71,13,10,26,10];
    if(signature.some((v,i)=>bytes[i]!==v))throw Error('PNG形式の画像ではありません');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),result=[];
    for(let offset=8;offset+12<=bytes.length;){const length=view.getUint32(offset),end=offset+12+length;
      if(end>bytes.length)throw Error('PNGの情報が破損しています');
      const type=decoder.decode(bytes.subarray(offset+4,offset+8));
      result.push({type,bytes:bytes.subarray(offset,end),payload:bytes.subarray(offset+8,end-4)});offset=end;
      if(type==='IEND'){if(offset!==bytes.length)throw Error('PNGの終端が不正です');return result;}}
    throw Error('PNGの終端がありません');
  }
  function validate(link,source){
    if(link==null)return null;
    if(link.schemaVersion!==1||!link.position||typeof link.position!=='object'||Array.isArray(link.position)
      ||!source||link.path.replace(/\\/g,'/')!==source.replace(/\\/g,'/')||encoder.encode(JSON.stringify(link)).length>32768)
      throw Error('撮影元のリンク情報が不正です');
    return structuredClone(link);
  }
  function embed(bytes,link){
    const value=encoder.encode(key+'\0\0\0\0\0'+JSON.stringify(validate(link,link.path)));
    const chunk=new Uint8Array(value.length+12),view=new DataView(chunk.buffer);
    view.setUint32(0,value.length);chunk.set(encoder.encode('iTXt'),4);chunk.set(value,8);view.setUint32(value.length+8,crc(chunk.subarray(4,value.length+8)));
    const chunks=[bytes.subarray(0,8)];let inserted=false;
    for(const part of parts(bytes)){
      if(part.type==='iTXt'&&decoder.decode(part.payload.subarray(0,key.length+1))===key+'\0')continue;
      if(!inserted&&['IDAT','IEND'].includes(part.type)){chunks.push(chunk);inserted=true;}
      chunks.push(part.bytes);
    }
    const output=new Uint8Array(chunks.reduce((sum,p)=>sum+p.length,0));let offset=0;
    for(const part of chunks){output.set(part,offset);offset+=part.length;}return output;
  }
  function read(bytes){
    for(const part of parts(bytes))if(part.type==='iTXt'&&decoder.decode(part.payload.subarray(0,key.length+5))===key+'\0\0\0\0\0'){
      const link=JSON.parse(decoder.decode(part.payload.subarray(key.length+5)));return validate(link,link.path);
    }
    return null;
  }
  global.GBScreenshotPng={validate,embed,read};
})(window);
