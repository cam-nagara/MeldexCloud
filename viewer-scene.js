/* viewer-scene.js — Meldexビューワーのコアエンジン（画像/PDF読み込み・表示状態・ズーム/パン/
   回転/反転・スライドショー・HUD・フォルダナビゲーション）。計画: viewer-stability-common-ui-gap-fix-plan-2026-08-04.md。
   分割元: viewer.html。PDF描画責務は viewer-pdf-renderer.js へ分離済み。関連: viewer-scene-utils.js
   （純粋ヘルパー）/ viewer-controls.js・viewer-context-menu.js（入力配線、本ファイルへ発呼のみ）/
   viewer-annotations.js（注釈、本ファイルへコールバック登録）。公開: window.MeldexViewerScene。
   `viewer-layout-resize` / notifyResize() は寸法変更通知を受けて再フィット・状態復元する。 */
(function () {
  'use strict';

  const Utils = window.MeldexViewerSceneUtils;
  const API = Utils.API;

  const params = new URLSearchParams(location.search);
  let folderPath = params.get('folder') || '';
  let pdfPath = params.get('pdf') || '';
  let singleFile = params.get('file') || '';  // 単一ファイル表示
  let sheetContextId = params.get('sheetContext') || ''; // iframe再利用の開き直し要求で更新されうる
  const archiveDisplayPath = Utils.archiveDisplayPath;
  if (archiveDisplayPath) {
    if (/\.pdf$/i.test(Utils.archiveMember)) pdfPath = archiveDisplayPath;
    else singleFile = archiveDisplayPath;
  }
  let multiFilePaths = Utils.parseFilesParam(); // 複数ファイル
  let isPdf = false;
  let isSingle = false;
  let isMulti = false;

  function refreshViewerModeFlags() {
    isPdf = !!pdfPath;
    isSingle = !!singleFile;
    isMulti = multiFilePaths.length > 0;
  }

  function hasExplicitViewerTarget() {
    return !!(folderPath || pdfPath || singleFile || archiveDisplayPath || sheetContextId || multiFilePaths.length);
  }

  function applyInitialOpenPath(path) {
    const value = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!value) return false;
    const ext = value.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
    if (ext === 'pdf') pdfPath = value;
    else singleFile = value;
    refreshViewerModeFlags();
    return true;
  }

  async function prepareNativeInitialTarget() {
    const openPath = params.get('open') || params.get('path') || '';
    if (!hasExplicitViewerTarget() && applyInitialOpenPath(openPath)) return;
    if (hasExplicitViewerTarget() || params.get('native') !== '1') return;
    try {
      const response = await fetch(API + '/standalone/config', { cache: 'no-store' });
      if (!response.ok) return;
      const config = await response.json();
      if (applyInitialOpenPath(config?.initialPath || '')) return;
      if (config?.root) {
        folderPath = '.';
        refreshViewerModeFlags();
        return;
      }
      const picked = await fetch(API + '/standalone/open-file', { method: 'POST' });
      if (!picked.ok) return;
      const selected = await picked.json();
      applyInitialOpenPath(selected?.initialPath || selected?.path || '');
    } catch {}
  }

  refreshViewerModeFlags();
  // ツールバーの自動表示/非表示は viewer-controls.js の統一ロジック（マウス近接+フォーカス保持+
  // タッチ常時表示）に一本化済み。埋め込み(embed=1)専用のhover制御はここでは行わない
  // （ビューワー残課題修正計画 2026-08-04「6. ツールバーの自動表示/非表示」）。

  let items = [];
  let idx = 0;
  let playing = false;
  let reversePlay = false;  // 逆再生
  let timer = null;
  let activeLayer = 'A';
  let mode = localStorage.getItem('viewer-mode') || 'single';
  let speed = parseFloat(localStorage.getItem('viewer-speed') || '3');
  let fadeMs = parseInt(localStorage.getItem('viewer-fade') || '300');
  let bgBlur = localStorage.getItem('viewer-bg') !== 'false';
  let hudVisible = localStorage.getItem('viewer-hud') === 'true';
  let zoom = 1;
  let fitMode = localStorage.getItem('viewer-fit') || 'original_contain'; // 'original_contain' | 'contain' | 'width' | 'height' | 'none'
  let flipH = false, flipV = false, rotateDeg = 0;
  let pdfDoc = null;
  let showGroupToken = 0;
  let collectionLoadToken = 0;
  let deferredSingleFileFolderRefresh = null;
  let viewerLoadingToken = 0;

  document.getElementById('sel-mode').value = mode;
  document.getElementById('speed').value = speed;
  document.getElementById('speed-label').textContent = speed.toFixed(1) + 's';
  if (!hudVisible) document.getElementById('hud').classList.add('hidden');
  document.getElementById('btn-bg').classList.toggle('active', bgBlur);
  document.getElementById('btn-hud').classList.toggle('active', hudVisible);
  document.documentElement.style.setProperty('--fade-ms', fadeMs + 'ms'); // fadeMsの初期反映

  // PDF.jsの読み込み・ページ描画は viewer-pdf-renderer.js（window.MeldexViewerPdfRenderer）へ分離済み
  // （ビューワー残課題修正計画 2026-08-04「1. 非破壊リサイズとPDF」。両ファイルを各1,000行以内にするため）。
  const PdfRenderer = window.MeldexViewerPdfRenderer;
  const viewerPreparation = (async () => {
    await prepareNativeInitialTarget();
    if (isPdf) await PdfRenderer.ensurePdfjs();
  })();

  function showViewerLoading(message = '読み込み中...') {
    const token = ++viewerLoadingToken;
    const loading = document.getElementById('viewer-loading');
    const text = document.getElementById('viewer-loading-text');
    if (text) text.textContent = message;
    if (loading) loading.classList.remove('hidden');
    const counter = document.getElementById('counter');
    if (counter && items.length === 0) counter.textContent = message;
    return token;
  }

  function hideViewerLoading(token) {
    if (!token || token !== viewerLoadingToken) return;
    document.getElementById('viewer-loading')?.classList.add('hidden');
  }

  function isViewerLoadingVisible() {
    const loading = document.getElementById('viewer-loading');
    return !!loading && !loading.classList.contains('hidden');
  }

  function hasVisibleViewerContent() {
    return !!document.querySelector('.layer.show img, .layer.show video, .layer.show canvas');
  }

  function makeImageItem(path, name) {
    const fileName = name || String(path || '').split(/[\\/]/).filter(Boolean).pop() || String(path || '');
    const rawUrl = Utils.fileRawUrlForPath(path);
    if (Utils.isVideoPath(path)) {
      // 動画はプレビュー変換を経由せず file-raw をそのまま使う（Range対応のFileResponseで
      // ネイティブ<video>のシーク・ストリーミングに対応済み）。
      return {
        type: 'video',
        name: fileName,
        url: rawUrl,
        rawUrl,
        previewUrl: rawUrl,
        urlCandidates: [rawUrl],
        urlCandidateIndex: 0,
        w: 0,
        h: 0,
        path,
      };
    }
    const previewUrl = Utils.imagePreviewUrlForPath(path);
    const urlCandidates = Utils.shouldPreferPreviewImagePath(path) ? [previewUrl, rawUrl] : [rawUrl, previewUrl];
    return {
      type: 'image',
      name: fileName,
      url: urlCandidates[0],
      rawUrl,
      previewUrl,
      urlCandidates,
      urlCandidateIndex: 0,
      w: 0,
      h: 0,
      path,
    };
  }

  function safeSheetMediaUrl(value) {
    const text = String(value || '').trim();
    if (!text || /[\u0000-\u001f]/.test(text)) return '';
    const inlineImage = text.match(/^data:image\/(png|jpeg|gif|webp|avif);base64,([A-Za-z0-9+/]*={0,2})$/i);
    if (inlineImage) {
      const kind = inlineImage[1].toLowerCase();
      const encoded = inlineImage[2];
      if (!encoded || encoded.length % 4 !== 0) return '';
      const padding = encoded.endsWith('==') ? 2 : (encoded.endsWith('=') ? 1 : 0);
      const decodedBytes = Math.floor(encoded.length * 3 / 4) - padding;
      if (decodedBytes > 5 * 1024 * 1024) return '';
      let head = [];
      try { head = [...atob(encoded.slice(0, 64))].map(ch => ch.charCodeAt(0)); } catch { return ''; }
      const ascii = String.fromCharCode(...head);
      const valid = (
        (kind === 'png' && head.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10')
        || (kind === 'jpeg' && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
        || (kind === 'gif' && (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')))
        || (kind === 'webp' && ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP')
        || (kind === 'avif' && ascii.slice(4, 8) === 'ftyp' && /^(?:avif|avis)$/.test(ascii.slice(8, 12)))
      );
      return valid ? text : '';
    }
    if (/^(?:https?:|blob:)/i.test(text)) return text;
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith('//')) return '';
    try {
      const parsed = new URL(text, location.origin);
      return parsed.origin === location.origin ? text : '';
    } catch {
      return '';
    }
  }

  function makeSheetContextImageItem(source) {
    const path = String(source?.path || '');
    const safeUrl = safeSheetMediaUrl(source?.url);
    const assetKind = String(source?.asset_kind || source?.assetKind || '').toLowerCase();
    // data: video is never playable. A saved video may however carry a bounded,
    // validated data:image preview, which is safe to use only as its poster.
    if (assetKind === 'video' && !path && /^data:/i.test(safeUrl)) return null;
    if (!path && !safeUrl) return null;
    const item = makeImageItem(path || safeUrl, source?.name || '');
    if (assetKind === 'video') item.type = 'video';
    if (safeUrl && assetKind === 'video' && path) {
      // X動画はpath=保存済み動画、url=プレビュー画像を同時に持つ。再生URLは
      // path由来のfile-rawのまま保持し、画像URLはposter用途だけに分離する。
      item.posterUrl = safeUrl;
    } else if (safeUrl) {
      item.url = safeUrl;
      item.rawUrl = item.url;
      item.previewUrl = item.url;
      item.urlCandidates = [item.url];
    }
    item.w = Number(source?.width || 0);
    item.h = Number(source?.height || 0);
    item.sheetImageId = String(source?.id || '');
    item.assetKind = assetKind || item.type;
    return item;
  }

  function requestSheetContext() {
    if (!sheetContextId || window.parent === window) return false;
    parent.postMessage({
      type: 'viewer-sheet-context-request',
      contextId: sheetContextId,
    }, Utils.parentMessageTargetOrigin());
    return true;
  }

  function applySheetContextPayload(message) {
    if (!sheetContextId || message?.contextId !== sheetContextId) return false;
    if (message.boundary) {
      if (message.message) flashStatus(message.message);
      return true;
    }
    const nextItems = Array.isArray(message.images)
      ? message.images.map(makeSheetContextImageItem).filter(item => item && (item.url || item.path))
      : [];
    if (!nextItems.length) {
      flashStatus(message.message || 'このセルに画像はありません');
      return true;
    }
    pause();
    items = nextItems;
    idx = Math.max(0, Math.min(items.length - 1, Number(message.startIndex) || 0));
    collectionLoadToken++;
    preloadNearbyImageMeta(idx, items);
    showGroup(idx);
    const rowInfo = [message.rowName, message.column].filter(Boolean).join(' / ');
    if (rowInfo) flashStatus(rowInfo);
    return true;
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    if (event.origin !== location.origin && event.origin !== 'null') return;
    if (event.data?.type === 'viewer-sheet-context-set') applySheetContextPayload(event.data);
  });

  function switchItemToPreviewUrl(item) {
    if (!item?.path || item._viewerPreviewFallbackUsed) return false;
    const candidates = Array.isArray(item.urlCandidates) && item.urlCandidates.length
      ? item.urlCandidates
      : [item.previewUrl || Utils.imagePreviewUrlForPath(item.path)].filter(Boolean);
    const currentIndex = Math.max(0, item.urlCandidateIndex || 0);
    const nextUrl = candidates[currentIndex + 1];
    if (!nextUrl || item.url === nextUrl) return false;
    item.urlCandidateIndex = currentIndex + 1;
    item.url = nextUrl;
    item.displayUrl = '';
    item._viewerPreviewFallbackUsed = item.urlCandidateIndex >= candidates.length - 1;
    return true;
  }

  async function waitForViewerImage(img) {
    const ok = await Utils.waitForImageElement(img);
    if (ok) return true;
    const item = img?._viewerItem;
    if (!switchItemToPreviewUrl(item)) return false;
    const nextSrc = displayItemUrl(item);
    if (!nextSrc) return false;
    img.src = nextSrc;
    return Utils.waitForImageElement(img);
  }

  async function refreshSingleFileFolderItems(parentFolder, fileName, filePath, loadToken) {
    let data = [];
    try {
      data = await Utils.fetchJsonChecked(API + '/images-in-folder?path=' + encodeURIComponent(parentFolder) + '&include_videos=1');
    } catch (e) {
      if (loadToken === collectionLoadToken) flashStatus('画像一覧読み込みエラー');
      return;
    }
    if (loadToken !== collectionLoadToken || !Array.isArray(data) || data.length === 0) return;
    const folderItems = data.map(it => makeImageItem(it.path, it.name));
    const startIdx = Utils.findImageItemIndex(folderItems, filePath, fileName);
    if (startIdx < 0) return;
    items = folderItems;
    idx = startIdx;
    preloadNearbyImageMeta(idx, items);
    updateViewerPositionControls();
    updateHud();
    notifyParentCurrentViewerFile();
  }

  function scheduleSingleFileFolderItemsRefresh(parentFolder, fileName, filePath, loadToken) {
    deferredSingleFileFolderRefresh = () => {
      const run = () => refreshSingleFileFolderItems(parentFolder, fileName, filePath, loadToken);
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1200 });
      else setTimeout(run, 450);
    };
  }

  function clearViewerContent() {
    items = [];
    const layerA = document.getElementById('layerA');
    const layerB = document.getElementById('layerB');
    if (layerA) layerA.innerHTML = '';
    if (layerB) layerB.innerHTML = '';
    document.getElementById('bgA')?.classList.remove('show');
    document.getElementById('bgB')?.classList.remove('show');
  }

  // init()と「iframe再利用の開き直し要求」(項目7)の共通本体。target = { folderPath, pdfPath,
  // singleFile, multiFilePaths, sheetContextId }。呼び出し前にモジュール変数へ反映してから呼ぶこと
  // （refreshViewerModeFlags()も呼び出し側の責務）。戻り値: 表示対象を確定できたか。
  async function loadResolvedTarget() {
    pdfDoc = null;
    renderCache.clear();
    if (isPdf) {
      showViewerLoading('PDFを読み込み中...');
      try {
        pdfDoc = await PdfRenderer.openDocument(Utils.fileRawUrlForPath(pdfPath));
        items = [];
        for (let i = 1; i <= pdfDoc.numPages; i++) items.push({type: 'pdf-page', pageNum: i, url: '', w: 0, h: 0, path: pdfPath});
        const size0 = await PdfRenderer.getPageNaturalSize(pdfDoc, 1);
        items[0].w = size0.width; items[0].h = size0.height;
        applyFit();
      } catch (e) {
        showViewerLoading('PDF読み込み失敗');
        document.getElementById('hud-info').textContent = 'PDF読み込み失敗: ' + e.message;
        clearViewerContent();
        return false;
      }
    } else if (isMulti) {
      // 複数ファイル選択 → 選択されたファイルだけを再生
      showViewerLoading('画像を読み込み中...');
      collectionLoadToken++;
      items = multiFilePaths.map(p => makeImageItem(p));
      idx = 0;
      preloadNearbyImageMeta(0, items);
    } else if (singleFile) {
      // 単一ファイルは選択画像を先に表示し、フォルダ一覧は後から読み込む。
      showViewerLoading('画像を読み込み中...');
      const loadToken = ++collectionLoadToken;
      const { name: fileName, folder: parentFolder } = Utils.splitViewerPath(singleFile);
      items = [makeImageItem(singleFile, fileName)];
      idx = 0;
      // singleFile === archiveDisplayPath の時だけ zip内エントリ表示（兄弟一覧の概念がない）。
      // 開き直し要求(項目7)はarchiveパラメータ非対応のため、この等価判定で正しく再有効化される。
      if (parentFolder && singleFile !== archiveDisplayPath) scheduleSingleFileFolderItemsRefresh(parentFolder, fileName, singleFile, loadToken);
    } else if (folderPath) {
      showViewerLoading('ファイル一覧を読み込み中...');
      const loadToken = ++collectionLoadToken;
      let data = [];
      try {
        data = await Utils.fetchJsonChecked(API + '/images-in-folder?path=' + encodeURIComponent(folderPath) + '&include_videos=1');
      } catch (e) {
        showViewerLoading('画像一覧読み込み失敗');
        document.getElementById('hud-info').textContent = '画像一覧読み込み失敗: ' + (e?.message || e);
        clearViewerContent();
        return false;
      }
      if (loadToken !== collectionLoadToken) return false;
      items = data.map(it => makeImageItem(it.path, it.name));
      if (items.length === 0) {
        showViewerLoading('画像がありません');
        document.getElementById('hud-info').textContent = '画像がありません';
        clearViewerContent();
        return false;
      }
      idx = 0;
      preloadNearbyImageMeta(0, items);
    } else if (sheetContextId) {
      showViewerLoading('シートの画像を読み込み中...');
      requestSheetContext();
    } else {
      showViewerLoading('表示するファイルがありません');
      document.getElementById('hud-info').textContent = '画像またはPDFを開いてください';
      clearViewerContent();
      return false;
    }
    if (items.length > 0) {
      await showGroup(idx);
      updateHud();
      if (deferredSingleFileFolderRefresh) {
        const runDeferredRefresh = deferredSingleFileFolderRefresh;
        deferredSingleFileFolderRefresh = null;
        setTimeout(runDeferredRefresh, 450);
      }
      pause();
    }
    return true;
  }

  async function init() {
    await viewerPreparation;
    await loadResolvedTarget();
  }

  // ============================================================
  // iframe再利用: 親から同一iframeへの開き直し要求(viewer-open-request)受け口。
  // プロトコル(ack/nack/postMessage)自体は viewer-open-request.js が担当し、URL解析・対応可否判定
  // の純粋ヘルパーは viewer-scene-utils.js（Utils.canReopenWithUrl 等）へ集約済み。本ファイルは
  // 「実際に開き直す」状態変更だけを担当する。
  // ============================================================

  // canReopenWithUrl()がtrueの場合のみ呼び出すこと。ズーム/パン/回転はリセットし、
  // fitMode・表示モード(mode)は維持する。ページ遷移は行わない。
  async function reopenWithUrl(urlString) {
    const sp = new URL(String(urlString || ''), location.origin).searchParams;
    pause();
    showGroupToken++;
    collectionLoadToken++;
    window.MeldexViewerAnnotations?.resetPointerPath?.();
    zoom = 1;
    panX = 0; panY = 0;
    flipH = false; flipV = false; rotateDeg = 0;
    applyViewerTransform();
    document.getElementById('btn-flip-h')?.classList.remove('active');
    document.getElementById('btn-flip-v')?.classList.remove('active');
    const target = Utils.deriveViewerTargetFromSearchParams(sp);
    folderPath = target.folderPath;
    pdfPath = target.pdfPath;
    singleFile = target.singleFile;
    multiFilePaths = target.multiFilePaths;
    sheetContextId = target.sheetContextId;
    refreshViewerModeFlags();
    await loadResolvedTarget();
    loadSiblingFolders();
  }

  function rawItemUrl(item) { return item?.url || item?.path || ''; }
  function displayItemUrl(item) { return item?.displayUrl || window.MeldexPwaFileUrl?.displayUrl?.(rawItemUrl(item)) || item?.url || ''; }
  async function ensureItemUrl(item) {
    if (!item || item.type !== 'image') return displayItemUrl(item);
    try {
      const info = await window.MeldexPwaFileUrl?.ensureDisplayUrl?.(rawItemUrl(item), { allowLargeBlob: true });
      if (info?.url) item.displayUrl = info.url;
    } catch {}
    return displayItemUrl(item);
  }

  async function loadImageMeta(img) {
    if ((img.w && img.h) || img._viewerMetaDone || img.type !== 'image') return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const src = await ensureItemUrl(img);
      const probe = new Image();
      probe.src = src || img.url;
      const ok = await Utils.waitForImageElement(probe);
      if (ok) {
        img.w = probe.naturalWidth;
        img.h = probe.naturalHeight;
        img._viewerMetaDone = true;
        return;
      }
      if (!switchItemToPreviewUrl(img)) break;
    }
    img._viewerMetaDone = true;
  }

  async function preloadImageMeta(startIdx, sourceItems = items) {
    let next = Math.max(0, startIdx || 0);
    const workers = Array.from({ length: Math.min(3, Math.max(0, sourceItems.length - next)) }, async () => {
      while (next < sourceItems.length) await loadImageMeta(sourceItems[next++]);
    });
    await Promise.all(workers);
  }

  function preloadNearbyImageMeta(centerIdx, sourceItems = items) {
    const start = Math.max(0, (centerIdx || 0) - 1);
    const end = Math.min(sourceItems.length, (centerIdx || 0) + 3);
    return preloadImageMeta(0, sourceItems.slice(start, end));
  }

  async function ensureGroupMeta(startIdx) {
    if (!isPdf) await Promise.all([items[startIdx], items[startIdx + 1]].filter(Boolean).map(loadImageMeta));
  }

  function getGroup(startIdx) {
    if (items.length === 0) return [];
    if (startIdx < 0 || startIdx >= items.length) startIdx = 0;
    // シート画像セルでは「前へ／次へ」をセル内の画像1枚単位で扱う。
    // 通常フォルダ閲覧の見開き設定は維持するが、セルをまたぐグループ化はしない。
    if (sheetContextId) return [startIdx];
    if (mode === 'single') return [startIdx];
    const a = items[startIdx];
    if (!a) return [startIdx];
    if (isPdf) {
      // PDF: 1ページ目は単体、以降は2ページずつ
      if (startIdx === 0) return [0];
      if (startIdx + 1 < items.length) return [startIdx, startIdx + 1];
      return [startIdx];
    }
    // 動画は見開き/マンガモードでも常に単体表示
    if (a.type === 'video') return [startIdx];
    // 画像: 縦長2枚連続→見開き
    if (!Utils.isPortrait(a) || startIdx + 1 >= items.length) return [startIdx];
    const b = items[startIdx + 1];
    if (!b || b.type === 'video' || !Utils.isPortrait(b)) return [startIdx];
    return [startIdx, startIdx + 1];
  }

  function currentDisplayOrder() {
    const group = getGroup(idx);
    return mode === 'manga' && group.length === 2 ? [group[1], group[0]] : group;
  }

  function itemAnnotationPath(item) {
    return !item ? '' : (isPdf ? (item.path || pdfPath || '') + '#page=' + (item.pageNum || idx + 1) : item.path || pdfPath || singleFile || '');
  }

  const renderCache = new Map();

  function notifyParentCurrentViewerFile() {
    if (window.parent === window) return;
    const item = items.length ? items[Math.max(0, Math.min(items.length - 1, idx))] : null;
    const path = item?.path || item?.url || '';
    if (!path) return;
    const currentFolder = _currentFolderPath || Utils.splitViewerPath(path).folder || folderPath || Utils.splitViewerPath(singleFile || pdfPath).folder || '';
    try {
      parent?.postMessage?.({
        type: 'viewer-current-file-changed',
        path,
        name: item?.name || path.split(/[\\/]/).pop() || path,
        folderPath: currentFolder,
        index: idx,
        total: items.length,
      }, Utils.parentMessageTargetOrigin());
    } catch {}
  }

  function updateViewerPositionControls() {
    document.getElementById('counter').textContent = (idx + 1) + ' / ' + items.length;
    const seekBar = document.getElementById('seek-bar');
    seekBar.max = Math.max(0, items.length - 1);
    seekBar.value = idx;
    document.getElementById('zoom-label').textContent = Math.round(zoom * 100) + '%';
  }

  async function renderPdfPage(pageNum) {
    const key = pageNum + '_' + zoom.toFixed(4);
    if (renderCache.has(key)) return renderCache.get(key);
    // 原寸ページサイズをitems[]へキャッシュ（viewer-annotation-scene.jsがmediaWidth/Heightで参照）
    const pageEntry = items[pageNum - 1];
    if (pageEntry && (!pageEntry.w || !pageEntry.h)) {
      const size = await PdfRenderer.getPageNaturalSize(pdfDoc, pageNum);
      pageEntry.w = size.width; pageEntry.h = size.height;
    }
    const canvas = await PdfRenderer.renderPageToNewCanvas(pdfDoc, pageNum, zoom);
    renderCache.set(key, canvas);
    return canvas;
  }

  async function showGroup(newIdx) {
    if (items.length === 0) return;
    const token = ++showGroupToken;
    const loadingToken = isViewerLoadingVisible()
      ? viewerLoadingToken
      : (hasVisibleViewerContent() ? 0 : showViewerLoading(isPdf ? 'PDFを読み込み中...' : '画像を読み込み中...'));
    resetPan();
    if (newIdx < 0) newIdx = items.length - 1;
    if (newIdx >= items.length) newIdx = 0;
    // PDF見開き: 1ページ目は単体、以降は 2-3 / 4-5 相当の組に調整
    if (isPdf && mode !== 'single' && newIdx > 0 && newIdx % 2 === 0) newIdx--;
    if (mode === 'single') {
      if (!isPdf) loadImageMeta(items[newIdx]);
    } else {
      await ensureGroupMeta(newIdx);
    }
    if (token !== showGroupToken) return;
    window.MeldexViewerAnnotations?.resetPointerPath?.();
    idx = newIdx;
    const group = getGroup(idx);
    if (group.length === 0) return;
    notifyParentCurrentViewerFile();
    if (!isPdf) {
      await Promise.all(group.map(i => ensureItemUrl(items[i])));
      if (token !== showGroupToken) return;
    }
    const target = activeLayer === 'A' ? 'B' : 'A';
    const layer = document.getElementById('layer' + target);
    layer.innerHTML = '';

    if (group.length === 1) {
      if (isPdf) {
        const canvas = await renderPdfPage(items[group[0]].pageNum);
        if (token !== showGroupToken) return;
        layer.appendChild(canvas);
      } else if (items[group[0]].type === 'video') {
        const video = window.MeldexViewerVideo.buildVideoElement(items[group[0]], displayItemUrl(items[group[0]]), { className: 'img-single' });
        if (items[group[0]].posterUrl) video.poster = items[group[0]].posterUrl;
        applyImageFitStyle(video, false);
        layer.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.className = 'img-single'; img.src = displayItemUrl(items[group[0]]); img.draggable = false;
        img._viewerItem = items[group[0]];
        wireImageDragToggle(img, () => items[group[0]]);
        applyImageFitStyle(img, false);
        layer.appendChild(img);
      }
    } else {
      const spread = document.createElement('div');
      spread.className = 'spread';
      const order = mode === 'manga' ? [group[1], group[0]] : group;
      for (const i of order) {
        if (isPdf) {
          const canvas = await renderPdfPage(items[i].pageNum);
          if (token !== showGroupToken) return;
          spread.appendChild(canvas);
        } else {
          // 見開き対象は常に画像（動画はgetGroup()で常に単体になるためここには来ない）
          const img = document.createElement('img');
          img.src = displayItemUrl(items[i]); img.draggable = false;
          img._viewerItem = items[i];
          wireImageDragToggle(img, () => items[i]);
          applyImageFitStyle(img, true);
          spread.appendChild(img);
        }
      }
      layer.appendChild(spread);
    }

    // 背景ブラー（画像のみ。動画のCSS背景描画は不可なので対象外）
    const primaryItem = items[group[0]];
    if (bgBlur && !isPdf && primaryItem?.type !== 'video') {
      const bgT = activeLayer === 'A' ? 'bgB' : 'bgA';
      const bgO = activeLayer === 'A' ? 'bgA' : 'bgB';
      document.getElementById(bgT).style.backgroundImage = Utils.cssUrl(displayItemUrl(items[group[0]]));
      document.getElementById(bgT).classList.add('show');
      document.getElementById(bgO).classList.remove('show');
    } else if (primaryItem?.type === 'video') {
      document.getElementById('bgA')?.classList.remove('show');
      document.getElementById('bgB')?.classList.remove('show');
    }

    // 動画表示中は見開き/マンガの切替を無効化（動画は常に単体表示のため）
    const selMode = document.getElementById('sel-mode');
    if (selMode) selMode.disabled = primaryItem?.type === 'video';

    // メディアロード完了後にレイヤー切り替え（白フラッシュ防止）
    const media = layer.querySelectorAll('img, video');
    updateViewerPositionControls();
    updateHud();
    const swapLayers = () => {
      if (token !== showGroupToken) return;
      document.getElementById('layer' + activeLayer).classList.remove('show');
      layer.classList.add('show');
      activeLayer = target;
      hideViewerLoading(loadingToken);
      // メディアロード完了・レイヤー入替後に呼ぶ（早期呼び出しはしない）
      window.MeldexViewerAnnotations?.onSceneChanged?.();
      window.MeldexViewerVideo?.startActiveVideoPlayback?.();
    };
    if (media.length > 0) {
      Promise.all([...media].map(el => el.tagName === 'VIDEO' ? window.MeldexViewerVideo.waitForVideoReady(el) : waitForViewerImage(el))).then(swapLayers);
    } else {
      swapLayers();
    }
  }

  // 画像のD&D(ボードへのカード化)は既定で無効化し、パンとのジェスチャー競合(ネイティブドラッグゴースト)
  // を避ける。Ctrlキーを押しながらのmousedownの間だけ従来のD&Dを有効化する
  // （ビューワー残課題修正計画 2026-08-04「1. 非破壊リサイズ」）。
  function wireImageDragToggle(img, getItem) {
    img.addEventListener('mousedown', (ev) => { img.draggable = !!ev.ctrlKey; });
    img.addEventListener('dragstart', (ev) => {
      if (!img.draggable) { ev.preventDefault(); return; }
      const item = getItem();
      if (!item) return;
      ev.dataTransfer.setData('text/plain', item.url);
      ev.dataTransfer.setData('text/uri-list', location.origin + item.url);
      ev.dataTransfer.setData('application/x-meldex-node', JSON.stringify({ name: item.name || item.path, path: item.path || '', type: 'image' }));
    });
    img.addEventListener('dragend', () => { img.draggable = false; });
  }

  function nextGroup() {
    const group = getGroup(idx);
    showGroup(idx + group.length);
  }
  function goToIndex(newIdx) { showGroup(newIdx); } // シークバー等の直接ジャンプ用
  async function prevGroup() {
    if (items.length === 0) return;
    if (mode === 'single') { showGroup(idx <= 0 ? items.length - 1 : idx - 1); return; }
    if (!isPdf && idx <= 0) {
      await preloadImageMeta(0);
      const starts = [];
      for (let i = 0; i < items.length;) { starts.push(i); i += Math.max(1, getGroup(i).length); }
      showGroup(starts[starts.length - 1] || 0);
      return;
    }
    let prev = idx - 1;
    if (prev < 0) prev = items.length - 1;
    if (!isPdf) await Promise.all([items[prev], items[prev - 1]].filter(Boolean).map(loadImageMeta));
    if (mode !== 'single' && !isPdf && prev > 0 && items[prev] && items[prev-1] && Utils.isPortrait(items[prev]) && Utils.isPortrait(items[prev-1])) prev--;
    if (isPdf && mode !== 'single' && prev > 0) { prev = prev % 2 === 1 ? prev : prev - 1; }
    showGroup(prev);
  }

  function viewerIcon(name, size=16) {
    return typeof window.lucide === 'function' ? window.lucide(name, size) : '';
  }
  function play() {
    playing = true;
    const button = document.getElementById('btn-play');
    button.innerHTML = viewerIcon('pause');
    button.setAttribute('aria-label', '一時停止');
    scheduleNext();
  }
  function pause() {
    playing = false;
    clearTimeout(timer);
    const button = document.getElementById('btn-play');
    button.innerHTML = viewerIcon('play');
    button.setAttribute('aria-label', '再生');
  }
  function togglePlay() {
    // 動画表示中はスライドショーのタイマーではなく動画自体の再生/一時停止を切り替える
    // （ビューワー残課題修正計画 2026-08-04「4. 動画ファイル対応」）。
    if (items[idx]?.type === 'video' && window.MeldexViewerVideo?.toggleCurrentVideoPlayback?.()) return;
    playing ? pause() : play();
  }
  function toggleReversePlay() {
    reversePlay = !reversePlay;
    flashStatus(reversePlay ? '逆順再生: ON' : '逆順再生: OFF');
    updateHud();
  }
  function scheduleNext() {
    clearTimeout(timer);
    if (!playing) return;
    timer = setTimeout(() => { reversePlay ? prevGroup() : nextGroup(); scheduleNext(); }, speed * 1000);
  }

  // 1枚ずつシフト（見開き時に見開きの組み合わせを1枚ずらす）
  function shiftForward() {
    if (mode === 'single') { nextGroup(); return; }
    showGroup(idx + 1);
  }
  function shiftBackward() {
    if (mode === 'single') { prevGroup(); return; }
    showGroup(idx - 1);
  }

  // 画像要素にフィットモード+ズームを適用（width/heightで直接サイズ指定）
  // img/video 両対応（動画対応: ビューワー残課題修正計画 2026-08-04「4. 動画ファイル対応」）。
  // ズーム(item 2)のインプレース更新にも再利用する（DOM再構築なしでサイズだけ再計算）。
  function applyImageFitStyle(mediaEl, isSpread) {
    const d = document.getElementById('display');
    const vw = isSpread ? (d.clientWidth - 24) / 2 : d.clientWidth;
    const vh = d.clientHeight;
    const isVideo = mediaEl.tagName === 'VIDEO';

    const apply = () => {
      const nw = isVideo ? (mediaEl.videoWidth || 0) : (mediaEl.naturalWidth || mediaEl.width);
      const nh = isVideo ? (mediaEl.videoHeight || 0) : (mediaEl.naturalHeight || mediaEl.height);
      if (!nw || !nh) return;

      let w, h;
      if (fitMode === 'original_contain') {
        const scale = Math.min(vw / nw, vh / nh, 1);
        w = nw * scale; h = nh * scale;
      } else if (fitMode === 'contain') {
        const scale = Math.min(vw / nw, vh / nh); // 長い方の辺をパネルにフィット
        w = nw * scale; h = nh * scale;
      } else if (fitMode === 'width') {
        w = vw; h = nh * (vw / nw);
      } else if (fitMode === 'height') {
        h = vh; w = nw * (vh / nh);
      } else {
        // none（原寸）
        w = nw; h = nh;
      }
      // ズーム倍率を適用
      w *= zoom; h *= zoom;
      mediaEl.style.width = w + 'px';
      mediaEl.style.height = h + 'px';
      mediaEl.style.maxWidth = 'none';
      mediaEl.style.maxHeight = 'none';
    };

    if (isVideo) {
      if (mediaEl.videoWidth) apply();
      else mediaEl.addEventListener('loadedmetadata', apply, { once: true });
    } else if (mediaEl.naturalWidth) {
      apply();
    } else {
      mediaEl.onload = apply;
    }
  }

  // PDFページのフィット倍率計算（副作用なし）。applyFit()とrefitPdfForResize()が使う。
  function computeFitZoomForPdfPage(pageW, pageH) {
    const d = document.getElementById('display');
    const vw = mode === 'single' ? d.clientWidth - 16 : (d.clientWidth - 24) / 2;
    const vh = d.clientHeight - 16;
    return PdfRenderer.computeFitZoom(fitMode, pageW, pageH, vw, vh);
  }

  function applyFit() {
    if (isPdf && items.length > 0 && items[0].w) {
      zoom = computeFitZoomForPdfPage(items[0].w, items[0].h);
      renderCache.clear();
    } else {
      zoom = 1;
    }
  }

  // 既存canvasを再利用しbacking storeだけ更新する非破壊PDFズーム適用（DOM再構築なし）。
  // ページ・パン・回転・反転・注釈状態は変更しない。refitPdfForResize()とズーム系(item 2)が共用する。
  function applyPdfZoomInPlace(newZoom) {
    if (Math.abs(newZoom - zoom) < 0.0005) { zoom = newZoom; return; }
    zoom = newZoom;
    renderCache.clear();
    updateViewerPositionControls();
    const layer = document.getElementById('layer' + activeLayer);
    const canvases = layer ? Array.from(layer.querySelectorAll('canvas.page-canvas')) : [];
    canvases.forEach(canvas => {
      const pageNum = canvas._viewerPageNum;
      if (!pageNum || !pdfDoc) return;
      PdfRenderer.refitCanvas(canvas, pdfDoc, pageNum, zoom)
        .then(() => {
          renderCache.set(pageNum + '_' + zoom.toFixed(4), canvas);
          // refitCanvas()はasync（canvas.style.width/heightの更新が非同期）のため、
          // 直後のclampPan()は旧サイズを見てしまうことがある。実サイズ確定後に再クランプする。
          clampPan();
          applyPan();
        })
        .catch(() => {});
    });
  }

  // リサイズ後の非破壊PDF再フィット。fitMode==='none'では倍率を変えない。
  function refitPdfForResize() {
    if (!isPdf || !items.length || fitMode === 'none') return;
    const pageW = items[0].w, pageH = items[0].h;
    if (!pageW || !pageH) return;
    applyPdfZoomInPlace(computeFitZoomForPdfPage(pageW, pageH));
  }

  function setFitUI() {
    // モードごとに異なるアイコンを割り当てる（ビューワー残課題修正計画 2026-08-04
    // 「5. フィット切替ボタンのアイコン」）。
    const fitLabels = {original_contain:'フィット: 原寸（収める）',contain:'フィット: 全体',height:'フィット: 高さ',width:'フィット: 幅',none:'フィット: 原寸'};
    const fitIcons = {original_contain:'minimize2',contain:'maximize2',height:'moveVertical',width:'moveHorizontal',none:'scanLine'};
    const btn = document.getElementById('btn-fit');
    btn.classList.toggle('active', fitMode !== 'original_contain' && fitMode !== 'contain');
    btn.innerHTML = viewerIcon(fitIcons[fitMode] || 'maximize2');
    btn.title = fitLabels[fitMode] || 'フィット';
    btn.setAttribute('aria-label', btn.title);
    flashStatus(({original_contain:'原寸（収める）',contain:'全体フィット',height:'高さフィット',width:'幅フィット',none:'原寸表示'})[fitMode] || fitMode);
  }

  function flashStatus(msg, ms=1500) {
    const el = document.getElementById('hud-status');
    const prev = el.textContent;
    el.textContent = msg;
    document.getElementById('hud').classList.remove('hidden');
    setTimeout(() => { el.textContent = prev; if (!hudVisible) document.getElementById('hud').classList.add('hidden'); }, ms);
  }

  function setHudInfo(lines) {
    const el = document.getElementById('hud-info');
    el.replaceChildren();
    lines.forEach((line, i) => {
      if (i > 0) el.appendChild(document.createElement('br'));
      el.appendChild(document.createTextNode(line));
    });
  }

  function updateHud() {
    const fitLabels = {original_contain:'原寸（収める）',contain:'全体',width:'幅',height:'高さ',none:'原寸'};
    const info = [isPdf ? 'PDF: ' + pdfPath.split('/').pop() : isSingle ? singleFile.split('/').pop() : '画像: ' + items.length + '枚'];
    info.push('モード: ' + ({single:'単体',spread:'見開き',manga:'マンガ'}[mode] || mode));
    info.push('フィット: ' + (fitLabels[fitMode] || fitMode));
    if (!isPdf) info.push('再生速度: ' + speed.toFixed(1) + 's' + (reversePlay ? ' (逆順)' : ''));
    if (isPdf) info.push('ズーム: ' + Math.round(zoom * 100) + '%');
    setHudInfo(info);
    document.getElementById('hud-status').textContent = playing ? (reversePlay ? '◀ 逆再生中' : '▶ 再生中') : '⏸ 停止';
  }

  function setMode(nextMode) {
    mode = nextMode;
    document.getElementById('sel-mode').value = mode;
    localStorage.setItem('viewer-mode', mode);
    if (isPdf) applyFit();
    showGroup(idx);
  }

  function setFitMode(nextFit) {
    fitMode = nextFit;
    localStorage.setItem('viewer-fit', fitMode);
    if (nextFit === 'none') zoom = 1;
    renderCache.clear();
    applyFit();
    setFitUI();
    showGroup(idx);
  }

  function cycleFit() {
    const modes = ['original_contain', 'contain', 'height', 'width', 'none'];
    setFitMode(modes[(modes.indexOf(fitMode) + 1) % modes.length]);
  }

  // 画像/動画の現レイヤーへインプレースでフィットスタイルを再適用する（DOM再構築なし）。
  function reapplyMediaFitStyle() {
    const layer = document.getElementById('layer' + activeLayer);
    if (!layer) return;
    const isSpread = !!layer.querySelector('.spread');
    layer.querySelectorAll('img, video').forEach(el => applyImageFitStyle(el, isSpread));
  }

  // ズームを showGroup() の全再描画ではなくインプレース適用する（ビューワー残課題修正計画
  // 2026-08-04「2. カーソル位置中心のホイールズーム」）。PDFはcanvasのbacking storeだけ更新、
  // 画像/動画はstyle.width/heightだけ再計算する。clientX/Yを渡すとカーソル位置を中心にズームする
  // （渡さない場合は#display中心を基準にする）。
  function setZoomAt(clientX, clientY, requestedZoom) {
    if (items.length === 0) return;
    const oldZoom = zoom;
    const targetZoom = Math.max(0.2, Math.min(5, Number(requestedZoom) || 1));
    if (Math.abs(targetZoom - oldZoom) < 0.0005) return;
    const display = document.getElementById('display');
    const point = viewerLogicalPoint(display, clientX, clientY);
    // c = カーソル位置（回転・反転を戻したビューポート論理座標）− #display中心。
    // 変形後のメディア矩形を基準にしないため、連続ズームでも誤差を累積させない。
    const cX = point.x;
    const cY = point.y;
    const oldPanX = panX, oldPanY = panY;
    if (isPdf) applyPdfZoomInPlace(targetZoom);
    else { zoom = targetZoom; reapplyMediaFitStyle(); }
    const k = targetZoom / oldZoom; // ズーム前後の倍率比
    // newPan = c − k*(c − oldPan)
    panX = cX - k * (cX - oldPanX);
    panY = cY - k * (cY - oldPanY);
    clampPan();
    applyPan();
    updateViewerPositionControls();
    updateHud();
  }
  function zoomAt(clientX, clientY, dir) {
    setZoomAt(clientX, clientY, dir === 'out' ? zoom / 1.2 : zoom * 1.2);
  }
  function zoomIn() { zoomAt(null, null, 'in'); }
  function zoomOut() { zoomAt(null, null, 'out'); }

  // ダブルクリック／ダブルタップは、現在のフィット方式を壊さず倍率とパンだけを初期値へ戻す。
  // setOriginal() は fitMode 自体を none に変えるため、ズームリセット用途には使わない。
  function resetZoom() {
    if (items.length === 0) return;
    if (isPdf) applyPdfZoomInPlace(1);
    else { zoom = 1; reapplyMediaFitStyle(); }
    resetPan();
    updateViewerPositionControls();
    updateHud();
  }

  function toggleBg() {
    bgBlur = !bgBlur;
    document.getElementById('btn-bg').classList.toggle('active', bgBlur);
    localStorage.setItem('viewer-bg', bgBlur);
    if (!bgBlur) { document.getElementById('bgA').classList.remove('show'); document.getElementById('bgB').classList.remove('show'); }
    else if (!isPdf) showGroup(idx);
  }

  function toggleHud() {
    hudVisible = !hudVisible;
    document.getElementById('hud').classList.toggle('hidden', !hudVisible);
    document.getElementById('btn-hud').classList.toggle('active', hudVisible);
    localStorage.setItem('viewer-hud', hudVisible);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
  document.addEventListener('fullscreenchange', () => {
    document.getElementById('btn-fullscreen').classList.toggle('active', !!document.fullscreenElement);
  });

  function applyViewerTransform() {
    const display = document.getElementById('display');
    const sx = flipH ? -1 : 1;
    const sy = flipV ? -1 : 1;
    display.style.transform = `scale(${sx},${sy}) rotate(${rotateDeg}deg)`;
  }

  function toggleFlipH() {
    flipH = !flipH;
    document.getElementById('btn-flip-h').classList.toggle('active', flipH);
    applyViewerTransform();
  }
  function toggleFlipV() {
    flipV = !flipV;
    document.getElementById('btn-flip-v').classList.toggle('active', flipV);
    applyViewerTransform();
  }
  function rotate() {
    rotateDeg = (rotateDeg + 90) % 360;
    applyViewerTransform();
  }
  function setRotateDeg(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    rotateDeg = ((next % 360) + 360) % 360;
    applyViewerTransform();
  }
  function setOriginal() {
    fitMode = 'none'; zoom = 1; renderCache.clear(); applyFit(); setFitUI(); showGroup(idx);
  }

  function setSpeed(value) {
    speed = parseFloat(value);
    document.getElementById('speed').value = speed;
    document.getElementById('speed-label').textContent = speed.toFixed(1) + 's';
    localStorage.setItem('viewer-speed', speed);
    if (playing) scheduleNext();
  }
  function setFadeMs(value) {
    fadeMs = parseInt(value, 10);
    document.documentElement.style.setProperty('--fade-ms', fadeMs + 'ms');
    localStorage.setItem('viewer-fade', fadeMs);
  }

  let panX = 0, panY = 0; // ドラッグで画像位置移動（transform方式: 画像がウィンドウ内に収まっていてもパン可能）
  function applyPan() {
    const layer = document.getElementById('layer' + activeLayer);
    if (layer) layer.style.transform = `translate(${panX}px, ${panY}px)`;
  }
  function resetPan() { panX = 0; panY = 0; document.getElementById('layerA').style.transform = ''; document.getElementById('layerB').style.transform = ''; }
  function panBy(deltaX, deltaY) {
    panX += Number(deltaX) || 0;
    panY += Number(deltaY) || 0;
    // PDFはcanvasの寸法更新が非同期なので、旧寸法でパンを狭くクランプしない。
    // applyPdfZoomInPlace()のrefit完了時に新寸法でクランプされる。
    if (!isPdf) clampPan();
    applyPan();
  }

  function viewerLogicalPoint(display, clientX, clientY) {
    if (!display) return { x: 0, y: 0 };
    const rect = display.getBoundingClientRect();
    let dx = (typeof clientX === 'number' ? clientX : rect.left + rect.width / 2) - (rect.left + rect.width / 2);
    let dy = (typeof clientY === 'number' ? clientY : rect.top + rect.height / 2) - (rect.top + rect.height / 2);
    // applyViewerTransform() は scale(...) rotate(...) の順で宣言するため、画面座標から
    // 論理座標へ戻す時は反転を戻してから逆回転する。
    return Utils.logicalPointFromScreenDelta(dx, dy, flipH, flipV, rotateDeg);
  }

  // パンの可動範囲（はみ出し量）を現在の表示コンテンツの実寸から計算する。
  // 実メディア要素（img/video/canvas）の矩形の合成（見開きは2枚の合算）を使うこと。
  // ラッパー（.viewer-ann-scene-wrap / .spread）は max-width/height:100% でコンテナ寸法に
  // 頭打ちされるため、ズームで中身がはみ出しても矩形が大きくならず、はみ出し量が常に0
  // →クランプでパンが固定される（v0.7.139検証で実測）。
  // rectは#displayの回転(90/270度)transformを含んだ画面上の実寸なので、回転時も自動的に正しく動く。
  function getPanOverflow() {
    const display = document.getElementById('display');
    const layer = document.getElementById('layer' + activeLayer);
    if (!display || !layer) return { overflowX: 0, overflowY: 0 };
    const media = [...layer.querySelectorAll('img, video, canvas')];
    if (!media.length) return { overflowX: 0, overflowY: 0 };
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    media.forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      left = Math.min(left, r.left); top = Math.min(top, r.top);
      right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    });
    if (right <= left || bottom <= top) return { overflowX: 0, overflowY: 0 };
    const dispRect = display.getBoundingClientRect();
    return {
      overflowX: Math.max(0, ((right - left) - dispRect.width) / 2),
      overflowY: Math.max(0, ((bottom - top) - dispRect.height) / 2),
    };
  }

  // パン移動時・ズーム変更後に適用する。コンテンツがコンテナ内に収まる軸はpan=0に固定する。
  function clampPan() {
    const { overflowX, overflowY } = getPanOverflow();
    panX = overflowX > 0 ? Math.max(-overflowX, Math.min(overflowX, panX)) : 0;
    panY = overflowY > 0 ? Math.max(-overflowY, Math.min(overflowY, panY)) : 0;
  }

  (function installPointerPan() {
    const display = document.getElementById('display');
    let activePointerId = null, startX = 0, startY = 0, panX0 = 0, panY0 = 0;
    function isBlockedTarget(e) {
      if (e.target.closest('.nav-area, #controls, .sa-toolbar, .sa-note, button, input, select, textarea, [contenteditable="true"]')) return true;
      if (e.target.tagName === 'VIDEO') {
        const videoRect = e.target.getBoundingClientRect();
        if (e.clientY >= videoRect.bottom - 40) return true;
      }
      return false;
    }
    display.addEventListener('pointerdown', (e) => {
      // Ctrl押下時はD&D(ボードへのカード化)を優先し、パンは開始しない
      // （ビューワー残課題修正計画 2026-08-04「1. 画像ドラッグ=パン即応」）。
      if (activePointerId !== null || e.pointerType === 'touch' || isBlockedTarget(e)
          || window.MeldexViewerAnnotations?.isActive?.() || e.button !== 0 || e.ctrlKey) return;
      activePointerId = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      panX0 = panX; panY0 = panY;
      try { display.setPointerCapture(e.pointerId); } catch {}
      display.classList.add('panning');
      e.preventDefault();
    });
    display.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activePointerId) return;
      const start = viewerLogicalPoint(display, startX, startY);
      const current = viewerLogicalPoint(display, e.clientX, e.clientY);
      panX = panX0 + (current.x - start.x);
      panY = panY0 + (current.y - start.y);
      clampPan();
      applyPan();
      e.preventDefault();
    });
    function finish(e) {
      if (e.pointerId !== activePointerId) return;
      try { display.releasePointerCapture(e.pointerId); } catch {}
      activePointerId = null;
      display.classList.remove('panning');
    }
    display.addEventListener('pointerup', finish);
    display.addEventListener('pointercancel', finish);
    display.addEventListener('lostpointercapture', e => {
      if (e.pointerId === activePointerId) {
        activePointerId = null;
        display.classList.remove('panning');
      }
    });
  })();

  // フォルダナビゲーション（前/次のフォルダ）
  let _currentFolderPath = folderPath || Utils.splitViewerPath(singleFile || pdfPath).folder || '';
  let _siblingFolders = [];
  let _siblingIdx = -1;

  function currentViewerPathForFolderNavigation() {
    const item = items.length ? items[Math.max(0, Math.min(items.length - 1, idx))] : null;
    return item?.path || item?.url || singleFile || pdfPath || folderPath || '';
  }

  function requestParentFolderNavigation(direction) {
    if (!Utils.isEmbeddedMeldexViewer()) return false;
    if (sheetContextId) {
      try {
        parent?.postMessage?.({
          type: 'viewer-sheet-row-nav-request',
          contextId: sheetContextId,
          direction,
        }, Utils.parentMessageTargetOrigin());
        return true;
      } catch {
        return false;
      }
    }
    const currentPath = currentViewerPathForFolderNavigation();
    const currentFolder = _currentFolderPath || Utils.splitViewerPath(currentPath).folder || folderPath || '';
    try {
      parent?.postMessage?.({
        type: 'viewer-folder-nav-request',
        direction,
        currentPath,
        folderPath: currentFolder,
      }, Utils.parentMessageTargetOrigin());
      return true;
    } catch {
      return false;
    }
  }

  async function loadSiblingFolders() {
    if (Utils.isEmbeddedMeldexViewer()) {
      updateFolderNavButtons();
      return;
    }
    if (!_currentFolderPath) {
      // singleFileからフォルダパスを推定
      if (singleFile) {
        const parts = singleFile.split('/');
        parts.pop();
        _currentFolderPath = parts.join('/');
      }
    }
    if (!_currentFolderPath) {
      document.getElementById('btn-prev-folder').disabled = true;
      document.getElementById('btn-next-folder').disabled = true;
      return;
    }
    // 親フォルダを取得
    const parts = _currentFolderPath.split('/');
    parts.pop();
    const parentPath = parts.join('/');
    try {
      const siblingItems = await fetch(API + '/browse?path=' + encodeURIComponent(parentPath) + '&all_files=true').then(r => r.json());
      _siblingFolders = siblingItems.filter(it => it.type === 'folder').map(it => it.path);
      _siblingIdx = _siblingFolders.indexOf(_currentFolderPath);
      if (_siblingIdx < 0) {
        // 絶対パスの場合、名前で一致を試みる
        const curName = _currentFolderPath.split('/').pop();
        _siblingIdx = _siblingFolders.findIndex(p => p.split('/').pop() === curName);
      }
      updateFolderNavButtons();
    } catch(e) {
      document.getElementById('btn-prev-folder').disabled = true;
      document.getElementById('btn-next-folder').disabled = true;
    }
  }

  function updateFolderNavButtons() {
    if (Utils.isEmbeddedMeldexViewer()) {
      document.getElementById('btn-prev-folder').disabled = false;
      document.getElementById('btn-next-folder').disabled = false;
      return;
    }
    document.getElementById('btn-prev-folder').disabled = _siblingIdx <= 0;
    document.getElementById('btn-next-folder').disabled = _siblingIdx < 0 || _siblingIdx >= _siblingFolders.length - 1;
  }

  async function goToFolder(nextFolderPath) {
    pause();
    const loadToken = ++collectionLoadToken;
    _currentFolderPath = nextFolderPath;
    flashStatus('フォルダ: ' + nextFolderPath.split('/').pop());
    showViewerLoading('ファイル一覧を読み込み中...');
    // 新しいフォルダの画像を読み込み
    try {
      const data = await Utils.fetchJsonChecked(API + '/images-in-folder?path=' + encodeURIComponent(nextFolderPath) + '&include_videos=1');
      if (loadToken !== collectionLoadToken) return;
      items = data.map(it => makeImageItem(it.path, it.name));
      if (items.length === 0) { showViewerLoading('画像がありません'); flashStatus('画像がありません'); return; }
      idx = 0;
      preloadNearbyImageMeta(0, items);
      showGroup(0);
      updateHud();
      // 兄弟フォルダ一覧を更新
      loadSiblingFolders();
    } catch(e) {
      showViewerLoading('フォルダ読み込みエラー');
      flashStatus('フォルダ読み込みエラー');
    }
  }

  function prevFolder() {
    if (requestParentFolderNavigation(-1)) return;
    if (_siblingIdx > 0) goToFolder(_siblingFolders[_siblingIdx - 1]);
  }
  function nextFolder() {
    if (requestParentFolderNavigation(1)) return;
    if (_siblingIdx >= 0 && _siblingIdx < _siblingFolders.length - 1) goToFolder(_siblingFolders[_siblingIdx + 1]);
  }

  // btn-prev-folder/btn-next-folder のクリック配線は viewer-controls.js が委譲する
  loadSiblingFolders(); // 初期化時に兄弟フォルダも読み込み

  // リサイズ後の表示状態復元・PDF再フィット（寸法変更通知の受け口）
  function notifyResize() {
    document.querySelectorAll('#layerA img, #layerA video, #layerB img, #layerB video').forEach(el => {
      applyImageFitStyle(el, !!el.closest('.spread'));
    });
    refitPdfForResize();
    applyViewerTransform();
    clampPan();
    applyPan();
  }
  window.addEventListener('viewer-layout-resize', notifyResize);

  const ready = init();

  window.MeldexViewerScene = {
    ready, icon: viewerIcon,
    // 再生・ナビゲーション
    pause, play, togglePlay, toggleReversePlay, rescheduleSlideshow: scheduleNext,
    isReversePlay: () => reversePlay,
    prevGroup, nextGroup, shiftBackward, shiftForward, goToIndex, prevFolder, nextFolder,
    // 表示状態の参照
    getGroup, currentDisplayOrder, itemAnnotationPath,
    // 単独ビューワーの右サイドバー「情報」タブが、表示中のファイルを知るために使う
    currentPath: currentViewerPathForFolderNavigation,
    getItems: () => items, getIndex: () => idx, getMode: () => mode, isPdf: () => isPdf,
    getPdfPath: () => pdfPath, getSingleFile: () => singleFile, getActiveLayerId: () => activeLayer,
    getFitMode: () => fitMode, getZoom: () => zoom, getFlipH: () => flipH, getFlipV: () => flipV,
    getRotateDeg: () => rotateDeg, isBgBlur: () => bgBlur, isHudVisible: () => hudVisible,
    getSpeed: () => speed, getFadeMs: () => fadeMs, isPlaying: () => playing,
    isSheetContext: () => !!sheetContextId,
    // 表示状態の変更・その他
    setMode, setFitMode, cycleFit, zoomIn, zoomOut, zoomAt, setZoomAt, resetZoom,
    panBy, setOriginal, toggleFlipH, toggleFlipV, rotate, setRotateDeg,
    toggleBg, toggleHud, toggleFullscreen, setSpeed, setFadeMs, flashStatus, notifyResize,
    // iframe再利用（項目7。プロトコルはviewer-open-request.jsが担当し、本APIは判定/実行のみ）
    canReopenWithUrl: Utils.canReopenWithUrl, reopenWithUrl,
  };
})();
