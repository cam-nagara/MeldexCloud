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
    finally { if (retries.get(id) === pending) retries.delete(id); }
  }
  function render(td, entryPath, property, ctx) {
    const pending = drafts(entryPath, property);
    if (!pending.length) return;
    // Render after the caller has finished replacing the committed cell DOM.
    queueMicrotask(() => {
      td.querySelectorAll('.db-cell-unsaved').forEach(element => element.remove());
      for (const draft of drafts(entryPath, property)) {
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
        input.style.cssText = 'width:100%;box-sizing:border-box;color:inherit;background:var(--bg);';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '再保存';
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
  window.MeldexSheetCellRecovery = { keep, clear, drafts, render, retry };
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
