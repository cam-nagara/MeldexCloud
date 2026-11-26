/* Panel screenshots use the browser's compositor, including SVG, CSS
   highlights and same-origin viewer frames. No DOM rasterizer is involved. */
(function(global) {
  'use strict';
  let cancelSelection = null;
  let sourceRevealGeneration = 0;
  const captureHandle=crypto.randomUUID();
  let handleConfigured=false;
  try {
    if(navigator.mediaDevices?.setCaptureHandleConfig){
      navigator.mediaDevices.setCaptureHandleConfig({handle:captureHandle,exposeOrigin:true,permittedOrigins:[location.origin]});
      handleConfigured=true;
    }
  }catch{}
  const surfaces = () => global.GBAnnotationSurfaces?.captureTargets?.() || [];
  function position(surface) {
    if (surface.iframe) {
      const viewer = surface.iframe.contentWindow.MeldexViewerScene;
      return { view: 'viewer', pageIndex: viewer.getIndex(), zoom: viewer.getZoom(),
        panX: viewer.getPanX(), panY: viewer.getPanY(), fit: viewer.getFitMode(),
        rotation: viewer.getRotateDeg(), flipH: viewer.getFlipH(), flipV: viewer.getFlipV(), mode: viewer.getMode() };
    }
    const sc = surface.bridge?.options?.scrollContainer || surface.host;
    const result = { view: surface.type, scrollX: sc.scrollLeft, scrollY: sc.scrollTop };
    if (surface.type === 'board') {
      const instance = global.getComponentInstance?.(surface.tab.id);
      const state = instance?._bdDump?.bd || (typeof bd !== 'undefined' ? bd : null);
      if (state) result.board = { zoom: state.zoom, panX: state.panX, panY: state.panY, rotation: state.rotation || 0 };
    }
    return result;
  }
  async function capture(surface, rect, sourceLink) {
    let stream;
    const historyScope = global.GBAnnotationSurfaces?.historyScope?.(surface);
    try {
      // Cropping is relative to this tab's viewport. A monitor/window stream
      // cannot safely use these coordinates and is explicitly rejected.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' },
        preferCurrentTab: true, selfBrowserSurface: 'include', audio: false });
      const track = stream.getVideoTracks()[0];
      if (track.getSettings().displaySurface !== 'browser') throw Error('Meldexを表示しているタブを選択してください');
      const captured=track.getCaptureHandle?.();
      if(!handleConfigured||captured?.handle!==captureHandle||captured.origin!==location.origin)
        throw Error('このMeldexのタブを選択してください。別のタブの画像は保存しません');
      const video = document.createElement('video'); video.muted = true; video.srcObject = stream;
      await video.play();
      await new Promise(resolve => video.requestVideoFrameCallback ? video.requestVideoFrameCallback(resolve) : requestAnimationFrame(resolve));
      if (!surface.host.isConnected || !surfaces().includes(surface) || surface.path !== sourceLink.path
        || JSON.stringify(position(surface)) !== JSON.stringify(sourceLink.position)) throw Error('撮影中に対象の表示が変わりました。もう一度撮影してください');
      const now = surface.host.getBoundingClientRect();
      if (Math.abs(now.left-rect.left)>1 || Math.abs(now.top-rect.top)>1 || Math.abs(now.width-rect.width)>1 || Math.abs(now.height-rect.height)>1) throw Error('撮影中にパネルの配置が変わりました');
      const sx = video.videoWidth / innerWidth, sy = video.videoHeight / innerHeight;
      const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      const width = Math.min(innerWidth, rect.right) - left, height = Math.min(innerHeight, rect.bottom) - top;
      const canvas = document.createElement('canvas'); canvas.width = Math.round(width*sx); canvas.height = Math.round(height*sy);
      canvas.getContext('2d').drawImage(video,left*sx,top*sy,width*sx,height*sy,0,0,canvas.width,canvas.height);
      stream.getTracks().forEach(t => t.stop()); stream = null;
      const home = (typeof _homeFolderPath !== 'undefined' ? _homeFolderPath : '').replace(/[\\/]$/, '');
      const saved = await apiPost('/annotation/screenshot', { data: canvas.toDataURL('image/png'),
        target_path: localStorage.getItem('meldex-screenshot-folder') || (home ? home+'/' : '')+'スクリーンショット',
        mode: 'panel', source_target: sourceLink.path, source_link: sourceLink, width: canvas.width, height: canvas.height },
        { silentError: true, diagnosticOp: 'viewer.screenshot.capture' });
      let historyFailed = false;
      if (saved.annotation_id || saved.id) {
        try {
          await global._pushAnnotationCreateHistory?.(
            saved.annotation_id || saved.id, 'アノテート: スクリーンショット撮影', sourceLink.path, historyScope,
          );
        } catch { historyFailed = true; }
      }
      if (typeof loadRpAnnotationList === 'function') void loadRpAnnotationList();
      showStatus(historyFailed ? 'スクリーンショットは保存しましたが、取り消しの記録を作れませんでした' : 'スクリーンショットを保存しました', historyFailed);
      return saved;
    } catch(error) { if (error.name !== 'NotAllowedError') showStatus('スクリーンショット失敗: '+error.message,true); return null; }
    finally { stream?.getTracks().forEach(t => t.stop()); }
  }
  function start() {
    cancelSelection?.();
    if (!surfaces().length) { showStatus('撮影できるファイルのパネルを開いてください',true); return; }
    const overlay = document.createElement('div'), frame = document.createElement('div');
    overlay.dataset.panelScreenshotSelector = '';
    overlay.tabIndex=-1;
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;cursor:crosshair;background:transparent';
    frame.dataset.panelScreenshotFrame = '';
    frame.style.cssText='position:fixed;pointer-events:none;box-sizing:border-box;border:2px solid var(--accent);display:none';
    overlay.append(frame); document.body.append(overlay);
    const previousFocus=document.activeElement;
    overlay.focus({preventScroll:true});
    document.body.dataset.panelScreenshotSelecting='true';
    let selected = null;
    const cleanup = () => { overlay.remove();delete document.body.dataset.panelScreenshotSelecting;document.removeEventListener('keydown',key,true);cancelSelection=null;previousFocus?.isConnected&&previousFocus.focus?.({preventScroll:true}); };
    const key = event => { if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cleanup();} };
    cancelSelection=cleanup;document.addEventListener('keydown',key,true);
    overlay.addEventListener('pointermove',event=>{
      const matches=surfaces().filter(s=>{const r=s.host.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<r.right&&event.clientY>=r.top&&event.clientY<r.bottom});
      selected=matches.find(s=>!matches.some(other=>other!==s&&s.host.contains(other.host)))||null;
      frame.style.display=selected?'block':'none';
      if(selected){const r=selected.host.getBoundingClientRect();Object.assign(frame.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});}
    });
    overlay.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();if(!selected)return;
      const surface=selected,rect=surface.host.getBoundingClientRect();
      const sourceLink={schemaVersion:1,path:surface.path,position:position(surface)};
      cleanup();void capture(surface,rect,sourceLink);
    });
    showStatus('撮影するパネルをクリックしてください（Escで中止）');
  }
  async function openSourceLink(link) {
    if(link?.schemaVersion!==1||typeof link.path!=='string'||!link.position)return false;
    if(link.path.length>8192||link.path.includes('\0')||/^[a-z][a-z0-9+.-]*:/i.test(link.path)&&! /^[a-z]:[\\/]/i.test(link.path))return false;
    const generation = ++sourceRevealGeneration;
    await GBAnnotationSurfaces.reveal({target_path:link.path,type:'screenshot-source',target_kind:'none',data:{},id:''});
    if (generation !== sourceRevealGeneration) return false;
    const same=(a,b)=>typeof _rpAnnotationPathsMatch==='function'?_rpAnnotationPathsMatch(a,b):a===b;
    const surface=surfaces().find(s=>same(s.path,link.path)||s.iframe&&same(s.sourcePath,link.path.replace(/(\.pdf)#page=\d+$/i,'$1')));
    if(!surface)return false;
    const pos=link.position;
    if(surface.iframe){
      // revealはタブの対象が切り替わると返るが、iframe内の画像/PDFはまだ読込中のことがある。
      // 先に位置を戻すと、reopenWithUrlの初期化で倍率・回転が再び消えてしまう。
      const documentPath = link.path.replace(/(\.pdf)#page=\d+$/i, '$1');
      const deadline = performance.now() + 30000;
      let viewer;
      while (performance.now() < deadline) {
        if (generation !== sourceRevealGeneration || !surface.host.isConnected
          || !same(surface.sourcePath || surface.path, documentPath)) return false;
        const frame = surface.iframe.contentWindow;
        viewer = frame?.MeldexViewerScene;
        if (viewer && same(viewer.currentPath(), documentPath)
          && frame.document.getElementById('viewer-loading')?.classList.contains('hidden')) break;
        viewer = null;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!viewer) { showStatus('撮影元を読み込めませんでした。もう一度操作してください', true); return false; }
      if(pos.mode && viewer.getMode() !== pos.mode)viewer.setMode(pos.mode);
      if(pos.fit && viewer.getFitMode() !== pos.fit)viewer.setFitMode(pos.fit);
      await viewer.goToIndex(Math.max(0,Number(pos.pageIndex)||0));
      if (generation !== sourceRevealGeneration || !surface.host.isConnected
        || !same(viewer.currentPath(), documentPath)) return false;
      viewer.setRotateDeg(Number(pos.rotation)||0);
      if(!!pos.flipH!==viewer.getFlipH())viewer.toggleFlipH();
      if(!!pos.flipV!==viewer.getFlipV())viewer.toggleFlipV();
      const r=surface.iframe.getBoundingClientRect();
      await viewer.setZoomAt(r.width/2,r.height/2,Math.max(.01,Number(pos.zoom)||1));
      if (generation !== sourceRevealGeneration || !surface.host.isConnected
        || !same(viewer.currentPath(), documentPath)) return false;
      viewer.setPan(Number(pos.panX)||0,Number(pos.panY)||0);
    }else{
      if(surface.type==='board'&&pos.board){
        const instance=global.getComponentInstance?.(surface.tab.id);
        instance?.activate?.();
        if(typeof bd!=='undefined'&&typeof bdTransform==='function'){
          Object.assign(bd,{zoom:Math.max(.01,Number(pos.board.zoom)||1),panX:Number(pos.board.panX)||0,panY:Number(pos.board.panY)||0,rotation:Number(pos.board.rotation)||0});bdTransform();
        }
      }
      const sc=surface.bridge?.options?.scrollContainer||surface.host;
      sc.scrollTo({left:Number(pos.scrollX)||0,top:Number(pos.scrollY)||0,behavior:'instant'});
    }
    return true;
  }
  global.GBPanelScreenshot={start,capture,position,openSourceLink,cancel:()=>cancelSelection?.()};
})(window);
