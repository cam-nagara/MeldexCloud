/* Local PDF figures: existing modal/progress/model UI, no external provider. */
(function () {
  'use strict';
  const scene = () => window.MeldexViewerScene;
  const local = () => !window.MeldexRuntimeAdapter?.isDropboxMode?.() && !window.MeldexRuntimeAdapter?.isBrowserDataMode?.()
    && !window.MeldexViewerCloudFileOpen?.isCloudViewer?.() && document.documentElement.dataset.standaloneCloud !== 'viewer'
    && !new URLSearchParams(location.search).has('localFiles');
  const normalized = path => String(path || '').replaceAll('\\', '/').toLocaleLowerCase();
  const sameSource = (s, row) => s?.isPdf?.() && [row.path, row.source_path].filter(Boolean).some(p => normalized(p) === normalized(s.getPdfPath()));
  function progress() {
    try { return window.parent.MeldexOperationProgress || window.MeldexOperationProgress; }
    catch (_) { return window.MeldexOperationProgress; }
  }
  async function request(path, body) {
    const response = await fetch('/api/viewer-visual' + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(typeof value.detail === 'string' ? value.detail : '画像検索を利用できません');
    return value;
  }
  function run(body, label, onComplete, quiet = false) {
    return progress().runRemoteJob({ endpoint: '/api/viewer-visual', body, label, quiet,
      kind: body.action === 'install' ? 'download' : 'viewer-ocr', ownerFrame: window.frameElement, ownerDocument: document,
      onComplete });
  }
  function button(text, action, name) {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'gb-btn'; node.textContent = text;
    if (name) node.dataset.visualAction = name;
    node.addEventListener('click', action); return node;
  }
  function select(label, choices) {
    const wrapper = document.createElement('label'); wrapper.textContent = label + ' ';
    const input = document.createElement('select'); input.className = 'gb-select'; input.setAttribute('aria-label', label);
    input.style.maxWidth = '100%';
    for (const [value, text] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); }
    wrapper.append(input); return { wrapper, input };
  }
  function checkbox(text) {
    const wrapper = document.createElement('label'); wrapper.style.cssText = 'display:flex;align-items:center;gap:var(--ui-space-2);white-space:normal';
    const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('aria-label', text); input.checked = false;
    wrapper.append(input, document.createTextNode(text)); return { wrapper, input };
  }
  async function thumbnail(image, row, urls) {
    try {
      const response = await fetch('/api/viewer-visual/thumbnail?key=' + encodeURIComponent(row.thumbnail_key));
      if (!response.ok) throw new Error('画像を読み込めませんでした');
      const blob = await response.blob();
      if (!image.isConnected) return;
      const url = URL.createObjectURL(blob); urls.push(url); image.src = url;
    } catch (_) { image.alt = '読み込みに失敗しました'; }
  }

  async function reveal(row) {
    const s = scene();
    if (!s || !sameSource(s, row)) return false;
    const page = Number(row.page);
    if (!Number.isInteger(page) || page < 1 || page > (s.getPdfDocument()?.numPages || 0)) throw new Error('指定したページがありません');
    const box = row.box;
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) || box.some(n => n < 0) || !box[2] || !box[3]) throw new Error('画像領域の位置を確認してください');
    if (s.getIndex() !== page - 1) await s.goToIndex(page - 1);
    const deadline = performance.now() + 15000;
    let canvas;
    do {
      canvas = [...document.querySelectorAll('.layer.show canvas.page-canvas')].find(c => c._viewerPageNum === page);
      if (canvas) break;
      if (performance.now() > deadline) throw new Error('対象ページを読み込めませんでした');
      await new Promise(requestAnimationFrame);
    } while (true);
    await canvas._viewerTextReady;
    const pdfPage = await s.getPdfDocument().getPage(page), viewport = pdfPage.getViewport({ scale: 1 });
    if (box[0] + box[2] > viewport.width + 1 || box[1] + box[3] > viewport.height + 1) throw new Error('画像領域がページをはみ出しています');
    document.querySelectorAll('[data-visual-highlight]').forEach(node => node.remove());
    const wrap = canvas.parentElement;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    const highlight = document.createElement('div'); highlight.dataset.visualHighlight = '';
    highlight.setAttribute('aria-label', '検索した画像領域');
    highlight.style.cssText = 'position:absolute;pointer-events:none;outline:3px solid var(--accent);background:color-mix(in srgb,var(--accent) 15%,transparent);z-index:6';
    Object.assign(highlight.style, { left: box[0] / viewport.width * 100 + '%', top: box[1] / viewport.height * 100 + '%',
      width: box[2] / viewport.width * 100 + '%', height: box[3] / viewport.height * 100 + '%' });
    wrap.append(highlight); highlight.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  async function openResult(row) {
    if (!row?.page || !row?.box) return false;
    if (row.type === 'image' || !/\.pdf$/i.test(row.source_path || row.path)) {
      const s = scene(), item = s?.getItems?.()[s.getIndex()];
      if (s && [row.path, row.source_path].some(p => p && normalized(p) === normalized(item?.path))) return true;
      if (scene() && parent !== window) return parent.MeldexPdfVisual.openResult(row);
      if (typeof window.openMedia === 'function') { await window.openMedia(row.name, row.path, 'image'); return true; }
      if (s && window.MeldexStandaloneNative) { await s.reopenWithUrl('/viewer.html?file=' + encodeURIComponent(row.path)); return true; }
      throw new Error('画像を開けませんでした');
    }
    if (sameSource(scene(), row)) return reveal(row);
    if (scene() && window.MeldexStandaloneNative) {
      await scene().reopenWithUrl('/viewer.html?pdf=' + encodeURIComponent(row.path));
      return reveal(row);
    }
    if (scene() && parent !== window) {
      try { return parent.MeldexPdfVisual.openResult(row); } catch (_) { return false; }
    }
    const frame = document.getElementById('html-iframe');
    try {
      if (sameSource(frame?.contentWindow?.MeldexViewerScene, row)) return frame.contentWindow.MeldexPdfVisual.reveal(row);
    } catch (_) {}
    const params = new URLSearchParams({ pdf: row.source_path || row.path, visualPage: String(row.page), visualBox: JSON.stringify(row.box) });
    if (typeof window.openViewer === 'function') { await window.openViewer('/viewer?' + params.toString()); return true; }
    throw new Error('ビューワーを開けませんでした');
  }

  async function open(options = {}) {
    if (!local()) return;
    const capability = await request('');
    const isFolder = !!options.folder, path = options.folder || options.path;
    if (!path) throw new Error('先にPDFまたはフォルダを開いてください');
    let closed = false, urls = [], resultGeneration = 0;
    const heading = document.createElement('p'); heading.textContent = String(path); heading.style.overflowWrap = 'anywhere';
    const notice = document.createElement('p'); notice.className = 'gb-section-desc';
    notice.textContent = '認識はこのPC内で行います。原本は変更しません。画像の説明はAIの推定で、OCR原文と区別します。';
    const error = document.createElement('p'); error.className = 'gb-section-desc'; error.setAttribute('role', 'alert');
    const controls = document.createElement('div'); controls.style.cssText = 'display:flex;flex-direction:column;gap:var(--ui-space-3)';
    const models = capability.models.filter(m => m.kind === 'embedding');
    const model = select('画像検索モデル', models.map(m => [m.id, m.title])); model.input.value = capability.defaultModel || 'clip';
    const device = select('処理装置', [['cpu', 'CPU'], ['gpu', 'GPU（明示選択）']]);
    const captions = checkbox('索引作成と一緒に画像の説明を生成する（既定はオフ）');
    const group = checkbox('書籍ごとにまとめる');
    const mode = select('検索方法', [['all', '説明・原文と画像の内容'], ['text', '説明・タグ・OCR原文'], ['meaning', '画像の内容（意味検索）']]);
    const query = document.createElement('input'); query.className = 'gb-input'; query.setAttribute('aria-label', '画像を探す言葉'); query.placeholder = '螺旋階段、逆光、俯瞰構図…';
    const pages = document.createElement('input'); pages.className = 'gb-input'; pages.setAttribute('aria-label', '索引を作成するページ'); pages.placeholder = '例：1-3, 8';
    const entries = document.createElement('div'); entries.dataset.visualResults = '';
    const safe = action => async () => { error.textContent = ''; try { await action(); } catch (e) { if (!closed) error.textContent = e.message; } };
    const currentPage = () => options.page || (scene()?.getIndex() || 0) + 1;
    const body = action => ({ action, model: model.input.value, device: device.input.value, path, page: currentPage() });
    let modal;

    async function edit(row) {
      const old = row.caption || { description: '', tags: [] };
      let current = row, saved = false;
      const description = document.createElement('textarea'); description.className = 'gb-input'; description.rows = 6; description.value = old.description || ''; description.setAttribute('aria-label', '画像の説明'); description.style.width = '100%';
      const tags = document.createElement('input'); tags.className = 'gb-input'; tags.value = (old.tags || []).join('、'); tags.setAttribute('aria-label', '画像のタグ'); tags.style.width = '100%';
      const fields = [['objects','物体'],['people','人物'],['pose','姿勢'],['action','動作'],['expression','表情'],['place','場所'],['composition','構図'],['light','光'],['diagram','図の内容'],['uncertainty','推定・不明な点']];
      const extras = fields.map(([key,label]) => {
        const wrapper = document.createElement('label'); wrapper.textContent = label;
        const input = document.createElement('textarea'); input.className = 'gb-input'; input.rows = 2; input.style.width = '100%'; input.setAttribute('aria-label', label);
        input.value = Array.isArray(old[key]) ? old[key].join('、') : old[key] || ''; wrapper.append(input); return {key,input,wrapper};
      });
      const split = value => value.split(/[、,\n]/).map(v => v.trim()).filter(Boolean);
      const collect = () => ({...old, description: description.value, tags: split(tags.value),
        ...Object.fromEntries(extras.map(({key,input}) => [key, ['objects','people'].includes(key) ? split(input.value) : input.value]))});
      const initial = JSON.stringify(collect());
      const original = document.createElement('p'); original.className = 'gb-section-desc'; original.style.whiteSpace = 'pre-wrap'; original.textContent = 'OCR原文：\n' + (row.ocr || '文字情報はありません');
      const detail = document.createElement('p'); detail.className = 'gb-section-desc'; detail.textContent = 'AIの推定です。固有名詞・構図・表情などは原本で確認してください。' + (old.uncertainty || '');
      const failure = document.createElement('p'); failure.setAttribute('role', 'alert');
      const dirty = () => JSON.stringify(collect()) !== initial;
      const cancel = button('キャンセル', () => editor.close('cancel'));
      const save = button('保存', async () => {
        save.disabled = true; failure.textContent = '';
        const caption = collect(), snapshot = JSON.stringify(caption);
        const generation = ++resultGeneration;
        try {
          const result = await run({ ...body('edit'), key: current.key, expectedRevision: current.revision, caption }, '画像の説明を保存', value => {
            current = value;
            if (JSON.stringify(collect()) === snapshot) { saved = true; editor.close('saved'); }
            if (!closed) void refresh(generation);
          });
          if (!result) { save.disabled = false; failure.textContent = '保存できませんでした。入力は残っています。進行状況を確認して再試行してください。'; }
        } catch (e) { save.disabled = false; failure.textContent = '保存できませんでした。' + e.message + '。入力は残っています。再試行してください。'; }
      }, 'caption-save');
      const editor = window.GBUI.createModal({ title: '画像の説明（AIの推定）', body: [detail, description, tags, ...extras.map(f => f.wrapper), original, failure], footer: [cancel, save],
        extraClass: 'meldex-visual-manager',
        initialFocus: () => description, closeOnEsc: true, closeOnOverlay: false,
        onBeforeClose: () => saved || !dirty() || window.MeldexLocalModelUI.confirm('未保存の説明の変更を破棄しますか？', '変更の破棄') });
      editor.open();
    }

    function render(result) {
      if (closed) return;
      entries.replaceChildren(); urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
      for (const row of result?.results || []) {
        const card = document.createElement('section'); card.className = 'gb-section'; card.style.cssText = 'margin-bottom:var(--ui-space-3);overflow-wrap:anywhere';
        card.dataset.visualResult = row.visual_id;
        card.dataset.visualRevision = row.revision;
        const title = document.createElement('h3'); title.textContent = `${row.name} · ${row.page}ページ${row.kind === 'page' ? '（全体）' : '（領域）'}`;
        const image = document.createElement('img'); image.alt = '画像領域のサムネイル'; image.style.cssText = 'max-width:100%;max-height:160px;object-fit:contain';
        card.append(title, image); void thumbnail(image, row, urls);
        const summary = document.createElement('p'); summary.style.whiteSpace = 'pre-wrap'; summary.textContent = row.caption
          ? '画像の説明（AIの推定）' + (row.reviewed ? '・確認済み' : '・未確認') + '：\n' + row.caption.description + '\nタグ：' + (row.caption.tags || []).join('、')
          : '画像の説明は未生成です。'; card.append(summary);
        if (row.caption) {
          const details = document.createElement('details'), heading = document.createElement('summary'); heading.textContent = '物体・人物・構図・推定の詳細'; details.append(heading);
          for (const [key,label] of [['objects','物体'],['people','人物'],['pose','姿勢'],['action','動作'],['expression','表情'],['place','場所'],['composition','構図'],['light','光'],['diagram','図の内容'],['uncertainty','推定・不明']]) {
            const text = row.caption[key]; if (!text || !text.length) continue;
            const value = document.createElement('p'); value.textContent = label + '：' + (Array.isArray(text) ? text.join('、') : text); details.append(value);
          }
          card.append(details);
        }
        if (row.score != null) { const score = document.createElement('p'); score.className = 'gb-section-desc'; score.textContent = '類似度：' + Number(row.score).toFixed(3); card.append(score); }
        if (row.region_total) { const count = document.createElement('p'); count.textContent = '一致する領域：' + row.region_total + '件'; card.append(count); }
        const original = document.createElement('p'); original.className = 'gb-section-desc'; original.textContent = 'OCR原文：' + (row.ocr || '文字情報はありません'); card.append(original);
        const actions = document.createElement('div'); actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--ui-space-2)';
        actions.append(button('この領域を開く', safe(async () => { modal.close('open-result'); await openResult(row); }), 'reveal'));
        if (capability.canIndex) {
          actions.append(button('説明を生成', safe(async () => {
            if (row.reviewed && !await window.MeldexLocalModelUI.confirm('確認・編集した説明を再生成しますか？取り消して元に戻せます。', '説明の再生成')) return;
            const generation = ++resultGeneration;
            await run({ ...body('caption'), key: row.key, expectedRevision: row.revision }, '画像の説明を生成', () => { if (!closed) void refresh(generation); });
          }), 'caption-generate'));
          actions.append(button('説明を確認・編集', safe(() => edit(row)), 'caption-edit'));
          for (const [action, label] of [['review', '確認済みにする'], ['undo', '説明を元に戻す'], ['redo', '説明をやり直す']]) {
            const actionButton = button(label, safe(() => {
              const generation = ++resultGeneration;
              return run({ ...body(action), key: row.key, expectedRevision: row.revision }, label, () => { if (!closed) void refresh(generation); });
            }), 'caption-' + action);
            actionButton.disabled = action === 'review' ? !row.caption : action === 'undo' ? !row.canUndo : !row.canRedo;
            actions.append(actionButton);
          }
        }
        card.append(actions); entries.append(card);
        for (const child of (row.regions || []).slice(1, 5)) actions.append(button(child.page + 'ページの領域を開く', safe(async () => { modal.close('open-result'); await openResult(child); })));
      }
      if (!entries.childElementCount) { const empty = document.createElement('p'); empty.className = 'gb-section-desc'; empty.textContent = '索引・検索結果はありません。モデルと索引を確認してください。'; entries.append(empty); }
    }
    async function refresh(expected) {
      if (closed || isFolder || (expected !== undefined && expected !== resultGeneration)) return;
      const generation = ++resultGeneration;
      const accept = result => { if (generation === resultGeneration) render(result); };
      const result = await run({ ...body('read'), scope: 'page' }, '', accept, true);
      if (result) accept(result);
    }
    async function search() {
      if (!query.value.trim()) return;
      const generation = ++resultGeneration;
      await run({ ...body('search'), query: query.value, mode: mode.input.value, folder: path,
        groupBooks: group.input.checked }, 'PDFの画像を検索', result => { if (generation === resultGeneration) render(result); });
    }
    async function index(scope, force = false, chosenPages = null) {
      const generation = ++resultGeneration;
      await run({ ...body('index'), scope, force, pages: chosenPages, captions: captions.input.checked,
        ...(scope === 'region' ? { region: options.region.box, regionSpace: 'fraction' } : {}) }, 'PDFの画像索引を作成', result => {
        if (!closed && generation === resultGeneration) { error.textContent = `${result.processed}ページを作成、${result.skipped}ページを再利用しました。`; void refresh(generation); }
      });
    }
    const indexing = document.createElement('div'); indexing.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--ui-space-2)';
    if (capability.canIndex) {
      if (isFolder) indexing.append(button('このフォルダの索引を作成／再開', safe(() => index('folder')), 'index-folder'));
      else {
        indexing.append(button('このページの索引を作成', safe(() => index('page')), 'index-page'));
        indexing.append(button('文書全体の索引を作成／再開', safe(() => index('document')), 'index-document'));
        const regionButton = button('選択範囲の索引を追加', safe(() => index('region')), 'index-region'); regionButton.disabled = !options.region || !options.isPdf; indexing.append(regionButton);
        indexing.append(button('文書全体の索引を作り直す', safe(() => index('document', true)), 'index-force'));
        controls.append(pages);
        indexing.append(button('指定ページの索引を作成／再開', safe(() => {
          const chosen = new Set();
          for (const part of pages.value.split(',')) {
            const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/), first = Number(match?.[1]), last = Number(match?.[2] || match?.[1]);
            if (!match || first < 1 || last < first || last > (scene()?.getPdfDocument()?.numPages || 1)) throw new Error('ページ指定を確認してください');
            for (let n = first; n <= last; n++) { chosen.add(n); if (chosen.size > 10000) throw new Error('ページが多すぎます'); }
          }
          return index('pages', false, [...chosen]);
        }), 'index-pages'));
      }
    }
    const manage = document.createElement('div'); manage.style.cssText = 'display:flex;flex-wrap:wrap;gap:var(--ui-space-2)';
    const managedModel = select('取得・削除するモデル', capability.models.map(m => [m.id, m.title]));
    const modelStatus = document.createElement('p'); modelStatus.className = 'gb-section-desc'; modelStatus.dataset.modelStatus = '';
    const updateModelStatus = async () => {
      const latest = await request('');
      const item = latest.models.find(m => m.id === managedModel.input.value);
      modelStatus.textContent = `${item.title}：${item.installed ? '取得済み' : '未取得です。利用するには「モデルを取得…」からダウンロードしてください。'}\n${item.bytes.toLocaleString('ja-JP')} バイト（${(item.bytes / 1048576).toFixed(1)} MiB）／ライセンス：${item.license}`;
    };
    managedModel.input.addEventListener('change', () => void safe(updateModelStatus)());
    model.input.addEventListener('change', () => { managedModel.input.value = model.input.value; void safe(updateModelStatus)(); });
    captions.input.addEventListener('change', () => { if (captions.input.checked) { managedModel.input.value = 'qwen3vl'; void safe(updateModelStatus)(); } });
    if (capability.canManageModels) {
      manage.append(managedModel.wrapper, modelStatus, button('モデルを取得…', safe(async () => {
        const latest = await request(''), item = latest.models.find(m => m.id === managedModel.input.value);
        if (!await window.MeldexLocalModelUI.confirmInstall({ description: item.title + '\nライセンス：' + item.license + '（商用利用可。表示等の再配布条件を確認してください）。追加ソフトは承認後に別途導入します。', bytes: item.bytes })) return;
        await run({ action: 'install', model: item.id }, '画像認識モデルの取得', () => { if (!closed) void safe(updateModelStatus)(); });
      }), 'model-install'), button('モデルを削除…', safe(async () => {
        if (!await window.MeldexLocalModelUI.confirm('Meldexで取得したモデルを削除しますか？索引・編集した説明・原本は残ります。', 'モデルの削除')) return;
        await run({ action: 'remove', model: managedModel.input.value }, '画像認識モデルの削除', () => { if (!closed) void safe(updateModelStatus)(); });
      }), 'model-remove'));
    }
    managedModel.input.value = model.input.value;
    await updateModelStatus();
    controls.append(model.wrapper, device.wrapper, captions.wrapper, indexing, query, mode.wrapper, group.wrapper,
      button('検索', safe(search), 'search'), button('このページの索引・説明を表示', safe(refresh), 'read'), manage);
    query.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void safe(search)(); } });
    const close = button('閉じる', () => modal.close('close'));
    modal = window.GBUI.createModal({ title: 'PDFの画像検索・説明', body: [heading, notice, controls, error, entries], footer: [close],
      extraClass: 'meldex-visual-manager',
      initialFocus: () => query, closeOnEsc: true, closeOnOverlay: true, onClose: () => { closed = true; urls.forEach(url => URL.revokeObjectURL(url)); } });
    modal.open(); await safe(refresh)();
  }
  window.MeldexPdfVisual = { open, openFolder: folder => open({ folder }), openResult, reveal, thumbnail };
  function initialReveal() {
    const params = new URLSearchParams(location.search), page = Number(params.get('visualPage'));
    if (!page || !params.has('visualBox')) return;
    let box; try { box = JSON.parse(params.get('visualBox')); } catch (_) { return; }
    scene()?.ready?.then(() => reveal({ path: scene().getPdfPath(), page, box })).catch(error => scene()?.flashStatus(error.message));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialReveal, { once: true });
  else initialReveal();
})();
