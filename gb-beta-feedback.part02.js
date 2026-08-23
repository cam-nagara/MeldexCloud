    updateButton.textContent = '更新を確認';
    actions.append(saveGoogleButton, importGoogleButton, flushButton, diagnosticsButton, updateButton);
    section.appendChild(actions);
    container.appendChild(section);

    crash.input.addEventListener('change', () => {
      setCrashReportEnabled(crash.input.checked);
      if (typeof refreshMeldexAboutPanel === 'function') refreshMeldexAboutPanel(document);
    });
    telemetry.input.addEventListener('change', () => {
      setTelemetryEnabled(telemetry.input.checked);
      if (typeof refreshMeldexAboutPanel === 'function') refreshMeldexAboutPanel(document);
    });
    updates.input.addEventListener('change', () => {
      const current = window.MeldexBetaRelease?.getConsent?.() || {};
      if (!current.acceptedAt) {
        try { localStorage.setItem('meldex-update-checks-enabled', updates.input.checked ? '1' : '0'); } catch (_) {}
        if (typeof refreshMeldexAboutPanel === 'function') refreshMeldexAboutPanel(document);
        return;
      }
      window.MeldexBetaRelease?.saveConsent?.({
        acceptedAt: current.acceptedAt,
        crashReports: crash.input.checked,
        telemetry: telemetry.input.checked,
        updateChecks: updates.input.checked,
      });
      if (current.acceptedAt && typeof refreshMeldexAboutPanel === 'function') refreshMeldexAboutPanel(document);
    });
    function _describeDebuggerState(state) {
      if (!state?.configured) return '不具合報告の送信先: 未設定（この端末内の記録のみ）';
      const pending = Number(state.pending || 0);
      const failed = Number(state.failed || 0);
      const parts = ['不具合報告の送信先: 設定済み'];
      if (pending) parts.push(`送信待ち ${pending}件`);
      if (failed) parts.push(`送信できなかったもの ${failed}件`);
      return parts.join(' / ');
    }

    async function _refreshDebuggerState() {
      try {
        const settings = await getDebuggerSettings();
        debuggerUrlInput.value = settings.baseUrl || '';
        debuggerSlugInput.value = settings.projectSlug || '';
        const queue = settings.configured ? await getDebuggerQueue() : { configured: false };
        status.textContent = _describeDebuggerState({ ...settings, ...queue });
      } catch (error) {
        status.textContent = '送信先の状態を確認できませんでした';
      }
    }

    saveDebuggerButton.addEventListener('click', async () => {
      saveDebuggerButton.disabled = true;
      status.textContent = '送信先を保存中...';
      try {
        await saveDebuggerSettings(debuggerUrlInput.value, debuggerSlugInput.value);
        await _refreshDebuggerState();
      } catch (error) {
        status.textContent = '送信先を保存できませんでした: ' + (error?.message || error);
      } finally {
        saveDebuggerButton.disabled = false;
      }
    });
    flushDebuggerButton.addEventListener('click', async () => {
      flushDebuggerButton.disabled = true;
      status.textContent = '送信待ちを送信中...';
      try {
        const result = await flushDebuggerQueue();
        if (result?.skipped) {
          status.textContent = '送信先が未設定のため送信できません';
        } else {
          const failed = Number(result?.failedNow || 0);
          status.textContent = `送信 ${result?.sent || 0}件 / 残り ${result?.pending || 0}件`
            + (failed ? ` / 送信できなかったもの ${failed}件` : '')
            + (result?.rateLimited ? '（送信の間隔を空けています）' : '');
        }
      } catch (error) {
        status.textContent = '送信待ちを送信できませんでした: ' + (error?.message || error);
      } finally {
        flushDebuggerButton.disabled = false;
      }
    });
    _refreshDebuggerState();

    saveGoogleButton.addEventListener('click', () => {
      setGoogleWebAppUrl(googleUrlInput.value);
      setGoogleAdminToken(tokenInput.value);
      status.textContent = isGoogleConfigured()
        ? 'Google受信箱の設定を保存しました'
        : 'Google受信箱URLを確認してください';
    });
    importGoogleButton.addEventListener('click', async () => {
      importGoogleButton.disabled = true;
      status.textContent = 'Google受信箱を取り込んでいます...';
      try {
        setGoogleWebAppUrl(googleUrlInput.value);
        setGoogleAdminToken(tokenInput.value);
        const result = await importGoogleFeedbackEntries({ googleWebAppUrl: googleUrlInput.value, adminToken: tokenInput.value });
        if (result?.skipped) {
          status.textContent = result.reason === 'cloud-google-import-needs-desktop-server'
            ? 'Google受信箱の取込はデスクトップ版のMeldexサーバー起動時に実行できます'
            : 'Google受信箱を取り込めませんでした。設定を確認してください。';
        } else if (result?.ok) {
          const markWarning = result.markFailed ? ' / Google反映に未完了あり' : '';
          const limitWarning = result.limited ? ' / 未処理が残っています' : '';
          const partialWarning = result.partial ? ` / 途中停止${result.stopMessage ? ': ' + result.stopMessage : ''}` : '';
          const passText = result.passes ? ` / 処理 ${result.passes}回` : '';
          status.textContent = `Google受信箱の取込完了: 取得 ${result.fetched || 0}件 / 取込 ${result.imported || 0}件 / 重複 ${result.duplicate || 0}件 / 対象外 ${result.ignored || 0}件 / Google反映 ${result.marked || 0}件${passText}${markWarning}${limitWarning}${partialWarning}`;
        } else {
          status.textContent = 'Google受信箱を取り込めませんでした。' + (result?.message ? ' ' + result.message : '');
        }
      } catch (error) {
        status.textContent = 'Google受信箱の取込に失敗しました: ' + (error?.message || error);
      } finally {
        importGoogleButton.disabled = false;
      }
    });
    flushButton.addEventListener('click', async () => {
      flushButton.disabled = true;
      status.textContent = '送信中...';
      try {
        const result = await flushTelemetry('manual');
        if (result?.delivered) {
          status.textContent = '利用統計を送信しました';
        } else if (result?.skipped) {
          status.textContent = '利用統計は送信されませんでした。送信設定または接続を確認してください。';
        } else {
          status.textContent = '利用統計の送信先へ保存できませんでした。';
        }
      } catch (error) {
        status.textContent = '利用統計の送信に失敗しました: ' + (error?.message || error);
      } finally {
        flushButton.disabled = false;
      }
    });
    diagnosticsButton.addEventListener('click', async () => {
      diagnosticsButton.disabled = true;
      status.textContent = '診断情報を作成中...';
      try {
        await window.MeldexDiagnostics?.exportDiagnostics?.();
        status.textContent = '診断情報を保存しました';
      } catch (error) {
        status.textContent = '診断情報の作成に失敗しました: ' + (error?.message || error);
      } finally {
        diagnosticsButton.disabled = false;
      }
    });
    updateButton.addEventListener('click', async () => {
      updateButton.disabled = true;
      status.textContent = '更新を確認中...';
      try {
        const result = await window.MeldexUpdateChecker?.checkNow?.({ force: true });
        status.textContent = result?.ok ? '更新確認が完了しました' : '更新情報はありません';
      } catch (error) {
        status.textContent = '更新確認に失敗しました';
      } finally {
        updateButton.disabled = false;
      }
    });
  }

  function _installPwaHandlers() {
    if (_pwaHandlersInstalled) return;
    const internals = window.__MeldexPwaDataAccessInternals;
    const handlers = window.__MeldexPwaDataAccessExtensions = window.__MeldexPwaDataAccessExtensions || [];
    if (!internals || !Array.isArray(handlers)) return;
    _pwaHandlersInstalled = true;
    handlers.push(async ({ method, body, pathname }) => {
      if (method === 'POST' && pathname === '/beta/usage') return _writeCloudUsageSummary(body || {});
      if (method === 'POST' && pathname === '/beta/crash-report') return _writeCloudCrashReport(body || {});
      if (method === 'POST' && pathname === '/beta/feedback-template') return _writeCloudFeedbackSheet();
      if (method === 'POST' && pathname === '/beta/feedback/classify') return { ok: false, skipped: true, reason: 'cloud-classify-needs-desktop-server' };
      if (method === 'POST' && pathname === '/beta/feedback/google-import') return { ok: false, skipped: true, reason: 'cloud-google-import-needs-desktop-server' };
      return internals.NOT_HANDLED;
    });
  }

  function _bindSettingsObserver() {
    if (_settingsBound) return;
    _settingsBound = true;
    const callback = () => {
      const formContainer = document.getElementById('feedback-form-container');
      if (formContainer && !formContainer.dataset.feedbackFormRendered) {
        formContainer.dataset.feedbackFormRendered = '1';
        renderMeldexFeedbackPanel(document);
      }
      const container = document.getElementById('feedback-settings-container');
      if (container && !container.dataset.feedbackSettingsRendered) {
        container.dataset.feedbackSettingsRendered = '1';
        renderMeldexFeedbackSettingsPanel(document);
      }
    };
    const filter = mutation => Array.from(mutation.addedNodes || []).some(node => {
      if (node?.nodeType !== 1) return false;
      return node.id === 'feedback-form-container'
        || node.id === 'feedback-settings-container'
        || !!node.querySelector?.('#feedback-form-container, #feedback-settings-container');
    });
    if (window.GBMutationBus) {
      window.GBMutationBus.subscribe('beta-feedback-settings', { filter, callback, throttle: 50 });
    } else if (document.body) {
      const observer = new MutationObserver(callback);
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  async function _prepareFeedbackHistoryOnBoot(attempt = 0) {
    let prepared = false;
    try {
      await ensureFeedbackSheet({ open: false });
      prepared = true;
    } catch (_) {}
    try { await flushDebuggerQueue(); } catch (_) {}
    if (!prepared && attempt < 3) {
      setTimeout(() => { _prepareFeedbackHistoryOnBoot(attempt + 1); }, 5000 * (attempt + 1));
    }
  }

  function _boot() {
    _installPwaHandlers();
    _bindSettingsObserver();
    _configureCloudCrashReporter();
    if (isTelemetryEnabled()) startTelemetry();
    // 現在の画面を変えずに利用者向け履歴シートを準備し、前回オフラインや
    // 前回異常終了で残った既存outboxを送信・同じ行へ同期する。
    setTimeout(() => { _prepareFeedbackHistoryOnBoot(); }, 5000);
  }

  window.MeldexBetaFeedback = {
    CONSENT_KEY,
    CRASH_CONSENT_KEY,
    TELEMETRY_KEY,
    isCrashReportEnabled,
    isTelemetryEnabled,
    isGoogleConfigured,
    setCrashReportEnabled,
    setTelemetryEnabled,
    recordUsage,
    recordPerformance,
    recordLog,
    flushTelemetry,
    startTelemetry,
    stopTelemetry,
    sendGoogle,
    sendDebuggerReport,
    buildFeedbackSections,
    getDebuggerSettings,
    saveDebuggerSettings,
    getDebuggerQueue,
    flushDebuggerQueue,
    setGoogleWebAppUrl,
    setGoogleAdminToken,
    setFeedbackFormUrl,
    ensureFeedbackSheet,
    classifyFeedbackEntries,
    importGoogleFeedbackEntries,
    maybeSendFeedbackForm,
    renderMeldexFeedbackPanel,
    renderMeldexFeedbackSettingsPanel,
  };
  window.renderMeldexFeedbackPanel = renderMeldexFeedbackPanel;
  window.renderMeldexFeedbackSettingsPanel = renderMeldexFeedbackSettingsPanel;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot, { once: true });
  else _boot();
})();
