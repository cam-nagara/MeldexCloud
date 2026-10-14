/* Durable, ordered mutation outbox for standalone API writes. */
(function () {
  'use strict';

  const STORE_KEY = 'standalone-operation-outbox-v1';
  const BLOCKED_RE = /conflict|競合|etag|revision|更新情報|permission|権限|read.?only|ロック|容量|quota/i;
  const RETRYABLE_RE = /offline|network|failed to fetch|fetch failed|認証|unauthori|access.?token|接続|timeout|timed out/i;
  let installed = false;
  let flushing = false;
  let serial = Promise.resolve();
  let localWritePending = 0;
  let localWriteError = '';
  const originals = {};

  function id() {
    return crypto.randomUUID?.() || (`op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`);
  }

  function status(value, message, count) {
    const appId = document.documentElement?.getAttribute('data-standalone-app') || '';
    const label = document.getElementById(`${appId}-sync-status`) || document.getElementById('syncStatus');
    if (label) {
      label.textContent = message || (value === 'synced' ? '同期済み' : '');
      label.dataset.status = value;
    }
    window.dispatchEvent(new CustomEvent('meldex:standalone-outbox-status', {
      detail: { status: value, message: message || '', pendingCount: Number(count || 0) },
    }));
  }

  function endpoint(path) {
    try { return new URL(String(path || ''), location.href).pathname.replace(/^\/api/, '') || '/'; }
    catch { return String(path || '').split('?')[0].replace(/^\/api/, ''); }
  }

  function queryPath(path) {
    try { return new URL(String(path || ''), location.href).searchParams.get('path') || ''; }
    catch { return ''; }
  }

  function contextKey() {
    const cloud = window.MeldexStandaloneCloud;
    const state = cloud?.getStatus?.() || {};
    const root = cloud?.getActiveRoot?.() || {};
    return [
      state.provider || '',
      state.accountId || state.account_id || '',
      root.id || root.path || '',
    ].map(value => String(value || '')).join('|');
  }

  async function readQueue() {
    return window.MeldexStandaloneLocalDrafts?.getRaw?.(STORE_KEY, []) || [];
  }

  async function writeQueue(rows) {
    if (!window.MeldexStandaloneLocalDrafts?.putRaw) throw new Error('端末内保存を利用できません');
    await window.MeldexStandaloneLocalDrafts.putRaw(STORE_KEY, rows);
  }

  function enqueue(operation) {
    localWritePending += 1;
    serial = serial.then(async () => {
      const rows = await readQueue();
      const duplicate = rows.find(row => row.operationId === operation.operationId);
      if (!duplicate) rows.push(operation);
      await writeQueue(rows);
      status('pending', '端末に保存済み・同期待ち', rows.length);
      return operation;
    }).then(value => {
      localWriteError = '';
      return value;
    }).catch(error => {
      localWriteError = String(error?.message || error || '端末への保存に失敗しました');
      throw error;
    }).finally(() => {
      localWritePending = Math.max(0, localWritePending - 1);
    });
    return serial;
  }

  async function flushLocal() {
    try {
      await serial;
      return !localWriteError;
    } catch {
      return false;
    }
  }

  function getCloseState() {
    return {
      appId: 'offline-outbox',
      state: localWriteError ? 'error' : localWritePending ? 'local-saving' : 'clean',
      pendingLocal: localWritePending > 0,
      saving: localWritePending > 0,
      failed: !!localWriteError,
      unnamed: false,
      hasSnapshot: !localWriteError,
      hasFinalDestination: true,
      shouldWarn: localWritePending > 0 || !!localWriteError,
      message: localWriteError || (localWritePending ? '変更を端末へ保存しています' : ''),
    };
  }

  function withOperationId(body, operationId) {
    if (!body || typeof body !== 'object' || body instanceof FormData || body instanceof Blob) return body;
    const copy = structuredClone(body);
    if (!copy.operation_id) copy.operation_id = operationId;
    return copy;
  }

  function optimistic(path, body, operationId) {
    const ep = endpoint(path);
    const target = String(body?.path || body?.old_path || queryPath(path) || '');
    if (ep === '/outliner/add') {
      const parent = String(body?.parent || '').replace(/\/+$/, '');
      const name = String(body?.label || body?.name || '新規項目');
      return { ok: true, queued: true, operation_id: operationId, node: { path: [parent, name].filter(Boolean).join('/') } };
    }
    if (ep === '/entity/create') {
      const parent = String(body?.parent_path || '').replace(/\/+$/, '');
      const name = String(body?.name || '新規項目').replace(/\.md$/i, '');
      return { ok: true, queued: true, operation_id: operationId, path: [parent, name + '.md'].filter(Boolean).join('/') };
    }
    return { ok: true, queued: true, operation_id: operationId, path: target };
  }

  function shouldQueue(error) {
    const message = String(error?.userMessage || error?.message || error);
    return !BLOCKED_RE.test(message) && (navigator.onLine === false || RETRYABLE_RE.test(message));
  }

  async function callOrQueue(kind, path, body, options) {
    const operationId = String(body?.operation_id || '') || id();
    const payload = withOperationId(body, operationId);
    try {
      return await originals[kind](path, payload, options);
    } catch (error) {
      if (!shouldQueue(error)) throw error;
      await enqueue({
        operationId,
        kind,
        path: String(path || ''),
        body: payload,
        options: options && typeof options === 'object' ? structuredClone(options) : {},
        endpoint: endpoint(path),
        contextKey: contextKey(),
        state: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        retryCount: 0,
        lastError: String(error?.message || error).slice(0, 500),
      });
      return optimistic(path, payload, operationId);
    }
  }

  async function callFetchOrQueue(path, options) {
    const method = String(options?.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return originals.apiFetch(path, options);
    const operationId = String(options?.body?.operation_id || '') || id();
    const next = { ...(options || {}), body: withOperationId(options?.body, operationId) };
    try {
      return await originals.apiFetch(path, next);
    } catch (error) {
      if (!shouldQueue(error)) throw error;
      await enqueue({
        operationId,
        kind: 'apiFetch',
        path: String(path || ''),
        options: structuredClone(next),
        endpoint: endpoint(path),
        contextKey: contextKey(),
        state: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        retryCount: 0,
        lastError: String(error?.message || error).slice(0, 500),
      });
      return optimistic(path, next.body, operationId);
    }
  }

  async function flush() {
    if (flushing || navigator.onLine === false) return false;
    flushing = true;
    try {
      const rows = await readQueue();
      if (!rows.length) {
        status('synced', '同期済み', 0);
        return true;
      }
      const remaining = [];
      const currentContext = contextKey();
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (row.contextKey && currentContext && row.contextKey !== currentContext) {
          remaining.push({ ...row, state: 'destination-check', lastError: '保存先またはアカウントが変わっています' }, ...rows.slice(index + 1));
          status('destination-check', '保存先を確認してください', remaining.length);
          break;
        }
        try {
          if (row.kind === 'apiFetch') await originals.apiFetch(row.path, row.options || {});
          else await originals[row.kind](row.path, row.body, row.options || {});
        } catch (error) {
          const message = String(error?.userMessage || error?.message || error);
          const blocked = BLOCKED_RE.test(message);
          remaining.push({
            ...row,
            state: blocked ? 'conflict' : 'pending',
            retryCount: Number(row.retryCount || 0) + 1,
            updatedAt: new Date().toISOString(),
            lastError: message.slice(0, 500),
          }, ...rows.slice(index + 1));
          status(blocked ? 'conflict' : 'pending',
            blocked ? '競合を確認してください' : '端末に保存済み・同期待ち', remaining.length);
          break;
        }
      }
      await writeQueue(remaining);
      if (!remaining.length) {
        status('synced', '同期済み', 0);
        window.dispatchEvent(new CustomEvent('meldex:standalone-outbox-flushed'));
      }
      return !remaining.length;
    } finally {
      flushing = false;
    }
  }

  function install() {
    if (installed || !window.MeldexStandaloneLocalDrafts) return false;
    ['apiPost', 'apiPut', 'apiPatch', 'apiDelete'].forEach(kind => {
      if (typeof window[kind] !== 'function') return;
      originals[kind] = window[kind];
      window[kind] = (path, body, options) => callOrQueue(kind, path, body, options);
    });
    if (typeof window.apiFetch === 'function') {
      originals.apiFetch = window.apiFetch;
      window.apiFetch = callFetchOrQueue;
      Object.assign(window.apiFetch, originals.apiFetch);
    }
    installed = true;
    window.addEventListener('online', flush);
    window.addEventListener('meldex:standalone-auth-changed', flush);
    window.addEventListener('meldex:standalone-cloud-ready', flush);
    setTimeout(flush, 250);
    return true;
  }

  window.MeldexStandaloneOfflineOutbox = { install, flush, readQueue };
  let closeContractRegistered = false;
  function registerCloseContract() {
    if (closeContractRegistered || !window.MeldexStandaloneCloseGuard?.register) return;
    closeContractRegistered = true;
    window.MeldexStandaloneCloseGuard.register({
      appId: 'offline-outbox',
      getCloseState,
      flushLocal,
      async flushFinal() {
        if (!await flushLocal()) return false;
        if (navigator.onLine !== false) await flush();
        // リモート同期待ちでも、順序付きキューが端末に確定していれば閉じられる。
        return flushLocal();
      },
    });
  }
  registerCloseContract();
  window.addEventListener('meldex:standalone-close-guard-ready', registerCloseContract, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
