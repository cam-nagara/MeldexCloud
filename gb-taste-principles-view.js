(function () {
  const stateByContainer = new WeakMap();
  const TASTE_TYPE_LABELS = {
    principle: '原則',
    case_study: '事例',
    anti_pattern: '避ける例',
    preference: '好み',
  };
  const TASTE_SCOPE_LABELS = {
    character: 'キャラクター',
    plot: 'プロット',
    dialogue: '会話',
    structure: '構成',
    theme: 'テーマ',
    pacing: 'テンポ',
    visual: '画面',
    world: '世界観',
    other: 'その他',
  };

  function tasteEsc(value) {
    return MeldexEscape.html(value);
  }

  function tasteIcon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function tasteTypeLabel(value) {
    const key = String(value || '');
    return TASTE_TYPE_LABELS[key] || key || '種別すべて';
  }

  function tasteScopeLabel(value) {
    const key = String(value || '');
    return TASTE_SCOPE_LABELS[key] || key || 'スコープすべて';
  }

  async function tastePromptText(message, defaultValue, options) {
    if (typeof cfPrompt === 'function') return await cfPrompt(message, defaultValue || '', options || {});
    return window.prompt(message, defaultValue || '');
  }

  function tasteAuthToken() {
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

  async function tasteApi(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const token = tasteAuthToken();
    if (token && !headers.Authorization) headers.Authorization = 'Bearer ' + token;
    if (typeof apiFetch === 'function') return apiFetch(path, { ...opts, headers });
    const res = await fetch(API_BASE + path, { ...opts, headers });
    const text = await res.text();
    let payload = {};
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { detail: text }; }
    }
    if (!res.ok) {
      const detail = payload?.detail?.message || payload?.detail || payload?.error || res.statusText;
      const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
      err.status = res.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  }

  function getState(container) {
    let state = stateByContainer.get(container);
    if (!state) {
      state = { enabled: false, items: [], feedback: [], q: '', type: '', scope: '', busy: false, role: 'viewer', roleLoaded: false };
      stateByContainer.set(container, state);
    }
    return state;
  }

  async function ensureRole(container) {
    const state = getState(container);
    if (state.roleLoaded) return state.role;
    try {
      const me = await tasteApi('/auth/me');
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
    setAlert(container, '閲覧専用です。感性原則の編集は管理者のみ可能です。', true);
    return false;
  }

  function renderShell(container) {
    const state = getState(container);
    const roleWasLoaded = state.roleLoaded;
    const writable = canWrite(container);
    container.classList.add('taste-principles-view');
    container.innerHTML = `
      <section class="gb-section gb-section--boxed taste-enable-summary">
        <div class="taste-enable-copy">
          <div class="gb-section-title">${tasteIcon('sparkles', 14)} 感性原則</div>
          <div class="gb-section-desc">技法ナレッジから抽出した個人用の執筆判断基準です。</div>
        </div>
        <label class="gb-check" title="有効にするとアイディア生成だけに個人化を適用します">
          <input type="checkbox" data-taste-enabled data-e2e-id="settings-taste-enabled" aria-label="技法ナレッジで個人化する" ${state.enabled ? 'checked' : ''}${writable ? '' : ' disabled'}>
          <span>技法ナレッジで個人化する</span>
        </label>
      </section>
      ${state.enabled ? '<section class="gb-section gb-section--boxed"><div class="gb-section-title">あなた専用の感性フィルタ ON</div><div class="gb-section-desc">検索・出典・Skills・記憶抽出には適用されません。アイディア生成と批評だけに使われます。</div></section>' : ''}
      <section class="gb-section gb-section--boxed taste-toolbar">
        <input class="gb-input" data-taste-q data-e2e-id="settings-taste-query" aria-label="感性原則を検索" placeholder="検索" value="${tasteEsc(state.q)}">
        <select class="gb-select" data-taste-type data-e2e-id="settings-taste-type" aria-label="感性原則の種別">
          ${['', 'principle', 'case_study', 'anti_pattern', 'preference'].map(type => `<option value="${type}" ${state.type === type ? 'selected' : ''}>${tasteEsc(tasteTypeLabel(type))}</option>`).join('')}
        </select>
        <select class="gb-select" data-taste-scope data-e2e-id="settings-taste-scope" aria-label="感性原則のスコープ">
          ${['', 'character', 'plot', 'dialogue', 'structure', 'theme', 'pacing', 'visual', 'world', 'other'].map(scope => `<option value="${scope}" ${state.scope === scope ? 'selected' : ''}>${tasteEsc(tasteScopeLabel(scope))}</option>`).join('')}
        </select>
        ${writable ? `<button type="button" class="gb-btn gb-btn-sm" data-taste-action="extract" data-e2e-id="settings-taste-extract">${tasteIcon('sparkles', 14)} 抽出</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-taste-action="add" data-e2e-id="settings-taste-add">${tasteIcon('plus', 14)} 追加</button>` : ''}
        <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-taste-action="refresh" data-e2e-id="settings-taste-refresh">${tasteIcon('refreshCw', 14)} 更新</button>
      </section>
      <div data-taste-alert></div>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">採用学習</div>
        <div data-taste-learning>${renderLearning(state.feedback)}</div>
      </section>
      <section class="gb-section gb-section--boxed">
        <div data-taste-list><div class="gb-section-desc">読み込み中...</div></div>
      </section>
    `;
    if (!roleWasLoaded) {
      ensureRole(container).then(() => {
        if (container.isConnected) {
          renderShell(container);
          renderList(container);
        }
      });
    }
    bindShell(container);
  }

  function bindShell(container) {
    const state = getState(container);
    container.querySelector('[data-taste-enabled]')?.addEventListener('change', async event => {
      if (!ensureCanWrite(container)) {
        event.target.checked = !!state.enabled;
        return;
      }
      await tasteApi('/taste/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!event.target.checked }),
      });
      state.enabled = !!event.target.checked;
      renderShell(container);
      loadTaste(container);
    });
    container.querySelector('[data-taste-q]')?.addEventListener('input', event => {
      state.q = event.target.value;
      clearTimeout(state.qTimer);
      state.qTimer = setTimeout(() => loadTaste(container), 250);
    });
    container.querySelector('[data-taste-type]')?.addEventListener('change', event => {
      state.type = event.target.value;
      loadTaste(container);
    });
    container.querySelector('[data-taste-scope]')?.addEventListener('change', event => {
      state.scope = event.target.value;
      loadTaste(container);
    });
    container.querySelector('[data-taste-action="extract"]')?.addEventListener('click', () => extractTaste(container));
    container.querySelector('[data-taste-action="add"]')?.addEventListener('click', () => addTaste(container));
    container.querySelector('[data-taste-action="refresh"]')?.addEventListener('click', () => loadTaste(container));
  }

  function setAlert(container, text, error = false) {
    const alert = container.querySelector('[data-taste-alert]');
    if (!alert) return;
    alert.innerHTML = text ? `<div class="gb-section-desc taste-alert-message${error ? ' is-error' : ''}">${tasteEsc(text)}</div>` : '';
  }

  async function loadTaste(container) {
    const state = getState(container);
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.type) params.set('type', state.type);
    if (state.scope) params.set('scope', state.scope);
    try {
      const [settings, principles, feedback] = await Promise.all([
        tasteApi('/taste/settings'),
        tasteApi('/taste/principles' + (params.toString() ? '?' + params.toString() : '')),
        tasteApi('/taste/feedback?limit=80'),
      ]);
      state.enabled = !!settings.enabled;
      state.items = principles.items || [];
      state.feedback = feedback.items || [];
      renderShell(container);
      renderList(container);
      setAlert(container, '');
    } catch (err) {
      setAlert(container, '読み込みに失敗: ' + (err.message || err), true);
    }
  }

  async function extractTaste(container) {
    if (!ensureCanWrite(container)) return;
    const state = getState(container);
    if (state.busy) return;
    state.busy = true;
    setAlert(container, '技法ナレッジを抽出しています...');
    try {
      const result = await tasteApi('/taste/principles/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      });
      await loadTaste(container);
      setAlert(container, `抽出完了: ${Number(result.principle_count || 0)}件`);
    } catch (err) {
      setAlert(container, '抽出に失敗: ' + (err.message || err), true);
    } finally {
      state.busy = false;
    }
  }

  async function addTaste(container) {
    if (!ensureCanWrite(container)) return;
    const rule = await tastePromptText('新しい感性原則', '', { okLabel: '追加' });
    if (!rule) return;
    await tasteApi('/taste/principles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'principle', scope: 'other', rule, user_pinned: true }),
    });
    await loadTaste(container);
  }

  function renderList(container) {
    const state = getState(container);
    const list = container.querySelector('[data-taste-list]');
    if (!list) return;
    if (!state.items.length) {
      list.innerHTML = '<div class="gb-section-desc">感性原則はまだありません。抽出または追加で作成できます。</div>';
      return;
    }
    const writable = canWrite(container);
    list.innerHTML = state.items.map(item => renderCard(item, writable)).join('');
    list.querySelectorAll('[data-taste-id]').forEach(card => {
      const id = Number(card.dataset.tasteId);
      if (writable) {
        card.querySelector('[data-taste-action="pin"]')?.addEventListener('click', () => updateTaste(container, id, { user_pinned: card.dataset.pinned !== '1' }));
        card.querySelector('[data-taste-action="weight"]')?.addEventListener('change', event => updateTaste(container, id, { user_weight: Number(event.target.value || 1) }));
        card.querySelector('[data-taste-action="delete"]')?.addEventListener('click', () => deleteTaste(container, id));
      }
      card.querySelector('[data-taste-action="open"]')?.addEventListener('click', () => openTasteSource(card.dataset.sourcePath || ''));
    });
  }

  function renderCard(item, writable) {
    const totalWeight = Number(item.user_weight || 1) * Number(item.learned_weight || 1);
    const pct = Math.max(4, Math.min(100, Math.round(totalWeight * 50)));
    return `
      <article class="taste-card" data-e2e-id="settings-taste-card" data-taste-id="${Number(item.id)}" data-pinned="${item.user_pinned ? '1' : '0'}" data-source-path="${tasteEsc(item.source_path || '')}">
        <div class="taste-card-meta">
          <span class="gb-pill">${tasteEsc(tasteTypeLabel(item.type))}</span>
          <span class="gb-pill">${tasteEsc(tasteScopeLabel(item.scope))}</span>
          ${item.user_pinned ? '<span class="gb-pill">固定</span>' : ''}
          <span class="gb-pill">学習 ${Number(item.learned_weight || 1).toFixed(2)}</span>
          <span class="gb-pill">採用学習 ${Number(item.feedback_count || 0)}</span>
        </div>
        <div class="taste-card-rule">${tasteEsc(item.rule)}</div>
        ${item.rationale ? `<div class="gb-section-desc taste-card-rationale">${tasteEsc(item.rationale)}</div>` : ''}
        <div class="taste-card-weight-meter" aria-hidden="true" style="--taste-weight-pct:${pct}%;">
          <div class="taste-card-weight-meter-fill"></div>
        </div>
        <div class="taste-card-actions">
          ${writable ? `<label class="gb-field-row taste-card-weight"><span class="gb-section-desc">重み</span><input type="number" min="0.1" max="5" step="0.1" value="${Number(item.user_weight || 1).toFixed(1)}" class="gb-input taste-card-weight-input" data-taste-action="weight" data-e2e-id="settings-taste-weight" aria-label="感性原則の重み"></label>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-taste-action="pin" data-e2e-id="settings-taste-pin" aria-label="${item.user_pinned ? '感性原則の固定を解除' : '感性原則を固定'}">${item.user_pinned ? '固定解除' : '固定'}</button>` : ''}
          ${item.source_path ? '<button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-taste-action="open" data-e2e-id="settings-taste-open-source" aria-label="感性原則の元ファイルを開く">元ファイル</button>' : ''}
          ${writable ? '<button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-taste-action="delete" data-e2e-id="settings-taste-delete" aria-label="感性原則を削除">削除</button>' : ''}
        </div>
      </article>
    `;
  }

  function renderLearning(feedback) {
    if (!feedback || !feedback.length) return '<div class="gb-section-desc">採用/却下の学習ログはまだありません。</div>';
    const recent = feedback.slice(0, 6).map(item => {
      const signal = Number(item.signal || 0);
      const tone = signal > 0 ? ' is-positive' : signal < 0 ? ' is-negative' : '';
      return `<div class="gb-section-desc taste-learning-row"><span class="taste-learning-signal${tone}">${signal > 0 ? '+' : ''}${signal.toFixed(1)}</span><span>${tasteEsc(item.rule || '')}</span></div>`;
    }).join('');
    return recent;
  }

  async function updateTaste(container, id, payload) {
    if (!ensureCanWrite(container)) return;
    await tasteApi('/taste/principles/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await loadTaste(container);
  }

  async function deleteTaste(container, id) {
    if (!ensureCanWrite(container)) return;
    const ok = typeof cfConfirm === 'function'
      ? await cfConfirm('この感性原則を削除しますか？', { danger: true, okLabel: '削除' })
      : window.confirm('この感性原則を削除しますか？');
    if (!ok) return;
    await tasteApi('/taste/principles/' + encodeURIComponent(id), { method: 'DELETE' });
    await loadTaste(container);
  }

  function openTasteSource(path) {
    if (!path || path.startsWith('__')) return;
    if (typeof openPage === 'function') openPage(path.split('/').pop() || path, path);
  }

  function openTastePrinciplesView(container) {
    if (!container) return;
    renderShell(container);
    loadTaste(container);
  }

  window.openTastePrinciplesView = openTastePrinciplesView;
})();
