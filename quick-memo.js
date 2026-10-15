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
    selectedTags: [],
    selectedTagIds: [],
    tagIdsByName: {},
    commonTagColors: {}, // 共通タグ由来の候補: 名前 → 色（#rrggbb、無ければ空文字）。スウォッチ表示用
    tagCatalog: { tags: [], groups: [] },
    tagCatalogError: '',
    voiceTimerInterval: null,
    voiceStartTime: 0,
    voicePausing: false,
    voiceFinalizePromise: null,
    pendingVoice: null,
    localSaveFailed: false,
    installPrompt: null,
    textHistory: { canUndo: false, canRedo: false },
    drawingHistory: { canUndo: false, canRedo: false },
    // 右サイドバーの「プロパティ」タブが、いま開いているメモのファイルを知るために使う。
    // 新規メモ（未保存）のときは空文字のまま。
    currentPath: '',
    currentVersionTarget: { path: '', type: 'file' },
    memoEpoch: 0,
    voiceStarting: false,
    lastSaveError: '',
    creatingMemo: false,
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
    window.MeldexQuickMemo.prepareClose = () => finalizeVoiceForClose();
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
  const failedLocalWrites = new Set();

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
    await hydrateQuickMemoTags();
    restoreDraft();
    const shareAccepted = await applyIncomingShare();
    bindEvents();
    registerCloseContract();
    switchMode(state.currentMode);
    initCloudMode();
    await loadStorageLocation();
    loadTags();
    listenInstallPrompt();
    registerServiceWorker();
    if (shareAccepted !== false) setStatus(controllerErrors.length
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
      'createMemoBtn', 'createMemoMenu', 'undoBtn', 'redoBtn', 'colorSwatchBtn', 'colorPopover',
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
      try {
        await window.MeldexStandaloneCloud.ensureReady?.({ requireConnection: true });
        const target = await window.apiFetch('/quick-memo/config');
        els.storageLocation.textContent = `保存先: ${target.display_path || target.quick_memo_folder}`;
      } catch (error) {
        els.storageLocation.textContent = cloudConnected() ? String(error.message || error) : '保存先: Dropboxに接続してください';
      }
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
        cloudFolderPath,
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
    on(els.newMemoBtn, 'click', () => { closeMenu(); openCreateMenu(); });
    on(els.createMemoBtn, 'click', () => {
      closeMenu();
      if (els.createMemoMenu.hidden) openCreateMenu();
      else closeCreateMenu(true);
    });
    on(els.createMemoMenu, 'click', async event => {
      const button = event.target.closest('[data-new-memo-mode]');
      if (!button || button.disabled) return;
      closeCreateMenu();
      const created = await startNewMemo(button.dataset.newMemoMode);
      if (!created) els.createMemoBtn.focus();
    });
    on(document, 'pointerdown', event => {
      if (!els.createMemoMenu.contains(event.target) && !els.createMemoBtn.contains(event.target)) closeCreateMenu();
    });
    on(document, 'keydown', event => {
      if (els.createMemoMenu.hidden) return;
      if (event.key === 'Escape' || event.key === 'Tab') {
        closeCreateMenu(event.key === 'Escape');
        if (event.key === 'Escape') event.preventDefault();
        return;
      }
      const buttons = [...els.createMemoMenu.querySelectorAll('button:not([hidden]):not([disabled])')];
      const index = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && buttons.length) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      }
    });
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
    window.addEventListener('online', () => loadTags());
    window.addEventListener('focus', () => loadTags());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loadTags();
    });
    ['meldex:standalone-cloud-ready', 'meldex:standalone-auth-changed', 'meldex:dropbox-auth-session-changed']
      .forEach(type => window.addEventListener(type, () => {
        quickMemoTagSyncGeneration += 1;
        syncQuickMemoTags();
      }));
    window.addEventListener('meldex:tag-dictionary-changed', () => loadTags());
    window.addEventListener('storage', (event) => {
      if (event.key !== QUICK_MEMO_TAG_SYNC_KEY && event.key !== quickMemoTagStorageKey()) return;
      failedLocalWrites.delete(event.key);
      renderTagChips();
      syncQuickMemoTags();
    });
    window.addEventListener('beforeunload', () => persistDraft(collectMemo()));
    // フロートパネルのリサイズ（本体埋め込み時）でも横スクロールのフェード表示を
    // 追随させる。iframeの表示領域が変わればcontentWindowのresizeが発火する。
    window.addEventListener('resize', () => _updateTagChipsOverflowHint());
    window.addEventListener('resize', () => closeCreateMenu());
  }

  function closeCreateMenu(restoreFocus = false) {
    els.createMemoMenu.hidden = true;
    els.createMemoBtn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) els.createMemoBtn.focus();
  }

  function openCreateMenu() {
    if (state.creatingMemo) return;
    const voice = els.createMemoMenu.querySelector('[data-new-memo-mode="voice"]');
    voice.hidden = isCloudMode() && !(window.SpeechRecognition || window.webkitSpeechRecognition);
    els.createMemoMenu.hidden = false;
    els.createMemoBtn.setAttribute('aria-expanded', 'true');
    window.GBTooltip?.hide?.();
    if (typeof window.positionPopup === 'function') {
      // Let the shared viewport clamp measure the natural menu height.
      els.createMemoMenu.style.bottom = 'auto';
      els.createMemoMenu.style.top = '0px';
      window.positionPopup(els.createMemoMenu, els.createMemoBtn.getBoundingClientRect(), { gap: 8 });
    }
    els.createMemoMenu.querySelector('button:not([hidden]):not([disabled])')?.focus();
  }

  function switchMode(mode) {
    const speechAvailable = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const nextMode = ['text', 'pen', 'voice'].includes(mode)
      && !(mode === 'voice' && isCloudMode() && !speechAvailable)
      ? mode
      : 'text';
    if (state.currentMode === 'voice' && nextMode !== 'voice') _stopVoiceCapture();
    state.currentMode = nextMode;
    document.body.dataset.memoMode = state.currentMode;
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
      if (state.currentMode !== 'text') return;
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
    state.currentMode = draft.input_mode || (draft.drawing_png ? 'pen' : 'text');
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
      input_mode: state.currentMode,
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

  async function startNewMemo(mode = 'text') {
    if (state.creatingMemo) return false;
    state.creatingMemo = true;
    els.createMemoBtn.disabled = true;
    try {
      if (!await finalizeVoiceForClose()) return false;
      await drawingController.flush?.();
      const current = collectMemo();
      if ((current.server_path || draftHasContent(current)) && (!persistDraft(current) || !enqueueMemo(current))) {
        setStatus('メモを端末内へ保存できませんでした', true);
        return false;
      }
      if (!await ensureDurableRecords()) return false;
      state.memoEpoch += 1;
      clearTimeout(state.saveTimer);
      state.saveTimer = 0;
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
        input_mode: mode,
      });
      state.dirty = false;
      setStatus('新規メモ');
      libraryController.hide();
      switchMode(mode);
      flushPendingQueue().then((ok) => {
        if (ok) setStatus('新規メモ');
      });
      if (mode === 'pen') els.drawingCanvas.focus({ preventScroll: true });
      if (mode === 'voice') els.voiceRecordBtn.focus({ preventScroll: true });
      return true;
    } catch (error) {
      setStatus('新規メモへ切り替えられませんでした: ' + (error?.message || error), true);
      return false;
    } finally {
      state.creatingMemo = false;
      els.createMemoBtn.disabled = false;
    }
  }

  function resetDrawingCanvas() {
    drawingController.reset('');
  }

  async function preserveCurrentForNavigation() {
    if (!await finalizeVoiceForClose()) throw new Error('音声入力を確定できませんでした');
    await drawingController.flush?.();
    const current = collectMemo();
    if (!state.dirty && !draftHasContent(current)) return true;
    const stored = persistDraft(current);
    const queued = enqueueMemo(current);
    if (!stored || !queued) throw new Error('メモを端末内へ保存できませんでした');
    if (!await ensureDurableRecords()) throw new Error('メモを端末内へ保存できませんでした');
    state.flushRequested = true;
    drainQueue({ manual: false, pending: true });
    return true;
  }

  async function openExistingMemo(memo, requestedEpoch, isCurrent) {
    const epoch = requestedEpoch ?? ++state.memoEpoch;
    await loadTags();
    if (epoch !== state.memoEpoch || (isCurrent && !isCurrent())) return false;
    clearTimeout(state.saveTimer);
    state.saveTimer = 0;
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
    switchMode(memo.drawing_png ? 'pen' : 'text');
    setStatus('過去のメモを開きました');
    loadTags();
    return true;
  }

  async function openMemoPath(path) {
    const epoch = ++state.memoEpoch;
    const targetPath = String(path || '').trim();
    if (!targetPath) throw new Error('クイックメモの保存先を確認できません');
    let memo;
    if (isCloudMode()) {
      const result = await window.MeldexStandaloneCloud.readText(targetPath);
      memo = libraryController.parseMemoText(result?.content ?? result, targetPath, result?.etag);
      if (!memo.quick_memo) throw new Error('対象はクイックメモではありません');
    } else {
      const query = new URLSearchParams({ path: targetPath });
      const response = await fetch(`${API_BASE}/api/quick-memo/item?${query}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.detail || 'クイックメモを読み込めませんでした');
      memo = payload.memo || payload;
    }
    if (epoch !== state.memoEpoch) return false;
    return openExistingMemo(memo, epoch);
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
    if (!(await openMemoPath(path))) throw new Error('対象が切り替わったため、再読み込みを中止しました');
    setStatus('バージョンを復元しました');
  }

  async function applyIncomingShare() {
    const shared = incomingSharePayload();
    if (!shared) return;
    preserveCurrentDraftBeforeShare();
    if (!await ensureDurableRecords()) return false;
    state.memoEpoch += 1;
    state.currentPath = '';
    state.currentVersionTarget = { path: '', type: 'file' };
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
    const content = document.createElement('div');
    content.innerHTML = sanitizeHtml(draft.html || '');
    return !!(
      String(draft.title || '').trim()
      || String(draft.text || '').trim()
      || content.textContent.trim()
      || content.querySelector('img[src]')
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
    // 送信中の入力も同じキューへ載せ、先行応答で保存済みにしない。
    enqueueMemo(memo);
    if (state.saving) state.flushRequested = true;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveNow({ manual: false }), 900);
    setStatus('保存待ち');
  }

  async function saveNow(opts) {
    clearTimeout(state.saveTimer);
    state.saveTimer = 0;
    const memo = collectMemo();
    if (!memo.server_path && !draftHasContent(memo)) return flushPendingQueue();
    const storedDraft = persistDraft(memo);
    const queued = enqueueMemo(memo);
    if (!storedDraft || !queued) {
      state.dirty = true;
      setStatus('保存領域がいっぱいです', true);
      return false;
    }
    await drawingController.flush?.();
    // フレームが直ちに閉じても、上の同期保存で送信待ちを残す。
    const renderedMemo = collectMemo();
    if (renderedMemo.memo_id === memo.memo_id) {
      persistDraft(renderedMemo);
      enqueueMemo(renderedMemo);
    }
    if (!await ensureDurableRecords()) return false;
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
        const capturing = state.voiceStarting || !!state.pendingVoice || !!state.recording || !!state.speech || !!state.voiceFinalizePromise;
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
        if (!persistDraft(memo) || ((memo.server_path || draftHasContent(memo)) && !enqueueMemo(memo))) {
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
    // 許可ダイアログ中の遅いgetUserMedia結果は、このメモで開始させない。
    if (state.voiceStarting) state.memoEpoch += 1;
    const recorder = state.recording;
    const speech = state.speech;
    if (!recorder && !speech && !state.voiceFinalizePromise) return !state.pendingVoice;
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
    return !state.recording && !state.speech && !state.pendingVoice;
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
        setStatus(ok ? (isCloudMode() ? 'Dropboxに保存済み' : 'Meldexに保存済み')
          : state.lastSaveError ? `保存できませんでした: ${state.lastSaveError}。入力を保持しています` : pendingMessage, !ok && !!state.lastSaveError);
        return ok;
      } finally {
        state.saving = false;
        state.savePromise = null;
      }
    })();
    return state.savePromise;
  }

  async function flushQueue() {
    if (navigator.locks?.request) return navigator.locks.request('meldex:quick-memo:sync', flushQueueUnlocked);
    return flushQueueUnlocked();
  }

  async function flushQueueUnlocked() {
    state.lastSaveError = '';
    const snapshot = readJson(QUEUE_KEY, []);
    if (!Array.isArray(snapshot) || !snapshot.length) return true;
    const cloud = isCloudMode();
    if (cloud && !cloudConnected()) return false;
    const sent = new Set();
    const failed = new Set();
    const results = new Map();
    const signatures = new Map(snapshot.map((item) => [item.memo_id, queueItemSignature(item)]));
    for (const item of snapshot) {
      try {
        const result = cloud ? await saveMemoCloud(item) : await postJson('/api/quick-memo', item);
        if (!result || result.ok !== true) throw new Error(result && (result.error || result.detail) || 'save failed');
        results.set(item.memo_id, result);
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
          if (result.memo_revision) current.memo_revision = result.memo_revision;
          if (result.cloud_etag) current.cloud_etag = result.cloud_etag;
          // 保存中にタグを付け外しした場合、古い要求の戻り値で現在の選択を
          // 巻き戻さない。updated_at が同じ要求に限ってサーバー正規化を反映する。
          if (Array.isArray(result.tags) && current.updated_at === item.updated_at) {
            current.tags = result.tags;
            state.selectedTags = [...result.tags];
            renderTagChips();
          }
          writeJson(CURRENT_KEY, current);
        }
        if (Array.isArray(item.tags) && item.tags.length) {
          if (typeof window.MeldexGlobalTags?.mergeExistingTagNames !== 'function') {
            throw new Error('共通タグとの統合機能を読み込めませんでした');
          }
          await window.MeldexGlobalTags.mergeExistingTagNames(result.path || item.server_path, item.tags);
        }
        sent.add(item.memo_id);
      } catch (error) {
        state.lastSaveError = syncFailureDetail(error);
        failed.add(item.memo_id);
      }
    }
    const latest = readJson(QUEUE_KEY, []);
    const remaining = (Array.isArray(latest) ? latest : []).filter((item) => {
      if (!sent.has(item.memo_id) && !failed.has(item.memo_id)) return true;
      if (failed.has(item.memo_id)) return true;
      return queueItemSignature(item) !== signatures.get(item.memo_id);
    });
    remaining.forEach(item => {
      const result = results.get(item.memo_id);
      if (result) {
        item.server_path = result.path || item.server_path || '';
        if (result.memo_revision) item.memo_revision = result.memo_revision;
        if (result.cloud_etag) item.cloud_etag = result.cloud_etag;
      }
    });
    if (!writeJson(QUEUE_KEY, remaining)) return false;
    return remaining.length === 0;
  }

  function enqueueMemo(memo) {
    // A mode selection, empty paragraph or tag toggle must not create a blank file.
    // Existing files still accept intentional clearing of their contents.
    if (!memo.server_path && !draftHasContent(memo)) return true;
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

  async function cloudFolderPath() {
    const target = await window.apiFetch('/quick-memo/config');
    if (!target?.quick_memo_folder) throw new Error('本体のクイックメモシートを確認できません');
    return target.quick_memo_folder;
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

  function cloudMemoPath(item, folder) {
    if (item.server_path) return String(item.server_path).replace(/\\/g, '/');
    const stamp = String(item.created_at || new Date().toISOString())
      .replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '_').slice(0, 15);
    const id = String(item.memo_id || item.client_id || Date.now()).replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
    const firstLine = (item.text || '').trim().split(/\r?\n/)[0] || '';
    const title = String(item.title || firstLine || 'メモ').trim().slice(0, 40).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'メモ';
    return `${folder}/${stamp}_${title}_${id}.md`;
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
    window.__MELDEX_QUICK_MEMO_TEST__.saveMemoCloud = saveMemoCloud;
  }

  // シート内の同じ行をetagで条件付き保存し、新規行はcreate_onlyで重複を防ぐ。
  function cloudNotFound(error) {
    const status = Number(error?.status || error?.status_code || 0);
    if (status) return status === 404;
    return /^(not_found|path\/not_found)$/.test(String(error?.code || error?.error_summary || ''))
      || /^(not_found|path\/not_found)$/.test(String(error?.message || ''));
  }

  async function cloudWriteFile(path, content, existingData) {
    let current = existingData || null;
    try {
      if (!current) current = await window.apiFetch('/quick-memo/file?path=' + encodeURIComponent(path));
    } catch (error) {
      if (!cloudNotFound(error)) {
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
    return window.apiPost('/quick-memo/file?path=' + encodeURIComponent(path), body);
  }

  async function saveMemoCloud(item) {
    await window.MeldexStandaloneCloud.ensureReady?.({ requireConnection: true });
    const path = cloudMemoPath(item, item.server_path ? '' : await cloudFolderPath());
    const folder = path.split('/').slice(0, -1).join('/');
    const tags = cloudMemoTags(item);
    // 本文とクイックメモ識別子を一度の条件付き書込で保存する。
    // 空のエントリを先に作ると、本文の失敗・再試行で重複が残る。
    let existingData = null;
    try {
      existingData = await window.apiFetch('/quick-memo/file?path=' + encodeURIComponent(path));
    } catch (error) {
      if (!cloudNotFound(error)) {
        throw error;
      }
    }
    const existing = parseCloudMemoFile(existingData);
    if (existingData && (existing.frontmatter.quick_memo !== true || existing.frontmatter.quick_memo_id !== item.memo_id)) {
      throw new Error('保存先は別のメモです。入力を保持しています');
    }
    if (item.cloud_etag && item.cloud_etag !== existing.etag && item.cloud_etag !== existingData?.legacy_etag) {
      throw new Error('クイックメモが別の画面で変更されています。入力を保持して再読み込みしてください');
    }
    const frontmatter = cloudMemoFrontmatter(item, path, tags, existing.frontmatter);
    const written = await cloudWriteFile(
      path,
      cloudFrontmatterText(frontmatter, cloudMemoBody(item), existing.rawFrontmatter),
      existingData,
    );
    return { ok: true, path, target_sheet: folder, tags, cloud_etag: written?.etag || '' };
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
      const voiceOption = els.createMemoMenu.querySelector('[data-new-memo-mode="voice"]');
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
      loadStorageLocation();
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
    window.addEventListener('meldex:standalone-root-changed', refreshConnectBanner);
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
  // 上部の候補は、Dropbox個人設定で同期するクイックメモタグだけに限定する。
  // 共通タグの選択と専用一覧への登録は別操作とし、共通辞書へ書き込まない。

  const QUICK_MEMO_TAGS_KEY = 'meldex:quick-memo:tag-catalog:v1';
  const QUICK_MEMO_TAG_SYNC_KEY = 'meldex:quick-memo:tag-sync:v1';
  const QUICK_MEMO_TAG_PREFERENCE = '/personal-preferences/quick-memo-tags';
  const RECENT_TAG_NAMES_KEY = 'meldex:quick-memo:recent-tags:v1';
  const RECENT_TAG_NAMES_LIMIT = 24;
  const TAG_RAIL_DISPLAY_LIMIT = 16;
  let quickMemoTagSavePromise = Promise.resolve();
  let quickMemoTagSyncPromise = null;
  let quickMemoTagSyncAgain = false;
  let quickMemoTagSyncGeneration = 0;
  let quickMemoTagSyncMessage = 'Dropboxに接続すると登録一覧を同期します';
  let quickMemoTagSyncRetry = false;

  function normalizeQuickMemoTags(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).flatMap((item) => {
      const name = String(item?.name || '').trim();
      if (!name || seen.has(name)) return [];
      seen.add(name);
      const color = /^#[0-9a-f]{6}$/i.test(String(item?.color || '')) ? item.color : '';
      return [{ name, color }];
    });
  }

  function quickMemoTags() {
    return normalizeQuickMemoTags(readJson(quickMemoTagStorageKey(), []));
  }

  function quickMemoTagStorageKey(scope = readJson(QUICK_MEMO_TAG_SYNC_KEY, {})?.activeScope) {
    return scope ? `${QUICK_MEMO_TAGS_KEY}:account:${encodeURIComponent(scope)}` : QUICK_MEMO_TAGS_KEY;
  }

  async function persistQuickMemoTagRecord(key, value) {
    let localOk = false;
    let previousLocal = null;
    try { previousLocal = localStorage.getItem(key); } catch {}
    try {
      localStorage.setItem(key, JSON.stringify(value));
      localOk = true;
    } catch {}
    const store = window.MeldexStandaloneLocalDrafts;
    const durable = store?.putRaw ? Promise.resolve().then(async () => {
      await store.putRaw(`quick-memo:${key}`, value);
      if (key === QUICK_MEMO_TAG_SYNC_KEY) {
        await store.putRaw(`quick-memo:recovery:${key}`, localOk ? null : { value, previousLocal });
      }
    }) : null;
    if (!localOk) {
      if (!durable) throw new Error('クイックメモタグを端末に保存できませんでした');
      await durable;
      failedLocalWrites.add(key);
    } else {
      failedLocalWrites.delete(key);
      durable?.catch(() => {});
    }
    durableMemory.set(key, structuredClone(value));
  }

  function mutateQuickMemoTags(action) {
    const save = quickMemoTagSavePromise.then(action);
    quickMemoTagSavePromise = save.catch(() => {});
    return save;
  }

  async function readDurableQuickMemoTags(key) {
    const local = normalizeQuickMemoTags(readJson(key, []));
    const store = window.MeldexStandaloneLocalDrafts;
    if (!store?.getRaw) return local;
    const saved = await Promise.race([
      store.getRaw(`quick-memo:${key}`, null),
      new Promise((_, reject) => setTimeout(() => reject(new Error('端末のタグを読み込めないため同期を保留しています')), 1500)),
    ]);
    if (saved != null && !Array.isArray(saved)) throw new Error('端末のタグ形式を読み込めませんでした');
    return normalizeQuickMemoTags([...local, ...normalizeQuickMemoTags(saved)]);
  }

  async function hydrateQuickMemoTags() {
    const store = window.MeldexStandaloneLocalDrafts;
    if (!store?.getRaw) return;
    for (const key of new Set([QUICK_MEMO_TAGS_KEY, quickMemoTagStorageKey()])) {
      const saved = await Promise.race([
        store.getRaw(`quick-memo:${key}`, null).catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), 1500)),
      ]);
      if (!Array.isArray(saved)) continue;
      const merged = normalizeQuickMemoTags([...normalizeQuickMemoTags(readJson(key, [])), ...saved]);
      durableMemory.set(key, merged);
      try {
        localStorage.setItem(key, JSON.stringify(merged));
        failedLocalWrites.delete(key);
      } catch {
        failedLocalWrites.add(key);
      }
    }
  }

  function registerQuickMemoTag(name, color = '') {
    const save = mutateQuickMemoTags(async () => {
      const existing = quickMemoTags();
      const next = normalizeQuickMemoTags([...existing, { name, color }]);
      if (next.length === existing.length) return;
      await persistQuickMemoTagRecord(quickMemoTagStorageKey(), next);
      renderTagChips();
    });
    save.then(() => { syncQuickMemoTags(); }, () => {});
    return save;
  }

  async function requestQuickMemoTagPreference(options = {}) {
    if (isCloudMode() && !cloudConnected()) return { available: false };
    let fetcher = null;
    try {
      if (window.parent !== window && window.parent?.location?.origin === location.origin
        && typeof window.parent.apiFetch === 'function') fetcher = window.parent.apiFetch;
    } catch {}
    if (!fetcher && typeof window.apiFetch === 'function') fetcher = window.apiFetch;
    if (fetcher) return fetcher(QUICK_MEMO_TAG_PREFERENCE, { silentError: true, ...options });
    if (typeof fetch !== 'function') return { available: false };
    const response = await fetch(API_BASE + '/api' + QUICK_MEMO_TAG_PREFERENCE, options);
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data?.detail || data?.error || `HTTP ${response.status}`), { status: response.status });
    return data;
  }

  function notifyQuickMemoTagSync(message, retry = false) {
    quickMemoTagSyncMessage = message;
    quickMemoTagSyncRetry = retry;
    window.dispatchEvent?.(new CustomEvent('meldex:quick-memo-tag-sync'));
  }

  function syncFailureDetail(error) {
    const detail = String(error?.userMessage || error?.message || error || '同期できませんでした');
    // Static hosts/proxies can return an entire error page. Never expose its
    // markup as a tag/status message, including on an older installed PWA.
    if (/<(?:!doctype|html|head|body|title|meta|style)\b/i.test(detail)) {
      const status = Number(error?.status) || Number(detail.match(/HTTP\s+(\d{3})/i)?.[1]);
      return '同期先へ接続できませんでした' + (status ? `（HTTP ${status}）` : '');
    }
    return detail.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function mergeQuickMemoTags(remote, local) {
    return normalizeQuickMemoTags([...remote, ...local])
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  async function syncQuickMemoTagsNow(generation) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remote = await requestQuickMemoTagPreference();
      if (generation !== quickMemoTagSyncGeneration) return { stale: true };
      if (remote?.available !== true) {
        notifyQuickMemoTagSync('Dropbox未接続です。登録一覧は端末に保存しています');
        return { available: false };
      }
      const scope = String(remote.scopeId || '');
      if (!scope) throw new Error('Dropboxアカウントの保存先を確認できませんでした');
      const payload = remote.exists ? remote.payload : { schemaVersion: 1, tags: [] };
      if (payload?.schemaVersion !== 1 || !Array.isArray(payload?.tags)
        || payload.tags.some(tag => typeof tag?.name !== 'string' || !tag.name.trim()
          || (tag.color != null && tag.color !== '' && !/^#[0-9a-f]{6}$/i.test(tag.color)))) {
        await mutateQuickMemoTags(async () => {
          if (generation !== quickMemoTagSyncGeneration) return;
          const previous = readJson(QUICK_MEMO_TAG_SYNC_KEY, {}) || {};
          await persistQuickMemoTagRecord(QUICK_MEMO_TAG_SYNC_KEY, { ...previous, activeScope: scope });
          renderTagChips();
        });
        throw new Error('同期先のタグ形式を読み込めないため、上書きしていません');
      }
      const merged = await mutateQuickMemoTags(async () => {
        if (generation !== quickMemoTagSyncGeneration) return null;
        const syncState = readJson(QUICK_MEMO_TAG_SYNC_KEY, {}) || {};
        const key = quickMemoTagStorageKey(scope);
        // アカウント未所属の旧登録は、最初に接続したアカウントにだけ引き継ぐ。
        const legacy = syncState.migrationScope ? [] : await readDurableQuickMemoTags(QUICK_MEMO_TAGS_KEY);
        const local = await readDurableQuickMemoTags(key);
        const next = mergeQuickMemoTags(payload.tags, [...local, ...legacy]);
        await persistQuickMemoTagRecord(key, next);
        if (generation !== quickMemoTagSyncGeneration) return null;
        await persistQuickMemoTagRecord(QUICK_MEMO_TAG_SYNC_KEY, {
          ...syncState, activeScope: scope, migrationScope: syncState.migrationScope || scope,
        });
        renderTagChips();
        return next;
      });
      if (!merged || generation !== quickMemoTagSyncGeneration) return { stale: true };
      if (JSON.stringify(mergeQuickMemoTags(payload.tags, [])) === JSON.stringify(merged)) {
        notifyQuickMemoTagSync('Dropboxの同期領域に保存済みです');
        return { available: true, pushed: false };
      }
      try {
        const result = await requestQuickMemoTagPreference({
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: { ...payload, tags: merged },
            expectedRevision: remote.revision || null, expectedScopeId: scope }),
        });
        if (generation !== quickMemoTagSyncGeneration) return { stale: true };
        if (result?.available !== true || result?.ok !== true || result.scopeId !== scope) {
          throw new Error('Dropboxへ保存できませんでした');
        }
        notifyQuickMemoTagSync('Dropboxの同期領域に保存済みです');
        return { available: true, pushed: true };
      } catch (error) {
        const conflict = Number(error?.status || error?.response?.status) === 409
          || error?.name === 'SystemStorageConflictError' || error?.code === 'system_storage_conflict';
        if (!conflict || attempt === 2) throw error;
      }
    }
  }

  function syncQuickMemoTags() {
    if (quickMemoTagSyncPromise) {
      quickMemoTagSyncAgain = true;
      return quickMemoTagSyncPromise;
    }
    quickMemoTagSyncPromise = syncQuickMemoTagsNow(quickMemoTagSyncGeneration)
      .catch(error => {
        notifyQuickMemoTagSync('タグの同期待ちです: ' + syncFailureDetail(error), true);
        return { pending: true, error };
      }).finally(() => {
        quickMemoTagSyncPromise = null;
        if (quickMemoTagSyncAgain) {
          quickMemoTagSyncAgain = false;
          syncQuickMemoTags();
        }
      });
    return quickMemoTagSyncPromise;
  }

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
    const registered = quickMemoTags().map(tag => tag.name);
    const known = new Set(registered);
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
    registered.forEach(push);
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

  function _applyUnifiedTagCatalog(data) {
    const tags = Array.isArray(data?.tags) ? data.tags : [];
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const groupsById = Object.fromEntries(groups.map(group => [group.id, group]));
    const nextColors = {};
    const nextIds = {};
    tags.forEach((tag) => {
      const name = String(tag?.name || '').trim();
      if (!name) return;
      const groupColor = String(groupsById[tag.group_id]?.color || '').trim();
      nextColors[name] = window.MeldexGlobalTags?.effectiveTagColor?.(tag, groupsById)
        || groupColor || String(tag?.color || '').trim();
      nextIds[name] = String(tag?.id || '');
    });
    state.tagCatalog = { tags: [...tags], groups: [...groups] };
    state.commonTagColors = nextColors;
    state.tagIdsByName = nextIds;
    state.tagCatalogError = '';
    state.selectedTagIds = state.selectedTags
      .map(name => nextIds[name])
      .filter(Boolean);
    renderTagChips();
  }

  async function _loadTagsNow() {
    renderTagChips();
    syncQuickMemoTags();
    if (isCloudMode() && !cloudConnected()) return;
    try {
      _applyUnifiedTagCatalog(await _loadUnifiedTagCatalog());
    } catch (error) {
      const detail = syncFailureDetail(error);
      const message = /404|file not found|failed to fetch|network/i.test(detail)
        ? (isCloudMode() ? '共通タグを同期できません。Dropbox接続を確認してください'
          : '共通タグはMeldexへ接続すると利用できます')
        : '共通タグを読み込めませんでした: ' + detail.slice(0, 160);
      state.tagCatalogError = message;
      setStatus(message, !/接続すると利用できます/.test(message));
    }
  }

  function loadTags() {
    if (tagLoadPromise) return tagLoadPromise;
    tagLoadPromise = _loadTagsNow().finally(() => { tagLoadPromise = null; });
    return tagLoadPromise;
  }

  function quickMemoTagRecord(name) {
    return state.tagCatalog.tags.find(tag => String(tag?.name || '').trim() === name)
      || quickMemoTags().find(tag => tag.name === name) || { name, color: '' };
  }

  function _buildTagChip(tag) {
    const isSelected = state.selectedTags.includes(tag);
    const record = quickMemoTagRecord(tag);
    const title = `${tag}（${record.id ? '共通タグ' : 'クイックメモタグ'}）`
      + (record.description ? `\n${record.description}` : '');
    const chip = window.MeldexGlobalTags?.createTagChip
      ? window.MeldexGlobalTags.createTagChip(record, {
          className: 'qm-tag-chip' + (isSelected ? ' is-selected' : ''),
          title,
          groupsById: Object.fromEntries(state.tagCatalog.groups.map(group => [group.id, group])),
          dataset: { tagId: record.id || '' },
          ariaLabel: `${tag}${isSelected ? '、選択中' : '、未選択'}`,
          onActivate: () => toggleTag(tag),
        })
      : document.createElement('span');
    if (!chip.classList.contains('gb-tag-chip')) {
      chip.className = 'gb-tag-chip qm-tag-chip' + (isSelected ? ' is-selected' : '');
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
    chip.title = `クイックメモタグ（${allNames.length}件）\n${allNames.join('、')}`;
    chip.setAttribute('aria-label', `残り${hiddenCount}件を含むクイックメモタグから選ぶ`);
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
      '登録したクイックメモタグだけを表示します。＋から専用タグの追加や共通タグの登録ができます',
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
    if (state.voiceStarting || state.speech || state.recording || state.voiceFinalizePromise) return;
    if (state.pendingVoice) {
      const pending = state.pendingVoice;
      state.voiceFinalizePromise = transcribeBlob(pending.blob, pending.epoch)
        .finally(() => { state.voiceFinalizePromise = null; });
      return state.voiceFinalizePromise;
    }
    const epoch = state.memoEpoch;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      startBrowserSpeech(Recognition);
      return;
    }
    if (isCloudMode()) {
      els.voiceStatus.textContent = 'このブラウザではボイス認識を利用できません';
      return;
    }
    state.voiceStarting = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (epoch !== state.memoEpoch || state.currentMode !== 'voice') {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream);
      state.recordChunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) state.recordChunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (state.recording === recorder) state.recording = null;
        updateVoiceUI('stopped');
        if (recorder._meldexCancelled) return;
        const blob = new Blob(state.recordChunks, { type: recorder.mimeType || 'audio/webm' });
        state.pendingVoice = { blob, epoch };
        state.voiceFinalizePromise = transcribeBlob(blob, epoch)
          .finally(() => { state.voiceFinalizePromise = null; });
      };
      state.recording = recorder;
      recorder.start();
      state.voiceStartTime = Date.now();
      startVoiceTimer();
      updateVoiceUI('recording');
    } catch {
      stream?.getTracks().forEach(track => track.stop());
      state.recording = null;
      els.voiceStatus.textContent = 'マイクを利用できません';
    } finally {
      state.voiceStarting = false;
    }
  }

  function startBrowserSpeech(Recognition) {
    if (state.speech) return;
    const rec = new Recognition();
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    let accumulated = els.voiceTranscript.textContent || '';
    rec.onresult = (event) => {
      if (state.speech !== rec) return;
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      }
      if (finalText) {
        accumulated += finalText + ' ';
        els.voiceTranscript.textContent = accumulated;
        insertText(finalText);
        scheduleSave();
      }
    };
    rec.onerror = () => { els.voiceStatus.textContent = 'ボイス認識エラー'; };
    rec.onend = () => {
      if (state.speech !== rec) return;
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
    try { rec.start(); } catch {
      state.speech = null;
      els.voiceStatus.textContent = 'マイクを利用できません';
      return;
    }
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
    }
    updateVoiceUI('stopped');
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

  async function transcribeBlob(blob, epoch = state.memoEpoch) {
    els.voiceStatus.textContent = '文字起こし中...';
    try {
      if (isCloudMode()) throw new Error('cloud-local-transcription-disabled');
      const dataUrl = await blobToDataUrl(blob);
      const result = await postJson('/api/quick-memo/transcribe', {
        audio_base64: dataUrl,
        mime_type: blob.type || 'audio/webm',
      });
      if (epoch !== state.memoEpoch) return;
      if (result.text) {
        els.voiceTranscript.textContent = (els.voiceTranscript.textContent + ' ' + result.text).trim();
        insertText(result.text);
        scheduleSave();
      }
      state.pendingVoice = null;
      els.voiceRecordBtn.setAttribute('aria-label', '録音開始');
      els.voiceRecordBtn.setAttribute('title', '録音開始');
      els.voiceStatus.textContent = '文字起こし完了';
    } catch (error) {
      els.voiceStatus.textContent = '文字起こしに失敗しました。録音を保持しています。マイクボタンで再試行できます: ' + (error?.message || error);
      els.voiceRecordBtn.setAttribute('aria-label', '文字起こしを再試行');
      els.voiceRecordBtn.setAttribute('title', '文字起こしを再試行');
    }
  }

  function insertText(text) {
    editorController.mutate(() => {
      const before = els.editor.innerHTML;
      els.editor.focus();
      document.execCommand('insertText', false, text + ' ');
      // ボイスモードでは本文欄が非表示で、execCommandは挿入できない。
      if (els.editor.innerHTML === before) els.editor.appendChild(document.createTextNode(text + ' '));
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
    if (failedLocalWrites.has(key) && durableMemory.has(key)) return structuredClone(durableMemory.get(key));
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const value = JSON.parse(raw);
        durableMemory.set(key, value);
        return value;
      }
    } catch {}
    return durableMemory.has(key) ? structuredClone(durableMemory.get(key)) : fallback;
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
      title.textContent = 'タグ';
      const selectedCount = document.createElement('span');
      selectedCount.className = 'qm-tag-picker-count';
      selectedCount.setAttribute('aria-live', 'polite');
      const heading = document.createElement('div');
      heading.className = 'qm-tag-picker-heading';
      heading.append(title, selectedCount);
      let source = 'quick-memo';
      const sources = document.createElement('div');
      sources.className = 'qm-tag-picker-sources';
      sources.setAttribute('aria-label', '表示するタグ');
      const quickMemoSource = document.createElement('button');
      quickMemoSource.type = 'button';
      quickMemoSource.textContent = 'クイックメモタグ';
      const commonSource = document.createElement('button');
      commonSource.type = 'button';
      commonSource.textContent = '共通タグ';
      sources.append(quickMemoSource, commonSource);
      const hint = document.createElement('p');
      hint.className = 'qm-tag-picker-hint';
      const syncStatus = document.createElement('div');
      syncStatus.className = 'qm-tag-sync-status';
      syncStatus.setAttribute('role', 'status');
      syncStatus.setAttribute('aria-live', 'polite');
      const syncText = document.createElement('span');
      const syncRetry = document.createElement('button');
      syncRetry.type = 'button';
      syncRetry.textContent = '同期を再試行';
      syncStatus.append(syncText, syncRetry);
      const updateSyncStatus = () => {
        syncText.textContent = quickMemoTagSyncMessage;
        syncRetry.hidden = !quickMemoTagSyncRetry;
      };
      syncRetry.addEventListener('click', () => {
        syncRetry.disabled = true;
        syncQuickMemoTags().finally(() => { syncRetry.disabled = false; });
      });
      updateSyncStatus();
      window.addEventListener('meldex:quick-memo-tag-sync', updateSyncStatus);
      const errorMessage = document.createElement('p');
      errorMessage.className = 'qm-tag-picker-error';
      errorMessage.setAttribute('role', 'alert');
      errorMessage.hidden = true;
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
      createInput.placeholder = '新しいクイックメモタグ名';
      createInput.setAttribute('aria-label', '新しいクイックメモタグ名');
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
      dialog.append(heading, sources, hint, syncStatus, search, tree, createRow, errorMessage, actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        overlay.remove();
        document.removeEventListener('keydown', onKeydown, true);
        window.removeEventListener('meldex:quick-memo-tag-sync', updateSyncStatus);
        els.addTagBtn?.focus?.();
        resolve();
      };
      const compare = (left, right) => Number(left?.sort_index || 0) - Number(right?.sort_index || 0)
        || String(left?.name || '').localeCompare(String(right?.name || ''), 'ja');
      const updateCount = () => {
        selectedCount.textContent = `${state.selectedTags.length}件選択中`;
      };
      const showError = error => {
        errorMessage.textContent = '登録できませんでした: ' + (error?.message || error);
        errorMessage.hidden = false;
      };
      const tagRow = (tag, depth, allowRegistration = false) => {
        const name = String(tag?.name || '').trim();
        const row = document.createElement('div');
        row.className = 'qm-tag-picker-row';
        row.setAttribute('role', 'treeitem');
        const label = document.createElement('label');
        label.className = 'qm-tag-picker-tag';
        label.style.setProperty('--qm-tag-depth', String(depth));
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.selectedTags.includes(name);
        checkbox.setAttribute('aria-label', `${name}を${checkbox.checked ? '解除' : '選択'}`);
        const swatch = document.createElement('span');
        swatch.className = 'qm-tag-picker-swatch';
        const color = state.commonTagColors[name] || tag.color || '';
        swatch.style.background = color || 'var(--qm-accent)';
        const text = document.createElement('span');
        text.textContent = name;
        checkbox.addEventListener('change', () => {
          toggleTag(name);
          checkbox.checked = state.selectedTags.includes(name);
          checkbox.setAttribute('aria-label', `${name}を${checkbox.checked ? '解除' : '選択'}`);
          updateCount();
        });
        label.append(checkbox, swatch, text);
        row.appendChild(label);
        if (allowRegistration) {
          const register = document.createElement('button');
          register.type = 'button';
          register.className = 'qm-tag-picker-register';
          const registered = quickMemoTags().some(item => item.name === name);
          register.textContent = registered ? '登録済み' : '登録';
          register.disabled = registered;
          register.setAttribute('aria-label', `${name}をクイックメモタグに登録`);
          register.title = 'クイックメモタグに登録';
          register.addEventListener('click', async () => {
            register.disabled = true;
            errorMessage.hidden = true;
            try {
              await registerQuickMemoTag(name, color);
              register.textContent = '登録済み';
            } catch (error) {
              register.disabled = false;
              showError(error);
            }
          });
          row.appendChild(register);
        }
        return row;
      };
      const renderTree = () => {
        tree.innerHTML = '';
        const filter = search.value.trim().toLocaleLowerCase('ja');
        const matches = tag => !filter || String(tag?.name || '').toLocaleLowerCase('ja').includes(filter);
        quickMemoSource.setAttribute('aria-pressed', source === 'quick-memo' ? 'true' : 'false');
        commonSource.setAttribute('aria-pressed', source === 'common' ? 'true' : 'false');
        createRow.hidden = source !== 'quick-memo';
        hint.textContent = source === 'quick-memo'
          ? '上部には登録したクイックメモタグだけを表示します。'
          : '共通タグはこのメモに選択できます。「登録」でクイックメモタグにも追加できます。';
        if (source === 'quick-memo') {
          const registered = quickMemoTags();
          registered.filter(matches).forEach(tag => tree.appendChild(tagRow(tag, 0)));
          const unregistered = state.selectedTags
            .filter(name => !registered.some(tag => tag.name === name))
            .map(name => ({ name }))
            .filter(matches);
          if (unregistered.length) {
            const group = document.createElement('details');
            group.className = 'qm-tag-picker-group';
            group.open = true;
            group.setAttribute('role', 'group');
            const summary = document.createElement('summary');
            summary.textContent = 'このメモだけのタグ';
            group.append(summary, ...unregistered.map(tag => tagRow(tag, 1, true)));
            tree.appendChild(group);
          }
          if (!tree.children.length) {
            const empty = document.createElement('div');
            empty.className = 'qm-tag-picker-empty';
            empty.textContent = filter ? '一致するタグがありません' : 'クイックメモタグを追加するか、共通タグから登録してください';
            tree.appendChild(empty);
          }
          updateCount();
          return;
        }
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
            .map(tag => tagRow(tag, depth + 1, true));
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
        const ungrouped = tags.filter(tag => !tag?.group_id || !rootIds.has(String(tag.group_id)))
          .filter(tag => !filter || String(tag?.name || '').toLocaleLowerCase('ja').includes(filter));
        if (ungrouped.length) {
          const details = document.createElement('details');
          details.className = 'qm-tag-picker-group';
          details.open = true;
          const summary = document.createElement('summary');
          summary.textContent = '未分類';
          details.append(summary, ...ungrouped.map(tag => tagRow(tag, 1, true)));
          tree.appendChild(details);
        }
        if (!tree.children.length) {
          const empty = document.createElement('div');
          empty.className = 'qm-tag-picker-empty';
          empty.textContent = state.tagCatalogError || (filter ? '一致するタグがありません' : '共通タグがありません');
          tree.appendChild(empty);
        }
        updateCount();
      };
      const createTag = async () => {
        if (createButton.disabled) return;
        const name = createInput.value.trim();
        if (!name) return;
        createButton.disabled = true;
        errorMessage.hidden = true;
        try {
          await registerQuickMemoTag(name);
          if (!state.selectedTags.includes(name)) toggleTag(name);
          _recordRecentTagName(name);
          createInput.value = '';
          search.value = '';
          renderTree();
          createInput.focus();
        } catch (error) {
          showError(error);
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
          const focusable = Array.from(dialog.querySelectorAll('input, button, summary'))
            .filter(item => !item.disabled && item.getClientRects().length);
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
      const setSource = next => {
        source = next;
        errorMessage.hidden = true;
        renderTree();
      };
      quickMemoSource.addEventListener('click', () => setSource('quick-memo'));
      commonSource.addEventListener('click', () => setSource('common'));
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
    let localOk = false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      failedLocalWrites.delete(key);
      localOk = true;
    } catch {
      failedLocalWrites.add(key);
    }
    const store = window.MeldexStandaloneLocalDrafts;
    const recovery = localOk ? null : { value, previousLocal: (() => { try { return localStorage.getItem(key); } catch { return null; } })() };
    const durable = store?.putRaw ? Promise.all([
      store.putRaw(`quick-memo:${key}`, value),
      store.putRaw(`quick-memo:recovery:${key}`, recovery),
    ]) : null;
    durable?.then?.(
      () => { state.localSaveFailed = false; },
      error => {
        state.localSaveFailed = true;
        setStatus('端末への保存に失敗: ' + (error?.message || error), true);
      },
    );
    return localOk || !!durable;
  }

  async function ensureDurableRecords() {
    if (!failedLocalWrites.size) return true;
    try {
      const store = window.MeldexStandaloneLocalDrafts;
      if (!store?.putRaw) throw new Error('端末下書きの保存機能を利用できません');
      for (const key of failedLocalWrites) {
        const value = readJson(key, null);
        let previousLocal = null;
        try { previousLocal = localStorage.getItem(key); } catch {}
        await store.putRaw(`quick-memo:${key}`, value);
        await store.putRaw(`quick-memo:recovery:${key}`, { value, previousLocal });
      }
      state.localSaveFailed = false;
      return true;
    } catch (error) {
      state.localSaveFailed = true;
      setStatus('端末への保存に失敗: ' + (error?.message || error), true);
      return false;
    }
  }

  async function hydrateDurableRecords() {
    const store = window.MeldexStandaloneLocalDrafts;
    if (!store?.getRaw) return;
    for (const key of [CURRENT_KEY, QUEUE_KEY, QUICK_MEMO_TAG_SYNC_KEY]) {
      // IndexedDB の open/transaction がブラウザ側で応答しない場合でも、localStorage の
      // 下書きで編集UIを起動できるようにする。未完了のPromiseは後から解決してもここでは
      // 状態へ書き戻さないため、起動後の入力を古い値で上書きしない。
      const records = await Promise.race([
        Promise.all([store.getRaw(`quick-memo:${key}`, null), store.getRaw(`quick-memo:recovery:${key}`, null)]).catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), 1500)),
      ]);
      if (!records) continue;
      const [value, recovery] = records;
      if (value != null) durableMemory.set(key, value);
      let local = null;
      try { local = localStorage.getItem(key); } catch {}
      if (recovery && recovery.previousLocal === local) {
        durableMemory.set(key, recovery.value);
        try { localStorage.setItem(key, JSON.stringify(recovery.value)); }
        catch { failedLocalWrites.add(key); }
      }
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
