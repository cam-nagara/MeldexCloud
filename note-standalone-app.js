/* note-standalone-app.js */
(function () {
  'use strict';

  const app = {
    path: '',
    dirty: false,
    etag: '',
    frontMatter: '',
  };

  function qs(id) { return document.getElementById(id); }

  function titleFromPath(path) {
    const name = String(path || '').split('/').pop() || '無題';
    return name.replace(/\.(md|txt)$/i, '') || '無題';
  }

  function noteDir(path) {
    const value = String(path || '');
    const idx = value.lastIndexOf('/');
    return idx >= 0 ? value.slice(0, idx) : '';
  }

  function safeContentUrl(value, kind) {
    const raw = String(value || '').trim();
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return '';
    const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || '';
    if (!scheme) return raw;
    if (kind === 'image') {
      if (scheme === 'http' || scheme === 'https') return raw;
      if (/^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,/i.test(raw)) return raw;
      return '';
    }
    return ['http', 'https', 'mailto', 'tel'].includes(scheme) ? raw : '';
  }

  function sanitizeEditorContent(root) {
    root.querySelectorAll('script,iframe,object,embed,link,meta,base,style').forEach(el => el.remove());
    root.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if (/^on/i.test(attr.name) || attr.name.toLowerCase() === 'srcdoc') el.removeAttribute(attr.name);
      });
    });
    root.querySelectorAll('a[href]').forEach(link => {
      const safe = safeContentUrl(link.getAttribute('href'), 'link');
      if (safe) {
        link.setAttribute('href', safe);
        link.setAttribute('rel', 'noopener noreferrer');
      } else {
        link.removeAttribute('href');
      }
    });
    root.querySelectorAll('img[src]').forEach(image => {
      const safe = safeContentUrl(image.getAttribute('src'), 'image');
      if (safe) image.setAttribute('src', safe);
      else image.removeAttribute('src');
    });
  }

  function rawFilePath(value) {
    try {
      const parsed = new URL(String(value || ''), location.href);
      if (parsed.origin !== location.origin) return '';
      if (!/\/(?:api\/)?file-raw$/i.test(parsed.pathname)) return '';
      return String(parsed.searchParams.get('path') || '').replace(/\\/g, '/');
    } catch {
      return '';
    }
  }

  async function hydrateCloudMedia(root) {
    if (!document.documentElement.hasAttribute('data-standalone-cloud')) return;
    const readDataUrl = MeldexStandaloneFS.readFileAsDataUrl;
    if (typeof readDataUrl !== 'function') return;
    const images = [...root.querySelectorAll('img[src]')];
    await Promise.all(images.map(async image => {
      const source = image.getAttribute('src') || '';
      const path = rawFilePath(source);
      if (!path) return;
      try {
        const dataUrl = await readDataUrl(path);
        if (!safeContentUrl(dataUrl, 'image')) throw new Error('表示できない画像形式です');
        image.dataset.meldexSourceSrc = source;
        image.src = dataUrl;
      } catch {
        image.removeAttribute('src');
        image.alt = (image.alt || '画像') + '（読み込めません）';
      }
    }));
  }

  function simpleMdToHtml(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    return lines.map(line => {
      if (/^###\s+/.test(line)) return '<h3>' + esc(line.replace(/^###\s+/, '')) + '</h3>';
      if (/^##\s+/.test(line)) return '<h2>' + esc(line.replace(/^##\s+/, '')) + '</h2>';
      if (/^#\s+/.test(line)) return '<h1>' + esc(line.replace(/^#\s+/, '')) + '</h1>';
      const linked = esc(line)
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
      return linked ? '<div>' + linked + '</div>' : '<div><br></div>';
    }).join('');
  }

  function simpleHtmlToMd(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    tmp.querySelectorAll('img').forEach(image => {
      const source = image.dataset.meldexSourceSrc || image.getAttribute('src') || '';
      const safe = safeContentUrl(source, 'image');
      image.replaceWith(document.createTextNode(safe ? `![${image.alt || ''}](${safe})` : (image.alt || '')));
    });
    tmp.querySelectorAll('a').forEach(link => {
      const label = link.textContent || '';
      const safe = safeContentUrl(link.getAttribute('href'), 'link');
      link.replaceWith(document.createTextNode(safe ? `[${label}](${safe})` : label));
    });
    tmp.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    tmp.querySelectorAll('h1,h2,h3,p,div,li').forEach(el => {
      if (el.tagName === 'H1') el.prepend('# ');
      if (el.tagName === 'H2') el.prepend('## ');
      if (el.tagName === 'H3') el.prepend('### ');
      el.append('\n');
    });
    return tmp.textContent.replace(/\n{3,}/g, '\n\n').trimEnd() + (tmp.textContent.trim() ? '\n' : '');
  }

  async function renderMarkdown(md) {
    const codec = window.MeldexStandaloneMarkdown;
    const source = String(md || '');
    const parts = typeof codec?.splitDocument === 'function' ? codec.splitDocument(source) : null;
    app.frontMatter = String(parts?.frontMatter || '');
    const body = parts ? parts.body : source.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const html = codec?.toHtml(source) || (typeof mdToHtml === 'function' ? mdToHtml(body) : simpleMdToHtml(body));
    const editor = qs('page-content');
    editor.innerHTML = html;
    sanitizeEditorContent(editor);
    await hydrateCloudMedia(editor);
  }

  function collectMarkdown() {
    const editor = qs('page-content');
    editor.querySelectorAll('mark.file-search-highlight').forEach(mark => mark.replaceWith(...mark.childNodes));
    editor.normalize();
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('[data-meldex-source-src]').forEach(image => {
      image.setAttribute('src', image.dataset.meldexSourceSrc || '');
      image.removeAttribute('data-meldex-source-src');
    });
    const html = clone.innerHTML || '';
    const codec = window.MeldexStandaloneMarkdown;
    if (typeof codec?.fromHtml === 'function') return codec.fromHtml(html, app.frontMatter);
    return typeof htmlToMd === 'function' ? htmlToMd(html) : simpleHtmlToMd(html);
  }

  function setPath(path, etag) {
    app.path = String(path || '').replace(/\\/g, '/');
    MeldexStandaloneFS.setCurrentPath?.(app.path);
    app.etag = etag || '';
    qs('page-content').dataset.path = app.path;
    state.currentPagePath = app.path;
    qs('note-title-input').value = titleFromPath(app.path);
    qs('note-path-label').textContent = app.path ? MeldexStandaloneFS.pathLabel(app.path) : '未保存';
  }

  function setDirty(flag) {
    app.dirty = !!flag;
    document.title = (app.dirty ? '* ' : '') + 'Meldex Note';
  }

  function currentZoom() {
    const value = typeof window._getZoom === 'function' ? Number(window._getZoom()) : 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function fallbackClampFixedElement(el) {
    const margin = 4;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    el.style.left = Math.min(Math.max(margin, rect.left), maxLeft) + 'px';
    el.style.top = Math.min(Math.max(margin, rect.top), maxTop) + 'px';
  }

  function placeFixedElement(el, left, top) {
    const zoom = currentZoom();
    el.style.left = (left / zoom) + 'px';
    el.style.top = (top / zoom) + 'px';
    if (typeof window.clampPopupToViewport === 'function') {
      window.clampPopupToViewport(el);
    } else {
      fallbackClampFixedElement(el);
    }
  }

  async function newNote() {
    if (app.dirty && !(await cfConfirm('未保存の変更を破棄しますか？'))) return;
    await renderMarkdown('');
    setPath('', '');
    qs('note-title-input').value = '無題';
    setDirty(false);
    qs('page-content').focus();
  }

  async function openPath(path) {
    if (!path) return;
    showLoading('ノートを読み込んでいます...');
    try {
      const data = await MeldexStandaloneFS.readText(path);
      await renderMarkdown(data.content);
      setPath(path, data.etag);
      setDirty(false);
      showStatus('ノートを読み込みました');
    } catch (error) {
      if (MeldexStandaloneFS.currentPath?.() !== path) {
        await MeldexStandaloneFS.releaseEditLock?.(path);
        MeldexStandaloneFS.discardRememberedPath?.(path);
      }
      throw error;
    } finally {
      hideLoading();
    }
  }

  async function openNote() {
    if (app.dirty && !(await cfConfirm('未保存の変更を破棄して開きますか？'))) {
      MeldexStandaloneFS.discardQueuedOpen?.();
      return;
    }
    const selected = await MeldexStandaloneFS.openFile();
    if (selected?.path) await openPath(selected.path);
  }

  async function saveNote() {
    const md = collectMarkdown();
    if (!app.path) {
      await saveNoteAs();
      return;
    }
    showLoading('ノートを保存しています...');
    try {
      const res = await MeldexStandaloneFS.writeText(app.path, md, { if_match_etag: app.etag, skip_if_missing: true });
      if (res?.skipped || res?.missing) {
        showStatus('保存先が見つかりません。名前を付けて保存してください', true);
        await saveNoteAs();
        return;
      }
      app.etag = res?.etag || '';
      setDirty(false);
      showStatus('保存しました');
    } finally {
      hideLoading();
    }
  }

  async function saveNoteAs() {
    const md = collectMarkdown();
    const title = qs('note-title-input').value.trim() || titleFromPath(app.path);
    const suggested = MeldexStandaloneFS.suggestedName(app.path, title + MeldexStandaloneFS.defaultExtension());
    const saved = await MeldexStandaloneFS.saveAs(md, suggested);
    if (!saved?.path) return;
    setPath(saved.path, '');
    setDirty(false);
    showStatus('保存しました');
  }

  function insertLink() {
    const sel = window.getSelection();
    const selected = sel && sel.rangeCount ? String(sel.toString() || '') : '';
    const target = window.prompt('リンク先', '');
    if (!target) return;
    const safeTarget = safeContentUrl(target, 'link');
    if (!safeTarget) {
      showStatus('安全でないリンク先は挿入できません', true);
      return;
    }
    const label = selected || window.prompt('表示名', target) || target;
    document.execCommand('insertHTML', false, `<a href="${esc(safeTarget)}" rel="noopener noreferrer">${esc(label)}</a>`);
    setDirty(true);
  }

  function toggleVertical() {
    qs('page-content').classList.toggle('vertical-writing');
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(String(event.target?.result || ''));
      reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めませんでした'));
      reader.readAsDataURL(file);
    });
  }

  function insertHtml(html) {
    document.execCommand('insertHTML', false, html);
    setDirty(true);
  }

  async function insertFile(file) {
    if (!app.path) {
      showStatus('画像を貼り付ける前にノートを保存してください', true);
      return;
    }
    const dir = noteDir(app.path);
    const payload = await fileToDataUrl(file);
    const res = await apiPost('/upload-file?path=' + encodeURIComponent(dir), { data: payload, filename: file.name || 'file' });
    if (!res?.path) return;
    const raw = '/api/file-raw?path=' + encodeURIComponent(res.path);
    if ((file.type || '').startsWith('image/')) {
      let displayUrl = raw;
      if (document.documentElement.hasAttribute('data-standalone-cloud') && typeof MeldexStandaloneFS.readFileAsDataUrl === 'function') {
        displayUrl = await MeldexStandaloneFS.readFileAsDataUrl(res.path);
      }
      if (!safeContentUrl(displayUrl, 'image')) throw new Error('表示できない画像形式です');
      const sourceAttr = displayUrl === raw ? '' : ` data-meldex-source-src="${esc(raw)}"`;
      insertHtml(`<div class="embed-media" contenteditable="false" data-path="${esc(res.path)}" data-name="${esc(file.name)}"><img src="${esc(displayUrl)}"${sourceAttr} alt="${esc(file.name)}"></div><div><br></div>`);
    } else {
      insertHtml(`<a href="${esc(raw)}">${esc(file.name || res.path)}</a> `);
    }
  }

  function bindEditor() {
    const editor = qs('page-content');
    editor.addEventListener('input', () => setDirty(true));
    editor.addEventListener('paste', async event => {
      const files = [...(event.clipboardData?.files || [])];
      const image = files.find(file => (file.type || '').startsWith('image/'));
      if (!image) return;
      event.preventDefault();
      await insertFile(image);
    });
    editor.addEventListener('dragover', event => {
      if ([...(event.dataTransfer?.types || [])].includes('Files')) {
        event.preventDefault();
      }
    });
    editor.addEventListener('drop', async event => {
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      event.preventDefault();
      for (const file of files) await insertFile(file);
    });
    editor.addEventListener('click', async event => {
      const link = event.target.closest?.('a[href]');
      const path = rawFilePath(link?.getAttribute('href'));
      if (!path || !document.documentElement.hasAttribute('data-standalone-cloud')) return;
      event.preventDefault();
      try {
        const dataUrl = await MeldexStandaloneFS.readFileAsDataUrl(path);
        const download = document.createElement('a');
        download.href = dataUrl;
        download.download = path.split('/').pop() || 'file';
        download.click();
      } catch (error) {
        showStatus('添付ファイルを開けません: ' + (error.message || error), true);
      }
    });
    editor.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        insertLink();
      }
    });
  }

  function bindPathChanges() {
    window.addEventListener('meldex:file-path-renamed', event => {
      const oldPath = String(event?.detail?.oldPath || '').replace(/\\/g, '/');
      const newPath = String(event?.detail?.newPath || '').replace(/\\/g, '/');
      if (oldPath && newPath && app.path === oldPath) setPath(newPath, app.etag);
    });
  }

  function bindMediaControls() {
    const controls = qs('media-float-controls');
    const resizeHandle = qs('media-resize-handle');
    let active = null;
    let suppressedMedia = null;
    function hide(options = {}) {
      if (options.suppressUntilLeave && active) suppressedMedia = active;
      controls.classList.remove('visible');
      resizeHandle.classList.remove('visible');
      controls.setAttribute('aria-hidden', 'true');
      resizeHandle.setAttribute('aria-hidden', 'true');
      active = null;
    }
    function show(media) {
      active = media;
      const rect = media.getBoundingClientRect();
      controls.classList.add('visible');
      controls.setAttribute('aria-hidden', 'false');
      const width = controls.offsetWidth || 0;
      placeFixedElement(controls, rect.right - width - 6, rect.top + 6);
      resizeHandle.classList.add('visible');
      resizeHandle.setAttribute('aria-hidden', 'false');
      placeFixedElement(resizeHandle, rect.right - 8, rect.bottom - 8);
    }
    document.addEventListener('mouseover', event => {
      const media = event.target.closest?.('.embed-media');
      if (media && media === suppressedMedia) return;
      if (media) show(media);
    });
    document.addEventListener('mouseout', event => {
      if (suppressedMedia && !suppressedMedia.contains(event.relatedTarget)) suppressedMedia = null;
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide({ suppressUntilLeave: true }); }, true);
    controls.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !active) return;
      const align = button.dataset.align;
      if (align) {
        active.style.marginLeft = align === 'left' ? '0' : 'auto';
        active.style.marginRight = align === 'right' ? '0' : 'auto';
        setDirty(true);
      } else if (button.dataset.action === 'delete') {
        active.remove();
        hide();
        setDirty(true);
      }
    });
    resizeHandle.addEventListener('pointerdown', event => {
      if (!active) return;
      event.preventDefault();
      const target = active.querySelector('img,video');
      if (!target) return;
      const startX = event.clientX;
      const startWidth = target.offsetWidth;
      const move = ev => {
        target.style.width = Math.max(60, startWidth + ev.clientX - startX) + 'px';
        target.style.height = 'auto';
        show(active);
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        setDirty(true);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  function bindMenus() {
    attachStandaloneMenu(qs('note-menu-button'), qs('note-menu'));
    const context = qs('note-context-menu');
    function hideContext(restoreFocus) {
      context.classList.remove('open');
      context.setAttribute('aria-hidden', 'true');
      if (restoreFocus) {
        try { qs('page-content').focus({ preventScroll: true }); } catch { qs('page-content').focus(); }
      }
    }
    function showContext(event) {
      event.preventDefault();
      context.classList.add('open');
      context.setAttribute('aria-hidden', 'false');
      placeFixedElement(context, event.clientX, event.clientY);
      const first = context.querySelector('button:not([disabled])');
      try { first?.focus?.({ preventScroll: true }); } catch { first?.focus?.(); }
    }
    document.addEventListener('click', async event => {
      const action = event.target.closest('[data-note-action]')?.dataset.noteAction;
      if (!action) return;
      const fromContext = !!event.target.closest('#note-context-menu');
      if (action === 'new') await window.runStandaloneFileAction('新規作成', newNote);
      if (action === 'open') await window.runStandaloneFileAction('ノートを開くことが', openNote);
      if (action === 'save') await window.runStandaloneFileAction('保存', saveNote);
      if (action === 'saveAs') await window.runStandaloneFileAction('名前を付けて保存', saveNoteAs);
      if (action === 'insertLink') insertLink();
      if (action === 'toggleVertical') toggleVertical();
      if (fromContext) hideContext(false);
    });
    document.addEventListener('click', event => {
      const command = event.target.closest('[data-note-command]')?.dataset.noteCommand;
      if (!command) return;
      try { qs('page-content').focus({ preventScroll: true }); } catch { qs('page-content').focus(); }
      document.execCommand(command);
      if (event.target.closest('#note-context-menu')) hideContext(false);
    });
    qs('page-content').addEventListener('contextmenu', showContext);
    document.addEventListener('pointerdown', event => {
      if (context.classList.contains('open') && !context.contains(event.target)) hideContext(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && context.classList.contains('open')) {
        event.preventDefault();
        hideContext(true);
      }
    });
  }

  function bindShortcuts() {
    document.addEventListener('keydown', async event => {
      const key = event.key.toLowerCase();
      if (!(event.ctrlKey || event.metaKey)) return;
      if (key === 's') {
        event.preventDefault();
        await window.runStandaloneFileAction('保存', saveNote);
      } else if (key === 'o') {
        event.preventDefault();
        await window.runStandaloneFileAction('ノートを開くことが', openNote);
      } else if (key === 'n') {
        event.preventDefault();
        await window.runStandaloneFileAction('新規作成', newNote);
      }
    });
  }

  async function init() {
    await MeldexStandaloneFS.init();
    bindMenus();
    bindShortcuts();
    bindEditor();
    bindPathChanges();
    bindMediaControls();
    const initial = MeldexStandaloneFS.nativeInitialPath();
    if (!initial) await newNote();
    else {
      try { await openPath(initial); }
      catch {
        await newNote();
        showStatus('前回のノートを開けなかったため、新規ノートで起動しました', true);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => showStatus('ノートの初期化に失敗: ' + (error.message || error), true));
  });
})();
