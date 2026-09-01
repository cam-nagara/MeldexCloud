(function () {
  'use strict';

  const rootId = 'x-bookmarks-settings-container';
  const X_DEVELOPER_CONSOLE_URL = 'https://console.x.com/';
  const X_DEVELOPER_CONSOLE_HELP = 'X Developer Consoleを開きます。左側の「クレジット」で残高を購入し、「使用状況」で取得件数と費用、「支払い」で支払方法を確認します。自動チャージは任意です。使う場合は利用上限も設定してください。毎月自動補充されるX API無料枠は案内されていません。xAI用の無料クレジットはXブックマーク取得には使えません。';
  let syncInFlight = false;
  let _currentSchedule = null;
  let _scheduleWidget = null;

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null ? '' : String(value);
  }

  function setStatus(message, isError, options = {}) {
    const el = document.getElementById('x-bookmarks-status-message');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--fg2)';
    const action = document.getElementById('x-bookmarks-credits-action');
    if (!action) return;
    const actionUrl = String(options?.actionUrl || '').trim();
    action.hidden = !actionUrl;
    action.onclick = actionUrl ? () => openUrl(actionUrl) : null;
  }

  function getInputValue(id, fallback) {
    const value = document.getElementById(id)?.value;
    const text = value == null ? '' : String(value).trim();
    return text || fallback || '';
  }

  function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? '' : String(value);
  }

  function stopReasonText(reason) {
    switch (reason) {
      case 'requested_limit':
        return '設定件数に到達';
      case 'no_next_page':
        return 'X APIから次ページが返されず終了';
      case 'no_data':
        return '取得できるポストがなく終了';
      case 'incremental_existing_page':
        return '差分保存は既存ページで停止';
      default:
        return '';
    }
  }

  function syncSummary(data, prefix) {
    const fetched = Number(data?.fetched || 0);
    const requested = Number(data?.requested_limit || 0);
    const pages = Number(data?.pages || 0);
    const reason = stopReasonText(data?.stop_reason);
    const countText = requested ? `取得${fetched}/${requested}件` : `取得${fetched}件`;
    const pageText = pages ? ` / ${pages}ページ` : '';
    const folderText = data?.folder_count
      ? ` / フォルダ${data.folder_count} / フォルダ反映${data?.folder_updates || 0}`
      : (data?.folder_error ? ' / フォルダ取得失敗' : '');
    const folderStateText = ` / フォルダ未取得${data?.folder_pending || 0} / 再試行待ち${data?.folder_failed || 0}`;
    const itemText = `新規${data?.created || 0} / 更新${data?.updated || 0} / スキップ${data?.skipped || 0} / 画像${data?.downloaded_media || 0} / 投稿者アイコン${data?.downloaded_author_icons || 0} / 画像失敗${data?.media_failed || 0} / アイコン失敗${data?.author_icon_failed || 0}${folderText}`;
    const reasonText = reason ? ` / 停止: ${reason}` : '';
    return `${prefix || ''}${countText}${pageText} / ${itemText}${folderStateText}${reasonText}`;
  }

  function openUrl(url) {
    if (!url) return;
    if (typeof apiPost === 'function') {
      apiPost('/open-external-url', { url }, { silentError: true }).catch(() => window.open(url, '_blank', 'noopener'));
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  async function loadStatus(options = {}) {
    const container = document.getElementById(rootId);
    if (!container || typeof apiFetch !== 'function') return;
    if (!options?.preserveStatus) setStatus('X連携の状態を確認しています...', false);
    try {
      const data = await apiFetch('/x-bookmarks/status', { silentError: true });
      const user = data.user || {};
      setText('x-bookmarks-connection', data.connected ? `接続済み: @${user.username || ''}` : '未接続');
      const config = data.config || {};
      setText('x-bookmarks-client-state', config.client_id_configured ? 'X接続設定済み' : 'X接続用Client IDが未設定');
      const saveDir = document.getElementById('x-bookmarks-save-dir');
      const maxResults = document.getElementById('x-bookmarks-max-results');
      if (saveDir) saveDir.value = config.save_dir || 'Xブックマーク';
      if (maxResults) maxResults.value = String(config.max_results || 100);
      const scheduledFolders = document.getElementById('x-bookmarks-scheduled-folders');
      if (scheduledFolders) scheduledFolders.checked = config.scheduled_include_folders === true;
      setInputValue('x-bookmarks-client-id', config.client_id || '');
      setInputValue('x-bookmarks-redirect-uri', config.redirect_uri || '');
      setInputValue('x-bookmarks-auth-url', config.auth_url || '');
      setInputValue('x-bookmarks-token-url', config.token_url || '');
      setInputValue('x-bookmarks-api-base', config.api_base || '');
      const last = config.last_sync;
      setText(
        'x-bookmarks-last-sync',
        last?.at
          ? syncSummary(last, '前回保存: ')
          : '前回保存: なし'
      );
      _currentSchedule = config.schedule || null;
      _initScheduleWidget(config.schedule, config.schedule_state);
      if (!options?.preserveStatus) {
        const alert = data.alert;
        setStatus(
          alert?.message || data.message || 'Xブックマーク保存を使えます。',
          !!alert || !config.client_id_configured,
          { actionUrl: alert?.action_url }
        );
      }
    } catch (err) {
      setStatus('X連携の状態を取得できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  // 定期実行の判断・実行はバックエンド（meldex_import_scheduler.py）が担う。
  // ここでは周期を選ばせて保存し、バックエンドが確定した次回予定・前回結果を
  // 表示するだけにする（ブラウザータイマーでの自己実行はしない）。
  function _initScheduleWidget(schedule, scheduleState) {
    const container = document.getElementById('x-bookmarks-schedule-container');
    if (!container) return;
    if (!_scheduleWidget) {
      _scheduleWidget = window.MeldexScheduler?.createWidget(container, schedule, (cfg) => {
        _currentSchedule = cfg;
        saveConfig({ silentError: true });
      });
    }
    _scheduleWidget?.setStatusText(_formatScheduleState(scheduleState));
  }

  function _formatScheduleState(state) {
    if (!state) return '';
    const parts = [];
    if (state.next_run_display) parts.push(`次回予定: ${state.next_run_display}`);
    if (state.last_run) {
      const label = state.last_run.status === 'done' ? '成功' : (state.last_run.status === 'error' ? '失敗' : state.last_run.status);
      parts.push(`前回自動実行: ${label}`);
    }
    if (state.needs_attention) parts.push('連続で失敗しています。設定をご確認ください。');
    return parts.join(' / ');
  }

  async function saveConfig(options = {}) {
    const silentError = options?.silentError === true;
    if (typeof apiPost !== 'function') {
      if (!silentError) setStatus('設定を保存できませんでした: APIを利用できません', true);
      return false;
    }
    const saveDir = document.getElementById('x-bookmarks-save-dir')?.value || 'Xブックマーク';
    const maxResults = Number(document.getElementById('x-bookmarks-max-results')?.value || 100);
    const clientId = getInputValue('x-bookmarks-client-id');
    const redirectUri = getInputValue('x-bookmarks-redirect-uri');
    const authUrl = getInputValue('x-bookmarks-auth-url');
    const tokenUrl = getInputValue('x-bookmarks-token-url');
    const apiBase = getInputValue('x-bookmarks-api-base');
    const schedulePayload = _scheduleWidget ? _scheduleWidget.getCurrentConfig() : _currentSchedule;
    try {
      const body = {
        save_dir: saveDir,
        max_results: maxResults,
        client_id: clientId,
        redirect_uri: redirectUri,
        auth_url: authUrl,
        token_url: tokenUrl,
        api_base: apiBase,
        scheduled_include_folders: document.getElementById('x-bookmarks-scheduled-folders')?.checked === true,
      };
      if (schedulePayload) body.schedule = schedulePayload;
      await apiPost('/x-bookmarks/config', body, { silentError: true });
      if (options?.showSuccess) {
        await loadStatus();
        setStatus('X接続設定を保存しました。', false);
      }
      return true;
    } catch (err) {
      if (!silentError) setStatus('設定を保存できませんでした: ' + (err.userMessage || err.message || err), true);
      return false;
    }
  }

  async function connect() {
    try {
      setStatus('Xの許可画面を開いています...', false);
      const saved = await saveConfig({ silentError: false });
      if (!saved) return;
      const data = await apiPost('/x-bookmarks/auth/start', { open_browser: false }, { silentError: true });
      openUrl(data.auth_url);
      setStatus('Xの画面で許可したあと、Meldexへ戻ってください。', false);
    } catch (err) {
      setStatus(err.userMessage || err.message || String(err), true);
    }
  }

  async function disconnect() {
    if (typeof apiFetch !== 'function') return;
    try {
      await apiFetch('/x-bookmarks/token', { method: 'DELETE', silentError: true });
      setStatus('X連携を解除しました。保存済みファイルは残ります。', false);
      await loadStatus();
    } catch (err) {
      setStatus('解除できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  function setSyncBusy(isBusy) {
    ['x-bookmarks-sync', 'x-bookmarks-sync-folders', 'x-bookmarks-duplicates'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !!isBusy;
    });
  }

  function confirmBookmarkSyncCost(maxResults) {
    const limit = Math.max(1, Number(maxResults) || 100);
    const estimatedOwnedUsd = limit * 0.001;
    const estimatedStandardUsd = limit * 0.005;
    const message = `Xブックマークを最大${limit.toLocaleString('ja-JP')}件まで確認します。\n現在の公式料金例では、最大取得数分の目安は約$${estimatedOwnedUsd.toFixed(2)}〜$${estimatedStandardUsd.toFixed(2)}です。フォルダ内の確認分は別に加算され、割引条件や料金変更によって実際の費用は変わります。\n\n従量課金で保存を始めますか？`;
    return window.confirm(message);
  }

  async function sync(mode) {
    if (syncInFlight) return;
    const maxResults = Number(document.getElementById('x-bookmarks-max-results')?.value || 100);
    if (!confirmBookmarkSyncCost(maxResults)) return;
    syncInFlight = true;
    setSyncBusy(true);
    try {
      const saved = await saveConfig({ silentError: true });
      if (!saved) {
        setStatus('設定を保存できなかったため、Xブックマーク保存を中止しました。', true);
        return;
      }
      setStatus('Xブックマークを保存しています...', false);
      const data = await runBackgroundJob(
        '/x-bookmarks/sync',
        { mode: mode || 'incremental', max_results: maxResults, ack_cost_notice: true },
        {
          onProgress: (progress) => {
            setStatus(formatJobProgress(progress, { unit: '件保存済み', defaultPhase: '取得中' }), false);
          },
        }
      );
      await loadStatus({ preserveStatus: true });
      setStatus(syncSummary(data, '保存しました。'), false);
    } catch (err) {
      const payload = err.errorDetail || err.payload?.detail;
      if (payload?.reason_code === 'x_api_credits_depleted') {
        setStatus(payload.message, true, { actionUrl: payload.action_url });
        return;
      }
      if (payload?.retry_at) {
        setStatus(`${payload.message || 'X APIの取得上限に達しました'} 再実行目安: ${payload.retry_at}`, true);
        return;
      }
      setStatus('保存できませんでした: ' + (err.userMessage || err.message || err), true);
    } finally {
      syncInFlight = false;
      setSyncBusy(false);
    }
  }

  async function syncFolders() {
    if (syncInFlight) return;
    if (!window.confirm('Xのフォルダ一覧と各フォルダ内容を追加取得します。従量課金でフォルダ情報を更新しますか？')) return;
    syncInFlight = true;
    setSyncBusy(true);
    try {
      setStatus('フォルダ情報を更新しています...', false);
      const data = await runBackgroundJob(
        '/x-bookmarks/folders/sync', { ack_cost_notice: true },
        { onProgress: (progress) => setStatus(formatJobProgress(progress, { unit: '件確認済み', defaultPhase: 'フォルダ情報を取得中' }), false) }
      );
      await loadStatus({ preserveStatus: true });
      setStatus(`フォルダ情報を更新しました。反映${data?.folder_updates || 0} / 未取得${data?.folder_pending || 0} / 再試行待ち${data?.folder_failed || 0}`, false);
    } catch (err) {
      setStatus('フォルダ情報を更新できませんでした。再試行できます: ' + (err.userMessage || err.message || err), true);
    } finally {
      syncInFlight = false;
      setSyncBusy(false);
    }
  }

  function _postIdFromEntity(data) {
    const direct = String(data?.post_id || '').trim();
    if (direct) return direct;
    const values = data?.properties?.['ポストID'];
    for (const item of Array.isArray(values) ? values : []) {
      const value = String(item?.value ?? item ?? '').trim();
      if (value) return value;
    }
    const urlValues = data?.properties?.URL;
    for (const item of Array.isArray(urlValues) ? urlValues : []) {
      const value = String(item?.value ?? item ?? '');
      const match = value.match(/(?:x\.com|twitter\.com)\/[^/]+\/status(?:es)?\/(\d+)/i);
      if (match) return match[1];
    }
    return '';
  }

  async function reimportPost(postId, saveDir) {
    const id = String(postId || '').trim();
    if (!id) throw new Error('ポストIDを確認できません');
    const result = await apiPost('/x-bookmarks/reimport', {
      post_id: id,
      save_dir: saveDir || undefined,
    }, { silentError: true });
    if (typeof showStatus === 'function') showStatus('Xからこのポストを再インポートしました');
    return result;
  }

  async function reimportEntry(entryPath, saveDir) {
    const data = await apiFetch('/entity?path=' + encodeURIComponent(entryPath), { silentError: true });
    return reimportPost(_postIdFromEntity(data), saveDir);
  }

  let _duplicateDialog = null;

  function _closeDuplicateModal(reason = 'programmatic') {
    _duplicateDialog?.close?.(reason);
    _duplicateDialog = null;
  }

  async function showDuplicateRepair(options = {}) {
    const returnFocus = options.returnFocus || document.activeElement;
    setStatus('重複を確認しています...', false);
    try {
      const saveDir = getInputValue('x-bookmarks-save-dir', 'Xブックマーク');
      const data = await apiFetch('/x-bookmarks/duplicates?save_dir=' + encodeURIComponent(saveDir), { silentError: true });
      _closeDuplicateModal('superseded');
      const body = document.createElement('div');
      body.className = 'x-bookmarks-duplicates-body';
      const desc = document.createElement('p');
      desc.className = 'gb-section-desc';
      desc.dataset.e2eId = 'x-bookmarks-duplicates-summary';
      desc.textContent = data.group_count
        ? `${data.group_count}組、${data.duplicate_row_count}行の重複があります。最古の行を残し、最新のX情報と全行の追記・タグ・リレーションを統合します。統合後の重複行はゴミ箱へ移します。`
        : '整理が必要な重複はありません。';
      const list = document.createElement('div');
      list.className = 'x-bookmarks-duplicates-list';
      list.dataset.e2eId = 'x-bookmarks-duplicates-list';
      (data.groups || []).forEach((group, index) => {
        const row = document.createElement('label');
        row.className = 'x-bookmarks-duplicate-row';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = true;
        check.value = group.post_id;
        check.dataset.xDuplicatePostId = group.post_id;
        check.dataset.e2eId = `x-bookmarks-duplicate-choice-${index}`;
        const body = document.createElement('span');
        body.className = 'x-bookmarks-duplicate-copy';
        const primary = document.createElement('strong');
        primary.textContent = `ポスト ${group.post_id}（${group.row_count}行）`;
        const detail = document.createElement('span');
        detail.className = 'x-bookmarks-duplicate-detail';
        detail.textContent = `採用: ${group.canonical_path} / 削除: ${(group.duplicate_paths || []).join(', ')}`;
        body.appendChild(primary);
        body.appendChild(detail);
        row.appendChild(check);
        row.appendChild(body);
        list.appendChild(row);
      });
      const dialogStatus = document.createElement('div');
      dialogStatus.className = 'gb-section-desc x-bookmarks-duplicates-status';
      dialogStatus.dataset.e2eId = 'x-bookmarks-duplicates-status';
      dialogStatus.setAttribute('aria-live', 'polite');
      body.append(desc, list, dialogStatus);
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'gb-btn gb-btn-quiet';
      cancel.dataset.e2eId = 'x-bookmarks-duplicates-close';
      cancel.textContent = '閉じる';
      let repair = null;
      let busy = false;
      let dialogApi = null;
      const setBusy = value => {
        busy = !!value;
        dialogApi?.overlay?.setAttribute('aria-busy', busy ? 'true' : 'false');
        list.querySelectorAll('input').forEach(input => { input.disabled = busy; });
        if (repair) repair.disabled = busy;
        cancel.disabled = busy;
      };
      if (data.group_count) {
        repair = document.createElement('button');
        repair.type = 'button';
        repair.className = 'gb-btn gb-btn-primary';
        repair.dataset.e2eId = 'x-bookmarks-duplicates-repair';
        repair.textContent = '選択した重複を統合';
        repair.addEventListener('click', async () => {
          const postIds = Array.from(list.querySelectorAll('[data-x-duplicate-post-id]:checked')).map(input => input.value);
          if (!postIds.length) {
            dialogStatus.textContent = '統合する重複を1件以上選択してください。';
            return;
          }
          setBusy(true);
          repair.textContent = '統合しています...';
          dialogStatus.textContent = '選択した重複を統合しています...';
          try {
            const result = await apiPost('/x-bookmarks/duplicates/repair', {
              save_dir: saveDir,
              post_ids: postIds,
            }, { silentError: true });
            _closeDuplicateModal('complete');
            setStatus(`重複${result.group_count || 0}組を統合し、${result.trashed_count || 0}行をゴミ箱へ移しました。`, false);
            if (typeof reloadCurrentOpenFile === 'function') reloadCurrentOpenFile();
          } catch (error) {
            setBusy(false);
            repair.textContent = '選択した重複を統合';
            const message = '重複を整理できませんでした: ' + (error.userMessage || error.message || error);
            dialogStatus.textContent = message;
            setStatus(message, true);
          }
        });
      }
      dialogApi = window.GBUI.createModal({
        id: 'x-bookmarks-duplicates-dialog',
        title: 'Xブックマークの重複を整理',
        body,
        footer: repair ? [cancel, repair] : cancel,
        variant: 'standard',
        extraClass: 'x-bookmarks-duplicates-modal',
        geometryKey: 'x-bookmarks-duplicates',
        initialFocus: data.group_count ? '[data-e2e-id="x-bookmarks-duplicate-choice-0"]' : '[data-e2e-id="x-bookmarks-duplicates-close"]',
        returnFocus,
        onBeforeClose: reason => !busy || reason === 'complete' || reason === 'superseded',
        onClose: () => {
          if (_duplicateDialog === dialogApi) _duplicateDialog = null;
        },
      });
      _duplicateDialog = dialogApi;
      dialogApi.overlay.classList.add('modal-overlay');
      dialogApi.overlay.dataset.xDuplicatesModal = '1';
      dialogApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'x-bookmarks-duplicates-close-icon');
      cancel.addEventListener('click', () => dialogApi.close('close-button'));
      dialogApi.open();
      setStatus(data.group_count ? '統合内容を確認してください。' : '重複はありません。', false);
    } catch (error) {
      setStatus('重複を確認できませんでした: ' + (error.userMessage || error.message || error), true);
    }
  }

  function bind() {
    document.getElementById('x-bookmarks-connect')?.addEventListener('click', connect);
    document.getElementById('x-bookmarks-disconnect')?.addEventListener('click', disconnect);
    document.getElementById('x-bookmarks-sync')?.addEventListener('click', () => sync('incremental'));
    document.getElementById('x-bookmarks-sync-folders')?.addEventListener('click', syncFolders);
    const consoleLink = document.getElementById('x-bookmarks-console-link');
    if (consoleLink) {
      consoleLink.setAttribute('data-gb-tooltip', X_DEVELOPER_CONSOLE_HELP);
      consoleLink.setAttribute('aria-label', X_DEVELOPER_CONSOLE_HELP);
      consoleLink.addEventListener('click', () => openUrl(X_DEVELOPER_CONSOLE_URL));
    }
    const duplicatesButton = document.getElementById('x-bookmarks-duplicates');
    duplicatesButton?.addEventListener('click', () => showDuplicateRepair({ returnFocus: duplicatesButton }));
    document.getElementById('x-bookmarks-save-config')?.addEventListener('click', () => saveConfig({ showSuccess: true }));
    document.getElementById('x-bookmarks-save-dir')?.addEventListener('change', saveConfig);
    document.getElementById('x-bookmarks-max-results')?.addEventListener('change', saveConfig);
    document.getElementById('x-bookmarks-scheduled-folders')?.addEventListener('change', saveConfig);
    [
      'x-bookmarks-client-id',
      'x-bookmarks-redirect-uri',
      'x-bookmarks-auth-url',
      'x-bookmarks-token-url',
      'x-bookmarks-api-base',
    ].forEach(id => {
      document.getElementById(id)?.addEventListener('change', saveConfig);
    });
  }

  function renderXBookmarksSettings(scope) {
    const container = (scope || document).querySelector?.('#' + rootId) || document.getElementById(rootId);
    if (!container) return;
    // OAuth中継を持たないDropbox直結のCloud静的版では、押しても成立しない
    // デスクトップ専用操作（X接続・差分保存等）を表示しない。gb-external-import.js
    // が定義する既存判定をそのまま再利用する（新しい判定は作らない）。
    if (window.isCloudStaticImportSurface?.()) {
      container.hidden = true;
      container.dataset.cloudDesktopOnlyHidden = '1';
      return;
    }
    container.hidden = false;
    delete container.dataset.cloudDesktopOnlyHidden;
    if (container.dataset.rendered === '1') {
      loadStatus();
      return;
    }
    container.dataset.rendered = '1';
    container.innerHTML = `
      <div class="gb-section-desc">X連携では投稿・フォロー・いいね・DM送信は行いません。 ${fieldHelp('Xに接続すると、自分のXブックマークを画像つきのシートエントリとして保存できます。')}</div>
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
        <span class="gb-section-desc">X APIは従量課金です。手動なら最大5,000件まで取得できます。</span>
        <button type="button" id="x-bookmarks-console-link" class="gb-btn gb-btn-sm gb-btn-quiet">${icon('externalLink', 14)} X Developer Console</button>
      </div>
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
        <span id="x-bookmarks-connection" class="gb-section-desc">状態を確認中...</span>
        <span id="x-bookmarks-client-state" class="gb-section-desc"></span>
      </div>
      <label class="gb-field">
        <span class="gb-label">保存先シート</span>
        <input id="x-bookmarks-save-dir" class="gb-input" type="text" value="Xブックマーク">
      </label>
      <label class="gb-field-row" style="justify-content:flex-start;">
        <span class="gb-label">取得件数 ${fieldHelp('手動保存は最大5,000件まで選べます。大量取得は有料です。開始前に費用目安を確認します。定期実行は意図しない課金を避けるため最新100件だけを確認し、フォルダ全体は読み直しません。')}</span>
        <select id="x-bookmarks-max-results" class="gb-select">
          <option value="100">最新100件</option>
          <option value="500">最新500件</option>
          <option value="1000">最新1000件</option>
          <option value="5000">最大5,000件（有料・大量取得）</option>
        </select>
      </label>
      <label class="gb-field">
        <span class="gb-label">X接続用Client ID ${fieldHelp('Xブックマークを読むための接続IDです')}</span>
        <input id="x-bookmarks-client-id" class="gb-input" type="text" autocomplete="off" placeholder="X Developer Portal で発行される接続ID">
      </label>
      <details class="gb-section gb-section--boxed" style="margin-top:8px;padding:8px;">
        <summary style="cursor:pointer;color:var(--fg);font-weight:600;">詳細接続設定</summary>
        <label class="gb-field" style="margin-top:8px;">
          <span class="gb-label">リダイレクトURI</span>
          <input id="x-bookmarks-redirect-uri" class="gb-input" type="text" autocomplete="off" placeholder="http://127.0.0.1:8001/api/x-bookmarks/auth/callback">
        </label>
        <label class="gb-field">
          <span class="gb-label">認可URL</span>
          <input id="x-bookmarks-auth-url" class="gb-input" type="text" autocomplete="off" placeholder="https://x.com/i/oauth2/authorize">
        </label>
        <label class="gb-field">
          <span class="gb-label">トークンURL</span>
          <input id="x-bookmarks-token-url" class="gb-input" type="text" autocomplete="off" placeholder="https://api.x.com/2/oauth2/token">
        </label>
        <label class="gb-field">
          <span class="gb-label">APIベースURL</span>
          <input id="x-bookmarks-api-base" class="gb-input" type="text" autocomplete="off" placeholder="https://api.x.com/2">
        </label>
      </details>
      <div id="x-bookmarks-last-sync" class="gb-section-desc">前回保存: なし</div>
      <div id="x-bookmarks-schedule-container" class="gb-section gb-section--boxed" style="margin-top:8px;padding:8px;"></div>
      <label class="gb-field-row" style="justify-content:flex-start;">
        <input id="x-bookmarks-scheduled-folders" type="checkbox">
        <span class="gb-label">定期保存でもXのフォルダを更新（追加料金あり） ${fieldHelp('フォルダ一覧と各フォルダ内容の追加API取得が発生します。既定はオフです。')}</span>
      </label>
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
        <button type="button" id="x-bookmarks-save-config" class="gb-btn gb-btn-sm">${icon('save', 14)} 接続設定を保存</button>
        <button type="button" id="x-bookmarks-connect" class="gb-btn gb-btn-sm">${icon('externalLink', 14)} Xに接続</button>
        <button type="button" id="x-bookmarks-sync" class="gb-btn gb-btn-sm">${icon('download', 14)} 差分を保存</button>
        <button type="button" id="x-bookmarks-sync-folders" class="gb-btn gb-btn-sm">${icon('refreshCw', 14)} フォルダ情報を更新</button>
        <button type="button" id="x-bookmarks-duplicates" class="gb-btn gb-btn-sm">${icon('copyCheck', 14)} 重複を整理</button>
        <button type="button" id="x-bookmarks-disconnect" class="gb-btn gb-btn-sm gb-btn-quiet">${icon('unlink', 14)} 接続を解除</button>
      </div>
      <div id="x-bookmarks-status-message" class="gb-section-desc"></div>
      <button type="button" id="x-bookmarks-credits-action" class="gb-btn gb-btn-sm gb-btn-quiet" hidden>${icon('externalLink', 14)} X Developer Consoleを開く</button>
    `;
    bind();
    setSyncBusy(syncInFlight);
    loadStatus();
  }

  window.renderXBookmarksSettings = renderXBookmarksSettings;
  window.reimportXBookmarkPost = reimportPost;
  window.reimportXBookmarkEntry = reimportEntry;
})();
