(function () {
  const state = { status: 'new', items: [], busy: false, includeTasteFiltered: false, loadToken: 0, updatingIds: new Set() };

  function ideaEsc(value) {
    if (typeof esc === 'function') return esc(value);
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function ideaIcon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  async function ideaApi(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (typeof getUsername === 'function') {
      const user = getUsername();
      if (user && user !== 'anonymous') {
        path += (path.includes('?') ? '&' : '?') + '_user=' + encodeURIComponent(user);
      }
    }
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

  function ensureModal() {
    let overlay = document.querySelector('.modal-overlay[data-idea-inbox="1"]');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.dataset.ideaInbox = '1';
    overlay.innerHTML = `
      <div class="modal" style="width:min(820px,92vw);height:min(720px,88vh);">
        <h3 style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
          ${ideaIcon('lightbulb', 16)} <span>アイディアインボックス</span>
          <button type="button" class="settings-modal-close" data-idea-close title="閉じる" aria-label="閉じる" style="margin-left:auto;">${ideaIcon('x', 16)}</button>
        </h3>
        <div data-idea-root style="overflow:auto;flex:1;"></div>
      </div>
    `;
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest('[data-idea-close]')) overlay.remove();
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function renderRoot(root) {
    root.innerHTML = `
      <section class="gb-section gb-section--boxed" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="flex:1;min-width:220px;">
          <div class="gb-section-title">${ideaIcon('sparkles', 14)} 今日の連想</div>
          <div class="gb-section-desc">離れた設定・資料・記憶をつないだ提案を確認します。</div>
        </div>
        <select class="gb-select" data-idea-status>
          ${['new', 'reviewed', 'adopted', 'discarded', 'later'].map(status => `<option value="${status}" ${state.status === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
        <label class="gb-check"><input type="checkbox" data-idea-taste-filtered ${state.includeTasteFiltered ? 'checked' : ''}> 低スコアも表示</label>
        <button type="button" class="gb-btn gb-btn-sm" data-idea-action="mine">${ideaIcon('pickaxe', 14)} 手動更新</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-idea-action="rebuild">${ideaIcon('refreshCw', 14)} 再構築</button>
      </section>
      <div data-idea-alert></div>
      <section class="gb-section gb-section--boxed">
        <div data-idea-list><div class="gb-section-desc">読み込み中...</div></div>
      </section>
    `;
    root.querySelector('[data-idea-status]')?.addEventListener('change', event => {
      state.status = event.target.value;
      loadIdeas(root);
    });
    root.querySelector('[data-idea-taste-filtered]')?.addEventListener('change', event => {
      state.includeTasteFiltered = !!event.target.checked;
      loadIdeas(root);
    });
    root.querySelector('[data-idea-action="mine"]')?.addEventListener('click', () => mineIdeas(root, false));
    root.querySelector('[data-idea-action="rebuild"]')?.addEventListener('click', () => mineIdeas(root, true));
  }

  function setAlert(root, text, error = false) {
    const alert = root.querySelector('[data-idea-alert]');
    if (!alert) return;
    alert.innerHTML = text ? `<div class="gb-section-desc" style="color:${error ? 'var(--danger)' : 'var(--fg2)'};">${ideaEsc(text)}</div>` : '';
  }

  async function loadIdeas(root) {
    const token = ++state.loadToken;
    const status = state.status;
    const includeTasteFiltered = state.includeTasteFiltered;
    try {
      const payload = await ideaApi('/idea_inbox?status=' + encodeURIComponent(status) + (includeTasteFiltered ? '&include_taste_filtered=true' : ''));
      if (token !== state.loadToken) return;
      state.items = payload.items || [];
      renderList(root);
      setAlert(root, '');
    } catch (err) {
      if (token !== state.loadToken) return;
      setAlert(root, '読み込みに失敗: ' + (err.message || err), true);
    }
  }

  async function mineIdeas(root, rebuild) {
    if (state.busy) return;
    state.busy = true;
    setAlert(root, rebuild ? '概念インデックスを再構築しています...' : '連想を生成しています...');
    try {
      await ideaApi('/idea_inbox/mine', {
        method: 'POST',
        body: JSON.stringify({ limit: 5, rebuild }),
      });
      state.status = 'new';
      renderRoot(root);
      await loadIdeas(root);
    } catch (err) {
      setAlert(root, '生成に失敗: ' + (err.message || err), true);
    } finally {
      state.busy = false;
    }
  }

  function renderList(root) {
    const list = root.querySelector('[data-idea-list]');
    if (!list) return;
    if (!state.items.length) {
      list.innerHTML = '<div class="gb-section-desc">アイディアはまだありません。手動更新で生成できます。</div>';
      return;
    }
    list.innerHTML = state.items.map(renderCard).join('');
    list.querySelectorAll('[data-idea-id]').forEach(card => {
      const id = Number(card.dataset.ideaId);
      card.querySelectorAll('[data-idea-set]').forEach(btn => {
        btn.addEventListener('click', () => setIdeaStatus(root, id, btn.dataset.ideaSet));
      });
      card.querySelector('[data-idea-chat]')?.addEventListener('click', () => startIdeaChat(id));
    });
  }

  function renderCard(item) {
    const itemId = Number(item.id);
    const updating = state.updatingIds.has(itemId);
    const disabledAttr = updating ? ' disabled aria-busy="true"' : '';
    const concepts = (item.concepts_used || []).slice(0, 8).map(id => `<span class="gb-pill">#${Number(id)}</span>`).join('');
    const violation = item.canon_violation ? '<span class="gb-pill" style="color:var(--danger);">canon警告</span>' : '';
    const taste = renderTastePills(item);
    const original = item.original_idea ? `<div class="gb-section-desc" style="margin-top:6px;">原案: ${ideaEsc(item.original_idea)}</div>` : '';
    return `
      <article data-idea-id="${itemId}" style="border-bottom:1px solid var(--border);padding:12px 0;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="gb-pill">${ideaEsc(item.status || 'new')}</span>
          <span class="gb-pill">novelty ${Number(item.novelty_score || 0).toFixed(2)}</span>
          <span class="gb-pill">relevance ${Number(item.relevance_score || 0).toFixed(2)}</span>
          ${violation}
          ${taste}
          ${concepts}
        </div>
        <div style="margin-top:8px;line-height:1.55;">${ideaEsc(item.idea)}</div>
        ${original}
        ${item.reasoning ? `<div class="gb-section-desc" style="margin-top:6px;">${ideaEsc(item.reasoning)}</div>` : ''}
        ${renderTasteEvaluation(item)}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
          <button type="button" class="gb-btn gb-btn-sm" data-idea-set="adopted"${disabledAttr}>${ideaIcon('check', 14)} 採用</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-idea-set="later"${disabledAttr}>あとで</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-idea-set="reviewed"${disabledAttr}>確認済み</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-idea-set="discarded"${disabledAttr}>却下</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-idea-chat>${ideaIcon('messageSquare', 14)} このアイディアでチャット</button>
        </div>
      </article>
    `;
  }

  function renderTastePills(item) {
    if (!item.taste_enabled || item.taste_score == null) return '';
    const score = Number(item.taste_score || 0);
    const label = score >= 0.7 ? 'taste pass' : score >= 0.4 ? 'taste 要改善' : 'taste hidden';
    return `<span class="gb-pill">${label} ${score.toFixed(2)}</span>`;
  }

  function renderTasteEvaluation(item) {
    const applied = item?.taste_evaluation?.applied_principles || [];
    if (!applied.length) return '';
    const pills = applied.slice(0, 5).map(principle => {
      const label = principle.verdict === 'concern' ? '懸念' : principle.verdict === 'pass' ? '適用' : '参照';
      return `<span class="gb-pill" title="${ideaEsc(principle.reason || '')}">${label}: ${ideaEsc(principle.name || '')}</span>`;
    }).join('');
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">${pills}</div>`;
  }

  async function setIdeaStatus(root, id, status) {
    const itemId = Number(id);
    if (!Number.isFinite(itemId) || state.updatingIds.has(itemId)) return;
    state.updatingIds.add(itemId);
    renderList(root);
    setAlert(root, '状態を保存中...');
    try {
      await ideaApi('/idea_inbox/' + encodeURIComponent(itemId), {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      await loadIdeas(root);
    } catch (err) {
      setAlert(root, '状態変更に失敗: ' + (err.message || err), true);
    } finally {
      state.updatingIds.delete(itemId);
      renderList(root);
    }
  }

  function startIdeaChat(id) {
    const item = state.items.find(value => Number(value.id) === Number(id));
    if (!item) return;
    if (typeof openRightPanelTab === 'function') openRightPanelTab('chat');
    if (typeof switchChatMode === 'function') switchChatMode('llm');
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = `このアイディアを具体化して: ${item.idea}`;
      input.focus();
    }
  }

  function openIdeaInboxView() {
    const overlay = ensureModal();
    const root = overlay.querySelector('[data-idea-root]');
    renderRoot(root);
    loadIdeas(root);
  }

  window.openIdeaInboxView = openIdeaInboxView;
})();
