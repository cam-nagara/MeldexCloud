            ...perfInfo,
            backendPerf,
            retriedAfterMutation,
          });
        }
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
        window.MeldexSaveSafety?.reportApiSuccess?.(path, requestOpts);
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
      if (!opts?.silentError) window.MeldexDiagnostics?.captureApiError?.(path, opts, e);
      if (!opts?.silentError && !window.MeldexSaveSafety?.reportApiError?.(path, opts, e)) {
        if (_gbAppApiFetchIsAbortError(e) && method === 'GET') {
          // GET中断/タイムアウトはエラートースト表示せず、コンソールログのみに留める（呼び出し元は再試行等で処理する）
          try { console.warn('[apiFetch] aborted:', path, e.message); } catch {}
        } else {
          const text = window.MeldexErrorMessages?.toStatusText?.(e, { path }) || e.message;
          showStatus('エラー: ' + text, true);
        }
      }
      throw e;
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

async function apiPut(path, body) {
  return apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function apiPost(path, body, options = {}) {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(options || {}),
  });
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
  } else if (route === '/upload-file') {
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
  } else if (route === '/outliner/rename') {
    addBody('old_path');
    const oldPath = String(body?.old_path || '');
    const newName = String(body?.new_name || '').trim();
    if (oldPath && newName) {
      const destinationBase = (_apiLockPathDir(oldPath) ? _apiLockPathDir(oldPath) + '/' : '') + newName;
      _apiLockAddPath(paths, destinationBase);
      const extension = _apiLockRenameExtension(oldPath);
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
  } else if (route === '/version/restore' || route === '/version/restore-db' || route === '/version/restore-folder' || route === '/version/delete-folder') {
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

function _apiUsesTransientActiveLock(path) {
  let route = '';
  try { route = new URL(String(path || ''), window.location.origin).pathname.replace(/^\/api(?=\/|$)/, '') || '/'; }
  catch { return false; }
  return new Set([
    '/upload-file', '/outliner/add', '/outliner/rename', '/outliner/delete',
    '/outliner/delete-batch', '/outliner/restore', '/outliner/duplicate',
    '/outliner/save-as', '/outliner/move', '/trash/restore',
  ]).has(route);
}

// apiFetchをオーバーライドしてユーザー名を付加
const _origApiFetch = apiFetch;
apiFetch = async function(path, opts) {
  opts = opts || {};
  const lockCandidatePaths = _apiLockWriteCandidatePaths(path, opts);
  _apiLockBlockIfNeeded(path, opts);
  const activeLocks = window.MeldexActiveLocks;
  const transientLease = _apiUsesTransientActiveLock(path) && activeLocks?.acquireMutationLocks
    ? await activeLocks.acquireMutationLocks(lockCandidatePaths)
    : null;
  try {
    if (activeLocks?.beforeApiFetch) {
      opts = await activeLocks.beforeApiFetch(path, opts, { candidatePaths: lockCandidatePaths });
    }
    // _user パラメータを自動付与（監査ログ・modified_by 用）
    const user = getUsername();
    if (user && user !== 'anonymous') {
      const sep = path.includes('?') ? '&' : '?';
      path += sep + '_user=' + encodeURIComponent(user);
    }
    return await _origApiFetch(path, opts);
  } finally {
    await transientLease?.release?.();
  }
};

// チームプロフィール同期（起動時に全ソースフォルダの _Meldex_team.json に自分を登録）
// フォルダ別ロールを保持（DB列ロック等で参照）
let _myTeamRole = 'editor';  // デフォルト（ソースフォルダ未設定時）
const _myTeamRoles = {};     // { folderPath: role }

async function _syncMyTeamProfile() {
  try { await window.MeldexDropboxProfileSync?.resolveStartupProfile?.(); } catch {}
  const name = getUsername();
  if (!name || name === 'anonymous') return;
  const avatar = localStorage.getItem('meldex-avatar') || '';
  const teamPayload = (extra) => window.MeldexDropboxProfileSync?.teamSyncPayload?.({ name, avatar, ...(extra || {}) }) || { name, avatar, ...(extra || {}) };
  const syncWorkspaceProfiles = async () => {
    try {
      const workspaces = typeof window.MeldexWorkspaces?.load === 'function'
        ? await window.MeldexWorkspaces.load({ force: true })
        : [];
      for (const workspace of workspaces || []) {
        if (!workspace?.id) continue;
        await apiPost('/workspaces/' + encodeURIComponent(workspace.id) + '/sync-profile', teamPayload({ workspace_id: workspace.id }));
      }
      await window.MeldexWorkspaces?.load?.({ force: true });
    } catch {}
  };
  // 全ソースフォルダに同期
  try {
    const roots = await apiFetch('/outliner-roots').catch(() => []);
    const visibleRoots = roots.filter(r => r.visible && r.path);
    if (visibleRoots.length === 0) {
      // ソースフォルダなし → デフォルトvaultに同期
      try {
        await apiPost('/team/sync', teamPayload());
        const members = await apiFetch('/team');
        const me = members.find(m => m.name === name);
        if (me) _myTeamRole = me.role || 'editor';
      } catch {}
      await syncWorkspaceProfiles();
      return;
    }
    for (const root of visibleRoots) {
      try {
        await apiPost('/team/sync', teamPayload({ folder: root.path }));
        const members = await apiFetch('/team?folder=' + encodeURIComponent(root.path));
        const me = members.find(m => m.name === name);
        if (me) _myTeamRoles[root.path] = me.role || 'editor';
      } catch {}
    }
    // デフォルトロール = 最初の可視ソースフォルダのロール
    const firstRole = _myTeamRoles[visibleRoots[0].path];
    if (firstRole) _myTeamRole = firstRole;
    await syncWorkspaceProfiles();
  } catch {}
}

let _startupSplashHidden = false;
function _hideStartupSplash() {
  if (_startupSplashHidden) return;
  _startupSplashHidden = true;
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

function _repairStartupDatabaseViewTabs() {
  try {
    if (!state.currentDbPath || typeof _renderDbViewTabsSafely !== 'function') return;
    const tabs = document.getElementById('db-view-tabs') || document.querySelector('.db-view-tabs');
    if (!tabs) return;
    if (tabs.querySelector('[data-e2e-id^="db-view-add-"]')) return;
    _renderDbViewTabsSafely(typeof _currentPaneState === 'function' ? _currentPaneState() : null);
  } catch {}
}

function _scheduleStartupDatabaseViewTabsRepair() {
  [0, 80, 250].forEach(delay => setTimeout(_repairStartupDatabaseViewTabs, delay));
}

async function _restoreStartupBoardView(label, path, opts) {
  const openOpts = opts || {};
  const boardLabel = label || String(path || '').split(/[\\/]/).pop() || '';
  if (typeof GBPaneBridge !== 'undefined'
    && GBPaneBridge?.initialized
    && typeof GBLayout !== 'undefined'
    && typeof GBTabs !== 'undefined'
    && typeof navPush === 'function') {
    state.view = 'board';
    state.currentBoardPath = path;
    navPush({ type: 'board', label: boardLabel, path });
    if (typeof GBPaneBridge.refreshPaneAfterTabSwitch === 'function') {
      GBPaneBridge.refreshPaneAfterTabSwitch(GBLayout.activePane, { force: true });
    }
    if (!openOpts.skipSaveLastView) saveLastView({ type: 'board', label: boardLabel, path });
    if (!openOpts.skipRecent && typeof addRecent === 'function') addRecent(boardLabel, path, 'board');
    if (!openOpts.skipHighlight && typeof highlightOutlinerNode === 'function') highlightOutlinerNode(path);
    if (!openOpts.skipAutoVersion && typeof startAutoVersion === 'function') startAutoVersion(path, 'file');
    return true;
  }
  const opened = typeof openBoard === 'function' ? await openBoard(boardLabel, path, openOpts) : false;
  return opened !== false;
}

// 特定フォルダ内のパスに対するロールを取得
function getMyRoleForPath(filePath) {
  if (!filePath) return _myTeamRole;
  const normFile = String(filePath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  let matchedRole = '';
  let matchedLength = -1;
  for (const [folder, role] of Object.entries(_myTeamRoles)) {
    const norm = String(folder || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (!norm) continue;
    if ((normFile === norm || normFile.startsWith(norm + '/')) && norm.length > matchedLength) {
      matchedRole = role;
      matchedLength = norm.length;
    }
  }
  return matchedRole || _myTeamRole;
}

// doLogin / ログイン画面は廃止（チーム方式に移行）

// localStorage移行（旧CrossFolio → Meldex、一度だけ実行）
(function migrateLocalStorage() {
  if (localStorage.getItem('gb:migrated')) return;
  const migrations = {
    'crossfolio-auth-token': 'meldex-auth-token',
    'crossfolio-user': 'meldex-user',
    'crossfolio-recent': 'meldex-recent',
    'crossfolio-theme-vars': 'meldex-theme-vars',
    'crossfolio-favorites': 'meldex-favorites',
    'cf-cal-start-day': 'gb-cal-start-day',
  };
  for (const [oldKey, newKey] of Object.entries(migrations)) {
    const val = localStorage.getItem(oldKey);
    if (val !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, val);
    }
  }
  // cf-cal-mode-*, cf-cal-date-* のプレフィックス移行
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('cf-cal-')) {
      const newKey = key.replace('cf-cal-', 'gb-cal-');
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, localStorage.getItem(key));
      }
    }
  }
  localStorage.setItem('gb:migrated', '1');
  if (typeof _refreshOutlinerStorageViewsAfterMigration === 'function') {
    _refreshOutlinerStorageViewsAfterMigration();
  }
})();

