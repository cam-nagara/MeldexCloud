// gb-chat-rules.js — SQLite-backed chat rules editor.
// Rule injection is handled by the backend so the frontend never mutates the system prompt.

(function() {
  'use strict';

  const HEADER_LINE = '## ユーザー定義ルール（ソースフォルダ用の指示の次に優先）';
  const stateByContainer = new WeakMap();

  function crEsc(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function crIcon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function crAuthToken() {
    try {
      if (typeof _authToken !== 'undefined' && _authToken) return _authToken;
    } catch {}
    try {
      const storage = window?.['local' + 'Storage'];
      return storage?.getItem?.('meldex-auth-token') || storage?.getItem?.('crossfolio-auth-token') || '';
    } catch {
      return '';
    }
  }

  function crNormalizePriority(value, fallback = 100) {
    const raw = String(value ?? '').trim();
    const fallbackNumber = Number(fallback);
    const number = raw === '' ? fallbackNumber : Number(raw);
    const safe = Number.isFinite(number) ? number : (Number.isFinite(fallbackNumber) ? fallbackNumber : 100);
    return Math.max(0, Math.min(Math.trunc(safe), 9999));
  }

  async function crApi(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const token = crAuthToken();
    if (token && !headers.Authorization) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(API_BASE + path, { ...opts, headers });
    const text = await res.text();
    let payload = {};
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { detail: text }; }
    }
    if (!res.ok) {
      const detail = payload?.detail?.message || payload?.detail || payload?.error || res.statusText;
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return payload;
  }

  function getState(container) {
    let state = stateByContainer.get(container);
    if (!state) {
      state = { rules: [], selectedId: null, role: 'viewer', roleLoaded: false };
      stateByContainer.set(container, state);
    }
    return state;
  }

  async function ensureRole(container) {
    const state = getState(container);
    if (state.roleLoaded) return state.role;
    try {
      const me = await crApi('/auth/me');
      state.role = me?.role || 'viewer';
    } catch {
      state.role = 'viewer';
    }
    state.roleLoaded = true;
    return state.role;
  }

  function canWrite(container) {
    return getState(container).role === 'owner';
  }

  function ensureCanWrite(container) {
    if (canWrite(container)) return true;
    setAlert(container, '閲覧専用です。チャットルール編集は管理者のみ可能です。', true);
    return false;
  }

  function buildChatRulesPrompt() {
    return '';
  }
  window.buildChatRulesPrompt = buildChatRulesPrompt;

  function renderShell(container) {
    if (!container) return;
    const roleWasLoaded = getState(container).roleLoaded;
    const writable = canWrite(container);
    container.classList.add('chat-rules-view', 'chat-rules-modal');
    container.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-field-row" style="justify-content:space-between;gap:8px;">
          <div>
            <div class="gb-section-title">${crIcon('clipboardList', 14)} チャットルール</div>
            <div class="gb-section-desc">ここで有効なルールはバックエンドでチャットプロンプトに自動注入されます。</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${writable ? `<button type="button" class="gb-btn gb-btn-sm" data-cr-action="add" data-e2e-id="chat-rules-add">${crIcon('plus', 14)} 追加</button>` : ''}
            <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-cr-action="refresh" data-e2e-id="chat-rules-refresh">${crIcon('refreshCw', 14)} 更新</button>
          </div>
        </div>
      </section>
      <div data-cr-alert></div>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-desc">${crEsc(HEADER_LINE)}</div>
        <div data-cr-list class="chat-rules-list"></div>
      </section>
    `;
    if (!roleWasLoaded) {
      ensureRole(container).then(() => {
        if (container.isConnected) renderShell(container);
      });
    }
    container.querySelector('[data-cr-action="add"]')?.addEventListener('click', () => addRule(container));
    container.querySelector('[data-cr-action="refresh"]')?.addEventListener('click', () => loadRules(container));
    loadRules(container);
  }

  function setAlert(container, text, error = false) {
    const alert = container.querySelector('[data-cr-alert]');
    if (!alert) return;
    alert.innerHTML = text ? `<div class="gb-section-desc" style="color:${error ? 'var(--danger)' : 'var(--fg2)'};">${crEsc(text)}</div>` : '';
  }

  async function loadRules(container) {
    const state = getState(container);
    try {
      const payload = await crApi('/chat_rules');
      state.rules = payload.rules || [];
      renderList(container);
      setAlert(container, '');
    } catch (err) {
      setAlert(container, '読み込みに失敗: ' + (err.message || err), true);
    }
  }

  function renderList(container) {
    const state = getState(container);
    const list = container.querySelector('[data-cr-list]');
    if (!list) return;
    if (!state.rules.length) {
      list.innerHTML = '<div class="gb-section-desc">チャットルールはまだありません。</div>';
      return;
    }
    const writable = canWrite(container);
    list.innerHTML = state.rules.map(rule => renderRule(rule, writable)).join('');
    list.querySelectorAll('[data-cr-id]').forEach(row => {
      const id = Number(row.dataset.crId);
      if (writable) {
        row.querySelector('[data-cr-action="toggle"]')?.addEventListener('change', event => {
          updateRule(container, id, { enabled: !!event.target.checked });
        });
        row.querySelector('[data-cr-action="edit"]')?.addEventListener('click', () => editRule(container, id));
        row.querySelector('[data-cr-action="delete"]')?.addEventListener('click', () => deleteRule(container, id));
      }
    });
  }

  function renderRule(rule, writable) {
    const enabled = rule.enabled ? '' : ' opacity:0.55;';
    return `
      <article data-cr-id="${Number(rule.id)}" style="border-bottom:1px solid var(--border);padding:10px 0;${enabled}">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <label class="gb-check" style="margin:0;"><input type="checkbox" data-cr-action="toggle" data-e2e-id="chat-rules-toggle-${Number(rule.id)}" ${rule.enabled ? 'checked' : ''}${writable ? '' : ' disabled'}> 有効</label>
          <span class="gb-pill">${crEsc(rule.scope || 'project')}</span>
          ${rule.pinned ? '<span class="gb-pill">pinned</span>' : ''}
          <strong>${crEsc(rule.title || '無題ルール')}</strong>
          <span class="gb-section-desc">優先度 ${Number(rule.priority || 0)}</span>
        </div>
        <div style="margin-top:6px;line-height:1.5;white-space:pre-wrap;">${crEsc(rule.body || '')}</div>
        ${writable ? `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-cr-action="edit" data-e2e-id="chat-rules-edit-${Number(rule.id)}">編集</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-cr-action="delete" data-e2e-id="chat-rules-delete-${Number(rule.id)}">削除</button>
        </div>` : ''}
      </article>
    `;
  }

  function ruleById(container, id) {
    return getState(container).rules.find(rule => Number(rule.id) === Number(id));
  }

  async function addRule(container) {
    if (!ensureCanWrite(container)) return;
    const title = window.prompt('ルール名', '新しいチャットルール');
    if (title == null) return;
    const body = window.prompt('ルール本文');
    if (!body) return;
    const scopeInput = window.prompt('スコープ: global / project / source_folder / personal / team', 'project');
    if (scopeInput == null) return;
    const scope = scopeInput || 'project';
    try {
      await crApi('/chat_rules', {
        method: 'POST',
        body: JSON.stringify({ title, body, scope, enabled: true, pinned: true, priority: 50 }),
      });
      await loadRules(container);
    } catch (err) {
      setAlert(container, '保存に失敗: ' + (err.message || err), true);
    }
  }

  async function editRule(container, id) {
    if (!ensureCanWrite(container)) return;
    const rule = ruleById(container, id);
    if (!rule) return;
    const title = window.prompt('ルール名', rule.title || '');
    if (title == null) return;
    const body = window.prompt('ルール本文', rule.body || '');
    if (body == null) return;
    const priority = window.prompt('優先度（小さいほど先）', String(rule.priority ?? 100));
    if (priority == null) return;
    const scopeInput = window.prompt('スコープ: global / project / source_folder / personal / team', rule.scope || 'project');
    if (scopeInput == null) return;
    const scope = scopeInput || 'project';
    await updateRule(container, id, { title, body, priority: crNormalizePriority(priority, rule.priority ?? 100), scope });
  }

  async function updateRule(container, id, patch) {
    if (!ensureCanWrite(container)) return;
    try {
      await crApi('/chat_rules/' + encodeURIComponent(id), {
        method: 'PUT',
        body: JSON.stringify(patch || {}),
      });
      await loadRules(container);
    } catch (err) {
      setAlert(container, '保存に失敗: ' + (err.message || err), true);
      renderList(container);
    }
  }

  async function deleteRule(container, id) {
    if (!ensureCanWrite(container)) return;
    const rule = ruleById(container, id);
    const label = rule?.title || '無題ルール';
    const ok = typeof cfConfirm === 'function'
      ? await cfConfirm(`ルール「${label}」を削除しますか？`, { danger: true, okLabel: '削除' })
      : window.confirm(`ルール「${label}」を削除しますか？`);
    if (!ok) return;
    try {
      await crApi('/chat_rules/' + encodeURIComponent(id), { method: 'DELETE' });
      await loadRules(container);
    } catch (err) {
      setAlert(container, '削除に失敗: ' + (err.message || err), true);
    }
  }

  function openChatRulesView(container) {
    renderShell(container);
  }
  window.openChatRulesView = openChatRulesView;

  function showChatRulesDialog() {
    if (typeof openKnowledgeHomeView === 'function') {
      openKnowledgeHomeView('rules');
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal chat-rules-modal" style="width:760px;max-width:92vw;height:560px;max-height:85vh;display:flex;flex-direction:column;">
        <div class="gb-field-row" style="justify-content:space-between;gap:8px;margin-bottom:8px;">
          <h3 style="margin:0;">チャットルール</h3>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-icon" data-cr-close data-e2e-id="chat-rules-dialog-close" aria-label="閉じる" title="閉じる">${crIcon('x', 14)}</button>
        </div>
        <div data-cr-dialog-body style="min-height:0;overflow:auto;flex:1;"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    openChatRulesView(overlay.querySelector('[data-cr-dialog-body]'));
    overlay.querySelector('[data-cr-close]')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', event => {
      if (event.target === overlay) overlay.remove();
    });
  }
  window.showChatRulesDialog = showChatRulesDialog;
})();
