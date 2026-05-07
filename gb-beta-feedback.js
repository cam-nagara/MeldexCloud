(function () {
  'use strict';

  if (window.MeldexBetaFeedback) return;

  const releaseConfig = window.MeldexReleaseConfig || {};
  const feedbackConfig = releaseConfig.betaFeedback || {};
  const CONSENT_KEY = window.MeldexBetaRelease?.CONSENT_KEY || 'meldex-beta-consent-v1';
  const CRASH_CONSENT_KEY = window.MeldexBetaRelease?.CRASH_CONSENT_KEY || 'meldex-crash-report-consent';
  const TELEMETRY_KEY = window.MeldexBetaRelease?.TELEMETRY_KEY || 'meldex-telemetry-enabled';
  const SESSION_STORAGE_KEY = 'meldex-beta-telemetry-session-id';
  const LAUNCH_COUNT_KEY = 'meldex-beta-telemetry-launch-count';
  const LAST_SUMMARY_KEY = 'meldex-beta-telemetry-last-summary';
  const FLUSH_INTERVAL_MS = 60 * 1000;
  const CLOUD_CRASH_DIR = '_meldex/beta/crash-reports';
  const CLOUD_USAGE_DIR = '_meldex/beta/usage';
  const USAGE_DB_DIR = '利用統計';
  const USAGE_DB_NOTE = '利用統計/利用統計.md';
  const FEEDBACK_DB_DIR = 'Meldexフィードバック';
  const FEEDBACK_DB_NOTE = 'Meldexフィードバック/Meldexフィードバック.md';
  const FEEDBACK_FORM_URL_KEY = 'meldex-beta-feedback-form-url';

  let _session = null;
  let _flushTimer = null;
  let _settingsBound = false;
  let _pwaHandlersInstalled = false;

  function _safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function _safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function _safeSessionGet(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function _safeSessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) {}
  }

  function _nowIso() {
    return new Date().toISOString();
  }

  function _today() {
    return _nowIso().slice(0, 10);
  }

  function _randomId(prefix) {
    if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function _isBypassMode() {
    try {
      const params = new URLSearchParams(location.search);
      return params.has('smoke') || params.has('e2e') || params.get('single') === '1';
    } catch (_) {
      return false;
    }
  }

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '');
  }

  function _joinPath() {
    return Array.from(arguments).map(_normalizePath).filter(Boolean).join('/');
  }

  function _safeFilePart(value, fallback) {
    return String(value || fallback || 'item')
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || fallback || 'item';
  }

  function _yamlScalar(value) {
    return JSON.stringify(String(value == null ? '' : value));
  }

  function _jsonLine(payload) {
    return JSON.stringify(payload, null, 0) + '\n';
  }

  function isCrashReportEnabled() {
    return _readConsentFlag(CRASH_CONSENT_KEY, 'crashReports');
  }

  function isTelemetryEnabled() {
    return _readConsentFlag(TELEMETRY_KEY, 'telemetry');
  }

  function _readConsent() {
    try { return JSON.parse(_safeGet(CONSENT_KEY) || 'null'); } catch (_) { return null; }
  }

  function _readConsentFlag(storageKey, consentField) {
    const stored = _safeGet(storageKey);
    if (stored === '1') return true;
    if (stored === '0') return false;
    return _readConsent()?.[consentField] === true;
  }

  function _writeConsentFromToggles() {
    const payload = {
      schema: 1,
      acceptedAt: _readConsent()?.acceptedAt || _nowIso(),
      betaNoticeAccepted: true,
      crashReports: isCrashReportEnabled(),
      telemetry: isTelemetryEnabled(),
    };
    _safeSet(CONSENT_KEY, JSON.stringify(payload));
    return payload;
  }

  function setCrashReportEnabled(enabled) {
    _safeSet(CRASH_CONSENT_KEY, enabled ? '1' : '0');
    _writeConsentFromToggles();
  }

  function setTelemetryEnabled(enabled) {
    _safeSet(TELEMETRY_KEY, enabled ? '1' : '0');
    _writeConsentFromToggles();
    if (enabled) startTelemetry();
    else stopTelemetry();
  }

  function _getLaunchCount() {
    const current = parseInt(_safeGet(LAUNCH_COUNT_KEY) || '0', 10) || 0;
    return Math.max(0, current);
  }

  function _setLaunchCount(value) {
    _safeSet(LAUNCH_COUNT_KEY, String(Math.max(0, Number(value) || 0)));
  }

  function _getSession() {
    if (_session) return _session;
    let sessionId = _safeSessionGet(SESSION_STORAGE_KEY);
    if (!sessionId) {
      sessionId = _randomId('session');
      _safeSessionSet(SESSION_STORAGE_KEY, sessionId);
    }
    _session = {
      sessionId,
      startedAt: _nowIso(),
      launchCount: _getLaunchCount(),
      operationCounts: {},
      toolCounts: {},
      featureCounts: {},
      errorCount: 0,
      warningCount: 0,
      performance: {},
      flushedAt: '',
    };
    return _session;
  }

  function _inc(map, key, amount) {
    const safeKey = String(key || 'unknown').slice(0, 120);
    map[safeKey] = (Number(map[safeKey]) || 0) + (Number(amount) || 1);
  }

  function recordUsage(category, name, amount) {
    if (!isTelemetryEnabled() || _isBypassMode()) return;
    const session = _getSession();
    const bucket = category === 'tool' ? session.toolCounts : category === 'feature' ? session.featureCounts : session.operationCounts;
    _inc(bucket, name, amount || 1);
  }

  function _classifyTool(target) {
    const data = target?.closest?.('[data-tool], [data-view], [data-panel], [data-tab]');
    const explicit = data?.dataset?.tool || data?.dataset?.view || data?.dataset?.panel || data?.dataset?.tab || '';
    if (explicit) return explicit;
    try {
      if (window.state?.view) return window.state.view;
    } catch (_) {}
    const toolbar = target?.closest?.('#app-toolbar, #sidebar, #right-panel, .gb-panel, .modal');
    if (!toolbar) return 'global';
    return toolbar.id || toolbar.className || 'global';
  }

  function _actionName(target) {
    const actionEl = target?.closest?.('[data-action], [data-sn-action], [data-bd-action], button, [role="button"], .settings-tab, .gb-inner-tab');
    if (!actionEl) return '';
    return actionEl.dataset?.action
      || actionEl.dataset?.snAction
      || actionEl.dataset?.bdAction
      || actionEl.dataset?.tab
      || actionEl.id
      || actionEl.getAttribute?.('aria-label')
      || actionEl.getAttribute?.('title')
      || String(actionEl.textContent || '').trim()
      || actionEl.tagName;
  }

  function _installUsageListeners() {
    if (document.__MeldexBetaUsageListenersInstalled) return;
    document.__MeldexBetaUsageListenersInstalled = true;
    document.addEventListener('click', (event) => {
      if (!isTelemetryEnabled() || _isBypassMode()) return;
      const name = _actionName(event.target);
      if (!name) return;
      recordUsage('operation', name);
      recordUsage('tool', _classifyTool(event.target));
    }, true);
    window.addEventListener('load', () => {
      const nav = performance.getEntriesByType?.('navigation')?.[0];
      if (nav) {
        recordPerformance('pageLoadMs', Math.round(nav.loadEventEnd || performance.now()));
        recordPerformance('domInteractiveMs', Math.round(nav.domInteractive || 0));
      }
    }, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushTelemetry('visibility-hidden');
    });
    window.addEventListener('pagehide', () => flushTelemetry('pagehide'));
  }

  function recordPerformance(name, value) {
    if (!isTelemetryEnabled() || _isBypassMode()) return;
    const session = _getSession();
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const current = session.performance[name] || { count: 0, total: 0, max: 0 };
    current.count += 1;
    current.total += numeric;
    current.max = Math.max(current.max, numeric);
    session.performance[name] = current;
  }

  function _buildSummary(reason) {
    const session = _getSession();
    return {
      kind: 'usage',
      reason: reason || 'manual',
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      flushedAt: _nowIso(),
      launchCount: session.launchCount,
      operationCounts: { ...session.operationCounts },
      toolCounts: { ...session.toolCounts },
      featureCounts: { ...session.featureCounts },
      errorCount: session.errorCount,
      warningCount: session.warningCount,
      performance: { ...session.performance },
      runtimeMode: window.MeldexRuntimeAdapter?.getMode?.() || 'legacy',
      cloudMode: !!window.MeldexRuntimeAdapter?.isDropboxMode?.(),
      userAgent: navigator.userAgent || '',
    };
  }

  function _resetVolatileCounters() {
    if (!_session) return;
    _session.operationCounts = {};
    _session.toolCounts = {};
    _session.featureCounts = {};
    _session.errorCount = 0;
    _session.warningCount = 0;
    _session.performance = {};
    _session.flushedAt = _nowIso();
  }

  async function _postJson(path, payload, keepalive) {
    const response = await fetch((typeof API_BASE === 'string' ? API_BASE : '/api') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: !!keepalive,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json().catch(() => ({ ok: true }));
  }

  function _googleUrl() {
    return String(feedbackConfig.googleWebAppUrl || '').trim();
  }

  function isGoogleConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\//.test(_googleUrl());
  }

  async function sendGoogle(kind, payload) {
    if (!isGoogleConfigured()) return { ok: false, skipped: true, reason: 'google-url-not-configured' };
    const body = {
      app: 'Meldex',
      kind,
      secret: feedbackConfig.googleSharedSecret || '',
      sheet: kind === 'crash' ? feedbackConfig.crashSheetName : kind === 'usage' ? feedbackConfig.usageSheetName : feedbackConfig.feedbackSheetName,
      payload,
      sentAt: _nowIso(),
    };
    await fetch(_googleUrl(), {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
    return { ok: true, opaque: true };
  }

  async function _appendProviderJsonLine(provider, filePath, payload) {
    let existing = '';
    try { existing = await provider.readText(filePath); } catch (_) { existing = ''; }
    const next = (existing || '') + _jsonLine(payload);
    await provider.writeText(filePath, next);
    return { ok: true, path: filePath };
  }

  function _usageDbFrontmatter() {
    return [
      '---',
      'type: settings-db',
      'category: 利用統計',
      'roles:',
      '- beta-usage',
      'property_types:',
      '  種別:',
      '    type: select',
      '  報告日:',
      '    type: date',
      '  セッション:',
      '    type: text',
      '  起動回数:',
      '    type: number',
      '  操作数:',
      '    type: number',
      '  エラー数:',
      '    type: number',
      '  環境:',
      '    type: text',
      '---',
      '# 利用統計',
      '',
    ].join('\n');
  }

  function _feedbackDbFrontmatter() {
    return [
      '---',
      'type: settings-db',
      'category: Meldexフィードバック',
      'roles:',
      '- beta-feedback',
      'property_types:',
      '  件名:',
      '    type: text',
      '  種別:',
      '    type: select',
      '    options: [未分類, バグ, 要望, 質問, その他]',
      '  内容:',
      '    type: long-text',
      '  再現手順:',
      '    type: long-text',
      '  期待する動作:',
      '    type: long-text',
      '  画面/機能:',
      '    type: text',
      '  重要度:',
      '    type: select',
      '    options: [低, 中, 高]',
      '  お名前:',
      '    type: text',
      '  連絡先:',
      '    type: text',
      '  環境:',
      '    type: text',
      '  送信日:',
      '    type: date',
      '  フィードバック送信日時:',
      '    type: date',
      '    autoFill:',
      '      - trigger: create',
      '        value: $now',
      '        overwrite: if_empty',
      '  Meldex受信日時:',
      '    type: date',
      '    autoFill:',
      '      - trigger: create',
      '        value: $now',
      '        overwrite: if_empty',
      '  仕分け状態:',
      '    type: select',
      '    options: [未処理, 仕分け済み, 転記済み, 転記不要]',
      '  対応状況:',
      '    type: select',
      '    options: [未確認, 対応中, 修正済み, 対応不要, 保留, 却下]',
      '  修正済み:',
      '    type: checkbox',
      '  修正日時:',
      '    type: date',
      '  修正バージョン:',
      '    type: text',
      '  関連デバッグエントリ:',
      '    type: text',
      '  LLM分類理由:',
      '    type: long-text',
      '  転記先:',
      '    type: text',
      'publish:',
      '  form_submit_enabled: false',
      '  form_submit_token: ""',
      '  form_entity_name_source:',
      '    kind: property',
      '    property: 件名',
      '---',
      '# Meldexフィードバック',
      '',
    ].join('\n');
  }

  function _feedbackFormConfig() {
    return {
      id: 'meldex-beta-feedback-form',
      fields: ['件名', '種別', '内容', '再現手順', '期待する動作', '画面/機能', '重要度', 'お名前', '連絡先', '環境'],
      required: ['件名', '内容'],
      descriptions: {
        内容: '気づいたこと、不具合、改善してほしい点をできるだけ具体的に書いてください。',
        再現手順: '不具合の場合、起きるまでの操作順を書いてください。',
        環境: 'Windows版 / Cloud版 / iPad など、分かる範囲で入力してください。',
      },
      placeholders: {
        件名: '例: フォーム送信後に画面が戻らない',
        内容: '何が起きたか、困っていること',
        再現手順: '1. ...\n2. ...',
        期待する動作: '本来こう動いてほしい',
      },
      labels: {},
      submitLabel: 'フィードバックを送信',
      successMessage: 'フィードバックを送信しました。ありがとうございます。',
      headerTitle: 'Meldex フィードバック',
      headerDescription: 'ベータ版の不具合・要望・気づいたことを送信できます。お名前と連絡先は任意です。',
      mode: 'answer',
      entityNameProp: '件名',
      betaFeedbackRelay: true,
    };
  }

  function _propYaml(name, value) {
    return [
      `  ${name}:`,
      `  - value: ${_yamlScalar(value)}`,
      '    status: 採用',
    ].join('\n');
  }

  function _usageEntryMarkdown(summary) {
    const now = _nowIso();
    const operationTotal = Object.values(summary.operationCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const entry = [
      '---',
      'type: settings-entry',
      'category: 利用統計',
      'properties:',
      _propYaml('種別', '利用統計'),
      _propYaml('報告日', _today()),
      _propYaml('セッション', summary.sessionId || ''),
      _propYaml('起動回数', summary.launchCount || 0),
      _propYaml('操作数', operationTotal),
      _propYaml('エラー数', summary.errorCount || 0),
      _propYaml('環境', summary.runtimeMode || ''),
      `created: ${_yamlScalar(summary.startedAt || now)}`,
      `modified: ${_yamlScalar(now)}`,
      '---',
      '',
      '```json',
      JSON.stringify(summary, null, 2),
      '```',
      '',
    ];
    return entry.join('\n');
  }

  async function _writeCloudUsageSummary(summary) {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new Error('Dropbox provider が未初期化です');
    const sessionId = _safeFilePart(summary.sessionId || 'session', 'session');
    const jsonlPath = _joinPath(CLOUD_USAGE_DIR, `${_today()}.jsonl`);
    await _appendProviderJsonLine(provider, jsonlPath, summary);
    try { await provider.statPath(USAGE_DB_NOTE); }
    catch (_) { await provider.writeText(USAGE_DB_NOTE, _usageDbFrontmatter()); }
    const entryPath = _joinPath(USAGE_DB_DIR, `usage_${_today()}_${sessionId}.md`);
    await provider.writeText(entryPath, _usageEntryMarkdown(summary));
    return { ok: true, path: entryPath, jsonlPath };
  }

  async function _writeCloudCrashReport(payload) {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new Error('Dropbox provider が未初期化です');
    const filePath = _joinPath(CLOUD_CRASH_DIR, `${_today()}.jsonl`);
    return _appendProviderJsonLine(provider, filePath, payload);
  }

  function _feedbackFormUrl() {
    return String(feedbackConfig.feedbackFormUrl || _safeGet(FEEDBACK_FORM_URL_KEY) || '').trim();
  }

  function setFeedbackFormUrl(url) {
    _safeSet(FEEDBACK_FORM_URL_KEY, String(url || '').trim());
  }

  function _feedbackViewConfig() {
    return {
      currentViewIdx: 0,
      savedViews: [
        { name: 'フィードバックフォーム', viewMode: 'form', typeSpecific: { form: { formConfig: _feedbackFormConfig() } } },
        {
          name: '送信履歴',
          viewMode: 'pivot',
          hiddenCols: ['連絡先', 'LLM分類理由'],
          pinnedCols: ['件名', '対応状況'],
          colOrder: ['件名', '対応状況', '修正済み', '種別', '重要度', '画面/機能', '送信日', '修正日時', '修正バージョン', '転記先'],
        },
      ],
    };
  }

  function _applyFeedbackViewConfig(result) {
    const dbPath = String(result?.dbPath || FEEDBACK_DB_DIR).replace(/\\/g, '/');
    try {
      const key = typeof getDbViewConfigStorageKey === 'function'
        ? getDbViewConfigStorageKey(dbPath)
        : 'dbViewConfig:' + dbPath;
      const current = JSON.parse(localStorage.getItem(key) || '{}') || {};
      const next = { ...current, ...(result?.viewConfig || _feedbackViewConfig()) };
      delete next.currentViewMode;
      localStorage.setItem(key, JSON.stringify(next));
    } catch (_) {}
    return dbPath;
  }

  async function _writeCloudFeedbackSheet() {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new Error('Dropbox provider が未初期化です');
    try { await provider.statPath(FEEDBACK_DB_NOTE); }
    catch (_) { await provider.writeText(FEEDBACK_DB_NOTE, _feedbackDbFrontmatter()); }
    return {
      ok: true,
      dbPath: FEEDBACK_DB_DIR,
      notePath: FEEDBACK_DB_NOTE,
      role: 'beta-feedback',
      formConfig: _feedbackFormConfig(),
      viewConfig: _feedbackViewConfig(),
    };
  }

  async function ensureFeedbackSheet() {
    const result = window.MeldexRuntimeAdapter?.isDropboxMode?.()
      ? await _writeCloudFeedbackSheet()
      : await _postJson('/beta/feedback-template', {}, false);
    const dbPath = _applyFeedbackViewConfig(result);
    if (typeof selectDatabase === 'function') {
      try { await selectDatabase(dbPath, undefined, { silent: true }); } catch (_) {}
    }
    return { ...result, dbPath };
  }

  async function classifyFeedbackEntries() {
    if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) {
      return { ok: false, skipped: true, reason: 'cloud-classify-needs-desktop-server' };
    }
    return _postJson('/beta/feedback/classify', {}, false);
  }

  function _isFeedbackFormPayload(data) {
    const cfg = data?.formConfig || {};
    const dbPath = String(data?.dbPath || '').replace(/\\/g, '/');
    const title = String(cfg.headerTitle || '');
    return !!(
      cfg.betaFeedbackRelay
      || dbPath.includes(FEEDBACK_DB_DIR)
      || title.includes('フィードバック')
    );
  }

  async function maybeSendFeedbackForm(data) {
    if (!_isFeedbackFormPayload(data)) return { ok: false, skipped: true, reason: 'not-feedback-form' };
    const payload = {
      dbPath: data.dbPath || '',
      formId: data.formConfig?.id || '',
      name: data.name || '',
      fields: data.fields || {},
      source: data.source || 'meldex-form',
      sentAt: _nowIso(),
      runtimeMode: window.MeldexRuntimeAdapter?.getMode?.() || 'legacy',
      userAgent: navigator.userAgent || '',
    };
    return sendGoogle('feedback', payload);
  }

  async function flushTelemetry(reason) {
    if (!isTelemetryEnabled() || _isBypassMode() || !_session) return { ok: false, skipped: true };
    const summary = _buildSummary(reason || 'manual');
    _safeSet(LAST_SUMMARY_KEY, JSON.stringify(summary));
    const tasks = [];
    tasks.push(_postJson('/beta/usage', summary, reason !== 'manual'));
    tasks.push(sendGoogle('usage', summary));
    const results = await Promise.allSettled(tasks);
    if (results.some(item => item.status === 'fulfilled')) _resetVolatileCounters();
    return { ok: true, results };
  }

  function startTelemetry() {
    if (_isBypassMode() || !isTelemetryEnabled()) return;
    const session = _getSession();
    if (!session._launchRecorded) {
      session._launchRecorded = true;
      const nextLaunchCount = _getLaunchCount() + 1;
      _setLaunchCount(nextLaunchCount);
      session.launchCount = nextLaunchCount;
      recordUsage('feature', 'launch');
    }
    _installUsageListeners();
    if (!_flushTimer) _flushTimer = setInterval(() => flushTelemetry('interval'), FLUSH_INTERVAL_MS);
  }

  function stopTelemetry() {
    if (_flushTimer) clearInterval(_flushTimer);
    _flushTimer = null;
  }

  function recordLog(level, data) {
    const payload = {
      kind: 'crash',
      level: String(level || 'error'),
      sessionId: _getSession().sessionId,
      time: _nowIso(),
      version: window.__meldexVersionCache?.version || '',
      runtimeMode: window.MeldexRuntimeAdapter?.getMode?.() || 'legacy',
      ...data,
    };
    if (isTelemetryEnabled()) {
      const session = _getSession();
      if (payload.level === 'error') session.errorCount += 1;
      else session.warningCount += 1;
    }
    if (!isCrashReportEnabled() || _isBypassMode()) return;
    if (window.MeldexRuntimeAdapter?.isDropboxMode?.()) {
      _writeCloudCrashReport(payload).catch(() => {});
    } else {
      _postJson('/beta/crash-report', payload, true).catch(() => {});
    }
    sendGoogle('crash', payload).catch(() => {});
  }

  function _checkbox(id, label, checked) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!checked;
    const wrapper = document.createElement('label');
    wrapper.className = 'gb-check';
    wrapper.appendChild(input);
    const text = document.createElement('span');
    text.textContent = label;
    wrapper.appendChild(text);
    return { wrapper, input };
  }

  function renderMeldexFeedbackPanel(root) {
    const scope = root?.querySelector ? root : document;
    const container = scope.querySelector('#feedback-form-container');
    if (!container) return;
    container.dataset.feedbackFormRendered = '1';
    container.replaceChildren();

    const section = document.createElement('section');
    section.className = 'gb-section gb-section--boxed';
    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.textContent = 'フィードバック';
    const desc = document.createElement('div');
    desc.className = 'gb-section-desc';
    desc.textContent = 'ベータ版の不具合・要望・質問を送信するためのフォームと、Meldex内の保管シートを管理します。';
    section.append(title, desc);

    const urlRow = document.createElement('label');
    urlRow.className = 'gb-field-row';
    const urlLabel = document.createElement('span');
    urlLabel.className = 'gb-label';
    urlLabel.textContent = 'フォームURL';
    const urlInput = document.createElement('input');
    urlInput.id = 'settings-beta-feedback-form-url';
    urlInput.className = 'gb-input';
    urlInput.placeholder = '公開フォームのURLを貼り付け';
    urlInput.value = _feedbackFormUrl();
    urlRow.append(urlLabel, urlInput);
    section.appendChild(urlRow);

    const status = document.createElement('div');
    status.id = 'settings-beta-feedback-status';
    status.className = 'gb-section-desc';
    status.textContent = _feedbackFormUrl()
      ? '設定済みのフォームURLを利用できます。'
      : '保管シートを作成し、フォームビューを公開した後、そのURLをここに保存してください。';
    section.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'gb-field-row';
    actions.style.justifyContent = 'flex-start';
    const saveUrlButton = document.createElement('button');
    saveUrlButton.type = 'button';
    saveUrlButton.className = 'gb-btn gb-btn-sm';
    saveUrlButton.dataset.e2eId = 'settings-feedback-save-url';
    saveUrlButton.textContent = 'URLを保存';
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'gb-btn gb-btn-sm';
    openButton.dataset.e2eId = 'settings-feedback-open-form';
    openButton.textContent = 'フォームを開く';
    const ensureButton = document.createElement('button');
    ensureButton.type = 'button';
    ensureButton.className = 'gb-btn gb-btn-sm';
    ensureButton.dataset.e2eId = 'settings-feedback-ensure-sheet';
    ensureButton.textContent = '保管シートを作成/開く';
    const historyButton = document.createElement('button');
    historyButton.type = 'button';
    historyButton.className = 'gb-btn gb-btn-sm';
    historyButton.dataset.e2eId = 'settings-feedback-open-history';
    historyButton.textContent = '送信履歴を開く';
    const classifyButton = document.createElement('button');
    classifyButton.type = 'button';
    classifyButton.className = 'gb-btn gb-btn-sm';
    classifyButton.dataset.e2eId = 'settings-feedback-classify';
    classifyButton.textContent = 'LLM仕分けを実行';
    actions.append(saveUrlButton, openButton, ensureButton, historyButton, classifyButton);
    section.appendChild(actions);
    container.appendChild(section);

    saveUrlButton.addEventListener('click', () => {
      setFeedbackFormUrl(urlInput.value);
      status.textContent = 'フォームURLを保存しました';
    });
    openButton.addEventListener('click', () => {
      const url = String(urlInput.value || _feedbackFormUrl()).trim();
      if (!url) {
        status.textContent = 'フォームURLが未設定です';
        return;
      }
      window.open(url, '_blank', 'noopener');
    });
    ensureButton.addEventListener('click', async () => {
      ensureButton.disabled = true;
      status.textContent = '保管シートを準備中...';
      try {
        const result = await ensureFeedbackSheet();
        status.textContent = `保管シートを準備しました: ${result.dbPath || FEEDBACK_DB_DIR}`;
      } catch (error) {
        status.textContent = '保管シートの準備に失敗しました: ' + (error?.message || error);
      } finally {
        ensureButton.disabled = false;
      }
    });
    historyButton.addEventListener('click', async () => {
      historyButton.disabled = true;
      status.textContent = '送信履歴を開いています...';
      try {
        const result = await ensureFeedbackSheet();
        const dbPath = result.dbPath || FEEDBACK_DB_DIR;
        if (typeof selectDatabase === 'function') await selectDatabase(dbPath, undefined, { silent: true });
        if (typeof loadSavedView === 'function') loadSavedView(1, { dbPath });
        status.textContent = '送信履歴を開きました。修正済みの項目は対応状況で確認できます。';
      } catch (error) {
        status.textContent = '送信履歴を開けませんでした: ' + (error?.message || error);
      } finally {
        historyButton.disabled = false;
      }
    });
    classifyButton.addEventListener('click', async () => {
      classifyButton.disabled = true;
      status.textContent = 'フィードバックを仕分け中...';
      try {
        const result = await classifyFeedbackEntries();
        if (result.skipped) {
          status.textContent = '仕分けはデスクトップ版のMeldexサーバー起動時に実行できます';
        } else {
          status.textContent = `仕分け完了: ${result.processed || 0}件 / 転記 ${result.transferred || 0}件`;
        }
      } catch (error) {
        status.textContent = '仕分けに失敗しました: ' + (error?.message || error);
      } finally {
        classifyButton.disabled = false;
      }
    });
  }

  function renderMeldexFeedbackSettingsPanel(root) {
    const scope = root?.querySelector ? root : document;
    const container = scope.querySelector('#feedback-settings-container');
    if (!container) return;
    container.dataset.feedbackSettingsRendered = '1';
    container.replaceChildren();

    const section = document.createElement('section');
    section.className = 'gb-section gb-section--boxed';
    const title = document.createElement('div');
    title.className = 'gb-section-title';
    title.textContent = '送信設定';
    const desc = document.createElement('div');
    desc.className = 'gb-section-desc';
    desc.textContent = 'クラッシュレポートと利用統計の送信可否を切り替えます。ノート本文や作品内容は利用統計に含めません。';
    section.appendChild(title);
    section.appendChild(desc);

    const checks = document.createElement('div');
    checks.className = 'gb-check-row';
    checks.style.flexDirection = 'column';
    checks.style.alignItems = 'flex-start';
    const crash = _checkbox('settings-crash-report-enabled', 'クラッシュレポートを送信する', isCrashReportEnabled());
    const telemetry = _checkbox('settings-telemetry-enabled', '利用統計を送信する', isTelemetryEnabled());
    const updates = _checkbox('settings-update-check-enabled', '更新確認のための通信を許可する', !!window.MeldexBetaRelease?.isUpdateCheckEnabled?.());
    checks.appendChild(crash.wrapper);
    checks.appendChild(telemetry.wrapper);
    checks.appendChild(updates.wrapper);
    section.appendChild(checks);

    const status = document.createElement('div');
    status.className = 'gb-section-desc';
    status.id = 'settings-feedback-send-status';
    status.textContent = isGoogleConfigured()
      ? 'Google Apps Script Web App: 設定済み'
      : 'Google Apps Script Web App: 未設定（Meldex内の記録のみ有効）';
    section.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'gb-field-row';
    actions.style.justifyContent = 'flex-start';
    const flushButton = document.createElement('button');
    flushButton.type = 'button';
    flushButton.className = 'gb-btn gb-btn-sm';
    flushButton.dataset.e2eId = 'settings-feedback-send-now';
    flushButton.textContent = '利用統計を今すぐ送信';
    const diagnosticsButton = document.createElement('button');
    diagnosticsButton.type = 'button';
    diagnosticsButton.className = 'gb-btn gb-btn-sm';
    diagnosticsButton.dataset.e2eId = 'settings-feedback-export-diagnostics';
    diagnosticsButton.textContent = '診断情報をエクスポート';
    const updateButton = document.createElement('button');
    updateButton.type = 'button';
    updateButton.className = 'gb-btn gb-btn-sm';
    updateButton.dataset.e2eId = 'settings-feedback-check-updates';
    updateButton.textContent = '更新を確認';
    actions.append(flushButton, diagnosticsButton, updateButton);
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
    flushButton.addEventListener('click', async () => {
      flushButton.disabled = true;
      status.textContent = '送信中...';
      try {
        await flushTelemetry('manual');
        status.textContent = '利用統計を送信しました';
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

  function _boot() {
    _installPwaHandlers();
    _bindSettingsObserver();
    if (isTelemetryEnabled()) startTelemetry();
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
    setFeedbackFormUrl,
    ensureFeedbackSheet,
    classifyFeedbackEntries,
    maybeSendFeedbackForm,
    renderMeldexFeedbackPanel,
    renderMeldexFeedbackSettingsPanel,
  };
  window.renderMeldexFeedbackPanel = renderMeldexFeedbackPanel;
  window.renderMeldexFeedbackSettingsPanel = renderMeldexFeedbackSettingsPanel;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot, { once: true });
  else _boot();
})();
