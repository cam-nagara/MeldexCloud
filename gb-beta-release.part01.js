(function () {
  'use strict';

  if (window.MeldexBetaRelease) return;

  const config = window.MeldexReleaseConfig || {};
  const BETA_LABEL = config.betaLabel || 'BETA';
  const FALLBACK_SEMVER = config.fallbackSemver || '0.5.x';
  const CONSENT_KEY = 'meldex-beta-consent-v1';
  const CRASH_CONSENT_KEY = 'meldex-crash-report-consent';
  const TELEMETRY_KEY = 'meldex-telemetry-enabled';
  const UPDATE_CHECK_KEY = 'meldex-update-checks-enabled';
  const CONSENT_RESET_KEY = 'meldex-beta-consent-reset-at';
  const CLOUD_HOME_CHOICE_KEY = 'meldex-cloud-home-choice-v1';
  const CLOUD_HOME_CHOICE_BROWSER = 'browser';
  const CLOUD_HOME_CHOICE_INSTALLED = 'installed';

  let _versionPromise = null;
  let _serverConsentLoaded = false;
  let _serverConsent = null;
  let _installPromptEvent = null;
  let _installListenersBound = false;
  let _installSectionObserverBound = false;
  let _cloudHomeLaunchFlowActive = false;
  let _installDialogApi = null;
  let _cloudHomeDialogApi = null;
  let _installHelpDialogApi = null;
  let _consentDialogApi = null;

  function _safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function _safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function _safeStorageRemove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function _el(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') {
        for (const [dataKey, dataValue] of Object.entries(value || {})) {
          if (dataValue != null) node.dataset[dataKey] = dataValue;
        }
      } else {
        node.setAttribute(key, value);
      }
    }
    for (const child of children || []) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function _isBypassMode() {
    try {
      const params = new URLSearchParams(location.search);
      return params.has('smoke') || params.has('e2e') || params.get('single') === '1';
    } catch (_) {
      return false;
    }
  }

  function _queryParams() {
    try { return new URLSearchParams(location.search); } catch (_) { return new URLSearchParams(); }
  }

  function _isLocalAppHost() {
    try {
      const host = String(location.hostname || '').toLowerCase();
      if (!host) return location.protocol === 'file:';
      return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch (_) {
      return false;
    }
  }

  function _isHostedCloudPage() {
    try { return location.protocol === 'https:' && !_isLocalAppHost(); } catch (_) { return false; }
  }

  function _isCloudHomeBypassMode() {
    const params = _queryParams();
    return (
      _isBypassMode()
      || params.has('dataAccessMode')
      || params.get('safeMode') === '1'
      || params.get('desktop') === '1'
      || params.get('pwa') === '0'
      || params.has('nopwa')
    );
  }

  function _isCloudHomeLaunchTarget() {
    return _isHostedCloudPage() && !_isCloudHomeBypassMode();
  }

  function _getCloudHomeChoice() {
    const value = _safeStorageGet(CLOUD_HOME_CHOICE_KEY);
    return value === CLOUD_HOME_CHOICE_BROWSER || value === CLOUD_HOME_CHOICE_INSTALLED ? value : '';
  }

  function _setCloudHomeChoice(value) {
    if (value === CLOUD_HOME_CHOICE_BROWSER || value === CLOUD_HOME_CHOICE_INSTALLED) {
      _safeStorageSet(CLOUD_HOME_CHOICE_KEY, value);
    } else {
      _safeStorageRemove(CLOUD_HOME_CHOICE_KEY);
    }
  }

  function _applyCloudHomeQueryOverride() {
    const params = _queryParams();
    const choice = String(params.get('cloudHome') || params.get('homeLaunch') || '').toLowerCase();
    if (choice === CLOUD_HOME_CHOICE_BROWSER) {
      _setCloudHomeChoice(CLOUD_HOME_CHOICE_BROWSER);
      return true;
    }
    if (choice === CLOUD_HOME_CHOICE_INSTALLED) {
      _setCloudHomeChoice(CLOUD_HOME_CHOICE_INSTALLED);
      return true;
    }
    if (choice === 'reset') {
      _setCloudHomeChoice('');
      return true;
    }
    return false;
  }

  function _extractSemver(info) {
    const semver = String(info?.semver || '').trim();
    if (semver) return semver;
    const version = String(info?.version || '').replace(/^v/i, '');
    return version.split('+')[0] || FALLBACK_SEMVER;
  }

  function _releaseTitle(info) {
    return `Meldex v${_extractSemver(info)} ${BETA_LABEL}`;
  }

  async function getVersionInfo() {
    if (_versionPromise) return _versionPromise;
    _versionPromise = (async () => {
      try {
        if (typeof apiFetch === 'function') return await apiFetch('/version');
      } catch (_) {}
      try {
        const res = await fetch('version.json', { cache: 'no-store' });
        if (res.ok) return await res.json();
      } catch (_) {}
      return { semver: FALLBACK_SEMVER, version: `v${FALLBACK_SEMVER}+dev`, commit: '', build: '', variant: 'dev' };
    })();
    return _versionPromise;
  }

  function _setMetaName(name, content) {
    const el = document.querySelector(`meta[name="${name}"]`);
    if (el) el.setAttribute('content', content);
  }

  async function refreshReleaseTitle() {
    const info = await getVersionInfo();
    const title = _releaseTitle(info);
    document.title = title;
    _setMetaName('application-name', title);
    _setMetaName('apple-mobile-web-app-title', title);
    return title;
  }

  function getConsent() {
    const raw = _safeStorageGet(CONSENT_KEY);
    let local = null;
    if (raw) {
      try { local = JSON.parse(raw); } catch (_) { local = null; }
    }
    return _serverConsent?.acceptedAt ? _serverConsent : local;
  }

  function hasConsent() {
    return !!getConsent()?.acceptedAt;
  }

  function _nowIso() {
    return new Date().toISOString();
  }

  function _consentStamp(consent) {
    const value = Date.parse(consent?.updatedAt || consent?.acceptedAt || '');
    return Number.isFinite(value) ? value : 0;
  }

  function _readConsentFlag(storageKey, consentField) {
    const stored = _safeStorageGet(storageKey);
    if (stored === '1') return true;
    if (stored === '0') return false;
    return getConsent()?.[consentField] === true;
  }

  function saveConsent(options) {
    const now = _nowIso();
    const payload = {
      schema: 2,
      acceptedAt: options?.acceptedAt || now,
      updatedAt: options?.updatedAt || now,
      betaNoticeAccepted: true,
      crashReports: !!options?.crashReports,
      telemetry: !!options?.telemetry,
      updateChecks: !!options?.updateChecks,
    };
    _safeStorageSet(CONSENT_KEY, JSON.stringify(payload));
    _safeStorageSet(CRASH_CONSENT_KEY, payload.crashReports ? '1' : '0');
    _safeStorageSet(TELEMETRY_KEY, payload.telemetry ? '1' : '0');
    _safeStorageSet(UPDATE_CHECK_KEY, payload.updateChecks ? '1' : '0');
    _safeStorageRemove(CONSENT_RESET_KEY);
    _serverConsent = payload;
    _serverConsentLoaded = true;
    _saveServerConsent(payload).catch(() => {});
    return payload;
  }

  function resetConsent() {
    _safeStorageSet(CONSENT_RESET_KEY, _nowIso());
    _safeStorageRemove(CONSENT_KEY);
    _safeStorageRemove(CRASH_CONSENT_KEY);
    _safeStorageRemove(TELEMETRY_KEY);
    _safeStorageRemove(UPDATE_CHECK_KEY);
    _serverConsent = null;
    _serverConsentLoaded = true;
    _deleteServerConsent().catch(() => {});
  }

  async function _fetchJson(path, opts) {
    const nextOpts = opts ? { ...opts } : {};
    nextOpts.headers = _authHeaders(nextOpts.headers);
    const res = await fetch(path, nextOpts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  function _authHeaders(headers) {
    const next = new Headers(headers || undefined);
    try {
      const token = _safeStorageGet('meldex-auth-token') || _safeStorageGet('crossfolio-auth-token') || '';
      if (token && !next.has('Authorization')) next.set('Authorization', 'Bearer ' + token);
    } catch (_) {}
    return next;
  }

  async function _saveServerConsent(consent) {
    try {
      return await _fetchJson('/api/beta/consent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent }),
      });
    } catch (_) {
      return null;
    }
  }

  async function _deleteServerConsent() {
    try {
      return await _fetchJson('/api/beta/consent', { method: 'DELETE' });
    } catch (_) {
      return null;
    }
  }

  async function syncConsentState() {
    if (_serverConsentLoaded) return _serverConsent;
    _serverConsentLoaded = true;
    let server = null;
    try {
      const res = await _fetchJson('/api/beta/consent');
      if (res?.consent?.acceptedAt) server = res.consent;
    } catch (_) {}
    const local = (() => {
      try { return JSON.parse(_safeStorageGet(CONSENT_KEY) || 'null'); } catch (_) { return null; }
    })();
    const resetAt = Date.parse(_safeStorageGet(CONSENT_RESET_KEY) || '');
    if (Number.isFinite(resetAt) && (!server || resetAt >= _consentStamp(server))) {
      _serverConsent = null;
      await _deleteServerConsent();
      return null;
    }
    if (server && local?.acceptedAt && _consentStamp(local) >= _consentStamp(server)) {
      _serverConsent = local;
      await _saveServerConsent(local);
      return local;
    }
    if (server) {
      _serverConsent = server;
      _safeStorageSet(CONSENT_KEY, JSON.stringify(server));
      _safeStorageSet(CRASH_CONSENT_KEY, server.crashReports ? '1' : '0');
      _safeStorageSet(TELEMETRY_KEY, server.telemetry ? '1' : '0');
      _safeStorageSet(UPDATE_CHECK_KEY, server.updateChecks ? '1' : '0');
      _safeStorageRemove(CONSENT_RESET_KEY);
      return server;
    }
    if (local?.acceptedAt) {
      _serverConsent = local;
      await _saveServerConsent(local);
      return local;
    }
    return null;
  }

  function _createConsentCheckbox(id, text, checked, options = {}) {
    const input = _el('input', { id, type: 'checkbox', class: 'meldex-beta-consent-checkbox' });
    input.checked = !!checked;
    const labelContent = [input, _el('span', { text })];
    if (options.required === true) {
      labelContent.push(_el('span', {
        class: 'meldex-beta-consent-required-badge',
        text: '必須',
      }));
    }
    return _el('label', { class: 'meldex-beta-consent-check' }, labelContent);
  }

  function _isStandaloneDisplayMode() {
    try {
      const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
      if (modes.some(mode => window.matchMedia?.(`(display-mode: ${mode})`)?.matches)) return true;
    } catch (_) {}
    try {
      if (navigator.standalone === true) return true;
    } catch (_) {}
    return false;
  }

  function _isIosLike() {
    const ua = String(navigator.userAgent || '').toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1;
  }

  function _isAndroidLike() {
    return /android/i.test(String(navigator.userAgent || ''));
  }

  function _installSteps() {
    if (_isStandaloneDisplayMode()) return ['Meldexはすでにホーム画面またはアプリ一覧から起動できます。'];
    if (_isIosLike()) {
      return [
        'SafariでMeldex本体のページを開きます。',
        '共有ボタンを押し、「ホーム画面に追加」を選びます。',
        '表示名を確認し、「追加」を押します。',
      ];
    }
    if (_isAndroidLike()) {
      return [
        'ChromeまたはEdgeでMeldex本体のページを開きます。',
        'ブラウザメニューから「アプリをインストール」または「ホーム画面に追加」を選びます。',
        '確認画面で追加を実行します。',
      ];
    }
    return [
      'ChromeまたはEdgeでMeldex本体のページを開きます。',
      'アドレスバー右側のインストールアイコン、またはブラウザメニューの「アプリをインストール」を選びます。',
      '確認画面でインストールを実行します。',
    ];
  }

  function _quickMemoInstallSteps() {
    if (_isIosLike()) {
      return [
        'クイックメモ画面をSafariで開きます。',
        '共有ボタンを押し、「ホーム画面に追加」を選びます。',
        '表示名が「Meldex Memo」になっていることを確認し、「追加」を押します。',
      ];
    }
    if (_isAndroidLike()) {
      return [
        'クイックメモ画面をChromeまたはEdgeで開きます。',
        'ブラウザメニューから「アプリをインストール」または「ホーム画面に追加」を選びます。',
        '追加後は共有先の「Meldex Memo」からURLや本文を送れます。',
      ];
    }
    return [
      'クイックメモ画面をChromeまたはEdgeで開きます。',
      'アドレスバー右側のインストールアイコン、またはブラウザメニューの「アプリをインストール」を選びます。',
      '追加後は「Meldex Memo」として起動できます。',
    ];
  }

  function _quickMemoUrl() {
    try { return new URL('quick-memo.html', location.href).href; } catch (_) { return 'quick-memo.html'; }
  }

  function openMeldexQuickMemo() {
    const url = _quickMemoUrl();
    const opened = window.open(url, '_blank');
    if (opened) {
      try { opened.opener = null; } catch (_) {}
      return;
    }
    location.href = url;
  }

  function _installStatusText() {
    if (_isStandaloneDisplayMode()) return 'Meldex本体は追加済みです。ホーム画面やアプリ一覧から起動できます。';
    if (_installPromptEvent) return 'この端末では、Meldex本体の追加確認を開けます。';
    return 'ブラウザ条件により直接追加できない場合は、ボタンから追加手順を確認できます。';
  }

  function _installHintText() {
    if (_isStandaloneDisplayMode()) return '現在はアプリ表示で起動しています。';
    if (_installPromptEvent) return 'ボタンを押すとブラウザの確認画面が開きます。';
    return 'iPhone/iPadや一部ブラウザでは、ブラウザメニューから追加します。クイックメモは別画面を開いて追加します。';
  }

  function _showInstallStatus(message) {
    if (typeof showStatus === 'function') showStatus(message);
  }

  function _hideStartupSplashForCloudHome() {
    try {
      if (typeof _hideStartupSplash === 'function') {
        _hideStartupSplash();
        return;
      }
    } catch (_) {}
    try {
      const splash = document.getElementById('gb-splash');
      if (splash) {
        splash.style.pointerEvents = 'none';
        splash.remove();
      }
    } catch (_) {}
  }

  function _hasBlockingCloudStartupUi() {
    return !!document.querySelector?.(
      [
        '#meldex-cloud-home-first-overlay',
        '#meldex-cloud-home-only',
        '.meldex-cloud-mode-overlay',
        '.meldex-cloud-mode-modal',
        '.meldex-cloud-setup-overlay',
        '.meldex-cloud-setup-modal',
        '[data-draft-recovery-dialog="1"]',
      ].join(', ')
    );
  }

  function markCloudHomeBrowserLaunch() {
    _setCloudHomeChoice(CLOUD_HOME_CHOICE_BROWSER);
  }

  function markCloudHomeInstalled() {
    _setCloudHomeChoice(CLOUD_HOME_CHOICE_INSTALLED);
  }

  function showCloudHomeOnlyNotice() {
    const options = arguments[0] || {};
    _hideStartupSplashForCloudHome();
    if (_cloudHomeDialogApi?.isOpen?.()) _cloudHomeDialogApi.close('home-only');
    document.getElementById('meldex-cloud-home-first-overlay')?.remove();
    const existing = document.getElementById('meldex-cloud-home-only');
    if (existing) existing.remove();
    return new Promise((resolve) => {
      const overlay = _el('main', {
        id: 'meldex-cloud-home-only',
        class: 'meldex-cloud-home-only',
        role: 'main',
        'aria-labelledby': 'meldex-cloud-home-only-title',
      });
      const actions = _el('div', { class: 'btn-row meldex-cloud-home-only-actions' });
      const browserButton = _el('button', {
        id: 'meldex-cloud-home-only-browser',
        type: 'button',
        class: 'primary',
        dataset: { e2eId: 'cloud-home-only-browser' },
        text: 'このままブラウザで起動',
      });
      const retryButton = _el('button', {
        id: 'meldex-cloud-home-only-retry',
        type: 'button',
        dataset: { e2eId: 'cloud-home-only-retry' },
        text: 'ホーム追加をやり直す',
      });
      const close = () => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
      };
      const continueInBrowser = () => {
        markCloudHomeBrowserLaunch();
        _cloudHomeLaunchFlowActive = false;
        close();
        setTimeout(() => _scheduleFirstRunConsent(), 800);
        resolve(true);
      };
      const retryHomeInstall = async () => {
        _setCloudHomeChoice('');
        close();
        const result = await showCloudHomeFirstRunDialog();
        resolve(!!result);
      };
      function onKeydown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          browserButton.focus();
        }
      }
      browserButton.addEventListener('click', continueInBrowser);
      retryButton.addEventListener('click', () => {
        retryHomeInstall().catch(() => resolve(false));
      });
      actions.append(browserButton, retryButton);
      const panel = _el('section', { class: 'meldex-cloud-home-only-panel' }, [
        _el('h1', { id: 'meldex-cloud-home-only-title', text: 'ホーム画面から起動できます' }),
        _el('p', {
          text: '以前ホーム画面に追加した記録があります。アイコンが残っている場合は、ホームのMeldexアイコンから起動してください。',
        }),
        _el('p', {
          text: 'アイコンを削除済みの場合は、このままブラウザで起動するか、ホームへの追加をやり直せます。',
        }),
        actions,
      ]);
      overlay.appendChild(panel);
      document.addEventListener('keydown', onKeydown);
      document.body.appendChild(overlay);
      if (options.focus !== false) browserButton.focus();
    });
  }

  function _iconNode(name, size) {
    const span = _el('span', { class: 'meldex-install-icon', 'aria-hidden': 'true' });
    if (typeof lucide === 'function') span.innerHTML = lucide(name, size || 14);
    return span;
  }

  function _installOptionTitle(icon, text) {
    const title = _el('div', { class: 'meldex-install-option-title' });
    title.append(_iconNode(icon, 14), _el('span', { text }));
    return title;
  }

  function _refreshInstallUi(root) {
    root = root || document;
    if (!root.querySelectorAll) return;
    const installed = _isStandaloneDisplayMode();
    const state = installed ? 'installed' : _installPromptEvent ? 'ready' : 'manual';
    const sections = [
      ...(root.matches?.('[data-meldex-install-section]') ? [root] : []),
      ...root.querySelectorAll('[data-meldex-install-section]'),
    ];
    sections.forEach(section => {
      section.dataset.meldexInstallState = state;
      const status = section.querySelector('[data-meldex-install-status]');
      if (status) status.textContent = _installStatusText();
      const hint = section.querySelector('[data-meldex-install-hint]');
      if (hint) hint.textContent = _installHintText();
      const button = section.querySelector('[data-meldex-install-button]');
      if (button) {
        button.disabled = installed;
        button.textContent = installed ? '本体は追加済み' : 'Meldex本体を追加';
      }
    });
  }

  function _createInstallSection(options) {
    options = options || {};
    const modal = options.context === 'modal';
    const section = _el('section', {
      class: modal
        ? 'meldex-install-card meldex-install-card--modal'
        : 'gb-section gb-section--boxed meldex-install-card',
      dataset: {
        meldexInstallSection: '1',
        meldexInstallContext: modal ? 'modal' : 'settings',
      },
    });
    const title = _el('div', { class: modal ? 'meldex-install-title' : 'gb-section-title meldex-install-title' });
    title.appendChild(_iconNode('download', 14));
    title.appendChild(_el('span', { text: 'ホーム画面に追加' }));
    const desc = _el('div', {
      class: modal ? 'meldex-install-desc' : 'gb-section-desc meldex-install-desc',
      text: 'Meldex本体とクイックメモは別々にホーム画面へ追加します。用途に合わせて必要なものを追加してください。',
    });
    const status = _el('div', {
      class: 'meldex-install-status',
      role: 'status',
      'aria-live': 'polite',
      dataset: { meldexInstallStatus: '1' },
    });
    const hint = _el('div', { class: 'meldex-install-hint', dataset: { meldexInstallHint: '1' } });
    const button = _el('button', {
      type: 'button',
      class: modal ? 'meldex-install-button' : 'gb-btn gb-btn-sm meldex-install-button',
      dataset: { e2eId: modal ? 'install-modal-add-home-button' : 'settings-install-add-home-button', meldexInstallButton: '1' },
      text: 'ホーム画面に追加',
    });
    button.addEventListener('click', async () => {
      const result = await installMeldexApp().catch(error => ({ ok: false, error }));
      if (options.closeOnSuccess && (result?.installed || result?.outcome === 'accepted')) options.closeOnSuccess();
    });
    const actions = _el('div', { class: 'meldex-install-actions' }, [button]);
    const mainOption = _el('div', { class: 'meldex-install-option meldex-install-option--main' }, [
      _installOptionTitle('monitorSmartphone', 'Meldex本体'),
      _el('div', {
        class: 'meldex-install-option-desc',
        text: 'ワークスペース全体を開く通常のMeldexです。ノート、シート、ボード、チャットを使います。',
      }),
      status,
      hint,
      actions,
    ]);
    const quickButton = _el('button', {
      type: 'button',
      class: modal ? 'meldex-install-button meldex-install-quick-button' : 'gb-btn gb-btn-sm meldex-install-quick-button',
      dataset: { e2eId: modal ? 'install-modal-open-quick-memo-button' : 'settings-install-open-quick-memo-button', meldexQuickMemoInstallButton: '1' },
      text: 'クイックメモを開く',
    });
    quickButton.addEventListener('click', openMeldexQuickMemo);
    const quickOption = _el('div', { class: 'meldex-install-option meldex-install-option--quick' }, [
      _installOptionTitle('fileText', 'クイックメモ'),
      _el('div', {
        class: 'meldex-install-option-desc',
        text: '短いメモ、共有URL、ペン入力、音声メモをすばやく保存する軽量画面です。',
      }),
      _el('div', {
        class: 'meldex-install-hint',
        text: '開いたクイックメモ画面をホーム画面に追加すると、Meldex Memoとして起動できます。',
      }),
      _el('div', { class: 'meldex-install-actions' }, [quickButton]),
    ]);
    section.append(title, desc, _el('div', { class: 'meldex-install-options' }, [mainOption, quickOption]));
    _refreshInstallUi(section);
    return section;
  }

  function showMeldexInstallDialog(options) {
    options = options || {};
    if (!options.force && _isStandaloneDisplayMode()) return false;
    if (_installDialogApi?.isOpen?.()) _installDialogApi.close('replace');
    document.getElementById('meldex-install-prompt-overlay')?.remove();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let dialogApi = null;
    const installSection = _createInstallSection({
      context: 'modal',
      closeOnSuccess: () => dialogApi?.close('installed'),
    });
    const intro = _el('p', {
      class: 'meldex-install-help-intro',
      text: 'Meldex本体とクイックメモは別々にホーム画面へ追加できます。本体はワークスペース全体、クイックメモは短いメモや共有保存に使います。',
    });
    const laterButton = _el('button', {
      id: 'meldex-install-prompt-later',
      type: 'button',
      class: 'gb-btn gb-btn-sm',
      dataset: { e2eId: 'install-modal-later-button' },
      text: '今はしない',
    });
    dialogApi = window.GBUI.createModal({
      id: 'meldex-install-prompt-dialog',
      titleId: 'meldex-install-prompt-title',
      title: 'ホーム画面に追加',
      body: [intro, installSection],
      footer: laterButton,
      variant: 'standard',
      extraClass: 'meldex-install-prompt-modal',
      geometryKey: 'meldex-install-prompt-dialog',
      initialFocus: '[data-meldex-install-button]',
      returnFocus: opener,
      onClose: () => {
        if (_installDialogApi === dialogApi) _installDialogApi = null;
      },
    });
    _installDialogApi = dialogApi;
    const { overlay, modal: dialog, header, body, footer } = dialogApi;
    overlay.id = 'meldex-install-prompt-overlay';
    overlay.classList.add('modal-overlay', 'meldex-install-prompt-overlay');
    dialog.classList.add('modal');
    dialog.dataset.e2eId = 'meldex-install-prompt-dialog';
    body.classList.add('modal-body', 'meldex-install-prompt-body');
    footer.classList.add('btn-row');
    header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'install-modal-header-close');
    overlay.addEventListener('meldex-release-dialog-close', () => dialogApi.close('external'));
    laterButton.addEventListener('click', () => dialogApi.close('later'));
    dialogApi.open();
    _refreshInstallUi(overlay);
    return true;
  }

  function _completeCloudHomeInstall(dialogApi, resolve) {
    markCloudHomeInstalled();
    _cloudHomeLaunchFlowActive = false;
    dialogApi?.close('installed');
    showCloudHomeOnlyNotice().then(resolve);
  }

  function showCloudHomeFirstRunDialog() {
    _hideStartupSplashForCloudHome();
    _cloudHomeLaunchFlowActive = true;
    if (_cloudHomeDialogApi?.isOpen?.()) _cloudHomeDialogApi.close('replace');
    document.getElementById('meldex-cloud-home-first-overlay')?.remove();
    return new Promise((resolve) => {
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const status = _el('div', {
        class: 'meldex-cloud-home-status',
        role: 'status',
        'aria-live': 'polite',
      });
      const bodyContent = [
        _el('p', {
          class: 'meldex-cloud-home-copy',
          text: 'ホーム画面に追加すると、次回からMeldexアイコンで直接開けます。スマホやタブレットではこの使い方が安定します。',
        }),
        _el('p', {
          class: 'meldex-cloud-home-note',
          text: '追加しない場合も、このままブラウザで設定を続けられます。Dropbox設定は次の画面で行います。',
        }),
        _el('div', { class: 'meldex-cloud-home-install-types' }, [
          _el('div', { class: 'meldex-cloud-home-install-type' }, [
            _installOptionTitle('monitorSmartphone', 'Meldex本体'),
            _el('p', { text: '日常的に開く本体アプリです。最初に追加します。' }),
          ]),
          _el('div', { class: 'meldex-cloud-home-install-type' }, [
            _installOptionTitle('fileText', 'クイックメモ'),
            _el('p', { text: '短いメモや共有保存用です。必要になったら設定から追加できます。' }),
          ]),
        ]),
        status,
      ];
      const addButton = _el('button', {
        id: 'meldex-cloud-home-first-add',
        type: 'button',
        class: 'gb-btn gb-btn-sm gb-btn-primary primary',
        dataset: { e2eId: 'cloud-home-first-add' },
        text: 'ホーム画面に追加する',
      });
      const browserButton = _el('button', {
        id: 'meldex-cloud-home-first-browser',
        type: 'button',
        class: 'gb-btn gb-btn-sm',
        dataset: { e2eId: 'cloud-home-first-browser' },
        text: 'ブラウザで続ける',
      });
      let dialogApi = null;
      let busy = false;
      let settled = false;
      function onKeydown(event) {
        if (event.key !== 'Escape' || !dialogApi?.isOpen?.()) return;
        event.preventDefault();
        event.stopPropagation();
        browserButton.focus();
      }
      const continueInBrowser = () => {
        if (settled) return;
        settled = true;
        busy = false;
        markCloudHomeBrowserLaunch();
        _cloudHomeLaunchFlowActive = false;
        dialogApi.close('browser');
        setTimeout(() => _scheduleFirstRunConsent(), 800);
        resolve(true);
      };
      const completeInstall = () => {
        if (settled) return;
        settled = true;
        busy = false;
        _completeCloudHomeInstall(dialogApi, resolve);
      };
      dialogApi = window.GBUI.createModal({
        id: 'meldex-cloud-home-first-dialog',
        titleId: 'meldex-cloud-home-first-title',
        title: 'Meldexをホーム画面に追加',
        body: bodyContent,
        footer: [addButton, browserButton],
        variant: 'standard',
        extraClass: 'meldex-cloud-home-first-modal',
        geometryKey: 'meldex-cloud-home-first-dialog',
        initialFocus: addButton,
        returnFocus: opener,
        closeOnEsc: false,
        closeOnOverlay: false,
        onBeforeClose: () => !busy,
        onClose: () => {
          document.removeEventListener('keydown', onKeydown);
          if (_cloudHomeDialogApi === dialogApi) _cloudHomeDialogApi = null;
        },
      });
      _cloudHomeDialogApi = dialogApi;
      const { overlay, modal: dialog, header, body, footer } = dialogApi;
      overlay.id = 'meldex-cloud-home-first-overlay';
      overlay.classList.add('modal-overlay', 'meldex-cloud-home-first-overlay');
      dialog.classList.add('modal');
      dialog.dataset.e2eId = 'meldex-cloud-home-first-dialog';
      body.classList.add('modal-body', 'meldex-cloud-home-first-body');
      footer.classList.add('btn-row', 'meldex-cloud-home-actions');
      header.querySelector('.gb-modal-close')?.remove();
      overlay.addEventListener('meldex-release-dialog-close', () => dialogApi.close('external'));
      addButton.addEventListener('click', async () => {
        if (busy || settled) return;
        busy = true;
        addButton.disabled = true;
        status.textContent = 'ブラウザの確認画面を開きます。';
        const result = await installMeldexApp({
          onManualDone: completeInstall,
        }).catch(error => ({ ok: false, error }));
        busy = false;
        if (settled) return;
        if (result?.installed || result?.outcome === 'accepted') {
          completeInstall();
          return;
        }
        addButton.disabled = false;
        if (result?.outcome === 'dismissed') {
          status.textContent = 'ホームへの追加はキャンセルされました。もう一度追加するか、ブラウザで続けられます。';
        } else {
          status.textContent = 'このブラウザでは手順に沿って追加してください。追加しない場合はブラウザで続けられます。';
        }
      });
      browserButton.addEventListener('click', continueInBrowser);
      document.addEventListener('keydown', onKeydown);
      dialogApi.open();
    });
  }

  async function prepareCloudHomeLaunch() {
    _applyCloudHomeQueryOverride();
    if (!_isCloudHomeLaunchTarget()) return true;
    if (_isStandaloneDisplayMode()) {
      markCloudHomeInstalled();
      return true;
    }
    const choice = _getCloudHomeChoice();
    if (choice === CLOUD_HOME_CHOICE_BROWSER) return true;
    if (choice === CLOUD_HOME_CHOICE_INSTALLED) {
      return await showCloudHomeOnlyNotice();
    }
    return await showCloudHomeFirstRunDialog();
  }

  function renderMeldexInstallSection(root, options) {
    options = options || {};
    const section = _createInstallSection(options);
    if (options.standalone) return section;
    const scope = root?.querySelector ? root : document;
    const host = options.host || scope.querySelector?.('#settings-install-container');
    if (!host) return section;
    host.replaceChildren(section);
    return section;
  }

  function _renderPendingInstallSections(root) {
    const scope = root?.querySelectorAll ? root : document;
    const hosts = [];
    if (scope.matches?.('#settings-install-container')) hosts.push(scope);
    scope.querySelectorAll?.('#settings-install-container').forEach(host => hosts.push(host));
    hosts.forEach(host => {
      if (host.querySelector?.('[data-meldex-install-section]')) {
        _refreshInstallUi(host);
        return;
      }
      renderMeldexInstallSection(document, { host });
    });
  }

  async function installMeldexApp() {
    const options = arguments[0] || {};
    if (_isStandaloneDisplayMode()) {
      _showInstallStatus('Meldexはすでにホーム画面に追加済みです');
      _refreshInstallUi(document);
      return { ok: true, installed: true };
    }
    const promptEvent = _installPromptEvent;
    if (promptEvent && typeof promptEvent.prompt === 'function') {
      _installPromptEvent = null;
      _refreshInstallUi(document);
      try {
        const promptResult = await promptEvent.prompt();
        let choice = promptResult || null;
        if (promptEvent.userChoice) {
          try { choice = await promptEvent.userChoice; } catch (_) {}
        }
        const outcome = String(choice?.outcome || '');
        if (outcome === 'accepted') {
          _showInstallStatus('Meldexをホーム画面に追加しました');
        } else if (outcome === 'dismissed') {
          _showInstallStatus('ホーム画面への追加をキャンセルしました');
        }
        _refreshInstallUi(document);
        return { ok: outcome !== 'dismissed', outcome: outcome || 'unknown' };
      } catch (error) {
        _showInstallStatus('ブラウザの追加画面を開けませんでした。手順を表示します');
        _refreshInstallUi(document);
        showMeldexInstallHelpDialog({ onManualDone: options.onManualDone });
        return { ok: false, error };
      }
    }
    showMeldexInstallHelpDialog({ onManualDone: options.onManualDone });
    return { ok: false, manual: true };
  }

  function showMeldexInstallHelpDialog() {
    const options = arguments[0] || {};
    if (_installHelpDialogApi?.isOpen?.()) _installHelpDialogApi.close('replace');
    document.getElementById('meldex-install-help-overlay')?.remove();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyContent = [
      _el('p', {
        class: 'meldex-install-help-intro',
        text: 'このブラウザではMeldex本体の追加画面を直接開けないため、次の手順で追加してください。',
      }),
      _el('div', { class: 'meldex-install-help-subtitle', text: 'Meldex本体' }),
      _el('ol', { class: 'meldex-install-help-list' }, _installSteps().map(step => _el('li', { text: step }))),
      _el('div', { class: 'meldex-install-help-subtitle', text: 'クイックメモ' }),
      _el('ol', { class: 'meldex-install-help-list' }, _quickMemoInstallSteps().map(step => _el('li', { text: step }))),
    ];
    const quickMemoButton = _el('button', {
      id: 'meldex-install-help-quick-memo',
      type: 'button',
      class: 'gb-btn gb-btn-sm',
      dataset: { e2eId: 'install-help-open-quick-memo-button' },
      text: 'クイックメモを開く',
    });
    const doneButton = options.onManualDone
      ? _el('button', {
        id: 'meldex-install-help-done',
        type: 'button',
        class: 'gb-btn gb-btn-sm gb-btn-primary primary',
        dataset: { e2eId: 'install-help-done-button' },
        text: 'ホームに追加できたら押す',
      })
      : null;
    const closeButton = _el('button', {
      id: 'meldex-install-help-close',
      type: 'button',
      class: options.onManualDone ? 'gb-btn gb-btn-sm' : 'gb-btn gb-btn-sm gb-btn-primary primary',
      dataset: { e2eId: 'install-help-close-button' },
      text: '閉じる',
    });
    let dialogApi = null;
    const footerContent = [quickMemoButton];
    if (doneButton) footerContent.push(doneButton);
    footerContent.push(closeButton);
    dialogApi = window.GBUI.createModal({
      id: 'meldex-install-help-dialog',
      titleId: 'meldex-install-help-title',
      title: 'ホーム画面に追加',
      body: bodyContent,
      footer: footerContent,
      variant: 'standard',
      extraClass: 'meldex-install-help-modal',
      geometryKey: 'meldex-install-help-dialog',
      initialFocus: doneButton || closeButton,
      returnFocus: opener,
      onClose: () => {
        if (_installHelpDialogApi === dialogApi) _installHelpDialogApi = null;
      },
    });
    _installHelpDialogApi = dialogApi;
    const { overlay, modal: dialog, header, body, footer } = dialogApi;
    overlay.id = 'meldex-install-help-overlay';
    overlay.classList.add('modal-overlay', 'meldex-install-help-overlay');
    dialog.classList.add('modal');
    dialog.dataset.e2eId = 'meldex-install-help-dialog';
    body.classList.add('modal-body', 'meldex-install-help-body');
    footer.classList.add('btn-row');
    header.querySelector('.gb-modal-close')?.setAttribute('data-e2e-id', 'install-help-header-close');
    overlay.addEventListener('meldex-release-dialog-close', () => dialogApi.close('external'));
    doneButton?.addEventListener('click', () => {
      dialogApi.close('done');
      options.onManualDone?.();
    });
    quickMemoButton.addEventListener('click', openMeldexQuickMemo);
    closeButton.addEventListener('click', () => dialogApi.close('footer'));
    dialogApi.open();
    return true;
  }

  function _bindInstallPromptEvents() {
    if (_installListenersBound) return;
    if (typeof window.addEventListener !== 'function') return;
    _installListenersBound = true;
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault?.();
      _installPromptEvent = event;
      _refreshInstallUi(document);
    });
    window.addEventListener('appinstalled', () => {
      _installPromptEvent = null;
      if (_isCloudHomeLaunchTarget()) markCloudHomeInstalled();
      _showInstallStatus('Meldexをホーム画面に追加しました');
      _refreshInstallUi(document);
    });
    try {
      const displayMode = window.matchMedia?.('(display-mode: standalone)');
      displayMode?.addEventListener?.('change', () => _refreshInstallUi(document));
    } catch (_) {}
  }

  function _bindInstallSectionObserver() {
    _renderPendingInstallSections(document);
    if (_installSectionObserverBound) return;
    if (typeof MutationObserver !== 'function') return;
    const target = document.body || document.documentElement;
    if (!target) return;
    _installSectionObserverBound = true;
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes?.forEach(node => {
          if (node?.nodeType === 1) _renderPendingInstallSections(node);
        });
      });
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  function showConsentDialog(options) {
    options = options || {};
    if (!options.force && hasConsent()) return false;
    if (document.getElementById('meldex-beta-consent-overlay')) return false;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyContent = [_el('ul', { class: 'meldex-beta-consent-summary' }, [
      _el('li', { text: 'この版はベータ版です。正式版までに機能名、配置、挙動が変わる可能性があります。' }),
      _el('li', { text: '作品・データはユーザーに帰属し、原則としてローカルPCまたはユーザーが指定したクラウドストレージに保存されます。' }),
      _el('li', { text: 'クラッシュレポートと利用統計は、下の任意チェックを入れた場合だけ送信します。作品本文・ファイル名・個人識別情報は含めません。' }),
      _el('li', { text: 'LLM連携を使う場合、質問本文と選択した関連コンテキストは各LLMプロバイダへ送信されます。' }),
    ])];
    const links = _el('p', { class: 'meldex-beta-consent-muted' }, [
      _el('a', {
        id: 'meldex-beta-consent-privacy-link',
        href: 'PRIVACY.html',
        target: '_blank',
        rel: 'noopener',
        text: 'プライバシーポリシー',
      }),
      document.createTextNode(' / '),
      _el('a', {
        id: 'meldex-beta-consent-terms-link',
        href: 'TERMS-OF-USE.html',
        target: '_blank',
        rel: 'noopener',
        text: '利用規約',
      }),
      document.createTextNode(' を確認できます。'),
    ]);
    bodyContent.push(links);

    const checks = _el('div', { class: 'meldex-beta-consent-checks' });
    const required = _createConsentCheckbox(
      'meldex-beta-consent-required',
      'プライバシーポリシーと利用規約に同意し、ベータ版であることとバックアップの必要性を確認しました。',
      false,
      { required: true }
    );
    const crash = _createConsentCheckbox(
      'meldex-beta-consent-crash',
      'クラッシュレポートの送信を許可する',
      _readConsentFlag(CRASH_CONSENT_KEY, 'crashReports')
    );
    const telemetry = _createConsentCheckbox(
      'meldex-beta-consent-telemetry',
      '利用統計の送信を許可する',
      _readConsentFlag(TELEMETRY_KEY, 'telemetry')
    );
    const updateChecks = _createConsentCheckbox(
      'meldex-beta-consent-update',
      '更新確認のための通信を許可する',
      _readConsentFlag(UPDATE_CHECK_KEY, 'updateChecks')
    );
    checks.appendChild(required);
    checks.appendChild(crash);
    checks.appendChild(telemetry);
    checks.appendChild(updateChecks);
    bodyContent.push(checks);
    bodyContent.push(_el('div', {
      class: 'meldex-beta-consent-muted',
      text: '送信設定はあとから 設定 → フィードバック で変更できます。',
    }));

    const continueButton = _el('button', {
      id: 'meldex-beta-consent-continue',
      class: 'gb-btn gb-btn-sm gb-btn-primary primary',
      type: 'button',
      dataset: { e2eId: 'beta-consent-continue' },
      text: '同意して開始',
    });
    continueButton.disabled = true;
    const requiredInput = required.querySelector('input');
    const crashInput = crash.querySelector('input');
    const telemetryInput = telemetry.querySelector('input');
    const updateInput = updateChecks.querySelector('input');
    let dialogApi = null;
    dialogApi = window.GBUI.createModal({
      id: 'meldex-beta-consent-dialog',
      titleId: 'meldex-beta-consent-title',
      title: `Meldex ${BETA_LABEL} について`,
      body: bodyContent,
      footer: continueButton,
      variant: 'standard',
      extraClass: 'meldex-beta-consent-modal',
      geometryKey: 'meldex-beta-consent-dialog',
      initialFocus: () => window.innerWidth > 768 ? requiredInput : dialogApi?.modal,
      returnFocus: opener,
      closeOnEsc: false,
      closeOnOverlay: false,
      onClose: () => {
        if (_consentDialogApi === dialogApi) _consentDialogApi = null;
      },
    });
    _consentDialogApi = dialogApi;
    const { overlay, modal: dialog, header, body, footer } = dialogApi;
    overlay.id = 'meldex-beta-consent-overlay';
    overlay.classList.add('modal-overlay', 'meldex-beta-consent-overlay');
    dialog.classList.add('modal');
    dialog.dataset.e2eId = 'meldex-beta-consent-dialog';
    body.classList.add('modal-body');
    footer.classList.add('btn-row');
    header.querySelector('.gb-modal-close')?.remove();
    overlay.addEventListener('meldex-release-dialog-close', () => dialogApi.close('external'));
    requiredInput.addEventListener('change', () => {
      continueButton.disabled = !requiredInput.checked;
    });
    continueButton.addEventListener('click', () => {
      if (!requiredInput.checked) return;
      saveConsent({
        crashReports: crashInput.checked,
        telemetry: telemetryInput.checked,
        updateChecks: updateInput.checked,
      });
      if (telemetryInput.checked) window.MeldexBetaFeedback?.startTelemetry?.();
      if (updateInput.checked) window.MeldexUpdateChecker?.checkNow?.({ force: true }).catch(() => {});
      dialogApi.close('consent');
      refreshMeldexAboutPanel(document);
      if (options.showInstallAfterConsent !== false && !_isCloudHomeLaunchTarget()) {
        setTimeout(() => showMeldexInstallDialog({ reason: 'after-consent' }), 260);
      }
    });
