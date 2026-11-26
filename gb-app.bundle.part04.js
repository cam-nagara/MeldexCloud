// Startup/background reads must not queue a user mutation behind all six
// browser connections. Do not cancel these reads or change their results.
let _gbAppRegularRequests = 0;
const _gbAppRegularRequestQueue = [];
function _gbAppApiFetchAcquireLane(path, opts) {
  const endpoint = String(path || '').split('?', 1)[0].replace(/^\/api/, '');
  const backgroundWrite = ['/beta/consent', '/beta/feedback-template', '/staff-registry/upsert', '/debugger/flush'].includes(endpoint);
  const visibleRead = opts?.background !== true && (opts?.foreground === true || ['/file', '/browse', '/outliner-roots'].includes(endpoint));
  const regular = (_gbAppApiFetchMethod(opts) === 'GET' && !visibleRead) || backgroundWrite;
  const signal = opts?.signal;
  const abortError = () => Object.assign(new Error('リクエストが中断されました'), {name:'AbortError'});
  if (signal?.aborted) return Promise.reject(abortError());
  if (!regular) return Promise.resolve(() => {});
  return new Promise((resolve, reject) => {
    const entry = {
      start() {
        signal?.removeEventListener('abort', entry.abort);
        _gbAppRegularRequests++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          _gbAppRegularRequests--;
          _gbAppRegularRequestQueue.shift()?.start();
        });
      },
      abort() {
        const index = _gbAppRegularRequestQueue.indexOf(entry);
        if (index < 0) return;
        _gbAppRegularRequestQueue.splice(index, 1);
        signal?.removeEventListener('abort', entry.abort);
        reject(abortError());
      },
    };
    if (_gbAppRegularRequests < 3) entry.start();
    else {
      _gbAppRegularRequestQueue.push(entry);
      signal?.addEventListener('abort', entry.abort, {once:true});
    }
  });
}

async function apiFetch(path, opts) {
  const historyProjection = await window.MeldexChatManagementSheet?.handleApi?.(path, opts);
  if (historyProjection) return historyProjection.value;
  const method = _gbAppApiFetchMethod(opts);
  const browseCacheKey = _gbAppApiFetchBrowseCacheKey(path, opts);
  const cacheGeneration = _gbAppApiFetchCacheGeneration;
  if (browseCacheKey) {
    const cached = _gbAppApiFetchBrowseCache.get(browseCacheKey);
    if (cached && Date.now() - cached.at < GB_APP_API_FETCH_BROWSE_CACHE_TTL_MS) {
      return _gbAppApiFetchClonePayload(cached.payload);
    }
    _gbAppApiFetchBrowseCache.delete(browseCacheKey);
  }
  const inFlightKey = _apiFetchInFlightKey(path, opts);
  if (inFlightKey && _apiFetchInFlightGets.has(inFlightKey)) {
    return _gbAppApiFetchClonePayload(await _apiFetchInFlightGets.get(inFlightKey));
  }
  const perfInfo = _apiFetchPerfInfo(path);
  const perfStartedAt = perfInfo ? _perfNowMs() : 0;
  const requestPromise = (async () => {
    let releaseLane;
    try {
      releaseLane = await _gbAppApiFetchAcquireLane(path, opts);
      let requestOpts = opts;
      let retriedAfterMutation = false;
      while (true) {
        const requestedTimeout = Number(requestOpts?.timeoutMs);
        const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
          ? Math.min(requestedTimeout, GB_APP_API_FETCH_MAX_TIMEOUT_MS)
          : _gbAppApiFetchDefaultTimeout(path, requestOpts);
        // 本文の読込が止まった場合も、ヘッダー待ちと同じタイムアウト・キャンセルを適用する。
        const { data, backendPerf } = await _gbAppApiFetchDoFetch(API_BASE + path, requestOpts, timeoutMs, async res => {
          if (perfInfo) {
            _logPerfEvent(perfInfo.label + '.fetch', perfStartedAt, {
              ...perfInfo,
              status: res.status,
              contentLength: res.headers?.get?.('content-length') || '',
              retriedAfterMutation,
            });
          }
          const backendPerf = _apiFetchBackendPerf(res);
          if (!res.ok) {
            let detail = res.statusText || '';
            let payload = null;
            try {
              payload = await res.clone().json();
              const rawDetail = payload?.error || payload?.detail || detail;
              detail = rawDetail && typeof rawDetail === 'object'
                ? (rawDetail.message || rawDetail.code || detail)
                : rawDetail;
            } catch (error) { if (_gbAppApiFetchIsAbortError(error)) throw error; }
            const error = new Error(`HTTP ${res.status}: ${detail}`);
            error.status = res.status;
            error.payload = payload;
            error.userMessage = window.MeldexErrorMessages?.toStatusText?.(error, { path }) || error.message;
            throw (window.MeldexSaveSafety?.enrichError?.(error, payload, res.status) || error);
          }
          const jsonStartedAt = perfInfo ? _perfNowMs() : 0;
          const data = await res.json();
          if (perfInfo) {
            _logPerfEvent(perfInfo.label + '.json', jsonStartedAt, {
              ...perfInfo,
              backendPerf,
              retriedAfterMutation,
            });
          }
          return { data, backendPerf };
        });
        // GET開始後に作成・保存・移動等が完了した場合、開始時点の古い一覧を
        // 呼び出し元へ返さない。アプリ内キャッシュを迂回して1回だけ取り直す。
        if (browseCacheKey && !retriedAfterMutation && cacheGeneration !== _gbAppApiFetchCacheGeneration) {
          retriedAfterMutation = true;
          requestOpts = { ...(opts || {}), skipBrowseCache: true, cache: 'reload' };
          continue;
        }
        if (backendPerf && data && typeof data === 'object') {
          try {
            Object.defineProperty(data, '_backendPerf', {
              value: backendPerf,
              configurable: true,
            });
          } catch {}
        }
        window.MeldexSaveSafety?.reportApiSuccess?.(path, requestOpts, data);
        if (method !== 'GET') {
          _gbAppApiFetchInvalidateReadCaches();
        } else if (browseCacheKey && cacheGeneration === _gbAppApiFetchCacheGeneration) {
          _gbAppApiFetchRememberBrowse(browseCacheKey, data);
        }
        if (perfInfo) _logPerfEvent(perfInfo.label, perfStartedAt, { ...perfInfo, backendPerf, retriedAfterMutation });
        return data;
      }
    } catch (e) {
      if (perfInfo) {
        _logPerfEvent(perfInfo.label + '.error', perfStartedAt, {
          ...perfInfo,
          error: e?.message || String(e),
        });
      }
      const quietReadAbort = method === 'GET' && _gbAppApiFetchIsAbortError(e);
      // シートの保存の失敗・読み込みの失敗を自己記録へ残す（silentError の保存も含む。gb-log-export.js）。
      try { window.MeldexDiagnostics?.noteRequestFailure?.(path, opts, e); } catch {}
      if (!opts?.silentError && !quietReadAbort) {
        window.MeldexDiagnostics?.captureApiError?.(path, opts, e);
      }
      if (!opts?.silentError && !window.MeldexSaveSafety?.reportApiError?.(path, opts, e)) {
        if (quietReadAbort) {
          // GET中断/タイムアウトはエラートースト表示せず、コンソールログのみに留める（呼び出し元は再試行等で処理する）
          try { console.warn('[apiFetch] aborted:', path, e.message); } catch {}
        } else {
          const text = window.MeldexErrorMessages?.toStatusText?.(e, { path }) || e.message;
          showStatus('エラー: ' + text, true);
        }
      }
      throw e;
    } finally {
      releaseLane?.();
    }
  })();
  if (inFlightKey) {
    _apiFetchInFlightGets.set(inFlightKey, requestPromise);
    requestPromise.then(
      () => { if (_apiFetchInFlightGets.get(inFlightKey) === requestPromise) _apiFetchInFlightGets.delete(inFlightKey); },
      () => { if (_apiFetchInFlightGets.get(inFlightKey) === requestPromise) _apiFetchInFlightGets.delete(inFlightKey); },
    );
  }
  return _gbAppApiFetchClonePayload(await requestPromise);
}

