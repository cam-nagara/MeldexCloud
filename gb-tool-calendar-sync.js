/* ==============================
   gb-tool-calendar-sync.js: Calendar external sync UI
   ============================== */

(() => {
  if (typeof CalendarComponent === 'undefined') return;

  function _calSyncEsc(value) {
    return MeldexEscape.html(value);
  }

  function _syncStatusLabel(connected, available = true) {
    if (!available) return '<span class="gb-cal-sync-status-unavailable">利用不可</span>';
    return connected ? '<span class="gb-cal-sync-status-connected">接続済み</span>' : '未接続';
  }

  function _syncCard(title, body, extraClass = '') {
    return `<div class="gb-cal-sync-card${extraClass ? ` ${extraClass}` : ''}">
      <div class="gb-cal-sync-card-title">${title}</div>
      ${body}
    </div>`;
  }

  // Google Calendar / Microsoft Calendar の自動定期同期（差分取得）の間隔。
  // Google ToDo（_ensureGoogleTasksAutoSync）と同じ5分間隔だが、あちらは既存の回帰テストが
  // 文字列一致で参照しているため定数を共有せず、この2系統専用の定数として1箇所にまとめる。
  const CAL_EXT_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
  // 連続失敗がこの回数に達したら、次回モーダルを開いた時に状態表示を出す。
  const CAL_EXT_AUTO_SYNC_FAILURE_NOTICE_THRESHOLD = 2;

  function _calSyncIsDropboxMode() {
    try {
      return !!(window.MeldexRuntimeAdapter && typeof window.MeldexRuntimeAdapter.isDropboxMode === 'function' && window.MeldexRuntimeAdapter.isDropboxMode());
    } catch {
      return false;
    }
  }

  // iPhone購読用.icsの自動更新（gb-cal-ics-subscribe.js）を、Google/Microsoftカレンダーの
  // 自動同期サイクル成功後に便乗させる単一の呼び出し口。Cloud以外・未購読（有効フラグ無し）
  // では即bailする（autoRefreshIfEnabled内部のガード）ため、Desktopでは実質no-op。
  function _icsAutoRefreshOnSyncTick() {
    if (!_calSyncIsDropboxMode()) return;
    try {
      window.MeldexCalIcsSubscribe?.autoRefreshIfEnabled?.().catch((err) => {
        console.warn('[CalendarComponent] iPhone購読用.icsの自動更新に失敗:', err);
      });
    } catch (err) {
      console.warn('[CalendarComponent] iPhone購読用.icsの自動更新に失敗:', err);
    }
  }

  function _autoSyncStatusHtml(connected, failureCount) {
    if (!connected) return '';
    const notice = (failureCount || 0) >= CAL_EXT_AUTO_SYNC_FAILURE_NOTICE_THRESHOLD
      ? '<div class="gb-cal-sync-auto-status-error">自動同期が連続で失敗しています。手動で取得・送信してください。</div>'
      : '';
    return `<div class="gb-cal-sync-auto-status">自動同期: 5分ごと ${fieldHelp('接続中は5分ごとに新着・変更・削除を自動で同期します。Meldexを起動している間のみ実行されます。')}</div>${notice}`;
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

  // Cloud（Dropboxモード）向けの案内文・カード出し分け。gb-cal-cloud-sync.js /
  // gb-cal-oauth-browser.js / gb-cal-ics-subscribe.js が未実装の機能（Google ToDo・
  // iCal URL購読）はボタンごと非表示にする（行き止まりUI禁止。cloud-mobile-product
  // -quality-gate.md 準拠）。
  function _cloudGoogleAuthHelp() {
    return fieldHelp('Google Cloud Consoleで「OAuthクライアントID」（種類: ウェブアプリケーション）を作成し、'
      + `承認済みのリダイレクトURIに ${window.location.origin}/oauth-callback.html を追加してください。`
      + '認証情報はこの端末内の専用保存領域で管理され、Dropboxには平文で保存されません。');
  }

  function _cloudMicrosoftAuthHelp() {
    return fieldHelp('Microsoft Entra管理センターでアプリを登録し、プラットフォームを「シングルページアプリケーション(SPA)」にして、'
      + `リダイレクトURIに ${window.location.origin}/oauth-callback.html を追加してください。`
      + 'APIのアクセス許可に Calendars.ReadWrite / offline_access を追加してください。');
  }

  // triggerEl: このモーダルを開いた「外側の本来のトリガー要素」。省略時（外部からの
  // 新規オープン）は現在のフォーカス位置を採用する。_googleCalAuth 等が
  // 「閉じてすぐ作り直す」ため内部再生成する際は、直前のモーダルが保持していた
  // トリガー要素（o._gbSyncOpener）をそのまま引き継ぐ。再生成の瞬間の
  // document.activeElement は直前のモーダルごと消える内部要素（認証ボタン等）に
  // なっており、それを拾うと二度と外側へフォーカスを戻せなくなるため。
  CalendarComponent.prototype._showSyncModal = async function(triggerEl) {
    const opener = (triggerEl instanceof HTMLElement && triggerEl.isConnected)
      ? triggerEl
      : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const cloud = _calSyncIsDropboxMode();
    const isAdmin = !!this._calUserIsAdmin?.();
    let syncStatus = {};
    if (isAdmin) {
      try { syncStatus = await apiFetch('/cal/sync/status'); } catch {}
    }
    const google = syncStatus.google || {};
    const googleTasks = syncStatus.googleTasks || {};
    const microsoft = syncStatus.microsoft || {};
    const icsEnabled = cloud && !!window.MeldexCalIcsSubscribe?.isAutoRefreshEnabled?.();
    const content = document.createElement('div');
    content.className = 'gb-cal-sync-content';
    content.innerHTML = `
      ${_syncCard('Google Calendar', `
        <div class="gb-cal-sync-status">ステータス: ${_syncStatusLabel(!!google.connected, !!google.available)}</div>
        ${!google.connected && google.available ? `
          <div class="field"><label>Client ID ${cloud ? _cloudGoogleAuthHelp() : ''}</label><input class="sync-gcal-id" type="text" placeholder="Google Cloud Console で取得"></div>
          <div class="field"><label>Client Secret</label><input class="sync-gcal-secret" type="password"></div>
          <button class="sync-gcal-auth gb-cal-sync-action primary" type="button">Googleにログイン</button>` : ''}
        ${google.connected ? '<div class="gb-cal-sync-actions"><button class="sync-gcal-pull gb-cal-sync-action" type="button">Googleから取得</button><button class="sync-gcal-push gb-cal-sync-action" type="button">Googleに送信</button></div>' : ''}
        ${_autoSyncStatusHtml(!!google.connected, this._googleCalAutoSyncFailures)}
      `, 'gb-cal-sync-admin-only')}
      ${_syncCard('Google ToDo', `
        <div class="gb-cal-sync-status">ステータス: ${_syncStatusLabel(!!googleTasks.connected, !!googleTasks.available)}</div>
        ${!googleTasks.connected && googleTasks.available !== false ? (cloud ? `
          <div class="field"><label>Client ID ${_cloudGoogleAuthHelp()}</label><input class="sync-gtask-id" type="text" placeholder="Google Cloud Console で取得"></div>
          <div class="field"><label>Client Secret</label><input class="sync-gtask-secret" type="password"></div>
          <button class="sync-gtask-auth gb-cal-sync-action primary" type="button">Google ToDoにログイン</button>` : `
          <div class="field"><label>Client ID</label><input class="sync-gtask-id" type="text" placeholder="Google Cloud Console で取得"></div>
          <button class="sync-gtask-auth gb-cal-sync-action primary" type="button">Google ToDoにログイン</button>
          <div class="sync-gtask-auth-status gb-cal-sync-status gb-cal-sync-auth-status"></div>`) : ''}
        ${googleTasks.connected ? '<div class="gb-cal-sync-actions"><button class="sync-gtask-sync gb-cal-sync-action" type="button">Google ToDoと同期</button></div>' : ''}
      `, 'gb-cal-sync-admin-only')}
      ${_syncCard('Microsoft Calendar', `
        <div class="gb-cal-sync-status">ステータス: ${_syncStatusLabel(!!microsoft.connected, !!microsoft.available)}</div>
        ${!microsoft.connected && microsoft.available ? `
          <div class="field"><label>Application (client) ID ${cloud ? _cloudMicrosoftAuthHelp() : ''}</label><input class="sync-ms-id" type="text" placeholder="Microsoft Entra のアプリID"></div>
          <div class="field"><label>Tenant</label><input class="sync-ms-tenant" type="text" value="${_calSyncEsc(microsoft.tenant || 'common')}"></div>
          <button class="sync-ms-auth gb-cal-sync-action primary" type="button">Microsoftにログイン</button>
          <div class="sync-ms-auth-status gb-cal-sync-status gb-cal-sync-auth-status"></div>` : ''}
        ${microsoft.connected ? '<div class="gb-cal-sync-actions"><button class="sync-ms-pull gb-cal-sync-action" type="button">Microsoftから取得</button><button class="sync-ms-push gb-cal-sync-action" type="button">Microsoftに送信</button></div>' : ''}
        ${_autoSyncStatusHtml(!!microsoft.connected, this._microsoftCalAutoSyncFailures)}
      `, 'gb-cal-sync-admin-only')}
      ${_syncCard('iCal / .ics', !isAdmin ? `
        <div class="gb-cal-sync-status">本人の.icsファイルをインポート・エクスポートできます。</div>
        <div class="gb-cal-sync-actions">
          <button class="sync-ical-import gb-cal-sync-action" type="button">.icsインポート</button>
          <button class="sync-ical-export gb-cal-sync-action" type="button">.icsエクスポート</button>
        </div>
      ` : cloud ? `
        <div class="gb-cal-sync-status">.icsファイルをインポート・エクスポートできます${fieldHelp('認証付きURLからの定期取り込みは、静的ホスティング(CORS制約)のため現時点では利用できません。取得したファイルを.icsインポートしてください。')}</div>
        <div class="gb-cal-sync-actions">
          <button class="sync-ical-import gb-cal-sync-action" type="button">.icsインポート</button>
          <button class="sync-ical-export gb-cal-sync-action" type="button">.icsエクスポート</button>
        </div>
      ` : `
        <div class="gb-cal-sync-status">.icsファイル、または認証付きのiCal URLから取り込めます。</div>
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
      ${cloud ? _syncCard('iPhoneの照会カレンダー', `
        <div class="gb-cal-sync-status">Meldexの予定をDropbox経由で読み取り専用購読できます${fieldHelp('iPhoneの「設定」→「カレンダー」→「アカウントを追加」→「照会（購読）カレンダーを追加」で、作成したURLを登録してください。URLを知っている人は誰でも閲覧できる公開リンクです。更新はMeldexでカレンダーを開いている間に反映されます（Google/Microsoftカレンダーの自動同期のタイミングに便乗するため、どちらも未接続の場合は自動更新されません。その場合は「購読用URLを作成」を押し直すと最新化されます）。双方向に同期したい場合はGoogle/Microsoftカレンダー連携をご利用ください。')}</div>
        <div class="gb-cal-sync-status">URLを知っている人は誰でも閲覧できる公開リンクです</div>
        <div class="sync-ics-result gb-cal-sync-status gb-cal-sync-auth-status">${icsEnabled ? '購読用ファイルの自動更新: Meldexでカレンダーを開いている間' : ''}</div>
        <div class="gb-cal-sync-actions"><button class="sync-ics-create gb-cal-sync-action primary" type="button">購読用URLを作成</button></div>
      `, 'gb-cal-sync-admin-only') : ''}
    `;
    if (!isAdmin) {
      content.querySelectorAll('.gb-cal-sync-admin-only').forEach((card) => card.remove());
    }
    const closeButton = document.createElement('button');
    closeButton.className = 'sync-close gb-btn gb-btn-quiet gb-cal-sync-action';
    closeButton.type = 'button';
    closeButton.textContent = '閉じる';
    closeButton.setAttribute('aria-label', 'カレンダー同期を閉じる');
    closeButton.dataset.e2eId = 'calendar-sync-close';
    const modalApi = window.GBUI.createModal({
      id: 'calendar-tool-sync',
      title: 'カレンダー同期',
      body: content,
      footer: closeButton,
      variant: 'mobile-sheet',
      extraClass: 'gb-cal-sync-modal',
      initialFocus: '.sync-gcal-id, .sync-gcal-pull, .sync-gtask-id, .sync-gtask-sync, .sync-close',
      closeLabel: 'カレンダー同期を閉じる',
      closeOnEsc: true,
      closeOnOverlay: true,
      // 外側の本来のトリガー要素を明示的に指定する。指定した要素が閉じる時点で
      // 接続済みなら、document.activeElement の暗黙キャプチャより優先される
      // （gb-ui.js の _restoreOpenerFocus 参照）。
      returnFocus: () => (opener && opener.isConnected) ? opener : null,
      onClose: () => {
        if (o._msPollTimer) clearTimeout(o._msPollTimer);
        if (o._gtaskPollTimer) clearTimeout(o._gtaskPollTimer);
      },
    });
    const o = modalApi.overlay;
    // 内部再生成（_googleCalAuth 等）が引き継げるよう、解決済みのトリガー要素を
    // overlay自身へ保持しておく。
    o._gbSyncOpener = opener;
    o.classList.add('gb-cal-modal-overlay');
    o.dataset.e2eId = 'calendar-sync-overlay';
    modalApi.modal.classList.add('gb-cal-modal');
    modalApi.modal.dataset.e2eId = 'calendar-sync-dialog';
    modalApi.body.classList.add('gb-cal-sync-body');
    modalApi.body.dataset.e2eId = 'calendar-sync-body';
    modalApi.footer.classList.add('gb-cal-sync-footer');
    const close = (reason = 'programmatic') => {
      if (o._msPollTimer) clearTimeout(o._msPollTimer);
      if (o._gtaskPollTimer) clearTimeout(o._gtaskPollTimer);
      modalApi.close(reason);
    };
    o._gbCloseSyncModal = close;
    closeButton.addEventListener('click', () => close('close-button'));
    modalApi.open();
    o.querySelector('.sync-gcal-auth')?.addEventListener('click', () => (cloud ? this._googleCalAuthCloud(o) : this._googleCalAuth(o)));
    o.querySelector('.sync-gcal-pull')?.addEventListener('click', () => this._googleCalPull(o));
    o.querySelector('.sync-gcal-push')?.addEventListener('click', () => this._googleCalPush());
    o.querySelector('.sync-gtask-auth')?.addEventListener('click', () => (cloud ? this._googleTasksAuthCloud(o) : this._googleTasksAuth(o)));
    o.querySelector('.sync-gtask-sync')?.addEventListener('click', () => this._googleTasksSync());
    o.querySelector('.sync-ms-auth')?.addEventListener('click', () => (cloud ? this._microsoftCalAuthCloud(o) : this._microsoftCalAuth(o)));
    o.querySelector('.sync-ms-pull')?.addEventListener('click', () => this._microsoftCalPull(o));
    o.querySelector('.sync-ms-push')?.addEventListener('click', () => this._microsoftCalPush());
    o.querySelector('.sync-ical-url-import')?.addEventListener('click', () => this._icalUrlImport(o));
    o.querySelector('.sync-ical-import')?.addEventListener('click', () => this._icalImport());
    o.querySelector('.sync-ical-export')?.addEventListener('click', () => this._icalExport());
    o.querySelector('.sync-ics-create')?.addEventListener('click', () => this._icsSubscribeCreate(o));
  };

  CalendarComponent.prototype._googleCalAuth = async function(o) {
    const id = o.querySelector('.sync-gcal-id')?.value.trim();
    const secret = o.querySelector('.sync-gcal-secret')?.value.trim();
    if (!id || !secret) { this._showStatus('Client IDとSecretを入力してください', true); return; }
    try {
      const res = await apiPost('/cal/sync/google/auth', { client_id: id, client_secret: secret });
      this._showStatus(res.message || 'Google認証成功');
      _closeSyncOverlay(o);
      this._showSyncModal(o._gbSyncOpener);
    } catch (e) {
      this._showStatus('Google認証失敗: ' + e.message, true);
    }
  };

  // Cloud（Dropboxモード）向けのGoogle認証。デスクトップ版はローカルサーバー
  // ポップアップ方式（run_local_server）だが、静的ホスティングにサーバーは無いため
  // ブラウザ完結のPKCEポップアップ（gb-cal-oauth-browser.js）を使う。ポップアップ
  // ブロッカー回避のため、クリックハンドラの中でawaitを挟む前に同期的に開く。
  CalendarComponent.prototype._googleCalAuthCloud = async function(o) {
    const id = o.querySelector('.sync-gcal-id')?.value.trim();
    const secret = o.querySelector('.sync-gcal-secret')?.value.trim();
    if (!id || !secret) { this._showStatus('Client IDとSecretを入力してください', true); return; }
    let popup;
    try {
      popup = window.MeldexCalOAuthBrowser.openBlankPopup('Google');
    } catch (e) {
      this._showStatus(e.message, true);
      return;
    }
    this._showStatus('Googleのログイン画面で認証してください...');
    try {
      const res = await window.MeldexCalCloudSync.authorizeGoogle({ clientId: id, clientSecret: secret, popup });
      this._showStatus(res.message || 'Google認証成功');
      _closeSyncOverlay(o);
      this._showSyncModal(o._gbSyncOpener);
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
      if (res?.ok === false || (res.failed || 0) > 0) this._showStatus(`Google送信一部失敗: ${res.pushed || 0}件送信 / ${res.failed || 0}件失敗`, true);
      else this._showStatus(`送信完了: ${res.pushed}件プッシュ`);
    } catch (e) {
      this._showStatus('Google送信失敗: ' + e.message, true);
    }
  };

  // Google Calendar の自動定期同期（差分取得→ローカル変更の送信）。Google ToDoの
  // _ensureGoogleTasksAutoSync と同じライフサイクル（activate時に開始・deactivate/destroy時に停止・
  // 多重起動防止）。Cloud（Dropboxモード）も v0.7.138 以降は同じ5分間隔で動く
  // （gb-cal-cloud-sync.js が /cal/sync/google/pull|push を実装したため）。
  CalendarComponent.prototype._ensureGoogleCalAutoSync = function() {
    if (!this._calUserIsAdmin?.()) {
      this._clearGoogleCalAutoSync();
      return;
    }
    if (this._googleCalAutoTimer || this._destroyed || !this._active) return;
    this._googleCalAutoTimer = setInterval(() => this._googleCalAutoSync(), CAL_EXT_AUTO_SYNC_INTERVAL_MS);
    setTimeout(() => this._googleCalAutoSync(), 8000);
  };

  CalendarComponent.prototype._clearGoogleCalAutoSync = function() {
    if (this._googleCalAutoTimer) clearInterval(this._googleCalAutoTimer);
    this._googleCalAutoTimer = null;
  };

  CalendarComponent.prototype._googleCalAutoSync = async function() {
    if (!this._calUserIsAdmin?.() || this._destroyed || !this._active || this._googleCalAutoSyncing) return;
    this._googleCalAutoSyncing = true;
    let failed = false;
    try {
      const status = await apiFetch('/cal/sync/status');
      if (!status?.google?.connected) return;
      const user = this._getUser();
      try {
        const pullResult = await apiPost('/cal/sync/google/pull', { user, incremental: true });
        if (pullResult?.ok === false || (pullResult?.failed || 0) > 0) throw new Error('Google Calendar取得が一部失敗しました');
      } catch (e) {
        failed = true;
        console.warn('[CalendarComponent] Google Calendar自動取得に失敗:', e);
      }
      try {
        const pushResult = await apiPost('/cal/sync/google/push', { user });
        if (pushResult?.ok === false || (pushResult?.failed || 0) > 0) throw new Error('Google Calendar送信が一部失敗しました');
      } catch (e) {
        failed = true;
        console.warn('[CalendarComponent] Google Calendar自動送信に失敗:', e);
      }
      if (!failed) {
        await this._loadEvents();
        this._render();
        // コミット前レビュー指摘 #4: iPhone購読用.icsの自動更新は専用タイマーを別に張らず、
        // 既存の外部カレンダー自動同期サイクルに便乗する（未接続時はここへ到達しないため、
        // 「どちらも未接続なら5分毎の専用タイマーは張らない」実態と一致する）。有効フラグが
        // 立っていない場合・Cloud以外では即bailするため、Desktopや未購読時は何もしない。
        _icsAutoRefreshOnSyncTick();
      }
    } catch (e) {
      failed = true;
      console.warn('[CalendarComponent] Google Calendar自動同期に失敗:', e);
    } finally {
      this._googleCalAutoSyncFailures = failed ? (this._googleCalAutoSyncFailures || 0) + 1 : 0;
      this._googleCalAutoSyncing = false;
    }
  };

  // Cloud（Dropboxモード）向けのGoogle ToDo認証。デスクトップ版はリダイレクト+ポーリング方式
  // （ローカルAPIサーバーのコールバックルートへ戻る）だが、静的ホスティングにサーバーは
  // 無いため、Google Calendarと同じブラウザ完結PKCEポップアップ（gb-cal-oauth-browser.js）
  // を使う。カレンダー接続とは独立したトークンとして保存する（gb-cal-cloud-tasks.js参照。
  // スコープが異なるため、カレンダーの接続状態やトークンを流用しない）。
  CalendarComponent.prototype._googleTasksAuthCloud = async function(o) {
    const id = o.querySelector('.sync-gtask-id')?.value.trim();
    const secret = o.querySelector('.sync-gtask-secret')?.value.trim();
    if (!id || !secret) { this._showStatus('Client IDとSecretを入力してください', true); return; }
    let popup;
    try {
      popup = window.MeldexCalOAuthBrowser.openBlankPopup('Google');
    } catch (e) {
      this._showStatus(e.message, true);
      return;
    }
    this._showStatus('Googleのログイン画面で認証してください...');
    try {
      const res = await window.MeldexCalCloudTasks.authorizeGoogleTasks({ clientId: id, clientSecret: secret, popup });
      this._showStatus(res.message || 'Google ToDo認証成功');
      _closeSyncOverlay(o);
      this._showSyncModal(o._gbSyncOpener);
    } catch (e) {
      this._showStatus('Google ToDo認証失敗: ' + e.message, true);
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
          this._showSyncModal(o._gbSyncOpener);
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
    const progress = !options.silent ? window.MeldexOperationProgress?.begin?.({
      kind: 'calendar-sync',
      label: 'Google ToDoと同期しています',
      mode: 'indeterminate',
      showInTray: true,
      priority: 35,
    }) : null;
    try {
      if (!options.silent && !progress) this._showStatus('Google ToDoと同期中...');
      const res = await apiPost('/cal/sync/google/tasks/sync', { user: this._getUser(), automatic: !!options.silent });
      progress?.update?.({ phase: '表示を更新しています' });
      await this._loadTasks();
      this._render();
      this._renderTodayTasks();
      if (!options.silent) {
        const summary = `Google ToDo同期完了: ${res.imported || 0}件取得, ${res.pushed || 0}件送信, ${res.updated || 0}件更新`;
        if (progress) progress.succeed({ summary: summary });
        else this._showStatus(summary);
      }
    } catch (e) {
      if (!options.silent) {
        const message = 'Google ToDo同期失敗: ' + e.message;
        if (progress) progress.fail({ error: message });
        else this._showStatus(message, true);
      }
    } finally {
      this._googleTasksSyncing = false;
    }
  };

  CalendarComponent.prototype._ensureGoogleTasksAutoSync = function() {
    if (!this._calUserIsAdmin?.()) {
      this._clearGoogleTasksAutoSync();
      return;
    }
    if (this._googleTasksAutoTimer || this._destroyed || !this._active) return;
    this._googleTasksAutoTimer = setInterval(() => this._googleTasksAutoSync(), 5 * 60 * 1000);
    setTimeout(() => this._googleTasksAutoSync(), 5000);
  };

  CalendarComponent.prototype._clearGoogleTasksAutoSync = function() {
    if (this._googleTasksAutoTimer) clearInterval(this._googleTasksAutoTimer);
    this._googleTasksAutoTimer = null;
  };

  CalendarComponent.prototype._googleTasksAutoSync = async function() {
    if (!this._calUserIsAdmin?.() || this._destroyed || !this._active || this._googleTasksSyncing) return;
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
        this._showSyncModal(o._gbSyncOpener);
      } catch (e) {
        this._showStatus('Microsoft認証失敗: ' + e.message, true);
      }
    }, session.interval * 1000);
  };

  // Cloud（Dropboxモード）向けのMicrosoft認証。デスクトップ版はデバイスコード方式
  // （別画面でコード入力）だが、Cloudはブラウザ完結のSPA向けPKCEポップアップ
  // （gb-cal-oauth-browser.js。クライアントシークレット不要）を使う。
  CalendarComponent.prototype._microsoftCalAuthCloud = async function(o) {
    const clientId = o.querySelector('.sync-ms-id')?.value.trim();
    const tenant = o.querySelector('.sync-ms-tenant')?.value.trim() || 'common';
    if (!clientId) { this._showStatus('MicrosoftのApplication IDを入力してください', true); return; }
    let popup;
    try {
      popup = window.MeldexCalOAuthBrowser.openBlankPopup('Microsoft');
    } catch (e) {
      this._showStatus(e.message, true);
      return;
    }
    this._showStatus('Microsoftのログイン画面で認証してください...');
    try {
      const res = await window.MeldexCalCloudSync.authorizeMicrosoft({ clientId, tenant, popup });
      this._showStatus(res.message || 'Microsoft認証成功');
      _closeSyncOverlay(o);
      this._showSyncModal(o._gbSyncOpener);
    } catch (e) {
      this._showStatus('Microsoft認証失敗: ' + e.message, true);
    }
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
      if (res?.ok === false || (res.failed || 0) > 0) this._showStatus(`Microsoft送信一部失敗: ${res.pushed || 0}件送信 / ${res.failed || 0}件失敗`, true);
      else this._showStatus(`送信完了: ${res.pushed}件プッシュ`);
    } catch (e) {
      this._showStatus('Microsoft送信失敗: ' + e.message, true);
    }
  };

  // Microsoft Calendar の自動定期同期（差分取得→ローカル変更の送信）。Google Calendarの
  // _ensureGoogleCalAutoSync と同じライフサイクル・ガード方針。Cloud（Dropboxモード）も
  // v0.7.138 以降は同じ5分間隔で動く（gb-cal-cloud-sync.js 参照）。
  CalendarComponent.prototype._ensureMicrosoftCalAutoSync = function() {
    if (!this._calUserIsAdmin?.()) {
      this._clearMicrosoftCalAutoSync();
      return;
    }
    if (this._microsoftCalAutoTimer || this._destroyed || !this._active) return;
    this._microsoftCalAutoTimer = setInterval(() => this._microsoftCalAutoSync(), CAL_EXT_AUTO_SYNC_INTERVAL_MS);
    setTimeout(() => this._microsoftCalAutoSync(), 8000);
  };

  CalendarComponent.prototype._clearMicrosoftCalAutoSync = function() {
    if (this._microsoftCalAutoTimer) clearInterval(this._microsoftCalAutoTimer);
    this._microsoftCalAutoTimer = null;
  };

  CalendarComponent.prototype._microsoftCalAutoSync = async function() {
    if (!this._calUserIsAdmin?.() || this._destroyed || !this._active || this._microsoftCalAutoSyncing) return;
    this._microsoftCalAutoSyncing = true;
    let failed = false;
    try {
      const status = await apiFetch('/cal/sync/status');
      if (!status?.microsoft?.connected) return;
      const user = this._getUser();
      try {
        const pullResult = await apiPost('/cal/sync/microsoft/pull', { user, incremental: true });
        if (pullResult?.ok === false || (pullResult?.failed || 0) > 0) throw new Error('Microsoft Calendar取得が一部失敗しました');
      } catch (e) {
        failed = true;
        console.warn('[CalendarComponent] Microsoft Calendar自動取得に失敗:', e);
      }
      try {
        const pushResult = await apiPost('/cal/sync/microsoft/push', { user });
        if (pushResult?.ok === false || (pushResult?.failed || 0) > 0) throw new Error('Microsoft Calendar送信が一部失敗しました');
      } catch (e) {
        failed = true;
        console.warn('[CalendarComponent] Microsoft Calendar自動送信に失敗:', e);
      }
      if (!failed) {
        await this._loadEvents();
        this._render();
        // コミット前レビュー指摘 #4: Googleと同じく外部カレンダー自動同期サイクルに便乗して
        // iPhone購読用.icsを更新する。
        _icsAutoRefreshOnSyncTick();
      }
    } catch (e) {
      failed = true;
      console.warn('[CalendarComponent] Microsoft Calendar自動同期に失敗:', e);
    } finally {
      this._microsoftCalAutoSyncFailures = failed ? (this._microsoftCalAutoSyncFailures || 0) + 1 : 0;
      this._microsoftCalAutoSyncing = false;
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

  // iPhone向けICS購読リンクの作成（Cloud専用。gb-cal-ics-subscribe.js参照）。
  // Dropboxのsharing.writeスコープが無い既存接続では失敗するため、その場合は
  // ファイルパスを示した手動作成の案内へフォールバックする（行き止まりで終わらせない）。
  CalendarComponent.prototype._icsSubscribeCreate = async function(o) {
    const resultEl = o.querySelector('.sync-ics-result');
    if (!window.MeldexCalIcsSubscribe) {
      this._showStatus('購読機能を初期化できませんでした', true);
      return;
    }
    this._showStatus('購読用ファイルを作成しています...');
    try {
      const res = await window.MeldexCalIcsSubscribe.createSubscriptionLink();
      this._showStatus('購読用URLを作成しました');
      if (resultEl) {
        resultEl.innerHTML = `購読URL: <code class="sync-ics-url">${_calSyncEsc(res.webcalUrl)}</code> `
          + `<button class="sync-ics-copy gb-cal-sync-action" type="button">コピー</button>`;
        resultEl.querySelector('.sync-ics-copy')?.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(res.webcalUrl);
            this._showStatus('購読URLをコピーしました');
          } catch {
            this._showStatus('コピーに失敗しました。URLを選択して手動でコピーしてください', true);
          }
        });
      }
    } catch (e) {
      this._showStatus('購読用URLの作成に失敗: ' + e.message, true);
      if (resultEl) {
        const path = _calSyncEsc(e.manualPath || window.MeldexCalIcsSubscribe.ICS_RELATIVE_PATH);
        resultEl.innerHTML = `自動作成できませんでした。Dropbox上の <code>${path}</code> を右クリックして共有リンクを作成し、`
          + `そのURLをiPhoneの照会カレンダーへ登録してください${fieldHelp('Dropboxアプリまたはdropbox.comで対象ファイルを開き、「共有」→「リンクを作成」で取得できます。')}`;
      }
    }
  };

  const _calSyncOriginalRefreshAfterActivation = CalendarComponent.prototype._refreshAfterActivation;
  CalendarComponent.prototype._refreshAfterActivation = function(...args) {
    const result = _calSyncOriginalRefreshAfterActivation.apply(this, args);
    if (typeof this._ensureGoogleTasksAutoSync === 'function') this._ensureGoogleTasksAutoSync();
    if (typeof this._ensureGoogleCalAutoSync === 'function') this._ensureGoogleCalAutoSync();
    if (typeof this._ensureMicrosoftCalAutoSync === 'function') this._ensureMicrosoftCalAutoSync();
    return result;
  };

  const _calSyncOriginalDeactivate = CalendarComponent.prototype.deactivate;
  CalendarComponent.prototype.deactivate = function(...args) {
    if (typeof this._clearGoogleTasksAutoSync === 'function') this._clearGoogleTasksAutoSync();
    if (typeof this._clearGoogleCalAutoSync === 'function') this._clearGoogleCalAutoSync();
    if (typeof this._clearMicrosoftCalAutoSync === 'function') this._clearMicrosoftCalAutoSync();
    return _calSyncOriginalDeactivate.apply(this, args);
  };

  const _calSyncOriginalDestroy = CalendarComponent.prototype.destroy;
  CalendarComponent.prototype.destroy = function(...args) {
    if (typeof this._clearGoogleTasksAutoSync === 'function') this._clearGoogleTasksAutoSync();
    if (typeof this._clearGoogleCalAutoSync === 'function') this._clearGoogleCalAutoSync();
    if (typeof this._clearMicrosoftCalAutoSync === 'function') this._clearMicrosoftCalAutoSync();
    return _calSyncOriginalDestroy.apply(this, args);
  };
})();
