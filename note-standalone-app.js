/* note-standalone-app.js
 *
 * 単独版ノートは本体ノートエディタ資産（gb-editor.js / gb-note-enhance.js /
 * gb-format-popup.js / gb-text-selection-format.js / gb-shortcuts.js 等）を
 * そのまま同梱し、このファイルは「本体エディタの初期化 + ファイルI/O差し替え」
 * （MeldexStandaloneFS 経由の開く/保存/新規作成）だけを担当する。
 * 本文の描画・収集（Markdown⇔HTML変換）は本体の mdToHtml / htmlToMd をそのまま使う
 * （旧 note-standalone-markdown.js の独自実装は撤去済み。ルビ・表・コールアウト等の
 * 変換は本体と完全に同一のロジックになるため、往復保存の差分は生まれない）。
 */
(function () {
  'use strict';

  const app = {
    path: '',
    dirty: false,
  };

  function qs(id) { return document.getElementById(id); }
  function editor() { return qs('page-content'); }

  function titleFromPath(path) {
    const name = String(path || '').split('/').pop() || '無題';
    return name.replace(/\.(md|txt)$/i, '') || '無題';
  }

  function noteDir(path) {
    const value = String(path || '');
    const idx = value.lastIndexOf('/');
    return idx >= 0 ? value.slice(0, idx) : '';
  }

  // リンク・画像挿入（ローカルUI操作由来）に使う安全URL検証。
  // 本体の mdToHtml/htmlToMd はファイル内容側の安全性（エスケープ・スキームのホワイト
  // リスト）を担うが、単独版はここに加えて「UI操作で今まさに挿入する値」を検証する。
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

  // Cloudの/file-raw・/media/file 参照（サーバー実体が無いため、Dropbox経由で
  // 取得したデータURLへ差し替える必要がある）を検出する。
  function rawFilePath(value) {
    try {
      const parsed = new URL(String(value || ''), location.href);
      if (parsed.origin !== location.origin) return '';
      if (!/\/(?:api\/)?(?:file-raw|media\/file)$/i.test(parsed.pathname)) return '';
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

  // 本体と同じ抽出方法（openPage()と同一の正規表現）。CRLFにも寛容にしておく。
  function splitFrontMatter(raw) {
    const match = String(raw || '').match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/);
    return match ? match[1] : '';
  }

  async function renderMarkdown(raw) {
    const pc = editor();
    const source = String(raw || '');
    pc.dataset.frontmatter = splitFrontMatter(source);
    pc.innerHTML = typeof mdToHtml === 'function' ? mdToHtml(source) : '';
    await hydrateCloudMedia(pc);
  }

  // 本体の _noteMarkdownFromEditor と同じ変換（htmlToMd + フロントマター復元）を行うが、
  // Cloudでハイドレートした画像src（data URL）をクローン上で元のサーバー参照へ
  // 戻してから変換する（本体には無いCloud単独版固有の手当て。戻さないと保存の
  // たびに巨大なdata URLが本文へ書き込まれてしまう）。
  function collectMarkdown() {
    const pc = editor();
    pc.querySelectorAll('mark.file-search-highlight').forEach(mark => mark.replaceWith(...mark.childNodes));
    pc.normalize();
    const clone = pc.cloneNode(true);
    clone.querySelectorAll('[data-meldex-source-src]').forEach(image => {
      image.setAttribute('src', image.dataset.meldexSourceSrc || '');
      image.removeAttribute('data-meldex-source-src');
    });
    const body = typeof htmlToMd === 'function' ? htmlToMd(clone.innerHTML) : '';
    const fm = pc.dataset.frontmatter || '';
    return fm ? fm + body : body;
  }

  function clearToast() {
    qs('standalone-toast')?.classList.remove('visible');
  }

  function setPath(path, etag) {
    const pc = editor();
    app.path = String(path || '').replace(/\\/g, '/');
    MeldexStandaloneFS.setCurrentPath?.(app.path);
    pc.dataset.path = app.path;
    pc.dataset.lastSavedEtag = etag || '';
    pc.dataset.loadFailed = '';
    state.currentPagePath = app.path;
    state.view = 'page';
    qs('note-title-input').value = titleFromPath(app.path);
    qs('note-path-label').textContent = app.path ? MeldexStandaloneFS.pathLabel(app.path) : '未保存';
    syncOptionPanel().catch(error => console.error('option panel sync failed', error));
  }

  function setDirty(flag) {
    app.dirty = !!flag;
    document.title = (app.dirty ? '* ' : '') + 'Meldex Note';
  }

  // 「公開」（vault全体の公開設定が前提）と「バックリンク」（GbBacklinks未同梱）は
  // 単独版では機能しないため、行き止まりタブとして残さず隠す
  // （計画書§4: バックリンク一覧・自動リンクは対象外）。
  // 本体の _showFileInfoInDetailPanel は _syncDetailPanel からawait無しで
  // 呼ばれ、その中の showDetailPanel() が showNoteTabs(true) 経由でバックリンク
  // タブを非同期に再表示する（file-meta取得完了後、タイミング不定）。一度隠す
  // だけでは間に合わないため、MutationObserverで hidden 属性の変化を監視し、
  // 再表示された瞬間に隠し直す。
  let _hideUnsupportedTabsObserver = null;
  function hideUnsupportedOptionTabs() {
    document.querySelectorAll('.detail-tab-publish, .detail-tab-backlinks').forEach(tab => {
      if (!tab.hidden) tab.hidden = true;
    });
  }
  function watchUnsupportedOptionTabs() {
    const tabBar = qs('detail-tab-bar');
    if (!tabBar || _hideUnsupportedTabsObserver) return;
    _hideUnsupportedTabsObserver = new MutationObserver(hideUnsupportedOptionTabs);
    _hideUnsupportedTabsObserver.observe(tabBar, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  }

  // オプションパネル（「エディタ」= ファイル情報 / 「テーマ」= ファイル別スタイル）を
  // 本体の共通関数へ配線する。type='page' は本体のノート編集と同じ扱いになるため、
  // 書式設定タブ（gb-detail-panel.js の _FS_FIELDS.page）がそのまま使える。
  async function syncOptionPanel() {
    if (typeof _syncDetailPanel !== 'function') return;
    const label = qs('note-title-input')?.value || titleFromPath(app.path);
    await _syncDetailPanel(label, app.path, 'page', {});
    watchUnsupportedOptionTabs();
    hideUnsupportedOptionTabs();
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
    clearToast();
    await renderMarkdown('');
    setPath('', '');
    qs('note-title-input').value = '無題';
    setDirty(false);
    editor().focus();
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
    clearToast();
    const selected = await MeldexStandaloneFS.openFile();
    if (selected?.path) await openPath(selected.path);
  }

  async function saveNote() {
    clearToast();
    const md = collectMarkdown();
    if (!app.path) {
      await saveNoteAs();
      return;
    }
    showLoading('ノートを保存しています...');
    try {
      const res = await MeldexStandaloneFS.writeText(app.path, md, { if_match_etag: editor().dataset.lastSavedEtag || '', skip_if_missing: true });
      if (res?.skipped || res?.missing) {
        showStatus('保存先が見つかりません。名前を付けて保存してください', true);
        await saveNoteAs();
        return;
      }
      editor().dataset.lastSavedEtag = res?.etag || '';
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

  // リンク挿入。メニュークリック（savedRange無し・現在の選択範囲を使う）と、
  // gb-shortcuts.js の Ctrl+K ハンドラ（window.showLinkInsertModal 経由・
  // savedRangeあり）の両方から共有する。安全なスキームだけ許可する検証は
  // ここに一本化し、キーボード経路でも menuと同じ安全性を確保する。
  function insertLinkAtSelection(savedRange) {
    const restoreRange = (range) => {
      if (!range) return;
      try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch { /* 復元できない場合は現在の選択のまま続行 */ }
    };
    restoreRange(savedRange);
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
    restoreRange(savedRange);
    editor().focus();
    document.execCommand('insertHTML', false, `<a href="${esc(safeTarget)}" rel="noopener noreferrer">${esc(label)}</a>`);
    setDirty(true);
  }

  function insertLink() {
    insertLinkAtSelection(null);
  }

  function toggleVertical() {
    if (typeof toggleNoteVertical === 'function') {
      toggleNoteVertical();
    } else {
      editor().classList.toggle('vertical-writing');
    }
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
      insertHtml(`<div class="embed-media" contenteditable="false" data-path="${esc(res.path)}" data-name="${esc(file.name)}" data-type="image"><img src="${esc(displayUrl)}"${sourceAttr} alt="${esc(file.name)}"></div><div><br></div>`);
    } else {
      insertHtml(`<a href="${esc(raw)}">${esc(file.name || res.path)}</a> `);
    }
  }

  function bindEditor() {
    const pc = editor();
    pc.addEventListener('input', () => setDirty(true));
    pc.addEventListener('paste', async event => {
      const files = [...(event.clipboardData?.files || [])];
      const image = files.find(file => (file.type || '').startsWith('image/'));
      if (!image) return;
      event.preventDefault();
      await insertFile(image);
    });
    pc.addEventListener('dragover', event => {
      if ([...(event.dataTransfer?.types || [])].includes('Files')) {
        event.preventDefault();
      }
    });
    pc.addEventListener('drop', async event => {
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      event.preventDefault();
      for (const file of files) await insertFile(file);
    });
    pc.addEventListener('click', async event => {
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
  }

  function bindPathChanges() {
    window.addEventListener('meldex:file-path-renamed', event => {
      const oldPath = String(event?.detail?.oldPath || '').replace(/\\/g, '/');
      const newPath = String(event?.detail?.newPath || '').replace(/\\/g, '/');
      if (oldPath && newPath && app.path === oldPath) setPath(newPath, editor().dataset.lastSavedEtag || '');
    });
  }

  // #page-rt-toolbar は本体の mousedown ハンドラ（gb-editor.js）が既に選択範囲の
  // 保持/復元を面倒みるため、ここではボタンごとの本体コマンド呼び出しだけ配線する。
  function bindToolbar() {
    const toolbar = qs('page-rt-toolbar');
    toolbar.addEventListener('click', event => {
      const rtBtn = event.target.closest('[data-note-rt-cmd]');
      if (rtBtn) {
        const [cmd, value] = String(rtBtn.dataset.noteRtCmd || '').split(':');
        if (typeof rtCmd === 'function') rtCmd(cmd, value);
        return;
      }
      if (event.target.closest('#btn-toc-toggle')) {
        if (typeof toggleNoteToc === 'function') toggleNoteToc();
        return;
      }
      if (event.target.closest('#btn-note-vertical')) {
        toggleVertical();
        return;
      }
      if (event.target.closest('#btn-heading-indent')) {
        if (typeof toggleHeadingIndent === 'function') toggleHeadingIndent();
        return;
      }
      if (event.target.closest('#note-rt-callout')) {
        if (typeof insertCallout === 'function') insertCallout();
        return;
      }
      if (event.target.closest('#note-rt-table')) {
        if (typeof insertNoteTable === 'function') insertNoteTable();
        return;
      }
      if (event.target.closest('#note-rt-search')) {
        if (typeof openFileSearch === 'function') openFileSearch('replace');
      }
    });
    qs('note-rt-heading').addEventListener('change', event => {
      if (typeof rtHeading === 'function') rtHeading(event.target.value);
      event.target.value = '';
    });
  }

  // スマホ幅（≤820px）で優先操作だけを常時表示し、残りを「その他」ボトムシートへ畳む
  // （計画書: standalone-mobile-toolbar_plan_2026-07-20.md §4）。
  function initMobileToolbar() {
    window.MeldexStandaloneMobileToolbar?.setup({
      toolbar: '#page-rt-toolbar',
      priority: ['#btn-toc-toggle', '[data-note-rt-cmd="undo"]', '[data-note-rt-cmd="redo"]', '[data-note-rt-cmd="bold"]', '#note-rt-search'],
      sheetTitle: 'その他',
    });
  }

  function bindFileSearchBar() {
    qs('fsb-prev')?.addEventListener('click', () => window.doFileSearch?.(-1));
    qs('fsb-next')?.addEventListener('click', () => window.doFileSearch?.(1));
    qs('fsb-replace-one')?.addEventListener('click', () => window.doFileReplace?.(false));
    qs('fsb-replace-all')?.addEventListener('click', () => window.doFileReplace?.(true));
    qs('fsb-close')?.addEventListener('click', () => window.closeFileSearch?.());
  }

  async function exportMarkdownFile() {
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveText !== 'function') {
      showStatus('保存ダイアログを初期化できませんでした', true);
      return;
    }
    const title = qs('note-title-input').value.trim() || titleFromPath(app.path);
    await MeldexExportSave.saveText(collectMarkdown(), {
      title,
      extension: '.md',
      dialogTitle: 'Markdownとして保存',
      filetypes: [['Markdownファイル', '*.md'], ['すべてのファイル', '*.*']],
      bom: true,
      okMessage: 'Markdown として保存しました',
      errorMessage: 'Markdown の保存に失敗しました',
    });
  }

  async function exportPngFile() {
    if (typeof MeldexExportImage === 'undefined') {
      showStatus('PNG出力エンジンを読み込めませんでした', true);
      return;
    }
    await MeldexExportImage.exportCurrentView('page');
  }

  async function copyMarkdownToClipboard() {
    const md = collectMarkdown();
    if (!navigator.clipboard?.writeText) {
      showStatus('クリップボードにアクセスできませんでした', true);
      return;
    }
    await navigator.clipboard.writeText(md);
    showStatus('マークダウンをコピーしました');
  }

  function bindMenus() {
    attachStandaloneMenu(qs('note-menu-button'), qs('note-menu'));
    const context = qs('note-context-menu');
    function hideContext(restoreFocus) {
      context.classList.remove('open');
      context.setAttribute('aria-hidden', 'true');
      if (restoreFocus) {
        try { editor().focus({ preventScroll: true }); } catch { editor().focus(); }
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
      if (action === 'exportMarkdown') await window.runStandaloneFileAction('Markdown出力', exportMarkdownFile);
      if (action === 'exportPng') await window.runStandaloneFileAction('PNG出力', exportPngFile);
      if (action === 'copyMarkdown') await window.runStandaloneFileAction('Markdownコピー', copyMarkdownToClipboard);
      if (fromContext) hideContext(false);
    });
    document.addEventListener('click', event => {
      const command = event.target.closest('[data-note-command]')?.dataset.noteCommand;
      if (!command) return;
      try { editor().focus({ preventScroll: true }); } catch { editor().focus(); }
      document.execCommand(command);
      if (event.target.closest('#note-context-menu')) hideContext(false);
    });
    editor().addEventListener('contextmenu', showContext);
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
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
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

  // gb-shortcuts.js の note.link ハンドラ（Ctrl+K）は、単独版では未同梱の
  // showLinkInsertModal（本体のCtrl+K内部リンク検索。要判断#4により対象外のまま）
  // が無い場合、無検証の window.prompt にフォールバックする。ここで安全な実装を
  // 用意して差し替え、キーボード経路でもメニューと同じURL検証を確保する。
  function initLinkModalBridge() {
    window.showLinkInsertModal = function (savedRange) {
      insertLinkAtSelection(savedRange || null);
    };
  }

  // 本体の共有関数 _syncDetailPanel（gb-detail-panel.js）は、#rp-detail が
  // パネルシステム（.gb-pane-content）配下に無い場合、旧・独立詳細パネル向けの
  // localStorage フラグ detail-panel-cfg.visible を見て早期returnする。単独版の
  // オプションパネルの開閉は standalone-option-panel.js が別のキーで管理して
  // いるため、この旧フラグは単独版では常にtrueに固定し、_syncDetailPanel が
  // 実際にタブへ描画できるようにする（立てないと「テーマ」等のタブが常に
  // 空のまま表示されない）。
  function ensureDetailPanelCfgVisible() {
    try {
      const cfg = JSON.parse(localStorage.getItem('detail-panel-cfg') || '{}');
      if (cfg.visible !== true) {
        cfg.visible = true;
        localStorage.setItem('detail-panel-cfg', JSON.stringify(cfg));
      }
    } catch {
      localStorage.setItem('detail-panel-cfg', JSON.stringify({ visible: true }));
    }
  }

  function initOptionPanel() {
    ensureDetailPanelCfgVisible();
    window.MeldexStandaloneOptionPanel?.init({
      storagePrefix: 'meldex-note',
      toggleButtonIds: ['note-option-panel-button'],
      defaultWidth: 360,
    });
  }

  function bindUi() {
    initLinkModalBridge();
    initOptionPanel();
    bindMenus();
    bindShortcuts();
    bindEditor();
    bindToolbar();
    initMobileToolbar();
    bindFileSearchBar();
    bindPathChanges();
  }

  async function initializeData() {
    await MeldexStandaloneFS.init();
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
    window.MeldexStandaloneBoot = window.MeldexStandaloneBootstrap.create({
      appId: 'note',
      bindUi,
      initialize: initializeData,
      onError: error => showStatus('ノートの保存先へ接続できません: ' + (error.message || error) + '。操作すると再試行します。', true),
    });
    window.MeldexStandaloneBoot.start().catch(() => {});
  });
})();
