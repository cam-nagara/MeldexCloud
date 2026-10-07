(function(){
const groups={"icons": ["meldex-cloud-feature-icons-01.js?v=92ffe74af959a5cd"], "scenario": ["meldex-cloud-feature-scenario-01.js?v=f4eaedcc8fd75d00", "meldex-cloud-scenario.css?v=494312915be9e156"], "capture": ["meldex-cloud-feature-capture-01.js?v=ec657d96b990c537"]}, pending=new Map();
window.MeldexCloudAssets={load(name){
 if(!groups[name])return Promise.resolve();
 if(pending.has(name))return pending.get(name);
 const job=(async()=>{for(const src of groups[name]){
  await new Promise((resolve,reject)=>{
   let el=document.querySelector('[data-cloud-asset="'+src.split('?')[0]+'"]');
   if(el?.dataset.loaded==='1'){resolve();return;}
   el=document.createElement(src.includes('.css?')?'link':'script');
   el.dataset.cloudAsset=src.split('?')[0];
   if(el.tagName==='LINK'){el.rel='stylesheet';el.href=src;}else{el.src=src;el.async=false;}
   el.onload=()=>{el.dataset.loaded='1';resolve();};
   el.onerror=()=>{el.remove();reject(new Error('機能の読み込みに失敗しました: '+name));};
   document.head.appendChild(el);
  });
 }})();
 pending.set(name,job);job.catch(()=>{if(pending.get(name)===job)pending.delete(name);});
 return job;
}};
})();