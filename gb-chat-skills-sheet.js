/* gb-chat-skills-sheet.js
 * スキル管理パネル（一覧・作成・編集・削除）
 * サーバー側の隠しフォルダに保存される、再利用可能なチャット向け指示（スキル）を、
 * カスタムインストラクションと同じ操作感（モーダル + フォーム）で管理できるようにする。
 * バックエンド: GET/POST/PUT/DELETE /skills, GET /skills/detail（source_folder スコープ）
 */
(function () {
  'use strict';

  const state = {
    overlay: null,
    modalApi: null,
    restoreFocus: null,
    view: 'list', // 'list' | 'form'
    items: [],
    loadError: '',
    form: null,
  };

  function skEsc(value) {
    return MeldexEscape.html(value);
  }

  function skIcon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  // CLIチャット/カスタムインストラクションと同じ経路で「現在のソースフォルダ」を取得する
  function skSourceFolder() {
    return typeof _chatSourceFolderValue === 'function' ? String(_chatSourceFolderValue() || '') : '';
  }

  function skConfirm(message) {
    if (typeof cfConfirm === 'function') return cfConfirm(message);
    return Promise.resolve(window.confirm(message));
  }

  // triggers はサーバーから配列 or 改行区切り文字列のどちらでも返り得るため、常に配列へ正規化する
  function skTriggersToArray(value) {
    if (Array.isArray(value)) return value.map(v => String(v ?? '').trim()).filter(Boolean);
    return String(value || '').split('\n').map(v => v.trim()).filter(Boolean);
  }

  function skTriggersToTextareaValue(value) {
    return skTriggersToArray(value).join('\n');
  }

  function skTriggerPillsHtml(triggers) {
    const list = skTriggersToArray(triggers);
    if (!list.length) return '';
    const shown = list.slice(0, 3);
    const restCount = list.length - shown.length;
    const pills = shown.map(t => `<span class="gb-pill">${skEsc(t)}</span>`).join('');
    const more = restCount > 0 ? `<span class="gb-pill">+${restCount}</span>` : '';
    return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${pills}${more}</div>`;
  }

  /* ---------- モーダルの開閉 ---------- */

  function closeSkillsModal(reason = 'programmatic') {
    if (state.modalApi?.isOpen?.()) return state.modalApi.close(reason);
    return false;
  }

  function ensureSkillsModal() {
    if (state.modalApi?.isOpen?.()) return state.overlay;
    if (typeof window.GBUI?.createModal !== 'function') {
      throw new Error('共通ダイアログを初期化できませんでした。');
    }
    state.restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.createElement('div');
    root.id = 'skills-panel-root';
    root.className = 'gb-chat-skills-root';
    root.dataset.skRoot = '';
    const modalApi = window.GBUI.createModal({
      id: 'chat-skills',
      title: 'スキル',
      body: root,
      variant: 'mobile-sheet',
      extraClass: 'gb-chat-skills-modal',
      geometryKey: 'chat-skills',
      initialFocus: '[data-e2e-id="skills-panel-close"]',
      returnFocus: state.restoreFocus || undefined,
      closeOnEsc: true,
      closeOnOverlay: true,
      onBeforeClose: () => !state.form?.saving,
      onClose: () => {
        if (state.modalApi !== modalApi) return;
        state.overlay = null;
        state.modalApi = null;
        state.restoreFocus = null;
      },
    });
    modalApi.overlay.classList.add('modal-overlay', 'gb-chat-skills-overlay');
    modalApi.overlay.dataset.chatSkillsModal = '1';
    modalApi.overlay.dataset.e2eId = 'skills-panel-overlay';
    modalApi.modal.dataset.e2eId = 'skills-panel-dialog';
    const title = modalApi.header.querySelector('.gb-modal-title');
    if (title) title.dataset.skTitle = '';
    const closeButton = modalApi.header.querySelector('.gb-modal-close');
    if (closeButton) {
      closeButton.id = 'skills-panel-close';
      closeButton.dataset.skClose = '';
      closeButton.dataset.e2eId = 'skills-panel-close';
    }
    state.overlay = modalApi.overlay;
    state.modalApi = modalApi;
    modalApi.open();
    return modalApi.overlay;
  }

  /* ---------- 描画: 一覧 / フォームの切り替え ---------- */

  function renderRoot() {
    const root = state.overlay?.querySelector('[data-sk-root]');
    if (!root) return;
    const titleEl = state.overlay.querySelector('[data-sk-title]');
    if (state.view === 'form') {
      if (titleEl) titleEl.textContent = state.form?.mode === 'edit' ? 'スキルを編集' : '新規スキルを作成';
      renderFormView(root);
    } else {
      if (titleEl) titleEl.textContent = 'スキル';
      renderListView(root);
    }
  }

  function renderListView(root) {
    root.innerHTML = `
      <section class="gb-section gb-section--boxed" style="margin-bottom:10px;">
        <div class="gb-field-row" style="justify-content:space-between;">
          <div class="gb-section-desc" style="margin:0;">チャットが話題に応じて自動で参照する指示をまとめます ${fieldHelp('名前・説明・トリガー・本文で1つのスキルを構成します。依頼内容が説明やトリガーに合う時だけ、チャットが本文を読み込んで参照します', { e2eId: 'skills-overview-help' })}</div>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-primary" data-sk-create data-e2e-id="skills-create">${skIcon('plus', 14)} 新規作成</button>
        </div>
      </section>
      <div data-sk-alert aria-live="polite"></div>
      <div data-sk-list data-e2e-id="skills-list"><div class="gb-section-desc">読み込み中...</div></div>
    `;
    root.querySelector('[data-sk-create]')?.addEventListener('click', () => openCreateForm());
    loadSkillsList(root);
  }

  async function loadSkillsList(root) {
    const listEl = root.querySelector('[data-sk-list]');
    const alertEl = root.querySelector('[data-sk-alert]');
    if (!listEl) return;
    const sourceFolder = skSourceFolder();
    if (!sourceFolder) {
      state.items = [];
      state.loadError = '';
      if (alertEl) alertEl.innerHTML = '<div class="gb-section-desc">フォルダツリーで対象フォルダを選択すると、そのフォルダのスキルを表示できます。</div>';
      listEl.innerHTML = '';
      return;
    }
    if (alertEl) alertEl.innerHTML = '';
    listEl.innerHTML = '<div class="gb-section-desc">読み込み中...</div>';
    try {
      const res = await apiFetch('/skills?source_folder=' + encodeURIComponent(sourceFolder));
      state.items = Array.isArray(res?.skills) ? res.skills : [];
      state.loadError = '';
    } catch (err) {
      state.items = [];
      state.loadError = String(err?.message || err || '読み込みに失敗しました');
    }
    // 読み込み中に閉じられている/別画面に移動している場合は反映しない
    if (state.view !== 'list' || !root.isConnected) return;
    renderSkillRows(root);
  }

  function renderSkillRows(root) {
    const listEl = root.querySelector('[data-sk-list]');
    const alertEl = root.querySelector('[data-sk-alert]');
    if (!listEl) return;
    if (state.loadError && alertEl) {
      alertEl.innerHTML = `<div class="gb-section-desc" style="color:var(--red);">読み込みに失敗しました: ${skEsc(state.loadError)}</div>`;
    }
    if (!state.items.length) {
      listEl.innerHTML = state.loadError ? '' : '<div class="gb-section-desc">スキルはまだありません。「新規作成」から追加できます。</div>';
      return;
    }
    listEl.innerHTML = state.items.map((item, index) => `
      <div class="gb-skills-row" data-sk-index="${index}" style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;background:var(--bg2);">
        <div style="min-width:0;flex:1;">
          <div style="font-weight:600;overflow-wrap:anywhere;">${skEsc(item.name)}</div>
          ${item.description ? `<div style="color:var(--fg2);font-size:12px;margin-top:2px;overflow-wrap:anywhere;">${skEsc(item.description)}</div>` : ''}
          ${skTriggerPillsHtml(item.triggers)}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button type="button" class="gb-btn gb-btn-sm" data-sk-edit data-e2e-id="skills-row-edit-${index}" aria-label="スキル「${skEsc(item.name)}」を編集">${skIcon('pencil', 14)} 編集</button>
          <button type="button" class="gb-btn gb-btn-sm gb-btn-danger" data-sk-delete data-e2e-id="skills-row-delete-${index}" aria-label="スキル「${skEsc(item.name)}」を削除">${skIcon('trash2', 14)} 削除</button>
        </div>
      </div>
    `).join('');
    listEl.querySelectorAll('[data-sk-index]').forEach(row => {
      const idx = Number(row.dataset.skIndex);
      const item = state.items[idx];
      if (!item) return;
      row.querySelector('[data-sk-edit]')?.addEventListener('click', () => openEditForm(item));
      row.querySelector('[data-sk-delete]')?.addEventListener('click', () => confirmDeleteSkill(item));
    });
  }

  /* ---------- 作成・編集フォーム ---------- */

  function openCreateForm() {
    state.view = 'form';
    state.form = {
      mode: 'create',
      originalName: '',
      name: '',
      description: '',
      triggersText: '',
      body: '',
      truncated: false,
      loadingDetail: false,
      saving: false,
    };
    renderRoot();
  }

  async function openEditForm(item) {
    const sourceFolder = skSourceFolder();
    if (!sourceFolder) {
      showStatus('フォルダツリーで対象フォルダを選択してください', true);
      return;
    }
    state.view = 'form';
    state.form = {
      mode: 'edit',
      originalName: item.name,
      name: item.name,
      description: item.description || '',
      triggersText: skTriggersToTextareaValue(item.triggers),
      body: '',
      truncated: false,
      loadingDetail: true,
      saving: false,
    };
    renderRoot();
    try {
      const res = await apiFetch('/skills/detail?source_folder=' + encodeURIComponent(sourceFolder) + '&name=' + encodeURIComponent(item.name));
      // 読み込み中に別のスキルへ切り替えた/一覧へ戻った場合は結果を反映しない
      if (!state.form || state.form.mode !== 'edit' || state.form.originalName !== item.name) return;
      if (res?.error) {
        showStatus(res.error, true);
        state.view = 'list';
        state.form = null;
        renderRoot();
        return;
      }
      state.form.name = res.name || item.name;
      state.form.description = res.description || '';
      state.form.triggersText = skTriggersToTextareaValue(res.triggers);
      state.form.body = res.content || '';
      state.form.truncated = !!res.truncated;
      state.form.loadingDetail = false;
      renderRoot();
    } catch {
      if (!state.form || state.form.mode !== 'edit' || state.form.originalName !== item.name) return;
      state.form.loadingDetail = false;
      renderRoot();
    }
  }

  function renderFormView(root) {
    const form = state.form;
    if (!form) {
      state.view = 'list';
      renderListView(root);
      return;
    }
    const disabledAttr = (form.loadingDetail || form.saving) ? ' disabled' : '';
    const truncatedWarning = form.truncated
      ? '<div class="gb-section-desc" style="color:var(--red);margin-bottom:8px;">本文が長いため一部だけ読み込みました。このまま保存すると省略された内容は失われます。</div>'
      : '';
    root.innerHTML = `
      ${form.loadingDetail ? '<div class="gb-section-desc" style="margin-bottom:8px;">読み込み中...</div>' : ''}
      ${truncatedWarning}
      <div class="field gb-field">
        <label class="gb-label" for="sk-form-name">名前</label>
        <input id="sk-form-name" type="text" class="gb-input" data-e2e-id="skills-form-name" placeholder="例: プロット構成レビュー" value="${skEsc(form.name)}"${disabledAttr}>
      </div>
      <div class="field gb-field">
        <label class="gb-label" for="sk-form-description">説明 ${fieldHelp('どんな時に使うスキルかを短く書きます。チャットがこの説明を見て、本文を読み込むかどうかを判断します', { e2eId: 'skills-description-help' })}</label>
        <textarea id="sk-form-description" class="gb-textarea" rows="2" data-e2e-id="skills-form-description" placeholder="例: 長編プロットの構成をレビューするときの観点"${disabledAttr}>${skEsc(form.description)}</textarea>
      </div>
      <div class="field gb-field">
        <label class="gb-label" for="sk-form-triggers">トリガー ${fieldHelp('このスキルを参照してほしい話題やキーワードを1行に1つずつ入力します', { e2eId: 'skills-triggers-help' })}</label>
        <textarea id="sk-form-triggers" class="gb-textarea" rows="3" data-e2e-id="skills-form-triggers" placeholder="例:&#10;プロット&#10;構成レビュー"${disabledAttr}>${skEsc(form.triggersText)}</textarea>
      </div>
      <div class="field gb-field">
        <label class="gb-label" for="sk-form-body">本文 ${fieldHelp('チャットが参照する指示の本文です。Markdown形式で書けます', { e2eId: 'skills-body-help' })}</label>
        <textarea id="sk-form-body" class="gb-textarea" data-e2e-id="skills-form-body" style="min-height:280px;font-family:var(--font-mono, monospace);"${disabledAttr}>${skEsc(form.body)}</textarea>
      </div>
      <div class="gb-field-row" style="justify-content:flex-end;">
        <button type="button" class="gb-btn gb-btn-sm" data-sk-cancel data-e2e-id="skills-form-cancel"${disabledAttr}>キャンセル</button>
        <button type="button" class="gb-btn gb-btn-sm gb-btn-primary" data-sk-save data-e2e-id="skills-form-save"${disabledAttr}>${skIcon('check', 14)} 保存</button>
      </div>
    `;
    root.querySelector('[data-sk-cancel]')?.addEventListener('click', () => {
      state.view = 'list';
      state.form = null;
      renderRoot();
    });
    root.querySelector('[data-sk-save]')?.addEventListener('click', () => saveForm(root));
  }

  async function saveForm(root) {
    const form = state.form;
    if (!form || form.saving || form.loadingDetail) return;
    const nameInput = root.querySelector('#sk-form-name');
    const descInput = root.querySelector('#sk-form-description');
    const triggersInput = root.querySelector('#sk-form-triggers');
    const bodyInput = root.querySelector('#sk-form-body');
    const name = String(nameInput?.value || '').trim();
    if (!name) {
      showStatus('名前を入力してください', true);
      nameInput?.focus();
      return;
    }
    const sourceFolder = skSourceFolder();
    if (!sourceFolder) {
      showStatus('フォルダツリーで対象フォルダを選択してください', true);
      return;
    }
    const payload = {
      source_folder: sourceFolder,
      name,
      description: String(descInput?.value || '').trim(),
      triggers: skTriggersToArray(triggersInput?.value || ''),
      body: String(bodyInput?.value || ''),
    };
    form.saving = true;
    const saveBtn = root.querySelector('[data-sk-save]');
    const cancelBtn = root.querySelector('[data-sk-cancel]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.setAttribute('aria-busy', 'true'); }
    if (cancelBtn) cancelBtn.disabled = true;
    try {
      const res = form.mode === 'edit'
        ? await apiPut('/skills', { ...payload, original_name: form.originalName })
        : await apiPost('/skills', payload);
      if (res?.error) {
        showStatus(res.error, true);
      } else {
        showStatus(form.mode === 'edit' ? 'スキルを更新しました' : 'スキルを作成しました');
        state.view = 'list';
        state.form = null;
        renderRoot();
        return;
      }
    } catch {
      // apiPost/apiPut(= apiFetch) が失敗理由のトーストを既に表示している
    }
    form.saving = false;
    if (saveBtn?.isConnected) { saveBtn.disabled = false; saveBtn.removeAttribute('aria-busy'); }
    if (cancelBtn?.isConnected) cancelBtn.disabled = false;
  }

  async function confirmDeleteSkill(item) {
    const ok = await skConfirm(`スキル「${item.name}」を削除しますか？`);
    if (!ok) return;
    const sourceFolder = skSourceFolder();
    if (!sourceFolder) {
      showStatus('フォルダツリーで対象フォルダを選択してください', true);
      return;
    }
    try {
      const res = await apiFetch(
        '/skills?name=' + encodeURIComponent(item.name) + '&source_folder=' + encodeURIComponent(sourceFolder),
        { method: 'DELETE' }
      );
      if (res?.error) {
        showStatus(res.error, true);
        return;
      }
      showStatus('スキルを削除しました');
    } catch {
      return; // apiFetch が失敗理由のトーストを既に表示している
    }
    const root = state.overlay?.querySelector('[data-sk-root]');
    if (root && state.view === 'list') loadSkillsList(root);
  }

  /* ---------- 公開API ---------- */

  function ensureChatSkillsSheet() {
    ensureSkillsModal();
    state.view = 'list';
    state.form = null;
    renderRoot();
    return state.overlay;
  }

  window.ensureChatSkillsSheet = ensureChatSkillsSheet;
  window.GBChatSkills = { open: ensureChatSkillsSheet };
})();
