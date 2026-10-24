(function () {
  'use strict';

  const API_BASE = '/api';
  const HEADER = 'X-Meldex-Active-Lock-Token';
  const TOKEN_KEY = 'meldex-active-lock-token';
  const DEVICE_KEY = 'meldex-active-lock-device-id';
  const LEASE_SECONDS = 300;
  const HEARTBEAT_MS = 30000;
  // 最終使用からこの時間を超えたパスのロックは heartbeat のタイミングで解放する
  const IDLE_RELEASE_MS = 120000;
  // リース期限までこの時間より余裕があるパスは更新POSTに含めない
  //（共有ストア _meldex/active_locks.json への書き込み頻度を下げ、Dropboxの競合コピーを防ぐ）
  const RENEW_MARGIN_MS = 120000;
  const localLocks = new Map();
  const lastUsedAt = new Map();
  const mutationLockRefs = new Map();
  const pendingReleases = new Map();
  let heartbeatTimer = 0;
  let fallbackToken = '';
  let tabHolderId = '';

  function _randomId(prefix) {
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return `${prefix}-${Array.from(bytes).map(v => v.toString(16).padStart(2, '0')).join('')}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  // トークンは端末（ブラウザプロファイル）単位で localStorage に保存する。
  // 同一端末の複数ウィンドウは同一トークンを共有するため、相互にブロックしない。
  // 別端末との協調編集事故（同じファイルの同時保存）の防止が目的。
  function token() {
    let value = '';
    try { value = localStorage.getItem(TOKEN_KEY) || ''; } catch {}
    if (!value) {
      // localStorage が使えない環境ではモジュール内変数へフォールバックし、
      // 少なくともこのウィンドウ内ではトークンを安定させる
      value = fallbackToken || _randomId('lock');
      fallbackToken = value;
      try { localStorage.setItem(TOKEN_KEY, value); } catch {}
    }
    return value;
  }

  // 端末トークンは複数タブで共有する一方、解放単位はタブごとに分ける。
  // これにより一方のタブを閉じても、同じファイルを開いている別タブのリースを残せる。
  function holderId() {
    if (!tabHolderId) tabHolderId = _randomId('holder');
    return tabHolderId;
  }

  function deviceId() {
    let value = '';
    try { value = localStorage.getItem(DEVICE_KEY) || ''; } catch {}
    if (!value) {
      value = _randomId('device');
      try { localStorage.setItem(DEVICE_KEY, value); } catch {}
    }
    return value;
  }

  function username() {
    try {
      const value = typeof getUsername === 'function' ? getUsername() : '';
      return value && value !== 'anonymous' ? value : '';
    } catch {
      return '';
    }
  }

  function deviceLabel() {
    const id = deviceId().slice(-6);
    const platform = String(navigator.platform || '').trim();
    return platform ? `${platform} ${id}` : `端末 ${id}`;
  }

  function _status(message, isError) {
    if (typeof showStatus === 'function') showStatus(message, !!isError);
  }

  function _normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  }

  // サーバー側 meldex_file_locks.SYSTEM_LOCK_BLACKLIST と同じ一覧。
  // 管理用フォルダは自動編集中ロックの対象外で、確保しようとすると 400 が返る。
  // 以前はその 400 で書き込み自体が中止され、チャットの画像添付（_chat 配下へ保存）が
  // 「アップロードに失敗しました」で必ず失敗していた。ロックを取らずに書き込みへ進む。
  const SYSTEM_LOCK_SKIP_SEGMENTS = new Set([
    '_chat', '_skills', '_models', '_knowledge', '.meldex', '_meldex', '.trash', '_trash',
  ]);

  function _isLockExemptPath(path) {
    return _normalizePath(path)
      .split('/')
      .some(segment => SYSTEM_LOCK_SKIP_SEGMENTS.has(segment.toLowerCase()));
  }

  function _isLockExemptError(error) {
    if (Number(error?.status) !== 400) return false;
    const detail = error?.payload?.detail;
    const message = String(
      (detail && typeof detail === 'object' ? detail.message : detail) || error?.message || ''
    );
    return message.includes('自動編集中ロックの対象外');
  }

  function _uniquePaths(paths) {
    const result = [];
    const seen = new Set();
    (paths || []).forEach(path => {
      const normalized = _normalizePath(path);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      result.push(normalized);
    });
    return result;
  }

  function _candidateSpecs(candidates) {
    const byPath = new Map();
    (candidates || []).forEach(candidate => {
      const source = candidate && typeof candidate === 'object' ? candidate : { path: candidate };
      const path = _normalizePath(source.path || '');
      if (!path) return;
      const previous = byPath.get(path);
      byPath.set(path, {
        path,
        includeDescendants: !!(previous?.includeDescendants || source.includeDescendants || source.include_descendants),
      });
    });
    return [...byPath.values()];
  }

  function _method(opts) {
    return String(opts?.method || 'GET').toUpperCase();
  }

  function _route(path) {
    try {
      const url = new URL(String(path || ''), window.location.origin);
      return url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
    } catch {
      return '';
    }
  }

  function _isMutation(opts) {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(_method(opts));
  }

  function _isSelfRoute(path) {
    const route = _route(path);
    return route === '/active-lock' || route.startsWith('/active-lock/');
  }

  function _withActiveLockHeader(opts) {
    const next = { ...(opts || {}) };
    const headers = new Headers(next.headers || undefined);
    headers.set(HEADER, token());
    next.headers = headers;
    return next;
  }

  async function _jsonFetch(path, opts) {
    const headers = new Headers(opts?.headers || undefined);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    headers.set(HEADER, token());
    const requestOptions = { ...(opts || {}), headers };
    // This request runs before apiFetch's mutation timeout. Bound both fetch
    // and response-body reads, and fail closed before attempting a write.
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const error = new Error('編集ロックの応答を確認できませんでした。接続を確認してください');
        error.code = 'active_lock_timeout';
        reject(error);
      }, 15000);
    });
    try {
      const request = (async () => {
        if (window.MeldexRuntimeAdapter?.isDropboxMode?.() && window.MeldexDataAccess?.requestJson) {
          let body = requestOptions.body;
          if (typeof body === 'string' && body) {
            try { body = JSON.parse(body); } catch {}
          }
          return window.MeldexDataAccess.requestJson(path, { ...requestOptions, body, signal: controller.signal });
        }
        const res = await fetch(API_BASE + path, { ...requestOptions, signal: controller.signal });
        if (!res.ok) {
          let payload = null;
          let detail = res.statusText || '';
          try {
            payload = await res.clone().json();
            detail = payload?.detail?.message || payload?.detail || payload?.error || detail;
          } catch {}
          const error = new Error(typeof detail === 'string' ? detail : (detail?.message || `HTTP ${res.status}`));
          error.status = res.status;
          error.payload = payload;
          throw error;
        }
        return await res.json();
      })();
      return await Promise.race([request, timeout]);
    } catch (error) {
      if (controller.signal.aborted) {
        const timedOut = new Error('編集ロックの応答を確認できませんでした。保存処理は開始していません。接続を確認してください');
        timedOut.code = 'active_lock_timeout';
        throw timedOut;
      }
      throw error;
    } finally { clearTimeout(timer); }
  }

  function _lockBody(path, options) {
    return {
      path,
      token: token(),
      holder_id: holderId(),
      locked_by: username(),
      device_id: deviceId(),
      device_label: deviceLabel(),
      lease_seconds: LEASE_SECONDS,
      kind: 'edit',
      include_descendants: options?.includeDescendants === true || options?.include_descendants === true,
    };
  }

  function _conflictMessage(error) {
    const detail = error?.payload?.detail || {};
    return detail.message || error?.message || 'ほかの端末で編集中のため保存できません';
  }

  async function ensureLock(path, options) {
    const normalized = _normalizePath(path);
    if (!normalized) return null;
    if (_isLockExemptPath(normalized)) return null;
    // Paths may have relative/absolute or case aliases. Wait for all this
    // holder's DELETEs; an uncertain release requires a new holder via reload.
    while (pendingReleases.size) {
      const released = await Promise.all([...pendingReleases.values()]);
      if (released.some(result => result?.ok === false)) {
        const error = new Error('前回の編集ロック解除を確認できません。接続の回復後に画面を再読込してください。保存処理は開始していません');
        error.code = 'active_lock_release_unknown';
        throw error;
      }
    }
    lastUsedAt.set(normalized, Date.now());
    const current = localLocks.get(normalized);
    const needsDescendantCheck = options?.includeDescendants === true || options?.include_descendants === true;
    if (current
      && (!needsDescendantCheck || current.include_descendants === true)
      && Date.parse(current.expires_at || '') > Date.now() + HEARTBEAT_MS) {
      return current;
    }
    try {
      const response = await _jsonFetch('/active-lock', {
        method: 'PUT',
        body: JSON.stringify(_lockBody(normalized, options)),
      });
      const entry = response?.entry || null;
      if (entry) localLocks.set(normalized, entry);
      _startHeartbeat();
      return entry;
    } catch (error) {
      // 管理用フォルダはロック対象外。ロックを取れないことを理由に書き込みを止めない。
      if (_isLockExemptError(error)) return null;
      if (error?.status === 423) {
        const message = _conflictMessage(error);
        _status(message, true);
      }
      throw error;
    }
  }

  async function beforeApiFetch(path, opts, context) {
    if (!_isMutation(opts) || _isSelfRoute(path)) return opts || {};
    const candidates = _candidateSpecs(context?.candidatePaths || []);
    if (!candidates.length) return _withActiveLockHeader(opts);
    for (const candidate of candidates) {
      const candidatePath = candidate.path;
      if (candidate.includeDescendants) await ensureLock(candidatePath, { includeDescendants: true });
      else await ensureLock(candidatePath);
    }
    return _withActiveLockHeader(opts);
  }

  function _releaseLock(path, keepalive) {
    // A failed/aborted DELETE may still arrive at the server. Its caller keeps
    // a barrier until reload (which creates a different holder ID).
    const query = new URLSearchParams({ path, holder_id: holderId() });
    return _jsonFetch('/active-lock?' + query.toString(), {
      method: 'DELETE',
      keepalive: !!keepalive,
    });
  }

  async function acquireMutationLocks(candidates) {
    const acquired = [];
    try {
      for (const candidate of _candidateSpecs(candidates)) {
        if (_isLockExemptPath(candidate.path)) continue;
        const current = mutationLockRefs.get(candidate.path);
        if (current) {
          current.count += 1;
          acquired.push(candidate.path);
          continue;
        }
        const preexisting = localLocks.has(candidate.path);
        await ensureLock(candidate.path, candidate);
        mutationLockRefs.set(candidate.path, { count: 1, owned: !preexisting });
        acquired.push(candidate.path);
      }
    } catch (error) {
      await releaseMutationLocks(acquired);
      throw error;
    }
    return {
      paths: acquired.slice(),
      release: () => releaseMutationLocks(acquired),
    };
  }

  async function releaseMutationLocks(paths) {
    const releases = [];
    for (const path of [...(paths || [])].reverse()) {
      const current = mutationLockRefs.get(path);
      if (!current) continue;
      current.count -= 1;
      if (current.count > 0) continue;
      mutationLockRefs.delete(path);
      if (current.owned) releases.push(releaseLock(path));
    }
    await Promise.all(releases);
  }

  async function withMutationLocks(candidates, operation) {
    if (typeof operation !== 'function') throw new TypeError('operation は関数で指定してください');
    const lease = await acquireMutationLocks(candidates);
    try {
      return await operation();
    } finally {
      await lease.release();
    }
  }

  function touchLock(path) {
    const normalized = _normalizePath(path);
    if (!normalized || !localLocks.has(normalized)) return false;
    lastUsedAt.set(normalized, Date.now());
    return true;
  }

  async function releaseLock(path, options) {
    const normalized = _normalizePath(path);
    if (!normalized) return { ok: true, removed: false };
    if (pendingReleases.has(normalized)) return pendingReleases.get(normalized);
    const removed = localLocks.delete(normalized);
    lastUsedAt.delete(normalized);
    mutationLockRefs.delete(normalized);
    _stopHeartbeatIfIdle();
    const release = _releaseLock(normalized, !!options?.keepalive).then(
      () => ({ ok: true, removed }),
      () => ({ ok: false, removed, error_code: 'active_lock_release_unknown' }),
    );
    pendingReleases.set(normalized, release);
    const result = await release;
    if (result.ok) {
      if (pendingReleases.get(normalized) === release) pendingReleases.delete(normalized);
    }
    return result;
  }

  async function relocateLock(oldPath, newPath) {
    const previous = _normalizePath(oldPath);
    const next = _normalizePath(newPath);
    if (!previous || !next || previous === next || !localLocks.has(previous)) return null;
    const previousEntry = localLocks.get(previous);
    // 移動先を先に確保してから旧パスを解放する。逆順だとネットワーク往復の間、
    // 別端末が移動先を取得できる短い競合窓が生じる。
    const entry = await ensureLock(next, {
      includeDescendants: previousEntry?.include_descendants === true,
    });
    await releaseLock(previous);
    return entry;
  }

  function _releaseIdleLocks() {
    const now = Date.now();
    [...localLocks.keys()].forEach(path => {
      if ((mutationLockRefs.get(path)?.count || 0) > 0) {
        lastUsedAt.set(path, now);
        return;
      }
      if (now - (lastUsedAt.get(path) || 0) <= IDLE_RELEASE_MS) return;
      void releaseLock(path);
    });
    // ロックを持たないパスの最終使用時刻は不要なので掃除する
    [...lastUsedAt.keys()].forEach(path => {
      if (!localLocks.has(path)) lastUsedAt.delete(path);
    });
    _stopHeartbeatIfIdle();
  }

  function _renewTargetPaths() {
    const now = Date.now();
    return _uniquePaths([...localLocks.keys()]).filter(path => {
      const expiresAt = Date.parse(localLocks.get(path)?.expires_at || '');
      // 残リースが十分（期限まで RENEW_MARGIN_MS 超）のパスは更新しない
      return !(expiresAt > now + RENEW_MARGIN_MS);
    });
  }

  async function heartbeat() {
    _releaseIdleLocks();
    const paths = _renewTargetPaths();
    if (!paths.length) return;
    try {
      const response = await _jsonFetch('/active-lock/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ ..._lockBody(paths[0]), paths }),
      });
      const entries = Array.isArray(response?.entries) ? response.entries : [];
      entries.forEach(entry => {
        const path = _normalizePath(entry?.path || '');
        if (path) localLocks.set(path, entry);
      });
    } catch (error) {
      if (error?.status === 423) {
        _status(_conflictMessage(error), true);
        // 競合したパスだけを追跡から外す。他の編集中ファイルのロックは巻き込まない。
        const conflictPath = _normalizePath(error?.payload?.detail?.path || '');
        if (conflictPath) {
          localLocks.delete(conflictPath);
          lastUsedAt.delete(conflictPath);
        }
        // 競合パスを特定できない場合は全ロックを維持し、次回ハートビートで再試行する。
        _stopHeartbeatIfIdle();
      } else {
        console.warn('[MeldexActiveLocks] heartbeat failed', error);
      }
    }
  }

  function _startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = window.setInterval(heartbeat, HEARTBEAT_MS);
  }

  function _stopHeartbeatIfIdle() {
    if (localLocks.size || !heartbeatTimer) return;
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
  }

  async function releaseAll() {
    const paths = [...localLocks.keys()];
    return Promise.all(paths.map(path => releaseLock(path, { keepalive: true })));
  }

  // トークンが端末単位の共有になったため、release-all（トークン全解放）を
  // pagehide で使うと他ウィンドウが保持中のロックまで消してしまう。
  // このウィンドウが取得したパスだけを個別に解放する。
  function _releaseWindowLocks() {
    const paths = [...localLocks.keys()];
    paths.forEach(path => { void releaseLock(path, { keepalive: true }); });
  }

  window.addEventListener('pagehide', () => {
    _releaseWindowLocks();
  });

  window.MeldexActiveLocks = {
    header: HEADER,
    token,
    holderId,
    beforeApiFetch,
    ensureLock,
    touchLock,
    releaseLock,
    relocateLock,
    acquireMutationLocks,
    releaseMutationLocks,
    withMutationLocks,
    heartbeat,
    releaseAll,
    _localLocks: localLocks,
  };
})();
