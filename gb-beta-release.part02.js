    dialogApi.open();
    try {
      const resetConsentScroll = () => {
        dialog.scrollTop = 0;
        body.scrollTop = 0;
      };
      resetConsentScroll();
      requestAnimationFrame(resetConsentScroll);
      setTimeout(resetConsentScroll, 80);
      setTimeout(resetConsentScroll, 180);
    } catch (_) {}
    return true;
  }

  function _scheduleFirstRunConsent() {
    if (!config.isBeta || _isBypassMode() || hasConsent()) return;
    const run = () => {
      if (!document.body || document.getElementById('gb-splash')) return;
      if (_cloudHomeLaunchFlowActive) return;
      if (document.body?.dataset?.meldexOnboardingActive === '1' || document.getElementById('meldex-onboarding-overlay')) {
        setTimeout(run, 500);
        return;
      }
      if (!_isStandaloneDisplayMode() && _isCloudHomeLaunchTarget() && !_getCloudHomeChoice()) return;
      if (document.getElementById('meldex-cloud-home-only')) return;
      if (_hasBlockingCloudStartupUi()) {
        setTimeout(run, 500);
        return;
      }
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
    const host = document.getElementById('left-chrome-floating-user');
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
    CLOUD_HOME_CHOICE_KEY,
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
    showCloudHomeFirstRunDialog,
    showCloudHomeOnlyNotice,
    prepareCloudHomeLaunch,
    markCloudHomeBrowserLaunch,
    markCloudHomeInstalled,
    openMeldexQuickMemo,
    isStandaloneDisplayMode: _isStandaloneDisplayMode,
    renderMeldexInstallSection,
  };
  window.refreshMeldexAboutPanel = refreshMeldexAboutPanel;
  window.installMeldexApp = installMeldexApp;
  window.showMeldexInstallDialog = showMeldexInstallDialog;
  window.showMeldexInstallHelpDialog = showMeldexInstallHelpDialog;
  window.openMeldexQuickMemo = openMeldexQuickMemo;
  window.prepareMeldexCloudHomeLaunch = prepareCloudHomeLaunch;
  window.renderMeldexInstallSection = renderMeldexInstallSection;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot, { once: true });
  else _boot();
})();
