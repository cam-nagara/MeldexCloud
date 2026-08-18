(function () {
  'use strict';
  if (window.MeldexDraftRecovery) return;

  const DB_NAME = 'meldex-draft-recovery-v1';
  const STORE = 'drafts';
  const MAX_DRAFTS = 100;
  const MAX_BYTES = 1024 * 1024;
  const timers = new Map();
  let recoveryRetryTimer = 0;
  let activeRecoveryModal = null;
  // 編集ロック一覧（マニュアル等のシステム保護）がまだ読み込まれていない間は、
  // ロック済みパスの残留ドラフトを掃除できない。起動1.8秒時点ではホームフォルダの
  // 読み込みが終わっていないことがあり、掃除が空振りしたまま「未保存の編集があります」
  // が出てしまう（実機で再現）。読み込み完了まで待ってから出す。
  let systemLocksReady = false;
  // ダイアログを一度出した／出す必要が無いと判断した、の印。ロック一覧の再読込を
  // きっかけにダイアログが勝手に復活するのを防ぐ。
  let startupPromptSettled = false;
  let lockWaitAttempts = 0;
  const MAX_LOCK_WAIT_ATTEMPTS = 20; // 700ms × 20 ≒ 14秒で諦めて表示する

  function _systemLocksPending() {
    // setSystemLockedItems が無い環境（単独アプリ等）はロックの概念自体が無いので待たない
    if (typeof setSystemLockedItems !== 'function') return false;
    return !systemLocksReady && lockWaitAttempts < MAX_LOCK_WAIT_ATTEMPTS;
  }

  function _hasBlockingStartupDialog() {
    return !!document.querySelector('#meldex-beta-consent-overlay, #meldex-install-prompt-overlay, #meldex-install-help-overlay, .meldex-cloud-home-first-overlay, .meldex-sample-install-overlay');
  }

  function _scheduleRecoveryRetry() {
    if (recoveryRetryTimer) return;
    recoveryRetryTimer = setTimeout(() => {
      recoveryRetryTimer = 0;
      showRecoveryDialog().catch(() => {});
    }, 700);
  }

  function _draftScope() {
    let mode = 'legacy';
    let workspace = null;
    let vaultPath = '';
    try {
      mode = window.MeldexRuntimeAdapter?.getMode?.() || (document.body?.dataset?.cloudMode === 'dropbox' ? 'dropbox' : 'legacy');
      workspace = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || null;
    } catch {}
    try {
      if (typeof state !== 'undefined' && state?.vaultPath) vaultPath = String(state.vaultPath || '');
    } catch {}
    const accountId = String(workspace?.accountId || workspace?.ownerId || '').trim();
    const workspacePath = String(workspace?.path || window.MeldexDropboxAuth?.getVaultPath?.() || vaultPath || '').trim();
    const fallback = `${location.origin || ''}${location.pathname || ''}`;
    return [mode, accountId, workspacePath || fallback].map(part => String(part || '').replace(/\s+/g, ' ').trim()).join('|');
  }

  function _draftStorageKey(path) {
    return `${_draftScope()}\n${String(path || '').trim()}`;
  }

  function _draftTimerKey(path) {
    return _draftStorageKey(path);
  }

  function _isCurrentScopeDraft(item, scope) {
    return String(item?.scope || '') === String(scope || '');
  }

  function _publicDraft(item) {
    const filePath = String(item?.filePath || '').trim() || String(item?.path || '');
    return { ...item, storageKey: item?.path || '', path: filePath };
  }

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

  async function _prune(store, scope) {
    const all = await _request(store.getAll());
    const sorted = all
      .filter(item => _isCurrentScopeDraft(item, scope))
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
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
    const scope = _draftScope();
    const key = _draftStorageKey(safePath);
    const savedAt = new Date().toISOString();
    return _store('readwrite', (store) => {
      store.put({ path: key, filePath: safePath, scope, content: String(content || ''), savedAt, lastSyncedAt: String(lastSyncedAt || '') });
      _prune(store, scope).catch(() => {});
      return { ok: true, path: safePath, savedAt };
    }).catch(() => ({ ok: false }));
  }

  function queueDraft(path, content, lastSyncedAt) {
    const safePath = String(path || '').trim();
    const key = _draftTimerKey(safePath);
    clearTimeout(timers.get(key));
    if (!safePath || _isPathLocked(safePath)) return;
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      saveDraft(safePath, content, lastSyncedAt);
    }, 250));
  }

  async function clearAllDrafts() {
    const scope = _draftScope();
    for (const timer of timers.keys()) {
      if (String(timer).startsWith(scope + '\n')) {
        clearTimeout(timers.get(timer));
        timers.delete(timer);
      }
    }
    await _store('readwrite', async (store) => {
      const all = await _request(store.getAll());
      all.filter(item => _isCurrentScopeDraft(item, scope)).forEach(item => store.delete(item.path));
    }).catch(() => {});
  }

  // storageKey は listDrafts() が返す「実際に保存されているキー」。渡された場合は
  // それを消す。キーは作業フォルダの解決状況を含むため（_draftScope 参照）、
  // 一覧を出した時点とボタンを押した時点でキーの組み立て結果が変わることがあり、
  // その場で作り直すと別キーを消して無言で失敗する（破棄しても毎回再表示される
  // 原因になっていた）。
  async function clearDraft(path, storageKey) {
    const safePath = String(path || '').trim();
    if (!safePath) return;
    const key = _draftTimerKey(safePath);
    clearTimeout(timers.get(key));
    timers.delete(key);
    const targets = new Set([_draftStorageKey(safePath)]);
    const explicit = String(storageKey || '').trim();
    if (explicit) targets.add(explicit);
    await _store('readwrite', (store) => {
      targets.forEach(target => store.delete(target));
    }).catch(() => {});
  }

  function markSynced(path) {
    return clearDraft(path);
  }

  async function listDrafts() {
    const scope = _draftScope();
    const all = await _store('readonly', (store) => _request(store.getAll())).catch(() => []);
    return (Array.isArray(all) ? all : [])
      .filter(item => _isCurrentScopeDraft(item, scope))
      .map(_publicDraft)
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  function _fileLabel(path) {
    return String(path || '').split('/').pop() || String(path || '');
  }

  async function _overwriteDraft(item) {
    if (typeof apiPut !== 'function') return;
    const res = await apiPut('/file?path=' + encodeURIComponent(item.path), { content: item.content || '', force_overwrite: true });
    await clearDraft(item.path, item.storageKey);
    if (typeof openPage === 'function') {
      await openPage(_fileLabel(item.path).replace(/\.md$/i, ''), item.path);
      const pc = document.getElementById('page-content');
      if (pc && pc.dataset.path === item.path) pc.dataset.lastSavedEtag = res.etag || pc.dataset.lastSavedEtag || '';
    }
    if (typeof showStatus === 'function') showStatus('未保存ドラフトを上書き保存しました');
  }

  async function _fileExists(path) {
    if (typeof apiFetch !== 'function') return false;
    try {
      await apiFetch('/file?path=' + encodeURIComponent(path), { silentError: true });
      return true;
    } catch (error) {
      if (error?.status === 404) return false;
      return true;
    }
  }

  async function _saveDraftAs(item) {
    if (typeof cfPrompt !== 'function' || typeof apiPut !== 'function') return false;
    const fallback = String(item.path || '').replace(/(\.[^/.]+)?$/, '_recovered$1');
    const nextPath = await cfPrompt('未保存ドラフトを別名で保存', fallback);
    if (!nextPath) return false;
    const exists = await _fileExists(nextPath);
    if (exists) {
      if (typeof cfConfirm !== 'function') {
        if (typeof showStatus === 'function') showStatus('同名のファイルが既にあります', true);
        return false;
      }
      const ok = await cfConfirm('同名のファイルが既にあります。上書きしますか？', { danger: true, okLabel: '上書き', cancelLabel: 'キャンセル' });
      if (!ok) return false;
    }
    await apiPut('/file?path=' + encodeURIComponent(nextPath), {
      content: item.content || '',
      ...(exists ? { force_overwrite: true } : { create_only: true }),
    });
    await clearDraft(item.path, item.storageKey);
    if (typeof showStatus === 'function') showStatus('未保存ドラフトを別名保存しました');
    return true;
  }

  async function _confirmDiscard(message) {
    if (typeof cfConfirm === 'function') {
      return !!await cfConfirm(message, { danger: true, okLabel: '破棄', cancelLabel: 'キャンセル' });
    }
    if (typeof window.confirm === 'function') return window.confirm(message);
    return false;
  }

  // 編集ロック中（マニュアル等のシステム保護を含む）のパスに残っているドラフトを消す。
  // _isPathLocked() は新規の積み増しを防ぐだけで、すでに入っているレコードは残るため、
  // ロックされる前に一度でも保存へ失敗していると、本体保存が必ず弾かれる＝同期済みに
  // ならず、起動のたびに「未保存の編集があります」が出続けていた。
  async function _pruneLockedDrafts(drafts) {
    const locked = (drafts || []).filter(item => _isPathLocked(item.path));
    for (const item of locked) await clearDraft(item.path, item.storageKey);
    return (drafts || []).filter(item => !locked.includes(item));
  }

  // 編集ロック一覧の読み込みが終わったときに呼ばれる。ロック済みパスの残留ドラフトを
  // 掃除し、既にダイアログが開いていれば該当行を消す（全部消えたら閉じる）。
  async function notifySystemLocksLoaded() {
    systemLocksReady = true;
    const remaining = await _pruneLockedDrafts(await listDrafts());
    const overlay = document.querySelector('[data-draft-recovery-dialog="1"]');
    if (!overlay) {
      if (recoveryRetryTimer) {
        clearTimeout(recoveryRetryTimer);
        recoveryRetryTimer = 0;
      }
      // 一度出した（あるいは出す必要が無いと判断した）あとは出し直さない。
      // setSystemLockedItems は設定画面やツリー更新でも呼ばれるため、ここで無条件に
      // 開くと、ユーザーが閉じたダイアログが操作のたびに復活してしまう。
      if (remaining.length && !startupPromptSettled) showRecoveryDialog().catch(() => {});
      return;
    }
    const alive = new Set(remaining.map(item => String(item.path || '')));
    overlay.querySelectorAll('[data-draft-row]').forEach((row) => {
      const label = row.querySelector('.draft-recovery-meta')?.getAttribute('title') || '';
      if (label && !alive.has(label)) row.remove();
    });
    if (!overlay.querySelector('[data-draft-row]')) {
      if (activeRecoveryModal?.overlay === overlay) activeRecoveryModal.close('no-drafts');
      else overlay.remove();
    }
  }

  async function showRecoveryDialog() {
    const drafts = await _pruneLockedDrafts(await listDrafts());
    if (!drafts.length) {
      startupPromptSettled = true;
      return;
    }
    if (document.querySelector('[data-draft-recovery-dialog="1"]')) return;
    if (_systemLocksPending()) {
      // ロック一覧が来る前に出すと、閲覧専用ファイルの残骸まで一緒に出てしまう
      lockWaitAttempts += 1;
      _scheduleRecoveryRetry();
      return;
    }
    if (_hasBlockingStartupDialog()) {
      _scheduleRecoveryRetry();
      return;
    }
    window.GBTooltip?.hide?.({ suppressUntilLeave: true });
    if (typeof window.GBUI?.createModal !== 'function') {
      if (typeof showStatus === 'function') showStatus('未保存の編集を確認できません', true);
      return;
    }
    if (activeRecoveryModal && !activeRecoveryModal.isOpen()) activeRecoveryModal.close('stale');
    const restoreFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const rows = drafts.map((item, index) => `
      <div class="draft-recovery-row" data-draft-row data-draft-index="${index}">
        <div class="draft-recovery-info">
          <div class="draft-recovery-name" title="${esc(_fileLabel(item.path))}">${esc(_fileLabel(item.path))}</div>
          <div class="draft-recovery-meta" title="${esc(item.path)}">${esc(item.path)} / ${esc(item.savedAt || '')}</div>
        </div>
        <div class="draft-recovery-actions">
          <button type="button" class="gb-btn gb-btn-sm gb-btn-primary" data-draft-action="overwrite" data-draft-index="${index}" data-e2e-id="draft-recovery-${index}-overwrite">上書き保存</button>
          <button type="button" class="gb-btn gb-btn-sm" data-draft-action="save-as" data-draft-index="${index}" data-e2e-id="draft-recovery-${index}-save-as">別名保存</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-draft-action="discard" data-draft-index="${index}" data-e2e-id="draft-recovery-${index}-discard" aria-label="${esc(_fileLabel(item.path))} のドラフトを破棄">破棄</button>
        </div>
      </div>`).join('');
    const body = document.createElement('div');
    body.className = 'draft-recovery-content';
    body.innerHTML = `
      <div id="draft-recovery-description" class="gb-section-desc">前回終了時に保存前だった編集を復元できます。</div>
      <div class="draft-recovery-list">${rows}</div>`;
    const discardAllButton = document.createElement('button');
    discardAllButton.type = 'button';
    discardAllButton.className = 'gb-btn gb-btn-sm gb-btn-danger';
    discardAllButton.dataset.draftAction = 'discard-all';
    discardAllButton.dataset.e2eId = 'draft-recovery-discard-all';
    discardAllButton.textContent = 'すべて破棄';
    const spacer = document.createElement('span');
    spacer.className = 'draft-recovery-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'gb-btn gb-btn-sm';
    closeButton.dataset.draftAction = 'close';
    closeButton.dataset.e2eId = 'draft-recovery-close';
    closeButton.textContent = '閉じる';
    let busy = false;
    const modalApi = window.GBUI.createModal({
      id: 'draft-recovery',
      title: '未保存の編集があります',
      body,
      footer: [discardAllButton, spacer, closeButton],
      variant: 'mobile-sheet',
      extraClass: 'draft-recovery-dialog',
      geometryKey: 'draft-recovery',
      initialFocus: '[data-draft-action="close"]',
      returnFocus: restoreFocusTo || undefined,
      closeOnEsc: true,
      closeOnOverlay: false,
      onBeforeClose: reason => !busy || ['overwrite', 'save-as', 'discard-all', 'discard-last', 'no-drafts'].includes(reason),
      onClose: () => {
        if (activeRecoveryModal === modalApi) activeRecoveryModal = null;
      },
    });
    activeRecoveryModal = modalApi;
    const overlay = modalApi.overlay;
    overlay.classList.add('modal-overlay');
    overlay.dataset.draftRecoveryDialog = '1';
    modalApi.modal.classList.add('modal');
    modalApi.modal.dataset.e2eId = 'draft-recovery-dialog';
    modalApi.modal.setAttribute('aria-describedby', 'draft-recovery-description');
    modalApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'draft-recovery-header-close');
    modalApi.footer.classList.add('draft-recovery-footer');
    overlay.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('[data-draft-action]');
      if (!button || !overlay.contains(button)) return;
      const action = button.dataset.draftAction;
      if (!action) return;
      if (action === 'close') { modalApi.close('close-button'); return; }
      if (action === 'discard-all') {
        if (!await _confirmDiscard('未保存ドラフトをすべて破棄しますか？')) return;
        busy = true;
        try {
          await clearAllDrafts();
          busy = false;
          modalApi.close('discard-all');
          if (typeof showStatus === 'function') showStatus('未保存ドラフトをすべて破棄しました');
        } finally {
          busy = false;
        }
        return;
      }
      const item = drafts[Number(button.dataset.draftIndex)];
      if (!item) return;
      busy = true;
      try {
        if (action === 'overwrite') {
          await _overwriteDraft(item);
          busy = false;
          modalApi.close('overwrite');
        } else if (action === 'save-as') {
          const saved = await _saveDraftAs(item);
          if (saved) {
            busy = false;
            modalApi.close('save-as');
          }
        } else if (action === 'discard') {
          if (!await _confirmDiscard(`「${_fileLabel(item.path)}」の未保存ドラフトを破棄しますか？`)) return;
          await clearDraft(item.path, item.storageKey);
          button.closest('[data-draft-row]')?.remove();
          if (!overlay.querySelector('[data-draft-row]')) {
            busy = false;
            modalApi.close('discard-last');
          }
        }
      } finally {
        busy = false;
      }
    });
    modalApi.open();
    startupPromptSettled = true;
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
    notifySystemLocksLoaded,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleStartupCheck, { once: true });
  else scheduleStartupCheck();
})();
