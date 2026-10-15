(function () {
  'use strict';

  const rootId = 'external-import-settings-container';

  function isCloudStaticImportSurface() {
    return window.MeldexRuntimeAdapter?.isPwaMode?.()
      || ['browser', 'dropbox', 'server'].includes(document.body?.dataset?.cloudMode || '');
  }
  const runningSetIds = new Set();
  const connectingServices = new Set();
  const pendingConnections = new Set();
  let lastConfig = null;
  let refreshSequence = 0;
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

  function setStatus(message, isError, service) {
    const el = document.getElementById('external-import-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--fg2)';
    el.dataset.error = isError ? '1' : '0';
    if (service) {
      const local = document.getElementById(`external-import-${service}-message`);
      if (local) {
        local.textContent = message || '';
        local.dataset.error = isError ? '1' : '0';
      }
    }
  }

  async function openUrl(url) {
    if (!url) throw new Error('接続先のURLを取得できませんでした。もう一度お試しください。');
    if (typeof apiPost === 'function') {
      await apiPost('/open-external-url', { url }, { silentError: true });
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
      const issues = (result?.errors || 0) + (result?.failed_assets || 0) + (result?.warnings?.length || 0);
      card.appendChild(textEl('div', result ? `前回: 新規${result.created || 0} / 更新${result.updated || 0} / スキップ${result.skipped || 0}${issues ? ' / 要確認' + issues + '件' : ''}` : '前回: なし', 'gb-section-desc'));
      if (item.service === 'notion') card.appendChild(textEl('div', item.source_ids?.length ? `対象: 指定した${item.source_ids.length}ページ` : '対象: 接続に共有した全ページ', 'gb-section-desc'));
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
        // Each refresh creates new cards; a cached widget still points to the
        // detached previous card and would leave the current schedule blank.
        const widget = window.MeldexScheduler.createWidget(schedContainer, item.schedule, (cfg) => {
          _saveSetSchedule(item.id, cfg);
        });
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
      setStatus('定期実行を保存できませんでした: ' + (e.userMessage || e.message || e), true);
    }
  }

  async function refresh() {
    const sequence = ++refreshSequence;
    try {
      const data = await loadConfig();
      if (sequence !== refreshSequence || !document.getElementById(rootId)) return;
      if (!data) throw new Error('取り込みAPIを利用できません');
      lastConfig = data;
      const notionConn = data?.connections?.notion || {};
      const evernoteConn = data?.connections?.evernote || {};
      const notion = notionConn.connected ? `取り込み接続済み${notionConn.name ? ': ' + notionConn.name : ''}` : '取り込み未接続';
      const evernote = evernoteConn.connected ? `接続済み${evernoteConn.name ? ': ' + evernoteConn.name : ''}` : '未接続';
      document.getElementById('external-import-notion-state').textContent = notion;
      document.getElementById('external-import-evernote-state').textContent = evernoteConn.reason || evernote;
      const evernoteButton = document.getElementById('external-import-evernote-connect');
      if (evernoteButton) evernoteButton.disabled = evernoteConn.can_connect === false || connectingServices.has('evernote');
      const evernoteMessage = document.getElementById('external-import-evernote-message');
      if (evernoteMessage && !evernoteMessage.textContent && evernoteConn.reason) evernoteMessage.textContent = evernoteConn.reason;
      for (const service of ['notion', 'evernote']) {
        const connection = data.connections?.[service] || {};
        const add = document.getElementById(`external-import-${service}-add`);
        if (add) add.disabled = !connection.connected;
        if (pendingConnections.has(service) && connection.connected) {
          pendingConnections.delete(service);
          setStatus(`${serviceLabel(service)}に接続しました。取り込む範囲を指定してください。`, false, service);
        }
      }
      const relayButton = document.getElementById('external-import-notion-relay');
      if (relayButton) relayButton.hidden = !notionConn.relay_available;
      const disconnectButton = document.getElementById('external-import-notion-disconnect');
      if (disconnectButton) disconnectButton.hidden = !notionConn.connected;
      renderSetList(data || {});
    } catch (err) {
      if (sequence !== refreshSequence) return;
      setStatus('取り込み設定を取得できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  async function connect(service) {
    if (connectingServices.has(service)) return;
    connectingServices.add(service);
    const button = document.getElementById(`external-import-${service}-connect`);
    const relayButton = service === 'notion' ? document.getElementById('external-import-notion-relay') : null;
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    if (relayButton) relayButton.disabled = true;
    try {
      setStatus(`${serviceLabel(service)}の接続画面を開いています...`, false, service);
      const data = await apiPost(`/external-import/${service}/auth/start`, {}, { silentError: true });
      await openUrl(data.auth_url);
      pendingConnections.add(service);
      setStatus('ブラウザで接続を許可してからMeldexへ戻ってください。', false, service);
    } catch (err) {
      setStatus(err.userMessage || err.message || String(err), true, service);
    } finally {
      connectingServices.delete(service);
      if (button) { button.disabled = lastConfig?.connections?.[service]?.can_connect === false; button.removeAttribute('aria-busy'); }
      if (relayButton) relayButton.disabled = false;
    }
  }

  function revealNotionConnection() {
    const details = document.getElementById('external-import-notion-details');
    const toggle = document.getElementById('external-import-notion-toggle');
    if (details) details.hidden = false;
    toggle?.setAttribute('aria-expanded', 'true');
    toggle?.setAttribute('aria-label', '詳細を閉じる');
    const form = document.getElementById('external-import-notion-token-form');
    if (form) form.hidden = false;
    document.getElementById('external-import-notion-token')?.focus();
  }

  async function connectNotionToken(event) {
    event.preventDefault();
    if (connectingServices.has('notion')) return;
    const input = document.getElementById('external-import-notion-token');
    const token = input?.value.trim();
    if (!token) { setStatus('インテグレーショントークンを入力してください。', true, 'notion'); input?.focus(); return; }
    connectingServices.add('notion');
    const button = document.getElementById('external-import-notion-token-save');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    setStatus('Notionの接続を確認しています...', false, 'notion');
    try {
      await apiPost('/external-import/notion/connect', { token }, { silentError: true });
      await refresh();
      document.getElementById('external-import-notion-token-form').hidden = true;
      setStatus('Notionに接続しました。取り込むページを指定してください。', false, 'notion');
    } catch (err) {
      setStatus(err.userMessage || err.message || String(err), true, 'notion');
    } finally {
      input.value = '';
      connectingServices.delete('notion');
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  async function addNotionSet() {
    const name = document.getElementById('external-import-notion-name').value.trim();
    const all = document.getElementById('external-import-notion-all').checked;
    const sources = document.getElementById('external-import-notion-sources').value.trim().split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    if (!name || (!all && !sources.length)) {
      setStatus(!name ? '取り込みセット名を入力してください。' : '取り込むページのURLまたはIDを入力してください。', true, 'notion');
      return;
    }
    const button = document.getElementById('external-import-notion-add');
    button.disabled = true;
    try {
      await createSet('notion', { name, source_urls: all ? [] : sources, all_accessible_pages: all,
        include_children: document.getElementById('external-import-notion-children').checked,
        copy_attachments: document.getElementById('external-import-notion-assets').checked },
      { promptForName: false, nextActionMessage: 'Notion取り込みセットを追加しました。一覧の「更新を反映」で取り込みます。', throwOnError: true });
    } catch (err) { setStatus(err.userMessage || err.message || String(err), true, 'notion'); }
    finally { button.disabled = !lastConfig?.connections?.notion?.connected; }
  }

  async function disconnectNotion() {
    if (!await confirmAction('Notionの取り込み接続を解除しますか？取り込み済みファイルとNotion同期の接続は保持されます。', false)) return;
    try {
      await apiPost('/external-import/notion/disconnect', {}, { silentError: true });
      pendingConnections.delete('notion');
      await refresh();
      setStatus('Notionの取り込み接続を解除しました。', false, 'notion');
    } catch (err) { setStatus(err.userMessage || err.message || String(err), true, 'notion'); }
  }

  function resultStatus(message, data) {
    const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
    const failures = (data?.errors || 0) + (data?.failed || 0) + (data?.failed_assets || 0);
    const suffix = [failures ? `要確認${failures}件` : '', ...warnings].filter(Boolean).join(' / ');
    setStatus(message + (suffix ? ' / ' + suffix : ''), failures > 0 || warnings.length > 0);
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
      path = prompt('Obsidianフォルダを入力してください', '');
    }
    if (!path) return;
    try {
      const preview = await apiPost('/external-import/obsidian/pick-vault', { path }, { silentError: true });
      await createSet('obsidian', { source_path: preview.vault_path, name: preview.name });
    } catch (err) {
      setStatus('Obsidianフォルダを確認できませんでした: ' + (err.userMessage || err.message || err), true);
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
        resultStatus(`取り込み完了: 新規${r.created || 0} / 更新${r.updated || 0} / スキップ${r.skipped || 0}`, r);
        return r;
      }
      if (job.status === 'error') throw new Error(job.error || '取り込みに失敗しました');
      if (job.status === 'cancelled') throw new Error('取り込みをキャンセルしました');
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
      resultStatus(`ENEX取り込み完了: 新規${data.created || 0} / 更新${data.updated || 0}`, data);
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
      if (!data.image_count) throw new Error('画像を検出できませんでした。PureRefで画像を書き出してから取り込んでください。');
      resultStatus(`PureRef取り込み完了: 画像${data.image_count}件 / ${data.board_path || ''}`, data);
      if (typeof reloadOutlinerTree === 'function') reloadOutlinerTree();
    } catch (err) {
      setStatus('PureRefを取り込めませんでした: ' + (err.userMessage || err.message || err), true);
    } finally {
      if (inputEl) inputEl.value = '';
    }
  }

  function bind() {
    document.getElementById('external-import-notion-connect')?.addEventListener('click', revealNotionConnection);
    document.getElementById('external-import-notion-relay')?.addEventListener('click', () => connect('notion'));
    document.getElementById('external-import-notion-token-form')?.addEventListener('submit', connectNotionToken);
    document.getElementById('external-import-notion-disconnect')?.addEventListener('click', disconnectNotion);
    document.getElementById('external-import-notion-token-help-link')?.addEventListener('click', async event => {
      event.preventDefault();
      try { await openUrl(event.currentTarget.href); }
      catch (err) { setStatus(err.userMessage || err.message || String(err), true, 'notion'); }
    });
    document.getElementById('external-import-notion-add')?.addEventListener('click', addNotionSet);
    document.getElementById('external-import-notion-all')?.addEventListener('change', event => {
      document.getElementById('external-import-notion-sources').disabled = event.target.checked;
    });
    document.getElementById('external-import-refresh')?.addEventListener('click', () => refresh());
    document.getElementById('external-import-obsidian-add')?.addEventListener('click', addObsidianSet);
    document.getElementById('external-import-evernote-connect')?.addEventListener('click', () => connect('evernote'));
    document.getElementById('external-import-evernote-add')?.addEventListener('click', () => createSet('evernote'));
    document.getElementById('external-import-enex-button')?.addEventListener('click', () => document.getElementById('external-import-enex-input')?.click());
    document.getElementById('external-import-enex-input')?.addEventListener('change', event => importEnex(event.target.files?.[0], event.target));
    document.getElementById('external-import-eagle-copy-add')?.addEventListener('click', () => addEagleSet('copy'));
    document.getElementById('external-import-eagle-reference-add')?.addEventListener('click', () => addEagleSet('reference'));
    document.getElementById('external-import-pureref-button')?.addEventListener('click', () => document.getElementById('external-import-pureref-input')?.click());
    document.getElementById('external-import-pureref-input')?.addEventListener('change', event => importPureRef(event.target.files?.[0], event.target));
    document.querySelectorAll('[data-external-import-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const details = document.getElementById(button.getAttribute('aria-controls'));
        if (!details) return;
        const expanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        button.setAttribute('aria-label', expanded ? '詳細を開く' : '詳細を閉じる');
        details.hidden = expanded;
      });
    });
  }

  function renderExternalImportSettings(scope) {
    const container = (scope || document).querySelector?.('#' + rootId) || document.getElementById(rootId);
    if (!container) return;
    // Google行は能力判定を表示するためCloudにも残し、ローカルフォルダ走査・
    // 定期ジョブを要する既存サービスだけをCloudで隠す。
    const cloudSurface = isCloudStaticImportSurface();
    container.hidden = false;
    delete container.dataset.cloudDesktopOnlyHidden;
    if (container.dataset.rendered === '1') {
      window.MeldexGoogleImportSettings?.mount('#google-import-provider-slot');
      if (!cloudSurface) refresh();
      return;
    }
    container.dataset.rendered = '1';
    container.innerHTML = `
      <section class="external-import-heading">
        <div class="external-import-heading-row"><div class="gb-section-title">${icon('download', 14)} 外部データ取り込み</div><button type="button" id="external-import-refresh" class="gb-btn gb-btn-sm gb-btn-quiet">${icon('refreshCw', 14)} 接続状態を更新</button></div>
        <div class="gb-section-desc">サービスごとに接続またはファイルを選び、取り込む範囲を確認してください。元のデータは変更・削除しません。</div>
      </section>
      <div id="external-import-status" class="external-import-feedback" role="status" aria-live="polite" aria-atomic="true">サービスごとに接続またはファイルを選択してください。</div>
      <div id="google-import-provider-slot"></div>
      <div id="external-import-local-providers" class="external-import-provider-list"${cloudSurface ? ' hidden' : ''}>
        <section class="external-import-provider" data-provider="notion">
          <div class="external-import-provider-row">
            <div class="external-import-provider-identity"><span class="external-import-provider-icon">${icon('notebookText', 16)}</span><div><strong>NotionからMeldexへ取り込む</strong><span class="external-import-provider-state" id="external-import-notion-state">取り込み接続を確認中...</span></div></div>
            <span class="external-import-provider-last">ノート</span>
            <div class="external-import-provider-actions"><button type="button" id="external-import-notion-connect" class="gb-btn gb-btn-sm">${icon('externalLink', 14)} Notionに接続</button><button type="button" id="external-import-notion-toggle" class="gb-btn gb-btn-sm gb-btn-quiet external-import-provider-toggle" data-external-import-toggle aria-expanded="false" aria-controls="external-import-notion-details" aria-label="詳細を開く">${icon('chevronDown', 16)}</button></div>
          </div>
          <div id="external-import-notion-message" class="external-import-inline-message" role="status" aria-live="polite"></div>
          <div id="external-import-notion-details" class="external-import-provider-details" hidden>
            <div class="gb-section-desc">NotionからMeldexへコピーします。「Notion同期」（Meldexから送る）の接続とは別です。</div>
            <form id="external-import-notion-token-form" class="external-import-form" hidden>
              <label for="external-import-notion-token">インテグレーショントークン</label>
              <div class="external-import-input-row"><input id="external-import-notion-token" class="gb-input" type="password" autocomplete="off" spellcheck="false" placeholder="Notionのトークンを貼り付け" aria-describedby="external-import-notion-token-help"><button type="submit" id="external-import-notion-token-save" class="gb-btn gb-btn-sm">接続を確認して保存</button></div>
              <div id="external-import-notion-token-help" class="gb-section-desc">Notionのインテグレーションでトークンを取得し、取り込むページの「コネクト」から共有してください。トークンはOSの資格情報保管に保存します。</div>
              <a id="external-import-notion-token-help-link" href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener noreferrer">Notionのインテグレーション設定を開く</a>
            </form>
            <div class="external-import-provider-detail-actions"><button type="button" id="external-import-notion-relay" class="gb-btn gb-btn-sm" hidden>${icon('externalLink', 14)} ブラウザで接続</button><button type="button" id="external-import-notion-disconnect" class="gb-btn gb-btn-sm gb-btn-quiet" hidden>取り込み接続を解除</button></div>
            <div class="external-import-form">
              <label for="external-import-notion-name">取り込みセット名</label><input id="external-import-notion-name" class="gb-input" value="Notion" maxlength="120">
              <label for="external-import-notion-sources">取り込むページのURLまたはID（1行に1件）</label><textarea id="external-import-notion-sources" class="gb-input" rows="3" placeholder="https://www.notion.so/..." spellcheck="false"></textarea>
              <label class="external-import-check"><input type="checkbox" id="external-import-notion-all">接続に共有した全ページを取り込む</label>
              <div class="gb-section-desc">ページ指定は最大100件、全ページの取り込みは1回最大1,000件です。</div>
              <label class="external-import-check"><input type="checkbox" id="external-import-notion-children" checked>ページ内のブロックも取り込む</label>
              <label class="external-import-check"><input type="checkbox" id="external-import-notion-assets">添付ファイルをコピーする</label>
              <button type="button" id="external-import-notion-add" class="gb-btn gb-btn-sm" disabled>${icon('plus', 14)} 取り込みセットを追加</button>
            </div>
          </div>
        </section>
        <section class="external-import-provider" data-provider="obsidian">
          <div class="external-import-provider-row">
            <div class="external-import-provider-identity"><span class="external-import-provider-icon">${icon('folderOpen', 16)}</span><div><strong>Obsidian</strong><span class="external-import-provider-state">Markdown</span></div></div>
            <span class="external-import-provider-last">読み取り専用</span>
            <div class="external-import-provider-actions"><button type="button" id="external-import-obsidian-add" class="gb-btn gb-btn-sm">${icon('folder', 14)} Obsidianフォルダを選ぶ</button><button type="button" id="external-import-obsidian-toggle" class="gb-btn gb-btn-sm gb-btn-quiet external-import-provider-toggle" data-external-import-toggle aria-expanded="false" aria-controls="external-import-obsidian-details" aria-label="詳細を開く">${icon('chevronDown', 16)}</button></div>
          </div>
          <div id="external-import-obsidian-details" class="external-import-provider-details" hidden><div class="gb-section-desc">Obsidianフォルダ内のMarkdownをMeldexへコピーします。</div></div>
        </section>
        <section class="external-import-provider" data-provider="evernote">
          <div class="external-import-provider-row">
            <div class="external-import-provider-identity"><span class="external-import-provider-icon">${icon('archive', 16)}</span><div><strong>Evernote</strong><span class="external-import-provider-state" id="external-import-evernote-state">確認中...</span></div></div>
            <span class="external-import-provider-last">ノート / ENEX</span>
            <div class="external-import-provider-actions"><button type="button" id="external-import-evernote-connect" class="gb-btn gb-btn-sm">${icon('externalLink', 14)} Evernoteに接続</button><button type="button" id="external-import-evernote-toggle" class="gb-btn gb-btn-sm gb-btn-quiet external-import-provider-toggle" data-external-import-toggle aria-expanded="false" aria-controls="external-import-evernote-details" aria-label="詳細を開く">${icon('chevronDown', 16)}</button></div>
          </div>
          <div id="external-import-evernote-message" class="external-import-inline-message" role="status" aria-live="polite"></div>
          <div id="external-import-evernote-details" class="external-import-provider-details" hidden><div class="gb-section-desc">オンライン接続を利用できない場合も、Evernoteから書き出したENEXファイルを取り込めます。</div><div class="external-import-provider-detail-actions"><button type="button" id="external-import-evernote-add" class="gb-btn gb-btn-sm" disabled>${icon('plus', 14)} 取り込みセットを追加</button><button type="button" id="external-import-enex-button" class="gb-btn gb-btn-sm">${icon('fileUp', 14)} ENEXファイルを選ぶ</button><input id="external-import-enex-input" type="file" accept=".enex" aria-label="ENEXファイル" hidden></div></div>
        </section>
        <section class="external-import-provider" data-provider="eagle">
          <div class="external-import-provider-row">
            <div class="external-import-provider-identity"><span class="external-import-provider-icon">${icon('images', 16)}</span><div><strong>Eagle</strong><span class="external-import-provider-state">ライブラリ</span></div></div>
            <span class="external-import-provider-last">コピー / 参照</span>
            <div class="external-import-provider-actions"><button type="button" id="external-import-eagle-copy-add" class="gb-btn gb-btn-sm">${icon('copy', 14)} コピー型を追加</button><button type="button" id="external-import-eagle-toggle" class="gb-btn gb-btn-sm gb-btn-quiet external-import-provider-toggle" data-external-import-toggle aria-expanded="false" aria-controls="external-import-eagle-details" aria-label="詳細を開く">${icon('chevronDown', 16)}</button></div>
          </div>
          <div id="external-import-eagle-details" class="external-import-provider-details" hidden><div class="gb-section-desc">ライブラリをソースフォルダへコピー、または参照ノートとして取り込みます。</div><button type="button" id="external-import-eagle-reference-add" class="gb-btn gb-btn-sm">${icon('link', 14)} 参照型を追加</button></div>
        </section>
        <section class="external-import-provider" data-provider="pureref">
          <div class="external-import-provider-row">
            <div class="external-import-provider-identity"><span class="external-import-provider-icon">${icon('galleryHorizontal', 16)}</span><div><strong>PureRef</strong><span class="external-import-provider-state">画像ボード</span></div></div>
            <span class="external-import-provider-last">.pur</span>
            <div class="external-import-provider-actions"><button type="button" id="external-import-pureref-button" class="gb-btn gb-btn-sm">${icon('fileUp', 14)} PureRefファイルを選ぶ</button><button type="button" id="external-import-pureref-toggle" class="gb-btn gb-btn-sm gb-btn-quiet external-import-provider-toggle" data-external-import-toggle aria-expanded="false" aria-controls="external-import-pureref-details" aria-label="詳細を開く">${icon('chevronDown', 16)}</button></div>
          </div>
          <div id="external-import-pureref-details" class="external-import-provider-details" hidden><div class="gb-section-desc">検出できた画像からボードを作成します。読み込めない形式はPureRefで画像を書き出してから取り込んでください。元の配置は引き継ぎません。</div><input id="external-import-pureref-input" type="file" accept=".pur" aria-label="PureRefファイル" hidden></div>
        </section>
      </div>
      <section id="external-import-set-section" class="gb-section gb-section--boxed"${cloudSurface ? ' hidden' : ''}>
        <div class="gb-section-title">${icon('listChecks', 14)} 取り込みセット</div>
        <div id="external-import-set-list"><div class="gb-section-desc">読み込み中...</div></div>
      </section>
    `;
    bind();
    window.MeldexGoogleImportSettings?.mount('#google-import-provider-slot');
    if (!cloudSurface) refresh();
  }

  window.renderExternalImportSettings = renderExternalImportSettings;
  const refreshPendingConnections = () => {
    const root = document.getElementById(rootId);
    if (pendingConnections.size && root?.offsetParent && !document.hidden) refresh();
  };
  window.addEventListener('focus', refreshPendingConnections);
  document.addEventListener('visibilitychange', refreshPendingConnections);
  // gb-settings-x-bookmarks.js 等、他の設定パネルからも同じ「Cloud静的版では
  // 成立しないデスクトップ専用操作を隠す」判定を再利用できるよう公開する
  // （新しい判定を作らず、既存のこの判定へ揃えるため。インポート・機能生成
  // ファイル保護計画のクラウド並行修正で追加）。
  window.isCloudStaticImportSurface = isCloudStaticImportSurface;
})();
