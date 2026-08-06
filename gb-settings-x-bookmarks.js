(function () {
  'use strict';

  const rootId = 'x-bookmarks-settings-container';
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
    const itemText = `新規${data?.created || 0} / 更新${data?.updated || 0} / スキップ${data?.skipped || 0} / 画像${data?.downloaded_media || 0} / 投稿者アイコン${data?.downloaded_author_icons || 0} / 画像失敗${data?.media_failed || 0} / アイコン失敗${data?.author_icon_failed || 0}${folderText}`;
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
      _initScheduleWidget(config.schedule, config.schedule_state);
      if (!options?.preserveStatus) {
        setStatus(data.message || 'Xブックマーク保存を使えます。', !config.client_id_configured);
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
    ['x-bookmarks-sync', 'x-bookmarks-duplicates'].forEach(id => {
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
      const data = await runBackgroundJob(
        '/x-bookmarks/sync',
        { mode: mode || 'incremental', max_results: maxResults },
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

  function _closeDuplicateModal() {
    document.querySelector('[data-x-duplicates-modal]')?.remove();
  }

  async function showDuplicateRepair() {
    setStatus('重複を確認しています...', false);
    try {
      const saveDir = getInputValue('x-bookmarks-save-dir', 'Xブックマーク');
      const data = await apiFetch('/x-bookmarks/duplicates?save_dir=' + encodeURIComponent(saveDir), { silentError: true });
      _closeDuplicateModal();
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.dataset.xDuplicatesModal = '1';
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.style.cssText = 'width:min(760px,calc(100vw - 24px));max-height:min(82vh,760px);display:flex;flex-direction:column;';
      const title = document.createElement('h3');
      title.textContent = 'Xブックマークの重複を整理';
      const desc = document.createElement('p');
      desc.className = 'gb-section-desc';
      desc.textContent = data.group_count
        ? `${data.group_count}組、${data.duplicate_row_count}行の重複があります。最古の行を残し、最新のX情報と全行の追記・タグ・リレーションを統合します。`
        : '整理が必要な重複はありません。';
      const list = document.createElement('div');
      list.style.cssText = 'overflow:auto;border:1px solid var(--border);border-radius:4px;';
      (data.groups || []).forEach(group => {
        const row = document.createElement('label');
        row.style.cssText = 'display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;padding:9px;border-bottom:1px solid var(--border);';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = true;
        check.value = group.post_id;
        check.dataset.xDuplicatePostId = group.post_id;
        const body = document.createElement('span');
        const primary = document.createElement('strong');
        primary.textContent = `ポスト ${group.post_id}（${group.row_count}行）`;
        const detail = document.createElement('span');
        detail.style.cssText = 'display:block;color:var(--fg2);font-size:12px;margin-top:3px;overflow-wrap:anywhere;';
        detail.textContent = `採用: ${group.canonical_path} / 削除: ${(group.duplicate_paths || []).join(', ')}`;
        body.appendChild(primary);
        body.appendChild(detail);
        row.appendChild(check);
        row.appendChild(body);
        list.appendChild(row);
      });
      const actions = document.createElement('div');
      actions.className = 'gb-field-row';
      actions.style.cssText = 'justify-content:flex-end;margin-top:12px;';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'gb-btn gb-btn-quiet';
      cancel.textContent = '閉じる';
      cancel.addEventListener('click', _closeDuplicateModal);
      actions.appendChild(cancel);
      if (data.group_count) {
        const repair = document.createElement('button');
        repair.type = 'button';
        repair.className = 'gb-btn';
        repair.textContent = '選択した重複を統合';
        repair.addEventListener('click', async () => {
          const postIds = Array.from(modal.querySelectorAll('[data-x-duplicate-post-id]:checked')).map(input => input.value);
          if (!postIds.length) return;
          repair.disabled = true;
          repair.textContent = '統合しています...';
          try {
            const result = await apiPost('/x-bookmarks/duplicates/repair', {
              save_dir: saveDir,
              post_ids: postIds,
            }, { silentError: true });
            _closeDuplicateModal();
            setStatus(`重複${result.group_count || 0}組を統合し、${result.trashed_count || 0}行をゴミ箱へ移しました。`, false);
            if (typeof reloadCurrentOpenFile === 'function') reloadCurrentOpenFile();
          } catch (error) {
            repair.disabled = false;
            repair.textContent = '選択した重複を統合';
            setStatus('重複を整理できませんでした: ' + (error.userMessage || error.message || error), true);
          }
        });
        actions.appendChild(repair);
      }
      modal.append(title, desc, list, actions);
      overlay.appendChild(modal);
      overlay.addEventListener('pointerdown', event => {
        if (event.target === overlay) _closeDuplicateModal();
      });
      document.body.appendChild(overlay);
      setStatus(data.group_count ? '統合内容を確認してください。' : '重複はありません。', false);
    } catch (error) {
      setStatus('重複を確認できませんでした: ' + (error.userMessage || error.message || error), true);
    }
  }

  function bind() {
    document.getElementById('x-bookmarks-connect')?.addEventListener('click', connect);
    document.getElementById('x-bookmarks-disconnect')?.addEventListener('click', disconnect);
    document.getElementById('x-bookmarks-sync')?.addEventListener('click', () => sync('incremental'));
    document.getElementById('x-bookmarks-duplicates')?.addEventListener('click', showDuplicateRepair);
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
      <div class="gb-section-desc">X連携では投稿・フォロー・いいね・DM送信は行いません。 ${fieldHelp('Xに接続すると、自分のXブックマークを画像つきのシートエントリとして保存できます。')}</div>
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
      <div class="gb-field-row" style="justify-content:flex-start;flex-wrap:wrap;">
        <button type="button" id="x-bookmarks-save-config" class="gb-btn gb-btn-sm">${icon('save', 14)} 接続設定を保存</button>
        <button type="button" id="x-bookmarks-connect" class="gb-btn gb-btn-sm">${icon('externalLink', 14)} Xに接続</button>
        <button type="button" id="x-bookmarks-sync" class="gb-btn gb-btn-sm">${icon('download', 14)} 差分を保存</button>
        <button type="button" id="x-bookmarks-duplicates" class="gb-btn gb-btn-sm">${icon('copyCheck', 14)} 重複を整理</button>
        <button type="button" id="x-bookmarks-disconnect" class="gb-btn gb-btn-sm gb-btn-quiet">${icon('unlink', 14)} 接続を解除</button>
      </div>
      <div id="x-bookmarks-status-message" class="gb-section-desc"></div>
    `;
    bind();
    setSyncBusy(syncInFlight);
    loadStatus();
  }

  window.renderXBookmarksSettings = renderXBookmarksSettings;
  window.reimportXBookmarkPost = reimportPost;
  window.reimportXBookmarkEntry = reimportEntry;
})();
