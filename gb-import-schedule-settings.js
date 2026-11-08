// gb-import-schedule-settings.js — インポート定期実行の共通設定UI（周期・次回予定・前回結果）。
// WebClipper・インポート定期実行計画 2026-08-04「インターフェース」節で実装。
//
// Notion同期・Xブックマーク・外部取り込みセットの各設定画面は、それぞれの場所で
// 周期を編集できる（gb-notion-sync.js / gb-settings-x-bookmarks.js /
// gb-external-import.js。いずれも /api/import-schedules へ書き込みが委譲される）。
// 本モジュールはWeb Clipperの設定内にWeb受信箱の周期・実行結果を表示する。
// 他機能の予定をまとめる独立ページは作らず、各機能の設定を正本とする。
(function () {
  'use strict';

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
    const data = await apiFetch('/import-schedules?category=webclip-inbox', { silentError: true });
    return Array.isArray(data?.schedules)
      ? data.schedules.filter(entry => entry?.category === 'webclip-inbox')
      : [];
  }

  function textEl(tag, text, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text || '';
    return el;
  }

  function renderEntryCard(entry) {
    const card = document.createElement('div');
    card.className = 'gb-section gb-section--boxed';
    card.style.marginTop = '8px';
    const stableId = String(entry.id).replace(/[^a-zA-Z0-9_-]+/g, '-');
    card.dataset.e2eId = `import-schedule-card-${stableId}`;

    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.textContent = `Web受信箱: ${entry.label || entry.id}`;
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
        const result = await apiPost(`/import-schedules/${encodeURIComponent(entry.id)}`, {period:cfg}, {method:'PATCH', silentError:true});
        Object.assign(entry, result.schedule);
        status.textContent = statusLine(entry);
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
    runBtn.innerHTML = icon('play', 16);
    runBtn.title = '今すぐ実行';
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

    card.appendChild(row);

    return card;
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
        list.appendChild(renderEntryCard(entry));
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
      <div class="gb-section-title">Web受信箱の取得</div>
      <div class="gb-section-desc">このPCでWeb受信箱を確認する周期を設定します。</div>
    `;
    container.appendChild(section);

    const list = document.createElement('div');
    list.className = 'import-schedule-list';
    list.dataset.e2eId = 'import-schedule-list';
    section.appendChild(list);

    return refresh(section);
  }

  // 設定ダイアログの専用コンテナへマウントする。
  function mount(hostContainerId) {
    const host = document.getElementById(hostContainerId || 'webclip-inbox-schedule-container');
    return host ? render(host) : Promise.resolve();
  }

  window.MeldexImportScheduleSettings = {
    render, mount, refresh, isCloudStaticScheduleSurface,
    isUserFacingCategory: category => category === 'webclip-inbox',
  };
})();
