/* Shift-drag selects an image/PDF region; the shared context menu applies a theme highlight. */
(function () {
  'use strict';
  const engine = () => window.MeldexViewerAnnotationScene;
  async function ensureNative() {
    if(!window.MeldexStandaloneNative||window.MeldexViewerAnnotations)return;
    await window.MeldexStandaloneNative.loadFeature('annotations');
    document.documentElement.dataset.viewerAnnotationCapability='enabled';
    await window.MeldexViewerAnnotations.load();
  }
  let nativeRead=0;
  const cardReads=new WeakMap();
  async function renderCards(host) {
    const token=(cardReads.get(host)||0)+1;cardReads.set(host,token);
    host._highlightCardObserver?.disconnect();host._highlightCardObserver=null;
    const scene=window.MeldexViewerScene;
    const path=scene?.itemAnnotationPath?.(scene.getItems()?.[scene.getIndex()]);
    if(!path){host.textContent='ファイルを開いてください';return;}
    host.textContent='読み込み中...';
    try {
      await ensureNative();
      const rows=await window.apiFetch('/annotations?target='+encodeURIComponent(path));
      if(cardReads.get(host)!==token||!host.isConnected)return;
      const items=[];
      for(const row of rows||[]){
        let data=row.data||{};try{if(typeof data==='string')data=JSON.parse(data);}catch{continue;}
        if(!data.highlight&&row.type!=='highlight')continue;
        items.push({row,data});
      }
      const build=({row,data})=>{
        const card=document.createElement('button');card.type='button';card.className='gb-btn';
        card.dataset.viewerHighlightCard=row.id;
        card.style.cssText='display:flex;flex-direction:column;align-items:flex-start;width:100%;height:auto;white-space:normal;text-align:left;gap:var(--ui-space-2);margin-bottom:var(--ui-space-2)';
        const quote=document.createElement('span');quote.textContent=data.text||row.body||'ハイライト';card.append(quote);
        if(data.thumbnail){const img=document.createElement('img');img.src=data.thumbnail;img.alt='ハイライトした範囲';img.style.cssText='max-width:100%;max-height:120px;object-fit:contain';card.append(img);}
        card.addEventListener('click',()=>window.MeldexViewerHighlights.reveal(row));return card;
      };
      host._highlightCardObserver?.disconnect();host.replaceChildren();host.dataset.highlightTotal=String(items.length);
      if(!items.length){host.textContent='ハイライトはありません';return;}
      let count=0;const more=document.createElement('button');more.type='button';more.className='gb-btn';more.dataset.highlightMore='';
      const append=()=>{
        const fragment=document.createDocumentFragment(),end=Math.min(items.length,count+80);
        while(count<end)fragment.append(build(items[count++]));more.before(fragment);
        if(count===items.length){more.remove();host._highlightCardObserver?.disconnect();}
        else more.textContent=`さらに表示（残り ${items.length-count}件）`;
      };
      more.addEventListener('click',append);host.append(more);append();
      if(count<items.length&&typeof IntersectionObserver!=='undefined'){
        host._highlightCardObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))append();},
          {root:host.closest('.sa-secondary-panel-body'),rootMargin:'100px'});host._highlightCardObserver.observe(more);
      }
    }catch(error){if(cardReads.get(host)===token)host.textContent='読み込めませんでした: '+error.message;}
  }
  async function loadNativeExisting() {
    if(!window.MeldexStandaloneNative||window.MeldexViewerAnnotations)return;
    const token=++nativeRead,scene=window.MeldexViewerScene;
    const path=scene?.itemAnnotationPath?.(scene.getItems()?.[scene.getIndex()]);
    if(!path)return;
    try {
      const rows=await window.apiFetch('/annotations?target='+encodeURIComponent(path));
      if(token===nativeRead&&rows?.length)await ensureNative();
    }catch{}
  }
  let selection = null, dragging = null, armedColor = null;
  function colors() {
    try { if (parent !== window && parent.GBAnnotationHighlights) return parent.GBAnnotationHighlights.colors(); } catch {}
    return (window.getThemeColorSlotSettings?.() || []).filter(Boolean).map(slot => slot.color).filter(Boolean).concat(window.PALETTE_COLORS || ['#e4bd60', '#90bc83', '#7eacd1', '#c48080']).slice(0, 8);
  }
  function cancel() { selection?.element?.remove(); selection = null; dragging = null; armedColor = null; }
  function captureText() {
    const text = window.MeldexViewerTextLayer?.getSelection?.();
    if (!text?.text || !text.boxes?.length) return;
    const basePath = path => String(path || '').replace(/#page=\d+$/, '').replace(/\\/g, '/');
    const scene = engine()?.getScenes().find(s => basePath(s.path) === basePath(text.path)
      && (!s.isPdf || s.pageIndex === text.pageIndex));
    if (!scene || !(text.mediaWidth > 0) || !(text.mediaHeight > 0)) return;
    const sx = scene.mediaWidth / text.mediaWidth, sy = scene.mediaHeight / text.mediaHeight;
    const boxes = text.boxes.map(b => ({ x: b.x * sx, y: b.y * sy, width: b.width * sx, height: b.height * sy }))
      .filter(b => Object.values(b).every(Number.isFinite) && b.width > 0 && b.height > 0);
    if (!boxes.length) return;
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    cancel();
    selection = { scene, path: scene.path, data: { x, y,
      width: Math.max(...boxes.map(b => b.x + b.width)) - x,
      height: Math.max(...boxes.map(b => b.y + b.height)) - y,
      boxes, text: text.text, textSource: { engine: text.engine, version: text.version } } };
  }
  function bounds(scene, a, b) {
    const x = Math.max(0, Math.min(scene.mediaWidth, Math.min(a.x, b.x)));
    const y = Math.max(0, Math.min(scene.mediaHeight, Math.min(a.y, b.y)));
    return { x, y, width: Math.max(0, Math.min(scene.mediaWidth, Math.max(a.x, b.x)) - x), height: Math.max(0, Math.min(scene.mediaHeight, Math.max(a.y, b.y)) - y) };
  }
  function thumbnail(scene, data) {
    try {
      const canvas = document.createElement('canvas'), ratio = Math.min(1, 320 / Math.max(data.width, data.height));
      canvas.width = Math.max(1, Math.round(data.width * ratio)); canvas.height = Math.max(1, Math.round(data.height * ratio));
      const scaleX = (scene.mediaEl.naturalWidth || scene.mediaEl.width) / scene.mediaWidth;
      const scaleY = (scene.mediaEl.naturalHeight || scene.mediaEl.height) / scene.mediaHeight;
      canvas.getContext('2d').drawImage(scene.mediaEl, data.x * scaleX, data.y * scaleY,
        data.width * scaleX, data.height * scaleY, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', 0.8);
    } catch (error) { console.warn('[viewer-highlight] thumbnail failed', error.message); return ''; }
  }
  async function apply(color) {
    if (!selection?.scene.wrap.isConnected || !engine().getScenes().includes(selection.scene) || selection.path !== selection.scene.path
      || selection.data.width < 1 || selection.data.height < 1) { cancel(); armedColor = color; return; }
    const { scene, data, element, path: targetPath } = selection;
    const requestId = crypto.randomUUID();
    selection = null; armedColor = null; element?.remove();
    const savedData = { ...data, coordinateSpace: engine().COORD_SPACE, highlight: true,
      mediaWidth: scene.mediaWidth, mediaHeight: scene.mediaHeight, thumbnail: thumbnail(scene, data), clientRequestId: requestId };
    if (scene.isPdf) savedData.pageIndex = scene.pageIndex;
    const painted = engine().renderRect(scene, savedData, color, 0.42, null);
    if (parent !== window) parent.postMessage({ type: 'viewer-ann-highlight-pending', requestId, targetPath: scene.path }, location.origin);
    try {
      const row = { type: 'rect', target_path: scene.path, target_kind: 'viewer_region', color, opacity: 0.42,
        body: data.text || '', data: savedData, target_ref: { file: scene.path, pageIndex: scene.pageIndex }, user: engine().viewerAnnotationUser() };
      const result = await window.apiPost('/annotations', row);
      const after = { ...row, id: result.id, created: result.created, modified: result.modified || result.created };
      painted.dataset.annId = result.id; painted._viewerAnnotationHistoryRow = after;
      window.__viewerAnnotationReportSave?.(true, 'create', null, { ...result, highlightRequestId: requestId }, { before: null, after });
    } catch (error) {
      painted.remove(); engine().viewerAnnotationSaveFailed(error);
      window.__viewerAnnotationReportSave?.(false, 'create', error, { highlightRequestId: requestId });
      if (engine().getScenes().includes(scene) && scene.path === targetPath) selection = { scene, data, path: targetPath, element: engine().renderRect(scene, data, 'var(--accent)', 0.2, null) };
    }
  }
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.shiftKey && !armedColor || document.documentElement.dataset.viewerAnnotationCapability === 'disabled') return;
    const scene = engine()?.findSceneForClientPoint(event.clientX, event.clientY);
    if (!scene) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const color = armedColor; cancel(); armedColor = color;
    dragging = { scene, path: scene.path, point: engine().clientToLocal(scene.svg, event.clientX, event.clientY), pointer: event.pointerId };
    try { scene.wrap.setPointerCapture(event.pointerId); } catch {}
  }, true);
  document.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const { scene, point } = dragging;
    if (!engine().getScenes().includes(scene) || dragging.path !== scene.path) { cancel(); return; }
    const data = bounds(scene, point, engine().clientToLocal(scene.svg, event.clientX, event.clientY));
    selection?.element?.remove();
    const element = engine().renderRect(scene, data, armedColor || 'var(--accent)', 0.25, null);
    element.dataset.highlightSelection = '';
    element.setAttribute('stroke', 'var(--accent)'); element.setAttribute('stroke-width', engine().localLengthForScreenPx(scene.svg, 1));
    selection = { scene, path: dragging.path, data, element };
  }, true);
  document.addEventListener('pointerup', event => {
    if (!dragging || event.pointerId !== dragging.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation(); dragging = null;
    if (armedColor) void apply(armedColor);
  }, true);
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !window.MeldexContextMenuUI?.isOpen()) cancel(); }, true);
  window.MeldexViewerHighlights = {
    ensureNative, loadNativeExisting, renderCards,
    getRegion: () => {
      captureText();
      if (!selection || !selection.scene.wrap.isConnected || !engine()?.getScenes().includes(selection.scene)) return null;
      const { scene, path, data } = selection;
      return { path: path.replace(/#page=\d+$/, ''), page: scene.isPdf ? scene.pageIndex + 1 : 1,
        box: [data.x / scene.mediaWidth, data.y / scene.mediaHeight, data.width / scene.mediaWidth, data.height / scene.mediaHeight] };
    },
    menuItems: () => {
      captureText(); // Keep media coordinates before the menu takes focus.
      return [{ label: 'ハイライト', ariaLabel: 'ハイライト', icon: 'highlighter', items: colors().map((color, index) => ({ label: 'テーマカラー ' + (index + 1), ariaLabel: 'テーマカラー ' + (index + 1), icon: 'square', color, action: () => apply(color) })) }];
    },
    reveal(item) {
      const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data || {};
      const normalize = path => String(path || '').replace(/\\/g, '/');
      let scene = engine()?.getScenes().find(s => normalize(s.path) === normalize(item.target_path) && (data.pageIndex == null || s.pageIndex === data.pageIndex));
      if (!scene && data.pageIndex != null && window.MeldexViewerScene.getIndex() !== data.pageIndex) { window.MeldexViewerScene.goToIndex(data.pageIndex); return false; }
      if (!scene) return false;
      const target = scene.strokesG.querySelector(`[data-ann-id="${CSS.escape(item.id)}"]`) || scene.notesG?.querySelector(`[data-ann-id="${CSS.escape(item.id)}"]`);
      if (!target) return false;
      const viewer=window.MeldexViewerScene,rect=target.getBoundingClientRect();
      const dx=innerWidth/2-(rect.left+rect.width/2),dy=innerHeight/2-(rect.top+rect.height/2);
      const delta=window.MeldexViewerSceneUtils.logicalPointFromScreenDelta(dx,dy,viewer.getFlipH(),viewer.getFlipV(),viewer.getRotateDeg());
      viewer.panBy(delta.x,delta.y);
      const before = target.style.filter; target.style.filter = 'drop-shadow(0 0 4px var(--accent))';
      setTimeout(() => { target.style.filter = before; }, 1200); return true;
    },
  };
})();
