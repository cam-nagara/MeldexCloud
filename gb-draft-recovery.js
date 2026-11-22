(function () {
  'use strict';
  if (window.MeldexDraftRecovery) return;

  const DB_NAME = 'meldex-draft-recovery-v1';
  const STORE = 'drafts';
  const MAX_DRAFTS = 100;
  const MAX_BYTES = 1024 * 1024;
  const RESERVATION_PREFIX = 'meldex-draft-reservation-v1:';
  const timers = new Map();
  const queuedContents = new Map();
  const generations = new Map();
  // 今回の起動中に保全した編集は、前回終了時の残留下書きとして通知しない。
  // 保全データ自体は残し、明示的な一覧と次回起動では従来どおり扱う。
  const sessionDraftKeys = new Set();
  let recoveryRetryTimer = 0;
  let recoveryRetryOptions = null;
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
    return !!document.querySelector('#meldex-beta-consent-overlay, #meldex-install-prompt-overlay, #meldex-install-help-overlay, .meldex-cloud-home-first-overlay');
  }

  function _scheduleRecoveryRetry(options) {
    // 明示的な一覧要求は、起動時だけの絞り込みより優先する。
    if (!recoveryRetryOptions || !options?.startup) recoveryRetryOptions = options || {};
    if (recoveryRetryTimer) return;
    recoveryRetryTimer = setTimeout(() => {
      const pendingOptions = recoveryRetryOptions || {};
      recoveryRetryOptions = null;
      recoveryRetryTimer = 0;
      showRecoveryDialog(pendingOptions).catch(() => {});
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
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction failed'));
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
    const generation = generations.get(key) || 0;
    generations.set(key, generation);
    const savedAt = new Date().toISOString();
    return _store('readwrite', (store) => {
      if ((generations.get(key) || 0) !== generation) return { ok: false, skipped: true };
      store.put({ path: key, filePath: safePath, scope, content: String(content || ''), savedAt, lastSyncedAt: String(lastSyncedAt || '') });
      _prune(store, scope).catch(() => {});
      return { ok: true, path: safePath, savedAt };
    }).then(result => {
      if (result?.ok) sessionDraftKeys.add(key);
      return result;
    }).catch(() => ({ ok: false }));
  }

  // Reserve synchronously before navigation can stop an IndexedDB transaction
  // or an unload request. The existing scope keeps workspaces/accounts apart.
  function reserveDraft(path, content, lastSyncedAt) {
    const safePath = String(path || '').trim();
    if (!safePath || _byteLength(content) > MAX_BYTES || _isPathLocked(safePath)) return { ok: false };
    const key = _draftStorageKey(safePath);
    const item = { path: key, filePath: safePath, scope: _draftScope(), content: String(content || ''),
      savedAt: new Date().toISOString(), lastSyncedAt: String(lastSyncedAt || '') };
    let reserved = false;
    try {
      localStorage.setItem(RESERVATION_PREFIX + key, JSON.stringify(item));
      sessionDraftKeys.add(key);
      reserved = true;
    } catch (_) {}
    void saveDraft(safePath, content, lastSyncedAt);
    return { ok: reserved };
  }

  function _reservations() {
    const items = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(RESERVATION_PREFIX)) continue;
        try {
          const item = JSON.parse(localStorage.getItem(key));
          if (item?.path && typeof item.content === 'string' && _byteLength(item.content) <= MAX_BYTES) items.push(item);
        } catch (_) {}
      }
    } catch (_) {}
    return items;
  }

  function _queueDraftSource(path, contentSource, lastSyncedAt) {
    const safePath = String(path || '').trim();
    const key = _draftTimerKey(safePath);
    clearTimeout(timers.get(key));
    if (!safePath || _isPathLocked(safePath)) return;
    queuedContents.set(key, contentSource);
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      queuedContents.delete(key);
      let content;
      try {
        content = typeof contentSource === 'function' ? contentSource() : contentSource;
      } catch (_) {
        return;
      }
      saveDraft(safePath, content, lastSyncedAt);
    }, 250));
  }

  function queueDraft(path, content, lastSyncedAt) {
    _queueDraftSource(path, content, lastSyncedAt);
  }

  // 大きい文書では直列化自体が入力を止めるため、デバウンス満了時にだけ
  // 最新内容を生成する入口を用意する。従来のqueueDraft契約は変更しない。
  function queueDraftFactory(path, contentFactory, lastSyncedAt) {
    if (typeof contentFactory !== 'function') return queueDraft(path, contentFactory, lastSyncedAt);
    _queueDraftSource(path, contentFactory, lastSyncedAt);
  }

  async function clearAllDrafts() {
    const scope = _draftScope();
    for (const key of generations.keys()) {
      if (key.startsWith(scope + '\n')) generations.set(key, generations.get(key) + 1);
    }
    for (const timer of timers.keys()) {
      if (String(timer).startsWith(scope + '\n')) {
        clearTimeout(timers.get(timer));
        timers.delete(timer);
        queuedContents.delete(timer);
      }
    }
    await _store('readwrite', async (store) => {
      const all = await _request(store.getAll());
      all.filter(item => _isCurrentScopeDraft(item, scope)).forEach(item => store.delete(item.path));
    });
    for (const item of _reservations().filter(item => _isCurrentScopeDraft(item, scope))) {
      localStorage.removeItem(RESERVATION_PREFIX + item.path);
    }
  }

  // storageKey は listDrafts() が返す「実際に保存されているキー」。渡された場合は
  // それを消す。キーは作業フォルダの解決状況を含むため（_draftScope 参照）、
  // 一覧を出した時点とボタンを押した時点でキーの組み立て結果が変わることがあり、
  // その場で作り直すと別キーを消して無言で失敗する（破棄しても毎回再表示される
  // 原因になっていた）。
  async function clearDraft(path, storageKey, expectedContent) {
    const safePath = String(path || '').trim();
    if (!safePath) return;
    const matches = content => expectedContent === undefined || content === expectedContent;
    const targets = new Set([_draftStorageKey(safePath)]);
    const explicit = String(storageKey || '').trim();
    if (explicit) targets.add(explicit);
    targets.forEach(target => {
      if (expectedContent === undefined) generations.set(target, (generations.get(target) || 0) + 1);
      const pending = queuedContents.get(target);
      let content;
      try { content = typeof pending === 'function' ? pending() : pending; } catch (_) {}
      if (matches(content)) { clearTimeout(timers.get(target)); timers.delete(target); queuedContents.delete(target); }
    });
    await _store('readwrite', async (store) => {
      for (const target of targets) {
        const item = await _request(store.get(target));
        if (item && matches(item.content)) store.delete(target);
      }
    });
    targets.forEach(target => {
      const item = JSON.parse(localStorage.getItem(RESERVATION_PREFIX + target) || 'null');
      if (item && matches(item.content)) localStorage.removeItem(RESERVATION_PREFIX + target);
    });
  }

  async function markSynced(path, expectedContent) {
    const key = _draftStorageKey(path);
    // 保存完了より遅い退避タイマーが、保存済み本文を下書きへ戻さない。
    // 新しい入力の予約は下の内容照合で保持する。
    if (expectedContent !== undefined && timers.has(key)) {
      const pending = queuedContents.get(key);
      let content;
      try { content = typeof pending === 'function' ? pending() : pending; } catch (_) {}
      if (content === expectedContent) {
        clearTimeout(timers.get(key));
        timers.delete(key);
        queuedContents.delete(key);
      }
    }
    if (expectedContent === undefined) {
      // Older callers cannot identify which live-input reservation they saved.
      // Preserve it rather than clearing a newer edit in another surface.
      try { if (localStorage.getItem(RESERVATION_PREFIX + key)) return; } catch (_) {}
      return clearDraft(path);
    }
    try {
      const item = JSON.parse(localStorage.getItem(RESERVATION_PREFIX + key) || 'null');
      if (item && item.content !== expectedContent) return;
      if (item) localStorage.removeItem(RESERVATION_PREFIX + key);
    } catch (_) {}
    await _store('readwrite', async store => {
      const item = await _request(store.get(key));
      if (item?.content === expectedContent) store.delete(key);
    }).catch(() => {});
  }

  async function listDrafts() {
    const scope = _draftScope();
    const all = await _store('readonly', (store) => _request(store.getAll())).catch(() => []);
    const merged = new Map((Array.isArray(all) ? all : []).map(item => [item.path, item]));
    // The synchronous reservation is authoritative over an older async write.
    for (const item of _reservations()) merged.set(item.path, item);
    return [...merged.values()]
      .filter(item => _isCurrentScopeDraft(item, scope))
      .map(_publicDraft)
      .sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  function _fileLabel(path) {
    return String(path || '').split('/').pop() || String(path || '');
  }

  function _draftLabel(item) {
    return window.GBPathUtils?.displayTitle?.read?.(item.content, item.path) || _fileLabel(item.path);
  }

  async function _overwriteDraft(item) {
    if (typeof apiPut !== 'function') throw new Error('保存できませんでした');
    const res = await apiPut('/file?path=' + encodeURIComponent(item.path), { content: item.content || '', force_overwrite: true });
    await clearDraft(item.path, item.storageKey, item.content);
    const format = window.MeldexDocumentIdentity?.formatForPath?.(item.path, item.content);
    if ((format === 'scenario' || /\.(?:mel-scenario|scriptnote\.json)$/i.test(item.path)) && typeof openScenarioInScriptNote === 'function') {
      await openScenarioInScriptNote(item.path, _fileLabel(item.path));
    } else if ((format === 'board' || /\.mel-board$/i.test(item.path)) && typeof openBoard === 'function') {
      await openBoard(_fileLabel(item.path), item.path);
    } else if (typeof openPage === 'function') {
      await openPage(_fileLabel(item.path).replace(/\.md$/i, ''), item.path);
      const pc = document.getElementById('page-content');
      if (pc && pc.dataset.path === item.path) pc.dataset.lastSavedEtag = res.etag || pc.dataset.lastSavedEtag || '';
    }
    if (typeof showStatus === 'function') showStatus('保存されていない編集内容を上書き保存しました');
  }

  async function _fileExists(path) {
    if (typeof apiFetch !== 'function') return false;
    try {
      await apiFetch('/file?path=' + encodeURIComponent(path) + '&metadata_only=1', { silentError: true });
      return true;
    } catch (error) {
      if (error?.status === 404) return false;
      return true;
    }
  }

  async function _saveDraftAs(item) {
    if (typeof cfPrompt !== 'function' || typeof apiPut !== 'function') return false;
    const fallback = String(item.path || '').replace(/(\.[^/.]+)?$/, '_recovered$1');
    const nextPath = await cfPrompt('保存されていない編集内容を別名で保存', fallback);
    if (!nextPath) return false;
    const canonical = value => {
      let path = String(value || '').trim().replace(/\\/g, '/');
      const cloud = window.MeldexRuntimeAdapter?.getMode?.() === 'dropbox';
      if (!cloud && !/^(?:[a-z]:\/|\/)/i.test(path)) {
        try { if (typeof state !== 'undefined' && state.vaultPath) path = state.vaultPath.replace(/\\/g, '/') + '/' + path; } catch (_) {}
      }
      const parts = [];
      for (const part of path.split('/')) {
        if (part === '.') continue;
        if (part === '..' && parts.length) parts.pop();
        else parts.push(part);
      }
      return parts.join('/').toLowerCase();
    };
    if (canonical(nextPath) === canonical(item.path)) {
      if (typeof showStatus === 'function') showStatus('元ファイルとは別の名前を指定してください', true);
      return false;
    }
    const exists = await _fileExists(nextPath);
    if (exists) {
      if (typeof showStatus === 'function') showStatus('同名のファイルが既にあります。別の名前を指定してください', true);
      return false;
    }
    let content = item.content || '';
    if (String(nextPath) !== String(item.path)) {
      const identity = window.MeldexDocumentIdentity;
      const format = identity?.formatForPath?.(nextPath, content);
      if (format) {
        if (!identity?.regenerateDocumentId) throw new Error('復旧コピーの文書IDを作成できません');
        const regenerated = identity.regenerateDocumentId(content, format);
        if (!regenerated?.documentId) throw new Error('復旧コピーの文書IDを作成できません');
        content = regenerated.text;
      }
    }
    await apiPut('/file?path=' + encodeURIComponent(nextPath), {
      content,
      create_only: true,
    });
    await clearDraft(item.path, item.storageKey, item.content);
    if (typeof showStatus === 'function') showStatus('保存されていない編集内容を別名保存しました');
    return true;
  }

  async function _confirmDiscard(message) {
    if (typeof cfConfirm === 'function') {
      return !!await cfConfirm(message, { danger: true, okLabel: '破棄', cancelLabel: 'キャンセル' });
    }
    if (typeof window.confirm === 'function') return window.confirm(message);
    return false;
  }

  // 読込も描画も明示操作時だけ。差分計算の入力を先に制限する。
  async function _inspectDraft(item, host) {
    if (host.dataset.loaded === '1' || host.dataset.loading === '1') return;
    host.dataset.loading = '1';
    host.textContent = '読み込み中...';
    const limit = 16000;
    const split = text => {
      const raw = String(text || '');
      const frontmatter = /\.md$/i.test(item.path) ? /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(raw)?.[0] || '' : '';
      return {frontmatter, body: raw.slice(frontmatter.length)};
    };
    const clip = text => String(text || '').slice(0, limit).split('\n').slice(0, 200).join('\n');
    try {
      let disk = '', diskFrontmatter = '', missing = false, truncated = false;
      try {
        const result = await apiFetch('/file?path=' + encodeURIComponent(item.path) + '&preview_chars=' + limit, { silentError: true });
        const source = split(result.content);
        disk = source.body;
        diskFrontmatter = String(result.frontmatter || source.frontmatter || '');
        truncated = !!result.truncated;
      } catch (error) {
        if (error?.status !== 404) throw error;
        missing = true;
      }
      const source = split(item.content);
      const draft = clip(source.body), current = clip(disk);
      truncated ||= draft !== source.body || current !== disk;
      host.textContent = '';
      const status = document.createElement('div');
      status.className = 'gb-section-desc';
      status.textContent = missing ? 'ファイルが見つかりません' : draft === current ? '表示範囲に差分はありません' : '変更箇所';
      host.append(status);
      if (source.frontmatter || diskFrontmatter) {
        const metadata = document.createElement('div');
        metadata.textContent = source.frontmatter === diskFrontmatter ? '本文を表示' : '設定にも変更があります';
        metadata.title = '本文から保存設定を除いて比較しています。保存は設定を含む下書き全体を対象にします';
        host.append(metadata);
      }
      const grid = document.createElement('div');
      grid.className = 'draft-recovery-diff';
      grid.setAttribute('role', 'table');
      grid.setAttribute('aria-label', '未保存の内容と現在のファイル');
      const render = (left, right) => {
        grid.textContent = '';
        for (const title of ['未保存の内容', '現在のファイル']) {
          const label = document.createElement('strong'); label.textContent = title; grid.append(label);
        }
        const a = clip(left).split('\n'), b = missing ? [] : clip(right).split('\n');
        const rows = typeof _computeDiff === 'function' ? _computeDiff(a, b)
          : Array.from({length: Math.max(a.length, b.length)}, (_, i) => ({textA:a[i],textB:b[i],type:a[i]===b[i]?'equal':'change'}));
        for (const row of rows) {
          for (const text of [row.textA, row.textB]) {
            const line = document.createElement('div');
            line.className = row.type === 'equal' ? '' : 'draft-diff-changed';
            line.textContent = text ?? '';
            grid.append(line);
          }
        }
      };
      render(draft, current);
      if (source.frontmatter || diskFrontmatter) {
        const toggle = document.createElement('button');
        toggle.className = 'gb-btn gb-btn-sm';toggle.type = 'button';toggle.textContent = '設定の差分';
        toggle.setAttribute('aria-pressed', 'false');
        toggle.title = '保存設定も先頭16,000文字・200行まで比較できます';
        toggle.addEventListener('click', () => {
          const settings = toggle.getAttribute('aria-pressed') !== 'true';
          toggle.setAttribute('aria-pressed', String(settings));toggle.textContent = settings ? '本文の差分' : '設定の差分';
          render(settings ? source.frontmatter : draft, settings ? diskFrontmatter : current);
        });
        host.append(toggle);
      }
      host.append(grid);
      if (truncated || clip(source.frontmatter) !== source.frontmatter || clip(diskFrontmatter) !== diskFrontmatter) {
        const label = document.createElement('div'); label.textContent = '先頭部分のみ表示';
        label.title = '各本文の先頭16,000文字・200行まで表示します。保存は下書き全体を対象にします';
        host.append(label);
      }
      host.dataset.loaded = '1';
    } catch (error) {
      host.textContent = '読み込めませんでした';
      const retry = document.createElement('button');retry.className = 'gb-btn gb-btn-sm';retry.textContent = '再試行';
      retry.addEventListener('click', () => _inspectDraft(item, host));host.append(retry);
    } finally { delete host.dataset.loading; }
  }

  // 編集ロック中（マニュアル等のシステム保護を含む）のパスに残っているドラフトを消す。
  // _isPathLocked() は新規の積み増しを防ぐだけで、すでに入っているレコードは残るため、
  // ロックされる前に一度でも保存へ失敗していると、本体保存が必ず弾かれる＝同期済みに
  // ならず、起動のたびに「未保存の編集があります」が出続けていた。
  async function _pruneLockedDrafts(drafts) {
    // 起動途中は保存方式が未確定でも、旧マニュアルの保全データを消さない。
    const locked = (drafts || []).filter(item => _isPathLocked(item.path) && !_isRetiredQuickStartPath(item.path));
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
      const pendingManualRequest = recoveryRetryOptions && !recoveryRetryOptions.startup;
      if (recoveryRetryTimer) {
        clearTimeout(recoveryRetryTimer);
        recoveryRetryTimer = 0;
        recoveryRetryOptions = null;
      }
      // 一度出した（あるいは出す必要が無いと判断した）あとは出し直さない。
      // setSystemLockedItems は設定画面やツリー更新でも呼ばれるため、ここで無条件に
      // 開くと、ユーザーが閉じたダイアログが操作のたびに復活してしまう。
      if (pendingManualRequest) showRecoveryDialog().catch(() => {});
      else if (remaining.length && !startupPromptSettled) showRecoveryDialog({ startup: true }).catch(() => {});
      return;
    }
    const alive = new Set(remaining.map(item => String(item.path || '')));
    overlay.querySelectorAll('[data-draft-row]').forEach((row) => {
      const label = row.dataset.draftPath || '';
      if (label && !alive.has(label)) row.remove();
    });
    if (!overlay.querySelector('[data-draft-row]')) {
      if (activeRecoveryModal?.overlay === overlay) activeRecoveryModal.close('no-drafts');
      else overlay.remove();
    }
  }

  function _isRetiredQuickStartPath(value) {
    const path = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
    return path === 'MeldexHome/マニュアル/01_はじめに/クイックスタート.md';
  }

  async function showRecoveryDialog(options = {}) {
    if (options.startup && startupPromptSettled) return;
    const available = await _pruneLockedDrafts(await listDrafts());
    const drafts = options.startup
      // 旧同梱マニュアルは保存方式の初期化順序に関係なく自動案内から外す。
      // 本文は保持し、設定から開く明示的な一覧には引き続き含める。
      ? available.filter(item => !sessionDraftKeys.has(item.storageKey) && !_isRetiredQuickStartPath(item.path))
      : available;
    if (!drafts.length) {
      startupPromptSettled = true;
      return;
    }
    if (document.querySelector('[data-draft-recovery-dialog="1"]')) return;
    if (_systemLocksPending()) {
      // ロック一覧が来る前に出すと、閲覧専用ファイルの残骸まで一緒に出てしまう
      lockWaitAttempts += 1;
      _scheduleRecoveryRetry(options);
      return;
    }
    if (_hasBlockingStartupDialog()) {
      _scheduleRecoveryRetry(options);
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
      <div class="draft-recovery-row" data-draft-row data-draft-index="${index}" data-draft-path="${esc(item.path)}">
        <div class="draft-recovery-info">
          <div class="draft-recovery-name" title="${esc(_draftLabel(item))}">${esc(_draftLabel(item))}</div>
          <div class="draft-recovery-meta draft-recovery-location">${esc(item.path)}</div>
          <time datetime="${esc(item.savedAt || '')}">${esc(new Date(item.savedAt).toLocaleString())}</time>
        </div>
        <div class="draft-recovery-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-draft-action="inspect" data-draft-index="${index}" aria-expanded="false">内容を確認</button>
          <button type="button" class="gb-btn gb-btn-sm" data-draft-action="reveal" data-draft-index="${index}" title="フォルダツリーで表示">場所を表示</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-primary" data-draft-action="overwrite" data-draft-index="${index}" data-e2e-id="draft-recovery-${index}-overwrite">上書き保存</button>
          <button type="button" class="gb-btn gb-btn-sm" data-draft-action="save-as" data-draft-index="${index}" data-e2e-id="draft-recovery-${index}-save-as">別名保存</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-draft-action="discard" data-draft-index="${index}" data-e2e-id="draft-recovery-${index}-discard" aria-label="${esc(_fileLabel(item.path))} の保存されていない変更を破棄">破棄</button>
        </div>
        <div data-draft-preview hidden></div>
      </div>`).join('');
    const body = document.createElement('div');
    body.className = 'draft-recovery-content';
    body.innerHTML = `
      <div id="draft-recovery-description" class="gb-section-desc">前回終了時に保存されなかった編集内容があります。</div>
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
    closeButton.title = '下書きを残して閉じます。設定から再び確認できます';
    let busy = false;
    const modalApi = window.GBUI.createModal({
      id: 'draft-recovery',
      title: '未保存の変更',
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
      if (busy) return;
      if (action === 'close') { modalApi.close('close-button'); return; }
      if (action === 'discard-all') {
        busy = true;
        try {
          if (!await _confirmDiscard('保存されていない変更をすべて破棄しますか？この操作は元に戻せません。')) return;
          await clearAllDrafts();
          busy = false;
          modalApi.close('discard-all');
          if (typeof showStatus === 'function') showStatus('保存されていない変更をすべて破棄しました');
        } catch (error) {
          if (typeof showStatus === 'function') showStatus(error?.message || '破棄できませんでした', true);
        } finally {
          busy = false;
        }
        return;
      }
      const item = drafts[Number(button.dataset.draftIndex)];
      if (!item) return;
      if (action === 'inspect') {
        const host = button.closest('[data-draft-row]').querySelector('[data-draft-preview]');
        host.hidden = !host.hidden;
        button.setAttribute('aria-expanded', String(!host.hidden));
        if (!host.hidden) await _inspectDraft(item, host);
        return;
      }
      if (action === 'reveal') {
        await window.revealPathInFolderTree?.(item.path);
        modalApi.close('reveal');
        return;
      }
      busy = true;
      overlay.querySelectorAll('[data-draft-action]').forEach(b => { b.disabled = true; });
      try {
        if (action === 'overwrite') {
          if (typeof cfConfirm !== 'function' || !await cfConfirm('現在のファイルを下書きで上書きしますか？', {danger:true,okLabel:'上書き保存',cancelLabel:'キャンセル'})) return;
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
          if (!await _confirmDiscard(`「${_fileLabel(item.path)}」の保存されていない変更を破棄しますか？この操作は元に戻せません。`)) return;
          await clearDraft(item.path, item.storageKey, item.content);
          button.closest('[data-draft-row]')?.remove();
          if (!overlay.querySelector('[data-draft-row]')) {
            busy = false;
            modalApi.close('discard-last');
          }
        }
      } catch (error) {
        if (typeof showStatus === 'function') showStatus(error?.message || '保存できませんでした', true);
      } finally {
        busy = false;
        overlay.querySelectorAll('[data-draft-action]').forEach(b => { b.disabled = false; });
      }
    });
    modalApi.open();
    startupPromptSettled = true;
  }

  function scheduleStartupCheck() {
    setTimeout(() => showRecoveryDialog({ startup: true }).catch(() => {}), 1800);
  }

  window.MeldexDraftRecovery = {
    reserveDraft,
    queueDraft,
    queueDraftFactory,
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
