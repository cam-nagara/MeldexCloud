/* Bounded, lazy page list. The viewer's document and media nodes stay mounted. */
(function () {
  'use strict';
  const Scene = window.MeldexViewerScene;
  const prefs = window.MeldexViewerPageState;
  const pane = document.getElementById('viewer-pages');
  const toggle = document.getElementById('btn-page-list');
  const scroll = document.getElementById('viewer-pages-scroll');
  const rowsHost = document.getElementById('viewer-pages-rows');
  const mode = document.getElementById('viewer-pages-mode');
  const first = document.getElementById('viewer-pages-first');
  const grip = document.getElementById('viewer-pages-resize');
  const status = document.getElementById('viewer-pages-status');
  const folderStatus = document.getElementById('viewer-pages-load-status');
  const narrow = () => document.documentElement.dataset.toolbarDensity !== 'desktop' && matchMedia('(max-width: 820px)').matches;
  const rowHeight = 152;
  let identity = '', source = null, signature = '', groups = [], indexRows = [];
  let visible = false, width = 200, frame = 0, version = 0, rendering = false;
  let documentRef = null;
  let extraEntries = [], folderEntries = [], folderRequest = null;
  async function loadFolder() {
    if (!visible || !Scene.canListFolder() || folderRequest) return;
    const requestIdentity = identity;
    folderRequest = { identity };
    try {
      const entries = await window.MeldexViewerSceneUtils.fetchJsonChecked('/api/browse?path=' + encodeURIComponent(Scene.getFolderPath()) + '&all_files=true');
      if (requestIdentity !== identity) return;
      folderEntries = entries.filter(entry => entry.type !== 'folder' && !entry.is_dir);
      signature = ''; sync();
    } catch (_) {
      if (requestIdentity === identity) {
        folderStatus.textContent = 'ファイル一覧を読み込めませんでした。';
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '再試行';
        retry.onclick = () => { folderStatus.replaceChildren(); folderRequest = null; loadFolder(); };
        folderStatus.appendChild(retry);
      }
    }
  }
  const cache = new Map(); // At most 64 small previews; never full-size PDF pages.
  function save(patch) {
    const ok = Scene.savePageSettings(patch);
    status.textContent = ok ? '' : '表示設定を保存できませんでした。もう一度操作してください';
  }
  function layout() {
    pane.hidden = !visible;
    toggle.setAttribute('aria-expanded', String(visible));
    document.body.style.setProperty('--viewer-page-list-width', width + 'px');
    document.body.classList.toggle('viewer-pages-open', visible);
    grip.setAttribute('aria-valuenow', String(width));
    // viewer-resize observes the actual display size once, after layout.
  }
  function setVisible(value) {
    visible = value;
    save({ visible });
    layout();
    if (visible) sync(true);
    else toggle.focus({ preventScroll: true });
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; draw(); });
  }
  function sync(reveal = false) {
    const nextIdentity = Scene.preferenceIdentity();
    if (identity !== nextIdentity) {
      identity = nextIdentity;
      const saved = prefs.read(identity);
      visible = saved.visible === true;
      width = Number.isFinite(saved.width) ? Math.max(160, Math.min(480, saved.width)) : 200;
      scroll.scrollTop = 0;
      extraEntries = []; folderEntries = []; folderRequest = null;
      folderStatus.replaceChildren(); status.replaceChildren();
      layout();
      reveal = true;
    }
    mode.value = Scene.getMode();
    first.value = Scene.getFirstSide();
    first.disabled = mode.value === 'single';
    const items = Scene.getItems();
    const names = new Set(items.map(item => item.name));
    extraEntries = folderEntries.filter(entry => !names.has(entry.name));
    const nextSignature = mode.value + ':' + first.value + ':' + Scene.getIndex() + ':' + items.map(item => item.w + 'x' + item.h).join(',') + ':' + extraEntries.length;
    if (source !== items || signature !== nextSignature) {
      source = items; signature = nextSignature;
      groups = []; indexRows = [];
      for (let i = 0; i < items.length;) {
        let group = Scene.getGroup(i);
        if (i < Scene.getIndex() && group.includes(Scene.getIndex())) group = group.filter(n => n < Scene.getIndex());
        if (!group.length) break;
        group.forEach(n => { indexRows[n] = groups.length; });
        groups.push(group);
        i += group.length;
      }
      extraEntries.forEach((_, i) => groups.push([items.length + i]));
      // Keep complete spread groups together while sorting all folder files naturally.
      if (!Scene.isPdf()) {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        groups.sort((a, b) => collator.compare((items[a[0]] || extraEntries[a[0] - items.length]).name, (items[b[0]] || extraEntries[b[0] - items.length]).name));
        groups.forEach((group, row) => group.forEach(n => { if (n < items.length) indexRows[n] = row; }));
      }
      rowsHost.style.height = groups.length * rowHeight + 'px';
      version++;
    }
    if (documentRef !== Scene.getPdfDocument()) {
      documentRef = Scene.getPdfDocument(); cache.clear(); version++;
    }
    if (visible) {
      const top = (indexRows[Scene.getIndex()] || 0) * rowHeight;
      if (reveal || top < scroll.scrollTop || top + rowHeight > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = top;
      schedule();
      loadFolder();
    }
  }
  function makeCell(index) {
    const item = source[index] || extraEntries[index - source.length];
    const extra = index >= source.length;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'note-toc-item viewer-page-item';
    button.dataset.index = index;
    const current = Scene.getGroup(Scene.getIndex()).includes(index);
    button.setAttribute('aria-current', current ? 'page' : 'false');
    const label = Scene.isPdf() ? 'ページ ' + (index + 1) : item.name || item.path;
    button.title = label; button.setAttribute('aria-label', label);
    const preview = document.createElement('span'); preview.className = 'viewer-page-preview';
    if (Scene.isPdf()) {
      const cached = cache.get(index);
      if (cached) preview.appendChild(cached);
      else { preview.textContent = 'PDF'; button.dataset.pending = 'true'; }
    } else if (!extra && item.type === 'image') {
      const image = document.createElement('img'); image.loading = 'lazy'; image.alt = '';
      const thumbnail = window.MeldexStandaloneNative || /^(?:blob:|data:)/i.test(item.path || '') ? item.url
        : '/api/thumbnail?path=' + encodeURIComponent(item.path) + '&size=160';
      Promise.resolve(window.MeldexPwaFileUrl?.ensureDisplayUrl?.(thumbnail)).then(info => {
        if (image.isConnected) image.src = info?.url || thumbnail;
      }).catch(() => { if (image.isConnected) preview.textContent = '画像'; });
      image.onerror = () => { preview.textContent = '画像'; };
      preview.appendChild(image);
    } else preview.textContent = item.type === 'video' ? '▶ 動画' : item.type === 'audio' ? '♪ 音声' : /\.pdf$/i.test(item.name) ? 'PDF' : 'ファイル';
    const text = document.createElement('span'); text.className = 'viewer-page-label'; text.textContent = label;
    button.append(preview, text);
    button.onclick = async () => {
      Scene.pause();
      if (!extra) Scene.goToIndex(groups[indexRows[index]]?.[0] ?? index);
      else if (/\.pdf$/i.test(item.name)) await Scene.reopenWithUrl('viewer.html?pdf=' + encodeURIComponent(item.path));
      else if (window.parent !== window && window.parent.GBSubPanel && window.parent.GBLinkRouter) {
        window.parent.GBSubPanel.open(window.parent.GBLinkRouter.resolve(item.path, { label: item.name }));
      } else if (window.MeldexStandaloneNative) {
        try {
          await window.MeldexStandaloneNative.loadFeature('integration');
          await window.MeldexStandaloneParity.openTarget({ path: item.path, type: item.type }, 'main', { expectedRoot: Scene.currentRootPath() });
        } catch (error) { Scene.flashStatus('ファイルを開けませんでした: ' + error.message); }
      } else Scene.flashStatus('この形式はMeldex本体の対応アプリで開いてください');
      if (narrow()) setVisible(false);
    };
    return button;
  }
  function draw() {
    if (!visible || !source) return;
    const begin = Math.max(0, Math.floor(scroll.scrollTop / rowHeight) - 1);
    const end = Math.min(groups.length, begin + Math.ceil(scroll.clientHeight / rowHeight) + 3);
    const fragment = document.createDocumentFragment();
    for (let i = begin; i < end; i++) {
      const row = document.createElement('div'); row.className = 'viewer-page-row'; row.style.top = i * rowHeight + 'px';
      const group = groups[i];
      const order = mode.value === 'manga' ? [...group].reverse() : group;
      if (mode.value !== 'single') {
        row.classList.add('viewer-page-spread');
        if (group.length === 1 && group[0] < source.length) row.dataset.firstSide = group[0] === 0 ? first.value : (mode.value === 'manga' ? 'right' : 'left');
      }
      order.forEach(n => row.appendChild(makeCell(n)));
      fragment.appendChild(row);
    }
    rowsHost.replaceChildren(fragment);
    pump();
  }
  async function pump() {
    if (rendering || !visible || !documentRef) return;
    rendering = true;
    try {
      while (visible) {
        const cell = rowsHost.querySelector('[data-pending="true"]');
        if (!cell) break;
        cell.dataset.pending = 'working';
        const index = Number(cell.dataset.index), stamp = version, doc = documentRef;
        try {
          const page = await doc.getPage(index + 1);
          if (stamp !== version || !visible || !cell.isConnected) continue;
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(108 / natural.width, 108 / natural.height) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          if (stamp !== version || !visible) continue;
          cache.set(index, canvas);
          if (cache.size > 64) cache.delete(cache.keys().next().value);
          if (cell.isConnected) cell.querySelector('.viewer-page-preview').replaceChildren(canvas);
          else schedule();
        } catch (_) {
          if (cell.isConnected) {
            const preview = cell.querySelector('.viewer-page-preview');
            preview.textContent = '再試行';
            preview.onclick = e => { e.stopPropagation(); cell.dataset.pending = 'true'; pump(); };
          }
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally { rendering = false; }
  }
  toggle.onclick = () => setVisible(!visible);
  toggle.addEventListener('mousedown', e => e.preventDefault());
  document.getElementById('viewer-pages-close').onclick = () => setVisible(false);
  mode.onchange = () => { Scene.setMode(mode.value); sync(true); };
  first.onchange = () => { Scene.setFirstSide(first.value); sync(true); };
  scroll.addEventListener('scroll', schedule, { passive: true });
  pane.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); setVisible(false); } });
  function resize(value, persist) {
    width = Math.max(160, Math.min(480, value)); layout();
    if (persist) save({ width });
  }
  grip.onpointerdown = e => {
    if (narrow()) return;
    grip.setPointerCapture(e.pointerId);
    const start = e.clientX, initial = width;
    grip.onpointermove = event => resize(initial + event.clientX - start, false);
    grip.onpointerup = grip.onpointercancel = () => { grip.onpointermove = null; save({ width }); };
  };
  grip.onkeydown = e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation(); resize(width + (e.key === 'ArrowLeft' ? -16 : 16), true);
    }
  };
  new ResizeObserver(schedule).observe(scroll);
  window.addEventListener('viewer-page-state', () => sync());
  window.addEventListener('viewer-page-settings-save', e => {
    status.textContent = e.detail.ok ? '' : '表示設定を保存できませんでした。もう一度操作してください';
  });
  window.addEventListener('resize', layout);
  Scene.ready.then(() => sync(true));
})();
