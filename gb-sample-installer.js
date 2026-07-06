(function () {
  'use strict';

  if (window.MeldexSampleInstaller) return;

  const DECISION_KEY_PREFIX = 'meldex-sample-install-decision-v1:';
  let _promptVisible = false;
  let _scheduled = false;
  let _retryTimer = 0;

  function _runtime() {
    return window.MeldexRuntimeAdapter;
  }

  function _isDropboxMode() {
    return !!(_runtime()?.isDropboxMode?.() || document.body?.dataset?.cloudMode === 'dropbox');
  }

  function _isBypassMode() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.has('smoke') || params.has('e2e') || params.get('single') === '1';
    } catch {
      return false;
    }
  }

  function _hasStartupDialogBlockingPrompt() {
    return !!document.querySelector('#meldex-beta-consent-overlay, #meldex-install-prompt-overlay, #meldex-install-help-overlay, .meldex-cloud-home-first-overlay, [data-draft-recovery-dialog="1"]');
  }

  function _retryPromptAfterStartupDialog(context) {
    if (_retryTimer) return;
    _retryTimer = setTimeout(() => {
      _retryTimer = 0;
      if (_hasStartupDialogBlockingPrompt()) {
        _retryPromptAfterStartupDialog(context);
        return;
      }
      maybePromptAfterSetup(context).catch((error) => {
        console.warn('[MeldexSampleInstaller] delayed prompt failed', error);
      });
    }, 700);
  }

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function _workspaceId(context) {
    const mode = _isDropboxMode() ? 'dropbox' : 'desktop';
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

  function _readDecision(context) {
    try {
      return localStorage.getItem(_decisionKey(context)) || '';
    } catch {
      return '';
    }
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

  async function _status(context) {
    if (_isDropboxMode()) {
      if (window.MeldexCloudSampleSeed?.status) {
        return await window.MeldexCloudSampleSeed.status();
      }
      return { ok: true, installed: false };
    }
    if (typeof apiFetch !== 'function') return { ok: false, installed: false };
    return await apiFetch('/samples/status', { silentError: true }).catch(() => ({ ok: false, installed: false }));
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
    if (_isDropboxMode()) {
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
  }

  function _modalShell() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay meldex-sample-install-overlay';
    overlay.dataset.sampleInstallPrompt = '1';
    overlay.style.zIndex = '100070';
    const icon = typeof lucide === 'function' ? lucide('archive', 18) : '';
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="meldex-sample-install-title" aria-describedby="meldex-sample-install-description" style="width:min(520px, calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;">
      <h2 id="meldex-sample-install-title" style="display:flex;align-items:center;gap:8px;margin:0 0 10px;">${icon}<span>サンプルファイルを追加しますか？</span></h2>
      <div id="meldex-sample-install-description">
        <p style="line-height:1.7;color:var(--fg2);margin:0 0 12px;">ホームフォルダにサンプル作品を追加できます。既にあるファイルは上書きしません。</p>
        <p style="line-height:1.7;color:var(--fg2);margin:0 0 16px;">あとから設定の「サンプルデータ」でも追加できます。</p>
      </div>
      <div class="gb-section-desc" data-sample-install-status role="status" aria-live="polite" style="min-height:1.4em;margin-bottom:12px;"></div>
      <div class="btn-row" style="justify-content:flex-end;">
        <button type="button" data-sample-action="later" data-e2e-id="sample-install-later">あとで</button>
        <button type="button" class="primary" data-sample-action="install" data-e2e-id="sample-install-confirm">はい、追加する</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    window.GBModalShell?.enhanceOverlay?.(overlay);
    if (typeof replaceIcons === 'function') replaceIcons(overlay);
    return overlay;
  }

  async function openPrompt(context) {
    const ctx = context || {};
    if (_promptVisible || (!ctx.force && _isBypassMode())) return { ok: false, skipped: 'busy-or-bypass' };
    if (!ctx.force && _hasStartupDialogBlockingPrompt()) {
      _retryPromptAfterStartupDialog(ctx);
      return { ok: false, skipped: 'blocked-dialog' };
    }
    _promptVisible = true;
    return new Promise((resolve) => {
      const overlay = _modalShell();
      const status = overlay.querySelector('[data-sample-install-status]');
      const installButton = overlay.querySelector('[data-sample-action="install"]');
      const laterButton = overlay.querySelector('[data-sample-action="later"]');
      const decline = () => {
        _writeDecision(ctx, 'declined');
        close({ ok: true, declined: true });
      };
      const onKeydown = (ev) => {
        if (ev.key !== 'Escape' || installButton.disabled) return;
        ev.preventDefault();
        ev.stopPropagation();
        decline();
      };
      const close = (result) => {
        _promptVisible = false;
        document.removeEventListener('keydown', onKeydown, true);
        overlay.remove();
        resolve(result || { ok: true });
      };
      document.addEventListener('keydown', onKeydown, true);
      laterButton.addEventListener('click', decline);
      installButton.addEventListener('click', async () => {
        installButton.disabled = true;
        laterButton.disabled = true;
        status.textContent = 'サンプルファイルを追加しています...';
        try {
          const result = await installNow(ctx);
          status.textContent = _resultMessage(result);
          if (result?.ok) {
            setTimeout(() => close(result), 700);
            return;
          }
          installButton.disabled = false;
          laterButton.disabled = false;
          _showStatus(status.textContent, true);
        } catch (error) {
          status.textContent = error?.message || String(error);
          installButton.disabled = false;
          laterButton.disabled = false;
          _showStatus(status.textContent, true);
        }
      });
      installButton.focus();
    });
  }

  async function maybePromptAfterSetup(context) {
    const ctx = context || {};
    if (_isBypassMode()) return { ok: false, skipped: 'bypass' };
    const decision = _readDecision(ctx);
    if (decision === 'declined' || decision === 'installed') return { ok: false, skipped: decision };
    const status = await _status(ctx);
    if (status?.installed) {
      _writeDecision(ctx, 'installed');
      return { ok: true, skipped: 'already-installed' };
    }
    return openPrompt(ctx);
  }

  function schedulePostSetupPrompt(context) {
    if (_scheduled || _isBypassMode()) return;
    _scheduled = true;
    setTimeout(() => {
      _scheduled = false;
      maybePromptAfterSetup(context).catch((error) => {
        console.warn('[MeldexSampleInstaller] prompt failed', error);
      });
    }, 600);
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
