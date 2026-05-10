(function () {
  'use strict';

  if (window.MeldexOnboarding) return;

  const DONE_KEY = 'meldex-onboarding-complete-v1';
  let state = { step: 0, startup: null, sample: true };

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
    document.getElementById('meldex-onboarding-overlay')?.remove();
    if (!window.MeldexRuntimeAdapter?.isDropboxMode?.() && typeof openPage === 'function') {
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

  function _renderSteps() {
    return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">
      ${[0, 1, 2, 3].map(i => `<div style="display:flex;align-items:center;gap:6px;">
        <span style="width:24px;height:24px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;border:1px solid ${i === state.step ? 'var(--accent)' : 'var(--border)'};background:${i === state.step ? 'var(--accent-bg)' : 'var(--bg3)'};color:${i === state.step ? 'var(--accent)' : 'var(--fg2)'};">${i + 1}</span>
        <span style="color:${i === state.step ? 'var(--fg)' : 'var(--fg2)'};">${_stepLabel(i)}</span>
      </div>`).join('')}
    </div>`;
  }

  function _body() {
    const home = _homePath() || 'Documents/Meldex';
    if (state.step === 0) {
      return `<h2 style="margin:0 0 10px;">Meldexの準備をします</h2>
        <p style="line-height:1.7;color:var(--fg2);">最初に、作品や設定を保存する場所を確認します。あとから設定で変更できます。</p>`;
    }
    if (state.step === 1) {
      return `<h2 style="margin:0 0 10px;">データの保存先</h2>
        <p style="line-height:1.7;color:var(--fg2);">現在のホームフォルダは次の場所です。</p>
        <div style="padding:10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);word-break:break-all;">${esc(home)}</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
          <button class="gb-btn gb-btn-sm" data-onboarding-action="change-home">${lucide('folderOpen',14)} ホームフォルダを変更</button>
          <button class="gb-btn gb-btn-sm" data-onboarding-action="add-source">${lucide('folderPlus',14)} ソースフォルダを追加</button>
        </div>
        <p style="line-height:1.7;color:var(--fg2);">迷った場合は、このまま進めて構いません。</p>`;
    }
    if (state.step === 2) {
      return `<h2 style="margin:0 0 10px;">サンプルデータ</h2>
        <p style="line-height:1.7;color:var(--fg2);">必要な場合だけ、ホームフォルダにサンプル作品を追加できます。既にあるファイルは上書きしません。</p>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
          <button class="gb-btn gb-btn-sm" data-onboarding-action="sample-install">${lucide('archive',14)} サンプルを追加</button>
          <button class="gb-btn gb-btn-sm" data-onboarding-action="sample-guide">${lucide('bookOpen',14)} 取り込み手順</button>
        </div>`;
    }
    return `<h2 style="margin:0 0 10px;">同意と最初のノート</h2>
      <p style="line-height:1.7;color:var(--fg2);">ベータ版の利用条件を確認し、最初の無題ノートを作成して開始します。</p>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button class="gb-btn gb-btn-sm" data-onboarding-action="consent">${lucide('shieldCheck',14)} 利用条件を確認</button>
        <button class="gb-btn gb-btn-sm" data-onboarding-action="about">${lucide('info',14)} Meldexについて</button>
      </div>`;
  }

  function _overlay() {
    let overlay = document.getElementById('meldex-onboarding-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'meldex-onboarding-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'z-index:100040;background:var(--bg);';
    document.body.appendChild(overlay);
    return overlay;
  }

  function render() {
    const overlay = _overlay();
    overlay.innerHTML = `<div class="modal" style="width:min(680px, calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;">
      ${_renderSteps()}
      <section class="gb-section gb-section--boxed">${_body()}</section>
      <div class="btn-row" style="margin-top:12px;">
        <button data-onboarding-action="prev" ${state.step === 0 ? 'disabled' : ''}>戻る</button>
        <button class="primary" data-onboarding-action="${state.step >= 3 ? 'finish' : 'next'}">${state.step >= 3 ? '最初のノートを作って開始' : '次へ'}</button>
      </div>
    </div>`;
    replaceIcons(overlay);
    overlay.querySelector('#meldex-onboarding-sample')?.addEventListener('change', event => {
      state.sample = !!event.target.checked;
    });
    overlay.querySelectorAll('[data-onboarding-action]').forEach(button => {
      button.addEventListener('click', () => handleAction(button.dataset.onboardingAction));
    });
  }

  async function _openSettings(panel) {
    document.getElementById('meldex-onboarding-overlay')?.remove();
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
    let result = null;
    try {
      result = await apiPost('/outliner/add', { type: 'page', label: '無題' });
      if (typeof loadOutliner === 'function') await loadOutliner();
      const node = result?.node || {};
      if (node.path && typeof openPage === 'function') openPage(node.label || '無題', node.path, { fromExplorer: true, skipAutoAppLayout: true });
    } catch (error) {
      window.MeldexDiagnostics?.showSupportDialog?.(error, { kind: 'onboarding-create-note' });
      throw error;
    }
  }

  async function handleAction(action) {
    if (action === 'prev') state.step = Math.max(0, state.step - 1);
    else if (action === 'next') state.step = Math.min(3, state.step + 1);
    else if (action === 'change-home') {
      document.getElementById('meldex-onboarding-overlay')?.remove();
      if (typeof _changeHomeFolder === 'function') await _changeHomeFolder();
      state.startup.homePath = _homePath();
      render();
      return;
    }
    else if (action === 'add-source') {
      document.getElementById('meldex-onboarding-overlay')?.remove();
      await _addSourceFolder();
      render();
      return;
    }
    else if (action === 'sample-download') { _openSampleDownload(); return; }
    else if (action === 'sample-install') { await window.MeldexSampleInstaller?.openPrompt?.({ force: true, trigger: 'onboarding-samples', homePath: _homePath() }); return; }
    else if (action === 'sample-guide') { _openSampleGuide(); return; }
    else if (action === 'consent') { window.MeldexBetaRelease?.showConsentDialog?.({ force: !window.MeldexBetaRelease?.hasConsent?.() }); return; }
    else if (action === 'about') { if (typeof showMeldexAboutDialog === 'function') showMeldexAboutDialog(); return; }
    else if (action === 'finish') {
      if (window.MeldexBetaRelease && !window.MeldexBetaRelease.hasConsent?.()) {
        window.MeldexBetaRelease.showConsentDialog?.({ force: true });
        return;
      }
      await _createFirstNote();
      _setDone();
      document.getElementById('meldex-onboarding-overlay')?.remove();
      return;
    }
    render();
  }

  function showSourceSetupWizard(startup) {
    state = { step: 0, startup: startup || {}, sample: true };
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