async function init() {
  const initStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
  // チームプロフィール同期は権限情報の更新用途。起動表示は待たず、裏で完了させる。
  _runStartupBackground('team-profile-sync', _syncMyTeamProfile());

  try {
    const initialFetchStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
    const [vault, roots, homeRes] = await Promise.all([
      _withStartupTimeout('vault', apiFetch('/vault'), 5000, { path: '', name: '' }),
      _withStartupTimeout('outliner-roots', apiFetch('/outliner-roots').catch(() => []), 5000, []),
      _withStartupTimeout('home-folder', apiFetch('/home-folder').catch(() => ({ exists: false })), 5000, { exists: false }),
    ]);
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('startup.initial-fetches', initialFetchStartedAt, {
        rootsCount: Array.isArray(roots) ? roots.length : 0,
        hasHome: !!homeRes?.exists,
      });
    }
    state.vaultPath = vault.path;
    try {
      if (homeRes?.path && typeof _homeFolderPath !== 'undefined') _homeFolderPath = homeRes.path;
    } catch (e) {}

    const hasRoots = roots.length > 0 && roots.some(r => r.visible);
    const hasHome = homeRes.exists;
    const onboardingShown = !!window.MeldexOnboarding?.handleStartupState?.({
      vaultPath: vault.path || '',
      hasRoots,
      hasHome,
      homePath: homeRes?.path || '',
    });
    if (hasHome && !window.MeldexRuntimeAdapter?.isDropboxMode?.()) {
      window.MeldexSampleInstaller?.schedulePostSetupPrompt?.({
        trigger: 'desktop-home-ready',
        homePath: homeRes?.path || '',
      });
    }
    if (!vault.path && !hasRoots && !hasHome) {
      // ソースフォルダもルートもホームもない場合はウェルカム画面
      // ただしサイドバーは表示したまま（設定ボタンにアクセスできるように）
      showView('welcome');
    }

    document.getElementById('sb-work').textContent = vault.path ? ('ソースフォルダ: ' + vault.name) : '';
    document.getElementById('current-title').textContent = '';

    // file_id マイグレーションは初回のみだが、起動表示を止めないよう背景化する。
    const rawMigrationPromise = _migratePathsToFileIds();
    const migrationPromise = _withStartupTimeout('file-id-migration', rawMigrationPromise, 5000, null);

    // 廃止された非表示機能の localStorage を一度だけ除去
    if (!localStorage.getItem('_folder-hidden-removed')) {
      localStorage.removeItem('folder-files-hidden');
      localStorage.setItem('_folder-hidden-removed', '1');
    }
    if (typeof removeLegacyDashboardStorageOnce === 'function') removeLegacyDashboardStorageOnce();

    // フォルダツリーとビュー復元を並行実行
    const outlinerStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
    const outlinerPromise = Promise.resolve(loadOutliner()).finally(() => {
      if (typeof _logPerfEvent === 'function') _logPerfEvent('startup.loadOutliner.promise', outlinerStartedAt);
    });
    const linkDictPromise = loadLinkDict();

    // URLパラメータによる初期表示（新しいタブ/ウィンドウで開く用）
    let restored = onboardingShown;
    const restoredByPaneLayout = _paneLayoutRestoredFromStorage();
    const urlParams = new URLSearchParams(window.location.search);
    const openType = urlParams.get('open');
    const openPath = urlParams.get('path');
    const openLabel = urlParams.get('label') || (openPath ? openPath.split('/').pop() : '');
    const isUrlOpen = !!(openType && openPath);
    if (isUrlOpen && _isCloudPhase1UnsupportedOpenType(openType)) {
      _showCloudPhase1UnsupportedOpen(openType);
      restored = true;
    } else if (isUrlOpen) {
      const _urlOpenOpts = { skipAutoAppLayout: true, skipSaveLastView: true };
      // URLパラメータ経由の場合、lastViewを上書きしないフラグを設定
      const previousSkipLastView = window._skipLastViewSave;
      window._skipLastViewSave = true;
      try {
        if (openType === 'page') { openPage(openLabel, openPath, _urlOpenOpts); restored = true; }
        else if (openType === 'board') { restored = await _restoreStartupBoardView(openLabel, openPath, _urlOpenOpts); }
        else if (openType === 'entity') { selectEntity(openPath, _urlOpenOpts); restored = true; }
        else if (openType === 'pivot' || openType === 'database') { await selectDatabase(openPath, null, _urlOpenOpts); restored = true; }
        else if (openType === 'media' || openType === 'image' || openType === 'video' || openType === 'audio') {
          const mt = urlParams.get('mediaType') || (openType === 'media' ? 'image' : openType);
          openMedia(openLabel, openPath, mt, _urlOpenOpts);
          restored = true;
        }
        else if (openType === 'document') {
          if (typeof openViewer === 'function') {
            const viewerUrl = /\.pdf(?:[?#]|$)/i.test(openPath)
              ? '/viewer?pdf=' + encodeURIComponent(openPath)
              : '/viewer?file=' + encodeURIComponent(openPath);
            openViewer(viewerUrl, _urlOpenOpts);
            restored = true;
          }
        }
        else if (openType === 'html') { openHtmlFile(openLabel, openPath, _urlOpenOpts); restored = true; }
        else if (openType === 'csv') { if (typeof openCsvFile === 'function') { openCsvFile(openLabel, openPath, _urlOpenOpts); restored = true; } }
        else if (openType === 'folder') { openFolder(openLabel, openPath, _urlOpenOpts); restored = true; }
        else if (openType === 'calendar') { await openCalendarFile(openLabel, openPath, _urlOpenOpts); restored = true; }
        else if (openType === 'chat') {
          if (typeof openSavedChat === 'function') {
            await openSavedChat(openPath);
            restored = true;
          }
        }
        else if (openType === 'scriptnote' || openType === 'scenario') {
          if (typeof openScenarioInScriptNote === 'function') {
            openScenarioInScriptNote(openPath, openLabel, _urlOpenOpts);
            restored = true;
          }
        }
        else if (openType === 'smart-db') {
          if (typeof openSmartDbFile === 'function') {
            openSmartDbFile(openLabel, openPath, _urlOpenOpts);
            restored = true;
          }
        }
      } finally {
        window._skipLastViewSave = previousSkipLastView;
      }
    }

    // v5.0 ペイン配置が復元済みなら、旧 lastView 復元でアクティブペインを上書きしない。
    if (!restored && restoredByPaneLayout) restored = true;

    // 前回のビューを即座に復元（URLパラメータがなかった場合）
    if (!restored) {
      const restoreStartedAt = typeof _perfNowMs === 'function' ? _perfNowMs() : Date.now();
      try {
        let last = _readLastViewFromStorage();
        if (last && _isCloudPhase1UnsupportedOpenType(last.type)) {
          localStorage.removeItem('lastView');
          _showCloudPhase1UnsupportedOpen(last.type);
          last = null;
        }
        const _expOpts = { fromExplorer: true, skipAutoAppLayout: true };
        if (last) {
          if (last.type === 'pivot' && last.dbPath) { await selectDatabase(last.dbPath, null, _expOpts); restored = true; }
          else if (last.type === 'entity' && last.entityPath) { selectEntity(last.entityPath, _expOpts); restored = true; }
          else if (last.type === 'page' && last.path) { openPage(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'board' && last.path) { restored = await _restoreStartupBoardView(last.label || '', last.path, _expOpts); }
          else if (last.type === 'media' && last.path) { openMedia(last.label || '', last.path, last.mediaType || 'image', _expOpts); restored = true; }
          else if (last.type === 'html' && last.path) { openHtmlFile(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'csv' && last.path) { if (typeof openCsvFile === 'function') { openCsvFile(last.label || '', last.path, _expOpts); restored = true; } }
          else if (last.type === 'scriptnote' && last.path && typeof openScenarioInScriptNote === 'function') { openScenarioInScriptNote(last.path, last.label || '', _expOpts); restored = true; }
          else if (last.type === 'folder' && last.path) { openFolder(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'calendar' && last.path) { await openCalendarFile(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'smart-db' && last.path && last.path.startsWith('file:') === false && typeof openSmartDbFile === 'function') { openSmartDbFile(last.label || '', last.path, _expOpts); restored = true; }
          else if (last.type === 'smart-db' && last.smartDbId) { selectSmartDb(last.smartDbId, null, _expOpts); restored = true; }
        }
      } catch (e) {}
      if (typeof _logPerfEvent === 'function') {
        _logPerfEvent('startup.restore-last-view', restoreStartedAt, { restored });
      }
    } // if (!restored) from URL params

    // 初回起動: lastView もURLパラメータも無く、過去にクイックスタートを開いた履歴が無ければ
    // マニュアルのクイックスタートをノートとして開く（ファイルが存在する場合のみ）
    if (!restored && !localStorage.getItem('meldex-quickstart-shown') && _homeFolderPath) {
      const _qsPath = _homeFolderPath.replace(/[\\/]$/, '') + '/マニュアル/01_はじめに/クイックスタート.md';
      try {
        const _check = await apiFetch('/file?path=' + encodeURIComponent(_qsPath), { silentError: true });
        if (_check && typeof _check.content === 'string') {
          const _qsOpts = { fromExplorer: true, skipAutoAppLayout: true };
          openPage('クイックスタート', _qsPath, _qsOpts);
          localStorage.setItem('meldex-quickstart-shown', '1');
          restored = true;
        }
      } catch (e) {}
    }

    if (!restored && !_isDesktopStartupLaunch()) {
      const startupFolder = _startupFolderCandidate(roots, homeRes, vault);
      if (startupFolder?.path) {
        const _startupOpts = { fromExplorer: true, skipAutoAppLayout: true };
        await openFolder(startupFolder.label || _pathTailLabel(startupFolder.path, 'フォルダ'), startupFolder.path, _startupOpts);
        restored = true;
      }
    }

    // v5.0 ペインシステムがタブを復元している場合は welcome にフォールバックしない。
    // lastView ベースの復元が hit しなくても、ペイン配置が残っていれば画面は埋まっている。
    if (!restored) {
      const _paneHasTabs = _paneLayoutHasAnyTabs();
      if (!_paneHasTabs) showView('welcome');
    }

    // 起動後の重い補助処理は背景で継続し、表示を先に返す。
    _scheduleStartupDatabaseViewTabsRepair();
    _hideStartupSplash();
    if (typeof _logPerfEvent === 'function') {
      _logPerfEvent('startup.visible', initStartedAt, { restored });
    }
    _runStartupBackground('file-id-migration-finalize', rawMigrationPromise.then(() => _migratePathsToFileIds()), () => {
      if (state.currentDbPath && typeof _refreshDbViewConfigAfterHistory === 'function') {
        _refreshDbViewConfigAfterHistory(state.currentDbPath);
      }
    });
    _runStartupBackground('post-init-ready', Promise.allSettled([migrationPromise, outlinerPromise, linkDictPromise]), () => {
      initGlobalFilterBar();
      _runStartupBackground('outliner-startup-refresh', _refreshOutlinerAfterStartupReady(), () => {
        _highlightLastOutlinerNodeAfterStartup();
        showStatus('準備完了');
      });
    });
  } catch (e) {
    showStatus('ソースフォルダ情報の取得に失敗しました', true);
  }
  _hideStartupSplash();
}
/* ==============================
   表示切替
   ============================== */
function showView(viewName, ctx) {
  const resolvedViewName = ['calendar', 'tasks', 'shifts'].includes(viewName) ? 'timeline' : viewName;
  const isDbViewName = (name) => ['pivot', 'gallery', 'kanban', 'timeline', 'chart', 'graph', 'form', 'smart-db', 'calendar', 'tasks', 'shifts'].includes(name);
  // スプリットペイン内のビュー切替（ctxにcontainerElがある場合）
  if (ctx && ctx.containerEl) {
    const isDbView = isDbViewName(viewName);
    const c = ctx.containerEl;
    const hasPaneViewSurfaces = !!c.querySelector('#pivot-view, #gallery-view, #kanban-view, #timeline-view, #chart-view, #graph-view, #form-view, #smart-db-view, .pivot-view, .gallery-view, .kanban-view, .timeline-view, .chart-view, .graph-view, .form-view, .smart-db-view');
    if (hasPaneViewSurfaces) {
      const _sv = (sel, show) => { const el = c.querySelector(sel); if (el) el.style.display = show; };
      _sv('#db-view-container, .db-view-container', isDbView ? 'flex' : 'none');
      _sv('#pivot-view, .pivot-view', resolvedViewName === 'pivot' ? '' : 'none');
      _sv('#gallery-view, .gallery-view', resolvedViewName === 'gallery' ? 'flex' : 'none');
      _sv('#kanban-view, .kanban-view', resolvedViewName === 'kanban' ? 'flex' : 'none');
      _sv('#timeline-view, .timeline-view', resolvedViewName === 'timeline' ? '' : 'none');
      _sv('#chart-view, .chart-view', resolvedViewName === 'chart' ? 'flex' : 'none');
      _sv('#graph-view, .graph-view', resolvedViewName === 'graph' ? 'flex' : 'none');
      _sv('#form-view, .form-view', resolvedViewName === 'form' ? 'flex' : 'none');
      _sv('#smart-db-view, .smart-db-view', resolvedViewName === 'smart-db' ? '' : 'none');
      ctx.viewMode = viewName;
      return;
    }
  }
  // ビュー切替前にボードの未保存を即時保存
  if (state.view === 'board' && viewName !== 'board' && typeof bd !== 'undefined' && bd.dirty && bd.path) {
    if (typeof bdSave === 'function') bdSave();
  }
  // ボードから離れたらノートタブを非表示
  if (state.view === 'board' && viewName !== 'board' && typeof hideBoardNoteTab === 'function') {
    hideBoardNoteTab();
  }
  // フォルダ以外のビューに切り替わったら一括処理バーを非表示
  if (viewName !== 'folder') {
    const fvBar = document.getElementById('fv-bulk-bar');
    if (fvBar) { fvBar.classList.remove('visible'); fvBar.hidden = true; fvBar.setAttribute('aria-hidden', 'true'); }
  }
  if (state.view === 'board' && viewName !== 'board' && typeof clearBoardDetailTabs === 'function') {
    clearBoardDetailTabs();
  }
  // viewName: 'welcome' | 'pivot' | 'gallery' | 'kanban' | 'entity' | 'page' | 'board'
  const isDbView = isDbViewName(viewName);
  const _setDisplay = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.style.display = value;
  };
  _setDisplay('login-view', 'none');
  _setDisplay('welcome-view', resolvedViewName === 'welcome' ? 'flex' : 'none');
  _setDisplay('db-view-container', isDbView ? 'flex' : 'none');
  _setDisplay('pivot-view', resolvedViewName === 'pivot' ? '' : 'none');
  _setDisplay('gallery-view', resolvedViewName === 'gallery' ? 'flex' : 'none');
  _setDisplay('kanban-view', resolvedViewName === 'kanban' ? 'flex' : 'none');
  _setDisplay('timeline-view', resolvedViewName === 'timeline' ? '' : 'none');
  _setDisplay('chart-view', resolvedViewName === 'chart' ? 'flex' : 'none');
  _setDisplay('graph-view', resolvedViewName === 'graph' ? 'flex' : 'none');
  _setDisplay('form-view', resolvedViewName === 'form' ? 'flex' : 'none');
  _setDisplay('smart-db-view', resolvedViewName === 'smart-db' ? 'flex' : 'none');
  _setDisplay('compare-view', resolvedViewName === 'compare' ? 'flex' : 'none');
  _setDisplay('entity-view', resolvedViewName === 'entity' ? 'flex' : 'none');
  _setDisplay('page-view', resolvedViewName === 'page' ? 'flex' : 'none');
  _setDisplay('media-view', resolvedViewName === 'media' ? 'flex' : 'none');
  _setDisplay('html-view', resolvedViewName === 'html' ? 'flex' : 'none');
  _setDisplay('csv-view', resolvedViewName === 'csv' ? 'flex' : 'none');
  _setDisplay('folder-view', resolvedViewName === 'folder' ? 'flex' : 'none');
  // app-toolbarの表示切替
  const appTb = document.getElementById('app-toolbar');
  _setDisplay('tb-db', isDbView ? 'contents' : 'none');
  // ページビュー: app-toolbarにリッチテキストツールバー表示
  const showRtInAppbar = (resolvedViewName === 'page');
  _setDisplay('rt-toolbar', showRtInAppbar ? '' : 'none');
  const hasAppTb = isDbView || showRtInAppbar;
  if (appTb) appTb.classList.toggle('visible', hasAppTb);
  // エントリビュー: エントリ内ツールバー
  const entityRt = document.getElementById('entity-rt-toolbar');
  if (entityRt) entityRt.style.display = (resolvedViewName === 'entity') ? 'flex' : 'none';
  // ステータスバーのショートカットヘルプ
  const sc = document.getElementById('sb-shortcuts');
  if (isDbView) {
    sc.textContent = '';
  } else if (resolvedViewName === 'entity' || resolvedViewName === 'page') {
    sc.textContent = 'Ctrl+B 太字 | Ctrl+I 斜体 | Ctrl+U 下線 | Ctrl+Shift+1~6 見出し | Ctrl+Shift+8 箇条書き | Tab インデント | Ctrl+Shift+↑↓ 移動';
  } else if (resolvedViewName === 'scriptnote') {
    if (typeof updateScriptnoteShortcutStatusbar === 'function') updateScriptnoteShortcutStatusbar(sc);
    else sc.textContent = 'Enter 行追加 | Ctrl+Enter 同タイプ行追加 | Shift+Del 行削除 | Ctrl+↑↓ 行入替 | Ctrl+R ルビ | Ctrl+Z Undo | Ctrl+Y Redo';
  } else {
    sc.textContent = '';
  }

  state.view = viewName;

  // メモ: ビュー切替時にターゲット更新＋再読み込み＋スクロール同期
  if (typeof ann !== 'undefined') {
    const newTarget = typeof getAnnotationTarget === 'function' ? getAnnotationTarget() : '';
    if (newTarget !== ann.targetPath) {
      ann.targetPath = newTarget;
      // 埋め込みサーフェス (board/html) の場合は iframe/bridge 側でロードされるため、
      // スタンドアロン側の loadAnnotations を呼ぶと同じ注釈が二重に描画される
      const embedded = typeof _usesEmbeddedAnnotationSurface === 'function'
        && _usesEmbeddedAnnotationSurface(viewName);
      if (embedded) {
        // 旧ビューからの残留（スタンドアロン overlay の描画＋付箋）をクリア
        const layer = document.getElementById('ann-layer');
        if (layer) layer.innerHTML = '';
        if (typeof _forEachStandaloneAnnotationNote === 'function') {
          _forEachStandaloneAnnotationNote(el => el.remove());
        }
      } else if (typeof loadAnnotations === 'function') {
        loadAnnotations();
      }
    }
    if (typeof _setupOverlayScroll === 'function') _setupOverlayScroll(viewName);
  }
}
// スクリーンショットメニュー
function showScreenshotMenu(e) {
  const btn = e?.target?.closest?.('button') || e?.target;
  const existing = document.querySelector('.ab-dropdown.ss-menu');
  if (existing) {
    existing.remove();
    btn?.setAttribute?.('aria-expanded', 'false');
    return;
  }
  const menu = document.createElement('div');
  menu.className = 'ab-dropdown ss-menu';
  menu.id = 'screenshot-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'スクリーンショット');
  if (btn?.setAttribute) {
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', menu.id);
  }
  let closed = false;
  let pointerCloser = null;
  let keyCloser = null;
  const closeMenu = (restoreFocus = false) => {
    if (closed) return;
    closed = true;
    if (pointerCloser) document.removeEventListener('pointerdown', pointerCloser, true);
    if (keyCloser) document.removeEventListener('keydown', keyCloser, true);
    if (btn?.setAttribute) btn.setAttribute('aria-expanded', 'false');
    menu.remove();
    if (restoreFocus) btn?.focus?.();
  };
  function addItem(label, fn, mode) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ab-dropdown-item';
    item.setAttribute('role', 'menuitem');
    if (mode) item.dataset.screenshotMode = mode;
    item.textContent = label;
    item.addEventListener('click', () => { closeMenu(false); fn(); });
    menu.appendChild(item);
  }
  function addSep() {
    const s = document.createElement('div');
    s.className = 'ab-dropdown-sep';
    s.setAttribute('role', 'separator');
    menu.appendChild(s);
  }
  addItem('全画面キャプチャ', () => captureScreenshot('full'), 'full');
  addItem('範囲選択キャプチャ', () => captureScreenshot('region'), 'region');
  addSep();
  addItem('全画面（GB非表示）', () => captureScreenshot('full-hide'), 'full-hide');
  addItem('範囲選択（GB非表示）', () => captureScreenshot('region-hide'), 'region-hide');
  addSep();
  addItem('トレイアプリから操作', () => showStatus('Ctrl+Shift+S (全画面) / Ctrl+Shift+R (範囲) / Ctrl+Shift+W (ウィンドウ)'));
  document.body.appendChild(menu);
  const placeMenu = () => {
    if (!btn?.getBoundingClientRect) return;
    const rect = btn.getBoundingClientRect();
    if (typeof positionPopup === 'function') {
      positionPopup(menu, rect, { prefer: 'right', gap: 4 });
      return;
    }
    const z = _getZoom();
    menu.style.left = (rect.right / z + 4) + 'px';
    menu.style.top = (rect.top / z) + 'px';
    requestAnimationFrame(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.bottom > window.innerHeight) menu.style.top = ((window.innerHeight - mr.height - 4) / z) + 'px';
      if (mr.right > window.innerWidth) menu.style.left = ((rect.left - mr.width - 4) / z) + 'px';
    });
  };
  placeMenu();
  menu.addEventListener('keydown', (ev) => {
    const items = [...menu.querySelectorAll('.ab-dropdown-item')];
    const index = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const delta = ev.key === 'ArrowDown' ? 1 : -1;
