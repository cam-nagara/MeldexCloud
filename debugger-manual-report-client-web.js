(function (root) {
  'use strict';

  const MAX_QUEUE_ITEMS = 20;
  const MAX_ATTEMPTS = 10;
  const QUEUE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const MAX_RETRY_MS = 5 * 60 * 1000;
  const INSTALLATION_PREFIX = 'debugger.crash-client-web.installation.v1.';
  const OUTBOX_PREFIX = 'debugger.manual-report-web.outbox.v1.';
  const PROJECT_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
  const REPORT_TYPES = new Set(['bug', 'request', 'question']);

  function _uuid() {
    try {
      if (root.crypto?.randomUUID) return root.crypto.randomUUID();
    } catch (_) {}
    return `meldex-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
  }

  function _safeJson(value) {
    try { return JSON.stringify(value); } catch (_) { return '{}'; }
  }

  function _message(error, fallback) {
    return String(error?.message || error || fallback || '送信できませんでした').slice(0, 500);
  }

  function _redactUrl(raw) {
    try {
      const parsed = new URL(raw);
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch (_) {
      return '[url]';
    }
  }

  function redactReportText(value) {
    let text = String(value == null ? '' : value);
    text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]');
    text = text.replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
    text = text.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[opsu]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|ya29\.[A-Za-z0-9_-]{10,})\b/gi, '[redacted]');
    text = text.replace(/file:\/\/\/[^\s<>"']+/gi, 'file:///[local-path]');
    text = text.replace(/\b[A-Z]:\\Users\\[^\\\s"'<>|]+(?:\\[^\s"'<>|]+)*/gi, 'C:\\Users\\[user]\\[local-path]');
    text = text.replace(/\b[A-Z]:\\[^\s,;"']+/gi, '[local-path]');
    text = text.replace(/\/(?:Users|home)\/[^/\s"']+(?:\/[^\s"'<>]*)?/g, '/home/[user]/[local-path]');
    text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
    text = text.replace(/https?:\/\/[^\s<>"']+/gi, _redactUrl);
    return text.slice(0, 10000);
  }

  class ManualReportClient {
    constructor(options) {
      const config = options || {};
      this.endpoint = String(config.endpoint || '').trim();
      this.projectSlug = String(config.projectSlug || '').trim();
      this.version = String(config.version || 'unknown').trim().slice(0, 100) || 'unknown';
      this.source = String(config.source || 'meldex').trim().slice(0, 30) || 'meldex';
      this.component = String(config.component || 'meldex').trim().replace(/[^a-z0-9_.-]/gi, '-').slice(0, 80) || 'meldex';
      this.storage = config.storage === undefined ? root.localStorage : config.storage;
      this.fetcher = config.fetcher || root.fetch?.bind(root);
      this.now = typeof config.now === 'function' ? config.now : () => Date.now();
      this.randomUUID = typeof config.randomUUID === 'function' ? config.randomUUID : _uuid;
      this.onDelivery = typeof config.onDelivery === 'function' ? config.onDelivery : null;
      this.browserWindow = config.browserWindow === undefined ? root.window || root : config.browserWindow;
      this.installationKey = INSTALLATION_PREFIX + this.projectSlug;
      this.outboxKey = `${OUTBOX_PREFIX}${this.projectSlug}.${this.component}`;
      this._operationTail = Promise.resolve();
      this._lastFailed = 0;
      this._onlineHandler = null;
      this._retryTimer = null;
      this._installed = false;
    }

    configured() {
      if (!PROJECT_SLUG_RE.test(this.projectSlug)) return false;
      try {
        const parsed = new URL(this.endpoint);
        return parsed.protocol === 'https:'
          && !parsed.username
          && !parsed.password
          && !parsed.search
          && !parsed.hash
          && parsed.pathname === '/api/v1/public/reports';
      } catch (_) {
        return false;
      }
    }

    _runExclusive(work) {
      const operation = this._operationTail.catch(() => {}).then(work);
      this._operationTail = operation.catch(() => {});
      return operation;
    }

    _read(key) {
      try { return this.storage?.getItem?.(key) || ''; } catch (_) { return ''; }
    }

    _write(key, value) {
      try {
        if (!this.storage?.setItem) return false;
        this.storage.setItem(key, value);
        return true;
      } catch (_) {
        return false;
      }
    }

    _installationId() {
      const current = this._read(this.installationKey).trim();
      if (current.length >= 16 && current.length <= 200) return current;
      const created = String(this.randomUUID() || _uuid()).slice(0, 200);
      this._write(this.installationKey, created);
      return created.length >= 16 ? created : `${created}-${_uuid()}`.slice(0, 200);
    }

    _queue() {
      try {
        const parsed = JSON.parse(this._read(this.outboxKey) || '[]');
        return Array.isArray(parsed) ? parsed.filter(item => item && item.report) : [];
      } catch (_) {
        return [];
      }
    }

    _saveQueue(queue) {
      return this._write(this.outboxKey, _safeJson(queue));
    }

    async _notify(event) {
      if (!this.onDelivery) return;
      try { await this.onDelivery(event); } catch (_) {}
    }

    _report(input) {
      const reportType = REPORT_TYPES.has(input?.reportType) ? input.reportType : 'bug';
      return {
        projectSlug: this.projectSlug,
        source: this.source === 'web' || this.source === 'other' ? this.source : 'meldex',
        version: this.version,
        installationId: this._installationId(),
        reportType,
        body: redactReportText(input?.body || ''),
        consentedLogs: false,
        artifactIds: [],
        idempotencyKey: String(this.randomUUID() || _uuid()).slice(0, 200),
      };
    }

    _retryDelay(attempts, response) {
      const retryAfter = Number(response?.headers?.get?.('Retry-After') || 0);
      if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(MAX_RETRY_MS, retryAfter * 1000);
      const base = Math.min(MAX_RETRY_MS, 1000 * (2 ** Math.min(8, Math.max(0, attempts - 1))));
      return Math.max(1000, Math.round(base * (0.8 + Math.random() * 0.4)));
    }

    async _send(item) {
      if (typeof this.fetcher !== 'function') return { status: 'pending', lastError: '通信機能を利用できません' };
      try {
        const response = await this.fetcher(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: _safeJson(item.report),
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          keepalive: true,
        });
        let payload = {};
        try { payload = await response.json(); } catch (_) {}
        if (response.ok) {
          return {
            status: 'sent',
            issueId: String(payload?.issueId || payload?.reportId || payload?.id || ''),
            duplicateOf: String(payload?.duplicateOf || ''),
          };
        }
        const lastError = String(payload?.message || payload?.error || `HTTP ${response.status}`).slice(0, 500);
        if ([408, 425, 429].includes(response.status) || response.status >= 500) {
          return { status: 'pending', lastError, response };
        }
        return { status: 'failed', lastError };
      } catch (error) {
        return { status: 'pending', lastError: _message(error, '通信できません') };
      }
    }

    submit(input) {
      return this._runExclusive(() => this._submitNow(input));
    }

    async _submitNow(input) {
      if (!this.configured()) {
        return { ok: false, skipped: true, configured: false, reason: 'debugger-not-configured', delivery: { status: 'failed', lastError: '送信先が設定されていません' } };
      }
      const report = this._report(input);
      if (!report.body.trim()) {
        return { ok: false, skipped: true, reason: 'empty-report', delivery: { status: 'failed', lastError: '報告内容が空です' } };
      }
      const timestamp = this.now();
      const item = {
        report,
        metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : {},
        queuedAt: timestamp,
        expiresAt: timestamp + QUEUE_TTL_MS,
        attempts: 0,
        nextAttemptAt: timestamp,
        lastError: '',
      };
      const queue = this._queue();
      while (queue.length >= MAX_QUEUE_ITEMS) {
        const discarded = queue.shift();
        await this._notify({ status: 'failed', idempotencyKey: discarded?.report?.idempotencyKey || '', metadata: discarded?.metadata || {}, lastError: '端末内の送信待ち上限を超えました' });
      }
      queue.push(item);
      if (!this._saveQueue(queue)) {
        const delivery = await this._send(item);
        await this._notify({ ...delivery, idempotencyKey: report.idempotencyKey, metadata: item.metadata });
        return delivery.status === 'sent'
          ? { ok: true, queued: false, delivery, flush: { sent: 1, pending: 0, failedNow: 0 } }
          : { ok: false, queued: false, delivery: { ...delivery, status: 'failed', lastError: `${delivery.lastError}。端末内の送信待ちにも保存できませんでした` } };
      }
      await this._notify({ status: 'pending', idempotencyKey: report.idempotencyKey, metadata: item.metadata, lastError: '送信結果を確認しています' });
      const flush = await this._flushNow();
      const delivery = flush.deliveries.find(entry => entry.idempotencyKey === report.idempotencyKey)
        || { status: 'pending', lastError: item.lastError || '端末内の送信待ちに保存しました' };
      return delivery.status === 'failed'
        ? { ok: false, queued: false, delivery, flush }
        : { ok: true, queued: delivery.status !== 'sent', delivery, flush };
    }

    flush() {
      return this._runExclusive(() => this._flushNow());
    }

    _clearRetryTimer() {
      if (this._retryTimer != null) this.browserWindow?.clearTimeout?.(this._retryTimer);
      this._retryTimer = null;
    }

    _scheduleRetry(queue) {
      this._clearRetryTimer();
      if (!this._installed || typeof this.browserWindow?.setTimeout !== 'function') return;
      const nextAttemptAt = queue.reduce((next, item) => {
        const candidate = Number(item?.nextAttemptAt || 0);
        return !next || (candidate && candidate < next) ? candidate : next;
      }, 0);
      if (!nextAttemptAt) return;
      const delay = Math.min(MAX_RETRY_MS, Math.max(0, nextAttemptAt - this.now()));
      this._retryTimer = this.browserWindow.setTimeout(() => {
        this._retryTimer = null;
        this.flush().catch(() => {});
      }, delay);
    }

    async _flushNow() {
      if (!this.configured()) {
        this._clearRetryTimer();
        return { ok: false, skipped: true, configured: false, reason: 'debugger-not-configured', sent: 0, pending: 0, failedNow: 0, deliveries: [] };
      }
      const queue = this._queue();
      const remaining = [];
      const deliveries = [];
      let sent = 0;
      let failedNow = 0;
      let rateLimited = false;
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        const now = this.now();
        const idempotencyKey = String(item?.report?.idempotencyKey || '');
        const baseEvent = { idempotencyKey, metadata: item?.metadata || {} };
        if (!idempotencyKey || now >= Number(item.expiresAt || 0) || Number(item.attempts || 0) >= MAX_ATTEMPTS) {
          const event = { ...baseEvent, status: 'failed', lastError: '再送期限または再送回数の上限に達しました' };
          deliveries.push(event);
          failedNow += 1;
          await this._notify(event);
          continue;
        }
        if (now < Number(item.nextAttemptAt || 0)) {
          remaining.push(item);
          continue;
        }
        const delivery = await this._send(item);
        const event = { ...baseEvent, ...delivery };
        deliveries.push(event);
        if (delivery.status === 'sent') {
          sent += 1;
          await this._notify(event);
          continue;
        }
        if (delivery.status === 'failed') {
          failedNow += 1;
          await this._notify(event);
          continue;
        }
        const isRateLimited = delivery.response?.status === 429;
        if (!isRateLimited) item.attempts = Number(item.attempts || 0) + 1;
        item.lastError = delivery.lastError;
        if (isRateLimited) rateLimited = true;
        item.nextAttemptAt = now + (isRateLimited
          ? MAX_RETRY_MS
          : this._retryDelay(item.attempts, delivery.response));
        delete delivery.response;
        remaining.push(item, ...queue.slice(index + 1));
        await this._notify(event);
        break;
      }
      this._lastFailed = failedNow;
      this._saveQueue(remaining);
      this._scheduleRetry(remaining);
      return { ok: failedNow === 0, sent, pending: remaining.length, failedNow, failed: failedNow, rateLimited, deliveries };
    }

    status() {
      const queue = this._queue();
      const nextAttemptAt = queue.reduce((next, item) => {
        const candidate = Number(item?.nextAttemptAt || 0);
        return !next || (candidate && candidate < next) ? candidate : next;
      }, 0);
      return {
        ok: this.configured(),
        configured: this.configured(),
        pending: queue.length,
        failed: this._lastFailed,
        nextAttemptAt: nextAttemptAt ? new Date(nextAttemptAt).toISOString() : null,
        browserManaged: true,
      };
    }

    install(options) {
      const flushWhenOnline = options?.flushWhenOnline !== false;
      this._installed = true;
      this.flush().catch(() => {});
      if (flushWhenOnline && this.browserWindow?.addEventListener) {
        if (this._onlineHandler) this.browserWindow.removeEventListener?.('online', this._onlineHandler);
        this._onlineHandler = () => { this.flush().catch(() => {}); };
        this.browserWindow.addEventListener('online', this._onlineHandler);
      }
      return () => {
        if (this._onlineHandler) this.browserWindow?.removeEventListener?.('online', this._onlineHandler);
        this._onlineHandler = null;
        this._installed = false;
        this._clearRetryTimer();
      };
    }
  }

  const api = Object.freeze({ ManualReportClient, redactReportText });
  root.DebuggerManualReportClient = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
