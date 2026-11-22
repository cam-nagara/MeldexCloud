/* Local OCR menu and shared progress tray integration. */
(function () {
  'use strict';
  let capability = null;
  let engine = 'windows';
  let sceneGeneration = 0;
  const scene = () => window.MeldexViewerScene;
  const text = () => window.MeldexViewerTextLayer;
  const local = () => !window.MeldexViewerCloudFileOpen?.isCloudViewer?.()
    && document.documentElement.dataset.standaloneCloud !== 'viewer'
    && !new URLSearchParams(location.search).has('localFiles')
    && !window.MeldexRuntimeAdapter?.isDropboxMode?.()
    && !window.MeldexRuntimeAdapter?.isBrowserDataMode?.();

  function dialog(message, mode = 'message') {
    // Shared modal component, including keyboard/focus and narrow-screen rules.
    return new Promise(resolve => {
      const paragraph = document.createElement('p'); paragraph.textContent = message; paragraph.style.whiteSpace = 'pre-line';
      const input = document.createElement('input'); input.className = 'gb-input'; input.setAttribute('aria-label', '検索する文字');
      const ok = document.createElement('button'); ok.className = 'gb-btn gb-btn-primary'; ok.textContent = mode === 'search' ? '検索' : '決定';
      const cancel = document.createElement('button'); cancel.className = 'gb-btn'; cancel.textContent = 'キャンセル';
      let result = mode === 'search' ? null : false;
      const modal = window.GBUI.createModal({ title: mode === 'search' ? '文書内を検索' : 'OCR',
        body: mode === 'search' ? [paragraph, input] : [paragraph],
        footer: mode === 'message' ? [ok] : [cancel, ok],
        initialFocus: () => mode === 'search' ? input : cancel,
        onClose: () => resolve(result), closeOnEsc: true, closeOnOverlay: true });
      ok.addEventListener('click', () => { result = mode === 'search' ? input.value : true; modal.close('submit'); });
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
  function job(body, label, { quiet = false } = {}) {
    return progress().runRemoteJob({ endpoint: '/api/viewer-ocr', body, label, quiet,
      kind: body.action === 'install' ? 'download' : 'viewer-ocr',
      ownerFrame: window.frameElement, ownerDocument: document,
      onComplete: result => {
        if (body.action === 'ocr') apply(result, body.path, true);
        if (body.action === 'install' || body.action === 'remove') capability = { ...capability, manga: result };
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
      if (recognized && (replace || !target.media.parentElement.querySelector('.viewer-text-layer')?.textContent.trim())) {
        text().ocr(target.media, recognized, path);
      }
    }
    text()?.updateIndicator();
  }
  async function onSceneChanged() {
    const generation = ++sceneGeneration;
    if (!capability || !local()) return;
    for (const target of currentTargets()) {
      const path = target.item.path;
      if (target.media.parentElement.querySelector('.viewer-text-layer')?.textContent.trim()) continue;
      const result = await job({ action: 'read', path, page: scene().isPdf() ? target.item.pageNum : 1, engine }, '', { quiet: true });
      if (generation !== sceneGeneration) return;
      apply(result, path);
    }
  }
  async function run(scope, force = false) {
    const target = currentTargets()[0];
    if (!target) return;
    return job({ action: 'ocr', path: target.item.path, page: scene().isPdf() ? target.item.pageNum : 1,
      scope, force, engine }, 'OCR');
  }
  async function install() {
    const status = await request('');
    const bytes = status.manga.bytes;
    // The exact pinned byte count is shown before the first download request.
    const confirmed = await dialog(`縦書き・フキダシ用モデルを取得しますか？\n${bytes.toLocaleString('ja-JP')} バイト（${(bytes / 1048576).toFixed(1)} MiB）\nComic Text Detector（GPL-3.0）／Manga OCR。途中から再開できます。`, 'confirm');
    if (!confirmed) return;
    await job({ action: 'install', engine: 'manga' }, 'OCRモデルの取得');
  }
  async function remove() {
    if (!await dialog('取得したOCRモデルを削除しますか？認識済みテキストは残ります。', 'confirm')) return;
    await job({ action: 'remove', engine: 'manga' }, 'OCRモデルの削除');
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
          const value = page.lines.map(line => line.text).join('');
          if (value.normalize('NFKC').includes(query.normalize('NFKC')) && !matches.some(match => match.page === page.page)) matches.push({ page: page.page, text: value });
        }
      }
      operation?.succeed();
      if (!matches.length) { await dialog('見つかりませんでした'); return; }
      matches.sort((a, b) => a.page - b.page);
      const current = (scene()?.getIndex() || 0) + 1;
      const match = matches.find(item => item.page > current) || matches[0];
      await scene().goToIndex(match.page - 1);
      await Promise.all(currentTargets().map(target => target.media._viewerTextReady));
      await onSceneChanged();
      text().selectQuery(query);
    } catch (error) { operation?.fail(error); throw error; }
  }
  const safe = action => () => Promise.resolve().then(action).catch(error => dialog(error.message));
  function menuItems() {
    const items = [{ label: '文書内を検索…', icon: 'search', action: safe(search) },
      { label: '認識範囲を表示', icon: 'scan', action: () => text().toggleBoxes() }];
    if (!capability?.canRecognize || !local()) return items;
    const hasTarget = currentTargets().length > 0;
    items.push({ label: 'OCR', icon: 'scanText', items: [
      ...(hasTarget ? [{ label: scene().isPdf() ? 'このページ' : 'この画像', action: safe(() => run('page')) }] : []),
      ...(hasTarget && scene().isPdf() ? [{ label: '文書全体', action: safe(() => run('document')) }] : []),
      ...(hasTarget ? [{ label: '再認識', action: safe(() => run('page', true)) }] : []),
      ...(hasTarget && scene().isPdf() ? [{ label: '全体を再認識', action: safe(() => run('document', true)) }] : []),
      { type: 'separator' },
      ...(capability.windows ? [{ label: `${engine === 'windows' ? '● ' : ''}横書き（Windows）`, action: () => { engine = 'windows'; onSceneChanged(); } }] : []),
      { label: `${engine === 'manga' ? '● ' : ''}縦書き・フキダシ`, action: () => { engine = 'manga'; onSceneChanged(); } },
      { type: 'separator' },
      ...(capability.canManageModels ? [{ label: 'OCRモデルを取得…', action: safe(install) }] : []),
      ...(capability.canManageModels && (capability.manga.installed || capability.manga.downloadedBytes) ? [{ label: 'OCRモデルを削除…', action: safe(remove) }] : []),
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
