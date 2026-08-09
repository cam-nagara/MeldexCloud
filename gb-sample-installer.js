(function () {
  'use strict';

  if (window.MeldexSampleInstaller) return;

  const DECISION_KEY_PREFIX = 'meldex-sample-install-decision-v1:';

  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _isCloudStorageMode() {
    return !!(_runtime()?.isBrowserDataMode?.()
      || ['browser', 'dropbox'].includes(document.body?.dataset?.cloudMode || ''));
  }

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function _workspaceId(context) {
    const mode = _isCloudStorageMode() ? 'cloud' : 'desktop';
    const state = _runtime()?.getWorkspaceState?.() || {};
    let path = _normalizePath(context?.homePath || state.path || state.homePath || window._homeFolderPath || '');
    if (!path) {
      try {
        const home = JSON.parse(localStorage.getItem('meldex-cloud-home-folder') || 'null');
        path = _normalizePath(home?.path || '');
      } catch {}
    }
    return mode + ':' + (path || 'default');
  }

  function _decisionKey(context) {
    return DECISION_KEY_PREFIX + _workspaceId(context);
  }

  function _writeDecision(context, value) {
    try {
      localStorage.setItem(_decisionKey(context), String(value || ''));
    } catch {}
  }

  function _sampleDownloadUrl() {
    const cfg = window.MeldexCloudRuntimeConfig || {};
    const url = String(cfg.samples?.downloadUrl || cfg.sampleDownloadUrl || '').trim();
    return /\.zip(?:[?#].*)?$/i.test(url) ? url : '';
  }

  function _showStatus(message, isError) {
    if (typeof showStatus === 'function') showStatus(message, !!isError);
  }

  function _resultMessage(result) {
    const copied = Number(result?.copied || 0);
    const updated = Number(result?.updated || 0);
    const skipped = Number(result?.skipped || 0);
    const failed = Number(result?.failed || 0);
    if (result?.ok === false) {
      const message = result?.message || result?.error || result?.detail?.message || result?.skipped || '';
      return message ? `サンプルファイルを追加できませんでした: ${message}` : 'サンプルファイルを追加できませんでした';
    }
    if (failed > 0) return `サンプルファイルの追加に失敗しました（失敗 ${failed} 件）`;
    if (copied > 0 && updated > 0) return `サンプルファイルを追加・更新しました（追加 ${copied} 件 / 更新 ${updated} 件）`;
    if (copied > 0) return `サンプルファイルを追加しました（追加 ${copied} 件）`;
    if (updated > 0) return `サンプルファイルを更新しました（更新 ${updated} 件）`;
    if (skipped > 0) return 'サンプルファイルは既に追加済みです';
    return 'サンプルファイルを確認しました';
  }

  async function installNow(context) {
    const ctx = context || {};
    try {
      if (_isCloudStorageMode()) {
        if (!window.MeldexCloudSampleSeed?.ensure) throw new Error('クラウド版サンプルの準備機能を読み込めませんでした');
        const result = await window.MeldexCloudSampleSeed.ensure({ background: false });
        if (result?.ok) _writeDecision(ctx, 'installed');
        if (typeof refreshOutliner === 'function') refreshOutliner()?.catch?.(() => {});
        _showStatus(_resultMessage(result), !result?.ok);
        return result;
      }
      if (typeof apiPost !== 'function') throw new Error('サンプル追加APIを呼び出せませんでした');
      const downloadUrl = _sampleDownloadUrl();
      const body = downloadUrl ? { downloadUrl } : {};
      const result = await apiPost('/samples/install', body, { silentError: true });
      if (result?.ok) _writeDecision(ctx, 'installed');
      if (typeof loadOutliner === 'function') loadOutliner()?.catch?.(() => {});
      if (typeof renderHomeFolderTree === 'function') {
        try { renderHomeFolderTree(); } catch {}
      }
      _showStatus(_resultMessage(result), !result?.ok);
      return result;
    } catch (error) {
      const result = { ok: false, error: error?.message || String(error) };
      _showStatus(_resultMessage(result), true);
      return result;
    }
  }

  // 旧版の呼び出し元との互換性のため名前だけ残す。確認ダイアログは表示せず、
  // ユーザーが「サンプルを追加」を押した時点で直ちに追加する。
  async function openPrompt(context) {
    return installNow(context || {});
  }

  async function maybePromptAfterSetup(context) {
    return { ok: false, skipped: 'automatic-prompt-disabled' };
  }

  function schedulePostSetupPrompt(context) {
    return { ok: false, skipped: 'automatic-prompt-disabled' };
  }

  function resetDecision(context) {
    try {
      localStorage.removeItem(_decisionKey(context || {}));
    } catch {}
  }

  window.MeldexSampleInstaller = {
    installNow,
    openPrompt,
    maybePromptAfterSetup,
    schedulePostSetupPrompt,
    resetDecision,
    _workspaceIdForTest: _workspaceId,
  };
})();
