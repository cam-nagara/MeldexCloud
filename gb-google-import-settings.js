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
  const PERSONAL_MY_DRIVE_URL = 'https://drive.google.com/drive/folders/root';
  const PERSONAL_SHARED_DRIVES_URL = 'https://drive.google.com/drive/u/0/shared-drives';

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

  async function mountPersonal(root) {
    if (isCloudSurface() || !canManage()) return;
    let panel = root.querySelector('#google-personal-import');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'google-personal-import';
      panel.className = 'google-import-more';
      panel.innerHTML = `
        <h4>個人用Google接続・一度だけ取り込む</h4>
        <p>自分専用の認証設定を登録し、Googleの元ファイルと同じフォルダに、編集可能なコピーを作ります。</p>
        <details><summary>Google側の初回設定ガイド</summary>
          <ol>
            <li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">Google Cloud</a>で自分専用のプロジェクトを作成します。</li>
            <li><a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer">APIライブラリ</a>でGoogle Drive APIとGoogle Sheets APIを有効にします。</li>
            <li><a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener noreferrer">Google Auth Platform</a>でアプリ名・連絡先を登録し、対象をExternal、公開状態をTestingにします。自分をテストユーザーへ追加します。</li>
            <li>データアクセスにDriveの読み取り権限（drive.readonly）を追加します。許可はDrive全体の読み取りですが、Meldexは選択フォルダのみ取り込みます。</li>
            <li>クライアントの種類を「デスクトップアプリ」にして作成し、認証設定JSONをダウンロードします。APIキー・Web用・サービスアカウント用は使いません。</li>
            <li>下でJSONを登録して「Googleに接続」を押します。ブラウザでアカウントと読み取り許可を確認し、戻ったら「接続状態を更新」を押します。</li>
          </ol>
          <p>認証設定は自分専用とし、ダウンロードしたJSONを共有フォルダへ置かないでください。Testingの認証は7日で失効するため、必要時に再接続します。取り込み済みコピーは接続解除後も編集できます。</p>
        </details>
        <p id="google-personal-state" role="status" aria-live="polite"></p>
        <input id="google-personal-json" type="file" accept=".json,application/json" aria-label="認証設定JSONを選択" hidden>
        <button type="button" id="google-personal-json-choose" class="gb-btn gb-btn-sm">認証設定JSONを登録</button>
        <p id="google-personal-json-status" role="status" aria-live="polite"></p>
        <div class="external-import-provider-actions">
          <button type="button" id="google-personal-connect" class="gb-btn gb-btn-sm">Googleに接続</button>
          <button type="button" id="google-personal-refresh" class="gb-btn gb-btn-sm">接続状態を更新</button>
          <button type="button" id="google-personal-disconnect" class="gb-btn gb-btn-sm">接続解除</button>
          <button type="button" id="google-personal-delete" class="gb-btn gb-btn-sm">認証設定を削除</button>
        </div>
        <fieldset class="google-import-targets">
          <legend>取り込み対象</legend>
          <label><input type="checkbox" id="google-personal-docs" checked> Googleドキュメント</label>
          <label><input type="checkbox" id="google-personal-sheets" checked> Googleスプレッドシート</label>
        </fieldset>
        <p><label>ローカルソースフォルダ <select id="google-personal-source" class="gb-select"></select></label></p>
        <p><label>サブフォルダ（省略可） <input id="google-personal-subfolder" class="gb-input" placeholder="資料/企画"></label></p>
        <p>取り込み範囲: <strong id="google-personal-scope">マイドライブ全体</strong></p>
        <p><label>対応するGoogleフォルダURL <input id="google-personal-folder" class="gb-input" type="url" value="${PERSONAL_MY_DRIVE_URL}" aria-describedby="google-personal-folder-help" placeholder="https://drive.google.com/drive/folders/…"></label></p>
        <button type="button" id="google-personal-folder-auto" class="gb-btn gb-btn-sm">全体のURLを設定</button>
        <p id="google-personal-folder-help">保存先に対応する全体のURLを自動設定します。共有ドライブの親フォルダを選んだ場合は、配下の共有ドライブをまとめて対象にします。一部だけを取り込む場合は、対応するGoogleフォルダのURLへ変更できます。</p>
        <p>文書・表を先に検索し、保存に必要な親フォルダだけを確認します。選んだフォルダの配下も対象です。Docsはノート、Sheetsは全タブを含むシートに変換します。画像・コメント・組版・グラフ・数式の再計算は再現対象外です。作成したコピーもDriveの同期・共有対象になります。オフライン利用にはDrive側でも「オフラインで使用可能」にしてください。</p>
        <button type="button" id="google-personal-preview" class="gb-btn gb-btn-sm">対象と保存先を確認</button>
        <button type="button" id="google-personal-preview-cancel" class="gb-btn gb-btn-sm" hidden>対象の確認を停止</button>
        <p id="google-personal-progress" role="status" aria-live="polite"></p>
        <div id="google-personal-results" role="region" aria-label="取り込み対象と結果"></div>
        <button type="button" id="google-personal-run" class="gb-btn gb-btn-sm" hidden>確認した保存先へ取り込む</button>
        <button type="button" id="google-personal-cancel" class="gb-btn gb-btn-sm" hidden>取り込みを停止</button>
        <p id="google-personal-message" role="status" aria-live="polite"></p>`;
      // Put the actionable personal flow before the separately configured
      // managed importer. Its connection and destination are independent.
      root.querySelector('#google-import-details').prepend(panel);
      const find = id => panel.querySelector('#google-personal-' + id);
      const message = text => { find('message').textContent = text; };
      const selectedTargets = () => ['docs', 'sheets'].filter(key => find(key).checked);
      const updatePreviewEnabled = () => {
        find('preview').disabled = !!panel._busy || !!panel._defaultLoading || !panel._connected
          || !selectedTargets().length || !find('folder').value.trim();
      };
      let defaultTimer = null;
      const cancelDefault = () => {
        clearTimeout(defaultTimer);
        panel._defaultGeneration = (panel._defaultGeneration || 0) + 1;
        panel._defaultLoading = false;
      };
      const scopeLabel = () => {
        const url = find('folder').value.trim();
        find('scope').textContent = url === PERSONAL_MY_DRIVE_URL ? 'マイドライブ全体'
          : url === PERSONAL_SHARED_DRIVES_URL ? '共有ドライブ全体' : url ? '指定したGoogleフォルダ' : 'URLを設定してください';
      };
      const applyFolderDefault = async () => {
        cancelDefault();
        if (!panel.isConnected) return;
        panel._folderManual = false;
        panel._needsFolderDefault = false;
        const generation = panel._defaultGeneration;
        if (!find('source').value) {
          find('folder').value = PERSONAL_MY_DRIVE_URL;
          scopeLabel(); updatePreviewEnabled(); return;
        }
        const source = find('source').value.replace(/[\\/]+$/, '')
          + (find('subfolder').value.trim() ? '/' + find('subfolder').value.trim() : '');
        panel._defaultLoading = true;
        find('folder').value = '';
        find('scope').textContent = '全体のURLを自動設定中…';
        updatePreviewEnabled();
        try {
          const data = await apiFetch('/google-import/local/folder-default?source=' + encodeURIComponent(source), { silentError: true });
          if (!panel.isConnected || panel._defaultGeneration !== generation) return;
          find('folder').value = data.folder_url;
          find('scope').textContent = data.label;
        } catch (err) {
          if (panel.isConnected && panel._defaultGeneration === generation) {
            find('scope').textContent = 'URLを自動設定できませんでした';
            message((err.userMessage || err.message || '接続と保存先を確認してください。') + '「全体のURLを設定」で再試行できます。');
          }
        } finally {
          if (panel._defaultGeneration === generation) {
            panel._defaultLoading = false;
            updatePreviewEnabled();
          }
        }
      };
      const queueFolderDefault = () => {
        cancelDefault();
        panel._defaultLoading = true;
        find('folder').value = '';
        find('scope').textContent = '全体のURLを自動設定中…';
        updatePreviewEnabled();
        defaultTimer = setTimeout(() => void applyFolderDefault(), 250);
      };
      const restoreTargets = job => {
        const targets = Array.isArray(job.targets) ? job.targets : ['docs', 'sheets'];
        for (const key of ['docs', 'sheets']) find(key).checked = targets.includes(key);
      };
      const output = (rows, paging = null) => {
        rows = rows || [];
        const generation = panel._outputGeneration = (panel._outputGeneration || 0) + 1;
        const total = paging?.total ?? rows.length;
        const size = 200;
        let pageError = null;
        let beforePageError = null;
        const render = (pageRows, offset) => {
          if (panel._outputGeneration !== generation) return;
          find('results').replaceChildren();
          if (total > size) {
            const nav = document.createElement('nav');
            nav.setAttribute('aria-label', '取り込み対象のページ');
            for (const [label, delta, disabled] of [['前の200件', -size, offset === 0], ['次の200件', size, offset + size >= total]]) {
              const button = document.createElement('button');
              button.type = 'button'; button.className = 'gb-btn gb-btn-sm';
              button.textContent = label; button.disabled = disabled;
              button.addEventListener('click', async () => {
                if (!pageError) beforePageError = find('message').textContent;
                for (const item of nav.querySelectorAll('button')) item.disabled = true;
                try {
                  const nextOffset = offset + delta;
                  const data = paging?.load ? await paging.load(nextOffset) : { items: rows.slice(nextOffset, nextOffset + size), offset: nextOffset };
                  if (panel._outputGeneration !== generation) return;
                  render(data.items, data.offset);
                  if (pageError && find('message').textContent === pageError) message(beforePageError);
                  pageError = null;
                  find('results').querySelector('nav button:not(:disabled)')?.focus({ preventScroll: true });
                } catch (err) {
                  if (panel._outputGeneration === generation) {
                    render(pageRows, offset);
                    pageError = err.userMessage || err.message || '一覧を取得できませんでした。ページを選び直してください。';
                    message(pageError);
                  }
                }
              });
              nav.appendChild(button);
            }
            const range = document.createElement('span');
            range.textContent = ` ${offset + 1}～${Math.min(offset + size, total)} / ${total}件`;
            nav.appendChild(range);
            find('results').appendChild(nav);
          }
          const list = document.createElement('ul');
          for (const row of pageRows) {
            const item = document.createElement('li');
            const labels = { ready: '作成予定', created: '作成済み', skipped: '成功済み・スキップ', failed: '失敗', blocked: '要確認', unsupported: '未対応', warning: '警告' };
            item.textContent = `${labels[row.status] || row.status}: ${row.name}${row.relative ? ' → ' + row.relative : ''}${row.message ? ' / ' + row.message : ''}`;
            list.appendChild(item);
          }
          find('results').appendChild(list);
        };
        render(paging ? rows : rows.slice(0, size), paging?.offset || 0);
      };
      const invalidate = () => { panel._plan = null; find('run').hidden = true; };
      const clearConnectionView = () => {
        cancelDefault(); panel._needsFolderDefault = true;
        panel._refreshGeneration = (panel._refreshGeneration || 0) + 1;
        panel._checkedImportRecovery = panel._checkedPreviewRecovery = true;
        invalidate(); output([]);
        panel._previewJob = panel._job = null;
        find('progress').textContent = '';
        find('preview').textContent = '対象と保存先を確認';
      };
      const setBusy = busy => {
        panel._busy = busy;
        for (const id of ['json', 'json-choose', 'connect', 'disconnect', 'delete', 'docs', 'sheets', 'source', 'subfolder', 'folder', 'folder-auto', 'preview', 'run']) find(id).disabled = busy;
        updatePreviewEnabled();
      };
      const changeConnection = async action => {
        if (panel._authStarting) return;
        panel._authStarting = true;
        clearConnectionView(); setBusy(true);
        try { await action(); }
        finally { panel._authStarting = false; await refresh(); }
      };
      const act = fn => async () => {
        try { await fn(); }
        catch (err) { message(err.userMessage || err.message || '操作に失敗しました'); }
      };
      const watchPreview = async jobId => {
        if (panel._watchingPreview === jobId) return;
        panel._watchingPreview = jobId;
        try {
          while (panel.isConnected && panel._previewJob === jobId) {
            const job = await apiFetch(`/google-import/local/preview-jobs/${encodeURIComponent(jobId)}`, { silentError: true });
            if (!panel.isConnected || panel._previewJob !== jobId) return;
            const progressLabel = { running: '確認中', done: '確認完了', failed: '確認失敗', cancelled: '確認停止', expired: '確認やり直し' }[job.status] || '確認結果';
            const phaseLabel = job.status === 'running' ? (({ documents: '文書・表を検索', locations: '保存場所を確認', shortcuts: '文書・表へのリンクを確認' }[job.phase] || '')
              + (job.scope_label ? ' / ' + job.scope_label : '')) : '';
            find('progress').textContent = `${progressLabel}${phaseLabel ? '（' + phaseLabel + '）' : ''}: 文書・表取得 ${job.loaded ?? 0}件 / 保存場所確認 ${job.checked ?? 0}件 / 必要フォルダ ${job.folders ?? 0} / 文書・表へのリンク確認 ${job.aliases ?? 0}件 / 一覧 ${job.found}件`;
            find('preview-cancel').disabled = !!job.cancel;
            if (job.status === 'running') {
              if (job.cancel) message('停止を要求しました。実行中のGoogle応答が戻り次第停止します。');
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
            panel._previewJob = null;
            find('preview-cancel').hidden = true;
            if (job.status === 'done') {
              const plan = job.result;
              panel._plan = plan.plan_id;
              output(plan.items, { total: plan.total, offset: plan.offset, load: offset => apiFetch(`/google-import/local/plans/${encodeURIComponent(plan.plan_id)}?offset=${offset}`, { silentError: true }) });
              find('run').textContent = '確認した保存先へ取り込む';
              find('run').hidden = !plan.ready;
              message(`対象 ${plan.total}件。保存先と要確認・未対応の項目を確認してください。成功済みコピーは上書きしません。`);
            } else {
              invalidate(); output([]);
              find('preview').textContent = job.resumable ? '全体の確認を再開' : '対象と保存先を確認';
              message(job.message || '対象の確認を完了できませんでした。もう一度確認してください。');
            }
            await refresh();
            return;
          }
        } catch (err) {
          message(`進捗を取得できませんでした。確認処理は続いている場合があります。「接続状態を更新」で再確認してください。${err.userMessage || err.message || ''}`);
        } finally {
          if (panel._watchingPreview === jobId) panel._watchingPreview = null;
        }
      };
      const watchImport = async jobId => {
        if (panel._watchingImport === jobId) return;
        panel._watchingImport = jobId;
        find('cancel').hidden = false;
        try {
          while (panel.isConnected && panel._job === jobId) {
            const job = await apiFetch(`/google-import/local/jobs/${encodeURIComponent(jobId)}`, { silentError: true });
            if (!panel.isConnected || panel._job !== jobId) return;
            if (job.status === 'running') {
              message(job.cancel ? '停止を要求しました。確定済みファイルは残ります。' : `全体を取り込み中 ${job.processed} / ${job.total}`);
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
            panel._job = null;
            find('cancel').hidden = true;
            const result = job.result;
            if (result) {
              output(result.items, { total: result.total, offset: result.offset, load: offset => apiFetch(`/google-import/local/jobs/${encodeURIComponent(jobId)}?offset=${offset}`, { silentError: true }).then(value => value.result) });
              message(`${job.status === 'failed' ? '取り込み停止: ' + (job.message || '') + ' / ' : ''}取り込み結果: 作成${result.created} / 警告${result.warnings} / スキップ${result.skipped} / 失敗${result.failed} / 要確認${result.blocked} / 未対応${result.unsupported} / 未処理${result.unprocessed}。`);
              invalidate();
              if (result.retry_requires_preview) {
                find('preview').textContent = '全体を確認し直す';
              } else if (job.status === 'failed' || result.failed || result.unprocessed) {
                panel._plan = result.plan_id;
                find('run').textContent = '失敗・未処理をまとめて再試行';
                find('run').hidden = false;
              }
              if (typeof reloadOutlinerTree === 'function') await reloadOutlinerTree();
            } else {
              invalidate();
              if (job.plan_id) {
                panel._plan = job.plan_id;
                find('run').textContent = '失敗・未処理をまとめて再試行';
                find('run').hidden = false;
              }
              message(job.message || '取り込みを開始できませんでした。再試行してください。');
            }
            await refresh();
            return;
          }
        } catch (err) {
          message(`取り込みの進捗を取得できませんでした。処理は続いている場合があります。「接続状態を更新」で戻ってください。${err.userMessage || err.message || ''}`);
        } finally {
          if (panel._watchingImport === jobId) panel._watchingImport = null;
        }
      };
      const refresh = async () => {
        const generation = panel._refreshGeneration = (panel._refreshGeneration || 0) + 1;
        const status = await apiFetch('/google-import/personal/status', { silentError: true });
        if (!panel.isConnected || panel._refreshGeneration !== generation) return;
        const wasConnected = panel._connected;
        panel._connected = !!status.connected;
        find('state').textContent = status.reason || `${status.configured ? '設定登録済み' : '設定未登録'} / ${status.connected ? '接続済み' : '未接続'}${status.account ? ' / ' + status.account : ''}${status.busy ? ' / 処理中' : ''}`;
        find('json-choose').textContent = status.configured ? '認証設定JSONを差し替える' : '認証設定JSONを登録';
        find('json-status').textContent = status.reason || (status.configured
          ? '認証設定JSONは登録済みです。変更する場合だけ、別のJSONを選択してください。'
          : '認証設定JSONは未登録です。Google Cloudから取得したJSONを選択して登録してください。');
        root.querySelector('#google-import-connection-state').textContent = status.configured
          ? `${root._googlePayload?.connection?.connected ? '管理者用 接続済み / ' : ''}個人用 ${status.connected ? '接続済み' : '未接続'}`
          : stateLabel(root._googlePayload);
        const managedAvailable = !!(root._googlePayload?.connection?.connected || root._googlePayload?.capabilities?.can_connect || root._googlePayload?.capabilities?.can_import);
        root.querySelectorAll('[data-google-desktop-control]').forEach(element => { element.hidden = !managedAvailable; });
        root.querySelector('#google-import-capability').textContent = managedAvailable
          ? '管理者用Google接続の設定です。個人用の接続・保存先は上の設定を使います。'
          : '';
        root.querySelector('#google-import-capability').hidden = !managedAvailable;
        const selected = find('source').value;
        find('source').replaceChildren();
        const empty = document.createElement('option');
        empty.value = ''; empty.textContent = 'ローカルソースフォルダを選択';
        find('source').appendChild(empty);
        for (const row of status.source_folders || []) {
          const option = document.createElement('option');
          option.value = row.path; option.textContent = row.name || row.path;
          find('source').appendChild(option);
        }
        if (selected) find('source').value = selected;
        if (selected && find('source').value !== selected) {
          cancelDefault(); panel._folderManual = false;
          find('source').value = '';
          find('folder').value = PERSONAL_MY_DRIVE_URL;
          scopeLabel();
          invalidate();
          output([]);
          find('progress').textContent = '';
          message('保存先の登録が変わりました。ローカルソースフォルダを選び、対象を確認し直してください。');
        }
        const importJob = status.import_job;
        if (importJob) {
          const summary = importJob.result_summary;
          root.querySelector('#google-import-last-run').textContent = importJob.status === 'running'
            ? `個人用 取り込み中 ${importJob.processed} / ${importJob.total}`
            : summary ? `個人用 前回: 作成${summary.created} / スキップ${summary.skipped} / 失敗${summary.failed} / 要確認${summary.blocked} / 未対応${summary.unsupported} / 未処理${summary.unprocessed}`
              : '個人用 前回: 開始失敗';
        } else {
          root.querySelector('#google-import-last-run').textContent = lastRunLabel(root._googlePayload?.config?.run_state);
        }
        const importNewer = importJob && (!status.preview_job || importJob.created >= status.preview_job.created);
        const restoreImport = importJob && (importJob.status === 'running' || panel._job === importJob.job_id || (!panel._checkedImportRecovery && importNewer));
        panel._checkedImportRecovery = true;
        if (restoreImport) {
          cancelDefault(); panel._folderManual = true;
          restoreTargets(importJob);
          const normalize = value => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
          const source = normalize(importJob.source);
          const match = (status.source_folders || []).filter(row => source === normalize(row.path) || source.startsWith(normalize(row.path) + '/'))
            .sort((a, b) => b.path.length - a.path.length)[0];
          if (match) {
            find('source').value = match.path;
            find('subfolder').value = importJob.source.slice(match.path.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '');
            find('folder').value = importJob.folder_url;
            scopeLabel();
          }
          panel._job = importJob.job_id;
          void watchImport(importJob.job_id);
        }
        const job = status.preview_job;
        const recover = !restoreImport && job && (job.status === 'running' || panel._previewJob === job.job_id || !panel._checkedPreviewRecovery);
        panel._checkedPreviewRecovery = true;
        if (recover) {
          cancelDefault(); panel._folderManual = true;
          restoreTargets(job);
          // Reopening settings must reattach to the existing scan, never start
          // another one or use the old destination left in the form.
          const normalized = value => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
          const source = normalized(job.source);
          const match = (status.source_folders || []).filter(row => source === normalized(row.path) || source.startsWith(normalized(row.path) + '/'))
            .sort((a, b) => b.path.length - a.path.length)[0];
          if (match) {
            find('source').value = match.path;
            find('subfolder').value = job.source.slice(match.path.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '');
            find('folder').value = job.folder_url;
            scopeLabel();
            panel._previewJob = job.job_id;
            find('preview-cancel').hidden = job.status !== 'running';
            find('preview-cancel').disabled = !!job.cancel;
            void watchPreview(job.job_id);
          } else {
            invalidate();
          }
        }
        const busy = !!status.busy || !!panel._previewStarting || !!panel._importStarting || !!panel._authStarting;
        setBusy(busy);
        find('connect').disabled = !status.configured || !status.available || busy;
        updatePreviewEnabled();
        find('run').disabled = busy;
        for (const id of ['json', 'json-choose', 'disconnect', 'delete', 'docs', 'sheets', 'source', 'subfolder', 'folder', 'folder-auto']) find(id).disabled = busy;
        if (!busy && status.connected && !restoreImport && !recover && find('source').value && !panel._folderManual
            && (panel._needsFolderDefault || (!wasConnected && status.connected))) void applyFolderDefault();
      };
      panel._refresh = refresh;
      find('json-choose').addEventListener('click', () => find('json').click());
      find('json').addEventListener('change', act(async () => {
        const file = find('json').files?.[0];
        if (!file) return;
        if (file.size > 65536) throw new Error('認証設定JSONは64KB以下で指定してください');
        await changeConnection(async () => {
          await apiPost('/google-import/personal/credentials', { content: await file.text() }, { silentError: true });
          find('json').value = '';
          message('認証設定をこのPCの秘密ストアへ登録しました。Googleに接続してください。');
        });
      }));
      find('connect').addEventListener('click', act(async () => {
        await changeConnection(async () => {
          const result = await apiPost('/google-import/personal/oauth/start', {}, { silentError: true });
          await openExternal(result.auth_url);
          message('ブラウザで認証後、「接続状態を更新」を押してください。');
        });
      }));
      find('refresh').addEventListener('click', act(refresh));
      for (const id of ['disconnect', 'delete']) find(id).addEventListener('click', act(async () => {
        const prompt = id === 'delete' ? 'このPCの個人用Google認証設定を削除しますか？取り込み済みファイルは残ります。' : '個人用Google接続を解除しますか？取り込み済みファイルは残ります。';
        if (!(typeof cfConfirm === 'function' ? await cfConfirm(prompt) : window.confirm(prompt))) return;
        await changeConnection(async () => {
          await apiPost('/google-import/personal/' + (id === 'delete' ? 'credentials' : 'disconnect'), {}, { method: id === 'delete' ? 'DELETE' : 'POST', silentError: true });
        });
      }));
      const selectionChanged = () => {
        invalidate(); output([]);
        find('preview').textContent = '対象と保存先を確認';
        find('progress').textContent = '';
        updatePreviewEnabled();
        message(selectedTargets().length ? '対象と保存先を確認してください。' : '取り込み対象を1つ以上選択してください。');
      };
      find('source').addEventListener('input', () => {
        find('subfolder').value = '';
        selectionChanged();
        void applyFolderDefault();
      });
      find('subfolder').addEventListener('input', () => {
        selectionChanged();
        if (!panel._folderManual) queueFolderDefault();
      });
      find('folder').addEventListener('input', () => {
        cancelDefault(); panel._folderManual = true;
        scopeLabel(); selectionChanged();
        if (!find('folder').value.trim()) message('GoogleフォルダURLを入力するか「全体のURLを設定」を押してください。');
      });
      find('folder-auto').addEventListener('click', () => {
        find('subfolder').value = '';
        selectionChanged();
        void applyFolderDefault();
      });
      for (const id of ['docs', 'sheets']) find(id).addEventListener('change', selectionChanged);
      find('preview').addEventListener('click', act(async () => {
        invalidate();
        find('preview').textContent = '対象と保存先を確認';
        output([]);
        find('progress').textContent = '';
        message('Googleの対象とローカルの保存先を確認しています...');
        find('preview').disabled = true;
        panel._previewStarting = true;
        setBusy(true);
        try {
          if (!find('source').value) throw new Error('取り込み先のローカルソースフォルダを選択してください');
          const targets = selectedTargets();
          if (!targets.length) throw new Error('取り込み対象を1つ以上選択してください。');
          if (!find('folder').value.trim()) throw new Error('対応するGoogleフォルダURLを入力してください。マイドライブ全体は https://drive.google.com/drive/folders/root です。');
          const source = find('source').value.replace(/[\\/]+$/, '') + (find('subfolder').value.trim() ? '/' + find('subfolder').value.trim() : '');
          const job = await apiPost('/google-import/local/preview-jobs', { source, folder_url: find('folder').value.trim(), targets }, { silentError: true });
          panel._previewJob = job.job_id;
        } finally {
          panel._previewStarting = false;
          await refresh();
        }
      }));
      find('preview-cancel').addEventListener('click', act(async () => {
        if (!panel._previewJob) return;
        await apiPost(`/google-import/local/preview-jobs/${encodeURIComponent(panel._previewJob)}/cancel`, {}, { silentError: true });
        find('preview-cancel').disabled = true;
        message('停止を要求しました。実行中のGoogle応答が戻り次第停止します。取り込みは実行していません。');
      }));
      find('cancel').addEventListener('click', act(async () => {
        if (panel._job) await apiPost(`/google-import/local/jobs/${encodeURIComponent(panel._job)}/cancel`, {}, { silentError: true });
        message('停止を要求しました。確定済みファイルは残ります。');
      }));
      find('run').addEventListener('click', act(async () => {
        if (!panel._plan) return;
        find('run').disabled = true;
        panel._importStarting = true;
        setBusy(true);
        try {
          panel._job = (await apiPost('/google-import/local/run', { plan_id: panel._plan }, { silentError: true })).job_id;
          find('cancel').hidden = false;
        } finally {
          panel._importStarting = false;
          await refresh();
        }
      }));

    }
    try { await panel._refresh(); }
    catch (err) { panel.querySelector('#google-personal-state').textContent = err.userMessage || err.message || '個人用設定を取得できません'; }
  }

  function mount(target) {
    const root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) return Promise.resolve();
    if (root.dataset.googleImportMounted !== '1') {
      root.dataset.googleImportMounted = '1';
      renderShell(root);
      bind(root);
    }
    return load(root).then(() => mountPersonal(root));
  }

  window.MeldexGoogleImportSettings = { mount, canManage, isCloudSurface, TARGET_LABELS };
})();

if (typeof window.__loadSplitScript === 'function') {
  window.__loadSplitScript('gb-google-import-settings.js', ['gb-google-import-cloud.js']);
}
