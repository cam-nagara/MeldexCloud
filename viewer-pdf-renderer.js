/* viewer-pdf-renderer.js — Meldexビューワー: PDF.js描画責務の分離モジュール。
   計画書: app/docs/viewer-stability-common-ui-gap-fix-plan-2026-08-04.md「実装変更 > 1」
   分割元: viewer-scene.js（1,000行以内に収めるための責務分割。公開中の window.MeldexViewerScene
   APIは変更しない）。
   方針:
     - pdf.jsの読み込み・ドキュメントオープン・ページ描画・描画タスクのキャンセルだけを担当する。
       ページ集合の管理（items[]）・ズーム/フィット計算・表示モードは呼び出し側(viewer-scene.js)
       が引き続き担当する。
     - リサイズ時の再フィットでは、新しいcanvas要素を作らず既存canvasのbacking storeとCSSサイズだけを
       更新する（refitCanvas）。古い描画タスクは新しいレンダリングを始める前に必ずキャンセルする。
   公開: window.MeldexViewerPdfRenderer */
(function () {
  'use strict';

  // canvas要素ごとの「現在進行中の描画タスク」を追跡する（キャンセル用）。
  // canvasのDOM実体はrenderPageToNewCanvas/refitCanvasを通じて常に同一のまま再利用する。
  const _canvasRenderTasks = new WeakMap();
  // ページの原寸（scale=1）サイズのキャッシュ。pdfDocごとに保持する
  // （media-pixel-v1座標変換・items[].w/hの初回取得で使用）。
  const _naturalSizeCache = new WeakMap();

  let _pdfjsPromise = null;
  function ensurePdfjs() {
    if (!_pdfjsPromise) {
      // PDF.js v4.4.168 — Apache 2.0 (vendor/pdfjs/LICENSE, NOTICE)
      _pdfjsPromise = import('./vendor/pdfjs/pdf.min.mjs').then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';
        return lib;
      });
    }
    return _pdfjsPromise;
  }

  async function openDocument(url) {
    const lib = await ensurePdfjs();
    // 全体は順に読み込み（stream）、足りない部分だけ範囲指定で取る。先回りの範囲取得（autoFetch）は
    // 表示に要る部分の取得と取り合うため行わない（2026-11-27 計測。168MBのスキャンPDFで開くまで5〜10%短縮）。
    return lib.getDocument({ url, disableAutoFetch: true }).promise;
  }

  function cancelCanvasTask(canvas) {
    const task = canvas && _canvasRenderTasks.get(canvas);
    if (task && typeof task.cancel === 'function') {
      try { task.cancel(); } catch {}
    }
    if (canvas) _canvasRenderTasks.delete(canvas);
  }

  async function getPageNaturalSize(doc, pageNum) {
    if (!doc) return { width: 0, height: 0 };
    let perDoc = _naturalSizeCache.get(doc);
    if (!perDoc) { perDoc = new Map(); _naturalSizeCache.set(doc, perDoc); }
    if (perDoc.has(pageNum)) return perDoc.get(pageNum);
    const page = await doc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    const size = { width: vp.width, height: vp.height };
    perDoc.set(pageNum, size);
    return size;
  }

  // フィット倍率の純粋計算（viewer-scene.jsのapplyFit/refitPdfForResizeから利用）。
  function computeFitZoom(fitMode, pageW, pageH, viewportW, viewportH) {
    if (fitMode === 'original_contain') return Math.min(viewportW / pageW, viewportH / pageH, 1);
    if (fitMode === 'contain') return Math.min(viewportW / pageW, viewportH / pageH);
    if (fitMode === 'width') return viewportW / pageW;
    if (fitMode === 'height') return viewportH / pageH;
    return 1; // 'none' = 原寸
  }

  function _isCancelledError(err) {
    return !!err && (err.name === 'RenderingCancelledException' || /cancel/i.test(String(err?.message || err)));
  }

  // 新しいcanvas要素を作って1ページを描画する（初回表示・グループ切替時・先読み）。
  // options.onTask(task) で描画を取り消せる。取り消した canvas には _viewerRenderCancelled が付く。
  async function renderPageToNewCanvas(doc, pageNum, zoom, options = {}) {
    const page = await doc.getPage(pageNum);
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: zoom * dpr });
    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas._viewerPageNum = pageNum;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = (viewport.width / dpr) + 'px';
    canvas.style.height = (viewport.height / dpr) + 'px';
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    _canvasRenderTasks.set(canvas, task);
    options.onTask?.(task);
    try {
      await task.promise;
    } catch (err) {
      if (!_isCancelledError(err)) throw err;
      canvas._viewerRenderCancelled = true;
    } finally {
      if (_canvasRenderTasks.get(canvas) === task) _canvasRenderTasks.delete(canvas);
    }
    return canvas;
  }

  // 既存のcanvas要素（DOM上の同一ノード）を再利用し、フィット倍率とbacking storeだけを
  // 更新する（非破壊リサイズ用）。古い描画タスクは新しい描画を始める前にキャンセルする。
  async function refitCanvas(canvas, doc, pageNum, zoom) {
    if (!canvas || !doc) return canvas;
    cancelCanvasTask(canvas);
    const page = await doc.getPage(pageNum);
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: zoom * dpr });
    canvas._viewerPageNum = pageNum;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = (viewport.width / dpr) + 'px';
    canvas.style.height = (viewport.height / dpr) + 'px';
    const ctx = canvas.getContext('2d');
    const task = page.render({ canvasContext: ctx, viewport });
    _canvasRenderTasks.set(canvas, task);
    try {
      await task.promise;
    } catch (err) {
      if (!_isCancelledError(err)) throw err;
    } finally {
      if (_canvasRenderTasks.get(canvas) === task) _canvasRenderTasks.delete(canvas);
    }
    if (canvas.isConnected) await window.MeldexViewerTextLayer?.refitPdf(canvas, doc, pageNum, zoom,
      window.MeldexViewerScene?.getPdfPath?.() || '');
    return canvas;
  }

  window.MeldexViewerPdfRenderer = {
    ensurePdfjs,
    openDocument,
    getPageNaturalSize,
    computeFitZoom,
    renderPageToNewCanvas,
    refitCanvas,
    cancelCanvasTask,
  };
})();
