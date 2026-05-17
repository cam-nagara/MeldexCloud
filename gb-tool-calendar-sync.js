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
    if (!available) return '<span style="color:var(--red);">利用不可</span>';
    return connected ? '<span style="color:var(--green);">接続済み</span>' : '未接続';
  }

  function _syncCard(title, body) {
    return `<div class="gb-cal-sync-card" style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:bold;margin-bottom:8px;">${title}</div>
      ${body}
    </div>`;
  }

  function _openHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol === 'https:' || url.protocol === 'http:') window.open(url.href, '_blank');
    } catch {}
  }

  CalendarComponent.prototype._showSyncModal = async function() {
    let syncStatus = {};
    try { syncStatus = await apiFetch('/cal/sync/status'); } catch {}
    const google = syncStatus.google || {};
    const microsoft = syncStatus.microsoft || {};
    const o = document.createElement('div');
    o.className = 'gb-cal-modal-overlay';
    o.innerHTML = `<div class="gb-cal-modal" style="min-width:min(560px,96vw);max-height:85vh;overflow-y:auto;">
      <h3>カレンダー同期</h3>
      ${_syncCard('Google Calendar', `
        <div style="font-size:12px;color:var(--fg2);margin-bottom:8px;">ステータス: ${_syncStatusLabel(!!google.connected, !!google.available)}</div>
        ${!google.connected && google.available ? `
          <div class="field"><label>Client ID</label><input class="sync-gcal-id" type="text" placeholder="Google Cloud Console で取得"></div>
          <div class="field"><label>Client Secret</label><input class="sync-gcal-secret" type="password"></div>
          <button class="sync-gcal-auth" type="button" style="font-size:12px;padding:4px 12px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;cursor:pointer;">Googleにログイン</button>` : ''}
        ${google.connected ? '<div style="display:flex;gap:4px;flex-wrap:wrap;"><button class="sync-gcal-pull" type="button" style="font-size:12px;padding:4px 12px;">Googleから取得</button><button class="sync-gcal-push" type="button" style="font-size:12px;padding:4px 12px;">Googleに送信</button></div>' : ''}
      `)}
      ${_syncCard('Microsoft Calendar', `
        <div style="font-size:12px;color:var(--fg2);margin-bottom:8px;">ステータス: ${_syncStatusLabel(!!microsoft.connected, !!microsoft.available)}</div>
        ${!microsoft.connected && microsoft.available ? `
          <div class="field"><label>Application (client) ID</label><input class="sync-ms-id" type="text" placeholder="Microsoft Entra のアプリID"></div>
          <div class="field"><label>Tenant</label><input class="sync-ms-tenant" type="text" value="${_calSyncEsc(microsoft.tenant || 'common')}"></div>
          <button class="sync-ms-auth" type="button" style="font-size:12px;padding:4px 12px;background:var(--accent);color:var(--ui-fg-strong);border:none;border-radius:4px;cursor:pointer;">Microsoftにログイン</button>
          <div class="sync-ms-auth-status" style="font-size:12px;color:var(--fg2);margin-top:8px;"></div>` : ''}
        ${microsoft.connected ? '<div style="display:flex;gap:4px;flex-wrap:wrap;"><button class="sync-ms-pull" type="button" style="font-size:12px;padding:4px 12px;">Microsoftから取得</button><button class="sync-ms-push" type="button" style="font-size:12px;padding:4px 12px;">Microsoftに送信</button></div>' : ''}
      `)}
      ${_syncCard('iCal / .ics', `
        <div style="font-size:12px;color:var(--fg2);margin-bottom:8px;">.icsファイル、またはBasic認証付きのiCal URLから取り込めます。</div>
        <div class="field"><label>iCal URL</label><input class="sync-ical-url" type="url" placeholder="https://example.com/calendar.ics"></div>
        <div style="display:flex;gap:8px;">
          <div class="field" style="flex:1;"><label>ユーザー名</label><input class="sync-ical-user" type="text"></div>
          <div class="field" style="flex:1;"><label>パスワード</label><input class="sync-ical-pass" type="password"></div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          <button class="sync-ical-url-import" type="button" style="font-size:12px;padding:4px 12px;">URLから取得</button>
          <button class="sync-ical-import" type="button" style="font-size:12px;padding:4px 12px;">.icsインポート</button>
          <button class="sync-ical-export" type="button" style="font-size:12px;padding:4px 12px;">.icsエクスポート</button>
        </div>
      `)}
      <div class="btn-row"><button class="sync-close" type="button">閉じる</button></div>
    </div>`;
    document.body.appendChild(o);
    o.querySelector('.sync-close').addEventListener('click', () => {
      if (o._msPollTimer) clearTimeout(o._msPollTimer);
      o.remove();
    });
    o.querySelector('.sync-gcal-auth')?.addEventListener('click', () => this._googleCalAuth(o));
    o.querySelector('.sync-gcal-pull')?.addEventListener('click', () => this._googleCalPull(o));
    o.querySelector('.sync-gcal-push')?.addEventListener('click', () => this._googleCalPush());
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
      o.remove();
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
      this._showStatus(`送信完了: ${res.pushed}件プッシュ`);
    } catch (e) {
      this._showStatus('Google送信失敗: ' + e.message, true);
    }
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
        o.remove();
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
    if (typeof MeldexExportSave === 'undefined' || typeof MeldexExportSave.saveUrl !== 'function') {
      this._showStatus('保存ダイアログを初期化できませんでした', true);
      return;
    }
    await MeldexExportSave.saveUrl(API_BASE + '/cal/sync/ical/export?user=' + encodeURIComponent(this._getUser()), {
      filename: `calendar-${this._localDateStr(new Date())}.ics`,
      extension: '.ics',
      dialogTitle: 'iCal として保存',
      filetypes: [['iCalファイル', '*.ics'], ['すべてのファイル', '*.*']],
      okMessage: 'iCal を保存しました',
      errorMessage: 'iCal の保存に失敗しました',
    });
  };
})();
