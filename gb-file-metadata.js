/* 画像・文書の埋め込み情報表示と、画像の評価・メモ編集 */
(() => {
  const cache = new Map();
  const editorRevisions = new WeakMap();
  let folderTagCatalogRefreshTimer = null;

  function embeddedOf(meta) {
    return meta?.embedded && typeof meta.embedded === 'object' ? meta.embedded : null;
  }

  function webclipOf(meta) {
    const embedded = embeddedOf(meta);
    const value = meta?.webclip || embedded?.webclip;
    return value && typeof value === 'object' ? value : null;
  }

  function httpUrl(value) {
    try {
      const parsed = new URL(String(value || '').trim());
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function row(label, value, className = '') {
    const wrapper = document.createElement('div');
    wrapper.className = 'file-embedded-row' + (className ? ' ' + className : '');
    const key = document.createElement('span');
    key.className = 'file-embedded-key';
    key.textContent = label;
    const content = document.createElement('span');
    content.className = 'file-embedded-value';
    content.textContent = value == null ? '' : String(value);
    wrapper.append(key, content);
    return { wrapper, content };
  }

  function dimensionText(embedded, image) {
    const width = Number(embedded?.width || image?.naturalWidth || 0);
    const height = Number(embedded?.height || image?.naturalHeight || 0);
    return width > 0 && height > 0 ? `${width} × ${height} px` : '';
  }

  async function load(path, preloaded, options = {}) {
    const key = String(path || '');
    if (!key) return preloaded || null;
    if (!options.force && preloaded?.embedded !== undefined) {
      cache.set(key, preloaded);
      return preloaded;
    }
    if (!options.force && cache.has(key)) return cache.get(key);
    const pending = apiFetch('/file-meta?path=' + encodeURIComponent(key), { silentError: true })
      .then(meta => {
        if (cache.get(key) === pending) cache.set(key, meta);
        return meta;
      })
      .catch(error => {
        if (cache.get(key) === pending) cache.delete(key);
        return {
          _metadataLoadError: error?.userMessage || error?.message || String(error),
        };
      });
    cache.set(key, pending);
    const resolved = await pending;
    if (resolved && cache.get(key) === pending) cache.set(key, resolved);
    return resolved;
  }

  // 書き込み先の文脈（Windows版Meldex Viewerの作業範囲など）。表示面が用意した値を、評価・メモの
  // 編集欄を作った時点で固定して保存要求へ添える。本体では用意されないため何も足さない。
  function metadataWriteContext() {
    try {
      const context = window.MeldexEmbeddedMetadataWriteContext?.();
      return context && typeof context === 'object' ? { ...context } : null;
    } catch {
      return null;
    }
  }

  async function update(path, patch, writeContext = null) {
    const meta = await apiPost('/file-meta', { ...(writeContext || {}), ...patch, path }, { silentError: true, requireRemoteCommit: true });
    cache.set(String(path), meta);
    refreshRatingControls(path, meta);
    return meta;
  }

  function pushMetadataHistory(label, undo, redo, scope = '') {
    if (typeof historyPush === 'function') return historyPush(label, undo, redo, scope);
    return window.MeldexViewerHistory?.push?.(label, undo, redo);
  }

  function metadataHistoryLane(path) {
    const scope = window.GBAnnotationSurfaces?.historyScope?.() || '';
    const normalized = typeof _normalizeAnnotationTargetPath === 'function'
      ? _normalizeAnnotationTargetPath(path) : String(path || '').replace(/\\/g, '/');
    // 本体の画像タブではUndoの入口が注釈の履歴を使う。同じファイルの
    // プロパティだけをその面へ結び、他のファイルの履歴は混ぜない。
    return normalized && scope.startsWith('annotation:' + normalized + '#') ? scope : '';
  }

  function metadataHistoryScope() {
    return { token: window.MeldexFileIcons?.scope?.(), vault: typeof state !== 'undefined' ? state.vaultPath : '' };
  }

  function setRatingButtons(group, rating) {
    const current = Math.max(0, Math.min(5, Number(rating) || 0));
    group.dataset.rating = String(current);
    group.closest('.fv-image-rating-host')?.classList.toggle('has-rating', current > 0);
    group.querySelectorAll('button').forEach((button, index) => {
      const active = index < current;
      button.classList.toggle('is-active', active);
      button.textContent = active ? '★' : '☆';
      button.setAttribute('aria-pressed', String(index + 1 === current));
    });
  }

  function ratingControl(path, meta, options = {}) {
    const embedded = embeddedOf(meta) || {};
    const e2ePath = String(path || '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
    const group = document.createElement('div');
    group.className = options.compact ? 'file-rating file-rating--compact' : 'file-rating';
    group.dataset.fileRatingPath = String(path || '');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '評価');
    const editable = embedded.editable === true;
    const writeContext = editable ? metadataWriteContext() : null;
    for (let value = 1; value <= 5; value++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.value = String(value);
      button.dataset.e2eId = `file-rating-${e2ePath}-${value}`;
      button.setAttribute('aria-label', `評価 ${value}`);
      button.disabled = !editable;
      button.title = editable ? `${value}つ星に設定（同じ評価を押すと解除）` : 'この形式の評価は閲覧のみです';
      button.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        if (!editable || group.dataset.saving === '1') return;
        const previous = Number(group.dataset.rating) || 0;
        const next = previous === value ? 0 : value;
        const scopeToken = window.MeldexFileIcons?.scope?.();
        const vaultPath = typeof state !== 'undefined' ? state.vaultPath : '';
        const historyLane = metadataHistoryLane(path);
        const reservation = typeof historyReserve === 'function' ? historyReserve('ファイル: 評価', historyLane) : null;
        group.dataset.saving = '1';
        setRatingButtons(group, next);
        try {
          await update(path, { rating: next }, writeContext);
          const restore = rating => {
            if (scopeToken !== window.MeldexFileIcons?.scope?.() || vaultPath !== (typeof state !== 'undefined' ? state.vaultPath : '')) {
              throw new Error('保存先が変わったため評価を戻せません');
            }
            return update(path, { rating }, writeContext);
          };
          const register = () => pushMetadataHistory('ファイル: 評価', () => restore(previous), () => restore(next), historyLane);
          if (reservation) reservation.capture(register); else register();
          if (typeof showStatus === 'function') showStatus(next ? `評価を${next}つ星にしました` : '評価を解除しました');
        } catch (error) {
          setRatingButtons(group, previous);
          if (typeof showStatus === 'function') showStatus('評価を保存できませんでした: ' + (error?.message || error), true);
        } finally {
          reservation?.cancel();
          delete group.dataset.saving;
        }
      });
      group.appendChild(button);
    }
    setRatingButtons(group, embedded.rating);
    return group;
  }

  function refreshRatingControls(path, meta) {
    const target = String(path || '');
    document.querySelectorAll('[data-file-rating-path]').forEach(group => {
      if (group.dataset.fileRatingPath === target) {
        setRatingButtons(group, embeddedOf(meta)?.rating);
      }
    });
  }

  function appendLinkRow(host, label, value) {
    const url = httpUrl(value);
    if (!url) return;
    const built = row(label, '');
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = url;
    built.content.appendChild(link);
    host.appendChild(built.wrapper);
  }

  // === メモの自動保存 ===
  // 画像ファイル本体へ書き込むため、打鍵ごとには保存せず入力が止まってから書き出す。
  // 入力欄から離れた時・ファイルを切り替えた時・ウィンドウを閉じる時は即座に確定させる。
  const MEMO_AUTOSAVE_DELAY_MS = 1200;
  const pendingMemos = new Map();
  const MEMO_DRAFT_PREFIX = 'meldex-file-memo-draft-v1:';
  const MEMO_DRAFT_MAX_CHARS = 250000;

  function _memoDraftIdentity(path, writeContext) {
    const workspace = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    const mode = window.MeldexRuntimeAdapter?.getMode?.() || 'legacy';
    const account = String(workspace.accountId || workspace.ownerId || '');
    const root = String(workspace.path || metadataHistoryScope().vault || writeContext?.expected_root
      || window.MeldexViewerScene?.currentRootPath?.() || '');
    const scope = JSON.stringify([mode, account, root || (window.location?.origin || '') + (window.location?.pathname || '')]);
    let file = String(path || '').replace(/\\/g, '/');
    if (typeof _normalizeAnnotationTargetPath === 'function') file = _normalizeAnnotationTargetPath(file);
    else if (root && !/^(?:[a-z]:\/|\/|[a-z]+:\/\/)/i.test(file)) file = root.replace(/\\/g, '/').replace(/\/$/, '') + '/' + file;
    return { scope, file, key: MEMO_DRAFT_PREFIX + JSON.stringify([scope, file]) };
  }

  function _readMemoDraft(identity) {
    const raw = localStorage.getItem(identity.key);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (draft?.schema !== 1 || draft.scope !== identity.scope || draft.file !== identity.file
      || typeof draft.value !== 'string' || typeof draft.base !== 'string' || typeof draft.owner !== 'string'
      || draft.value.length > MEMO_DRAFT_MAX_CHARS || draft.base.length > MEMO_DRAFT_MAX_CHARS) {
      throw new Error('未保存メモの復旧情報を読み込めませんでした');
    }
    return draft;
  }

  function _memoDraftError(error, kind) {
    const name = /^[A-Za-z][A-Za-z0-9]*Error$/.test(error?.name || '') ? error.name : 'Error';
    window.MeldexDiagnostics?.recordSheetIncident?.(kind, {
      op: 'viewer.metadata-draft', errorType: name, source: 'local-storage',
    });
    console.warn('メモの端末内保全に失敗しました', name);
  }

  function _reserveMemoDraft(textarea, memo, fromInput = false) {
    try {
      const saved = _readMemoDraft(memo.draftIdentity);
      if (textarea.value === memo.savedValue) {
        if (!memo.draftConflict && saved?.owner === memo.draftOwner) localStorage.removeItem(memo.draftIdentity.key);
        memo.draftFailed = false;
        return true;
      }
      // 保存先が変わった場合は両方を残す。古い未保存メモを自動的に上書きしない。
      if (memo.draftConflict && textarea.value !== memo.draftConflict.value) throw new Error('別の未保存メモを保全しています');
      if (memo.draftConflict) {
        memo.draftConflict = null;
        memo.draftConflictView?.remove();
      }
      // 保存応答が遅れて戻っても、別の編集欄が後から保全した内容を消さない。
      if (!fromInput && saved && saved.owner !== memo.draftOwner) {
        memo.draftFailed = saved.value !== textarea.value;
        return !memo.draftFailed;
      }
      if (textarea.value.length > MEMO_DRAFT_MAX_CHARS || memo.savedValue.length > MEMO_DRAFT_MAX_CHARS) {
        throw new Error('端末内へ保全できるメモの大きさを超えました');
      }
      localStorage.setItem(memo.draftIdentity.key, JSON.stringify({
        schema: 1, scope: memo.draftIdentity.scope, file: memo.draftIdentity.file, owner: memo.draftOwner,
        base: memo.savedValue, value: textarea.value,
      }));
      memo.draftFailed = false;
      return true;
    } catch (error) {
      memo.draftFailed = true;
      _memoDraftError(error, 'save-failed');
      return false;
    }
  }

  function _restoreMemoDraft(textarea, memo) {
    try {
      const draft = _readMemoDraft(memo.draftIdentity);
      if (!draft) return;
      if (draft.value === memo.savedValue) {
        localStorage.removeItem(memo.draftIdentity.key);
        return;
      }
      if (draft.base === memo.savedValue) {
        textarea.value = draft.value;
        const protectedValue = _reserveMemoDraft(textarea, memo, true);
        _memoStatus(memo.statusEl, protectedValue ? '未保存' : '端末内に保全できませんでした', !protectedValue);
        return;
      }
      memo.draftConflict = draft;
      const details = document.createElement('details');
      details.className = 'file-embedded-group';
      details.dataset.e2eId = 'file-memo-draft-conflict';
      const summary = document.createElement('summary');
      summary.textContent = '別の未保存メモ';
      const explanation = document.createElement('p');
      explanation.textContent = '保存先の内容が変わったため、未保存のメモを別に残しています';
      const preview = document.createElement('textarea');
      preview.readOnly = true;
      preview.setAttribute('aria-label', '別の未保存メモ');
      preview.value = draft.value;
      details.append(summary, explanation, preview);
      memo.statusEl.closest('.file-embedded-memo').append(details);
      memo.draftConflictView = details;
    } catch (error) {
      memo.draftConflict = { unreadable: true };
      _memoStatus(memo.statusEl, '未保存メモを読み込めませんでした', true);
      _memoDraftError(error, 'load-failed');
    }
  }

  function _memoStatus(el, text, isError) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('file-embedded-memo-status--error', !!isError);
  }

  function _flushMemo(textarea) {
    const state = pendingMemos.get(textarea);
    if (!state) return Promise.resolve(true);
    _reserveMemoDraft(textarea, state);
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    if (state.composing) return Promise.resolve(false);
    if (state.drain) return state.drain;
    state.drain = _drainMemo(textarea, state).finally(() => {
      state.drain = null;
      if (!state.composing && textarea.value === state.savedValue && state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (!textarea.isConnected && textarea.value === state.savedValue) pendingMemos.delete(textarea);
    });
    return state.drain;
  }

  async function _drainMemo(textarea, state) {
    let wrote = false;
    // 保存中に追記された分も書き切る。失敗したらそこで打ち切り、無限に再送しない。
    while (textarea.value !== state.savedValue) {
      if (state.composing) return false;
      const value = textarea.value;
      const previous = state.savedValue;
      const scope = metadataHistoryScope();
      const historyLane = metadataHistoryLane(state.path);
      const reservation = typeof historyReserve === 'function' ? historyReserve('ファイル: メモ', historyLane) : null;
      _memoStatus(state.statusEl, '保存中...');
      state.inflight = update(state.path, { note: value }, state.writeContext);
      try {
        await state.inflight;
        wrote = true;
        state.savedValue = value;
        _reserveMemoDraft(textarea, state);
        const restore = async note => {
          const currentScope = metadataHistoryScope();
          if (scope.token !== currentScope.token || scope.vault !== currentScope.vault) {
            throw new Error('保存先が変わったためメモを戻せません');
          }
          if ([...pendingMemos].some(([editor, pending]) => pending.path === state.path && editor.value !== pending.savedValue)) {
            throw new Error('未保存のメモがあるため履歴を適用できません');
          }
          await update(state.path, { note }, state.writeContext);
          for (const [editor, pending] of pendingMemos) {
            if (pending.path !== state.path || editor.value !== pending.savedValue) continue;
            editor.value = note; pending.savedValue = note;
            _memoStatus(pending.statusEl, '保存済み');
          }
        };
        const register = () => pushMetadataHistory('ファイル: メモ', () => restore(previous), () => restore(value), historyLane);
        if (reservation) reservation.capture(register); else register();
        _memoStatus(state.statusEl, '保存済み');
      } catch (error) {
        state.hadSaveFailure = true;
        _memoStatus(state.statusEl, '保存できませんでした', true);
        if (typeof showStatus === 'function') showStatus('メモを保存できませんでした: ' + (error?.message || error), true);
        return false;
      } finally {
        state.inflight = null;
        reservation?.cancel();
      }
    }
    if (state.hadSaveFailure) {
      state.hadSaveFailure = false;
      if (textarea.isConnected && typeof showStatus === 'function') {
        showStatus(wrote ? 'このメモを保存しました' : '未保存の変更を元に戻しました');
      }
    }
    return true;
  }

  // パネル切り替え・ウィンドウを閉じる直前に呼ぶ。未確定のメモを全部書き出す。
  async function flushPendingMemos() {
    const results = await Promise.all([...pendingMemos.keys()].map(textarea => _flushMemo(textarea)));
    return results.every(result => result !== false) && !hasPendingMemos();
  }

  // 未確定（入力待ち・保存中・保存失敗）のメモがあるか。表示中のフォルダを切り替える前の確認に使う。
  function hasPendingMemos() {
    for (const [textarea, state] of pendingMemos) {
      if (state.composing || state.timer || state.drain || state.inflight || textarea.value !== state.savedValue) return true;
    }
    return false;
  }

  // パネルが作り直されると入力欄ごと差し替わる。取り残された未保存分は
  // 書き出してから登録を捨てる（待たない。描画を止めないため）。
  function _pruneDetachedMemos() {
    for (const textarea of [...pendingMemos.keys()]) {
      if (textarea.isConnected) continue;
      const state = pendingMemos.get(textarea);
      if (state && (state.drain || textarea.value !== state.savedValue)) {
        if (!state.drain) void _flushMemo(textarea);
      } else pendingMemos.delete(textarea);
    }
  }

  function bindMemoAutosave(textarea, statusEl, path, initialValue) {
    _pruneDetachedMemos();
    const writeContext = metadataWriteContext();
    const memoState = {
      path,
      statusEl,
      savedValue: initialValue,
      timer: null,
      inflight: null,
      drain: null,
      composing: false,
      writeContext,
      draftIdentity: _memoDraftIdentity(path, writeContext),
      draftOwner: crypto.randomUUID?.() || String(Date.now()) + Math.random(),
      draftFailed: false,
      draftConflict: null,
    };
    pendingMemos.set(textarea, memoState);
    _restoreMemoDraft(textarea, memoState);
    const scheduleSave = event => {
      const state = pendingMemos.get(textarea);
      if (!state) return;
      if (state.timer) clearTimeout(state.timer);
      const protectedValue = _reserveMemoDraft(textarea, state, true);
      _memoStatus(state.statusEl, protectedValue ? textarea.value === state.savedValue ? '' : '未保存'
        : '端末内に保全できませんでした', !protectedValue);
      if (state.composing || event?.isComposing) return;
      state.timer = setTimeout(() => { _flushMemo(textarea); }, MEMO_AUTOSAVE_DELAY_MS);
    };
    textarea.addEventListener('input', scheduleSave);
    textarea.addEventListener('compositionstart', () => {
      const state = pendingMemos.get(textarea);
      if (!state) return;
      state.composing = true;
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    });
    textarea.addEventListener('compositionend', () => {
      const state = pendingMemos.get(textarea);
      if (!state) return;
      state.composing = false;
      scheduleSave();
    });
    textarea.addEventListener('blur', () => { _flushMemo(textarea); });
    textarea.addEventListener('keydown', event => {
      if (!event.isComposing && !pendingMemos.get(textarea)?.composing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        _flushMemo(textarea);
      }
    });
  }

  window.addEventListener('pagehide', () => { flushPendingMemos(); });
  window.addEventListener('beforeunload', event => {
    if (![...pendingMemos].some(([textarea, memo]) => memo.draftFailed && textarea.value !== memo.savedValue)) return;
    event.preventDefault();
    event.returnValue = '';
  });

  function appendMetadataGroups(host, embedded) {
    const groups = Array.isArray(embedded?.groups) ? embedded.groups : [];
    if (!groups.length) return;
    const heading = document.createElement('div');
    heading.className = 'file-embedded-heading';
    heading.textContent = '埋め込み情報';
    host.appendChild(heading);
    groups.forEach((group, index) => {
      const items = Array.isArray(group?.items) ? group.items : [];
      if (!items.length) return;
      const details = document.createElement('details');
      details.className = 'file-embedded-group';
      // 埋め込み情報のグループは既定で全部閉じる（タグと主要項目は常に開いた状態のまま）。
      details.open = false;
      const summary = document.createElement('summary');
      summary.textContent = `${group.name || '情報'}（${items.length}）`;
      details.appendChild(summary);
      const list = document.createElement('div');
      list.className = 'file-embedded-list';
      items.forEach(item => {
        list.appendChild(row(item?.label || item?.key || '項目', item?.value || '').wrapper);
      });
      details.appendChild(list);
      host.appendChild(details);
    });
  }

  function renderEditor(primaryHost, groupsHost, path, meta) {
    if (!primaryHost) return;
    const revision = (editorRevisions.get(primaryHost) || 0) + 1;
    editorRevisions.set(primaryHost, revision);
    _pruneDetachedMemos();
    primaryHost.replaceChildren();
    if (groupsHost) groupsHost.replaceChildren();
    if (meta?._metadataLoadError) {
      const error = document.createElement('div');
      error.className = 'file-embedded-empty file-embedded-error';
      const message = document.createElement('span');
      message.textContent = '埋め込み情報を読み込めませんでした: ' + meta._metadataLoadError;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'gb-btn gb-btn-xs gb-btn-quiet';
      retry.textContent = '再試行';
      retry.setAttribute('aria-label', '埋め込み情報を再読み込み');
      retry.dataset.e2eId = 'file-embedded-metadata-retry';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        const refreshed = await load(path, null, { force: true });
        if (editorRevisions.get(primaryHost) !== revision || !primaryHost.isConnected) return;
        renderEditor(primaryHost, groupsHost, path, refreshed);
      });
      error.append(message, retry);
      primaryHost.appendChild(error);
      return;
    }
    const embedded = embeddedOf(meta);
    const webclip = webclipOf(meta);
    if (!embedded && !webclip) {
      const empty = document.createElement('div');
      empty.className = 'file-embedded-empty';
      empty.textContent = '表示できる埋め込み情報はありません';
      primaryHost.appendChild(empty);
      return;
    }

    if (embedded?.width && embedded?.height) {
      primaryHost.appendChild(row('画像サイズ', dimensionText(embedded)).wrapper);
    }
    if (embedded?.kind === 'image') {
      const ratingRow = row('評価', '');
      ratingRow.content.appendChild(ratingControl(path, meta));
      primaryHost.appendChild(ratingRow.wrapper);
    }
    appendLinkRow(primaryHost, '元ページ', webclip?.page_url);
    appendLinkRow(primaryHost, '画像URL', webclip?.image_url);
    if (webclip?.clipped_at) {
      primaryHost.appendChild(row('保存日時', webclip.clipped_at).wrapper);
    }

    if (embedded?.kind === 'image') {
      const editable = embedded.editable === true;
      const memo = document.createElement('div');
      memo.className = 'file-embedded-memo';
      const label = document.createElement('label');
      // 取り込み元（Web Clipper経由か否か）に関わらずどの画像でも使えるメモ欄のため、
      // 特定機能名を冠したラベルは付けない（用語統一ルール）。
      label.textContent = 'メモ';
      // 「画像ファイル内へ保存します」の説明は基本UIから外し、ラベル横の
      // ヘルプアイコンのツールチップへ集約する（UI共通ルール）。
      if (editable && typeof fieldHelp === 'function') {
        label.insertAdjacentHTML('beforeend', ' ' + fieldHelp('入力をやめると自動で保存されます。内容は画像ファイル自体に書き込まれます', { e2eId: 'file-embedded-memo-help' }));
      }
      const textarea = document.createElement('textarea');
      const initialNote = String(embedded.note || webclip?.note || '');
      textarea.value = initialNote;
      textarea.placeholder = 'メモを入力';
      textarea.disabled = !editable;
      textarea.dataset.e2eId = 'file-embedded-memo-input';
      const actions = document.createElement('div');
      actions.className = 'file-embedded-memo-actions';
      const status = document.createElement('span');
      status.className = 'file-embedded-memo-status';
      status.setAttribute('role', 'status');
      status.dataset.e2eId = 'file-embedded-memo-status';
      // 入力できない理由だけは可視のまま1行残す（条件付きの短い状態説明）。
      if (!editable) status.textContent = 'この形式のメモは閲覧のみです';
      actions.append(status);
      memo.append(label, textarea, actions);
      primaryHost.appendChild(memo);
      if (editable) bindMemoAutosave(textarea, status, path, initialNote);
    }
    if (groupsHost) appendMetadataGroups(groupsHost, embedded);
  }

  function renderFolderTags(host, item) {
    if (!host) return;
    const api = window.MeldexGlobalTags;
    const sourceFolder = String(item?.path && window.MeldexAutoTagSourceFolder?.(item.path) || '').trim();
    const catalog = api?.getCachedTagsSync?.(sourceFolder) || null;
    const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
    const groupsById = Object.fromEntries(groups.map(group => [group.id, group]));
    const rawTags = typeof _folderItemTags === 'function' ? _folderItemTags(item) : [];
    const visibleTags = window.MeldexTagDisplayPreferences?.filterVisibleTags?.(
      rawTags,
      groups,
      sourceFolder,
    ) || rawTags;
    const tags = typeof api?.sortTagsByGroupOrder === 'function'
      ? api.sortTagsByGroupOrder(visibleTags, groups)
      : visibleTags;
    const names = tags.map(tag => String(tag?.name || '')).filter(Boolean);
    const displayLimit = window.MeldexTagDisplayPreferences?.folderTagDisplayLimit?.()
      || api?.getCompactTagDisplayLimit?.()
      || 10;
    const allTagsTitle = `すべてのタグ（${names.length}件）\n${names.join('、')}`;
    host.replaceChildren();
    host.hidden = names.length === 0;
    host.title = allTagsTitle;
    tags.slice(0, displayLimit).forEach(tag => {
      const chip = typeof api?.createTagChip === 'function'
        ? api.createTagChip(tag, {
            compact: true,
            className: 'fv-folder-tag',
            groupsById,
          })
        : Object.assign(document.createElement('span'), {
            className: 'gb-tag-chip gb-tag-chip--compact fv-folder-tag',
            textContent: String(tag?.name || ''),
          });
      host.appendChild(chip);
    });
    if (names.length > displayLimit) {
      const label = `+${names.length - displayLimit}`;
      const more = typeof api?.createTagChip === 'function'
        ? api.createTagChip(null, {
            compact: true,
            summary: true,
            label,
            title: allTagsTitle,
            className: 'fv-folder-tag fv-folder-tag--more',
          })
        : Object.assign(document.createElement('span'), {
            className: 'gb-tag-chip gb-tag-chip--compact gb-tag-chip--summary fv-folder-tag fv-folder-tag--more',
            textContent: label,
            title: allTagsTitle,
          });
      host.appendChild(more);
    }
    if (!catalog && api?.loadTagsCached && host.dataset.folderTagCatalogLoading !== '1') {
      host.dataset.folderTagCatalogLoading = '1';
      api.loadTagsCached(sourceFolder).then(() => {
        delete host.dataset.folderTagCatalogLoading;
        if (host.isConnected) renderFolderTags(host, item);
      }).catch(() => {
        delete host.dataset.folderTagCatalogLoading;
      });
    }
  }

  function attachFolderTags(metaHost, item) {
    if (!metaHost || !item?.path) return null;
    const host = document.createElement('div');
    host.className = 'fv-folder-tags';
    host.dataset.folderTagsPath = String(item.path);
    host._folderTagItem = item;
    metaHost.appendChild(host);
    renderFolderTags(host, item);
    return host;
  }

  function refreshFolderTags(root = document) {
    root.querySelectorAll?.('[data-folder-tags-path]').forEach(host => {
      renderFolderTags(host, host._folderTagItem);
    });
  }

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('meldex:tag-dictionary-changed', () => {
      clearTimeout(folderTagCatalogRefreshTimer);
      folderTagCatalogRefreshTimer = setTimeout(() => {
        const hosts = Array.from(document.querySelectorAll('[data-folder-tags-path]'));
        const sourceFolders = new Set(hosts.map(host => String(
          host._folderTagItem?.path && window.MeldexAutoTagSourceFolder?.(host._folderTagItem.path) || '',
        ).trim()));
        const loads = Array.from(sourceFolders).map(sourceFolder =>
          window.MeldexGlobalTags?.loadTagsCached?.(sourceFolder),
        ).filter(Boolean);
        Promise.allSettled(loads).then(() => refreshFolderTags(document));
      }, 80);
    });
    window.addEventListener('meldex:compact-tag-display-limit-changed', () => {
      refreshFolderTags(document);
    });
    window.addEventListener('meldex:folder-tag-display-limit-changed', () => {
      refreshFolderTags(document);
    });
    window.addEventListener('meldex:tag-group-visibility-changed', () => {
      refreshFolderTags(document);
    });
  }

  function attachFolderCard(thumb, item, image, options = {}) {
    const metaHost = options.metaHost;
    const showDimensions = options.showDimensions !== false;
    const showRating = options.showRating !== false;
    if (!metaHost || item?.type !== 'image' || !item?.path || (!showDimensions && !showRating)) return;
    thumb?.classList.add('fv-thumb--embedded');
    const dimensions = showDimensions ? document.createElement('span') : null;
    if (dimensions) {
      dimensions.className = 'fv-image-dimensions fv-meta-item';
      dimensions.hidden = true;
      metaHost.appendChild(dimensions);
    }
    const ratingHost = showRating ? document.createElement('div') : null;
    if (ratingHost) {
      ratingHost.className = 'fv-image-rating-host fv-meta-item';
      metaHost.appendChild(ratingHost);
    }

    const updateDimensions = embedded => {
      if (!dimensions) return;
      const text = dimensionText(embedded, image);
      dimensions.textContent = text;
      dimensions.hidden = !text;
    };
    const hydrate = async () => {
      if (!metaHost.isConnected) return;
      updateDimensions(item.embedded);
      const preloaded = item.embedded ? { embedded: item.embedded } : null;
      const meta = await load(item.path, preloaded);
      if (!meta || meta._metadataLoadError || !metaHost.isConnected) return;
      item.embedded = embeddedOf(meta);
      updateDimensions(item.embedded);
      if (ratingHost) ratingHost.replaceChildren(ratingControl(item.path, meta, { compact: true }));
    };
    if (image && !(image.complete && image.naturalWidth)) {
      image.addEventListener('load', () => updateDimensions(item.embedded), { once: true });
    }
    queueMicrotask(hydrate);
  }

  window.MeldexEmbeddedMetadata = {
    attachFolderCard,
    attachFolderTags,
    dimensionText,
    flushPendingMemos,
    hasPendingMemos,
    load,
    refreshFolderTags,
    renderEditor,
    update,
  };
})();
