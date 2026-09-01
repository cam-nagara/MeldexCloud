(function () {
  'use strict';

  const QUEUE_KEY = 'meldex:quick-memo:queue:v1';
  const CURRENT_KEY = 'meldex:quick-memo:current:v1';
  const CLIENT_ID_KEY = 'meldex:quick-memo:client-id:v1';
  const CLOUD_SHEET_NAME = 'クイックメモ';
  const API_BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8765' : '';
  const els = {};
  const state = {
    dirty: false,
    saving: false,
    speech: null,
    recording: null,
    recordChunks: [],
    saveTimer: 0,
    savePromise: null,
    flushRequested: false,
    share: null,
    currentMode: 'text',
    allTags: [],
    selectedTags: [],
    selectedTagIds: [],
    tagIdsByName: {},
    commonTagColors: {}, // 共通タグ由来の候補: 名前 → 色（#rrggbb、無ければ空文字）。スウォッチ表示用
    tagCatalog: { tags: [], groups: [] },
    defaultPresetTagNames: [], // 既定プリセット（標準）に属するタグ名。候補帯の並び順3段目に使う
    voiceTimerInterval: null,
    voiceStartTime: 0,
    voicePausing: false,
    voiceFinalizePromise: null,
    localSaveFailed: false,
    installPrompt: null,
    textHistory: { canUndo: false, canRedo: false },
    drawingHistory: { canUndo: false, canRedo: false },
    // 右サイドバーの「プロパティ」タブが、いま開いているメモのファイルを知るために使う。
    // 新規メモ（未保存）のときは空文字のまま。
    currentPath: '',
    currentVersionTarget: { path: '', type: 'file' },
  };
  if (typeof window !== 'undefined') {
    window.MeldexQuickMemo = window.MeldexQuickMemo || {};
    window.MeldexQuickMemo.currentPath = () => state.currentPath || '';
    window.MeldexQuickMemo.currentVersionTarget = () => ({ ...state.currentVersionTarget });
    window.MeldexQuickMemo.currentVisibleText = () => `${els.titleInput?.value || ''}\n${els.editor?.innerText || ''}`;
    window.MeldexQuickMemo.reloadCurrentVersion = () => reloadCurrentVersion();
    // Meldex本体のフロートパネル（gb-quick-memo-panel.js）が、閉じる前に
    // 書きかけを保存させるために呼ぶ。単独アプリでも同じ経路を使える。
    window.MeldexQuickMemo.flush = () => saveNow({ manual: true });
  }

  // Meldex本体のフロートパネル等へ埋め込まれている状態。埋め込み時は
  // 本体側のService Workerと同じオリジンになるため、クイックメモ専用の
  // Service Workerを重ねて登録しない。
  function isEmbedded() {
    if (typeof window === 'undefined') return false;
    try {
      if (window.top !== window.self) return true;
    } catch {
      return true;
    }
    return new URLSearchParams(location.search).get('embed') === '1';
  }

  function isDesktopEmbedded() {
    const params = new URLSearchParams(location.search || '');
    return params.get('embed') === '1' && params.get('host') === 'meldex-desktop';
  }
  let editorController = null;
  let drawingController = null;
  let libraryController = null;
  let tagLoadPromise = null;
  const durableMemory = new Map();

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => {
      console.error('quick memo initialization failed', error);
      setStatus('クイックメモを初期化できませんでした: ' + (error?.message || error), true);
    });
  });

  async function init() {
    bindElements();
    applyHostUi();
    const controllerErrors = setupControllers();
    await hydrateDurableRecords();
    restoreDraft();
    applyIncomingShare();
    bindEvents();
    registerCloseContract();
    switchMode(state.currentMode);
    initCloudMode();
    await loadStorageLocation();
    loadTags();
    listenInstallPrompt();
    registerServiceWorker();
    setStatus(controllerErrors.length
      ? '一部の補助機能を読み込めませんでした。基本操作は利用できます'
      : '入力できます');
    await openRequestedMemo();
    document.documentElement.dataset.quickMemoReady = '1';
    controllerErrors.forEach(error => console.error('quick memo controller initialization failed', error));
    setTimeout(flushPendingQueue, 120);
  }

  function bindElements() {
    [
      'syncStatus', 'menuBtn', 'quickMemoMenu', 'listBtn', 'menuListBtn', 'workspaceBtn',
      'installBtn', 'newMemoBtn', 'saveBtn', 'storageLocation',
      'titleInput', 'tagChips', 'addTagBtn', 'tagSelector', 'editor', 'drawingCanvas',
      'modeSelect', 'undoBtn', 'redoBtn', 'colorSwatchBtn', 'colorPopover',
      'colorInput', 'opacityInput', 'opacityValue', 'widthInput', 'penBtn', 'fillBtn', 'eraserBtn', 'clearDrawingBtn',
      'voiceRecordBtn', 'voicePauseBtn', 'voiceResumeBtn', 'voiceStopBtn',
      'voicePanel', 'voiceTimer', 'voiceTranscript', 'voiceStatus',
      'listView', 'listBackBtn', 'listSearch', 'listTagFilter', 'listContent', 'listMoreBtn', 'editorView',
    ].forEach((id) => { els[id] = document.getElementById(id); });
    els.toolbarGroups = document.querySelectorAll('.qm-toolbar-group');
    els.toolbar = document.querySelector('.qm-mode-tools');
  }

  function applyHostUi() {
    if (!isDesktopEmbedded() || !els.saveBtn) return;
    els.saveBtn.hidden = true;
    els.saveBtn.setAttribute('aria-hidden', 'true');
  }

  async function loadStorageLocation() {
    if (!els.storageLocation) return;
    if (isCloudMode()) {
      els.storageLocation.textContent = '保存先: Dropbox / クイックメモ';
      els.storageLocation.title = els.storageLocation.textContent;
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/quick-memo/config`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.detail || '保存先を確認できませんでした');
      const path = String(payload.quick_memo_folder || '').trim();
      els.storageLocation.textContent = path ? `保存先: ${path}` : '保存先: ホームフォルダ / クイックメモ';
      els.storageLocation.title = els.storageLocation.textContent;
    } catch {
      els.storageLocation.textContent = '保存先: ホームフォルダ / クイックメモ';
      els.storageLocation.title = els.storageLocation.textContent;
    }
  }

  function setupControllers() {
    const errors = [];
    try {
      editorController = window.MeldexQuickMemoEditor.create({
        editor: els.editor,
        onChanged() {
          autoFillTitle();
          scheduleSave();
        },
        onHistoryChange(next) {
          state.textHistory = next;
          updateHistoryButtons();
        },
      });
    } catch (error) {
      errors.push(error);
      editorController = {
        setActive() {},
        reset(html) { els.editor.innerHTML = String(html || ''); },
        getHtml() { return els.editor.innerHTML; },
        mutate(action) { action?.(); },
      };
    }
    try {
      drawingController = window.MeldexQuickMemoDrawing.create({
        canvas: els.drawingCanvas,
        swatch: els.colorSwatchBtn,
        popover: els.colorPopover,
        colorInput: els.colorInput,
        opacityInput: els.opacityInput,
        opacityValue: els.opacityValue,
        widthInput: els.widthInput,
        penBtn: els.penBtn,
        fillBtn: els.fillBtn,
        eraserBtn: els.eraserBtn,
        clearBtn: els.clearDrawingBtn,
        onChanged: scheduleSave,
        onStatus: setStatus,
        onHistoryChange(next) {
          state.drawingHistory = next;
          updateHistoryButtons();
        },
      });
    } catch (error) {
      errors.push(error);
      drawingController = { setActive() {}, reset() {}, toDataURL() { return ''; } };
    }
    try {
      libraryController = window.MeldexQuickMemoLibrary.create({
        editorView: els.editorView,
        listView: els.listView,
        content: els.listContent,
        search: els.listSearch,
        tagFilter: els.listTagFilter,
        moreButton: els.listMoreBtn,
        backButton: els.listBackBtn,
        apiBase: API_BASE,
        readQueue: () => readJson(QUEUE_KEY, []),
        isCloudMode,
        cloudConnected,
        onStatus: setStatus,
        beforeNavigate: preserveCurrentForNavigation,
        onOpen: openExistingMemo,
      });
    } catch (error) {
      errors.push(error);
      libraryController = {
        show() { setStatus('メモ一覧を読み込めませんでした', true); },
        hide() {
          els.listView.style.display = 'none';
          els.editorView.style.display = '';
        },
      };
    }
    els.undoBtn.innerHTML = typeof window.lucide === 'function' ? window.lucide('undo2', 19) : '↶';
    els.redoBtn.innerHTML = typeof window.lucide === 'function' ? window.lucide('redo2', 19) : '↷';
    const iconButtons = [
      ['penBtn', 'pencil'], ['fillBtn', 'paintBucket'], ['eraserBtn', 'eraser'],
      ['clearDrawingBtn', 'trash2'], ['voiceRecordBtn', 'mic'], ['voicePauseBtn', 'pause'],
      ['voiceResumeBtn', 'play'], ['voiceStopBtn', 'square'],
    ];
    iconButtons.forEach(([id, name]) => {
      if (els[id] && typeof window.lucide === 'function') els[id].innerHTML = window.lucide(name, 19);
    });
    return errors;
  }

  function bindEvents() {
    const on = (element, type, handler) => element?.addEventListener(type, handler);
    const closeMenu = ({ restoreFocus = false } = {}) => {
      if (!els.quickMemoMenu) return;
      els.quickMemoMenu.hidden = true;
      els.menuBtn?.setAttribute('aria-expanded', 'false');
      if (els.menuBtn?.dataset.menuTitle) {
        els.menuBtn.setAttribute('title', els.menuBtn.dataset.menuTitle);
        delete els.menuBtn.dataset.menuTitle;
      }
      if (restoreFocus) els.menuBtn?.focus?.();
    };
    on(els.menuBtn, 'click', event => {
      event.stopPropagation();
      const open = els.quickMemoMenu?.hidden !== false;
      if (els.quickMemoMenu) els.quickMemoMenu.hidden = !open;
      els.menuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        if (els.menuBtn?.hasAttribute('title')) {
          els.menuBtn.dataset.menuTitle = els.menuBtn.getAttribute('title') || 'メニュー';
          els.menuBtn.removeAttribute('title');
        }
        window.GBTooltip?.hide?.();
        requestAnimationFrame(() => els.quickMemoMenu?.querySelector('button:not([disabled]), input:not([disabled])')?.focus?.());
      }
    });
    on(document, 'click', event => {
      if (!els.quickMemoMenu?.contains(event.target) && !els.menuBtn?.contains(event.target)) closeMenu();
    });
    on(document, 'keydown', event => {
      if (els.quickMemoMenu?.hidden !== false) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu({ restoreFocus: true });
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...els.quickMemoMenu.querySelectorAll('button:not([disabled]), input:not([disabled])')]
        .filter(element => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    on(els.titleInput, 'input', scheduleSave);
    on(els.saveBtn, 'click', () => { closeMenu({ restoreFocus: true }); saveNow({ manual: true }); });
    on(els.newMemoBtn, 'click', () => { closeMenu({ restoreFocus: true }); startNewMemo(); });
    on(els.modeSelect, 'change', () => switchMode(els.modeSelect.value));
    on(els.undoBtn, 'click', () => runHistory('undo'));
    on(els.redoBtn, 'click', () => runHistory('redo'));
    on(els.addTagBtn, 'click', addNewTag);
    on(els.listBtn, 'click', () => libraryController.show());
    on(els.menuListBtn, 'click', () => { closeMenu({ restoreFocus: true }); libraryController.show(); });
    on(els.workspaceBtn, 'click', () => {
      closeMenu({ restoreFocus: true });
      window.MeldexStandaloneWorkspaceTree?.open?.();
    });
    on(els.installBtn, 'click', installToHome);
    on(els.voiceRecordBtn, 'click', startVoiceRecording);
    on(els.voicePauseBtn, 'click', pauseVoiceRecording);
    on(els.voiceResumeBtn, 'click', resumeVoiceRecording);
    on(els.voiceStopBtn, 'click', stopVoiceRecording);
    window.addEventListener('online', flushPendingQueue);
    window.addEventListener('meldex:tag-dictionary-changed', () => loadTags());
    window.addEventListener('beforeunload', () => persistDraft(collectMemo()));
    // フロートパネルのリサイズ（本体埋め込み時）でも横スクロールのフェード表示を
    // 追随させる。iframeの表示領域が変わればcontentWindowのresizeが発火する。
    window.addEventListener('resize', () => _updateTagChipsOverflowHint());
  }

  function switchMode(mode) {
    const speechAvailable = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const nextMode = ['text', 'pen', 'voice'].includes(mode)
      && !(mode === 'voice' && isCloudMode() && !speechAvailable)
      ? mode
      : 'text';
    if (state.currentMode === 'voice' && nextMode !== 'voice') _stopVoiceCapture();
    state.currentMode = nextMode;
    els.modeSelect.value = state.currentMode;
    els.editor.style.display = state.currentMode === 'text' ? '' : 'none';
    els.drawingCanvas.style.display = state.currentMode === 'pen' ? '' : 'none';
    els.voicePanel.style.display = state.currentMode === 'voice' ? '' : 'none';
    let hasToolbarForMode = false;
    els.toolbarGroups.forEach((group) => {
      const shown = group.dataset.for === state.currentMode;
      group.style.display = shown ? '' : 'none';
      if (shown) hasToolbarForMode = true;
    });
    if (els.toolbar) els.toolbar.style.display = hasToolbarForMode ? '' : 'none';
    editorController.setActive(state.currentMode === 'text');
    drawingController.setActive(state.currentMode === 'pen');
    const historyVisible = state.currentMode !== 'voice';
    els.undoBtn.style.display = historyVisible ? '' : 'none';
    els.redoBtn.style.display = historyVisible ? '' : 'none';
    updateHistoryButtons();
    if (state.currentMode === 'text') focusEditorSoon();
  }

  function updateHistoryButtons() {
    const history = state.currentMode === 'pen' ? state.drawingHistory : state.textHistory;
    els.undoBtn.disabled = !history.canUndo;
    els.redoBtn.disabled = !history.canRedo;
  }

  function runHistory(action) {
    const controller = state.currentMode === 'pen' ? drawingController : editorController;
    controller?.[action]?.();
  }

  function autoFillTitle() {
    if (els.titleInput.value.trim()) return;
    const firstLine = els.editor.innerText.trim().split(/\r?\n/)[0] || '';
    els.titleInput.placeholder = firstLine ? firstLine.slice(0, 60) : 'タイトル（空なら本文の一行目）';
  }

  function focusEditorSoon() {
    setTimeout(() => {
      try { els.editor.focus({ preventScroll: true }); } catch { els.editor.focus(); }
    }, 40);
  }

  function clientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : 'memo_' + Date.now().toString(36) + Math.random().toString(16).slice(2));
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }

  function newMemoId(prefix = 'memo') {
    const seed = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(16).slice(2);
    return prefix + '_' + seed.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 48);
  }

  function restoreDraft() {
    const draft = readJson(CURRENT_KEY, null);
    if (!draft) return;
    state.currentPath = String(draft.server_path || '');
    state.currentVersionTarget = {
      path: String(draft.version_path || draft.server_path || ''),
      type: draft.version_type === 'db' ? 'db' : 'file',
    };
    els.titleInput.value = draft.title || '';
    state.selectedTags = Array.isArray(draft.tags) ? [...draft.tags] : parseTags(draft.tags || '');
    state.selectedTagIds = Array.isArray(draft.tag_ids) ? [...draft.tag_ids] : [];
    renderTagChips();
    editorController.reset(sanitizeHtml(draft.html || ''));
    state.share = {
      source_url: draft.source_url || '',
      share_title: draft.share_title || '',
      source_label: draft.source_label || '',
    };
    drawingController.reset(draft.drawing_png || '');
  }

  function collectMemo() {
    const now = new Date().toISOString();
    const draft = readJson(CURRENT_KEY, {});
    const memoId = draft.memo_id || newMemoId();
    const html = sanitizeHtml(editorController.getHtml());
    const memo = mergeMemoDraft(draft, {
      memo_id: memoId,
      client_id: draft.client_id || clientId(),
      server_path: draft.server_path || '',
      title: els.titleInput.value.trim() || (els.editor.innerText.trim().split(/\r?\n/)[0] || '').slice(0, 60),
      tags: [...state.selectedTags],
      tag_ids: [...state.selectedTagIds],
      html,
      text: els.editor.innerText.trim(),
      drawing_png: drawingController.toDataURL(),
      source_url: state.share?.source_url || draft.source_url || '',
      share_title: state.share?.share_title || draft.share_title || '',
      source_label: state.share?.source_label || draft.source_label || '',
      created_at: draft.created_at || now,
      updated_at: now,
      source: (state.share?.source_url || state.share?.share_title || state.share?.source_label) ? 'mobile-share' : 'quick-memo',
    });
    return memo;
  }

  function mergeMemoDraft(draft, currentFields) {
    return {
      ...(draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {}),
      ...(currentFields && typeof currentFields === 'object' ? currentFields : {}),
    };
  }

  if (window.__MELDEX_QUICK_MEMO_TEST__) {
    window.__MELDEX_QUICK_MEMO_TEST__.mergeMemoDraft = mergeMemoDraft;
  }

  function startNewMemo() {
    const current = collectMemo();
    if (draftHasContent(current)) enqueueMemo(current);
    clearTimeout(state.saveTimer);
    _stopVoiceCapture();
    state.share = null;
    state.currentPath = '';
    state.currentVersionTarget = { path: '', type: 'file' };
    els.titleInput.value = '';
    els.titleInput.placeholder = 'タイトル（空なら本文の一行目）';
    state.selectedTags = [];
    state.selectedTagIds = [];
    renderTagChips();
    editorController.reset('');
    resetDrawingCanvas();
    writeJson(CURRENT_KEY, {
      memo_id: newMemoId(),
      client_id: clientId(),
      created_at: new Date().toISOString(),
    });
    state.dirty = false;
    setStatus('新規メモ');
    switchMode('text');
    flushPendingQueue().then((ok) => {
      if (ok) setStatus('新規メモ');
    });
    focusEditorSoon();
  }

  function resetDrawingCanvas() {
    drawingController.reset('');
  }

  function preserveCurrentForNavigation() {
    const current = collectMemo();
    if (!state.dirty && !draftHasContent(current)) return true;
    const stored = persistDraft(current);
    const queued = enqueueMemo(current);
    if (!stored || !queued) throw new Error('メモを端末内へ保存できませんでした');
    state.flushRequested = true;
    drainQueue({ manual: false, pending: true });
    return true;
  }

  async function openExistingMemo(memo) {
    _stopVoiceCapture();
    state.currentPath = String(memo.server_path || memo.path || '');
    state.currentVersionTarget = {
      path: String(memo.version_path || memo.server_path || memo.path || ''),
      type: memo.version_type === 'db' ? 'db' : 'file',
    };
    state.share = {
      source_url: memo.source_url || '',
      share_title: memo.share_title || '',
      source_label: memo.source_label || '',
    };
    els.titleInput.value = memo.title || '';
    state.selectedTags = Array.isArray(memo.tags) ? [...memo.tags] : parseTags(memo.tags || '');
    state.selectedTagIds = Array.isArray(memo.tag_ids) ? [...memo.tag_ids] : [];
    renderTagChips();
    await loadTags();
    editorController.reset(sanitizeHtml(memo.html || escHtml(memo.text || '').replace(/\n/g, '<br>')));
    drawingController.reset(memo.drawing_png || '');
    writeJson(CURRENT_KEY, {
      ...memo,
      memo_id: memo.memo_id || newMemoId(),
      client_id: memo.client_id || clientId(),
      server_path: memo.server_path || memo.path || '',
    });
    state.dirty = false;
    libraryController.hide();
    switchMode('text');
    setStatus('過去のメモを開きました');
  }

  async function openMemoPath(path) {
    const targetPath = String(path || '').trim();
    if (!targetPath) throw new Error('クイックメモの保存先を確認できません');
    let memo;
    if (isCloudMode()) {
      const result = await window.MeldexStandaloneCloud.readText(targetPath);
      memo = libraryController.parseMemoText(result?.content ?? result, targetPath);
    } else {
      const query = new URLSearchParams({ path: targetPath });
      const response = await fetch(`${API_BASE}/api/quick-memo/item?${query}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.detail || 'クイックメモを読み込めませんでした');
      memo = payload.memo || payload;
    }
    await openExistingMemo(memo);
  }

  async function openRequestedMemo() {
    const path = new URLSearchParams(location.search || '').get('open');
    if (!path) return false;
    try {
      await openMemoPath(path);
      return true;
    } catch (error) {
      setStatus('引き継いだクイックメモを開けませんでした: ' + (error?.message || error), true);
      return false;
    }
  }

  async function reloadCurrentVersion() {
    const path = String(state.currentPath || '').trim();
    if (!path) throw new Error('復元したメモの保存先を確認できません');
    await openMemoPath(path);
    setStatus('バージョンを復元しました');
  }

  function applyIncomingShare() {
    const shared = incomingSharePayload();
    if (!shared) return;
    preserveCurrentDraftBeforeShare();
    state.share = {
      source_url: shared.url,
      share_title: shared.title,
      source_label: 'スマホ共有',
    };
    writeJson(CURRENT_KEY, {
      memo_id: newMemoId('share'),
      client_id: clientId(),
      created_at: new Date().toISOString(),
      source_url: state.share.source_url,
      share_title: state.share.share_title,
      source_label: state.share.source_label,
    });
    els.titleInput.value = shared.title || titleFromUrl(shared.url) || '';
    editorController.reset(sharedHtml(shared));
    drawingController.reset('');
    state.selectedTags = ['共有'];
    state.selectedTagIds = [];
    renderTagChips();
    persistDraft(collectMemo());
    scheduleSave();
    clearIncomingShareQuery();
  }

  function incomingSharePayload() {
    const params = new URLSearchParams(location.search || '');
    const title = (params.get('title') || params.get('name') || '').trim();
    const text = (params.get('text') || '').trim();
    const rawUrl = (params.get('url') || params.get('u') || '').trim();
    const url = normalizeSharedUrl(rawUrl || extractFirstUrl(text));
    if (!title && !text && !url) return null;
    return { title, text, url };
  }

  function preserveCurrentDraftBeforeShare() {
    const draft = readJson(CURRENT_KEY, null);
    if (!draft || !draftHasContent(draft)) return;
    enqueueMemo({ ...draft, updated_at: new Date().toISOString() });
  }

  function draftHasContent(draft) {
    return !!(
      String(draft.title || '').trim()
      || String(draft.text || '').trim()
      || String(draft.html || '').replace(/<[^>]+>/g, '').trim()
      || draft.drawing_png
    );
  }

  function sharedHtml(shared) {
    const parts = [];
    if (shared.text) parts.push('<p>' + escHtml(shared.text).replace(/\n/g, '<br>') + '</p>');
    if (shared.url) {
      const safe = escAttr(shared.url);
      parts.push('<p><a href="' + safe + '">' + escHtml(shared.url) + '</a></p>');
    }
    return sanitizeHtml(parts.join(''));
  }

  function normalizeSharedUrl(value) {
    const text = String(value || '').trim();
    return /^https?:\/\/[^\s<>]+$/i.test(text) ? text : '';
  }

  function extractFirstUrl(text) {
    const match = String(text || '').match(/https?:\/\/[^\s<>]+/i);
    return match ? match[0] : '';
  }

  function titleFromUrl(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  function clearIncomingShareQuery() {
    if (!history.replaceState) return;
    try {
      history.replaceState(null, document.title, location.pathname + location.hash);
    } catch {}
  }

  function scheduleSave() {
    state.dirty = true;
    const memo = collectMemo();
    persistDraft(memo);
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveNow({ manual: false }), 900);
    setStatus('保存待ち');
  }

  async function saveNow(opts) {
    clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    const memo = collectMemo();
    const storedDraft = persistDraft(memo);
    const queued = enqueueMemo(memo);
    if (!storedDraft || !queued) {
      state.dirty = true;
      setStatus('保存領域がいっぱいです', true);
      return false;
    }
    state.flushRequested = true;
    return drainQueue(opts);
  }

  function registerCloseContract() {
    const guard = window.MeldexStandaloneCloseGuard;
    if (!guard?.register) return;
    guard.register({
      appId: 'quick-memo',
      hasFinalDestination: () => true,
      getCloseState() {
        const capturing = !!state.recording || !!state.speech || !!state.voiceFinalizePromise;
        const pendingLocal = !!state.saveTimer || state.localSaveFailed;
        return {
          appId: 'quick-memo',
          state: state.localSaveFailed ? 'error'
            : capturing ? 'recording'
              : state.saving ? 'saving'
                : pendingLocal ? 'waiting'
                  : state.dirty ? 'pending'
                    : 'clean',
          pendingLocal,
          saving: state.saving || capturing,
          failed: state.localSaveFailed,
          unnamed: false,
          hasSnapshot: !state.localSaveFailed,
          hasFinalDestination: true,
          shouldWarn: pendingLocal || state.saving || capturing || state.localSaveFailed,
          message: state.localSaveFailed
            ? 'クイックメモを端末へ保存できていません'
            : capturing
              ? '録音または文字起こしを確定しています'
              : pendingLocal || state.saving
                ? 'クイックメモを保存しています'
                : '',
        };
      },
      async prepareClose() {
        clearTimeout(state.saveTimer);
        state.saveTimer = 0;
        if (!await finalizeVoiceForClose()) return false;
        return true;
      },
      async flushLocal() {
        clearTimeout(state.saveTimer);
        state.saveTimer = 0;
        const memo = collectMemo();
        if (!persistDraft(memo) || !enqueueMemo(memo)) {
          state.localSaveFailed = true;
          return false;
        }
        const store = window.MeldexStandaloneLocalDrafts;
        if (!store?.putRaw) {
          state.localSaveFailed = true;
          setStatus('端末下書きの保存機能を利用できません', true);
          return false;
        }
        try {
          await Promise.all([
            store.putRaw(`quick-memo:${CURRENT_KEY}`, memo),
            store.putRaw(`quick-memo:${QUEUE_KEY}`, readJson(QUEUE_KEY, [])),
          ]);
          state.localSaveFailed = false;
          return true;
        } catch (error) {
          state.localSaveFailed = true;
          setStatus('端末への保存に失敗: ' + (error?.message || error), true);
          return false;
        }
      },
      async flushFinal() {
        const localOk = await this.flushLocal();
        if (!localOk) return false;
        await saveNow({ manual: false });
        // オフライン時も、送信待ちキューをIndexedDBへ確定できていれば復元できる。
        return this.flushLocal();
      },
    });
  }

  async function finalizeVoiceForClose() {
    const recorder = state.recording;
    const speech = state.speech;
    if (!recorder && !speech && !state.voiceFinalizePromise) return true;
    const stopped = new Promise(resolve => {
      let pending = Number(!!recorder) + Number(!!speech);
      if (!pending) return resolve();
      const done = () => {
        pending -= 1;
        if (pending <= 0) resolve();
      };
      if (recorder) recorder.addEventListener?.('stop', done, { once: true });
      if (speech) speech.addEventListener?.('end', done, { once: true });
      setTimeout(resolve, 8000);
    });
    stopVoiceRecording();
    await stopped;
    if (state.voiceFinalizePromise) await state.voiceFinalizePromise;
    return !state.recording && !state.speech;
  }

  async function flushPendingQueue() {
    const queue = readJson(QUEUE_KEY, []);
    if (!Array.isArray(queue) || !queue.length) return true;
    state.flushRequested = true;
    return drainQueue({ manual: false, pending: true });
  }

  function drainQueue(opts) {
    if (state.saving) {
      state.flushRequested = true;
      return state.savePromise || Promise.resolve(false);
    }
    state.saving = true;
    state.savePromise = (async () => {
      setStatus(opts && opts.manual ? '保存中...' : '自動保存中...');
      try {
        let ok = false;
        do {
          state.flushRequested = false;
          ok = await flushQueue();
        // 保存中に入った新しい編集は、先行要求が旧スナップショットとして
        // remaining を残した場合（ok=false）でも、同じ flush 呼び出し内で送る。
        } while (state.flushRequested);
        state.dirty = !ok;
        const pendingMessage = isCloudMode() ? 'Dropbox接続後に自動送信' : 'Meldex起動後に自動送信';
        setStatus(ok ? (isCloudMode() ? 'Dropboxに保存済み' : 'Meldexに保存済み') : pendingMessage);
        return ok;
      } finally {
        state.saving = false;
        state.savePromise = null;
      }
    })();
    return state.savePromise;
  }

  async function flushQueue() {
    const snapshot = readJson(QUEUE_KEY, []);
    if (!Array.isArray(snapshot) || !snapshot.length) return true;
    const cloud = isCloudMode();
    if (cloud && !cloudConnected()) return false;
    const sent = new Set();
    const failed = new Set();
    const signatures = new Map(snapshot.map((item) => [item.memo_id, queueItemSignature(item)]));
    for (const item of snapshot) {
      try {
        const result = cloud ? await saveMemoCloud(item) : await postJson('/api/quick-memo', item);
        if (!result || result.ok !== true) throw new Error(result && (result.error || result.detail) || 'save failed');
        sent.add(item.memo_id);
        const current = readJson(CURRENT_KEY, {});
        if (current.memo_id === item.memo_id) {
          current.server_path = result.path || current.server_path || '';
          current.version_path = result.version_path || current.version_path || current.server_path || '';
          current.version_type = result.version_type === 'db' ? 'db' : 'file';
          state.currentPath = current.server_path;
          state.currentVersionTarget = {
            path: current.version_path,
            type: current.version_type,
          };
          current.target_sheet = result.target_sheet || current.target_sheet || item.target_sheet || '';
          // 保存中にタグを付け外しした場合、古い要求の戻り値で現在の選択を
          // 巻き戻さない。updated_at が同じ要求に限ってサーバー正規化を反映する。
          if (Array.isArray(result.tags) && current.updated_at === item.updated_at) {
            current.tags = result.tags;
            state.selectedTags = [...result.tags];
            renderTagChips();
          }
          writeJson(CURRENT_KEY, current);
        }
      } catch {
        failed.add(item.memo_id);
      }
    }
    const latest = readJson(QUEUE_KEY, []);
    const remaining = (Array.isArray(latest) ? latest : []).filter((item) => {
      if (!sent.has(item.memo_id) && !failed.has(item.memo_id)) return true;
      if (failed.has(item.memo_id)) return true;
      return queueItemSignature(item) !== signatures.get(item.memo_id);
    });
    if (!writeJson(QUEUE_KEY, remaining)) return false;
    return remaining.length === 0;
  }

  function enqueueMemo(memo) {
    const queue = readJson(QUEUE_KEY, []);
    const idx = queue.findIndex((item) => item.memo_id === memo.memo_id);
    if (idx >= 0) queue[idx] = memo;
    else queue.push(memo);
    return writeJson(QUEUE_KEY, queue);
  }

  function persistDraft(memo) {
    return writeJson(CURRENT_KEY, memo);
  }

  function queueItemSignature(item) {
    try { return JSON.stringify(item || {}); } catch { return String(item?.updated_at || item?.memo_id || ''); }
  }

  async function postJson(path, payload) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || res.statusText);
    return data;
  }

  // --- クラウド保存（Dropbox連携の単独アプリとして開かれた場合） ------------------
  // 標準エンドポイント（/file・/outliner/add・/db-metadata・/entity/create・/value）
  // だけで「クイックメモ」シートへ保存する。同じキューを読む gb-quick-memo-sync.js の
  // 保存経路と同じ考え方: 新規メモは /entity/create、2回目以降の自動保存は既存パスへの
  // /file 上書きでfrontmatterを丸ごと書き直す（プロパティを部分更新する候補追加APIは
  // 使わず、保存のたびに候補が積み上がるのを避ける）。

  function isCloudMode() {
    return typeof window.apiFetch === 'function' && window.apiFetch._meldexStandaloneCloudAdapter === true;
  }

  function cloudConnected() {
    return window.MeldexStandaloneCloud && window.MeldexStandaloneCloud.getStatus
      && window.MeldexStandaloneCloud.getStatus().connected === true;
  }

  function cloudCandidate(value) {
    return { value: String(value || ''), status: '採用', created: new Date().toISOString() };
  }

  function cloudJsonValue(value) {
    return JSON.stringify(value == null ? '' : value);
  }

  const CLOUD_MEMO_TOP_KEYS = new Set([
    'type', 'id', 'category', 'quick_memo', 'quick_memo_id', 'created', 'modified', 'properties',
  ]);
  const CLOUD_MEMO_PROPERTY_KEYS = new Set([
    '種別', 'タグ', '追加日時', '更新日時', '保存先', 'URL', '共有タイトル', '共有元',
  ]);

  function cloudYamlBlocks(raw, indent) {
    const lines = String(raw || '').match(/[^\r\n]*(?:\r\n|\n|$)/g)?.filter(Boolean) || [];
    const starts = [];
    const prefix = ' '.repeat(indent);
    lines.forEach((line, index) => {
      if (!line.startsWith(prefix) || /^\s*(?:#|$)/.test(line)) return;
      const rest = line.slice(indent);
      if (/^\s/.test(rest)) return;
      const match = rest.match(/^([^:#][^:]*):/);
      if (match) starts.push({ index, key: match[1].trim() });
    });
    return starts.map((start, index) => ({
      key: start.key,
      start: start.index,
      end: starts[index + 1]?.index ?? lines.length,
      text: lines.slice(start.index, starts[index + 1]?.index ?? lines.length).join(''),
    }));
  }

  function cloudPatchYamlMapping(raw, updates, allowedKeys, indent) {
    const source = String(raw || '');
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.match(/[^\r\n]*(?:\r\n|\n|$)/g)?.filter(Boolean) || [];
    const blocks = cloudYamlBlocks(source, indent);
    const seen = new Set();
    let output = blocks.length ? lines.slice(0, blocks[0].start).join('') : source;
    blocks.forEach(block => {
      if (!allowedKeys.has(block.key) || !Object.hasOwn(updates, block.key)) {
        output += block.text;
        return;
      }
      seen.add(block.key);
      output += `${' '.repeat(indent)}${block.key}: ${cloudJsonValue(updates[block.key])}${eol}`;
    });
    const missing = [...allowedKeys].filter(key => !seen.has(key) && Object.hasOwn(updates, key));
    if (missing.length && output && !/(?:\r\n|\n)$/.test(output)) output += eol;
    missing.forEach(key => {
      output += `${' '.repeat(indent)}${key}: ${cloudJsonValue(updates[key])}${eol}`;
    });
    return output;
  }

  function cloudPatchPropertiesBlock(block, properties) {
    const eol = block.includes('\r\n') ? '\r\n' : '\n';
    const firstEnd = block.search(/\r?\n/);
    const firstLine = firstEnd < 0 ? block : block.slice(0, firstEnd);
    const tail = firstEnd < 0 ? '' : block.slice(firstEnd + (block.slice(firstEnd, firstEnd + 2) === '\r\n' ? 2 : 1));
    const inline = firstLine.match(/^properties:\s*(.*?)\s*$/)?.[1] || '';
    if (inline) return `properties: ${cloudJsonValue(properties)}${eol}`;
    const childIndent = Number(tail.match(/^(\s+)[^#\s][^:]*:/m)?.[1]?.length || 2);
    return `properties:${eol}${cloudPatchYamlMapping(tail, properties, CLOUD_MEMO_PROPERTY_KEYS, childIndent)}`;
  }

  function cloudFrontmatterText(frontmatter, body, rawFrontmatter) {
    if (rawFrontmatter != null) {
      const source = String(rawFrontmatter);
      const blocks = cloudYamlBlocks(source, 0);
      const propertiesBlock = blocks.find(block => block.key === 'properties');
      let patched = cloudPatchYamlMapping(source, frontmatter, new Set([...CLOUD_MEMO_TOP_KEYS].filter(key => key !== 'properties')), 0);
      const patchedBlock = cloudYamlBlocks(patched, 0).find(block => block.key === 'properties');
      if (propertiesBlock && patchedBlock) {
        const start = patched.indexOf(patchedBlock.text);
        patched = patched.slice(0, start)
          + cloudPatchPropertiesBlock(patchedBlock.text, frontmatter.properties || {})
          + patched.slice(start + patchedBlock.text.length);
      } else if (!propertiesBlock) {
        const eol = patched.includes('\r\n') ? '\r\n' : '\n';
        if (patched && !/(?:\r\n|\n)$/.test(patched)) patched += eol;
        patched += `properties: ${cloudJsonValue(frontmatter.properties || {})}${eol}`;
      }
      const eol = patched.includes('\r\n') ? '\r\n' : '\n';
      return `---${eol}${patched.replace(/(?:\r\n|\n)?$/, eol)}---${eol}${eol}`
        + String(body || '').replace(/\s+$/, '') + eol;
    }
    const lines = ['---'];
    Object.entries(frontmatter || {}).forEach(([key, value]) => {
      if (!key || /[\r\n:]/.test(key)) return;
      lines.push(`${key}: ${cloudJsonValue(value)}`);
    });
    lines.push('---', '');
    return lines.join('\n') + String(body || '').replace(/\s+$/, '') + '\n';
  }

  function cloudMemoPath(item) {
    if (item.server_path) return String(item.server_path).replace(/\\/g, '/');
    const stamp = String(item.created_at || new Date().toISOString())
      .replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '_').slice(0, 15);
    const id = String(item.memo_id || item.client_id || Date.now()).replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
    const firstLine = (item.text || '').trim().split(/\r?\n/)[0] || '';
    const title = String(item.title || firstLine || 'メモ').trim().slice(0, 40).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'メモ';
    return `${CLOUD_SHEET_NAME}/${stamp}_${title}_${id}.md`;
  }

  function cloudMemoTags(item) {
    return Array.isArray(item.tags) ? [...new Set(item.tags)] : [];
  }

  function cloudMemoBody(item) {
    const title = String(item.title || '').trim() || 'メモ';
    const html = sanitizeHtml(item.html || '');
    const text = String(item.text || '').trim();
    const drawingRaw = String(item.drawing_png || '');
    const drawing = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(drawingRaw) ? drawingRaw.replace(/\s+/g, '') : '';
    const parts = ['# ' + title, ''];
    if (html) parts.push('<div class="meldex-quick-memo-body">', html, '</div>', '');
    else if (text) parts.push('<div class="meldex-quick-memo-body">', escHtml(text).replace(/\n/g, '<br>'), '</div>', '');
    if (drawing) parts.push('<figure class="meldex-quick-memo-drawing">', `<img alt="手書きメモ" src="${drawing}">`, '</figure>', '');
    return parts.join('\n');
  }

  function cloudMemoFrontmatter(item, path, tags, existingFrontmatter) {
    const created = String(item.created_at || new Date().toISOString());
    const updated = String(item.updated_at || new Date().toISOString());
    const properties = {
      種別: [cloudCandidate('メモ')],
      タグ: [cloudCandidate(tags.join(', '))],
      追加日時: [cloudCandidate(created)],
      更新日時: [cloudCandidate(updated)],
      保存先: [cloudCandidate(path)],
    };
    if (item.source_url) properties['URL'] = [cloudCandidate(item.source_url)];
    if (item.share_title) properties['共有タイトル'] = [cloudCandidate(item.share_title)];
    if (item.source_label) properties['共有元'] = [cloudCandidate(item.source_label)];
    const existing = existingFrontmatter && typeof existingFrontmatter === 'object'
      && !Array.isArray(existingFrontmatter) ? existingFrontmatter : {};
    return {
      ...existing,
      type: 'settings-entry',
      id: String(existing.id || ('ent_' + String(item.memo_id || item.client_id || Date.now()).replace(/[^A-Za-z0-9]/g, '').slice(0, 12))),
      category: CLOUD_SHEET_NAME,
      quick_memo: true,
      quick_memo_id: String(item.memo_id || item.client_id || ''),
      created,
      modified: updated,
      properties: {
        ...(existing.properties && typeof existing.properties === 'object' ? existing.properties : {}),
        ...properties,
      },
      relations: Array.isArray(existing.relations) ? existing.relations : [],
    };
  }

  function parseCloudMemoFile(data) {
    const content = String(data?.content || '');
    const match = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const parser = window.MeldexCloudFrontmatterLite?.yamlLite;
    if (match && typeof parser !== 'function') {
      throw new Error('既存メモの追加情報を安全に読み取れないため、上書きを中止しました');
    }
    return {
      frontmatter: match && typeof parser === 'function' ? parser(match[1]) : {},
      rawFrontmatter: match ? match[1] : null,
      etag: String(data?.etag || ''),
    };
  }

  if (window.__MELDEX_QUICK_MEMO_TEST__) {
    window.__MELDEX_QUICK_MEMO_TEST__.cloudMemoFrontmatter = cloudMemoFrontmatter;
    window.__MELDEX_QUICK_MEMO_TEST__.cloudFrontmatterText = cloudFrontmatterText;
    window.__MELDEX_QUICK_MEMO_TEST__.cloudPatchPropertiesBlock = cloudPatchPropertiesBlock;
    window.__MELDEX_QUICK_MEMO_TEST__.parseCloudMemoFile = parseCloudMemoFile;
  }

  async function ensureCloudSheet() {
    // 既存メモの更新時も含め毎回呼ぶ（gb-quick-memo-sync.jsのensureMemoWorkspace()と
    // 同じ方針）。シートが外部操作で削除されていた場合でも次の保存で自己修復できるように、
    // 「新規作成時だけ」に絞り込まない。
    try {
      await window.apiFetch('/file?path=' + encodeURIComponent(CLOUD_SHEET_NAME + '/' + CLOUD_SHEET_NAME + '.md'));
    } catch {
      await window.apiPost('/outliner/add', { type: 'database', label: CLOUD_SHEET_NAME, parent: '' }).catch(() => {});
    }
    await window.apiPut('/db-metadata?path=' + encodeURIComponent(CLOUD_SHEET_NAME), {
      type: 'settings-db',
      property_types: {
        種別: { type: 'select', options: ['メモ'] },
        タグ: { type: 'multi-select', options: [] },
        追加日時: { type: 'date', withTime: true },
        更新日時: { type: 'date', withTime: true },
        保存先: { type: 'text' },
        URL: { type: 'url' },
        共有タイトル: { type: 'text' },
        共有元: { type: 'text' },
      },
    }).catch(() => {});
  }

  // /file の上書きは、対象パスの事前GETで得たetagが無いと拒否される
  // （standalone-cloud-runtime.jsのrequestJson()側の仕様）。ファイルが存在しなければ
  // create_only指定で新規作成として書く。既存メモの更新にも、フォールバック書き込みにも使う。
  async function cloudWriteFile(path, content, existingData) {
    let current = existingData || null;
    try {
      if (!current) current = await window.apiFetch('/file?path=' + encodeURIComponent(path));
    } catch (error) {
      if (Number(error?.status || 0) !== 404 && !/not found|見つかりません/i.test(String(error?.message || error))) {
        throw error;
      }
      current = null;
    }
    if (current && !String(current.etag || '').trim()) {
      throw new Error('既存メモの更新情報を確認できないため、上書きを中止しました');
    }
    const body = current
      ? { content, if_match_etag: String(current.etag || '') }
      : { content, create_only: true };
    await window.apiPost('/file?path=' + encodeURIComponent(path), body);
  }

  async function saveMemoCloud(item) {
    await ensureCloudSheet();
    const path = cloudMemoPath(item);
    const tags = cloudMemoTags(item);
    if (!item.server_path) {
      const frontmatter = cloudMemoFrontmatter(item, path, tags, null);
      try {
        const created = await window.apiPost('/entity/create', {
          parent_path: CLOUD_SHEET_NAME,
          name: path.split('/').pop().replace(/\.md$/i, ''),
          properties: frontmatter.properties,
          source: 'quick-memo',
          reviewed: true,
        });
        const createdPath = (created && created.path) || path;
        await window.apiPut('/value?path=' + encodeURIComponent(createdPath), { new_body: cloudMemoBody(item) });
        return { ok: true, path: createdPath, target_sheet: CLOUD_SHEET_NAME, tags };
      } catch {
        // /entity/create または続く/valueが失敗した場合（前回の再試行で実体が
        // 既に作成済みの可能性を含む）は、決定的なパスへの直接書き込みにフォールバックする。
        // これにより再試行のたびに重複エントリが増えるのを防ぐ。
      }
    }
    let existingData = null;
    try {
      existingData = await window.apiFetch('/file?path=' + encodeURIComponent(path));
    } catch (error) {
      if (Number(error?.status || 0) !== 404 && !/not found|見つかりません/i.test(String(error?.message || error))) {
        throw error;
      }
    }
    const existing = parseCloudMemoFile(existingData);
    const frontmatter = cloudMemoFrontmatter(item, path, tags, existing.frontmatter);
    await cloudWriteFile(
      path,
      cloudFrontmatterText(frontmatter, cloudMemoBody(item), existing.rawFrontmatter),
      existingData,
    );
    return { ok: true, path, target_sheet: CLOUD_SHEET_NAME, tags };
  }

  function initCloudMode() {
    if (!isCloudMode()) return;
    // standalone-pwa-install.js が独自の「ホームに追加」フローティングボタンと
    // ダイアログを提供する（クラウド単独アプリ共通）。二重表示を避けるため、
    // quick-memo.js自身のインストールボタンはクラウドモードでは隠す。
    if (els.installBtn) els.installBtn.style.display = 'none';
    if (els.saveBtn) {
      els.saveBtn.setAttribute('aria-label', 'Dropboxへ保存');
      els.saveBtn.setAttribute('title', 'Dropboxへ保存');
      const textNode = [...els.saveBtn.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.nodeValue = 'Dropboxへ保存';
    }
    if (els.workspaceBtn) {
      els.workspaceBtn.setAttribute('aria-label', 'Cloudワークスペースを開く');
      els.workspaceBtn.setAttribute('title', 'Cloudワークスペースを開く');
    }
    // Cloud本体ではローカルOpenAI APIへボイスデータを送らない。ブラウザ標準の
    // SpeechRecognition が無い環境ではボイスモード自体を選択不可にする。
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      const voiceOption = els.modeSelect?.querySelector?.('option[value="voice"]');
      if (voiceOption) {
        voiceOption.disabled = true;
        voiceOption.hidden = true;
      }
      if (state.currentMode === 'voice') switchMode('text');
    }
    const banner = document.getElementById('cloudConnectBanner');
    if (!banner) return;
    const codeInput = document.getElementById('cloudConnectCode');
    const connectBtn = document.getElementById('cloudConnectBtn');
    const submitBtn = document.getElementById('cloudConnectSubmitBtn');

    function refreshConnectBanner() {
      const connected = cloudConnected();
      banner.style.display = connected ? 'none' : '';
      if (connected) {
        loadTags();
        flushPendingQueue();
      }
    }

    if (connectBtn) {
      connectBtn.addEventListener('click', async () => {
        let popup = null;
        try { popup = window.open('about:blank', '_blank'); } catch {}
        try {
          const auth = await window.MeldexStandaloneCloud.beginManualAuth();
          if (popup) {
            try { popup.opener = null; } catch {}
            popup.location.replace(auth.authorizationUrl);
          } else {
            setStatus('ポップアップがブロックされました。ブラウザの設定を確認してください', true);
          }
          if (codeInput) codeInput.focus();
        } catch (error) {
          try { popup && popup.close(); } catch {}
          setStatus((error && error.message) || String(error), true);
        }
      });
    }
    if (submitBtn) {
      submitBtn.addEventListener('click', async () => {
        const code = ((codeInput && codeInput.value) || '').trim();
        if (!code) return;
        try {
          await window.MeldexStandaloneCloud.exchangeManualCode(code);
          if (codeInput) codeInput.value = '';
          setStatus('Dropboxに接続しました');
        } catch (error) {
          setStatus((error && error.message) || String(error), true);
        }
      });
    }
    if (codeInput) {
      codeInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (submitBtn) submitBtn.click();
        }
      });
    }
    window.addEventListener('meldex:standalone-cloud-ready', refreshConnectBanner);
    window.addEventListener('meldex:standalone-auth-required', refreshConnectBanner);
    window.addEventListener('meldex:standalone-auth-changed', refreshConnectBanner);
    refreshConnectBanner();
  }

  function parseTags(value) {
    const seen = new Set();
    return String(value || '')
      .split(/[,、\n]/)
      .map((item) => item.trim())
      .filter((item) => {
        if (!item || seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  }

  function setStatus(message, isError) {
    if (!els.syncStatus) return;
    els.syncStatus.textContent = message;
    els.syncStatus.classList.toggle('qm-toast-error', !!isError);
  }

  // --- タグチップ ---------------------------------------------------------
  //
  // 候補帯は辞書の全件（同梱標準プリセットだけで1,000件）を並び順のまま描画すると
  // 上下が見切れて中央付近しか見えなくなる問題があった。1行・横スクロールへ直した
  // 上で（gb-quick-memo-panel/quick-memo.css側）、候補の選出基準を持たせる:
  //   1. 現在このメモに付いているタグ（常に先頭・常に表示）
  //   2. 最近このユーザーが付けたタグ（この端末のlocalStorageで管理）
  //   3. 2が無い新規環境では、既定プリセット（標準）に属するタグ
  //   4. 残りは辞書の並び順
  // 選択状態は背景色の変化だけでなく、色に依存しないチェック印も併用する。
  // （2026-08-14 画像以外の自動タグ付け／タグ候補帯の仕様是正 計画書 Phase 1-3）

  const RECENT_TAG_NAMES_KEY = 'meldex:quick-memo:recent-tags:v1';
  const RECENT_TAG_NAMES_LIMIT = 24;
  const TAG_RAIL_DISPLAY_LIMIT = 16;
  const DEFAULT_TAG_PRESET_NAME = '標準';

  function _loadRecentTagNames() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_TAG_NAMES_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(item => typeof item === 'string' && item.trim()) : [];
    } catch (_) {
      return [];
    }
  }

  function _recordRecentTagName(name) {
    const tag = String(name || '').trim();
    if (!tag) return;
    try {
      const next = [tag, ..._loadRecentTagNames().filter(item => item !== tag)].slice(0, RECENT_TAG_NAMES_LIMIT);
      localStorage.setItem(RECENT_TAG_NAMES_KEY, JSON.stringify(next));
    } catch (_) {
      // この端末で保存できなくても、候補の並び順が変わらないだけで操作は続行する。
    }
  }

  // 選出基準に沿って候補の並び順を作る（重複なし・存在するタグのみ）。
  function _tagRailCandidateOrder() {
    const known = new Set(state.allTags);
    const seen = new Set();
    const ordered = [];
    const push = (name) => {
      const tag = String(name || '').trim();
      if (!tag || !known.has(tag) || seen.has(tag)) return;
      seen.add(tag);
      ordered.push(tag);
    };
    state.selectedTags.forEach(push);
    _loadRecentTagNames().forEach(push);
    (state.defaultPresetTagNames || []).forEach(push);
    state.allTags.forEach(push);
    return ordered;
  }

  async function _loadUnifiedTagCatalog() {
    if (window.MeldexGlobalTags?.loadTags) {
      return window.MeldexGlobalTags.loadTags();
    }
    if (typeof window.apiFetch === 'function') {
      return window.apiFetch('/global-tags', { silentError: true });
    }
    const response = await fetch(API_BASE + '/api/global-tags');
    if (!response.ok) throw new Error('タグ辞書を読み込めませんでした');
    return response.json();
  }

  async function _createUnifiedTag(name) {
    const payload = { name, presets: ['標準'], auto_assign: false };
    if (window.MeldexGlobalTags?.createTag) {
      return window.MeldexGlobalTags.createTag(payload);
    }
    if (typeof window.apiPost === 'function') {
      return window.apiPost('/global-tags', payload, { silentError: true });
    }
    const response = await fetch(API_BASE + '/api/global-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('タグを追加できませんでした');
    return response.json();
  }

  function _applyUnifiedTagCatalog(data) {
    const tags = Array.isArray(data?.tags) ? data.tags : [];
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const groupsById = Object.fromEntries(groups.map(group => [group.id, group]));
    const nextColors = {};
    const nextIds = {};
    const names = [];
    const defaultPresetNames = [];
    tags.forEach((tag) => {
      const name = String(tag?.name || '').trim();
      if (!name) return;
      const groupColor = String(groupsById[tag.group_id]?.color || '').trim();
      names.push(name);
      nextColors[name] = groupColor || String(tag?.color || '').trim();
      nextIds[name] = String(tag?.id || '');
      const presets = Array.isArray(tag?.presets) ? tag.presets.map(preset => String(preset || '')) : [];
      if (!presets.length || presets.includes(DEFAULT_TAG_PRESET_NAME)) defaultPresetNames.push(name);
    });
    state.allTags = [...new Set(names)];
    state.tagCatalog = { tags: [...tags], groups: [...groups] };
    state.commonTagColors = nextColors;
    state.tagIdsByName = nextIds;
    state.defaultPresetTagNames = [...new Set(defaultPresetNames)];
    state.selectedTagIds = state.selectedTags
      .map(name => nextIds[name])
      .filter(Boolean);
    renderTagChips();
  }

  async function _loadTagsNow() {
    if (isCloudMode() && !cloudConnected()) return;
    try {
      let data = await _loadUnifiedTagCatalog();
      const existing = new Set((data?.tags || []).map(tag => String(tag?.name || '').trim()).filter(Boolean));
      const missing = [...new Set(state.selectedTags.map(tag => String(tag || '').trim()).filter(Boolean))]
        .filter(tag => !existing.has(tag));
      for (const name of missing) {
        try {
          await _createUnifiedTag(name);
        } catch (error) {
          if (!String(error?.message || error).includes('重複')) throw error;
        }
      }
      if (missing.length) data = await _loadUnifiedTagCatalog();
      _applyUnifiedTagCatalog(data);
    } catch (error) {
      const detail = String(error?.userMessage || error?.message || error);
      const message = /404|file not found|failed to fetch|network/i.test(detail)
        ? 'タグ辞書はMeldexへ接続すると利用できます'
        : 'タグ辞書を読み込めませんでした: ' + detail.slice(0, 160);
      setStatus(message, !/接続すると利用できます/.test(message));
    }
  }

  function loadTags() {
    if (tagLoadPromise) return tagLoadPromise;
    tagLoadPromise = _loadTagsNow().finally(() => { tagLoadPromise = null; });
    return tagLoadPromise;
  }

  function _buildTagChip(tag) {
    const isSelected = state.selectedTags.includes(tag);
    const isCommonTag = Object.prototype.hasOwnProperty.call(state.commonTagColors, tag);
    const commonColor = isCommonTag ? (state.commonTagColors[tag] || '') : '';
    const record = (state.tagCatalog?.tags || []).find(item => String(item?.name || '') === tag)
      || { name: tag, color: commonColor || '' };
    const groupsById = Object.fromEntries((state.tagCatalog?.groups || []).map(group => [group.id, group]));
    const chip = window.MeldexGlobalTags?.createTagChip
      ? window.MeldexGlobalTags.createTagChip(record, {
          groupsById,
          className: 'qm-tag-chip' + (isSelected ? ' is-selected' : '') + (isCommonTag ? ' qm-tag-chip-common' : ''),
          title: isCommonTag ? `${tag}（統一タグ辞書）` : tag,
          ariaLabel: `${tag}${isSelected ? '、選択中' : '、未選択'}`,
          onActivate: () => toggleTag(tag),
        })
      : document.createElement('span');
    if (!chip.classList.contains('gb-tag-chip')) {
      chip.className = 'gb-tag-chip qm-tag-chip' + (isSelected ? ' is-selected' : '') + (isCommonTag ? ' qm-tag-chip-common' : '');
      chip.textContent = tag;
      chip.tabIndex = 0;
      chip.setAttribute('role', 'button');
      chip.addEventListener('click', () => toggleTag(tag));
      chip.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleTag(tag);
      });
    }
    const activator = chip.querySelector?.('.gb-tag-chip__label') || chip;
    activator.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    return chip;
  }

  function _buildTagRailMoreChip(hiddenCount, allNames) {
    const chip = document.createElement('span');
    chip.className = 'gb-tag-chip qm-tag-chip qm-tag-chip-more';
    chip.setAttribute('role', 'button');
    chip.setAttribute('tabindex', '0');
    chip.textContent = `+${hiddenCount}`;
    chip.title = `すべてのタグ（${allNames.length}件）\n${allNames.join('、')}`;
    chip.setAttribute('aria-label', `残り${hiddenCount}件のタグを含むすべてのタグから選ぶ`);
    const openAll = () => { addNewTag(); };
    chip.addEventListener('click', openAll);
    chip.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openAll();
      }
    });
    return chip;
  }

  function _updateTagChipsOverflowHint() {
    const container = els.tagChips;
    if (!container) return;
    const overflowing = container.scrollWidth > container.clientWidth + 1;
    container.classList.toggle('qm-tag-chips--overflow', overflowing);
  }

  function _ensureTagRailHelp() {
    const label = document.querySelector('#tagSelector .qm-tag-label');
    if (!label || label.dataset.helpAttached === '1' || typeof window.fieldHelp !== 'function') return;
    label.dataset.helpAttached = '1';
    label.insertAdjacentHTML('beforeend', window.fieldHelp(
      '付いているタグ→最近使ったタグ→よく使うタグの順に並びます。横スクロールで続きを見られます',
    ));
  }

  function renderTagChips() {
    const container = els.tagChips;
    if (!container) return;
    _ensureTagRailHelp();
    container.innerHTML = '';
    const ordered = _tagRailCandidateOrder();
    const alwaysShown = ordered.filter(tag => state.selectedTags.includes(tag));
    const rest = ordered.filter(tag => !state.selectedTags.includes(tag));
    const restLimit = Math.max(0, TAG_RAIL_DISPLAY_LIMIT - alwaysShown.length);
    const visible = [...alwaysShown, ...rest.slice(0, restLimit)];
    const hiddenCount = ordered.length - visible.length;
    visible.forEach((tag) => container.appendChild(_buildTagChip(tag)));
    if (hiddenCount > 0) container.appendChild(_buildTagRailMoreChip(hiddenCount, ordered));
    requestAnimationFrame(_updateTagChipsOverflowHint);
  }

  function toggleTag(tag) {
    const idx = state.selectedTags.indexOf(tag);
    if (idx >= 0) {
      state.selectedTags.splice(idx, 1);
    } else {
      state.selectedTags.push(tag);
      _recordRecentTagName(tag);
    }
    state.selectedTagIds = state.selectedTags.map(name => state.tagIdsByName[name]).filter(Boolean);
    renderTagChips();
    scheduleSave();
  }

  async function addNewTag() {
    try {
      await loadTags();
      await showTagPicker();
    } catch (error) {
      setStatus('タグを開けませんでした: ' + (error?.message || error), true);
    }
  }

  // --- ホーム画面に追加（PWAインストール） -----------------------------------

  function listenInstallPrompt() {
    // クラウド版は standalone-pwa-install.js が独自の「ホームに追加」導線を持つため
    // （フローティングボタン+ダイアログ）、quick-memo.js側のボタンは出さない。
    if (isCloudMode()) return;
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      state.installPrompt = event;
      els.installBtn.style.display = '';
    });
    if (window.matchMedia('(display-mode: standalone)').matches) {
      els.installBtn.style.display = 'none';
    }
  }

  async function installToHome() {
    if (state.installPrompt) {
      try {
        await state.installPrompt.prompt();
        const choice = await state.installPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          setStatus('ホーム画面に追加しました');
          els.installBtn.style.display = 'none';
        }
      } catch {}
      state.installPrompt = null;
      return;
    }
    const ua = navigator.userAgent || '';
    let instructions = '';
    if (/iPad|iPhone|iPod/.test(ua)) {
      instructions = 'Safariの共有ボタン → 「ホーム画面に追加」をタップしてください';
    } else if (/Android/.test(ua)) {
      instructions = 'ブラウザのメニュー → 「ホーム画面に追加」をタップしてください';
    } else {
      instructions = 'アドレスバーのインストールアイコンをクリックしてください';
    }
    setStatus(instructions);
  }

  // --- ボイスモード --------------------------------------------------------

  async function startVoiceRecording() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      startBrowserSpeech(Recognition);
      return;
    }
    if (isCloudMode()) {
      els.voiceStatus.textContent = 'このブラウザではボイス認識を利用できません';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      state.recordChunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) state.recordChunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        state.recording = null;
        updateVoiceUI('stopped');
        if (recorder._meldexCancelled) return;
        const blob = new Blob(state.recordChunks, { type: recorder.mimeType || 'audio/webm' });
        state.voiceFinalizePromise = transcribeBlob(blob)
          .finally(() => { state.voiceFinalizePromise = null; });
      };
      state.recording = recorder;
      recorder.start();
      state.voiceStartTime = Date.now();
      startVoiceTimer();
      updateVoiceUI('recording');
    } catch {
      els.voiceStatus.textContent = 'マイクを利用できません';
    }
  }

  function startBrowserSpeech(Recognition) {
    const rec = new Recognition();
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    let accumulated = els.voiceTranscript.textContent || '';
    rec.onresult = (event) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      }
      if (finalText) {
        accumulated += finalText + ' ';
        els.voiceTranscript.textContent = accumulated;
      }
    };
    rec.onerror = () => { els.voiceStatus.textContent = 'ボイス認識エラー'; };
    rec.onend = () => {
      state.speech = null;
      if (state.voicePausing) {
        // 一時停止のための停止。UIは pauseVoiceRecording 側が既に更新済み
        state.voicePausing = false;
        return;
      }
      updateVoiceUI('stopped');
      stopVoiceTimer();
    };
    state.speech = rec;
    rec.start();
    state.voiceStartTime = Date.now();
    startVoiceTimer();
    updateVoiceUI('recording');
  }

  function pauseVoiceRecording() {
    if (state.recording && state.recording.state === 'recording') {
      state.recording.pause();
      updateVoiceUI('paused');
      stopVoiceTimer();
    } else if (state.speech) {
      state.voicePausing = true;
      state.speech.stop();
      updateVoiceUI('paused');
      stopVoiceTimer();
    }
  }

  function resumeVoiceRecording() {
    if (state.recording && state.recording.state === 'paused') {
      state.recording.resume();
      startVoiceTimer();
      updateVoiceUI('recording');
    } else if (!state.speech) {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (Recognition) startBrowserSpeech(Recognition);
    }
  }

  function stopVoiceRecording() {
    stopVoiceTimer();
    if (state.recording && state.recording.state !== 'inactive') {
      state.recording.stop();
    }
    if (state.speech) {
      state.voicePausing = false;
      state.speech.stop();
      state.speech = null;
    }
    updateVoiceUI('stopped');
    const text = els.voiceTranscript.textContent.trim();
    if (text) {
      insertText(text);
      scheduleSave();
    }
  }

  function _stopVoiceCapture() {
    stopVoiceTimer();
    if (state.recording && state.recording.state !== 'inactive') {
      state.recording._meldexCancelled = true;
      try { state.recording.stop(); } catch {}
    }
    state.recording = null;
    if (state.speech) {
      state.voicePausing = false;
      try { state.speech.stop(); } catch {}
      state.speech = null;
    }
    if (els.voiceTranscript) els.voiceTranscript.textContent = '';
    updateVoiceUI('stopped');
  }

  function updateVoiceUI(status) {
    els.voiceRecordBtn.style.display = status === 'stopped' || !status ? '' : 'none';
    els.voicePauseBtn.style.display = status === 'recording' ? '' : 'none';
    els.voiceResumeBtn.style.display = status === 'paused' ? '' : 'none';
    els.voiceStopBtn.style.display = status === 'recording' || status === 'paused' ? '' : 'none';
    const labels = { recording: '録音中...', paused: '一時停止中', stopped: 'マイクの準備ができています' };
    els.voiceStatus.textContent = labels[status] || '';
  }

  function startVoiceTimer() {
    stopVoiceTimer();
    state.voiceTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.voiceStartTime) / 1000);
      const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const sec = String(elapsed % 60).padStart(2, '0');
      els.voiceTimer.textContent = min + ':' + sec;
    }, 1000);
  }

  function stopVoiceTimer() {
    if (state.voiceTimerInterval) {
      clearInterval(state.voiceTimerInterval);
      state.voiceTimerInterval = null;
    }
  }

  async function transcribeBlob(blob) {
    els.voiceStatus.textContent = '文字起こし中...';
    try {
      if (isCloudMode()) throw new Error('cloud-local-transcription-disabled');
      const dataUrl = await blobToDataUrl(blob);
      const result = await postJson('/api/quick-memo/transcribe', {
        audio_base64: dataUrl,
        mime_type: blob.type || 'audio/webm',
      });
      if (result.text) {
        els.voiceTranscript.textContent = (els.voiceTranscript.textContent + ' ' + result.text).trim();
        insertText(result.text);
        scheduleSave();
      }
      els.voiceStatus.textContent = '文字起こし完了';
    } catch {
      els.voiceStatus.textContent = 'OpenAI文字起こしを利用できません';
    }
  }

  function insertText(text) {
    editorController.mutate(() => {
      els.editor.focus();
      document.execCommand('insertText', false, text + ' ');
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function sanitizeHtml(fragment) {
    const template = document.createElement('template');
    template.innerHTML = String(fragment || '');
    template.content.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value || '';
        if (name.startsWith('on')) node.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src') && /^(javascript|data:text)/i.test(value)) node.removeAttribute(attr.name);
      });
    });
    return template.innerHTML;
  }

  function escHtml(value) {
    return MeldexEscape.html(value);
  }

  function escAttr(value) {
    return MeldexEscape.attr(value);
  }

  function readJson(key, fallback) {
    if (durableMemory.has(key)) return structuredClone(durableMemory.get(key));
    try {
      const raw = localStorage.getItem(key);
      const value = raw ? JSON.parse(raw) : fallback;
      if (raw) durableMemory.set(key, value);
      return value;
    } catch {
      return fallback;
    }
  }

  function showTagPicker() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'qm-tag-picker-overlay';
      const dialog = document.createElement('section');
      dialog.className = 'qm-tag-picker';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'qm-tag-picker-title');
      const title = document.createElement('h2');
      title.id = 'qm-tag-picker-title';
      title.textContent = 'タグツリー';
      const selectedCount = document.createElement('span');
      selectedCount.className = 'qm-tag-picker-count';
      selectedCount.setAttribute('aria-live', 'polite');
      const heading = document.createElement('div');
      heading.className = 'qm-tag-picker-heading';
      heading.append(title, selectedCount);
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = 'タグを検索';
      search.setAttribute('aria-label', 'タグを検索');
      const tree = document.createElement('div');
      tree.className = 'qm-tag-picker-tree';
      tree.setAttribute('role', 'tree');
      tree.setAttribute('aria-label', 'タグの階層');
      const createRow = document.createElement('div');
      createRow.className = 'qm-tag-picker-create';
      const createInput = document.createElement('input');
      createInput.type = 'text';
      createInput.placeholder = '新しいタグ名';
      createInput.setAttribute('aria-label', '新しいタグ名');
      const createButton = document.createElement('button');
      createButton.type = 'button';
      createButton.textContent = '追加';
      createRow.append(createInput, createButton);
      const actions = document.createElement('div');
      actions.className = 'qm-tag-picker-actions';
      actions.setAttribute('data-dialog-actions', '1');
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = '全解除';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'qm-primary';
      close.textContent = '閉じる';
      actions.append(clear, close);
      dialog.append(heading, search, tree, createRow, actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        overlay.remove();
        document.removeEventListener('keydown', onKeydown, true);
        els.addTagBtn?.focus?.();
        resolve();
      };
      const compare = (left, right) => Number(left?.sort_index || 0) - Number(right?.sort_index || 0)
        || String(left?.name || '').localeCompare(String(right?.name || ''), 'ja');
      const updateCount = () => {
        selectedCount.textContent = `${state.selectedTags.length}件選択中`;
      };
      const tagRow = (tag, depth) => {
        const name = String(tag?.name || '').trim();
        const label = document.createElement('label');
        label.className = 'qm-tag-picker-tag';
        label.setAttribute('role', 'treeitem');
        label.style.setProperty('--qm-tag-depth', String(depth));
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.selectedTags.includes(name);
        checkbox.setAttribute('aria-label', `${name}を${checkbox.checked ? '解除' : '選択'}`);
        const swatch = document.createElement('span');
        swatch.className = 'qm-tag-picker-swatch';
        swatch.style.background = state.commonTagColors[name] || 'var(--qm-accent)';
        const text = document.createElement('span');
        text.textContent = name;
        checkbox.addEventListener('change', () => {
          toggleTag(name);
          checkbox.checked = state.selectedTags.includes(name);
          checkbox.setAttribute('aria-label', `${name}を${checkbox.checked ? '解除' : '選択'}`);
          updateCount();
        });
        label.append(checkbox, swatch, text);
        return label;
      };
      const renderTree = () => {
        tree.innerHTML = '';
        const filter = search.value.trim().toLocaleLowerCase('ja');
        const groups = [...(state.tagCatalog.groups || [])].sort(compare);
        const tags = [...(state.tagCatalog.tags || [])].sort(compare);
        const groupsByParent = new Map();
        groups.forEach(group => {
          const parentId = String(group?.parent_id || '');
          if (!groupsByParent.has(parentId)) groupsByParent.set(parentId, []);
          groupsByParent.get(parentId).push(group);
        });
        const tagsByGroup = new Map();
        tags.forEach(tag => {
          const groupId = String(tag?.group_id || '');
          if (!tagsByGroup.has(groupId)) tagsByGroup.set(groupId, []);
          tagsByGroup.get(groupId).push(tag);
        });
        const visited = new Set();
        const buildGroup = (group, depth, ancestorMatched) => {
          const id = String(group?.id || '');
          if (!id || visited.has(id)) return null;
          visited.add(id);
          const ownMatched = !filter || String(group?.name || '').toLocaleLowerCase('ja').includes(filter);
          const includeAll = ancestorMatched || ownMatched;
          const childNodes = (groupsByParent.get(id) || [])
            .map(child => buildGroup(child, depth + 1, includeAll))
            .filter(Boolean);
          const tagNodes = (tagsByGroup.get(id) || [])
            .filter(tag => includeAll || String(tag?.name || '').toLocaleLowerCase('ja').includes(filter))
            .map(tag => tagRow(tag, depth + 1));
          if (filter && !ownMatched && !childNodes.length && !tagNodes.length) return null;
          const details = document.createElement('details');
          details.className = 'qm-tag-picker-group';
          details.open = true;
          details.setAttribute('role', 'group');
          const summary = document.createElement('summary');
          summary.textContent = String(group?.name || 'グループ');
          summary.style.setProperty('--qm-tag-depth', String(depth));
          details.append(summary, ...tagNodes, ...childNodes);
          return details;
        };
        const rootIds = new Set(groups.map(group => String(group?.id || '')));
        groups
          .filter(group => !group?.parent_id || !rootIds.has(String(group.parent_id)))
          .map(group => buildGroup(group, 0, false))
          .filter(Boolean)
          .forEach(node => tree.appendChild(node));
        const ungrouped = (tagsByGroup.get('') || [])
          .filter(tag => !filter || String(tag?.name || '').toLocaleLowerCase('ja').includes(filter));
        if (ungrouped.length) {
          const details = document.createElement('details');
          details.className = 'qm-tag-picker-group';
          details.open = true;
          const summary = document.createElement('summary');
          summary.textContent = '未分類';
          details.append(summary, ...ungrouped.map(tag => tagRow(tag, 1)));
          tree.appendChild(details);
        }
        if (!tree.children.length) {
          const empty = document.createElement('div');
          empty.className = 'qm-tag-picker-empty';
          empty.textContent = '一致するタグがありません';
          tree.appendChild(empty);
        }
        updateCount();
      };
      const createTag = async () => {
        const name = createInput.value.trim();
        if (!name) return;
        createButton.disabled = true;
        try {
          if (!state.allTags.includes(name)) await _createUnifiedTag(name);
          await loadTags();
          if (!state.selectedTags.includes(name)) toggleTag(name);
          _recordRecentTagName(name);
          createInput.value = '';
          search.value = name;
          renderTree();
        } catch (error) {
          setStatus('タグを追加できませんでした: ' + (error?.message || error), true);
        } finally {
          createButton.disabled = false;
        }
      };
      const onKeydown = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish();
        } else if (event.key === 'Enter' && document.activeElement === createInput) {
          event.preventDefault();
          createTag();
        } else if (event.key === 'Tab') {
          const focusable = Array.from(dialog.querySelectorAll('input, button, summary')).filter(item => !item.disabled);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      };
      search.addEventListener('input', renderTree);
      createButton.addEventListener('click', createTag);
      clear.addEventListener('click', () => {
        if (!state.selectedTags.length) return;
        state.selectedTags = [];
        state.selectedTagIds = [];
        renderTagChips();
        scheduleSave();
        renderTree();
      });
      close.addEventListener('click', finish);
      overlay.addEventListener('pointerdown', event => {
        if (event.target === overlay) finish();
      });
      document.addEventListener('keydown', onKeydown, true);
      renderTree();
      search.focus();
    });
  }

  function writeJson(key, value) {
    durableMemory.set(key, structuredClone(value));
    const durable = window.MeldexStandaloneLocalDrafts?.putRaw?.(`quick-memo:${key}`, value);
    durable?.then?.(
      () => { state.localSaveFailed = false; },
      error => {
        state.localSaveFailed = true;
        setStatus('端末への保存に失敗: ' + (error?.message || error), true);
      },
    );
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return !!durable;
    }
  }

  async function hydrateDurableRecords() {
    const store = window.MeldexStandaloneLocalDrafts;
    if (!store?.getRaw) return;
    for (const key of [CURRENT_KEY, QUEUE_KEY]) {
      // IndexedDB の open/transaction がブラウザ側で応答しない場合でも、localStorage の
      // 下書きで編集UIを起動できるようにする。未完了のPromiseは後から解決してもここでは
      // 状態へ書き戻さないため、起動後の入力を古い値で上書きしない。
      const value = await Promise.race([
        store.getRaw(`quick-memo:${key}`, null).catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), 1500)),
      ]);
      if (value != null) durableMemory.set(key, value);
    }
  }

  function registerServiceWorker() {
    // クラウド版（apps/quick-memo/）はビルド時に生成される専用のsw.jsを
    // standalone-pwa-install.js が登録する。ここで quick-memo-sw.js を登録すると
    // 存在しないパスへ向けた誤った登録になるため、クラウドモードではスキップする。
    if (isCloudMode() || isEmbedded()) return;
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const cleanupLegacyRootWorker = navigator.serviceWorker.getRegistration
      ? navigator.serviceWorker.getRegistration('./').then((registration) => {
        const scriptUrl = registration?.active?.scriptURL || registration?.waiting?.scriptURL || registration?.installing?.scriptURL || '';
        if (scriptUrl.endsWith('/quick-memo-sw.js') || scriptUrl.endsWith('quick-memo-sw.js')) {
          return registration.unregister();
        }
        return false;
      }).catch(() => false)
      : Promise.resolve(false);
    cleanupLegacyRootWorker.finally(() => {
      navigator.serviceWorker.register('quick-memo-sw.js', { scope: './quick-memo.html', updateViaCache: 'none' }).catch(() => {});
    });
  }
})();