function _gbAppIsFullFileWrite(path, body) {
  const pathname = String(path || '').split('?', 1)[0].replace(/^\/api/, '');
  return pathname === '/file' && body && typeof body === 'object'
    && (Object.prototype.hasOwnProperty.call(body, 'content')
      || Object.prototype.hasOwnProperty.call(body, 'content_base64'));
}

async function _gbAppPrepareFullFileWrite(path, body) {
  const payload = { ...(body || {}) };
  if (!_gbAppIsFullFileWrite(path, payload)) return payload;
  const coordinator = window.MeldexDocumentSaveCoordinator;
  const force = !!(payload.force_overwrite || payload.forceOverwrite);
  const createOnly = !!(payload.create_only || payload.createOnly);
  let revision = payload.transport_revision || payload.transportRevision
    || payload.if_match_transport_revision || payload.if_match_etag || payload.ifMatchEtag || '';

  if (revision && coordinator?.revisionTokenForWrite) {
    payload.if_match_etag = coordinator.revisionTokenForWrite(revision);
    return payload;
  }
  if (revision || force || createOnly) return payload;

  // revision無しの旧呼び出し元を、保存直前に取得した「最新revision」で
  // 延命してはいけない。古い本文へ最新revisionを付け直すと、読込後に別端末で
  // 更新された内容をCASに成功させて上書きしてしまう。ここで許可する自動補完は、
  // 保存先が存在しないことを確認できた時の create_only だけとする。
  try {
    const separator = String(path).includes('?') ? '&' : '?';
    const current = await apiFetch(`${path}${separator}metadata_only=1`, { silentError: true });
    coordinator?.bindDocumentIdentity?.(
      new URLSearchParams(String(path).split('?')[1] || '').get('path') || '',
      current,
    );
    const error = new Error('既存ファイルの保存には、読込時のrevisionが必要です');
    error.status = 428;
    error.meldexCode = 'precondition_required';
    error.meldexDetail = {
      code: 'precondition_required',
      path: new URLSearchParams(String(path).split('?')[1] || '').get('path') || '',
      current_etag: current?.etag || '',
      current_transport_revision: current?.transport_revision || null,
    };
    throw error;
  } catch (error) {
    if (error?.status === 404 && !(payload.skip_if_missing || payload.skipIfMissing)) {
      payload.create_only = true;
      return payload;
    }
    if (error?.status === 404 && (payload.skip_if_missing || payload.skipIfMissing)) return payload;
    throw error;
  }
}

