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
  let localDrafts = null;
  let lastEditorRange = null;

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
    if (kind === 'video') {
      if (scheme === 'http' || scheme === 'https') return raw;
      if (/^data:video\/(?:mp4|webm|ogg|quicktime);base64,/i.test(raw)) return raw;
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
    lastEditorRange = null;
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
    window.MeldexStandaloneTags?.setTargetPath?.(app.path);
    syncOptionPanel().catch(error => console.error('option panel sync failed', error));
  }

  function setDirty(flag) {
    app.dirty = !!flag;
    document.title = (app.dirty ? '* ' : '') + 'Meldex Note';
  }

  function currentSavedEtag() {
    return String(editor().dataset.lastSavedEtag || '').trim();
  }

  function requireSavedEtag() {
    const etag = currentSavedEtag();
    if (!etag) {
      throw new Error('現在のファイルの更新情報を確認できないため、上書きを中止しました。名前を付けて保存してください。');
    }
    return etag;
  }

  // オプションパネル（「エディタ」= ファイル情報 / 「テーマ」= ファイル別スタイル）を
  // 本体の共通関数へ配線する。type='page' は本体のノート編集と同じ扱いになるため、
  // 書式設定タブ（gb-detail-panel.js の _FS_FIELDS.page）がそのまま使える。
  async function syncOptionPanel() {
    if (typeof _syncDetailPanel !== 'function') return;
    const label = qs('note-title-input')?.value || titleFromPath(app.path);
    await _syncDetailPanel(label, app.path, 'page', {});
    await window.MeldexStandaloneParity?.syncOptionFeatures?.();
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
    await localDrafts?.discardCurrent?.();
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

  async function canReplaceCurrent() {
    if (app.dirty && !(await cfConfirm('未保存の変更を破棄して開きますか？'))) return false;
    await localDrafts?.discardCurrent?.();
    return true;
  }

  async function openNote() {
    if (app.dirty && !(await cfConfirm('未保存の変更を破棄して開きますか？'))) {
      MeldexStandaloneFS.discardQueuedOpen?.();
      return;
    }
    clearToast();
    const selected = await MeldexStandaloneFS.openFile();
    if (selected?.path) {
      await localDrafts?.discardCurrent?.();
      await openPath(selected.path);
    }
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
      const res = await MeldexStandaloneFS.writeText(app.path, md, {
        if_match_etag: requireSavedEtag(),
        skip_if_missing: true,
      });
      if (res?.skipped || res?.missing) {
        showStatus('保存先が見つかりません。名前を付けて保存してください', true);
        await saveNoteAs();
        return;
      }
      const nextEtag = String(res?.etag || '').trim();
      if (!nextEtag) {
        editor().dataset.lastSavedEtag = '';
        throw new Error('保存後の更新情報を確認できないため、次の上書きを中止しました');
      }
      editor().dataset.lastSavedEtag = nextEtag;
      setDirty(false);
      await localDrafts?.markSynced?.(currentSavedEtag());
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
    if (!saved?.path) return false;
    const savedEtag = String(saved.etag || '').trim();
    setPath(saved.path, savedEtag);
    if (!savedEtag) {
      throw new Error('保存結果の更新情報を確認できないため、次の上書きを中止しました。もう一度名前を付けて保存してください。');
    }
    await localDrafts?.markSynced?.(savedEtag);
    setDirty(false);
    showStatus('保存しました');
    return true;
  }

  // リンク挿入。メニュークリック（savedRange無し・現在の選択範囲を使う）と、
  // gb-shortcuts.js の Ctrl+K ハンドラ（window.showLinkInsertModal 経由・
  // savedRangeあり）の両方から共有する。安全なスキームだけ許可する検証は
  // ここに一本化し、キーボード経路でも menuと同じ安全性を確保する。
  function cloneEditorRange() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const common = range.commonAncestorContainer;
    const container = common?.nodeType === Node.ELEMENT_NODE ? common : common?.parentElement;
    if (!container || !editor().contains(container)) return null;
    return range.cloneRange();
  }

  function insertLinkAtSelection(savedRange) {
    const stableRange = savedRange || lastEditorRange?.cloneRange?.() || cloneEditorRange();
    if (window.MeldexStandaloneParity?.showLinkDialog) {
      window.MeldexStandaloneParity.showLinkDialog(stableRange || null, insertLinkResult);
      return;
    }
    insertLinkResult(null, stableRange || null);
  }

  function insertLinkResult(result, savedRange) {
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
    const target = result?.type === 'file' ? result.path
      : result?.type === 'url' ? result.url
        : window.prompt('リンク先', '');
    if (!target) return;
    const safeTarget = safeContentUrl(target, 'link');
    if (!safeTarget) {
      showStatus('安全でないリンク先は挿入できません', true);
      return;
    }
    const label = selected || result?.name || window.prompt('表示名', target) || target;
    restoreRange(savedRange);
    editor().focus();
    document.execCommand('insertHTML', false, `<a href="${esc(safeTarget)}" rel="noopener noreferrer">${esc(label)}</a>`);
    setDirty(true);
  }

  function insertLink() {
    insertLinkAtSelection(null);
  }

  function toggleVertical() {
    if (typeof MeldexNoteWritingMode !== 'undefined') {
      MeldexNoteWritingMode.toggle();
    } else if (typeof toggleNoteVertical === 'function') {
      toggleNoteVertical();
    } else {
      editor().classList.toggle('vertical-writing');
    }
  }

  // 本体アプリと同じく、前回の組方向を起動時に復元する（単独アプリには復元処理が無かった）
  function restoreWritingMode() {
    if (typeof MeldexNoteWritingMode === 'undefined') return;
    MeldexNoteWritingMode.restoreFromStorage();
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
    const isImage = (file.type || '').startsWith('image/');
    const isVideo = (file.type || '').startsWith('video/');
    if (isImage || isVideo) {
      let displayUrl = raw;
      if (document.documentElement.hasAttribute('data-standalone-cloud') && typeof MeldexStandaloneFS.readFileAsDataUrl === 'function') {
        displayUrl = await MeldexStandaloneFS.readFileAsDataUrl(res.path);
      }
      if (!safeContentUrl(displayUrl, isVideo ? 'video' : 'image')) throw new Error(isVideo ? '表示できない動画形式です' : '表示できない画像形式です');
      const sourceAttr = displayUrl === raw ? '' : ` data-meldex-source-src="${esc(raw)}"`;
      const inner = isVideo
        ? `<video src="${esc(displayUrl)}"${sourceAttr} controls></video>`
        : `<img src="${esc(displayUrl)}"${sourceAttr} alt="${esc(file.name)}">`;
      insertHtml(`<div class="embed-media" contenteditable="false" data-path="${esc(res.path)}" data-name="${esc(file.name)}" data-type="${isVideo ? 'video' : 'image'}" data-media-init="1">${inner}</div><div><br></div>`);
      // 本体アプリと同じ初期サイズ（正方形に収めた一辺が本文幅の約6割まで／拡大はしない）を与える
      editor().querySelectorAll('.embed-media[data-media-init]').forEach((media) => {
        delete media.dataset.mediaInit;
        if (typeof _applyInitialEmbeddedMediaSize === 'function') _applyInitialEmbeddedMediaSize(editor(), media);
      });
    } else {
      insertHtml(`<a href="${esc(raw)}">${esc(file.name || res.path)}</a> `);
    }
  }

  function bindEditor() {
    const pc = editor();
    pc.addEventListener('input', () => setDirty(true));
    pc.addEventListener('paste', async event => {
      const files = [...(event.clipboardData?.files || [])];
      const media = files.find(file => (file.type || '').startsWith('image/') || (file.type || '').startsWith('video/'));
      if (!media) return;
      event.preventDefault();
      await insertFile(media);
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
    // 旧ネイティブ select（#note-rt-heading）は #page-rt-heading-btn
    // （gb-note-toolbar-block-select.js の data-action 委譲）へ置き換え済み。
    // ここでの change リスナーは不要（本体 Meldex-dev.html と同じ構成）。
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

  async function exportDocxFile() {
    if (typeof MeldexDocxExport === 'undefined' || typeof MeldexDocxExport.create !== 'function'
      || typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveBlob !== 'function') {
      showStatus('Word書き出しを初期化できませんでした', true);
      return;
    }
    const title = qs('note-title-input').value.trim() || titleFromPath(app.path);
    // 縦書き表示のときは書き出したWordも縦書きにする
    const vertical = !!window.MeldexNoteWritingMode?.isVertical?.(editor());
    const blob = MeldexDocxExport.create(title, collectMarkdown(), { vertical });
    await MeldexExportSave.saveBlob(blob, {
      title,
      extension: '.docx',
      dialogTitle: 'Word（DOCX）として保存',
      filetypes: [['Word文書', '*.docx'], ['すべてのファイル', '*.*']],
      okMessage: 'Word文書として保存しました',
      errorMessage: 'Word文書の保存に失敗しました',
    });
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
      lastEditorRange = cloneEditorRange() || lastEditorRange;
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
      if (action === 'workspace') window.MeldexStandaloneWorkspaceTree?.open?.();
      if (action === 'insertLink') insertLink();
      if (action === 'toggleVertical') toggleVertical();
      if (action === 'exportMarkdown') await window.runStandaloneFileAction('Markdown出力', exportMarkdownFile);
      if (action === 'exportPng') await window.runStandaloneFileAction('PNG出力', exportPngFile);
      if (action === 'exportDocx') await window.runStandaloneFileAction('Word出力', exportDocxFile);
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
    document.addEventListener('selectionchange', () => {
      const range = cloneEditorRange();
      if (range) lastEditorRange = range;
    });
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

  async function initLocalDrafts() {
    if (!window.MeldexStandaloneLocalDrafts) return;
    localDrafts = window.MeldexStandaloneLocalDrafts.create({
      appId: 'note',
      getPath: () => app.path,
      getRevision: () => editor().dataset.lastSavedEtag || '',
      capture: () => ({
        title: qs('note-title-input')?.value || '無題',
        content: collectMarkdown(),
      }),
      restore: async snapshot => {
        await renderMarkdown(snapshot?.content || '');
        qs('note-title-input').value = snapshot?.title || titleFromPath(app.path);
        setDirty(true);
      },
      sync: async (snapshot, record) => {
        const baselineEtag = String(record.baseRevision || '').trim();
        if (!baselineEtag) {
          throw new Error('更新情報がないため、下書きの上書きを中止しました');
        }
        const result = await MeldexStandaloneFS.writeText(record.remotePath, snapshot.content || '', {
          if_match_etag: baselineEtag,
          skip_if_missing: true,
        });
        if (result?.missing || result?.skipped || result?.queued) {
          throw new Error(result?.queued ? '接続後に再試行します' : '保存先が見つかりません');
        }
        const nextEtag = String(result?.etag || '').trim();
        if (!nextEtag) {
          editor().dataset.lastSavedEtag = '';
          throw new Error('保存後の更新情報を確認できないため、下書きの上書きを中止しました');
        }
        editor().dataset.lastSavedEtag = nextEtag;
        setDirty(false);
      },
      onStatus: (status, message) => {
        const label = qs('note-sync-status');
        if (label && ['waiting', 'local-saving', 'local-saved', 'saving', 'final-saving', 'pending', 'syncing', 'synced', 'conflict', 'error'].includes(status)) {
          label.textContent = message;
          label.dataset.status = status;
        }
      },
    });
    localDrafts.start();
    window.MeldexStandaloneCloseGuard?.register?.({
      appId: 'note',
      saveAs: saveNoteAs,
      prepareClose: () => {
        document.activeElement?.blur?.();
        return true;
      },
    });
    await localDrafts.restoreLatest();
    localDrafts.flush();
  }

  // gb-shortcuts.js の note.link ハンドラ（Ctrl+K）を、メニューと同じ検索可能な
  // 単独版共通リンクダイアログへ接続する。
  function initLinkModalBridge() {
    window.showLinkInsertModal = function (savedRange, callback) {
      if (window.MeldexStandaloneParity?.showLinkDialog) {
        window.MeldexStandaloneParity.showLinkDialog(savedRange || null, callback || insertLinkResult);
        return;
      }
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
    // 単独アプリはメインパネルのアプリが固定なので、ショートカット一覧の初期絞り込みを宣言する
    window.__meldexAppShortcutScope = 'note';
    window.MeldexStandaloneOptionPanel?.init({
      storagePrefix: 'meldex-note',
      toggleButtonIds: ['note-option-panel-button'],
      defaultWidth: 360,
    });
  }

  function initParityAdapter() {
    window.MeldexStandaloneParity?.init?.({
      appId: 'note',
      getPath: () => app.path,
      getLabel: () => qs('note-title-input')?.value || titleFromPath(app.path),
      openCurrent: openPath,
      canReplaceCurrent,
    });
  }

  function bindUi() {
    initOptionPanel();
    initParityAdapter();
    initLinkModalBridge();
    bindMenus();
    bindShortcuts();
    bindEditor();
    bindToolbar();
    initMobileToolbar();
    bindFileSearchBar();
    bindPathChanges();
    restoreWritingMode();
  }

  async function initializeData() {
    await MeldexStandaloneFS.init();
    const requested = new URLSearchParams(location.search).get('open') || '';
    const initial = requested || MeldexStandaloneFS.nativeInitialPath();
    if (!initial) await newNote();
    else {
      try { await openPath(initial); }
      catch {
        await newNote();
        showStatus('前回のノートを開けなかったため、新規ノートで起動しました', true);
      }
    }
    await initLocalDrafts();
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
