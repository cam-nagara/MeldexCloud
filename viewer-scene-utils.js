/* viewer-scene-utils.js — Meldexビューワー: シーン制御から使う純粋ヘルパー関数群。
   計画書: app/docs/viewer-stability-common-ui-plan-2026-07-31.md「実装変更 > 2. ビューワーUI」
   分割元: viewer.html（旧・単一 <script type="module"> ブロック）
   方針: 状態を持たない（またはURLクエリのみに依存する）純粋寄りの関数だけを置く。
         viewer-scene.js から window.MeldexViewerSceneUtils 経由で呼び出される。
   公開: window.MeldexViewerSceneUtils */
(function () {
  'use strict';

  const API = '/api';
  const params = new URLSearchParams(location.search);
  const archivePath = params.get('archive') || '';
  const archiveMember = params.get('member') || '';
  const archiveDisplayPath = archivePath && archiveMember ? ('zip:' + archivePath + '!/' + archiveMember) : '';
  const VIEWER_NATIVE_IMAGE_EXTS = new Set(['png', 'apng', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif']);
  // ビューワーが動画として認識する拡張子（サーバー側 images-in-folder の include_videos=1 集合と合わせる。
  // meldex_api_file_index.py / meldex_standalone_runtime.py の VIEWER_VIDEO_EXTENSIONS 参照）。
  const VIEWER_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogv']);
  const VIEWER_IMAGE_LOAD_TIMEOUT_MS = 3000;

  // 任意のURLSearchParamsから files パラメータを解析する（現在ページの params 以外にも、
  // iframe再利用の開き直し要求で受け取る別URLの解析に使う。parseFilesParam()はcurrentページ用）。
  function parseFilesParamFrom(sp) {
    const repeated = sp.getAll('files');
    if (repeated.length > 1) return repeated.filter(Boolean);
    const raw = sp.get('files') || '';
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {}
    return raw.split(',').filter(Boolean);
  }

  function parseFilesParam() { return parseFilesParamFrom(params); }

  async function fetchJsonChecked(url) {
    const response = await fetch(url);
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      throw new Error((data && (data.detail || data.error || data.message)) || response.statusText || ('HTTP ' + response.status));
    }
    return data;
  }

  function imageExtFromPath(path) {
    const raw = String(path || '').split('?')[0].split('#')[0];
    const ext = raw.includes('.') ? raw.split('.').pop().toLowerCase() : '';
    return ext && ext !== raw.toLowerCase() ? ext : '';
  }

  function isNativeBrowserImagePath(path) {
    const ext = imageExtFromPath(path);
    return !ext || VIEWER_NATIVE_IMAGE_EXTS.has(ext);
  }

  function isVideoPath(path) {
    const ext = imageExtFromPath(path);
    return !!ext && VIEWER_VIDEO_EXTS.has(ext);
  }

  function isLocalAbsoluteImagePath(path) {
    const value = String(path || '').trim();
    return /^\/{1,}[^/]/.test(value) || /^\\\\/.test(value) || /^[A-Za-z]:[\\/]/.test(value);
  }

  function fileRawUrlForPath(path) {
    if (archiveDisplayPath && path === archiveDisplayPath) {
      return API + '/archive/file?path=' + encodeURIComponent(archivePath)
        + '&member=' + encodeURIComponent(archiveMember);
    }
    return API + '/file-raw?path=' + encodeURIComponent(path);
  }

  function imagePreviewUrlForPath(path) {
    if (archiveDisplayPath && path === archiveDisplayPath) {
      return fileRawUrlForPath(path);
    }
    return API + '/image-preview?path=' + encodeURIComponent(path) + '&size=4096';
  }

  function shouldPreferPreviewImagePath(path) {
    return !isNativeBrowserImagePath(path);
  }

  function splitViewerPath(path) {
    const normalized = String(path || '').replace(/\\/g, '/');
    const parts = normalized.split('/');
    const name = parts.pop() || '';
    return { name, folder: parts.join('/') };
  }

  function isEmbeddedMeldexViewer() {
    return !!(window.parent && window.parent !== window);
  }

  function viewerPathKey(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
  }

  function findImageItemIndex(collection, path, name) {
    const pathKey = viewerPathKey(path);
    let found = collection.findIndex(it => viewerPathKey(it.path) === pathKey);
    if (found >= 0) return found;
    return collection.findIndex(it => it.name === name);
  }

  function cssUrl(url) { return 'url("' + String(url || '').replace(/["\\\n\r\f]/g, ch => '\\' + ch) + '")'; }

  function parentMessageTargetOrigin() {
    try {
      return location.origin && location.origin !== 'null' ? location.origin : '*';
    } catch {
      return '*';
    }
  }

  function isPortrait(it) { return it.h > it.w; }

  // ============================================================
  // iframe再利用（項目7: viewer-open-request.js + viewer-scene.js が使う純粋ヘルパー）。
  // アーカイブ/ネイティブファイル選択等、非同期の前処理(prepareNativeInitialTarget相当)が
  // 必要なパラメータは開き直し非対応（親は従来どおりsrc差し替えにフォールバックする）。
  // ============================================================
  const REOPEN_UNSUPPORTED_PARAM_KEYS = ['archive', 'member', 'native', 'markup', 'open', 'path'];

  function deriveViewerTargetFromSearchParams(sp) {
    return {
      folderPath: sp.get('folder') || '',
      pdfPath: sp.get('pdf') || '',
      singleFile: sp.get('file') || '',
      sheetContextId: sp.get('sheetContext') || '',
      multiFilePaths: parseFilesParamFrom(sp),
    };
  }

  function isViewerReopenTargetSupported(sp) {
    for (const key of REOPEN_UNSUPPORTED_PARAM_KEYS) {
      if (sp.has(key)) return false;
    }
    return !!(sp.get('folder') || sp.get('pdf') || sp.get('file') || sp.get('sheetContext') || sp.get('files') || sp.getAll('files').length);
  }

  // 同期・高速判定のみ（postMessageのack/nackを即答するため）。実際の読み込みは行わない。
  function canReopenWithUrl(urlString) {
    try {
      const sp = new URL(String(urlString || ''), location.origin).searchParams;
      return isViewerReopenTargetSupported(sp);
    } catch {
      return false;
    }
  }

  function imageElementHasRenderablePixels(img) {
    return !!(img && (img.naturalWidth || img.naturalHeight));
  }

  function logicalPointFromScreenDelta(dx, dy, flipH, flipV, rotateDeg) {
    const screenX = (Number(dx) || 0) * (flipH ? -1 : 1);
    const screenY = (Number(dy) || 0) * (flipV ? -1 : 1);
    const rad = -(Number(rotateDeg) || 0) * Math.PI / 180;
    return {
      x: screenX * Math.cos(rad) - screenY * Math.sin(rad),
      y: screenX * Math.sin(rad) + screenY * Math.cos(rad),
    };
  }

  function waitForImageElement(img, timeoutMs = VIEWER_IMAGE_LOAD_TIMEOUT_MS) {
    return new Promise(resolve => {
      if (!img) { resolve(false); return; }
      if (imageElementHasRenderablePixels(img)) { resolve(true); return; }
      if (img.complete) { resolve(imageElementHasRenderablePixels(img)); return; }
      let done = false;
      let timer = 0;
      let frame = 0;
      const finish = ok => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (frame) cancelAnimationFrame(frame);
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        resolve(!!ok);
      };
      const onLoad = () => finish(imageElementHasRenderablePixels(img));
      const onError = () => finish(false);
      const checkRenderable = () => {
        if (done) return;
        if (imageElementHasRenderablePixels(img)) { finish(true); return; }
        frame = requestAnimationFrame(checkRenderable);
      };
      timer = setTimeout(() => finish(false), timeoutMs);
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
      frame = requestAnimationFrame(checkRenderable);
    });
  }

  window.MeldexViewerSceneUtils = {
    API,
    archivePath,
    archiveMember,
    archiveDisplayPath,
    parseFilesParam,
    parseFilesParamFrom,
    fetchJsonChecked,
    imageExtFromPath,
    isNativeBrowserImagePath,
    isVideoPath,
    isLocalAbsoluteImagePath,
    fileRawUrlForPath,
    imagePreviewUrlForPath,
    shouldPreferPreviewImagePath,
    splitViewerPath,
    isEmbeddedMeldexViewer,
    viewerPathKey,
    findImageItemIndex,
    cssUrl,
    parentMessageTargetOrigin,
    isPortrait,
    imageElementHasRenderablePixels,
    waitForImageElement,
    deriveViewerTargetFromSearchParams,
    isViewerReopenTargetSupported,
    canReopenWithUrl,
    logicalPointFromScreenDelta,
  };
})();
