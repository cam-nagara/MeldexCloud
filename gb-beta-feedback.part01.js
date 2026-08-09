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
  const USAGE_DB_DIR = '利用統計';
  const USAGE_DB_NOTE = '利用統計/利用統計.md';
  const FEEDBACK_DB_DIR = 'Meldexフィードバック';
  const FEEDBACK_DB_NOTE = 'Meldexフィードバック/Meldexフィードバック.md';
  const FEEDBACK_FORM_URL_KEY = 'meldex-beta-feedback-form-url';
  const GOOGLE_WEB_APP_URL_KEY = 'meldex-beta-feedback-google-web-app-url';
  const GOOGLE_ADMIN_TOKEN_KEY = 'meldex-beta-feedback-google-admin-token';
  const GOOGLE_IMPORT_DEFAULT_LIMIT = 10;
  const GOOGLE_IMPORT_DEFAULT_MAX_PASSES = 25;
  const CRASH_FIELD_BLOCKLIST = new Set([
    'path', 'filepath', 'filename', 'targetpath',
    'currentpath', 'currentpagepath', 'currentdbpath',
  ]);

  let _session = null;
  let _flushTimer = null;
  let _flushTelemetryPromise = null;
  let _settingsBound = false;
  let _pwaHandlersInstalled = false;

  async function _appendCloudDiagnostic(provider, channel, payload) {
    const resolver = window.MeldexDropboxManagementRootResolver;
    const kind = window.MeldexSystemStorage?.SystemStorageKind?.DIAGNOSTICS;
    if (!provider || !resolver?.resolveTypedAdapterForProvider || !kind) {
      throw new Error('診断データの保存先を安全に判定できません');
    }
    const documentId = `beta-${channel}-${_today()}`;
    const adapter = await resolver.resolveTypedAdapterForProvider(provider, kind, { personalOnly: true });
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await adapter.load(kind, documentId);
      const entries = Array.isArray(current?.payload?.entries)
        ? current.payload.entries.slice(-999)
        : [];
      entries.push(payload);
      try {
        await adapter.save(kind, documentId, {
          version: 1,
          channel,
          updatedAt: _nowIso(),
          entries,
        }, {
          expectedRevision: current?.revision ?? null,
        });
        return { ok: true, path: `diagnostics/${documentId}` };
      } catch (error) {
        lastError = error;
        if (error?.name !== 'SystemStorageConflictError' && error?.code !== 'system_storage_conflict') throw error;
      }
    }
    throw lastError;
  }

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

  function _redactCrashPayloadData(data) {
    const safe = {};
    Object.entries(data || {}).forEach(([key, value]) => {
      const normalized = String(key || '').replace(/[_-]/g, '').toLowerCase();
      safe[key] = CRASH_FIELD_BLOCKLIST.has(normalized) ? '[redacted]' : value;
    });
    return safe;
  }

  function _yamlScalar(value) {
    return JSON.stringify(String(value == null ? '' : value));
  }

  function _jsonLine(payload) {
    return JSON.stringify(payload, null, 0) + '\n';
  }

  function _authHeaders(headers) {
    const next = new Headers(headers || undefined);
    try {
      const token = _safeGet('meldex-auth-token') || _safeGet('crossfolio-auth-token') || '';
      if (token && !next.has('Authorization')) next.set('Authorization', 'Bearer ' + token);
    } catch (_) {}
    return next;
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
    const current = _readConsent() || {};
    const payload = { schema: current.schema || 2, acceptedAt: current.acceptedAt || _nowIso(), updatedAt: _nowIso(), betaNoticeAccepted: true, crashReports: isCrashReportEnabled(), telemetry: isTelemetryEnabled(), updateChecks: current.updateChecks === true };
    if (window.MeldexBetaRelease?.saveConsent) window.MeldexBetaRelease.saveConsent(payload);
    else { _safeSet(CONSENT_KEY, JSON.stringify(payload)); _syncServerConsent(payload); }
    return payload;
  }

  function _syncServerConsent(payload) {
    fetch('/api/beta/consent', {
      method: 'PUT',
      headers: _authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ consent: payload }),
    }).catch(() => {});
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

  function _safeTelemetryActionName(value, fallback) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.length > 80) return fallback;
    if (/[\r\n/\\]|https?:|file:|\.(?:md|json|csv|html?|png|jpe?g|gif|webp|pdf|mp[34]|wav|ogg)\b/i.test(raw)) return fallback;
    if (/^[A-Za-z0-9_.:-]+$/.test(raw)) return raw;
    if (/^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z0-9_.:：ー・\s-]+$/u.test(raw)) {
      return raw.replace(/\s+/g, '-');
    }
    return fallback;
  }

  function _actionName(target) {
    const actionEl = target?.closest?.('[data-action], [data-sn-action], [data-bd-action], button, [role="button"], .settings-tab, .gb-inner-tab');
    if (!actionEl) return '';
    const isAppChrome = !!actionEl.closest?.('#app-toolbar, #sidebar, #right-panel, .gb-panel, .modal, .settings-panel, .gb-toolbar, .tab-bar, .detail-tab-shell');
    const tag = String(actionEl.tagName || 'element').toLowerCase();
    const fallback = isAppChrome ? `chrome:${tag}` : `element:${tag}`;
    return _safeTelemetryActionName(actionEl.dataset?.action, fallback)
      || _safeTelemetryActionName(actionEl.dataset?.snAction, fallback)
      || _safeTelemetryActionName(actionEl.dataset?.bdAction, fallback)
      || _safeTelemetryActionName(actionEl.dataset?.tab, fallback)
      || _safeTelemetryActionName(actionEl.id, fallback)
      || fallback;
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

  function _isPerformanceLogPayload(payload) {
    return payload?.perf === true || String(payload?.message || '').startsWith('[perf]');
  }

  function _recordPerformanceLogPayload(payload) {
    const label = String(payload?.label || '').trim();
    if (!label) return;
    recordPerformance(label, payload?.durationMs);
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
      cloudMode: !!window.MeldexRuntimeAdapter?.isBrowserDataMode?.(),
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

  function _shouldPersistTelemetrySummary(reason) {
    const normalized = String(reason || 'manual');
    return normalized === 'manual' || normalized === 'pagehide';
  }

  async function _postJson(path, payload, keepalive) {
    const response = await fetch((typeof API_BASE === 'string' ? API_BASE : '/api') + path, {
      method: 'POST',
      headers: _authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      keepalive: !!keepalive,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const text = await response.text();
        const parsed = JSON.parse(text);
        detail = parsed?.detail || parsed?.message || parsed?.error || text;
      } catch (_) {}
      throw new Error(detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`);
    }
    return response.json().catch(() => ({ ok: true }));
  }

  function _googleUrl() {
    return String(_safeGet(GOOGLE_WEB_APP_URL_KEY) || feedbackConfig.googleWebAppUrl || '').trim();
  }

  function isGoogleConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\//.test(_googleUrl());
  }

  function setGoogleWebAppUrl(url) {
    _safeSet(GOOGLE_WEB_APP_URL_KEY, String(url || '').trim());
  }

  function _googleAdminToken() {
    return String(_safeGet(GOOGLE_ADMIN_TOKEN_KEY) || '').trim();
  }

  function setGoogleAdminToken(token) {
    _safeSet(GOOGLE_ADMIN_TOKEN_KEY, String(token || '').trim());
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
    if (!provider) throw new Error('保存先が未初期化です');
    const sessionId = _safeFilePart(summary.sessionId || 'session', 'session');
    const diagnostic = await _appendCloudDiagnostic(provider, 'usage', summary);
    try { await provider.statPath(USAGE_DB_NOTE); }
    catch (_) { await provider.writeText(USAGE_DB_NOTE, _usageDbFrontmatter()); }
    const flushStamp = _safeFilePart(String(summary.flushedAt || _nowIso()).replace(/[:.]/g, '-'), 'flush');
    const entryPath = _joinPath(USAGE_DB_DIR, `usage_${_today()}_${sessionId}_${flushStamp}.md`);
    await provider.writeText(entryPath, _usageEntryMarkdown(summary));
    return { ok: true, path: entryPath, jsonlPath: diagnostic.path };
  }

  async function _writeCloudCrashReport(payload) {
    const provider = window.MeldexStorageAdapter?.getProvider?.();
    if (!provider) throw new Error('Dropbox provider が未初期化です');
    return _appendCloudDiagnostic(provider, 'crash-reports', payload);
  }

  function _feedbackFormUrl() { return String(_safeGet(FEEDBACK_FORM_URL_KEY) || feedbackConfig.feedbackFormUrl || '').trim(); }

  function setFeedbackFormUrl(url) { _safeSet(FEEDBACK_FORM_URL_KEY, String(url || '').trim()); }

  function _feedbackViewConfig() {
    return {
      currentViewIdx: 0,
      savedViews: [
        { name: 'フィードバックフォーム', viewMode: 'form', typeSpecific: { form: { formConfig: _feedbackFormConfig() } } },
        { name: '送信履歴', viewMode: 'pivot', hiddenCols: ['連絡先', 'LLM分類理由'], pinnedCols: ['件名', '対応状況'], colOrder: ['件名', '対応状況', '修正済み', '種別', '重要度', '画面/機能', '送信日', '修正日時', '修正バージョン', '転記先'] },
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
      const defaults = result?.viewConfig || _feedbackViewConfig();
      const next = { ...current, ...defaults };
      next.savedViews = _mergeFeedbackSavedViews(current.savedViews, defaults.savedViews);
      if (Number.isInteger(current.currentViewIdx)) next.currentViewIdx = current.currentViewIdx;
      delete next.currentViewMode;
      localStorage.setItem(key, JSON.stringify(next));
    } catch (_) {}
    return dbPath;
  }

  function _mergeFeedbackSavedViews(currentViews, defaultViews) {
    if (!Array.isArray(defaultViews)) return Array.isArray(currentViews) ? currentViews : [];
    if (!Array.isArray(currentViews) || !currentViews.length) return defaultViews;
    const used = new Set(), byName = new Map(defaultViews.map(view => [view?.name || '', view]));
    const merged = currentViews.map(view => {
      const base = byName.get(view?.name || '');
      if (!base) return view;
      used.add(base.name || '');
      return { ...base, ...view, typeSpecific: { ...(base.typeSpecific || {}), ...(view.typeSpecific || {}) } };
    });
    defaultViews.forEach(view => { const name = view?.name || ''; if (!used.has(name) && !currentViews.some(current => (current?.name || '') === name)) merged.push(view); });
    return merged;
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
    const result = window.MeldexRuntimeAdapter?.isBrowserDataMode?.()
      ? await _writeCloudFeedbackSheet()
      : await _postJson('/beta/feedback-template', {}, false);
    if (result?.ok === false) throw new Error(result.error || result.reason || 'フィードバック保管シートを準備できませんでした');
    const dbPath = _applyFeedbackViewConfig(result);
    if (typeof selectDatabase === 'function') {
      try { await selectDatabase(dbPath, undefined, { silent: true }); } catch (_) {}
    }
    return { ...result, dbPath };
  }

  async function classifyFeedbackEntries() {
    if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) {
      return { ok: false, skipped: true, reason: 'cloud-classify-needs-desktop-server' };
    }
    return _postJson('/beta/feedback/classify', {}, false);
  }

  async function importGoogleFeedbackEntries(options) {
    if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) {
      return { ok: false, skipped: true, reason: 'cloud-google-import-needs-desktop-server' };
    }
    const limit = Number(options?.limit || GOOGLE_IMPORT_DEFAULT_LIMIT) || GOOGLE_IMPORT_DEFAULT_LIMIT;
    const maxPasses = Math.max(1, Math.min(50, Number(options?.maxPasses || GOOGLE_IMPORT_DEFAULT_MAX_PASSES) || GOOGLE_IMPORT_DEFAULT_MAX_PASSES));
    const baseBody = {
      googleWebAppUrl: options?.googleWebAppUrl || _googleUrl(),
      adminToken: options?.adminToken || _googleAdminToken(),
      limit,
      markImported: true,
    };
    const total = {
      ok: true,
      fetched: 0,
      imported: 0,
      duplicate: 0,
      ignored: 0,
      marked: 0,
      passes: 0,
      limited: false,
      markFailed: false,
      markErrors: [],
      items: [],
    };
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const result = await _postJson('/beta/feedback/google-import', baseBody, false);
      if (!result?.ok || result?.skipped) {
        if (!total.passes) return result;
        total.partial = true;
        total.stopReason = result?.reason || 'google-import-stopped';
        total.stopMessage = result?.message || result?.error || '';
        total.lastResult = result;
        return total;
      }
      total.passes += 1;
      total.fetched += Number(result.fetched || 0);
      total.imported += Number(result.imported || 0);
      total.duplicate += Number(result.duplicate || 0);
      total.ignored += Number(result.ignored || 0);
      total.marked += Number(result.marked || 0);
      if (Array.isArray(result.items)) total.items.push(...result.items);
      if (Array.isArray(result.markErrors)) total.markErrors.push(...result.markErrors);
      total.markFailed = total.markFailed || !!result.markFailed;
      if (total.markFailed || Number(result.fetched || 0) <= 0) return total;
    }
    total.limited = true;
    return total;
  }

  function _isFeedbackFormPayload(data) {
    const cfg = data?.formConfig || {};
    const dbPath = String(data?.dbPath || '').replace(/\\/g, '/');
    return !!(cfg.betaFeedbackRelay === true || dbPath === FEEDBACK_DB_DIR || dbPath.startsWith(FEEDBACK_DB_DIR + '/'));
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
    if (!isTelemetryEnabled() || _isBypassMode() || !_session) return { ok: false, skipped: true, reason: 'telemetry-disabled-or-empty' };
    if (_flushTelemetryPromise) return _flushTelemetryPromise;
    _flushTelemetryPromise = (async () => {
      const summary = _buildSummary(reason || 'manual');
      _safeSet(LAST_SUMMARY_KEY, JSON.stringify(summary));
      if (!_shouldPersistTelemetrySummary(summary.reason)) {
        return { ok: true, delivered: false, skipped: true, reason: 'telemetry-snapshot-only', summary };
      }
      const tasks = [];
      tasks.push(_postJson('/beta/usage', summary, reason !== 'manual'));
      tasks.push(sendGoogle('usage', summary));
      const results = await Promise.allSettled(tasks);
      const delivered = results.some(_isDeliveredTelemetryResult);
      if (delivered) _resetVolatileCounters();
      return { ok: delivered, delivered, skipped: !delivered, results };
    })();
    try {
      return await _flushTelemetryPromise;
    } finally {
      _flushTelemetryPromise = null;
    }
  }

  function _isDeliveredTelemetryResult(item) { return item?.status === 'fulfilled' && item.value?.ok === true && item.value?.skipped !== true; }

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
      ..._redactCrashPayloadData(data),
    };
    if (_isPerformanceLogPayload(payload)) {
      _recordPerformanceLogPayload(payload);
      return;
    }
    if (isTelemetryEnabled()) {
      const session = _getSession();
      if (payload.level === 'error') session.errorCount += 1;
      else session.warningCount += 1;
    }
    if (!isCrashReportEnabled() || _isBypassMode()) return;
    if (window.MeldexRuntimeAdapter?.isBrowserDataMode?.()) {
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
    if (typeof fieldHelp === 'function') {
      title.insertAdjacentHTML('beforeend', ' ' + fieldHelp('ベータ版の不具合・要望・質問を送信するためのフォームと、Meldex内の保管シートを管理します'));
    }
    section.append(title);

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
    status.setAttribute('aria-live', 'polite');
    status.textContent = _feedbackFormUrl()
      ? '設定済みのフォームURLを利用できます。'
      : '保管シートを作成し、フォームビューを公開した後、そのURLをここに保存してください。';
    section.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'gb-field-row settings-feedback-actions';
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
    checks.className = 'gb-check-row settings-feedback-checks';
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
    status.setAttribute('aria-live', 'polite');
    status.textContent = isGoogleConfigured()
      ? 'Google Apps Script Web App: 設定済み'
      : 'Google Apps Script Web App: 未設定（Meldex内の記録のみ有効）';
    section.appendChild(status);

    const googleUrlRow = document.createElement('label');
    googleUrlRow.className = 'gb-field-row';
    const googleUrlLabel = document.createElement('span');
    googleUrlLabel.className = 'gb-label';
    googleUrlLabel.textContent = '受信箱URL';
    const googleUrlInput = document.createElement('input');
    googleUrlInput.id = 'settings-feedback-google-url';
    googleUrlInput.className = 'gb-input';
    googleUrlInput.placeholder = 'Google Apps Script Web App URL';
    googleUrlInput.value = _googleUrl();
    googleUrlRow.append(googleUrlLabel, googleUrlInput);
    section.appendChild(googleUrlRow);

    const tokenRow = document.createElement('label');
    tokenRow.className = 'gb-field-row';
    const tokenLabel = document.createElement('span');
    tokenLabel.className = 'gb-label';
    tokenLabel.textContent = '管理者トークン';
    const tokenInput = document.createElement('input');
    tokenInput.id = 'settings-feedback-google-admin-token';
    tokenInput.className = 'gb-input';
    tokenInput.type = 'password';
    tokenInput.placeholder = 'Apps ScriptのADMIN_TOKEN';
    tokenInput.value = _googleAdminToken();
    tokenRow.append(tokenLabel, tokenInput);
    section.appendChild(tokenRow);

    const actions = document.createElement('div');
    actions.className = 'gb-field-row settings-feedback-actions';
    const saveGoogleButton = document.createElement('button');
    saveGoogleButton.type = 'button';
    saveGoogleButton.className = 'gb-btn gb-btn-sm';
    saveGoogleButton.dataset.e2eId = 'settings-feedback-save-google-receiver';
    saveGoogleButton.textContent = '受信箱設定を保存';
    const importGoogleButton = document.createElement('button');
    importGoogleButton.type = 'button';
    importGoogleButton.className = 'gb-btn gb-btn-sm';
    importGoogleButton.dataset.e2eId = 'settings-feedback-import-google';
    importGoogleButton.textContent = 'Google受信箱を取り込む';
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
