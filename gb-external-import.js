(function () {
  'use strict';

  const rootId = 'external-import-settings-container';

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function apiReady() {
    return typeof apiFetch === 'function' && typeof apiPost === 'function';
  }

  function setStatus(message, isError) {
    const el = document.getElementById('external-import-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--fg2)';
  }

  function openUrl(url) {
    if (!url) return;
    if (typeof apiPost === 'function') {
      apiPost('/open-external-url', { url }, { silentError: true }).catch(() => window.open(url, '_blank', 'noopener'));
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  function textEl(tag, text, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text || '';
    return el;
  }

  function serviceLabel(service) {
    return { notion: 'Notion', obsidian: 'Obsidian', evernote: 'Evernote', enex: 'Evernote' }[service] || service;
  }

  async function loadConfig() {
    if (!apiReady()) return null;
    return apiFetch('/external-import/config', { silentError: true });
  }

  function renderSetList(data) {
    const list = document.getElementById('external-import-set-list');
    if (!list) return;
    list.textContent = '';
    const sets = Array.isArray(data?.sets) ? data.sets : [];
    if (!sets.length) {
      list.appendChild(textEl('div', '取り込みセットはまだありません。上のボタンから追加してください。', 'gb-section-desc'));
      return;
    }
    sets.forEach(item => {
      const card = document.createElement('div');
      card.className = 'gb-section gb-section--boxed';
      card.style.marginTop = '8px';

      const title = document.createElement('div');
      title.className = 'gb-section-title';
      title.textContent = `${serviceLabel(item.service)}: ${item.name || '取り込み'}`;
      card.appendChild(title);
      card.appendChild(textEl('div', `保存先: ${item.save_dir || ''}`, 'gb-section-desc'));
      const result = item.last_result;
      card.appendChild(textEl('div', result ? `前回: 新規${result.created || 0} / 更新${result.updated || 0} / スキップ${result.skipped || 0}` : '前回: なし', 'gb-section-desc'));

      const row = document.createElement('div');
      row.className = 'gb-field-row';
      row.style.justifyContent = 'flex-start';
      row.style.flexWrap = 'wrap';

      const runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.className = 'gb-btn gb-btn-sm';
      runBtn.innerHTML = icon('refreshCw', 14) + ' 更新を反映';
      runBtn.addEventListener('click', () => runSet(item.id));
      row.appendChild(runBtn);

      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'gb-btn gb-btn-sm gb-btn-quiet';
      previewBtn.innerHTML = icon('search', 14) + ' 確認';
      previewBtn.addEventListener('click', () => previewSet(item.id));
      row.appendChild(previewBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'gb-btn gb-btn-sm gb-btn-danger';
      deleteBtn.innerHTML = icon('trash2', 14) + ' 一覧から削除';
      deleteBtn.addEventListener('click', () => deleteSet(item.id));
      row.appendChild(deleteBtn);

      card.appendChild(row);
      list.appendChild(card);
    });
  }

  async function refresh() {
    try {
      setStatus('取り込み設定を確認しています...', false);
      const data = await loadConfig();
      const notionConn = data?.connections?.notion || {};
      const evernoteConn = data?.connections?.evernote || {};
      const notion = notionConn.connected ? `接続済み${notionConn.name ? ': ' + notionConn.name : ''}` : '未接続';
      const evernote = evernoteConn.connected ? `接続済み${evernoteConn.name ? ': ' + evernoteConn.name : ''}` : '未接続';
      document.getElementById('external-import-notion-state').textContent = notion;
      document.getElementById('external-import-evernote-state').textContent = evernote;
      renderSetList(data || {});
      setStatus('外部サービス側は変更しません。Meldex内へ読み取り専用コピーを作ります。', false);
    } catch (err) {
      setStatus('取り込み設定を取得できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  async function connect(service) {
    try {
      setStatus(`${serviceLabel(service)}の接続画面を開いています...`, false);
      const data = await apiPost(`/external-import/${service}/auth/start`, {}, { silentError: true });
      openUrl(data.auth_url);
    } catch (err) {
      setStatus(err.userMessage || err.message || String(err), true);
    }
  }

  async function createSet(service, extra) {
    const name = prompt(`${serviceLabel(service)}取り込みセット名`, serviceLabel(service));
    if (!name) return;
    const body = { service, name, ...(extra || {}) };
    if (!body.save_dir) body.save_dir = `外部取り込み/${serviceLabel(service)}/${name}`;
    try {
      await apiPost('/external-import/sets', body, { silentError: true });
      setStatus('取り込みセットを追加しました。', false);
      await refresh();
    } catch (err) {
      setStatus('追加できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  async function addObsidianSet() {
    let path = '';
    try {
      const picked = await apiFetch('/pick-folder', { silentError: true });
      path = picked?.path || '';
    } catch {}
    if (!path) {
      path = prompt('Obsidianの保管庫フォルダを入力してください', '');
    }
    if (!path) return;
    try {
      const preview = await apiPost('/external-import/obsidian/pick-vault', { path }, { silentError: true });
      await createSet('obsidian', { source_path: preview.vault_path, name: preview.name });
    } catch (err) {
      setStatus('保管庫を確認できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  async function previewSet(id) {
    try {
      const data = await apiPost(`/external-import/sets/${encodeURIComponent(id)}/preview`, {}, { silentError: true });
      const count = data.markdown_count != null ? `Markdown ${data.markdown_count}件` : (data.message || '確認しました');
      setStatus(count, false);
    } catch (err) {
      setStatus('確認できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  async function runSet(id) {
    try {
      setStatus('取り込みを開始しました...', false);
      const job = await apiPost(`/external-import/sets/${encodeURIComponent(id)}/run`, {}, { silentError: true });
      await pollJob(job.job_id);
      await refresh();
    } catch (err) {
      setStatus('取り込みに失敗しました: ' + (err.userMessage || err.message || err), true);
    }
  }

  async function pollJob(jobId) {
    if (!jobId) return;
    for (let i = 0; i < 120; i += 1) {
      const job = await apiFetch(`/external-import/jobs/${encodeURIComponent(jobId)}`, { silentError: true });
      if (job.status === 'done') {
        const r = job.result || {};
        setStatus(`取り込み完了: 新規${r.created || 0} / 更新${r.updated || 0} / スキップ${r.skipped || 0}`, false);
        return;
      }
      if (job.status === 'error') throw new Error(job.error || '取り込みに失敗しました');
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    throw new Error('取り込みが完了しませんでした');
  }

  async function deleteSet(id) {
    if (typeof cfConfirm === 'function') {
      const ok = await cfConfirm('取り込みセットを一覧から削除しますか？\\n取り込み済みファイルは削除しません。');
      if (!ok) return;
    }
    try {
      await apiFetch(`/external-import/sets/${encodeURIComponent(id)}`, { method: 'DELETE', silentError: true });
      setStatus('取り込みセットを削除しました。', false);
      await refresh();
    } catch (err) {
      setStatus('削除できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  async function importEnex(file) {
    if (!file) return;
    try {
      setStatus('ENEXファイルを読み込んでいます...', false);
      const content = await file.text();
      const data = await apiPost('/external-import/enex/import', { filename: file.name, name: file.name.replace(/\\.enex$/i, ''), content }, { silentError: true });
      setStatus(`ENEX取り込み完了: 新規${data.created || 0} / 更新${data.updated || 0}`, false);
    } catch (err) {
      setStatus('ENEXを取り込めませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  function bind() {
    document.getElementById('external-import-notion-connect')?.addEventListener('click', () => connect('notion'));
    document.getElementById('external-import-notion-add')?.addEventListener('click', () => createSet('notion'));
    document.getElementById('external-import-obsidian-add')?.addEventListener('click', addObsidianSet);
    document.getElementById('external-import-evernote-connect')?.addEventListener('click', () => connect('evernote'));
    document.getElementById('external-import-evernote-add')?.addEventListener('click', () => createSet('evernote'));
    document.getElementById('external-import-enex-button')?.addEventListener('click', () => document.getElementById('external-import-enex-input')?.click());
    document.getElementById('external-import-enex-input')?.addEventListener('change', event => importEnex(event.target.files?.[0]));
  }

  function renderExternalImportSettings(scope) {
    const container = (scope || document).querySelector?.('#' + rootId) || document.getElementById(rootId);
    if (!container || container.dataset.rendered === '1') return;
    container.dataset.rendered = '1';
    container.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${icon('download', 14)} 外部ノート取り込み</div>
        <div class="gb-section-desc">Notion、Obsidian、EvernoteのノートをMeldexへ取り込みます。外部サービス側は変更しません。</div>
      </section>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${icon('notebookText', 14)} Notionから取り込む</div>
          <div class="gb-section-desc">状態: <span id="external-import-notion-state">確認中...</span></div>
          <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
            <button type="button" id="external-import-notion-connect" class="gb-btn gb-btn-sm">${icon('externalLink', 14)} Notionに接続</button>
            <button type="button" id="external-import-notion-add" class="gb-btn gb-btn-sm">${icon('plus', 14)} 取り込みセットを追加</button>
          </div>
        </section>
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${icon('folderOpen', 14)} Obsidianから取り込む</div>
          <div class="gb-section-desc">保管庫フォルダ内のMarkdownを読み取り専用で取り込みます。</div>
          <button type="button" id="external-import-obsidian-add" class="gb-btn gb-btn-sm">${icon('folder', 14)} 保管庫を選ぶ</button>
        </section>
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${icon('archive', 14)} Evernoteから取り込む</div>
          <div class="gb-section-desc">状態: <span id="external-import-evernote-state">確認中...</span></div>
          <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
            <button type="button" id="external-import-evernote-connect" class="gb-btn gb-btn-sm">${icon('externalLink', 14)} Evernoteに接続</button>
            <button type="button" id="external-import-evernote-add" class="gb-btn gb-btn-sm">${icon('plus', 14)} 取り込みセットを追加</button>
            <button type="button" id="external-import-enex-button" class="gb-btn gb-btn-sm">${icon('fileUp', 14)} ENEXファイルを選ぶ</button>
            <input id="external-import-enex-input" type="file" accept=".enex" hidden>
          </div>
        </section>
      </div>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${icon('listChecks', 14)} 取り込みセット</div>
        <div id="external-import-set-list"><div class="gb-section-desc">読み込み中...</div></div>
      </section>
      <div id="external-import-status" class="gb-section-desc"></div>
    `;
    bind();
    refresh();
  }

  window.renderExternalImportSettings = renderExternalImportSettings;
})();
