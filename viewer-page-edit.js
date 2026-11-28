/* viewer-page-edit.js — ビューワーの目次でのPDFのページ編集（PDFだけが対象）。
 *
 * - Ctrl/Command+クリック・Shift+クリックで複数選択、右クリックで選んだページへ一括処理
 *   （入れ替え・前後への移動・回転 90/180/270度・左右／上下反転・削除・開始ページ）
 * - ドラッグで並べ替え。別のビューワーの目次からはコピー（Shift+ドラッグで移動）。
 *   エクスプローラー・ブラウザから画像ファイルを落とすと、その位置へページとして貼り付ける
 * - 保存は本体／単独版の /api/pdf-pages/edit（版を残してから原子的に書く）。取り消し・やり直しは
 *   編集前の版へ戻す。本体では共通の履歴、単独版ではビューワーの履歴へ積む
 * - 右クリックの「複製」で選んだページそれぞれの直後へ写しを置く（中身は共有、PDFの注釈は写さない）
 * - 「トリミング...」で本文の上に範囲の枠（共通部品 MeldexCropBox）を出し、ページの表示範囲（CropBox）を
 *   変える（中身は消さない。「トリミングを解除」で元に戻す）。選んだ全ページへ同じ割合で当てられる
 * - アノテートはページの番号と、ページの表示範囲の中の位置で保存している。番号や位置がずれる複製・
 *   トリミング（その取り消し・やり直しも）は、該当するページにアノテートがある時は行わない
 * - 画像フォルダの目次では編集しない（説明だけ出す）
 */
