/* A PNG opened in the viewer can return to the recorded source position. */
(function(){
  'use strict';
  let path='',link=null,sequence=0;
  function load(){
    if(parent===window||!parent.GBPanelScreenshot)return;
    const current=window.MeldexViewerScene?.currentPath?.()||'';
    if(current===path)return;
    path=current;link=null;const token=++sequence;
    if(!/\.png$/i.test(current))return;
    window.apiFetch('/annotation/screenshot-source?path='+encodeURIComponent(current))
      .then(value=>{if(token===sequence)link=value.source_link||null;}).catch(()=>{});
  }
  window.MeldexViewerScreenshotSource={load,menuItems:()=>link?[{label:'撮影元の位置へ移動',icon:'externalLink',action:()=>parent.GBPanelScreenshot.openSourceLink(link)}]:[]};
  (window.MeldexViewerScene?.ready||Promise.resolve()).then(load);
})();
