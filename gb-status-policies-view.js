(function () {
  const BOOL_FIELDS = [
    'is_canonical',
    'override_protection',
    'learnable',
    'ideation_usable',
    'contradiction_check',
    'llm_reference',
    'llm_citation',
    'chat_response',
    'publish_allowed',
    'unlock_requires_confirmation',
  ];
  const MAIN_BOOL_FIELDS = BOOL_FIELDS.filter(field => field !== 'unlock_requires_confirmation');
  const DEFAULT_ADD_BOOL_FIELDS = new Set(['learnable', 'ideation_usable', 'llm_reference', 'chat_response']);
  const FIELD_LABELS = {
    status_value: 'ステータス',
    display_label: '表示名',
    display_color: '色',
    is_canonical: '確定済み',
    override_protection: '上書き保護',
    learnable: '学習対象',
    ideation_usable: 'アイディア入力',
    contradiction_check: '矛盾検知',
    llm_reference: 'LLM参照',
    llm_citation: 'LLM引用',
    chat_response: 'チャット応答',
    publish_allowed: '公開',
    taste_learning_weight: '重み',
    unlock_requires_confirmation: '確認要求',
    description: '説明',
  };
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  const stateByContainer = new WeakMap();

  function spEsc(value) {
    return MeldexEscape.html(value);
  }

  function spIcon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function spE2eId(value) {
    return encodeURIComponent(String(value ?? '')).replace(/[^a-zA-Z0-9_-]/g, '_') || 'empty';
  }

  function spAuthToken() {
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

  async function spApi(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const token = spAuthToken();
    if (token && !headers.Authorization) headers.Authorization = 'Bearer ' + token;
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
      state = { policies: [], undefinedStatuses: {}, selectedStatus: '', timers: new Map(), saving: new Set(), role: 'viewer', roleLoaded: false };
      stateByContainer.set(container, state);
    }
    return state;
  }

  async function ensureRole(container) {
    const state = getState(container);
    if (state.roleLoaded) return state.role;
    try {
      const me = await spApi('/auth/me');
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
    if (typeof showStatus === 'function') showStatus('閲覧専用です。ステータス別ポリシー編集は管理者のみ可能です。', true);
    return false;
  }

  function usageFor(policy) {
    return policy?.usage || { entry_count: 0, knowledge_item_count: 0, reclassify_count: 0 };
  }

  function normalizeBool(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
  }

  function policyByStatus(state, status) {
    return state.policies.find(item => item.status_value === status) || null;
  }

  function renderShell(container) {
    const state = getState(container);
    const roleWasLoaded = state.roleLoaded;
    const writable = canWrite(container);
    container.className = 'status-policies-view';
    container.innerHTML = `
      <section class="gb-section gb-section--boxed sp-header">
        <div class="sp-header-main">
          <div class="gb-section-title">${spIcon('brain', 14)} ステータス別ポリシー</div>
          <div class="gb-section-desc">LLMが各ステータスを学習・継承・連想に使う時の扱いを設定します。変更は記憶継承の抽出と再分類に影響します。</div>
        </div>
        ${writable ? `<button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-sp-action="reset-all" data-e2e-id="settings-status-policies-reset-all">${spIcon('rotateCcw', 14)} 全プリセットを初期値に戻す</button>` : ''}
      </section>
      <div data-sp-alerts></div>
      <div class="sp-layout">
        <section class="gb-section gb-section--boxed sp-main">
          <div class="sp-toolbar">
            ${writable ? `<button type="button" class="gb-btn gb-btn-sm" data-sp-action="show-add" data-e2e-id="settings-status-policies-show-add">${spIcon('plus', 14)} 新規ステータスを追加</button>` : ''}
            <span class="gb-section-desc" data-sp-status>読み込み中...</span>
          </div>
          <div class="sp-add-form" data-sp-add-form hidden>
            <div class="sp-add-grid">
              <label class="gb-field">
                <span class="gb-label">ステータス</span>
                <input class="gb-input" data-sp-add="status_value" maxlength="32">
              </label>
              <label class="gb-field">
                <span class="gb-label">表示名</span>
                <input class="gb-input" data-sp-add="display_label" maxlength="64">
              </label>
              <label class="gb-field">
                <span class="gb-label">色</span>
                <button type="button" class="sp-color-button" data-sp-add-color style="--sp-color:#94a3b8;"><span></span>#94a3b8</button>
              </label>
              <label class="gb-field">
                <span class="gb-label">説明</span>
                <input class="gb-input" data-sp-add="description" maxlength="200">
              </label>
            </div>
            <div class="sp-checks">
              ${BOOL_FIELDS.map(field => `
                <label class="gb-check">
                  <input type="checkbox" data-sp-add="${field}" ${DEFAULT_ADD_BOOL_FIELDS.has(field) ? 'checked' : ''}>
                  <span>${spEsc(FIELD_LABELS[field])}</span>
                </label>
              `).join('')}
              <label class="gb-field-row sp-weight-row">
                <span class="gb-label">重み</span>
                <input type="range" min="0" max="2" step="0.1" value="1" data-sp-add="taste_learning_weight">
                <span data-sp-add-weight>1.0</span>
              </label>
            </div>
            <div class="sp-form-actions">
              <span class="sp-inline-message" data-sp-add-message></span>
              <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-sp-action="hide-add">キャンセル</button>
              <button type="button" class="gb-btn gb-btn-sm" data-sp-action="submit-add">追加</button>
            </div>
          </div>
          <div class="sp-table-wrap">
            <table class="sp-table">
              <thead>
                <tr>
                  <th></th>
                  <th>ステータス</th>
                  <th>色</th>
                  <th>確定済み</th>
                  <th>上書き保護</th>
                  <th>学習対象</th>
                  <th>アイディア入力</th>
                  <th>矛盾検知</th>
                  <th>LLM参照</th>
                  <th>LLM引用</th>
                  <th>チャット応答</th>
                  <th>公開</th>
                  <th>重み</th>
                  <th>確認要求</th>
                  <th>説明</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody data-sp-rows></tbody>
            </table>
          </div>
        </section>
        <aside class="gb-section gb-section--boxed sp-preview" data-sp-preview></aside>
      </div>
      <section class="gb-section gb-section--boxed sp-transfer">
        <div>
          <div class="gb-section-title">${spIcon('fileJson', 14)} インポート / エクスポート</div>
          <div class="gb-section-desc">JSONでポリシーセットを書き出し、別環境に読み込めます。</div>
        </div>
        <div class="sp-transfer-actions">
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-sp-action="export-json" data-e2e-id="settings-status-policies-export-json">${spIcon(typeof uiTransferIconName === 'function' ? uiTransferIconName('export') : 'upload', 14)} JSON エクスポート</button>
          ${writable ? `<button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-sp-action="import-merge" data-e2e-id="settings-status-policies-import-merge">${spIcon(typeof uiTransferIconName === 'function' ? uiTransferIconName('import') : 'download', 14)} 追加インポート</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-quiet" data-sp-action="import-replace" data-e2e-id="settings-status-policies-import-replace">${spIcon('replace', 14)} 全置換インポート</button>` : ''}
          <input type="file" accept="application/json,.json" data-sp-import-file hidden>
        </div>
      </section>
    `;
    if (!roleWasLoaded) {
      ensureRole(container).then(() => {
        if (container.isConnected) {
          renderShell(container);
          loadPolicies(container);
        }
      });
    }
    bindContainer(container);
  }

  function bindContainer(container) {
    if (container.dataset.spBound === '1') return;
    container.dataset.spBound = '1';
    container.addEventListener('click', event => handleClick(container, event));
    container.addEventListener('input', event => handleInput(container, event));
    container.addEventListener('change', event => handleChange(container, event));
    container.addEventListener('dragstart', event => handleDragStart(container, event));
    container.addEventListener('dragover', event => handleDragOver(event));
    container.addEventListener('drop', event => handleDrop(container, event));
  }

  function renderAll(container) {
    renderAlerts(container);
    renderRows(container);
    renderPreview(container);
    const state = getState(container);
    const statusEl = container.querySelector('[data-sp-status]');
    if (statusEl) statusEl.textContent = `${state.policies.length}件のポリシー`;
    if (typeof replaceIcons === 'function') replaceIcons(container);
  }

  function renderAlerts(container) {
    const state = getState(container);
    const root = container.querySelector('[data-sp-alerts]');
    if (!root) return;
    const entries = Object.entries(state.undefinedStatuses || {});
    const writable = canWrite(container);
    if (!entries.length) {
      root.innerHTML = '';
      return;
    }
    root.innerHTML = `
      <section class="gb-section gb-section--boxed sp-alert">
        <div>
          <div class="gb-section-title">${spIcon('triangleAlert', 14)} 未登録のステータスがあります</div>
          <div class="gb-section-desc">未登録ステータスは「(未設定)」相当で扱われます。必要ならポリシーを定義してください。</div>
        </div>
        <div class="sp-alert-list">
          ${entries.map(([status, usage]) => `
            <button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-sp-action="define-status" data-status="${spEsc(status)}" data-e2e-id="settings-status-policies-define-${spE2eId(status)}"${writable ? '' : ' disabled'}>
              ${spEsc(status)} (${Number(usage?.entry_count || 0)}件)
            </button>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderRows(container) {
    const state = getState(container);
    const tbody = container.querySelector('[data-sp-rows]');
    if (!tbody) return;
    const writable = canWrite(container);
    tbody.innerHTML = state.policies.map(policy => renderRow(policy, state, writable)).join('');
  }

  function renderRow(policy, state, writable) {
    const usage = usageFor(policy);
    const selected = state.selectedStatus === policy.status_value ? ' is-selected' : '';
    const system = policy.is_system ? '1' : '0';
    const disabled = (policy.is_system || !writable) ? ' disabled' : '';
    const key = spE2eId(policy.status_value);
    return `
      <tr class="sp-row${selected}" data-sp-row data-status="${spEsc(policy.status_value)}" data-updated="${spEsc(policy.updated || '')}" data-system="${system}">
        <td class="sp-drag-cell"><button type="button" class="sp-drag-handle" draggable="${writable ? 'true' : 'false'}" data-sp-drag-handle data-status="${spEsc(policy.status_value)}" data-e2e-id="settings-status-policy-${key}-drag" title="並び替え"${writable ? '' : ' disabled'}>☰</button></td>
        <td class="sp-status-cell">
          <input class="gb-input sp-status-input" data-sp-field="status_value" data-e2e-id="settings-status-policy-${key}-status" value="${spEsc(policy.status_value)}"${disabled} maxlength="32" aria-label="${spEsc(policy.status_value)} status">
          <input class="gb-input sp-label-input" data-sp-field="display_label" data-e2e-id="settings-status-policy-${key}-display-label" value="${spEsc(policy.display_label || '')}" maxlength="64"${writable ? '' : ' disabled'} aria-label="${spEsc(policy.status_value)} 表示名">
          <span class="sp-usage">${Number(usage.entry_count || 0)}件使用中</span>
        </td>
        <td>
          <button type="button" class="sp-color-button" data-sp-color data-e2e-id="settings-status-policy-${key}-color" style="--sp-color:${spEsc(policy.display_color || '#94a3b8')};" aria-label="${spEsc(policy.status_value)} 色"${writable ? '' : ' disabled'}>
            <span></span>${spEsc(policy.display_color || '#94a3b8')}
          </button>
        </td>
        ${MAIN_BOOL_FIELDS.map(field => `
          <td class="sp-center">
            <input type="checkbox" data-sp-field="${field}" data-e2e-id="settings-status-policy-${key}-${field}" ${normalizeBool(policy[field]) ? 'checked' : ''}${writable ? '' : ' disabled'} aria-label="${spEsc(policy.status_value)} ${spEsc(FIELD_LABELS[field])}">
          </td>
        `).join('')}
        <td class="sp-weight-cell">
          <input type="range" min="0" max="2" step="0.1" data-sp-field="taste_learning_weight" data-e2e-id="settings-status-policy-${key}-taste-learning-weight" value="${Number(policy.taste_learning_weight ?? 1)}"${writable ? '' : ' disabled'} aria-label="${spEsc(policy.status_value)} 重み">
          <span data-sp-weight-output>${Number(policy.taste_learning_weight ?? 1).toFixed(1)}</span>
        </td>
        <td class="sp-center">
          <input type="checkbox" data-sp-field="unlock_requires_confirmation" data-e2e-id="settings-status-policy-${key}-unlock-requires-confirmation" ${normalizeBool(policy.unlock_requires_confirmation) ? 'checked' : ''}${writable ? '' : ' disabled'} aria-label="${spEsc(policy.status_value)} 確認要求">
        </td>
        <td>
          <textarea class="gb-input sp-desc-input" data-sp-field="description" data-e2e-id="settings-status-policy-${key}-description" maxlength="200"${writable ? '' : ' disabled'} aria-label="${spEsc(policy.status_value)} 説明">${spEsc(policy.description || '')}</textarea>
        </td>
        <td class="sp-actions">
          ${!writable ? ''
            : policy.is_system
            ? `<button type="button" class="gb-btn gb-btn-xs gb-btn-quiet" data-sp-action="reset-one" data-e2e-id="settings-status-policy-${key}-reset">${spIcon('rotateCcw', 13)} リセット</button>`
            : `<button type="button" class="gb-btn gb-btn-xs gb-btn-danger" data-sp-action="delete-one" data-e2e-id="settings-status-policy-${key}-delete">${spIcon('trash2', 13)} 削除</button>`}
          <span class="sp-row-message" data-sp-row-message></span>
        </td>
      </tr>
    `;
  }

  function renderPreview(container) {
    const state = getState(container);
    const root = container.querySelector('[data-sp-preview]');
    if (!root) return;
    const policy = policyByStatus(state, state.selectedStatus) || state.policies[0];
    if (!policy) {
      root.innerHTML = '<div class="gb-section-desc">ポリシーを読み込み中...</div>';
      return;
    }
    state.selectedStatus = policy.status_value;
    const usage = usageFor(policy);
    const section = policy.is_canonical
      ? `【確定済み・変更不可】（${policy.display_label || policy.status_value}）`
      : policy.override_protection
        ? `【システム保護】（${policy.display_label || policy.status_value}）`
        : `【調整可能】（${policy.display_label || policy.status_value}）`;
    const actionText = policy.learnable
      ? `- [fact] 主人公の名前は○○（${policy.display_label || policy.status_value}から抽出）`
      : `- このステータスは学習対象外のため、記憶項目には抽出されません`;
    root.innerHTML = `
      <div class="gb-section-title">${spIcon('eye', 14)} LLM への見え方</div>
      <div class="sp-preview-pill" style="--sp-color:${spEsc(policy.display_color || '#94a3b8')};">${spEsc(policy.display_label || policy.status_value)}</div>
      <pre class="sp-preview-code">## このソースフォルダの確定済み内容

### ${spEsc(section)}
${spEsc(actionText)}</pre>
      <div class="sp-impact">
        <div><strong>${Number(usage.entry_count || 0)}</strong><span>このステータスを使用中のエントリ</span></div>
        <div><strong>${Number(usage.reclassify_count || 0)}</strong><span>再分類対象の記憶項目</span></div>
      </div>
      <div class="gb-section-desc">
        ${policy.contradiction_check ? '矛盾検知対象です。' : '矛盾検知対象ではありません。'}
        ${policy.ideation_usable ? 'アイディア生成の入力に使われます。' : 'アイディア生成の入力から除外されます。'}
        ${policy.llm_reference ? 'LLM参照に使われます。' : 'LLM参照から除外されます。'}
        ${policy.llm_citation ? 'LLM引用に使われます。' : 'LLM引用から除外されます。'}
        ${policy.chat_response ? 'チャット応答に使われます。' : 'チャット応答から除外されます。'}
        ${policy.publish_allowed ? '公開HTMLに含められます。' : '公開HTMLではブロックされます。'}
      </div>
    `;
  }

  async function loadPolicies(container) {
    const statusEl = container.querySelector('[data-sp-status]');
    if (statusEl) statusEl.textContent = '読み込み中...';
    try {
      const data = await spApi('/status_policies');
      const state = getState(container);
      state.policies = Array.isArray(data.policies) ? data.policies : [];
      state.undefinedStatuses = data.undefined_statuses || {};
      if (!state.selectedStatus || !policyByStatus(state, state.selectedStatus)) {
        state.selectedStatus = state.policies[0]?.status_value || '';
      }
      renderAll(container);
    } catch (err) {
      if (statusEl) statusEl.textContent = '読み込みに失敗しました';
      if (typeof showStatus === 'function') showStatus('ステータス別ポリシーの読み込みに失敗: ' + err.message, true);
    }
  }

  async function handleClick(container, event) {
    const actionEl = event.target.closest('[data-sp-action]');
    const row = event.target.closest('[data-sp-row]');
    if (row && !event.target.closest('input, textarea, button')) {
      selectPolicy(container, row.dataset.status);
    }
    if (!actionEl) return;
    const action = actionEl.dataset.spAction;
    const writeActions = new Set(['show-add', 'hide-add', 'submit-add', 'define-status', 'reset-one', 'reset-all', 'delete-one', 'import-merge', 'import-replace']);
    if (writeActions.has(action) && !ensureCanWrite(container)) return;
    try {
      if (action === 'show-add') return showAddForm(container);
      if (action === 'hide-add') return hideAddForm(container);
      if (action === 'submit-add') return await submitAddForm(container);
      if (action === 'define-status') return showAddForm(container, actionEl.dataset.status || '');
      if (action === 'reset-one') return await resetOne(container, actionEl.closest('[data-sp-row]'));
      if (action === 'reset-all') return await resetAll(container);
      if (action === 'delete-one') return await deleteOne(container, actionEl.closest('[data-sp-row]'));
      if (action === 'export-json') return await exportJson(container);
      if (action === 'import-merge') return startImport(container, 'merge');
      if (action === 'import-replace') return startImport(container, 'replace');
    } catch (err) {
      if (typeof showStatus === 'function') showStatus('操作に失敗: ' + (err?.message || err), true);
    }
  }

  function handleInput(container, event) {
    const addWeight = event.target.matches('[data-sp-add="taste_learning_weight"]');
    if (addWeight) {
      if (!canWrite(container)) return;
      const out = container.querySelector('[data-sp-add-weight]');
      if (out) out.textContent = Number(event.target.value || 0).toFixed(1);
      return;
    }
    const row = event.target.closest('[data-sp-row]');
    if (!row || !event.target.matches('[data-sp-field]')) return;
    if (!canWrite(container)) return;
    if (event.target.dataset.spField === 'status_value') return;
    if (event.target.dataset.spField === 'taste_learning_weight') {
      const out = row.querySelector('[data-sp-weight-output]');
      if (out) out.textContent = Number(event.target.value || 0).toFixed(1);
    }
    scheduleSave(container, row);
  }

  function handleChange(container, event) {
    const importFile = event.target.matches('[data-sp-import-file]');
    if (importFile) {
      if (!ensureCanWrite(container)) return;
      readImportFile(container, event.target);
      return;
    }
    if (event.target.matches('[data-sp-field]')) {
      if (!canWrite(container)) return;
      const row = event.target.closest('[data-sp-row]');
      if (row) scheduleSave(container, row);
    }
  }

  function selectPolicy(container, status) {
    const state = getState(container);
    state.selectedStatus = status;
    renderRows(container);
    renderPreview(container);
  }

  function collectRowPayload(row) {
    const payload = {
      original_status_value: row.dataset.status || '',
      expected_updated: row.dataset.updated || '',
    };
    row.querySelectorAll('[data-sp-field]').forEach(input => {
      const field = input.dataset.spField;
      if (input.type === 'checkbox') payload[field] = input.checked;
      else if (input.type === 'range') payload[field] = Number(input.value);
      else payload[field] = input.value;
    });
    return payload;
  }

  function validatePolicy(payload, state) {
    const status = String(payload.status_value || '').trim();
    if (!status) return 'ステータスを入力してください';
    if (status.length > 32) return 'ステータスは32文字以内にしてください';
    const color = String(payload.display_color || '').trim();
    if (!HEX_RE.test(color)) return '色は #rrggbb 形式で指定してください';
    const weight = Number(payload.taste_learning_weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 2) return '重みは0.0〜2.0で指定してください';
    if (String(payload.description || '').length > 200) return '説明は200文字以内にしてください';
    const duplicate = state.policies.some(item => item.status_value === status && item.status_value !== payload.original_status_value);
    if (duplicate) return '同じステータスが既にあります';
    return '';
  }

  function setRowMessage(row, message, isError) {
    const msg = row?.querySelector('[data-sp-row-message]');
    if (!msg) return;
    msg.textContent = message || '';
    msg.classList.toggle('is-error', !!isError);
  }

  function scheduleSave(container, row) {
    if (!canWrite(container)) return;
    const state = getState(container);
    const key = row.dataset.status || '';
    clearTimeout(state.timers.get(key));
    row.dataset.spSavePending = '1';
    state.timers.set(key, setTimeout(() => saveRow(container, row), 300));
  }

  async function saveRow(container, row) {
    if (!ensureCanWrite(container)) return;
    const state = getState(container);
    const key = row.dataset.status || '';
    if (state.saving.has(key)) {
      row.dataset.spSavePending = '1';
      return;
    }
    state.timers.delete(key);
    state.saving.add(key);
    row.dataset.spSavePending = '0';
    try {
      const payload = collectRowPayload(row);
      payload.display_color = row.querySelector('[data-sp-color]')?.dataset.color || row.querySelector('[data-sp-color]')?.textContent?.trim() || '#94a3b8';
      const validation = validatePolicy(payload, state);
      if (validation) {
        setRowMessage(row, validation, true);
        return;
      }
      setRowMessage(row, '保存中...', false);
      try {
        const index = state.policies.findIndex(item => item.status_value === payload.original_status_value);
        const oldUsage = index >= 0 ? usageFor(state.policies[index]) : {};
        const renamed = payload.status_value !== payload.original_status_value;
        if (renamed && Number(oldUsage.entry_count || 0) + Number(oldUsage.knowledge_item_count || 0) > 0) {
          const choice = await spChoiceDialog(
            'ステータス名の変更確認',
            `「${payload.original_status_value}」は使用中です。既存エントリと記憶項目のステータス値は変更されず、旧ステータスは未登録として表示されます。続けますか？`,
            [
              { value: 'apply', label: '変更する', primary: true },
              { value: '', label: 'キャンセル' },
            ],
          );
          if (choice !== 'apply') {
            await loadPolicies(container);
            selectPolicy(container, payload.original_status_value);
            return;
          }
        }
        const res = await spApi('/status_policies', { method: 'POST', body: JSON.stringify(payload) });
        const saved = res.policy;
        if (renamed) {
          await loadPolicies(container);
          selectPolicy(container, saved.status_value);
          return;
        }
        if (index >= 0) state.policies[index] = { ...saved, usage: oldUsage };
        row.dataset.status = saved.status_value;
        row.dataset.updated = saved.updated || '';
        state.selectedStatus = saved.status_value;
        setRowMessage(row, '保存済み', false);
        renderPreview(container);
      } catch (err) {
        if (err.status === 409) {
          setRowMessage(row, '他のウィンドウで変更されました', true);
          await loadPolicies(container);
        } else {
          setRowMessage(row, err.message, true);
        }
      }
    } finally {
      state.saving.delete(key);
      if (row.isConnected && row.dataset.spSavePending === '1') scheduleSave(container, row);
    }
  }

  function showAddForm(container, statusValue) {
    if (!ensureCanWrite(container)) return;
    const form = container.querySelector('[data-sp-add-form]');
    if (!form) return;
    form.hidden = false;
    form.querySelector('[data-sp-add="status_value"]').value = statusValue || '';
    form.querySelector('[data-sp-add="display_label"]').value = statusValue || '';
    form.querySelector('[data-sp-add="description"]').value = '';
    form.querySelector('[data-sp-add="taste_learning_weight"]').value = '1';
    form.querySelector('[data-sp-add-weight]').textContent = '1.0';
    form.querySelector('[data-sp-add-message]').textContent = '';
    form.querySelectorAll('[data-sp-add]').forEach((input) => {
      if (input.type === 'checkbox') input.checked = DEFAULT_ADD_BOOL_FIELDS.has(input.dataset.spAdd);
    });
    setAddColor(form, '#94a3b8');
    form.querySelector('[data-sp-add="status_value"]').focus();
  }

  function hideAddForm(container) {
    const form = container.querySelector('[data-sp-add-form]');
    if (form) form.hidden = true;
  }

  function setAddColor(form, color) {
    const btn = form.querySelector('[data-sp-add-color]');
    if (!btn) return;
    btn.dataset.color = color;
    btn.style.setProperty('--sp-color', color);
    btn.lastChild.nodeValue = color;
  }

  async function submitAddForm(container) {
    if (!ensureCanWrite(container)) return;
    const state = getState(container);
    const form = container.querySelector('[data-sp-add-form]');
    if (!form) return;
    const payload = {};
    form.querySelectorAll('[data-sp-add]').forEach(input => {
      const key = input.dataset.spAdd;
      if (input.type === 'checkbox') payload[key] = input.checked;
      else if (input.type === 'range') payload[key] = Number(input.value);
      else payload[key] = input.value;
    });
    payload.display_color = form.querySelector('[data-sp-add-color]')?.dataset.color || '#94a3b8';
    payload.original_status_value = payload.status_value;
    const msg = form.querySelector('[data-sp-add-message]');
    const validation = validatePolicy(payload, state);
    if (validation) {
      if (msg) msg.textContent = validation;
      return;
    }
    try {
      await spApi('/status_policies', { method: 'POST', body: JSON.stringify(payload) });
      hideAddForm(container);
      await loadPolicies(container);
      selectPolicy(container, payload.status_value);
      if (typeof showStatus === 'function') showStatus('ステータスポリシーを追加しました');
    } catch (err) {
      if (msg) msg.textContent = err.message;
    }
  }

  async function resetOne(container, row) {
    if (!ensureCanWrite(container)) return;
    if (!row) return;
    const status = row.dataset.status || '';
    const ok = typeof cfConfirm === 'function'
      ? await cfConfirm(`「${status}」を初期値に戻しますか？`)
      : window.confirm(`「${status}」を初期値に戻しますか？`);
    if (!ok) return;
    await spApi('/status_policies/reset', { method: 'POST', body: JSON.stringify({ status_value: status }) });
    await loadPolicies(container);
  }

  async function resetAll(container) {
    if (!ensureCanWrite(container)) return;
    const ok = typeof cfConfirm === 'function'
      ? await cfConfirm('全プリセットを初期値に戻しますか？カスタムステータスは保持されます。')
      : window.confirm('全プリセットを初期値に戻しますか？カスタムステータスは保持されます。');
    if (!ok) return;
    await spApi('/status_policies/reset', { method: 'POST', body: JSON.stringify({ all: true }) });
    await loadPolicies(container);
  }

  async function deleteOne(container, row) {
    if (!ensureCanWrite(container)) return;
    if (!row) return;
    const status = row.dataset.status || '';
    const usage = await spApi('/status_policies/usage/' + encodeURIComponent(status));
    const entryCount = Number(usage.entry_count || 0);
    const knowledgeCount = Number(usage.knowledge_item_count || 0);
    const count = entryCount + knowledgeCount;
    const choice = await spChoiceDialog(
      'ステータスポリシーの削除',
      count > 0
        ? `「${status}」は現在 エントリ${entryCount}件 / 記憶項目${knowledgeCount}件で使用中です。既存参照を「(未設定)」に置換してから削除するか、ポリシーだけ削除できます。`
        : `「${status}」を削除しますか？`,
      count > 0
        ? [
            { value: 'replace', label: '置換して削除', primary: true, action: () => spApi('/status_policies/' + encodeURIComponent(status) + '?replace_with_unset=true', { method: 'DELETE' }) },
            { value: 'keep', label: 'ポリシーだけ削除', action: () => spApi('/status_policies/' + encodeURIComponent(status) + '?replace_with_unset=false', { method: 'DELETE' }) },
            { value: '', label: 'キャンセル' },
          ]
        : [
            { value: 'keep', label: '削除', danger: true, action: () => spApi('/status_policies/' + encodeURIComponent(status) + '?replace_with_unset=false', { method: 'DELETE' }) },
            { value: '', label: 'キャンセル' },
          ],
    );
    if (!choice) return;
    await loadPolicies(container);
  }

  function startImport(container, mode) {
    if (!ensureCanWrite(container)) return;
    container.dataset.spImportMode = mode;
    const input = container.querySelector('[data-sp-import-file]');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async function readImportFile(container, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const mode = container.dataset.spImportMode || 'merge';
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await previewAndApplyImport(container, payload, mode);
    } catch (err) {
      if (typeof showStatus === 'function') showStatus('JSON読み込みに失敗: ' + err.message, true);
    }
  }

  async function previewAndApplyImport(container, payload, mode) {
    if (!ensureCanWrite(container)) return;
    const policies = Array.isArray(payload?.policies) ? payload.policies : [];
    if (!policies.length) throw new Error('policies 配列が見つかりません');
    const current = new Map(getState(container).policies.map(item => [item.status_value, item]));
    const added = [];
    const updated = [];
    policies.forEach(item => {
      const old = current.get(item.status_value);
      if (!old) added.push(item.status_value);
      else if (JSON.stringify({ ...old, id: undefined, created: undefined, updated: undefined, usage: undefined }) !== JSON.stringify({ ...item, id: undefined, created: undefined, updated: undefined, usage: undefined })) updated.push(item.status_value);
    });
    const choice = await spChoiceDialog(
      mode === 'replace' ? '全置換インポート確認' : '追加インポート確認',
      `新規 ${added.length} 件、更新 ${updated.length} 件を読み込みます。${mode === 'replace' ? 'カスタムステータスは一度削除されます。' : '既存と重複するステータスは更新されます。'}`,
      [
        { value: 'apply', label: '適用', primary: true },
        { value: '', label: 'キャンセル' },
      ],
    );
    if (choice !== 'apply') return;
    await spApi('/status_policies/import', { method: 'POST', body: JSON.stringify({ mode, payload }) });
    await loadPolicies(container);
  }

  async function exportJson() {
    const payload = await spApi('/status_policies/export');
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Meldex_status_policies.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleDragStart(container, event) {
    if (!canWrite(container)) {
      event.preventDefault();
      return;
    }
    const handle = event.target.closest('[data-sp-drag-handle]');
    if (!handle) return;
    event.dataTransfer.setData('text/plain', handle.dataset.status || '');
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(event) {
    if (event.target.closest('[data-sp-row]')) event.preventDefault();
  }

  async function handleDrop(container, event) {
    if (!ensureCanWrite(container)) return;
    const row = event.target.closest('[data-sp-row]');
    if (!row) return;
    event.preventDefault();
    const from = event.dataTransfer.getData('text/plain');
    const to = row.dataset.status;
    if (!from || !to || from === to) return;
    const state = getState(container);
    const fromIndex = state.policies.findIndex(item => item.status_value === from);
    const toIndex = state.policies.findIndex(item => item.status_value === to);
    if (fromIndex < 0 || toIndex < 0) return;
    const [item] = state.policies.splice(fromIndex, 1);
    state.policies.splice(toIndex, 0, item);
    state.policies.forEach((policy, index) => { policy.sort_order = (index + 1) * 10; });
    renderRows(container);
    let failed = null;
    for (const policy of state.policies) {
      try {
        await spApi('/status_policies', {
          method: 'POST',
          body: JSON.stringify({ ...policy, original_status_value: policy.status_value, expected_updated: policy.updated || '' }),
        });
      } catch (err) {
        failed = err;
        break;
      }
    }
    await loadPolicies(container);
    if (failed && typeof showStatus === 'function') showStatus('並び替えの保存に失敗: ' + failed.message, true);
  }

  function handleColorButton(container, button, row) {
    if (!ensureCanWrite(container)) return;
    const current = button.dataset.color || button.textContent.trim() || '#94a3b8';
    if (typeof openColorPalette !== 'function') return;
    openColorPalette(button, current, color => {
      const next = HEX_RE.test(color) ? color.toLowerCase() : current;
      button.dataset.color = next;
      button.style.setProperty('--sp-color', next);
      button.lastChild.nodeValue = next;
      if (row) scheduleSave(container, row);
    });
  }

  function handleAddColor(form) {
    const container = form?.closest('.status-policies-view');
    if (!container || !ensureCanWrite(container)) return;
    const button = form.querySelector('[data-sp-add-color]');
    if (!button || typeof openColorPalette !== 'function') return;
    openColorPalette(button, button.dataset.color || '#94a3b8', color => setAddColor(form, HEX_RE.test(color) ? color.toLowerCase() : '#94a3b8'));
  }

  document.addEventListener('click', event => {
    const colorButton = event.target.closest('.status-policies-view [data-sp-color]');
    if (colorButton) {
      const container = colorButton.closest('.status-policies-view');
      handleColorButton(container, colorButton, colorButton.closest('[data-sp-row]'));
      return;
    }
    const addColorButton = event.target.closest('.status-policies-view [data-sp-add-color]');
    if (addColorButton) handleAddColor(addColorButton.closest('[data-sp-add-form]'));
  });

  function spChoiceDialog(title, message, choices) {
    return new Promise(resolve => {
      const p = document.createElement('p');
      p.textContent = message;
      const status = document.createElement('div');
      status.className = 'gb-section-desc sp-choice-status';
      status.dataset.e2eId = 'status-policy-choice-status';
      status.hidden = true;
      const row = document.createElement('div');
      row.className = 'btn-row';
      let selected = '';
      let dialog = null;
      let busy = false;
      choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = choice.label;
        btn.dataset.spChoice = String(choice.value || '');
        btn.dataset.e2eId = 'status-policy-choice-' + (String(choice.value || 'cancel').replace(/[^a-z0-9_-]+/gi, '-'));
        if (choice.primary) btn.className = 'primary';
        if (choice.danger) btn.className = 'danger';
        btn.addEventListener('click', async () => {
          if (busy) return;
          if (typeof choice.action !== 'function') {
            selected = choice.value;
            dialog.close('complete');
            return;
          }
          busy = true;
          dialog.overlay.setAttribute('aria-busy', 'true');
          dialog.footer.querySelectorAll('button').forEach(button => { button.disabled = true; });
          const closeButton = dialog.header.querySelector('.gb-modal-close');
          if (closeButton) closeButton.disabled = true;
          status.hidden = true;
          status.textContent = '';
          try {
            await choice.action();
            selected = choice.value;
            dialog.close('complete');
          } catch (error) {
            status.textContent = '操作に失敗しました: ' + (error?.message || error);
            status.hidden = false;
          } finally {
            busy = false;
            dialog.overlay.setAttribute('aria-busy', 'false');
            dialog.footer.querySelectorAll('button').forEach(button => { button.disabled = false; });
            if (closeButton) closeButton.disabled = false;
          }
        });
        row.appendChild(btn);
      });
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog = window.GBUI.createModal({
        id: 'status-policy-choice-dialog',
        title,
        body: [p, status],
        footer: Array.from(row.children),
        variant: 'standard',
        extraClass: 'sp-choice-dialog',
        geometryKey: 'status-policy-choice-dialog',
        minWidth: '0',
        initialFocus: () => dialog.footer.querySelector('button:not([disabled])'),
        returnFocus: opener,
        onBeforeClose: reason => !busy || reason === 'complete',
        onClose: () => resolve(selected),
      });
      dialog.overlay.classList.add('modal-overlay');
      dialog.overlay.dataset.statusPolicyChoice = '1';
      dialog.overlay.dataset.e2eId = 'status-policy-choice-overlay';
      dialog.modal.classList.add('gb-confirm');
      dialog.modal.dataset.e2eId = 'status-policy-choice-dialog';
      dialog.footer.classList.add('btn-row');
      const commonClose = dialog.header.querySelector('.gb-modal-close');
      if (commonClose) commonClose.dataset.e2eId = 'status-policy-choice-close';
      dialog.open();
    });
  }

  window.openStatusPoliciesView = async function openStatusPoliciesView(container) {
    if (!container) return;
    renderShell(container);
    await loadPolicies(container);
  };
})();
