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
      _el('li', { text: '本ソフトウェアは13歳以上の利用を推奨します。13歳未満の方は保護者の同意を得てから利用してください。' }),
      _el('li', { text: 'クラッシュレポートと利用統計は、下の任意チェックを入れた場合だけ送信します。作品本文・ファイル名・個人識別情報は含めません。' }),
      _el('li', { text: 'LLM連携を使う場合、質問本文と選択した関連コンテキストは各LLMプロバイダへ送信されます。' }),
    ]));
    const links = _el('p', { class: 'meldex-beta-consent-muted' }, [
      _el('a', { href: 'PRIVACY.md', target: '_blank', rel: 'noopener', text: 'プライバシーポリシー' }),
      document.createTextNode(' / '),
      _el('a', { href: 'TERMS-OF-USE.md', target: '_blank', rel: 'noopener', text: '利用規約' }),
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
    syncConsentState().finally(() => _scheduleFirstRunConsent());
  }

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
  };
  window.refreshMeldexAboutPanel = refreshMeldexAboutPanel;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot, { once: true });
  else _boot();
})();
