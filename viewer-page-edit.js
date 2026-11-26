/* viewer-page-edit.js — ビューワーの目次でのPDFのページ編集（PDFだけが対象）。
 *
 * - Ctrl/Command+クリック・Shift+クリックで複数選択、右クリックで選んだページへ一括処理
 *   （入れ替え・前後への移動・回転 90/180/270度・左右／上下反転・削除・開始ページ）
 * - ドラッグで並べ替え。別のビューワーの目次からはコピー（Shift+ドラッグで移動）。
 *   エクスプローラー・ブラウザから画像ファイルを落とすと、その位置へページとして貼り付ける
 * - 保存は本体／単独版の /api/pdf-pages/edit（版を残してから原子的に書く）。取り消し・やり直しは
 *   編集前の版へ戻す。本体では共通の履歴、単独版ではビューワーの履歴へ積む
 * - 画像フォルダの目次では編集しない（説明だけ出す）
 */
(function () {
  'use strict';
  const Scene = window.MeldexViewerScene;
  const DRAG_TYPE = 'application/x-meldex-pdf-pages';
  const PDF_ONLY_NOTE = 'ページの編集（並べ替え・回転・反転・削除・貼り付け）はPDFだけが対象です';
  const windowId = Math.random().toString(36).slice(2);
  // 送信待ち（オフラインの送り直し）に入れず、本体が書き終えた応答を待つ。届かない時は失敗として知らせる
  // （送信待ちは「成功したこと」にして返すため、PDFの編集では保存できたかを確かめられない）。
  const REMOTE = { requireRemoteCommit: true, silentError: true };
  let selected = new Set();
  let anchor = -1;
  let etag = '';
  let etagPath = '';
  let busy = false;
  let dropTarget = null;

  const isPdf = () => !!Scene?.isPdf?.() && !!Scene.getPdfPath?.();
  const pdfPath = () => String(Scene?.getPdfPath?.() || '');
  const rowsHost = () => document.getElementById('viewer-pages-rows');
  const cellOf = node => node?.closest?.('.viewer-page-item');
  const indexOf = cell => Number(cell?.dataset?.index);
  const pageCount = () => (Scene?.getItems?.() || []).length;

  function status(message, ms = 5000) { Scene?.flashStatus?.(message, ms); }
  function errorText(error) {
    const detail = error?.detail ?? error?.body?.detail ?? error?.data?.detail;
    if (detail && typeof detail === 'object') return detail.message || JSON.stringify(detail);
    return String(detail || error?.message || error || '');
  }

  async function ensureEtag(force = false) {
    const path = pdfPath();
    if (!force && etag && etagPath === path) return etag;
    const state = await window.apiFetch('/pdf-pages/state?path=' + encodeURIComponent(path), { silentError: true, requireRemoteCommit: true });
    etag = String(state?.etag || ''); etagPath = path;
    return etag;
  }

  let prefetching = '';
  function prefetchEtag() {
    const path = pdfPath();
    if (!path || prefetching === path) return;
    prefetching = path;
    ensureEtag().catch(() => {}).finally(() => { if (prefetching === path) prefetching = ''; });
  }

  function paint() {
    rowsHost()?.querySelectorAll('.viewer-page-item').forEach(cell => {
      const on = selected.has(indexOf(cell));
      cell.classList.toggle('viewer-page-selected', on);
      cell.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function decorateCell(button, index, info) {
    if (!info?.pdf || info.extra) {
      // 画像フォルダ等では編集しない。理由は説明（ツールチップ）で分かるようにする。
      button.title = (button.title ? button.title + '\n' : '') + PDF_ONLY_NOTE;
      button.dataset.pageEditNote = PDF_ONLY_NOTE;
      button.removeAttribute('draggable');
      return;
    }
    button.draggable = true;
    button.dataset.pageEdit = 'pdf';
    // 別の画面へドラッグした時に移動元を照合できるよう、版の印を先に受け取っておく
    if (!etag || etagPath !== pdfPath()) prefetchEtag();
    button.title = (button.title ? button.title + '\n' : '') + '右クリックでページの編集・ドラッグで並べ替え（Ctrl・Shift＋クリックで複数選択）';
    const on = selected.has(index);
    button.classList.toggle('viewer-page-selected', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
  }

  function selection() { return [...selected].filter(i => i >= 0 && i < pageCount()).sort((a, b) => a - b); }

  // ---------- 保存と履歴 ----------
  function pushHistory(label, beforeVersion) {
    const path = pdfPath();
    let undoVersion = beforeVersion;
    let redoVersion = '';
    const restore = async (version, nextIndex) => {
      const current = await ensureEtag(true);
      const result = await window.apiPost('/pdf-pages/restore', { path, version, if_match_etag: current }, REMOTE);
      etag = String(result?.etag || ''); etagPath = path;
      // 書き込みが終わった時点で履歴の操作は完了にする（続けて取り消し・やり直しを押しても受け付ける）。
      // 表示の読み直しはその後で進める。
      void Scene.reloadPdfDocument(Math.min(nextIndex ?? Scene.getIndex(), Math.max(0, (result?.page_count || 1) - 1)))
        .then(() => window.MeldexViewerPageList?.redraw?.());
      return result;
    };
    const undo = async () => { const r = await restore(undoVersion); redoVersion = String(r?.before_version || ''); };
    const redo = async () => { const r = await restore(redoVersion); undoVersion = String(r?.before_version || ''); };
    const parentHistory = window.parent !== window ? window.parent.historyPush : null;
    if (typeof parentHistory === 'function') {
      // 本体では、この画面の取り消し（Ctrl+Z）が向かう文書単位の履歴へ積む（ページを移っても取り消せる）
      let scope;
      try {
        const surfaces = window.parent.GBAnnotationSurfaces;
        const surface = surfaces?.forElement?.(window.frameElement);
        scope = surface ? surfaces.documentHistoryScope?.(surface) || undefined : undefined;
      } catch (_) { scope = undefined; }
      return parentHistory.call(window.parent, label, undo, redo, scope);
    }
    return window.MeldexViewerHistory?.push?.(label, undo, redo);
  }

  async function edit(label, operations, { sources, images, moveFrom, focusIndex, select } = {}) {
    if (!isPdf()) { status(PDF_ONLY_NOTE); return false; }
    if (busy) { status('ページの編集を保存しています。終わってからもう一度操作してください'); return false; }
    busy = true;
    const path = pdfPath();
    try {
      const current = await ensureEtag();
      const body = { path, if_match_etag: current, operations };
      if (sources) body.sources = sources;
      if (images) body.images = images;
      if (moveFrom) body.move_from = moveFrom;
      const result = await window.apiPost('/pdf-pages/edit', body, REMOTE);
      etag = String(result?.etag || ''); etagPath = path;
      pushHistory(label, String(result?.before_version || ''));
      selected = new Set(select || []);
      // 書き込みが終わったら次の操作を受け付ける。表示の読み直しは後から進める（新しい読み直しが古いものを置き換える）
      void Scene.reloadPdfDocument(focusIndex ?? Scene.getIndex()).then(() => window.MeldexViewerPageList?.redraw?.());
      if (result?.move_source_error) status(result.move_source_error, 8000);
      else status(label + 'しました', 2500);
      window.dispatchEvent(new CustomEvent('meldex-viewer-pdf-pages-edited', { detail: { path, operations, result } }));
      return result;
    } catch (error) {
      // 競合・ロック・保存の失敗。ファイルは変わっていない（版の印を取り直して、同じ操作で再試行できる）。
      etag = '';
      status('ページを編集できませんでした（ファイルは変更していません）: ' + errorText(error), 8000);
      return false;
    } finally {
      busy = false;
    }
  }

  // ---------- 右クリックメニュー ----------
  function openMenu(event, index) {
    if (!selected.has(index)) { selected = new Set([index]); anchor = index; paint(); }
    const pages = selection();
    const count = pages.length;
    const n = pageCount();
    const label = count > 1 ? count + 'ページ' : 'ページ ' + (pages[0] + 1);
    const side = Scene.getFirstSide?.();
    const spread = Scene.getMode?.() !== 'single';
    const items = [
      { label: '選んだ2ページを入れ替え', icon: 'arrowLeftRight', disabled: count !== 2,
        action: () => edit('ページの入れ替え', [{ op: 'swap', pages }], { focusIndex: pages[0], select: pages }) },
      { label: '前へ移動', icon: 'arrowUp', disabled: pages[0] <= 0,
        action: () => edit('ページの移動', [{ op: 'move', pages, to: pages[0] - 1 }], { focusIndex: pages[0] - 1, select: pages.map((_, i) => pages[0] - 1 + i) }) },
      { label: '後ろへ移動', icon: 'arrowDown', disabled: pages[count - 1] >= n - 1,
        action: () => {
          const to = Math.min(n, pages[count - 1] + 2);
          const start = to - count - pages.filter(p => p >= to).length;
          edit('ページの移動', [{ op: 'move', pages, to }], { focusIndex: start, select: pages.map((_, i) => start + i) });
        } },
      { type: 'separator' },
      { label: '回転', icon: 'rotateCw', items: [90, 180, 270].map(degrees => ({
        label: degrees + '度', action: () => edit('ページの回転', [{ op: 'rotate', pages, degrees }], { select: pages }),
      })) },
      { label: '反転', icon: 'flipHorizontal', items: [
        { label: '左右反転', icon: 'flipHorizontal', action: () => edit('ページの左右反転', [{ op: 'flip', pages, axis: 'h' }], { select: pages }) },
        { label: '上下反転', icon: 'flipVertical', action: () => edit('ページの上下反転', [{ op: 'flip', pages, axis: 'v' }], { select: pages }) },
      ] },
      { label: '開始ページ', icon: 'bookOpen', disabled: !spread, items: [
        { label: (side === 'left' ? '● ' : '') + '左', action: () => Scene.setFirstSide('left') },
        { label: (side === 'right' ? '● ' : '') + '右', action: () => Scene.setFirstSide('right') },
      ] },
      { type: 'separator' },
      { label: label + 'を削除', icon: 'trash2', danger: true, disabled: count >= n,
        action: () => edit('ページの削除', [{ op: 'delete', pages }], { focusIndex: Math.min(pages[0], n - count - 1), select: [] }) },
    ];
    window.MeldexContextMenuUI?.openAt({ x: event.clientX, y: event.clientY, ariaLabel: 'ページの編集', items });
  }

  // ---------- 選択 ----------
  function onClick(event) {
    const cell = cellOf(event.target);
    if (!cell || cell.dataset.pageEdit !== 'pdf') return;
    const index = indexOf(cell);
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault(); event.stopPropagation();
      if (selected.has(index)) selected.delete(index); else selected.add(index);
      anchor = index; paint();
      return;
    }
    if (event.shiftKey) {
      event.preventDefault(); event.stopPropagation();
      const from = anchor >= 0 ? anchor : index;
      selected = new Set();
      for (let i = Math.min(from, index); i <= Math.max(from, index); i++) selected.add(i);
      paint();
      return;
    }
    selected = new Set([index]); anchor = index; paint();
  }

  // ---------- ドラッグ・ドロップ ----------
  function clearDrop() {
    rowsHost()?.querySelectorAll('.viewer-page-drop-before, .viewer-page-drop-after').forEach(cell => {
      cell.classList.remove('viewer-page-drop-before', 'viewer-page-drop-after', 'viewer-page-drop-horizontal', 'viewer-page-drop-vertical');
    });
    dropTarget = null;
  }
  function dropPosition(event) {
    const cell = cellOf(event.target);
    if (!cell || cell.dataset.pageEdit !== 'pdf') return null;
    const rect = cell.getBoundingClientRect();
    const row = cell.closest('.viewer-page-row');
    const sideBySide = !!row && row.querySelectorAll('.viewer-page-item').length > 1;
    const before = sideBySide ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2;
    const index = indexOf(cell);
    // 見開き_左へ では右側のページが先。画面の左側は「後ろ」にあたる
    const reversed = sideBySide && Scene.getMode?.() === 'manga';
    const insertBefore = reversed ? !before : before;
    return { cell, at: insertBefore ? index : index + 1, visualBefore: before, sideBySide };
  }
  function acceptable(event) {
    const types = Array.from(event.dataTransfer?.types || []);
    return isPdf() && (types.includes(DRAG_TYPE) || types.includes('Files'));
  }
  function onDragStart(event) {
    const cell = cellOf(event.target);
    if (!cell || cell.dataset.pageEdit !== 'pdf') return;
    const index = indexOf(cell);
    if (!selected.has(index)) { selected = new Set([index]); anchor = index; paint(); }
    const pages = selection();
    const payload = { path: pdfPath(), pages, etag, windowId, origin: location.origin };
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', pdfPath() + ' のページ ' + pages.map(p => p + 1).join(', '));
    event.dataTransfer.effectAllowed = 'copyMove';
    // 版の印を先に取っておく（別の画面へ落とした時に移動元を照合する）
    ensureEtag().catch(() => {});
  }
  function onDragOver(event) {
    if (!acceptable(event)) return;
    const position = dropPosition(event);
    if (!position) return;
    event.preventDefault();
    const types = Array.from(event.dataTransfer.types || []);
    event.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : (event.shiftKey ? 'move' : 'copy');
    if (dropTarget && dropTarget.cell === position.cell && dropTarget.visualBefore === position.visualBefore) return;
    clearDrop();
    dropTarget = position;
    position.cell.classList.add(position.visualBefore ? 'viewer-page-drop-before' : 'viewer-page-drop-after',
      position.sideBySide ? 'viewer-page-drop-vertical' : 'viewer-page-drop-horizontal');
  }
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(reader.error || new Error('画像を読み込めません'));
      reader.readAsDataURL(file);
    });
  }
  async function onDrop(event) {
    if (!acceptable(event)) return;
    const position = dropPosition(event) || dropTarget;
    clearDrop();
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length) {
      const imagesOnly = files.filter(file => /^image\//i.test(file.type) || /\.(?:png|jpe?g|gif|bmp|webp|tiff?)$/i.test(file.name));
      if (!imagesOnly.length) { status('貼り付けられるのは画像ファイルだけです'); return; }
      try {
        const images = await Promise.all(imagesOnly.map(async (file, i) => ({ key: 'img' + i, data: await readFileAsBase64(file) })));
        await edit('画像の貼り付け', [{ op: 'insert_images', at: position.at, images: images.map(item => item.key) }],
          { images, focusIndex: position.at, select: images.map((_, i) => position.at + i) });
      } catch (error) { status('画像を貼り付けられませんでした: ' + errorText(error), 8000); }
      if (files.length > imagesOnly.length) status('画像ではないファイルは貼り付けていません', 6000);
      return;
    }
    let payload = null;
    try { payload = JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || 'null'); } catch (_) { payload = null; }
    if (!payload?.path || !Array.isArray(payload.pages) || !payload.pages.length) return;
    const pages = payload.pages;
    if (payload.path === pdfPath()) {
      // 同じPDFの中での並べ替え（選んだページを、その順のまま落とした位置へ）
      const start = position.at - pages.filter(p => p < position.at).length;
      if (pages.every((p, i) => p === start + i)) return;
      await edit('ページの並べ替え', [{ op: 'move', pages, to: position.at }],
        { focusIndex: start, select: pages.map((_, i) => start + i) });
      return;
    }
    if (payload.origin && payload.origin !== location.origin) {
      status('別のアプリの画面のPDFからは、この画面へコピーできません（同じMeldexの画面どうしで操作してください）', 8000);
      return;
    }
    const moving = !!event.shiftKey;
    let sourceEtag = String(payload.etag || '');
    if (moving && !sourceEtag) {
      // ドラッグを始めた時点で移動元の版の印をまだ受け取っていなかった（開いた直後など）。落とした時点の印で照合する。
      try {
        const state = await window.apiFetch('/pdf-pages/state?path=' + encodeURIComponent(payload.path), { silentError: true, requireRemoteCommit: true });
        sourceEtag = String(state?.etag || '');
      } catch (error) { status('移動元のPDFを確かめられないため、移動しませんでした: ' + errorText(error), 8000); return; }
    }
    await edit(moving ? 'ページの移動' : 'ページのコピー', [{ op: 'insert_pages', at: position.at, source: 'src', pages }], {
      sources: [{ key: 'src', path: payload.path }],
      moveFrom: moving ? { path: payload.path, pages, if_match_etag: sourceEtag } : null,
      focusIndex: position.at, select: pages.map((_, i) => position.at + i),
    });
  }

  function install() {
    const host = rowsHost();
    if (!host) return;
    host.addEventListener('click', onClick, true);
    host.addEventListener('contextmenu', event => {
      const cell = cellOf(event.target);
      if (!cell || cell.dataset.pageEdit !== 'pdf' || !isPdf()) return;
      event.preventDefault(); event.stopPropagation();
      openMenu(event, indexOf(cell));
    });
    host.addEventListener('dragstart', onDragStart);
    host.addEventListener('dragover', onDragOver);
    host.addEventListener('dragleave', event => { if (!host.contains(event.relatedTarget)) clearDrop(); });
    host.addEventListener('drop', event => { void onDrop(event); });
    document.addEventListener('dragend', clearDrop);
    host.addEventListener('keydown', event => {
      const cell = cellOf(event.target);
      if (!cell || cell.dataset.pageEdit !== 'pdf' || !(event.key === 'Delete' || event.key === 'Backspace')) return;
      event.preventDefault(); event.stopPropagation();
      if (!selected.has(indexOf(cell))) selected = new Set([indexOf(cell)]);
      const pages = selection();
      if (pages.length >= pageCount()) { status('すべてのページは削除できません'); return; }
      void edit('ページの削除', [{ op: 'delete', pages }], { focusIndex: Math.min(pages[0], pageCount() - pages.length - 1), select: [] });
    });
    // 別のファイルを開いたら選択と版の印を捨てる
    window.addEventListener('viewer-page-state', () => {
      if (etagPath && etagPath !== pdfPath()) { etag = ''; etagPath = ''; selected = new Set(); anchor = -1; }
    });
  }

  window.MeldexViewerPageEdit = Object.freeze({
    decorateCell, edit, selection, PDF_ONLY_NOTE, DRAG_TYPE,
    isBusy: () => busy,
    setSelection(pages) { selected = new Set(pages); paint(); },
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
