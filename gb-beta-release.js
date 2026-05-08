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

  let _versionPromise = null;
  let _serverConsentLoaded = false;
  let _serverConsent = null;
  let _installPromptEvent = null;
  let _installListenersBound = false;
  let _installSectionObserverBound = false;

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

  function _readConsentFlag(storageKey, consentField) {
    const stored = _safeStorageGet(storageKey);
    if (stored === '1') return true;
    if (stored === '0') return false;
    return getConsent()?.[consentField] === true;
  }

  function saveConsent(options) {
    const payload = {
      schema: 2,
      acceptedAt: options?.acceptedAt || new Date().toISOString(),
      betaNoticeAccepted: true,
      crashReports: !!options?.crashReports,
      telemetry: !!options?.telemetry,
      updateChecks: !!options?.updateChecks,
    };
    _safeStorageSet(CONSENT_KEY, JSON.stringify(payload));
    _safeStorageSet(CRASH_CONSENT_KEY, payload.crashReports ? '1' : '0');
    _safeStorageSet(TELEMETRY_KEY, payload.telemetry ? '1' : '0');
    _safeStorageSet(UPDATE_CHECK_KEY, payload.updateChecks ? '1' : '0');
    _serverConsent = payload;
    _serverConsentLoaded = true;
    _saveServerConsent(payload).catch(() => {});
    return payload;
  }

  function resetConsent() {
    _safeStorageRemove(CONSENT_KEY);
    _safeStorageRemove(CRASH_CONSENT_KEY);
    _safeStorageRemove(TELEMETRY_KEY);
    _safeStorageRemove(UPDATE_CHECK_KEY);
    _serverConsent = null;
    _serverConsentLoaded = true;
    _deleteServerConsent().catch(() => {});
  }

  async function _fetchJson(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
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
    if (server) {
      _serverConsent = server;
      _safeStorageSet(CONSENT_KEY, JSON.stringify(server));
      _safeStorageSet(CRASH_CONSENT_KEY, server.crashReports ? '1' : '0');
      _safeStorageSet(TELEMETRY_KEY, server.telemetry ? '1' : '0');
      _safeStorageSet(UPDATE_CHECK_KEY, server.updateChecks ? '1' : '0');
      return server;
    }
    if (local?.acceptedAt) {
      _serverConsent = local;
      await _saveServerConsent(local);
      return local;
    }
    return null;
  }

  function _createConsentCheckbox(id, text, checked) {
    const input = _el('input', { id, type: 'checkbox' });
    input.checked = !!checked;
    return _el('label', { class: 'meldex-beta-consent-check' }, [
      input,
      _el('span', { text }),
    ]);
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
        'SafariでこのMeldexページを開きます。',
        '共有ボタンを押し、「ホーム画面に追加」を選びます。',
        '表示名を確認し、「追加」を押します。',
      ];
    }
    if (_isAndroidLike()) {
      return [
        'ChromeまたはEdgeでこのMeldexページを開きます。',
        'ブラウザメニューから「アプリをインストール」または「ホーム画面に追加」を選びます。',
        '確認画面で追加を実行します。',
      ];
    }
    return [
      'ChromeまたはEdgeでこのMeldexページを開きます。',
      'アドレスバー右側のインストールアイコン、またはブラウザメニューの「アプリをインストール」を選びます。',
      '確認画面でインストールを実行します。',
    ];
  }

  function _installStatusText() {
    if (_isStandaloneDisplayMode()) return '追加済みです。ホーム画面やアプリ一覧からMeldexを起動できます。';
    if (_installPromptEvent) return 'この端末では、Meldexからホーム画面への追加を実行できます。';
    return 'ブラウザ条件により直接追加できない場合は、ボタンから追加手順を確認できます。';
  }

  function _installHintText() {
    if (_isStandaloneDisplayMode()) return '現在はアプリ表示で起動しています。';
    if (_installPromptEvent) return 'ボタンを押すとブラウザの確認画面が開きます。';
    return 'iPhone/iPadや一部ブラウザでは、ブラウザメニューから追加します。';
  }

  function _showInstallStatus(message) {
    if (typeof showStatus === 'function') showStatus(message);
  }

  function _iconNode(name, size) {
    const span = _el('span', { class: 'meldex-install-icon', 'aria-hidden': 'true' });
    if (typeof lucide === 'function') span.innerHTML = lucide(name, size || 14);
    return span;
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
        button.textContent = installed ? '追加済み' : 'ホーム画面に追加';
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
      text: '対応ブラウザでは、Meldexをホーム画面やアプリ一覧から直接起動できるようにします。',
    });
    const status = _el('div', { class: 'meldex-install-status', dataset: { meldexInstallStatus: '1' } });
    const hint = _el('div', { class: 'meldex-install-hint', dataset: { meldexInstallHint: '1' } });
    const button = _el('button', {
      type: 'button',
      class: modal ? 'meldex-install-button' : 'gb-btn gb-btn-sm meldex-install-button',
      dataset: { meldexInstallButton: '1' },
      text: 'ホーム画面に追加',
    });
    button.addEventListener('click', async () => {
      const result = await installMeldexApp().catch(error => ({ ok: false, error }));
      if (options.closeOnSuccess && (result?.installed || result?.outcome === 'accepted')) options.closeOnSuccess();
    });
    const actions = _el('div', { class: 'meldex-install-actions' }, [button]);
    section.append(title, desc, status, hint, actions);
    _refreshInstallUi(section);
    return section;
  }

  function showMeldexInstallDialog(options) {
    options = options || {};
    if (!options.force && _isStandaloneDisplayMode()) return false;
    const existing = document.getElementById('meldex-install-prompt-overlay');
    if (existing) existing.remove();
    const overlay = _el('div', {
      id: 'meldex-install-prompt-overlay',
      class: 'modal-overlay meldex-install-prompt-overlay',
    });
    const dialog = _el('div', {
      class: 'modal meldex-install-prompt-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'meldex-install-prompt-title',
    });
    const title = _el('h3', { id: 'meldex-install-prompt-title', text: 'ホーム画面に追加' });
    const body = _el('div', { class: 'modal-body meldex-install-prompt-body' }, [
      _el('p', {
        class: 'meldex-install-help-intro',
        text: 'Meldexをホーム画面やアプリ一覧に追加すると、次回からブラウザのタブを探さずに起動できます。',
      }),
    ]);
    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
    };
    function onKeydown(event) {
      if (event.key === 'Escape' && overlay.isConnected) close();
    }
    body.appendChild(_createInstallSection({ context: 'modal', closeOnSuccess: close }));
    const buttons = _el('div', { class: 'btn-row' });
    const laterButton = _el('button', { type: 'button', text: '今はしない' });
    laterButton.addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown);
    buttons.appendChild(laterButton);
    dialog.append(title, body, buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    _refreshInstallUi(overlay);
    const installButton = overlay.querySelector('[data-meldex-install-button]');
    installButton?.focus?.();
    return true;
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
        showMeldexInstallHelpDialog();
        return { ok: false, error };
      }
    }
    showMeldexInstallHelpDialog();
    return { ok: false, manual: true };
  }

  function showMeldexInstallHelpDialog() {
    const existing = document.getElementById('meldex-install-help-overlay');
    if (existing) existing.remove();
    const overlay = _el('div', {
      id: 'meldex-install-help-overlay',
      class: 'modal-overlay meldex-install-help-overlay',
    });
    const dialog = _el('div', {
      class: 'modal meldex-install-help-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'meldex-install-help-title',
    });
    const title = _el('h3', { id: 'meldex-install-help-title', text: 'ホーム画面に追加' });
    const body = _el('div', { class: 'modal-body meldex-install-help-body' }, [
      _el('p', {
        class: 'meldex-install-help-intro',
        text: 'このブラウザではMeldexから追加画面を直接開けないため、次の手順で追加してください。',
      }),
      _el('ol', { class: 'meldex-install-help-list' }, _installSteps().map(step => _el('li', { text: step }))),
    ]);
    const buttons = _el('div', { class: 'btn-row' });
    const closeButton = _el('button', { type: 'button', class: 'primary', text: '閉じる' });
    const close = () => {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
    };
    function onKeydown(event) {
      if (event.key === 'Escape' && overlay.isConnected) close();
    }
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown);
    buttons.appendChild(closeButton);
    dialog.append(title, body, buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    closeButton.focus();
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

    const overlay = _el('div', {
      id: 'meldex-beta-consent-overlay',
      class: 'modal-overlay meldex-beta-consent-overlay',
    });
    const dialog = _el('div', {
      class: 'modal meldex-beta-consent-modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'meldex-beta-consent-title',
    });
    const title = _el('h3', { id: 'meldex-beta-consent-title', text: `Meldex ${BETA_LABEL} について` });
    const body = _el('div', { class: 'modal-body' });
    body.appendChild(_el('ul', { class: 'meldex-beta-consent-summary' }, [
      _el('li', { text: 'この版はベータ版です。正式版までに機能名、配置、挙動が変わる可能性があります。' }),
      _el('li', { text: '作品・データはユーザーに帰属し、原則としてローカルPCまたはユーザーが指定したクラウドストレージに保存されます。' }),
      _el('li', { text: 'クラッシュレポートと利用統計は、下の任意チェックを入れた場合だけ送信します。作品本文・ファイル名・個人識別情報は含めません。' }),
      _el('li', { text: 'LLM連携を使う場合、質問本文と選択した関連コンテキストは各LLMプロバイダへ送信されます。' }),
    ]));
    const links = _el('p', { class: 'meldex-beta-consent-muted' }, [
      _el('a', { href: 'PRIVACY.html', target: '_blank', rel: 'noopener', text: 'プライバシーポリシー' }),
      document.createTextNode(' / '),
      _el('a', { href: 'TERMS-OF-USE.html', target: '_blank', rel: 'noopener', text: '利用規約' }),
      document.createTextNode(' を確認できます。'),
    ]);
    body.appendChild(links);

    const checks = _el('div', { class: 'meldex-beta-consent-checks' });
    const required = _createConsentCheckbox(
      'meldex-beta-consent-required',
      'プライバシーポリシーと利用規約に同意し、ベータ版であることとバックアップの必要性を確認しました。',
      false
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
    body.appendChild(checks);
    body.appendChild(_el('div', {
      class: 'meldex-beta-consent-muted',
      text: '送信設定はあとから 設定 → フィードバック で変更できます。',
    }));

    const buttons = _el('div', { class: 'btn-row' });
    const continueButton = _el('button', { class: 'primary', type: 'button', text: '同意して開始' });
    continueButton.disabled = true;
    buttons.appendChild(continueButton);
    dialog.appendChild(title);
    dialog.appendChild(body);
    dialog.appendChild(buttons);
    overlay.appendChild(dialog);

    const requiredInput = required.querySelector('input');
    const crashInput = crash.querySelector('input');
    const telemetryInput = telemetry.querySelector('input');
    const updateInput = updateChecks.querySelector('input');
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
      overlay.remove();
      refreshMeldexAboutPanel(document);
      if (options.showInstallAfterConsent !== false) {
        setTimeout(() => showMeldexInstallDialog({ reason: 'after-consent' }), 80);
      }
    });

    document.body.appendChild(overlay);
    requiredInput.focus();
    return true;
  }

  function _scheduleFirstRunConsent() {
    if (!config.isBeta || _isBypassMode() || hasConsent()) return;
    const run = () => {
      if (!document.body || document.getElementById('gb-splash')) return;
      showConsentDialog();
    };
    if (!document.body) return;
    const splash = document.getElementById('gb-splash');
    if (!splash) {
      setTimeout(run, 50);
      return;
    }
    const observer = new MutationObserver(() => {
      if (!document.getElementById('gb-splash')) {
        observer.disconnect();
        setTimeout(run, 50);
      }
    });
    observer.observe(document.body, { childList: true, subtree: false });
  }

  function _ensureDesktopBadge() {
    const oldHostBadge = document.querySelector('#left-chrome-command > .meldex-beta-badge');
    if (oldHostBadge) oldHostBadge.remove();
    const host = document.getElementById('left-chrome-user');
    if (!host || host.querySelector('.meldex-beta-badge')) return;
    host.appendChild(_el('span', { class: 'meldex-beta-badge', text: BETA_LABEL }));
  }

  function _refreshConsentStatus(root) {
    const consent = getConsent();
    const status = root.querySelector?.('#settings-about-consent-status');
    if (!status) return;
    const crashOn = _readConsentFlag(CRASH_CONSENT_KEY, 'crashReports');
    const telemetryOn = _readConsentFlag(TELEMETRY_KEY, 'telemetry');
    const updateOn = _readConsentFlag(UPDATE_CHECK_KEY, 'updateChecks');
    status.textContent = consent
      ? `同意済み / クラッシュレポート: ${crashOn ? 'オン' : 'オフ'} / 利用統計: ${telemetryOn ? 'オン' : 'オフ'} / 更新確認: ${updateOn ? 'オン' : 'オフ'}`
      : '未同意';
  }

  function isUpdateCheckEnabled() {
    return _readConsentFlag(UPDATE_CHECK_KEY, 'updateChecks');
  }

  async function refreshMeldexAboutPanel(root) {
    root = root || document;
    _refreshInstallUi(root);
    const versionEl = root.querySelector?.('#settings-about-version');
    if (!versionEl) return;
    const info = await getVersionInfo();
    versionEl.textContent = info.version || `v${_extractSemver(info)}`;
    const semverEl = root.querySelector?.('#settings-about-semver');
    if (semverEl) semverEl.textContent = _extractSemver(info);
    const commitEl = root.querySelector?.('#settings-about-commit');
    if (commitEl) commitEl.textContent = info.commit || '未取得';
    const variantEl = root.querySelector?.('#settings-about-variant');
    if (variantEl) variantEl.textContent = info.variant || 'dev';
    const betaEl = root.querySelector?.('#settings-about-beta');
    if (betaEl) betaEl.textContent = BETA_LABEL;
    _refreshConsentStatus(root);
  }

  function _boot() {
    refreshReleaseTitle().catch(() => {});
    _ensureDesktopBadge();
    _refreshInstallUi(document);
    _bindInstallSectionObserver();
    syncConsentState().finally(() => _scheduleFirstRunConsent());
  }

  _bindInstallPromptEvents();

  window.MeldexBetaRelease = {
    CONSENT_KEY,
    CRASH_CONSENT_KEY,
    TELEMETRY_KEY,
    getVersionInfo,
    refreshReleaseTitle,
    showConsentDialog,
    getConsent,
    hasConsent,
    saveConsent,
    resetConsent,
    syncConsentState,
    isUpdateCheckEnabled,
    installMeldexApp,
    showMeldexInstallDialog,
    showMeldexInstallHelpDialog,
    renderMeldexInstallSection,
  };
  window.refreshMeldexAboutPanel = refreshMeldexAboutPanel;
  window.installMeldexApp = installMeldexApp;
  window.showMeldexInstallDialog = showMeldexInstallDialog;
  window.showMeldexInstallHelpDialog = showMeldexInstallHelpDialog;
  window.renderMeldexInstallSection = renderMeldexInstallSection;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot, { once: true });
  else _boot();
})();
