(function () {
  const state = {
    status: 'new',
    items: [],
    busy: false,
    includeTasteFiltered: false,
    loadToken: 0,
    updatingIds: new Set(),
  };
  const pendingByRoot = new WeakMap();
  let dialogApi = null;

  function ideaEsc(value) {
    return MeldexEscape.html(value);
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
    if (dialogApi?.isOpen?.()) return dialogApi.overlay;
    const restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.createElement('div');
    root.dataset.ideaRoot = '';
    root.className = 'idea-inbox-view';
    dialogApi = window.GBUI.createModal({
      id: 'idea-inbox',
      titleId: 'idea-inbox-title',
      title: 'アイディアインボックス',
      body: root,
      variant: 'standard',
      extraClass: 'idea-inbox-modal',
      geometryKey: 'idea-inbox',
      initialFocus: '[data-idea-status]',
      returnFocus: restoreTarget,
      closeLabel: '閉じる',
      onBeforeClose: () => pendingCountFor(root) === 0,
      onClose: () => {
        state.loadToken += 1;
        pendingByRoot.delete(root);
        dialogApi = null;
      },
    });
    const { overlay, modal, header } = dialogApi;
    overlay.classList.add('modal-overlay');
    overlay.dataset.ideaInbox = '1';
    overlay.dataset.e2eId = 'idea-inbox-overlay';
    modal.dataset.e2eId = 'idea-inbox-dialog';
    header.classList.add('idea-inbox-title');
    const title = header.querySelector('.gb-modal-title');
    if (title) title.insertAdjacentHTML('afterbegin', ideaIcon('lightbulb', 16));
    const closeButton = header.querySelector('.gb-modal-close');
    if (closeButton) {
      closeButton.classList.add('settings-modal-close');
      closeButton.dataset.ideaClose = '';
      closeButton.dataset.e2eId = 'idea-inbox-close';
    }
    dialogApi.open();
    return overlay;
  }

  function syncDialogBusy(root) {
    const overlay = root?.closest?.('[data-idea-inbox="1"]') || dialogApi?.overlay;
    if (!overlay) return;
    const busy = pendingCountFor(root) > 0;
    overlay.setAttribute('aria-busy', busy ? 'true' : 'false');
    const closeButton = overlay.querySelector('[data-idea-close]');
    if (closeButton) closeButton.disabled = busy;
  }

  function pendingStateFor(root) {
    let pending = pendingByRoot.get(root);
    if (!pending) {
      pending = { operations: new Set(), loadOperation: null };
      pendingByRoot.set(root, pending);
    }
    return pending;
  }

  function pendingCountFor(root) {
    return pendingByRoot.get(root)?.operations.size || 0;
  }

  function beginPending(root) {
    const pending = pendingStateFor(root);
    const operation = Symbol('idea-inbox-pending');
    pending.operations.add(operation);
    syncDialogBusy(root);
    return operation;
  }

  function endPending(root, operation) {
    const pending = pendingByRoot.get(root);
    if (pending) {
      pending.operations.delete(operation);
      if (pending.loadOperation === operation) pending.loadOperation = null;
    }
    syncDialogBusy(root);
  }

  function beginLoadPending(root) {
    // 一覧要求は同じモーダル本文内でだけ置き換える。短時間に閉じて
    // 開き直した場合も、古いrootのfetch完了を現在のbusy数へ混ぜない。
    const pending = pendingStateFor(root);
    if (pending.loadOperation) {
      pending.operations.delete(pending.loadOperation);
    }
    const operation = Symbol('idea-inbox-load-pending');
    pending.operations.add(operation);
    pending.loadOperation = operation;
    syncDialogBusy(root);
    return operation;
  }

  function renderRoot(root) {
    root.innerHTML = `
      <section class="gb-section gb-section--boxed idea-inbox-toolbar">
        <div class="idea-inbox-toolbar-main">
          <div class="gb-section-title">${ideaIcon('sparkles', 14)} 今日の連想</div>
          <div class="gb-section-desc">離れた設定・資料・記憶をつないだ提案を確認します。</div>
        </div>
        <div class="idea-inbox-toolbar-actions" data-dialog-actions="1">
          <select class="gb-select" data-idea-status data-e2e-id="idea-inbox-status" aria-label="表示するアイディアの状態">
            ${['new', 'reviewed', 'adopted', 'discarded', 'later'].map(status => `<option value="${status}" ${state.status === status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
          <label class="gb-check" data-e2e-id="idea-inbox-include-taste-filtered"><input type="checkbox" data-idea-taste-filtered data-e2e-id="idea-inbox-include-taste-filtered-input" ${state.includeTasteFiltered ? 'checked' : ''}> 低スコアも表示</label>
          <button type="button" class="gb-btn gb-btn-sm" data-idea-action="mine" data-e2e-id="idea-inbox-mine" aria-label="手動更新" title="手動更新">${ideaIcon('pickaxe', 14)} 手動更新</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-idea-action="rebuild" data-e2e-id="idea-inbox-rebuild" aria-label="再構築" title="再構築">${ideaIcon('refreshCw', 14)} 再構築</button>
        </div>
      </section>
      <div data-idea-alert aria-live="polite"></div>
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

  function setAlert(root, text, error = false, retry = null) {
    const alert = root.querySelector('[data-idea-alert]');
    if (!alert) return;
    alert.replaceChildren();
    if (!text) return;
    const message = document.createElement('div');
    message.className = `gb-section-desc idea-inbox-alert-text${error ? ' is-error' : ''}`;
    message.textContent = text;
    alert.appendChild(message);
    if (typeof retry === 'function') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gb-btn gb-btn-sm gb-btn-quiet idea-inbox-retry';
      button.dataset.e2eId = 'idea-inbox-retry';
      button.textContent = '再試行';
      button.setAttribute('aria-label', '再試行');
      button.title = '再試行';
      button.addEventListener('click', retry, { once: true });
      alert.appendChild(button);
    }
  }

  async function loadIdeas(root) {
    const token = ++state.loadToken;
    const status = state.status;
    const includeTasteFiltered = state.includeTasteFiltered;
    const pendingOperation = beginLoadPending(root);
    try {
      const payload = await ideaApi('/idea_inbox?status=' + encodeURIComponent(status) + (includeTasteFiltered ? '&include_taste_filtered=true' : ''));
      if (token !== state.loadToken) return;
      state.items = payload.items || [];
      renderList(root);
      setAlert(root, '');
    } catch (err) {
      if (token !== state.loadToken) return;
      setAlert(root, '読み込みに失敗: ' + (err.message || err), true, () => loadIdeas(root));
    } finally {
      endPending(root, pendingOperation);
    }
  }

  async function mineIdeas(root, rebuild) {
    if (state.busy) return;
    state.busy = true;
    const pendingOperation = beginPending(root);
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
      setAlert(root, '生成に失敗: ' + (err.message || err), true, () => mineIdeas(root, rebuild));
    } finally {
      state.busy = false;
      endPending(root, pendingOperation);
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
      card.querySelector('.idea-inbox-card-actions')?.addEventListener('click', event => {
        if (!event.target?.classList?.contains('idea-inbox-card-actions')) return;
        const hitButton = Array.from(event.target.querySelectorAll('button')).find(button => {
          if (button.disabled) return false;
          const rect = button.getBoundingClientRect();
          return event.clientX >= rect.left
            && event.clientX <= rect.right
            && event.clientY >= rect.top
            && event.clientY <= rect.bottom;
        });
        hitButton?.click();
      });
    });
  }

  function renderCard(item) {
    const itemId = Number(item.id);
    const updating = state.updatingIds.has(itemId);
    const disabledAttr = updating ? ' disabled aria-busy="true"' : '';
    const concepts = (item.concepts_used || []).slice(0, 8).map(id => `<span class="gb-pill">#${Number(id)}</span>`).join('');
    const violation = item.canon_violation ? '<span class="gb-pill idea-inbox-pill-danger">canon警告</span>' : '';
    const taste = renderTastePills(item);
    const original = item.original_idea ? `<div class="gb-section-desc idea-inbox-card-note">原案: ${ideaEsc(item.original_idea)}</div>` : '';
    return `
      <article class="idea-inbox-card" data-idea-id="${itemId}" data-e2e-id="idea-inbox-card-${itemId}">
        <div class="idea-inbox-card-meta">
          <span class="gb-pill">${ideaEsc(item.status || 'new')}</span>
          <span class="gb-pill">novelty ${Number(item.novelty_score || 0).toFixed(2)}</span>
          <span class="gb-pill">relevance ${Number(item.relevance_score || 0).toFixed(2)}</span>
          ${violation}
          ${taste}
          ${concepts}
        </div>
        <div class="idea-inbox-card-body">${ideaEsc(item.idea)}</div>
        ${original}
        ${item.reasoning ? `<div class="gb-section-desc idea-inbox-card-note">${ideaEsc(item.reasoning)}</div>` : ''}
        ${renderTasteEvaluation(item)}
        <div class="idea-inbox-card-actions">
          <button type="button" class="gb-btn gb-btn-sm" data-idea-set="adopted" data-e2e-id="idea-inbox-card-${itemId}-adopted" aria-label="採用" title="採用"${disabledAttr}>${ideaIcon('check', 14)} 採用</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-idea-set="later" data-e2e-id="idea-inbox-card-${itemId}-later" aria-label="あとで" title="あとで"${disabledAttr}>あとで</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-idea-set="reviewed" data-e2e-id="idea-inbox-card-${itemId}-reviewed" aria-label="確認済み" title="確認済み"${disabledAttr}>確認済み</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-idea-set="discarded" data-e2e-id="idea-inbox-card-${itemId}-discarded" aria-label="却下" title="却下"${disabledAttr}>却下</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-idea-chat data-e2e-id="idea-inbox-card-${itemId}-chat" aria-label="このアイディアでチャット" title="このアイディアでチャット">${ideaIcon('messageSquare', 14)} このアイディアでチャット</button>
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
    return `<div class="idea-inbox-taste-evaluation">${pills}</div>`;
  }

  async function setIdeaStatus(root, id, status) {
    const itemId = Number(id);
    if (!Number.isFinite(itemId) || state.updatingIds.has(itemId)) return;
    state.updatingIds.add(itemId);
    const pendingOperation = beginPending(root);
    renderList(root);
    setAlert(root, '状態を保存中...');
    try {
      await ideaApi('/idea_inbox/' + encodeURIComponent(itemId), {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      await loadIdeas(root);
    } catch (err) {
      setAlert(root, '状態変更に失敗: ' + (err.message || err), true, () => setIdeaStatus(root, itemId, status));
    } finally {
      state.updatingIds.delete(itemId);
      renderList(root);
      endPending(root, pendingOperation);
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