(function () {
  'use strict';
  const Scene = window.MeldexViewerScene;
  const DRAG_TYPE = 'application/x-meldex-pdf-pages';
  const PDF_ONLY_NOTE = 'ページの編集（並べ替え・複製・トリミング・回転・反転・削除・貼り付け）はPDFだけが対象です';
  const windowId = Math.random().toString(36).slice(2);
  // 送信待ち（オフラインの送り直し）に入れず、本体が書き終えた応答を待つ。届かない時は失敗として知らせる
  // （送信待ちは「成功したこと」にして返すため、PDFの編集では保存できたかを確かめられない）。
  const REMOTE = { requireRemoteCommit: true, silentError: true };
  let selected = new Set();
  let anchor = -1;
  let etag = '';
  let etagPath = '';
  let etagGeneration = 0;
  let busy = false;
  let dropTarget = null;
  let cropped = new Set();   // Meldexでトリミングしたページ（「トリミングを解除」の出し分け）
  let cropSession = null;

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
    const generation = etagGeneration;
    const state = await window.apiFetch('/pdf-pages/state?path=' + encodeURIComponent(path), { silentError: true, requireRemoteCommit: true });
    if (generation !== etagGeneration || path !== pdfPath()) return ensureEtag(true);
    etag = String(state?.etag || ''); etagPath = path;
    rememberCropped(state);
    return etag;
  }
  function rememberCropped(result) {
    if (Array.isArray(result?.cropped_pages)) cropped = new Set(result.cropped_pages.map(Number));
  }

  // ---------- アノテートの保護 ----------
  // アノテートはページの番号（#page=N）と、表示範囲の中の位置で保存している。ページの番号がずれる複製と、
  // 表示範囲が変わるトリミングは、該当するページにアノテートがあれば行わない（アノテートを別のページ・位置へ
  // ずらさない）。確かめられない時も行わない。
  async function annotatedPages(path) {
    if (document.documentElement.dataset.viewerAnnotationCapability === 'disabled') return [];
    const rows = await window.apiFetch('/annotations?target=' + encodeURIComponent(path) + '&pages=1&limit=10000', { silentError: true });
    const found = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const match = /#page=(\d+)$/i.exec(String(row?.target_path || ''));
      let index = match ? Number(match[1]) - 1 : NaN;
      if (!Number.isInteger(index)) {
        let data = row?.data;
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = null; } }
        if (data?.pageIndex != null) index = Number(data.pageIndex);
      }
      if (Number.isInteger(index) && index >= 0) found.add(index);
    }
    return [...found].sort((a, b) => a - b);
  }
  const pageList = pages => pages.slice(0, 5).map(p => p + 1).join('・') + (pages.length > 5 ? ' ほか' : '');
  // 戻り値: 止める理由（行ってよければ空文字）
  async function annotationBlock(path, affected, verb) {
    let annotated;
    try { annotated = await annotatedPages(path); }
    catch (error) { return 'アノテートの有無を確かめられないため、' + verb + 'しませんでした（ファイルは変更していません）。もう一度操作してください: ' + errorText(error); }
    const hit = annotated.filter(affected);
    return hit.length ? 'ページ ' + pageList(hit) + ' のアノテートの位置がずれるため、' + verb + 'しませんでした（ファイルは変更していません）' : '';
  }
  function guardFor(path, verb, undoAffected, redoAffected) {
    const check = async (affected, what) => {
      const reason = await annotationBlock(path, affected, what);
      if (reason) { status(reason, 8000); throw new Error(reason); }
    };
    return { undo: () => check(undoAffected, verb + 'の取り消しを'), redo: () => check(redoAffected, verb + 'のやり直しを') };
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
  function pushHistory(label, beforeVersion, guard) {
    const path = pdfPath();
    let undoVersion = beforeVersion;
    let redoVersion = '';
    const restore = async (version, nextIndex) => {
      const current = await ensureEtag(true);
      const result = await window.apiPost('/pdf-pages/restore', { path, version, if_match_etag: current }, REMOTE);
      etagGeneration++;
      etag = String(result?.etag || ''); etagPath = path;
      rememberCropped(result);
      // 書き込みが終わった時点で履歴の操作は完了にする（続けて取り消し・やり直しを押しても受け付ける）。
      // 表示の読み直しはその後で進める。
      void Scene.reloadPdfDocument(Math.min(nextIndex ?? Scene.getIndex(), Math.max(0, (result?.page_count || 1) - 1)), { preserveEditRevision: true })
        .then(() => window.MeldexViewerPageList?.redraw?.());
      return result;
    };
    // 複製・トリミングは、戻す前にアノテートがずれないかを確かめる（ずれる時は戻さず、理由を知らせる）
    const undo = async () => { await guard?.undo?.(); const r = await restore(undoVersion); redoVersion = String(r?.before_version || ''); };
    const redo = async () => { await guard?.redo?.(); const r = await restore(redoVersion); undoVersion = String(r?.before_version || ''); };
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

  async function edit(label, operations, { sources, images, moveFrom, focusIndex, select, guard, done } = {}) {
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
      etagGeneration++;
      etag = String(result?.etag || ''); etagPath = path;
      rememberCropped(result);
      pushHistory(label, String(result?.before_version || ''), guard);
      selected = new Set(select || []);
      // 書き込みが終わったら次の操作を受け付ける。表示の読み直しは後から進める（新しい読み直しが古いものを置き換える）
      void Scene.reloadPdfDocument(focusIndex ?? Scene.getIndex(), { preserveEditRevision: true }).then(() => window.MeldexViewerPageList?.redraw?.());
      if (result?.move_source_error) status(result.move_source_error, 8000);
      else status(done || label + 'しました', 2500);
      window.dispatchEvent(new CustomEvent('meldex-viewer-pdf-pages-edited', { detail: { path, operations, result } }));
      return result;
    } catch (error) {
      // 競合・ロック・保存の失敗。ファイルは変わっていない（版の印を取り直して、同じ操作で再試行できる）。
      etag = '';
      etagGeneration++;
      status('ページを編集できませんでした（ファイルは変更していません）: ' + errorText(error), 8000);
      return false;
    } finally {
      busy = false;
    }
  }

  // ---------- 複製 ----------
  async function duplicate(pages) {
    if (!isPdf()) { status(PDF_ONLY_NOTE); return false; }
    if (busy) { status('ページの編集を保存しています。終わってからもう一度操作してください'); return false; }
    const path = pdfPath();
    const first = pages[0];
    // 写しを最初のページの直後へ入れるので、それより後ろのページの番号がずれる
    const blocked = await annotationBlock(path, i => i > first, '複製');
    if (blocked) { status(blocked, 8000); return false; }
    const copies = pages.map((p, k) => p + k + 1);
    return edit('ページの複製', [{ op: 'duplicate', pages }], {
      focusIndex: copies[0], select: copies, done: 'ページを複製しました',
      // 取り消すと写しが消えて、最初の写しから後ろの番号が戻る。やり直しは複製と同じ
      guard: guardFor(path, '複製', i => i >= first + 1, i => i > first),
    });
  }

  // ---------- トリミング ----------
  function pageCanvas(index) {
    const layer = document.getElementById('layer' + Scene.getActiveLayerId?.());
    return [...(layer || document).querySelectorAll('canvas.page-canvas')].find(canvas => canvas._viewerPageNum === index + 1 && canvas.width > 0) || null;
  }
  async function waitForCanvas(index, timeout = 8000) {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
      const canvas = pageCanvas(index);
      if (canvas && canvas.getBoundingClientRect().width > 0) return canvas;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return null;
  }
  function closeCrop() { cropSession?.box?.close?.(); cropSession = null; }

  async function startCrop(pages, index) {
    if (!isPdf()) { status(PDF_ONLY_NOTE); return false; }
    if (!window.MeldexCropBox) { status('トリミングの枠を読み込めませんでした。画面を開き直してください', 6000); return false; }
    if (busy) { status('ページの編集を保存しています。終わってからもう一度操作してください'); return false; }
    if (Number(Scene.getRotateDeg?.() || 0) % 360 || Scene.getFlipH?.() || Scene.getFlipV?.()) {
      status('表示の回転・反転を元に戻してからトリミングしてください（ページの回転・反転はそのままで使えます）', 6000);
      return false;
    }
    closeCrop();
    const path = pdfPath();
    const blocked = await annotationBlock(path, i => pages.includes(i), 'トリミング');
    if (blocked) { status(blocked, 8000); return false; }
    // 本文にそのページを出す（スマホ幅では目次を閉じて、ページの上で枠を動かせるようにする）
    Scene.pause?.();
    if (!Scene.getGroup?.(Scene.getIndex())?.includes(index)) Scene.goToIndex(index);
    if (window.MeldexViewerPageList?.isVisible?.() && matchMedia('(max-width: 820px)').matches && document.documentElement.dataset.toolbarDensity !== 'desktop') {
      document.getElementById('viewer-pages-close')?.click();
    }
    if (!await waitForCanvas(index)) { status('ページを表示できないため、トリミングを始められませんでした。もう一度操作してください', 6000); return false; }
    let all = null;
    let extra = null;
    if (pages.length > 1) {
      extra = document.createElement('label');
      all = document.createElement('input');
      all.type = 'checkbox'; all.className = 'gb-check'; all.checked = true;
      all.dataset.cropAll = 'true';
      extra.append(all, document.createTextNode('選んだ ' + pages.length + ' ページすべてに当てる'));
      extra.title = '同じ割合の範囲を、選んだページすべてに当てます';
    }
    const session = { path, index, pages };
    cropSession = session;
    session.box = window.MeldexCropBox.open({
      target: () => pageCanvas(index)?.getBoundingClientRect() || null,
      box: [0, 0, 1, 1],
      label: 'ページ ' + (index + 1) + ' のトリミングの範囲',
      title: 'ページ ' + (index + 1) + ' をトリミング',
      extra,
      actions: [
        { id: 'apply', label: 'トリミング', primary: true },
        { id: 'cancel', label: 'キャンセル', cancel: true },
      ],
      onAction: async (id, box) => {
        if (id !== 'apply') return true;
        if (box[0] <= 0 && box[1] <= 0 && box[2] >= 1 && box[3] >= 1) {
          status('範囲がページ全体です。枠の辺や四隅をドラッグして範囲を狭めてください', 5000);
          return false;
        }
        const targets = all?.checked ? pages : [index];
        if (targets.length > 1 || targets[0] !== index) {
          const reason = await annotationBlock(path, i => targets.includes(i), 'トリミング');
          if (reason) { status(reason, 8000); return false; }
        }
        // 失敗した時は枠を開いたままにして、同じ範囲で再試行できるようにする
        const result = await edit('ページのトリミング', [{ op: 'crop', pages: targets, box }], {
          focusIndex: index, select: targets, done: 'ページをトリミングしました',
          guard: guardFor(path, 'トリミング', i => targets.includes(i), i => targets.includes(i)),
        });
        return result ? true : false;
      },
      onClose: () => { if (cropSession === session) cropSession = null; },
    });
    return true;
  }

  async function uncrop(pages) {
    if (!isPdf()) { status(PDF_ONLY_NOTE); return false; }
    if (busy) { status('ページの編集を保存しています。終わってからもう一度操作してください'); return false; }
    const targets = pages.filter(p => cropped.has(p));
    if (!targets.length) { status('トリミングしたページがありません'); return false; }
    const path = pdfPath();
    const blocked = await annotationBlock(path, i => targets.includes(i), 'トリミングの解除');
    if (blocked) { status(blocked, 8000); return false; }
    return edit('トリミングの解除', [{ op: 'uncrop', pages: targets }], {
      focusIndex: targets[0], select: pages, done: 'トリミングを解除しました',
      guard: guardFor(path, 'トリミングの解除', i => targets.includes(i), i => targets.includes(i)),
    });
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
    const anyCropped = pages.some(p => cropped.has(p));
    const items = [
      { label: label + 'を複製', icon: 'copy', title: '選んだページそれぞれの直後へ写しを置きます',
        action: () => duplicate(pages) },
      { label: 'トリミング...', icon: 'crop', title: 'ページの上に範囲の枠を出して、表示する範囲を決めます（中身は消えず、解除で元に戻せます）',
        action: () => startCrop(pages, index) },
      { label: 'トリミングを解除', icon: 'maximize2', disabled: !anyCropped,
        title: anyCropped ? 'トリミングする前の範囲に戻します' : 'トリミングしたページを選ぶと使えます',
        action: () => uncrop(pages) },
      { type: 'separator' },
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
    window.addEventListener('viewer-pdf-document-reloaded', event => {
      if (event.detail?.path === pdfPath()) { etagGeneration++; etag = ''; etagPath = ''; }
    });
    window.addEventListener('viewer-page-state', () => {
      if (etagPath && etagPath !== pdfPath()) { etagGeneration++; etag = ''; etagPath = ''; selected = new Set(); anchor = -1; cropped = new Set(); }
      // 別のファイルへ移ったら、トリミングの枠を閉じる（前のファイルのページへ当てない）
      if (cropSession && cropSession.path !== pdfPath()) closeCrop();
    });
  }

  window.MeldexViewerPageEdit = Object.freeze({
    decorateCell, edit, selection, PDF_ONLY_NOTE, DRAG_TYPE,
    duplicate, startCrop, uncrop,
    croppedPages: () => [...cropped].sort((a, b) => a - b),
    isCropping: () => !!cropSession?.box?.isOpen?.(),
    isBusy: () => busy,
    setSelection(pages) { selected = new Set(pages); paint(); },
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
