"use strict";
var DebuggerCrashClient = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // packages/crash-client-web/src/index.ts
  var index_exports = {};
  __export(index_exports, {
    CrashReporter: () => CrashReporter,
    redactCrashText: () => redactCrashText
  });
  var maximumQueuedReports = 20;
  var maximumRetryDelayMilliseconds = 3e5;
  var initialRetryDelayMilliseconds = 1e3;
  var duplicateWindowMilliseconds = 6e4;
  var sensitiveKeyPattern = /(?:authorization|password|passwd|secret|token|api[_-]?key)/iu;
  var secretPatterns = [
    [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, "Bearer [\u4F0F\u305B\u5B57]"],
    [/(\b(?:authorization|password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*)[^\s,;]+/giu, "$1[\u4F0F\u305B\u5B57]"],
    [/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[opsu]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|ya29\.[A-Za-z0-9_-]{10,})\b/gu, "[\u4F0F\u305B\u5B57]"],
    [/([?&](?:access_token|api_key|key|password|secret|token)=)[^&\s]+/giu, "$1[\u4F0F\u305B\u5B57]"],
    [/"[A-Z]:\\Users\\[^"\r\n]+"/giu, '"C:\\Users\\<user>\\<path>"'],
    [/'[A-Z]:\\Users\\[^'\r\n]+'/giu, "'C:\\Users\\<user>\\<path>'"],
    [/[A-Z]:\\Users\\[^\\\s"']+(?:\\[^\s"'<>|]+)*/giu, "C:\\Users\\<user>\\<path>"],
    [/"[A-Z]:\\[^"\r\n]+"/giu, '"<local-path>"'],
    [/'[A-Z]:\\[^'\r\n]+'/giu, "'<local-path>'"],
    [/\b[A-Z]:\\[^\s,;"']+/giu, "<local-path>"],
    [/\/(?:Users|home)\/[^/\s"']+(?:\/[^\s"'<>|]+)*/gu, "/home/<user>/<path>"],
    [/\b[^\s\\/:*?"<>|]+\.blend\b/giu, "<blend-file>"],
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[\u4F0F\u305B\u5B57\u30E1\u30FC\u30EB]"]
  ];
  function redactCrashText(value, maximumLength) {
    let redacted = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
    for (const [pattern, replacement] of secretPatterns) redacted = redacted.replace(pattern, replacement);
    redacted = redacted.replace(/\bhttps?:\/\/[^\s)\]}>"']+/giu, (raw) => {
      try {
        return `${new URL(raw).origin}/<path>`;
      } catch {
        return "<url>";
      }
    });
    return redacted.slice(0, maximumLength);
  }
  function redactStack(value) {
    return redactCrashText(value, 12e3).replace(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:[cm]?[jt]sx?|map)\b/giu, "<source>");
  }
  function safeContext(context) {
    return Object.fromEntries(Object.entries(context).slice(0, 20).map(([key, value]) => {
      const safeKey = redactCrashText(key.trim() || "context", 100);
      if (sensitiveKeyPattern.test(key)) return [safeKey, "[\u4F0F\u305B\u5B57]"];
      return [safeKey, typeof value === "string" ? redactCrashText(value, 500) : value];
    }));
  }
  function errorDetails(reason, includeMessage) {
    if (reason instanceof Error) {
      const errorType = redactCrashText(reason.name || "Error", 200);
      const base = {
        errorType,
        message: includeMessage ? redactCrashText(reason.message || "\u4E0D\u660E\u306A\u30D6\u30E9\u30A6\u30B6\u30FC\u30A8\u30E9\u30FC", 2e3) : `Unhandled ${errorType}`,
        signature: `${reason.name}
${reason.message}`
      };
      return reason.stack ? { ...base, stack: redactStack(reason.stack) } : base;
    }
    if (typeof reason === "string") {
      return {
        errorType: "Error",
        message: includeMessage ? redactCrashText(reason, 2e3) : "Unhandled Error",
        signature: reason
      };
    }
    return {
      errorType: "UnknownError",
      message: "\u975EError\u5024\u306B\u3088\u308B\u30D6\u30E9\u30A6\u30B6\u30FC\u30A8\u30E9\u30FC",
      signature: Object.prototype.toString.call(reason)
    };
  }
  function isReport(value) {
    if (!value || typeof value !== "object") return false;
    const report = value;
    return typeof report.projectSlug === "string" && typeof report.version === "string" && typeof report.installationId === "string" && report.runtime === "browser" && typeof report.component === "string" && (report.severity === "error" || report.severity === "fatal") && typeof report.errorType === "string" && typeof report.message === "string" && typeof report.occurredAt === "string" && typeof report.idempotencyKey === "string" && Boolean(report.context && typeof report.context === "object");
  }
  function isOutboxItem(value) {
    if (!value || typeof value !== "object") return false;
    const item = value;
    return isReport(item.report) && typeof item.attempt === "number" && Number.isInteger(item.attempt) && item.attempt >= 0 && typeof item.nextAttemptAt === "number" && Number.isFinite(item.nextAttemptAt);
  }
  function retryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  function retryAfterMilliseconds(response) {
    const header = response.headers.get("Retry-After");
    if (!header) return void 0;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1e3, maximumRetryDelayMilliseconds);
    const date = Date.parse(header);
    if (!Number.isFinite(date)) return void 0;
    return Math.min(Math.max(date - Date.now(), 0), maximumRetryDelayMilliseconds);
  }
  var CrashReporter = class {
    constructor(config) {
      this.config = config;
      this.assertConfig();
      this.now = config.now ?? Date.now;
      this.randomUUID = config.randomUUID ?? (() => globalThis.crypto.randomUUID());
      const browserStorage = (() => {
        try {
          return config.browserWindow?.localStorage ?? (typeof window === "undefined" ? void 0 : window.localStorage);
        } catch {
          return void 0;
        }
      })();
      this.storage = config.storage ?? browserStorage;
      this.storageAvailable = Boolean(this.storage);
      this.fetcher = config.fetcher ?? globalThis.fetch.bind(globalThis);
      const namespace = `${config.projectSlug}.${config.component}`;
      this.queueKey = `debugger.crash-client-web.outbox.v1.${namespace}`;
      this.installationKey = `debugger.crash-client-web.installation.v1.${config.projectSlug}`;
      this.installationId = this.loadInstallationId();
    }
    config;
    storage;
    fetcher;
    now;
    randomUUID;
    installationId;
    queueKey;
    installationKey;
    recent = /* @__PURE__ */ new Map();
    memoryQueue = [];
    storageAvailable;
    flushPromise = null;
    retryTimer = null;
    install(options = {}) {
      const browserWindow = this.config.browserWindow ?? (typeof window === "undefined" ? void 0 : window);
      if (!browserWindow) return () => void 0;
      const errorHandler = (event) => {
        this.capture(event.error ?? event.message, {
          context: {
            source: "window.error",
            line: event.lineno,
            column: event.colno
          }
        });
      };
      const rejectionHandler = (event) => {
        this.capture(event.reason, { context: { source: "unhandledrejection" } });
      };
      const onlineHandler = () => {
        void this.flush();
      };
      if (options.windowErrors !== false) browserWindow.addEventListener("error", errorHandler);
      if (options.unhandledRejections !== false) browserWindow.addEventListener("unhandledrejection", rejectionHandler);
      if (options.flushWhenOnline !== false) browserWindow.addEventListener("online", onlineHandler);
      void this.flush();
      return () => {
        browserWindow.removeEventListener("error", errorHandler);
        browserWindow.removeEventListener("unhandledrejection", rejectionHandler);
        browserWindow.removeEventListener("online", onlineHandler);
        this.clearScheduledRetry();
      };
    }
    capture(reason, options = {}) {
      try {
        const details = errorDetails(reason, this.config.includeErrorMessage === true);
        const { signature, ...reportDetails } = details;
        const now = this.now();
        this.pruneRecent(now);
        if (now - (this.recent.get(signature) ?? Number.NEGATIVE_INFINITY) < duplicateWindowMilliseconds) return;
        this.recent.set(signature, now);
        const diagnostics = this.config.diagnosticsConsented === true ? this.safeDiagnostics(options.diagnostics) : void 0;
        const report = {
          projectSlug: this.config.projectSlug,
          version: this.config.version,
          installationId: this.installationId,
          runtime: "browser",
          component: this.config.component,
          severity: options.severity ?? "error",
          ...reportDetails,
          context: safeContext(options.context ?? {}),
          ...diagnostics ? { diagnostics, diagnosticsConsented: true } : {},
          occurredAt: new Date(now).toISOString(),
          idempotencyKey: `browser-${this.randomUUID()}`
        };
        const queue = this.loadQueue();
        if (queue.length >= maximumQueuedReports) {
          const discarded = queue.shift();
          this.notifyDiscard({
            reason: "outbox_full",
            ...discarded ? { idempotencyKey: discarded.report.idempotencyKey } : {}
          });
        }
        queue.push({ report, attempt: 0, nextAttemptAt: 0 });
        this.saveQueue(queue);
        void this.flush();
      } catch {
      }
    }
    async flush() {
      let sent = 0;
      while (true) {
        if (!this.flushPromise) {
          this.flushPromise = this.flushQueue().finally(() => {
            this.flushPromise = null;
          });
        }
        sent += await this.flushPromise;
        const current = this.loadQueue()[0];
        if (!current || current.nextAttemptAt > this.now()) {
          return { ...this.status(), sent };
        }
      }
    }
    status() {
      const queue = this.loadQueue();
      return {
        ok: queue.length === 0,
        pending: queue.length,
        nextAttemptAt: queue.length ? Math.min(...queue.map((item) => item.nextAttemptAt)) : null,
        sent: 0
      };
    }
    /** Remove every unsent report after the user withdraws reporting consent. */
    clear() {
      this.clearScheduledRetry();
      this.recent.clear();
      this.saveQueue([]);
    }
    async flushQueue() {
      let sent = 0;
      try {
        while (true) {
          const queue = this.loadQueue();
          const current = queue[0];
          if (!current) {
            this.clearScheduledRetry();
            return sent;
          }
          const wait = current.nextAttemptAt - this.now();
          if (wait > 0) {
            this.scheduleRetry(wait);
            return sent;
          }
          let response;
          try {
            response = await this.fetcher(this.config.endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(current.report),
              keepalive: true,
              credentials: "omit",
              redirect: "error",
              referrerPolicy: "no-referrer"
            });
          } catch {
            this.defer(current);
            return sent;
          }
          if (response.ok) {
            this.remove(current.report.idempotencyKey);
            sent += 1;
            continue;
          }
          if (retryableStatus(response.status)) {
            this.defer(current, retryAfterMilliseconds(response));
            return sent;
          }
          this.remove(current.report.idempotencyKey);
          this.notifyDiscard({
            reason: "non_retryable_response",
            idempotencyKey: current.report.idempotencyKey,
            status: response.status
          });
        }
      } catch {
        return sent;
      }
    }
    defer(current, requestedDelay) {
      const attempt = current.attempt + 1;
      const exponentialDelay = Math.min(
        initialRetryDelayMilliseconds * 2 ** Math.min(attempt - 1, 18),
        maximumRetryDelayMilliseconds
      );
      const delay = requestedDelay === void 0 ? exponentialDelay : Math.max(exponentialDelay, requestedDelay);
      const queue = this.loadQueue();
      const index = queue.findIndex((item) => item.report.idempotencyKey === current.report.idempotencyKey);
      if (index < 0) return;
      queue[index] = { ...queue[index], attempt, nextAttemptAt: this.now() + delay };
      this.saveQueue(queue);
      this.scheduleRetry(delay);
    }
    remove(idempotencyKey) {
      this.saveQueue(this.loadQueue().filter((item) => item.report.idempotencyKey !== idempotencyKey));
    }
    safeDiagnostics(diagnostics) {
      if (!diagnostics) return void 0;
      const safe = {};
      if (diagnostics.logTail) safe.logTail = redactCrashText(diagnostics.logTail, 12e3);
      if (diagnostics.breadcrumbs?.length) {
        safe.breadcrumbs = diagnostics.breadcrumbs.slice(-50).map((item) => redactCrashText(item, 300));
      }
      return safe.logTail || safe.breadcrumbs?.length ? safe : void 0;
    }
    loadInstallationId() {
      try {
        const stored = this.storage?.getItem(this.installationKey);
        if (stored && stored.length >= 16 && stored.length <= 200) return stored;
        const created = `debugger-web-${this.randomUUID()}`;
        this.storage?.setItem(this.installationKey, created);
        return created;
      } catch {
        this.storageAvailable = false;
        return `debugger-web-${this.randomUUID()}`;
      }
    }
    loadQueue() {
      if (!this.storageAvailable) return [...this.memoryQueue];
      try {
        const parsed = JSON.parse(this.storage?.getItem(this.queueKey) ?? "[]");
        if (!Array.isArray(parsed)) {
          this.notifyDiscard({ reason: "invalid_stored_report" });
          this.saveQueue([]);
          return [];
        }
        const valid = parsed.filter(isOutboxItem).slice(-maximumQueuedReports);
        if (valid.length !== parsed.length) {
          for (const entry of parsed) {
            if (!isOutboxItem(entry)) this.notifyDiscard({ reason: "invalid_stored_report" });
          }
          this.storage?.setItem(this.queueKey, JSON.stringify(valid));
        }
        this.memoryQueue = valid;
        return [...valid];
      } catch {
        this.storageAvailable = false;
        return [...this.memoryQueue];
      }
    }
    saveQueue(queue) {
      this.memoryQueue = [...queue];
      if (!this.storageAvailable) return;
      try {
        this.storage?.setItem(this.queueKey, JSON.stringify(queue));
      } catch {
        this.storageAvailable = false;
      }
    }
    scheduleRetry(delayMilliseconds) {
      if (this.retryTimer !== null) return;
      const schedule = this.config.browserWindow?.setTimeout.bind(this.config.browserWindow) ?? globalThis.setTimeout;
      this.retryTimer = schedule(() => {
        this.retryTimer = null;
        void this.flush();
      }, Math.min(Math.max(delayMilliseconds, 0), maximumRetryDelayMilliseconds));
    }
    clearScheduledRetry() {
      if (this.retryTimer === null) return;
      const clear = this.config.browserWindow?.clearTimeout.bind(this.config.browserWindow) ?? globalThis.clearTimeout;
      clear(this.retryTimer);
      this.retryTimer = null;
    }
    pruneRecent(now) {
      for (const [signature, capturedAt] of this.recent) {
        if (now - capturedAt >= duplicateWindowMilliseconds) this.recent.delete(signature);
      }
    }
    notifyDiscard(event) {
      try {
        this.config.onDiscard?.(event);
      } catch {
      }
    }
    assertConfig() {
      if (!/^https?:\/\//u.test(this.config.endpoint) && !this.config.endpoint.startsWith("/")) {
        throw new TypeError("endpoint must be an HTTP(S) URL or an absolute path");
      }
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(this.config.projectSlug)) {
        throw new TypeError("projectSlug does not match the Debugger API contract");
      }
      if (!this.config.version.trim() || this.config.version.length > 100) {
        throw new TypeError("version must contain 1-100 characters");
      }
      if (!this.config.component.trim() || this.config.component.length > 100) {
        throw new TypeError("component must contain 1-100 characters");
      }
    }
  };
  return __toCommonJS(index_exports);
})();
