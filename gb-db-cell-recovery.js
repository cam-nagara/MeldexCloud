/* Failed cell input is kept separately from committed Sheet values. */
(function () {
  'use strict';
  const PREFIX = 'meldex-sheet-cell-recovery-v1:';
  const scopes = new Map();
  const owners = new WeakMap();
  const retries = new Map();
  function scopeIdentity(parts) {
    if (!Array.isArray(parts) || parts.length !== 4) return '';
    const path = String(parts[2] || '').replace(/\\/g, '/');
    const normalized = path === '/' || /^[a-z]:\/+$/i.test(path) ? path.replace(/\/+$/, '/') : path.replace(/\/+$/, '');
    return JSON.stringify([parts[0], parts[1], normalized, parts[3]]);
  }
  function valid(row) {
    return row && typeof row.entryPath === 'string' && typeof row.property === 'string'
      && typeof row.value === 'string';
  }
  function remember(storage, name, row) {
    const id = key(row);
    if (!storage.locations.has(id)) storage.locations.set(id, new Set());
    storage.locations.get(id).add(name);
    storage.rows.set(id, row);
    owners.set(row, storage.identity);
  }
  function store() {
    const workspace = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    const parts = [window.MeldexRuntimeAdapter?.getMode?.() || 'desktop',
      workspace.accountId || workspace.ownerId || '', workspace.path
        || (typeof state !== 'undefined' ? state.vaultPath : '') || '', location.origin];
    const identity = scopeIdentity(parts);
    if (!scopes.has(identity)) {
      const storage = { identity, storageKey: PREFIX + JSON.stringify(parts), rows: new Map(), locations: new Map() };
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const name = localStorage.key(i);
          if (!name?.startsWith(PREFIX)) continue;
          try {
            const end = name.indexOf('\n', PREFIX.length);
            if (end < 0 || scopeIdentity(JSON.parse(name.slice(PREFIX.length, end))) !== identity) continue;
            const row = JSON.parse(localStorage.getItem(name));
            if (valid(row)) remember(storage, name, row);
          } catch {}
        }
      } catch {}
      scopes.set(identity, storage);
    }
    return scopes.get(identity);
  }
  function key(row) { return JSON.stringify([row.entryPath, row.property, row.candidateIndex ?? null, row.draftId]); }
  function persist(storage, draft) {
    try {
      const known = storage.locations.get(key(draft));
      const name = known?.size === 1 ? [...known][0] : storage.storageKey + '\n' + key(draft);
      localStorage.setItem(name, JSON.stringify(draft));
      remember(storage, name, draft);
      return true;
    }
    catch { return false; }
  }
  function keep(row) {
    const storage = store();
    const draft = { ...row, value: String(row.value ?? ''), token: crypto.randomUUID(),
      draftId: row.draftId || crypto.randomUUID() };
    storage.rows.set(key(draft), draft);
    owners.set(draft, storage.identity);
    if (!persist(storage, draft) && typeof showStatus === 'function') {
      showStatus('端末への退避に失敗しました。未保存の入力をコピーしてから画面を閉じてください', true);
    }
    return draft;
  }
  function clear(row) {
    const storage = store();
    const matching = !row.draftId
      ? drafts(row.entryPath, row.property).filter(draft => draft.candidateIndex === row.candidateIndex
        || (draft.candidateIndex == null && row.candidateIndex == null))
      : [storage.rows.get(key(row))].filter(Boolean);
    for (const current of matching) {
      if ((row.token && current.token !== row.token) || current.value !== row.value) continue;
      const id = key(current), names = storage.locations.get(id) || new Set();
      for (const name of [...names]) {
        try {
          const saved = JSON.parse(localStorage.getItem(name));
          if (saved && (saved.token !== current.token || saved.value !== current.value)) continue;
          localStorage.removeItem(name); names.delete(name);
        } catch {}
      }
      if (!names.size) { storage.rows.delete(id); storage.locations.delete(id); }
    }
  }
  function drafts(entryPath, property) {
    return [...store().rows.values()].filter(row => row.entryPath === entryPath && row.property === property);
  }
  function assertCurrent(draft, identity) {
    const storage = store();
    if (storage.identity !== identity) throw new Error('保存先が変わりました。元の保存先で未保存の入力を確認してください');
    if (storage.rows.get(key(draft))?.token !== draft.token) {
      throw new Error('未保存の入力が更新されました。画面を読み直して再保存してください');
    }
    for (const name of storage.locations.get(key(draft)) || []) {
      const saved = JSON.parse(localStorage.getItem(name));
      if (!saved || saved.token !== draft.token) {
        throw new Error('未保存の入力が更新されました。画面を読み直して再保存してください');
      }
    }
  }
  async function saveDraft(draft, ctx, identity) {
    assertCurrent(draft, identity);
    const data = await apiFetch('/entity?path=' + encodeURIComponent(draft.entryPath));
    assertCurrent(draft, identity);
    const candidates = data.properties?.[draft.property] || [];
    const existing = draft.candidateIndex == null ? null : candidates[draft.candidateIndex];
    // A timed-out write may already be durable. Never add it a second time.
    const confirmed = draft.operation === 'delete' ? !existing : draft.candidateIndex == null
      ? candidates.some(value => String(value.value ?? '') === draft.value && value.status === (draft.status || '採用')
        && String(value.rich_html || '') === String(draft.richHtml || ''))
      : existing && String(existing.value ?? '') === draft.value
        && String(existing.rich_html || '') === String(draft.richHtml || '');
    if (!confirmed) {
      if (draft.candidateIndex != null) {
        if (!existing || String(existing.value ?? '') !== String(draft.before ?? '')
            || String(existing.rich_html || '') !== String(draft.beforeRichHtml || '')) {
          throw new Error('保存済みの値が変更されています。保持した入力をコピーし、最新の値を確認してください');
        }
        await _apiPutValue({ ...existing, entry_path: draft.entryPath, entry_revision: data.revision }, {
          ...(draft.operation === 'delete' ? { _delete: true } : {
            new_value: draft.value, new_rich_html: draft.richHtml || '',
          }), baseRevision: data.revision,
        });
      } else {
        await _apiPostValue(draft.entryPath, draft.property, draft.value, draft.status || '採用', '',
          draft.richHtml || '', { baseRevision: data.revision });
      }
    }
    // 保存中に保存先が切り替わっても、別の保存先の下書きは消さない。
    if (store().identity === identity) {
      clear(draft);
      if (!ctx?.destroyed && typeof selectDatabase === 'function') await selectDatabase(draft.dbPath, ctx, { silent: true });
    }
    return true;
  }
  async function retry(draft, ctx) {
    const identity = owners.get(draft) || store().identity;
    const id = identity + '\n' + key(draft) + '\n' + draft.token;
    if (retries.has(id)) return retries.get(id);
    const pending = saveDraft(draft, ctx, identity);
    retries.set(id, pending);
    try { return await pending; }
    catch (error) {
      // 再保存でも回復しなかった処理を自己記録へ残す（gb-log-export.js）。
      try {
        window.MeldexDiagnostics?.recordSheetIncident?.('retry-failed', {
          op: 'cell-resave', sheet: draft.dbPath,
          status: error?.status || 0, errorType: error?.status ? 'HTTP ' + error.status : String(error?.name || 'Error'),
        });
      } catch {}
      throw error;
    }
    finally { if (retries.get(id) === pending) retries.delete(id); }
  }
  function render(td, entryPath, property, ctx) {
    const pending = drafts(entryPath, property);
    if (!pending.length) return;
    // Render after the caller has finished replacing the committed cell DOM.
    queueMicrotask(() => {
      td.querySelectorAll('.db-cell-unsaved').forEach(element => element.remove());
      let draftIndex = -1;
      for (const draft of drafts(entryPath, property)) {
        draftIndex += 1;
        const panel = document.createElement('div');
        panel.className = 'db-cell-unsaved';
        panel.setAttribute('role', 'status');
        panel.style.cssText = 'padding:4px;border:1px solid var(--warning,#d6a100);white-space:normal;';
        const label = document.createElement('div');
        label.textContent = '未保存の入力';
        const input = document.createElement('textarea');
        input.readOnly = true;
        input.value = draft.value;
        input.setAttribute('aria-label', property + 'の未保存の入力');
        // 目印はセルと失敗の記録ごとに分ける（同じ名前だと、失敗したセルが2つあると部品の検査で重複になる。M-014 不具合45）。
        const idPart = [String(entryPath || '').split('/').pop().replace(/\.md$/, ''), property, draft.candidateIndex ?? 'new', draftIndex]
          .map(part => String(part).replace(/[^\p{L}\p{N}_-]+/gu, '-')).join('-');
        input.dataset.e2eId = `db-cell-unsaved-input-${idPart}`;
        input.style.cssText = 'width:100%;box-sizing:border-box;color:inherit;background:var(--bg);';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '再保存';
        button.dataset.e2eId = `db-cell-unsaved-resave-${idPart}`;
        button.addEventListener('click', async event => {
          event.stopPropagation();
          if (button.disabled) return;
          button.disabled = true;
          try { if (await retry(draft, ctx) === true) panel.remove(); }
          catch (error) { label.textContent = '未保存: ' + (error?.message || error); }
          finally { button.disabled = false; }
        });
        panel.addEventListener('pointerdown', event => event.stopPropagation());
        panel.addEventListener('click', event => event.stopPropagation());
        panel.append(label, input, button);
        td.appendChild(panel);
      }
    });
  }
  // 開いている入力欄（確定前）を覚えておき、画面を閉じる・再読み込みする時に未保存の入力として端末へ退避する
  // （M-014 追加4、2026-11-20。以前は確定前の入力が跡形もなく消えていた）。退避は保存しないので二重保存にならない。
  // 次に開いた時はセルに「未保存の入力」と「再保存」が出る（再保存は保存済みの値と同じなら足さない）。
  const openEditors = new Set();
  function watchEditor(info) {
    if (!info || !info.element || typeof info.read !== 'function') return () => {};
    const record = { ...info };
    openEditors.add(record);
    return () => openEditors.delete(record);
  }
  function stashOpenEditors() {
    for (const record of [...openEditors]) {
      if (!record.element.isConnected) { openEditors.delete(record); continue; }
      let value = '';
      try { value = String(record.read() ?? ''); } catch { continue; }
      if (!value.trim() || value === String(record.before ?? '')) continue;
      keep({ dbPath: record.dbPath, entryPath: record.entryPath, property: record.property,
        candidateIndex: record.candidateIndex ?? null, before: record.before ?? '', value, status: record.status || '採用' });
      openEditors.delete(record);
    }
  }
  window.addEventListener('pagehide', stashOpenEditors);
  window.addEventListener('beforeunload', stashOpenEditors);
  // 失敗と表示した保存が後から送り直されて入った時（gb-app の値の保存）は、そのセルの「未保存の入力」を消して表示を読み直す。
  window.addEventListener('meldex:value-write-replayed', event => {
    try {
      const query = String(event.detail?.path || '').split('?')[1] || '';
      const entryPath = new URLSearchParams(query).get('path') || '';
      const body = event.detail?.body || {};
      const property = String(body.property || body.new_property || '');
      if (!entryPath) return;
      const norm = value => String(value || '').replace(/\\/g, '/');
      for (const draft of drafts(entryPath, property)) {
        if (norm(draft.entryPath) === norm(entryPath) && (!property || draft.property === property)) clear(draft);
      }
      const dbPath = norm(entryPath).split('/').slice(0, -1).join('/');
      // 表示を読み直すのは、そのシートを表で開いているパネルだけ。開いていない時（フォームのファイルから保存した時など）に
      // シートを開くと、画面がシートへ切り替わってフォームが閉じ、未保存の確認が出て止まった（2026-11-21、exe の受け入れ検査）。
      // 読み直しは、送り直しを含む今の保存が終わってから行う（保存の途中の画面を描き直さない）。
      setTimeout(() => {
        const contexts = typeof _dbPaneContextsForPath === 'function' ? (_dbPaneContextsForPath(dbPath) || []) : [];
        if (typeof selectDatabase !== 'function') return;
        contexts.filter(ctx => ctx && norm(ctx.dbPath) === dbPath).forEach(ctx => {
          Promise.resolve(selectDatabase(dbPath, ctx, { silent: true, skipRecent: true, skipNavPush: true, skipSaveLastView: true })).catch(() => {});
        });
      }, 0);
    } catch {}
  });
  window.MeldexSheetCellRecovery = { keep, clear, drafts, render, retry, watchEditor, stashOpenEditors };
  window.addEventListener('storage', event => {
    if (!event.key?.startsWith(PREFIX)) return;
    try {
      const end = event.key.indexOf('\n', PREFIX.length);
      if (end < 0) return;
      const storage = scopes.get(scopeIdentity(JSON.parse(event.key.slice(PREFIX.length, end))));
      if (!storage) return;
      const id = event.key.slice(end + 1);
      if (event.newValue) {
        const row = JSON.parse(event.newValue);
        if (valid(row)) remember(storage, event.key, row);
      } else {
        const names = storage.locations.get(id);
        names?.delete(event.key);
        if (!names?.size) { storage.rows.delete(id); storage.locations.delete(id); }
      }
    } catch {}
  });
})();
