/* ハイライトは選択した文字（PDFの文字・OCRで認識した文字）に付ける（2026-11-27 利用者の判断）。
   Shift＋ドラッグの範囲選択は、OCRの再認識・画像検索の範囲指定にだけ使い、ハイライトには使わない。
   文字の無い画像・スキャンPDFでは、ハイライトを出さず（理由つきで無効）、マーキングの矩形塗りを案内する。 */
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
  // 一覧の対象は表示中のページ・ファイル（見開きは2ページとも）。表示するページが変わったら読み直す
  // （standalone-secondary-panel.js）。以前は表示中の1ページ目だけを、タブを開いた時に1回読んでいたため、
  // 見開きの2ページ目や、後から移ったページのハイライトが「ハイライトはありません」のままだった（2026-11-27）。
  function listTargets(){
    const scene=window.MeldexViewerScene;
    const items=scene?.getItems?.()||[];
    const group=(scene?.getGroup?.(scene.getIndex())||[]).map(i=>items[i]).filter(Boolean);
    const shown=[...new Set(group.map(item=>scene.itemAnnotationPath(item)).filter(Boolean))];
    return {key:shown.join('\n'),shown};
  }
  function listKey(){return listTargets().key;}
  async function renderCards(host) {
    const token=(cardReads.get(host)||0)+1;cardReads.set(host,token);
    host._highlightCardObserver?.disconnect();host._highlightCardObserver=null;
    const targets=listTargets();
    host.dataset.highlightKey=targets.key;
    if(!targets.shown.length){host.textContent='ファイルを開いてください';return;}
    if(!host.querySelector('[data-viewer-highlight-card]'))host.textContent='読み込み中...';
    try {
      await ensureNative();
      const results=await Promise.all(targets.shown.map(path=>window.apiFetch('/annotations?target='+encodeURIComponent(path))));
      if(cardReads.get(host)!==token||!host.isConnected)return;
      const items=[],seen=new Set();
      for(const row of results.flat()){
        if(!row||seen.has(row.id))continue;
        let data=row.data||{};try{if(typeof data==='string')data=JSON.parse(data);}catch{continue;}
        // 選んだ文字のハイライトだけ（以前に範囲のドラッグで付けた矩形はマーキングとして扱う）
        if(row.type!=='highlight'&&!(data.highlight&&Array.isArray(data.boxes)&&data.boxes.length))continue;
        seen.add(row.id);items.push({row,data});
      }
      // ページ順（EPUBは章・文字の順）・作った順に並べる
      const order=data=>[Number(data.textAnchor?.spine ?? data.pageIndex)||0,Number(data.textAnchor?.start)||0];
      items.sort((a,b)=>(order(a.data)[0]-order(b.data)[0])||(order(a.data)[1]-order(b.data)[1])
        ||String(a.row.created||'').localeCompare(String(b.row.created||'')));
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
  let selection = null, dragging = null;
  function colors() {
    try { if (parent !== window && parent.GBAnnotationHighlights) return parent.GBAnnotationHighlights.colors(); } catch {}
    return (window.getThemeColorSlotSettings?.() || []).filter(Boolean).map(slot => slot.color).filter(Boolean).concat(window.PALETTE_COLORS || ['#e4bd60', '#90bc83', '#7eacd1', '#c48080']).slice(0, 8);
  }
  // ハイライトの色は共通カラーパレットで選ぶ（不透明度つき）。本体の中では本体と同じ「最後に使った色」を使う。
  const OPACITY_MODEL = 'color-alpha-v1';
  const COLOR_KEY = 'meldex-annotation-highlight-color';
  function currentColor() {
    try { if (parent !== window && parent.GBAnnotationHighlights?.currentColor) return parent.GBAnnotationHighlights.currentColor(); } catch {}
    try { const saved = localStorage.getItem(COLOR_KEY); if (saved && CSS.supports('color', saved)) return saved; } catch {}
    const base = colors()[0] || '#e4bd60';
    return typeof window._annotationColorWithAlpha === 'function' ? window._annotationColorWithAlpha(base, 0.4) : base;
  }
  function rememberColor(color) {
    if (!color || color === 'transparent') return;
    try { if (parent !== window && parent.GBAnnotationHighlights?.rememberColor) { parent.GBAnnotationHighlights.rememberColor(color); return; } } catch {}
    try { localStorage.setItem(COLOR_KEY, color); } catch {}
  }
  function pickColor(onPicked) {
    if (typeof window.openColorPalette !== 'function') return;
    const rect = selection?.element?.getBoundingClientRect?.();
    const x = rect ? rect.left + rect.width / 2 : innerWidth / 2, y = rect ? rect.bottom : innerHeight / 2;
    const anchor = { getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0, x, y }) };
    let picked = '';
    window.openColorPalette(anchor, currentColor(), color => { if (color && color !== 'transparent') picked = color; },
      { allowTransparent: false, onClose: () => { if (picked) { rememberColor(picked); onPicked(picked); } } });
  }
  function cancel() { selection?.element?.remove(); selection = null; dragging = null; }
  const NO_TEXT_REASON = 'ハイライトは選択した文字に付けます。文字の無い画像やスキャンしたPDFには、マーキングの矩形塗りを使ってください';
  const EPUB_NO_TEXT_REASON = 'ハイライトは選択した文字に付けます。本文の文字を選んでから押してください';
  // EPUBの本文（viewer-epub.js）。文字は枠（iframe）の中で選ぶ。
  const epub = () => (window.MeldexViewerEpub?.isActive?.() ? window.MeldexViewerEpub : null);
  function noTextReason() { return epub() ? EPUB_NO_TEXT_REASON : NO_TEXT_REASON; }
  // EPUBのハイライト: 位置は章のパス・本文の文字位置・引用（前後つき）。文字の大きさやページ割りが変わっても同じ文字に付く。
  async function applyEpub(color) {
    const reader = epub();
    const context = reader?.captureSelection?.();
    if (!context) { window.MeldexViewerScene?.flashStatus?.(EPUB_NO_TEXT_REASON, 5000); return false; }
    try { await ensureNative(); } catch (error) { window.MeldexViewerScene?.flashStatus?.('ハイライトを保存できませんでした: ' + error.message, 5000); return false; }
    const requestId = crypto.randomUUID();
    rememberColor(color);
    const anchor = context.anchor;
    const data = { text: context.text, textAnchor: anchor, opacityModel: OPACITY_MODEL, clientRequestId: requestId };
    const row = { type: 'highlight', target_path: context.path, target_kind: 'text_range', body: context.text, color, opacity: 1, data,
      target_ref: { file: context.path, container: { kind: 'epub_chapter', id: anchor.href }, anchorSchema: 'meldex-text-anchor-v1',
        startOffset: anchor.start, endOffset: anchor.end, snippet: context.text, prefix: anchor.prefix, suffix: anchor.suffix },
      user: engine()?.viewerAnnotationUser?.() || 'anonymous' };
    const pendingId = reader.addPending({ ...row, id: 'pending-' + requestId });
    reader.clearSelection();
    if (parent !== window) parent.postMessage({ type: 'viewer-ann-highlight-pending', requestId, targetPath: context.path }, location.origin);
    try {
      const result = await window.apiPost('/annotations', row);
      const after = { ...row, id: result.id, created: result.created, modified: result.modified || result.created };
      reader.commitPending(pendingId, after);
      window.__viewerAnnotationReportSave?.(true, 'create', null, { ...result, highlightRequestId: requestId }, { before: null, after });
      return true;
    } catch (error) {
      reader.commitPending(pendingId, null);
      if (engine()?.viewerAnnotationSaveFailed) engine().viewerAnnotationSaveFailed(error);
      else window.MeldexViewerScene?.flashStatus?.('ハイライトを保存できませんでした: ' + (error?.message || error), 5000);
      window.__viewerAnnotationReportSave?.(false, 'create', error, { highlightRequestId: requestId });
      // 同じ文字を選び直した状態に戻し、そのまま再試行できるようにする
      reader.restoreSelection(context);
      return false;
    }
  }
  // 選んだ文字（PDFの文字層・OCRの認識結果・EPUBの本文）があるか。範囲だけの選択は含めない
  function hasTextSelection() {
    if (epub()) return !!epub().hasSelection();
    captureText();
    return !!(selection?.data?.boxes?.length && selection.scene.wrap.isConnected && engine()?.getScenes().includes(selection.scene));
  }
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
      || !selection.data?.boxes?.length || selection.data.width < 1 || selection.data.height < 1) {
      window.MeldexViewerScene?.flashStatus?.(NO_TEXT_REASON, 5000);
      return false;
    }
    const { scene, data, element, path: targetPath } = selection;
    const requestId = crypto.randomUUID();
    selection = null; element?.remove();
    rememberColor(color);
    const savedData = { ...data, coordinateSpace: engine().COORD_SPACE, highlight: true, opacityModel: OPACITY_MODEL,
      mediaWidth: scene.mediaWidth, mediaHeight: scene.mediaHeight, thumbnail: thumbnail(scene, data), clientRequestId: requestId };
    if (scene.isPdf) savedData.pageIndex = scene.pageIndex;
    const painted = engine().renderRect(scene, savedData, color, 1, null);
    if (parent !== window) parent.postMessage({ type: 'viewer-ann-highlight-pending', requestId, targetPath: scene.path }, location.origin);
    try {
      const row = { type: 'rect', target_path: scene.path, target_kind: 'viewer_region', color, opacity: 1,
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
    if (event.button !== 0 || !event.shiftKey || document.documentElement.dataset.viewerAnnotationCapability === 'disabled') return;
    const scene = engine()?.findSceneForClientPoint(event.clientX, event.clientY);
    if (!scene) return;
    event.preventDefault(); event.stopImmediatePropagation();
    cancel();
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
    const element = engine().renderRect(scene, data, 'var(--accent)', 0.25, null);
    element.dataset.highlightSelection = '';
    element.setAttribute('stroke', 'var(--accent)'); element.setAttribute('stroke-width', engine().localLengthForScreenPx(scene.svg, 1));
    selection = { scene, path: dragging.path, data, element };
  }, true);
  document.addEventListener('pointerup', event => {
    if (!dragging || event.pointerId !== dragging.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation(); dragging = null;
  }, true);
  // 本体のアノテートツールバーの「ハイライト」ボタンへ、文字を選んでいるかを知らせる（押せる／押せないの切り替え）
  let lastTextState = null, textStateTimer = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(textStateTimer);
    textStateTimer = setTimeout(() => {
      const has = epub() ? !!epub().hasSelection() : !!window.MeldexViewerTextLayer?.getSelection?.()?.text;
      if (has === lastTextState || parent === window) return;
      lastTextState = has;
      try { parent.postMessage({ type: 'viewer-ann-text-selection', hasText: has }, location.origin); } catch {}
    }, 80);
  });
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !window.MeldexContextMenuUI?.isOpen()) cancel(); }, true);
  window.MeldexViewerHighlights = {
    ensureNative, loadNativeExisting, renderCards, listKey,
    getRegion: () => {
      if (epub()) return null; // EPUBは文字の本文なので、範囲での認識・画像検索の対象にしない
      captureText();
      if (!selection || !selection.scene.wrap.isConnected || !engine()?.getScenes().includes(selection.scene)) return null;
      const { scene, path, data } = selection;
      return { path: path.replace(/#page=\d+$/, ''), page: scene.isPdf ? scene.pageIndex + 1 : 1,
        box: [data.x / scene.mediaWidth, data.y / scene.mediaHeight, data.width / scene.mediaWidth, data.height / scene.mediaHeight] };
    },
    menuItems: () => {
      // Keep media coordinates before the menu takes focus.
      if (!hasTextSelection()) {
        return [{ label: 'ハイライト', ariaLabel: 'ハイライト', icon: 'highlighter', disabled: true, title: noTextReason(), e2eId: 'viewer-highlight-create' }];
      }
      const color = currentColor();
      // 色のパレットを開く間に選択が外れても付けられるよう、EPUBは開いた時の選択を覚えておく
      const create = epub() ? (picked => applyEpub(picked)) : (picked => apply(picked));
      return [
        { label: 'ハイライト', ariaLabel: 'ハイライト', icon: 'highlighter', color, e2eId: 'viewer-highlight-create', action: () => create(currentColor()) },
        { label: 'ハイライトの色...', ariaLabel: 'ハイライトの色...', icon: 'palette', e2eId: 'viewer-highlight-pick-color', action: () => pickColor(picked => create(picked)) },
      ];
    },
    // アノテートツールバーの「ハイライト」ボタン: 今選んでいる文字にハイライトを付ける
    hasTextSelection,
    highlightTextSelection(color) {
      if (epub()) return applyEpub(color || currentColor());
      if (!hasTextSelection()) { window.MeldexViewerScene?.flashStatus?.(NO_TEXT_REASON, 5000); return false; }
      return apply(color || currentColor());
    },
    get noTextReason() { return noTextReason(); },
    currentColor,
    reveal(item) {
      const data = typeof item.data === 'string' ? JSON.parse(item.data) : item.data || {};
      if (data.textAnchor?.kind === 'epub') return epub() ? epub().reveal(item) : false;
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
