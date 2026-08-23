// Googleデータ取り込み設定（Desktop / Cloud 共通UI）。
(function () {
  'use strict';

  const TARGET_LABELS = {
    docs: 'Googleドキュメント',
    sheets: 'Googleスプレッドシート',
    slides: 'Googleスライド',
    forms: 'Googleフォーム',
    gmail: 'Gmail',
    contacts: 'Google連絡先',
    takeout: 'Google Takeout',
  };

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function isCloudSurface() {
    return window.MeldexRuntimeAdapter?.isPwaMode?.()
      || ['browser', 'dropbox', 'server'].includes(document.body?.dataset?.cloudMode || '');
  }

  function canManage() {
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.();
    const role = String(state?.access?.role || state?.role || '').toLowerCase();
    if (!role) return !isCloudSurface();
    return state?.isOwner === true || role === 'owner' || role === 'admin';
  }

  function cloudPayload() {
    return {
      config: {
        destination: { path: '', name: '' },
        targets: { docs: true, sheets: true, slides: false, forms: false, gmail: false, contacts: false, takeout: false },
        options: { shared_items: false, original_snapshots: false },
        schedule: { type: 'off' },
        run_state: { status: 'never', next_run_at: '', last_result: null },
      },
      connection: { connected: false },
      capabilities: {
        surface: 'cloud',
        can_connect: false,
        can_import: false,
        phase: 6,
        reason: 'Google取り込みのCloud実行モジュールを読み込めませんでした',
      },
      source_folders: [],
    };
  }

  function stateLabel(payload) {
    if (payload?.connection?.connected) return '接続済み';
    return '未接続';
  }

  function lastRunLabel(runState) {
    if (!runState || runState.status === 'never') return '最終取り込み: 未実行';
    if (runState.status === 'running') return '取り込み中';
    const result = runState.last_result;
    if (result && typeof result === 'object') {
      const chat = result.google_chat;
      const chatIssues = chat
        ? (chat.messages_original_only || 0) + (chat.source_files_original_only || 0)
          + (chat.messages_failed || 0) + (chat.source_files_failed || 0) + (chat.attachments_missing || 0)
        : 0;
      const chatSummary = chat ? ` / Chat メッセージ${chat.messages_total || 0}・要確認${chatIssues}` : '';
      return `前回: 新規${result.imported ?? result.created ?? 0} / 更新${result.updated || 0} / 失敗${result.failed || 0}${chatSummary}`;
    }
    return runState.last_finished_at ? `前回: ${runState.last_finished_at}` : '前回: 結果なし';
  }

  function scheduleLabel(schedule, runState) {
    if (runState?.next_run_at) return `次回実行: ${runState.next_run_at}`;
    if (!schedule || schedule.type === 'off') return '次回実行: 手動のみ';
    if (schedule.type === 'interval') return `次回実行: ${schedule.interval_minutes || 0}分ごと`;
    return '次回実行: 設定済み';
  }

  function setMessage(root, message, isError) {
    const el = root.querySelector('#google-import-message');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--fg2)';
  }

  async function openExternal(url) {
    if (!url) return;
    if (typeof apiPost === 'function') {
      try {
        await apiPost('/open-external-url', { url }, { silentError: true });
        return;
      } catch {}
    }
    window.open(url, '_blank', 'noopener');
  }

  function renderShell(root) {
    root.innerHTML = `
      <section id="google-import-provider-row" class="external-import-provider" data-provider="google">
        <div class="external-import-provider-row">
          <div class="external-import-provider-identity">
            <span class="external-import-provider-icon" aria-hidden="true">${icon('cloudDownload', 16)}</span>
            <div><strong>Google</strong><span id="google-import-connection-state" class="external-import-provider-state">確認中...</span></div>
          </div>
          <span id="google-import-last-run" class="external-import-provider-last">最終取り込み: 未実行</span>
          <div class="external-import-provider-actions">
            <button type="button" id="google-import-connect" class="gb-btn gb-btn-sm" hidden>${icon('externalLink', 14)} Googleに接続</button>
            <button type="button" id="google-import-run" class="gb-btn gb-btn-sm" hidden>${icon('play', 14)} 今すぐ取り込む</button>
            <button type="button" id="google-import-toggle" class="gb-btn gb-btn-sm gb-btn-quiet external-import-provider-toggle" aria-expanded="false" aria-controls="google-import-details" aria-label="Google取り込みの詳細を開く">${icon('chevronDown', 16)}</button>
          </div>
        </div>
        <p class="external-import-privacy">選んだGoogleデータをMeldexへコピーします。Google側のデータは変更・削除しません。</p>
        <div id="google-import-details" class="external-import-provider-details" hidden>
          <div class="google-import-overview" data-google-desktop-control>
            <div><span>接続</span><strong id="google-import-account">未接続</strong></div>
            <label for="google-import-destination"><span>取り込み先</span>
              <select id="google-import-destination" class="gb-select"><option value="">ソースフォルダを選択</option></select>
            </label>
            <div><span>予定</span><strong id="google-import-next-run">手動のみ</strong></div>
          </div>
          <div id="google-import-capability" class="gb-section-desc" role="status" aria-live="polite"></div>
          <fieldset class="google-import-targets" data-google-desktop-control>
            <legend>取り込み対象</legend>
            <label><input type="checkbox" id="google-import-target-docs" data-google-target="docs"> Googleドキュメント</label>
            <label><input type="checkbox" id="google-import-target-sheets" data-google-target="sheets"> Googleスプレッドシート</label>
          </fieldset>
          <details class="google-import-more" data-google-desktop-control>
            <summary>その他のGoogleデータ</summary>
            <div class="google-import-target-grid">
              <label><input type="checkbox" id="google-import-target-slides" data-google-target="slides"> Googleスライド</label>
              <label><input type="checkbox" id="google-import-target-forms" data-google-target="forms"> Googleフォーム</label>
              <label><input type="checkbox" id="google-import-target-gmail" data-google-target="gmail"> Gmail</label>
              <label><input type="checkbox" id="google-import-target-contacts" data-google-target="contacts"> Google連絡先</label>
              <label><input type="checkbox" id="google-import-target-takeout" data-google-target="takeout"> Google Takeout</label>
            </div>
          </details>
          <details class="google-import-more" data-google-desktop-control>
            <summary>詳細設定</summary>
            <div class="google-import-target-grid">
              <label><input type="checkbox" id="google-import-shared-items"> 共有アイテムを含める</label>
              <label><input type="checkbox" id="google-import-original-snapshots"> 原本スナップショットを保存</label>
            </div>
            <button type="button" id="google-import-load-shared-drives" class="gb-btn gb-btn-sm">共有ドライブを選ぶ</button>
            <div id="google-import-shared-drives" class="google-import-target-grid" aria-live="polite"></div>
            <label class="google-import-takeout-path" for="google-import-takeout-path">Takeoutファイル／フォルダ
              <input type="text" id="google-import-takeout-path" class="gb-input" placeholder="デスクトップ版でパスを指定">
            </label>
          </details>
          <div id="google-import-schedule" class="google-import-schedule" data-google-desktop-control></div>
          <div class="google-import-calendar-note">GoogleカレンダーとGoogle ToDoは「カレンダー」の同期設定で管理します。</div>
          <div class="external-import-provider-detail-actions" data-google-desktop-control>
            <button type="button" id="google-import-disconnect" class="gb-btn gb-btn-sm gb-btn-danger" hidden>Google接続を解除</button>
          </div>
          <div id="google-import-message" class="gb-section-desc" role="status" aria-live="polite" aria-atomic="true"></div>
        </div>
      </section>`;
  }

  function setExpanded(root, expanded) {
    const toggle = root.querySelector('#google-import-toggle');
    const details = root.querySelector('#google-import-details');
    if (!toggle || !details) return;
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.setAttribute('aria-label', expanded ? 'Google取り込みの詳細を閉じる' : 'Google取り込みの詳細を開く');
    details.hidden = !expanded;
  }

  function renderPayload(root, payload) {
    root._googlePayload = payload;
    const config = payload?.config || {};
    const capabilities = payload?.capabilities || {};
    const manageable = canManage();
    const cloudSurface = isCloudSurface();
    const connected = !!payload?.connection?.connected;
    root.querySelectorAll('[data-google-desktop-control]').forEach(element => { element.hidden = false; });
    root.querySelector('#google-import-connection-state').textContent = stateLabel(payload);
    root.querySelector('#google-import-account').textContent = stateLabel(payload);
    root.querySelector('#google-import-last-run').textContent = lastRunLabel(config.run_state);
    root.querySelector('#google-import-next-run').textContent = scheduleLabel(config.schedule, config.run_state).replace('次回実行: ', '');

    const destination = root.querySelector('#google-import-destination');
    destination.textContent = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'ソースフォルダを選択';
    destination.appendChild(empty);
    (payload?.source_folders || []).forEach(item => {
      const option = document.createElement('option');
      option.value = String(item.path || '');
      option.textContent = String(item.name || item.path || 'ソースフォルダ');
      destination.appendChild(option);
    });
    destination.value = String(config.destination?.path || '');
    destination.disabled = !manageable;

    root.querySelectorAll('[data-google-target]').forEach(input => {
      input.checked = !!config.targets?.[input.dataset.googleTarget];
      input.disabled = !manageable;
    });
    const shared = root.querySelector('#google-import-shared-items');
    shared.checked = !!config.options?.shared_items;
    shared.disabled = !manageable;
    const snapshots = root.querySelector('#google-import-original-snapshots');
    snapshots.checked = !!config.options?.original_snapshots;
    snapshots.disabled = !manageable;
    snapshots.closest('label').hidden = cloudSurface;
    const takeoutPath = root.querySelector('#google-import-takeout-path');
    takeoutPath.disabled = cloudSurface;
    takeoutPath.placeholder = cloudSurface ? 'Takeoutはデスクトップ版で取り込みます' : 'ZIP、TGZ、または展開済みフォルダのパス';

    const connect = root.querySelector('#google-import-connect');
    connect.hidden = connected || !manageable || !capabilities.can_connect;
    const run = root.querySelector('#google-import-run');
    run.hidden = !connected || !manageable || !capabilities.can_import;
    const disconnect = root.querySelector('#google-import-disconnect');
    disconnect.hidden = !connected || !manageable;

    const reason = capabilities.reason
      || (!manageable ? '接続と設定の変更はワークスペースのowner / adminだけが行えます。' : '')
      || (connected && !capabilities.can_import ? 'Google接続は完了しています。' : '');
    root.querySelector('#google-import-capability').textContent = reason;

    const scheduleRoot = root.querySelector('#google-import-schedule');
    scheduleRoot.textContent = '';
    scheduleRoot.className = '';
    if (manageable && !cloudSurface && capabilities.can_import && window.MeldexScheduler) {
      window.MeldexScheduler.createWidget(scheduleRoot, config.schedule, cfg => savePatch(root, { schedule: cfg }));
    } else if (!capabilities.can_import) {
      scheduleRoot.className = 'gb-section-desc google-import-schedule-pending';
      scheduleRoot.textContent = '実取り込み対応後に自動実行を設定できます。';
    }
  }

  async function load(root) {
    if (isCloudSurface()) {
      try {
        renderPayload(root, window.MeldexGoogleImportCloud ? await window.MeldexGoogleImportCloud.getPayload() : cloudPayload());
      } catch (err) {
        renderPayload(root, cloudPayload());
        setMessage(root, err.userMessage || err.message || String(err), true);
      }
      return;
    }
    try {
      const payload = await apiFetch('/google-import/config', { silentError: true });
      renderPayload(root, payload);
    } catch (err) {
      renderPayload(root, cloudPayload());
      const message = 'Google取り込み設定を取得できませんでした: ' + (err.userMessage || err.message || err);
      root.querySelector('#google-import-capability').textContent = message;
      setMessage(root, message, true);
    }
  }

  async function savePatch(root, patch) {
    if (!canManage()) return;
    try {
      setMessage(root, '設定を保存しています...', false);
      const payload = isCloudSurface()
        ? await window.MeldexGoogleImportCloud.patchConfig(patch)
        : await apiPost('/google-import/config', patch, { method: 'PATCH', silentError: true });
      renderPayload(root, payload);
      setMessage(root, 'Google取り込み設定を保存しました。', false);
    } catch (err) {
      setMessage(root, '保存できませんでした: ' + (err.userMessage || err.message || err), true);
      await load(root);
    }
  }

  function bind(root) {
    root.querySelector('#google-import-toggle').addEventListener('click', () => {
      const expanded = root.querySelector('#google-import-toggle').getAttribute('aria-expanded') === 'true';
      setExpanded(root, !expanded);
    });
    root.querySelector('#google-import-destination').addEventListener('change', event => {
      const path = event.target.value;
      const name = event.target.selectedOptions?.[0]?.textContent || '';
      savePatch(root, { destination: { path, name } });
    });
    root.querySelectorAll('[data-google-target]').forEach(input => {
      input.addEventListener('change', () => savePatch(root, {
        targets: { [input.dataset.googleTarget]: input.checked },
      }));
    });
    root.querySelector('#google-import-shared-items').addEventListener('change', event => {
      savePatch(root, { options: { shared_items: event.target.checked } });
    });
    root.querySelector('#google-import-original-snapshots').addEventListener('change', event => {
      savePatch(root, { options: { original_snapshots: event.target.checked } });
    });
    root.querySelector('#google-import-load-shared-drives').addEventListener('click', async () => {
      const target = root.querySelector('#google-import-shared-drives');
      target.textContent = '共有ドライブを読み込んでいます...';
      try {
        const drives = isCloudSurface()
          ? await window.MeldexGoogleImportCloud.listSharedDrives()
          : (await apiFetch('/google-import/shared-drives', { silentError: true })).drives;
        target.textContent = '';
        const selected = new Set(root._googlePayload?.config?.options?.shared_drive_ids || []);
        (drives || []).forEach(drive => {
          const label = document.createElement('label');
          const input = document.createElement('input');
          input.type = 'checkbox'; input.value = String(drive.id || ''); input.checked = selected.has(input.value);
          input.addEventListener('change', () => {
            const ids = Array.from(target.querySelectorAll('input:checked')).map(item => item.value);
            savePatch(root, { options: { shared_drive_ids: ids } });
          });
          label.append(input, document.createTextNode(' ' + String(drive.name || drive.id || '共有ドライブ')));
          target.appendChild(label);
        });
        if (!target.children.length) target.textContent = '利用できる共有ドライブはありません。';
      } catch (err) {
        target.textContent = '共有ドライブを取得できませんでした: ' + (err.userMessage || err.message || err);
      }
    });
    root.querySelector('#google-import-connect').addEventListener('click', async () => {
      try {
        setMessage(root, 'Google接続画面を開いています...', false);
        if (isCloudSurface()) {
          renderPayload(root, await window.MeldexGoogleImportCloud.authorize());
        } else {
          const targets = Array.from(root.querySelectorAll('[data-google-target]:checked')).map(input => input.dataset.googleTarget);
          const result = await apiPost('/google-import/oauth/start', { targets }, { silentError: true });
          await openExternal(result.auth_url);
        }
      } catch (err) {
        setMessage(root, err.userMessage || err.message || String(err), true);
      }
    });
    root.querySelector('#google-import-disconnect').addEventListener('click', async () => {
      const approved = typeof cfConfirm === 'function'
        ? await cfConfirm('Google接続を解除しますか？\n取り込み済みデータは削除しません。')
        : window.confirm('Google接続を解除しますか？');
      if (!approved) return;
      try {
        if (isCloudSurface()) await window.MeldexGoogleImportCloud.disconnect();
        else await apiPost('/google-import/disconnect', {}, { silentError: true });
        await load(root);
      } catch (err) {
        setMessage(root, '接続を解除できませんでした: ' + (err.userMessage || err.message || err), true);
      }
    });
    root.querySelector('#google-import-run').addEventListener('click', async () => {
      const button = root.querySelector('#google-import-run');
      button.disabled = true;
      try {
        setMessage(root, 'Googleデータを取り込んでいます...', false);
        let result;
        if (isCloudSurface()) {
          result = await window.MeldexGoogleImportCloud.run();
        } else {
          const started = await apiPost('/google-import/run', { takeout_path: root.querySelector('#google-import-takeout-path').value.trim() }, { silentError: true });
          if (started?.job_id) {
            for (;;) {
              const job = await apiFetch(`/google-import/jobs/${encodeURIComponent(started.job_id)}`, { silentError: true });
              if (job.status === 'succeeded' || job.status === 'done') { result = job.result || job; break; }
              if (job.status === 'failed') throw new Error(job.error || job.message || 'Google取り込みに失敗しました');
              setMessage(root, job.message || job.phase || 'Googleデータを取り込んでいます...', false);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } else result = started;
        }
        const chat = result.google_chat;
        const chatOriginalOnly = chat
          ? (chat.messages_original_only || 0) + (chat.source_files_original_only || 0)
          : 0;
        const chatNeedsAttention = chat
          ? (chat.messages_failed || 0) + (chat.source_files_failed || 0) + (chat.attachments_missing || 0)
          : 0;
        const chatSummary = chat
          ? ` / Chat 会話${chat.conversations || 0}・メッセージ${chat.messages_total || 0}・添付${chat.attachments_saved || 0}・原本のみ${chatOriginalOnly}・重複${chat.messages_duplicates || 0}・要確認${chatNeedsAttention}`
          : '';
        setMessage(root, `取り込み完了: 新規${result.imported || 0} / 更新${result.updated || 0} / 失敗${result.failed || 0}${chatSummary}`, !!result.failed);
        if (typeof reloadOutlinerTree === 'function') reloadOutlinerTree();
        await load(root);
      } catch (err) {
        setMessage(root, '取り込めませんでした: ' + (err.userMessage || err.message || err), true);
      } finally {
        button.disabled = false;
      }
    });
  }

  function mount(target) {
    const root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) return Promise.resolve();
    if (root.dataset.googleImportMounted !== '1') {
      root.dataset.googleImportMounted = '1';
      renderShell(root);
      bind(root);
    }
    return load(root);
  }

  window.MeldexGoogleImportSettings = { mount, canManage, isCloudSurface, TARGET_LABELS };
})();

if (typeof window.__loadSplitScript === 'function') {
  window.__loadSplitScript('gb-google-import-settings.js', ['gb-google-import-cloud.js']);
}
