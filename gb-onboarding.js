(function () {
  'use strict';

  if (window.MeldexOnboarding) return;

  const DONE_KEY = 'meldex-onboarding-complete-v1';
  let state = { step: 0, startup: null, sample: true, busy: false };
  let modalController = null;

  function _setOnboardingActive(active) {
    try {
      if (!document.body) return;
      if (active) document.body.dataset.meldexOnboardingActive = '1';
      else delete document.body.dataset.meldexOnboardingActive;
    } catch (_) {}
  }

  function _isBypassMode() {
    try {
      const params = new URLSearchParams(location.search);
      return params.has('smoke') || params.has('e2e') || params.get('single') === '1';
    } catch (_) {
      return false;
    }
  }

  function _done() {
    try { return localStorage.getItem(DONE_KEY) === '1'; } catch (_) { return false; }
  }

  function _setDone() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (_) {}
  }

  function _homePath() {
    return String(window._homeFolderPath || state.startup?.homePath || '').replace(/[\\/]$/, '');
  }

  function _hasSource(startup) {
    return !!(startup?.vaultPath || startup?.hasRoots);
  }

  function _sampleDownloadUrl() {
    const cfg = window.MeldexCloudRuntimeConfig || {};
    return String(cfg.samples?.downloadUrl || cfg.sampleDownloadUrl || '').trim();
  }

  function _openSampleDownload() {
    const url = _sampleDownloadUrl() || 'https://github.com/cam-nagara/MeldexCloud/releases';
    window.open(url, '_blank', 'noopener');
  }

  function _openSampleGuide() {
    _setOnboardingActive(false);
    _removeOnboardingOverlayNow('sample-guide');
    if (!window.MeldexRuntimeAdapter?.isBrowserDataMode?.() && typeof openPage === 'function') {
      openPage('サンプルデータを取り込む', 'MeldexHome/マニュアル/01_はじめに/サンプルデータを取り込む.md', { fromExplorer: true, skipAutoAppLayout: true });
      return;
    }
    window.open('public-index.html#samples', '_blank', 'noopener');
  }

  function shouldShow(startup) {
    if (_isBypassMode() || _done()) return false;
    return !_hasSource(startup || {});
  }

  function _stepLabel(index) {
    return ['ようこそ', '保存先', 'サンプル', '同意'][index] || '';
  }

  function _stepTitle(index) {
    return ['Meldexの準備をします', 'データの保存先', 'サンプルデータ', '同意と最初のノート'][index] || '';
  }

  function _renderSteps() {
    return `<div class="meldex-onboarding-steps" role="list" aria-label="初期設定の進行状況">
      ${[0, 1, 2, 3].map(i => `<div class="meldex-onboarding-step${i === state.step ? ' is-active' : ''}" role="listitem"${i === state.step ? ' aria-current="step"' : ''}>
        <span class="meldex-onboarding-step-index">${i + 1}</span>
        <span class="meldex-onboarding-step-label">${_stepLabel(i)}</span>
      </div>`).join('')}
    </div>`;
  }

  function _body() {
    const home = _homePath() || 'Documents/Meldex';
    if (state.step === 0) {
      return `<p id="meldex-onboarding-description" class="meldex-onboarding-copy">最初に、作品や設定を保存する場所を確認します。あとから設定で変更できます。</p>`;
    }
    if (state.step === 1) {
      return `<p id="meldex-onboarding-description" class="meldex-onboarding-copy">現在のホームフォルダは次の場所です。</p>
        <div class="meldex-onboarding-path">${esc(home)}</div>
        <div class="meldex-onboarding-button-row">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="onboarding-change-home" data-onboarding-action="change-home">${lucide('folderOpen',14)} ホームフォルダを変更</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="onboarding-add-source" data-onboarding-action="add-source">${lucide('folderPlus',14)} ソースフォルダを追加</button>
        </div>
        <p class="meldex-onboarding-copy">迷った場合は、このまま進めて構いません。</p>`;
    }
    if (state.step === 2) {
      return `<p id="meldex-onboarding-description" class="meldex-onboarding-copy">必要な場合だけ、ホームフォルダにサンプル作品を追加できます。既にあるファイルは上書きしません。</p>
        <div class="meldex-onboarding-button-row">
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="onboarding-sample-install" data-onboarding-action="sample-install">${lucide('archive',14)} サンプルを追加</button>
          <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="onboarding-sample-guide" data-onboarding-action="sample-guide">${lucide('bookOpen',14)} 取り込み手順</button>
        </div>`;
    }
    return `<p id="meldex-onboarding-description" class="meldex-onboarding-copy">ベータ版の利用条件を確認し、最初の無題ノートを作成して開始します。</p>
      <div class="meldex-onboarding-button-row">
        <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="onboarding-consent" data-onboarding-action="consent">${lucide('shieldCheck',14)} 利用条件を確認</button>
        <button type="button" class="gb-btn gb-btn-sm" data-e2e-id="onboarding-about" data-onboarding-action="about">${lucide('info',14)} Meldex（メルデックス）について</button>
      </div>`;
  }

  function _overlay() {
    return modalController?.overlay || document.getElementById('meldex-onboarding-overlay');
  }

  function _removeOnboardingOverlayNow(reason = 'programmatic') {
    const overlay = document.getElementById('meldex-onboarding-overlay');
    if (!overlay) return;
    if (modalController?.isOpen?.()) {
      modalController.close(reason);
      if (overlay.isConnected) overlay.remove();
      modalController = null;
      return;
    }
    try { overlay.parentNode?.removeChild(overlay); }
    catch (_) { try { overlay.remove(); } catch (_) {} }
    modalController = null;
  }

  function _createOnboardingController() {
    const content = document.createElement('div');
    const prev = document.createElement('button');
    prev.type = 'button';
    const primary = document.createElement('button');
    primary.type = 'button';
    const controller = window.GBUI.createModal({
      id: 'meldex-onboarding',
      titleId: 'meldex-onboarding-title',
      title: _stepTitle(state.step),
      body: content,
      footer: [prev, primary],
      variant: 'standard',
      geometryKey: 'meldex-onboarding',
      minWidth: '0',
      initialFocus: () => controller.modal.querySelector('[data-onboarding-action]:not([disabled])'),
      closeButton: false,
      closeOnEsc: false,
      closeOnOverlay: false,
      onBeforeClose: (reason) => [
        'programmatic',
        'settings-transition',
        'change-home',
        'add-source',
        'sample-guide',
        'complete',
      ].includes(reason),
      onClose: (reason) => {
        if (modalController === controller) modalController = null;
      },
    });
    controller.overlay.id = 'meldex-onboarding-overlay';
    controller.overlay.classList.add('meldex-onboarding-overlay');
    controller.overlay.dataset.e2eId = 'meldex-onboarding-overlay';
    controller.modal.classList.add('meldex-onboarding-modal');
    controller.modal.dataset.e2eId = 'meldex-onboarding-dialog';
    controller.modal.setAttribute('aria-describedby', 'meldex-onboarding-description');
    modalController = controller;
    return controller;
  }

  function render() {
    _setOnboardingActive(true);
    const controller = modalController?.isOpen?.() ? modalController : _createOnboardingController();
    const overlay = controller.overlay;
    const modal = controller.modal;
    const busy = !!state.busy;
    controller.header.querySelector('.gb-modal-title').textContent = _stepTitle(state.step);
    controller.body.innerHTML = `${_renderSteps()}<section class="gb-section gb-section--boxed meldex-onboarding-section">${_body()}</section>`;
    controller.footer.classList.add('btn-row', 'meldex-onboarding-actions');
    controller.footer.innerHTML = `<button type="button" class="gb-btn gb-btn-sm" data-e2e-id="onboarding-prev" data-onboarding-action="prev" ${state.step === 0 || busy ? 'disabled' : ''}>戻る</button>
      <button type="button" class="gb-btn gb-btn-sm gb-btn-primary primary" data-e2e-id="onboarding-primary" data-onboarding-action="next" ${busy ? 'disabled' : ''}>${busy ? '処理中...' : (state.step >= 3 ? '最初のノートを作って開始' : '次へ')}</button>`;
    const primaryButton = controller.footer.querySelector('[data-e2e-id="onboarding-primary"]');
    if (primaryButton) primaryButton.dataset.onboardingAction = state.step >= 3 ? 'finish' : 'next';
    modal.setAttribute('aria-busy', busy ? 'true' : 'false');
    replaceIcons(overlay);
    overlay.querySelectorAll('[data-onboarding-action]').forEach(button => {
      button.addEventListener('click', () => handleAction(button.dataset.onboardingAction, button));
    });
    if (!controller.isOpen()) controller.open();
    const focusTarget = overlay.querySelector('[data-onboarding-action]:not([disabled])') || modal;
    focusTarget?.focus?.({ preventScroll: true });
  }

  async function _openSettings(panel) {
    _removeOnboardingOverlayNow('settings-transition');
    if (typeof showSettingsModal === 'function') showSettingsModal({ panel: panel || '全般' });
  }

  async function _addSourceFolder() {
    if (typeof addOutlinerRootFromSettings === 'function') {
      await addOutlinerRootFromSettings();
      return;
    }
    _openSettings('全般');
  }

  async function _createFirstNote() {
    const result = await apiPost('/outliner/add', { type: 'page', label: '無題' });
    try {
      if (typeof loadOutliner === 'function') await loadOutliner();
      const node = result?.node || {};
      if (node.path && typeof openPage === 'function') openPage(node.label || '無題', node.path, { fromExplorer: true, skipAutoAppLayout: true });
    } catch (error) {
      if (typeof showStatus === 'function') showStatus('最初のノートは作成しました。表示の更新に失敗したため、フォルダツリーから開いてください。', true);
    }
    return result;
  }

  async function _changeHomeFolderForOnboarding() {
    if (typeof _changeHomeFolder === 'function') {
      await _changeHomeFolder();
      return _homePath();
    }
    let path = null;
    try {
      const res = await apiFetch('/add-outliner-root', { method: 'POST' });
      if (res.ok && res.path) path = res.path;
      else if (res.needManualInput && typeof _promptFolderPath === 'function') path = await _promptFolderPath();
    } catch {
      if (typeof _promptFolderPath === 'function') path = await _promptFolderPath();
    }
    if (!path) return _homePath();
    await apiPut('/home-folder', { path });
    window._homeFolderPath = path;
    if (typeof _homeFolderPath !== 'undefined') _homeFolderPath = path;
    try {
      const res = await apiFetch('/home-folder');
      if (typeof setSystemLockedItems === 'function') setSystemLockedItems(res.locked_paths || []);
      if (typeof _ensureLocksLoaded === 'function') await _ensureLocksLoaded({ force: true }).catch(() => {});
    } catch {}
    if (typeof renderHomeFolderTree === 'function') renderHomeFolderTree();
    if (typeof showStatus === 'function') showStatus('ホームフォルダを変更しました');
    return path;
  }

  function _bringConsentDialogToFront() {
    const overlay = document.getElementById('meldex-beta-consent-overlay');
    if (!overlay) return false;
    overlay.style.zIndex = '100060';
    overlay.querySelector('input, button, a')?.focus?.();
    return true;
  }

  function _showConsentFromOnboarding() {
    const shown = window.MeldexBetaRelease?.showConsentDialog?.({
      force: !window.MeldexBetaRelease?.hasConsent?.(),
      showInstallAfterConsent: false,
    });
    if (shown === false && window.MeldexBetaRelease?.hasConsent?.()) {
      if (typeof showStatus === 'function') showStatus('利用条件は確認済みです');
      return;
    }
    _bringConsentDialogToFront();
  }

  async function handleAction(action, triggerElement) {
    if (state.busy) return;
    if (action === 'prev') state.step = Math.max(0, state.step - 1);
    else if (action === 'next') state.step = Math.min(3, state.step + 1);
    else if (action === 'change-home') {
      _removeOnboardingOverlayNow('change-home');
      state.startup = state.startup || {};
      state.startup.homePath = await _changeHomeFolderForOnboarding();
      render();
      return;
    }
    else if (action === 'add-source') {
      _removeOnboardingOverlayNow('add-source');
      await _addSourceFolder();
      // ソースフォルダ追加でホームフォルダが個人ルート追従の対象になったかもしれない
      // ため、既存ホームの引き継ぎ提案（見つかれば）をここでも確認する
      // （gb-home-folder-sharing.js。設定画面と同じ判定・同じダイアログを再利用）。
      window.MeldexHomeFolderSharing?.loadHomeFolderSharingStatusForSettings?.();
      render();
      return;
    }
    else if (action === 'sample-download') { _openSampleDownload(); return; }
    else if (action === 'sample-install') { await window.MeldexSampleInstaller?.installNow?.({ trigger: 'onboarding-samples', homePath: _homePath() }); return; }
    else if (action === 'sample-guide') { _openSampleGuide(); return; }
    else if (action === 'consent') { _showConsentFromOnboarding(); return; }
    else if (action === 'about') { if (typeof showMeldexAboutDialog === 'function') showMeldexAboutDialog(triggerElement); return; }
    else if (action === 'finish') {
      if (window.MeldexBetaRelease && !window.MeldexBetaRelease.hasConsent?.()) {
        _showConsentFromOnboarding();
        return;
      }
      state.busy = true;
      render();
      try {
        await _createFirstNote();
        _setDone();
        _setOnboardingActive(false);
        _removeOnboardingOverlayNow('complete');
      } catch (error) {
        state.busy = false;
        window.MeldexDiagnostics?.showSupportDialog?.(error, { kind: 'onboarding-create-note' });
        render();
      }
      return;
    }
    render();
  }

  function showSourceSetupWizard(startup) {
    state = { step: 0, startup: startup || {}, sample: true, busy: false };
    _setOnboardingActive(true);
    if (typeof _hideStartupSplash === 'function') _hideStartupSplash();
    render();
    return true;
  }

  function handleStartupState(startup) {
    if (!shouldShow(startup)) return false;
    return showSourceSetupWizard(startup);
  }

  window.MeldexOnboarding = {
    shouldShow,
    handleStartupState,
    showSourceSetupWizard,
  };
})();
