/* Shared chat image/PDF -> Viewer and annotated-thumbnail bridge.
   Display URLs are never used as annotation identity: every managed asset is
   reduced to its stable stored path before /viewer?file= or /viewer?pdf= opens. */
(function (global) {
  'use strict';

  const bound = new Map();
  const revisions = new Map();

  function normalizePath(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  function pathFromRawUrl(value) {
    try {
      const parsed = new URL(String(value || ''), global.location?.origin || 'http://localhost');
      if (!/\/(?:api\/)?file-raw$/i.test(parsed.pathname)) return '';
      return normalizePath(parsed.searchParams.get('path') || '');
    } catch {
      const match = String(value || '').match(/[?&]path=([^&]+)/);
      if (!match) return '';
      try { return normalizePath(decodeURIComponent(match[1])); } catch { return ''; }
    }
  }

  function stablePath(asset) {
    if (typeof asset === 'string') return pathFromRawUrl(asset) || normalizePath(asset);
    return normalizePath(
      asset?.path || asset?.storedPath || asset?.assetPath || asset?.sourcePath ||
      pathFromRawUrl(asset?.url || asset?.data_url || '')
    );
  }

  function isManaged(asset) {
    const path = stablePath(asset);
    return !!path && !/^(?:https?:|data:|blob:)/i.test(path);
  }

  function open(asset, options = {}) {
    const path = stablePath(asset);
    if (!isManaged(path)) return false;
    if (typeof global.openViewer !== 'function') return false;
    const pdf = /\.pdf$/i.test(path);
    global.openViewer((pdf ? '/viewer?pdf=' : '/viewer?file=') + encodeURIComponent(path), {
      source: 'chat-asset',
      assetPath: path,
      ...options,
    });
    return true;
  }

  function _setBadge(wrapper, visible) {
    if (!wrapper?.querySelector) return;
    let badge = wrapper.querySelector('[data-chat-annotation-badge]');
    if (!badge && visible) {
      badge = document.createElement('span');
      badge.dataset.chatAnnotationBadge = 'true';
      badge.textContent = 'アノテートあり';
      badge.style.cssText = 'position:absolute;right:6px;bottom:6px;padding:2px 6px;border-radius:999px;background:rgba(20,20,20,.78);color:#fff;font-size:11px;pointer-events:none;';
      wrapper.style.position = wrapper.style.position || 'relative';
      wrapper.appendChild(badge);
    }
    if (badge) badge.hidden = !visible;
  }

  async function refresh(img, wrapper, asset, options = {}) {
    const path = stablePath(asset);
    if (!img || !isManaged(path) || typeof global.apiFetch !== 'function') return false;
    const size = Math.max(32, Math.min(1024, Number(options.size) || 320));
    const suffix = '?target=' + encodeURIComponent(path) + '&size=' + size;
    let info;
    try { info = await global.apiFetch('/annotation-thumbnails' + suffix); }
    catch { info = null; }
    if (!info) return _refreshCloud(img, wrapper, path, options);
    const previous = revisions.get(path);
    revisions.set(path, info.annotationRevision || '');
    if (info.thumbnailUrl) img.src = info.thumbnailUrl;
    else if (info.originalUrl && (!img.src || previous !== info.annotationRevision)) img.src = info.originalUrl;
    _setBadge(wrapper, !!info.fallbackBadge);
    img.dataset.annotationRevision = info.annotationRevision || '';
    if (info.pending && Number(options._attempt || 0) < 8) {
      const nextOptions = { ...options, _attempt: Number(options._attempt || 0) + 1 };
      global.setTimeout?.(() => {
        if (img.isConnected !== false) refresh(img, wrapper, path, nextOptions);
      }, Math.min(1600, 150 * (nextOptions._attempt + 1)));
    }
    return true;
  }

  async function _refreshCloud(img, wrapper, path, options) {
    if (typeof global.apiFetch !== 'function') return false;
    let annotations;
    try { annotations = await global.apiFetch('/annotations?target=' + encodeURIComponent(path) + '&limit=500'); }
    catch { return false; }
    if (!Array.isArray(annotations) || !annotations.length) {
      _setBadge(wrapper, false);
      return true;
    }
    const visualRevision = 'cloud:' + JSON.stringify(annotations.map(row => [
      row?.id, row?.modified, row?.type, row?.shape, row?.color, row?.opacity, row?.data,
    ]));
    revisions.set(path, visualRevision);
    try { await img.decode?.(); } catch {}
    let bitmap;
    try { bitmap = await global.createImageBitmap?.(img); } catch { bitmap = null; }
    const width = Math.max(1, Math.min(Number(options.size) || 320, bitmap?.width || img.naturalWidth || 320));
    const height = Math.max(1, Math.round(width * ((bitmap?.height || img.naturalHeight || width) / (bitmap?.width || img.naturalWidth || width))));
    const composed = await composeCloudThumbnail({ bitmap, annotations, width, height });
    if (composed?.blob) {
      if (img.dataset.annotationObjectUrl) URL.revokeObjectURL(img.dataset.annotationObjectUrl);
      const objectUrl = URL.createObjectURL(composed.blob);
      img.dataset.annotationObjectUrl = objectUrl;
      img.src = objectUrl;
    }
    _setBadge(wrapper, !!composed?.fallbackBadge);
    img.dataset.annotationRevision = visualRevision;
    return true;
  }

  function bind(img, wrapper, asset, options = {}) {
    const path = stablePath(asset);
    if (!img || !isManaged(path)) return false;
    img.dataset.meldexAssetPath = path;
    img.addEventListener('click', event => {
      event.preventDefault();
      open(path, options.viewerOptions || {});
    });
    if (!bound.has(path)) bound.set(path, new Set());
    bound.get(path).add({ img, wrapper, options });
    refresh(img, wrapper, path, options);
    return true;
  }

  function invalidate(targetPath, annotationRevision) {
    const path = stablePath(targetPath);
    if (!path) return 0;
    if (annotationRevision) revisions.set(path, annotationRevision);
    const entries = bound.get(path);
    if (!entries) return 0;
    let count = 0;
    for (const entry of [...entries]) {
      if (!entry.img?.isConnected) { entries.delete(entry); continue; }
      refresh(entry.img, entry.wrapper, path, entry.options);
      count += 1;
    }
    return count;
  }

  function notifyRevision(detail) {
    const path = stablePath(detail?.targetPath || detail?.target_path);
    if (!path) return;
    if (global.dispatchEvent && typeof CustomEvent !== 'undefined') {
      global.dispatchEvent(new CustomEvent('meldex:annotation-revision', { detail: { ...detail, targetPath: path } }));
    } else {
      invalidate(path, detail?.annotationRevision);
    }
  }

  // Cloud callers can pass decoded source pixels and annotations. Composition is
  // performed in a worker where OffscreenCanvas exists; unsupported environments
  // deliberately return the original thumbnail + badge contract.
  async function composeCloudThumbnail({ bitmap, annotations, width, height }) {
    if (!global.Worker || !global.OffscreenCanvas || !global.createImageBitmap || !bitmap) {
      return { bitmap, fallbackBadge: !!annotations?.length };
    }
    const script = `self.onmessage=async e=>{const d=e.data,c=new OffscreenCanvas(d.w,d.h),x=c.getContext('2d');x.drawImage(d.bitmap,0,0,d.w,d.h);let unsupported=false;for(const a of d.annotations||[]){let data=a.data||{};if(typeof data==='string')try{data=JSON.parse(data)}catch{data={}}const p=data.points||[];if(p.length<2){unsupported=true;continue}const pt=q=>{let v=Array.isArray(q)?q:[q.x,q.y],px=Number(v[0]||0),py=Number(v[1]||0);if(data.coordinateSpace!=='media-pixel-v1'&&Math.abs(px)<=1.5&&Math.abs(py)<=1.5)return[px*d.w,py*d.h];const mw=Number(data.mediaWidth||d.bitmap.width),mh=Number(data.mediaHeight||d.bitmap.height);return[px*d.w/mw,py*d.h/mh]};x.beginPath();x.strokeStyle=a.color||'#ffeb3b';x.globalAlpha=Number(a.opacity??1);x.lineWidth=Math.max(1,Number(data.width||3)*d.w/Number(data.mediaWidth||d.bitmap.width));let q=pt(p[0]);x.moveTo(q[0],q[1]);for(let i=1;i<p.length;i++){q=pt(p[i]);x.lineTo(q[0],q[1])}x.stroke()}const blob=await c.convertToBlob({type:'image/png'});self.postMessage({blob,unsupported})}`;
    let workerBitmap;
    try { workerBitmap = await global.createImageBitmap(bitmap); }
    catch { return { bitmap, fallbackBadge: !!annotations?.length }; }
    const workerUrl = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    return new Promise(resolve => {
      const close = () => { worker.terminate(); URL.revokeObjectURL(workerUrl); };
      worker.onmessage = event => { close(); resolve({ blob: event.data.blob, fallbackBadge: !!event.data.unsupported }); };
      worker.onerror = () => { close(); resolve({ bitmap, fallbackBadge: !!annotations?.length }); };
      worker.postMessage({ bitmap: workerBitmap, annotations: annotations || [], w: width, h: height }, [workerBitmap]);
    });
  }

  global.addEventListener?.('meldex:annotation-revision', event => {
    const detail = event?.detail || {};
    invalidate(detail.targetPath, detail.annotationRevision);
  });

  global.MeldexChatViewerAssets = {
    stablePath, isManaged, open, bind, refresh, invalidate, notifyRevision,
    composeCloudThumbnail,
  };
})(typeof window !== 'undefined' ? window : globalThis);
