(function () {
  'use strict';

  const rootId = 'x-bookmarks-settings-container';
  const SHARED_SETTINGS_DOCUMENT = 'x-bookmarks-settings';
  const X_DEVELOPER_CONSOLE_URL = 'https://console.x.com/';
  const X_DEVELOPER_CONSOLE_HELP = 'X Developer Consoleを開きます。左側の「クレジット」で残高を購入し、「使用状況」で取得件数と費用、「支払い」で支払方法を確認します。自動チャージは任意です。使う場合は利用上限も設定してください。毎月自動補充されるX API無料枠は案内されていません。xAI用の無料クレジットはXブックマーク取得には使えません。';
  let syncInFlight = false;
  let _currentSchedule = null;
  let _scheduleWidget = null;
  let loadedSettings = {};
  let saveQueue = Promise.resolve();

  function isCloudSurface() {
    return window.isCloudStaticImportSurface?.() === true;
  }

  function settingsPayload() {
    return {
      save_dir: document.getElementById('x-bookmarks-save-dir')?.value || 'Xブックマーク',
      max_results: Number(document.getElementById('x-bookmarks-max-results')?.value || 100),
      client_id: getInputValue('x-bookmarks-client-id'),
      redirect_uri: getInputValue('x-bookmarks-redirect-uri'),
      auth_url: getInputValue('x-bookmarks-auth-url'),
      token_url: getInputValue('x-bookmarks-token-url'),
      api_base: getInputValue('x-bookmarks-api-base'),
      scheduled_include_folders: document.getElementById('x-bookmarks-scheduled-folders')?.checked === true,
      scheduled_translate: document.getElementById('x-bookmarks-scheduled-translate')?.checked ?? loadedSettings.scheduled_translate === true,
      manual_include_replies: document.getElementById('x-bookmarks-include-replies')?.checked ?? loadedSettings.manual_include_replies !== false,
      account_include_replies: document.getElementById('x-account-posts-include-replies')?.checked ?? loadedSettings.account_include_replies === true,
    };
  }

  function applySettingsPayload(config) {
    if (!config || typeof config !== 'object') return;
    loadedSettings = { ...loadedSettings, ...config };
    config = loadedSettings;
    setInputValue('x-bookmarks-save-dir', config.save_dir || 'Xブックマーク');
    const count = document.getElementById('x-bookmarks-max-results');
    const limit = String(config.max_results || 100);
    if (count && !Array.from(count.options).some(option => option.value === limit)) {
      count.add(new Option(`最新${limit}件`, limit));
    }
    setInputValue('x-bookmarks-max-results', limit);
    setInputValue('x-bookmarks-client-id', config.client_id || '');
    setInputValue('x-bookmarks-redirect-uri', config.redirect_uri || '');
    setInputValue('x-bookmarks-auth-url', config.auth_url || '');
    setInputValue('x-bookmarks-token-url', config.token_url || '');
    setInputValue('x-bookmarks-api-base', config.api_base || '');
    const folders = document.getElementById('x-bookmarks-scheduled-folders');
    if (folders) folders.checked = config.scheduled_include_folders === true;
    const translate = document.getElementById('x-bookmarks-scheduled-translate');
    if (translate) translate.checked = config.scheduled_translate === true;
    const replies = document.getElementById('x-bookmarks-include-replies');
    if (replies) replies.checked = config.manual_include_replies !== false;
    const accountReplies = document.getElementById('x-account-posts-include-replies');
    if (accountReplies) accountReplies.checked = config.account_include_replies === true;
  }

  async function loadSharedSettings() {
    if (typeof apiFetch !== 'function') return null;
    const result = await apiFetch(`/personal-preferences/${SHARED_SETTINGS_DOCUMENT}`, { silentError: true });
    if (result?.available !== false && result?.payload) applySettingsPayload(result.payload);
    return result;
  }

  async function saveSharedSettings(payload) {
    if (typeof apiFetch !== 'function') return { available: false };
    const current = await apiFetch(`/personal-preferences/${SHARED_SETTINGS_DOCUMENT}`, { silentError: true });
    const body = { payload: { ...current?.payload, ...payload } };
    if (current?.available !== false) body.expectedRevision = current?.revision || null;
    const saved = await apiFetch(`/personal-preferences/${SHARED_SETTINGS_DOCUMENT}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), silentError: true,
    });
    return { ...saved, previousPayload: current?.payload || {} };
  }

  function icon(name, size) {
    return typeof lucide === 'function' ? lucide(name, size || 14) : '';
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null ? '' : String(value);
  }

  function setStatus(message, isError, options = {}) {
    const connectionPage = document.querySelector('.settings-modal')?.dataset.settingsActivePageId === 'x-connection';
    const el = document.getElementById(connectionPage ? 'x-connection-status-message' : 'x-bookmarks-status-message');
    if (!el) return;
    el.textContent = message || '';
    if (options.detail) { el.dataset.gbTooltip = options.detail; el.tabIndex = 0; }
    else { delete el.dataset.gbTooltip; el.removeAttribute('tabindex'); }
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
    if (data?.dry_run_count != null) prefix = `${prefix || ''} フォルダ修復: 書き込み前${data.dry_run_count}件（自動バックアップ済み・設定から取り消し可能）。`;
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
    const completenessText = data?.membership_complete === false ? ' / フォルダ全件確認は未完了（Xから続きの確認情報なし）' : '';
    const reasonText = reason ? ` / 停止: ${reason}` : '';
    const translationText = ` / 今回の翻訳${data?.translated_existing || 0}件・未翻訳${data?.translation_pending_existing || 0}件 / 返信${data?.replies || 0}件・返信翻訳待ち${data?.translation_pending_replies || 0}件・返信取得失敗${data?.reply_unavailable || 0}件`;
    return `${prefix || ''}${countText}${pageText} / ${itemText}${folderStateText}${translationText}${completenessText}${reasonText}`;
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
    if (isCloudSurface()) {
      if (options.connectionOnly) return;
      try {
        const shared = await loadSharedSettings();
        setText('x-bookmarks-connection', 'Cloud版: 共通設定を利用');
        setText('x-bookmarks-client-state', shared?.exists ? 'デスクトップ版と同期済み' : '共通設定は未保存');
        setStatus('接続・取得はデスクトップ版で実行します。', false);
      } catch (err) {
        setStatus('共通設定を取得できませんでした: ' + (err.userMessage || err.message || err), true);
      }
      return;
    }
    if (!options?.preserveStatus && !options.connectionOnly) setStatus('X連携の状態を確認しています...', false);
    try {
      const data = await apiFetch('/x-bookmarks/status', { silentError: true });
      const user = data.user || {};
      setText('x-bookmarks-connection', data.connected ? `接続済み: @${user.username || ''}` : '未接続');
      const config = data.config || {};
      setText('x-bookmarks-client-state', config.client_id_configured ? 'X接続設定済み' : 'X接続用Client IDが未設定');
      if (options.connectionOnly) {
        window.dispatchEvent(new CustomEvent('meldex:x-connection-changed', { detail: { connected: data.connected, user: data.user } }));
        return;
      }
      applySettingsPayload(config);
      window.dispatchEvent(new CustomEvent('meldex:x-connection-changed', { detail: data }));
      setText('x-bookmarks-client-state', config.client_id_configured ? 'X接続設定済み' : 'X接続用Client IDが未設定');
      const saveDir = document.getElementById('x-bookmarks-save-dir');
      const maxResults = document.getElementById('x-bookmarks-max-results');
      if (saveDir) saveDir.value = config.save_dir || 'Xブックマーク';
      if (maxResults) maxResults.value = String(config.max_results || 100);
      const scheduledFolders = document.getElementById('x-bookmarks-scheduled-folders');
      if (scheduledFolders) scheduledFolders.checked = config.scheduled_include_folders === true;
      const translate = document.getElementById('x-bookmarks-scheduled-translate');
      if (translate) translate.checked = config.scheduled_translate === true;
      setInputValue('x-bookmarks-client-id', config.client_id || '');
      setInputValue('x-bookmarks-redirect-uri', config.redirect_uri || '');
      setInputValue('x-bookmarks-auth-url', config.auth_url || '');
      setInputValue('x-bookmarks-token-url', config.token_url || '');
      setInputValue('x-bookmarks-api-base', config.api_base || '');
      const last = config.last_sync;
      setText(
        'x-bookmarks-last-sync',
        last?.at
          ? `前回保存: ${last.at} / 新規${last.created || 0}件・更新${last.updated || 0}件${last.folder_error ? '・フォルダ取得失敗' : ''}`
          : '前回保存: なし'
      );
      const lastSummary = document.getElementById('x-bookmarks-last-sync');
      if (lastSummary && last) {
        lastSummary.dataset.gbTooltip = syncSummary(last, '前回保存: ');
        lastSummary.tabIndex = 0;
      }
      _currentSchedule = config.schedule || null;
      _initScheduleWidget(config.schedule, config.schedule_state);
      await loadSharedSettings();
      // 定期取得の選択は実行元の設定を使う。共有設定の読込だけで変更しない。
      if (scheduledFolders) scheduledFolders.checked = config.scheduled_include_folders === true;
      if (!options?.preserveStatus) {
        const alert = data.alert;
        setStatus(
          alert?.message || data.message || '',
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
    if (!_scheduleWidget || !container.querySelector('.gb-scheduler-widget')) {
      _scheduleWidget = window.MeldexScheduler?.createWidget(container, schedule, async (cfg) => {
        const saved = await saveConfig({ silentError: true, schedule: cfg });
        if (saved) _currentSchedule = cfg;
        return saved;
      });
    }
    _scheduleWidget?.setStatusText(_formatScheduleState(scheduleState));
  }

  function _formatScheduleState(state) {
    if (!state) return '';
    const parts = [];
    const dispatch = state.last_dispatch || {};
    const progress = Number(dispatch.processed) || 0;
    const total = Number(dispatch.total) || 0;
    const progressText = total > 0 ? `${progress}/${total}件` : (progress > 0 ? `${progress}件` : '開始前');
    if (state.auto_retry_blocked) {
      parts.push('同じ工程で3回進まなかったため自動再開を停止中');
      parts.push(`停止工程: ${dispatch.stage || '不明'} ${progressText}`);
      parts.push('「差分を保存」で手動再開できます');
    } else if (['claimed', 'submitted', 'running', 'cancelling'].includes(dispatch.status)) {
      parts.push(`実行中: ${dispatch.stage || '準備中'} ${progressText}`);
    } else if (dispatch.status === 'interrupted') {
      parts.push(`再開待ち: ${dispatch.stage || '準備中'} ${progressText}`);
    }
    if (!state.auto_retry_blocked && state.next_run_display) parts.push(`次回予定: ${state.next_run_display}`);
    if (state.last_run) {
      const label = state.last_run.status === 'done' ? '成功' : (state.last_run.status === 'error' ? '失敗' : state.last_run.status);
      parts.push(`前回自動実行: ${label}`);
    }
    if (!state.auto_retry_blocked && state.needs_attention) parts.push('連続で失敗しています。設定をご確認ください。');
    return parts.join(' / ');
  }

  async function saveConfig(options = {}) {
    const silentError = options?.silentError === true;
    if ((isCloudSurface() ? typeof apiFetch !== 'function' : typeof apiPost !== 'function')) {
      if (!silentError) setStatus('設定を保存できませんでした: APIを利用できません', true);
      return false;
    }
    const body = settingsPayload();
    const schedulePayload = options.schedule || (_scheduleWidget ? _scheduleWidget.getCommittedConfig() : _currentSchedule);
    try {
      if (schedulePayload) body.schedule = schedulePayload;
      // Capture each edit before queuing; a slow earlier save must not overwrite a later choice.
      const save = saveQueue.catch(() => {}).then(async () => {
        const sharedPayload = { ...body };
        delete sharedPayload.schedule;
        const shared = await saveSharedSettings(sharedPayload);
        if (shared?.ok === false && shared?.available !== false) throw new Error('共通設定を保存できませんでした。再試行してください。');
        if (isCloudSurface() && shared?.available === false) throw new Error('共通設定の保存先に接続できません。アカウントへの接続を確認してください。');
        try {
          if (!isCloudSurface()) await apiPost('/x-bookmarks/config', body, { silentError: true });
        } catch (error) {
          // Restore only our own preference revision; never overwrite a concurrent edit.
          if (shared?.available !== false && shared?.revision) {
            await apiFetch(`/personal-preferences/${SHARED_SETTINGS_DOCUMENT}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ payload: shared.previousPayload, expectedRevision: shared.revision }),
              silentError: true,
            });
          }
          throw error;
        }
        loadedSettings = { ...loadedSettings, ...body };
      });
      saveQueue = save;
      await save;
      if (options?.showSuccess) {
        await loadStatus();
        setStatus(isCloudSurface()
          ? '共通設定へ保存しました。続いて「デスクトップ版へ引き継ぐ」を押してください。'
          : '設定を保存しました。', false);
      }
      return true;
    } catch (err) {
      if (!silentError) setStatus('設定を保存できませんでした: ' + (err.userMessage || err.message || err), true);
      return false;
    }
  }

  async function prepareDesktopHandoff() {
    const button = document.getElementById('x-bookmarks-desktop-handoff');
    if (button) button.disabled = true;
    try {
      const saved = await saveConfig({ silentError: false });
      if (!saved) return;
      const panel = document.getElementById('x-bookmarks-desktop-steps');
      if (panel) panel.hidden = false;
      setStatus('設定を保存しました。表示された手順をデスクトップ版で続けてください。', false);
    } finally {
      if (button) button.disabled = false;
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
    ['x-bookmarks-sync', 'x-bookmarks-maintenance'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !!isBusy;
    });
  }

  function replyBudgetYen(maxResults) {
    return Math.ceil(Math.max(1, Math.min(5000, Number(maxResults) || 100)) * 93 * 0.015 * 150);
  }

  let costConfirmationPending = false;
  async function confirmCost(message) {
    if (costConfirmationPending || typeof cfConfirm !== 'function') return false;
    costConfirmationPending = true;
    try {
      return !!await cfConfirm(message, { okLabel: '取得を開始', cancelLabel: 'キャンセル' });
    } finally {
      costConfirmationPending = false;
    }
  }

  async function confirmBookmarkSyncCost(maxResults, includeReplies = false) {
    const limit = Math.max(1, Number(maxResults) || 100);
    const estimatedOwnedUsd = limit * 0.001;
    const estimatedStandardUsd = limit * 0.005;
    const withAuthorsAndReferencesYen = Math.ceil(limit * 3 * 0.015 * 150);
    const yen = value => Math.ceil(value).toLocaleString('ja-JP') + '円';
    const replies = includeReplies
      ? `\n元ポストと参照元（最大2件）のそれぞれに、返信を最大30件取得します。投稿者情報を含む返信ノート対象分の概算上限は約${yen(replyBudgetYen(limit))}です。重複を割り引かず計算しています。`
      : `\n参照元ポストと投稿者情報も含む概算上限は約${yen(withAuthorsAndReferencesYen)}です（重複を割り引かず計算）。`;
    const message = `Xブックマークを最大${limit.toLocaleString('ja-JP')}件まで確認します。\nポスト取得分の目安は約${yen(estimatedOwnedUsd * 150)}〜${yen(estimatedStandardUsd * 150)}です（約$${estimatedOwnedUsd.toFixed(2)}〜$${estimatedStandardUsd.toFixed(2)}）。${replies}\n概算1ドル＝150円。フォルダ確認分・税等は別で、契約条件や料金変更によって実費は変わります。\n\nこの件数と費用目安で取得を始めますか？`;
    return confirmCost(message);
  }

  async function sync(mode) {
    if (syncInFlight) return;
    const maxResults = Number(document.getElementById('x-bookmarks-max-results')?.value || 100);
    const includeReplies = document.getElementById('x-bookmarks-include-replies')?.checked === true;
    if (!await confirmBookmarkSyncCost(maxResults, includeReplies)) return;
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
        { mode: mode || 'incremental', max_results: maxResults, ack_cost_notice: true,
          include_replies: includeReplies, ack_reply_cost_notice: includeReplies,
          reply_budget_yen: includeReplies ? replyBudgetYen(maxResults) : 0 },
        {
          onProgress: (progress) => {
            setStatus(formatJobProgress(progress, { unit: '件保存済み', defaultPhase: '取得中' }), false);
          },
        }
      );
      await loadStatus({ preserveStatus: true });
      let templateWarning = '';
      try {
        const saveDir = data?.save_dir || getInputValue('x-bookmarks-save-dir', 'Xブックマーク');
        await window.MeldexImportSheetTemplates?.apply?.('x-bookmarks', saveDir);
      } catch (templateError) {
        console.warn('Xブックマーク保存先へのテンプレート適用に失敗しました', templateError);
        templateWarning = ' シートテンプレートを適用できませんでした。設定から再試行してください。';
      }
      setStatus(`保存しました。新規${data?.created || 0}件・更新${data?.updated || 0}件。` + templateWarning, !!templateWarning, { detail: syncSummary(data, '保存しました。') });
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

  async function syncFolders(dryRun = false) {
    if (syncInFlight) return;
    if (!await confirmCost('この操作では有料のX APIリクエストを使い、Xの全フォルダ一覧と各フォルダの投稿一覧を取得します。フォルダ数・投稿数・ページ数によりリクエスト数と実費が変わるため、事前の件数見積もりはできません。続行しますか？')) return;
    syncInFlight = true;
    setSyncBusy(true);
    try {
      setStatus('フォルダ情報を更新しています...', false);
      const data = await runBackgroundJob(
        '/x-bookmarks/folders/sync', { ack_cost_notice: true, dry_run: dryRun },
        { onProgress: (progress) => setStatus(formatJobProgress(progress, { unit: '件確認済み', defaultPhase: 'フォルダ情報を取得中' }), false) }
      );
      await loadStatus({ preserveStatus: true });
      const incomplete = data?.membership_complete === false;
      const message = incomplete
        ? `全件確認は未完了です。Xから続きの確認情報が返らず、一覧の末尾を確認できません。取得できた所属から修復可能${data?.dry_run_count || 0}件 / 所属不明の空欄${Number(data?.blank_without_membership || 0).toLocaleString('ja-JP')}件。${dryRun ? 'シートは変更していません。' : `反映${data?.folder_updates || 0}件。自動バックアップ済み・取り消し可能。`}空欄が「所属なし」と確定したわけではありません。`
        : (dryRun ? `修復対象${data?.dry_run_count || 0}件。シートは変更していません。「フォルダ列を修復」で反映できます。` : `書き込み前の修復対象${data?.dry_run_count || 0}件 / 反映${data?.folder_updates || 0}件。自動バックアップ済み。「フォルダ修復を取り消す」で戻せます。`);
      setStatus(message, incomplete);
    } catch (err) {
      setStatus('フォルダ情報を更新できませんでした。再試行できます: ' + (err.userMessage || err.message || err), true);
    } finally {
      syncInFlight = false;
      setSyncBusy(false);
    }
  }

  async function undoFolders() {
    if (syncInFlight) return;
    syncInFlight = true;
    setSyncBusy(true);
    try {
      const data = await runBackgroundJob('/x-bookmarks/folders/undo', {}, {
        onProgress: progress => setStatus(formatJobProgress(progress, { defaultPhase: '取り消し中' }), false)
      });
      setStatus(`フォルダ修復を取り消しました。${data?.folder_updates || 0}件。${data?.conflicts ? '修復後に所属が変わった' + data.conflicts + '件は保持しました。' : ''}`, !!data?.conflicts);
    } catch (err) {
      setStatus('取り消せませんでした。再試行できます: ' + (err.userMessage || err.message || err), true);
    } finally { syncInFlight = false; setSyncBusy(false); }
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
    if (!await confirmBookmarkSyncCost(1, true)) return null;
    const result = await runBackgroundJob('/x-bookmarks/reimport', {
      post_id: id,
      save_dir: saveDir || undefined,
      include_replies: true, ack_reply_cost_notice: true, reply_budget_yen: replyBudgetYen(1),
    }, { operationLabel: 'ポストと返信ノートを更新しています' });
    if (typeof showStatus === 'function') showStatus('Xからこのポストを再インポートしました');
    return result;
  }

  async function retryTranslations() {
    if (syncInFlight) return;
    syncInFlight = true;
    setSyncBusy(true);
    try {
      if (!await saveConfig({ silentError: true })) throw new Error('設定を保存できませんでした');
      const result = await runBackgroundJob('/x-bookmarks/translations/retry', {}, {
        operationLabel: '保存済みポストの翻訳を続けています', maxPolls: Number.POSITIVE_INFINITY,
        onProgress: progress => setStatus(formatJobProgress(progress), false),
      });
      setStatus(result.summary, false);
    } catch (err) {
      setStatus('翻訳を続けられませんでした: ' + (err.userMessage || err.message || err), true);
    } finally {
      syncInFlight = false;
      setSyncBusy(false);
    }
  }

  async function enrichSavedNotes(includeReplies) {
    if (syncInFlight) return;
    const limit = includeReplies ? Number(document.getElementById('x-bookmarks-max-results')?.value || 100) : 5000;
    if (includeReplies && !await confirmBookmarkSyncCost(limit, true)) return;
    syncInFlight = true;
    setSyncBusy(true);
    try {
      if (!await saveConfig({ silentError: true })) throw new Error('設定を保存できませんでした');
      const result = await runBackgroundJob('/x-bookmarks/notes/enrich', {
        max_results: limit, include_replies: includeReplies,
        ack_reply_cost_notice: includeReplies,
        reply_budget_yen: includeReplies ? replyBudgetYen(limit) : 0,
      }, { operationLabel: includeReplies ? '保存済みの返信ノートを更新しています' : '保存済みのノートを作成しています',
        onProgress: progress => setStatus(formatJobProgress(progress), false) });
      setStatus(result.summary || `ノート${result.updated || 0}件を更新しました。返信${result.replies || 0}件。`, false);
    } catch (err) {
      setStatus('ノートを更新できませんでした: ' + (err.userMessage || err.message || err), true);
    } finally {
      syncInFlight = false;
      setSyncBusy(false);
    }
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

  function openMaintenance() {
    const button = document.getElementById('x-bookmarks-maintenance');
    if (!button || syncInFlight || isCloudSurface()) return;
    button.setAttribute('aria-expanded', 'true');
    const actions = [
      ['translations', '翻訳を続ける（X追加取得なし）', retryTranslations],
      ['notes', 'ノートを作成・更新（X追加取得なし）', () => enrichSavedNotes(false)],
      ['replies', '返信を追加取得（有料）', () => enrichSavedNotes(true)],
      ['duplicates', '重複を整理', () => showDuplicateRepair({ returnFocus: button })],
      ['sync-folders', 'フォルダ列を修復（有料）', () => syncFolders()],
      ['preview-folders', '修復件数だけ確認（有料）', () => syncFolders(true)],
      ['undo-folders', 'フォルダ修復を取り消す', undoFolders],
    ];
    const menu = window.MeldexContextMenuUI.openAt({
      anchorRect: button.getBoundingClientRect(), restoreFocus: button,
      ariaLabel: 'Xブックマークのメンテナンス', e2eId: 'x-bookmarks-maintenance-menu',
      items: actions.map(([id, label, action]) => ({ label, action, e2eId: 'x-bookmarks-' + id })),
      onClose: () => button.setAttribute('aria-expanded', 'false'),
    });
    // Preserve existing action identifiers for automation and focus restoration.
    menu.querySelectorAll('[data-e2e-id]').forEach(item => { item.id = item.dataset.e2eId; });
  }

  function bind() {
    document.getElementById('x-bookmarks-connect')?.addEventListener('click', connect);
    document.getElementById('x-bookmarks-disconnect')?.addEventListener('click', disconnect);
    document.getElementById('x-bookmarks-sync')?.addEventListener('click', () => sync('incremental'));
    document.getElementById('x-bookmarks-maintenance')?.addEventListener('click', openMaintenance);
    const consoleLink = document.getElementById('x-bookmarks-console-link');
    if (consoleLink) {
      consoleLink.setAttribute('data-gb-tooltip', X_DEVELOPER_CONSOLE_HELP);
      consoleLink.setAttribute('aria-label', X_DEVELOPER_CONSOLE_HELP);
      consoleLink.addEventListener('click', () => openUrl(X_DEVELOPER_CONSOLE_URL));
    }
    document.getElementById('x-bookmarks-save-config')?.addEventListener('click', () => saveConfig({ showSuccess: true }));
    document.getElementById('x-bookmarks-desktop-handoff')?.addEventListener('click', prepareDesktopHandoff);
    document.getElementById('x-bookmarks-save-dir')?.addEventListener('change', saveConfig);
    document.getElementById('x-bookmarks-max-results')?.addEventListener('change', saveConfig);
    document.getElementById('x-bookmarks-scheduled-folders')?.addEventListener('change', saveConfig);
    document.getElementById('x-bookmarks-scheduled-translate')?.addEventListener('change', saveConfig);
    document.getElementById('x-bookmarks-include-replies')?.addEventListener('change', saveConfig);
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
    container.hidden = false;
    delete container.dataset.cloudDesktopOnlyHidden;
    if (container.dataset.rendered === '1') {
      loadStatus();
      return;
    }
    container.dataset.rendered = '1';
    const connection = document.getElementById('x-connection-settings-container');
    if (connection) connection.innerHTML = `
      <div class="gb-field-row">
        <span id="x-bookmarks-connection" role="status">読み込み中...</span>
        <span id="x-bookmarks-client-state" class="gb-section-desc"></span>
      </div>
      <label class="gb-field">
        <span class="gb-label">クライアントID ${fieldHelp('XブックマークとXアカウント保存で共通の接続IDです。X Developer Consoleで発行します。投稿・フォロー・いいね・DM送信は行いません。')}</span>
        <input id="x-bookmarks-client-id" class="gb-input" type="text" autocomplete="off" placeholder="Xで発行したClient ID">
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
      <div class="gb-check-help-row">
        <label class="gb-check" style="min-height:var(--ui-h-touch,44px);font-size:inherit;color:var(--fg);"><input id="x-bookmarks-scheduled-translate" type="checkbox"><span>定期保存を日本語に翻訳</span></label>
        ${fieldHelp('ブックマーク・アカウント保存で共通です。初期状態はオフ。設定済みCLIの使用量を消費します。翻訳に失敗しても原文は保存します。')}
      </div>
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
        <button type="button" id="x-bookmarks-save-config" class="gb-btn gb-btn-sm">${icon('save', 14)} 設定を保存</button>
        <button type="button" id="x-bookmarks-connect" class="gb-btn gb-btn-sm">${icon('externalLink', 14)} Xに接続</button>
        <button type="button" id="x-bookmarks-disconnect" class="gb-btn gb-btn-sm gb-btn-quiet">${icon('unlink', 14)} 接続を解除</button>
        <button type="button" id="x-bookmarks-console-link" class="gb-btn gb-btn-sm gb-btn-quiet">${icon('externalLink', 14)} X Developer Console</button>
      </div>
      <div id="x-connection-status-message" class="gb-section-desc" role="status" aria-live="polite"></div>
    `;
    container.innerHTML = `
      <label class="gb-field">
        <span class="gb-label">保存先シート</span>
        <input id="x-bookmarks-save-dir" class="gb-input" type="text" value="Xブックマーク">
      </label>
      <div class="gb-section gb-section--boxed" data-import-sheet-template="x-bookmarks"></div>
      <label class="gb-field-row">
        <span class="gb-label">取得件数 ${fieldHelp('X APIは従量課金です。手動は最大5,000件、定期保存の本文は最新100件まで。フォルダは全ページを確認します。開始前に費用目安を確認します。')}</span>
        <select id="x-bookmarks-max-results" class="gb-select">
          <option value="100">最新100件</option>
          <option value="500">最新500件</option>
          <option value="1000">最新1000件</option>
          <option value="5000">最大5,000件（有料・大量取得）</option>
        </select>
      </label>
      <div id="x-bookmarks-schedule-container" class="gb-section gb-section--boxed" style="margin-top:8px;padding:8px;"></div>
      <div class="gb-check-help-row">
        <label class="gb-check" style="min-height:var(--ui-h-touch,44px);font-size:inherit;color:var(--fg);"><input id="x-bookmarks-include-replies" type="checkbox" checked><span>返信も取得（追加料金）</span></label>
        ${fieldHelp('手動保存で元ポスト・参照元ごとに返信を最大30件取得します。開始前に日本円の費用目安を確認します。定期保存には適用しません。')}
      </div>
      <div class="gb-check-help-row">
        <label class="gb-check" style="min-height:var(--ui-h-touch,44px);font-size:inherit;color:var(--fg);"><input id="x-bookmarks-scheduled-folders" type="checkbox"><span>定期保存でフォルダも更新（有料）</span></label>
        ${fieldHelp('初期状態はオフです。オンにすると定期保存のたびにXのフォルダ一覧と各フォルダの投稿一覧を取得するため、有料Xリクエストが発生します。必要な場合だけ手動でオンにしてください。')}
      </div>
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
        <button type="button" id="x-bookmarks-sync" class="gb-btn gb-btn-sm gb-btn-primary">${icon('download', 14)} 差分を保存（有料）</button>
        <button type="button" id="x-bookmarks-maintenance" class="gb-btn gb-btn-sm gb-btn-quiet" aria-haspopup="menu" aria-expanded="false">${icon('ellipsis', 14)} メンテナンス</button>
      </div>
      <div id="x-bookmarks-last-sync" class="gb-section-desc">前回保存: なし</div>
      <div id="x-bookmarks-status-message" class="gb-section-desc" role="status" aria-live="polite"></div>
      <div id="x-bookmarks-desktop-steps" class="gb-section gb-section--boxed" hidden>
        <strong>デスクトップ版で続ける手順</strong>
        <ol><li>同じアカウントでMeldexデスクトップ版を起動します。</li><li>設定 → Webクリップ → X接続 で「Xに接続」を押します。</li><li>Xブックマークで「差分を保存」を押します。</li></ol>
      </div>
      <button type="button" id="x-bookmarks-desktop-handoff" class="gb-btn gb-btn-sm gb-btn-primary" hidden>${icon('monitorUp', 14)} デスクトップ版へ引き継ぐ</button>
      <button type="button" id="x-bookmarks-credits-action" class="gb-btn gb-btn-sm gb-btn-quiet" hidden>${icon('externalLink', 14)} X Developer Consoleを開く</button>
    `;
    container.querySelectorAll('.gb-field-help').forEach(help => {
      const control = help.closest('label')?.querySelector('input[id], select[id]');
      help.dataset.e2eId = 'settings-x-bookmarks-help-' + (control?.id || 'summary');
    });
    bind();
    if (isCloudSurface()) {
      ['x-bookmarks-connect', 'x-bookmarks-sync', 'x-bookmarks-maintenance', 'x-bookmarks-disconnect']
        .forEach(id => { const control = document.getElementById(id); if (control) control.hidden = true; });
      document.getElementById('x-bookmarks-include-replies')?.closest('.gb-check-help-row')?.setAttribute('hidden', '');
      const schedule = document.getElementById('x-bookmarks-schedule-container');
      if (schedule) schedule.hidden = true;
      const scheduledFolders = document.getElementById('x-bookmarks-scheduled-folders')?.closest('label');
      if (scheduledFolders) scheduledFolders.closest('.gb-check-help-row').hidden = true;
      const saveButton = document.getElementById('x-bookmarks-save-config');
      if (saveButton) saveButton.textContent = 'Cloudで接続設定を保存';
      const handoff = document.getElementById('x-bookmarks-desktop-handoff');
      if (handoff) handoff.hidden = false;
    }
    setSyncBusy(syncInFlight);
    loadStatus();
  }

  function refreshConnection() {
    return saveQueue.catch(() => {}).then(() => loadStatus({ connectionOnly: true }));
  }
  window.addEventListener('focus', () => {
    if (document.querySelector('.settings-modal')?.dataset.settingsActivePageId === 'x-connection') refreshConnection();
  });
  window.MeldexXSettings = { save: saveConfig, refresh: refreshConnection };
  window.renderXBookmarksSettings = renderXBookmarksSettings;
  window.reimportXBookmarkPost = reimportPost;
  window.reimportXBookmarkEntry = reimportEntry;
})();
