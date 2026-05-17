(function () {
  'use strict';

  const rootId = 'x-bookmarks-settings-container';
  let syncInFlight = false;

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

  function openUrl(url) {
    if (!url) return;
    if (typeof apiPost === 'function') {
      apiPost('/open-external-url', { url }, { silentError: true }).catch(() => window.open(url, '_blank', 'noopener'));
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  async function loadStatus() {
    const container = document.getElementById(rootId);
    if (!container || typeof apiFetch !== 'function') return;
    setStatus('X連携の状態を確認しています...', false);
    try {
      const data = await apiFetch('/x-bookmarks/status', { silentError: true });
      const user = data.user || {};
      setText('x-bookmarks-connection', data.connected ? `接続済み: @${user.username || ''}` : '未接続');
      setText('x-bookmarks-client-state', data.config?.client_id_configured ? '公式Xアプリ設定済み' : '公式XアプリのClient IDが未設定');
      const saveDir = document.getElementById('x-bookmarks-save-dir');
      const maxResults = document.getElementById('x-bookmarks-max-results');
      if (saveDir) saveDir.value = data.config?.save_dir || 'Xブックマーク';
      if (maxResults) maxResults.value = String(data.config?.max_results || 100);
      const last = data.config?.last_sync;
      setText('x-bookmarks-last-sync', last?.at ? `前回保存: 新規${last.created || 0} / 更新${last.updated || 0}` : '前回保存: なし');
      setStatus(data.message || 'Xブックマーク保存を使えます。', !data.config?.client_id_configured);
    } catch (err) {
      setStatus('X連携の状態を取得できませんでした: ' + (err.userMessage || err.message || err), true);
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
    try {
      await apiPost('/x-bookmarks/config', { save_dir: saveDir, max_results: maxResults }, { silentError: true });
      return true;
    } catch (err) {
      if (!silentError) setStatus('設定を保存できませんでした: ' + (err.userMessage || err.message || err), true);
      return false;
    }
  }

  async function connect() {
    try {
      setStatus('Xの許可画面を開いています...', false);
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
      const data = await apiPost('/x-bookmarks/sync', { mode: mode || 'incremental' }, { silentError: true });
      setStatus(`保存しました。新規${data.created || 0} / 更新${data.updated || 0} / スキップ${data.skipped || 0}`, false);
      await loadStatus();
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
    document.getElementById('x-bookmarks-save-dir')?.addEventListener('change', saveConfig);
    document.getElementById('x-bookmarks-max-results')?.addEventListener('change', saveConfig);
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
      <div class="gb-section-desc">Xに接続すると、自分のXブックマークをMeldex内のMarkdownとして保存できます。投稿、フォロー、いいね、DM送信は行いません。</div>
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
        <span id="x-bookmarks-connection" class="gb-section-desc">状態を確認中...</span>
        <span id="x-bookmarks-client-state" class="gb-section-desc"></span>
      </div>
      <label class="gb-field">
        <span class="gb-label">保存先フォルダ</span>
        <input id="x-bookmarks-save-dir" class="gb-input" type="text" value="Xブックマーク">
      </label>
      <label class="gb-field-row" style="justify-content:flex-start;">
        <span class="gb-label">取得件数</span>
        <select id="x-bookmarks-max-results" class="gb-select">
          <option value="100">最新100件</option>
          <option value="500">最新500件</option>
          <option value="1000">取得できるところまで</option>
        </select>
      </label>
      <div id="x-bookmarks-last-sync" class="gb-section-desc">前回保存: なし</div>
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
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
