(function () {
  'use strict';

  const QUEUE_KEY = 'meldex:quick-memo:queue:v1';
  const CURRENT_KEY = 'meldex:quick-memo:current:v1';
  const CLIENT_ID_KEY = 'meldex:quick-memo:client-id:v1';
  const API_BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8765' : '';
  const els = {};
  const state = {
    dirty: false,
    saving: false,
    drawMode: true,
    drawTool: 'pen',
    drawing: false,
    hasDrawing: false,
    lastPoint: null,
    speech: null,
    recording: null,
    recordChunks: [],
    saveTimer: 0,
    flushRequested: false,
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindElements();
    restoreDraft();
    setupCanvas();
    bindEvents();
    registerServiceWorker();
    focusEditorSoon();
    setStatus('入力できます');
    setTimeout(flushPendingQueue, 120);
  }

  function bindElements() {
    [
      'syncStatus', 'shortcutBtn', 'saveBtn', 'titleInput', 'tagsInput', 'editor',
      'drawingCanvas', 'speechBtn', 'drawToggleBtn', 'colorInput', 'widthInput',
      'markerBtn', 'fillBtn', 'eraserBtn', 'clearDrawingBtn',
    ].forEach((id) => { els[id] = document.getElementById(id); });
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
    els.titleInput.addEventListener('input', scheduleSave);
    els.tagsInput.addEventListener('input', scheduleSave);
    els.saveBtn.addEventListener('click', () => saveNow({ manual: true }));
    els.shortcutBtn.addEventListener('click', installShortcut);
    els.speechBtn.addEventListener('click', toggleSpeechInput);
    els.drawToggleBtn.addEventListener('click', toggleDrawMode);
    els.markerBtn.addEventListener('click', () => setDrawTool('marker'));
    els.fillBtn.addEventListener('click', fillDrawing);
    els.eraserBtn.addEventListener('click', () => setDrawTool('eraser'));
    els.clearDrawingBtn.addEventListener('click', clearDrawing);
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('online', flushPendingQueue);
    window.addEventListener('beforeunload', () => persistDraft(collectMemo()));
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

  function restoreDraft() {
    const draft = readJson(CURRENT_KEY, null);
    if (!draft) return;
    els.titleInput.value = draft.title || '';
    els.tagsInput.value = Array.isArray(draft.tags) ? draft.tags.join(', ') : (draft.tags || '');
    els.editor.innerHTML = sanitizeHtml(draft.html || '');
    if (draft.drawing_png) {
      const img = new Image();
      img.onload = () => {
        resizeCanvas();
        const rect = els.drawingCanvas.getBoundingClientRect();
        const width = rect.width || (els.drawingCanvas.width / Math.max(1, devicePixelRatio || 1));
        const height = rect.height || (els.drawingCanvas.height / Math.max(1, devicePixelRatio || 1));
        context().drawImage(img, 0, 0, width, height);
        state.hasDrawing = true;
      };
      img.src = draft.drawing_png;
    }
  }

  function collectMemo() {
    const now = new Date().toISOString();
    const draft = readJson(CURRENT_KEY, {});
    const memoId = draft.memo_id || clientId();
    const drawing = state.hasDrawing ? els.drawingCanvas.toDataURL('image/png') : '';
    return {
      memo_id: memoId,
      client_id: memoId,
      server_path: draft.server_path || '',
      title: els.titleInput.value.trim(),
      tags: parseTags(els.tagsInput.value),
      html: sanitizeHtml(els.editor.innerHTML),
      text: els.editor.innerText.trim(),
      drawing_png: drawing,
      created_at: draft.created_at || now,
      updated_at: now,
      source: 'quick-memo',
    };
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
    return writeJson(QUEUE_KEY, queue.slice(-30));
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

  async function installShortcut() {
    try {
      const result = await postJson('/api/quick-memo/install-shortcut', {});
      setStatus((result.hotkey || 'Ctrl+Alt+M') + ' で起動できます');
    } catch {
      setStatus('ショートカット作成はデスクトップ版で実行してください', true);
    }
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

  function toggleDrawMode() {
    state.drawMode = !state.drawMode;
    els.drawToggleBtn.classList.toggle('is-active', state.drawMode);
    els.drawingCanvas.style.pointerEvents = state.drawMode ? 'auto' : 'none';
    setStatus(state.drawMode ? 'ペン入力' : 'テキスト入力');
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

  function toggleSpeechInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      toggleBrowserSpeech(Recognition);
      return;
    }
    toggleRecordedTranscription();
  }

  function toggleBrowserSpeech(Recognition) {
    if (state.speech) {
      state.speech.stop();
      state.speech = null;
      els.speechBtn.classList.remove('is-active');
      setStatus('音声入力停止');
      return;
    }
    const rec = new Recognition();
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      }
      if (finalText) {
        insertText(finalText);
        scheduleSave();
      }
    };
    rec.onerror = () => setStatus('音声入力を利用できません', true);
    rec.onend = () => {
      els.speechBtn.classList.remove('is-active');
      state.speech = null;
    };
    state.speech = rec;
    els.speechBtn.classList.add('is-active');
    rec.start();
    setStatus('音声入力中');
  }

  async function toggleRecordedTranscription() {
    if (state.recording) {
      try {
        if (state.recording.state !== 'inactive') {
          state.recording.stop();
          setStatus('文字起こし準備中...');
        }
      } catch {
        state.recording = null;
        els.speechBtn.classList.remove('is-active');
        setStatus('録音を停止できません', true);
      }
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
        els.speechBtn.classList.remove('is-active');
        const blob = new Blob(state.recordChunks, { type: recorder.mimeType || 'audio/webm' });
        await transcribeBlob(blob);
      };
      state.recording = recorder;
      recorder.start();
      els.speechBtn.classList.add('is-active');
      setStatus('録音中。もう一度押すと文字起こし');
    } catch {
      setStatus('マイクを利用できません', true);
    }
  }

  async function transcribeBlob(blob) {
    setStatus('文字起こし中...');
    try {
      const dataUrl = await blobToDataUrl(blob);
      const result = await postJson('/api/quick-memo/transcribe', {
        audio_base64: dataUrl,
        mime_type: blob.type || 'audio/webm',
      });
      if (result.text) {
        insertText(result.text);
        scheduleSave();
      }
      setStatus('文字起こし完了');
    } catch {
      setStatus('OpenAI文字起こしを利用できません', true);
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
