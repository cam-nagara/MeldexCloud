(function () {
  'use strict';

  if (window.MeldexDiagnostics) return;

  const MAX_LOGS = 200;
  const logs = [];
  const apiErrors = [];
  const operationLogs = [];
  const startupNoticeQuietUntil = Date.now() + 8000;
  let lastError = null;
  let userInteractedBeforeNotice = false;
  let supportDialogSeq = 0;
  let supportDialogApi = null;
  // 同種の失敗が短時間に繰り返し起きても、右下トーストを積み増さないための重複抑制。
  // 「操作に失敗しました」トーストが頻発する不具合の対策（同一種類の失敗を1個の
  // トーストにまとめ、表示中は自動消去タイマーだけ延長する）。
  const NOTICE_DEDUPE_MS = 15000;
  let _lastNoticeFingerprint = '';
  let _lastNoticeShownAt = 0;

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

  function _redactDiagnosticText(value) {
    let text = _safeText(value);
    if (!text) return '';
    if (/(?:body|content|prompt|本文|作品本文)\s*[:=]/i.test(text)) {
      return 'エラー内容はプライバシー保護のため省略しました';
    }
    text = text.replace(/data:[^,\s]+,[^\s"'<>]+/gi, '[redacted-data]');
    text = text.replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]');
    text = text.replace(/[A-Za-z]:[\\/][^\s"'<>)]*/g, '[redacted-path]');
    text = text.replace(/(?:^|[\s("'`])(?:\.{1,2}\/)?[^\s"'<>)]*[\\/][^\s"'<>)]*/g, match => {
      const prefix = /^[\s("'`]/.test(match) ? match[0] : '';
      return prefix + '[redacted-path]';
    });
    text = text.replace(/[^\s"'<>:]+?\.(?:md|json|scriptnote\.json|smart-db\.json|board\.md|png|jpe?g|gif|webp|pdf|csv|xlsx?|txt|html?|css|js|py)\b/giu, '[redacted-file]');
    text = text.replace(/\b(?:path|file|filename|folder|title|name|content|body|prompt)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
    return text.slice(0, 1200);
  }

  function _redactLogValue(value, key) {
    if (value instanceof Error) {
      return {
        name: _redactDiagnosticText(value.name || 'Error'),
        message: _redactDiagnosticText(value.message || ''),
      };
    }
    if (Array.isArray(value)) return value.map(item => _redactLogValue(item, key));
    if (value && typeof value === 'object') return _redactObject(value);
    return _redactDiagnosticText(value);
  }

  // API のルート名（/db-metadata など）はアプリ固定の値でユーザーデータを含まない。
  // クエリ（?path=... にファイル名が入る）は _safeEndpoint が既に落としている。
  // ここまで伏せると診断情報が「GET [redacted-path] HTTP 500」だけになり、
  // どの処理が失敗したのか誰も分からなくなる（実際に調査が行き詰まった）。
  // 念のため、ドライブ文字・バックスラッシュ・拡張子を含むものは従来どおり伏せる。
  function _safeApiRoute(value) {
    const text = String(value || '').split('?')[0].trim();
    if (!text || !text.startsWith('/')) return null;
    if (text.length > 120) return null;
    if (/[\\]|^[A-Za-z]:/.test(text)) return null;
    if (/\.(?:md|json|png|jpe?g|gif|webp|pdf|csv|xlsx?|txt|html?|css|js|py)$/i.test(text)) return null;
    return text;
  }

  function _redact(value, key) {
    const lower = String(key || '').toLowerCase();
    if (lower === 'endpoint' || lower === 'route') {
      const route = _safeApiRoute(value);
      if (route) return route;
    }
    if (/key|token|secret|password|authorization|content|body|prompt|title|name|path|file/.test(lower)) {
      if (value == null || value === '') return value;
      return '[redacted]';
    }
    if (Array.isArray(value)) return value.map(item => _redact(item, key));
    if (value && typeof value === 'object') return _redactObject(value);
    if (/message|stack|detail|error/.test(lower)) return _redactDiagnosticText(value);
    return typeof value === 'string' ? _redactDiagnosticText(value) : value;
  }

  function _redactObject(obj) {
    const out = {};
    Object.entries(obj || {}).forEach(([key, value]) => {
      out[key] = _redact(value, key);
    });
    return out;
  }

  function _safeEndpoint(path) {
    try {
      const url = new URL(String(path || ''), 'http://local');
      return url.pathname || String(path || '').split('?')[0] || '';
    } catch {
      return String(path || '').split('?')[0].slice(0, 160);
    }
  }

  function _fnv32(text) {
    let hash = 0x811c9dc5;
    const source = String(text || '');
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function _safeActionName(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const match = text.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/);
    return match ? match[1].slice(0, 96) : ('action-' + _fnv32(text));
  }

  function _safeControlId(value) {
    const text = String(value || '').trim();
    return text ? ('ui-' + _fnv32(text)) : '';
  }

  function _targetFacts(path) {
    const normalized = String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/');
    const name = normalized.split('/').pop() || '';
    const extMatch = name.match(/(\.[^.]+)$/);
    return {
      targetId: _fnv32(normalized),
      extension: extMatch ? extMatch[1].toLowerCase().slice(0, 24) : 'なし',
      depth: normalized ? normalized.split('/').filter(Boolean).length : 0,
    };
  }

  function _currentSettingsPanelName() {
    try {
      const panel = document.querySelector('.modal-overlay[data-settings-modal="1"] .settings-panel:not([hidden])');
      return panel?.dataset?.panel || '';
    } catch {
      return '';
    }
  }

  function _cloudStateDigest() {
    const state = window.MeldexRuntimeAdapter?.getWorkspaceState?.() || {};
    const body = typeof document !== 'undefined' ? (document.body?.dataset || {}) : {};
    return {
      mode: window.MeldexRuntimeAdapter?.getMode?.() || 'legacy',
      connected: !!(state.path || state.name),
      access: String(state.access || state.role || ''),
      sourceFolders: Number(state.sourceFolders || 0),
      readonly: body.cloudReadonly === '1',
      quotaBlocked: body.cloudQuotaBlocked === '1',
    };
  }

  function recordOperation(label, detail) {
    const entry = {
      label: _redactDiagnosticText(label).slice(0, 80),
      detail: _redactObject(detail || {}),
    };
    _push(operationLogs, entry);
    return entry;
  }

  function rememberError(error, context) {
    const friendly = window.MeldexErrorMessages?.translate?.(error, context) || null;
    lastError = {
      time: _now(),
      context: _redactObject(context || {}),
      message: _redactDiagnosticText(error?.message || error),
      stack: _redactDiagnosticText(error?.stack || ''),
      friendly,
    };
    _push(logs, { level: 'error', message: lastError.message, context: lastError.context });
    return lastError;
  }

  function captureApiError(path, opts, error) {
    recordOperation('API失敗', {
      endpoint: _safeEndpoint(path),
      method: opts?.method || 'GET',
      status: error?.status || error?.httpStatus || 0,
    });
    const entry = rememberError(error, {
      kind: 'api',
      path,
      // path はクエリごと伏せられるため、ルート名だけを別に残す（診断で必須）
      endpoint: _safeEndpoint(path),
      method: opts?.method || 'GET',
      status: error?.status || error?.httpStatus || 0,
    });
    _push(apiErrors, entry);
    showErrorNotice(error, { path, method: opts?.method || 'GET' });
    return entry;
  }

  function _recordConsole(level, args) {
    _push(logs, { level, message: Array.from(args || []).map(item => _safeText(_redactLogValue(item))).join(' ') });
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

  function _installOperationCapture() {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    document.addEventListener('click', event => {
      const el = event.target?.closest?.('[data-action],[data-e2e-id],[data-support-action],[data-error-action]');
      if (!el) return;
      recordOperation('画面操作', {
        action: _safeActionName(el.getAttribute('data-action') || el.getAttribute('data-support-action') || el.getAttribute('data-error-action') || ''),
        controlId: _safeControlId(el.getAttribute('data-e2e-id') || ''),
        settingsPanel: _currentSettingsPanelName(),
      });
    }, true);
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
      const res = await apiFetch('/debug-log/recent?limit=80', { silentError: true });
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
      cloudState: _cloudStateDigest(),
      lastError: extra?.error || lastError,
      consoleLogs: logs.slice(-MAX_LOGS),
      apiErrors: apiErrors.slice(-MAX_LOGS),
      operationLogs: operationLogs.slice(-MAX_LOGS),
      runtimeCompareLogs: window.MeldexRuntimeAdapter?.getCompareLogs?.() || [],
      serverLogs,
    };
  }

  async function exportDiagnostics(extra) {
    const data = await buildDiagnostics(extra || {});
    const entries = [
      { name: 'system_info.json', text: JSON.stringify(data.system, null, 2) },
      { name: 'settings_digest.json', text: JSON.stringify(data.settingsDigest, null, 2) },
      { name: 'cloud_state.json', text: JSON.stringify(data.cloudState, null, 2) },
      { name: 'console_errors.log', text: data.consoleLogs.map(item => JSON.stringify(item)).join('\n') + '\n' },
      { name: 'api_errors.log', text: data.apiErrors.map(item => JSON.stringify(item)).join('\n') + '\n' },
      { name: 'operation_logs.log', text: data.operationLogs.map(item => JSON.stringify(item)).join('\n') + '\n' },
      { name: 'runtime_compare_logs.json', text: JSON.stringify(data.runtimeCompareLogs, null, 2) },
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

  function _collectSupportOperationEntries(limit = 8) {
    return operationLogs
      .slice(-Math.max(1, limit))
      .reverse();
  }

  function _operationDetailText(detail) {
    const parts = [];
    if (detail?.settingsPanel) parts.push(`設定=${detail.settingsPanel}`);
    if (detail?.endpoint) parts.push(`${detail.method || 'GET'} ${detail.endpoint}`);
    if (detail?.status) parts.push(`HTTP ${detail.status}`);
    if (detail?.controlId) parts.push('UI操作');
    return parts.join(' / ');
  }

  function buildSupportActivitySummary(limit = 8) {
    const lines = [];
    const view = window.state?.view || '';
    const path = typeof getCurrentFilePath === 'function' ? getCurrentFilePath() : '';
    if (view) lines.push(`画面: ${view}`);
    const settingsPanel = _currentSettingsPanelName();
    if (settingsPanel) lines.push(`設定画面: ${settingsPanel}`);
    if (path) {
      lines.push('対象: 現在のファイル（名前は送信しません）');
      const facts = _targetFacts(path);
      lines.push(`対象情報: 拡張子=${facts.extension} / 匿名ID=${facts.targetId} / 階層=${facts.depth}`);
    }
    const cloudState = _cloudStateDigest();
    lines.push(`保存先: ${cloudState.mode}${cloudState.connected ? ' / 接続済み' : ''}${cloudState.access ? ' / ' + cloudState.access : ''}`);
    const operations = _collectSupportOperationEntries(limit);
    const entries = operations.length ? [] : _collectSupportHistoryEntries(limit);
    if (operations.length) {
      lines.push('直近の操作:');
      operations.forEach(entry => {
        const time = entry.time ? new Date(entry.time).toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }) : '';
        const detail = _operationDetailText(entry.detail);
        lines.push(`- ${time} ${entry.label}${detail ? ' / ' + detail : ''}`);
      });
    } else if (entries.length) {
      lines.push('直近の操作:');
      entries.forEach(entry => {
        const time = entry.time ? new Date(entry.time).toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }) : '';
        const status = entry._supportType === 'redo' ? 'やり直し待ち' : '実行済み';
        const scope = entry.scope ? '対象あり' : '全体';
        lines.push(`- ${time} [${scope} / ${status}] 操作記録`);
      });
    } else {
      lines.push('直近の操作: 取得できませんでした');
    }
    return lines.join('\n');
  }

  function _supportTechnicalSummary(remembered) {
    const lines = [];
    if (remembered?.friendly?.status) lines.push(`HTTP ${remembered.friendly.status}`);
    if (remembered?.message) lines.push(remembered.message);
    const api = apiErrors.slice(-3);
    if (api.length) {
      lines.push('recent api errors:');
      api.forEach(item => {
        const context = item.context || {};
        lines.push(`- ${context.method || 'GET'} ${context.endpoint || context.path || '[redacted]'} ${context.status || ''}`);
      });
    }
    return lines.filter(Boolean).join('\n') || remembered?.message || '';
  }

  function showSupportDialog(error, context) {
    const remembered = rememberError(error || lastError, context || {});
    const friendly = remembered.friendly || window.MeldexErrorMessages?.translate?.(error, context) || {};
    const activitySummary = buildSupportActivitySummary();
    if (supportDialogApi?.isOpen?.()) supportDialogApi.close('replace');
    document.querySelectorAll('.modal-overlay[data-support-dialog="1"]').forEach(existing => {
      existing.dispatchEvent(new CustomEvent('meldex-support-dialog-close'));
      if (existing.isConnected) existing.remove();
    });
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogSeq = ++supportDialogSeq;
    const titleId = `meldex-support-title-${dialogSeq}`;
    const descId = `meldex-support-desc-${dialogSeq}`;
    const content = document.createElement('div');
    content.innerHTML = `
      <section class="gb-section gb-section--boxed">
        <div class="gb-section-title">${esc(friendly.title || '操作に失敗しました')}</div>
        <div class="gb-section-desc">${esc(friendly.message || '')}</div>
        <div class="gb-section-desc">${esc(friendly.action || '')}</div>
      </section>
      <label class="gb-field meldex-support-field">
        <span class="gb-label">直前の操作（自動入力）</span>
        <textarea id="meldex-support-activity" class="gb-input meldex-support-textarea meldex-support-textarea--activity" rows="7" readonly aria-label="直前の操作（自動入力）">${esc(activitySummary)}</textarea>
      </label>
      <label class="gb-field meldex-support-field">
        <span class="gb-label">補足コメント</span>
        <textarea id="meldex-support-comment" class="gb-input meldex-support-textarea meldex-support-textarea--comment" rows="8" aria-label="補足コメント" placeholder="再現条件、発生頻度、補足事項など"></textarea>
      </label>
      <details class="meldex-support-details" data-e2e-id="meldex-support-technical-details">
        <summary>技術的詳細</summary>
        <pre class="meldex-support-technical">${esc(_supportTechnicalSummary(remembered))}</pre>
      </details>
      <div class="gb-inline-error" role="alert" data-support-error hidden></div>`;
    const footerContent = document.createElement('div');
    footerContent.innerHTML = `
      <button type="button" class="gb-btn gb-btn-sm" data-support-action="export" data-e2e-id="meldex-support-export" aria-label="診断情報を保存">診断情報を保存</button>
      <button type="button" class="gb-btn gb-btn-sm gb-btn-primary" data-support-action="send" data-e2e-id="meldex-support-send" aria-label="サポート情報を送信または保存">送信 / 保存</button>
      <button type="button" class="gb-btn gb-btn-sm" data-support-action="close" data-e2e-id="meldex-support-close" aria-label="サポート送信を閉じる">閉じる</button>`;
    const commentInput = content.querySelector('#meldex-support-comment');
    let busy = false;
    let dialogApi = null;
    dialogApi = window.GBUI.createModal({
      id: `meldex-support-dialog-${dialogSeq}`,
      titleId,
      title: 'サポートに送信',
      body: Array.from(content.childNodes),
      footer: Array.from(footerContent.childNodes),
      variant: 'standard',
      extraClass: 'meldex-support-dialog',
      geometryKey: 'meldex-support-dialog',
      initialFocus: commentInput,
      returnFocus: opener,
      onBeforeClose: () => !busy,
      onClose: () => {
        if (supportDialogApi === dialogApi) supportDialogApi = null;
      },
    });
    supportDialogApi = dialogApi;
    const { overlay, modal: dialog, header, body, footer } = dialogApi;
    overlay.classList.add('modal-overlay');
    overlay.dataset.supportDialog = '1';
    overlay.style.zIndex = '100070';
    dialog.classList.add('modal');
    dialog.dataset.e2eId = 'meldex-support-dialog';
    dialog.setAttribute('aria-describedby', descId);
    const title = header.querySelector('.gb-modal-title');
    title?.classList.add('meldex-support-dialog-title');
    if (title && typeof lucide === 'function') title.insertAdjacentHTML('afterbegin', lucide('lifeBuoy', 16));
    const headerClose = header.querySelector('.gb-modal-close');
    if (headerClose) headerClose.dataset.e2eId = 'meldex-support-header-close';
    body.id = descId;
    body.classList.add('meldex-support-dialog-body');
    footer.classList.add('btn-row', 'meldex-support-actions');
    footer.setAttribute('data-modal-footer', '');
    const closeDialog = () => dialogApi.close('external');
    overlay.addEventListener('meldex-support-dialog-close', closeDialog);
    dialogApi.open();
    replaceIcons(overlay);
    const buildSupportPayload = () => {
      const comment = overlay.querySelector('#meldex-support-comment')?.value || '';
      const activity = overlay.querySelector('#meldex-support-activity')?.value || activitySummary;
      return {
        ...remembered,
        activitySummary: activity,
        operationLogs: operationLogs.slice(-30),
        apiErrors: apiErrors.slice(-30),
        cloudState: _cloudStateDigest(),
        comment,
        kind: 'support-report',
      };
    };
    const setBusy = (nextBusy) => {
      busy = !!nextBusy;
      dialog.setAttribute('aria-busy', busy ? 'true' : 'false');
      dialog.querySelectorAll('button, textarea:not([readonly])').forEach(control => { control.disabled = busy; });
      header.querySelector('.gb-modal-close')?.toggleAttribute('disabled', busy);
    };
    const showSupportFailure = (failure) => {
      const errorEl = dialog.querySelector('[data-support-error]');
      if (!errorEl) return;
      errorEl.textContent = `診断情報を保存できませんでした。もう一度お試しください。${failure?.message ? `（${_redactDiagnosticText(failure.message)}）` : ''}`;
      errorEl.hidden = false;
    };
    const clearSupportFailure = () => {
      const errorEl = dialog.querySelector('[data-support-error]');
      if (!errorEl) return;
      errorEl.hidden = true;
      errorEl.textContent = '';
    };
    overlay.querySelector('[data-support-action="close"]')?.addEventListener('click', () => dialogApi.close('footer'));
    overlay.querySelector('[data-support-action="export"]')?.addEventListener('click', async () => {
      clearSupportFailure();
      setBusy(true);
      try {
        await exportDiagnostics({ error: buildSupportPayload() });
      } catch (failure) {
        showSupportFailure(failure);
      } finally {
        setBusy(false);
      }
    });
    overlay.querySelector('[data-support-action="send"]')?.addEventListener('click', async () => {
      clearSupportFailure();
      setBusy(true);
      const payload = buildSupportPayload();
      if (window.MeldexBetaFeedback?.sendDebuggerReport) {
        try {
          const result = await window.MeldexBetaFeedback.sendDebuggerReport({
            reportType: 'bug',
            origin: 'support-dialog',
            sections: [{ heading: 'サポート情報', body: '不具合の調査用に、この端末の状況をまとめて送信しました。' }],
            details: payload,
          });
          if (result?.ok) {
            if (typeof showStatus === 'function') {
              showStatus(result.flush?.sent ? 'サポート情報を送信しました' : 'サポート情報を送信待ちに保存しました');
            }
            setBusy(false);
            dialogApi.close('send-success');
            return;
          }
        } catch (_) {}
      }
      try {
        await exportDiagnostics({ error: payload });
        if (typeof showStatus === 'function') showStatus('送信先が未設定のため、診断情報を保存しました');
        setBusy(false);
        dialogApi.close('export-fallback');
      } catch (failure) {
        setBusy(false);
        showSupportFailure(failure);
      }
    });
  }

  function _isCompactErrorNoticeViewport() {
    try {
      if (window.matchMedia?.('(max-width: 700px), (pointer: coarse)')?.matches) return true;
      return window.innerWidth <= 700;
    } catch (_) {
      return false;
    }
  }

  function _errorNoticeStyle(compact) {
    const common = 'position:fixed;z-index:100060;background:var(--bg2);color:var(--fg);border:1px solid var(--red);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:12px;display:flex;flex-direction:column;gap:8px;font-size:13px;box-sizing:border-box;pointer-events:auto;';
    if (compact) {
      return common + 'left:12px;right:12px;top:calc(env(safe-area-inset-top, 0px) + 12px);bottom:auto;max-height:min(42vh,320px);overflow:auto;';
    }
    return common + 'right:18px;bottom:34px;max-width:360px;';
  }

  function _hasBlockingStartupDialogForNotice() {
    try {
      return !!document.querySelector([
        '#meldex-beta-consent-overlay',
        '#meldex-cloud-home-first-overlay',
        '#meldex-cloud-home-only',
        '.meldex-cloud-mode-overlay',
        '.meldex-cloud-mode-modal',
        '.meldex-cloud-setup-overlay',
        '.meldex-cloud-setup-modal',
        '.meldex-sample-install-overlay',
        '[data-draft-recovery-dialog="1"]',
      ].join(', '));
    } catch {
      return false;
    }
  }

  function _installStartupNoticeInteractionWatch() {
    const mark = () => { userInteractedBeforeNotice = true; };
    ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
      document.addEventListener(eventName, mark, { capture: true, once: true, passive: true });
    });
  }

  function _isCloudStartupNoticeQuietPeriod() {
    if (userInteractedBeforeNotice || Date.now() >= startupNoticeQuietUntil) return false;
    try {
      const params = new URLSearchParams(window.location.search || '');
      const cloudMode = document.body?.dataset?.cloudMode === 'dropbox' || params.get('dataAccessMode') === 'dropbox';
      return cloudMode && _isCompactErrorNoticeViewport();
    } catch {
      return false;
    }
  }

  function _noticeFingerprint(friendly, context) {
    return [friendly?.title || '', friendly?.status || 0, context?.method || 'GET', _safeEndpoint(context?.path || '')].join('|');
  }

  function showErrorNotice(error, context) {
    const friendly = window.MeldexErrorMessages?.translate?.(error, context) || null;
    if (!friendly) return;
    if (_isCompactErrorNoticeViewport() && (_hasBlockingStartupDialogForNotice() || _isCloudStartupNoticeQuietPeriod())) {
      setTimeout(() => {
        if (!_hasBlockingStartupDialogForNotice() && !_isCloudStartupNoticeQuietPeriod()) showErrorNotice(error, context);
        else if (_isCloudStartupNoticeQuietPeriod()) showErrorNotice(error, context);
      }, 1200);
      return;
    }
    const fingerprint = _noticeFingerprint(friendly, context);
    const now = Date.now();
    const existing = document.getElementById('meldex-error-support-notice');
    if (existing && existing.dataset.noticeFingerprint === fingerprint) {
      // 同じ種類の失敗が連続発生: トーストを積み増さず、表示中のものの自動消去だけ延長する
      // （「操作に失敗しました」が頻発して見える不具合の対策）。記録自体はcaptureApiError側で継続する。
      _lastNoticeShownAt = now;
      existing._meldexExtendDismiss?.();
      return;
    }
    if (!existing && fingerprint === _lastNoticeFingerprint && (now - _lastNoticeShownAt) < NOTICE_DEDUPE_MS) {
      // 直近で同種の失敗のトーストを表示・消去済み: クールダウン中は再表示を抑制する。
      return;
    }
    if (existing) existing.remove();
    const notice = document.createElement('div');
    const compact = _isCompactErrorNoticeViewport();
    notice.id = 'meldex-error-support-notice';
    notice.dataset.noticeFingerprint = fingerprint;
    notice.setAttribute('role', 'alertdialog');
    notice.setAttribute('aria-live', 'assertive');
    notice.setAttribute('aria-labelledby', 'meldex-error-support-title');
    notice.setAttribute('aria-describedby', 'meldex-error-support-desc');
    if (compact) notice.dataset.compact = '1';
    notice.style.cssText = _errorNoticeStyle(compact);
    notice.innerHTML = `<div class="meldex-error-notice-head">
        <div id="meldex-error-support-title" class="meldex-error-notice-title">${esc(friendly.title)}</div>
        <button class="gb-btn gb-btn-sm meldex-error-notice-close" type="button" data-error-action="close" data-e2e-id="error-support-close" aria-label="閉じる">×</button>
      </div>
      <div id="meldex-error-support-desc" class="meldex-error-notice-action">${esc(friendly.action)}</div>
      <div class="meldex-error-notice-actions">
        <button class="gb-btn gb-btn-sm" type="button" data-error-action="details" data-e2e-id="error-support-details" aria-label="技術的詳細を開く">詳細</button>
        <button class="gb-btn gb-btn-sm gb-btn-primary" type="button" data-error-action="support" data-e2e-id="error-support-send" aria-label="報告画面を開く">報告画面を開く</button>
      </div>`;
    document.body.appendChild(notice);
    let autoDismissTimer = 0;
    const closeNotice = () => {
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
      notice.remove();
    };
    const scheduleAutoDismiss = () => {
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
      autoDismissTimer = setTimeout(closeNotice, compact ? 7000 : 12000);
    };
    notice._meldexExtendDismiss = scheduleAutoDismiss;
    const openSupport = () => {
      closeNotice();
      showSupportDialog(error, context);
    };
    notice.querySelector('[data-error-action="close"]')?.addEventListener('click', closeNotice);
    notice.querySelector('[data-error-action="details"]')?.addEventListener('click', openSupport);
    notice.querySelector('[data-error-action="support"]')?.addEventListener('click', openSupport);
    scheduleAutoDismiss();
    _lastNoticeFingerprint = fingerprint;
    _lastNoticeShownAt = now;
  }

  _installConsoleCapture();
  _installOperationCapture();
  _installStartupNoticeInteractionWatch();

  window.MeldexDiagnostics = {
    rememberError,
    captureApiError,
    recordOperation,
    showSupportDialog,
    showErrorNotice,
    buildDiagnostics,
    exportDiagnostics,
    buildSupportActivitySummary,
  };
  window.exportMeldexDiagnostics = exportDiagnostics;
})();