let _gbAppUiConfigWriteTail = Promise.resolve();
const _gbAppPendingValueWrites = new Map();
const _gbAppValueWriteTails = new Map();
let _gbAppValueAccount = window.MeldexDropboxAuth?.getSession?.()?.accountId || '';
window.addEventListener?.('meldex:dropbox-auth-session-changed', event => {
  const account = String(event.detail?.accountId || '');
  if (account !== _gbAppValueAccount) _gbAppPendingValueWrites.clear();
  _gbAppValueAccount = account;
});
window.addEventListener?.('meldex:mode-changed', () => _gbAppPendingValueWrites.clear());

async function _gbAppPutValueConfirmed(path, body, options) {
  const key = String(path);
  const previous = _gbAppValueWriteTails.get(key);
  const pending = Promise.resolve(previous).catch(() => {}).then(async () => {
    const send = payload => apiFetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      ...(options || {}), body: JSON.stringify(payload), silentError: true });
    const uncertain = _gbAppPendingValueWrites.get(key);
    if (uncertain) {
      // 結果の分からなかった前回の保存を、同じ操作IDで送り直す。サーバーは反映済みの操作IDには記録した結果を返すので、
      // 4xx（版の食い違い等）で断られた時は「前回の保存は反映されていない」と確定する。その記録を捨てて今回の保存へ進む。
      // 捨てないと、その行の以後の保存・取り消し・やり直しが古い版の送り直しで断られ続ける（M-014 不具合33・36）。
      // 5xx・通信断の時は、まだ結果が分からないので従来どおり止める。
      let result = null;
      try { result = await send(uncertain); }
      catch (error) {
        const stillUnknown = error?.isTimeout || error?.name === 'AbortError' || Number(error?.status) >= 500
          || (error?.name === 'TypeError' && /fetch|network|load/i.test(error.message || ''));
        if (stillUnknown) throw error;
        result = null;
      }
      _gbAppPendingValueWrites.delete(key);
      if (result) {
        // 失敗と表示した保存が、この送り直しで入った。黙って入れずに知らせ、表示を読み直させる（2026-11-21 ユーザー決定）。
        try {
          window.dispatchEvent(new CustomEvent('meldex:value-write-replayed', { detail: { path: key, body: uncertain, result } }));
        } catch {}
        if (typeof showStatus === 'function') showStatus('前に失敗した保存を反映しました');
      }
      const canonical = value => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
      const withoutId = value => JSON.stringify(canonical(Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'operation_id'))));
      if (result && withoutId(body) === withoutId(uncertain)) return result;
      // Only an ordinary candidate patch may follow its own confirmed patch.
      // Whole-body edits and structural changes retain their original baseline.
      const baseKey = ['baseRevision', 'base_revision', 'entryRevision', 'revision'].find(k => body[k] != null);
      const oldBase = ['baseRevision', 'base_revision', 'entryRevision', 'revision'].find(k => uncertain[k] != null);
      if (body.property && body.candidate_index != null && !body.new_property && !('new_body' in body)
          && !uncertain._delete && !uncertain.new_property && !('new_body' in uncertain)
          && baseKey && oldBase && body[baseKey] === uncertain[oldBase] && result?.revision != null) {
        body = { ...body, [baseKey]: result.revision };
      }
    }
    const payload = { ...body, operation_id: body.operation_id || crypto.randomUUID() };
    try { return await send(payload); }
    catch (error) {
      const unknown = error?.isTimeout || error?.name === 'AbortError' || Number(error?.status) >= 500
        || (error?.name === 'TypeError' && /fetch|network|load/i.test(error.message || ''));
      if (!unknown) throw error;
      _gbAppPendingValueWrites.set(key, payload);
      const result = await send(payload);
      _gbAppPendingValueWrites.delete(key);
      return result;
    }
  });
  _gbAppValueWriteTails.set(key, pending);
  try { return await pending; }
  finally { if (_gbAppValueWriteTails.get(key) === pending) _gbAppValueWriteTails.delete(key); }
}

async function apiPut(path, body, options = {}) {
  const guardedBody = await _gbAppPrepareFullFileWrite(path, body);
  if (String(path).split('?')[0].replace(/^\/api/, '') === '/value') {
    const notify = phase => { if (typeof _gbAppNotifyEntityValuesChanged === 'function') _gbAppNotifyEntityValuesChanged(path, phase, guardedBody); };
    notify('pending');
    let result;
    try { result = await _gbAppPutValueConfirmed(path, guardedBody, options); }
    catch (error) { setTimeout(() => notify('failed'), 0); throw error; }
    _scheduleLinkDictionaryRefreshForMutation(path);
    notify('saved');
    _gbAppNotifyPathsWritten(path, guardedBody);
    return result;
  }
  const requestOptions = {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(guardedBody),
    ...(options || {}),
  };
  const send = () => apiFetch(path, requestOptions);
  // Whole settings snapshots must commit in user request order. A failed
  // snapshot rejects its own caller without poisoning subsequent saves.
  let result;
  if (String(path).split('?')[0].replace(/^\/api/, '') === '/ui-config') {
    const pending = _gbAppUiConfigWriteTail.catch(() => {}).then(send);
    _gbAppUiConfigWriteTail = pending;
    result = await pending;
  } else result = await send();
  _scheduleLinkDictionaryRefreshForMutation(path);
  window.MeldexChatManagementSheet?.notifyMutation?.(path, body);
  _gbAppNotifyPathsWritten(path, guardedBody, result);
  return result;
}

function _scheduleLinkDictionaryRefreshForMutation(path) {
  const pathname = String(path || '').split('?')[0];
  if (![
    '/value', '/entity/create', '/entity/rename',
    '/outliner/delete', '/outliner/delete-batch', '/outliner/rename',
  ].includes(pathname)) return;
  if (typeof MeldexAutoLink !== 'undefined' && typeof MeldexAutoLink.scheduleReload === 'function') {
    MeldexAutoLink.scheduleReload(3000);
  }
}

