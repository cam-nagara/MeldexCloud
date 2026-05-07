(function () {
  'use strict';

  if (window.MeldexDiagnostics) return;

  const MAX_LOGS = 200;
  const logs = [];
  const apiErrors = [];
  let lastError = null;

  function _now() {
    return new Date().toISOString();
  }

  function _push(list, entry) {
    list.push({ time: _now(), ...entry });
    while (list.length > MAX_LOGS) list.shift();
  }

  function _safeText(value) {
    if (value == null) return '';
    if (value instanceof Error) return value.stack || value.message || String(value);
    try {
      if (typeof value === 'object') return JSON.stringify(value);
    } catch (_) {}
    return String(value);
  }

  function _redact(value, key) {
    const lower = String(key || '').toLowerCase();
    if (/key|token|secret|password|authorization|content|body|prompt|title|name|path|file/.test(lower)) {
      if (value == null || value === '') return value;
      return '[redacted]';
    }
    if (Array.isArray(value)) return value.map(item => _redact(item, key));
    if (value && typeof value === 'object') return _redactObject(value);
    if (typeof value === 'string' && /[A-Za-z]:[\\/]|\/[^ ]+\/[^ ]+/.test(value)) return '[redacted-path]';
    return value;
  }

  function _redactObject(obj) {
    const out = {};
    Object.entries(obj || {}).forEach(([key, value]) => {
      out[key] = _redact(value, key);
    });
    return out;
  }

  function rememberError(error, context) {
    const friendly = window.MeldexErrorMessages?.translate?.(error, context) || null;
    lastError = {
      time: _now(),
      context: _redactObject(context || {}),
      message: _safeText(error?.message || error),
      stack: _safeText(error?.stack || ''),
      friendly,
    };
    _push(logs, { level: 'error', message: lastError.message, context: lastError.context });
    return lastError;
  }

  function captureApiError(path, opts, error) {
    const entry = rememberError(error, {
      kind: 'api',
      path,
      method: opts?.method || 'GET',
      status: error?.status || error?.httpStatus || 0,
    });
    _push(apiErrors, entry);
    showErrorNotice(error, { path, method: opts?.method || 'GET' });
    return entry;
  }

  function _recordConsole(level, args) {
    _push(logs, { level, message: Array.from(args || []).map(_safeText).join(' ') });
  }

  function _installConsoleCapture() {
    ['warn', 'error'].forEach(level => {
      const original = console[level];
      if (original?._meldexDiagnosticsWrapped) return;
      const wrapped = function () {
        _recordConsole(level, arguments);
        return original.apply(console, arguments);
      };
      wrapped._meldexDiagnosticsWrapped = true;
      console[level] = wrapped;
    });
    window.addEventListener('error', event => {
      rememberError(event.error || event.message, { kind: 'window-error' });
    });
    window.addEventListener('unhandledrejection', event => {
      rememberError(event.reason || 'unhandled rejection', { kind: 'unhandledrejection' });
    });
  }

  function _crcTable() {
    if (_crcTable.cache) return _crcTable.cache;
    const table = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    _crcTable.cache = table;
    return table;
  }

  function _crc32(bytes) {
    const table = _crcTable();
    let c = 0 ^ -1;
    for (let i = 0; i < bytes.length; i += 1) c = (c >>> 8) ^ table[(c ^ bytes[i]) & 0xFF];
    return (c ^ -1) >>> 0;
  }

  function _u16(value) {
    return [value & 0xFF, (value >>> 8) & 0xFF];
  }

  function _u32(value) {
    return [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF];
  }

  function _zip(entries) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const data = encoder.encode(entry.text || '');
      const crc = _crc32(data);
      const local = new Uint8Array([
        ..._u32(0x04034b50), ..._u16(20), ..._u16(0), ..._u16(0), ..._u16(0), ..._u16(0),
        ..._u32(crc), ..._u32(data.length), ..._u32(data.length), ..._u16(name.length), ..._u16(0),
      ]);
      chunks.push(local, name, data);
      const centralHeader = new Uint8Array([
        ..._u32(0x02014b50), ..._u16(20), ..._u16(20), ..._u16(0), ..._u16(0), ..._u16(0), ..._u16(0),
        ..._u32(crc), ..._u32(data.length), ..._u32(data.length), ..._u16(name.length), ..._u16(0), ..._u16(0),
        ..._u16(0), ..._u16(0), ..._u32(0), ..._u32(offset),
      ]);
      central.push(centralHeader, name);
      offset += local.length + name.length + data.length;
    }
    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array([
      ..._u32(0x06054b50), ..._u16(0), ..._u16(0), ..._u16(entries.length), ..._u16(entries.length),
      ..._u32(centralSize), ..._u32(offset), ..._u16(0),
    ]);
    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }

  async function _versionInfo() {
    try {
      if (window.MeldexBetaRelease?.getVersionInfo) return await window.MeldexBetaRelease.getVersionInfo();
      if (typeof apiFetch === 'function') return await apiFetch('/version');
    } catch (_) {}
    return {};
  }

  async function _serverLogs() {
    try {
      if (typeof apiFetch !== 'function') return [];
      const res = await apiFetch('/debug-log/recent?limit=80');
      return Array.isArray(res?.logs) ? res.logs.map(_redactObject) : [];
    } catch (_) {
      return [];
    }
  }

  async function buildDiagnostics(extra) {
    const version = await _versionInfo();
    const serverLogs = await _serverLogs();
    return {
      system: {
        generatedAt: _now(),
        version,
        runtimeMode: window.MeldexRuntimeAdapter?.getMode?.() || 'legacy',
        userAgent: navigator.userAgent || '',
        platform: navigator.platform || '',
        language: navigator.language || '',
      },
      settingsDigest: {
        telemetryEnabled: !!window.MeldexBetaFeedback?.isTelemetryEnabled?.(),
        crashReportEnabled: !!window.MeldexBetaFeedback?.isCrashReportEnabled?.(),
        dataAccessMode: window.MeldexRuntimeAdapter?.getMode?.() || 'legacy',
        cloudWorkspaceConfigured: !!window.MeldexRuntimeAdapter?.getWorkspaceState?.(),
      },
      lastError: extra?.error || lastError,
      consoleLogs: logs.slice(-MAX_LOGS),
      apiErrors: apiErrors.slice(-MAX_LOGS),
      serverLogs,
    };
  }

  async function exportDiagnostics(extra) {
    const data = await buildDiagnostics(extra || {});
    const entries = [
      { name: 'system_info.json', text: JSON.stringify(data.system, null, 2) },
      { name: 'settings_digest.json', text: JSON.stringify(data.settingsDigest, null, 2) },
      { name: 'console_errors.log', text: data.consoleLogs.map(item => JSON.stringify(item)).join('\n') + '\n' },
      { name: 'api_errors.log', text: data.apiErrors.map(item => JSON.stringify(item)).join('\n') + '\n' },
      { name: 'server_logs.json', text: JSON.stringify(data.serverLogs, null, 2) },
      { name: 'last_error.json', text: JSON.stringify(data.lastError || {}, null, 2) },
    ];
    const blob = _zip(entries);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meldex-diagnostic-${stamp}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true, filename: a.download };
  }

  function _historyEntryParts(entry) {
    if (typeof _historyDisplayParts === 'function') return _historyDisplayParts(entry);
    const label = String(entry?.label || '').trim();
    const detail = String(entry?.detail || '').trim();
    return { title: label, detail };
  }

  function _historyScopeLabel(scope) {
    if (!scope) return '全体';
    if (typeof _historyScopeDisplayName === 'function') {
      return _historyScopeDisplayName(scope) || scope;
    }
    return String(scope).includes(':') ? String(scope).split(':').slice(1).join(':') : String(scope);
  }

  function _collectSupportHistoryEntries(limit = 8) {
    const entries = [];
    const seen = new Set();
    const collect = (stack, type, scope) => {
      (stack || []).forEach(entry => {
        if (!entry || seen.has(entry)) return;
        seen.add(entry);
        entries.push({ ...entry, _supportType: type, scope: entry.scope || scope || '' });
      });
    };
    try {
      if (typeof _historyActiveScope !== 'undefined' && _historyActiveScope && typeof _getStack === 'function') {
        const active = _getStack(_historyActiveScope);
        collect(active?.undo, 'undo', _historyActiveScope);
        collect(active?.redo, 'redo', _historyActiveScope);
      }
      if (typeof _historyGlobal !== 'undefined') {
        collect(_historyGlobal.undo, 'undo', '');
        collect(_historyGlobal.redo, 'redo', '');
      }
      if (typeof _historyStacks !== 'undefined') {
        Object.entries(_historyStacks || {}).forEach(([scope, stack]) => {
          if (typeof _historyActiveScope !== 'undefined' && scope === _historyActiveScope) return;
          collect(stack?.undo, 'undo', scope);
          collect(stack?.redo, 'redo', scope);
        });
      }
    } catch (_) {}
    return entries
      .sort((a, b) => Number(b.time || 0) - Number(a.time || 0))
      .slice(0, Math.max(1, limit));
  }

  function buildSupportActivitySummary(limit = 8) {
    const lines = [];
    const view = window.state?.view || '';
    const path = typeof getCurrentFilePath === 'function' ? getCurrentFilePath() : '';
    if (view) lines.push(`画面: ${view}`);
    if (path) lines.push(`対象: ${path}`);
    const entries = _collectSupportHistoryEntries(limit);
    if (entries.length) {
      lines.push('直近の操作:');
      entries.forEach(entry => {
        const parts = _historyEntryParts(entry);
        const time = entry.time ? new Date(entry.time).toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }) : '';
        const status = entry._supportType === 'redo' ? 'やり直し待ち' : '実行済み';
        const scope = _historyScopeLabel(entry.scope);
        const detail = parts.detail ? ` - ${parts.detail}` : '';
        lines.push(`- ${time} [${scope} / ${status}] ${parts.title || '操作'}${detail}`);
      });
    } else {
      lines.push('直近の操作: 取得できませんでした');
    }
    return lines.join('\n');
  }

  function showSupportDialog(error, context) {
    const remembered = rememberError(error || lastError, context || {});
    const friendly = remembered.friendly || window.MeldexErrorMessages?.translate?.(error, context) || {};
    const activitySummary = buildSupportActivitySummary();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal meldex-support-dialog" style="width:min(440px,calc(100vw - 32px));min-width:360px;max-width:440px;height:min(760px,calc(100vh - 32px));max-height:calc(100vh - 32px);display:flex;flex-direction:column;overflow:hidden;">
      <h3 style="display:flex;align-items:center;gap:8px;">${lucide('lifeBuoy',16)} サポートに送信</h3>
      <div style="display:flex;flex-direction:column;gap:10px;min-height:0;flex:1;overflow:auto;padding-right:2px;">
        <section class="gb-section gb-section--boxed">
          <div class="gb-section-title">${esc(friendly.title || '操作に失敗しました')}</div>
          <div class="gb-section-desc">${esc(friendly.message || '')}</div>
          <div class="gb-section-desc">${esc(friendly.action || '')}</div>
        </section>
        <label class="gb-field" style="gap:6px;">
          <span class="gb-label">直前の操作（自動入力）</span>
          <textarea id="meldex-support-activity" class="gb-input" rows="7" readonly style="min-height:118px;resize:vertical;">${esc(activitySummary)}</textarea>
        </label>
        <label class="gb-field" style="gap:6px;">
          <span class="gb-label">補足コメント</span>
          <textarea id="meldex-support-comment" class="gb-input" rows="8" style="min-height:132px;resize:vertical;" placeholder="再現条件、発生頻度、補足事項など"></textarea>
        </label>
        <details style="margin-top:2px;">
          <summary>技術的詳細</summary>
          <pre style="white-space:pre-wrap;max-height:220px;overflow:auto;background:var(--bg);border:1px solid var(--border);padding:8px;">${esc(remembered.message || '')}</pre>
        </details>
      </div>
      <div class="btn-row" style="margin-top:12px;flex-shrink:0;">
        <button data-support-action="export">診断情報を保存</button>
        <button class="primary" data-support-action="send">送信 / 保存</button>
        <button data-support-action="close">閉じる</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    replaceIcons(overlay);
    const buildSupportPayload = () => {
      const comment = overlay.querySelector('#meldex-support-comment')?.value || '';
      const activity = overlay.querySelector('#meldex-support-activity')?.value || activitySummary;
      return {
        ...remembered,
        activitySummary: activity,
        comment,
        kind: 'support-report',
      };
    };
    overlay.querySelector('[data-support-action="close"]')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-support-action="export"]')?.addEventListener('click', () => exportDiagnostics({ error: buildSupportPayload() }));
    overlay.querySelector('[data-support-action="send"]')?.addEventListener('click', async () => {
      const payload = buildSupportPayload();
      if (window.MeldexBetaFeedback?.sendGoogle && window.MeldexBetaFeedback?.isGoogleConfigured?.()) {
        try {
          await window.MeldexBetaFeedback.sendGoogle('crash', payload);
          if (typeof showStatus === 'function') showStatus('サポート情報を送信しました');
          overlay.remove();
          return;
        } catch (_) {}
      }
      await exportDiagnostics({ error: payload });
      if (typeof showStatus === 'function') showStatus('送信先が未設定のため、診断情報を保存しました');
      overlay.remove();
    });
  }

  function showErrorNotice(error, context) {
    const friendly = window.MeldexErrorMessages?.translate?.(error, context) || null;
    if (!friendly) return;
    const old = document.getElementById('meldex-error-support-notice');
    if (old) old.remove();
    const notice = document.createElement('div');
    notice.id = 'meldex-error-support-notice';
    notice.style.cssText = 'position:fixed;right:18px;bottom:34px;z-index:100060;max-width:360px;background:var(--bg2);color:var(--fg);border:1px solid var(--red);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:12px;display:flex;flex-direction:column;gap:8px;font-size:13px;';
    notice.innerHTML = `<div style="font-weight:700;">${esc(friendly.title)}</div>
      <div style="color:var(--fg2);line-height:1.5;">${esc(friendly.action)}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="gb-btn gb-btn-sm" data-error-action="details" data-e2e-id="error-support-details">詳細</button>
        <button class="gb-btn gb-btn-sm gb-btn-primary" data-error-action="support" data-e2e-id="error-support-send">サポートに送信</button>
      </div>`;
    document.body.appendChild(notice);
    notice.querySelector('[data-error-action="details"]')?.addEventListener('click', () => showSupportDialog(error, context));
    notice.querySelector('[data-error-action="support"]')?.addEventListener('click', () => showSupportDialog(error, context));
    setTimeout(() => notice.remove(), 12000);
  }

  _installConsoleCapture();

  window.MeldexDiagnostics = {
    rememberError,
    captureApiError,
    showSupportDialog,
    showErrorNotice,
    buildDiagnostics,
    exportDiagnostics,
    buildSupportActivitySummary,
  };
  window.exportMeldexDiagnostics = exportDiagnostics;
})();
