(function () {
  const originalStatusPoliciesView = window.openStatusPoliciesView;
  const stateByContainer = new WeakMap();

  function kvEsc(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function kvIcon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function kvAuthToken() {
    try {
      if (typeof _authToken !== 'undefined' && _authToken) return _authToken;
    } catch {}
    try {
      return localStorage.getItem('meldex-auth-token') || localStorage.getItem('crossfolio-auth-token') || '';
    } catch {
      return '';
    }
  }

  async function kvApi(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const token = kvAuthToken();
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
      state = { activeTab: 'overview', items: [], summary: null, query: '', type: '', includeSuperseded: false, role: 'viewer', roleLoaded: false };
      stateByContainer.set(container, state);
    }
    return state;
  }

  async function ensureRole(container) {
    const state = getState(container);
    if (state.roleLoaded) return state.role;
    try {
      const me = await kvApi('/auth/me');
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
    setAlert(container, '閲覧専用です。ナレッジ編集は管理者のみ可能です。', true);
    return false;
  }

  function renderShell(container) {
    const state = getState(container);
    container.classList.add('knowledge-layer-view');
    container.innerHTML = `
      <div class="gb-inner-tabs kv-tabs">
        <button type="button" class="gb-inner-tab ${state.activeTab === 'overview' ? 'gb-inner-tab-active active' : ''}" data-kv-tab="overview" data-e2e-id="settings-knowledge-tab-overview">${kvIcon('layoutDashboard', 14)} 概要</button>
        <button type="button" class="gb-inner-tab ${state.activeTab === 'items' ? 'gb-inner-tab-active active' : ''}" data-kv-tab="items" data-e2e-id="settings-knowledge-tab-items">${kvIcon('brain', 14)} 記憶継承</button>
        <button type="button" class="gb-inner-tab ${state.activeTab === 'taste' ? 'gb-inner-tab-active active' : ''}" data-kv-tab="taste" data-e2e-id="settings-knowledge-tab-taste">${kvIcon('sparkles', 14)} 感性原則</button>
        <button type="button" class="gb-inner-tab ${state.activeTab === 'rules' ? 'gb-inner-tab-active active' : ''}" data-kv-tab="rules" data-e2e-id="settings-knowledge-tab-rules">${kvIcon('clipboardList', 14)} チャットルール</button>
        <button type="button" class="gb-inner-tab ${state.activeTab === 'policies' ? 'gb-inner-tab-active active' : ''}" data-kv-tab="policies" data-e2e-id="settings-knowledge-tab-policies">${kvIcon('shieldCheck', 14)} ステータス別ポリシー</button>
      </div>
      <div data-kv-panel="overview"></div>
      <div data-kv-panel="items"></div>
      <div data-kv-panel="taste" hidden></div>
      <div data-kv-panel="rules" hidden></div>
      <div data-kv-panel="policies" hidden></div>
    `;
    container.querySelectorAll('[data-kv-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(container, btn.dataset.kvTab));
    });
    ensureRole(container).then(() => {
      if (container.isConnected) renderActiveTab(container);
    });
    renderActiveTab(container);
  }

  function switchTab(container, tab) {
    const state = getState(container);
    state.activeTab = tab || 'overview';
    renderShell(container);
  }

  function renderActiveTab(container) {
    const state = getState(container);
    const overviewPanel = container.querySelector('[data-kv-panel="overview"]');
    const itemsPanel = container.querySelector('[data-kv-panel="items"]');
    const tastePanel = container.querySelector('[data-kv-panel="taste"]');
    const rulesPanel = container.querySelector('[data-kv-panel="rules"]');
    const policiesPanel = container.querySelector('[data-kv-panel="policies"]');
    if (overviewPanel) overviewPanel.hidden = state.activeTab !== 'overview';
    if (itemsPanel) itemsPanel.hidden = state.activeTab !== 'items';
    if (tastePanel) tastePanel.hidden = state.activeTab !== 'taste';
    if (rulesPanel) rulesPanel.hidden = state.activeTab !== 'rules';
    if (policiesPanel) policiesPanel.hidden = state.activeTab !== 'policies';
    if (state.activeTab === 'overview') {
      renderOverviewPanel(container);
      loadSummary(container);
      return;
    }
    if (state.activeTab === 'taste') {
      if (tastePanel && typeof window.openTastePrinciplesView === 'function') window.openTastePrinciplesView(tastePanel);
      return;
    }
    if (state.activeTab === 'rules') {
      if (rulesPanel && typeof window.openChatRulesView === 'function') window.openChatRulesView(rulesPanel);
      return;
    }
    if (state.activeTab === 'policies') {
      if (policiesPanel && typeof originalStatusPoliciesView === 'function') originalStatusPoliciesView(policiesPanel);
      return;
    }
    renderItemsPanel(container);
    loadItems(container);
  }

  function renderOverviewPanel(container) {
    const panel = container.querySelector('[data-kv-panel="overview"]');
    if (!panel) return;
    panel.innerHTML = `
      <section class="gb-section gb-section--boxed kv-header">
        <div>
          <div class="gb-section-title">${kvIcon('layoutDashboard', 14)} ナレッジ概要</div>
          <div class="gb-section-desc">記憶継承の件数、チャット注入で使われた項目、自動抽出ログ、未解決の競合を確認します。</div>
        </div>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-kv-action="summary-refresh" data-e2e-id="settings-knowledge-summary-refresh">${kvIcon('refreshCw', 14)} 更新</button>
      </section>
      <div data-kv-summary-alert></div>
      <div data-kv-summary-body class="kv-summary-body">
        <section class="gb-section gb-section--boxed"><div class="gb-section-desc">読み込み中...</div></section>
      </div>
    `;
    panel.querySelector('[data-kv-action="summary-refresh"]')?.addEventListener('click', () => loadSummary(container));
  }

  function setSummaryAlert(container, text, error = false) {
    const alert = container.querySelector('[data-kv-summary-alert]');
    if (!alert) return;
    alert.innerHTML = text ? `<div class="gb-section-desc" style="color:${error ? 'var(--danger)' : 'var(--fg2)'};">${kvEsc(text)}</div>` : '';
  }

  async function loadSummary(container) {
    const state = getState(container);
    try {
      state.summary = await kvApi('/knowledge/summary');
      renderSummary(container);
      setSummaryAlert(container, '');
    } catch (err) {
      setSummaryAlert(container, '概要の読み込みに失敗: ' + (err.message || err), true);
    }
  }

  function _countListHtml(items, keyName) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return '<div class="gb-section-desc">まだありません。</div>';
    return list.map(item => `
      <div class="kv-summary-row" style="display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border);padding:5px 0;">
        <span>${kvEsc(item[keyName] || '(未設定)')}</span>
        <strong>${Number(item.count || 0)}</strong>
      </div>
    `).join('');
  }

  function renderSummary(container) {
    const state = getState(container);
    const summary = state.summary || {};
    const body = container.querySelector('[data-kv-summary-body]');
    if (!body) return;
    const recentUsage = Array.isArray(summary.recent_usage) ? summary.recent_usage : [];
    const recentRuns = Array.isArray(summary.recent_extraction_runs) ? summary.recent_extraction_runs : [];
    const conflicts = Array.isArray(summary.open_conflicts) ? summary.open_conflicts : [];
    body.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${kvIcon('database', 14)} 件数</div>
        <div class="gb-section-desc">合計 ${Number(summary.total || 0)} 件</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:8px;">
          <div>${_countListHtml(summary.type_counts, 'type')}</div>
          <div>${_countListHtml(summary.status_counts, 'source_status')}</div>
        </div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${kvIcon('activity', 14)} 最近チャットに使われた記憶</div>
        ${recentUsage.length ? recentUsage.map(item => `
          <article class="kv-item" style="border-bottom:1px solid var(--border);padding:8px 0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="gb-pill">${kvEsc(item.type)}</span>
              <strong>${kvEsc(item.subject)}</strong>
              <span class="gb-section-desc">使用 ${Number(item.use_count || 0)} 回</span>
              <span class="gb-section-desc">${kvEsc(item.last_used || '')}</span>
            </div>
            <div style="margin-top:4px;">${kvEsc(item.statement)}</div>
          </article>
        `).join('') : '<div class="gb-section-desc">まだチャット注入・検索で使われた記録はありません。</div>'}
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${kvIcon('listChecks', 14)} 自動抽出ログ</div>
        ${recentRuns.length ? recentRuns.map(run => `
          <div style="border-bottom:1px solid var(--border);padding:7px 0;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <span class="gb-pill">${kvEsc(run.status || '')}</span>
              <strong>${kvEsc(run.source_chat_path || '')}</strong>
              <span class="gb-section-desc">${Number(run.item_count || 0)} 件</span>
              <span class="gb-section-desc">${kvEsc(run.updated || run.created || '')}</span>
            </div>
            ${run.error ? `<div class="gb-section-desc" style="color:var(--danger);">${kvEsc(run.error)}</div>` : ''}
          </div>
        `).join('') : '<div class="gb-section-desc">自動抽出ログはまだありません。</div>'}
      </section>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${kvIcon('triangleAlert', 14)} 競合と訂正</div>
        ${conflicts.length ? conflicts.map(item => `
          <div style="border-bottom:1px solid var(--border);padding:7px 0;">
            <strong>#${Number(item.id || 0)}</strong>
            <span>${kvEsc(item.conflicting_statement || '')}</span>
            <div class="gb-section-desc">${kvEsc(item.detected_at || '')}</div>
          </div>
        `).join('') : '<div class="gb-section-desc">未解決の競合はありません。</div>'}
      </section>
    `;
  }

  function renderItemsPanel(container) {
    const state = getState(container);
    const panel = container.querySelector('[data-kv-panel="items"]');
    if (!panel) return;
    const writable = canWrite(container);
    panel.innerHTML = `
      <section class="gb-section gb-section--boxed kv-header">
        <div>
          <div class="gb-section-title">${kvIcon('brain', 14)} 記憶継承</div>
          <div class="gb-section-desc">チャットから抽出された決定・事実・好みを、新しいLLMチャットへ自動継承します。</div>
        </div>
        ${writable ? `<button type="button" class="gb-btn gb-btn-sm" data-kv-action="add" data-e2e-id="settings-knowledge-add">${kvIcon('plus', 14)} 手動追加</button>` : ''}
      </section>
      <section class="gb-section gb-section--boxed kv-toolbar">
        <input class="gb-input" data-kv-query data-e2e-id="settings-knowledge-query" aria-label="記憶継承を検索" placeholder="検索" value="${kvEsc(state.query)}">
        <select class="gb-select" data-kv-type data-e2e-id="settings-knowledge-type" aria-label="記憶継承の種類">
          ${['', 'fact', 'decision', 'preference', 'correction', 'team_consensus'].map(type => `<option value="${type}" ${state.type === type ? 'selected' : ''}>${type || 'すべて'}</option>`).join('')}
        </select>
        <label class="gb-check"><input type="checkbox" data-kv-superseded data-e2e-id="settings-knowledge-include-superseded" aria-label="訂正済みの記憶項目も表示" ${state.includeSuperseded ? 'checked' : ''}> 訂正済みも表示</label>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-kv-action="refresh" data-e2e-id="settings-knowledge-refresh">${kvIcon('refreshCw', 14)} 更新</button>
      </section>
      <div data-kv-alert></div>
      <section class="gb-section gb-section--boxed">
        <div data-kv-list class="kv-list"><div class="gb-section-desc">読み込み中...</div></div>
      </section>
    `;
    panel.querySelector('[data-kv-query]')?.addEventListener('input', event => {
      state.query = event.target.value;
      clearTimeout(state.queryTimer);
      state.queryTimer = setTimeout(() => loadItems(container), 250);
    });
    panel.querySelector('[data-kv-type]')?.addEventListener('change', event => {
      state.type = event.target.value;
      loadItems(container);
    });
    panel.querySelector('[data-kv-superseded]')?.addEventListener('change', event => {
      state.includeSuperseded = !!event.target.checked;
      loadItems(container);
    });
    panel.querySelector('[data-kv-action="refresh"]')?.addEventListener('click', () => loadItems(container));
    panel.querySelector('[data-kv-action="add"]')?.addEventListener('click', () => showManualAdd(container));
  }

  function setAlert(container, text, error = false) {
    const alert = container.querySelector('[data-kv-alert]');
    if (!alert) return;
    alert.innerHTML = text ? `<div class="gb-section-desc" style="color:${error ? 'var(--danger)' : 'var(--fg2)'};">${kvEsc(text)}</div>` : '';
  }

  async function loadItems(container) {
    const state = getState(container);
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.type) params.set('type', state.type);
    if (state.includeSuperseded) params.set('include_superseded', 'true');
    try {
      const payload = await kvApi('/knowledge_items' + (params.toString() ? '?' + params.toString() : ''));
      state.items = payload.items || [];
      renderList(container);
      setAlert(container, '');
    } catch (err) {
      setAlert(container, '読み込みに失敗: ' + (err.message || err), true);
    }
  }

  function renderList(container) {
    const state = getState(container);
    const list = container.querySelector('[data-kv-list]');
    if (!list) return;
    if (!state.items.length) {
      list.innerHTML = '<div class="gb-section-desc">記憶項目はまだありません。</div>';
      return;
    }
    const writable = canWrite(container);
    list.innerHTML = state.items.map(item => renderItem(item, writable)).join('');
    list.querySelectorAll('[data-kv-id]').forEach(row => {
      const id = Number(row.dataset.kvId);
      if (writable) {
        row.querySelector('[data-kv-action="pin"]')?.addEventListener('click', () => togglePin(container, id));
        row.querySelector('[data-kv-action="edit"]')?.addEventListener('click', () => editItem(container, id));
        row.querySelector('[data-kv-action="delete"]')?.addEventListener('click', () => deleteItem(container, id));
      }
      row.querySelector('[data-kv-action="chat"]')?.addEventListener('click', () => openSourceChat(container, id));
    });
  }

  function renderItem(item, writable) {
    const status = item.source_status || '(未設定)';
    const superseded = item.superseded_by ? '<span class="gb-pill">訂正済み</span>' : '';
    return `
      <article class="kv-item" data-kv-id="${Number(item.id)}" style="border-bottom:1px solid var(--border);padding:10px 0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="gb-pill">${kvEsc(item.type)}</span>
          <strong>${kvEsc(item.subject)}</strong>
          <span class="gb-pill">${kvEsc(status)}</span>
          ${item.is_canonical ? '<span class="gb-pill">確定済み</span>' : ''}
          ${item.pinned ? '<span class="gb-pill">pinned</span>' : ''}
          ${superseded}
        </div>
        <div style="margin-top:6px;line-height:1.5;">${kvEsc(item.statement)}</div>
        ${item.reasoning ? `<div class="gb-section-desc" style="margin-top:4px;">理由: ${kvEsc(item.reasoning)}</div>` : ''}
        <div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap;">
          <span class="gb-section-desc">信頼度 ${Number(item.confidence || 0).toFixed(2)}</span>
          ${writable ? `<button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-kv-action="pin">${item.pinned ? 'unpin' : 'pin'}</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-kv-action="edit">編集</button>` : ''}
          ${item.source_chat_path ? '<button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-kv-action="chat">元チャット</button>' : ''}
          ${writable ? '<button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-kv-action="delete">削除</button>' : ''}
        </div>
      </article>
    `;
  }

  function itemById(container, id) {
    return getState(container).items.find(item => Number(item.id) === Number(id));
  }

  async function togglePin(container, id) {
    if (!ensureCanWrite(container)) return;
    const item = itemById(container, id);
    if (!item) return;
    await kvApi('/knowledge_items/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify({ pinned: !item.pinned }),
    });
    loadItems(container);
  }

  async function editItem(container, id) {
    if (!ensureCanWrite(container)) return;
    const item = itemById(container, id);
    if (!item) return;
    const rawStatement = window.prompt('記憶内容を編集', item.statement || '');
    if (rawStatement == null) return;
    const statement = String(rawStatement || '').trim();
    if (!statement) {
      setAlert(container, '記憶内容を空にはできません。', true);
      return;
    }
    await kvApi('/knowledge_items/' + encodeURIComponent(id), {
      method: 'PUT',
      body: JSON.stringify({ statement }),
    });
    loadItems(container);
  }

  async function deleteItem(container, id) {
    if (!ensureCanWrite(container)) return;
    const ok = typeof cfConfirm === 'function'
      ? await cfConfirm('この記憶項目を削除しますか？')
      : window.confirm('この記憶項目を削除しますか？');
    if (!ok) return;
    await kvApi('/knowledge_items/' + encodeURIComponent(id), { method: 'DELETE' });
    loadItems(container);
  }

  function openSourceChat(container, id) {
    const item = itemById(container, id);
    if (item?.source_chat_path && typeof openSavedChat === 'function') {
      openSavedChat(item.source_chat_path, item.source_msg_id || '', item.source_folder || undefined);
    }
  }

  async function showManualAdd(container) {
    if (!ensureCanWrite(container)) return;
    const rawStatement = window.prompt('新しい記憶内容');
    if (rawStatement == null) return;
    const statement = String(rawStatement || '').trim();
    if (!statement) return;
    const rawSubject = window.prompt('主語・対象', statement.slice(0, 40));
    if (rawSubject == null) return;
    const subject = String(rawSubject || '').trim() || statement.slice(0, 40);
    await kvApi('/knowledge_items', {
      method: 'POST',
      body: JSON.stringify({ type: 'decision', subject, statement, pinned: true, confidence: 1 }),
    });
    loadItems(container);
  }

  function openKnowledgeLayerView(container, initialTab) {
    if (!container) return;
    if (initialTab) getState(container).activeTab = initialTab;
    renderShell(container);
  }

  function openKnowledgeHomeView(initialTab) {
    document.querySelectorAll('.modal-overlay[data-knowledge-home-modal="1"]').forEach(el => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.knowledgeHomeModal = '1';
    overlay.innerHTML = `
      <div class="modal knowledge-home-modal" style="width:920px;max-width:94vw;height:720px;max-height:88vh;display:flex;flex-direction:column;">
        <div class="gb-field-row" style="justify-content:space-between;gap:8px;margin-bottom:8px;">
          <h3 style="margin:0;">${kvIcon('brain', 16)} ナレッジ</h3>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="knowledge-home-close" data-kv-modal-close aria-label="閉じる">${kvIcon('x', 14)}</button>
        </div>
        <div data-kv-home-body style="min-height:0;overflow:auto;flex:1;"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const body = overlay.querySelector('[data-kv-home-body]');
    openKnowledgeLayerView(body, initialTab || 'overview');
    overlay.querySelector('[data-kv-modal-close]')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', event => {
      if (event.target === overlay) overlay.remove();
    });
  }

  window.openKnowledgeLayerView = openKnowledgeLayerView;
  window.openKnowledgeHomeView = openKnowledgeHomeView;
})();
