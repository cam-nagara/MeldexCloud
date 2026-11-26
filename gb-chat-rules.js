// gb-chat-rules.js — SQLite-backed chat rules editor.
// Rule injection is handled by the backend so the frontend never mutates the system prompt.

(function() {
  'use strict';

  // HEADER_LINE はバックエンド（meldex_chat_rules_store.py の CHAT_RULES_HEADER）へ
  // 実際に注入される見出し文言と一致させておくための定数
  // （test_chat_rules_dialog_matches_skills_priority_wording が整合を検査する）。
  // UI共通ルール: 基本UIには生のMarkdown見出し記法をそのまま出さないため、
  // 画面表示は簡潔な見出し + ツールチップ（HEADER_TITLE / HEADER_HELP）にする。
  const HEADER_LINE = '## ユーザー定義ルール（ソースフォルダ用の指示の次に優先）';
  const HEADER_TITLE = 'ユーザー定義ルール';
  const HEADER_HELP = 'ソースフォルダに書いた指示の次に優先して適用されます。';
  const HISTORY_SCOPE = 'chat-rules';
  const SCOPES = [
    ['project', 'プロジェクト'],
    ['source_folder', 'ソースフォルダ'],
    ['global', '全体'],
    ['personal', '個人'],
    ['team', 'チーム'],
  ];
  const stateByContainer = new WeakMap();
  let previousHistoryScope = null;

  function crEsc(value) {
    return MeldexEscape.html(value);
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
      state = { rules: [], role: 'viewer', roleLoaded: false, editing: null, busy: false };
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
          <div class="gb-section-title">${crIcon('clipboardList', 14)} チャットルール ${fieldHelp('有効なルールはチャットに自動で反映されます。', { e2eId: 'chat-rules-help' })}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${writable ? `<button type="button" class="gb-btn gb-btn-sm" data-cr-action="add" data-e2e-id="chat-rules-add">${crIcon('plus', 14)} 追加</button>` : ''}
            <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-cr-action="refresh" data-e2e-id="chat-rules-refresh">${crIcon('refreshCw', 14)} 更新</button>
          </div>
        </div>
        <div data-cr-alert role="status"></div>
        <div class="gb-section-desc">${crEsc(HEADER_TITLE)} ${fieldHelp(HEADER_HELP, { e2eId: 'chat-rules-priority-help' })}</div>
        <div data-cr-editor-host></div>
        <div data-cr-list class="chat-rules-list"></div>
      </section>
    `;
    if (!roleWasLoaded) {
      ensureRole(container).then(() => {
        if (container.isConnected) renderShell(container);
      });
    }
    bindHistoryKeys(container);
    container.querySelector('[data-cr-action="add"]')?.addEventListener('click', () => addRule(container));
    container.querySelector('[data-cr-action="refresh"]')?.addEventListener('click', () => loadRules(container));
    loadRules(container);
  }

  // ナレッジ画面（ダイアログ）表示中は共通ショートカットが止まるため、ルール画面自身で
  // Ctrl+Z / Ctrl+Y（Ctrl+Shift+Z）を受ける。入力欄の中では文字入力の取り消しに任せる。
  function bindHistoryKeys(container) {
    if (container.dataset.crHistoryKeys === '1') return;
    container.dataset.crHistoryKeys = '1';
    container.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = String(event.key || '').toLowerCase();
      const redo = key === 'y' || (key === 'z' && event.shiftKey);
      const undo = key === 'z' && !event.shiftKey;
      if (!undo && !redo) return;
      const target = event.target;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (undo && typeof historyUndo === 'function') historyUndo(HISTORY_SCOPE);
      if (redo && typeof historyRedo === 'function') historyRedo(HISTORY_SCOPE);
    });
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
      return true;
    } catch (err) {
      setAlert(container, '読み込みに失敗: ' + (err.message || err), true);
      return false;
    }
  }

  function renderList(container) {
    const state = getState(container);
    renderEditor(container);
    const list = container.querySelector('[data-cr-list]');
    if (!list) return;
    if (!state.rules.length) {
      list.innerHTML = '<div class="gb-section-desc">チャットルールはまだありません。</div>';
      return;
    }
    const writable = canWrite(container);
    list.innerHTML = state.rules.map(rule => renderRule(rule, writable, state.editing)).join('');
    list.querySelectorAll('[data-cr-id]').forEach(row => {
      const id = Number(row.dataset.crId);
      if (writable) {
        row.querySelector('[data-cr-action="toggle"]')?.addEventListener('change', event => {
          toggleRule(container, id, !!event.target.checked);
        });
        row.querySelector('[data-cr-action="edit"]')?.addEventListener('click', () => editRule(container, id));
        row.querySelector('[data-cr-action="delete"]')?.addEventListener('click', () => deleteRule(container, id));
      }
    });
    const editingRow = state.editing && state.editing.id !== 'new'
      ? list.querySelector(`[data-cr-id="${Number(state.editing.id)}"] [data-cr-row-editor]`) : null;
    if (editingRow) mountForm(container, editingRow);
  }

  function renderRule(rule, writable, editing) {
    const enabled = rule.enabled ? '' : ' opacity:0.55;';
    const id = Number(rule.id);
    const isEditing = editing && editing.id === id;
    return `
      <article data-cr-id="${id}" style="border-bottom:1px solid var(--border);padding:10px 0;${enabled}">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <label class="gb-check" style="margin:0;"><input type="checkbox" data-cr-action="toggle" data-e2e-id="chat-rules-toggle-${id}" ${rule.enabled ? 'checked' : ''}${writable ? '' : ' disabled'}> 有効</label>
          <span class="gb-pill">${crEsc(scopeLabel(rule.scope))}</span>
          ${rule.pinned ? '<span class="gb-pill">pinned</span>' : ''}
          <strong>${crEsc(rule.title || '無題ルール')}</strong>
          <span class="gb-section-desc">優先度 ${Number(rule.priority || 0)}</span>
        </div>
        ${isEditing ? '<div data-cr-row-editor></div>' : `<div style="margin-top:6px;line-height:1.5;white-space:pre-wrap;">${crEsc(rule.body || '')}</div>`}
        ${writable && !isEditing ? `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-cr-action="edit" data-e2e-id="chat-rules-edit-${id}">編集</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-cr-action="delete" data-e2e-id="chat-rules-delete-${id}">削除</button>
        </div>` : ''}
      </article>
    `;
  }

  function scopeLabel(scope) {
    return (SCOPES.find(([value]) => value === scope) || [scope, scope || 'プロジェクト'])[1];
  }

  function renderEditor(container) {
    const host = container.querySelector('[data-cr-editor-host]');
    if (!host) return;
    const state = getState(container);
    host.innerHTML = '';
    if (state.editing?.id === 'new') mountForm(container, host);
  }

  // 追加・編集は画面内のフォームで行う（追加時にダイアログを出さない原則）。
  // 保存に失敗しても入力は保持し、もう一度「保存」を押せば再試行できる。
  function mountForm(container, host) {
    const state = getState(container);
    const editing = state.editing;
    if (!editing) return;
    const draft = editing.draft;
    const form = document.createElement('form');
    form.className = 'chat-rules-form';
    form.dataset.crForm = String(editing.id);
    form.innerHTML = `
      <label class="gb-field-label">ルール名
        <input type="text" class="gb-input" data-cr-field="title" data-e2e-id="chat-rules-form-title" maxlength="160">
      </label>
      <label class="gb-field-label">本文
        <textarea class="gb-input" data-cr-field="body" data-e2e-id="chat-rules-form-body" rows="4" maxlength="4000"></textarea>
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <label class="gb-field-label">優先度（小さいほど先）
          <input type="number" class="gb-input" data-cr-field="priority" data-e2e-id="chat-rules-form-priority" min="0" max="9999" step="1">
        </label>
        <label class="gb-field-label">適用範囲
          <select class="gb-input" data-cr-field="scope" data-e2e-id="chat-rules-form-scope">
            ${SCOPES.map(([value, label]) => `<option value="${crEsc(value)}">${crEsc(label)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
        <button type="submit" class="gb-btn gb-btn-sm" data-cr-action="save-edit" data-e2e-id="chat-rules-form-save">保存</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-cr-action="cancel-edit" data-e2e-id="chat-rules-form-cancel">キャンセル</button>
      </div>
    `;
    const field = name => form.querySelector(`[data-cr-field="${name}"]`);
    field('title').value = draft.title || '';
    field('body').value = draft.body || '';
    field('priority').value = String(draft.priority ?? 100);
    if (!SCOPES.some(([value]) => value === draft.scope)) {
      const option = document.createElement('option');
      option.value = draft.scope;
      option.textContent = draft.scope;
      field('scope').appendChild(option);
    }
    field('scope').value = draft.scope || 'project';
    form.addEventListener('input', () => {
      draft.title = field('title').value;
      draft.body = field('body').value;
      draft.priority = field('priority').value;
      draft.scope = field('scope').value;
    });
    form.addEventListener('change', () => form.dispatchEvent(new Event('input')));
    form.addEventListener('submit', event => {
      event.preventDefault();
      saveEdit(container);
    });
    form.querySelector('[data-cr-action="cancel-edit"]').addEventListener('click', () => cancelEdit(container));
    form._crCancel = () => cancelEdit(container);
    host.appendChild(form);
    requestAnimationFrame(() => {
      const target = editing.id === 'new' ? field('body') : field('title');
      if (form.isConnected && !form.contains(document.activeElement)) target.focus({ preventScroll: true });
    });
  }

  function ruleById(container, id) {
    return getState(container).rules.find(rule => Number(rule.id) === Number(id));
  }

  function ruleFields(rule) {
    return {
      title: String(rule?.title || ''),
      body: String(rule?.body || ''),
      priority: crNormalizePriority(rule?.priority, 100),
      scope: String(rule?.scope || 'project'),
    };
  }

  function addRule(container) {
    if (!ensureCanWrite(container)) return;
    const state = getState(container);
    if (state.editing?.id === 'new') {
      container.querySelector('[data-cr-form="new"] [data-cr-field="body"]')?.focus();
      return;
    }
    state.editing = { id: 'new', draft: { title: '新しいチャットルール', body: '', priority: 50, scope: 'project' } };
    setAlert(container, '');
    renderList(container);
  }

  function editRule(container, id) {
    if (!ensureCanWrite(container)) return;
    const rule = ruleById(container, id);
    if (!rule) return;
    getState(container).editing = { id: Number(id), draft: ruleFields(rule) };
    setAlert(container, '');
    renderList(container);
  }

  function cancelEdit(container) {
    getState(container).editing = null;
    setAlert(container, '');
    renderList(container);
  }

  function historyScope() {
    return HISTORY_SCOPE;
  }

  function pushHistory(label, undo, redo, detail) {
    if (typeof historyPush !== 'function') return;
    if (typeof historySetScope === 'function' && typeof _historyActiveScope !== 'undefined' && _historyActiveScope !== HISTORY_SCOPE) {
      if (previousHistoryScope === null) previousHistoryScope = _historyActiveScope || '';
      historySetScope(HISTORY_SCOPE);
    }
    historyPush('チャットルール: ' + label, undo, redo, historyScope(), detail || '');
  }

  // 履歴から戻す時は、その時点で開いている一覧へ反映する（閉じていれば保存だけ行う）。
  // ナレッジ画面は権限の読込などで描き直されるため、操作時の一覧ではなく表示中の一覧を探す。
  function liveContainer(container) {
    if (container?.isConnected) return container;
    return Array.from(document.querySelectorAll('.chat-rules-view')).find(el => el.isConnected && el.getClientRects().length) || null;
  }

  async function applyFromHistory(container, path, opts, failureLabel) {
    try {
      await crApi(path, opts);
    } catch (err) {
      const live = liveContainer(container);
      if (live) setAlert(live, failureLabel + 'に失敗: ' + (err.message || err), true);
      if (typeof showStatus === 'function') showStatus('チャットルールの' + failureLabel + 'に失敗: ' + (err.message || err), true);
      throw err;
    }
    const live = liveContainer(container);
    if (live) await loadRules(live);
    return true;
  }

  async function saveEdit(container) {
    if (!ensureCanWrite(container)) return false;
    const state = getState(container);
    const editing = state.editing;
    if (!editing || state.busy) return false;
    const draft = editing.draft;
    const fields = {
      title: String(draft.title || '').trim(),
      body: String(draft.body || '').trim(),
      priority: crNormalizePriority(draft.priority, 100),
      scope: String(draft.scope || 'project'),
    };
    if (!fields.body) {
      setAlert(container, '本文を入力してください。', true);
      container.querySelector('[data-cr-field="body"]')?.focus();
      return false;
    }
    state.busy = true;
    const saveButton = container.querySelector('[data-cr-action="save-edit"]');
    if (saveButton) saveButton.disabled = true;
    try {
      if (editing.id === 'new') {
        const payload = await crApi('/chat_rules', {
          method: 'POST',
          body: JSON.stringify({ ...fields, enabled: true, pinned: true }),
        });
        const id = Number(payload?.rule?.id);
        state.editing = null;
        await loadRules(container);
        if (Number.isFinite(id)) {
          pushHistory('追加',
            () => applyFromHistory(container, '/chat_rules/' + encodeURIComponent(id), { method: 'DELETE' }, '追加の取り消し'),
            () => applyFromHistory(container, '/chat_rules/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ deleted: false }) }, '追加のやり直し'),
            fields.title);
        }
      } else {
        const id = editing.id;
        const before = ruleFields(ruleById(container, id));
        await crApi('/chat_rules/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(fields) });
        state.editing = null;
        await loadRules(container);
        pushHistory('編集',
          () => applyFromHistory(container, '/chat_rules/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(before) }, '編集の取り消し'),
          () => applyFromHistory(container, '/chat_rules/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(fields) }, '編集のやり直し'),
          fields.title);
      }
      return true;
    } catch (err) {
      setAlert(container, '保存に失敗: ' + (err.message || err), true);
      return false;
    } finally {
      state.busy = false;
      const button = container.querySelector('[data-cr-action="save-edit"]');
      if (button) button.disabled = false;
    }
  }

  async function toggleRule(container, id, enabled) {
    if (!ensureCanWrite(container)) return;
    const path = '/chat_rules/' + encodeURIComponent(id);
    try {
      await crApi(path, { method: 'PUT', body: JSON.stringify({ enabled }) });
      await loadRules(container);
      pushHistory(enabled ? '有効化' : '無効化',
        () => applyFromHistory(container, path, { method: 'PUT', body: JSON.stringify({ enabled: !enabled }) }, '切り替えの取り消し'),
        () => applyFromHistory(container, path, { method: 'PUT', body: JSON.stringify({ enabled }) }, '切り替えのやり直し'),
        ruleById(container, id)?.title || '');
    } catch (err) {
      setAlert(container, '保存に失敗: ' + (err.message || err), true);
      renderList(container);
    }
  }

  // 削除は取り消し・やり直し・共通履歴で戻せるため確認を出さない。
  async function deleteRule(container, id) {
    if (!ensureCanWrite(container)) return;
    const rule = ruleById(container, id);
    const label = rule?.title || '無題ルール';
    const path = '/chat_rules/' + encodeURIComponent(id);
    try {
      await crApi(path, { method: 'DELETE' });
      await loadRules(container);
      pushHistory('削除',
        () => applyFromHistory(container, path, { method: 'PUT', body: JSON.stringify({ deleted: false }) }, '削除の取り消し'),
        () => applyFromHistory(container, path, { method: 'DELETE' }, '削除のやり直し'),
        label);
      if (typeof showStatus === 'function') showStatus(`ルール「${label}」を削除しました`);
    } catch (err) {
      setAlert(container, '削除に失敗: ' + (err.message || err), true);
    }
  }

  // ナレッジ画面を閉じた時、ルール操作で切り替えた取り消し対象を元の画面へ戻す。
  function releaseHistoryScope() {
    if (previousHistoryScope === null) return;
    const scope = previousHistoryScope;
    previousHistoryScope = null;
    if (typeof historySetScope === 'function' && typeof _historyActiveScope !== 'undefined' && _historyActiveScope === HISTORY_SCOPE) {
      historySetScope(scope);
    }
  }

  // 編集中のEscはフォームだけを閉じる。共通ダイアログはdocumentの捕捉段階でEscを受けて
  // 画面ごと閉じるため、それより先（windowの捕捉段階）で処理する。
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing) return;
    const form = document.activeElement?.closest?.('[data-cr-form]');
    if (!form || typeof form._crCancel !== 'function') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    form._crCancel();
  }, true);

  function openChatRulesView(container) {
    renderShell(container);
  }
  window.openChatRulesView = openChatRulesView;
  window.GBChatRules = Object.freeze({ releaseHistoryScope, historyScope });

  function showChatRulesDialog() {
    if (typeof openKnowledgeHomeView !== 'function') {
      throw new Error('ナレッジを初期化できませんでした。');
    }
    return openKnowledgeHomeView('rules');
  }
  window.showChatRulesDialog = showChatRulesDialog;
})();
