(function () {
  'use strict';

  const rootId = 'x-bookmarks-settings-container';
  const TIMER_KEY = 'x-bookmarks-auto';
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

  function setStatus(message, isError) {
    const el = document.getElementById('x-bookmarks-status-message');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--fg2)';
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
    const itemText = `新規${data?.created || 0} / 更新${data?.updated || 0} / スキップ${data?.skipped || 0} / 画像${data?.downloaded_media || 0} / 画像失敗${data?.media_failed || 0}${folderText}`;
    const reasonText = reason ? ` / 停止: ${reason}` : '';
    return `${prefix || ''}${countText}${pageText} / ${itemText}${reasonText}`;
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
      _initScheduleWidget(config.schedule);
      _applyScheduleTimer(config.schedule, data.connected);
      if (!options?.preserveStatus) {
        setStatus(data.message || 'Xブックマーク保存を使えます。', !config.client_id_configured);
      }
    } catch (err) {
      setStatus('X連携の状態を取得できませんでした: ' + (err.userMessage || err.message || err), true);
    }
  }

  function _initScheduleWidget(schedule) {
    const container = document.getElementById('x-bookmarks-schedule-container');
    if (!container || _scheduleWidget) return;
    _scheduleWidget = window.MeldexScheduler?.createWidget(container, schedule, (cfg) => {
      _currentSchedule = cfg;
      saveConfig({ silentError: true });
    });
  }

  function _applyScheduleTimer(schedule, connected) {
    if (!window.MeldexScheduler) return;
    const cfg = window.MeldexScheduler.normalize(schedule);
    if (cfg.type === 'off' || !connected) {
      window.MeldexScheduler.destroyTimer(TIMER_KEY);
      return;
    }
    window.MeldexScheduler.createTimer(TIMER_KEY, cfg, _scheduledSync);
  }

  async function _scheduledSync() {
    if (syncInFlight) return;
    try {
      const data = await apiFetch('/x-bookmarks/status', { silentError: true });
      if (!data.connected) return;
    } catch { return; }
    syncInFlight = true;
    setSyncBusy(true);
    try {
      const data = await apiPost('/x-bookmarks/sync', { mode: 'incremental', max_results: 100 }, { silentError: true });
      const total = (data?.created || 0) + (data?.updated || 0);
      if (total > 0 && typeof showStatus === 'function') {
        showStatus(`Xブックマーク自動保存: 新規${data.created || 0} / 更新${data.updated || 0}`);
      }
      if (typeof loadOutliner === 'function') loadOutliner();
    } catch (e) {
      console.warn('X bookmarks scheduled sync failed:', e);
    } finally {
      syncInFlight = false;
      setSyncBusy(false);
    }
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
    ['x-bookmarks-sync', 'x-bookmarks-sync-diff'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !!isBusy;
    });
  }

  async function sync(mode) {
    if (syncInFlight) return;
    syncInFlight = true;
    setSyncBusy(true);
    try {
      const saved = await saveConfig({ silentError: true });
      if (!saved) {
        setStatus('設定を保存できなかったため、Xブックマーク保存を中止しました。', true);
        return;
      }
      setStatus('Xブックマークを保存しています...', false);
      const maxResults = Number(document.getElementById('x-bookmarks-max-results')?.value || 100);
      const data = await apiPost('/x-bookmarks/sync', { mode: mode || 'incremental', max_results: maxResults }, { silentError: true });
      await loadStatus({ preserveStatus: true });
      setStatus(syncSummary(data, '保存しました。'), false);
    } catch (err) {
      const payload = err.payload?.detail;
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

  function bind() {
    document.getElementById('x-bookmarks-connect')?.addEventListener('click', connect);
    document.getElementById('x-bookmarks-disconnect')?.addEventListener('click', disconnect);
    document.getElementById('x-bookmarks-sync')?.addEventListener('click', () => sync('all'));
    document.getElementById('x-bookmarks-sync-diff')?.addEventListener('click', () => sync('incremental'));
    document.getElementById('x-bookmarks-save-config')?.addEventListener('click', () => saveConfig({ showSuccess: true }));
    document.getElementById('x-bookmarks-save-dir')?.addEventListener('change', saveConfig);
    document.getElementById('x-bookmarks-max-results')?.addEventListener('change', saveConfig);
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
    if (container.dataset.rendered === '1') {
      loadStatus();
      return;
    }
    container.dataset.rendered = '1';
    container.innerHTML = `
      <div class="gb-section-desc">Xに接続すると、自分のXブックマークを画像つきのシートエントリとして保存できます。投稿、フォロー、いいね、DM送信は行いません。</div>
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
        <span id="x-bookmarks-connection" class="gb-section-desc">状態を確認中...</span>
        <span id="x-bookmarks-client-state" class="gb-section-desc"></span>
      </div>
      <label class="gb-field">
        <span class="gb-label">保存先シート</span>
        <input id="x-bookmarks-save-dir" class="gb-input" type="text" value="Xブックマーク">
      </label>
      <label class="gb-field-row" style="justify-content:flex-start;">
        <span class="gb-label">取得件数</span>
        <select id="x-bookmarks-max-results" class="gb-select">
          <option value="100">最新100件</option>
          <option value="500">最新500件</option>
          <option value="1000">最新1000件</option>
          <option value="5000">取得できるところまで（最大5000件）</option>
        </select>
      </label>
      <label class="gb-field">
        <span class="gb-label">X接続用Client ID</span>
        <input id="x-bookmarks-client-id" class="gb-input" type="text" autocomplete="off" placeholder="X Developer Portal の OAuth 2.0 Client ID">
      </label>
      <div class="gb-section-desc">Xブックマークを読むためのOAuth 2.0 Client IDです。Client Secretは使いません。</div>
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
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
        <button type="button" id="x-bookmarks-save-config" class="gb-btn gb-btn-sm">${icon('save', 14)} 接続設定を保存</button>
        <button type="button" id="x-bookmarks-connect" class="gb-btn gb-btn-sm">${icon('externalLink', 14)} Xに接続</button>
        <button type="button" id="x-bookmarks-sync-diff" class="gb-btn gb-btn-sm">${icon('download', 14)} 差分だけ保存</button>
        <button type="button" id="x-bookmarks-sync" class="gb-btn gb-btn-sm">${icon('archive', 14)} ブックマークを保存</button>
        <button type="button" id="x-bookmarks-disconnect" class="gb-btn gb-btn-sm gb-btn-quiet">${icon('unlink', 14)} 接続を解除</button>
      </div>
      <div id="x-bookmarks-status-message" class="gb-section-desc"></div>
    `;
    bind();
    setSyncBusy(syncInFlight);
    loadStatus();
  }

  window.renderXBookmarksSettings = renderXBookmarksSettings;
})();