// 同じトピックを表示している別の面（サブパネルのトピックなど）へ、値の保存を知らせる（2026-11-21）。
// pending=保存の前（表の手元の値は反映済み）・saved=保存の後・failed=保存の失敗（表は元に戻る）。
function _gbAppNotifyEntityValuesChanged(path, phase, body) {
  try {
    if (String(path || '').split('?')[0].replace(/^\/api/, '') !== '/value') return;
    const entityPath = new URLSearchParams(String(path).split('?')[1] || '').get('path')
      || (body && typeof body === 'object' ? (body.entry_path || body.folder_path || '') : '');
    if (entityPath) window.dispatchEvent(new CustomEvent('meldex:entity-values-changed', { detail: { path: entityPath, phase } }));
  } catch {}
}

// 書き込みが成功したファイル・フォルダを同じ画面内へ知らせる（ノートに埋め込んだ表示の差分更新用）。
// 本文は渡さず、対象のパスだけを送る。通知の失敗で保存を失敗扱いにしない。
function _gbAppNotifyPathsWritten(path, body, result) {
  try {
    const paths = new Set();
    const add = value => { if (typeof value === 'string' && value && value.length < 2048) paths.add(value.replace(/\\/g, '/')); };
    const query = new URLSearchParams(String(path || '').split('?')[1] || '');
    ['path', 'db_path', 'dbPath', 'folder'].forEach(key => add(query.get(key)));
    if (body && typeof body === 'object') {
      ['path', 'file_path', 'entry_path', 'folder_path', 'db_path', 'dbPath', 'src', 'dst', 'old_path', 'new_path', 'target', 'dest'].forEach(key => add(body[key]));
      if (Array.isArray(body.paths)) body.paths.slice(0, 200).forEach(add);
    }
    // 名前変更・移動は、応答の新しい場所と組にして知らせる（埋め込みの参照を追従させる）。
    const renamed = [];
    const oldPath = body && typeof body === 'object' ? (body.old_path || body.src || '') : '';
    const newPath = result && typeof result === 'object' ? (result.new_path || result.dst || '') : '';
    if (typeof oldPath === 'string' && typeof newPath === 'string' && oldPath && newPath && oldPath !== newPath) {
      renamed.push({ from: oldPath, to: newPath }); add(newPath);
    }
    if (!paths.size) return;
    window.dispatchEvent(new CustomEvent('meldex:paths-written', { detail: { api: String(path || '').split('?')[0], paths: [...paths], renamed } }));
  } catch {}
}

async function apiPost(path, body, options = {}) {
  // 開いているシナリオの表示名は、本文と同じCAS保存キューで確定する。
  // 別のタイトル書込とautosaveを並走させると、自分の変更が409になる。
  if (String(path || '').split('?')[0] === '/outliner/rename' && body?.title_only === true
      && ['scriptnote', 'scenario'].includes(body?.type) && window.MeldexScriptNoteTitleSave) {
    const saved = await window.MeldexScriptNoteTitleSave(body, options?.scriptnoteEditor);
    if (saved) {
      _scheduleLinkDictionaryRefreshForMutation(path);
      return saved;
    }
  }
  let stableCopyKey = '';
  if (['/outliner/duplicate', '/outliner/save-as'].includes(String(path || ''))
      && body && typeof body === 'object' && !body.operation_id) {
    const prepared = window.MeldexStableCopyOperationIds?.prepare?.(path, body)
      || { body: { ...body, operation_id: crypto.randomUUID() }, key: '' };
    body = prepared.body; stableCopyKey = prepared.key;
  }
  if (typeof _gbAppNotifyEntityValuesChanged === 'function') _gbAppNotifyEntityValuesChanged(path, 'pending', body);
  let result;
  try {
    result = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(options || {}),
    });
  } catch (error) {
    if (typeof _gbAppNotifyEntityValuesChanged === 'function') setTimeout(() => _gbAppNotifyEntityValuesChanged(path, 'failed', body), 0);
    throw error;
  }
  window.MeldexStableCopyOperationIds?.complete(stableCopyKey);
  window.MeldexChatManagementSheet?.notifyMutation?.(path, body);
  _scheduleLinkDictionaryRefreshForMutation(path);
  if (typeof _gbAppNotifyEntityValuesChanged === 'function') _gbAppNotifyEntityValuesChanged(path, 'saved', body);
  _gbAppNotifyPathsWritten(path, body, result);
  return result;
}

/* ==============================
   初期化
   ============================== */
// 認証トークン管理
// 旧認証変数（互換性のため残す — 他モジュールが参照）
let _authToken = '';
let _authUser = null;

function _apiLockJsonBody(opts) {
  const raw = opts?.body;
  if (!raw) return {};
  if (raw instanceof FormData) {
    const body = {};
    for (const [key, value] of raw.entries()) {
      if (typeof value === 'string' && body[key] === undefined) body[key] = value;
    }
    return body;
  }
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  if (raw && typeof raw === 'object' && !(raw instanceof FormData)) return raw;
  return {};
}

function _apiLockPathDir(path) {
  const text = String(path || '').replace(/\\/g, '/');
  const index = text.lastIndexOf('/');
  return index > 0 ? text.slice(0, index) : '';
}

