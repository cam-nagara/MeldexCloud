(function () {
  'use strict';
  if (window.MeldexDraftRecovery) return;

  const DB_NAME = 'meldex-draft-recovery-v1';
  const STORE = 'drafts';
  const MAX_DRAFTS = 100;
  const MAX_BYTES = 1024 * 1024;
  const timers = new Map();

  function _openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'path' });
          store.createIndex('savedAt', 'savedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async function _store(mode, fn) {
    const db = await _openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let value;
        try { value = fn(store); } catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      });
    } finally {
      db.close();
    }
  }

  function _request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
    });
  }

  function _byteLength(value) {
    return new Blob([String(value || '')]).size;
  }

  async function _prune(store) {
    const all = await _request(store.getAll());
    const sorted = all.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
    for (const item of sorted.slice(MAX_DRAFTS)) store.delete(item.path);
  }

  function _isPathLocked(path) {
    // 編集ロック中（マニュアル等のシステムロック含む）の path に対しては
    // 下書きを積まない。本体保存が 403 で必ず弾かれるので markSynced されず、
    // 起動の度に「未保存の編集があります」が再表示されてしまうため。
    try {
      return typeof isItemLocked === 'function' && isItemLocked(path);
    } catch (_) {
      return false;
    }
  }

  async function saveDraft(path, content, lastSyncedAt) {
    const safePath = String(path || '').trim();
    if (!safePath || _byteLength(content) > MAX_BYTES) return { ok: false, skipped: true };
    if (_isPathLocked(safePath)) return { ok: false, skipped: true };
    const savedAt = new Date().toISOString();
    return _store('readwrite', (store) => {
      store.put({ path: safePath, content: String(content || ''), savedAt, lastSyncedAt: String(lastSyncedAt || '') });
      _prune(store).catch(() => {});
      return { ok: true, path: safePath, savedAt };
    }).catch(() => ({ ok: false }));
  }

  function queueDraft(path, content, lastSyncedAt) {
    const key = String(path || '');
    clearTimeout(timers.get(key));
    if (_isPathLocked(key)) return;
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      saveDraft(key, content, lastSyncedAt);
    }, 250));
  }

  async function clearAllDrafts() {
    await _store('readwrite', (store) => store.clear()).catch(() => {});
  }

  async function clearDraft(path) {
    const safePath = String(path || '').trim();
    if (!safePath) return;
    await _store('readwrite', (store) => store.delete(safePath)).catch(() => {});
  }

  function markSynced(path) {
    return clearDraft(path);
  }

  async function listDrafts() {
    const all = await _store('readonly', (store) => _request(store.getAll())).catch(() => []);
    return (Array.isArray(all) ? all : []).sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  function _fileLabel(path) {
    return String(path || '').split('/').pop() || String(path || '');
  }

  async function _overwriteDraft(item) {
    if (typeof apiPut !== 'function') return;
    const res = await apiPut('/file?path=' + encodeURIComponent(item.path), { content: item.content || '', force_overwrite: true });
    await clearDraft(item.path);
    if (typeof openPage === 'function') {
      await openPage(_fileLabel(item.path).replace(/\.md$/i, ''), item.path);
      const pc = document.getElementById('page-content');
      if (pc && pc.dataset.path === item.path) pc.dataset.lastSavedEtag = res.etag || pc.dataset.lastSavedEtag || '';
    }
    if (typeof showStatus === 'function') showStatus('未保存ドラフトを上書き保存しました');
  }

  async function _saveDraftAs(item) {
    if (typeof cfPrompt !== 'function' || typeof apiPut !== 'function') return;
    const fallback = String(item.path || '').replace(/(\.[^/.]+)?$/, '_recovered$1');
    const nextPath = await cfPrompt('未保存ドラフトを別名で保存', fallback);
    if (!nextPath) return;
    await apiPut('/file?path=' + encodeURIComponent(nextPath), { content: item.content || '' });
    await clearDraft(item.path);
    if (typeof showStatus === 'function') showStatus('未保存ドラフトを別名保存しました');
  }

  async function showRecoveryDialog() {
    const drafts = await listDrafts();
    if (!drafts.length || document.querySelector('[data-draft-recovery-dialog="1"]')) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.draftRecoveryDialog = '1';
    const rows = drafts.map((item, index) => `
      <div style="display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--border);padding:8px 0;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(_fileLabel(item.path))}</div>
          <div style="font-size:12px;color:var(--fg2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item.path)} / ${esc(item.savedAt || '')}</div>
        </div>
        <button data-draft-action="overwrite" data-draft-index="${index}">上書き保存</button>
        <button data-draft-action="save-as" data-draft-index="${index}">別名保存</button>
        <button data-draft-action="discard" data-draft-index="${index}">破棄</button>
      </div>`).join('');
    overlay.innerHTML = `<div class="modal" style="width:560px;max-width:calc(100vw - 32px);">
      <h3>未保存の編集があります</h3>
      <div class="gb-section-desc">前回終了時に保存前だった編集を復元できます。</div>
      <div style="max-height:360px;overflow:auto;">${rows}</div>
      <div class="btn-row" style="margin-top:12px;"><button data-draft-action="discard-all">すべて破棄</button><span style="flex:1;"></span><button data-draft-action="close">閉じる</button></div>
    </div>`;
    overlay.addEventListener('click', async (event) => {
      const action = event.target?.dataset?.draftAction;
      if (!action) return;
      if (action === 'close') { overlay.remove(); return; }
      if (action === 'discard-all') {
        await clearAllDrafts();
        overlay.remove();
        if (typeof showStatus === 'function') showStatus('未保存ドラフトをすべて破棄しました');
        return;
      }
      const item = drafts[Number(event.target.dataset.draftIndex)];
      if (!item) return;
      if (action === 'overwrite') {
        await _overwriteDraft(item);
        overlay.remove();
      } else if (action === 'save-as') {
        await _saveDraftAs(item);
        overlay.remove();
      } else if (action === 'discard') {
        await clearDraft(item.path);
        event.target.closest('div')?.remove();
      }
    });
    document.body.appendChild(overlay);
  }

  function scheduleStartupCheck() {
    setTimeout(() => showRecoveryDialog().catch(() => {}), 1800);
  }

  window.MeldexDraftRecovery = {
    queueDraft,
    saveDraft,
    clearDraft,
    clearAllDrafts,
    markSynced,
    listDrafts,
    showRecoveryDialog,
    scheduleStartupCheck,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleStartupCheck, { once: true });
  else scheduleStartupCheck();
})();
