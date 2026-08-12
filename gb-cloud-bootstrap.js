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
  const CLOUD_CONFLICT_REPORT_KEY = 'meldex-cloud-conflict-report-signature';
  let _cloudHealthTimer = 0;
  let _cloudReadonlyObserver = null;
  let _cloudReadonlySyncPending = false;

  function _isDropboxMode() {
    return _runtime()?.isDropboxMode?.() || document.body?.dataset?.cloudMode === 'dropbox';
  }

  function _isBrowserMode() {
    return _runtime()?.isBrowserMode?.() || document.body?.dataset?.cloudMode === 'browser';
  }

  function _isServerMode() {
    return _runtime()?.isServerMode?.() || document.body?.dataset?.cloudMode === 'server';
  }

  function _localDataModeForPage() {
    return _isHostedCloudPage() || _isBrowserMode() ? 'browser' : 'legacy';
  }

  function _isLocalConflictMonitorHost() {
    return !_isDropboxMode() && !_isBrowserMode() && !_isServerMode() && _isLocalAppHost();
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
    }[String(type || '')] || 'ブラウザ外の機能';
  }

  function _phase1UnsupportedMessage(type) {
    const label = _phase1FeatureLabel(type);
    const category = _phase1FeaturePhase(type);
    const supported = (window.MeldexCloudBetaScope?.supported || ['フォルダ', 'ノート', 'シナリオ', 'シート', 'カレンダー', 'スマートシート']).join('、');
    return `${label}はブラウザ版から直接実行できません（理由: ${category}）。現在この画面で使える機能は ${supported} です。`;
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
    (opts.actions || []).forEach((action, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.e2eId = `cloud-banner-${opts.kind || 'status'}-action-${index + 1}`;
      button.className = action.primary
        ? 'meldex-cloud-banner-action meldex-cloud-banner-action-primary'
        : 'meldex-cloud-banner-action';
      button.textContent = action.label || '';
      button.style.cssText = action.primary
        ? 'border:1px solid rgba(255,255,255,.65);background:#fff;color:#333;border-radius:5px;padding:4px 10px;min-height:32px;cursor:pointer;font:inherit;'
        : 'border:1px solid rgba(255,255,255,.45);background:rgba(0,0,0,.18);color:#fff;border-radius:5px;padding:4px 10px;min-height:32px;cursor:pointer;font:inherit;';
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

  function _safeSessionGet(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function _safeSessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) {}
  }

  function _reportConflictHealth(conflicts) {
    const conflictCount = Number(conflicts?.count || 0);
    if (!conflictCount) return;
    const signature = [
      conflictCount,
      conflicts?.truncated ? 'truncated' : 'complete',
    ].join(':');
    if (_safeSessionGet(CLOUD_CONFLICT_REPORT_KEY) === signature) return;
    _safeSessionSet(CLOUD_CONFLICT_REPORT_KEY, signature);
    window.MeldexBetaFeedback?.recordLog?.('error', {
      message: `Dropbox競合コピーを${conflictCount}件検出しました`,
      reason: 'dropbox-conflict-copies-detected',
      conflictCount,
      conflictTruncated: !!conflicts?.truncated,
      runtimeMode: _isDropboxMode() ? 'dropbox' : 'local-conflict-monitor',
    });
  }

  // 計画書§2.6「非モーダル未解決表示は残す」・§5工程2-D項目8。「後回し」
  // （承認済み）後も、確認導線だけを持つ静かな常設表示は残す。warningではなく
  // okトーンにし、アクションは「確認する」のみ（新規の警告や自動再検出の
  // 通知を増やさない。同じDOM要素を使い回すだけで、呼ばれるたびに新しい
  // 通知が積み上がるわけではない）。
  function _showAcknowledgedConflictNotice(conflicts) {
    const conflictCount = Number(conflicts?.count || 0);
    _showBanner(`Dropbox 競合コピーが ${conflictCount} 件、確認待ちのままです`, false, {
      kind: 'health-conflict-ack',
      actions: [
        {
          label: '確認する',
          onClick: () => window.MeldexCloudConflictResolver?.open?.(conflicts),
        },
      ],
    });
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

    // 計画書§5工程2-D項目8: 「後回し」は一律の時間経過ではなく、対象となった
    // 競合集合そのもの（競合世代）が承認済みかどうかで判定する
    // （isAcknowledged(conflicts)）。承認済みの間はモーダル誘導の強いバナーを
    // 再生成しないが、§2.6「非モーダル未解決表示は残す」に従い、確認導線
    // だけを持つ静かな常設表示は維持する（同じDOM要素を使い回すだけで、
    // 新しい通知を生成し続けるわけではない）。
    const conflictCount = Number(conflicts?.count || 0);
    if (conflictCount > 0) {
      const acknowledged = !!window.MeldexCloudConflictResolver?.isAcknowledged?.(conflicts);
      if (!acknowledged) {
        _reportConflictHealth(conflicts);
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
                window.MeldexCloudConflictResolver?.acknowledge?.(conflicts);
                _showAcknowledgedConflictNotice(conflicts);
              },
            },
          ],
        });
        return;
      }
      _showAcknowledgedConflictNotice(conflicts);
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
    const dropboxMode = _isDropboxMode();
    if (!dropboxMode && !_isLocalConflictMonitorHost()) return;
    const provider = dropboxMode ? window.MeldexStorageAdapter?.getProvider?.() : null;
    let spaceUsage = null;
    let conflicts = null;
    try {
      if (dropboxMode && provider?.refreshSharedSpaceUsage) spaceUsage = await provider.refreshSharedSpaceUsage();
    } catch (err) {
      _showBanner(`Dropbox 容量確認に失敗しました: ${err?.message || String(err)}`, 'warning', { kind: 'health-space-error' });
    }
    try {
      conflicts = await window.MeldexDataAccess?.requestJson?.('/cloud/conflicts?limit=20');
    } catch {}
    if (dropboxMode && provider && window.MeldexCloudConflictResolver?.hydrateAcknowledgement) {
      await window.MeldexCloudConflictResolver.hydrateAcknowledgement(provider).catch(() => {});
    }
    _applyCloudHealth(spaceUsage, conflicts);
  }

  const COMPATIBILITY_LOCK_MESSAGE = '旧バージョンのMeldexによる付随データを検出したため、共有ワークスペースを閲覧専用にしました。全員を最新版へ更新し、ワークスペースの所有者が再移行してください。';

  async function _sharedCompatibilityLock(provider) {
    const resolver = window.MeldexDropboxManagementRootResolver;
    const migration = window.MeldexSidecarMigration;
    if (!provider || !resolver?.resolveConnectionInfo) return { locked: false, shared: false };
    let info;
    try {
      info = await resolver.resolveConnectionInfo(provider);
    } catch (error) {
      // 接続先を共有と確定できない場合に互換性ロックを個人領域へ誤適用しない。
      // 書込み可否は保存先resolver側が別途fail-closeで拒否する。
      return { locked: false, shared: false, classificationUnavailable: true, detail: String(error?.message || error) };
    }
    if (info?.kind === 'unknown') {
      return {
        locked: true,
        shared: true,
        unavailable: true,
        classificationUnavailable: true,
        detail: 'Dropboxの接続先を個人領域か共有ワークスペースか判定できません',
      };
    }
    if (!info?.isSharedWorkspace) return { locked: false, shared: false };
    if (!migration?.getCompatibilityLock) return { locked: true, shared: true, unavailable: true };
    try {
      const lock = await migration.getCompatibilityLock(provider);
      return { ...(lock || {}), shared: true };
    } catch (error) {
      return { locked: true, shared: true, unavailable: true, detail: String(error?.message || error) };
    }
  }

  function _applyCompatibilityReadonly(lock) {
    document.body.dataset.cloudReadonly = '1';
    document.body.dataset.cloudReadonlyReason = 'compatibility-lock';
    _applyPhase1UiGuards({ readonly: true });
    _showBanner(COMPATIBILITY_LOCK_MESSAGE, 'warning', { kind: 'compatibility-lock' });
  }

  async function _isCurrentWorkspaceOwner(provider) {
    if (!provider?.readVaultMetadata || !provider?.isCurrentAccountVaultOwner) return false;
    const auth = window.MeldexDropboxAuth;
    if (!auth?.getCurrentAccount) return false;
    try {
      const [metadata, account] = await Promise.all([
        provider.readVaultMetadata(),
        auth.getCurrentAccount(false),
      ]);
      return provider.isCurrentAccountVaultOwner(metadata, account) === true;
    } catch {
      return false;
    }
  }

  // 移行・旧クライアント検知を起動完了前に実行し、互換性ロックの検査前に
  // 編集可能な時間が生じないようにする。移行中だけ管理領域の内部書込みを許可する。
  async function _runSidecarMigrationOnce(provider, options) {
    const migration = window.MeldexSidecarMigration;
    if (!migration || typeof migration.migrateCloudSidecars !== 'function' || !provider) return null;
    const dropboxStorage = window.MeldexSystemStorageDropbox;
    const migrate = () => migration.migrateCloudSidecars(provider);
    let migrationResult = null;
    if (typeof dropboxStorage?.runMigrationWriteScope === 'function') {
      migrationResult = await dropboxStorage.runMigrationWriteScope(migrate).catch(() => null);
    } else {
      migrationResult = await migrate().catch(() => null);
    }
    if (
      options?.allowOwnerUnlock === true
      && migrationResult?.status === 'completed'
      && typeof migration.clearCompatibilityLockAfterOwnerRemigration === 'function'
      && await _isCurrentWorkspaceOwner(provider)
    ) {
      const clear = () => migration.clearCompatibilityLockAfterOwnerRemigration(
        provider, { isOwner: true, remigrationSucceeded: true },
      );
      if (typeof dropboxStorage?.runMigrationWriteScope === 'function') {
        await dropboxStorage.runMigrationWriteScope(clear).catch(() => null);
      } else {
        await clear().catch(() => null);
      }
    }
    const connection = await window.MeldexDropboxManagementRootResolver
      ?.resolveConnectionInfo?.(provider).catch(() => null);
    if (connection?.isSharedWorkspace && typeof migration.detectLegacyClientActivity === 'function') {
      const legacyClient = await migration.detectLegacyClientActivity(provider).catch(() => null);
      if (legacyClient?.detected) return legacyClient.compatibilityLock || { locked: true };
    }
    return _sharedCompatibilityLock(provider);
  }

  // フェーズB徹底チェック(c): 移行バックアップ・競合バックアップの30日保持
  // (計画書§6.3)が、判定関数(selectDocumentsExceedingRetention)のみ存在し
  // 呼び出し元が無いため実質無期限だった問題への対応。上の
  // _runSidecarMigrationOnce と同じ「Dropbox接続確立(owner/editor権限)後に
  // バックグラウンドで1回」のフックで、期限超過分の掃除を行う
  // (失敗しても無視。次回接続時に再試行される)。
  function _runSystemStorageRetentionCleanupOnce() {
    const storage = window.MeldexSystemStorage;
    const resolver = window.MeldexDropboxManagementRootResolver;
    if (!storage || typeof storage.runRetentionCleanup !== 'function' || !resolver) return;
    setTimeout(() => {
      (async () => {
        const provider = window.MeldexStorageAdapter?.getProvider?.();
        if (!provider) return;
        const adapter = await resolver.resolveAdapterForProvider(provider).catch(() => null);
        if (!adapter) return;
        await storage.runRetentionCleanup(adapter).catch(() => {});
      })().catch(() => {});
    }, 3000);
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
        if (!element.hasAttribute('data-cloud-original-title')) {
          element.setAttribute('data-cloud-original-title', element.getAttribute('title') || '');
        }
        element.title = '閲覧専用モードでは利用できません';
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

  const CLOUD_READONLY_SELECTORS = [
    '#file-search-bar #fsb-replace',
    '#file-search-bar [data-action^="doFileReplace"]',
    '#entity-props-grid button',
    '#entity-props-grid input',
    '#entity-props-grid textarea',
    '#entity-props-grid select',
    '#entity-create-note-btn button',
    '#entity-rt-toolbar button',
    '#entity-rt-toolbar input',
    '#entity-rt-toolbar textarea',
    '#entity-rt-toolbar select',
    '#page-title',
    '#page-rt-toolbar [data-action^="rtCmd"]',
    '#page-rt-toolbar [data-action^="insertCallout"]',
    '#page-rt-toolbar [data-action^="insertNoteTable"]',
    '#page-rt-toolbar select[data-onchange*="rtHeading"]',
    '#btn-tb-annotation',
    '#csv-add-row',
    '#csv-add-col',
    '#csv-to-db',
    '#csv-undo',
    '#csv-redo',
    '#csv-table-container input',
    '#csv-table-container textarea',
    '#csv-table-container select',
    '#csv-table-container button',
    '#folder-toolbar-add',
    '#folder-toolbar-cut',
    '#folder-toolbar-paste',
    '#folder-toolbar-delete',
    '#folder-toolbar-undo',
    '#folder-toolbar-redo',
    '#folder-view [data-action^="fvBulkBoard"]',
    '#folder-view [data-action^="fvBulkDelete"]',
    '#sidebar .sidebar-section-btn[data-action*="_showHomeAddMenu"]',
    '#sidebar .sidebar-section-btn[data-action*="addOutlinerRootFromSettings"]',
    '#sidebar .sidebar-section-btn[data-action*="_openSourceFolderSettings"]',
  ];

  function _applyCloudReadonlyDomGuards() {
    _disableSelectors(CLOUD_READONLY_SELECTORS);
    _lockContentEditable();
  }

  function _scheduleCloudReadonlyDomGuards() {
    if (document.body?.dataset?.cloudReadonly !== '1') return;
    if (_cloudReadonlySyncPending) return;
    _cloudReadonlySyncPending = true;
    const run = () => {
      _cloudReadonlySyncPending = false;
      if (document.body?.dataset?.cloudReadonly === '1') _applyCloudReadonlyDomGuards();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  function _installCloudReadonlyObserver() {
    if (_cloudReadonlyObserver || typeof MutationObserver !== 'function' || !document.body) return;
    _cloudReadonlyObserver = new MutationObserver(_scheduleCloudReadonlyDomGuards);
    _cloudReadonlyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['contenteditable', 'disabled', 'readonly'],
    });
  }

  function _applyPhase1UiGuards(options) {
    const readonly = !!options?.readonly;
    document.body.dataset.cloudMode = 'dropbox';
    _hidePhase1UnsupportedUi();
    _installPhase1FeatureGuards();
    if (!readonly) return;
    _applyCloudReadonlyDomGuards();
    _installCloudReadonlyObserver();
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
    const localMode = _localDataModeForPage();
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.className = 'meldex-cloud-mode-body';
      body.innerHTML = `<div class="gb-section-desc meldex-cloud-mode-description">現在のデータは自動で移動・削除されません。別の保存先へ切り替えた後も、元の保存先へ戻せます。</div>
        <div class="meldex-cloud-choice-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:12px;">
          <button id="choose-dropbox" data-e2e-id="cloud-mode-dropbox" type="button" class="meldex-cloud-choice meldex-cloud-choice--dropbox" style="box-sizing:border-box;width:100%;min-width:0;text-align:left;padding:16px;border-radius:10px;border:1px solid #356b4d;background:#18261e;color:#d4d4d4;cursor:pointer;white-space:normal;overflow-wrap:break-word;">
            <div style="font-size:17px;font-weight:700;margin-bottom:6px;">Dropboxで始める</div>
            <div style="font-size:12px;line-height:1.6;color:#a8c0b0;">共有フォルダや別端末と同じソースフォルダを使います。次の画面でDropboxに接続します。</div>
          </button>
          <button id="choose-server" data-e2e-id="cloud-mode-server" type="button" class="meldex-cloud-choice meldex-cloud-choice--server" style="box-sizing:border-box;width:100%;min-width:0;text-align:left;padding:16px;border-radius:10px;border:1px solid #3d6f86;background:#17242b;color:#d4d4d4;cursor:pointer;white-space:normal;overflow-wrap:break-word;">
            <div style="font-size:17px;font-weight:700;margin-bottom:6px;">Meldex共有サーバーに接続</div>
            <div style="font-size:12px;line-height:1.6;color:#a8c8d7;">自分やチームで管理するPCまたはNAS上のMeldexへ接続します。Meldex公式のサーバー契約は不要です。</div>
          </button>
          <button id="choose-legacy" data-e2e-id="cloud-mode-local" type="button" class="meldex-cloud-choice meldex-cloud-choice--legacy" style="box-sizing:border-box;width:100%;min-width:0;text-align:left;padding:16px;border-radius:10px;border:1px solid #333;background:#252525;color:#d4d4d4;cursor:pointer;white-space:normal;overflow-wrap:break-word;">
            <div style="font-size:17px;font-weight:700;margin-bottom:6px;">この端末に保存</div>
            <div style="font-size:12px;line-height:1.6;color:#969696;">アカウントなしで、この端末内だけに保存します。</div>
          </button>
        </div>
        <div class="meldex-cloud-mode-note" style="margin-top:14px;padding:10px 12px;border:1px solid #333;border-radius:8px;background:#252525;font-size:12px;line-height:1.7;color:#bdbdbd;">
          <div><strong>共有したい場合:</strong> 同じDropboxを使う端末間ではDropbox、常時稼働PCやNASへ集約する場合は自分で管理するMeldex共有サーバーを選べます。どちらもMeldex公式のサーバーを必要としません。</div>
        </div>`;
      const cancelButton = document.createElement('button');
      cancelButton.id = 'choose-cancel';
      cancelButton.type = 'button';
      cancelButton.className = 'gb-btn gb-btn-quiet';
      cancelButton.dataset.e2eId = 'cloud-mode-cancel';
      cancelButton.textContent = 'キャンセル';
      let result = null;
      let settled = false;
      const dialogApi = window.GBUI.createModal({
        id: 'cloud-mode-chooser',
        title: '保存先を変更',
        body,
        footer: cancelButton,
        variant: 'standard',
        extraClass: 'meldex-cloud-mode-modal',
        geometryKey: 'cloud-storage-mode',
        initialFocus: '#choose-dropbox',
        onClose: () => {
          if (settled) return;
          settled = true;
          resolve(result);
        },
      });
      const overlay = dialogApi.overlay;
      overlay.classList.add('modal-overlay', 'meldex-cloud-mode-overlay');
      overlay.style.zIndex = '10020';
      dialogApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'cloud-mode-close');
      const choose = (mode) => {
        result = mode;
        _runtime().setMode(mode);
        dialogApi.close('select-' + mode);
      };
      body.querySelector('#choose-dropbox').addEventListener('click', () => choose('dropbox'));
      body.querySelector('#choose-server').addEventListener('click', () => choose('server'));
      body.querySelector('#choose-legacy').addEventListener('click', () => choose(localMode));
      cancelButton.addEventListener('click', () => dialogApi.close('cancel'));
      dialogApi.open();
    });
  }

  function _serverConnectionUrlFromInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.hash = '';
      url.search = '';
      if (/\/api\/?$/i.test(url.pathname)) url.pathname = url.pathname.replace(/\/api\/?$/i, '/');
      if (!url.pathname.endsWith('/')) url.pathname += '/';
      return url.toString();
    } catch {
      return '';
    }
  }

  function _serverApiUrl(baseUrl, path) {
    const base = _serverConnectionUrlFromInput(baseUrl);
    if (!base) return '';
    return new URL('api/' + String(path || '').replace(/^\/+/, ''), base).toString();
  }

  async function _testSharedServerConnection(baseUrl) {
    const normalized = _serverConnectionUrlFromInput(baseUrl);
    if (!normalized) throw new Error('接続先URLを確認してください');
    const response = await fetch(_serverApiUrl(normalized, '/server-info'), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 403 && /local API token/i.test(detail)) {
        throw new Error('接続先は見つかりましたが、共有サーバーとしての公開設定が有効ではありません。管理者に、ユーザー認証の準備と MELDEX_DISABLE_LOCAL_API_TOKEN=1 の明示設定を確認してください。');
      }
      throw new Error(`接続できませんでした（HTTP ${response.status}）`);
    }
    const info = await response.json();
    return { normalized, info };
  }

  async function _showSharedServerSetupModal(message) {
    _hideStartupSplashForBlockingCloudUi();
    const current = _runtime().getServerConnection?.();
    const initialUrl = current?.url || '';
    const localMode = _localDataModeForPage();
    const canSwitchLegacy = true;
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.className = 'meldex-shared-server-body';
      body.innerHTML = `<div class="gb-section-desc meldex-cloud-mode-description">自分やチームで管理するPCまたはNAS上のMeldexへ接続します。ノート、画像、ユーザー、ワークスペースはこの接続先から読み込みます。Meldex公式による常設サーバーは不要です。</div>
        ${message ? `<div style="margin-bottom:14px;padding:10px 12px;border-radius:8px;background:#352919;color:#f3d08a;font-size:12px;line-height:1.6;">${_esc(message)}</div>` : ''}
        <section class="meldex-cloud-setup-section" style="border:1px solid #333;border-radius:10px;padding:14px 16px;margin-bottom:14px;">
          <label style="display:block;font-size:12px;color:#969696;margin-bottom:4px;">接続先URL</label>
          <input id="shared-server-url" data-e2e-id="shared-server-url" class="gb-input" type="url" value="${_esc(initialUrl)}" placeholder="https://example.com/ または http://192.168.1.10:8001/" style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1px solid #444;background:#252525;color:#d4d4d4;">
          <div style="margin-top:8px;font-size:12px;color:#969696;line-height:1.6;">インターネット経由で使う場合はHTTPSまたはVPN経由のURLを指定してください。LAN内HTTPは閉じたネットワークでの利用に限ってください。</div>
        </section>
        <div id="shared-server-status" style="display:none;margin-bottom:12px;padding:10px 12px;border-radius:8px;background:#263644;color:#b7d7ee;font-size:12px;line-height:1.6;"></div>
        <div id="shared-server-error" style="display:none;margin-bottom:12px;padding:10px 12px;border-radius:8px;background:#44262c;color:#f7b4c0;font-size:12px;line-height:1.6;"></div>
      `;
      const localButton = document.createElement('button');
      localButton.id = 'shared-server-switch-legacy';
      localButton.type = 'button';
      localButton.className = 'gb-btn gb-btn-quiet';
      localButton.dataset.e2eId = 'shared-server-local';
      localButton.textContent = 'この端末に保存して使う';
      const testButton = document.createElement('button');
      testButton.id = 'shared-server-test';
      testButton.type = 'button';
      testButton.className = 'gb-btn gb-btn-quiet';
      testButton.dataset.e2eId = 'shared-server-test';
      testButton.textContent = '接続を確認';
      const continueButton = document.createElement('button');
      continueButton.id = 'shared-server-continue';
      continueButton.type = 'button';
      continueButton.className = 'gb-btn gb-btn-primary';
      continueButton.dataset.e2eId = 'shared-server-continue';
      continueButton.textContent = 'この接続先で開始';
      let resultValue = { ok: false, cancelled: true };
      let settled = false;
      let busy = false;
      let dialogApi = null;
      const setBusy = value => {
        busy = !!value;
        dialogApi?.overlay?.setAttribute('aria-busy', busy ? 'true' : 'false');
        body.querySelectorAll('input,button').forEach(control => { control.disabled = busy; });
        [localButton, testButton, continueButton].forEach(button => { button.disabled = busy; });
      };
      dialogApi = window.GBUI.createModal({
        id: 'shared-server-setup',
        title: 'Meldex共有サーバーに接続',
        body,
        footer: canSwitchLegacy ? [localButton, testButton, continueButton] : [testButton, continueButton],
        variant: 'standard',
        extraClass: 'meldex-cloud-setup-modal',
        geometryKey: 'cloud-shared-server',
        initialFocus: '#shared-server-url',
        onBeforeClose: () => !busy,
        onClose: () => {
          if (settled) return;
          settled = true;
          resolve(resultValue);
        },
      });
      dialogApi.modal.classList.add('meldex-shared-server-modal');
      const overlay = dialogApi.overlay;
      overlay.classList.add('modal-overlay', 'meldex-cloud-setup-overlay');
      overlay.style.zIndex = '10030';
      dialogApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'shared-server-close');

      function setStatus(text, isError) {
        const statusEl = overlay.querySelector('#shared-server-status');
        const errorEl = overlay.querySelector('#shared-server-error');
        if (isError) {
          statusEl.style.display = 'none';
          statusEl.textContent = '';
          errorEl.style.display = '';
          errorEl.textContent = text || '';
          return;
        }
        errorEl.style.display = 'none';
        errorEl.textContent = '';
        statusEl.style.display = text ? '' : 'none';
        statusEl.textContent = text || '';
      }

      async function confirmConnection() {
        const input = overlay.querySelector('#shared-server-url');
        const result = await _testSharedServerConnection(input?.value || '');
        input.value = result.normalized;
        const info = result.info || {};
        const port = info.port ? `:${info.port}` : '';
        setStatus(`接続できました。サーバー: ${info.host || 'Meldex'}${port}`, false);
        return result;
      }

      testButton.addEventListener('click', async () => {
        setBusy(true);
        try {
          await confirmConnection();
        } catch (err) {
          setStatus(err?.message || String(err), true);
        } finally {
          setBusy(false);
        }
      });
      localButton.addEventListener('click', () => {
        resultValue = { ok: false, switchToLegacy: true };
        _runtime().setMode(localMode);
        dialogApi.close('switch-local');
      });
      continueButton.addEventListener('click', async () => {
        setBusy(true);
        try {
          const result = await confirmConnection();
          _runtime().setServerConnection?.({ url: result.normalized });
          _runtime().setMode('server');
          resultValue = { ok: true, mode: 'server', server: result };
          setBusy(false);
          dialogApi.close('complete');
        } catch (err) {
          setStatus(err?.message || String(err), true);
          setBusy(false);
        }
      });
      dialogApi.open();
    });
  }

  function _shouldUseSameTabDropboxAuth() {
    try {
      const userAgent = String(navigator.userAgent || '');
      if (/iPhone|iPad|iPod|Android|Mobile/i.test(userAgent)) return true;
      const isCoarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
      const isNarrow = window.matchMedia?.('(max-width: 820px)')?.matches;
      return !!(isCoarsePointer && isNarrow);
    } catch {
      return false;
    }
  }

  function _openAuthWindow(url, options) {
    if (!options?.manual && _shouldUseSameTabDropboxAuth()) {
      window.location.href = url;
      return;
    }
    const popup = window.open(url, '_blank', 'width=540,height=760,noopener,noreferrer');
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
    const localMode = _localDataModeForPage();
    const isLegacyMode = _runtime().getMode?.() === localMode;
    const canSwitchLegacy = true;
    const sessionLabel = session?.refreshToken
      ? `Dropbox接続済み${session?.account?.name?.display_name ? ` / ${_esc(session.account.name.display_name)}` : ''}`
      : '未接続';
    const sessionHelp = session?.refreshToken
      ? '接続できています。使うDropbox内フォルダを確認し、「この設定で開始」を押してください。'
      : 'まず「Dropboxに接続する」を押してください。接続後に共有フォルダや既存のソースフォルダを選べます。';
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.className = 'meldex-dropbox-setup-body';
      body.innerHTML = `<div class="meldex-cloud-setup-section" style="border:1px solid #333;border-radius:10px;padding:14px 16px;margin-bottom:14px;background:#202020;">
          <div style="font-size:15px;font-weight:700;margin-bottom:8px;">同じデータを複数端末で使います</div>
          <div style="font-size:13px;color:#bdbdbd;line-height:1.7;">
            Dropboxに接続し、Meldexで使うフォルダを選ぶと、スマホ、タブレット、PCから同じソースフォルダを開けます。
          </div>
          <div style="font-size:12px;color:#969696;line-height:1.7;margin-top:8px;">この端末だけで使う場合は、下の「この端末に保存して使う」に切り替えられます。</div>
        </div>
        ${message ? `<div style="margin-bottom:14px;padding:10px 12px;border-radius:8px;background:#352919;color:#f3d08a;font-size:12px;line-height:1.6;">${_esc(message)}</div>` : ''}
        <div class="meldex-cloud-step-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:14px;font-size:12px;color:#bdbdbd;">
          <div style="border:1px solid #356b4d;border-radius:8px;padding:8px 10px;background:#18261e;">1. Dropboxに接続</div>
          <div style="border:1px solid #333;border-radius:8px;padding:8px 10px;background:#252525;">2. フォルダを選ぶ</div>
          <div style="border:1px solid #333;border-radius:8px;padding:8px 10px;background:#252525;">3. 開始する</div>
        </div>
        <section class="meldex-cloud-setup-section" style="border:1px solid #333;border-radius:10px;padding:14px 16px;margin-bottom:14px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:10px;">1. Dropboxに接続する</div>
          <div id="cloud-session-status" style="font-size:13px;line-height:1.7;color:${session?.refreshToken ? '#9dd6a5' : '#d4d4d4'};">
            ${sessionLabel}
          </div>
          <div id="cloud-session-help" style="font-size:12px;color:#969696;line-height:1.6;margin-top:6px;">${sessionHelp}</div>
          <div class="meldex-cloud-action-row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <button id="cloud-auth-redirect" type="button" class="gb-btn gb-btn-primary" style="padding:8px 14px;border:none;border-radius:6px;background:#356b4d;color:#fff;cursor:pointer;">Dropboxに接続する</button>
            <button id="cloud-auth-switch-account" type="button" class="gb-btn gb-btn-primary" style="padding:8px 14px;border:none;border-radius:6px;background:#5a4770;color:#fff;cursor:pointer;">別のアカウントで接続</button>
            <button id="cloud-auth-manual" type="button" class="gb-btn gb-btn-primary" style="padding:8px 14px;border:none;border-radius:6px;background:#28435a;color:#fff;cursor:pointer;">コードで接続</button>
            <button id="cloud-clear-session" type="button" class="gb-btn gb-btn-quiet" style="padding:8px 14px;border:1px solid #555;border-radius:6px;background:#252525;color:#d4d4d4;cursor:pointer;">接続を解除</button>
          </div>
          <div style="font-size:12px;color:#969696;line-height:1.6;margin-top:8px;">DropboxのパスワードはMeldexには渡りません。</div>
          <div id="cloud-manual-box" style="display:${showManualBox ? '' : 'none'};margin-top:12px;">
            <div style="font-size:12px;color:#969696;line-height:1.6;margin-bottom:6px;">Dropboxで表示されたコードを貼り付けてください。</div>
            <div class="meldex-cloud-input-row" style="display:flex;gap:8px;flex-wrap:wrap;">
              <input id="cloud-manual-code" class="gb-input" type="text" placeholder="Dropboxのコード" style="flex:1;min-width:220px;padding:8px 10px;border-radius:6px;border:1px solid #444;background:#252525;color:#d4d4d4;">
              <button id="cloud-manual-submit" type="button" class="gb-btn gb-btn-primary" style="padding:8px 14px;border:none;border-radius:6px;background:#356b4d;color:#fff;cursor:pointer;">接続する</button>
            </div>
          </div>
        </section>
        <section class="meldex-cloud-setup-section" style="border:1px solid #333;border-radius:10px;padding:14px 16px;margin-bottom:14px;">
          <div style="font-size:15px;font-weight:700;margin-bottom:10px;">2. 使うフォルダを選ぶ</div>
          <label style="display:block;font-size:12px;color:#969696;margin-bottom:4px;">Dropbox内の最初に使うフォルダ</label>
          <div class="meldex-cloud-input-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input id="cloud-vault-path" class="gb-input" type="text" value="${_esc(initial.vaultPath)}" placeholder="/MeldexVault" style="flex:1;min-width:min(280px,100%);padding:8px 10px;border-radius:6px;border:1px solid #444;background:#252525;color:#d4d4d4;">
            <button id="cloud-vault-pick" type="button" class="gb-btn gb-btn-quiet" style="padding:8px 14px;border:1px solid #555;border-radius:6px;background:#252525;color:#d4d4d4;cursor:pointer;">Dropboxから選ぶ</button>
          </div>
          <div style="margin-top:8px;font-size:12px;color:#969696;line-height:1.6;">デスクトップ版と同じDropbox内フォルダを使う場合は「Dropboxから選ぶ」で <code>/Share</code> などの共有フォルダまで開いて選択してください。</div>
        </section>
        <details id="cloud-advanced-dropbox-settings" class="meldex-cloud-setup-section"${initial.appMode === 'custom' || !initial.defaultAppKey ? ' open' : ''} style="border:1px solid #333;border-radius:10px;padding:12px 16px;margin-bottom:14px;">
          <summary style="font-size:15px;font-weight:700;cursor:pointer;">詳細設定（通常は変更不要）</summary>
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
            <input id="cloud-custom-app-key" class="gb-input" type="text" value="${_esc(initial.customAppKey)}" placeholder="Dropbox App key" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #444;background:#252525;color:#d4d4d4;">
            <label style="display:block;font-size:12px;color:#969696;margin:12px 0 4px;">redirect URI 上書き（任意）</label>
            <input id="cloud-redirect-override" class="gb-input" type="text" data-gb-path-input value="${_esc(initial.redirectOverride)}" placeholder="${_esc(_auth().buildRedirectUri())}" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid #444;background:#252525;color:#d4d4d4;">
            <div style="margin-top:8px;font-size:12px;color:#969696;line-height:1.6;">自分でDropbox OAuthアプリを作った場合だけ設定します。上書きできるのは現在のCloud URL、予備HTTPS URL、<code>http://localhost:8080/</code>、<code>http://localhost:8001/</code>、<code>http://localhost:8001/?desktop=1</code> だけです。Dropbox App Consoleにも同じURLをredirect URIとして登録してください。</div>
            <div style="margin-top:8px;font-size:12px;color:#969696;line-height:1.6;">必要権限: <code>account_info.read files.metadata.read files.metadata.write files.content.read files.content.write sharing.read</code></div>
          </div>
        </details>
        <div id="cloud-setup-error" style="display:none;margin-bottom:12px;padding:10px 12px;border-radius:8px;background:#44262c;color:#f7b4c0;font-size:12px;line-height:1.6;"></div>
      `;
      const localButton = document.createElement('button');
      localButton.id = 'cloud-switch-legacy';
      localButton.type = 'button';
      localButton.className = 'gb-btn gb-btn-quiet';
      localButton.dataset.e2eId = 'dropbox-setup-local';
      localButton.textContent = isLegacyMode ? 'キャンセル' : 'この端末に保存して使う';
      const continueButton = document.createElement('button');
      continueButton.id = 'cloud-continue';
      continueButton.type = 'button';
      continueButton.className = 'gb-btn gb-btn-primary';
      continueButton.dataset.e2eId = 'dropbox-setup-continue';
      continueButton.textContent = 'この設定で開始';
      let resultValue = { ok: false, cancelled: true };
      let settled = false;
      let busy = false;
      let dialogApi = null;
      const setBusy = value => {
        busy = !!value;
        dialogApi?.overlay?.setAttribute('aria-busy', busy ? 'true' : 'false');
        body.querySelectorAll('input,button,summary').forEach(control => {
          if ('disabled' in control) control.disabled = busy;
          control.setAttribute('aria-disabled', busy ? 'true' : 'false');
        });
        [localButton, continueButton].forEach(button => { button.disabled = busy; });
      };
      dialogApi = window.GBUI.createModal({
        id: 'dropbox-setup',
        title: 'Dropboxに接続',
        body,
        footer: canSwitchLegacy ? [localButton, continueButton] : continueButton,
        variant: 'standard',
        extraClass: 'meldex-cloud-setup-modal',
        geometryKey: 'cloud-dropbox-setup',
        initialFocus: '#cloud-auth-redirect',
        onBeforeClose: () => !busy,
        onClose: () => {
          if (settled) return;
          settled = true;
          resolve(resultValue);
        },
      });
      dialogApi.modal.classList.add('meldex-dropbox-setup-modal');
      const overlay = dialogApi.overlay;
      overlay.classList.add('modal-overlay', 'meldex-cloud-setup-overlay');
      overlay.style.zIndex = '10030';
      dialogApi.header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'dropbox-setup-close');
      window.MeldexCloudBootstrapInherit?.renderInheritSection?.(overlay);

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

      async function runBusy(task) {
        setBusy(true);
        try {
          return await task();
        } catch (err) {
          setError(err?.message || String(err));
          return undefined;
        } finally {
          setBusy(false);
        }
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
        overlay.querySelector('#cloud-vault-path').value = _auth().getVaultPath();
        if (mode === 'custom') {
          _auth().setRedirectOverride(overlay.querySelector('#cloud-redirect-override').value.trim());
        }
      }

      function updateSessionStatus(text, authenticated, helpText) {
        const status = overlay.querySelector('#cloud-session-status');
        const help = overlay.querySelector('#cloud-session-help');
        status.textContent = text;
        status.style.color = authenticated ? '#9dd6a5' : '#d4d4d4';
        if (help) {
          help.textContent = helpText || (authenticated
            ? '接続できています。使うDropbox内フォルダを確認し、「この設定で開始」を押してください。'
            : 'まず「Dropboxに接続する」を押してください。接続後に共有フォルダや既存のソースフォルダを選べます。');
        }
      }

      overlay.querySelectorAll('input[name="cloud-app-mode"]').forEach((input) => {
        input.addEventListener('change', updateAdvancedSettings);
      });
      updateAdvancedSettings();

      overlay.querySelector('#cloud-vault-pick')?.addEventListener('click', async () => {
        await runBusy(async () => {
          saveInputs();
          const currentSession = await _auth().getSession();
          if (!currentSession?.refreshToken) {
            setError('先にDropboxに接続してください。接続後にDropbox内フォルダを選べます。');
            return;
          }
          if (!window.MeldexDropboxFolderPicker?.pickFolder) {
            setError('Dropbox内フォルダの選択画面を初期化できませんでした。');
            return;
          }
          const input = overlay.querySelector('#cloud-vault-path');
          const selected = await window.MeldexDropboxFolderPicker.pickFolder({
            title: '初期ソースフォルダを選択',
            initialPath: input?.value || '/',
          });
          if (!selected?.path) return;
          input.value = selected.path;
          _auth().setVaultPath(selected.path);
          _auth().setVaultNamespaceKind?.(selected.namespaceKind);
          setError('');
        });
      });

      async function exchangeManualCodeIfPresent() {
        const manualBox = overlay.querySelector('#cloud-manual-box');
        const codeInput = overlay.querySelector('#cloud-manual-code');
        const code = codeInput?.value?.trim?.() || '';
        if (!code) return false;
        manualBox.style.display = '';
        await _auth().exchangeManualCode(code);
        codeInput.value = '';
        updateSessionStatus('Dropbox接続済み', true);
        setError('');
        return true;
      }

      async function beginDropboxConnection(options = {}) {
        saveInputs();
        const auth = await _auth().beginAuth({
          manual: !!options.manual,
          forceReapprove: !!options.switchAccount,
          forceReauthentication: !!options.switchAccount,
        });
        if (options.manual) overlay.querySelector('#cloud-manual-box').style.display = '';
        _openAuthWindow(auth.authorizationUrl, { manual: !!options.manual });
      }

      overlay.querySelector('#cloud-auth-redirect').addEventListener('click', async () => {
        await runBusy(async () => {
          await beginDropboxConnection({ manual: false });
        });
      });

      overlay.querySelector('#cloud-auth-switch-account').addEventListener('click', async () => {
        await runBusy(async () => {
          await beginDropboxConnection({ manual: false, switchAccount: true });
        });
      });

      overlay.querySelector('#cloud-auth-manual').addEventListener('click', async () => {
        await runBusy(async () => {
          await beginDropboxConnection({ manual: true });
        });
      });

      overlay.querySelector('#cloud-manual-submit').addEventListener('click', async () => {
        await runBusy(async () => {
          saveInputs();
          if (!await exchangeManualCodeIfPresent()) throw new Error('Dropboxのコードを入力してください');
        });
      });

      overlay.querySelector('#cloud-clear-session').addEventListener('click', async () => {
        await runBusy(async () => {
          await _auth().clearSession();
          setError('');
          updateSessionStatus(
            '未接続',
            false,
            'この端末の接続情報を削除しました。もう一度使う場合は「Dropboxに接続する」を押してください。'
          );
        });
      });

      localButton.addEventListener('click', () => {
        if (isLegacyMode) {
          dialogApi.close('cancel');
          return;
        }
        resultValue = { ok: false, switchToLegacy: true };
        _runtime().setMode(localMode);
        dialogApi.close('switch-local');
      });

      continueButton.addEventListener('click', async () => {
        await runBusy(async () => {
          saveInputs();
          await exchangeManualCodeIfPresent();
          if (!_auth().getAppKey()) throw new Error('Dropbox App key を設定してください');
          if (!_auth().getVaultPath()) throw new Error('保存先フォルダを入力してください。通常は /MeldexVault のままで使えます。');
          _runtime().setMode('dropbox');
          resultValue = { ok: true };
        });
        if (resultValue.ok) dialogApi.close('complete');
      });
      dialogApi.open();
    });
  }

  async function _enterLegacyMode() {
    document.body.dataset.cloudMode = 'legacy';
    delete document.body.dataset.cloudReadonly;
    await window.MeldexStorageAdapter?.describeWorkspace?.().catch(() => null);
    if (_isLocalConflictMonitorHost()) _startCloudHealthMonitor();
    return true;
  }

  async function _enterBrowserMode() {
    document.body.dataset.cloudMode = 'browser';
    delete document.body.dataset.cloudReadonly;
    delete document.body.dataset.cloudReadonlyReason;
    const preflight = await window.MeldexStorageAdapter?.preflight?.();
    if (!preflight?.ok) throw new Error(preflight?.message || 'この端末内の保存先を準備できませんでした');
    await window.MeldexOfflineShell?.prepareFirstRunChoice?.();
    return true;
  }

  function _enterLocalModeForPage() {
    return _localDataModeForPage() === 'browser' ? _enterBrowserMode() : _enterLegacyMode();
  }

  async function _enterServerMode(message) {
    document.body.dataset.cloudMode = 'server';
    delete document.body.dataset.cloudReadonly;
    while (true) {
      const connection = _runtime().getServerConnection?.();
      if (!connection?.url) {
        const result = await _showSharedServerSetupModal(message || 'Meldex共有サーバーの接続先を設定してください。');
        if (result?.switchToLegacy) return _enterLocalModeForPage();
        if (!result?.ok) return false;
        continue;
      }
      try {
        await _testSharedServerConnection(connection.url);
        await window.MeldexStorageAdapter?.describeWorkspace?.().catch(() => null);
        _showBanner(`Meldex共有サーバー 接続済み: ${connection.url}`, false);
        setTimeout(() => {
          const bar = document.getElementById('cloud-mode-banner');
          if (bar && bar.dataset.cloudPersistent !== '1') bar.remove();
        }, 3000);
        return true;
      } catch (err) {
        const result = await _showSharedServerSetupModal(err?.message || String(err));
        if (result?.switchToLegacy) return _enterLocalModeForPage();
        if (!result?.ok) return false;
      }
    }
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

  function _isHostedCloudPage() {
    try {
      return window.location.protocol === 'https:' && !_isLocalAppHost();
    } catch {
      return false;
    }
  }

  function _isHostedCloudLaunch() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('dataAccessMode') || params.get('safeMode') === '1' || params.get('desktop') === '1') return false;
    } catch {}
    return _isHostedCloudPage();
  }

  async function prepareLaunch() {
    const callback = await _auth().handleRedirectCallback();
    if (callback.handled && !callback.ok) {
      await _showDropboxSetupModal(callback.error || 'Dropboxへの接続に失敗しました');
    } else if (callback.handled && callback.ok) {
      _runtime().setMode('dropbox');
    }
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.has('smoke') && !params.has('dataAccessMode')) {
        _runtime().setMode('legacy');
        return _enterLegacyMode();
      }
    } catch {}
    const cloudHomeReady = await window.MeldexBetaRelease?.prepareCloudHomeLaunch?.();
    if (cloudHomeReady === false) return false;
    let mode = _runtime().getMode();
    let hasExplicitMode = false;
    try {
      const params = new URLSearchParams(window.location.search);
      hasExplicitMode = params.has('dataAccessMode') || params.get('safeMode') === '1';
    } catch {}
    const hasStoredMode = _runtime().hasStoredMode?.();
    if (_isHostedCloudLaunch() && !hasExplicitMode) {
      if (mode === 'legacy') {
        _runtime().setMode('browser');
        mode = 'browser';
      }
    } else if (!hasStoredMode && !hasExplicitMode && _isDesktopLaunch()) {
      _runtime().setMode('legacy');
      mode = 'legacy';
    } else if (!hasStoredMode && !hasExplicitMode) {
      mode = await _showModeChooser();
    }
    if (mode === 'server') {
      return _enterServerMode();
    }
    if (mode === 'browser') {
      return _enterBrowserMode();
    }
    if (mode !== 'dropbox') {
      return _enterLegacyMode();
    }

    while (true) {
      const session = await _auth().getSession();
      if (!_auth().getAppKey() || !_auth().getVaultPath() || !session?.refreshToken) {
        const result = await _showDropboxSetupModal(callback.handled && callback.ok ? 'Dropboxへの接続が完了しました。使うフォルダを確認して「この設定で開始」を押してください。' : '');
        if (result?.switchToLegacy) return _enterLocalModeForPage();
        if (!result?.ok) return false;
        continue;
      }

      try {
        const provider = window.MeldexStorageAdapter?.getProvider?.();
        let startupLock = await _sharedCompatibilityLock(provider);
        if (startupLock?.locked && !startupLock?.classificationUnavailable && await _isCurrentWorkspaceOwner(provider)) {
          startupLock = await _runSidecarMigrationOnce(provider, { allowOwnerUnlock: true })
            || await _sharedCompatibilityLock(provider);
        }
        if (startupLock?.locked || startupLock?.unavailable) {
          _applyCompatibilityReadonly(startupLock);
          _startCloudHealthMonitor();
          return true;
        }
        const preflight = await window.MeldexStorageAdapter.preflight();
        if (!preflight.ok) {
          const result = await _showDropboxSetupModal(preflight.message);
          if (result?.switchToLegacy) return _enterLocalModeForPage();
          if (!result?.ok) return false;
          continue;
        }
        const migrationLock = preflight.access === 'viewer'
          ? null
          : await _runSidecarMigrationOnce(provider);
        const compatibilityReadonly = !!(migrationLock?.locked || migrationLock?.unavailable);
        _applyPhase1UiGuards({ readonly: preflight.access === 'viewer' || compatibilityReadonly });
        if (compatibilityReadonly) {
          _applyCompatibilityReadonly(migrationLock);
        } else if (preflight.access === 'viewer') {
          document.body.dataset.cloudReadonly = '1';
          document.body.dataset.cloudReadonlyReason = 'viewer';
          _showBanner('閲覧専用モードです。編集機能は無効化されます。', false);
        } else {
          delete document.body.dataset.cloudReadonly;
          delete document.body.dataset.cloudReadonlyReason;
          _showBanner(`Dropbox 接続済み: ${preflight.state?.name || 'vault'}`, false);
          setTimeout(() => {
            const bar = document.getElementById('cloud-mode-banner');
            if (bar && bar.dataset.cloudPersistent !== '1') bar.remove();
          }, 3000);
          _runSystemStorageRetentionCleanupOnce();
        }
        _startCloudHealthMonitor();
        return true;
      } catch (err) {
        const result = await _showDropboxSetupModal(err?.message || String(err));
        if (result?.switchToLegacy) return _enterLocalModeForPage();
        if (!result?.ok) return false;
      }
    }
  }

  async function openSettingsFlow(message) {
    const beforeMode = _runtime().getMode();
    let result = null;
    if (beforeMode === 'dropbox') {
      result = await _showDropboxSetupModal(message || '');
    } else if (beforeMode === 'server') {
      result = await _showSharedServerSetupModal(message || '');
    } else {
      const choice = await _showModeChooser();
      if (!choice || choice === beforeMode) result = { cancelled: true };
      else if (choice === 'dropbox') result = await _showDropboxSetupModal(message || '');
      else if (choice === 'server') result = await _showSharedServerSetupModal(message || '');
      else result = { switchToLegacy: true };
    }
    const afterMode = _runtime().getMode();
    if (result?.ok || result?.switchToLegacy || beforeMode !== afterMode) {
      window.location.reload();
    }
    return result;
  }

  window.MeldexCloudBootstrap = {
    prepareLaunch,
    openSettingsFlow,
    async connectDropbox(message) {
      const result = await _showDropboxSetupModal(message || '');
      if (result?.ok) window.location.reload();
      return result;
    },
    isPhase1UnsupportedType,
    isPhase1UnsupportedCreateType,
    filterPhase1CreateItems,
    showPhase1Unsupported,
    openSetupModal(message) {
      return _showDropboxSetupModal(message || '');
    },
    openSharedServerSetupModal(message) {
      return _showSharedServerSetupModal(message || '');
    },
  };
})();
