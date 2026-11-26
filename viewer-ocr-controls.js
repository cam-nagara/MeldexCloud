/* Local OCR menu and shared progress tray integration. */
(function () {
  'use strict';
  let capability = null;
  let engine = 'windows';
  let device = 'cpu';
  let sceneGeneration = 0;
  const scene = () => window.MeldexViewerScene;
  const text = () => window.MeldexViewerTextLayer;
  const local = () => !window.MeldexViewerCloudFileOpen?.isCloudViewer?.()
    && document.documentElement.dataset.standaloneCloud !== 'viewer'
    && !new URLSearchParams(location.search).has('localFiles')
    && !window.MeldexRuntimeAdapter?.isDropboxMode?.()
    && !window.MeldexRuntimeAdapter?.isBrowserDataMode?.();

  // Native startup deliberately defers the annotation service. OCR range
  // selection is read-only and must work before that optional service loads.
  let nativeRegion = null;
  let regionDrag = null;
  let regionOverlay = null;
  function clearNativeRegion() {
    regionOverlay?.remove(); regionOverlay = null; nativeRegion = null; regionDrag = null;
  }
  function selectedNativeRegion() {
    if (!nativeRegion || !nativeRegion.media.isConnected) return null;
    const target = currentTargets().find(t => t.media === nativeRegion.media);
    if (!target || target.item.path !== nativeRegion.path) return null;
    return { path: nativeRegion.path, page: nativeRegion.page, box: nativeRegion.box };
  }
  document.addEventListener('pointerdown', event => {
    if (!capability?.canRecognize || !local() || window.MeldexViewerAnnotationScene || !event.shiftKey || event.button !== 0) return;
    const target = currentTargets().find(t => t.media === event.target);
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation(); clearNativeRegion();
    window.getSelection()?.removeAllRanges();
    regionDrag = { target, x: event.clientX, y: event.clientY, pointer: event.pointerId };
    target.media.setPointerCapture?.(event.pointerId);
  }, true);
  document.addEventListener('pointermove', event => {
    if (!regionDrag || event.pointerId !== regionDrag.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const { target, x, y } = regionDrag;
    const rect = target.media.getBoundingClientRect();
    if (!rect.width || !rect.height) { clearNativeRegion(); return; }
    const left = Math.max(rect.left, Math.min(x,event.clientX)), top = Math.max(rect.top, Math.min(y,event.clientY));
    const right = Math.min(rect.right, Math.max(x,event.clientX)), bottom = Math.min(rect.bottom, Math.max(y,event.clientY));
    if (!regionOverlay) {
      regionOverlay = document.createElement('div');
      regionOverlay.style.cssText = 'position:fixed;pointer-events:none;border:1px solid var(--accent);background:color-mix(in srgb,var(--accent) 20%,transparent);z-index:90';
      regionOverlay.setAttribute('aria-hidden','true'); document.body.append(regionOverlay);
    }
    Object.assign(regionOverlay.style,{left:left+'px',top:top+'px',width:(right-left)+'px',height:(bottom-top)+'px'});
    nativeRegion = { media:target.media, path:target.item.path, page:scene().isPdf()?target.item.pageNum:1,
      box:[(left-rect.left)/rect.width,(top-rect.top)/rect.height,(right-left)/rect.width,(bottom-top)/rect.height] };
  }, true);
  document.addEventListener('pointerup', event => {
    if (!regionDrag || event.pointerId !== regionDrag.pointer) return;
    event.preventDefault(); event.stopImmediatePropagation(); regionDrag = null;
  }, true);
  document.addEventListener('pointercancel', clearNativeRegion, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') clearNativeRegion(); }, true);

  function dialog(message, mode = 'message', options = {}) {
    // Shared modal component, including keyboard/focus and narrow-screen rules.
    return new Promise(resolve => {
      const paragraph = document.createElement('p'); paragraph.textContent = message; paragraph.style.whiteSpace = 'pre-line';
      const isInput = mode === 'search' || mode === 'input';
      const input = document.createElement('input'); input.className = 'gb-input'; input.setAttribute('aria-label', options.title || '検索する文字');
      input.value = options.value || '';
      const ok = document.createElement('button'); ok.className = 'gb-btn gb-btn-primary'; ok.textContent = mode === 'search' ? '検索' : '決定';
      const cancel = document.createElement('button'); cancel.className = 'gb-btn'; cancel.textContent = 'キャンセル';
      let result = isInput ? null : false;
      const modal = window.GBUI.createModal({ title: options.title || (mode === 'search' ? '文書内を検索' : 'OCR'),
        body: isInput ? [paragraph, input] : [paragraph],
        footer: mode === 'message' ? [ok] : [cancel, ok],
        initialFocus: () => isInput ? input : cancel,
        onClose: () => resolve(result), closeOnEsc: true, closeOnOverlay: true });
      ok.addEventListener('click', () => { result = isInput ? input.value : true; modal.close('submit'); });
      cancel.addEventListener('click', () => modal.close('cancel'));
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); ok.click(); } });
      modal.open();
    });
  }

  async function request(path, body, host = window) {
    const response = await host.fetch('/api/viewer-ocr' + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : 'OCRを利用できません');
    return value;
  }
  function progress() {
    try { return window.parent.MeldexOperationProgress || window.MeldexOperationProgress; }
    catch (_) { return window.MeldexOperationProgress; }
  }
  async function job(body, label, { quiet = false } = {}) {
    if (body.action === 'ocr' && ['manga', 'book'].includes(body.engine)) {
      capability = await request('');
      if (!capability[body.engine]?.installed) return install(true);
    }
    return progress().runRemoteJob({ endpoint: '/api/viewer-ocr', body, label, quiet,
      kind: body.action === 'install' ? 'download' : 'viewer-ocr',
      ownerFrame: window.frameElement, ownerDocument: document,
      onComplete: result => {
        if (['ocr', 'edit', 'undo', 'redo'].includes(body.action)) apply(result, body.path, true);
        if (body.action === 'install' || body.action === 'remove') capability = { ...capability, [body.engine === 'book' ? body.engine : 'manga']: result };
      },
    });
  }
  function currentTargets() {
    const s = scene();
    if (!s) return [];
    const media = [...document.querySelectorAll('#layer' + s.getActiveLayerId() + ' canvas.page-canvas, #layer' + s.getActiveLayerId() + ' img')];
    // The sibling list is filled later and may replace absolute paths with
    // workspace-relative paths without replacing the displayed image element.
    return s.currentDisplayOrder().map((index, position) => ({ media: media[position], item: media[position]?._viewerItem || s.getItems()[index] }))
      .filter(target => target.media && target.item?.path && !/^(?:blob:|zip:|https?:)/i.test(target.item.path)
        && /\.(?:pdf|png|apng|jpe?g|jpe|jfif|webp|bmp|gif|ico|tiff?|avif)$/i.test(target.item.path));
  }
  function apply(result, path, replace = false) {
    for (const target of currentTargets()) {
      if (target.item.path !== path) continue;
      const page = scene().isPdf() ? target.item.pageNum : 1;
      const recognized = result?.pages.find(item => item.page === page);
      if (recognized && (replace || recognized.preferred || !target.media.parentElement.querySelector('.viewer-text-layer')?.textContent.trim())) {
        text().ocr(target.media, recognized, path);
      }
    }
    text()?.updateIndicator();
  }
  async function onSceneChanged() {
    clearNativeRegion();
    const generation = ++sceneGeneration;
    if (!capability || !local()) return;
    for (const target of currentTargets()) {
      const path = target.item.path;
      await target.media._viewerNativeTextReady;
      const result = await job({ action: 'read', path, page: scene().isPdf() ? target.item.pageNum : 1, engine }, '', { quiet: true });
      if (generation !== sceneGeneration) return;
      apply(result, path);
    }
  }
  async function run(scope, force = false) {
    const target = currentTargets()[0];
    if (!target) return;
    return job({ action: 'ocr', path: target.item.path, page: scene().isPdf() ? target.item.pageNum : 1,
      scope, force, engine, device }, 'OCR');
  }
  async function runPages() {
    const target = currentTargets()[0];
    if (!target) return;
    const value = await dialog('例：1-3, 8, 12。再開時は保存済みのページを再利用します。', 'input', { title: '認識するページ' });
    if (value == null) return;
    const pages = new Set();
    for (const part of value.split(',')) {
      const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      const first = Number(match?.[1]), last = Number(match?.[2] || match?.[1]);
      if (!match || first < 1 || last < first || last > (scene().getPdfDocument()?.numPages || 0)) throw new Error('ページ指定を確認してください');
      for (let page = first; page <= last; page++) { pages.add(page); if (pages.size > 10000) throw new Error('一度に指定できるのは10,000ページまでです'); }
    }
    return job({ action: 'ocr', path: target.item.path, scope: 'pages', pages: [...pages], engine, device }, '指定ページのOCR');
  }
  function runRegion(region, rotation) {
    if (!region) throw new Error('Shiftを押して範囲をドラッグするか、文字を選択してください');
    return job({ action: 'ocr', path: region.path, page: region.page, scope: 'region', region: region.box,
      regionSpace: 'fraction', rotation, engine, device, force: true }, '選択範囲のOCR');
  }
  async function currentResult() {
    const target = currentTargets()[0];
    if (!target) return null;
    const body = { path: target.item.path, page: scene().isPdf() ? target.item.pageNum : 1, engine };
    const result = await job({ ...body, action: 'read' }, '', { quiet: true });
    const page = result?.pages?.[0];
    if (!page) throw new Error('先に文字を認識してください');
    return { body, page };
  }
  async function correctHistory(action) {
    const current = await currentResult();
    if (current) return job({ ...current.body, action, expectedRevision: current.page.revision }, action === 'undo' ? 'OCR修正を元に戻す' : 'OCR修正をやり直す');
  }
  async function editText() {
    const current = await currentResult();
    if (!current) return;
    const { body, page } = current;
    const original = document.createElement('p');
    original.className = 'gb-section-desc';
    const doc = scene().getPdfDocument();
    original.textContent = doc ? '埋め込み文字（元のPDF）：' + (await (await doc.getPage(page.page)).getTextContent()).items.map(item => item.str || '').join('') : '元画像は変更しません。修正は管理領域に保存します。';
    const list = document.createElement('div');
    const previous = document.createElement('button'); previous.className = 'gb-btn'; previous.textContent = '前の100行';
    const next = document.createElement('button'); next.className = 'gb-btn'; next.textContent = '次の100行';
    const save = document.createElement('button'); save.className = 'gb-btn gb-btn-primary'; save.textContent = '保存';
    const cancel = document.createElement('button'); cancel.className = 'gb-btn'; cancel.textContent = 'キャンセル';
    const edits = new Map();
    let offset = 0;
    const render = () => {
      list.replaceChildren();
      previous.disabled = offset === 0; next.disabled = offset + 100 >= page.lines.length;
      page.lines.slice(offset, offset + 100).forEach((line, position) => {
        const index = offset + position;
        const label = document.createElement('label');
        label.style.display = 'block';
        label.textContent = `${index + 1}行目 ${line.warnings?.join('／') || ''}`;
        const input = document.createElement('input'); input.className = 'gb-input'; input.value = edits.get(index) ?? line.text;
        input.style.width = '100%';
        input.addEventListener('input', () => edits.set(index, input.value));
        label.append(input); list.append(label);
      });
    };
    previous.addEventListener('click', () => { offset -= 100; render(); });
    next.addEventListener('click', () => { offset += 100; render(); });
    const modal = window.GBUI.createModal({ title: 'OCRの比較・文字修正', body: [original, list],
      footer: [previous, next, cancel, save], initialFocus: () => cancel, closeOnEsc: true, closeOnOverlay: false });
    cancel.addEventListener('click', () => modal.close('cancel'));
    save.addEventListener('click', async () => {
      const patches = [...edits].filter(([index, value]) => value !== page.lines[index].text).map(([line, value]) => ({ line, text: value }));
      if (!patches.length) { modal.close('unchanged'); return; }
      save.disabled = true;
      try {
        const saved = await job({ ...body, action: 'edit', patches, expectedRevision: page.revision }, 'OCRの文字修正');
        if (saved) modal.close('saved');
        else save.disabled = false;
      } catch (error) { save.disabled = false; await dialog(error.message); }
    });
    render(); modal.open();
  }
  async function exportPdf() {
    const target = currentTargets()[0];
    if (!target) return;
    const destination = await dialog('新しいPDFの保存先を入力してください。既存のファイルは上書きしません。', 'input',
      { title: '検索可能なPDFを別名保存', value: target.item.path.replace(/\.pdf$/i, '-OCR.pdf') });
    if (!destination) return;
    const result = await job({ action: 'export', path: target.item.path, destination, engine }, '検索可能なPDFを別名保存');
    if (!result) return;
    await dialog(`保存しました：${result.path}${result.omittedVisibleLines ? '\n元の可視文字と重なる認識結果は重複を避けて除外しました。' : ''}`);
  }
  async function install(missing = false) {
    const status = await request('');
    const modelEngine = engine === 'book' ? engine : 'manga';
    const bytes = status[modelEngine].bytes;
    const description = modelEngine === 'book'
      ? '書籍向け NDLOCR-Lite 2.0.0（CC BY 4.0／DINOv3追加条件、出典表示・利用条件の確認が必要）。モデルの文字一覧にない©・®・™は、端末に既にある書体と原画像の字形が十分に一致した場合だけ補助認識します。認識結果は原本と比較してください。'
      : '縦書き・フキダシ用 Comic Text Detector（GPL-3.0）／Manga OCR（Apache-2.0）';
    // The exact pinned byte count is shown before the first download request.
    const confirmed = await window.MeldexLocalModelUI.confirmInstall({ description: (missing ? 'このOCRモデルは未取得です。先にダウンロードしてください。\n' : '') + description, bytes, title: 'OCR' });
    if (!confirmed) return;
    await job({ action: 'install', engine: modelEngine }, 'OCRモデルの取得');
  }
  async function remove() {
    if (!await dialog('取得したOCRモデルを削除しますか？認識済みテキストは残ります。', 'confirm')) return;
    await job({ action: 'remove', engine: engine === 'book' ? engine : 'manga' }, 'OCRモデルの削除');
  }
  async function search() {
    const query = await dialog('検索する文字を入力してください', 'search');
    if (!query) return;
    const doc = scene()?.getPdfDocument();
    const path = currentTargets()[0]?.item.path;
    const operation = progress()?.begin({ label: 'テキストを検索', background: true });
    try {
      const matches = doc ? await text().search(doc, query) : [];
      if (capability && path) {
        const cached = await job({ action: 'read', path, scope: doc ? 'document' : 'page', engine }, '', { quiet: true });
        for (const page of cached?.pages || []) {
          if (page.preferred) {
            const index = matches.findIndex(match => match.page === page.page);
            if (index >= 0) matches.splice(index, 1);
          }
          const value = page.lines.map(line => line.text).join('');
          if (value.normalize('NFKC').toLocaleLowerCase().includes(query.normalize('NFKC').toLocaleLowerCase()) && !matches.some(match => match.page === page.page)) matches.push({ page: page.page, text: value });
        }
      }
      operation?.succeed();
      if (!matches.length) { await dialog('見つかりませんでした'); return; }
      matches.sort((a, b) => a.page - b.page);
      const current = (scene()?.getIndex() || 0) + 1;
      const match = matches.find(item => item.page > current) || matches[0];
      if (match.page !== current) await scene().goToIndex(match.page - 1);
      await Promise.all(currentTargets().map(target => target.media._viewerTextReady));
      await onSceneChanged();
      text().selectQuery(query);
    } catch (error) { operation?.fail(error); throw error; }
  }
  const safe = action => () => Promise.resolve().then(action).catch(error => dialog(error.message));
  function menuItems() {
    const items = [{ label: '文書内を検索…', icon: 'search', action: safe(search) },
      { label: '認識範囲を表示', icon: 'scan', action: () => text().toggleBoxes() }];
    const visualTarget = currentTargets()[0];
    if (capability && local() && visualTarget) {
      const selected = window.MeldexViewerHighlights?.getRegion?.() || selectedNativeRegion();
      items.push({ label: 'PDFの画像検索・説明…', icon: 'image', action: safe(() => window.MeldexPdfVisual.open({
        path: visualTarget.item.path, page: scene().isPdf() ? visualTarget.item.pageNum : 1, region: selected, isPdf: scene().isPdf(),
      })) });
    }
    if (!capability?.canRecognize || !local()) return items;
    const hasTarget = currentTargets().length > 0;
    const selectedRegion = window.MeldexViewerHighlights?.getRegion?.() || selectedNativeRegion();
    items.push({ label: 'OCR', icon: 'scanText', items: [
      ...(hasTarget ? [{ label: scene().isPdf() ? 'このページ' : 'この画像', action: safe(() => run('page')) }] : []),
      ...(hasTarget && scene().isPdf() ? [{ label: '文書全体', action: safe(() => run('document')) }] : []),
      ...(hasTarget && scene().isPdf() ? [{ label: 'ページを指定して認識／再開…', action: safe(runPages) }] : []),
      ...(hasTarget ? [{ label: '選択範囲を再認識', action: safe(() => runRegion(selectedRegion, 0)) },
        { label: '選択範囲を左に90度回して再認識', action: safe(() => runRegion(selectedRegion, 90)) },
        { label: '選択範囲を右に90度回して再認識', action: safe(() => runRegion(selectedRegion, 270)) }] : []),
      ...(hasTarget ? [{ label: '再認識', action: safe(() => run('page', true)) }] : []),
      ...(hasTarget && scene().isPdf() ? [{ label: '全体を再認識', action: safe(() => run('document', true)) }] : []),
      ...(hasTarget ? [{ label: '認識結果の比較・文字修正…', action: safe(editText) },
        { label: 'OCR修正を元に戻す', action: safe(() => correctHistory('undo')) },
        { label: 'OCR修正をやり直す', action: safe(() => correctHistory('redo')) }] : []),
      ...(hasTarget && scene().isPdf() && capability.canExport ? [{ label: '検索可能なPDFを別名保存…', action: safe(exportPdf) }] : []),
      { type: 'separator' },
      ...(capability.windows ? [{ label: `${engine === 'windows' ? '● ' : ''}横書き（Windows）`, action: () => { engine = 'windows'; onSceneChanged(); } }] : []),
      { label: `${engine === 'manga' ? '● ' : ''}縦書き・フキダシ`, action: () => { engine = 'manga'; onSceneChanged(); } },
      ...(capability.book ? [{ label: `${engine === 'book' ? '● ' : ''}書籍（NDLOCR-Lite v2）`, action: () => { engine = 'book'; onSceneChanged(); } },
        { label: `${device === 'cpu' ? '● ' : ''}書籍OCRをCPUで処理`, action: () => { device = 'cpu'; } },
        { label: `${device === 'gpu' ? '● ' : ''}書籍OCRをGPUで処理`, action: () => { device = 'gpu'; } }] : []),
      { type: 'separator' },
      ...(capability.canManageModels ? [{ label: 'OCRモデルを取得…', action: safe(install) }] : []),
      ...(capability.canManageModels && (capability[engine === 'book' ? engine : 'manga']?.installed || capability[engine === 'book' ? engine : 'manga']?.downloadedBytes) ? [{ label: 'OCRモデルを削除…', action: safe(remove) }] : []),
    ] });
    return items;
  }
  document.getElementById('btn-ocr')?.addEventListener('click', event => {
    const box = event.currentTarget.getBoundingClientRect();
    window.MeldexContextMenuUI?.openAt({ x: box.left, y: box.top, items: menuItems(), ariaLabel: 'OCR' });
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !event.target.closest('input,textarea,[contenteditable="true"]')) {
      event.preventDefault(); safe(search)();
    }
  });
  window.MeldexViewerOcr = { menuItems, onSceneChanged, run, job, search };
  if (local()) {
    const initialButton = document.getElementById('btn-ocr');
    if (initialButton) { initialButton.hidden = false; initialButton.disabled = true; }
    request('').then(value => {
    capability = value;
    if (!value.windows) engine = 'manga';
    const button = document.getElementById('btn-ocr');
    if (button) { button.hidden = !value.canRecognize; button.disabled = false; }
    onSceneChanged();
    }).catch(() => { if (initialButton) initialButton.hidden = true; });
  }
})();
