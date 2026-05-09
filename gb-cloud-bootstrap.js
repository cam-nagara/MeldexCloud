(function () {
  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _auth() {
    return window.MeldexDropboxAuth;
  }

  const CLOUD_UNSUPPORTED_CREATE_TYPES = new Set([]);
  const CLOUD_UNSUPPORTED_OPEN_TYPES = new Set([]);
  const CLOUD_UNSUPPORTED_RIGHT_TABS = new Set([]);
  const CLOUD_SPACE_WARNING_RATIO = 0.8;
  const CLOUD_SPACE_BLOCK_RATIO = 0.95;
  const CLOUD_HEALTH_INTERVAL_MS = 5 * 60 * 1000;
  let _cloudHealthTimer = 0;

  function _isDropboxMode() {
    return _runtime()?.isDropboxMode?.() || document.body?.dataset?.cloudMode === 'dropbox';
  }

  function _phase1FeatureLabel(type) {
    return {
      cli: 'ローカルCLI',
      mcp: 'ローカルMCP',
      os: 'OS連携',
      realtime: 'リアルタイム共同編集',
    }[String(type || '')] || 'この機能';
  }

  function _phase1FeaturePhase(type) {
    return {
      cli: 'ローカルCLI',
      mcp: 'ローカルMCP',
      os: 'OS連携',
      realtime: 'リアルタイム共同編集',
    }[String(type || '')] || '未対応機能';
  }

  function _phase1UnsupportedMessage(type) {
    const label = _phase1FeatureLabel(type);
    const category = _phase1FeaturePhase(type);
    const supported = (window.MeldexCloudBetaScope?.supported || ['フォルダ', 'ノート', 'シナリオ', 'シート', 'カレンダー', 'スマートシート']).join('、');
    return `${label}はMeldex Cloud BETAでは未対応です（対象外: ${category}）。現在対応しているのは ${supported} です。`;
  }

  function showPhase1Unsupported(type) {
    const message = _phase1UnsupportedMessage(type);
    if (typeof showStatus === 'function') showStatus(message, true);
    else _showBanner(message, true);
    return false;
  }

  function isPhase1UnsupportedType(type) {
    return _isDropboxMode() && CLOUD_UNSUPPORTED_OPEN_TYPES.has(String(type || ''));
  }

  function isPhase1UnsupportedCreateType(type) {
    return _isDropboxMode() && CLOUD_UNSUPPORTED_CREATE_TYPES.has(String(type || ''));
  }

  function filterPhase1CreateItems(items) {
    if (!_isDropboxMode()) return items || [];
    return (items || []).filter((item) => !isPhase1UnsupportedCreateType(Array.isArray(item) ? item[1] : item?.type));
  }

  function _esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _showBanner(message, isError, options) {
    let bar = document.getElementById('cloud-mode-banner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cloud-mode-banner';
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10050;padding:10px 14px;font-size:13px;font-family:system-ui,sans-serif;text-align:center;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;';
      document.body.appendChild(bar);
    }
    const opts = options || {};
    const level = isError === 'warning' ? 'warning' : (isError ? 'error' : 'ok');
    bar.style.background = level === 'error' ? '#7a2f2f' : (level === 'warning' ? '#6b4d1f' : '#234d2f');
    bar.style.color = '#fff';
    bar.dataset.cloudPersistent = level === 'ok' ? '0' : '1';
    bar.dataset.cloudBannerKind = opts.kind || '';
    bar.textContent = '';
    const text = document.createElement('span');
    text.textContent = message;
    bar.appendChild(text);
    (opts.actions || []).forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label || '';
      button.style.cssText = action.primary
        ? 'border:1px solid rgba(255,255,255,.65);background:#fff;color:#333;border-radius:5px;padding:4px 10px;cursor:pointer;font:inherit;'
        : 'border:1px solid rgba(255,255,255,.45);background:rgba(0,0,0,.18);color:#fff;border-radius:5px;padding:4px 10px;cursor:pointer;font:inherit;';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        action.onClick?.();
      });
      bar.appendChild(button);
    });
  }

  function _hideHealthBanner(kind) {
    const bar = document.getElementById('cloud-mode-banner');
    if (!bar) return;
    const currentKind = bar.dataset.cloudBannerKind || '';
    if (kind ? currentKind === kind : currentKind.startsWith('health-')) bar.remove();
  }

  function _formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let current = value;
    let unitIndex = 0;
    while (current >= 1024 && unitIndex < units.length - 1) {
      current /= 1024;
      unitIndex += 1;
    }
    const digits = current >= 10 || unitIndex === 0 ? 0 : 1;
    return `${current.toFixed(digits)} ${units[unitIndex]}`;
  }

  function _spaceUsageRatio(spaceUsage) {
    const allocated = Number(spaceUsage?.allocated || 0);
    if (!Number.isFinite(allocated) || allocated <= 0) return 0;
    const used = Number(spaceUsage?.used || 0);
    return Math.max(0, used / allocated);
  }

  function _setQuotaBlocked(blocked) {
    if (blocked) document.body.dataset.cloudQuotaBlocked = '1';
    else delete document.body.dataset.cloudQuotaBlocked;
  }

  function _applyCloudHealth(spaceUsage, conflicts) {
    const ratio = _spaceUsageRatio(spaceUsage);
    if (ratio >= CLOUD_SPACE_BLOCK_RATIO) {
      _setQuotaBlocked(true);
      _showBanner(`Dropbox 容量が95%を超えています（${_formatBytes(spaceUsage.used)} / ${_formatBytes(spaceUsage.allocated)}）。書き込みを停止しました。`, 'error', { kind: 'health-quota' });
      return;
    }
    if (spaceUsage?.allocated) _setQuotaBlocked(false);
    if (spaceUsage?.allocated) _hideHealthBanner('health-space-error');

    const conflictCount = Number(conflicts?.count || 0);
    if (conflictCount > 0 && !window.MeldexCloudConflictResolver?.isSnoozed?.()) {
      const first = conflicts?.items?.[0]?.path ? `: ${conflicts.items[0].path}` : '';
      _showBanner(`Dropbox 競合コピーを ${conflictCount} 件検出しました。内容を確認して手動で統合してください${first}`, 'warning', {
        kind: 'health-conflict',
        actions: [
          {
            label: '競合を解消',
            primary: true,
            onClick: () => window.MeldexCloudConflictResolver?.open?.(conflicts),
          },
          {
            label: '後回し',
            onClick: () => {
              window.MeldexCloudConflictResolver?.snooze?.();
              _hideHealthBanner('health-conflict');
            },
          },
        ],
      });
      return;
    }
    if (conflicts) _hideHealthBanner('health-conflict');

    if (ratio >= CLOUD_SPACE_WARNING_RATIO) {
      _showBanner(`Dropbox 容量が80%を超えています（${_formatBytes(spaceUsage.used)} / ${_formatBytes(spaceUsage.allocated)}）。不要ファイルの整理を検討してください。`, 'warning', { kind: 'health-quota' });
    } else if (spaceUsage?.allocated) {
      _hideHealthBanner('health-quota');
    }
  }

  async function _refreshCloudHealthOnce() {
    if (!_isDropboxMode()) return;
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    let spaceUsage = null;
    let conflicts = null;
    try {
      if (provider?.refreshSharedSpaceUsage) spaceUsage = await provider.refreshSharedSpaceUsage();
    } catch (err) {
      _showBanner(`Dropbox 容量確認に失敗しました: ${err?.message || String(err)}`, 'warning', { kind: 'health-space-error' });
    }
    try {
      conflicts = await window.MeldexDataAccess?.requestJson?.('/cloud/conflicts?limit=20');
    } catch {}
    _applyCloudHealth(spaceUsage, conflicts);
  }

  function _startCloudHealthMonitor() {
    if (_cloudHealthTimer) clearInterval(_cloudHealthTimer);
    setTimeout(() => _refreshCloudHealthOnce().catch(() => {}), 1200);
    _cloudHealthTimer = setInterval(() => {
      _refreshCloudHealthOnce().catch(() => {});
    }, CLOUD_HEALTH_INTERVAL_MS);
  }

  function _hideSelectors(selectors) {
    (selectors || []).forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        element.style.display = 'none';
      });
    });
  }

  function _ensurePhase1Style() {
    if (document.getElementById('cloud-phase1-style')) return;
    const style = document.createElement('style');
    style.id = 'cloud-phase1-style';
    style.textContent = `
      body[data-cloud-mode="dropbox"] [data-cloud-phase1-hidden="1"] {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function _hidePhase1UnsupportedUi() {
    _ensurePhase1Style();
  }

  function _guardGlobalFunction(name, shouldBlock, blockedValue) {
    const original = window[name];
    if (typeof original !== 'function' || original.__meldexCloudPhase1Guarded) return;
    const guarded = function () {
      if (_isDropboxMode() && shouldBlock.apply(this, arguments)) return blockedValue;
      return original.apply(this, arguments);
    };
    guarded.__meldexCloudPhase1Guarded = true;
    guarded.__meldexCloudPhase1Original = original;
    window[name] = guarded;
  }

  function _installPhase1FeatureGuards() {
    if (window.__MeldexCloudPhase1FeatureGuardsInstalled) return;
    window.__MeldexCloudPhase1FeatureGuardsInstalled = true;
    ['toggleRightPanelTab', 'switchRightTab', 'openRightPanelTab'].forEach((name) => {
      _guardGlobalFunction(name, (tabName) => {
        const blocked = CLOUD_UNSUPPORTED_RIGHT_TABS.has(String(tabName || ''));
        if (blocked) showPhase1Unsupported(tabName);
        return blocked;
      }, false);
    });
    _guardGlobalFunction('showToolMenu', (event, toolType) => {
      const blocked = isPhase1UnsupportedType(toolType);
      if (blocked) showPhase1Unsupported(toolType);
      return blocked;
    }, false);
  }

  function _disableSelectors(selectors) {
    (selectors || []).forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        if ('disabled' in element) element.disabled = true;
        if ('readOnly' in element) element.readOnly = true;
        element.setAttribute('aria-disabled', 'true');
        element.setAttribute('data-cloud-disabled', '1');
        if (!element.title) element.title = '閲覧専用モードでは利用できません';
      });
    });
  }

  function _lockContentEditable() {
    document.querySelectorAll('[contenteditable="true"]').forEach((element) => {
      element.setAttribute('contenteditable', 'false');
      element.setAttribute('data-cloud-disabled', '1');
    });
  }

  function _installReadonlyKeyGuard() {
    if (window.__MeldexCloudReadonlyKeyGuardInstalled) return;
    window.__MeldexCloudReadonlyKeyGuardInstalled = true;
    document.addEventListener('keydown', (event) => {
      if (document.body?.dataset?.cloudReadonly !== '1') return;
      const key = String(event.key || '').toLowerCase();
      const accel = event.ctrlKey || event.metaKey;
      if ((accel && ['s', 'n', 'z', 'y'].includes(key)) || key === 'delete') {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  function _applyPhase1UiGuards(options) {
    const readonly = !!options?.readonly;
    document.body.dataset.cloudMode = 'dropbox';
    _hidePhase1UnsupportedUi();
    _installPhase1FeatureGuards();
    if (!readonly) return;
    _disableSelectors([
      '#app-toolbar button',
      '#app-toolbar input',
      '#app-toolbar textarea',
      '#app-toolbar select',
      '#file-search-bar button',
      '#file-search-bar input',
      '#file-search-bar textarea',
      '#file-search-bar select',
      '#entity-view button',
      '#entity-view input',
      '#entity-view textarea',
      '#entity-view select',
      '#page-view button',
      '#page-view input',
      '#page-view textarea',
      '#page-view select',
      '#csv-view button',
      '#csv-view input',
      '#csv-view textarea',
      '#csv-view select',
      '#folder-view button',
      '#folder-view input',
      '#folder-view textarea',
      '#folder-view select',
      '#sidebar .sidebar-section-btn[data-action*="_showHomeAddMenu"]',
      '#sidebar .sidebar-section-btn[data-action*="addOutlinerRootFromSettings"]',
      '#sidebar .sidebar-section-btn[data-action*="_openSourceFolderSettings"]',
    ]);
    _lockContentEditable();
    _installReadonlyKeyGuard();
  }

  function _hideStartupSplashForBlockingCloudUi() {
    try {
      if (typeof _hideStartupSplash === 'function') {
        _hideStartupSplash();
        return;
      }
    } catch {}
    try {
      const splash = document.getElementById('gb-splash');
      if (splash) {
        splash.style.pointerEvents = 'none';
        splash.remove();
      }
    } catch {}
  }

  function _showModeChooser() {
    _hideStartupSplashForBlockingCloudUi();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:10020;padding:8px;box-sizing:border-box;';
      overlay.innerHTML = `<div class="meldex-cloud-mode-modal" data-modal-shell="off" role="dialog" aria-modal="true" style="width:calc(100vw - 16px);max-width:680px;max-height:calc(100vh - 16px);overflow:auto;box-sizing:border-box;background:#1e1e1e;color:#d4d4d4;border:1px solid #333;border-radius:12px;padding:clamp(16px,4vw,24px);box-shadow:0 16px 48px rgba(0,0,0,0.45);overflow-wrap:break-word;">
        <div style="font-size:22px;font-weight:700;margin-bottom:10px;">Meldex の保存モード</div>
        <div style="font-size:13px;color:#969696;line-height:1.7;margin-bottom:18px;">Meldex Cloud BETAでは Dropbox 共有フォルダを使うクラウドモードと、従来の PC 単独モードを切り替えます。</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:12px;">
          <button id="choose-dropbox" style="box-sizing:border-box;width:100%;min-width:0;text-align:left;padding:16px;border-radius:10px;border:1px solid #356b4d;background:#18261e;color:#d4d4d4;cursor:pointer;white-space:normal;overflow-wrap:break-word;">
            <div style="font-size:17px;font-weight:700;margin-bottom:6px;">Dropbox 共有モード</div>
            <div style="font-size:12px;line-height:1.6;color:#a8c0b0;">iPad / スマホ / PC で同じ vault を使います。初回のみ Dropbox 認証が必要です。</div>
          </button>
          <button id="choose-legacy" style="box-sizing:border-box;width:100%;min-width:0;text-align:left;padding:16px;border-radius:10px;border:1px solid #333;background:#252525;color:#d4d4d4;cursor:pointer;white-space:normal;overflow-wrap:break-word;">
            <div style="font-size:17px;font-weight:700;margin-bottom:6px;">PC 単独モード</div>
            <div style="font-size:12px;line-height:1.6;color:#969696;">既存の Python サーバ経由でローカル vault を使います。クラウド機能は使いません。</div>
          </button>
        </div>
        <div style="margin-top:14px;padding:10px 12px;border:1px solid #333;border-radius:8px;background:#252525;font-size:12px;line-height:1.7;color:#bdbdbd;">
          <div><strong>現在対応:</strong> フォルダ、ノート、シナリオ、ボード、シート、カレンダー、スマートシート、クラウド版フルチャット、暗号化APIキーCloud保存、注釈、バージョン管理、フィードバック、Dropbox競合検知/解決、スマホ/タブレットUI</div>
          <div><strong>未対応:</strong> リアルタイム共同編集、ローカルCLI/MCP/OS連携、外部カレンダー同期リレー未設定時のGoogle/CalDAV同期</div>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#choose-dropbox').addEventListener('click', () => {
        _runtime().setMode('dropbox');
        overlay.remove();
        resolve('dropbox');
      });
      overlay.querySelector('#choose-legacy').addEventListener('click', () => {
        _runtime().setMode('legacy');
        overlay.remove();
        resolve('legacy');
      });
    });
  }

  function _openAuthWindow(url) {
    const popup = window.open(url, 'meldex-dropbox-oauth', 'width=540,height=760');
    if (popup) {
      try {
        popup.opener = null;
      } catch {}
      try {
        popup.focus();
      } catch {}
      return;
    }
    window.location.href = url;
  }

  function _setupModalOptions() {
    return {
      defaultAppKey: _auth().getDefaultAppKey(),
      appMode: _auth().getAppMode(),
      customAppKey: _auth().getCustomAppKey(),
      vaultPath: _auth().getVaultPath(),
      redirectOverride: _auth().getRedirectOverride(),
    };
  }

  async function _showDropboxSetupModal(message) {
    _hideStartupSplashForBlockingCloudUi();
    const initial = _setupModalOptions();
    const session = await _auth().getSession();
    const pendingAuth = _auth().getPendingAuth?.();
    const showManualBox = !!pendingAuth?.manual;
    const isLegacyMode = _runtime().getMode?.() !== 'dropbox';
    const legacyButtonStyle = isLegacyMode
      ? 'padding:8px 14px;border:1px solid #444;border-radius:6px;background:#222;color:#777;cursor:not-allowed;'
      : 'padding:8px 14px;border:1px solid #555;border-radius:6px;background:#252525;color:#d4d4d4;cursor:pointer;';
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:10030;padding:20px;';
      overlay.innerHTML = `<div class="meldex-cloud-setup-modal" data-modal-shell="off" role="dialog" aria-modal="true" style="width:min(780px,96vw);max-height:90vh;overflow:auto;background:#1e1e1e;color:#d4d4d4;border:1px solid #333;border-radius:12px;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,0.45);">
        <div style="font-size:22px;font-weight:700;margin-bottom:8px;">Dropbox 連携設定</div>
        <div style="border:1px solid #333;border-radius:10px;padding:14px 16px;margin-bottom:14px;background:#202020;">
          <div style="font-size:15px;font-weight:700;margin-bottom:8px;">クラウド版では Dropbox が保存先になります</div>
          <div style="font-size:13px;color:#bdbdbd;line-height:1.7;">
            Meldex Cloud はブラウザで動くため、開発元サーバーには作品データを保存しません。スマホ、タブレット、PCで同じデータを開けるように、あなたのDropbox内のMeldex用フォルダを保存先として使います。
          </div>
          <div style="font-size:12px;color:#969696;line-height:1.7;margin-top:8px;">PC単独モードだけを使う場合、Dropbox接続は不要です。</div>
        </div>
        <div style="font-size:13px;color:#969696;line-height:1.7;margin-bottom:16px;">
          認証とは、Dropboxの画面で「Meldexが指定した保存先フォルダを読み書きしてよい」と許可する手続きです。DropboxのパスワードはMeldexには渡りません。接続情報はこの端末のブラウザ内に保存されます。
        </div>
        ${message ? `<div style="margin-bottom:14px;padding:10px 12px;border-radius:8px;background:#352919;color:#f3d08a;font-size:12px;line-height:1.6;">${_esc(message)}</div>` : ''}
        <section style="border:1px solid #333;border-radius:10px;padding:14px 16px;margin-bottom:14px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:10px;">保存先フォルダ</div>
          <label style="display:block;font-size:12px;color:#969696;margin-bottom:4px;">Dropbox内のMeldex用フォルダ</label>
          <input id="cloud-vault-path" type="text" value="${_esc(initial.vaultPath)}" placeholder="/MeldexVault" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #444;background:#252525;color:#d4d4d4;">
          <div style="margin-top:8px;font-size:12px;color:#969696;line-height:1.6;">初回は通常このままで構いません。既に別名のMeldex用フォルダを作っている場合だけ変更してください。</div>
        </section>
        <section style="border:1px solid #333;border-radius:10px;padding:14px 16px;margin-bottom:14px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:10px;">詳細設定（通常は変更不要）</div>
          <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin-bottom:8px;">
            <input type="radio" name="cloud-app-mode" value="developer" ${initial.appMode !== 'custom' ? 'checked' : ''}>
            <span>Meldex標準のDropbox接続を使う${initial.defaultAppKey ? '（推奨）' : '（このビルドでは未設定）'}</span>
          </label>
          <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;">
            <input type="radio" name="cloud-app-mode" value="custom" ${initial.appMode === 'custom' ? 'checked' : ''}>
            <span>自分で登録したDropbox OAuthアプリを使う</span>
          </label>
          <div id="cloud-custom-dropbox-settings" style="display:${initial.appMode === 'custom' ? '' : 'none'};margin-top:12px;border-top:1px solid #333;padding-top:12px;">
            <label style="display:block;font-size:12px;color:#969696;margin-bottom:4px;">Dropbox App key</label>
            <input id="cloud-custom-app-key" type="text" value="${_esc(initial.customAppKey)}" placeholder="Dropbox App key" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #444;background:#252525;color:#d4d4d4;">
            <label style="display:block;font-size:12px;color:#969696;margin:12px 0 4px;">redirect URI 上書き（任意）</label>
            <input id="cloud-redirect-override" type="text" value="${_esc(initial.redirectOverride)}" placeholder="${_esc(_auth().buildRedirectUri())}" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #444;background:#252525;color:#d4d4d4;">
            <div style="margin-top:8px;font-size:12px;color:#969696;line-height:1.6;">自分でDropbox OAuthアプリを作った場合だけ設定します。Dropbox App Consoleには、メインURL、予備HTTPS URL、<code>http://localhost:8080/</code>、<code>http://localhost:8001/</code>、<code>http://localhost:8001/?desktop=1</code> をredirect URIとして登録してください。</div>
            <div style="margin-top:8px;font-size:12px;color:#969696;line-height:1.6;">必要権限: <code>account_info.read files.metadata.read files.metadata.write files.content.read files.content.write sharing.read</code></div>
          </div>
        </section>
        <section style="border:1px solid #333;border-radius:10px;padding:14px 16px;margin-bottom:14px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:10px;">Dropboxへの接続</div>
          <div id="cloud-session-status" style="font-size:13px;line-height:1.7;color:${session?.refreshToken ? '#9dd6a5' : '#d4d4d4'};">
            ${session?.refreshToken ? `refresh token 保存済み${session?.account?.name?.display_name ? ` / ${_esc(session.account.name.display_name)}` : ''}` : '未認証'}
          </div>
          <div style="font-size:12px;color:#969696;line-height:1.6;margin-top:6px;">「Dropboxに接続」を押すとDropboxの許可画面が開きます。許可後、この画面に戻って「接続確認して開始」を押してください。</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <button id="cloud-auth-redirect" style="padding:8px 14px;border:none;border-radius:6px;background:#356b4d;color:#fff;cursor:pointer;">Dropbox に接続</button>
            <button id="cloud-auth-manual" style="padding:8px 14px;border:none;border-radius:6px;background:#28435a;color:#fff;cursor:pointer;">手動コード入力で認証</button>
            <button id="cloud-clear-session" style="padding:8px 14px;border:1px solid #555;border-radius:6px;background:#252525;color:#d4d4d4;cursor:pointer;">認証を解除</button>
          </div>
          <div id="cloud-manual-box" style="display:${showManualBox ? '' : 'none'};margin-top:12px;">
            <div style="font-size:12px;color:#969696;line-height:1.6;margin-bottom:6px;">Dropbox で表示された認可コードを貼り付けてください。</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <input id="cloud-manual-code" type="text" placeholder="認可コード" style="flex:1;min-width:220px;padding:8px 10px;border-radius:6px;border:1px solid #444;background:#252525;color:#d4d4d4;">
              <button id="cloud-manual-submit" style="padding:8px 14px;border:none;border-radius:6px;background:#356b4d;color:#fff;cursor:pointer;">コード交換</button>
            </div>
          </div>
        </section>
        <div id="cloud-setup-error" style="display:none;margin-bottom:12px;padding:10px 12px;border-radius:8px;background:#44262c;color:#f7b4c0;font-size:12px;line-height:1.6;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
          <button id="cloud-switch-legacy" ${isLegacyMode ? 'disabled aria-disabled="true" title="現在PC単独モードです"' : ''} style="${legacyButtonStyle}">${isLegacyMode ? '現在PC単独モード' : 'PC 単独モードへ戻す'}</button>
          <button id="cloud-continue" style="padding:8px 14px;border:none;border-radius:6px;background:#569cd6;color:#fff;cursor:pointer;">接続確認して開始</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);

      function setError(text) {
        const el = overlay.querySelector('#cloud-setup-error');
        if (!text) {
          el.style.display = 'none';
          el.textContent = '';
          return;
        }
        el.style.display = '';
        el.textContent = text;
      }

      function updateAdvancedSettings() {
        const mode = overlay.querySelector('input[name="cloud-app-mode"]:checked')?.value || 'developer';
        const advanced = overlay.querySelector('#cloud-custom-dropbox-settings');
        if (advanced) advanced.style.display = mode === 'custom' ? '' : 'none';
      }

      function saveInputs() {
        const mode = overlay.querySelector('input[name="cloud-app-mode"]:checked')?.value || 'developer';
        _auth().setAppMode(mode);
        _auth().setCustomAppKey(overlay.querySelector('#cloud-custom-app-key').value.trim());
        _auth().setVaultPath(overlay.querySelector('#cloud-vault-path').value.trim());
        _auth().setRedirectOverride(overlay.querySelector('#cloud-redirect-override').value.trim());
      }

      overlay.querySelectorAll('input[name="cloud-app-mode"]').forEach((input) => {
        input.addEventListener('change', updateAdvancedSettings);
      });
      updateAdvancedSettings();

      async function exchangeManualCodeIfPresent() {
        const manualBox = overlay.querySelector('#cloud-manual-box');
        const codeInput = overlay.querySelector('#cloud-manual-code');
        const code = codeInput?.value?.trim?.() || '';
        if (!code) return false;
        manualBox.style.display = '';
        await _auth().exchangeManualCode(code);
        codeInput.value = '';
        overlay.querySelector('#cloud-session-status').textContent = '認証済み';
        overlay.querySelector('#cloud-session-status').style.color = '#9dd6a5';
        setError('');
        return true;
      }

      overlay.querySelector('#cloud-auth-redirect').addEventListener('click', async () => {
        try {
          saveInputs();
          const auth = await _auth().beginAuth({ manual: false });
          _openAuthWindow(auth.authorizationUrl);
        } catch (err) {
          setError(err?.message || String(err));
        }
      });

      overlay.querySelector('#cloud-auth-manual').addEventListener('click', async () => {
        try {
          saveInputs();
          const auth = await _auth().beginAuth({ manual: true });
          overlay.querySelector('#cloud-manual-box').style.display = '';
          _openAuthWindow(auth.authorizationUrl);
        } catch (err) {
          setError(err?.message || String(err));
        }
      });

      overlay.querySelector('#cloud-manual-submit').addEventListener('click', async () => {
        try {
          saveInputs();
          if (!await exchangeManualCodeIfPresent()) throw new Error('認可コードを入力してください');
        } catch (err) {
          setError(err?.message || String(err));
        }
      });

      overlay.querySelector('#cloud-clear-session').addEventListener('click', async () => {
        await _auth().clearSession();
        overlay.querySelector('#cloud-session-status').textContent = '未認証';
        overlay.querySelector('#cloud-session-status').style.color = '#d4d4d4';
      });

      overlay.querySelector('#cloud-switch-legacy').addEventListener('click', () => {
        if (isLegacyMode) return;
        _runtime().setMode('legacy');
        overlay.remove();
        resolve({ ok: false, switchToLegacy: true });
      });

      overlay.querySelector('#cloud-continue').addEventListener('click', async () => {
        try {
          saveInputs();
          await exchangeManualCodeIfPresent();
          if (!_auth().getAppKey()) throw new Error('Dropbox App key を設定してください');
          if (!_auth().getVaultPath()) throw new Error('共有フォルダ mount パスを入力してください');
          _runtime().setMode('dropbox');
          overlay.remove();
          resolve({ ok: true });
        } catch (err) {
          setError(err?.message || String(err));
        }
      });
    });
  }

  async function _enterLegacyMode() {
    document.body.dataset.cloudMode = 'legacy';
    delete document.body.dataset.cloudReadonly;
    await window.MeldexStorageAdapter?.describeWorkspace?.().catch(() => null);
    return true;
  }

  function _isDesktopLaunch() {
    try {
      return new URLSearchParams(window.location.search).get('desktop') === '1';
    } catch {
      return false;
    }
  }

  function _isLocalAppHost() {
    try {
      const host = String(window.location.hostname || '').toLowerCase();
      if (!host) return window.location.protocol === 'file:';
      return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch {
      return false;
    }
  }

  function _isHostedCloudLaunch() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('dataAccessMode') || params.get('safeMode') === '1' || params.get('desktop') === '1') return false;
    } catch {}
    try {
      return window.location.protocol === 'https:' && !_isLocalAppHost();
    } catch {
      return false;
    }
  }

  async function prepareLaunch() {
    const callback = await _auth().handleRedirectCallback();
    if (callback.handled && !callback.ok) {
      await _showDropboxSetupModal(callback.error || 'Dropbox 認証に失敗しました');
    }
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('smoke')) {
        _runtime().setMode('legacy');
        return _enterLegacyMode();
      }
    } catch {}
    let mode = _runtime().getMode();
    let hasExplicitMode = false;
    try {
      const params = new URLSearchParams(window.location.search);
      hasExplicitMode = params.has('dataAccessMode') || params.get('safeMode') === '1';
    } catch {}
    const hasStoredMode = _runtime().hasStoredMode?.();
    if (_isHostedCloudLaunch() && !hasExplicitMode) {
      if (mode === 'legacy') _runtime().clearMode?.();
      _runtime().setMode('dropbox');
      mode = 'dropbox';
    } else if (!hasStoredMode && !hasExplicitMode && _isDesktopLaunch()) {
      _runtime().setMode('legacy');
      mode = 'legacy';
    } else if (!hasStoredMode && !hasExplicitMode) {
      mode = await _showModeChooser();
    }
    if (mode !== 'dropbox') {
      return _enterLegacyMode();
    }

    while (true) {
      const session = await _auth().getSession();
      if (!_auth().getAppKey() || !_auth().getVaultPath() || !session?.refreshToken) {
        const result = await _showDropboxSetupModal(callback.handled && callback.ok ? 'Dropbox 認証が完了しました。共有フォルダの設定を確認して開始してください。' : '');
        if (result?.switchToLegacy) return _enterLegacyMode();
        if (!result?.ok) return false;
        continue;
      }

      try {
        const preflight = await window.MeldexStorageAdapter.preflight();
        if (!preflight.ok) {
          const result = await _showDropboxSetupModal(preflight.message);
          if (result?.switchToLegacy) return _enterLegacyMode();
          if (!result?.ok) return false;
          continue;
        }
        await window.MeldexCloudSampleSeed?.prepareHome?.({ preflight }).catch((err) => {
          console.warn('[MeldexCloudBootstrap] sample home preparation failed', err);
        });
        window.MeldexCloudSampleSeed?.ensure?.({ background: true }).catch((err) => {
          console.warn('[MeldexCloudBootstrap] sample seed scheduling failed', err);
        });
        _applyPhase1UiGuards({ readonly: preflight.access === 'viewer' });
        if (preflight.access === 'viewer') {
          document.body.dataset.cloudReadonly = '1';
          _showBanner('閲覧専用モードです。編集機能は無効化されます。', false);
        } else {
          _showBanner(`Dropbox 接続済み: ${preflight.state?.name || 'vault'}`, false);
          setTimeout(() => {
            const bar = document.getElementById('cloud-mode-banner');
            if (bar && bar.dataset.cloudPersistent !== '1') bar.remove();
          }, 3000);
        }
        _startCloudHealthMonitor();
        return true;
      } catch (err) {
        const result = await _showDropboxSetupModal(err?.message || String(err));
        if (result?.switchToLegacy) return _enterLegacyMode();
        if (!result?.ok) return false;
      }
    }
  }

  async function openSettingsFlow(message) {
    const beforeMode = _runtime().getMode();
    const result = await _showDropboxSetupModal(message || '');
    const afterMode = _runtime().getMode();
    if (result?.ok || result?.switchToLegacy || beforeMode !== afterMode) {
      window.location.reload();
    }
    return result;
  }

  window.MeldexCloudBootstrap = {
    prepareLaunch,
    openSettingsFlow,
    isPhase1UnsupportedType,
    isPhase1UnsupportedCreateType,
    filterPhase1CreateItems,
    showPhase1Unsupported,
    openSetupModal(message) {
      return _showDropboxSetupModal(message || '');
    },
  };
})();
