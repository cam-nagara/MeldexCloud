/* standalone-timer-calendar-provider.js
 * タイマー単独版のカレンダー読込を、ローカルAPI・Dropbox・端末内キャッシュで統一する。
 */
(function (global) {
  'use strict';

  const CACHE_KEY = 'meldex-timer-calendar-cache-v3';
  const EPOCH_KEY_PREFIX = 'meldex-timer-calendar-cache-epoch-v1:';
  const state = {
    source: 'unconfigured',
    reason: '連動するカレンダーがまだ設定されていません',
    nextAction: 'Meldexでカレンダーを作成するか、Dropboxへ接続してください',
    updatedAt: '',
    lastError: '',
  };
  let originalApiFetch = null;
  const memoryEpochs = new Map();

  function _clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function _readCache() {
    try {
      const value = JSON.parse(global.localStorage?.getItem(CACHE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function _epochStorageKey(context) {
    return EPOCH_KEY_PREFIX + context.rootKey;
  }

  function _rootEpoch(context) {
    const memory = memoryEpochs.get(context.rootKey);
    try {
      const stored = String(global.localStorage?.getItem(_epochStorageKey(context)) || '');
      if (memory?.localOnly && stored === memory.storageBaseline) {
        try {
          global.localStorage?.setItem(_epochStorageKey(context), memory.value);
          const promoted = String(
            global.localStorage?.getItem(_epochStorageKey(context)) || '',
          );
          if (promoted === memory.value) {
            memoryEpochs.set(context.rootKey, {
              value: memory.value,
              localOnly: false,
              storageBaseline: memory.value,
            });
          }
        } catch {
          // 復旧前はmemory epochを正本として維持する。
        }
        if (memoryEpochs.get(context.rootKey)?.localOnly) {
          return String(memory.value || '');
        }
        return String(memoryEpochs.get(context.rootKey)?.value || '');
      }
      if (stored) {
        memoryEpochs.set(context.rootKey, {
          value: stored,
          localOnly: false,
          storageBaseline: stored,
        });
        return stored;
      }
    } catch {
      // localStorageが拒否されても、同一タブ内の権威epochは保持する。
    }
    return String(memory?.value || '');
  }

  function _newEpoch() {
    const random = global.crypto?.randomUUID?.()
      || Math.random().toString(36).slice(2);
    return `epoch-${random}`;
  }

  async function _scopeContext(url) {
    const parsed = new URL(String(url || ''), global.location?.href || 'http://localhost/');
    parsed.searchParams.sort();
    const cloudStatus = global.MeldexStandaloneCloud?.getStatus?.() || {};
    const root = global.MeldexStandaloneCloud?.getActiveRoot?.() || cloudStatus.activeRoot || {};
    let accountId = String(cloudStatus.accountId || cloudStatus.account_id || '');
    if (!accountId && global.MeldexDropboxAuth?.getSession) {
      try { accountId = String((await global.MeldexDropboxAuth.getSession())?.accountId || ''); } catch {}
    }
    const identity = {
      mode: _isCloud() ? 'cloud' : 'local',
      accountId: accountId || (_isCloud() ? 'unidentified' : 'local'),
      root: root.id || root.sourceId || root.path || 'default',
    };
    const rootKey = 'root:' + JSON.stringify(identity);
    return {
      identity,
      rootKey,
      key: 'scope:' + JSON.stringify({
        ...identity,
        request: parsed.pathname + parsed.search,
      }),
    };
  }

  function _scopeCache(cache, scope) {
    cache.scopes ||= {};
    cache.scopes[scope] ||= {};
    return cache.scopes[scope];
  }

  function _rowsForEpoch(cache, context, kind, epoch) {
    const scoped = _scopeCache(cache, context.key);
    return scoped.epoch === epoch && Array.isArray(scoped[kind])
      ? _clone(scoped[kind])
      : [];
  }

  function _writeCache(context, kind, rows, expectedEpoch) {
    if (_rootEpoch(context) !== expectedEpoch) return null;
    const cache = _readCache();
    const scoped = _scopeCache(cache, context.key);
    scoped.identity = _clone(context.identity);
    scoped.rootKey = context.rootKey;
    scoped.epoch = expectedEpoch;
    scoped[kind] = _clone(Array.isArray(rows) ? rows : []);
    scoped.updatedAt = new Date().toISOString();
    try { global.localStorage?.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
    if (_rootEpoch(context) !== expectedEpoch) return null;
    return scoped;
  }

  function _invalidateCloudRootCache(context) {
    const epoch = _newEpoch();
    let storageBaseline = '';
    try {
      storageBaseline = String(
        global.localStorage?.getItem(_epochStorageKey(context)) || '',
      );
    } catch {}
    memoryEpochs.set(context.rootKey, {
      value: epoch,
      localOnly: true,
      storageBaseline,
    });
    try {
      global.localStorage?.setItem(_epochStorageKey(context), epoch);
      const persisted = global.localStorage?.getItem(_epochStorageKey(context)) === epoch;
      memoryEpochs.set(context.rootKey, {
        value: epoch,
        localOnly: !persisted,
        storageBaseline: persisted ? epoch : storageBaseline,
      });
    } catch {}
    const cache = _readCache();
    cache.scopes ||= {};
    for (const [key, scoped] of Object.entries(cache.scopes)) {
      const identity = scoped?.identity || {};
      const sameIdentity = identity.mode === context.identity.mode
        && identity.accountId === context.identity.accountId
        && identity.root === context.identity.root;
      if (scoped?.rootKey === context.rootKey || sameIdentity) delete cache.scopes[key];
    }
    const updatedAt = new Date().toISOString();
    try { global.localStorage?.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
    return { epoch, updatedAt };
  }

  function _publish(next) {
    Object.assign(state, next || {});
    global.dispatchEvent?.(new CustomEvent('meldex:timer-calendar-provider-status', {
      detail: { ...state },
    }));
    return { ...state };
  }

  function _errorKind(error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
    const text = String(error?.message || error || '').toLowerCase();
    if (status === 404) return 'missing';
    if (status === 409 || text.includes('conflict') || text.includes('競合')) return 'conflict';
    if (status === 401 || status === 403 || text.includes('permission') || text.includes('権限')) return 'permission';
    if (global.navigator?.onLine === false || text.includes('offline') || text.includes('network')) return 'offline';
    return 'error';
  }

  function _isCloudTransportFailure(error, kind) {
    if (!_isCloud()) return false;
    const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
    return kind === 'offline' || status === 0 || status >= 500;
  }

  function _statusForError(kind, hasCache, error) {
    if (hasCache) {
      return {
        source: 'offline_cache',
        reason: kind === 'conflict'
          ? 'Dropbox側と競合しているため、最後に取得したカレンダーを表示しています'
          : '接続できないため、最後に取得したカレンダーを表示しています',
        nextAction: kind === 'permission'
          ? 'Dropboxの閲覧権限を確認してから再試行してください'
          : '接続または競合を解消してから再試行してください',
        lastError: String(error?.message || error || ''),
      };
    }
    const messages = {
      conflict: ['Dropbox側のカレンダーと競合しています', 'Meldex版本体で競合を解消してから再試行してください'],
      permission: ['カレンダーを読み取る権限がありません', 'Dropboxの共有権限を確認してから再試行してください'],
      offline: ['オフラインで、端末内にカレンダーの履歴がありません', '接続後にカレンダー一覧を更新してください'],
      error: ['カレンダーを読み込めませんでした', '接続設定を確認してから再試行してください'],
    };
    const [reason, nextAction] = messages[kind] || messages.error;
    return { source: kind, reason, nextAction, lastError: String(error?.message || error || '') };
  }

  function _isCloud() {
    return global.MeldexStandaloneCloud?.isCloudMode?.() === true;
  }

  async function _requestRemote(url, options) {
    if (_isCloud()) {
      return _requestCloudCalendar(url);
    }
    if (typeof originalApiFetch === 'function') return originalApiFetch(url, options);
    throw new Error('ローカルのカレンダーAPIが利用できません');
  }

  function _joinPath(base, child) {
    return [String(base || '').replace(/\/+$/, ''), String(child || '').replace(/^\/+/, '')]
      .filter(Boolean)
      .join('/');
  }

  async function _requestCloudCalendar(url) {
    const parsed = new URL(String(url || ''), global.location?.href || 'http://localhost/');
    const route = _calendarRoute(parsed.pathname);
    if (!route) throw new Error('カレンダーの読込先を確認できません');
    const cloud = global.MeldexStandaloneCloud;
    const dataAccess = global.MeldexDataAccess;
    if (!cloud?.getActiveRoot || !dataAccess?.requestJson) {
      const error = new Error('Dropboxのカレンダー保存先を利用できません');
      error.status = 503;
      throw error;
    }
    const root = cloud.getActiveRoot() || {};
    const rootPath = String(root.path || root.sourcePath || '').trim();
    if (!rootPath) {
      const error = new Error('Dropboxのソースフォルダを選んでください');
      error.status = 403;
      throw error;
    }
    const snapshotPath = _joinPath(rootPath, '_scheduler_shared/scheduler.snapshot.json');
    const response = await dataAccess.requestJson(
      '/file?path=' + encodeURIComponent(snapshotPath),
      { method: 'GET' },
    );
    let snapshot;
    try {
      snapshot = JSON.parse(String(response?.content || '{}'));
    } catch {
      const error = new Error('Dropboxのカレンダー保存内容が壊れています');
      error.status = 500;
      throw error;
    }
    const table = route === 'calendars' ? 'cal_calendars' : 'cal_events';
    const records = snapshot?.tables?.[table];
    let rows = records && typeof records === 'object'
      ? Object.values(records).map(item => item?.row).filter(item => item && typeof item === 'object')
      : [];
    const user = parsed.searchParams.get('user') || '';
    if (user) rows = rows.filter(row => String(row.user || '') === user);
    if (route === 'events') {
      const start = parsed.searchParams.get('start') || '';
      const end = parsed.searchParams.get('end') || '';
      if (start) rows = rows.filter(row => String(row.end || row.start || '') >= start);
      if (end) rows = rows.filter(row => String(row.start || '') <= end);
    }
    const revision = String(response?.etag || response?.revision || '');
    return {
      rows,
      source: 'dropbox',
      error: null,
      revision,
      snapshotPath,
    };
  }

  function _localStatus(result, rows) {
    const source = String(result?.source || 'local');
    if (source === 'sqlite_error' || result?.error) {
      const message = String(result?.error?.message || 'Meldexのカレンダーデータを読み取れません');
      return {
        source: 'sqlite_error',
        reason: message,
        nextAction: 'Meldex本体を終了してデータベースの状態を確認してから再試行してください',
        lastError: String(result?.error?.detail || message),
      };
    }
    if (source === 'sqlite_missing') {
      return {
        source,
        reason: 'Meldex本体のカレンダーデータがまだ作成されていません',
        nextAction: 'Meldex本体でカレンダーを作成してから一覧を更新してください',
        lastError: '',
      };
    }
    return {
      source,
      reason: rows.length ? '' : '連動できるカレンダーがありません',
      nextAction: rows.length ? '' : 'Meldex本体でカレンダーを作成してから一覧を更新してください',
      lastError: '',
    };
  }

  async function _load(kind, url, options) {
    const context = await _scopeContext(url);
    const requestEpoch = _rootEpoch(context);
    const cachedRows = _rowsForEpoch(_readCache(), context, kind, requestEpoch);
    const currentAuthoritativeRows = () => _rowsForEpoch(
      _readCache(), context, kind, _rootEpoch(context),
    );
    if (_isCloud() && global.navigator?.onLine === false) {
      const offlineContext = await _scopeContext(url);
      const offlineEpoch = _rootEpoch(offlineContext);
      const offlineRows = _rowsForEpoch(
        _readCache(), offlineContext, kind, offlineEpoch,
      );
      _publish(_statusForError('offline', offlineRows.length > 0, new Error('offline')));
      return offlineRows;
    }
    try {
      const result = await _requestRemote(url, options);
      if (_isCloud() && _rootEpoch(context) !== requestEpoch) {
        return currentAuthoritativeRows();
      }
      const rows = Array.isArray(result)
        ? result
        : (Array.isArray(result?.rows) ? result.rows : []);
      if (!_isCloud() && (result?.source === 'sqlite_error' || result?.error)) {
        _publish(_localStatus(result, []));
        return [];
      }
      const nextCache = _writeCache(context, kind, rows, requestEpoch);
      if (!nextCache) return currentAuthoritativeRows();
      const status = _isCloud()
        ? {
            source: String(result?.source || 'dropbox'),
            reason: rows.length ? '' : '連動できるカレンダーがありません',
            nextAction: rows.length ? '' : 'Meldex本体でカレンダーを作成してから一覧を更新してください',
            lastError: '',
          }
        : _localStatus(result, rows);
      _publish({
        ...status,
        updatedAt: nextCache.updatedAt,
        revision: result?.revision || state.revision || '',
      });
      return rows;
    } catch (error) {
      if (_isCloud() && _rootEpoch(context) !== requestEpoch) {
        return currentAuthoritativeRows();
      }
      const kindName = _errorKind(error);
      if (_isCloud() && kindName === 'missing') {
        const invalidation = _invalidateCloudRootCache(context);
        _publish({
          source: 'dropbox_missing',
          reason: 'Dropboxにカレンダーデータがまだ作成されていません',
          nextAction: 'Meldex本体でカレンダーを作成してから一覧を更新してください',
          updatedAt: invalidation.updatedAt,
          lastError: '',
        });
        return [];
      }
      const allowCache = _isCloudTransportFailure(error, kindName) && cachedRows.length > 0;
      _publish(_statusForError(kindName, allowCache, error));
      return allowCache ? _clone(cachedRows) : [];
    }
  }

  function _calendarRoute(url) {
    const path = new URL(String(url || ''), global.location?.href || 'http://localhost/').pathname;
    if (path === '/cal/calendars' || path === '/api/cal/calendars') return 'calendars';
    if (path === '/cal/events' || path === '/api/cal/events') return 'events';
    return '';
  }

  function install() {
    if (global.apiFetch?._meldexTimerCalendarProvider) return;
    originalApiFetch = global.apiFetch;
    const wrapped = function (url, options) {
      const route = _calendarRoute(url);
      return route ? _load(route, url, options) : originalApiFetch(url, options);
    };
    wrapped._meldexTimerCalendarProvider = true;
    global.apiFetch = wrapped;
  }

  global.MeldexStandaloneTimerCalendarProvider = {
    install,
    loadCalendars: query => _load('calendars', '/cal/calendars' + (query || '')),
    loadEvents: query => _load('events', '/cal/events' + (query || '')),
    getStatus: () => ({ ...state }),
    getCache: () => _clone(_readCache()),
    clearCache: () => {
      try { global.localStorage?.removeItem(CACHE_KEY); } catch {}
    },
  };
})(window);
