// gb-import-schedule-settings.js — インポート定期実行の共通設定UI（周期・次回予定・前回結果）。
// WebClipper・インポート定期実行計画 2026-08-04「インターフェース」節で実装。
//
// Notion同期・Xブックマーク・外部取り込みセットの各設定画面は、それぞれの場所で
// 周期を編集できる（gb-notion-sync.js / gb-settings-x-bookmarks.js /
// gb-external-import.js。いずれも /api/import-schedules へ書き込みが委譲される）。
// 本モジュールは、それらを横断する「インポート予定」一覧を1画面にまとめ、
// 他の設定画面にUIを持たないXアカウント投稿の定期実行もここから登録できるように
// する（Meldex.html の編集はレーン外のため、既存の外部取り込み設定画面の末尾へ
// ランタイムでマウントする）。
(function () {
  'use strict';

  const CATEGORY_LABELS = {
    'notion-sync': 'Notion同期',
    'x-bookmarks': 'Xブックマーク',
    'x-account-posts': 'Xアカウント投稿',
    'external-import-set': '外部取り込み',
  };

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function apiReady() {
    return typeof apiFetch === 'function' && typeof apiPost === 'function';
  }

  function isCloudStaticScheduleSurface() {
    return window.MeldexRuntimeAdapter?.isPwaMode?.()
      || ['browser', 'dropbox', 'server'].includes(document.body?.dataset?.cloudMode || '');
  }

  async function confirmAction(message) {
    if (typeof cfConfirm === 'function') return await cfConfirm(message, { danger: true, okLabel: '削除' });
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') return window.confirm(message);
    return false;
  }

  function categoryLabel(category) {
    return CATEGORY_LABELS[category] || category;
  }

  function statusLine(entry) {
    const parts = [];
    if (entry.next_run_display) parts.push(`次回予定: ${entry.next_run_display}`);
    else if (entry.enabled === false) parts.push('手動のみ');
    if (entry.last_run) {
      const label = entry.last_run.status === 'done' ? '成功'
        : (entry.last_run.status === 'error' ? '失敗' : entry.last_run.status);
      parts.push(`前回: ${label}`);
    } else {
      parts.push('前回: なし');
    }
    if (entry.needs_reselect) parts.push('元ファイルが見つからないため停止中。再選択が必要です。');
    else if (entry.needs_attention) parts.push('連続で失敗しています。');
    return parts.join(' / ');
  }

  async function loadSchedules() {
    if (!apiReady()) return [];
    const data = await apiFetch('/import-schedules', { silentError: true });
    return Array.isArray(data?.schedules) ? data.schedules : [];
  }

  function textEl(tag, text, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text || '';
    return el;
  }

  function renderEntryCard(entry, onChanged) {
    const card = document.createElement('div');
    card.className = 'gb-section gb-section--boxed';
    card.style.marginTop = '8px';
    const stableId = String(entry.id).replace(/[^a-zA-Z0-9_-]+/g, '-');
    card.dataset.e2eId = `import-schedule-card-${stableId}`;

    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.textContent = `${categoryLabel(entry.category)}: ${entry.label || entry.id}`;
    card.appendChild(title);

    const status = textEl('div', statusLine(entry), 'gb-section-desc');
    status.dataset.e2eId = `import-schedule-status-${stableId}`;
    card.appendChild(status);

    const schedContainer = document.createElement('div');
    schedContainer.className = 'gb-section gb-section--boxed';
    schedContainer.style.cssText = 'margin-top:6px;padding:8px;';
    schedContainer.dataset.e2eId = `import-schedule-widget-${stableId}`;
    card.appendChild(schedContainer);

    if (window.MeldexScheduler) {
      window.MeldexScheduler.createWidget(schedContainer, entry.period, async (cfg) => {
        await savePeriod(entry, cfg);
        onChanged();
      });
    }

    const row = document.createElement('div');
    row.className = 'gb-field-row';
    row.style.justifyContent = 'flex-start';
    row.style.flexWrap = 'wrap';
    row.style.marginTop = '6px';

    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = 'gb-btn gb-btn-sm';
    runBtn.innerHTML = icon('play', 14) + ' 今すぐ実行';
    runBtn.dataset.e2eId = `import-schedule-run-${stableId}`;
    runBtn.setAttribute('aria-label', `${entry.label || entry.id}を今すぐ実行`);
    runBtn.addEventListener('click', async () => {
      runBtn.disabled = true;
      try {
        await apiPost(`/import-schedules/${encodeURIComponent(entry.id)}/run`, {}, { silentError: true });
        await window.MeldexImportProgress?.poll?.();
        status.textContent = '実行を開始しました。進み具合は画面の処理パネルで確認できます。';
      } catch (err) {
        status.textContent = '実行を開始できませんでした: ' + (err.userMessage || err.message || err);
      } finally {
        runBtn.disabled = false;
      }
    });
    row.appendChild(runBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'gb-btn gb-btn-sm gb-btn-danger';
    deleteBtn.innerHTML = icon('trash2', 14) + ' 定期実行を削除';
    deleteBtn.dataset.e2eId = `import-schedule-delete-${stableId}`;
    deleteBtn.setAttribute('aria-label', `${entry.label || entry.id}の定期実行設定を削除`);
    deleteBtn.addEventListener('click', async () => {
      const ok = await confirmAction('この定期実行の設定を削除しますか？\n取り込み済みのデータは削除しません。');
      if (!ok) return;
      try {
        await apiFetch(`/import-schedules/${encodeURIComponent(entry.id)}`, { method: 'DELETE', silentError: true });
        onChanged();
      } catch (err) {
        status.textContent = '削除できませんでした: ' + (err.userMessage || err.message || err);
      }
    });
    row.appendChild(deleteBtn);
    card.appendChild(row);

    return card;
  }

  async function savePeriod(entry, period) {
    try {
      await apiPost(`/import-schedules/${encodeURIComponent(entry.id)}`, { period }, { method: 'PATCH', silentError: true });
    } catch (err) {
      if (err && err.status === 400 && entry.category === 'x-account-posts') {
        // 料金確認ゲート: 未承諾のまま有効化しようとした場合
        window.__gbImportScheduleCostNoticeError = err.userMessage || err.message || String(err);
      }
    }
  }

  function renderAddAccountPostsForm(container, onAdded) {
    const section = document.createElement('section');
    section.className = 'gb-section gb-section--boxed';
    section.dataset.e2eId = 'import-schedule-add-x-account-posts';

    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.innerHTML = `${icon('atSign', 14)} Xアカウント投稿の定期保存を追加`;
    section.appendChild(title);

    // 同意・料金に関わる開示はツールチップへ隠しきらず、可視のまま残す
    // （UI共通ルール: 同意・プライバシーに関わる開示は短い1文を可視で残す）。
    section.appendChild(textEl(
      'div',
      'X APIの利用量に応じて料金が発生する場合があります。定期実行は既定で無効です。',
      'gb-section-desc'
    ));

    const row = document.createElement('div');
    row.className = 'gb-field-row';
    row.style.flexWrap = 'wrap';

    const usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.className = 'gb-input';
    usernameInput.placeholder = '@ユーザー名';
    usernameInput.setAttribute('aria-label', 'Xのユーザー名');
    usernameInput.dataset.e2eId = 'import-schedule-x-account-username';
    row.appendChild(usernameInput);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'gb-btn gb-btn-sm';
    addBtn.innerHTML = icon('plus', 14) + ' 追加';
    addBtn.dataset.e2eId = 'import-schedule-x-account-add';
    row.appendChild(addBtn);

    const message = textEl('div', '', 'gb-section-desc');
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');

    addBtn.addEventListener('click', async () => {
      const username = usernameInput.value.trim().replace(/^@/, '');
      if (!username) {
        message.textContent = 'ユーザー名を入力してください。';
        return;
      }
      const existing = await loadSchedules();
      if (existing.some((entry) => entry.category === 'x-account-posts'
        && String(entry.target_ref?.username || '').toLowerCase() === username.toLowerCase())) {
        message.textContent = `@${username} はすでに一覧にあります。`;
        return;
      }
      addBtn.disabled = true;
      try {
        await apiPost('/import-schedules', {
          category: 'x-account-posts',
          target_ref: { username },
          label: `@${username}`,
          period: { type: 'off' },
        }, { silentError: true });
        usernameInput.value = '';
        message.textContent = '追加しました。定期実行はOFFです。';
        onAdded();
      } catch (err) {
        message.textContent = '追加できませんでした: ' + (err.userMessage || err.message || err);
      } finally {
        addBtn.disabled = false;
      }
    });

    section.appendChild(row);
    section.appendChild(message);
    container.appendChild(section);
  }

  async function refresh(root) {
    const list = root.querySelector('.import-schedule-list');
    if (!list) return;
    list.textContent = '読み込み中...';
    try {
      const schedules = await loadSchedules();
      list.textContent = '';
      if (!schedules.length) {
        list.appendChild(textEl('div', '定期実行はまだ設定されていません。', 'gb-section-desc'));
        return;
      }
      schedules.forEach((entry) => {
        list.appendChild(renderEntryCard(entry, () => refresh(root)));
      });
    } catch (err) {
      list.textContent = '';
      list.appendChild(textEl('div', '取得できませんでした: ' + (err.userMessage || err.message || err), 'gb-section-desc'));
    }
  }

  // render()/mount() は呼び出しのたびに一覧を再取得する（初回はDOM構築込み、
  // 2回目以降は既存のセクションへ refresh() のみ行う）。返り値は一覧の取得・
  // 描画が完了する Promise なので、呼び出し側は await して完了を待てる
  // （設定画面を開くたびに新しい定期実行が反映され、E2E等からも
  // 「カードが描画され終わっているか」を確実に待てるようにするため）。
  function render(container) {
    if (!container) return Promise.resolve();
    if (isCloudStaticScheduleSurface()) {
      container.querySelector('[data-e2e-id="import-schedule-settings-root"]')?.remove();
      delete container.dataset.importScheduleMounted;
      return Promise.resolve();
    }
    if (container.dataset.importScheduleMounted === '1') {
      const existing = container.querySelector('[data-e2e-id="import-schedule-settings-root"]');
      return existing ? refresh(existing) : Promise.resolve();
    }
    container.dataset.importScheduleMounted = '1';
    const section = document.createElement('section');
    section.className = 'gb-section gb-section--boxed';
    section.dataset.e2eId = 'import-schedule-settings-root';
    section.style.marginTop = '12px';
    section.innerHTML = `
      <div class="gb-section-title">${icon('calendarClock', 14)} インポート予定（定期実行）</div>
      <div class="gb-section-desc">Notion同期・Xブックマーク・外部取り込みの定期実行をまとめて確認・変更できます。定期実行は既定で無効です。</div>
    `;
    container.appendChild(section);

    renderAddAccountPostsForm(section, () => refresh(section));

    const list = document.createElement('div');
    list.className = 'import-schedule-list';
    list.dataset.e2eId = 'import-schedule-list';
    section.appendChild(list);

    return refresh(section);
  }

  // 既存の外部取り込み設定画面の末尾へランタイムでマウントする
  // （Meldex.html/Meldex-dev.html への新規コンテナ追加はレーン外のため）。
  function mount(hostContainerId) {
    const host = document.getElementById(hostContainerId || 'external-import-settings-container');
    return host ? render(host) : Promise.resolve();
  }

  window.MeldexImportScheduleSettings = { render, mount, refresh, isCloudStaticScheduleSurface };
})();
