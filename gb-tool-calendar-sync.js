/* ==============================
   gb-tool-calendar-sync.js: Calendar external sync UI
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined') return;

  function _calSyncEsc(value) {
    return typeof esc === 'function' ? esc(value) : String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function _syncStatusLabel(connected, available = true) {
    if (!available) return '<span class="gb-cal-sync-status-unavailable">利用不可</span>';
    return connected ? '<span class="gb-cal-sync-status-connected">接続済み</span>' : '未接続';
  }

  function _syncCard(title, body) {
    return `<div class="gb-cal-sync-card">
      <div class="gb-cal-sync-card-title">${title}</div>
      ${body}
    </div>`;
  }

  function _openHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol === 'https:' || url.protocol === 'http:') window.open(url.href, '_blank');
    } catch {}
  }

  function _googleTasksCallbackUrl() {
    const base = typeof API_BASE === 'string' ? API_BASE : '/api';
    try { return new URL(base + '/cal/sync/google/tasks/callback', window.location.origin).href; }
    catch { return window.location.origin + '/api/cal/sync/google/tasks/callback'; }
  }

  function _closeSyncOverlay(o) {
    if (typeof o?._gbCloseSyncModal === 'function') o._gbCloseSyncModal();
    else o?.remove?.();
  }

  CalendarComponent.prototype._showSyncModal = async function() {
    let syncStatus = {};
    try { syncStatus = await apiFetch('/cal/sync/status'); } catch {}
    const google = syncStatus.google || {};
    const googleTasks = syncStatus.googleTasks || {};
    const microsoft = syncStatus.microsoft || {};
    const o = document.createElement('div');
    o.className = 'gb-cal-modal-overlay';
    o.innerHTML = `<div class="gb-cal-modal gb-cal-sync-modal">
      <h3>カレンダー同期</h3>
      ${_syncCard('Google Calendar', `
        <div class="gb-cal-sync-status">ステータス: ${_syncStatusLabel(!!google.connected, !!google.available)}</div>
        ${!google.connected && google.available ? `
          <div class="field"><label>Client ID</label><input class="sync-gcal-id" type="text" placeholder="Google Cloud Console で取得"></div>
          <div class="field"><label>Client Secret</label><input class="sync-gcal-secret" type="password"></div>
          <button class="sync-gcal-auth gb-cal-sync-action primary" type="button">Googleにログイン</button>` : ''}
        ${google.connected ? '<div class="gb-cal-sync-actions"><button class="sync-gcal-pull gb-cal-sync-action" type="button">Googleから取得</button><button class="sync-gcal-push gb-cal-sync-action" type="button">Googleに送信</button></div>' : ''}
      `)}
      ${_syncCard('Google ToDo', `
        <div class="gb-cal-sync-status">ステータス: ${_syncStatusLabel(!!googleTasks.connected, !!googleTasks.available)}</div>
        ${!googleTasks.connected && googleTasks.available !== false ? `
          <div class="field"><label>Client ID</label><input class="sync-gtask-id" type="text" placeholder="Google Cloud Console で取得"></div>
          <button class="sync-gtask-auth gb-cal-sync-action primary" type="button">Google ToDoにログイン</button>
          <div class="sync-gtask-auth-status gb-cal-sync-status gb-cal-sync-auth-status"></div>` : ''}
        ${googleTasks.connected ? '<div class="gb-cal-sync-actions"><button class="sync-gtask-sync gb-cal-sync-action" type="button">Google ToDoと同期</button></div>' : ''}
      `)}
      ${_syncCard('Microsoft Calendar', `
        <div class="gb-cal-sync-status">ステータス: ${_syncStatusLabel(!!microsoft.connected, !!microsoft.available)}</div>
        ${!microsoft.connected && microsoft.available ? `
          <div class="field"><label>Application (client) ID</label><input class="sync-ms-id" type="text" placeholder="Microsoft Entra のアプリID"></div>
          <div class="field"><label>Tenant</label><input class="sync-ms-tenant" type="text" value="${_calSyncEsc(microsoft.tenant || 'common')}"></div>
          <button class="sync-ms-auth gb-cal-sync-action primary" type="button">Microsoftにログイン</button>
          <div class="sync-ms-auth-status gb-cal-sync-status gb-cal-sync-auth-status"></div>` : ''}
        ${microsoft.connected ? '<div class="gb-cal-sync-actions"><button class="sync-ms-pull gb-cal-sync-action" type="button">Microsoftから取得</button><button class="sync-ms-push gb-cal-sync-action" type="button">Microsoftに送信</button></div>' : ''}
      `)}
      ${_syncCard('iCal / .ics', `
        <div class="gb-cal-sync-status">.icsファイル、またはBasic認証付きのiCal URLから取り込めます。</div>
        <div class="field"><label>iCal URL</label><input class="sync-ical-url" type="url" placeholder="https://example.com/calendar.ics"></div>
        <div class="gb-cal-sync-split">
          <div class="field"><label>ユーザー名</label><input class="sync-ical-user" type="text"></div>
          <div class="field"><label>パスワード</label><input class="sync-ical-pass" type="password"></div>
        </div>
        <div class="gb-cal-sync-actions">
          <button class="sync-ical-url-import gb-cal-sync-action" type="button">URLから取得</button>
          <button class="sync-ical-import gb-cal-sync-action" type="button">.icsインポート</button>
          <button class="sync-ical-export gb-cal-sync-action" type="button">.icsエクスポート</button>
        </div>
      `)}
      <div class="btn-row"><button class="sync-close gb-cal-sync-action" type="button">閉じる</button></div>
    </div>`;
    document.body.appendChild(o);
    const close = () => {
      if (o._msPollTimer) clearTimeout(o._msPollTimer);
      if (o._gtaskPollTimer) clearTimeout(o._gtaskPollTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      o.remove();
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || !document.body.contains(o)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    o._gbCloseSyncModal = close;
    o.querySelector('.sync-close').addEventListener('click', close);
    o.addEventListener('pointerdown', (event) => {
      if (event.target === o) close();
    });
    document.addEventListener('keydown', onKeyDown, true);
    o.querySelector('.sync-gcal-auth')?.addEventListener('click', () => this._googleCalAuth(o));
    o.querySelector('.sync-gcal-pull')?.addEventListener('click', () => this._googleCalPull(o));
    o.querySelector('.sync-gcal-push')?.addEventListener('click', () => this._googleCalPush());
    o.querySelector('.sync-gtask-auth')?.addEventListener('click', () => this._googleTasksAuth(o));
    o.querySelector('.sync-gtask-sync')?.addEventListener('click', () => this._googleTasksSync());
    o.querySelector('.sync-ms-auth')?.addEventListener('click', () => this._microsoftCalAuth(o));
    o.querySelector('.sync-ms-pull')?.addEventListener('click', () => this._microsoftCalPull(o));
    o.querySelector('.sync-ms-push')?.addEventListener('click', () => this._microsoftCalPush());
    o.querySelector('.sync-ical-url-import')?.addEventListener('click', () => this._icalUrlImport(o));
    o.querySelector('.sync-ical-import')?.addEventListener('click', () => this._icalImport());
    o.querySelector('.sync-ical-export')?.addEventListener('click', () => this._icalExport());
  };

  CalendarComponent.prototype._googleCalAuth = async function(o) {
    const id = o.querySelector('.sync-gcal-id')?.value.trim();
    const secret = o.querySelector('.sync-gcal-secret')?.value.trim();
    if (!id || !secret) { this._showStatus('Client IDとSecretを入力してください', true); return; }
    try {
      const res = await apiPost('/cal/sync/google/auth', { client_id: id, client_secret: secret });
      this._showStatus(res.message || 'Google認証成功');
      _closeSyncOverlay(o);
      this._showSyncModal();
    } catch (e) {
      this._showStatus('Google認証失敗: ' + e.message, true);
    }
  };

  CalendarComponent.prototype._googleCalPull = async function() {
    this._showStatus('Googleカレンダーから取得中...');
    try {
      const res = await apiPost('/cal/sync/google/pull', { user: this._getUser() });
      this._showStatus(`取得完了: ${res.imported}件インポート, ${res.updated}件更新`);
      await this._loadEvents();
      this._render();
    } catch (e) {
      this._showStatus('Google同期失敗: ' + e.message, true);
    }
  };

  CalendarComponent.prototype._googleCalPush = async function() {
    this._showStatus('Googleカレンダーに送信中...');
    try {
      const res = await apiPost('/cal/sync/google/push', { user: this._getUser() });
      if ((res.failed || 0) > 0) this._showStatus(`Google送信一部失敗: ${res.pushed || 0}件送信 / ${res.failed || 0}件失敗`, true);
      else this._showStatus(`送信完了: ${res.pushed}件プッシュ`);
    } catch (e) {
      this._showStatus('Google送信失敗: ' + e.message, true);
    }
  };

  CalendarComponent.prototype._googleTasksAuth = async function(o) {
    const clientId = o.querySelector('.sync-gtask-id')?.value.trim();
    const statusEl = o.querySelector('.sync-gtask-auth-status');
    if (!clientId) { this._showStatus('Google ToDoのClient IDを入力してください', true); return; }
    if (o._gtaskPollTimer) clearTimeout(o._gtaskPollTimer);
    try {
      const res = await apiPost('/cal/sync/google/tasks/auth-url', { client_id: clientId, redirect_uri: _googleTasksCallbackUrl() });
      if (statusEl) statusEl.textContent = 'Googleログイン画面で接続を完了してください。';
      _openHttpUrl(res.auth_url);
      this._pollGoogleTasksAuth(o, Date.now() + 5 * 60 * 1000);
    } catch (e) {
      this._showStatus('Google ToDo認証開始に失敗: ' + e.message, true);
    }
  };

  CalendarComponent.prototype._pollGoogleTasksAuth = function(o, expiresAt) {
    if (!document.body.contains(o)) return;
    if (Date.now() > expiresAt) {
      this._showStatus('Google ToDo認証の待機時間が切れました', true);
      return;
    }
    const statusEl = o.querySelector('.sync-gtask-auth-status');
    o._gtaskPollTimer = setTimeout(async () => {
      try {
        const status = await apiFetch('/cal/sync/status');
        if (status?.googleTasks?.connected) {
          this._showStatus('Google ToDo認証成功');
          _closeSyncOverlay(o);
          this._showSyncModal();
          return;
        }
        if (statusEl) statusEl.textContent = 'Googleログイン完了を待っています...';
        this._pollGoogleTasksAuth(o, expiresAt);
      } catch (e) {
        this._showStatus('Google ToDo認証確認に失敗: ' + e.message, true);
      }
    }, 3000);
  };

  CalendarComponent.prototype._googleTasksSync = async function(options = {}) {
    if (this._googleTasksSyncing) return;
    this._googleTasksSyncing = true;
    try {
      if (!options.silent) this._showStatus('Google ToDoと同期中...');
      const res = await apiPost('/cal/sync/google/tasks/sync', { user: this._getUser(), automatic: !!options.silent });
      await this._loadTasks();
      this._render();
      this._renderTodayTasks();
      if (!options.silent) {
        this._showStatus(`Google ToDo同期完了: ${res.imported || 0}件取得, ${res.pushed || 0}件送信, ${res.updated || 0}件更新`);
      }
    } catch (e) {
      if (!options.silent) this._showStatus('Google ToDo同期失敗: ' + e.message, true);
    } finally {
      this._googleTasksSyncing = false;
    }
  };

  CalendarComponent.prototype._ensureGoogleTasksAutoSync = function() {
    if (this._googleTasksAutoTimer || this._destroyed || !this._active) return;
    this._googleTasksAutoTimer = setInterval(() => this._googleTasksAutoSync(), 5 * 60 * 1000);
    setTimeout(() => this._googleTasksAutoSync(), 5000);
  };

  CalendarComponent.prototype._clearGoogleTasksAutoSync = function() {
    if (this._googleTasksAutoTimer) clearInterval(this._googleTasksAutoTimer);
    this._googleTasksAutoTimer = null;
  };

  CalendarComponent.prototype._googleTasksAutoSync = async function() {
    if (this._destroyed || !this._active || this._googleTasksSyncing) return;
    try {
      const status = await apiFetch('/cal/sync/status');
      if (!status?.googleTasks?.connected) return;
      await this._googleTasksSync({ silent: true });
    } catch {}
  };

  CalendarComponent.prototype._microsoftCalAuth = async function(o) {
    const clientId = o.querySelector('.sync-ms-id')?.value.trim();
    const tenant = o.querySelector('.sync-ms-tenant')?.value.trim() || 'common';
    const statusEl = o.querySelector('.sync-ms-auth-status');
    if (!clientId) { this._showStatus('MicrosoftのApplication IDを入力してください', true); return; }
    if (o._msPollTimer) clearTimeout(o._msPollTimer);
    try {
      const res = await apiPost('/cal/sync/microsoft/device-code', { client_id: clientId, tenant });
      const code = _calSyncEsc(res.user_code || '');
      const uri = _calSyncEsc(res.verification_uri || '');
      if (statusEl) statusEl.innerHTML = `ブラウザで ${uri} を開き、コード <strong>${code}</strong> を入力してください。`;
      if (res.verification_uri) _openHttpUrl(res.verification_uri);
      this._pollMicrosoftAuth(o, { clientId, tenant, deviceCode: res.device_code, interval: Math.max(2, res.interval || 5), expiresAt: Date.now() + Math.max(60, res.expires_in || 900) * 1000 });
    } catch (e) {
      this._showStatus('Microsoft認証開始に失敗: ' + e.message, true);
    }
  };

  CalendarComponent.prototype._pollMicrosoftAuth = function(o, session) {
    if (!session || !session.deviceCode || !document.body.contains(o)) return;
    if (Date.now() > session.expiresAt) {
      this._showStatus('Microsoft認証コードの有効期限が切れました', true);
      return;
    }
    const statusEl = o.querySelector('.sync-ms-auth-status');
    o._msPollTimer = setTimeout(async () => {
      try {
        const res = await apiPost('/cal/sync/microsoft/token', {
          client_id: session.clientId,
          tenant: session.tenant,
          device_code: session.deviceCode,
        });
        if (res.pending) {
          if (statusEl) statusEl.textContent = res.message || 'Microsoftログイン完了を待っています...';
          session.interval = Math.max(session.interval, res.interval || session.interval);
          this._pollMicrosoftAuth(o, session);
          return;
        }
        this._showStatus('Microsoft認証成功');
        _closeSyncOverlay(o);
        this._showSyncModal();
      } catch (e) {
        this._showStatus('Microsoft認証失敗: ' + e.message, true);
      }
    }, session.interval * 1000);
  };

  CalendarComponent.prototype._microsoftCalPull = async function() {
    this._showStatus('Microsoftカレンダーから取得中...');
    try {
      const res = await apiPost('/cal/sync/microsoft/pull', { user: this._getUser() });
      this._showStatus(`取得完了: ${res.imported}件インポート, ${res.updated}件更新`);
      await this._loadEvents();
      this._render();
    } catch (e) {
      this._showStatus('Microsoft同期失敗: ' + e.message, true);
    }
  };

  CalendarComponent.prototype._microsoftCalPush = async function() {
    this._showStatus('Microsoftカレンダーに送信中...');
    try {
      const res = await apiPost('/cal/sync/microsoft/push', { user: this._getUser() });
      this._showStatus(`送信完了: ${res.pushed}件プッシュ`);
    } catch (e) {
      this._showStatus('Microsoft送信失敗: ' + e.message, true);
    }
  };

  CalendarComponent.prototype._icalUrlImport = async function(o) {
    const url = o.querySelector('.sync-ical-url')?.value.trim();
    const username = o.querySelector('.sync-ical-user')?.value.trim();
    const password = o.querySelector('.sync-ical-pass')?.value;
    if (!url) { this._showStatus('iCal URLを入力してください', true); return; }
    this._showStatus('iCal URLから取得中...');
    try {
      const res = await apiPost('/cal/sync/ical/url-import', { url, username, password, user: this._getUser() });
      this._showStatus(`iCal取得完了: ${res.imported}件`);
      await this._loadEvents();
      this._render();
    } catch (e) {
      this._showStatus('iCal URL取得失敗: ' + e.message, true);
    }
  };

  CalendarComponent.prototype._icalImport = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ics,.ical';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const res = await apiPost('/cal/sync/ical/import', { ics: text, user: this._getUser() });
        this._showStatus(`iCalインポート完了: ${res.imported}件`);
        await this._loadEvents();
        this._render();
      } catch (e) {
        this._showStatus('インポート失敗: ' + e.message, true);
      }
    });
    input.click();
  };

  CalendarComponent.prototype._icalExport = async function() {
    const exportSave = window.MeldexExportSave || (typeof MeldexExportSave !== 'undefined' ? MeldexExportSave : null);
    const apiBase = typeof API_BASE !== 'undefined' ? API_BASE : '/api';
    if (!exportSave || typeof exportSave.saveUrl !== 'function') {
      this._showStatus('保存ダイアログを初期化できませんでした', true);
      return;
    }
    await exportSave.saveUrl(apiBase + '/cal/sync/ical/export?user=' + encodeURIComponent(this._getUser()), {
      filename: `calendar-${this._localDateStr(new Date())}.ics`,
      extension: '.ics',
      dialogTitle: 'iCal として保存',
      filetypes: [['iCalファイル', '*.ics'], ['すべてのファイル', '*.*']],
      okMessage: 'iCal を保存しました',
      errorMessage: 'iCal の保存に失敗しました',
    });
  };

  const _calSyncOriginalRefreshAfterActivation = CalendarComponent.prototype._refreshAfterActivation;
  CalendarComponent.prototype._refreshAfterActivation = function(...args) {
    const result = _calSyncOriginalRefreshAfterActivation.apply(this, args);
    if (typeof this._ensureGoogleTasksAutoSync === 'function') this._ensureGoogleTasksAutoSync();
    return result;
  };

  const _calSyncOriginalDeactivate = CalendarComponent.prototype.deactivate;
  CalendarComponent.prototype.deactivate = function(...args) {
    if (typeof this._clearGoogleTasksAutoSync === 'function') this._clearGoogleTasksAutoSync();
    return _calSyncOriginalDeactivate.apply(this, args);
  };

  const _calSyncOriginalDestroy = CalendarComponent.prototype.destroy;
  CalendarComponent.prototype.destroy = function(...args) {
    if (typeof this._clearGoogleTasksAutoSync === 'function') this._clearGoogleTasksAutoSync();
    return _calSyncOriginalDestroy.apply(this, args);
  };
})();
