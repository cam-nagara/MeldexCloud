/* viewer-scene.js — Meldexビューワーのコアエンジン（画像/PDF読み込み・表示状態・ズーム/パン/
   回転/反転・スライドショー・HUD・フォルダナビゲーション）。計画: viewer-stability-common-ui-gap-fix-plan-2026-08-04.md。
   分割元: viewer.html。PDF描画責務は viewer-pdf-renderer.js へ分離済み。関連: viewer-scene-utils.js
   （純粋ヘルパー）/ viewer-controls.js・viewer-context-menu.js（入力配線、本ファイルへ発呼のみ）/
   viewer-annotations.js（アノテート、本ファイルへコールバック登録）。公開: window.MeldexViewerScene。
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
  // Windows版Meldex Viewerの作業範囲（開いているフォルダの絶対パス）。前後のフォルダ移動で切り替わる。
  let nativeRoot = '';
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
      // 単独版の変更系APIはJSON形式の送信だけを受け付ける（本文なしのPOSTは415で拒否され、
      // ファイルを指定せずに起動した時の「開く」ダイアログが出なかった）。
      const picked = await fetch(API + '/standalone/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
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
  const storedMode = localStorage.getItem('viewer-mode');
  let mode = ['single', 'spread', 'manga'].includes(storedMode) ? storedMode : 'single';
  const storedSpeed = Number.parseFloat(localStorage.getItem('viewer-speed') || '3');
  let speed = Number.isFinite(storedSpeed) && storedSpeed >= 0.5 && storedSpeed <= 60 ? storedSpeed : 3;
  const storedFade = Number.parseInt(localStorage.getItem('viewer-fade') || '300', 10);
  let fadeMs = Number.isFinite(storedFade) && storedFade >= 0 && storedFade <= 5000 ? storedFade : 300;
  let bgBlur = localStorage.getItem('viewer-bg') !== 'false';
  let hudVisible = localStorage.getItem('viewer-hud') === 'true';
  let zoom = 1;
  const storedFit = localStorage.getItem('viewer-fit');
  let fitMode = ['original_contain', 'contain', 'width', 'height', 'none'].includes(storedFit) ? storedFit : 'original_contain';
  let flipH = false, flipV = false, rotateDeg = 0;
  let pdfDoc = null;
  let showGroupToken = 0;
  let collectionLoadToken = 0;
  let deferredSingleFileFolderRefresh = null;
  let viewerLoadingToken = 0;
  let targetGeneration = 0;
  let sheetContextTimer = 0;
  let retryCurrentTarget = null;

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
    if (loading) {
      loading.dataset.state = 'loading';
      loading.classList.remove('hidden');
      loading.querySelector('.viewer-loading-card')?.setAttribute('role', 'status');
    }
    document.getElementById('viewer-retry')?.classList.add('hidden');
    const counter = document.getElementById('counter');
    if (counter && items.length === 0) counter.textContent = message;
    return token;
  }

  function showViewerStableState(kind, message, retry = null) {
    const loading = document.getElementById('viewer-loading');
    const text = document.getElementById('viewer-loading-text');
    const retryButton = document.getElementById('viewer-retry');
    viewerLoadingToken++;
    if (text) text.textContent = message;
    if (loading) {
      loading.dataset.state = kind;
      loading.classList.remove('hidden');
      loading.querySelector('.viewer-loading-card')?.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    }
    retryCurrentTarget = typeof retry === 'function' ? retry : null;
    retryButton?.classList.toggle('hidden', !retryCurrentTarget);
    if (retryCurrentTarget) retryButton?.focus({ preventScroll: true });
  }

  document.getElementById('viewer-retry')?.addEventListener('click', () => retryCurrentTarget?.());

  function hideViewerLoading(token) {
    if (!token || token !== viewerLoadingToken) return;
    document.getElementById('viewer-loading')?.classList.add('hidden');
  }

  function isViewerLoadingVisible() {
    const loading = document.getElementById('viewer-loading');
    return !!loading && !loading.classList.contains('hidden');
  }

  function hasVisibleViewerContent() {
    return !!document.querySelector('.layer.show img, .layer.show video, .layer.show audio, .layer.show canvas');
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
    if (Utils.isAudioPath(path)) {
      // 音声も動画と同じくプレビュー変換を経由せず file-raw をそのまま使う（Range対応の
      // FileResponseでネイティブ<audio>のシーク・ストリーミングに対応済み）。
      return {
        type: 'audio',
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
    const generation = targetGeneration;
    showViewerLoading('シートの画像を読み込み中...');
    clearTimeout(sheetContextTimer);
    sheetContextTimer = setTimeout(() => {
      if (generation !== targetGeneration || !sheetContextId) return;
      showViewerStableState('error', 'シートから応答がありませんでした', requestSheetContext);
    }, 5000);
    parent.postMessage({
      type: 'viewer-sheet-context-request',
      contextId: sheetContextId,
    }, Utils.parentMessageTargetOrigin());
    return true;
  }

  function applySheetContextPayload(message) {
    if (!sheetContextId || message?.contextId !== sheetContextId) return false;
    if (message.boundary) {
      clearTimeout(sheetContextTimer);
      showViewerStableState('empty', message.message || 'これ以上の画像はありません', requestSheetContext);
      return true;
    }
    const nextItems = Array.isArray(message.images)
      ? message.images.map(makeSheetContextImageItem).filter(item => item && (item.url || item.path))
      : [];
    if (!nextItems.length) {
      clearTimeout(sheetContextTimer);
      items = [];
      updateViewerPositionControls();
      showViewerStableState('empty', message.message || 'このセルに画像はありません', requestSheetContext);
      return true;
    }
    clearTimeout(sheetContextTimer);
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
    const folderItems = Utils.sortEntriesByName(data).map(it => makeImageItem(it.path, it.name));
    const startIdx = Utils.findImageItemIndex(folderItems, filePath, fileName);
    if (startIdx < 0) return;
    items = folderItems;
    idx = startIdx;
    preloadNearbyImageMeta(idx, items);
    updateViewerPositionControls();
    updateHud();
    notifyParentCurrentViewerFile();
  }

  // 単一ファイル表示で同じフォルダのファイル一覧を読み込めるか。Windows版Meldex Viewerは開いた
  // ファイルのフォルダを作業範囲にするため、対象が「01.png」のようにフォルダ部分を持たない
  // （＝作業範囲の直下）。以前はこの場合に一覧を読み込まず、←/→ キーとスライドショーが
  // 開いた1枚から動かなかった（2026-09-15）。
  function canListSingleFileSiblings(filePath, parentFolder) {
    if (!filePath || filePath === archiveDisplayPath) return false;
    if (parentFolder) return true;
    return !/^[a-z][a-z0-9+.-]*:/i.test(filePath);
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
  async function loadResolvedTarget(generation = targetGeneration) {
    pdfDoc = null;
    renderCache.clear();
    if (isPdf) {
      showViewerLoading('PDFを読み込み中...');
      try {
        const openedPdf = await PdfRenderer.openDocument(Utils.fileRawUrlForPath(pdfPath));
        if (generation !== targetGeneration) return false;
        pdfDoc = openedPdf;
        items = [];
        for (let i = 1; i <= pdfDoc.numPages; i++) items.push({type: 'pdf-page', pageNum: i, url: '', w: 0, h: 0, path: pdfPath});
        // 新しく開いたPDFは先頭ページから表示する（直前に見ていたフォルダの画像番号を引き継がない）
        idx = 0;
        const size0 = await PdfRenderer.getPageNaturalSize(pdfDoc, 1);
        if (generation !== targetGeneration) return false;
        items[0].w = size0.width; items[0].h = size0.height;
        applyFit();
      } catch (e) {
        if (generation !== targetGeneration) return false;
        showViewerStableState('error', 'PDFを読み込めませんでした: ' + (e?.message || e), () => retryTarget(generation));
        document.getElementById('hud-info').textContent = 'PDF読み込み失敗: ' + e.message;
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
      if (canListSingleFileSiblings(singleFile, parentFolder)) scheduleSingleFileFolderItemsRefresh(parentFolder, fileName, singleFile, loadToken);
    } else if (folderPath) {
      showViewerLoading('ファイル一覧を読み込み中...');
      const loadToken = ++collectionLoadToken;
      let data = [];
      try {
        data = await Utils.fetchJsonChecked(API + '/images-in-folder?path=' + encodeURIComponent(folderPath) + '&include_videos=1');
      } catch (e) {
        if (generation !== targetGeneration) return false;
        showViewerStableState('error', '画像一覧を読み込めませんでした: ' + (e?.message || e), () => retryTarget(generation));
        document.getElementById('hud-info').textContent = '画像一覧読み込み失敗: ' + (e?.message || e);
        return false;
      }
      if (loadToken !== collectionLoadToken) return false;
      items = Utils.sortEntriesByName(data).map(it => makeImageItem(it.path, it.name));
      if (items.length === 0) {
        showViewerStableState('empty', 'このフォルダに表示できるファイルはありません', () => retryTarget(generation));
        document.getElementById('hud-info').textContent = '画像がありません';
        return false;
      }
      idx = 0;
      preloadNearbyImageMeta(0, items);
    } else if (sheetContextId) {
      requestSheetContext();
    } else {
      showViewerStableState('empty', '表示するファイルがありません');
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

  async function retryTarget(expectedGeneration = targetGeneration) {
    if (expectedGeneration !== targetGeneration) return;
    const generation = ++targetGeneration;
    showGroupToken++;
    collectionLoadToken++;
    await loadResolvedTarget(generation);
  }

  async function init() {
    await viewerPreparation;
    _currentFolderPath = folderPath || Utils.splitViewerPath(singleFile || pdfPath).folder || '';
    await loadSiblingFolders();
    const generation = ++targetGeneration;
    await loadResolvedTarget(generation);
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
    if (window.MeldexViewerAnnotationNotes?.hasUnsaved?.()) flashStatus('未保存のアノテートがあります');
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
    _currentFolderPath = folderPath || Utils.splitViewerPath(singleFile || pdfPath).folder || '';
    _siblingFolders = [];
    _siblingIdx = -1;
    clearTimeout(sheetContextTimer);
    const generation = ++targetGeneration;
    await loadResolvedTarget(generation);
    if (generation === targetGeneration) loadSiblingFolders();
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
    if (!isPdf) await Promise.all(getGroup(startIdx).map(i => items[i]).filter(Boolean).map(loadImageMeta));
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
    // 動画・音声は見開き/マンガモードでも常に単体表示
    if (a.type === 'video' || a.type === 'audio') return [startIdx];
    // 画像: 縦長2枚連続→見開き
    if (!Utils.isPortrait(a) || startIdx + 1 >= items.length) return [startIdx];
    const b = items[startIdx + 1];
    if (!b || b.type === 'video' || b.type === 'audio' || !Utils.isPortrait(b)) return [startIdx];
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
    document.getElementById('counter').textContent = items.length ? (idx + 1) + ' / ' + items.length : '0 / 0';
    const seekBar = document.getElementById('seek-bar');
    seekBar.max = Math.max(0, items.length - 1);
    seekBar.value = idx;
    updateZoomLabel();
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
    if (isPdf && fitMode !== 'none') {
      await Promise.all(group.map(async i => {
        if (items[i].w && items[i].h) return;
        const size = await PdfRenderer.getPageNaturalSize(pdfDoc, items[i].pageNum);
        items[i].w = size.width;
        items[i].h = size.height;
      }));
      if (token !== showGroupToken) return;
      zoom = computeFitZoomForPdfGroup(group);
      renderCache.clear();
    }
    const target = activeLayer === 'A' ? 'B' : 'A';
    const layer = document.getElementById('layer' + target);
    layer.innerHTML = '';
    incomingLayer = target;

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
      } else if (items[group[0]].type === 'audio') {
        // 音声には寸法が無いため applyImageFitStyle は使わない（固定サイズのカード表示。
        // viewer.css の .viewer-audio-player）。
        const audioCard = window.MeldexViewerAudio.buildAudioElement(items[group[0]], displayItemUrl(items[group[0]]));
        layer.appendChild(audioCard);
      } else {
        const img = document.createElement('img');
        img.className = 'img-single'; img.src = displayItemUrl(items[group[0]]); img.draggable = false;
        img._viewerItem = items[group[0]];
        wireImageDragToggle(img, () => items[group[0]]);
        applyImageFitStyle(img, false);
        layer.appendChild(img);
        window.MeldexImageLoading?.track?.(img, { host: layer, label: '画像を読み込んでいます' });
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
          window.MeldexImageLoading?.track?.(img, { host: spread, label: '画像を読み込んでいます' });
        }
      }
      layer.appendChild(spread);
    }

    // 背景ブラー（画像のみ。動画・音声のCSS背景描画は不可/無意味なので対象外）
    const primaryItem = items[group[0]];
    const isSingleMediaTakeover = primaryItem?.type === 'video' || primaryItem?.type === 'audio';
    if (bgBlur && !isPdf && !isSingleMediaTakeover) {
      const bgT = activeLayer === 'A' ? 'bgB' : 'bgA';
      const bgO = activeLayer === 'A' ? 'bgA' : 'bgB';
      document.getElementById(bgT).style.backgroundImage = Utils.cssUrl(displayItemUrl(items[group[0]]));
      document.getElementById(bgT).classList.add('show');
      document.getElementById(bgO).classList.remove('show');
    } else {
      document.getElementById('bgA')?.classList.remove('show');
      document.getElementById('bgB')?.classList.remove('show');
    }

    // 動画・音声表示中は見開き/マンガの切替を無効化（常に単体表示のため）
    const selMode = document.getElementById('sel-mode');
    if (selMode) selMode.disabled = isSingleMediaTakeover;

    // メディアロード完了後にレイヤー切り替え（白フラッシュ防止）
    const media = layer.querySelectorAll('img, video, audio');
    updateViewerPositionControls();
    updateHud();
    const swapLayers = () => {
      if (token !== showGroupToken) return;
      document.getElementById('layer' + activeLayer).classList.remove('show');
      layer.classList.add('show');
      activeLayer = target;
      incomingLayer = '';
      updateZoomLabel();
      hideViewerLoading(loadingToken);
      // メディアロード完了・レイヤー入替後に呼ぶ（早期呼び出しはしない）
      window.MeldexViewerAnnotations?.onSceneChanged?.();
      window.MeldexViewerVideo?.startActiveVideoPlayback?.();
      window.MeldexViewerAudio?.startActiveAudioPlayback?.();
    };
    if (media.length > 0) {
      Promise.all([...media].map(el => {
        if (el.tagName === 'VIDEO') return window.MeldexViewerVideo.waitForVideoReady(el);
        if (el.tagName === 'AUDIO') return window.MeldexViewerAudio.waitForAudioReady(el);
        return waitForViewerImage(el);
      })).then(results => {
        if (token !== showGroupToken) return;
        if (results.some(ok => !ok)) {
          showViewerStableState('error', 'メディアを読み込めませんでした', () => {
            showViewerLoading('メディアを再読み込み中...');
            showGroup(idx);
          });
          return;
        }
        swapLayers();
      });
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
    // 動画・音声表示中はスライドショーのタイマーではなくメディア自体の再生/一時停止を
    // 切り替える（ビューワー残課題修正計画 2026-08-04「4. 動画ファイル対応」。音声は
    // サブパネル用の音声再生実装で同じパターンを踏襲）。
    if (items[idx]?.type === 'video' && window.MeldexViewerVideo?.toggleCurrentVideoPlayback?.()) return;
    if (items[idx]?.type === 'audio' && window.MeldexViewerAudio?.toggleCurrentAudioPlayback?.()) return;
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
  // 表示倍率（ツールバーの%表示）は「原寸=100%」で表す（2026-09-15。以前はフィットした状態を
  // 100%と表示していた）。zoom はフィット方式が決める基準サイズに対する倍率のまま持ち、
  // 画面上の倍率＝基準倍率×zoom に換算して、表示・拡大縮小の上限下限・段階ズームに使う。
  // PDFは zoom 自体がページ原寸に対する倍率なので基準倍率を1とする。
  const DISPLAY_SCALE_MAX = 16;          // 原寸比の上限（1600%）
  const DISPLAY_EDGE_MAX_PX = 200000;    // 巨大画像を拡大しすぎて描画が破綻しないための長辺の上限
  let incomingLayer = '';                // showGroup() が組み立て中で、まだ表示を切り替えていないレイヤー

  function mediaNaturalSize(mediaEl) {
    if (!mediaEl) return null;
    const isVideo = mediaEl.tagName === 'VIDEO';
    const w = isVideo ? (mediaEl.videoWidth || 0) : (mediaEl.naturalWidth || mediaEl.width || 0);
    const h = isVideo ? (mediaEl.videoHeight || 0) : (mediaEl.naturalHeight || mediaEl.height || 0);
    return w && h ? { w, h } : null;
  }

  // フィット方式が決める基準倍率（原寸に対する倍率）。
  function fitBaseScale(nw, nh, isSpread) {
    const d = document.getElementById('display');
    const vw = isSpread ? (d.clientWidth - 24) / 2 : d.clientWidth;
    const vh = d.clientHeight;
    if (fitMode === 'original_contain') return Math.min(vw / nw, vh / nh, 1);
    if (fitMode === 'contain') return Math.min(vw / nw, vh / nh); // 長い方の辺をパネルにフィット
    if (fitMode === 'width') return vw / nw;
    if (fitMode === 'height') return vh / nh;
    return 1; // none（原寸）
  }

  function primaryMediaElement() {
    const layer = document.getElementById('layer' + (incomingLayer || activeLayer));
    return layer ? layer.querySelector('img, video') : null;
  }

  // 表示中の主メディア（見開きは先頭）の基準倍率。寸法がまだ分からない時は 0。
  function currentFitBaseScale() {
    if (isPdf) return 1;
    const mediaEl = primaryMediaElement();
    const size = mediaNaturalSize(mediaEl);
    return size ? fitBaseScale(size.w, size.h, !!mediaEl.closest('.spread')) : 0;
  }

  function getDisplayScale() {
    const base = currentFitBaseScale();
    return (base > 0 ? base : 1) * zoom;
  }

  function updateZoomLabel() {
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(getDisplayScale() * 100) + '%';
  }

  // 要求された zoom を、画面上の倍率の上限・下限に収めて返す。以前はフィット時の20%〜500%に
  // 固定していたため、縦長画像などフィット倍率が小さい画像は原寸まで拡大できず、小さな画像を
  // 幅フィット等で引き伸ばしている時は原寸まで縮小できなかった。
  // 下限: フィット時の20%（ただし原寸より大きくはしない）。
  // 上限: 原寸の1600%（フィット時の5倍の方が大きい小さな画像はそちら）。
  function clampZoomMultiplier(requested) {
    const value = Number(requested) || 1;
    if (isPdf) return Math.max(0.2, Math.min(5, value));
    const mediaEl = primaryMediaElement();
    const size = mediaNaturalSize(mediaEl);
    const base = size ? fitBaseScale(size.w, size.h, !!mediaEl.closest('.spread')) : 0;
    if (!(base > 0)) return Math.max(0.2, Math.min(5, value));
    const minScale = Math.min(base * 0.2, 1);
    const maxScale = Math.max(base * 5, Math.min(DISPLAY_SCALE_MAX, DISPLAY_EDGE_MAX_PX / Math.max(size.w, size.h)));
    return Math.max(minScale, Math.min(maxScale, value * base)) / base;
  }

  function applyImageFitStyle(mediaEl, isSpread) {
    const isVideo = mediaEl.tagName === 'VIDEO';
    const apply = () => {
      const size = mediaNaturalSize(mediaEl);
      if (!size) return;
      const scale = fitBaseScale(size.w, size.h, isSpread) * zoom;
      mediaEl.style.width = (size.w * scale) + 'px';
      mediaEl.style.height = (size.h * scale) + 'px';
      mediaEl.style.maxWidth = 'none';
      mediaEl.style.maxHeight = 'none';
      updateZoomLabel();
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

  function computeFitZoomForPdfGroup(group = getGroup(idx)) {
    const pages = group.map(i => items[i]).filter(item => item?.w && item?.h);
    if (!pages.length) return zoom;
    if (pages.length === 1) return computeFitZoomForPdfPage(pages[0].w, pages[0].h);
    const d = document.getElementById('display');
    const width = pages.reduce((sum, page) => sum + page.w, 0);
    const height = Math.max(...pages.map(page => page.h));
    return PdfRenderer.computeFitZoom(fitMode, width, height, d.clientWidth - 16, d.clientHeight - 16);
  }

  function applyFit() {
    if (isPdf && items.length > 0 && items[0].w) {
      zoom = computeFitZoomForPdfGroup();
      renderCache.clear();
    } else {
      zoom = 1;
    }
  }

  // 既存canvasを再利用しbacking storeだけ更新する非破壊PDFズーム適用（DOM再構築なし）。
  // ページ・パン・回転・反転・アノテート状態は変更しない。refitPdfForResize()とズーム系(item 2)が共用する。
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
    const group = getGroup(idx);
    if (!group.every(i => items[i]?.w && items[i]?.h)) return;
    applyPdfZoomInPlace(computeFitZoomForPdfGroup(group));
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
    const targetZoom = clampZoomMultiplier(requestedZoom);
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
  // ボタン・キー・ホイールの段階ズーム。画面上の倍率で1.2倍ずつ変え、原寸（100%）をまたぐ時は
  // 一度100%で止める。
  function zoomAt(clientX, clientY, dir) {
    const base = currentFitBaseScale();
    if (!(base > 0)) {
      setZoomAt(clientX, clientY, dir === 'out' ? zoom / 1.2 : zoom * 1.2);
      return;
    }
    const current = base * zoom;
    let next = dir === 'out' ? current / 1.2 : current * 1.2;
    if ((current < 0.999 && next > 1.001) || (current > 1.001 && next < 0.999)) next = 1;
    setZoomAt(clientX, clientY, next / base);
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
    setFitMode('none');
  }

  function setSpeed(value) {
    const requested = Number.parseFloat(value);
    speed = Number.isFinite(requested) ? Math.max(0.5, Math.min(60, requested)) : 3;
    document.getElementById('speed').value = speed;
    document.getElementById('speed-label').textContent = speed.toFixed(1) + 's';
    localStorage.setItem('viewer-speed', speed);
    if (playing) scheduleNext();
  }
  function setFadeMs(value) {
    const requested = Number.parseInt(value, 10);
    fadeMs = Number.isFinite(requested) ? Math.max(0, Math.min(5000, requested)) : 300;
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
  function setPan(nextX, nextY) {
    panX = Number(nextX) || 0;
    panY = Number(nextY) || 0;
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

  // パンの可動範囲を、回転・反転を戻した表示面の座標（panX/panY と同じ座標系）で求める。
  // 実メディア要素（img/video/canvas。見開きは2枚の合算）のレイアウト上の位置と大きさ
  // （offsetLeft/Top の累積。パン用の transform を含まない）を使う。ラッパー
  // （.viewer-ann-scene-wrap / .spread）の矩形は使わない（コンテナ寸法に頭打ちされ、はみ出し量が
  // 常に0になることを v0.7.139 検証で実測）。以前は画面上の矩形のはみ出し量を中央配置前提で
  // 上下左右へ対称に振り分けていたため、上端に寄った縦長画像は下端まで届かず、90度回転時は
  // 縦横の取り違えで長辺方向へパンできなかった（2026-09-15）。見える範囲は #display の大きさを
  // 現在の回転角で表示面の座標へ戻した範囲とする。
  function getPanLimits() {
    const display = document.getElementById('display');
    const layer = document.getElementById('layer' + activeLayer);
    if (!display || !layer) return null;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    layer.querySelectorAll('img, video, canvas').forEach(el => {
      const width = el.offsetWidth, height = el.offsetHeight;
      if (!width || !height) return;
      let x = 0, y = 0, node = el;
      while (node && node !== layer) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; }
      if (node !== layer) return;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x + width); bottom = Math.max(bottom, y + height);
    });
    if (!(right > left && bottom > top)) return null;
    const rad = rotateDeg * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const halfWidth = (display.clientWidth * cos + display.clientHeight * sin) / 2;
    const halfHeight = (display.clientWidth * sin + display.clientHeight * cos) / 2;
    return {
      x: panAxisLimit(left, right, layer.clientWidth / 2, halfWidth),
      y: panAxisLimit(top, bottom, layer.clientHeight / 2, halfHeight),
    };
  }

  // 1軸分の可動範囲。見える範囲に収まる軸は null（中央のまま動かさない）。
  function panAxisLimit(start, end, center, half) {
    if (end - start <= half * 2 + 1) return null;
    return { min: center + half - end, max: center - half - start };
  }

  // パン移動時・ズーム変更後に適用する。コンテンツが見える範囲に収まる軸はpan=0に固定する。
  function clampPan() {
    const limits = getPanLimits();
    panX = limits?.x ? Math.max(limits.x.min, Math.min(limits.x.max, panX)) : 0;
    panY = limits?.y ? Math.max(limits.y.min, Math.min(limits.y.max, panY)) : 0;
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
      // 音声カード（.viewer-audio-player）はカード全体がネイティブ<audio controls>を
      // 含む操作面のため、動画の「下端40px」のような部分判定ではなく全体を対象外にする。
      if (e.target.closest('.viewer-audio-player')) return true;
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
  // Windows版Meldex Viewer（native=1）は開いたファイルのフォルダだけを作業範囲にするため、
  // 兄弟フォルダの一覧と移動は単独版サーバー（/api/standalone/viewer-folders・
  // /api/standalone/viewer-folder-navigate）が受け持つ。以前はブラウザ側から作業範囲の外にある
  // 兄弟フォルダを参照できず、前後のフォルダへ移動できなかった（2026-09-15）。
  let _nativeFolderState = null;
  let _nativeFolderStateSeq = 0;
  let _nativeFolderNavigating = false;

  function isNativeStandaloneViewer() {
    return params.get('native') === '1' && !Utils.isEmbeddedMeldexViewer();
  }

  // プロパティの評価・メモを画像ファイルへ書き込む時に、編集欄を作った時点の作業範囲を添える
  // （gb-file-metadata.js が編集欄の作成時に呼ぶ）。フォルダ移動の後に古い編集欄から保存が
  // 遅れて届いても、サーバーが別フォルダの同名ファイルへ書き込まずに拒否できる。
  window.MeldexEmbeddedMetadataWriteContext = () => (
    isNativeStandaloneViewer() && nativeRoot ? { expected_root: nativeRoot } : null
  );

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
    if (isNativeStandaloneViewer()) {
      await loadNativeFolderState();
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
      _siblingFolders = [];
      _siblingIdx = -1;
      updateFolderNavButtons();
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
      _siblingFolders = [];
      _siblingIdx = -1;
      updateFolderNavButtons();
    }
  }

  // 下端ツールバーの「前のフォルダ」「次のフォルダ」ボタンの有効・無効と表示名。
  // 本体のパネル内では移動先の判定を本体（フォルダツリーの並び）へ任せるため常に有効にする。
  function updateFolderNavButtons() {
    const prevButton = document.getElementById('btn-prev-folder');
    const nextButton = document.getElementById('btn-next-folder');
    if (!prevButton || !nextButton) return;
    let prevEnabled = false, nextEnabled = false, prevName = '', nextName = '';
    if (Utils.isEmbeddedMeldexViewer()) {
      prevEnabled = true;
      nextEnabled = true;
    } else if (isNativeStandaloneViewer()) {
      prevName = String(_nativeFolderState?.prev?.name || '');
      nextName = String(_nativeFolderState?.next?.name || '');
      prevEnabled = !!prevName && !_nativeFolderNavigating;
      nextEnabled = !!nextName && !_nativeFolderNavigating;
    } else {
      prevEnabled = _siblingIdx > 0;
      nextEnabled = _siblingIdx >= 0 && _siblingIdx < _siblingFolders.length - 1;
      prevName = prevEnabled ? String(_siblingFolders[_siblingIdx - 1] || '').split('/').pop() : '';
      nextName = nextEnabled ? String(_siblingFolders[_siblingIdx + 1] || '').split('/').pop() : '';
    }
    const rowNavigation = !!sheetContextId;
    setFolderNavButton(prevButton, rowNavigation ? '前の画像行' : '前のフォルダ', '↑', prevEnabled, prevName);
    setFolderNavButton(nextButton, rowNavigation ? '次の画像行' : '次のフォルダ', '↓', nextEnabled, nextName);
  }

  function setFolderNavButton(button, label, keyLabel, enabled, targetName) {
    button.disabled = !enabled;
    const title = label + ' (' + keyLabel + ')' + (targetName ? ': ' + targetName : '');
    button.title = title;
    // 共通ツールチップはホバー中に title を退避するため、退避先も同じ内容へ更新する
    if (button.hasAttribute('data-gb-native-title')) button.setAttribute('data-gb-native-title', title);
    button.setAttribute('aria-label', targetName ? label + ': ' + targetName : label);
  }

  async function loadNativeFolderState() {
    const seq = ++_nativeFolderStateSeq;
    let nextState = null;
    try {
      const response = await fetch(API + '/standalone/viewer-folders', { cache: 'no-store' });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload && typeof payload === 'object') nextState = payload;
    } catch {}
    if (seq !== _nativeFolderStateSeq) return;
    _nativeFolderState = nextState;
    if (nextState?.root) nativeRoot = String(nextState.root);
    updateFolderNavButtons();
  }

  // 単独版サーバーに作業範囲を前後の兄弟フォルダへ切り替えてもらい、そのフォルダを開き直す。
  async function navigateNativeFolder(direction) {
    if (_nativeFolderNavigating) return;
    const neighbor = direction < 0 ? _nativeFolderState?.prev : _nativeFolderState?.next;
    if (!neighbor) {
      flashStatus(direction < 0 ? '前のフォルダはありません' : '次のフォルダはありません');
      return;
    }
    // 作業範囲を切り替えるとアノテート・評価・メモの保存先の基準も変わるため、編集中・保存中・
    // 保存失敗が残っている間は移動しない（移動後に別フォルダの同名ファイルへ書き込まないようにする）。
    // アノテートの付箋は入力が止まってから保存するため、アノテートを開いている間は移動しない。
    if (window.MeldexViewerAnnotations?.isActive?.() || window.MeldexViewerAnnotations?.isDrawing?.()) {
      flashStatus('アノテートを閉じてからフォルダを移動してください');
      return;
    }
    if (window.MeldexViewerAnnotationNotes?.hasUnsaved?.()) {
      flashStatus('保存できていないアノテートがあるため、フォルダを移動できません');
      return;
    }
    _nativeFolderNavigating = true;
    updateFolderNavButtons();
    // 移動中は右サイドバー（プロパティの評価・メモ・タグ）を操作できないようにし、入力中のメモは
    // 先に保存し終える（入力欄からフォーカスが外れた時点でも保存が始まる）。
    const sidePanels = [...document.querySelectorAll('.sa-secondary-panel')];
    sidePanels.forEach(panel => { panel.inert = true; });
    try {
      await window.MeldexEmbeddedMetadata?.flushPendingMemos?.();
      if (window.MeldexEmbeddedMetadata?.hasPendingMemos?.()) {
        flashStatus('保存できていないメモがあるため、フォルダを移動できません');
        return;
      }
      if (await window.MeldexStandaloneSaveQueue?.flush?.() === false) {
        flashStatus('保存が完了していないため、フォルダを移動できません');
        return;
      }
      const response = await fetch(API + '/standalone/viewer-folder-navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: direction < 0 ? -1 : 1, expectedRoot: _nativeFolderState?.root || '' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        flashStatus(payload?.detail || 'フォルダを移動できませんでした');
        return;
      }
      await openNativeFolderTarget(payload);
    } catch (error) {
      flashStatus('フォルダを移動できませんでした: ' + (error?.message || error));
    } finally {
      sidePanels.forEach(panel => { panel.inert = false; });
      _nativeFolderNavigating = false;
      await loadNativeFolderState();
    }
  }

  async function openNativeFolderTarget(payload) {
    pause();
    showGroupToken++;
    collectionLoadToken++;
    window.MeldexViewerAnnotations?.resetPointerPath?.();
    if (payload?.root) nativeRoot = String(payload.root);
    folderPath = '';
    pdfPath = '';
    singleFile = '';
    multiFilePaths = [];
    // 画像・動画のあるフォルダはフォルダごと、PDFだけのフォルダは先頭のPDFを開く
    if (!applyInitialOpenPath(payload?.initialPath || '')) {
      folderPath = '.';
      refreshViewerModeFlags();
    }
    _currentFolderPath = '';
    if (payload?.rootName) flashStatus('フォルダ: ' + payload.rootName);
    const generation = ++targetGeneration;
    await loadResolvedTarget(generation);
  }

  async function goToFolder(nextFolderPath) {
    pause();
    const generation = ++targetGeneration;
    showGroupToken++;
    const loadToken = ++collectionLoadToken;
    _currentFolderPath = nextFolderPath;
    flashStatus('フォルダ: ' + nextFolderPath.split('/').pop());
    showViewerLoading('ファイル一覧を読み込み中...');
    // 新しいフォルダの画像を読み込み
    try {
      const data = await Utils.fetchJsonChecked(API + '/images-in-folder?path=' + encodeURIComponent(nextFolderPath) + '&include_videos=1');
      if (loadToken !== collectionLoadToken || generation !== targetGeneration) return;
      items = Utils.sortEntriesByName(data).map(it => makeImageItem(it.path, it.name));
      if (items.length === 0) {
        showViewerStableState('empty', 'このフォルダに表示できるファイルはありません', () => goToFolder(nextFolderPath));
        return;
      }
      idx = 0;
      preloadNearbyImageMeta(0, items);
      showGroup(0);
      updateHud();
      // 兄弟フォルダ一覧を更新
      loadSiblingFolders();
    } catch(e) {
      if (generation !== targetGeneration) return;
      showViewerStableState('error', 'フォルダを読み込めませんでした: ' + (e?.message || e), () => goToFolder(nextFolderPath));
    }
  }

  function prevFolder() {
    if (requestParentFolderNavigation(-1)) return;
    if (isNativeStandaloneViewer()) { navigateNativeFolder(-1); return; }
    if (_siblingIdx > 0) goToFolder(_siblingFolders[_siblingIdx - 1]);
  }
  function nextFolder() {
    if (requestParentFolderNavigation(1)) return;
    if (isNativeStandaloneViewer()) { navigateNativeFolder(1); return; }
    if (_siblingIdx >= 0 && _siblingIdx < _siblingFolders.length - 1) goToFolder(_siblingFolders[_siblingIdx + 1]);
  }

  // btn-prev-folder/btn-next-folder のクリック配線は viewer-controls.js が委譲する
  loadSiblingFolders(); // 初期化時に兄弟フォルダも読み込み

  // 拡大縮小した後にウィンドウや右サイドバーで表示領域の大きさが変わっても、画面上の倍率
  // （原寸比）を保つ。フィットのまま（zoom=1）の時は従来どおり新しい大きさへ合わせ直す。
  function preserveDisplayScaleAcrossResize() {
    if (isPdf || Math.abs(zoom - 1) < 0.0005) return;
    const mediaEl = primaryMediaElement();
    const naturalWidth = mediaEl?.tagName === 'VIDEO' ? mediaEl.videoWidth : mediaEl?.naturalWidth;
    const renderedWidth = parseFloat(mediaEl?.style.width || '');
    if (!(naturalWidth > 0) || !(renderedWidth > 0)) return;
    const size = mediaNaturalSize(mediaEl);
    const base = size ? fitBaseScale(size.w, size.h, !!mediaEl.closest('.spread')) : 0;
    if (base > 0) zoom = (renderedWidth / naturalWidth) / base;
  }

  // リサイズ後の表示状態復元・PDF再フィット（寸法変更通知の受け口）
  function notifyResize() {
    preserveDisplayScaleAcrossResize();
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
    // 単独ビューワーの右サイドバー「プロパティ」タブが、表示中のファイルを知るために使う
    currentPath: currentViewerPathForFolderNavigation,
    getItems: () => items, getIndex: () => idx, getMode: () => mode, isPdf: () => isPdf,
    getPdfPath: () => pdfPath, getSingleFile: () => singleFile, getActiveLayerId: () => activeLayer,
    getFitMode: () => fitMode, getZoom: () => zoom, getDisplayScale, getPanX: () => panX, getPanY: () => panY,
    getFlipH: () => flipH, getFlipV: () => flipV,
    getRotateDeg: () => rotateDeg, isBgBlur: () => bgBlur, isHudVisible: () => hudVisible,
    getSpeed: () => speed, getFadeMs: () => fadeMs, isPlaying: () => playing,
    isSheetContext: () => !!sheetContextId,
    // 表示状態の変更・その他
    setMode, setFitMode, cycleFit, zoomIn, zoomOut, zoomAt, setZoomAt, resetZoom,
    panBy, setPan, setOriginal, toggleFlipH, toggleFlipV, rotate, setRotateDeg,
    toggleBg, toggleHud, toggleFullscreen, setSpeed, setFadeMs, flashStatus, notifyResize,
    // iframe再利用（項目7。プロトコルはviewer-open-request.jsが担当し、本APIは判定/実行のみ）
    canReopenWithUrl: Utils.canReopenWithUrl, reopenWithUrl,
  };
})();
