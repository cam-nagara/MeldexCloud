(function () {
  'use strict';

  const rootId = 'external-import-settings-container';

  function isCloudStaticImportSurface() {
    return window.MeldexRuntimeAdapter?.isPwaMode?.()
      || ['browser', 'dropbox', 'server'].includes(document.body?.dataset?.cloudMode || '');
  }
  const runningSetIds = new Set();
  const _scheduleWidgets = {};   // setId → widget
  const ENEX_WARN_BYTES = 8 * 1024 * 1024;
  const ENEX_MAX_BYTES = 32 * 1024 * 1024;
  const PUREREF_WARN_BYTES = 64 * 1024 * 1024;
  const PUREREF_MAX_BYTES = 256 * 1024 * 1024;
  const JOB_POLL_INTERVAL_MS = 1000;
  const JOB_MAX_POLLS = 30 * 60;

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
    return {
      notion: 'Notion',
      obsidian: 'Obsidian',
      evernote: 'Evernote',
      enex: 'Evernote',
      'eagle-copy': 'Eagleコピー',
      'eagle-reference': 'Eagle参照'
    }[service] || service;
  }

  async function confirmAction(message, fallbackWhenUnavailable) {
    if (typeof cfConfirm === 'function') return await cfConfirm(message);
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') return window.confirm(message);
    return !!fallbackWhenUnavailable;
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
      const stableId = String(item.id || item.name || 'set').replace(/[^a-zA-Z0-9_-]+/g, '-');
      const card = document.createElement('div');
      card.className = 'gb-section gb-section--boxed';
      card.dataset.e2eId = `external-import-set-card-${stableId}`;
      card.style.marginTop = '8px';

      const title = document.createElement('div');
      title.className = 'gb-section-title';
      title.textContent = `${serviceLabel(item.service)}: ${item.name || '取り込み'}`;
      card.appendChild(title);
      card.appendChild(textEl('div', `保存先: ${item.save_dir || ''}`, 'gb-section-desc'));
      const result = item.last_result;
      card.appendChild(textEl('div', result ? `前回: 新規${result.created || 0} / 更新${result.updated || 0} / スキップ${result.skipped || 0}` : '前回: なし', 'gb-section-desc'));
      if (!result && item.service === 'eagle-reference') {
        card.appendChild(textEl('div', '「更新を反映」を押すと参照用フォルダを作成し、ソースフォルダとして追加します。', 'gb-section-desc'));
      } else if (!result && item.service === 'eagle-copy') {
        card.appendChild(textEl('div', 'まだフォルダツリーには表示されていません。「取り込み」を押すと、ソースフォルダ内にファイルをコピーします。', 'gb-section-desc'));
      }

      const row = document.createElement('div');
      row.className = 'gb-field-row';
      row.style.justifyContent = 'flex-start';
      row.style.flexWrap = 'wrap';

      const copyCompleted = item.service === 'eagle-copy' && item.last_result && item.last_result.ok !== false;
      const runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.className = 'gb-btn gb-btn-sm';
      runBtn.disabled = runningSetIds.has(item.id);
      if (copyCompleted) runBtn.disabled = true;
      const runLabel = copyCompleted ? '取り込み済み' : (item.service === 'eagle-copy' ? '取り込み' : '更新を反映');
      runBtn.innerHTML = icon(copyCompleted ? 'check' : 'refreshCw', 14) + (runningSetIds.has(item.id) ? ' 取り込み中...' : ' ' + runLabel);
      runBtn.dataset.e2eId = `external-import-set-run-${stableId}`;
      runBtn.setAttribute('aria-label', `${item.name || serviceLabel(item.service)}の${runLabel}`);
      runBtn.addEventListener('click', () => runSet(item));
      row.appendChild(runBtn);

      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'gb-btn gb-btn-sm gb-btn-quiet';
      previewBtn.innerHTML = icon('search', 14) + ' 確認';
      previewBtn.dataset.e2eId = `external-import-set-preview-${stableId}`;
      previewBtn.setAttribute('aria-label', `${item.name || serviceLabel(item.service)}を確認`);
      previewBtn.addEventListener('click', () => previewSet(item.id));
      row.appendChild(previewBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'gb-btn gb-btn-sm gb-btn-danger';
      deleteBtn.innerHTML = icon('trash2', 14) + ' 一覧から削除';
      deleteBtn.dataset.e2eId = `external-import-set-delete-${stableId}`;
      deleteBtn.setAttribute('aria-label', `${item.name || serviceLabel(item.service)}を一覧から削除`);
      deleteBtn.addEventListener('click', () => deleteSet(item.id));
      row.appendChild(deleteBtn);

      card.appendChild(row);

      const schedContainer = document.createElement('div');
      schedContainer.className = 'gb-section gb-section--boxed';
      schedContainer.style.cssText = 'margin-top:6px;padding:8px;';
      card.appendChild(schedContainer);
      // 定期実行の判断・実行はバックエンド（meldex_import_scheduler.py）が担う。
      // ここでは周期を選ばせて保存し、確定した次回予定・前回結果を表示するだけ
      // にする（ブラウザータイマーでの自己実行はしない）。
      if (window.MeldexScheduler && item.id) {
        let widget = _scheduleWidgets[item.id];
        if (!widget) {
          widget = window.MeldexScheduler.createWidget(schedContainer, item.schedule, (cfg) => {
            _saveSetSchedule(item.id, cfg);
          });
          if (widget) _scheduleWidgets[item.id] = widget;
        }
        widget?.setStatusText(_formatScheduleState(item.schedule_state));
      }

      list.appendChild(card);
    });
  }

  function _formatScheduleState(state) {
    if (!state) return '';
    const parts = [];
    if (state.next_run_display) parts.push(`次回予定: ${state.next_run_display}`);
    if (state.last_run) {
      const label = state.last_run.status === 'done' ? '成功' : (state.last_run.status === 'error' ? '失敗' : state.last_run.status);
      parts.push(`前回自動実行: ${label}`);
    }
    if (state.needs_reselect) parts.push('元ファイルが見つからないため停止しました。再選択してください。');
    else if (state.needs_attention) parts.push('連続で失敗しています。設定をご確認ください。');
    return parts.join(' / ');
  }

  async function _saveSetSchedule(setId, cfg) {
    try {
      await apiPost(`/external-import/sets/${encodeURIComponent(setId)}`, { schedule: cfg }, { method: 'PATCH', silentError: true });
      await refresh();
    } catch (e) {
      console.warn('Failed to save external import schedule:', e);
    }
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

  async function createSet(service, extra, options = {}) {
    const initialName = extra?.name || serviceLabel(service);
    const name = options.promptForName === false ? initialName : prompt(`${serviceLabel(service)}取り込みセット名`, initialName);
    if (!name) return;
    const body = { ...(extra || {}), service, name };
    if (!body.save_dir) body.save_dir = `外部取り込み/${serviceLabel(service)}/${name}`;
    try {
      const result = await apiPost('/external-import/sets', body, { silentError: true });
      const message = options.nextActionMessage || '取り込みセットを追加しました。';
      setStatus(message, false);
      await refresh();
      if (options.nextActionMessage) setStatus(options.nextActionMessage, false);
      return result;
    } catch (err) {
      const message = '追加できませんでした: ' + (err.userMessage || err.message || err);
      setStatus(message, true);
      if (options.throwOnError) {
        const thrown = err instanceof Error ? err : new Error(String(err));
        thrown.userMessage = message;
        throw thrown;
      }
      return null;
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

  async function findEagleLibraries(path) {
    return apiPost('/external-import/eagle/find-libraries', { path }, { silentError: true });
  }

  function eagleLibraryNameFromPath(path) {
    const clean = String(path || '').replace(/[\\/]+$/, '');
    const name = clean.split(/[\\/]/).filter(Boolean).pop() || 'Eagle';
    return name.replace(/\.library$/i, '') || 'Eagle';
  }

  async function pickEagleParentFolder() {
    const query = new URLSearchParams({ title: 'Eagleライブラリまたは親フォルダを選択' });
    try {
      const picked = await apiFetch('/pick-folder?' + query.toString(), { silentError: true });
      return picked?.path || '';
    } catch {
      return '';
    }
  }

  function showEagleLibraryPicker(onSubmit) {
    return new Promise(resolve => {
      const body = document.createElement('div');
      body.className = 'external-import-eagle-picker-body';
      body.innerHTML = `
        <div id="external-import-eagle-picker-desc" class="gb-section-desc external-import-eagle-picker-desc">Eagleライブラリ本体、または .library フォルダが入っている親フォルダのパスを指定してください。</div>
        <div class="gb-field-row external-import-eagle-picker-field">
          <input id="external-import-eagle-path" class="gb-input" type="text" autocomplete="off" aria-label="Eagleライブラリのパス" aria-describedby="external-import-eagle-picker-desc external-import-eagle-picker-message" placeholder="例: \\\\NAS\\Public\\Eaglelibrary または D:\\\\Eagle\\資料.library">
          <button type="button" id="external-import-eagle-browse" class="gb-btn gb-btn-sm">参照</button>
          <button type="button" id="external-import-eagle-scan" class="gb-btn gb-btn-sm">候補を確認</button>
        </div>
        <div id="external-import-eagle-picker-message" class="gb-section-desc external-import-eagle-picker-message" role="status" aria-live="polite" aria-atomic="true"></div>
        <div id="external-import-eagle-picker-list" class="external-import-eagle-picker-list" aria-label="Eagleライブラリ候補"></div>`;
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.id = 'external-import-eagle-picker-cancel';
      cancelButton.className = 'gb-btn gb-btn-sm gb-btn-quiet';
      cancelButton.textContent = 'キャンセル';
      const okButton = document.createElement('button');
      okButton.type = 'button';
      okButton.id = 'external-import-eagle-picker-ok';
      okButton.className = 'gb-btn gb-btn-sm primary';
      okButton.textContent = '追加';
      let closed = false;
      const modalApi = window.GBUI.createModal({
        id: 'external-import-eagle-picker',
        title: 'Eagleライブラリを選択',
        body,
        footer: [cancelButton, okButton],
        variant: 'mobile-sheet',
        extraClass: 'external-import-eagle-picker-dialog',
        initialFocus: '#external-import-eagle-path',
        closeLabel: 'Eagleライブラリ選択を閉じる',
        closeOnEsc: true,
        closeOnOverlay: true,
        onClose: () => {
          if (!closed) {
            closed = true;
            resolve(false);
          }
        },
      });
      const overlay = modalApi.overlay;
      overlay.classList.add('modal-overlay', 'external-import-eagle-picker-overlay');
      overlay.dataset.e2eId = 'external-import-eagle-picker-overlay';
      modalApi.modal.classList.add('gb-section', 'gb-section--boxed');
      modalApi.modal.dataset.e2eId = 'external-import-eagle-picker-dialog';
      modalApi.modal.setAttribute('aria-describedby', 'external-import-eagle-picker-desc');
      modalApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'external-import-eagle-picker-header-close');
      modalApi.footer.classList.add('external-import-eagle-picker-actions');
      modalApi.open();

      const input = overlay.querySelector('#external-import-eagle-path');
      const message = overlay.querySelector('#external-import-eagle-picker-message');
      const list = overlay.querySelector('#external-import-eagle-picker-list');
      const okBtn = okButton;
      let selectedPath = '';

      const close = value => {
        if (closed) return;
        closed = true;
        modalApi.close(value ? 'submit' : 'cancel');
        resolve(!!value);
      };
      const setMessage = (text, isError) => {
        message.textContent = text || '';
        message.style.color = isError ? 'var(--danger)' : 'var(--fg2)';
      };
      const selectCandidate = path => {
        selectedPath = path || '';
        Array.from(list.querySelectorAll('[data-eagle-path]')).forEach(row => {
          const selected = row.dataset.eaglePath === selectedPath;
          row.classList.toggle('selected', selected);
          row.setAttribute('aria-pressed', selected ? 'true' : 'false');
          row.style.borderColor = selected ? 'var(--accent)' : 'var(--border)';
          row.style.background = selected ? 'var(--ui-bg-selected, var(--bg3))' : 'var(--bg2)';
        });
      };
      const renderCandidates = libraries => {
        list.textContent = '';
        selectedPath = '';
        libraries.forEach((item, index) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'gb-btn gb-btn-quiet';
          row.dataset.eaglePath = item.path || '';
          row.dataset.e2eId = 'external-import-eagle-candidate';
          row.setAttribute('aria-pressed', 'false');
          row.setAttribute('aria-label', `${item.name || 'Eagle'}を選択`);
          row.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:2px;padding:8px;';
          const name = document.createElement('strong');
          name.textContent = item.name || item.path || 'Eagle';
          const path = document.createElement('span');
          path.className = 'gb-section-desc';
          path.textContent = item.path || '';
          row.append(name, path);
          row.addEventListener('click', () => selectCandidate(item.path));
          row.addEventListener('dblclick', () => {
            selectCandidate(item.path);
            okBtn.click();
          });
          list.appendChild(row);
          if (index === 0) selectCandidate(item.path);
        });
      };
      const inspect = async () => {
        const raw = input.value.trim();
        if (!raw) {
          setMessage('パスを入力するか、参照から親フォルダを選択してください。', true);
          return '';
        }
        setMessage('Eagleライブラリ候補を確認しています...', false);
        try {
          const data = await findEagleLibraries(raw);
          const libraries = Array.isArray(data?.libraries) ? data.libraries : [];
          renderCandidates(libraries);
          if (data?.exact_library && libraries[0]?.path) {
            setMessage('Eagleライブラリを確認しました。', false);
            return libraries[0].path;
          }
          if (libraries.length === 1) {
            setMessage('Eagleライブラリ候補を1件見つけました。', false);
            return libraries[0].path;
          }
          if (libraries.length > 1) {
            setMessage('取り込むEagleライブラリを選択してください。', false);
            return selectedPath;
          }
          setMessage('このフォルダ内に有効な .library フォルダが見つかりません。', true);
          return '';
        } catch (err) {
          list.textContent = '';
          selectedPath = '';
          setMessage(err.userMessage || err.message || String(err), true);
          return '';
        }
      };

      overlay.querySelector('#external-import-eagle-browse').addEventListener('click', async () => {
        const picked = await pickEagleParentFolder();
        if (picked) {
          input.value = picked;
          await inspect();
        }
      });
      overlay.querySelector('#external-import-eagle-scan').addEventListener('click', inspect);
      overlay.querySelector('#external-import-eagle-picker-cancel').addEventListener('click', event => {
        event.stopPropagation();
        close('');
      });
      okBtn.addEventListener('click', async () => {
        const path = selectedPath || await inspect();
        if (!path) return;
        okBtn.disabled = true;
        setMessage('取り込みセットを追加しています...', false);
        try {
          const ok = await onSubmit(path, setMessage);
          if (ok) close(path);
        } finally {
          okBtn.disabled = false;
        }
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          okBtn.click();
        }
      });
      setMessage('親フォルダを指定すると、中のEagleライブラリ候補を一覧表示します。', false);
    });
  }

  async function addEagleSet(mode) {
    const service = mode === 'reference' ? 'eagle-reference' : 'eagle-copy';
    await showEagleLibraryPicker(async (path, setPickerMessage) => {
      try {
        setPickerMessage('Eagleライブラリの場所を確認しています...', false);
        const found = await findEagleLibraries(path);
        const libraries = Array.isArray(found?.libraries) ? found.libraries : [];
        const library = libraries.find(item => item.path === path) || libraries[0] || { path, name: eagleLibraryNameFromPath(path) };
        const libraryPath = library.path || path;
        const name = library.name || eagleLibraryNameFromPath(libraryPath);
        const result = await createSet(service, {
          source_path: libraryPath,
          name,
          save_dir: `外部取り込み/Eagle/${name}`,
          save_root: 'source'
        }, {
          promptForName: false,
          throwOnError: true,
          nextActionMessage: service === 'eagle-reference'
            ? '取り込みセットを追加しました。「更新を反映」を押すとソースフォルダとして追加します。'
            : '取り込みセットを追加しました。フォルダツリーに表示するには「取り込み」を押してください。'
        });
        if (!result) return false;
        setPickerMessage(service === 'eagle-reference'
          ? '取り込みセットを追加しました。続けて「更新を反映」を押すとソースフォルダとして追加されます。'
          : '取り込みセットを追加しました。続けて「取り込み」を押すとフォルダツリーに表示されます。', false);
        return true;
      } catch (err) {
        const message = err.userMessage || err.message || String(err);
        setPickerMessage(message.startsWith('追加できませんでした') ? message : '追加できませんでした: ' + message, true);
        return false;
      }
    });
  }

  async function ensureOutlinerRoot(path, name, options = {}) {
    const rootPath = String(path || '').trim();
    if (!rootPath) return false;
    if (typeof apiFetch !== 'function' || typeof apiPut !== 'function') return false;
    const roots = await apiFetch('/outliner-roots', { silentError: true });
    const list = Array.isArray(roots) ? roots : [];
    const normalizedPath = rootPath.replace(/[\\\/]+$/, '').toLowerCase();
    const existing = list.find(root => String(root?.path || '').replace(/[\\\/]+$/, '').toLowerCase() === normalizedPath);
    if (existing) {
      if (existing.visible === false || (name && existing.name !== name)) {
        existing.visible = true;
        if (name) existing.name = name;
        await apiPut('/outliner-roots', { roots: list });
      }
      return false;
    }
    list.push({
      path: rootPath,
      name: name || eagleLibraryNameFromPath(rootPath),
      visible: true,
      provider: options.provider || undefined,
      sourceId: options.sourceId || undefined,
    });
    await apiPut('/outliner-roots', { roots: list });
    return true;
  }

  async function previewSet(id) {
    try {
      const data = await apiPost(`/external-import/sets/${encodeURIComponent(id)}/preview`, {}, { silentError: true });
      const count = data.item_count != null
        ? `Eagle ${data.item_count}件 / フォルダ${data.folder_count || 0}件 / タグ${data.tag_count || 0}件`
        : (data.markdown_count != null ? `Markdown ${data.markdown_count}件` : (data.message || '確認しました'));
      setStatus(count, false);
    } catch (err) {
      setStatus('確認できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  async function runSet(itemOrId) {
    const item = typeof itemOrId === 'object' && itemOrId ? itemOrId : null;
    const id = item ? item.id : itemOrId;
    if (!id || runningSetIds.has(id)) {
      setStatus('この取り込みセットは実行中です。完了までお待ちください。', false);
      return;
    }
    runningSetIds.add(id);
    try { await refresh(); } catch {}
    try {
      setStatus('取り込みを開始しました...', false);
      const job = await apiPost(`/external-import/sets/${encodeURIComponent(id)}/run`, {}, { silentError: true });
      const result = await pollJob(job.job_id);
      let finalMessage = null;
      let finalIsError = false;
      if ((item?.service || result?.service) === 'eagle-reference' && result?.save_dir) {
        const rootName = item?.name || eagleLibraryNameFromPath(result.save_dir);
        try {
          const added = await ensureOutlinerRoot(result.save_dir, rootName, {
            provider: 'eagle-reference',
            sourceId: item?.id ? `eagle-reference:${item.id}` : undefined,
          });
          finalMessage = added
            ? `更新完了: 「${rootName}」をソースフォルダとして追加しました。`
            : `更新完了: 「${rootName}」はソースフォルダに登録済みです。`;
        } catch (rootErr) {
          finalMessage = '更新は完了しましたが、ソースフォルダへの追加に失敗しました: ' + (rootErr.userMessage || rootErr.message || rootErr);
          finalIsError = true;
        }
      }
      if (typeof loadOutliner === 'function') {
        try { await loadOutliner(); } catch {}
      }
      await refresh();
      if (finalMessage) setStatus(finalMessage, finalIsError);
    } catch (err) {
      setStatus('取り込みに失敗しました: ' + (err.userMessage || err.message || err), true);
    } finally {
      runningSetIds.delete(id);
      try { await refresh(); } catch {}
    }
  }

  async function pollJob(jobId) {
    if (!jobId) return;
    for (let i = 0; i < JOB_MAX_POLLS; i += 1) {
      const job = await apiFetch(`/external-import/jobs/${encodeURIComponent(jobId)}`, { silentError: true });
      if (job.status === 'done') {
        const r = job.result || {};
        setStatus(`取り込み完了: 新規${r.created || 0} / 更新${r.updated || 0} / スキップ${r.skipped || 0}`, false);
        return r;
      }
      if (job.status === 'error') throw new Error(job.error || '取り込みに失敗しました');
      if (i > 0 && i % 15 === 0) {
        setStatus('取り込み処理中です。大きいデータでは時間がかかります...', false);
      }
      await new Promise(resolve => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
    }
    throw new Error('取り込み処理が長時間続いています。時間をおいて確認してください。');
  }

  async function deleteSet(id) {
    const ok = await confirmAction('取り込みセットを一覧から削除しますか？\\n取り込み済みファイルは削除しません。', false);
    if (!ok) return;
    try {
      await apiFetch(`/external-import/sets/${encodeURIComponent(id)}`, { method: 'DELETE', silentError: true });
      setStatus('取り込みセットを削除しました。', false);
      await refresh();
    } catch (err) {
      setStatus('削除できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  async function importEnex(file, inputEl) {
    if (!file) {
      if (inputEl) inputEl.value = '';
      return;
    }
    try {
      if (file.size > ENEX_MAX_BYTES) {
        setStatus('ENEXファイルが大きすぎます。32MB以下に分割してから取り込んでください。', true);
        return;
      }
      if (file.size > ENEX_WARN_BYTES) {
        const ok = await confirmAction('大きいENEXファイルです。読み込み中に時間がかかる場合があります。続けますか？', false);
        if (!ok) return;
      }
      setStatus('ENEXファイルを読み込んでいます...', false);
      const content = await file.text();
      const data = await runBackgroundJob(
        '/external-import/enex/import',
        { filename: file.name, name: file.name.replace(/\\.enex$/i, ''), content },
        {
          startTimeoutMs: 300000,
          onProgress: (progress) => setStatus(formatJobProgress(progress, { unit: '件取り込み済み', defaultPhase: '取り込み中' }), false),
        }
      );
      setStatus(`ENEX取り込み完了: 新規${data.created || 0} / 更新${data.updated || 0}`, false);
    } catch (err) {
      setStatus('ENEXを取り込めませんでした: ' + (err.userMessage || err.message || err), true);
    } finally {
      if (inputEl) inputEl.value = '';
    }
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めませんでした'));
      reader.onload = () => {
        const value = String(reader.result || '');
        resolve(value.includes(',') ? value.split(',').pop() : value);
      };
      reader.readAsDataURL(file);
    });
  }

  async function importPureRef(file, inputEl) {
    if (!file) {
      if (inputEl) inputEl.value = '';
      return;
    }
    try {
      if (file.size > PUREREF_MAX_BYTES) {
        setStatus('PureRefファイルが大きすぎます。256MB以下に分割してから取り込んでください。', true);
        return;
      }
      if (file.size > PUREREF_WARN_BYTES) {
        const ok = await confirmAction('大きいPureRefファイルです。読み込み中に時間がかかる場合があります。続けますか？', false);
        if (!ok) return;
      }
      const baseName = (file.name || 'PureRef').replace(/\.pur$/i, '');
      const boardName = prompt('作成するボード名', baseName);
      if (!boardName) return;
      setStatus('PureRefファイルを読み込んでいます...', false);
      const content = await fileToBase64(file);
      const data = await runBackgroundJob('/external-import/pureref/import-upload', {
        filename: file.name,
        name: boardName,
        board_name: boardName,
        save_dir: `外部取り込み/PureRef/${boardName}`,
        save_root: 'source',
        content_base64: content
      }, {
        startTimeoutMs: 300000,
        onProgress: (progress) => setStatus(formatJobProgress(progress, { unit: '件', defaultPhase: '画像を取り込み中' }), false),
      });
      setStatus(`PureRef取り込み完了: 画像${data.image_count || 0}件 / ${data.board_path || ''}`, false);
      if (typeof reloadOutlinerTree === 'function') reloadOutlinerTree();
    } catch (err) {
      setStatus('PureRefを取り込めませんでした: ' + (err.userMessage || err.message || err), true);
    } finally {
      if (inputEl) inputEl.value = '';
    }
  }

  function bind() {
    document.getElementById('external-import-notion-connect')?.addEventListener('click', () => connect('notion'));
    document.getElementById('external-import-notion-add')?.addEventListener('click', () => createSet('notion'));
    document.getElementById('external-import-obsidian-add')?.addEventListener('click', addObsidianSet);
    document.getElementById('external-import-evernote-connect')?.addEventListener('click', () => connect('evernote'));
    document.getElementById('external-import-evernote-add')?.addEventListener('click', () => createSet('evernote'));
    document.getElementById('external-import-enex-button')?.addEventListener('click', () => document.getElementById('external-import-enex-input')?.click());
    document.getElementById('external-import-enex-input')?.addEventListener('change', event => importEnex(event.target.files?.[0], event.target));
    document.getElementById('external-import-eagle-copy-add')?.addEventListener('click', () => addEagleSet('copy'));
    document.getElementById('external-import-eagle-reference-add')?.addEventListener('click', () => addEagleSet('reference'));
    document.getElementById('external-import-pureref-button')?.addEventListener('click', () => document.getElementById('external-import-pureref-input')?.click());
    document.getElementById('external-import-pureref-input')?.addEventListener('change', event => importPureRef(event.target.files?.[0], event.target));
  }

  function renderExternalImportSettings(scope) {
    const container = (scope || document).querySelector?.('#' + rootId) || document.getElementById(rootId);
    if (!container) return;
    // OAuth中継、ローカル保管庫走査、定期ジョブを持たないDropbox直結の
    // Cloud静的版では、押しても成立しないデスクトップ専用操作を表示しない。
    if (isCloudStaticImportSurface()) {
      container.hidden = true;
      container.dataset.cloudDesktopOnlyHidden = '1';
      return;
    }
    container.hidden = false;
    delete container.dataset.cloudDesktopOnlyHidden;
    if (container.dataset.rendered === '1') {
      refresh();
      // 定期実行一覧（インポート予定）は毎回最新化する。mount()は初回描画済みなら
      // 内部でrefresh()のみ行う（二重追加はしない）。
      window.MeldexImportScheduleSettings?.mount(rootId);
      return;
    }
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
            <input id="external-import-enex-input" type="file" accept=".enex" aria-label="ENEXファイル" hidden>
          </div>
        </section>
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${icon('images', 14)} Eagleから取り込む</div>
          <div class="gb-section-desc">ライブラリをソースフォルダへコピー、または参照ノートとして取り込みます。</div>
          <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
            <button type="button" id="external-import-eagle-copy-add" class="gb-btn gb-btn-sm">${icon('copy', 14)} コピー型を追加</button>
            <button type="button" id="external-import-eagle-reference-add" class="gb-btn gb-btn-sm">${icon('link', 14)} 参照型を追加</button>
          </div>
        </section>
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${icon('galleryHorizontal', 14)} PureRefから取り込む</div>
          <div class="gb-section-desc">PureRefファイルから画像ボードを作成します。</div>
          <button type="button" id="external-import-pureref-button" class="gb-btn gb-btn-sm">${icon('fileUp', 14)} PureRefファイルを選ぶ</button>
          <input id="external-import-pureref-input" type="file" accept=".pur" aria-label="PureRefファイル" hidden>
        </section>
      </div>
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${icon('listChecks', 14)} 取り込みセット</div>
        <div id="external-import-set-list"><div class="gb-section-desc">読み込み中...</div></div>
      </section>
      <div id="external-import-status" class="gb-section-desc" role="status" aria-live="polite" aria-atomic="true"></div>
    `;
    bind();
    refresh();
    // 定期実行の一覧・管理（Notion同期/Xブックマーク/Xアカウント投稿/外部取り込みを横断）を
    // この設定画面の末尾へ追加する。Meldex.html への新規コンテナ追加はレーン外のため、
    // 既存コンテナへランタイムでマウントする。
    window.MeldexImportScheduleSettings?.mount(rootId);
  }

  window.renderExternalImportSettings = renderExternalImportSettings;
  // gb-settings-x-bookmarks.js 等、他の設定パネルからも同じ「Cloud静的版では
  // 成立しないデスクトップ専用操作を隠す」判定を再利用できるよう公開する
  // （新しい判定を作らず、既存のこの判定へ揃えるため。インポート・機能生成
  // ファイル保護計画のクラウド並行修正で追加）。
  window.isCloudStaticImportSurface = isCloudStaticImportSurface;
})();