function _apiLockRenameExtension(path) {
  const text = String(path || '').replace(/\\/g, '/');
  const name = text.slice(text.lastIndexOf('/') + 1);
  if (!name || name.endsWith('.')) return '';
  const visibleName = name.replace(/^\.+/, '');
  const dotIndex = visibleName.indexOf('.');
  return dotIndex >= 0 ? visibleName.slice(dotIndex) : '';
}

function _apiLockAddPath(paths, value) {
  const text = String(value || '').trim();
  if (text) paths.push(text);
}

function _apiLockWriteCandidatePaths(path, opts) {
  const method = String(opts?.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return [];
  let url;
  try { url = new URL(String(path || ''), window.location.origin); } catch { return []; }
  const route = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  if (route === '/file-lock' || route.startsWith('/file-lock/') || route === '/active-lock' || route.startsWith('/active-lock/')) return [];
  const body = _apiLockJsonBody(opts);
  const query = url.searchParams;
  const paths = [];
  const addQuery = (key) => _apiLockAddPath(paths, query.get(key));
  const addBody = (key) => _apiLockAddPath(paths, body?.[key]);
  const addBoth = (key) => { addQuery(key); addBody(key); };

  if (route === '/file' || route === '/value' || route === '/db-metadata' || route === '/replace') {
    addBoth('path');
    addBody('entry_path');
    addBody('folder_path');
  } else if (route === '/db-property/rename') {
    // 列名の変更はシート全体の行を書き換える。シート（フォルダ）を対象にする。
    addBody('db_path');
    if (!body?.db_path) addBody('path');
  } else if (route === '/replace-batch') {
    (Array.isArray(body?.targets) ? body.targets : []).forEach(item => _apiLockAddPath(paths, item?.path));
  } else if (route === '/upload-file' || route === '/upload-files') {
    addBoth('path');
    addBody('dir');
  } else if (route === '/outliner/add') {
    addBody('parent');
  } else if (route === '/outliner/delete') {
    addBody('path');
  } else if (route === '/outliner/duplicate') {
    const srcPath = String(body?.path || '').trim();
    if (srcPath) _apiLockAddPath(paths, _apiLockPathDir(srcPath));
  } else if (route === '/outliner/save-as') {
    addBody('path');
    addBody('dest_folder');
  } else if (route === '/outliner/delete-batch') {
    (Array.isArray(body?.items) ? body.items : []).forEach(item => _apiLockAddPath(paths, item?.path));
  } else if (route === '/outliner/move') {
    addBody('path');
    addBody('dest_folder');
  } else if (route === '/outliner/move-batch') {
    (Array.isArray(body?.items) ? body.items : []).forEach(item => _apiLockAddPath(paths, item?.path));
    addBody('dest_folder');
  } else if (route === '/outliner/rename') {
    addBody('old_path');
    const oldPath = String(body?.old_path || '');
    const boardTitle = body?.type === 'board' ? window.GBPathUtils?.displayTitle : null;
    const newName = boardTitle ? boardTitle.storageName(body?.new_name) : String(body?.new_name || '').trim();
    const titleOnly = boardTitle ? body?.title_only === true : window.GBPathUtils?.isDisplayTitleRename?.(route, body);
    if (oldPath && newName && !titleOnly) {
      const destinationBase = (_apiLockPathDir(oldPath) ? _apiLockPathDir(oldPath) + '/' : '') + newName;
      const extension = boardTitle
        ? oldPath.match(/\.(?:mel-board|board\.(?:md|json)|canvas\.json|md)$/i)?.[0] || _apiLockRenameExtension(oldPath)
        : _apiLockRenameExtension(oldPath);
      if (!boardTitle || !extension) _apiLockAddPath(paths, destinationBase);
      if (extension) _apiLockAddPath(paths, destinationBase + extension);
    }
  } else if (route === '/entity/create') {
    addBody('parent_path');
  } else if (route === '/entity/rename') {
    addBody('path');
    const oldPath = String(body?.path || '');
    const newName = String(body?.new_name || '').trim();
    if (oldPath && newName) _apiLockAddPath(paths, (_apiLockPathDir(oldPath) ? _apiLockPathDir(oldPath) + '/' : '') + newName);
  } else if (route === '/annotations' || route === '/annotations/restore' || route === '/annotations/orphan-by-target') {
    addBody('target_path');
  } else if (route === '/entity/auto-name') {
    addBody('db_path');
    addBody('entry_path');
    addBody('path');
  } else if (route === '/folder-links/add' || route === '/folder-links/remove') {
    addBody('folder_path');
    addBody('file_path');
  } else if (route === '/import-csv' || route === '/import-xlsx') {
    addBody('csv_path');
    addBody('xlsx_path');
    addBody('db_path');
  } else if (route === '/public-form/submit') {
    addBody('db_path');
  } else if (route.startsWith('/calendar-db/events') || route.startsWith('/calendar-db/sync') || route.startsWith('/calendar-db/ical') || route.startsWith('/calendar-db/caldav')) {
    addBoth('db_path');
  } else if (route === '/version/restore' || route === '/version/restore-db' || route === '/version/restore-folder' || route === '/version/delete-folder' || route === '/version/delete-db') {
    addBody('path');
  }

  return [...new Set(paths)];
}

function _apiLockBlockIfNeeded(path, opts) {
  if (typeof isItemLocked !== 'function') return false;
  const lockedPath = _apiLockWriteCandidatePaths(path, opts).find(p => {
    try { return isItemLocked(p); } catch { return false; }
  });
  if (!lockedPath) return false;
  const reason = typeof getItemLockReason === 'function' ? getItemLockReason(lockedPath) : '';
  const message = reason
    ? `編集ロック中のため編集できません（理由: ${reason}）`
    : '編集ロック中のため編集できません';
  if (typeof showStatus === 'function') showStatus(message, true);
  throw new Error(message);
}

function _apiIsSheetWideWrite(path, opts) {
  const method = String(opts?.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  let route = '';
  try { route = new URL(String(path || ''), window.location.origin).pathname.replace(/^\/api(?=\/|$)/, '') || '/'; }
  catch { return false; }
  if (route === '/db-property/rename') return 'schema';
  if (route !== '/db-metadata') return false;
  // 表示の設定だけの保存は行の中身を変えないので、ほかの人が入力中の行は待たない（シートを開いた時の自動保存もある）。
  const keys = Object.keys(_apiLockJsonBody(opts)).filter(key => !['view_config', 'operation_id', 'expected_schema_revision', 'path', 'db_path'].includes(key));
  return keys.length ? 'schema' : 'view';
}

function _apiUsesTransientActiveLock(path) {
  let route = '';
  try { route = new URL(String(path || ''), window.location.origin).pathname.replace(/^\/api(?=\/|$)/, '') || '/'; }
  catch { return false; }
  return new Set([
    '/upload-file', '/upload-files', '/outliner/add', '/outliner/rename', '/outliner/delete',
    '/outliner/delete-batch', '/outliner/restore', '/outliner/duplicate',
    '/outliner/save-as', '/outliner/move', '/outliner/move-batch', '/trash/restore', '/replace', '/replace-batch',
    // シートの行の追加・名前の自動生成・取り込みは、その間だけシートを取り、終わったら放す（シートのロックを残すと、
    // ほかの端末・裏の取り込みがどの行へも書けなくなる。セルの入力中のロックは行だけ。2026-11-25）。
    '/entity/create', '/entity/auto-name', '/import-csv', '/import-xlsx',
  ]).has(route);
}

// apiFetchをオーバーライドしてユーザー名を付加
const _origApiFetch = apiFetch;

// まとめての移動・削除（項目ごとに結果が返る要求）かどうか。該当すれば経路名を返す。
function _apiLockBatchRoute(path, opts) {
  if (String(opts?.method || 'GET').toUpperCase() !== 'POST') return '';
  let route = '';
  try { route = new URL(String(path || ''), window.location.origin).pathname.replace(/^\/api(?=\/|$)/, '') || '/'; }
  catch { return ''; }
  return route === '/outliner/move-batch' || route === '/outliner/delete-batch' ? route : '';
}

// 編集中ロックを取れなかった項目を要求から外す。外した項目は、サーバーの項目ごとの失敗と同じ形で返す。
// 移動先フォルダのロックが取れない時は全体を止める（fatal）。
function _apiSplitLockRejectedItems(opts, failedLocks) {
  const normalize = window.MeldexActiveLocks?.normalizePath || (value => String(value || ''));
  const body = _apiLockJsonBody(opts) || {};
  const items = Array.isArray(body.items) ? body.items : [];
  const failedByPath = new Map((failedLocks || []).map(item => [item.path, item.error]));
  const destination = normalize(body.dest_folder || '');
  if (destination && failedByPath.has(destination)) return { fatal: failedByPath.get(destination) };
  const kept = [];
  const order = [];
  for (const item of items) {
    const rawPath = item && typeof item === 'object' ? item.path : item;
    const error = failedByPath.get(normalize(rawPath));
    if (!error) {
      kept.push(item);
      order.push(null);
      continue;
    }
    const detail = error?.payload?.detail;
    order.push({
      ok: false, path: String(rawPath || ''), status: Number(error?.status) || 423,
      detail: detail || error?.message || 'ほかの端末で編集中のため操作できません', lock_rejected: true,
    });
  }
  if (!order.some(Boolean)) return { opts, order: null };
  return { opts: { ...opts, body: JSON.stringify({ ...body, items: kept }) }, order, keptCount: kept.length };
}

function _apiMergeLockRejectedResults(result, order) {
  const served = Array.isArray(result?.results) ? result.results.slice() : [];
  const results = order.map(rejected => rejected || served.shift()).filter(Boolean).concat(served);
  const failed = results.filter(item => !item?.ok);
  return { ...(result || {}), ok: !failed.length, results, failed };
}

apiFetch = async function(path, opts) {
  opts = opts || {};
  const lockCandidatePaths = _apiLockWriteCandidatePaths(path, opts);
  // まとめての移動・削除で、ロックを取れなかった項目を外した後の対象（外していなければ上と同じ）
  let sentLockCandidatePaths = lockCandidatePaths;
  _apiLockBlockIfNeeded(path, opts);
  const activeLocks = window.MeldexActiveLocks;
  const lockBatchRoute = _apiLockBatchRoute(path, opts);
  // まとめての移動・削除は、取れなかった項目だけを外して残りを進める（1件ずつの時は従来どおり全体を止める）
  // シート全体を変える保存（列・並べ替え・ビューの設定・列名の変更）は、その保存の間だけシート全体（中の行を含む）を
  // ロックし、終わったら放す。セルの入力は行（トピック）のファイルだけをロックするので、ほかの行への書き込み
  // （裏の取り込み・Web Clipper・ほかの端末）は通る（2026-11-25 利用者の判断「狭める」）。
  const sheetWide = _apiIsSheetWideWrite(path, opts);
  const lockSpecs = sheetWide === 'schema'
    ? lockCandidatePaths.map(candidate => ({ path: candidate, includeDescendants: true }))
    : lockCandidatePaths;
  const transientLease = !((_apiUsesTransientActiveLock(path) || sheetWide) && activeLocks?.acquireMutationLocks) ? null
    : lockBatchRoute ? await activeLocks.acquireMutationLocks(lockCandidatePaths, { partial: true })
    : await activeLocks.acquireMutationLocks(lockSpecs);
  let lockRejectedOrder = null;
  if (lockBatchRoute && transientLease?.failed?.length) {
    const split = _apiSplitLockRejectedItems(opts, transientLease.failed);
    if (split.fatal || (split.order && !split.keptCount)) {
      await transientLease.release();
      if (split.fatal) throw split.fatal;
      return _apiMergeLockRejectedResults({ results: [] }, split.order);
    }
    if (split.order) {
      opts = split.opts;
      sentLockCandidatePaths = _apiLockWriteCandidatePaths(path, opts);
      lockRejectedOrder = split.order;
    }
  }
  const deferredCommittedUnlock = String(opts.method || 'GET').toUpperCase() === 'POST'
    && ['/outliner/add', '/outliner/duplicate', '/outliner/save-as'].includes(String(path || '').split('?')[0].replace(/^\/api(?=\/|$)/, ''));
  let mutationSucceeded = false;
  try {
    if (activeLocks?.beforeApiFetch) {
      opts = await activeLocks.beforeApiFetch(path, opts, { candidatePaths: sheetWide === 'schema' ? lockSpecs : sentLockCandidatePaths });
    }
    // 表示名と安定IDを自動付与（監査ログ・版履歴の編集者帰属用）
    const user = getUsername();
    const actorId = window.MeldexProfileIdentity?.getStableActorId?.() || '';
    const requestMethod = String(opts.method || 'GET').toUpperCase();
    const mutationRequest = requestMethod !== 'GET' && requestMethod !== 'HEAD';
    const identityParams = [];
    if (user && user !== 'anonymous' && !/[?&]_user=/.test(path)) identityParams.push('_user=' + encodeURIComponent(user));
    if (mutationRequest && actorId && !/[?&]_actor_id=/.test(path)) identityParams.push('_actor_id=' + encodeURIComponent(actorId));
    if (mutationRequest && !/[?&]_actor_kind=/.test(path)) identityParams.push('_actor_kind=human');
    if (identityParams.length) path += (path.includes('?') ? '&' : '?') + identityParams.join('&');
    let result = await _origApiFetch(path, opts);
    mutationSucceeded = true;
    if (lockRejectedOrder) result = _apiMergeLockRejectedResults(result, lockRejectedOrder);
    if (result?.history_sync_pending) {
      if (typeof showStatus === 'function') showStatus('本文は保存しました。変更履歴は接続回復後に同期します', true);
    } else if (result?.history_recorded === false) {
      if (typeof showStatus === 'function') showStatus('本文は保存しましたが、変更履歴を記録できませんでした', true);
    }
    return result;
  } finally {
    const release = transientLease?.release?.();
    if (deferredCommittedUnlock && mutationSucceeded) {
      // The new item and copy aftercare are durable. Show it while the short-lived lease
      // is released; the lock store waits for that release before reacquiring.
      void Promise.resolve(release).catch(error => console.warn('保存後のロック解除に失敗:', error));
    } else await release;
  }
};

// チームプロフィール同期（起動時に型付き管理領域へ自分を登録。source folderは変更しない）
// フォルダ別ロールを保持（DB列ロック等で参照）
let _myTeamRole = 'editor';  // デフォルト（ソースフォルダ未設定時）
const _myTeamRoles = {};     // { folderPath: role }

async function _syncMyTeamProfile() {
  try { await window.MeldexDropboxProfileSync?.resolveStartupProfile?.(); } catch {}
  const name = getUsername();
  if (!name || name === 'anonymous') return;
  const avatar = localStorage.getItem('meldex-avatar') || '';
  const teamPayload = (extra) => window.MeldexDropboxProfileSync?.teamSyncPayload?.({ name, avatar, ...(extra || {}) }) || { name, avatar, ...(extra || {}) };
  const syncFolderProfile = async (folder) => {
    // Profile registration is best effort at startup. A read-only/virtual root
    // must not interrupt startup or prevent reading its existing role.
    try {
      await apiPost('/team/sync', teamPayload(folder ? { folder } : undefined), { silentError: true });
    } catch (error) {
      console.warn('[team-profile] 起動時のプロフィール同期を保留しました:', error);
    }
    try {
      const members = await apiFetch('/team' + (folder ? '?folder=' + encodeURIComponent(folder) : ''), { silentError: true });
      const me = members.find(member => member.name === name);
      return me ? me.role || 'editor' : undefined;
    } catch (error) {
      console.warn('[team-profile] チーム情報を読み込めませんでした:', error);
      return undefined;
    }
  };
  const syncWorkspaceProfiles = async () => {
    try {
      const workspaces = typeof window.MeldexWorkspaces?.load === 'function'
        ? await window.MeldexWorkspaces.load({ force: true })
        : [];
      for (const workspace of workspaces || []) {
        if (!workspace?.id) continue;
        try {
          await apiPost('/workspaces/' + encodeURIComponent(workspace.id) + '/sync-profile', teamPayload({ workspace_id: workspace.id }), { silentError: true });
        } catch (error) {
          console.warn('[team-profile] ワークスペースのプロフィール同期を保留しました:', error);
        }
      }
      await window.MeldexWorkspaces?.load?.({ force: true });
    } catch {}
  };
  // 全ソースフォルダに対応する管理レコードへ同期
  try {
    const roots = await apiFetch('/outliner-roots').catch(() => []);
    const visibleRoots = roots.filter(r => r.visible && r.path);
    if (visibleRoots.length === 0) {
      // ソースフォルダなし → デフォルトvaultに対応する管理レコードへ同期
      const role = await syncFolderProfile();
      if (role) _myTeamRole = role;
      await syncWorkspaceProfiles();
      return;
    }
    for (const root of visibleRoots) {
      const role = await syncFolderProfile(root.path);
      if (role) _myTeamRoles[root.path] = role;
    }
    // デフォルトロール = 最初の可視ソースフォルダのロール
    const firstRole = _myTeamRoles[visibleRoots[0].path];
    if (firstRole) _myTeamRole = firstRole;
    await syncWorkspaceProfiles();
  } catch {}
}

let _startupSplashHidden = false;
function _notifyStartupReady() {
  if (typeof apiPost !== 'function') return;
  void apiPost('/startup-ready', {}, { silentError: true }).catch(() => {});
}

function _hideStartupSplash() {
  if (_startupSplashHidden) return;
  _startupSplashHidden = true;
  _notifyStartupReady();
  const splash = document.getElementById('gb-splash');
  if (!splash) return;
  splash.style.pointerEvents = 'none';
  splash.style.transition = 'opacity 0.3s';
  splash.style.opacity = '0';
  setTimeout(() => splash.remove(), 300);
}

function _withStartupTimeout(label, promise, timeoutMs, fallbackValue) {
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
  if (!timeout) return Promise.resolve(promise);
  const startedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[Meldex] startup timeout: ${label} (${timeout}ms)`);
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('startup.timeout.' + label, startedAt, { timeoutMs: timeout });
      }
      if (typeof _sendLog === 'function') {
        _sendLog('warn', { message: `[startup-timeout] ${label}`, timeoutMs: timeout });
      }
      resolve(fallbackValue);
    }, timeout);
    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('startup.ready.' + label, startedAt, { timeoutMs: timeout });
      }
      resolve(value);
    }).catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('startup.error.' + label, startedAt, {
          timeoutMs: timeout,
          error: error?.message || String(error),
        });
      }
      reject(error);
    });
  });
}

function _runStartupBackground(label, promise, onReady) {
  Promise.resolve(promise)
    .then((value) => {
      if (typeof onReady === 'function') onReady(value);
      return value;
    })
    .catch((error) => {
      console.warn(`[Meldex] startup background task failed: ${label}`, error);
      if (typeof _sendLog === 'function') {
        _sendLog('warn', {
          message: `[startup-bg-failed] ${label}: ${error?.message || error}`,
          stack: error?.stack || '',
        });
      }
      return null;
    });
}

function _refreshOutlinerAfterStartupReady() {
  try {
    const outlinerOptions = {
      coalesce: true,
      skipIfRecentlyLoaded: true,
      reason: 'startup-ready',
    };
    if (typeof refreshOutliner === 'function') return refreshOutliner(outlinerOptions);
    const refreshJobs = [];
    if (typeof loadOutliner === 'function') refreshJobs.push(Promise.resolve().then(() => loadOutliner(outlinerOptions)));
    if (typeof renderFavorites === 'function') refreshJobs.push(Promise.resolve().then(() => renderFavorites()));
    if (typeof renderHomeFolderTree === 'function') refreshJobs.push(Promise.resolve().then(() => renderHomeFolderTree()));
    return Promise.allSettled(refreshJobs);
  } catch (error) {
    console.warn('[Meldex] startup outliner refresh failed:', error);
    return Promise.resolve(null);
  }
}

function _highlightLastOutlinerNodeAfterStartup() {
  setTimeout(() => {
    const last = _readLastViewFromStorage();
    if (!last) return;
    const p = last.path || last.dbPath || last.entityPath || '';
    if (p) highlightOutlinerNode(p);
  }, 500);
}

function _readLastViewFromStorage() {
  try {
    return JSON.parse(localStorage.getItem('lastView') || 'null');
  } catch {
    localStorage.removeItem('lastView');
    return null;
  }
}

async function _openCloudStartupHome(homeRes, isUrlOpen, onboardingShown) {
  // Explicit links keep their target; Desktop keeps its saved workspace.
  if (_isDesktopStartupLaunch() || isUrlOpen || onboardingShown || !homeRes?.exists || !homeRes.path) return false;
  // ホームから始めるのは Cloud（この端末内・Dropbox の保存先）だけ。本体のサーバーを普通のブラウザで
  // 開いた時は、デスクトップ版と同じく前回のタブを復元する（ここでホームを開くと、復元中のシートのタブが
  // 「ホームフォルダ」に置き換わり、タブ名と本文が食い違ったまま表が描かれなかった。2026-11-22 探索）。
  const runtime = typeof window !== 'undefined' ? window.MeldexRuntimeAdapter : null;
  if (!runtime?.isBrowserDataMode?.()) return false;
  const label = typeof HOME_FOLDER_DISPLAY_LABEL !== 'undefined' ? HOME_FOLDER_DISPLAY_LABEL : 'ホームフォルダ';
  await openFolder(label, homeRes.path, {
    fromExplorer: true,
    skipAutoAppLayout: true,
    skipSaveLastView: true,
  });
