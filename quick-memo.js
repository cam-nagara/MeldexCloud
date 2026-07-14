(function () {
  'use strict';

  const QUEUE_KEY = 'meldex:quick-memo:queue:v1';
  const CURRENT_KEY = 'meldex:quick-memo:current:v1';
  const CLIENT_ID_KEY = 'meldex:quick-memo:client-id:v1';
  const TAGS_CACHE_KEY = 'meldex:quick-memo:tags-cache:v1';
  const API_BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8765' : '';
  const els = {};
  const state = {
    dirty: false,
    saving: false,
    drawMode: false,
    drawTool: 'pen',
    drawing: false,
    hasDrawing: false,
    lastPoint: null,
    speech: null,
    recording: null,
    recordChunks: [],
    saveTimer: 0,
    flushRequested: false,
    share: null,
    currentMode: 'text',
    allTags: [],
    selectedTags: [],
    voiceTimerInterval: null,
    voiceStartTime: 0,
    voicePausing: false,
    installPrompt: null,
    memoList: [],
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindElements();
    restoreDraft();
    applyIncomingShare();
    setupCanvas();
    bindEvents();
    switchMode(state.currentMode);
    loadTags();
    listenInstallPrompt();
    registerServiceWorker();
    setStatus('入力できます');
    setTimeout(flushPendingQueue, 120);
  }

  function bindElements() {
    [
      'syncStatus', 'listBtn', 'installBtn', 'autoTagBtn', 'newMemoBtn', 'saveBtn',
      'titleInput', 'tagChips', 'addTagBtn', 'tagSelector', 'editor', 'drawingCanvas',
      'colorInput', 'widthInput', 'markerBtn', 'fillBtn', 'eraserBtn', 'clearDrawingBtn',
      'voiceRecordBtn', 'voicePauseBtn', 'voiceResumeBtn', 'voiceStopBtn',
      'voicePanel', 'voiceTimer', 'voiceTranscript', 'voiceStatus',
      'listView', 'listBackBtn', 'listSearch', 'listTagFilter', 'listContent', 'editorView',
    ].forEach((id) => { els[id] = document.getElementById(id); });
    els.modeTabs = document.querySelectorAll('.qm-mode-tab');
    els.toolbarGroups = document.querySelectorAll('.qm-toolbar-group');
    els.toolbar = document.querySelector('.qm-toolbar');
  }

  function bindEvents() {
    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('click', () => {
        document.execCommand(button.dataset.command, false, null);
        els.editor.focus();
        scheduleSave();
      });
    });
    ['input', 'keyup', 'paste'].forEach((eventName) => els.editor.addEventListener(eventName, scheduleSave));
    els.editor.addEventListener('input', autoFillTitle);
    els.titleInput.addEventListener('input', scheduleSave);
    els.saveBtn.addEventListener('click', () => saveNow({ manual: true }));
    els.autoTagBtn.addEventListener('click', () => saveNow({ manual: true, autoTag: true }));
    els.newMemoBtn.addEventListener('click', startNewMemo);
    els.markerBtn.addEventListener('click', () => setDrawTool('marker'));
    els.fillBtn.addEventListener('click', fillDrawing);
    els.eraserBtn.addEventListener('click', () => setDrawTool('eraser'));
    els.clearDrawingBtn.addEventListener('click', clearDrawing);
    els.modeTabs.forEach((tab) => {
      tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    });
    els.addTagBtn.addEventListener('click', addNewTag);
    els.listBtn.addEventListener('click', showListView);
    els.listBackBtn.addEventListener('click', hideListView);
    els.listSearch.addEventListener('input', filterList);
    els.listTagFilter.addEventListener('change', filterList);
    els.installBtn.addEventListener('click', installToHome);
    els.voiceRecordBtn.addEventListener('click', startVoiceRecording);
    els.voicePauseBtn.addEventListener('click', pauseVoiceRecording);
    els.voiceResumeBtn.addEventListener('click', resumeVoiceRecording);
    els.voiceStopBtn.addEventListener('click', stopVoiceRecording);
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('online', flushPendingQueue);
    window.addEventListener('beforeunload', () => persistDraft(collectMemo()));
  }

  function switchMode(mode) {
    state.currentMode = mode;
    els.modeTabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.mode === mode));
    els.editor.style.display = mode === 'text' ? '' : 'none';
    els.drawingCanvas.style.display = mode === 'pen' ? '' : 'none';
    els.voicePanel.style.display = mode === 'voice' ? '' : 'none';
    let hasToolbarForMode = false;
    els.toolbarGroups.forEach((group) => {
      const shown = group.dataset.for === mode;
      group.style.display = shown ? '' : 'none';
      if (shown) hasToolbarForMode = true;
    });
    // 音声モードなど、そのモード用のツールバーが無い場合は空バーを残さず折りたたむ
    if (els.toolbar) els.toolbar.style.display = hasToolbarForMode ? '' : 'none';
    state.drawMode = mode === 'pen';
    els.drawingCanvas.style.pointerEvents = mode === 'pen' ? 'auto' : 'none';
    if (mode === 'pen') {
      setTimeout(resizeCanvas, 50);
    }
    if (mode === 'text') {
      focusEditorSoon();
    }
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
    els.titleInput.value = draft.title || '';
    state.selectedTags = Array.isArray(draft.tags) ? [...draft.tags] : parseTags(draft.tags || '');
    _rememberTags(state.selectedTags);
    renderTagChips();
    els.editor.innerHTML = sanitizeHtml(draft.html || '');
    state.share = {
      source_url: draft.source_url || '',
      share_title: draft.share_title || '',
      source_label: draft.source_label || '',
    };
    if (draft.drawing_png) {
      const img = new Image();
      img.onload = () => {
        // 手書き画像はモード切替で非表示中に復元されることがあるため、
        // 表示サイズに依存せず画像自身の解像度でキャンバスへ描く。
        // (表示時の resizeCanvas() が改めて表示サイズへ合わせて再スケールする)
        const canvas = els.drawingCanvas;
        canvas.width = img.naturalWidth || canvas.width;
        canvas.height = img.naturalHeight || canvas.height;
        const ctx = context();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        state.hasDrawing = true;
      };
      img.src = draft.drawing_png;
    }
  }

  function collectMemo(options = {}) {
    const now = new Date().toISOString();
    const draft = readJson(CURRENT_KEY, {});
    const memoId = draft.memo_id || newMemoId();
    const drawing = state.hasDrawing ? els.drawingCanvas.toDataURL('image/png') : '';
    const memo = {
      memo_id: memoId,
      client_id: draft.client_id || clientId(),
      server_path: draft.server_path || '',
      title: els.titleInput.value.trim() || (els.editor.innerText.trim().split(/\r?\n/)[0] || '').slice(0, 60),
      tags: [...state.selectedTags],
      html: sanitizeHtml(els.editor.innerHTML),
      text: els.editor.innerText.trim(),
      drawing_png: drawing,
      source_url: state.share?.source_url || draft.source_url || '',
      share_title: state.share?.share_title || draft.share_title || '',
      source_label: state.share?.source_label || draft.source_label || '',
      created_at: draft.created_at || now,
      updated_at: now,
      source: (state.share?.source_url || state.share?.share_title || state.share?.source_label) ? 'mobile-share' : 'quick-memo',
    };
    if (options.autoTag) memo.auto_tag = true;
    return memo;
  }

  function startNewMemo() {
    const current = collectMemo();
    if (draftHasContent(current)) enqueueMemo(current);
    clearTimeout(state.saveTimer);
    _stopVoiceCapture();
    state.share = null;
    els.titleInput.value = '';
    els.titleInput.placeholder = 'タイトル（空なら本文の一行目）';
    state.selectedTags = [];
    renderTagChips();
    els.editor.innerHTML = '';
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
    const canvas = els.drawingCanvas;
    if (!canvas) return;
    context().clearRect(0, 0, canvas.width, canvas.height);
    state.hasDrawing = false;
    state.drawing = false;
    state.lastPoint = null;
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
    els.editor.innerHTML = sharedHtml(shared);
    if (!state.selectedTags.length) {
      state.selectedTags.push('共有');
    }
    _rememberTags(state.selectedTags);
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
    const memo = collectMemo({ autoTag: !!(opts && opts.autoTag) });
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

  async function flushPendingQueue() {
    const queue = readJson(QUEUE_KEY, []);
    if (!Array.isArray(queue) || !queue.length) return true;
    state.flushRequested = true;
    return drainQueue({ manual: false, pending: true });
  }

  async function drainQueue(opts) {
    if (state.saving) {
      state.flushRequested = true;
      return false;
    }
    state.saving = true;
    setStatus(opts && opts.manual ? '保存中...' : '自動保存中...');
    try {
      let ok = false;
      do {
        state.flushRequested = false;
        ok = await flushQueue();
      } while (ok && state.flushRequested);
      state.dirty = !ok;
      setStatus(ok ? 'Meldexに保存済み' : 'Meldex起動後に自動送信');
      return ok;
    } finally {
      state.saving = false;
    }
  }

  async function flushQueue() {
    const snapshot = readJson(QUEUE_KEY, []);
    if (!Array.isArray(snapshot) || !snapshot.length) return true;
    const sent = new Set();
    const failed = new Set();
    const signatures = new Map(snapshot.map((item) => [item.memo_id, queueItemSignature(item)]));
    for (const item of snapshot) {
      try {
        const result = await postJson('/api/quick-memo', item);
        if (!result || result.ok !== true) throw new Error(result && (result.error || result.detail) || 'save failed');
        sent.add(item.memo_id);
        const current = readJson(CURRENT_KEY, {});
        if (current.memo_id === item.memo_id) {
          current.server_path = result.path || current.server_path || '';
          current.target_sheet = result.target_sheet || current.target_sheet || item.target_sheet || '';
          if (Array.isArray(result.tags)) {
            current.tags = result.tags;
            state.selectedTags = [...result.tags];
            _rememberTags(state.selectedTags);
            renderTagChips();
          }
          delete current.auto_tag;
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
    els.syncStatus.textContent = message;
    els.syncStatus.classList.toggle('qm-toast-error', !!isError);
  }

  // --- タグチップ ---------------------------------------------------------

  function _rememberTags(tags) {
    if (!Array.isArray(tags) || !tags.length) return;
    const cached = readJson(TAGS_CACHE_KEY, []);
    state.allTags = [...new Set([...cached, ...state.allTags, ...tags])];
    writeJson(TAGS_CACHE_KEY, state.allTags);
  }

  async function loadTags() {
    // まずローカルキャッシュから即表示し、サーバー応答を待たずにチップを描く
    state.allTags = [...new Set([...state.allTags, ...readJson(TAGS_CACHE_KEY, [])])];
    renderTagChips();
    try {
      const res = await fetch(API_BASE + '/api/quick-memo/tags');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.tags)) {
          // サーバー側のタグ一覧と、ローカルにしかない未同期タグをマージする
          const localOnly = readJson(TAGS_CACHE_KEY, []).filter((tag) => !data.tags.includes(tag));
          state.allTags = [...new Set([...data.tags, ...localOnly, ...state.selectedTags])];
          writeJson(TAGS_CACHE_KEY, state.allTags);
          renderTagChips();
        }
      }
    } catch {}
  }

  function renderTagChips() {
    const container = els.tagChips;
    if (!container) return;
    container.innerHTML = '';
    const tags = [...new Set(state.allTags)];
    tags.forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'qm-tag-chip' + (state.selectedTags.includes(tag) ? ' is-selected' : '');
      chip.textContent = tag;
      chip.addEventListener('click', () => toggleTag(tag));
      container.appendChild(chip);
    });
  }

  function toggleTag(tag) {
    const idx = state.selectedTags.indexOf(tag);
    if (idx >= 0) state.selectedTags.splice(idx, 1);
    else state.selectedTags.push(tag);
    renderTagChips();
    scheduleSave();
  }

  function addNewTag() {
    const name = prompt('新しいタグ名を入力:');
    if (!name || !name.trim()) return;
    const tag = name.trim();
    if (!state.allTags.includes(tag)) {
      state.allTags.push(tag);
      writeJson(TAGS_CACHE_KEY, state.allTags);
    }
    if (!state.selectedTags.includes(tag)) {
      state.selectedTags.push(tag);
    }
    renderTagChips();
    scheduleSave();
  }

  // --- クイックメモ一覧 ----------------------------------------------------

  async function showListView() {
    els.editorView.style.display = 'none';
    els.listView.style.display = '';
    await loadMemoList();
  }

  function hideListView() {
    els.listView.style.display = 'none';
    els.editorView.style.display = '';
  }

  async function loadMemoList() {
    els.listContent.innerHTML = '<div class="qm-list-empty">読み込み中...</div>';
    try {
      const res = await fetch(API_BASE + '/api/quick-memo/list');
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.memos)) throw new Error();
      state.memoList = data.memos;
      const allListTags = new Set();
      data.memos.forEach((memo) => (memo.tags || []).forEach((tag) => allListTags.add(tag)));
      els.listTagFilter.innerHTML = '<option value="">すべてのタグ</option>';
      [...allListTags].sort().forEach((tag) => {
        const opt = document.createElement('option');
        opt.value = tag;
        opt.textContent = tag;
        els.listTagFilter.appendChild(opt);
      });
      renderMemoList(data.memos);
    } catch {
      els.listContent.innerHTML = '<div class="qm-list-empty">一覧を読み込めません。Meldexが起動しているか確認してください。</div>';
    }
  }

  function renderMemoList(memos) {
    if (!memos.length) {
      els.listContent.innerHTML = '<div class="qm-list-empty">クイックメモはまだありません</div>';
      return;
    }
    els.listContent.innerHTML = '';
    memos.forEach((memo) => {
      const item = document.createElement('div');
      item.className = 'qm-list-item';
      const tagsHtml = (memo.tags || []).map((tag) => '<span class="qm-list-tag">' + escHtml(tag) + '</span>').join('');
      const date = (memo.modified || memo.created || '').slice(0, 16).replace('T', ' ');
      item.innerHTML = '<div class="qm-list-item-title">' + escHtml(memo.title || '無題') + '</div>'
        + '<div class="qm-list-item-preview">' + escHtml(memo.text_preview || '') + '</div>'
        + '<div class="qm-list-item-meta"><span>' + escHtml(date) + '</span><div class="qm-list-item-tags">' + tagsHtml + '</div></div>';
      item.addEventListener('click', () => openMemoFromList(memo));
      els.listContent.appendChild(item);
    });
  }

  function filterList() {
    const query = (els.listSearch.value || '').trim().toLowerCase();
    const tagFilter = els.listTagFilter.value;
    const filtered = (state.memoList || []).filter((memo) => {
      if (tagFilter && !(memo.tags || []).includes(tagFilter)) return false;
      if (query) {
        const text = ((memo.title || '') + ' ' + (memo.text_preview || '') + ' ' + (memo.tags || []).join(' ')).toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });
    renderMemoList(filtered);
  }

  function openMemoFromList(_memo) {
    // 一覧からの選択は現状プレビューのみ。詳しい編集はMeldex本体で行う。
    hideListView();
  }

  // --- ホーム画面に追加（PWAインストール） -----------------------------------

  function listenInstallPrompt() {
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

  function setupCanvas() {
    resizeCanvas();
    const canvas = els.drawingCanvas;
    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', moveDraw);
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);
    setDrawTool('pen');
  }

  function resizeCanvas() {
    const canvas = els.drawingCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const snapshot = state.hasDrawing ? canvas.toDataURL('image/png') : '';
    canvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
    const ctx = context();
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    if (snapshot) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = snapshot;
    }
  }

  function context() {
    return els.drawingCanvas.getContext('2d');
  }

  function canvasPoint(event) {
    const rect = els.drawingCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDraw(event) {
    if (!state.drawMode) return;
    event.preventDefault();
    els.drawingCanvas.setPointerCapture(event.pointerId);
    state.drawing = true;
    state.lastPoint = canvasPoint(event);
  }

  function moveDraw(event) {
    if (!state.drawing || !state.lastPoint) return;
    event.preventDefault();
    const next = canvasPoint(event);
    const ctx = context();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Number(els.widthInput.value || 4);
    if (state.drawTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = Math.max(ctx.lineWidth, 10);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = els.colorInput.value || '#4ec9b0';
      ctx.globalAlpha = state.drawTool === 'marker' ? 0.34 : 1;
    }
    ctx.beginPath();
    ctx.moveTo(state.lastPoint.x, state.lastPoint.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    ctx.restore();
    state.lastPoint = next;
    state.hasDrawing = true;
    scheduleSave();
  }

  function endDraw(event) {
    if (!state.drawing) return;
    try { els.drawingCanvas.releasePointerCapture(event.pointerId); } catch {}
    state.drawing = false;
    state.lastPoint = null;
    scheduleSave();
  }

  function setDrawTool(tool) {
    state.drawTool = tool === 'marker' || tool === 'eraser' ? tool : 'pen';
    els.markerBtn.classList.toggle('is-active', state.drawTool === 'marker');
    els.eraserBtn.classList.toggle('is-active', state.drawTool === 'eraser');
  }

  function clearDrawing() {
    context().clearRect(0, 0, els.drawingCanvas.width, els.drawingCanvas.height);
    state.hasDrawing = false;
    scheduleSave();
  }

  function fillDrawing() {
    const rect = els.drawingCanvas.getBoundingClientRect();
    const ctx = context();
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = els.colorInput.value || '#4ec9b0';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.restore();
    state.hasDrawing = true;
    scheduleSave();
  }

  // --- 音声モード ----------------------------------------------------------

  async function startVoiceRecording() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      startBrowserSpeech(Recognition);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      state.recordChunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) state.recordChunks.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        state.recording = null;
        updateVoiceUI('stopped');
        const blob = new Blob(state.recordChunks, { type: recorder.mimeType || 'audio/webm' });
        await transcribeBlob(blob);
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
    rec.onerror = () => { els.voiceStatus.textContent = '音声認識エラー'; };
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
    els.editor.focus();
    document.execCommand('insertText', false, text + ' ');
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
    return String(value || '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  }

  function escAttr(value) {
    return escHtml(value).replace(/`/g, '&#96;');
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function registerServiceWorker() {
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
